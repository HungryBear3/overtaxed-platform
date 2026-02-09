# Deploy Overtaxed to Vercel

## GitHub / repo status

**If you separated projects** (see `SEPARATE_REPOS.md` in the parent repo): Overtaxed has its own repo, e.g. `https://github.com/HungryBear3/overtaxed-platform`. Use **Option B** below — import that repo in Vercel with Root Directory = `.` (default).

**If you’re still in the monorepo** (FreshStart-IL repo): Overtaxed lives in the `overtaxed-platform` folder. Push that folder to GitHub first (see below), then use **Option A** — import **HungryBear3/FreshStart-IL** and set Root Directory to `overtaxed-platform`.

---

## Push overtaxed-platform to GitHub (do this first)

Run from the **repo root** — the folder that **contains** `overtaxed-platform` (and `newstart-il`), e.g. `ai-dev-tasks`. **Do not run from inside `overtaxed-platform`** or `git add overtaxed-platform` will fail.

```bash
cd "C:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks"
git add overtaxed-platform
git status
git commit -m "Add overtaxed-platform app"
git push origin main
```

If you're already in `overtaxed-platform`, go up first: `cd ..` then run the `git add` / `commit` / `push` lines.

After this, GitHub will have the `overtaxed-platform` folder. In Vercel, when you import **HungryBear3/FreshStart-IL**, you’ll then see `overtaxed-platform` in the Root Directory list.

---

## Option A: Same repo, new Vercel project (recommended)

1. **Vercel** → Add New → **Project**
2. **Import** the same repo: **HungryBear3/FreshStart-IL**
3. **Configure:**
   - **Root Directory:** `overtaxed-platform`  
     (Click “Edit” next to Root Directory and set it to `overtaxed-platform`.)
   - **Framework Preset:** Next.js
   - **Build / Install:** leave defaults
4. **Environment variables:** Add the same vars as in `.env.local` (see `.env.example` and `STRIPE_SETUP.md`), including:
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXTAUTH_URL` (use your Vercel URL, e.g. `https://overtaxed-xxx.vercel.app`)
   - `NEXTAUTH_SECRET`
   - Stripe keys and price IDs
   - `STRIPE_WEBHOOK_SECRET` (from Stripe Dashboard webhook for this deploy URL)
   - Any others from `.env.example`
5. **Deploy.** After the first deploy, set `NEXTAUTH_URL` (and `NEXT_PUBLIC_APP_URL` if used) to your real domain (e.g. `https://www.overtaxed-il.com`).
6. **Stripe webhook:** In Stripe Dashboard add an endpoint for your deployed URL:  
   `https://www.overtaxed-il.com/api/billing/webhook` (or your Vercel URL), then put the signing secret in Vercel as `STRIPE_WEBHOOK_SECRET` and redeploy.

No new GitHub repo is required.

---

## Option B: Dedicated repo (overtaxed-platform)

After running the **separate-repos** flow (see `SEPARATE_REPOS.md` in the parent repo or `separate-repos.ps1`), Overtaxed has its own repo:

1. **Vercel** → Add New → **Project**
2. **Import** `HungryBear3/overtaxed-platform`
3. **Root Directory:** leave as **.** (repo root)
4. Add environment variables (from `.env.example` and `STRIPE_SETUP.md`), then **Deploy**
5. **Stripe webhook:** Add endpoint for your deployed URL, set `STRIPE_WEBHOOK_SECRET` in Vercel, redeploy

No Root Directory override needed.

---

## Troubleshooting: Build failed on Vercel

1. **Check the build log**  
   Vercel → Project → Deployments → click the failed deployment → **Building** tab. The last error line (e.g. `Error: ...` or `Command failed`) is what to fix.

2. **DATABASE_URL / Prisma**  
   - Ensure `DATABASE_URL` (and `DIRECT_URL` if used) are set in Vercel → Settings → Environment Variables, and apply to **Build** (not only Production).
   - The app uses a placeholder URL in `prisma.config.ts` when `DATABASE_URL` is missing so `prisma generate` can succeed; runtime still needs the real URL.

3. **Install / Build command**  
   Defaults are usually fine: Install = `npm install`, Build = `npm run build` (runs `prisma generate && next build`). Do not use install with `--production` or Prisma may be missing.

4. **Node version**  
   Vercel → Settings → General → Node.js Version. Use 18.x or 20.x if the build fails on an older default.
