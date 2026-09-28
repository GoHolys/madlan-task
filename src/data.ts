import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

import type { DataIssueCode, QualitySummary } from "./contracts";
import {
  EXPECTED_HEADERS,
  materialSignature,
  normalizeRawRow,
  type NormalizedDeal,
  type RawDeal,
} from "./normalization";

export type Dataset = {
  deals: NormalizedDeal[];
  quality: QualitySummary;
  categories: {
    cities: string[];
    neighborhoods: string[];
    propertyTypes: string[];
  };
};

function canonicalize(rows: NormalizedDeal[]): {
  deals: NormalizedDeal[];
  exactDuplicatesRemoved: number;
  conflictingDealIds: number;
} {
  const byId = new Map<string, NormalizedDeal[]>();

  for (const row of rows) {
    const group = byId.get(row.dealId) ?? [];
    group.push(row);
    byId.set(row.dealId, group);
  }

  const deals: NormalizedDeal[] = [];
  let exactDuplicatesRemoved = 0;
  let conflictingDealIds = 0;

  for (const group of byId.values()) {
    const first = group[0];

    if (group.length === 1 || first.dealId.startsWith("__missing_")) {
      deals.push(first);
      continue;
    }

    if (new Set(group.map(materialSignature)).size === 1) {
      deals.push(first);
      exactDuplicatesRemoved += group.length - 1;
      continue;
    }

    conflictingDealIds += 1;
    deals.push({
      ...first,
      analyticsBlocked: true,
      issues: Array.from(
        new Set<DataIssueCode>([...first.issues, "duplicate_conflict"]),
      ),
    });
  }

  return { deals, exactDuplicatesRemoved, conflictingDealIds };
}

function sortedUnique(values: Array<string | null>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b, "he"));
}

function buildDataset(rawText: string): Dataset {
  const rows = parse(rawText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as RawDeal[];

  if (rows.length === 0) {
    throw new Error("CSV contains no rows");
  }

  const actualHeaders = Object.keys(rows[0]);
  if (
    actualHeaders.length !== EXPECTED_HEADERS.length ||
    EXPECTED_HEADERS.some((header, index) => actualHeaders[index] !== header)
  ) {
    throw new Error(`Unexpected CSV schema: ${actualHeaders.join(", ")}`);
  }

  const canonical = canonicalize(
    rows.map((row, index) => normalizeRawRow(row, index + 2)),
  );

  const issueCounts: QualitySummary["issueCounts"] = {};
  for (const deal of canonical.deals) {
    for (const issue of deal.issues) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    }
  }

  const usableDates = canonical.deals
    .filter(
      (deal) =>
        !deal.analyticsBlocked && deal.dealDateStart && deal.dealDateEnd,
    )
    .flatMap((deal) => [deal.dealDateStart!, deal.dealDateEnd!])
    .sort();

  const quality: QualitySummary = {
    rawRows: rows.length,
    canonicalRows: canonical.deals.length,
    exactDuplicatesRemoved: canonical.exactDuplicatesRemoved,
    conflictingDealIds: canonical.conflictingDealIds,
    priceEligibleRows: canonical.deals.filter(
      (deal) =>
        !deal.analyticsBlocked &&
        deal.priceNis !== null &&
        deal.priceNis >= 100_000 &&
        !deal.suspiciousPrice,
    ).length,
    priceSqmEligibleRows: canonical.deals.filter(
      (deal) =>
        !deal.analyticsBlocked &&
        deal.priceNis !== null &&
        deal.priceNis >= 100_000 &&
        !deal.suspiciousPrice &&
        deal.calculatedPricePerSqm !== null,
    ).length,
    missingPriceRows: canonical.deals.filter(
      (deal) => !deal.analyticsBlocked && deal.priceNis === null,
    ).length,
    missingSizeRows: canonical.deals.filter(
      (deal) => !deal.analyticsBlocked && deal.sizeSqm === null,
    ).length,
    monthOnlyDateRows: canonical.deals.filter(
      (deal) => !deal.analyticsBlocked && deal.datePrecision === "month",
    ).length,
    dateMin: usableDates[0] ?? null,
    dateMax: usableDates.at(-1) ?? null,
    issueCounts,
    fingerprint: createHash("sha256").update(rawText).digest("hex").slice(0, 12),
  };

  return {
    deals: canonical.deals,
    quality,
    categories: {
      cities: sortedUnique(canonical.deals.map((deal) => deal.city)),
      neighborhoods: sortedUnique(
        canonical.deals.map((deal) => deal.neighborhood),
      ),
      propertyTypes: sortedUnique(
        canonical.deals.map((deal) => deal.propertyType),
      ),
    },
  };
}

let datasetPromise: Promise<Dataset> | null = null;

export async function getDataset(): Promise<Dataset> {
  datasetPromise ??= readFile(
    path.join(process.cwd(), "madlan_deals_sample.csv"),
    "utf8",
  ).then(buildDataset);

  return datasetPromise;
}

export const __test = {
  buildDataset,
};
