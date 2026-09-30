import { View } from "react-native";

// The native date picker (an inline calendar on iOS, a dialog on Android). Its props land on a plain View, so tests
// fire its events as the phone does: `fireEvent(picker, "valueChange", event, date)` for a chosen day, or
// `fireEvent(picker, "dismiss")` for Android's Cancel.
export default function DateTimePicker(props: Record<string, unknown>) {
  return <View testID="date-picker" {...props} />;
}
