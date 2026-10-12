import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../http.ts';
import type { GenerationService } from './service.ts';

const MIN_PROMPT_LENGTH = 10;
const MAX_PROMPT_LENGTH = 2000;
/** Per-field limits are enforced by applyAnswers; this only bounds the request itself. */
const MAX_ANSWER_LENGTH = 2048;

const projectParams = z.object({ projectId: z.uuid() });
const generationParams = z.object({ generationId: z.uuid() });
const createBody = z.object({
  prompt: z.string().trim().min(MIN_PROMPT_LENGTH).max(MAX_PROMPT_LENGTH),
});
const answer = z.string().max(MAX_ANSWER_LENGTH).optional();
const answersBody = z.object({
  answers: z.strictObject({
    name: answer,
    category: answer,
    phone: answer,
    email: answer,
    address: answer,
    url: answer,
  }),
});

export async function generationRoutes(
  app: FastifyInstance,
  { generations }: { readonly generations: GenerationService },
) {
  app.post('/projects/:projectId/generations', async (request, reply) => {
    const { projectId } = parseInput(projectParams, request.params);
    const { prompt } = parseInput(createBody, request.body);
    const generation = await generations.create(request.auth, projectId, prompt);
    request.log.info({ generationId: generation.id, projectId }, 'Generation queued');
    return reply.status(202).send(generation);
  });

  app.get('/generations/:generationId', async (request) => {
    const { generationId } = parseInput(generationParams, request.params);
    return generations.get(request.auth, generationId);
  });

  app.post('/generations/:generationId/answers', async (request) => {
    const { generationId } = parseInput(generationParams, request.params);
    const { answers } = parseInput(answersBody, request.body);
    return generations.answer(request.auth, generationId, answers);
  });
}
