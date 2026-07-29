import Anthropic from "@anthropic-ai/sdk";
import { ok, err, requireAdmin } from "./lib/util.mjs";
import { matchRoutine, catalogNames, catalogEntry, MIN_AUTO } from "./lib/matcher.mjs";
import { PARSE_MODEL } from "./lib/parser.mjs";

/* POST /api/match — resolve a routine's exercise names to catalog ids.

   Runs the local ladder first (exact -> alias -> fuzzy), which costs nothing and
   settles most names. Only the leftovers go to Claude, all in ONE call, and the
   model must answer through a forced tool so the shape is guaranteed.

   Body: { routine, useLLM?: true }
   Returns: { items, unmatched, stats, llm? }  — the caller applies refs after review. */

const LLM_CONF = 0.85;      // score recorded for an accepted model match

export default async (req) => {
  if (req.method !== "POST") return err("method_not_allowed", "POST only", 405);
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); }
  catch (e) { return err("bad_json", "Request body must be valid JSON", 400); }

  const routine = body?.routine;
  if (!routine?.days) return err("missing_fields", "routine with days is required", 400);

  const report = matchRoutine(routine);
  const useLLM = body.useLLM !== false;

  if (!useLLM || !report.unmatched.length) {
    return ok({ ...report, llm: null });
  }

  /* ---- one batched call for everything the ladder could not settle ---- */
  const names = report.unmatched;
  const candidates = catalogNames();          // 200 x {id, name}
  const client = new Anthropic();

  const tool = {
    name: "submit_matches",
    description: "Map each gym exercise name to a catalog id, or null when nothing fits.",
    input_schema: {
      type: "object",
      required: ["matches"],
      additionalProperties: false,
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "id"],
            additionalProperties: false,
            properties: {
              name: { type: "string", description: "the input name, copied verbatim" },
              id: { type: ["string", "null"], description: "catalog id, or null if no good match" },
              confidence: { type: "number", description: "0-1" }
            }
          }
        }
      }
    }
  };

  const system = `You map gym exercise names — often Spanish, abbreviated, or written by hand — to entries in a fixed catalog.

Rules:
1. Answer only with ids from the catalog list provided. Never invent an id.
2. Return null when no catalog entry is genuinely the same movement. A wrong match is worse than no match.
3. Equipment matters: prefer the entry whose equipment matches the input ("polea"/"cable" -> a cable entry, "DB"/"mancuerna" -> a dumbbell entry, "barra" -> barbell).
4. Spanish examples: "Press bajo polea" is a cable chest press; "Predicador" is a preacher curl; "Jalón" is a pulldown; "Fondos" are dips; "Hiperextensión" is a back extension; "21 con barra Z" is an EZ-bar biceps curl variation.
5. Copy each input name back verbatim so the caller can align the results.
6. Confidence: 0.9+ only when you are sure the movement is the same.`;

  const t0 = Date.now();
  const resp = await client.messages.create({
    model: PARSE_MODEL,
    max_tokens: 2000,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: "submit_matches" },
    messages: [{
      role: "user",
      content: `CATALOG (id — name):\n${candidates.map(c => `${c.id} — ${c.name}`).join("\n")}\n\n` +
               `NAMES TO MAP:\n${names.map(n => `- ${n}`).join("\n")}`
    }]
  });
  const ms = Date.now() - t0;

  const call = resp.content.find(b => b.type === "tool_use" && b.name === "submit_matches");
  const proposed = call?.input?.matches || [];
  const valid = new Map();
  for (const m of proposed) {
    if (!m?.id) continue;
    if (!catalogEntry(m.id)) continue;                       // ignore hallucinated ids
    if (typeof m.confidence === "number" && m.confidence < 0.6) continue;
    valid.set(m.name, m.id);
  }

  /* apply: only fills gaps, never overrides a local match */
  report.items.forEach(i => {
    if (!i.ref && !i.skip && valid.has(i.name)) {
      i.ref = valid.get(i.name);
      i.how = "llm";
      i.score = LLM_CONF;
      i.suggestion = { id: i.ref, score: LLM_CONF, how: "llm" };
    }
  });
  report.unmatched = [...new Set(report.items.filter(i => !i.ref && !i.skip).map(i => i.name))];
  report.stats.matched = report.items.filter(i => i.ref).length;
  report.stats.byHow = report.items.reduce((a, i) => {
    const k = i.ref ? i.how : "none"; a[k] = (a[k] || 0) + 1; return a;
  }, {});

  const usage = resp.usage || {};
  console.log(JSON.stringify({
    evt: "match", asked: names.length, resolved: valid.size,
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, ms
  }));

  return ok({
    ...report,
    llm: { asked: names.length, resolved: valid.size, model: PARSE_MODEL, usage, ms,
           minAuto: MIN_AUTO }
  });
};

export const config = { path: "/api/match" };
