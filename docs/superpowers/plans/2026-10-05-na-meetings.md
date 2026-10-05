# NA Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List NA meetings beside AA meetings: read every U.S. NA region's BMLT server, keep a fellowship on every feed and meeting, never merge across fellowships, serve both through `/api/v2`, and ship app 1.1 with fellowship labels, a Fellowship filter and NA's own format names.

**Architecture:**

- **Fellowship on feeds and meetings.** `feeds.fellowship` and `meetings.fellowship` (`aa` | `na`), set when a meeting is made from its feed. `sidesMatch` requires the same fellowship, so the matcher, the merge pass and the split pass never join an AA and an NA meeting.
- **BMLT as a second feed format.** `feeds.format` is `meeting_guide` (every feed today) or `bmlt`. The sync reads a BMLT feed's answer with `normalizeBmlt`, which maps BMLT's fields, and its formats by NAWS `world_id`, onto `FeedMeeting`. Everything after normalizing (matching, the shrink guard, opt-outs, waiting, geocoding, time zones) is unchanged.
- **`/api/v2` for meetings.** The 1.0 app sends no version on reads and parses types with a fixed enum, and details and online meetings are CDN-cached by URL. So new routes under `/api/v2/meetings` serve every fellowship with open-ended `types` and `fellowship`; the `/api/v1` routes keep their frozen contract (renamed `V1…`) and serve AA meetings only, filtered in SQL.
- **The app (1.1)** reads v2, labels each meeting with its fellowship, adds a Fellowship filter group, and offers only the types and fellowships the latest answer holds.
- **Discovery** gains `discover:na`: the aggregator's server list, one registry entry per U.S. root server.

**Tech Stack:** Next.js 16 route handlers, Drizzle and Postgres (PostGIS) in `apps/web`; zod contracts in `packages/shared`; `packages/feed-kit` (registry, polite fetch); `tools/feed-discovery`; Expo SDK 57 app in `apps/mobile` (Jest, React Native Testing Library); vitest elsewhere.

**Spec:** `docs/superpowers/specs/2026-10-05-na-meetings-design.md`. Read it with `SPEC.md` (§1, §3, §4, §7, §8, §9, §11, §13, §15) and `docs/standards.md` (binding: test first, one way to do each thing, no dead code).

**Depends on:** `main` at `fe8472e` (PR #29). Branch: `na-meetings`.

## Findings (with evidence)

1. **BMLT 4.x has no Meeting Guide endpoint.** `https://natennessee.org/main_server/client_interface/tsml/?switcher=GetSearchResults` answers 422 ("Invalid data format or endpoint name"), so Phase 2's plan (fetch BMLT through `client_interface/tsml/`) no longer works. `client_interface/json/?switcher=GetSearchResults&get_used_formats=1` answers `{ meetings: [...], formats: [...] }` in one request (Tennessee: 462 meetings, 39 formats).
2. **Format letters vary by server; `world_id` doesn't.** Tennessee's `GetFormats` has `BT` → world_id `BT`, `JT` → `JFT`, `SG` → `SWG`, `Spe` → `SPK`, `H` → `WCHR`, `CW` → `CW`. The plan maps by `world_id`.
3. **Real data quirks.** Tennessee leaves `time_zone` blank on all 462 meetings. Texas–Oklahoma (2,006 meetings) leaves `location_province` blank on some rows and names states as codes; Southern California writes some as `"California"`. `location_nation` is `"USA"`, `"us"` or blank. `root_server_uri` is `https://natennessee.org/main_server` (no trailing slash) on the server and `…/main_server/` on the aggregator. Largest answer seen: 1.2 MB, well under `readBodyCapped`'s 50 MB.
4. **Reads carry no version.** `apps/mobile/src/api/client.ts:89` ("Reads send nothing that identifies the phone") and `packages/shared/src/devices.ts:9`. Detail (`meetingDetail`, `s-maxage=300`) and online (`onlineMeetings`, `s-maxage=900`) are CDN-cached; nothing sets `Vary`. So the version gate is a URL (`/api/v2`), as for the vocabulary (`apps/web/src/app/api/v2/vocabulary/route.ts`).
5. **The 1.0 app fails a whole read on one unknown type.** `MeetingSummary.types` is `z.array(z.enum(MEETING_TYPE_CODES))`, and `parseReply` (`client.ts:55-63`) turns a mismatch into `Unreachable`.
6. **`jsonResponse` parses with the contract** (`respond.ts:37-47`), so a v1 response holding an NA code would be a server error. v1 filters `fellowship = 'aa'` and narrows types with a guard.
7. **`applyFeedSnapshot` spreads `FeedMeeting` into `feed_meetings`** (`apply-feed.ts:92-95`), so fellowship must not be a `FeedMeeting` field: it comes from the feed.
8. **The filter sheet is its own route** (`src/app/filters.tsx`, a modal) and never sees the answer, so Nearby passes what the answer holds through the filters context.
9. **The aa.org discovery run drops entries it didn't find** (`report.ts:45-46, 72`, except opt-outs), so it must carry NA entries forward, and `registry-file.ts`'s `orderedKeys` must write `fellowship` or it's lost on write.
10. **The network audit pins the read paths** (`tools/network-audit/src/audit.ts:55-63`).

## Global Constraints

- Fellowships: `FELLOWSHIPS = ["aa", "na"]`; labels "AA" and "NA". Every existing feed and meeting is `aa`.
- NA-only type codes: `BT` "Basic Text", `JFT` "Just for Today", `IW` "It Works: How and Why", `SWG` "Step Working Guide".
- `world_id` → type: OPEN O, CLOSED C, DISC D, SPK SP, STEP ST, BEG BE, W W, M M, Y Y, GL LGBTQ, MED MED, WCHR X, CW CF, LIT LIT, TRAD TR, CAN CAN, BT BT, JFT JFT, IW IW, SWG SWG. TC blocks in person. Anything else is dropped.
- A BMLT feed URL is `<root>client_interface/json/?switcher=GetSearchResults&get_used_formats=1&data_field_key=id_bigint,meeting_name,weekday_tinyint,start_time,duration_time,time_zone,venue_type,formats,location_text,location_info,location_street,location_municipality,location_province,location_postal_code_1,latitude,longitude,virtual_meeting_link,phone_meeting_number,comments,root_server_uri` (`<root>` ends in `/`).
- `/api/v1/meetings/*` keep their contract byte for byte and return AA meetings only. `/api/v2/meetings/*` return every fellowship.
- Reads never send device headers (spec §7). Never log requests, bodies, coordinates or feed content.
- Disclaimer sentence (store listings, terms, footer): "not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc."
- Help line: "Narcotics Anonymous has its own meeting finder at na.org." with button "Open na.org's meeting finder"; `NA_MEETING_FINDER = "https://na.org/meetingsearch/"`.
- App version `1.1.0`.
- Every commit passes `pnpm check`; the branch ends with `pnpm knip:production` and `pnpm --filter web test:e2e` passing.

## Review Focus

1. **A BMLT server answering with other servers' meetings** (an aggregator, or a zonal server listing a region's rows): only rows whose `root_server_uri` is the feed's own root, ignoring a trailing slash, are applied. Test in Task 4.
2. **A meeting running past midnight** (23:30 for 1:00): its end time is 00:30, not refused. Test in Task 4.
3. **An AA and an NA meeting at one church, day and time:** they stay two meetings through new-row matching, the merge pass and the split pass, and v1 search near them returns only the AA one. Tests in Tasks 3 and 5.
4. **App 1.1 opening offline with a saved copy written by 1.0** (no `fellowship`): it still shows, as AA. Test in Task 1 (the contract's default) and Task 7 (the saved Nearby copy).
5. **A person who chose NA, then searches somewhere with no NA meetings:** the NA pill stays offered (chosen pills always are), the list says "No meetings match your filters…", and Clear brings everything back. Test in Task 8.

---

## File Structure

| File                                                                                  | Change | Responsibility                                                     |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `packages/shared/src/meetings.ts`                                                     | Modify | Fellowships, NA type codes, frozen V1 contracts, open v2 contracts |
| `packages/shared/src/help-lines.ts`                                                   | Modify | `NA_MEETING_FINDER`                                                |
| `packages/feed-kit/src/registry.ts`                                                   | Modify | `fellowship`, `region` in the registry schema                      |
| `apps/web/src/db/schema/feeds.ts`, `meetings.ts`                                      | Modify | `fellowship`, `format`, `region`                                   |
| `apps/web/drizzle/0026_…`, `0027_…`                                                   | Create | Migrations                                                         |
| `apps/web/src/db/upsert-feed.ts`, `seed-feeds.ts`                                     | Modify | Fellowship and format from the registry                            |
| `apps/web/src/server/meetings/match.ts`, `apply-feed.ts`, `split.ts`                  | Modify | Match only within one fellowship                                   |
| `apps/web/src/server/feeds/normalize-bmlt.ts`                                         | Create | BMLT → `FeedMeeting`                                               |
| `apps/web/src/server/feeds/normalize.ts`                                              | Modify | Export the shared field helpers BMLT reuses                        |
| `apps/web/src/server/sync/run-sync.ts`                                                | Modify | Pick the normalizer by `feed.format`                               |
| `apps/web/src/server/meetings/summary.ts`, `search.ts`, `detail.ts`, `online.ts`      | Modify | `fellowship` column; a fellowship scope                            |
| `apps/web/src/app/api/v1/meetings/*`                                                  | Modify | V1 contracts, AA only                                              |
| `apps/web/src/app/api/v2/meetings/*`                                                  | Create | Every fellowship                                                   |
| `apps/web/src/server/admin/metrics.ts`, `app/metrics/page.tsx`                        | Modify | Counts by fellowship                                               |
| `tools/feed-discovery/src/bmlt.ts`, `na-main.ts`                                      | Create | `discover:na`                                                      |
| `tools/feed-discovery/src/report.ts`, `registry-file.ts`                              | Modify | Carry NA entries; write `fellowship`; coverage per fellowship      |
| `tools/network-audit/src/audit.ts`                                                    | Modify | Allow the v2 read paths                                            |
| `apps/mobile/src/api/reads.ts`                                                        | Modify | Read v2                                                            |
| `apps/mobile/src/meetings/fellowship.ts`                                              | Create | `fellowshipLabel`                                                  |
| `apps/mobile/src/meetings/type-labels.ts`                                             | Modify | NA labels; `typeLabel(code)` for open-ended codes                  |
| `apps/mobile/src/ui/meeting-card.tsx`, `results-map.tsx`, `app/meeting/[id].tsx`      | Modify | Fellowship labels                                                  |
| `apps/mobile/src/search/filters.tsx`, `app/filters.tsx`, `app/(tabs)/index.tsx`       | Modify | Fellowship filter; offered types and fellowships                   |
| `apps/mobile/src/ui/help-resources.tsx`, `apps/web/src/components/help-resources.tsx` | Modify | NA's finder                                                        |
| Website pages, store listings, `docs/app-store.md`, `SPEC.md`                         | Modify | Copy and disclaimers for 1.1                                       |

Two PRs from one branch: **PR 1, the server** (Tasks 1–6, plus Task 9's website half of the Help line), safe to deploy before 1.1 because v1 doesn't change; **PR 2, the app and copy** (Tasks 7–10), released with 1.1 (Task 11).

---

### Task 1: The shared contracts

**Files:**

- Modify: `packages/shared/src/meetings.ts`
- Modify (rename only): every file under `apps/web/src`, `apps/web/test`, `apps/mobile/src`, `apps/mobile/test` that imports `MeetingSummary`, `MeetingSearchResponse`, `OnlineMeetingsResponse` or `MeetingDetailResponse`
- Modify: `apps/web/src/server/feeds/normalize.ts:11`, `apps/web/src/db/schema/meetings.ts:98`
- Modify: `apps/web/src/app/api/v1/meetings/search/route.ts`, `[id]/route.ts`, `online/route.ts`
- Test: `packages/shared/test/meetings.test.ts`

**Interfaces:**

- Produces: `FELLOWSHIPS`, `Fellowship`, `NA_MEETING_TYPE_CODES`, `MeetingTypeCode` (AA ∪ NA codes), `isV1MeetingType(code): code is V1MeetingTypeCode`, the frozen `V1MeetingSummary`, `V1MeetingSearchResponse`, `V1OnlineMeetingsResponse`, `V1MeetingDetailResponse`, and the open `MeetingSummary`, `MeetingSearchResponse`, `OnlineMeetingsResponse`, `MeetingDetailResponse` (`types: string[]`, `fellowship: string`, default `"aa"`).

- [ ] **Step 1: Write the failing tests** (append to `packages/shared/test/meetings.test.ts`, which imports from `../src/index`)

```ts
import { isV1MeetingType, MeetingSummary, NA_MEETING_TYPE_CODES, V1MeetingSummary } from "../src/index";

const AA_MEETING = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Nooners",
  day: 1,
  time: "12:00",
  endTime: null,
  timezone: "America/Chicago",
  types: ["O"],
  attendance: "in_person",
  locationName: null,
  formattedAddress: null,
  latitude: null,
  longitude: null,
  locationNotes: null,
  notes: null,
  groupName: null,
  conferenceUrl: null,
  conferenceUrlNotes: null,
  conferencePhone: null,
  conferencePhoneNotes: null,
  sourceUrl: null,
  tagsDisabled: false,
  tags: [],
};

describe("the v1 meeting contract (builds before 1.1)", () => {
  it("still refuses a type it has never heard of, as 1.0 does", () => {
    expect(V1MeetingSummary.safeParse({ ...AA_MEETING, types: ["JFT"] }).success).toBe(false);
  });

  it("names exactly the v1 types", () => {
    expect(isV1MeetingType("O")).toBe(true);
    expect(isV1MeetingType("JFT")).toBe(false);
  });
});

describe("the v2 meeting contract", () => {
  it("reads a type and a fellowship this build has never heard of", () => {
    expect(MeetingSummary.parse({ ...AA_MEETING, types: ["XYZ"], fellowship: "al-anon" })).toMatchObject({
      types: ["XYZ"],
      fellowship: "al-anon",
    });
  });

  // Review Focus 4: a copy 1.0 saved has no fellowship, and every meeting 1.0 saw was AA's.
  it("reads a 1.0-era meeting, with no fellowship, as AA's", () => {
    expect(MeetingSummary.parse(AA_MEETING).fellowship).toBe("aa");
  });

  it("lists NA's literature formats", () => {
    expect(NA_MEETING_TYPE_CODES).toEqual(["BT", "JFT", "IW", "SWG"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @mymeetingapp/shared test -- meetings`
Expected: FAIL, `isV1MeetingType` and `V1MeetingSummary` are not exported.

- [ ] **Step 3: Write the contracts** in `packages/shared/src/meetings.ts`. Keep `MEETING_TYPE_CODES` exactly as it is. Rename the four existing schemas (and their types) to `V1…`, then add the rest:

```ts
// Spec §1: the fellowships whose meetings the app lists (owner decision, 2026-10-05).
export const FELLOWSHIPS = ["aa", "na"] as const;
export type Fellowship = (typeof FELLOWSHIPS)[number];

// NA's literature formats, which have no Meeting Guide code. BMLT names them by NAWS world_id.
export const NA_MEETING_TYPE_CODES = ["BT", "JFT", "IW", "SWG"] as const;

type V1MeetingTypeCode = (typeof MEETING_TYPE_CODES)[number];
export type MeetingTypeCode = V1MeetingTypeCode | (typeof NA_MEETING_TYPE_CODES)[number];

export function isV1MeetingType(code: string): code is V1MeetingTypeCode {
  return MEETING_TYPE_CODES.some((known) => known === code);
}
```

Rename `export const MeetingSummary = z.object({…})` to `V1MeetingSummary` (and its type), with this comment above it:

```ts
// For builds before 1.1, which refuse a whole answer over a type they don't know: /api/v1/meetings serves only AA
// meetings, through this frozen contract. Remove it once the minimum supported version reads /api/v2.
```

Rename `MeetingSearchResponse`, `OnlineMeetingsResponse` and `MeetingDetailResponse` the same way (`V1MeetingSearchResponse` is `z.object({ meetings: z.array(V1MeetingSummary.extend({ distanceKm: z.number() })) })`, and so on). Then add the open contracts below them:

```ts
// /api/v2: types and fellowships are open-ended, so the server can add one without breaking the apps reading it.
export const MeetingSummary = V1MeetingSummary.extend({
  types: z.array(z.string().min(1).max(20)),
  // A copy 1.0 saved has none, and every meeting 1.0 saw was AA's.
  fellowship: z
    .string()
    .regex(/^[a-z0-9-]{1,20}$/)
    .default("aa"),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export const MeetingSearchResponse = z.object({
  meetings: z.array(MeetingSummary.extend({ distanceKm: z.number() })),
});
export type MeetingSearchResponse = z.infer<typeof MeetingSearchResponse>;

export const OnlineMeetingsResponse = z.object({ meetings: z.array(MeetingSummary) });
export type OnlineMeetingsResponse = z.infer<typeof OnlineMeetingsResponse>;

export const MeetingDetailResponse = z.object({ meeting: MeetingSummary });
export type MeetingDetailResponse = z.infer<typeof MeetingDetailResponse>;
```

- [ ] **Step 4: Point today's readers at the v1 names.** Nothing reads v2 yet, so every current import of the four schemas becomes its `V1` name:

```bash
cd /Users/ahunton/projects/MyMeetingsApp
rg -l '\b(MeetingSummary|MeetingSearchResponse|OnlineMeetingsResponse|MeetingDetailResponse)\b' \
  apps/web/src apps/web/test apps/mobile/src apps/mobile/test tools/network-audit \
  | xargs perl -pi -e 's/(?<![\w])(MeetingSummary|MeetingSearchResponse|OnlineMeetingsResponse|MeetingDetailResponse)\b/V1$1/g'
```

Then in `apps/web/src/server/feeds/normalize.ts` make `FeedMeeting.types` `MeetingTypeCode[]` (import `type MeetingTypeCode`), keep `attendance: V1MeetingSummary["attendance"]`, and in `apps/web/src/db/schema/meetings.ts:98` use `.$type<MeetingTypeCode[]>()`.

In each v1 route, narrow the types (the rows' type is now `MeetingTypeCode[]`; v1's contract takes only v1 codes). In `apps/web/src/app/api/v1/meetings/search/route.ts`:

```ts
import { isV1MeetingType, MeetingSearchRequest, V1MeetingSearchResponse } from "@mymeetingapp/shared";

// For builds before 1.1 (V1MeetingSummary).
export const POST = withErrors(async (req: Request) => {
  const request = await readJsonBody(req, MeetingSearchRequest);
  const meetings = (await searchMeetings(request)).map((meeting) => ({
    ...meeting,
    types: meeting.types.filter(isV1MeetingType),
  }));
  return jsonResponse(V1MeetingSearchResponse, { meetings }, "none");
});
```

Do the same in `[id]/route.ts` (`{ meeting: { ...meeting, types: meeting.types.filter(isV1MeetingType) } }`) and `online/route.ts`.

- [ ] **Step 5: Run everything**

Run: `pnpm check`
Expected: PASS. The renamed v1 contracts are unchanged, so every existing test passes as it was.

- [ ] **Step 6: Commit**

```bash
git add -A packages/shared apps/web apps/mobile tools/network-audit
git commit -m "feat(shared): open v2 meeting contracts beside the frozen v1 ones

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fellowship and format in the database and the registry

**Files:**

- Modify: `apps/web/src/db/schema/feeds.ts`, `apps/web/src/db/schema/meetings.ts`
- Create: `apps/web/drizzle/0026_lock-timeout-fellowship.sql`, `apps/web/drizzle/0027_fellowship.sql` (generated)
- Modify: `packages/feed-kit/src/registry.ts`, `tools/feed-discovery/src/registry-file.ts`
- Modify: `apps/web/src/db/upsert-feed.ts`, `apps/web/src/db/seed-feeds.ts`
- Modify: `apps/web/test/privacy-policy.test.tsx` (the pinned `feeds` and `meetings` columns)
- Test: `apps/web/test/seed-feeds.test.ts`, `tools/feed-discovery/test/registry-file.test.ts`

**Interfaces:**

- Consumes: `FELLOWSHIPS` (Task 1).
- Produces: `feeds.fellowship`, `feeds.format` (`FEED_FORMATS = ["meeting_guide", "bmlt"]`, `FeedFormat`), `meetings.fellowship`; `ENTITY_TYPES` gains `"region"`; `RegistryEntry.fellowship?: Fellowship`; `FeedInput.fellowship?`, `FeedInput.format?`.

- [ ] **Step 1: Write the failing tests.** In `apps/web/test/seed-feeds.test.ts`, beside the other fixtures:

```ts
const naRegion: RegistryEntry = {
  id: "na-volunteer-region",
  name: "Volunteer Region",
  entity_type: "region",
  fellowship: "na",
  state: "TN",
  website: "https://natennessee.org",
  feed_type: "bmlt",
  feed_url:
    "https://natennessee.org/main_server/client_interface/json/?switcher=GetSearchResults&get_used_formats=1",
  verified: true,
  meeting_count: 462,
  states_covered: ["TN"],
  cities_covered: [],
  checked_at: "2026-10-05",
  notes: "",
};
```

and in the `describe`:

```ts
it("seeds a BMLT entry as an NA feed read as BMLT, and every other feed as AA's Meeting Guide", async () => {
  expect(await seedFeedsFromRegistry([verifiedTsml, naRegion])).toEqual({
    upserted: 2,
    optedOut: 0,
    skipped: 0,
  });
  expect(await feedRow("na-volunteer-region")).toMatchObject({
    fellowship: "na",
    format: "bmlt",
    entityType: "region",
    priority: 10,
  });
  expect(await feedRow("tn-intergroup")).toMatchObject({ fellowship: "aa", format: "meeting_guide" });
});
```

In `tools/feed-discovery/test/registry-file.test.ts`, a round trip (use that file's existing temp-dir helper and an entry fixture; `naEntry` is the same shape as `naRegion` above):

```ts
it("writes an NA entry's fellowship, and no fellowship for AA's", async () => {
  await writeRegistry(path, [aaEntry, naEntry]);
  const raw = await readFile(path, "utf-8");
  expect(raw.match(/fellowship: na/g)).toHaveLength(1);
  expect(raw).not.toContain("fellowship: aa");
  expect((await readRegistry(path)).map((entry) => entry.fellowship)).toEqual([undefined, "na"]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter web exec vitest run test/seed-feeds.test.ts` and `pnpm --filter feed-discovery test -- registry-file`
Expected: FAIL, the registry schema refuses `entity_type: "region"` and `fellowship`.

- [ ] **Step 3: The registry.** In `packages/feed-kit/src/registry.ts`, import `FELLOWSHIPS` from `@mymeetingapp/shared`, add `"region"` to `REGISTRY_ENTITY_TYPES`, and after `entity_type`:

```ts
  // Absent means AA: every entry aa.org's directory finds is an AA entity.
  fellowship: z.enum(FELLOWSHIPS).optional(),
```

In `tools/feed-discovery/src/registry-file.ts`, `orderedKeys`, write it right after `entity_type`, only when present:

```ts
    entity_type: entry.entity_type,
    ...(entry.fellowship !== undefined && { fellowship: entry.fellowship }),
```

- [ ] **Step 4: The schema.** In `apps/web/src/db/schema/feeds.ts`:

```ts
import { FELLOWSHIPS } from "@mymeetingapp/shared";

export const ENTITY_TYPES = ["area", "district", "intergroup", "central_office", "region"] as const;

// How a feed's answer is read: Meeting Guide JSON (TSML, Meeting Guide feeds, Google Sheets), or a BMLT server's
// GetSearchResults with its used formats.
export const FEED_FORMATS = ["meeting_guide", "bmlt"] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];
```

columns, after `optedOut`:

```ts
    fellowship: text("fellowship", { enum: FELLOWSHIPS }).notNull().default("aa"),
    format: text("format", { enum: FEED_FORMATS }).notNull().default("meeting_guide"),
```

and checks:

```ts
    check("feeds_fellowship_check", sql`${table.fellowship} in (${sqlStringList(FELLOWSHIPS)})`),
    check("feeds_format_check", sql`${table.format} in (${sqlStringList(FEED_FORMATS)})`),
```

In `apps/web/src/db/schema/meetings.ts`, on `meetings`, after `timezone`:

```ts
    // Spec §3: a meeting is one fellowship's, its feed's, and only matches meetings of the same fellowship.
    fellowship: text("fellowship", { enum: FELLOWSHIPS }).notNull().default("aa"),
```

with `check("meetings_fellowship_check", sql\`${table.fellowship} in (${sqlStringList(FELLOWSHIPS)})\`)`added to its table callback (it has only the index today:`(table) => [index(...), check(...)]`).

Generate the migrations, the lock timeout first, as every earlier schema change did:

```bash
cd apps/web
pnpm exec drizzle-kit generate --custom --name lock-timeout-fellowship
printf "SET LOCAL lock_timeout = '10s';\n" > drizzle/0026_lock-timeout-fellowship.sql
pnpm exec drizzle-kit generate --name fellowship
cat drizzle/0027_fellowship.sql
```

Expected `0027_fellowship.sql`: three `ADD COLUMN … DEFAULT 'aa'/'meeting_guide' NOT NULL`, the `feeds_entity_type_check` drop and re-add with `region`, and the three new checks.

- [ ] **Step 5: Upsert and seed.** In `apps/web/src/db/upsert-feed.ts`: `DEFAULT_PRIORITY` gains `region: 10` (the comment above it says intergroup-level bodies outrank areas; a region is NA's). `FeedInput` gains

```ts
  fellowship: z.enum(FELLOWSHIPS).optional(),
  format: z.enum(FEED_FORMATS).optional(),
```

and the conflict set gains `fellowship: sql\`excluded.fellowship\``, `format: sql\`excluded.format\``. Values default them: `const values = { ...feed, priority: …, fellowship: feed.fellowship ?? "aa", format: feed.format ?? "meeting_guide" };`.

In `apps/web/src/db/seed-feeds.ts`, `isSeedable` accepts a verified BMLT entry:

```ts
function isSeedable(entry: RegistryEntry): entry is SeedableEntry {
  if (entry.feed_url === null) return false;
  if (entry.feed_type === "restricted") return true;
  return (
    entry.verified &&
    (entry.feed_type === "tsml" ||
      entry.feed_type === "meeting_guide_json" ||
      entry.feed_type === "google_sheet" ||
      entry.feed_type === "bmlt")
  );
}
```

(update its comment: "bmlt and none_found entries have no consumer yet" becomes "none_found entries have no consumer"), and the upsert passes

```ts
          fellowship: winner.fellowship ?? "aa",
          format: winner.feed_type === "bmlt" ? "bmlt" : "meeting_guide",
```

- [ ] **Step 6: Pin the new columns** in `apps/web/test/privacy-policy.test.tsx`'s `REFERENCE_TABLES`: `feeds` gains `"fellowship"` and `"format"` after `"opted_out"`, `meetings` gains `"fellowship"` after `"timezone"`. They describe publishers and meetings, never people, so the policy doesn't change.

- [ ] **Step 7: Run everything**

Run: `pnpm check`
Expected: PASS (`check:migrations` finds nothing left to generate).

- [ ] **Step 8: Commit**

```bash
git add -A apps/web packages/feed-kit tools/feed-discovery
git commit -m "feat(feeds): fellowship and format on feeds and meetings, region entities

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Match only within one fellowship

**Files:**

- Modify: `apps/web/src/server/meetings/match.ts`, `apply-feed.ts`, `split.ts`
- Test: `apps/web/test/apply-feed.test.ts`, `apps/web/test/feed-fixtures.ts`

**Interfaces:**

- Consumes: `feeds.fellowship`, `meetings.fellowship` (Task 2).
- Produces: `MatchSide.fellowship: SQL`; `seedFeed(slug, entityType?, fellowship?)` in the test fixtures; new meetings take their feed's fellowship.

- [ ] **Step 1: Let the fixture make an NA feed.** In `apps/web/test/feed-fixtures.ts`:

```ts
export async function seedFeed(
  slug: string,
  entityType: "intergroup" | "area" | "region" = "intergroup",
  fellowship: "aa" | "na" = "aa",
) {
  return upsertFeed({
    slug,
    name: slug,
    entityType,
    state: "TN",
    url: `https://${slug}.example.org/feed`,
    fellowship,
  });
}
```

- [ ] **Step 2: Write the failing tests** in `apps/web/test/apply-feed.test.ts`, `describe("applyFeedSnapshot")`:

```ts
// Review Focus 3.
it("keeps an AA and an NA meeting at one church, day and time apart", async () => {
  const aa = await seedFeed("aa-intergroup");
  const na = await seedFeed("na-region", "region", "na");
  const church = listing("Recovery Is Possible", "34 Oak Tree Dr, McMinnville, TN 37110", 35.7064, -85.8471);
  await applyFeedSnapshot(aa, [feedMeeting(church)]);
  await applyFeedSnapshot(na, [feedMeeting({ ...church, sourceSlug: "1525" })]);
  const stored = await activeMeetings();
  expect(stored.map((meeting) => meeting.fellowship).sort()).toEqual(["aa", "na"]);
});

it("still joins two NA feeds' listings of one meeting", async () => {
  const a = await seedFeed("na-region", "region", "na");
  const b = await seedFeed("na-zone", "region", "na");
  const church = listing(
    "Gift of Desperation",
    "4001 Rossville Blvd, Chattanooga, TN 37407",
    34.9974,
    -85.2917,
  );
  await applyFeedSnapshot(a, [feedMeeting(church)]);
  await applyFeedSnapshot(b, [feedMeeting({ ...church, sourceSlug: "1481" })]);
  expect(await activeMeetings()).toEqual([expect.objectContaining({ fellowship: "na" })]);
});
```

and in `describe("applyFeedSnapshot merging stored duplicates")`:

```ts
it("never merges a stored AA and NA meeting, and a split listing keeps its fellowship", async () => {
  const aa = await seedFeed("a");
  const na = await seedFeed("n", "region", "na");
  await storedMeeting(aa, feedMeeting({ ...heritage, sourceSlug: "heritage-aa" }), "2026-01-01T00:00:00Z");
  await storedMeeting(na, feedMeeting({ ...heritageNearby, sourceSlug: "heritage-na" }));
  await applyFeedSnapshot(na, [feedMeeting({ ...heritageNearby, sourceSlug: "heritage-na" })]);
  expect((await activeMeetings()).map((meeting) => meeting.fellowship).sort()).toEqual(["aa", "na"]);
});
```

`storedMeeting` inserts with `insertMeetingWithSources`, whose new meeting row defaults to `aa`. Make it take the feed's fellowship: in `feed-fixtures.ts`, `insertMeetingWithSources` reads the first source's feed:

```ts
const [feed] = await db
  .select({ fellowship: feeds.fellowship })
  .from(feeds)
  .where(eq(feeds.id, sources[0]?.feedId ?? 0));
const [meeting] = await db
  .insert(meetings)
  .values({
    day: sources[0]?.row.day ?? 1,
    time: sources[0]?.row.time ?? "12:00",
    fellowship: feed?.fellowship ?? "aa",
  })
  .returning();
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter web exec vitest run test/apply-feed.test.ts`
Expected: FAIL. The AA and NA rows join one meeting (the first test finds one meeting, `["aa"]`).

- [ ] **Step 4: Match within one fellowship.** In `apps/web/src/server/meetings/match.ts`, `MatchSide` gains `fellowship: SQL` (document it: "the fellowship of the meeting or feed it comes from"). `meetingSide` gets `fellowship: sql\`${meeting}.fellowship\``, `listingSide` gets

```ts
    fellowship: sql`(select feed.fellowship from feeds feed where feed.id = ${listing}.feed_id)`,
```

and `sidesMatch` starts with the fellowship:

```ts
export function sidesMatch(a: MatchSide, b: MatchSide): SQL {
  return sql`(${a.fellowship} = ${b.fellowship} and ${a.day} = ${b.day} and ${a.time} = ${b.time}
    and not ${mixedGenders(a)} …`;
```

(the rest of the expression is unchanged). Update its comment: "Spec §3: two meetings of different fellowships never match, however alike."

In `apps/web/src/server/meetings/apply-feed.ts`, read the feed's fellowship once, first in the transaction:

```ts
const [feed] = await tx.select({ fellowship: feeds.fellowship }).from(feeds).where(eq(feeds.id, feedId));
if (feed === undefined) throw new Error(`applyFeedSnapshot: no feed ${String(feedId)}`);
```

pass `feed.fellowship` to `findMatchingMeeting(tx, feedId, feed.fellowship, row)`, whose `rowSide` gains `fellowship: sql\`${fellowship}::text\``, and create meetings with it: `.values({ day: row.day, time: row.time, fellowship: feed.fellowship })`.

In `apps/web/src/server/meetings/split.ts`, the detached listing's new meeting is its old meeting's fellowship:

```sql
    with detached as (
      select listing.id, listing.meeting_id from_meeting, listing.day, listing.time, m.fellowship,
        gen_random_uuid() meeting_id
      …
    ),
    created as (
      insert into meetings (id, day, time, fellowship) select meeting_id, day, time, fellowship from detached
    ),
```

- [ ] **Step 5: Run everything**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/meetings apps/web/test/apply-feed.test.ts apps/web/test/feed-fixtures.ts
git commit -m "feat(meetings): never match meetings of different fellowships

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Read BMLT feeds

**Files:**

- Create: `apps/web/src/server/feeds/normalize-bmlt.ts`
- Modify: `apps/web/src/server/feeds/normalize.ts` (export `text`, `clockTime`, `timeZone`, `webUrl`, `point` for reuse; no behavior change)
- Modify: `apps/web/src/server/sync/run-sync.ts`
- Create: `apps/web/test/fixtures/bmlt-tennessee.json`
- Test: `apps/web/test/normalize-bmlt.test.ts`, `apps/web/test/run-sync.test.ts`

**Interfaces:**

- Consumes: `FeedMeeting`, `FeedFormatError` (normalize.ts), `feeds.format` (Task 2), `NA_MEETING_TYPE_CODES` / `MeetingTypeCode` (Task 1).
- Produces: `normalizeBmlt(json: unknown, feedUrl: string): { meetings: FeedMeeting[]; skipped: number }`.

- [ ] **Step 1: The fixture.** Save Tennessee's real answer, then trim it to the rows the tests name:

```bash
cd apps/web && mkdir -p test/fixtures
curl -s -A "mymeetingapp/1.0 (+https://mymeetings.app; admin@goodersoftwarellc.com)" \
  "https://natennessee.org/main_server/client_interface/json/?switcher=GetSearchResults&get_used_formats=1&data_field_key=id_bigint,meeting_name,weekday_tinyint,start_time,duration_time,time_zone,venue_type,formats,location_text,location_info,location_street,location_municipality,location_province,location_postal_code_1,latitude,longitude,virtual_meeting_link,phone_meeting_number,comments,root_server_uri" \
  | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const keep = new Set(["1525", "1481", "985"]);
const meetings = d.meetings.filter((m) => keep.has(m.id_bigint));
const used = new Set(meetings.flatMap((m) => m.formats.split(",")));
const formats = d.formats.filter((f) => used.has(f.key_string) || ["BT", "JT", "SG", "TC", "VM"].includes(f.key_string));
console.log(JSON.stringify({ meetings, formats }, null, 2));' > test/fixtures/bmlt-tennessee.json
```

The test then adds its own edge rows (virtual, hybrid, past midnight, another root) by copying a real row and changing fields, so each case is visible in the test.

- [ ] **Step 2: Write the failing tests** in `apps/web/test/normalize-bmlt.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FeedFormatError } from "@/server/feeds/normalize";
import { normalizeBmlt } from "@/server/feeds/normalize-bmlt";

const FEED = "https://natennessee.org/main_server/client_interface/json/?switcher=GetSearchResults";
const fixture = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "fixtures/bmlt-tennessee.json"), "utf8"),
) as { meetings: Record<string, string>[]; formats: Record<string, string>[] };
const [recovery] = fixture.meetings.filter((row) => row.id_bigint === "1525");
if (recovery === undefined) throw new Error("fixture lost meeting 1525");

const withRows = (...rows: Record<string, string>[]) => ({ meetings: rows, formats: fixture.formats });

describe("normalizeBmlt", () => {
  it("reads a real in-person meeting from Tennessee's server", () => {
    expect(normalizeBmlt(withRows(recovery), FEED).meetings).toEqual([
      {
        sourceSlug: "1525",
        day: 0,
        time: "09:00",
        endTime: "10:00",
        timezone: null,
        name: "Recovery Is Possible",
        types: ["C", "O", "D", "LIT", "X"],
        attendance: "in_person",
        locationName: "Temple Baptist Church",
        formattedAddress: "34 Oak Tree Drive, McMinnville, TN 37110",
        addressKey: expect.any(String),
        latitude: 35.7064197,
        longitude: -85.8471107,
        locationNotes: "(Meeting meets in the basement)",
        notes: null,
        groupName: null,
        conferenceUrl: null,
        conferenceUrlNotes: null,
        conferencePhone: null,
        conferencePhoneNotes: null,
        sourceUrl: null,
      },
    ]);
  });

  it("maps NA's formats by world_id, whatever letters the server uses, and drops the rest", () => {
    const row = { ...recovery, formats: "BT,JT,SG,VM,ZZ" };
    expect(normalizeBmlt(withRows(row), FEED).meetings[0]?.types).toEqual(["BT", "JFT", "SWG"]);
  });

  // Review Focus 2.
  it("ends a meeting that runs past midnight the next morning", () => {
    const late = { ...recovery, start_time: "23:30:00", duration_time: "01:00:00" };
    expect(normalizeBmlt(withRows(late), FEED).meetings[0]).toMatchObject({
      time: "23:30",
      endTime: "00:30",
    });
  });

  it("keeps no address or pin for a virtual meeting, and needs its link", () => {
    const virtual = {
      ...recovery,
      id_bigint: "9001",
      venue_type: "2",
      virtual_meeting_link: "https://zoom.us/j/123456789",
    };
    expect(normalizeBmlt(withRows(virtual), FEED).meetings[0]).toMatchObject({
      attendance: "online",
      formattedAddress: null,
      latitude: null,
      conferenceUrl: "https://zoom.us/j/123456789",
    });
    expect(normalizeBmlt(withRows({ ...virtual, virtual_meeting_link: "" }), FEED)).toEqual({
      meetings: [],
      skipped: 1,
    });
  });

  it("reads a hybrid meeting as hybrid, and one with no link as in person", () => {
    const hybrid = { ...recovery, venue_type: "3", virtual_meeting_link: "https://zoom.us/j/987654321" };
    expect(normalizeBmlt(withRows(hybrid), FEED).meetings[0]?.attendance).toBe("hybrid");
    expect(
      normalizeBmlt(withRows({ ...hybrid, virtual_meeting_link: "" }), FEED).meetings[0]?.attendance,
    ).toBe("in_person");
  });

  it("treats a temporarily closed venue as not in person", () => {
    expect(normalizeBmlt(withRows({ ...recovery, formats: "O,TC" }), FEED).meetings).toEqual([]);
  });

  // Review Focus 1.
  it("applies only this server's own meetings, with or without a trailing slash", () => {
    const own = { ...recovery, root_server_uri: "https://natennessee.org/main_server/" };
    const other = {
      ...recovery,
      id_bigint: "77",
      root_server_uri: "https://texasoklahomana.org/main_server/",
    };
    expect(normalizeBmlt(withRows(own, other), FEED).meetings.map((m) => m.sourceSlug)).toEqual(["1525"]);
  });

  it.each([[[]], [{}], [{ meetings: "x" }], [null]])("rejects %j as not a BMLT answer", (body) => {
    expect(() => normalizeBmlt(body, FEED)).toThrow(FeedFormatError);
  });
});
```

The expected `types` follow the fixture row's `formats`, `"C,O,D,LT,H"`: on Tennessee's server those are world_ids CLOSED, OPEN, DISC, LIT and WCHR, so C, O, D, LIT and X, in that order.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter web exec vitest run test/normalize-bmlt.test.ts`
Expected: FAIL, `normalize-bmlt` doesn't exist.

- [ ] **Step 4: Write the normalizer** in `apps/web/src/server/feeds/normalize-bmlt.ts`. First export, unchanged, from `normalize.ts` the helpers it reuses: `text`, `clockTime`, `timeZone`, `webUrl`, `point`.

```ts
import { addressKey } from "@mymeetingapp/feed-kit";
import type { MeetingTypeCode } from "@mymeetingapp/shared";

import {
  clockTime,
  type FeedMeeting,
  FeedFormatError,
  point,
  text,
  timeZone,
  webUrl,
} from "@/server/feeds/normalize";

type Raw = Record<string, unknown>;

// NAWS's standard format ids (world_id), the same on every server whatever letters it shows. Spec §4 (NA design).
const TYPE_BY_WORLD_ID: Record<string, MeetingTypeCode> = {
  OPEN: "O",
  CLOSED: "C",
  DISC: "D",
  SPK: "SP",
  STEP: "ST",
  BEG: "BE",
  W: "W",
  M: "M",
  Y: "Y",
  GL: "LGBTQ",
  MED: "MED",
  WCHR: "X",
  CW: "CF",
  LIT: "LIT",
  TRAD: "TR",
  CAN: "CAN",
  BT: "BT",
  JFT: "JFT",
  IW: "IW",
  SWG: "SWG",
};
const TEMPORARILY_CLOSED = "TC";
const VENUE = { inPerson: "1", virtual: "2", hybrid: "3" } as const;
const MINUTES_PER_DAY = 24 * 60;

const withoutSlash = (uri: string) => uri.replace(/\/+$/, "");

// The feed's own root server: its URL up to client_interface.
function rootOf(feedUrl: string): string {
  return withoutSlash(feedUrl.slice(0, feedUrl.indexOf("client_interface")));
}

function minutesOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

// BMLT gives a start and a duration; the end may fall after midnight.
function endTime(start: string, duration: string | null): string | null {
  const length = duration === null ? null : clockTime(duration);
  if (length === null || minutesOf(length) === 0) return null;
  const end = (minutesOf(start) + minutesOf(length)) % MINUTES_PER_DAY;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function address(raw: Raw): string | null {
  const stateAndZip = [text(raw.location_province), text(raw.location_postal_code_1)]
    .filter((part) => part !== null)
    .join(" ");
  const parts = [text(raw.location_street), text(raw.location_municipality), text(stateAndZip)].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeRow(raw: Raw, worldIds: Map<string, string>): FeedMeeting | null {
  const sourceSlug = text(raw.id_bigint);
  const name = text(raw.meeting_name);
  const time = clockTime(raw.start_time);
  const weekday = Number(text(raw.weekday_tinyint));
  if (sourceSlug === null || name === null || time === null || !(weekday >= 1 && weekday <= 7)) return null;

  const formats = (text(raw.formats) ?? "").split(",").map((key) => worldIds.get(key.trim()));
  const venue = text(raw.venue_type);
  const conferenceUrl = venue === VENUE.inPerson ? null : webUrl(raw.virtual_meeting_link);
  const conferencePhone = venue === VENUE.inPerson ? null : text(raw.phone_meeting_number);
  const online = conferenceUrl !== null || conferencePhone !== null;
  const formattedAddress = venue === VENUE.virtual ? null : address(raw);
  const location = venue === VENUE.virtual ? null : point(raw);
  const inPerson =
    venue !== VENUE.virtual &&
    !formats.includes(TEMPORARILY_CLOSED) &&
    (formattedAddress !== null || location !== null);
  if (!inPerson && !online) return null;

  return {
    sourceSlug,
    day: weekday - 1,
    time,
    endTime: endTime(time, text(raw.duration_time)),
    timezone: timeZone(raw.time_zone),
    name,
    types: [
      ...new Set(
        formats
          .map((worldId) => (worldId === undefined ? undefined : TYPE_BY_WORLD_ID[worldId]))
          .filter((code) => code !== undefined),
      ),
    ],
    attendance: inPerson ? (online ? "hybrid" : "in_person") : "online",
    locationName: text(raw.location_text),
    formattedAddress,
    addressKey: addressKey(formattedAddress),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    locationNotes: text(raw.location_info),
    notes: text(raw.comments),
    groupName: null,
    conferenceUrl,
    conferenceUrlNotes: null,
    conferencePhone,
    conferencePhoneNotes: null,
    sourceUrl: null,
  };
}

// Spec §3 allowlist, as normalizeFeed: only these fields are read. A BMLT answer with get_used_formats=1 is
// { meetings, formats }; only rows from the feed's own root server are kept, since an aggregator also answers
// for other servers.
export function normalizeBmlt(json: unknown, feedUrl: string): { meetings: FeedMeeting[]; skipped: number } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new FeedFormatError("Feed is not a BMLT answer with meetings and formats");
  }
  const body = json as Raw;
  if (!Array.isArray(body.meetings) || !Array.isArray(body.formats)) {
    throw new FeedFormatError("Feed is not a BMLT answer with meetings and formats");
  }
  const worldIds = new Map<string, string>();
  for (const format of body.formats as unknown[]) {
    if (typeof format !== "object" || format === null) continue;
    const key = text((format as Raw).key_string);
    const worldId = text((format as Raw).world_id);
    if (key !== null && worldId !== null) worldIds.set(key, worldId);
  }
  const root = rootOf(feedUrl);
  const meetings: FeedMeeting[] = [];
  let skipped = 0;
  for (const item of body.meetings as unknown[]) {
    if (typeof item !== "object" || item === null) {
      skipped += 1;
      continue;
    }
    const raw = item as Raw;
    const from = text(raw.root_server_uri);
    if (from !== null && withoutSlash(from) !== root) continue;
    const meeting = normalizeRow(raw, worldIds);
    if (meeting === null) skipped += 1;
    else meetings.push(meeting);
  }
  return { meetings, skipped };
}
```

BMLT sends `latitude` and `longitude` as strings ("35.7064197"); `point` (normalize.ts:99-111, through its `coordinate` helper) must read a numeric string as a number. If it doesn't, extend `coordinate` there, with a test in `normalize.test.ts` ("reads coordinates given as strings"), before this task's tests can pass. `as Raw` on a value already checked to be a non-null object is a cast "on the result of a runtime check", which `docs/standards.md` allows. `clockTime` must accept `HH:MM:SS` (BMLT) as well as `HH:MM`; check `normalize.ts:70-76`, and if it doesn't, extend its regex there with a test in `normalize.test.ts` ("reads a time with seconds").

- [ ] **Step 5: Run the normalizer tests**

Run: `pnpm --filter web exec vitest run test/normalize-bmlt.test.ts test/normalize.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing sync test** in `apps/web/test/run-sync.test.ts` (add `readFileSync` from `node:fs` and `path` from `node:path` to its imports):

```ts
it("reads a BMLT feed as an NA feed's meetings", async () => {
  const fixture = readFileSync(path.resolve(import.meta.dirname, "fixtures/bmlt-tennessee.json"), "utf8");
  // The fixture's rows name natennessee.org's root; served here, they must name this server's for the feed to
  // count them as its own.
  let body = "";
  const server = await startServer(() => ({
    status: 200,
    body,
    headers: { "Content-Type": "application/json" },
  }));
  servers.push(server);
  body = fixture.replaceAll("https://natennessee.org/main_server", `${server.baseUrl}/main_server`);
  const id = await upsertFeed({
    slug: "na-volunteer-region",
    name: "Volunteer Region",
    entityType: "region",
    state: "TN",
    url: `${server.baseUrl}/main_server/client_interface/json/?switcher=GetSearchResults&get_used_formats=1`,
    fellowship: "na",
    format: "bmlt",
  });

  expect(await runSync(60_000)).toMatchObject({ synced: 1, failed: 0 });
  expect(await feed(id)).toMatchObject({ meetingCount: 3, lastError: null });
  const stored = await db.select().from(meetings).where(isNull(meetings.archivedAt));
  expect(stored.map((meeting) => meeting.fellowship)).toEqual(["na", "na", "na"]);
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `pnpm --filter web exec vitest run test/run-sync.test.ts -t BMLT`
Expected: FAIL with `"Feed is not a JSON array of meetings"` in `lastError`.

- [ ] **Step 8: Pick the normalizer by format** in `apps/web/src/server/sync/run-sync.ts`:

```ts
import { normalizeBmlt } from "@/server/feeds/normalize-bmlt";

// feeds.format says how the answer is read (spec §4).
function normalized(feed: Feed, body: unknown) {
  return feed.format === "bmlt" ? normalizeBmlt(body, feed.url) : normalizeFeed(body);
}
```

and `rows = normalized(feed, fetched.body).meetings;`.

- [ ] **Step 9: Run everything**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/server apps/web/test
git commit -m "feat(feeds): read NA regions' BMLT servers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/api/v2/meetings`, and v1 for AA only

**Files:**

- Modify: `apps/web/src/server/meetings/summary.ts`, `search.ts`, `detail.ts`, `online.ts`
- Modify: `apps/web/src/app/api/v1/meetings/search/route.ts`, `[id]/route.ts`, `online/route.ts`
- Create: `apps/web/src/app/api/v2/meetings/search/route.ts`, `[id]/route.ts`, `online/route.ts`
- Modify: `tools/network-audit/src/audit.ts`
- Test: `apps/web/test/search-route.test.ts`, `meeting-detail-route.test.ts`, `online-route.test.ts`, `tools/network-audit/test/audit.test.ts`

**Interfaces:**

- Consumes: `meetings.fellowship` (Task 2), the open and V1 contracts (Task 1).
- Produces: `searchMeetings(request, fellowship: Fellowship | null)`, `getMeeting(id, fellowship: Fellowship | null)`, `onlineMeetings(day, fellowship: Fellowship | null)`; `null` means every fellowship. `summaryColumns.fellowship`.

- [ ] **Step 1: Write the failing tests.** In `apps/web/test/search-route.test.ts`:

```ts
import { POST as searchV2 } from "@/app/api/v2/meetings/search/route";

function searchWith(handler: typeof POST, body: unknown) {
  return handler(new Request("http://test/meetings/search", { method: "POST", body: JSON.stringify(body) }));
}

async function seedChurch() {
  const aa = await seedFeed("aa");
  const na = await seedFeed("na", "region", "na");
  const church = { addressKey: "church", latitude: 36.17, longitude: -86.78 };
  await applyFeedSnapshot(aa, [feedMeeting({ ...church, sourceSlug: "aa-1" })]);
  await applyFeedSnapshot(na, [feedMeeting({ ...church, sourceSlug: "na-1", types: ["O", "JFT"] })]);
}

describe("the fellowships", () => {
  // Review Focus 3: builds before 1.1 get exactly today's answer.
  it("v1 returns only AA meetings, in its frozen contract", async () => {
    await seedChurch();
    const res = await searchWith(POST, { lat: 36.16, lng: -86.78, radiusKm: 25 });
    const body: unknown = await res.json();
    expect(V1MeetingSearchResponse.parse(body).meetings).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("fellowship");
  });

  it("v2 returns both, each with its fellowship and its own types", async () => {
    await seedChurch();
    const res = await searchWith(searchV2, { lat: 36.16, lng: -86.78, radiusKm: 25 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { meetings } = MeetingSearchResponse.parse(await res.json());
    expect(meetings.map((m) => [m.fellowship, m.types])).toEqual(
      expect.arrayContaining([
        ["aa", ["O"]],
        ["na", ["O", "JFT"]],
      ]),
    );
  });
});
```

Change this file's import of `MeetingSearchResponse` (renamed to `V1MeetingSearchResponse` in Task 1) so both are imported. In `apps/web/test/meeting-detail-route.test.ts`:

```ts
import { GET as getV2 } from "@/app/api/v2/meetings/[id]/route";

it("finds an NA meeting only through v2", async () => {
  await applyFeedSnapshot(await seedFeed("na", "region", "na"), [feedMeeting({ types: ["O", "BT"] })]);
  const id = await onlyMeetingId();
  expect((await get(id)).status).toBe(404);
  const res = await getV2(new Request(`http://test/api/v2/meetings/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
  expect(MeetingDetailResponse.parse(await res.json()).meeting).toMatchObject({
    fellowship: "na",
    types: ["O", "BT"],
  });
});
```

In `apps/web/test/online-route.test.ts`, the same pair for online: v1 leaves out an NA online meeting, v2 includes it with `fellowship: "na"`, cache `public, s-maxage=900, stale-while-revalidate=3600`.

In `tools/network-audit/test/audit.test.ts`, follow the file's existing read-path tests to add: a v2 search with exactly the rounded body passes; `GET /api/v2/meetings/<uuid>` and `/api/v2/meetings/online?day=3` pass; `/api/v2/meetings/online?day=7` fails.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter web exec vitest run test/search-route.test.ts test/meeting-detail-route.test.ts test/online-route.test.ts`
Expected: FAIL, the v2 routes don't exist, and v1 returns the NA meeting.

- [ ] **Step 3: A fellowship scope in the queries.** In `apps/web/src/server/meetings/summary.ts`, `summaryColumns` gains `fellowship: meetings.fellowship` (after `timezone`), and add:

```ts
// null is every fellowship (/api/v2); /api/v1 asks for "aa" (V1MeetingSummary).
export function inFellowship(fellowship: Fellowship | null): SQL | undefined {
  return fellowship === null ? undefined : eq(meetings.fellowship, fellowship);
}
```

`and(...)` ignores `undefined`. In `search.ts`: `export async function searchMeetings({ lat, lng, radiusKm }: MeetingSearchRequest, fellowship: Fellowship | null)` and add `inFellowship(fellowship)` to its `and(...)`: in SQL, before `limit(MAX_RESULTS)`, so v1's 1,000 are all AA meetings. The same for `getMeeting(id, fellowship)` and `onlineMeetings(day, fellowship)`.

- [ ] **Step 4: The routes.** Each v1 route passes `"aa"` (`searchMeetings(request, "aa")`, `getMeeting(id, "aa")`, `onlineMeetings(day, "aa")`), keeps Task 1's `isV1MeetingType` narrowing, and drops `fellowship` through its V1 contract (zod strips unknown keys). The v2 routes, `apps/web/src/app/api/v2/meetings/search/route.ts`:

```ts
import { MeetingSearchRequest, MeetingSearchResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { searchMeetings } from "@/server/meetings/search";

export const dynamic = "force-dynamic";

// Spec §2: coordinates arrive rounded, only in this POST body, and are never stored, logged or cached. Every
// fellowship's meetings (the phone filters them), so the server never learns which one someone attends.
export const POST = withErrors(async (req: Request) => {
  const request = await readJsonBody(req, MeetingSearchRequest);
  return jsonResponse(MeetingSearchResponse, { meetings: await searchMeetings(request, null) }, "none");
});
```

`apps/web/src/app/api/v2/meetings/[id]/route.ts`:

```ts
import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { parseInput } from "@/lib/api/request";
import { ApiError, jsonResponse, withErrors } from "@/lib/api/respond";
import { getMeeting } from "@/server/meetings/detail";

export const dynamic = "force-dynamic";

const Params = z.object({ id: z.uuid() });

export const GET = withErrors(async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = parseInput(Params, await context.params);
  const meeting = await getMeeting(id, null);
  if (meeting === undefined) throw new ApiError("meeting_not_found");
  return jsonResponse(MeetingDetailResponse, { meeting }, "meetingDetail");
});
```

`apps/web/src/app/api/v2/meetings/online/route.ts`:

```ts
import { OnlineMeetingsQuery, OnlineMeetingsResponse } from "@mymeetingapp/shared";

import { parseInput } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { onlineMeetings } from "@/server/meetings/online";

export const dynamic = "force-dynamic";

// One day at a time keeps nationwide online meetings well under the 4.5 MB response limit.
export const GET = withErrors(async (req: Request) => {
  const { day } = parseInput(OnlineMeetingsQuery, { day: new URL(req.url).searchParams.get("day") });
  return jsonResponse(
    OnlineMeetingsResponse,
    { meetings: await onlineMeetings(day, null) },
    "onlineMeetings",
  );
});
```

Online meetings grow by NA's virtual meetings; if a day's answer nears 4.5 MB in production (check after Task 11's seed: `curl -s https://mymeetings.app/api/v2/meetings/online?day=1 | wc -c`), split it later, not now.

In `tools/network-audit/src/audit.ts`:

```ts
const READS = [
  /^\/api\/v1\/config$/,
  // /api/v2 from the 2026-10-03 vocabulary additions; /api/v1 for builds before them (TestFlight build 12).
  /^\/api\/v[12]\/vocabulary$/,
  // /api/v2 from 1.1 (every fellowship); /api/v1 for builds before it.
  /^\/api\/v[12]\/meetings\/online\?day=[0-6]$/,
  new RegExp(`^/api/v[12]/meetings/${UUID}$`),
];
const SEARCH_PATHS = ["/api/v1/meetings/search", "/api/v2/meetings/search"];
```

and at line 314: `if (request.method === "POST" && SEARCH_PATHS.includes(matchPath)) {`.

- [ ] **Step 5: Run everything**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web tools/network-audit
git commit -m "feat(api): /api/v2/meetings for every fellowship; v1 stays AA-only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: NA discovery and counts by fellowship

**Files:**

- Create: `tools/feed-discovery/src/bmlt.ts`, `tools/feed-discovery/src/na-main.ts`
- Modify: `tools/feed-discovery/src/report.ts`, `tools/feed-discovery/package.json`
- Modify: `apps/web/src/server/admin/metrics.ts`, `apps/web/src/app/metrics/page.tsx`
- Test: `tools/feed-discovery/test/na-main.test.ts`, `tools/feed-discovery/test/report.test.ts`, `apps/web/test/admin-metrics.test.ts`

**Interfaces:**

- Consumes: `RegistryEntry.fellowship`, `region` (Task 2); `createCrawler`, `entityId`, `US_STATES`, `readRegistry`, `writeRegistry`.
- Produces: `runNa(options: { serverListUrl?: string; outDir?: string }): Promise<{ servers: number; meetings: number }>`; `pnpm --filter feed-discovery discover:na`; `readMetrics().feeds.byFellowship` and `readMetrics().tagging.meetingsByFellowship` (`Record<Fellowship, number>`).

- [ ] **Step 1: Write the failing discovery test** in `tools/feed-discovery/test/na-main.test.ts`, using `@mymeetingapp/test-server` as `main.test.ts` does:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "@mymeetingapp/test-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runNa } from "../src/na-main";
import { readRegistry, writeRegistry } from "../src/registry-file";

const json = { "Content-Type": "application/json" };
const servers: { close(): Promise<void> }[] = [];
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "feed-discovery-na-test-"));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(dir, { recursive: true, force: true });
});

function row(root: string, id: string, province: string, city: string) {
  return {
    id_bigint: id,
    meeting_name: "Meeting",
    weekday_tinyint: "2",
    start_time: "19:00:00",
    location_municipality: city,
    location_province: province,
    root_server_uri: root,
  };
}

describe("runNa", () => {
  it("writes one NA region per U.S. root server, keeps AA entries and carries an opt-out", async () => {
    let base = "";
    const server = await startServer((path) => {
      if (path === "/servers.json")
        return {
          status: 200,
          headers: json,
          body: JSON.stringify([
            { id: "1", name: "Volunteer Region", url: `${base}/tn/main_server/` },
            { id: "2", name: "NA New Zealand", url: `${base}/nz/main_server/` },
            { id: "3", name: "Show-Me Region", url: `${base}/mo/main_server/` },
          ]),
        };
      const root = path.split("/client_interface")[0] ?? "";
      const rows =
        root === "/tn/main_server"
          ? [
              row(`${base}/tn/main_server`, "1", "TN", "Nashville"),
              row(`${base}/tn/main_server`, "2", "Tennessee", "Memphis"),
            ]
          : root === "/nz/main_server"
            ? [row(`${base}/nz/main_server`, "3", "Auckland", "Auckland")]
            : [row(`${base}/mo/main_server`, "4", "MO", "St. Louis")];
      return { status: 200, headers: json, body: JSON.stringify({ meetings: rows, formats: [] }) };
    });
    servers.push(server);
    base = server.baseUrl;

    const registryPath = join(dir, "registry.yaml");
    await writeRegistry(registryPath, [aaEntry, { ...showMePrevious(base), opted_out: true }]);

    expect(await runNa({ serverListUrl: `${base}/servers.json`, outDir: dir })).toEqual({
      servers: 2,
      meetings: 3,
    });
    const registry = await readRegistry(registryPath);
    expect(registry.map((entry) => [entry.id, entry.fellowship, entry.state, entry.opted_out])).toEqual([
      [aaEntry.id, undefined, aaEntry.state, undefined],
      ["show-me-region-na", "na", "MO", true],
      ["volunteer-region-na", "na", "TN", undefined],
    ]);
    expect(registry.find((entry) => entry.id === "volunteer-region-na")).toMatchObject({
      entity_type: "region",
      feed_type: "bmlt",
      verified: true,
      meeting_count: 2,
      states_covered: ["TN"],
      cities_covered: ["Memphis, TN", "Nashville, TN"],
    });
  });
});
```

with these fixtures at the top of the file:

```ts
import type { RegistryEntry } from "@mymeetingapp/feed-kit";

const aaEntry: RegistryEntry = {
  id: "tn-intergroup",
  name: "Tennessee Area Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-json/tsml/meetings",
  verified: true,
  meeting_count: 120,
  states_covered: ["TN"],
  cities_covered: [],
  checked_at: "2026-09-25",
  notes: "",
};

// The Show-Me region as an earlier discover:na run wrote it; the owner has since opted it out.
function showMePrevious(base: string): RegistryEntry {
  return {
    id: "show-me-region-na",
    name: "Show-Me Region",
    entity_type: "region",
    fellowship: "na",
    state: "MO",
    website: base,
    feed_type: "bmlt",
    feed_url: `${base}/mo/main_server/client_interface/json/?switcher=GetSearchResults`,
    verified: true,
    meeting_count: 1,
    states_covered: ["MO"],
    cities_covered: ["St. Louis, MO"],
    checked_at: "2026-09-25",
    notes: "",
  };
}
```

The ids are `entityId(name, "na")` ("Volunteer Region" → `volunteer-region-na`). The expected array is in `writeRegistry`'s order (`registry-file.ts`'s `sortKey`); if that sorts by state first, the AA entry (TN) comes after Show-Me (MO): reorder the expected array to match `sortKey`, not the code.

In `tools/feed-discovery/test/report.test.ts`: `buildRegistry` keeps a previous NA entry unchanged ("keeps every NA entry the aa.org run didn't look for"), and `renderCoverage` shows a row per fellowship ("counts feeds and meetings per fellowship": an AA and an NA verified entry give `| AA | 1 | 120 |` and `| NA | 1 | 462 |` under `## By fellowship`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter feed-discovery test`
Expected: FAIL, `na-main` doesn't exist.

- [ ] **Step 3: Write `tools/feed-discovery/src/bmlt.ts`**

```ts
import { type RegistryEntry } from "@mymeetingapp/feed-kit";
import { z } from "zod";

import type { Crawler } from "./crawler";
import { entityId } from "./ids";
import { US_STATES } from "./states";

// The aggregator's own list of root servers (github.com/bmlt-enabled/aggregator).
export const SERVER_LIST_URL =
  "https://raw.githubusercontent.com/bmlt-enabled/aggregator/main/serverList.json";
const FIELDS =
  "id_bigint,meeting_name,weekday_tinyint,start_time,duration_time,time_zone,venue_type,formats,location_text,location_info,location_street,location_municipality,location_province,location_postal_code_1,latitude,longitude,virtual_meeting_link,phone_meeting_number,comments,root_server_uri";
// A server is a U.S. one when most of its meetings are in U.S. states.
const US_SHARE = 0.5;

export const ServerList = z.array(z.object({ name: z.string().min(1), url: z.url() }));
const BmltAnswer = z.object({
  meetings: z.array(
    z.object({ location_province: z.string().optional(), location_municipality: z.string().optional() }),
  ),
});

const CODE_BY_NAME = new Map(US_STATES.map((state) => [state.name.toLowerCase(), state.code]));
const CODES = new Set(US_STATES.map((state) => state.code));

// "TN", "Tennessee" or "tennessee" are Tennessee; anything else isn't a U.S. state.
function stateCode(province: string | undefined): string | null {
  const value = province?.trim() ?? "";
  if (CODES.has(value.toUpperCase())) return value.toUpperCase();
  return CODE_BY_NAME.get(value.toLowerCase()) ?? null;
}

export function feedUrl(root: string): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return `${base}client_interface/json/?switcher=GetSearchResults&get_used_formats=1&data_field_key=${FIELDS}`;
}

// One registry entry for a U.S. root server, or null for a server elsewhere or one that didn't answer.
export async function bmltEntry(
  server: { name: string; url: string },
  crawler: Crawler,
  checkedAt: string,
): Promise<RegistryEntry | null> {
  const url = feedUrl(server.url);
  const result = await crawler.get(url);
  if (result.kind !== "response" || result.status !== 200) return null;
  let answer;
  try {
    answer = BmltAnswer.parse(JSON.parse(result.body));
  } catch {
    return null;
  }
  const states = answer.meetings.map((meeting) => stateCode(meeting.location_province));
  const inUs = states.filter((code) => code !== null);
  if (inUs.length === 0 || inUs.length / answer.meetings.length < US_SHARE) return null;
  const counts = new Map<string, number>();
  for (const code of inUs) counts.set(code, (counts.get(code) ?? 0) + 1);
  const [state = "TN"] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  const cities = new Set(
    answer.meetings.flatMap((meeting, index) => {
      const code = states[index];
      const city = meeting.location_municipality?.trim();
      return code !== null && code !== undefined && city ? [`${city}, ${code}`] : [];
    }),
  );
  return {
    id: entityId(server.name, "na"),
    name: server.name,
    entity_type: "region",
    fellowship: "na",
    state,
    website: new URL(server.url).origin,
    feed_type: "bmlt",
    feed_url: url,
    verified: true,
    meeting_count: answer.meetings.length,
    states_covered: [...counts.keys()].sort(),
    cities_covered: [...cities].sort(),
    checked_at: checkedAt,
    notes: "",
  };
}
```

(`[state = "TN"]`'s default is never used: `inUs` is non-empty. Prefer `const state = …[0]; if (state === undefined) return null;` if the reviewer objects to the default.)

- [ ] **Step 4: Write `tools/feed-discovery/src/na-main.ts`**, following `main.ts`'s CLI shape:

```ts
import { join } from "node:path";

import { createCrawler } from "./crawler";
import { bmltEntry, SERVER_LIST_URL, ServerList } from "./bmlt";
import { readRegistry, writeRegistry } from "./registry-file";

export interface NaRunOptions {
  serverListUrl?: string;
  outDir?: string;
}

// Spec §4 (NA design): every U.S. NA root server as one registry entry. Entries of other fellowships are kept as
// they are; a previous NA entry's opt-out carries over, and one the list no longer has is dropped unless opted out.
export async function runNa(options: NaRunOptions = {}): Promise<{ servers: number; meetings: number }> {
  const outDir = options.outDir ?? new URL("..", import.meta.url).pathname;
  const registryPath = join(outDir, "registry.yaml");
  const previous = await readRegistry(registryPath);
  const crawler = createCrawler();
  const list = await crawler.get(options.serverListUrl ?? SERVER_LIST_URL);
  if (list.kind !== "response" || list.status !== 200) throw new Error("couldn't read the BMLT server list");
  const checkedAt = new Date().toISOString().slice(0, 10);
  const found = [];
  for (const server of ServerList.parse(JSON.parse(list.body))) {
    const entry = await bmltEntry(server, crawler, checkedAt);
    if (entry !== null) found.push(entry);
  }
  const optedOut = new Set(previous.filter((entry) => entry.opted_out === true).map((entry) => entry.id));
  const foundIds = new Set(found.map((entry) => entry.id));
  const registry = [
    ...previous.filter((entry) => entry.fellowship !== "na"),
    ...found.map((entry) => (optedOut.has(entry.id) ? { ...entry, opted_out: true } : entry)),
    ...previous.filter(
      (entry) => entry.fellowship === "na" && entry.opted_out === true && !foundIds.has(entry.id),
    ),
  ];
  await writeRegistry(registryPath, registry);
  return { servers: found.length, meetings: found.reduce((sum, entry) => sum + entry.meeting_count, 0) };
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const result = await runNa();
  console.log(`Found ${String(result.servers)} NA servers with ${String(result.meetings)} meetings`);
}
```

Match `main.ts`'s own "run when invoked" guard and default out dir exactly (read its last 25 lines and copy them, rather than this sketch, if they differ). Add `"discover:na": "tsx src/na-main.ts"` to `tools/feed-discovery/package.json`.

- [ ] **Step 5: The aa.org run keeps NA entries; coverage per fellowship.** In `tools/feed-discovery/src/report.ts`, `buildRegistry`'s return:

```ts
// NA entries come from discover:na, not aa.org's directory, so this run keeps them as they are.
const naEntries = previous.filter((entry) => entry.fellowship === "na");
return [...entries, ...carriedOptOuts.filter((entry) => entry.fellowship !== "na"), ...naEntries];
```

and in `renderCoverage`, a section after the totals:

```ts
const byFellowship = (["aa", "na"] as const).map((fellowship) => {
  const ofFellowship = feeds.filter((feed) => (feed.fellowship ?? "aa") === fellowship);
  return [fellowship.toUpperCase(), String(ofFellowship.length), String(sumMeetings(ofFellowship))];
});
```

rendered as a `## By fellowship` table with headers `["Fellowship", "Verified feeds", "Meetings"]` using the file's existing table helper. `VerifiedFeed` must carry `fellowship` from its entry for this; add it where `verifiedFeeds` builds each one.

- [ ] **Step 6: Counts by fellowship on `/metrics`.** In `apps/web/test/admin-metrics.test.ts`, extend the feed-health test's seeding with `await seedFeed("na-region", "region", "na")` and expect `(await readMetrics()).feeds.byFellowship` to equal `{ aa: 7, na: 1 }` (adjust to the test's feed count). In `apps/web/src/server/admin/metrics.ts`, read it with one grouped query:

```ts
async function readFeedsByFellowship(): Promise<Record<Fellowship, number>> {
  const rows = await db
    .select({ fellowship: feeds.fellowship, count: sql<number>`count(*)::int` })
    .from(feeds)
    .groupBy(feeds.fellowship);
  return Object.fromEntries(
    FELLOWSHIPS.map((fellowship) => [
      fellowship,
      rows.find((row) => row.fellowship === fellowship)?.count ?? 0,
    ]),
  ) as Record<Fellowship, number>;
}
```

(the `as` is on the result of a runtime construction over every `FELLOWSHIPS` key; if the reviewer objects, build the object with a `for` loop into a `Record` initialised from `{ aa: 0, na: 0 }`), and the same over `meetings` where `archived_at is null` for `tagging.meetingsByFellowship`. Show them on `apps/web/src/app/metrics/page.tsx`: under Feeds, `<Total label="AA / NA feeds" value={`${String(byFellowship.aa)} / ${String(byFellowship.na)}`} />`, and under Tagging, `<Total label="AA / NA meetings" … />`.

- [ ] **Step 7: Run everything**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 8: Commit, then open PR 1**

```bash
git add -A tools/feed-discovery apps/web
git commit -m "feat(discovery): discover:na finds U.S. NA regions; metrics by fellowship

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Then Task 9's website half (below) goes into PR 1 too. Run `pnpm knip:production` and `pnpm --filter web test:e2e`, push, and open **PR 1: NA meetings, server** (v1 is unchanged, so it's safe before 1.1).

---

### Task 7: App 1.1 reads v2 and labels each meeting's fellowship

**Files:**

- Modify: `apps/mobile/src/api/reads.ts`
- Create: `apps/mobile/src/meetings/fellowship.ts`
- Modify: `apps/mobile/src/meetings/type-labels.ts`
- Modify: `apps/mobile/src/ui/meeting-card.tsx`, `apps/mobile/src/ui/results-map.tsx`, `apps/mobile/src/app/meeting/[id].tsx`, `apps/mobile/src/search/filters.tsx` (`types` becomes `readonly string[]`)
- Modify: `apps/mobile/test/fixtures.ts`, and every mobile test's `/api/v1/meetings` path
- Test: `apps/mobile/test/meeting-detail.test.tsx`, `apps/mobile/test/nearby.test.tsx`, `apps/mobile/test/map.test.tsx`, `apps/mobile/test/saved.test.tsx`

**Interfaces:**

- Consumes: the open `MeetingSummary`, `MeetingSearchResponse`, `OnlineMeetingsResponse`, `MeetingDetailResponse` (Task 1); `/api/v2/meetings/*` (Task 5).
- Produces: `fellowshipLabel(slug: string): string`; `typeLabel(code: string): string | null`; `TYPE_LABELS: Record<MeetingTypeCode, string>` with NA's four; `FILTER_TYPES` with NA's four.

- [ ] **Step 1: Point the app's reads and tests at v2.**

```bash
cd /Users/ahunton/projects/MyMeetingsApp/apps/mobile
perl -pi -e 's#/api/v1/meetings#/api/v2/meetings#g' src/api/reads.ts $(rg -l '/api/v1/meetings' test)
perl -pi -e 's/\bV1(MeetingSummary|MeetingSearchResponse|OnlineMeetingsResponse|MeetingDetailResponse)\b/$1/g' $(rg -l 'V1Meeting|V1OnlineMeetings' src test)
```

The fixtures (`test/fixtures.ts`) parse with the open contract, so `fellowship` defaults to `"aa"`; add `fellowship: "aa"` to `BASE` explicitly.

- [ ] **Step 2: Write the failing tests.** In `apps/mobile/test/meeting-detail.test.tsx`, the existing "shows when, where, types…" test now expects the fellowship first: change `expect(screen.getByText("Open · Big Book"))` to `expect(screen.getByText("AA · Open · Big Book"))`, and add:

```ts
it("labels an NA meeting, names NA's formats and leaves out a type this build doesn't know", async () => {
  api.reply(PATH, { meeting: meeting({ fellowship: "na", types: ["O", "JFT", "ZZZ"] }) });
  await renderApp(`/meeting/${ID}`);
  expect(await screen.findByText("NA · Open · Just for Today")).toBeOnTheScreen();
});
```

In `apps/mobile/test/nearby.test.tsx`, `describe("results")`:

```ts
it("labels each meeting in the list with its fellowship", async () => {
  api.reply(SEARCH, { meetings: [far, { ...near, fellowship: "na" }] });
  await launchNearby();
  await searchFor("Maryville, TN");
  expect(await screen.findByRole("button", { name: /^Near Group, NA meeting,/ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Far Group, AA meeting,/ })).toBeOnTheScreen();
});
```

In `apps/mobile/test/map.test.tsx`, a marker is named with its fellowship: change `{ name: "Far Group, Mon 7:00 PM" }` (and its siblings) to `{ name: "Far Group, AA, Mon 7:00 PM" }`, and add one NA marker case.

In `apps/mobile/test/saved.test.tsx` (Review Focus 4): a Saved meeting whose saved copy was written by 1.0 (write the cache entry with the meeting minus `fellowship`, via `writeCache` as that file's offline tests do) still shows, labeled AA.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter mobile test -- meeting-detail nearby map saved`
Expected: FAIL. There are no labels yet, and `TYPE_LABELS` has no `JFT`.

- [ ] **Step 4: Labels.** Create `apps/mobile/src/meetings/fellowship.ts`:

```ts
import { FELLOWSHIPS, type Fellowship } from "@mymeetingapp/shared";

const LABELS: Record<Fellowship, string> = { aa: "AA", na: "NA" };

function isKnown(slug: string): slug is Fellowship {
  return FELLOWSHIPS.some((known) => known === slug);
}

// /api/v2's fellowships are open-ended: one this build doesn't know shows as its slug, in capitals.
export function fellowshipLabel(slug: string): string {
  return isKnown(slug) ? LABELS[slug] : slug.toUpperCase();
}
```

In `apps/mobile/src/meetings/type-labels.ts`, `MeetingTypeCode` comes from shared (`import type { MeetingTypeCode } from "@mymeetingapp/shared"`, replacing the local type), and `TYPE_LABELS` gains:

```ts
  BT: "Basic Text",
  IW: "It Works: How and Why",
  JFT: "Just for Today",
  SWG: "Step Working Guide",
```

(in alphabetical place). Add:

```ts
function isKnownType(code: string): code is MeetingTypeCode {
  return Object.hasOwn(TYPE_LABELS, code);
}

// /api/v2's types are open-ended: a type this build has no name for isn't shown.
export function typeLabel(code: string): string | null {
  return isKnownType(code) ? TYPE_LABELS[code] : null;
}
```

and `FILTER_TYPES` gains `"BT"`, `"JFT"`, `"IW"`, `"SWG"` at the end, typed `readonly MeetingTypeCode[]`. Update its header comment: "English names from the Meeting Guide spec…, and NA's literature formats (BMLT world_id)".

In `apps/mobile/src/search/filters.tsx`, `MeetingFilters.types` becomes `readonly string[]` and drops the `MeetingTypeCode` import.

In `apps/mobile/src/app/meeting/[id].tsx`, replace the types section:

```tsx
<Section title="Meeting type">
  <AppText>
    {[
      fellowshipLabel(meeting.fellowship),
      ...meeting.types.map(typeLabel).filter((label) => label !== null),
    ].join(" · ")}
  </AppText>
</Section>
```

(no longer conditional: every meeting has a fellowship).

In `apps/mobile/src/ui/meeting-card.tsx`:

```tsx
const fellowship = fellowshipLabel(meeting.fellowship);
const meta = [fellowship, when, distance].filter((part) => part !== undefined).join(" · ");
// The card is one button to VoiceOver and TalkBack, so its label carries everything on it, tags included.
const spoken = [
  meeting.name,
  `${fellowship} meeting`,
  when,
  distance,
  meeting.locationName,
  ...tags.map((tag) => tag.spoken),
];
```

In `apps/mobile/src/ui/results-map.tsx`, `MappedMeeting` picks `"fellowship"` too, and:

```tsx
  const when = shortWhen(meeting);
  const fellowship = fellowshipLabel(meeting.fellowship);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      title={meeting.name}
      description={`${fellowship} · ${when}`}
      accessibilityLabel={`${meeting.name}, ${fellowship}, ${when}`}
```

- [ ] **Step 5: Run the app's suite and fix the names it now finds.** Tests that find a card by its whole spoken label, or a marker by name, now include the fellowship. Update each expected name (`rg -n 'name: "' test | rg -v fellowship` shows the candidates), never the component.

Run: `pnpm --filter mobile test`
Expected: PASS.

- [ ] **Step 6: Run everything and commit**

Run: `pnpm check`

```bash
git add -A apps/mobile
git commit -m "feat(app): read /api/v2/meetings and label each meeting's fellowship

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The Fellowship filter, and only what the answer holds

**Files:**

- Modify: `apps/mobile/src/search/filters.tsx`, `apps/mobile/src/app/filters.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`
- Test: `apps/mobile/test/filters.test.ts`, `apps/mobile/test/nearby.test.tsx`

**Interfaces:**

- Consumes: `fellowshipLabel`, `typeLabel`, `FILTER_TYPES` (Task 7).
- Produces: `MeetingFilters.fellowships: readonly string[]`; `Offered = { types: readonly string[]; fellowships: readonly string[] }`; `offeredBy(meetings): Offered`; `useOffered(): { offered: Offered; offer: (offered: Offered) => void }`.

- [ ] **Step 1: Write the failing unit tests** in `apps/mobile/test/filters.test.ts`. Add rows to the `it.each` table:

```ts
    [{ fellowships: ["aa"] }, true],
    [{ fellowships: ["na"] }, false],
    [{ fellowships: ["aa", "na"] }, true],
```

and:

```ts
describe("offeredBy", () => {
  it("offers each type and fellowship the answer holds, in the filter sheet's order", () => {
    expect(
      offeredBy([
        meeting({ types: ["JFT", "O"], fellowship: "na" }),
        meeting({ types: ["W"], fellowship: "aa" }),
      ]),
    ).toEqual({ types: ["O", "W", "JFT"], fellowships: ["aa", "na"] });
  });
});
```

(`FILTER_TYPES`' order is `"O", "C", "BE", "W", …, "BT", "JFT", "IW", "SWG"`; `FELLOWSHIPS`' is `aa`, `na`.)

- [ ] **Step 2: Write the failing screen tests** in `apps/mobile/test/nearby.test.tsx`. Add `"Fellowship filters"` to `UNCHOSEN`, and:

```ts
it("narrows to one fellowship, offering only the fellowships and types the answer holds", async () => {
  api.reply(SEARCH, { meetings: [far, { ...near, fellowship: "na", types: ["O", "JFT"] }] });
  await launchNearby();
  await searchFor("Maryville, TN");
  await screen.findByText("Near Group");
  await openFilters();
  await fireEvent.press(await screen.findByRole("button", { name: "Type filters" }));
  expect(screen.getByRole("checkbox", { name: "Just for Today" })).toBeOnTheScreen();
  expect(screen.queryByRole("checkbox", { name: "Women" })).toBeNull();
  await fireEvent.press(screen.getByRole("checkbox", { name: "NA" }));
  await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
  await waitFor(() => {
    expect(screen.queryByText("Far Group")).toBeNull();
  });
  expect(screen.getByText("Near Group")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Fellowship filters, 1 chosen" })).toBeOnTheScreen();
});

// Review Focus 5.
it("keeps a chosen fellowship offered where the answer has none, and Clear brings everything back", async () => {
  api.reply(SEARCH, { meetings: [{ ...near, fellowship: "na" }] });
  await launchNearby();
  await searchFor("Maryville, TN");
  await chooseFilters("Fellowship filters", ["NA"]);
  api.reply(SEARCH, { meetings: [far] });
  await searchFor("Knoxville, TN");
  expect(await screen.findByText(/^No meetings match your filters/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Fellowship filters, 1 chosen" }));
  expect(screen.getByRole("checkbox", { name: "NA" })).toBeChecked();
  await fireEvent.press(screen.getByRole("button", { name: "Clear filters" }));
  await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
  expect(await screen.findByText("Far Group")).toBeOnTheScreen();
});
```

(`setPlace("Knoxville, TN", …)` in that test's setup, with a point as `MARYVILLE` is.) The existing test that picks "Women" (`nearby.test.tsx:481`) now finds no Women pill, because neither meeting has that type: give `near` `types: ["O", "W"]` in that test's reply, so it still narrows by a type.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter mobile test -- filters nearby`
Expected: FAIL. There's no Fellowship group, and the Type group offers every type.

- [ ] **Step 4: The filters.** In `apps/mobile/src/search/filters.tsx`:

```ts
export interface MeetingFilters {
  days: readonly number[];
  times: readonly TimeOfDay[];
  types: readonly string[];
  tags: readonly string[];
  fellowships: readonly string[];
}

export const NO_FILTERS: MeetingFilters = { days: [], times: [], types: [], tags: [], fellowships: [] };
```

`matchesFilters` adds `&& (filters.fellowships.length === 0 || filters.fellowships.includes(meeting.fellowship))` (any chosen fellowship, as days); update its comment ("Days, times and fellowships match any chosen; types and tags must all be present."). In `filtering`, `untouched` also needs `filters.fellowships.length === 0`. `chosenGroups` counts `fellowships`. Then the offered lists:

```ts
// What the latest answer holds, so the filter sheet offers only types and fellowships that can match (spec §8).
export interface Offered {
  types: readonly string[];
  fellowships: readonly string[];
}
const NOTHING_OFFERED: Offered = { types: [], fellowships: [] };

export function offeredBy(meetings: readonly MeetingSummary[]): Offered {
  const types = new Set(meetings.flatMap((meeting) => meeting.types));
  const fellowships = new Set(meetings.map((meeting) => meeting.fellowship));
  return {
    types: FILTER_TYPES.filter((type) => types.has(type)),
    fellowships: [
      ...FELLOWSHIPS.filter((known) => fellowships.has(known)),
      ...[...fellowships].filter((slug) => !FELLOWSHIPS.some((known) => known === slug)),
    ],
  };
}
```

The context carries it beside the choices (held in memory, never saved, like them):

```ts
const Filters = createContext<{
  chosen: Chosen;
  choose: (groups: Chosen) => void;
  offered: Offered;
  offer: (offered: Offered) => void;
}>({ chosen: {}, choose: () => undefined, offered: NOTHING_OFFERED, offer: () => undefined });
```

with `const [offered, offer] = useState<Offered>(NOTHING_OFFERED);` in `FiltersProvider`, both in the memoised value, and:

```ts
export function useOffered() {
  const { offered, offer } = useContext(Filters);
  return { offered, offer };
}
```

- [ ] **Step 5: Nearby offers its answer; the sheet shows only that.** In `apps/mobile/src/app/(tabs)/index.tsx`, after `lastFound` is set:

```ts
const { offer } = useOffered();
useEffect(() => {
  offer(offeredBy(lastFound));
}, [lastFound, offer]);
```

`FilterPills` gains `{ name: "Fellowship", spoken: "Fellowship", count: filters.fellowships.length }`, first in the row, and `summaryLine`'s `more` counts `filters.fellowships` beside types and tags.

In `apps/mobile/src/app/filters.tsx`, a Fellowship group first, and the Type group limited to the offered (a chosen one always shows, so it can be unchosen):

```tsx
  const { offered } = useOffered();
  const fellowships = [...new Set([...offered.fellowships, ...filters.fellowships])];
  const types = FILTER_TYPES.filter((type) => offered.types.includes(type) || filters.types.includes(type));
  …
      {fellowships.length > 0 && (
        <Group title="Fellowship">
          {fellowships.map((fellowship) => (
            <Pill
              key={fellowship}
              label={fellowshipLabel(fellowship)}
              selected={filters.fellowships.includes(fellowship)}
              onPress={() => {
                setFilters({ fellowships: toggled(filters.fellowships, fellowship) });
              }}
            />
          ))}
        </Group>
      )}
      …
      {types.length > 0 && (
        <Group title="Meeting type">
          {types.map((type) => (
            <Pill key={type} label={TYPE_LABELS[type]} … />
          ))}
        </Group>
      )}
```

Spec §8 changes in Task 10 ("a Fellowship group; Type offers only what the answer holds").

- [ ] **Step 6: Run everything and commit**

Run: `pnpm check`

```bash
git add -A apps/mobile
git commit -m "feat(app): a Fellowship filter; the sheet offers only what the answer holds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: NA's own meeting finder in Help

**Files:**

- Modify: `packages/shared/src/help-lines.ts`, `apps/web/src/components/help-resources.tsx`, `apps/mobile/src/ui/help-resources.tsx`
- Test: `apps/web/test/landing-page.test.tsx`, `apps/web/test/aa-name.test.tsx`, `apps/mobile/test/launch.test.tsx`

**Interfaces:**

- Produces: `NA_MEETING_FINDER = "https://na.org/meetingsearch/"`.

The website half goes into PR 1 (Task 6, Step 8); the app half ships with 1.1.

- [ ] **Step 1: Write the failing tests.** In `apps/web/test/landing-page.test.tsx`, the test at line 151 also expects `"Narcotics Anonymous has its own meeting finder at na.org"`, and the hrefs at line 156 become `["tel:988", "tel:18006624357", "https://www.aa.org/find-aa", "https://na.org/meetingsearch/"]`. In `apps/web/test/aa-name.test.tsx`, add `"Narcotics Anonymous has its own meeting finder at na.org"` to the allowed phrases. In `apps/mobile/test/launch.test.tsx`, after line 158:

```ts
await fireEvent.press(screen.getByRole("button", { name: "Open na.org's meeting finder" }));
expect(openURL).toHaveBeenCalledWith("https://na.org/meetingsearch/");
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter web exec vitest run test/landing-page.test.tsx` and `pnpm --filter mobile test -- launch`
Expected: FAIL.

- [ ] **Step 3: Add the line.** In `packages/shared/src/help-lines.ts`:

```ts
// Narcotics Anonymous's own meeting finder, beside AA's.
export const NA_MEETING_FINDER = "https://na.org/meetingsearch/";
```

On the website, after the AA `<li>`:

```tsx
<li>
  Narcotics Anonymous has its own meeting finder at <a href={NA_MEETING_FINDER}>na.org</a>.
</li>
```

In the app, after the aa.org button:

```tsx
      <AppText>Narcotics Anonymous has its own meeting finder at na.org.</AppText>
      <HandOffButton to="web" kind="secondary" label="Open na.org's meeting finder" url={NA_MEETING_FINDER} />
```

- [ ] **Step 4: Run everything and commit**

Run: `pnpm check`

```bash
git add packages/shared apps/web apps/mobile
git commit -m "feat(help): point to NA's own meeting finder beside AA's

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Copy, disclaimers, SPEC and version 1.1.0

**Files:**

- Modify: `apps/web/src/components/site-footer.tsx`, `apps/web/src/app/(site)/terms/page.tsx`, `privacy/page.tsx`, `support/page.tsx`, `page.tsx`
- Modify: `apps/mobile/store.config.json`, `apps/mobile/store/google-play/listing.json`, `apps/mobile/app.config.ts` (`version: "1.1.0"`)
- Modify: `docs/app-store.md` (review notes), `SPEC.md`
- Test: `apps/web/test/aa-name.test.tsx`, `apps/web/test/terms-and-support.test.tsx`, `apps/web/test/site.e2e.ts`, `apps/mobile/test/listing-claims.ts`

- [ ] **Step 1: Write the failing tests.** In `apps/mobile/test/listing-claims.ts`, the disclaimer becomes:

```ts
const DISCLAIMER =
  "not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.";
```

used by both its tests, plus `"AA and NA meetings"` as the one other place the names may appear:

```ts
it("names AA and NA only to say it isn't affiliated, and which meetings it lists", () => {
  const rest = description().replace(DISCLAIMER, "").replace("AA and NA meetings", "");
  expect(rest).not.toMatch(/\bA\.?A\b|Alcoholics Anonymous|\bN\.?A\b|Narcotics Anonymous/);
});
```

In `apps/web/test/aa-name.test.tsx`, `DISCLAIMERS` becomes:

```ts
const DISCLAIMERS = [
  "Not affiliated with Alcoholics Anonymous or Narcotics Anonymous",
  "not affiliated with, endorsed by or approved by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.",
  "Alcoholics Anonymous has its own meeting finder at aa.org",
  "Narcotics Anonymous has its own meeting finder at na.org",
  "AA and NA meetings",
];
const NAMES = /\bA\.?A\b|Alcoholics Anonymous|\bN\.?A\b|Narcotics Anonymous/;
```

with `AA_NAME` replaced by `NAMES` (rename the describe: "the AA and NA names on the website"). In `apps/web/test/terms-and-support.test.tsx`, the disclaimer row becomes the new sentence and the date `"Updated 5 October 2026."`. In `apps/web/test/site.e2e.ts:13`, the footer check becomes `"My Meeting App<!-- --> is not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc."`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter mobile test -- listing` and `pnpm --filter web exec vitest run test/aa-name.test.tsx test/terms-and-support.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The copy.**

- Footer: `{BRAND.name} is not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.`
- Terms: heading `Not affiliated with Alcoholics Anonymous or Narcotics Anonymous`; sentence `It is not affiliated with, endorsed by or approved by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.`; "Listings can be out of date": `lists that intergroups, NA regions and other service entities publish`; date `Updated 5 October 2026.`
- Privacy, Meeting listings: `come from meeting lists that intergroups, NA regions and other service entities publish`.
- Support: heading `For intergroups, NA regions and other service entities`; `Listings come from the local intergroup, NA region or service entity.`
- Home (`page.tsx`), Meetings near you: `In-person, hybrid and online recovery meetings across the United States, AA and NA meetings, from the lists local service offices publish.`
- Store descriptions (both): second paragraph `My Meeting App lists in-person, hybrid and online recovery meetings in the United States, AA and NA meetings, from the meeting lists that local service offices publish.`; the filter sentence `you can filter by fellowship, day, time, meeting type and tags`; the last paragraph's disclaimer as above.
- `apps/mobile/app.config.ts`: `version: "1.1.0"`. `store.config.json`'s `apple.version` (if it pins one; PR #27 set it to 1.0.0) becomes `"1.1.0"`.
- `docs/app-store.md` review notes: "Finding meetings" adds `It lists AA and NA meetings; Filters → Fellowship narrows to one.` The last paragraph becomes `My Meeting App is not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Narcotics Anonymous or NA World Services; meeting listings come from public lists that local service offices publish (AA's in the open Meeting Guide format, NA's from their regions' BMLT servers).`

- [ ] **Step 4: SPEC.md.** §1: "finding recovery meetings (AA and NA meetings)". §3: add "Every meeting is one fellowship's, its feed's; listings of different fellowships never match." §4: the BMLT feed type, `discover:na`, and the `world_id` map, as the design's §1. §7: the `/api/v2/meetings` routes beside v1, v1 AA-only and frozen. §8: the Fellowship filter, the labels, the Type filter offering only the answer's types, NA's Help line. §9 and §11: the copy and disclaimer above. §15: "NA meetings from regions' BMLT servers, with a fellowship on every feed and meeting; v1 stays AA-only for builds before 1.1 (2026-10-05)."

- [ ] **Step 5: Run everything and commit**

Run: `pnpm check`, `pnpm knip:production`, `pnpm --filter web test:e2e`
Expected: all PASS.

```bash
git add -A
git commit -m "feat(copy): AA and NA meetings, disclaimers for both, version 1.1.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Push and open **PR 2: NA meetings, app 1.1**.

---

### Task 11: Release

Owner steps are marked; Claude runs the rest.

- [ ] **Step 1: Merge PR 1** (after its CI and `/code-review`). The production deploy runs migrations 0026–0027. Check v1 is unchanged: `curl -s -X POST https://mymeetings.app/api/v1/meetings/search -H 'Content-Type: application/json' -d '{"lat":36.16,"lng":-86.78,"radiusKm":25}' | jq '.meetings[0] | has("fellowship")'` prints `false`.
- [ ] **Step 2: Discover NA regions.** `pnpm --filter feed-discovery discover:na`, then read the registry diff: one `bmlt` / `na` entry per U.S. server (expect about 30 of the aggregator's 41), with sensible states and counts. Commit `tools/feed-discovery/registry.yaml` on a branch and merge it.
- [ ] **Step 3: Seed production** (owner approves the production write): from `apps/web`, with `.env.local` moved aside, `vercel env run -e production --scope huntonas-projects -- pnpm db:seed-feeds ../../tools/feed-discovery/registry.yaml`. Expected: the AA count as before plus the NA servers.
- [ ] **Step 4: Let the sync read them** (15 minutes per batch; the first sync of ~30 servers spans a few runs). Then check `/metrics` (AA / NA feeds and meetings), and `curl -s -X POST https://mymeetings.app/api/v2/meetings/search -d '{"lat":36.16,"lng":-86.78,"radiusKm":25}' -H 'Content-Type: application/json' | jq '[.meetings[].fellowship] | group_by(.) | map({(.[0]): length}) | add'` shows both fellowships. Check the online answer size (Task 5).
- [ ] **Step 5: Merge PR 2**, after 1.0 is approved and released (its store copy targets 1.1).
- [ ] **Step 6: Build and submit 1.1** (owner approves the production build): `cd apps/mobile && npx -y eas-cli@latest build --platform ios --profile production --auto-submit`. Test it from TestFlight against production: an NA meeting near you, the Fellowship filter, a tag on an NA meeting.
- [ ] **Step 7: Store copy and review** (owner): `eas metadata:push` for 1.1's description and keywords, new screenshots if Nearby changed visibly, the review notes from `docs/app-store.md`, then Submit for Review.
