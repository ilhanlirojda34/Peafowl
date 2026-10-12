import type { Database } from '@peafowl/db';
import type { PgBoss } from '@peafowl/jobs';
import type { Logger } from '@peafowl/shared';
import Fastify from 'fastify';
import { handleError } from './http.ts';
import { registerDevAuth } from './modules/auth/dev-auth.ts';
import { generationRoutes } from './modules/generations/routes.ts';
import type { GenerationQuotaRules } from './modules/generations/quota.ts';
import { GenerationService } from './modules/generations/service.ts';
import { projectRoutes } from './modules/projects/routes.ts';
import { siteVersionRoutes } from './modules/site-versions/routes.ts';

export interface AppDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly logger: Logger;
  readonly freePlanProjectLimit: number;
  readonly freePlanGenerationQuotas: GenerationQuotaRules;
}

/**
 * Builds the HTTP app without starting it, so tests can drive it with `app.inject`.
 * Each module is an encapsulated Fastify plugin; authentication is registered on the root
 * instance first, so it applies to every module.
 */
export async function buildApp({
  db,
  boss,
  logger,
  freePlanProjectLimit,
  freePlanGenerationQuotas,
}: AppDependencies) {
  const app = Fastify({ loggerInstance: logger });
  app.setErrorHandler(handleError);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(async (authenticated) => {
    registerDevAuth(authenticated, db);
    await authenticated.register(projectRoutes, { db, freePlanProjectLimit });
    await authenticated.register(generationRoutes, {
      generations: new GenerationService(db, boss, freePlanGenerationQuotas),
    });
    await authenticated.register(siteVersionRoutes, { db });
  });

  return app;
}
