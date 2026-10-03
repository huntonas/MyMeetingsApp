const REQUEST_INTERVAL_MS = 1000;

// Resolves once the clock reads `time`. A timer can wake a millisecond early by the clock's reckoning, so it checks.
async function sleepUntil(time: number): Promise<void> {
  while (Date.now() < time) await new Promise((resolve) => setTimeout(resolve, time - Date.now()));
}

// Spec §3 politeness: at most one request per second to any host during a sync run. Each host's requests take turns,
// and each waits a second from when the one before it actually went, so a turn that went late (a busy event loop)
// never shortens the next one's wait.
export function createHostThrottle() {
  const lastWent = new Map<string, Promise<number>>();
  return {
    async wait(host: string): Promise<void> {
      const went = (lastWent.get(host) ?? Promise.resolve(-Infinity)).then(async (last) => {
        await sleepUntil(last + REQUEST_INTERVAL_MS);
        return Date.now();
      });
      lastWent.set(host, went);
      await went;
    },
  };
}

export type HostThrottle = ReturnType<typeof createHostThrottle>;
