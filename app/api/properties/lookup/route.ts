// Property Lookup API - Fetch property data from Cook County by PIN
import { NextRequest, NextResponse } from 'next/server'
import { getPropertyByPIN, isValidPIN, formatPIN } from '@/lib/cook-county'

export async function GET(request: NextRequest) {
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
    
    return NextResponse.json({
      success: true,
      property: result.data,
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
