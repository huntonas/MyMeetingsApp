// The installed app's version, as expo-application reports it. Tests change it with setAppVersion.
export let nativeApplicationVersion: string | null = "0.1.0";

export function setAppVersion(version: string | null): void {
  nativeApplicationVersion = version;
}

// ANDROID_ID, as Android reports it for this app (16 hex digits). Tests change it with setAndroidId.
const ANDROID_ID = "dd96dec43fb81c97";
let androidId = ANDROID_ID;
export function getAndroidId(): string {
  return androidId;
}
export function setAndroidId(next: string = ANDROID_ID): void {
  androidId = next;
}
