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
const MAX_ATTEMPTS = 2;

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
11. Extract EVERY exercise. Never summarize, skip, merge, or invent exercises.`;

/* The tool schema IS the routine schema (minus metadata keys the API doesn't need). */
const toolSchema = { ...schema };
delete toolSchema.$schema;
delete toolSchema.$id;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

export function costEstimateUSD(usageList) {
  let inTok = 0, outTok = 0;
  usageList.forEach(u => { inTok += u.input_tokens || 0; outTok += u.output_tokens || 0; });
  return +(((inTok * PRICE.input) + (outTok * PRICE.output)) / 1e6).toFixed(4);
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
      temperature: 0,
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

    const doc = toolUse.input;
    if (validate(doc)) {
      return { routine: doc, model: PARSE_MODEL, attempts, costEstimateUSD: costEstimateUSD(attempts.map(a => a.usage)) };
    }

    const errors = ajv.errorsText(validate.errors, { separator: " | " });
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
