// GET /api/appeals/[id]/download-summary - Generate and download appeal summary PDF
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { formatPIN, getAddressByPIN, haversineMiles } from "@/lib/cook-county"
import { getFullPropertyByPin } from "@/lib/realie"
import { enrichCompsWithRealie } from "@/lib/comps/enrich-with-realie"
import { generateAppealSummaryPdf } from "@/lib/document-generation/appeal-summary"

const ADDRESS_CONCURRENCY = 5

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Require payment before generating report: DIY ($69) or Starter+ subscription
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subscriptionTier: true, subscriptionStatus: true },
    })
    const tier = dbUser?.subscriptionTier ?? "COMPS_ONLY"
    const status = dbUser?.subscriptionStatus ?? "INACTIVE"
    const hasPaid = ["STARTER", "GROWTH", "PORTFOLIO", "PERFORMANCE"].includes(tier) || (tier === "COMPS_ONLY" && status === "ACTIVE")
    if (!hasPaid) {
      return NextResponse.json(
        {
          error:
            "Purchase DIY ($69) or subscribe to a plan to download your appeal report. Visit Pricing to get started.",
        },
        { status: 403 }
      )
    }

    const appeal = await prisma.appeal.findFirst({
      where: { id, userId: session.user.id },
      include: {
        property: true,
        compsUsed: { orderBy: { createdAt: "asc" } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (!appeal.property) {
      return NextResponse.json(
        { error: "Property data missing for this appeal" },
        { status: 500 }
      )
    }

    // Validation: requested value required for a complete appeal packet (Task 8.6)
    const requestedNum = appeal.requestedAssessmentValue != null ? Number(appeal.requestedAssessmentValue) : null
    if (requestedNum == null || requestedNum <= 0) {
      return NextResponse.json(
        { error: "Set a requested assessment value on this appeal before downloading the summary." },
        { status: 400 }
      )
    }

    const salesCount = appeal.compsUsed.filter((c) => c.compType === "SALES").length
    const equityCount = appeal.compsUsed.filter((c) => c.compType === "EQUITY").length
    const warnComps =
      salesCount < 3 || equityCount < 5
        ? `Rule 15 recommends at least 3 sales comps and 5 equity comps (you have ${salesCount} sales, ${equityCount} equity).`
        : null

    const safeFormatPIN = (pin: string | null | undefined) => formatPIN(String(pin ?? ""))

    const subjectRealie = await getFullPropertyByPin(appeal.property.pin.replace(/\D/g, "") || appeal.property.pin)
    const { comps, subjectLat, subjectLon, compCoordsList } = await (async () => {
      const list = appeal.compsUsed
      const subjectPin = appeal.property.pin.replace(/\D/g, "") || appeal.property.pin
      const subjectAddr = await getAddressByPIN(subjectPin)
      const subjectLat = subjectAddr?.latitude ?? null
      const subjectLon = subjectAddr?.longitude ?? null
      const compCoordsByPin = new Map<string, { lat: number; lng: number }>()
      for (let i = 0; i < list.length; i += ADDRESS_CONCURRENCY) {
        const batch = list.slice(i, i + ADDRESS_CONCURRENCY)
        const results = await Promise.all(
          batch.map((c) => getAddressByPIN(c.pin.replace(/\D/g, "") || c.pin))
        )
        batch.forEach((c, j) => {
          const addr = results[j]
          if (addr?.latitude != null && addr?.longitude != null) {
            compCoordsByPin.set(c.pin, { lat: addr.latitude, lng: addr.longitude })
          }
        })
      }
      const compCoordsList = list.map((c) => compCoordsByPin.get(c.pin) ?? null)
      const countyList = list.map((c) => {
        const livingArea = c.livingArea ?? null
        const yearBuilt = c.yearBuilt ?? null
        const bedrooms = c.bedrooms ?? null
        const bathrooms = c.bathrooms != null ? Number(c.bathrooms) : null
        const salePrice = c.salePrice ? Number(c.salePrice) : null
        const pricePerSqft =
          c.pricePerSqft != null
            ? Number(c.pricePerSqft)
            : livingArea != null && livingArea > 0 && salePrice != null && salePrice > 0
              ? salePrice / livingArea
              : null
        let distanceFromSubject: number | null =
          c.distanceFromSubject != null ? Number(c.distanceFromSubject) : null
        if (distanceFromSubject == null && subjectLat != null && subjectLon != null) {
          const coords = compCoordsByPin.get(c.pin)
          if (coords) {
            distanceFromSubject = haversineMiles(subjectLat, subjectLon, coords.lat, coords.lng)
          }
        }
        return {
          pin: safeFormatPIN(c.pin),
          pinRaw: c.pin,
          address: c.address ?? "",
          compType: c.compType,
          neighborhood: c.neighborhood ?? null,
          buildingClass: c.buildingClass ?? null,
          bedrooms,
          bathrooms,
          salePrice,
          saleDate: c.saleDate?.toISOString() ?? null,
          livingArea,
          yearBuilt,
          pricePerSqft,
          assessedMarketValue: c.assessedMarketValue ? Number(c.assessedMarketValue) : null,
          assessedMarketValuePerSqft: c.assessedMarketValuePerSqft
            ? Number(c.assessedMarketValuePerSqft)
            : null,
          distanceFromSubject,
        }
      })
      const enriched = await enrichCompsWithRealie(countyList, { maxRealie: Math.min(countyList.length, 15) })
      const comps = enriched.map((e) => ({
        pin: e.pin,
        address: e.address,
        compType: e.compType,
        neighborhood: e.neighborhood,
        buildingClass: e.buildingClass,
        bedrooms: e.bedrooms,
        bathrooms: e.bathrooms,
        salePrice: e.salePrice,
        saleDate: e.saleDate,
        livingArea: e.livingArea,
        yearBuilt: e.yearBuilt,
        pricePerSqft: e.pricePerSqft,
        assessedMarketValue: e.assessedMarketValue,
        assessedMarketValuePerSqft: e.assessedMarketValuePerSqft,
        distanceFromSubject: e.distanceFromSubject,
        inBothSources: e.inBothSources,
        livingAreaRealie: e.livingAreaRealie,
        yearBuiltRealie: e.yearBuiltRealie,
        bedroomsRealie: e.bedroomsRealie,
        bathroomsRealie: e.bathroomsRealie,
      }))
      return { comps, subjectLat, subjectLon, compCoordsList }
    })()

    const subLivingCo = appeal.property.livingArea ?? null
    const subLivingRe = subjectRealie?.livingArea ?? null
    const subYrCo = appeal.property.yearBuilt ?? null
    const subYrRe = subjectRealie?.yearBuilt ?? null
    const subBedCo = appeal.property.bedrooms ?? null
    const subBedRe = subjectRealie?.bedrooms ?? null
    const subBathCo = appeal.property.bathrooms ? Number(appeal.property.bathrooms) : null
    const subBathRe = subjectRealie?.bathrooms ?? null
    const data = {
      property: {
        address: appeal.property.address ?? "",
        city: appeal.property.city ?? "",
        state: appeal.property.state ?? "IL",
        zipCode: appeal.property.zipCode ?? "",
        pin: safeFormatPIN(appeal.property.pin),
        county: appeal.property.county,
        neighborhood: appeal.property.neighborhood ?? subjectRealie?.neighborhood ?? null,
        subdivision: appeal.property.subdivision ?? subjectRealie?.subdivision ?? null,
        block: appeal.property.block,
        buildingClass: appeal.property.buildingClass,
        cdu: appeal.property.cdu,
        livingArea: subLivingCo ?? subLivingRe ?? null,
        landSize: appeal.property.landSize ?? subjectRealie?.landArea ?? null,
        yearBuilt: subYrCo ?? subYrRe ?? null,
        bedrooms: subBedCo ?? subBedRe ?? null,
        bathrooms: subBathCo ?? subBathRe ?? null,
        livingAreaCounty: subLivingCo,
        livingAreaRealie: subLivingRe,
        yearBuiltCounty: subYrCo,
        yearBuiltRealie: subYrRe,
        bedroomsCounty: subBedCo,
        bedroomsRealie: subBedRe,
        bathroomsCounty: subBathCo,
        bathroomsRealie: subBathRe,
        currentAssessmentValue: appeal.property.currentAssessmentValue
          ? Number(appeal.property.currentAssessmentValue)
          : null,
        currentLandValue: appeal.property.currentLandValue
          ? Number(appeal.property.currentLandValue)
          : null,
        currentImprovementValue: appeal.property.currentImprovementValue
          ? Number(appeal.property.currentImprovementValue)
          : null,
        currentMarketValue: appeal.property.currentMarketValue
          ? Number(appeal.property.currentMarketValue)
          : null,
      },
      appeal: {
        taxYear: appeal.taxYear,
        appealType: appeal.appealType,
        status: appeal.status,
        originalAssessmentValue: Number(appeal.originalAssessmentValue),
        requestedAssessmentValue: appeal.requestedAssessmentValue
          ? Number(appeal.requestedAssessmentValue)
          : null,
        filingDeadline: appeal.filingDeadline.toISOString(),
        noticeDate: appeal.noticeDate?.toISOString() ?? null,
      },
      comps,
    }

    // Fetch map and Street View images for PDF when Google Maps API key is set
    const googleKey = process.env.GOOGLE_MAPS_API_KEY
    let mapImagePng: Uint8Array | null = null
    let subjectStreetViewJpeg: Uint8Array | null = null
    const compStreetViewJpegs: (Uint8Array | null)[] = []

    if (googleKey) {
      const points: Array<{ lat: number; lng: number }> = []
      if (subjectLat != null && subjectLon != null) points.push({ lat: subjectLat, lng: subjectLon })
      compCoordsList.forEach((c) => {
        if (c) points.push({ lat: c.lat, lng: c.lng })
      })

      const MAP_WIDTH = 600
      const MAP_HEIGHT = 400
      const WORLD_DIM = 256
      let centerLat = 41.8781
      let centerLng = -87.6298
      let zoom = 14
      if (points.length > 0) {
        const lats = points.map((p) => p.lat)
        const lngs = points.map((p) => p.lng)
        const minLat = Math.min(...lats)
        const maxLat = Math.max(...lats)
        const minLng = Math.min(...lngs)
        const maxLng = Math.max(...lngs)
        centerLat = (minLat + maxLat) / 2
        centerLng = (minLng + maxLng) / 2
        const latSpan = Math.max(maxLat - minLat, 0.002)
        const lngSpan = Math.max(maxLng - minLng, 0.002)
        const zLng = Math.log2((MAP_WIDTH * 360) / (WORLD_DIM * lngSpan))
        const zLat = Math.log2((MAP_HEIGHT * 180) / (WORLD_DIM * latSpan))
        zoom = Math.max(0, Math.min(21, Math.floor(Math.min(zLng, zLat)) - 1))
      }

      const mapParams = new URLSearchParams({
        center: `${centerLat},${centerLng}`,
        zoom: String(zoom),
        size: `${MAP_WIDTH}x${MAP_HEIGHT}`,
        maptype: "roadmap",
        key: googleKey,
      })
      if (subjectLat != null && subjectLon != null) {
        mapParams.append("markers", `color:red|label:S|${subjectLat},${subjectLon}`)
      }
      compCoordsList.forEach((c, i) => {
        if (c) mapParams.append("markers", `color:blue|label:${i + 1}|${c.lat},${c.lng}`)
      })

      const STREETVIEW_SIZE = "280x186" // subject; comps use 120x90
      const MAX_COMP_STREETVIEW = 6

      const [mapRes, subjectSvRes, ...compSvResList] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/staticmap?${mapParams.toString()}`, {
          next: { revalidate: 0 },
        }),
        subjectLat != null && subjectLon != null
          ? fetch(
              `https://maps.googleapis.com/maps/api/streetview?size=${STREETVIEW_SIZE}&location=${subjectLat},${subjectLon}&key=${googleKey}`,
              { next: { revalidate: 0 } }
            )
          : Promise.resolve(null),
        ...compCoordsList.slice(0, MAX_COMP_STREETVIEW).map((c) =>
          c
            ? fetch(
                `https://maps.googleapis.com/maps/api/streetview?size=120x90&location=${c.lat},${c.lng}&key=${googleKey}`,
                { next: { revalidate: 0 } }
              )
            : Promise.resolve(null)
        ),
      ])

      if (mapRes?.ok) {
        const buf = await mapRes.arrayBuffer()
        mapImagePng = new Uint8Array(buf)
      }
      if (subjectSvRes?.ok) {
        const buf = await subjectSvRes.arrayBuffer()
        subjectStreetViewJpeg = new Uint8Array(buf)
      }
      for (let i = 0; i < compSvResList.length; i++) {
        const res = compSvResList[i]
        if (res?.ok) {
          const buf = await res.arrayBuffer()
          compStreetViewJpegs.push(new Uint8Array(buf))
        } else {
          compStreetViewJpegs.push(null)
        }
      }
    }

    const pdfBytes = await generateAppealSummaryPdf({
      ...data,
      mapImagePng: mapImagePng ?? undefined,
      subjectStreetViewJpeg: subjectStreetViewJpeg ?? undefined,
      compStreetViewJpegs: compStreetViewJpegs.length > 0 ? compStreetViewJpegs : undefined,
    })
    const pinRaw = String(appeal.property.pin ?? "").replace(/\D/g, "").slice(-6)
    const filename = `overtaxed-appeal-${appeal.taxYear}-${pinRaw || "summary"}.pdf`
    const buf = typeof Buffer !== "undefined" ? Buffer.from(pdfBytes) : new Uint8Array(pdfBytes)

    // view=1 or disposition=inline: open in browser (avoids some antivirus blocking attachment download)
    const url = new URL(request.url)
    const inline = url.searchParams.get("view") === "1" || url.searchParams.get("disposition") === "inline"
    const disposition = inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Content-Length": String(buf.length),
    }
    if (warnComps) headers["X-Appeal-Warning"] = warnComps

    return new NextResponse(buf, {
      status: 200,
      headers,
    })
  } catch (error) {
    const err = error as Error
    console.error("Error generating appeal summary PDF:", error)
    return NextResponse.json(
      { error: "Failed to generate PDF", details: err?.message ?? String(error) },
      { status: 500 }
    )
  }
}
