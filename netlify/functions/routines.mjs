import { getStore } from "@netlify/blobs";
import Ajv from "ajv";
import schema from "../../schema/routine.schema.json" with { type: "json" };
import seedRoutine from "../../public/routines/july-2026.json" with { type: "json" };
import { ok, err, requireAdmin } from "./lib/util.mjs";

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
    return ok(doc);
  }

  if (req.method === "POST" && !id) {
    const denied = requireAdmin(req);
    if (denied) return denied;
    let doc;
    try { doc = await req.json(); }
    catch (e) { return err("bad_json", "Request body must be valid JSON", 400); }
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
