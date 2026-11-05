import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkNodeVersion,
  copyEnvIfMissing,
  missingFixtures,
  REQUIRED_FIXTURES,
} from '../../scripts/setup';
import { shouldSkipSeed } from '../../scripts/seed-demo';

describe('setup pure helpers', () => {
  describe('checkNodeVersion', () => {
    it('fails for node versions below 20.6', () => {
      expect(checkNodeVersion('v18.0.0')).toBe(false);
      expect(checkNodeVersion('v19.9.0')).toBe(false);
      expect(checkNodeVersion('v20.0.0')).toBe(false);
      expect(checkNodeVersion('v20.5.9')).toBe(false);
      expect(checkNodeVersion('18.0.0')).toBe(false);
    });

    it('passes for node versions >= 20.6', () => {
      expect(checkNodeVersion('v20.6.0')).toBe(true);
      expect(checkNodeVersion('v20.10.0')).toBe(true);
      expect(checkNodeVersion('v22.1.0')).toBe(true);
      expect(checkNodeVersion('v23.0.0')).toBe(true);
      expect(checkNodeVersion('22.1.0')).toBe(true);
    });

    it('returns false for invalid version string', () => {
      expect(checkNodeVersion('not-a-version')).toBe(false);
      expect(checkNodeVersion('')).toBe(false);
    });
  });

  describe('missingFixtures', () => {
    it('returns all required fixtures when listing is empty', () => {
      const missing = missingFixtures([]);
      expect(missing).toEqual([...REQUIRED_FIXTURES]);
      expect(missing).toHaveLength(15);
    });

    it('returns empty array when all fixtures are present', () => {
      const missing = missingFixtures(REQUIRED_FIXTURES);
      expect(missing).toEqual([]);
    });

    it('returns only the missing fixtures', () => {
      const present = [
        'fixtures/patches/B1.json',
        'fixtures/patches/B2.json',
        'fixtures/ai/explain.B1.json',
      ];
      const missing = missingFixtures(present);
      expect(missing).not.toContain('fixtures/patches/B1.json');
      expect(missing).not.toContain('fixtures/patches/B2.json');
      expect(missing).not.toContain('fixtures/ai/explain.B1.json');
      expect(missing).toContain('fixtures/patches/B3.json');
      expect(missing).toContain('fixtures/ai/patch.B1.json');
      expect(missing).toHaveLength(12);
    });

    it('handles Windows backslashes and fixture-relative paths', () => {
      const present = ['fixtures\\patches\\B1.json', 'ai/explain.B1.json'];
      const missing = missingFixtures(present);
      expect(missing).not.toContain('fixtures/patches/B1.json');
      expect(missing).not.toContain('fixtures/ai/explain.B1.json');
    });
  });

  describe('copyEnvIfMissing', () => {
    const tmpDir = join(__dirname, '../../.payclinic-tmp/setup-test');
    const envPath = join(tmpDir, '.env');
    const examplePath = join(tmpDir, '.env.example');

    beforeEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(examplePath, 'PAYCLINIC_MODE=offline\nFOO=default\n', 'utf8');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates .env from .env.example when .env is missing', () => {
      expect(existsSync(envPath)).toBe(false);
      const created = copyEnvIfMissing(envPath, examplePath);
      expect(created).toBe(true);
      expect(existsSync(envPath)).toBe(true);
      expect(readFileSync(envPath, 'utf8')).toBe('PAYCLINIC_MODE=offline\nFOO=default\n');
    });

    it('never overwrites existing .env', () => {
      writeFileSync(envPath, 'FOO=custom_value\n', 'utf8');
      const created = copyEnvIfMissing(envPath, examplePath);
      expect(created).toBe(false);
      expect(readFileSync(envPath, 'utf8')).toBe('FOO=custom_value\n');
    });
  });

  describe('shouldSkipSeed', () => {
    it('skips when runs exist and force is false', () => {
      expect(shouldSkipSeed(3, false)).toBe(true);
      expect(shouldSkipSeed(1, false)).toBe(true);
    });

    it('does not skip when no runs exist or force is true', () => {
      expect(shouldSkipSeed(0, false)).toBe(false);
      expect(shouldSkipSeed(3, true)).toBe(false);
      expect(shouldSkipSeed(0, true)).toBe(false);
    });
  });
});
