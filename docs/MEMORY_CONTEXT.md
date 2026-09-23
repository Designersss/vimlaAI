# PR-17 — Durable Memory and Compacted Context

## 1. Source-of-truth rule

Memory and compacted state are derived context. They never replace raw messages, projects, workspace objects, artifacts, or other authoritative source records.

Context ranking keeps this order:

```text
authoritative structured source > raw source > derived compacted state / memory
```

A frozen `ContextSnapshot` may contain a Memory reference, but access and source provenance are rechecked before a new snapshot/bundle is created.

## 2. Memory scopes and types

Supported scopes:

- `PERSONAL`
- `PROJECT`
- `CONVERSATION`
- `THREAD`

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

Personal Memory API:

- `GET /v1/memory`
- `GET /v1/memory/:id`
- `POST /v1/memory`
- `PATCH /v1/memory/:id`
- `DELETE /v1/memory/:id`

Delete is logical invalidation, not physical destruction of audit history. Invalidated/superseded/expired records are excluded from future retrieval.

The entire surface is fail-closed behind `MEMORY_ENABLED=false` by default.

## 4. Automatic extraction policy

PR-17 provides a conservative extraction pipeline for already-proposed candidates. It does not hard-code natural-language keywords and does not promote every message.

A candidate is skipped when it is:

- marked transient / one-off;
- below the minimum confidence threshold;
- secret-like (password, private key, API key, OTP, bearer/access token, payment-card/CVV material, and related patterns);
- sourced from Direct Chat / E2EE context.

Automatic candidates require source provenance. Updating/deleting/revoking the source makes dependent memory ineligible and lazily invalidates it before retrieval.

Production background/model candidate generation is deliberately separate from this persistence/policy boundary; PR-17 does not add a second paid or hidden model call.

## 5. Project isolation and cross-scope writes

Project Memory is readable only by current project audiences.

A source that is already project-scoped may write Project Memory. A personal/private source cannot mutate Project Memory merely because it mentions a project: that requires an explicit authorized cross-scope write.

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

A refresh is accepted only when raw-history token usage meets the effective executor/model `compactedStateTriggerTokens`. There is no primary “every N messages” rule.

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

Memory does not get automatic semantic-vector indexing in PR-17; semantic retrieval remains source-based and E2EE exclusions from PR-15/PR-16 remain unchanged.

## 9. Rollout

Keep `MEMORY_ENABLED=false` until the PR-17 migration is deployed and validation is green. Enabling Memory affects future snapshot construction; already frozen snapshots remain immutable.
