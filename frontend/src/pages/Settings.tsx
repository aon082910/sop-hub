import { useState } from "react";

export default function Settings() {
  const [provider, setProvider] = useState(localStorage.getItem("sophub_ai_provider") || "");

  function save(value: string) {
    setProvider(value);
    if (value) localStorage.setItem("sophub_ai_provider", value);
    else localStorage.removeItem("sophub_ai_provider");
  }

  return (
    <div>
      <h1>AI Settings</h1>
      <div className="card">
        <label>AI provider for this browser</label>
        <select value={provider} onChange={(e) => save(e.target.value)}>
          <option value="">Server default (AI_DEFAULT_PROVIDER)</option>
          <option value="ollama">Local: Ollama</option>
          <option value="anthropic">Cloud: Anthropic Claude</option>
          <option value="openai">Cloud: OpenAI</option>
          <option value="custom">Custom OpenAI-compatible endpoint</option>
        </select>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Provider credentials (API keys, Ollama URL/model) are configured server-side via environment
          variables in <code>.env</code> — see <code>.env.example</code> in the project root. This picker only
          chooses which configured provider your requests use; it never sends keys through the browser.
        </p>
      </div>
    </div>
  );
}
