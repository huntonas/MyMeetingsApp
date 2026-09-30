// Fakes the clock only: timers, promises and sockets stay real, so HTTP tests keep working.
export const CLOCK_ONLY: FakeTimersConfig = {
  doNotFake: [
    "hrtime",
    "nextTick",
    "performance",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
    "cancelIdleCallback",
    "setImmediate",
    "clearImmediate",
    "setInterval",
    "clearInterval",
    "setTimeout",
    "clearTimeout",
  ],
};

// The opposite of CLOCK_ONLY: fakes only setTimeout/clearTimeout, so a test can advance a request timeout (built on
// setTimeout in @/api/client) without faking Date or anything a real HTTP round trip depends on.
export const TIMEOUT_ONLY: FakeTimersConfig = {
  doNotFake: [
    "Date",
    "hrtime",
    "nextTick",
    "performance",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
    "cancelIdleCallback",
    "setImmediate",
    "clearImmediate",
    "setInterval",
    "clearInterval",
  ],
};

// CLOCK_ONLY plus setInterval/clearInterval, so a test can move a screen's minute tick on with
// jest.advanceTimersByTime while requests (built on setTimeout) and RNTL's waits stay real.
export const CLOCK_AND_INTERVALS: FakeTimersConfig = {
  doNotFake: (CLOCK_ONLY.doNotFake ?? []).filter(
    (name) => name !== "setInterval" && name !== "clearInterval",
  ),
};

// Sets "now" for a test, with only the clock faked (CLOCK_ONLY): timers, promises and sockets stay real.
export function setNow(iso: string): void {
  jest.useFakeTimers({ now: new Date(iso), ...CLOCK_ONLY });
}
