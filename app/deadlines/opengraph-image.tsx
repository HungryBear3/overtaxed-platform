import { ImageResponse } from "next/og";
import { TOWNSHIPS } from "@/lib/townships";

/**
 * Open Graph card for /deadlines.
 *
 * This image used to print three live-looking numbers — N open now, N opening
 * soon, N closed — from `TOWNSHIP_STATUS_COUNTS`, a tally computed against a
 * hard-coded reference date, over a footer that read "Updated weekly".
 *
 * An OG card is the worst possible place for a count like that. It is rendered
 * once at build time and then cached by Facebook, Slack, LinkedIn, and every
 * other unfurler that touches the link, for as long as each of them feels like
 * keeping it. There is no revalidation path and no way to recall it. Even a
 * count derived correctly from the canonical state would be a claim frozen at
 * deploy and re-served for months.
 *
 * So the card carries only what does not expire: how many townships there are,
 * and what the page is. The live counts live on the page itself, where they can
 * be re-derived on every request and suppressed when nothing is verified.
 */

export const alt =
  "Cook County property tax appeal deadlines — township calendar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
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
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "#5A5048",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            All {TOWNSHIPS.length} Cook County townships
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: -1,
              maxWidth: 900,
            }}
          >
            Property tax appeal deadlines.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#5A5048", marginTop: 8 }}>
            Check the current filing window for your township.
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
          <div style={{ display: "flex" }}>overtaxed-il.com/deadlines</div>
        </div>
      </div>
    ),
    size,
  );
}
