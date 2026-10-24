import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHelloApp } from '../../scripts/hello-render';

describe('render hello-world', () => {
  it('answers GET /healthz with 200 and an ok body', async () => {
    const app = createHelloApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('answers GET / with 200 and service info', async () => {
    const app = createHelloApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, service: 'payclinic' });
    } finally {
      await app.close();
    }
  });

  it('declares a free web service with the build, start and health check', () => {
    const path = fileURLToPath(new URL('../../render.yaml', import.meta.url));
    const config = readFileSync(path, 'utf8');

    expect(config).toContain('plan: free');
    expect(config).toContain('npm ci');
    expect(config).toContain('npm run build');
    expect(config).toContain('scripts/hello-render.ts');
    expect(config).toContain('healthCheckPath: /healthz');
  });
});
