import { ok } from "./lib/util.mjs";

/* GET /api/health — deployment & routing sanity check. */
export default async () =>
  ok({ service: "workout-app", phase: "2", time: new Date().toISOString() });

export const config = { path: "/api/health" };
