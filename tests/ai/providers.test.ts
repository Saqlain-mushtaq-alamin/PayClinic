import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GenerateJsonOptions } from '@payclinic/contracts';
import {
  AIOutputError,
  AIRateLimitError,
  CachedProvider,
  FakeProvider,
  FixtureMissingError,
  FixtureProvider,
  GeminiProvider,
  RecordingProvider,
  makeCacheKey,
  type GeminiLike,
} from '@payclinic/ai';

const schema = z.object({ ok: z.boolean() });
type Output = z.infer<typeof schema>;

const baseOptions: GenerateJsonOptions<Output> = {
  task: 'explain',
  system: 'system text',
  prompt: 'prompt text',
  schema,
  cacheKey: makeCacheKey({
    task: 'explain',
    system: 'system text',
    prompt: 'prompt text',
    model: 'gemini-test',
  }),
  fixtureKey: 'explain:B1',
};

const options = (overrides: Partial<GenerateJsonOptions<Output>> = {}) => ({
  ...baseOptions,
  ...overrides,
});

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'payclinic-ai-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface GeminiCall {
  model: string;
  contents: string;
  config: { systemInstruction: string; responseMimeType: string; temperature: number };
}

function fakeGemini(responses: Array<string | Error>): {
  client: GeminiLike;
  calls: GeminiCall[];
} {
  const calls: GeminiCall[] = [];
  let index = 0;
  const client: GeminiLike = {
    models: {
      async generateContent(args: GeminiCall) {
        calls.push(args);
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return { text: next };
      },
    },
  };
  return { client, calls };
}

describe('FakeProvider', () => {
  it('returns the canned output validated by the schema', async () => {
    const provider = new FakeProvider({ 'explain:B1': { ok: true } });

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });
  });

  it('throws AIOutputError when the canned output has the wrong shape', async () => {
    const provider = new FakeProvider({ 'explain:B1': { ok: 'yes' } });

    await expect(provider.generateJSON(options())).rejects.toBeInstanceOf(AIOutputError);
  });

  it('throws FixtureMissingError for an unknown fixture key', async () => {
    const provider = new FakeProvider({});

    await expect(provider.generateJSON(options())).rejects.toMatchObject({
      name: 'FixtureMissingError',
      fixtureKey: 'explain:B1',
    });
  });
});

describe('FixtureProvider', () => {
  it('reads the fixture file named after the fixture key', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'explain.B1.json'), JSON.stringify({ ok: true }), 'utf8');

    const provider = new FixtureProvider(dir);

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });
  });

  it('reports FixtureMissingError with the missing key', async () => {
    const dir = await makeTempDir();
    const provider = new FixtureProvider(dir);

    await expect(provider.generateJSON(options({ fixtureKey: 'patch:B2' }))).rejects.toEqual(
      expect.objectContaining<Partial<FixtureMissingError>>({
        name: 'FixtureMissingError',
        fixtureKey: 'patch:B2',
      }),
    );
  });
});

describe('makeCacheKey', () => {
  const key = {
    task: 'explain' as const,
    system: 'system',
    prompt: 'prompt',
    model: 'gemini-test',
  };

  it('is a stable sha256 hex digest', () => {
    const value = makeCacheKey(key);

    expect(value).toBe(makeCacheKey({ ...key }));
    expect(value).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when any field changes', () => {
    const value = makeCacheKey(key);

    expect(makeCacheKey({ ...key, task: 'patch' })).not.toBe(value);
    expect(makeCacheKey({ ...key, system: 'other' })).not.toBe(value);
    expect(makeCacheKey({ ...key, prompt: 'other' })).not.toBe(value);
    expect(makeCacheKey({ ...key, model: 'other' })).not.toBe(value);
  });
});

describe('GeminiProvider', () => {
  it('parses valid JSON on the first try', async () => {
    const { client, calls } = fakeGemini(['{"ok":true}']);
    const provider = new GeminiProvider({ model: 'gemini-test', client });

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: 'gemini-test',
      contents: 'prompt text',
      config: {
        systemInstruction: 'system text',
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });
  });

  it('strips ```json fences before parsing', async () => {
    const { client } = fakeGemini(['```json\n{"ok":true}\n```']);
    const provider = new GeminiProvider({ model: 'gemini-test', client });

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });
  });

  it('repairs once and appends the validation message to the second prompt', async () => {
    const { client, calls } = fakeGemini(['{"ok":"nope"}', '{"ok":true}']);
    const provider = new GeminiProvider({ model: 'gemini-test', client });

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(2);
    const repairedPrompt = calls[1]?.contents ?? '';
    expect(repairedPrompt).toContain('prompt text');
    expect(repairedPrompt).toContain('Expected boolean');
  });

  it('throws AIOutputError when both attempts are invalid', async () => {
    const { client, calls } = fakeGemini(['{"ok":"nope"}', '{"ok":"nope"}']);
    const provider = new GeminiProvider({ model: 'gemini-test', client });

    await expect(provider.generateJSON(options())).rejects.toBeInstanceOf(AIOutputError);
    expect(calls).toHaveLength(2);
  });

  it('backs off 1s then 2s on 429/5xx and succeeds', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), { status: 429 });
    const { client } = fakeGemini([rateLimited, rateLimited, '{"ok":true}']);
    const sleep = vi.fn(async () => {});
    const provider = new GeminiProvider({ model: 'gemini-test', client, sleep });

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });

    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('throws AIRateLimitError after four failed attempts', async () => {
    const unavailable = Object.assign(new Error('unavailable'), { status: 503 });
    const { client } = fakeGemini([unavailable, unavailable, unavailable, unavailable]);
    const sleep = vi.fn(async () => {});
    const provider = new GeminiProvider({ model: 'gemini-test', client, sleep });

    await expect(provider.generateJSON(options())).rejects.toBeInstanceOf(AIRateLimitError);

    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it('uses task-specific temperatures', async () => {
    const tasks = [
      ['patch', 0.2],
      ['policy', 0.2],
      ['variations', 0.7],
      ['explain', 0.2],
    ] as const;

    for (const [task, temperature] of tasks) {
      const { client, calls } = fakeGemini(['{"ok":true}']);
      const provider = new GeminiProvider({ model: 'gemini-test', client });

      await provider.generateJSON(options({ task }));

      expect(calls[0]?.config.temperature).toBe(temperature);
    }
  });
});

describe('CachedProvider', () => {
  it('serves the second call from disk and calls the inner provider once', async () => {
    const dir = await makeTempDir();
    const inner = new FakeProvider({ 'explain:B1': { ok: true } });
    const generate = vi.spyOn(inner, 'generateJSON');
    const provider = new CachedProvider(inner, dir);
    const opts = options();

    await expect(provider.generateJSON(opts)).resolves.toEqual({ ok: true });
    await expect(provider.generateJSON(opts)).resolves.toEqual({ ok: true });

    expect(generate).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(await readFile(join(dir, `${opts.cacheKey}.json`), 'utf8'));
    expect(cached).toEqual({ ok: true });
  });
});

describe('RecordingProvider', () => {
  it('writes the validated output as explain.B1.json', async () => {
    const dir = await makeTempDir();
    await mkdir(dir, { recursive: true });
    const provider = new RecordingProvider(new FakeProvider({ 'explain:B1': { ok: true } }), dir);

    await expect(provider.generateJSON(options())).resolves.toEqual({ ok: true });

    const written = JSON.parse(await readFile(join(dir, 'explain.B1.json'), 'utf8'));
    expect(written).toEqual({ ok: true });
  });
});
