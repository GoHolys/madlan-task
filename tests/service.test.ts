import { describe, expect, it } from "vitest";

import type { QueryPlan, QueryResult } from "../src/contracts";
import { getDataset } from "../src/data";
import { PlannerError } from "../src/planner";
import { answerQuestion } from "../src/service";

const plan: QueryPlan = {
  intent: "aggregate",
  metric: "count",
  groupBy: null,
  filters: {
    cities: [],
    neighborhoods: [],
    propertyTypes: [],
    roomsMin: null,
    roomsMax: null,
    dateFrom: null,
    dateTo: null,
  },
  limit: null,
  reason: "ספירת עסקאות במדגם",
};

const result: QueryResult = {
  intent: "aggregate",
  metric: "count",
  value: 42,
  sampleSize: 42,
  matchedCount: 42,
  groups: [],
  evidence: [],
  evidenceTruncated: true,
  sourceBreakdown: { "רשות המסים": 42 },
  excluded: {
    total: 0,
    blockedRows: 0,
    suspiciousOrMissingPrice: 0,
    missingSize: 0,
    ambiguousMonthDate: 0,
  },
};

describe("answer service", () => {
  it("presents deterministic successful output", async () => {
    const answer = await answerQuestion(
      { question: "כמה עסקאות?", requestId: "req-1" },
      {
        planner: async () => plan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("ok");
    if (answer.status === "ok") {
      expect(answer.headline).toContain("42");
      expect(answer.warnings[0]).toContain("קובץ המדגם");
    }
  });

  it("fails closed when the model planner is unavailable", async () => {
    const answer = await answerQuestion(
      { question: "כמה עסקאות?", requestId: "req-2" },
      {
        planner: async () => {
          throw new PlannerError("timeout");
        },
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("error");
    if (answer.status === "error") {
      expect(answer.code).toBe("MODEL_UNAVAILABLE");
      expect(answer.message).toContain("לא בוצע חישוב חלופי");
    }
  });

  it("rejects a category that is not present instead of broadening it", async () => {
    const invalidPlan: QueryPlan = {
      ...plan,
      filters: { ...plan.filters, cities: ["עיר שלא קיימת בכלל"] },
    };

    const answer = await answerQuestion(
      { question: "כמה עסקאות בעיר שלא קיימת?", requestId: "req-3" },
      {
        planner: async () => invalidPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
  });

  it("returns the model's explicit unsupported state without querying data", async () => {
    let queried = false;
    const unsupportedPlan: QueryPlan = {
      ...plan,
      intent: "unsupported",
      metric: null,
      reason: "אין בקובץ תחזית מחירים עתידית.",
    };

    const answer = await answerQuestion(
      { question: "מה יקרה למחירים?", requestId: "req-4" },
      {
        planner: async () => unsupportedPlan,
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    expect(queried).toBe(false);
  });

  it("fails closed when the model drops an explicit city", async () => {
    let queried = false;

    const answer = await answerQuestion(
      { question: "כמה עסקאות היו בירושלים?", requestId: "req-city-drift" },
      {
        planner: async () => plan,
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    expect(queried).toBe(false);
    if (answer.status === "unsupported") {
      expect(answer.message).toContain("העיר");
    }
  });

  it("prefers the most specific explicit city when city names overlap", async () => {
    const specificCityPlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        cities: ["מודיעין מכבים רעות"],
      },
    };

    const answer = await answerQuestion(
      {
        question: "כמה עסקאות היו במודיעין מכבים רעות?",
        requestId: "req-overlapping-city",
      },
      {
        planner: async () => specificCityPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("ok");
  });

  it("repairs an exact known city misclassified as a neighborhood", async () => {
    const misclassifiedPlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        neighborhoods: ["מודיעין מכבים רעות"],
      },
    };

    const answer = await answerQuestion(
      {
        question: "כמה עסקאות היו במודיעין מכבים רעות?",
        requestId: "req-misclassified-city",
      },
      {
        planner: async () => misclassifiedPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("ok");
    if (answer.status === "ok") {
      expect(answer.plan.filters.cities).toEqual(["מודיעין מכבים רעות"]);
      expect(answer.plan.filters.neighborhoods).toEqual([]);
    }
  });

  it("fails closed when the model changes an explicit metric", async () => {
    const wrongMetricPlan: QueryPlan = {
      ...plan,
      metric: "median_price",
      filters: {
        ...plan.filters,
        cities: ["חיפה"],
      },
    };

    const answer = await answerQuestion(
      { question: "מה המחיר הממוצע בחיפה?", requestId: "req-metric-drift" },
      {
        planner: async () => wrongMetricPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    if (answer.status === "unsupported") {
      expect(answer.message).toContain("המדד");
    }
  });

  it("fails closed when the model drops explicit rooms or year", async () => {
    const driftedPlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        cities: ["ירושלים"],
        roomsMin: null,
        roomsMax: null,
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      },
    };

    const answer = await answerQuestion(
      {
        question: "כמה עסקאות של 4 חדרים היו בירושלים בשנת 2025?",
        requestId: "req-filter-drift",
      },
      {
        planner: async () => driftedPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    if (answer.status === "unsupported") {
      expect(answer.message).toContain("החדרים");
    }
  });

  it("rejects planner fields that would otherwise be silently ignored", async () => {
    let queried = false;
    const inconsistentPlan: QueryPlan = {
      ...plan,
      groupBy: "city",
    };

    const answer = await answerQuestion(
      { question: "כמה עסקאות?", requestId: "req-shape" },
      {
        planner: async () => inconsistentPlan,
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    expect(queried).toBe(false);
  });

  it("rejects filtered quality plans because quality is dataset-wide", async () => {
    let queried = false;
    const filteredQualityPlan: QueryPlan = {
      ...plan,
      intent: "quality",
      metric: null,
      filters: {
        ...plan.filters,
        cities: ["חיפה"],
      },
    };

    const answer = await answerQuestion(
      { question: "אילו בעיות איכות יש בקובץ?", requestId: "req-quality-scope" },
      {
        planner: async () => filteredQualityPlan,
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    expect(queried).toBe(false);
  });

  it("fails closed on an impossible room range before querying", async () => {
    let queried = false;
    const impossiblePlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        roomsMin: 5,
        roomsMax: 3,
      },
    };

    const answer = await answerQuestion(
      { question: "כמה עסקאות יש בין 5 ל-3 חדרים?", requestId: "req-range" },
      {
        planner: async () => impossiblePlan,
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("unsupported");
    expect(queried).toBe(false);
  });

  it("fails closed on malformed model output represented as a planner failure", async () => {
    let queried = false;
    const answer = await answerQuestion(
      { question: "כמה עסקאות?", requestId: "req-malformed-model" },
      {
        planner: async () => {
          throw new PlannerError("Model returned no usable plan");
        },
        query: async () => {
          queried = true;
          return result;
        },
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("error");
    expect(queried).toBe(false);
    if (answer.status === "error") {
      expect(answer.code).toBe("MODEL_UNAVAILABLE");
    }
  });

  it("does not mistake an explicit partial date range for a whole-year request", async () => {
    const partialDatePlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        dateFrom: "2025-08-15",
        dateTo: "2025-08-31",
      },
    };

    const answer = await answerQuestion(
      {
        question: "כמה עסקאות היו בין 15 באוגוסט 2025 ל-31 באוגוסט 2025?",
        requestId: "req-partial-date",
      },
      {
        planner: async () => partialDatePlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("ok");
  });

  it("accepts a plan that preserves explicit city, rooms, year and metric", async () => {
    const faithfulPlan: QueryPlan = {
      ...plan,
      filters: {
        ...plan.filters,
        cities: ["ירושלים"],
        roomsMin: 4,
        roomsMax: 4,
        dateFrom: "2025-01-01",
        dateTo: "2025-12-31",
      },
    };

    const answer = await answerQuestion(
      {
        question: "כמה עסקאות של 4 חדרים היו בירושלים בשנת 2025?",
        requestId: "req-faithful",
      },
      {
        planner: async () => faithfulPlan,
        query: async () => result,
        dataset: getDataset,
      },
    );

    expect(answer.status).toBe("ok");
  });
});
