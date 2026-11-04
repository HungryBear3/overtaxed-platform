/** Explicit operator read-only export. Never imports DB when disabled. */
import { freeCheckMeasurementEnabled } from "../lib/analytics/free-check-measurement";
import { exportFreeCheckMeasurement } from "../lib/analytics/free-check-measurement-report";
async function main() {
  const [start, end] = process.argv.slice(2);
  if (
    !start ||
    !end ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end)
  )
    throw new Error("usage: start-date-inclusive end-date-exclusive (UTC)");
  if (!freeCheckMeasurementEnabled()) {
    console.log(
      JSON.stringify({
        schema: "ot.free_check_request_completions.v1",
        status: "disabled",
        groups: null,
      }),
    );
    return;
  }
  const { prisma } = await import("../lib/db/prisma");
  try {
    console.log(
      JSON.stringify(
        await exportFreeCheckMeasurement(
          prisma,
          new Date(start),
          new Date(end),
        ),
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error("free_check_measurement_export_failed");
  process.exitCode = 1;
});
