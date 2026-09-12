/** @jest-environment node */
import { createHash } from "node:crypto";
import { collectInformationalSnapshot, MAX_ASSESSOR_HTML_BYTES } from "@/lib/deadlines/collect-informational-snapshot";
import { INFORMATIONAL_SOURCE_URL as URL } from "@/lib/deadlines/informational-snapshot";
import { TOWNSHIPS } from "@/lib/townships";
jest.mock("server-only", () => ({}));
const AT = new Date("2026-09-12T07:00:00Z");
const old = process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
beforeEach(() => { process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true"; });
afterEach(() => { if (old === undefined) delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; else process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = old; });
function setup(bytes: Uint8Array = Buffer.from("fictional HTML fixture"), status = 200, url = URL, contentType = "text/html; charset=utf-8") {
  const response = new Response(bytes as BodyInit, { status, headers: { "content-type": contentType } });
  Object.defineProperty(response, "url", { value: url });
  const fetchSource = jest.fn().mockResolvedValue(response);
  const parseHtml = jest.fn(() => Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name, stages: { assessor: null } }])));
  return { fetchSource, parseHtml, now: () => AT };
}
test("binds exact HTTP bytes and actual start clock to complete validated rows", async () => {
  const bytes = Buffer.from("synthetic UTF8 café"); const input = setup(bytes);
  const result = await collectInformationalSnapshot(input);
  expect(result?.sources.assessor).toMatchObject({ retrievedAt: AT.toISOString(), contentSha256: createHash("sha256").update(bytes).digest("hex"), parserVersion: "ccao-dom/1.0.0" });
  expect(input.fetchSource).toHaveBeenCalledWith(URL, expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
  expect(input.parseHtml).toHaveBeenCalledWith("synthetic UTF8 café", 2026);
});
test.each([
  [Buffer.from("fixture"), 403, URL, "text/html"],
  [Buffer.from("fixture"), 200, "https://example.com", "text/html"],
  [Buffer.from("fixture"), 200, URL, "application/pdf"],
  [new Uint8Array(), 200, URL, "text/html"],
  [new Uint8Array(MAX_ASSESSOR_HTML_BYTES + 1), 200, URL, "text/html"],
  [new Uint8Array([0xff]), 200, URL, "text/html"],
] as const)("rejects invalid transport or bytes", async (bytes, status, url, mime) => {
  const input = setup(bytes, status, url, mime);
  expect(await collectInformationalSnapshot(input)).toBeNull();
  expect(input.parseHtml).not.toHaveBeenCalled();
});
test("disabled flag never fetches and late disable never parses/publishes", async () => {
  const input = setup(); delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED;
  expect(await collectInformationalSnapshot(input)).toBeNull(); expect(input.fetchSource).not.toHaveBeenCalled();
  process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
  const original = input.fetchSource.getMockImplementation()!;
  input.fetchSource.mockImplementation(async () => { delete process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED; return original(); });
  expect(await collectInformationalSnapshot(input)).toBeNull(); expect(input.parseHtml).not.toHaveBeenCalled();
});
test("parser/transport failure and incomplete roster refuse without partial success", async () => {
  const input = setup(); input.parseHtml.mockReturnValue({});
  expect(await collectInformationalSnapshot(input)).toBeNull();
  const broken = setup(); broken.parseHtml.mockImplementation(() => { throw new Error("raw untrusted HTML"); });
  expect(await collectInformationalSnapshot(broken)).toBeNull();
  const unavailable = setup(); unavailable.fetchSource.mockRejectedValue(new Error("network failure"));
  expect(await collectInformationalSnapshot(unavailable)).toBeNull();
});

test.each(["text/html; charset=iso-8859-1", "text/html; charset=utf-8; charset=latin1", "text/html; charset=", "text/html; charset=utf-8, text/html; charset=latin1"])("rejects unsupported or ambiguous encoding %s", async mime => {
  const input = setup(Buffer.from("fixture"), 200, URL, mime);
  expect(await collectInformationalSnapshot(input)).toBeNull();
  expect(input.parseHtml).not.toHaveBeenCalled();
});
test.each(['text/html', 'Text/HTML; Charset="UTF-8"'])("accepts unambiguous supported encoding %s", async mime => {
  expect(await collectInformationalSnapshot(setup(Buffer.from("fixture"), 200, URL, mime))).not.toBeNull();
});
