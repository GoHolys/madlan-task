import { runQuery } from "./analytics";
import type { PublicAnswer, QueryPlan } from "./contracts";
import { getDataset, type Dataset } from "./data";
import { planDriftReason } from "./guardrails";
import { canonicalCategory, normalizeCity } from "./normalization";
import { planQuestion, PlannerError } from "./planner";
import { appliedFilters, presentation, warnings } from "./presentation";

class UnsupportedQueryError extends Error {}

type Dependencies = {
  planner: typeof planQuestion;
  query: typeof runQuery;
  dataset: typeof getDataset;
};

const defaults: Dependencies = {
  planner: planQuestion,
  query: runQuery,
  dataset: getDataset,
};

function unsupported(message: string): never {
  throw new UnsupportedQueryError(message);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function findCategory(
  value: string,
  allowed: string[],
  city = false,
): string | null {
  const normalized = canonicalCategory(city ? normalizeCity(value) : value);
  return (
    allowed.find(
      (candidate) => canonicalCategory(candidate) === normalized,
    ) ?? null
  );
}

function resolveCategories(
  values: string[],
  allowed: string[],
  kind: "city" | "neighborhood" | "property type",
): string[] {
  const labels = {
    city: "את העיר",
    neighborhood: "את השכונה",
    "property type": "את סוג הנכס",
  };

  return Array.from(
    new Set(
      values.map((value) => {
        const match = findCategory(value, allowed, kind === "city");
        if (!match) {
          unsupported(
            `לא מצאתי ${labels[kind]} "${value}" במדגם, ולכן לא הרחבתי את הבקשה אוטומטית.`,
          );
        }
        return match;
      }),
    ),
  );
}

function hasFilters(plan: QueryPlan): boolean {
  const f = plan.filters;
  return Boolean(
    f.cities.length ||
      f.neighborhoods.length ||
      f.propertyTypes.length ||
      f.roomsMin !== null ||
      f.roomsMax !== null ||
      f.dateFrom !== null ||
      f.dateTo !== null,
  );
}

function validateShape(plan: QueryPlan): void {
  const invalid = () =>
    unsupported("הפירוש שהתקבל מהמודל אינו עקבי, ולכן לא הרצתי חישוב.");

  if (plan.intent === "aggregate") {
    if (!plan.metric) {
      unsupported("לא הצלחתי לזהות איזה מדד לחשב בלי לנחש.");
    }
    if (plan.groupBy || plan.limit) invalid();
    return;
  }

  if (plan.intent === "compare") {
    if (!plan.metric || !plan.groupBy) {
      unsupported("לא הצלחתי לזהות השוואה מלאה בלי לנחש.");
    }
    if (plan.limit) invalid();
    return;
  }

  if (plan.intent === "list") {
    if (plan.metric || plan.groupBy) invalid();
    return;
  }

  if (plan.intent === "quality") {
    if (plan.metric || plan.groupBy || plan.limit || hasFilters(plan)) invalid();
  }
}

function validatePlan(plan: QueryPlan, dataset: Dataset): QueryPlan {
  validateShape(plan);
  if (plan.intent === "unsupported") return plan;

  const f = plan.filters;
  const invalidRooms =
    (f.roomsMin !== null && (f.roomsMin <= 0 || f.roomsMin > 20)) ||
    (f.roomsMax !== null && (f.roomsMax <= 0 || f.roomsMax > 20)) ||
    (f.roomsMin !== null && f.roomsMax !== null && f.roomsMin > f.roomsMax);

  if (invalidRooms) unsupported("טווח החדרים שהתקבל אינו תקין.");

  const invalidDates =
    (f.dateFrom !== null && !isValidDate(f.dateFrom)) ||
    (f.dateTo !== null && !isValidDate(f.dateTo)) ||
    (f.dateFrom !== null && f.dateTo !== null && f.dateFrom > f.dateTo);

  if (invalidDates) unsupported("טווח התאריכים שהתקבל אינו תקין.");

  // Models occasionally put a known city in the neighborhood field.
  // Repair only exact known categories; never broaden or guess.
  const cities = [...f.cities];
  const neighborhoods = f.neighborhoods.filter((value) => {
    const city = findCategory(value, dataset.categories.cities, true);
    const neighborhood = findCategory(value, dataset.categories.neighborhoods);

    if (city && !neighborhood) {
      cities.push(city);
      return false;
    }

    return true;
  });

  return {
    ...plan,
    filters: {
      ...f,
      cities: resolveCategories(cities, dataset.categories.cities, "city"),
      neighborhoods: resolveCategories(
        neighborhoods,
        dataset.categories.neighborhoods,
        "neighborhood",
      ),
      propertyTypes: resolveCategories(
        f.propertyTypes,
        dataset.categories.propertyTypes,
        "property type",
      ),
    },
  };
}

export async function answerQuestion(
  input: {
    question: string;
    requestId: string;
    simulateModelFailure?: boolean;
  },
  dependencies: Partial<Dependencies> = {},
): Promise<PublicAnswer> {
  const deps = { ...defaults, ...dependencies };

  try {
    const dataset = await deps.dataset();
    const rawPlan = await deps.planner(input.question, {
      simulateFailure: input.simulateModelFailure,
    });

    if (rawPlan.intent === "unsupported") {
      return {
        status: "unsupported",
        requestId: input.requestId,
        question: input.question,
        message:
          rawPlan.reason ||
          "הבקשה דורשת מידע או ניתוח שהאפליקציה לא יכולה לתמוך בו בלי לנחש.",
      };
    }

    const plan = validatePlan(rawPlan, dataset);
    const drift = planDriftReason(
      input.question,
      plan,
      dataset.categories.cities,
    );
    if (drift) unsupported(drift);

    const result = await deps.query(plan);
    const copy = presentation(plan, result, dataset.quality);

    return {
      status: "ok",
      requestId: input.requestId,
      question: input.question,
      plan,
      ...copy,
      appliedFilters: appliedFilters(plan),
      warnings: warnings(plan, result, dataset.quality),
      result,
      quality: dataset.quality,
    };
  } catch (error) {
    if (error instanceof UnsupportedQueryError) {
      return {
        status: "unsupported",
        requestId: input.requestId,
        question: input.question,
        message: error.message,
      };
    }

    if (error instanceof PlannerError) {
      return {
        status: "error",
        requestId: input.requestId,
        question: input.question,
        code: "MODEL_UNAVAILABLE",
        message:
          "לא הצלחתי לפרש את השאלה כרגע כי שירות ה-AI לא זמין או החזיר תשובה לא תקינה. לא בוצע חישוב חלופי ולא הוצגו מספרים לא מאומתים.",
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const dataFailure =
      message.includes("CSV") ||
      message.includes("dataset") ||
      message.includes("ENOENT");

    return {
      status: "error",
      requestId: input.requestId,
      question: input.question,
      code: dataFailure ? "DATA_UNAVAILABLE" : "QUERY_FAILED",
      message: dataFailure
        ? "קובץ הנתונים לא נטען באופן תקין. לא מוצגים מספרים עד שהבעיה תיפתר."
        : "החישוב נכשל לאחר פירוש השאלה. לא מוצגת תוצאה חלקית או משוערת.",
    };
  }
}

export const __test = { validatePlan };
