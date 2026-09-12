/** @jest-environment node */
import { TOWNSHIPS } from "@/lib/townships";
import { decodeInformationalSnapshot, INFORMATIONAL_SOURCE_URL as URL } from "@/lib/deadlines/informational-snapshot";
import { buildTownship2026Views, count2026Views } from "@/lib/deadlines-2026";
const AT = new Date("2026-09-12T07:00:00Z");
function fixture() {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: URL, finalUrl: URL, httpStatus: 200,
    retrievedAt: AT.toISOString(), sourceUpdatedAt: null, contentSha256: "a".repeat(64),
    parseStatus: "ok", parserVersion: "ccao-dom/1.0.0",
  } }, townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name,
    stages: { assessor: t.slug === "barrington" ? { noticeDate: "2026-08-11", openDate: "2026-08-11", lastFileDate: "2026-09-23" } : null },
  }])) };
}
test("exact canonical38 passes and remains informational-only", () => {
  const snapshot = decodeInformationalSnapshot(JSON.stringify(fixture()), AT)!;
  expect(snapshot).not.toBeNull();
  const views = buildTownship2026Views(AT, snapshot);
  expect(count2026Views(views).official).toBe(1);
  expect(views.every(v => !v.allowReminderSignup && v.daysUntilLastFile === undefined)).toBe(true);
});
test.each(["missing", "extra", "alias", "wrong-name"])("refuses %s roster even with plausible provenance", kind => {
  const value = fixture();
  if (kind === "missing") delete value.townships.barrington;
  if (kind === "extra") value.townships.unknown = value.townships.barrington;
  if (kind === "alias") { value.townships.lakeview = value.townships["lake-view"]; delete value.townships["lake-view"]; }
  if (kind === "wrong-name") value.townships["lake-view"].townshipName = "Lakeview";
  expect(decodeInformationalSnapshot(JSON.stringify(value), AT)).toBeNull();
});
test.each([
  { parserVersion: "unapproved-parser" }, { contentSha256: "invalid" }, { httpStatus: 403 },
  { finalUrl: "https://example.com" }, { sourceUrl: "https://example.com" },
  { retrievedAt: "2026-02-30T12:00:00Z" }, { retrievedAt: "2026-09-13T07:00:00Z" },
  { retrievedAt: "2026-09-11T06:59:59Z" }, { sourceUpdatedAt: "2026-09-14T00:00:00Z" },
])("refuses invalid source %j", override => {
  const value = fixture(); Object.assign(value.sources.assessor, override);
  expect(decodeInformationalSnapshot(JSON.stringify(value), AT)).toBeNull();
});
test.each([
  { openDate: "2025-08-11" }, { lastFileDate: "2027-09-23" }, { lastFileDate: "2026-02-30" },
  { noticeDate: null }, { lastFileDate: "2026-08-01" }, { allowCheckout: true },
])("refuses invalid or capability-shaped window %j", override => {
  const value = fixture(); Object.assign(value.townships.barrington.stages.assessor!, override);
  expect(decodeInformationalSnapshot(JSON.stringify(value), AT)).toBeNull();
});
test("TTL boundary is canonical; same-day expiry remains the projector's decision", () => {
  const raw = JSON.stringify(fixture());
  const tomorrow = new Date(AT.getTime() + 86_400_000);
  const snapshot = decodeInformationalSnapshot(raw, tomorrow)!;
  expect(snapshot).not.toBeNull();
  expect(count2026Views(buildTownship2026Views(tomorrow, snapshot)).official).toBe(0);
  expect(decodeInformationalSnapshot(raw, new Date(tomorrow.getTime() + 1))).toBeNull();
});
test.each(["not-json", "x".repeat(100001), JSON.stringify({ ...fixture(), synthetic: true })])("malformed/synthetic input refuses", raw => {
  expect(decodeInformationalSnapshot(raw, AT)).toBeNull();
});
