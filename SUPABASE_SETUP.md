# Supabase Setup Guide for Overtaxed

## Step-by-Step Setup

### 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click **"New Project"**
4. Fill in project details:
   - **Name:** `overtaxed-platform` (or your preferred name)
   - **Database Password:** Create a strong password (save this!)
   - **Region:** Choose closest to you (e.g., `US East (North Virginia)`)
   - **Pricing Plan:** Free tier is fine for development
5. Click **"Create new project"**
6. Wait 2-3 minutes for project to initialize

### 2. Get Connection Strings

Once your project is ready:

1. Go to **Settings** → **Database**
2. Scroll down to **Connection string** section
3. You'll see two connection strings:

#### For Vercel/Production (Connection Pooler - port 6543)
- Click **"Connection pooling"** tab
- Select **"Session mode"**
- Copy the connection string (it will look like):
  ```
  postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
  ```

#### For Local Development/Migrations (Direct - port 5432)
- Click **"URI"** tab
- Copy the connection string (it will look like):
  ```
  postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
  ```

**Important:** Replace `[PASSWORD]` with the database password you created in step 1.

### 3. Configure Environment Variables

1. In your project, copy the example env file:
   ```bash
   cd "c:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks\overtaxed-platform"
   cp .env.example .env.local
   ```

2. Open `.env.local` and update:

   ```env
   # Database - Use Connection Pooler for DATABASE_URL (Vercel/production)
   DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
   
   # Database - Use Direct connection for DIRECT_URL (migrations)
   DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   
   # NextAuth - Generate a secret
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="your-random-secret-here"
   ```

3. **Generate NEXTAUTH_SECRET:**
   ```bash
   # Option 1: Use OpenSSL (if available)
   openssl rand -base64 32
   
   # Option 2: Use Node.js
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   
   # Option 3: Use online generator
   # Visit: https://generate-secret.vercel.app/32
   ```

### 4. Test Database Connection

Run the test script:
```bash
npm run db:test
```

Or manually test:
```bash
npx tsx scripts/test-db-connection.ts
```

### 5. Generate Prisma Client

```bash
npm run db:generate
```

This should complete without errors if your connection strings are correct.

### 6. Run Initial Migration

Create and apply the database schema:
```bash
npm run db:migrate
```

When prompted, name your migration: `init`

This will create all tables in your Supabase database.

### 7. Enable Row Level Security (RLS)

Run the RLS migration to fix Supabase Security Advisor warnings:

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `prisma/enable_rls.sql` and copy its contents
3. Paste and run in the SQL Editor

This enables RLS on all public tables. With no permissive policies, PostgREST/Data API access is denied while Prisma (postgres role) continues to work normally.

### 8. Verify in Supabase Dashboard

1. Go to **Table Editor** in Supabase dashboard
2. You should see all tables:
   - `User`
   - `Property`
   - `Appeal`
   - `ComparableProperty`
   - `Invoice`
   - etc.

### 9. (Optional) Open Prisma Studio

View and edit your database:
```bash
npm run db:studio
```

This opens a GUI at http://localhost:5555

## Connection String Format

### Connection Pooler (DATABASE_URL) - For Vercel/Production
```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Why:** Connection pooler handles many concurrent connections efficiently (required for Vercel serverless)

### Direct Connection (DIRECT_URL) - For Migrations
```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

**Why:** Direct connection needed for migrations and Prisma Studio

## Troubleshooting

### Connection Timeout
- Check your firewall isn't blocking ports 5432 or 6543
- Verify password is correct (no extra spaces)
- Make sure project is fully initialized (wait 2-3 minutes after creation)

### SSL/TLS Errors
- For local development, you can temporarily set `DATABASE_INSECURE_TLS=1` in `.env.local`
- For production, use proper SSL certificates

### Migration Errors
- Make sure `DIRECT_URL` is set (migrations need direct connection)
- Verify you have the correct password
- Check Supabase project is active (not paused)

### Prisma Client Generation Errors
- Ensure `DATABASE_URL` is set in `.env.local`
- Run `npm run db:generate` after setting up environment variables
- Check `prisma.config.ts` exists and loads env vars correctly

### "MaxClientsInSessionMode: max clients reached"
- The app uses **1 connection per serverless instance** on Vercel to avoid exhausting the pooler.
- If you still see this: in Supabase **Settings → Database → Connection pooling**, use **Transaction** mode (not Session) for the pooler if available; or increase pool size in the Supabase dashboard.
- Ensure `DATABASE_URL` uses the **pooler** (port 6543) with `?pgbouncer=true`.

## Security Notes

- **Never commit `.env.local`** to git (it's in `.gitignore`)
- **Use different passwords** for development and production
- **Rotate passwords** periodically
- **Use connection pooler** in production (Vercel) to avoid connection limits

## Next Steps After Setup

1. ✅ Supabase project created
2. ✅ Connection strings configured
3. ✅ Environment variables set
4. ✅ Database connection tested
5. ✅ Prisma client generated
6. ✅ Initial migration run
7. ✅ RLS enabled (optional but recommended)
8. 🔄 Set up NextAuth.js authentication
9. 🔄 Start building features!

## Quick Reference

```bash
# Test connection
npm run db:test

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Open Prisma Studio
npm run db:studio

# View database in Supabase
# Go to: https://supabase.com/dashboard/project/[PROJECT-REF]/editor
```
