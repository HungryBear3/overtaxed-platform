-- OT acquisition attribution — durable, immutable, privacy-bounded first touch.
--
-- ADDITIVE ONLY. This migration creates ONE new table and touches nothing that
-- is already deployed: no column is added to, altered on, or removed from
-- `ot_order`, no settlement/payment state is read or written, and no row is
-- backfilled. It is deliberately NOT reflected in prisma/schema.prisma — that
-- file is owned elsewhere — so this table is reached only through the
-- parameterized raw SQL helper in lib/attribution/record.ts.
--
-- NOT EXECUTED by the change that added it. See ATTRIBUTION-SCOPE.md.
--
-- ROLE PREREQUISITE
--   Run this as the role that OWNS the OT tables (on Supabase, the `postgres`
--   role used by DATABASE_URL), or as a superuser. `ALTER TABLE ... ENABLE ROW
--   LEVEL SECURITY` and `REVOKE` on a table both require table ownership;
--   executed by a non-owner they fail with `must be owner of table`, and the
--   whole migration then rolls back rather than leaving the table exposed.
--
-- ACCESS ASSUMPTIONS
--   * The application connects as the owning role. That role BYPASSES RLS (RLS
--     is not FORCEd here), so the two statements below keep working unchanged.
--   * The application issues exactly two statements against this table:
--     an `INSERT ... ON CONFLICT DO NOTHING` and a single-row `SELECT`, both
--     parameterized. It never issues UPDATE and never issues DELETE.
--   * DELETE is not blocked. It happens by cascade from `ot_order`, and the
--     owning role can also issue one directly — nothing here prevents that.
--     "The application never deletes" is a statement about the application, not
--     a guarantee about the table.

CREATE TABLE "ot_order_attribution" (
    -- One row per canonical order. The PK is the FK: this is what makes the
    -- binding one-to-one and makes `ON CONFLICT ("order_id") DO NOTHING` the
    -- complete expression of "first touch wins".
    "order_id" TEXT NOT NULL,

    -- How this first touch came to be, stored EXPLICITLY rather than inferred
    -- from which columns are null. The three cases are different claims:
    --
    --   'campaign'            an approved code pair was the first touch;
    --   'organic'             the order was CREATED by a request carrying no
    --                         approved campaign — a positive, observed claim;
    --   'legacy_unattributed' the order already existed when binding first ran
    --                         against it, so its real first touch was never
    --                         observed. Pre-feature orders, orders created
    --                         while the gate was off, and approved-notice
    --                         orders land here.
    --
    -- 'legacy_unattributed' exists precisely so that "we never saw it" is not
    -- written as 'organic'. Reporting that counted legacy rows as untagged
    -- traffic would be reporting a measurement that was never taken, and the
    -- alternative error — letting a later tagged retry stamp its campaign onto
    -- a pre-existing order — would invent a first touch outright.
    "state" TEXT NOT NULL,

    -- Non-null only for 'campaign'. 'organic' and 'legacy_unattributed' are
    -- both NULL/NULL and are told apart by "state", never by the nulls.
    "campaign_code" TEXT,
    "creative_code" TEXT,

    -- Which approved set was in effect when this row was written, for later
    -- audit of a code that has since been withdrawn from the registry. For a
    -- 'legacy_unattributed' row it records the registry in effect when the
    -- marker was written; it is NOT a claim that any code was accepted.
    "registry_version" TEXT NOT NULL,

    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_order_attribution_pkey" PRIMARY KEY ("order_id")
);

ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "ot_order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The privacy boundary, re-asserted in the database.
--
-- Codes are lowercase alphanumerics and underscores, 2-40 chars. The charset is
-- the point: an email needs '@', a URL needs ':' and '/', a street address
-- needs spaces and commas, and none of those can be stored in these columns
-- even if the application layer were bypassed. This is a shape floor, not an
-- acceptance rule — acceptance is registry membership, enforced in
-- lib/attribution/registry.ts, which is the single source of truth for WHICH
-- codes are approved. Duplicating the approved list as SQL would create a
-- second source that silently drifts.
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_code_shape" CHECK (
        ("campaign_code" IS NULL OR "campaign_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND ("creative_code" IS NULL OR "creative_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND "registry_version" ~ '^[a-z0-9][a-z0-9_-]{1,79}$'
    );

-- State and codes must agree, in both directions. This is also what enumerates
-- the legal states: any value other than the three below satisfies neither
-- branch, so a typo'd or invented state cannot be stored.
--
-- A 'campaign' row without a campaign code is a half-bound attribution, and an
-- 'organic' or 'legacy_unattributed' row WITH one would let a reader that
-- trusts the codes over the state see a campaign that was never approved for
-- that order. A creative is meaningless without the campaign it ran under.
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_state_agrees_with_codes" CHECK (
        (
            "state" = 'campaign'
            AND "campaign_code" IS NOT NULL
        ) OR (
            "state" IN ('organic', 'legacy_unattributed')
            AND "campaign_code" IS NULL
            AND "creative_code" IS NULL
        )
    );

ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_creative_requires_campaign" CHECK (
        "creative_code" IS NULL OR "campaign_code" IS NOT NULL
    );

-- Immutability, enforced rather than assumed.
--
-- The application never issues an UPDATE against this table, but "we don't do
-- that" is a convention, and the guarantee being made -- that a retry can never
-- overwrite or upgrade an original first touch, INCLUDING an original organic
-- one, and that a 'legacy_unattributed' marker can never later be promoted to a
-- campaign -- is worth more than a convention.
CREATE OR REPLACE FUNCTION "ot_order_attribution_reject_update"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ot_order_attribution rows are immutable (order_id=%)', OLD."order_id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ot_order_attribution_no_update"
    BEFORE UPDATE ON "ot_order_attribution"
    FOR EACH ROW EXECUTE FUNCTION "ot_order_attribution_reject_update"();

-- Reporting will group by campaign long before it looks up a single order, and
-- the PK does not serve that. Partial: organic and legacy rows are sentinels,
-- not campaigns, and indexing them would be indexing the default.
CREATE INDEX "ot_order_attribution_campaign_code_idx"
    ON "ot_order_attribution"("campaign_code")
    WHERE "campaign_code" IS NOT NULL;

-- ============================================================================
-- Exposure control. This table is in the `public` schema, and on Supabase that
-- schema is served by PostgREST to the `anon` and `authenticated` roles. A new
-- public table is therefore reachable by an unauthenticated Data API caller
-- unless it is closed, and default privileges on the schema may already grant
-- SELECT to those roles before anything here runs. This joins an order id to
-- the campaign that produced it, so it is closed both ways.
--
-- Matches the style of prisma/enable_rls.sql, which is the existing pattern for
-- this database.
-- ============================================================================

-- RLS with ZERO policies = implicit deny for every non-owner role. The owning
-- role that Prisma connects as bypasses RLS, so the application is unaffected.
ALTER TABLE "ot_order_attribution" ENABLE ROW LEVEL SECURITY;

-- No policies are created, deliberately. Adding any permissive policy here
-- would open a Data API read path to acquisition data.

-- Belt as well as braces: revoke the table privileges themselves, so the table
-- is closed even in a deployment where RLS is later disabled or a policy is
-- added by mistake. PUBLIC always exists; the Supabase API roles may not, so
-- they are revoked only if present and this file stays runnable on a plain
-- PostgreSQL instance.
REVOKE ALL ON TABLE "ot_order_attribution" FROM PUBLIC;

DO $$
DECLARE
    api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'ot_order_attribution', api_role);
        END IF;
    END LOOP;
END
$$;
