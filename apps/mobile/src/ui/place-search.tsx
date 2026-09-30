import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";

import { forgetRecentPlaces, type RecentPlace, recentPlaces } from "@/location/recent-places";
import { useColors } from "@/theme/colors";
import { TEXT_STYLES } from "@/theme/type";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

interface PlaceSearchProps {
  onPlace: (text: string) => void;
  onRecent: (place: RecentPlace) => void;
  onNearMe: () => void;
}

export function PlaceSearch({ onPlace, onRecent, onNearMe }: PlaceSearchProps) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  useEffect(() => {
    void recentPlaces().then(setRecent);
  }, []);
  return (
    <View style={{ gap: 12 }}>
      <AppText>Search by city, zip code or address, or use your location.</AppText>
      <TextInput
        accessibilityLabel="Search for a place"
        placeholder="City, zip code or address"
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => {
          onPlace(text);
        }}
        returnKeyType="search"
        autoCorrect={false}
        style={[
          TEXT_STYLES.body,
          {
            minHeight: 44,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 8,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.surface,
          },
        ]}
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
        What you type and your exact location stay on this phone. A search sends only a point rounded to about
        1 km.
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
          <Button
            kind="secondary"
            label="Clear recent places"
            onPress={() => {
              void forgetRecentPlaces().then(() => {
                setRecent([]);
              });
            }}
          />
        </View>
      )}
    </View>
  );
}
