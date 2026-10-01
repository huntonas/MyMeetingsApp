// An answer (a geocoder's, a GPS fix's) the test hands over when it chooses.
export function later<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
