import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api/client";

interface User {
  id: string;
  email: string;
  name: string;
}
interface Workspace {
  id: string;
  name: string;
}

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("sophub_token");
    const savedUser = localStorage.getItem("sophub_user");
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      api.get<{ workspaces: Workspace[] }>("/workspaces").then((r) => setWorkspace(r.workspaces[0] ?? null));
    }
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    persist(res.token, res.user);
    const ws = await api.get<{ workspaces: Workspace[] }>("/workspaces");
    setWorkspace(ws.workspaces[0] ?? null);
  }

  async function register(email: string, password: string, name: string) {
    const res = await api.post<{ token: string; user: User; workspace: Workspace }>("/auth/register", {
      email,
      password,
      name,
    });
    persist(res.token, res.user);
    setWorkspace(res.workspace);
  }

  function persist(token: string, user: User) {
    localStorage.setItem("sophub_token", token);
    localStorage.setItem("sophub_user", JSON.stringify(user));
    setUser(user);
  }

  function logout() {
    localStorage.removeItem("sophub_token");
    localStorage.removeItem("sophub_user");
    setUser(null);
    setWorkspace(null);
  }

  return <AuthContext.Provider value={{ user, workspace, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
