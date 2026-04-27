import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type RuleInput = {
  name: string;
  targetUrl: string | null;
  targetTitle: string | null;
  matchPattern: string;
  html: string;
  css: string;
  javascript: string;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const limit = Number.isNaN(limitParam)
    ? 25
    : Math.min(Math.max(limitParam, 1), 100);

  try {
    const prisma = await getPrisma();
    const rules = await prisma.rule.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: limit,
    });

    return NextResponse.json(
      {
        rules,
      },
      {
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load rules from Postgres.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be valid JSON.",
      },
      {
        status: 400,
        headers: CORS_HEADERS,
      },
    );
  }

  let rule: RuleInput;

  try {
    rule = normalizeRuleInput(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Rule payload was invalid.",
      },
      {
        status: 400,
        headers: CORS_HEADERS,
      },
    );
  }

  try {
    const prisma = await getPrisma();
    const created = await prisma.rule.create({
      data: rule,
    });

    return NextResponse.json(
      {
        rule: created,
      },
      {
        status: 201,
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the rule.",
      },
      {
        status: 500,
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

function normalizeRuleInput(payload: unknown): RuleInput {
  const value = payload && typeof payload === "object" ? payload : {};
  const record = value as Record<string, unknown>;

  return {
    name: readRequiredString(record.name, "Rule name is required."),
    targetUrl: readOptionalString(record.targetUrl),
    targetTitle: readOptionalString(record.targetTitle),
    matchPattern: readString(record.matchPattern, "*://*/*"),
    html: readText(record.html),
    css: readText(record.css),
    javascript: readText(record.javascript),
  };
}

function readRequiredString(value: unknown, errorMessage: string) {
  if (typeof value !== "string") {
    throw new Error(errorMessage);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(errorMessage);
  }

  return trimmed;
}

function readString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function readOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readText(value: unknown) {
  return typeof value === "string" ? value : "";
}
