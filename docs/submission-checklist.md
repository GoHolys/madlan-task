# Submission checklist

This is the final checklist for the Madlan challenge. Do not send the submission until every required item is checked.

## Required deliverables

- [x] Public live URL: https://madlan-task-production.up.railway.app
- [x] Public/accessible repository URL: https://github.com/GoHolys/madlan-task
- [x] CSM guide: `docs/csm-guide.md` and `/guide`
- [x] AI work log: `docs/ai-log.md`

The challenge explicitly requires all four.

## 1. Clean verification

From a clean checkout:

```bash
npm ci
npm run check
```

`npm run check` runs:

- TypeScript typecheck
- ESLint with zero warnings
- Vitest
- production Next.js build

Verified on 2026-09-28: `npm ci` succeeds, `npm run check` passes with 41/41 tests, and `npm audit --omit=dev` reports 0 vulnerabilities.

## 2. Production smoke test

Run the production build, not only dev mode:

```bash
npm run build
npm run start
```

Verify:

- [x] `/` loads
- [x] `/guide` loads
- [x] `/api/health` returns 2xx
- [ ] Hebrew text and RTL layout look correct
- [ ] desktop layout works
- [ ] mobile/narrow layout works
- [ ] browser console has no unexpected errors

## 3. Environment

Recommended interview/demo deployment:

```text
AI_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
AI_TIMEOUT_MS=10000
ENABLE_FAILURE_DEMO=true
```

Optional OpenAI path:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-sol
AI_TIMEOUT_MS=10000
```

Never commit `.env.local` or API keys. The repository `.gitignore` already ignores `.env*` except `.env.example`.

## 4. Manual acceptance questions

Run at least these on the deployed URL:

1. `מה חציון המחיר לדירות 4 חדרים בתל אביב?`
2. `השווה חציון מחיר למ״ר בין הערים במדגם`
3. `כמה עסקאות היו בחיפה בשנת 2024?`
4. `הצג 5 עסקאות אחרונות של דירות 3 חדרים בירושלים`
5. `אילו בעיות איכות יש בקובץ?`
6. Unsupported: `איזו שכונה הכי טובה להשקעה?`

For successful answers verify:

- [ ] displayed filters match the question
- [ ] sample size is visible
- [ ] warnings are understandable
- [ ] supporting deals match the filters
- [ ] Request ID is visible
- [ ] data fingerprint is visible
- [ ] source breakdown/exclusions are available under “איך חושב המספר?”

## 5. Failure demo

With `ENABLE_FAILURE_DEMO=true`:

1. run a normal question and keep the valid result visible;
2. click **הדגם כשל מודל**;
3. verify a clear Hebrew error appears;
4. verify no fallback number is created;
5. verify the previous valid result remains visible;
6. check server logs for the Request ID/status/duration.

## 6. Repository

The submission repository is https://github.com/GoHolys/madlan-task.

Before pushing:

- [x] no API keys or `.env.local` are tracked
- [x] `.next/`, `node_modules/`, coverage and TypeScript build artifacts are not tracked
- [x] README delivery links are filled
- [x] CSV required by the app is included
- [x] challenge brief is included
- [x] CSM guide and AI log are included

The repository URL is recorded in `README.md`.

## 7. Railway deployment

As of 2026-09-28, Railway uses Railpack for new services and its older repo-level Config as Code is deprecated for new services. The checked-in `railway.json` now uses the valid `RAILPACK` builder for legacy compatibility, but configure a new service from the Railway UI/CLI rather than relying on that file alone.

For the service, verify:

- build command: `npm run build`
- start command: `npm run start`
- healthcheck path: `/api/health`

After deploy:

- [x] provider API key is configured as a Railway variable
- [ ] set `ENABLE_FAILURE_DEMO=true` for the interview if desired
- [x] `/api/health` returns 2xx, `ok: true`, and `modelConfigured: true`
- [ ] open the public domain in an incognito/private window
- [ ] run the acceptance questions above
- [ ] test the failure-demo button
- [x] final public URL is recorded in `README.md`

## 8. README delivery links

- [x] Public URL recorded in `README.md`
- [x] Repository URL recorded in `README.md`

## 9. Interview readiness

Read `docs/interview-notes.md` once immediately before the session.

Be ready to show:

- the normal question path;
- an unsupported request;
- the model failure path;
- `src/service.ts` + `src/guardrails.ts` as the strongest code;
- `src/analytics.ts` as the deliberate tradeoff / least-happy area;
- `tests/service.test.ts` and `tests/database.test.ts`;
- the CSM “number is wrong” workflow.

## Final delivery

Send:

- live URL;
- repository URL;
- `docs/csm-guide.md`;
- `docs/ai-log.md`.

The README should also link to all reviewer material so the reviewer does not need to search the repository.
