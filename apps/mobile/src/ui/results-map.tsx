import type { MeetingSummary } from "@mymeetingapp/shared";
import { router } from "expo-router";
import MapView, { Marker } from "react-native-maps";

import type { MapRegion } from "@/location/geo";
import { shortWhen } from "@/meetings/schedule";

interface ResultsMapProps {
  initialRegion: MapRegion;
  meetings: Pick<MeetingSummary, "id" | "name" | "day" | "time" | "latitude" | "longitude">[];
  onMove: (region: MapRegion) => void;
  showsUser: boolean;
}

// Apple Maps on iOS, Google Maps on Android (spec §8). The map is only ever given initialRegion, which both platforms
// apply once when the map appears, and is never moved by code, so every region change it reports is the person's own
// pan or zoom. showsUser draws the person's dot on the phone; it must only be set once location is already allowed.
export function ResultsMap({ initialRegion, meetings, onMove, showsUser }: ResultsMapProps) {
  return (
    <MapView
      testID="results-map"
      accessibilityLabel="Map of meetings"
      style={{ flex: 1, minHeight: 320 }}
      initialRegion={initialRegion}
      showsUserLocation={showsUser}
      onRegionChangeComplete={(region) => {
        onMove(region);
      }}
    >
      {meetings.flatMap((meeting) => {
        if (meeting.latitude === null || meeting.longitude === null) return [];
        const when = shortWhen(meeting);
        return [
          <Marker
            key={meeting.id}
            coordinate={{ latitude: meeting.latitude, longitude: meeting.longitude }}
            title={meeting.name}
            description={when}
            accessibilityLabel={`${meeting.name}, ${when}`}
            onCalloutPress={() => {
              router.push(`/meeting/${meeting.id}`);
            }}
          />,
        ];
      })}
    </MapView>
  );
}
