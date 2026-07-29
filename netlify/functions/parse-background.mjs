import { getStore } from "@netlify/blobs";
import { parseRoutine, ParseError } from "./lib/parser.mjs";

/* POST /.netlify/functions/parse-background — async parse job.

   Synchronous functions are killed at 30s, which multi-page PDFs exceed.
   Background functions answer 202 immediately and may run for minutes.

   IMPORTANT: async invocations cap the request payload at 256KB, so the file
   is NOT sent here — /api/parse-upload stages it in Blobs first and this
   function is triggered with just { jobId }.

   Job record shape in the "jobs" store:
     { status:"queued"|"running", filename, startedAt }
     { status:"done",  routine, model, attempts, usage, costEstimateUSD, ms }
     { status:"error", code, message } */

const accepted = () => new Response("", { status: 202 });

export default async (req) => {
  let body;
  try { body = await req.json(); }
  catch (e) { return new Response("bad json", { status: 400 }); }

  const { jobId } = body || {};
  if (!jobId) return new Response("jobId required", { status: 400 });

  const store = getStore("jobs");
  const key = "job:" + jobId;
  const fail = async (code, message) => {
    await store.setJSON(key, { status: "error", code, message, at: Date.now() });
    return accepted();
  };

  /* auth checked after the body so failures can be reported through the job
     record — the client never sees this response (background = always 202) */
  if (req.headers.get("x-admin-token") !== process.env.ADMIN_TOKEN) {
    return fail("unauthorized", "Invalid or missing X-Admin-Token header");
  }

  const staged = await store.get("file:" + jobId, { type: "json" });
  if (!staged) return fail("file_missing", "Staged file not found for this job — upload it again");

  const { filename, mimeType, dataBase64, bytes } = staged;
  await store.setJSON(key, { status: "running", filename, startedAt: Date.now() });

  try {
    const t0 = Date.now();
    const result = await parseRoutine({ mimeType, dataBase64 });
    const ms = Date.now() - t0;
    const inTok = result.attempts.reduce((n, a) => n + (a.usage?.input_tokens || 0), 0);
    const outTok = result.attempts.reduce((n, a) => n + (a.usage?.output_tokens || 0), 0);
    console.log(JSON.stringify({
      evt: "parse_bg", job: jobId, file: filename, bytes, model: result.model,
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
  } finally {
    /* the staged file is large and single-use — drop it either way */
    try { await store.delete("file:" + jobId); } catch (e) {}
  }

  return accepted();
};
