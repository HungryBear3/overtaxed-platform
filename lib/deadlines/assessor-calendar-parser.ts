import type { TownshipSnapshotRow } from './official-source-state'
import { TOWNSHIPS } from '../townships'
import { ASSESSOR_CONTEXT } from './assessor-calendar-context'
import { parseDocument, byClass, one, text, hasClass, labeledDate, printedDate, refuse } from './assessor-calendar-dom'

export const ASSESSOR_PARSER_VERSION = 'ccao-dom/1.0.0'
const SECTION_NAMES = ['South & West Suburban Cook County', 'North Suburbs & City of Chicago']

/** Pure row extraction only. No source receipt, freshness, BOR or commerce eligibility. */
export function parseInformationalAssessorHtml(html: string, targetYear: number): Record<string, TownshipSnapshotRow> {
  try {
    if (!Number.isInteger(targetYear) || targetYear < 1000 || targetYear > 9999) refuse()
    const root = one(byClass(parseDocument(html), 'region-content'))
    if (text(one(byClass(root, 'page-title'))) !== 'Assessment & Appeal Calendar') refuse()
    const titles = SECTION_NAMES.map(name => `${targetYear} Assessment Calendar: ${name}`)
    const sections = byClass(root, 'paragraph--type--township-set').filter(section => {
      const title = text(one(byClass(section, 'field--name-field-title')))
      return title.startsWith(String(targetYear))
    })
    if (sections.length !== 2) refuse()
    const rows: Record<string, TownshipSnapshotRow> = {}
    for (let index = 0; index < titles.length; index++) {
      const section = one(sections.filter(node => text(one(byClass(node, 'field--name-field-title'))) === titles[index]))
      // Exact explanatory framing prevents interpreting notice as opening after context changes.
      const context = text(one(byClass(section, 'field--name-field-long-text')))
      if (context !== ASSESSOR_CONTEXT[index].replace(/2026/g, String(targetYear))) refuse()
      const assessment = one(byClass(section, 'field--name-field-assessment'))
      const calendar = one(byClass(assessment, 'paragraph--type--assessment-calendar-set'))
      const set = one(byClass(calendar, 'field--name-field-set'))
      if (one(byClass(section, 'field--name-field-set')) !== set) refuse()
      const cards = byClass(set, 'views-row')
      if (byClass(section, 'views-row').length !== cards.length) refuse()
      const expected = TOWNSHIPS.filter(t => (t.district === 'south-west-suburbs') === (index === 0))
      if (cards.length !== expected.length) refuse()
      for (const card of cards) {
        const title = one(byClass(card, 'title'))
        const name = text(one(byClass(title, 'views-field-title')))
        const township = expected.find(t => t.name === (name === 'Lakeview' ? 'Lake View' : name))
        if (!township || rows[township.slug]) refuse()
        const copy = one(byClass(card, 'copy'))
        for (const key of ['label-a', 'field--name-field-reassessment-notice-date', 'field--name-field-last-file-date']) {
          if (byClass(card, key).length !== byClass(copy, key).length) refuse()
        }
        if (byClass(card, 'views-field-title').length !== 1) refuse()
        const notice = labeledDate(copy, 'Reassessment Notice Date', 'field--name-field-reassessment-notice-date', targetYear)
        const last = labeledDate(copy, 'Last File Date', 'field--name-field-last-file-date', targetYear)
        if ((notice === null) !== (last === null) || (notice && last && notice > last)) refuse()
        const banner = one([...byClass(title, 'open-appeal'), ...byClass(title, 'appeal-options')])
        if (byClass(card, 'open-appeal').length + byClass(card, 'appeal-options').length !== 1) refuse()
        const open = hasClass(title, 'On')
        if (open === hasClass(title, 'Off')) refuse()
        if (open) {
          const match = /^Open For Appeals Until (\d{1,2}\/\d{1,2}\/\d{4})$/.exec(text(banner))
          if (!hasClass(banner, 'open-appeal') || !match || !last || printedDate(match[1], targetYear) !== last) refuse()
        } else if (!hasClass(banner, 'appeal-options') || text(banner) !== (last ? 'Closed For Appeals' : '')) refuse()
        rows[township.slug] = { townshipName: township.name, stages: {
          assessor: notice && last ? { noticeDate: notice, openDate: notice, lastFileDate: last } : null,
        } }
      }
    }
    if (Object.keys(rows).length !== TOWNSHIPS.length) refuse()
    return Object.fromEntries(TOWNSHIPS.map(t => [t.slug, rows[t.slug]]))
  } catch {
    // Neither malformed input nor a library error can leak raw provider content.
    return refuse()
  }
}
