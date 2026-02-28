# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Overtaxed Platform is a Next.js 16+ (App Router) TypeScript application for automated property tax appeals in Cook County, IL. Single application (not a monorepo). Uses npm as the package manager.

### Services

| Service | Required | Notes |
|---------|----------|-------|
| PostgreSQL | Yes | Local instance on port 5432. Database: `overtaxed`, user: `overtaxed`, password: `overtaxed_dev` |
| Next.js dev server | Yes | `npm run dev` on port 3000 |
| Stripe | No | Gracefully disabled when keys absent (`[stripe] STRIPE_SECRET_KEY not set – payments disabled`) |
| SMTP/Email | No | Gracefully disabled when env vars absent |

### Starting PostgreSQL

PostgreSQL may not be running after VM restart. Start it with:

```
sudo pg_ctlcluster 16 main start
```

### Running the app

Standard commands are in `package.json` scripts and `README.md`. Key non-obvious notes:

- `npm run lint` is currently a no-op (`node -e "process.exit(0)"`). Use `npm run type-check` for meaningful static analysis.
- `npm run build` runs `prisma migrate deploy && prisma generate && next build`. If the local DB was set up with `prisma db push`, you must baseline existing migrations first (see below).
- Prisma 7+ config is in `prisma.config.ts` (not `schema.prisma`). It uses `dotenv` to load `.env.local` and falls back to a placeholder URL so `prisma generate` succeeds without a live DB.
- `postinstall` in `package.json` runs `prisma generate` automatically.

### Database setup (fresh environment)

After PostgreSQL is running and the `overtaxed` database exists:

```
npx prisma db push          # sync schema to local DB
npx prisma migrate resolve --applied 0_init
npx prisma migrate resolve --applied 20250219000000_add_stripe_invoice_id
npx prisma migrate resolve --applied 20250224120000_add_property_unit_number
```

This baselines the migration history so `prisma migrate deploy` (used by `npm run build`) succeeds.

### Environment variables

Copy `.env.example` to `.env.local`. Required for local dev:
- `DATABASE_URL` / `DIRECT_URL` — local PostgreSQL connection strings
- `NEXTAUTH_SECRET` — any random base64 string
- `NEXTAUTH_URL=http://localhost:3000`

All Stripe, SMTP, AWS, and Sentry vars are optional and degrade gracefully.

### Tests

No test files exist yet. Jest is configured; run with `npx jest --passWithNoTests`.
