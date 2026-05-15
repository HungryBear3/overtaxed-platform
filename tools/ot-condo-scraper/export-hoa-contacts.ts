// OT HOA / Condo-Board Contact Pipeline — deterministic exporter
//
// Why this exists (versus the existing scrape.ts in this directory):
//   The existing Realie-based scraper is currently blocked by three
//   unrelated issues: missing outreach_prospects table, stale Realie base
//   URL (api.realie.io DNS fail), and a Prisma v7 client init issue. This
//   exporter sidesteps all three so we can produce a reviewable HOA/condo
//   prospect CSV today, deterministically, with zero DB writes, zero
//   external API calls, and zero secrets.
//
// What it does:
//   - Reads a versioned seed JSON of vetted public-source HOA management
//     companies and condo associations (`data/hoa-prospects-seed.json`).
//   - Validates each row against the documented schema (and refuses to
//     write the CSV if a row is missing required fields or carries an
//     unknown row_status / confidence value).
//   - Emits a CSV at the workspace docs path the operator uses for review.
//
// What it does NOT do:
//   - No DB writes (no Prisma, no `outreach_prospects` write path).
//   - No external HTTP calls. No Realie, Hunter, Apollo, Resend, anything.
//     Web research lives outside the script; results are folded back into
//     the seed JSON by hand and re-exported here.
//   - No outreach. No sends. No CRM writes. No form submissions.
//   - No secrets. The script reads no env vars beyond optional CLI args.
//
// CLI:
//   pnpm tsx tools/ot-condo-scraper/export-hoa-contacts.ts
//   pnpm tsx tools/ot-condo-scraper/export-hoa-contacts.ts --dry-run
//   pnpm tsx tools/ot-condo-scraper/export-hoa-contacts.ts --out /tmp/test.csv
//   pnpm tsx tools/ot-condo-scraper/export-hoa-contacts.ts --seed alt-seed.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_SEED = resolve(
  __dirname,
  'data',
  'hoa-prospects-seed.json',
);

const DEFAULT_OUT = resolve(
  '/Users/abigailclaw/.openclaw/workspace/docs/outreach/hoa-management',
  'hoa-contact-research-queue.csv',
);

const ALLOWED_CATEGORIES = new Set([
  'hoa_management_company',
  'condo_association',
  'board_member_lead',
  'directory_resource',
]);

const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);

const ALLOWED_OUTREACH_STATUSES = new Set([
  'needs_research',
  'needs_review',
  'ok',
]);

// Column order in the emitted CSV. Mirrors the minimum-useful-fields list in
// the prompt. Keep in sync with ProspectRow below.
const COLUMNS = [
  'organization_name',
  'category',
  'city_or_service_area',
  'website',
  'public_contact_name',
  'public_contact_role',
  'public_email',
  'public_phone',
  'source_url',
  'confidence',
  'notes',
  'outreach_status',
] as const;

type Column = (typeof COLUMNS)[number];

interface ProspectRow {
  organization_name: string;
  category: string;
  city_or_service_area: string;
  website: string;
  public_contact_name: string;
  public_contact_role: string;
  public_email: string;
  public_phone: string;
  source_url: string;
  confidence: string;
  notes: string;
  outreach_status: string;
}

interface CliArgs {
  seedPath: string;
  outPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };
  const has = (name: string) => argv.includes(`--${name}`);
  return {
    seedPath: resolve(get('seed') ?? DEFAULT_SEED),
    outPath: resolve(get('out') ?? DEFAULT_OUT),
    dryRun: has('dry-run'),
  };
}

function validateRow(row: unknown, index: number): ProspectRow {
  if (typeof row !== 'object' || row === null) {
    throw new Error(`seed[${index}]: row must be an object`);
  }
  const r = row as Record<string, unknown>;

  const stringField = (key: Column, required: boolean): string => {
    const v = r[key];
    if (v === undefined || v === null) {
      if (required) {
        throw new Error(`seed[${index}].${key}: required field missing`);
      }
      return '';
    }
    if (typeof v !== 'string') {
      throw new Error(`seed[${index}].${key}: must be a string, got ${typeof v}`);
    }
    return v;
  };

  const organization_name = stringField('organization_name', true).trim();
  if (!organization_name) {
    throw new Error(`seed[${index}].organization_name: must be non-empty`);
  }

  const category = stringField('category', true).trim();
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(
      `seed[${index}].category: '${category}' not in {${[...ALLOWED_CATEGORIES].join(', ')}}`,
    );
  }

  const confidence = stringField('confidence', true).trim().toLowerCase();
  if (!ALLOWED_CONFIDENCE.has(confidence)) {
    throw new Error(
      `seed[${index}].confidence: '${confidence}' not in {${[...ALLOWED_CONFIDENCE].join(', ')}}`,
    );
  }

  const outreachRaw = stringField('outreach_status', false).trim().toLowerCase();
  const outreach_status = outreachRaw || 'needs_review';
  if (!ALLOWED_OUTREACH_STATUSES.has(outreach_status)) {
    throw new Error(
      `seed[${index}].outreach_status: '${outreach_status}' not in {${[...ALLOWED_OUTREACH_STATUSES].join(', ')}}`,
    );
  }

  const source_url = stringField('source_url', true).trim();
  if (!source_url) {
    throw new Error(`seed[${index}].source_url: required (every row must cite a public source)`);
  }
  if (outreach_status === 'ok' && !source_url) {
    // Belt-and-suspenders: covered by the check above, but make the
    // compliance gate explicit so an edit elsewhere can't quietly lose it.
    throw new Error(
      `seed[${index}]: cannot mark outreach_status='ok' without a source_url`,
    );
  }

  return {
    organization_name,
    category,
    city_or_service_area: stringField('city_or_service_area', false).trim(),
    website: stringField('website', false).trim(),
    public_contact_name: stringField('public_contact_name', false).trim(),
    public_contact_role: stringField('public_contact_role', false).trim(),
    public_email: stringField('public_email', false).trim(),
    public_phone: stringField('public_phone', false).trim(),
    source_url,
    confidence,
    notes: stringField('notes', false).trim(),
    outreach_status,
  };
}

function escapeCsvField(value: string): string {
  // RFC 4180-ish: quote if the field contains comma, quote, CR or LF;
  // double internal quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function renderCsv(rows: ProspectRow[]): string {
  const lines: string[] = [];
  lines.push(COLUMNS.join(','));
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => escapeCsvField(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  let raw: string;
  try {
    raw = await readFile(args.seedPath, 'utf8');
  } catch (err) {
    console.error(`[export-hoa] failed to read seed at ${args.seedPath}:`, err);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[export-hoa] seed is not valid JSON:`, err);
    return 2;
  }

  if (!Array.isArray(parsed)) {
    console.error(`[export-hoa] seed must be a JSON array of prospect rows`);
    return 2;
  }

  let rows: ProspectRow[];
  try {
    rows = parsed.map((r, i) => validateRow(r, i));
  } catch (err) {
    console.error(`[export-hoa] validation failed:`, err instanceof Error ? err.message : err);
    return 2;
  }

  const csv = renderCsv(rows);
  const byCategory: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    byConfidence[r.confidence] = (byConfidence[r.confidence] ?? 0) + 1;
    byStatus[r.outreach_status] = (byStatus[r.outreach_status] ?? 0) + 1;
  }

  console.log('── HOA contact export summary ──────────────────────────────────');
  console.log(`seed:            ${args.seedPath}`);
  console.log(`rows:            ${rows.length}`);
  console.log(`by_category:     ${JSON.stringify(byCategory)}`);
  console.log(`by_confidence:   ${JSON.stringify(byConfidence)}`);
  console.log(`by_status:       ${JSON.stringify(byStatus)}`);

  if (args.dryRun) {
    console.log(`out (dry-run):   ${args.outPath} — NOT written`);
    console.log('\n── CSV preview ────────────────────────────────────────────────');
    process.stdout.write(csv);
    return 0;
  }

  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, csv, 'utf8');
  console.log(`out:             ${args.outPath} (${csv.length} bytes)`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[export-hoa] fatal:', err);
    process.exit(1);
  });
