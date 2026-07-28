import { ok, err, requireAdmin } from "./lib/util.mjs";

/* POST /api/parse — Phase 2 STUB.
   Contract (final from day one; Phase 3 only replaces the guts):
     Request:  { filename, mimeType, dataBase64 }  + X-Admin-Token header
     Response: { ok:true, data:{ routine, ... } } | { ok:false, error }
   Limits: jpeg/png/webp/pdf, ~4.5MB decoded (Netlify function payload ceiling). */

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

  // ---- Phase 3 replaces everything below with the Claude vision call. ----
  return ok({
    stub: true,
    received: { filename, mimeType, approxBytes },
    routine: {
      id: "stub-routine",
      title: "Stub Routine (parser arrives in Phase 3)",
      weeks: 1,
      days: [{
        key: "d1", tab: "Día 1", label: "Stub",
        blocks: [{ title: "", exercises: [{ name: "Parse me in Phase 3", scheme: "1×1" }] }]
      }]
    }
  });
};

export const config = { path: "/api/parse" };
