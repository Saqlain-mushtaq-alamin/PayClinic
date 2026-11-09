import { Octokit } from '@octokit/rest';
import { GoogleGenAI } from '@payclinic/ai';
import { assertSafePayPalBase, type SettingsStore } from '@payclinic/core';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const TIMEOUT_MS = 10_000;

export function sanitizeSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret !== null && secret !== undefined && secret.length > 0) {
      result = result.split(secret).join('[redacted]');
    }
  }
  return result;
}

export async function defaultTestPayPal(
  store: SettingsStore,
): Promise<{ ok: boolean; message: string }> {
  const clientId = store.get('paypalClientId') ?? process.env.PAYPAL_CLIENT_ID;
  const clientSecret = store.get('paypalClientSecret') ?? process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      message: 'Missing PayPal client ID or client secret',
    };
  }

  const rawBase = process.env.PAYPAL_BASE_URL ?? SANDBOX_BASE_URL;
  try {
    assertSafePayPalBase(rawBase);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const url = `${rawBase.replace(/\/+$/, '')}/v1/oauth2/token`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text();
      const sanitized = sanitizeSecrets(body, [clientSecret, clientId]);
      return {
        ok: false,
        message: `PayPal token request failed (${response.status}): ${sanitized}`,
      };
    }

    const verifiedAt = new Date().toISOString();
    store.set('paypalVerifiedAt', verifiedAt);
    return {
      ok: true,
      message: 'PayPal sandbox credentials verified successfully',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeSecrets(message, [clientSecret, clientId]);
    return {
      ok: false,
      message: `PayPal connection error: ${sanitized}`,
    };
  }
}

export async function defaultTestGemini(
  store: SettingsStore,
): Promise<{ ok: boolean; message: string }> {
  const apiKey = store.get('geminiApiKey') ?? process.env.GEMINI_API_KEY;
  const model = store.get('geminiModel') ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    return {
      ok: false,
      message: 'Missing Gemini API key',
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out after 10s')), TIMEOUT_MS),
    );

    await Promise.race([
      ai.models.generateContent({
        model,
        contents: 'ping',
      }),
      timer,
    ]);

    return {
      ok: true,
      message: 'Gemini API verified successfully',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeSecrets(message, [apiKey]);
    return {
      ok: false,
      message: `Gemini test failed: ${sanitized}`,
    };
  }
}

export async function defaultTestGitHub(
  store: SettingsStore,
): Promise<{ ok: boolean; message: string }> {
  const token = store.get('githubToken') ?? process.env.GITHUB_TOKEN;
  const repoStr = store.get('githubRepo') ?? process.env.GITHUB_REPO;

  if (!token || !repoStr) {
    return {
      ok: false,
      message: 'Missing GitHub token or repository',
    };
  }

  const [owner, repo] = repoStr.split('/');
  if (!owner || !repo) {
    return {
      ok: false,
      message: `Invalid GitHub repository format '${repoStr}': expected owner/repo`,
    };
  }

  try {
    const octokit = new Octokit({
      auth: token,
      request: { timeout: TIMEOUT_MS },
    });
    await octokit.repos.get({ owner, repo });

    return {
      ok: true,
      message: `GitHub repository '${repoStr}' verified successfully`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = sanitizeSecrets(message, [token]);
    return {
      ok: false,
      message: `GitHub test failed: ${sanitized}`,
    };
  }
}
