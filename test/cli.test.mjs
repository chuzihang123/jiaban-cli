import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test, { after } from 'node:test';

import { internals, run } from '../src/cli.mjs';

const TEST_CONFIG_ROOT = await mkdtemp(path.join(os.tmpdir(), 'jiaban-cli-test-'));
let configSequence = 0;
after(() => rm(TEST_CONFIG_ROOT, { recursive: true, force: true }));

function capture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function authStatusData() {
  return {
    user: { id: 9, displayName: '测试集成账号' },
    roles: ['SENIOR_ADMIN'],
    activeRole: 'SENIOR_ADMIN',
  };
}

async function invoke(argv, options = {}) {
  const stdout = capture();
  const stderr = capture();
  const calls = [];
  const delegateFetch = options.fetch ?? (async () => (
    jsonResponse(200, { code: 200, message: '成功', data: options.data ?? {} })
  ));
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return delegateFetch(url, init);
  };
  const env = {
    JIABAN_BASE_URL: 'http://127.0.0.1:8011',
    JIABAN_SESSION_TOKEN: 'test-session-never-print',
    JIABAN_CONFIG_DIR: options.configDir ?? path.join(TEST_CONFIG_ROOT, String(configSequence += 1)),
    ...options.env,
  };
  const stdin = options.stdin === undefined ? Readable.from([]) : Readable.from([options.stdin]);
  const exitCode = await run(argv, {
    env,
    fetch: fetchImpl,
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const lines = stdout.value().trim().split('\n');
  assert.equal(lines.length, 1, 'stdout must contain exactly one JSON line');
  return { exitCode, body: JSON.parse(lines[0]), stdout: stdout.value(), stderr: stderr.value(), calls, env };
}

test('help is a single JSON object', async () => {
  const result = await invoke(['--help'], { env: { JIABAN_BASE_URL: '', JIABAN_SESSION_TOKEN: '' } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.command, 'help');
  assert.equal(result.calls.length, 0);
});

test('rejects unknown commands, missing options, duplicate options and unsafe ids', async () => {
  for (const argv of [
    ['api', 'get'],
    ['customer', 'get'],
    ['customer', 'get', '--id', '1', '--id', '2'],
    ['customer', 'get', '--id', '0'],
    ['customer', 'get', '--id', '../1'],
    ['customer', 'get', '--id', '9007199254740992'],
  ]) {
    const result = await invoke(argv);
    assert.equal(result.exitCode, 2);
    assert.equal(result.body.ok, false);
    assert.equal(result.calls.length, 0);
  }
});

test('requires HTTPS except localhost and rejects malicious base URLs', async () => {
  const rejected = [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/api',
    'https://example.com?next=https://evil.test',
    'javascript:alert(1)',
  ];
  for (const baseUrl of rejected) {
    const result = await invoke(['health'], { env: { JIABAN_BASE_URL: baseUrl } });
    assert.equal(result.exitCode, 3);
    assert.equal(result.calls.length, 0);
  }
  assert.equal(internals.baseUrlFromEnvironment({ JIABAN_BASE_URL: 'http://localhost:9000' }), 'http://localhost:9000');
  assert.equal(internals.baseUrlFromEnvironment({ JIABAN_BASE_URL: 'https://api.example.com' }), 'https://api.example.com');
});

test('base URL priority is saved profile, explicit environment, then built-in default', async () => {
  const defaulted = await invoke(['health'], {
    env: { JIABAN_BASE_URL: '' },
    data: { status: 'UP', service: 'trust-backend' },
  });
  assert.equal(defaulted.calls[0].url, `${internals.DEFAULT_BASE_URL}/api/health`);

  const explicit = await invoke(['health'], {
    env: { JIABAN_BASE_URL: 'https://explicit-test.example.com' },
    data: { status: 'UP', service: 'trust-backend' },
  });
  assert.equal(explicit.calls[0].url, 'https://explicit-test.example.com/api/health');

  const configDir = path.join(TEST_CONFIG_ROOT, 'base-url-priority');
  await invoke(['profile', 'save', 'preferred'], {
    configDir,
    stdin: JSON.stringify({ baseUrl: 'https://profile-test.example.com', phone: '13800138009', password: 'test-password' }),
  });
  await invoke(['profile', 'use', 'preferred'], { configDir });
  const profiled = await invoke(['health'], {
    configDir,
    env: { JIABAN_BASE_URL: 'https://explicit-test.example.com' },
    data: { status: 'UP', service: 'trust-backend' },
  });
  assert.equal(profiled.calls[0].url, 'https://profile-test.example.com/api/health');
});

test('health is the only command that omits authentication', async () => {
  const health = await invoke(['health'], { data: { status: 'UP', service: 'trust-backend' }, env: { JIABAN_SESSION_TOKEN: '' } });
  assert.equal(health.exitCode, 0);
  assert.deepEqual(health.body.data, { status: 'UP', service: 'trust-backend' });
  assert.deepEqual(health.calls[0].init.headers, {});
  assert.equal(health.calls[0].init.method, 'GET');
  assert.equal(health.calls[0].init.redirect, 'manual');

  const auth = await invoke(['auth', 'status'], { env: { JIABAN_SESSION_TOKEN: '' } });
  assert.equal(auth.exitCode, 3);
  assert.equal(auth.body.error.code, 'AUTH_REQUIRED');
  assert.equal(auth.calls.length, 0);
});

test('auth status sends only the session trust_token and returns a minimal user view', async () => {
  const result = await invoke(['auth', 'status'], {
    data: {
      user: { id: 9, userNo: 'U009', phone: '13800138000', displayName: '管理员', roleLevel: 'P9', jobTitle: '总经理', departmentId: 2 },
      roles: ['SENIOR_ADMIN'], permissions: ['secret:permission'], activeRole: 'SENIOR_ADMIN', mustChangePassword: false,
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.calls[0].init.headers, { trust_token: 'test-session-never-print' });
  assert.equal(result.stdout.includes('13800138000'), false);
  assert.equal(result.stdout.includes('secret:permission'), false);
  assert.deepEqual(result.body.data, {
    id: 9, displayName: '管理员', activeRole: 'SENIOR_ADMIN', roles: ['SENIOR_ADMIN'],
  });
});

test('automatically logs in with dedicated test credentials and keeps secrets in memory only', async () => {
  const password = 'Only-Test-Password!';
  const issuedToken = 'issued-session-token';
  const result = await invoke(['auth', 'status'], {
    env: {
      JIABAN_SESSION_TOKEN: '',
      JIABAN_INTEGRATION_PHONE: '13800138009',
      JIABAN_INTEGRATION_PASSWORD: password,
    },
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/auth/login')) {
        return jsonResponse(200, { code: 200, data: { tokenValue: issuedToken } });
      }
      return jsonResponse(200, { code: 200, data: authStatusData() });
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].url, 'http://127.0.0.1:8011/api/auth/login');
  assert.equal(result.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(result.calls[0].init.body), {
    phone: '13800138009', password, clientType: 'cli', activeRole: 'SENIOR_ADMIN',
  });
  assert.deepEqual(result.calls[0].init.headers, { 'content-type': 'application/json' });
  assert.equal(result.calls[1].init.method, 'GET');
  assert.deepEqual(result.calls[1].init.headers, { trust_token: issuedToken });
  for (const secret of [password, issuedToken, '13800138009']) {
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
  }
  assert.ok(result.calls.filter((call) => call.init.method === 'POST')
    .every((call) => new URL(call.url).pathname === '/api/auth/login'));
});

test('session token has priority and never triggers credential login', async () => {
  const result = await invoke(['auth', 'status'], {
    data: authStatusData(),
    env: {
      JIABAN_SESSION_TOKEN: 'priority-session',
      JIABAN_INTEGRATION_PHONE: '13800138009',
      JIABAN_INTEGRATION_PASSWORD: 'unused-password',
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].init.method, 'GET');
  assert.deepEqual(result.calls[0].init.headers, { trust_token: 'priority-session' });
});

test('environment activeRole is validated and sent by credential login', async () => {
  const result = await invoke(['auth', 'status'], {
    env: {
      JIABAN_SESSION_TOKEN: '', JIABAN_INTEGRATION_PHONE: '13800138009',
      JIABAN_INTEGRATION_PASSWORD: 'role-password', JIABAN_ACTIVE_ROLE: 'TRUST_SPECIALIST',
    },
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/auth/login')) {
        assert.equal(JSON.parse(init.body).activeRole, 'TRUST_SPECIALIST');
        return jsonResponse(200, { code: 200, data: { tokenValue: 'role-token' } });
      }
      return jsonResponse(200, { code: 200, data: authStatusData() });
    },
  });
  assert.equal(result.exitCode, 0);
  const invalid = await invoke(['auth', 'status'], { env: { JIABAN_ACTIVE_ROLE: 'ROOT' } });
  assert.equal(invalid.body.error.code, 'INVALID_ACTIVE_ROLE');
  assert.equal(invalid.calls.length, 0);
});

test('credential mode re-authenticates and retries a business GET only once', async () => {
  let loginCount = 0;
  let getCount = 0;
  const result = await invoke(['auth', 'status'], {
    env: {
      JIABAN_SESSION_TOKEN: '',
      JIABAN_INTEGRATION_PHONE: '13800138009',
      JIABAN_INTEGRATION_PASSWORD: 'retry-password',
    },
    fetch: async (_url, init) => {
      if (init.method === 'POST') {
        loginCount += 1;
        return jsonResponse(200, { code: 200, data: { tokenValue: `retry-token-${loginCount}` } });
      }
      getCount += 1;
      return jsonResponse(401, { code: 401, message: 'expired' });
    },
  });
  assert.equal(result.exitCode, 4);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
  assert.equal(loginCount, 2);
  assert.equal(getCount, 2);
  assert.equal(result.calls.length, 4);
});

test('login failures, redirects and timeouts are stable and secret-free', async () => {
  const credentials = {
    JIABAN_SESSION_TOKEN: '',
    JIABAN_INTEGRATION_PHONE: '13800138009',
    JIABAN_INTEGRATION_PASSWORD: 'never-output-password',
  };
  const failure = await invoke(['auth', 'status'], {
    env: credentials,
    fetch: async () => jsonResponse(200, { code: 401, message: 'never-output-password' }),
  });
  assert.equal(failure.exitCode, 4);
  assert.equal(failure.body.error.code, 'LOGIN_FAILED');
  assert.equal(failure.stdout.includes('never-output-password'), false);

  const redirect = await invoke(['auth', 'status'], {
    env: credentials,
    fetch: async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }),
  });
  assert.equal(redirect.body.error.code, 'REDIRECT_REJECTED');
  assert.equal(redirect.calls.length, 1);
  assert.equal(redirect.calls[0].init.redirect, 'manual');

  const timeout = await invoke(['auth', 'status'], {
    env: credentials,
    fetch: async () => { const error = new Error('never-output-password'); error.name = 'AbortError'; throw error; },
  });
  assert.equal(timeout.body.error.code, 'TIMEOUT');
  assert.equal(timeout.stdout.includes('never-output-password'), false);
});

test('customer get and contract commands use fixed GET routes', async () => {
  const customer = await invoke(['customer', 'get', '--id', '12'], {
    data: {
      id: 12, customerNo: '010012', phone: '13900001111', status: 'ACTIVE', riskLevel: 'R2',
      displayName: '不得输出', managerName: '不得输出', ownerName: '不得输出',
    },
  });
  assert.equal(customer.calls[0].url, 'http://127.0.0.1:8011/api/senior/customers/12');
  assert.equal(customer.calls[0].init.method, 'GET');
  assert.deepEqual(customer.body.data, {
    id: 12, customerNo: '010012', maskedPhone: '139****1111', status: 'ACTIVE', riskLevel: 'R2',
  });
  assert.equal(customer.stdout.includes('不得输出'), false);

  const list = await invoke(['contract', 'list', '--customer-id', '12'], {
    data: [{
      id: 7, flowNo: 'CF007', customerId: 12, status: 'RUNNING', processActive: true,
      currentFlowNodeName: '审核', title: '不得输出', customerName: '不得输出',
    }],
  });
  assert.equal(list.calls[0].url, 'http://127.0.0.1:8011/api/senior/customers/12/contract-flows');
  assert.deepEqual(list.body.data, [{
    id: 7, flowNo: 'CF007', customerId: 12, status: 'RUNNING', processActive: true,
    currentFlowNodeName: '审核',
  }]);
  assert.equal(list.stdout.includes('不得输出'), false);

  const status = await invoke(['contract', 'status', '--id', '7'], {
    data: {
      flow: {
        id: 7, flowNo: 'CF007', customerId: 12, status: 'RUNNING', processActive: true,
        currentFlowNodeName: '审核', recognizedInfoJson: 'secret',
      },
      process: { active: true, currentFlowNodeName: '审核' }, documents: [{ id: 1 }],
    },
  });
  assert.equal(status.calls[0].url, 'http://127.0.0.1:8011/api/senior/contract-flows/7');
  assert.equal(status.stdout.includes('recognizedInfoJson'), false);
  assert.equal(status.stdout.includes('documents'), false);
  assert.deepEqual(status.body.data, {
    id: 7, flowNo: 'CF007', customerId: 12, status: 'RUNNING', processActive: true,
    currentFlowNodeName: '审核',
  });
});

test('maps HTTP 401 and 403 without leaking token', async () => {
  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN']]) {
    const result = await invoke(['auth', 'status'], {
      fetch: async () => jsonResponse(status, { code: status, message: `backend-secret test-session-never-print Authorization: Bearer test-session-never-print` }),
    });
    assert.equal(result.exitCode, 4);
    assert.equal(result.body.error.code, code);
    assert.equal(result.stdout.includes('test-session-never-print'), false);
    assert.equal(result.stderr.includes('test-session-never-print'), false);
    assert.equal(result.stdout.includes('backend-secret'), false);
  }
});

test('rejects HTTP 200 business failures', async () => {
  const result = await invoke(['health'], {
    fetch: async () => jsonResponse(200, { code: 4050, message: '业务失败', data: { status: 'UP' } }),
  });
  assert.equal(result.exitCode, 6);
  assert.equal(result.body.error.code, 'BUSINESS_ERROR');
  assert.equal(result.body.error.businessCode, 4050);
  assert.equal(result.stdout.includes('业务失败'), false);
});

test('maps HTTP 200 business code 404 to NOT_FOUND', async () => {
  const result = await invoke(['customer', 'get', '--id', '12'], {
    fetch: async () => jsonResponse(200, { code: 404, message: '包含敏感内部细节', data: null }),
  });
  assert.equal(result.exitCode, 5);
  assert.equal(result.body.error.code, 'NOT_FOUND');
  assert.equal(result.body.error.businessCode, 404);
  assert.equal(result.stdout.includes('敏感内部细节'), false);
});

test('reports timeout as retryable and never leaks a token from network errors', async () => {
  assert.equal(internals.REQUEST_TIMEOUT_MS, 10_000);
  const timeout = await invoke(['auth', 'status'], {
    fetch: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
  });
  assert.equal(timeout.exitCode, 7);
  assert.equal(timeout.body.error.code, 'TIMEOUT');
  assert.equal(timeout.body.error.retryable, true);
  assert.match(timeout.body.error.message, /10 秒/);

  const network = await invoke(['auth', 'status'], {
    fetch: async () => { throw new Error('socket failed for test-session-never-print'); },
  });
  assert.equal(network.exitCode, 7);
  assert.equal(network.stdout.includes('test-session-never-print'), false);
  assert.equal(network.stderr.includes('test-session-never-print'), false);
  assert.equal(network.stdout.includes('socket failed'), false);
});

test('marks generic write transport failure as outcome unknown and not retryable', async () => {
  const result = await invoke([
    'api', 'request', 'POST', '/api/example', '--reason', '当前回合测试确认', '--yes',
  ], {
    env: { JIABAN_CLI_FULL_ACCESS_ENABLED: 'true' },
    fetch: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
  });
  assert.equal(result.exitCode, 7);
  assert.equal(result.body.error.code, 'TIMEOUT');
  assert.equal(result.body.error.retryable, false);
  assert.equal(result.body.error.outcomeUnknown, true);
  assert.equal(result.calls.length, 1);
});

test('rejects redirects without following them', async () => {
  let calls = 0;
  const result = await invoke(['health'], {
    fetch: async (_url, init) => {
      calls += 1;
      assert.equal(init.redirect, 'manual');
      return new Response('', { status: 302, headers: { location: 'https://evil.example/collect' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.exitCode, 6);
  assert.equal(result.body.error.code, 'REDIRECT_REJECTED');
});

test('encrypts saved profiles, separates the key, and manages active state without exposing secrets', async () => {
  const configDir = path.join(TEST_CONFIG_ROOT, 'profile-lifecycle');
  const secretProfile = {
    baseUrl: 'http://127.0.0.1:8123',
    phone: '13800138009',
    password: 'Encrypted-Test-Password!',
    activeRole: 'MANAGER',
  };
  const saved = await invoke(['profile', 'save', 'test-a'], {
    configDir,
    stdin: JSON.stringify(secretProfile),
  });
  assert.equal(saved.exitCode, 0);
  assert.deepEqual(saved.body.data, { name: 'test-a', saved: true });
  for (const secret of Object.values(secretProfile)) assert.equal(saved.stdout.includes(secret), false);

  const encrypted = await readFile(path.join(configDir, 'profiles.enc'), 'utf8');
  const key = await readFile(path.join(configDir, 'profiles.key'));
  assert.equal(key.length, 32);
  for (const secret of Object.values(secretProfile)) assert.equal(encrypted.includes(secret), false);
  assert.notEqual(encrypted, key.toString('base64'));
  if (process.platform !== 'win32') {
    assert.equal((await stat(path.join(configDir, 'profiles.enc'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(configDir, 'profiles.key'))).mode & 0o777, 0o600);
  }

  const listed = await invoke(['profile', 'list'], { configDir });
  assert.deepEqual(listed.body.data, { profiles: [{ name: 'test-a', active: false }] });
  assert.equal(listed.stdout.includes('127.0.0.1'), false);
  assert.equal(listed.stdout.includes('13800138009'), false);

  const used = await invoke(['profile', 'use', 'test-a'], { configDir });
  assert.deepEqual(used.body.data, { name: 'test-a', active: true });
  const current = await invoke(['profile', 'current'], { configDir });
  assert.deepEqual(current.body.data, { name: 'test-a' });

  const business = await invoke(['auth', 'status'], {
    configDir,
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/auth/login')) {
        assert.equal(JSON.parse(init.body).activeRole, 'MANAGER');
        return jsonResponse(200, { code: 200, data: { tokenValue: 'profile-memory-token' } });
      }
      return jsonResponse(200, { code: 200, data: authStatusData() });
    },
  });
  assert.equal(business.calls[0].url, 'http://127.0.0.1:8123/api/auth/login');
  assert.deepEqual(business.calls[1].init.headers, { trust_token: 'profile-memory-token' });
  for (const secret of [...Object.values(secretProfile), 'profile-memory-token']) {
    assert.equal(business.stdout.includes(secret), false);
    assert.equal(business.stderr.includes(secret), false);
  }

  const removed = await invoke(['profile', 'remove', 'test-a'], { configDir });
  assert.deepEqual(removed.body.data, { name: 'test-a', removed: true });
  const afterRemove = await invoke(['profile', 'current'], { configDir });
  assert.deepEqual(afterRemove.body.data, { name: null });
});

test('--profile temporarily selects a saved profile and does not change the global active profile', async () => {
  const configDir = path.join(TEST_CONFIG_ROOT, 'profile-temporary');
  const save = async (name, port) => invoke(['profile', 'save', name], {
    configDir,
    stdin: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, phone: '13800138009', password: `password-${name}` }),
  });
  await save('test-a', 8201);
  await save('test-b', 8202);
  await invoke(['profile', 'use', 'test-a'], { configDir });

  const temporary = await invoke(['--profile', 'test-b', 'health'], {
    configDir,
    data: { status: 'UP', service: 'trust-backend' },
  });
  assert.equal(temporary.calls[0].url, 'http://127.0.0.1:8202/api/health');
  const current = await invoke(['profile', 'current'], { configDir });
  assert.deepEqual(current.body.data, { name: 'test-a' });
});

test('rejects invalid profile stdin, relative config paths, and damaged encrypted data', async () => {
  const invalidInput = await invoke(['profile', 'save', 'test-a'], { stdin: '{bad json' });
  assert.equal(invalidInput.exitCode, 2);
  assert.equal(invalidInput.body.error.code, 'INVALID_PROFILE_INPUT');

  const invalidRole = await invoke(['profile', 'save', 'test-role'], {
    stdin: JSON.stringify({ baseUrl: 'http://127.0.0.1:8300', phone: '13800138009', password: 'test', activeRole: 'ROOT' }),
  });
  assert.equal(invalidRole.body.error.code, 'INVALID_PROFILE_INPUT');

  const relative = await invoke(['profile', 'list'], { env: { JIABAN_CONFIG_DIR: 'relative/path' } });
  assert.equal(relative.exitCode, 3);
  assert.equal(relative.body.error.code, 'INVALID_CONFIG_DIR');

  const configDir = path.join(TEST_CONFIG_ROOT, 'profile-corrupt');
  await invoke(['profile', 'save', 'test-a'], {
    configDir,
    stdin: JSON.stringify({ baseUrl: 'http://127.0.0.1:8301', phone: '13800138009', password: 'test-password' }),
  });
  await writeFile(path.join(configDir, 'profiles.enc'), '{"version":1,"ciphertext":"broken"}');
  const corrupt = await invoke(['profile', 'list'], { configDir });
  assert.equal(corrupt.exitCode, 3);
  assert.equal(corrupt.body.error.code, 'PROFILE_STORE_CORRUPT');
});

test('phone masker never returns a short phone verbatim', () => {
  assert.equal(internals.maskPhone('123456'), '******');
  assert.equal(internals.maskPhone('13800138000'), '138****8000');
});

test('rejects missing or malformed success data instead of emitting null shells', async () => {
  const cases = [
    [['health'], {}],
    [['auth', 'status'], { user: { id: 9, displayName: '管理员' }, roles: [], activeRole: '' }],
    [['customer', 'get', '--id', '12'], { id: 12, customerNo: null, phone: null, status: null, riskLevel: null }],
    [['contract', 'list', '--customer-id', '12'], [{ id: 7, status: 'RUNNING' }]],
    [['contract', 'status', '--id', '7'], { id: 7, flowNo: 'CF007', customerId: 12, status: 'RUNNING' }],
  ];
  for (const [argv, data] of cases) {
    const result = await invoke(argv, { data });
    assert.equal(result.exitCode, 6);
    assert.equal(result.body.error.code, 'INVALID_RESPONSE');
  }
});
