/** A rejected API request, carrying the backend's `detail` when it sent one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `SeaShield API request failed (${status})`);
    this.name = "ApiRequestError";
    this.status = status;
    this.detail = detail;
  }
}

/** Reads the backend's error `detail` (FastAPI's `{ "detail": "..." }`); null when there is none. */
export function errorDetail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("detail" in body)) return null;
  const { detail } = body as { detail: unknown };
  return typeof detail === "string" && detail.trim() ? detail : null;
}

export function describeWriteFailure(action: string, cause: unknown) {
  const title = `${action} failed`;
  if (cause instanceof ApiRequestError) {
    return { title, description: `${cause.message}. The change was not saved.` };
  }
  // fetch rejects with a TypeError when the backend cannot be reached at all.
  if (cause instanceof TypeError) {
    return { title, description: "The backend could not be reached. The change was not saved." };
  }
  if (cause instanceof Error && cause.message) {
    return { title, description: `${cause.message}. The change was not saved.` };
  }
  return { title, description: "The change was not saved." };
}

/**
 * Applies a local change immediately, then sends it. If sending fails, the local change is undone, the failure
 * is reported, and the state is re-fetched from the backend, which is authoritative. Never fails silently.
 */
export async function optimisticWrite(steps: {
  apply: () => () => void;
  send: () => Promise<unknown>;
  report: (cause: unknown) => void;
  reconcile: () => Promise<unknown>;
}): Promise<boolean> {
  const undo = steps.apply();
  try {
    await steps.send();
    return true;
  } catch (cause) {
    undo();
    steps.report(cause);
    await steps.reconcile();
    return false;
  }
}
