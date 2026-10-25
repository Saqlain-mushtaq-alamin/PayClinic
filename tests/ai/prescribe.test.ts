import { describe, expect, it } from 'vitest';
import { Patch, PatchOutput, type AIProvider, type Finding } from '@payclinic/contracts';
import { AIOutputError, FakeProvider, prescribe, PrescribeError } from '@payclinic/ai';

const finding: Finding = {
  id: 'f1',
  runId: 'r',
  scenarioKey: 'B2',
  invariantKey: 'I-02',
  severity: 'critical',
  state: 'open',
  title: 'Capture amount differs',
  summary: 'x',
  evidenceStepIds: [],
  createdAt: '2026-10-18T10:00:00.000Z',
};
const ref = PatchOutput.parse({
  edits: [
    {
      file: 'apps/buggy-store/src/orders/pricing.ts',
      search: 'return clientTotal ?? serverTotal;',
      replace: 'return serverTotal;',
    },
  ],
  rationale: 'Ignore the client total.',
});
const explainOk = {
  rootCause: 'resolveAmount returns the browser total',
  impact: 'Customers can pay any amount',
  whereInCode: { file: 'apps/buggy-store/src/orders/pricing.ts', hint: 'resolveAmount' },
  fixSummary: 'Always use the server total',
};
const aiEdit = { ...ref.edits[0]!, replace: 'return serverTotal; // from the model' };
let n = 0;
const base = (provider: AIProvider, reference: PatchOutput | null = ref) => ({
  provider,
  readSource: () => 'export const x = 1;',
  loadReferencePatch: () => reference,
  deriveDiff: () => '--- a\n+++ b\n',
  newId: () => `id${++n}`,
  now: () => '2026-10-18T10:00:00.000Z',
});
const failing = (tasks: string[]): AIProvider => ({
  name: 'broken',
  generateJSON: async (o) => {
    if (tasks.includes(o.task)) throw new AIOutputError('bad json');
    return (
      new FakeProvider({
        'explain:B2': explainOk,
        'patch:B2': { edits: [aiEdit], rationale: 'r' },
      }) as AIProvider
    ).generateJSON(o);
  },
});

describe('prescribe', () => {
  it('returns the AI patch first and the reference patch second', async () => {
    const p = new FakeProvider({
      'explain:B2': explainOk,
      'patch:B2': { edits: [aiEdit], rationale: 'model' },
    });
    const out = await prescribe(base(p), finding, []);
    expect(out.patches.map((x) => x.source)).toEqual(['ai', 'template']);
    expect(out.explanation.model).toBe(p.name);
    out.patches.forEach((x) => Patch.parse(x));
  });
  it('falls back to the reference patch when the AI patch fails', async () => {
    const out = await prescribe(base(failing(['patch'])), finding, []);
    expect(out.patches.map((x) => x.source)).toEqual(['template']);
    expect(out.explanation.model).toBe('broken');
  });
  it('uses a template explanation when explain fails', async () => {
    const out = await prescribe(base(failing(['explain'])), finding, []);
    expect(out.explanation.model).toBe('template');
    expect(out.explanation.fixSummary).toContain('Ignore the client total');
    expect(out.patches.length).toBeGreaterThan(0);
  });
  it('throws PrescribeError when nothing is available', async () => {
    await expect(prescribe(base(failing(['patch', 'explain']), null), finding, [])).rejects.toThrow(
      PrescribeError,
    );
  });
  it('returns a single patch when the AI edits equal the reference', async () => {
    const p = new FakeProvider({
      'explain:B2': explainOk,
      'patch:B2': { edits: ref.edits, rationale: 'same' },
    });
    expect((await prescribe(base(p), finding, [])).patches).toHaveLength(1);
  });
});
