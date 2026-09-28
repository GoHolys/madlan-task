import { NextResponse } from "next/server";

import { getDatabaseStatus } from "@/src/database";
import { getConfiguredProvider } from "@/src/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getDatabaseStatus();
    const modelProvider = getConfiguredProvider();

    const ready = modelProvider !== null;

    return NextResponse.json(
      {
        ok: ready,
        dataset: status,
        modelConfigured: ready,
        modelProvider,
        failureDemoEnabled: process.env.ENABLE_FAILURE_DEMO === "true",
      },
      {
        status: ready ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "health_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return NextResponse.json(
      { ok: false, message: "Dataset initialization failed" },
      { status: 503 },
    );
  }
}
