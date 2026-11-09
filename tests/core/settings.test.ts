import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsResponse, TestSettingsResponse } from '@payclinic/contracts';
import {
  ConfigError,
  SettingsStore,
  decrypt,
  encrypt,
  loadConfig,
  openDb,
  resolveConfig,
  type Orchestrator,
  type Repos,
} from '@payclinic/core';
import { createApi } from '@payclinic/cli';

describe('Settings Backend & Crypto', () => {
  const secretA = '01234567890123456789012345678901'; // 32 chars
  const secretB = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 chars

  it('encrypt/decrypt round trip', () => {
    const sensitive = 'sk-ant-api03-very-secret-gemini-key-12345';
    const encrypted = encrypt(sensitive, secretA);
    expect(encrypted).not.toContain(sensitive);
    expect(encrypted.split('.')).toHaveLength(3);

    const decrypted = decrypt(encrypted, secretA);
    expect(decrypted).toBe(sensitive);
  });

  it('tampered ciphertext fails', () => {
    const encrypted = encrypt('hello-world', secretA);
    const [iv, tag, data] = encrypted.split('.');

    // Tampered data
    const tamperedData = Buffer.from('tampered-payload').toString('base64');
    expect(() => decrypt(`${iv}.${tag}.${tamperedData}`, secretA)).toThrow(/tampered/i);

    // Tampered tag
    const tamperedTag = Buffer.from('0000000000000000').toString('base64');
    expect(() => decrypt(`${iv}.${tamperedTag}.${data}`, secretA)).toThrow(/tampered/i);

    // Decrypting with wrong secret fails
    expect(() => decrypt(encrypted, secretB)).toThrow(/tampered|invalid secret/i);

    // Invalid format
    expect(() => decrypt('not-valid-gcm-format', secretA)).toThrow(/Invalid/i);
  });

  it('SettingsStore CRUD and masked view', () => {
    const db = openDb(':memory:');
    const store = new SettingsStore(db);

    // Disallowed keys
    expect(store.get('unknownKey')).toBeNull();
    expect(() => store.set('unknownKey', 'val')).toThrow(/Disallowed/i);

    // Invalid enum values
    expect(() => store.set('mode', 'invalid')).toThrow(/Invalid mode/i);
    expect(() => store.set('aiProvider', 'openai')).toThrow(/Invalid aiProvider/i);

    // Set valid values
    store.set('geminiApiKey', 'secret-key-xyz12345');
    store.set('mode', 'offline');
    store.set('aiProvider', 'gemini');
    store.set('publicUrl', 'http://localhost:3000');

    expect(store.get('geminiApiKey')).toBe('secret-key-xyz12345');
    expect(store.get('mode')).toBe('offline');

    // Masked output: secret keys show only last 4 chars with bullets, non-secret keys show plain
    const masked = store.masked();
    expect(masked.geminiApiKey).toEqual({
      configured: true,
      hint: '••••2345',
    });
    expect(masked.mode).toEqual({
      configured: true,
      hint: 'offline',
    });
    expect(masked.publicUrl).toEqual({
      configured: true,
      hint: 'http://localhost:3000',
    });
    expect(masked.paypalClientId).toEqual({
      configured: false,
      hint: '',
    });

    // Delete
    store.delete('publicUrl');
    expect(store.get('publicUrl')).toBeNull();
    expect(store.masked().publicUrl).toEqual({ configured: false, hint: '' });
  });

  it('resolveConfig overlays settings on env without restart', () => {
    const db = openDb(':memory:');
    const store = new SettingsStore(db);

    const baseEnv: Record<string, string | undefined> = {
      PAYCLINIC_MODE: 'offline',
      AI_PROVIDER: 'fixture',
    };

    const cfg1 = resolveConfig(baseEnv, store);
    expect(cfg1.mode).toBe('offline');
    expect(cfg1.aiProvider).toBe('fixture');

    // Update settings store
    store.set('aiProvider', 'gemini');
    store.set('geminiApiKey', 'mock-gemini-key-12345');
    store.set('geminiModel', 'gemini-2.5-flash');

    const cfg2 = resolveConfig(baseEnv, store);
    expect(cfg2.aiProvider).toBe('gemini');
    expect(cfg2.geminiApiKey).toBe('mock-gemini-key-12345');
    expect(cfg2.geminiModel).toBe('gemini-2.5-flash');
  });

  it('online mode rejected before PayPal test when keys are missing', () => {
    const db = openDb(':memory:');
    const store = new SettingsStore(db);
    store.set('mode', 'online');

    expect(() => resolveConfig({}, store)).toThrow(ConfigError);
    expect(() => resolveConfig({}, store)).toThrow(
      'online mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET',
    );
  });
});

describe('Settings API Routes & Admin Gate', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAYCLINIC_ADMIN_TOKEN;
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  function createTestApi(
    options: {
      adminToken?: string;
      testers?: {
        paypal?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
        gemini?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
        github?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
      };
    } = {},
  ) {
    if (options.adminToken) {
      process.env.PAYCLINIC_ADMIN_TOKEN = options.adminToken;
    } else {
      delete process.env.PAYCLINIC_ADMIN_TOKEN;
    }

    const db = openDb(':memory:');
    const settingsStore = new SettingsStore(db);
    const bus = new EventEmitter();
    const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
    const dummyRepos = {
      listRuns: () => [],
      getRun: () => null,
      listFindings: () => [],
      listScenarios: () => [],
      listSteps: () => [],
    } as unknown as Repos;
    const dummyOrchestrator = {
      startRun: (req: { mode: string }) => {
        if (req.mode === 'online' && !settingsStore.get('paypalClientId')) {
          throw new Error('online mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
        }
        return 'run-123';
      },
    } as unknown as Orchestrator;

    const app = createApi({
      orchestrator: dummyOrchestrator,
      repos: dummyRepos,
      config,
      bus,
      settingsStore,
      getConfig: () => resolveConfig({}, settingsStore),
      testers: options.testers,
    });

    return { app, settingsStore };
  }

  it('GET /api/settings never contains raw secret', async () => {
    const { app, settingsStore } = createTestApi();
    const rawSecret = 'SUPER_SECRET_PAYPAL_CLIENT_SECRET_9999';
    settingsStore.set('paypalClientSecret', rawSecret);
    settingsStore.set('mode', 'offline');

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
    });

    expect(res.statusCode).toBe(200);
    const text = res.payload;
    expect(text).not.toContain(rawSecret);

    const parsed = SettingsResponse.parse(JSON.parse(text));
    expect(parsed.paypalClientSecret?.configured).toBe(true);
    expect(parsed.paypalClientSecret?.hint).toBe('••••9999');
    expect(parsed.mode?.hint).toBe('offline');
  });

  it('PUT /api/settings rejects mode online before PayPal verification', async () => {
    const { app } = createTestApi();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { mode: 'online' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/verified/i);
  });

  it('PUT /api/settings allows mode online once paypalVerifiedAt exists', async () => {
    const { app, settingsStore } = createTestApi();
    settingsStore.set('paypalVerifiedAt', new Date().toISOString());

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { mode: 'online' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mode.hint).toBe('online');
  });

  it('PUT /api/settings preserves empty string and deletes null', async () => {
    const { app, settingsStore } = createTestApi();
    settingsStore.set('geminiApiKey', 'initial-gemini-key');

    // Empty string leaves unchanged
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { geminiApiKey: '' },
    });
    expect(settingsStore.get('geminiApiKey')).toBe('initial-gemini-key');

    // Null deletes
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { geminiApiKey: null },
    });
    expect(settingsStore.get('geminiApiKey')).toBeNull();
  });

  it('POST /api/settings/test/:kind tests credentials and sets paypalVerifiedAt on success', async () => {
    let verifiedAtSet = false;
    const { app, settingsStore } = createTestApi({
      testers: {
        paypal: async (store) => {
          store.set('paypalVerifiedAt', new Date().toISOString());
          verifiedAtSet = true;
          return { ok: true, message: 'PayPal verified successfully' };
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/test/paypal',
    });

    expect(res.statusCode).toBe(200);
    const parsed = TestSettingsResponse.parse(res.json());
    expect(parsed.ok).toBe(true);
    expect(verifiedAtSet).toBe(true);
    expect(settingsStore.get('paypalVerifiedAt')).toBeTruthy();
  });

  it('admin gate: 401 without token and 200 with token when PAYCLINIC_ADMIN_TOKEN is set', async () => {
    const { app } = createTestApi({ adminToken: 'my-super-secret-admin-token-1234' });

    // Status endpoint tells client auth is required
    const statusRes = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ required: true });

    // GET /api/settings without header fails 401
    const noToken = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(noToken.statusCode).toBe(401);

    // GET /api/settings with wrong token fails 401
    const wrongToken = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(wrongToken.statusCode).toBe(401);

    // GET /api/settings with correct token succeeds 200
    const withToken = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: 'Bearer my-super-secret-admin-token-1234' },
    });
    expect(withToken.statusCode).toBe(200);
  });

  it('admin gate: 200 without token when PAYCLINIC_ADMIN_TOKEN is unset', async () => {
    const { app } = createTestApi(); // unset admin token

    const statusRes = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ required: false });

    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
  });
});
