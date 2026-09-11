# packages/notifications — Codex guidance

This file extends the root `AGENTS.md` for durable notifications.

## Durable delivery model
- PostgreSQL `NotificationDelivery`/notification state is authoritative; Redis/BullMQ is transport and coordination.
- Redis loss must be recoverable from PostgreSQL reconciliation.
- Delivery processing must be idempotent and safe under duplicate jobs, retries, stale jobs, cancellation and reschedule.
- Re-read authoritative reminder/preferences/state before externally visible delivery when required by the current platform flow.
- Do not let one channel's success incorrectly suppress another intended channel.

## Retry / lifecycle
- Preserve explicit delivery lifecycle semantics (pending/processing/delivered/retryable/failed/skipped or their current equivalents).
- Processing leases/tokens must recover cleanly after worker crashes.
- Retry scheduling must be bounded and must not create uncontrolled duplicate sends.

## Privacy
- Sanitize user-controlled text before constructing external messages where appropriate.
- Never log email credentials, auth secrets, full sensitive payloads or private Direct Chat plaintext.
- Local/test memory inbox behavior must not leak into staging/production.

## Tests
Test duplicate/retry/stale/canceled/rescheduled/reconciliation cases, not only happy-path send.

Read `.cursor/rules/23-notifications.mdc`, `60-workers.mdc`, `70-security.mdc` and `80-testing.mdc` before changes.
