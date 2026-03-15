# Save System

## Table of Contents
- [Overview](#overview)
- [GameProgress - the data model](#gameprogress---the-data-model)
- [SaveLoadService](#saveloadservice)
- [IProgressReader / IProgressWriter](#iprogressreader--iprogresswriter)
- [Live Progress Sync](#live-progress-sync)
- [Serialisable Collections](#serialisable-collections)
- [Custom Vector Types](#custom-vector-types)

---

## Overview

All mutable runtime state lives in a single serialisable root object (`GameProgress`). Serialisation uses Newtonsoft Json.NET. Storage is `PlayerPrefs` for local saves and the Yandex cloud API when cloud saves are enabled. Every component that owns persistent state implements `IProgressReader`, `IProgressWriter`, or both. `SaveLoadService` collects all writers registered in `GameFactory.ProgressWriters` and calls them in one pass on save.

---

## GameProgress - the data model

```csharp
[Serializable]
public sealed class GameProgress
{
    public long SaveTimeUTC;
    public WorldData PlayerWorldData;
    public PLayerState PLayerState;
    public PlayerStats PlayerStats;
    public EnemiesKilled EnemiesKilled;
    public SoulsCollected SoulsCollected;
    public BuffsRegistry BuffsRegistry;
    public InventorySaveData Inventory;
}
```

### Domain sections

**`WorldData`** - holds `TransformOnLevel` (the player's last position, rotation, and scene name) plus `LastTeleportUniqueName` and `LastTeleportTimeUTC`. `IsValid()` returns `false` if `TransformOnLevel` was never written (initial save state), stopping a teleport-based spawn before the player has moved at all.

**`PLayerState`** - `MaxHealth` and `CurrentHealth`. Initialised from `IPlayerDataSubervice` on new game. `IsValid()` returns `false` when both values are zero (default-constructed, never populated).

**`PlayerStats`** - `MovementSpeed`, `RotationSpeed`, `Damage`, `Range`, `Radius`, `MaxEnemiesHit`. These are the *modified* values - if the player has active Constant buffs, the multiplied numbers are stored here. This is intentional: restoring a Constant buff must not re-apply the multiplier on top of already-modified stats.

**`EnemiesKilled`** - contains `HashSetData<string> ClearedSpawners`. When all enemies from a spawner are dead, the spawner's unique ID goes in here. On the next load the spawner reads `ReadProgress` and skips spawning if its ID is already in the set.

**`SoulsCollected`** - `Amount` (current balance) and `DictionaryData<string, Vector3> LeftSpawners` (spawner IDs to positions for souls that dropped but haven't been collected yet).

**`BuffsRegistry`** - `List<BuffSaveEntry>`, each entry holding `ClassName`, `ActivationType`, `State`, and `RemainingDuration`. See [Buff System](Buff-System-EN) for restore details.

**`InventorySaveData`** - two `List<InventorySlotData>` (main inventory + hotbar) and `SelectedHotbarIndex`. Each `InventorySlotData` holds `BuffClassName` and `Count`.

### Validation guards

Each section has `IsValid()`. `GameProgress` exposes composite guards:

```csharp
public bool IsWorldDataValid()   => PlayerWorldData != null && PlayerWorldData.IsValid();
public bool IsPlayerStatsValid() => PlayerStats != null && PlayerStats.IsValid();
public bool IsPlayerDataValid()  => PLayerState != null && PLayerState.IsValid();
```

`LoadProgressState` calls these to decide whether to load the save or build a fresh `GameProgress`.

---

## SaveLoadService

`SaveLoadService` coordinates saving and loading. All dependencies come through constructor injection.

### `SaveProgress(bool isInitial, bool skipUTC)`

```csharp
public void SaveProgress(bool isInitial = false, bool skipUTC = false)
{
    if (!isInitial)
    {
        foreach (IProgressWriter writer in _gameFactory.ProgressWriters)
            writer?.WriteToProgress(_progressService.Progress);

        _buffTracker.WriteToProgress(_progressService.Progress);
        _progressService.Progress.Inventory = _inventoryService.GetSaveData();
    }

    if (!skipUTC)
        _progressService.Progress.SaveTimeUTC = isInitial ? 0 : _timeService.UtcNow.Ticks;

    _soundService.WriteToSettings(_progressService.SystemSettings);

    _playerPrefs.SetString(_progressService.ProgressKey,
        _progressService.Progress.ToSerialized());
    _playerPrefs.SetString(_progressService.SystemSettingsKey,
        _progressService.SystemSettings.ToSerialized());
    _playerPrefs.Save();
}
```

`isInitial` is `true` only when starting a new game. In that case the writer pass is skipped entirely - writing gameplay state from the previous session into a fresh `GameProgress` would corrupt the new run.

Sound settings (`SystemSettings`) always save regardless of `isInitial` - volume preferences are session-independent.

### `LoadProgress()` and `LoadSettings()`

Both deserialise from `PlayerPrefs` and return `null` if the key is absent. `LoadProgressState` handles the null case and constructs a default `GameProgress` when needed.

---

## IProgressReader / IProgressWriter

```csharp
public interface IProgressReader
{
    void ReadProgress(GameProgress progress);
}

public interface IProgressWriter
{
    void WriteToProgress(GameProgress progress);
}
```

Any component that needs to persist state implements one or both. `GameFactory` registers every created component that carries these interfaces into `ProgressReaders` and `ProgressWriters` lists.

### Flow on level load

```
LoadLevelState
    |
    |- GameFactory.CreatePlayer() -> registers PlayerHealth, PlayerMove
    |- GameFactory.CreateEnemySpawners() -> registers EnemyLootSpawner instances
    |
    +- InformProgressReaders(GameProgress)
            |  calls ReadProgress() on every registered IProgressReader
            v
        PlayerHealth restores CurrentHealth / MaxHealth
        PlayerMove restores MovementSpeed / RotationSpeed
        EnemyLootSpawner checks ClearedSpawners -> skips or spawns
        SoulsTrackerService restores souls amount
```

### Flow on save

```
SaveLoadService.SaveProgress()
    |
    +- foreach writer in GameFactory.ProgressWriters:
            writer.WriteToProgress(progress)
            |
        PlayerHealth writes CurrentHealth / MaxHealth -> PLayerState
        PlayerMove writes MovementSpeed -> PlayerStats
        PlayerHealth writes transform -> WorldData (via SaveComponent)
```

---

## Live Progress Sync

`LiveProgressSync` is a `ZenjexBehaviour` that manages automatic saves during gameplay.

### Autosave loop

```csharp
private IEnumerator SyncLoop()
{
    var interval = new WaitForSeconds(SyncIntervalSeconds); // 5 seconds
    while (true)
    {
        yield return interval;
        _saveLoad.SaveProgress();
    }
}
```

The loop starts in `GameLoopState.Enter()` and stops in `GameLoopState.Exit()`. It skips the main menu scene - `StartSyncLoop()` checks `SceneManager.GetActiveScene().name` and returns early if it's the menu.

### Page unload save

```csharp
public void OnQuitGame()
{
    _saveLoad?.SaveProgress();
}
```

`OnQuitGame` is called by the Yandex Games SDK (YG plugin) when the browser tab closes or refreshes. It must be a public parameterless method - the SDK calls it by name through JavaScript interop. The save is synchronous to guarantee completion before the page unloads.

---

## Serialisable Collections

Unity's built-in serialisation doesn't support `Dictionary<K,V>` or `HashSet<T>`. The project provides custom replacements.

### DictionaryData\<TKey, TValue\>

Extends `Dictionary<K,V>` and implements `ISerializationCallbackReceiver`:

```csharp
[SerializeField] private List<TKey>   keyData   = new();
[SerializeField] private List<TValue> valueData = new();

public void OnBeforeSerialize()  => SynchronizeListsWithDictionary();
public void OnAfterDeserialize() => RebuildDictionaryFromSerializedData();
```

`RebuildDictionaryFromSerializedData` uses `Mathf.Min(keyData.Count, valueData.Count)` to guard against mismatched list lengths (possible after Undo in the Editor) and skips null or default keys. `ForceSerialization()` is there for Editor code that modifies the dictionary manually and needs the lists in sync immediately.

### HashSetData\<T\>

Same `ISerializationCallbackReceiver` pattern. The backing `List<T>` deduplicates during `OnAfterDeserialize` to maintain set semantics even if the serialised data has duplicates.

Both types ship with custom `PropertyDrawer` implementations so they render as standard Unity list fields in the Inspector.

---

## Custom Vector Types

Unity's `Vector3`, `Quaternion`, and `Transform` don't serialise to JSON by default. The project defines serialisable counterparts:

| Custom type | Unity equivalent | Notes |
|---|---|---|
| `Vector3Data` | `Vector3` | `x`, `y`, `z` fields; `ToVector3()` / `ToVector3Data()` extensions |
| `QuatData` | `Quaternion` | `x`, `y`, `z`, `w`; `QuatComplex` handles slerp math |
| `TransformData` | position + rotation + scale | Used in `PlayerWorldData` |
| `Coordinates` | position + rotation (no scale) | Used for spawn point positions in `LevelStaticData` |

All four have `PropertyDrawer` implementations that match Unity's native field widgets in the Inspector. `UnityConversionExtensions` provides the conversion surface: `ToTransformData()`, `ToCoordinates()`, `ApplyTo()`, and so on.

<!-- 📸 Screenshot: PlayerPrefs save data viewed in browser dev tools, showing the JSON structure -->
