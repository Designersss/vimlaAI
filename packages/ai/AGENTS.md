# Codex Instructions — AI

Scope: `packages/ai/**`.

Before editing, read:
- `.cursor/rules/50-ai-gateway.mdc`
- `.cursor/rules/51-proxyapi.mdc`
- `.cursor/rules/40-billing-usage.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- Provider access goes through Vimla abstractions (`AiGateway -> AiProvider -> adapter`). Do not couple product/domain code directly to ProxyAPI HTTP details.
- Frontend-facing model IDs are Vimla IDs; provider model IDs/prices/caps are server-owned.
- Provider-consuming work must start only after successful usage reservation and security/rate/concurrency/cost gates.
- Server controls context, output cap, cost cap and safety margin.
- Provider actual COGS and user-settled usage are separate facts.
- Missing/ambiguous usage or network outcome is not free usage. Preserve reconciliation/hold evidence.
- Do not automatically retry potentially billable requests.
- Client disconnect after provider start does not prove zero provider cost.
- AI output and chat context are untrusted data; never promote model text to authorization/tool authority.
- CI/default tests use mock providers and must not spend real provider money.
- Provider adapter responses are external input and require validation/normalization.
