#!/usr/bin/env python3
"""Compile the recipe source files (src/recipes/*.txt) into data/recipes.json.

Source format (one or more recipes per file):

    === Banana Nut Bread
    cat: Breads & Muffins
    serves: about 10
    from: Mom
    tags: quick bread, freezer
    scan: Banana Nut Bread.jpg
    bake: 350F 55-60 loaf-9          (temp, minutes, pan id, optional *count)
    pre: Butter and flour a loaf pan
    pre: Preheat oven to 350°F
    --- Optional part title          (starts a new part; first part is implicit)
    - 2 large ripe bananas           (ingredients, numbered 1.. within the part)
    * mash | 1                       (new step; inputs after '|')
    > bake | 3                       (step that continues the previous step)
    method: free text paragraph      (for recipes that don't fit the grid)
    note: free text

Inputs: 3 = ingredient 3, 5-8 = ingredients 5..8, s2 = step 2 of this part,
p1 = the finished result of part 1. '{bake}' in a step is replaced by the
bake temperature/time (and adjusted live by the pan estimator).
"""
import json, re, sys, pathlib, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "recipes"
OUT = ROOT / "data" / "recipes.json"
SCAN_MAP = ROOT / "data" / "scan-map.json"

PAN_IDS = None  # filled from assets/pans.json if present


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s or "recipe"


class BuildError(Exception):
    pass


def parse_refs(spec, n_ing, n_steps_so_far, n_parts_so_far, where):
    refs = []
    for tok in re.split(r"[\s,]+", spec.strip()):
        if not tok:
            continue
        m = re.fullmatch(r"(\d+)-(\d+)", tok)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if not (1 <= a <= b <= n_ing):
                raise BuildError(f"{where}: bad ingredient range {tok}")
            refs += [f"i{k-1}" for k in range(a, b + 1)]
            continue
        m = re.fullmatch(r"(\d+)", tok)
        if m:
            k = int(tok)
            if not 1 <= k <= n_ing:
                raise BuildError(f"{where}: no ingredient {tok}")
            refs.append(f"i{k-1}")
            continue
        m = re.fullmatch(r"s(\d+)", tok)
        if m:
            k = int(m.group(1))
            if not 1 <= k <= n_steps_so_far:
                raise BuildError(f"{where}: step {tok} not defined yet")
            refs.append(f"s{k-1}")
            continue
        m = re.fullmatch(r"p(\d+)", tok)
        if m:
            k = int(m.group(1))
            if not 1 <= k <= n_parts_so_far:
                raise BuildError(f"{where}: part {tok} not defined yet")
            refs.append(f"p{k-1}")
            continue
        raise BuildError(f"{where}: can't read input '{tok}'")
    return refs


BAKE_RE = re.compile(
    r"^(\d{2,3})\s*°?\s*([FC])\s+(\d+)(?:\s*-\s*(\d+))?(?:\s+([a-z0-9-]+)(?:\s*\*\s*(\d+))?)?\s*$",
    re.I,
)


def parse_bake(v, where):
    m = BAKE_RE.match(v.strip())
    if not m:
        raise BuildError(f"{where}: can't read bake '{v}'")
    temp, unit, a, b, pan, cnt = m.groups()
    d = {"temp": int(temp), "unit": unit.upper(), "min": int(a), "max": int(b or a)}
    if pan:
        if PAN_IDS is not None and pan not in PAN_IDS:
            raise BuildError(f"{where}: unknown pan '{pan}'")
        d["pan"] = pan
        d["count"] = int(cnt or 1)
    return d


def new_part(title=""):
    return {"title": title, "ingredients": [], "steps": [], "_src": []}


def finish_part(part, parts_before, where):
    """Turn raw step lines into steps with refs; validate tree."""
    steps = []
    for (kind, text, spec, lineno) in part.pop("_src"):
        w = f"{where} line {lineno}"
        refs = []
        if kind == ">":
            if not steps:
                raise BuildError(f"{w}: '>' step has no previous step")
            refs.append(f"s{len(steps)-1}")
        if spec:
            refs += parse_refs(spec, len(part["ingredients"]), len(steps), parts_before, w)
        steps.append({"t": text.strip(), "in": refs})
    part["steps"] = steps
    if steps:
        used = {}
        for si, s in enumerate(steps):
            for r in s["in"]:
                if r in used:
                    raise BuildError(f"{where}: {r[0]}{int(r[1:])+1} used twice (steps {used[r]+1} and {si+1}) in part '{part['title']}'")
                used[r] = si
        unused_i = [f"i{k}" for k in range(len(part["ingredients"])) if f"i{k}" not in used]
        if unused_i:
            names = [part["ingredients"][int(r[1:])] for r in unused_i]
            raise BuildError(f"{where}: ingredients not used in any step: {names}")
        roots = [k for k in range(len(steps)) if f"s{k}" not in used]
        if len(roots) != 1:
            raise BuildError(f"{where}: part '{part['title']}' should end in exactly one final step, found {[steps[k]['t'] for k in roots]}")
    return part, {r for s in steps for r in s["in"] if r.startswith("p")}


def parse_file(path, scan_names):
    recipes = []
    cur = None
    part = None

    def close_recipe():
        nonlocal cur, part
        if cur is None:
            return
        where = f"{path.name}: {cur['title']}"
        parts = [p for p in cur["parts"] if p["ingredients"] or p["_src"] or p["title"]]
        done = []
        consumed = set()
        for i, p in enumerate(parts):
            fp, pc = finish_part(p, i, where)
            consumed |= pc
            done.append(fp)
        # a part that has steps and isn't consumed is fine (separate table)
        cur["parts"] = done
        for s in cur.get("scans", []):
            if s not in scan_names:
                raise BuildError(f"{where}: scan not found: {s}")
        if not done and not cur.get("method"):
            raise BuildError(f"{where}: recipe has no content")
        recipes.append(cur)
        cur = None

    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("==="):
            close_recipe()
            title = line[3:].strip()
            cur = {"id": slugify(title), "title": title, "category": "", "serves": "", "from": "",
                   "tags": [], "pre": [], "parts": [new_part()], "method": [], "notes": [], "scans": []}
            part = cur["parts"][0]
            continue
        if cur is None:
            raise BuildError(f"{path.name}:{lineno}: text before first '=== Title'")
        where = f"{path.name}:{lineno}"
        if line.startswith("---"):
            part = new_part(line[3:].strip())
            cur["parts"].append(part)
            continue
        if line.startswith("- "):
            part["ingredients"].append(line[2:].strip())
            continue
        if line[:2] in ("* ", "> ") or line in ("*", ">"):
            kind = line[0]
            body = line[2:]
            text, _, spec = body.partition("|")
            part["_src"].append((kind, text, spec, lineno))
            continue
        m = re.match(r"^([a-z]+):\s*(.*)$", line)
        if not m:
            raise BuildError(f"{where}: can't understand line: {line!r}")
        key, val = m.group(1), m.group(2).strip()
        if key == "cat":
            cur["category"] = val
        elif key == "serves":
            cur["serves"] = val
        elif key == "from":
            cur["from"] = val
        elif key == "id":
            cur["id"] = val
        elif key == "tags":
            cur["tags"] = [t.strip() for t in val.split(",") if t.strip()]
        elif key == "scan":
            cur["scans"].append(val)
        elif key == "pre":
            cur["pre"].append(val)
        elif key == "bake":
            cur["bake"] = parse_bake(val, where)
        elif key == "method":
            cur["method"].append(val)
        elif key == "note":
            cur["notes"].append(val)
        else:
            raise BuildError(f"{where}: unknown key '{key}'")
    close_recipe()
    return recipes


def main():
    global PAN_IDS
    pans_file = ROOT / "assets" / "pans.json"
    if pans_file.exists():
        PAN_IDS = {p["id"] for p in json.loads(pans_file.read_text())}
    scan_map = json.loads(SCAN_MAP.read_text()) if SCAN_MAP.exists() else {}
    all_recipes, errors = [], []
    for f in sorted(SRC.glob("*.txt")):
        try:
            all_recipes += parse_file(f, scan_map)
        except BuildError as e:
            errors.append(str(e))
    ids = {}
    for r in all_recipes:
        base, n = r["id"], 2
        while r["id"] in ids:
            r["id"] = f"{base}-{n}"; n += 1
        ids[r["id"]] = r
        r["scans"] = [scan_map[s] for s in r["scans"]]
        for k in ("from", "serves", "category"):
            if not r[k]:
                r.pop(k)
        for k in ("tags", "pre", "method", "notes", "scans"):
            if not r[k]:
                r.pop(k)
        for p in r["parts"]:
            if not p["title"]:
                p.pop("title")
    if errors:
        print("\n".join("ERROR " + e for e in errors), file=sys.stderr)
        sys.exit(1)
    all_recipes.sort(key=lambda r: r["title"].lower())
    OUT.write_text(json.dumps(all_recipes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"built {len(all_recipes)} recipes -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
