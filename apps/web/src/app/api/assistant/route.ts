import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
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

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_MODEL = "gpt-5";
const ASSISTANT_DEBUG_ENABLED =
  process.env.VIBE_PILOT_ASSISTANT_DEBUG?.trim() === "1";

function getAssistantApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function getAssistantModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

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

function buildAssistantCreateParams(
  requestData: VibePilotAssistantRequest,
) {
  return {
    model: getAssistantModel(),
    store: shouldStoreAssistantResponses(),
    instructions: VIBE_PILOT_SYSTEM_PROMPT,
    input: requestData.input as never,
    previous_response_id: requestData.previousResponseId ?? undefined,
    parallel_tool_calls: false,
    max_output_tokens: 2500,
    tools: [...VIBE_PILOT_RESPONSE_TOOLS],
  };
}

function getAssistantOutputText(response: OpenAIResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return response.output
    .flatMap((item) => {
      if (item.type !== "message" || item.role !== "assistant") {
        return [];
      }

      return item.content;
    })
    .map((part) => {
      if (part.type === "output_text") {
        return part.text;
      }

      if (part.type === "refusal") {
        return part.refusal;
      }

      return "";
    })
    .join("");
}

function buildAssistantResult(response: OpenAIResponse) {
  return vibePilotAssistantResponseSchema.parse({
    responseId: response.id,
    assistantText: getAssistantOutputText(response),
    functionCalls: response.output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        callId: item.call_id,
        name: item.name,
        argumentsText: item.arguments,
        arguments: tryParseAssistantToolArguments(item.arguments),
      })),
  });
}

function logAssistantResponse(
  startedAt: number,
  response: OpenAIResponse,
) {
  const outputText = getAssistantOutputText(response);

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
    textLength: outputText.length,
  });
}

function formatAssistantError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "OpenAI failed to generate an assistant response.";
}

function jsonError(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: CORS_HEADERS,
  });
}

function wantsEventStream(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  const explicitPreference = request.headers.get("x-vibe-pilot-stream") ?? "";

  return (
    accept.toLowerCase().includes("text/event-stream") ||
    explicitPreference.trim() === "1"
  );
}

function createSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: NextRequest) {
  const apiKey = getAssistantApiKey();

  if (!apiKey) {
    return jsonError(
      {
        error: "OPENAI_API_KEY is not configured on the web backend.",
      },
      500,
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError(
      {
        error: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const parsedRequest = vibePilotAssistantRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return jsonError(
      {
        error: "Assistant request payload was invalid.",
        details: parsedRequest.error.flatten(),
      },
      400,
    );
  }

  const openai = new OpenAI({
    apiKey,
  });
  const startedAt = Date.now();

  logAssistantDebug("request", {
    input: summarizeAssistantInput(parsedRequest.data.input),
    previousResponseId: parsedRequest.data.previousResponseId ?? null,
  });

  if (wantsEventStream(request)) {
    const encoder = new TextEncoder();
    const stream = openai.responses.stream(
      buildAssistantCreateParams(parsedRequest.data),
      {
        signal: request.signal,
      },
    );

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(createSseEvent(event, data)));
        };

        stream.on("response.output_text.delta", (event) => {
          if (!event.delta) {
            return;
          }

          send("assistant.text_delta", {
            delta: event.delta,
          });
        });

        try {
          const finalResponse = await stream.finalResponse();
          logAssistantResponse(startedAt, finalResponse);
          send("assistant.response", buildAssistantResult(finalResponse));
        } catch (error) {
          send("assistant.error", {
            error: formatAssistantError(error),
          });
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(responseStream, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  }

  try {
    const response = await openai.responses.create(
      buildAssistantCreateParams(parsedRequest.data),
      {
        signal: request.signal,
      },
    );

    logAssistantResponse(startedAt, response);

    return NextResponse.json(buildAssistantResult(response), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return jsonError(
      {
        error: formatAssistantError(error),
      },
      500,
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
