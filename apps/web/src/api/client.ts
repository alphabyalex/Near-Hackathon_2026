import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "@spendgym/schemas";

export class ApiRequestError extends Error {}

async function parse<T>(res: Response): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError((body as ApiError | null)?.message ?? `The API returned status ${res.status}.`);
  }
  return body as T;
}

export const apiGet = async <T,>(path: string): Promise<T> => parse<T>(await fetch(`/api${path}`));
export const apiPost = async <T,>(path: string): Promise<T> => parse<T>(await fetch(`/api${path}`, { method: "POST" }));

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
