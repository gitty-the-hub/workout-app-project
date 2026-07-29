# Gym Routine Generator

Photograph a workout routine — a paper sheet, a coach's PDF, a screenshot — and the app turns it
into a structured, trackable program. An admin reviews and corrects the parse before publishing;
users get a tracker with weekly progress, weight logging, PRs, charts, a rest timer and notes.

**Live:** https://workout-app-logan.netlify.app · **Admin:** `/admin.html` (token-gated, unlisted)

---

## How it works

```
Admin (browser)                 Netlify Functions                 Anthropic
--------------                  -----------------                 ---------
photo/PDF
  | downscale (1600px, q0.8)
  |-> POST /api/parse-upload --> stage file in Blobs
  |-> POST parse-background ---> read file --> Claude vision + forced tool --> routine JSON
  |        (jobId only)                 |        (validate -> repair -> validate)
  |<- poll /api/parse-status <---- job record in Blobs
        |
        v
   review & edit  --> POST /api/routines --> validated, hardened, stored in Blobs
                                                      |
User (browser) <-- GET /api/routines[/:id] <----------+
   progress in localStorage (per routine)
```

Two platform limits shaped this design, both discovered the hard way:

| Path | Max payload | Max duration |
|---|---|---|
| Synchronous function | ~6 MB | **30 s** |
| Background function (async invoke) | **256 KB** | 15 min |

A multi-page PDF parse exceeds 30 s, so it must run in a background function — but the file cannot
travel in that invocation, so it is staged in Blobs first and the job is triggered with only its id.

## Repository layout

```
public/
  index.html            Tracker (routine-agnostic engine)
  admin.html            Admin console: upload -> review -> publish
  routines/*.json       Static fallback copies of routines
netlify/functions/
  lib/parser.mjs        Claude call, forced schema output, repair loop
  lib/limits.mjs        Rate limit, usage ledger, blob sweep
  lib/util.mjs          Response envelope, admin auth
  routines.mjs          Routines CRUD (Blobs), hardening, validation
  parse.mjs             Synchronous parse (fallback path)
  parse-upload.mjs      Stage file for an async job
  parse-background.mjs  Async parse worker
  parse-status.mjs      Job polling
  usage.mjs             Month-to-date cost, rate usage
schema/routine.schema.json   The contract (engine + LLM tool schema + validation)
eval/                   Ground-truth cases and the scoring harness
docs/                   CHANGELOG, decisions
```

## API

All responses share one envelope: `{ok:true, data}` or `{ok:false, error:{code, message}}`.
Admin routes require the header `X-Admin-Token`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness |
| GET | `/api/routines` | — | manifest |
| GET | `/api/routines/:id` | — | routine document |
| POST | `/api/routines` | admin | publish/update (hardened + schema-validated) |
| DELETE | `/api/routines/:id` | admin | remove |
| POST | `/api/parse-upload` | admin | stage a file for an async parse |
| POST | `/.netlify/functions/parse-background` | admin | start the parse job (`{jobId}`) |
| GET | `/api/parse-status?job=<id>` | admin | poll: queued/running/done/error |
| POST | `/api/parse` | admin | synchronous parse (fallback, <30 s only) |
| GET | `/api/usage` | admin | month-to-date parses, tokens, cost |

## Environment variables

Set in Netlify -> Project configuration -> Environment variables (never in code):

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access (secret) |
| `ADMIN_TOKEN` | Gate for all admin routes (secret) |
| `PARSE_MODEL` | optional, defaults to `claude-sonnet-5` |
| `PARSE_LIMIT_PER_HOUR` | optional, defaults to `15` |

## Local development

```bash
npm install
netlify link          # once, links this folder to the Netlify project
netlify dev           # site + functions at http://localhost:8888
```

Secret env vars are write-only, so the CLI cannot read them back. To run anything that calls the
API locally, set the key for the current shell session only:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node eval/run-eval.mjs 3
```

## Evaluation

`eval/run-eval.mjs` parses each ground-truth image N times and scores the result against the
hand-verified JSON in `eval/expected/`: exercise-name accuracy, verbatim scheme accuracy, and day
structure. Threshold 95%. Run it after any prompt or model change — numbers beat impressions.

Baseline (July routine, claude-sonnet-5): **96.1% names, ~$0.04 and ~15 s per parse, 1 attempt.**

## Deploying

Push to `main`; Netlify builds and publishes automatically. Phase tags (`phase-0` … `phase-5`) mark
completed milestones — `git push --follow-tags` to publish them.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 502 + "No log", duration ~30 s | synchronous function timeout | use the async path (upload -> background -> poll) |
| Fast 500 (<1 s) on `parse-background` | payload over the 256 KB async limit | file must be staged via `/api/parse-upload` |
| `schema_invalid_after_retry` | model output does not fit the schema | check "Detalle técnico"; adjust prompt rules or the sanitizer |
| `no_routine_found` | the file contains no workout | wrong document — not a bug |
| Pushes stop deploying | webhook died (e.g. project was disabled) | relink the repo in Build & deploy |
| `temperature is deprecated` | newest models reject the parameter | determinism comes from the forced tool schema instead |

## Roadmap

Parked deliberately: user accounts with cross-device sync (Supabase), coach/client assignment and
progress visibility, exercise-name normalization across routines. Today every user's progress lives
in their own browser — private, free, and lost if they clear storage.
