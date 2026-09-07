# Vimla — Architecture

## Monorepo

```text
vimla/
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    database/
    config/
    ai/
    billing/
    shared/
  .cursor/rules/
  docs/
```

## Runtime components

```text
Client
  |
Cloudflare/CDN (later/production)
  |
Next.js web
  |
Node/NestJS API
  |-----------------------|
  |           |           |
PostgreSQL   Redis      Object Storage
              |
            BullMQ
              |
            Worker
              |
          AI Gateway
              |
         ProxyAPIProvider
              |
           ProxyAPI
```

## Backend style
The API starts as one deployable modular monolith. A separate worker process handles asynchronous jobs. Logical boundaries are preserved so selected workloads can be extracted later if measured scale requires it.

## Core synchronous chat flow

```text
1. authenticate user
2. authorize account/resource
3. validate request/model
4. resolve plan/buckets
5. estimate maximum provider cost
6. reserve allowance transactionally
7. create ai_request record
8. call AI Gateway -> ProxyAPIProvider
9. stream response through Vimla
10. capture final usage/cost
11. settle actual charge and release unused reservation
12. persist message/result
13. emit metrics/logs
```

Provider call must never happen before step 6 succeeds.

## Async generation flow

```text
HTTP request
 -> validate/auth
 -> estimate/reserve usage
 -> create generation_job in PostgreSQL
 -> enqueue BullMQ job
 -> 202 Accepted + job id

Worker
 -> load job + reservation
 -> invoke AI gateway
 -> poll/await provider
 -> persist output to object storage
 -> settle usage
 -> mark job completed
```

## Financial state
PostgreSQL tables/domains will include:
- plans + plan_versions;
- subscriptions;
- payments + payment_events;
- usage_buckets;
- usage_reservations;
- usage_ledger;
- ai_requests;
- provider_cost_records;
- provider_balance_snapshots.

## Monetary representation
Use microRUB integers:

```text
1 RUB = 1,000,000 microRUB
```

Database: `BIGINT`.
Domain TypeScript: `bigint`.
Public JSON: decimal string or explicit amount DTO.

Do not use floats for authoritative calculations.

## Usage buckets
### Monthly subscription bucket
- created per billing period;
- expires at period end;
- provider-cost allowance derived from the plan version;
- used before top-up.

### Top-up bucket
- created after confirmed top-up payment;
- separate from subscription;
- default non-expiring unless product policy changes;
- retail amount and provider-cost budget are distinct values.

## Reservation/settlement
Reservation protects against concurrency/overspend.

```text
available = bucket total - settled charges - active reservations
```

Reservation must be atomic across concurrent requests. Settlement converts reserved amount into actual charge and releases the difference.

## AI abstraction

```text
AiGateway
  -> Router (initially simple explicit model mapping)
  -> AiProvider
       -> ProxyAPIProvider
```

Later providers can be added without changing product/billing layers.

## Model catalog
Vimla model record should conceptually include:
- Vimla model id/slug;
- display name;
- provider adapter;
- provider model id;
- capability flags;
- enabled/disabled;
- price version/reference;
- limits;
- usage tier/label;
- routing metadata.

## Payments
Use `PaymentProvider` abstraction. Build with mock first. Real provider selection can be T-Kassa/CloudPayments/etc. Domain must not depend on a specific SDK.

## Storage
PostgreSQL stores metadata. Files/images/video live in S3-compatible object storage. Use signed URLs or backend-mediated access as appropriate.

## Observability
At minimum record:
- request/correlation ID;
- user/account id (safe internal ID);
- Vimla model;
- provider/model;
- latency;
- token/media usage;
- actual/derived provider cost;
- reservation/settlement ID;
- error classification.

Never log secrets or sensitive raw customer content by default.
