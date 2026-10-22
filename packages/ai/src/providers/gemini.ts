import { GoogleGenAI } from '@google/genai';
import type { AIProvider, AITask, GenerateJsonOptions } from '@payclinic/contracts';
import { AIOutputError, AIRateLimitError } from '../errors';
import { RETRY_DELAYS_MS, defaultSleep, isRetryableError, retryAfterMs } from '../retry';

export interface GeminiGenerateArgs {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    responseMimeType: string;
    temperature: number;
  };
}

/** Minimal surface of `@google/genai` that this provider needs (easy to fake). */
export interface GeminiLike {
  models: {
    generateContent(args: GeminiGenerateArgs): Promise<{ text?: string }>;
  };
}

export interface GeminiProviderOptions {
  apiKey?: string;
  model: string;
  client?: GeminiLike;
  sleep?: (ms: number) => Promise<void>;
}

const TEMPERATURES: Record<AITask, number> = {
  patch: 0.2,
  policy: 0.2,
  variations: 0.7,
  explain: 0.2,
};

/** Removes an optional Markdown JSON fence around a model response. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Gemini chat provider: JSON mode, one repair retry, rate-limit backoff. */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly client: GeminiLike;
  private readonly model: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model;
    this.sleep = options.sleep ?? defaultSleep;
    this.client =
      options.client ??
      (new GoogleGenAI(options.apiKey ? { apiKey: options.apiKey } : {}) as unknown as GeminiLike);
  }

  async generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    let prompt = opts.prompt;
    let repairs = 0;
    let retries = 0;

    for (;;) {
      let text: string | undefined;
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            systemInstruction: opts.system,
            responseMimeType: 'application/json',
            temperature: TEMPERATURES[opts.task],
          },
        });
        text = response.text;
      } catch (error) {
        if (isRetryableError(error)) {
          if (retries >= RETRY_DELAYS_MS.length) {
            throw new AIRateLimitError(`Gemini request failed after ${retries + 1} attempts`, {
              cause: error,
            });
          }
          const delay = retryAfterMs(error) ?? RETRY_DELAYS_MS[retries] ?? 0;
          retries += 1;
          await this.sleep(delay);
          continue;
        }
        throw error;
      }

      let validationMessage = '';
      try {
        const parsed: unknown = JSON.parse(stripJsonFences(text ?? ''));
        const result = opts.schema.safeParse(parsed);
        if (result.success) return result.data;
        validationMessage = result.error.message;
      } catch (error) {
        validationMessage = errorMessage(error);
      }

      if (repairs >= 1) {
        throw new AIOutputError(
          `Gemini output "${opts.fixtureKey}" did not match the schema: ${validationMessage}`,
        );
      }
      repairs += 1;
      prompt = `${prompt}\n\nPrevious response was invalid:\n${validationMessage}\nReturn only corrected JSON that matches the schema.`;
    }
  }
}
