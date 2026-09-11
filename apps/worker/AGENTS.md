# apps/worker — Codex guidance

This file extends the root `AGENTS.md` for BullMQ/background processing.

## Durable job semantics
- PostgreSQL durable state is authoritative; BullMQ/Redis is transport/coordination, not the only record that work exists.
- Jobs must be idempotent under duplicate delivery, retry, worker crash and Redis loss.
- Re-read authoritative DB state before externally visible side effects when the current workflow requires it.
- Stale jobs caused by cancel/reschedule/revoke must fail safely or become a no-op after DB revalidation.
- Use deterministic/stable job identifiers where the existing domain design relies on them.

## Failure / recovery
- Distinguish retryable, terminal, skipped/canceled and reconciliation-required outcomes.
- Do not acknowledge/mark durable work complete before the corresponding durable state transition is committed.
- Avoid holding long DB transactions around external network calls.
- Make recovery/reconciliation explicit for ambiguous external-provider outcomes.

## Security / secrets
- Queue payloads are external/untrusted boundaries: validate them.
- Never put secrets, auth headers, private chat plaintext or excessive sensitive content into queue payloads/logs.

## Testing
- Test retries, duplicate jobs, stale/canceled jobs and recovery after loss of Redis/worker interruption where relevant.
- Normal tests use mock providers only.

Read `.cursor/rules/60-workers.mdc`, `70-security.mdc`, `72-observability-incidents.mdc`, `80-testing.mdc`, plus the relevant notifications/billing/AI rules for the job being changed.
