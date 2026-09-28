import type {
  Metric,
  QueryPlan,
  QueryResult,
  QualitySummary,
} from "./contracts";

const formatter = new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 0,
});

function metricLabel(metric: Metric | null): string {
  switch (metric) {
    case "count":
      return "מספר עסקאות";
    case "median_price":
      return "חציון מחיר";
    case "average_price":
      return "מחיר ממוצע";
    case "median_price_sqm":
      return "חציון מחיר למ״ר";
    case "average_price_sqm":
      return "מחיר ממוצע למ״ר";
    default:
      return "תוצאה";
  }
}

function groupLabel(groupBy: QueryPlan["groupBy"]): string {
  switch (groupBy) {
    case "city":
      return "עיר";
    case "neighborhood":
      return "שכונה";
    case "property_type":
      return "סוג נכס";
    case "year":
      return "שנת עסקה";
    default:
      return "קבוצה";
  }
}

export function appliedFilters(plan: QueryPlan): string[] {
  const output: string[] = [];
  const filters = plan.filters;

  if (filters.cities.length) {
    output.push(`עיר: ${filters.cities.join(", ")}`);
  }

  if (filters.neighborhoods.length) {
    output.push(`שכונה: ${filters.neighborhoods.join(", ")}`);
  }

  if (filters.propertyTypes.length) {
    output.push(`סוג נכס: ${filters.propertyTypes.join(", ")}`);
  }

  if (filters.roomsMin !== null && filters.roomsMax !== null) {
    output.push(
      filters.roomsMin === filters.roomsMax
        ? `${filters.roomsMin} חדרים`
        : `${filters.roomsMin}–${filters.roomsMax} חדרים`,
    );
  } else if (filters.roomsMin !== null) {
    output.push(`לפחות ${filters.roomsMin} חדרים`);
  } else if (filters.roomsMax !== null) {
    output.push(`עד ${filters.roomsMax} חדרים`);
  }

  if (filters.dateFrom !== null || filters.dateTo !== null) {
    output.push(
      `תאריך עסקה: ${filters.dateFrom ?? "התחלה"} עד ${filters.dateTo ?? "סוף"}`,
    );
  }

  return output;
}

export function warnings(
  plan: QueryPlan,
  result: QueryResult,
  quality: QualitySummary,
): string[] {
  const output = [
    "המספרים מתארים רק את קובץ המדגם שסופק ואינם טענה על כלל השוק.",
  ];

  if (result.sampleSize > 0 && result.sampleSize < 5) {
    output.push(
      "המדגם קטן מ-5 עסקאות, ולכן כדאי לפרש את התוצאה בזהירות.",
    );
  }

  if (result.excluded.total > 0) {
    output.push(
      `${result.excluded.total} רשומות בתחום הבקשה הוחרגו בגלל איכות נתונים, סתירה או דיוק תאריך.`,
    );
  }

  if (result.excluded.ambiguousMonthDate > 0) {
    output.push(
      `${result.excluded.ambiguousMonthDate} רשומות עם תאריך ברמת חודש חפפו חלקית לטווח שביקשת והוחרגו במקום להמציא יום עסקה.`,
    );
  }

  if (
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm"
  ) {
    output.push(
      "מחיר למ״ר מחושב מחדש כמחיר ÷ שטח; הערך שסופק בקובץ נשמר רק לבקרת איכות.",
    );
  }

  if (
    plan.filters.dateFrom !== null &&
    quality.dateMin !== null &&
    plan.filters.dateFrom < quality.dateMin
  ) {
    output.push(
      `טווח הבקשה מתחיל לפני תאריך העסקה המוקדם במדגם (${quality.dateMin}).`,
    );
  }

  if (
    plan.filters.dateTo !== null &&
    quality.dateMax !== null &&
    plan.filters.dateTo > quality.dateMax
  ) {
    output.push(
      `טווח הבקשה מסתיים אחרי תאריך העסקה המאוחר במדגם (${quality.dateMax}).`,
    );
  }

  if (result.matchedCount === 0 && plan.intent !== "quality") {
    output.push(
      "לא נמצאו עסקאות שעומדות בכל התנאים לאחר בדיקות האיכות.",
    );
  }

  return output;
}

export function presentation(
  plan: QueryPlan,
  result: QueryResult,
  quality: QualitySummary,
): { headline: string; summary: string } {
  if (plan.intent === "quality") {
    return {
      headline: "איכות קובץ המדגם",
      summary: `${quality.rawRows} שורות מקור, ${quality.canonicalRows} עסקאות קנוניות לאחר טיפול בכפילויות; ${quality.conflictingDealIds} מזהי עסקה סותרים נחסמו מחישובים.`,
    };
  }

  if (plan.intent === "list") {
    return {
      headline: `${formatter.format(result.matchedCount)} עסקאות תואמות`,
      summary: result.evidenceTruncated
        ? `מוצגות ${result.evidence.length} העסקאות האחרונות מתוך ${formatter.format(result.matchedCount)}.`
        : "כל העסקאות התואמות במדגם מוצגות.",
    };
  }

  if (plan.intent === "compare") {
    return {
      headline: `${metricLabel(plan.metric)} לפי ${groupLabel(plan.groupBy)}`,
      summary: `ההשוואה מבוססת על ${formatter.format(result.sampleSize)} עסקאות ב-${result.groups.length} קבוצות.`,
    };
  }

  if (result.value === null) {
    return {
      headline: "אין מספיק נתונים לחישוב",
      summary:
        "לא נמצא ערך תקף שעומד בכל התנאים ובכללי איכות הנתונים.",
    };
  }

  if (plan.metric === "count") {
    return {
      headline: `${formatter.format(result.value)} עסקאות`,
      summary:
        "הספירה מתבצעת ישירות על הרשומות שעומדות בכל המסננים.",
    };
  }

  const suffix =
    plan.metric === "median_price_sqm" ||
    plan.metric === "average_price_sqm"
      ? " ₪ למ״ר"
      : " ₪";

  return {
    headline: `${metricLabel(plan.metric)}: ${formatter.format(result.value)}${suffix}`,
    summary: `החישוב מבוסס על ${formatter.format(result.sampleSize)} עסקאות תקינות במדגם.`,
  };
}
