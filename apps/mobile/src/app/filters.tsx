import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { fellowshipLabel } from "@/meetings/fellowship";
import { FILTER_TYPES, TYPE_LABELS } from "@/meetings/type-labels";
import { WEEKDAYS } from "@/meetings/schedule";
import { groupByCategory, useVocabularyTags } from "@/meetings/vocabulary";
import {
  filtering,
  NO_FILTERS,
  TIME_ORDER,
  TIMES_OF_DAY,
  toggled,
  useFilters,
  useOffered,
} from "@/search/filters";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { Pill } from "@/ui/pill";
import { Screen } from "@/ui/screen";

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
  const { chosen, setFilters } = useFilters();
  const { filters } = filtering(chosen, useNow());
  const groups = groupByCategory(useVocabularyTags().values());
  // Only what the latest answer holds; a chosen pill always shows, so it can be unchosen.
  const { offered } = useOffered();
  const fellowships = [...new Set([...offered.fellowships, ...filters.fellowships])];
  const types = FILTER_TYPES.filter((type) => offered.types.includes(type) || filters.types.includes(type));
  return (
    <Screen>
      {fellowships.length > 0 && (
        <Group title="Fellowship">
          {fellowships.map((fellowship) => (
            <Pill
              key={fellowship}
              label={fellowshipLabel(fellowship)}
              selected={filters.fellowships.includes(fellowship)}
              onPress={() => {
                setFilters({ fellowships: toggled(filters.fellowships, fellowship) });
              }}
            />
          ))}
        </Group>
      )}
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
      {types.length > 0 && (
        <Group title="Meeting type">
          {types.map((type) => (
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
      )}
      <AppText tone="muted">What people say</AppText>
      {groups.map((group) => (
        <Group key={group.category} title={group.title}>
          {group.tags.map((tag) => (
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
