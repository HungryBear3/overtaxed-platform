/**
 * The `/packet` redemption surface.
 *
 * The code is the whole authorization, so most of what is asserted here is about
 * where the value does NOT go: not into storage, not into the URL, not into an
 * analytics call, and not left sitting in the input after the request resolves.
 */
import "@testing-library/jest-dom"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import PacketPage, { metadata } from "@/app/packet/page"
import { PacketForm } from "@/app/packet/packet-form"

import { PrivateDocumentBoundary } from "@/components/analytics/private-document-boundary"
jest.mock("next/navigation", () => ({ usePathname: () => "/packet" }))

const CODE = "Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5Z2g"
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])

/**
 * A minimal stand-in for the fetch Response the form consumes. jsdom does not
 * provide the global, and the form only ever reads `ok`, `json()` and `blob()`.
 */
function fakeResponse(
  init: { ok: boolean; body?: unknown } = { ok: true },
): Response {
  return {
    ok: init.ok,
    async json() { return init.body ?? {} },
    async blob() { return new Blob([PDF], { type: "application/pdf" }) },
  } as unknown as Response
}

const originalFetch = global.fetch
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

let fetchMock: jest.Mock
let created: string[]
let revoked: string[]
let clicked: HTMLAnchorElement[]

beforeEach(() => {
  created = []
  revoked = []
  clicked = []
  fetchMock = jest.fn(async () => fakeResponse({ ok: true }))
  global.fetch = fetchMock as never
  URL.createObjectURL = jest.fn(() => {
    const href = `blob:packet-${created.length}`
    created.push(href)
    return href
  }) as never
  URL.revokeObjectURL = jest.fn((href: string) => { revoked.push(href) }) as never
  jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  jest.restoreAllMocks()
  global.fetch = originalFetch
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

/** Paste a value into the field, the way a customer does from their email. */
function paste(value: string): HTMLInputElement {
  const input = screen.getByLabelText(/one-time code/i) as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  return input
}

async function submit(code: string) {
  render(<PacketForm />)
  const input = paste(code)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /download packet/i }))
  })
  return { input }
}

describe("the code is POSTed and never navigated", () => {
  it("submits a JSON body to the download route with no credentials", async () => {
    await submit(CODE)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/ot/packet/download")
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("omit")
    expect(init.referrerPolicy).toBe("no-referrer")
    expect(init.cache).toBe("no-store")
    expect(JSON.parse(String(init.body))).toEqual({ capability: CODE })
    // The value is in the body and nowhere in the URL.
    expect(url).not.toContain(CODE)
  })

  it("never writes the code to browser storage or the URL", async () => {
    await submit(CODE)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.stringify(localStorage)).not.toContain(CODE)
    expect(JSON.stringify(sessionStorage)).not.toContain(CODE)
    expect(window.location.href).not.toContain(CODE)
    expect(window.location.search).toBe("")
    expect(window.location.hash).toBe("")
    expect(document.cookie).not.toContain(CODE)
  })

  it("downloads the bytes and revokes the object URL immediately", async () => {
    await submit(CODE)
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0].download).toBe("overtaxed-appeal-evidence.pdf")
    expect(created).toHaveLength(1)
    // The page keeps no handle on the packet bytes.
    expect(revoked).toEqual(created)
    expect(document.querySelector(`a[href="${created[0]}"]`)).toBeNull()
  })

  it("clears the input once the request resolves", async () => {
    const { input } = await submit(CODE)
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""))
    await screen.findByText(/your packet has downloaded/i)
  })
})

describe("refusals are coarse and the input is still cleared", () => {
  it.each([
    ["EXPIRED", /expired/i],
    ["REVOKED", /no longer active/i],
    ["EXHAUSTED", /maximum number of times/i],
    ["TEMPORARILY_UNAVAILABLE", /try again in a few minutes/i],
    ["NOT_AVAILABLE", /not valid/i],
    ["SOMETHING_NEW", /something went wrong/i],
  ])("shows a message for %s", async (code, pattern) => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, body: { ok: false, code } }))
    const { input } = await submit(CODE)
    await screen.findByText(pattern)
    expect((input as HTMLInputElement).value).toBe("")
    expect(created).toEqual([])
  })

  it("never echoes the submitted code back into the page", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, body: { ok: false, code: "NOT_AVAILABLE" } }),
    )
    await submit(CODE)
    await screen.findByText(/not valid/i)
    expect(document.body.textContent).not.toContain(CODE)
  })

  it("clears the input when the network itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    const { input } = await submit(CODE)
    await screen.findByText(/could not be completed/i)
    expect((input as HTMLInputElement).value).toBe("")
  })
})

describe("the form refuses to submit anything malformed", () => {
  it.each(["", "short", `${CODE}=`, `${CODE}x`])(
    "keeps the button disabled for %j",
    async (value) => {
      render(<PacketForm />)
      if (value) paste(value)
      expect(screen.getByRole("button", { name: /download packet/i })).toBeDisabled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("cannot be double-submitted into spending two uses", async () => {
    let release: (value: Response) => void = () => {}
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { release = resolve }),
    )
    render(<PacketForm />)
    paste(CODE)
    const button = screen.getByRole("button", { name: /download packet/i })
    await act(async () => { fireEvent.click(button) })
    expect(button).toBeDisabled()
    await act(async () => { fireEvent.click(button) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { release(fakeResponse({ ok: true })) })
    await waitFor(() => expect(clicked).toHaveLength(1))
  })
})

describe("the page is private, accessible, and works on a small screen", () => {
  it("is marked noindex and no-referrer", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect(metadata.referrer).toBe("no-referrer")
  })

  it("renders a labelled input with a live status region", () => {
    render(<PrivateDocumentBoundary><PacketPage /></PrivateDocumentBoundary>)
    const input = screen.getByLabelText(/one-time code/i)
    expect(input).toHaveAttribute("autocomplete", "off")
    expect(input).toHaveAttribute("spellcheck", "false")
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(input).toHaveAttribute("aria-describedby", status.id)
  })

  it("lays out fluidly rather than at a fixed desktop width", () => {
    const { container } = render(<PrivateDocumentBoundary><PacketPage /></PrivateDocumentBoundary>)
    const main = container.querySelector("main")!
    // A max-width with responsive padding and a full-width control: usable at
    // 320px and not stretched across a desktop monitor.
    expect(main.className).toMatch(/max-w-/)
    expect(main.className).toMatch(/sm:/)
    expect(screen.getByRole("button", { name: /download packet/i }).className).toMatch(/w-full/)
    expect(screen.getByLabelText(/one-time code/i).className).toMatch(/w-full/)
  })

  it("tells the customer the code is never in a link and never asked for by reply", () => {
    render(<PrivateDocumentBoundary><PacketPage /></PrivateDocumentBoundary>)
    expect(screen.getByText(/never put the code in a link/i)).toBeInTheDocument()
  })
})

describe("nothing on this surface observes what is typed", () => {
  const source = readFileSync(join(process.cwd(), "app/packet/packet-form.tsx"), "utf8")
  const page = readFileSync(join(process.cwd(), "app/packet/page.tsx"), "utf8")

  // Comments are stripped first: the module's own documentation names the very
  // APIs it promises not to use, and a scan that could not tell the two apart
  // would force the file to stop explaining itself.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it.each([
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "gtag",
    "dataLayer",
    "@vercel/analytics",
    "Sentry",
    "router.push",
    "window.location",
    "history.pushState",
  ])("the form never references %s", (forbidden) => {
    expect(code).not.toContain(forbidden)
  })

  it("the page ships no third-party widget or analytics import", () => {
    expect(page).not.toMatch(/@vercel\/analytics|gtag|Script from "next\/script"/)
  })
})
