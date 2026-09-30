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
