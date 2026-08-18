import { ProfileStore, ProfileStoreError, resolveConfigDir } from './profile-store.mjs';
import { GenericApiError, appendAudit, executeGenericRequest, parseApiRequestArgs, prepareGenericRequest } from './generic-api.mjs';

const VERSION = '0.2.0';
const REQUEST_TIMEOUT_MS = 10_000;
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const PROFILE_PATTERN = /^[A-Za-z0-9_-]+$/;
const LOGIN_PATH = '/api/auth/login';
const DEFAULT_BASE_URL = 'https://wnmsnezogvtm.cloud.zyyc.chat';
const ACTIVE_ROLES = new Set(['CUSTOMER', 'MANAGER', 'SENIOR_ADMIN', 'SENIOR_MANAGER', 'BRANCH_GENERAL_MANAGER', 'TRUST_SPECIALIST', 'OPERATIONS', 'WEB_ADMIN']);

const COMMANDS = new Map([
  ['health', { path: '/api/health', auth: false, options: [] }],
  ['auth status', { path: '/api/auth/me', auth: true, options: [] }],
  ['customer get', { path: ({ id }) => `/api/senior/customers/${id}`, auth: true, options: ['id'] }],
  ['contract list', { path: ({ customerId }) => `/api/senior/customers/${customerId}/contract-flows`, auth: true, options: ['customer-id'] }],
  ['contract status', { path: ({ id }) => `/api/senior/contract-flows/${id}`, auth: true, options: ['id'] }],
  ['profile save', { local: true, nameArgument: true }],
  ['profile use', { local: true, nameArgument: true }],
  ['profile current', { local: true, nameArgument: false }],
  ['profile list', { local: true, nameArgument: false }],
  ['profile remove', { local: true, nameArgument: true }],
  ['api request', { generic: true }],
]);

const HELP = {
  usage: 'jiaban [--profile <name>] <command> [options]',
  commands: [
    'jiaban health',
    'jiaban auth status',
    'jiaban customer get --id <customerId>',
    'jiaban contract list --customer-id <customerId>',
    'jiaban contract status --id <flowId>',
    'jiaban profile save <name>  # JSON credentials from stdin only',
    'jiaban profile use|current|list|remove',
    'jiaban [--profile <name>] api request METHOD /api/path [options]',
  ],
  environment: [
    `JIABAN_BASE_URL (optional; defaults to ${DEFAULT_BASE_URL})`,
    'JIABAN_SESSION_TOKEN, or JIABAN_INTEGRATION_PHONE + JIABAN_INTEGRATION_PASSWORD (except health)',
    'JIABAN_ACTIVE_ROLE (optional login role; defaults to SENIOR_ADMIN)',
    'JIABAN_CONFIG_DIR (optional absolute test isolation directory)',
    'JIABAN_CLI_FULL_ACCESS_ENABLED=true (required for api request)',
    'JIABAN_CLI_DESTRUCTIVE_ENABLED=true (required for high-risk api request)',
    'JIABAN_CLI_UPLOAD_ROOT / JIABAN_CLI_DOWNLOAD_ROOT (absolute file roots)',
  ],
};

class CliError extends Error {
  constructor(code, message, exitCode, details = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/(trust_token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function usageError(message) {
  throw new CliError('INVALID_ARGUMENT', message, 2);
}

function parseOptionTokens(tokens, allowed) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--') || token === '--') {
      usageError(`不支持的参数：${token}`);
    }

    const equalsAt = token.indexOf('=');
    const key = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    if (!allowed.includes(key)) usageError(`不支持的选项：--${key}`);
    if (Object.hasOwn(options, key)) usageError(`选项不可重复：--${key}`);

    const value = equalsAt === -1 ? tokens[++index] : token.slice(equalsAt + 1);
    if (!value || value.startsWith('--')) usageError(`选项缺少值：--${key}`);
    options[key] = value;
  }

  for (const key of allowed) {
    if (!Object.hasOwn(options, key)) usageError(`缺少必填选项：--${key}`);
  }
  return options;
}

function extractProfile(argv) {
  const args = [];
  let profile = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--profile' && !token.startsWith('--profile=')) {
      args.push(token);
      continue;
    }
    if (profile !== null) usageError('选项不可重复：--profile');
    const value = token === '--profile' ? argv[++index] : token.slice('--profile='.length);
    if (!value || value.startsWith('--')) usageError('选项缺少值：--profile');
    if (!PROFILE_PATTERN.test(value)) usageError('--profile 格式无效');
    profile = value;
  }
  return { args, profile };
}

function parseCommand(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) {
    return { name: 'help', help: true };
  }
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) {
    return { name: 'version', version: true };
  }

  const first = argv[0];
  const isSingleWord = first === 'health';
  const name = isSingleWord ? first : `${first ?? ''} ${argv[1] ?? ''}`.trim();
  const definition = COMMANDS.get(name);
  if (!definition) usageError(`未知命令：${name || '(空)'}`);

  const optionTokens = argv.slice(isSingleWord ? 1 : 2);
  if (definition.generic) return { name, definition, apiArgs: optionTokens, options: {} };
  if (definition.local) {
    if (definition.nameArgument) {
      if (optionTokens.length !== 1 || !PROFILE_PATTERN.test(optionTokens[0])) {
        usageError(`${name} 需要一个有效的 profile 名称`);
      }
      return { name, definition, profileName: optionTokens[0], options: {} };
    }
    if (optionTokens.length !== 0) usageError(`${name} 不接受额外参数`);
    return { name, definition, options: {} };
  }
  return { name, definition, options: parseOptionTokens(optionTokens, definition.options) };
}

function validatePositiveId(value, optionName) {
  if (!POSITIVE_ID_PATTERN.test(value)) usageError(`--${optionName} 必须是正整数`);
  let numericValue;
  try {
    numericValue = BigInt(value);
  } catch {
    usageError(`--${optionName} 必须是正整数`);
  }
  if (numericValue > BigInt(Number.MAX_SAFE_INTEGER)) usageError(`--${optionName} 超出安全范围`);
  return value;
}

function normalizeOptions(command) {
  const result = {};
  if (command.options?.id) result.id = validatePositiveId(command.options.id, 'id');
  if (command.options?.['customer-id']) {
    result.customerId = validatePositiveId(command.options['customer-id'], 'customer-id');
  }
  return result;
}

function baseUrlFromEnvironment(env) {
  const raw = env.JIABAN_BASE_URL?.trim() || DEFAULT_BASE_URL;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError('INVALID_BASE_URL', 'JIABAN_BASE_URL 不是有效 URL', 3);
  }

  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new CliError('INVALID_BASE_URL', 'JIABAN_BASE_URL 必须是无凭据、路径、查询和片段的 origin', 3);
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !localHttp) {
    throw new CliError('INSECURE_BASE_URL', 'JIABAN_BASE_URL 必须使用 HTTPS；测试仅允许 localhost 或 127.0.0.1 使用 HTTP', 3);
  }
  return url.origin;
}

function authFromEnvironment(env) {
  const activeRole = env.JIABAN_ACTIVE_ROLE?.trim() || 'SENIOR_ADMIN';
  if (!ACTIVE_ROLES.has(activeRole)) throw new CliError('INVALID_ACTIVE_ROLE', 'JIABAN_ACTIVE_ROLE 不在允许范围内', 3);
  const sessionToken = env.JIABAN_SESSION_TOKEN?.trim();
  if (sessionToken) return { mode: 'session', token: sessionToken, activeRole };

  const phone = env.JIABAN_INTEGRATION_PHONE?.trim();
  const password = env.JIABAN_INTEGRATION_PASSWORD;
  if (!phone || !password?.trim()) {
    throw new CliError(
      'AUTH_REQUIRED',
      '缺少 JIABAN_SESSION_TOKEN，或缺少完整的测试集成账号环境变量',
      3,
    );
  }
  return { mode: 'credentials', phone, password, activeRole };
}

function environmentFromSavedProfile(profile) {
  return {
    JIABAN_BASE_URL: profile.baseUrl,
    JIABAN_INTEGRATION_PHONE: profile.phone,
    JIABAN_INTEGRATION_PASSWORD: profile.password,
    JIABAN_ACTIVE_ROLE: profile.activeRole ?? 'SENIOR_ADMIN',
  };
}

async function readProfileInput(stdin) {
  let content = '';
  for await (const chunk of stdin) {
    content += chunk.toString();
    if (Buffer.byteLength(content, 'utf8') > 16_384) {
      throw new CliError('INVALID_PROFILE_INPUT', 'profile 输入过长', 2);
    }
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new CliError('INVALID_PROFILE_INPUT', 'stdin 必须是单个 JSON 对象', 2);
  }
  const keys = Object.keys(value ?? {}).sort();
  if (!value || Array.isArray(value) || !['baseUrl,password,phone', 'activeRole,baseUrl,password,phone'].includes(keys.join(','))) {
    throw new CliError('INVALID_PROFILE_INPUT', 'profile JSON 仅允许 baseUrl、phone、password 和可选 activeRole', 2);
  }
  if (typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048
    || typeof value.phone !== 'string' || !/^1[3-9]\d{9}$/.test(value.phone)
    || typeof value.password !== 'string' || value.password.trim().length < 1 || value.password.length > 256
    || (value.activeRole !== undefined && (typeof value.activeRole !== 'string' || !ACTIVE_ROLES.has(value.activeRole)))) {
    throw new CliError('INVALID_PROFILE_INPUT', 'profile 字段格式或长度无效', 2);
  }
  const baseUrl = baseUrlFromEnvironment({ JIABAN_BASE_URL: value.baseUrl });
  return { baseUrl, phone: value.phone, password: value.password, activeRole: value.activeRole ?? 'SENIOR_ADMIN' };
}

async function executeProfileCommand(command, store, stdin) {
  switch (command.name) {
    case 'profile save': {
      const profile = await readProfileInput(stdin);
      await store.put(command.profileName, profile);
      return { name: command.profileName, saved: true };
    }
    case 'profile use':
      await store.use(command.profileName);
      return { name: command.profileName, active: true };
    case 'profile current': {
      const selected = await store.selected(null);
      return { name: selected.name };
    }
    case 'profile list':
      return { profiles: await store.summary() };
    case 'profile remove':
      await store.remove(command.profileName);
      return { name: command.profileName, removed: true };
    default:
      throw new CliError('INTERNAL_ERROR', '未实现的 profile 命令', 1);
  }
}

async function parseResponseBody(response, secrets) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('INVALID_RESPONSE', `后端返回了非 JSON 响应（HTTP ${response.status}）`, 6, {
      httpStatus: response.status,
    });
  }
}

async function performJsonRequest({ baseUrl, path, method, token, requestBody, fetchImpl, secrets }) {
  if (method !== 'GET' && !(method === 'POST' && path === LOGIN_PATH)) {
    throw new CliError('METHOD_NOT_ALLOWED', '拒绝未授权的请求方法或路径', 1);
  }
  const requestUrl = new URL(path, `${baseUrl}/`);
  if (requestUrl.origin !== baseUrl) {
    throw new CliError('CROSS_ORIGIN_REQUEST', '拒绝跨 origin 请求', 3);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method,
      headers: method === 'POST'
        ? { 'content-type': 'application/json' }
        : (token ? { trust_token: token } : {}),
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new CliError('TIMEOUT', `请求超过 ${REQUEST_TIMEOUT_MS / 1000} 秒`, 7);
    }
    throw new CliError('NETWORK_ERROR', '网络请求失败', 7);
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new CliError('REDIRECT_REJECTED', '拒绝后端重定向', 6, { httpStatus: response.status });
  }

  const body = await parseResponseBody(response, secrets);
  return { response, body };
}

async function loginWithCredentials({ baseUrl, phone, password, activeRole, fetchImpl, secrets }) {
  const { response, body } = await performJsonRequest({
    baseUrl,
    path: LOGIN_PATH,
    method: 'POST',
    requestBody: { phone, password, clientType: 'cli', activeRole },
    fetchImpl,
    secrets,
  });

  if (response.status === 401 || response.status === 403
    || (response.ok && [401, 403].includes(Number(body?.code)))) {
    throw new CliError('LOGIN_FAILED', '测试集成账号登录失败', 4, {
      httpStatus: response.status,
      businessCode: body?.code,
    });
  }
  if (!response.ok) {
    throw new CliError('HTTP_ERROR', '测试集成账号登录请求失败', 6, { httpStatus: response.status });
  }
  if (Number(body?.code) !== 200) {
    throw new CliError('LOGIN_FAILED', '测试集成账号登录失败', 4, {
      httpStatus: response.status,
      businessCode: body?.code,
    });
  }
  const token = body?.data?.tokenValue;
  if (!isNonEmptyString(token)) protocolError();
  return token;
}

async function requestData({ baseUrl, path, token, fetchImpl, secrets }) {
  const { response, body } = await performJsonRequest({
    baseUrl,
    path,
    method: 'GET',
    token,
    fetchImpl,
    secrets,
  });
  if (response.status === 401) {
    throw new CliError('UNAUTHENTICATED', '会话未认证或已失效', 4, { httpStatus: 401 });
  }
  if (response.status === 403) {
    throw new CliError('FORBIDDEN', '当前会话没有访问权限', 4, { httpStatus: 403 });
  }
  if (response.status === 404) {
    throw new CliError('NOT_FOUND', '资源不存在', 5, { httpStatus: 404 });
  }
  if (!response.ok) {
    throw new CliError('HTTP_ERROR', '后端请求失败', 6, {
      httpStatus: response.status,
    });
  }
  if (Number(body?.code) === 404) {
    throw new CliError('NOT_FOUND', '资源不存在', 5, {
      httpStatus: response.status,
      businessCode: body?.code,
    });
  }
  if (Number(body?.code) !== 200) {
    throw new CliError('BUSINESS_ERROR', '后端返回业务错误', 6, {
      httpStatus: response.status,
      businessCode: body?.code,
    });
  }
  return body.data;
}

function maskPhone(phone) {
  if (typeof phone !== 'string') return null;
  if (phone.length < 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function protocolError() {
  throw new CliError('INVALID_RESPONSE', '后端响应格式错误', 6);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireHealth(data) {
  if (!data || !isNonEmptyString(data.status) || !isNonEmptyString(data.service)) protocolError();
  return data;
}

function requireAuthStatus(data) {
  if (!data?.user || !isPositiveSafeInteger(data.user.id) || !isNonEmptyString(data.user.displayName)
    || !isNonEmptyString(data.activeRole) || !Array.isArray(data.roles)
    || !data.roles.every(isNonEmptyString)) {
    protocolError();
  }
  return data;
}

function requireCustomer(data) {
  if (!data || !isPositiveSafeInteger(data.id) || !isNonEmptyString(data.customerNo)
    || !isNonEmptyString(data.phone) || !isNonEmptyString(data.status)
    || !isNonEmptyString(data.riskLevel)) {
    protocolError();
  }
  return data;
}

function requireFlow(flow) {
  if (!flow || !isPositiveSafeInteger(flow.id) || !isNonEmptyString(flow.flowNo)
    || !isPositiveSafeInteger(flow.customerId) || !isNonEmptyString(flow.status)
    || !(flow.processActive === null || flow.processActive === undefined || typeof flow.processActive === 'boolean')
    || !(flow.currentFlowNodeName === null || flow.currentFlowNodeName === undefined || typeof flow.currentFlowNodeName === 'string')) {
    protocolError();
  }
  return flow;
}

function customerView(customer) {
  requireCustomer(customer);
  return {
    id: customer.id,
    customerNo: customer.customerNo,
    maskedPhone: maskPhone(customer.phone),
    status: customer.status,
    riskLevel: customer.riskLevel,
  };
}

function flowView(flow) {
  requireFlow(flow);
  return {
    id: flow.id,
    flowNo: flow.flowNo,
    customerId: flow.customerId,
    status: flow.status,
    processActive: flow.processActive ?? null,
    currentFlowNodeName: flow?.currentFlowNodeName ?? null,
  };
}

function resultForCommand(name, data, options) {
  switch (name) {
    case 'health':
      requireHealth(data);
      return { status: data.status, service: data.service };
    case 'auth status': {
      requireAuthStatus(data);
      return {
        id: data.user.id,
        displayName: data.user.displayName,
        activeRole: data.activeRole,
        roles: data.roles,
      };
    }
    case 'customer get':
      return customerView(data);
    case 'contract list':
      if (!Array.isArray(data)) throw new CliError('INVALID_RESPONSE', '合同流程列表响应格式错误', 6);
      return data.map(flowView);
    case 'contract status': {
      if (!data?.flow) protocolError();
      return flowView(data.flow);
    }
    default:
      throw new CliError('INTERNAL_ERROR', '未实现的命令', 1);
  }
}

export async function run(argv, runtime = {}) {
  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const stdin = runtime.stdin ?? process.stdin;
  const fetchImpl = runtime.fetch ?? globalThis.fetch;
  let commandName = 'unknown';
  let secrets = [];

  try {
    const { args, profile } = extractProfile(argv);
    const command = parseCommand(args);
    commandName = command.name;
    if (command.help) {
      writeJson(stdout, { ok: true, command: 'help', data: HELP });
      return 0;
    }
    if (command.version) {
      writeJson(stdout, { ok: true, command: 'version', data: { version: VERSION } });
      return 0;
    }

    const store = new ProfileStore(resolveConfigDir(env));
    if (command.definition.local) {
      if (profile) usageError('--profile 不适用于 profile 管理命令');
      const data = await executeProfileCommand(command, store, stdin);
      writeJson(stdout, { ok: true, command: command.name, data });
      return 0;
    }

    const options = normalizeOptions(command);
    const saved = await store.selected(profile);
    const selectedEnv = saved.profile ? environmentFromSavedProfile(saved.profile) : env;
    const baseUrl = baseUrlFromEnvironment(selectedEnv);
    if (command.definition.generic) {
      const request = parseApiRequestArgs(command.apiArgs);
      const profileKey = saved.name ?? 'environment';
      const prepared = await prepareGenericRequest({ request, env, stdin, profileKey, configDir: store.configDir, baseUrl });
      if (prepared.dryRun) {
        await appendAudit({ ...prepared.audit, outcome: prepared.planId ? 'plan-created' : 'dry-run' });
        writeJson(stdout, { ok: true, command: command.name, data: { dryRun: true, planId: prepared.planId, request: prepared.summary } });
        return 0;
      }
      const auth = authFromEnvironment(selectedEnv);
      secrets = [auth?.token, auth?.phone, auth?.password].filter(Boolean);
      let token = auth.token ?? null;
      if (auth.mode === 'credentials') {
        token = await loginWithCredentials({ baseUrl, phone: auth.phone, password: auth.password, activeRole: auth.activeRole, fetchImpl, secrets });
        secrets.push(token);
      }
      await appendAudit({ ...prepared.audit, outcome: 'attempt' });
      let response;
      try {
        response = await executeGenericRequest({ prepared, baseUrl, token, fetchImpl, secrets });
      } catch (error) {
        if (auth.mode === 'credentials' && ['GET', 'HEAD'].includes(request.method) && error?.code === 'UNAUTHENTICATED') {
          token = await loginWithCredentials({ baseUrl, phone: auth.phone, password: auth.password, activeRole: auth.activeRole, fetchImpl, secrets });
          secrets.push(token);
          try {
            response = await executeGenericRequest({ prepared, baseUrl, token, fetchImpl, secrets });
          } catch (retryError) {
            await appendAudit({ ...prepared.audit, outcome: retryError?.code ?? 'error' });
            throw retryError;
          }
        } else {
          await appendAudit({ ...prepared.audit, outcome: error?.code ?? 'error' });
          throw error;
        }
      }
      await appendAudit({ ...prepared.audit, outcome: 'success' });
      writeJson(stdout, { ok: true, command: command.name, response });
      return 0;
    }
    const auth = command.definition.auth ? authFromEnvironment(selectedEnv) : null;
    secrets = [auth?.token, auth?.phone, auth?.password].filter(Boolean);
    let token = auth?.token ?? null;
    if (auth?.mode === 'credentials') {
      token = await loginWithCredentials({
        baseUrl,
        phone: auth.phone,
        password: auth.password,
        activeRole: auth.activeRole,
        fetchImpl,
        secrets,
      });
      secrets.push(token);
    }
    const path = typeof command.definition.path === 'function'
      ? command.definition.path(options)
      : command.definition.path;
    let data;
    try {
      data = await requestData({ baseUrl, path, token, fetchImpl, secrets });
    } catch (error) {
      if (auth?.mode !== 'credentials' || error?.code !== 'UNAUTHENTICATED') throw error;
      token = await loginWithCredentials({
        baseUrl,
        phone: auth.phone,
        password: auth.password,
        activeRole: auth.activeRole,
        fetchImpl,
        secrets,
      });
      secrets.push(token);
      data = await requestData({ baseUrl, path, token, fetchImpl, secrets });
    }
    writeJson(stdout, { ok: true, command: command.name, data: resultForCommand(command.name, data, options) });
    return 0;
  } catch (error) {
    const safeError = error instanceof CliError || error instanceof ProfileStoreError || error instanceof GenericApiError
      ? error
      : new CliError('INTERNAL_ERROR', redact(error?.message || '内部错误', secrets), 1);
    const details = {};
    if (safeError.details.httpStatus !== undefined) details.httpStatus = safeError.details.httpStatus;
    if (safeError.details.businessCode !== undefined) details.businessCode = safeError.details.businessCode;
    writeJson(stdout, {
      ok: false,
      command: commandName,
      error: {
        code: safeError.code,
        message: redact(safeError.message, secrets),
        retryable: ['TIMEOUT', 'NETWORK_ERROR'].includes(safeError.code),
        ...details,
      },
    });
    if (safeError.code === 'INTERNAL_ERROR') {
      stderr.write(`${redact(safeError.message, secrets)}\n`);
    }
    return safeError.exitCode;
  }
}

export const internals = {
  maskPhone,
  parseCommand,
  extractProfile,
  baseUrlFromEnvironment,
  REQUEST_TIMEOUT_MS,
  DEFAULT_BASE_URL,
};
