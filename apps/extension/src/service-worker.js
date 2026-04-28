import { BACKEND_URL } from "./config.js";
import {
  DEFAULT_DRAFT,
  DEFAULT_WORKSPACE_RULE,
  EMPTY_WORKSPACE_RULE,
} from "./default-draft.js";

const ACTIVE_SCRIPT_ID = "vibe-pilot-live-script";
const ASSISTANT_PROGRESS_PORT_NAME = "vibe-pilot-assistant-progress";
const LOCAL_BACKEND_URL = "http://127.0.0.1:3001";
const OVERLAY_HOST_ID = "__vibe_pilot_host__";
const OVERLAY_ROOT_ID = "__vibe_pilot_root__";
const OVERLAY_STYLE_ID = "__vibe_pilot_style__";
const TAB_INJECTION_TIMEOUT_MS = 2500;
const RULE_BACKEND_TIMEOUT_MS = 8000;
const ASSISTANT_BACKEND_TIMEOUT_MS = 120000;
const ASSISTANT_MAX_TOOL_STEPS = 24;
const ASSISTANT_EMPTY_RESPONSE_RETRY_LIMIT = 2;
const SCREENSHOT_CAPTURE_COOLDOWN_MS = 550;
const SCREENSHOT_PREVIEW_MAX_WIDTH = 960;
const SCREENSHOT_PREVIEW_MAX_HEIGHT = 960;
const SCREENSHOT_PREVIEW_QUALITY = 0.68;
const STORAGE_KEYS = {
  activeDraft: "vibePilotDraft",
  workspaceDraft: "vibePilotWorkspaceDraft",
  pendingHotReload: "vibePilotPendingHotReload",
  pendingHotReloadTabId: "vibePilotPendingHotReloadTabId",
};

const assistantProgressPorts = new Set();
let lastScreenshotCapturedAt = 0;

chrome.runtime.onInstalled.addListener((details) => {
  void bootstrap(details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  void restoreRegisteredScript();
  void finalizeHotReload();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  void maybeReapplyActiveDraftToTab(tabId, tab);
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ASSISTANT_PROGRESS_PORT_NAME) {
    return;
  }

  assistantProgressPorts.add(port);

  port.onDisconnect.addListener(() => {
    assistantProgressPorts.delete(port);
  });
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
    case "VIBE_PILOT_SAVE_RULE":
      return saveRule(message.payload);
    case "VIBE_PILOT_APPLY_DRAFT":
      return applyDraft(message.payload);
    case "VIBE_PILOT_GET_DOM_SUMMARY":
      return getDomSummary();
    case "VIBE_PILOT_CLEAR_SCRIPT":
      return clearRegisteredScript();
    case "VIBE_PILOT_PREPARE_HOT_RELOAD":
      return prepareHotReload(message.payload);
    case "VIBE_PILOT_RUN_ASSISTANT":
      return runAssistantTurn(message.payload);
    case "VIBE_PILOT_GENERATE_DRAFT":
      return runAssistantTurn(message.payload);
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

async function saveRule(payload) {
  const draft = normalizeDraft(payload);
  if (!draft.name) {
    throw new Error("Give this rule a name before saving it.");
  }

  const response = await persistRule(draft);
  const savedRule = response.rule ? normalizeDraft(response.rule) : draft;
  await setWorkspaceDraft(savedRule);

  return {
    backendUrl: BACKEND_URL,
    ...response,
    rule: savedRule,
  };
}

async function applyDraft(payload) {
  const draft = normalizeDraft(payload);

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
    savedRule = response.rule ? normalizeDraft(response.rule) : null;
    if (savedRule) {
      await setActiveDraft(savedRule);
    }
    remoteSaved = true;
  } catch (error) {
    console.warn("Unable to persist draft to the backend.", error);
  }

  const nextWorkspaceDraft = savedRule ?? draft;
  await setWorkspaceDraft(nextWorkspaceDraft);

  return {
    applied: true,
    draft,
    remoteSaved,
    rule: savedRule,
    ...injectionResult,
    workspaceDraft: nextWorkspaceDraft,
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
    rules: Array.isArray(response.rules)
      ? response.rules.map((rule) => normalizeDraft(rule))
      : [],
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
    await injectIntoMatchingTabs(draft);
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
  const availability = await getUserScriptsAvailability();
  if (!availability.available) {
    return;
  }

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
    await executeDraftInTab(draft, tab.id);

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

async function executeDraftInTab(draft, tabId, options = {}) {
  const allowUserScripts = options.allowUserScripts !== false;
  const source = buildUserScriptCode(draft);

  if (allowUserScripts) {
    const availability = await getUserScriptsAvailability();
    if (availability.available && chrome.userScripts?.execute) {
      await chrome.userScripts.execute({
        target: { tabId },
        js: [{ code: source }],
        injectImmediately: true,
        world: "MAIN",
      });
      return;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (draftSource) => {
      // Execute the generated draft source in the page world when userScripts is unavailable.
      (0, eval)(draftSource);
    },
    args: [source],
  });
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
  const files = JSON.stringify(normalizeRuleFiles(draft.files));

  return `
(() => {
  if (window.__VIBE_PILOT__?.destroy) {
    window.__VIBE_PILOT__.destroy();
  }

  const htmlSnippet = ${html};
  const cssSnippet = ${css};
  const fileEntries = ${files};
  const hostId = "${OVERLAY_HOST_ID}";
  const rootId = "${OVERLAY_ROOT_ID}";
  const styleId = "${OVERLAY_STYLE_ID}";

  const normalizeFilePath = (value) =>
    String(value ?? "")
      .trim()
      .replace(/^\\.\\//, "")
      .replace(/^\\/+/, "");

  const inferMimeType = (filePath) => {
    const normalized = normalizeFilePath(filePath).toLowerCase();

    if (normalized.endsWith(".svg")) return "image/svg+xml";
    if (normalized.endsWith(".html")) return "text/html";
    if (normalized.endsWith(".css")) return "text/css";
    if (normalized.endsWith(".js")) return "text/javascript";
    if (normalized.endsWith(".json")) return "application/json";
    if (normalized.endsWith(".txt")) return "text/plain";

    return "text/plain";
  };

  const filesByPath = new Map(
    fileEntries
      .filter((entry) => entry && typeof entry.path === "string")
      .map((entry) => {
        const filePath = normalizeFilePath(entry.path);

        return [
          filePath,
          {
            path: filePath,
            content: typeof entry.content === "string" ? entry.content : "",
            mimeType:
              typeof entry.mimeType === "string" && entry.mimeType.trim()
                ? entry.mimeType.trim()
                : inferMimeType(filePath),
            objectUrl: null,
          },
        ];
      })
      .filter(([filePath]) => Boolean(filePath)),
  );

  const revokeFileUrls = () => {
    for (const file of filesByPath.values()) {
      if (file.objectUrl) {
        URL.revokeObjectURL(file.objectUrl);
        file.objectUrl = null;
      }
    }
  };

  const getFileRecord = (filePath) => {
    const normalized = normalizeFilePath(filePath);
    if (!normalized) {
      return null;
    }

    return filesByPath.get(normalized) ?? null;
  };

  const ensureFileUrl = (filePath) => {
    const file = getFileRecord(filePath);
    if (!file) {
      return null;
    }

    if (!file.objectUrl) {
      file.objectUrl = URL.createObjectURL(
        new Blob([file.content], {
          type: file.mimeType || inferMimeType(file.path),
        }),
      );
    }

    return file.objectUrl;
  };

  const resolveManagedAssetUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    if (value.startsWith("vp://")) {
      return ensureFileUrl(value.slice("vp://".length));
    }

    const directMatch = ensureFileUrl(value);
    if (directMatch) {
      return directMatch;
    }

    return null;
  };

  const hydrateManagedAssetLinks = (root) => {
    if (!root || !filesByPath.size) {
      return;
    }

    const nodes = [root, ...root.querySelectorAll("[src],[href],[poster],[data-vp-file-path]")];

    for (const node of nodes) {
      const explicitFilePath = node.getAttribute?.("data-vp-file-path");
      if (explicitFilePath) {
        const fileUrl = ensureFileUrl(explicitFilePath);
        if (fileUrl) {
          if (node.hasAttribute("src")) {
            node.setAttribute("src", fileUrl);
          } else if (node.hasAttribute("href")) {
            node.setAttribute("href", fileUrl);
          } else {
            node.setAttribute("src", fileUrl);
          }
        }
      }

      for (const attributeName of ["src", "href", "poster"]) {
        const currentValue = node.getAttribute?.(attributeName);
        const fileUrl = resolveManagedAssetUrl(currentValue);
        if (fileUrl) {
          node.setAttribute(attributeName, fileUrl);
        }
      }
    }
  };

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

    hydrateManagedAssetLinks(root);

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
      hydrateManagedAssetLinks(node);
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
    listFiles() {
      return Array.from(filesByPath.values()).map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        size: file.content.length,
      }));
    },
    getFile(path) {
      const file = getFileRecord(path);
      if (!file) {
        return null;
      }

      return {
        path: file.path,
        mimeType: file.mimeType,
        content: file.content,
        size: file.content.length,
      };
    },
    getFileText(path) {
      const file = getFileRecord(path);
      return file ? file.content : null;
    },
    getFileUrl(path) {
      return ensureFileUrl(path);
    },
    destroy() {
      rerenderObserver.disconnect();
      revokeFileUrls();
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
  return loadStoredDraft(STORAGE_KEYS.workspaceDraft);
}

async function loadActiveDraft() {
  return loadStoredDraft(STORAGE_KEYS.activeDraft);
}

async function loadStoredDraft(storageKey) {
  const stored = await chrome.storage.local.get(storageKey);
  const rawDraft = stored[storageKey];
  const draft = hydrateStoredDraft(rawDraft);

  if (hasLegacyTargetMetadata(rawDraft)) {
    if (draft) {
      await chrome.storage.local.set({
        [storageKey]: draft,
      });
    } else {
      await chrome.storage.local.remove(storageKey);
    }
  }

  return draft;
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

  const rawActiveDraft = stored[STORAGE_KEYS.activeDraft];
  const rawWorkspaceDraft = stored[STORAGE_KEYS.workspaceDraft];
  const activeDraft = hydrateStoredDraft(rawActiveDraft);
  let workspaceDraft = hydrateStoredDraft(rawWorkspaceDraft);
  const updates = {};
  const removals = [];

  if (hasLegacyTargetMetadata(rawActiveDraft)) {
    if (activeDraft) {
      updates[STORAGE_KEYS.activeDraft] = activeDraft;
    } else {
      removals.push(STORAGE_KEYS.activeDraft);
    }
  }

  if (hasLegacyTargetMetadata(rawWorkspaceDraft) && workspaceDraft) {
    updates[STORAGE_KEYS.workspaceDraft] = workspaceDraft;
  }

  if (!workspaceDraft) {
    workspaceDraft = EMPTY_WORKSPACE_RULE;
    updates[STORAGE_KEYS.workspaceDraft] = workspaceDraft;
  } else if (isLegacySeededExample(workspaceDraft)) {
    workspaceDraft = EMPTY_WORKSPACE_RULE;
    updates[STORAGE_KEYS.workspaceDraft] = workspaceDraft;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  if (removals.length > 0) {
    await chrome.storage.local.remove(removals);
  }

  return {
    activeDraft,
    workspaceDraft,
  };
}

function isLegacySeededExample(draft) {
  return (
    draft?.id == null &&
    draft?.name === DEFAULT_WORKSPACE_RULE.name &&
    draft?.matchPattern === DEFAULT_WORKSPACE_RULE.matchPattern &&
    draft?.html === DEFAULT_WORKSPACE_RULE.html &&
    draft?.css === DEFAULT_WORKSPACE_RULE.css &&
    draft?.javascript === DEFAULT_WORKSPACE_RULE.javascript &&
    JSON.stringify(normalizeRuleFiles(draft?.files)) ===
      JSON.stringify(normalizeRuleFiles(DEFAULT_WORKSPACE_RULE.files))
  );
}

async function hasRegisteredLiveScript() {
  const availability = await getUserScriptsAvailability();
  if (!availability.available) {
    return Boolean(await loadActiveDraft());
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

async function maybeReapplyActiveDraftToTab(tabId, tabOverride) {
  const draft = await loadActiveDraft();
  if (!draft) {
    return;
  }

  const availability = await getUserScriptsAvailability();
  if (availability.available) {
    return;
  }

  const tab =
    tabOverride ??
    await chrome.tabs.get(tabId).catch(() => null);

  if (!tab?.id || !matchesPattern(tab.url, draft.matchPattern)) {
    return;
  }

  try {
    await executeDraftInTab(draft, tab.id, {
      allowUserScripts: false,
    });
  } catch (error) {
    console.warn("Unable to reapply the active draft after tab load.", error);
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

  if (typeof response.error === "string" && response.error.trim()) {
    throw new Error(response.error.trim());
  }

  return response;
}

async function runAssistantTurn(payload) {
  const prompt =
    typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  const previousResponseId =
    typeof payload?.previousResponseId === "string" && payload.previousResponseId.trim()
      ? payload.previousResponseId.trim()
      : null;

  if (!prompt) {
    throw new Error("Enter a message before asking Vibe Pilot.");
  }

  const messages = [];
  let assistantResponseCount = 0;
  const publishMessage = (message) => {
    const nextMessage = upsertTranscriptMessage(messages, message);
    broadcastAssistantProgress({
      message: nextMessage,
      type: "assistant-message-upsert",
    });
    return nextMessage;
  };
  const createAssistantMessageId = () => {
    assistantResponseCount += 1;
    return createTranscriptMessageId(`assistant-${assistantResponseCount}`);
  };

  let emptyResponseRetryCount = 0;
  let assistantMessageId = createAssistantMessageId();
  let response = await requestAssistantResponse({
    input: [buildAssistantUserInput(prompt)],
    previousResponseId,
  }, {
    assistantMessageId,
    onAssistantMessage: publishMessage,
  });
  ({
    assistantMessageId,
    response,
    retryCount: emptyResponseRetryCount,
  } = await recoverEmptyAssistantResponse(response, emptyResponseRetryCount, {
    assistantMessageId,
    createAssistantMessageId,
    onAssistantMessage: publishMessage,
  }));
  publishFinalAssistantMessage(response, assistantMessageId, publishMessage);
  let toolStepCount = 0;

  while (response.functionCalls.length > 0) {
    toolStepCount += 1;

    if (toolStepCount > ASSISTANT_MAX_TOOL_STEPS) {
      messages.push(
        createTranscriptMessage("assistant", [
          "I reached the tool-step limit before I was fully done.",
          "Please narrow the request or ask me to continue from here.",
        ].join(" "), {
          status: "error",
        }),
      );
      break;
    }

    const toolOutputs = [];

    for (const call of response.functionCalls) {
      const toolMessageId = createAssistantToolMessageId(call.callId);
      publishMessage(
        createTranscriptMessage(
          "tool",
          buildPendingToolTranscriptText(call.name),
          {
            id: toolMessageId,
            status: "running",
            toolArgumentsText: call.argumentsText,
            toolName: call.name,
          },
        ),
      );

      const execution = await executeAssistantToolCall(call, {
        messageId: toolMessageId,
      });
      toolOutputs.push(execution.outputItem);
      execution.messages.forEach((message) => {
        publishMessage(message);
      });
    }

    assistantMessageId = createAssistantMessageId();
    response = await requestAssistantResponse({
      input: toolOutputs,
      previousResponseId: response.responseId,
    }, {
      assistantMessageId,
      onAssistantMessage: publishMessage,
    });
    ({
      assistantMessageId,
      response,
      retryCount: emptyResponseRetryCount,
    } = await recoverEmptyAssistantResponse(response, emptyResponseRetryCount, {
      assistantMessageId,
      createAssistantMessageId,
      onAssistantMessage: publishMessage,
    }));
    publishFinalAssistantMessage(response, assistantMessageId, publishMessage);
  }

  if (!messages.length) {
    publishMessage(
      createTranscriptMessage(
        "assistant",
        "I finished the request, but I did not receive a final text reply from the model.",
      ),
    );
  }

  return {
    activeTab: await getTargetTabDetails(),
    backendUrl: BACKEND_URL,
    currentDraft: await loadWorkspaceDraft(),
    messages,
    previousResponseId: response.responseId,
  };
}

async function recoverEmptyAssistantResponse(response, retryCount, options = {}) {
  let nextResponse = response;
  let nextRetryCount = retryCount;
  let assistantMessageId =
    typeof options.assistantMessageId === "string" && options.assistantMessageId.trim()
      ? options.assistantMessageId.trim()
      : createTranscriptMessageId("assistant-retry");

  while (
    nextRetryCount < ASSISTANT_EMPTY_RESPONSE_RETRY_LIMIT &&
    !nextResponse.functionCalls.length &&
    !nextResponse.assistantText.trim()
  ) {
    nextRetryCount += 1;
    assistantMessageId =
      typeof options.createAssistantMessageId === "function"
        ? options.createAssistantMessageId()
        : createTranscriptMessageId(`assistant-retry-${nextRetryCount}`);
    nextResponse = await requestAssistantResponse({
      input: [
        buildAssistantDeveloperInput(
          [
            "Your previous response was empty.",
            "You must either call tools, send a concise final answer, or explain a concrete blocker.",
            "If the user asked for page changes, do not stop before inspecting or editing unless you are blocked.",
          ].join(" "),
        ),
      ],
      previousResponseId: nextResponse.responseId,
    }, {
      assistantMessageId,
      onAssistantMessage: options.onAssistantMessage,
    });
  }

  return {
    assistantMessageId,
    response: nextResponse,
    retryCount: nextRetryCount,
  };
}

async function requestAssistantResponse(payload, options = {}) {
  const response = await fetchAssistantResponsePayload("/api/assistant", payload, {
    assistantMessageId:
      typeof options.assistantMessageId === "string" && options.assistantMessageId.trim()
        ? options.assistantMessageId.trim()
        : createTranscriptMessageId("assistant"),
    onAssistantMessage:
      typeof options.onAssistantMessage === "function"
        ? options.onAssistantMessage
        : null,
    timeoutMs: ASSISTANT_BACKEND_TIMEOUT_MS,
  });

  return {
    assistantText:
      typeof response?.assistantText === "string" ? response.assistantText : "",
    functionCalls: Array.isArray(response?.functionCalls) ? response.functionCalls : [],
    responseId:
      typeof response?.responseId === "string" && response.responseId.trim()
        ? response.responseId.trim()
        : null,
  };
}

async function fetchAssistantResponsePayload(path, payload, options = {}) {
  const candidates = buildBackendCandidateUrls(path);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];

    try {
      return await readAssistantResponse(url, payload, options);
    } catch (error) {
      lastError = error;

      if (
        index < candidates.length - 1 &&
        shouldRetryAssistantWithLocalBackend(error, url)
      ) {
        console.warn(
          "Assistant backend request failed; retrying with the local backend.",
          {
            details:
              error instanceof Error ? error.message : String(error ?? ""),
            url,
          },
        );
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The assistant backend request failed.");
}

async function readAssistantResponse(url, payload, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : ASSISTANT_BACKEND_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Timed out while waiting for ${url}.`));
  }, timeoutMs);

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-Vibe-Pilot-Stream": "1",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const wrapped = new Error(
      `Unable to reach the backend at ${url}. ${
        error instanceof Error ? error.message : "Unknown network error."
      }`,
    );
    wrapped.backendUrl = url;
    wrapped.cause = error instanceof Error ? error : undefined;
    throw wrapped;
  }

  if (!response.ok) {
    const details = await response.text();
    const wrapped = new Error(
      details || `Backend request failed with status ${response.status}.`,
    );
    wrapped.backendDetails = details;
    wrapped.backendStatus = response.status;
    wrapped.backendUrl = url;
    throw wrapped;
  }

  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (
      !contentType.toLowerCase().includes("text/event-stream") ||
      !response.body
    ) {
      return await response.json();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const assistantMessageId =
      typeof options.assistantMessageId === "string" && options.assistantMessageId.trim()
        ? options.assistantMessageId.trim()
        : createTranscriptMessageId("assistant");
    let assistantText = "";
    let buffer = "";
    let finalPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });
      const events = extractSseEvents(buffer);
      buffer = events.remainder;

      for (const event of events.items) {
        if (event.type === "assistant.text_delta") {
          const delta =
            typeof event.data?.delta === "string" ? event.data.delta : "";

          if (!delta) {
            continue;
          }

          assistantText += delta;
          if (typeof options.onAssistantMessage === "function") {
            options.onAssistantMessage(
              createTranscriptMessage("assistant", assistantText, {
                id: assistantMessageId,
                status: "streaming",
              }),
            );
          }
          continue;
        }

        if (event.type === "assistant.response") {
          finalPayload = event.data;
          continue;
        }

        if (event.type === "assistant.error") {
          throw new Error(
            typeof event.data?.error === "string" && event.data.error.trim()
              ? event.data.error.trim()
              : "The assistant stream reported an unknown error.",
          );
        }
      }

      if (done) {
        break;
      }
    }

    const trailingEvent = parseSseEvent(buffer);
    if (trailingEvent) {
      if (trailingEvent.type === "assistant.response") {
        finalPayload = trailingEvent.data;
      } else if (trailingEvent.type === "assistant.error") {
        throw new Error(
          typeof trailingEvent.data?.error === "string" &&
            trailingEvent.data.error.trim()
            ? trailingEvent.data.error.trim()
            : "The assistant stream reported an unknown error.",
        );
      }
    }

    if (!finalPayload) {
      throw new Error(
        "The assistant stream ended before it returned a final response payload.",
      );
    }

    return finalPayload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractSseEvents(buffer) {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() ?? "";

  return {
    items: chunks
      .map((chunk) => parseSseEvent(chunk))
      .filter(Boolean),
    remainder,
  };
}

function parseSseEvent(chunk) {
  if (typeof chunk !== "string" || !chunk.trim()) {
    return null;
  }

  const lines = chunk.split(/\r?\n/);
  const dataLines = [];
  let type = "message";

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim() || "message";
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  try {
    return {
      data: JSON.parse(dataLines.join("\n")),
      type,
    };
  } catch {
    return null;
  }
}

function buildBackendCandidateUrls(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = [`${BACKEND_URL}${normalizedPath}`];

  if (!isLocalBackendUrl(BACKEND_URL)) {
    candidates.push(`${LOCAL_BACKEND_URL}${normalizedPath}`);
  }

  return Array.from(new Set(candidates));
}

function shouldRetryAssistantWithLocalBackend(error, candidateUrl) {
  if (isLocalBackendUrl(candidateUrl)) {
    return false;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "");
  const backendStatus =
    error instanceof Error && typeof error.backendStatus === "number"
      ? error.backendStatus
      : null;

  if (
    message.includes("Assistant request payload was invalid.") &&
    message.includes("\"prompt\"") &&
    message.includes("\"currentDraft\"")
  ) {
    return true;
  }

  return backendStatus === 404 || backendStatus >= 500;
}

function isLocalBackendUrl(value) {
  try {
    return new URL(value).origin === new URL(LOCAL_BACKEND_URL).origin;
  } catch {
    return false;
  }
}

function publishFinalAssistantMessage(response, messageId, publishMessage) {
  const assistantText =
    typeof response?.assistantText === "string" ? response.assistantText.trim() : "";

  if (!assistantText) {
    return;
  }

  publishMessage(
    createTranscriptMessage("assistant", assistantText, {
      id: messageId,
      status: "ok",
    }),
  );
}

function buildAssistantUserInput(prompt) {
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: prompt,
      },
    ],
  };
}

function buildAssistantDeveloperInput(text) {
  return {
    type: "message",
    role: "developer",
    content: [
      {
        type: "input_text",
        text,
      },
    ],
  };
}

async function executeAssistantToolCall(call, options = {}) {
  const toolName =
    typeof call?.name === "string" && call.name.trim() ? call.name.trim() : "";
  const callId =
    typeof call?.callId === "string" && call.callId.trim() ? call.callId.trim() : "";
  const rawArguments =
    isRecord(call?.arguments) ? call.arguments : parseToolArguments(call?.argumentsText);
  const toolArgumentsText =
    typeof call?.argumentsText === "string" ? call.argumentsText : "";
  const messageId =
    typeof options.messageId === "string" && options.messageId.trim()
      ? options.messageId.trim()
      : createAssistantToolMessageId(callId || toolName || "tool");

  if (!toolName || !callId) {
    return {
      outputItem: {
        type: "function_call_output",
        call_id: callId || `missing-${Date.now()}`,
        output: "The tool call payload was missing a name or call id.",
      },
      messages: [
        createTranscriptMessage(
          "tool",
          "A malformed tool call was skipped because it was missing a name or id.",
          {
            id: messageId,
            status: "error",
            toolArgumentsText,
            toolName: toolName || "unknown",
          },
        ),
      ],
    };
  }

  const handler = ASSISTANT_TOOL_EXECUTORS[toolName];
  if (typeof handler !== "function") {
    return {
      outputItem: {
        type: "function_call_output",
        call_id: callId,
        output: `Tool "${toolName}" is not available in the extension runtime.`,
      },
      messages: [
        createTranscriptMessage(
          "tool",
          `The runtime could not find the "${toolName}" tool.`,
          {
            id: messageId,
            status: "error",
            toolArgumentsText,
            toolName,
          },
        ),
      ],
    };
  }

  try {
    const execution = await handler(rawArguments ?? {});

    return {
      outputItem: {
        type: "function_call_output",
        call_id: callId,
        output: execution.output,
      },
      messages: [
        createTranscriptMessage("tool", execution.transcriptText, {
          id: messageId,
          images: execution.images ?? [],
          status: execution.status ?? "ok",
          toolArgumentsText,
          toolName,
        }),
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown tool execution error.";

    return {
      outputItem: {
        type: "function_call_output",
        call_id: callId,
        output: `Tool "${toolName}" failed: ${message}`,
      },
      messages: [
        createTranscriptMessage("tool", message, {
          id: messageId,
          status: "error",
          toolArgumentsText,
          toolName,
        }),
      ],
    };
  }
}

const ASSISTANT_TOOL_EXECUTORS = {
  async get_active_tab_info() {
    const tab = await getRequiredTargetTabDetails();

    return {
      output: stringifyJson(tab),
      transcriptText: `Read the active tab: ${tab.title}.`,
    };
  },
  async navigate_page(args) {
    const url =
      typeof args.url === "string" && args.url.trim() ? args.url.trim() : "";

    if (!isInspectableUrl(url)) {
      throw new Error("navigate_page requires a fully qualified http(s) URL.");
    }

    const details = await navigateTargetTab(url);

    return {
      output: stringifyJson(details),
      transcriptText: `Navigated the working page to ${details.url}.`,
    };
  },
  async reload_page() {
    const details = await reloadTargetTab();

    return {
      output: stringifyJson(details),
      transcriptText: `Reloaded ${safeHostnameFromUrl(details.url) ?? "the current page"}.`,
    };
  },
  async get_page_context(args) {
    const result = await inspectPageWithContentScript("VIBE_PILOT_GET_PAGE_CONTEXT", {
      includeHtml: Boolean(args.includeHtml),
    });

    return {
      output: stringifyJson(result),
      transcriptText: `Inspected the page context for ${safeHostnameFromUrl(result.url) ?? "the current tab"}.`,
    };
  },
  async query_dom(args) {
    const selector =
      typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : "";

    if (!selector) {
      throw new Error("query_dom requires a non-empty selector.");
    }

    const result = await inspectPageWithContentScript("VIBE_PILOT_QUERY_DOM", {
      attributeNames: Array.isArray(args.attributeNames)
        ? args.attributeNames.filter((value) => typeof value === "string").slice(0, 12)
        : [],
      includeHtml: Boolean(args.includeHtml),
      includeText: args.includeText !== false,
      maxItems: clampInteger(args.maxItems, 1, 12, 5),
      selector,
    });

    return {
      output: stringifyJson(result),
      transcriptText: `Queried ${result.count} DOM node${result.count === 1 ? "" : "s"} with "${selector}".`,
    };
  },
  async scroll_page(args) {
    const result = await inspectPageWithContentScript("VIBE_PILOT_SCROLL_PAGE", {
      block:
        typeof args.block === "string" && args.block.trim() ? args.block.trim() : "center",
      left: typeof args.left === "number" ? args.left : undefined,
      selector:
        typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : "",
      top: typeof args.top === "number" ? args.top : undefined,
    });

    return {
      output: stringifyJson(result),
      transcriptText: result.selector
        ? `Scrolled to the first element matching "${result.selector}".`
        : `Scrolled the page to x=${Math.round(result.scrollX)}, y=${Math.round(result.scrollY)}.`,
    };
  },
  async take_screenshot(args) {
    const screenshot = await captureTargetTabScreenshot({
      label:
        typeof args.label === "string" && args.label.trim() ? args.label.trim() : "Page screenshot",
    });
    const previewDataUrl = await optimizeScreenshotDataUrl(screenshot.dataUrl);

    return {
      output: [
        {
          type: "input_text",
          text: stringifyJson(screenshot.meta),
        },
        {
          type: "input_image",
          image_url: previewDataUrl,
          detail: "low",
        },
      ],
      images: [
        {
          alt: screenshot.meta.label,
          label: screenshot.meta.label,
          url: previewDataUrl,
        },
      ],
      transcriptText: `Captured a screenshot of ${safeHostnameFromUrl(screenshot.meta.url) ?? "the current page"}.`,
    };
  },
  async read_current_draft() {
    const draft = (await loadWorkspaceDraft()) ?? EMPTY_WORKSPACE_RULE;

    return {
      output: stringifyJson(draft),
      transcriptText: `Read the current draft${draft.name ? ` "${draft.name}"` : ""}.`,
    };
  },
  async update_current_draft(args) {
    const currentDraft = (await loadWorkspaceDraft()) ?? EMPTY_WORKSPACE_RULE;
    const nextDraft = normalizeDraft({
      id: currentDraft.id,
      name: readAssistantDraftPatch(args, "name", currentDraft.name),
      matchPattern: readAssistantDraftPatch(
        args,
        "matchPattern",
        currentDraft.matchPattern,
      ),
      html: readAssistantDraftPatch(args, "html", currentDraft.html),
      css: readAssistantDraftPatch(args, "css", currentDraft.css),
      javascript: readAssistantDraftPatch(
        args,
        "javascript",
        currentDraft.javascript,
      ),
      files: readAssistantDraftPatch(args, "files", currentDraft.files),
    });

    if (!hasRuleContent(nextDraft)) {
      throw new Error(
        "The updated draft would be empty. Keep at least one of html, css, javascript, or files populated.",
      );
    }

    await setWorkspaceDraft(nextDraft);

    return {
      output: stringifyJson(nextDraft),
      transcriptText: `Updated the current draft${nextDraft.name ? ` to "${nextDraft.name}"` : ""}.`,
    };
  },
  async apply_current_draft() {
    const draft = (await loadWorkspaceDraft()) ?? EMPTY_WORKSPACE_RULE;
    const result = await applyDraft(draft);

    return {
      output: stringifyJson(result),
      transcriptText: `Applied the current draft to ${result.appliedTabCount ?? 0} matching tab${result.appliedTabCount === 1 ? "" : "s"}.`,
    };
  },
  async clear_live_changes() {
    const result = await clearRegisteredScript();

    return {
      output: stringifyJson(result),
      transcriptText: "Cleared the live Vibe Pilot overlay from matching tabs.",
    };
  },
};

async function inspectPageWithContentScript(type, payload) {
  const tab = await getRequiredTargetTab();
  let response;

  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type,
      payload,
    });
  } catch (error) {
    if (shouldRetryContentScriptMessage(error)) {
      await waitForContentScriptReady(tab.id);
      response = await chrome.tabs.sendMessage(tab.id, {
        type,
        payload,
      });
    } else {
      throw error;
    }
  }

  if (!response) {
    throw new Error("The content script did not return a page inspection result.");
  }

  if (typeof response.error === "string" && response.error.trim()) {
    throw new Error(response.error.trim());
  }

  return response;
}

async function captureTargetTabScreenshot(options = {}) {
  const tab = await getRequiredTargetTab();
  const details = await getRequiredTargetTabDetails();
  const waitMs = SCREENSHOT_CAPTURE_COOLDOWN_MS - (Date.now() - lastScreenshotCapturedAt);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  const dataUrl = await captureVisibleTargetTab(tab);
  lastScreenshotCapturedAt = Date.now();

  return {
    dataUrl,
    meta: {
      capturedAt: new Date().toISOString(),
      label:
        typeof options.label === "string" && options.label.trim()
          ? options.label.trim()
          : "Page screenshot",
      title: details.title,
      url: details.url,
    },
  };
}

async function getRequiredTargetTab() {
  const tab = await getTargetTab();
  if (!tab?.id) {
    throw new Error("No active http(s) tab was available.");
  }

  if (typeof tab.windowId !== "number") {
    throw new Error("The active tab did not expose a window id for screenshot capture.");
  }

  if (!tab.url || !isInspectableUrl(tab.url)) {
    throw new Error("Open a normal http(s) page before using Vibe Pilot page tools.");
  }

  return tab;
}

async function getRequiredTargetTabDetails() {
  const tab = await getTargetTabDetails();
  if (!tab) {
    throw new Error("No active http(s) tab was available.");
  }

  return tab;
}

async function navigateTargetTab(url) {
  const existingTab = await getTargetTab();

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { url });
    const updatedTab = await waitForTabComplete(existingTab.id);
    await waitForContentScriptReady(existingTab.id);
    await delay(350);
    return toTabDetails(updatedTab);
  }

  const createdTab = await chrome.tabs.create({
    active: false,
    url,
  });

  if (!createdTab.id) {
    throw new Error("Chrome did not return a tab id after creating a new page tab.");
  }

  const loadedTab = await waitForTabComplete(createdTab.id);
  await waitForContentScriptReady(createdTab.id);
  await delay(350);
  return toTabDetails(loadedTab);
}

async function reloadTargetTab() {
  const tab = await getRequiredTargetTab();

  await chrome.tabs.reload(tab.id);
  const reloadedTab = await waitForTabComplete(tab.id);
  await waitForContentScriptReady(tab.id);
  await delay(350);

  return toTabDetails(reloadedTab);
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for tab ${tabId} to finish loading.`));
    }, timeoutMs);

    const handleUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) {
        return;
      }

      if (changeInfo.status === "complete") {
        cleanup();
        resolve(tab);
      }
    };

    const cleanup = () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);

    void chrome.tabs.get(tabId).then((tab) => {
      if (finished) {
        return;
      }

      if (tab?.status === "complete") {
        cleanup();
        resolve(tab);
      }
    }).catch((error) => {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error(`Unable to read tab ${tabId} while waiting for it to load.`),
      );
    });
  });
}

function toTabDetails(tab) {
  return {
    id: tab?.id ?? null,
    title: tab?.title ?? "Untitled tab",
    url: tab?.url ?? "Unknown URL",
  };
}

async function waitForContentScriptReady(tabId, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "VIBE_PILOT_PING",
      });

      if (response?.ok) {
        return response;
      }
    } catch (error) {
      if (!shouldRetryContentScriptMessage(error)) {
        throw error;
      }
    }

    await delay(125);
  }

  throw new Error("Timed out waiting for the page tools to attach to the tab.");
}

function shouldRetryContentScriptMessage(error) {
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

async function captureVisibleTargetTab(tab) {
  if (typeof tab?.id !== "number" || typeof tab?.windowId !== "number") {
    throw new Error("The target tab could not be prepared for screenshot capture.");
  }

  const activeTab = await getActiveTabInWindow(tab.windowId);
  const restoreTabId =
    typeof activeTab?.id === "number" && activeTab.id !== tab.id ? activeTab.id : null;

  if (restoreTabId != null) {
    await chrome.tabs.update(tab.id, {
      active: true,
    });
    await delay(200);
  }

  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 70,
    });
  } finally {
    if (restoreTabId != null) {
      await chrome.tabs.update(restoreTabId, {
        active: true,
      }).catch(() => {
        // Ignore tabs that disappear while the screenshot is being restored.
      });
    }
  }
}

async function optimizeScreenshotDataUrl(dataUrl) {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap !== "function" ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/")
  ) {
    return dataUrl;
  }

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(
      1,
      SCREENSHOT_PREVIEW_MAX_WIDTH / bitmap.width,
      SCREENSHOT_PREVIEW_MAX_HEIGHT / bitmap.height,
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return dataUrl;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const optimizedBlob = await canvas.convertToBlob({
      quality: SCREENSHOT_PREVIEW_QUALITY,
      type: "image/jpeg",
    });

    return await blobToDataUrl(optimizedBlob);
  } catch (error) {
    console.warn("Unable to optimize screenshot payload.", error);
    return dataUrl;
  }
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

async function getActiveTabInWindow(windowId) {
  const tabs = await chrome.tabs.query({
    active: true,
    windowId,
  });

  return tabs[0] ?? null;
}

function broadcastAssistantProgress(message) {
  for (const port of Array.from(assistantProgressPorts)) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn("Unable to deliver assistant progress to a port.", error);
      assistantProgressPorts.delete(port);
    }
  }
}

function upsertTranscriptMessage(messages, nextMessage) {
  const nextId =
    typeof nextMessage?.id === "string" && nextMessage.id.trim()
      ? nextMessage.id.trim()
      : createTranscriptMessageId(nextMessage?.role ?? "assistant");
  const normalizedMessage = {
    ...nextMessage,
    id: nextId,
  };
  const existingIndex = messages.findIndex((message) => message.id === nextId);

  if (existingIndex < 0) {
    messages.push(normalizedMessage);
    return normalizedMessage;
  }

  const existingMessage = messages[existingIndex];
  const mergedMessage = {
    ...existingMessage,
    ...normalizedMessage,
    createdAt:
      typeof existingMessage?.createdAt === "string" && existingMessage.createdAt.trim()
        ? existingMessage.createdAt
        : normalizedMessage.createdAt,
  };

  messages[existingIndex] = mergedMessage;
  return mergedMessage;
}

function createTranscriptMessageId(prefix = "message") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAssistantToolMessageId(callId) {
  const normalizedCallId =
    typeof callId === "string" && callId.trim() ? callId.trim() : "tool";

  return `tool-${normalizedCallId}`;
}

function buildPendingToolTranscriptText(toolName) {
  const label = formatAssistantToolLabel(toolName) || "Tool";
  return `Running ${label}...`;
}

function formatAssistantToolLabel(value) {
  const normalized =
    typeof value === "string" && value.trim() ? value.trim() : "";

  if (!normalized) {
    return "";
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createTranscriptMessage(role, text, options = {}) {
  return {
    createdAt:
      typeof options.createdAt === "string" && options.createdAt.trim()
        ? options.createdAt.trim()
        : new Date().toISOString(),
    id:
      typeof options.id === "string" && options.id.trim()
        ? options.id.trim()
        : createTranscriptMessageId(role),
    images: Array.isArray(options.images) ? options.images : [],
    role,
    status: options.status ?? "ok",
    text,
    toolArgumentsText:
      typeof options.toolArgumentsText === "string"
        ? options.toolArgumentsText
        : "",
    toolName: options.toolName ?? null,
  };
}

function parseToolArguments(argumentsText) {
  if (typeof argumentsText !== "string" || !argumentsText.trim()) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    return {};
  }
}

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

function clampInteger(value, minimum, maximum, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function readAssistantDraftPatch(args, key, fallback) {
  if (!hasOwn(args, key) || args[key] == null) {
    return fallback;
  }

  return args[key];
}

function hasRuleContent(rule) {
  if (
    Array.isArray(rule?.files) &&
    normalizeRuleFiles(rule.files).length > 0
  ) {
    return true;
  }

  return [rule?.html, rule?.css, rule?.javascript].some(
    (part) => typeof part === "string" && part.trim(),
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeRuleFiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const filesByPath = new Map();

  for (const entry of value) {
    const path = normalizeRuleFilePath(entry?.path);
    if (!path) {
      continue;
    }

    filesByPath.set(path, {
      path,
      mimeType:
        typeof entry?.mimeType === "string" ? entry.mimeType.trim() : "",
      content: typeof entry?.content === "string" ? entry.content : "",
    });
  }

  return Array.from(filesByPath.values());
}

function normalizeRuleFilePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
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
    files: normalizeRuleFiles(payload?.files),
  };
}

async function persistRule(draft) {
  const normalizedRule = normalizeDraft(draft);
  const requestBody = {
    name: readRequiredRuleName(normalizedRule.name),
    matchPattern: normalizedRule.matchPattern,
    html: normalizedRule.html,
    css: normalizedRule.css,
    javascript: normalizedRule.javascript,
    files: normalizedRule.files,
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
    const wrapped = new Error(
      `Unable to reach the backend at ${url}. ${
        error instanceof Error ? error.message : "Unknown network error."
      }`,
    );
    wrapped.backendUrl = url;
    wrapped.cause = error instanceof Error ? error : undefined;
    throw wrapped;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const details = await response.text();
    const wrapped = new Error(
      details || `Backend request failed with status ${response.status}.`,
    );
    wrapped.backendDetails = details;
    wrapped.backendStatus = response.status;
    wrapped.backendUrl = url;
    throw wrapped;
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

function hasLegacyTargetMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return (
    Object.prototype.hasOwnProperty.call(payload, "targetUrl") ||
    Object.prototype.hasOwnProperty.call(payload, "targetTitle")
  );
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
