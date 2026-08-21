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

import { CC_12 } from "@/lib/copy/canonical";

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
    // The PIN hint block must not be a no-op link anymore, and it must point
    // at the one host the controller authorized on 2026-08-19. Both halves are
    // asserted: a real destination, and the canonical spelling of it.
    expect(src).toMatch(/cookcountyassessoril\.gov\/address-search/);
    expect(src).not.toMatch(/cookcountyassessor\.com/);
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

  // /pricing no longer carries the disclaimer as a literal in its own source.
  // It renders canonical CC-12, which is the single definition of that
  // sentence; a raw-source grep would now fail on a page that satisfies the
  // requirement more strictly than before. The assertion follows the string to
  // where it is defined rather than asserting a duplicate exists.
  it("/pricing renders the canonical not-a-law-firm disclaimer", () => {
    const src = read("app/pricing/page.tsx");
    expect(src).toMatch(/import\s*\{[^}]*\bCC_12\b[^}]*\}\s*from\s*"@\/lib\/copy\/canonical"/);
    expect(src).toContain("{CC_12}");
    expect(CC_12).toMatch(/not a law firm/i);
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

  it("preview card lives in the hero right column above the fold", () => {
    // Keeps the product sample beside the form above the fold, not below the narrative.
    expect(src).toMatch(/<div className="ot-hero-r ot-hero-r-stack">\s*<HeroPreviewCard\s*\/>\s*<HeroCheckCard/);
  });
});

describe("OT v2 marketing — SiteChrome footer references canonical township groups", () => {
  it("footer township examples point at the singular /township/[slug] route", () => {
    const src = read("components/ot-design/SiteChrome.tsx");
    expect(src).toMatch(/`\/township\/\$\{t\.slug\}`/);
    expect(src).toMatch(/TOWNSHIPS\.filter/);
    expect(src).toMatch(/south-west-suburbs/);
    expect(src).toMatch(/north-suburbs/);
    expect(src).toMatch(/chicago/);
  });
});

describe("OT v2 marketing — township deadline source of truth", () => {
  it("/townships renders from lib/townships instead of a duplicate hardcoded dataset", () => {
    const src = read("app/townships/page.tsx");
    expect(src).toMatch(/from\s+["']@\/lib\/townships["']/);
    // Was `TOWNSHIP_STATUS_COUNTS` — a status tally this page kept for itself,
    // computed from the seed dates in lib/townships.ts. Counts now come from
    // the same canonical view model /deadlines reads, which is what stops the
    // two pages from disagreeing.
    expect(src).not.toMatch(/TOWNSHIP_STATUS_COUNTS/);
    expect(src).toMatch(/count2026Views/);
    expect(src).toMatch(/from\s+["']@\/lib\/deadlines-2026["']/);
    expect(src).not.toMatch(/const townships = \[/);
    expect(src).not.toMatch(/Northwest District/);
    expect(src).not.toMatch(/Berwyn[\s\S]{0,240}2028/);
    expect(src).not.toMatch(/Oak Park[\s\S]{0,240}2028/);
  });

  it("/townships attributes its dates or shows none", () => {
    const src = read("app/townships/page.tsx");
    // CC-08: a source and a retrieval instant wherever a deadline appears.
    expect(src).toMatch(/official2026Provenance/);
    expect(src).toMatch(/cc08/);
  });

  it("home sample and pricing copy no longer references Jefferson or equity-ratio language", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).not.toMatch(/Jefferson Twp|Jefferson Township/);
    expect(src).not.toMatch(/equity-ratio|equity ratio/i);
    expect(src).toMatch(/Cicero Twp/);
    expect(src).toMatch(/assessment level/i);
  });
});

describe("OT v2 marketing — public founder/contact", () => {
  it("publishes founder + Google Voice contact without exposing Alexy's personal cell", () => {
    const surfaces = [
      read("components/ot-design/SiteChrome.tsx"),
      read("app/about/page.tsx"),
      read("app/contact/page.tsx"),
      read("app/appeal-contingency/page.tsx"),
    ].join("\n");

    expect(surfaces).toMatch(/Alexy Kaplun/);
    expect(surfaces).toMatch(/calendlyUrl: "\/contact"/);
    expect(surfaces).not.toMatch(/calendly\.com/);
    expect(surfaces).toMatch(/\(847\) 461-3189/);
    expect(surfaces).toMatch(/tel:\+18474613189/);
    expect(surfaces).not.toMatch(/312\.593\.1571|312-593-1571|3125931571|tel:\+13125931571/);
  });
});

describe("OT v2 marketing — fourth-preview polish", () => {
  it("softens preview hero copy and keeps outcomes compact/deliverable-focused", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).not.toMatch(/Find out in 60 seconds/);
    expect(src).toMatch(/See where your assessed value lands/);
    expect(src).toMatch(/See what the packet includes/);
    expect(src).toMatch(/Verified Cook County outcomes will publish after 2026 Board decisions/);
  });

  it("footer groups township links by canonical district instead of six arbitrary townships", () => {
    const src = read("components/ot-design/SiteChrome.tsx");
    expect(src).toMatch(/FOOTER_TOWNSHIP_GROUPS/);
    expect(src).toMatch(/South & West/);
    expect(src).toMatch(/North Suburbs/);
    expect(src).toMatch(/City of Chicago/);
    expect(src).not.toMatch(/const FOOTER_TOWNSHIPS = \[/);
  });

  it("legacy floating risk rail is not exported or styled", () => {
    const chrome = read("components/ot-design/SiteChrome.tsx");
    const css = read("app/ot-design.css");
    expect(chrome).not.toMatch(/RiskReversalRail/);
    expect(css).not.toMatch(/ot-risk-rail/);
  });
});


describe("OT v2 marketing — launch-blocker copy guards", () => {
  it("homepage avoids assertive over-assessment claims and real-looking sample PINs", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).toMatch(/Is Cook County/);
    expect(src).not.toMatch(/Cook County is probably/);
    expect(src).toMatch(/synthetic sample/i);
    expect(src).not.toMatch(/PIN 18-06-214-011-0000/);
  });

  it("the ticker runs no countdown and holds no date of its own", () => {
    const src = read("lib/townships.ts");
    // Was: require the string "closes today" (the 0-day special case) and the
    // standing line "Township schedules checked regularly". Both are gone. The
    // countdown is gone because the ticker renders to an anonymous reader —
    // the informational tier never counts down — and the standing line is gone
    // because nothing checked anything regularly.
    // Read past the doc comments — they quote the removed copy in order to
    // record what was removed and why, which is evidence, not behaviour.
    const body = src
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(body).not.toMatch(/closes today/);
    expect(body).not.toMatch(/closes in \$\{[^}]+\} day/);
    expect(body).not.toMatch(/Township schedules checked regularly/);
    // And the roster carries no date literal at all, so no future edit can
    // rebuild a countdown from it without re-adding the data.
    expect(body).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
    expect(body).not.toMatch(/REFERENCE_DATE/);
  });

  it("the ticker announces only windows the canonical state verified", () => {
    const src = read("lib/townships.ts");
    expect(src).toMatch(/describeTownshipCalendar/);
    expect(src).toMatch(/projection\.status !== "open"/);
  });

  it("flat-fee FAQ states the $69 fee is paid regardless of outcome", () => {
    const src = read("components/ot-design/HomePage.tsx");
    expect(src).toMatch(/\$69 packet is a flat fee/);
    expect(src).toMatch(/paid regardless of what the county decides/);
    // The third assertion used to require the homepage FAQ to restate the
    // Terms of Service refund rule ("procedural error causes the county to
    // reject"). That rule is an owner policy term (OD-5, unsigned) and having
    // two copies of it in two places is how the two drift apart. The homepage
    // renders CC-12 instead, which is the canonical statement of what we do
    // and do not promise about the county's decision.
    expect(src).toMatch(/\$\{CC_12\}/);
  });

  it("legacy packet and contingency pages use OT chrome and Cook County-scoped copy", () => {
    const packet = read("app/appeal-packet/page.tsx");
    const contingency = read("app/appeal-contingency/page.tsx");

    for (const src of [packet, contingency]) {
      expect(src).toMatch(/SiteHeader/);
      expect(src).toMatch(/SiteFooter/);
      expect(src).toMatch(/ot-root/);
      expect(src).toMatch(/Cook County/);
    }

    expect(packet).toMatch(/not legal advice|not a law firm/i);

    // /appeal-contingency no longer carries the disclaimer as a literal. It
    // renders canonical CC-12, the single definition of that sentence, so the
    // assertion follows the string to where it is defined rather than
    // requiring a duplicate copy to exist in the page source.
    expect(contingency).toMatch(
      /import\s*\{[^}]*\bCC_12\b[^}]*\}\s*from\s*"@\/lib\/copy\/canonical"/,
    );
    expect(contingency).toContain("{CC_12}");
    expect(CC_12).toMatch(/not a law firm/i);

    expect(packet).not.toMatch(/Works for all Illinois counties|County Deadline Calendar|Illinois Homeowners|⚡|🏠|🔁/);
    expect(contingency).not.toMatch(/You only pay if\s+we win|Get My Free Assessment|placeholder="Jane Smith"|propertyPin/);

    // These two used to require the contingency terms to be *stated* on the
    // page — a sound guard while the product was offered, and exactly
    // backwards now that it is withdrawn. A page that still names the 22% and
    // the "if the Board grants a reduction" condition is still making the
    // offer, however the surrounding copy is framed.
    expect(contingency).not.toMatch(/If the Board of Review grants a reduction/);
    expect(contingency).not.toMatch(/22% of first-year tax savings/);
  });

  it("free-check sample address returns an illustrative sample instead of a silent 400", () => {
    const src = read("app/api/free-check/route.ts");
    expect(src).toMatch(/PREVIEW_SAMPLE_ADDRESS_PATTERN/);
    expect(src).toMatch(/sample-address/);
  });
});
