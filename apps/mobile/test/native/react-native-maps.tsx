import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

// react-native-maps draws with native Apple Maps / Google Maps views. The map's props land on a plain View, so tests
// can read initialRegion and showsUserLocation and fire regionChangeComplete as the person's pan or zoom. Each marker
// is a button named by its accessibilityLabel; pressing it presses the marker's callout.
export default function MapView({ children, ...props }: { children?: ReactNode; [prop: string]: unknown }) {
  return <View {...props}>{children}</View>;
}

export function Marker({
  title,
  accessibilityLabel,
  onCalloutPress,
}: {
  title: string;
  accessibilityLabel: string;
  onCalloutPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onCalloutPress}>
      <Text>{title}</Text>
    </Pressable>
  );
}
