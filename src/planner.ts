import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { QueryPlanSchema, type QueryPlan } from "./contracts";
import { getDataset } from "./data";

export class PlannerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlannerError";
  }
}

type AiProvider = "groq" | "openai";

type PlannerRuntimeConfig = {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs: number;
};

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

function resolveProvider(
  env: Readonly<Record<string, string | undefined>>,
): AiProvider {
  const requested = (env.AI_PROVIDER ?? "auto").trim().toLowerCase();

  if (requested === "groq" || requested === "openai") {
    return requested;
  }

  if (requested === "auto") {
    return env.GROQ_API_KEY ? "groq" : "openai";
  }

  throw new PlannerError('AI_PROVIDER must be "auto", "groq", or "openai"');
}

function getProviderApiKey(
  provider: AiProvider,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return provider === "groq" ? env.GROQ_API_KEY : env.OPENAI_API_KEY;
}

export function getConfiguredProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiProvider | null {
  const provider = resolveProvider(env);
  return getProviderApiKey(provider, env) ? provider : null;
}

export function getPlannerRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlannerRuntimeConfig {
  const provider = resolveProvider(env);
  const apiKey = getProviderApiKey(provider, env);

  if (!apiKey) {
    throw new PlannerError(
      `${provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY"} is not configured`,
    );
  }

  const timeoutMs = Number(
    env.AI_TIMEOUT_MS ?? env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PlannerError("AI_TIMEOUT_MS must be a positive number");
  }

  return {
    provider,
    apiKey,
    model:
      provider === "groq"
        ? env.GROQ_MODEL ?? "openai/gpt-oss-20b"
        : env.OPENAI_MODEL ?? "gpt-6-sol",
    baseURL: provider === "groq" ? GROQ_BASE_URL : undefined,
    timeoutMs,
  };
}

function plannerInstructions(input: {
  cities: string[];
  neighborhoods: string[];
  propertyTypes: string[];
  dateMin: string | null;
  dateMax: string | null;
}): string {
  return `
You are the natural-language query planner for a Hebrew, RTL residential-deals evidence assistant.

Your only job is to translate the user's Hebrew question into the provided structured query plan.
Never calculate a market number. Never write SQL. Never invent a city, neighborhood, category, date, or fact.

DATASET SCOPE
- This is only the supplied sample of residential deals, not the complete Israeli market.
- Available transaction date coverage is approximately ${input.dateMin ?? "unknown"} through ${input.dateMax ?? "unknown"}.
- Cities: ${input.cities.join(", ")}
- Property types: ${input.propertyTypes.join(", ")}
- Neighborhoods: ${input.neighborhoods.join(", ")}

SUPPORTED INTENTS
- aggregate: one deterministic metric over matching deals.
- compare: the same metric grouped by city, neighborhood, property_type, or transaction year.
- list: show matching deals, newest first.
- quality: explain the supplied sample's data quality.
- unsupported: the request needs unsupported fields, outside knowledge, prediction, valuation, recommendation, or cannot be represented faithfully.

SUPPORTED METRICS
- count
- median_price
- average_price
- median_price_sqm
- average_price_sqm

SUPPORTED FILTERS
- one or more cities
- one or more neighborhoods
- one or more property types
- rooms minimum/maximum
- transaction date from/to

SEMANTICS
- "4 rooms" means roomsMin=4 and roomsMax=4.
- "at least 4 rooms" means roomsMin=4.
- A calendar year means January 1 through December 31 of that year.
- groupBy "year" means transaction year, not construction year.
- A comparison between named cities should use those cities as filters and groupBy="city".
- For a broad comparison without named cities, leave the city filter empty and group by the requested dimension.
- Use list only when the user is explicitly asking to see/example/list matching deals.
- Use quality for questions about bad/missing/duplicate/inconsistent data in the sample.
- Use unsupported rather than silently dropping a requested condition.
- Streets, floor, total floors, construction year, condition, amenities, source filtering, predictions, "best" areas, investment advice, and market-wide claims are unsupported in this product.
- When unsupported, put a short plain-Hebrew explanation in reason. Otherwise reason should briefly describe the interpretation, not the answer.
- metric must be null for list, quality, and unsupported.
- groupBy must be null unless intent is compare.
- limit should normally be null; for list it may be 1-20.
- Date filters must be ISO YYYY-MM-DD or null.

The application will validate all categories and execute the plan deterministically. Do not broaden a question to make it executable.
`.trim();
}

export async function planQuestion(
  question: string,
  options: { simulateFailure?: boolean } = {},
): Promise<QueryPlan> {
  if (options.simulateFailure) {
    throw new PlannerError("Simulated model failure");
  }

  const config = getPlannerRuntimeConfig();
  const dataset = await getDataset();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  try {
    const response = await client.responses.parse(
      {
        model: config.model,
        reasoning: { effort: "low" },
        max_output_tokens: 700,
        input: [
          {
            role: "system",
            content: plannerInstructions({
              cities: dataset.categories.cities,
              neighborhoods: dataset.categories.neighborhoods,
              propertyTypes: dataset.categories.propertyTypes,
              dateMin: dataset.quality.dateMin,
              dateMax: dataset.quality.dateMax,
            }),
          },
          { role: "user", content: question },
        ],
        text: {
          format: zodTextFormat(QueryPlanSchema, "madlan_query_plan"),
        },
      },
    );

    if (response.status !== "completed" || !response.output_parsed) {
      throw new PlannerError(`Model returned no usable plan (status: ${response.status})`);
    }

    return response.output_parsed;
  } catch (error) {
    if (error instanceof PlannerError) throw error;
    throw new PlannerError("The model planner failed", { cause: error });
  }
}
