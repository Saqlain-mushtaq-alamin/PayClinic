import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIProvider, GenerateJsonOptions } from '@payclinic/contracts';
import { AIOutputError } from '../errors';
import { isEnoent, parseOutput } from './fixture';

/** Disk cache keyed by makeCacheKey(); a hit never calls the inner provider. */
export class CachedProvider implements AIProvider {
  readonly name: string;
  private readonly inner: AIProvider;
  private readonly dir: string;

  constructor(inner: AIProvider, dir: string) {
    this.inner = inner;
    this.dir = dir;
    this.name = `cached:${inner.name}`;
  }

  async generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const path = join(this.dir, `${opts.cacheKey}.json`);

    let text: string | undefined;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }

    if (text !== undefined) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new AIOutputError(`Cached output "${opts.cacheKey}" is not valid JSON`, {
          cause: error,
        });
      }
      return parseOutput(opts.schema, json, `cached output "${opts.cacheKey}"`);
    }

    const output = await this.inner.generateJSON(opts);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
  }
}
