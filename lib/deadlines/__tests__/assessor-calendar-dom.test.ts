/** @jest-environment node */
import { parseDocument, byClass, one, text, printedDate, labeledDate } from '../assessor-calendar-dom'

const document = (body: string) => parseDocument(`<!doctype html><html><head></head><body>${body}</body></html>`)
const column = (value: string) => one(byClass(document(`<div class="card"><div><span class="label-a">Last File Date</span>${value}</div></div>`), 'card'))
const field = (printed = '9/24/2026', machine = '2026-09-24T12:00:00Z') => `<div class="field-last"><time datetime="${machine}">${printed}</time></div>`
const read = (value: string) => labeledDate(column(value), 'Last File Date', 'field-last', 2026)

describe('strict offline Assessor DOM/date primitives', () => {
  it('parses entities and class tokens, not substring classes or inert text', () => {
    const doc = document('<div class="card">Lake &amp; View<script>wrong</script></div><div class="card-extra">decoy</div>')
    expect(text(one(byClass(doc, 'card')))).toBe('Lake & View')
  })
  it('returns a paired printed/machine civil date, and genuinely absent null', () => {
    expect(read(field())).toBe('2026-09-24')
    expect(read('')).toBeNull()
  })
  it.each(['2/30/2026', '9/24/2025', '2026-09-24', '9/24/26', '9/24/2026 extra'])('refuses invalid printed date %s', value => {
    expect(() => printedDate(value, 2026)).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
  })
  it.each([
    field('9/24/2026', '2026-09-25T12:00:00Z'),
    field('9/24/2026', '2026-09-24T99:00:00Z'),
    field('9/24/2026', '2026-09-24T12:00:00-05:00'),
    field() + field(), field() + '9/25/2026', '<div class="field-last"></div>',
    '<time datetime="2026-09-24T12:00:00Z">9/24/2026</time>', '9/24/2026',
    '<span class="label-a">Last File Date</span>',
  ])('refuses partial, duplicated or conflicting column %s', value => {
    expect(() => read(value)).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
  })
  it('refuses malformed HTML, excessive size and ambiguous selection', () => {
    expect(() => document('<div class="a" class="b"></div>')).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
    expect(() => parseDocument('x'.repeat(2_000_001))).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
    expect(() => one([])).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
    expect(() => one([1, 2])).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
  })
})
