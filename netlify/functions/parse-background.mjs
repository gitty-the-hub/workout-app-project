import { getStore } from "@netlify/blobs";
import { parseRoutine, ParseError } from "./lib/parser.mjs";

/* POST /.netlify/functions/parse-background — async parse job.

   Netlify kills synchronous functions at 30s; a 2-page scanned PDF needs more.
   Background functions (the "-background" filename suffix) answer 202 immediately
   and may run for minutes, so the work happens here and the result lands in Blobs
   under job:<jobId>. The client polls /api/parse-status.

   Job record shape:
     { status:"running", filename, startedAt }
     { status:"done",  routine, model, attempts, usage, costEstimateUSD, ms }
     { status:"error", code, message } */

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
const accepted = () => new Response("", { status: 202 });

export default async (req) => {
  let body;
  try { body = await req.json(); }
  catch (e) { return new Response("bad json", { status: 400 }); }

  const { jobId, filename, mimeType, dataBase64 } = body || {};
  if (!jobId) return new Response("jobId required", { status: 400 });

  const store = getStore("jobs");
  const key = "job:" + jobId;
  const fail = async (code, message) => {
    await store.setJSON(key, { status: "error", code, message, at: Date.now() });
    return accepted();
  };

  /* auth is checked after the body so we can report failures through the job record —
     the client never sees this response (background functions always answer 202) */
  if (req.headers.get("x-admin-token") !== process.env.ADMIN_TOKEN) {
    return fail("unauthorized", "Invalid or missing X-Admin-Token header");
  }
  if (!filename || !mimeType || !dataBase64) {
    return fail("missing_fields", "filename, mimeType and dataBase64 are required");
  }
  if (!ALLOWED.includes(mimeType)) {
    return fail("unsupported_type", `mimeType must be one of: ${ALLOWED.join(", ")}`);
  }
  const approxBytes = Math.floor(dataBase64.length * 3 / 4);
  if (approxBytes > MAX_BYTES) {
    return fail("too_large", `File is ~${(approxBytes / 1048576).toFixed(1)}MB; limit is 4.5MB`);
  }

  await store.setJSON(key, { status: "running", filename, startedAt: Date.now() });

  try {
    const t0 = Date.now();
    const result = await parseRoutine({ mimeType, dataBase64 });
    const ms = Date.now() - t0;
    const inTok = result.attempts.reduce((n, a) => n + (a.usage?.input_tokens || 0), 0);
    const outTok = result.attempts.reduce((n, a) => n + (a.usage?.output_tokens || 0), 0);
    console.log(JSON.stringify({
      evt: "parse_bg", job: jobId, file: filename, bytes: approxBytes, model: result.model,
      attempts: result.attempts.length, input_tokens: inTok, output_tokens: outTok,
      costUSD: result.costEstimateUSD, ms
    }));
    await store.setJSON(key, {
      status: "done",
      routine: result.routine,
      model: result.model,
      attempts: result.attempts.length,
      usage: { input_tokens: inTok, output_tokens: outTok },
      costEstimateUSD: result.costEstimateUSD,
      ms
    });
  } catch (e) {
    const code = e instanceof ParseError ? e.code
      : e.status === 401 ? "api_key_invalid"
      : e.status === 429 ? "rate_limited"
      : e.status === 529 ? "api_overloaded"
      : "parse_error";
    console.log(JSON.stringify({ evt: "parse_bg_failed", job: jobId, code, msg: String(e.message).slice(0, 200) }));
    await store.setJSON(key, { status: "error", code, message: String(e.message).slice(0, 300), at: Date.now() });
  }

  return accepted();
};
