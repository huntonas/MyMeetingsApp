// The local module @modules/native-location (the platform geocoder). Tests say what each text resolves to.
const places = new Map<string, unknown>();
export const lookups: string[] = [];

export function setPlace(text: string, answer: unknown): void {
  places.set(text, answer);
}

export function resetPlaces(): void {
  places.clear();
  lookups.length = 0;
}

export default {
  findPlace(text: string): Promise<unknown> {
    lookups.push(text);
    return Promise.resolve(places.get(text) ?? null);
  },
};
