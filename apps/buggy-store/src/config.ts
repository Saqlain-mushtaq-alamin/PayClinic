import { assertSafePayPalBase } from '@payclinic/core';

export interface StoreConfig {
  port: number;
  paypalBaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  dbPath: string;
  admin: boolean;
}

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new StoreConfigError('PORT must be an integer between 0 and 65535');
  }
  return value;
}

/** Reads the store environment and enforces the PayPal sandbox/loopback guard. */
export function loadStoreConfig(env: Record<string, string | undefined>): StoreConfig {
  const paypalBaseUrl = env.PAYPAL_BASE_URL;
  if (!paypalBaseUrl) throw new StoreConfigError('PAYPAL_BASE_URL is required');
  assertSafePayPalBase(paypalBaseUrl);

  const paypalClientId = env.PAYPAL_CLIENT_ID;
  const paypalClientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!paypalClientId || !paypalClientSecret) {
    throw new StoreConfigError('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required');
  }

  return {
    port: parsePort(env.PORT),
    paypalBaseUrl,
    paypalClientId,
    paypalClientSecret,
    dbPath: env.STORE_DB_PATH ?? ':memory:',
    admin: env.STORE_ADMIN === '1' || env.STORE_ADMIN === 'true',
  };
}
