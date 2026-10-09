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

- `prompts/site-generator.md` – system prompt (edit this most; eval results are tagged with its hash)
- `src/generate.ts` – the only module that calls the LLM
- `src/sanitize.ts` – extracts the HTML document from raw model output
- `evals/` – structural checks and the eval runner
