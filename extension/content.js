// Listens for clicks on the page and asks the background worker to capture
// a screenshot + the click position (as a % of the viewport, so guides
// render correctly regardless of the viewer's screen size).

document.addEventListener(
  "click",
  (event) => {
    const clickXPct = (event.clientX / window.innerWidth) * 100;
    const clickYPct = (event.clientY / window.innerHeight) * 100;

    chrome.runtime.sendMessage({
      type: "SOPHUB_CAPTURE_CLICK",
      pageTitle: document.title,
      url: window.location.href,
      clickXPct,
      clickYPct,
    });
  },
  { capture: true }
);
