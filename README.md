# Gym Routine Generator

Upload a photo/PDF of any workout routine; the app parses it with the Claude API
into a structured JSON, the admin reviews and publishes it, and end users get a
full tracker: weekly progress, weight logging (kg/lb), PR highlights, progression
charts, session dates, rest timer, day notes, and white/black themes.

## Structure

```
public/             Frontend (tracker + admin page)
netlify/functions/  Backend (parse, routines API)
schema/             routine.schema.json — the data contract
eval/               Test inputs + expected outputs for parser evaluation
docs/               Decisions, changelog, phase notes
```

## Local development

```
npm i -g netlify-cli
netlify dev
```

## Environment variables (set in Netlify UI)

- `ANTHROPIC_API_KEY` — Claude API key (Functions scope). Never in frontend code.

## Project plan

See `../workout-app-project-plan.md` (phases 0-5). Each completed phase is a Git tag.
