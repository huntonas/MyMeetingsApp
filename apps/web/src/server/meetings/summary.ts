import { eq } from "drizzle-orm";

import { feedMeetings, meetings } from "@/db/schema";

// Identity, location and time zone come from the canonical meeting; everything shown comes from its primary source.
export const summaryColumns = {
  id: meetings.id,
  name: feedMeetings.name,
  day: meetings.day,
  time: meetings.time,
  endTime: feedMeetings.endTime,
  timezone: meetings.timezone,
  types: feedMeetings.types,
  attendance: feedMeetings.attendance,
  locationName: feedMeetings.locationName,
  formattedAddress: feedMeetings.formattedAddress,
  latitude: meetings.latitude,
  longitude: meetings.longitude,
  locationNotes: feedMeetings.locationNotes,
  notes: feedMeetings.notes,
  groupName: feedMeetings.groupName,
  conferenceUrl: feedMeetings.conferenceUrl,
  conferenceUrlNotes: feedMeetings.conferenceUrlNotes,
  conferencePhone: feedMeetings.conferencePhone,
  conferencePhoneNotes: feedMeetings.conferencePhoneNotes,
  sourceUrl: feedMeetings.sourceUrl,
};

// Written once: every meeting-summary query joins a meeting to the feed_meetings row that is its primary source.
export const primarySourceJoin = eq(feedMeetings.id, meetings.primaryFeedMeetingId);
