# ONE — Technical Architecture

## High-level

```text
Browser
  |
  v
Next.js Web
  |
  v
NestJS/Fastify API
  |
  +--> PostgreSQL  (source of truth)
  +--> Redis       (cache/rate limits/queues)
  +--> S3 storage  (files/media)
  |
  +--> PaymentProvider adapter
  |
  +--> Usage Engine
         |
         v
      AI Gateway
         |
         v
      ProxyAPI adapter
         |
         v
   GPT / Claude / Gemini / media models

BullMQ Worker
  +--> image/video jobs
  +--> agent jobs later
  +--> reconciliation
  +--> notifications
```

## Core bounded modules

### Auth/Users
Owns identity, sessions and authorization.

### Plans/Subscriptions
Owns plan definitions/versioning and active billing periods.

### Payments
Owns provider checkout creation, webhook verification, payment/refund state and idempotency.

### Usage
Owns usage buckets, reservation, settlement, expiration, adjustments and ledger.

### AI
Owns model catalog, provider adapters, streaming, model capabilities, routing and provider request metadata.

### Conversations
Owns conversations/messages and references to uploaded/generated assets.

### Generations
Owns image/video generation state and background-job orchestration.

### Admin
Read-heavy operational views and explicitly authorized adjustments/actions.

## Monetary units
Use integer micro-rubles:

```text
1 RUB = 1_000_000 microRUB
```

This gives enough precision for very cheap token usage while avoiding floating point drift.

## Suggested core data model

### users
- id
- email
- password_hash or auth-provider fields
- role
- created_at
- updated_at

### plans
- id
- code
- name
- price_rub_minor or payment amount representation
- active

### plan_versions
- id
- plan_id
- effective_from
- retail_price
- provider_budget_microrub
- model/feature entitlements JSON or normalized relation

### subscriptions
- id
- user_id
- plan_version_id
- status
- period_start
- period_end
- source_payment_id

### payments
- id
- user_id
- provider
- provider_payment_id
- type (`subscription`, `topup`)
- amount
- currency
- status
- idempotency_key
- created_at

### payment_events
- id
- provider
- provider_event_id UNIQUE
- payload_hash / safe metadata
- processed_at
- status

### usage_buckets
- id
- user_id
- type (`monthly`, `topup`, `promo`, `admin`)
- source_id
- granted_microrub
- consumed_microrub (optional cached aggregate)
- reserved_microrub (optional cached aggregate)
- expires_at nullable
- created_at

### usage_reservations
- id
- user_id
- operation_id UNIQUE
- estimated_microrub
- settled_microrub
- status
- created_at
- settled_at

### usage_allocations
Tracks how a reservation/settlement maps to one or more buckets.
- reservation_id
- bucket_id
- reserved_microrub
- settled_microrub

### usage_ledger
Append-only.
- id
- user_id
- bucket_id nullable
- reservation_id nullable
- operation_id
- entry_type
- amount_microrub signed
- idempotency_key UNIQUE
- metadata safe JSON
- created_at

### ai_models
- id (stable ONE id)
- provider
- provider_model_id
- kind
- enabled
- capabilities
- usage_tier
- max_output_tokens

### ai_model_price_versions
- id
- ai_model_id
- effective_from
- effective_to nullable
- structured price fields required for that model type

### ai_requests
- id / operation_id
- user_id
- conversation_id nullable
- ai_model_id
- provider_request_id nullable
- status
- input/output usage breakdown
- calculated_provider_cost_microrub
- reconciled_provider_cost_microrub nullable
- created_at
- completed_at

### conversations/messages
Store conversation domain data. Do not place billing truth in message records.

### generation_jobs
- id
- user_id
- type
- model_id
- status
- progress
- reservation_id
- provider_job_id
- output_file_id
- error_code
- timestamps

### provider_balance_snapshots
- provider
- balance_microrub
- captured_at

## Text request lifecycle

```text
request
  -> auth/rate limit
  -> resolve model + entitlement
  -> estimate maximum cost
  -> Usage.reserve() [atomic DB transaction]
  -> AI Gateway -> ProxyAPI (stream)
  -> collect terminal usage
  -> calculate actual cost by applicable price version
  -> Usage.settle()
  -> persist request/message
  -> emit refreshed usage to frontend
```

If reserve fails, ProxyAPI must not be called.

## Streaming
Use SSE/streamed HTTP response from API to web for chat. The stream parser must account for terminal provider chunks containing usage without text choices.

## Image/video
Image/video operations use persisted jobs + BullMQ workers. The HTTP request returns a job id quickly; frontend follows job state through SSE or polling.

## Reconciliation
ONE's immediate cost accounting must not depend on manually checking ProxyAPI.

Store enough usage/provider request metadata to later compare ONE-calculated cost with ProxyAPI's actual transaction/log amount. A scheduled worker flags material differences and produces admin metrics.
