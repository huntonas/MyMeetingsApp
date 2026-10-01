import { useEffect, useState } from "react";
import { View } from "react-native";

import { forgetRecentPlaces, type RecentPlace, recentPlaces } from "@/location/recent-places";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { ConfirmButton } from "@/ui/confirm-button";
import { TextField } from "@/ui/text-field";

interface PlaceSearchProps {
  onPlace: (text: string) => void;
  onRecent: (place: RecentPlace) => void;
  onNearMe: () => void;
  // The person has started typing a place.
  onStart: () => void;
}

export function PlaceSearch({ onPlace, onRecent, onNearMe, onStart }: PlaceSearchProps) {
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  useEffect(() => {
    // Best effort: without a readable list, the search box still works.
    void recentPlaces()
      .then(setRecent)
      .catch(() => undefined);
  }, []);
  return (
    <View style={{ gap: 12 }}>
      <AppText>Search by city, zip code or address, or use your location.</AppText>
      <TextField
        accessibilityLabel="Search for a place"
        placeholder="City, zip code or address"
        value={text}
        onFocus={onStart}
        onChangeText={(next) => {
          if (text === "") onStart();
          setText(next);
        }}
        onSubmitEditing={() => {
          onPlace(text);
        }}
        returnKeyType="search"
        autoCorrect={false}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          label="Search"
          onPress={() => {
            onPlace(text);
          }}
        />
        <Button label="Use my location" kind="secondary" onPress={onNearMe} />
      </View>
      <AppText variant="small" tone="muted">
        {
          "What you type goes only to Apple's or Google's map service, or on some Android phones the phone maker's, to find the place, never to us. Your exact location stays on this phone; a search sends us only a point rounded to about 1 km."
        }
      </AppText>
      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <AppText variant="label" accessibilityRole="header">
            Recent places
          </AppText>
          {recent.map((place) => (
            <Button
              key={place.label}
              kind="secondary"
              label={place.label}
              onPress={() => {
                onRecent(place);
              }}
            />
          ))}
          <ConfirmButton
            label="Clear recent places"
            hint="Asks before deleting your recent places from this phone"
            question="Clear your recent places from this phone?"
            confirmLabel="Clear them"
            confirmHint="Deletes your recent places from this phone"
            cancelLabel="Keep them"
            onConfirm={() => {
              // Best effort: if clearing fails, the list stays as it is.
              void forgetRecentPlaces()
                .then(() => {
                  setRecent([]);
                })
                .catch(() => undefined);
            }}
          />
        </View>
      )}
    </View>
  );
}
