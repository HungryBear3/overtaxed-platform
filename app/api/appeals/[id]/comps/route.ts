// POST /api/appeals/[id]/comps - Add comparable properties to an appeal
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { formatPIN } from "@/lib/cook-county"
import { z } from "zod"

const compSchema = z.object({
  pin: z.string().min(1),
  address: z.string().default(""),
  city: z.string().default(""),
  zipCode: z.string().default(""),
  neighborhood: z.string().optional().nullable(),
  buildingClass: z.string().optional().nullable(),
  livingArea: z.number().optional().nullable(),
  yearBuilt: z.number().optional().nullable(),
  bedrooms: z.number().optional().nullable(),
  bathrooms: z.number().optional().nullable(),
  salePrice: z.number().optional().nullable(),
  saleDate: z.string().datetime().optional().nullable(),
  pricePerSqft: z.number().optional().nullable(),
  compType: z.enum(["SALES", "EQUITY"]).default("SALES"),
})

const bodySchema = z.object({
  comps: z.array(compSchema).min(1).max(20),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: appealId } = await params

    const appeal = await prisma.appeal.findFirst({
      where: { id: appealId, userId: session.user.id },
      include: { property: true },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const created: Array<{
      id: string
      pin: string
      address: string
      compType: string
      salePrice: number | null
      saleDate: string | null
    }> = []

    for (const c of parsed.data.comps) {
      const pin = String(c.pin).replace(/[^0-9]/g, "")
      if (pin.length !== 14) continue

      const comp = await prisma.comparableProperty.create({
        data: {
          propertyId: appeal.propertyId,
          compType: c.compType,
          pin,
          address: c.address || `PIN ${formatPIN(pin)}`,
          city: c.city || "Cook County",
          state: "IL",
          zipCode: c.zipCode || "",
          county: "Cook",
          neighborhood: c.neighborhood ?? null,
          buildingClass: c.buildingClass ?? null,
          livingArea: c.livingArea ?? null,
          yearBuilt: c.yearBuilt ?? null,
          bedrooms: c.bedrooms ?? null,
          bathrooms: c.bathrooms ?? null,
          salePrice: c.salePrice ?? null,
          saleDate: c.saleDate ? new Date(c.saleDate) : null,
          pricePerSqft: c.pricePerSqft ?? null,
          dataSource: "Cook County Open Data",
          appeals: { connect: { id: appealId } },
        },
      })

      created.push({
        id: comp.id,
        pin: formatPIN(comp.pin),
        address: comp.address,
        compType: comp.compType,
        salePrice: comp.salePrice ? Number(comp.salePrice) : null,
        saleDate: comp.saleDate?.toISOString() ?? null,
      })
    }

    return NextResponse.json({
      success: true,
      message: `Added ${created.length} comp(s) to appeal`,
      comps: created,
    })
  } catch (error) {
    console.error("Error adding comps to appeal:", error)
    return NextResponse.json(
      { error: "Failed to add comps to appeal" },
      { status: 500 }
    )
  }
}
