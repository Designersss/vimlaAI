# Vimla — Domain Model

This document defines concepts, not final Prisma syntax.

## User
Owns conversations, files, projects, subscriptions and usage buckets.

## Plan / PlanVersion
`Plan` is stable identity (`lite`, `start`, `pro`). `PlanVersion` snapshots commercial values for a time range so old subscriptions remain auditable.

Example fields:
- retail price microRUB;
- billing period;
- provider-cost allowance microRUB;
- feature flags/limits;
- effective_from/effective_to.

## Subscription
References the purchased plan version and current billing period/status.

## Payment
Represents a customer payment intent/result. Contains provider IDs, amount, currency, purpose (`subscription`, `topup`), status and idempotency data.

## PaymentEvent
Stores processed provider webhook/event identity to prevent duplicate effects.

## UsageBucket
Authoritative pool of spendable internal allowance.

Types:
- `subscription_period`;
- `topup`;
- future `promo`/`adjustment` if needed.

Important fields:
- total allowance;
- expiration;
- priority/order;
- source payment/subscription;
- plan/top-up economics snapshot.

## UsageReservation
Temporary hold for a pending provider-consuming operation.

States may include:
- `active`;
- `settled`;
- `released`;
- `needs_reconciliation`.

A logical request may allocate reservations across more than one bucket if policy permits.

## UsageLedgerEntry
Append-only event describing authoritative usage movement.

Examples:
- grant;
- charge;
- release/adjustment;
- refund;
- expiration;
- admin correction.

## AiRequest
One provider-facing logical AI operation, including:
- user;
- Vimla model;
- provider/model;
- request type;
- reservation;
- status;
- input/output usage metadata;
- provider request ID;
- provider cost;
- timestamps.

## Conversation / Message
Product chat history. Keep model/provider execution metadata separate enough that conversation UI can evolve without becoming financial storage.

## GenerationJob
Persistent async image/video/agent job state. Queue IDs are execution references, not source of truth.

## ProviderAccountSnapshot
Operational treasury data such as ProxyAPI balance at a point in time. Never used as user allowance.
