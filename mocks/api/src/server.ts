import { createMockApi } from './index';

const port = Number(process.env.MOCK_API_PORT ?? 4001);
const app = createMockApi();
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`PAYCLINIC_MOCK_API_LISTENING ${port}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
