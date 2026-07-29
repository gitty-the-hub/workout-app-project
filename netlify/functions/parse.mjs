import { ok, err, requireAdmin } from "./lib/util.mjs";
import { parseRoutine, ParseError, PARSE_MODEL } from "./lib/parser.mjs";
import { checkRate, recordUsage } from "./lib/limits.mjs";

/* POST /api/parse — extract a workout routine from an uploaded photo/PDF.
   Request:  { filename, mimeType, dataBase64 }  + X-Admin-Token header
   Response: { ok:true, data:{ routine, model, attempts, usage, costEstimateUSD } }
   The result is NOT auto-published: parsing and publishing are separate
   operations, with the admin review (Phase 4) between them. */

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

export default async (req) => {
  if (req.method !== "POST") return err("method_not_allowed", "POST only", 405);
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); }
  catch (e) { return err("bad_json", "Request body must be valid JSON", 400); }

  const { filename, mimeType, dataBase64 } = body || {};
  if (!filename || !mimeType || !dataBase64) {
    return err("missing_fields", "filename, mimeType and dataBase64 are required", 400);
  }
  if (!ALLOWED.includes(mimeType)) {
    return err("unsupported_type", `mimeType must be one of: ${ALLOWED.join(", ")}`, 415);
  }
  const approxBytes = Math.floor(dataBase64.length * 3 / 4);
  if (approxBytes > MAX_BYTES) {
    return err("too_large", `File is ~${(approxBytes / 1048576).toFixed(1)}MB; limit is 4.5MB`, 413);
  }

  const rate = await checkRate();
  if (!rate.allowed) {
    return err("rate_limited",
      `Límite de ${rate.limit} análisis por hora alcanzado. Vuelve a intentarlo en ~${rate.resetsInMin} min.`, 429);
  }

  try {
    const t0 = Date.now();
    const result = await parseRoutine({ mimeType, dataBase64 });
    const totalMs = Date.now() - t0;
    // one-line ops log per parse: model, attempts, tokens, cost — the cost ledger
    const inTok = result.attempts.reduce((n, a) => n + (a.usage?.input_tokens || 0), 0);
    const outTok = result.attempts.reduce((n, a) => n + (a.usage?.output_tokens || 0), 0);
    console.log(JSON.stringify({
      evt: "parse", file: filename, bytes: approxBytes, model: result.model,
      attempts: result.attempts.length, input_tokens: inTok, output_tokens: outTok,
      costUSD: result.costEstimateUSD, ms: totalMs
    }));
    await recordUsage({ inputTokens: inTok, outputTokens: outTok, costUSD: result.costEstimateUSD });
    return ok({
      routine: result.routine,
      model: result.model,
      attempts: result.attempts.length,
      usage: { input_tokens: inTok, output_tokens: outTok },
      costEstimateUSD: result.costEstimateUSD,
      ms: totalMs
    });
  } catch (e) {
    if (e instanceof ParseError) {
      console.log(JSON.stringify({ evt: "parse_failed", file: filename, code: e.code, attempts: e.attempts?.length }));
      return err(e.code, e.message, 422);
    }
    // API-level failures (auth, rate limit, overload) surface with their own hint
    const status = e.status || 500;
    console.log(JSON.stringify({ evt: "parse_error", file: filename, status, msg: String(e.message).slice(0, 200) }));
    if (status === 401) return err("api_key_invalid", "Anthropic API key is missing or invalid on the server", 500);
    if (status === 429) return err("rate_limited", "Anthropic API rate limit hit — retry in a moment", 429);
    if (status === 529) return err("api_overloaded", "Anthropic API temporarily overloaded — retry in a moment", 503);
    return err("parse_error", "Unexpected error while parsing: " + String(e.message).slice(0, 200), 500);
  }
};

export const config = { path: "/api/parse" };
