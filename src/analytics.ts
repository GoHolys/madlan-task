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

const METRIC_SQL: Record<Metric, string> = {
  count: "COUNT(*)",
  median_price: "MEDIAN(price_nis)",
  average_price: "AVG(price_nis)",
  median_price_sqm: "MEDIAN(calculated_price_per_sqm)",
  average_price_sqm: "AVG(calculated_price_per_sqm)",
};

const GROUP_SQL: Record<GroupBy, { value: string; present: string }> = {
  city: { value: "city", present: "city <> ''" },
  neighborhood: {
    value: "neighborhood",
    present: "neighborhood IS NOT NULL",
  },
  property_type: {
    value: "property_type",
    present: "property_type <> ''",
  },
  year: {
    value: "CAST(deal_year AS VARCHAR)",
    present: "deal_year IS NOT NULL",
  },
};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

async function query(connection: DuckDBConnection, sql: Sql): Promise<Row[]> {
  return (await connection.runAndReadAll(sql.text, sql.params))
    .getRowObjectsJson() as Row[];
}

function where(
  plan: QueryPlan,
  options: {
    includeBlocked?: boolean;
    includeDate?: boolean;
    includeEligibility?: boolean;
  } = {},
): Sql {
  const clauses: string[] = [];
  const params: DuckDBValue[] = [];
  const add = (clause: string, ...values: DuckDBValue[]) => {
    clauses.push(clause);
    params.push(...values);
  };
  const addList = (column: string, values: string[]) => {
    if (!values.length) return;
    add(`${column} IN (${values.map(() => "?").join(", ")})`, ...values);
  };

  if (!options.includeBlocked) add("analytics_blocked = FALSE");

  addList("city", plan.filters.cities);
  addList("neighborhood", plan.filters.neighborhoods);
  addList("property_type", plan.filters.propertyTypes);

  if (plan.filters.roomsMin !== null) {
    add("rooms IS NOT NULL AND rooms >= ?", plan.filters.roomsMin);
  }
  if (plan.filters.roomsMax !== null) {
    add("rooms IS NOT NULL AND rooms <= ?", plan.filters.roomsMax);
  }

  if (options.includeDate !== false) {
    if (plan.filters.dateFrom !== null) {
      add(
        "deal_date_start IS NOT NULL AND deal_date_start >= ?",
        plan.filters.dateFrom,
      );
    }
    if (plan.filters.dateTo !== null) {
      add(
        "deal_date_end IS NOT NULL AND deal_date_end <= ?",
        plan.filters.dateTo,
      );
    }
  }

  if (options.includeEligibility !== false) {
    if (plan.metric !== null && plan.metric !== "count") {
      add("price_nis IS NOT NULL");
      add("suspicious_price = FALSE");

      if (
        plan.metric === "median_price_sqm" ||
        plan.metric === "average_price_sqm"
      ) {
        add("calculated_price_per_sqm IS NOT NULL");
      }
    }

    if (plan.intent === "compare" && plan.groupBy) {
      add(GROUP_SQL[plan.groupBy].present);
    }
  }

  return {
    text: clauses.length ? clauses.join(" AND ") : "TRUE",
    params,
  };
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
    dealId: asString(row.deal_id),
    city: asString(row.city),
    neighborhood:
      typeof row.neighborhood === "string" ? row.neighborhood : null,
    street: typeof row.street === "string" ? row.street : null,
    propertyType: asString(row.property_type),
    rooms: asNumber(row.rooms),
    sizeSqm: asNumber(row.size_sqm),
    dealDate:
      typeof row.deal_date_start === "string" ? row.deal_date_start : null,
    dealDateRaw:
      typeof row.deal_date_raw === "string" ? row.deal_date_raw : null,
    priceNis: asNumber(row.price_nis),
    pricePerSqm: asNumber(row.calculated_price_per_sqm),
    source: asString(row.source),
    issues,
  };
}

async function ambiguousMonthDates(
  connection: DuckDBConnection,
  plan: QueryPlan,
): Promise<number> {
  const { dateFrom, dateTo } = plan.filters;
  if (!dateFrom && !dateTo) return 0;

  const base = where(plan, {
    includeDate: false,
    includeEligibility: false,
  });

  const overlap = [
    base.text,
    "date_precision = 'month'",
    "deal_date_start IS NOT NULL",
    "deal_date_end IS NOT NULL",
  ];
  const overlapParams = [...base.params];
  const contained: string[] = [];
  const containedParams: DuckDBValue[] = [];

  if (dateFrom) {
    overlap.push("deal_date_end >= ?");
    overlapParams.push(dateFrom);
    contained.push("deal_date_start >= ?");
    containedParams.push(dateFrom);
  }

  if (dateTo) {
    overlap.push("deal_date_start <= ?");
    overlapParams.push(dateTo);
    contained.push("deal_date_end <= ?");
    containedParams.push(dateTo);
  }

  const [row] = await query(connection, {
    text: `
      SELECT COUNT(*) AS count
      FROM deals
      WHERE ${overlap.join(" AND ")}
        AND NOT (${contained.join(" AND ")})
    `,
    params: [...overlapParams, ...containedParams],
  });

  return asNumber(row?.count) ?? 0;
}

async function exclusions(
  connection: DuckDBConnection,
  plan: QueryPlan,
): Promise<QueryResult["excluded"]> {
  const scope = where(plan, {
    includeBlocked: true,
    includeEligibility: false,
  });
  const priceMetric = plan.metric !== null && plan.metric !== "count";
  const sqmMetric =
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm";

  const [rows, ambiguous] = await Promise.all([
    query(connection, {
      text: `
        SELECT
          SUM(CASE WHEN analytics_blocked THEN 1 ELSE 0 END) AS blocked,
          SUM(CASE
            WHEN analytics_blocked = FALSE
              AND ${priceMetric ? "(price_nis IS NULL OR suspicious_price = TRUE)" : "FALSE"}
            THEN 1 ELSE 0 END
          ) AS bad_price,
          SUM(CASE
            WHEN analytics_blocked = FALSE
              AND ${sqmMetric ? "price_nis IS NOT NULL AND suspicious_price = FALSE AND calculated_price_per_sqm IS NULL" : "FALSE"}
            THEN 1 ELSE 0 END
          ) AS missing_size
        FROM deals
        WHERE ${scope.text}
      `,
      params: scope.params,
    }),
    ambiguousMonthDates(connection, plan),
  ]);

  const row = rows[0];
  const blockedRows = asNumber(row?.blocked) ?? 0;
  const suspiciousOrMissingPrice = asNumber(row?.bad_price) ?? 0;
  const missingSize = asNumber(row?.missing_size) ?? 0;

  return {
    total:
      blockedRows +
      suspiciousOrMissingPrice +
      missingSize +
      ambiguous,
    blockedRows,
    suspiciousOrMissingPrice,
    missingSize,
    ambiguousMonthDate: ambiguous,
  };
}

async function evidence(
  connection: DuckDBConnection,
  plan: QueryPlan,
  scope: Sql,
  matchedCount: number,
): Promise<{ rows: DealEvidence[]; truncated: boolean }> {
  const limit = plan.intent === "list" ? plan.limit ?? 10 : 8;
  const rows = (
    await query(connection, {
      text: `
        SELECT
          deal_id, city, neighborhood, street, property_type, rooms, size_sqm,
          deal_date_start, deal_date_raw, price_nis, calculated_price_per_sqm,
          source, issues_json
        FROM deals
        WHERE ${scope.text}
        ORDER BY deal_date_start DESC NULLS LAST, price_nis DESC NULLS LAST
        LIMIT ?
      `,
      params: [...scope.params, limit],
    })
  ).map(toEvidence);

  return { rows, truncated: matchedCount > rows.length };
}

async function sources(
  connection: DuckDBConnection,
  scope: Sql,
): Promise<Record<string, number>> {
  const rows = await query(connection, {
    text: `
      SELECT source, COUNT(*) AS count
      FROM deals
      WHERE ${scope.text}
      GROUP BY source
      ORDER BY count DESC, source
    `,
    params: scope.params,
  });

  return Object.fromEntries(
    rows.map((row) => [
      asString(row.source) || "לא ידוע",
      asNumber(row.count) ?? 0,
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
      excluded: {
        total: 0,
        blockedRows: 0,
        suspiciousOrMissingPrice: 0,
        missingSize: 0,
        ambiguousMonthDate: 0,
      },
    };
  }

  if (plan.intent === "unsupported") {
    throw new Error("Unsupported plan reached query execution");
  }

  const connection = await instance.connect();

  try {
    const scope = where(plan);
    let value: number | null = null;
    let matchedCount = 0;
    let sampleSize = 0;
    let groups: QueryResult["groups"] = [];

    if (plan.intent === "aggregate") {
      if (!plan.metric) throw new Error("Aggregate plan has no metric");

      const [row] = await query(connection, {
        text: `
          SELECT
            ${METRIC_SQL[plan.metric]} AS value,
            COUNT(*) AS sample_size
          FROM deals
          WHERE ${scope.text}
        `,
        params: scope.params,
      });

      value = asNumber(row?.value);
      sampleSize = asNumber(row?.sample_size) ?? 0;
      matchedCount = sampleSize;
    }

    if (plan.intent === "compare") {
      if (!plan.metric || !plan.groupBy) {
        throw new Error("Comparison plan is incomplete");
      }

      const group = GROUP_SQL[plan.groupBy];
      const rows = await query(connection, {
        text: `
          SELECT
            ${group.value} AS group_key,
            ${METRIC_SQL[plan.metric]} AS value,
            COUNT(*) AS sample_size
          FROM deals
          WHERE ${scope.text}
          GROUP BY 1
          ORDER BY sample_size DESC, group_key
        `,
        params: scope.params,
      });

      groups = rows.map((row) => ({
        key: asString(row.group_key) || "לא ידוע",
        value: asNumber(row.value),
        sampleSize: asNumber(row.sample_size) ?? 0,
      }));
      sampleSize = groups.reduce((sum, group) => sum + group.sampleSize, 0);
      matchedCount = sampleSize;
    }

    if (plan.intent === "list") {
      const [row] = await query(connection, {
        text: `SELECT COUNT(*) AS count FROM deals WHERE ${scope.text}`,
        params: scope.params,
      });
      matchedCount = asNumber(row?.count) ?? 0;
      sampleSize = matchedCount;
    }

    const [evidenceResult, sourceBreakdown, excluded] = await Promise.all([
      evidence(connection, plan, scope, matchedCount),
      sources(connection, scope),
      exclusions(connection, plan),
    ]);

    return {
      intent: plan.intent,
      metric: plan.metric,
      value,
      sampleSize,
      matchedCount,
      groups,
      evidence: evidenceResult.rows,
      evidenceTruncated: evidenceResult.truncated,
      sourceBreakdown,
      excluded,
    };
  } finally {
    connection.closeSync();
  }
}
