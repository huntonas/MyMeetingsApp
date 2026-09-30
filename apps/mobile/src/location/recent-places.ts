import { z } from "zod";

import { forgetLastSearch } from "@/cache/store";
import { appDatabase, inTransaction } from "@/db/database";
import { type LatLng, roundForSearch } from "@/location/geo";

export type RecentPlace = LatLng & { label: string };

const KEEP = 10;
const Row = z.object({ label: z.string(), latitude: z.number(), longitude: z.number() });

// Spec §8: recent searched places stay on the phone. Only the rounded point is kept: it's all a later search sends,
// and a typed home address is then never stored more precisely than about 1 km.
export async function rememberPlace(label: string, point: LatLng): Promise<void> {
  const { latitude, longitude } = roundForSearch(point);
  await inTransaction(async (db) => {
    // `label` collates without case, so "place 3" replaces "Place 3" and the newest spelling is kept.
    await db.runAsync("delete from recent_places where label = ?", [label]);
    await db.runAsync("insert into recent_places (label, latitude, longitude, used_at) values (?, ?, ?, ?)", [
      label,
      latitude,
      longitude,
      Date.now(),
    ]);
    await db.runAsync(
      "delete from recent_places where rowid not in (select rowid from recent_places order by used_at desc, rowid desc limit ?)",
      [KEEP],
    );
  });
}

// Newest first, at most KEEP.
export async function recentPlaces(): Promise<RecentPlace[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select label, latitude, longitude from recent_places order by used_at desc, rowid desc",
    [],
  );
  return z.array(Row).parse(rows);
}

// Also forgets the last search, which keeps its typed label too, in the same transaction: afterwards nothing the
// person typed stays on the phone.
export function forgetRecentPlaces(): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync("delete from recent_places", []);
    await forgetLastSearch(db);
  });
}
