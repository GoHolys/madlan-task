import { describe, expect, it } from "vitest";

import { runQuery } from "../src/analytics";
import type { Metric, QueryPlan } from "../src/contracts";
import { getDataset } from "../src/data";
import type { NormalizedDeal } from "../src/normalization";

const EMPTY_FILTERS: QueryPlan["filters"] = {
  cities: [],
  neighborhoods: [],
  propertyTypes: [],
  roomsMin: null,
  roomsMax: null,
  dateFrom: null,
  dateTo: null,
};

function eligible(deal: NormalizedDeal, plan: QueryPlan): boolean {
  if (deal.analyticsBlocked) return false;
  const filters = plan.filters;

  if (filters.cities.length && !filters.cities.includes(deal.city)) return false;
  if (
    filters.neighborhoods.length &&
    (!deal.neighborhood || !filters.neighborhoods.includes(deal.neighborhood))
  ) {
    return false;
  }
  if (
    filters.propertyTypes.length &&
    !filters.propertyTypes.includes(deal.propertyType)
  ) {
    return false;
  }
  if (
    filters.roomsMin !== null &&
    (deal.rooms === null || deal.rooms < filters.roomsMin)
  ) {
    return false;
  }
  if (
    filters.roomsMax !== null &&
    (deal.rooms === null || deal.rooms > filters.roomsMax)
  ) {
    return false;
  }
  if (
    filters.dateFrom !== null &&
    (deal.dealDateStart === null || deal.dealDateStart < filters.dateFrom)
  ) {
    return false;
  }
  if (
    filters.dateTo !== null &&
    (deal.dealDateEnd === null || deal.dealDateEnd > filters.dateTo)
  ) {
    return false;
  }

  if (plan.metric !== null && plan.metric !== "count") {
    if (deal.priceNis === null || deal.suspiciousPrice) return false;
    if (
      (plan.metric === "median_price_sqm" ||
        plan.metric === "average_price_sqm") &&
      deal.calculatedPricePerSqm === null
    ) {
      return false;
    }
  }

  if (plan.intent === "compare" && plan.groupBy !== null) {
    if (plan.groupBy === "neighborhood" && deal.neighborhood === null) return false;
    if (plan.groupBy === "year" && deal.dealYear === null) return false;
    if (plan.groupBy === "city" && !deal.city) return false;
    if (plan.groupBy === "property_type" && !deal.propertyType) return false;
  }

  return true;
}

function metricValues(rows: NormalizedDeal[], metric: Metric): number[] {
  if (metric === "count") return rows.map(() => 1);

  if (metric === "median_price" || metric === "average_price") {
    return rows.map((deal) => deal.priceNis as number);
  }

  return rows.map((deal) => deal.calculatedPricePerSqm as number);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function expectedMetric(rows: NormalizedDeal[], metric: Metric): number | null {
  if (metric === "count") return rows.length;

  const values = metricValues(rows, metric);
  if (!values.length) return null;

  if (metric === "median_price" || metric === "median_price_sqm") {
    return median(values);
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const cases: Array<{ question: string; plan: QueryPlan }> = [
  {
    question: "כמה עסקאות היו בחיפה בשנת 2024?",
    plan: {
      intent: "aggregate",
      metric: "count",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["חיפה"],
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      },
      limit: null,
      reason: "qa",
    },
  },
  {
    question: "מה חציון המחיר לדירות 4 חדרים בתל אביב?",
    plan: {
      intent: "aggregate",
      metric: "median_price",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["תל אביב-יפו"],
        propertyTypes: ["דירה"],
        roomsMin: 4,
        roomsMax: 4,
      },
      limit: null,
      reason: "qa",
    },
  },
  {
    question: "מה המחיר הממוצע בירושלים בשנת 2025?",
    plan: {
      intent: "aggregate",
      metric: "average_price",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["ירושלים"],
        dateFrom: "2025-01-01",
        dateTo: "2025-12-31",
      },
      limit: null,
      reason: "qa",
    },
  },
  {
    question: "מה המחיר הממוצע למ״ר בבאר שבע?",
    plan: {
      intent: "aggregate",
      metric: "average_price_sqm",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["באר שבע"],
      },
      limit: null,
      reason: "qa",
    },
  },
  {
    question: "כמה עסקאות יש בשכונת מרכז?",
    plan: {
      intent: "aggregate",
      metric: "count",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        neighborhoods: ["מרכז"],
      },
      limit: null,
      reason: "qa",
    },
  },
];

describe("representative CSV-to-DuckDB QA regressions", () => {
  for (const testCase of cases) {
    it(testCase.question, async () => {
      const dataset = await getDataset();
      const rows = dataset.deals.filter((deal) => eligible(deal, testCase.plan));
      const metric = testCase.plan.metric as Metric;
      const expected = expectedMetric(rows, metric);
      const actual = await runQuery(testCase.plan);

      console.log(
        JSON.stringify({
          question: testCase.question,
          expected,
          actual: actual.value,
          expectedN: rows.length,
          actualN: actual.sampleSize,
          evidenceIds: actual.evidence.map((deal) => deal.dealId),
        }),
      );

      expect(actual.sampleSize).toBe(rows.length);
      if (expected === null) {
        expect(actual.value).toBeNull();
      } else {
        expect(actual.value).toBeCloseTo(expected, 8);
      }

      const eligibleIds = new Set(rows.map((deal) => deal.dealId));
      expect(actual.evidence.every((deal) => eligibleIds.has(deal.dealId))).toBe(true);
    });
  }

  it("השווה חציון מחיר למ״ר בין הערים במדגם", async () => {
    const dataset = await getDataset();
    const plan: QueryPlan = {
      intent: "compare",
      metric: "median_price_sqm",
      groupBy: "city",
      filters: EMPTY_FILTERS,
      limit: null,
      reason: "qa",
    };

    const rows = dataset.deals.filter((deal) => eligible(deal, plan));
    const actual = await runQuery(plan);
    const expectedByCity = new Map<string, number | null>();

    for (const city of dataset.categories.cities) {
      const cityRows = rows.filter((deal) => deal.city === city);
      if (cityRows.length) {
        expectedByCity.set(city, expectedMetric(cityRows, "median_price_sqm"));
      }
    }

    console.log(
      JSON.stringify({
        question: "השווה חציון מחיר למ״ר בין הערים במדגם",
        expectedGroups: expectedByCity.size,
        actualGroups: actual.groups.length,
        expectedN: rows.length,
        actualN: actual.sampleSize,
      }),
    );

    expect(actual.groups).toHaveLength(expectedByCity.size);
    expect(actual.sampleSize).toBe(rows.length);

    for (const group of actual.groups) {
      const expected = expectedByCity.get(group.key);
      expect(expected).not.toBeUndefined();
      expect(group.value).toBeCloseTo(expected as number, 8);
    }
  });

  it("הצג 5 עסקאות אחרונות של דירות 3 חדרים בירושלים", async () => {
    const dataset = await getDataset();
    const plan: QueryPlan = {
      intent: "list",
      metric: null,
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["ירושלים"],
        propertyTypes: ["דירה"],
        roomsMin: 3,
        roomsMax: 3,
      },
      limit: 5,
      reason: "qa",
    };

    const rows = dataset.deals.filter((deal) => eligible(deal, plan));
    const actual = await runQuery(plan);

    console.log(
      JSON.stringify({
        question: "הצג 5 עסקאות אחרונות של דירות 3 חדרים בירושלים",
        expectedN: rows.length,
        actualN: actual.matchedCount,
        evidenceIds: actual.evidence.map((deal) => deal.dealId),
      }),
    );

    expect(actual.matchedCount).toBe(rows.length);
    expect(actual.evidence).toHaveLength(Math.min(5, rows.length));
    expect(
      actual.evidence.every(
        (deal) =>
          deal.city === "ירושלים" &&
          deal.propertyType === "דירה" &&
          deal.rooms === 3,
      ),
    ).toBe(true);
  });
});
