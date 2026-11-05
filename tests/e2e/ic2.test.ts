import { afterAll, beforeAll, expect, it } from 'vitest';
import { FindingDetail, RunDetail } from '@payclinic/contracts';
import { buildTestRuntime, startApiOnFreePort } from './helpers';

let api: Awaited<ReturnType<typeof startApiOnFreePort>>;
beforeAll(async () => {
  api = await startApiOnFreePort(await buildTestRuntime());
}, 60_000);
afterAll(async () => {
  await api.close();
});

it('MVP loop: diagnose five bugs, fix all, score 61 → 100, offline, no API keys', async () => {
  const create = await fetch(`${api.baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: 'store',
      mode: 'offline',
      scenarios: ['B1', 'B2', 'B3', 'B4', 'B5'],
    }),
  });
  const { runId } = (await create.json()) as { runId: string };
  let detail!: RunDetail;
  for (let i = 0; i < 300; i++) {
    detail = RunDetail.parse(await (await fetch(`${api.baseUrl}/api/runs/${runId}`)).json());
    if (detail.run.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(detail.findings.map((f) => f.invariantKey).sort()).toEqual([
    'I-01',
    'I-02',
    'I-04',
    'I-05',
    'I-06',
  ]);
  expect(detail.score.score).toBe(61);
  for (const f of detail.findings) {
    expect(
      (await fetch(`${api.baseUrl}/api/findings/${f.id}/prescribe`, { method: 'POST' })).status,
    ).toBe(202);
    for (let i = 0; i < 360; i++) {
      const d = FindingDetail.parse(
        await (await fetch(`${api.baseUrl}/api/findings/${f.id}`)).json(),
      );
      if (d.finding.state !== 'open' && d.finding.state !== 'patched') {
        expect(d.finding.state).toBe('verified');
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const after = RunDetail.parse(await (await fetch(`${api.baseUrl}/api/runs/${runId}`)).json());
  expect(after.score.score).toBe(100);
  expect(after.run.scoreAfter).toBe(100);
}, 600_000);
