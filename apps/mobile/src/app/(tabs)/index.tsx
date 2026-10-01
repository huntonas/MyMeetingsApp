import type { MeetingSearchResponse } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";

import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { useUpgradeRequired } from "@/config/upgrade";
import { currentPosition } from "@/location/current-position";
import { findPlace } from "@/location/find-place";
import { type MapRegion, radiusForRegion, regionAround, SEARCH_RADIUS_KM } from "@/location/geo";
import { type RecentPlace, rememberPlace } from "@/location/recent-places";
import { shortWhen } from "@/meetings/schedule";
import { milesLabel, radiusMiles } from "@/meetings/units";
import {
  chosenGroups,
  filtering,
  type MeetingFilters,
  NO_FILTERS,
  tonight,
  useFilters,
} from "@/search/filters";
import {
  describedOrigin,
  listNearby,
  type NearbyMeeting,
  type NearbyOrder,
  type SearchOrigin,
  searchRead,
} from "@/search/nearby";
import { useColors } from "@/theme/colors";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { HandOffButton } from "@/ui/hand-off-button";
import { MeetingCard } from "@/ui/meeting-card";
import { OnlineNowList, useOnlineNow } from "@/ui/online-now-list";
import { PanelToggle } from "@/ui/panel-toggle";
import { Pill } from "@/ui/pill";
import { PlaceSearch } from "@/ui/place-search";
import { ResultsMap } from "@/ui/results-map";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

const DENIED =
  "Location is off for mymeetingapp. Search by city, zip code or address instead, or turn location on in Settings.";
const UNAVAILABLE = "We couldn't get your location just now. Try again, or search by place.";
const BLANK = "Type a city, zip code or address.";
// findPlace can't tell "no such place" from a geocoder that failed or timed out, so this mustn't claim the place
// doesn't exist.
const notFound = (text: string) =>
  `We couldn't find “${text}”. Check the spelling or your connection, then try again.`;

// Recent places are best effort, like the cache: failing to save one (a full disk, a native storage error) never
// stops the search the person asked for.
const ignoreRecentPlaceFailure = () => undefined;

function FilterPills({ filters }: { filters: MeetingFilters }) {
  const pills = [
    { name: "Day", spoken: "Day", count: filters.days.length },
    { name: "Time", spoken: "Time", count: filters.times.length },
    { name: "Type", spoken: "Type", count: filters.types.length },
    { name: "Tags", spoken: "Tag", count: filters.tags.length },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {pills.map(({ name, spoken, count }) => (
        <Pill
          key={name}
          role="button"
          label={count === 0 ? name : `${name} · ${String(count)}`}
          spokenLabel={count === 0 ? `${spoken} filters` : `${spoken} filters, ${String(count)} chosen`}
          selected={count > 0}
          onPress={() => {
            router.push("/filters");
          }}
        />
      ))}
    </View>
  );
}

const ORDERS: readonly { order: NearbyOrder; label: string }[] = [
  { order: "soonest", label: "Soonest" },
  { order: "nearest", label: "Nearest" },
];

function OrderPills({ order, onOrder }: { order: NearbyOrder; onOrder: (order: NearbyOrder) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <AppText>Sort</AppText>
      {ORDERS.map(({ order: choice, label }) => (
        <Pill
          key={choice}
          role="button"
          label={label}
          spokenLabel={`Sort ${label.toLowerCase()} first`}
          selected={order === choice}
          onPress={() => {
            onOrder(choice);
          }}
        />
      ))}
    </View>
  );
}

const counted = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? "" : "s"}`;

// What's on, in one line above the list: "2 meetings · today from now", "1 meeting · 3 filters · nearest". While
// neither Day nor Time is the person's own, the list is today from now on, whatever the pills say. Soonest, the
// default, goes without saying, to keep the line short (owner decision, 2026-09-30).
function summaryLine(count: number, filters: MeetingFilters, starting: boolean, order: NearbyOrder): string {
  const more = [filters.types, filters.tags].filter((group) => group.length > 0).length;
  const groups = chosenGroups(filters);
  const on = starting
    ? ["today from now", ...(more > 0 ? [counted(more, "more filter")] : [])]
    : groups > 0
      ? [counted(groups, "filter")]
      : [];
  return [counted(count, "meeting"), ...on, ...(order === "nearest" ? [order] : [])].join(" · ");
}

type ResultsView = "list" | "map";

// The list's rows: meetings, and the Tomorrow heading where tomorrow's start.
type Row = { kind: "meeting"; meeting: NearbyMeeting } | { kind: "tomorrow" };

// Late at night with nothing nearby tonight or tomorrow: how many online meetings are on now or soon, as the Online tab
// counts them, and the way there. The count waits until every day's read has landed.
function OnlineNowLink() {
  const { loading, failure, happening, soon } = useOnlineNow();
  const count = loading || failure !== undefined ? "" : ` (${String(happening.length + soon.length)})`;
  return (
    <View style={{ alignSelf: "flex-start" }}>
      <Button
        kind="text"
        label={`Online now${count}`}
        hint="Opens the Online tab"
        onPress={() => {
          router.navigate("/online");
        }}
      />
    </View>
  );
}

interface ResultsProps {
  origin: SearchOrigin;
  view: ResultsView;
  onView: (view: ResultsView) => void;
  order: NearbyOrder;
  onOrder: (order: NearbyOrder) => void;
  filtersOpen: boolean;
  onFiltersOpen: (open: boolean) => void;
  onMapMove: (region: MapRegion) => void;
  onChangePlace: () => void;
  // Where the search was before the person first moved the map, while the search is a map area's.
  backTo: SearchOrigin | null;
  onBack: (to: SearchOrigin) => void;
  // Why going back near the person found nothing (the phone couldn't find itself), as the place search says it.
  problem: string | null;
}

function Results({
  origin: asked,
  view,
  onView,
  order,
  onOrder,
  filtersOpen,
  onFiltersOpen,
  onMapMove,
  onChangePlace,
  backTo,
  onBack,
  problem,
}: ResultsProps) {
  const colors = useColors();
  const now = useNow();
  const { state, refresh } = useCachedRead(searchRead(asked));
  // Offline, the answer may be the last search standing in for this one; everything below describes where it was made.
  const origin = useMemo(
    () =>
      state.status === "ready"
        ? describedOrigin(state.data, asked)
        : { label: asked.label, point: asked.point, radiusKm: asked.radiusKm, lastSearch: false },
    [state, asked],
  );
  // Keeps the website's promise that tag changes reach the app within the reuse window, for a list left open.
  useRefreshOnFocus(refresh);
  const { chosen, setFilters } = useFilters();
  const { filters, starting, untouched, section } = useMemo(() => filtering(chosen, now), [chosen, now]);
  // Where the map was left: it opens around the search, and after the person switches to the list and back it opens
  // where they last moved it. The map applies this only when it appears, so updating it never moves a map on screen.
  const [mapRegion, setMapRegion] = useState(() => regionAround(asked.point, asked.radiusKm));
  // The person's dot shows only on a search near them (location is allowed by then), and stays through their pans.
  const [nearPerson] = useState(asked.kind === "me");
  // The last meetings found, kept on the map while a pan's search loads so the markers don't flash off and on. Updated
  // during render (React's pattern for state that follows a changing value), so a new answer shows in the same render.
  const [lastFound, setLastFound] = useState<MeetingSearchResponse["meetings"]>([]);
  if (state.status === "ready" && state.data.meetings !== lastFound) setLastFound(state.data.meetings);
  // What the filters keep, in order, and under the starting Day and Time tomorrow's after today's: worked out again only
  // when one of these changes, not on every render. The map shows the same meetings, both days' (their order means
  // nothing there), so late at night it isn't empty either; each marker says its day.
  const { listed, tomorrow } = useMemo(
    () => listNearby(lastFound, origin.point, order, now, section),
    [lastFound, origin.point, order, now, section],
  );
  const onMap = useMemo(() => [...listed, ...tomorrow], [listed, tomorrow]);
  const rows = useMemo<Row[]>(
    () => [
      ...listed.map((meeting) => ({ kind: "meeting" as const, meeting })),
      ...(tomorrow.length > 0 ? [{ kind: "tomorrow" as const }] : []),
      ...tomorrow.map((meeting) => ({ kind: "meeting" as const, meeting })),
    ],
    [listed, tomorrow],
  );
  const backButton = backTo !== null && (
    <Button
      kind="secondary"
      label={`Back to ${backTo.kind === "me" ? "near you" : backTo.label}`}
      hint={`Searches near ${backTo.label} again`}
      onPress={() => {
        onBack(backTo);
      }}
    />
  );
  const row = {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } as const;
  const groups = chosenGroups(filters);
  // Filters start chosen (today, from now on), so the count is rarely 0, and Clear is on the summary line.
  const filtered = groups > 0;
  // On the heading's second row wherever the filters apply: a list with meetings in it, and the map.
  const filtersToggle = (
    <PanelToggle
      label={filtered ? `Filters · ${String(groups)}` : "Filters"}
      spokenLabel={filtered ? `Filters, ${String(groups)} chosen` : "Filters"}
      contents={view === "list" ? "the filters and sort order" : "the filters"}
      selected={filtered}
      expanded={filtersOpen}
      onToggle={() => {
        onFiltersOpen(!filtersOpen);
      }}
    />
  );
  // Rows wrap rather than overflow on a narrow phone or at large text sizes.
  const heading = (toggle: ReactNode = null) => (
    <View style={{ gap: 12 }}>
      <View style={row}>
        <AppText variant="title" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {`Near ${origin.label}`}
        </AppText>
        <Button kind="text" label="Change place" hint="Searches somewhere else" onPress={onChangePlace} />
      </View>
      {/* On the map it sits over the map instead: appearing beside it after the first pan would resize the map. */}
      {view === "list" && backButton}
      {view === "list" && problem !== null && <AppText accessibilityRole="alert">{problem}</AppText>}
      <View style={row}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pill
            role="button"
            label="List"
            selected={view === "list"}
            onPress={() => {
              onView("list");
            }}
          />
          <Pill
            role="button"
            label="Map"
            selected={view === "map"}
            onPress={() => {
              onView("map");
            }}
          />
        </View>
        {toggle}
      </View>
    </View>
  );
  const savedNote = state.status === "ready" && state.savedAt !== null && (
    <SavedCopyNote
      savedAt={state.savedAt}
      reason={state.reason}
      near={origin.lastSearch ? origin.label : undefined}
    />
  );
  // Spec §8: no in-person meetings here is said plainly, on the list and on the map.
  const noneNearby = `No in-person meetings within ${String(radiusMiles(origin.radiusKm))} miles of ${origin.label}.`;
  const clear = (
    <Button
      kind="text"
      label="Clear"
      hint="Clears the filters, to show every meeting"
      onPress={() => {
        setFilters(NO_FILTERS);
      }}
    />
  );
  // The panel holds the filters; the list adds its order (the map isn't sorted), and the map, which has no summary
  // line, its Clear.
  const panel = filtersOpen && (
    <View style={{ gap: 12 }}>
      <FilterPills filters={filters} />
      {view === "list" && <OrderPills order={order} onOrder={onOrder} />}
      {view === "map" && filtered && <View style={{ alignSelf: "flex-start" }}>{clear}</View>}
    </View>
  );
  // With the starting filters untouched the person chose nothing, so an empty list means today's meetings here are over.
  // Under the starting Day and Time it says which days are empty: tonight's (or today's, before the evening), and
  // tomorrow's when that's empty too.
  const days = `${tonight(now) ? "tonight" : "today"}${tomorrow.length === 0 ? " or tomorrow" : ""}`;
  const nothingLeft = !starting
    ? "No meetings match your filters."
    : untouched
      ? `No more meetings nearby ${days}.`
      : `No meetings match your filters ${days}.`;
  // What's on, or that nothing is, with Clear beside it whenever anything is chosen: the way out is always in view.
  const summary = (
    <View style={row}>
      <AppText tone={listed.length > 0 ? "muted" : "text"} style={{ flexShrink: 1 }}>
        {listed.length > 0 ? summaryLine(listed.length, filters, starting, order) : nothingLeft}
      </AppText>
      {filtered && clear}
    </View>
  );
  const onlineInstead = (
    <>
      <AppText variant="heading" accessibilityRole="header">
        Online meetings you can join
      </AppText>
      <OnlineNowList />
    </>
  );
  // The map stays mounted while a pan's search loads or fails, so the person's view never jumps. Everything that comes
  // and goes with a search sits on a layer over the map, never beside it: the map fills what the column leaves, so
  // anything appearing beside it would resize it, and Apple Maps reports a resize as a new region.
  if (view === "map") {
    const card = { backgroundColor: colors.surface, padding: 12, borderRadius: 8, gap: 8 } as const;
    return (
      <Screen scroll={false}>
        {heading(filtersToggle)}
        <View style={{ flex: 1 }}>
          {/* Before the map, so VoiceOver and TalkBack read it first; zIndex draws it on top. */}
          <View
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              gap: 8,
              pointerEvents: "box-none",
              zIndex: 1,
            }}
          >
            {/* Opening and closing it is the person's doing, but beside the map it would still resize the map. */}
            {panel !== false && <View style={card}>{panel}</View>}
            {backButton !== false && <View style={[card, { alignSelf: "flex-start" }]}>{backButton}</View>}
            {problem !== null && (
              <View style={card}>
                <AppText accessibilityRole="alert">{problem}</AppText>
              </View>
            )}
            {savedNote}
            {state.status === "failed" && (
              <View style={card}>
                <AppText accessibilityRole="alert">{state.message}</AppText>
              </View>
            )}
            {state.status === "ready" && state.data.meetings.length === 0 && (
              <View style={card}>
                <AppText>{noneNearby}</AppText>
              </View>
            )}
            {/* Open, the panel's Clear is the one. */}
            {state.status === "ready" && state.data.meetings.length > 0 && onMap.length === 0 && (
              <View style={[card, row]}>
                <AppText style={{ flexShrink: 1 }}>{nothingLeft}</AppText>
                {!filtersOpen && clear}
              </View>
            )}
            {state.status === "loading" && (
              <View style={[card, { alignSelf: "flex-start" }]}>
                <ActivityIndicator accessibilityLabel="Searching" />
              </View>
            )}
          </View>
          <ResultsMap
            initialRegion={mapRegion}
            meetings={state.status === "failed" ? [] : onMap}
            onMove={(region) => {
              setMapRegion(region);
              onMapMove(region);
            }}
            showsUser={nearPerson}
          />
        </View>
      </Screen>
    );
  }
  if (state.status === "loading")
    return (
      <Screen>
        {heading()}
        <ActivityIndicator accessibilityLabel="Searching" />
      </Screen>
    );
  if (state.status === "failed")
    return (
      <Screen>
        {heading()}
        <AppText accessibilityRole="alert">{state.message}</AppText>
      </Screen>
    );
  // Spec §8: the list offers the online meetings instead of an empty screen.
  if (state.data.meetings.length === 0) {
    return (
      <Screen>
        {heading()}
        {savedNote}
        <AppText>{noneNearby}</AppText>
        {onlineInstead}
      </Screen>
    );
  }
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => (item.kind === "tomorrow" ? "tomorrow" : item.meeting.id)}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {heading(filtersToggle)}
          {panel}
          {savedNote}
          {summary}
          {/* Nothing tonight or tomorrow, and the person chose nothing: a way to the Online tab rather than an empty
              screen, and rather than a long list of online meetings under it (owner decision, 2026-09-30). */}
          {onMap.length === 0 && untouched && <OnlineNowLink />}
        </View>
      }
      renderItem={({ item }) =>
        item.kind === "tomorrow" ? (
          <AppText variant="heading" accessibilityRole="header" style={{ marginTop: 12 }}>
            Tomorrow
          </AppText>
        ) : (
          <MeetingCard
            meeting={item.meeting}
            when={shortWhen(item.meeting)}
            distance={milesLabel(item.meeting.exactKm)}
          />
        )
      }
    />
  );
}

function Nearby() {
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  // Each search remounts the results, so searching the same place again reads again (a stale copy refreshes).
  const [searchCount, setSearchCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<ResultsView>("list");
  // Like the filters, kept in memory only: a new search keeps it, and the app starts again on Soonest.
  const [order, setOrder] = useState<NearbyOrder>("soonest");
  // The Filters panel starts closed each time Nearby opens, and stays as the person left it until then.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The search before the person first moved the map, which "Back to …" returns to; null unless the search is a map
  // area's. Later pans keep it, and any new search forgets it.
  const [backTo, setBackTo] = useState<SearchOrigin | null>(null);
  // Finding a place or a position can take up to 15 seconds. Only the latest thing the person asked for may land: a
  // slow answer to an earlier one must not replace it.
  const latest = useRef(0);

  const begin = useCallback(() => {
    latest.current += 1;
    setProblem(null);
    const ticket = latest.current;
    return () => ticket === latest.current;
  }, []);

  const search = useCallback((next: SearchOrigin) => {
    setOrigin(next);
    setBackTo(null);
    setSearchCount((count) => count + 1);
  }, []);

  // Spec §8: panning searches around the new map center, with the radius from the visible area. It changes the origin
  // without remounting the results, so the map stays as the person left it. useCachedRead reads only when the rounded
  // center or the radius changes, so a small drag sends nothing. A pan is the newest request: "Back to near you" may
  // still be waiting up to 15 seconds for a position, and that late answer mustn't replace the area the person chose.
  const moveMap = (region: MapRegion) => {
    begin();
    if (origin !== null && origin.kind !== "map") setBackTo(origin);
    setOrigin({
      kind: "map",
      label: "this map area",
      point: { latitude: region.latitude, longitude: region.longitude },
      radiusKm: radiusForRegion(region),
    });
  };

  const searchNearMe = useCallback(
    async (when: "tap" | "launch") => {
      const current = begin();
      const result = await currentPosition(when);
      if (!current()) return;
      if (result.status === "found") {
        search({ kind: "me", label: "you", point: result.point, radiusKm: SEARCH_RADIUS_KM });
        return;
      }
      // Opening by itself, Nearby says nothing: "denied" there only means location wasn't allowed before.
      if (when === "tap") setProblem(result.status === "denied" ? DENIED : UNAVAILABLE);
    },
    [begin, search],
  );

  // Decision 10: start near the person when location was allowed on an earlier tap, without showing any dialog.
  useEffect(() => {
    void searchNearMe("launch");
  }, [searchNearMe]);

  async function searchPlace(text: string) {
    const current = begin();
    const label = text.trim();
    if (label === "") {
      setProblem(BLANK);
      return;
    }
    const point = await findPlace(label);
    if (point === null) {
      if (current()) setProblem(notFound(label));
      return;
    }
    // The person did search for it, so it's a recent place even when a newer search has since taken over.
    await rememberPlace(label, point).catch(ignoreRecentPlaceFailure);
    if (current()) search({ kind: "place", label, point, radiusKm: SEARCH_RADIUS_KM });
  }

  function searchRecent(place: RecentPlace) {
    begin();
    // Moves it to the top of the recent list; the search itself needn't wait for that.
    void rememberPlace(place.label, place).catch(ignoreRecentPlaceFailure);
    search({
      kind: "place",
      label: place.label,
      point: { latitude: place.latitude, longitude: place.longitude },
      radiusKm: SEARCH_RADIUS_KM,
    });
  }

  if (origin !== null) {
    return (
      <Results
        key={searchCount}
        origin={origin}
        view={view}
        onView={setView}
        order={order}
        onOrder={setOrder}
        filtersOpen={filtersOpen}
        onFiltersOpen={setFiltersOpen}
        onMapMove={moveMap}
        // Like a pan, a newer request than a "Back to near you" still waiting for a position.
        onChangePlace={() => {
          begin();
          setOrigin(null);
          setBackTo(null);
        }}
        backTo={backTo}
        // A search like any other, so the map remounts around it and its first region report isn't a pan. Near the
        // person, it finds where they are now (location is allowed by then, so nothing is asked).
        onBack={(to) => {
          if (to.kind === "me") void searchNearMe("tap");
          else search(to);
        }}
        problem={problem}
      />
    );
  }
  return (
    <Screen>
      <PlaceSearch
        onPlace={(text) => void searchPlace(text)}
        onRecent={searchRecent}
        onNearMe={() => void searchNearMe("tap")}
        // Typing a place is a newer request: a slow launch position mustn't take the screen from under it.
        onStart={begin}
      />
      {problem !== null && <AppText accessibilityRole="alert">{problem}</AppText>}
      {problem === DENIED && <HandOffButton to="settings" kind="secondary" label="Open Settings" />}
    </Screen>
  );
}

export default function NearbyScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return <Nearby />;
}
