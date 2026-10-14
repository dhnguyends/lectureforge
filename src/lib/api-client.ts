/** Browser-side fetch helpers that surface the server's error message. */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    // fetch only rejects when no response arrived: server down, offline, or blocked.
    throw new ApiClientError(0, "network", "Can't reach the LectureForge server. Check your connection (or that the app is running) and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    const fieldMessage = Array.isArray(err?.details) ? err.details[0]?.message : undefined;
    throw new ApiClientError(res.status, err?.code ?? "error", fieldMessage ?? err?.message ?? `Request failed (${res.status})`, err?.requestId);
  }
  return body as T;
}
