import { requireNativeModule } from "expo";

// The answer is checked in JavaScript (src/location/find-place.ts), so it's typed as unknown here.
interface NativeLocationModule {
  findPlace(text: string): Promise<unknown>;
}

export default requireNativeModule<NativeLocationModule>("NativeLocation");
