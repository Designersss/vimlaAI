# PR-17 — Durable Memory and Compacted Context

## 1. Source-of-truth rule

Memory and compacted state are derived context. They never replace raw messages, projects, workspace objects, artifacts, or other authoritative source records.

Context ranking keeps this order:

```text
authoritative structured source > raw source > derived compacted state / memory
```

A frozen `ContextSnapshot` may contain a Memory reference, but access and source provenance are rechecked before a new snapshot/bundle is created.

## 2. Memory scopes and types

Schema scopes:

- `PERSONAL`
- `PROJECT`
- `CONVERSATION`
- `THREAD`

`THREAD` is reserved in the PR-17 data model but remains fail-closed at runtime until PR-18 supplies thread authority/ACL semantics.

Initial types:

- personal: `USER_FACT`, `USER_PREFERENCE`, `USER_GOAL`, `USER_RELATIONSHIP`
- project: `PROJECT_FACT`, `PROJECT_DECISION`, `PROJECT_STATE`
- state: `CONVERSATION_STATE`, `THREAD_STATE`
- shared typed records: `DECISION`, `ENTITY_RELATION`

Every `MemoryItem` stores a normalized scope key, typed slot, classification/sensitivity, confidence/quality, generation, valid-from/expiry, provenance/source refs, supersession state, invalidation state, and user confirmation/correction markers.

Only one ACTIVE item may exist for one `scopeKey + slotKey`. Writes are serialized with a PostgreSQL advisory transaction lock, so concurrent updates create a deterministic generation/supersession chain rather than competing current facts.

## 3. Supersession and user control

A correction does not mutate an old fact in place:

```text
old ACTIVE item
 -> SUPERSEDED
 -> new USER_CORRECTION generation
```

User-confirmed, user-corrected, explicit, and E2EE-promoted memory cannot be silently replaced by automatic inference. A later automatic candidate for that slot returns the existing confirmed/corrected truth.

Memory API:

- `GET /v1/memory`
- `GET /v1/memory/:id`
- `POST /v1/memory`
- `PATCH /v1/memory/:id`
- `DELETE /v1/memory/:id`
- `POST /v1/memory/projects/:projectId` — explicit authorized Project Memory write
- `POST /v1/memory/e2ee-promotions` — explicit E2EE fact promotion

Private-chat automatic extraction writes only Personal Memory. Project Memory is never mutated merely because a private message mentions a project; the project endpoint is an explicit cross-scope action and still re-checks current Project write capability.

Delete is logical invalidation, not physical destruction of audit history. Invalidated/superseded/expired records are excluded from future retrieval.

The entire surface is fail-closed behind `MEMORY_ENABLED=false` by default.

## 4. Automatic extraction policy

PR-17 runs automatic extraction as durable background maintenance for persisted non-E2EE USER messages. Message persistence atomically creates a PostgreSQL `MemoryExtractionReceipt` with `QUEUED` state; a reconciler claims/retries receipts idempotently, so process failure after the user request cannot silently lose the maintenance intent.

Candidate generation uses the included/internal semantic-model boundary, never the paid external-model billing path. The local/test adapter has deterministic Memory/compaction responses so the real module wiring is testable.

A candidate is skipped when it is:

- marked transient / one-off;
- below the minimum confidence threshold;
- secret-like (password, private key, API key, OTP, bearer/access token, payment-card/CVV material, and related patterns);
- marked `SENSITIVE` by the extraction contract;
- secret-like (password, private key, API key, OTP, bearer/access token, payment-card/CVV material, and related patterns);
- sourced from Direct Chat / E2EE context.

The extraction contract requires the included/internal model to classify health/medical, religion, political affiliation, union membership, sexual/intimate, criminal/legal, biometric, precise-location, and financial-account facts as `SENSITIVE`; automatic retention rejects any candidate carrying that classification. Independently, deterministic secret-pattern checks reject credentials, private keys, OTPs, bearer/access tokens, and payment-card/CVV material after model output.

Automatic candidates require source provenance. Same-content automatic facts retain at most 32 independent supporting MESSAGE refs; one stale source does not invalidate a fact while another supporting source is still current. Updating/deleting/revoking all supporting sources makes the Memory item ineligible and lazily invalidates it before retrieval.

Receipt retries are bounded to five attempts. Completed/skipped/terminal failed maintenance receipts are technical coordination data and are pruned after 30 days; Memory/L2 provenance history is not pruned by this housekeeping.

## 5. Project isolation and cross-scope writes

Project Memory is readable only by current project audiences.

A source that is already project-scoped may write Project Memory. A personal/private source cannot mutate Project Memory merely because it mentions a project: that requires an explicit authorized cross-scope write bound to the exact target `projectId`. A generic boolean bypass is not accepted.

Conversation-scoped Memory and L2 are equally strict: every MESSAGE/compacted source contributing to a Conversation target must belong to that exact conversation. Same-user cross-conversation provenance is rejected rather than silently contaminating the target scope.

If project membership is revoked:

- Project Memory is no longer readable by that user;
- personal derived memory whose provenance depends on that project becomes stale/inaccessible and is invalidated on the next eligibility check;
- no project-derived Memory leaks into another project's audience.

## 6. Explicit E2EE promotion

Ordinary Direct Chat plaintext is never automatically ingested into server Memory.

The only durable bridge is explicit user disclosure:

```text
client already decrypted Direct Chat
 -> user explicitly selects/approves one fact to remember
 -> POST /v1/memory/e2ee-promotions
 -> server verifies actor currently belongs to the referenced Direct Chat
 -> stores only the submitted approved fact
 -> MemorySourceRef provenance = E2EE_USER_DISCLOSURE
 -> source conversation/message metadata retained, unrelated plaintext not retained
```

This is Mode B from PR-16/PR-17. It does not index the rest of the Direct Chat, does not create a server plaintext archive, and does not enable automatic E2EE extraction.

## 7. Budget-driven L2 compacted state

Compaction is versioned derived state, separate from durable facts.

A refresh is accepted only when conservative raw-history token usage meets the effective executor/model `compactedStateTriggerTokens`. There is no primary “every N messages” rule.

PR-17 uses one shared conservative budget unit: one UTF-8 byte is counted as one token unit. This deliberately overestimates many real tokenizers so admission/compaction cannot undercount multilingual input; it is not presented as an exact provider tokenizer.

Each state preserves:

- scope/version;
- source refs + source fingerprint;
- covered first/last source IDs and timestamps;
- source count;
- input/output token estimates;
- classification and validity;
- invalidation/supersession reason.

A new version invalidates the previous active L2 state. Updating a covered raw source or losing source access makes the current state ineligible and invalidates it. Raw history stays authoritative and retrievable.

## 8. Context retrieval

When `MEMORY_ENABLED=true`, orchestration adds two derived providers to the existing Context retrieval pipeline:

- `MemoryRetrievalProvider`
- `CompactedStateRetrievalProvider`

Providers can only contribute existing allowed derived source types, with `authority=DERIVED`. Core Context code reattaches retrieval metadata and applies ContextPolicy, audience checks, classification rules, source contribution caps, token budgets, and deduplication.

Memory retrieval filters for lexical relevance before its bounded result window, so a large set of newer unrelated rows cannot hide an older relevant fact. L2 retrieval always reserves the current-conversation state separately from authorized Project states. Provider input also carries an optional `currentProjectId`; when a Project surface supplies it, Project Memory/L2 are marked `currentProject` and receive the existing current-project ranking boost. Private-chat surfaces intentionally pass no current project.

Memory does not get automatic semantic-vector indexing in PR-17; semantic retrieval remains source-based and E2EE exclusions from PR-15/PR-16 remain unchanged.

## 9. Rollout

Keep `MEMORY_ENABLED=false` until the PR-17 migration is deployed and validation is green. Enabling Memory affects future snapshot construction; already frozen snapshots remain immutable.

When enabled, request handlers only persist the user message and durable maintenance receipt. Extraction/compaction model calls happen in the reconciler and never delay SSE completion. PostgreSQL remains the maintenance source of truth; the reconciler is coordination/execution only.
