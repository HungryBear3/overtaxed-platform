# OT T2 packet download, orphan quarantine, delivery orchestration

Prepared 2026-09-12; §8 added by the follow-up pass the same day. Local
implementation, local commits, synthetic fixtures and tests only. No push, PR,
merge, deploy, migration run, environment or secret change, database access,
Stripe call, provider call, email, or customer contact was performed or is
implied by this candidate. Every new surface is default-off.

Sections 1–5 describe the state at `4d7979c` and are kept as the record of that
review. §6 and §7 are the repair passes that followed it in a parallel lineage.
**§8 is the current, authoritative section** — it records how the two lineages
were reconciled, the six corrections applied afterwards, and the exact remaining
acceptance. Where an earlier section disagrees with §8, §8 is right; the stale
claims are marked in place rather than deleted.

| | |
|---|---|
| Worktree | `/Users/abigailclaw/cc-worktrees/ot-delivery-flow-20260912` |
| Branch (local only) | `codex/ot-delivery-flow-20260912` |
| Original base | `d5ae760b7a5aa8fe6388802af9b3c5096f675472` |
| Reconciled onto | `216c76985b255a6681969868258396887f425c6a` — *deliver T2 packets by plain code, and learn whether they arrived* |
| Late safety sources | `99d7c6f602272949e2e3246deedcfe88f4ee22d3`, `5aec3c47e48752360c0a3d3272b1613973e01a1d`, `ece80f5bd2bc83098988333a516b474cdd47e0f2` (§7 of this report) — three-way merged, **not** cherry-picked wholesale; see §8.1 |
| Follow-up commits | `b34134b` reconcile the late safety work · `113fe45` close the remaining delivery-safety gaps · `fc7c4e6` isolate `/packet` and scrub packet bodies |
| **Final code SHA** | `fc7c4e6b` — the last commit that changes behaviour. The documentation commit that adds §8 sits on top of it and changes no code, so `fc7c4e6` is the SHA to review, rehearse and sign off against. |
| Verification | `npx jest` — 175 suites / 3844 tests passed (4 suites, 77 tests skipped, unchanged from base); `npx tsc --noEmit` — clean; `npx next build` — exit 0. See §8.7. |
| Dependencies | Existing `node_modules` only. No install, no `prisma generate`, no generated client produced, no package added or upgraded. |

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

> **SUPERSEDED by 216c769 and §8.** This subsection describes the state at
> `4d7979c`, when no sender existed. A real adapter (`t2-resend-adapter.ts`), a
> signed callback endpoint (`/api/ot/webhooks/resend`) and a caller
> (`t2-artifact-scheduling.ts`) all ship now, each behind its own default-off
> flag. It is kept because the reasoning for why an adapter may not be
> half-wired is the standard the shipped one was built to. Read §8 for what is
> actually true today.

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
| `packet-download-store.test.ts` | 34 | lock order, one-use CAS, concurrent claim/revoke loss, flag rollback, `reassert` incl. final-use case and mid-read refund/revoke/terminal/identity change, idempotent revoke, issuance persisting hash only |
| `packet-download-route.test.ts` | 65 | authorize→storage→re-read ordering, digest-only to store, private headers, `GET` 405, default-off 404, status mapping, 404 oracle collapse, bounded logging, source contracts, bounded/chunked body limit, charset-tolerant media type, query-string refusal, real-store injection across post-storage revoke/refund/terminal/drift, final-use budget, post-await flag gates |
| `artifact-orphan-store.test.ts` | 27 | pure record decision + refusals, idempotent fold, first/last preservation, monotonic upload outcome, second-location rows, no DELETE in any branch |
| `t2-delivery.test.ts` | 188 | dispatch/outcome decisions across all statuses, persist-before-send, accepted≠delivered, unknown records nothing and is not retried, terminal not claimable, no-adapter blocker, no-sender source contract, DB-clock leases + bounds, lease-gated persist, artifact/property drift, the pre-send gate, unknown claim/persist outcomes |
| `packet-download-schema-and-wiring.test.ts` | 23 | schema + migration contracts (additive-only, CHECKs, unique indexes, no cascade on quarantine), runtime wiring guards, strict default-off flags |

Added after §6/§7, in the delivery slice and this follow-up:

| Suite | Tests | Covers |
|---|---|---|
| `t2-delivery-acceptance.test.ts` | 24 | settled paid T2 → bound packet → code → exact PDF end to end over one in-memory database; the callback-before-send race; adversarial callbacks and downloads; the lease serializing two dispatchers |
| `t2-resend-adapter.test.ts` | 57 | fail-closed configuration, code-in-body never in a URL, definite vs ambiguous rejection, never re-minting under one key, and the post-issuance pre-send gate |
| `t2-packet-issuance.test.ts` | 17 | 256-bit mint, hash-only handoff, attempt binding, no public issuance surface |
| `provider-callback-decision.test.ts` | 83 | hostile-body normalization, envelope-only replay identity, accepted≠delivered, the RFC3339 provider-instant grammar and what it still refuses |
| `provider-callback-store.test.ts` | 29 | record-before-act ordering, unmatched spool + its serialized cap, replay-budget claims, message-id ambiguity |
| `t2-resend-callback-signature.test.ts` | 38 | secret required in every environment, Svix only, raw-bytes verification, independent staleness |
| `t2-callback-route.test.ts` | 24 | route-level admission, bounded body, coarse responses |
| `t2-delivery-recovery.test.ts` | 60 | the two bounded operator actions, exact-revision CAS, rollback on a lost CAS, and reconciliation bounded to unresolved states |
| `delivery-callback-schema-and-wiring.test.ts` | 29 | callback table schema + migration contracts, default-off flags |
| `packet-page.test.tsx` | 32 | the redemption form: memory-only code, cleared in every branch, no storage/URL/analytics |
| `admin-event-action-widening.test.ts` | 15 | the admin-event CHECK repair: the defect it fixes, discovery-not-guessed-names, per-action shapes, additive-only |
| `packet-surface-isolation.test.tsx` | 32 | `/packet` mounts no instrumentation, the root layout gates every mount, Sentry scrubs packet and callback request data |

Modified: `t2-artifact-workflow.test.ts` (now asserts quarantine recording on
unknown upload and unknown bind, which it previously asserted did *not* happen)
and `t2-artifact-storage-read.test.ts` (the HOLD test is replaced by one proving
the storage module exposes no delete or orphan-cleanup capability).

---

## 5. Exact remaining activation prerequisites

> **PARTLY SUPERSEDED.** Items 5, 10, 11, 12 and 13 were addressed by 216c769
> and this follow-up; item 2 gained a second migration. §8.6 is the current,
> authoritative list. This section is kept as the record of what was outstanding
> at `4d7979c`.

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
  `lease_expires_at`, measured against the database's own clock inside the same
  transaction (originally `CURRENT_TIMESTAMP`; corrected to `clock_timestamp()`
  in §7). `evaluateLease`'s `RENEWABLE` decision is the authority; every
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

---

## 7. Narrow repair: the trusted clock must be a WALL clock

Local only, same worktree, same constraints as §6: no network, no environment or
secret change, no database access, no `prisma generate`, no migration run, no
push. One source change per file plus its test contracts.

### 7.1 The defect

`delivery-store.ts` and `packet-download-store.ts` both read their trusted
instant with:

```sql
SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "now"
```

In PostgreSQL, `CURRENT_TIMESTAMP` — and equally `now()` and
`transaction_timestamp()` — is fixed at **transaction start** and does not
advance for the life of the transaction. Every one of these reads happens *after*
a `FOR UPDATE` lock (`ot_order`, then `ot_fulfillment` or the capability row),
and those locks can block for an unbounded time behind another writer.

So a transaction that began at T and then waited behind a slow holder until T+90s
still read `now = T`. Measured against T:

- an **expired lease** looks live, and `persistAttempt` / `assertSendable` /
  `claim` authorize work under a lease the holder no longer has — including
  `claim` reclaiming, and `assertSendable` green-lighting a send at the exact
  gate that exists to catch lapsed authority;
- an **expired capability** looks unexpired, and `authorize` / `reassert` serve a
  packet under a capability that died while the request queued.

Worse, the CAS predicates repeat the same stale instant
(`expires_at > ${trustedNow}`, `lease_expires_at <= ${nowMs}`), so the SQL-level
defence-in-depth that is supposed to catch a weakened read shares the identical
error and confirms it rather than refusing.

The window is exactly the lock wait, which is precisely when a competing writer
is doing something worth serializing against — the case the lock exists for.

### 7.2 The fix

Both `TRUSTED_CLOCK_SQL` constants now use `clock_timestamp()`, which reads the
real wall clock at the moment of the call and therefore advances across the lock
wait:

```sql
SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "now"
```

Nothing else changed: same `to_char` rendering (never a driver date mapping,
which would apply the server's local UTC offset), same strict RFC3339 UTC shape,
same `UNTRUSTED_CLOCK` refusal when it cannot be parsed, same values flowing into
the same CAS predicates — they are now simply measured at decision time.

Read ordering was verified rather than assumed, and was already correct: every
trusted-clock read in both files already sits after the `FOR UPDATE` locks and
before any write. `delivery-store.readTrustedNow` is called only from inside
`claim` / `persistAttempt` / `assertSendable` after `lockedContext`, and
`recordOutcome` reads it after `lockedContext` too;
`packet-download-store.loadContext` reads it last of all its reads, and `issue`
reads it after the `ot_order` lock. `revoke` takes no lock by design (it must
never be blocked from ending access) and only stamps `revoked_at`. Tests now pin
that ordering instead of leaving it to inspection.

### 7.3 Why a fake-adapter test cannot prove this, and what is asserted instead

The store suites drive fake Prisma adapters that answer instantly and return
whatever instant the test scripted. Such a fake behaves **identically** under
`CURRENT_TIMESTAMP` and `clock_timestamp()` — there is no lock wait to advance
across, so no behavioural assertion over the fake can distinguish them. Claiming
otherwise would be the test asserting its own mock.

So the regression guard is a **source contract** over the real SQL text, in both
`t2-delivery.test.ts` and `packet-download-store.test.ts` (comments stripped
first, so prose may still explain why the wrong function is wrong):

- the trusted clock SQL contains `clock_timestamp() AT TIME ZONE 'UTC'`;
- the code contains no `CURRENT_TIMESTAMP`, no `transaction_timestamp(`, and no
  `now(` — all three are transaction-start clocks;
- the instant is still rendered by `to_char` with the exact RFC3339 format.

Each guard was verified to fail when the change is reverted, not merely to pass
as written.

Alongside those, two behavioural tests pin the *ordering* the fake can honestly
observe: `claim` and `persistAttempt` issue their clock query strictly after both
`FOR UPDATE` statements, and `authorize` / `reassert` read the clock only with
both locks already held.

### 7.4 Scope and limits

- **Touched:** `lib/fulfillment-runtime/delivery-store.ts`,
  `lib/fulfillment-runtime/packet-download-store.ts`, and their two test suites.
- **Deliberately untouched:** `artifact-binding-store.ts` and
  `artifact-orphan-store.ts` still use `CURRENT_TIMESTAMP`. They are outside this
  repair's scope. The orphan store takes no lock before its read; the binder's
  read ordering is a separate question that has not been assessed here and should
  not be assumed either way from this note.
- **Still not proven against real PostgreSQL.** §6.6(5) is unchanged: no database
  was touched. That `clock_timestamp()` advances mid-transaction while
  `CURRENT_TIMESTAMP` does not is documented PostgreSQL behaviour, but this
  repair demonstrates it only through the SQL text, never by executing it. A
  real-database rehearsal — two sessions, one holding the lock past an expiry —
  remains the way to observe the corrected behaviour.

### 7.5 Verification

Verified in the lineage this section came from. The numbers for THIS tree, after
the reconciliation and the follow-up corrections, are in §8.7.

---

## 8. Follow-up: reconciling the late safety lineage, and six corrections

Local only, same constraints as §6 and §7: no network, no environment or secret
change, no database access, no `prisma generate`, no migration run, no provider
call, no mail, no push.

### 8.1 What this follow-up reconciled, and why it was not a cherry-pick

Two lineages diverged from `d5ae760`:

| Lineage | Head | Carried |
|---|---|---|
| Shipped | `216c769` | `ccc4a3c` (authority fencing, private-API denial) then `216c769` (issuance, the Resend adapter, signed callbacks, recovery, `/packet`) |
| Late safety | `ece80f5` | `99d7c6f` (live-lease gating, the pre-send re-read) then `5aec3c4` (wall-clock expiry) then `ece80f5` (§7 of this report) |

Both start from an identical `delivery-store.ts`, so a three-way merge was
possible and was used — but neither side could simply win. `99d7c6f` returned
`DELIVERY_ATTEMPT_CONFLICT` from *inside* the transaction callback, which commits
the event rows written before it; `ccc4a3c` had already replaced that with a
`DeliveryRollback` throw, which is correct and had to survive. Conversely
`ccc4a3c`'s lease check (`LEASE_NOT_OWNED`) was a weaker restatement of
`99d7c6f`'s `LEASE_NOT_HELD` and became dead code behind it, so it was removed
rather than left unreachable. Commit `b34134b` records the whole resolution.

Two things the merge silently dropped and which were restored by hand:
`ccc4a3c`'s adversarial-admission and CAS-rollback tests, and the acceptance
suite's ability to model the new SQL at all — its in-memory database had no
attempt ids, no `provider_accepted_at`/`failed_at`, and no lease predicates on
either compare-and-set, so it was asserting against a fake that could not fail.

`5aec3c4`'s source change was already present in this tree; what it added here
was its source contracts and read-ordering tests, and §7 of this report.

### 8.2 The pre-send gate ran too early

`99d7c6f` placed `assertSendable` immediately after the persist and immediately
before `adapter.send(...)`. That was right when no adapter existed. The shipped
adapter does substantial asynchronous work inside that call before it reaches a
provider: a single-statement context read, a recipient validation, and a
capability-minting transaction. A refund, a withdrawn flag, property drift, a
superseding artifact or a lost lease landing in **that** window was invisible,
and a live code was mailed anyway.

`runT2Delivery` now builds the gate as a closure over its lease and the exact
durable attempt, runs it itself after the persist, and passes the same closure to
the adapter as `input.assertSendable`. The adapter calls it as the last statement
before `provider.send(...)`. Passing it rather than letting the adapter re-derive
one is deliberate: the adapter holds no lease identity and cannot construct this
check, so it cannot accidentally check something weaker.

A denial there is **definite about the only thing that matters** — no bytes
reached a provider, because the gate runs before the only call that could. It is
therefore treated exactly as every other pre-send authority failure the adapter
already detects: the just-minted capability is revoked (it reached no mailbox)
and the outcome is `REJECTED`/`MANUAL_REVIEW`, which folds to terminal `FAILED`.
An unprovable gate (`PRE_SEND_CHECK_UNKNOWN`) is treated identically, because the
uncertainty is about authority, never about whether a send happened.

### 8.3 DELAYED was a resend state

`DELAYED` is reached by exactly one path: an `email.delivery_delayed` provider
callback. That event means the provider **accepted** the message and is still
retrying it to the recipient's mail server. It is a report of slowness, not of
failure.

`decideDeliverySend` listed it as sendable, so a second dispatch was authorized.
A second dispatch is a new attempt number, therefore a new idempotency key,
therefore a mint the `download_capability_id` uniqueness cannot block and a
message the provider's own deduplication cannot suppress. The customer receives
two different codes for one order, the first superseded and dead.

`DELAYED` is now unresolved, with its own reason `PROVIDER_DELAY_IN_FLIGHT` so an
operator console can say *why*. `ARTIFACT_READY` is the only sendable status, and
the store's `claim` refuses everything else in both the read and the SQL
predicate. The transition table still admits `DELAYED → DELIVERY_PENDING`,
because an operator path may one day need it; `decideDeliverySend` is the send
authority and refuses first.

### 8.4 Provider timestamps were parsed with our own canonical rule

`parseStrictInstant` accepts `Z` and at most three fractional digits. That is the
right rule for instants this system renders — they all come from `to_char(…
'MS')` or `toISOString()`, and anything else means something is wrong with us.

It is the wrong rule for a value a third party wrote. RFC3339 places no cap on
`time-secfrac` and does not require the `Z` spelling of a zero offset, and Resend
documents timestamps in both `…T12:00:00.000Z` and `…T12:00:00.674981+00:00`
forms. Under the strict validator the second is `INVALID_TIMESTAMP`: a genuine,
signed, authenticated `email.delivered` would be refused at the door and the
packet would never be recorded as delivered.

`parseProviderInstant` is a separate, wider grammar applied only to
provider-stated instants, and normalized once:

- offsets resolved by explicit arithmetic, not by a date library;
- sub-millisecond precision **truncated**, never rounded — truncation can only
  move an instant into the past, which cannot manufacture an event that happened
  after it arrived;
- leap seconds (`:60`) refused, having no epoch representation;
- the calendar round-tripped, so `2026-02-30T00:00:00Z` fails rather than rolling
  into March;
- the result re-rendered canonical and re-checked against `parseStrictInstant`
  before it leaves, so every downstream column and comparison still sees one
  timestamp shape.

It is emphatically not `new Date(value)` / `Date.parse`, which accept `"2026"`
and `"Sep 12 2026"` and read a naive time in the server's own zone. The test
suite pins both halves: what is now admitted, and the seventeen forms still
refused that a permissive coercion would have taken.

### 8.5 Three defects in the callback store

**The unmatched-spool cap was not a cap.** `SELECT COUNT(*) … > MAX` cannot see a
concurrent transaction's uncommitted row under READ COMMITTED, so N racing
ingests each counted `MAX`, each concluded there was room, and each committed —
`MAX + N` durable rows past a ceiling whose whole purpose is bounding
attacker-driven growth. The count now runs under `pg_advisory_xact_lock`, which
is held until commit, so each holder's count sees every earlier holder's row
already committed and the decision is exact. Taken **only** on the unmatched
branch, which is reached before `apply` takes any row lock, so it cannot join a
deadlock cycle with the delivery store; the matched path never takes it.

**The replay claim stopped excluding anyone at its ceiling.**
`SET replay_count = LEAST(replay_count + 1, 1000)` wrote 1000 over 1000, so the
compare-and-set predicate `replay_count = <observed>` remained satisfiable
forever and two concurrent reconcilers could both claim one row — the single
thing that statement exists to prevent. The increment is now unclamped with a
strict `< MAX_CALLBACK_REPLAYS` predicate, and the batch query no longer offers a
spent row. A lost claim reports `CONFLICTED` rather than `DUPLICATE`, and the new
`skipped` counter makes a pass account for its own batch
(`examined === applied + stillUnmatched + skipped`), which it previously did not.

**One message id could bind two attempts.** `apply` read `located[0]` out of an
unordered result, relying silently on the unique `(provider,
provider_message_id)` index. It now reads `LIMIT 2` and refuses
`AMBIGUOUS_MESSAGE_BINDING` — recorded, not dropped, and deliberately unbound to
either candidate — rather than folding a provider event onto whichever of two
paid orders the planner returned first.

Operator recovery is additionally bounded: `RECONCILE_PROVIDER_CALLBACKS` is
refused from `DELIVERED` and every terminal-lock status, where the fold can move
nothing and a pass could only spend replay budget and write `REFUSED` rows while
returning `ok: true`. The route's accepted statuses are asserted against the
store's `RECONCILABLE_STATUSES`.

### 8.6 The schema blocker, and the two isolation repairs

**`ot_fulfillment_admin_event` could not store what recovery writes.**
`20260808173000_add_ot_fulfillment_admin_events` created the table for one action
and pinned four columns to it:

```sql
CHECK ("action"      = 'ENTER_MANUAL_REVIEW')
CHECK ("to_status"   = 'MANUAL_REVIEW')
CHECK ("reason_code" = 'MANUAL_REVIEW')
CHECK ("from_status" IN ('NOT_STARTED', 'NEEDS_RECONCILIATION',
                         'INCOMPLETE_INPUT', 'ARTIFACT_PENDING', 'ARTIFACT_READY'))
```

`RESOLVE_UNRESOLVED_SEND` writes `('RESOLVE_UNRESOLVED_SEND', 'DELIVERY_PENDING',
'FAILED', <resolve code>)`, violating **all four**. Against a real database that
INSERT raises 23514 and unwinds the whole recovery transaction — the status
advance, the capability revocation and the audit row together — so the operator
control does not work at all. Every unit test passed, because every fake has no
CHECK constraints. This is the class of defect §6.6(5) warned about, found by
reading the DDL rather than by running it.

`20260912180000_widen_ot_admin_event_actions` drops those four **by discovery**
from `pg_constraint`, selecting on `conkey` — the columns a constraint actually
references — rather than on a guessed PostgreSQL auto-name like
`ot_fulfillment_admin_event_action_check`, which is an implementation detail of
how an unnamed CHECK gets named and differs if one was ever renamed or rebuilt.
The three constraints that must survive (`from_revision >= 0`,
`to_revision = from_revision + 1`, `char_length(actor_user_id)`) reference columns
outside the target set and are excluded by construction.

It replaces them with one named constraint **per action shape**, so the action
and the transition it may describe stay coupled. Widening each column
independently would have admitted the cross-products — an `ENTER_MANUAL_REVIEW`
row claiming `DELIVERY_PENDING → FAILED` — and this table is audit evidence,
where a row that cannot be true must not be storable. A third constraint keeps
the action vocabulary closed, since both shape constraints are vacuously true for
an unknown action. Shape 1 is the old rule exactly, so every existing row
validates and `ADD CONSTRAINT` rewrites nothing.

**`/packet` ran the whole marketing instrumentation stack.** Every route inherits
one root layout, and that layout mounted UTM first-touch capture, approved-code
capture and the analytics route tracker unconditionally, plus the `?ref=`
referral capture, Google Analytics and Vercel Analytics on the production host.
All of them ran on the page whose own contract says "no analytics call, no
third-party widget, and no error reporter on this path". The argument is not that
one of them logs the code; it is that a page holding a bearer credential in
memory should not also be running third-party script, because that is behaviour
we do not control and would have to re-audit on every upgrade.

`lib/analytics/private-surfaces.ts` names the private paths once as a pure rule
and `<InstrumentationBoundary>` renders nothing on them. Every instrumentation
mount moved inside it; route `{children}` stays outside, so the gate can suppress
telemetry and can never blank a page. That meant unwrapping
`AnalyticsProviderWithSuspense`, which rendered the tracker and the page tree
together — gating it would have gated the page — so the tracker is now mounted
directly beside its own Suspense boundary, which is what confined the
`useSearchParams` prerender bailout in the first place. Matching is exact-or-`/`
-prefixed so `/packets` is not silently captured, and an unknown pathname fails
closed.

**Sentry would have captured the capability.** `@sentry/nextjs` attaches request
context to server events, which for `POST /api/ot/packet/download` is the
capability that IS the customer's authorization — the value deliberately kept out
of URLs, access logs, `Referer` headers and browser history — and for
`POST /api/ot/webhooks/resend` is a raw provider payload still carrying the
recipient's address and remote SMTP text. `scrubSensitiveEvent` drops the body on
**every** route (an allowlist stops covering whatever route is added next) and
additionally strips URL, query, headers, cookies and matching breadcrumbs on the
private paths. Wired into both configs on `beforeSend` and
`beforeSendTransaction`, with `sendDefaultPii: false`.

Those two Sentry configs are **not currently loaded**: there is no
`instrumentation.ts` and `next.config.mjs` does not call `withSentryConfig`. This
is defence in depth placed ahead of the wiring, not a change to live behaviour,
and the module says so.

### 8.7 Verification

Run in this worktree at the tree these commits produce:

| Command | Result |
|---|---|
| `npx jest` | 175 suites / 3844 tests passed; 4 suites / 77 tests skipped (unchanged from base — the skipped suites are the PostgreSQL integration rehearsals, which need a database) |
| `npx tsc --noEmit` | clean |
| `npx next build` | exit 0; compiled successfully, 142 static pages generated, no error and no new warning |

`npx next build` was run directly, not through `npm run build`, which wraps it in
`scripts/build-with-migrate-retry.mjs` and would attempt `prisma migrate deploy`
against a real database.

### 8.8 Exact remaining acceptance — the authoritative list

Everything below is still outstanding. Nothing here was done, and none of it is
implied by any commit in this branch.

**Must run against a real database, in order**

1. `prisma generate`. The new models (`OTPacketDownloadCapability`,
   `OTArtifactOrphan`, `OTDeliveryProviderCallback`, and
   `OTDeliveryAttempt.downloadCapabilityId`) are not in any generated client.
   Every runtime store uses raw SQL through structurally typed clients, so `tsc`
   and `next build` are clean without it; production is not.
2. `prisma migrate deploy` for all four OT migrations in dependency order:
   `20260912120000_add_ot_packet_download_and_orphan_quarantine`,
   `20260912140000_deny_packet_api_access`,
   `20260912160000_add_ot_t2_delivery_callbacks`, and
   `20260912180000_widen_ot_admin_event_actions`. Until the last one runs, the
   operator `RESOLVE_UNRESOLVED_SEND` control fails closed with 23514 — see §8.6.
3. **A two-session rehearsal of the constraint discovery in §8.6.** The `DO`
   block's `conkey <@ target_columns` selection has never been executed. Confirm
   on a restored copy that it drops exactly four constraints and that the three
   revision/actor constraints survive, BEFORE running it anywhere else.
4. **A two-session rehearsal of the wall clock (§7.4, still open).** One session
   holds `ot_fulfillment` FOR UPDATE past a lease expiry while another attempts
   `assertSendable`. The correction is demonstrated here only through SQL text.
5. **A rehearsal of the advisory-lock spool cap (§8.5).** N concurrent ingests at
   the ceiling must produce `MAX + 0` unmatched rows, not `MAX + N`. The fake
   cannot reproduce snapshot isolation; what is tested is only that the count
   never happens outside the lock.

**Configuration, each a separate decision**

6. `OT_T2_PACKET_DOWNLOAD_ENABLED`, `OT_T2_DELIVERY_ENABLED`,
   `OT_T2_DELIVERY_ADAPTER_ENABLED`, `OT_T2_DELIVERY_CALLBACK_ENABLED`,
   `OT_T2_DELIVERY_RECOVERY_ENABLED` — all strict exact-`"true"` switches, all
   absent everywhere. The adapter additionally refuses to construct without
   `RESEND_API_KEY`, `OT_T2_DELIVERY_FROM` (or `RESEND_FROM`) and an https-only
   `NEXT_PUBLIC_APP_URL`.
7. `OT_T2_RESEND_WEBHOOK_SECRET`, distinct from the outreach secret, plus the
   Resend endpoint registered against `/api/ot/webhooks/resend`. The endpoint
   fails closed without it in **every** environment, development included.
8. A verified sending identity (SPF/DKIM/DMARC) for the `from` address. Nothing
   in this branch checks deliverability, and nothing can.

**Known-open, deliberately not implemented**

9. **No sweep for unresolved sends or expired leases.** A `DELIVERY_PENDING`
    summary is never automatically retried and never automatically resolved; it
    waits for a provider event or the bounded operator control. Adding a sweep
    that resolves by elapsed time would reintroduce exactly the duplicate this
    design refuses.
10. **No revocation trigger on refund/dispute/cancel.** `revoke` is ready and
    idempotent but nothing calls it; access still ends immediately through the
    per-use settlement re-read, so this is defence in depth, not a gap in access
    control.
11. **No garbage collector for quarantined orphans** (§5.9, unchanged).
12. **No rate limit on `/api/ot/packet/download`** (§5.7, unchanged). The
    capability is 256-bit and the body is now bounded at 1 KiB, but a shared
    limiter is the real answer if one is wanted.
13. **`recordOutcome` is still not lease-gated** (§6.6.6, unchanged). It cannot
    authorize a send, so this is a consistency improvement rather than a fix.
14. **`artifact-binding-store.ts` and `artifact-orphan-store.ts` still use
    `CURRENT_TIMESTAMP`** (§7.4, unchanged). Out of scope here; their read
    ordering has not been assessed and must not be assumed either way.

**Not a readiness claim.** No credential was read, no provider was called, no
migration was executed, no database was touched, no mail was sent, and nothing
was pushed. The eligibility policy used throughout the acceptance suite is an
explicit TEST FIXTURE; the production registry stays unsigned and the real
producer still refuses it.
