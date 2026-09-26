// The only place app code reads process.env. Add a name here when its first consumer lands.
type EnvName = "DATABASE_URL";

export function readEnv(name: EnvName): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}
