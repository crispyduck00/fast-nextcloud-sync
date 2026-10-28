export interface RecordedRequest {
  method: string;
  url: string;
  depth: string | null;
}

export interface RequestRecorder {
  readonly requests: RecordedRequest[];
  /** Forgets what was recorded so far (recording continues). */
  clear(): void;
  /** Puts the original globalThis.fetch back. */
  restore(): void;
}

function readDepth(headers: unknown): string | null {
  if (typeof headers !== 'object' || headers === null) return null;
  const record = headers as Record<string, unknown>;
  const value = record['Depth'] ?? record['depth'];
  return value === undefined || value === null ? null : String(value);
}

/** Wraps globalThis.fetch (which the b1 obsidian mock's requestUrl calls on every request) and records every request. */
export function recordRequests(): RequestRecorder {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    const init = args[1];
    requests.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: typeof args[0] === 'string' ? args[0] : String(args[0]),
      depth: readDepth(init?.headers),
    });
    return originalFetch(...args);
  }) as typeof fetch;

  return {
    requests,
    clear(): void {
      requests.length = 0;
    },
    restore(): void {
      globalThis.fetch = originalFetch;
    },
  };
}
