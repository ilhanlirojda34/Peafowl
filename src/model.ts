import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { Config } from './config.ts';

/** The single place that decides which provider and key the pipeline uses. */
export function createGeminiModel(config: Pick<Config, 'googleApiKey' | 'model'>): LanguageModel {
  return createGoogleGenerativeAI({ apiKey: config.googleApiKey })(config.model);
}
