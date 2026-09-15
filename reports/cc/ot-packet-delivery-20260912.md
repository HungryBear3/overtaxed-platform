# OT T2 packet download, orphan quarantine, delivery orchestration

Prepared 2026-09-12. Local implementation, local commit, synthetic fixtures and
tests only. No push, PR, merge, deploy, migration run, environment or secret
change, database access, Stripe call, provider call, email, or customer contact
was performed or is implied by this candidate. Every new surface is default-off.

| | |
|---|---|
| Worktree | `/Users/abigailclaw/cc-worktrees/ot-paid-current-20260912` |
| Branch (local only) | `abigail/ot-paid-current-20260912` |
| Base | `d5ae760b7a5aa8fe6388802af9b3c5096f675472` |
| Verification | `npx jest` — 159 suites / 3204 tests passed (4 suites, 77 tests skipped, as at base); `npx tsc --noEmit` — clean |
| Dependencies | `node_modules` symlinked to `…/ot44-release-candidate-20260912/node_modules` after verifying `package.json` and `package-lock.json` are byte-identical. No install, no `prisma generate`, no generated client produced. |

---

## 1. Unit A — secure T2 customer packet download (default-off)

### The problem

`OTOrder` is anonymous: it has no `userId`, and its `email` is an unverified
checkout field. There is therefore no ownership claim on an OT order that can be
authenticated, and nothing in this unit reads a session, an email, or any other
identity. (The account-owned `Invoice`-backed packet download at
`app/api/account/packets/[invoiceId]/download` is a different product and is
untouched.)

### What ships

| File | Role |
|---|---|
| `lib/fulfillment/packet-download.ts` | PURE decision layer: capability shape/hashing, `decidePacketDownload`, `decideCapabilityIssuance`, bounded blocker + revocation vocabularies |
| `lib/fulfillment-runtime/packet-download-store.ts` | Transactional store: `issue` / `authorize` / `reassert` / `revoke` |
| `lib/fulfillment-runtime/packet-download.ts` | Server-only read path ordering authorize → private storage → digest check → re-read authority |
| `app/api/ot/packet/download/route.ts` | `POST` boundary; `GET` returns 405 by construction |
| `prisma/schema.prisma` | `OTPacketDownloadCapability` + back-relations |
| `prisma/migrations/20260912120000_…/migration.sql` | Additive `ot_packet_download_capability` table |

### Security properties, and where each is enforced

- **Opaque high-entropy capability, POST body only.** 32 random bytes,
  base64url (43 chars). The route accepts it only in a JSON body; there is no
  `GET` form, no query parameter, and no code path that reads `searchParams` or
  route params. Asserted in `packet-download-route.test.ts`.
- **Persistent hash only.** The column is `capability_hash` — a domain-separated
  (`otpdl:v1:`) SHA-256. The raw value exists in the issuing process and in the
  request body and nowhere else: the store never receives it, and a DB CHECK
  pins the column to 64 lowercase hex. The service hashes at its boundary and
  passes only the digest onward.
- **Hash-bound to the immutable artifact and the authoritative order.** A
  capability row carries `artifact_id`, `artifact_version`, `artifact_sha256`,
  `source_order_id` and `property_binding_fingerprint`, and reuses the same
  composite identity FK `(fulfillment_id, artifact_version) → ot_fulfillment_artifact`
  that `ot_delivery_attempt` uses, so it cannot name a foreign fulfillment's
  artifact. The storage locator must equal
  `contentAddressedT2ArtifactLocator(digest)`, and the bytes read back are
  re-hashed and length-checked before they are served.
- **Revocation / expiry / refund / dispute / cancel safe.** Explicit lifecycle
  (`revoked_at` + bounded reason, `expires_at`, `max_uses`/`use_count`) *and* a
  full re-read of authoritative state on every single use: tier, `PAID` status,
  a downloadable (never terminal) fulfillment status, and an affirmative
  `classifyPropertyBinding(...) === "MATCHES"`. `ot_order` carries no
  `refunded`/`disputed` column — a refund, dispute or cancellation presents there
  as a non-`PAID` `status`, which is the gate that actually fires; the two
  optional flags on `PacketDownloadOrderRow` are for a caller whose settlement
  source states them separately and are never populated here. A refund
  therefore ends access with no revocation step required. `revoke` is idempotent
  and is deliberately *not* gated on the download flag, so shutting the surface
  off can never block ending access.
- **Terminal states never resurrect.** `DOWNLOADABLE_FULFILLMENT_STATUSES`
  excludes every `TERMINAL_LOCK_STATUSES` member by construction; a test asserts
  that intersection is empty. Restoring access after a hard bounce is an
  operator re-issue, not something a surviving token keeps doing.
- **Re-read after the async storage boundary — a narrowed window, not a closed
  one.** `readT2PacketForCapability` calls `store.reassert` *after* the storage
  round trip and before responding, then re-checks activation once more after
  that. This shrinks the exposure from "the whole storage round trip" to "the
  moment between the re-read committing and the bytes leaving the function". It
  does not eliminate the race: a revocation landing inside that remaining window
  still serves one packet, and nothing can recall bytes already on the wire.
  `reassert` re-runs every gate against freshly read rows and compares the
  re-read identity field-by-field against the grant. It judges the use budget
  against the count the grant was *claimed from* — re-checking the post-claim
  count would refuse the last legitimate use of every capability; there is a
  test for exactly that.
- **No URL or token leakage.** No signed URL, public URL, or `@vercel/blob`
  import appears in the route, service, or store; bytes come from the existing
  authenticated private read. Refusals log one bounded code and nothing else —
  no capability, digest, order id, or provider text. Responses carry
  `no-store, private`, `nosniff`, `no-referrer`, `noindex`.
- **No enumeration oracle.** Every "this does not authorize you" reason collapses
  to an indistinguishable `404 NOT_AVAILABLE`. Only `410` expired / revoked /
  exhausted are distinguished, and those are reachable only by someone who
  already held a real capability.
- **Concurrency.** `authorize` locks `ot_order FOR UPDATE` first and the
  capability row second — the same lock order as the binder and the artifact
  orchestrator, so the three cannot deadlock — then claims exactly one use with
  a compare-and-set on `(id, use_count, revoked_at IS NULL, expires_at > now)`.
  A concurrent claimant or revoker invalidates this authorization rather than
  both callers spending the same use. Withdrawal of the flag mid-transaction
  rolls the claim back.

---

## 2. Unit B — durable orphan quarantine (replaces the throwing placeholder)

`reconcileUnboundT2Artifact`, which unconditionally threw
`T2_ARTIFACT_STORAGE_UNAVAILABLE`, is **removed**. In its place:

| File | Role |
|---|---|
| `lib/fulfillment/artifact-orphan.ts` | PURE `decideArtifactOrphanRecord` + bounded reason/upload-outcome/blocker vocabularies |
| `lib/fulfillment-runtime/artifact-orphan-store.ts` | Durable idempotent `INSERT … ON CONFLICT DO UPDATE` |
| `lib/fulfillment-runtime/t2-artifact-orphan.ts` | Server-only seam the workflow calls |
| `prisma/schema.prisma` + migration | `OTArtifactOrphanQuarantine` / `ot_artifact_orphan_quarantine` |

Behaviour:

- **The expected content digest is always recorded**, including when the upload
  outcome was never observed.
- **Unknown upload outcomes are recorded as `UNKNOWN`**, never rounded to
  "probably absent". The fold towards certainty is monotonic: once `CONFIRMED`,
  a later ambiguous observation cannot downgrade it.
- **Nothing deletes storage, anywhere.** The storage module now has no delete or
  cleanup capability at all, has no database reach, and the quarantine module has
  no provider reach — so neither can grow the other's branch by accident. Tests
  assert both.
- **Idempotent** per `(fulfillment_id, storage_locator, artifact_sha256)`, done
  in one statement so it cannot lose a race. A repeat observation increments
  `observation_count`, preserves `first_reason_code` / `first_observed_at`, and
  takes `GREATEST` for `last_observed_at`.
- **No FK to `ot_fulfillment`.** A cascade would delete the very record stating
  that bytes may exist in private storage.
- **The workflow now records on both unknown paths**, which it previously did
  not: when `uploadT2Artifact` throws (`UPLOAD_OUTCOME_UNKNOWN`, upload outcome
  `UNKNOWN`, at the expected content address) and when `bindT2Artifact` throws
  (`BIND_OUTCOME_UNKNOWN`, recorded even for a pre-existing object, because what
  is unknown there is the *binding*, not whether the bytes are present). The
  refusal paths map to `ACTIVATION_WITHDRAWN`, `STORAGE_LOCATOR_MISMATCH`,
  `STORAGE_READ_FAILED`, `STORED_BYTES_MISMATCH`, `BIND_REFUSED`. A quarantine
  write that itself fails still leaves the caller at
  `RECONCILIATION_REQUIRED` — it never upgrades an outcome.

Recording is deliberately **not** re-gated on the binding flag: one of the exact
situations that produces an orphan is activation being withdrawn mid-flight, and
refusing to record then would guarantee the orphan goes unrecorded precisely when
it is most likely to exist.

---

## 3. Unit C — bounded, default-off delivery orchestration

| File | Role |
|---|---|
| `lib/fulfillment/delivery-orchestration.ts` | PURE `decideDeliveryDispatch` (composes `decideDeliverySend` + `buildFulfillmentIdempotencyKey` + `canTransition`) and `decideSendOutcomeRecord` |
| `lib/fulfillment-runtime/delivery-store.ts` | Real store contract: `claim` / `persistAttempt` / `recordOutcome` / `release` against `ot_delivery_attempt` and `ot_delivery_event` |
| `lib/fulfillment-runtime/t2-delivery-orchestrator.ts` | One bounded attempt per invocation behind `OT_T2_DELIVERY_ENABLED` |

No new tables were needed; this reuses the existing lease, retry, idempotency and
event vocabulary rather than restating it.

- **Attempt persists BEFORE the send.** `persistAttempt` writes the attempt row,
  its `REQUESTED` event, and the `ARTIFACT_READY|DELAYED → DELIVERY_PENDING`
  transition (CAS on `status_revision`) in one transaction. A test observes the
  attempt count from *inside* the adapter to prove the ordering.
- **Provider accepted ≠ delivered.** An accepted send folds to
  `PROVIDER_ACCEPTED` through the shared `nextStatusForEvent` authority. Nothing
  in this unit can produce `DELIVERED`; only a provider webhook could.
- **Unknown outcomes never resend.** A thrown or ambiguous adapter call records
  *nothing*, leaving `DELIVERY_PENDING`, which `decideDeliverySend` already
  refuses as `UNRESOLVED_SEND`. A second orchestration run returns
  `NOT_CLAIMED`. `resendAllowed` is typed as the literal `false`, so a future
  edit cannot quietly introduce an auto-retry without changing the contract.
- **Terminal never resurrects.** Every outcome transition routes through
  `nextStatusForEvent`, which returns null for every terminal-lock status; the
  lease claim also refuses any status other than `ARTIFACT_READY` / `DELAYED`.
- **Bounded.** Three attempts max, one attempt per invocation, no inline retry,
  no scheduler; the five-minute lease expiry is the only recovery path.

### Explicit blocker: no provider adapter, no webhook admission

**No email sender ships, and none is half-wired.** The adapter is a required,
explicitly injected dependency with **no default**: with none supplied,
`runT2Delivery` returns `{ outcome: "BLOCKED", blocker: "NO_DELIVERY_ADAPTER" }`
having made zero store calls and zero writes. Setting
`OT_T2_DELIVERY_ENABLED=true` alone therefore sends nothing. The orchestrator and
store import no mail client, hold no recipient address, and are asserted to do
neither.

This is isolated rather than completed because provider identity admission could
not be done here: it needs a verified sending identity, a webhook endpoint that
verifies provider signatures before admitting any event, and a normalization
layer mapping provider payloads into the bounded `OTDeliveryEventType`
vocabulary. Shipping an adapter without those would produce a path that can send
mail but cannot learn whether it arrived — exactly the accepted-vs-delivered
confusion the evidence model exists to prevent. **Nothing calls
`runT2Delivery` yet**; wiring a caller is deferred with it.

---

## 4. Tests

All new tests are in `__tests__/fulfillment/`. Runtime stores are exercised
through **fake DB adapters that implement the real semantics** — lock order,
compare-and-set predicates, `ON CONFLICT DO UPDATE`, sequence assignment — so the
assertions are about the store's own logic, not a mock's scripted answers.

| Suite | Tests | Covers |
|---|---|---|
| `packet-download-decision.test.ts` | 96 | capability shape/hashing/domain separation, every gate and blocker, terminal-status exclusion, property drift, issuance bounds |
| `packet-download-store.test.ts` | 25 | lock order, one-use CAS, concurrent claim/revoke loss, flag rollback, `reassert` incl. final-use case and mid-read refund/revoke/terminal/identity change, idempotent revoke, issuance persisting hash only |
| `packet-download-route.test.ts` | 65 | authorize→storage→re-read ordering, digest-only to store, private headers, `GET` 405, default-off 404, status mapping, 404 oracle collapse, bounded logging, source contracts, bounded/chunked body limit, charset-tolerant media type, query-string refusal, real-store injection across post-storage revoke/refund/terminal/drift, final-use budget, post-await flag gates |
| `artifact-orphan-store.test.ts` | 27 | pure record decision + refusals, idempotent fold, first/last preservation, monotonic upload outcome, second-location rows, no DELETE in any branch |
| `t2-delivery.test.ts` | 84 | dispatch/outcome decisions across all statuses, persist-before-send, accepted≠delivered, unknown records nothing and is not retried, terminal not claimable, no-adapter blocker, no-sender source contract, DB-clock leases + bounds, lease-gated persist, artifact/property drift, the pre-send gate, unknown claim/persist outcomes |
| `packet-download-schema-and-wiring.test.ts` | 23 | schema + migration contracts (additive-only, CHECKs, unique indexes, no cascade on quarantine), runtime wiring guards, strict default-off flags |

Modified: `t2-artifact-workflow.test.ts` (now asserts quarantine recording on
unknown upload and unknown bind, which it previously asserted did *not* happen)
and `t2-artifact-storage-read.test.ts` (the HOLD test is replaced by one proving
the storage module exposes no delete or orphan-cleanup capability).

---

## 5. Exact remaining activation prerequisites

Nothing below was done here; each is a separate reviewed step.

**Schema / deploy**

1. `prisma generate` — the new models are not in any generated client. Runtime
   stores use raw SQL through structurally typed clients, so `tsc` is clean
   without it, but production needs the client regenerated.
2. `prisma migrate deploy` for
   `20260912120000_add_ot_packet_download_and_orphan_quarantine`. Until it runs,
   quarantine writes and every capability operation fail closed (the workflow
   simply stays at `RECONCILIATION_REQUIRED`).
3. Schema validated with `prisma validate` against an isolated placeholder
   datasource config (no `.env` read); it reports valid. It has **not** been
   applied to any database, and the CHECK/unique behaviour has not been executed
   against real PostgreSQL.

**Unit A — download**

4. `OT_T2_PACKET_DOWNLOAD_ENABLED=true`, plus the existing
   `OT_T2_PRIVATE_STORAGE_ENABLED` for the private read.
5. **No issuance caller exists.** `store.issue` is implemented and tested but
   nothing invokes it, and no customer-facing surface presents a capability. A
   delivery or self-serve surface must call it and hand the returned value to the
   customer exactly once — it is unrecoverable afterwards by design.
6. Decide and wire the revocation triggers: `revoke` is ready and idempotent, but
   no refund/dispute/cancel path calls it. (Access still ends immediately via the
   per-use settlement re-read; explicit revocation is defence in depth.)
7. Consider a rate limit on the route. None is applied: the capability is
   256-bit and unguessable, and `lib/rate-limit.ts` is per-instance in-memory, so
   it would be cosmetic. A shared limiter is the real answer if one is wanted.

**Unit B — quarantine**

8. Only the migration and `prisma generate`. Recording activates with the
   existing binding flag, since it writes to a table nothing else reads.
9. A garbage collector is still **not** implemented and remains out of scope. Any
   future one must coordinate atomically with the binding registry, re-check
   every reference at deletion time, and preserve the object on ambiguity. This
   table is its input, not its authority.

**Unit C — delivery**

10. A provider adapter satisfying `T2DeliveryAdapter`, with a verified sending
    identity.
11. A provider webhook route that verifies signatures before admitting any
    event, and normalizes payloads to `OTDeliveryEventType` via the existing
    `foldDeliveryEvent` authority. Without it, `PROVIDER_ACCEPTED` can never
    legitimately become `DELIVERED`.
12. A caller for `runT2Delivery` (webhook `after(...)` or cron), plus
    `OT_T2_DELIVERY_ENABLED=true`. The flag alone is inert without (10).
13. A recovery sweep for expired leases and unresolved `DELIVERY_PENDING` rows.
    Unresolved sends are deliberately left for a provider event or an operator;
    automatic resolution is not implemented and must not be added without the
    webhook in (11).

---

## 6. Repair pass (same worktree, local only)

Review of `e68647d` found four substantive gaps and several comments that claimed
more than the code delivers. All were repaired in place; nothing was rewritten
wholesale, no provider adapter was added, and no issuance caller was introduced.

### 6.1 A lease is now proved against the database, not against the caller

`persistAttempt` previously accepted no `owner`/`token` and checked no lease at
all, so anything that could reach the store could persist an attempt — including
a worker whose lease had expired minutes earlier, or one that never held it.

- `persistAttempt` now takes `owner`/`token` and refuses `LEASE_NOT_HELD` unless
  the freshly read row names exactly that pair with an unexpired
  `lease_expires_at`, measured against `CURRENT_TIMESTAMP` inside the same
  transaction. `evaluateLease`'s `RENEWABLE` decision is the authority; every
  other decision (absent, expired, malformed, held by another) is a refusal.
- The compare-and-set that advances the summary to `DELIVERY_PENDING` repeats the
  lease predicate in SQL (`lease_owner = … AND lease_token = … AND
  lease_expires_at > now`), so the write is conditional even if a future edit
  weakens the read above it.
- `claim` no longer accepts a caller instant or a caller-computed expiry. It
  takes a bounded `leaseMs` (`T2_MIN_LEASE_MS` 30s … `T2_MAX_LEASE_MS` 15min,
  refused rather than clamped), reads the database clock, and derives the expiry
  from it. Its `UPDATE` carries the lease predicate too, so a live lease held by
  someone else is never overwritten.

### 6.2 A pre-send gate that re-reads authority immediately before the adapter

Persisting the attempt before the send is deliberate, and it creates an
asynchronous gap. Previously nothing re-checked anything inside that gap: a
refund, a withdrawn flag, a superseded artifact or a stolen lease landing there
would have been ignored and the send made anyway.

`T2DeliveryStore.assertSendable` is new and read-only. Under the same lock order
it re-verifies, against freshly read state:

- the flag, before any query and again after the last await;
- settlement is still exactly a `PAID` `T2` order;
- the summary is still `DELIVERY_PENDING` at the exact `status_revision` and
  `attempt_count` the persist left;
- the lease is still live and still ours, by the database clock;
- the CURRENT artifact is still the same `version` + `artifact_sha256`, still
  bound to this order, and still fingerprint-matches the order's property — both
  against the order's live property inputs and against the fingerprint the
  attempt was persisted under;
- the exact pending attempt row exists with the same id, attempt number,
  idempotency key, provider and artifact version, and carries no outcome yet
  (`provider_accepted_at` / `failed_at` both null).

`runT2Delivery` now runs `claim → persist → (flag re-check) → assertSendable →
send`, with a test asserting those calls are adjacent and in that order. It makes
no assumption that an adapter checks any of this.

`persistAttempt` also refuses untrusted drift up front — `ARTIFACT_SOURCE_ORDER_MISMATCH`
when the artifact names a different order, `PROPERTY_BINDING_UNVERIFIED` when the
fingerprint is absent or no longer matches — so an attempt that could never
legitimately be sent does not become a durable record that a send was requested.

Thrown-outcome handling is now bounded rather than propagating:

| Failure | Result | Sent? |
|---|---|---|
| `claim` throws | `CLAIM_OUTCOME_UNKNOWN` + best-effort release | no |
| `persistAttempt` throws | `PERSIST_OUTCOME_UNKNOWN` + best-effort release | no |
| `assertSendable` refuses | `SEND_DENIED` + bounded blocker + release | no |
| `assertSendable` throws | `SEND_DENIED` / `PRE_SEND_CHECK_UNKNOWN` | no |

The release is conditional on our own owner/token, so it is safe when the lease
state is unknown, and the expiry recovers it if the release fails too. No thrown
value is read or logged.

### 6.3 Runtime tests for the download read path, through real injected services

`readT2PacketForCapability` is now exercised against an injected store that runs
the real `decidePacketDownload` over real rows and reproduces the SQL store's
semantics (one-use compare-and-set, flag rollback, re-read judged against the
count the grant was claimed from), rather than only through scripted mocks:
post-storage revocation, post-storage refund, post-storage terminal status,
post-storage property drift, byte/length mismatch, the final use of a single-use
capability followed by exhaustion, expiry against the store's clock, and flag
withdrawal at each of the three await boundaries.

A final activation gate was added *after* `reassert` returns — previously the
last check was before it, so a withdrawal landing during the re-read was missed.

### 6.4 The route no longer reads an unbounded body

- The body is read from the request stream with a 1 KiB cap enforced on bytes
  actually received. `Content-Length` is checked first when present, and a
  malformed one is refused, but the cap does not depend on it: a chunked body
  declaring no length is bounded by the same limit, with a test that streams
  64 KiB in 64 chunks and expects `413`.
- Content type is matched on the media type only, so `application/json;
  charset=utf-8` and `Application/JSON` are accepted while `application/ld+json`,
  form encodings and a missing type are refused.
- A `POST` carrying any query string is refused `400 QUERY_NOT_ALLOWED`. Nothing
  parses the query or reads a value out of it — the presence of `?` is the whole
  test — so no parameter can be honoured by a later edit.
- Rejected requests log nothing at all (asserted for `console.warn`/`log`/`error`),
  so no raw capability can reach a log on any of the new paths.

### 6.5 Comments corrected to match what the code does

- The download service no longer claims the re-read "closes any window between
  we decided and we responded". It states the window is narrowed to one
  transaction, that a revocation inside the remainder still serves one packet,
  and that nothing can recall bytes already sent.
- The orchestrator no longer implies lease expiry is a send recovery path. It now
  says expiry recovers the *lease*, that a `DELIVERY_PENDING` summary is refused
  as `UNRESOLVED_SEND` however long its lease has been gone, and that resolving an
  unresolved send needs a provider event or an operator.
- `PacketDownloadOrderRow.refunded`/`disputed` are documented as optional inputs
  that `ot_order` does not have; the report's settlement bullet was corrected to
  match.

### 6.6 Limitations this repair does not remove

1. **A denied pre-send leaves the fulfillment unresolved.** The attempt is
   durable and the summary stays `DELIVERY_PENDING`, which is never automatically
   retried — deliberately, since re-sending after an unverifiable gap is exactly
   the duplicate this design exists to prevent. Clearing it is an operator action
   (or a provider event); no sweep ships.
2. **`assertSendable` narrows the send window; it does not close it.** Anything
   that commits between that transaction and the adapter's own network write is
   still unobserved, and nothing here can un-send.
3. **No provider adapter, no webhook admission, no `runT2Delivery` caller** —
   unchanged from §5, and deliberately not added by this repair.
4. **No issuance caller for download capabilities** — unchanged from §5.
5. **No real database was exercised.** All store tests run against fake adapters
   that implement the real SQL semantics. The new SQL — the lease predicates in
   `claim` and in the `persistAttempt` CAS, and every query in `assertSendable` —
   has not been executed against PostgreSQL. The ephemeral-Postgres migration and
   store rehearsal is the parent's step, and it is where these predicates should
   be proven.
6. **`recordOutcome` is still not lease-gated.** It is idempotent, conditional on
   `status_revision`, and can only ever record an outcome for an attempt that
   already exists, so it does not authorize a send; threading the lease through it
   too would be a consistency improvement, not a fix, and was left out of scope.
