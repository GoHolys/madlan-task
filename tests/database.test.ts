import { describe, expect, it } from "vitest";

import type { QueryPlan } from "../src/contracts";
import { getDataset } from "../src/data";
import { runQuery } from "../src/analytics";

const EMPTY_FILTERS: QueryPlan["filters"] = {
  cities: [],
  neighborhoods: [],
  propertyTypes: [],
  roomsMin: null,
  roomsMax: null,
  dateFrom: null,
  dateTo: null,
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

describe("DuckDB analytics", () => {
  it("counts the same canonical rows as an independent JS calculation", async () => {
    const dataset = await getDataset();
    const expected = dataset.deals.filter((deal) => !deal.analyticsBlocked).length;

    const plan: QueryPlan = {
      intent: "aggregate",
      metric: "count",
      groupBy: null,
      filters: EMPTY_FILTERS,
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);
    expect(result.value).toBe(expected);
    expect(result.sampleSize).toBe(expected);
  });

  it("matches an independently calculated median price", async () => {
    const dataset = await getDataset();
    const expected = median(
      dataset.deals
        .filter(
          (deal) =>
            !deal.analyticsBlocked &&
            deal.priceNis !== null &&
            !deal.suspiciousPrice,
        )
        .map((deal) => deal.priceNis as number),
    );

    const plan: QueryPlan = {
      intent: "aggregate",
      metric: "median_price",
      groupBy: null,
      filters: EMPTY_FILTERS,
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);
    expect(result.value).toBeCloseTo(expected ?? 0, 6);
  });

  it("uses the same city/room predicate for the metric and evidence", async () => {
    const dataset = await getDataset();
    const expectedDeals = dataset.deals.filter(
      (deal) =>
        !deal.analyticsBlocked &&
        deal.city === "חיפה" &&
        deal.rooms === 4 &&
        deal.priceNis !== null &&
        !deal.suspiciousPrice,
    );
    const expected = median(
      expectedDeals.map((deal) => deal.priceNis as number),
    );

    const plan: QueryPlan = {
      intent: "aggregate",
      metric: "median_price",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        cities: ["חיפה"],
        roomsMin: 4,
        roomsMax: 4,
      },
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);

    expect(result.value).toBeCloseTo(expected ?? 0, 6);
    expect(result.sampleSize).toBe(expectedDeals.length);
    expect(
      result.evidence.every(
        (deal) => deal.city === "חיפה" && deal.rooms === 4,
      ),
    ).toBe(true);
  });

  it("reports partially overlapping month-only dates as ambiguous", async () => {
    const plan: QueryPlan = {
      intent: "aggregate",
      metric: "count",
      groupBy: null,
      filters: {
        ...EMPTY_FILTERS,
        dateFrom: "2025-08-15",
        dateTo: "2025-08-31",
      },
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);
    expect(result.excluded.ambiguousMonthDate).toBeGreaterThan(0);
  });

  it("returns every city in a broad city comparison without silent truncation", async () => {
    const dataset = await getDataset();
    const plan: QueryPlan = {
      intent: "compare",
      metric: "count",
      groupBy: "city",
      filters: EMPTY_FILTERS,
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);
    const expectedCities = dataset.categories.cities.filter((city) =>
      dataset.deals.some(
        (deal) => !deal.analyticsBlocked && deal.city === city,
      ),
    );

    expect(result.groups).toHaveLength(expectedCities.length);
    expect(new Set(result.groups.map((group) => group.key))).toEqual(
      new Set(expectedCities),
    );
    expect(result.sampleSize).toBe(result.matchedCount);
  });

  it("keeps comparison evidence inside the displayed grouping scope", async () => {
    const plan: QueryPlan = {
      intent: "compare",
      metric: "median_price",
      groupBy: "neighborhood",
      filters: EMPTY_FILTERS,
      limit: null,
      reason: "test",
    };

    const result = await runQuery(plan);

    expect(result.groups.length).toBeGreaterThan(12);
    expect(result.sampleSize).toBe(result.matchedCount);
    expect(result.evidence.every((deal) => deal.neighborhood !== null)).toBe(true);
  });
});
