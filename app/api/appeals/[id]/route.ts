// Single Appeal API - GET, PATCH, DELETE
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatPIN } from '@/lib/cook-county'
import { canChangePropertyOnAppeal } from '@/lib/appeals/status'
import { z } from 'zod'

// Validation schema for updating an appeal
const updateAppealSchema = z.object({
  propertyId: z.string().min(1).optional(),
  status: z.enum([
    'DRAFT', 'PENDING_FILING', 'FILED', 'UNDER_REVIEW',
    'HEARING_SCHEDULED', 'DECISION_PENDING', 'APPROVED',
    'PARTIALLY_APPROVED', 'DENIED', 'WITHDRAWN'
  ]).optional(),
  requestedAssessmentValue: z.number().positive().optional(),
  finalAssessmentValue: z.number().positive().optional(),
  outcome: z.enum(['WON', 'PARTIALLY_WON', 'DENIED', 'WITHDRAWN']).optional(),
  reductionAmount: z.number().optional(),
  reductionPercent: z.number().optional(),
  taxSavings: z.number().optional(),
  noticeDate: z.string().datetime().optional().nullable(),
  filingDeadline: z.string().datetime().optional(),
  filedAt: z.string().datetime().optional().nullable(),
  decisionDate: z.string().datetime().optional().nullable(),
  hearingScheduled: z.boolean().optional(),
  hearingDate: z.string().datetime().optional().nullable(),
  hearingLocation: z.string().optional().nullable(),
  evidenceSummary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// GET /api/appeals/[id] - Get single appeal with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const isAdmin = (session.user as { role?: string }).role === 'ADMIN'

    const appeal = await prisma.appeal.findFirst({
      where: {
        id,
        ...(isAdmin ? {} : { userId: session.user.id }),
      },
      include: {
        property: {
          select: {
            id: true,
            pin: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            county: true,
            neighborhood: true,
            buildingClass: true,
            livingArea: true,
            yearBuilt: true,
            currentAssessmentValue: true,
            currentMarketValue: true,
            taxCode: true,
            taxRate: true,
            stateEqualizer: true,
            assessmentHistory: {
              orderBy: { taxYear: 'desc' },
              take: 15,
              select: {
                taxYear: true,
                assessmentValue: true,
                changeAmount: true,
                changePercent: true,
              },
            },
          },
        },
        documents: {
          orderBy: { createdAt: 'desc' },
        },
        compsUsed: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        relatedAppeals: {
          select: {
            id: true,
            taxYear: true,
            status: true,
            outcome: true,
            reductionAmount: true,
            taxSavings: true,
          },
        },
      },
    })

    if (!appeal) {
      return NextResponse.json(
        { error: 'Appeal not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      appeal: {
        id: appeal.id,
        propertyId: appeal.propertyId,
        property: {
          id: appeal.property.id,
          pin: formatPIN(appeal.property.pin),
          address: appeal.property.address,
          city: appeal.property.city,
          state: appeal.property.state,
          zipCode: appeal.property.zipCode,
          county: appeal.property.county,
          neighborhood: appeal.property.neighborhood,
          buildingClass: appeal.property.buildingClass,
          livingArea: appeal.property.livingArea,
          yearBuilt: appeal.property.yearBuilt,
          currentAssessmentValue: appeal.property.currentAssessmentValue ? Number(appeal.property.currentAssessmentValue) : null,
          currentMarketValue: appeal.property.currentMarketValue ? Number(appeal.property.currentMarketValue) : null,
          taxCode: appeal.property.taxCode,
          taxRate: appeal.property.taxRate ? Number(appeal.property.taxRate) : null,
          stateEqualizer: appeal.property.stateEqualizer ? Number(appeal.property.stateEqualizer) : null,
          assessmentHistory: appeal.property.assessmentHistory.map((ah) => ({
            taxYear: ah.taxYear,
            assessmentValue: Number(ah.assessmentValue),
            changeAmount: ah.changeAmount != null ? Number(ah.changeAmount) : null,
            changePercent: ah.changePercent != null ? Number(ah.changePercent) : null,
          })),
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
        taxRate: appeal.taxRate ? Number(appeal.taxRate) : null,
        equalizationFactor: appeal.equalizationFactor ? Number(appeal.equalizationFactor) : null,
        noticeDate: appeal.noticeDate,
        filingDeadline: appeal.filingDeadline,
        filedAt: appeal.filedAt,
        decisionDate: appeal.decisionDate,
        hearingScheduled: appeal.hearingScheduled,
        hearingDate: appeal.hearingDate,
        hearingLocation: appeal.hearingLocation,
        evidenceSummary: appeal.evidenceSummary,
        notes: appeal.notes,
        documents: appeal.documents.map((doc) => ({
          id: doc.id,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          isPhoto: doc.isPhoto,
          photoDate: doc.photoDate,
          createdAt: doc.createdAt,
        })),
        compsUsed: appeal.compsUsed.map((comp) => ({
          id: comp.id,
          pin: formatPIN(comp.pin),
          address: comp.address,
          compType: comp.compType,
          livingArea: comp.livingArea,
          yearBuilt: comp.yearBuilt,
          salePrice: comp.salePrice ? Number(comp.salePrice) : null,
          saleDate: comp.saleDate,
          assessedMarketValue: comp.assessedMarketValue ? Number(comp.assessedMarketValue) : null,
        })),
        relatedAppeals: appeal.relatedAppeals.map((ra) => ({
          id: ra.id,
          taxYear: ra.taxYear,
          status: ra.status,
          outcome: ra.outcome,
          reductionAmount: ra.reductionAmount ? Number(ra.reductionAmount) : null,
          taxSavings: ra.taxSavings ? Number(ra.taxSavings) : null,
        })),
        createdAt: appeal.createdAt,
        updatedAt: appeal.updatedAt,
      },
    })
  } catch (error) {
    console.error('Error fetching appeal:', error)
    return NextResponse.json(
      { error: 'Failed to fetch appeal' },
      { status: 500 }
    )
  }
}

// PATCH /api/appeals/[id] - Update an appeal
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const validation = updateAppealSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const isAdmin = (session.user as { role?: string }).role === 'ADMIN'
    const existingAppeal = await prisma.appeal.findFirst({
      where: {
        id,
        ...(isAdmin ? {} : { userId: session.user.id }),
      },
    })

    if (!existingAppeal) {
      return NextResponse.json(
        { error: 'Appeal not found' },
        { status: 404 }
      )
    }

    const data = validation.data

    // propertyId change: only allowed for non-submitted appeals
    if (data.propertyId !== undefined) {
      if (!canChangePropertyOnAppeal(existingAppeal.status)) {
        return NextResponse.json(
          {
            error:
              'Cannot change the property on a submitted appeal. Once filed, the appeal is locked to that PIN. Only draft or pending-filing appeals can be reassigned to a different property.',
          },
          { status: 400 }
        )
      }
      if (data.propertyId !== existingAppeal.propertyId) {
        // Verify new property belongs to user
        const newProperty = await prisma.property.findFirst({
          where: {
            id: data.propertyId,
            userId: session.user!.id,
          },
        })
        if (!newProperty) {
          return NextResponse.json(
            { error: 'Property not found or does not belong to you.' },
            { status: 400 }
          )
        }
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {}
    
    if (data.propertyId !== undefined) updateData.propertyId = data.propertyId
    if (data.status !== undefined) updateData.status = data.status
    if (data.requestedAssessmentValue !== undefined) updateData.requestedAssessmentValue = data.requestedAssessmentValue
    if (data.finalAssessmentValue !== undefined) updateData.finalAssessmentValue = data.finalAssessmentValue
    if (data.outcome !== undefined) updateData.outcome = data.outcome
    if (data.reductionAmount !== undefined) updateData.reductionAmount = data.reductionAmount
    if (data.reductionPercent !== undefined) updateData.reductionPercent = data.reductionPercent
    if (data.taxSavings !== undefined) updateData.taxSavings = data.taxSavings
    if (data.noticeDate !== undefined) updateData.noticeDate = data.noticeDate ? new Date(data.noticeDate) : null
    if (data.filingDeadline !== undefined) updateData.filingDeadline = new Date(data.filingDeadline)
    if (data.filedAt !== undefined) updateData.filedAt = data.filedAt ? new Date(data.filedAt) : null
    if (data.decisionDate !== undefined) updateData.decisionDate = data.decisionDate ? new Date(data.decisionDate) : null
    if (data.hearingScheduled !== undefined) updateData.hearingScheduled = data.hearingScheduled
    if (data.hearingDate !== undefined) updateData.hearingDate = data.hearingDate ? new Date(data.hearingDate) : null
    if (data.hearingLocation !== undefined) updateData.hearingLocation = data.hearingLocation
    if (data.evidenceSummary !== undefined) updateData.evidenceSummary = data.evidenceSummary
    if (data.notes !== undefined) updateData.notes = data.notes

    const appeal = await prisma.appeal.update({
      where: { id },
      data: updateData,
      include: {
        property: {
          select: {
            pin: true,
            address: true,
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Appeal updated successfully',
      appeal: {
        id: appeal.id,
        status: appeal.status,
        outcome: appeal.outcome,
        updatedAt: appeal.updatedAt,
      },
    })
  } catch (error) {
    console.error('Error updating appeal:', error)
    return NextResponse.json(
      { error: 'Failed to update appeal' },
      { status: 500 }
    )
  }
}

// DELETE /api/appeals/[id] - Delete an appeal
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // Verify ownership
    const appeal = await prisma.appeal.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!appeal) {
      return NextResponse.json(
        { error: 'Appeal not found' },
        { status: 404 }
      )
    }

    // Only allow deletion of DRAFT appeals
    if (appeal.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only draft appeals can be deleted. Withdraw the appeal instead.' },
        { status: 400 }
      )
    }

    await prisma.appeal.delete({
      where: { id },
    })

    return NextResponse.json({
      success: true,
      message: 'Appeal deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting appeal:', error)
    return NextResponse.json(
      { error: 'Failed to delete appeal' },
      { status: 500 }
    )
  }
}
