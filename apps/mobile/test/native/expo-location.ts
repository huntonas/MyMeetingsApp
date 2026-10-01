type Status = "granted" | "denied" | "undetermined";

const NASHVILLE = { latitude: 36.162749, longitude: -86.781602 };

let status: Status = "undetermined";
let canAskAgain = true;
// What the person does when the permission dialog appears: allow, deny, or dismiss it (which leaves it undecided).
let answer: "granted" | "denied" | "dismissed" = "granted";
// Whether the person shares precise location (iOS "Precise: On", Android "Precise"), and what they choose when an
// Android app that has only approximate location asks again.
let precise = true;
let preciseAnswer = true;
interface Point {
  latitude: number;
  longitude: number;
  // The fix's own accuracy in metres; 20 unless a test says otherwise.
  accuracy?: number;
}
// Where the phone is, or that it can't find itself ("fails") or never answers ("hangs", say no GPS fix indoors). A
// promise answers when the test resolves it, as a slow GPS fix does.
let position: Point | Promise<Point> | "fails" | "hangs" = NASHVILLE;
let delivered = 0;
let requests = 0;
let checks = 0;
let reads: unknown[] = [];

export const Accuracy = { Balanced: 3, High: 4 } as const;

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
// The permission's accuracy: full (iOS) / fine (Android) when true, reduced / coarse when false.
export function setPrecise(next: boolean): void {
  precise = next;
}
// What the person picks when Android asks again for precise location.
export function setPreciseAnswer(next: boolean): void {
  preciseAnswer = next;
}
// How many times the app showed (or tried to show) the permission dialog.
export function permissionRequests(): number {
  return requests;
}
// How many times the app looked at the permission without asking for it.
export function permissionChecks(): number {
  return checks;
}
// How many position answers the phone has handed back to the app, so a test can wait for a slow one to arrive.
export function positionsDelivered(): number {
  return delivered;
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
  precise = true;
  preciseAnswer = true;
  position = NASHVILLE;
  requests = 0;
  checks = 0;
  delivered = 0;
  reads = [];
}

const response = () => ({
  status,
  granted: status === "granted",
  canAskAgain,
  expires: "never",
  ios: { scope: "whenInUse", accuracy: precise ? "full" : "reduced" },
  android: { accuracy: precise ? "fine" : "coarse" },
});

export function getForegroundPermissionsAsync() {
  checks += 1;
  return Promise.resolve(response());
}

export function requestForegroundPermissionsAsync() {
  requests += 1;
  // Asked again with only approximate location, Android offers to upgrade it to precise.
  if (status === "granted" && !precise) precise = preciseAnswer;
  if (status === "undetermined" && canAskAgain && answer !== "dismissed") status = answer;
  return Promise.resolve(response());
}

// Like the real module, this answers whatever the permission; the app must not ask without it.
export function getCurrentPositionAsync(options: unknown) {
  reads.push(options);
  if (position === "fails") return Promise.reject(new Error("Location unavailable"));
  if (position === "hangs") return new Promise<never>(() => undefined);
  return Promise.resolve(position).then((point) => {
    delivered += 1;
    return { coords: { accuracy: 20, ...point }, timestamp: Date.now() };
  });
}
