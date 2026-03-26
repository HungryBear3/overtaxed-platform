# OT SEO Sprint — PRD

## Goal
Fix critical SEO gaps on overtaxed-il.com to improve Google indexing and rankings for Cook County property tax appeal keywords.

## Tasks (in order)

### 1. Fix sitemap.ts — CRITICAL
File: `app/sitemap.ts`

The sitemap currently only includes 7 static pages. It must also include:
- All blog posts (read slugs from `content/blog/` directory)
- All township pages (use the slugs: bloom, bremen, calumet, rich, thornton, worth, lemont, lyons, orland, palos, stickney, barrington, elk-grove, evanston, maine, niles, new-trier, northfield, palatine, wheeling, chicago, berwyn, hanover, oak-park, river-forest, schaumburg)

Use the `fs` module to read blog slugs dynamically from `content/blog/`. Set priority 0.8 for blog posts, 0.7 for township pages. Set appropriate changeFrequency values.

Example structure:
```ts
import fs from 'fs'
import path from 'path'

// Read blog slugs dynamically
const blogDir = path.join(process.cwd(), 'content/blog')
const blogSlugs = fs.readdirSync(blogDir)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''))
```

### 2. Add JSON-LD Article schema to blog posts
File: `app/blog/[slug]/page.tsx`

Add Article structured data to each blog post. Use the post title, description, date, and URL. Pattern:
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "post.title",
  "description": "post.description",
  "datePublished": "post.date",
  "publisher": {
    "@type": "Organization",
    "name": "OverTaxed IL",
    "url": "https://www.overtaxed-il.com"
  }
}
```

Inject via `<script type="application/ld+json">` in the page (same pattern as app/page.tsx which already has JSON-LD).

### 3. Add canonical tags to township pages
File: `app/townships/[slug]/page.tsx`

Add `alternates: { canonical: \`https://www.overtaxed-il.com/townships/\${slug}\` }` to the generateMetadata function to prevent duplicate content issues.

### 4. Write 4 new high-value blog posts
Create these files in `content/blog/`:

**Post A:** `cook-county-property-tax-appeal-deadline-2026-by-township.md`
- Title: "Cook County Property Tax Appeal Deadlines 2026 — Complete Township Guide"
- Target keyword: "cook county property tax appeal deadline 2026"
- Content: Comprehensive guide covering all 30 townships, their open/close dates, which district they're in, and links to start an appeal. Include a clear table or structured list. 800-1000 words. End with strong CTA to overtaxed-il.com free check.

**Post B:** `rule-15-appeal-cook-county-guide.md`
- Title: "What Is a Rule 15 Appeal in Cook County? (And How to File One)"
- Target keyword: "rule 15 appeal cook county"
- Content: Explain what Rule 15 comparable sales evidence is, why it's the strongest appeal argument, how to find comparable sales, and how OverTaxed IL automates this process. 700-900 words. Include CTA.

**Post C:** `cook-county-board-of-review-appeal-guide.md`
- Title: "How to File a Cook County Board of Review Appeal (Step-by-Step)"
- Target keyword: "cook county board of review appeal"
- Content: Explain the two-level appeal process (Assessor first, then Board of Review), deadlines, what evidence to submit, typical outcomes. 700-900 words. Include CTA.

**Post D:** `oak-lawn-property-tax-appeal-2026.md`
- Title: "Oak Lawn Property Tax Appeal 2026 — Worth Township Guide"
- Target keyword: "oak lawn property tax appeal"
- Content: Hyperlocal guide for Oak Lawn homeowners in Worth Township. Cover the 2026 reassessment, how to appeal, typical savings, and link to the Worth Township page on the site. 600-800 words. Include CTA.

### 5. Improve internal linking in existing blog posts
In the existing blog posts (especially `property-tax-appeal-cook-county.md` and `how-to-appeal-property-tax-illinois.md`), add at least 2 internal links each:
- Link to `/check` with anchor text like "start your free property assessment check"
- Link to `/townships` with anchor text like "find your township's deadline"
- Link to relevant other blog posts where natural

### 6. Add blog index to sitemap
Make sure `app/sitemap.ts` also includes `/blog` (the index page) with priority 0.8.

## Done Criteria
- [x] sitemap.ts exports all blog + township URLs (verify by checking the output)
- [x] Blog posts have JSON-LD Article schema
- [x] Township pages have canonical tags
- [x] 4 new blog posts exist in content/blog/ with proper frontmatter (title, description, date, slug)
- [x] Existing blog posts have internal links added
- [x] Everything compiles without TypeScript errors (run `npx tsc --noEmit` to check)
- [x] Commit all changes with message: "feat(seo): fix sitemap, add schema, new blog posts"

## Notes
- Do NOT modify any auth, dashboard, or Stripe-related code
- Do NOT change any existing page layouts or styles
- Blog post dates should be 2026-03-25
- Keep the brand voice: direct, helpful, homeowner-focused
- All CTAs should point to `/check` (the free check flow)
