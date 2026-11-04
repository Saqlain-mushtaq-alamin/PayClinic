import { createMockApi } from './index';

const port = Number(process.env.MOCK_API_PORT ?? 4001);
const app = createMockApi();
try {
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ host, port });
  console.log(`PAYCLINIC_MOCK_API_LISTENING ${port}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
