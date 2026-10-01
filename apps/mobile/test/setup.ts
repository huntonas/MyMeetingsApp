import { act } from "react";

import { resetDatePicker } from "./native/datetimepicker";
import { setAndroidId, setAppVersion } from "./native/expo-application";
import { resetLocation } from "./native/expo-location";
import { resetSecureStore } from "./native/expo-secure-store";
import { resetPlaces } from "./native/native-location";

// Every test starts from a clean slate; later tasks add each fake's reset here as the fake lands.
afterEach(async () => {
  jest.useRealTimers();
  // The one allowed drain (docs/standards.md). FlatList batches cell renders on a 50 ms timer, which can fire after a
  // test's last await but before RNTL's cleanup unmounts the screen: an update outside act(). This file's hooks are
  // registered before RNTL's (test files import it afterwards), so they run first and let that timer land inside act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});

beforeEach(() => {
  setAppVersion("0.1.0");
  setAndroidId();
  resetSecureStore();
  resetLocation();
  resetPlaces();
  resetDatePicker();
});
