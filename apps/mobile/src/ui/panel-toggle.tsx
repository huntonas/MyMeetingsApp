import { Pill } from "@/ui/pill";

interface PanelToggleProps {
  label: string;
  spokenLabel: string;
  // What the panel holds, for the hint: "Shows the filters", "Hides the filters".
  contents: string;
  // Drawn as a selected pill while the panel holds something chosen.
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
}

// Opens and closes a panel of controls the screen lays out under it (or over a map), drawn as a pill so it sits level
// with the pills beside it. The arrow is only drawn: the expanded state says the same to VoiceOver and TalkBack.
export function PanelToggle({
  label,
  spokenLabel,
  contents,
  selected,
  expanded,
  onToggle,
}: PanelToggleProps) {
  return (
    <Pill
      role="button"
      label={label}
      spokenLabel={spokenLabel}
      hint={`${expanded ? "Hides" : "Shows"} ${contents}`}
      selected={selected}
      expanded={expanded}
      onPress={onToggle}
    />
  );
}
