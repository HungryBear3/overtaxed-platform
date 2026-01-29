// Properties API - CRUD operations for user properties
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getPropertyByPIN, isValidPIN, normalizePIN, formatPIN } from '@/lib/cook-county'
import { z } from 'zod'

// Validation schema for adding a property
const addPropertySchema = z.object({
  pin: z.string().min(1, 'PIN is required'),
  // Optional overrides if user wants to provide their own data
  address: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
})

// GET /api/properties - List user's properties
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const properties = await prisma.property.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        assessmentHistory: {
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
        appeals: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })
    
    return NextResponse.json({
      success: true,
      properties: properties.map((p) => ({
        id: p.id,
        pin: formatPIN(p.pin),
        address: p.address,
        city: p.city,
        state: p.state,
        zipCode: p.zipCode,
        county: p.county,
        neighborhood: p.neighborhood,
        buildingClass: p.buildingClass,
        livingArea: p.livingArea,
        yearBuilt: p.yearBuilt,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms ? Number(p.bathrooms) : null,
        currentAssessmentValue: p.currentAssessmentValue ? Number(p.currentAssessmentValue) : null,
        currentMarketValue: p.currentMarketValue ? Number(p.currentMarketValue) : null,
        monitoringEnabled: p.monitoringEnabled,
        lastCheckedAt: p.lastCheckedAt,
        createdAt: p.createdAt,
        // Latest assessment
        latestAssessment: p.assessmentHistory[0] ? {
          taxYear: p.assessmentHistory[0].taxYear,
          assessmentValue: Number(p.assessmentHistory[0].assessmentValue),
          changeAmount: p.assessmentHistory[0].changeAmount ? Number(p.assessmentHistory[0].changeAmount) : null,
          changePercent: p.assessmentHistory[0].changePercent ? Number(p.assessmentHistory[0].changePercent) : null,
        } : null,
        // Latest appeal
        latestAppeal: p.appeals[0] ? {
          id: p.appeals[0].id,
          taxYear: p.appeals[0].taxYear,
          status: p.appeals[0].status,
          outcome: p.appeals[0].outcome,
        } : null,
      })),
    })
  } catch (error) {
    console.error('Error fetching properties:', error)
    return NextResponse.json(
      { error: 'Failed to fetch properties' },
      { status: 500 }
    )
  }
}

// POST /api/properties - Add a new property
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
    const validation = addPropertySchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    
    const { pin } = validation.data
    
    // Validate PIN format
    if (!isValidPIN(pin)) {
      return NextResponse.json(
        { 
          error: 'Invalid PIN format. Cook County PINs should be 14 digits.',
          example: '16-01-216-001-0000',
        },
        { status: 400 }
      )
    }
    
    const normalizedPIN = normalizePIN(pin)

    // Enforce property limit by subscription tier
    const { getPropertyLimit, requiresCustomPricing } = await import('@/lib/billing/limits')
    const limit = getPropertyLimit(session.user.subscriptionTier ?? 'COMPS_ONLY')
    const count = await prisma.property.count({ where: { userId: session.user.id } })
    
    if (requiresCustomPricing(count + 1)) {
      return NextResponse.json(
        {
          error: 'Properties beyond 20 require custom pricing. Please contact us for a quote.',
          limit: 20,
          currentCount: count,
          requiresCustom: true,
        },
        { status: 403 }
      )
    }
    
    if (count >= limit) {
      return NextResponse.json(
        {
          error: `Property limit reached (${limit} for your plan). Upgrade to add more properties.`,
          limit,
          currentCount: count,
        },
        { status: 403 }
      )
    }
    
    // Check if user already has this property
    const existingProperty = await prisma.property.findUnique({
      where: {
        userId_pin: {
          userId: session.user.id,
          pin: normalizedPIN,
        },
      },
    })
    
    if (existingProperty) {
      return NextResponse.json(
        { 
          error: 'Property already exists in your account',
          property: {
            id: existingProperty.id,
            pin: formatPIN(existingProperty.pin),
            address: existingProperty.address,
          },
        },
        { status: 409 }
      )
    }
    
    // Fetch property data from Cook County
    const cookCountyResult = await getPropertyByPIN(normalizedPIN)
    
    if (!cookCountyResult.success || !cookCountyResult.data) {
      return NextResponse.json(
        { 
          error: cookCountyResult.error || 'Property not found in Cook County records',
          pin: formatPIN(normalizedPIN),
        },
        { status: 404 }
      )
    }
    
    const propertyData = cookCountyResult.data
    
    // Create the property
    const property = await prisma.property.create({
      data: {
        userId: session.user.id,
        pin: normalizedPIN,
        address: validation.data.address || propertyData.address,
        city: validation.data.city || propertyData.city,
        state: propertyData.state,
        zipCode: validation.data.zipCode || propertyData.zipCode,
        county: propertyData.county,
        neighborhood: propertyData.neighborhood,
        buildingClass: propertyData.buildingClass,
        cdu: propertyData.cdu,
        livingArea: propertyData.livingArea,
        landSize: propertyData.landSize,
        yearBuilt: propertyData.yearBuilt,
        bedrooms: propertyData.bedrooms,
        bathrooms: propertyData.bathrooms,
        exteriorWall: propertyData.exteriorWall,
        roofType: propertyData.roofType,
        currentAssessmentValue: propertyData.assessedTotalValue,
        currentLandValue: propertyData.assessedLandValue,
        currentImprovementValue: propertyData.assessedBuildingValue,
        currentMarketValue: propertyData.marketValue,
        taxCode: propertyData.taxCode,
        taxRate: propertyData.taxRate,
        stateEqualizer: propertyData.stateEqualizer,
        monitoringEnabled: true,
        lastCheckedAt: new Date(),
      },
    })
    
    // Create assessment history records from Cook County historical data
    if (propertyData.assessmentHistory && propertyData.assessmentHistory.length > 0) {
      // Sort history by year descending to calculate year-over-year changes
      const sortedHistory = [...propertyData.assessmentHistory].sort((a, b) => b.year - a.year)
      
      // Build assessment history records with change calculations
      const historyRecords = sortedHistory.map((record, index) => {
        const previousYear = sortedHistory[index + 1]
        let changeAmount: number | null = null
        let changePercent: number | null = null
        
        if (previousYear && record.assessedTotalValue && previousYear.assessedTotalValue) {
          changeAmount = record.assessedTotalValue - previousYear.assessedTotalValue
          changePercent = (changeAmount / previousYear.assessedTotalValue) * 100
        }
        
        return {
          propertyId: property.id,
          taxYear: record.year,
          assessmentValue: record.assessedTotalValue ?? 0,
          landValue: record.assessedLandValue,
          improvementValue: record.assessedBuildingValue,
          marketValue: record.marketValue,
          changeAmount,
          changePercent,
          source: `Cook County Open Data (${record.stage})`,
        }
      })
      
      // Create all history records
      await prisma.assessmentHistory.createMany({
        data: historyRecords,
        skipDuplicates: true,
      })
    } else if (propertyData.assessedTotalValue) {
      // Fallback: create at least the current assessment if no history
      const currentYear = new Date().getFullYear()
      await prisma.assessmentHistory.create({
        data: {
          propertyId: property.id,
          taxYear: currentYear,
          assessmentValue: propertyData.assessedTotalValue,
          landValue: propertyData.assessedLandValue,
          improvementValue: propertyData.assessedBuildingValue,
          marketValue: propertyData.marketValue,
          source: 'Cook County Open Data',
        },
      })
    }
    
    return NextResponse.json({
      success: true,
      message: 'Property added successfully',
      property: {
        id: property.id,
        pin: formatPIN(property.pin),
        address: property.address,
        city: property.city,
        state: property.state,
        zipCode: property.zipCode,
        county: property.county,
        neighborhood: property.neighborhood,
        buildingClass: property.buildingClass,
        livingArea: property.livingArea,
        yearBuilt: property.yearBuilt,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms ? Number(property.bathrooms) : null,
        currentAssessmentValue: property.currentAssessmentValue ? Number(property.currentAssessmentValue) : null,
        currentMarketValue: property.currentMarketValue ? Number(property.currentMarketValue) : null,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Error adding property:', error)
    return NextResponse.json(
      { error: 'Failed to add property' },
      { status: 500 }
    )
  }
}
