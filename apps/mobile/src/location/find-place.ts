import NativeLocation from "@modules/native-location";
import { z } from "zod";

import type { LatLng } from "@/location/geo";
import { withinTimeLimit } from "@/location/time-limit";

const Answer = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .nullish();

// Spec §8: the phone sends the text to its platform geocoder (Apple's, or Google's on Android) to find the place.
// Our server never sees the text, only the rounded point. A geocoder that fails or takes over 15 seconds finds
// nothing, as "not found" does; an answer off the globe is a native bug and throws.
export async function findPlace(text: string): Promise<LatLng | null> {
  const query = text.trim();
  if (query.length === 0) return null;
  let answer: unknown;
  try {
    answer = await withinTimeLimit(NativeLocation.findPlace(query));
  } catch {
    return null;
  }
  return Answer.parse(answer) ?? null;
}
