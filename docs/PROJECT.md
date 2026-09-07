# Vimla — Product Description

## Vision
Vimla is a unified AI workspace for everyday users, creators and power users. Instead of maintaining separate subscriptions and interfaces for many AI tools, a user works in one product and can use different models/capabilities from the same account.

Long-term positioning: **one workspace, many AIs, finished work rather than model complexity**.

## Target users
Initial audience:
- regular AI users who currently switch between several products;
- creators who need text + image + video workflows;
- students/knowledge workers;
- developers/power users who care about explicit model selection;
- users who want simple pricing/usage instead of token accounting.

## V1 capabilities
1. Account/authentication.
2. Multi-model text chat.
3. Manual model selector.
4. Conversation history.
5. Subscription/usage system.
6. Arbitrary top-up.
7. ProxyAPI provider integration through Vimla AI Gateway.
8. Basic admin/financial observability.

## Later capabilities
- Auto model router;
- image generation;
- video generation;
- file uploads;
- projects/context workspaces;
- agents/workflows;
- model comparison;
- provider fallback/direct-provider adapters;
- advanced memory/context.

## Pricing assumptions
Initial product hypotheses:
- Lite: 150 RUB/month;
- Start: 300 RUB/month;
- Pro: 990 RUB/month;
- top-up: arbitrary RUB amount.

The exact plan benefits and provider-cost budgets must remain configurable and should be adjusted from measured COGS and retention.

## Usage experience
Subscription screen example:

```text
Monthly usage
████████████░░░░░░░░ 62%
38% remaining
Resets Oct 7

[ Top up ]
```

Users are not shown token pricing for every request. Expensive models/media naturally consume allowance faster.

## Provider/business arrangement for first commercial version
- Vimla is operated by a Russian LLC.
- Customer payments go to the LLC via a payment provider to the settlement account.
- ProxyAPI is the first AI gateway/provider and is funded by the LLC using its B2B account/invoice flow.
- Vimla maintains its own internal user usage ledger; the ProxyAPI corporate balance is not a user wallet.

## Non-goals for early MVP
- no custom foundation model training;
- no direct provider accounts required initially;
- no microservices;
- no unlimited expensive compute;
- no blockchain/internal transferable currency;
- no user-supplied provider keys as primary business model.
