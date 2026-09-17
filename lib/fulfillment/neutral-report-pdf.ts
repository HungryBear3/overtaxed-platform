import { renderT2ArtifactPdf } from "@/lib/fulfillment/t2-artifact-pdf"

/** Generic deterministic text renderer; grants no report authority or binding. */
export function renderDeterministicTextPdf(text: string, generatedAt: string, presentation: { title: string; heading: string; disclaimer: string }): Promise<Buffer> {
  return renderT2ArtifactPdf(text, generatedAt, presentation)
}
