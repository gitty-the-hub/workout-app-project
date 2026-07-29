/* Parser eval harness — scores the LLM parser against hand-verified ground truth.
   Run whenever the prompt or model changes. Numbers beat impressions.

   Usage (from the app/ folder, needs ANTHROPIC_API_KEY in env):
     node eval/run-eval.mjs [runs]           # default 3 runs
     netlify dev:exec node eval/run-eval.mjs # runs with Netlify env vars injected

   Scoring, per run:
   - structure: day count and per-day block counts vs expected
   - exercises: per day, name matches (normalized) and scheme matches (verbatim)
   - warmup: same treatment
   id/title/subtitle are NOT scored (the model may word them differently). */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseRoutine, PARSE_MODEL } from "../netlify/functions/lib/parser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = [
  /* simple: one table, days as columns, repeated days referenced by name */
  { name: "july-2026", image: join(HERE, "july-2026.jpeg"), mimeType: "image/jpeg", expected: join(HERE, "expected/july-2026.json") },
  /* hard: weekday grid, two stacked sections per column, weekly % progressions,
     rest/RIR annotations. Ground truth transcribed from the photo, not from the
     published parse (which contained typos and a missing exercise). */
  { name: "hypertrophy-strength", image: join(HERE, "hypertrophy-strength.png"), mimeType: "image/png", expected: join(HERE, "expected/hypertrophy-strength.json") }
];
const THRESHOLD = 0.95;
const RUNS = parseInt(process.argv[2] || "3", 10);

/* normalize names for comparison: lowercase, strip accents, collapse space/punct */
function norm(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function normScheme(s) {
  return String(s || "").toLowerCase().replace(/[x×]/g, "×").replace(/\s+/g, "");
}

function flatDay(day) {
  return day.blocks.flatMap(b => b.exercises);
}

function scoreRun(got, exp) {
  const detail = [];
  let nameHits = 0, schemeHits = 0, total = 0;

  // warmup treated as a pseudo-day
  const pairs = [[exp.warmup || [], (got.warmup || []), "warmup"]];
  const nDays = Math.max(exp.days.length, (got.days || []).length);
  for (let i = 0; i < nDays; i++) {
    pairs.push([exp.days[i] ? flatDay(exp.days[i]) : [], got.days?.[i] ? flatDay(got.days[i]) : [], exp.days[i]?.tab || `day ${i+1}`]);
  }

  for (const [expEx, gotEx, label] of pairs) {
    let dNames = 0, dSchemes = 0;
    const used = new Set();
    expEx.forEach(e => {
      total++;
      const idx = gotEx.findIndex((g, j) => !used.has(j) && norm(g.name) === norm(e.name));
      if (idx >= 0) {
        used.add(idx);
        nameHits++; dNames++;
        if (normScheme(gotEx[idx].scheme) === normScheme(e.scheme)) { schemeHits++; dSchemes++; }
      }
    });
    detail.push({ label, expected: expEx.length, got: gotEx.length, names: dNames, schemes: dSchemes });
  }

  return {
    dayCountOK: (got.days || []).length === exp.days.length,
    nameAcc: total ? nameHits / total : 0,
    schemeAcc: total ? schemeHits / total : 0,
    total, nameHits, schemeHits, detail
  };
}

async function main() {
  console.log(`Parser eval — model: ${PARSE_MODEL}, runs per case: ${RUNS}\n`);
  let allPass = true;

  for (const c of CASES) {
    const dataBase64 = readFileSync(c.image).toString("base64");
    const expected = JSON.parse(readFileSync(c.expected, "utf8"));
    console.log(`== Case: ${c.name} (${expected.days.length} days, ${expected.days.reduce((n,d)=>n+flatDay(d).length,0)} exercises + ${expected.warmup?.length||0} warmup) ==`);

    const runScores = [];
    for (let r = 1; r <= RUNS; r++) {
      try {
        const t0 = Date.now();
        const res = await parseRoutine({ mimeType: c.mimeType, dataBase64 });
        const s = scoreRun(res.routine, expected);
        runScores.push(s);
        console.log(`run ${r}: names ${(s.nameAcc*100).toFixed(1)}% (${s.nameHits}/${s.total}) · schemes ${(s.schemeAcc*100).toFixed(1)}% · days ${s.dayCountOK ? "OK" : "MISMATCH"} · attempts ${res.attempts.length} · $${res.costEstimateUSD} · ${((Date.now()-t0)/1000).toFixed(1)}s`);
        s.detail.forEach(d => {
          if (d.names < d.expected || d.got !== d.expected) {
            console.log(`   ⚠ ${d.label}: expected ${d.expected} ex, got ${d.got}; name matches ${d.names}, scheme matches ${d.schemes}`);
          }
        });
      } catch (e) {
        runScores.push(null);
        console.log(`run ${r}: FAILED — ${e.code || ""} ${e.message}`);
      }
    }

    const good = runScores.filter(Boolean);
    if (!good.length) { allPass = false; console.log(`\n${c.name}: ALL RUNS FAILED\n`); continue; }
    const avgName = good.reduce((n,s)=>n+s.nameAcc,0)/good.length;
    const avgScheme = good.reduce((n,s)=>n+s.schemeAcc,0)/good.length;
    const pass = avgName >= THRESHOLD;
    if (!pass) allPass = false;
    console.log(`\n${c.name}: avg names ${(avgName*100).toFixed(1)}% · avg schemes ${(avgScheme*100).toFixed(1)}% · threshold ${(THRESHOLD*100)}% → ${pass ? "PASS ✅" : "FAIL ❌"}\n`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
