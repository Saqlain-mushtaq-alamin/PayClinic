import { createApp } from './app';
import { loadStoreConfig } from './config';

const config = loadStoreConfig(process.env);
const app = await createApp({
  paypalBaseUrl: config.paypalBaseUrl,
  paypalClientId: config.paypalClientId,
  paypalClientSecret: config.paypalClientSecret,
  dbPath: config.dbPath,
  admin: config.admin,
});

await app.listen({ host: '127.0.0.1', port: config.port });
const address = app.server.address();
const port = typeof address === 'object' && address !== null ? address.port : config.port;
console.log(`PAYCLINIC_STORE_LISTENING ${port}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
