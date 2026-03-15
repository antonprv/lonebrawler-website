# Editor Tooling

## Table of Contents
- [Scene Switcher Overlay](#scene-switcher-overlay)
- [Quick Look](#quick-look)
- [Level Static Data Editor](#level-static-data-editor)
- [Scene Data Selector](#scene-data-selector)
- [Manifests & Typed Dropdowns](#manifests--typed-dropdowns)
- [Static Data Custom Editors](#static-data-custom-editors)
- [Build Configuration](#build-configuration)
- [Naming Convention Doc](#naming-convention-doc)
- [Manual Save Editor](#manual-save-editor)

---

## Scene Switcher Overlay

`SceneSwitcherOverlay` registers itself in the Unity SceneView toolbar via `[Overlay(typeof(SceneView), "Scene Switcher", true)]`. It contains a single `SceneSwitcherDropdown` element.

The dropdown reads all scenes from `EditorBuildSettings.scenes`, shows them as a popup, and opens the selected scene with `EditorSceneManager.OpenScene()`. No file menu, no Build Settings, no Project window navigation needed - one click from anywhere in the SceneView.

<!-- 📸 Screenshot: Scene Switcher dropdown visible in the SceneView toolbar -->

---

## Quick Look

`QuickLook` is a dockable `EditorWindow` at **Window -> Quick Look**. It stores a shortlist of frequently accessed prefabs and ScriptableObjects.

### Adding assets

Two ways to add assets:
- **Drag & drop** directly into the window - `HandleDragAndDrop()` accepts `GameObject` and `ScriptableObject` payloads.
- **Object Picker** - clicking "Add New" opens `EditorGUIUtility.ShowObjectPicker<GameObject>()` and the selected object is added when the picker closes.

Duplicates are silently rejected via `_prefabs.Contains(obj)`.

### Persistent storage

The list saves to a `QuickLookStaticData` ScriptableObject at `Resources/Editor/QuickLook/QuickLookStaticData`. "Save File" calls `EditorUtility.SetDirty` plus `AssetDatabase.SaveAssets()`. "Load File" reads from the same asset. The list survives editor restarts because it's a project asset, not EditorPrefs.

### Adaptive grid layout

The button grid reflows automatically as the window is resized:

```csharp
private int CalculateColumnsCountBasedOnWindowWidth()
{
    float availableWidth = position.width - (WindowEdgePadding * 2) - scrollbarWidth;
    for (int columns = MaxColumns; columns >= 1; columns--)
    {
        float widthPerButton = (availableWidth - (columns - 1) * SpacingBetweenButtons) / columns;
        if (widthPerButton >= MinButtonWidth)
            return columns;
    }
    return 1;
}
```

Up to `MaxColumns = 5`, never narrower than `MinButtonWidth = 60f` per button.

<!-- 📸 Screenshot: Quick Look window docked in the editor with a grid of prefab shortcuts -->

---

## Level Static Data Editor

`LevelStaticDataEditor` is a `CustomEditor` for `LevelStaticData` ScriptableObjects. It replaces the default inspector with a structured view that removes manual data-entry friction.

### Scene picker

Instead of a raw string field for `LevelKey`, the editor shows a dropdown built from `InspectorUtils.GetAllScenes()`, which reads `EditorBuildSettings.scenes`. Selecting a scene writes its name string - no typos, no stale names.

### Collect All Data

The "Collect all data" button runs three collection methods:

**`CollectSpawners()`** - finds all `EnemySpawnMarker` components in the open scene via `FindObjectsByType`. For each marker, reads `UniqueId`, position, `EnemyTypeId`, and count, then writes `EnemySpawnerData` into the ScriptableObject's `EnemySpawners` list.

**`CollectTeleports()`** - finds all `TeleportMarker` components, reads `UniqueName`, target level, and collider size/position, writes `LevelTeleportData` entries.

**`CollectPlayerStart()`** - finds the first `GameObject` with the player-start tag and writes its `Coordinates` into `PlayerStartCoordinates`.

After each collection, `EditorUtility.SetDirty(target)` and `AssetDatabase.SaveAssets()` are called. Changes hit version control immediately.

<!-- 📸 Screenshot: LevelStaticData inspector with the Collect buttons and populated spawner list -->

---

## Scene Data Selector

`SceneDataSelectorButton` is a SceneView toolbar button (via `[Overlay]`) that sends the Inspector directly to the `LevelStaticData` asset for the currently open scene.

On click it calls `StaticDataService.ForLevel(SceneManager.GetActiveScene().name)` and passes the result to `Selection.activeObject`. The Inspector shows the relevant ScriptableObject immediately. The scene-to-ScriptableObject lookup goes through `LevelsManifest`.

<!-- 📸 Screenshot: Scene Data Selector button in toolbar, and the LevelStaticData shown in Inspector -->

---

## Manifests & Typed Dropdowns

### ManifestEditorBase

`ManifestEditorBase` is a reusable `CustomEditor` base class for all manifest ScriptableObjects. It renders each manifest entry as a key-value pair where the key uses a custom drawer.

Two key drawers are provided:

**`SceneDropdownKeyDrawer`** - replaces a string key field with a dropdown of all scenes in Build Settings. Stops invalid scene names from getting in.

**`EnumDropdownKeyDrawer`** - replaces an int/string key with a typed enum dropdown. Stops out-of-range values.

### Manifest types

| Manifest | Key type | Value type | Usage |
|---|---|---|---|
| `LevelsManifest` | scene name | `AssetReference<LevelStaticData>` | Maps scenes to their StaticData |
| `EnemyManifest` | `EnemyTypeId` enum | `AssetReference<EnemyStaticData>` | Enemy configs at spawn time |
| `BuffsManifest` | `BuffClassName` enum | `AssetReference<BuffStaticData>` | Buff configs in BuffFactory |
| `WindowsManifest` | `WindowTypeId` enum | `AssetReference<GameObject>` | Window types to prefab addresses |
| `LevelMusicManifest` | scene name | `AssetReference<MusicPlaylist>` | Scenes to music playlists |

All manifest assets load in `StaticDataService` at startup. Content is served through typed subservice interfaces (`IEnemyDataSubservice`, `IBuffDataSubservice`, etc.).

<!-- 📸 Screenshot: BuffsManifest inspector showing enum dropdown keys -->

---

## Static Data Custom Editors

Most `StaticData` ScriptableObjects have a `CustomEditor` extending `ManualSaveEditor`:

- Render the default inspector via `DrawDefaultInspectorWithManualSave()`
- Add an explicit "Save" button calling `EditorUtility.SetDirty` + `AssetDatabase.SaveAssets()`
- No auto-save on every field change - changes commit only when the developer is ready

**`EnemyStaticDataEditor`** adds an attack preview: a `Handles.DrawWireDisc` gizmo in the SceneView showing melee/projectile radius when the asset is selected.

**`BuffStaticDataEditor`** renders the `BuffParameters` list as a named key-value table with validation - warns if a parameter name is empty or a float value is exactly zero (usually a misconfiguration).

**`AttackPresetStaticDataEditor`** shows attack radius, range, and `MaxEnemiesHit` as numeric labels, with a "Test in Scene" button that creates a temporary visualisation sphere.

---

## Build Configuration

`GameBuildDataEditor` is a `CustomEditor` for `GameBuildData`:

- Renders `DebugConfiguration` and `TargetPlatform` as dropdowns filtered by `FilteredEnumAttribute` (the `None` sentinel doesn't appear).
- Shows `UseCloudSave` and `UseAddSdk` as labelled toggles with help text.
- Adds "Apply to Player Settings" - syncs `TargetPlatform` to the Unity `BuildTarget` and sets `Development Build` in `BuildOptions` to match `DebugConfiguration`.

<!-- 📸 Screenshot: GameBuildData inspector with the full editor UI -->

---

## Naming Convention Doc

`NamingConvention` is a ScriptableObject (`CreateAssetMenu`) that stores the project's naming guide as a rich-text `TextArea` string. Accessible via **Assets -> Create -> Documentation -> Naming Convention**.

In the Inspector the full guide renders in a scrollable `TextArea` with bold headings and italicised notes. It documents:

- Prefab prefixes: `P_`, `P_V_`, `PA_`, `PAV_`, `PP_`, `PAI_`, `PUI_`
- UI element suffixes: `_CNT`, `_BTN`, `_BG`, `_TXT`, `_IMG`

`NamingConventionEditor` adds syntax highlighting - scans the text for known prefixes and renders them in a distinct colour, making the guide easier to scan at a glance.

---

## Manual Save Editor

`ManualSaveEditor` is the base class most Static Data editors inherit from. It adds a "Save Asset" button to the bottom of any inspector:

```csharp
protected void DrawDefaultInspectorWithManualSave()
{
    DrawDefaultInspector();
    if (GUILayout.Button("Save Asset"))
    {
        EditorUtility.SetDirty(target);
        AssetDatabase.SaveAssets();
    }
}
```

Without this, ScriptableObject field changes only write to disk on Unity's auto-save. The explicit button gives developers control over when changes are committed - important when multiple people are editing assets concurrently and using version control.
