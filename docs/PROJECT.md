# Vimla — Product Description

## Vision
Vimla is a single AI workspace for global consumer and prosumer users.

Instead of buying and learning many separate AI products, a user works inside Vimla and can choose a specific model/capability or let `Auto` choose an appropriate route.

Vimla is not merely a model catalog. The long-term product value is:
- one identity;
- one workspace;
- one billing/usage system;
- model/provider abstraction;
- projects and persistent context;
- multimodal creation;
- workflows and agents;
- intelligent routing.

## Core user surfaces
### Chat
- multi-model text chat;
- streaming responses;
- explicit model selection;
- `Auto` mode;
- conversation history.

### Create
- image generation;
- video generation;
- later audio/voice capabilities if commercially justified.

### Projects
- group conversations, files, generations and future agent context.

### Agents
Later phase:
- research;
- content creation;
- developer/coding workflows;
- other purpose-built workflows.

Agents must have hard execution budgets and cannot bypass the Usage Engine.

## Pricing/usage UX
Initial provisional plans:
- Lite — 150 RUB;
- Start — 300 RUB;
- Pro — 990 RUB;
- arbitrary top-up.

These are initial validation prices only and must be changeable without redeploying the application.

Users should not see token accounting per prompt by default.
Primary UI:
```text
Monthly usage
████████████░░░░░░░  62%
38% remaining
```

The percentage is presentation only.

## Internal economics
Vimla tracks real provider cost internally.
Initial provisional cost ceilings:
- Lite — provider cost budget up to 20% of subscription price;
- Start — up to 25%;
- Pro — up to 30%;
- arbitrary top-up — up to 35% of top-up amount.

These are versioned plan/business parameters, not immutable constants.

The system must remain safe if a user consumes 100% of the allowance. Unused allowance is upside, not a requirement for profitability.

## Initial provider
ProxyAPI is the initial provider gateway because it gives one Russian-paid API surface for multiple model families and media capabilities.

Vimla must never expose ProxyAPI credentials to users.
Provider balance is corporate infrastructure, separate from customer allowances.

## Business context
Initial operator: Russian LLC (ООО) with a T-Bank business account.

Customer payments and provider expenses are separate flows:
1. customer pays Vimla;
2. verified payment grants subscription/top-up entitlement inside Vimla;
3. company funds ProxyAPI separately based on aggregate provider burn;
4. each user operation reduces only that user's internal Vimla allowance.

## Product principle
The long-term default should become:

`user intent -> Vimla router -> best allowed AI capability -> finished result`

Manual model choice remains available for advanced users.
