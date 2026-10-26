import { createMockApi } from '@payclinic/mock-api';
import { describeApiContract } from './api-contract';

async function start() {
  const app = createMockApi();
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    baseUrl,
    async close() {
      await app.close();
    },
  };
}

describeApiContract('mock server', start);
