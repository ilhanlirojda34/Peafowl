import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SystemPrompt {
  readonly text: string;
  /** Short content hash, so eval results can be tied to the exact prompt that produced them. */
  readonly version: string;
}

export type PromptName = 'brief-analyzer' | 'site-generator';

const PROMPTS_DIR = join(import.meta.dirname, '..', 'prompts');

export async function loadSystemPrompt(name: PromptName): Promise<SystemPrompt> {
  const text = await readFile(join(PROMPTS_DIR, `${name}.md`), 'utf8');
  const version = createHash('sha256').update(text).digest('hex').slice(0, 8);
  return { text, version };
}
