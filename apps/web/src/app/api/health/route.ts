import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET() {
  try {
    const prisma = await getPrisma();
    const ruleCount = await prisma.rule.count();

    return NextResponse.json(
      {
        status: "ok",
        app: "vibe-pilot-web",
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          ruleCount,
        },
      },
      {
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        app: "vibe-pilot-web",
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown database connection error.",
        },
      },
      {
        status: 503,
        headers: CORS_HEADERS,
      },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
