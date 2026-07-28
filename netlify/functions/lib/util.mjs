/* Shared helpers for all functions.
   Lives in lib/ so Netlify does not deploy it as a function itself. */

/* Uniform response envelope: {ok:true, data} | {ok:false, error:{code,message}} */
export function ok(data, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

export function err(code, message, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/* Admin gate: requests must carry X-Admin-Token matching the ADMIN_TOKEN env var.
   Returns null when authorized, or a ready-to-return error Response. */
export function requireAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return err("server_config", "ADMIN_TOKEN is not configured on the server", 500);
  const given = req.headers.get("x-admin-token");
  if (given !== token) return err("unauthorized", "Invalid or missing X-Admin-Token header", 401);
  return null;
}
