# Codex Instructions — Notifications

Scope: `packages/notifications/**`.

Before editing, read:
- `.cursor/rules/23-notifications.mdc`
- `.cursor/rules/60-workers.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- PostgreSQL `NotificationDelivery`/source state is durable truth; Redis/BullMQ is transport/coordination.
- Delivery must be idempotent and recoverable through reconciliation.
- Re-read current reminder/preferences/source state before sending when stale jobs may exist.
- Cancel/reschedule must be able to invalidate stale queued work safely.
- Use bounded retries with explicit retryable/failed/skipped/delivered states.
- Email provider failures must be normalized; do not leak credentials/provider internals.
- User content in notifications/email must be sanitized/escaped for the rendering mode.
- Email opt-in and verification requirements remain server-authoritative.
- Avoid duplicate delivery under concurrent workers/retries.
- Add tests for stale jobs, duplicate execution, retry/reconciliation and preference changes when touched.
