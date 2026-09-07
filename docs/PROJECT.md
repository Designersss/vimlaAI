# ONE — Product Description

## Vision
ONE is a global AI workspace for ordinary users and power users. Instead of maintaining many separate AI subscriptions, a user gets one product with one account and a unified usage system.

ONE should eventually support:
- text/chat across multiple LLMs;
- manual model selection;
- Auto mode that selects an appropriate model;
- images;
- video;
- research and tools;
- reusable agents/workflows;
- projects/files/memory;
- a single subscription/top-up system across these capabilities.

The MVP should prove that users are willing to pay for the unified product before overbuilding the full platform.

## Key UX principle
Do not show an approximate RUB/USD price beside every prompt.

A subscriber sees a monthly usage bar, for example:

```text
Monthly usage
████████████░░░░░░░░ 61%
39% remaining
Resets October 7
```

Internally ONE tracks exact provider cost. The percentage is only a presentation layer over the user's allowance.

Users may also buy arbitrary additional usage. Top-up value and monthly subscription quota are separate buckets.

## Commercial model
Initial candidate price points are intentionally budget-friendly:
- 150 RUB tier;
- 300 RUB tier;
- 990 RUB tier;
- additional top-up by arbitrary amount.

These exact plans and their maximum provider-cost budgets are product configuration, not permanent code constants. The working economics discussed before implementation are approximately:
- 150 RUB plan: up to ~20% of price as AI provider budget;
- 300 RUB plan: up to ~25%;
- 990 RUB plan: up to ~30%;
- top-ups: up to ~35% provider-cost budget.

These ratios must be configurable/versioned because taxes, acquiring, provider prices and product strategy can change.

## Provider model
Initial production AI provider: ProxyAPI under the company's account.

ONE must never expose ProxyAPI as the product itself. ONE owns:
- accounts;
- UX;
- conversations/projects;
- billing;
- quota;
- model catalog;
- routing;
- agents/workflows;
- files;
- cost controls.

ProxyAPI is infrastructure behind ONE's AI Gateway.

## Payments
The payment provider is intentionally abstracted. The implementation must support a Russian company accepting payments through a provider such as T-Kassa/CloudPayments/YooKassa without coupling domain code to one processor.

For initial development, use a MockPaymentProvider/sandbox adapter so billing can be tested before production acquiring credentials are chosen.

## MVP user stories
1. User creates an account and logs in.
2. User sees available plans.
3. User purchases a plan in sandbox/mock mode.
4. Verified payment event grants a monthly usage bucket.
5. User opens Chat and chooses a model.
6. Chat response streams to the browser.
7. ONE reserves allowance before the provider call.
8. Actual usage settles against the reservation.
9. Usage percentage updates.
10. When monthly allowance is exhausted, user can buy a top-up.
11. Top-up creates an additional non-expiring usage bucket.
12. An admin can see revenue events, provider cost, current provider balance snapshot and per-model usage.

## Explicitly out of first milestone
Do not build these before core billing + text chat are correct:
- complex autonomous agents;
- marketplace;
- social features;
- Kubernetes/microservices;
- native mobile apps;
- elaborate organization/team billing;
- multi-region active-active infrastructure;
- custom model training.
