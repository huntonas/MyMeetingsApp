// The installed app's version, as expo-application reports it. Tests change it with setAppVersion.
export let nativeApplicationVersion: string | null = "0.1.0";

export function setAppVersion(version: string | null): void {
  nativeApplicationVersion = version;
}
