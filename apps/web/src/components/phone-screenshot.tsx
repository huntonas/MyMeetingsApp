import Image from "next/image";

// The App Store screenshots (apps/mobile/store/screenshots), copied to public/screenshots at 640 px wide, about twice
// the size they're shown at. next.config.ts serves them as they are. The frame is plain CSS, not Apple's device art.
const SCREENSHOTS = {
  nearby: {
    file: "1-nearby.webp",
    alt: "The Nearby list: meetings today from now, each with its time, distance, place and the words people chose, like Welcoming 14 and Step study 11.",
  },
  map: {
    file: "2-map.webp",
    alt: "The Nearby map: the meetings around Knoxville, Tennessee, shown as pins, with List, Map and Filters above it.",
  },
  meeting: {
    file: "3-meeting.webp",
    alt: "A meeting's page: Night Owls Group, Saturdays 10 to 11 pm, its address, a Directions button, the meeting type, and what people say: Lots of humor 13, Lively 9, Young crowd 8, Coffee 7, Raise your hand 5.",
  },
  tagPicker: {
    file: "4-tag-picker.webp",
    alt: "Choosing words for a meeting from groups like Crowd, Feel and Practical, with Welcoming and Lively picked: 2 of 6 chosen.",
  },
  me: {
    file: "5-me.webp",
    alt: "The Me tab: a sobriety counter at 365 days, marking 1 year, then your tags and the 988 and SAMHSA help lines.",
  },
} as const;

export function PhoneScreenshot({
  shot,
  preload = false,
}: {
  shot: keyof typeof SCREENSHOTS;
  preload?: boolean;
}) {
  const { file, alt } = SCREENSHOTS[shot];
  return (
    <div className="phone">
      <Image src={`/screenshots/${file}`} alt={alt} width={640} height={1391} preload={preload} />
    </div>
  );
}
