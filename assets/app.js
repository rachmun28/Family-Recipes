/* Family Recipe Box — single-page app for GitHub Pages. No build step, no dependencies. */
(() => {
'use strict';

const CFG = Object.assign({ title: 'Munro Family Recipes', repo: '', branch: 'main' }, window.COOKBOOK_CONFIG || {});
const REPO_OK = /^[\w.-]+\/[\w.-]+$/.test(CFG.repo) && !/YOUR-GITHUB-NAME/.test(CFG.repo);

/* ------------------------------------------------------------------ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('cb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cb.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

/* ------------------------------------------------------------------ state */
const S = {
  base: [], community: [], mine: store.get('mine', []),
  recipes: [], byId: new Map(),
  pans: [], panById: new Map(),
  units: store.get('units', 'both'),
  view: store.get('view', 'table'),
  favs: new Set(store.get('favs', [])),
  home: { q: '', cat: '', scroll: 0 },
};
function rebuildIndex() {
  const map = new Map();
  for (const r of S.base) map.set(r.id, { ...r, _src: 'base' });
  for (const r of S.community) map.set(r.id, { ...r, _src: map.has(r.id) ? 'corrected' : 'shared' });
  for (const r of S.mine) map.set(r.id, { ...r, _src: 'mine' });
  S.byId = map;
  S.recipes = [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/* ------------------------------------------------------- numbers & units */
const UF = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅕': 1 / 5 };
const UFC = '½⅓⅔¼¾⅛⅜⅝⅞⅕';
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+-\\d+\\/\\d+|\\d+\\s*[${UFC}]|\\d+\\/\\d+|\\d*\\.\\d+|\\d+|[${UFC}])`;
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|to|or)\\s*(${NUM}))?\\s*`);
function numVal(s) {
  s = s.trim(); let m;
  if ((m = s.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(new RegExp(`^(\\d+)\\s*([${UFC}])$`)))) return +m[1] + UF[m[2]];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if (UF[s] != null) return UF[s];
  return parseFloat(s);
}
const UNIT_RES = [
  ['floz', /^(?:fl\.?\s*oz|fluid\s+ounces?)\.?(?=[\s,;:)]|$)/i],
  ['tbsp', /^(?:tablespoons?|tbsps?|tbls?|tbs)\.?(?=[\s,;:)]|$)/i],
  ['tbsp', /^T\.?(?=[\s,;:)]|$)/],
  ['tsp', /^(?:teaspoons?|tsps?)\.?(?=[\s,;:)]|$)/i],
  ['tsp', /^t\.?(?=[\s,;:)]|$)/],
  ['cup', /^(?:cups?|c)\.?(?=[\s,;:)]|$)/i],
  ['pint', /^(?:pints?|pts?)\.?(?=[\s,;:)]|$)/i],
  ['quart', /^(?:quarts?|qts?)\.?(?=[\s,;:)]|$)/i],
  ['gallon', /^(?:gallons?|gal)\.?(?=[\s,;:)]|$)/i],
  ['ml', /^(?:ml|millilit(?:re|er)s?|cc)\.?(?=[\s,;:)]|$)/i],
  ['lb', /^(?:pounds?|lbs?)\.?(?=[\s,;:)]|$)/i],
  ['l', /^(?:lit(?:re|er)s?|l)\.?(?=[\s,;:)]|$)/i],
  ['oz', /^(?:ounces?|oz)\.?(?=[\s,;:)]|$)/i],
  ['kg', /^(?:kg|kilos?|kilograms?)\.?(?=[\s,;:)]|$)/i],
  ['g', /^(?:grams?|grammes?|gms?|gr|g)\.?(?=[\s,;:)]|$)/i],
];
const VOL_CUPS = { tsp: 1 / 48, tbsp: 1 / 16, cup: 1, floz: 1 / 8, pint: 2, quart: 4, gallon: 16, ml: 1 / 250, l: 4 };
const WT_G = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
const METRIC = new Set(['ml', 'l', 'g', 'kg']);

function parseIng(raw) {
  const s = String(raw).trim();
  const m = s.match(QTY_RE);
  if (!m) return { raw: s, qty: null, rest: s };
  const qty = numVal(m[1]);
  const qty2 = m[2] ? numVal(m[2]) : null;
  if (!isFinite(qty)) return { raw: s, qty: null, rest: s };
  let rest = s.slice(m[0].length), unit = null, used = m[0].length;
  for (const [u, re] of UNIT_RES) {
    const um = rest.match(re);
    if (um) { unit = u; used += um[0].length; rest = rest.slice(um[0].length); break; }
  }
  const lead = rest.match(/^\s*(?:of\s+)?/)[0];
  used += lead.length; rest = rest.slice(lead.length);
  return { raw: s, qty, qty2, unit, head: s.slice(0, used).trim(), rest: rest.trim() };
}

/* grams per (US/kitchen) cup; liquid=true -> metric shows mL */
const DENS = [
  ['buttermilk', 245, 1], ['peanut butter', 258], ['butterscotch chip', 170], ['apple butter', 280],
  ['cream cheese', 232], ['sour cream', 230], ['ice cream', 150], ['whipping cream|heavy cream|whipped cream|cream\\b(?! of)|half[- ]and[- ]half|table cream|light cream', 240, 1],
  ['coconut milk', 240, 1], ['condensed milk', 306, 1], ['evaporated milk', 252, 1], ['\\bmilk\\b', 245, 1],
  ['yogh?urt', 245],
  ['icing sugar|powdered sugar|confectioner|10x sugar|fruit sugar|berry sugar', 120], ['brown sugar|demerara', 213], ['sugar', 200],
  ['cake (?:&|and) pastry flour|cake flour|pastry flour', 115], ['bread flour', 130], ['whole ?wheat flour|wholewheat|graham flour|whole wheat', 120],
  ['rye flour', 102], ['almond flour|ground almonds?', 96], ['corn ?meal', 150], ['corn ?starch|cornflour', 128], ['flour', 125],
  ['rolled oats|quick oats|oatmeal|\\boats\\b', 90], ['bran flakes|all[- ]bran|bran buds', 70], ['\\bbran\\b', 60], ['wheat germ', 115],
  ['cocoa', 85], ['chocolate chips?|chipits|choc(?:olate)?\\.? chips?|chips', 170], ['chopped chocolate|grated chocolate', 150],
  ['margarine|butter', 227], ['shortening|crisco|lard', 205],
  ['oil\\b', 218, 1], ['honey', 340], ['maple syrup|syrup', 315, 1], ['molasses', 337], ['corn syrup|golden syrup', 328],
  ['ketchup|chili sauce', 270], ['mayonnaise|miracle whip|salad dressing', 220], ['jam|jelly|preserves|marmalade', 320],
  ['water|juice|stock|broth|wine|brandy|rum|vodka|whisk(?:e)?y|liqueur|grand marnier|kahlua|vinegar|coffee|sherry|beer|\\bale\\b|soy sauce|worcestershire|vanilla|extract|essence|bouillon', 240, 1],
  ['ricotta|cottage cheese', 246], ['parmesan|parmigiano', 100], ['cheese|cheddar|mozzarella|swiss|feta', 113],
  ['sliced almonds?', 92], ['slivered almonds?', 108], ['almonds?', 140], ['walnuts?|pecans?', 115], ['peanuts?', 145], ['nuts?|hazelnuts?|filberts?|cashews?|pine nuts', 125],
  ['raisins?|currants?|sultanas?', 150], ['dates?\\b', 150], ['dried cranberr|craisins', 120], ['glac[eé] cherr|candied|mixed peel|cherries', 160],
  ['coconut', 85], ['marshmallows?', 50], ['crumbs?|graham|crushed crackers|cornflakes|rice krispies|cereal', 100], ['\\brice\\b', 190],
  ['baking soda|\\bsoda\\b', 230], ['baking powder', 192], ['cream of tartar', 155], ['yeast', 150], ['salt', 288],
  ['cinnamon|ginger|nutmeg|allspice|cloves|spice|paprika|curry|cumin|chili powder|dry mustard|mustard powder|pepper\\b(?! ?s)', 125],
  ['pumpkin', 245], ['applesauce', 255], ['bananas?', 225], ['blueberr|raspberr|cranberr', 145], ['strawberr', 150],
  ['apples?', 110], ['carrots?', 110], ['zucchini', 125], ['celery', 100], ['onions?', 160], ['mushrooms?', 70], ['chicken|turkey|ham\\b', 140],
  ['egg whites?', 243, 1], ['egg yolks?|eggs?\\b', 243, 1], ['gelatin', 150], ['mincemeat', 270], ['tomato(?:es)?', 180],
];
const DENS_RE = DENS.map(([k, g, l]) => [new RegExp(k, 'i'), g, !!l, k]);
function density(name) {
  const n = norm(name).replace(/\([^)]*\)/g, ' ');
  for (const [re, g, liquid] of DENS_RE) if (re.test(n)) return { g, liquid };
  return null;
}

const FR = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
const FR_TSP = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 2, '½'], [3 / 4, '¾'], [1, '']];
const FR_HALF = [[0, ''], [1 / 2, '½'], [1, '']];
const FR_Q = [[0, ''], [1 / 4, '¼'], [1 / 2, '½'], [3 / 4, '¾'], [1, '']];
function frac(x, set = FR) {
  let w = Math.floor(x + 1e-9); const f = x - w; let best = set[0];
  for (const c of set) if (Math.abs(c[0] - f) < Math.abs(best[0] - f)) best = c;
  if (best[0] === 1) { w += 1; best = [0, '']; }
  const str = ((w ? String(w) : '') + best[1]) || '0';
  return { val: w + best[0], str };
}
function usVol(cups) {
  if (!(cups > 0)) return '0';
  if (cups >= 0.249) {
    const f = frac(cups);
    if (cups >= 1 || Math.abs(f.val - cups) / cups <= 0.07) return `${f.str} ${f.val > 1 ? 'cups' : 'cup'}`;
  }
  const tsp = cups * 48;
  if (tsp >= 2.99) return `${frac(tsp / 3, FR_HALF).str} tbsp`;
  if (tsp < 0.09) return 'pinch';
  return `${frac(tsp, FR_TSP).str} tsp`;
}
function fmtG(g) {
  if (g >= 1000) return `${(+(g / 1000).toFixed(2))} kg`;
  if (g >= 100) return `${Math.round(g / 5) * 5} g`;
  if (g >= 10) return `${Math.round(g)} g`;
  return `${+(g.toFixed(1))} g`;
}
function fmtMl(ml) {
  if (ml >= 1000) return `${+(ml / 1000).toFixed(2)} L`;
  if (ml >= 15) return `${Math.round(ml / 5) * 5} mL`;
  if (ml >= 2) return `${Math.round(ml)} mL`;
  return `${Math.max(0.5, Math.round(ml * 2) / 2)} mL`;
}
function fmtOz(g) {
  const oz = g / 28.35;
  if (oz >= 16) return `${frac(oz / 16, FR_Q).str} lb`;
  if (oz < 0.2) return fmtG(g);
  return `${frac(oz, FR_Q).str} oz`;
}
function fmtCount(x) {
  if (x >= 10) return String(Math.round(x));
  return frac(x, [[0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']]).str;
}

/* Convert a base amount (cups for volume, grams for weight) into a target */
function amountTo(base, dim, target, dens) {
  if (dim === 'vol') {
    if (target === 'us') return usVol(base);
    if (target === 'ml') return fmtMl(base * 250);
    if (target === 'g') return fmtG(base * dens.g);
  } else {
    if (target === 'g') return fmtG(base);
    if (target === 'oz') return fmtOz(base);
    if (target === 'us') return usVol(base / dens.g);
    if (target === 'ml') return fmtMl(base / dens.g * 250);
  }
  return '';
}

const UNI = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' };
function prettyFrac(s) {
  return s.replace(/(\d+)[\s-]+([1-7]\/[2348])\b/g, (m, w, f) => UNI[f] ? w + UNI[f] : m)
    .replace(/(^|[^\d/])([1-7]\/[2348])(?![\d/])/g, (m, a, f) => UNI[f] ? a + UNI[f] : m);
}

/* Format one ingredient line. Returns HTML. */
function fmtIng(raw, scale = 1, mode = S.units) {
  const p = parseIng(raw);
  if (p.qty == null) return esc(raw);
  const dim = p.unit ? (VOL_CUPS[p.unit] ? 'vol' : 'wt') : null;
  const range = (fn) => fn(p.qty * scale) + (p.qty2 != null ? '–' + fn(p.qty2 * scale) : '');
  if (!dim) {
    const q = scale === 1 ? prettyFrac(p.head) : range(fmtCount);
    return `${esc(q)} ${esc(p.rest)}`;
  }
  const dens = density(p.rest);
  const toBase = q => dim === 'vol' ? q * VOL_CUPS[p.unit] : q * WT_G[p.unit];
  const metricSrc = METRIC.has(p.unit);
  const amt = target => {
    const a = amountTo(toBase(p.qty * scale), dim, target, dens);
    if (p.qty2 == null) return a;
    const b = amountTo(toBase(p.qty2 * scale), dim, target, dens);
    const [an, ...au] = a.split(' '), [bn, ...bu] = b.split(' ');
    return au.join(' ') === bu.join(' ') ? `${an}–${bn} ${bu.join(' ')}` : `${a}–${b}`;
  };
  const original = () => {
    if (scale === 1) return prettyFrac(p.head);
    if (dim === 'vol') return amt(metricSrc ? 'ml' : 'us');
    return amt(metricSrc ? 'g' : 'oz');
  };
  let primary, alt = null;
  if (mode === 'us') {
    if (!metricSrc) primary = original();
    else if (dim === 'vol') primary = amt('us');
    else primary = dens ? amt('us') : amt('oz');
  } else if (mode === 'metric') {
    if (metricSrc) primary = original();
    else if (dim === 'vol') primary = (dens && !dens.liquid) ? amt('g') : amt('ml');
    else primary = amt('g');
  } else {
    primary = original();
    if (dim === 'vol') alt = metricSrc ? amt('us') : ((dens && !dens.liquid) ? amt('g') : amt('ml'));
    else alt = metricSrc ? (dens ? (dens.liquid ? amt('us') : amt('us')) : amt('oz')) : amt('g');
  }
  const scaledCls = scale !== 1 ? ' class="scaledq"' : '';
  return `<span${scaledCls}>${esc(primary)}</span>${alt ? ` <span class="alt">(${esc(alt)})</span>` : ''} ${esc(p.rest)}`;
}

/* ------------------------------------------------------------ temperature */
const f2c = f => Math.round((f - 32) * 5 / 9 / 5) * 5;
const c2f = c => Math.round((c * 9 / 5 + 32) / 5) * 5;
function tempStr(t, unit) {
  return unit === 'C' ? `${t}°C (${c2f(t)}°F)` : `${t}°F (${f2c(t)}°C)`;
}
function tempify(html) {
  if (/\d\s*°\s*F/i.test(html) && /\d\s*°\s*C/i.test(html)) return html;
  return html.replace(/(\d{3})\s*(?:°|º|degrees?\b|deg\b\.?)\s*([FC])?\b(?!\s*\()|(\d{3})\s*([FC])\b(?!\s*\()/g, (m, a, u1, b, u2) => {
    const t = +(a || b); const u = (u1 || u2 || '').toUpperCase();
    if (u === 'C') return tempStr(t, 'C');
    if (t < 200 || t > 550) return m;
    return tempStr(t, 'F');
  });
}
function minsStr(a, b) {
  const one = m => m >= 90 ? `${Math.floor(m / 60)} hr${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
  if (b == null || a === b) return one(a);
  if (b < 90) return `${a}–${b} min`;
  return `${one(a)} – ${one(b)}`;
}

/* ---------------------------------------------------------- bake estimator */
const MATERIALS = {
  light: { name: 'Light metal (shiny aluminum)', dt: 0, f: 1 },
  dark: { name: 'Dark / nonstick metal', dt: -25, f: 0.95 },
  glass: { name: 'Glass (Pyrex)', dt: -25, f: 1.05 },
  ceramic: { name: 'Ceramic / stoneware', dt: -25, f: 1.1 },
  silicone: { name: 'Silicone', dt: 0, f: 1.1 },
  castiron: { name: 'Cast iron', dt: 0, f: 1.0 },
  insulated: { name: 'Insulated (air-cushion)', dt: 0, f: 1.15 },
};
function panArea(p) {
  if (p.shape === 'rect') return p.l * p.w;
  if (p.shape === 'round' || p.shape === 'muffin') return Math.PI * (p.d / 2) ** 2;
  if (p.shape === 'tube') return Math.PI * ((p.d / 2) ** 2 - (p.di / 2) ** 2);
  return null;
}
/* slowest heat-diffusion mode (1/in^2) of batter depth d in pan p; heated bottom & sides */
function panK(p, depth) {
  const z = (Math.PI / (2 * depth)) ** 2;
  if (p.shape === 'rect') return z + (Math.PI / p.w) ** 2 + (Math.PI / p.l) ** 2;
  if (p.shape === 'round' || p.shape === 'muffin') return z + (2.405 / (p.d / 2)) ** 2;
  if (p.shape === 'tube') { const w = (p.d - p.di) / 2, L = Math.PI * (p.d + p.di) / 2; return z + (Math.PI / w) ** 2 + (Math.PI / L) ** 2; }
  return z;
}
function panLabel(p, count) {
  if (!p) return '';
  if (p.custom) {
    const dims = p.shape === 'rect' ? `${p.l} × ${p.w} × ${p.h}-inch pan` : `${p.d}-inch round pan, ${p.h} in deep`;
    return (count > 1 ? count + ' × ' : '') + dims;
  }
  if (p.shape === 'muffin') return `${count || 12} ${p.name.toLowerCase()}`;
  return (count > 1 ? `${count} × ` : '') + p.name;
}
/* o: {from, fromCount, fromMat, to, toCount (0=auto), toMat, scale, temp, unit, tMin, tMax} */
function estimate(o) {
  const out = { notes: [], warnings: [] };
  const mf = MATERIALS[o.fromMat] || MATERIALS.light, mt = MATERIALS[o.toMat] || MATERIALS.light;
  const dt = mt.dt - mf.dt;
  out.temp = o.unit === 'C' ? o.temp + Math.round(dt * 5 / 9 / 5) * 5 : o.temp + dt;
  out.unit = o.unit;
  if (dt) out.notes.push(dt < 0 ? `${mt.name} browns faster — oven lowered ${o.unit === 'C' ? '15°C' : '25°F'}.` : `Oven raised ${o.unit === 'C' ? '15°C' : '25°F'} to make up for the original ${mf.name.toLowerCase()}.`);
  let ratio = mt.f / mf.f;
  const A0 = panArea(o.from), A1 = panArea(o.to);
  if (A0 && A1 && o.from.shape !== 'sheet' && o.to.shape !== 'sheet') {
    const d0 = o.from.h * o.from.fill;
    const V = A0 * d0 * (o.fromCount || 1) * o.scale;
    out.volumeCups = V / 14.44;
    let n, depth;
    if (o.to.shape === 'muffin') {
      depth = o.to.h * o.to.fill;
      n = Math.max(1, Math.round(V / (A1 * depth)));
      out.count = n; out.countLabel = `${n} cup${n > 1 ? 's' : ''}`;
    } else {
      n = o.toCount > 0 ? o.toCount : Math.max(1, Math.ceil(V / (A1 * o.to.h * 0.62)));
      depth = V / (n * A1);
      out.count = n; out.countLabel = `${n} pan${n > 1 ? 's' : ''}`;
    }
    out.depth = depth; out.fill = depth / o.to.h;
    // time = surface/crust overhead + heat-diffusion time (1/k); calibrated so one batter
    // bakes ~55 min as a 9x5 loaf, ~22 min as muffins and ~11 min as mini muffins.
    const C = 0.14;
    const geo = (C + 1 / panK(o.to, depth)) / (C + 1 / panK(o.from, d0));
    ratio *= geo;
    if (out.fill > 0.72) out.warnings.push(`Pan would be ${Math.round(out.fill * 100)}% full — likely to overflow. Use ${o.to.shape === 'muffin' ? 'more cups' : 'a bigger pan or another pan'}.`);
    else if (out.fill < 0.22 && o.to.shape !== 'muffin') out.warnings.push(`Batter only ${depth.toFixed(1)} in deep — it will be thin and can dry out. Check early.`);
    if (geo > 1.5) out.notes.push('Much thicker than the original: if the top browns before the centre sets, tent loosely with foil.');
  } else if (o.to.shape === 'sheet' || o.from.shape === 'sheet') {
    out.notes.push('Cookie sheets: time depends on the size of each cookie, not the pan. Larger cookies need a few extra minutes.');
  }
  out.mid = Math.max(1, Math.round((o.tMin + o.tMax) / 2 * ratio));
  out.lo = Math.max(1, Math.round(o.tMin * ratio * 0.95));
  out.hi = Math.max(out.lo, Math.round(o.tMax * ratio * 1.03));
  out.check = Math.max(1, Math.round(out.lo * 0.9));
  out.changed = Math.abs(ratio - 1) > 0.02 || dt !== 0;
  return out;
}

/* ----------------------------------------------------------- recipe model */
function rootsOf(part) {
  const steps = part.steps || [];
  const used = new Set(steps.flatMap(s => s.in || []));
  return steps.map((_, i) => i).filter(i => !used.has('s' + i));
}
function unusedIngs(part) {
  const used = new Set((part.steps || []).flatMap(s => s.in || []));
  return (part.ingredients || []).map((_, i) => i).filter(i => !used.has('i' + i));
}
function bakeText(recipe, ctx) {
  const b = recipe.bake;
  if (!b) return 'bake';
  const est = ctx && ctx.est;
  if (est && est.changed) {
    return `bake <span class="adj">${esc(tempStr(est.temp, b.unit))} ${esc(minsStr(est.lo, est.hi))}</span>`;
  }
  return `bake ${esc(tempStr(b.temp, b.unit))} ${esc(minsStr(b.min, b.max))}`;
}
function stepHtml(t, recipe, ctx) {
  let h = tempify(esc(t));
  h = h.replace(/\{bake\}/g, () => bakeText(recipe, ctx));
  return h;
}

/* Build the tabular grid for one part. Returns HTML (may contain several tables). */
function gridHtml(recipe, pi, ctx, withPre) {
  const part = recipe.parts[pi];
  const steps = part.steps || [];
  const roots = rootsOf(part);
  let html = '';
  roots.forEach((rootIdx, ti) => {
    const cells = []; let nrows = 0; const seen = new Set();
    const place = ref => {
      const k = +ref.slice(1);
      if (ref[0] === 'i') {
        const r = nrows++; cells.push({ r, c: 0, rs: 1, cs: 1, cls: 'ing', html: fmtIng(part.ingredients[k] ?? '?', ctx.scale, ctx.units) });
        return { r0: r, r1: r, col: 0 };
      }
      if (ref[0] === 'p') {
        const r = nrows++; const pp = recipe.parts[k];
        cells.push({ r, c: 0, rs: 1, cs: 1, cls: 'ing partref', html: esc(pp ? (pp.title || `Part ${k + 1}`) : '?') });
        return { r0: r, r1: r, col: 0 };
      }
      if (seen.has(k) || !steps[k]) return null;
      seen.add(k);
      const s = steps[k];
      const kids = (s.in || []).map(place).filter(Boolean);
      if (!kids.length) {
        const r = nrows++; cells.push({ r, c: 0, rs: 1, cs: 1, cls: 'op lone', html: stepHtml(s.t, recipe, ctx) });
        return { r0: r, r1: r, col: 0 };
      }
      const col = 1 + Math.max(...kids.map(x => x.col));
      for (const x of kids) if (x.col < col - 1) cells.push({ r: x.r0, c: x.col + 1, rs: x.r1 - x.r0 + 1, cs: col - 1 - x.col, cls: 'gap', html: '' });
      const r0 = Math.min(...kids.map(x => x.r0)), r1 = Math.max(...kids.map(x => x.r1));
      cells.push({ r: r0, c: col, rs: r1 - r0 + 1, cs: 1, cls: 'op', html: stepHtml(s.t, recipe, ctx) });
      return { r0, r1, col };
    };
    const root = place('s' + rootIdx);
    if (!root) return;
    const W = root.col + 1;
    const byRow = Array.from({ length: nrows }, () => []);
    for (const c of cells) byRow[c.r].push(c);
    let rows = '';
    if (withPre && ti === 0) for (const p of recipe.pre || []) rows += `<tr><td class="pre" colspan="${W}">${tempify(esc(p))}</td></tr>`;
    for (const rc of byRow) {
      rc.sort((a, b) => a.c - b.c);
      rows += '<tr>' + rc.map(c => `<td class="${c.cls}"${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}${c.cs > 1 ? ` colspan="${c.cs}"` : ''}>${c.html}</td>`).join('') + '</tr>';
    }
    html += `<div class="gridwrap"><table class="rgrid">${rows}</table></div>`;
  });
  const extra = unusedIngs(part);
  if (steps.length && extra.length) {
    html += `<p class="hint">Also:</p><ul>${extra.map(i => `<li>${fmtIng(part.ingredients[i], ctx.scale, ctx.units)}</li>`).join('')}</ul>`;
  }
  return html;
}

function ingListHtml(part, ctx) {
  return `<ul>${(part.ingredients || []).map(x => `<li>${fmtIng(x, ctx.scale, ctx.units)}</li>`).join('')}</ul>`;
}
function stepsListHtml(recipe, part, ctx) {
  const steps = part.steps || [];
  if (!steps.length) return '';
  return `<ol>${steps.map(s => {
    const ings = (s.in || []).filter(r => r[0] === 'i').map(r => part.ingredients[+r.slice(1)]).filter(Boolean);
    const parts = (s.in || []).filter(r => r[0] === 'p').map(r => (recipe.parts[+r.slice(1)] || {}).title).filter(Boolean);
    const used = [...parts.map(esc), ...ings.map(x => fmtIng(x, ctx.scale, ctx.units))];
    return `<li>${cap(stepHtml(s.t, recipe, ctx))}${used.length ? ` <span class="used">— ${used.join('; ')}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}

function recipeBodyHtml(recipe, ctx) {
  let html = '';
  const parts = recipe.parts || [];
  const multi = parts.length > 1;
  if (ctx.view === 'list') {
    html += '<div class="listview"><div><h2>Ingredients</h2>';
    for (const p of parts) {
      if (!(p.ingredients || []).length) continue;
      if (multi && p.title) html += `<h3>${esc(p.title)}</h3>`;
      html += ingListHtml(p, ctx);
    }
    html += '</div><div><h2>Method</h2>';
    if ((recipe.pre || []).length) html += `<ul>${recipe.pre.map(x => `<li>${tempify(esc(x))}</li>`).join('')}</ul>`;
    for (const p of parts) {
      if (!(p.steps || []).length) continue;
      if (multi && p.title) html += `<h3>${esc(p.title)}</h3>`;
      html += stepsListHtml(recipe, p, ctx);
    }
    if ((recipe.method || []).length) html += `<div class="method">${recipe.method.map(m => `<p>${stepHtml(m, recipe, ctx)}</p>`).join('')}</div>`;
    html += '</div></div>';
  } else {
    let preDone = false;
    const gridParts = parts.filter(p => (p.steps || []).length);
    if (!gridParts.length && (recipe.pre || []).length) {
      html += `<ul>${recipe.pre.map(x => `<li>${tempify(esc(x))}</li>`).join('')}</ul>`; preDone = true;
    }
    parts.forEach((p, i) => {
      if (multi && p.title) html += `<h3 class="part-title">${esc(p.title)}</h3>`;
      if ((p.steps || []).length) { html += gridHtml(recipe, i, ctx, !preDone); preDone = true; }
      else html += ingListHtml(p, ctx);
    });
    if ((recipe.method || []).length) html += `<h3 class="part-title">Method</h3><div class="method">${recipe.method.map(m => `<p>${stepHtml(m, recipe, ctx)}</p>`).join('')}</div>`;
  }
  if ((recipe.notes || []).length) html += `<div class="notes">${recipe.notes.map(n => `<p>${tempify(esc(n))}</p>`).join('')}</div>`;
  return html;
}

function baseServings(r) {
  const m = String(r.serves || '').match(/(\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}

/* ----------------------------------------------------------------- views */
const app = () => $('#app');
function setNav(which) { $$('.topnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === which)); }
function setTitle(t) { document.title = t ? `${t} · ${CFG.title}` : CFG.title; }

function srcBadge(r) {
  if (r._src === 'mine') return '<span class="badge mine">On this device</span>';
  if (r._src === 'shared') return '<span class="badge shared">Shared</span>';
  if (r._src === 'corrected') return '<span class="badge shared">Updated</span>';
  return '';
}

/* --- home --- */
function viewHome() {
  setNav('home'); setTitle('');
  const cats = new Map();
  for (const r of S.recipes) cats.set(r.category || 'Other', (cats.get(r.category || 'Other') || 0) + 1);
  const catList = [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  app().innerHTML = `
    <section class="hero">
      <h1>${esc(CFG.title)}</h1>
      <p>${S.recipes.length} recipes, laid out so you can see the whole method at a glance. Pick one, scale it, switch units, or change the pan.</p>
      <div class="searchrow"><input type="search" id="q" placeholder="Search recipes or ingredients — e.g. “lemon”, “chicken rice”" value="${esc(S.home.q)}" aria-label="Search recipes"></div>
      <div class="chips" id="cats">
        <button class="chip" data-cat="" aria-pressed="${!S.home.cat}">All</button>
        <button class="chip" data-cat="★" aria-pressed="${S.home.cat === '★'}">★ Favourites<span class="n">${S.favs.size}</span></button>
        ${S.mine.length || S.community.length ? `<button class="chip" data-cat="+" aria-pressed="${S.home.cat === '+'}">Added by family<span class="n">${S.recipes.filter(r => r._src !== 'base').length}</span></button>` : ''}
        ${catList.map(([c, n]) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${S.home.cat === c}">${esc(c)}<span class="n">${n}</span></button>`).join('')}
      </div>
    </section>
    <div class="count" id="count"></div>
    <div class="cards" id="cards"></div>`;
  const draw = () => {
    const terms = norm(S.home.q).split(/\s+/).filter(Boolean);
    let list = S.recipes.filter(r => {
      if (S.home.cat === '★') return S.favs.has(r.id);
      if (S.home.cat === '+') return r._src !== 'base';
      if (S.home.cat) return (r.category || 'Other') === S.home.cat;
      return true;
    });
    if (terms.length) {
      list = list.map(r => {
        const title = norm(r.title);
        const hay = norm([r.title, r.category, r.from, ...(r.tags || []), ...(r.parts || []).flatMap(p => [p.title, ...(p.ingredients || [])]), ...(r.method || [])].join(' '));
        if (!terms.every(t => hay.includes(t))) return null;
        return { r, score: terms.filter(t => title.includes(t)).length };
      }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.r);
    }
    $('#count').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}${terms.length || S.home.cat ? ' match' : ''}`;
    $('#cards').innerHTML = list.length ? list.map(r => {
      const ings = (r.parts || []).flatMap(p => p.ingredients || []).map(x => parseIng(x).rest || x).slice(0, 7).join(', ');
      return `<a class="card" href="#/r/${encodeURIComponent(r.id)}">
        ${S.favs.has(r.id) ? '<span class="star" aria-label="Favourite">★</span>' : ''}
        <h3>${esc(r.title)}</h3>
        <div class="meta">${esc(r.category || '')}${r.from ? ' · ' + esc(r.from) : ''} ${srcBadge(r)}</div>
        <div class="ings">${esc(ings)}</div></a>`;
    }).join('') : '<p class="empty">Nothing matches. Try fewer words.</p>';
  };
  draw();
  const q = $('#q');
  q.addEventListener('input', () => { S.home.q = q.value; draw(); });
  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    S.home.cat = b.dataset.cat; $$('#cats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  });
  requestAnimationFrame(() => window.scrollTo(0, S.home.scroll || 0));
}

/* --- recipe --- */
function scanThumbs(r) {
  if (!(r.scans || []).length) return '';
  return `<section class="noprint"><h3 class="part-title">Original card${r.scans.length > 1 ? 's' : ''}</h3><div class="scans">${r.scans.map((s, i) =>
    `<button data-scan="${i}" aria-label="View original card ${i + 1}"><img loading="lazy" src="scans/${encodeURIComponent(s)}" alt="Original recipe card ${i + 1}"></button>`).join('')}</div></section>`;
}
function openScans(r, start = 0) {
  const lb = $('#lightbox');
  const order = [...r.scans.slice(start), ...r.scans.slice(0, start)];
  $('.lb-body', lb).innerHTML = order.map(s => `<img src="scans/${encodeURIComponent(s)}" alt="Original recipe card">`).join('');
  lb.showModal();
}

function panOptions(selected) {
  return S.pans.map(p => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}
function matOptions(selected) {
  return Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
}
function customDims(prefix, p) {
  if (!p.custom) return '';
  return p.shape === 'rect'
    ? `<div class="dims">Size <input type="number" step="0.25" min="1" data-dim="${prefix}l" value="${p.l}"> × <input type="number" step="0.25" min="1" data-dim="${prefix}w" value="${p.w}"> in, <input type="number" step="0.25" min="0.5" data-dim="${prefix}h" value="${p.h}"> in deep</div>`
    : `<div class="dims">Diameter <input type="number" step="0.25" min="1" data-dim="${prefix}d" value="${p.d}"> in, <input type="number" step="0.25" min="0.5" data-dim="${prefix}h" value="${p.h}"> in deep</div>`;
}
function resultHtml(est, o) {
  const temp = tempStr(est.temp, est.unit);
  const lines = [];
  if (est.countLabel && o.to.shape !== 'sheet') {
    const what = o.to.shape === 'muffin' ? `Fills about <b>${est.countLabel}</b>` : `Use <b>${est.countLabel}</b>`;
    lines.push(`${what}, batter about ${est.depth.toFixed(1)} in deep (${Math.round(est.fill * 100)}% full).`);
  }
  lines.push(...est.notes);
  return `<div class="result" aria-live="polite">
    <div class="big">${esc(temp)} · ${esc(minsStr(est.lo, est.hi))}</div>
    <div>Start checking at <b>${est.check} min</b> — a toothpick in the centre should come out clean.</div>
    <ul>${lines.map(l => `<li>${l}</li>`).join('')}${est.warnings.map(w => `<li class="warn">${esc(w)}</li>`).join('')}</ul>
  </div>`;
}

function viewRecipe(id) {
  const r = S.byId.get(id);
  if (!r) { app().innerHTML = `<p class="empty">That recipe isn't here. <a href="#/">Back to all recipes</a></p>`; return; }
  setNav(''); setTitle(r.title);
  const base = baseServings(r);
  const st = { scale: 1, servings: base, bake: null };
  if (r.bake && r.bake.pan && S.panById.get(r.bake.pan)) {
    const from = S.panById.get(r.bake.pan);
    st.bake = { to: { ...from }, toCount: from.shape === 'muffin' ? 0 : (r.bake.count || 1), fromMat: 'light', toMat: 'light' };
  }
  const fav = () => S.favs.has(r.id);
  const shell = () => `
    <div class="crumbs"><a href="#/">← All recipes</a>${r.category ? ` · <a href="#/" data-cat="${esc(r.category)}">${esc(r.category)}</a>` : ''}</div>
    <div class="rhead">
      <div>
        <h1>${esc(r.title)}</h1>
        <p class="sub">${[r.serves ? `Serves/makes ${esc(r.serves)}` : '', r.from ? `From ${esc(r.from)}` : '', srcBadge(r)].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="ractions">
        <button class="btn" id="fav" aria-pressed="${fav()}">${fav() ? '★ Favourite' : '☆ Favourite'}</button>
        <button class="btn" id="share">Share link</button>
        <a class="btn" href="#/edit/${encodeURIComponent(r.id)}">${r._src === 'mine' ? 'Edit' : 'Suggest a fix'}</a>
        <button class="btn" id="print">Print</button>
      </div>
    </div>
    <div class="controls">
      <label>${base ? 'Makes' : 'Batch ×'} <input type="number" id="servings" min="0.25" step="${base ? 1 : 0.5}" value="${base || 1}"> ${base ? esc(String(r.serves).replace(/^[^\d]*\d+(?:\.\d+)?\s*/, '') || 'servings') : ''}</label>
      <span class="scaled-note" id="scalenote"></span>
      <div class="ctl-group">Units
        <div class="seg" id="units">
          <button data-u="both" aria-pressed="${S.units === 'both'}">As written + metric</button>
          <button data-u="us" aria-pressed="${S.units === 'us'}">Cups &amp; spoons</button>
          <button data-u="metric" aria-pressed="${S.units === 'metric'}">Grams &amp; mL</button>
        </div>
      </div>
      <div class="ctl-group">View
        <div class="seg" id="view">
          <button data-v="table" aria-pressed="${S.view === 'table'}">Table</button>
          <button data-v="list" aria-pressed="${S.view === 'list'}">List</button>
        </div>
      </div>
    </div>
    ${st.bake ? `<details class="bakebox" id="bakebox"><summary>Changing the pan? <span class="orig">Recipe uses ${esc(panLabel(S.panById.get(r.bake.pan), r.bake.count))} · ${esc(tempStr(r.bake.temp, r.bake.unit))} · ${esc(minsStr(r.bake.min, r.bake.max))}</span></summary><div class="bakebody" id="bakebody"></div></details>` : ''}
    <div id="rbody"></div>
    ${scanThumbs(r)}`;
  app().innerHTML = shell();

  const estFor = () => {
    if (!st.bake) return null;
    const from = S.panById.get(r.bake.pan);
    return estimate({ from, fromCount: r.bake.count || 1, fromMat: st.bake.fromMat, to: st.bake.to, toCount: st.bake.toCount, toMat: st.bake.toMat, scale: st.scale, temp: r.bake.temp, unit: r.bake.unit, tMin: r.bake.min, tMax: r.bake.max });
  };
  const drawBody = () => {
    const est = estFor();
    const ctx = { scale: st.scale, units: S.units, view: S.view, est };
    $('#rbody').innerHTML = recipeBodyHtml(r, ctx);
    $('#scalenote').textContent = st.scale !== 1 ? `Quantities × ${+st.scale.toFixed(2)}` : '';
    if (st.bake) drawBake(est);
  };
  const drawBake = est => {
    const body = $('#bakebody'); if (!body) return;
    const to = st.bake.to;
    const opened = body.dataset.ready;
    if (!opened) {
      body.innerHTML = `
        <div class="bakegrid">
          <label class="field"><span>New pan</span><select id="topan">${panOptions(to.id)}</select></label>
          <label class="field" id="cntwrap"><span>How many pans</span><select id="tocount"><option value="0">Work it out for me</option>${[1, 2, 3, 4].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
          <label class="field"><span>New pan material</span><select id="tomat">${matOptions(st.bake.toMat)}</select></label>
          <label class="field"><span>Recipe's pan was</span><select id="frommat">${matOptions(st.bake.fromMat)}</select></label>
        </div>
        <div id="dimsrow"></div>
        <div id="bakeresult"></div>
        <p class="hint">Estimates scale with batter depth and pan width (a heat-flow model) and the batch size above. Ovens vary — trust the toothpick.</p>`;
      body.dataset.ready = '1';
      $('#tocount', body).value = String(st.bake.toCount);
      body.addEventListener('change', e => {
        if (e.target.id === 'topan') { st.bake.to = { ...S.panById.get(e.target.value) }; st.bake.toCount = 0; $('#tocount', body).value = '0'; }
        if (e.target.id === 'tocount') st.bake.toCount = +e.target.value;
        if (e.target.id === 'tomat') st.bake.toMat = e.target.value;
        if (e.target.id === 'frommat') st.bake.fromMat = e.target.value;
        drawBody();
      });
      body.addEventListener('input', e => {
        const k = e.target.dataset.dim; if (!k) return;
        const v = parseFloat(e.target.value); if (v > 0) { st.bake.to[k.slice(1)] = v; const est2 = estFor(); $('#bakeresult').innerHTML = resultHtml(est2, { to: st.bake.to }); $('#rbody').innerHTML = recipeBodyHtml(r, { scale: st.scale, units: S.units, view: S.view, est: est2 }); }
      });
    }
    $('#cntwrap', body).style.display = to.shape === 'muffin' || to.shape === 'sheet' ? 'none' : '';
    const dr = $('#dimsrow', body);
    if (dr.dataset.pan !== to.id) { dr.innerHTML = customDims('t', to); dr.dataset.pan = to.id; }
    $('#bakeresult', body).innerHTML = resultHtml(est, { to });
  };
  drawBody();

  $('#servings').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!(v > 0)) return;
    st.scale = base ? v / base : v; drawBody();
  });
  $('#units').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.units = b.dataset.u; store.set('units', S.units);
    $$('#units button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawBody();
  });
  $('#view').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.view = b.dataset.v; store.set('view', S.view);
    $$('#view button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawBody();
  });
  $('#fav').addEventListener('click', e => {
    if (fav()) S.favs.delete(r.id); else S.favs.add(r.id);
    store.set('favs', [...S.favs]);
    e.currentTarget.setAttribute('aria-pressed', fav()); e.currentTarget.textContent = fav() ? '★ Favourite' : '☆ Favourite';
  });
  $('#print').addEventListener('click', () => window.print());
  $('#share').addEventListener('click', async () => {
    const url = r._src === 'base' || r._src === 'shared' || r._src === 'corrected'
      ? location.href.split('#')[0] + '#/r/' + encodeURIComponent(r.id)
      : await shareUrl(r);
    toast(await copyText(url) ? 'Link copied — paste it anywhere.' : url);
  });
  const crumbCat = $('.crumbs [data-cat]');
  if (crumbCat) crumbCat.addEventListener('click', () => { S.home.cat = crumbCat.dataset.cat; S.home.q = ''; S.home.scroll = 0; });
  const scansEl = $('.scans');
  if (scansEl) scansEl.addEventListener('click', e => {
    const b = e.target.closest('[data-scan]'); if (b) openScans(r, +b.dataset.scan);
  });
  window.scrollTo(0, 0);
}

/* --- shared link --- */
async function shareUrl(recipe) {
  const clean = cleanRecipe(recipe);
  const json = JSON.stringify(clean);
  let payload;
  if (window.CompressionStream) {
    const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    payload = 'z' + b64url(buf);
  } else payload = 'j' + b64url(new TextEncoder().encode(json));
  return location.href.split('#')[0] + '#/shared/' + payload;
}
function b64url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function decodeShare(payload) {
  const kind = payload[0], bytes = unb64url(payload.slice(1));
  let json;
  if (kind === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    json = await new Response(ds).text();
  } else json = new TextDecoder().decode(bytes);
  return validateRecipe(JSON.parse(json));
}
async function viewShared(payload) {
  setNav('');
  let r;
  try { r = await decodeShare(payload); } catch (e) {
    app().innerHTML = `<p class="empty">This share link looks damaged or incomplete. Ask for it to be sent again.</p>`; return;
  }
  const id = '__shared__';
  S.byId.set(id, { ...r, id, _src: 'shared-link' });
  viewRecipe(id);
  const banner = document.createElement('div');
  banner.className = 'controls';
  banner.innerHTML = `<span>Someone shared this recipe with you.</span><button class="btn primary" id="keep">Save to my recipes</button>`;
  app().prepend(banner);
  $('#keep').addEventListener('click', () => {
    const copy = cleanRecipe(r); copy.id = uniqueId(copy.id || slugify(copy.title));
    saveMine(copy); toast('Saved on this device.'); location.hash = '#/r/' + encodeURIComponent(copy.id);
  });
}

/* ------------------------------------------------------------- tools page */
function viewTools() {
  setNav('tools'); setTitle('Kitchen tools');
  const ingNames = ['all-purpose flour', 'cake flour', 'whole wheat flour', 'granulated sugar', 'brown sugar', 'icing sugar', 'butter', 'shortening', 'vegetable oil', 'milk', 'water', 'whipping cream', 'sour cream', 'honey', 'maple syrup', 'molasses', 'cocoa', 'chocolate chips', 'rolled oats', 'chopped walnuts', 'pecans', 'sliced almonds', 'raisins', 'shredded coconut', 'graham crumbs', 'rice', 'cornstarch', 'salt', 'baking soda', 'baking powder', 'cream cheese', 'grated cheddar', 'parmesan', 'peanut butter', 'pumpkin purée', 'mashed banana'];
  app().innerHTML = `
    <h1>Kitchen tools</h1>
    <div class="tools">
      <section class="panel" id="conv">
        <h2>Measure converter</h2>
        <p class="hint">Cups ↔ grams uses a density for each ingredient, the same table the recipes use.</p>
        <div class="row">
          <label class="field"><span>Amount</span><input type="text" id="c-amt" value="1 1/3" inputmode="decimal"></label>
          <label class="field"><span>Unit</span><select id="c-unit">${['cup', 'tbsp', 'tsp', 'ml', 'l', 'floz', 'g', 'kg', 'oz', 'lb'].map(u => `<option value="${u}">${{ cup: 'cups', tbsp: 'tablespoons', tsp: 'teaspoons', ml: 'mL', l: 'litres', floz: 'fluid ounces', g: 'grams', kg: 'kilograms', oz: 'ounces (weight)', lb: 'pounds' }[u]}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Ingredient</span><input type="text" id="c-ing" list="inglist" value="all-purpose flour"><datalist id="inglist">${ingNames.map(n => `<option value="${n}">`).join('')}</datalist></label>
        <div id="c-out"></div>
      </section>
      <section class="panel" id="temp">
        <h2>Oven temperature</h2>
        <div class="row">
          <label class="field"><span>°F</span><input type="number" id="t-f" value="350" step="5"></label>
          <label class="field"><span>°C</span><input type="number" id="t-c" value="175" step="5"></label>
        </div>
        <table class="simple" style="margin-top:12px"><tr><th>°F</th><th>°C</th><th>Gas</th><th></th></tr>
          ${[[250, '½', 'very slow'], [275, 1, 'slow'], [300, 2, 'slow'], [325, 3, 'moderately slow'], [350, 4, 'moderate'], [375, 5, 'moderately hot'], [400, 6, 'hot'], [425, 7, 'hot'], [450, 8, 'very hot'], [475, 9, 'very hot']].map(([f, g, w]) => `<tr><td>${f}</td><td>${f2c(f)}</td><td>${g}</td><td>${w}</td></tr>`).join('')}
        </table>
      </section>
      <section class="panel wide" id="est">
        <h2>Bake-time estimator</h2>
        <p class="hint">For any recipe: tell it the original pan and time, then the pan you want to use.</p>
        <div class="bakegrid">
          <label class="field"><span>Recipe's pan</span><select id="e-from">${panOptions('loaf-9')}</select></label>
          <label class="field"><span>How many</span><input type="number" id="e-fromcount" min="1" value="1"></label>
          <label class="field"><span>Recipe's material</span><select id="e-frommat">${matOptions('light')}</select></label>
          <label class="field"><span>Oven</span><div class="row"><input type="number" id="e-temp" value="350" step="5"><select id="e-unit"><option>F</option><option>C</option></select></div></label>
          <label class="field"><span>Recipe time (min)</span><div class="row"><input type="number" id="e-tmin" value="55" min="1"><input type="number" id="e-tmax" value="60" min="1"></div></label>
          <label class="field"><span>Batch size ×</span><input type="number" id="e-scale" value="1" min="0.25" step="0.25"></label>
        </div>
        <div id="e-fromdims"></div>
        <div class="bakegrid">
          <label class="field"><span>New pan</span><select id="e-to">${panOptions('muffin')}</select></label>
          <label class="field" id="e-cntwrap"><span>How many new pans</span><select id="e-tocount"><option value="0">Work it out for me</option>${[1, 2, 3, 4].map(n => `<option>${n}</option>`).join('')}</select></label>
          <label class="field"><span>New material</span><select id="e-tomat">${matOptions('light')}</select></label>
        </div>
        <div id="e-todims"></div>
        <div id="e-out" style="margin-top:12px"></div>
      </section>
      <section class="panel wide">
        <h2>Pan sizes at a glance</h2>
        <p class="hint">Pans with similar area and depth can be swapped without changing the time much.</p>
        <div class="gridwrap"><table class="simple"><tr><th>Pan</th><th>Area (sq in)</th><th>Holds (cups, to the brim)</th></tr>
        ${S.pans.filter(p => !p.custom && p.shape !== 'sheet').map(p => { const a = panArea(p); return `<tr><td>${esc(p.name)}</td><td>${Math.round(a)}${p.shape === 'muffin' ? ' each' : ''}</td><td>${+(a * p.h / 14.44).toFixed(p.shape === 'muffin' ? 2 : 0)}</td></tr>`; }).join('')}
        </table></div>
      </section>
    </div>`;

  const conv = () => {
    const amt = parseIng($('#c-amt').value + ' x');
    const q = amt.qty, u = $('#c-unit').value, ing = $('#c-ing').value;
    const out = $('#c-out');
    if (q == null) { out.innerHTML = '<p class="hint">Type an amount like 1, 2.5, 1 1/3 or ¾.</p>'; return; }
    const dens = density(ing);
    const dim = VOL_CUPS[u] ? 'vol' : 'wt';
    const baseV = dim === 'vol' ? q * VOL_CUPS[u] : null;
    const g = dim === 'wt' ? q * WT_G[u] : (dens ? baseV * dens.g : null);
    const cups = dim === 'vol' ? baseV : (dens ? g / dens.g : null);
    const rows = [];
    if (cups != null) {
      rows.push(['Cups & spoons', usVol(cups)]);
      rows.push(['Millilitres', fmtMl(cups * 250)]);
      rows.push(['Tablespoons', `${+(cups * 16).toFixed(1)} tbsp`]);
    }
    if (g != null) { rows.push(['Grams', fmtG(g)]); rows.push(['Ounces', fmtOz(g)]); }
    out.innerHTML = `<table class="simple" style="margin-top:10px">${rows.map(([a, b]) => `<tr><td>${a}</td><td class="big-out">${esc(b)}</td></tr>`).join('')}</table>
      <p class="hint">${dens ? `Using ${dens.g} g per cup for “${esc(ing)}”.` : `No density on file for “${esc(ing)}”, so only ${dim === 'vol' ? 'volume' : 'weight'} conversions are shown.`}</p>`;
  };
  ['c-amt', 'c-unit', 'c-ing'].forEach(id => $('#' + id).addEventListener('input', conv)); conv();

  $('#t-f').addEventListener('input', e => { $('#t-c').value = Math.round((e.target.value - 32) * 5 / 9); });
  $('#t-c').addEventListener('input', e => { $('#t-f').value = Math.round(e.target.value * 9 / 5 + 32); });

  const E = { from: { ...S.panById.get('loaf-9') }, to: { ...S.panById.get('muffin') } };
  const est = () => {
    $('#e-cntwrap').style.display = E.to.shape === 'muffin' || E.to.shape === 'sheet' ? 'none' : '';
    const o = {
      from: E.from, fromCount: +$('#e-fromcount').value || 1, fromMat: $('#e-frommat').value,
      to: E.to, toCount: +$('#e-tocount').value || 0, toMat: $('#e-tomat').value,
      scale: +$('#e-scale').value || 1, temp: +$('#e-temp').value || 350, unit: $('#e-unit').value,
      tMin: +$('#e-tmin').value || 1, tMax: Math.max(+$('#e-tmax').value || 0, +$('#e-tmin').value || 1),
    };
    $('#e-out').innerHTML = resultHtml(estimate(o), o);
  };
  const sec = $('#est');
  sec.addEventListener('change', e => {
    if (e.target.id === 'e-from') { E.from = { ...S.panById.get(e.target.value) }; $('#e-fromdims').innerHTML = customDims('f', E.from); }
    if (e.target.id === 'e-to') { E.to = { ...S.panById.get(e.target.value) }; $('#e-todims').innerHTML = customDims('t', E.to); }
    est();
  });
  sec.addEventListener('input', e => {
    const k = e.target.dataset.dim;
    if (k) { const v = parseFloat(e.target.value); if (v > 0) (k[0] === 'f' ? E.from : E.to)[k.slice(1)] = v; }
    est();
  });
  est();
}

/* -------------------------------------------------------- my recipes I/O */
function cleanRecipe(r) {
  const out = {};
  for (const k of ['id', 'title', 'category', 'serves', 'from', 'tags', 'pre', 'parts', 'method', 'notes', 'bake', 'scans']) {
    const v = r[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  out.parts = (out.parts || []).map(p => {
    const q = { ingredients: (p.ingredients || []).filter(x => String(x).trim()), steps: (p.steps || []).map(s => ({ t: s.t, in: s.in || [] })) };
    if (p.title) q.title = p.title;
    return q;
  });
  return out;
}
function validateRecipe(r) {
  if (!r || typeof r !== 'object' || typeof r.title !== 'string' || !r.title.trim()) throw new Error('Recipe needs a title');
  const str = v => typeof v === 'string';
  const arrStr = v => Array.isArray(v) && v.every(str);
  for (const k of ['tags', 'pre', 'method', 'notes', 'scans']) if (r[k] != null && !arrStr(r[k])) throw new Error('Bad ' + k);
  if (!Array.isArray(r.parts)) r.parts = [];
  for (const p of r.parts) {
    if (!arrStr(p.ingredients || [])) throw new Error('Bad ingredients');
    for (const s of p.steps || []) if (!str(s.t) || !arrStr(s.in || [])) throw new Error('Bad step');
  }
  if (r.bake && !(r.bake.temp > 0 && r.bake.min > 0)) delete r.bake;
  if (r.scans) r.scans = r.scans.filter(s => /^[\w.-]+\.(jpe?g|png|webp)$/i.test(s));
  return r;
}
function uniqueId(id) {
  let out = id, n = 2;
  while (S.byId.has(out)) out = `${id}-${n++}`;
  return out;
}
function saveMine(r) {
  S.mine = S.mine.filter(x => x.id !== r.id).concat([cleanRecipe(r)]);
  store.set('mine', S.mine); rebuildIndex();
}

/* ------------------------------------------------------------- import */
/* Turns a recipe copied from a website (schema.org JSON-LD, or plain pasted text)
   into an editor draft, with steps auto-linked to the ingredients they mention. */
const strip = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/\s+/g, ' ').trim();
const STOP = new Set('cup cups tbsp tsp teaspoon teaspoons tablespoon tablespoons large small medium chopped minced diced sliced fresh freshly ground grated whole packed light dark finely coarsely plus more about optional divided softened melted room temperature cold warm hot pieces piece inch inches into each some other taste and the for with or of to'.split(' '));
function ingKeys(raw) {
  const name = norm(parseIng(raw).rest || raw).replace(/\([^)]*\)/g, ' ').split(/,| - | – /)[0];
  const words = name.split(/[^a-z]+/).filter(w => w.length > 2 && !STOP.has(w));
  const keys = new Set(words);
  words.forEach(w => { if (w.endsWith('es')) keys.add(w.slice(0, -2)); if (w.endsWith('s')) keys.add(w.slice(0, -1)); });
  return [...keys];
}
function guessBake(steps) {
  const T = /(\d{3})\s*(?:°|º|degrees)?\s*([FC])\b/i, T2 = /(\d{3})\s*(?:°|º)/;
  const anyTemp = steps.map(s => s.match(T) || s.match(T2)).find(Boolean);
  for (const t of steps) {
    if (!/\b(bake|oven|roast)/i.test(t)) continue;
    const time = t.match(/(\d{1,3})\s*(?:-|to|–)\s*(\d{1,3})\s*min/i) || t.match(/(\d{1,3})\s*min/i);
    const temp = t.match(T) || t.match(T2) || anyTemp;
    if (!time || !temp) continue;
    const b = { temp: +temp[1], unit: (temp[2] || 'F').toUpperCase(), min: +time[1], max: +(time[2] || time[1]) };
    if (b.temp < 100 || b.min > 300) continue;
    const all = steps.join(' ').toLowerCase();
    const pans = [[/9\s*[x×]\s*13|13\s*[x×]\s*9/, 'rect-13x9'], [/11\s*[x×]\s*7|7\s*[x×]\s*11/, 'rect-11x7'], [/8\s*[x×]\s*8|8-inch square/, 'square-8'], [/9\s*[x×]\s*9|9-inch square/, 'square-9'],
      [/9\s*[x×]\s*5|loaf/, 'loaf-9'], [/mini muffin/, 'muffin-mini'], [/muffin|cupcake/, 'muffin'], [/bundt|tube pan/, 'bundt-10'], [/springform/, 'springform-9'],
      [/pie (?:plate|dish|pan)|pie shell|pie crust/, 'pie-9'], [/8-inch round|8" round/, 'round-8'], [/9-inch round|9" round|round cake pan/, 'round-9'], [/jelly.?roll/, 'jelly-15x10'], [/baking sheet|cookie sheet|sheet pan/, 'sheet']];
    for (const [re, id] of pans) if (re.test(all)) { b.pan = id; b.count = id.startsWith('muffin') ? 12 : 1; break; }
    return b;
  }
  return null;
}
function draftFrom({ title, ingredients, steps, serves, from, notes, category }) {
  ingredients = ingredients.map(strip).filter(Boolean);
  steps = steps.map(strip).filter(Boolean);
  const pre = [];
  while (steps.length > 1 && pre.length < 3 && /^(preheat|heat (the )?oven|grease|butter (a|an|the)|line (a|an|the)|spray|lightly (grease|oil|butter)|position (a|the) rack)/i.test(steps[0])) pre.push(steps.shift());
  const keys = ingredients.map(ingKeys);
  const used = new Set(), stepObjs = [];
  steps.forEach((t, si) => {
    const low = norm(t), ins = si ? ['s' + (si - 1)] : [];
    keys.forEach((ks, i) => { if (!used.has(i) && ks.some(k => new RegExp('\\b' + k + '\\b').test(low))) { used.add(i); ins.push('i' + i); } });
    stepObjs.push({ t, in: ins });
  });
  const left = ingredients.map((_, i) => i).filter(i => !used.has(i));
  if (stepObjs.length) stepObjs[0].in.push(...left.map(i => 'i' + i));
  const bake = guessBake([...pre, ...steps]);
  if (bake) {
    const bi = stepObjs.findIndex(s => /\b(bake|oven)\b/i.test(s.t) && /\d{3}/.test(s.t));
    if (bi >= 0 && stepObjs[bi].t.length < 60) stepObjs[bi].t = '{bake}';
  }
  return {
    title: strip(title), category: category || '', serves: strip(serves), from: strip(from), pre, method: [],
    notes: (notes || []).map(strip).filter(Boolean), bake: bake || undefined,
    parts: [{ title: '', ingredients, steps: stepObjs }],
  };
}
function findRecipeLd(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeLd(n); if (r) return r; } return null; }
  const t = node['@type']; if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipeLd(node['@graph']) || null;
}
function ldSteps(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') return ins.split(/\n+|(?<=\.)\s+(?=[A-Z])/).filter(s => s.trim());
  if (Array.isArray(ins)) return ins.flatMap(ldSteps);
  if (ins['@type'] === 'HowToSection') return ldSteps(ins.itemListElement).map((s, i) => i === 0 && ins.name ? `${ins.name}: ${s}` : s);
  return [ins.text || ins.name || ''];
}
function draftFromLd(r, url) {
  const host = (() => { try { return new URL(url || r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const y = Array.isArray(r.recipeYield) ? r.recipeYield[r.recipeYield.length - 1] : r.recipeYield;
  const d = draftFrom({ title: r.name, ingredients: [].concat(r.recipeIngredient || r.ingredients || []), steps: ldSteps(r.recipeInstructions),
    serves: y ? String(y) : '', from: host || (r.author && (r.author.name || r.author[0]?.name)) || '',
    notes: url || r.url ? ['Source: ' + (url || r.url)] : [] });
  const cat = strip([].concat(r.recipeCategory || [])[0] || '');
  const map = [[/cookie/i, 'Cookies'], [/cake|cupcake/i, 'Cakes'], [/bar|square|brownie/i, 'Bars & Squares'], [/bread|muffin|scone|biscuit/i, 'Breads & Muffins'], [/breakfast|brunch/i, 'Breakfast'], [/dessert/i, 'Desserts'], [/pie|tart/i, 'Pies & Tarts'], [/salad/i, 'Salads & Dressings'], [/soup|stew/i, 'Soups & Stews'], [/side/i, 'Sides & Vegetables'], [/appeti|snack/i, 'Appetizers']];
  const text = cat + ' ' + d.title;
  for (const [re, c] of map) if (re.test(text)) { d.category = c; break; }
  if (!d.category && /chicken|turkey/i.test(d.title)) d.category = 'Chicken & Poultry';
  return d;
}
function draftFromText(text) {
  const raw = String(text || '').trim();
  if (/^[[{]/.test(raw) || /application\/ld\+json/i.test(raw)) {
    const blocks = /application\/ld\+json/i.test(raw) ? [...raw.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]) : [raw];
    for (const b of blocks) { try { const r = findRecipeLd(JSON.parse(b)); if (r) return draftFromLd(r); } catch { /* not JSON */ } }
  }
  const JUNK = /^(print|pin|save|share|rate|jump to recipe|watch|video|advertisement|nutrition|calories|cook mode|prevent your screen|\d+ reviews?|★|☆)/i;
  const lines = raw.split(/\r?\n/).map(l => l.replace(/^[\s▢☐□•●◦▪\-–*]+/, '').trim()).filter(l => l && !JUNK.test(l));
  const isIngHead = l => /^(ingredients?)\s*:?$/i.test(l);
  const isStepHead = l => /^(directions?|instructions?|method|preparation|steps?|how to make( it)?)\s*:?$/i.test(l);
  const isServ = l => /^(serves|servings|yield|makes)\b/i.test(l);
  let title = '', serves = '', mode = '', ings = [], steps = [], notes = [];
  const hasHeads = lines.some(isIngHead) && lines.some(isStepHead);
  for (const l of lines) {
    if (isIngHead(l)) { mode = 'i'; continue; }
    if (isStepHead(l)) { mode = 's'; continue; }
    if (/^(notes?|tips?)\s*:?$/i.test(l)) { mode = 'n'; continue; }
    if (isServ(l)) { serves = l.replace(/^(serves|servings|yield|makes)\s*:?\s*/i, ''); continue; }
    const looksIng = /^[\d½¼¾⅓⅔⅛]/.test(l) && l.length < 120 && !/^\d+[.)]\s/.test(l);
    if (!hasHeads && !mode) mode = looksIng ? 'i' : '';
    if (!mode) { if (!title && l.length < 90) title = l; continue; }
    if (mode === 'i') {
      if (!hasHeads && !looksIng && l.length > 60) { mode = 's'; steps.push(l); continue; }
      if (/:$/.test(l) && l.length < 50) continue; // "For the frosting:" sub-headings
      ings.push(l);
    } else if (mode === 's') {
      const s = l.replace(/^(step\s*)?\d+[.):]?\s*/i, '');
      if (s && !/^step\s*\d*$/i.test(s)) steps.push(s);
    } else notes.push(l);
  }
  return draftFrom({ title, ingredients: ings, steps, serves, notes });
}

/* Bookmarklet: runs on a recipe website, reads its recipe data and opens it here. */
function bookmarkletSource(base) {
  const fn = function (BASE) {
    var r = null;
    function find(n) { if (!n || typeof n !== 'object') return null; if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) { var x = find(n[i]); if (x) return x; } return null; } var t = n['@type']; if (t === 'Recipe' || (Array.isArray(t) && t.indexOf('Recipe') >= 0)) return n; return find(n['@graph']); }
    var ss = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ss.length && !r; i++) { try { r = find(JSON.parse(ss[i].textContent)); } catch (e) { /* skip */ } }
    var data;
    if (r) { r.url = location.href; data = { ld: r }; } else {
      var sel = String(window.getSelection() || '');
      if (!sel) { alert('No recipe data found on this page. Select the recipe text first, then click the bookmark again.'); return; }
      data = { text: document.title + '\n' + sel, url: location.href };
    }
    var json = JSON.stringify(data), b = new TextEncoder().encode(json), s = '';
    for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]);
    window.open(BASE + '#/import/' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), '_blank');
  };
  return 'javascript:' + encodeURIComponent('(' + fn.toString().replace(/\s+/g, ' ') + ')(' + JSON.stringify(base) + ')');
}
function viewImport(payload) {
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    const d = data.ld ? draftFromLd(data.ld, data.ld.url) : draftFromText(data.text || '');
    if (data.url && !data.ld) d.notes.push('Source: ' + data.url);
    viewEditor(null, d, 'Imported — check the ingredients and steps, then save.');
  } catch { app().innerHTML = '<p class="empty">That import link didn’t come through. Try the bookmark again, or paste the recipe on the Add recipe page.</p>'; }
}

/* ------------------------------------------------------------- editor */
const CATEGORIES = ['Appetizers', 'Beef', 'Bars & Squares', 'Breads & Muffins', 'Breakfast', 'Cakes', 'Candy & Fudge', 'Chicken & Poultry', 'Cookies', 'Desserts', 'Drinks', 'Fish & Seafood', 'Icings & Sauces', 'Lamb', 'Pasta & Rice', 'Pies & Tarts', 'Pork', 'Preserves & Pickles', 'Salads & Dressings', 'Sauces & Marinades', 'Sides & Vegetables', 'Soups & Stews', 'Veal', 'Other'];

function viewEditor(id, prefill, banner) {
  const existing = id ? S.byId.get(id) : null;
  setNav(id ? '' : 'add'); setTitle(existing ? `Edit ${existing.title}` : 'Add a recipe');
  const D = existing ? JSON.parse(JSON.stringify(cleanRecipe(existing))) : prefill ? prefill : {
    title: '', category: '', serves: '', from: '', pre: [], notes: [], method: [],
    parts: [{ title: '', ingredients: [], steps: [] }],
  };
  if (!D.bake) delete D.bake;
  ['pre', 'notes', 'method'].forEach(k => { if (!Array.isArray(D[k])) D[k] = []; });
  if (!D.parts || !D.parts.length) D.parts = [{ title: '', ingredients: [], steps: [] }];
  const cats = [...new Set([...CATEGORIES, ...S.recipes.map(r => r.category).filter(Boolean)])].sort();
  const editingBase = existing && existing._src !== 'mine';

  app().innerHTML = `
    <div class="crumbs"><a href="${existing ? '#/r/' + encodeURIComponent(existing.id) : '#/'}">← ${existing ? 'Back to recipe' : 'All recipes'}</a></div>
    <h1>${existing ? (editingBase ? 'Suggest a fix' : 'Edit recipe') : 'Add a recipe'}</h1>
    ${editingBase ? '<p class="hint">Change whatever is wrong, then submit it to the family cookbook. Once it’s merged everyone sees the corrected version.</p>' : '<p class="hint">Type the ingredients, then build the steps by picking which ingredients go into each one. The table preview fills in as you go.</p>'}
    ${banner ? `<div class="controls"><b>${esc(banner)}</b> <span class="hint">Each step was linked to the ingredients it mentions; tap the chips to move any that landed in the wrong step.</span></div>` : ''}
    ${!existing && !prefill ? `<details class="bakebox" id="importbox"><summary>Copying a recipe from a website? <span class="orig">Paste it here and the form fills itself in</span></summary><div class="bakebody">
      <label class="field"><span>Paste the recipe</span><textarea id="imp-text" rows="7" placeholder="On the recipe website, select everything from the title down to the last step, copy it, and paste it here."></textarea></label>
      <div class="btnrow"><button class="btn primary" id="imp-go">Fill in the form</button></div>
      <p class="hint">On a computer it’s even quicker: add the <a href="#/settings">“Add to Munro Recipes” bookmark</a>, then click it on any recipe page.</p>
    </div></details>` : ''}
    <div class="editor">
      <div class="panel">
        <label class="field"><span>Recipe name</span><input type="text" id="d-title" value="${esc(D.title)}" placeholder="e.g. Grandma's Banana Bread"></label>
        <div class="row">
          <label class="field"><span>Category</span><input type="text" id="d-cat" list="catlist" value="${esc(D.category || '')}"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
          <label class="field"><span>Serves / makes</span><input type="text" id="d-serves" value="${esc(D.serves || '')}" placeholder="8, or 3 dozen"></label>
          <label class="field"><span>From</span><input type="text" id="d-from" value="${esc(D.from || '')}" placeholder="Mom, a magazine…"></label>
        </div>
        <label class="field"><span>Before you start <small>(one per line — e.g. “Preheat oven to 350°F”)</small></span><textarea id="d-pre" rows="2">${esc((D.pre || []).join('\n'))}</textarea></label>
        <div id="d-parts"></div>
        <button class="btn" id="addpart">+ Add another part (e.g. a crust or icing)</button>
        <fieldset class="ed-part"><legend><b>Baking</b> (optional — turns on the pan &amp; time estimator)</legend>
          <div class="row">
            <label class="field"><span>Oven</span><input type="number" id="b-temp" value="${D.bake ? D.bake.temp : ''}" placeholder="350"></label>
            <label class="field"><span>°F/°C</span><select id="b-unit"><option${!D.bake || D.bake.unit === 'F' ? ' selected' : ''}>F</option><option${D.bake && D.bake.unit === 'C' ? ' selected' : ''}>C</option></select></label>
            <label class="field"><span>Minutes</span><input type="number" id="b-min" value="${D.bake ? D.bake.min : ''}" placeholder="55"></label>
            <label class="field"><span>to</span><input type="number" id="b-max" value="${D.bake ? D.bake.max : ''}" placeholder="60"></label>
          </div>
          <div class="row">
            <label class="field"><span>Pan</span><select id="b-pan"><option value="">—</option>${panOptions(D.bake && D.bake.pan)}</select></label>
            <label class="field"><span>How many (cups for muffins)</span><input type="number" id="b-count" min="1" value="${D.bake ? D.bake.count || 1 : 1}"></label>
          </div>
          <p class="hint">Write <code>{bake}</code> in a step to show the oven temperature and time there (it updates when someone changes the pan).</p>
        </fieldset>
        <label class="field"><span>Method notes <small>(optional, free text; one paragraph per line)</small></span><textarea id="d-method" rows="3">${esc((D.method || []).join('\n'))}</textarea></label>
        <label class="field"><span>Tips &amp; notes</span><textarea id="d-notes" rows="2">${esc((D.notes || []).join('\n'))}</textarea></label>
        <ul class="problems" id="problems"></ul>
        <div class="btnrow">
          ${editingBase ? '' : '<button class="btn primary" id="save">Save on this device</button>'}
          <button class="btn ${editingBase ? 'primary' : ''}" id="submit">Submit to family cookbook</button>
          ${store.get('token', '') ? '<button class="btn" id="publish">Publish now (editor)</button>' : ''}
          <button class="btn" id="sharelink">Copy share link</button>
          <button class="btn" id="dl">Download file</button>
          ${existing && existing._src === 'mine' ? '<button class="btn" id="del">Delete from this device</button>' : ''}
        </div>
        <p class="hint" id="submit-hint"></p>
      </div>
      <div class="panel preview"><h2 id="pv-title">Preview</h2><div id="preview"></div></div>
    </div>`;

  const lines = v => v.split('\n').map(s => s.trim()).filter(Boolean);
  let pvTimer;
  const preview = () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      $('#pv-title').textContent = D.title || 'Preview';
      $('#preview').innerHTML = recipeBodyHtml(D, { scale: 1, units: S.units, view: 'table' }) || '<p class="hint">Nothing to show yet.</p>';
      $('#problems').innerHTML = problems().map(p => `<li>${esc(p)}</li>`).join('');
    }, 120);
  };
  const problems = () => {
    const out = [];
    if (!D.title.trim()) out.push('Give the recipe a name.');
    D.parts.forEach((p, pi) => {
      const name = D.parts.length > 1 ? `“${p.title || 'Part ' + (pi + 1)}”: ` : '';
      if (!p.ingredients.length && !p.steps.length) out.push(name + 'add some ingredients.');
      if (p.steps.length) {
        const un = unusedIngs(p);
        if (un.length) out.push(name + `not used in any step yet: ${un.map(i => parseIng(p.ingredients[i]).rest || p.ingredients[i]).join(', ')}.`);
        const roots = rootsOf(p);
        if (roots.length > 1) out.push(name + `steps ${roots.map(i => i + 1).join(', ')} never come together — pick them as inputs to a later step so the table ends in one final step.`);
        p.steps.forEach((s, si) => { if (!s.t.trim()) out.push(name + `step ${si + 1} needs a word or two (e.g. “mix”).`); });
      }
    });
    return out;
  };

  const usedBy = (pi) => {
    // map ref -> step index for this part; and part refs used anywhere
    const m = new Map();
    D.parts[pi].steps.forEach((s, si) => (s.in || []).forEach(r => m.set(r, si)));
    return m;
  };
  const partRefsUsed = () => {
    const m = new Map();
    D.parts.forEach((p, pi) => p.steps.forEach((s, si) => (s.in || []).forEach(r => { if (r[0] === 'p') m.set(r, `${pi}:${si}`); })));
    return m;
  };
  const chipLabel = s => { const p = parseIng(s); const t = p.rest || s; return t.length > 28 ? t.slice(0, 26) + '…' : t; };

  const drawSteps = pi => {
    const p = D.parts[pi];
    const box = $(`#steps-${pi}`); if (!box) return;
    const used = usedBy(pi), pused = partRefsUsed();
    box.innerHTML = p.steps.map((s, si) => {
      const chips = [];
      p.ingredients.forEach((ing, ii) => {
        const ref = 'i' + ii, u = used.get(ref);
        if (u === undefined || u === si) chips.push(`<button class="chip" data-ref="${ref}" aria-pressed="${u === si}" title="${esc(ing)}">${esc(chipLabel(ing))}</button>`);
      });
      for (let k = 0; k < si; k++) {
        const ref = 's' + k, u = used.get(ref);
        if (u === undefined || u === si) chips.push(`<button class="chip step" data-ref="${ref}" aria-pressed="${u === si}">↳ step ${k + 1}: ${esc((p.steps[k].t || '…').slice(0, 20))}</button>`);
      }
      for (let q = 0; q < pi; q++) {
        const ref = 'p' + q, u = pused.get(ref);
        if (u === undefined || u === `${pi}:${si}`) chips.push(`<button class="chip step" data-ref="${ref}" aria-pressed="${u === `${pi}:${si}`}">⬚ ${esc(D.parts[q].title || 'Part ' + (q + 1))}</button>`);
      }
      return `<div class="ed-step" data-si="${si}">
        <div class="ed-step-top"><span class="num">${si + 1}.</span><input type="text" data-steptext value="${esc(s.t)}" placeholder="what to do — e.g. whisk, cream, fold, {bake}"><button class="btn small" data-delstep title="Remove step">✕</button></div>
        <div class="ed-chips">${chips.join('') || '<span class="hint">Nothing left to add — everything is already in a step.</span>'}</div>
      </div>`;
    }).join('') + `<button class="btn small" data-addstep>+ Add step</button>`;
  };
  const drawParts = () => {
    $('#d-parts').innerHTML = D.parts.map((p, pi) => `
      <div class="ed-part" data-pi="${pi}">
        ${D.parts.length > 1 ? `<div class="ed-part-head"><input type="text" data-parttitle value="${esc(p.title || '')}" placeholder="Part name — e.g. Crust, Filling"><button class="btn small" data-delpart>Remove part</button></div>` : ''}
        <label class="field"><span>Ingredients <small>(one per line — “1 1/3 cups all-purpose flour”)</small></span><textarea data-ings rows="${Math.max(4, p.ingredients.length + 1)}">${esc(p.ingredients.join('\n'))}</textarea></label>
        <div><b>Steps</b> <span class="hint">— tap the ingredients (and earlier steps) that go into each step.</span></div>
        <div id="steps-${pi}"></div>
      </div>`).join('');
    D.parts.forEach((_, pi) => drawSteps(pi));
  };
  drawParts(); preview();

  const partsEl = $('#d-parts');
  partsEl.addEventListener('input', e => {
    const pe = e.target.closest('[data-pi]'); if (!pe) return;
    const pi = +pe.dataset.pi, p = D.parts[pi];
    if (e.target.matches('[data-ings]')) {
      const before = p.ingredients.length;
      p.ingredients = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (p.ingredients.length < before) p.steps.forEach(s => { s.in = s.in.filter(r => r[0] !== 'i' || +r.slice(1) < p.ingredients.length); });
      drawSteps(pi);
    } else if (e.target.matches('[data-steptext]')) {
      p.steps[+e.target.closest('[data-si]').dataset.si].t = e.target.value;
    } else if (e.target.matches('[data-parttitle]')) p.title = e.target.value;
    preview();
  });
  partsEl.addEventListener('click', e => {
    const pe = e.target.closest('[data-pi]'); if (!pe) return;
    const pi = +pe.dataset.pi, p = D.parts[pi];
    const chip = e.target.closest('[data-ref]');
    if (chip) {
      const s = p.steps[+chip.closest('[data-si]').dataset.si];
      const ref = chip.dataset.ref;
      s.in = s.in.includes(ref) ? s.in.filter(r => r !== ref) : [...s.in, ref];
      drawSteps(pi); preview(); return;
    }
    if (e.target.closest('[data-addstep]')) {
      const roots = rootsOf(p);
      const prev = p.steps.length && roots.includes(p.steps.length - 1) ? ['s' + (p.steps.length - 1)] : [];
      p.steps.push({ t: '', in: prev });
      drawSteps(pi);
      const inputs = $$(`#steps-${pi} [data-steptext]`); inputs[inputs.length - 1].focus();
      preview(); return;
    }
    if (e.target.closest('[data-delstep]')) {
      const si = +e.target.closest('[data-si]').dataset.si;
      p.steps.splice(si, 1);
      p.steps.forEach(s => { s.in = s.in.filter(r => r !== 's' + si).map(r => r[0] === 's' && +r.slice(1) > si ? 's' + (+r.slice(1) - 1) : r); });
      drawSteps(pi); preview(); return;
    }
    if (e.target.closest('[data-delpart]')) {
      D.parts.splice(pi, 1);
      D.parts.forEach(q => q.steps.forEach(s => { s.in = s.in.filter(r => r !== 'p' + pi).map(r => r[0] === 'p' && +r.slice(1) > pi ? 'p' + (+r.slice(1) - 1) : r); }));
      drawParts(); preview();
    }
  });
  const impGo = $('#imp-go');
  if (impGo) impGo.addEventListener('click', () => {
    const d = draftFromText($('#imp-text').value);
    if (!d.parts[0].ingredients.length && !d.parts[0].steps.length) { toast('Couldn’t find ingredients or steps in that text. Make sure the copy includes both.'); return; }
    viewEditor(null, d, 'Filled in from the pasted recipe — check it over, then save.');
    window.scrollTo(0, 0);
  });
  $('#addpart').addEventListener('click', () => { D.parts.push({ title: '', ingredients: [], steps: [] }); drawParts(); preview(); });
  const bind = (sel, fn) => $(sel).addEventListener('input', e => { fn(e.target.value); preview(); });
  bind('#d-title', v => D.title = v);
  bind('#d-cat', v => D.category = v.trim());
  bind('#d-serves', v => D.serves = v.trim());
  bind('#d-from', v => D.from = v.trim());
  bind('#d-pre', v => D.pre = lines(v));
  bind('#d-method', v => D.method = lines(v));
  bind('#d-notes', v => D.notes = lines(v));
  const bakeSync = () => {
    const t = +$('#b-temp').value, a = +$('#b-min').value, b = +$('#b-max').value || a, pan = $('#b-pan').value;
    if (t > 0 && a > 0) { D.bake = { temp: t, unit: $('#b-unit').value, min: a, max: Math.max(a, b) }; if (pan) { D.bake.pan = pan; D.bake.count = +$('#b-count').value || 1; } }
    else delete D.bake;
    preview();
  };
  ['#b-temp', '#b-unit', '#b-min', '#b-max', '#b-pan', '#b-count'].forEach(s => { $(s).addEventListener('input', bakeSync); $(s).addEventListener('change', bakeSync); });

  const finalRecipe = () => {
    const r = cleanRecipe(D);
    r.title = r.title.trim();
    if (existing) r.id = existing.id;
    else r.id = uniqueId(slugify(r.title));
    return r;
  };
  const ready = () => {
    const pr = problems();
    if (!D.title.trim()) { toast('Give the recipe a name first.'); return false; }
    if (pr.length && !confirmInline(pr)) return false;
    return true;
  };
  let warnedOnce = false;
  const confirmInline = () => {
    if (warnedOnce) return true;
    warnedOnce = true; toast('A few things to check (listed above). Press again to go ahead anyway.');
    return false;
  };
  const save = $('#save');
  if (save) save.addEventListener('click', () => {
    if (!ready()) return;
    const r = finalRecipe(); saveMine(r); toast('Saved on this device.'); location.hash = '#/r/' + encodeURIComponent(r.id);
  });
  $('#submit').addEventListener('click', async () => {
    if (!ready()) return;
    const r = finalRecipe();
    if (!REPO_OK) { $('#submit-hint').innerHTML = 'Sharing isn’t set up yet: put the GitHub repository name in <code>config.js</code>. Meanwhile, use “Copy share link”.'; return; }
    const res = await openIssue(r, !!existing && existing._src !== 'mine');
    $('#submit-hint').innerHTML = res;
    if (!existing) saveMine(r);
  });
  const pub = $('#publish');
  if (pub) pub.addEventListener('click', async () => {
    if (!ready()) return;
    const r = finalRecipe();
    pub.disabled = true; pub.textContent = 'Publishing…';
    try {
      await publishDirect(r);
      S.community = S.community.filter(x => x.id !== r.id).concat([r]);
      S.mine = S.mine.filter(x => x.id !== r.id); store.set('mine', S.mine);
      rebuildIndex(); toast('Published. Everyone will see it within a minute or two.');
      location.hash = '#/r/' + encodeURIComponent(r.id);
    } catch (err) { toast('Couldn’t publish: ' + err.message); pub.disabled = false; pub.textContent = 'Publish now (editor)'; }
  });
  $('#sharelink').addEventListener('click', async () => {
    if (!D.title.trim()) { toast('Give the recipe a name first.'); return; }
    toast(await copyText(await shareUrl(finalRecipe())) ? 'Share link copied.' : 'Couldn’t copy the link.');
  });
  $('#dl').addEventListener('click', () => {
    const r = finalRecipe();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = r.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const del = $('#del');
  if (del) del.addEventListener('click', () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Press again to delete'; return; }
    S.mine = S.mine.filter(x => x.id !== existing.id); store.set('mine', S.mine); rebuildIndex();
    toast('Deleted.'); location.hash = '#/';
  });
}

/* ------------------------------------------------------------ GitHub */
async function openIssue(r, isFix) {
  const json = JSON.stringify(r, null, 1);
  const title = `${isFix ? 'Recipe fix' : 'Recipe'}: ${r.title}`;
  const intro = `<!-- cookbook-recipe -->\n${isFix ? 'Correction to an existing recipe' : 'New recipe'} submitted from the cookbook site. The block below is read automatically — please leave it as is.\n\n`;
  const body = intro + '```json\n' + json + '\n```\n';
  const base = `https://github.com/${CFG.repo}/issues/new`;
  let url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  if (url.length > 7800) {
    await copyText('```json\n' + json + '\n```');
    url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(intro + '(Paste here — the recipe was copied to your clipboard.)\n')}`;
    window.open(url, '_blank', 'noopener');
    return 'This recipe is long, so it was copied to your clipboard. Paste it into the GitHub page that just opened, then press “Create”.';
  }
  window.open(url, '_blank', 'noopener');
  return 'A GitHub page opened with the recipe filled in — press <b>Create</b> (you need a free GitHub account). It’s added to the site automatically once approved. Until then it’s saved on this device.';
}
function utf8b64(str) { return b64std(new TextEncoder().encode(str)); }
function b64std(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function publishDirect(r) {
  const token = store.get('token', '');
  if (!token || !REPO_OK) throw new Error('set your token and repository first');
  const api = `https://api.github.com/repos/${CFG.repo}/contents/data/community.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha, list = [];
  const g = await fetch(`${api}?ref=${encodeURIComponent(CFG.branch)}`, { headers, cache: 'no-store' });
  if (g.ok) {
    const j = await g.json(); sha = j.sha;
    const bytes = Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    list = JSON.parse(new TextDecoder().decode(bytes) || '[]');
  } else if (g.status !== 404) throw new Error(`GitHub said ${g.status}`);
  list = list.filter(x => x.id !== r.id).concat([r]).sort((a, b) => a.title.localeCompare(b.title));
  const put = await fetch(api, {
    method: 'PUT', headers,
    body: JSON.stringify({ message: `Add/update recipe: ${r.title}`, content: utf8b64(JSON.stringify(list, null, 1) + '\n'), sha, branch: CFG.branch }),
  });
  if (!put.ok) throw new Error(`GitHub said ${put.status}${put.status === 401 || put.status === 403 ? ' (check the token)' : ''}`);
}

/* ------------------------------------------------------------ settings */
function viewSettings() {
  setNav(''); setTitle('Settings');
  const theme = store.get('theme', 'auto');
  app().innerHTML = `
    <h1>Settings &amp; sharing</h1>
    <div class="tools">
      <section class="panel">
        <h2>Appearance</h2>
        <label class="field"><span>Theme</span><select id="theme"><option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </section>
      <section class="panel">
        <h2>How sharing works</h2>
        <p>Recipes you add are saved <b>on this device</b> right away. To put one in the shared family cookbook, press <b>Submit to family cookbook</b>: it opens a GitHub page with the recipe filled in. After it is approved, it shows up for everyone.</p>
        <p class="hint">Repository: <code>${esc(CFG.repo)}</code>${REPO_OK ? '' : ' — not set yet. Edit <code>config.js</code>.'}</p>
      </section>
      <section class="panel wide">
        <h2>Add recipes from other websites</h2>
        <p>Drag this button to your browser’s bookmarks bar: <a class="btn primary" id="bm" href="${esc(bookmarkletSource(location.href.split('#')[0]))}" draggable="true" onclick="event.preventDefault()">+ Add to Munro Recipes</a></p>
        <p class="hint">Then, on any recipe page (Allrecipes, Food Network, Canadian Living, most blogs), click that bookmark. The recipe opens here already filled in, ready to check and save. If a site has no recipe data, select the recipe text first and click it again.</p>
        <p class="hint">Can’t drag it? <button class="btn small" id="bmcopy">Copy the bookmark code</button>, make a new bookmark and paste it as the address. On a phone, use “Copying a recipe from a website?” on the Add recipe page instead.</p>
      </section>
      <section class="panel">
        <h2>Editor access</h2>
        <p class="hint">Cookbook editors can publish instantly with a GitHub fine-grained token that has <b>Contents: read &amp; write</b> on this repository only. It is stored in this browser only.</p>
        <label class="field"><span>GitHub token</span><input type="password" id="token" value="${esc(store.get('token', ''))}" autocomplete="off" placeholder="github_pat_…"></label>
        <div class="btnrow" style="margin-top:8px"><button class="btn" id="savetoken">Save token</button><button class="btn" id="cleartoken">Remove</button></div>
      </section>
      <section class="panel">
        <h2>Recipes on this device</h2>
        <p>${S.mine.length} saved here.</p>
        <div class="btnrow"><button class="btn" id="export">Export as file</button><label class="btn">Import file<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      </section>
    </div>`;
  $('#bmcopy').addEventListener('click', async () => toast(await copyText($('#bm').getAttribute('href')) ? 'Bookmark code copied.' : 'Couldn’t copy — drag the button instead.'));
  $('#theme').value = theme;
  $('#theme').addEventListener('change', e => { store.set('theme', e.target.value); applyTheme(); });
  $('#savetoken').addEventListener('click', () => { store.set('token', $('#token').value.trim()); toast('Token saved in this browser.'); });
  $('#cleartoken').addEventListener('click', () => { store.set('token', ''); $('#token').value = ''; toast('Token removed.'); });
  $('#export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S.mine, null, 1)], { type: 'application/json' }));
    a.download = 'my-recipes.json'; a.click();
  });
  $('#import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let data = JSON.parse(await f.text()); if (!Array.isArray(data)) data = [data];
      let n = 0; for (const r of data) { try { const v = validateRecipe(r); v.id = v.id || slugify(v.title); saveMine(v); n++; } catch { /* skip bad entry */ } }
      toast(`Imported ${n} recipe${n === 1 ? '' : 's'}.`); viewSettings();
    } catch { toast('That file isn’t a recipe export.'); }
  });
}

function viewHelp() {
  setNav(''); setTitle('How the tables work');
  const demo = {
    title: 'Banana Nut Bread', pre: ['Butter and flour a loaf pan', 'Preheat oven to 350°F'],
    bake: { temp: 350, unit: 'F', min: 55, max: 55 },
    parts: [{ ingredients: ['2 large ripe bananas', '6 tbsp butter', '1 tsp vanilla extract', '2 large eggs', '1 1/3 cups all-purpose flour', '2/3 cup sugar', '1/2 tsp baking soda', '1/4 tsp baking powder', '1/2 tsp salt', '1/2 cup chopped walnuts'],
      steps: [{ t: 'mash', in: ['i0'] }, { t: 'melt', in: ['i1'] }, { t: 'lightly beat', in: ['i3'] }, { t: 'mash until smooth', in: ['s0', 's1', 'i2', 's2'] }, { t: 'whisk', in: ['i4', 'i5', 'i6', 'i7', 'i8', 'i9'] }, { t: 'fold', in: ['s3', 's4'] }, { t: '{bake}', in: ['s5'] }, { t: 'cool 10 min in pan', in: ['s6'] }, { t: 'cool on wire rack', in: ['s7'] }] }],
  };
  app().innerHTML = `<div class="help">
    <h1>How to read a recipe table</h1>
    <p>Each recipe is drawn as a table that reads <b>left to right</b>. Ingredients are in the first column. A box to the right of some ingredients is what you do to them; boxes further right combine the results. The last column is the final step.</p>
    ${recipeBodyHtml(demo, { scale: 1, units: S.units, view: 'table' })}
    <p>Here: mash the bananas, melt the butter, beat the eggs, then mash all of that with the vanilla until smooth. Separately, whisk the dry ingredients and walnuts. Fold the two together, bake, and cool.</p>
    <p>Prefer a normal list? Switch any recipe to <b>List</b> view.</p>
    <h2>Units</h2>
    <p><b>As written + metric</b> keeps the card's own measures and adds the other system in grey. <b>Cups &amp; spoons</b> or <b>Grams &amp; mL</b> converts everything. Dry ingredients are weighed using a table of densities (for example, flour 125 g per cup, sugar 200 g, butter 227 g). Metric volumes use the Canadian kitchen standard (1 cup = 250 mL).</p>
    <h2>Changing the pan</h2>
    <p>Baked recipes have a <b>Changing the pan?</b> box. Pick another pan and it works out how many pans or muffin cups you need, how deep the batter will be, and a new time and temperature. The time uses a simple heat-flow model: deeper or wider batter takes longer, shallow pans and muffin cups are quicker. Glass, ceramic and dark pans get the usual 25°F lower oven.</p>
    <h2>Adding recipes</h2>
    <p>Use <b>+ Add recipe</b>. Type the ingredients one per line, then add steps and tap the ingredients each step uses. Anything you save stays on your device; <b>Submit to family cookbook</b> sends it to be added for everyone.</p>
  </div>`;
}

/* -------------------------------------------------------------- router */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, ...rest] = h.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (view !== '' && document.body.dataset.view === 'home') S.home.scroll = window.scrollY;
  document.body.dataset.view = view || 'home';
  if (!view) return viewHome();
  if (view === 'r') return viewRecipe(arg);
  if (view === 'tools') return viewTools();
  if (view === 'add') return viewEditor(null);
  if (view === 'edit') return viewEditor(arg);
  if (view === 'shared') return viewShared(rest.join('/'));
  if (view === 'import') return viewImport(rest.join('/'));
  if (view === 'settings') return viewSettings();
  if (view === 'help') return viewHelp();
  viewHome();
}
function applyTheme() {
  const t = store.get('theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

async function boot() {
  applyTheme();
  $('#brand-title').textContent = CFG.title;
  const get = async (url, fallback) => {
    try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch { return fallback; }
  };
  const [base, community, pans] = await Promise.all([get('data/recipes.json', null), get('data/community.json', []), get('assets/pans.json', [])]);
  if (!base) { app().innerHTML = '<p class="empty">Couldn’t load the recipes. If you opened index.html straight from your computer, use the GitHub Pages address instead (browsers block loading data from local files).</p>'; return; }
  S.base = base;
  S.community = Array.isArray(community) ? community.filter(r => { try { validateRecipe(r); return true; } catch { return false; } }) : [];
  S.pans = pans; S.panById = new Map(pans.map(p => [p.id, p]));
  rebuildIndex();
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { const q = $('#q'); if (q) { e.preventDefault(); q.focus(); } }
  });
  route();
}

// exposed for tests
window.__cookbook = { draftFromText, draftFromLd, bookmarkletSource, parseIng, fmtIng, density, usVol, estimate, tempify, recipeBodyHtml, S, panArea };
boot();
})();
