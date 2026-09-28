import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AskRequestSchema } from "@/src/contracts";
import { answerQuestion } from "@/src/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function allowed(request: NextRequest): boolean {
  const now = Date.now();

  if (buckets.size > 1_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const key = forwarded?.split(",")[0]?.trim() || "unknown";
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (bucket.count >= MAX_REQUESTS) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (!allowed(request)) {
    return NextResponse.json(
      {
        status: "error",
        requestId,
        code: "RATE_LIMITED",
        message: "נשלחו יותר מדי בקשות בדקה האחרונה. נסו שוב בעוד רגע.",
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: "error",
        requestId,
        code: "BAD_REQUEST",
        message: "גוף הבקשה אינו JSON תקין.",
      },
      { status: 400 },
    );
  }

  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        requestId,
        code: "BAD_REQUEST",
        message: "השאלה חייבת להכיל בין 2 ל-500 תווים.",
      },
      { status: 400 },
    );
  }

  const answer = await answerQuestion({
    question: parsed.data.question,
    requestId,
    simulateModelFailure:
      process.env.ENABLE_FAILURE_DEMO === "true" &&
      parsed.data.simulateModelFailure,
  });

  console.info(
    JSON.stringify({
      event: "ask_completed",
      requestId,
      status: answer.status,
      code: answer.status === "error" ? answer.code : undefined,
      durationMs: Date.now() - startedAt,
    }),
  );

  return NextResponse.json(answer, {
    status: answer.status === "error" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
