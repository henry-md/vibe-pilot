export const DEFAULT_DRAFT = {
  matchPattern: "*://*/*",
  html: ['<div class="vp-sample-pill">Hello world</div>'].join("\n"),
  css: [
    "#__vibe_pilot_root__ {",
    "  position: fixed;",
    "  inset: 0;",
    "  pointer-events: none;",
    "  z-index: 2147483647;",
    "}",
    ".vp-sample-pill {",
    "  position: fixed;",
    "  right: 16px;",
    "  bottom: 16px;",
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 8px;",
    "  padding: 10px 14px;",
    "  border-radius: 999px;",
    "  background: rgba(25, 18, 24, 0.94);",
    "  color: #fff7ef;",
    "  box-shadow: 0 18px 40px rgba(25, 18, 24, 0.28);",
    "  font: 600 13px/1 var(--vp-font, 'IBM Plex Mono', monospace);",
    "  letter-spacing: 0.04em;",
    "  text-transform: uppercase;",
    "}",
  ].join("\n"),
  javascript: "",
  files: [],
};

export const DEFAULT_RULE_NAME = "Hello world pill";

export const DEFAULT_WORKSPACE_RULE = {
  id: null,
  name: DEFAULT_RULE_NAME,
  ...DEFAULT_DRAFT,
};

export const RED_TEXT_STARTER_RULE_NAME = "Red text override";

export const RED_TEXT_STARTER_DRAFT = {
  matchPattern: "*://*/*",
  html: "",
  css: [
    "html,",
    "body,",
    "body * {",
    "  color: #d11a2a !important;",
    "}",
  ].join("\n"),
  javascript: "",
  files: [],
};

export const RED_TEXT_STARTER_WORKSPACE_RULE = {
  id: null,
  name: RED_TEXT_STARTER_RULE_NAME,
  ...RED_TEXT_STARTER_DRAFT,
};

export const EMPTY_DRAFT = {
  matchPattern: DEFAULT_DRAFT.matchPattern,
  html: "",
  css: "",
  javascript: "",
  files: [],
};

export const EMPTY_WORKSPACE_RULE = {
  id: null,
  name: "",
  ...EMPTY_DRAFT,
};

export const DEFAULT_RULE_SUMMARY =
  "The default sample adds a floating Hello world pill to every http(s) page.";

export const EMPTY_RULE_SUMMARY =
  "Name the rule, generate or edit the code, then apply it when it is ready.";
