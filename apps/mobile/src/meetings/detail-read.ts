import { V1MeetingDetailResponse } from "@mymeetingapp/shared";

import { fetchMeeting } from "@/api/reads";

// One meeting, as the meeting page and the Saved tab both read it.
export const detailRead = (id: string) =>
  ({
    kind: "meetingDetail",
    key: `meeting:${id}`,
    schema: V1MeetingDetailResponse,
    fetch: () => fetchMeeting(id),
  }) as const;
