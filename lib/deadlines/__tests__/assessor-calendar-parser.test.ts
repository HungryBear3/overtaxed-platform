/** @jest-environment node */
import { TOWNSHIPS } from '../../townships'
import { parseInformationalAssessorHtml, ASSESSOR_PARSER_VERSION } from '../assessor-calendar-parser'
import { ASSESSOR_CONTEXT } from '../assessor-calendar-context'

const field = (label: string, key: string, day: string | null) => `
  <div><span class="label-a">${label}</span>${day ? `
    <div class="field--name-field-${key}">
      <time datetime="2026-09-${day}T12:00:00Z">9/${day}/2026</time>
    </div>` : ''}
  </div>`
const card = (name: string, dated = true) => `
  <div class="views-row">
    <div class="row ${dated ? 'On' : 'Off'} title">
      <div class="views-field-title">${name}</div>
      <div class="${dated ? 'open-appeal' : 'appeal-options'}">${dated ? 'Open For Appeals Until 9/24/2026' : ''}</div>
    </div>
    <div class="row copy">
      ${field('Reassessment Notice Date', 'reassessment-notice-date', dated ? '01' : null)}
      ${field('Last File Date', 'last-file-date', dated ? '24' : null)}
      <div class="field--name-field-board-of-review-appeal-dat"><time datetime="2027-01-01">1/1/2027</time></div>
    </div>
  </div>`
const groups = ['South &amp; West Suburban Cook County', 'North Suburbs &amp; City of Chicago']
const section = (index: number, cards: string) => `
  <section class="paragraph--type--township-set">
    <h2 class="field--name-field-title">2026 Assessment Calendar: ${groups[index]}</h2>
    <div class="field--name-field-long-text">${ASSESSOR_CONTEXT[index]}</div>
    <div class="field--name-field-assessment"><div class="paragraph--type--assessment-calendar-set">
      <div class="field--name-field-set">${cards}</div>
    </div></div>
  </section>`
const fixture = () => `<!doctype html><html><head></head><body>
  <main class="region-content"><h1 class="page-title">Assessment &amp; Appeal Calendar</h1>
    ${groups.map((_, index) => section(index, TOWNSHIPS
      .filter(t => (t.district === 'south-west-suburbs') === (index === 0))
      .map(t => card(t.name === 'Lake View' ? 'Lakeview' : t.name, t.slug !== 'orland'))
      .join(''))).join('')}
  </main></body></html>`
const parse = (html = fixture()) => parseInformationalAssessorHtml(html, 2026)

describe('scoped informational Assessor calendar parser', () => {
  it('returns exact canonical38, Lakeview alias and only Assessor windows', () => {
    const rows = parse()
    expect(Object.keys(rows).sort()).toEqual(TOWNSHIPS.map(t => t.slug).sort())
    expect(rows['lake-view']).toEqual({ townshipName: 'Lake View', stages: { assessor: { noticeDate: '2026-09-01', openDate: '2026-09-01', lastFileDate: '2026-09-24' } } })
    expect(rows.orland.stages).toEqual({ assessor: null })
    expect(ASSESSOR_PARSER_VERSION).toBe('ccao-dom/1.0.0')
  })
  it('ignores navigation cards, historical calendars and BOR dates', () => {
    const extra = '<section class="paragraph--type--township-set"><h2 class="field--name-field-title">2025 Assessment Calendar: North Suburbs</h2>' + card('Wrong') + '</section>'
    expect(parse(fixture().replace('</main>', extra + '</main>').replace('<main', card('Wrong') + '<main'))).toEqual(parse())
  })
  it.each([
    ['unknown township', (s: string) => s.replace('>Berwyn<', '>Unknown<')],
    ['duplicate township', (s: string) => s.replace('>Berwyn<', '>Bloom<')],
    ['missing card', (s: string) => s.replace(card('Berwyn'), '')],
    ['extra card', (s: string) => s.replace(card('Berwyn'), card('Berwyn') + card('Bogus'))],
    ['wrong group', (s: string) => s.replace('>Berwyn<', '>SWAP<').replace('>Barrington<', '>Berwyn<').replace('>SWAP<', '>Barrington<')],
    ['duplicate outside copy', (s: string) => s.replace('<div class="row copy">', field('Last File Date', 'last-file-date', '24') + '<div class="row copy">')],
    ['machine mismatch', (s: string) => s.replace('2026-09-24T', '2026-09-25T')],
    ['partial date', (s: string) => s.replace(field('Last File Date', 'last-file-date', '24'), field('Last File Date', 'last-file-date', null))],
    ['wrong year', (s: string) => s.replaceAll('2026-09-', '2025-09-').replaceAll('/2026', '/2025')],
    ['reverse dates', (s: string) => s.replaceAll('09-01', '09-30').replaceAll('9/01/', '9/30/')],
    ['banner disagreement', (s: string) => s.replace('Until 9/24/2026', 'Until 9/25/2026')],
    ['state disagreement', (s: string) => s.replace('row On title', 'row Off title')],
    ['undated closed', (s: string) => s.replace('class="appeal-options"></div>', 'class="appeal-options">Closed For Appeals</div>')],
    ['missing title', (s: string) => s.replace('Assessment &amp; Appeal Calendar', 'Other Calendar')],
    ['absent context', (s: string) => s.replace('When a township', 'Unless a township')],
    ['contradictory context', (s: string) => s.replace('Valuation Reports', 'Notice is not opening. Valuation Reports')],
    ['duplicate section', (s: string) => s.replace('</main>', section(0, '') + '</main>')],
    ['missing section', (s: string) => s.replace('2026 Assessment Calendar: North', '2025 Assessment Calendar: North')],
    ['unknown current section', (s: string) => s.replace('South &amp; West Suburban', 'Other Suburban')],
  ])('refuses %s with bounded error', (_name, mutate) => {
    expect(() => parse(mutate(fixture()))).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
  })
  it('has no fetch side effect', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('unexpected network') })
    try { parse(); expect(fetchSpy).not.toHaveBeenCalled() } finally { fetchSpy.mockRestore() }
  })
  it('accepts consistent dated closed state, rejects invalid target and malformed input', () => {
    expect(parse(fixture().replaceAll('row On title', 'row Off title').replaceAll('class="open-appeal">Open For Appeals Until 9/24/2026', 'class="appeal-options">Closed For Appeals'))).toEqual(parse())
    expect(() => parseInformationalAssessorHtml(fixture(), 2025)).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
    expect(() => parseInformationalAssessorHtml(null as never, 2026)).toThrow('ASSESSOR_CALENDAR_PARSE_ERROR')
  })
})
