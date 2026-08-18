import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUIRED_KEYS = ['activeRole', 'baseUrl', 'fullAccess', 'password', 'phone'];
const BUNDLED_BASE_URL = 'https://wnmsnezogvtm.cloud.zyyc.chat';
const DEFAULT_PROFILE_PATH = fileURLToPath(new URL('../internal-test-profile.json', import.meta.url));

export class BundledProfileError extends Error {
  constructor() {
    super('私有测试 Profile 配置无效');
    this.name = 'BundledProfileError';
    this.code = 'BUNDLED_PROFILE_INVALID';
    this.exitCode = 3;
    this.details = {};
  }
}

function invalid() { throw new BundledProfileError(); }

export async function loadBundledTestProfile(filePath = DEFAULT_PROFILE_PATH) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    invalid();
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) invalid();
  let value;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    invalid();
  }
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== REQUIRED_KEYS.join(',')) invalid();
  if (value.baseUrl !== BUNDLED_BASE_URL
    || typeof value.phone !== 'string' || !/^1[3-9]\d{9}$/.test(value.phone)
    || typeof value.password !== 'string' || value.password.trim().length < 1 || value.password.length > 256
    || value.activeRole !== 'WEB_ADMIN'
    || typeof value.fullAccess !== 'boolean') invalid();
  return Object.freeze({ ...value, source: 'bundled-private-test' });
}

export const bundledProfileInternals = { BUNDLED_BASE_URL, DEFAULT_PROFILE_PATH };
