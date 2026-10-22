import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIProvider, GenerateJsonOptions } from '@payclinic/contracts';
import { fixtureFileName } from './fixture';

/** Records every validated output as a reusable fixture file. */
export class RecordingProvider implements AIProvider {
  readonly name: string;
  private readonly inner: AIProvider;
  private readonly dir: string;

  constructor(inner: AIProvider, dir: string) {
    this.inner = inner;
    this.dir = dir;
    this.name = `recording:${inner.name}`;
  }

  async generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const output = await this.inner.generateJSON(opts);
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, fixtureFileName(opts.fixtureKey)),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    return output;
  }
}
