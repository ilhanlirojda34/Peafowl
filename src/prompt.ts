import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SystemPrompt {
  readonly text: string;
  /** Short content hash, so eval results can be tied to the exact prompt that produced them. */
  readonly version: string;
}

const PROMPT_PATH = join(import.meta.dirname, '..', 'prompts', 'site-generator.md');

export async function loadSystemPrompt(): Promise<SystemPrompt> {
  const text = await readFile(PROMPT_PATH, 'utf8');
  const version = createHash('sha256').update(text).digest('hex').slice(0, 8);
  return { text, version };
}
