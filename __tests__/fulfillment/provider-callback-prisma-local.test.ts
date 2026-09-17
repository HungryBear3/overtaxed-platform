/** @jest-environment node */
/**
 * Opt-in native-driver regression. Run only against a disposable local database
 * with the delivery migrations applied. Never uses DATABASE_URL or TCP.
 * OT_TEST_PG_SOCKET=/absolute/unix/socket OT_TEST_PG_PORT=55439 jest ...
 */
jest.mock('@/lib/db', () => ({ prisma: {} }))
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { Pool } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createPrismaProviderCallbackStore } from '@/lib/fulfillment-runtime/provider-callback-store'

const socket = process.env.OT_TEST_PG_SOCKET
const local = socket?.startsWith('/') ? describe : describe.skip

local('native Prisma unmatched callback admission', () => {
  let pool: Pool
  let client: PrismaClient
  const eventId = `native-local-${randomUUID()}`

  beforeAll(() => {
    pool = new Pool({
      host: socket!,
      port: Number(process.env.OT_TEST_PG_PORT || '5432'),
      database: 'postgres',
      user: userInfo().username,
    })
    client = new PrismaClient({ adapter: new PrismaPg(pool) })
  })

  afterAll(async () => {
    try {
      await pool.query(
        'DELETE FROM ot_delivery_provider_callback WHERE provider_event_id = $1',
        [eventId],
      )
    } finally {
      await client.$disconnect()
      await pool.end()
    }
  })

  it('persists an early callback through the transaction advisory lock', async () => {
    const store = createPrismaProviderCallbackStore(client)
    const event = {
      provider: 'resend',
      providerEventId: eventId,
      providerMessageId: eventId,
      eventType: 'DELIVERED' as const,
      reasonCode: null,
      occurredAt: new Date().toISOString(),
    }
    // Before the correction this throws: Prisma cannot deserialize PostgreSQL
    // void returned by pg_advisory_xact_lock. Fake SQL adapters cannot catch it.
    expect(await store.ingest(event)).toEqual({ outcome: 'UNMATCHED' })
    expect(await store.ingest(event)).toEqual({ outcome: 'DUPLICATE' })
    const persisted = await pool.query(
      'SELECT disposition FROM ot_delivery_provider_callback WHERE provider_event_id = $1',
      [eventId],
    )
    expect(persisted.rows).toEqual([{ disposition: 'UNMATCHED' }])
  })
})
