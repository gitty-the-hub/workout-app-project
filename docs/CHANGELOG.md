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

## Phase 5 — Hardening (complete)
- 5.0 Netlify repo relinked; auto-deploy webhook restored
- 5.1 Rate limit: 15 parses/hour (PARSE_LIMIT_PER_HOUR), 429 with a human message
- 5.2 Blob sweep: job records >24h and staged files >1h removed on each new job
- 5.3 Usage ledger: monthly parses/tokens/cost in Blobs, GET /api/usage, shown in admin header
- 5.4 Publish hardening: control chars stripped, strings clamped, days/blocks/exercises bounded, 400-exercise cap
- 5.5 UX: install tip (Add to Home Screen), routine-selector empty state
- 5.6 README rewritten as handover doc (architecture, platform limits, API, env vars, eval, troubleshooting)
- 5.7 Eval suite grown to 2 cases; hypertrophy ground truth transcribed from the photo

### Final eval baseline (claude-sonnet-5, 3 runs each)
| case | names | schemes | attempts | cost | time |
|---|---|---|---|---|---|
| july-2026 (simple table) | 96.1% | 88.2% | 1 | ~$0.045 | ~13s |
| hypertrophy-strength (weekday grid, % progressions) | 96.1% | 94.1% | 1 | ~$0.059 | ~21s |

Identical scores across runs: extraction is deterministic in practice without a temperature
parameter — the forced tool schema does that work.

Known, accepted divergences (representation choices, not defects):
- "(KB)"-style modifiers: model prefers note, July ground truth keeps them in the name
- weekly percentages: model emits one entry per week (rule 14), ground truth folds them into the block title
- Saturday "Rest" cell: model promotes it to a 7th day, ground truth keeps it as a block

## Phase 6 — Visual identity & Logan (complete)
- 6.1 Palette derived from the mascot (wood tones, bark ink, forest green) for both themes;
      Oswald display face for headings and timer; faint wood-grain wash on cards; chart recoloured
- 6.2 Two-voice copy system: COPY table with `logan` and `plain` variants + t() helper,
      so personality and minimal mode share one source of truth
- 6.3 Logan in six moments: rest timer (breathing → fist-up at zero), PR toast (flex),
      day-header expression (ready/focused/pumped/tired from session state),
      day & week completion overlay with falling leaves, empty state (clipboard),
      admin parsing (thinking pose)
- 6.4 Micro-interactions: checkbox press, tab/week-pill tap, toast bounce, eased progress bar;
      all disabled under prefers-reduced-motion
- 6.5 Synthesized sfx (wooden thunk / PR arpeggio / completion fanfare) via the existing
      AudioContext — no audio files; off by default, toggle shares the iOS gesture unlock
- 6.6 Minimal mode: one switch hides mascot + animations and reverts copy to neutral Spanish
- 6.7 PWA: manifest, theme colours, pine-badge icons (home screen, apple-touch, maskable, favicon);
      admin console adopts the palette while staying tool-like
- Assets: 12 Logan sprites (ChatGPT-generated to a written spec), cleaned/trimmed/quantised —
      masters 1.5MB, served set 325KB; tools/build-sprites.py regenerates everything
- Typography follow-up: section labels 0.62→0.72rem, day header 0.76→1.02rem;
      fixed dangling separator when a day has no muscle-group label
