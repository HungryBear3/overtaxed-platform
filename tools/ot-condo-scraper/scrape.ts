// OT Condo Scraper — Chicago run
//
// See docs/OT_OUTREACH_V1_RUNBOOK.md §3.C (audience quality gates) and §6
// (send-time preflight). This script does NOT send. It only writes
// outreach_prospects rows that the existing TS sender path consumes.
//
// Usage:
//   pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --dry-run
//   pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --limit 10 --dry-run
//   pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --full
//
// Required env: DATABASE_URL, OT_REALIE_API_KEY
//
// Behavior:
// - Pulls condos from Realie filtered by type=condo, beds>=2, assessed_value>=300_000
// - Per row: derives role-address + property-manager flags, sets row_status accordingly
// - Upserts into outreach_prospects on (building_address_normalized, board_email_lowercase)
// - Idempotent on re-run; uses scraper_version = git SHA from env or "manual"
// - --dry-run prints what WOULD be written, makes 0 DB writes
// - --limit N caps the page count for testing
// - Exponential backoff on 429 / 5xx, max 3 retries per row

import { PrismaClient } from '@prisma/client';

import {
  mapRealieRow,
  type MappedProspect,
  type RealieCondoRow,
} from './lib';

const SCRAPER_VERSION =
  process.env.SCRAPER_VERSION ??
  process.env.GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  'manual';

const REALIE_BASE_URL = process.env.OT_REALIE_BASE_URL ?? 'https://api.realie.io/v1';
const MIN_ASSESSED_VALUE = 300_000;
const MIN_BEDS = 2;
const DEFAULT_LIMIT = 2000;
const MAX_RETRIES = 3;

interface CliArgs {
  city: string;
  fullRun: boolean;
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };
  const has = (name: string) => argv.includes(`--${name}`);
  return {
    city: (get('city') ?? 'chicago').toLowerCase(),
    fullRun: has('full'),
    dryRun: has('dry-run'),
    limit: Number(get('limit') ?? DEFAULT_LIMIT),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchRealiePage(
  city: string,
  page: number,
  pageSize: number,
  apiKey: string,
): Promise<{ rows: RealieCondoRow[]; hasMore: boolean }> {
  const url = `${REALIE_BASE_URL}/properties?city=${encodeURIComponent(city)}&type=condo&minBeds=${MIN_BEDS}&minAssessedValue=${MIN_ASSESSED_VALUE}&page=${page}&pageSize=${pageSize}`;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = 2_000 * Math.pow(2, attempt - 1);
        console.warn(`[realie] HTTP ${res.status} on page ${page}; retrying in ${wait}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Realie ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { results?: RealieCondoRow[]; hasMore?: boolean };
      return { rows: data.results ?? [], hasMore: Boolean(data.hasMore) };
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      const wait = 2_000 * Math.pow(2, attempt - 1);
      console.warn(`[realie] network error on page ${page}; retry in ${wait}ms`, err);
      await sleep(wait);
    }
  }
  throw new Error(`Realie page ${page} exhausted retries`);
}

async function upsertProspect(
  prisma: PrismaClient,
  m: MappedProspect,
  scrapedAt: Date,
): Promise<void> {
  await prisma.outreachProspect.upsert({
    where: {
      outreach_prospects_addr_email_uq: {
        buildingAddressNormalized: m.buildingAddressNormalized,
        boardEmailLowercase: m.boardEmailLowercase,
      },
    },
    create: {
      buildingName: m.buildingName,
      buildingAddressRaw: m.buildingAddressRaw,
      buildingAddressNormalized: m.buildingAddressNormalized,
      boardName: m.boardName,
      boardEmail: m.boardEmail,
      boardEmailLowercase: m.boardEmailLowercase,
      sourceUrl: m.sourceUrl,
      scrapedAt,
      scraperVersion: SCRAPER_VERSION,
      rowStatus: m.rowStatus,
      rawPayload: m.rawPayload,
    },
    update: {
      buildingName: m.buildingName,
      buildingAddressRaw: m.buildingAddressRaw,
      boardName: m.boardName,
      boardEmail: m.boardEmail,
      sourceUrl: m.sourceUrl,
      scrapedAt,
      scraperVersion: SCRAPER_VERSION,
      rowStatus: m.rowStatus,
      rawPayload: m.rawPayload,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.city !== 'chicago') {
    console.error(`Only --city chicago is supported in this revival pass (got: ${args.city})`);
    process.exit(2);
  }
  if (!args.fullRun && !args.dryRun && !process.argv.includes('--limit')) {
    console.error('Must pass --full, --dry-run, or --limit N. Aborting.');
    process.exit(2);
  }

  const apiKey = process.env.OT_REALIE_API_KEY;
  if (!apiKey) {
    console.error('OT_REALIE_API_KEY is not set. Aborting.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  let totalFetched = 0;
  let written = 0;
  let needsReview = 0;
  let skippedNoEmail = 0;
  let pageSize = 100;
  let page = 1;
  const startedAt = new Date();

  console.log(
    `[scrape] city=chicago dryRun=${args.dryRun} full=${args.fullRun} limit=${args.limit} version=${SCRAPER_VERSION}`,
  );

  try {
    while (totalFetched < args.limit) {
      const remaining = args.limit - totalFetched;
      const thisPageSize = Math.min(pageSize, remaining);
      const { rows, hasMore } = await fetchRealiePage(args.city, page, thisPageSize, apiKey);
      if (rows.length === 0) break;
      totalFetched += rows.length;

      for (const row of rows) {
        const mapped = mapRealieRow(row);
        if (mapped && !mapped.sourceUrl) {
          mapped.sourceUrl = `${REALIE_BASE_URL}/condos/${row.id ?? ''}`;
        }
        if (!mapped) {
          skippedNoEmail++;
          continue;
        }
        if (mapped.rowStatus === 'needs_review') needsReview++;

        if (args.dryRun) {
          console.log(
            `[dry-run] ${mapped.rowStatus.padEnd(13)} ${mapped.boardEmailLowercase.padEnd(40)} ${mapped.buildingAddressNormalized}` +
              (mapped.diagnostics.reason ? ` (${mapped.diagnostics.reason})` : ''),
          );
        } else {
          await upsertProspect(prisma, mapped, startedAt);
          written++;
        }
      }

      if (!hasMore) break;
      page++;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n── Scrape summary ──────────────────────────────────────────────');
  console.log(`fetched:         ${totalFetched}`);
  console.log(`skipped_no_email: ${skippedNoEmail}`);
  console.log(`needs_review:    ${needsReview}  (role address or property-manager flag)`);
  console.log(args.dryRun ? `WOULD write:    ${totalFetched - skippedNoEmail}` : `written:         ${written}`);
  console.log(`scraper_version: ${SCRAPER_VERSION}`);
  console.log(`started_at:      ${startedAt.toISOString()}`);
  if (args.dryRun) {
    console.log('\nDRY RUN — no DB writes performed.');
  }
}

main().catch((err) => {
  console.error('[scrape] fatal:', err);
  process.exit(1);
});
