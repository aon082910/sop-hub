// Empty string = same-origin relative requests (the production single-container
// image serves the API and the built frontend from the same port). Local dev via
// `npm run dev` sets VITE_API_BASE_URL to point at a separately-running backend.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("sophub_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  base: API_BASE_URL,

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r));
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${API_BASE_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r));
  },

  get<T>(path: string): Promise<T> {
    return fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() }).then((r) => handle<T>(r));
  },

  del<T>(path: string): Promise<T> {
    return fetch(`${API_BASE_URL}${path}`, { method: "DELETE", headers: authHeaders() }).then((r) => handle<T>(r));
  },

  upload<T>(path: string, formData: FormData): Promise<T> {
    return fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    }).then((r) => handle<T>(r));
  },
};
