# Peafowl

AI website generator. Current scope: turn a short brief into a single-page website (MVP step 1: generation core + evals).

## Setup

Requires Node 22+.

```bash
npm install
cp .env.example .env   # then set GOOGLE_GENERATIVE_AI_API_KEY
```

## Commands

| Command                                   | Purpose                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `npm run generate -- "<brief>" [--out f]` | Generate one site to `out/index.html`                                 |
| `npm run eval`                            | Run all cases in `evals/prompts.json`, write a report to `out/evals/` |
| `npm test` / `typecheck` / `lint`         | Quality gates                                                         |

## Layout

Pipeline: brief → analyse → SiteSpec (ask for missing fields) → render → verify.

- `prompts/brief-analyzer.md`, `prompts/site-generator.md` – system prompts (eval results are tagged with their hashes)
- `src/spec.ts` – SiteSpec model: completing a draft, sections, the primary button link
- `src/questions.ts` – questions for missing fields and validation of answers
- `src/analyze.ts` – step 1: brief → SiteSpec draft (LLM, structured output)
- `src/render.ts` – step 3: SiteSpec → HTML (LLM, streamed)
- `src/verify.ts` – step 4: rejects pages with facts that are not in the spec
- `src/sanitize.ts` – extracts the HTML document from raw model output
- `evals/` – eval cases (with the answers a user would give), structural checks and the runner
