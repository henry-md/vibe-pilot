const DEFAULT_MATCH_PATTERN = "*://*/*";

export type RuleFile = {
  path: string;
  mimeType: string;
  content: string;
};

export type RuleChatImage = {
  alt: string;
  label: string;
  url: string;
};

export type RuleChatMessage = {
  createdAt: string;
  id: string;
  images: RuleChatImage[];
  role: "assistant" | "tool" | "user";
  status: string;
  text: string;
  toolArgumentsText: string;
  toolName: string | null;
};

export type RuleInput = {
  name: string;
  matchPattern: string;
  html: string;
  css: string;
  javascript: string;
  files: RuleFile[];
  chatMessages: RuleChatMessage[];
  chatPreviousResponseId: string | null;
};

export type StoredRuleInput = {
  name: string;
  matchPattern: string;
  html: string;
  css: string;
  javascript: string;
  files: string;
  chatMessages: string;
  chatPreviousResponseId: string | null;
};

export type StoredRuleRecord = {
  id: string;
  name: string;
  matchPattern: string;
  html: string;
  css: string;
  javascript: string;
  files: string;
  chatMessages: string;
  chatPreviousResponseId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function normalizeRuleInput(payload: unknown): RuleInput {
  const value = payload && typeof payload === "object" ? payload : {};
  const record = value as Record<string, unknown>;

  return {
    name: readRequiredString(record.name, "Rule name is required."),
    matchPattern: readString(record.matchPattern, DEFAULT_MATCH_PATTERN),
    html: readText(record.html),
    css: readText(record.css),
    javascript: readText(record.javascript),
    files: readRuleFiles(record.files),
    chatMessages: readRuleChatMessages(record.chatMessages),
    chatPreviousResponseId: readNullableString(record.chatPreviousResponseId),
  };
}

export function serializeStoredRuleInput(rule: RuleInput): StoredRuleInput {
  return {
    name: rule.name,
    matchPattern: rule.matchPattern,
    html: rule.html,
    css: rule.css,
    javascript: rule.javascript,
    files: JSON.stringify(rule.files),
    chatMessages: JSON.stringify(rule.chatMessages),
    chatPreviousResponseId: rule.chatPreviousResponseId,
  };
}

export function serializeRule(
  rule: StoredRuleRecord,
  options: { includeChat?: boolean } = {},
) {
  const {
    chatMessages,
    chatPreviousResponseId,
    files,
    ...baseRule
  } = rule;
  const serializedRule = {
    ...baseRule,
    files: parseStoredRuleFiles(files),
  };

  if (options.includeChat === false) {
    return serializedRule;
  }

  return {
    ...serializedRule,
    chatMessages: parseStoredRuleChatMessages(chatMessages),
    chatPreviousResponseId: readNullableString(chatPreviousResponseId),
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

function readText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readRuleFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<RuleFile[]>((result, item) => {
    const record = item && typeof item === "object" ? item : null;
    const path = typeof record?.path === "string" ? record.path.trim() : "";
    const content = typeof record?.content === "string" ? record.content : "";

    if (!path) {
      return result;
    }

    result.push({
      path,
      mimeType:
        typeof record?.mimeType === "string" ? record.mimeType.trim() : "",
      content,
    });
    return result;
  }, []);
}

function readRuleChatImages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<RuleChatImage[]>((result, item) => {
    const record = item && typeof item === "object" ? item : null;
    const url = typeof record?.url === "string" ? record.url.trim() : "";

    if (!url) {
      return result;
    }

    result.push({
      alt:
        typeof record?.alt === "string" && record.alt.trim()
          ? record.alt.trim()
          : "Screenshot",
      label:
        typeof record?.label === "string" && record.label.trim()
          ? record.label.trim()
          : "",
      url,
    });
    return result;
  }, []);
}

function readRuleChatMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<RuleChatMessage[]>((result, item) => {
    const record = item && typeof item === "object" ? item : null;
    const role =
      record?.role === "assistant" ||
      record?.role === "tool" ||
      record?.role === "user"
        ? record.role
        : "assistant";
    const text = typeof record?.text === "string" ? record.text : "";
    const images = readRuleChatImages(record?.images);
    const toolArgumentsText =
      typeof record?.toolArgumentsText === "string"
        ? record.toolArgumentsText
        : "";

    if (!text.trim() && !images.length && !toolArgumentsText.trim()) {
      return result;
    }

    result.push({
      createdAt:
        typeof record?.createdAt === "string" && record.createdAt.trim()
          ? record.createdAt.trim()
          : new Date().toISOString(),
      id:
        typeof record?.id === "string" && record.id.trim()
          ? record.id.trim()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      images,
      role,
      status:
        typeof record?.status === "string" && record.status.trim()
          ? record.status.trim()
          : "ok",
      text,
      toolArgumentsText,
      toolName:
        typeof record?.toolName === "string" && record.toolName.trim()
          ? record.toolName.trim()
          : null,
    });
    return result;
  }, []);
}

function parseStoredRuleFiles(value: string) {
  try {
    return readRuleFiles(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseStoredRuleChatMessages(value: string) {
  try {
    return readRuleChatMessages(JSON.parse(value));
  } catch {
    return [];
  }
}
