import { CURRENCY_EXPONENT } from '@payclinic/core';

export type AmountIssue = {
  issue: 'DECIMAL_PRECISION' | 'INVALID_VALUE';
  field: string;
};

const CURRENCIES = new Set(Object.keys(CURRENCY_EXPONENT));

function amountPattern(exponent: number): RegExp {
  return exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
}

/** Returns the PayPal amount issue for a value/currency pair, or null when valid. */
export function validateAmount(value: unknown, currency: unknown): AmountIssue | null {
  if (typeof currency !== 'string' || !CURRENCIES.has(currency)) {
    return { issue: 'INVALID_VALUE', field: 'currency_code' };
  }
  if (typeof value !== 'string') {
    return { issue: 'INVALID_VALUE', field: 'value' };
  }

  const exponent = (CURRENCY_EXPONENT as Record<string, number>)[currency] ?? 2;
  if (amountPattern(exponent).test(value)) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return { issue: 'DECIMAL_PRECISION', field: 'value' };
  }
  return { issue: 'INVALID_VALUE', field: 'value' };
}
