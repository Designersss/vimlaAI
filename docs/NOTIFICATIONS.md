# Notification Platform (Phase 6.5)

PostgreSQL is the source of truth for reminder delivery and the in-app inbox. Redis/BullMQ is only the transport/execution layer. Clearing Redis must not permanently lose a notification: reconciliation re-creates jobs from `notification_delivery` rows that still need execution.

## Scope

Phase 6.5 delivers existing one-shot personal `WorkspaceReminder` rows over:

- `IN_APP` (persisted `user_notification`)
- `EMAIL` (existing `@vimla/notifications` SMTP/memory adapters)

Not in this phase: recurring reminders, Web Push, SMS, project reminders, marketing, or `@Vimla`.

## State machine (`notification_delivery.status`)

| Status | Meaning |
| --- | --- |
| `PENDING` | Created, waiting for a worker claim |
| `PROCESSING` | Claimed with a lease (`processingUntil`) |
| `DELIVERED` | Channel send completed (in-app row created, or email handed to the adapter) |
| `RETRYABLE` | Temporary email/network/abuse failure; `nextAttemptAt` is set |
| `FAILED` | Terminal failure (rejected/config/ambiguous, or retries exhausted) |
| `SKIPPED` | Will not send: canceled, rescheduled, archived/deleted, preference off, unverified email, or expired lateness |

A row is never marked `DELIVERED` only because a BullMQ job was enqueued.

## Preferences

Stored on `UserPreference` (no parallel preference table):

- `reminderInAppEnabled` default **true**
- `reminderEmailEnabled` default **false** (privacy/cost-safe; user opts in)

Email is sent only to the account’s **verified** address from PostgreSQL. The client cannot supply a recipient. Changing a preference is re-read by the worker before send. Already-terminal deliveries are not rewritten.

## Late policy

`REMINDER_MAX_LATENESS_MINUTES` (default 1440). After downtime, ordinary delays still deliver. Reminders older than the window are not emailed as if they were fresh: deliveries are `SKIPPED` with `errorCode=expired`, and the reminder is marked `FAILED` for observability.

## Retry / backoff (email)

Config: `NOTIFY_DELIVERY_MAX_ATTEMPTS` (6), exponential backoff from `NOTIFY_DELIVERY_BACKOFF_BASE_MS` capped by `NOTIFY_DELIVERY_BACKOFF_CAP_MS`.

- Retryable: `network`, `timeout`, `abuse`
- Final: `rejected`, `config`
- Ambiguous provider outcome: **no retry** (avoids uncontrolled duplicate email). Status `FAILED`, `errorClass=ambiguous`. SMTP/memory adapters are not exactly-once.

Worker-owned retries use PostgreSQL + reconciliation, not BullMQ `attempts`.

## Idempotency

Occurrence key: `reminder:{reminderId}:{scheduledAt.toISOString()}`.

Unique DB constraint: `(sourceType, sourceId, occurrenceKey, channel)`. In-app unique: `(userId, type, occurrenceKey)`. BullMQ `jobId` is `notification-delivery:{deliveryId}` and is extra protection only.

## Reconciliation

Repeatable BullMQ scheduler `reminder-reconcile` every `REMINDER_RECONCILE_INTERVAL_SECONDS` (default 60). The worker also runs one in-process reconcile after it is ready, so a Redis wipe + worker restart restores pending deliveries without waiting for the next tick. The scheduler uses BullMQ `upsertJobScheduler` (not `removeOnComplete: true` on a repeatable job) so cadence survives job completion.

Optional `WORKER_HEALTH_PORT` serves `GET /health` on `127.0.0.1` after PostgreSQL, Redis, workers, the scheduler, and the startup reconcile are ready. It is not a public API.

Each reconcile pass:

1. Finds due `PENDING` reminders that are not archived/deleted
2. Idempotently inserts needed `notification_delivery` rows (honoring current preferences, or `SKIPPED` if expired)
3. Recovers expired `PROCESSING` leases
4. Enqueues `PENDING`/`RETRYABLE` rows whose `nextAttemptAt` is due (up to 10× batch size per pass)

Expired due reminders are drained across additional rounds in the same pass (capped) so a large stale backlog cannot block newer occurrences forever.

## Worker claim

Jobs carry only `deliveryId`. The worker reloads PostgreSQL, claims with a lease, re-checks the reminder, preferences, and occurrence, then sends. Stale jobs after cancel/reschedule finish as `SKIPPED` without a user-visible send.

## Internal destinations

`hrefPath` is server-constructed (`/work/reminders` only). Arbitrary URLs are rejected by a CHECK constraint and stripped on read.
