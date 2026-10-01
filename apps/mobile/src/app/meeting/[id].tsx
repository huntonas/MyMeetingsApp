import type { MeetingSummary, TagWriteResponse } from "@mymeetingapp/shared";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useCallback, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { z } from "zod";

import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { appPlatform } from "@/config/app-version";
import { detailRead } from "@/meetings/detail-read";
import { directionsUrl } from "@/meetings/directions";
import { meetingMoved } from "@/meetings/merged";
import { listedTime, WEEKDAYS, yourTime, zoneName } from "@/meetings/schedule";
import { TYPE_LABELS } from "@/meetings/type-labels";
import { saveNewCounts } from "@/tagging/new-counts";
import { AppText } from "@/ui/app-text";
import { HandOffButton } from "@/ui/hand-off-button";
import { SaveButton } from "@/ui/save-button";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";
import { TagChips, useLabelledTags } from "@/ui/tag-chips";
import { YourTags } from "@/ui/your-tags";

const Params = z.object({ id: z.uuid() });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

// Expo's URL (installed over React Native's, which has no hostname getter) parses as a browser does, so userinfo before
// an "@" is never shown as the site the link opens.
const hostOf = (url: string) => URL.parse(url)?.hostname ?? url;

// Keeps digits, "+" and the pause and extension characters (",", ";", "#", "*"). A raw "#" would end the URL (Android
// cuts the call off there, and iOS refuses a tel: URL holding "#" or "*"), so both are percent-encoded.
const dialable = (phone: string) =>
  `tel:${phone
    .replace(/[^\d+,;#*]/g, "")
    .replace(/#/g, "%23")
    .replace(/\*/g, "%2A")}`;

// Spec §5: every tag, with its count, in the server's order.
function WhatPeopleSay({ meeting }: { meeting: MeetingSummary }) {
  const tags = useLabelledTags(meeting.tags);
  return (
    <Section title="What people say">
      {meeting.tagsDisabled ? (
        <AppText>This group has asked not to be tagged.</AppText>
      ) : meeting.tags.length === 0 ? (
        <AppText>No one has tagged this meeting yet.</AppText>
      ) : tags.length === 0 ? (
        // No tag list on the phone yet (a first launch offline): a slug is never shown in place of its name.
        <AppText tone="muted">Tag names haven't loaded yet. They'll appear when you're back online.</AppText>
      ) : (
        <TagChips tags={tags} />
      )}
    </Section>
  );
}

function MeetingInfo({
  meeting,
  onAnswered,
}: {
  meeting: MeetingSummary;
  onAnswered: (response: TagWriteResponse) => void;
}) {
  const until = meeting.endTime === null ? "" : ` to ${listedTime(meeting.endTime)}`;
  const listed = `${WEEKDAYS[meeting.day] ?? ""}s, ${listedTime(meeting.time)}${until}`;
  const phoneTime =
    meeting.timezone === null ? null : yourTime({ ...meeting, timezone: meeting.timezone }, new Date());
  // When the phone's clock differs, the listed time says whose clock it's on.
  const when =
    phoneTime === null || meeting.timezone === null ? listed : `${listed} (${zoneName(meeting.timezone)})`;
  const directions = directionsUrl(meeting, appPlatform());
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {meeting.name}
        </AppText>
        <SaveButton meetingId={meeting.id} />
      </View>
      <AppText>{when}</AppText>
      {phoneTime !== null && <AppText tone="muted">{phoneTime}</AppText>}
      {meeting.attendance !== "online" && (
        <Section title="Where">
          {meeting.locationName !== null && <AppText variant="label">{meeting.locationName}</AppText>}
          {meeting.formattedAddress !== null && <AppText>{meeting.formattedAddress}</AppText>}
          {meeting.locationNotes !== null && <AppText tone="muted">{meeting.locationNotes}</AppText>}
          {directions !== null && <HandOffButton to="maps" label="Directions" url={directions} />}
        </Section>
      )}
      {meeting.attendance !== "in_person" && (
        <Section title="Online">
          {meeting.conferenceUrl !== null && (
            <HandOffButton to="web" label="Join online" url={meeting.conferenceUrl} />
          )}
          {meeting.conferenceUrlNotes !== null && (
            <AppText tone="muted">{meeting.conferenceUrlNotes}</AppText>
          )}
          {meeting.conferencePhone !== null && (
            <>
              <AppText selectable>{meeting.conferencePhone}</AppText>
              <HandOffButton
                to="phone"
                kind="secondary"
                label="Dial in"
                url={dialable(meeting.conferencePhone)}
              />
            </>
          )}
          {meeting.conferencePhoneNotes !== null && (
            <AppText tone="muted">{meeting.conferencePhoneNotes}</AppText>
          )}
        </Section>
      )}
      {meeting.types.length > 0 && (
        <Section title="Meeting type">
          <AppText>{meeting.types.map((type) => TYPE_LABELS[type]).join(" · ")}</AppText>
        </Section>
      )}
      <WhatPeopleSay meeting={meeting} />
      <YourTags meeting={meeting} onAnswered={onAnswered} />
      {(meeting.notes !== null || meeting.groupName !== null) && (
        <Section title="Notes">
          {meeting.groupName !== null && <AppText>{meeting.groupName}</AppText>}
          {meeting.notes !== null && <AppText>{meeting.notes}</AppText>}
        </Section>
      )}
      <AppText variant="small" tone="muted">
        Listings come from local AA service offices and may be out of date.
      </AppText>
      {meeting.sourceUrl !== null && (
        <HandOffButton
          to="web"
          kind="secondary"
          label={`Listed by ${hostOf(meeting.sourceUrl)}`}
          url={meeting.sourceUrl}
        />
      )}
    </>
  );
}

function MeetingDetail({ id }: { id: string }) {
  const { state, refresh, show } = useCachedRead(detailRead(id));
  // Keeps the website's promise that tag changes reach the app within the reuse window, for a page left open.
  useRefreshOnFocus(refresh);
  const survivor = state.status === "ready" ? state.data.meeting.id : id;
  useEffect(() => {
    if (survivor === id) return;
    // Moving the saved copy is best effort, like the cache itself: the page follows the new id either way.
    void meetingMoved(id, survivor)
      .catch(() => undefined)
      .then(() => {
        router.setParams({ id: survivor });
      });
  }, [id, survivor]);
  // A tag write's answer: its counts show at once, and go into the saved copy without making it look newer.
  const answered = useCallback(
    (response: TagWriteResponse) => {
      show((data) => ({ meeting: { ...data.meeting, tags: response.tags } }));
      void saveNewCounts(response).catch(() => undefined);
    },
    [show],
  );
  if (state.status === "loading") return <ActivityIndicator accessibilityLabel="Loading the meeting" />;
  if (state.status === "failed") return <AppText accessibilityRole="alert">{state.message}</AppText>;
  return (
    <>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} reason={state.reason} />}
      <MeetingInfo meeting={state.data.meeting} onAnswered={answered} />
    </>
  );
}

export default function MeetingScreen() {
  const params = Params.safeParse(useLocalSearchParams());
  return (
    <Screen>
      {params.success ? (
        <MeetingDetail id={params.data.id} />
      ) : (
        <AppText>That meeting link isn't valid.</AppText>
      )}
    </Screen>
  );
}
