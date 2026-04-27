import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextRequest, NextResponse } from "next/server";
import {
  VIBE_PILOT_SYSTEM_PROMPT,
  vibePilotAssistantInputSchema,
  vibePilotAssistantResponseSchema,
} from "@/lib/vibe-pilot-assistant";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured on the web backend.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      },
    );
  }

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

  const parsedInput = vibePilotAssistantInputSchema.safeParse(payload);
  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error: "Assistant request payload was invalid.",
        details: parsedInput.error.flatten(),
      },
      {
        status: 400,
        headers: CORS_HEADERS,
      },
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    const response = await openai.responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5",
      store: false,
      input: [
        {
          role: "system",
          content: VIBE_PILOT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(parsedInput.data, null, 2),
        },
      ],
      text: {
        format: zodTextFormat(
          vibePilotAssistantResponseSchema,
          "vibe_pilot_assistant_response",
        ),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The model did not return a structured assistant result.");
    }

    return NextResponse.json(response.output_parsed, {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "OpenAI failed to generate a draft.",
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
