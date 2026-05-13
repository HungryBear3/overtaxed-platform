/**
 * @jest-environment node
 *
 * Source-level guards for the unified OT v2 marketing site.
 *
 * Every public marketing route must:
 *   - import SiteHeader + SiteFooter from `components/ot-design/SiteChrome`
 *   - load `ot-design.css`
 *   - NOT import the legacy `components/header.tsx` / `components/footer.tsx`
 *   - NOT rebuild inline `<header>` markup
 *
 * Plus the targeted copy/pricing assertions enumerated in the v2 brief.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// Pages required to use SiteChrome (no /townships/[slug] — that page is the
// canonicalization redirect and intentionally has no chrome).
const CHROME_PAGES: ReadonlyArray<{ path: string; active?: string }> = [
  { path: "app/page.tsx", active: "home" },
  { path: "app/pricing/page.tsx", active: "offer" },
  { path: "app/check/page.tsx" },
  { path: "app/about/page.tsx" },
  { path: "app/faq/page.tsx", active: "faq" },
  { path: "app/contact/page.tsx" },
  { path: "app/privacy/page.tsx" },
  { path: "app/terms/page.tsx" },
  { path: "app/disclaimer/page.tsx" },
  { path: "app/deadlines/page.tsx", active: "deadlines" },
  { path: "app/townships/page.tsx", active: "deadlines" },
  { path: "app/township/[slug]/page.tsx", active: "deadlines" },
  { path: "app/board-of-review/page.tsx" },
  { path: "app/homestead-exemption/page.tsx" },
];

describe("OT v2 marketing — chrome unification", () => {
  for (const p of CHROME_PAGES) {
    describe(p.path, () => {
      const src = read(p.path);

      it("imports SiteChrome", () => {
        expect(src).toMatch(/from\s+["']@\/components\/ot-design\/SiteChrome["']/);
      });

      it("mounts SiteHeader and SiteFooter", () => {
        expect(src).toMatch(/<SiteHeader\b/);
        expect(src).toMatch(/<SiteFooter\s*\/>/);
      });

      it("does not import the legacy Header/Footer modules", () => {
        expect(src).not.toMatch(/from\s+["']@\/components\/header["']/);
        expect(src).not.toMatch(/from\s+["']@\/components\/footer["']/);
      });

      it("does not import the legacy navigation Logo component for chrome", () => {
        // Pages can still reference Logo from elsewhere (e.g. tests), but
        // the unified marketing chrome should never reintroduce a hand-built
        // header from the navigation/Logo module.
        const usesNavLogoImport = /import[^;]+\bLogo\b[^;]+from\s+["']@\/components\/navigation\/Logo["']/.test(src);
        expect(usesNavLogoImport).toBe(false);
      });

      if (p.active) {
        it(`SiteHeader uses the correct active=\"${p.active}\" prop`, () => {
          const re = new RegExp(`<SiteHeader[^/>]*active=\\{?["']${p.active}["']`);
          expect(re.test(src)).toBe(true);
        });
      }
    });
  }
});

describe("OT v2 marketing — pricing consistency", () => {
  it("no marketing surface uses the stale $149 full-automation price", () => {
    for (const p of CHROME_PAGES) {
      const src = read(p.path);
      // Strict boundary so this isn't tripped by e.g. "$1,492".
      if (/\$149\b/.test(src)) {
        throw new Error(`${p.path} still mentions $149`);
      }
    }
  });

  it("public non-pricing marketing surfaces do not reference the retired Starter/Growth/Portfolio plan names", () => {
    for (const p of CHROME_PAGES.filter((page) => page.path !== "app/pricing/page.tsx")) {
      const src = read(p.path);
      expect(src).not.toMatch(/\bStarter\b/);
      expect(src).not.toMatch(/\bGrowth\b/);
      expect(src).not.toMatch(/\bPortfolio\b/);
    }
  });

  it("homepage metadata removes the unscoped \"free if we don't reduce your bill\" promise", () => {
    const src = read("app/page.tsx");
    expect(src).not.toMatch(/free if we don'?t reduce your bill/i);
  });

  it("/pricing keeps $69 as the visible anchor", () => {
    const src = read("app/pricing/page.tsx");
    expect(src).toMatch(/\$69\b/);
    expect(src).toMatch(/\$97\b/);
  });

  it("/board-of-review does not show the stale $149 tier", () => {
    const src = read("app/board-of-review/page.tsx");
    expect(src).not.toMatch(/\$149\b/);
  });
});

describe("OT v2 marketing — funnel CTAs", () => {
  it("/townships does not route table CTAs to /auth/signup", () => {
    const src = read("app/townships/page.tsx");
    expect(src).not.toMatch(/href="\/auth\/signup"/);
  });

  it("/board-of-review primary CTA points at /check or /pricing, not auth", () => {
    const src = read("app/board-of-review/page.tsx");
    expect(src).not.toMatch(/href="\/auth\/signup"/);
    expect(src).toMatch(/href="\/(check|pricing)"/);
  });

  it("/homestead-exemption upsell points at /check", () => {
    const src = read("app/homestead-exemption/page.tsx");
    expect(src).toMatch(/href="\/check"/);
  });

  it("homepage PIN hint no longer uses href=\"#\"", () => {
    const src = read("components/ot-design/HomePage.tsx");
    // The PIN hint block must not be a no-op link anymore.
    expect(src).toMatch(/cookcountyassessor\.com\/address-search/);
    expect(src).not.toMatch(/href="#" onClick=\{\(e\) => e\.preventDefault\(\)\}/);
  });
});

describe("OT v2 marketing — township canonicalization", () => {
  const src = read("app/townships/[slug]/page.tsx");

  it("plural /townships/[slug] redirects to /township/[slug]", () => {
    expect(src).toMatch(/from\s+["']next\/navigation["']/);
    expect(src).toMatch(/redirect\(`\/township\/\$\{slug\}`\)/);
  });

  it("plural route no longer renders the hardcoded subset", () => {
    expect(src).not.toMatch(/Township not found/);
    expect(src).not.toMatch(/AppealButton/);
  });
});

describe("OT v2 marketing — legal copy disclaimers", () => {
  it("/about labels OverTaxed IL as not a law firm and disclaims guaranteed reductions", () => {
    const src = read("app/about/page.tsx");
    expect(src).toMatch(/not a law firm/i);
    expect(src).toMatch(/do not guarantee/i);
  });

  it("/check carries a not-a-law-firm disclaimer", () => {
    const src = read("app/check/page.tsx");
    expect(src).toMatch(/not a law firm/i);
  });

  it("/pricing keeps the not-a-law-firm disclaimer", () => {
    const src = read("app/pricing/page.tsx");
    expect(src).toMatch(/not a law firm/i);
  });

  it("/homestead-exemption keeps the not-a-law-firm + no-guarantee disclaimer", () => {
    const src = read("app/homestead-exemption/page.tsx");
    expect(src).toMatch(/not a law firm/i);
    expect(src).toMatch(/do not guarantee/i);
  });
});

describe("OT v2 marketing — HOA / condo capture", () => {
  it("homepage HOA section is mounted in HomePage", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).toMatch(/HoaSection/);
    // Section anchors as #hoa and posts to the gated township-alert route.
    expect(src).toMatch(/id="hoa"/);
    expect(src).toMatch(/HOA Waitlist/);
    expect(src).toMatch(/"\/api\/township-alert"/);
  });

  it("/api/township-alert allowlist accepts the HOA Waitlist sentinel", () => {
    const src = read("app/api/township-alert/route.ts");
    expect(src).toMatch(/"HOA Waitlist"/);
  });

  it("/contact page advertises an HOA / condo path", () => {
    const src = read("app/contact/page.tsx");
    expect(src).toMatch(/HOA/i);
    // The contact card explicitly says "no attorney referral" — that
    // disavow is fine. What we don't want is a CTA that PUSHES users
    // toward attorneys (e.g. "Talk to an attorney", "Get matched with an
    // attorney").
    expect(src).not.toMatch(/talk to an attorney/i);
    expect(src).not.toMatch(/get matched with an attorney/i);
  });
});

describe("OT v2 marketing — home hero preview card", () => {
  const src = read("components/ot-design/HomePage.tsx");

  it("replaces the right-edge icon stack with a HeroPreviewCard", () => {
    // The floating RiskReversalRail must no longer be mounted from the
    // homepage (it is still exported from SiteChrome but unused on /).
    expect(src).not.toMatch(/<RiskReversalRail\s*\/>/);
    expect(src).toMatch(/function HeroPreviewCard\b/);
    expect(src).toMatch(/<HeroPreviewCard\s*\/>/);
  });

  it("preview card is always labeled as Sample and includes illustrative caveat", () => {
    expect(src).toMatch(/>\s*Sample\s*</);
    expect(src).toMatch(/Illustrative figures\./);
    expect(src).toMatch(/do not guarantee/i);
  });

  it("preview card lives in the hero left column above the fold", () => {
    // Ensures the new card is mounted inside ot-hero-l alongside HeroNarrative.
    expect(src).toMatch(/<HeroNarrative\s*\/>\s*<HeroPreviewCard\s*\/>/);
  });
});

describe("OT v2 marketing — SiteChrome footer references currently-open townships", () => {
  it("featured footer townships point at the singular /township/[slug] route", () => {
    const src = read("components/ot-design/SiteChrome.tsx");
    expect(src).toMatch(/`\/township\/\$\{t\.slug\}`/);
    // Spot-check at least one south-district open township in the list.
    expect(src).toMatch(/slug:\s*"bloom"/);
    expect(src).toMatch(/slug:\s*"thornton"/);
  });
});

describe("OT v2 marketing — township deadline source of truth", () => {
  it("/townships renders from lib/townships instead of a duplicate hardcoded dataset", () => {
    const src = read("app/townships/page.tsx");
    expect(src).toMatch(/from\s+["']@\/lib\/townships["']/);
    expect(src).toMatch(/TOWNSHIP_STATUS_COUNTS/);
    expect(src).not.toMatch(/const townships = \[/);
    expect(src).not.toMatch(/Northwest District/);
    expect(src).not.toMatch(/Berwyn[\s\S]{0,240}2028/);
    expect(src).not.toMatch(/Oak Park[\s\S]{0,240}2028/);
  });

  it("home sample and pricing copy no longer references Jefferson or equity-ratio language", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).not.toMatch(/Jefferson Twp|Jefferson Township/);
    expect(src).not.toMatch(/equity-ratio|equity ratio/i);
    expect(src).toMatch(/Lyons Twp/);
    expect(src).toMatch(/assessment level/i);
  });
});
