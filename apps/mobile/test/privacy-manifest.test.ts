import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import plist from "@expo/plist";
import { z } from "zod";

import appConfig from "../app.config";

const ROOT = path.join(__dirname, "..");
const CONTEXT = { projectRoot: ROOT, staticConfigPath: null, packageJsonPath: null, config: {} };
const SPEC = readFileSync(path.join(ROOT, "../../SPEC.md"), "utf8");

const AccessedApi = z.object({
  NSPrivacyAccessedAPIType: z.string(),
  NSPrivacyAccessedAPITypeReasons: z.array(z.string()),
});
const Manifest = z.object({
  NSPrivacyTracking: z.boolean(),
  NSPrivacyTrackingDomains: z.array(z.string()),
  NSPrivacyCollectedDataTypes: z.array(
    z.object({
      NSPrivacyCollectedDataType: z.string(),
      NSPrivacyCollectedDataTypeLinked: z.boolean(),
      NSPrivacyCollectedDataTypeTracking: z.boolean(),
      NSPrivacyCollectedDataTypePurposes: z.array(z.string()),
    }),
  ),
  NSPrivacyAccessedAPITypes: z.array(AccessedApi),
});
const appManifest = () =>
  Manifest.parse(
    z.object({ ios: z.object({ privacyManifests: z.unknown() }) }).parse(appConfig(CONTEXT)).ios
      .privacyManifests,
  );

// Spec §11's label names, as Apple's manifest spells each data type.
const APPLE_DATA_TYPES: Record<string, string> = {
  "Coarse Location": "NSPrivacyCollectedDataTypeCoarseLocation",
  "Device ID": "NSPrivacyCollectedDataTypeDeviceID",
  "Other User Content": "NSPrivacyCollectedDataTypeOtherUserContent",
};

// The data types listed under spec §11's "Apple App Privacy label" (each bullet is "Name (purposes)").
function specLabel(): string[] {
  const section = SPEC.slice(SPEC.indexOf("## 11. Store requirements"), SPEC.indexOf("## 12."));
  const label = section.slice(
    section.indexOf("**Apple App Privacy label:**"),
    section.indexOf("**Google Play"),
  );
  return [...label.matchAll(/^\s+- ([A-Z][A-Za-z ]+?) \(/gm)].map((match) => match[1] ?? "");
}

// Every PrivacyInfo.xcprivacy shipped by the app's own dependencies and Expo's native ones. react-native-maps' Google
// Maps bundle is left out: it's built only with Google Maps on iOS, which the app doesn't use (Apple Maps).
function libraryManifests(): string[] {
  const Dependencies = z.object({ dependencies: z.record(z.string(), z.string()) });
  const packageDirs = (dir: string, filter: (name: string) => boolean) =>
    Object.keys(
      Dependencies.parse(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))).dependencies,
    )
      .filter(filter)
      .map((name) => realpathSync(path.join(dir, "node_modules", name)));
  const expo = realpathSync(path.join(ROOT, "node_modules/expo"));
  const expoModules = Object.keys(
    Dependencies.parse(JSON.parse(readFileSync(path.join(expo, "package.json"), "utf8"))).dependencies,
  )
    .filter((name) => name.startsWith("expo-"))
    .map((name) => realpathSync(path.join(expo, "..", name)));
  // The workspace's own packages hold no native code.
  return [...packageDirs(ROOT, (name) => !name.startsWith("@mymeetingapp/")), ...expoModules].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith("PrivacyInfo.xcprivacy"))
      .filter((file) => !file.includes("node_modules") && !file.includes("AirGoogleMaps"))
      .map((file) => path.join(dir, file)),
  );
}

describe("the iOS privacy manifest", () => {
  it("declares exactly the data spec §11's App Privacy label lists", () => {
    expect(specLabel()).toEqual(["Coarse Location", "Device ID", "Other User Content"]);
    expect(
      appManifest()
        .NSPrivacyCollectedDataTypes.map((type) => type.NSPrivacyCollectedDataType)
        .sort(),
    ).toEqual(
      specLabel()
        .map((name) => APPLE_DATA_TYPES[name])
        .sort(),
    );
  });

  // Apple counts fraud prevention as App Functionality ("prevent fraud, implement security measures").
  it("marks every type not linked to identity, not for tracking, and used for app functionality only", () => {
    expect(SPEC).toContain("All marked not linked to identity and not used for tracking.");
    const manifest = appManifest();
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    for (const type of manifest.NSPrivacyCollectedDataTypes) {
      expect(type).toMatchObject({
        NSPrivacyCollectedDataTypeLinked: false,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
      });
    }
  });

  it("declares every required-reason API the app's iOS libraries declare, with their reasons", () => {
    const files = libraryManifests();
    expect(
      files.some((file) => file.endsWith(path.join("React", "Resources", "PrivacyInfo.xcprivacy"))),
    ).toBe(true);
    const ours = new Map(
      appManifest().NSPrivacyAccessedAPITypes.map((api) => [
        api.NSPrivacyAccessedAPIType,
        api.NSPrivacyAccessedAPITypeReasons,
      ]),
    );
    for (const file of files) {
      const library = z
        .object({ NSPrivacyAccessedAPITypes: z.array(AccessedApi).optional() })
        .parse(plist.parse(readFileSync(file, "utf8")));
      for (const api of library.NSPrivacyAccessedAPITypes ?? []) {
        const type = api.NSPrivacyAccessedAPIType;
        const declared = ours.get(type) ?? [];
        // Names the library and the API, so a failure says which manifest asked for what.
        const missing = api.NSPrivacyAccessedAPITypeReasons.filter((reason) => !declared.includes(reason));
        expect({ file, type, missing }).toEqual({ file, type, missing: [] });
      }
    }
  });
});
