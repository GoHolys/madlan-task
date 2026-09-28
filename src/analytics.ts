import type {
  DuckDBConnection,
  DuckDBValue,
} from "@duckdb/node-api";

import type {
  DealEvidence,
  GroupBy,
  Metric,
  QueryPlan,
  QueryResult,
} from "./contracts";
import { getDatabaseContext } from "./database";

type Row = Record<string, unknown>;
type Sql = { text: string; params: DuckDBValue[] };

function inClause(
  column: string,
  values: string[],
  clauses: string[],
  params: DuckDBValue[],
): void {
  if (!values.length) return;

  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function scopeWhere(
  plan: QueryPlan,
  options: { includeBlocked?: boolean; includeDate?: boolean } = {},
): Sql {
  const clauses: string[] = [];
  const params: DuckDBValue[] = [];

  if (!options.includeBlocked) {
    clauses.push("analytics_blocked = FALSE");
  }

  inClause("city", plan.filters.cities, clauses, params);
  inClause("neighborhood", plan.filters.neighborhoods, clauses, params);
  inClause("property_type", plan.filters.propertyTypes, clauses, params);

  if (plan.filters.roomsMin !== null) {
    clauses.push("rooms IS NOT NULL AND rooms >= ?");
    params.push(plan.filters.roomsMin);
  }

  if (plan.filters.roomsMax !== null) {
    clauses.push("rooms IS NOT NULL AND rooms <= ?");
    params.push(plan.filters.roomsMax);
  }

  if (options.includeDate !== false) {
    if (plan.filters.dateFrom !== null) {
      clauses.push("deal_date_start IS NOT NULL AND deal_date_start >= ?");
      params.push(plan.filters.dateFrom);
    }

    if (plan.filters.dateTo !== null) {
      clauses.push("deal_date_end IS NOT NULL AND deal_date_end <= ?");
      params.push(plan.filters.dateTo);
    }
  }

  return {
    text: clauses.length ? clauses.join(" AND ") : "TRUE",
    params,
  };
}

function metricEligibility(metric: Metric | null): string[] {
  if (metric === null || metric === "count") return [];

  const rules = ["price_nis IS NOT NULL", "suspicious_price = FALSE"];

  if (metric === "median_price_sqm" || metric === "average_price_sqm") {
    rules.push("calculated_price_per_sqm IS NOT NULL");
  }

  return rules;
}

const METRIC_SQL: Record<Metric, string> = {
  count: "COUNT(*)",
  median_price: "MEDIAN(price_nis)",
  average_price: "AVG(price_nis)",
  median_price_sqm: "MEDIAN(calculated_price_per_sqm)",
  average_price_sqm: "AVG(calculated_price_per_sqm)",
};

const GROUP_SQL: Record<GroupBy, { select: string; notNull: string }> = {
  city: { select: "city", notNull: "city <> ''" },
  neighborhood: {
    select: "neighborhood",
    notNull: "neighborhood IS NOT NULL",
  },
  property_type: {
    select: "property_type",
    notNull: "property_type <> ''",
  },
  year: {
    select: "CAST(deal_year AS VARCHAR)",
    notNull: "deal_year IS NOT NULL",
  },
};

function eligibleWhere(plan: QueryPlan): Sql {
  const scope = scopeWhere(plan);
  const rules = [...metricEligibility(plan.metric)];

  if (plan.intent === "compare" && plan.groupBy !== null) {
    rules.push(GROUP_SQL[plan.groupBy].notNull);
  }

  return {
    text: [scope.text, ...rules].join(" AND "),
    params: scope.params,
  };
}

async function rows(connection: DuckDBConnection, sql: Sql): Promise<Row[]> {
  const reader = await connection.runAndReadAll(sql.text, sql.params);
  return reader.getRowObjectsJson() as Row[];
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toEvidence(row: Row): DealEvidence {
  let issues: DealEvidence["issues"] = [];

  if (typeof row.issues_json === "string") {
    try {
      issues = JSON.parse(row.issues_json) as DealEvidence["issues"];
    } catch {
      issues = [];
    }
  }

  return {
    dealId: stringValue(row.deal_id),
    city: stringValue(row.city),
    neighborhood:
      typeof row.neighborhood === "string" ? row.neighborhood : null,
    street: typeof row.street === "string" ? row.street : null,
    propertyType: stringValue(row.property_type),
    rooms: numberValue(row.rooms),
    sizeSqm: numberValue(row.size_sqm),
    dealDate:
      typeof row.deal_date_start === "string" ? row.deal_date_start : null,
    dealDateRaw:
      typeof row.deal_date_raw === "string" ? row.deal_date_raw : null,
    priceNis: numberValue(row.price_nis),
    pricePerSqm: numberValue(row.calculated_price_per_sqm),
    source: stringValue(row.source),
    issues,
  };
}

function emptyExclusions(): QueryResult["excluded"] {
  return {
    total: 0,
    blockedRows: 0,
    suspiciousOrMissingPrice: 0,
    missingSize: 0,
    ambiguousMonthDate: 0,
  };
}

async function countAmbiguousMonthDates(
  connection: DuckDBConnection,
  plan: QueryPlan,
): Promise<number> {
  const { dateFrom, dateTo } = plan.filters;
  if (dateFrom === null && dateTo === null) return 0;

  const base = scopeWhere(plan, {
    includeBlocked: false,
    includeDate: false,
  });
  const overlap = [
    base.text,
    "date_precision = 'month'",
    "deal_date_start IS NOT NULL",
    "deal_date_end IS NOT NULL",
  ];
  const overlapParams: DuckDBValue[] = [...base.params];
  const containment: string[] = [];
  const containmentParams: DuckDBValue[] = [];

  if (dateFrom !== null) {
    overlap.push("deal_date_end >= ?");
    overlapParams.push(dateFrom);
    containment.push("deal_date_start >= ?");
    containmentParams.push(dateFrom);
  }

  if (dateTo !== null) {
    overlap.push("deal_date_start <= ?");
    overlapParams.push(dateTo);
    containment.push("deal_date_end <= ?");
    containmentParams.push(dateTo);
  }

  const [row] = await rows(connection, {
    text: `
      SELECT COUNT(*) AS count
      FROM deals
      WHERE ${overlap.join(" AND ")}
        AND NOT (${containment.join(" AND ")})
    `,
    params: [...overlapParams, ...containmentParams],
  });

  return numberValue(row?.count) ?? 0;
}

async function exclusionSummary(
  connection: DuckDBConnection,
  plan: QueryPlan,
): Promise<QueryResult["excluded"]> {
  const scope = scopeWhere(plan, { includeBlocked: true });
  const isPriceMetric = plan.metric !== null && plan.metric !== "count";
  const isSqmMetric =
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm";

  const [summary] = await rows(connection, {
    text: `
      SELECT
        SUM(CASE WHEN analytics_blocked THEN 1 ELSE 0 END) AS blocked_rows,
        SUM(CASE
          WHEN analytics_blocked = FALSE
            AND ${isPriceMetric ? "(price_nis IS NULL OR suspicious_price = TRUE)" : "FALSE"}
          THEN 1 ELSE 0 END
        ) AS bad_price_rows,
        SUM(CASE
          WHEN analytics_blocked = FALSE
            AND ${isSqmMetric ? "price_nis IS NOT NULL AND suspicious_price = FALSE AND calculated_price_per_sqm IS NULL" : "FALSE"}
          THEN 1 ELSE 0 END
        ) AS missing_size_rows
      FROM deals
      WHERE ${scope.text}
    `,
    params: scope.params,
  });

  const excluded: QueryResult["excluded"] = {
    total: 0,
    blockedRows: numberValue(summary?.blocked_rows) ?? 0,
    suspiciousOrMissingPrice: numberValue(summary?.bad_price_rows) ?? 0,
    missingSize: numberValue(summary?.missing_size_rows) ?? 0,
    ambiguousMonthDate: await countAmbiguousMonthDates(connection, plan),
  };

  excluded.total =
    excluded.blockedRows +
    excluded.suspiciousOrMissingPrice +
    excluded.missingSize +
    excluded.ambiguousMonthDate;

  return excluded;
}

async function loadEvidence(
  connection: DuckDBConnection,
  plan: QueryPlan,
  where: Sql,
  matchedCount: number,
): Promise<{ evidence: DealEvidence[]; truncated: boolean }> {
  const limit = plan.intent === "list" ? plan.limit ?? 10 : 8;

  const evidence = (
    await rows(connection, {
      text: `
        SELECT
          deal_id, city, neighborhood, street, property_type, rooms, size_sqm,
          deal_date_start, deal_date_raw, price_nis, calculated_price_per_sqm,
          source, issues_json
        FROM deals
        WHERE ${where.text}
        ORDER BY deal_date_start DESC NULLS LAST, price_nis DESC NULLS LAST
        LIMIT ?
      `,
      params: [...where.params, limit],
    })
  ).map(toEvidence);

  return {
    evidence,
    truncated: matchedCount > evidence.length,
  };
}

async function sourceBreakdown(
  connection: DuckDBConnection,
  where: Sql,
): Promise<Record<string, number>> {
  const sourceRows = await rows(connection, {
    text: `
      SELECT source, COUNT(*) AS count
      FROM deals
      WHERE ${where.text}
      GROUP BY source
      ORDER BY count DESC, source
    `,
    params: where.params,
  });

  return Object.fromEntries(
    sourceRows.map((row) => [
      stringValue(row.source) || "לא ידוע",
      numberValue(row.count) ?? 0,
    ]),
  );
}

export async function runQuery(plan: QueryPlan): Promise<QueryResult> {
  const { instance, dataset } = await getDatabaseContext();

  if (plan.intent === "quality") {
    return {
      intent: "quality",
      metric: null,
      value: null,
      sampleSize: dataset.quality.canonicalRows,
      matchedCount: dataset.quality.canonicalRows,
      groups: [],
      evidence: [],
      evidenceTruncated: false,
      sourceBreakdown: {},
      excluded: emptyExclusions(),
    };
  }

  if (plan.intent === "unsupported") {
    throw new Error("Unsupported plan reached query execution");
  }

  const connection = await instance.connect();

  try {
    const where = eligibleWhere(plan);
    const [count] = await rows(connection, {
      text: `SELECT COUNT(*) AS count FROM deals WHERE ${where.text}`,
      params: where.params,
    });
    const matchedCount = numberValue(count?.count) ?? 0;

    let value: number | null = null;
    let sampleSize = matchedCount;
    let groups: QueryResult["groups"] = [];

    if (plan.intent === "aggregate") {
      if (plan.metric === null) {
        throw new Error("Aggregate plan has no metric");
      }

      const [aggregate] = await rows(connection, {
        text: `
          SELECT
            ${METRIC_SQL[plan.metric]} AS value,
            COUNT(*) AS sample_size
          FROM deals
          WHERE ${where.text}
        `,
        params: where.params,
      });

      value = numberValue(aggregate?.value);
      sampleSize = numberValue(aggregate?.sample_size) ?? 0;
    }

    if (plan.intent === "compare") {
      if (plan.metric === null || plan.groupBy === null) {
        throw new Error("Comparison plan is incomplete");
      }

      const group = GROUP_SQL[plan.groupBy];
      const groupRows = await rows(connection, {
        text: `
          SELECT
            ${group.select} AS group_key,
            ${METRIC_SQL[plan.metric]} AS value,
            COUNT(*) AS sample_size
          FROM deals
          WHERE ${where.text}
          GROUP BY 1
          ORDER BY sample_size DESC, group_key
        `,
        params: where.params,
      });

      groups = groupRows.map((row) => ({
        key: stringValue(row.group_key) || "לא ידוע",
        value: numberValue(row.value),
        sampleSize: numberValue(row.sample_size) ?? 0,
      }));
      sampleSize = groups.reduce((sum, groupRow) => sum + groupRow.sampleSize, 0);
    }

    const [evidenceResult, sources, excluded] = await Promise.all([
      loadEvidence(connection, plan, where, matchedCount),
      sourceBreakdown(connection, where),
      exclusionSummary(connection, plan),
    ]);

    return {
      intent: plan.intent,
      metric: plan.metric,
      value,
      sampleSize,
      matchedCount,
      groups,
      evidence: evidenceResult.evidence,
      evidenceTruncated: evidenceResult.truncated,
      sourceBreakdown: sources,
      excluded,
    };
  } finally {
    connection.closeSync();
  }
}
