// Property Lookup API - Fetch property data from Cook County by PIN
import { NextRequest, NextResponse } from 'next/server'
import { getPropertyByPIN, isValidPIN, formatPIN } from '@/lib/cook-county'
import { rateLimit, getClientIdentifier } from '@/lib/rate-limit'
import { getFullPropertyByPin } from '@/lib/realie'

export async function GET(request: NextRequest) {
  const clientId = getClientIdentifier(request)
  const { allowed } = rateLimit(clientId, 20, 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    )
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const pin = searchParams.get('pin')
    
    if (!pin) {
      return NextResponse.json(
        { error: 'PIN is required' },
        { status: 400 }
      )
    }
    
    if (!isValidPIN(pin)) {
      return NextResponse.json(
        { 
          error: 'Invalid PIN format. Cook County PINs should be 14 digits.',
          example: '16-01-216-001-0000',
        },
        { status: 400 }
      )
    }
    
    const result = await getPropertyByPIN(pin)
    
    if (!result.success || !result.data) {
      return NextResponse.json(
        { 
          error: result.error || 'Property not found',
          pin: formatPIN(pin),
        },
        { status: 404 }
      )
    }
    
    const property = { ...result.data }

    // If Cook County data is missing address, fall back to Realie enrichment
    if (!property.address) {
      try {
        const realie = await getFullPropertyByPin(pin)
        if (realie) {
          // addressFull from Realie may contain "address, city, state zip" — use as address fallback
          if (!property.address && realie.addressFull) property.address = realie.addressFull
          if (!property.bedrooms && realie.bedrooms != null) property.bedrooms = realie.bedrooms
          if (!property.bathrooms && realie.bathrooms != null) property.bathrooms = realie.bathrooms
          if (!property.yearBuilt && realie.yearBuilt != null) property.yearBuilt = realie.yearBuilt
          if (!property.livingArea && realie.livingArea != null) property.livingArea = realie.livingArea
          if (!property.assessedTotalValue && realie.totalAssessedValue != null) property.assessedTotalValue = realie.totalAssessedValue
          if (!property.marketValue && realie.totalMarketValue != null) property.marketValue = realie.totalMarketValue
          if (!property.latitude && realie.latitude != null) property.latitude = realie.latitude
          if (!property.longitude && realie.longitude != null) property.longitude = realie.longitude
        }
      } catch {
        // Realie enrichment is best-effort — don't fail the lookup
      }
    }

    return NextResponse.json({
      success: true,
      property,
      source: result.source,
    })
  } catch (error) {
    console.error('Property lookup error:', error)
    return NextResponse.json(
      { error: 'Failed to lookup property' },
      { status: 500 }
    )
  }
}
