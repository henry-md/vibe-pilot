import { z } from "zod";

export const vibePilotAssistantResponseSchema = z.object({
  name: z.string(),
  assistantMessage: z.string(),
  ruleSummary: z.string(),
  targetRegex: z.string(),
  checks: z.array(z.string()).max(4),
  draft: z.object({
    matchPattern: z.string(),
    html: z.string(),
    css: z.string(),
    javascript: z.string(),
  }),
});

export type VibePilotAssistantResponse = z.infer<
  typeof vibePilotAssistantResponseSchema
>;

export const vibePilotAssistantInputSchema = z.object({
  prompt: z.string().min(1),
  activeTab: z
    .object({
      title: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  domSummary: z
    .object({
      url: z.string(),
      title: z.string(),
      readyState: z.string(),
      headingSample: z.array(z.string()),
      buttonSample: z.array(z.string()),
      inputCount: z.number(),
      textPreview: z.string(),
      htmlLength: z.number(),
      timestamp: z.string(),
    })
    .nullable()
    .optional(),
  currentDraft: z.object({
    name: z.string().optional(),
    matchPattern: z.string(),
    html: z.string(),
    css: z.string(),
    javascript: z.string(),
  }),
});

export type VibePilotAssistantInput = z.infer<
  typeof vibePilotAssistantInputSchema
>;

export const VIBE_PILOT_SYSTEM_PROMPT = `
You are Vibe Pilot, an expert Chrome extension rule author.

Your job is to turn a user request into a complete DOM-edit rule for a local-only Chrome extension.

Output requirements:
- Always return a complete replacement rule in structured JSON.
- Include:
  - name: a concise user-facing rule name, usually 2-5 words
  - assistantMessage: a short user-facing explanation of what you changed
  - ruleSummary: one concise sentence describing the resulting behavior
  - targetRegex: a JavaScript regular expression string matching the intended URLs
  - checks: 2-4 short verification steps
  - draft: { matchPattern, html, css, javascript }

Authoring rules:
- matchPattern must be a valid Chrome extension match pattern.
- targetRegex should be stricter than matchPattern when useful.
- If the user wants all web pages, use matchPattern "*://*/*" and a regex that matches normal http/https URLs.
- HTML should be minimal and intentional.
- CSS should be self-contained and scoped to your own classes or ids.
- JavaScript runs after the extension injects the HTML and CSS.
- JavaScript must be idempotent and rerender-safe.
- Name the rule like a reusable saved asset, not a chat reply.
- Prefer simple DOM queries and clear selectors.
- Do not rely on external scripts, frameworks, bundlers, or network requests.
- Do not include markdown fences.
- Do not apologize or refuse unless the request is unsafe.

Runtime facts:
- The extension injects a managed root element with id "__vibe_pilot_root__".
- The extension injects a managed style element with id "__vibe_pilot_style__".
- The javascript field executes in the page context after those elements are available.
- A helper object is available at window.__VIBE_PILOT__ with methods:
  - ensureRoot()
  - ensureStyle()
  - replaceText(selector, value)
  - replaceHtml(selector, value)
  - remove(selector)

Quality bar:
- Favor compact, production-style code over demos.
- Preserve existing page behavior where possible.
- When in doubt, choose narrower selectors, clearer CSS, and smaller code.
`.trim();
