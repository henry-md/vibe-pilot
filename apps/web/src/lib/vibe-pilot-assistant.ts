import { z } from "zod";

const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

const assistantInputTextSchema = z.object({
  type: z.literal("input_text"),
  text: z.string().min(1),
});

const assistantInputImageSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string().refine(
    (value) => z.string().url().safeParse(value).success || DATA_IMAGE_URL_PATTERN.test(value),
    "image_url must be a fully qualified URL or a base64 image data URL.",
  ),
  detail: z.enum(["auto", "low", "high"]).optional(),
});

const assistantMessageSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant", "developer"]),
  content: z.array(z.union([assistantInputTextSchema, assistantInputImageSchema])).min(1),
});

const assistantFunctionCallOutputSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: z.union([
    z.string(),
    z.array(z.union([assistantInputTextSchema, assistantInputImageSchema])).min(1),
  ]),
});

export const vibePilotAssistantRequestSchema = z.object({
  input: z
    .array(z.union([assistantMessageSchema, assistantFunctionCallOutputSchema]))
    .min(1),
  previousResponseId: z.string().min(1).nullable().optional(),
});

export type VibePilotAssistantRequest = z.infer<
  typeof vibePilotAssistantRequestSchema
>;

export const vibePilotAssistantToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  argumentsText: z.string(),
  arguments: z.unknown().nullable(),
});

export const vibePilotAssistantResponseSchema = z.object({
  responseId: z.string().min(1),
  assistantText: z.string(),
  functionCalls: z.array(vibePilotAssistantToolCallSchema),
});

export type VibePilotAssistantResponse = z.infer<
  typeof vibePilotAssistantResponseSchema
>;

const draftFileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
      description:
        "The virtual file path, such as assets/smiley.svg or snippets/card.html.",
    },
    mimeType: {
      type: "string",
      description:
        "The media type for this file, such as image/svg+xml, text/html, or text/plain.",
    },
    content: {
      type: "string",
      description: "The full text content of the generated file.",
    },
  },
  required: ["path", "content"],
} as const;

export const VIBE_PILOT_RESPONSE_TOOLS = [
  {
    type: "function",
    name: "get_active_tab_info",
    description:
      "Read the current browser tab metadata, including URL, title, and host. Use this before edits if you need to confirm scope.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "list_frames",
    description:
      "List the frames in the current working tab, including frame IDs, URLs, parent frame IDs, and whether active rules match each frame.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "navigate_page",
    description:
      "Navigate the current working page tab to a specific http(s) URL. Use this when the user asks you to go to a page before inspecting or editing it.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          description: "The absolute http(s) URL to open in the current working page tab.",
        },
      },
      required: ["url"],
    },
  },
  {
    type: "function",
    name: "reload_page",
    description:
      "Reload the current working page tab and wait for it to finish loading. Use this to verify that a change persists after refresh.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_page_context",
    description:
      "Inspect the current page at a high level. Returns page metadata, viewport information, structure samples, and text previews.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeHtml: {
          type: "boolean",
          description:
            "When true, include a truncated HTML preview for the main document body or landmarks.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "query_dom",
    description:
      "Inspect elements on the page with a CSS selector. Use this to verify structure, text, attributes, and layout of specific targets.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        selector: {
          type: "string",
          description: "A valid CSS selector to query.",
        },
        maxItems: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "Maximum number of matching elements to return.",
        },
        includeHtml: {
          type: "boolean",
          description: "When true, include a truncated outerHTML preview for each element.",
        },
        includeText: {
          type: "boolean",
          description: "When true, include text previews for each element.",
        },
        attributeNames: {
          type: "array",
          maxItems: 12,
          items: {
            type: "string",
          },
          description:
            "Specific attribute names to include, such as data-testid, aria-label, href, src, or role.",
        },
      },
      required: ["selector"],
    },
  },
  {
    type: "function",
    name: "scroll_page",
    description:
      "Scroll the page to coordinates or to the first element matching a selector. Use this before another screenshot when the target is below the fold.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector for the element to scroll into view. If provided, selector wins over coordinates.",
        },
        top: {
          type: "number",
          description: "Optional vertical scroll position in CSS pixels.",
        },
        left: {
          type: "number",
          description: "Optional horizontal scroll position in CSS pixels.",
        },
        block: {
          type: "string",
          enum: ["start", "center", "end", "nearest"],
          description:
            "Scroll alignment to use when selector is provided. Defaults to center.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "observe_dom",
    description:
      "Watch the current page briefly for DOM mutations and return before/after samples for a selector. Use this when a dynamic app may re-render or overwrite edits.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        selector: {
          type: "string",
          description: "A valid CSS selector to observe and summarize.",
        },
        timeoutMs: {
          type: "integer",
          minimum: 100,
          maximum: 10000,
          description: "Maximum observation time in milliseconds. Defaults to 1600.",
        },
        quietWindowMs: {
          type: "integer",
          minimum: 50,
          maximum: 2000,
          description:
            "Resolve early after this many quiet milliseconds without mutations. Defaults to 250.",
        },
        maxItems: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "Maximum number of matching elements to sample.",
        },
        includeText: {
          type: "boolean",
          description: "When true, include text previews for sampled elements.",
        },
        attributeNames: {
          type: "array",
          maxItems: 12,
          items: {
            type: "string",
          },
          description: "Specific attribute names to include in samples.",
        },
      },
      required: ["selector"],
    },
  },
  {
    type: "function",
    name: "take_screenshot",
    description:
      "Capture the visible portion of the current page as a screenshot. Use this before edits for baseline visual context and after edits to verify the result.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: {
          type: "string",
          description: "Optional label to associate with the screenshot in the UI transcript.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_injection_state",
    description:
      "Inspect Vibe Pilot live injection state in the current tab, including active rules, registered user scripts, frames, and runtime presence.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "apply_dom_patch",
    description:
      "Apply a temporary DOM patch to the current page using structured operations. Prefer update_current_draft for durable edits; use this for diagnostics or small immediate probes.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        allFrames: {
          type: "boolean",
          description: "When true, apply the patch in all frames instead of just the main frame.",
        },
        frameIds: {
          type: "array",
          maxItems: 50,
          items: {
            type: "integer",
            minimum: 0,
          },
          description: "Specific frame IDs from list_frames to patch.",
        },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: {
                type: "string",
                enum: [
                  "setText",
                  "setHtml",
                  "remove",
                  "setAttribute",
                  "removeAttribute",
                  "setStyle",
                  "addClass",
                  "removeClass",
                  "replaceText",
                ],
              },
              selector: {
                type: "string",
                description: "CSS selector for target nodes.",
              },
              all: {
                type: "boolean",
                description: "When true, patch every matched node; otherwise only the first.",
              },
              value: {
                type: "string",
                description:
                  "Text, HTML, attribute, style, or replacement value depending on operation type.",
              },
              find: {
                type: "string",
                description: "Text to find for replaceText operations.",
              },
              attributeName: {
                type: "string",
                description: "Attribute name for setAttribute/removeAttribute.",
              },
              propertyName: {
                type: "string",
                description: "CSS property name for setStyle.",
              },
              priority: {
                type: "string",
                enum: ["", "important"],
                description: "Optional CSS priority for setStyle.",
              },
              className: {
                type: "string",
                description: "Class name(s) for addClass/removeClass.",
              },
            },
            required: ["type", "selector"],
          },
        },
      },
      required: ["operations"],
    },
  },
  {
    type: "function",
    name: "insert_page_css",
    description:
      "Insert temporary CSS into the current page or selected frames. Prefer the draft css field for durable visual edits.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        css: {
          type: "string",
          description: "The CSS source to insert.",
        },
        origin: {
          type: "string",
          enum: ["USER", "AUTHOR"],
          description: "Stylesheet origin. USER is stronger and is the default.",
        },
        allFrames: {
          type: "boolean",
          description: "When true, insert into all frames.",
        },
        frameIds: {
          type: "array",
          maxItems: 50,
          items: {
            type: "integer",
            minimum: 0,
          },
          description: "Specific frame IDs from list_frames.",
        },
      },
      required: ["css"],
    },
  },
  {
    type: "function",
    name: "execute_page_script",
    description:
      "Execute a short one-off diagnostic script in the page. Prefer update_current_draft for durable page changes. MAIN runs with page JavaScript; USER_SCRIPT runs in the user-script world when Chrome allows it.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        javascript: {
          type: "string",
          description:
            "JavaScript body for an async function. You may use return to send back a JSON-serializable result.",
        },
        world: {
          type: "string",
          enum: ["MAIN", "USER_SCRIPT", "ISOLATED"],
          description:
            "Execution world. ISOLATED is treated as USER_SCRIPT. Defaults to MAIN.",
        },
        allFrames: {
          type: "boolean",
          description: "When true, execute in all frames.",
        },
        frameIds: {
          type: "array",
          maxItems: 50,
          items: {
            type: "integer",
            minimum: 0,
          },
          description: "Specific frame IDs from list_frames.",
        },
      },
      required: ["javascript"],
    },
  },
  {
    type: "function",
    name: "read_current_draft",
    description:
      "Read the current Vibe Pilot draft, including name, match pattern, HTML, CSS, JavaScript, and any generated text files.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "update_current_draft",
    description:
      "Replace or update the current Vibe Pilot draft source. This automatically syncs the changed draft to matching live tabs, so do not call apply_current_draft just to re-inject after editing.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Optional next rule name.",
        },
        matchPattern: {
          type: "string",
          description: "Optional next Chrome match pattern.",
        },
        enabled: {
          type: "boolean",
          description: "Optional enabled state for the draft.",
        },
        html: {
          type: "string",
          description: "Optional replacement HTML for the draft.",
        },
        css: {
          type: "string",
          description: "Optional replacement CSS for the draft.",
        },
        javascript: {
          type: "string",
          description: "Optional replacement JavaScript for the draft.",
        },
        files: {
          type: "array",
          description:
            "Optional complete replacement list of generated text files to make available at runtime.",
          items: draftFileSchema,
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "write_draft_file",
    description:
      "Create or replace one generated text asset in the current draft. This automatically syncs the changed draft to matching live tabs, so do not call apply_current_draft just to re-inject after writing a file.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description:
            "The virtual file path to create or replace, such as assets/smiley.svg or snippets/card.html.",
        },
        mimeType: {
          type: "string",
          description:
            "Optional media type, such as image/svg+xml, text/html, text/css, application/json, or text/plain.",
        },
        content: {
          type: "string",
          description: "The full text content for the generated file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "function",
    name: "delete_draft_file",
    description:
      "Delete one generated text asset from the current draft. This automatically syncs the changed draft to matching live tabs when injectable content remains.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "The virtual file path to delete from the draft.",
        },
      },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "apply_current_draft",
    description:
      "Explicitly apply and persist the current draft through the existing save/apply flow. update_current_draft already live-syncs edits, so use this when you need the manual apply/save semantics rather than re-injection.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "clear_live_changes",
    description:
      "Remove the currently applied live Vibe Pilot overlay and unregister the active user script from tabs.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
] as const;

export const VIBE_PILOT_SYSTEM_PROMPT = `
Formatting re-enabled
You are Vibe Pilot, a local browser copilot that can inspect a live page, update a DOM-edit draft, apply it, inspect the visual result, and iterate inside one turn.

Your job is not always to edit code.
- If the user is asking for analysis, explanation, troubleshooting, or explicitly asks you not to make page or code edits, stay read-only.
- If the user wants a screenshot or wants to know what you see, use the inspection and screenshot tools and answer normally.
- Only change the draft or apply it when the user's request calls for page changes.
- If the user asks you to go to a page, use the navigation tool first instead of assuming the page is already open.

When the user does want page changes:
- Inspect first. Use page context, DOM queries, and screenshots before making edits.
- Take a baseline screenshot before visual edits whenever the current appearance matters.
- Make the smallest draft change that can satisfy the request.
- update_current_draft automatically live-syncs changed HTML, CSS, JavaScript, and files to matching tabs. Do not call apply_current_draft just to re-inject after an update_current_draft call.
- If the request changes anything visible, including layout, styling, spacing, imagery, or copy, you must update the draft, take a fresh screenshot, and use that screenshot as the verification artifact before you declare success.
- If the verification screenshot does not clearly show the requested result, keep iterating: inspect again, adjust the draft, let the automatic live sync run, and take another screenshot.
- Keep iterating until the result appears correct in the screenshot or you hit a concrete blocker.
- Use page reloads when the user asks you to verify persistence after refresh.

Draft authoring rules:
- The draft is a Chrome extension rule with fields: name, matchPattern, html, css, javascript, files.
- files is an optional array of generated text assets. Each file has path, optional mimeType, and content.
- Use files when the user wants generated assets such as SVGs, HTML fragments, or standalone CSS snippets.
- Use write_draft_file or delete_draft_file for single generated asset edits. Those tools automatically live-sync just like update_current_draft.
- HTML should be minimal and intentional.
- CSS should be self-contained and scoped to your own ids or classes.
- JavaScript runs in the page after HTML and CSS injection.
- JavaScript must be idempotent and rerender-safe.
- JavaScript is registered for document_start in the MAIN world when Chrome userScripts are available, with a chrome.scripting MAIN-world fallback.
- On every live sync, the previous Vibe Pilot runtime is destroyed before the new draft runs. Put observers, timers, and teardown in the managed helpers when possible.
- Prefer narrow selectors and preserve the page's existing behavior where possible.
- Do not rely on external scripts, frameworks, bundlers, or network requests.

Runtime facts:
- The extension injects a managed host with id "__vibe_pilot_host__".
- The extension injects a managed root element with id "__vibe_pilot_root__".
- The extension injects the css field through chrome.scripting.insertCSS as a user-origin stylesheet. It is not exposed as a DOM style element.
- A helper object is available at window.__VIBE_PILOT__ with methods:
  - ensureRoot()
  - ensureStyle() (legacy no-op; use the css field for styles)
  - replaceText(selector, value)
  - replaceHtml(selector, value)
  - replaceVisibleText(selectors, value, options)
  - remove(selector)
  - onCleanup(callback)
  - observe(targetOrSelector, options, callback)
  - setTimeout(callback, delay)
  - clearTimeout(timeoutId)
  - setInterval(callback, delay)
  - clearInterval(intervalId)
  - listFiles()
  - getFile(path)
  - getFileText(path)
  - getFileUrl(path)

Dynamic page guidance:
- For apps like Gmail, Google Docs, dashboards, and other client-rendered pages, expect the page to replace nodes after your edit.
- Use observe_dom, list_frames, and get_injection_state when an edit seems not to stick.
- Durable edits should live in update_current_draft. Use apply_dom_patch, insert_page_css, and execute_page_script only as short diagnostic probes or immediate structured experiments.
- For re-rendering pages, write JavaScript that reapplies targeted changes with MutationObserver or window.__VIBE_PILOT__.observe, marks changed nodes with data attributes, and cleans up through window.__VIBE_PILOT__.onCleanup.
- For Gmail requests that change subjects, snippets, or opened message bodies, prefer a Gmail-scoped draft with matchPattern "https://mail.google.com/*". Use selectors such as "span.bog", "span.y2", "h2.hP", and "div.a3s"; call window.__VIBE_PILOT__.replaceVisibleText([...], requestedText, { all: true, markAttribute: "data-vibe-pilot-gmail-text" }); rerun it from a managed MutationObserver because Gmail re-renders aggressively.

Asset guidance:
- When you generate an asset like an SVG, put it in files and then reference it from JavaScript with getFileUrl(path).
- If you need to swap an existing page image, prefer replacing its src with a generated file URL over injecting a floating overlay.
- Be precise about scope. If the change should only affect one page, set matchPattern accordingly and keep selectors narrow.

User-facing behavior:
- Keep final answers short, practical, and direct.
- Tell the user plainly what you changed or what you learned.
- If you are blocked, explain the blocker and the next most useful action.
- Never end a turn with neither tool calls nor final text. If you are not done, use tools. If you are done, send a concise final answer.
`.trim();

export function shouldStoreAssistantResponses() {
  const raw = process.env.OPENAI_STORE_RESPONSES?.trim().toLowerCase();
  if (!raw) {
    return true;
  }

  return !["0", "false", "no", "off"].includes(raw);
}

export function tryParseAssistantToolArguments(argumentsText: string) {
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return null;
  }
}
