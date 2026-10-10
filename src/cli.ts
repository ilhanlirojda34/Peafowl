import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.ts';
import { createGeminiModel, createSiteGenerator, SiteGenerationError } from './generate.ts';
import { createLogger } from './logger.ts';
import { loadSystemPrompt } from './prompt.ts';

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
  const generateSite = createSiteGenerator({
    model: createGeminiModel(config),
    config,
    logger: createLogger(config),
    prompt: await loadSystemPrompt(),
  });

  const site = await generateSite(brief);

  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, site.html, 'utf8');
  console.log(`Wrote ${values.out}`);
}

main().catch((error: unknown) => {
  // Config and generation errors are already user-readable; the generator has logged its own.
  const known = error instanceof ConfigError || error instanceof SiteGenerationError;
  console.error(known ? error.message : error);
  process.exitCode = 1;
});
