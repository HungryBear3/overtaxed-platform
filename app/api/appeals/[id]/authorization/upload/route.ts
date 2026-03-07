// POST /api/appeals/[id]/authorization/upload - Upload signed Cook County official authorization form
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { put, del } from "@vercel/blob"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ["application/pdf"]

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
        filingAuthorization: true,
        property: { select: { address: true, city: true, state: true, zipCode: true, pin: true } },
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

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Upload the signed Cook County Attorney/Representative Authorization form (PDF)." },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10 MB." },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF files are accepted." },
        { status: 400 }
      )
    }

    // Ensure we have a FilingAuthorization record (create with minimal data if not exists)
    let auth = appeal.filingAuthorization
    if (!auth) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, email: true },
      })
      auth = await prisma.filingAuthorization.create({
        data: {
          appealId,
          propertyAddress: appeal.property?.address ?? "",
          propertyCity: appeal.property?.city ?? "",
          propertyState: appeal.property?.state ?? "IL",
          propertyZip: appeal.property?.zipCode ?? "",
          propertyPin: appeal.property?.pin ?? "",
          ownerName: user?.name ?? "",
          ownerEmail: user?.email ?? "",
          ownerAddress: appeal.property?.address ?? "",
          ownerCity: appeal.property?.city ?? "",
          ownerState: appeal.property?.state ?? "IL",
          ownerZip: appeal.property?.zipCode ?? "",
        },
      })
    }

    // Delete previous upload if exists
    if (auth.uploadedPdfUrl) {
      try {
        await del(auth.uploadedPdfUrl)
      } catch {
        // Ignore delete errors
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const blob = await put(
      `filing-auth/${appealId}-${Date.now()}.pdf`,
      buffer,
      { access: "public", contentType: "application/pdf" }
    )

    await prisma.filingAuthorization.update({
      where: { appealId },
      data: { uploadedPdfUrl: blob.url },
    })

    return NextResponse.json({
      success: true,
      uploadedPdfUrl: blob.url,
    })
  } catch (error) {
    console.error("[authorization/upload]", error)
    return NextResponse.json(
      { error: "Failed to upload authorization form" },
      { status: 500 }
    )
  }
}
