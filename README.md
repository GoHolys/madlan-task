# Madlan Evidence Assistant

A Hebrew RTL assistant for the Madlan R&D Operations Engineer challenge. It turns a natural-language question into a closed query plan, computes the answer deterministically from the supplied CSV, and shows exactly what the result is based on.

## Product decision

The useful thing to build for this role is not a generic chatbot. It is a **CSM-safe evidence assistant**:

```text
Hebrew question
    ↓
Groq/OpenAI structured QueryPlan
    ↓
semantic validation + explicit-question drift checks
    ↓
parameterized DuckDB analytics
    ↓
number + n + exclusions + sources + supporting deals
    ↓
deterministic Hebrew presentation
```

**LLM for interpretation; code for truth.**

`AI_PROVIDER=groq` uses Groq through its OpenAI-compatible Responses API. `AI_PROVIDER=auto` prefers Groq when `GROQ_API_KEY` is present and otherwise uses OpenAI, so the same planner contract and failure behavior work with either provider.

## Stack

- Next.js 16 / React / TypeScript — one deployable full-stack service
- DuckDB Node Neo — in-process analytical SQL over the normalized sample
- Groq/OpenAI Responses API — strict structured query planning; Groq free-tier is the recommended default (`openai/gpt-oss-20b`)
- Zod — shared runtime contract for model output
- csv-parse — explicit CSV ingestion
- Vitest — tests around normalization, query behavior, and failure handling
- Railway — recommended public deployment target

## Why this architecture

The dataset is small, analytical, and read-only. A database server, ORM, queue, Redis, RAG stack, or microservices would make the submission harder to operate and explain without improving the answer.

DuckDB is still useful even at this size because the product needs filters, medians, grouped comparisons, evidence rows, and exclusion accounting. It keeps those calculations deterministic and auditable.

The model never receives permission to execute arbitrary SQL. It chooses from a closed schema and the application compiles that plan into whitelisted, parameterized queries.

## Code structure

The codebase is intentionally small, but the boundaries are real rather than cosmetic:

- `src/contracts.ts` — closed LLM/application contracts.
- `src/normalization.ts` — raw CSV value parsing and row normalization.
- `src/data.ts` — canonical dataset snapshot, duplicate policy, quality summary.
- `src/database.ts` — DuckDB lifecycle and ingestion only.
- `src/analytics.ts` — deterministic whitelisted analytical queries and evidence.
- `src/planner.ts` — LLM planning and provider configuration only.
- `src/guardrails.ts` — deterministic checks that explicit city/metric/rooms/year constraints survive LLM planning.
- `src/presentation.ts` — deterministic Hebrew labels, warnings, and result copy.
- `src/service.ts` — plan validation, orchestration, and failure mapping.
- `src/ui/*` — interaction/presentation; no analytics logic.
- `app/api/*` — thin HTTP boundaries.

There are no barrel files or one-function wrapper modules just to make the tree look layered.

## Supported questions

Metrics:
- count
- median/average price
- median/average calculated price per m²

Filters:
- city
- neighborhood
- property type
- room range
- transaction date range

Other supported modes:
- comparison by city, neighborhood, property type, or transaction year
- list matching deals
- dataset-quality summary

Requests that require unsupported filters, external market knowledge, predictions, valuation, or investment recommendations are rejected explicitly.

## Data-quality policy

The guiding rule is **normalize representation; do not invent information**.

- Prices such as `4,331,000` are parsed.
- Room values such as `2 חדרים` are parsed.
- Several day-level date formats are accepted.
- Month-only dates remain a month interval. A partially overlapping narrow date filter excludes them and reports the ambiguity.
- Location whitespace and hyphen variants are normalized for matching; streets/neighborhoods are not fuzzy-merged.
- Exact duplicate deal IDs count once.
- Conflicting duplicate IDs are blocked from analytics.
- Residential prices under ₪100,000 are treated as suspicious for price-based metrics; the threshold is an explicit cleaning assumption for this sample. A pure deal-count query can still count the deal.
- Price/m² is recalculated from `price_nis / size_sqm`; supplied price/m² is retained only for quality checks.

## Assumptions and decisions

These are deliberate product/data decisions rather than hidden cleaning rules:

- The supplied CSV is a sample, not a claim about the full Israeli housing market.
- `deal_id` is treated as the identity key. Exact duplicates count once; conflicting duplicate IDs are blocked instead of choosing a row arbitrarily.
- Month-only dates are treated as intervals, not assigned an invented day.
- Only clearly observed city aliases are merged. Neighborhoods and streets are not fuzzy-merged.
- Unsupported fields or analyses are rejected rather than partially answering after silently dropping a condition.
- DuckDB is in-memory because this is a small, read-only analytical sample. At larger production scale, the same closed query contract could sit on a durable database/warehouse.
- The public challenge app intentionally has no authentication; this is a scoped evaluation tool, not a multi-tenant product.

## Failure behavior

A slow, unavailable, or malformed model response produces a clear Hebrew error and **no fallback number**. The previous valid result remains visible in the client.

Set `ENABLE_FAILURE_DEMO=true` to expose a reviewer button that exercises this path on demand.

Each response has a Request ID; server logs emit structured JSON with request ID, status, failure code, and duration.

## Testing strategy

The suite focuses on the boundaries where a wrong answer would be most damaging:

- `tests/data.test.ts` — mixed numeric/date formats, conservative normalization, real-sample loading.
- `tests/database.test.ts` — DuckDB counts/medians checked against independent JavaScript calculations, evidence scope, month-date ambiguity and comparisons.
- `tests/planner.test.ts` — Groq/OpenAI provider selection and configuration failures.
- `tests/health.test.ts` — deployment readiness fails when the selected model provider is not configured.
- `tests/service.test.ts` — model failure, malformed plans, unsupported queries, impossible ranges, and model drift that drops/changes explicit user constraints.
- `tests/qa-regression.test.ts` — representative real CSV questions independently recalculated outside DuckDB.

Run the complete gate with `npm run check`.

## Local setup

```bash
npm ci
cp .env.example .env.local
# set GROQ_API_KEY (recommended free-tier setup)
npm run dev
```

Then open http://localhost:3000.

Quality gate:

```bash
npm run check
```

## Environment

```text
AI_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
AI_TIMEOUT_MS=10000

# Optional paid/alternate provider:
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-sol

ENABLE_FAILURE_DEMO=false
```

## Deployment

Railway is the recommended target because this is a long-running Node service with a native in-process DuckDB dependency.

For a new Railway service, use the current Railpack deployment path and configure the service from the Railway UI/CLI. Railway's older repo-level Config as Code is deprecated for new services; `railway.json` is kept valid for legacy compatibility but should not be the only deployment configuration you rely on.

1. Push the repository to GitHub.
2. Create a Railway service from the repo; Railpack should detect the Node/Next.js app.
3. Use build command `npm run build` and start command `npm run start` if Railway does not detect them automatically.
4. Set the healthcheck path to `/api/health`.
5. Add `GROQ_API_KEY` (or set `AI_PROVIDER=openai` and add `OPENAI_API_KEY`).
6. Optionally set `ENABLE_FAILURE_DEMO=true` for the interview.
7. Deploy and verify `/api/health` returns 2xx and `modelConfigured: true`.
8. Add the public URL here before submitting.

**Public URL:** _add after deployment_

**Repository URL:** _add after pushing the submission repository_

## Challenge coverage

| Brief requirement | Where it is handled |
| --- | --- |
| Live/public | Railway deployment path + `/api/health`; URL must be filled before submission |
| Hebrew, RTL | `app/layout.tsx` sets `lang="he"` and `dir="rtl"`; UI copy is Hebrew |
| LLM does real work | `src/planner.ts` maps free-form Hebrew into the closed `QueryPlan` |
| Data-supported answers | deterministic DuckDB analytics + sample size, filters, warnings, exclusions, sources and evidence rows |
| Missing/questionable data | conservative normalization, explicit exclusions and plain-language warnings |
| Graceful failure | planner timeout/error mapping, no fallback number, client abort and previous-result preservation |
| Tested/debuggable | focused Vitest suite, Request IDs, structured server logs and data fingerprint |
| CSM can use it alone | `docs/csm-guide.md` and in-app `/guide` |
| AI-assisted work log | `docs/ai-log.md` with a bad AI answer that was caught |
| Assumptions/cuts | this README, AI log and interview notes |

## Reviewer material

- [CSM guide](docs/csm-guide.md)
- [AI work log](docs/ai-log.md)
- [Interview notes](docs/interview-notes.md)
- [Submission checklist](docs/submission-checklist.md)
- [Challenge brief](madlan_rnd_ops_engineer_challenge.md)

The CSM guide is also available inside the app at `/guide`.

## Deliberate cuts

No auth, ORM, Redis, queue, agent framework, embeddings, RAG, charting library, or second backend. The goal is one polished, trustworthy workflow with failure behavior and evidence that can be defended live.
