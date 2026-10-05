import type { MeetingSummary } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { memo, useRef } from "react";
import MapView, { Marker } from "react-native-maps";

import type { MapRegion } from "@/location/geo";
import { fellowshipLabel } from "@/meetings/fellowship";
import { shortWhen } from "@/meetings/schedule";

type MappedMeeting = Pick<
  MeetingSummary,
  "id" | "name" | "day" | "time" | "latitude" | "longitude" | "fellowship"
>;

interface ResultsMapProps {
  initialRegion: MapRegion;
  meetings: MappedMeeting[];
  onMove: (region: MapRegion) => void;
  showsUser: boolean;
}

// One marker per meeting, redrawn only when that meeting changes, so a busy area doesn't redraw every pin on each
// search.
const MeetingMarker = memo(function MeetingMarker({
  meeting,
  latitude,
  longitude,
}: {
  meeting: MappedMeeting;
  latitude: number;
  longitude: number;
}) {
  const when = shortWhen(meeting);
  const fellowship = fellowshipLabel(meeting.fellowship);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      title={meeting.name}
      description={`${fellowship} · ${when}`}
      accessibilityLabel={`${meeting.name}, ${fellowship}, ${when}`}
      onCalloutPress={() => {
        router.push(`/meeting/${meeting.id}`);
      }}
    />
  );
});

// Apple Maps on iOS, Google Maps on Android (spec §8). The map is only ever given initialRegion (applied once, when it
// appears) and is never moved by code. Both platforms still report a region change when the map first appears (the
// region fitted to the screen, so never quite the one given), and Apple Maps can't say whether a change was a
// gesture. So a region change counts as the person's pan or zoom only after they touch this map, and only the first
// one after each touch or finger movement: Apple Maps also reports a region whenever the map's frame changes size
// (with no touch at all), and taking that as a pan would search again, while a pinch or drag that pauses can report a
// region with the fingers still down, and the report as they lift must still count. A tap on a marker or on the map
// moves nothing, so the region report that can follow it (the map making room for a callout) isn't a pan. showsUser
// draws the person's dot on the phone; it must only be set once location is already allowed.
export function ResultsMap({ initialRegion, meetings, onMove, showsUser }: ResultsMapProps) {
  const touched = useRef(false);
  const arm = () => {
    touched.current = true;
  };
  const disarm = () => {
    touched.current = false;
  };
  return (
    <MapView
      testID="results-map"
      accessibilityLabel="Map of meetings"
      style={{ flex: 1, minHeight: 320 }}
      initialRegion={initialRegion}
      showsUserLocation={showsUser}
      onTouchStart={arm}
      onTouchMove={arm}
      onMarkerPress={disarm}
      onPress={disarm}
      onRegionChangeComplete={(region) => {
        if (!touched.current) return;
        disarm();
        onMove(region);
      }}
    >
      {meetings.flatMap((meeting) =>
        meeting.latitude === null || meeting.longitude === null
          ? []
          : [
              <MeetingMarker
                key={meeting.id}
                meeting={meeting}
                latitude={meeting.latitude}
                longitude={meeting.longitude}
              />,
            ],
      )}
    </MapView>
  );
}
