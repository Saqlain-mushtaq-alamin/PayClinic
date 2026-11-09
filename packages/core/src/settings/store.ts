import type { Database } from '../db/db';
import { decrypt, encrypt } from './crypto';

export const ALLOWED_SETTINGS_KEYS = [
  'paypalClientId',
  'paypalClientSecret',
  'aiProvider',
  'geminiApiKey',
  'geminiModel',
  'githubToken',
  'githubRepo',
  'githubBaseBranch',
  'mode',
  'publicUrl',
  'paypalVerifiedAt',
] as const;

export type SettingsKey = (typeof ALLOWED_SETTINGS_KEYS)[number];

export const NON_SECRET_KEYS = new Set<SettingsKey>([
  'mode',
  'aiProvider',
  'geminiModel',
  'githubRepo',
  'githubBaseBranch',
  'publicUrl',
  'paypalVerifiedAt',
]);

const ALLOWED_SET = new Set<string>(ALLOWED_SETTINGS_KEYS);

export interface MaskedSetting {
  configured: boolean;
  hint: string;
}

export class SettingsStore {
  constructor(private readonly db: Database) {}

  /** Retrieves the decrypted plaintext setting for a whitelisted key, or null if unset. */
  get(key: string): string | null {
    if (!ALLOWED_SET.has(key)) return null;

    const row = this.db.prepare('SELECT value_encrypted FROM settings WHERE key = ?').get(key) as
      { value_encrypted: string } | undefined;

    if (!row) return null;
    return decrypt(row.value_encrypted);
  }

  /** Encrypts and persists a whitelisted setting. */
  set(key: string, val: string): void {
    if (!ALLOWED_SET.has(key)) {
      throw new Error(`Disallowed settings key: ${key}`);
    }

    if (key === 'mode' && val !== 'offline' && val !== 'online') {
      throw new Error(`Invalid mode: must be 'offline' or 'online'`);
    }

    if (key === 'aiProvider' && val !== 'fixture' && val !== 'gemini' && val !== 'fake') {
      throw new Error(`Invalid aiProvider: must be 'fixture', 'gemini', or 'fake'`);
    }

    const encrypted = encrypt(val);
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO settings (key, value_encrypted, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_encrypted = excluded.value_encrypted,
           updated_at = excluded.updated_at`,
      )
      .run(key, encrypted, updatedAt);
  }

  /** Deletes a whitelisted setting if it exists. */
  delete(key: string): void {
    if (!ALLOWED_SET.has(key)) return;
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  /** Returns masked representations of all whitelisted settings. */
  masked(): Record<SettingsKey, MaskedSetting> {
    const result = {} as Record<SettingsKey, MaskedSetting>;
    for (const key of ALLOWED_SETTINGS_KEYS) {
      const val = this.get(key);
      if (val === null || val === undefined) {
        result[key] = { configured: false, hint: '' };
      } else if (NON_SECRET_KEYS.has(key)) {
        result[key] = { configured: true, hint: val };
      } else {
        const last4 = val.length > 4 ? val.slice(-4) : val;
        result[key] = { configured: true, hint: `••••${last4}` };
      }
    }
    return result;
  }
}
