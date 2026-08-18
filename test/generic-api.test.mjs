import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test, { after } from 'node:test';

import { run } from '../src/cli.mjs';
import {
  GenericApiError,
  canonicalApiPath,
  executeGenericRequest,
  parseApiRequestArgs,
  prepareGenericRequest,
} from '../src/generic-api.mjs';

const ROOT = await mkdtemp(path.join(os.tmpdir(), 'jiaban-generic-test-'));
after(() => rm(ROOT, { recursive: true, force: true }));

function streamCapture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function invoke(argv, options = {}) {
  const stdout = streamCapture();
  const stderr = streamCapture();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return options.fetch ? options.fetch(url, init, calls.length) : jsonResponse(200, { code: 200, data: {} });
  };
  const configDir = options.configDir ?? path.join(ROOT, `config-${Date.now()}-${Math.random()}`);
  const env = {
    JIABAN_BASE_URL: 'http://127.0.0.1:8011',
    JIABAN_SESSION_TOKEN: 'session-secret-value',
    JIABAN_CONFIG_DIR: configDir,
    JIABAN_CLI_FULL_ACCESS_ENABLED: 'true',
    ...options.env,
  };
  const exitCode = await run(argv, {
    env,
    fetch: fetchImpl,
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const lines = stdout.value().trim().split('\n');
  assert.equal(lines.length, 1);
  return { exitCode, body: JSON.parse(lines[0]), stdout: stdout.value(), stderr: stderr.value(), calls, configDir };
}

test('canonical path accepts only relative /api paths and rejects encoded bypasses', () => {
  assert.equal(canonicalApiPath('/api/customers/1'), '/api/customers/1');
  for (const value of [
    'https://evil.test/api/x', '/api', '/api/x?secret=1', '/api/x#part', '/api/../x',
    '/api/%2e%2e/x', '/api/%252e%252e/x', '/api/%2f%2fevil.test', '/api/x\\y', '/api/auth/login',
  ]) {
    assert.throws(() => canonicalApiPath(value), GenericApiError, value);
  }
});

test('parser supports six methods, repeated query/header and rejects unsafe combinations', () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const tail = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? ['--dry-run', '--reason', 'T-1'] : [];
    assert.equal(parseApiRequestArgs([method, '/api/example', ...tail]).method, method);
  }
  const parsed = parseApiRequestArgs(['GET', '/api/example', '--query', 'a=1', '--query=a=2', '--header', 'x-test: ok']);
  assert.deepEqual(parsed.options.query, ['a=1', 'a=2']);
  assert.deepEqual(parsed.options.headers, ['x-test: ok']);
  assert.throws(() => parseApiRequestArgs(['POST', '/api/x', '--reason', 'T-1']), /--yes/);
  assert.throws(() => parseApiRequestArgs(['GET', '/api/x', '--json-stdin']), /禁止请求body/);
  assert.throws(() => parseApiRequestArgs(['GET', '/api/x', '--multipart']), /禁止请求body/);
  assert.throws(() => parseApiRequestArgs(['POST', '/api/x', '--multipart', '--dry-run', '--reason', 'T-1']), /至少需要/);
  assert.equal(parseApiRequestArgs(['GET', '/api/users/1/status']).highRisk, false);
  for (const pathValue of [
    '/api/users/1/status', '/api/flows/1/return-four-docs', '/api/flows/1/recall',
    '/api/flows/1/revise', '/api/flows/1/four-docs/regenerate', '/api/flows/1/payment-voucher/skip',
    '/api/flows/1/confirm-config', '/api/todos/1/complete', '/api/admin/users/1',
    '/api/senior/customers/1',
  ]) {
    const method = pathValue === '/api/users/1/status' ? 'PUT' : 'POST';
    const effectiveMethod = ['/api/admin/users/1', '/api/senior/customers/1'].includes(pathValue) ? 'PUT' : method;
    assert.equal(parseApiRequestArgs([effectiveMethod, pathValue, '--dry-run', '--reason', 'T-1']).highRisk, true, pathValue);
  }
});

test('full-access gate, protected headers and write confirmation fail before network', async () => {
  const disabled = await invoke(['api', 'request', 'GET', '/api/x'], { env: { JIABAN_CLI_FULL_ACCESS_ENABLED: '' } });
  assert.equal(disabled.body.error.code, 'FULL_ACCESS_DISABLED');
  assert.equal(disabled.calls.length, 0);

  const protectedHeader = await invoke(['api', 'request', 'GET', '/api/x', '--header', 'Authorization: Bearer stolen']);
  assert.equal(protectedHeader.body.error.code, 'PROTECTED_HEADER');
  assert.equal(protectedHeader.calls.length, 0);

  for (const name of ['X-HTTP-Method', 'X-HTTP-Method-Override', 'x-method-override', 'X-Original-URL', 'x-ReWrItE-uRl']) {
    const overridden = await invoke(['api', 'request', 'GET', '/api/x', '--header', `${name}: DELETE`]);
    assert.equal(overridden.body.error.code, 'PROTECTED_HEADER');
    assert.equal(overridden.calls.length, 0);
  }

  const missingYes = await invoke(['api', 'request', 'POST', '/api/x', '--reason', 'T-1']);
  assert.equal(missingYes.body.error.code, 'WRITE_CONFIRMATION_REQUIRED');
  assert.equal(missingYes.calls.length, 0);
});

test('ordinary dry-run performs zero network and contains names but no values', async () => {
  const result = await invoke([
    'api', 'request', 'POST', '/api/example', '--query', 'key=query-secret',
    '--header', 'x-test: header-secret', '--json-stdin', '--dry-run', '--reason', 'T-2',
  ], { stdin: JSON.stringify({ password: 'body-secret', name: 'safe' }) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.length, 0);
  assert.equal(result.body.data.dryRun, true);
  assert.deepEqual(result.body.data.request.queryKeys, ['key']);
  assert.deepEqual(result.body.data.request.headerNames, ['x-test']);
  for (const secret of ['query-secret', 'header-secret', 'body-secret']) assert.equal(result.stdout.includes(secret), false);
});

test('high-risk plan is five-minute single-use and bound to request body', async () => {
  const configDir = path.join(ROOT, 'plan-config');
  const args = ['api', 'request', 'POST', '/api/orders/1/approve', '--json-stdin', '--dry-run', '--reason', 'T-3'];
  const planned = await invoke(args, {
    configDir,
    stdin: '{"approved":true}',
    env: { JIABAN_CLI_DESTRUCTIVE_ENABLED: 'true' },
  });
  assert.equal(planned.calls.length, 0);
  assert.match(planned.body.data.planId, /^[a-f0-9]{32}$/);
  const executeArgs = [
    'api', 'request', 'POST', '/api/orders/1/approve', '--json-stdin', '--yes',
    '--reason', 'T-3', '--plan-id', planned.body.data.planId,
  ];
  const mismatch = await invoke(executeArgs, {
    configDir,
    stdin: '{"approved":false}',
    env: { JIABAN_CLI_DESTRUCTIVE_ENABLED: 'true' },
  });
  assert.equal(mismatch.body.error.code, 'PLAN_INVALID');
  assert.equal(mismatch.calls.length, 0);
  const reused = await invoke(executeArgs, {
    configDir,
    stdin: '{"approved":true}',
    env: { JIABAN_CLI_DESTRUCTIVE_ENABLED: 'true' },
  });
  assert.equal(reused.body.error.code, 'PLAN_INVALID');
  assert.equal(reused.calls.length, 0);
});

test('high-risk plan binds output target, overwrite and reason without persisting their values', async () => {
  const downloadRoot = path.join(ROOT, 'plan-downloads');
  await mkdir(downloadRoot, { recursive: true });
  const outputA = path.join(downloadRoot, 'a.bin');
  const outputB = path.join(downloadRoot, 'b.bin');
  const env = { JIABAN_CLI_DESTRUCTIVE_ENABLED: 'true', JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot };
  const variants = [
    { name: 'output', mutate: ['--output', outputB, '--yes', '--reason', 'PLAN-A'] },
    { name: 'overwrite', mutate: ['--output', outputA, '--overwrite', '--yes', '--reason', 'PLAN-A'] },
    { name: 'reason', mutate: ['--output', outputA, '--yes', '--reason', 'PLAN-B'] },
  ];
  for (const [index, variant] of variants.entries()) {
    const configDir = path.join(ROOT, `plan-bind-${index}`);
    const planned = await invoke([
      'api', 'request', 'POST', '/api/files/1/replace', '--output', outputA,
      '--dry-run', '--reason', 'PLAN-A',
    ], { configDir, env });
    const planId = planned.body.data.planId;
    const planText = await readFile(path.join(configDir, 'plans', `${planId}.json`), 'utf8');
    for (const value of [outputA, outputB, 'PLAN-A', 'PLAN-B']) assert.equal(planText.includes(value), false);
    const execution = await invoke([
      'api', 'request', 'POST', '/api/files/1/replace', ...variant.mutate, '--plan-id', planId,
    ], { configDir, env });
    assert.equal(execution.body.error.code, 'PLAN_INVALID', variant.name);
    assert.equal(execution.calls.length, 0);
  }
});

test('ordinary write uses injected token exactly once and never replays a 401', async () => {
  const result = await invoke(['api', 'request', 'PATCH', '/api/example/1', '--json-stdin', '--yes', '--reason', 'T-4'], {
    stdin: '{"status":"READY"}',
    fetch: async (_url, init) => {
      assert.equal(init.headers.trust_token, 'session-secret-value');
      return jsonResponse(401, { code: 401, message: 'no' });
    },
  });
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
  assert.equal(result.calls.length, 1);
  assert.equal(result.stdout.includes('session-secret-value'), false);

  const network = await invoke(['api', 'request', 'POST', '/api/example', '--yes', '--reason', 'T-4'], {
    fetch: async () => { throw new Error('socket failed with session-secret-value'); },
  });
  assert.equal(network.body.error.code, 'NETWORK_ERROR');
  assert.equal(network.calls.length, 1);
  assert.equal(network.stdout.includes('session-secret-value'), false);
});

test('credential GET may re-login and retry once, while credentials never reach stdout', async () => {
  let loginCount = 0;
  let getCount = 0;
  const password = 'password-never-print';
  const result = await invoke(['api', 'request', 'GET', '/api/example'], {
    env: { JIABAN_SESSION_TOKEN: '', JIABAN_INTEGRATION_PHONE: '13800138000', JIABAN_INTEGRATION_PASSWORD: password },
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/auth/login')) {
        loginCount += 1;
        const payload = JSON.parse(init.body);
        assert.deepEqual(payload, { phone: '13800138000', password, clientType: 'cli', activeRole: 'SENIOR_ADMIN' });
        return jsonResponse(200, { code: 200, data: { tokenValue: `temporary-token-${loginCount}` } });
      }
      getCount += 1;
      assert.equal(init.headers.trust_token, `temporary-token-${getCount}`);
      return getCount === 1
        ? jsonResponse(401, { code: 401 })
        : jsonResponse(200, { code: 200, data: { password, token: 'response-secret', ok: true } });
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(loginCount, 2);
  assert.equal(getCount, 2);
  assert.deepEqual(result.body.response.data, { password: '[REDACTED]', token: '[REDACTED]', ok: true });
  for (const secret of [password, 'temporary-token-1', 'temporary-token-2', 'response-secret']) assert.equal(result.stdout.includes(secret), false);
});

test('JSON file, raw file and multipart uploads stay under absolute upload root', async () => {
  const uploadRoot = path.join(ROOT, 'uploads');
  await mkdir(uploadRoot, { recursive: true });
  const jsonPath = path.join(uploadRoot, 'body.json');
  const rawPath = path.join(uploadRoot, 'payload.bin');
  await writeFile(jsonPath, '{"hello":"world"}');
  await writeFile(rawPath, Buffer.from([0, 1, 2, 3]));
  const env = { JIABAN_CLI_FULL_ACCESS_ENABLED: 'true', JIABAN_CLI_UPLOAD_ROOT: uploadRoot };
  const configDir = path.join(ROOT, 'prepare-config');

  const jsonPrepared = await prepareGenericRequest({
    request: parseApiRequestArgs(['POST', '/api/json', '--json-file', jsonPath, '--dry-run', '--reason', 'T-5']),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  });
  assert.equal(jsonPrepared.summary.bodyMode, 'json');
  assert.equal(jsonPrepared.summary.files[0].field, 'json-body');

  const rawPrepared = await prepareGenericRequest({
    request: parseApiRequestArgs(['POST', '/api/raw', '--body-file', rawPath, '--content-type', 'application/octet-stream', '--dry-run', '--reason', 'T-5']),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  });
  assert.equal(rawPrepared.summary.files[0].size, 4);

  const multipartPrepared = await prepareGenericRequest({
    request: parseApiRequestArgs(['POST', '/api/upload', '--multipart', '--form', 'caption=ok', '--json-part', 'meta={"a":1}', '--upload', `file=${rawPath}`, '--dry-run', '--reason', 'T-5']),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  });
  assert.equal(multipartPrepared.summary.bodyMode, 'multipart');
  assert.equal(multipartPrepared.summary.files[0].size, 4);

  const pdfPath = path.join(uploadRoot, 'contract.pdf');
  await writeFile(pdfPath, '%PDF-test');
  const typedPrepared = await prepareGenericRequest({
    request: parseApiRequestArgs([
      'POST', '/api/upload', '--multipart', '--upload', `files=${pdfPath}`,
      '--upload', `files=${rawPath};type=application/pdf`, '--yes', '--reason', 'T-5',
    ]),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  });
  const uploaded = typedPrepared.body.getAll('files');
  assert.deepEqual(uploaded.map((part) => part.type), ['application/pdf', 'application/pdf']);
  await assert.rejects(prepareGenericRequest({
    request: parseApiRequestArgs([
      'POST', '/api/upload', '--multipart', '--upload', `file=${rawPath};type=application/pdf\r\nx-bad:1`,
      '--yes', '--reason', 'T-5',
    ]),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  }), (error) => error.code === 'INVALID_BODY');

  const outside = path.join(ROOT, 'outside.json');
  await writeFile(outside, '{}');
  await assert.rejects(prepareGenericRequest({
    request: parseApiRequestArgs(['POST', '/api/x', '--json-file', outside, '--dry-run', '--reason', 'T-5']),
    env, stdin: Readable.from([]), profileKey: 'test', configDir,
  }), (error) => error.code === 'FILE_OUTSIDE_ROOT');
});

test('symlink upload is rejected where supported', async (t) => {
  const uploadRoot = path.join(ROOT, 'symlink-root');
  await mkdir(uploadRoot, { recursive: true });
  const target = path.join(uploadRoot, 'target.json');
  const link = path.join(uploadRoot, 'link.json');
  await writeFile(target, '{}');
  try { await symlink(target, link, 'file'); } catch { t.skip('host does not permit symlink creation'); return; }
  await assert.rejects(prepareGenericRequest({
    request: parseApiRequestArgs(['POST', '/api/x', '--json-file', link, '--dry-run', '--reason', 'T-6']),
    env: { JIABAN_CLI_FULL_ACCESS_ENABLED: 'true', JIABAN_CLI_UPLOAD_ROOT: uploadRoot },
    stdin: Readable.from([]), profileKey: 'test', configDir: path.join(ROOT, 'symlink-config'),
  }), (error) => error.code === 'INVALID_FILE');
});

test('binary download is atomic, does not overwrite by default, and never writes binary to stdout', async () => {
  const downloadRoot = path.join(ROOT, 'downloads');
  await mkdir(downloadRoot, { recursive: true });
  const output = path.join(downloadRoot, 'payload.bin');
  const result = await invoke(['api', 'request', 'GET', '/api/file', '--output', output], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
    fetch: async () => new Response(Buffer.from([0, 255, 1, 2]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.response.file.basename, 'payload.bin');
  assert.equal(Object.hasOwn(result.body.response.file, 'path'), false);
  assert.deepEqual([...await readFile(output)], [0, 255, 1, 2]);
  assert.equal(result.stdout.includes('\u0000'), false);
  const info = await lstat(output);
  assert.equal(info.isFile(), true);

  const existing = await invoke(['api', 'request', 'GET', '/api/file', '--output', output], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
  });
  assert.equal(existing.body.error.code, 'OUTPUT_EXISTS');
  assert.equal(existing.calls.length, 0);

  const overwritten = await invoke(['api', 'request', 'GET', '/api/file', '--output', output, '--overwrite'], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
    fetch: async () => new Response(Buffer.from([9, 8]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  });
  assert.equal(overwritten.exitCode, 0);
  assert.deepEqual([...await readFile(output)], [9, 8]);
});

test('download rejects oversized Content-Length and streaming overflow without leaving files', async () => {
  const downloadRoot = path.join(ROOT, 'limited-downloads');
  await mkdir(downloadRoot, { recursive: true });
  const declaredTarget = path.join(downloadRoot, 'declared.bin');
  const declared = await invoke(['api', 'request', 'GET', '/api/file', '--output', declaredTarget], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
    fetch: async () => new Response(Buffer.from([1]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(100 * 1024 * 1024 + 1) },
    }),
  });
  assert.equal(declared.body.error.code, 'RESPONSE_TOO_LARGE');
  assert.equal((await readdir(downloadRoot)).length, 0);

  const streamedTarget = path.join(downloadRoot, 'streamed.bin');
  const prepared = {
    request: { method: 'GET', apiPath: '/api/file', highRisk: false, options: { overwrite: false } },
    query: new URLSearchParams(), headers: {}, body: undefined, outputPath: streamedTarget,
  };
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3]));
      controller.enqueue(Uint8Array.from([4, 5, 6]));
      controller.close();
    },
  });
  await assert.rejects(executeGenericRequest({
    prepared, baseUrl: 'https://example.test', token: 'token', maxDownloadBytes: 4,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'application/octet-stream' } }),
  }), (error) => error.code === 'RESPONSE_TOO_LARGE');
  assert.deepEqual(await readdir(downloadRoot), []);
});

test('JSON business error with --output is validated before any file is created', async () => {
  const downloadRoot = path.join(ROOT, 'json-downloads');
  await mkdir(downloadRoot, { recursive: true });
  const output = path.join(downloadRoot, 'result.json');
  const result = await invoke(['api', 'request', 'GET', '/api/export', '--output', output], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
    fetch: async () => jsonResponse(200, { code: 403, message: 'internal details' }),
  });
  assert.equal(result.body.error.code, 'FORBIDDEN');
  assert.deepEqual(await readdir(downloadRoot), []);
  const audit = await readFile(path.join(result.configDir, 'api-audit.jsonl'), 'utf8');
  assert.equal(audit.includes('success'), false);

  const success = await invoke(['api', 'request', 'GET', '/api/export', '--output', output], {
    env: { JIABAN_CLI_DOWNLOAD_ROOT: downloadRoot },
    fetch: async () => jsonResponse(200, { raw: true }),
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.body.response.file.basename, 'result.json');
  assert.equal(Object.hasOwn(success.body.response.file, 'path'), false);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { raw: true });
});

test('generic request rejects redirects and enforces its timeout', async () => {
  const redirect = await invoke(['api', 'request', 'GET', '/api/redirect'], {
    fetch: async (_url, init) => {
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/api/x' } });
    },
  });
  assert.equal(redirect.body.error.code, 'REDIRECT_REJECTED');
  assert.equal(redirect.calls.length, 1);

  const prepared = {
    request: { method: 'GET', apiPath: '/api/slow', highRisk: false, options: {} },
    query: new URLSearchParams(), headers: {}, body: undefined, outputPath: null,
  };
  await assert.rejects(executeGenericRequest({
    prepared,
    baseUrl: 'https://example.test',
    token: 'token',
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  }), (error) => error.code === 'TIMEOUT');
});

test('generic responses support ApiResponse, raw JSON, text, 204 and require output for binary', async () => {
  const base = { method: 'GET', apiPath: '/api/x', highRisk: false, options: {} };
  const prepared = { request: base, query: new URLSearchParams(), headers: {}, body: undefined, outputPath: null };
  const call = (response, secrets = []) => executeGenericRequest({ prepared, baseUrl: 'https://example.test', token: 'token', fetchImpl: async () => response, secrets });
  assert.deepEqual((await call(jsonResponse(200, { code: 200, data: { ok: true } }))).data, { ok: true });
  assert.deepEqual((await call(jsonResponse(200, { hello: 'world' }))).data, { hello: 'world' });
  assert.deepEqual((await call(jsonResponse(200, { code: 200, data: { value: 'known-secret' } }), ['known-secret'])).data, { value: '[REDACTED]' });
  await assert.rejects(call(jsonResponse(200, { code: 401, message: 'token expired' })), (error) => error.code === 'UNAUTHENTICATED');
  await assert.rejects(call(jsonResponse(200, { code: 403, message: 'denied' })), (error) => error.code === 'FORBIDDEN');
  await assert.rejects(call(jsonResponse(200, { code: 404, message: 'missing' })), (error) => error.code === 'NOT_FOUND');
  assert.equal((await call(new Response('secret-text', { headers: { 'content-type': 'text/plain' } }), ['secret-text'])).text, '[REDACTED]');
  assert.equal((await call(new Response(null, { status: 204 }))).data, null);
  await assert.rejects(call(new Response(Buffer.from([1, 2]), { headers: { 'content-type': 'application/octet-stream' } })), (error) => error.code === 'BINARY_OUTPUT_REQUIRED');
});

test('audit JSONL excludes query, headers, bodies and credentials', async () => {
  const configDir = path.join(ROOT, 'audit-config');
  const secretValues = ['query-value', 'header-value', 'body-value', 'session-secret-value'];
  const result = await invoke([
    'api', 'request', 'POST', '/api/audit', '--query', `q=${secretValues[0]}`,
    '--header', `x-test: ${secretValues[1]}`, '--json-stdin', '--yes', '--reason', 'T-7',
  ], { configDir, stdin: JSON.stringify({ value: secretValues[2] }) });
  assert.equal(result.exitCode, 0);
  const audit = await readFile(path.join(configDir, 'api-audit.jsonl'), 'utf8');
  for (const secret of secretValues) assert.equal(audit.includes(secret), false);
  for (const line of audit.trim().split('\n')) {
    const item = JSON.parse(line);
    assert.equal(item.path, '/api/audit');
    assert.equal(Object.hasOwn(item, 'body'), false);
    assert.equal(Object.hasOwn(item, 'query'), false);
    assert.equal(Object.hasOwn(item, 'headers'), false);
  }
});
