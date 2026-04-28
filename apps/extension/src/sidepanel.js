import { HOT_RELOAD_ENABLED, HOT_RELOAD_URL } from "./config.js";
import {
  DEFAULT_DRAFT,
  DEFAULT_WORKSPACE_RULE,
  EMPTY_WORKSPACE_RULE,
  RED_TEXT_STARTER_WORKSPACE_RULE,
} from "./default-draft.js";

const ASSISTANT_PROGRESS_PORT_NAME = "vibe-pilot-assistant-progress";
const FILE_DEFINITIONS = [
  {
    key: "html",
    label: "HTML",
    defaultName: "index.html",
    extension: ".html",
    starterTitle: "Markup",
    placeholder: "hero-banner",
  },
  {
    key: "css",
    label: "CSS",
    defaultName: "index.css",
    extension: ".css",
    starterTitle: "Styles",
    placeholder: "surface-theme",
  },
  {
    key: "javascript",
    label: "JS",
    defaultName: "index.js",
    extension: ".js",
    starterTitle: "Logic",
    placeholder: "launch-state",
  },
];

const RED_TEXT_STARTER_LABEL = "Make Text Red";
const FILE_LAYOUT_STORAGE_KEY = "vibePilotFileLayout";

const state = {
  activeFile: "html",
  assistantMessages: [],
  assistantProgressPort: null,
  assistantPreviousResponseId: null,
  activeTab: null,
  activeView: "create",
  currentRuleId: null,
  editingRuleSnapshot: null,
  fileLayout: createDefaultFileLayout(),
  fileNamingSession: null,
  fileNames: createDefaultFileNames(),
  hydrated: false,
  isBusy: false,
  hotReloading: false,
  ruleFiles: [],
  rules: [],
};

const elements = {
  activeFileTitle: document.querySelector("#active-file-title"),
  applyDraftButton: document.querySelector("#apply-draft-button"),
  cancelButton: document.querySelector("#cancel-button"),
  chatClearButton: document.querySelector("#chat-clear-button"),
  chatImageLightbox: document.querySelector("#chat-image-lightbox"),
  chatImageLightboxCaption: document.querySelector("#chat-image-lightbox-caption"),
  chatImageLightboxClose: document.querySelector("#chat-image-lightbox-close"),
  chatImageLightboxImage: document.querySelector("#chat-image-lightbox-image"),
  chatInput: document.querySelector("#chat-input"),
  chatMessages: document.querySelector("#chat-messages"),
  chatSendButton: document.querySelector("#chat-send-button"),
  cssSnippet: document.querySelector("#css-snippet"),
  errorBanner: document.querySelector("#error-banner"),
  fileComposer: document.querySelector("#file-tab-composer"),
  fileComposerCancel: document.querySelector("#file-tab-composer-cancel"),
  fileComposerHint: document.querySelector("#file-tab-composer-hint"),
  fileComposerInput: document.querySelector("#file-tab-name-input"),
  fileComposerMode: document.querySelector("#file-tab-composer-mode"),
  fileComposerSave: document.querySelector("#file-tab-composer-save"),
  fileCreateButton: document.querySelector("#file-tab-create-button"),
  fileEditButtons: Array.from(document.querySelectorAll("[data-file-edit-target]")),
  filePanels: Array.from(document.querySelectorAll("[data-file-panel]")),
  fileTabShells: Array.from(document.querySelectorAll("[data-file-shell]")),
  fileTabLabels: {
    css: document.querySelector('[data-file-tab-label="css"]'),
    html: document.querySelector('[data-file-tab-label="html"]'),
    javascript: document.querySelector('[data-file-tab-label="javascript"]'),
  },
  fileTabs: Array.from(document.querySelectorAll("[data-file-target]")),
  filePanelLabels: {
    css: document.querySelector('[data-file-panel-label="css"]'),
    html: document.querySelector('[data-file-panel-label="html"]'),
    javascript: document.querySelector('[data-file-panel-label="javascript"]'),
  },
  htmlSnippet: document.querySelector("#html-snippet"),
  javascriptSnippet: document.querySelector("#javascript-snippet"),
  leaveEditButton: document.querySelector("#leave-edit-button"),
  loadExampleButton: document.querySelector("#load-example-button"),
  matchPattern: document.querySelector("#match-pattern"),
  newScaffoldInput: document.querySelector("#new-scaffold-name"),
  ruleModeLabel: document.querySelector("#rule-mode-label"),
  ruleName: document.querySelector("#rule-name"),
  rulesList: document.querySelector("#rules-list"),
  scaffoldRuleButton: document.querySelector("#scaffold-rule-button"),
  statusBanner: document.querySelector("#status-banner"),
  starterSuggestionButton: document.querySelector("#starter-suggestion-button"),
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]")),
  viewTabs: Array.from(document.querySelectorAll("[data-view-target]")),
};

boot();

async function boot() {
  state.fileLayout = await loadFileLayout();
  wireEvents();
  connectAssistantProgressPort();
  setCurrentFileNames(resolveFileNamesForRuleId(null));
  switchActiveFile(state.activeFile);
  switchView("create");
  autoResizeChat();
  renderChatMessages();
  renderScaffoldSuggestion();
  wireHotReload();
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

  elements.fileTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-file-target");
      if (target) {
        switchActiveFile(target);
      }
    });
  });

  [
    elements.ruleName,
    elements.matchPattern,
    elements.htmlSnippet,
    elements.cssSnippet,
    elements.javascriptSnippet,
  ].forEach((field) => {
    field?.addEventListener("input", () => {
      syncWorkspaceState();
    });
  });

  elements.fileCreateButton?.addEventListener("click", () => {
    const nextFile = pickNextNameableFile();
    if (nextFile) {
      openFileNamingSession(nextFile, "create");
    }
  });

  elements.fileEditButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const target = button.getAttribute("data-file-edit-target");
      if (target) {
        openFileNamingSession(target, "edit");
      }
    });
  });

  elements.fileComposerCancel?.addEventListener("click", () => {
    closeFileNamingSession();
  });

  elements.fileComposerSave?.addEventListener("click", () => {
    void commitFileNamingSession();
  });

  elements.fileComposerInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitFileNamingSession();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeFileNamingSession();
    }
  });

  elements.chatInput?.addEventListener("input", () => {
    autoResizeChat();
    syncWorkspaceState();
  });

  elements.chatInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendAssistantMessage();
  });

  elements.chatSendButton?.addEventListener("click", () => {
    void sendAssistantMessage();
  });

  elements.chatClearButton?.addEventListener("click", () => {
    resetAssistantConversation();
  });

  elements.chatMessages?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const imageButton = target?.closest("[data-chat-image-button]");
    if (!(imageButton instanceof HTMLElement)) {
      return;
    }

    const url = imageButton.getAttribute("data-image-url") ?? "";
    if (!url) {
      return;
    }

    openChatImageLightbox({
      alt: imageButton.getAttribute("data-image-alt") ?? "Screenshot",
      label: imageButton.getAttribute("data-image-label") ?? "",
      url,
    });
  });

  elements.chatImageLightboxClose?.addEventListener("click", () => {
    closeChatImageLightbox();
  });

  elements.chatImageLightbox?.addEventListener("click", (event) => {
    if (event.target === elements.chatImageLightbox) {
      closeChatImageLightbox();
    }
  });

  elements.chatImageLightbox?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeChatImageLightbox();
  });

  elements.newScaffoldInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createNamedScaffold();
    }
  });

  elements.scaffoldRuleButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await createNamedScaffold();
      },
      "Creating a new scaffold...",
      "New scaffold ready.",
    ),
  );

  elements.starterSuggestionButton?.addEventListener("click", () => {
    void runAction(
      async () => {
        await loadFreshWorkspace(RED_TEXT_STARTER_WORKSPACE_RULE);
      },
      "Loading the red text starter...",
      "Red text override ready.",
    );
  });

  elements.loadExampleButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await loadFreshWorkspace(DEFAULT_WORKSPACE_RULE);
      },
      "Loading the Hello World example...",
      "Hello World Pill loaded.",
    ),
  );

  elements.cancelButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await cancelCurrentFlow();
      },
      "Canceling this rule...",
      isEditingSavedRule()
        ? "Rule reverted to the saved version."
        : "New rule cleared.",
    ),
  );

  elements.leaveEditButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await leaveSavedRule();
      },
      "Leaving this saved rule...",
      "Blank rule ready.",
    ),
  );

  elements.applyDraftButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await applyCurrentRule();
      },
      "Applying the rule...",
      "Rule applied.",
    ),
  );

  elements.rulesList?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const deleteButton = target.closest("[data-delete-rule-id]");
    if (deleteButton instanceof HTMLElement) {
      const ruleId = deleteButton.getAttribute("data-delete-rule-id");
      if (ruleId) {
        void deleteRuleFromList(ruleId);
      }
      return;
    }

    const ruleButton = target.closest("[data-edit-rule-id]");
    if (ruleButton instanceof HTMLElement) {
      const ruleId = ruleButton.getAttribute("data-edit-rule-id");
      if (ruleId) {
        void openRuleEditor(ruleId);
      }
    }
  });
}

async function refreshStatus(options = {}) {
  try {
    const payload = await sendMessage("VIBE_PILOT_GET_STATUS");
    state.activeTab = payload.activeTab ?? null;
    renderScaffoldSuggestion();

    if (options.hydrateRule || !state.hydrated) {
      writeWorkspaceRule(payload.draft ?? EMPTY_WORKSPACE_RULE, {
        fileNames: resolveFileNamesForRuleId(payload.draft?.id ?? null),
      });
      state.hydrated = true;
    }

    setError("");
    setStatus("Ready.");
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

async function createNamedScaffold(requestedNameOverride = "") {
  const requestedName =
    requestedNameOverride.trim() ||
    elements.newScaffoldInput?.value.trim() ||
    "";

  if (!requestedName) {
    throw new Error("Type a name first.");
  }

  if (!confirmReplacingDraft()) {
    return;
  }

  await loadFreshWorkspace(
    {
      ...EMPTY_WORKSPACE_RULE,
      name: requestedName,
    },
  );
}

async function sendAssistantMessage() {
  const prompt = elements.chatInput?.value.trim() ?? "";
  if (!prompt) {
    return;
  }

  appendAssistantMessages([
    createAssistantMessage("user", prompt),
  ]);
  clearChat();

  await runAction(
    async () => {
      await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
      const response = await sendMessage("VIBE_PILOT_RUN_ASSISTANT", {
        prompt,
        previousResponseId: state.assistantPreviousResponseId,
      });

      state.assistantPreviousResponseId =
        typeof response?.previousResponseId === "string" &&
        response.previousResponseId.trim()
          ? response.previousResponseId.trim()
          : null;

      if (response?.activeTab) {
        state.activeTab = response.activeTab;
        renderScaffoldSuggestion();
      }

      if (response?.currentDraft) {
        await syncDraftFromAssistant(response.currentDraft);
      }

      if (Array.isArray(response?.messages) && response.messages.length > 0) {
        appendAssistantMessages(normalizeAssistantMessages(response.messages));
      }
    },
    "Vibe Pilot is working...",
    "Assistant finished.",
  );
}

async function cancelCurrentFlow() {
  if (isEditingSavedRule()) {
    writeWorkspaceRule(state.editingRuleSnapshot.rule, {
      fileNames: state.editingRuleSnapshot.fileNames,
    });
  } else {
    resetEditSession();
    setCurrentFileNames(createDefaultFileNames());
    writeWorkspaceRule(EMPTY_WORKSPACE_RULE, {
      fileNames: createDefaultFileNames(),
    });
  }

  clearChat();
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
}

async function leaveSavedRule() {
  resetEditSession();
  setCurrentFileNames(createDefaultFileNames());
  writeWorkspaceRule(EMPTY_WORKSPACE_RULE, {
    fileNames: createDefaultFileNames(),
  });
  clearChat();
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
}

async function applyCurrentRule() {
  const rule = readWorkspaceRule();
  if (!hasRuleContent(rule)) {
    throw new Error("Add code to at least one file before you apply.");
  }

  if (!rule.name) {
    throw new Error("Give this rule a name before you apply it.");
  }

  const previousRuleId = state.currentRuleId;
  const previousSnapshot = state.editingRuleSnapshot;
  const currentFileNames = normalizeFileNames(state.fileNames);
  const response = await sendMessage("VIBE_PILOT_APPLY_DRAFT", rule);

  if (response?.rule) {
    upsertRule(response.rule);

    if (response.rule.id) {
      saveRuleFileNames(response.rule.id, currentFileNames);
      if (!previousRuleId) {
        state.fileLayout.draft = createDefaultFileNames();
      }
      await saveFileLayout();
    }

    state.editingRuleSnapshot = createEditorSnapshot(
      response.rule,
      currentFileNames,
    );
    writeWorkspaceRule(response.rule, {
      fileNames: currentFileNames,
    });
  } else {
    state.editingRuleSnapshot = previousSnapshot;
    writeWorkspaceRule(rule, {
      fileNames: currentFileNames,
    });
    setError("The live rule was applied, but it could not be saved to the rules tab.");
  }

  clearChat();
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());

  if (response?.rule) {
    switchView("rules");
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

function connectAssistantProgressPort() {
  if (state.assistantProgressPort || !chrome.runtime?.connect) {
    return;
  }

  const port = chrome.runtime.connect({
    name: ASSISTANT_PROGRESS_PORT_NAME,
  });

  state.assistantProgressPort = port;

  port.onMessage.addListener((message) => {
    handleAssistantProgressMessage(message);
  });

  port.onDisconnect.addListener(() => {
    if (state.assistantProgressPort === port) {
      state.assistantProgressPort = null;
    }

    if (!state.hotReloading) {
      window.setTimeout(() => {
        connectAssistantProgressPort();
      }, 250);
    }
  });
}

function handleAssistantProgressMessage(message) {
  if (message?.type !== "assistant-message-upsert") {
    return;
  }

  appendAssistantMessages([message.message]);
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
    await persistCurrentFileNames();
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

function readWorkspaceRule() {
  return {
    id: state.currentRuleId,
    name: elements.ruleName?.value.trim() ?? "",
    matchPattern:
      elements.matchPattern?.value.trim() || DEFAULT_DRAFT.matchPattern,
    html: elements.htmlSnippet?.value ?? "",
    css: elements.cssSnippet?.value ?? "",
    javascript: elements.javascriptSnippet?.value ?? "",
    files: normalizeRuleFiles(state.ruleFiles),
  };
}

function writeWorkspaceRule(rule, options = {}) {
  if (state.fileNamingSession) {
    closeFileNamingSession();
  }

  state.currentRuleId =
    typeof rule?.id === "string" && rule.id.trim() ? rule.id.trim() : null;

  if (elements.ruleName) {
    elements.ruleName.value = typeof rule?.name === "string" ? rule.name : "";
  }
  if (elements.matchPattern) {
    elements.matchPattern.value =
      rule?.matchPattern ?? DEFAULT_DRAFT.matchPattern;
  }
  if (elements.htmlSnippet) {
    elements.htmlSnippet.value = rule?.html ?? "";
  }
  if (elements.cssSnippet) {
    elements.cssSnippet.value = rule?.css ?? "";
  }
  if (elements.javascriptSnippet) {
    elements.javascriptSnippet.value = rule?.javascript ?? "";
  }

  state.ruleFiles = normalizeRuleFiles(rule?.files);

  setCurrentFileNames(
    options.fileNames ?? resolveFileNamesForRuleId(state.currentRuleId),
  );
  syncWorkspaceState();
}

function switchView(nextView) {
  state.activeView = nextView;

  if (nextView !== "create" && state.fileNamingSession) {
    closeFileNamingSession();
  }

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

function switchActiveFile(nextFile, options = {}) {
  if (!FILE_DEFINITIONS.some((file) => file.key === nextFile)) {
    return;
  }

  if (
    !options.preserveComposer &&
    state.fileNamingSession &&
    state.fileNamingSession.fileKey !== nextFile
  ) {
    closeFileNamingSession();
  }

  state.activeFile = nextFile;

  elements.fileTabs.forEach((button) => {
    const isActive = button.getAttribute("data-file-target") === nextFile;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  elements.filePanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-file-panel") === nextFile;
    panel.classList.toggle("is-active", isActive);
  });

  updateFileLabels();
}

function pickNextNameableFile() {
  return FILE_DEFINITIONS.find((file) => isDefaultFileName(file.key))?.key ?? null;
}

function openFileNamingSession(fileKey, mode) {
  const definition = getFileDefinition(fileKey);
  if (
    !definition ||
    !elements.fileComposer ||
    !elements.fileComposerInput ||
    !elements.fileComposerMode ||
    !elements.fileComposerHint
  ) {
    return;
  }

  switchActiveFile(fileKey, { preserveComposer: true });
  state.fileNamingSession = {
    fileKey,
    mode,
  };

  elements.fileComposer.classList.remove("is-hidden");
  elements.fileComposerMode.textContent =
    mode === "create" ? `Name ${definition.label} file` : `Rename ${definition.label} file`;
  elements.fileComposerHint.textContent =
    mode === "create"
      ? `Give the ${definition.label} starter tab a production-ready name.`
      : `Rename this ${definition.label} tab without changing its code slot.`;
  elements.fileComposerInput.placeholder = definition.placeholder;
  elements.fileComposerInput.value = getEditableFileName(fileKey);

  renderFileTabState();

  requestAnimationFrame(() => {
    elements.fileComposerInput?.focus();
    elements.fileComposerInput?.select();
  });
}

function closeFileNamingSession() {
  state.fileNamingSession = null;
  elements.fileComposer?.classList.add("is-hidden");

  if (elements.fileComposerInput) {
    elements.fileComposerInput.value = "";
  }

  renderFileTabState();
}

async function commitFileNamingSession() {
  if (!state.fileNamingSession) {
    return;
  }

  const definition = getFileDefinition(state.fileNamingSession.fileKey);
  if (!definition || !elements.fileComposerInput) {
    return;
  }

  state.fileNames[state.fileNamingSession.fileKey] = normalizeSingleFileName(
    elements.fileComposerInput.value,
    definition,
  );
  closeFileNamingSession();
  updateFileLabels();
  await persistCurrentFileNames();
}

async function loadRules() {
  const payload = await sendMessage("VIBE_PILOT_LIST_RULES");
  state.rules = Array.isArray(payload.rules)
    ? payload.rules.map((rule) => createRuleSnapshot(rule))
    : [];
  renderRulesList(state.rules);
}

function renderRulesList(rules) {
  if (!elements.rulesList) {
    return;
  }

  if (!rules.length) {
    elements.rulesList.innerHTML =
      '<p class="empty-inline">No saved rules yet.</p>';
    return;
  }

  elements.rulesList.innerHTML = rules
    .map((rule) => {
      const target = rule.matchPattern;

      return `
        <article class="rule-card-shell">
          <button
            class="rule-card"
            type="button"
            data-edit-rule-id="${escapeHtml(rule.id)}"
            aria-label="Open ${escapeHtml(rule.name)}"
          >
            <strong class="rule-card-name">${escapeHtml(rule.name)}</strong>
            <p class="rule-card-meta">${escapeHtml(target)}</p>
          </button>
          <button
            class="icon-button icon-button-danger rule-delete-button"
            type="button"
            data-delete-rule-id="${escapeHtml(rule.id)}"
            aria-label="Delete ${escapeHtml(rule.name)}"
            title="Delete ${escapeHtml(rule.name)}"
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
        </article>
      `;
    })
    .join("");
}

async function openRuleEditor(ruleId) {
  const rule = state.rules.find((item) => item.id === ruleId);
  if (!rule) {
    setError("That rule could not be found.");
    return;
  }

  const fileNames = resolveFileNamesForRuleId(rule.id);
  state.editingRuleSnapshot = createEditorSnapshot(rule, fileNames);
  writeWorkspaceRule(rule, {
    fileNames,
  });
  switchActiveFile("html");
  clearChat();
  switchView("create");
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
  setStatus(`Editing "${rule.name}".`);
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
      delete state.fileLayout.rules[ruleId];
      await saveFileLayout();

      if (state.currentRuleId === ruleId) {
        await leaveSavedRule();
      }
    },
    `Deleting "${ruleName}"...`,
    `"${ruleName}" deleted.`,
  );
}

function setStatus(message) {
  if (elements.statusBanner) {
    elements.statusBanner.textContent = message;
  }
}

function setError(message) {
  if (!elements.errorBanner) {
    return;
  }

  if (!message) {
    elements.errorBanner.textContent = "";
    elements.errorBanner.classList.add("is-hidden");
    return;
  }

  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("is-hidden");
}

function toggleBusy(isBusy) {
  state.isBusy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
  document.body.setAttribute("aria-busy", String(isBusy));

  const buttons = [
    elements.applyDraftButton,
    elements.cancelButton,
    elements.chatClearButton,
    elements.chatSendButton,
    elements.fileComposerCancel,
    elements.fileComposerSave,
    elements.fileCreateButton,
    elements.leaveEditButton,
    elements.loadExampleButton,
    elements.scaffoldRuleButton,
    elements.starterSuggestionButton,
    ...elements.fileEditButtons,
    ...elements.fileTabs,
    ...elements.viewTabs,
  ];

  buttons.forEach((button) => {
    if (button) {
      button.disabled = isBusy;
    }
  });

  [
    elements.chatInput,
    elements.cssSnippet,
    elements.fileComposerInput,
    elements.htmlSnippet,
    elements.javascriptSnippet,
    elements.matchPattern,
    elements.newScaffoldInput,
    elements.ruleName,
  ].forEach((field) => {
    if (field) {
      field.disabled = isBusy;
    }
  });

  if (!isBusy) {
    renderFileTabState();
    syncWorkspaceState();
  }
}

function syncWorkspaceState() {
  const rule = readWorkspaceRule();
  const applyReady = Boolean(rule.name) && hasRuleContent(rule);

  if (elements.applyDraftButton) {
    elements.applyDraftButton.disabled = !applyReady;
  }

  if (elements.ruleModeLabel) {
    elements.ruleModeLabel.textContent = isEditingSavedRule()
      ? "Editing saved rule"
      : "New rule";
  }

  if (elements.leaveEditButton) {
    elements.leaveEditButton.classList.toggle("is-hidden", !isEditingSavedRule());
  }

  if (elements.chatClearButton) {
    elements.chatClearButton.disabled =
      state.isBusy ||
      (state.assistantMessages.length === 0 && !state.assistantPreviousResponseId);
  }
}

function clearChat() {
  if (elements.chatInput) {
    elements.chatInput.value = "";
  }
  autoResizeChat();
}

function resetAssistantConversation() {
  state.assistantMessages = [];
  state.assistantPreviousResponseId = null;
  renderChatMessages();
  clearChat();
  setStatus("Chat cleared.");
}

function appendAssistantMessages(messages) {
  const normalizedMessages = normalizeAssistantMessages(messages);

  if (!normalizedMessages.length) {
    return;
  }

  normalizedMessages.forEach((message) => {
    const existingIndex = state.assistantMessages.findIndex(
      (candidate) => candidate.id === message.id,
    );

    if (existingIndex < 0) {
      state.assistantMessages.push(message);
      return;
    }

    const existingMessage = state.assistantMessages[existingIndex];
    state.assistantMessages[existingIndex] = {
      ...existingMessage,
      ...message,
      createdAt:
        typeof existingMessage?.createdAt === "string" && existingMessage.createdAt.trim()
          ? existingMessage.createdAt
          : message.createdAt,
    };
  });

  renderChatMessages();
}

function normalizeAssistantMessages(messages) {
  return messages
    .map((message) => ({
      createdAt:
        typeof message?.createdAt === "string" && message.createdAt.trim()
          ? message.createdAt
          : new Date().toISOString(),
      id:
        typeof message?.id === "string" && message.id.trim()
          ? message.id.trim()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      images: Array.isArray(message?.images)
        ? message.images
            .filter((image) => typeof image?.url === "string" && image.url.trim())
            .map((image) => ({
              alt:
                typeof image.alt === "string" && image.alt.trim()
                  ? image.alt.trim()
                  : "Screenshot",
              label:
                typeof image.label === "string" && image.label.trim()
                  ? image.label.trim()
                  : "",
              url: image.url,
            }))
        : [],
      role:
        message?.role === "assistant" ||
        message?.role === "tool" ||
        message?.role === "user"
        ? message.role
        : "assistant",
      status:
        typeof message?.status === "string" && message.status.trim()
          ? message.status.trim()
          : "ok",
      text: typeof message?.text === "string" ? message.text : "",
      toolArgumentsText:
        typeof message?.toolArgumentsText === "string"
          ? message.toolArgumentsText
          : "",
      toolName:
        typeof message?.toolName === "string" && message.toolName.trim()
          ? message.toolName.trim()
          : null,
    }))
    .filter((message) => message.text || message.images.length > 0);
}

function createAssistantMessage(role, text, options = {}) {
  return {
    createdAt:
      typeof options.createdAt === "string" && options.createdAt.trim()
        ? options.createdAt.trim()
        : new Date().toISOString(),
    id:
      typeof options.id === "string" && options.id.trim()
        ? options.id.trim()
        : `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

function renderChatMessages() {
  if (!elements.chatMessages) {
    return;
  }

  if (!state.assistantMessages.length) {
    elements.chatMessages.innerHTML = `
      <div class="chat-empty-state">
        Vibe Pilot can inspect the page, read the DOM, capture screenshots, update the draft,
        apply it, and re-check the result before replying.
      </div>
    `;
    syncWorkspaceState();
    return;
  }

  elements.chatMessages.innerHTML = groupAssistantMessages(state.assistantMessages)
    .map((block) => renderTranscriptBlock(block))
    .join("");
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  syncWorkspaceState();
}

function groupAssistantMessages(messages) {
  const blocks = [];
  let toolMessages = [];

  const flushToolMessages = () => {
    if (!toolMessages.length) {
      return;
    }

    blocks.push({
      messages: toolMessages,
      type: "tool-group",
    });
    toolMessages = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      toolMessages.push(message);
      continue;
    }

    flushToolMessages();
    blocks.push({
      message,
      type: "message",
    });
  }

  flushToolMessages();
  return blocks;
}

function renderTranscriptBlock(block) {
  if (block.type === "tool-group") {
    return renderToolGroup(block.messages);
  }

  return renderChatMessage(block.message);
}

function renderChatMessage(message) {
  const metaBits = [];
  const label =
    message.role === "user"
      ? "You"
      : message.role === "tool"
        ? message.toolName || "Tool"
        : "Vibe Pilot";

  metaBits.push(`<span>${escapeHtml(label)}</span>`);

  if (message.role === "tool" && message.status === "error") {
    metaBits.push('<span class="chat-meta-pill chat-meta-pill-error">Tool error</span>');
  }

  const imagesMarkup = renderImageCards(message.images);

  return `
    <article class="chat-message chat-message-${escapeHtml(message.role)}">
      <div class="chat-message-meta">${metaBits.join("")}</div>
      ${message.text ? `<p class="chat-message-text">${formatMultilineText(message.text)}</p>` : ""}
      ${imagesMarkup ? `<div class="chat-image-grid">${imagesMarkup}</div>` : ""}
    </article>
  `;
}

function renderToolGroup(messages) {
  const uniqueToolLabels = Array.from(
    new Set(
      messages
        .map((message) => formatToolLabel(message.toolName))
        .filter(Boolean),
    ),
  );
  const hasError = messages.some((message) => message.status === "error");
  const screenshotCount = messages.reduce(
    (count, message) => count + message.images.length,
    0,
  );
  const summaryCopy = [
    `${messages.length} tool call${messages.length === 1 ? "" : "s"}`,
    screenshotCount
      ? `${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const pillMarkup = uniqueToolLabels
    .slice(0, 5)
    .map(
      (label) => `<span class="chat-tool-pill">${escapeHtml(label)}</span>`,
    )
    .join("");

  const callMarkup = messages
    .map((message, index) => renderToolCall(message, index))
    .join("");

  return `
    <details class="chat-tool-group${hasError ? " is-error" : ""}" ${
      hasError ? "open" : ""
    }>
      <summary class="chat-tool-summary">
        <div class="chat-tool-summary-top">
          <span class="chat-tool-summary-title">See tool calls</span>
          <span class="chat-meta-pill">${messages.length}</span>
        </div>
        ${pillMarkup ? `<div class="chat-tool-pill-row">${pillMarkup}</div>` : ""}
        <p class="chat-tool-summary-copy">${escapeHtml(summaryCopy)}</p>
      </summary>
      <div class="chat-toolcall-list">${callMarkup}</div>
    </details>
  `;
}

function renderToolCall(message, index) {
  const toolLabel = formatToolLabel(message.toolName) || "Tool";
  const imagesMarkup = renderImageCards(message.images);

  return `
    <article class="chat-toolcall${message.status === "error" ? " is-error" : ""}">
      <div class="chat-toolcall-header">
        <div class="chat-toolcall-title-row">
          <span class="chat-toolcall-index">${index + 1}</span>
          <strong class="chat-toolcall-name">${escapeHtml(toolLabel)}</strong>
        </div>
        ${
          message.status === "error"
            ? '<span class="chat-meta-pill chat-meta-pill-error">Error</span>'
            : ""
        }
      </div>
      ${message.text ? `<p class="chat-toolcall-text">${formatMultilineText(message.text)}</p>` : ""}
      ${imagesMarkup ? `<div class="chat-image-grid">${imagesMarkup}</div>` : ""}
    </article>
  `;
}

function renderImageCards(images) {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return images
    .map((image) => {
      const label = image.label || image.alt || "Screenshot";

      return `
        <figure class="chat-image-card">
          <button
            class="chat-image-button"
            type="button"
            data-chat-image-button
            data-image-url="${escapeHtml(image.url)}"
            data-image-alt="${escapeHtml(image.alt)}"
            data-image-label="${escapeHtml(label)}"
          >
            <span class="chat-image-frame">
              <img class="chat-image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" />
              <span class="chat-image-zoom">Expand</span>
            </span>
          </button>
          ${
            label
              ? `<figcaption class="chat-image-caption">${escapeHtml(label)}</figcaption>`
              : ""
          }
        </figure>
      `;
    })
    .join("");
}

function openChatImageLightbox(image) {
  if (!elements.chatImageLightbox || !elements.chatImageLightboxImage) {
    return;
  }

  elements.chatImageLightboxImage.src = image.url;
  elements.chatImageLightboxImage.alt = image.alt || "Expanded screenshot";

  if (elements.chatImageLightboxCaption) {
    elements.chatImageLightboxCaption.textContent =
      image.label || image.alt || "Screenshot";
  }

  if (typeof elements.chatImageLightbox.showModal === "function") {
    if (!elements.chatImageLightbox.open) {
      elements.chatImageLightbox.showModal();
    }
  } else {
    elements.chatImageLightbox.setAttribute("open", "open");
  }
}

function closeChatImageLightbox() {
  if (!elements.chatImageLightbox) {
    return;
  }

  if (typeof elements.chatImageLightbox.close === "function") {
    if (elements.chatImageLightbox.open) {
      elements.chatImageLightbox.close();
    }
  } else {
    elements.chatImageLightbox.removeAttribute("open");
  }
}

function formatToolLabel(value) {
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

async function syncDraftFromAssistant(rule) {
  const nextRule = createRuleSnapshot(rule);
  const previousRuleId = state.currentRuleId;
  const currentFileNames = normalizeFileNames(state.fileNames);

  if (nextRule.id) {
    saveRuleFileNames(nextRule.id, currentFileNames);
    if (!previousRuleId) {
      state.fileLayout.draft = createDefaultFileNames();
    }
    await saveFileLayout();
    state.editingRuleSnapshot = createEditorSnapshot(nextRule, currentFileNames);
    upsertRule(nextRule);
  }

  writeWorkspaceRule(nextRule, {
    fileNames: currentFileNames,
  });
  await persistCurrentFileNames();
}

function autoResizeChat() {
  if (!elements.chatInput) {
    return;
  }

  elements.chatInput.style.height = "auto";
  elements.chatInput.style.height = `${elements.chatInput.scrollHeight}px`;
}

function hasRuleContent(rule) {
  if (normalizeRuleFiles(rule?.files).length > 0) {
    return true;
  }

  return [rule.html, rule.css, rule.javascript].some(
    (part) => String(part ?? "").trim(),
  );
}

function hasWorkInProgressDraft() {
  const currentRule = readWorkspaceRule();
  return Boolean(
    currentRule.name ||
      hasRuleContent(currentRule) ||
      (elements.chatInput?.value.trim() ?? ""),
  );
}

function confirmReplacingDraft() {
  return (
    !hasWorkInProgressDraft() ||
    window.confirm("Start a fresh scaffold and replace the current draft?")
  );
}

async function loadFreshWorkspace(rule) {
  const defaultFileNames = createDefaultFileNames();

  state.currentRuleId = null;
  resetEditSession();
  setCurrentFileNames(defaultFileNames);
  writeWorkspaceRule(rule, {
    fileNames: defaultFileNames,
  });
  switchActiveFile("html");
  clearChat();

  if (elements.newScaffoldInput) {
    elements.newScaffoldInput.value = "";
  }

  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
}

function isEditingSavedRule() {
  return Boolean(state.editingRuleSnapshot?.rule?.id);
}

function createEditorSnapshot(rule, fileNames) {
  return {
    fileNames: normalizeFileNames(fileNames),
    rule: createRuleSnapshot(rule),
  };
}

function createRuleSnapshot(rule) {
  return {
    id: typeof rule?.id === "string" && rule.id.trim() ? rule.id.trim() : null,
    name: typeof rule?.name === "string" ? rule.name.trim() : "",
    matchPattern:
      typeof rule?.matchPattern === "string" && rule.matchPattern.trim()
        ? rule.matchPattern.trim()
        : DEFAULT_DRAFT.matchPattern,
    html: typeof rule?.html === "string" ? rule.html : "",
    css: typeof rule?.css === "string" ? rule.css : "",
    javascript: typeof rule?.javascript === "string" ? rule.javascript : "",
    files: normalizeRuleFiles(rule?.files),
  };
}

function resetEditSession() {
  state.editingRuleSnapshot = null;
}

function upsertRule(rule) {
  const nextRule = createRuleSnapshot(rule);

  const existingIndex = state.rules.findIndex((item) => item.id === nextRule.id);
  if (existingIndex >= 0) {
    state.rules.splice(existingIndex, 1, nextRule);
  } else {
    state.rules.unshift(nextRule);
  }

  renderRulesList(state.rules);
}

function createDefaultFileNames() {
  return FILE_DEFINITIONS.reduce((result, file) => {
    result[file.key] = file.defaultName;
    return result;
  }, {});
}

function createDefaultFileLayout() {
  return {
    draft: createDefaultFileNames(),
    rules: {},
  };
}

function getFileDefinition(fileKey) {
  return FILE_DEFINITIONS.find((file) => file.key === fileKey) ?? null;
}

function setCurrentFileNames(fileNames) {
  state.fileNames = {
    ...createDefaultFileNames(),
    ...fileNames,
  };
  updateFileLabels();
}

function updateFileLabels() {
  FILE_DEFINITIONS.forEach((file) => {
    const displayName = getDisplayFileName(file.key);
    const tabLabel = elements.fileTabLabels[file.key];
    const panelLabel = elements.filePanelLabels[file.key];
    const tabButton = elements.fileTabs.find(
      (button) => button.getAttribute("data-file-target") === file.key,
    );
    const editButton = elements.fileEditButtons.find(
      (button) => button.getAttribute("data-file-edit-target") === file.key,
    );
    const actualFileName = state.fileNames[file.key] ?? file.defaultName;

    if (tabLabel) {
      tabLabel.textContent = displayName;
    }

    if (panelLabel) {
      panelLabel.textContent = displayName;
    }

    if (tabButton) {
      tabButton.title = `${file.label} slot · ${actualFileName}`;
    }

    if (editButton) {
      editButton.title = `Rename ${displayName}`;
      editButton.setAttribute("aria-label", `Rename ${displayName}`);
    }
  });

  if (elements.activeFileTitle) {
    elements.activeFileTitle.textContent = getDisplayFileName(state.activeFile);
  }

  renderFileTabState();
}

function getDisplayFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (!definition) {
    return "";
  }

  const normalizedFileName = normalizeSingleFileName(
    state.fileNames[fileKey],
    definition,
  );

  if (normalizedFileName === definition.defaultName) {
    return definition.starterTitle;
  }

  return stripKnownExtension(normalizedFileName, definition);
}

function renderFileTabState() {
  const nextNameableFile = pickNextNameableFile();

  elements.fileTabShells.forEach((shell) => {
    const fileKey = shell.getAttribute("data-file-shell");
    const isActive = fileKey === state.activeFile;
    const isEditing = fileKey === state.fileNamingSession?.fileKey;
    const isNamed = !isDefaultFileName(fileKey);

    shell.classList.toggle("is-active", isActive);
    shell.classList.toggle("is-editing", isEditing);
    shell.classList.toggle("is-named", isNamed);
  });

  if (elements.fileCreateButton) {
    const canCreateName = Boolean(nextNameableFile);
    elements.fileCreateButton.disabled = state.isBusy || !canCreateName;
    elements.fileCreateButton.title = canCreateName
      ? "Name another starter file"
      : "All starter files already have names";
    elements.fileCreateButton.setAttribute(
      "aria-label",
      canCreateName
        ? "Name another starter file"
        : "All starter files already have names",
    );
  }
}

function isDefaultFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (!definition) {
    return true;
  }

  return (
    normalizeSingleFileName(state.fileNames[fileKey], definition) ===
    definition.defaultName
  );
}

function getEditableFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (!definition || isDefaultFileName(fileKey)) {
    return "";
  }

  return stripKnownExtension(state.fileNames[fileKey], definition);
}

function stripKnownExtension(value, definition) {
  const trimmed = String(value ?? "").trim();
  const normalizedExtension = definition.extension.toLowerCase();

  if (trimmed.toLowerCase().endsWith(normalizedExtension)) {
    return trimmed.slice(0, -definition.extension.length);
  }

  return trimmed;
}

function normalizeSingleFileName(value, definition) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return definition.defaultName;
  }

  if (trimmed.includes(".")) {
    return trimmed;
  }

  return `${trimmed}${definition.extension}`;
}

function normalizeFileNames(fileNames) {
  return FILE_DEFINITIONS.reduce((result, file) => {
    result[file.key] = normalizeSingleFileName(fileNames?.[file.key], file);
    return result;
  }, {});
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

function resolveFileNamesForRuleId(ruleId) {
  if (ruleId && state.fileLayout.rules[ruleId]) {
    return normalizeFileNames(state.fileLayout.rules[ruleId]);
  }

  return normalizeFileNames(state.fileLayout.draft);
}

function saveRuleFileNames(ruleId, fileNames) {
  if (!ruleId) {
    return;
  }

  state.fileLayout.rules[ruleId] = normalizeFileNames(fileNames);
}

async function persistCurrentFileNames() {
  const normalized = normalizeFileNames(state.fileNames);
  state.fileNames = normalized;

  if (state.currentRuleId) {
    saveRuleFileNames(state.currentRuleId, normalized);
  } else {
    state.fileLayout.draft = normalized;
  }

  updateFileLabels();
  await saveFileLayout();
}

async function loadFileLayout() {
  const stored = await chrome.storage.local.get(FILE_LAYOUT_STORAGE_KEY);
  return normalizeFileLayout(stored[FILE_LAYOUT_STORAGE_KEY]);
}

async function saveFileLayout() {
  await chrome.storage.local.set({
    [FILE_LAYOUT_STORAGE_KEY]: normalizeFileLayout(state.fileLayout),
  });
}

function normalizeFileLayout(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const draft = normalizeFileNames(value.draft);
  const ruleEntries =
    value.rules && typeof value.rules === "object" ? value.rules : {};

  const rules = Object.entries(ruleEntries).reduce((result, [ruleId, names]) => {
    if (typeof ruleId === "string" && ruleId.trim()) {
      result[ruleId] = normalizeFileNames(names);
    }

    return result;
  }, {});

  return {
    draft,
    rules,
  };
}

function renderScaffoldSuggestion() {
  if (elements.newScaffoldInput) {
    elements.newScaffoldInput.placeholder = "Name a new vibe pack";
  }

  if (elements.starterSuggestionButton) {
    elements.starterSuggestionButton.textContent = RED_TEXT_STARTER_LABEL;
    elements.starterSuggestionButton.classList.remove("is-hidden");
    elements.starterSuggestionButton.disabled = false;
    elements.starterSuggestionButton.title =
      "Load a CSS starter that forces all text red with !important";
    elements.starterSuggestionButton.setAttribute(
      "aria-label",
      "Load a CSS starter that forces all text red with !important",
    );
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

function formatMultilineText(value) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}
