/* LLM parsing core — turns a workout photo/PDF into a schema-valid routine.
   Isolated from HTTP plumbing so both /api/parse and eval/run-eval.mjs reuse it.

   Pattern summary (certification-relevant):
   - Messages API with vision (image block) / document (PDF block) input
   - FORCED structured output: one tool whose input_schema IS routine.schema.json,
     with tool_choice pinning the model to that tool — no prose possible
   - temperature 0: extraction wants determinism
   - validate -> repair loop: AJV errors are fed back as a tool_result and the
     model gets exactly one chance to correct itself (multi-turn error repair)
   - usage/latency captured per attempt for cost tracking */

import Anthropic from "@anthropic-ai/sdk";
import Ajv from "ajv";
import schema from "../../../schema/routine.schema.json" with { type: "json" };

export const PARSE_MODEL = process.env.PARSE_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 8000;
const MAX_ATTEMPTS = 3;

/* Approximate USD per million tokens — update if pricing changes. */
const PRICE = { input: 3, output: 15 };

const SYSTEM = `You extract workout routines from images or PDF files into structured JSON via the submit_routine tool.

Rules:
1. Preserve the source language exactly. Never translate exercise names, day labels, or notes.
2. Copy set/rep schemes VERBATIM: "4×15-12-10-8", "3×12 y 10", "7-7-7", "3×30s". Never normalize, reformat, or expand them.
3. If a word or number is genuinely unreadable, write "???" for that field. Never guess.
4. If a day repeats another day (e.g. "repite Día 2", "same as Day 1", an unlabeled duplicate column), expand it into a FULL copy of that day's blocks, and reflect the repetition in its label (e.g. "Espalda · Bíceps (repite Día 2)").
5. Warm-up exercises belong in the top-level "warmup" array, never inside days.
6. Modifiers such as "doble peso", "L/R", "(KB)" go in the exercise's "note" field when the source shows them as an annotation; keep them inside "name" or "scheme" only if they are inseparable there.
7. Day keys are sequential in source order: d1, d2, d3… "tab" is short ("Día 1", "Extra"); "label" describes the day's muscle groups if the source provides them, otherwise "".
8. If a day has no internal sections, use a single block with title "".
9. "id": kebab-case derived from the routine's title plus year if known (e.g. "july-2026"). "title": the routine's own name from the source, or a concise descriptive one.
10. "weeks": the stated program length; if not stated anywhere, use 6.
11. Extract EVERY exercise. Never summarize, skip, merge, or invent exercises.
12. Use ONLY the fields defined in the tool schema: id, title, subtitle, weeks, warmup, days[key,tab,label,blocks[title,exercises[name,scheme,note]]]. Never add other properties anywhere.
13. Every exercise needs BOTH "name" and "scheme", non-empty. If the source shows a movement without sets/reps, use "—" as the scheme.
14. Weekly progression rows (e.g. "Semana 1 80%", "Week 3 85%") are not exercises. Put them in the day's block as a block whose title is the progression label, with one entry per week: name = the week ("Semana 1"), scheme = the value ("80%"). If they clearly modify one specific exercise, append them to that exercise's note instead.
15. Rest or tempo annotations ("2min rest", "RIR 2", "C/L", "lastre") belong in the exercise's note, never as separate exercises.
16. Column-per-day layouts (Monday…Saturday) are days in left-to-right order. If a column continues in a lower section of the page, append those exercises to the SAME day.`;

/* The tool schema IS the routine schema — but DEREFERENCED: $ref/definitions
   indirection confuses models when used as a tool input_schema, so we inline
   every reference and strip schema-metadata keys. Validation (AJV) still uses
   the original schema; only the API-facing copy is flattened. */
function deref(node, root) {
  if (Array.isArray(node)) return node.map(n => deref(n, root));
  if (node && typeof node === "object") {
    if (node.$ref) {
      const path = node.$ref.replace(/^#\//, "").split("/");
      let t = root;
      for (const p of path) t = t[p];
      return deref(t, root);
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "definitions" || k === "$schema" || k === "$id") continue;
      out[k] = deref(v, root);
    }
    return out;
  }
  return node;
}
const toolSchema = deref(schema, schema);

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

export function costEstimateUSD(usageList) {
  let inTok = 0, outTok = 0;
  usageList.forEach(u => { inTok += u.input_tokens || 0; outTok += u.output_tokens || 0; });
  return +(((inTok * PRICE.input) + (outTok * PRICE.output)) / 1e6).toFixed(4);
}

/* Keep only schema-known fields; coerce obvious type slips. Never invents data. */
function sanitize(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const ex = e => {
    const o = { name: String(e?.name ?? "").trim(), scheme: String(e?.scheme ?? "").trim() };
    if (e?.note != null && String(e.note).trim()) o.note = String(e.note).trim();
    return o;
  };
  const out = {
    id: String(doc.id ?? "").trim(),
    title: String(doc.title ?? "").trim(),
    weeks: Number.isFinite(+doc.weeks) ? Math.round(+doc.weeks) : 6,
    days: Array.isArray(doc.days) ? doc.days.map((d, i) => ({
      key: /^d\d+$/.test(d?.key || "") ? d.key : "d" + (i + 1),
      tab: String(d?.tab ?? `Día ${i + 1}`).trim(),
      label: String(d?.label ?? "").trim(),
      blocks: Array.isArray(d?.blocks) ? d.blocks.map(b => ({
        title: String(b?.title ?? "").trim(),
        exercises: Array.isArray(b?.exercises) ? b.exercises.map(ex) : []
      })) : []
    })) : []
  };
  if (doc.subtitle != null && String(doc.subtitle).trim()) out.subtitle = String(doc.subtitle).trim();
  if (Array.isArray(doc.warmup) && doc.warmup.length) out.warmup = doc.warmup.map(ex);
  return out;
}

export class ParseError extends Error {
  constructor(code, message, attempts) {
    super(message);
    this.code = code;
    this.attempts = attempts;
  }
}

export async function parseRoutine({ mimeType, dataBase64 }) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const fileBlock = mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: dataBase64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: dataBase64 } };

  const tools = [{
    name: "submit_routine",
    description: "Submit the complete workout routine extracted from the source file.",
    input_schema: toolSchema
  }];

  const messages = [{
    role: "user",
    content: [
      fileBlock,
      { type: "text", text: "Extract the complete workout routine from this file and submit it via the submit_routine tool. Follow the system rules exactly." }
    ]
  }];

  const attempts = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    const resp = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: MAX_TOKENS,
      // NOTE: `temperature` is deprecated/rejected on claude-sonnet-5 —
      // determinism guidance now lives in the prompt + forced tool schema.
      system: SYSTEM,
      tools,
      tool_choice: { type: "tool", name: "submit_routine" },
      messages
    });
    const latencyMs = Date.now() - t0;

    const toolUse = resp.content.find(b => b.type === "tool_use" && b.name === "submit_routine");
    attempts.push({ attempt, latencyMs, usage: resp.usage, stop_reason: resp.stop_reason });

    if (!toolUse) {
      throw new ParseError("no_tool_call", "Model returned no submit_routine call", attempts);
    }

    /* Models occasionally decorate the payload with well-meant extra fields
       (rest, percentages, equipment…). Those carry no schema meaning, so drop
       them instead of burning a repair round on them. */
    const doc = sanitize(toolUse.input);

    /* An empty payload means the model found no routine in the file (wrong
       document, unreadable scan). Retrying cannot fix that, so fail fast with
       an honest code instead of burning attempts on schema complaints. */
    const exCount = (doc.days || []).reduce((n, d) =>
      n + (d.blocks || []).reduce((m, b) => m + (b.exercises || []).length, 0), 0);
    if (!doc.days?.length || exCount === 0) {
      throw new ParseError("no_routine_found",
        "The file does not appear to contain a workout routine.", attempts);
    }

    if (validate(doc)) {
      return { routine: doc, model: PARSE_MODEL, attempts, costEstimateUSD: costEstimateUSD(attempts.map(a => a.usage)) };
    }

    const errors = ajv.errorsText(validate.errors, { separator: " | " });
    if (process.env.PARSE_DEBUG) {
      console.error(`[PARSE_DEBUG] attempt ${attempt} invalid doc (first 800 chars):`, JSON.stringify(doc).slice(0, 800));
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new ParseError("schema_invalid_after_retry", `Routine failed schema validation after ${MAX_ATTEMPTS} attempts: ${errors}`, attempts);
    }

    /* Error-repair turn: echo the assistant's tool call, return the validation
       errors as a failed tool_result, and let the model correct itself. */
    messages.push({ role: "assistant", content: resp.content });
    messages.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: toolUse.id,
        is_error: true,
        content: `Schema validation failed: ${errors}. Call submit_routine again with a corrected, COMPLETE routine (all days, all exercises).`
      }]
    });
  }
}
