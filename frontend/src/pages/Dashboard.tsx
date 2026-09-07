import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";

interface Guide {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  folder_id: string | null;
}
interface Folder {
  id: string;
  name: string;
}

const UNFILED = "unfiled";

export default function Dashboard() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = All, UNFILED, or a folder id
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadFolders() {
    if (!workspace) return;
    const res = await api.get<{ folders: Folder[] }>(`/folders?workspaceId=${workspace.id}`);
    setFolders(res.folders);
  }

  async function loadGuides() {
    if (!workspace) return;
    setLoading(true);
    const query = activeFolder ? `&folderId=${activeFolder}` : "";
    const res = await api.get<{ guides: Guide[] }>(`/guides?workspaceId=${workspace.id}${query}`);
    setGuides(res.guides);
    setLoading(false);
  }

  useEffect(() => {
    loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  useEffect(() => {
    loadGuides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, activeFolder]);

  async function createGuide() {
    if (!workspace) return;
    const res = await api.post<{ guide: Guide }>("/guides", { workspaceId: workspace.id, title: "Untitled Guide" });
    if (activeFolder && activeFolder !== UNFILED) {
      await api.patch(`/guides/${res.guide.id}`, { folderId: activeFolder });
    }
    navigate(`/guides/${res.guide.id}`);
  }

  async function removeGuide(id: string) {
    if (!confirm("Delete this guide?")) return;
    await api.del(`/guides/${id}`);
    setGuides((g) => g.filter((x) => x.id !== id));
  }

  async function moveGuide(guideId: string, folderId: string) {
    const patch = { folderId: folderId === UNFILED ? null : folderId };
    await api.patch(`/guides/${guideId}`, patch);
    if (activeFolder) {
      setGuides((g) => g.filter((x) => x.id !== guideId));
    } else {
      setGuides((g) => g.map((x) => (x.id === guideId ? { ...x, folder_id: patch.folderId } : x)));
    }
  }

  async function createFolder() {
    if (!workspace) return;
    const name = prompt("Folder name?");
    if (!name) return;
    const res = await api.post<{ folder: Folder }>("/folders", { workspaceId: workspace.id, name });
    setFolders((f) => [...f, res.folder].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function renameFolder(folder: Folder) {
    const name = prompt("Rename folder", folder.name);
    if (!name || name === folder.name) return;
    const res = await api.patch<{ folder: Folder }>(`/folders/${folder.id}`, { name });
    setFolders((f) => f.map((x) => (x.id === folder.id ? res.folder : x)));
  }

  async function removeFolder(folder: Folder) {
    if (!confirm(`Delete folder "${folder.name}"? Guides inside become unfiled.`)) return;
    await api.del(`/folders/${folder.id}`);
    setFolders((f) => f.filter((x) => x.id !== folder.id));
    if (activeFolder === folder.id) setActiveFolder(null);
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 200, flexShrink: 0 }}>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <strong style={{ flex: 1 }}>Folders</strong>
          <button className="btn secondary" onClick={createFolder}>
            +
          </button>
        </div>
        <div
          className={`guide-list-item${activeFolder === null ? " active" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setActiveFolder(null)}
        >
          All guides
        </div>
        <div
          className={`guide-list-item${activeFolder === UNFILED ? " active" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setActiveFolder(UNFILED)}
        >
          Unfiled
        </div>
        {folders.map((f) => (
          <div
            key={f.id}
            className={`guide-list-item${activeFolder === f.id ? " active" : ""}`}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <span style={{ flex: 1 }} onClick={() => setActiveFolder(f.id)}>
              {f.name}
            </span>
            <button className="btn secondary" onClick={() => renameFolder(f)} title="Rename">
              ✎
            </button>
            <button className="btn secondary" onClick={() => removeFolder(f)} title="Delete">
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }}>
        <div className="toolbar">
          <h1 style={{ flex: 1, margin: 0 }}>Guides</h1>
          <button className="btn" onClick={createGuide}>
            + New guide
          </button>
        </div>

        <div className="card">
          {loading && <p>Loading...</p>}
          {!loading && guides.length === 0 && (
            <p>No guides here yet. Create one manually, or capture a workflow with the SOP-Hub browser extension.</p>
          )}
          {guides.map((g) => (
            <div className="guide-list-item" key={g.id}>
              <div>
                <a href="#" onClick={(e) => (e.preventDefault(), navigate(`/guides/${g.id}`))}>
                  {g.title}
                </a>{" "}
                <span className={`badge ${g.status}`}>{g.status}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={g.folder_id ?? UNFILED}
                  onChange={(e) => moveGuide(g.id, e.target.value)}
                  title="Move to folder"
                >
                  <option value={UNFILED}>Unfiled</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <button className="btn secondary" onClick={() => removeGuide(g.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
