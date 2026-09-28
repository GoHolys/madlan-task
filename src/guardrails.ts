import type { QueryPlan } from "./contracts";
import { canonicalCategory } from "./normalization";

function explicitCityMentions(question: string, cities: string[]): string[] {
  const normalizedQuestion = canonicalCategory(question);

  return cities.filter((city) => {
    const normalizedCity = canonicalCategory(city);

    if (normalizedCity === "תל אביב יפו") {
      return (
        normalizedQuestion.includes("תל אביב") ||
        normalizedQuestion.includes("tel aviv yafo") ||
        /ת[״"]א/.test(question)
      );
    }

    if (normalizedCity === "באר שבע") {
      return (
        normalizedQuestion.includes("באר שבע") ||
        /ב[״"]ש/.test(question)
      );
    }

    if (normalizedCity === "ירושלים") {
      return (
        normalizedQuestion.includes("ירושלים") ||
        normalizedQuestion.includes("jerusalem")
      );
    }

    return normalizedQuestion.includes(normalizedCity);
  });
}

function expectedMetric(question: string): QueryPlan["metric"] | null {
  const perSquareMeter = /למ[״"'׳]?ר|למטר\s+רבוע/.test(question);

  if (question.includes("חציון")) {
    return perSquareMeter ? "median_price_sqm" : "median_price";
  }

  if (question.includes("ממוצע")) {
    return perSquareMeter ? "average_price_sqm" : "average_price";
  }

  if (/כמה\s+עסקאות|מספר\s+עסקאות|כמות\s+עסקאות/.test(question)) {
    return "count";
  }

  return null;
}

function explicitRoomRequest(question: string): {
  value: number;
  mode: "exact" | "min" | "max";
} | null {
  const values = Array.from(
    question.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:חדרים?|חד[׳'"״]?)/g),
    (match) => Number(match[1].replace(",", ".")),
  );
  const uniqueValues = Array.from(new Set(values)).filter(Number.isFinite);

  if (uniqueValues.length !== 1) return null;

  const value = uniqueValues[0];

  if (question.includes("לפחות") || question.includes("ומעלה")) {
    return { value, mode: "min" };
  }

  if (/עד\s+\d/.test(question) || question.includes("לכל היותר")) {
    return { value, mode: "max" };
  }

  return { value, mode: "exact" };
}

function explicitYear(question: string): number | null {
  const years = [
    ...Array.from(
      question.matchAll(/בשנת\s+(20\d{2})/g),
      (match) => Number(match[1]),
    ),
    ...Array.from(
      question.matchAll(/(?:^|\s)ב-\s*(20\d{2})(?=\s|[?.!,]|$)/g),
      (match) => Number(match[1]),
    ),
  ];
  const uniqueYears = Array.from(new Set(years));

  return uniqueYears.length === 1 ? uniqueYears[0] : null;
}

export function planDriftReason(
  question: string,
  plan: QueryPlan,
  cities: string[],
): string | null {
  if (plan.intent === "quality" || plan.intent === "unsupported") {
    return null;
  }

  const plannedCities = plan.filters.cities.map(canonicalCategory);
  for (const city of explicitCityMentions(question, cities)) {
    if (!plannedCities.includes(canonicalCategory(city))) {
      return "פירוש ה-AI לא שמר על העיר שביקשת, ולכן לא הרצתי חישוב.";
    }
  }

  const metric = expectedMetric(question);
  if (metric !== null && plan.metric !== metric) {
    return "פירוש ה-AI שינה את המדד שביקשת, ולכן לא הרצתי חישוב.";
  }

  const roomRequest = explicitRoomRequest(question);
  if (roomRequest) {
    const { roomsMin, roomsMax } = plan.filters;
    const preserved =
      roomRequest.mode === "exact"
        ? roomsMin === roomRequest.value && roomsMax === roomRequest.value
        : roomRequest.mode === "min"
          ? roomsMin === roomRequest.value
          : roomsMax === roomRequest.value;

    if (!preserved) {
      return "פירוש ה-AI לא שמר על מספר החדרים שביקשת, ולכן לא הרצתי חישוב.";
    }
  }

  const year = explicitYear(question);
  if (
    year !== null &&
    (plan.filters.dateFrom !== `${year}-01-01` ||
      plan.filters.dateTo !== `${year}-12-31`)
  ) {
    return "פירוש ה-AI לא שמר על שנת העסקה שביקשת, ולכן לא הרצתי חישוב.";
  }

  return null;
}
