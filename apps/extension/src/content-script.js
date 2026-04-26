(() => {
  function summarizePage() {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .slice(0, 6)
      .map((node) => node.textContent?.trim())
      .filter(Boolean);

    const buttons = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"),
    )
      .slice(0, 8)
      .map((node) =>
        "value" in node && typeof node.value === "string"
          ? node.value.trim()
          : node.textContent?.trim(),
      )
      .filter(Boolean);

    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      headingSample: headings,
      buttonSample: buttons,
      inputCount: document.querySelectorAll("input, textarea, select").length,
      textPreview: document.body?.innerText?.replace(/\s+/g, " ").slice(0, 1000) ?? "",
      htmlLength: document.documentElement.outerHTML.length,
      timestamp: new Date().toISOString(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "VIBE_PILOT_GET_DOM_SUMMARY") {
      return;
    }

    sendResponse(summarizePage());
  });
})();
