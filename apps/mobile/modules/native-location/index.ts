import { requireNativeModule } from "expo";

// Answers are checked in JavaScript (src/location/find-place.ts, attendance.ts), so they're typed as unknown here.
interface NativeLocationModule {
  findPlace(text: string): Promise<unknown>;
  // iOS only (src/location/attendance.ts); Android asks again through expo-location instead.
  requestTemporaryFullAccuracy(purposeKey: string): Promise<unknown>;
}

export default requireNativeModule<NativeLocationModule>("NativeLocation");
