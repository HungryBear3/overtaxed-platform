# Installation Instructions

## Fix Applied ✅

Fixed Husky v9 compatibility issue in `package.json`. The `prepare` script now uses Husky v9's API.

## Installation Steps

### 1. Navigate to the correct directory
```bash
cd "c:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks\overtaxed-platform"
```

### 2. Install dependencies
```bash
npm install
```

**Note:** The Husky prepare script will run automatically. If you see a warning about Husky not being initialized, that's fine for now - we can set up git hooks later.

### 3. Generate Prisma Client
```bash
npm run db:generate
```

### 4. Set up environment variables
```bash
# Copy the example file
cp .env.example .env.local

# Edit .env.local with your:
# - Supabase DATABASE_URL and DIRECT_URL
# - NextAuth NEXTAUTH_SECRET
# - Stripe keys
# - Email service credentials
```

### 5. Set up Supabase database
1. Create a new Supabase project at https://supabase.com
2. Go to Settings > Database
3. Copy the connection string
4. For Vercel deployment, use the **Connection Pooler** (port 6543)
5. Update `.env.local`:
   ```
   DATABASE_URL="postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true"
   DIRECT_URL="postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"
   ```

### 6. Run initial migration
```bash
npm run db:migrate
```

### 7. Start development server
```bash
npm run dev
```

Visit http://localhost:3000

## Troubleshooting

### Husky Error
If you see a Husky error during `npm install`, it's safe to ignore for now. Git hooks can be set up later with:
```bash
npx husky init
```

### Prisma Generate Error
**Fixed:** Prisma 7+ requires connection URLs in `prisma.config.ts`, not `schema.prisma`. This has been configured.

If `npm run db:generate` still fails, make sure:
- You have a `.env.local` file with `DATABASE_URL` set (even if it's a placeholder)
- The `prisma.config.ts` file exists and loads environment variables correctly

### TypeScript Errors
After installing, run:
```bash
npm run type-check
```

This will show any TypeScript configuration issues.

## Next Steps After Installation

1. ✅ Install dependencies
2. ✅ Generate Prisma client
3. ✅ Set up Supabase database
4. ✅ Run migrations
5. 🔄 Set up NextAuth.js authentication
6. 🔄 Create property management features
7. 🔄 Build appeal filing system
