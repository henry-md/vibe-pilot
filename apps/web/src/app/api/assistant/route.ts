import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  shouldStoreAssistantResponses,
  tryParseAssistantToolArguments,
  type VibePilotAssistantRequest,
  VIBE_PILOT_RESPONSE_TOOLS,
  VIBE_PILOT_SYSTEM_PROMPT,
  vibePilotAssistantRequestSchema,
  vibePilotAssistantResponseSchema,
} from "@/lib/vibe-pilot-assistant";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_MODEL = "gpt-5";
const ASSISTANT_DEBUG_ENABLED =
  process.env.VIBE_PILOT_ASSISTANT_DEBUG?.trim() === "1";

function summarizeAssistantInput(
  input: VibePilotAssistantRequest["input"],
) {
  return input.map((item) => {
    if (item.type === "message") {
      return {
        content: item.content.map((part) =>
          part.type === "input_text"
            ? {
                textLength: part.text.length,
                type: part.type,
              }
            : {
                detail: part.detail ?? "auto",
                imageUrlLength: part.image_url.length,
                type: part.type,
              },
        ),
        role: item.role,
        type: item.type,
      };
    }

    return {
      callId: item.call_id,
      output:
        typeof item.output === "string"
          ? {
              kind: "string",
              length: item.output.length,
            }
          : item.output.map((part) =>
              part.type === "input_text"
                ? {
                    textLength: part.text.length,
                    type: part.type,
                  }
                : {
                    detail: part.detail ?? "auto",
                    imageUrlLength: part.image_url.length,
                    type: part.type,
                  },
            ),
      type: item.type,
    };
  });
}

function logAssistantDebug(message: string, details: unknown) {
  if (!ASSISTANT_DEBUG_ENABLED) {
    return;
  }

  console.log(
    `[vibe-pilot-assistant] ${message}`,
    JSON.stringify(details, null, 2),
  );
}

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

  const parsedRequest = vibePilotAssistantRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: "Assistant request payload was invalid.",
        details: parsedRequest.error.flatten(),
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
    const startedAt = Date.now();
    logAssistantDebug("request", {
      input: summarizeAssistantInput(parsedRequest.data.input),
      previousResponseId: parsedRequest.data.previousResponseId ?? null,
    });

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      store: shouldStoreAssistantResponses(),
      instructions: VIBE_PILOT_SYSTEM_PROMPT,
      // The request body is validated with Zod before this cast.
      input: parsedRequest.data.input as never,
      previous_response_id: parsedRequest.data.previousResponseId ?? undefined,
      parallel_tool_calls: false,
      max_output_tokens: 2500,
      tools: [...VIBE_PILOT_RESPONSE_TOOLS],
    });

    logAssistantDebug("response", {
      elapsedMs: Date.now() - startedAt,
      functionCalls: response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          callId: item.call_id,
          name: item.name,
        })),
      outputTypes: response.output.map((item) => item.type),
      responseId: response.id,
      textLength: response.output_text.length,
    });

    const result = vibePilotAssistantResponseSchema.parse({
      responseId: response.id,
      assistantText: response.output_text ?? "",
      functionCalls: response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          callId: item.call_id,
          name: item.name,
          argumentsText: item.arguments,
          arguments: tryParseAssistantToolArguments(item.arguments),
        })),
    });

    return NextResponse.json(result, {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "OpenAI failed to generate an assistant response.",
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
