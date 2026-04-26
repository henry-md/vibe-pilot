const ACTIVE_SCRIPT_ID = "vibe-pilot-live-script";
const STORAGE_KEYS = {
  draft: "vibePilotDraft",
  pendingHotReload: "vibePilotPendingHotReload",
  pendingHotReloadTabId: "vibePilotPendingHotReloadTabId",
  backendUrl: "vibePilotBackendUrl",
};
const DEFAULT_BACKEND_URL = "http://127.0.0.1:3001";

const DEFAULT_DRAFT = {
  matchPattern: "*://*/*",
  html: [
    '<div class="vp-badge">',
    "  <strong>Vibe Pilot</strong>",
    "  <span>Live overlay</span>",
    "</div>",
  ].join("\n"),
  css: [
    ".vp-badge {",
    "  position: fixed;",
    "  top: 16px;",
    "  right: 16px;",
    "  z-index: 2147483647;",
    "  display: grid;",
    "  gap: 4px;",
    "  padding: 12px 14px;",
    "  border-radius: 16px;",
    "  background: rgba(27, 20, 27, 0.92);",
    "  color: #fff7ef;",
    "  box-shadow: 0 18px 40px rgba(32, 20, 23, 0.28);",
    "  font-family: Inter, system-ui, sans-serif;",
    "}",
  ].join("\n"),
  javascript: [
    'const headline = document.querySelector("h1, h2");',
    "if (headline) {",
    '  headline.style.textTransform = "uppercase";',
    '  headline.style.letterSpacing = "0.08em";',
    "}",
  ].join("\n"),
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

  const storedDraft = await loadDraft();
  if (!storedDraft) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.draft]: DEFAULT_DRAFT,
    });
  }

  const storedBackendUrl = await loadBackendUrl();
  if (!storedBackendUrl) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.backendUrl]: DEFAULT_BACKEND_URL,
    });
  }

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
    case "VIBE_PILOT_SET_BACKEND_URL":
      return saveBackendUrl(message.payload?.backendUrl ?? message.payload);
    case "VIBE_PILOT_SAVE_REMOTE_DRAFT":
      return saveRemoteDraft(message.payload);
    case "VIBE_PILOT_LOAD_REMOTE_DRAFTS":
      return loadRemoteDrafts(message.payload);
    default:
      throw new Error(`Unknown message type: ${message?.type ?? "undefined"}`);
  }
}

async function getStatusPayload() {
  const [draft, activeTab, availability, registered, backendUrl] = await Promise.all([
    loadDraft(),
    getActiveTabDetails(),
    getUserScriptsAvailability(),
    hasRegisteredLiveScript(),
    loadBackendUrl(),
  ]);

  return {
    activeTab,
    backendUrl,
    draft: draft ?? DEFAULT_DRAFT,
    liveScriptRegistered: registered,
    userScripts: availability,
  };
}

async function saveDraft(payload) {
  const draft = normalizeDraft(payload);
  await chrome.storage.local.set({
    [STORAGE_KEYS.draft]: draft,
  });

  return draft;
}

async function applyDraft(payload) {
  const draft = await saveDraft(payload);
  const availability = await getUserScriptsAvailability();

  if (!availability.available) {
    throw new Error(availability.message);
  }

  await registerLiveScript(draft);
  await injectIntoActiveTab(draft);

  return {
    applied: true,
    draft,
  };
}

async function saveRemoteDraft(payload) {
  const draft = normalizeDraft(payload?.draft ?? payload);
  const backendUrl = await resolveBackendUrl(payload?.backendUrl);
  const activeTab = await getActiveTabDetails();
  const response = await fetchJson(`${backendUrl}/api/script-drafts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...draft,
      name: buildDraftName(activeTab),
      source: "extension",
      targetTitle: activeTab?.title ?? null,
      targetUrl: activeTab?.url ?? null,
    }),
  });

  return {
    backendUrl,
    ...response,
  };
}

async function loadRemoteDrafts(payload) {
  const backendUrl = await resolveBackendUrl(payload?.backendUrl);
  const response = await fetchJson(
    `${backendUrl}/api/script-drafts?limit=5`,
  );

  return {
    backendUrl,
    ...response,
  };
}

async function clearRegisteredScript() {
  if (chrome.userScripts) {
    await chrome.userScripts.unregister({ ids: [ACTIVE_SCRIPT_ID] });
  }

  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        document.getElementById("__vibe_pilot_root__")?.remove();
        document.getElementById("__vibe_pilot_style__")?.remove();
      },
    });
  }

  return {
    cleared: true,
  };
}

async function prepareHotReload(payload) {
  const draft = normalizeDraft(payload?.draft ?? payload ?? DEFAULT_DRAFT);
  const activeTab = await getActiveTab();

  await chrome.storage.local.set({
    [STORAGE_KEYS.draft]: draft,
    [STORAGE_KEYS.pendingHotReload]: true,
    [STORAGE_KEYS.pendingHotReloadTabId]: activeTab?.id ?? null,
  });

  return {
    prepared: true,
    tabId: activeTab?.id ?? null,
  };
}

async function restoreRegisteredScript() {
  const draft = await loadDraft();
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

  await chrome.userScripts.unregister({ ids: [ACTIVE_SCRIPT_ID] });
  await chrome.userScripts.register([script]);
}

async function injectIntoActiveTab(draft) {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    return;
  }

  if (chrome.userScripts?.execute) {
    await chrome.userScripts.execute({
      target: { tabId: activeTab.id },
      js: [{ code: buildUserScriptCode(draft) }],
      injectImmediately: true,
      world: "MAIN",
    });
    return;
  }

  await chrome.tabs.reload(activeTab.id);
}

function buildUserScriptCode(draft) {
  const html = JSON.stringify(draft.html);
  const css = JSON.stringify(draft.css);
  const javascript = draft.javascript || "";

  return `
(() => {
  const htmlSnippet = ${html};
  const cssSnippet = ${css};
  const rootId = "__vibe_pilot_root__";
  const styleId = "__vibe_pilot_style__";

  const ensureStyle = () => {
    if (!cssSnippet) {
      return;
    }

    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.documentElement.appendChild(style);
    }

    if (style.textContent !== cssSnippet) {
      style.textContent = cssSnippet;
    }
  };

  const ensureRoot = () => {
    if (!htmlSnippet) {
      return null;
    }

    const parent = document.body ?? document.documentElement;
    if (!parent) {
      return null;
    }

    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      root.dataset.vibePilot = "managed";
      parent.appendChild(root);
    }

    if (root.innerHTML !== htmlSnippet) {
      root.innerHTML = htmlSnippet;
    }

    return root;
  };

  const api = {
    rootId,
    styleId,
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
  const stored = await chrome.storage.local.get(STORAGE_KEYS.draft);
  return stored[STORAGE_KEYS.draft] ?? null;
}

async function loadBackendUrl() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.backendUrl);
  return stored[STORAGE_KEYS.backendUrl] ?? null;
}

async function saveBackendUrl(value) {
  const backendUrl = normalizeBackendUrl(value);
  await chrome.storage.local.set({
    [STORAGE_KEYS.backendUrl]: backendUrl,
  });

  return backendUrl;
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
  try {
    chrome.userScripts.getScripts();
    return {
      available: true,
      message: "User scripts are available in this Chrome profile.",
    };
  } catch {
    return {
      available: false,
      message:
        "Enable Developer Mode and the Allow User Scripts toggle for this extension in chrome://extensions.",
    };
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs[0] ?? null;
}

async function getActiveTabDetails() {
  const tab = await getActiveTab();
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
  const tab = await getActiveTab();
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

async function resolveBackendUrl(value) {
  if (typeof value === "string" && value.trim()) {
    return saveBackendUrl(value);
  }

  const storedBackendUrl = await loadBackendUrl();
  if (storedBackendUrl) {
    return storedBackendUrl;
  }

  return saveBackendUrl(DEFAULT_BACKEND_URL);
}

function normalizeBackendUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_BACKEND_URL;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_BACKEND_URL;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function buildDraftName(activeTab) {
  if (activeTab?.title) {
    return `Draft for ${activeTab.title}`;
  }

  return `Draft ${new Date().toISOString()}`;
}

async function fetchJson(url, init) {
  let response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      `Unable to reach the backend at ${url}. ${
        error instanceof Error ? error.message : "Unknown network error."
      }`,
    );
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      details || `Backend request failed with status ${response.status}.`,
    );
  }

  return response.json();
}
