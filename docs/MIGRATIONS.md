# Database Migrations

## Deploy truth

Vercel build runs `prisma generate` and `next build`. It does **not** run `prisma migrate deploy`, and it does **not** apply schema changes for you.

Any controlled operator must:

1. Apply the intended migration to the target database first.
2. Verify the migration completed and the schema matches the checked-in migration.
3. Deploy the application code only after that verification succeeds.

Do not assume the schema is safe or current until the migration has actually been applied and verified in the target environment.

## Normal workflow

1. Edit `prisma/schema.prisma`.
2. Create or update the additive migration under `prisma/migrations/`.
3. Run local verification:
   ```bash
   pnpm prisma format
   pnpm prisma validate
   pnpm prisma generate
   ```
4. Have the controlled operator run:
   ```bash
   prisma migrate status
   prisma migrate deploy
   prisma migrate status
   ```
5. Verify the target schema/indexes, then deploy code.

## Baseline note

If a target database predates Prisma Migrate, baseline it explicitly before relying on `prisma migrate deploy`. The existing helper remains:

```bash
pnpm db:baseline
```

Run that only in a controlled environment against the intended database, and only when the baseline procedure is actually required.
