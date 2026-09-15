type Outcome<T = never> = { outcome: "CONFIRMED"; value: T } | { outcome: "UNKNOWN" } | { outcome: "CONFLICT" }
type Write = { key: string; pdf: Buffer; csv: Buffer; manifestJson: string; dataPages: ReadonlyArray<{ receipt: unknown; bytes: Buffer }>; calendarBytes: Buffer; deadline: unknown }
type Receipt = { key: string; manifestSha256: string; pdfSha256: string; csvSha256: string; dataEvidenceSha256: string; deadlineEvidenceSha256: string }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function copyWrite(value: Write): Write {
  return { ...value, pdf: Buffer.from(value.pdf), csv: Buffer.from(value.csv), dataPages: value.dataPages.map(page => ({ receipt: clone(page.receipt), bytes: Buffer.from(page.bytes) })), calendarBytes: Buffer.from(value.calendarBytes), deadline: clone(value.deadline) }
}

export class TestNeutralRepository {
  orderBindings = new Map<string, string>()
  staged = new Map<string, Write>()
  confirmed = new Map<string, { write: Write; receipt: Receipt }>()
  quarantined = new Set<string>()
  stageMode: "normal" | "commit-timeout" | "conflict" = "normal"
  promoteMode: "normal" | "commit-timeout" | "conflict" = "normal"
  wrongPromoteReceipt = false
  wrongStoredReceipt = false
  orderReserveMode: "normal" | "commit-timeout" | "unknown" | "conflict" = "normal"
  mutateRead?: (write: Write) => Write
  afterStage?: () => void
  async reserveOrder(_orderId: string, key: string, propertyPin: string): Promise<Outcome<string>> {
    if (this.orderReserveMode === "conflict") return { outcome: "CONFLICT" }
    const current = this.orderBindings.get(key)
    if (current && current !== propertyPin) return { outcome: "CONFLICT" }
    if (!current && this.orderReserveMode !== "unknown") this.orderBindings.set(key, propertyPin)
    if (this.orderReserveMode === "commit-timeout") throw new Error("timeout after order bind")
    if (this.orderReserveMode === "unknown") return { outcome: "UNKNOWN" }
    return { outcome: "CONFIRMED", value: propertyPin }
  }
  async readOrderBinding(key: string): Promise<string | null> { return this.orderBindings.get(key) ?? null }
  async reserve(_orderId: string, key: string): Promise<Outcome<Receipt | null>> {
    return { outcome: "CONFIRMED", value: this.confirmed.get(key)?.receipt ?? null }
  }
  async stage(key: string, write: Write): Promise<Outcome> {
    if (this.stageMode === "conflict") return { outcome: "CONFLICT" }
    this.staged.set(key, copyWrite(write))
    this.afterStage?.()
    if (this.stageMode === "commit-timeout") throw new Error("timeout after commit")
    return { outcome: "CONFIRMED", value: undefined as never }
  }
  async readStaged(key: string): Promise<Write | null> {
    const found = this.staged.get(key); if (!found) return null
    const out = copyWrite(found); return this.mutateRead ? this.mutateRead(out) : out
  }
  async promote(key: string, receipt: Receipt): Promise<Outcome<Receipt>> {
    if (this.promoteMode === "conflict") return { outcome: "CONFLICT" }
    const staged = this.staged.get(key); if (!staged) return { outcome: "CONFLICT" }
    const storedReceipt = clone(receipt)
    if (this.wrongStoredReceipt) storedReceipt.pdfSha256 = "0".repeat(64)
    this.confirmed.set(key, { write: copyWrite(staged), receipt: storedReceipt })
    this.staged.delete(key)
    if (this.promoteMode === "commit-timeout") throw new Error("timeout after promote")
    const returned = clone(receipt)
    if (this.wrongPromoteReceipt) returned.csvSha256 = "f".repeat(64)
    return { outcome: "CONFIRMED", value: returned }
  }
  async readConfirmed(key: string): Promise<{ write: Write; receipt: Receipt } | null> {
    const found = this.confirmed.get(key); if (!found) return null
    const write = copyWrite(found.write)
    return { write: this.mutateRead ? this.mutateRead(write) : write, receipt: clone(found.receipt) }
  }
  async quarantine(key: string): Promise<void> { this.staged.delete(key); this.confirmed.delete(key); this.quarantined.add(key) }
}

export function installNeutralTestRuntime(repository: TestNeutralRepository, active = true): () => void {
  if (process.env.NODE_ENV !== "test") throw new Error("test-only helper")
  const prior = (globalThis as any).__OT_NEUTRAL_REPORT_TEST_RUNTIME__
  ;(globalThis as any).__OT_NEUTRAL_REPORT_TEST_RUNTIME__ = { active, repository }
  return () => { (globalThis as any).__OT_NEUTRAL_REPORT_TEST_RUNTIME__ = prior }
}
