import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "@redline/schemas";
import { API_BASE, OWNER_BASE } from "../config";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Fired when an owner call comes back 401, so the dashboard can show sign-in again. */
export const SIGNED_OUT_EVENT = "redline:signed-out";

const OWNER_PREFIX = "/owner";

/** "/owner/..." goes to the owner routes, anything else to the public API. */
function urlFor(path: string): { url: string; owner: boolean } {
  if (path === OWNER_PREFIX || path.startsWith(`${OWNER_PREFIX}/`)) return { url: `${OWNER_BASE}${path.slice(OWNER_PREFIX.length)}`, owner: true };
  return { url: `${API_BASE}${path}`, owner: false };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, owner } = urlFor(path);
  const res = await fetch(url, owner ? { ...init, credentials: "include" } : init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body as (ApiError & { error?: string }) | null;
    if (owner && res.status === 401 && !path.startsWith(`${OWNER_PREFIX}/auth/`)) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiRequestError(error?.message ?? `The API returned status ${res.status}.`, res.status, error?.error ?? null);
  }
  return body as T;
}

export const apiGet = <T,>(path: string): Promise<T> => request<T>(path);
export const apiPost = <T,>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

/** Refetches when path or version changes, keeping the old data on screen while it loads. */
export function useApi<T>(path: string | null, version = 0): Loaded<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({ path: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    apiGet<T>(path).then(
      (data) => {
        if (!cancelled) setState({ path, data, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setState({ path, data: null, error: error instanceof Error ? error.message : "Request failed." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, tick, version]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : null, reload };
}
