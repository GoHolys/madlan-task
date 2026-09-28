# AI work log

This challenge was built with AI assistance, with execution and verification used to catch assumptions rather than accepting generated output blindly.

## 1. Product and architecture

I asked the AI to optimize for the actual evaluation: a CSM-facing product, trustworthy answers, graceful failure, a short code walkthrough, and roughly five focused hours.

The first implementation in the existing project had the right evidence-first principle but too many separate query modules for this time-box. I used the AI review to simplify the fresh build to a small set of cohesive boundaries: contracts, data normalization, DuckDB analytics, LLM planner, service orchestration, and UI.

I verified current official documentation before locking choices:
- Next.js App Router for one full-stack service.
- DuckDB Node Neo (`@duckdb/node-api`) rather than the deprecated old Node client.
- An OpenAI-compatible Responses API boundary with strict structured outputs rather than free-form JSON.
- Groq free-tier support using `openai/gpt-oss-20b` as the recommended zero-cost reviewer/demo path, while retaining OpenAI as an optional provider.

## 2. A bad AI answer I caught

The AI first told me to profile the CSV with pandas without checking whether pandas existed in the local environment. That answer was wrong for the environment. I ran it instead of assuming it would work, and it failed immediately with `ModuleNotFoundError: No module named 'pandas'`.

I did not install unrelated tooling into the source project just to make the suggestion succeed. I switched to inspection using the project/runtime toolchain and then encoded the data-quality behavior explicitly in the application.

A second, more important catch happened during verification. A tool read of the source CSV was capped and included a truncation marker in the copied file. The file still looked plausible at a glance, but the first real test run failed with `Invalid Record Length: columns length is 19, got 1 on line 328`. I compared the source and destination byte counts/hashes, recopied the CSV in bounded chunks, and verified the destination is byte-for-byte identical to the supplied file (SHA-256 `cfe4a245e08a1bda6daf53a0e16c8f745c4b2e154713ce63fee8bca8ab9aac88`). Only then did the data-backed tests pass.

A final deployment-doc check caught another stale assumption: the first Railway config used the old `NIXPACKS` builder. Current Railway documentation uses Railpack and deprecates the older repo-level Config as Code flow for new services. I updated the checked-in legacy config to `RAILPACK` and documented the current UI/CLI deployment path rather than pretending an outdated config file was sufficient.

These catches are representative of the rule used throughout the task: **run or verify the suggestion/output against the real environment, data, and current documentation, then keep or reject it**.

## 3. Data decisions checked against the CSV

Sampling the CSV exposed mixed representations rather than clean typed data, including:

- prices with and without thousands separators;
- room counts such as `2 חדרים` alongside numeric forms;
- several date formats, including month-only values such as `Aug 2025`;
- whitespace and punctuation variations in locations;
- inconsistent boolean representations in fields the current product deliberately does not filter on.

The app normalizes representation only. It does not invent a day for month-only dates or fuzzy-merge streets/neighborhoods. Duplicate IDs with conflicting analytical fields are blocked. Price/m² is recalculated from price and area.

## 4. LLM boundary

The LLM converts Hebrew into a closed `QueryPlan`. It never generates SQL and never calculates the answer.

After the model returns:
1. Zod/Structured Outputs enforce the contract.
2. Application code resolves requested categories against the actual dataset.
3. Semantic checks reject impossible or internally inconsistent plans instead of silently ignoring fields.
4. Deterministic guardrails verify explicit city, metric, room-count and year constraints were preserved.
5. DuckDB runs parameterized, whitelisted SQL.
6. Hebrew answer text is deterministic.

An unsupported request fails closed rather than silently dropping a condition.

## 5. Verification

Before submission I run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The automated suite independently recalculates representative counts and medians from the normalized dataset and compares them to DuckDB, tests mixed numeric/date formats, verifies month-only date ambiguity handling, rejects unknown categories instead of broadening them, and checks that model failure returns no fallback number.

I also verify the production build, health endpoint, representative Hebrew flows, unsupported requests, and the simulated model-failure path. Concrete failures found during this pass are documented above rather than hidden.

## 6. Deliberate cuts

I did not add authentication, Redis, a queue, an ORM, an agent framework, RAG, embeddings, a second backend, or arbitrary SQL generation. None improves the core evaluation path for a ~500-row analytical sample; each adds failure surface and code that would be harder to defend in a 15-minute walkthrough.
