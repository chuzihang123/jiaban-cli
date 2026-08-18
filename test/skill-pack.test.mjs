import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_MAP = new Map([
  ['web-admin', { role: 'WEB_ADMIN', profile: 'web-admin' }],
  ['manager', { role: 'MANAGER', profile: 'manager' }],
  ['p9', { role: 'SENIOR_ADMIN', profile: 'p9' }],
  ['p8', { role: 'BRANCH_GENERAL_MANAGER', profile: 'p8' }],
  ['p7', { role: 'SENIOR_MANAGER', profile: 'p7' }],
  ['specialist', { role: 'TRUST_SPECIALIST', profile: 'specialist' }],
  ['operations', { role: 'OPERATIONS', profile: 'operations' }],
  ['customer', { role: 'CUSTOMER', profile: 'customer' }],
]);

async function skillFiles() {
  const roles = await readdir(path.join(ROOT, 'skills'), { withFileTypes: true });
  return [path.join(ROOT, 'SKILL.md'), ...roles.filter((item) => item.isDirectory()).map((item) => path.join(ROOT, 'skills', item.name, 'SKILL.md'))];
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'SKILL.md must start with frontmatter');
  return Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const index = line.indexOf(':');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

test('skill pack has one router and exactly eight role skills', async () => {
  const files = await skillFiles();
  assert.equal(files.length, 9);
  assert.deepEqual(new Set(files.slice(1).map((file) => path.basename(path.dirname(file)))), new Set(ROLE_MAP.keys()));
});

test('every SKILL follows description, line-count, and unique-name rules', async () => {
  const names = new Set();
  for (const file of await skillFiles()) {
    const text = await readFile(file, 'utf8');
    assert.ok(text.split(/\r?\n/).length < 100, `${file} must be under 100 lines`);
    const meta = frontmatter(text);
    assert.match(meta.description, /^(Routes|Handles) /, `${file} description must use third person`);
    assert.match(meta.description, /\. Use when /, `${file} description must contain exact Use when`);
    assert.ok(meta.description.length <= 1024);
    assert.ok(meta.name && !names.has(meta.name), `${file} skill name must be unique`);
    names.add(meta.name);
  }
});

test('role skills contain exact activeRole/profile mappings and safety gates', async () => {
  for (const [slug, expected] of ROLE_MAP) {
    const text = await readFile(path.join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`activeRole=${expected.role}`));
    assert.match(text, new RegExp(`--profile ${expected.profile}(?:\\s|\`)`));
    for (const phrase of ['--dry-run', 'current-turn confirmation', '--yes', '--plan-id', '401/403']) {
      assert.ok(text.includes(phrase), `${slug} missing ${phrase}`);
    }
  }
});

test('routing table covers each role once and unique triggers do not overlap', async () => {
  const text = await readFile(path.join(ROOT, 'references', 'role-routing.md'), 'utf8');
  const rows = text.split(/\r?\n/).filter((line) => /^\| (web-admin|manager|p9|p8|p7|specialist|operations|customer) \|/.test(line));
  assert.equal(rows.length, 8);
  const triggers = new Set();
  for (const row of rows) {
    const [, slug, role, profile, triggerCell] = row.split('|').map((item) => item.trim());
    assert.deepEqual({ role, profile }, ROLE_MAP.get(slug));
    for (const trigger of triggerCell.split('、')) {
      assert.ok(!triggers.has(trigger), `duplicate trigger: ${trigger}`);
      triggers.add(trigger);
    }
  }
  for (const ambiguous of ['“管理员”', '“总经理”', '“高级经理”']) assert.ok(text.includes(ambiguous));
  for (const forbidden of ['CUSTOMER_MANAGER', 'P6_MANAGER', 'PRODUCT_MANAGER']) assert.ok(text.includes(`禁止使用 \`${forbidden}\``));
});

test('role skills enforce real endpoint families and fixed senior-command eligibility', async () => {
  const readRole = (slug) => readFile(path.join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');
  const contract = await readFile(path.join(ROOT, 'references', 'cli-contract.md'), 'utf8');
  for (const role of ['WEB_ADMIN', 'P9 SENIOR_ADMIN', 'P8 BRANCH_GENERAL_MANAGER', 'P7 SENIOR_MANAGER']) assert.ok(contract.includes(role));
  assert.match(contract, /Only WEB_ADMIN, P9 SENIOR_ADMIN, P8 BRANCH_GENERAL_MANAGER, and P7 SENIOR_MANAGER may use them/);

  for (const slug of ['web-admin', 'manager', 'specialist', 'operations', 'customer']) {
    const text = await readRole(slug);
    assert.doesNotMatch(text, /jiaban --profile \S+ (?:customer get|contract list|contract status)/, `${slug} must not recommend senior fixed commands`);
  }

  const manager = await readRole('manager');
  for (const endpoint of ['/api/manager/customers/<confirmed-id>', '/api/manager/customers/<confirmed-id>/contract-flows', '/api/manager/contract-flows/<confirmed-id>']) assert.ok(manager.includes(endpoint));

  const specialist = await readRole('specialist');
  assert.ok(specialist.includes('/api/specialist/contract-flows'));
  assert.ok(specialist.includes('/api/specialist/contract-flows/<confirmed-id>'));
  assert.match(specialist, /create, review, return for customer re-signing, and archive/);
  assert.doesNotMatch(specialist, /specialist signs|signs for the customer|信托专员.{0,8}签署/i);

  const customer = await readRole('customer');
  assert.ok(customer.includes('/api/mobile/customer/**'));
  assert.ok(customer.includes('Customer signing is routed only here'));
});

test('role permission language does not overstate P9, P8, P7, or specialist authority', async () => {
  const p9 = await readFile(path.join(ROOT, 'skills', 'p9', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(p9, /global|全局/i);
  assert.match(p9, /backend-authorized management chain/);
  for (const slug of ['p8', 'p7']) {
    const text = await readFile(path.join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /approval|approve|审批|review|审核/i, `${slug} must not claim approval authority`);
    assert.match(text, /authorized subordinate tree/);
    assert.match(text, /configures or transfers/);
  }
  const routing = await readFile(path.join(ROOT, 'references', 'role-routing.md'), 'utf8');
  assert.doesNotMatch(routing.split(/\r?\n/).find((line) => line.startsWith('| p9 |')), /global|全局/i);
  assert.match(routing, /客户签署/);
});

test('all local links resolve and references are one level with no reference chaining', async () => {
  for (const file of await skillFiles()) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      await access(path.resolve(path.dirname(file), match[1]));
    }
  }
  const referenceFiles = await readdir(path.join(ROOT, 'references'));
  assert.deepEqual(new Set(referenceFiles), new Set(['role-routing.md', 'cli-contract.md', 'safety-policy.md']));
  for (const name of referenceFiles) {
    const text = await readFile(path.join(ROOT, 'references', name), 'utf8');
    assert.doesNotMatch(text, /\[[^\]]+\]\([^)]+\)/, `${name} must not chain references`);
  }
});

test('skills contain no credential payloads, profile provisioning, or implicit-profile commands', async () => {
  for (const file of await skillFiles()) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /profile save|JIABAN_SESSION_TOKEN\s*=|JIABAN_INTEGRATION_PASSWORD\s*=|1[3-9]\d{9}/i);
    for (const line of text.split(/\r?\n/).filter((item) => item.includes('jiaban '))) {
      assert.match(line, /jiaban --profile (?:<fixed-profile>|web-admin|manager|p9|p8|p7|specialist|operations|customer) /);
    }
  }
  const scriptFiles = await readdir(path.join(ROOT, 'skills'), { recursive: true });
  assert.equal(scriptFiles.some((name) => /\.(mjs|cjs|js)$/.test(name)), false);
});

test('package allowlist includes shared CLI and the complete skill pack', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.3.1-internal.1');
  assert.equal(pkg.private, true);
  for (const entry of ['bin', 'src', 'skills', 'references', 'internal-test-profile.json', 'README.md', 'SKILL.md']) assert.ok(pkg.files.includes(entry));
  assert.equal(pkg.dependencies, undefined);
});

test('source tree carries only a safe bundled-profile example and ignores the runtime secret file', async () => {
  const ignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^internal-test-profile\.json$/m);
  const example = await readFile(path.join(ROOT, 'internal-test-profile.example.json'), 'utf8');
  assert.doesNotMatch(example, /1[3-9]\d{9}/);
  assert.match(example, /REPLACE_IN_PRIVATE_BUILD/);
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('internal-test-profile.json'));
  assert.equal(pkg.files.includes('internal-test-profile.example.json'), false);
});
