/** @jest-environment node */
import { lookupUnavailableResponse } from '@/lib/properties/lookup-unavailable-response'
import { PROPERTY_LOOKUP_UNAVAILABLE } from '@/lib/cook-county'

describe('property outage response', () => {
  it('returns a safe retryable 503 rather than the internal sentinel', async () => {
    const response = lookupUnavailableResponse({ success: false, error: PROPERTY_LOOKUP_UNAVAILABLE })!
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'retryable'])
    expect(body.code).toBe('PROPERTY_LOOKUP_UNAVAILABLE')
    expect(body.retryable).toBe(true)
    expect(body.error).toContain('Please try again')
    expect(body.error).not.toContain(PROPERTY_LOOKUP_UNAVAILABLE)
  })
  it.each([undefined, 'Property not found', 'Other failure'])('leaves other failures unchanged: %s', error => {
    expect(lookupUnavailableResponse({ success: false, error })).toBeNull()
  })
  it('does not override successful lookups', () => {
    expect(lookupUnavailableResponse({ success: true, error: PROPERTY_LOOKUP_UNAVAILABLE })).toBeNull()
  })
  it('passes through the real success shape (error: null)', () => {
    expect(lookupUnavailableResponse({ success: true, error: null })).toBeNull()
  })
})
