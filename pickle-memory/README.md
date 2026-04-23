# Pickle Shared Memory

This folder holds the shared local memory used by `pickle-clickup`, `pickle-slack`, and `pickle-report`.

**Files:**
- `workspace.json` — workspace ID, member list, channel list (TTL: 24h for members, 6h for channels)
- `tasks.json` — recently fetched task details keyed by task ID (TTL: 1h per task)
- `report-memory.json` — per-channel, per-member behavioural patterns used by pickle-report (90-day rolling)

**Never commit these files.** They are excluded by `.gitignore`.

Created automatically on first run of any Pickle skill. Safe to delete — will be rebuilt on next run.
