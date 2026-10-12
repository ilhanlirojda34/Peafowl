# Peafowl

AI website generator for the Turkish market. A prompt is analyzed into a structured SiteBrief, missing information is asked from the user, and a verified site is generated.

## Structure

```
apps/
  api/          Fastify HTTP API (modular: auth, projects, generations, site-versions)
  worker/       Background jobs: analyse a brief, render and verify a site (pg-boss)
packages/
  generator/    Generation pipeline: prompt → SiteBrief → HTML → verification, CLI and evals
  db/           PostgreSQL schema (Drizzle) and migrations
  jobs/         Queue names and job payloads shared by api and worker
  shared/       Environment parsing and logging
docker/         Files mounted into local containers (PostgreSQL init scripts)
```

## Setup

Requires Node 22.12+ and Docker.

```bash
npm install
cp .env.example .env        # then set POSTGRES_PASSWORD (and DATABASE_URL), GOOGLE_GENERATIVE_AI_API_KEY
docker compose up -d        # PostgreSQL on POSTGRES_PORT (+ peafowl_test database)
npm run db:migrate
```

## Run

```bash
npm run dev:api             # http://127.0.0.1:3001
npm run dev:worker
```

With `DEV_AUTH=true`, requests sign in with the `x-dev-user-email` header. The first request creates the user and a personal workspace; projects belong to the workspace.

```bash
curl -H "x-dev-user-email: me@example.com" -H "content-type: application/json" \
  -d '{"name":"Moda Kahve"}' http://127.0.0.1:3001/projects
```

| Endpoint                                                    | Purpose                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /projects`, `GET /projects`, `GET /projects/:id`      | Projects (free plan limit applies)                                |
| `DELETE /projects/:id`                                      | Soft-delete a project (frees its plan slot)                       |
| `POST /projects/:id/generations`                            | Start a generation from `{ prompt }` (202, one at a time)         |
| `GET /generations/:id`                                      | Status, and questions when it waits for input                     |
| `POST /generations/:id/answers`                             | Answer the questions; rendering starts when the brief is complete |
| `GET /projects/:id/site-versions`, `GET /site-versions/:id` | Generated versions and their HTML                                 |

## Commands

| Command                                | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `npm run generate -- "<brief>"`        | Generate one site from the terminal (no database) |
| `npm run eval`                         | Run the eval cases in `packages/generator/evals`  |
| `npm run db:generate -- --name <name>` | Create a migration after changing the schema      |
| `npm test`                             | Unit tests                                        |
| `npm run test:integration`             | API and worker tests against `TEST_DATABASE_URL`  |
| `npm run typecheck`, `npm run lint`    | Quality gates                                     |
