import { connectDatabase } from '@peafowl/db';
import { startJobQueue } from '@peafowl/jobs';
import { createLogger } from '@peafowl/shared';
import { buildApp } from './app.ts';
import { loadApiConfig } from './config.ts';

const config = loadApiConfig();
const logger = createLogger(config.logLevel);
if (config.devAuth) logger.warn('DEV_AUTH is enabled: requests sign in with an email header');

const database = connectDatabase(config.databaseUrl);
const boss = await startJobQueue(config.databaseUrl);
boss.on('error', (error) => logger.error({ err: error }, 'Job queue error'));

const app = await buildApp({
  db: database.db,
  boss,
  logger,
  freePlanProjectLimit: config.freePlanProjectLimit,
  freePlanGenerationQuotas: config.freePlanGenerationQuotas,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await boss.stop();
  await database.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
