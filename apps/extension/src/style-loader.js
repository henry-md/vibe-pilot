(() => {
  try {
    const response = chrome.runtime.sendMessage({
      type: "VIBE_PILOT_APPLY_ACTIVE_CSS_TO_FRAME",
    });

    if (response && typeof response.catch === "function") {
      response.catch(() => {
        // The service worker may be unavailable during extension reloads.
      });
    }
  } catch {
    // Ignore frames that unload before the request can be delivered.
  }
})();
