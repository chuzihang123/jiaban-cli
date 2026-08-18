import assert from 'node:assert/strict';
import {
  access, chmod as fsChmod, mkdtemp, readFile, readdir, rename as fsRename, rm, writeFile as fsWriteFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test, { after } from 'node:test';

import { internals, run } from '../src/cli.mjs';
import { ProfileStore } from '../src/profile-store.mjs';

const ROOT = await mkdtemp(path.join(os.tmpdir(), 'jiaban-admin-init-'));
const PHONE = `139${'0'.repeat(8)}`;
const PASSWORD = 'test-admin-password-never-print';
const TOKEN = 'test-admin-token-never-print';
let sequence = 0;

after(() => rm(ROOT, { recursive: true, force: true }));

function capture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function invoke(argv, options = {}) {
  const stdout = capture();
  const stderr = capture();
  const calls = [];
  const configDir = options.configDir ?? path.join(ROOT, String(sequence += 1));
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (options.fetch) return options.fetch(url, init, calls.length);
    if (String(url).endsWith('/api/auth/login')) {
      return response({ code: 200, data: { tokenValue: TOKEN } });
    }
    return response({
      code: 200,
      data: { user: { id: 7, displayName: '测试后台管理员' }, roles: ['WEB_ADMIN'], activeRole: 'WEB_ADMIN' },
    });
  };
  const exitCode = await run(argv, {
    env: { JIABAN_CONFIG_DIR: configDir, ...options.env },
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetch: fetchImpl,
  });
  const lines = stdout.value().trim().split('\n');
  assert.equal(lines.length, 1);
  return { exitCode, body: JSON.parse(lines[0]), stdout: stdout.value(), stderr: stderr.value(), calls, configDir };
}

test('admin init verifies WEB_ADMIN before atomically saving and activating encrypted web-admin', async () => {
  const result = await invoke(['admin', 'init'], { stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.body.data, { name: 'web-admin', active: true, activeRole: 'WEB_ADMIN', verified: true });
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].url, `${internals.DEFAULT_BASE_URL}/api/auth/login`);
  assert.deepEqual(JSON.parse(result.calls[0].init.body), {
    phone: PHONE, password: PASSWORD, clientType: 'cli', activeRole: 'WEB_ADMIN',
  });
  assert.equal(result.calls[1].url, `${internals.DEFAULT_BASE_URL}/api/auth/me`);
  assert.equal(result.calls[1].init.headers.trust_token, TOKEN);

  const store = new ProfileStore(result.configDir);
  const selected = await store.selected(null);
  assert.equal(selected.name, 'web-admin');
  assert.deepEqual(selected.profile, {
    baseUrl: internals.DEFAULT_BASE_URL, phone: PHONE, password: PASSWORD, activeRole: 'WEB_ADMIN',
  });
  const encrypted = await readFile(path.join(result.configDir, 'profiles.enc'), 'utf8');
  for (const secret of [PHONE, PASSWORD, TOKEN]) {
    assert.doesNotMatch(encrypted, new RegExp(secret));
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  }
});

test('admin init rejects malformed, extra, missing, and invalid stdin with zero network', async () => {
  const invalid = [
    '',
    '{',
    '[]',
    JSON.stringify({ phone: PHONE }),
    JSON.stringify({ phone: PHONE, password: PASSWORD, baseUrl: 'https://evil.example' }),
    JSON.stringify({ phone: '123', password: PASSWORD }),
    JSON.stringify({ phone: PHONE, password: '' }),
    JSON.stringify({ phone: PHONE, password: 'x'.repeat(257) }),
    'x'.repeat(16_385),
  ];
  for (const stdin of invalid) {
    const result = await invoke(['admin', 'init'], { stdin });
    assert.equal(result.exitCode, 2);
    assert.equal(result.body.ok, false);
    assert.equal(result.calls.length, 0);
    await assert.rejects(access(result.configDir));
  }
});

test('admin init accepts no profile or credential argv flags and performs zero network', async () => {
  for (const argv of [
    ['admin', 'init', '--password', PASSWORD],
    ['--profile', 'web-admin', 'admin', 'init'],
  ]) {
    const result = await invoke(argv, { stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.calls.length, 0);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(PASSWORD));
  }
});

test('admin init refuses to overwrite an existing web-admin before reading credentials or networking', async () => {
  const configDir = path.join(ROOT, 'existing-web-admin');
  const store = new ProfileStore(configDir);
  const existing = {
    baseUrl: internals.DEFAULT_BASE_URL,
    phone: `136${'2'.repeat(8)}`,
    password: 'existing-web-admin-secret',
    activeRole: 'WEB_ADMIN',
  };
  await store.putAndUse('web-admin', existing);
  const beforeKey = await readFile(store.keyPath);
  const beforeData = await readFile(store.dataPath);
  const result = await invoke(['admin', 'init'], {
    configDir,
    stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.body.error.code, 'ADMIN_PROFILE_EXISTS');
  assert.equal(result.calls.length, 0);
  assert.deepEqual(await readFile(store.keyPath), beforeKey);
  assert.deepEqual(await readFile(store.dataPath), beforeData);
  assert.deepEqual((await store.selected(null)).profile, existing);
});

test('failed login or identity verification leaves the prior active profile unchanged', async () => {
  for (const failure of ['login', 'role']) {
    const configDir = path.join(ROOT, `preserve-${failure}`);
    const store = new ProfileStore(configDir);
    await store.putAndUse('existing', {
      baseUrl: internals.DEFAULT_BASE_URL,
      phone: `137${'1'.repeat(8)}`,
      password: 'existing-test-secret',
      activeRole: 'SENIOR_ADMIN',
    });
    const beforeKey = await readFile(store.keyPath);
    const beforeData = await readFile(store.dataPath);
    const result = await invoke(['admin', 'init'], {
      configDir,
      stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }),
      fetch: async (url) => {
        if (String(url).endsWith('/api/auth/login')) {
          return failure === 'login'
            ? response({ code: 401, message: PASSWORD }, 200)
            : response({ code: 200, data: { tokenValue: TOKEN } });
        }
        return response({
          code: 200,
          data: { user: { id: 8, displayName: '错误角色' }, roles: ['MANAGER'], activeRole: 'MANAGER' },
        });
      },
    });
    assert.equal(result.exitCode, 4);
    assert.equal((await store.selected(null)).name, 'existing');
    assert.deepEqual(await store.summary(), [{ name: 'existing', active: true }]);
    assert.deepEqual(await readFile(store.keyPath), beforeKey);
    assert.deepEqual(await readFile(store.dataPath), beforeData);
    assert.equal((await readdir(configDir)).some((entry) => entry.endsWith('.tmp')), false);
    for (const secret of [PHONE, PASSWORD, TOKEN]) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  }
});

test('failed verification on a fresh host leaves no key, data, temp file, or empty directory', async () => {
  const result = await invoke(['admin', 'init'], {
    stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }),
    fetch: async () => response({ code: 401, message: PASSWORD }),
  });
  assert.equal(result.exitCode, 4);
  assert.equal(result.calls.length, 1);
  await assert.rejects(access(result.configDir));
  for (const secret of [PHONE, PASSWORD, TOKEN]) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test('two concurrent admin init commands commit exactly one web-admin profile', async () => {
  const configDir = path.join(ROOT, 'concurrent-admin-init');
  const [first, second] = await Promise.all([
    invoke(['admin', 'init'], { configDir, stdin: JSON.stringify({ phone: PHONE, password: PASSWORD }) }),
    invoke(['admin', 'init'], { configDir, stdin: JSON.stringify({ phone: PHONE, password: `${PASSWORD}-other` }) }),
  ]);
  assert.deepEqual([first.exitCode, second.exitCode].sort(), [0, 2]);
  assert.equal([first, second].filter(({ body }) => body.ok).length, 1);
  assert.equal([first, second].filter(({ body }) => body.error?.code === 'ADMIN_PROFILE_EXISTS').length, 1);
  const store = new ProfileStore(configDir);
  assert.deepEqual(await store.summary(), [{ name: 'web-admin', active: true }]);
  assert.ok([PASSWORD, `${PASSWORD}-other`].includes((await store.selected(null)).profile.password));
  assert.equal((await readdir(configDir)).some((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock')), false);
});

test('store-level create-only rejects an existing target under its lock', async () => {
  const configDir = path.join(ROOT, 'store-create-only');
  const store = new ProfileStore(configDir);
  await store.createAndUse('web-admin', {
    baseUrl: internals.DEFAULT_BASE_URL, phone: PHONE, password: PASSWORD, activeRole: 'WEB_ADMIN',
  });
  const beforeKey = await readFile(store.keyPath);
  const beforeData = await readFile(store.dataPath);
  await assert.rejects(
    store.createAndUse('web-admin', {
      baseUrl: internals.DEFAULT_BASE_URL, phone: PHONE, password: `${PASSWORD}-other`, activeRole: 'WEB_ADMIN',
    }),
    (error) => error?.code === 'ADMIN_PROFILE_EXISTS' && error?.exitCode === 2,
  );
  assert.deepEqual(await readFile(store.keyPath), beforeKey);
  assert.deepEqual(await readFile(store.dataPath), beforeData);
});

function faultOperations(stage, dataPath) {
  const fault = () => Object.assign(new Error(`injected-${stage}`), { code: 'EIO' });
  return {
    writeFile: async (target, ...args) => {
      if (stage === 'write' && String(target).endsWith('.tmp')) throw fault();
      return fsWriteFile(target, ...args);
    },
    chmod: async (target, ...args) => {
      if (stage === 'chmod' && String(target).endsWith('.tmp')) throw fault();
      return fsChmod(target, ...args);
    },
    rename: async (source, target) => {
      if (stage === 'rename' && target === dataPath) throw fault();
      return fsRename(source, target);
    },
  };
}

test('pre-commit write, chmod, and rename faults preserve old store bytes and clean transaction files', async () => {
  for (const stage of ['write', 'chmod', 'rename']) {
    const configDir = path.join(ROOT, `fault-existing-${stage}`);
    const seed = new ProfileStore(configDir);
    await seed.putAndUse('existing', {
      baseUrl: internals.DEFAULT_BASE_URL,
      phone: `135${'3'.repeat(8)}`,
      password: 'existing-fault-test-secret',
      activeRole: 'SENIOR_ADMIN',
    });
    const beforeKey = await readFile(seed.keyPath);
    const beforeData = await readFile(seed.dataPath);
    const store = new ProfileStore(configDir, faultOperations(stage, seed.dataPath));
    await assert.rejects(store.createAndUse('web-admin', {
      baseUrl: internals.DEFAULT_BASE_URL, phone: PHONE, password: PASSWORD, activeRole: 'WEB_ADMIN',
    }), /injected-/);
    assert.deepEqual(await readFile(seed.keyPath), beforeKey);
    assert.deepEqual(await readFile(seed.dataPath), beforeData);
    assert.deepEqual(await readdir(configDir), ['profiles.enc', 'profiles.key']);
  }
});

test('pre-commit write, chmod, and data-rename faults leave a fresh host with no config artifacts', async () => {
  for (const stage of ['write', 'chmod', 'rename']) {
    const configDir = path.join(ROOT, `fault-fresh-${stage}`);
    const dataPath = path.join(configDir, 'profiles.enc');
    const store = new ProfileStore(configDir, faultOperations(stage, dataPath));
    await assert.rejects(store.createAndUse('web-admin', {
      baseUrl: internals.DEFAULT_BASE_URL, phone: PHONE, password: PASSWORD, activeRole: 'WEB_ADMIN',
    }), /injected-/);
    await assert.rejects(access(configDir));
  }
});
