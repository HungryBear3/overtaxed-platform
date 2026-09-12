import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
export function refuse(): never {
  throw new Error('ASSESSOR_CALENDAR_PARSE_ERROR')
}
export function one<T>(values: T[]): T {
  if (values.length !== 1) refuse()
  return values[0]
}
export function attr(node: Node, name: string): string | undefined {
  return 'attrs' in node ? node.attrs.find(attribute => attribute.name === name)?.value : undefined
}
export function hasClass(node: Node, name: string): boolean {
  return (attr(node, 'class') ?? '').split(/\s+/).includes(name)
}
export function descendants(node: Node, predicate: (child: Node) => boolean): Node[] {
  const found: Node[] = []
  const pending = 'childNodes' in node ? [...node.childNodes].reverse() : []
  while (pending.length) {
    const child = pending.pop()!
    if (predicate(child)) found.push(child)
    if ('childNodes' in child) pending.push(...[...child.childNodes].reverse())
  }
  return found
}
export const byClass = (node: Node, name: string): Node[] => descendants(node, child => hasClass(child, name))
export function text(node: Node): string {
  const parts: string[] = []
  const pending = [node]
  while (pending.length) {
    const child = pending.pop()!
    if (['script', 'style', 'template'].includes(child.nodeName)) continue
    if ('value' in child) parts.push(child.value)
    if ('childNodes' in child) pending.push(...[...child.childNodes].reverse())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
export function parseDocument(html: string): Node {
  if (typeof html !== 'string' || html.length > 2_000_000) refuse()
  let invalid = false
  const document = parse(html, { onParseError: () => { invalid = true } })
  if (invalid) refuse()
  return document
}
export function printedDate(value: string, year: number): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (!match || Number(match[3]) !== year) refuse()
  const iso = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  const instant = new Date(`${iso}T00:00:00Z`)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== iso) refuse()
  return iso
}
export function labeledDate(card: Node, label: string, fieldClass: string, year: number): string | null {
  const labelNode = one(byClass(card, 'label-a').filter(node => text(node) === label))
  const column = 'parentNode' in labelNode ? labelNode.parentNode : null
  if (!column) refuse()
  const fields = byClass(card, fieldClass)
  const times = descendants(column, node => node.nodeName === 'time')
  if (!fields.length && !times.length && text(column) === label) return null
  const field = one(fields)
  const time = one(times)
  if (!descendants(column, node => node === field).length || one(descendants(field, node => node.nodeName === 'time')) !== time) refuse()
  const printed = text(time)
  const iso = printedDate(printed, year)
  const machine = attr(time, 'datetime') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(machine)) refuse()
  const instant = new Date(machine)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== machine.replace('Z', '.000Z')) refuse()
  if (machine.slice(0, 10) !== iso || text(column) !== `${label} ${printed}` || text(field) !== printed) refuse()
  return iso
}
