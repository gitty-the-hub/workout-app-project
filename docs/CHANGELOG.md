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

## Phase 3 — LLM parsing core (complete)
- lib/parser.mjs: Claude vision call (claude-sonnet-5), image/PDF content blocks
- Forced structured output: routine.schema.json (dereferenced — inlined $refs) as the submit_routine tool schema with pinned tool_choice
- Validate -> repair loop: AJV errors fed back as tool_result, one retry, then clean failure
- /api/parse wired to real parser; contract unchanged; per-parse ops log (model, tokens, cost, latency); API error mapping (401/429/529)
- eval/run-eval.mjs harness vs July photo ground truth: 96.1% name accuracy avg, threshold 95% -> PASS; attempts always 1; ~$0.04/parse, ~15s
- Field lessons: temperature deprecated on sonnet-5 (removed); $ref-based tool schemas confuse the model (deref fix); secret env vars are write-only via CLI (local session key for evals)
- Production acceptance: July photo parsed end-to-end via deployed endpoint, days expanded, notes extracted, warmup separated

## Phase 4 — Admin upload/review/publish UI (complete)
- public/admin.html: unlisted console, token gate (sessionStorage), white/black theme
- Three explicit sources: Cámara / Galería / Archivo; drag-drop kept desktop-only
- Client-side image downscale (1600px, JPEG q0.8) before upload; friendly rejection of .docx/.pages/etc
- Full review editor: title/id/subtitle/weeks, warmup and every day/block/exercise editable, add/remove, ??? flagged, publish blocked until clean
- Publish -> POST /api/routines (server re-validates); routine list with open/edit/delete
- Tracker supports ?r=<id> deep links

## Phase 4.5 — Async parse pipeline (complete)
- Hit the real limit: synchronous functions are killed at 30s (2-page scanned PDF failed with 502, "No log", duration 30485ms)
- Background function (parse-background) + job records in Blobs + /api/parse-status polling with elapsed counter
- Second real limit: async invocations cap payloads at 256KB (fast 500s at 96/664ms on a 0.27MB image)
  -> /api/parse-upload stages the file in Blobs (sync, ~6MB allowed); background is triggered with { jobId } only; staged file deleted after the job
- Sync fallback when the background job cannot be started; stuck-queued detection
- Parser hardening from real routines: rules for weekly-percentage grids, column-per-day layouts, continuation sections, rest/RIR notes; sanitize unknown fields before validation; 3 attempts; empty payload -> no_routine_found
- Human-readable error mapping + "Detalle técnico" expander in the UI
- Verified end to end: photo -> parse -> review -> publish (Hypertophy - Strength, 5 weeks, 6 days)

Known issue carried to Phase 5: Netlify auto-deploy webhook stopped firing after the project was
temporarily disabled; deploys have been triggered manually since.
