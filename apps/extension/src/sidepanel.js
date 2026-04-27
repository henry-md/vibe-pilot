import { HOT_RELOAD_ENABLED, HOT_RELOAD_URL } from "./config.js";
import {
  DEFAULT_DRAFT,
  DEFAULT_RULE_NAME,
  DEFAULT_RULE_SUMMARY,
  DEFAULT_WORKSPACE_RULE,
  EMPTY_WORKSPACE_RULE,
  EMPTY_RULE_SUMMARY,
} from "./default-draft.js";

const state = {
  activeEditor: "html",
  activeView: "create",
  currentRuleId: null,
  loadedRuleName: "",
  hydrated: false,
  hotReloading: false,
  rules: [],
};

const elements = {
  activeTabTitle: document.querySelector("#active-tab-title"),
  activeTabUrl: document.querySelector("#active-tab-url"),
  advancedCopy: document.querySelector("#advanced-copy"),
  applyDraftButton: document.querySelector("#apply-draft-button"),
  assistantChecks: document.querySelector("#assistant-checks"),
  assistantOutput: document.querySelector("#assistant-output"),
  assistantRuleSummary: document.querySelector("#assistant-rule-summary"),
  chatInput: document.querySelector("#chat-input"),
  clearScriptButton: document.querySelector("#clear-script-button"),
  cssSnippet: document.querySelector("#css-snippet"),
  editorPanels: Array.from(document.querySelectorAll("[data-editor-panel]")),
  editorTabs: Array.from(document.querySelectorAll("[data-editor-target]")),
  errorBanner: document.querySelector("#error-banner"),
  generateButton: document.querySelector("#generate-button"),
  htmlSnippet: document.querySelector("#html-snippet"),
  javascriptSnippet: document.querySelector("#javascript-snippet"),
  liveDraftValue: document.querySelector("#live-draft-value"),
  matchPattern: document.querySelector("#match-pattern"),
  refreshRulesButton: document.querySelector("#refresh-rules-button"),
  revertExampleButton: document.querySelector("#revert-example-button"),
  ruleName: document.querySelector("#rule-name"),
  rulesList: document.querySelector("#rules-list"),
  sampleRuleCopy: document.querySelector("#sample-rule-copy"),
  statusBanner: document.querySelector("#status-banner"),
  userScriptsValue: document.querySelector("#user-scripts-value"),
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]")),
  viewTabs: Array.from(document.querySelectorAll("[data-view-target]")),
};

boot();

async function boot() {
  wireEvents();
  wireHotReload();
  switchEditor("html");
  switchView("create");
  await refreshStatus({ hydrateRule: true });
}

function wireEvents() {
  elements.viewTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-view-target");
      if (target) {
        switchView(target);
      }
    });
  });

  elements.editorTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-editor-target");
      if (target) {
        switchEditor(target);
      }
    });
  });

  [
    elements.ruleName,
    elements.chatInput,
    elements.matchPattern,
    elements.htmlSnippet,
    elements.cssSnippet,
    elements.javascriptSnippet,
  ].forEach((field) => {
    field?.addEventListener("input", () => {
      if (
        field === elements.ruleName &&
        state.currentRuleId &&
        elements.ruleName.value.trim() !== state.loadedRuleName
      ) {
        state.currentRuleId = null;
      }

      syncWorkspaceState();
    });
  });

  elements.generateButton?.addEventListener("click", () =>
    runAction(
      async () => {
        const prompt = elements.chatInput?.value.trim() ?? "";
        if (!prompt) {
          throw new Error("Write a prompt before generating a rule.");
        }

        await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());

        const response = await sendMessage("VIBE_PILOT_GENERATE_DRAFT", {
          prompt,
        });

        writeWorkspaceRule({
          name:
            typeof response.name === "string" && response.name.trim()
              ? response.name.trim()
              : elements.ruleName.value.trim(),
          id: state.currentRuleId,
          ...response.draft,
        });
        renderAssistantOutput(response);
      },
      "Generating a new rule...",
      "Rule ready. Name it if needed, then apply it.",
    ),
  );

  elements.applyDraftButton?.addEventListener("click", () =>
    runAction(
      async () => {
        const rule = readWorkspaceRule();
        if (!hasRuleContent(rule)) {
          throw new Error("Generate a rule or load the example before applying.");
        }

        if (!rule.name) {
          throw new Error("Give this rule a name before applying it.");
        }

        const response = await sendMessage("VIBE_PILOT_APPLY_DRAFT", rule);
        if (response?.rule) {
          upsertRule(response.rule);
        }
        clearWorkspace();
        await refreshStatus();
      },
      "Applying the rule...",
      "Rule applied and saved. Workspace cleared for the next one.",
    ),
  );

  elements.clearScriptButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await sendMessage("VIBE_PILOT_CLEAR_SCRIPT");
        await refreshStatus();
      },
      "Clearing the live rule...",
      "Live rule cleared.",
    ),
  );

  elements.revertExampleButton?.addEventListener("click", () =>
    runAction(
      async () => {
        writeWorkspaceRule({
          ...DEFAULT_WORKSPACE_RULE,
        });
        renderAssistantOutput(null);
        await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
      },
      "Reloading the example...",
      "Hello world example loaded.",
    ),
  );

  elements.refreshRulesButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await loadRules();
      },
      "Loading saved rules...",
      "Saved rules refreshed.",
    ),
  );

  elements.rulesList?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const loadButton = target.closest("[data-load-rule-id]");
    if (loadButton instanceof HTMLElement) {
      const ruleId = loadButton.getAttribute("data-load-rule-id");
      if (ruleId) {
        void loadRuleIntoWorkspace(ruleId);
      }
      return;
    }

    const deleteButton = target.closest("[data-delete-rule-id]");
    if (deleteButton instanceof HTMLElement) {
      const ruleId = deleteButton.getAttribute("data-delete-rule-id");
      if (ruleId) {
        void deleteRuleFromList(ruleId);
      }
    }
  });
}

async function refreshStatus(options = {}) {
  try {
    const payload = await sendMessage("VIBE_PILOT_GET_STATUS");
    renderStatus(payload);

    if (options.hydrateRule || !state.hydrated) {
      writeWorkspaceRule(payload.draft ?? DEFAULT_WORKSPACE_RULE);
      state.hydrated = true;
    }

    setError("");
    setStatus("Ready for the current tab.");
    syncWorkspaceState();
  } catch (error) {
    setStatus("Unable to talk to the extension runtime.");
    setError(
      error instanceof Error ? error.message : "Unknown extension runtime error.",
    );
  }
}

async function runAction(action, pendingMessage, doneMessage) {
  toggleBusy(true);
  setStatus(pendingMessage);
  setError("");

  try {
    await action();
    setStatus(doneMessage);
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Unexpected extension error.",
    );
  } finally {
    toggleBusy(false);
  }
}

async function sendMessage(type, payload) {
  const response = await chrome.runtime.sendMessage({
    type,
    payload,
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown extension runtime failure.");
  }

  return response.payload;
}

function wireHotReload() {
  if (!HOT_RELOAD_ENABLED || typeof EventSource === "undefined") {
    return;
  }

  const source = new EventSource(`${HOT_RELOAD_URL}/__hot-reload`);

  source.addEventListener("reload", () => {
    void handleHotReload(source);
  });
}

async function handleHotReload(source) {
  if (state.hotReloading) {
    return;
  }

  state.hotReloading = true;
  toggleBusy(true);
  setError("");
  setStatus("Extension source changed. Reloading the unpacked build...");

  try {
    await sendMessage("VIBE_PILOT_PREPARE_HOT_RELOAD", {
      draft: readWorkspaceRule(),
    });
  } catch (error) {
    console.warn("Unable to persist rule before hot reload.", error);
  }

  source.close();

  if (chrome.runtime?.reload) {
    chrome.runtime.reload();
    return;
  }

  window.location.reload();
}

function renderStatus(payload) {
  const userScriptsLabel = payload.userScripts.available ? "Ready" : "Locked";
  const liveRuleLabel = payload.liveScriptRegistered ? "Live" : "Idle";

  elements.userScriptsValue.textContent = userScriptsLabel;
  elements.liveDraftValue.textContent = liveRuleLabel;
  elements.activeTabTitle.textContent =
    payload.activeTab?.title ?? "No target page detected";
  elements.activeTabUrl.textContent =
    payload.activeTab?.url ?? "Open a normal http(s) page in this window.";
}

function renderAssistantOutput(result) {
  if (!result) {
    elements.assistantOutput?.classList.add("is-hidden");
    elements.assistantRuleSummary.textContent = "";
    elements.assistantChecks.innerHTML = "";
    updateHelperCopy();
    updateAdvancedCopy();
    return;
  }

  elements.assistantOutput?.classList.remove("is-hidden");
  elements.assistantRuleSummary.textContent = result.ruleSummary ?? "";
  elements.assistantChecks.innerHTML = (result.checks ?? [])
    .map((check) => `<li>${escapeHtml(check)}</li>`)
    .join("");
}

function readWorkspaceRule() {
  return {
    id: state.currentRuleId,
    name: elements.ruleName.value.trim(),
    matchPattern:
      elements.matchPattern.value.trim() || DEFAULT_DRAFT.matchPattern,
    html: elements.htmlSnippet.value,
    css: elements.cssSnippet.value,
    javascript: elements.javascriptSnippet.value,
  };
}

function writeWorkspaceRule(rule) {
  state.currentRuleId =
    typeof rule?.id === "string" && rule.id.trim() ? rule.id.trim() : null;
  state.loadedRuleName = typeof rule?.name === "string" ? rule.name.trim() : "";

  elements.ruleName.value = state.loadedRuleName;
  elements.matchPattern.value = rule.matchPattern ?? DEFAULT_DRAFT.matchPattern;
  elements.htmlSnippet.value = rule.html ?? "";
  elements.cssSnippet.value = rule.css ?? "";
  elements.javascriptSnippet.value = rule.javascript ?? DEFAULT_DRAFT.javascript;

  updateHelperCopy(rule);
  updateAdvancedCopy(rule);
  syncWorkspaceState();
}

function switchView(nextView) {
  state.activeView = nextView;

  elements.viewTabs.forEach((button) => {
    const isActive = button.getAttribute("data-view-target") === nextView;
    button.classList.toggle("is-active", isActive);
  });

  elements.viewPanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-view-panel") === nextView;
    panel.classList.toggle("is-active", isActive);
    panel.classList.toggle("is-hidden", !isActive);
  });

  if (nextView === "rules") {
    void loadRules().catch((error) => {
      setError(
        error instanceof Error ? error.message : "Unable to load saved rules.",
      );
    });
  }
}

function switchEditor(nextEditor) {
  state.activeEditor = nextEditor;

  elements.editorTabs.forEach((button) => {
    const isActive = button.getAttribute("data-editor-target") === nextEditor;
    button.classList.toggle("is-active", isActive);
  });

  elements.editorPanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-editor-panel") === nextEditor;
    panel.classList.toggle("is-active", isActive);
  });
}

async function loadRules() {
  const payload = await sendMessage("VIBE_PILOT_LIST_RULES");
  state.rules = Array.isArray(payload.rules) ? payload.rules : [];
  renderRulesList(state.rules);
}

function renderRulesList(rules) {
  if (!elements.rulesList) {
    return;
  }

  if (!rules.length) {
    elements.rulesList.innerHTML =
      '<p class="empty-inline">No saved rules yet. Apply one from the create tab to add it here.</p>';
    return;
  }

  elements.rulesList.innerHTML = rules
    .map((rule) => {
      const target = rule.targetUrl || rule.matchPattern;
      const updatedAt = formatTimestamp(rule.updatedAt);

      return `
        <article class="rule-card">
          <div class="rule-card-header">
            <div>
              <h3 class="rule-card-name">${escapeHtml(rule.name)}</h3>
              <p class="rule-card-meta">${escapeHtml(target)}</p>
            </div>
            <button
              class="icon-button icon-button-danger"
              type="button"
              title="Delete rule"
              aria-label="Delete rule"
              data-delete-rule-id="${escapeHtml(rule.id)}"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6 2.75h4m-6 2h8m-6.5 1.5v4.5m3-4.5v4.5M5.25 4.75l.4 6.3a1 1 0 0 0 1 .95h2.7a1 1 0 0 0 1-.95l.4-6.3"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.4"
                />
              </svg>
            </button>
          </div>
          <div class="rule-card-actions">
            <span class="rule-stamp">${escapeHtml(updatedAt)}</span>
            <button
              class="secondary-button"
              type="button"
              data-load-rule-id="${escapeHtml(rule.id)}"
            >
              Load
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadRuleIntoWorkspace(ruleId) {
  const rule = state.rules.find((item) => item.id === ruleId);
  if (!rule) {
    setError("That rule could not be found.");
    return;
  }

  writeWorkspaceRule(rule);
  renderAssistantOutput(null);
  switchEditor("html");
  switchView("create");
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
  setStatus(`Loaded "${rule.name}" into the editor.`);
}

async function deleteRuleFromList(ruleId) {
  const rule = state.rules.find((item) => item.id === ruleId);
  const ruleName = rule?.name ?? "this rule";

  if (!window.confirm(`Delete "${ruleName}"?`)) {
    return;
  }

  await runAction(
    async () => {
      await sendMessage("VIBE_PILOT_DELETE_RULE", {
        ruleId,
      });
      state.rules = state.rules.filter((item) => item.id !== ruleId);
      renderRulesList(state.rules);

      if (state.currentRuleId === ruleId) {
        clearWorkspace();
      }

      await refreshStatus();
    },
    `Deleting "${ruleName}"...`,
    `"${ruleName}" deleted.`,
  );
}

function setStatus(message) {
  elements.statusBanner.textContent = message;
}

function setError(message) {
  if (!message) {
    elements.errorBanner.textContent = "";
    elements.errorBanner.classList.add("is-hidden");
    return;
  }

  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("is-hidden");
}

function toggleBusy(isBusy) {
  document.body.classList.toggle("is-busy", isBusy);
  document.body.setAttribute("aria-busy", String(isBusy));

  const buttons = [
    elements.applyDraftButton,
    elements.clearScriptButton,
    elements.generateButton,
    elements.refreshRulesButton,
    elements.revertExampleButton,
    ...elements.viewTabs,
    ...elements.editorTabs,
  ];

  for (const button of buttons) {
    if (button) {
      button.disabled = isBusy;
    }
  }

  if (!isBusy) {
    syncWorkspaceState();
  }
}

function clearWorkspace() {
  elements.chatInput.value = "";
  writeWorkspaceRule(EMPTY_WORKSPACE_RULE);
  renderAssistantOutput(null);
  switchEditor("html");
}

function syncWorkspaceState() {
  const rule = readWorkspaceRule();
  const applyReady = Boolean(rule.name) && hasRuleContent(rule);
  const generateReady = Boolean(elements.chatInput?.value.trim());

  if (elements.applyDraftButton) {
    elements.applyDraftButton.disabled = !applyReady;
  }

  if (elements.generateButton) {
    elements.generateButton.disabled = !generateReady;
  }

  if (
    !elements.assistantOutput ||
    elements.assistantOutput.classList.contains("is-hidden")
  ) {
    updateHelperCopy(rule);
  }

  updateAdvancedCopy(rule);
}

function updateHelperCopy(rule = readWorkspaceRule()) {
  if (isDefaultRule(rule)) {
    elements.sampleRuleCopy.textContent = DEFAULT_RULE_SUMMARY;
    return;
  }

  if (!rule.name && hasRuleContent(rule)) {
    elements.sampleRuleCopy.textContent =
      "Give this rule a name before you apply it.";
    return;
  }

  if (hasRuleContent(rule)) {
    elements.sampleRuleCopy.textContent =
      "Rule ready. Apply saves it, injects it, and sends it to the rules tab.";
    return;
  }

  elements.sampleRuleCopy.textContent = EMPTY_RULE_SUMMARY;
}

function updateAdvancedCopy(rule = readWorkspaceRule()) {
  if (!elements.advancedCopy) {
    return;
  }

  if (isDefaultRule(rule)) {
    elements.advancedCopy.textContent =
      "The Hello world example is loaded. Tweak the code here or click Apply.";
    return;
  }

  if (!rule.name && hasRuleContent(rule)) {
    elements.advancedCopy.textContent =
      "This rule needs a name before it can be applied or saved.";
    return;
  }

  if (hasRuleContent(rule)) {
    elements.advancedCopy.textContent =
      "Edit the current rule directly, then click Apply to save and inject it.";
    return;
  }

  elements.advancedCopy.textContent =
    "No rule loaded. Generate one above, or use revert to load the Hello world example.";
}

function hasRuleContent(rule) {
  return [rule.html, rule.css, rule.javascript].some((part) =>
    String(part ?? "").trim(),
  );
}

function isDefaultRule(rule) {
  return (
    rule.name === DEFAULT_RULE_NAME &&
    rule.matchPattern === DEFAULT_DRAFT.matchPattern &&
    rule.html === DEFAULT_DRAFT.html &&
    rule.css === DEFAULT_DRAFT.css &&
    rule.javascript === DEFAULT_DRAFT.javascript
  );
}

function upsertRule(rule) {
  const nextRule = {
    ...rule,
  };

  const existingIndex = state.rules.findIndex((item) => item.id === nextRule.id);
  if (existingIndex >= 0) {
    state.rules.splice(existingIndex, 1, nextRule);
  } else {
    state.rules.unshift(nextRule);
  }

  renderRulesList(state.rules);
}

function formatTimestamp(value) {
  if (!value) {
    return "Updated just now";
  }

  try {
    return `Updated ${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))}`;
  } catch {
    return "Updated recently";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
