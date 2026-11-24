/**
 * /deadlines and /townships server HTML must carry the same verified calendar
 * the browser shows after hydration.
 *
 * Bug: the routes rendered <LiveDeadlinesPage /> with no server read and both
 * client hooks started unavailable, so crawler/no-JS HTML showed dashes and
 * all 38 townships pending while the hydrated page showed 7 open / 31 closed.
 *
 * Fixture: RETAINED PUBLIC SNAPSHOT copied byte-for-byte from the public
 * `GET /api/deadlines/informational` response captured 2026-11-24T00:05Z
 * (evidence api.txt). It is test data here, not a new fetch.
 *
 * Seams faked: the storage reader (returns those bytes) and global fetch.
 * The real route, LiveDeadlinesPage, DeadlinesPage, both hooks, the guarded
 * server reader, the decoder and the canonical evaluator all run.
 *
 * Two render modes, reported separately:
 *  - SSR: renderToString of the element the async route returns (JSX render).
 *  - Hydration: that HTML hydrated with hydrateRoot in jsdom, effects mounted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { DEFAULT_SOURCE_TTL_MS } from "@/lib/deadlines/official-source-state";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/deadlines/informational-snapshot-store", () => ({ informationalSnapshotReader: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({ analytics: new Proxy({}, { get: () => jest.fn() }) }));
jest.mock("@/components/ot-design/SiteChrome", () => ({
  ...jest.requireActual("@/components/ot-design/SiteChrome"),
  SiteHeader: () => <header />, SiteFooter: () => <footer />,
}));

import * as storeModule from "@/lib/deadlines/informational-snapshot-store";
import DeadlinesRoute from "@/app/deadlines/page";
import TownshipsRoute from "@/app/townships/page";
import * as deadlinesRouteModule from "@/app/deadlines/page";
import * as townshipsRouteModule from "@/app/townships/page";

const RAW = readFileSync(join(process.cwd(), "__tests__/fixtures/deadlines/retained-public-informational-20261124.json"), "utf8");
const RETRIEVED = JSON.parse(RAW).sources.assessor.retrievedAt as string; // 2026-11-24T00:05:12.249Z
const FLAG = "OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED";
const oldFlag = process.env[FLAG];
const factory = jest.mocked(storeModule.informationalSnapshotReader);
const reads: Date[] = [];
let stored: unknown = JSON.parse(RAW);
const realFetch = global.fetch;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let fetchMock: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  jest.setSystemTime(new Date("2026-11-24T01:00:00Z")); // Nov 23 evening, Chicago
  process.env[FLAG] = "true";
  stored = JSON.parse(RAW);
  reads.length = 0;
  factory.mockReset();
  factory.mockImplementation(async () => ({ async read(now: Date) { reads.push(now); return stored } }) as never);
  fetchMock = jest.fn(() => new Promise(() => {}));
  global.fetch = fetchMock as never;
});
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  if (oldFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = oldFlag;
});

const routes = [["deadlines", DeadlinesRoute], ["townships", TownshipsRoute]] as const;

/** Headline summary numbers in page order: open, pending, closed. */
function summary(html: string): string[] {
  return [...html.matchAll(/class="ot-status-summary-num"[^>]*>([^<]*)</g)].map(m => m[1]);
}
function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
async function ssr(Route: (typeof routes)[number][1]) {
  const element = await (Route as () => Promise<React.ReactElement>)();
  return { element, html: renderToString(element) };
}

describe("server HTML (JSX render of the async route)", () => {
  it.each(routes)("%s: both routes are per-request dynamic", (name) => {
    const mod = name === "deadlines" ? deadlinesRouteModule : townshipsRouteModule;
    expect((mod as { dynamic?: string }).dynamic).toBe("force-dynamic");
  });

  it.each(routes)("%s: retained snapshot renders 7 open / 0 pending / 31 closed in server HTML, one store read, no fetch", async (_n, Route) => {
    const { html } = await ssr(Route);
    expect(summary(html)).toEqual(["7", "0", "31"]);
    const visible = text(html);
    expect(visible).not.toContain("The official calendar is loading or unavailable");
    expect(visible).toContain("Thornton");
    expect(visible).toContain(RETRIEVED);
    expect(reads.map(d => d.toISOString())).toEqual(["2026-11-24T01:00:00.000Z"]);
    expect(fetchMock).not.toHaveBeenCalled();
    // Informational tier only: no capture, countdown or checkout.
    expect(html).not.toMatch(/type="email"|days? left|checkout/i);
  });

  it("UTC-vs-Chicago rollover: 05:59:59Z is still Nov 23 (7/31); 06:00:00Z is Nov 24 (6/32)", async () => {
    jest.setSystemTime(new Date("2026-11-24T05:59:59Z"));
    expect(summary((await ssr(DeadlinesRoute)).html)).toEqual(["7", "0", "31"]);
    // Same retrieval at the Nov 24 Chicago day: the existing evaluator withdraws open
    // rows retrieved on a previous Chicago day (pending until re-retrieval).
    jest.setSystemTime(new Date("2026-11-24T06:00:00Z"));
    expect(summary((await ssr(DeadlinesRoute)).html)).toEqual(["0", "6", "32"]);
    // Deterministic-test adjustment only: the same rows retrieved on Nov 24 Chicago.
    const s = JSON.parse(RAW); s.sources.assessor.retrievedAt = "2026-11-24T06:00:00.000Z"; stored = s;
    const html = (await ssr(DeadlinesRoute)).html;
    expect(summary(html)).toEqual(["6", "0", "32"]); // Thornton (last file Nov 23) is now closed
  });

  it("named rows: Thornton open on its last day, Schaumburg closed (last file Nov 19)", async () => {
    const { views } = await import("@/lib/deadlines-2026").then(m => ({ views: m.buildTownship2026Views(new Date(), JSON.parse(RAW)) }));
    const by = Object.fromEntries(views.map(v => [v.slug, v]));
    expect(by.thornton.status).toBe("open");
    expect(by.schaumburg.status).toBe("closed");
    const visible = text((await ssr(DeadlinesRoute)).html);
    expect(visible).toContain(`Last file: ${by.thornton.lastFileLabel}`);
    expect(visible).toContain(`Last file: ${by.schaumburg.lastFileLabel}`);
    expect(views.filter(v => v.status === "open").map(v => v.slug).sort())
      .toEqual(["bloom", "hanover", "niles", "north-chicago", "rich", "south-chicago", "thornton"]);
  });

  it.each([
    ["store unavailable", () => { factory.mockResolvedValue(null as never); }],
    ["no stored row", () => { stored = null; }],
    ["flag disabled", () => { delete process.env[FLAG]; }],
    ["stale source", () => { jest.setSystemTime(new Date(Date.parse(RETRIEVED) + DEFAULT_SOURCE_TTL_MS + 1000)); }],
    ["synthetic snapshot", () => { stored = { ...JSON.parse(RAW), synthetic: true }; }],
  ])("%s → server HTML stays unavailable (dashes), no synthetic fallback", async (_l, arrange) => {
    arrange();
    const { html } = await ssr(DeadlinesRoute);
    expect(summary(html)).toEqual(["—", "—", "—"]);
    expect(text(html)).toContain("The official calendar is loading or unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hydration of that server HTML (mounted, jsdom)", () => {
  async function hydrate(Route: (typeof routes)[number][1]) {
    const { element, html } = await ssr(Route);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = jest.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: e => errors.push(e) });
    });
    consoleError.mockRestore();
    return { container, root, errors, html };
  }

  it.each(routes)("%s: first client render matches server HTML and keeps valid data while refetch is pending", async (_n, Route) => {
    const { container, root, errors } = await hydrate(Route);
    expect(errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // live refresh still runs
    expect(summary(container.innerHTML)).toEqual(["7", "0", "31"]);
    act(() => root.unmount());
  });

  it("refetch failure withdraws the server data", async () => {
    let fail!: () => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { fail = () => resolve({ status: 503, text: async () => "" }); }));
    const { container, root } = await hydrate(DeadlinesRoute);
    expect(summary(container.innerHTML)).toEqual(["7", "0", "31"]);
    await act(async () => { fail(); });
    expect(summary(container.innerHTML)).toEqual(["—", "—", "—"]);
    act(() => root.unmount());
  });

  it("mounted calendar rolls over at Chicago midnight and expires at source TTL", async () => {
    const { container, root } = await hydrate(DeadlinesRoute);
    act(() => { jest.setSystemTime(new Date("2026-11-24T05:59:58.500Z")); jest.advanceTimersByTime(1000); });
    expect(summary(container.innerHTML)).toEqual(["7", "0", "31"]);
    act(() => { jest.setSystemTime(new Date("2026-11-24T05:59:59.500Z")); jest.advanceTimersByTime(1000); });
    // Chicago midnight without a new successful response: open rows withdraw.
    expect(summary(container.innerHTML)).toEqual(["0", "6", "32"]);
    act(() => { jest.setSystemTime(new Date(Date.parse(RETRIEVED) + DEFAULT_SOURCE_TTL_MS)); jest.advanceTimersByTime(1000); });
    expect(summary(container.innerHTML)).toEqual(["—", "—", "—"]);
    act(() => root.unmount());
  });

  it("hidden tab at hydration does not keep server dates", async () => {
    const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const { container, root } = await hydrate(DeadlinesRoute);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(summary(container.innerHTML)).toEqual(["—", "—", "—"]);
      act(() => root.unmount());
    } finally { visibility.mockRestore(); }
  });
});
