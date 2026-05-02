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
    placeholder: "index",
  },
  {
    key: "css",
    label: "CSS",
    defaultName: "index.css",
    extension: ".css",
    placeholder: "index",
  },
  {
    key: "javascript",
    label: "JS",
    defaultName: "index.js",
    extension: ".js",
    placeholder: "index",
  },
];

const FILE_LAYOUT_STORAGE_KEY = "vibePilotFileLayout";
const STARTER_RULES = [
  {
    doneMessage: "Hello World starter applied.",
    key: "hello-world",
    pendingMessage: "Loading the Hello World starter...",
    rule: DEFAULT_WORKSPACE_RULE,
  },
  {
    doneMessage: "Red text starter applied.",
    key: "red-text",
    pendingMessage: "Loading the red text starter...",
    rule: RED_TEXT_STARTER_WORKSPACE_RULE,
  },
];
const CUSTOM_RULE_FILE_DEFAULT_PATH = "asset.txt";
const FILE_RENAME_MEASURE_CANVAS = document.createElement("canvas");
const CHAT_IMAGE_ATTACHMENT_LIMIT = 4;
const CHAT_IMAGE_MAX_EDGE = 1400;
const CHAT_IMAGE_PREVIEW_QUALITY = 0.82;
const CHAT_IMAGE_INLINE_MAX_LENGTH = 2_000_000;
const IMAGE_FILE_NAME_PATTERN = /\.(apng|avif|gif|heic|heif|jpe?g|png|svg|webp)$/i;
const EXTENSION_MESSAGE_TIMEOUT_MS = 30000;
const ASSISTANT_EXTENSION_MESSAGE_TIMEOUT_MS = 10 * 60 * 1000;
let nextRuleFileId = 0;
let nextChatImageId = 0;

const state = {
  activeFile: "html",
  activeCreateMode: "chat",
  assistantMessages: [],
  assistantProgressPort: null,
  assistantPreviousResponseId: null,
  assistantTurnInProgress: false,
  assistantTurnStartMessageId: null,
  activeTab: null,
  activeView: "create",
  chatExpanded: false,
  confirmModalResolver: null,
  currentRuleId: null,
  editingRuleSnapshot: null,
  fileLayout: createDefaultFileLayout(),
  fileNamingSession: null,
  fileNames: createDefaultFileNames(),
  hydrated: false,
  isBusy: false,
  hotReloading: false,
  pendingChatImages: [],
  ruleFiles: [],
  rules: [],
};

const elements = {
  applyDraftButton: document.querySelector("#apply-draft-button"),
  cancelButton: document.querySelector("#cancel-button"),
  chatComposer: document.querySelector(".chat-composer"),
  confirmModal: document.querySelector("#confirm-action-modal"),
  confirmModalCancel: document.querySelector("#confirm-action-modal-cancel"),
  confirmModalClose: document.querySelector("#confirm-action-modal-close"),
  confirmModalConfirm: document.querySelector("#confirm-action-modal-confirm"),
  confirmModalDescription: document.querySelector("#confirm-action-modal-description"),
  confirmModalTitle: document.querySelector("#confirm-action-modal-title"),
  createModePanels: Array.from(document.querySelectorAll("[data-create-mode-panel]")),
  createModeTabs: Array.from(document.querySelectorAll("[data-create-mode-target]")),
  chatPanel: document.querySelector(".chat-panel"),
  chatImageLightbox: document.querySelector("#chat-image-lightbox"),
  chatImageLightboxCaption: document.querySelector("#chat-image-lightbox-caption"),
  chatImageLightboxClose: document.querySelector("#chat-image-lightbox-close"),
  chatImageLightboxImage: document.querySelector("#chat-image-lightbox-image"),
  chatImageLightboxTitle: document.querySelector("#chat-image-lightbox-title"),
  chatImageInput: document.querySelector("#chat-image-input"),
  chatInput: document.querySelector("#chat-input"),
  chatAttachments: document.querySelector("#chat-attachments"),
  chatExpandButton: document.querySelector("#chat-expand-button"),
  chatMessages: document.querySelector("#chat-messages"),
  chatSendButton: document.querySelector("#chat-send-button"),
  chatUploadButton: document.querySelector("#chat-upload-button"),
  cssSnippet: document.querySelector("#css-snippet"),
  errorBanner: document.querySelector("#error-banner"),
  fileCreateButton: document.querySelector("#file-tab-create-button"),
  fileTabStrip: document.querySelector(".file-tab-strip"),
  filePanels: Array.from(document.querySelectorAll("[data-file-panel]")),
  fileRenameInputs: {
    css: document.querySelector('[data-file-rename-input="css"]'),
    html: document.querySelector('[data-file-rename-input="html"]'),
    javascript: document.querySelector('[data-file-rename-input="javascript"]'),
  },
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
  editorStack: document.querySelector(".editor-stack"),
  javascriptSnippet: document.querySelector("#javascript-snippet"),
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
  switchCreateMode(state.activeCreateMode);
  switchView("create");
  autoResizeChat();
  renderPendingChatImages();
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

  elements.createModeTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-create-mode-target");
      if (target) {
        switchCreateMode(target);
      }
    });
  });

  elements.fileTabStrip?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const createButton = target.closest("#file-tab-create-button");
    if (createButton) {
      createRuleFile();
      return;
    }

    const fileButton = target.closest("[data-file-target]");
    if (!(fileButton instanceof HTMLElement)) {
      return;
    }

    const fileKey = fileButton.getAttribute("data-file-target");
    if (!fileKey) {
      return;
    }

    if (target.closest("[data-file-tab-label]")) {
      openFileNamingSession(fileKey, "rename");
      return;
    }

    switchActiveFile(fileKey);
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

  elements.fileTabStrip?.addEventListener("keydown", (event) => {
    const renameInput = event.target instanceof Element
      ? event.target.closest("[data-file-rename-input]")
      : null;
    if (!(renameInput instanceof HTMLTextAreaElement)) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void commitFileNamingSession();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeFileNamingSession();
    }
  });

  elements.fileTabStrip?.addEventListener("input", (event) => {
    const renameInput = event.target instanceof Element
      ? event.target.closest("[data-file-rename-input]")
      : null;
    if (!(renameInput instanceof HTMLTextAreaElement)) {
      return;
    }

    const fileKey = renameInput.getAttribute("data-file-rename-input");
    if (fileKey && state.fileNamingSession?.fileKey === fileKey) {
      syncFileRenameWidth(fileKey);
    }
  });

  elements.fileTabStrip?.addEventListener("focusout", (event) => {
    const renameInput = event.target instanceof Element
      ? event.target.closest("[data-file-rename-input]")
      : null;
    if (!(renameInput instanceof HTMLTextAreaElement)) {
      return;
    }

    const fileKey = renameInput.getAttribute("data-file-rename-input");
    if (fileKey && state.fileNamingSession?.fileKey === fileKey) {
      closeFileNamingSession();
    }
  });

  elements.editorStack?.addEventListener("input", (event) => {
    const editor = event.target instanceof Element
      ? event.target.closest("[data-rule-file-editor]")
      : null;
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }

    const fileKey = editor.getAttribute("data-rule-file-editor");
    if (!fileKey) {
      return;
    }

    const ruleFile = getRuleFileByKey(fileKey);
    if (!ruleFile) {
      return;
    }

    ruleFile.content = editor.value;
    syncWorkspaceState();
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

  elements.chatInput?.addEventListener("paste", (event) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (!imageFiles.length) {
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain") ?? "";
    if (!pastedText.trim()) {
      event.preventDefault();
    }

    void addPendingChatImages(imageFiles, {
      source: "clipboard",
    });
  });

  elements.chatComposer?.addEventListener("dragover", (event) => {
    if (!hasImageDataTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  elements.chatComposer?.addEventListener("drop", (event) => {
    const imageFiles = getDataTransferImageFiles(event.dataTransfer);
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    void addPendingChatImages(imageFiles, {
      source: "drop",
    });
  });

  elements.chatSendButton?.addEventListener("click", () => {
    void sendAssistantMessage();
  });

  elements.chatExpandButton?.addEventListener("click", () => {
    if (!state.chatExpanded && state.activeCreateMode !== "chat") {
      switchCreateMode("chat");
    }

    setChatExpanded(!state.chatExpanded);
  });

  elements.chatUploadButton?.addEventListener("click", () => {
    elements.chatImageInput?.click();
  });

  elements.chatImageInput?.addEventListener("change", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const files = input?.files ? Array.from(input.files) : [];
    if (input) {
      input.value = "";
    }

    void addPendingChatImages(files, {
      source: "upload",
    });
  });

  elements.chatAttachments?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const removeButton = target.closest("[data-remove-chat-image-id]");
    if (removeButton instanceof HTMLElement) {
      const imageId = removeButton.getAttribute("data-remove-chat-image-id");
      if (imageId) {
        removePendingChatImage(imageId);
      }
      return;
    }

    const previewButton = target.closest("[data-preview-chat-image-id]");
    if (!(previewButton instanceof HTMLElement)) {
      return;
    }

    const imageId = previewButton.getAttribute("data-preview-chat-image-id");
    const image = state.pendingChatImages.find((item) => item.id === imageId);
    if (!image) {
      return;
    }

    openChatImageLightbox(image);
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

  elements.confirmModalConfirm?.addEventListener("click", () => {
    resolveConfirmModal(true);
  });

  elements.confirmModalCancel?.addEventListener("click", () => {
    resolveConfirmModal(false);
  });

  elements.confirmModalClose?.addEventListener("click", () => {
    resolveConfirmModal(false);
  });

  elements.confirmModal?.addEventListener("click", (event) => {
    if (event.target === elements.confirmModal) {
      resolveConfirmModal(false);
    }
  });

  elements.confirmModal?.addEventListener("cancel", (event) => {
    event.preventDefault();
    resolveConfirmModal(false);
  });

  elements.confirmModal?.addEventListener("close", () => {
    if (state.confirmModalResolver) {
      resolveConfirmModal(false);
    }
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
    void handleStarterSelection("red-text");
  });

  elements.loadExampleButton?.addEventListener("click", () => {
    void handleStarterSelection("hello-world");
  });

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
        const selectedRule = state.rules.find((item) => item.id === ruleId);
        const ruleName = selectedRule?.name ?? "rule";
        const shouldApply = selectedRule?.enabled !== false;

        void runAction(
          async () => {
            await openRuleEditor(ruleId, {
              applyOnOpen: shouldApply,
            });
          },
          shouldApply
            ? `Opening and applying "${ruleName}"...`
            : `Opening "${ruleName}"...`,
          shouldApply ? `"${ruleName}" applied.` : `Editing "${ruleName}".`,
        );
      }
    }
  });

  elements.rulesList?.addEventListener("change", (event) => {
    const toggle =
      event.target instanceof HTMLInputElement &&
      event.target.matches("[data-rule-toggle-id]")
        ? event.target
        : null;

    if (!toggle) {
      return;
    }

    const ruleId = toggle.getAttribute("data-rule-toggle-id");
    if (ruleId) {
      void toggleRuleEnabled(ruleId, toggle.checked);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      state.chatExpanded &&
      !document.querySelector("dialog[open]")
    ) {
      setChatExpanded(false);
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
      restoreAssistantConversation(payload.draft);
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
    return true;
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Unexpected extension error.",
    );
    return false;
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

  if (!(await confirmReplacingDraft())) {
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
  const attachments = state.pendingChatImages.map((image) => ({
    alt: image.alt,
    detail: image.detail,
    label: image.label,
    url: image.url,
  }));

  if (!prompt && !attachments.length) {
    return;
  }

  const userMessage = createAssistantMessage("user", prompt, {
    images: attachments.map((image) => ({
      alt: image.alt,
      label: image.label,
      url: image.url,
    })),
  });

  appendAssistantMessages([userMessage]);
  state.assistantTurnInProgress = true;
  state.assistantTurnStartMessageId = userMessage.id;
  clearChat();

  try {
    await runAction(
      async () => {
        await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
        const response = await sendMessage(
          "VIBE_PILOT_RUN_ASSISTANT",
          {
            attachments: attachments.map((image) => ({
              detail: image.detail,
              image_url: image.url,
            })),
            prompt,
            previousResponseId: state.assistantPreviousResponseId,
          },
          {
            timeoutMs: ASSISTANT_EXTENSION_MESSAGE_TIMEOUT_MS,
          },
        );

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

        try {
          await persistCurrentRuleConversation();
        } catch (error) {
          console.warn("Unable to persist the saved rule conversation.", error);
          setError(
            error instanceof Error
              ? `The assistant finished, but the chat could not be saved: ${error.message}`
              : "The assistant finished, but the chat could not be saved.",
          );
        }
      },
      "Vibe Pilot is working...",
      "Assistant finished.",
    );
  } finally {
    clearActiveAssistantTurn();
    renderChatMessages();
  }
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
  switchView("rules");
}

async function leaveSavedRule() {
  resetEditSession();
  setCurrentFileNames(createDefaultFileNames());
  writeWorkspaceRule(EMPTY_WORKSPACE_RULE, {
    fileNames: createDefaultFileNames(),
  });
  restoreAssistantConversation(null);
  clearChat();
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());
}

async function applyCurrentRule(options = {}) {
  const returnToRules = options.returnToRules !== false;
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
  const response = await sendMessage(
    "VIBE_PILOT_APPLY_DRAFT",
    createPersistableRule(rule),
  );

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
    restoreAssistantConversation(response.rule);
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

  if (response?.rule && returnToRules) {
    switchView("rules");
  }
}

async function sendMessage(type, payload, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : EXTENSION_MESSAGE_TIMEOUT_MS;
  let timeoutId;

  const response = await Promise.race([
    chrome.runtime.sendMessage({
      type,
      payload,
    }),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("The extension runtime did not respond in time."));
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timeoutId);
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
    enabled: getCurrentRuleEnabled(),
    matchPattern:
      elements.matchPattern?.value.trim() || DEFAULT_DRAFT.matchPattern,
    html: elements.htmlSnippet?.value ?? "",
    css: elements.cssSnippet?.value ?? "",
    javascript: elements.javascriptSnippet?.value ?? "",
    files: normalizeRuleFiles(serializeRuleFiles(state.ruleFiles)),
  };
}

function createPersistableRule(rule = readWorkspaceRule()) {
  return {
    ...createRuleSnapshot(rule),
    ...readAssistantConversationSnapshot(),
  };
}

function readAssistantConversationSnapshot() {
  return {
    chatMessages: normalizeAssistantMessages(state.assistantMessages),
    chatPreviousResponseId: normalizeAssistantResponseId(
      state.assistantPreviousResponseId,
    ),
  };
}

function normalizeAssistantResponseId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function restoreAssistantConversation(rule) {
  clearActiveAssistantTurn();
  state.assistantMessages = normalizeAssistantMessages(rule?.chatMessages);
  state.assistantPreviousResponseId = normalizeAssistantResponseId(
    rule?.chatPreviousResponseId,
  );
  renderChatMessages();
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

  state.ruleFiles = createStateRuleFiles(rule?.files);

  setCurrentFileNames(
    options.fileNames ?? resolveFileNamesForRuleId(state.currentRuleId),
  );
  ensureActiveFileIsValid();
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

function switchCreateMode(nextMode) {
  if (nextMode !== "chat" && nextMode !== "files") {
    return;
  }

  state.activeCreateMode = nextMode;

  if (nextMode !== "files" && state.fileNamingSession) {
    closeFileNamingSession();
  }

  if (nextMode !== "chat" && state.chatExpanded) {
    setChatExpanded(false);
  }

  elements.createModeTabs.forEach((button) => {
    const isActive = button.getAttribute("data-create-mode-target") === nextMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  elements.createModePanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-create-mode-panel") === nextMode;
    panel.classList.toggle("is-active", isActive);
    panel.classList.toggle("is-hidden", !isActive);
  });

  syncChatExpandButtonVisibility();
}

function switchActiveFile(nextFile, options = {}) {
  if (!isKnownFileKey(nextFile)) {
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
  updateFileLabels();
}

function openFileNamingSession(fileKey, mode, options = {}) {
  if (!isKnownFileKey(fileKey)) {
    return;
  }

  if (state.fileNamingSession && state.fileNamingSession.fileKey !== fileKey) {
    closeFileNamingSession();
  }

  const previousActiveFile = state.activeFile;

  switchActiveFile(fileKey, { preserveComposer: true });
  const renameInput = getFileRenameInput(fileKey);
  if (!renameInput) {
    return;
  }

  state.fileNamingSession = {
    fileKey,
    minimumWidth: Math.ceil(getFileTabButton(fileKey)?.getBoundingClientRect().width ?? 0),
    mode,
    returnFileKey: options.returnFileKey ?? previousActiveFile,
  };

  renameInput.placeholder = getFileRenamePlaceholder(fileKey);
  renameInput.value = getEditableFileName(fileKey);

  renderFileTabState();
  syncFileRenameWidth(fileKey);

  requestAnimationFrame(() => {
    renameInput.focus();
    renameInput.select();
  });
}

function closeFileNamingSession(options = {}) {
  const session = state.fileNamingSession;
  const activeFileKey = session?.fileKey;
  state.fileNamingSession = null;

  if (activeFileKey) {
    const renameInput = getFileRenameInput(activeFileKey);
    if (renameInput) {
      renameInput.value = "";
    }
  }

  if (
    session?.mode === "create" &&
    isCustomFileKey(session.fileKey) &&
    !options.keepCreatedFile
  ) {
    removeRuleFileByKey(session.fileKey);

    if (session.returnFileKey && isKnownFileKey(session.returnFileKey)) {
      switchActiveFile(session.returnFileKey, { preserveComposer: true });
    } else {
      switchActiveFile("html", { preserveComposer: true });
    }
  }

  renderFileTabState();
  syncWorkspaceState();
}

async function commitFileNamingSession() {
  if (!state.fileNamingSession) {
    return;
  }

  const session = state.fileNamingSession;
  const fileKey = state.fileNamingSession.fileKey;
  const definition = getFileDefinition(fileKey);
  const renameInput = getFileRenameInput(fileKey);
  if (!renameInput) {
    return;
  }

  if (definition) {
    state.fileNames[fileKey] = normalizeSingleFileName(
      renameInput.value,
      definition,
    );
  } else {
    const ruleFile = getRuleFileByKey(fileKey);
    if (!ruleFile) {
      return;
    }

    const requestedPath = String(renameInput.value ?? "").trim();
    if (!requestedPath) {
      deleteCustomRuleFile(session);
      return;
    }

    const nextPath = normalizeCustomFilePath(requestedPath);
    const hasDuplicatePath = state.ruleFiles.some(
      (candidate) =>
        candidate.id !== ruleFile.id &&
        normalizeCustomFilePath(candidate.path).toLowerCase() === nextPath.toLowerCase(),
    );
    if (hasDuplicatePath) {
      setError(`"${nextPath}" already exists. Choose a different file name.`);
      renameInput.focus();
      renameInput.select();
      return;
    }

    setError("");
    ruleFile.path = nextPath;
    ruleFile.mimeType = inferRuleFileMimeType(nextPath);
  }

  closeFileNamingSession({ keepCreatedFile: true });
  updateFileLabels();
  if (definition) {
    await persistCurrentFileNames();
  } else {
    syncWorkspaceState();
  }
}

async function loadRules() {
  const payload = await sendMessage("VIBE_PILOT_LIST_RULES");
  state.rules = Array.isArray(payload.rules)
    ? payload.rules.map((rule) => createRuleSnapshot(rule))
    : [];
  renderRulesList(state.rules);
}

async function handleStarterSelection(starterKey) {
  const starter = getStarterRule(starterKey);
  if (!starter) {
    return;
  }

  await runAction(
    async () => {
      const rule = await saveStarterRule(starterKey);
      if (!rule?.id) {
        throw new Error("The starter rule could not be opened.");
      }

      await openRuleEditor(rule.id, {
        applyOnOpen: true,
      });
    },
    starter.pendingMessage,
    starter.doneMessage,
  );
}

async function saveStarterRule(starterKey) {
  const starter = getStarterRule(starterKey);
  if (!starter) {
    throw new Error("That starter could not be found.");
  }

  const existingRule = state.rules.find((rule) =>
    normalizeStarterName(rule.name) === normalizeStarterName(starter.rule.name),
  );
  if (existingRule) {
    return existingRule;
  }

  const preservedDraft = readWorkspaceRule();
  const response = await sendMessage("VIBE_PILOT_SAVE_RULE", starter.rule);
  const savedRule = response?.rule ? createRuleSnapshot(response.rule) : null;

  if (!savedRule) {
    throw new Error("The starter could not be saved.");
  }

  upsertRule(savedRule);

  if (savedRule.id) {
    saveRuleFileNames(savedRule.id, createDefaultFileNames());
    await saveFileLayout();
  }

  await sendMessage("VIBE_PILOT_SAVE_DRAFT", preservedDraft);
  return savedRule;
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
      const isEnabled = rule.enabled !== false;
      const openLabel = isEnabled ? "Open and apply" : "Open";
      const toggleLabel = isEnabled ? "Turn off" : "Turn on";

      return `
        <article class="rule-card-shell${isEnabled ? "" : " is-rule-disabled"}">
          <button
            class="rule-card"
            type="button"
            data-edit-rule-id="${escapeHtml(rule.id)}"
            aria-label="${openLabel} ${escapeHtml(rule.name)}"
            title="${openLabel} ${escapeHtml(rule.name)}"
          >
            <strong class="rule-card-name">${escapeHtml(rule.name)}</strong>
            <p class="rule-card-meta">${escapeHtml(target)}</p>
          </button>
          <div class="rule-card-actions">
            <label
              class="rule-toggle"
              aria-label="${toggleLabel} ${escapeHtml(rule.name)}"
              title="${toggleLabel} ${escapeHtml(rule.name)}"
            >
              <input
                class="rule-toggle-input"
                type="checkbox"
                data-rule-toggle-id="${escapeHtml(rule.id)}"
                aria-label="${toggleLabel} ${escapeHtml(rule.name)}"
                ${isEnabled ? "checked" : ""}
              />
              <span class="rule-toggle-track" aria-hidden="true">
                <span class="rule-toggle-thumb"></span>
              </span>
            </label>
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
          </div>
        </article>
      `;
    })
    .join("");
}

async function toggleRuleEnabled(ruleId, enabled) {
  const rule = state.rules.find((item) => item.id === ruleId);
  const ruleName = rule?.name ?? "this rule";
  const nextStateLabel = enabled ? "on" : "off";

  const succeeded = await runAction(
    async () => {
      const response = await sendMessage("VIBE_PILOT_SET_RULE_ENABLED", {
        enabled,
        ruleId,
      });
      const updatedRule = response?.rule
        ? createRuleSnapshot(response.rule)
        : createRuleSnapshot({
            ...rule,
            enabled,
          });

      upsertRule(updatedRule);

      if (state.editingRuleSnapshot?.rule?.id === ruleId) {
        state.editingRuleSnapshot = {
          ...state.editingRuleSnapshot,
          rule: {
            ...state.editingRuleSnapshot.rule,
            enabled: updatedRule.enabled,
          },
        };
      }
    },
    `Turning "${ruleName}" ${nextStateLabel}...`,
    `"${ruleName}" turned ${nextStateLabel}.`,
  );

  if (!succeeded) {
    renderRulesList(state.rules);
  }
}

async function openRuleEditor(ruleId, options = {}) {
  const ruleSummary = state.rules.find((item) => item.id === ruleId);
  if (!ruleSummary) {
    setError("That rule could not be found.");
    return;
  }

  const detail = await sendMessage("VIBE_PILOT_GET_RULE", {
    ruleId,
  });
  const rule = detail?.rule ? createRuleSnapshot(detail.rule) : ruleSummary;
  const fileNames = resolveFileNamesForRuleId(rule.id);
  state.editingRuleSnapshot = createEditorSnapshot(rule, fileNames);
  upsertRule(rule);
  writeWorkspaceRule(rule, {
    fileNames,
  });
  restoreAssistantConversation(rule);
  switchCreateMode("files");
  switchActiveFile("html");
  clearChat();
  switchView("create");
  await persistCurrentFileNames();
  await sendMessage("VIBE_PILOT_SAVE_DRAFT", readWorkspaceRule());

  if (options.applyOnOpen) {
    await applyCurrentRule({
      returnToRules: false,
    });
    return;
  }

  setStatus(`Editing "${rule.name}".`);
}

async function deleteRuleFromList(ruleId) {
  const rule = state.rules.find((item) => item.id === ruleId);
  const ruleName = rule?.name ?? "this rule";

  const confirmed = await showConfirmModal({
    confirmLabel: "Delete rule",
    description: `This will permanently remove "${ruleName}" from your saved rules.`,
    tone: "destructive",
    title: `Delete "${ruleName}"?`,
  });

  if (!confirmed) {
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

function setChatExpanded(isExpanded) {
  if (isExpanded && state.activeCreateMode !== "chat") {
    switchCreateMode("chat");
  }

  state.chatExpanded = Boolean(isExpanded);
  document.body.classList.toggle("chat-expanded", state.chatExpanded);
  elements.chatPanel?.classList.toggle("is-expanded", state.chatExpanded);

  if (elements.chatExpandButton) {
    const label = state.chatExpanded ? "Collapse chat" : "Expand chat";
    elements.chatExpandButton.setAttribute("aria-label", label);
    elements.chatExpandButton.setAttribute(
      "aria-pressed",
      String(state.chatExpanded),
    );
    elements.chatExpandButton.title = label;
  }

  autoResizeChat();
}

function syncChatExpandButtonVisibility() {
  elements.chatExpandButton?.classList.toggle(
    "is-hidden",
    state.activeCreateMode !== "chat",
  );
}

function toggleBusy(isBusy) {
  state.isBusy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
  document.body.setAttribute("aria-busy", String(isBusy));

  const buttons = [
    elements.applyDraftButton,
    elements.cancelButton,
    elements.chatSendButton,
    elements.chatUploadButton,
    elements.fileCreateButton,
    elements.loadExampleButton,
    elements.scaffoldRuleButton,
    elements.starterSuggestionButton,
    ...elements.createModeTabs,
    ...getFileTabButtons(),
    ...getRuleListControls(),
    ...elements.viewTabs,
  ];

  buttons.forEach((button) => {
    if (button) {
      button.disabled = isBusy;
    }
  });

  [
    elements.chatImageInput,
    elements.chatInput,
    elements.cssSnippet,
    elements.htmlSnippet,
    elements.javascriptSnippet,
    elements.matchPattern,
    elements.newScaffoldInput,
    elements.ruleName,
    ...getFileRenameInputs(),
    ...getRuleFileEditors(),
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
  const canSendAssistantMessage = hasPendingAssistantComposerContent();
  const chatAttachmentLimitReached =
    state.pendingChatImages.length >= CHAT_IMAGE_ATTACHMENT_LIMIT;
  if (elements.applyDraftButton) {
    elements.applyDraftButton.disabled = state.isBusy || !applyReady;
  }

  if (elements.ruleModeLabel) {
    elements.ruleModeLabel.textContent = isEditingSavedRule()
      ? "Editing saved rule"
      : "New rule";
  }

  if (elements.chatSendButton) {
    elements.chatSendButton.disabled = state.isBusy || !canSendAssistantMessage;
  }

  if (elements.chatUploadButton) {
    elements.chatUploadButton.disabled = state.isBusy || chatAttachmentLimitReached;
    elements.chatUploadButton.title = chatAttachmentLimitReached
      ? `You can attach up to ${CHAT_IMAGE_ATTACHMENT_LIMIT} images per message.`
      : "Add an image from your computer";
  }

  if (elements.chatImageInput) {
    elements.chatImageInput.disabled = state.isBusy || chatAttachmentLimitReached;
  }
}

function clearChat() {
  if (elements.chatInput) {
    elements.chatInput.value = "";
  }
  clearPendingChatImages();
  autoResizeChat();
}

function clearActiveAssistantTurn() {
  state.assistantTurnInProgress = false;
  state.assistantTurnStartMessageId = null;
}

function hasPendingAssistantComposerContent() {
  return Boolean(
    state.pendingChatImages.length || (elements.chatInput?.value.trim() ?? ""),
  );
}

function clearPendingChatImages() {
  if (!state.pendingChatImages.length && !elements.chatImageInput?.value) {
    return;
  }

  state.pendingChatImages = [];
  if (elements.chatImageInput) {
    elements.chatImageInput.value = "";
  }
  renderPendingChatImages();
}

function removePendingChatImage(imageId) {
  const nextImages = state.pendingChatImages.filter((image) => image.id !== imageId);
  if (nextImages.length === state.pendingChatImages.length) {
    return;
  }

  state.pendingChatImages = nextImages;
  renderPendingChatImages();
}

function renderPendingChatImages() {
  if (!elements.chatAttachments) {
    return;
  }

  if (!state.pendingChatImages.length) {
    elements.chatAttachments.classList.add("is-hidden");
    elements.chatAttachments.innerHTML = "";
    syncWorkspaceState();
    return;
  }

  elements.chatAttachments.classList.remove("is-hidden");
  elements.chatAttachments.innerHTML = state.pendingChatImages
    .map((image) => `
      <div class="chat-composer-attachment">
        <div class="chat-composer-chip">
          <button
            class="chat-composer-chip-preview"
            type="button"
            data-preview-chat-image-id="${escapeHtml(image.id)}"
            aria-label="Preview ${escapeHtml(image.label)}"
            title="Preview ${escapeHtml(image.label)}"
          >
            <span class="chat-composer-chip-thumb">
              <img
                class="chat-composer-chip-image"
                src="${escapeHtml(image.url)}"
                alt="${escapeHtml(image.alt)}"
              />
            </span>
            <span class="chat-composer-chip-label">${escapeHtml(image.label)}</span>
          </button>
          <button
            class="icon-button chat-composer-chip-remove"
            type="button"
            data-remove-chat-image-id="${escapeHtml(image.id)}"
            aria-label="Remove ${escapeHtml(image.label)}"
            title="Remove ${escapeHtml(image.label)}"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.4"
              />
            </svg>
          </button>
        </div>
      </div>
    `)
    .join("");
  syncWorkspaceState();
}

async function addPendingChatImages(files, options = {}) {
  const imageFiles = files.filter((file) => isSupportedChatImageFile(file));
  if (!imageFiles.length) {
    if (files.length) {
      setError("Only image files can be attached in chat.");
    }
    return;
  }

  const remainingSlots = CHAT_IMAGE_ATTACHMENT_LIMIT - state.pendingChatImages.length;
  if (remainingSlots <= 0) {
    setError(`You can attach up to ${CHAT_IMAGE_ATTACHMENT_LIMIT} images per message.`);
    return;
  }

  const selectedFiles = imageFiles.slice(0, remainingSlots);
  if (selectedFiles.length < imageFiles.length) {
    setError(`Only the first ${CHAT_IMAGE_ATTACHMENT_LIMIT} images were kept for this message.`);
  } else {
    setError("");
  }

  try {
    const attachments = await Promise.all(
      selectedFiles.map((file, index) =>
        createPendingChatImage(file, {
          index,
          source: options.source,
        }),
      ),
    );
    state.pendingChatImages = [...state.pendingChatImages, ...attachments];
    renderPendingChatImages();
  } catch (error) {
    setError(
      error instanceof Error
        ? error.message
        : "That image could not be attached to the chat.",
    );
  }
}

async function createPendingChatImage(file, options = {}) {
  const sourceLabel =
    typeof file.name === "string" && file.name.trim()
      ? file.name.trim()
      : options.source === "clipboard"
        ? `Pasted screenshot ${options.index + 1}`
        : options.source === "drop"
          ? `Dropped screenshot ${options.index + 1}`
        : `Image ${options.index + 1}`;
  const dataUrl = await readBlobAsDataUrl(file);
  const optimizedDataUrl = await optimizeChatImageDataUrl(dataUrl);

  nextChatImageId += 1;

  return {
    alt: sourceLabel,
    detail: "auto",
    id: `chat-image-${nextChatImageId}`,
    label: sourceLabel,
    url: optimizedDataUrl,
  };
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("The selected image could not be read."));
    };
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(blob);
  });
}

async function optimizeChatImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }

  try {
    const image = await loadImageElement(dataUrl);
    const scale = Math.min(
      1,
      CHAT_IMAGE_MAX_EDGE / Math.max(1, image.naturalWidth),
      CHAT_IMAGE_MAX_EDGE / Math.max(1, image.naturalHeight),
    );

    if (scale === 1 && dataUrl.length <= CHAT_IMAGE_INLINE_MAX_LENGTH) {
      return dataUrl;
    }

    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return dataUrl;
    }

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", CHAT_IMAGE_PREVIEW_QUALITY);
  } catch (error) {
    console.warn("Unable to optimize an uploaded chat image.", error);
    return dataUrl;
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error("The selected image could not be decoded."));
    };
    image.src = src;
  });
}

function getClipboardImageFiles(clipboardData) {
  if (!clipboardData?.items?.length) {
    return [];
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file) => file instanceof File && isSupportedChatImageFile(file));
}

function hasImageDataTransfer(dataTransfer) {
  return getDataTransferImageFiles(dataTransfer).length > 0;
}

function getDataTransferImageFiles(dataTransfer) {
  const fileList = Array.isArray(dataTransfer?.files)
    ? dataTransfer.files
    : Array.from(dataTransfer?.files ?? []);
  const directFiles = fileList.filter((file) => isSupportedChatImageFile(file));
  const itemFiles = Array.from(dataTransfer?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file) => file instanceof File && isSupportedChatImageFile(file));

  const deduped = new Map();
  [...directFiles, ...itemFiles].forEach((file) => {
    const key = [
      file.name,
      file.size,
      file.type,
      file.lastModified,
    ].join(":");
    if (!deduped.has(key)) {
      deduped.set(key, file);
    }
  });

  return Array.from(deduped.values());
}

function isSupportedChatImageFile(file) {
  if (!(file instanceof File)) {
    return false;
  }

  if (typeof file.type === "string" && file.type.startsWith("image/")) {
    return true;
  }

  return (
    typeof file.name === "string" &&
    IMAGE_FILE_NAME_PATTERN.test(file.name.trim())
  );
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
  if (!Array.isArray(messages)) {
    return [];
  }

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
    elements.chatMessages.innerHTML = "";
    syncWorkspaceState();
    return;
  }

  elements.chatMessages.innerHTML = partitionTranscriptTurns(state.assistantMessages)
    .map((turn) => renderTranscriptTurn(turn))
    .join("");
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  syncWorkspaceState();
}

function partitionTranscriptTurns(messages) {
  const turns = [];
  let currentTurn = null;

  const flushTurn = () => {
    if (!currentTurn?.messages.length) {
      return;
    }

    turns.push(currentTurn);
    currentTurn = null;
  };

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn();
      currentTurn = {
        messages: [message],
        startMessageId: message.id,
        type: "turn",
      };
      continue;
    }

    if (!currentTurn) {
      currentTurn = {
        messages: [message],
        startMessageId: null,
        type: "loose",
      };
      continue;
    }

    currentTurn.messages.push(message);
  }

  flushTurn();
  return turns;
}

function renderTranscriptTurn(turn) {
  const isActiveTurn = Boolean(
    state.assistantTurnInProgress &&
    state.assistantTurnStartMessageId &&
    turn.type === "turn" &&
    turn.startMessageId === state.assistantTurnStartMessageId,
  );

  if (isActiveTurn) {
    return renderMessageSequence(turn.messages, {
      compactToolCalls: false,
    });
  }

  if (turn.type !== "turn") {
    return renderMessageSequence(turn.messages);
  }

  return renderCompletedTranscriptTurn(turn.messages);
}

function renderCompletedTranscriptTurn(messages) {
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const toolMessages = messages.filter((message) => message.role === "tool");
  const finalAssistantMessage = buildCompletedAssistantMessage(
    assistantMessages,
    toolMessages,
  );
  const parts = userMessages.map((message) => renderChatMessage(message));

  if (finalAssistantMessage) {
    parts.push(
      toolMessages.length > 0
        ? renderAssistantTurn(finalAssistantMessage, toolMessages)
        : renderChatMessage(finalAssistantMessage),
    );
    return parts.join("");
  }

  if (toolMessages.length > 0) {
    parts.push(renderToolThread(toolMessages));
  }

  return parts.join("");
}

function renderMessageSequence(messages, options = {}) {
  return groupAssistantMessages(messages, options)
    .map((block) => renderTranscriptBlock(block))
    .join("");
}

function groupAssistantMessages(messages, options = {}) {
  const compactToolCalls = options.compactToolCalls !== false;

  if (!compactToolCalls) {
    return messages.map((message) => ({
      message,
      type: "message",
    }));
  }

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

    if (toolMessages.length && message.role === "assistant") {
      blocks.push({
        message,
        toolMessages,
        type: "assistant-turn",
      });
      toolMessages = [];
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
    return renderToolThread(block.messages);
  }

  if (block.type === "assistant-turn") {
    return renderAssistantTurn(block.message, block.toolMessages);
  }

  if (block.message?.role === "tool") {
    return renderLiveToolMessage(block.message);
  }

  return renderChatMessage(block.message);
}

function renderAssistantTurn(message, toolMessages) {
  const verificationMessages = collectVerificationMessages(toolMessages);
  const hiddenVerificationIds = new Set(
    verificationMessages.map((toolMessage) => toolMessage.id),
  );
  const collapsedToolMessages = toolMessages.filter(
    (toolMessage) => !hiddenVerificationIds.has(toolMessage.id),
  );
  const verificationMarkup = renderVerificationMessages(verificationMessages);
  const toolMarkup =
    collapsedToolMessages.length > 0
      ? renderToolGroup(collapsedToolMessages, {
          nested: true,
        })
      : "";

  return `
    ${renderChatMessage(message, {
        toolMarkup: `${verificationMarkup}${toolMarkup}`,
      })}
  `;
}

function renderChatMessage(message, options = {}) {
  const metaPills = [];

  if (message.role === "assistant" && message.status === "streaming") {
    metaPills.push('<span class="chat-meta-pill chat-meta-pill-running">Streaming</span>');
  }

  if (message.role === "tool") {
    metaPills.push(...renderToolMetaPills(message));
  }

  const useCompactImages = Boolean(options.compactImages || message.role === "user");
  const imagesMarkup = Array.isArray(message.images) && message.images.length > 0
    ? renderImageCards(message.images, {
        compact: useCompactImages,
      })
    : "";
  const messageRole = message.role === "user" ? "user" : "assistant";
  const toolMarkup = typeof options.toolMarkup === "string" ? options.toolMarkup : "";
  const argumentsMarkup =
    message.role === "tool" ? renderToolArguments(message.toolArgumentsText) : "";
  const metaMarkup =
    metaPills.length > 0
      ? `<div class="chat-message-meta">${metaPills.join("")}</div>`
      : "";

  return `
    <section class="chat-row chat-row-${messageRole}">
      <article class="chat-message chat-message-${escapeHtml(message.role)}">
        ${metaMarkup}
        ${message.text ? `<p class="chat-message-text">${formatMultilineText(message.text)}</p>` : ""}
        ${imagesMarkup ? `<div class="chat-image-grid${
          useCompactImages ? " chat-image-grid-compact" : ""
        }">${imagesMarkup}</div>` : ""}
        ${argumentsMarkup}
        ${toolMarkup}
      </article>
    </section>
  `;
}

function renderLiveToolMessage(message) {
  return `
    <section class="chat-row chat-row-assistant chat-row-tool">
      ${renderToolCall(message, null, {
        standalone: true,
      })}
    </section>
  `;
}

function renderToolGroup(messages, options = {}) {
  const hasError = messages.some((message) => message.status === "error");
  const hasRunning = messages.some((message) => message.status === "running");
  const screenshotCount = messages.reduce(
    (count, message) => count + message.images.length,
    0,
  );
  const shouldAutoOpen = options.autoOpen === true;
  const summaryCopy = [
    `${messages.length} command${messages.length === 1 ? "" : "s"}`,
    screenshotCount
      ? `${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"}`
      : "no screenshots",
    screenshotCount ? "click any screenshot to expand" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const callMarkup = messages
    .map((message, index) =>
      renderToolCall(message, index, {
        hiddenImageUrls: options.hiddenImageUrls,
      }),
    )
    .join("");

  return `
    <details class="chat-tool-group${hasError ? " is-error" : ""}${
      options.nested ? " chat-tool-group-nested" : ""
    }" ${
      shouldAutoOpen ? "open" : ""
    }>
      <summary class="chat-tool-summary">
        <span class="chat-tool-summary-title">See Toolcalls</span>
        <span class="chat-tool-summary-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path
              d="M4.25 6.25 8 10l3.75-3.75"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.4"
            />
          </svg>
        </span>
      </summary>
      <div class="chat-toolcall-list">
        <p class="chat-tool-summary-copy">${escapeHtml(summaryCopy)}</p>
        ${callMarkup}
      </div>
    </details>
  `;
}

function renderToolThread(messages) {
  return `
    <section class="chat-row chat-row-assistant">
      <article class="chat-message chat-message-assistant">
        ${renderToolGroup(messages, {
          nested: true,
        })}
      </article>
    </section>
  `;
}

function renderToolCall(message, index, options = {}) {
  const toolLabel = formatToolLabel(message.toolName) || "Tool";
  const argumentsMarkup = renderToolArguments(message.toolArgumentsText);
  const imagesToRender = Array.isArray(message.images)
    ? message.images.filter((image) =>
        !(options.hiddenImageUrls instanceof Set && options.hiddenImageUrls.has(image.url))
      )
    : [];
  const imagesMarkup = imagesToRender.length > 0 ? renderImageCards(imagesToRender) : "";
  const metaPills = renderToolMetaPills(message);
  const showIndex = Number.isInteger(index) && index >= 0;

  return `
    <article class="chat-toolcall${message.status === "error" ? " is-error" : ""}${
      options.standalone ? " chat-toolcall-standalone" : ""
    }">
      <div class="chat-toolcall-header">
        <div class="chat-toolcall-title-row">
          ${
            showIndex
              ? `<span class="chat-toolcall-index">${index + 1}</span>`
              : ""
          }
          <strong class="chat-toolcall-name">${escapeHtml(toolLabel)}</strong>
        </div>
        ${metaPills.join("")}
      </div>
      ${imagesMarkup ? `<div class="chat-image-grid">${imagesMarkup}</div>` : ""}
      ${message.text ? `<p class="chat-toolcall-text">${formatMultilineText(message.text)}</p>` : ""}
      ${argumentsMarkup}
    </article>
  `;
}

function renderVerificationMessages(messages) {
  const verificationMessages = Array.isArray(messages) ? messages : [];

  if (!verificationMessages.length) {
    return "";
  }

  return `
    <div class="chat-verification-list">
      ${verificationMessages.map((message) => renderVerificationMessage(message)).join("")}
    </div>
  `;
}

function renderVerificationMessage(message) {
  const images = Array.isArray(message.images) ? message.images : [];
  const imagesMarkup = images.length > 0 ? renderImageCards(images) : "";
  const metaPills = renderToolMetaPills(message);

  return `
    <section class="chat-verification${message.status === "error" ? " is-error" : ""}">
      <div class="chat-toolcall-header">
        <strong class="chat-toolcall-name">Screenshot</strong>
        ${metaPills.join("")}
      </div>
      ${message.text ? `<p class="chat-toolcall-text">${formatMultilineText(message.text)}</p>` : ""}
      ${imagesMarkup ? `<div class="chat-image-grid">${imagesMarkup}</div>` : ""}
    </section>
  `;
}

function renderToolMetaPills(message) {
  const metaPills = [];

  if (message.images.length > 0) {
    metaPills.push('<span class="chat-meta-pill chat-meta-pill-verified">Screenshot</span>');
  }

  if (message.status === "error") {
    metaPills.push('<span class="chat-meta-pill chat-meta-pill-error">Error</span>');
  } else if (message.status === "running") {
    metaPills.push('<span class="chat-meta-pill chat-meta-pill-running">Running</span>');
  }

  return metaPills;
}

function renderToolArguments(argumentsText) {
  if (
    typeof argumentsText !== "string" ||
    !argumentsText.trim() ||
    argumentsText.trim() === "{}"
  ) {
    return "";
  }

  return `
    <details class="chat-toolcall-disclosure">
      <summary class="chat-toolcall-disclosure-summary">Input</summary>
      <pre class="chat-toolcall-args">${escapeHtml(formatToolArguments(argumentsText))}</pre>
    </details>
  `;
}

function collectToolImages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return [];
  }

  return messages.flatMap((message) =>
    Array.isArray(message.images)
      ? message.images.filter((image) => typeof image?.url === "string" && image.url.trim())
      : [],
  );
}

function collectVerificationMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return [];
  }

  return messages.filter(
    (message) =>
      message?.toolName === "take_screenshot" &&
      message?.status !== "running" &&
      Array.isArray(message.images) &&
      message.images.some((image) => typeof image?.url === "string" && image.url.trim()),
  );
}

function buildCompletedAssistantMessage(assistantMessages, toolMessages) {
  if (Array.isArray(assistantMessages) && assistantMessages.length > 0) {
    const textFirstMessages = assistantMessages.filter((message) =>
      typeof message?.text === "string" && message.text.trim(),
    );
    const chosenMessage =
      textFirstMessages.length > 0
        ? textFirstMessages[textFirstMessages.length - 1]
        : assistantMessages[assistantMessages.length - 1];

    return chosenMessage.status === "streaming"
      ? {
          ...chosenMessage,
          status: "ok",
        }
      : chosenMessage;
  }

  if (!Array.isArray(toolMessages) || !toolMessages.length) {
    return null;
  }

  const verificationMessages = collectVerificationMessages(toolMessages);
  const hasErrors = toolMessages.some((message) => message.status === "error");

  return createAssistantMessage(
    "assistant",
    verificationMessages.length > 0
      ? "Completed the request and attached the verification screenshot."
      : "Completed the request. See the toolcalls below for details.",
    {
      status: hasErrors ? "error" : "ok",
    },
  );
}

function renderImageCards(images, options = {}) {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return images
    .map((image) => {
      const label = image.label || image.alt || "Screenshot";
      const compactClass = options.compact ? " chat-image-card-compact" : "";
      const frameClass = options.compact ? " chat-image-frame-compact" : "";
      const imageClass = options.compact ? " chat-image-compact" : "";

      return `
        <figure class="chat-image-card${compactClass}">
          <button
            class="chat-image-button"
            type="button"
            data-chat-image-button
            data-image-url="${escapeHtml(image.url)}"
            data-image-alt="${escapeHtml(image.alt)}"
            data-image-label="${escapeHtml(label)}"
          >
            <span class="chat-image-frame${frameClass}">
              <img class="chat-image${imageClass}" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" />
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

function showPopupModal(dialog, options = {}) {
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }

  dialog.__returnFocusTarget =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      dialog.showModal();
    }
  } else {
    dialog.setAttribute("open", "open");
  }

  if (options.initialFocus instanceof HTMLElement) {
    window.requestAnimationFrame(() => {
      options.initialFocus.focus({
        preventScroll: true,
      });
    });
  }
}

function hidePopupModal(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }

  const returnFocusTarget =
    dialog.__returnFocusTarget instanceof HTMLElement ? dialog.__returnFocusTarget : null;
  dialog.__returnFocusTarget = null;

  if (typeof dialog.close === "function") {
    if (dialog.open) {
      dialog.close();
    }
  } else {
    dialog.removeAttribute("open");
  }

  if (returnFocusTarget?.isConnected) {
    window.requestAnimationFrame(() => {
      returnFocusTarget.focus({
        preventScroll: true,
      });
    });
  }
}

function showConfirmModal({
  cancelLabel = "Cancel",
  confirmLabel = "Continue",
  description = "",
  title = "Are you sure?",
  tone = "default",
} = {}) {
  if (!elements.confirmModal || !elements.confirmModalConfirm) {
    return Promise.resolve(false);
  }

  if (state.confirmModalResolver) {
    resolveConfirmModal(false);
  }

  if (elements.confirmModalTitle) {
    elements.confirmModalTitle.textContent = title;
  }

  if (elements.confirmModalDescription) {
    elements.confirmModalDescription.textContent = description;
  }

  if (elements.confirmModalCancel) {
    elements.confirmModalCancel.textContent = cancelLabel;
  }

  elements.confirmModalConfirm.textContent = confirmLabel;
  elements.confirmModalConfirm.dataset.tone = tone;

  showPopupModal(elements.confirmModal, {
    initialFocus: elements.confirmModalConfirm,
  });

  return new Promise((resolve) => {
    state.confirmModalResolver = resolve;
  });
}

function resolveConfirmModal(confirmed) {
  if (!state.confirmModalResolver) {
    hidePopupModal(elements.confirmModal);
    return;
  }

  const resolve = state.confirmModalResolver;
  state.confirmModalResolver = null;
  hidePopupModal(elements.confirmModal);
  resolve(Boolean(confirmed));
}

function openChatImageLightbox(image) {
  if (!elements.chatImageLightbox || !elements.chatImageLightboxImage) {
    return;
  }

  elements.chatImageLightboxImage.src = image.url;
  elements.chatImageLightboxImage.alt = image.alt || "Expanded screenshot";

  if (elements.chatImageLightboxTitle) {
    elements.chatImageLightboxTitle.textContent =
      image.label || image.alt || "Expanded preview";
  }

  if (elements.chatImageLightboxCaption) {
    elements.chatImageLightboxCaption.textContent =
      image.label || image.alt || "Screenshot";
  }

  showPopupModal(elements.chatImageLightbox, {
    initialFocus: elements.chatImageLightboxClose,
  });
}

function closeChatImageLightbox() {
  hidePopupModal(elements.chatImageLightbox);

  if (elements.chatImageLightboxImage) {
    elements.chatImageLightboxImage.removeAttribute("src");
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

function formatToolArguments(argumentsText) {
  if (typeof argumentsText !== "string" || !argumentsText.trim()) {
    return "";
  }

  try {
    return JSON.stringify(JSON.parse(argumentsText), null, 2);
  } catch {
    return argumentsText.trim();
  }
}

async function syncDraftFromAssistant(rule) {
  const nextRule = {
    ...createRuleSnapshot(rule),
    ...readAssistantConversationSnapshot(),
  };
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
      state.pendingChatImages.length > 0 ||
      (elements.chatInput?.value.trim() ?? ""),
  );
}

async function confirmReplacingDraft() {
  if (!hasWorkInProgressDraft()) {
    return true;
  }

  return showConfirmModal({
    confirmLabel: "Replace draft",
    description:
      "This will clear the current draft in the editor and start a fresh scaffold instead.",
    title: "Replace your current draft?",
  });
}

async function loadFreshWorkspace(rule) {
  const defaultFileNames = createDefaultFileNames();

  state.currentRuleId = null;
  resetEditSession();
  setCurrentFileNames(defaultFileNames);
  writeWorkspaceRule(rule, {
    fileNames: defaultFileNames,
  });
  restoreAssistantConversation(null);
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
    enabled: rule?.enabled !== false,
    matchPattern:
      typeof rule?.matchPattern === "string" && rule.matchPattern.trim()
        ? rule.matchPattern.trim()
        : DEFAULT_DRAFT.matchPattern,
    html: typeof rule?.html === "string" ? rule.html : "",
    css: typeof rule?.css === "string" ? rule.css : "",
    javascript: typeof rule?.javascript === "string" ? rule.javascript : "",
    files: normalizeRuleFiles(rule?.files),
    chatMessages: normalizeAssistantMessages(rule?.chatMessages),
    chatPreviousResponseId: normalizeAssistantResponseId(
      rule?.chatPreviousResponseId,
    ),
  };
}

function getCurrentRuleEnabled() {
  if (!state.currentRuleId) {
    return true;
  }

  const listedRule = state.rules.find((rule) => rule.id === state.currentRuleId);
  if (listedRule) {
    return listedRule.enabled !== false;
  }

  return state.editingRuleSnapshot?.rule?.enabled !== false;
}

async function persistCurrentRuleConversation() {
  if (!state.currentRuleId) {
    return;
  }

  const rule = readWorkspaceRule();
  if (!rule.name) {
    return;
  }

  const currentFileNames = normalizeFileNames(state.fileNames);
  const response = await sendMessage(
    "VIBE_PILOT_SAVE_RULE",
    createPersistableRule(rule),
  );

  if (!response?.rule) {
    return;
  }

  const savedRule = createRuleSnapshot(response.rule);
  upsertRule(savedRule);
  state.editingRuleSnapshot = createEditorSnapshot(savedRule, currentFileNames);
  restoreAssistantConversation(savedRule);
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
  renderRuleFiles();

  FILE_DEFINITIONS.forEach((file) => {
    const tabDisplayName = getTabDisplayFileName(file.key);
    const tabLabel = getFileTabLabel(file.key);
    const panelLabel = getFilePanelLabel(file.key);
    const tabButton = getFileTabButton(file.key);
    const actualFileName = state.fileNames[file.key] ?? file.defaultName;

    if (tabLabel) {
      tabLabel.textContent = tabDisplayName;
    }

    if (panelLabel) {
      panelLabel.textContent = getEditorFileMarker(file.key);
    }

    if (tabButton) {
      tabButton.title = `${file.label} slot · ${actualFileName}`;
    }
  });

  state.ruleFiles.forEach((file) => {
    const fileKey = getRuleFileKey(file.id);
    const tabLabel = getFileTabLabel(fileKey);
    const panelLabel = getFilePanelLabel(fileKey);
    const tabButton = getFileTabButton(fileKey);
    const displayName = getDisplayFileName(fileKey);

    if (tabLabel) {
      tabLabel.textContent = getTabDisplayFileName(fileKey);
    }

    if (panelLabel) {
      panelLabel.textContent = getEditorFileMarker(fileKey);
    }

    if (tabButton) {
      tabButton.title = `Generated file · ${displayName}`;
    }
  });

  renderFileTabState();
}

function getDisplayFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (definition) {
    return formatVisibleFileName(
      normalizeSingleFileName(state.fileNames[fileKey], definition),
    );
  }

  const ruleFile = getRuleFileByKey(fileKey);
  return ruleFile ? formatVisibleFileName(ruleFile.path) : "";
}

function getTabDisplayFileName(fileKey) {
  return abbreviateTabLabel(getDisplayFileName(fileKey));
}

function getEditorFileMarker(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (definition) {
    return `<${formatVisibleFileName(definition.defaultName)}>`;
  }

  const ruleFile = getRuleFileByKey(fileKey);
  return ruleFile ? `<${getRuleFileTypeLabel(ruleFile.path)}>` : "";
}

function renderFileTabState() {
  getFileTabButtons().forEach((button) => {
    const isActive = button.getAttribute("data-file-target") === state.activeFile;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  getFilePanels().forEach((panel) => {
    const isActive = panel.getAttribute("data-file-panel") === state.activeFile;
    panel.classList.toggle("is-active", isActive);
  });

  getFileTabShells().forEach((shell) => {
    const fileKey = shell.getAttribute("data-file-shell");
    const isActive = fileKey === state.activeFile;
    const isEditing = fileKey === state.fileNamingSession?.fileKey;
    const isNamed = !isDefaultFileName(fileKey);

    shell.classList.toggle("is-active", isActive);
    shell.classList.toggle("is-editing", isEditing);
    shell.classList.toggle("is-named", isNamed);

    const renameInput = fileKey ? getFileRenameInput(fileKey) : null;
    if (renameInput) {
      renameInput.classList.toggle("is-hidden", !isEditing);
    }

    if (fileKey && isEditing) {
      syncFileRenameWidth(fileKey);
    } else {
      shell.style.removeProperty("width");
    }
  });

  if (elements.fileCreateButton) {
    elements.fileCreateButton.disabled = state.isBusy;
    elements.fileCreateButton.title = "Add another generated file";
    elements.fileCreateButton.setAttribute(
      "aria-label",
      "Add another generated file",
    );
  }
}

function getFileRenameInput(fileKey) {
  return (
    elements.fileRenameInputs[fileKey] ??
    queryByDataValue(elements.fileTabStrip, "data-file-rename-input", fileKey)
  );
}

function getFileTabShell(fileKey) {
  return (
    getFileTabShells().find((shell) => shell.getAttribute("data-file-shell") === fileKey) ??
    null
  );
}

function getFileTabButton(fileKey) {
  return (
    getFileTabButtons().find((button) => button.getAttribute("data-file-target") === fileKey) ??
    null
  );
}

function getFileTabLabel(fileKey) {
  return (
    elements.fileTabLabels[fileKey] ??
    queryByDataValue(elements.fileTabStrip, "data-file-tab-label", fileKey)
  );
}

function getFilePanelLabel(fileKey) {
  return (
    elements.filePanelLabels[fileKey] ??
    queryByDataValue(elements.editorStack, "data-file-panel-label", fileKey)
  );
}

function getFilePanels() {
  return Array.from(elements.editorStack?.querySelectorAll("[data-file-panel]") ?? []);
}

function getFileTabButtons() {
  return Array.from(elements.fileTabStrip?.querySelectorAll("[data-file-target]") ?? []);
}

function getRuleListControls() {
  return Array.from(
    elements.rulesList?.querySelectorAll("button, input") ?? [],
  );
}

function getFileTabShells() {
  return Array.from(elements.fileTabStrip?.querySelectorAll("[data-file-shell]") ?? []);
}

function getFileRenameInputs() {
  return Array.from(elements.fileTabStrip?.querySelectorAll("[data-file-rename-input]") ?? []);
}

function getRuleFileEditors() {
  return Array.from(elements.editorStack?.querySelectorAll("[data-rule-file-editor]") ?? []);
}

function syncFileRenameWidth(fileKey) {
  const shell = getFileTabShell(fileKey);
  const renameInput = getFileRenameInput(fileKey);
  if (!shell || !renameInput) {
    return;
  }

  const minimumWidth =
    state.fileNamingSession?.fileKey === fileKey ? state.fileNamingSession.minimumWidth ?? 0 : 0;
  const renameWidth = measureFileRenameWidth(renameInput);
  shell.style.width = `${Math.max(minimumWidth, renameWidth)}px`;
}

function measureFileRenameWidth(renameInput) {
  const computedStyle = window.getComputedStyle(renameInput);
  const font = computedStyle.font || [
    computedStyle.fontStyle,
    computedStyle.fontVariant,
    computedStyle.fontWeight,
    computedStyle.fontStretch,
    computedStyle.fontSize,
    computedStyle.fontFamily,
  ]
    .filter(Boolean)
    .join(" ");
  const measureContext = FILE_RENAME_MEASURE_CANVAS.getContext("2d");
  const text = renameInput.value || renameInput.placeholder || "";
  const horizontalPadding =
    (Number.parseFloat(computedStyle.paddingLeft) || 0) +
    (Number.parseFloat(computedStyle.paddingRight) || 0) +
    (Number.parseFloat(computedStyle.borderLeftWidth) || 0) +
    (Number.parseFloat(computedStyle.borderRightWidth) || 0);
  const letterSpacing = Number.parseFloat(computedStyle.letterSpacing) || 0;

  if (!measureContext) {
    return Math.ceil(renameInput.scrollWidth + 8);
  }

  measureContext.font = font;

  const measuredTextWidth =
    measureContext.measureText(text).width +
    Math.max(0, text.length - 1) * letterSpacing;

  return Math.ceil(measuredTextWidth + horizontalPadding + 8);
}

function isDefaultFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (!definition) {
    const ruleFile = getRuleFileByKey(fileKey);
    return !ruleFile || normalizeCustomFilePath(ruleFile.path) === CUSTOM_RULE_FILE_DEFAULT_PATH;
  }

  return (
    normalizeSingleFileName(state.fileNames[fileKey], definition) ===
    definition.defaultName
  );
}

function getEditableFileName(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (definition) {
    return stripKnownExtension(state.fileNames[fileKey] ?? definition.defaultName, definition);
  }

  const ruleFile = getRuleFileByKey(fileKey);
  return ruleFile ? normalizeCustomFilePath(ruleFile.path) : "";
}

function stripKnownExtension(value, definition) {
  const trimmed = String(value ?? "").trim();
  const normalizedExtension = definition.extension.toLowerCase();

  if (trimmed.toLowerCase().endsWith(normalizedExtension)) {
    return trimmed.slice(0, -definition.extension.length);
  }

  return trimmed;
}

function formatVisibleFileName(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().startsWith("index.")) {
    return trimmed.slice("index.".length);
  }

  return trimmed;
}

function abbreviateTabLabel(value, maxLength = 9) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(1, maxLength - 2))}..`;
}

function normalizeSingleFileName(value, definition) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return definition.defaultName;
  }

  if (trimmed.toLowerCase().endsWith(definition.extension.toLowerCase())) {
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

function createStateRuleFiles(value) {
  return normalizeRuleFiles(value).map((file) => ({
    content: file.content,
    id: createRuleFileId(),
    mimeType: file.mimeType || inferRuleFileMimeType(file.path),
    path: file.path,
  }));
}

function serializeRuleFiles(ruleFiles) {
  if (!Array.isArray(ruleFiles)) {
    return [];
  }

  return ruleFiles.map((file) => ({
    content: typeof file?.content === "string" ? file.content : "",
    mimeType: typeof file?.mimeType === "string" ? file.mimeType : "",
    path: normalizeCustomFilePath(file?.path),
  }));
}

function createRuleFileId() {
  nextRuleFileId += 1;
  return `rule-file-${nextRuleFileId}`;
}

function createRuleFile() {
  if (state.fileNamingSession) {
    closeFileNamingSession();
  }

  const ruleFile = {
    content: "",
    id: createRuleFileId(),
    mimeType: inferRuleFileMimeType(CUSTOM_RULE_FILE_DEFAULT_PATH),
    path: CUSTOM_RULE_FILE_DEFAULT_PATH,
  };

  state.ruleFiles.push(ruleFile);
  updateFileLabels();
  openFileNamingSession(getRuleFileKey(ruleFile.id), "create", {
    returnFileKey: state.activeFile,
  });
  syncWorkspaceState();
}

function getRuleFileKey(ruleFileId) {
  return `file:${ruleFileId}`;
}

function isCustomFileKey(fileKey) {
  return typeof fileKey === "string" && fileKey.startsWith("file:");
}

function getRuleFileIdFromKey(fileKey) {
  return isCustomFileKey(fileKey) ? fileKey.slice("file:".length) : "";
}

function getRuleFileByKey(fileKey) {
  return state.ruleFiles.find((file) => file.id === getRuleFileIdFromKey(fileKey)) ?? null;
}

function removeRuleFileByKey(fileKey) {
  const ruleFileId = getRuleFileIdFromKey(fileKey);
  if (!ruleFileId) {
    return;
  }

  state.ruleFiles = state.ruleFiles.filter((file) => file.id !== ruleFileId);
  updateFileLabels();
}

function deleteCustomRuleFile(session) {
  const fileKey = session?.fileKey;
  if (!fileKey || !isCustomFileKey(fileKey)) {
    return;
  }

  setError("");
  removeRuleFileByKey(fileKey);
  state.fileNamingSession = null;

  const nextFileKey = getReplacementFileKey(fileKey, session.returnFileKey);
  switchActiveFile(nextFileKey, { preserveComposer: true });
  renderFileTabState();
  syncWorkspaceState();
}

function isKnownFileKey(fileKey) {
  return Boolean(getFileDefinition(fileKey) || getRuleFileByKey(fileKey));
}

function ensureActiveFileIsValid() {
  if (!isKnownFileKey(state.activeFile)) {
    state.activeFile = "html";
  }
}

function getReplacementFileKey(removedFileKey, preferredFileKey) {
  if (
    preferredFileKey &&
    preferredFileKey !== removedFileKey &&
    isKnownFileKey(preferredFileKey)
  ) {
    return preferredFileKey;
  }

  const nextCustomFile = state.ruleFiles.find(
    (file) => getRuleFileKey(file.id) !== removedFileKey,
  );
  if (nextCustomFile) {
    return getRuleFileKey(nextCustomFile.id);
  }

  return "html";
}

function getFileRenamePlaceholder(fileKey) {
  const definition = getFileDefinition(fileKey);
  if (definition) {
    return definition.placeholder;
  }

  return CUSTOM_RULE_FILE_DEFAULT_PATH;
}

function normalizeCustomFilePath(value) {
  const normalized = normalizeRuleFilePath(value);
  if (!normalized) {
    return CUSTOM_RULE_FILE_DEFAULT_PATH;
  }

  const segments = normalized.split("/");
  const lastSegment = segments[segments.length - 1] ?? "";
  if (!lastSegment || lastSegment.endsWith(".")) {
    return `${normalized.replace(/\.+$/, "")}.txt`;
  }

  if (!lastSegment.includes(".")) {
    return `${normalized}.txt`;
  }

  return normalized;
}

function inferRuleFileMimeType(filePath) {
  const extension = getRuleFileTypeLabel(filePath);

  if (extension === "svg") return "image/svg+xml";
  if (extension === "html") return "text/html";
  if (extension === "css") return "text/css";
  if (extension === "js") return "text/javascript";
  if (extension === "json") return "application/json";
  if (extension === "txt") return "text/plain";

  return "text/plain";
}

function getRuleFileTypeLabel(filePath) {
  const normalized = normalizeCustomFilePath(filePath);
  const lastSegment = normalized.split("/").pop() ?? normalized;
  const lastDotIndex = lastSegment.lastIndexOf(".");

  if (lastDotIndex < 0 || lastDotIndex === lastSegment.length - 1) {
    return "txt";
  }

  return lastSegment.slice(lastDotIndex + 1).toLowerCase();
}

function renderRuleFiles() {
  const tabStrip = elements.fileTabStrip;
  const editorStack = elements.editorStack;
  const createShell = elements.fileCreateButton?.closest(".file-tab-shell");
  if (!tabStrip || !editorStack || !createShell) {
    return;
  }

  tabStrip.querySelectorAll("[data-custom-file-shell]").forEach((node) => node.remove());
  editorStack.querySelectorAll("[data-custom-file-panel]").forEach((node) => node.remove());

  state.ruleFiles.forEach((file) => {
    const fileKey = getRuleFileKey(file.id);
    const shell = document.createElement("div");
    shell.className = "file-tab-shell";
    shell.dataset.customFileShell = "true";
    shell.dataset.fileShell = fileKey;

    const button = document.createElement("button");
    button.className = "file-tab";
    button.type = "button";
    button.dataset.fileTarget = fileKey;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.disabled = state.isBusy;

    const topline = document.createElement("span");
    topline.className = "file-tab-topline";

    const dot = document.createElement("span");
    dot.className = "file-tab-dot file-tab-dot-file";
    topline.appendChild(dot);

    const title = document.createElement("span");
    title.className = "file-tab-title";
    title.dataset.fileTabLabel = fileKey;
    title.textContent = getTabDisplayFileName(fileKey);
    topline.appendChild(title);

    button.appendChild(topline);
    shell.appendChild(button);

    const renameInput = document.createElement("textarea");
    renameInput.className = "file-tab-rename-input is-hidden";
    renameInput.dataset.fileRenameInput = fileKey;
    renameInput.rows = 1;
    renameInput.wrap = "off";
    renameInput.autocomplete = "off";
    renameInput.spellcheck = false;
    renameInput.placeholder = CUSTOM_RULE_FILE_DEFAULT_PATH;
    renameInput.setAttribute("aria-label", "Rename generated file");
    renameInput.disabled = state.isBusy;
    shell.appendChild(renameInput);

    tabStrip.insertBefore(shell, createShell);

    const panel = document.createElement("label");
    panel.className = "field editor-panel";
    panel.dataset.customFilePanel = "true";
    panel.dataset.filePanel = fileKey;

    const marker = document.createElement("span");
    marker.className = "editor-panel-marker";
    marker.dataset.filePanelLabel = fileKey;
    marker.textContent = getEditorFileMarker(fileKey);
    panel.appendChild(marker);

    const editor = document.createElement("textarea");
    editor.rows = 16;
    editor.dataset.ruleFileEditor = fileKey;
    editor.value = file.content;
    editor.disabled = state.isBusy;
    panel.appendChild(editor);

    editorStack.appendChild(panel);
  });
}

function queryByDataValue(root, attributeName, value) {
  if (!root || typeof value !== "string" || typeof CSS?.escape !== "function") {
    return null;
  }

  return root.querySelector(`[${attributeName}="${CSS.escape(value)}"]`);
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
  if (elements.starterSuggestionButton) {
    elements.starterSuggestionButton.disabled = false;
    elements.starterSuggestionButton.title =
      "Save a CSS starter that forces all text red with !important";
    elements.starterSuggestionButton.setAttribute(
      "aria-label",
      "Save a CSS starter that forces all text red with !important",
    );
  }

  if (elements.loadExampleButton) {
    elements.loadExampleButton.title =
      "Save the Hello World starter as a finished rule";
    elements.loadExampleButton.setAttribute(
      "aria-label",
      "Save the Hello World starter as a finished rule",
    );
  }
}

function getStarterRule(starterKey) {
  return STARTER_RULES.find((starter) => starter.key === starterKey) ?? null;
}

function normalizeStarterName(value) {
  return String(value ?? "").trim().toLowerCase();
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
