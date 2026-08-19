import { ImageResponse } from "next/og";
import { getTownshipBySlug, getTownshipSlugs } from "@/lib/townships";

export const alt = "Township appeal deadline — OverTaxed IL";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getTownshipSlugs().map((slug) => ({ slug }));
}

/**
 * Open Graph card for /township/[slug].
 *
 * This card used to print the window: "April 15, 2026 — May 19, 2026. 7 days
 * left to file." with an OPEN / OPENING SOON banner, for all 38 townships,
 * from `lib/townships.ts` seed dates and a fixed reference date.
 *
 * Three separate reasons that cannot stay, in increasing order of severity.
 * The dates had no source. The countdown was measured from a date pinned in
 * May 2026 regardless of when the card was built. And an OG card is rendered
 * once at build time and then held by every unfurler that has ever seen the
 * link — so "7 days left to file" is not a claim that goes stale in a week, it
 * is a claim that keeps being shown, unchanged, for as long as someone keeps
 * pasting the URL into Slack.
 *
 * The card now carries the township's name and its triennial cycle year, both
 * of which are roster facts that do not move, and points at the page for the
 * window. The page can re-derive the window on every request; a cached PNG
 * cannot.
 */
export default async function OG({ params }: { params: { slug: string } }) {
  const t = getTownshipBySlug(params.slug);
  const name = t?.name ?? "Cook County";
  const cycleYear = t?.cycleYear ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #FBF6EC 0%, #F4ECDB 50%, #ECE0C7 100%)",
          color: "#1E1A16",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", width: 22, height: 22, borderRadius: 11, background: "#D97757" }} />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>OverTaxed</div>
          <div style={{ display: "flex", fontSize: 22, color: "#5A5048" }}>IL</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#5A5048",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {cycleYear ? `${cycleYear} reassessment cycle` : "Cook County"}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 84,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            {name} Township appeals.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 36,
              color: "#5A5048",
              maxWidth: 1000,
              lineHeight: 1.3,
              marginTop: 6,
            }}
          >
            Check the current Assessor filing window and confirm your deadline
            before you file.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: "#5A5048",
          }}
        >
          <div style={{ display: "flex" }}>overtaxed-il.com/township/{params.slug}</div>
          {/* "$97 done-for-you filing" priced a held product on all 38
              township cards — the surface a link preview keeps showing long
              after the page itself changes. */}
          <div style={{ display: "flex" }}>Free check · you file it yourself</div>
        </div>
      </div>
    ),
    size,
  );
}
