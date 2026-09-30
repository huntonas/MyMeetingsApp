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
