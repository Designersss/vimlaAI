# Vimla — Initial Decisions

## Accepted
- Product name: Vimla.
- Frontend: Next.js 16 + React 19 + TypeScript + MobX + SCSS Modules.
- Backend: Node.js TypeScript, NestJS + Fastify.
- Database: PostgreSQL + Prisma.
- Queue/cache: Redis + BullMQ.
- Architecture: modular monolith API + separate worker.
- First AI gateway/provider: ProxyAPI.
- ProxyAPI is hidden behind Vimla provider abstraction.
- Corporate model for first commercial release: Russian LLC -> provider/payment accounts.
- Subscription UX uses 0–100% usage.
- Arbitrary top-up is supported.
- PostgreSQL is source of truth for money/usage.
- Money/provider cost uses integer microRUB.
- Reservation/settlement is mandatory before/after AI calls.

## Business assumptions, not permanent decisions
- Lite ~150 RUB;
- Start ~300 RUB;
- Pro ~990 RUB;
- target provider-cost ratios ~20% / 25% / 30%;
- top-up target provider-cost ratio ~35%.

## Not decided yet
- real payment/acquiring provider;
- authentication vendor/library;
- S3-compatible object storage vendor;
- hosting/VPS/cloud provider;
- exact plan feature limits;
- exact models exposed at launch;
- whether top-up UI displays ruble face value, extra percentage, or both;
- refund/carryover policy details.

Do not invent final choices for `Not decided yet` items without explicit user instruction. Implement abstractions/foundations that keep these choices replaceable.
