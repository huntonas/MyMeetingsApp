import { setPrecise } from "./expo-location";

// The local module @modules/native-location (the platform geocoder, and iOS's temporary full accuracy). Tests say what
// each text resolves to.
const places = new Map<string, unknown>();
export const lookups: string[] = [];
// The texts whose answers the geocoder has handed back, so a test can wait for a slow one (a promise given to
// setPlace) to arrive.
export const answered: string[] = [];
// The geocoder's own failures: an error (say, no network), or no answer at all.
let trouble: "none" | "fails" | "hangs" = "none";

// The purpose keys the app asked iOS for temporary full accuracy with, oldest first, and what the person answers (or
// that the request itself fails).
export const temporaryAccuracyRequests: string[] = [];
let temporaryAnswer: boolean | "fails" = true;

export function setTemporaryAccuracyAnswer(next: typeof temporaryAnswer): void {
  temporaryAnswer = next;
}

export function setPlace(text: string, answer: unknown): void {
  places.set(text, answer);
}

export function setGeocoderTrouble(next: typeof trouble): void {
  trouble = next;
}

export function resetPlaces(): void {
  places.clear();
  lookups.length = 0;
  answered.length = 0;
  trouble = "none";
  temporaryAccuracyRequests.length = 0;
  temporaryAnswer = true;
}

export default {
  findPlace(text: string): Promise<unknown> {
    lookups.push(text);
    if (trouble === "fails") return Promise.reject(new Error("Geocoder unavailable"));
    if (trouble === "hangs") return new Promise<never>(() => undefined);
    return Promise.resolve(places.has(text) ? places.get(text) : null).then((answer) => {
      answered.push(text);
      return answer;
    });
  },
  // Allowing it turns the permission's accuracy to full until the app leaves the foreground.
  requestTemporaryFullAccuracy(purposeKey: string): Promise<unknown> {
    temporaryAccuracyRequests.push(purposeKey);
    if (temporaryAnswer === "fails") return Promise.reject(new Error("Location services unavailable"));
    if (temporaryAnswer) setPrecise(true);
    return Promise.resolve(temporaryAnswer);
  },
};
