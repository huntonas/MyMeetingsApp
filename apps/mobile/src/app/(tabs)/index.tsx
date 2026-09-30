import type { MeetingSearchResponse } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { matchesFilters, NO_FILTERS, useFilters } from "@/search/filters";
import { byExactDistance, describedOrigin, type SearchOrigin, searchRead } from "@/search/nearby";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { HandOffButton } from "@/ui/hand-off-button";
import { MeetingCard } from "@/ui/meeting-card";
import { OnlineNowList } from "@/ui/online-now-list";
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

function FilterPills() {
  const { filters } = useFilters();
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

type ResultsView = "list" | "map";

interface ResultsProps {
  origin: SearchOrigin;
  view: ResultsView;
  onView: (view: ResultsView) => void;
  onMapMove: (region: MapRegion) => void;
  onChangePlace: () => void;
}

function Results({ origin: asked, view, onView, onMapMove, onChangePlace }: ResultsProps) {
  const colors = useColors();
  const { state, refresh } = useCachedRead(searchRead(asked));
  // Offline, the answer may be the last search standing in for this one; everything below describes where it was made.
  const origin =
    state.status === "ready"
      ? describedOrigin(state.data, asked)
      : { label: asked.label, point: asked.point, radiusKm: asked.radiusKm, lastSearch: false };
  // Keeps the website's promise that tag changes reach the app within the reuse window, for a list left open.
  useRefreshOnFocus(refresh);
  const { filters, setFilters } = useFilters();
  // Where the map was left: it opens around the search, and after the person switches to the list and back it opens
  // where they last moved it. The map applies this only when it appears, so updating it never moves a map on screen.
  const [mapRegion, setMapRegion] = useState(() => regionAround(asked.point, asked.radiusKm));
  // The person's dot shows only on a search near them (location is allowed by then), and stays through their pans.
  const [nearPerson] = useState(asked.kind === "me");
  // The last meetings found, kept on the map while a pan's search loads so the markers don't flash off and on. Updated
  // during render (React's pattern for state that follows a changing value), so a new answer shows in the same render.
  const [lastFound, setLastFound] = useState<MeetingSearchResponse["meetings"]>([]);
  if (state.status === "ready" && state.data.meetings !== lastFound) setLastFound(state.data.meetings);
  const onMap = useMemo(
    () => lastFound.filter((meeting) => matchesFilters(meeting, filters)),
    [lastFound, filters],
  );
  const heading = (
    <View style={{ gap: 12 }}>
      <AppText variant="title" accessibilityRole="header">
        {`Near ${origin.label}`}
      </AppText>
      <Button kind="secondary" label="Change place" onPress={onChangePlace} />
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
  const noMatches = (
    <>
      <AppText>No meetings match your filters.</AppText>
      <Button
        kind="secondary"
        label="Clear filters"
        onPress={() => {
          setFilters(NO_FILTERS);
        }}
      />
    </>
  );
  // The map stays mounted while a pan's search loads or fails, so the person's view never jumps.
  if (view === "map") {
    return (
      <Screen scroll={false}>
        {heading}
        {savedNote}
        {state.status === "failed" && <AppText accessibilityRole="alert">{state.message}</AppText>}
        <FilterPills />
        {state.status === "ready" && state.data.meetings.length === 0 && <AppText>{noneNearby}</AppText>}
        {state.status === "ready" && state.data.meetings.length > 0 && onMap.length === 0 && noMatches}
        <ResultsMap
          initialRegion={mapRegion}
          meetings={state.status === "failed" ? [] : onMap}
          onMove={(region) => {
            setMapRegion(region);
            onMapMove(region);
          }}
          showsUser={nearPerson}
        />
        {state.status === "loading" && <ActivityIndicator accessibilityLabel="Searching" />}
      </Screen>
    );
  }
  if (state.status === "loading")
    return (
      <Screen>
        {heading}
        <ActivityIndicator accessibilityLabel="Searching" />
      </Screen>
    );
  if (state.status === "failed")
    return (
      <Screen>
        {heading}
        <AppText accessibilityRole="alert">{state.message}</AppText>
      </Screen>
    );
  const sorted = byExactDistance(state.data.meetings, origin.point);
  // The list offers the online meetings instead of an empty screen.
  if (sorted.length === 0) {
    return (
      <Screen>
        {heading}
        {savedNote}
        <AppText>{noneNearby}</AppText>
        <AppText variant="heading" accessibilityRole="header">
          Online meetings you can join
        </AppText>
        <OnlineNowList />
      </Screen>
    );
  }
  const shown = sorted.filter((meeting) => matchesFilters(meeting, filters));
  return (
    <FlatList
      data={shown}
      keyExtractor={(meeting) => meeting.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {heading}
          {savedNote}
          <FilterPills />
          {shown.length > 0 && (
            <AppText tone="muted">{`${String(shown.length)} ${shown.length === 1 ? "meeting" : "meetings"}`}</AppText>
          )}
          {shown.length === 0 && noMatches}
        </View>
      }
      renderItem={({ item }) => (
        <MeetingCard meeting={item} when={shortWhen(item)} distance={milesLabel(item.exactKm)} />
      )}
    />
  );
}

function Nearby() {
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  // Each search remounts the results, so searching the same place again reads again (a stale copy refreshes).
  const [searchCount, setSearchCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<ResultsView>("list");
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
    setSearchCount((count) => count + 1);
  }, []);

  // Spec §8: panning searches around the new map center, with the radius from the visible area. It changes the origin
  // without remounting the results, so the map stays as the person left it. useCachedRead reads only when the rounded
  // center or the radius changes, so a small drag sends nothing.
  const moveMap = useCallback((region: MapRegion) => {
    setOrigin({
      kind: "map",
      label: "this map area",
      point: { latitude: region.latitude, longitude: region.longitude },
      radiusKm: radiusForRegion(region),
    });
  }, []);

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
        onMapMove={moveMap}
        onChangePlace={() => {
          setOrigin(null);
        }}
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
