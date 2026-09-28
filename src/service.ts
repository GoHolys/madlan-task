import { runQuery } from "./analytics";
import type { PublicAnswer, QueryPlan } from "./contracts";
import { getDataset, type Dataset } from "./data";
import { planDriftReason } from "./guardrails";
import { canonicalCategory, normalizeCity } from "./normalization";
import { planQuestion, PlannerError } from "./planner";
import {
  appliedFilters,
  presentation,
  warnings,
} from "./presentation";

class UnsupportedQueryError extends Error {}

type Dependencies = {
  planner: typeof planQuestion;
  query: typeof runQuery;
  dataset: typeof getDataset;
};

const DEFAULT_DEPENDENCIES: Dependencies = {
  planner: planQuestion,
  query: runQuery,
  dataset: getDataset,
};

function validIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function resolveCategory(
  value: string,
  allowed: string[],
  kind: "city" | "neighborhood" | "property type",
): string {
  const key = canonicalCategory(
    kind === "city" ? normalizeCity(value) : value,
  );
  const direct = allowed.find(
    (candidate) => canonicalCategory(candidate) === key,
  );

  if (direct) return direct;

  const label =
    kind === "city"
      ? "את העיר"
      : kind === "neighborhood"
        ? "את השכונה"
        : "את סוג הנכס";

  throw new UnsupportedQueryError(
    `לא מצאתי ${label} "${value}" במדגם, ולכן לא הרחבתי את הבקשה אוטומטית.`,
  );
}

function resolveMany(
  values: string[],
  allowed: string[],
  kind: "city" | "neighborhood" | "property type",
): string[] {
  return Array.from(
    new Set(
      values.map((value) => resolveCategory(value, allowed, kind)),
    ),
  );
}

function hasFilters(plan: QueryPlan): boolean {
  const { filters } = plan;
  return (
    filters.cities.length > 0 ||
    filters.neighborhoods.length > 0 ||
    filters.propertyTypes.length > 0 ||
    filters.roomsMin !== null ||
    filters.roomsMax !== null ||
    filters.dateFrom !== null ||
    filters.dateTo !== null
  );
}

function assertPlanShape(plan: QueryPlan): void {
  const inconsistent = () => {
    throw new UnsupportedQueryError(
      "הפירוש שהתקבל מהמודל אינו עקבי, ולכן לא הרצתי חישוב.",
    );
  };

  switch (plan.intent) {
    case "aggregate":
      if (plan.metric === null) {
        throw new UnsupportedQueryError(
          "לא הצלחתי לזהות איזה מדד לחשב בלי לנחש.",
        );
      }
      if (plan.groupBy !== null || plan.limit !== null) inconsistent();
      return;

    case "compare":
      if (plan.metric === null || plan.groupBy === null) {
        throw new UnsupportedQueryError(
          "לא הצלחתי לזהות השוואה מלאה בלי לנחש.",
        );
      }
      if (plan.limit !== null) inconsistent();
      return;

    case "list":
      if (plan.metric !== null || plan.groupBy !== null) inconsistent();
      return;

    case "quality":
      if (
        plan.metric !== null ||
        plan.groupBy !== null ||
        plan.limit !== null ||
        hasFilters(plan)
      ) {
        inconsistent();
      }
      return;

    case "unsupported":
      return;
  }
}

function validatePlan(plan: QueryPlan, dataset: Dataset): QueryPlan {
  assertPlanShape(plan);
  if (plan.intent === "unsupported") return plan;

  const { roomsMin, roomsMax, dateFrom, dateTo } = plan.filters;

  if (
    (roomsMin !== null && (roomsMin <= 0 || roomsMin > 20)) ||
    (roomsMax !== null && (roomsMax <= 0 || roomsMax > 20)) ||
    (roomsMin !== null &&
      roomsMax !== null &&
      roomsMin > roomsMax)
  ) {
    throw new UnsupportedQueryError(
      "טווח החדרים שהתקבל אינו תקין.",
    );
  }

  if (
    (dateFrom !== null && !validIsoDate(dateFrom)) ||
    (dateTo !== null && !validIsoDate(dateTo)) ||
    (dateFrom !== null &&
      dateTo !== null &&
      dateFrom > dateTo)
  ) {
    throw new UnsupportedQueryError(
      "טווח התאריכים שהתקבל אינו תקין.",
    );
  }

  return {
    ...plan,
    filters: {
      ...plan.filters,
      cities: resolveMany(
        plan.filters.cities,
        dataset.categories.cities,
        "city",
      ),
      neighborhoods: resolveMany(
        plan.filters.neighborhoods,
        dataset.categories.neighborhoods,
        "neighborhood",
      ),
      propertyTypes: resolveMany(
        plan.filters.propertyTypes,
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
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };

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
    const driftReason = planDriftReason(
      input.question,
      plan,
      dataset.categories.cities,
    );
    if (driftReason) throw new UnsupportedQueryError(driftReason);

    const result = await deps.query(plan);
    const copy = presentation(plan, result, dataset.quality);

    return {
      status: "ok",
      requestId: input.requestId,
      question: input.question,
      plan,
      headline: copy.headline,
      summary: copy.summary,
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

    const message =
      error instanceof Error ? error.message : String(error);
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

export const __test = {
  validatePlan,
};
