import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type DraftInput = {
  name: string;
  source: string;
  targetUrl: string | null;
  targetTitle: string | null;
  matchPattern: string;
  html: string;
  css: string;
  javascript: string;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isNaN(limitParam)
    ? 10
    : Math.min(Math.max(limitParam, 1), 50);

  try {
    const prisma = await getPrisma();
    const drafts = await prisma.scriptDraft.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: limit,
    });

    return NextResponse.json(
      {
        drafts,
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
            : "Unable to load drafts from Postgres.",
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

  const draft = normalizeDraftInput(payload);

  try {
    const prisma = await getPrisma();
    const created = await prisma.scriptDraft.create({
      data: draft,
    });

    return NextResponse.json(
      {
        draft: created,
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
            : "Unable to save the draft.",
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

function normalizeDraftInput(payload: unknown): DraftInput {
  const value = payload && typeof payload === "object" ? payload : {};
  const record = value as Record<string, unknown>;

  return {
    name: readString(record.name, defaultDraftName()),
    source: readString(record.source, "extension"),
    targetUrl: readOptionalString(record.targetUrl),
    targetTitle: readOptionalString(record.targetTitle),
    matchPattern: readString(record.matchPattern, "*://*/*"),
    html: readText(record.html),
    css: readText(record.css),
    javascript: readText(record.javascript),
  };
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

function defaultDraftName() {
  return `Draft ${new Date().toISOString()}`;
}
