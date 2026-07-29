# Retrospective — what each phase actually taught

**Phase 0 — Foundations.** Nothing technical, but it set the rule that made everything else calm:
history lives in Git, phases are tags, main is always deployable.

**Phase 1 — Engine/data split.** The schema written here was reused three times: rendering,
LLM output contract, server validation. Designing the data contract first is what made the AI
phase small instead of sprawling.

**Phase 2 — Backend skeleton.** Building health -> storage -> auth -> stub with no AI in the
loop meant that when the parser failed later, we never had to wonder whether the platform was
at fault.

**Phase 3 — LLM parsing core.** The certification-dense phase.
- Forced tool use (tool_choice + input_schema) is what guarantees shape; sampling parameters are not.
- `temperature` is rejected by claude-sonnet-5 — API surfaces change per model generation.
- $ref/definitions in a tool schema confuse the model; dereference before sending.
- Secret env vars are write-only through the CLI, so local evals need a session variable.
- Evals turn "it looks right" into a number you can defend.

**Phase 4 — Admin UI.** The review screen is the product's real safety feature: the first
successful parse titled the routine with the athlete's name, and a later published routine still
carried two typos and a missing exercise. Never auto-publish model output.

**Phase 4.5 — Async pipeline.** Two platform limits, discovered in production, that no tutorial
mentions together: synchronous functions die at 30s; async invocations cap payloads at 256KB.
The staged-file handoff is the standard answer. Diagnosis came from reading timings, not guessing:
a 30485ms failure means timeout, a 96ms failure means rejected-before-execution.

**Phase 5 — Hardening.** Guardrails around the only operation that spends money, plus documentation
written while the reasons were still fresh.

**If starting over:** keep the same order. The only thing worth doing earlier is the eval harness —
having ground truth before touching prompts would have made Phase 3's debugging faster.
