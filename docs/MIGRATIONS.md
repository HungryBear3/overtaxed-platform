# Database Migrations

## Automatic migrations on deploy

The build runs `prisma migrate deploy` before `next build`, so migrations are applied automatically on each Vercel deploy.

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
