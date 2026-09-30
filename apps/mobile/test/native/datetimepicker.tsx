import type { AndroidNativeProps } from "@react-native-community/datetimepicker";
import { View } from "react-native";

// The native date picker. On iOS the app renders it (an inline calendar), and its props land on a plain View, so tests
// fire its events as the phone does: `fireEvent(picker, "valueChange", event, date)` for a tapped day. On Android the
// app opens the system dialog with DateTimePickerAndroid.open, which this fake records: a test reads the dialogs opened
// with androidDialogs() and answers the latest one through its onValueChange or onDismiss.
export default function DateTimePicker(props: Record<string, unknown>) {
  return <View testID="date-picker" {...props} />;
}

const dialogs: AndroidNativeProps[] = [];

export const DateTimePickerAndroid = {
  open(args: AndroidNativeProps): void {
    dialogs.push(args);
  },
};

export function androidDialogs(): readonly AndroidNativeProps[] {
  return dialogs;
}

export function resetDatePicker(): void {
  dialogs.length = 0;
}
