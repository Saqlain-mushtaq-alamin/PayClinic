import { describe, expect, it } from 'vitest';
import {
  fromMinor,
  InvalidAmountError,
  isValidAmountString,
  toMinor,
  UnknownCurrencyError,
} from '@payclinic/core';

describe('money', () => {
  it('converts to minor units exactly', () => {
    expect(toMinor('25.00', 'USD')).toBe(2500n);
    expect(toMinor('25', 'USD')).toBe(2500n);
    expect(toMinor('25.5', 'USD')).toBe(2550n);
    expect(toMinor('2400', 'JPY')).toBe(2400n);
  });
  it('rejects amounts that violate the currency exponent', () => {
    expect(() => toMinor('2400.00', 'JPY')).toThrow(InvalidAmountError);
    expect(() => toMinor('25.999', 'USD')).toThrow(InvalidAmountError);
    expect(() => toMinor('abc', 'USD')).toThrow(InvalidAmountError);
  });
  it('throws for unknown currencies', () => {
    expect(() => toMinor('1', 'XXX')).toThrow(UnknownCurrencyError);
  });
  it('formats minor units', () => {
    expect(fromMinor(2500n, 'USD')).toBe('25.00');
    expect(fromMinor(5n, 'USD')).toBe('0.05');
    expect(fromMinor(2400n, 'JPY')).toBe('2400');
  });
  it('validates amount strings', () => {
    expect(isValidAmountString('25.5', 'USD')).toBe(true);
    expect(isValidAmountString('0.30000000000000004', 'USD')).toBe(false);
    expect(isValidAmountString('1200.00', 'JPY')).toBe(false);
    expect(isValidAmountString('1200', 'JPY')).toBe(true);
  });
});
