import { ADMIN_AUTHORIZATION, E2E_URL } from "./e2e-server";

// A signed-in page load, as the owner's browser makes it.
export function adminGet(path: string): Promise<Response> {
  return fetch(`${E2E_URL}${path}`, { headers: { authorization: ADMIN_AUTHORIZATION }, redirect: "manual" });
}
