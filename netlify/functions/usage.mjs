import { ok, requireAdmin } from "./lib/util.mjs";
import { readUsage } from "./lib/limits.mjs";

/* GET /api/usage — month-to-date parse count, tokens, estimated cost, and
   the current hour's rate-limit consumption. Shown in the admin header. */

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return ok(await readUsage());
};

export const config = { path: "/api/usage" };
