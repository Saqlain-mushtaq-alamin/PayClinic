import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCRYPT_SALT = 'payclinic-settings-salt';
const KEY_LEN = 32;
const IV_LEN = 12;

function getDefaultSecretPath(): string {
  return resolve(process.cwd(), 'data', '.secret');
}

/** Resolves the settings secret from an explicit argument, env, or data/.secret file. */
export function getSettingsSecret(customSecret?: string): string {
  if (customSecret !== undefined) {
    if (customSecret.length < 32) {
      throw new Error('SETTINGS_SECRET must be at least 32 characters');
    }
    return customSecret;
  }

  const envSecret = process.env.SETTINGS_SECRET;
  if (envSecret !== undefined && envSecret !== '') {
    if (envSecret.length < 32) {
      throw new Error('SETTINGS_SECRET must be at least 32 characters');
    }
    return envSecret;
  }

  const secretPath = getDefaultSecretPath();
  if (existsSync(secretPath)) {
    const fromFile = readFileSync(secretPath, 'utf8').trim();
    if (fromFile.length >= 32) {
      return fromFile;
    }
  }

  // Generate a random 32-byte (64 hex characters) secret and persist to data/.secret with mode 0600
  const generated = randomBytes(32).toString('hex');
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
}

/** Encrypts plaintext using AES-256-GCM. Returns base64(iv).base64(tag).base64(ciphertext). */
export function encrypt(plaintext: string, secret?: string): string {
  const key = deriveKey(getSettingsSecret(secret));
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

/** Decrypts AES-256-GCM encrypted string formatted as base64(iv).base64(tag).base64(ciphertext). */
export function decrypt(encrypted: string, secret?: string): string {
  const parts = encrypted.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted settings payload format');
  }

  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const key = deriveKey(getSettingsSecret(secret));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('Failed to decrypt settings: data tampered or invalid secret', {
      cause: err,
    });
  }
}
