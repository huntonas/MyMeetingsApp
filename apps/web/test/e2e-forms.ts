import { ADMIN_AUTHORIZATION, E2E_URL } from "./e2e-server";

// A signed-in page load, as the owner's browser makes it.
export function adminGet(path: string): Promise<Response> {
  return fetch(`${E2E_URL}${path}`, { headers: { authorization: ADMIN_AUTHORIZATION }, redirect: "manual" });
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};
const decode = (value: string) =>
  value.replace(/&(?:amp|quot|#x27|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);

// The fields of the server-rendered <form> whose markup contains `marker` (its aria-label, say), with the values a
// browser would send: inputs as rendered and each select's selected option, or its first. Next.js renders a Server
// Action form with a hidden $ACTION_ID_… field naming the action, so posting these fields is exactly what a browser
// without JavaScript does.
export function formContaining(html: string, marker: string): Record<string, string> {
  const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((markup) => markup.includes(marker));
  if (form === undefined) throw new Error(`no form containing ${marker}`);
  const fields: Record<string, string> = {};
  for (const [input] of form.matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(input)?.[1];
    if (name !== undefined) fields[decode(name)] = decode(/value="([^"]*)"/.exec(input)?.[1] ?? "");
  }
  for (const [, name = "", options = ""] of form.matchAll(
    /<select[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g,
  )) {
    const optionTags = [...options.matchAll(/<option([^>]*)>/g)].map((match) => match[1] ?? "");
    const chosen = optionTags.find((attributes) => attributes.includes('selected=""')) ?? optionTags[0] ?? "";
    fields[name] = decode(/value="([^"]*)"/.exec(chosen)?.[1] ?? "");
  }
  return fields;
}

// Posts a form as the signed-in owner's browser would: from this site, unless `origin` says otherwise.
export function submitForm(
  path: string,
  fields: Record<string, string>,
  origin = E2E_URL,
): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(`${E2E_URL}${path}`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { authorization: ADMIN_AUTHORIZATION, origin },
  });
}
