# Platform & SDKs

## Table of Contents
- [Distribution Targets](#distribution-targets)
- [Yandex Games SDK](#yandex-games-sdk)
- [Authentication & Player Profile](#authentication--player-profile)
- [Cloud Saves](#cloud-saves)
- [Yandex Ads SDK](#yandex-ads-sdk)
- [Build Configuration](#build-configuration)

---

## Distribution Targets

The game ships on two platforms:

- **WebGL** - distributed through [Yandex Games](https://yandex.com/games), the primary channel. Full Yandex Games SDK integration is active.
- **Android** - Google Play, RuStore, and other Android storefronts. Yandex Ads SDK handles monetisation; Yandex Games features (cloud saves, auth) are not available outside the Yandex ecosystem.

The active SDK set is determined at build time via flags in `GameBuildData`, not runtime platform detection. Unused SDK code doesn't compile into the wrong build.

---

## Yandex Games SDK

The Yandex Games SDK (YG plugin) integrates the game with the Yandex Games platform across four areas:

### Advertising

Interstitial and rewarded ads are served through the SDK. The game calls the YG API to show an ad and waits for a callback before resuming or granting a reward. `LiveProgressSync.OnQuitGame()` - a public parameterless method required by the SDK - fires when the browser tab is about to close and triggers a synchronous final save.

### In-App Purchases

Purchases go through Yandex's payment system. The SDK handles the purchase flow and returns a receipt; the game then consumes the purchase server-side to unlock the content. The `UseAddSdk` flag in `GameBuildData` switches this flow on or off at build time.

### Cloud Saves

See the [Cloud Saves](#cloud-saves) section below.

### Platform Events

The SDK fires `OnQuitGame` when the browser page unloads. `LiveProgressSync` binds to this event and flushes the final save synchronously before the page disappears.

---

## Authentication & Player Profile

The main menu has a **Login button**. Tapping it starts the Yandex OAuth flow.

On a successful response:

1. The game sends a profile request to the Yandex server.
2. The server returns the player's **display name** and **avatar URL**.
3. The avatar downloads asynchronously and appears next to the name in the main menu UI.

On failure or if the player skips login, the game switches to **guest mode**: local `PlayerPrefs` saves only, no cloud sync, no profile visible. The gameplay itself is fully accessible without logging in.

<!-- 📸 Screenshot: Main menu showing Login button, and the same menu after successful auth with player name and avatar -->

---

## Cloud Saves

When cloud saves are on (`UseCloudSave = true` in `GameBuildData`), `GameProgress` syncs with Yandex cloud storage in addition to local `PlayerPrefs`.

### Save flow

`SaveLoadService.SaveProgress()` serialises `GameProgress` to JSON and writes it to `PlayerPrefs` as usual. With cloud saves active it also pushes the JSON to Yandex via the SDK's save API.

### Load flow

On session start `LoadProgressState` checks the Yandex cloud first. If a cloud save exists it is deserialised and used as `GameProgress`. The cloud copy always wins over a local `PlayerPrefs` copy on conflict - progress made on one device won't be overwritten by an older local save on another.

If the cloud request fails (offline, not authenticated), load silently falls back to `PlayerPrefs`.

### Autosave

`LiveProgressSync` autosaves every 5 seconds. With cloud saves on, each autosave tick also pushes to the cloud.

<!-- 📸 Screenshot: Cloud save indicator in UI or GameBuildData inspector with UseCloudSave toggled -->

---

## Yandex Ads SDK

For Android builds outside the Yandex Games ecosystem, the **Yandex Ads SDK** handles banner, interstitial, and rewarded ads.

Set `UseAddSdk = true` in `GameBuildData` to activate it. When `false`, all Yandex Ads code paths are bypassed - the same codebase produces a clean WebGL build for Yandex Games and a separate Android build with ads, without conditional compilation scattered across gameplay code.

<!-- 📸 Screenshot: GameBuildData ScriptableObject in inspector showing UseAddSdk and UseCloudSave flags -->

---

## Build Configuration

All platform-specific settings live in the `GameBuildData` ScriptableObject:

| Field | Type | Purpose |
|---|---|---|
| `DebugConfiguration` | enum | `Development` (logs active) or `Shipping` (logs compiled out) |
| `TargetPlatform` | enum | `WebGL` or `Android` |
| `UseCloudSave` | bool | Sync with Yandex cloud storage |
| `UseAddSdk` | bool | Yandex Ads SDK for Android storefronts |

`FilteredEnumAttribute` is applied to both enum fields to strip the `None` sentinel from the Inspector dropdown - it can't be selected by mistake.

The `DebugConfiguration` flag controls `GameLogger` output. In `Shipping` mode all `#if DEVELOPMENT_BUILD || UNITY_EDITOR` blocks compile out, giving zero logging overhead in production.
