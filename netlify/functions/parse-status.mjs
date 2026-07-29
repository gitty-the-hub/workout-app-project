import { getStore } from "@netlify/blobs";
import { ok, err, requireAdmin } from "./lib/util.mjs";

/* GET /api/parse-status?job=<id> — poll a background parse job.
   Returns {status:"pending"} while the job record does not exist yet
   (the background invocation may not have started writing), then the
   record itself: running | done | error. */

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const job = new URL(req.url).searchParams.get("job");
  if (!job) return err("missing_fields", "job query parameter is required", 400);

  const rec = await getStore("jobs").get("job:" + job, { type: "json" });
  return ok(rec || { status: "pending" });
};

export const config = { path: "/api/parse-status" };
