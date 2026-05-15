import { ImageResponse } from "next/og";
import { TOWNSHIP_STATUS_COUNTS } from "@/lib/townships";

export const alt =
  "Cook County property tax appeal deadlines — all 38 townships";
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
            All 38 Cook County townships
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
          <div style={{ display: "flex", gap: 48, marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#1F8A5B" }}>
                {TOWNSHIP_STATUS_COUNTS.open}
              </div>
              <div style={{ display: "flex", fontSize: 24, color: "#5A5048" }}>open now</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#D97757" }}>
                {TOWNSHIP_STATUS_COUNTS["opening-soon"]}
              </div>
              <div style={{ display: "flex", fontSize: 24, color: "#5A5048" }}>opening soon</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#5A5048" }}>
                {TOWNSHIP_STATUS_COUNTS.closed}
              </div>
              <div style={{ display: "flex", fontSize: 24, color: "#5A5048" }}>closed</div>
            </div>
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
          <div style={{ display: "flex" }}>Updated weekly</div>
        </div>
      </div>
    ),
    size,
  );
}
