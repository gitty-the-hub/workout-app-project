/* Match a routine's exercise names against the local catalog.

   The ladder, cheapest rung first:
     1. exact      — normalised string equality against name or alias
     2. alias      — same, after dropping equipment/filler words
     3. fuzzy      — token overlap + edit distance, must clear MIN_AUTO
     4. (caller)   — whatever is still unmatched goes to the LLM in one batch

   Nothing here calls an API, so it is free and instant. Results carry a score so
   the admin UI can show confidence and let a human correct it. */

import catalog from "../../../public/data/exercises.json" with { type: "json" };

export const MIN_AUTO = 0.80;   // accept automatically at or above this
export const MIN_HINT = 0.58;   // below this we do not even suggest

/* words that carry no identity, mostly Spanish/English equipment and filler */
const NOISE = new Set([
  "con", "de", "del", "la", "el", "los", "las", "en", "y", "a", "the", "with", "of",
  "barra", "bar", "barbell", "mancuerna", "mancuernas", "dumbbell", "db", "kb",
  "kettlebell", "polea", "cable", "maquina", "machine", "banco", "bench",
  "peso", "weight", "corporal", "bodyweight", "doble", "double", "alterno",
  "alternating", "unilateral", "single", "arm", "brazo", "pierna", "leg",
  "sentado", "seated", "de-pie", "standing", "tumbado", "lying", "inclinado",
  "incline", "declinado", "decline", "plano", "flat", "agarre", "grip",
  "ez", "z", "smith", "landmine",
]);

/* entries that are not exercises at all */
const IGNORE = new Set(["rest", "descanso", "cardio", "box", "estiramiento", "stretch",
  "calentamiento", "warm up", "warmup", "movilidad", "mobility", "libre", "free"]);

/* Spanish (and gym-shorthand) -> catalog English, applied token by token.
   This is what lets "Press bajo polea" reach "Cable Chest Press" without an API call. */
const ES = {
  press:"press", banca:"bench", pecho:"chest", pectoral:"chest",
  remo:"row", jalon:"pulldown", jalones:"pulldown", dominada:"pull-up", dominadas:"pull-up",
  sentadilla:"squat", sentadillas:"squat", peso:"", muerto:"deadlift", pesomuerto:"deadlift",
  zancada:"lunge", zancadas:"lunge", desplante:"lunge",
  elevacion:"raise", elevaciones:"raise", lateral:"lateral", frontal:"front",
  hiperextension:"back extension", hiperextensiones:"back extension",
  predicador:"preacher curl", curl:"curl", martillo:"hammer",
  fondo:"dip", fondos:"dip", paralelas:"dip",
  gemelo:"calf raise", gemelos:"calf raise", pantorrilla:"calf raise",
  encogimiento:"shrug", encogimientos:"shrug",
  aperturas:"fly", apertura:"fly", cruce:"fly", cruces:"fly",
  patada:"kickback", puente:"hip thrust", plancha:"plank",
  abdominal:"crunch", abdominales:"crunch", crunch:"crunch",
  extension:"extension", extensiones:"extension", flexion:"curl", flexiones:"push-up",
  militar:"overhead", tras:"", nuca:"overhead", hombro:"shoulder", hombros:"shoulder",
  triceps:"triceps", biceps:"biceps", dorsal:"lat", dorsales:"lat",
  pierna:"leg", piernas:"leg", femoral:"leg curl", cuadriceps:"leg extension",
  gluteo:"glute", gluteos:"glute", cadera:"hip",
  mp:"overhead press", ohp:"overhead press", rdl:"romanian deadlift",
  bulgara:"bulgarian split squat", bulgaras:"bulgarian split squat",
  bajo:"low", alto:"high", cerrado:"close", abierto:"wide", cuerda:"rope", soga:"rope",
  pullover:"pull-over", "pull":"pull", over:"over",
};

const ACC = { á:"a", é:"e", í:"i", ó:"o", ú:"u", ü:"u", ñ:"n", à:"a", è:"e", ì:"i", ò:"o", ù:"u", ç:"c" };

export function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/[áéíóúüñàèìòùç]/g, c => ACC[c] || c)
    .replace(/[×x]\s*\d+/g, " ")          // stray set schemes
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const stem = t => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) ? t.slice(0, -1) : t;

/* translate, then stem: "Elevaciones laterales" -> ["raise","lateral"] */
function tokens(s) {
  const out = [];
  for (const raw of norm(s).split(/[\s-]+/)) {
    if (!raw) continue;
    const tr = ES[raw] !== undefined ? ES[raw] : raw;
    if (!tr) continue;
    tr.split(/[\s-]+/).forEach(t => { if (t) out.push(stem(t)); });
  }
  return out;
}
const meaningful = s => tokens(s).filter(t => !NOISE.has(t) && t.length > 1);
const glued = arr => arr.join("");            // order matters: skull+crusher == skullcrusher

export const isIgnored = name => {
  const t = tokens(name);
  return t.length > 0 && t.every(x => IGNORE.has(x)) || IGNORE.has(norm(name));
};

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const editRatio = (a, b) => {
  const L = Math.max(a.length, b.length);
  return L ? 1 - levenshtein(a, b) / L : 0;
};

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(t => { if (B.has(t)) inter++; });
  return inter / (A.size + B.size - inter);
}

/* candidate strings for each catalog entry: canonical name + aliases */
const INDEX = catalog.exercises.map(e => ({
  id: e.id,
  name: e.name,
  strings: [e.name, ...(e.aliases || [])].map(s => ({
    raw: s, n: norm(s), t: tokens(s), m: meaningful(s)
  }))
}));

const EXACT = new Map();
for (const e of INDEX) for (const s of e.strings) if (!EXACT.has(s.n)) EXACT.set(s.n, e.id);

const MEANINGFUL_KEY = new Map();
for (const e of INDEX) {
  for (const s of e.strings) {
    const k = [...s.m].sort().join(" ");
    if (k && !MEANINGFUL_KEY.has(k)) MEANINGFUL_KEY.set(k, e.id);
  }
}

/* Match one routine exercise name. Returns {id, score, how} or null. */
export function matchOne(name) {
  const n = norm(name);
  if (!n) return null;
  if (isIgnored(name)) return { id: null, score: 0, how: "skip" };

  if (EXACT.has(n)) return { id: EXACT.get(n), score: 1, how: "exact" };

  const mk = [...meaningful(name)].sort().join(" ");
  if (mk && MEANINGFUL_KEY.has(mk)) return { id: MEANINGFUL_KEY.get(mk), score: 0.95, how: "alias" };

  const qt = tokens(name), qm = meaningful(name);
  let best = null;
  for (const e of INDEX) {
    for (const s of e.strings) {
      const score = Math.max(
        0.62 * jaccard(qt, s.t) + 0.38 * editRatio(n, s.n),
        0.72 * jaccard(qm, s.m) + 0.28 * editRatio(qm.join(" "), s.m.join(" ")),
        editRatio(glued(qm), glued(s.m)) - 0.02,            // compound words
        qm.length && s.m.length && glued(qm) === glued(s.m) ? 0.94 : 0
      );
      if (!best || score > best.score) best = { id: e.id, score, how: "fuzzy" };
    }
  }
  if (best && best.score >= MIN_HINT) return { ...best, score: +best.score.toFixed(3) };
  return null;
}

/* Walk a whole routine. Mutates nothing: returns a report the caller can apply. */
export function matchRoutine(routine) {
  const seen = new Map();          // name -> result (identical names resolve once)
  const items = [];
  (routine.days || []).forEach((d, di) =>
    (d.blocks || []).forEach((b, bi) =>
      (b.exercises || []).forEach((ex, ei) => {
        const name = ex.name || "";
        if (!seen.has(name)) seen.set(name, matchOne(name));
        const r = seen.get(name);
        items.push({
          day: di, block: bi, index: ei, name,
          skip: !!(r && r.how === "skip"),
          ref: r && r.id && r.score >= MIN_AUTO ? r.id : null,
          suggestion: r || null,
          score: r ? r.score : 0,
          how: r ? r.how : "none"
        });
      })));
  const unmatched = [...new Set(items.filter(i => !i.ref && !i.skip).map(i => i.name))];
  return {
    items,
    unmatched,
    stats: {
      total: items.length,
      unique: seen.size,
      matched: items.filter(i => i.ref).length,
      byHow: items.reduce((a, i) => { const k = i.ref ? i.how : "none"; a[k] = (a[k] || 0) + 1; return a; }, {})
    }
  };
}

export function catalogEntry(id) {
  return catalog.exercises.find(e => e.id === id) || null;
}

export const catalogSize = catalog.exercises.length;
export const catalogNames = () => catalog.exercises.map(e => ({ id: e.id, name: e.name }));
