import { NextResponse } from 'next/server'
import { PROPERTY_LOOKUP_UNAVAILABLE } from '@/lib/cook-county'

export function lookupUnavailableResponse(result: { success: boolean; error?: string | null }) {
  if (result.success || result.error !== PROPERTY_LOOKUP_UNAVAILABLE) return null
  return NextResponse.json({
    error: 'We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.',
    code: 'PROPERTY_LOOKUP_UNAVAILABLE',
    retryable: true,
  }, { status: 503 })
}
