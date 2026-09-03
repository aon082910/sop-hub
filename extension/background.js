// Owns capture state and does the things content scripts can't:
// screenshotting the tab and persisting captured steps between page loads.

let recording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SOPHUB_GET_STATE") {
    sendResponse({ recording });
    return true;
  }

  if (message.type === "SOPHUB_SET_RECORDING") {
    recording = message.recording;
    sendResponse({ recording });
    return true;
  }

  if (message.type === "SOPHUB_CAPTURE_CLICK") {
    if (!recording) {
      sendResponse({ ok: false, reason: "not-recording" });
      return true;
    }
    const tabId = sender.tab?.id;
    chrome.tabs.captureVisibleTab({ format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, reason: chrome.runtime.lastError?.message });
        return;
      }
      const step = {
        title: "",
        instruction: message.pageTitle ? `On "${message.pageTitle}"` : "",
        screenshotBase64: dataUrl.split(",")[1],
        clickXPct: message.clickXPct,
        clickYPct: message.clickYPct,
        capturedAt: Date.now(),
        url: message.url,
      };
      const { sophubSteps = [] } = await chrome.storage.local.get("sophubSteps");
      sophubSteps.push(step);
      await chrome.storage.local.set({ sophubSteps });
      sendResponse({ ok: true, count: sophubSteps.length });
    });
    return true; // async response
  }
});
