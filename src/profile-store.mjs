import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const KEY_BYTES = 32;
const IV_BYTES = 12;

export class ProfileStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProfileStoreError';
    this.code = code;
    this.exitCode = 3;
    this.details = {};
  }
}

function emptyPayload() {
  return { active: null, profiles: {} };
}

async function bestEffortChmod(target, mode) {
  try {
    await chmod(target, mode);
  } catch (error) {
    if (!['EPERM', 'ENOSYS', 'EINVAL'].includes(error?.code)) throw error;
  }
}

export function resolveConfigDir(env) {
  const override = env.JIABAN_CONFIG_DIR?.trim();
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new ProfileStoreError('INVALID_CONFIG_DIR', 'JIABAN_CONFIG_DIR 必须是绝对路径');
    }
    return path.resolve(override);
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'jiaban-cli');
  }
  return path.join(os.homedir(), '.config', 'jiaban-cli');
}

export class ProfileStore {
  constructor(configDir) {
    this.configDir = configDir;
    this.keyPath = path.join(configDir, 'profiles.key');
    this.dataPath = path.join(configDir, 'profiles.enc');
  }

  async exists() {
    try {
      await stat(this.dataPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async ensureKey() {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await bestEffortChmod(this.configDir, 0o700);
    try {
      const handle = await open(this.keyPath, 'wx', 0o600);
      try {
        await handle.writeFile(randomBytes(KEY_BYTES));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    await bestEffortChmod(this.keyPath, 0o600);
    return this.readKey();
  }

  async readKey() {
    let key;
    try {
      key = await readFile(this.keyPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new ProfileStoreError('PROFILE_STORE_CORRUPT', 'profile 密钥文件缺失');
      }
      throw error;
    }
    if (key.length !== KEY_BYTES) {
      throw new ProfileStoreError('PROFILE_STORE_CORRUPT', 'profile 密钥文件损坏');
    }
    return key;
  }

  async load() {
    if (!(await this.exists())) return emptyPayload();
    try {
      const [key, encoded] = await Promise.all([this.readKey(), readFile(this.dataPath, 'utf8')]);
      const envelope = JSON.parse(encoded);
      if (envelope?.version !== 1) throw new Error('unsupported version');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const payload = JSON.parse(plaintext);
      if (!payload || typeof payload.profiles !== 'object' || Array.isArray(payload.profiles)
        || !(payload.active === null || typeof payload.active === 'string')) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch (error) {
      if (error instanceof ProfileStoreError) throw error;
      throw new ProfileStoreError('PROFILE_STORE_CORRUPT', 'profile 加密数据损坏或无法解密');
    }
  }

  async save(payload) {
    const key = await this.ensureKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
    const tempPath = path.join(this.configDir, `.profiles-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(tempPath, envelope, { mode: 0o600, flag: 'wx' });
    await bestEffortChmod(tempPath, 0o600);
    try {
      await rename(tempPath, this.dataPath);
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      throw error;
    }
    await bestEffortChmod(this.dataPath, 0o600);
  }

  async put(name, profile) {
    const payload = await this.load();
    payload.profiles[name] = profile;
    await this.save(payload);
  }

  async use(name) {
    const payload = await this.load();
    if (!payload.profiles[name]) throw new ProfileStoreError('PROFILE_NOT_FOUND', 'profile 不存在');
    payload.active = name;
    await this.save(payload);
  }

  async remove(name) {
    const payload = await this.load();
    if (!payload.profiles[name]) throw new ProfileStoreError('PROFILE_NOT_FOUND', 'profile 不存在');
    delete payload.profiles[name];
    if (payload.active === name) payload.active = null;
    await this.save(payload);
  }

  async selected(name) {
    const payload = await this.load();
    const selectedName = name ?? payload.active;
    if (!selectedName) return { name: null, profile: null };
    const profile = payload.profiles[selectedName];
    if (!profile) throw new ProfileStoreError('PROFILE_NOT_FOUND', 'profile 不存在');
    return { name: selectedName, profile };
  }

  async summary() {
    const payload = await this.load();
    return Object.keys(payload.profiles).sort().map((name) => ({ name, active: payload.active === name }));
  }
}
