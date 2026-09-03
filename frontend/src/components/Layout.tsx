import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth";

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>SOP-Hub</h1>
        <nav>
          <Link to="/">Guides</Link>
          <Link to="/settings">AI Settings</Link>
        </nav>
        <div style={{ marginTop: 40, fontSize: 13, color: "var(--muted)" }}>
          <div>{user?.name}</div>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
