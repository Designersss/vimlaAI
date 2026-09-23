# PR-15 — Semantic retrieval / embeddings

Implements the next stage of [roadmap #33](https://github.com/Designersss/vimlaAI/issues/33) after PR #66 / Context retrieval v1. Semantic search augments the existing lexical retrievers, immutable snapshots and audience/target-aware bundles. It does not enable orchestration in production.

## Provider and configuration

Only **included, operator-managed self-hosted inference** is supported. This follows the existing internal Semantic Planner boundary. No paid fallback, mock provider selection, external-AI allowance debit, or direct browser provider access is added. Pointing this adapter at a billed endpoint violates its deployment contract; a future paid adapter needs separate embedding-specific admission, reservation and settlement.

`EMBEDDING_PROVIDER=disabled` is the default. To configure the real adapter on API and worker together:

- `EMBEDDING_PROVIDER=internal-http`
- `EMBEDDING_INTERNAL_CONFIRMED=true`
- `EMBEDDING_BASE_URL`: trusted internal OpenAI-compatible API root, ending in `/v1` where applicable
- `EMBEDDING_MODEL`: exact model name returned by that endpoint
- `EMBEDDING_MODEL_REVISION`: immutable weights/tokenizer revision; do not reuse a revision after changing weights
- `EMBEDDING_DIMENSIONS`: 1–2000, matching the actual model output, default 768
- `EMBEDDING_TIMEOUT_MS`: 1000–30000, default 10000
- optional `EMBEDDING_API_KEY`

The adapter calls `/embeddings`, sends input and a stable idempotency header, rejects redirects, bounds responses at 2 MB, restores indexed result order, and rejects missing/duplicate indices, incorrect models, zero/nonfinite vectors and dimension mismatch. Timeout/network errors are normalized without provider text. Pin model weights operationally: the revision is operator attestation, not remote proof. Secure the internal endpoint, disable its content logging and apply network egress restrictions.

## Sources and scope

Concrete adapters support ordinary personal `Message` rows, personal notes, project name/description, and authorized inline artifact versions. Message roles/status are allowlisted; incomplete messages are not indexed. Notes are losslessly chunked by UTF-8 code points into at most 32 chunks of 2048 bytes; oversized sources are skipped, not silently truncated. All source texts use the same bounded chunk policy. Query text is capped at 8192 bytes. Secret filtering happens before inference for source and query text; it is defense in depth, not a guarantee that arbitrary sensitive content can be recognized.

Existing tasks/reminders/lists retain lexical retrieval. File contents, L2 state, Personal/Project/Decision Memory do not yet have durable authoritative source implementations. `SemanticSourceResolver` is the extension boundary; adding these sources requires their real provenance/ACL implementations and an explicit registry migration. PR-15 does not invent synthetic memory, file fetching, or PR-17 writers.

Direct Chat tables and ephemeral decrypted handoffs are never indexed. There is no Direct Chat source kind in the database allowlist. Existing database scopes are personal user and project; there is no separate organizational tenant model to fabricate.

## Durable lifecycle

`semantic_source` is a disposable index registry and durable outbox. It stores references, ownership/scope, revision, generation, fingerprint, state, lease and bounded retry metadata, not source text. `semantic_chunk` stores vectors and chunk fingerprints, not plaintext. Embeddings are still sensitive derived personal data and need the same database access, backup and retention protections as their sources.

Database triggers invalidate chunks and enqueue current-source work in the same transaction as supported source changes. Notes track child-table updates as well as soft deletion. Artifact version changes invalidate prior index state. Source deletion removes the registry and cascades chunks. Project and artifact permission revocation are evaluated on every search and again at bundle resolution; shared vectors need not be deleted while other authorized users still need them.

Worker polling processes up to four durable jobs every 30 seconds without depending on Redis delivery. PostgreSQL row locks, unique keys, a global claim lock, two active indexing leases and 90-second fenced lease tokens coordinate replicas. Provider calls occur outside transactions. A worker rereads source content after inference and commits only if source revision, fingerprint, generation and its unexpired lease remain current. Changed/deleted sources cannot be resurrected by late results.

States: PENDING → RUNNING → READY/SKIPPED, or bounded retry → FAILED. Five failed attempts exhaust retries; failed sources become eligible after a source or model revision changes. Rate-limited jobs are deferred without consuming a retry. Expired jobs are recovered and a crashed final attempt becomes FAILED. Repeated delivery after READY makes no provider call. A crash after inference but before commit may repeat **included read-only inference** with the same idempotency key; this is not a claim of exactly-once network execution and is not safe for an unmetered paid adapter.

`semantic_generation` records provider/model/revision/dimensions/chunk-policy identity. New registered generations supersede older ones. Existing older workers cannot revert newer registered generations. Registering a new identity is a rollout action: coordinate API/worker configuration and use a new revision even for an intentional rollback. Do not deploy multiple previously unregistered model identities simultaneously. Rollover updates at most 100 source references per batch; query filtering excludes old-generation results immediately. Rebuilding may temporarily reduce recall while lexical retrieval remains available.

## Retrieval and safety

1. Re-resolve the persisted actor-owned planning-stage plan and query.
2. Admit included inference through PostgreSQL global/per-user counters (60/10 calls per minute, shared with indexing); denial rolls back counter increments.
3. Build the query embedding through the dedicated provider.
4. Materialize current authorized source candidates before cosine distance/top-k. Owner/project/grant prefilters are not authorization: authoritative source joins and source loaders still check current access.
5. Require similarity ≥0.55, select the best chunk per source before capping hits at 48 and hydrated distinct sources at 12. Re-read each source, generation, revision and fingerprints. Notes contribute one selected chunk per source to retain snapshot uniqueness.
6. Merge semantic, lexical and explicit-reference evidence. Existing surface priority, source authority, diversity, token budgets, classification and audience checks remain authoritative.
7. Freeze normal ContextSnapshot items. Each invocation still obtains its own ContextBundle after current audience/target/source checks. Internal scores and fingerprints are removed by the existing renderer.

This stage uses **exact scoped cosine search**, not ANN. It preserves authorization-before-top-k semantics for restrictive scopes and supports varying dimensions without mixing models. B-tree indexes support scope/job lookups; pgvector provides vector validation/distance. A 1500 ms database statement deadline bounds retrieval. Measure authorized-corpus sizes and query latency before rollout; large corpora may hit lexical fallback and require a later scoped ANN design. No large-scale latency claim is made here. PostgreSQL failures and provider failures produce content-free diagnostic codes and retain the existing lexical path; failed authorization never becomes an index authorization grant.

Embedding and retrieval output never grants identity, permission or tool authority. Model-generated artifacts remain untrusted evidence. Existing prompt data boundaries and server-side typed tool policy prevent retrieved instructions from becoming executable authority. Relevant malicious source content can still influence model answers: the index is not a content-truth oracle.

## Migration and operations

Migrations `20260923120000_semantic_retrieval` and `20260923123000_semantic_integrity` are additive. The first requires pgvector 0.8.2+ installed in PostgreSQL 16 before `prisma migrate deploy`. CI and Compose use `pgvector/pgvector:0.8.2-pg16`. Native test PostgreSQL must install the extension binaries too. Never use production credentials for tests.

The migration is additive and backfills **references only** to existing eligible sources. It does not perform inference. For large existing databases, rehearse backfill duration, storage growth and write-lock behavior on a production-sized copy before deployment; migration execution is distinct from enabling the feature. Source-trigger maintenance remains active while inference is disabled. Disabling API and worker inference is the first rollback step; existing lexical retrieval remains available. Keep the schema until a separately reviewed removal migration; no historical migrations or source data should be deleted for rollback.

Monitor `semantic.index.batch`, `EMBEDDING_FAILED`, `SEMANTIC_WORKER_UNAVAILABLE`, `SEMANTIC_UNAVAILABLE`, `RATE_LIMITED`, READY/PENDING/FAILED/SKIPPED counts and oldest pending age. Logs contain codes/counts, not prompts, vectors, provider responses or raw source IDs. Retired-generation metadata is small; vectors are overwritten/invalidated as sources transition. Admission records contain user references; enabled worker maintenance removes expired counters older than 24 hours in batches of 1000. Include index/counter tables in account-erasure and backup-retention procedures.

## Verification

Unit and local HTTP contract tests cover Unicode chunking, source bounds, generation identity, hybrid relevance, disabled/invalid configuration, response shape/dimensions, redirects, timeouts and oversized provider responses. Real PostgreSQL/pgvector integration covers retrieval outside lexical scans, user/project isolation, grant revocation, note updates/deletion, artifact versions, concurrent claims, stale completion, crash recovery, generation changes, credential exclusion and admission concurrency. Existing ContextPolicy, planning, External AI/Vimla executor and browser workflow suites remain required regression gates.
