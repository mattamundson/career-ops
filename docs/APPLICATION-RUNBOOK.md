# Application runbook (human loop)

Operational truth lives in [`data/applications.md`](../data/applications.md) and optional event log [`data/responses.md`](../data/responses.md). Agents draft; **you** submit and update status.

## After you submit to the employer ATS

1. In **`data/applications.md`**, set **Status** to **`Applied`** for that row (edit in place is allowed per `CLAUDE.md`).
2. Log the event (recommended):

   ```bash
   node scripts/log-response.mjs --app-id 025 --event submitted --date YYYY-MM-DD
   ```

3. When you receive an auto-ack or recruiter message:

   ```bash
   node scripts/log-response.mjs --app-id 025 --event acknowledged --date YYYY-MM-DD
   # or --event recruiter_reply --notes "..."
   ```

4. As the process advances, use `recruiter_reply`, `phone_screen`, `interview`, `offer`, `rejected`, or `withdrew` as appropriate (see [`scripts/log-response.mjs`](../scripts/log-response.mjs) header).

## Status quick reference

| You did | Set tracker status to |
|---------|------------------------|
| Decided to apply soon | `GO` |
| Blockers to clear first | `Conditional GO` |
| PDF/CL ready; final review before send | `Ready to Submit` |
| Started ATS form, not finished | `In Progress` |
| Clicked Submit on employer site | `Applied` |
| Company said no | `Rejected` |
| You are walking away | `Discarded` |
| Not a fit | `SKIP` |

Full definitions: [`docs/STATUS-MODEL.md`](STATUS-MODEL.md).

## Checklist queue

[`data/apply-queue.md`](../data/apply-queue.md) is a **working checklist**. When a checkbox action is done, update the tracker (and optionally the queue line) so stale cadence (`node verify-pipeline.mjs --stale-check`) reflects reality.

## Cadence

Run before focused sessions:

```bash
pnpm run verify:all
```

Or at minimum: `node verify-pipeline.mjs` and `node verify-pipeline.mjs --stale-check`.

## Ethics

Never mark **`Applied`** until **you** submitted. No automation clicks final Submit without your confirmation (`CLAUDE.md`).
