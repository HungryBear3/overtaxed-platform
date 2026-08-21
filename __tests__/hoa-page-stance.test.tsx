/**
 * @jest-environment node
 *
 * Copy-stance + contract pins for /hoa.
 *
 * Property managers are distribution on this page, not the buyer. The
 * test enforces the brief's rules so future copy changes can't
 * silently drift into book-a-call / savings-guarantee territory.
 *
 * Pinned contracts:
 *   - No call/booking CTA, no contact <form>, no popup script tags.
 *   - No affirmative savings guarantee (disclaimers of guarantees are fine).
 *   - No legal-advice claim.
 *   - "may find appeal opportunities they otherwise would have missed" present.
 *   - "Updated for 2026 Cook County appeal windows" present.
 *   - Both short + long notice templates render with copy buttons.
 *   - Notice body content links residents to /deadlines and /check with
 *     utm_source=hoa_notice (distinct from on-page CTA tagging).
 *   - On-page CTA links to /deadlines and /check carry utm_source=hoa.
 *
 * Layout/placement of the CTAs (hero vs. header vs. bottom-of-page) is
 * intentionally NOT pinned here — that's a design choice. The contract
 * is "all /deadlines and /check outbound links are tracked", not
 * "tracked in a specific button slot".
 */
import { renderToStaticMarkup } from "react-dom/server";
import HoaPage from "../app/hoa/page";

function decode(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

describe("/hoa copy + contract stance", () => {
  const html = renderToStaticMarkup(HoaPage());
  const text = decode(html);

  describe("forbidden phrases / CTAs", () => {
    const forbidden: Array<{ label: string; pattern: RegExp }> = [
      { label: "no 'book a call' CTA", pattern: /book a call/i },
      { label: "no 'schedule a call' CTA", pattern: /schedule a call/i },
      { label: "no 'book a consultation' CTA", pattern: /book a consultation/i },
      { label: "no 'schedule a consultation' CTA", pattern: /schedule a consultation/i },
      { label: "no Calendly/Cal.com links", pattern: /(calendly\.com|cal\.com|savvycal)/i },
      { label: "no tel: links anywhere on /hoa", pattern: /href="tel:/i },
      // Affirmative savings claims only. Disclaimers like
      // "outcomes are never guaranteed" are intentionally allowed
      // because they REINFORCE the no-guarantee stance.
      { label: "no affirmative 'we guarantee' phrasing", pattern: /\b(we|overtaxed[^.]*)\s+guarantee\b/i },
      { label: "no 'guaranteed savings/refund/reduction'", pattern: /guaranteed\s+(savings|refund|reduction|to\s+(save|reduce|lower))/i },
      { label: "no 'owners save real money'", pattern: /save\s+(real|big|substantial|huge)\s*money/i },
      { label: "no 'we'll save you' phrasing", pattern: /(we'?ll|we will)\s+save\s+you/i },
      { label: "no affirmative legal-advice claim", pattern: /\bwe\s+(provide|give|offer)\s+legal\s+advice/i },
      { label: "no contact <form> tag on the page", pattern: /<form\b/i },
      { label: "no popup/modal script", pattern: /(window\.open|onbeforeunload)\b/i },
      { label: "no 'partner program' framing", pattern: /partner\s+program/i },
      { label: "no 'endorse OverTaxed' framing", pattern: /endorse\s+overtaxed/i },
    ];
    for (const { label, pattern } of forbidden) {
      it(label, () => {
        expect(text).not.toMatch(pattern);
      });
    }
  });

  describe("required framing", () => {
    const required: Array<{ label: string; pattern: RegExp }> = [
      {
        label: "uses the soft 'may find ... they otherwise would have missed' framing",
        pattern: /may find appeal opportunities they otherwise would have missed/i,
      },
      {
        label: "names the county as the authority on filing dates",
        pattern: /confirm (yours|it) (directly )?at https:\/\/www\.cookcountyassessoril\.gov/i,
      },
      {
        label: "says the deadline pages show a date only where it was verified",
        pattern: /verified against the county's calendar/i,
      },
      { label: "declares 'no vendor agreement'", pattern: /no vendor agreement/i },
      { label: "declares 'no referral fees'", pattern: /no referral fees/i },
      { label: "declares 'no commitment from the board'", pattern: /no commitment from the board/i },
      { label: "discloses 'not a law firm'", pattern: /not a law firm/i },
    ];
    for (const { label, pattern } of required) {
      it(label, () => {
        expect(text).toMatch(pattern);
      });
    }

    it("makes no standing currency claim about the appeal windows", () => {
      // Was a required assertion: "Updated for 2026 Cook County appeal
      // windows". A board pastes this notice into a newsletter that is read
      // months later, so the sentence outlives whatever was true when it was
      // written — and with no verified snapshot it was never true at all.
      expect(text).not.toMatch(/Updated for 2026 Cook County appeal windows/i);
      expect(text).not.toMatch(/refreshed (monthly|weekly|daily)/i);
      expect(text).not.toMatch(/current appeal windows/i);
    });
  });

  describe("notice templates", () => {
    it("renders a short-notice textarea", () => {
      expect(html).toMatch(/<textarea[^>]*data-variant="short"/);
    });
    it("renders a long-notice textarea", () => {
      expect(html).toMatch(/<textarea[^>]*data-variant="long"/);
    });
    it("renders both copy buttons (short + long)", () => {
      const matches = [...html.matchAll(/data-action="copy-hoa-notice"\s+data-variant="(short|long)"/g)].map((m) => m[1]);
      expect(matches.sort()).toEqual(["long", "short"]);
    });
    it("notice body links residents to /deadlines with utm_source=hoa_notice", () => {
      expect(text).toMatch(/\/deadlines\?[^\s"<>]*utm_source=hoa_notice/);
    });
    it("notice body links residents to /check with utm_source=hoa_notice", () => {
      expect(text).toMatch(/\/check\?[^\s"<>]*utm_source=hoa_notice/);
    });
  });

  describe("on-page tracked CTAs", () => {
    it("at least one /deadlines link has utm_source=hoa", () => {
      expect(text).toMatch(/\/deadlines\?[^"<>]*utm_source=hoa\b/);
    });
    it("at least one /check link has utm_source=hoa", () => {
      expect(text).toMatch(/\/check\?[^"<>]*utm_source=hoa\b/);
    });
    it("every /deadlines outbound link carries a utm_content tag", () => {
      const hrefs = [...text.matchAll(/\/deadlines\?([^"<>\s]*)/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const qs of hrefs) {
        // Notice-body links use utm_source=hoa_notice and don't carry
        // utm_content; on-page tracked links use utm_source=hoa and DO.
        if (qs.includes("utm_source=hoa_notice")) continue;
        expect(qs).toMatch(/utm_content=/);
      }
    });
    it("every /check outbound link carries a utm_content tag", () => {
      const hrefs = [...text.matchAll(/\/check\?([^"<>\s]*)/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const qs of hrefs) {
        if (qs.includes("utm_source=hoa_notice")) continue;
        expect(qs).toMatch(/utm_content=/);
      }
    });
  });

  describe("resident-resource flyer withdrawal", () => {
    // These five cases previously asserted that the page served
    // `/resources/overtaxed-hoa-resident-resource.{pdf,html}` from two
    // surfaces. The flyer carries a standing "Current appeal windows" badge, a
    // "Refreshed monthly" line, and a description of /deadlines as a table of
    // open and close dates for all 38 townships — none of which is true, and
    // none of which can be corrected, because the JSX it was rendered from is
    // not in this repository. A printed sheet pinned in a lobby is the worst
    // carrier in the product for a date we cannot attribute, so the surface is
    // withdrawn rather than disclaimed.
    it("serves no flyer asset from any surface", () => {
      expect(html).not.toMatch(/overtaxed-hoa-resident-resource\.pdf/);
      expect(html).not.toMatch(/overtaxed-hoa-resident-resource\.html/);
      expect(html).not.toMatch(/data-action="download-hoa-resource"/);
    });

    it("offers the live deadlines page from both surfaces instead", () => {
      const sources = [
        ...html.matchAll(
          /data-action="hoa-resource-deadlines"\s+data-source="(hero|resident_notice_section)"/g,
        ),
      ].map((m) => m[1]);
      expect(sources).toContain("hero");
      expect(sources).toContain("resident_notice_section");
    });

    it("links the county calendar at the canonical .gov host, in a new tab", () => {
      expect(html).toMatch(
        /href="https:\/\/www\.cookcountyassessoril\.gov\/assessment-calendar-and-deadlines"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
      );
      expect(html).not.toContain("cookcountyassessor.com");
    });

    it("says plainly that the printable flyer is no longer published", () => {
      expect(text).toMatch(/no longer publish a printable deadline flyer/i);
      expect(text).toMatch(/Prefer to copy-paste\? Use the notices below\./);
    });
  });

  describe("quiet contact footer", () => {
    it("renders at least one mailto: contact link", () => {
      expect(text).toMatch(/href="mailto:/);
    });
    it("does NOT advertise a phone-call CTA anywhere on the /hoa surface", () => {
      // Brief: no call booking CTA. Even tel: links push toward calls,
      // so the /hoa page should never include one (the page renders its
      // own header/footer, no shared SiteFooter pulling in a phone link).
      expect(html).not.toMatch(/href="tel:/);
    });
  });
});
