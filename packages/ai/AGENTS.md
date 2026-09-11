# packages/ai — Codex guidance

This file extends the root `AGENTS.md` for AI/provider integration.

## Provider abstraction
- Vimla must not be coupled directly to one provider. Keep provider access behind the repository's AI provider abstraction/adapters.
- Never call external AI providers from frontend code.
- Validate provider responses and usage metadata at the boundary.
- Internal model/provider IDs, pricing and limits are server-authoritative; never trust browser-supplied economics.

## Billing/cost safety
- Expensive provider calls must only happen after successful usage reservation.
- Preserve exact server-side price/model selection and usage settlement semantics.
- Missing/ambiguous provider usage or network outcomes require explicit reconciliation/anomaly handling; do not silently release reservations as if the request were free.
- Retries and duplicate client requests must not double-spend or double-settle.

## Privacy / logging
- Prompt and response content is sensitive. Minimize content logging.
- Never log provider keys, authorization headers, private Direct Chat context, confirmation tokens or raw sensitive payloads.
- Provider errors exposed to clients must be normalized and redacted.

## Testing
- Normal CI/test must use mock providers and must not spend real provider money.
- Cover no-usage/no-provider-call, duplicate request, malformed/missing usage, disconnect/ambiguous outcome and cost/rate/concurrency controls where relevant.

Read `.cursor/rules/50-ai-gateway.mdc`, `51-proxyapi.mdc`, `40-billing-usage.mdc`, `70-security.mdc` and `80-testing.mdc` before changes.
