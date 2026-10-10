import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../src/config.ts';
import { createGeminiModel, createSiteGenerator, SiteGenerationError } from '../src/generate.ts';
import { createLogger } from '../src/logger.ts';
import { loadSystemPrompt } from '../src/prompt.ts';
import { runHtmlChecks, type CheckResult } from './checks.ts';

const evalCaseSchema = z.object({
  // The id becomes a file name, so it is restricted to a safe character set.
  id: z.string().regex(/^[a-z0-9-]+$/),
  brief: z.string().min(1),
});
type EvalCase = z.infer<typeof evalCaseSchema>;

interface CaseResult {
  readonly id: string;
  readonly generated: boolean;
  readonly failure: string | undefined;
  readonly checks: readonly CheckResult[];
  readonly durationMs: number | undefined;
  readonly outputTokens: number | undefined;
}

const EVAL_CASES_PATH = join(import.meta.dirname, 'prompts.json');

async function main(): Promise<void> {
  const config = loadConfig();
  const prompt = await loadSystemPrompt();
  const generateSite = createSiteGenerator({
    model: createGeminiModel(config),
    config,
    logger: createLogger(config),
    prompt,
  });
  const cases = z.array(evalCaseSchema).parse(JSON.parse(await readFile(EVAL_CASES_PATH, 'utf8')));

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join('out', 'evals', runId);
  await mkdir(outputDir, { recursive: true });

  async function runCase({ id, brief }: EvalCase): Promise<CaseResult> {
    try {
      const site = await generateSite(brief);
      await writeFile(join(outputDir, `${id}.html`), site.html, 'utf8');
      return {
        id,
        generated: true,
        failure: undefined,
        checks: runHtmlChecks(site.html),
        durationMs: site.durationMs,
        outputTokens: site.outputTokens,
      };
    } catch (error) {
      if (!(error instanceof SiteGenerationError)) throw error;
      return {
        id,
        generated: false,
        failure: error.kind,
        checks: [],
        durationMs: undefined,
        outputTokens: undefined,
      };
    }
  }

  const results = await mapWithConcurrency(cases, config.evalConcurrency, runCase);

  const report = { runId, model: config.model, promptVersion: prompt.version, results };
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  printSummary(results, prompt.version, outputDir);
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
  const passed = results.filter((r) => r.generated && r.checks.every((c) => c.passed));
  const failedChecksByName = new Map<string, number>();
  for (const result of results) {
    for (const check of result.checks.filter((c) => !c.passed)) {
      failedChecksByName.set(check.name, (failedChecksByName.get(check.name) ?? 0) + 1);
    }
  }

  console.log(`\nPrompt ${promptVersion}: ${passed.length}/${results.length} cases passed`);
  for (const result of results.filter((r) => !r.generated)) {
    console.log(`  ${result.id}: generation failed (${result.failure})`);
  }
  for (const [name, count] of failedChecksByName) {
    console.log(`  ${name}: failed in ${count} case(s)`);
  }
  console.log(`Output: ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
