/**
 * @jest-environment node
 *
 * Pure-mapper tests for the OT condo scraper. No DB, no network. These guard
 * the runbook §3.C behavior:
 *  - rows without an email are skipped (no durable contact path)
 *  - role-addresses (info@/admin@/...) flag row_status='needs_review'
 *  - property-manager-style owner names flag row_status='needs_review'
 *  - clean rows land as 'ok'
 *  - dedupe key (building_address_normalized, board_email_lowercase) is stable
 */

import {
  looksLikePropertyManagerName,
  looksLikeRoleAddress,
  mapRealieRow,
  normalizeAddress,
  type RealieCondoRow,
} from '../../tools/ot-condo-scraper/lib';

describe('normalizeAddress', () => {
  it('lowercases, collapses whitespace, strips punctuation', () => {
    expect(normalizeAddress('123 Main  St., Apt. 4')).toBe('123 main st apt 4');
  });
  it('produces a stable dedupe key across casing variants', () => {
    expect(normalizeAddress('5236 N Kenmore Ave')).toBe(
      normalizeAddress('5236 N KENMORE AVE'),
    );
  });
});

describe('looksLikeRoleAddress', () => {
  it.each([
    'info@example.com',
    'admin@example.com',
    'CONTACT@Example.com',
    'board@condo.com',
    'support@x.io',
    'noreply@y.io',
  ])('flags role address: %s', (email) => {
    expect(looksLikeRoleAddress(email)).toBe(true);
  });

  it.each([
    'jane.doe@example.com',
    'lukas@condo.com',
    'a.b.c@x.io',
  ])('does not flag personal address: %s', (email) => {
    expect(looksLikeRoleAddress(email)).toBe(false);
  });
});

describe('looksLikePropertyManagerName', () => {
  it.each([
    'Acme Mgmt LLC',
    'North Side Properties',
    'Lincoln Park Holdings',
    'XYZ Realty Inc',
    'River City Management Corp',
  ])('flags PM name: %s', (n) => {
    expect(looksLikePropertyManagerName(n)).toBe(true);
  });

  it.each([
    'Lukas Kaplun',
    'Jane Doe',
    'The Smith Family',
  ])('does not flag personal name: %s', (n) => {
    expect(looksLikePropertyManagerName(n)).toBe(false);
  });
});

function row(overrides: Partial<RealieCondoRow> = {}): RealieCondoRow {
  return {
    id: 'r1',
    address: '5236 N Kenmore Ave',
    buildingName: 'Kenmore Condos',
    city: 'Chicago',
    state: 'IL',
    zip: '60640',
    type: 'condo',
    beds: 2,
    assessedValue: 425_000,
    ownerName: 'Jane Doe',
    ownerEmail: 'jane.doe@example.com',
    sourceUrl: 'https://realie.io/p/r1',
    ...overrides,
  };
}

describe('mapRealieRow', () => {
  it('returns null when address is missing', () => {
    expect(mapRealieRow(row({ address: '' }))).toBeNull();
  });

  it('returns null when ownerEmail is missing (no durable contact path)', () => {
    expect(mapRealieRow(row({ ownerEmail: null }))).toBeNull();
  });

  it('flags row_status=ok for a personal owner name + personal email', () => {
    const m = mapRealieRow(row())!;
    expect(m.rowStatus).toBe('ok');
    expect(m.diagnostics.roleAddress).toBe(false);
    expect(m.diagnostics.propertyManagerSuspected).toBe(false);
    expect(m.diagnostics.reason).toBeUndefined();
  });

  it('flags row_status=needs_review when email is a role address', () => {
    const m = mapRealieRow(row({ ownerEmail: 'info@condo.com' }))!;
    expect(m.rowStatus).toBe('needs_review');
    expect(m.diagnostics.roleAddress).toBe(true);
    expect(m.diagnostics.reason).toBe('role_address');
  });

  it('flags row_status=needs_review when owner name looks like property manager', () => {
    const m = mapRealieRow(row({ ownerName: 'Acme Properties LLC' }))!;
    expect(m.rowStatus).toBe('needs_review');
    expect(m.diagnostics.propertyManagerSuspected).toBe(true);
    expect(m.diagnostics.reason).toBe('property_manager_suspected');
  });

  it('combines flags when both apply', () => {
    const m = mapRealieRow(
      row({ ownerName: 'Acme Mgmt LLC', ownerEmail: 'info@acme.com' }),
    )!;
    expect(m.rowStatus).toBe('needs_review');
    expect(m.diagnostics.reason).toBe('role_address + property_manager_suspected');
  });

  it('lowercases the email for the dedupe key', () => {
    const m = mapRealieRow(row({ ownerEmail: 'Jane.Doe@EXAMPLE.com' }))!;
    expect(m.boardEmailLowercase).toBe('jane.doe@example.com');
    expect(m.boardEmail).toBe('Jane.Doe@EXAMPLE.com'); // raw preserved
  });

  it('normalizes address for the dedupe key', () => {
    const m = mapRealieRow(row({ address: '5236 N. Kenmore Ave.' }))!;
    expect(m.buildingAddressNormalized).toBe('5236 n kenmore ave');
  });

  it('preserves the raw payload for audit', () => {
    const r = row({ id: 'r-audit-1' });
    const m = mapRealieRow(r)!;
    expect(m.rawPayload).toEqual(r as unknown as Record<string, unknown>);
  });
});
