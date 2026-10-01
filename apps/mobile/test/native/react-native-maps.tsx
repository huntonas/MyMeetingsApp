import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

// react-native-maps draws with native Apple Maps / Google Maps views. The map's props land on a plain View, so tests
// can read initialRegion and showsUserLocation, fire touchStart as the person's finger landing on the map, touchMove
// as it moving, markerPress and press as a tap on a marker or on the map, and regionChangeComplete as a region report
// (the map's own first one, or after a touch, the person's pan or zoom). Each marker is a button named by its
// accessibilityLabel; pressing it presses the marker's callout.
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
