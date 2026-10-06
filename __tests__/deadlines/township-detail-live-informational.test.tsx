/**
 * @jest-environment node
 *
 * /township/[slug] reads the same informational snapshot as the indexes.
 *
 * `/deadlines` and `/townships` hydrate from `GET /api/deadlines/informational`
 * (store → decode → canonical evaluator). The singular detail route used to
 * evaluate the bundled synthetic default instead, so all 38 detail pages said
 * "Not verified" while the indexes showed current rows. These tests render the
 * real route — body, metadata, FAQPage JSON-LD and neighbour cards — against
 * the real store/decoder with a fake database client, and require every one of
 * them to match what the index derives from the public API for the same row.
 *
 * Every snapshot below is a HYPOTHETICAL TEST FIXTURE. Its dates, hash and
 * retrieval instant are invented; none of it is an official fetch result.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { DEFAULT_SOURCE_TTL_MS } from "@/lib/deadlines/official-source-state";
import { decodeInformationalSnapshot, INFORMATIONAL_SOURCE_URL } from "@/lib/deadlines/informational-snapshot";
import { buildTownship2026Views, type Township2026View } from "@/lib/deadlines-2026";
import { DEADLINE_PENDING_NOTICE } from "@/lib/deadline-sources";
import { TOWNSHIPS, TOWNSHIPS_BY_SLUG } from "@/lib/townships";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/deadlines/informational-snapshot-store", () => {
  const actual = jest.requireActual("@/lib/deadlines/informational-snapshot-store");
  return { ...actual, informationalSnapshotReader: jest.fn() };
});
jest.mock("@/lib/analytics/events", () => ({
  analytics: new Proxy({}, { get: () => jest.fn() }),
}));

import * as storeModule from "@/lib/deadlines/informational-snapshot-store";
import TownshipRoutePage, { generateMetadata, dynamic } from "@/app/township/[slug]/page";
import { GET as readInformational } from "@/app/api/deadlines/informational/route";

const factory = jest.mocked(storeModule.informationalSnapshotReader);
const { createInformationalSnapshotStore } = storeModule;

// Hypothetical evaluation clock and retrieval instant (not a real fetch time).
const AT = new Date("2026-10-06T03:00:00Z");
const RETRIEVED = "2026-10-06T01:00:00Z";
const FLAG = "OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED";
const oldFlag = process.env[FLAG];

type Row = { noticeDate: string; openDate: string; lastFileDate: string } | null;
/** Hypothetical rows cycling through open / closed / unpublished / upcoming. */
function hypotheticalRow(i: number): Row {
  switch (i % 4) {
    case 0: return { noticeDate: "2026-09-21", openDate: "2026-09-21", lastFileDate: "2026-11-12" };
    case 1: return { noticeDate: "2026-08-03", openDate: "2026-08-03", lastFileDate: "2026-09-02" };
    case 2: return null;
    default: return { noticeDate: "2026-10-20", openDate: "2026-10-20", lastFileDate: "2026-11-19" };
  }
}
function hypotheticalSnapshot(row: (i: number) => Row = hypotheticalRow) {
  return {
    schemaVersion: 1 as const, synthetic: false,
    sources: { bor: null, assessor: {
      authority: "cook_county_assessor" as const, sourceUrl: INFORMATIONAL_SOURCE_URL, finalUrl: INFORMATIONAL_SOURCE_URL,
      httpStatus: 200, retrievedAt: RETRIEVED, sourceUpdatedAt: null,
      contentSha256: "0123456789abcdef".repeat(4), parseStatus: "ok" as const, parserVersion: "ccao-dom/1.0.0",
    } },
    townships: Object.fromEntries(TOWNSHIPS.map((t, i) => [t.slug, { townshipName: t.name, stages: { assessor: row(i) } }])),
  };
}

/** Real store over a fake client: the stored bytes go through the production decode path. */
let stored: string | null = null;
const reads: Date[] = [];
function installStore() {
  factory.mockImplementation(async () => {
    const store = createInformationalSnapshotStore({
      $queryRaw: (async () => (stored === null ? [] : [{ value: stored }])) as never,
      $transaction: (async () => { throw new Error("tests never write"); }) as never,
    });
    return { async read(now: Date) { reads.push(now); return store.read(now); } } as never;
  });
}

const PILL: Record<Township2026View["status"], string> = {
  open: "Open now", upcoming: "Not yet open", closed: "Closed", pending: "Not verified",
};

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

async function renderRoute(slug: string) {
  const element = await TownshipRoutePage({ params: Promise.resolve({ slug }) });
  const html = renderToStaticMarkup(element);
  const metadata = await generateMetadata({ params: Promise.resolve({ slug }) });
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const faq = scripts.find(s => s["@type"] === "FAQPage");
  const heroPill = html.match(/class="ot-status-pill ot-status-md[^"]*"><span class="ot-status-dot"><\/span>([^<]+)<\/span>/)?.[1];
  const neighbors = [...html.matchAll(/<a class="ot-tp-neighbor-card" href="\/township\/([a-z-]+)">([\s\S]*?)<\/a>|<a href="\/township\/([a-z-]+)" class="ot-tp-neighbor-card">([\s\S]*?)<\/a>/g)]
    .map(m => ({ slug: m[1] ?? m[3], body: text(m[2] ?? m[4]) }));
  return { html, visible: text(html), metadata, faq, heroPill, neighbors };
}

/** What the index derives: public API JSON → client decode → canonical evaluator. */
async function indexViews(): Promise<Map<string, Township2026View>> {
  const raw = await (await readInformational()).text();
  const snapshot = decodeInformationalSnapshot(raw, AT) ?? { schemaVersion: 1, synthetic: true, sources: { assessor: null, bor: null }, townships: {} } as OfficialDeadlineSnapshot;
  return new Map(buildTownship2026Views(AT, snapshot).map(v => [v.slug, v]));
}

function expectRouteMatchesView(r: Awaited<ReturnType<typeof renderRoute>>, view: Township2026View, views: Map<string, Township2026View>) {
  const name = TOWNSHIPS_BY_SLUG[view.slug].name;
  expect({ slug: view.slug, pill: r.heroPill }).toEqual({ slug: view.slug, pill: PILL[view.status] });
  const description = String(r.metadata.description);
  const firstAnswer: string = r.faq.mainEntity[0].acceptedAnswer.text;
  if (view.official) {
    expect(r.visible).toContain(view.lastFileLabel);
    expect(description).toContain(`${view.openLabel} – ${view.lastFileLabel}`);
    expect(firstAnswer).toContain(view.lastFileLabel);
    expect(firstAnswer).toContain(RETRIEVED);
    expect(r.visible).not.toContain("We have not verified the");
  } else {
    expect(r.visible).toContain("Not verified — see the county calendar");
    expect(description).toContain("We have not verified this township's Assessor filing deadline");
    expect(firstAnswer).toContain(DEADLINE_PENDING_NOTICE);
  }
  // FAQ JSON-LD answers are the visible FAQ answers, from the same evaluation.
  for (const q of r.faq.mainEntity) expect(r.visible).toContain(q.acceptedAnswer.text);
  // Neighbour cards read their own projections from the same snapshot.
  const expectedNeighbors = TOWNSHIPS_BY_SLUG[view.slug].neighbors ?? [];
  expect(r.neighbors.map(n => n.slug)).toEqual(expectedNeighbors);
  for (const n of r.neighbors) {
    const nv = views.get(n.slug)!;
    expect({ neighbor: n.slug, body: n.body }).toEqual({
      neighbor: n.slug,
      body: expect.stringContaining(nv.official ? `${PILL[nv.status]} ${TOWNSHIPS_BY_SLUG[n.slug].name} Township Last file ${nv.lastFileLabel}` : `Not verified ${TOWNSHIPS_BY_SLUG[n.slug].name} Township No verified deadline`),
    });
  }
  // Informational tier: no countdown, reminder, checkout or eligibility capability.
  expect(view.allowReminderSignup).toBe(false);
  expect(view.daysUntilLastFile).toBeUndefined();
  for (const pattern of [/tp-reminder/, /Notify me/, /days? left/i, /days? until/i, /checkout/i, /\$\d/, /you(?:'re| are) eligible/i, /File (?:now|my appeal)/i])
    expect({ slug: view.slug, pattern: String(pattern), matched: pattern.test(r.html) || pattern.test(description) })
      .toEqual({ slug: view.slug, pattern: String(pattern), matched: false });
  expect(r.metadata.alternates?.canonical).toMatch(new RegExp(`/township/${view.slug}$`));
  void name;
}

let fetchSpy: jest.SpyInstance | undefined;
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }).setSystemTime(AT);
  factory.mockReset();
  reads.length = 0;
  stored = JSON.stringify(hypotheticalSnapshot());
  process.env[FLAG] = "true";
  installStore();
  if (typeof globalThis.fetch === "function") fetchSpy = jest.spyOn(globalThis, "fetch");
});
afterEach(() => {
  jest.useRealTimers();
  fetchSpy?.mockRestore();
  if (oldFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = oldFlag;
});

describe("/township/[slug] with a current (hypothetical) informational snapshot", () => {
  it("stays per-request dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("all 38 detail routes match the index row for body, metadata, FAQ JSON-LD and neighbours", async () => {
    const views = await indexViews();
    expect(views.size).toBe(38);
    const statuses = new Set([...views.values()].map(v => v.status));
    expect(statuses).toEqual(new Set(["open", "closed", "pending", "upcoming"]));
    for (const t of TOWNSHIPS) {
      const view = views.get(t.slug)!;
      expectRouteMatchesView(await renderRoute(t.slug), view, views);
    }
    expect(fetchSpy?.mock.calls ?? []).toEqual([]);
  });

  it("reads the store once per render, at the request clock, with no HTTP fetch", async () => {
    await TownshipRoutePage({ params: Promise.resolve({ slug: "jefferson" }) });
    expect(reads).toHaveLength(1);
    expect(reads[0].toISOString()).toBe(AT.toISOString());
    await generateMetadata({ params: Promise.resolve({ slug: "jefferson" }) });
    expect(reads).toHaveLength(2);
    expect(reads[1].toISOString()).toBe(AT.toISOString());
    expect(fetchSpy?.mock.calls ?? []).toEqual([]);
  });

  it("a closed row stays closed: CC-16 provenance, no check CTA, no capture", async () => {
    const views = await indexViews();
    const closed = [...views.values()].find(v => v.status === "closed")!;
    const r = await renderRoute(closed.slug);
    expect(r.visible).toContain(`The window closed ${closed.lastFileLabel}`);
    expect(r.html).not.toContain('class="ot-tp-check-eyebrow">For your property');
    expect(r.html).not.toContain("tp-reminder");
  });

  it("an unpublished row stays pending while its neighbours show their own dates", async () => {
    const views = await indexViews();
    const pending = [...views.values()].find(v => v.status === "pending")!;
    expect(pending.pendingReason).not.toBe("synthetic_source");
    const r = await renderRoute(pending.slug);
    expect(r.heroPill).toBe("Not verified");
    expectRouteMatchesView(r, pending, views);
  });
});

describe("/township/[slug] fails closed to the existing pending page", () => {
  const minus = (ms: number) => new Date(AT.getTime() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const cases: Array<[string, () => void]> = [
    ["refresh flag disabled (unavailable)", () => { delete process.env[FLAG]; }],
    ["store unavailable", () => { factory.mockResolvedValue(null); }],
    ["store factory throws", () => { factory.mockRejectedValue(new Error("private driver diagnostics")); }],
    ["no stored row", () => { stored = null; }],
    ["expired source", () => { const s = hypotheticalSnapshot(); s.sources.assessor.retrievedAt = minus(DEFAULT_SOURCE_TTL_MS + 1000); stored = JSON.stringify(s); }],
    ["future source", () => { const s = hypotheticalSnapshot(); s.sources.assessor.retrievedAt = minus(-60_000); stored = JSON.stringify(s); }],
    ["synthetic snapshot", () => { stored = JSON.stringify({ ...hypotheticalSnapshot(), synthetic: true }); }],
    ["malformed JSON", () => { stored = "{not json"; }],
    ["missing township row", () => { const s = hypotheticalSnapshot(); delete (s.townships as Record<string, unknown>).jefferson; stored = JSON.stringify(s); }],
    ["unexpected field", () => { stored = JSON.stringify({ ...hypotheticalSnapshot(), extra: true }); }],
    ["wrong-year dates", () => { stored = JSON.stringify(hypotheticalSnapshot(() => ({ noticeDate: "2025-09-21", openDate: "2025-09-21", lastFileDate: "2025-11-12" }))); }],
    ["all rows unpublished", () => { stored = JSON.stringify(hypotheticalSnapshot(() => null)); }],
  ];

  it.each(cases)("%s → every detail route is pending in body, metadata, FAQ and neighbours", async (_label, arrange) => {
    arrange();
    for (const t of TOWNSHIPS) {
      const r = await renderRoute(t.slug);
      expect({ slug: t.slug, pill: r.heroPill }).toEqual({ slug: t.slug, pill: "Not verified" });
      expect(String(r.metadata.description)).toContain("We have not verified this township's Assessor filing deadline");
      expect(r.faq.mainEntity[0].acceptedAnswer.text).toContain(DEADLINE_PENDING_NOTICE);
      for (const n of r.neighbors) expect(n.body).toContain("No verified deadline");
      expect(r.html).not.toMatch(/Open now|Last file |tp-reminder|days? left/);
    }
    expect(fetchSpy?.mock.calls ?? []).toEqual([]);
  });
});
