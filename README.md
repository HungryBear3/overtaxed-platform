# Overtaxed Platform

Automated property tax appeal platform for Illinois homeowners.

## Tech Stack

- **Framework:** Next.js 16+ (App Router)
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL (Supabase)
- **ORM:** Prisma 7+
- **Authentication:** NextAuth.js v5
- **Payments:** Stripe
- **Styling:** Tailwind CSS 4
- **Deployment:** Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (Supabase recommended)
- Stripe account
- Email service (SendGrid, Postmark, or AWS SES)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

3. Set up database:
```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate
```

4. Start development server:
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Project Structure

```
overtaxed-platform/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── dashboard/         # User dashboard
│   ├── properties/        # Property management
│   ├── appeals/           # Appeal tracking
│   └── admin/             # Admin panel
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   └── ...
├── lib/                   # Utility libraries
│   ├── db/               # Database utilities
│   ├── auth/             # Authentication
│   ├── county/           # County integrations (Cook County)
│   ├── comps/            # Comparable property data
│   └── ...
├── prisma/               # Prisma schema and migrations
└── types/                # TypeScript type definitions
```

## Key Features

- **Automated Monitoring:** Tracks property tax assessments
- **Automated Filing:** Files appeals when increases detected
- **Comps Engine:** Generates comparable property data (Cook County Open Data)
- **Multi-Year Tracking:** Tracks appeals across tax years
- **Performance Plan:** 4% of 3-year savings fee structure
- **Cook County Focus:** MVP supports Cook County only

## Development

- `npm run dev` - Start dev server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run type-check` - TypeScript type checking
- `npm test` - Run tests

## Database

- `npm run db:studio` - Open Prisma Studio
- `npm run db:migrate` - Run migrations
- `npm run db:push` - Push schema changes (dev only)

## Deployment

Deploy to Vercel with:
- Root directory: `overtaxed-platform`
- Build command: `npm run build`
- Install command: `npm install`

See `tasks/tasks-overtaxed-platform.md` for full implementation checklist.
