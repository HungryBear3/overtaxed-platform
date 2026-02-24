# Database Migrations

## Automatic migrations on deploy

The build runs `prisma migrate deploy` before `next build`, so migrations are applied automatically on each Vercel deploy.

## One-time baseline (existing production database)

If your Supabase database was created before Prisma Migrate (e.g. via `db push` or manual SQL), you must **baseline** it once before `prisma migrate deploy` will succeed. Otherwise you get error P3005: "The database schema is not empty."

**Run this once** with your production `DATABASE_URL` (from Vercel → Project → Settings → Environment Variables, or Supabase → Settings → Database → Connection string):

```powershell
# PowerShell (set env, then run)
$env:DATABASE_URL = "postgresql://postgres.[ref]:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
npm run db:baseline
```

Or in one line:
```powershell
$env:DATABASE_URL = "postgresql://..."; npm run db:baseline
```

This marks the baseline migration as applied without running it, since your tables already exist. After this, `prisma migrate deploy` on Vercel will succeed and only apply new migrations.

## Workflow for schema changes

1. **Edit schema:** Update `prisma/schema.prisma`
2. **Create migration locally:**
   ```bash
   npx prisma migrate dev --name add_your_change
   ```
   This creates a new folder under `prisma/migrations/` with the SQL.
3. **Commit and push:** The migration is applied on next deploy.

## If you add columns manually (Supabase Table Editor)

If you added a column manually and want to keep migrations in sync:

1. Create a migration folder: `prisma/migrations/YYYYMMDDHHMMSS_descriptive_name/`
2. Add `migration.sql` with idempotent SQL, e.g.:
   ```sql
   ALTER TABLE "YourTable" ADD COLUMN IF NOT EXISTS "yourColumn" TEXT;
   ```
3. Run `prisma migrate resolve --applied YYYYMMDDHHMMSS_descriptive_name` against production (or let deploy run it; `IF NOT EXISTS` makes it safe).

## Migrate deploy requirements

- `DATABASE_URL` must be set in Vercel (it is for Supabase).
- `prisma` must be in `dependencies` (not devDependencies) so it runs during Vercel build.
