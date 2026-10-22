import type { AgentAction, AgentBrain, Observation } from './brains';
import type { PayTools } from './tools';

export interface RunAgentOptions {
  task: string;
  tools: PayTools;
  brain: AgentBrain;
  maxSteps?: number;
}

export interface AgentRunResult {
  observations: Observation[];
  steps: number;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`missing string tool argument "${key}"`);
  return value;
}

function positiveIntArg(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`missing positive integer tool argument "${key}"`);
  }
  return value;
}

async function executeTool(
  tools: PayTools,
  action: Extract<AgentAction, { type: 'tool' }>,
): Promise<unknown> {
  switch (action.tool) {
    case 'searchProducts':
      return tools.searchProducts(
        typeof action.args.query === 'string' ? action.args.query : undefined,
      );
    case 'createOrder':
      return tools.createOrder({
        merchantId: stringArg(action.args, 'merchantId'),
        sku: stringArg(action.args, 'sku'),
        qty: positiveIntArg(action.args, 'qty'),
      });
    case 'captureOrder':
      return tools.captureOrder(stringArg(action.args, 'orderId'));
  }
}

/** Runs a brain against PayTools until it finishes or the step budget is exhausted. */
export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { task, tools, brain, maxSteps = 12 } = options;
  const observations: Observation[] = [];
  let steps = 0;

  while (steps < maxSteps) {
    const action = await brain.next({ task, observations });
    if (action.type === 'finish') break;

    const result = await executeTool(tools, action);
    observations.push({ tool: action.tool, args: action.args, result });
    steps += 1;
  }

  return { observations, steps };
}
