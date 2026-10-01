const MILES_PER_KM = 0.621371;

// A US app: distances in miles, one decimal below 10.
export function milesLabel(km: number): string {
  const miles = km * MILES_PER_KM;
  if (miles < 0.1) return "under 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${String(Math.round(miles))} mi`;
}

export function radiusMiles(km: number): number {
  return Math.round(km * MILES_PER_KM);
}
