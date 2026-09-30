import NativeLocation from "@modules/native-location";
import { z } from "zod";

import type { LatLng } from "@/location/geo";

const Answer = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .nullable();

// Spec §8: the platform geocoder (Apple's CLGeocoder, Android's Geocoder) turns the text into a point on the phone.
// Our server never receives the text, only the rounded point. An answer off the globe is a native bug and throws.
export async function findPlace(text: string): Promise<LatLng | null> {
  const query = text.trim();
  if (query.length === 0) return null;
  return Answer.parse(await NativeLocation.findPlace(query));
}
