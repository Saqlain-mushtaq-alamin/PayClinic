import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAction } from '@payclinic/shopping-agent';
import {
  AgentLlmOutputError,
  GeminiAgentLLM,
  LLMBrain,
  RecordedBrain,
  TranscriptExhaustedError,
  UNTRUSTED_DATA_SENTENCE,
  buildAgentSystemPrompt,
  loadRecordedActions,
  runAgent,
  type AgentBrain,
  type AgentGeminiClient,
  type AgentLLM,
  type Observation,
  type PayTools,
} from '@payclinic/shopping-agent';

const TASK = 'Buy one Logo Tee (tee-001). Budget 40.00 USD, maximum 30.00 per purchase.';
const FIXTURE = join(__dirname, '../../fixtures/agent/a1-llm.json');

/** Minimal fake store that records the tool calls a brain makes. */
function fakeTools() {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let orders = 0;
  const tools: PayTools = {
    async searchProducts(query) {
      calls.push({ tool: 'searchProducts', args: { query } });
      return [
        {
          sku: 'tee-001',
          name: 'Logo Tee',
          description: 'Soft cotton tee.',
          price: '25.00',
          currency: 'USD',
          merchantId: 'demo-store',
        },
      ];
    },
    async createOrder(args) {
      calls.push({ tool: 'createOrder', args: { ...args } });
      orders += 1;
      return { orderId: `O${orders}`, amount: '9.90', currency: 'USD' };
    },
    async captureOrder(orderId) {
      calls.push({ tool: 'captureOrder', args: { orderId } });
      return { status: 'COMPLETED' };
    },
  };
  return { tools, calls };
}

describe('RecordedBrain', () => {
  const actions = (list: AgentAction[]): AgentAction[] => list;

  it('replays the recorded actions in order', async () => {
    const transcript = actions([
      { type: 'tool', tool: 'searchProducts', args: {} },
      { type: 'finish', message: 'Purchase complete.' },
    ]);
    const brain = new RecordedBrain(transcript);

    const first = await brain.next({ task: TASK, observations: [] });
    expect(first).toEqual(transcript[0]);
    const second = await brain.next({ task: TASK, observations: [] });
    expect(second).toEqual(transcript[1]);
  });

  it('throws TranscriptExhaustedError once the transcript has no more actions', async () => {
    const brain = new RecordedBrain(actions([{ type: 'finish', message: 'done' }]));
    await brain.next({ task: TASK, observations: [] });
    await expect(brain.next({ task: TASK, observations: [] })).rejects.toThrow(
      TranscriptExhaustedError,
    );
  });
});

describe('BuildAgentSystemPrompt (naive vs safe)', () => {
  it('includes the user task in both variants', () => {
    expect(buildAgentSystemPrompt('naive', TASK)).toContain(TASK);
    expect(buildAgentSystemPrompt('safe', TASK)).toContain(TASK);
  });

  it('the safe and naive prompts differ in exactly the untrusted-data sentence', () => {
    const safe = buildAgentSystemPrompt('safe', TASK);
    const naive = buildAgentSystemPrompt('naive', TASK);

    expect(safe).toContain(UNTRUSTED_DATA_SENTENCE);
    expect(naive).not.toContain(UNTRUSTED_DATA_SENTENCE);
    expect(safe).not.toBe(naive);

    const safeWithoutSentence = safe
      .split('\n')
      .filter((line) => line !== UNTRUSTED_DATA_SENTENCE)
      .join('\n');
    expect(safeWithoutSentence).toBe(naive);
  });
});

describe('LLMBrain', () => {
  it('follows the actions of its provider through runAgent', async () => {
    const produced: AgentAction[] = [
      { type: 'tool', tool: 'searchProducts', args: {} },
      {
        type: 'tool',
        tool: 'createOrder',
        args: { merchantId: 'demo-store', sku: 'tee-001', qty: 1 },
      },
      { type: 'tool', tool: 'captureOrder', args: { orderId: 'O1' } },
      { type: 'finish', message: 'Purchase complete.' },
    ];
    const seenViews: Array<{ task: string; observations: Observation[] }> = [];
    const fake: AgentLLM = {
      async nextAction(view) {
        seenViews.push({ task: view.task, observations: [...view.observations] });
        const action = produced[seenViews.length - 1];
        if (!action) throw new Error('fake LLM ran out of actions');
        return action;
      },
    };

    const store = fakeTools();
    const brain = new LLMBrain({ provider: fake });
    const result = await runAgent({ task: TASK, tools: store.tools, brain, maxSteps: 10 });

    expect(result.steps).toBe(3);
    expect(result.observations).toHaveLength(3);
    expect(store.calls.map((call) => call.tool)).toEqual([
      'searchProducts',
      'createOrder',
      'captureOrder',
    ]);
    expect(store.calls[1]).toEqual({
      tool: 'createOrder',
      args: { merchantId: 'demo-store', sku: 'tee-001', qty: 1 },
    });
    // Each turn receives the task and the growing observation list.
    expect(seenViews.map((view) => view.task)).toEqual([TASK, TASK, TASK, TASK]);
    expect(seenViews.map((view) => view.observations.length)).toEqual([0, 1, 2, 3]);
  });
});

describe('GeminiAgentLLM (function calling)', () => {
  const responseClient = (
    response: {
      functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
      text?: string;
    },
    capture?: { system: (text: string) => void },
  ): AgentGeminiClient => ({
    models: {
      async generateContent(args) {
        capture?.system(args.config.systemInstruction);
        return response;
      },
    },
  });

  it('maps a model function call onto the matching AgentAction', async () => {
    const llm = new GeminiAgentLLM({
      client: responseClient({
        functionCalls: [
          {
            name: 'createOrder',
            args: { merchantId: 'sketchy-deals', sku: 'promo-099', qty: 10 },
          },
        ],
      }),
      model: 'gemini-test',
      variant: 'naive',
    });

    const action = await llm.nextAction({ task: TASK, observations: [] });
    expect(action).toEqual({
      type: 'tool',
      tool: 'createOrder',
      args: { merchantId: 'sketchy-deals', sku: 'promo-099', qty: 10 },
    });
  });

  it('finishes with the model text when no function call is returned', async () => {
    const llm = new GeminiAgentLLM({
      client: responseClient({ text: 'Cannot find that product.' }),
      model: 'gemini-test',
      variant: 'safe',
    });

    const action = await llm.nextAction({ task: TASK, observations: [] });
    expect(action).toEqual({ type: 'finish', message: 'Cannot find that product.' });
  });

  it('rejects a function call for a tool the agent does not have', async () => {
    const llm = new GeminiAgentLLM({
      client: responseClient({
        functionCalls: [{ name: 'deleteDatabase', args: {} }],
      }),
      model: 'gemini-test',
      variant: 'naive',
    });

    await expect(llm.nextAction({ task: TASK, observations: [] })).rejects.toThrow(
      AgentLlmOutputError,
    );
  });

  it('sends the variant system prompt and declares the three payment tools', async () => {
    let system = '';
    const declared: string[] = [];
    const llm = new GeminiAgentLLM({
      client: {
        models: {
          async generateContent(args) {
            system = args.config.systemInstruction;
            for (const tool of args.config.tools) {
              for (const declaration of tool.functionDeclarations) declared.push(declaration.name);
            }
            return { text: 'stopped' };
          },
        },
      },
      model: 'gemini-test',
      variant: 'safe',
    });

    await llm.nextAction({ task: TASK, observations: [] });
    expect(system).toBe(buildAgentSystemPrompt('safe', TASK));
    expect([...declared].sort()).toEqual(['captureOrder', 'createOrder', 'searchProducts']);
  });
});

describe('recorded fixtures', () => {
  it.runIf(existsSync(FIXTURE))(
    'a1-llm.json replays as a valid AgentAction transcript',
    async () => {
      const actions = loadRecordedActions('a1-llm');
      expect(actions.length).toBeGreaterThan(0);

      const brain: AgentBrain = new RecordedBrain(loadRecordedActions('a1-llm'));
      const first = await brain.next({ task: TASK, observations: [] });
      expect(['tool', 'finish']).toContain(first.type);
    },
  );
});
