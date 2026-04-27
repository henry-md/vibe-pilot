import { BACKEND_URL } from "./config.js";
import {
  DEFAULT_DRAFT,
  DEFAULT_WORKSPACE_RULE,
  EMPTY_WORKSPACE_RULE,
} from "./default-draft.js";

const ACTIVE_SCRIPT_ID = "vibe-pilot-live-script";
const OVERLAY_HOST_ID = "__vibe_pilot_host__";
const OVERLAY_ROOT_ID = "__vibe_pilot_root__";
const OVERLAY_STYLE_ID = "__vibe_pilot_style__";
const TAB_INJECTION_TIMEOUT_MS = 2500;
const RULE_BACKEND_TIMEOUT_MS = 8000;
const ASSISTANT_BACKEND_TIMEOUT_MS = 120000;
const STORAGE_KEYS = {
  activeDraft: "vibePilotDraft",
  workspaceDraft: "vibePilotWorkspaceDraft",
  pendingHotReload: "vibePilotPendingHotReload",
  pendingHotReloadTabId: "vibePilotPendingHotReloadTabId",
};

chrome.runtime.onInstalled.addListener((details) => {
  void bootstrap(details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  void restoreRegisteredScript();
  void finalizeHotReload();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extension error.",
      });
    });

  return true;
});

async function bootstrap(reason) {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await ensureDraftState();

  if (reason === "update") {
    await restoreRegisteredScript();
    await finalizeHotReload();
  }
}

async function handleMessage(message) {
  switch (message?.type) {
    case "VIBE_PILOT_GET_STATUS":
      return getStatusPayload();
    case "VIBE_PILOT_SAVE_DRAFT":
      return saveDraft(message.payload);
    case "VIBE_PILOT_APPLY_DRAFT":
      return applyDraft(message.payload);
    case "VIBE_PILOT_GET_DOM_SUMMARY":
      return getDomSummary();
    case "VIBE_PILOT_CLEAR_SCRIPT":
      return clearRegisteredScript();
    case "VIBE_PILOT_PREPARE_HOT_RELOAD":
      return prepareHotReload(message.payload);
    case "VIBE_PILOT_GENERATE_DRAFT":
      return generateDraft(message.payload);
    case "VIBE_PILOT_LIST_RULES":
      return listRules();
    case "VIBE_PILOT_DELETE_RULE":
      return deleteRule(message.payload);
    default:
      throw new Error(`Unknown message type: ${message?.type ?? "undefined"}`);
  }
}

async function getStatusPayload() {
  const [draftState, activeTab, availability, registered] = await Promise.all([
    ensureDraftState(),
    getTargetTabDetails(),
    getUserScriptsAvailability(),
    hasRegisteredLiveScript(),
  ]);

  return {
    activeTab,
    backendUrl: BACKEND_URL,
    draft: draftState.workspaceDraft,
    liveScriptRegistered: registered,
    userScripts: availability,
  };
}

async function saveDraft(payload) {
  const draft = normalizeDraft(payload);
  await setWorkspaceDraft(draft);

  return draft;
}

async function applyDraft(payload) {
  const draft = normalizeDraft(payload);
  const availability = await getUserScriptsAvailability();

  if (!availability.available) {
    throw new Error(availability.message);
  }

  if (!draft.name) {
    throw new Error("Give this rule a name before you apply it.");
  }

  await setActiveDraft(draft);
  await withTimeout(
    registerLiveScript(draft),
    4000,
    "Registering the live rule took too long. Try applying again.",
  );
  const injectionResult = await injectIntoMatchingTabs(draft);

  let remoteSaved = false;
  let savedRule = null;
  try {
    const response = await persistRule(draft);
    savedRule = response.rule ?? null;
    if (savedRule) {
      await setActiveDraft(savedRule);
    }
    remoteSaved = true;
  } catch (error) {
    console.warn("Unable to persist draft to the backend.", error);
  }

  await setWorkspaceDraft(EMPTY_WORKSPACE_RULE);

  return {
    applied: true,
    draft,
    remoteSaved,
    rule: savedRule,
    ...injectionResult,
    workspaceDraft: EMPTY_WORKSPACE_RULE,
  };
}

async function listRules() {
  const response = await fetchJson(
    `${BACKEND_URL}/api/rules?limit=100`,
    undefined,
    {
      timeoutMs: RULE_BACKEND_TIMEOUT_MS,
    },
  );

  return {
    backendUrl: BACKEND_URL,
    ...response,
  };
}

async function deleteRule(payload) {
  const ruleId =
    typeof payload?.ruleId === "string" && payload.ruleId.trim()
      ? payload.ruleId.trim()
      : "";

  if (!ruleId) {
    throw new Error("A rule id is required before deleting.");
  }

  const response = await fetchJson(`${BACKEND_URL}/api/rules/${ruleId}`, {
    method: "DELETE",
  }, {
    timeoutMs: RULE_BACKEND_TIMEOUT_MS,
  });

  const activeDraft = await loadActiveDraft();
  if (activeDraft?.id === ruleId) {
    await clearRegisteredScript();
  }

  return {
    backendUrl: BACKEND_URL,
    ...response,
  };
}

async function clearRegisteredScript() {
  if (chrome.userScripts) {
    await unregisterLiveScript();
  }

  await chrome.storage.local.remove(STORAGE_KEYS.activeDraft);

  await clearInjectedOverlayFromTabs();

  return {
    cleared: true,
  };
}

async function prepareHotReload(payload) {
  const draft = normalizeDraft(payload?.draft ?? payload ?? EMPTY_WORKSPACE_RULE);
  const targetTab = await getTargetTab();

  await chrome.storage.local.set({
    [STORAGE_KEYS.workspaceDraft]: draft,
    [STORAGE_KEYS.pendingHotReload]: true,
    [STORAGE_KEYS.pendingHotReloadTabId]: targetTab?.id ?? null,
  });

  return {
    prepared: true,
    tabId: targetTab?.id ?? null,
  };
}

async function restoreRegisteredScript() {
  const draft = await loadActiveDraft();
  if (!draft) {
    return;
  }

  const availability = await getUserScriptsAvailability();
  if (!availability.available) {
    return;
  }

  await registerLiveScript(draft);
}

async function finalizeHotReload() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.pendingHotReload,
    STORAGE_KEYS.pendingHotReloadTabId,
  ]);

  if (!stored[STORAGE_KEYS.pendingHotReload]) {
    return;
  }

  await chrome.storage.local.remove([
    STORAGE_KEYS.pendingHotReload,
    STORAGE_KEYS.pendingHotReloadTabId,
  ]);

  const tabId = stored[STORAGE_KEYS.pendingHotReloadTabId];
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await chrome.tabs.reload(tabId);
  } catch {
    // Ignore tabs that disappeared while the extension was reloading.
  }
}

async function registerLiveScript(draft) {
  const script = {
    id: ACTIVE_SCRIPT_ID,
    matches: [draft.matchPattern],
    js: [{ code: buildUserScriptCode(draft) }],
    runAt: "document_idle",
    world: "MAIN",
  };

  await unregisterLiveScript();
  await chrome.userScripts.register([script]);
}

async function unregisterLiveScript() {
  if (!chrome.userScripts?.unregister) {
    return;
  }

  try {
    await chrome.userScripts.unregister({ ids: [ACTIVE_SCRIPT_ID] });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Nonexistent script ID")
    ) {
      return;
    }

    throw error;
  }
}

async function injectIntoMatchingTabs(draft) {
  const targetTabs = await getMatchingTabs(draft);
  if (!targetTabs.length) {
    return {
      appliedTabCount: 0,
      failedTabCount: 0,
    };
  }

  const activeTab = await getTargetTab();
  const results = await Promise.all(
    targetTabs.map((tab) =>
      withTimeout(
        injectIntoTab(draft, tab),
        TAB_INJECTION_TIMEOUT_MS,
        `Applying the rule to ${
          safeHostnameFromUrl(tab.url) ?? "a tab"
        } took too long.`,
        () => ({
          ok: false,
          tab,
          error: new Error(
            `Applying the rule to ${
              safeHostnameFromUrl(tab.url) ?? "a tab"
            } took too long.`,
          ),
        }),
      ),
    ),
  );

  const applied = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  if (failed.length) {
    failed.forEach((result) => {
      console.warn("Unable to inject into tab.", result.tab.url, result.error);
    });
  }

  const activeFailure =
    activeTab?.id != null
      ? failed.find((result) => result.tab.id === activeTab.id)
      : null;

  if (activeFailure) {
    throw buildTabAccessError(activeFailure.tab, activeFailure.error);
  }

  if (!applied.length && failed.length) {
    throw buildTabAccessError(failed[0].tab, failed[0].error);
  }

  return {
    appliedTabCount: applied.length,
    failedTabCount: failed.length,
  };
}

async function injectIntoTab(draft, tab) {
  try {
    if (chrome.userScripts?.execute) {
      await chrome.userScripts.execute({
        target: { tabId: tab.id },
        js: [{ code: buildUserScriptCode(draft) }],
        injectImmediately: true,
        world: "MAIN",
      });
    } else {
      await chrome.tabs.reload(tab.id);
    }

    return {
      ok: true,
      tab,
    };
  } catch (error) {
    return {
      ok: false,
      tab,
      error,
    };
  }
}

function buildTabAccessError(tab, error) {
  const message =
    error instanceof Error ? error.message : "Unknown tab injection error.";

  if (message.includes("Cannot access contents of the page")) {
    const host = safeHostnameFromUrl(tab?.url);
    const hostLabel = host ?? "this site";

    return new Error(
      `Vibe Pilot does not currently have Chrome site access for ${hostLabel}. Open the extension details page, set Site access to On all sites or allow ${hostLabel}, then try Apply again.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function safeHostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function clearInjectedOverlayFromTabs() {
  const tabs = await getInspectableTabs();
  const targetTabIds = tabs
    .map((tab) => tab.id)
    .filter((tabId) => typeof tabId === "number");

  if (!targetTabIds.length) {
    return;
  }

  await Promise.all(
    targetTabIds.map((tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (hostId, rootId, styleId) => {
          const runtime = window.__VIBE_PILOT__;
          if (runtime?.destroy) {
            runtime.destroy();
            return;
          }

          document.getElementById(hostId)?.remove();
          document.getElementById(rootId)?.remove();
          document.getElementById(styleId)?.remove();
          delete window.__VIBE_PILOT__;
        },
        args: [OVERLAY_HOST_ID, OVERLAY_ROOT_ID, OVERLAY_STYLE_ID],
      }).catch(() => {
        // Ignore tabs that reject scripting while closing or changing origin.
      }),
    ),
  );
}

function buildUserScriptCode(draft) {
  const html = JSON.stringify(draft.html);
  const css = JSON.stringify(draft.css);
  const javascript = draft.javascript || "";

  return `
(() => {
  if (window.__VIBE_PILOT__?.destroy) {
    window.__VIBE_PILOT__.destroy();
  }

  const htmlSnippet = ${html};
  const cssSnippet = ${css};
  const hostId = "${OVERLAY_HOST_ID}";
  const rootId = "${OVERLAY_ROOT_ID}";
  const styleId = "${OVERLAY_STYLE_ID}";

  const applyHostStyles = (node) => {
    const important = "important";
    node.style.setProperty("all", "initial", important);
    node.style.setProperty("position", "fixed", important);
    node.style.setProperty("inset", "0", important);
    node.style.setProperty("display", "block", important);
    node.style.setProperty("pointer-events", "none", important);
    node.style.setProperty("z-index", "2147483647", important);
    node.style.setProperty("isolation", "isolate", important);
    node.style.setProperty("contain", "layout style paint", important);
    node.style.setProperty("visibility", "visible", important);
    node.style.setProperty("opacity", "1", important);
    node.style.setProperty("transform", "none", important);
  };

  const ensureHost = () => {
    const parent = document.documentElement;
    if (!parent) {
      return null;
    }

    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement("div");
      host.id = hostId;
      host.dataset.vibePilot = "host";
      parent.appendChild(host);
    }

    applyHostStyles(host);
    return host;
  };

  const ensureStyle = () => {
    if (!cssSnippet) {
      return;
    }

    const host = ensureHost();
    if (!host) {
      return;
    }

    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      host.appendChild(style);
    }

    if (style.textContent !== cssSnippet) {
      style.textContent = cssSnippet;
    }
  };

  const ensureRoot = () => {
    if (!htmlSnippet) {
      return null;
    }

    const host = ensureHost();
    if (!host) {
      return null;
    }

    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      root.dataset.vibePilot = "managed";
      host.appendChild(root);
    }

    if (root.innerHTML !== htmlSnippet) {
      root.innerHTML = htmlSnippet;
    }

    return root;
  };

  const api = {
    hostId,
    rootId,
    styleId,
    ensureHost,
    ensureRoot,
    ensureStyle,
    replaceText(selector, value) {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      node.textContent = value;
      return true;
    },
    replaceHtml(selector, value) {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      node.innerHTML = value;
      return true;
    },
    remove(selector) {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      node.remove();
      return true;
    },
    destroy() {
      rerenderObserver.disconnect();
      document.getElementById(rootId)?.remove();
      document.getElementById(styleId)?.remove();
      document.getElementById(hostId)?.remove();
      delete window.__VIBE_PILOT__;
    }
  };

  window.__VIBE_PILOT__ = api;
  ensureStyle();
  ensureRoot();

  const rerenderObserver = new MutationObserver(() => {
    ensureStyle();
    ensureRoot();
  });

  if (document.documentElement) {
    rerenderObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

${javascript}
})();
`;
}

async function loadDraft() {
  return loadWorkspaceDraft();
}

async function loadWorkspaceDraft() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.workspaceDraft);
  return hydrateStoredDraft(stored[STORAGE_KEYS.workspaceDraft]);
}

async function loadActiveDraft() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.activeDraft);
  return hydrateStoredDraft(stored[STORAGE_KEYS.activeDraft]);
}

async function setWorkspaceDraft(draft) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.workspaceDraft]: normalizeDraft(draft),
  });
}

async function setActiveDraft(draft) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.activeDraft]: normalizeDraft(draft),
  });
}

async function ensureDraftState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.activeDraft,
    STORAGE_KEYS.workspaceDraft,
  ]);

  const activeDraft = hydrateStoredDraft(stored[STORAGE_KEYS.activeDraft]);
  let workspaceDraft = hydrateStoredDraft(stored[STORAGE_KEYS.workspaceDraft]);
  const updates = {};

  if (!workspaceDraft) {
    workspaceDraft = activeDraft ? EMPTY_WORKSPACE_RULE : DEFAULT_WORKSPACE_RULE;
    updates[STORAGE_KEYS.workspaceDraft] = workspaceDraft;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  return {
    activeDraft,
    workspaceDraft,
  };
}

async function hasRegisteredLiveScript() {
  const availability = await getUserScriptsAvailability();
  if (!availability.available) {
    return false;
  }

  const scripts = await chrome.userScripts.getScripts({ ids: [ACTIVE_SCRIPT_ID] });
  return scripts.length > 0;
}

async function getUserScriptsAvailability() {
  if (!chrome.userScripts?.getScripts) {
    return {
      available: false,
      message: "User scripts are unavailable in this Chrome profile.",
    };
  }

  try {
    await chrome.userScripts.getScripts();
    return {
      available: true,
      message: "User scripts are available in this Chrome profile.",
    };
  } catch {
    return {
      available: false,
      message: "User scripts are unavailable in this Chrome profile.",
    };
  }
}

async function getTargetTab() {
  const ranked = (await getInspectableTabs())
    .filter((tab) => Boolean(tab.id))
    .sort((left, right) => {
      if (Boolean(left.active) !== Boolean(right.active)) {
        return left.active ? -1 : 1;
      }

      return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
    });

  const activeHttpTab = ranked.find((tab) => tab.active && isInspectableUrl(tab.url));
  if (activeHttpTab) {
    return activeHttpTab;
  }

  const recentHttpTab = ranked.find((tab) => isInspectableUrl(tab.url));
  if (recentHttpTab) {
    return recentHttpTab;
  }

  return ranked[0] ?? null;
}

async function getInspectableTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => isInspectableUrl(tab.url));
}

async function getMatchingTabs(draft) {
  const tabs = await getInspectableTabs();
  return tabs.filter((tab) =>
    typeof tab.id === "number" && matchesPattern(tab.url, draft.matchPattern),
  );
}

async function getTargetTabDetails() {
  const tab = await getTargetTab();
  if (!tab) {
    return null;
  }

  return {
    id: tab.id ?? null,
    title: tab.title ?? "Untitled tab",
    url: tab.url ?? "Unknown URL",
  };
}

async function getDomSummary() {
  const tab = await getTargetTab();
  if (!tab?.id) {
    throw new Error("No active tab was available to inspect.");
  }

  if (!tab.url || !/^https?:/i.test(tab.url)) {
    throw new Error("Open a normal http(s) page before requesting a DOM summary.");
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "VIBE_PILOT_GET_DOM_SUMMARY",
  });

  if (!response) {
    throw new Error("The content script did not return a DOM summary.");
  }

  return response;
}

function normalizeDraft(payload) {
  return {
    id:
      typeof payload?.id === "string" && payload.id.trim()
        ? payload.id.trim()
        : null,
    name: typeof payload?.name === "string" ? payload.name.trim() : "",
    matchPattern:
      typeof payload?.matchPattern === "string" && payload.matchPattern.trim()
        ? payload.matchPattern.trim()
        : DEFAULT_DRAFT.matchPattern,
    html: typeof payload?.html === "string" ? payload.html : "",
    css: typeof payload?.css === "string" ? payload.css : "",
    javascript:
      typeof payload?.javascript === "string"
        ? payload.javascript
        : DEFAULT_DRAFT.javascript,
  };
}

async function generateDraft(payload) {
  const prompt =
    typeof payload?.prompt === "string" ? payload.prompt.trim() : "";

  if (!prompt) {
    throw new Error("Enter a prompt before asking the assistant to generate a draft.");
  }

  const [currentDraft, activeTab] = await Promise.all([
    loadWorkspaceDraft(),
    getTargetTabDetails(),
  ]);

  let domSummary = null;
  try {
    domSummary = await getDomSummary();
  } catch {
    domSummary = null;
  }

  const response = await fetchJson(`${BACKEND_URL}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      activeTab,
      domSummary,
      currentDraft: currentDraft ?? DEFAULT_WORKSPACE_RULE,
    }),
  }, {
    timeoutMs: ASSISTANT_BACKEND_TIMEOUT_MS,
  });

  if (response?.draft) {
    await saveDraft({
      ...response.draft,
      name:
        typeof response.name === "string" && response.name.trim()
          ? response.name.trim()
          : "",
    });
  }

  return {
    ...response,
    activeTab,
    backendUrl: BACKEND_URL,
    domSummary,
  };
}

async function persistRule(draft) {
  const activeTab = await getTargetTabDetails();
  const normalizedRule = normalizeDraft(draft);
  const requestBody = {
    name: readRequiredRuleName(normalizedRule.name),
    targetTitle: activeTab?.title ?? null,
    targetUrl: activeTab?.url ?? null,
    matchPattern: normalizedRule.matchPattern,
    html: normalizedRule.html,
    css: normalizedRule.css,
    javascript: normalizedRule.javascript,
  };

  const endpoint = normalizedRule.id
    ? `${BACKEND_URL}/api/rules/${normalizedRule.id}`
    : `${BACKEND_URL}/api/rules`;

  return fetchJson(endpoint, {
    method: normalizedRule.id ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  }, {
    timeoutMs: RULE_BACKEND_TIMEOUT_MS,
  });
}

async function fetchJson(url, init, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Request to ${url} timed out after ${timeoutMs}ms.`,
        "AbortError",
      ),
    );
  }, timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `Unable to reach the backend at ${url}. ${
        error instanceof Error ? error.message : "Unknown network error."
      }`,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      details || `Backend request failed with status ${response.status}.`,
    );
  }

  return response.json();
}

function isInspectableUrl(value) {
  return typeof value === "string" && /^https?:/i.test(value);
}

function matchesPattern(url, pattern) {
  if (typeof url !== "string" || typeof pattern !== "string") {
    return false;
  }

  if (pattern === "<all_urls>") {
    return isInspectableUrl(url);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  const match = pattern.match(/^(\*|http|https):\/\/([^/]+)(\/.*)$/i);
  if (!match) {
    return isInspectableUrl(url);
  }

  const [, schemePattern, hostPattern, pathPattern] = match;
  const scheme = parsedUrl.protocol.replace(":", "").toLowerCase();
  const host = parsedUrl.hostname.toLowerCase();
  const path = `${parsedUrl.pathname}${parsedUrl.search}` || "/";

  const schemeMatches =
    schemePattern === "*" ? scheme === "http" || scheme === "https" : scheme === schemePattern.toLowerCase();

  const normalizedHostPattern = hostPattern.toLowerCase();
  const hostMatches =
    normalizedHostPattern === "*" ||
    (normalizedHostPattern.startsWith("*.") &&
      (host === normalizedHostPattern.slice(2) ||
        host.endsWith(`.${normalizedHostPattern.slice(2)}`))) ||
    host === normalizedHostPattern;

  const pathRegex = new RegExp(
    `^${pathPattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")}$`,
  );

  return schemeMatches && hostMatches && pathRegex.test(path);
}

function readRequiredRuleName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Give this rule a name before saving it.");
  }

  return name.trim();
}

function hydrateStoredDraft(payload) {
  if (!payload) {
    return null;
  }

  return normalizeDraft(payload);
}

async function withTimeout(
  promise,
  timeoutMs,
  message,
  onTimeout,
) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          if (typeof onTimeout === "function") {
            resolve(onTimeout());
            return;
          }

          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
