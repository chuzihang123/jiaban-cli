import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const FS_OPS = { chmod, mkdir, open, readdir, rename, rmdir, unlink, writeFile };

export class ProfileStoreError extends Error {
  constructor(code, message, exitCode = 3) {
    super(message);
    this.name = 'ProfileStoreError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = {};
  }
}

function emptyPayload() {
  return { active: null, profiles: {} };
}

async function bestEffortChmod(target, mode) {
  try {
    await chmod(target, mode);
  } catch {}
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
  constructor(configDir, operations = {}) {
    this.configDir = configDir;
    this.keyPath = path.join(configDir, 'profiles.key');
    this.dataPath = path.join(configDir, 'profiles.enc');
    this.lockPath = path.join(configDir, '.profiles.lock');
    this.ops = { ...FS_OPS, ...operations };
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

  async putAndUse(name, profile) {
    const payload = await this.load();
    payload.profiles[name] = profile;
    payload.active = name;
    const existed = await this.exists();
    try {
      await this.save(payload);
    } catch (error) {
      if (!existed) {
        await unlink(this.dataPath).catch(() => {});
        await unlink(this.keyPath).catch(() => {});
        try {
          for (const entry of await readdir(this.configDir)) {
            if (entry.startsWith('.profiles-') && entry.endsWith('.tmp')) {
              await unlink(path.join(this.configDir, entry)).catch(() => {});
            }
          }
          if ((await readdir(this.configDir)).length === 0) await rmdir(this.configDir);
        } catch (cleanupError) {
          if (cleanupError?.code !== 'ENOENT') throw cleanupError;
        }
      }
      throw error;
    }
  }

  async acquireExclusiveLock() {
    let directoryExisted = true;
    try {
      await stat(this.configDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      directoryExisted = false;
    }
    await this.ops.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    try {
      await this.ops.chmod(this.configDir, 0o700);
    } catch {}

    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
      try {
        const handle = await this.ops.open(this.lockPath, 'wx', 0o600);
        return { handle, directoryExisted };
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          if (!directoryExisted) await this.removeEmptyConfigDir();
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new ProfileStoreError('PROFILE_LOCK_TIMEOUT', 'profile 存储正被其他进程使用');
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      }
    }
  }

  async removeEmptyConfigDir() {
    try {
      if ((await readdir(this.configDir)).length === 0) await rmdir(this.configDir);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    }
  }

  async releaseExclusiveLock(lock) {
    await lock.handle.close().catch(() => {});
    await unlink(this.lockPath).catch(() => {});
    if (!lock.directoryExisted) await this.removeEmptyConfigDir();
  }

  async createAndUse(name, profile) {
    const lock = await this.acquireExclusiveLock();
    const tempSuffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const dataTempPath = path.join(this.configDir, `.profiles-data-${tempSuffix}.tmp`);
    const keyTempPath = path.join(this.configDir, `.profiles-key-${tempSuffix}.tmp`);
    let keyCommitted = false;
    let keyExisted = false;
    try {
      const payload = await this.load();
      if (payload.profiles[name]) {
        throw new ProfileStoreError('ADMIN_PROFILE_EXISTS', `${name} profile 已存在，拒绝覆盖`, 2);
      }

      try {
        await stat(this.keyPath);
        keyExisted = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const key = keyExisted ? await this.readKey() : randomBytes(KEY_BYTES);
      payload.profiles[name] = profile;
      payload.active = name;

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

      if (!keyExisted) {
        await this.ops.writeFile(keyTempPath, key, { mode: 0o600, flag: 'wx' });
        await this.preCommitChmod(keyTempPath, 0o600);
      }
      await this.ops.writeFile(dataTempPath, envelope, { mode: 0o600, flag: 'wx' });
      await this.preCommitChmod(dataTempPath, 0o600);
      if (!keyExisted) {
        await this.ops.rename(keyTempPath, this.keyPath);
        keyCommitted = true;
      }
      try {
        await this.ops.rename(dataTempPath, this.dataPath);
      } catch (error) {
        if (keyCommitted) {
          await unlink(this.keyPath).catch(() => {});
          keyCommitted = false;
        }
        throw error;
      }

      try { await this.ops.chmod(this.keyPath, 0o600); } catch {}
      try { await this.ops.chmod(this.dataPath, 0o600); } catch {}
    } catch (error) {
      await unlink(dataTempPath).catch(() => {});
      await unlink(keyTempPath).catch(() => {});
      if (keyCommitted && !keyExisted) await unlink(this.keyPath).catch(() => {});
      throw error;
    } finally {
      await this.releaseExclusiveLock(lock);
    }
  }

  async preCommitChmod(target, mode) {
    try {
      await this.ops.chmod(target, mode);
    } catch (error) {
      if (!['EPERM', 'ENOSYS', 'EINVAL'].includes(error?.code)) throw error;
    }
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
