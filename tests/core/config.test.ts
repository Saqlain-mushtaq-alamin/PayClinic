import { describe, expect, it } from 'vitest';
import { assertSafePayPalBase, loadConfig, UnsafePayPalBaseError } from '@payclinic/core';

describe('assertSafePayPalBase', () => {
  it.each([
    'https://api-m.sandbox.paypal.com',
    'http://127.0.0.1:4010',
    'http://localhost:5000',
    'http://[::1]:4010',
  ])('allows %s', (u) => expect(() => assertSafePayPalBase(u)).not.toThrow());

  it.each([
    'https://api-m.paypal.com',
    'https://api.paypal.com',
    'http://api-m.sandbox.paypal.com',
    'https://api-m.sandbox.paypal.com.evil.com',
    'https://evil.example.com',
    'not a url',
  ])('rejects %s', (u) => expect(() => assertSafePayPalBase(u)).toThrow(UnsafePayPalBaseError));
});

describe('loadConfig', () => {
  it('defaults to offline with the simulator-friendly settings', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      mode: 'offline',
      buyerApprover: 'sim',
      aiProvider: 'fixture',
      paypalBaseUrl: null,
    });
    expect(c.ports).toEqual({ api: 4000, sim: 4010, mock: 4001 });
  });
  it('online mode requires sandbox credentials', () => {
    expect(() => loadConfig({ PAYCLINIC_MODE: 'online' })).toThrow();
  });
  it('online mode defaults to the sandbox base URL', () => {
    const c = loadConfig({
      PAYCLINIC_MODE: 'online',
      PAYPAL_CLIENT_ID: 'a',
      PAYPAL_CLIENT_SECRET: 'b',
    });
    expect(c.paypalBaseUrl).toBe('https://api-m.sandbox.paypal.com');
  });
  it('refuses a live PayPal URL even in online mode', () => {
    expect(() =>
      loadConfig({
        PAYCLINIC_MODE: 'online',
        PAYPAL_CLIENT_ID: 'a',
        PAYPAL_CLIENT_SECRET: 'b',
        PAYPAL_BASE_URL: 'https://api-m.paypal.com',
      }),
    ).toThrow(UnsafePayPalBaseError);
  });
  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ PAYCLINIC_MODE: 'yolo' })).toThrow();
  });
});
