import { useState, type FormEvent } from "react";
import { api } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIChatPanel({ guideId, provider }: { guideId: string; provider?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const question = input;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.post<{ answer: string }>("/ai/chat", { guideId, message: question, provider });
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: "Error: " + (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Ask AI about this guide</h3>
      <div className="chat-box">
        {messages.length === 0 && <p style={{ color: "var(--muted)" }}>Ask e.g. "What's step 3 for?"</p>}
        {messages.map((m, i) => (
          <div className={`chat-msg ${m.role}`} key={i}>
            <strong>{m.role === "user" ? "You" : "AI"}:</strong> {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input
          style={{ marginBottom: 0 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this process..."
        />
        <button className="btn" disabled={busy} type="submit">
          {busy ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
