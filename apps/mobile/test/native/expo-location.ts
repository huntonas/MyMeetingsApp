type Status = "granted" | "denied" | "undetermined";

const NASHVILLE = { latitude: 36.162749, longitude: -86.781602 };

let status: Status = "undetermined";
// What the person taps when the permission dialog appears.
let answer: "granted" | "denied" = "granted";
let position: { latitude: number; longitude: number } | "fails" = NASHVILLE;
let requests = 0;
let reads = 0;

export const Accuracy = { Balanced: 3 } as const;

export function setPermissionAnswer(next: "granted" | "denied"): void {
  answer = next;
}
export function setLocationPermission(next: Status): void {
  status = next;
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
  return reads;
}
export function resetLocation(): void {
  status = "undetermined";
  answer = "granted";
  position = NASHVILLE;
  requests = 0;
  reads = 0;
}

const response = () => ({ status, granted: status === "granted", canAskAgain: true, expires: "never" });

export function getForegroundPermissionsAsync() {
  return Promise.resolve(response());
}

export function requestForegroundPermissionsAsync() {
  requests += 1;
  if (status === "undetermined") status = answer;
  return Promise.resolve(response());
}

// Like the real module, this answers whatever the permission; the app must not ask without it.
export function getCurrentPositionAsync() {
  reads += 1;
  if (position === "fails") return Promise.reject(new Error("Location unavailable"));
  return Promise.resolve({ coords: { ...position, accuracy: 20 }, timestamp: Date.now() });
}
