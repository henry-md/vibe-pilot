(() => {
  const TEXT_PREVIEW_LIMIT = 1000;
  const HTML_PREVIEW_LIMIT = 2400;
  const ELEMENT_TEXT_LIMIT = 320;
  const ELEMENT_HTML_LIMIT = 900;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleMessage(message)
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        sendResponse({
          error: error instanceof Error ? error.message : "Unknown content script error.",
        });
      });

    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case "VIBE_PILOT_PING":
        return {
          ok: true,
          readyState: document.readyState,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        };
      case "VIBE_PILOT_GET_DOM_SUMMARY":
        return getDomSummary();
      case "VIBE_PILOT_GET_PAGE_CONTEXT":
        return getPageContext(message.payload);
      case "VIBE_PILOT_QUERY_DOM":
        return queryDom(message.payload);
      case "VIBE_PILOT_SCROLL_PAGE":
        return scrollPage(message.payload);
      default:
        return null;
    }
  }

  function getDomSummary() {
    const context = getPageContext({});

    return {
      url: context.url,
      title: context.title,
      readyState: context.readyState,
      headingSample: context.headings.map((item) => item.text),
      buttonSample: context.interactiveElements
        .filter((item) => item.tagName === "button" || item.role === "button")
        .map((item) => item.text)
        .filter(Boolean)
        .slice(0, 8),
      inputCount: context.formSummary.inputCount,
      textPreview: context.textPreview,
      htmlLength: document.documentElement.outerHTML.length,
      timestamp: context.timestamp,
    };
  }

  function getPageContext(payload = {}) {
    const includeHtml = Boolean(payload?.includeHtml);
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .slice(0, 8)
      .map((node) => ({
        level: node.tagName.toLowerCase(),
        selectorHint: buildSelectorHint(node),
        text: truncateText(node.textContent, 160),
      }))
      .filter((item) => item.text);

    const landmarks = Array.from(
      document.querySelectorAll("main, header, nav, aside, footer, section, form"),
    )
      .slice(0, 8)
      .map((node) => summarizeElement(node, {
        attributeNames: ["role", "aria-label", "data-testid"],
        includeHtml,
        includeText: true,
      }));

    const interactiveElements = Array.from(
      document.querySelectorAll(
        "button, a[href], input, textarea, select, [role='button'], [role='link']",
      ),
    )
      .slice(0, 12)
      .map((node) => summarizeElement(node, {
        attributeNames: ["role", "aria-label", "name", "type", "href", "data-testid"],
        includeHtml: false,
        includeText: true,
      }));

    const bodyText = document.body?.innerText ?? "";
    const mainElement = document.querySelector("main");
    const htmlPreviewSource = mainElement ?? document.body ?? document.documentElement;

    return {
      formSummary: {
        inputCount: document.querySelectorAll("input").length,
        selectCount: document.querySelectorAll("select").length,
        textareaCount: document.querySelectorAll("textarea").length,
      },
      headings,
      htmlPreview: includeHtml
        ? truncateText(htmlPreviewSource?.outerHTML ?? "", HTML_PREVIEW_LIMIT)
        : null,
      interactiveElements,
      landmarks,
      metaDescription:
        document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      readyState: document.readyState,
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
      },
      textPreview: truncateText(bodyText, TEXT_PREVIEW_LIMIT),
      timestamp: new Date().toISOString(),
      title: document.title,
      url: window.location.href,
      viewport: {
        devicePixelRatio: window.devicePixelRatio,
        height: window.innerHeight,
        width: window.innerWidth,
      },
      vibePilot: {
        hostPresent: Boolean(document.getElementById("__vibe_pilot_host__")),
        rootPresent: Boolean(document.getElementById("__vibe_pilot_root__")),
        stylePresent: Boolean(document.getElementById("__vibe_pilot_style__")),
      },
    };
  }

  function queryDom(payload = {}) {
    const selector =
      typeof payload?.selector === "string" ? payload.selector.trim() : "";

    if (!selector) {
      throw new Error("query_dom requires a non-empty selector.");
    }

    const maxItems = clampInteger(payload?.maxItems, 1, 12, 5);
    const attributeNames = Array.isArray(payload?.attributeNames)
      ? payload.attributeNames.filter((value) => typeof value === "string").slice(0, 12)
      : [];
    const includeHtml = Boolean(payload?.includeHtml);
    const includeText = payload?.includeText !== false;
    const nodes = Array.from(document.querySelectorAll(selector));

    return {
      count: nodes.length,
      elements: nodes.slice(0, maxItems).map((node) =>
        summarizeElement(node, {
          attributeNames,
          includeHtml,
          includeText,
        }),
      ),
      selector,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    };
  }

  async function scrollPage(payload = {}) {
    const selector =
      typeof payload?.selector === "string" ? payload.selector.trim() : "";
    const block = normalizeBlock(payload?.block);

    if (selector) {
      const node = document.querySelector(selector);
      if (!node) {
        throw new Error(`No element matched selector "${selector}".`);
      }

      node.scrollIntoView({
        behavior: "auto",
        block,
        inline: "nearest",
      });
    } else {
      window.scrollTo({
        top: typeof payload?.top === "number" ? payload.top : window.scrollY,
        left: typeof payload?.left === "number" ? payload.left : window.scrollX,
        behavior: "auto",
      });
    }

    await afterScroll();

    return {
      block,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      selector,
      timestamp: new Date().toISOString(),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }

  function summarizeElement(node, options = {}) {
    const text = options.includeText
      ? truncateText(
          node instanceof HTMLInputElement ||
            node instanceof HTMLTextAreaElement ||
            node instanceof HTMLSelectElement
            ? node.value || node.placeholder || ""
            : node.textContent,
          ELEMENT_TEXT_LIMIT,
        )
      : "";

    return {
      attributes: collectAttributes(node, options.attributeNames),
      className: truncateText(node.className, 160),
      id: node.id || "",
      outerHTML: options.includeHtml
        ? truncateText(node.outerHTML, ELEMENT_HTML_LIMIT)
        : null,
      rect: getElementRect(node),
      role: node.getAttribute("role") || "",
      selectorHint: buildSelectorHint(node),
      tagName: node.tagName.toLowerCase(),
      text,
    };
  }

  function collectAttributes(node, attributeNames = []) {
    const attributes = {};

    attributeNames.forEach((attributeName) => {
      const value = node.getAttribute(attributeName);
      if (value != null) {
        attributes[attributeName] = truncateText(value, 240);
      }
    });

    return attributes;
  }

  function getElementRect(node) {
    const rect = node.getBoundingClientRect();

    return {
      bottom: roundNumber(rect.bottom),
      height: roundNumber(rect.height),
      left: roundNumber(rect.left),
      right: roundNumber(rect.right),
      top: roundNumber(rect.top),
      width: roundNumber(rect.width),
    };
  }

  function buildSelectorHint(node) {
    if (!(node instanceof Element)) {
      return node?.tagName?.toLowerCase?.() ?? "node";
    }

    const tagName = node.tagName.toLowerCase();
    if (node.id) {
      return `${tagName}#${escapeSimpleCss(node.id)}`;
    }

    const testId = node.getAttribute("data-testid");
    if (testId) {
      return `${tagName}[data-testid="${escapeAttributeValue(testId)}"]`;
    }

    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel) {
      return `${tagName}[aria-label="${escapeAttributeValue(ariaLabel)}"]`;
    }

    const classNames = Array.from(node.classList).slice(0, 2);
    if (classNames.length > 0) {
      return `${tagName}.${classNames.map(escapeSimpleCss).join(".")}`;
    }

    return tagName;
  }

  function escapeSimpleCss(value) {
    return String(value)
      .replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function escapeAttributeValue(value) {
    return String(value).replace(/"/g, '\\"');
  }

  function truncateText(value, limit) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= limit) {
      return text;
    }

    return `${text.slice(0, limit - 1)}…`;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.round(value)));
  }

  function normalizeBlock(value) {
    if (value === "start" || value === "center" || value === "end" || value === "nearest") {
      return value;
    }

    return "center";
  }

  async function afterScroll() {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  function roundNumber(value) {
    return Math.round(value * 100) / 100;
  }
})();
