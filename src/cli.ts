import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createBriefAnalyzer } from './analyze.ts';
import { ConfigError, loadConfig } from './config.ts';
import { SiteGenerationError } from './errors.ts';
import { createLogger } from './logger.ts';
import { createGeminiModel } from './model.ts';
import { loadSystemPrompt } from './prompt.ts';
import {
  ANSWER_LABELS,
  applyAnswers,
  INVALID_ANSWER_MESSAGE,
  questionsFor,
  type Answers,
} from './questions.ts';
import { createSiteRenderer } from './render.ts';
import { completeSpec, type SiteSpec, type SiteSpecDraft } from './spec.ts';
import { findUnsupportedFacts } from './verify.ts';

const USAGE = 'Usage: npm run generate -- "<brief>" [--out out/index.html]';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string', default: 'out/index.html' } },
  });

  const brief = positionals.join(' ').trim();
  if (brief === '') {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config);
  const model = createGeminiModel(config);
  const [analyzerPrompt, rendererPrompt] = await Promise.all([
    loadSystemPrompt('brief-analyzer'),
    loadSystemPrompt('site-generator'),
  ]);
  const analyse = createBriefAnalyzer({ model, config, logger, prompt: analyzerPrompt });
  const render = createSiteRenderer({ model, config, logger, prompt: rendererPrompt });

  const { draft } = await analyse(brief);
  const spec = await completeWithUserAnswers(draft);
  if (spec === undefined) {
    process.exitCode = 2;
    return;
  }

  const site = await render(spec);

  const unsupported = findUnsupportedFacts(site.html, spec);
  if (unsupported.length > 0) {
    console.error('The generated site contains facts that are not in the spec and was rejected:');
    for (const fact of unsupported) console.error(`  ${fact.kind}: ${fact.value}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, site.html, 'utf8');
  console.log(`Wrote ${values.out}`);
}

/** Asks for missing critical fields in the terminal until the draft can be completed. */
async function completeWithUserAnswers(initial: SiteSpecDraft): Promise<SiteSpec | undefined> {
  let draft = initial;
  let completion = completeSpec(draft);
  if (completion.complete) return completion.spec;

  if (!process.stdin.isTTY) {
    console.error('The brief is missing required information:');
    for (const question of questionsFor(completion.missing, draft.language)) {
      console.error(`  - ${question.prompt}`);
    }
    return undefined;
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!completion.complete) {
      const answers: Answers = {};
      for (const question of questionsFor(completion.missing, draft.language)) {
        console.log(`\n${question.prompt}`);
        for (const input of question.inputs) {
          answers[input] = await terminal.question(`  ${ANSWER_LABELS[draft.language][input]}: `);
        }
      }

      const result = applyAnswers(draft, answers);
      if (!result.ok) {
        const labels = result.invalidFields.map((field) => ANSWER_LABELS[draft.language][field]);
        console.log(`\n${INVALID_ANSWER_MESSAGE[draft.language]}: ${labels.join(', ')}`);
        continue;
      }
      draft = result.draft;
      completion = completeSpec(draft);
    }
    return completion.spec;
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  // Config and generation errors are already user-readable; the pipeline has logged its own.
  const known = error instanceof ConfigError || error instanceof SiteGenerationError;
  console.error(known ? error.message : error);
  process.exitCode = 1;
});
