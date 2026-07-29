import { getStore } from "@netlify/blobs";
import { ok, err, requireAdmin } from "./lib/util.mjs";

/* POST /api/parse-upload — stage a file for an async parse job.

   Why this exists: background functions are invoked asynchronously and their
   request payload is capped at 256KB, while synchronous functions accept ~6MB.
   So the file is uploaded here (sync, fast — just a Blobs write) and the
   background job is then triggered with nothing but the jobId.

   Body: { jobId, filename, mimeType, dataBase64 } + X-Admin-Token */

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

export default async (req) => {
  if (req.method !== "POST") return err("method_not_allowed", "POST only", 405);
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body;
  try { body = await req.json(); }
  catch (e) { return err("bad_json", "Request body must be valid JSON", 400); }

  const { jobId, filename, mimeType, dataBase64 } = body || {};
  if (!jobId || !filename || !mimeType || !dataBase64) {
    return err("missing_fields", "jobId, filename, mimeType and dataBase64 are required", 400);
  }
  if (!ALLOWED.includes(mimeType)) {
    return err("unsupported_type", `mimeType must be one of: ${ALLOWED.join(", ")}`, 415);
  }
  const approxBytes = Math.floor(dataBase64.length * 3 / 4);
  if (approxBytes > MAX_BYTES) {
    return err("too_large", `File is ~${(approxBytes / 1048576).toFixed(1)}MB; limit is 4.5MB`, 413);
  }

  const store = getStore("jobs");
  await store.setJSON("file:" + jobId, { filename, mimeType, dataBase64, bytes: approxBytes, at: Date.now() });
  await store.setJSON("job:" + jobId, { status: "queued", filename, startedAt: Date.now() });

  return ok({ jobId, bytes: approxBytes });
};

export const config = { path: "/api/parse-upload" };
