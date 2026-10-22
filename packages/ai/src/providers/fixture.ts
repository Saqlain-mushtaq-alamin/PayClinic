import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIProvider, GenerateJsonOptions } from '@payclinic/contracts';
import { AIOutputError, FixtureMissingError } from '../errors';

/** Maps a logical fixture key ("explain:B1") to its file name ("explain.B1.json"). */
export function fixtureFileName(fixtureKey: string): string {
  return `${fixtureKey.replaceAll(':', '.')}.json`;
}

/** Validates an untrusted AI/JSON payload with the caller's schema. */
export function parseOutput<T>(
  schema: GenerateJsonOptions<T>['schema'],
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AIOutputError(`${label} does not match the expected schema: ${result.error.message}`);
  }
  return result.data;
}

export function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Reads validated AI outputs from a directory of recorded fixture files. */
export class FixtureProvider implements AIProvider {
  readonly name = 'fixture';
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const path = join(this.dir, fixtureFileName(opts.fixtureKey));

    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (isEnoent(error)) throw new FixtureMissingError(opts.fixtureKey);
      throw error;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new AIOutputError(`Fixture "${opts.fixtureKey}" is not valid JSON`, { cause: error });
    }

    return parseOutput(opts.schema, json, `fixture "${opts.fixtureKey}"`);
  }
}
