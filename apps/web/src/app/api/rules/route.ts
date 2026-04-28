import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import {
  normalizeRuleInput as parseRuleInput,
  type RuleInput,
  serializeRule,
  serializeStoredRuleInput,
} from "@/lib/rule-persistence";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
        rules: rules.map((rule) => serializeRule(rule, { includeChat: false })),
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
    rule = parseRuleInput(payload);
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
      data: serializeStoredRuleInput(rule),
    });

    return NextResponse.json(
      {
        rule: serializeRule(created),
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
