'use strict';
// Synthetic browser driver for /check. Started by ot-linux-qa.py inside the
// namespace, never directly. Browser proof only: POST /api/free-check is answered
// here and never reaches the backend.
const crypto = require('crypto');
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
// The quiet window is Playwright's own idle window (frames.js _startNetworkIdleTimer).
const SETTLE_QUIET_MS = 500;
const SETTLE_TIMEOUT_MS = 5000;
const SETTLE_POLL_MS = 25;
// Fixed proof files, read back by ot-linux-qa.py. Diagnostic only: nothing here
// reconciles a request, and the seen/routed object oracle stays the only count.
const PROOF_SCHEMA = 1;
const PROOF_BYTE_CAP = 65536;
const UNMATCHED_RECORD_CAP = 40;
const UNKNOWN_RECORD_CAP = 8;
const RELATED_RECORD_CAP = 24;
const LIFE_CAP = 8;
const DRAIN_MS = 250;
const HASH_CHARS = 24;
const READABLE_PATH = /^\/(?:check|favicon\.ico|api\/free-check|_next\/static\/[A-Za-z0-9._~/-]{1,160})$/;
const FAILURE_KINDS = new Map([
  ['net::ERR_ABORTED', 'aborted'],
  ['net::ERR_BLOCKED_BY_CLIENT', 'blocked_by_client'],
  ['net::ERR_FAILED', 'failed'],
  ['net::ERR_CONNECTION_REFUSED', 'connection_refused'],
  ['net::ERR_CONNECTION_RESET', 'connection_reset'],
  ['net::ERR_TIMED_OUT', 'timed_out'],
  ['net::ERR_NAME_NOT_RESOLVED', 'name_not_resolved'],
  ['net::ERR_ADDRESS_UNREACHABLE', 'address_unreachable'],
  ['net::ERR_INTERNET_DISCONNECTED', 'internet_disconnected'],
]);

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
// Keyed by the Request object itself: two requests for one URL are two records.
const ledger = new Map();
const accounting = {
  order: 0,
  lateEvents: 0,
  lifeDropped: 0,
  callbackErrors: {},
  snapshots: { atClose: null, afterClose: null, afterDrain: null },
  close: 'notrun',
  failure: null,
};

function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
}

function writeText(name, text) {
  const file = path.join(OT_OUT, name);
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
}

function writeJson(name, value) {
  writeText(name, JSON.stringify(value, null, 2));
}

// A throwing listener must surface as a counted failure, not as a lost event.
function guard(name, callback) {
  try {
    return callback();
  } catch {
    accounting.callbackErrors[name] = (accounting.callbackErrors[name] || 0) + 1;
    return undefined;
  }
}

function digest(text) {
  return 'sha256:' + crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, HASH_CHARS);
}

function safeQuery(search) {
  // Key names only. A part with no `=` may be a bare value, so it is never readable.
  if (!search) return null;
  const pairs = search.slice(1).split('&');
  const keys = pairs.map((pair) => pair.split('=')[0]);
  const readable = pairs.length <= 8 && keys.join(',').length <= 64
    && pairs.every((pair, index) => pair.includes('=') && /^[A-Za-z0-9_-]{1,24}$/.test(keys[index]));
  return readable ? keys.join(',') : digest(keys.join('&'));
}

function safeUrl(url) {
  // Reads origin, host, pathname and key names only: never userinfo, values or a fragment.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url: 'unparseable:' + digest(url), query: null };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    const scheme = /^[a-z][a-z0-9+.-]{0,15}:$/.test(parsed.protocol) ? parsed.protocol : 'other:';
    return { url: scheme + digest(parsed.host + parsed.pathname), query: null };
  }
  const query = safeQuery(parsed.search);
  const route = parsed.pathname;
  if (parsed.origin === ORIGIN) return { url: READABLE_PATH.test(route) ? route : 'same-origin:' + digest(route), query };
  const host = /^[A-Za-z0-9.:[\]-]{1,100}$/.test(parsed.host) ? parsed.host : digest(parsed.host);
  return { url: parsed.protocol + '//' + host + '/' + digest(route), query };
}

function safeFailure(text) {
  return FAILURE_KINDS.get(text) || 'other';
}

function safeErrorKind(error) {
  const message = String(error && error.message || error);
  if (error && error.name === 'TimeoutError') return 'timeout';
  if (message.startsWith('ASSERTION FAILED')) return 'assertion';
  return /closed/i.test(message) ? 'closed' : 'other';
}

function expectedOnly(value, wanted) {
  // A DOM attribute is saved only when it is the value the contract names.
  return value === wanted ? value : 'unexpected';
}

function recordFor(request) {
  let item = ledger.get(request);
  if (!item) {
    const { url, query } = safeUrl(request.url());
    const method = request.method();
    const resourceType = request.resourceType();
    item = {
      id: ledger.size + 1,
      phase: state.phase,
      method: /^[A-Z]{1,16}$/.test(method) ? method : 'OTHER',
      url,
      query,
      resourceType: /^[a-z]{1,16}$/.test(resourceType) ? resourceType : 'other',
      seen: false,
      handlerSeen: false,
      entry: null,
      redirectedFrom: null,
      redirectedTo: null,
      status: null,
      finished: false,
      failed: false,
      canceled: false,
      failure: null,
      closing: false,
      life: [],
    };
    ledger.set(request, item);
  }
  return item;
}

function linkRedirects(request, item) {
  const from = request.redirectedFrom();
  const to = request.redirectedTo();
  if (from) {
    const precursor = recordFor(from);
    item.redirectedFrom = precursor.id;
    precursor.redirectedTo = item.id;
  }
  if (to) {
    const successor = recordFor(to);
    item.redirectedTo = successor.id;
    successor.redirectedFrom = item.id;
  }
}

function note(request, event) {
  const item = recordFor(request);
  accounting.order += 1;
  if (state.closing) {
    item.closing = true;
    accounting.lateEvents += 1;
  }
  if (item.life.length < LIFE_CAP) item.life.push(`${event}@${accounting.order}${state.closing ? ':closing' : ''}`);
  else accounting.lifeDropped += 1;
  linkRedirects(request, item);
  return item;
}

function observe(context) {
  context.on('request', (request) => guard('request', () => {
    seen.add(request);
    recordFor(request).seen = true;
    note(request, 'seen');
  }));
  context.on('response', (response) => guard('response', () => {
    const status = response.status();
    const item = note(response.request(), 'response');
    item.status = Number.isInteger(status) && status >= 0 && status <= 999 ? status : null;
  }));
  context.on('requestfinished', (request) => guard('requestfinished', () => {
    note(request, 'finished').finished = true;
  }));
  context.on('requestfailed', (request) => guard('requestfailed', () => {
    const item = note(request, 'failed');
    const failure = request.failure();
    item.failed = true;
    item.failure = safeFailure(failure && failure.errorText);
    item.canceled = item.failure === 'aborted';
  }));
}

function unroutedRequests() {
  return [...seen].filter((q) => /^https?:/.test(q.url()) && !routed.has(q));
}

function snapshot(name) {
  guard('snapshot', () => {
    const pending = [...ledger.values()].filter((item) => item.seen && !item.finished && !item.failed);
    accounting.snapshots[name] = { seen: seen.size, routed: routed.size, unrouted: unroutedRequests().length, pending: pending.length };
  });
}

function publicRecord({ entry, life, ...fields }) {
  return { ...fields, decision: entry ? entry.decision : null, life: life.join(' ') };
}

function redirectPeers(items) {
  // Every hop of an unmatched record's chain, so its IDs resolve inside the proof.
  const byId = new Map([...ledger.values()].map((item) => [item.id, item]));
  const listed = new Set(items.map((item) => item.id));
  const peers = [];
  const queue = [...items];
  while (queue.length) {
    const item = queue.pop();
    for (const id of [item.redirectedFrom, item.redirectedTo]) {
      if (id && !listed.has(id)) {
        listed.add(id);
        peers.push(byId.get(id));
        queue.push(byId.get(id));
      }
    }
  }
  return peers.sort((a, b) => a.id - b.id);
}

function accountingProof(unmatched) {
  for (const request of seen) guard('link', () => linkRedirects(request, recordFor(request)));
  const items = unmatched.map((request) => ledger.get(request)).filter(Boolean);
  const kept = items.slice(0, UNMATCHED_RECORD_CAP);
  const unknown = [...ledger.values()].filter((item) => !item.seen);
  const keptUnknown = unknown.slice(0, UNKNOWN_RECORD_CAP);
  const related = redirectPeers([...items, ...unknown]);
  const keptRelated = related.slice(0, RELATED_RECORD_CAP);
  return {
    kind: 'BROWSER REQUEST ACCOUNTING diagnostic; reconciles nothing',
    schema: PROOF_SCHEMA,
    counts: {
      seen: seen.size,
      routed: routed.size,
      records: ledger.size,
      unrouted: unmatched.length,
      unknown: unknown.length,
      related: related.length,
      lateEvents: accounting.lateEvents,
      callbackErrors: Object.values(accounting.callbackErrors).reduce((sum, count) => sum + count, 0),
      unmatchedDropped: unmatched.length - kept.length,
      unknownDropped: unknown.length - keptUnknown.length,
      relatedDropped: related.length - keptRelated.length,
      lifeDropped: accounting.lifeDropped,
      requestsDropped: ev.requestsDropped,
    },
    callbackErrorsBy: accounting.callbackErrors,
    snapshots: accounting.snapshots,
    unmatched: kept.map(publicRecord),
    unknown: keptUnknown.map(publicRecord),
    related: keptRelated.map(publicRecord),
  };
}

function summaryProof() {
  const cases = {};
  for (const [name, result] of Object.entries(ev.cases)) {
    cases[name] = { status: result.status, failureKind: result.failureKind || null, posts: result.posts ?? null, linkCount: result.linkCount ?? null };
  }
  const control = ev.control && {
    ok: ev.control.ok === true,
    status: Number.isInteger(ev.control.status) ? ev.control.status : null,
    markerSeen: ev.control.markerSeen === true,
    posts: ev.control.posts,
    fulfilled: ev.control.fulfilled,
    fetchFailed: ev.control.fetchError !== null,
  };
  return {
    kind: 'BROWSER RUN SUMMARY diagnostic; never a verdict',
    schema: PROOF_SCHEMA,
    cases,
    control,
    ok: ev.ok,
    submitAttempted: ev.submitAttempted,
    failure: accounting.failure || (ev.ok ? null : { phase: state.phase, kind: 'unknown' }),
    cleanup: { closing: state.closing, close: accounting.close },
    counts: ev.counts,
  };
}

function fitProof(doc, cap = PROOF_BYTE_CAP) {
  // Whatever cannot fit is counted, and a count above zero fails the run.
  let text = JSON.stringify(doc, null, 1);
  for (const [list, dropped] of [['related', 'relatedDropped'], ['unknown', 'unknownDropped'], ['unmatched', 'unmatchedDropped']]) {
    while (doc[list] && doc[list].length && Buffer.byteLength(text) >= cap) {
      doc[list].pop();
      doc.counts[dropped] += 1;
      text = JSON.stringify(doc, null, 1);
    }
  }
  assert(Buffer.byteLength(text) < cap, 'proof over its byte cap');
  return text;
}

function save() {
  ev.finishedAt = new Date().toISOString();
  const unmatched = unroutedRequests();
  ev.counts = {
    ...tally,
    unrouted: unmatched.length,
    pageErrors: ev.errors.pageErrors.length,
    popups: ev.popups.length,
    observedWebSockets: ev.webSockets.length,
  };
  writeJson('browser-evidence.json', ev);
  writeText('browser-accounting.json', fitProof(accountingProof(unmatched)));
  writeText('browser-summary.json', fitProof(summaryProof()));
}

function describe(url) {
  // The proof's own URL form, so the evidence holds no external path or unknown route.
  return safeUrl(url).url;
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
  guard('handler', () => {
    const item = note(request, 'handler');
    item.handlerSeen = true;
    item.entry = entry;
    entry.id = item.id;
  });
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
    if (!state.closing) ev.errors.handlerErrors.push({ url: describe(url), kind: safeErrorKind(error) });
  }
}

function within(promise, ms, message) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

function inFlight() {
  // This phase only: an older record may never finish, and chrome:// is outside the oracle.
  return [...ledger].some(([request, item]) => item.seen && !item.finished && !item.failed
    && item.phase === state.phase && /^https?:/.test(request.url()));
}

// A navigation that beats a request's Fetch pause cancels it unrouted, so the
// transitions wait here first. This only delays them: a canceled request is still
// seen without a route and still fails the oracle. networkidle cannot do this
// wait: once a document has fired it the client returns at once (frame.js
// waitForLoadState), and a request only counts after its pause pairs it
// (crNetworkManager.js _onRequest). A quiet window outlasts that pairing.
async function settleNetwork() {
  const end = Date.now() + SETTLE_TIMEOUT_MS;
  let order = -1;
  let quietSince = 0;
  for (;;) {
    const now = Date.now();
    if (order !== accounting.order || inFlight()) {
      order = accounting.order;
      quietSince = now;
    } else if (now - quietSince >= SETTLE_QUIET_MS) {
      return;
    }
    if (now >= end) throw Object.assign(new Error('network did not settle'), { name: 'TimeoutError' });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

// Two frames, so the observers for the new layout have run before the wait starts.
async function renderedFrame(page) {
  await within(page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })), SETTLE_TIMEOUT_MS, 'no frame after resize');
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
    out.error = safeErrorKind(error);
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
  ev.control = { status: result.status, markerSeen: String(result.body).includes(MARKER), fetchError: result.fetchError ? 'failed' : null, posts: tally.controlPosts, fulfilled: tally.fulfilled };
  assert(result.status === 503, 'control: status ' + JSON.stringify(result));
  assert(ev.control.markerSeen, 'control: marker missing');
  assert(tally.controlPosts === 1 && tally.fulfilled === 1, 'control: POST not intercepted exactly once');
  ev.control.ok = true;
}

async function openForm(page, viewport, phase) {
  // Before the phase changes, so what is left of the last case stays in its phase.
  await settleNetwork();
  state.phase = phase;
  await page.setViewportSize(viewport);
  // A new layout can reveal links, and their prefetches race the goto below.
  await renderedFrame(page);
  await settleNetwork();
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
      result.link = {
        href: expectedOnly(await link.getAttribute('href'), ASSESSOR),
        target: expectedOnly(await link.getAttribute('target'), '_blank'),
        rel: expectedOnly(await link.getAttribute('rel'), 'noopener noreferrer'),
      };
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
    result.error = safeErrorKind(error);
    result.failureKind = result.error;
  } finally {
    release();
    state.current = null;
  }
}

// Snapshots bracket the close, and the drain only runs after it, so waiting for
// late events cannot change what the browser did before the context closed.
async function closeContext(context) {
  state.closing = true;
  snapshot('atClose');
  accounting.close = await Promise.race([
    context.close().then(() => 'closed', () => 'error'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000).unref()),
  ]);
  snapshot('afterClose');
  await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
  snapshot('afterDrain');
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
    await context.routeWebSocket(/.*/, (socket) => guard('websocket', () => {
      ev.webSockets.push({ phase: state.phase, url: describe(socket.url()), decision: 'closed' });
      socket.close().catch(() => {});
    }));
    observe(context);
    context.on('page', (popup) => guard('page', () => ev.popups.push({ phase: state.phase, url: describe(popup.url()) })));
    const page = context.pages()[0] || await context.newPage();
    ev.popups.length = 0;
    page.on('pageerror', (error) => guard('pageerror', () => ev.errors.pageErrors.push({ phase: state.phase, kind: safeErrorKind(error) })));
    page.on('requestfailed', (request) => guard('page-requestfailed', () => {
      if (ev.errors.requestFailed.length < 100) ev.errors.requestFailed.push({ phase: state.phase, url: describe(request.url()), failure: request.failure() && safeFailure(request.failure().errorText) });
    }));
    page.on('crash', () => guard('crash', () => ev.errors.crashes.push({ phase: state.phase })));

    await publishSandboxEvidence(page);
    if (!(await waitForGate())) {
      ev.error = 'orchestrator gate did not release; no UI step ran';
      accounting.failure = { phase: state.phase, kind: 'gate' };
      return;
    }

    await interceptionControl(page);
    for (const [kind, spec] of Object.entries(KINDS)) {
      for (const [label, viewport] of Object.entries(VIEWPORTS)) {
        await runCase(page, context, `${kind}-${label}`, spec, viewport);
      }
    }
    await settleNetwork();
    state.phase = 'final';
    assert(Object.values(ev.cases).every((c) => c.status === 'pass'), 'one or more cases failed');
    assert(ev.errors.handlerErrors.length === 0, 'route handler errors');
    assert(ev.errors.crashes.length === 0, 'page crashed');
    ev.ok = true;
  } finally {
    await closeContext(context);
  }
}

function finish(code) {
  try {
    save();
  } catch (error) {
    console.error('browser proof save failed: ' + safeErrorKind(error));
    code = 1;
  }
  process.exit(code);
}

const watchdog = setTimeout(() => {
  ev.ok = false;
  ev.error = ev.error || 'watchdog: driver deadline reached';
  accounting.failure = accounting.failure || { phase: state.phase, kind: 'watchdog' };
  finish(1);
}, Number(OT_DEADLINE_MS));

if (require.main === module) {
  run().then(() => {
    clearTimeout(watchdog);
    finish(ev.ok ? 0 : 1);
  }, (error) => {
    clearTimeout(watchdog);
    ev.ok = false;
    ev.error = safeErrorKind(error);
    accounting.failure = accounting.failure || { phase: state.phase, kind: safeErrorKind(error) };
    finish(1);
  });
} else {
  clearTimeout(watchdog);
}
