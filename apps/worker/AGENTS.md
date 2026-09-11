# Codex Instructions — Worker

Scope: `apps/worker/**`.

Before editing, read:
- `.cursor/rules/60-workers.mdc`
- `.cursor/rules/23-notifications.mdc`
- `.cursor/rules/40-billing-usage.mdc`
- `.cursor/rules/50-ai-gateway.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/72-observability-incidents.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- PostgreSQL is durable truth; BullMQ/Redis are delivery/coordination mechanisms.
- Jobs must be idempotent and safe under retry, duplicate delivery and worker crash.
- Re-read current authoritative state before irreversible/external delivery when stale jobs are possible.
- Persist durable intent/state before enqueueing where the existing design requires recoverability.
- A lost Redis queue must be recoverable from PostgreSQL reconciliation for durable workflows.
- Do not treat successful enqueue as successful business delivery.
- Bound retries and use explicit terminal/retryable/reconciliation states.
- Never retry potentially billable provider operations blindly.
- Do not log secrets, raw auth material or unnecessary user plaintext.
- Worker changes require tests for retry/duplicate/stale/crash semantics where relevant.
