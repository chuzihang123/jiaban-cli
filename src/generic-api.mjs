import { createHash, randomBytes } from 'node:crypto';
import { appendFile, chmod, link, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HIGH_RISK_PATH = /(reset-password|status|permissions|approve|reject|sign|publish|forward|archive|withdraw|replace)/i;
const PROTECTED_HEADERS = /^(host|trust_token|authorization|cookie|set-cookie|content-length|transfer-encoding|connection|proxy-|forwarded$|x-forwarded-|content-type$|origin$|referer$|accept-encoding$|expect$|te$|trailer$|upgrade$|x-http-method$|x-http-method-override$|x-method-override$|x-original-url$|x-rewrite-url$)/i;
const SECRET_KEYS = /password|token|secret|authorization|cookie/i;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const UPLOAD_MIME_TYPES = new Map([
  ['.pdf', 'application/pdf'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'], ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.csv', 'text/csv'], ['.txt', 'text/plain'], ['.json', 'application/json'], ['.zip', 'application/zip'],
]);

export class GenericApiError extends Error {
  constructor(code, message, exitCode = 2, details = {}) {
    super(message);
    this.name = 'GenericApiError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, exitCode = 2, details = {}) {
  throw new GenericApiError(code, message, exitCode, details);
}

function parsePair(value, label, separator = '=') {
  const index = value.indexOf(separator);
  if (index <= 0) fail('INVALID_ARGUMENT', `${label} 必须是 name${separator}value`);
  return [value.slice(0, index), value.slice(index + 1)];
}

function pushOption(options, key, value) {
  if (!options[key]) options[key] = [];
  options[key].push(value);
}

export function canonicalApiPath(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/api/')) fail('INVALID_PATH', 'PATH 必须以 /api/ 开头');
  if (/[?#\\\u0000-\u001f\u007f]/.test(raw) || /%25|%2f|%5c|%2e/i.test(raw) || raw.includes('//')) {
    fail('INVALID_PATH', 'PATH 包含禁止的URL结构或编码');
  }
  if (raw.split('/').some((part) => part === '.' || part === '..')) fail('INVALID_PATH', 'PATH 禁止目录遍历');
  let decoded = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    try { decoded = decodeURIComponent(decoded); } catch { fail('INVALID_PATH', 'PATH 编码无效'); }
    if (decoded.split('/').some((part) => part === '.' || part === '..')
      || /[\\?#\u0000-\u001f\u007f]/.test(decoded) || /%2f|%5c|%2e/i.test(decoded)) {
      fail('INVALID_PATH', 'PATH 解码后不安全');
    }
    if (!decoded.includes('%')) break;
  }
  const normalized = new URL(raw, 'https://safe.invalid').pathname;
  if (!normalized.startsWith('/api/') || normalized !== raw) fail('INVALID_PATH', 'PATH 规范化结果不一致');
  if (normalized === '/api/auth/login') fail('RESERVED_PATH', '登录端点仅供CLI内部认证');
  return normalized;
}

export function parseApiRequestArgs(args) {
  if (args.length < 2) fail('INVALID_ARGUMENT', '用法：api request METHOD /api/path');
  const method = String(args[0]).toUpperCase();
  if (!METHODS.has(method)) fail('INVALID_METHOD', 'METHOD 仅允许 GET/HEAD/POST/PUT/PATCH/DELETE');
  const apiPath = canonicalApiPath(args[1]);
  const options = { query: [], headers: [], forms: [], uploads: [], jsonParts: [], yes: false, dryRun: false, overwrite: false };
  const valueOptions = new Set(['query', 'header', 'json-file', 'body-file', 'content-type', 'form', 'upload', 'json-part', 'output', 'reason', 'plan-id']);
  const booleanOptions = new Set(['json-stdin', 'multipart', 'yes', 'dry-run', 'overwrite']);
  for (let index = 2; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) fail('INVALID_ARGUMENT', `不支持的参数：${token}`);
    const equalsAt = token.indexOf('=');
    const key = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    if (booleanOptions.has(key)) {
      if (equalsAt !== -1) fail('INVALID_ARGUMENT', `--${key} 不接受值`);
      const mapped = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (options[mapped]) fail('INVALID_ARGUMENT', `--${key} 不可重复`);
      options[mapped] = true;
      continue;
    }
    if (!valueOptions.has(key)) fail('INVALID_ARGUMENT', `未知选项：--${key}`);
    const value = equalsAt === -1 ? args[++index] : token.slice(equalsAt + 1);
    if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT', `--${key} 缺少值`);
    const repeatMap = { query: 'query', header: 'headers', form: 'forms', upload: 'uploads', 'json-part': 'jsonParts' };
    if (repeatMap[key]) pushOption(options, repeatMap[key], value);
    else {
      const mapped = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (options[mapped] !== undefined) fail('INVALID_ARGUMENT', `--${key} 不可重复`);
      options[mapped] = value;
    }
  }
  if (['GET', 'HEAD'].includes(method) && (options.jsonStdin || options.jsonFile || options.bodyFile || options.multipart || options.forms.length || options.uploads.length || options.jsonParts.length)) {
    fail('INVALID_BODY', `${method} 禁止请求body`);
  }
  const bodyModes = [options.jsonStdin || options.jsonFile, options.bodyFile, options.forms.length || options.uploads.length || options.jsonParts.length].filter(Boolean).length;
  if (bodyModes > 1 || (options.jsonStdin && options.jsonFile)) fail('INVALID_BODY', 'body模式互斥');
  if (options.bodyFile && !options.contentType) fail('INVALID_BODY', '--body-file 必须同时提供 --content-type');
  if (options.contentType && !options.bodyFile) fail('INVALID_BODY', '--content-type 仅用于 --body-file');
  if ((options.uploads.length || options.jsonParts.length) && !options.multipart) fail('INVALID_BODY', 'upload/json-part 必须配合 --multipart');
  if (options.multipart && !(options.forms.length || options.uploads.length || options.jsonParts.length)) fail('INVALID_BODY', '--multipart 至少需要一个字段或文件');
  if (options.overwrite && !options.output) fail('INVALID_OUTPUT', '--overwrite 必须配合 --output');
  if (options.reason && (options.reason.length > 512 || /[\u0000-\u001f\u007f]/.test(options.reason))) fail('INVALID_ARGUMENT', '--reason 格式无效');
  const highRisk = method === 'DELETE' || HIGH_RISK_PATH.test(apiPath);
  if ((WRITE_METHODS.has(method) || highRisk) && !options.reason?.trim()) fail('WRITE_CONFIRMATION_REQUIRED', '写入或高危请求必须提供 --reason');
  if ((WRITE_METHODS.has(method) || highRisk) && !options.dryRun && !options.yes) fail('WRITE_CONFIRMATION_REQUIRED', '执行写入或高危请求必须提供 --yes');
  return { method, apiPath, options, highRisk };
}

function contained(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function checkedInputFile(rawPath, rootRaw) {
  if (!rootRaw || !path.isAbsolute(rootRaw)) fail('UPLOAD_ROOT_REQUIRED', '上传/请求文件要求绝对 JIABAN_CLI_UPLOAD_ROOT', 3);
  if (!path.isAbsolute(rawPath)) fail('INVALID_FILE', '输入文件路径必须是绝对路径');
  const [root, fileInfo] = await Promise.all([realpath(rootRaw), lstat(rawPath)]);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) fail('INVALID_FILE', '输入必须是非链接普通文件');
  const target = await realpath(rawPath);
  if (!contained(root, target)) fail('FILE_OUTSIDE_ROOT', '输入文件不在上传根目录内');
  if (fileInfo.size > MAX_UPLOAD_BYTES) fail('FILE_TOO_LARGE', '单个输入文件超过50MiB');
  return { path: target, size: fileInfo.size, bytes: await readFile(target) };
}

async function checkedOutputPath(rawPath, rootRaw, overwrite) {
  if (!rootRaw || !path.isAbsolute(rootRaw)) fail('DOWNLOAD_ROOT_REQUIRED', '下载要求绝对 JIABAN_CLI_DOWNLOAD_ROOT', 3);
  if (!path.isAbsolute(rawPath)) fail('INVALID_OUTPUT', '输出文件必须是绝对路径');
  const root = await realpath(rootRaw);
  const parent = await realpath(path.dirname(rawPath));
  const target = path.join(parent, path.basename(rawPath));
  if (!contained(root, target)) fail('FILE_OUTSIDE_ROOT', '输出文件不在下载根目录内');
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) fail('INVALID_OUTPUT', '现有输出目标不是普通文件');
    if (!overwrite) fail('OUTPUT_EXISTS', '输出文件已存在，需显式 --overwrite');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const relative = path.relative(root, target).split(path.sep).join('/');
  return { path: target, relative };
}

function hashBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function stableHash(value) { return hashBytes(Buffer.from(JSON.stringify(value))); }

async function readStdin(stdin, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stdin) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) fail('BODY_TOO_LARGE', 'stdin JSON超过大小限制');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_JSON', `${label} 不是有效JSON`); }
}

function validateMimeType(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)
    || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;[^\r\n]*)?$/.test(value)) {
    fail('INVALID_BODY', 'MIME type 格式无效');
  }
  return value;
}

function parseUploadOption(item) {
  const [field, raw] = parsePair(item, '--upload');
  const marker = raw.lastIndexOf(';type=');
  const filePath = marker === -1 ? raw : raw.slice(0, marker);
  if (!filePath) fail('INVALID_FILE', '--upload 文件路径不能为空');
  const contentType = marker === -1
    ? (UPLOAD_MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream')
    : validateMimeType(raw.slice(marker + ';type='.length));
  return { field, filePath, contentType };
}

export async function prepareGenericRequest({ request, env, stdin, profileKey, configDir, baseUrl = '' }) {
  if (env.JIABAN_CLI_FULL_ACCESS_ENABLED !== 'true') fail('FULL_ACCESS_DISABLED', '通用接口能力未启用', 3);
  if (request.highRisk && env.JIABAN_CLI_DESTRUCTIVE_ENABLED !== 'true') fail('DESTRUCTIVE_DISABLED', '高危接口能力未启用', 3);
  if (request.options.query.length > 100 || request.options.headers.length > 100) fail('INVALID_ARGUMENT', 'query/header 数量过多');
  const query = new URLSearchParams();
  for (const item of request.options.query) {
    const [key, value] = parsePair(item, '--query');
    if (key.length > 256 || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(key + value)) fail('INVALID_QUERY', 'query格式无效');
    query.append(key, value);
  }
  const headers = {};
  for (const item of request.options.headers) {
    const [name, value] = parsePair(item, '--header', ':');
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (trimmedName.length > 128 || trimmedValue.length > 8192 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(trimmedName) || /[\r\n]/.test(trimmedValue) || PROTECTED_HEADERS.test(trimmedName)) {
      fail('PROTECTED_HEADER', `禁止请求Header：${trimmedName}`);
    }
    headers[trimmedName] = trimmedValue;
  }
  let body;
  let bodyMode = 'none';
  const fileHashes = [];
  let totalUpload = 0;
  if (request.options.jsonStdin || request.options.jsonFile) {
    let bytes;
    if (request.options.jsonStdin) bytes = await readStdin(stdin, MAX_UPLOAD_BYTES);
    else {
      const file = await checkedInputFile(request.options.jsonFile, env.JIABAN_CLI_UPLOAD_ROOT);
      bytes = file.bytes;
      fileHashes.push({ field: 'json-body', sha256: hashBytes(file.bytes), size: file.size });
      totalUpload += file.size;
    }
    const json = parseJson(bytes, 'JSON body');
    body = JSON.stringify(json);
    bodyMode = 'json';
    headers['content-type'] = 'application/json';
  } else if (request.options.bodyFile) {
    const file = await checkedInputFile(request.options.bodyFile, env.JIABAN_CLI_UPLOAD_ROOT);
    body = file.bytes;
    bodyMode = 'raw-file';
    headers['content-type'] = validateMimeType(request.options.contentType);
    fileHashes.push({ field: 'body', sha256: hashBytes(file.bytes), size: file.size });
    totalUpload += file.size;
  } else if (request.options.forms.length || request.options.uploads.length || request.options.jsonParts.length) {
    const multipart = request.options.multipart || request.options.uploads.length || request.options.jsonParts.length;
    if (multipart) {
      body = new FormData();
      for (const item of request.options.forms) { const [key, value] = parsePair(item, '--form'); validatePart(key, value); body.append(key, value); }
      for (const item of request.options.jsonParts) { const [key, value] = parsePair(item, '--json-part'); validatePart(key, value); body.append(key, new Blob([JSON.stringify(parseJson(Buffer.from(value), 'JSON part'))], { type: 'application/json' })); }
      for (const item of request.options.uploads) {
        const { field, filePath, contentType } = parseUploadOption(item);
        validatePart(field, '');
        const file = await checkedInputFile(filePath, env.JIABAN_CLI_UPLOAD_ROOT);
        totalUpload += file.size;
        fileHashes.push({ field, sha256: hashBytes(file.bytes), size: file.size, contentType });
        body.append(field, new Blob([file.bytes], { type: contentType }), path.basename(file.path));
      }
      bodyMode = 'multipart';
    } else {
      const form = new URLSearchParams();
      for (const item of request.options.forms) { const [key, value] = parsePair(item, '--form'); validatePart(key, value); form.append(key, value); }
      body = form.toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
      bodyMode = 'form';
    }
  }
  if (totalUpload > MAX_TOTAL_UPLOAD_BYTES) fail('FILE_TOO_LARGE', '上传总量超过100MiB');
  const output = request.options.output ? await checkedOutputPath(request.options.output, env.JIABAN_CLI_DOWNLOAD_ROOT, request.options.overwrite) : null;
  const outputPath = output?.path ?? null;
  const payloadHash = body instanceof FormData
    ? stableHash({ mode: bodyMode, forms: request.options.forms, jsonParts: request.options.jsonParts, files: fileHashes })
    : hashBytes(Buffer.from(body ?? ''));
  const bodyHash = stableHash({ mode: bodyMode, contentType: headers['content-type'] ?? null, payloadHash });
  const binding = {
    profile: profileKey,
    originHash: stableHash(baseUrl),
    method: request.method,
    path: request.apiPath,
    queryHash: stableHash([...query]),
    headerHash: stableHash(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))),
    bodyHash,
    fileHashes,
    outputHash: stableHash(output?.relative ?? null),
    overwrite: request.options.overwrite,
    reasonHash: stableHash(request.options.reason ?? null),
  };
  if (request.highRisk && request.options.dryRun) {
    const planId = randomBytes(16).toString('hex');
    const plansDir = path.join(configDir, 'plans');
    await mkdir(plansDir, { recursive: true, mode: 0o700 });
    const planPath = path.join(plansDir, `${planId}.json`);
    await writeFile(planPath, JSON.stringify({ ...binding, expiresAt: Date.now() + 300_000 }), { flag: 'wx', mode: 0o600 });
    await chmod(planPath, 0o600).catch(() => {});
    return { dryRun: true, planId, summary: safeSummary(request, bodyMode, fileHashes), audit: { configDir, profileKey, request, planId } };
  }
  if (request.highRisk) {
    if (!request.options.planId || !/^[a-f0-9]{32}$/.test(request.options.planId)) fail('PLAN_REQUIRED', '高危请求必须提供dry-run生成的 --plan-id');
    const planPath = path.join(configDir, 'plans', `${request.options.planId}.json`);
    let saved;
    try { saved = JSON.parse(await readFile(planPath, 'utf8')); } catch { fail('PLAN_INVALID', 'plan不存在或已使用'); }
    await unlink(planPath);
    if (saved.expiresAt < Date.now()
      || ['profile', 'originHash', 'method', 'path', 'queryHash', 'headerHash', 'bodyHash', 'outputHash', 'overwrite', 'reasonHash'].some((key) => saved[key] !== binding[key])
      || stableHash(saved.fileHashes) !== stableHash(binding.fileHashes)) {
      fail('PLAN_INVALID', 'plan已过期或与当前请求不匹配');
    }
  }
  if (request.options.dryRun) return { dryRun: true, planId: null, summary: safeSummary(request, bodyMode, fileHashes), audit: { configDir, profileKey, request } };
  return { dryRun: false, request, query, headers, body, outputPath, bodyMode, binding, audit: { configDir, profileKey, request, planId: request.options.planId } };
}

function validatePart(name, value) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name) || Buffer.byteLength(value) > MAX_TEXT_BYTES) {
    fail('INVALID_BODY', '表单字段格式或大小无效');
  }
}

function safeSummary(request, bodyMode, files) {
  return { method: request.method, path: request.apiPath, queryKeys: request.options.query.map((v) => parsePair(v, '--query')[0]), headerNames: request.options.headers.map((v) => parsePair(v, '--header', ':')[0].trim()), bodyMode, files: files.map(({ field, size, sha256, contentType }) => ({ field, size, sha256, ...(contentType ? { contentType } : {}) })) };
}

export async function appendAudit({ configDir, profileKey, request, planId, outcome }) {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), profile: profileKey, method: request.method, path: request.apiPath, highRisk: request.highRisk, planId: planId ?? null, outcome }) + '\n';
  const auditPath = path.join(configDir, 'api-audit.jsonl');
  await appendFile(auditPath, line, { encoding: 'utf8', mode: 0o600 });
  await chmod(auditPath, 0o600).catch(() => {});
}

function redactJson(value, secrets = [], seen = new WeakSet()) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secrets, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redactJson(item, secrets, seen)]));
}

function redactText(value, secrets = []) {
  let result = value;
  for (const secret of secrets.filter((item) => typeof item === 'string' && item.length > 0)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

function safeHeaders(response) {
  const result = {};
  for (const name of ['content-type', 'content-length', 'etag', 'last-modified', 'x-request-id']) {
    const value = response.headers.get(name); if (value) result[name] = value;
  }
  return result;
}

function checkContentLength(response, maximum) {
  const raw = response.headers.get('content-length');
  if (raw && /^\d+$/.test(raw) && Number(raw) > maximum) {
    response.body?.cancel().catch(() => {});
    fail('RESPONSE_TOO_LARGE', '响应超过允许大小', 6);
  }
}

async function readWithAbort(reader, signal) {
  if (signal.aborted) fail('TIMEOUT', '请求超过10秒', 7);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reader.cancel().catch(() => {});
      reject(new GenericApiError('TIMEOUT', '请求超过10秒', 7));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function readResponseLimited(response, maximum, signal) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        fail('RESPONSE_TOO_LARGE', '响应超过允许大小', 6);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof GenericApiError) throw error;
    if (signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) fail('TIMEOUT', '请求超过10秒', 7);
    fail('NETWORK_ERROR', '响应读取失败', 7);
  }
}

async function writeChunk(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
    offset += bytesWritten;
  }
}

async function commitTempFile(tempPath, targetPath, overwrite) {
  try {
    if (overwrite) await rename(tempPath, targetPath);
    else { await link(tempPath, targetPath); await unlink(tempPath); }
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    if (error?.code === 'EEXIST') fail('OUTPUT_EXISTS', '输出文件已存在，需显式 --overwrite');
    throw error;
  }
}

async function writeBytesAtomic(bytes, targetPath, overwrite) {
  const tempPath = `${targetPath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
  await commitTempFile(tempPath, targetPath, overwrite);
  return { basename: path.basename(targetPath), bytes: bytes.length, sha256: hashBytes(bytes) };
}

async function streamResponseAtomic(response, targetPath, overwrite, maximum, signal) {
  const tempPath = `${targetPath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  const handle = await open(tempPath, 'wx', 0o600);
  const digest = createHash('sha256');
  const reader = response.body?.getReader();
  let total = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await readWithAbort(reader, signal);
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maximum) {
          await reader.cancel().catch(() => {});
          fail('RESPONSE_TOO_LARGE', '响应超过允许大小', 6);
        }
        digest.update(chunk);
        await writeChunk(handle, chunk);
      }
    }
    await handle.sync();
    await handle.close();
    await commitTempFile(tempPath, targetPath, overwrite);
    return { basename: path.basename(targetPath), bytes: total, sha256: digest.digest('hex') };
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    if (error instanceof GenericApiError) throw error;
    if (signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) fail('TIMEOUT', '请求超过10秒', 7);
    fail('NETWORK_ERROR', '响应写入失败', 7);
  }
}

function validateBusinessJson(data, response) {
  if (data && typeof data === 'object' && Object.hasOwn(data, 'code') && Number(data.code) !== 200) {
    if (Number(data.code) === 401) fail('UNAUTHENTICATED', '会话未认证或已失效', 4, { httpStatus: response.status, businessCode: data.code });
    if (Number(data.code) === 403) fail('FORBIDDEN', '当前会话没有访问权限', 4, { httpStatus: response.status, businessCode: data.code });
    if (Number(data.code) === 404) fail('NOT_FOUND', '资源不存在', 5, { httpStatus: response.status, businessCode: data.code });
    fail('BUSINESS_ERROR', '后端返回业务错误', 6, { httpStatus: response.status, businessCode: data.code });
  }
}

export async function executeGenericRequest({ prepared, baseUrl, token, fetchImpl, timeoutMs = 10_000, secrets = [], maxDownloadBytes = MAX_DOWNLOAD_BYTES }) {
  const { request } = prepared;
  const url = new URL(request.apiPath, `${baseUrl}/`);
  for (const [key, value] of prepared.query) url.searchParams.append(key, value);
  if (url.origin !== baseUrl) fail('CROSS_ORIGIN_REQUEST', '拒绝跨origin请求', 3);
  if (url.href.length > 8192) fail('INVALID_QUERY', '请求URL过长');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { method: request.method, headers: { ...prepared.headers, trust_token: token }, ...(prepared.body === undefined ? {} : { body: prepared.body }), redirect: 'manual', signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) fail('TIMEOUT', '请求超过10秒', 7);
    fail('NETWORK_ERROR', '网络请求失败', 7);
  }
  try {
    if (response.status >= 300 && response.status < 400) fail('REDIRECT_REJECTED', '拒绝后端重定向', 6, { httpStatus: response.status });
    if (response.status === 401) fail('UNAUTHENTICATED', '会话未认证或已失效', 4, { httpStatus: 401 });
    if (response.status === 403) fail('FORBIDDEN', '当前会话没有访问权限', 4, { httpStatus: 403 });
    if (response.status === 404) fail('NOT_FOUND', '资源不存在', 5, { httpStatus: 404 });
    if (!response.ok) fail('HTTP_ERROR', '后端请求失败', 6, { httpStatus: response.status });
    checkContentLength(response, maxDownloadBytes);
    const headers = safeHeaders(response);
    if (response.status === 204 || request.method === 'HEAD') return { httpStatus: response.status, headers, data: null };
    const contentType = response.headers.get('content-type') ?? '';
    if (/json/i.test(contentType)) {
      checkContentLength(response, Math.min(maxDownloadBytes, MAX_JSON_BYTES));
      const bytes = await readResponseLimited(response, Math.min(maxDownloadBytes, MAX_JSON_BYTES), controller.signal);
      const data = parseJson(bytes, '响应');
      validateBusinessJson(data, response);
      if (prepared.outputPath) {
        const file = await writeBytesAtomic(bytes, prepared.outputPath, request.options.overwrite);
        return { httpStatus: response.status, headers, file };
      }
      if (data && typeof data === 'object' && Number(data.code) === 200 && Object.hasOwn(data, 'data')) {
        return { httpStatus: response.status, headers, businessCode: 200, data: redactJson(data.data, secrets) };
      }
      return { httpStatus: response.status, headers, data: redactJson(data, secrets) };
    }
    if (prepared.outputPath) {
      const file = await streamResponseAtomic(response, prepared.outputPath, request.options.overwrite, maxDownloadBytes, controller.signal);
      return { httpStatus: response.status, headers, file };
    }
    if (/^text\//i.test(contentType) || /charset=/i.test(contentType)) {
      checkContentLength(response, Math.min(maxDownloadBytes, MAX_TEXT_BYTES));
      const bytes = await readResponseLimited(response, Math.min(maxDownloadBytes, MAX_TEXT_BYTES), controller.signal);
      return { httpStatus: response.status, headers, text: redactText(bytes.toString('utf8'), secrets) };
    }
    await response.body?.cancel().catch(() => {});
    fail('BINARY_OUTPUT_REQUIRED', '二进制响应必须使用 --output', 6);
  } finally {
    clearTimeout(timer);
  }
}
