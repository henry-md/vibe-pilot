const defaultDraft = {
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

const state = {
  hydrated: false,
};

const elements = {
  backendStatusMessage: document.querySelector("#backend-status-message"),
  backendStatusValue: document.querySelector("#backend-status-value"),
  backendUrl: document.querySelector("#backend-url"),
  clearScriptButton: document.querySelector("#clear-script-button"),
  domSummary: document.querySelector("#dom-summary"),
  errorBanner: document.querySelector("#error-banner"),
  htmlSnippet: document.querySelector("#html-snippet"),
  inspectButton: document.querySelector("#inspect-button"),
  javascriptSnippet: document.querySelector("#javascript-snippet"),
  loadRemoteButton: document.querySelector("#load-remote-button"),
  liveDraftMessage: document.querySelector("#live-draft-message"),
  liveDraftValue: document.querySelector("#live-draft-value"),
  matchPattern: document.querySelector("#match-pattern"),
  remoteDrafts: document.querySelector("#remote-drafts"),
  runtimeMessage: document.querySelector("#runtime-message"),
  runtimeValue: document.querySelector("#runtime-value"),
  saveLocalButton: document.querySelector("#save-local-button"),
  saveRemoteButton: document.querySelector("#save-remote-button"),
  applyDraftButton: document.querySelector("#apply-draft-button"),
  statusBanner: document.querySelector("#status-banner"),
  activeTabTitle: document.querySelector("#active-tab-title"),
  activeTabUrl: document.querySelector("#active-tab-url"),
  userScriptsMessage: document.querySelector("#user-scripts-message"),
  userScriptsValue: document.querySelector("#user-scripts-value"),
  cssSnippet: document.querySelector("#css-snippet"),
};

boot();

async function boot() {
  wireEvents();
  await refreshStatus({ hydrateDraft: true });
}

function wireEvents() {
  elements.saveLocalButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await sendMessage("VIBE_PILOT_SAVE_DRAFT", readDraft());
        await refreshStatus();
      },
      "Saving the local draft...",
      "Draft saved to chrome.storage.local.",
    ),
  );

  elements.applyDraftButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await sendMessage("VIBE_PILOT_APPLY_DRAFT", readDraft());
        await refreshStatus();
      },
      "Registering the live user script...",
      "Live script registered for the current match pattern.",
    ),
  );

  elements.saveRemoteButton?.addEventListener("click", () =>
    runAction(
      async () => {
        const response = await sendMessage("VIBE_PILOT_SAVE_REMOTE_DRAFT", {
          backendUrl: readBackendUrl(),
          draft: readDraft(),
        });
        writeBackendUrl(response.backendUrl);
        await refreshStatus();
        await loadRemoteDrafts();
      },
      "Saving the draft to the backend...",
      "Draft saved to the remote Postgres-backed API.",
    ),
  );

  elements.loadRemoteButton?.addEventListener("click", () =>
    runAction(
      loadRemoteDrafts,
      "Loading recent drafts from the backend...",
      "Recent remote drafts loaded.",
    ),
  );

  elements.inspectButton?.addEventListener("click", () =>
    runAction(
      async () => {
        const summary = await sendMessage("VIBE_PILOT_GET_DOM_SUMMARY");
        renderDomSummary(summary);
        await refreshStatus();
      },
      "Inspecting the active tab...",
      "DOM snapshot refreshed.",
    ),
  );

  elements.clearScriptButton?.addEventListener("click", () =>
    runAction(
      async () => {
        await sendMessage("VIBE_PILOT_CLEAR_SCRIPT");
        await refreshStatus();
      },
      "Clearing the registered script...",
      "Live script removed from the active tab and registry.",
    ),
  );

  elements.backendUrl?.addEventListener("blur", () =>
    runAction(
      async () => {
        await sendMessage("VIBE_PILOT_SET_BACKEND_URL", {
          backendUrl: readBackendUrl(),
        });
        await refreshStatus();
      },
      "Saving backend URL...",
      "Backend URL saved.",
    ),
  );
}

async function refreshStatus(options = {}) {
  try {
    const payload = await sendMessage("VIBE_PILOT_GET_STATUS");
    renderStatus(payload);

    if (options.hydrateDraft || !state.hydrated) {
      writeDraft(payload.draft ?? defaultDraft);
      writeBackendUrl(payload.backendUrl ?? "http://127.0.0.1:3001");
      state.hydrated = true;
    }

    setError("");
  } catch (error) {
    setStatus("Unable to talk to the extension runtime.");
    setError(
      error instanceof Error ? error.message : "Unknown extension runtime error.",
    );
  }
}

async function loadRemoteDrafts() {
  const payload = await sendMessage("VIBE_PILOT_LOAD_REMOTE_DRAFTS", {
    backendUrl: readBackendUrl(),
  });

  writeBackendUrl(payload.backendUrl);
  renderRemoteDrafts(payload.drafts ?? []);

  if (payload.drafts?.length) {
    writeDraft(payload.drafts[0]);
    setBackendStatus(
      "Connected",
      `Loaded ${payload.drafts.length} remote draft${
        payload.drafts.length === 1 ? "" : "s"
      } from the backend.`,
    );
  } else {
    setBackendStatus("Connected", "No remote drafts were found yet.");
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

function renderStatus(payload) {
  elements.runtimeValue.textContent = "Extension context";
  elements.runtimeMessage.textContent = payload.userScripts.message;
  elements.userScriptsValue.textContent = payload.userScripts.available
    ? "Ready"
    : "Needs toggle";
  elements.userScriptsMessage.textContent = payload.userScripts.available
    ? "Dynamic user scripts can be registered right now."
    : "Enable Allow User Scripts in chrome://extensions.";
  elements.liveDraftValue.textContent = payload.liveScriptRegistered
    ? "Registered"
    : "Not registered";
  elements.liveDraftMessage.textContent = payload.liveScriptRegistered
    ? "The saved draft is active for matching pages."
    : "Apply the draft to register a live script.";
  elements.activeTabTitle.textContent =
    payload.activeTab?.title ?? "No active page detected";
  elements.activeTabUrl.textContent =
    payload.activeTab?.url ?? "Open a standard website tab in this window.";
  setBackendStatus(
    "Configured",
    `Current backend: ${payload.backendUrl ?? "http://127.0.0.1:3001"}`,
  );

  if (!elements.backendUrl.value && payload.backendUrl) {
    writeBackendUrl(payload.backendUrl);
  }
}

function renderRemoteDrafts(drafts) {
  if (!elements.remoteDrafts) {
    return;
  }

  if (!drafts.length) {
    elements.remoteDrafts.innerHTML =
      '<p class="empty-inline">Nothing loaded from the backend yet.</p>';
    return;
  }

  elements.remoteDrafts.innerHTML = drafts
    .map(
      (draft) => `
        <div class="remote-item">
          <strong>${escapeHtml(draft.name ?? "Untitled draft")}</strong>
          <span>${escapeHtml(draft.targetUrl ?? "No target URL")}</span>
          <span>${escapeHtml(draft.updatedAt ?? "")}</span>
        </div>
      `,
    )
    .join("");
}

function renderDomSummary(summary) {
  const lines = [
    `URL: ${summary.url}`,
    `Title: ${summary.title}`,
    `Ready state: ${summary.readyState}`,
    `Inputs: ${summary.inputCount}`,
    `HTML length: ${summary.htmlLength}`,
    "",
    `Headings: ${summary.headingSample.join(" | ") || "None"}`,
    `Buttons: ${summary.buttonSample.join(" | ") || "None"}`,
    "",
    summary.textPreview || "No text preview returned.",
  ];

  elements.domSummary.textContent = lines.join("\n");
}

function readDraft() {
  return {
    matchPattern: elements.matchPattern.value.trim() || defaultDraft.matchPattern,
    html: elements.htmlSnippet.value,
    css: elements.cssSnippet.value,
    javascript: elements.javascriptSnippet.value,
  };
}

function writeDraft(draft) {
  elements.matchPattern.value = draft.matchPattern ?? defaultDraft.matchPattern;
  elements.htmlSnippet.value = draft.html ?? "";
  elements.cssSnippet.value = draft.css ?? "";
  elements.javascriptSnippet.value =
    draft.javascript ?? defaultDraft.javascript;
}

function readBackendUrl() {
  return elements.backendUrl.value.trim() || "http://127.0.0.1:3001";
}

function writeBackendUrl(value) {
  elements.backendUrl.value = value ?? "http://127.0.0.1:3001";
}

function setBackendStatus(value, message) {
  elements.backendStatusValue.textContent = value;
  elements.backendStatusMessage.textContent = message;
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
  const buttons = [
    elements.saveLocalButton,
    elements.saveRemoteButton,
    elements.applyDraftButton,
    elements.loadRemoteButton,
    elements.inspectButton,
    elements.clearScriptButton,
  ];

  for (const button of buttons) {
    if (button) {
      button.disabled = isBusy;
    }
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
