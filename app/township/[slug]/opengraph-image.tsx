import { ImageResponse } from "next/og";
import { getTownshipBySlug, getTownshipSlugs } from "@/lib/townships";

export const alt = "Township appeal deadline — OverTaxed IL";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getTownshipSlugs().map((slug) => ({ slug }));
}

export default async function OG({ params }: { params: { slug: string } }) {
  const t = getTownshipBySlug(params.slug);
  const name = t?.name ?? "Cook County";
  const cycleYear = t?.cycleYear ?? 2026;
  const openDate = t?.openDateLong ?? "—";
  const closeDate = t?.closeDateLong ?? "—";
  const status = t?.status ?? "closed";
  const days =
    t?.status === "open"
      ? `${t.daysUntilClose} days left to file`
      : t?.status === "opening-soon"
        ? `Opens ${t.openDateLong}`
        : `Next window: ${cycleYear}`;
  const statusColor =
    status === "open"
      ? "#1F8A5B"
      : status === "opening-soon"
        ? "#D97757"
        : "#5A5048";

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
              color: statusColor,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {status.replace("-", " ")} · {cycleYear} cycle
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
            {openDate} — {closeDate}. {days}.
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
          <div style={{ display: "flex" }}>$97 done-for-you filing</div>
        </div>
      </div>
    ),
    size,
  );
}
