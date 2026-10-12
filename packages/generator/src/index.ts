// Public surface of the site generation pipeline: prompt → SiteBrief → HTML → verification.
export { createPromptAnalyzer, type AnalyzePrompt, type PromptAnalysis } from './analyze.ts';
export { loadLlmConfig, type LlmConfig } from './config.ts';
export {
  FONTS,
  renderDesign,
  sectionsDesignSchema,
  validateDesign,
  type Cta,
  type DesignIssue,
  type Section,
  type SectionsDesign,
  type SiteDesign,
  type Theme,
} from './design.ts';
export { SiteGenerationError, type SiteGenerationFailure } from './errors.ts';
export { createGeminiModel } from './model.ts';
export { loadSystemPrompt, type PromptName, type SystemPrompt } from './prompt.ts';
export {
  ANSWER_LABELS,
  applyAnswers,
  questionsFor,
  type AnswerField,
  type AnswerResult,
  type Answers,
  type Question,
} from './questions.ts';
export { createPageWriter, type WrittenPage, type WritePage } from './page-writer.ts';
export {
  completeBrief,
  siteBriefDraftSchema,
  type Language,
  type MissingField,
  type SiteBrief,
  type SiteBriefDraft,
  type BriefCompletion,
} from './brief.ts';
export { findUnsupportedFacts, type UnsupportedFact } from './verify.ts';
