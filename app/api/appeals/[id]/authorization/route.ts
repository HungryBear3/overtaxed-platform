// POST /api/appeals/[id]/authorization - Create or update filing authorization
// Captures property owner info for Cook County Attorney/Representative form (staff-assisted filing)
// On save: fills official Cook County PDF and uploads to Blob so download returns single document for us + county
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { put, del } from "@vercel/blob"
import { fillOfficialCookCountyAuthForm } from "@/lib/document-generation/fill-official-auth-form"
import { z } from "zod"

const authorizationSchema = z.object({
  ownerName: z.string().min(1, "Name is required").max(200),
  ownerEmail: z.string().email("Valid email is required"),
  ownerPhone: z.string().max(20).optional().nullable(),
  ownerAddress: z.string().min(1, "Mailing address is required").max(300),
  ownerCity: z.string().min(1, "City is required").max(100),
  ownerState: z.string().min(1).max(2).default("IL"),
  ownerZip: z.string().min(1, "ZIP code is required").max(10),
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
      where: {
        id: appealId,
        userId: session.user.id,
      },
      include: {
        property: { select: { pin: true, address: true, city: true, state: true, zipCode: true } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (appeal.status !== "DRAFT" && appeal.status !== "PENDING_FILING") {
      return NextResponse.json(
        { error: "Authorization can only be added for draft or pending-filing appeals" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = authorizationSchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = parsed.data
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined

    const payload = {
      propertyAddress: appeal.property.address,
      propertyCity: appeal.property.city,
      propertyState: appeal.property.state,
      propertyZip: appeal.property.zipCode,
      propertyPin: appeal.property.pin.replace(/\D/g, "") || appeal.property.pin,
      ownerName: data.ownerName.trim(),
      ownerEmail: data.ownerEmail.trim().toLowerCase(),
      ownerPhone: data.ownerPhone?.trim() || null,
      ownerAddress: data.ownerAddress.trim(),
      ownerCity: data.ownerCity.trim(),
      ownerState: (data.ownerState || "IL").toUpperCase().slice(0, 2),
      ownerZip: data.ownerZip.trim(),
      ipAddress,
    }

    const auth = await prisma.filingAuthorization.upsert({
      where: { appealId },
      create: { appealId, ...payload },
      update: payload,
    })

    // Fill official Cook County form and upload when no user-uploaded form exists
    // (avoids overwriting if user manually uploaded their signed form)
    const filledPdf =
      !auth.uploadedPdfUrl &&
      (await fillOfficialCookCountyAuthForm({
      propertyAddress: auth.propertyAddress,
      propertyCity: auth.propertyCity,
      propertyState: auth.propertyState,
      propertyZip: auth.propertyZip,
      propertyPin: auth.propertyPin,
      ownerName: auth.ownerName,
      ownerEmail: auth.ownerEmail,
      ownerPhone: auth.ownerPhone,
      ownerAddress: auth.ownerAddress,
      ownerCity: auth.ownerCity,
      ownerState: auth.ownerState,
      ownerZip: auth.ownerZip,
      signedAt: auth.signedAt,
      taxYear: appeal.taxYear,
    }))

    if (filledPdf) {
      try {
        if (auth.uploadedPdfUrl) {
          try {
            await del(auth.uploadedPdfUrl)
          } catch {
            // Ignore delete errors
          }
        }
        const blob = await put(
          `filing-auth/${appealId}-${Date.now()}.pdf`,
          Buffer.from(filledPdf),
          { access: "public", contentType: "application/pdf" }
        )
        await prisma.filingAuthorization.update({
          where: { appealId },
          data: { uploadedPdfUrl: blob.url },
        })
      } catch (err) {
        console.error("[authorization] Failed to upload filled official form", err)
        // Continue - user can still upload manually; download will return our generated PDF
      }
    }

    return NextResponse.json({
      success: true,
      authorization: {
        id: auth.id,
        signedAt: auth.signedAt,
      },
    })
  } catch (error) {
    console.error("[authorization POST]", error)
    return NextResponse.json({ error: "Failed to save authorization" }, { status: 500 })
  }
}
