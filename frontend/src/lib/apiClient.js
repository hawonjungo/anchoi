import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * apiFetch(path, init, opts)
 * - path: "/spots"
 * - opts.auth: default true (attach Authorization Bearer <access_token>)
 */
export async function apiFetch(path, init = {}, opts = { auth: true }) {
  if (!API_BASE_URL) {
    throw new Error("Missing VITE_API_BASE_URL");
  }

  const headers = new Headers(init.headers || {});

  if (opts.auth) {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString?.();
    if (!token) throw new Error("Not signed in (missing access token)");
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Default JSON content-type when sending a body
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}