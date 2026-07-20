# Sample Output — pickle-slack

> What `/pickle-slack 24h` looks like when it runs

---

```
════════════════════════════════════════
  🥒 pickle-slack · by Aditya Sharma
════════════════════════════════════════
⏱ Scanning: last 24 hours
📬 Modes: Inbox scan + Follow-up tracker

👤 Running as: Alex (U0ABCD1234) in workspace T012345
📋 Destination: Slack List "Pickle Inbox" (L567890) ✓
🔍 Discovered: 18 channels · 12 DMs · 4 group DMs

✓ #general — 54 in window
✓ #launches — 22 in window
✓ DM: Jordan — 11 in window
✓ DM: Sam — 7 in window
✓ mpim: design-crit — 15 in window
...

════════════════════════════════════════════════════
  🥒 pickle-slack · by Aditya Sharma
  📅 22 Apr 2026 · ⏱ last 24 hours
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT (1)
  • Approve release notes for v6.4 — @Jordan / #launches → [permalink]

  🟠 HIGH (2)
  • Review Q2 roadmap doc — @Morgan / DM → [permalink]
  • Customer on #support blocked — @Sam / #support → [permalink]

  🟡 NORMAL (3)
  • Feedback on new landing page — @Jordan / #design-team → [permalink]
  • Decision: Tuesday vs Thursday demo — @Alex / DM → [permalink]
  • Partner intro question — @Morgan / DM → [permalink]

  ⚪ LOW (1)
  • FYI check when free — @Jordan / DM → [permalink]

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • "Daily update" → @Sam · last received 2 days ago (recurring stopped) → [permalink]
  • "Banner sizes" → @Morgan · said "on it", no file received → [permalink]
  💡 Run /pickle-slack followup to confirm + send reminders

────────────────────────────────────────────────────

📊 STATS
  Inbox entries created     : 7
  Follow-up entries         : 2
  Slack reminders set       : 9
  Conversations scanned     : 18 channels · 12 DMs · 4 group DMs
  Messages in window        : 412
  Already actioned (memory skipped) : 5
  Skipped (errors)          : none

🔗 Slack List → slack://app.slack.com/lists/L567890

════════════════════════════════════════════════════
  Re-run: /pickle-slack [time]
  With follow-up: /pickle-slack [time] followup
  ClickUp counterpart: /pickle-clickup [time]
  Docs: https://github.com/adityaarsharma/pickle
────────────────────────────────────────────────────
  🥒 Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

All names are dummy.
