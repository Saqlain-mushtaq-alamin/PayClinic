import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Finding,
  FirewallDecision,
  GoldenTrace,
  INVARIANT_META,
  InvariantKey,
  Patch,
  Policy,
  Run,
  SCENARIO_META,
  ScenarioKey,
  SEVERITY_POINTS,
  RunEvent,
  RunCreateRequest,
  CliReport,
  type Step,
} from '@payclinic/contracts';
import { buildState, buildStep } from '@payclinic/contracts/testing';

const samples = join(__dirname, '../../packages/contracts/src/samples');
const read = (p: string) => JSON.parse(readFileSync(join(samples, p), 'utf8'));

describe('contracts: samples validate against schemas', () => {
  it.each([
    ['run.sample.json', Run],
    ['finding.sample.json', Finding],
    ['patch.sample.json', Patch],
    ['policy.sample.json', Policy],
    ['decision.sample.json', FirewallDecision],
  ] as const)('%s', (file, schema) => {
    expect(() => schema.parse(read(file))).not.toThrow();
  });

  it('all golden traces validate', () => {
    const files = readdirSync(join(samples, 'traces')).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(() => GoldenTrace.parse(read(`traces/${f}`))).not.toThrow();
  });

  it('rejects float money and non-sandbox edit paths', () => {
    expect(() => Policy.parse({ version: 1, currency: 'USD', perTransactionCap: 'abc' })).toThrow();
    expect(() =>
      Patch.parse({
        ...read('patch.sample.json'),
        edits: [{ file: 'package.json', search: 'a', replace: 'b' }],
      }),
    ).toThrow();
  });

  it('CliReport parses a minimal report', () => {
    expect(
      CliReport.parse({
        runId: 'r',
        mode: 'offline',
        score: 70,
        findings: [
          {
            scenario: 'B1',
            invariant: 'I-01',
            severity: 'critical',
            state: 'open',
            title: 't',
            summary: 's',
          },
        ],
      }),
    ).toBeTruthy();
  });

  it('API and event schemas parse a basic payload', () => {
    expect(
      RunCreateRequest.parse({ target: 'store', mode: 'offline', scenarios: ['B1'] }),
    ).toBeTruthy();
    expect(RunEvent.parse({ type: 'run.failed', runId: 'r', error: 'x' })).toBeTruthy();
  });
});

describe('contracts: metadata is consistent', () => {
  it('every invariant has metadata', () => {
    for (const k of InvariantKey.options) expect(INVARIANT_META[k]).toBeDefined();
  });
  it('every scenario references existing invariants', () => {
    for (const k of ScenarioKey.options)
      for (const inv of SCENARIO_META[k].invariantKeys) expect(INVARIANT_META[inv]).toBeDefined();
  });
  it('score example: all 5 merchant bugs + both agent attacks leaves a score of 39', () => {
    const unresolved = new Set<InvariantKey>([
      'I-01',
      'I-02',
      'I-04',
      'I-05',
      'I-06',
      'I-07',
      'I-08',
      'I-09',
    ]);
    const penalty = [...unresolved].reduce(
      (s, k) => s + SEVERITY_POINTS[INVARIANT_META[k].severity],
      0,
    );
    expect(100 - penalty).toBe(39);
  });
});

describe('contracts: golden traces agree with the invariant spec (reference check)', () => {
  const path = (s: Step) => new URL(s.url).pathname;
  const ok = (s: Step) => s.responseStatus >= 200 && s.responseStatus < 300;
  const captures = (t: Step[]) =>
    t.filter(
      (s) =>
        s.method === 'POST' && /^\/v2\/checkout\/orders\/[^/]+\/capture$/.test(path(s)) && ok(s),
    );
  const cartOf = (s: Step) => (s.responseBody as any).purchase_units[0].custom_id as string;
  const amountOf = (s: Step) =>
    (s.responseBody as any).purchase_units[0].payments.captures[0].amount.value as string;

  const failing = (g: GoldenTrace) => {
    const out = new Set<string>();
    const caps = captures(g.steps);
    const byCart = new Map<string, number>();
    for (const c of caps) byCart.set(cartOf(c), (byCart.get(cartOf(c)) ?? 0) + 1);
    if ([...byCart.values()].some((n) => n > 1)) out.add('I-01');
    for (const c of caps) {
      const cart = g.state.carts.find((x) => x.id === cartOf(c));
      if (cart && Number(cart.expectedTotal) !== Number(amountOf(c))) out.add('I-02');
    }
    for (const mo of g.state.merchantOrders) {
      const hasCapture = caps.some((c) => path(c).includes(`/${mo.paypalOrderId}/`));
      if (mo.paid !== hasCapture) out.add('I-04');
    }
    return [...out].sort();
  };

  for (const f of readdirSync(join(samples, 'traces')).filter((x) => x.endsWith('.json'))) {
    it(`${f}: failing invariants match expectation`, () => {
      const g = GoldenTrace.parse(read(`traces/${f}`));
      expect(failing(g)).toEqual([...g.expectedFailingInvariants].sort());
    });
  }
});

describe('contracts: testing builders', () => {
  it('builders produce valid objects', () => {
    expect(buildState().carts).toHaveLength(1);
    expect(buildStep({ method: 'POST' }).method).toBe('POST');
  });
});
