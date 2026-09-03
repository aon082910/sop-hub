import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";

interface Guide {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

export default function Dashboard() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace) return;
    api.get<{ guides: Guide[] }>(`/guides?workspaceId=${workspace.id}`).then((r) => {
      setGuides(r.guides);
      setLoading(false);
    });
  }, [workspace]);

  async function createGuide() {
    if (!workspace) return;
    const res = await api.post<{ guide: Guide }>("/guides", { workspaceId: workspace.id, title: "Untitled Guide" });
    navigate(`/guides/${res.guide.id}`);
  }

  async function removeGuide(id: string) {
    if (!confirm("Delete this guide?")) return;
    await api.del(`/guides/${id}`);
    setGuides((g) => g.filter((x) => x.id !== id));
  }

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ flex: 1, margin: 0 }}>Guides</h1>
        <button className="btn" onClick={createGuide}>
          + New guide
        </button>
      </div>

      <div className="card">
        {loading && <p>Loading...</p>}
        {!loading && guides.length === 0 && (
          <p>No guides yet. Create one manually, or capture a workflow with the SOP-Hub browser extension.</p>
        )}
        {guides.map((g) => (
          <div className="guide-list-item" key={g.id}>
            <div>
              <a href="#" onClick={(e) => (e.preventDefault(), navigate(`/guides/${g.id}`))}>
                {g.title}
              </a>{" "}
              <span className={`badge ${g.status}`}>{g.status}</span>
            </div>
            <button className="btn secondary" onClick={() => removeGuide(g.id)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
