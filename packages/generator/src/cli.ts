import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createPromptAnalyzer } from './analyze.ts';
import { ConfigError, createLogger, logLevelSchema, parseEnv } from '@peafowl/shared';
import { z } from 'zod';
import { loadLlmConfig } from './config.ts';
import { SiteGenerationError } from './errors.ts';
import { createGeminiModel } from './model.ts';
import { loadSystemPrompt } from './prompt.ts';
import {
  ANSWER_LABELS,
  applyAnswers,
  INVALID_ANSWER_MESSAGE,
  questionsFor,
  type Answers,
} from './questions.ts';
import { createPageWriter } from './page-writer.ts';
import { completeBrief, type SiteBrief, type SiteBriefDraft } from './brief.ts';
import { findUnsupportedFacts } from './verify.ts';

const USAGE = 'Usage: npm run generate -- "<prompt>" [--out out/index.html]';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string', default: 'out/index.html' } },
  });

  const prompt = positionals.join(' ').trim();
  if (prompt === '') {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const config = loadLlmConfig();
  const { LOG_LEVEL } = parseEnv(z.object({ LOG_LEVEL: logLevelSchema }), process.env);
  const logger = createLogger(LOG_LEVEL);
  const model = createGeminiModel(config);
  const [analyzerPrompt, pageWriterPrompt] = await Promise.all([
    loadSystemPrompt('prompt-analyzer'),
    loadSystemPrompt('page-writer'),
  ]);
  const analyzePrompt = createPromptAnalyzer({ model, config, logger, prompt: analyzerPrompt });
  const writePage = createPageWriter({ model, config, logger, prompt: pageWriterPrompt });

  const { draft } = await analyzePrompt(prompt);
  const brief = await completeWithUserAnswers(draft);
  if (brief === undefined) {
    process.exitCode = 2;
    return;
  }

  const site = await writePage(brief);

  const unsupported = findUnsupportedFacts(site.html, brief);
  if (unsupported.length > 0) {
    console.error('The generated site contains facts that are not in the brief and was rejected:');
    for (const fact of unsupported) console.error(`  ${fact.kind}: ${fact.value}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, site.html, 'utf8');
  console.log(`Wrote ${values.out}`);
}

/** Asks for missing critical fields in the terminal until the draft can be completed. */
async function completeWithUserAnswers(initial: SiteBriefDraft): Promise<SiteBrief | undefined> {
  let draft = initial;
  let completion = completeBrief(draft);
  if (completion.complete) return completion.brief;

  if (!process.stdin.isTTY) {
    console.error('The prompt is missing required information:');
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
      completion = completeBrief(draft);
    }
    return completion.brief;
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
