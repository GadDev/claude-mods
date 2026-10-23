# Measuring useful reductions

The hypothesis is that focused source context can reduce exploratory reads without harming task success. A smaller packet alone is not evidence of lower end-to-end usage.

## Experiment

1. Choose a small repeatable task in a fixture repository with acceptance checks.
2. Record the repository revision, Claude Code build, provider, model, effort, installed plugins, and task prompt.
3. Start equivalent fresh sessions: ordinary workflow versus a Context Studio packet. Include packet preparation time and any extra reads needed to finish.
4. Repeat several paired trials, alternating order where practical. Keep model settings, starting source state, and acceptance checks consistent.
5. Compare task success first, then provider-reported input/output/cache tokens, number of tool calls, elapsed time, manual interventions, and total context added.

For Pro/Max, compare available usage evidence cautiously. Local API-equivalent cost is not the subscription bill, and a token reduction does not translate into an exact percentage of additional allowance. Cache behavior and Claude Code's existing result filtering matter.

## Report

| Field | Required evidence |
| --- | --- |
| Scenario | Fixed repository commit and task |
| Outcome | Acceptance checks and correctness review |
| Usage | Provider-reported totals, including follow-up work and any summarization |
| Local size | Exact character count; token heuristic explicitly marked estimated |
| Tradeoffs | Missing context, extra retrieval, user effort, failures, uncertainty |

Do not advertise a savings percentage until repeated end-to-end trials support it. No savings benchmark has been established for this prototype.
