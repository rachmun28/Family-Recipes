#!/usr/bin/env python3
"""Read a recipe submitted through a GitHub issue and add it to data/community.json.

Used by .github/workflows/accept-recipe.yml. Reads the issue body from the
ISSUE_BODY environment variable, finds the ```json block, validates it and
writes the merged list back. Prints the recipe title on success.
"""
import json, os, re, sys, pathlib, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "community.json"
ALLOWED = {"id", "title", "category", "serves", "from", "tags", "pre", "parts", "method", "notes", "bake", "scans"}


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "recipe"


def text(v, n=2000):
    if not isinstance(v, str):
        fail("expected text")
    return v.strip()[:n]


def text_list(v, n=2000):
    if v is None:
        return []
    if not isinstance(v, list):
        fail("expected a list")
    return [text(x, n) for x in v if isinstance(x, str) and x.strip()][:200]


def validate(r):
    if not isinstance(r, dict):
        fail("recipe must be an object")
    extra = set(r) - ALLOWED
    if extra:
        fail(f"unknown fields: {sorted(extra)}")
    out = {"title": text(r.get("title", ""), 200)}
    if not out["title"]:
        fail("recipe needs a title")
    out["id"] = slug(text(r.get("id") or out["title"], 120))
    for k in ("category", "serves", "from"):
        if r.get(k):
            out[k] = text(r[k], 200)
    for k in ("tags", "pre", "method", "notes"):
        v = text_list(r.get(k))
        if v:
            out[k] = v
    parts = []
    for p in r.get("parts") or []:
        if not isinstance(p, dict):
            fail("bad part")
        ings = text_list(p.get("ingredients"), 300)
        steps = []
        for s in p.get("steps") or []:
            if not isinstance(s, dict):
                fail("bad step")
            refs = [x for x in (s.get("in") or []) if isinstance(x, str) and re.fullmatch(r"[isp]\d{1,3}", x)]
            steps.append({"t": text(s.get("t", ""), 300), "in": refs})
        q = {"ingredients": ings, "steps": steps}
        if p.get("title"):
            q["title"] = text(p["title"], 120)
        parts.append(q)
    out["parts"] = parts
    b = r.get("bake")
    if isinstance(b, dict) and isinstance(b.get("temp"), (int, float)) and isinstance(b.get("min"), (int, float)):
        out["bake"] = {"temp": int(b["temp"]), "unit": "C" if b.get("unit") == "C" else "F",
                       "min": int(b["min"]), "max": int(b.get("max") or b["min"])}
        if isinstance(b.get("pan"), str):
            out["bake"]["pan"] = text(b["pan"], 40)
            out["bake"]["count"] = int(b.get("count") or 1)
    if not parts and not out.get("method"):
        fail("recipe has no ingredients or method")
    return out


def main():
    body = os.environ.get("ISSUE_BODY", "")
    m = re.search(r"```json\s*(\{.*?\})\s*```", body, re.S)
    if not m:
        fail("no ```json block found in the issue")
    try:
        recipe = validate(json.loads(m.group(1)))
    except json.JSONDecodeError as e:
        fail(f"the recipe block isn't valid JSON: {e}")
    data = json.loads(OUT.read_text()) if OUT.exists() else []
    data = [x for x in data if x.get("id") != recipe["id"]] + [recipe]
    data.sort(key=lambda x: x["title"].lower())
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(recipe["title"])


if __name__ == "__main__":
    main()
