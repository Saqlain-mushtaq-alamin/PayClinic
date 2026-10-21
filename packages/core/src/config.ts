import { z } from 'zod';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Raised when configuration is missing or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Raised when a PayPal base URL could point at live PayPal or an untrusted host. */
export class UnsafePayPalBaseError extends Error {
  constructor(url: string) {
    super(`Unsafe PayPal base URL: ${url}`);
    this.name = 'UnsafePayPalBaseError';
  }
}

/** Allows the PayPal sandbox host and loopback hosts only. */
export function assertSafePayPalBase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafePayPalBaseError(url);
  }

  const isSandbox = parsed.protocol === 'https:' && parsed.host === 'api-m.sandbox.paypal.com';
  const isLoopback =
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOOPBACK_HOSTS.has(parsed.hostname);

  if (!isSandbox && !isLoopback) {
    throw new UnsafePayPalBaseError(url);
  }
}

const configSchema = z.object({
  mode: z.enum(['offline', 'online']),
  paypalBaseUrl: z.string().nullable(),
  paypalClientId: z.string().optional(),
  paypalClientSecret: z.string().optional(),
  buyerApprover: z.enum(['sim', 'manual', 'playwright', 'card']),
  aiProvider: z.enum(['fixture', 'gemini', 'fake']),
  geminiApiKey: z.string().optional(),
  geminiModel: z.string().optional(),
  aiRecord: z.boolean(),
  ports: z.object({
    api: z.number().int().min(0).max(65535),
    sim: z.number().int().min(0).max(65535),
    mock: z.number().int().min(0).max(65535),
  }),
  dbPath: z.string(),
});

export type Config = z.infer<typeof configSchema>;

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new ConfigError(`${name} must be an integer between 0 and 65535`);
  }
  return value;
}

/** Reads and validates PayClinic configuration from an environment map. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const mode = z.enum(['offline', 'online']).parse(env.PAYCLINIC_MODE ?? 'offline');
  const buyerApprover = z
    .enum(['sim', 'manual', 'playwright', 'card'])
    .parse(env.BUYER_APPROVER ?? 'sim');
  const aiProvider = z.enum(['fixture', 'gemini', 'fake']).parse(env.AI_PROVIDER ?? 'fixture');

  const paypalClientId = env.PAYPAL_CLIENT_ID;
  const paypalClientSecret = env.PAYPAL_CLIENT_SECRET;

  if (mode === 'online' && (!paypalClientId || !paypalClientSecret)) {
    throw new ConfigError('online mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
  }

  const paypalBaseUrl = env.PAYPAL_BASE_URL ?? (mode === 'online' ? SANDBOX_BASE_URL : null);
  if (paypalBaseUrl !== null) {
    assertSafePayPalBase(paypalBaseUrl);
  }

  return configSchema.parse({
    mode,
    paypalBaseUrl,
    paypalClientId,
    paypalClientSecret,
    buyerApprover,
    aiProvider,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    aiRecord: env.AI_RECORD === '1' || env.AI_RECORD === 'true',
    ports: {
      api: parsePort('PAYCLINIC_API_PORT', env.PAYCLINIC_API_PORT, 4000),
      sim: parsePort('PAYCLINIC_SIM_PORT', env.PAYCLINIC_SIM_PORT, 4010),
      mock: parsePort('PAYCLINIC_MOCK_PORT', env.PAYCLINIC_MOCK_PORT, 4001),
    },
    dbPath: env.DB_PATH ?? './data/payclinic.db',
  });
}
