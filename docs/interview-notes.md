# Interview notes — Madlan R&D Operations Engineer challenge

These notes are for the 45-minute session. They are intentionally written in English because the interview is in English.

## 30-second product pitch

I built a Hebrew RTL evidence assistant for the supplied residential-deals CSV.

The LLM does one job: it translates a natural-language question into a closed query plan. It does not write SQL and it does not calculate the answer. Application code validates the plan, checks that explicit constraints were preserved, runs parameterized DuckDB analytics, and returns the number together with sample size, filters, exclusions, source breakdown, and supporting deals.

The product decision was to optimize for a CSM-safe answer rather than a generic chatbot: if the data or the model cannot support the request, the app says so instead of guessing.

## Why this is useful for this role

A CSM can answer common questions about the sample without learning SQL, but can still inspect what an answer is based on. That matters because this role sits between customers, Customer Success, and R&D.

The key product principle is:

> LLM for interpretation; deterministic code for truth.

## 10-minute demo

### 0:00–1:00 — frame the problem

Say:

- The brief asks for something useful with a messy property-deals CSV and an LLM.
- I chose a CSM-facing evidence assistant, not an open-ended chatbot.
- The app is deliberately scoped to questions that can be answered faithfully from this sample.

Point out that the UI is Hebrew and RTL.

### 1:00–3:00 — normal analytical question

Use:

`מה חציון המחיר לדירות 4 חדרים בתל אביב?`

Show:

- the result;
- sample size;
- interpreted filters;
- warnings;
- supporting deals;
- “איך חושב המספר?” with interpretation, exclusions, sources, Request ID and data fingerprint.

Explain that the LLM planned the query but DuckDB calculated the number.

### 3:00–4:30 — comparison

Use:

`השווה חציון מחיר למ״ר בין הערים במדגם`

Point out that price per m² is recalculated from price / area rather than trusting the supplied derived field.

### 4:30–5:30 — data quality

Use:

`אילו בעיות איכות יש בקובץ?`

Show duplicate handling, missing fields, month-only dates, suspicious prices and price/m² mismatches.

### 5:30–6:30 — unsupported request

Ask something the product cannot support faithfully, for example:

`איזו שכונה הכי טובה להשקעה?`

Explain that “best investment” needs external knowledge and a value judgment that is not in the CSV, so the app fails closed rather than inventing an answer.

### 6:30–8:00 — model failure

Deploy with `ENABLE_FAILURE_DEMO=true` for the interview.

First keep a valid answer on screen, then click **הדגם כשל מודל**.

Explain:

- the planner throws a controlled failure;
- the API returns a clear error and no fallback number;
- the client keeps the previous valid answer visible;
- there is a client-side 15-second abort as an extra protection against a request hanging forever.

### 8:00–10:00 — close with the engineering decision

Summarize the trust boundary:

`question → structured QueryPlan → semantic validation → drift guardrails → parameterized DuckDB → evidence + deterministic copy`

Then say what you deliberately did not build: arbitrary SQL generation, RAG, embeddings, Redis, queues, microservices, an ORM, auth, or a second backend. They would add failure surface without improving the core evaluation path for this sample.

## 15-minute code walkthrough

Do not walk file-by-file from the top of the repository. Walk one request end-to-end.

### 1. Contract — `src/contracts.ts`

Show `QueryPlanSchema`.

Explain:

- The model has a closed vocabulary of intents, metrics, grouping dimensions, and filters.
- A schema-valid output is necessary but not sufficient; semantic validation still follows.
- The public response contract makes “ok”, “unsupported”, and “error” explicit states.

### 2. Planner — `src/planner.ts`

Show `planQuestion` and `plannerInstructions`.

Explain:

- The model sees the actual available cities, neighborhoods, property types, and date coverage.
- It uses Structured Outputs.
- It never receives a tool that can execute SQL.
- Groq is the free/default path; OpenAI is an optional provider behind the same contract.
- `maxRetries: 0` plus an explicit timeout makes latency/failure behavior predictable for the demo instead of hiding long retries.

### 3. Trust boundary — `src/service.ts` + `src/guardrails.ts`

This is the part to spend the most time on.

Show `answerQuestion`.

The important sequence is:

1. load the canonical dataset;
2. ask the model for a plan;
3. reject explicit `unsupported`;
4. validate plan shape and category values;
5. verify explicit city / metric / room / year constraints were not lost or changed;
6. execute deterministic analytics;
7. create deterministic presentation text;
8. map failures to honest public states.

Then show one guardrail example, such as an explicit metric or year mismatch. The point is that Structured Outputs protect syntax, while the guardrails protect meaning.

### 4. Data normalization — `src/normalization.ts` + `src/data.ts`

Show the month-only date handling and duplicate policy.

Explain:

- representation is normalized, facts are not invented;
- a month-only date becomes an interval, not an invented day;
- known city aliases observed in the sample are normalized;
- neighborhoods and streets are not fuzzy-merged;
- exact duplicate deal IDs count once;
- conflicting duplicate IDs are blocked from analytics;
- price/m² is recalculated;
- a price below ₪100,000 is marked suspicious for price-based metrics.

### 5. Analytics — `src/analytics.ts`

Show `scopeWhere`, `metricEligibility`, and `runQuery`.

Explain:

- SQL is constructed only from application-owned whitelisted fragments;
- user/model values are parameters;
- metric eligibility is explicit;
- evidence and exclusions are derived from the same query scope as the answer;
- a suspicious/missing price is excluded from price metrics, but does not automatically remove a row from a pure deal count.

### 6. Tests

Open the smallest number of tests that prove the highest-risk behavior:

- `tests/service.test.ts`: model failure, malformed plans, dropped constraints, unsupported requests.
- `tests/database.test.ts`: DuckDB results are compared with independent JavaScript calculations and evidence uses the same scope.
- `tests/qa-regression.test.ts`: representative real-dataset questions are independently recalculated.
- `tests/data.test.ts`: messy numeric/date formats and city aliases.
- `tests/planner.test.ts`: provider selection and configuration failures.
- `tests/health.test.ts`: deployment readiness fails when the selected provider is not configured.

Finish with `npm run check`.

## Code I am proudest of

Use `src/service.ts` together with `src/guardrails.ts`.

Suggested explanation:

> I am proudest of the trust boundary between the LLM and the calculation. Structured output alone only tells me that the response has the right shape. It does not prove that the model preserved the user's meaning. The service validates categories and plan semantics, then the guardrails independently check explicit city, metric, room-count and year constraints before any calculation runs. If those checks fail, the app refuses to produce a number. That is the behavior I would want in front of a CSM or customer.

Why this is a good answer:

- it is directly tied to the challenge;
- it demonstrates defensive AI engineering rather than prompt-only reliability;
- it is easy to show in code and tests;
- it explains a real customer-safety decision.

## Code I am least happy with

Use `src/analytics.ts`.

Suggested explanation:

> The part I am least happy with is analytics.ts. It is intentionally cohesive, but it is the largest module and it owns predicate construction, exclusion accounting, evidence loading, source breakdown and the final query orchestration. For a five-hour challenge I preferred one obvious place for query semantics over several tiny abstractions. If the product grew, my first refactor would separate the shared scope/predicate compiler from exclusion accounting and result projection, while keeping one source of truth for filter semantics.

Important: do not apologize for it. Explain the tradeoff.

Why it was not split now:

- the query surface is small;
- splitting it prematurely could duplicate filtering semantics;
- the current module is tested against independent calculations;
- the challenge values explainability and a focused implementation.

## Assumptions to defend

### The CSV is a sample, not the market

Every answer is scoped to the supplied file. The UI always warns about this.

### Deal ID is the identity key

Exact duplicates with the same material analytical fields count once. If the same ID contains conflicting analytical facts, that ID is blocked because choosing one row would invent certainty.

### Month-only dates are intervals

`Aug 2025` becomes 2025-08-01 through 2025-08-31. A date-filtered query includes a row only when its known interval fits the requested range. A partial overlap is reported as ambiguous rather than assigned an invented day.

### Suspicious price threshold

Prices below ₪100,000 are treated as suspicious for price-based metrics. This is an explicit cleaning assumption for this residential sample, not a universal real-estate rule.

A pure deal count can still count such a row because the question is “how many deals”, not “what is the price”.

### Price per m²

The app recalculates it as `price_nis / size_sqm`. The supplied derived value is used only for a quality mismatch check.

### Normalization is conservative

Known city aliases are merged. Streets and neighborhoods are not fuzzy-merged because similarity is not proof that two labels refer to the same entity.

### Unsupported fields fail closed

The CSV contains fields such as floor and year built, but this version does not expose every column as a filter. The product supports the subset that was implemented and tested well in the time-box. A request outside that subset is rejected instead of partially answered.

### In-memory DuckDB

This is appropriate for a roughly 500-row, read-only analytical sample. At production scale I would move the same query contract onto a durable warehouse/database and keep the trust boundary.

## Technical choices to defend

### Why Next.js instead of separate frontend/backend?

One deployable service is easier to operate and explain for a time-boxed public tool. The client still has a clean HTTP boundary at `/api/ask`, but there is no second deployment purely for architectural ceremony.

### Why DuckDB?

The workload is local, read-only analytics: filters, grouping, median/average calculations and evidence queries. DuckDB gives deterministic SQL analytics without operating a database server.

### Why no arbitrary text-to-SQL?

It makes the model part of the execution boundary and expands the validation/security surface. A closed query plan gives enough flexibility for the product while keeping SQL application-owned.

### Why an LLM at all?

Natural-language interpretation is the uncertain part: Hebrew phrasing, intent, metric, grouping and filters. The calculation itself should not be probabilistic.

### Why Structured Outputs plus Zod plus guardrails?

They solve different problems:

- Structured Outputs: schema adherence from the provider.
- Zod/application contract: typed runtime boundary.
- semantic validation: valid combinations and actual dataset categories.
- drift guardrails: preserve explicit user intent.

### Why Groq plus OpenAI support?

Groq gives a practical free-tier demo path and exposes an OpenAI-compatible Responses API. Keeping the provider behind the same planner contract avoids provider-specific business logic.

### Why Railway?

The project is a long-running Node service with a native in-process DuckDB dependency. Railway can build/start the Next.js service and gate deployments on `/api/health`.

## What happens when the model is wrong, slow or down?

### Wrong but schema-valid

Semantic validation and drift guardrails can reject it before analytics.

### Malformed / unusable response

The planner maps it to `PlannerError`; the service returns `MODEL_UNAVAILABLE` and no number.

### Slow provider

The SDK has an explicit timeout and no hidden retry loop. The browser also aborts after 15 seconds and keeps the previous valid answer.

### Provider down

Same fail-closed path: clear Hebrew message, no guessed fallback result.

## Customer moment — live procedure

When the interviewer says, “This number is wrong,” do not defend the number immediately.

Use this order:

1. Ask for the exact question and what number they expected.
2. Check the interpreted filters.
3. Check `n` / sample size.
4. Check warnings and exclusions.
5. Inspect the supporting deals.
6. Check source breakdown, Request ID and data fingerprint.
7. Classify the issue:
   - interpretation problem;
   - unsupported expectation / market coverage;
   - data-quality problem;
   - calculation/product bug.
8. State what you know and what you do not know.
9. If it is a product bug, capture the smallest reproducible case and escalate with the Request ID.

Suggested English response:

> Thanks for flagging it. This result is calculated only from the supplied deal sample and the filters shown next to the answer. I would first compare those filters with what you intended, then check the sample size, exclusions, and the supporting deals. If you tell me the number you expected and the exact city, neighborhood, period, or deal you think is missing, I can determine whether this is a filtering difference, a data-quality issue, or a product bug that needs to be fixed.

## Likely questions

### “Why not let the LLM generate SQL?”

Because I do not need that flexibility for the product I chose. A closed plan lets the LLM handle language while application code owns executable behavior.

### “Is the LLM really doing real work?”

Yes. Without it, the user would need a fixed form or query language. The model maps unrestricted Hebrew phrasing into intent, metric, grouping, categories, room ranges and date ranges. Removing it changes the product interaction materially.

### “Why not answer when the model fails using heuristics?”

Because that creates two interpretation systems with different behavior. For a customer-facing evidence tool I prefer a clear temporary failure over a number produced by a weaker, hidden fallback.

### “Why not clean all questionable rows?”

Because cleaning can become invention. I normalize representation where the meaning is clear and expose or exclude ambiguity where it is not.

### “Would this architecture scale?”

The product contract and trust boundary scale; the in-memory storage choice does not need to. At larger volume I would move analytics to a durable database/warehouse, add observability around plan/error rates, and evaluate model plans on a larger labeled question set.

### “What would you do with another day?”

First: add end-to-end browser tests for the highest-value UI flows and failure demo. Second: add a small planner evaluation set with expected QueryPlans. Third: deploy a staging environment and capture latency/error metrics. I would not add RAG or agents unless a real product requirement justified them.

## File map

### App boundary

- `app/layout.tsx` — Hebrew document metadata and global `dir="rtl"`.
- `app/page.tsx` — main page shell and failure-demo feature flag.
- `app/api/ask/route.ts` — request validation, rate limiting, Request ID, logging and HTTP mapping.
- `app/api/health/route.ts` — dataset/provider readiness information for deployment checks.
- `app/guide/page.tsx` — in-product CSM guide.

### Core

- `src/contracts.ts` — model, analytics and public-response contracts.
- `src/normalization.ts` — raw value parsing and conservative normalization.
- `src/data.ts` — CSV load, canonicalization, duplicate policy, data fingerprint and quality summary.
- `src/database.ts` — in-memory DuckDB lifecycle and ingestion.
- `src/planner.ts` — LLM provider/configuration and natural-language → QueryPlan.
- `src/guardrails.ts` — independent preservation checks for explicit user constraints.
- `src/service.ts` — use-case orchestration and failure mapping.
- `src/analytics.ts` — whitelisted parameterized analytics, evidence and exclusion accounting.
- `src/presentation.ts` — deterministic Hebrew answer labels/warnings.
- `src/ui/explorer.tsx` — question interaction, client timeout and previous-result preservation.
- `src/ui/result.tsx` — evidence-first result rendering.

### Tests

- `tests/data.test.ts` — normalization and real-dataset loading.
- `tests/database.test.ts` — analytics correctness and evidence scope.
- `tests/planner.test.ts` — provider configuration.
- `tests/health.test.ts` — deployment readiness configuration.
- `tests/service.test.ts` — fail-closed behavior and semantic/drift validation.
- `tests/qa-regression.test.ts` — representative real CSV calculations independently recomputed in JavaScript.

### Supporting material

- `docs/csm-guide.md` — one-page CSM guide required by the brief.
- `docs/ai-log.md` — AI-assisted work log and caught bad answer.
- `docs/submission-checklist.md` — final delivery/deployment checklist.
- `plan.md` — implementation goal and definition of done.

## Current official-documentation checks

Checked on 2026-09-28:

- Next.js describes itself as a framework for full-stack React applications and supports server Route Handlers in the App Router.
- DuckDB documents `@duckdb/node-api` as the current Node.js Neo client.
- OpenAI recommends Structured Outputs when schema adherence matters; `gpt-6-sol` supports Responses and Structured Outputs.
- Groq documents OpenAI-client compatibility at `https://api.groq.com/openai/v1`; its Responses API and strict Structured Outputs support `openai/gpt-oss-20b`.
- Railway healthchecks wait for a configured endpoint to return a successful 2xx response before activating a deployment. The app therefore returns 503 from `/api/health` when the selected AI provider has no configured key.
- Railway uses Railpack for new services; its older repo-level Config as Code flow is deprecated for new services, so the current deployment checklist treats Railway service settings/CLI as the source of truth.

These checks support the current implementation choices; they are not application runtime dependencies.
