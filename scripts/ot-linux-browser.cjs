'use strict';
// Synthetic browser driver for /check. Started by ot-linux-qa.py inside the
// namespace, never directly. Browser proof only: POST /api/free-check is answered
// here and never reaches the backend.
const fs = require('fs');
const path = require('path');

const { OT_ORIGIN, OT_OUT, OT_PROFILE, OT_CHROME, OT_APP, OT_DEADLINE_MS } = process.env;
for (const [key, value] of Object.entries({ OT_ORIGIN, OT_OUT, OT_PROFILE, OT_CHROME, OT_APP, OT_DEADLINE_MS })) {
  if (!value) throw new Error('missing env ' + key);
}
const { chromium } = require(path.join(OT_APP, 'node_modules/playwright'));

const ORIGIN = new URL(OT_ORIGIN).origin;
const API = ORIGIN + '/api/free-check';
const CHECK = ORIGIN + '/check';
const ASSESSOR = 'https://www.cookcountyassessoril.gov/address-search';
const HOSTILE = 'https://assessor.example.invalid/address-search';
const MARKER = 'SYNTHETIC_INTERCEPTION_CONTROL_503';
const ADDRESS = '100 Synthetic Fixture Way.invalid';
const CITY = 'Fixtureville.invalid';
const STORED_ERROR = 'Stored results are temporarily unavailable.';
const DEFAULT_503 = 'The Cook County records service is not responding. Please try again shortly.';
const NETWORK_ERROR = 'Network error. Please try again.';
const SCREENSHOT_CAP = 2 * 1024 * 1024;
const REQUEST_RECORD_CAP = 500;
const GATE_WAIT_MS = 30000;

// Expected results follow components/check/FreeCheckForm.tsx exactly. null-json
// is the subtle one: the 503 branch sets the status role and Assessor fallback
// before `data.error` throws, so the catch shows the network error inside them.
const KINDS = {
  normal: { body: JSON.stringify({ error: STORED_ERROR, code: 'ACCESS_UNAVAILABLE' }), role: 'status', text: STORED_ERROR, link: true, shot: true },
  malicious: { body: JSON.stringify({ error: STORED_ERROR, code: 'ACCESS_UNAVAILABLE', assessorAddressSearchUrl: HOSTILE }), role: 'status', text: STORED_ERROR, link: true, shot: true },
  'missing-message': { body: '{}', role: 'status', text: DEFAULT_503, link: true },
  'null-json': { body: 'null', role: 'status', text: NETWORK_ERROR, link: true },
  'malformed-json': { body: '{"error":', role: 'alert', text: NETWORK_ERROR, link: false },
  'fetch-failure': { abort: true, role: 'alert', text: NETWORK_ERROR, link: false },
};
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

const ev = {
  kind: 'SYNTHETIC CLIENT RESPONSE browser proof; never backend E2E',
  startedAt: new Date().toISOString(),
  ok: false,
  error: null,
  submitAttempted: false,
  control: null,
  cases: {},
  requests: [],
  requestsDropped: 0,
  counts: {},
  webSockets: [],
  errors: { pageErrors: [], requestFailed: [], handlerErrors: [], crashes: [] },
  popups: [],
  limitations: [],
};
for (const kind of Object.keys(KINDS)) {
  for (const viewport of Object.keys(VIEWPORTS)) ev.cases[`${kind}-${viewport}`] = { status: 'notrun' };
}

const tally = { total: 0, fulfilled: 0, aborted: 0, continued: 0, posts: 0, controlPosts: 0, continuedPosts: 0, continuedNonGet: 0 };
const state = { phase: 'startup', current: null, closing: false };
const routed = new Set();
const seen = new Set();

function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
}

function writeJson(name, value) {
  const file = path.join(OT_OUT, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function save() {
  ev.finishedAt = new Date().toISOString();
  ev.counts = {
    ...tally,
    unrouted: [...seen].filter((q) => /^https?:/.test(q.url()) && !routed.has(q)).length,
    pageErrors: ev.errors.pageErrors.length,
    popups: ev.popups.length,
    observedWebSockets: ev.webSockets.length,
  };
  writeJson('browser-evidence.json', ev);
}

function describe(url) {
  // Same-origin paths only, plus the host of anything blocked; never a query string.
  try {
    const parsed = new URL(url);
    return parsed.origin === ORIGIN ? parsed.pathname : parsed.protocol + '//' + parsed.host + parsed.pathname;
  } catch {
    return '[unparseable]';
  }
}

function record(phase, method, url, resourceType) {
  tally.total += 1;
  if (method === 'POST') tally.posts += 1;
  const entry = { phase, method, url: describe(url), resourceType, decision: null, status: null };
  if (ev.requests.length < REQUEST_RECORD_CAP) ev.requests.push(entry);
  else ev.requestsDropped += 1;
  return entry;
}

function isAllowedGet(method, url) {
  if (method !== 'GET') return false;
  if (state.phase === 'sandbox') return url.startsWith('chrome://');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== ORIGIN) return false;
  return parsed.pathname === '/check' || parsed.pathname.startsWith('/_next/static/') || parsed.pathname === '/favicon.ico';
}

async function deny(route, entry) {
  entry.decision = 'aborted';
  tally.aborted += 1;
  await route.abort('blockedbyclient');
}

async function answerApi(route, request, entry) {
  const current = state.current;
  if (!current) return deny(route, entry);
  const postData = request.postData() || '';
  if (current.posted) current.posted({ entry, fixture: postData.includes(ADDRESS) && postData.includes(CITY) });
  await current.released;
  if (current.spec.abort) {
    entry.decision = 'synthetic-failure';
    tally.aborted += 1;
    return route.abort('failed');
  }
  entry.decision = 'fulfilled';
  entry.status = 503;
  tally.fulfilled += 1;
  return route.fulfill({ status: 503, contentType: 'application/json', body: current.spec.body });
}

async function handler(route) {
  const request = route.request();
  const method = request.method();
  const url = request.url();
  routed.add(request);
  const entry = record(state.phase, method, url, request.resourceType());
  if (state.phase === 'control' && method === 'POST') tally.controlPosts += 1;
  try {
    if (method === 'POST' && url === API) return await answerApi(route, request, entry);
    if (isAllowedGet(method, url)) {
      entry.decision = 'continued';
      tally.continued += 1;
      if (method === 'POST') tally.continuedPosts += 1;
      if (method !== 'GET') tally.continuedNonGet += 1;
      return await route.continue();
    }
    return await deny(route, entry);
  } catch (error) {
    if (!state.closing) ev.errors.handlerErrors.push({ url: describe(url), message: String(error && error.message || error) });
  }
}

function within(promise, ms, message) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

async function waitForGate() {
  const file = path.join(OT_OUT, 'gate.json');
  const end = Date.now() + GATE_WAIT_MS;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).go === true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

// Native evidence for the namespace+seccomp gate. The verdict is computed by the
// orchestrator from this text and from /proc, never from launch options.
async function publishSandboxEvidence(page) {
  state.phase = 'sandbox';
  const out = { url: 'chrome://sandbox', text: null, error: null };
  try {
    await page.goto('chrome://sandbox', { waitUntil: 'load' });
    await page.waitForFunction(() => /sandboxed/i.test(document.body.innerText), null, { timeout: 5000 });
    out.text = (await page.evaluate(() => document.body.innerText)).slice(0, 8192);
  } catch (error) {
    out.error = String(error && error.message || error).slice(0, 500);
  }
  writeJson('chrome-sandbox.json', out);
  writeJson('browser-ready.json', { at: new Date().toISOString(), driverPid: process.pid });
}

async function interceptionControl(page) {
  state.phase = 'control';
  const response = await page.goto(CHECK, { waitUntil: 'load' });
  assert(response && response.status() === 200, 'control: /check status ' + (response && response.status()));
  state.current = { spec: { body: JSON.stringify({ error: 'Synthetic control', marker: MARKER }) }, released: Promise.resolve() };
  const result = await page.evaluate(async (api) => {
    try {
      const r = await fetch(api, { method: 'POST', body: JSON.stringify({ synthetic_interception_control: true }) });
      return { status: r.status, body: await r.text() };
    } catch (error) {
      return { fetchError: String(error) };
    }
  }, API);
  state.current = null;
  ev.control = { status: result.status, markerSeen: String(result.body).includes(MARKER), fetchError: result.fetchError || null, posts: tally.controlPosts, fulfilled: tally.fulfilled };
  assert(result.status === 503, 'control: status ' + JSON.stringify(result));
  assert(ev.control.markerSeen, 'control: marker missing');
  assert(tally.controlPosts === 1 && tally.fulfilled === 1, 'control: POST not intercepted exactly once');
  ev.control.ok = true;
}

async function openForm(page, viewport, phase) {
  state.phase = phase;
  await page.setViewportSize(viewport);
  const response = await page.goto(CHECK, { waitUntil: 'load' });
  assert(response && response.status() === 200, phase + ': /check status ' + (response && response.status()));
  const address = page.getByLabel('Street address');
  const addressMode = page.getByRole('button', { name: 'Look up by address' });
  // Clicks before hydration do nothing, so retry until the mode actually flips.
  for (let i = 0; i < 40 && !(await address.isVisible()); i += 1) {
    await addressMode.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await address.waitFor({ state: 'visible' });
  return address;
}

async function runCase(page, context, name, spec, viewport) {
  const result = ev.cases[name];
  result.status = 'failed';
  result.viewport = viewport;
  let release;
  let markPosted;
  const released = new Promise((resolve) => { release = resolve; });
  const posted = new Promise((resolve) => { markPosted = resolve; });
  state.current = { spec, released, posted: markPosted };
  try {
    const address = await openForm(page, viewport, name);
    await address.fill(ADDRESS);
    await page.getByLabel('City (optional)').fill(CITY);
    const popupsBefore = ev.popups.length;
    const postsBefore = tally.posts;
    const submit = page.getByRole('button', { name: 'Check my assessment', exact: true });
    ev.submitAttempted = true;
    await submit.click();

    const { entry, fixture } = await within(posted, 5000, name + ': POST never intercepted');
    assert(fixture, name + ': POST lacks the synthetic fixture');
    const busy = page.getByRole('button', { name: 'Checking…', exact: true });
    await busy.waitFor({ state: 'visible', timeout: 3000 });
    result.busyVisibleBeforeResponse = entry.decision === null;
    result.busyDisabledBeforeResponse = await busy.isDisabled();
    assert(result.busyVisibleBeforeResponse, name + ': response left before busy was observed');
    assert(result.busyDisabledBeforeResponse, name + ': busy button not disabled');
    release();

    const region = page.getByRole(spec.role).filter({ hasText: spec.text }).first();
    await region.waitFor({ state: 'visible' });
    await submit.waitFor({ state: 'visible' });
    result.resetAfterResponse = await submit.isEnabled();
    assert(result.resetAfterResponse, name + ': submit did not reset');
    assert(await busy.count() === 0, name + ': busy label remains');

    const links = region.getByRole('link', { name: /Assessor.s address search/ });
    result.linkCount = await links.count();
    assert(result.linkCount === (spec.link ? 1 : 0), name + ': assessor link count ' + result.linkCount);
    if (spec.link) {
      const link = links.first();
      result.link = { href: await link.getAttribute('href'), target: await link.getAttribute('target'), rel: await link.getAttribute('rel') };
      assert(result.link.href === ASSESSOR, name + ': href ' + result.link.href);
      assert(result.link.target === '_blank', name + ': target ' + result.link.target);
      assert(result.link.rel === 'noopener noreferrer', name + ': rel ' + result.link.rel);
    }
    result.hostileInDom = (await page.content()).includes('assessor.example.invalid');
    assert(!result.hostileInDom, name + ': hostile URL reached the DOM');

    await page.waitForTimeout(150);
    result.posts = tally.posts - postsBefore;
    assert(result.posts === 1, name + ': POST count ' + result.posts);
    assert(page.url() === CHECK, name + ': URL changed');
    assert(ev.popups.length === popupsBefore && context.pages().length === 1, name + ': popup opened');
    const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    result.layout = layout;
    assert(layout.scroll <= layout.client, name + ': horizontal overflow');

    if (spec.shot) {
      const file = path.join(OT_OUT, name + '.png');
      await page.screenshot({ path: file, type: 'png', fullPage: false });
      if (fs.statSync(file).size > SCREENSHOT_CAP) {
        fs.unlinkSync(file);
        ev.limitations.push(name + ': screenshot over cap, dropped');
      } else {
        result.screenshot = path.basename(file);
      }
    }
    result.status = 'pass';
  } catch (error) {
    result.error = String(error && error.message || error).slice(0, 1000);
  } finally {
    release();
    state.current = null;
  }
}

async function run() {
  const context = await chromium.launchPersistentContext(OT_PROFILE, {
    executablePath: OT_CHROME,
    headless: true,
    chromiumSandbox: true,
    serviceWorkers: 'block',
    timeout: 25000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    },
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-sync', '--disk-cache-size=1048576', '--media-cache-size=1048576'],
  });
  try {
    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(10000);
    await context.route('**/*', handler);
    await context.routeWebSocket(/.*/, (socket) => {
      ev.webSockets.push({ phase: state.phase, url: describe(socket.url()), decision: 'closed' });
      socket.close().catch(() => {});
    });
    context.on('request', (request) => seen.add(request));
    context.on('page', (popup) => ev.popups.push({ phase: state.phase, url: describe(popup.url()) }));
    const page = context.pages()[0] || await context.newPage();
    ev.popups.length = 0;
    page.on('pageerror', (error) => ev.errors.pageErrors.push({ phase: state.phase, message: String(error && error.message || error).slice(0, 500) }));
    page.on('requestfailed', (request) => {
      if (ev.errors.requestFailed.length < 100) ev.errors.requestFailed.push({ phase: state.phase, url: describe(request.url()), failure: request.failure() && request.failure().errorText });
    });
    page.on('crash', () => ev.errors.crashes.push({ phase: state.phase }));

    await publishSandboxEvidence(page);
    if (!(await waitForGate())) {
      ev.error = 'orchestrator gate did not release; no UI step ran';
      return;
    }

    await interceptionControl(page);
    for (const [kind, spec] of Object.entries(KINDS)) {
      for (const [label, viewport] of Object.entries(VIEWPORTS)) {
        await runCase(page, context, `${kind}-${label}`, spec, viewport);
      }
    }
    state.phase = 'final';
    assert(Object.values(ev.cases).every((c) => c.status === 'pass'), 'one or more cases failed');
    assert(ev.errors.handlerErrors.length === 0, 'route handler errors');
    assert(ev.errors.crashes.length === 0, 'page crashed');
    ev.ok = true;
  } finally {
    state.closing = true;
    await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]).catch(() => {});
  }
}

function finish(code) {
  try {
    save();
  } catch (error) {
    console.error(error);
    code = 1;
  }
  process.exit(code);
}

const watchdog = setTimeout(() => {
  ev.ok = false;
  ev.error = ev.error || 'watchdog: driver deadline reached';
  finish(1);
}, Number(OT_DEADLINE_MS));

if (require.main === module) {
  run().then(() => {
    clearTimeout(watchdog);
    finish(ev.ok ? 0 : 1);
  }, (error) => {
    clearTimeout(watchdog);
    ev.ok = false;
    ev.error = String(error && error.message || error).slice(0, 2000);
    finish(1);
  });
} else {
  clearTimeout(watchdog);
}
