// Appeals API - List and create appeals
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatPIN } from '@/lib/cook-county'
import { z } from 'zod'

// Validation schema for creating an appeal
const createAppealSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  taxYear: z.number().int().min(2000).max(2100),
  appealType: z.enum(['ASSESSOR', 'BOARD_REVIEW', 'CERTIFICATE_ERROR']).default('ASSESSOR'),
  originalAssessmentValue: z.number().positive('Assessment value must be positive'),
  requestedAssessmentValue: z.number().positive().optional(),
  noticeDate: z.string().datetime().optional(),
  filingDeadline: z.string().datetime(),
  notes: z.string().optional(),
})

// GET /api/appeals - List user's appeals
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const status = searchParams.get('status')
    const taxYear = searchParams.get('taxYear')

    // Build filter
    const where: Record<string, unknown> = {
      userId: session.user.id,
    }
    
    if (propertyId) {
      where.propertyId = propertyId
    }
    if (status) {
      where.status = status
    }
    if (taxYear) {
      where.taxYear = parseInt(taxYear, 10)
    }

    const appeals = await prisma.appeal.findMany({
      where,
      include: {
        property: {
          select: {
            id: true,
            pin: true,
            address: true,
            city: true,
            county: true,
          },
        },
        documents: {
          select: {
            id: true,
            documentType: true,
            fileName: true,
          },
        },
        _count: {
          select: {
            compsUsed: true,
          },
        },
      },
      orderBy: [
        { taxYear: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    return NextResponse.json({
      success: true,
      appeals: appeals.map((appeal) => ({
        id: appeal.id,
        propertyId: appeal.propertyId,
        property: {
          id: appeal.property.id,
          pin: formatPIN(appeal.property.pin),
          address: appeal.property.address,
          city: appeal.property.city,
          county: appeal.property.county,
        },
        taxYear: appeal.taxYear,
        status: appeal.status,
        appealType: appeal.appealType,
        filingMethod: appeal.filingMethod,
        originalAssessmentValue: Number(appeal.originalAssessmentValue),
        requestedAssessmentValue: appeal.requestedAssessmentValue ? Number(appeal.requestedAssessmentValue) : null,
        finalAssessmentValue: appeal.finalAssessmentValue ? Number(appeal.finalAssessmentValue) : null,
        outcome: appeal.outcome,
        reductionAmount: appeal.reductionAmount ? Number(appeal.reductionAmount) : null,
        reductionPercent: appeal.reductionPercent ? Number(appeal.reductionPercent) : null,
        taxSavings: appeal.taxSavings ? Number(appeal.taxSavings) : null,
        noticeDate: appeal.noticeDate,
        filingDeadline: appeal.filingDeadline,
        filedAt: appeal.filedAt,
        decisionDate: appeal.decisionDate,
        hearingScheduled: appeal.hearingScheduled,
        hearingDate: appeal.hearingDate,
        documentsCount: appeal.documents.length,
        compsCount: appeal._count.compsUsed,
        createdAt: appeal.createdAt,
        updatedAt: appeal.updatedAt,
      })),
    })
  } catch (error) {
    console.error('Error fetching appeals:', error)
    return NextResponse.json(
      { error: 'Failed to fetch appeals' },
      { status: 500 }
    )
  }
}

// POST /api/appeals - Create a new appeal
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validation = createAppealSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = validation.data

    // Verify user owns this property
    const property = await prisma.property.findFirst({
      where: {
        id: data.propertyId,
        userId: session.user.id,
      },
    })

    if (!property) {
      return NextResponse.json(
        { error: 'Property not found or access denied' },
        { status: 404 }
      )
    }

    // Check if appeal already exists for this property/year/type
    const existingAppeal = await prisma.appeal.findFirst({
      where: {
        propertyId: data.propertyId,
        taxYear: data.taxYear,
        appealType: data.appealType,
      },
    })

    if (existingAppeal) {
      return NextResponse.json(
        { 
          error: `An appeal already exists for this property for tax year ${data.taxYear}`,
          existingAppealId: existingAppeal.id,
        },
        { status: 409 }
      )
    }

    // Create the appeal
    const appeal = await prisma.appeal.create({
      data: {
        userId: session.user.id,
        propertyId: data.propertyId,
        taxYear: data.taxYear,
        appealType: data.appealType,
        originalAssessmentValue: data.originalAssessmentValue,
        requestedAssessmentValue: data.requestedAssessmentValue,
        noticeDate: data.noticeDate ? new Date(data.noticeDate) : null,
        filingDeadline: new Date(data.filingDeadline),
        notes: data.notes,
        status: 'DRAFT',
        filingMethod: 'ELECTRONIC',
        // Copy tax info from property for savings calculation
        taxRate: property.taxRate,
        equalizationFactor: property.stateEqualizer,
      },
      include: {
        property: {
          select: {
            pin: true,
            address: true,
            city: true,
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Appeal created successfully',
      appeal: {
        id: appeal.id,
        propertyId: appeal.propertyId,
        property: {
          pin: formatPIN(appeal.property.pin),
          address: appeal.property.address,
          city: appeal.property.city,
        },
        taxYear: appeal.taxYear,
        status: appeal.status,
        appealType: appeal.appealType,
        originalAssessmentValue: Number(appeal.originalAssessmentValue),
        filingDeadline: appeal.filingDeadline,
        createdAt: appeal.createdAt,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating appeal:', error)
    return NextResponse.json(
      { error: 'Failed to create appeal' },
      { status: 500 }
    )
  }
}
