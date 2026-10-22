import type { AIProvider, GenerateJsonOptions } from '@payclinic/contracts';
import { FixtureMissingError } from '../errors';
import { parseOutput } from './fixture';

/** Returns canned outputs by fixture key; used by unit tests and offline demos. */
export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  private readonly map: Record<string, unknown>;

  constructor(map: Record<string, unknown>) {
    this.map = map;
  }

  async generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(this.map, opts.fixtureKey)) {
      throw new FixtureMissingError(opts.fixtureKey);
    }
    return parseOutput(opts.schema, this.map[opts.fixtureKey], `fake output "${opts.fixtureKey}"`);
  }
}
