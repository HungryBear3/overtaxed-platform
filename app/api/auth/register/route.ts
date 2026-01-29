import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  relationshipAttestation: z.enum(["OWNER", "AUTHORIZED"]).optional(),
  agreeToTerms: z.literal(true, { message: "You must agree to the Terms of Service" }),
})

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      )
    }

    // Validate input
    const validatedData = registerSchema.parse(body)
    const { email, password, name, relationshipAttestation } = validatedData
    const { CURRENT_TERMS_VERSION } = await import("@/lib/legal/terms")

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase()

    // Lazy import Prisma
    const { prisma } = await import("@/lib/db")

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        name: name?.trim() || null,
        relationshipAttestation: relationshipAttestation || "OWNER",
        subscriptionTier: "COMPS_ONLY",
        subscriptionStatus: "INACTIVE",
        termsAcceptances: {
          create: {
            version: CURRENT_TERMS_VERSION,
            termsOfServiceAccepted: true,
            userAgreementAccepted: true,
            relationshipAttestation: true,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        subscriptionTier: true,
        createdAt: true,
      }
    })

    return NextResponse.json(
      { 
        message: "Account created successfully!",
        user 
      },
      { status: 201 }
    )
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError && error.issues?.length > 0) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    // Handle Prisma unique constraint violation
    if (error instanceof Error && error.message.includes("P2002")) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      )
    }

    console.error("Registration error:", error)
    
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
