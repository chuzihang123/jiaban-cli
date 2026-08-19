import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseApiRequestArgs } from '../src/generic-api.mjs';

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
    for (const phrase of ['operations.md', 'dialog-state.md', 'error-policy.md', 'current-turn confirmation', '--plan-id', '401/403']) {
      assert.ok(text.includes(phrase), `${slug} missing ${phrase}`);
    }
    assert.doesNotMatch(text, /<confirmed-path>/, `${slug} must route through its operation index`);
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

test('role operation indexes enforce endpoint families and fixed senior-command eligibility', async () => {
  const readRole = (slug) => readFile(path.join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');
  const contract = await readFile(path.join(ROOT, 'references', 'cli-contract.md'), 'utf8');
  for (const role of ['WEB_ADMIN', 'P9 SENIOR_ADMIN', 'P8 BRANCH_GENERAL_MANAGER', 'P7 SENIOR_MANAGER']) assert.ok(contract.includes(role));
  assert.match(contract, /Only WEB_ADMIN, P9 SENIOR_ADMIN, P8 BRANCH_GENERAL_MANAGER, and P7 SENIOR_MANAGER may use them/);

  for (const slug of ['web-admin', 'manager', 'specialist', 'operations', 'customer']) {
    const text = await readRole(slug);
    assert.doesNotMatch(text, /jiaban --profile \S+ (?:customer get|contract list|contract status)/, `${slug} must not recommend senior fixed commands`);
  }

  const manager = await readFile(path.join(ROOT, 'skills', 'manager', 'operations.md'), 'utf8');
  for (const endpoint of ['/api/manager/customers/{id}', '/api/manager/customers/{customerId}/contract-flows', '/api/manager/contract-flows/{id}']) assert.ok(manager.includes(endpoint));

  const specialist = await readFile(path.join(ROOT, 'skills', 'specialist', 'operations.md'), 'utf8');
  assert.ok(specialist.includes('/api/specialist/contract-flows'));
  assert.ok(specialist.includes('return-sign'));
  assert.match(specialist, /专员不代签/);

  const customer = await readFile(path.join(ROOT, 'skills', 'customer', 'operations.md'), 'utf8');
  assert.ok(customer.includes('/api/mobile/customer/'));
  assert.ok(customer.includes('customer.contract.sign-name'));
});

test('role permission language does not overstate P9, P8, P7, or specialist authority', async () => {
  const p9 = await readFile(path.join(ROOT, 'skills', 'p9', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(p9, /global|全局/i);
  assert.match(p9, /backend-authorized management chain/);
  for (const slug of ['p8', 'p7']) {
    const text = await readFile(path.join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');
    const operations = await readFile(path.join(ROOT, 'skills', slug, 'operations.md'), 'utf8');
    const operationIds = operations.split(/\r?\n/).filter((line) => line.startsWith('| `')).map((line) => line.split('|')[1]);
    assert.equal(operationIds.some((id) => /(?:\.approve|\.review(?:\.|`)|审批|审核)/i.test(id)), false, `${slug} must not index approval authority`);
    assert.match(text, /do not improvise an unindexed approval/);
    assert.match(text, /authorized subordinate tree/);
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
  assert.deepEqual(new Set(referenceFiles), new Set(['role-routing.md', 'operation-index.md', 'dialog-state.md', 'error-policy.md', 'cli-contract.md', 'safety-policy.md']));
  for (const name of referenceFiles) {
    const text = await readFile(path.join(ROOT, 'references', name), 'utf8');
    assert.doesNotMatch(text, /\[[^\]]+\]\([^)]+\)/, `${name} must not chain references`);
  }
});

test('each role has a lazy-loaded operation index with structured ids and required inputs', async () => {
  for (const slug of ROLE_MAP.keys()) {
    const manualPath = path.join(ROOT, 'skills', slug, 'operations.md');
    await access(manualPath);
    const text = await readFile(manualPath, 'utf8');
    assert.match(text, /operationId/);
    assert.match(text, /必填输入/);
    assert.match(text, /\| `(?:admin|manager|p9|p8|p7|senior|specialist|operations|customer)\.[a-z0-9.-]+` \|/);
    assert.doesNotMatch(text, /<confirmed-path>/);
  }
  const admin = await readFile(path.join(ROOT, 'skills', 'web-admin', 'operations.md'), 'utf8');
  assert.match(admin, /`admin\.user\.create`[\s\S]*`phone,displayName,roleCode,companyId,departmentId`/);
  assert.match(admin, /`admin\.user\.create-p9`[\s\S]*`phone,displayName,companyId,departmentId`/);
  assert.match(admin, /缺任一ID都必须追问/);
  assert.match(admin, /UserRequest[\s\S]*不得附加 `companyId`/);
  const dialog = await readFile(path.join(ROOT, 'references', 'dialog-state.md'), 'utf8');
  assert.match(dialog, /创建任何内部用户[\s\S]*`companyId` 与 `departmentId`/);
  assert.match(dialog, /最终 `UserRequest` JSON 不包含该字段/);
});

test('every indexed operation has one exact route format and every R3/R4 route is CLI-enforced', async () => {
  for (const slug of ROLE_MAP.keys()) {
    const text = await readFile(path.join(ROOT, 'skills', slug, 'operations.md'), 'utf8');
    for (const line of text.split(/\r?\n/).filter((item) => item.startsWith('| `'))) {
      const id = line.match(/^\| `([^`]+)`/)?.[1];
      if (id === 'admin.init') continue;
      assert.equal((line.match(/\/api\//g) ?? []).length, 1, `${id} must contain exactly one full API path`);
      assert.doesNotMatch(line, /\.\.\.|\/\*\*|PUT或POST/, `${id} contains a non-deterministic route`);
      const route = line.match(/\b(GET|HEAD|POST|PUT|PATCH|DELETE) `([^`]+)`/);
      assert.ok(route, `${id} must contain one method and path`);
      const risk = line.match(/\b(R[0-4])\b/)?.[1];
      assert.ok(risk, `${id} must declare a risk level`);
      const apiPath = route[2].replace(/\{[^}]+\}/g, '1');
      const parsed = parseApiRequestArgs([route[1], apiPath, '--dry-run', '--reason', 'skill-index-check']);
      if (['R3', 'R4'].includes(risk)) assert.equal(parsed.highRisk, true, `${id} must produce a plan`);
      else assert.equal(parsed.highRisk, false, `${id} must not be escalated beyond its indexed risk`);
    }
  }
});

test('dialog and error indexes forbid guessing and write replay', async () => {
  const dialog = await readFile(path.join(ROOT, 'references', 'dialog-state.md'), 'utf8');
  const errors = await readFile(path.join(ROOT, 'references', 'error-policy.md'), 'utf8');
  assert.match(dialog, /禁止用列表接口枚举、猜测/);
  assert.match(dialog, /OUTCOME_UNKNOWN/);
  assert.match(errors, /写请求 `TIMEOUT`, `NETWORK_ERROR`/);
  assert.match(errors, /禁止重放/);
});

test('agent derives a deterministic operation reason without asking the user', async () => {
  const relativeFiles = [
    'SKILL.md',
    'README.md',
    'references/dialog-state.md',
    'references/safety-policy.md',
    'references/cli-contract.md',
    ...[...ROLE_MAP.keys()].map((slug) => `skills/${slug}/operations.md`),
  ];
  const corpus = await Promise.all(relativeFiles.map((name) => readFile(path.join(ROOT, name), 'utf8')));
  for (const [index, text] of corpus.entries()) {
    assert.ok(text.includes('internal-test:<operationId>'), `${relativeFiles[index]} missing deterministic reason format`);
  }

  const rules = corpus.join('\n');
  assert.match(rules, /dry-run[^\n]*(?:同一|相同|identical)[^\n]*(?:reason|Reason)|reason[^\n]*(?:同一|相同|identical)[^\n]*dry-run/i);
  assert.match(rules, /当前回合确认|current-turn confirmation/);
  assert.match(rules, /禁止包含姓名、手机号[^\n]*自由文本[^\n]*凭据|must contain no name, phone number[^\n]*free text[^\n]*credential/i);
  const positiveReasonPrompts = rules.split(/\r?\n/).filter((line) =>
    !/(?:不再|不得|不要|禁止|never)/i.test(line)
    && /(?:请(?:用户)?提供|向用户(?:询问|索取))[^\n]*(?:--reason|reason|工单)/i.test(line)
  );
  assert.deepEqual(positiveReasonPrompts, []);
});

test('CLI contract forbids every body mode on GET and HEAD', async () => {
  const contract = await readFile(path.join(ROOT, 'references', 'cli-contract.md'), 'utf8');
  assert.match(contract, /GET and HEAD never have a request body/);
  for (const flag of ['--json-stdin', '--json-file', '--body-file', '--content-type', '--multipart', '--form', '--upload', '--json-part']) {
    assert.ok(contract.includes(`\`${flag}\``), `GET/HEAD contract missing ${flag}`);
  }
  for (const method of ['GET', 'HEAD']) {
    for (const args of [['--json-stdin'], ['--json-file', 'x.json'], ['--body-file', 'x.bin', '--content-type', 'application/octet-stream'], ['--multipart', '--form', 'x=y'], ['--multipart', '--upload', 'file=x.pdf'], ['--multipart', '--json-part', 'request=x.json']]) {
      assert.throws(() => parseApiRequestArgs([method, '/api/example', ...args]), /禁止请求body/);
    }
  }
});

test('admin init is consistently documented as a dedicated generic-write exception', async () => {
  const files = ['SKILL.md', 'references/cli-contract.md', 'references/safety-policy.md', 'skills/web-admin/SKILL.md', 'skills/web-admin/operations.md'];
  for (const name of files) {
    const text = await readFile(path.join(ROOT, name), 'utf8');
    assert.match(text, /admin init/);
    assert.match(text, /(?:dedicated|独立|专用)/, `${name} must describe the dedicated init flow`);
  }
  const operations = await readFile(path.join(ROOT, 'skills', 'web-admin', 'operations.md'), 'utf8');
  assert.match(operations, /禁止 dry-run\/plan-id\/`--yes`\/`--reason`\/`--profile`\/API path/);
});

test('complex operation contracts pin exact backend body shapes and multipart field names', async () => {
  const operations = await readFile(path.join(ROOT, 'skills', 'operations', 'operations.md'), 'utf8');
  assert.match(operations, /operations\.product\.config-file[^\n]*--upload configFile=<absolute-path>/);
  assert.match(operations, /operations\.asset-template\.submit[^\n]*--json-stdin/);
  for (const field of ['id,name,riskLevel,version,status,doubleTime,annualReturnRange,strategyPosition,allocations[]', 'configType,productName,ratio,expectedReturn']) assert.ok(operations.includes(field));

  const customer = await readFile(path.join(ROOT, 'skills', 'customer', 'operations.md'), 'utf8');
  assert.match(customer, /customer\.agreement\.fields[^\n]*--json-stdin[^\n]*顶层数组（不能包`fields`）[^\n]*`fieldKey,fieldValue`/);

  const manager = await readFile(path.join(ROOT, 'skills', 'manager', 'operations.md'), 'utf8');
  assert.match(manager, /manager\.contract\.config[^\n]*--json-stdin[^\n]*--form request=<JSON-string>[^\n]*--upload approvalFiles=<absolute-path>/);
  assert.match(manager, /两个AllocationsJson值必须是JSON编码字符串而非直接数组/);
  assert.ok(manager.includes('comment,customerId,productId,configTitle,managerSupplement,specificConfigAdvice,strategyAllocationsJson,allocationElementsJson,trustSpvPackageFlowId,trustSpvPackageFlowIds,reinvestWithoutPayment'));

  const specialist = await readFile(path.join(ROOT, 'skills', 'specialist', 'operations.md'), 'utf8');
  for (const field of ['recognizedInfoJson', 'contractFiles', 'spvFiles']) assert.ok(specialist.includes(field));
  assert.match(specialist, /specialist\.flow\.create[^\n]*先执行recognize[^\n]*recognizedInfoJson=<JSON-array-string>[^\n]*investmentPath[^\n]*deliveryForm[^\n]*value`均非空/);
  assert.match(specialist, /specialist\.flow\.recognize[^\n]*不得传customerId\/title\/recognizedInfoJson/);
});

test('skills contain no credential payloads and only admin init may omit an explicit profile', async () => {
  for (const file of await skillFiles()) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /profile save|JIABAN_SESSION_TOKEN\s*=|JIABAN_INTEGRATION_PASSWORD\s*=|1[3-9]\d{9}/i);
    for (const line of text.split(/\r?\n/).filter((item) => item.includes('jiaban '))) {
      if (line.includes('jiaban admin init')) continue;
      assert.match(line, /jiaban --profile (?:<fixed-profile>|web-admin|manager|p9|p8|p7|specialist|operations|customer) /);
    }
  }
  const scriptFiles = await readdir(path.join(ROOT, 'skills'), { recursive: true });
  assert.equal(scriptFiles.some((name) => /\.(mjs|cjs|js)$/.test(name)), false);
});

test('package allowlist includes shared CLI and the complete skill pack', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.4.1');
  assert.equal(pkg.private, true);
  for (const entry of ['bin', 'src', 'skills', 'references', 'README.md', 'SKILL.md']) assert.ok(pkg.files.includes(entry));
  assert.deepEqual(pkg.files, ['bin', 'src', 'skills', 'references', 'README.md', 'SKILL.md']);
  assert.equal(pkg.dependencies, undefined);
});

test('public package has only shared runtime modules and documents admin initialization', async () => {
  const files = await readdir(path.join(ROOT, 'src'));
  assert.deepEqual(new Set(files), new Set(['cli.mjs', 'generic-api.mjs', 'profile-store.mjs']));
  const corpus = await Promise.all([
    readFile(path.join(ROOT, 'README.md'), 'utf8'),
    readFile(path.join(ROOT, 'SKILL.md'), 'utf8'),
    readFile(path.join(ROOT, 'references', 'cli-contract.md'), 'utf8'),
  ]);
  assert.ok(corpus.every((text) => /admin init/.test(text)));
  assert.match(corpus[0], /jiaban-cli-0\.4\.1\.tgz/);
});

test('administrator setup triggers route uniquely to web-admin', async () => {
  const routing = await readFile(path.join(ROOT, 'references', 'role-routing.md'), 'utf8');
  const webAdmin = routing.split(/\r?\n/).find((line) => line.startsWith('| web-admin |'));
  for (const trigger of ['设置管理员账户', '初始化管理员账户']) {
    assert.ok(webAdmin.includes(trigger));
    assert.equal(routing.split(trigger).length - 1, 1);
  }
});
