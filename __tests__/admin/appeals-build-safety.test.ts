import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pageFiles(path)
    return entry.name === "page.tsx" ? [path] : []
  })
}

describe("admin DB pages build safety", () => {
  it("keeps every Prisma-backed admin page dynamic so builds never query the database", () => {
    const adminRoot = join(process.cwd(), "app/admin")
    const unsafe = pageFiles(adminRoot).filter((path) => {
      const source = readFileSync(path, "utf8")
      return source.includes("prisma.") && !/export const dynamic\s*=\s*["']force-dynamic["']/.test(source)
    })
    expect(unsafe.map((path) => path.replace(`${process.cwd()}/`, ""))).toEqual([])
  })
})
