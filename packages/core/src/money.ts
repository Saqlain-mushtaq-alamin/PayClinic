/** Minor-unit exponent for every currency PayClinic supports. */
export const CURRENCY_EXPONENT = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  HUF: 0,
  TWD: 0,
} as const;

export class UnknownCurrencyError extends Error {
  constructor(currency: string) {
    super(`Unknown currency: ${currency}`);
    this.name = 'UnknownCurrencyError';
  }
}

export class InvalidAmountError extends Error {
  constructor(value: string, currency: string) {
    super(`Invalid amount "${value}" for ${currency}`);
    this.name = 'InvalidAmountError';
  }
}

function exponentOf(currency: string): number {
  const exponent = (CURRENCY_EXPONENT as Record<string, number>)[currency];
  if (exponent === undefined) {
    throw new UnknownCurrencyError(currency);
  }
  return exponent;
}

function patternFor(exponent: number): RegExp {
  return exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
}

/** Converts a decimal amount string to exact minor units. */
export function toMinor(value: string, currency: string): bigint {
  const exponent = exponentOf(currency);
  if (!patternFor(exponent).test(value)) {
    throw new InvalidAmountError(value, currency);
  }
  const [whole = '', fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(exponent, '0'));
}

/** Formats exact minor units as a decimal amount string. */
export function fromMinor(minor: bigint, currency: string): string {
  const exponent = exponentOf(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString();
  const sign = negative ? '-' : '';

  if (exponent === 0) return sign + digits;

  const padded = digits.padStart(exponent + 1, '0');
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** Returns whether a string is a valid amount for the currency's exponent. */
export function isValidAmountString(value: string, currency: string): boolean {
  return patternFor(exponentOf(currency)).test(value);
}
