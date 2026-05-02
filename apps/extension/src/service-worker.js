import { BACKEND_URL, HOT_RELOAD_ENABLED } from "./config.js";
import {
  DEFAULT_DRAFT,
  DEFAULT_WORKSPACE_RULE,
  EMPTY_WORKSPACE_RULE,
} from "./default-draft.js";

const ACTIVE_SCRIPT_ID = "vibe-pilot-live-script";
const ACTIVE_SCRIPT_ID_PREFIX = "vibe-pilot-live-script-";
const ACTIVE_CSS_LOADER_ID = "vibe-pilot-css-loader";
const ASSISTANT_PROGRESS_PORT_NAME = "vibe-pilot-assistant-progress";
const DEFAULT_REMOTE_BACKEND_URL = "https://vibe-pilotweb-production.up.railway.app";
const LOCAL_BACKEND_URL = "http://127.0.0.1:3001";
const OVERLAY_HOST_ID = "__vibe_pilot_host__";
const OVERLAY_ROOT_ID = "__vibe_pilot_root__";
const OVERLAY_STYLE_ID = "__vibe_pilot_style__";
const STYLE_LOADER_FILE = "style-loader.js";
const BACKEND_HEALTH_PROBE_TIMEOUT_MS = 1500;
const BACKEND_HEALTH_CACHE_TTL_MS = 15000;
const TAB_INJECTION_TIMEOUT_MS = 2500;
const SCRIPTING_OPERATION_TIMEOUT_MS = 1800;
const USER_CSS_REMOVAL_ATTEMPTS = 32;
const RULE_BACKEND_TIMEOUT_MS = 8000;
const ASSISTANT_BACKEND_TIMEOUT_MS = 120000;
const ASSISTANT_MAX_TOOL_STEPS = 24;
const ASSISTANT_EMPTY_RESPONSE_RETRY_LIMIT = 2;
const CHAT_IMAGE_ATTACHMENT_LIMIT = 4;
const SCREENSHOT_CAPTURE_COOLDOWN_MS = 550;
const SCREENSHOT_PREVIEW_MAX_WIDTH = 960;
const SCREENSHOT_PREVIEW_MAX_HEIGHT = 960;
const SCREENSHOT_PREVIEW_QUALITY = 0.68;
const DOM_OBSERVE_DEFAULT_TIMEOUT_MS = 1600;
const DOM_OBSERVE_DEFAULT_QUIET_WINDOW_MS = 250;
const ONE_OFF_SCRIPT_MAX_LENGTH = 50000;
const FILE_LAYOUT_STORAGE_KEY = "vibePilotFileLayout";
const PROJECT_STATE_RESET_VERSION = 2;
const STORAGE_KEYS = {
  activeDraft: "vibePilotDraft",
  activeRules: "vibePilotActiveRules",
  projectsResetVersion: "vibePilotProjectsResetVersion",
  workspaceDraft: "vibePilotWorkspaceDraft",
  pendingHotReload: "vibePilotPendingHotReload",
  pendingHotReloadTabId: "vibePilotPendingHotReloadTabId",
};

const assistantProgressPorts = new Set();
let lastScreenshotCapturedAt = 0;
let localBackendPreferenceCheckedAt = 0;
let localBackendPreferencePromise = null;
let preferLocalBackendCache = false;

chrome.runtime.onInstalled.addListener((details) => {
  void bootstrap(details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  void handleStartup();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  void maybeReapplyActiveDraftToTab(tabId, tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
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
  await resetProjectStateIfNeeded();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await ensureDraftState();

  if (reason === "update") {
    await restoreRegisteredScript();
    await finalizeHotReload();
  }
}

async function handleStartup() {
  await resetProjectStateIfNeeded();
  await restoreRegisteredScript();
  await finalizeHotReload();
}

async function resetProjectStateIfNeeded() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.projectsResetVersion);
  const currentVersion = Number(stored[STORAGE_KEYS.projectsResetVersion] ?? 0);

  if (currentVersion >= PROJECT_STATE_RESET_VERSION) {
    return;
  }

  await clearRegisteredScript();
  await chrome.storage.local.remove([
    STORAGE_KEYS.activeDraft,
    STORAGE_KEYS.activeRules,
    STORAGE_KEYS.workspaceDraft,
    STORAGE_KEYS.pendingHotReload,
    STORAGE_KEYS.pendingHotReloadTabId,
    FILE_LAYOUT_STORAGE_KEY,
  ]);
  await chrome.storage.local.set({
    [STORAGE_KEYS.projectsResetVersion]: PROJECT_STATE_RESET_VERSION,
  });
}

async function handleMessage(message, sender) {
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
    case "VIBE_PILOT_APPLY_ACTIVE_CSS_TO_FRAME":
      return applyActiveCssToSenderFrame(sender);
    case "VIBE_PILOT_PREPARE_HOT_RELOAD":
      return prepareHotReload(message.payload);
    case "VIBE_PILOT_RUN_ASSISTANT":
      return runAssistantTurn(message.payload);
    case "VIBE_PILOT_GENERATE_DRAFT":
      return runAssistantTurn(message.payload);
    case "VIBE_PILOT_LIST_RULES":
      return listRules();
    case "VIBE_PILOT_GET_RULE":
      return getRule(message.payload);
    case "VIBE_PILOT_SET_RULE_ENABLED":
      return setRuleEnabled(message.payload);
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
    backendUrl: await getPreferredBackendBaseUrl(),
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
  const persistedRule = normalizeRuleRecord(payload);
  if (!draft.name) {
    throw new Error("Give this rule a name before saving it.");
  }

  const response = await persistRule(persistedRule);
  const savedRule = response.rule ? normalizeRuleRecord(response.rule) : persistedRule;
  await setWorkspaceDraft(savedRule);

  return {
    backendUrl: response.backendUrl,
    ...response,
    rule: savedRule,
  };
}

async function applyDraft(payload) {
  const draft = {
    ...normalizeDraft(payload),
    enabled: true,
  };
  const persistedRule = {
    ...normalizeRuleRecord(payload),
    enabled: true,
  };

  if (!draft.name) {
    throw new Error("Give this rule a name before you apply it.");
  }

  const injectionResult = await activateLiveRule(
    draft,
    "Registering the live rule took too long. Try applying again.",
  );

  let remoteSaved = false;
  let backendUrl = await getPreferredBackendBaseUrl();
  let savedRule = null;
  try {
    const response = await persistRule(persistedRule);
    savedRule = response.rule ? normalizeRuleRecord(response.rule) : null;
    backendUrl = response.backendUrl ?? backendUrl;
    if (savedRule) {
      await unregisterLiveScript(draft);
      await removeActiveRule(draft);
      await setActiveRule(savedRule);
      await syncActiveCssLoaderRegistration();
      await registerLiveScript(savedRule);
    }
    remoteSaved = true;
  } catch (error) {
    console.warn("Unable to persist draft to the backend.", error);
  }

  const nextWorkspaceDraft = savedRule ?? draft;
  await setWorkspaceDraft(nextWorkspaceDraft);

  return {
    applied: true,
    backendUrl,
    draft,
    remoteSaved,
    rule: savedRule,
    ...injectionResult,
    workspaceDraft: nextWorkspaceDraft,
  };
}

async function listRules() {
  const { backendUrl, payload: response } = await fetchBackendJson(
    "/api/rules?limit=100",
    undefined,
    {
      timeoutMs: RULE_BACKEND_TIMEOUT_MS,
    },
  );

  const rules = Array.isArray(response.rules)
    ? response.rules.map((rule) => normalizeRuleRecord(rule))
    : [];

  await reconcileActiveRulesWithBackendRules(rules).catch((error) => {
    console.warn("Unable to sync active rules from the backend.", error);
  });

  return {
    backendUrl,
    ...response,
    rules,
  };
}

async function getRule(payload) {
  const ruleId =
    typeof payload?.ruleId === "string" && payload.ruleId.trim()
      ? payload.ruleId.trim()
      : "";

  if (!ruleId) {
    throw new Error("A rule id is required before opening it.");
  }

  const { backendUrl, payload: response } = await fetchBackendJson(
    `/api/rules/${ruleId}`,
    undefined,
    {
      timeoutMs: RULE_BACKEND_TIMEOUT_MS,
    },
  );

  return {
    backendUrl,
    ...response,
    rule: response.rule ? normalizeRuleRecord(response.rule) : null,
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

  const activeRule = (await loadActiveRules()).find((rule) => rule.id === ruleId);
  const { backendUrl, payload: response } = await fetchBackendJson(
    `/api/rules/${ruleId}`,
    {
      method: "DELETE",
    },
    {
      timeoutMs: RULE_BACKEND_TIMEOUT_MS,
    },
  );

  await unregisterLiveScript({ id: ruleId });
  if (activeRule) {
    await clearInjectedRuleFromTabs(activeRule);
  }
  await removeActiveRule({ id: ruleId });
  await syncActiveCssLoaderRegistration();

  return {
    backendUrl,
    ...response,
  };
}

async function setRuleEnabled(payload) {
  const ruleId =
    typeof payload?.ruleId === "string" && payload.ruleId.trim()
      ? payload.ruleId.trim()
      : "";
  const enabled = payload?.enabled === true;

  if (!ruleId) {
    throw new Error("A rule id is required before updating it.");
  }

  const { backendUrl: detailBackendUrl, payload: detail } =
    await fetchBackendJson(
      `/api/rules/${ruleId}`,
      undefined,
      {
        timeoutMs: RULE_BACKEND_TIMEOUT_MS,
      },
    );
  const existingRule = detail.rule ? normalizeRuleRecord(detail.rule) : null;

  if (!existingRule) {
    throw new Error("Rule not found.");
  }

  const nextRule = {
    ...existingRule,
    enabled,
  };

  if (enabled && !hasRuleContent(nextRule)) {
    throw new Error("Add code to at least one file before turning this rule on.");
  }

  const response = await persistRule(nextRule);
  const savedRule = response.rule ? normalizeRuleRecord(response.rule) : nextRule;

  if (enabled) {
    const injectionResult = await activateLiveRule(
      savedRule,
      "Registering the live rule took too long. Try turning it on again.",
    );

    return {
      applied: true,
      backendUrl: response.backendUrl ?? detailBackendUrl,
      rule: savedRule,
      ...injectionResult,
    };
  }

  await clearInjectedRuleFromTabs(savedRule);
  await unregisterLiveScript(savedRule);
  await removeActiveRule(savedRule);
  await syncActiveCssLoaderRegistration();

  const reloadedTabCount = hasJavascript(savedRule)
    ? await reloadMatchingTabs(savedRule)
    : 0;

  const workspaceDraft = await loadWorkspaceDraft();
  if (workspaceDraft?.id === ruleId) {
    await setWorkspaceDraft(savedRule);
  }

  return {
    applied: false,
    backendUrl: response.backendUrl ?? detailBackendUrl,
    reloadedTabCount,
    rule: savedRule,
  };
}

async function clearRegisteredScript() {
  const activeRules = await loadActiveRules();
  const activeDraft = await loadActiveDraft();
  const rulesToClear = dedupeRulesByRuntimeKey([
    ...activeRules,
    ...(activeDraft ? [activeDraft] : []),
  ]);

  await unregisterLiveScript();
  await unregisterActiveCssLoader();
  await chrome.storage.local.remove([
    STORAGE_KEYS.activeDraft,
    STORAGE_KEYS.activeRules,
  ]);
  await Promise.all(
    rulesToClear.map((rule) => clearInjectedRuleFromTabs(rule)),
  );
  await clearInjectedOverlayFromTabs();

  return {
    cleared: true,
  };
}

async function activateLiveRule(draft, timeoutMessage) {
  const activeRules = await loadActiveRules();
  const previousDraft = activeRules.find((rule) =>
    isSameRuleIdentity(rule, draft),
  );
  const shouldClearPreviousBeforeApply =
    previousDraft &&
    previousDraft.matchPattern !== draft.matchPattern;
  const shouldClearPreviousCssAfterApply =
    previousDraft &&
    !shouldClearPreviousBeforeApply &&
    previousDraft.css !== draft.css;

  if (shouldClearPreviousBeforeApply) {
    await clearInjectedRuleFromTabs(previousDraft);
  }

  await unregisterLiveScript(previousDraft ?? draft);
  await setActiveRule(draft);
  await syncActiveCssLoaderRegistration();
  await withTimeout(registerLiveScript(draft), 4000, timeoutMessage);

  const result = await injectIntoMatchingTabs(draft);

  if (shouldClearPreviousCssAfterApply) {
    await clearUserCssFromTabs(previousDraft);
  }

  return result;
}

async function reconcileActiveRulesWithBackendRules(rules) {
  const enabledRules = rules.filter(
    (rule) => rule.enabled !== false && hasRuleContent(rule),
  );
  const enabledKeys = new Set(enabledRules.map((rule) => getRuleRuntimeKey(rule)));
  const activeRules = await loadActiveRules();
  const rulesToRemove = activeRules.filter(
    (rule) => !enabledKeys.has(getRuleRuntimeKey(rule)),
  );

  for (const rule of rulesToRemove) {
    await unregisterLiveScript(rule);
    await clearInjectedRuleFromTabs(rule);
    if (hasJavascript(rule)) {
      await reloadMatchingTabs(rule);
    }
  }

  await setActiveRules(
    activeRules.filter((rule) => enabledKeys.has(getRuleRuntimeKey(rule))),
  );

  for (const rule of enabledRules) {
    const currentActiveRules = await loadActiveRules();
    const storedRule = currentActiveRules.find((item) =>
      isSameRuleIdentity(item, rule),
    );

    if (!storedRule || !rulesAreRuntimeEquivalent(storedRule, rule)) {
      await activateLiveRule(
        rule,
        "Registering an enabled rule took too long. Try refreshing the page.",
      );
    } else {
      await registerLiveScript(rule);
    }
  }

  await syncActiveCssLoaderRegistration();
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
  const activeRules = await loadActiveRules();
  if (!activeRules.length) {
    return;
  }

  await syncActiveCssLoaderRegistration(activeRules);
  await Promise.all(activeRules.map((draft) => registerLiveScript(draft)));

  await Promise.all(
    activeRules.map((draft) =>
      injectIntoMatchingTabs(draft).catch((error) => {
        console.warn("Unable to restore an active rule into matching tabs.", error);
      }),
    ),
  );
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
  if (!shouldRegisterUserScript(draft)) {
    return;
  }

  const availability = await getUserScriptsAvailability();
  if (!availability.available) {
    return;
  }

  const script = {
    id: getLiveScriptId(draft),
    matches: [draft.matchPattern],
    js: [{ code: buildUserScriptCode(draft) }],
    allFrames: true,
    runAt: "document_start",
    world: "MAIN",
  };

  await unregisterLiveScript(draft);
  await chrome.userScripts.register([script]);
}

async function unregisterLiveScript(draft) {
  if (!chrome.userScripts?.unregister) {
    return;
  }

  try {
    const ids =
      draft == null
        ? await getRegisteredLiveScriptIds()
        : [getLiveScriptId(draft)];

    if (!ids.length) {
      return;
    }

    await chrome.userScripts.unregister({ ids });
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

async function registerActiveCssLoader() {
  if (!chrome.scripting?.registerContentScripts) {
    return;
  }

  if (chrome.scripting.getRegisteredContentScripts) {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [ACTIVE_CSS_LOADER_ID],
    });

    if (existing.length) {
      return;
    }
  }

  const registration = {
    id: ACTIVE_CSS_LOADER_ID,
    matches: ["<all_urls>"],
    js: [STYLE_LOADER_FILE],
    runAt: "document_start",
    allFrames: true,
    persistAcrossSessions: true,
  };

  try {
    await chrome.scripting.registerContentScripts([
      {
        ...registration,
        matchOriginAsFallback: true,
      },
    ]);
  } catch (error) {
    await chrome.scripting.registerContentScripts([registration]);
    console.warn(
      "Registered the CSS loader without matchOriginAsFallback.",
      error,
    );
  }
}

async function unregisterActiveCssLoader() {
  if (!chrome.scripting?.unregisterContentScripts) {
    return;
  }

  try {
    if (chrome.scripting.getRegisteredContentScripts) {
      const existing = await chrome.scripting.getRegisteredContentScripts({
        ids: [ACTIVE_CSS_LOADER_ID],
      });

      if (!existing.length) {
        return;
      }
    }

    await chrome.scripting.unregisterContentScripts({
      ids: [ACTIVE_CSS_LOADER_ID],
    });
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

async function syncActiveCssLoaderRegistration(activeRules) {
  const rules = Array.isArray(activeRules) ? activeRules : await loadActiveRules();

  if (rules.some((rule) => shouldInjectUserCss(rule))) {
    await registerActiveCssLoader();
    return;
  }

  await unregisterActiveCssLoader();
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
    await insertUserCssIntoTab(draft, tab.id);
    await executeDraftInTab(draft, tab.id);

    return {
      ok: true,
      tab,
    };
  } catch (error) {
    await removeUserCssFromTab(draft, tab.id).catch(() => {
      // Ignore cleanup failures after a partial injection.
    });

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
  const target = await buildDraftScriptInjectionTarget(draft, tabId);

  if (allowUserScripts) {
    const availability = await getUserScriptsAvailability();
    if (availability.available && chrome.userScripts?.execute) {
      await chrome.userScripts.execute({
        target,
        js: [{ code: source }],
        injectImmediately: true,
        world: "MAIN",
      });
      return;
    }
  }

  await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (draftSource) => {
      // Execute the generated draft source in the page world when userScripts is unavailable.
      (0, eval)(draftSource);
    },
    args: [source],
  });
}

async function buildDraftScriptInjectionTarget(draft, tabId) {
  const frameIds = await getMatchingFrameIdsForTab(tabId, draft);

  if (frameIds.length > 0) {
    return {
      tabId,
      frameIds,
    };
  }

  return {
    tabId,
  };
}

async function applyActiveCssToSenderFrame(sender) {
  const activeRules = await loadActiveRules();
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;

  if (typeof tabId !== "number") {
    return {
      applied: false,
    };
  }

  const matchingRules = activeRules.filter((rule) => {
    if (!shouldInjectUserCss(rule)) {
      return false;
    }

    if (typeof sender?.url === "string" && isInspectableUrl(sender.url)) {
      return matchesPattern(sender.url, rule.matchPattern);
    }

    return true;
  });

  if (!matchingRules.length) {
    return {
      applied: false,
    };
  }

  await Promise.all(
    matchingRules.map((rule) =>
      insertUserCssIntoTab(rule, tabId, {
        frameIds: typeof frameId === "number" ? [frameId] : undefined,
      }),
    ),
  );

  return {
    applied: true,
    frameId: typeof frameId === "number" ? frameId : null,
    ruleCount: matchingRules.length,
  };
}

async function insertUserCssIntoTab(draft, tabId, targetOverrides = {}) {
  if (!shouldInjectUserCss(draft) || typeof tabId !== "number") {
    return false;
  }

  const target = buildCssInjectionTarget(tabId, targetOverrides);

  await withTimeout(
    chrome.scripting.insertCSS({
      target,
      css: draft.css,
      origin: "USER",
    }),
    SCRIPTING_OPERATION_TIMEOUT_MS,
    "Inserting rule CSS took too long.",
  );

  return true;
}

async function removeUserCssFromTab(draft, tabId, targetOverrides = {}) {
  if (
    !hasUserCss(draft) ||
    typeof tabId !== "number" ||
    !chrome.scripting?.removeCSS
  ) {
    return false;
  }

  const target = buildCssInjectionTarget(tabId, targetOverrides);
  await withTimeout(
    chrome.scripting.removeCSS({
      target,
      css: draft.css,
      origin: "USER",
    }),
    SCRIPTING_OPERATION_TIMEOUT_MS,
    "Removing rule CSS took too long.",
  );

  return true;
}

function buildCssInjectionTarget(tabId, overrides = {}) {
  const frameIds = Array.isArray(overrides.frameIds)
    ? overrides.frameIds.filter((frameId) => typeof frameId === "number")
    : [];

  if (frameIds.length) {
    return {
      tabId,
      frameIds,
    };
  }

  return {
    tabId,
    allFrames: true,
  };
}

function shouldInjectUserCss(draft) {
  return (
    hasUserCss(draft) &&
    draft.enabled !== false &&
    Boolean(chrome.scripting?.insertCSS)
  );
}

function shouldRegisterUserScript(draft) {
  return (
    Boolean(draft) &&
    draft.enabled !== false &&
    (hasHtml(draft) || hasJavascript(draft))
  );
}

function hasUserCss(draft) {
  return (
    Boolean(draft) &&
    typeof draft.css === "string" &&
    draft.css.trim().length > 0
  );
}

function hasHtml(draft) {
  return (
    Boolean(draft) &&
    typeof draft.html === "string" &&
    draft.html.trim().length > 0
  );
}

function hasJavascript(draft) {
  return (
    Boolean(draft) &&
    typeof draft.javascript === "string" &&
    draft.javascript.trim().length > 0
  );
}

function isSameRuleIdentity(left, right) {
  const leftId = typeof left?.id === "string" ? left.id.trim() : "";
  const rightId = typeof right?.id === "string" ? right.id.trim() : "";

  if (leftId && rightId) {
    return leftId === rightId;
  }

  return getRuleRuntimeKey(left) === getRuleRuntimeKey(right);
}

function normalizeActiveRules(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeRulesByRuntimeKey(
    value
      .map((rule) => normalizeDraft(rule))
      .filter((rule) => rule.enabled !== false && hasRuleContent(rule)),
  );
}

function dedupeRulesByRuntimeKey(rules) {
  const rulesByKey = new Map();

  for (const rule of rules) {
    if (!rule) {
      continue;
    }

    rulesByKey.set(getRuleRuntimeKey(rule), rule);
  }

  return Array.from(rulesByKey.values());
}

function getRuleRuntimeKey(rule) {
  const id = typeof rule?.id === "string" && rule.id.trim() ? rule.id.trim() : "";
  const rawKey = id || "workspace";
  const normalizedKey = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedKey || "workspace";
}

function getLiveScriptId(rule) {
  return `${ACTIVE_SCRIPT_ID_PREFIX}${getRuleRuntimeKey(rule)}`;
}

async function getRegisteredLiveScriptIds() {
  if (!chrome.userScripts?.getScripts) {
    return [];
  }

  const scripts = await chrome.userScripts.getScripts();
  return scripts
    .map((script) => script.id)
    .filter(
      (id) =>
        id === ACTIVE_SCRIPT_ID ||
        (typeof id === "string" && id.startsWith(ACTIVE_SCRIPT_ID_PREFIX)),
    );
}

function rulesAreRuntimeEquivalent(left, right) {
  const normalizedLeft = normalizeDraft(left);
  const normalizedRight = normalizeDraft(right);

  return (
    normalizedLeft.enabled === normalizedRight.enabled &&
    normalizedLeft.matchPattern === normalizedRight.matchPattern &&
    normalizedLeft.html === normalizedRight.html &&
    normalizedLeft.css === normalizedRight.css &&
    normalizedLeft.javascript === normalizedRight.javascript &&
    JSON.stringify(normalizeRuleFiles(normalizedLeft.files)) ===
      JSON.stringify(normalizeRuleFiles(normalizedRight.files))
  );
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

async function clearInjectedRuleFromTabs(draft) {
  await Promise.all([
    clearUserCssFromTabs(draft),
    hasHtml(draft) || hasJavascript(draft)
      ? clearInjectedOverlayFromTabs(draft)
      : Promise.resolve(),
  ]);
}

async function clearUserCssFromTabs(draft) {
  if (!hasUserCss(draft) || !chrome.scripting?.removeCSS) {
    return;
  }

  const tabs = await getInspectableTabs();
  await Promise.all(
    tabs
      .map((tab) => tab.id)
      .filter((tabId) => typeof tabId === "number")
      .map((tabId) =>
        removeUserCssCompletelyFromTab(draft, tabId).catch(() => {
          // Ignore tabs that navigated, closed, or did not receive this stylesheet.
        }),
      ),
  );
}

async function removeUserCssCompletelyFromTab(draft, tabId, targetOverrides = {}) {
  for (let attempt = 0; attempt < USER_CSS_REMOVAL_ATTEMPTS; attempt += 1) {
    await removeUserCssFromTab(draft, tabId, targetOverrides);
  }
}

async function reloadMatchingTabs(draft) {
  const tabs = await getMatchingTabs(draft);
  const targetTabIds = tabs
    .map((tab) => tab.id)
    .filter((tabId) => typeof tabId === "number");

  if (!targetTabIds.length) {
    return 0;
  }

  const results = await Promise.all(
    targetTabIds.map(async (tabId) => {
      try {
        await chrome.tabs.reload(tabId);
        await waitForTabComplete(tabId, 12000);
        return true;
      } catch {
        return false;
      }
    }),
  );

  return results.filter(Boolean).length;
}

async function clearInjectedOverlayFromTabs(draft = null) {
  const runtimeKey = draft ? getRuleRuntimeKey(draft) : null;
  const tabs = await getInspectableTabs();
  const targetTabIds = tabs
    .map((tab) => tab.id)
    .filter((tabId) => typeof tabId === "number");

  if (!targetTabIds.length) {
    return;
  }

  await Promise.all(
    targetTabIds.map((tabId) =>
      withTimeout(
        chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (hostId, rootId, styleId, clearAll, expectedRuntimeKey) => {
            const runtime = window.__VIBE_PILOT__;
            const shouldDestroyRuntime =
              clearAll ||
              !expectedRuntimeKey ||
              runtime?.ruleRuntimeKey === expectedRuntimeKey;

            if (shouldDestroyRuntime && runtime?.destroy) {
              runtime.destroy();
            }

            if (shouldDestroyRuntime) {
              document.getElementById(hostId)?.remove();
              document.getElementById(rootId)?.remove();
              document.getElementById(styleId)?.remove();
            }

            if (clearAll) {
              for (const node of document.querySelectorAll(
                '[data-vibe-pilot="host"]',
              )) {
                node.remove();
              }
              delete window.__VIBE_PILOT__;
            }
          },
          args: [
            OVERLAY_HOST_ID,
            OVERLAY_ROOT_ID,
            OVERLAY_STYLE_ID,
            draft == null,
            runtimeKey,
          ],
        }),
        SCRIPTING_OPERATION_TIMEOUT_MS,
        "Clearing the injected rule UI took too long.",
      ).catch(() => {
        // Ignore tabs that reject scripting while closing or changing origin.
      }),
    ),
  );
}

function buildUserScriptCode(draft) {
  const html = JSON.stringify(draft.html);
  const javascript = draft.javascript || "";
  const files = JSON.stringify(normalizeRuleFiles(draft.files));
  const runtimeKey = JSON.stringify(getRuleRuntimeKey(draft));

  return `
(() => {
  const previousRuntime = window.__VIBE_PILOT__;
  if (previousRuntime && typeof previousRuntime.destroy === "function") {
    try {
      previousRuntime.destroy();
    } catch (error) {
      console.warn("Unable to destroy the previous Vibe Pilot runtime.", error);
    }
  }

  const htmlSnippet = ${html};
  const fileEntries = ${files};
  const hostId = "${OVERLAY_HOST_ID}";
  const rootId = "${OVERLAY_ROOT_ID}";
  const styleId = "${OVERLAY_STYLE_ID}";
  const ruleRuntimeKey = ${runtimeKey};

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

  const ensureStyle = () => false;

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

  const cleanupCallbacks = new Set();
  const managedIntervals = new Set();
  const managedObservers = new Set();
  const managedTimeouts = new Set();
  let rerenderObserver = null;
  let isDestroyed = false;

  const runManagedCleanup = () => {
    for (const observer of Array.from(managedObservers)) {
      try {
        observer.disconnect();
      } catch {
        // Ignore observer cleanup failures.
      }
    }
    managedObservers.clear();

    for (const timeoutId of Array.from(managedTimeouts)) {
      clearTimeout(timeoutId);
    }
    managedTimeouts.clear();

    for (const intervalId of Array.from(managedIntervals)) {
      clearInterval(intervalId);
    }
    managedIntervals.clear();

    for (const callback of Array.from(cleanupCallbacks)) {
      try {
        callback();
      } catch (error) {
        console.warn("A Vibe Pilot cleanup callback failed.", error);
      }
    }
    cleanupCallbacks.clear();
  };

  const registerCleanup = (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    cleanupCallbacks.add(callback);
    return () => {
      cleanupCallbacks.delete(callback);
    };
  };

  const isManagedNode = (node) => {
    if (!node || typeof node.closest !== "function") {
      return false;
    }

    return Boolean(
      node.closest(
        "#" + hostId + ",#" + rootId + ",[data-vibe-pilot=\\"host\\"],[data-vibe-pilot=\\"managed\\"],script,style,noscript,template",
      ),
    );
  };

  const isVisibleElement = (node) => {
    if (!(node instanceof Element) || isManagedNode(node)) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }

    return Array.from(node.getClientRects()).some(
      (rect) => rect.width > 0 && rect.height > 0,
    );
  };

  const normalizeSelectorList = (value) => {
    const rawValues = Array.isArray(value) ? value : [value];

    return rawValues
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  };

  const api = {
    hostId,
    ruleRuntimeKey,
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
    replaceVisibleText(selectors, value, options = {}) {
      const selectorList = normalizeSelectorList(selectors);
      const replacement = String(value ?? "");
      const markerName =
        typeof options.markAttribute === "string" &&
        /^data-[a-zA-Z0-9_.:-]+$/.test(options.markAttribute.trim())
          ? options.markAttribute.trim()
          : "";
      const maxChanges = Number.isFinite(options.maxChanges)
        ? Math.max(1, Math.min(5000, Math.round(options.maxChanges)))
        : 1000;
      const shouldPatchInputs = options.includeInputs === true;
      const stopAfterFirst = options.all === false;
      const seen = new Set();
      const selectorErrors = [];
      let changed = 0;
      let matched = 0;
      let skipped = 0;

      for (const selector of selectorList) {
        let nodes;

        try {
          nodes = Array.from(document.querySelectorAll(selector));
        } catch (error) {
          selectorErrors.push({
            selector,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        for (const node of nodes) {
          if (seen.has(node)) {
            continue;
          }

          seen.add(node);
          matched += 1;

          if (changed >= maxChanges || (stopAfterFirst && changed > 0)) {
            skipped += 1;
            continue;
          }

          if (
            shouldPatchInputs &&
            (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
          ) {
            node.value = replacement;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            if (markerName) {
              node.setAttribute(markerName, "1");
            }
            changed += 1;
            continue;
          }

          if (!isVisibleElement(node)) {
            skipped += 1;
            continue;
          }

          if (node.textContent !== replacement) {
            node.textContent = replacement;
          }

          if (markerName) {
            node.setAttribute(markerName, "1");
          }

          changed += 1;
        }
      }

      return {
        changed,
        matched,
        selectorErrors,
        skipped,
      };
    },
    remove(selector) {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      node.remove();
      return true;
    },
    onCleanup(callback) {
      return registerCleanup(callback);
    },
    observe(target, options, callback) {
      const resolvedTarget =
        typeof target === "string" ? document.querySelector(target) : target;
      if (!resolvedTarget || typeof callback !== "function") {
        return null;
      }

      const observer = new MutationObserver(callback);
      observer.observe(resolvedTarget, options || { childList: true, subtree: true });
      managedObservers.add(observer);
      return {
        disconnect() {
          observer.disconnect();
          managedObservers.delete(observer);
        },
      };
    },
    setTimeout(callback, delay = 0) {
      if (typeof callback !== "function") {
        return null;
      }

      const timeoutId = window.setTimeout(() => {
        managedTimeouts.delete(timeoutId);
        callback();
      }, delay);
      managedTimeouts.add(timeoutId);
      return timeoutId;
    },
    clearTimeout(timeoutId) {
      clearTimeout(timeoutId);
      managedTimeouts.delete(timeoutId);
    },
    setInterval(callback, delay = 0) {
      if (typeof callback !== "function") {
        return null;
      }

      const intervalId = window.setInterval(callback, delay);
      managedIntervals.add(intervalId);
      return intervalId;
    },
    clearInterval(intervalId) {
      clearInterval(intervalId);
      managedIntervals.delete(intervalId);
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
      if (isDestroyed) {
        return;
      }

      isDestroyed = true;
      runManagedCleanup();
      rerenderObserver?.disconnect();
      revokeFileUrls();
      document.getElementById(rootId)?.remove();
      document.getElementById(styleId)?.remove();
      document.getElementById(hostId)?.remove();
      delete window.__VIBE_PILOT__;
    }
  };

  window.__VIBE_PILOT__ = api;
  ensureRoot();

  rerenderObserver = new MutationObserver(() => {
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

async function loadActiveRules() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.activeRules);
  const activeRules = normalizeActiveRules(stored[STORAGE_KEYS.activeRules]);

  if (activeRules.length) {
    return activeRules;
  }

  const activeDraft = await loadActiveDraft();
  return normalizeActiveRules(activeDraft ? [activeDraft] : []);
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

async function setActiveRules(rules) {
  const activeRules = dedupeRulesByRuntimeKey(normalizeActiveRules(rules));
  const updates = {
    [STORAGE_KEYS.activeRules]: activeRules,
  };
  const removals = [];

  if (activeRules.length) {
    updates[STORAGE_KEYS.activeDraft] = activeRules[activeRules.length - 1];
  } else {
    removals.push(STORAGE_KEYS.activeDraft);
  }

  await chrome.storage.local.set(updates);

  if (removals.length) {
    await chrome.storage.local.remove(removals);
  }

  return activeRules;
}

async function setActiveRule(draft) {
  const activeRules = await loadActiveRules();
  const nextRule = normalizeDraft(draft);
  const nextRules = activeRules.filter(
    (rule) => !isSameRuleIdentity(rule, nextRule),
  );

  nextRules.push(nextRule);
  return setActiveRules(nextRules);
}

async function removeActiveRule(draft) {
  const activeRules = await loadActiveRules();
  const nextRules = activeRules.filter(
    (rule) => !isSameRuleIdentity(rule, draft),
  );

  return setActiveRules(nextRules);
}

async function ensureDraftState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.activeDraft,
    STORAGE_KEYS.activeRules,
    STORAGE_KEYS.workspaceDraft,
  ]);

  const rawActiveDraft = stored[STORAGE_KEYS.activeDraft];
  const rawActiveRules = stored[STORAGE_KEYS.activeRules];
  const rawWorkspaceDraft = stored[STORAGE_KEYS.workspaceDraft];
  const activeDraft = hydrateStoredDraft(rawActiveDraft);
  const activeRules = normalizeActiveRules(rawActiveRules);
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

  if (Array.isArray(rawActiveRules) && rawActiveRules.length !== activeRules.length) {
    updates[STORAGE_KEYS.activeRules] = activeRules;
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
    activeRules,
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
    return (await loadActiveRules()).length > 0;
  }

  if ((await getRegisteredLiveScriptIds()).length > 0) {
    return true;
  }

  return (await loadActiveRules()).some((rule) => shouldInjectUserCss(rule));
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
  const activeRules = await loadActiveRules();
  if (!activeRules.length) {
    return;
  }

  const availability = await getUserScriptsAvailability();
  if (availability.available) {
    return;
  }

  const tab =
    tabOverride ??
    await chrome.tabs.get(tabId).catch(() => null);

  if (!tab?.id) {
    return;
  }

  const matchingRules = activeRules.filter((draft) =>
    matchesPattern(tab.url, draft.matchPattern),
  );

  await Promise.all(
    matchingRules.map((draft) =>
      insertUserCssIntoTab(draft, tab.id).catch((error) => {
        console.warn("Unable to reapply active rule CSS after tab load.", error);
      }),
    ),
  );

  if (availability.available) {
    return;
  }

  await Promise.all(
    matchingRules.map((draft) =>
      executeDraftInTab(draft, tab.id, {
        allowUserScripts: false,
      }).catch((error) => {
        console.warn("Unable to reapply an active rule after tab load.", error);
      }),
    ),
  );
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

async function getTabFrames(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const fallbackFrame = {
    documentId: null,
    errorOccurred: false,
    frameId: 0,
    parentFrameId: -1,
    url: tab?.url ?? "",
  };

  if (!chrome.webNavigation?.getAllFrames) {
    return [fallbackFrame];
  }

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (Array.isArray(frames) && frames.length > 0) {
      return frames.map((frame) => ({
        documentId:
          typeof frame.documentId === "string" && frame.documentId.trim()
            ? frame.documentId.trim()
            : null,
        errorOccurred: frame.errorOccurred === true,
        frameId: typeof frame.frameId === "number" ? frame.frameId : 0,
        parentFrameId:
          typeof frame.parentFrameId === "number" ? frame.parentFrameId : -1,
        url: typeof frame.url === "string" ? frame.url : "",
      }));
    }
  } catch (error) {
    console.warn("Unable to list tab frames.", error);
  }

  return [fallbackFrame];
}

async function getMatchingFrameIdsForTab(tabId, draft) {
  const frames = await getTabFrames(tabId);
  return frames
    .filter((frame) => isInspectableUrl(frame.url))
    .filter((frame) => matchesPattern(frame.url, draft.matchPattern))
    .map((frame) => frame.frameId)
    .filter((frameId, index, frameIds) => frameIds.indexOf(frameId) === index);
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

  const response = await chrome.tabs.sendMessage(
    tab.id,
    {
      type: "VIBE_PILOT_GET_DOM_SUMMARY",
    },
    {
      frameId: 0,
    },
  );

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
  const attachments = normalizeAssistantUserImages(payload?.attachments);
  const previousResponseId =
    typeof payload?.previousResponseId === "string" && payload.previousResponseId.trim()
      ? payload.previousResponseId.trim()
      : null;

  if (!prompt && !attachments.length) {
    throw new Error("Enter a message or attach at least one image before asking Vibe Pilot.");
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
    input: [buildAssistantUserInput(prompt, attachments)],
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
    backendUrl: response.backendUrl ?? (await getPreferredBackendBaseUrl()),
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
    backendUrl:
      typeof response?.backendUrl === "string" && response.backendUrl.trim()
        ? response.backendUrl.trim()
        : null,
    functionCalls: Array.isArray(response?.functionCalls) ? response.functionCalls : [],
    responseId:
      typeof response?.responseId === "string" && response.responseId.trim()
        ? response.responseId.trim()
        : null,
  };
}

async function fetchAssistantResponsePayload(path, payload, options = {}) {
  const candidates = await buildBackendCandidateUrls(path);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];

    try {
      return await readAssistantResponse(url, payload, options);
    } catch (error) {
      lastError = error;

      if (
        index < candidates.length - 1 &&
        shouldRetryWithNextBackendCandidate(error)
      ) {
        console.warn(
          "Assistant backend request failed; retrying with another backend candidate.",
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
      const payload = await response.json();
      if (payload && typeof payload === "object") {
        return {
          ...payload,
          backendUrl: getBackendOrigin(url),
        };
      }
      return payload;
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

    return {
      ...finalPayload,
      backendUrl: getBackendOrigin(url),
    };
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

async function buildBackendCandidateUrls(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrls = await getBackendBaseUrls();
  return Array.from(
    new Set(baseUrls.map((baseUrl) => `${baseUrl}${normalizedPath}`)),
  );
}

function shouldRetryWithNextBackendCandidate(error) {
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

  return (
    message.startsWith("Unable to reach the backend at ") ||
    backendStatus === 404 ||
    backendStatus >= 500
  );
}

function isLocalBackendUrl(value) {
  try {
    return new URL(value).origin === new URL(LOCAL_BACKEND_URL).origin;
  } catch {
    return false;
  }
}

async function getBackendBaseUrls() {
  if (isLocalBackendUrl(BACKEND_URL)) {
    return [LOCAL_BACKEND_URL];
  }

  const preferLocalBackend = await shouldPreferLocalBackend();
  return preferLocalBackend
    ? [LOCAL_BACKEND_URL, BACKEND_URL]
    : [BACKEND_URL, LOCAL_BACKEND_URL];
}

async function getPreferredBackendBaseUrl() {
  const baseUrls = await getBackendBaseUrls();
  return baseUrls[0] ?? BACKEND_URL;
}

async function shouldPreferLocalBackend() {
  if (!shouldAutoPreferLocalBackend()) {
    return false;
  }

  const now = Date.now();
  if (now - localBackendPreferenceCheckedAt < BACKEND_HEALTH_CACHE_TTL_MS) {
    return preferLocalBackendCache;
  }

  if (!localBackendPreferencePromise) {
    localBackendPreferencePromise = probeLocalBackendAvailability()
      .then((isAvailable) => {
        preferLocalBackendCache = isAvailable;
        localBackendPreferenceCheckedAt = Date.now();
        return isAvailable;
      })
      .finally(() => {
        localBackendPreferencePromise = null;
      });
  }

  return localBackendPreferencePromise;
}

function shouldAutoPreferLocalBackend() {
  return HOT_RELOAD_ENABLED || BACKEND_URL === DEFAULT_REMOTE_BACKEND_URL;
}

async function probeLocalBackendAvailability() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, BACKEND_HEALTH_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${LOCAL_BACKEND_URL}/api/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return payload?.app === "vibe-pilot-web";
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getBackendOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
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

function buildAssistantUserInput(prompt, images = []) {
  const content = [];
  if (prompt) {
    content.push({
      type: "input_text",
      text: prompt,
    });
  }

  images.forEach((image) => {
    content.push(image);
  });

  return {
    type: "message",
    role: "user",
    content,
  };
}

function normalizeAssistantUserImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((image) => {
      const imageUrl =
        typeof image?.image_url === "string" ? image.image_url.trim() : "";
      const detail =
        image?.detail === "low" || image?.detail === "high" || image?.detail === "auto"
          ? image.detail
          : "auto";

      if (
        !imageUrl ||
        (!imageUrl.startsWith("data:image/") &&
          !imageUrl.startsWith("https://") &&
          !imageUrl.startsWith("http://"))
      ) {
        return null;
      }

      return {
        detail,
        image_url: imageUrl,
        type: "input_image",
      };
    })
    .filter(Boolean)
    .slice(0, CHAT_IMAGE_ATTACHMENT_LIMIT);
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
  async list_frames() {
    const tab = await getRequiredTargetTab();
    const frames = await getTabFrames(tab.id);
    const activeRules = await loadActiveRules();
    const result = {
      frames: frames.map((frame) => ({
        ...frame,
        inspectable: isInspectableUrl(frame.url),
        matchingActiveRuleCount: activeRules.filter((rule) =>
          isInspectableUrl(frame.url) && matchesPattern(frame.url, rule.matchPattern),
        ).length,
      })),
      tabId: tab.id,
      url: tab.url,
    };

    return {
      output: stringifyJson(result),
      transcriptText: `Listed ${result.frames.length} frame${result.frames.length === 1 ? "" : "s"} in the active tab.`,
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
  async observe_dom(args) {
    const selector =
      typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : "";

    if (!selector) {
      throw new Error("observe_dom requires a non-empty selector.");
    }

    const result = await observeDomInTargetTab({
      attributeNames: Array.isArray(args.attributeNames)
        ? args.attributeNames.filter((value) => typeof value === "string").slice(0, 12)
        : [],
      includeText: args.includeText !== false,
      maxItems: clampInteger(args.maxItems, 1, 12, 5),
      quietWindowMs: clampInteger(
        args.quietWindowMs,
        50,
        2000,
        DOM_OBSERVE_DEFAULT_QUIET_WINDOW_MS,
      ),
      selector,
      timeoutMs: clampInteger(
        args.timeoutMs,
        100,
        10000,
        DOM_OBSERVE_DEFAULT_TIMEOUT_MS,
      ),
    });

    return {
      output: stringifyJson(result),
      transcriptText: `Observed "${selector}" for ${result.elapsedMs}ms; final count was ${result.final.count}.`,
    };
  },
  async apply_dom_patch(args) {
    const operations = Array.isArray(args.operations) ? args.operations : [];
    if (!operations.length) {
      throw new Error("apply_dom_patch requires at least one operation.");
    }

    const result = await applyDomPatchToTargetTab(args);

    return {
      output: stringifyJson(result),
      transcriptText: `Applied ${result.changedCount} DOM patch${result.changedCount === 1 ? "" : "es"} across ${result.operationCount} operation${result.operationCount === 1 ? "" : "s"}.`,
    };
  },
  async insert_page_css(args) {
    const css =
      typeof args.css === "string" && args.css.trim() ? args.css : "";

    if (!css) {
      throw new Error("insert_page_css requires non-empty css.");
    }

    const result = await insertCssIntoTargetTab(args);

    return {
      output: stringifyJson(result),
      transcriptText: `Inserted CSS into ${formatInjectionTargetForTranscript(result.target)}.`,
    };
  },
  async execute_page_script(args) {
    const javascript =
      typeof args.javascript === "string" && args.javascript.trim()
        ? args.javascript
        : "";

    if (!javascript) {
      throw new Error("execute_page_script requires non-empty javascript.");
    }

    if (javascript.length > ONE_OFF_SCRIPT_MAX_LENGTH) {
      throw new Error(
        `execute_page_script is limited to ${ONE_OFF_SCRIPT_MAX_LENGTH} characters. Put durable code in the draft instead.`,
      );
    }

    const result = await executeOneOffPageScript(args);

    return {
      output: stringifyJson(result),
      transcriptText: `Executed a ${result.world} script in ${formatInjectionTargetForTranscript(result.target)}.`,
    };
  },
  async get_injection_state() {
    const result = await getInjectionStateForTargetTab();

    return {
      output: stringifyJson(result),
      transcriptText: `Read Vibe Pilot injection state for ${safeHostnameFromUrl(result.tab.url) ?? "the active tab"}.`,
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
      enabled: readAssistantDraftPatch(args, "enabled", currentDraft.enabled),
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
    const liveUpdate = await syncUpdatedDraftToLiveTabs(nextDraft);

    return {
      output: stringifyJson({
        draft: nextDraft,
        liveUpdate,
      }),
      transcriptText: [
        `Updated the current draft${nextDraft.name ? ` to "${nextDraft.name}"` : ""}.`,
        liveUpdate.liveUpdated
          ? `Synced it to ${liveUpdate.appliedTabCount ?? 0} matching tab${liveUpdate.appliedTabCount === 1 ? "" : "s"}.`
          : liveUpdate.reason,
      ].filter(Boolean).join(" "),
    };
  },
  async write_draft_file(args) {
    const filePath = normalizeRuleFilePath(args?.path);
    if (!filePath) {
      throw new Error("write_draft_file requires a non-empty file path.");
    }

    const currentDraft = (await loadWorkspaceDraft()) ?? EMPTY_WORKSPACE_RULE;
    const currentFiles = normalizeRuleFiles(currentDraft.files);
    const nextFile = {
      path: filePath,
      mimeType:
        typeof args?.mimeType === "string" && args.mimeType.trim()
          ? args.mimeType.trim()
          : "",
      content: typeof args?.content === "string" ? args.content : "",
    };
    const nextDraft = normalizeDraft({
      ...currentDraft,
      files: [
        ...currentFiles.filter((file) => file.path !== filePath),
        nextFile,
      ],
    });

    await setWorkspaceDraft(nextDraft);
    const liveUpdate = await syncUpdatedDraftToLiveTabs(nextDraft);

    return {
      output: stringifyJson({
        draft: nextDraft,
        file: nextFile,
        liveUpdate,
      }),
      transcriptText: [
        `Wrote draft file "${filePath}".`,
        liveUpdate.liveUpdated
          ? `Synced it to ${liveUpdate.appliedTabCount ?? 0} matching tab${
              liveUpdate.appliedTabCount === 1 ? "" : "s"
            }.`
          : liveUpdate.reason,
      ].filter(Boolean).join(" "),
    };
  },
  async delete_draft_file(args) {
    const filePath = normalizeRuleFilePath(args?.path);
    if (!filePath) {
      throw new Error("delete_draft_file requires a non-empty file path.");
    }

    const currentDraft = (await loadWorkspaceDraft()) ?? EMPTY_WORKSPACE_RULE;
    const currentFiles = normalizeRuleFiles(currentDraft.files);
    const nextFiles = currentFiles.filter((file) => file.path !== filePath);
    const nextDraft = normalizeDraft({
      ...currentDraft,
      files: nextFiles,
    });

    await setWorkspaceDraft(nextDraft);
    const liveUpdate = await syncUpdatedDraftToLiveTabs(nextDraft);
    const deleted = nextFiles.length !== currentFiles.length;

    return {
      output: stringifyJson({
        deleted,
        draft: nextDraft,
        liveUpdate,
        path: filePath,
      }),
      transcriptText: [
        deleted
          ? `Deleted draft file "${filePath}".`
          : `Draft file "${filePath}" was not present.`,
        liveUpdate.liveUpdated
          ? `Synced the draft to ${liveUpdate.appliedTabCount ?? 0} matching tab${
              liveUpdate.appliedTabCount === 1 ? "" : "s"
            }.`
          : liveUpdate.reason,
      ].filter(Boolean).join(" "),
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

async function syncUpdatedDraftToLiveTabs(draft) {
  if (!draft || draft.enabled === false) {
    const activeRules = await loadActiveRules();
    const previousDraft = activeRules.find((rule) =>
      isSameRuleIdentity(rule, draft),
    );

    if (previousDraft) {
      await unregisterLiveScript(previousDraft);
      await clearInjectedRuleFromTabs(previousDraft);
    }

    await removeActiveRule(draft);
    await syncActiveCssLoaderRegistration();
    return {
      liveUpdated: false,
      reason: "The draft is disabled, so no live script was registered.",
    };
  }

  if (!hasRuleContent(draft)) {
    const activeRules = await loadActiveRules();
    const previousDraft = activeRules.find((rule) =>
      isSameRuleIdentity(rule, draft),
    );

    if (previousDraft) {
      await unregisterLiveScript(previousDraft);
      await clearInjectedRuleFromTabs(previousDraft);
      await removeActiveRule(previousDraft);
      await syncActiveCssLoaderRegistration();
    }

    return {
      liveUpdated: false,
      reason: "The draft has no injectable content.",
    };
  }

  const result = await activateLiveRule(
    draft,
    "Registering the updated draft took too long. Try applying again.",
  );

  return {
    ...result,
    liveUpdated: true,
  };
}

async function observeDomInTargetTab(payload) {
  const tab = await getRequiredTargetTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (config) =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        const selector = String(config.selector ?? "");
        const maxItems = Number(config.maxItems) || 5;
        const attributeNames = Array.isArray(config.attributeNames)
          ? config.attributeNames.filter((value) => typeof value === "string").slice(0, 12)
          : [];
        const includeText = config.includeText !== false;
        const quietWindowMs = Number(config.quietWindowMs) || 250;
        const timeoutMs = Number(config.timeoutMs) || 1600;
        let mutationCount = 0;
        let completed = false;
        let quietTimer = null;
        let timeoutTimer = null;

        const truncate = (value, limit) => {
          const text = String(value ?? "").replace(/\s+/g, " ").trim();
          return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
        };

        const summarizeElement = (node) => {
          const rect = node.getBoundingClientRect();
          const attributes = {};

          for (const attributeName of attributeNames) {
            const value = node.getAttribute(attributeName);
            if (value != null) {
              attributes[attributeName] = truncate(value, 240);
            }
          }

          return {
            attributes,
            id: node.id || "",
            tagName: node.tagName.toLowerCase(),
            text: includeText ? truncate(node.textContent, 320) : "",
            rect: {
              height: Math.round(rect.height * 100) / 100,
              left: Math.round(rect.left * 100) / 100,
              top: Math.round(rect.top * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
            },
          };
        };

        const sample = () => {
          const nodes = Array.from(document.querySelectorAll(selector));
          return {
            count: nodes.length,
            samples: nodes.slice(0, maxItems).map(summarizeElement),
          };
        };

        const observer = new MutationObserver((mutations) => {
          mutationCount += mutations.length;
          scheduleQuietFinish();
        });

        const cleanup = () => {
          observer.disconnect();
          if (quietTimer) {
            clearTimeout(quietTimer);
          }
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
        };

        const finish = (reason) => {
          if (completed) {
            return;
          }

          completed = true;
          cleanup();
          resolve({
            elapsedMs: Date.now() - startedAt,
            final: sample(),
            initial,
            mutationCount,
            reason,
            selector,
            timestamp: new Date().toISOString(),
            url: window.location.href,
          });
        };

        function scheduleQuietFinish() {
          if (quietTimer) {
            clearTimeout(quietTimer);
          }
          quietTimer = setTimeout(() => finish("quiet"), quietWindowMs);
        }

        const initial = sample();
        observer.observe(document.documentElement || document, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
        timeoutTimer = setTimeout(() => finish("timeout"), timeoutMs);
        scheduleQuietFinish();
      }),
    args: [payload],
  });

  return result?.result ?? null;
}

async function applyDomPatchToTargetTab(args) {
  const tab = await getRequiredTargetTab();
  const operations = Array.isArray(args.operations) ? args.operations.slice(0, 50) : [];
  const target = buildOneOffInjectionTarget(tab.id, args);
  const results = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (patchOperations) => {
      const normalizeOperationType = (value) =>
        typeof value === "string" && value.trim() ? value.trim() : "";

      const readSelector = (operation) =>
        typeof operation.selector === "string" && operation.selector.trim()
          ? operation.selector.trim()
          : "";

      const applyOperation = (operation) => {
        const type = normalizeOperationType(operation.type);
        const selector = readSelector(operation);

        if (!selector) {
          return {
            changed: 0,
            error: "Missing selector.",
            selector,
            type,
          };
        }

        const nodes = Array.from(document.querySelectorAll(selector));
        const targets = operation.all === true ? nodes : nodes.slice(0, 1);
        let changed = 0;

        for (const node of targets) {
          if (type === "setText") {
            node.textContent = String(operation.value ?? "");
            changed += 1;
          } else if (type === "setHtml") {
            node.innerHTML = String(operation.value ?? "");
            changed += 1;
          } else if (type === "remove") {
            node.remove();
            changed += 1;
          } else if (type === "setAttribute") {
            const attributeName =
              typeof operation.attributeName === "string" ? operation.attributeName.trim() : "";
            if (attributeName) {
              node.setAttribute(attributeName, String(operation.value ?? ""));
              changed += 1;
            }
          } else if (type === "removeAttribute") {
            const attributeName =
              typeof operation.attributeName === "string" ? operation.attributeName.trim() : "";
            if (attributeName) {
              node.removeAttribute(attributeName);
              changed += 1;
            }
          } else if (type === "setStyle") {
            const propertyName =
              typeof operation.propertyName === "string" ? operation.propertyName.trim() : "";
            if (propertyName && node instanceof HTMLElement) {
              node.style.setProperty(
                propertyName,
                String(operation.value ?? ""),
                operation.priority === "important" ? "important" : "",
              );
              changed += 1;
            }
          } else if (type === "addClass") {
            const className =
              typeof operation.className === "string" ? operation.className.trim() : "";
            if (className) {
              node.classList.add(...className.split(/\s+/).filter(Boolean));
              changed += 1;
            }
          } else if (type === "removeClass") {
            const className =
              typeof operation.className === "string" ? operation.className.trim() : "";
            if (className) {
              node.classList.remove(...className.split(/\s+/).filter(Boolean));
              changed += 1;
            }
          } else if (type === "replaceText") {
            const find = String(operation.find ?? "");
            const replacement = String(operation.value ?? "");
            if (find && node.textContent?.includes(find)) {
              node.textContent = node.textContent.split(find).join(replacement);
              changed += 1;
            }
          }
        }

        return {
          changed,
          matched: nodes.length,
          selector,
          type,
        };
      };

      const operationResults = patchOperations.map(applyOperation);
      return {
        changedCount: operationResults.reduce(
          (count, item) => count + (Number(item.changed) || 0),
          0,
        ),
        operationResults,
        url: window.location.href,
      };
    },
    args: [operations],
  });
  const frameResults = normalizeInjectionResults(results);
  const changedCount = frameResults.reduce(
    (count, item) => count + (Number(item.result?.changedCount) || 0),
    0,
  );

  return {
    changedCount,
    frameResults,
    operationCount: operations.length,
    target,
  };
}

async function insertCssIntoTargetTab(args) {
  const tab = await getRequiredTargetTab();
  const css = typeof args.css === "string" ? args.css : "";
  const target = buildOneOffInjectionTarget(tab.id, args);
  const origin = args.origin === "AUTHOR" ? "AUTHOR" : "USER";

  await chrome.scripting.insertCSS({
    target,
    css,
    origin,
  });

  return {
    cssLength: css.length,
    origin,
    target,
  };
}

async function executeOneOffPageScript(args) {
  const tab = await getRequiredTargetTab();
  const javascript = typeof args.javascript === "string" ? args.javascript : "";
  const target = buildOneOffInjectionTarget(tab.id, args);
  const world = normalizeOneOffScriptWorld(args.world);
  const source = `(async () => {\n${javascript}\n})()`;
  let results;

  if (chrome.userScripts?.execute) {
    const availability = await getUserScriptsAvailability();
    if (availability.available) {
      results = await chrome.userScripts.execute({
        target,
        js: [{ code: source }],
        injectImmediately: true,
        world,
      });

      return {
        resultCount: Array.isArray(results) ? results.length : 0,
        results: normalizeInjectionResults(results),
        target,
        world,
      };
    }
  }

  if (world !== "MAIN") {
    throw new Error(
      "USER_SCRIPT world execution requires Chrome userScripts support. Enable Allow User Scripts for this extension, or run a MAIN-world diagnostic script.",
    );
  }

  results = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (scriptSource) => (0, eval)(scriptSource),
    args: [source],
  });

  return {
    resultCount: Array.isArray(results) ? results.length : 0,
    results: normalizeInjectionResults(results),
    target,
    world,
  };
}

async function getInjectionStateForTargetTab() {
  const tab = await getRequiredTargetTab();
  const [activeRules, availability, registeredScriptIds, frames] = await Promise.all([
    loadActiveRules(),
    getUserScriptsAvailability(),
    getRegisteredLiveScriptIds(),
    getTabFrames(tab.id),
  ]);
  const frameIds = frames
    .filter((frame) => isInspectableUrl(frame.url))
    .map((frame) => frame.frameId);
  const target = frameIds.length ? { tabId: tab.id, frameIds } : { tabId: tab.id };
  let runtimeResults = [];

  try {
    runtimeResults = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: () => {
        const runtime = window.__VIBE_PILOT__;
        return {
          hostPresent: Boolean(document.getElementById("__vibe_pilot_host__")),
          rootPresent: Boolean(document.getElementById("__vibe_pilot_root__")),
          runtimePresent: Boolean(runtime),
          runtimeMethods: runtime
            ? Object.keys(runtime).filter((key) => typeof runtime[key] === "function").sort()
            : [],
          title: document.title,
          url: window.location.href,
        };
      },
    });
  } catch (error) {
    runtimeResults = [
      {
        frameId: 0,
        error: error instanceof Error ? error.message : "Unable to inspect runtime state.",
      },
    ];
  }

  return {
    activeRules: activeRules.map((rule) => ({
      enabled: rule.enabled !== false,
      hasCss: hasUserCss(rule),
      hasHtml: hasHtml(rule),
      hasJavascript: hasJavascript(rule),
      id: rule.id,
      matchPattern: rule.matchPattern,
      name: rule.name,
      runtimeKey: getRuleRuntimeKey(rule),
    })),
    frames,
    registeredScriptIds,
    runtimeResults: normalizeInjectionResults(runtimeResults),
    tab: toTabDetails(tab),
    userScripts: availability,
  };
}

function buildOneOffInjectionTarget(tabId, args = {}) {
  const frameIds = normalizeFrameIds(args.frameIds);

  if (frameIds.length) {
    return {
      tabId,
      frameIds,
    };
  }

  if (args.allFrames === true) {
    return {
      tabId,
      allFrames: true,
    };
  }

  return {
    tabId,
  };
}

function normalizeFrameIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((frameId) => Number(frameId))
    .filter((frameId) => Number.isInteger(frameId) && frameId >= 0)
    .filter((frameId, index, frameIds) => frameIds.indexOf(frameId) === index)
    .slice(0, 50);
}

function normalizeOneOffScriptWorld(value) {
  if (value === "USER_SCRIPT" || value === "ISOLATED") {
    return "USER_SCRIPT";
  }

  return "MAIN";
}

function normalizeInjectionResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map((item) => ({
    documentId:
      typeof item?.documentId === "string" && item.documentId.trim()
        ? item.documentId.trim()
        : null,
    error:
      typeof item?.error === "string" && item.error.trim()
        ? item.error.trim()
        : null,
    frameId: typeof item?.frameId === "number" ? item.frameId : 0,
    result: normalizeToolResult(item?.result),
  }));
}

function normalizeToolResult(value) {
  if (typeof value === "string") {
    return truncateToolString(value);
  }

  try {
    const json = JSON.stringify(value);
    if (typeof json === "string" && json.length > 8000) {
      return {
        truncated: true,
        preview: `${json.slice(0, 7999)}…`,
      };
    }
    return value ?? null;
  } catch {
    return String(value);
  }
}

function truncateToolString(value) {
  return value.length <= 8000 ? value : `${value.slice(0, 7999)}…`;
}

function formatInjectionTargetForTranscript(target) {
  if (Array.isArray(target?.frameIds) && target.frameIds.length > 0) {
    return `${target.frameIds.length} frame${target.frameIds.length === 1 ? "" : "s"}`;
  }

  return target?.allFrames ? "all frames" : "the main frame";
}

async function inspectPageWithContentScript(type, payload) {
  const tab = await getRequiredTargetTab();
  let response;

  try {
    response = await chrome.tabs.sendMessage(
      tab.id,
      {
        type,
        payload,
      },
      {
        frameId: 0,
      },
    );
  } catch (error) {
    if (shouldRetryContentScriptMessage(error)) {
      await waitForContentScriptReady(tab.id);
      response = await chrome.tabs.sendMessage(
        tab.id,
        {
          type,
          payload,
        },
        {
          frameId: 0,
        },
      );
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
      const response = await chrome.tabs.sendMessage(
        tabId,
        {
          type: "VIBE_PILOT_PING",
        },
        {
          frameId: 0,
        },
      );

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
    enabled: payload?.enabled !== false,
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

function normalizeRuleRecord(payload) {
  const draft = normalizeDraft(payload);

  return {
    ...draft,
    chatMessages: normalizeAssistantTranscriptMessages(payload?.chatMessages),
    chatPreviousResponseId: readOptionalString(payload?.chatPreviousResponseId),
  };
}

function normalizeAssistantTranscriptMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce((result, item) => {
    const role =
      item?.role === "assistant" || item?.role === "tool" || item?.role === "user"
        ? item.role
        : "assistant";
    const text = typeof item?.text === "string" ? item.text : "";
    const toolArgumentsText =
      typeof item?.toolArgumentsText === "string" ? item.toolArgumentsText : "";
    const images = normalizeAssistantTranscriptImages(item?.images);

    if (!text.trim() && !toolArgumentsText.trim() && !images.length) {
      return result;
    }

    result.push({
      createdAt:
        typeof item?.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt.trim()
          : new Date().toISOString(),
      id:
        typeof item?.id === "string" && item.id.trim()
          ? item.id.trim()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      images,
      role,
      status:
        typeof item?.status === "string" && item.status.trim()
          ? item.status.trim()
          : "ok",
      text,
      toolArgumentsText,
      toolName:
        typeof item?.toolName === "string" && item.toolName.trim()
          ? item.toolName.trim()
          : null,
    });
    return result;
  }, []);
}

function normalizeAssistantTranscriptImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce((result, item) => {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url) {
      return result;
    }

    result.push({
      alt:
        typeof item?.alt === "string" && item.alt.trim()
          ? item.alt.trim()
          : "Screenshot",
      label:
        typeof item?.label === "string" && item.label.trim()
          ? item.label.trim()
          : "",
      url,
    });
    return result;
  }, []);
}

function readOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function persistRule(rule) {
  const normalizedRule = normalizeRuleRecord(rule);
  const requestBody = {
    name: readRequiredRuleName(normalizedRule.name),
    enabled: normalizedRule.enabled,
    matchPattern: normalizedRule.matchPattern,
    html: normalizedRule.html,
    css: normalizedRule.css,
    javascript: normalizedRule.javascript,
    files: normalizedRule.files,
    chatMessages: normalizedRule.chatMessages,
    chatPreviousResponseId: normalizedRule.chatPreviousResponseId,
  };

  return fetchBackendJson(
    normalizedRule.id ? `/api/rules/${normalizedRule.id}` : "/api/rules",
    {
      method: normalizedRule.id ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    {
      timeoutMs: RULE_BACKEND_TIMEOUT_MS,
    },
  ).then(({ backendUrl, payload }) => ({
    ...payload,
    backendUrl,
  }));
}

async function fetchBackendJson(path, init, options = {}) {
  const candidates = await buildBackendCandidateUrls(path);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];

    try {
      return {
        backendUrl: getBackendOrigin(url),
        payload: await fetchJson(url, init, options),
      };
    } catch (error) {
      lastError = error;

      if (
        index < candidates.length - 1 &&
        shouldRetryWithNextBackendCandidate(error)
      ) {
        console.warn(
          "Backend request failed; retrying with another backend candidate.",
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
    : new Error("The backend request failed.");
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
