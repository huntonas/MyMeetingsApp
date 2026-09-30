# Staging Backend and TestFlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A long-lived `staging` backend (Vercel custom environment, its own Neon branch, its own pepper, no crons) at a stable public URL, and a TestFlight build of the app that talks only to it. Staging must be ready for Phase 5b, when the app starts writing tags.

**Architecture:**

- **Staging on Vercel.** A custom environment `staging` in project `mymeetingapp`. It tracks the git branch `staging` and serves `https://mymeetingapp-staging.vercel.app`, a project domain attached to the environment. Its variables are its own. None are imported from Preview, and it has no `NEON_*` or `CRON_SECRET`.
- **Staging on Neon.** A branch `staging` whose parent is `seed`. It starts with seed's reference data (vocabulary, feeds, and the meetings copied from production on 2026-09-29). Its own build creates the device tables, empty. Production data never flows into it.
- **Code.** Two small changes. `resetPreviewBranch()` switches on `VERCEL_TARGET_ENV`, because Vercel reports a custom environment as `VERCEL_ENV=preview`. `proxy.ts` sends `X-Robots-Tag: noindex` on public pages everywhere except production.
- **App.** An EAS project under `huntonas`, `eas.json` with `development`, `testflight` (store distribution, staging URL) and `production` (store distribution, production URL) profiles, remote build numbers, Node 24 and pnpm 12.6.0. A placeholder icon, the Android adaptive icon and the splash come from one SVG in the repo, and export compliance is answered in the config.

**Tech Stack:** Vercel CLI 55 (`vercel api`, `vercel env`), Neon API v2 (project-scoped key), Next.js 16 `proxy.ts`, vitest 5, Expo SDK 57 (`expo-splash-screen` config plugin), `eas-cli@24.8.0` through `pnpm dlx` (the version Phase 5a pins; the global 20.5.1 is out of date), jest 29, and `rsvg-convert` 2.62 (Homebrew librsvg, already on the Mac).

**Spec:** `SPEC.md` §2 (privacy), §8, §11 (stores), §12 (infrastructure, "Never branch previews from production"). Standards: `docs/standards.md` (binding). Runbooks: `docs/deploy.md`, `docs/mobile.md`.

**Depends on:** branch `phase-5a-mobile`. This plan **replaces Phase 5a Task 14 Step 2** (EAS link and `eas.json`); Task 14's other steps are unchanged. It doesn't touch Phase 6 scope (attestation, privacy manifest, listings, App Privacy label, Play). It only creates the App Store Connect record early.

## Findings (with evidence)

1. **`VERCEL_ENV` on a custom environment is `preview`.** Vercel's guide says: "If your project uses custom environments such as staging or QA, `VERCEL_ENV` reports those as `preview`. Read `VERCEL_TARGET_ENV` instead, which returns `production`, `preview`, `development`, or the name of the custom environment" (vercel.com/kb/guide/dynamic-build-commands). The system variables page lists both variables at build time and at runtime.
   - Today, `apps/web/src/db/preview-branch.ts` resets only when `readEnv("VERCEL_ENV") === "preview"`. A staging build would therefore run the restore.
   - With no `NEON_*` variables on staging, that build fails at `NEON_API_KEY must be set`.
   - If Preview's variables were imported into staging, the build would restore the `preview` branch and then migrate whatever `DATABASE_URL_UNPOOLED` names.
   - `VERCEL_ENV` has no other reader (grep over `apps`, `packages`, `tools`). Task 1 switches the reset to `VERCEL_TARGET_ENV === "preview"`.
2. **Crons never run on staging.** "Vercel makes an HTTP GET request to your project's production deployment URL" (vercel.com/docs/cron-jobs), and SPEC §12 already says "Cron only runs on production deployments". Staging therefore has no feed sync (no duplicate crawling) and no nightly maintenance. Staging also gets no `CRON_SECRET`, so `assertCronRequest` refuses both routes to everyone, the owner included.
3. **Meetings on staging.** Recommendation: a one-time copy, made by branching `staging` from `seed`. `seed` was made from `main` on 2026-09-29, before any device table existed (deploy.md). It's therefore production's meetings and no device data, and branching from it is already allowed ("never branch from `main` once device tables exist").
   - A periodic refresh from `main` would need a new tested copy script and production credentials on a schedule. That's more than staging needs until the snapshot proves stale (owner decision 1).
   - Its own sync is ruled out, because it would crawl the feeds twice.
4. **Sensitive variables can't be used on staging.** "You can only create sensitive environment variables in the preview and production environments" (vercel.com/docs/environment-variables/sensitive-environment-variables), and `vercel env add --help` says `--sensitive` is "for Production or Preview". Staging values are encrypted but readable by team members. The generated ones still go into `apps/web/.env.secrets`, per the owner's rule.
5. **Every variable can be set with `vercel env add <NAME> staging`** (vercel.com/docs/cli/target), from stdin, so no value appears on a command line or in output.
6. **Stable URL and git branch.** A custom environment takes "Branch Tracking to automatically deploy whenever a matching branch is pushed" and "Attach a Domain to give a persistent URL" (vercel.com/docs/deployments/environments). The REST API adds a domain with `customEnvironmentId` (`POST /v10/projects/{id}/domains`).
   - The plan attaches `mymeetingapp-staging.vercel.app`, with branch tracking `equals staging`, and doesn't rely on any auto-generated name.
   - Pro allows one custom environment per project, at no extra cost.
7. **Deployment protection.** Standard Protection "protects all domains except production domains", so staging would ask a TestFlight phone to log in to Vercel. A Deployment Protection Exception makes one preview-type domain public. It's free, and it's set in the dashboard only (Owner step).
8. **noindex.** Vercel adds `X-Robots-Tag: noindex` to preview deployments but omits it "when a custom domain is assigned to a non-production branch". Once public, staging would be indexable, so Task 2 adds the header in `proxy.ts`.
9. **AI Gateway.** It authenticates with the project's Vercel OIDC token, which every deployment of the project gets (`VERCEL_OIDC_TOKEN` at build time, and the `x-vercel-oidc-token` header at runtime), so no key is needed on staging. Staging gets `SUGGESTION_MODEL=openai/gpt-5-nano`.
10. **EAS.**
    - `eas init` creates `@huntonas/mymeetingapp` on Expo's servers. With a dynamic `app.config.ts` it "cannot be automatically modified": it prints `extra.eas.projectId` and exits non-zero (eas-cli `commands/project/init.js`). The ID is added by hand, under a test.
    - `owner: "huntonas"` is needed because the login also belongs to `betuwings` (`eas whoami`).
    - `eas.json` `"node"` must be an exact version. `"24.x"` is rejected, because the schema runs `semver.valid()` on it (`@expo/eas-json@24.8.0` `build/schema.js`). The plan uses `24.21.0`, the local Node 24.
    - EAS's SDK 57 image ships Node 22 and pnpm 11. `"pnpm": "12.6.0"` in `eas.json` makes EAS install the root `packageManager`'s version. (The first build used `"corepack": true` instead and failed: EAS's own pnpm install collided with corepack's shim, EEXIST.) No `eas-build-pre-install` hook is needed.
    - `minimumReleaseAge` only affects resolution, and a frozen-lockfile install doesn't resolve.
    - `appVersionSource: "remote"` with `autoIncrement: true`: "The build version values stored in app config are ignored", so no `buildNumber` goes into the config.
11. **What EAS uploads.** It clones the git root (the whole monorepo) and then copies the working tree, skipping everything any `.gitignore` ignores (eas-cli `vcs/clients/git.js`, `vcs/local.js`). A `.easignore` would _replace_ the `.gitignore` rules.
    - The root `.gitignore` already drops `.env` and `.env.*` (so `apps/web/.env.secrets`, `apps/web/.env.local` and `apps/mobile/.env`), and `apps/mobile/.gitignore` drops `/ios/`.
    - No `.easignore`, therefore. Task 7 proves the point with `eas build:inspect`.
12. **App Store Connect.** "`eas submit` creates an app record automatically on App Store Connect when you submit your first build" (docs.expo.dev/submit/testflight). The owner signs in with an Apple ID and 2FA, and creates the internal testing group. `ios.config.usesNonExemptEncryption: false` is Expo's key for `ITSAppUsesNonExemptEncryption` (config-types 57), so builds don't stop at "Missing Compliance".
13. **Icon tools on this Mac:** `rsvg-convert` 2.62 and `sips` are present; ImageMagick isn't. Python PIL exists only in Anaconda, so it isn't a project tool. `rsvg-convert` writes an opaque render as RGB (PNG colour type 2, no alpha channel) and a transparent one as RGBA (colour type 6); both were checked in the scratchpad.

## Owner decisions needed

Each item has a recommendation, and the plan follows it.

1. **Meetings on staging:** use the one-time `seed` snapshot (2026-09-29). Task 3 counts its meetings. If the snapshot turns out too thin or stale, a later tested `db:copy-meetings` script (feeds, meetings and aliases only, from `main`) is the refresh; it isn't built now.
2. **Maintenance on staging:** off until Phase 5b. Before 5b nothing writes device data to staging. Once testers tag, staging holds real device hashes under the 7-day `tag_audit` promise.
   - **Recommendation for the 5b plan:** a nightly GitHub Actions call to staging's `/api/cron/maintenance`, using a staging-only `CRON_SECRET`.
3. **Staging URL:** `mymeetingapp-staging.vercel.app` (no DNS needed). The alternative is `staging.goodersoftwarellc.com`. If the name is taken, Task 3 falls back to `mymeetingapp-staging-huntonas.vercel.app` and updates the three places that name it.
4. **Testers:** internal TestFlight only (App Store Connect users, no Beta App Review). External testers would need Beta App Review and test information.
5. **Icon:** a placeholder of eight cream dots around a ring (chairs around a table), on the accent blue. It uses no "AA" (§11). Replace it any time by editing `mark.svg` and re-rendering.

## Decisions this plan makes (confirm at review)

1. The `staging` git branch receives only commits whose migrations are final (normally `git push origin main:staging`). A branch whose migrations are later regenerated would leave staging's database out of step, as happened to per-deployment previews.
2. The first staging deploy is this branch's HEAD, which has no migrations beyond `main` (`git diff origin/main...HEAD -- apps/web/drizzle` is empty).
3. The `development` profile sets no `EXPO_PUBLIC_SERVER_URL`: a dev client runs JavaScript from Metro, which takes the value from `apps/mobile/.env`. Only the store profiles embed a bundle.
4. `expo-splash-screen` is added. It's the SDK's own module, and its config plugin is the only supported way to set the native splash. It is the only new dependency; the icon rendering uses no npm package.
5. The icon, adaptive icon and splash share one source, `apps/mobile/assets/mark.svg`, rendered by `apps/mobile/scripts/render-icons.sh`. The PNGs are committed, so CI never needs `rsvg-convert`.
6. The colours in `app.config.ts` and `mark.svg` are the light palette's `accent` `#1f5f8b` and `bg` `#fbfaf7` from `src/theme/colors.ts`. `app.config.ts` can't import `colors.ts` (it pulls in `react-native`), so the standards row gains this one exception.

## Global Constraints

- `docs/standards.md`: `pnpm check` passes on every commit; `pnpm knip:production` and `pnpm --filter web test:e2e` pass at the end; failing test first; no dead code; `readEnv` is the only reader of environment variables.
- §2: never log request headers, bodies, IPs or coordinates. No command in this plan prints a secret. Values are generated and piped in the same shell, and appended to `apps/web/.env.secrets` (mode 600).
- Production device data never reaches `seed`, `preview` or `staging`. Nothing is branched from, restored from or copied from `main`.
- Claude never enters an Apple ID password or a 2FA code. **Owner** steps are anything needing a password or 2FA, a dashboard-only toggle, or approving a charge.
- Each bash block below runs as **one** command (shell state doesn't persist between calls), from the repo root unless it says otherwise.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **A staging build touches only the staging database.** It must never restore `preview`, even though Vercel reports `VERCEL_ENV=preview`. Pinned in Task 1 ("leaves the database alone on a custom environment…"), and checked in Task 4 against the build log and `preview`'s restore time in Neon.
2. **A TestFlight build never talks to production.** Pinned in Task 7 (`eas-profiles.test.ts`), and checked in Task 9 by the testers' requests appearing in staging's logs.
3. **No secret leaves the Mac in the EAS upload.** Checked in Task 7 Step 5: `build:inspect` shows no `.env*` file besides `.env.example`, and no `ios/`.
4. **Staging is public but not indexed; production stays indexable.** Pinned in Task 2 (`proxy.test.ts`), and checked in Task 4 with `curl -I`. Previews must still answer 401 to anonymous requests.
5. **No production device data on staging.** Staging's parent is `seed`, it has no `NEON_*` variables, and it has no `CRON_SECRET`, so nothing restores it or runs a sync against it. Task 3's checks: parent name, device tables absent before the first build.

## Order of operations

1. Tasks 1–2 (code), then Task 3 (Vercel and Neon, with one Owner step), then Task 4 (deploy and verify). **Staging is live and verified before anything else.**
2. Tasks 5–8: icon, export compliance, EAS project and `eas.json`, docs.
3. Task 9: the owner's first build, submit and TestFlight install.

---

### Task 1: Staging builds never reset a database

**Files:** Modify `apps/web/src/db/preview-branch.ts`, `apps/web/src/env.ts`, `apps/web/test/preview-branch.test.ts`.

- [ ] **Step 1: Failing test.** In `preview-branch.test.ts`, make `stubPreviewBuild` set both variables Vercel sets on a preview (`vi.stubEnv("VERCEL_ENV", "preview")` and `vi.stubEnv("VERCEL_TARGET_ENV", "preview")`). Then add:

```ts
it("leaves the database alone on a custom environment, which Vercel also reports as VERCEL_ENV=preview", async () => {
  const server = await neon();
  stubPreviewBuild(server.baseUrl);
  vi.stubEnv("VERCEL_TARGET_ENV", "staging");
  expect(await resetPreviewBranch()).toBe("skipped");
  expect(server.requests).toEqual([]);
});
```

Change the existing `it.each([undefined, "production", "development"])` to stub `VERCEL_TARGET_ENV` rather than `VERCEL_ENV`, and name it "leaves the database alone when VERCEL_TARGET_ENV is %j".

- [ ] **Step 2: Watch it fail.** `pnpm --filter web exec vitest run preview-branch`. Expected: the new test fails with `expected 'reset' to be 'skipped'`.
- [ ] **Step 3: Make it pass.** In `preview-branch.ts`: `if (readEnv("VERCEL_TARGET_ENV") !== "preview") return "skipped";`. Add a comment line: "Vercel reports a custom environment such as staging as VERCEL_ENV=preview; only VERCEL_TARGET_ENV tells them apart." In `env.ts`, replace `"VERCEL_ENV"` with `"VERCEL_TARGET_ENV"`, since nothing else reads it.
- [ ] **Step 4:** `pnpm check`, then commit `fix(web): reset the preview database only on preview builds, never on a custom environment`.

### Task 2: noindex everywhere but production

**Files:** Modify `apps/web/src/proxy.ts`, `apps/web/test/proxy.test.ts`, `docs/standards.md` (the "Admin access" row: "…and sends `noindex` on every response, and on public pages too outside production").

- [ ] **Step 1: Failing test.** Add to `proxy.test.ts`:

```ts
describe("indexing outside production", () => {
  it.each(["staging", "preview"])("marks public pages noindex on %s", async (target) => {
    vi.stubEnv("VERCEL_TARGET_ENV", target);
    const res = await proxy(request({ path: "/privacy" }));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("leaves production's public pages indexable", async () => {
    vi.stubEnv("VERCEL_TARGET_ENV", "production");
    expect((await proxy(request({ path: "/privacy" }))).headers.get("x-robots-tag")).toBeNull();
  });
});
```

- [ ] **Step 2: Watch it fail.** `pnpm --filter web exec vitest run proxy`. Expected: two failures, receiving `null`.
- [ ] **Step 3: Make it pass.** In `proxy.ts`, import `readEnv` and add:

```ts
// Search engines index production only. Staging is public so TestFlight builds can reach it (Vercel drops its own
// preview noindex once a domain is attached), so its pages say noindex; local builds have no target and are left alone.
function publicHeaders(): Record<string, string> {
  const target = readEnv("VERCEL_TARGET_ENV");
  return target === undefined || target === "production" ? {} : { "X-Robots-Tag": "noindex, nofollow" };
}
```

Return `NextResponse.next({ headers: publicHeaders() })` for paths outside `/metrics`. The existing "serves public pages to anyone" test (no target, header `null`) must stay green.

- [ ] **Step 4:** `pnpm check`, then commit `feat(web): noindex on every page outside production`.

### Task 3: Create staging on Vercel and Neon

**Files:** Modify `apps/web/.env.secrets` (git-ignored; append only).

- [ ] **Step 1 (Owner):** Give Claude the Neon project ID (Neon console → project → Settings). It isn't secret. Claude doesn't read production variables to get it.
- [ ] **Step 2 (Claude): create the environment.** Don't use the dashboard's "Import variables".

```bash
cd apps/web && printf '%s' '{"slug":"staging","description":"Backend for TestFlight builds","branchMatcher":{"type":"equals","pattern":"staging"}}' \
  | vercel api /v9/projects/mymeetingapp/custom-environments -X POST --input - --scope huntonas-projects | jq '{id, slug, type, branchMatcher}'
```

Expected: `slug: "staging"`, `type: "preview"`, and an `id` (`env_…`). Record the id as `<ENV_ID>`.

- [ ] **Step 3 (Claude): attach the stable domain.**

```bash
cd apps/web && printf '{"name":"mymeetingapp-staging.vercel.app","customEnvironmentId":"<ENV_ID>"}' \
  | vercel api /v10/projects/mymeetingapp/domains -X POST --input - --scope huntonas-projects | jq '{name, customEnvironmentId, verified}'
```

Expected: `verified: true`. If the name is taken, use `mymeetingapp-staging-huntonas.vercel.app` here, in `SITE_URL` (Step 5) and in `eas.json` (Task 7).

- [ ] **Step 4 (Claude): the Neon branch and the database variables.** The parent is `seed`. The response is filtered with `jq`, because it contains connection strings.

```bash
cd apps/web && set -eu
KEY="$(sed -n 's/^NEON_API_KEY=//p' .env.secrets)"; API="https://console.neon.tech/api/v2/projects/<PROJECT_ID>"
neon() { curl -fsS -H "Authorization: Bearer $KEY" -H 'content-type: application/json' "$@"; }
SEED="$(neon "$API/branches" | jq -r '.branches[] | select(.name=="seed") | .id')"
neon -X POST "$API/branches" -d "{\"branch\":{\"name\":\"staging\",\"parent_id\":\"$SEED\"},\"endpoints\":[{\"type\":\"read_write\"}]}" \
  | jq '{id: .branch.id, name: .branch.name, parent_id: .branch.parent_id}'
STAGING="$(neon "$API/branches" | jq -r '.branches[] | select(.name=="staging") | .id')"
neon "$API/branches/$STAGING/databases" | jq -r '.databases[] | "\(.name) \(.owner_name)"'
```

Then, with `<DB>` and `<ROLE>` from that output (and the same first three lines plus the `STAGING=` line):

```bash
uri() { neon "$API/connection_uri?branch_id=$STAGING&database_name=<DB>&role_name=<ROLE>&pooled=$1" | jq -j .uri; }
uri true  | vercel env add DATABASE_URL staging --yes
uri false | vercel env add DATABASE_URL_UNPOOLED staging --yes
psql "$(uri false)" -Atc "select count(*) from meetings where archived_at is null" -c "select count(*) from feeds" \
  -c "select to_regclass('public.tag_submissions') is null"
```

Expected: `parent_id` is seed's id; a non-zero meeting and feed count (tell the owner the counts for decision 1); `t`, meaning the device tables don't exist yet.

- [ ] **Step 5 (Claude): the other variables.** Secrets are generated, stored and piped in one shell and never printed. Save the metrics password in the password manager too (Owner).

```bash
cd apps/web && set -eu
pepper="$(openssl rand -hex 32)"; password="$(openssl rand -base64 30)"
printf 'DEVICE_ID_PEPPER_STAGING=%s\nMETRICS_USER_STAGING=owner\nMETRICS_PASSWORD_STAGING=%s\n' "$pepper" "$password" >> .env.secrets
printf '%s' "$pepper"   | vercel env add DEVICE_ID_PEPPER staging --yes
printf 'owner'          | vercel env add METRICS_USER staging --yes
printf '%s' "$password" | vercel env add METRICS_PASSWORD staging --yes
printf 'https://mymeetingapp-staging.vercel.app' | vercel env add SITE_URL staging --yes
printf 'off'            | vercel env add REQUIRE_ATTESTATION staging --yes
printf 'openai/gpt-5-nano' | vercel env add SUGGESTION_MODEL staging --yes
vercel env ls staging
```

Expected: exactly `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEVICE_ID_PEPPER`, `METRICS_USER`, `METRICS_PASSWORD`, `SITE_URL`, `REQUIRE_ATTESTATION` and `SUGGESTION_MODEL`. There is no `CRON_SECRET` and no `NEON_*`. `MIN_VERSION_*`, `LATEST_VERSION_*` and `FEATURE_*` stay unset, as in production.

- [ ] **Step 6 (Owner, dashboard only):** Vercel → mymeetingapp → Settings → Deployment Protection → Deployment Protection Exceptions → Add Domain → `mymeetingapp-staging.vercel.app` → type `unprotect my domain` → Confirm.

### Task 4: Deploy staging, verify it, and write the runbook

**Files:** Modify `docs/deploy.md`.

- [ ] **Step 1 (Claude, with the owner's go-ahead to push):** `git push origin HEAD:refs/heads/staging`. Watch the build with `vercel inspect <deployment url> --logs`. Expected, in order: `Not a preview build; database branch left alone`, the drizzle migrations applying Phase 3+ tables, and then the Next build.
- [ ] **Step 2 (Claude): verify.**

```bash
S=https://mymeetingapp-staging.vercel.app
curl -s -o /dev/null -w '%{http_code}\n' "$S/api/v1/config"                           # 200, no Vercel login page
curl -fsS "$S/api/v1/vocabulary" | jq '.tags | length'                                   # the starter tags
curl -fsS -X POST "$S/api/v1/meetings/search" -H 'content-type: application/json' \
  -d '{"lat":35.76,"lng":-83.97,"radiusKm":25}' | jq '.meetings | length'                # > 0 (Maryville, TN)
curl -sI "$S/" | grep -i '^x-robots-tag'                                                 # noindex, nofollow
curl -sI https://mymeetingapp.vercel.app/ | grep -ci '^x-robots-tag'                     # 0 (production indexable)
curl -s -o /dev/null -w '%{http_code}\n' "$S/metrics"                                    # 401
curl -s -o /dev/null -w '%{http_code}\n' "$S/api/cron/sync-feeds"                        # 401 (no CRON_SECRET)
curl -s -o /dev/null -w '%{http_code}\n' "$(vercel ls mymeetingapp --environment preview 2>/dev/null | grep -o 'https://[^ ]*' | head -1)/"  # 401: previews still protected
```

In the Neon console (Owner, or the API), `preview`'s last restore time didn't change with this build, and `staging`'s parent is `seed`. Vercel → Settings → Cron Jobs lists the two crons against production only.

- [ ] **Step 3: runbook.** Add "## Staging (TestFlight backend)" to `docs/deploy.md`:
  - What it is: the custom environment `staging` (`VERCEL_TARGET_ENV=staging`, which Vercel also reports as `VERCEL_ENV=preview`), at `https://mymeetingapp-staging.vercel.app`, public through a Deployment Protection Exception, with noindex from `proxy.ts`.
  - How to deploy: `git push origin main:staging` (only commits whose migrations are final); builds skip the preview reset and migrate staging's own branch.
  - Database: the Neon branch `staging`, whose parent is `seed`, holding the 2026-09-29 meetings snapshot and testers' own device data. It is never restored from `main` or copied from it. Refresh: owner decision 1.
  - Crons: none (Vercel runs crons only on production). There is no `CRON_SECRET`, so nothing can run a sync or maintenance there. Phase 5b decides maintenance (owner decision 2).
  - Variables: the list from Task 3 Step 5. None can be Sensitive (a Vercel limit), and none is ever imported from Preview. Add `DEVICE_ID_PEPPER_STAGING`, `METRICS_USER_STAGING` and `METRICS_PASSWORD_STAGING` to "Local secrets file".
  - Setting it up again: Task 3 Steps 2–6, in that order.
  - Add to "Checking a deployment": the Step 2 checks for staging.
- [ ] **Step 4:** `pnpm check`, then commit `docs(deploy): the staging environment for TestFlight`.

### Task 5: Icon, Android adaptive icon and splash

**Files:** Create `apps/mobile/assets/mark.svg`, `apps/mobile/scripts/render-icons.sh`, `apps/mobile/assets/icon.png`, `apps/mobile/assets/mark.png`. Modify `apps/mobile/app.config.ts`, `apps/mobile/test/app-shell.test.tsx`, `apps/mobile/package.json` (`"icons": "sh scripts/render-icons.sh"` and `expo-splash-screen`), `docs/standards.md` (the "Colours and text in the app" row: "…except `app.config.ts`'s icon and splash colours, which are `accent` and `bg` from the light palette").

- [ ] **Step 1: Failing tests.** In `app-shell.test.tsx`, extend `Config` with `icon: z.string()` and `android.adaptiveIcon: z.object({ foregroundImage: z.string(), monochromeImage: z.string(), backgroundColor: z.string() })`. Add a `SplashPlugin` tuple (`z.literal("expo-splash-screen")` with `{ image, imageWidth, backgroundColor }`, strict) and, under "the app config":

```ts
// A PNG's IHDR: width and height at bytes 16 and 20, colour type at byte 25 (2 = RGB, 6 = RGB with alpha).
function png(relative: string) {
  const bytes = readFileSync(path.join(CONTEXT.projectRoot, relative));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

it("ships a 1024-pixel square icon with no transparency, as the App Store requires", () => {
  expect(png(Config.parse(appConfig(CONTEXT)).icon)).toEqual({ width: 1024, height: 1024, colourType: 2 });
});

it("draws the Android adaptive icon and the splash as the mark on the accent blue", () => {
  const config = Config.parse(appConfig(CONTEXT));
  const { foregroundImage, monochromeImage, backgroundColor } = config.android.adaptiveIcon;
  expect(backgroundColor).toBe("#1f5f8b");
  expect(monochromeImage).toBe(foregroundImage);
  expect(png(foregroundImage)).toEqual({ width: 1024, height: 1024, colourType: 6 });
  const [, splash] = SplashPlugin.parse(config.plugins.find((plugin) => plugin[0] === "expo-splash-screen"));
  expect(splash).toEqual({ image: foregroundImage, imageWidth: 200, backgroundColor: "#1f5f8b" });
});
```

- [ ] **Step 2: Watch them fail.** `pnpm --filter mobile test -- app-shell`. Expected: a zod failure because `icon` is missing.
- [ ] **Step 3: The art.** `apps/mobile/assets/mark.svg`: eight dots at radius 236 around a ring. The ring's outer edge is at 280 px from the centre, inside Android's 66 % safe zone (338 px).

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- The app mark: eight chairs around a table. Cream (colors.ts light bg) on transparent; render-icons.sh adds the
       accent blue for the iOS icon. -->
  <g fill="#fbfaf7">
    <circle cx="512" cy="276" r="44"/><circle cx="678.9" cy="345.1" r="44"/><circle cx="748" cy="512" r="44"/>
    <circle cx="678.9" cy="678.9" r="44"/><circle cx="512" cy="748" r="44"/><circle cx="345.1" cy="678.9" r="44"/>
    <circle cx="276" cy="512" r="44"/><circle cx="345.1" cy="345.1" r="44"/>
  </g>
  <circle cx="512" cy="512" r="118" fill="none" stroke="#fbfaf7" stroke-width="26"/>
</svg>
```

`apps/mobile/scripts/render-icons.sh`:

```sh
#!/bin/sh
# Renders the app's icon art from assets/mark.svg (needs rsvg-convert: brew install librsvg). Commit the PNGs.
# icon.png is opaque (the App Store refuses transparency); mark.png is the transparent mark for Android and the splash.
set -eu
cd "$(dirname "$0")/../assets"
rsvg-convert -w 1024 -h 1024 --background-color '#1f5f8b' mark.svg -o icon.png
rsvg-convert -w 1024 -h 1024 mark.svg -o mark.png
```

Then run `pnpm --filter mobile icons` and `pnpm --filter mobile exec expo install expo-splash-screen`.

- [ ] **Step 4: Make them pass.** In `app.config.ts`: add `icon: "./assets/icon.png"`, and in `android` add `adaptiveIcon: { foregroundImage: "./assets/mark.png", monochromeImage: "./assets/mark.png", backgroundColor: "#1f5f8b" }`. Add the plugin `["expo-splash-screen", { image: "./assets/mark.png", imageWidth: 200, backgroundColor: "#1f5f8b" }]`. Add a comment that the two colours are `accent` and `bg` from `src/theme/colors.ts`.
- [ ] **Step 5:** `pnpm check`. If knip reports `expo-splash-screen` as unused (it's named only as a plugin string), add it to `ignoreDependencies` for `apps/mobile` in `knip.json`, with the fonts package. Run `pnpm --filter mobile exec expo install --check` and `pnpm --filter mobile exec expo-doctor`. Look at `icon.png` at small size, then commit `feat(mobile): placeholder icon, adaptive icon and splash from one SVG`.

### Task 6: Export compliance

**Files:** Modify `apps/mobile/app.config.ts`, `apps/mobile/test/app-shell.test.tsx`.

- [ ] **Step 1: Failing test.** Extend `Config.ios` with `config: z.object({ usesNonExemptEncryption: z.boolean() })`, and add "declares no non-exempt encryption, so TestFlight uploads skip the compliance question": `expect(config.ios.config).toEqual({ usesNonExemptEncryption: false })`. Run it; it fails because `config` is missing.
- [ ] **Step 2: Make it pass.** Add `config: { usesNonExemptEncryption: false }` to `ios`, with a comment: "HTTPS and the Keychain through the OS only: exempt, so `ITSAppUsesNonExemptEncryption` is false".
- [ ] **Step 3:** `pnpm check`, then commit `chore(mobile): answer export compliance in the config`.

### Task 7: EAS project and build profiles

**Files:** Create `apps/mobile/eas.json`, `apps/mobile/test/eas-profiles.test.ts`. Modify `apps/mobile/app.config.ts`, `apps/mobile/test/app-shell.test.tsx`.

- [ ] **Step 1: Failing test for the owner.** Extend `Config` with `owner: z.string()`. Add "builds under the huntonas Expo account, whose login also belongs to another account": `expect(config.owner).toBe("huntonas")`. Watch it fail, add `owner: "huntonas"`, and watch it pass.
- [ ] **Step 2 (Claude): create the EAS project.** Run `cd apps/mobile && pnpm dlx eas-cli@24.8.0 init --non-interactive`. Expected: it creates `@huntonas/mymeetingapp`, warns that the dynamic config can't be modified, prints `{"extra":{"eas":{"projectId":"<uuid>"}}}` and exits non-zero. Record `<uuid>`.
- [ ] **Step 3: Failing test for the project ID, then pass.** Extend `Config` with `extra: z.object({ eas: z.object({ projectId: z.string() }) })`. Assert `expect(config.extra.eas.projectId).toBe("<uuid>")`, watch it fail, and add `extra: { eas: { projectId: "<uuid>" } }` (keep `...config`'s other `extra` out of it; there is none). Then `pnpm dlx eas-cli@24.8.0 project:info` shows `@huntonas/mymeetingapp`.
- [ ] **Step 4: Failing profile test, then `eas.json`.** Create `apps/mobile/test/eas-profiles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const EasJson = z.object({
  build: z.record(z.string(), z.object({ env: z.record(z.string(), z.string()).optional() }).passthrough()),
});

describe("EAS build profiles", () => {
  it("points TestFlight builds at staging and store builds at production", () => {
    const { build } = EasJson.parse(JSON.parse(readFileSync(path.join(__dirname, "../eas.json"), "utf8")));
    expect(build.testflight?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp-staging.vercel.app");
    expect(build.production?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp.vercel.app");
  });
});
```

Watch it fail (no `eas.json`), then create `apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 24.8.0", "appVersionSource": "remote" },
  "build": {
    "base": { "node": "24.21.0", "pnpm": "12.6.0" },
    "development": { "extends": "base", "developmentClient": true, "distribution": "internal" },
    "development-simulator": { "extends": "development", "ios": { "simulator": true } },
    "testflight": {
      "extends": "base",
      "distribution": "store",
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_SERVER_URL": "https://mymeetingapp-staging.vercel.app" }
    },
    "production": {
      "extends": "base",
      "distribution": "store",
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_SERVER_URL": "https://mymeetingapp.vercel.app" }
    }
  }
}
```

Run `pnpm check`.

- [ ] **Step 5 (Claude): validate the profile and the upload.**

```bash
cd apps/mobile && pnpm dlx eas-cli@24.8.0 config --platform ios --profile testflight | grep -E 'EXPO_PUBLIC_SERVER_URL|node|corepack'
pnpm dlx eas-cli@24.8.0 build:inspect --platform ios --profile testflight --stage archive \
  --output "$TMPDIR/eas-archive" --force
find "$TMPDIR/eas-archive" -name '.env*' ! -name '.env.example' -o -path '*/apps/mobile/ios' -o -name '.claude' | head
```

Expected: the staging URL, `24.21.0` and `pnpm: 12.6.0`; `find` prints nothing. Delete the archive directory afterwards.

- [ ] **Step 6:** Commit `chore(mobile): EAS project and development, TestFlight and production profiles`.

### Task 8: Docs

**Files:** Modify `docs/mobile.md`, `docs/superpowers/plans/2026-09-26-roadmap.md`, `docs/superpowers/plans/2026-09-29-phase-5a-mobile-app.md`.

- [ ] **Step 1:** `docs/mobile.md` gets "## TestFlight builds":
  - The `testflight` profile builds against staging.
  - Build numbers come from EAS (remote, auto-incremented).
  - The version is `app.config.ts`'s `version`.
  - Task 9's commands and owner steps.
  - The icon is re-rendered with `pnpm --filter mobile icons` after editing `assets/mark.svg`.
- [ ] **Step 2:** Roadmap, Phase 6: add "Internal TestFlight against staging exists from `2026-09-30-staging-and-testflight.md`; Phase 6 adds attestation, the privacy manifest and label, listings, Play internal testing and the first `production` profile submission." Phase 5a plan, Task 14 Step 2: note that it is superseded by this plan's Task 7.
- [ ] **Step 3:** `pnpm check`, then commit `docs(mobile): TestFlight builds against staging`.

### Task 9: First TestFlight build (Owner runs)

- [ ] **Step 1 (Owner):** Confirm that the Apple Developer Program membership for Gooder Software LLC is active, and that the latest agreements are accepted in App Store Connect → Business.
- [ ] **Step 2 (Owner, Apple ID and 2FA):** `cd apps/mobile && pnpm dlx eas-cli@24.8.0 build --platform ios --profile testflight`. Sign in to Apple when asked, pick the Gooder Software LLC team, and let EAS register `com.goodersoftware.mymeetingapp` and create the distribution certificate and App Store provisioning profile. If EAS asks to upgrade the plan or buy builds, that's the owner's call.
- [ ] **Step 3 (Owner, Apple ID and 2FA):** `pnpm dlx eas-cli@24.8.0 submit --platform ios --latest`. EAS creates the App Store Connect record on this first submit.
  - If the name `mymeetingapp` is taken on the App Store, create the record by hand (App Store Connect → Apps → + → New App, bundle ID `com.goodersoftware.mymeetingapp`, another name), then rerun and give the `ascAppId` it asks for.
  - Claude then adds `"submit": { "testflight": { "ios": { "ascAppId": "<id>" } } }` to `eas.json` (not secret) and commits it.
- [ ] **Step 4 (Owner):** In App Store Connect → TestFlight, wait for processing (10–15 min). There should be no "Missing Compliance". Create the internal group, add testers, install the build through the TestFlight app, and search "Maryville, TN".
- [ ] **Step 5 (Claude):** Confirm that the phone's requests reached staging: Vercel → Logs, filtered to the staging environment, shows `POST /api/v1/meetings/search`, and production shows none from that phone at that time. Record the result in `docs/mobile.md`'s smoke table and commit.

---

## Done when

- `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e` pass.
- `https://mymeetingapp-staging.vercel.app` serves the API without a Vercel login, sends noindex, runs no crons, and uses the Neon branch `staging` (parent `seed`) with its own pepper.
- A TestFlight build with the placeholder icon installs from TestFlight and reads meetings from staging.
