import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test, { after } from 'node:test';

import { run } from '../src/cli.mjs';
import { BundledProfileError, loadBundledTestProfile } from '../src/bundled-profile.mjs';

const ROOT = await mkdtemp(path.join(os.tmpdir(), 'jiaban-bundled-test-'));
let sequence = 0;
after(() => rm(ROOT, { recursive: true, force: true }));

const SECRET = {
  baseUrl: 'https://wnmsnezogvtm.cloud.zyyc.chat',
  phone: '13800138009',
  password: 'bundled-password-never-print',
  activeRole: 'WEB_ADMIN',
  fullAccess: true,
};

function capture() {
  let value = '';
  return { stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }), value: () => value };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function profileFile(value = SECRET) {
  const file = path.join(ROOT, `bundle-${sequence += 1}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

async function invoke(argv, options = {}) {
  const stdout = capture();
  const stderr = capture();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (options.fetch) return options.fetch(url, init, calls.length);
    if (String(url).endsWith('/api/auth/login')) return jsonResponse(200, { code: 200, data: { tokenValue: 'bundled-token-never-print' } });
    if (String(url).endsWith('/api/auth/me')) return jsonResponse(200, { code: 200, data: { user: { id: 1, displayName: '私有测试管理员' }, roles: ['WEB_ADMIN'], activeRole: 'WEB_ADMIN' } });
    return jsonResponse(200, { code: 200, data: { ok: true } });
  };
  const env = {
    JIABAN_CONFIG_DIR: options.configDir ?? path.join(ROOT, `config-${sequence += 1}`),
    JIABAN_SESSION_TOKEN: '', JIABAN_INTEGRATION_PHONE: '', JIABAN_INTEGRATION_PASSWORD: '',
    ...options.env,
  };
  const exitCode = await run(argv, {
    env, fetch: fetchImpl, bundledProfilePath: options.bundledProfilePath,
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdout: stdout.stream, stderr: stderr.stream,
  });
  const lines = stdout.value().trim().split('\n');
  assert.equal(lines.length, 1);
  return { exitCode, body: JSON.parse(lines[0]), stdout: stdout.value(), stderr: stderr.value(), calls, env };
}

test('bundled loader accepts only the strict private schema and fixed origin', async () => {
  assert.equal((await loadBundledTestProfile(await profileFile())).source, 'bundled-private-test');
  const invalidValues = [
    { ...SECRET, baseUrl: 'https://evil.example.com' },
    { ...SECRET, activeRole: 'ROOT' },
    { ...SECRET, activeRole: 'MANAGER' },
    { ...SECRET, fullAccess: 'true' },
    { ...SECRET, extra: true },
    { ...SECRET, phone: 'not-a-phone' },
  ];
  for (const value of invalidValues) {
    await assert.rejects(loadBundledTestProfile(await profileFile(value)), BundledProfileError);
  }
});

test('any non-empty authentication variable disables bundled fallback and fails closed', async () => {
  const file = await profileFile();
  const cases = [
    { JIABAN_ACTIVE_ROLE: 'WEB_ADMIN' },
    { JIABAN_INTEGRATION_PASSWORD: 'partial-password' },
    { JIABAN_INTEGRATION_PHONE: '13800138009' },
    { JIABAN_INTEGRATION_PHONE: 'invalid-phone', JIABAN_INTEGRATION_PASSWORD: 'password' },
    { JIABAN_INTEGRATION_PHONE: '13800138009', JIABAN_INTEGRATION_PASSWORD: 'x'.repeat(257) },
  ];
  for (const env of cases) {
    const result = await invoke(['auth', 'status'], { bundledProfilePath: file, env });
    assert.equal(result.exitCode, 3);
    assert.ok(['AUTH_REQUIRED', 'AUTH_INVALID'].includes(result.body.error.code));
    assert.equal(result.calls.length, 0);
    assert.equal(result.body.data?.authSource, undefined);
  }
});

test('missing environment auth falls back to bundled login and exposes only the safe source marker', async () => {
  const file = await profileFile();
  const result = await invoke(['auth', 'status'], { bundledProfilePath: file });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls[0].url, `${SECRET.baseUrl}/api/auth/login`);
  assert.deepEqual(JSON.parse(result.calls[0].init.body), {
    phone: SECRET.phone, password: SECRET.password, clientType: 'cli', activeRole: 'WEB_ADMIN',
  });
  assert.equal(result.body.data.authSource, 'bundled-private-test');
  for (const secret of [SECRET.phone, SECRET.password, 'bundled-token-never-print', file]) {
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
  }
});

test('environment session or credentials take priority without reading a malformed bundled file', async () => {
  const malformed = path.join(ROOT, 'malformed-priority.json');
  await writeFile(malformed, '{bad');
  const session = await invoke(['auth', 'status'], {
    bundledProfilePath: malformed,
    env: { JIABAN_SESSION_TOKEN: 'environment-session' },
  });
  assert.equal(session.exitCode, 0);
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].init.headers.trust_token, 'environment-session');
  assert.equal(session.body.data.authSource, undefined);

  const credentials = await invoke(['auth', 'status'], {
    bundledProfilePath: malformed,
    env: { JIABAN_INTEGRATION_PHONE: '13900139000', JIABAN_INTEGRATION_PASSWORD: 'environment-password', JIABAN_ACTIVE_ROLE: 'MANAGER' },
    fetch: async (url, init) => String(url).endsWith('/api/auth/login')
      ? (assert.equal(JSON.parse(init.body).activeRole, 'MANAGER'), jsonResponse(200, { code: 200, data: { tokenValue: 'environment-token' } }))
      : jsonResponse(200, { code: 200, data: { user: { id: 2, displayName: '经理' }, roles: ['MANAGER'], activeRole: 'MANAGER' } }),
  });
  assert.equal(credentials.exitCode, 0);
  assert.equal(credentials.body.data.authSource, undefined);
});

test('explicit encrypted profile takes priority over environment and bundled sources', async () => {
  const configDir = path.join(ROOT, 'encrypted-priority');
  await invoke(['profile', 'save', 'chosen'], {
    configDir,
    stdin: JSON.stringify({ baseUrl: SECRET.baseUrl, phone: '13700137000', password: 'chosen-password', activeRole: 'MANAGER' }),
  });
  const malformed = path.join(ROOT, 'malformed-profile-priority.json');
  await writeFile(malformed, '{bad');
  const result = await invoke(['--profile', 'chosen', 'auth', 'status'], {
    configDir,
    bundledProfilePath: malformed,
    env: { JIABAN_SESSION_TOKEN: 'ignored-environment-session' },
    fetch: async (url, init) => String(url).endsWith('/api/auth/login')
      ? (assert.equal(JSON.parse(init.body).password, 'chosen-password'), jsonResponse(200, { code: 200, data: { tokenValue: 'chosen-token' } }))
      : jsonResponse(200, { code: 200, data: { user: { id: 3, displayName: '选定经理' }, roles: ['MANAGER'], activeRole: 'MANAGER' } }),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.length, 2);

  await invoke(['profile', 'use', 'chosen'], { configDir });
  const active = await invoke(['auth', 'status'], {
    configDir,
    bundledProfilePath: malformed,
    env: { JIABAN_SESSION_TOKEN: 'also-ignored' },
    fetch: async (url, init) => String(url).endsWith('/api/auth/login')
      ? (assert.equal(JSON.parse(init.body).password, 'chosen-password'), jsonResponse(200, { code: 200, data: { tokenValue: 'active-token' } }))
      : jsonResponse(200, { code: 200, data: { user: { id: 3, displayName: '选定经理' }, roles: ['MANAGER'], activeRole: 'MANAGER' } }),
  });
  assert.equal(active.exitCode, 0);
  assert.equal(active.calls.length, 2);
});

test('bundled fullAccess enables an ordinary write but never enables destructive access', async () => {
  const file = await profileFile();
  const dryRun = await invoke(['api', 'request', 'POST', '/api/example', '--dry-run', '--reason', 'PRIVATE-TEST'], { bundledProfilePath: file });
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.calls.length, 0);
  const ordinary = await invoke(['api', 'request', 'POST', '/api/example', '--yes', '--reason', 'PRIVATE-TEST'], { bundledProfilePath: file });
  assert.equal(ordinary.exitCode, 0);
  assert.equal(ordinary.calls.length, 2);
  assert.equal(ordinary.calls[1].init.method, 'POST');

  const destructive = await invoke(['api', 'request', 'GET', '/api/users/1/status', '--dry-run', '--reason', 'PRIVATE-TEST'], { bundledProfilePath: file });
  assert.equal(destructive.body.error.code, 'DESTRUCTIVE_DISABLED');
  assert.equal(destructive.calls.length, 0);
});

test('health never reads bundled credentials, while invalid bundle errors remain secret-free', async () => {
  const malformed = path.join(ROOT, 'malformed-health.json');
  await writeFile(malformed, `{ "password": "${SECRET.password}" }`);
  const health = await invoke(['health'], {
    bundledProfilePath: malformed,
    fetch: async () => jsonResponse(200, { code: 200, data: { status: 'UP', service: 'trust-backend' } }),
  });
  assert.equal(health.exitCode, 0);
  const invalid = await invoke(['auth', 'status'], { bundledProfilePath: malformed });
  assert.equal(invalid.body.error.code, 'BUNDLED_PROFILE_INVALID');
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.stdout.includes(SECRET.password), false);
  assert.equal(invalid.stdout.includes(malformed), false);
});
