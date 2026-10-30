/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HomePage from '@/components/ot-design/HomePage'
import { CC_02 } from '@/lib/copy/canonical'
import { canonicalFreeCheckOutcome } from '@/lib/free-check-outcome-contract'
import { createFactualLocalRuntime, SYNTHETIC_ADDRESS, SYNTHETIC_SECOND_ADDRESS } from '@/test-support/factual-local-fixture'

/**
 * The homepage is factual-only: the free route answers with a saved-analysis
 * lookup receipt or an error, and the shared bound renderer is the only thing
 * that may show a result. A legacy normalized body or any other unknown 200 is
 * refused on both entry points (hero card and sticky bar) — no legacy result
 * card, no result-bound DIY offer or reminder signup, and no completion of any
 * kind is recorded for it.
 */

// The pre-receipt wire shape, with a supportive outcome that would once have
// unlocked the result-bound offer.
function legacyBody() {
  return {
    success: true,
    subject: {
      pin: '18-06-214-011-0000',
      address: '100 Synthetic Preview Ave',
      city: 'Cicero',
      zipCode: '60804',
      township: 'Cicero',
      neighborhoodCode: '78-120',
      taxYear: 2025,
      assessedTotalValue: 42500,
      marketValue: 425000,
    },
    compCount: 3,
    comps: [],
    avgComparableAssessedValue: 35100,
    equityRatio: 10,
    targetEquityRatio: 10,
    avgCompEquityRatio: 8.3,
    assessmentGap: 7400,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: null,
    appealWindowStatus: { township: 'Cicero', status: 'open', openDate: '2026-09-01', closeDate: '2026-10-01', filingUrl: 'https://example.gov', note: null },
    propertyCharacteristics: null,
    source: 'cook-county',
    disclosure: CC_02,
    outcome: canonicalFreeCheckOutcome('supportive', null),
  }
}

let gtag: jest.Mock
const countOf = (name: string) => gtag.mock.calls.filter((c) => c[0] === 'event' && c[1] === name).length
const paramsOf = (name: string) => (gtag.mock.calls.find((c) => c[0] === 'event' && c[1] === name)?.[2] ?? {}) as Record<string, unknown>

/**
 * Real route handler for every POST/GET. Each queued POST entry either names a
 * canned non-receipt response or is null for "use the real route".
 */
function setup(postQueue: Array<(() => Response) | null> = []) {
  const rt = createFactualLocalRuntime()
  const fetchMock = jest.fn(async (url: any, init?: RequestInit) => {
    const req = new Request(new URL(String(url), 'http://local'), init)
    if (init?.method === 'POST') {
      const canned = postQueue.shift()
      return canned ? canned() : rt.route.POST(req)
    }
    return rt.route.GET(req)
  })
  global.fetch = fetchMock as any
  render(<HomePage />)
  return { fetchMock }
}

const json200 = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 })

function submitHero(address = SYNTHETIC_ADDRESS) {
  const input = screen.getAllByPlaceholderText('123 S Sample Ave, La Grange IL')[1]
  fireEvent.change(input, { target: { value: address } })
  fireEvent.submit(input.closest('form')!)
}
function submitSticky(address = SYNTHETIC_ADDRESS) {
  const input = screen.getAllByPlaceholderText('123 S Sample Ave, La Grange IL')[0]
  fireEvent.change(input, { target: { value: address } })
  fireEvent.submit(input.closest('form')!)
}

/** Nothing legacy, nothing result-bound, nothing completed. */
async function refusedSafely() {
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
  expect(screen.queryByTestId('factual-summary')).toBeNull()
  expect(document.querySelector('.ot-check-result')).toBeNull()
  // The retired legacy result card's eyebrow ("Your free check · <address>")...
  expect(document.querySelector('.ot-result-eyebrow')).toBeNull()
  // ...while the static sample-report marketing card stays on the page.
  expect(document.querySelector('.ot-sample-eyebrow')?.textContent).toBe('Your free check · sample')
  expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull()
  expect(screen.queryByText(/Send my reminders/)).toBeNull()
  expect(document.querySelector('form.ot-result-followup')).toBeNull()
  expect(document.querySelector('a[href="/checkout?plan=diy"]')).toBeNull()
  expect(countOf('free_check_completed')).toBe(0)
  expect(countOf('free_check_qualified')).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
}

beforeEach(() => {
  window.scrollTo = jest.fn()
  window.sessionStorage.clear()
  gtag = jest.fn()
  window.gtag = gtag
})
afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

describe('homepage free check is factual-only', () => {
  it('renders a valid saved-analysis receipt through the shared renderer and records one factual completion', async () => {
    setup(); submitHero()
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.getAttribute('data-result-id')).toMatch(/^res_[a-z0-9]{24}$/)
    expect(summary.textContent).toContain('Cicero')
    expect(screen.getByTestId('factual-report-action')).toBeTruthy()
    await waitFor(() => expect(countOf('free_check_completed')).toBe(1))
    expect(paramsOf('free_check_completed')).toMatchObject({ surface: 'home_hero', result_kind: 'FACTUAL_ONLY', qualified: false, allow_checkout: false })
    expect(countOf('free_check_qualified')).toBe(0)
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull()
    expect(screen.queryByText(/Send my reminders/)).toBeNull()
  })

  it('refuses a legacy normalized body on the hero card', async () => {
    setup([json200(legacyBody())]); submitHero()
    await refusedSafely()
  })

  it('refuses an unknown 200 body on the hero card', async () => {
    setup([json200({})]); submitHero()
    await refusedSafely()
  })

  it('refuses a legacy normalized body from the sticky bar', async () => {
    setup([json200(legacyBody())]); submitSticky()
    await refusedSafely()
  })

  it('refuses an unknown 200 body from the sticky bar', async () => {
    setup([json200({ ok: true, result: { anything: 'else' } })]); submitSticky()
    await refusedSafely()
  })

  it('refuses a legacy result dispatched on the page event without a producer token', async () => {
    setup()
    act(() => { window.dispatchEvent(new CustomEvent('ot:free-check-result', { detail: { result: legacyBody(), preview: false, submittedInput: SYNTHETIC_ADDRESS } })) })
    await refusedSafely()
  })

  it('clears an earlier factual summary when the next response is a legacy body', async () => {
    // First POST: the real receipt. Second POST: a legacy body.
    setup([null, json200(legacyBody())])
    submitHero()
    await screen.findByTestId('factual-summary')
    await waitFor(() => expect(countOf('free_check_completed')).toBe(1))
    fireEvent.click(screen.getByText('Check another property'))
    submitHero(SYNTHETIC_SECOND_ADDRESS)
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('factual-summary')).toBeNull()
    expect(document.querySelector('.ot-check-result')).toBeNull()
    expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull()
    expect(screen.queryByText(/Send my reminders/)).toBeNull()
    expect(countOf('free_check_completed')).toBe(1)
    expect(countOf('free_check_qualified')).toBe(0)
  })
})
