# What Pickle catches — the pattern library

Pickle looks at your workspace the way a sharp ops manager would — not "here are your tasks," but "here's what's quietly going wrong." These are the patterns it surfaces.

## Within ClickUp

| Pattern | What it flags |
|---|---|
| **Stale in-progress** | Tasks marked "doing" for days with zero activity |
| **Expired promise** | "I'll do X by Friday" — Friday passed, nothing moved |
| **Zombie task** | Reopened or dragged forward repeatedly, never actually done |
| **Empty-description work** | High-effort tasks with no description — nobody knows what "done" means |
| **Blocker age** | Something's been blocked longer than anyone realizes |
| **Effort/output mismatch** | Hours logged, nothing shipped |
| **Standup copy-paste** | The same update three days running |
| **Recurring zombie** | A recurring task that's silently failing every cycle |
| **Description quality** | Vague titles that hide what the work actually is |

## Across tools (needs Slack / Teams connected)

These need chat data — connect a Slack or Teams token and Pickle can catch:

| Pattern | What it flags |
|---|---|
| **Decisions in DMs** | A call made in a thread that never became a task |
| **DM-only completion** | Work "done" in chat but never closed in ClickUp |
| **Ghost mode** | Someone active in chat but invisible in the task board |
| **Manager bottleneck** | Everything waiting on one person's reply |

## Two scan modes

- **Mode A — inbox:** things directed *to you* (asks, decisions, reviews) that you haven't answered.
- **Mode B — follow-up:** things *you* delegated or promised that nobody closed the loop on.

A good audit runs both, across every active channel — not a sampled subset.

## Requesting new patterns

Have a "how did this fall through?" moment Pickle should catch? [Open an issue](https://github.com/adityaarsharma/pickle/issues) — new patterns are the best contributions.
