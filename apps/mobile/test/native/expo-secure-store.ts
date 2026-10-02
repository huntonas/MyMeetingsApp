// The iOS Keychain, as expo-secure-store gives it to the app: what was saved, with the options it was saved with.
// expo-secure-store's own value on iOS (kSecAttrAccessibleWhenUnlockedThisDeviceOnly).
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

const items = new Map<string, { value: string; options: unknown }>();
let writes = 0;
// "fails": the Keychain can't be read or written (a device error), as opposed to holding nothing.
let trouble: "none" | "fails" = "none";

export function getItemAsync(key: string): Promise<string | null> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  return Promise.resolve(items.get(key)?.value ?? null);
}

export function setItemAsync(key: string, value: string, options?: unknown): Promise<void> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  writes += 1;
  items.set(key, { value, options });
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  items.delete(key);
  return Promise.resolve();
}

export const keychainItem = (key: string) => items.get(key);
export const keychainWrites = () => writes;
export function setKeychainItem(key: string, value: string): void {
  items.set(key, { value, options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } });
}
export function setKeychainTrouble(next: typeof trouble): void {
  trouble = next;
}
export function resetSecureStore(): void {
  items.clear();
  writes = 0;
  trouble = "none";
}
