const loginView = document.getElementById("loginView");
const recordView = document.getElementById("recordView");
const serverUrlInput = document.getElementById("serverUrl");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginStatus = document.getElementById("loginStatus");
const guideTitleInput = document.getElementById("guideTitle");
const toggleBtn = document.getElementById("toggleBtn");
const statusEl = document.getElementById("status");

async function getConfig() {
  return chrome.storage.local.get(["sophubServerUrl", "sophubToken", "sophubWorkspaceId"]);
}

async function refreshUI() {
  const { sophubServerUrl, sophubToken } = await getConfig();
  serverUrlInput.value = sophubServerUrl || "http://localhost:4000";

  if (sophubToken) {
    loginView.style.display = "none";
    recordView.style.display = "block";
    const { recording } = await chrome.runtime.sendMessage({ type: "SOPHUB_GET_STATE" });
    toggleBtn.textContent = recording ? "Stop recording" : "Start recording";
    const { sophubSteps = [] } = await chrome.storage.local.get("sophubSteps");
    statusEl.textContent = `${sophubSteps.length} step(s) captured`;
  } else {
    loginView.style.display = "block";
    recordView.style.display = "none";
  }
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.replace(/\/$/, "");
  loginStatus.textContent = "";
  try {
    const res = await fetch(`${serverUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Login failed");
    const data = await res.json();

    const wsRes = await fetch(`${serverUrl}/workspaces`, { headers: { Authorization: `Bearer ${data.token}` } });
    const wsData = await wsRes.json();

    await chrome.storage.local.set({
      sophubServerUrl: serverUrl,
      sophubToken: data.token,
      sophubWorkspaceId: wsData.workspaces?.[0]?.id,
    });
    await refreshUI();
  } catch (err) {
    loginStatus.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["sophubToken", "sophubWorkspaceId"]);
  await refreshUI();
});

toggleBtn.addEventListener("click", async () => {
  const { recording } = await chrome.runtime.sendMessage({ type: "SOPHUB_GET_STATE" });
  await chrome.runtime.sendMessage({ type: "SOPHUB_SET_RECORDING", recording: !recording });
  await refreshUI();
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ sophubSteps: [] });
  await refreshUI();
});

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const { sophubServerUrl, sophubToken, sophubWorkspaceId, sophubSteps = [] } = await chrome.storage.local.get([
    "sophubServerUrl",
    "sophubToken",
    "sophubWorkspaceId",
    "sophubSteps",
  ]);
  if (!sophubSteps.length) {
    statusEl.textContent = "Nothing to upload yet.";
    return;
  }
  statusEl.textContent = "Uploading...";
  try {
    const res = await fetch(`${sophubServerUrl}/capture/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sophubToken}` },
      body: JSON.stringify({
        workspaceId: sophubWorkspaceId,
        guideTitle: guideTitleInput.value || "Captured Guide",
        steps: sophubSteps,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
    const data = await res.json();
    await chrome.storage.local.set({ sophubSteps: [] });
    statusEl.textContent = `Uploaded! Open SOP-Hub to edit guide ${data.guideId}.`;
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
  }
});

refreshUI();
