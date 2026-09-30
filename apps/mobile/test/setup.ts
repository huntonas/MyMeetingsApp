import { setAppVersion } from "./native/expo-application";

// Every test starts from a clean slate; later tasks add each fake's reset here as the fake lands.
afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  setAppVersion("0.1.0");
});
