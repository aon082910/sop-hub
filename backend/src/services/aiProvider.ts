// Unified AI provider abstraction.
// Supports: local Ollama, Anthropic Claude, OpenAI, and any OpenAI-compatible
// endpoint (LM Studio, vLLM, OpenRouter, ...). The caller picks a provider
// per-request (or falls back to AI_DEFAULT_PROVIDER); everything downstream
// (step generation, guide summaries, the guide Q&A chatbot) goes through
// `generateText` / `generateVision` so swapping providers never touches
// feature code.

export type AiProviderName = "ollama" | "anthropic" | "openai" | "custom";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface VisionRequest {
  /** Base64-encoded image (no data: prefix) */
  imageBase64: string;
  mimeType: string;
  prompt: string;
  system?: string;
}

export interface TextRequest {
  messages: ChatMessage[];
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function resolveProvider(requested?: string): AiProviderName {
  const provider = (requested || process.env.AI_DEFAULT_PROVIDER || "ollama") as AiProviderName;
  if (!["ollama", "anthropic", "openai", "custom"].includes(provider)) {
    throw new Error(`Unknown AI provider: ${provider}`);
  }
  return provider;
}

export async function generateText(provider: AiProviderName, req: TextRequest): Promise<string> {
  switch (provider) {
    case "ollama":
      return ollamaText(req);
    case "anthropic":
      return anthropicText(req);
    case "openai":
      return openaiCompatibleText(req, {
        baseUrl: "https://api.openai.com/v1",
        apiKey: envOrThrow("OPENAI_API_KEY"),
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      });
    case "custom":
      return openaiCompatibleText(req, {
        baseUrl: envOrThrow("CUSTOM_OPENAI_BASE_URL"),
        apiKey: process.env.CUSTOM_OPENAI_API_KEY || "",
        model: envOrThrow("CUSTOM_OPENAI_MODEL"),
      });
  }
}

export async function generateVisionCaption(provider: AiProviderName, req: VisionRequest): Promise<string> {
  switch (provider) {
    case "ollama":
      return ollamaVision(req);
    case "anthropic":
      return anthropicVision(req);
    case "openai":
      return openaiCompatibleVision(req, {
        baseUrl: "https://api.openai.com/v1",
        apiKey: envOrThrow("OPENAI_API_KEY"),
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      });
    case "custom":
      return openaiCompatibleVision(req, {
        baseUrl: envOrThrow("CUSTOM_OPENAI_BASE_URL"),
        apiKey: process.env.CUSTOM_OPENAI_API_KEY || "",
        model: envOrThrow("CUSTOM_OPENAI_MODEL"),
      });
  }
}

// ---------------- Ollama (local) ----------------

async function ollamaText(req: TextRequest): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llava";
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: req.messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.message?.content ?? "";
}

async function ollamaVision(req: VisionRequest): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llava";
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: req.prompt, images: [req.imageBase64] },
      ],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.message?.content ?? "";
}

// ---------------- Anthropic (cloud) ----------------

async function anthropicText(req: TextRequest): Promise<string> {
  const apiKey = envOrThrow("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const system = req.messages.find((m) => m.role === "system")?.content;
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.content?.[0]?.text ?? "";
}

async function anthropicVision(req: VisionRequest): Promise<string> {
  const apiKey = envOrThrow("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: req.mimeType, data: req.imageBase64 } },
            { type: "text", text: req.prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.content?.[0]?.text ?? "";
}

// ---------------- OpenAI-compatible (OpenAI, custom endpoints) ----------------

interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function openaiCompatibleText(req: TextRequest, cfg: OpenAiCompatConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: cfg.model, messages: req.messages }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

async function openaiCompatibleVision(req: VisionRequest, cfg: OpenAiCompatConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            { type: "image_url", image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}
