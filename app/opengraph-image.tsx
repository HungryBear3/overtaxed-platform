import { ImageResponse } from "next/og";

export const alt = "OverTaxed IL — Cook County property tax appeals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (next/og) requires explicit `display: flex` on every <div> that
// has more than one child. Every wrapper here sets it.

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
            Cook County · 2024–2026 cycle
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
            Cook County is probably over-assessing your home.
          </div>
          <div style={{ display: "flex", fontSize: 36, color: "#5A5048", maxWidth: 900 }}>
            Free 30-second check. We file the appeal for $97 — or free if we don&apos;t reduce your bill.
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
          <div style={{ display: "flex" }}>overtaxed-il.com</div>
          <div style={{ display: "flex" }}>Plain math on Cook County public records</div>
        </div>
      </div>
    ),
    size,
  );
}
