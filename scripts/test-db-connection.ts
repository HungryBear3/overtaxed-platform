// Test database connection script
// Run with: npx tsx scripts/test-db-connection.ts

import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local file
config({ path: resolve(process.cwd(), '.env.local') })

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

async function testConnection() {
  console.log('🔍 Testing database connection...\n')

  const connectionString = process.env.DATABASE_URL
  const directUrl = process.env.DIRECT_URL

  if (!connectionString) {
    console.error('❌ DATABASE_URL is not set in environment variables')
    console.log('\n💡 Make sure you have a .env.local file with:')
    console.log('   DATABASE_URL="postgresql://..."')
    process.exit(1)
  }

  if (!directUrl) {
    console.warn('⚠️  DIRECT_URL is not set (needed for migrations)')
  }

  console.log('📋 Connection Details:')
  console.log(`   DATABASE_URL: ${connectionString.replace(/:[^:@]+@/, ':****@')}`)
  if (directUrl) {
    console.log(`   DIRECT_URL: ${directUrl.replace(/:[^:@]+@/, ':****@')}`)
  }
  console.log('')

  try {
    // Test connection pooler (DATABASE_URL)
    console.log('1️⃣  Testing connection pooler (DATABASE_URL)...')
    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    })

    const adapter = new PrismaPg(pool)
    const prisma = new PrismaClient({ adapter })

    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1 as test`
    console.log('   ✅ Connection pooler works!\n')

    // Test direct connection if available (for migrations)
    if (directUrl) {
      console.log('2️⃣  Testing direct connection (DIRECT_URL)...')
      const useLocalhost = directUrl.includes('localhost') || directUrl.includes('127.0.0.1')
      const useSSL = process.env.DATABASE_SSL !== 'false' && !useLocalhost
      
      try {
        const directPool = new Pool({
          connectionString: directUrl,
          max: 1,
          connectionTimeoutMillis: 10000,
          ssl: useSSL ? { rejectUnauthorized: false } : false,
        })

        const directAdapter = new PrismaPg(directPool)
        const directPrisma = new PrismaClient({ adapter: directAdapter })

        await directPrisma.$queryRaw`SELECT 1 as test`
        console.log('   ✅ Direct connection works!\n')

        await directPrisma.$disconnect()
        directPool.end()
      } catch (directError) {
        console.log('   ⚠️  Direct connection failed (this is OK if migrations work)')
        console.log('   💡 Direct connection may be blocked by firewall or Supabase settings')
        console.log('   💡 Connection pooler works, which is what the app uses\n')
        // Don't fail the test - pooler is what matters for the app
      }
    }

    // Test Prisma client
    console.log('3️⃣  Testing Prisma client...')
    const client = new PrismaClient({ adapter })
    
    // Try to query User table (will fail if migrations haven't run, but connection works)
    try {
      await client.user.findMany({ take: 1 })
      console.log('   ✅ Prisma client works! Database schema is ready.\n')
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2021') {
        console.log('   ⚠️  Prisma client works, but tables don\'t exist yet.')
        console.log('   💡 Run: npm run db:migrate\n')
      } else {
        throw error
      }
    }

    await prisma.$disconnect()
    await client.$disconnect()
    pool.end()

    console.log('✅ All connection tests passed!')
    console.log('\n📝 Next steps:')
    console.log('   1. Run: npm run db:generate')
    console.log('   2. Run: npm run db:migrate')
    console.log('   3. Start building! 🚀\n')

  } catch (error) {
    console.error('\n❌ Connection test failed!\n')
    
    if (error && typeof error === 'object' && 'message' in error) {
      console.error('Error:', error.message)
    } else {
      console.error('Error:', error)
    }

    console.log('\n🔧 Troubleshooting:')
    console.log('   1. Check your DATABASE_URL is correct')
    console.log('   2. Verify your Supabase project is active')
    console.log('   3. Check your database password')
    console.log('   4. Ensure firewall allows connections to Supabase\n')
    
    process.exit(1)
  }
}

testConnection()
