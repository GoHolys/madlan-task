import {
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";

import { getDataset, type Dataset } from "./data";
import type { NormalizedDeal } from "./normalization";

export type DatabaseContext = {
  instance: DuckDBInstance;
  dataset: Dataset;
};

const CREATE_TABLE = `
CREATE TABLE deals (
  deal_id VARCHAR NOT NULL,
  city VARCHAR NOT NULL,
  neighborhood VARCHAR,
  street VARCHAR,
  property_type VARCHAR NOT NULL,
  rooms DOUBLE,
  size_sqm DOUBLE,
  deal_date_start VARCHAR,
  deal_date_end VARCHAR,
  deal_date_raw VARCHAR,
  date_precision VARCHAR,
  deal_year INTEGER,
  price_nis DOUBLE,
  calculated_price_per_sqm DOUBLE,
  source VARCHAR NOT NULL,
  analytics_blocked BOOLEAN NOT NULL,
  suspicious_price BOOLEAN NOT NULL,
  issues_json VARCHAR NOT NULL
)
`;

const INSERT_ROW = `
INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function values(deal: NormalizedDeal): DuckDBValue[] {
  return [
    deal.dealId,
    deal.city,
    deal.neighborhood,
    deal.street,
    deal.propertyType,
    deal.rooms,
    deal.sizeSqm,
    deal.dealDateStart,
    deal.dealDateEnd,
    deal.dealDateRaw,
    deal.datePrecision,
    deal.dealYear,
    deal.priceNis,
    deal.calculatedPricePerSqm,
    deal.source,
    deal.analyticsBlocked,
    deal.suspiciousPrice,
    JSON.stringify(deal.issues),
  ];
}

let contextPromise: Promise<DatabaseContext> | null = null;

async function initialize(): Promise<DatabaseContext> {
  const dataset = await getDataset();
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await connection.run(CREATE_TABLE);
    await connection.run("BEGIN TRANSACTION");

    try {
      for (const deal of dataset.deals) {
        await connection.run(INSERT_ROW, values(deal));
      }
      await connection.run("COMMIT");
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  } finally {
    connection.closeSync();
  }

  return { instance, dataset };
}

export async function getDatabaseContext(): Promise<DatabaseContext> {
  contextPromise ??= initialize();
  return contextPromise;
}

export async function getDatabaseStatus() {
  const { dataset } = await getDatabaseContext();

  return {
    quality: dataset.quality,
    categories: {
      cities: dataset.categories.cities.length,
      neighborhoods: dataset.categories.neighborhoods.length,
      propertyTypes: dataset.categories.propertyTypes.length,
    },
  };
}
