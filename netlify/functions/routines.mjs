import { getStore } from "@netlify/blobs";
import Ajv from "ajv";
import schema from "../../schema/routine.schema.json" with { type: "json" };
import seedRoutine from "../../public/routines/july-2026.json" with { type: "json" };
import { ok, err, requireAdmin } from "./lib/util.mjs";
import { matchOne, MIN_AUTO } from "./lib/matcher.mjs";

/* Routines API — Netlify Blobs is the source of truth.
   Layout in the "routines" store:
     index        -> { routines: [{id, title, weeks}] }   (the manifest)
     doc:<id>     -> full routine document (schema-conformant)

   GET    /api/routines        -> manifest (public)
   GET    /api/routines/:id    -> routine document (public)
   POST   /api/routines        -> create/update routine (admin, schema-validated)
   DELETE /api/routines/:id    -> remove routine (admin)
*/

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

const MAX_EXERCISES = 400;
const MAX_STR = 200;
/* strip C0/C1 control chars (keep normal whitespace), collapse runs, clamp length */
const clean = (v, max = MAX_STR) =>
  String(v ?? "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, max);

function harden(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const ex = e => {
    const o = { name: clean(e?.name), scheme: clean(e?.scheme, 60) };
    const note = clean(e?.note, 80);
    if (note) o.note = note;
    // catalog match survives hardening (validated shape, bounded length)
    const ref = clean(e?.ref, 60);
    if (ref && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ref)) {
      o.ref = ref;
      const sc = Number(e?.refScore);
      if (Number.isFinite(sc) && sc >= 0 && sc <= 1) o.refScore = +sc.toFixed(3);
    }
    return o;
  };
  const out = {
    id: clean(doc.id, 60),
    title: clean(doc.title, 80),
    weeks: Math.min(52, Math.max(1, Math.round(Number(doc.weeks) || 6))),
    days: Array.isArray(doc.days) ? doc.days.slice(0, 14).map((d, i) => ({
      key: /^d\d+$/.test(d?.key || "") ? d.key : "d" + (i + 1),
      tab: clean(d?.tab, 30) || `Día ${i + 1}`,
      label: clean(d?.label, 80),
      blocks: Array.isArray(d?.blocks) ? d.blocks.slice(0, 20).map(b => ({
        title: clean(b?.title, 60),
        exercises: Array.isArray(b?.exercises) ? b.exercises.slice(0, 60).map(ex) : []
      })) : []
    })) : []
  };
  const sub = clean(doc.subtitle, 120);
  if (sub) out.subtitle = sub;
  if (Array.isArray(doc.warmup) && doc.warmup.length) out.warmup = doc.warmup.slice(0, 20).map(ex);
  return out;
}

/* Routines published before the catalog existed carry no refs, so the app would
   show no muscle guide. Fill the gaps on read with the free local ladder — never
   overwriting a ref an admin already reviewed. Not persisted: matching 25 names
   costs microseconds, and this way stored documents stay exactly as published. */
function ensureRefs(doc) {
  if (!doc?.days) return doc;
  const cache = new Map();
  const fill = e => {
    if (!e || e.ref) return;
    if (!cache.has(e.name)) cache.set(e.name, matchOne(e.name));
    const m = cache.get(e.name);
    if (m && m.id && m.score >= MIN_AUTO) { e.ref = m.id; e.refScore = m.score; }
  };
  (doc.warmup || []).forEach(fill);
  doc.days.forEach(d => (d.blocks || []).forEach(b => (b.exercises || []).forEach(fill)));
  return doc;
}

/* Idempotent: on first ever request, seed the store from the repo-bundled July routine. */
async function ensureSeed(store) {
  const index = await store.get("index", { type: "json" });
  if (index) return index;
  const seeded = { routines: [{ id: seedRoutine.id, title: seedRoutine.title, weeks: seedRoutine.weeks }] };
  await store.setJSON("doc:" + seedRoutine.id, seedRoutine);
  await store.setJSON("index", seeded);
  return seeded;
}

export default async (req, context) => {
  const store = getStore("routines");
  const id = context.params?.id;

  if (req.method === "GET") {
    const index = await ensureSeed(store);
    if (!id) return ok(index);
    const doc = await store.get("doc:" + id, { type: "json" });
    if (!doc) return err("not_found", `No routine with id '${id}'`, 404);
    return ok(ensureRefs(doc));
  }

  if (req.method === "POST" && !id) {
    const denied = requireAdmin(req);
    if (denied) return denied;
    let doc;
    try { doc = await req.json(); }
    catch (e) { return err("bad_json", "Request body must be valid JSON", 400); }

    /* Never trust the client, even an authenticated one: strip control
       characters, cap string lengths, and bound the overall document so a
       malformed or malicious publish cannot bloat storage. */
    doc = harden(doc);
    const exCount = (doc.days || []).reduce((n, d) =>
      n + (d.blocks || []).reduce((m, b) => m + (b.exercises || []).length, 0), 0);
    if (exCount > MAX_EXERCISES) {
      return err("too_many_exercises", `Routine has ${exCount} exercises; limit is ${MAX_EXERCISES}`, 413);
    }

    if (!validate(doc)) {
      return err("schema_invalid", ajv.errorsText(validate.errors, { separator: " | " }), 422);
    }
    const index = await ensureSeed(store);
    await store.setJSON("doc:" + doc.id, doc);
    const meta = { id: doc.id, title: doc.title, weeks: doc.weeks };
    const i = index.routines.findIndex(r => r.id === doc.id);
    if (i >= 0) index.routines[i] = meta; else index.routines.push(meta);
    await store.setJSON("index", index);
    return ok({ published: doc.id }, 201);
  }

  if (req.method === "DELETE" && id) {
    const denied = requireAdmin(req);
    if (denied) return denied;
    const index = await ensureSeed(store);
    if (!index.routines.some(r => r.id === id)) return err("not_found", `No routine with id '${id}'`, 404);
    await store.delete("doc:" + id);
    index.routines = index.routines.filter(r => r.id !== id);
    await store.setJSON("index", index);
    return ok({ deleted: id });
  }

  return err("method_not_allowed", "Unsupported method for this route", 405);
};

export const config = { path: ["/api/routines", "/api/routines/:id"] };
