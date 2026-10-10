import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createBriefAnalyzer } from '../src/analyze.ts';
import { loadConfig } from '../src/config.ts';
import { SiteGenerationError } from '../src/errors.ts';
import { createLogger } from '../src/logger.ts';
import { createGeminiModel } from '../src/model.ts';
import { loadSystemPrompt } from '../src/prompt.ts';
import { applyAnswers, questionsFor, type AnswerField, type Answers } from '../src/questions.ts';
import { createSiteRenderer } from '../src/render.ts';
import { completeSpec, type Language, type MissingField } from '../src/spec.ts';
import { findUnsupportedFacts, type UnsupportedFact } from '../src/verify.ts';
import { runHtmlChecks, type CheckResult } from './checks.ts';

const answersSchema = z
  .object({
    name: z.string(),
    category: z.string(),
    phone: z.string(),
    email: z.string(),
    address: z.string(),
    url: z.string(),
  })
  .partial();

const evalCaseSchema = z.object({
  // The id becomes a file name, so it is restricted to a safe character set.
  id: z.string().regex(/^[a-z0-9-]+$/),
  brief: z.string().min(1),
  /** What a user would type if asked. Only fields the pipeline actually asks for are used. */
  answers: answersSchema.default({}),
});
type EvalCase = z.infer<typeof evalCaseSchema>;

// Eval-only setting, kept out of the application config. Low by default to stay under free-tier rate limits.
const evalEnvSchema = z.object({
  EVAL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
});

type CaseStatus = 'completed' | 'awaiting-input' | 'unsupported-facts' | 'failed';

interface CaseResult {
  readonly id: string;
  readonly status: CaseStatus;
  readonly failure: SiteGenerationError['kind'] | undefined;
  /** Fields the pipeline asked for that the case does not answer. */
  readonly unansweredFields: readonly MissingField[];
  /** Fields the pipeline asked for, answered or not. Shows how often users would be stopped. */
  readonly askedFields: readonly MissingField[];
  readonly unsupportedFacts: readonly UnsupportedFact[];
  readonly checks: readonly CheckResult[];
  readonly durationMs: number | undefined;
  readonly outputTokens: number | undefined;
}

const EVAL_CASES_PATH = join(import.meta.dirname, 'prompts.json');

async function main(): Promise<void> {
  const config = loadConfig();
  const { EVAL_CONCURRENCY: concurrency } = evalEnvSchema.parse(process.env);
  const logger = createLogger(config);
  const model = createGeminiModel(config);
  const [analyzerPrompt, rendererPrompt] = await Promise.all([
    loadSystemPrompt('brief-analyzer'),
    loadSystemPrompt('site-generator'),
  ]);
  const analyse = createBriefAnalyzer({ model, config, logger, prompt: analyzerPrompt });
  const render = createSiteRenderer({ model, config, logger, prompt: rendererPrompt });
  const promptVersion = `${analyzerPrompt.version}+${rendererPrompt.version}`;
  const cases = z.array(evalCaseSchema).parse(JSON.parse(await readFile(EVAL_CASES_PATH, 'utf8')));

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join('out', 'evals', runId);
  await mkdir(outputDir, { recursive: true });

  async function runCase({ id, brief, answers }: EvalCase): Promise<CaseResult> {
    const base = {
      id,
      failure: undefined,
      unansweredFields: [],
      askedFields: [],
      unsupportedFacts: [],
      checks: [],
      durationMs: undefined,
      outputTokens: undefined,
    } satisfies Omit<CaseResult, 'status'>;

    try {
      const analysed = await analyse(brief);
      let draft = analysed.draft;
      let completion = completeSpec(draft);
      const askedFields = completion.complete ? [] : completion.missing;

      if (!completion.complete) {
        const result = applyAnswers(draft, answersFor(completion.missing, draft.language, answers));
        if (!result.ok)
          throw new Error(
            `Eval case ${id} has invalid answers: ${result.invalidFields.join(', ')}`,
          );
        draft = result.draft;
        completion = completeSpec(draft);
      }
      if (!completion.complete) {
        return {
          ...base,
          status: 'awaiting-input',
          askedFields,
          unansweredFields: completion.missing,
        };
      }

      const spec = completion.spec;
      await writeFile(join(outputDir, `${id}.spec.json`), JSON.stringify(spec, null, 2), 'utf8');
      const site = await render(spec);
      await writeFile(join(outputDir, `${id}.html`), site.html, 'utf8');

      const unsupportedFacts = findUnsupportedFacts(site.html, spec);
      return {
        ...base,
        status: unsupportedFacts.length > 0 ? 'unsupported-facts' : 'completed',
        askedFields,
        unsupportedFacts,
        checks: runHtmlChecks(site.html),
        durationMs: analysed.durationMs + site.durationMs,
        outputTokens: sum(analysed.outputTokens, site.outputTokens),
      };
    } catch (error) {
      if (!(error instanceof SiteGenerationError)) throw error;
      return { ...base, status: 'failed', failure: error.kind };
    }
  }

  const results = await mapWithConcurrency(cases, concurrency, runCase);

  const report = { runId, model: config.model, promptVersion, results };
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  printSummary(results, promptVersion, outputDir);
}

/** Picks the case's answers for exactly the inputs the pipeline asked for, as a user would. */
function answersFor(
  missing: readonly MissingField[],
  language: Language,
  caseAnswers: Answers,
): Answers {
  const asked = new Set(questionsFor(missing, language).flatMap((question) => question.inputs));
  return Object.fromEntries(
    Object.entries(caseAnswers).filter(([field]) => asked.has(field as AnswerField)),
  );
}

function sum(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a + b;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function printSummary(results: readonly CaseResult[], promptVersion: string, outputDir: string) {
  const passed = results.filter((r) => r.status === 'completed' && r.checks.every((c) => c.passed));
  console.log(`\nPrompts ${promptVersion}: ${passed.length}/${results.length} cases passed`);

  for (const result of results.filter((r) => r.status !== 'completed')) {
    const detail =
      result.status === 'failed'
        ? result.failure
        : result.status === 'awaiting-input'
          ? `unanswered: ${result.unansweredFields.join(', ')}`
          : result.unsupportedFacts.map((fact) => `${fact.kind} ${fact.value}`).join('; ');
    console.log(`  ${result.id}: ${result.status} (${detail})`);
  }

  const failedChecksByName = new Map<string, number>();
  for (const check of results.flatMap((r) => r.checks).filter((c) => !c.passed)) {
    failedChecksByName.set(check.name, (failedChecksByName.get(check.name) ?? 0) + 1);
  }
  for (const [name, count] of failedChecksByName) {
    console.log(`  ${name}: failed in ${count} case(s)`);
  }

  const askedCount = results.filter((r) => r.askedFields.length > 0).length;
  console.log(`  ${askedCount}/${results.length} briefs needed questions`);
  console.log(`Output: ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
