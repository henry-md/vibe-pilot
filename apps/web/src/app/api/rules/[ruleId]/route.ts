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
  "Access-Control-Allow-Methods": "GET,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ ruleId: string }> },
) {
  const { ruleId } = await context.params;

  try {
    const prisma = await getPrisma();
    const rule = await prisma.rule.findUnique({
      where: {
        id: ruleId,
      },
    });

    if (!rule) {
      return NextResponse.json(
        {
          error: "Rule not found.",
        },
        {
          status: 404,
          headers: CORS_HEADERS,
        },
      );
    }

    return NextResponse.json(
      {
        rule: serializeRule(rule),
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
            : "Unable to load the rule.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ ruleId: string }> },
) {
  const { ruleId } = await context.params;

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
    const updated = await prisma.rule.update({
      where: {
        id: ruleId,
      },
      data: serializeStoredRuleInput(rule),
    });

    return NextResponse.json(
      {
        rule: serializeRule(updated),
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
            : "Unable to update the rule.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ ruleId: string }> },
) {
  const { ruleId } = await context.params;

  try {
    const prisma = await getPrisma();
    await prisma.rule.delete({
      where: {
        id: ruleId,
      },
    });

    return NextResponse.json(
      {
        deleted: true,
        ruleId,
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
            : "Unable to delete the rule.",
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
