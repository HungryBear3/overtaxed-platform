import { chromium } from '@playwright/test';

const BASE_URL = process.env.OT_BASE_URL || 'http://127.0.0.1:3155';
const viewports = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'mobile', width: 390, height: 900 },
  { id: 'tight-mobile', width: 320, height: 820 },
];
const forbidden = [
  /Approve email send/i,
  /Exact email that will go out/i,
  /likely over-assessed/i,
  /median household saves/i,
  /free if we don['’]t reduce/i,
  /guaranteed savings/i,
  /send now/i,
  /resend now/i,
  /dpark@/i,
  /\.hoa\.example/i,
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

    const response = await page.goto(`${BASE_URL}/outreach-approval`, { waitUntil: 'networkidle', timeout: 30000 });
    const checks = await page.evaluate((patterns) => {
      const text = document.body.innerText;
      const doc = document.documentElement;
      return {
        title: document.title,
        statusText: text.slice(0, 500),
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        overflow: doc.scrollWidth > window.innerWidth + 2,
        requiredMissing: [
          'PROTOTYPE · MOCK DATA · NO SENDING',
          'Approve draft — no send',
          'NO OUTBOUND ACTION AVAILABLE',
          'DRAFT EMAIL PREVIEW — PROTOTYPE ONLY',
          'Approval creates no outbound email',
        ].filter((s) => !text.includes(s)),
        forbiddenPresent: patterns
          .map((source) => new RegExp(source, 'i'))
          .filter((re) => re.test(text))
          .map((re) => re.source),
      };
    }, forbidden.map((re) => re.source));

    await page.screenshot({ path: `/tmp/ot-outreach-${viewport.id}.png`, fullPage: true });
    results.push({
      viewport: viewport.id,
      http: response?.status() ?? null,
      consoleErrors,
      pageErrors,
      ...checks,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.http !== 200 || r.consoleErrors.length || r.pageErrors.length || r.overflow || r.requiredMissing.length || r.forbiddenPresent.length)) {
  process.exit(1);
}
