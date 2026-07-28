# Changelog

## Phase 0 — Foundations (complete)
- Repo scaffold: public/, netlify/functions/, schema/, eval/, docs/
- Seeded public/index.html with tracker v10 (all features, white/black themes)
- Seeded eval/july-2026.jpeg as first parser ground-truth case
- netlify.toml (publish=public, functions dir), .gitignore, README
- Pushed to GitHub: gitty-the-hub/workout-app-project
- Netlify Git-based auto-deploy live: https://workout-app-logan.netlify.app
- ANTHROPIC_API_KEY set as Netlify env var (Functions scope)
- Original drag-and-drop site (july-routine.netlify.app) kept frozen as-is

## Phase 1 — Engine/data split (complete)
- schema/routine.schema.json: formal contract (shared by engine, LLM output, validation)
- Routine data extracted to public/routines/july-2026.json (validated against schema)
- public/routines/index.json manifest
- Engine refactor: zero hardcoded exercises; renders title/subtitle/warmup/weeks/days from JSON
- Storage namespaced: app.prefs (unit/theme/lastRoutine) + routine.<id>.state; one-time non-destructive migration from legacy julyRoutine.v1
- Routine selector landing view; auto-enters single routine; remembers last opened
- Mobile/iOS optimizations folded into the main app (touch targets, 16px inputs, safe-area, audio unlock)

## Phase 2 — Backend skeleton (complete)
- package.json: @netlify/blobs, ajv; functions use modern v2 syntax (config.path routing)
- GET /api/health — deployment sanity check
- Routines API on Netlify Blobs: GET list/document (public), POST create-update + DELETE (admin), auto-seeded from repo july-2026.json on first request
- Server-side AJV validation against routine.schema.json on every write
- Admin auth: X-Admin-Token header vs ADMIN_TOKEN env var
- POST /api/parse stub with final contract: type allowlist (jpeg/png/webp/pdf), ~4.5MB limit, admin-gated
- Uniform envelope {ok,data}|{ok,error:{code,message}} across all endpoints
- Frontend consumes /api/routines with static-file fallback
- Local dev loop established: netlify-cli installed, PS execution policy fixed
- Production acceptance: health OK, Blobs-served routines OK, 401 without token, stub round-trip with token
