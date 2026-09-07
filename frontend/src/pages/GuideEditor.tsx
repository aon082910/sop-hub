import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import AIChatPanel from "../components/AIChatPanel";

interface Guide {
  id: string;
  title: string;
  description: string;
  status: string;
  share_slug: string | null;
}
interface Step {
  id: string;
  position: number;
  title: string;
  instruction: string;
  image_path: string | null;
  redacted: boolean;
}

interface Rect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export default function GuideEditor() {
  const { id } = useParams<{ id: string }>();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [busyGuide, setBusyGuide] = useState(false);
  const [redactingId, setRedactingId] = useState<string | null>(null);
  const [pendingRects, setPendingRects] = useState<Rect[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<Rect | null>(null);
  const [imgVersion, setImgVersion] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const provider = localStorage.getItem("sophub_ai_provider") || undefined;

  async function load() {
    const res = await api.get<{ guide: Guide; steps: Step[] }>(`/guides/${id}`);
    setGuide(res.guide);
    setSteps(res.steps);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveGuideField(field: "title" | "description", value: string) {
    if (!guide) return;
    setGuide({ ...guide, [field]: value });
    await api.patch(`/guides/${id}`, { [field]: value });
  }

  async function addStep(file: File) {
    const form = new FormData();
    form.append("guideId", id!);
    form.append("image", file);
    const res = await api.upload<{ step: Step }>("/steps", form);
    setSteps((s) => [...s, res.step]);
  }

  async function updateStep(stepId: string, patch: Partial<Step>) {
    setSteps((s) => s.map((st) => (st.id === stepId ? { ...st, ...patch } : st)));
    await api.patch(`/steps/${stepId}`, patch);
  }

  async function removeStep(stepId: string) {
    await api.del(`/steps/${stepId}`);
    setSteps((s) => s.filter((st) => st.id !== stepId));
  }

  async function move(stepId: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === stepId);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    const reordered = [...steps];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setSteps(reordered);
    await api.post("/steps/reorder", { guideId: id, orderedStepIds: reordered.map((s) => s.id) });
  }

  async function aiCaption(stepId: string) {
    setBusyStepId(stepId);
    try {
      const res = await api.post<{ step: Step }>("/ai/step-caption", { stepId, provider });
      setSteps((s) => s.map((st) => (st.id === stepId ? res.step : st)));
    } catch (e) {
      alert("AI caption failed: " + (e as Error).message);
    } finally {
      setBusyStepId(null);
    }
  }

  async function aiRewrite(stepId: string, current: string) {
    setBusyStepId(stepId);
    try {
      const res = await api.post<{ text: string }>("/ai/rewrite", { text: current, provider });
      await updateStep(stepId, { instruction: res.text });
    } catch (e) {
      alert("AI rewrite failed: " + (e as Error).message);
    } finally {
      setBusyStepId(null);
    }
  }

  function startRedact(stepId: string) {
    setRedactingId(stepId);
    setPendingRects([]);
    setDrawStart(null);
    setDrawRect(null);
  }

  function cancelRedact() {
    setRedactingId(null);
    setPendingRects([]);
    setDrawStart(null);
    setDrawRect(null);
  }

  function rectFromPoints(container: HTMLElement, x1: number, y1: number, x2: number, y2: number): Rect {
    const box = container.getBoundingClientRect();
    const toPct = (v: number, total: number) => Math.min(100, Math.max(0, (v / total) * 100));
    const left = Math.min(x1, x2) - box.left;
    const top = Math.min(y1, y2) - box.top;
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return {
      xPct: toPct(left, box.width),
      yPct: toPct(top, box.height),
      wPct: toPct(width, box.width),
      hPct: toPct(height, box.height),
    };
  }

  function onRedactMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    setDrawStart({ x: e.clientX, y: e.clientY });
    setDrawRect(rectFromPoints(e.currentTarget, e.clientX, e.clientY, e.clientX, e.clientY));
  }

  function onRedactMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!drawStart) return;
    setDrawRect(rectFromPoints(e.currentTarget, drawStart.x, drawStart.y, e.clientX, e.clientY));
  }

  function onRedactMouseUp() {
    if (drawRect && drawRect.wPct > 1 && drawRect.hPct > 1) {
      setPendingRects((r) => [...r, drawRect]);
    }
    setDrawStart(null);
    setDrawRect(null);
  }

  function undoLastRect() {
    setPendingRects((r) => r.slice(0, -1));
  }

  async function applyRedaction(stepId: string) {
    if (!pendingRects.length) return cancelRedact();
    const res = await api.post<{ step: Step }>(`/steps/${stepId}/redact`, { rects: pendingRects });
    setSteps((s) => s.map((st) => (st.id === stepId ? res.step : st)));
    setImgVersion((v) => ({ ...v, [stepId]: Date.now() }));
    cancelRedact();
  }

  async function aiSummary() {
    setBusyGuide(true);
    try {
      const res = await api.post<{ guide: Guide }>("/ai/guide-summary", { guideId: id, provider });
      setGuide(res.guide);
    } catch (e) {
      alert("AI summary failed: " + (e as Error).message);
    } finally {
      setBusyGuide(false);
    }
  }

  async function publish() {
    const res = await api.patch<{ guide: Guide }>(`/guides/${id}`, { status: "published" });
    setGuide(res.guide);
  }

  async function exportAs(format: "pdf" | "html" | "markdown") {
    const token = localStorage.getItem("sophub_token");
    const res = await fetch(`${api.base}/export/guides/${id}/${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${guide?.title || "guide"}.${format === "markdown" ? "md" : format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!guide) return <p>Loading...</p>;

  const shareUrl = guide.share_slug ? `${window.location.origin}/share/${guide.share_slug}` : null;

  return (
    <div>
      <div className="toolbar">
        <input
          style={{ fontSize: 22, fontWeight: 600, marginBottom: 0, flex: 1 }}
          value={guide.title}
          onChange={(e) => saveGuideField("title", e.target.value)}
        />
        <span className={`badge ${guide.status}`}>{guide.status}</span>
      </div>

      <textarea
        placeholder="Guide description"
        value={guide.description}
        onChange={(e) => saveGuideField("description", e.target.value)}
        rows={2}
      />

      <div className="toolbar">
        <button className="btn secondary" disabled={busyGuide} onClick={aiSummary}>
          {busyGuide ? "Thinking..." : "✨ AI: Generate title & summary"}
        </button>
        <button className="btn secondary" onClick={() => fileInput.current?.click()}>
          + Add step (upload screenshot)
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && addStep(e.target.files[0])}
        />
        <button className="btn" onClick={publish}>
          {guide.status === "published" ? "Republish" : "Publish"}
        </button>
        <button className="btn secondary" onClick={() => exportAs("pdf")}>
          Export PDF
        </button>
        <button className="btn secondary" onClick={() => exportAs("html")}>
          Export HTML
        </button>
        <button className="btn secondary" onClick={() => exportAs("markdown")}>
          Export Markdown
        </button>
      </div>

      {shareUrl && (
        <p>
          Share link: <a href={shareUrl}>{shareUrl}</a>
        </p>
      )}

      {steps.map((step, i) => (
        <div className="card step-card" key={step.id}>
          {step.image_path && redactingId === step.id ? (
            <div
              style={{ position: "relative", cursor: "crosshair", userSelect: "none" }}
              onMouseDown={onRedactMouseDown}
              onMouseMove={onRedactMouseMove}
              onMouseUp={onRedactMouseUp}
            >
              <img
                src={`${api.base}/uploads/${step.image_path}?v=${imgVersion[step.id] ?? 0}`}
                alt=""
                draggable={false}
                style={{ display: "block" }}
              />
              {[...pendingRects, ...(drawRect ? [drawRect] : [])].map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    position: "absolute",
                    left: `${r.xPct}%`,
                    top: `${r.yPct}%`,
                    width: `${r.wPct}%`,
                    height: `${r.hPct}%`,
                    background: "rgba(0,0,0,0.7)",
                    border: "1px solid red",
                    pointerEvents: "none",
                  }}
                />
              ))}
            </div>
          ) : (
            step.image_path && (
              <img src={`${api.base}/uploads/${step.image_path}?v=${imgVersion[step.id] ?? 0}`} alt="" />
            )
          )}
          <div className="step-body">
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <strong>Step {i + 1}</strong>
              {step.redacted && <span className="badge">redacted</span>}
              <button className="btn secondary" onClick={() => move(step.id, -1)}>
                ↑
              </button>
              <button className="btn secondary" onClick={() => move(step.id, 1)}>
                ↓
              </button>
              {step.image_path && (
                <button className="btn secondary" disabled={busyStepId === step.id} onClick={() => aiCaption(step.id)}>
                  {busyStepId === step.id ? "Thinking..." : "✨ AI: Describe screenshot"}
                </button>
              )}
              {step.image_path && redactingId !== step.id && (
                <button className="btn secondary" onClick={() => startRedact(step.id)}>
                  Redact
                </button>
              )}
              {redactingId === step.id && (
                <>
                  <button className="btn secondary" onClick={undoLastRect} disabled={!pendingRects.length}>
                    Undo last box
                  </button>
                  <button className="btn" onClick={() => applyRedaction(step.id)} disabled={!pendingRects.length}>
                    Apply redaction
                  </button>
                  <button className="btn secondary" onClick={cancelRedact}>
                    Cancel
                  </button>
                </>
              )}
              <button
                className="btn secondary"
                disabled={busyStepId === step.id}
                onClick={() => aiRewrite(step.id, step.instruction)}
              >
                ✨ AI: Rewrite
              </button>
              <button className="btn secondary" onClick={() => removeStep(step.id)}>
                Delete
              </button>
            </div>
            <input
              placeholder="Step title"
              value={step.title}
              onChange={(e) => updateStep(step.id, { title: e.target.value })}
            />
            <textarea
              placeholder="Instruction"
              rows={2}
              value={step.instruction}
              onChange={(e) => updateStep(step.id, { instruction: e.target.value })}
            />
          </div>
        </div>
      ))}

      <AIChatPanel guideId={id!} provider={provider} />
    </div>
  );
}
