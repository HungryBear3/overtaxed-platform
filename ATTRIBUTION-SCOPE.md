# OT acquisition attribution — exact scope and limitations

Base commit: `d5ae760`. Worktree: `ot-attribution-20260912`.

This document is the scope contract for the change. It is deliberately written
before the code, and it states what this slice does **not** do as precisely as
what it does, so nothing here can be read as a claim that acquisition tracking
is working end to end.

## What ships

A bounded, privacy-safe, durable first-touch acquisition attribution binding for
the OT checkout, expressed as:

1. A **finite server-approved code registry** (`lib/attribution/registry.ts`).
   The shipped registry is **EMPTY**. No campaign and no creative is approved.
2. A **client capture module** (`lib/attribution/client-codes.ts`) plus a
   root-layout capture component. It forwards **only** code references that are
   present in the approved registry. Because the shipped registry is empty, it
   forwards nothing and stores nothing.
3. A **dedicated table** `ot_order_attribution`, one row per canonical
   `ot_order.id`, created by a dedicated local SQL migration. The Prisma schema
   is **not** touched; the table is read and written through a parameterized raw
   SQL helper (`lib/attribution/record.ts`).
4. A **route binding** in `app/api/checkout/session/route.ts` that binds
   first-touch attribution to the canonical `orderId` **before** the Stripe
   Checkout Session is created, and stamps Stripe metadata from a **readback of
   the immutable row**, never from the current request.
5. An explicit **state** on every row — `campaign`, `organic` or
   `legacy_unattributed` — so that "we observed no campaign" and "we never
   observed this order's first touch at all" are different, durable claims.

## The privacy boundary

The only values that can ever reach the database are **codes drawn from the
server's own approved registry**, plus the sentinel for "no campaign".

- No raw UTM values are persisted. The existing `lib/analytics/utm-tracking.ts`
  localStorage UTM capture is untouched and is **not** a source for this table.
- No email, no PIN, no property address, no name, no URL, no `document.referrer`
  and no free-text label is accepted, forwarded, or stored.
- A code is accepted only if it matches `^[a-z0-9][a-z0-9_]{1,39}$` **and** is a
  member of the server's approved registry. Shape alone is not sufficient. The
  charset makes an email (`@`), a URL (`:`, `/`, `.`), or an address (spaces,
  commas) unrepresentable; registry membership is what rejects everything else,
  including a 14-digit PIN, which is shape-legal but never an approved code.
- The same charset restriction is re-asserted as a SQL `CHECK` constraint, so
  the column cannot hold a PII-shaped value even if the application layer were
  bypassed.

Rejection is an error, not a silent downgrade: an unknown or tampered code
returns `400 INVALID_ATTRIBUTION_CODE` and **no** order row and **no** provider
call happens on that request. Silently falling back to "organic" would let a
tampered code mint a durable organic row that then permanently blocks the real
attribution, so the request is refused instead.

## Server is the authority

The client module validates before forwarding purely to avoid pointless
requests. That validation is **not** load-bearing. The route re-resolves every
submitted code against `shippedAttributionRegistry()` on the server, before the
Stripe client is used, and the persisted row is built only from the server's
resolution. A client that posts a code the server does not approve is rejected
regardless of what the client-side check did.

## The three states, and why `legacy_unattributed` has to exist

Every row records what kind of claim it is:

| state | means |
|---|---|
| `campaign` | an approved code pair was the first touch |
| `organic` | the order was **created** by a request carrying no approved campaign — a positive claim about a first touch that was actually observed |
| `legacy_unattributed` | the order **already existed** when binding first ran against it, so its real first touch was never observed and is unknowable |

`legacy_unattributed` covers every pre-existing order: orders created before
this feature, orders created while the gate was off, approved reassessment-notice
orders created on an earlier request, and the loser of a concurrent create.

Both of the alternatives are false statements:

- Binding **the current request's campaign** would invent a first touch. The
  request is a *later* touch. The failure is most visible on a legacy order that
  already holds an open Stripe session: the session's metadata says nothing
  about any campaign, and stamping one into the database would put the two
  permanently at odds.
- Binding **`organic`** would assert an untagged first touch that nothing ever
  measured, and would silently inflate organic in any later report. Legacy rows
  must be excludable, not counted.

The marker is stamped into Stripe metadata as itself
(`attributionStatus=legacy_unattributed`). It is not dressed up as organic and
no source is invented for it.

### How "this request created the order" is known

Only a creation this request performed may produce `organic` or `campaign`.
That decision cannot rest on any property of the returned row — `stripeSessionId
IS NULL`, `attempt = 0` and a recent `createdAt` are all reset by an
expired-session retry, so every one of them reads a legacy order as fresh.

Instead, the canonical order row and its attribution row are created inside **one
transaction**, and the creation indicator is whether *our* insert of the unique
`contractKey` succeeded — a fact reported by the database. A concurrent request
that loses that race blocks on the unique index until the winner commits, so by
the time it sees the violation the first touch is already durable; its own
`legacy_unattributed` insert is then a no-op and its readback returns the real
first touch.

Atomicity also means a binding failure rolls the order creation back with it. A
half-created order would be *pre-existing* on the next attempt, and the retry
would be forced to bind `legacy_unattributed` — a failed write would have
permanently destroyed a real attribution.

Because the insert is `ON CONFLICT DO NOTHING` and the readback is the only
source of metadata, binding `legacy_unattributed` against an order that already
carries a real first touch is a harmless no-op that returns the original row.
Nothing is ever downgraded.

## Why an explicit organic row exists (and why this needs the table even when
## there is no campaign)

The requirement is that a retry can never overwrite or "upgrade" the original
attribution, *including* an original of no-attribution/organic.

Absence of a row cannot express organic. Absence is indistinguishable from
"not yet bound". If organic were represented by writing nothing, then the first
checkout attempt from untagged traffic would leave the order unbound, and a
second attempt that arrived carrying an approved campaign code would bind that
campaign — an upgrade on retry, which is exactly the failure mode being
prevented. So organic is written as an **explicit row** with
`campaign_code IS NULL` and `creative_code IS NULL`. That row is what makes the
original organic first touch immutable.

The binding write is `INSERT ... ON CONFLICT (order_id) DO NOTHING` followed by
a `SELECT` readback. The application issues no `UPDATE` against this table, and
the migration installs a `BEFORE UPDATE` trigger that raises, so immutability is
enforced by the database and not merely by convention.

## Compatibility with the existing no-campaign flow

The tension: binding must be fail-closed before a provider side effect, but the
existing untagged checkout flow must keep working on a deployment where this
migration has not been applied.

These are reconciled with a single explicit server gate, `OT_ORDER_ATTRIBUTION_ENABLED`,
default **off**:

- **Off (default, and the state this branch ships in):** **not one statement**
  is issued against `ot_order_attribution` — not a write, and not a read. No
  attribution metadata key is added to the Stripe session, and the checkout
  request path is behaviourally identical to `d5ae760`. Codes submitted by a
  client are still validated and still rejected if unknown — the gate controls
  persistence, not the privacy boundary.
- Orders created while the gate is off get **no row**. When the gate is later
  turned on they are pre-existing, so they bind `legacy_unattributed`. Turning
  the gate on can never retroactively attribute a campaign to an order that
  predates it.
- **On:** binding is **mandatory for every order, including organic**. If the
  insert or the readback fails for any reason — table missing, constraint
  violation, readback returning anything other than exactly one row — the route
  returns `503 ATTRIBUTION_BINDING_UNAVAILABLE` and **no Stripe Checkout Session
  is created**. The failure happens before the `CHECKOUT_CREATING` claim, so no
  order is left in a claiming state by it.

Turning the gate on without applying the migration therefore takes checkout
down rather than silently losing attribution. That is the intended fail-closed
ordering, and it is why the gate exists and defaults to off.

## Reused open Stripe sessions

Attribution is bound before the branch that reuses an already-open Stripe
session, and Stripe metadata is only ever written at session-create time from
the readback row. A retry that arrives carrying different tags therefore
receives the original session URL with the original metadata: the `ON CONFLICT
DO NOTHING` insert is a no-op, the readback returns the first-touch row, and no
metadata write of any kind is issued against the existing session. A reused open
session cannot receive a contradictory new attribution.

## Stored data is untrusted on the way out

The table carries `CHECK` constraints, but the readback does **not** depend on
them having been applied: the migration is not executed by this branch, a
restore or a manual edit can bypass them, and a campaign code is copied verbatim
into Stripe metadata. So every row is revalidated on read against exactly the
shape the constraints describe — code charset and length, a known state, state
and codes agreeing, a well-formed registry version, a parseable timestamp — and
anything else is a hard `503` rather than a value that gets forwarded.

The registry version is **never** stamped into provider metadata. It identifies
an internal approval set, it means nothing to Stripe, and leaving it out means
the only stored string that can reach the provider is an already-revalidated
code.

## Exposure and logging

- **Table exposure.** The table lives in `public`, which on Supabase is served
  by PostgREST to the `anon` and `authenticated` roles, and default schema
  grants can make a new table readable before anything else runs. It joins an
  order id to the campaign that produced it, so the migration closes it both
  ways: `ENABLE ROW LEVEL SECURITY` with **zero policies** (implicit deny for
  every non-owner role), plus `REVOKE ALL` from `PUBLIC` and — guarded by a
  `pg_roles` check so the file still runs on plain PostgreSQL — from `anon` and
  `authenticated`. The owning role Prisma connects as bypasses RLS, so the
  application is unaffected. **Role prerequisite:** both `ENABLE ROW LEVEL
  SECURITY` and `REVOKE` require table ownership, so the migration must be run
  as the owning role (`postgres` on Supabase) or a superuser; run as anyone else
  it fails and rolls back rather than leaving the table exposed.
- **`DELETE` is not blocked.** It happens by cascade from `ot_order`, and the
  owning role can also issue one directly. "The application never deletes" is a
  statement about the application, not a guarantee about the table.
- **Logging.** A binding failure logs a **fixed classification** and the
  server-generated order id, and nothing else. The originating driver error is
  never logged and is not retained as `cause`, because a driver error carries
  statement text, bound parameter values and vendor detail — and the bound
  parameters on this path include the submitted acquisition codes.

## Explicitly out of scope

- **No migration is executed.** The SQL file is added; nothing runs it. No
  database connection is opened by this work.
- **No Prisma schema change.** `prisma/schema.prisma` is owned elsewhere and is
  not edited. No Prisma model exists for `ot_order_attribution`; access is
  parameterized raw SQL only.
- **No `eligibilitySnapshot` reuse.** That JSON column is not read into, written
  from, or repurposed for attribution.
- **No change to eligibility, acknowledgment, held-product, window, or price
  gates**, and no change to the sanitized GA identifiers
  (`sanitizeAnonymousGaIdentifiers`) already stamped into Stripe metadata.
- **No reporting, dashboard, aggregation, backfill, or webhook consumer.** The
  row is written and read back for metadata; nothing else consumes it yet.
- **No attribution on the Stripe webhook / settlement path.** Only the checkout
  session creation path binds.
- **No backfill and no repair of `legacy_unattributed` rows.** Once an order is
  marked legacy it stays legacy; the trigger makes that permanent. There is no
  path that later promotes one, deliberately.
- **T3 approved-notice orders always bind `legacy_unattributed`.** Their
  canonical row is created on the earlier notice-review request, which returns
  `422` and never reaches binding, so by the time they reach checkout they are
  pre-existing. This is an accepted limitation, not an oversight: attributing
  them at pay time would record a later touch as the first one.
- **No network, provider, customer, Stripe, or deployment calls.** Tests are
  fully mocked.
- **No multi-touch, last-touch, decay, or channel modelling.** First touch only.

## Honest statement of what this does and does not prove

With the shipped empty registry and the gate off, this branch tracks **nothing**.
It ships the mechanism and the refusal behaviour, not live attribution. No
campaign is live, no tagged traffic is accepted, and no row will be written in
production until (a) codes are added to the registry by a server change and
(b) the migration is applied and the gate is turned on deliberately.

Tests inject a synthetic registry to exercise the accept path. That injection is
test-local and does not change the shipped registry.
