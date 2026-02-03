// Single Property API - GET, DELETE for a specific property
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatPIN } from '@/lib/cook-county'
import { isAppealSubmitted } from '@/lib/appeals/status'

// GET /api/properties/[id] - Get a single property with full details
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
    
    const property = await prisma.property.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        assessmentHistory: {
          orderBy: { taxYear: 'desc' },
        },
        appeals: {
          orderBy: { taxYear: 'desc' },
          include: {
            documents: true,
          },
        },
        comps: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })
    
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      )
    }

    // Use latest assessment from history when property row has no current assessment (e.g. after refresh)
    const latestFromHistory = property.assessmentHistory[0]
    const currentAssessmentValue = property.currentAssessmentValue
      ? Number(property.currentAssessmentValue)
      : (latestFromHistory ? Number(latestFromHistory.assessmentValue) : null)
    const currentLandValue = property.currentLandValue
      ? Number(property.currentLandValue)
      : (latestFromHistory?.landValue ? Number(latestFromHistory.landValue) : null)
    const currentImprovementValue = property.currentImprovementValue
      ? Number(property.currentImprovementValue)
      : (latestFromHistory?.improvementValue ? Number(latestFromHistory.improvementValue) : null)
    const currentMarketValue = property.currentMarketValue
      ? Number(property.currentMarketValue)
      : (latestFromHistory?.marketValue ? Number(latestFromHistory.marketValue) : null)
    
    return NextResponse.json({
      success: true,
      property: {
        id: property.id,
        pin: formatPIN(property.pin),
        address: property.address,
        city: property.city,
        state: property.state,
        zipCode: property.zipCode,
        county: property.county,
        neighborhood: property.neighborhood,
        subdivision: property.subdivision,
        block: property.block,
        buildingClass: property.buildingClass,
        cdu: property.cdu,
        livingArea: property.livingArea,
        landSize: property.landSize,
        yearBuilt: property.yearBuilt,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms ? Number(property.bathrooms) : null,
        exteriorWall: property.exteriorWall,
        roofType: property.roofType,
        heatingType: property.heatingType,
        currentAssessmentValue,
        currentLandValue,
        currentImprovementValue,
        currentMarketValue,
        taxCode: property.taxCode,
        taxRate: property.taxRate ? Number(property.taxRate) : null,
        stateEqualizer: property.stateEqualizer ? Number(property.stateEqualizer) : null,
        monitoringEnabled: property.monitoringEnabled,
        lastCheckedAt: property.lastCheckedAt,
        createdAt: property.createdAt,
        updatedAt: property.updatedAt,
        // Assessment history
        assessmentHistory: property.assessmentHistory.map((ah) => ({
          id: ah.id,
          taxYear: ah.taxYear,
          assessmentValue: Number(ah.assessmentValue),
          landValue: ah.landValue ? Number(ah.landValue) : null,
          improvementValue: ah.improvementValue ? Number(ah.improvementValue) : null,
          marketValue: ah.marketValue ? Number(ah.marketValue) : null,
          changeAmount: ah.changeAmount ? Number(ah.changeAmount) : null,
          changePercent: ah.changePercent ? Number(ah.changePercent) : null,
          source: ah.source,
          createdAt: ah.createdAt,
        })),
        // Appeals
        appeals: property.appeals.map((appeal) => ({
          id: appeal.id,
          taxYear: appeal.taxYear,
          status: appeal.status,
          appealType: appeal.appealType,
          originalAssessmentValue: Number(appeal.originalAssessmentValue),
          requestedAssessmentValue: appeal.requestedAssessmentValue ? Number(appeal.requestedAssessmentValue) : null,
          finalAssessmentValue: appeal.finalAssessmentValue ? Number(appeal.finalAssessmentValue) : null,
          outcome: appeal.outcome,
          reductionAmount: appeal.reductionAmount ? Number(appeal.reductionAmount) : null,
          reductionPercent: appeal.reductionPercent ? Number(appeal.reductionPercent) : null,
          taxSavings: appeal.taxSavings ? Number(appeal.taxSavings) : null,
          filedAt: appeal.filedAt,
          decisionDate: appeal.decisionDate,
          createdAt: appeal.createdAt,
        })),
        // Recent comps
        recentComps: property.comps.map((comp) => ({
          id: comp.id,
          pin: formatPIN(comp.pin),
          address: comp.address,
          compType: comp.compType,
          livingArea: comp.livingArea,
          yearBuilt: comp.yearBuilt,
          salePrice: comp.salePrice ? Number(comp.salePrice) : null,
          saleDate: comp.saleDate,
          assessedMarketValue: comp.assessedMarketValue ? Number(comp.assessedMarketValue) : null,
          distanceFromSubject: comp.distanceFromSubject ? Number(comp.distanceFromSubject) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Error fetching property:', error)
    return NextResponse.json(
      { error: 'Failed to fetch property' },
      { status: 500 }
    )
  }
}

// DELETE /api/properties/[id] - Remove a property
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
    
    // Verify ownership and check for submitted appeals
    const property = await prisma.property.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        appeals: { select: { id: true, status: true, taxYear: true } },
      },
    })
    
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      )
    }

    const submittedAppeals = property.appeals.filter((a) => isAppealSubmitted(a.status))
    if (submittedAppeals.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot remove this property — it has submitted appeal(s) that are filed or in progress. The property (PIN) is locked to those appeals. You can only remove properties with no submitted appeals.',
        },
        { status: 400 }
      )
    }
    
    // Delete the property (cascades to related records)
    await prisma.property.delete({
      where: { id },
    })
    
    return NextResponse.json({
      success: true,
      message: 'Property removed successfully',
    })
  } catch (error) {
    console.error('Error deleting property:', error)
    return NextResponse.json(
      { error: 'Failed to delete property' },
      { status: 500 }
    )
  }
}
