import 'server-only'
import { X509Certificate } from 'node:crypto'
import { createSecureContext, checkServerIdentity } from 'node:tls'
import type { PoolConfig } from 'pg'

/** Explicit deployment pins; never derive project/host trust from a credential URL. */
export function roleTransport(raw: string, role: string, mode: string | undefined): PoolConfig {
  const refuse = (): never => { throw new Error('ROLE_TRANSPORT_UNAVAILABLE') }
  let url: URL
  try { url = new URL(raw) } catch { return refuse() }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) return refuse()
  if (!['ot_factual_app', 'ot_paid_snapshot_binder', 'ot_paid_snapshot_reader'].includes(role)) return refuse()
  const host = process.env.OT_ROLE_DATABASE_HOST
  const project = process.env.OT_ROLE_DATABASE_PROJECT_REF
  const ca = process.env.OT_ROLE_DATABASE_CA
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // Retain the existing socket-only local qualification route. No remote query overrides.
  for (const [key, value] of url.searchParams) {
    if (!(mode === 'disable' && local && key === 'host' && value.startsWith('/') && !value.includes('\0'))) return refuse()
  }
  if (mode === 'disable') {
    if (!local || url.username !== role || host || project || ca) return refuse()
    return { connectionString: raw, ssl: false }
  }
  if (mode !== 'require' || !host || host !== url.hostname || !ca || ca.includes('PRIVATE KEY') || !ca.includes('-----BEGIN CERTIFICATE-----')) return refuse()
  try {
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    if (!certificates?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) return refuse()
    for (const certificate of certificates) new X509Certificate(certificate)
    createSecureContext({ ca })
  } catch { return refuse() }
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
  const supabase = pooler || host.endsWith('.supabase.co') || host.endsWith('.supabase.com')
  if (supabase && (!project || !/^[a-z]{20}$/.test(project))) return refuse()
  if (pooler) {
    if (url.username !== `${role}.${project}` || url.port !== '5432' || url.pathname !== '/postgres') return refuse()
  } else {
    if (url.username !== role || (supabase && host !== `db.${project}.supabase.co`)) return refuse()
  }
  return { connectionString: raw, ssl: { ca, rejectUnauthorized: true, servername: host, checkServerIdentity: (_hostname, cert) => checkServerIdentity(host, cert) } }
}
