// A native location call can wait forever: no GPS fix indoors, or a geocoder with no network. Like the API client,
// src/location gives up after 15 seconds. The native work itself can't be cancelled; its late answer is ignored.
const TIME_LIMIT_MS = 15_000;

export async function withinTimeLimit<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("The phone didn't answer in time"));
    }, TIME_LIMIT_MS);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
