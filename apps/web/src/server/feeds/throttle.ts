const REQUEST_INTERVAL_MS = 1000;

// Spec §3 politeness: at most one request per second to any host during a sync run.
export function createHostThrottle() {
  const nextAllowed = new Map<string, number>();
  return {
    async wait(host: string): Promise<void> {
      const now = Date.now();
      const at = Math.max(now, nextAllowed.get(host) ?? 0);
      nextAllowed.set(host, at + REQUEST_INTERVAL_MS);
      if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
    },
  };
}

export type HostThrottle = ReturnType<typeof createHostThrottle>;
