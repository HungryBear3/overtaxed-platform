// Allowlist + URL-validation helpers for packet download.
//
// Threat model: a poisoned `Invoice.packetPdfUrl` (DB compromise, manual
// admin edit, future migration bug) must not let the auth-gated download
// route fetch arbitrary URLs. We require BOTH:
//   (1) packetPdfPath matches `packets/<invoiceId>/...` exactly
//   (2) packetPdfUrl, if present, points at a known blob host
//
// The download route re-derives the served bytes from the path-validated
// URL, never trusts a free-form URL on its own.

const BLOB_HOST_RE = /\.(public|private)\.blob\.vercel-storage\.com$/i;

export interface AllowlistInput {
  invoiceId: string;
  packetPdfPath: string | null;
  packetPdfUrl: string | null;
}

export type AllowlistResult =
  | { ok: true; safeUrl: string; safePath: string }
  | { ok: false; reason: 'missing_path' | 'path_mismatch' | 'missing_url' | 'untrusted_host' };

export function validatePacketDownload(input: AllowlistInput): AllowlistResult {
  const { invoiceId, packetPdfPath, packetPdfUrl } = input;

  if (!packetPdfPath) return { ok: false, reason: 'missing_path' };
  // Path must live under packets/<invoiceId>/. No traversal, no spillover.
  const expectedPrefix = `packets/${invoiceId}/`;
  if (!packetPdfPath.startsWith(expectedPrefix)) {
    return { ok: false, reason: 'path_mismatch' };
  }
  if (packetPdfPath.includes('..') || packetPdfPath.includes('//')) {
    return { ok: false, reason: 'path_mismatch' };
  }

  if (!packetPdfUrl) return { ok: false, reason: 'missing_url' };

  let parsed: URL;
  try {
    parsed = new URL(packetPdfUrl);
  } catch {
    return { ok: false, reason: 'untrusted_host' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'untrusted_host' };
  if (!BLOB_HOST_RE.test(parsed.hostname)) return { ok: false, reason: 'untrusted_host' };

  // The URL pathname must contain the prefix-anchored path. Vercel Blob URLs
  // look like https://<store>.public.blob.vercel-storage.com/<path>(-<rand>).
  // We verify the URL path starts with `/${expectedPrefix}` so a poisoned URL
  // cannot point at a different blob path under the same trusted host.
  if (!parsed.pathname.startsWith(`/${expectedPrefix}`)) {
    return { ok: false, reason: 'path_mismatch' };
  }

  return { ok: true, safeUrl: parsed.toString(), safePath: packetPdfPath };
}
