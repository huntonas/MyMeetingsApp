type Status = "granted" | "denied" | "undetermined";

const NASHVILLE = { latitude: 36.162749, longitude: -86.781602 };

let status: Status = "undetermined";
let canAskAgain = true;
// What the person does when the permission dialog appears: allow, deny, or dismiss it (which leaves it undecided).
let answer: "granted" | "denied" | "dismissed" = "granted";
// Where the phone is, or that it can't find itself ("fails") or never answers ("hangs", say no GPS fix indoors).
let position: { latitude: number; longitude: number } | "fails" | "hangs" = NASHVILLE;
let requests = 0;
let reads: unknown[] = [];

export const Accuracy = { Balanced: 3 } as const;

export function setPermissionAnswer(next: typeof answer): void {
  answer = next;
}
export function setLocationPermission(next: Status): void {
  status = next;
}
// false: the person chose "don't ask again" (Android) or denied before (iOS), so no dialog can appear.
export function setCanAskAgain(next: boolean): void {
  canAskAgain = next;
}
export function setDevicePosition(next: typeof position): void {
  position = next;
}
// How many times the app showed (or tried to show) the permission dialog.
export function permissionRequests(): number {
  return requests;
}
// How many times the app asked the phone where it is.
export function positionReads(): number {
  return reads.length;
}
// The options each position read was given, oldest first.
export function positionOptions(): unknown[] {
  return reads;
}
export function resetLocation(): void {
  status = "undetermined";
  canAskAgain = true;
  answer = "granted";
  position = NASHVILLE;
  requests = 0;
  reads = [];
}

const response = () => ({ status, granted: status === "granted", canAskAgain, expires: "never" });

export function getForegroundPermissionsAsync() {
  return Promise.resolve(response());
}

export function requestForegroundPermissionsAsync() {
  requests += 1;
  if (status === "undetermined" && canAskAgain && answer !== "dismissed") status = answer;
  return Promise.resolve(response());
}

// Like the real module, this answers whatever the permission; the app must not ask without it.
export function getCurrentPositionAsync(options: unknown) {
  reads.push(options);
  if (position === "fails") return Promise.reject(new Error("Location unavailable"));
  if (position === "hangs") return new Promise<never>(() => undefined);
  return Promise.resolve({ coords: { ...position, accuracy: 20 }, timestamp: Date.now() });
}
