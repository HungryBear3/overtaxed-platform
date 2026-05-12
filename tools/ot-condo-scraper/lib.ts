// Pure helpers for the OT condo scraper. No DB, no network. Tests target this
// module so the runner script (scrape.ts) can stay imperative.

export const ROLE_ADDRESS_RE =
  /^(info|admin|contact|board|help|support|postmaster|noreply|no-reply)@/i;

export const PROPERTY_MANAGER_NAME_RE =
  /\b(mgmt|management|associates|llc|inc|co\.|corp|properties|realty|holdings)\b/i;

export interface RealieCondoRow {
  id?: string;
  address?: string;
  buildingName?: string | null;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  beds?: number;
  assessedValue?: number;
  ownerName?: string | null;
  ownerEmail?: string | null;
  source?: string;
  sourceUrl?: string;
}

export interface MappedProspect {
  buildingName: string | null;
  buildingAddressRaw: string;
  buildingAddressNormalized: string;
  boardName: string;
  boardEmail: string;
  boardEmailLowercase: string;
  sourceUrl: string;
  rowStatus: 'ok' | 'needs_review' | 'rejected';
  rawPayload: Record<string, unknown>;
  diagnostics: { roleAddress: boolean; propertyManagerSuspected: boolean; reason?: string };
}

export function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
}

export function looksLikeRoleAddress(email: string): boolean {
  return ROLE_ADDRESS_RE.test(email);
}

export function looksLikePropertyManagerName(name: string): boolean {
  return PROPERTY_MANAGER_NAME_RE.test(name);
}

export function mapRealieRow(row: RealieCondoRow): MappedProspect | null {
  const address = (row.address ?? '').trim();
  const ownerEmail = (row.ownerEmail ?? '').trim();
  if (!address || !ownerEmail) return null;

  const ownerName = (row.ownerName ?? '').trim() || 'Owner';
  const lc = ownerEmail.toLowerCase();
  const roleAddress = looksLikeRoleAddress(lc);
  const propertyManagerSuspected = looksLikePropertyManagerName(ownerName);
  const rowStatus: MappedProspect['rowStatus'] =
    roleAddress || propertyManagerSuspected ? 'needs_review' : 'ok';

  const reason =
    roleAddress && propertyManagerSuspected
      ? 'role_address + property_manager_suspected'
      : roleAddress
        ? 'role_address'
        : propertyManagerSuspected
          ? 'property_manager_suspected'
          : undefined;

  return {
    buildingName: row.buildingName ?? null,
    buildingAddressRaw: address,
    buildingAddressNormalized: normalizeAddress(address),
    boardName: ownerName,
    boardEmail: ownerEmail,
    boardEmailLowercase: lc,
    sourceUrl: row.sourceUrl ?? '',
    rowStatus,
    rawPayload: row as unknown as Record<string, unknown>,
    diagnostics: { roleAddress, propertyManagerSuspected, ...(reason ? { reason } : {}) },
  };
}
