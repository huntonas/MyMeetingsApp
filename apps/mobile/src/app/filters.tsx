import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { FILTER_TYPES, TYPE_LABELS } from "@/meetings/type-labels";
import { WEEKDAYS } from "@/meetings/schedule";
import { useVocabularyTags } from "@/meetings/vocabulary";
import { NO_FILTERS, TIME_ORDER, TIMES_OF_DAY, toggled, useFilters } from "@/search/filters";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { Pill } from "@/ui/pill";
import { Screen } from "@/ui/screen";

const CATEGORY_TITLES = {
  format: "Format",
  sharing: "Sharing",
  crowd: "Crowd",
  feel: "Feel",
  practical: "Practical",
} as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
    </View>
  );
}

export default function FiltersScreen() {
  const { filters, setFilters } = useFilters();
  const tags = [...useVocabularyTags().values()];
  return (
    <Screen>
      <Group title="Day">
        {WEEKDAYS.map((name, day) => (
          <Pill
            key={name}
            label={name}
            selected={filters.days.includes(day)}
            onPress={() => {
              setFilters({ days: toggled(filters.days, day) });
            }}
          />
        ))}
      </Group>
      <Group title="Time of day">
        {TIME_ORDER.map((time) => (
          <Pill
            key={time}
            label={TIMES_OF_DAY[time].label}
            selected={filters.times.includes(time)}
            onPress={() => {
              setFilters({ times: toggled(filters.times, time) });
            }}
          />
        ))}
      </Group>
      <Group title="Meeting type">
        {FILTER_TYPES.map((type) => (
          <Pill
            key={type}
            label={TYPE_LABELS[type]}
            selected={filters.types.includes(type)}
            onPress={() => {
              setFilters({ types: toggled(filters.types, type) });
            }}
          />
        ))}
      </Group>
      <AppText tone="muted">What people say</AppText>
      {TAG_CATEGORIES.map((category) => (
        <Group key={category} title={CATEGORY_TITLES[category]}>
          {tags
            .filter((tag) => tag.category === category)
            .map((tag) => (
              <Pill
                key={tag.slug}
                label={tag.label}
                selected={filters.tags.includes(tag.slug)}
                onPress={() => {
                  setFilters({ tags: toggled(filters.tags, tag.slug) });
                }}
              />
            ))}
        </Group>
      ))}
      <Button
        kind="secondary"
        label="Clear filters"
        onPress={() => {
          setFilters(NO_FILTERS);
        }}
      />
      <Button
        label="Show meetings"
        onPress={() => {
          router.back();
        }}
      />
    </Screen>
  );
}
