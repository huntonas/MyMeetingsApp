import { resetDatePicker } from "./native/datetimepicker";
import { setAppVersion } from "./native/expo-application";
import { resetLocation } from "./native/expo-location";
import { resetPlaces } from "./native/native-location";

// Every test starts from a clean slate; later tasks add each fake's reset here as the fake lands.
afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  setAppVersion("0.1.0");
  resetLocation();
  resetPlaces();
  resetDatePicker();
});
