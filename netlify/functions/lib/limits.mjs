import { getStore } from "@netlify/blobs";

/* Guardrails around the one operation that costs money: parsing.

   - rate limit: N parses per rolling hour (blunt but effective against a
     leaked token or a client stuck in a retry loop)
   - usage ledger: per-month tally of parses, tokens and estimated cost,
     surfaced in the admin header so spend is visible where you work
   - sweep: job records and staged files do not expire on their own */

export const PARSE_LIMIT_PER_HOUR = Number(process.env.PARSE_LIMIT_PER_HOUR || 15);
const JOB_TTL_MS = 24 * 60 * 60 * 1000;   // finished job records
const FILE_TTL_MS = 60 * 60 * 1000;       // staged uploads (deleted on success anyway)

export const meta = () => getStore("meta");
export const jobs = () => getStore("jobs");

const hourKey = (d = new Date()) => "rate:" + d.toISOString().slice(0, 13);   // rate:2026-07-28T21
const monthKey = (d = new Date()) => "usage:" + d.toISOString().slice(0, 7);  // usage:2026-07

/* Returns { allowed, used, limit, resetsInMin }. Increments when allowed.
   Not atomic — two simultaneous requests could both pass at the boundary.
   Acceptable here: the limit is a safety net, not a billing control. */
export async function checkRate(store = meta()) {
  const key = hourKey();
  const rec = (await store.get(key, { type: "json" })) || { count: 0 };
  const limit = PARSE_LIMIT_PER_HOUR;
  const resetsInMin = 60 - new Date().getUTCMinutes();
  if (rec.count >= limit) return { allowed: false, used: rec.count, limit, resetsInMin };
  await store.setJSON(key, { count: rec.count + 1, at: Date.now() });
  return { allowed: true, used: rec.count + 1, limit, resetsInMin };
}

export async function recordUsage({ inputTokens = 0, outputTokens = 0, costUSD = 0 }, store = meta()) {
  const key = monthKey();
  const rec = (await store.get(key, { type: "json" })) || { parses: 0, input_tokens: 0, output_tokens: 0, costUSD: 0 };
  await store.setJSON(key, {
    parses: rec.parses + 1,
    input_tokens: rec.input_tokens + inputTokens,
    output_tokens: rec.output_tokens + outputTokens,
    costUSD: +(rec.costUSD + costUSD).toFixed(4),
    updatedAt: Date.now()
  });
}

export async function readUsage(store = meta()) {
  const month = (await store.get(monthKey(), { type: "json" })) ||
    { parses: 0, input_tokens: 0, output_tokens: 0, costUSD: 0 };
  const rate = (await store.get(hourKey(), { type: "json" })) || { count: 0 };
  return { month, rate: { used: rate.count, limit: PARSE_LIMIT_PER_HOUR } };
}

/* Best-effort sweep of stale blobs. Never throws — cleanup must not break a parse. */
export async function sweepJobs(store = jobs()) {
  try {
    const now = Date.now();
    const { blobs } = await store.list();
    let removed = 0;
    for (const b of blobs) {
      const isFile = b.key.startsWith("file:");
      const isJob = b.key.startsWith("job:");
      if (!isFile && !isJob) continue;
      const rec = await store.get(b.key, { type: "json" }).catch(() => null);
      const stamp = rec?.at || rec?.startedAt || 0;
      if (!stamp) continue;
      const ttl = isFile ? FILE_TTL_MS : JOB_TTL_MS;
      if (now - stamp > ttl) { await store.delete(b.key); removed++; }
    }
    if (removed) console.log(JSON.stringify({ evt: "sweep", removed }));
  } catch (e) {
    console.log(JSON.stringify({ evt: "sweep_failed", msg: String(e.message).slice(0, 120) }));
  }
}
