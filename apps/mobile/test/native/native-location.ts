// The local module @modules/native-location (the platform geocoder). Tests say what each text resolves to.
const places = new Map<string, unknown>();
export const lookups: string[] = [];
// The geocoder's own failures: an error (say, no network), or no answer at all.
let trouble: "none" | "fails" | "hangs" = "none";

export function setPlace(text: string, answer: unknown): void {
  places.set(text, answer);
}

export function setGeocoderTrouble(next: typeof trouble): void {
  trouble = next;
}

export function resetPlaces(): void {
  places.clear();
  lookups.length = 0;
  trouble = "none";
}

export default {
  findPlace(text: string): Promise<unknown> {
    lookups.push(text);
    if (trouble === "fails") return Promise.reject(new Error("Geocoder unavailable"));
    if (trouble === "hangs") return new Promise<never>(() => undefined);
    return Promise.resolve(places.has(text) ? places.get(text) : null);
  },
};
