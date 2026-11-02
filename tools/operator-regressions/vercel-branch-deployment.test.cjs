'use strict';

// Standalone operator regression: node --test tools/operator-regressions/vercel-branch-deployment.test.cjs
// Local contract check of vercel.json only; it does not simulate Vercel or prove hosted deployment suppression.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'vercel.json');
const BRANCH = 'feat/ot-factual-saved-analysis-integration-20261030';

// Exact baseline vercel.json at 877eb8e79d9c14e3e87b2207d2c92f3f346e7341.
const BASELINE_TEXT = `{
  "crons": [
    {"path":"/api/cron/informational-deadlines","schedule":"5 * * * *"},
    {"path":"/api/cron/township-alerts","schedule":"30 8 * * *"},
    {"path":"/api/cron/free-check-followups","schedule":"15 14 * * *"},
    {"path":"/api/cron/township-open-notifications","schedule":"0 10 * * *"},
    {"path":"/api/cron/deadline-reminders","schedule":"0 9 * * *"},
    {"path":"/api/cron/assessment-checks","schedule":"0 7 * * 1"},
    {"path":"/api/cron/performance-invoices","schedule":"0 8 * * 1"},
    {"path":"/api/cron/invoice-collections","schedule":"0 9 * * *"},
    {"path":"/api/cron/neutral-checkout-reconciliation","schedule":"*/30 * * * *"},
    {"path":"/api/cron/neutral-report-production","schedule":"*/10 * * * *"}
  ]
}
`;
const BASELINE = JSON.parse(BASELINE_TEXT);
const PRESERVED_PREFIX = BASELINE_TEXT.slice(0, BASELINE_TEXT.lastIndexOf(']') + 1);

const VALID_CONTROL_TEXT = PRESERVED_PREFIX +
  ',\n  "git": {\n    "deploymentEnabled": {\n      "' + BRANCH + '": false\n    }\n  }\n}\n';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateText(text) {
  assert.ok(text.startsWith(PRESERVED_PREFIX), 'existing text through the crons array must be preserved byte-for-byte');
}

function validateConfig(config) {
  assert.ok(isPlainObject(config), 'config must be a JSON object');
  assert.ok(Object.hasOwn(config, 'git'), 'git block is required');
  assert.deepEqual(
    Object.keys(config).sort(),
    [...Object.keys(BASELINE), 'git'].sort(),
    'top-level keys must be exactly the baseline keys plus git'
  );
  for (const key of Object.keys(BASELINE)) {
    assert.deepEqual(config[key], BASELINE[key], `baseline key "${key}" must be unchanged`);
  }

  const { git } = config;
  assert.ok(isPlainObject(git), 'git must be an object');
  assert.deepEqual(Object.keys(git), ['deploymentEnabled'], 'git must contain only deploymentEnabled');

  const mapping = git.deploymentEnabled;
  assert.ok(isPlainObject(mapping), 'deploymentEnabled must be a branch mapping object, not a global boolean');
  assert.deepEqual(Object.keys(mapping), [BRANCH], 'deploymentEnabled must contain exactly the one target branch entry');
  assert.ok(mapping[BRANCH] === false, 'target branch must map to boolean false');
}

function validControl() {
  return { ...structuredClone(BASELINE), git: { deploymentEnabled: { [BRANCH]: false } } };
}

test('actual vercel.json satisfies the branch deployment contract', () => {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  validateText(text);
  validateConfig(JSON.parse(text));
});

test('valid control is accepted', () => {
  assert.equal(BASELINE.crons.length, 10);
  validateText(VALID_CONTROL_TEXT);
  validateConfig(JSON.parse(VALID_CONTROL_TEXT));
  validateConfig(validControl());
});

test('rejects the unchanged baseline fixture', () => {
  validateText(BASELINE_TEXT);
  assert.throws(() => validateConfig(structuredClone(BASELINE)), /git block is required/);
});

const NEGATIVE_CASES = [
  ['missing git', (c) => { delete c.git; }, /git block is required/],
  ['global false', (c) => { c.git.deploymentEnabled = false; }, /not a global boolean/],
  ['target true', (c) => { c.git.deploymentEnabled[BRANCH] = true; }, /must map to boolean false/],
  ['target string "false"', (c) => { c.git.deploymentEnabled[BRANCH] = 'false'; }, /must map to boolean false/],
  ['wildcard false instead of literal', (c) => { c.git.deploymentEnabled = { 'feat/*': false }; }, /exactly the one target branch entry/],
  ['overlapping wildcard true', (c) => { c.git.deploymentEnabled['feat/*'] = true; }, /exactly the one target branch entry/],
  ['unrelated branch setting', (c) => { c.git.deploymentEnabled.main = false; }, /exactly the one target branch entry/],
  ['github deployment-record flag', (c) => { c.github = { enabled: false }; }, /top-level keys/],
  ['extra git setting', (c) => { c.git.deploymentEnabledDefault = false; }, /only deploymentEnabled/],
  ['cron schedule mutation', (c) => { c.crons[0].schedule = '0 * * * *'; }, /"crons" must be unchanged/],
  ['cron removal', (c) => { c.crons.pop(); }, /"crons" must be unchanged/],
];

for (const [name, mutate, reason] of NEGATIVE_CASES) {
  test(`rejects ${name}`, () => {
    const config = validControl();
    validateConfig(config); // control is valid before mutation, so rejection is due to the mutation
    mutate(config);
    assert.throws(() => validateConfig(config), reason);
  });
}

test('rejects semantically equal but reformatted cron text', () => {
  const mutated = VALID_CONTROL_TEXT.replace(
    '{"path":"/api/cron/township-alerts"',
    '{ "path": "/api/cron/township-alerts"'
  );
  assert.notEqual(mutated, VALID_CONTROL_TEXT);
  validateConfig(JSON.parse(mutated));
  assert.throws(() => validateText(mutated), /byte-for-byte/);
});
