# Quick Start Guide - Supabase Setup

## Fast Setup (5 minutes)

### 1. Create Supabase Project
1. Go to https://supabase.com → **New Project**
2. Name: `overtaxed-platform`
3. Set a **strong database password** (save it!)
4. Region: Choose closest
5. Wait 2-3 minutes for initialization

### 2. Get Connection Strings

In Supabase Dashboard → **Settings** → **Database**:

**Connection Pooler (for DATABASE_URL):**
- Tab: **Connection pooling** → **Session mode**
- Copy the connection string
- Replace `[PASSWORD]` with your database password

**Direct Connection (for DIRECT_URL):**
- Tab: **URI**
- Copy the connection string
- Replace `[PASSWORD]` with your database password

### 3. Set Up Environment Variables

```bash
# Copy example file
cp .env.example .env.local
```

Edit `.env.local`:
```env
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.[PROJECT-REF].supabase.co:5432/postgres"

NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
```

### 4. Test Connection

```bash
npm run db:test
```

### 5. Generate Prisma Client

```bash
npm run db:generate
```

### 6. Run Migration

```bash
npm run db:migrate
# Name it: init
```

### 7. Start Development

```bash
npm run dev
```

Visit http://localhost:3000

## That's It! 🎉

Your database is set up and ready. See `SUPABASE_SETUP.md` for detailed troubleshooting.
