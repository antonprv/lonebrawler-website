# Testing

## Table of Contents
- [Overview](#overview)
- [Test Infrastructure - ZenjexTestBootstrap](#test-infrastructure---zenjextestbootstrap)
- [Edit Mode Tests](#edit-mode-tests)
- [Play Mode Tests](#play-mode-tests)
- [Performance Tests](#performance-tests)
- [Testing Conventions](#testing-conventions)

---

## Overview

The project has **53 test files** split across two assemblies: `Code.Tests.EditMode` and `Code.Tests.PlayMode`.

| Assembly | Framework | Focus |
|---|---|---|
| EditMode | NUnit + NSubstitute | Pure C# logic, data models, services |
| PlayMode | NUnit + NSubstitute + Unity Test Framework | MonoBehaviour lifecycle, physics, integration chains |
| Performance | Unity Performance Testing Package | Hot-path timings, frame stability |

---

## Test Infrastructure - ZenjexTestBootstrap

All PlayMode tests involving `ZenjexBehaviour` components need a minimal DI container before `Awake()` fires. `ZenjexTestBootstrap` handles this cleanly.

### Setting up the container

```csharp
[UnitySetUp]
public IEnumerator SetUp()
{
    yield return ZenjexTestBootstrap.Initialize();
    // Container is live - safe to add ZenjexBehaviour components
}
```

`Initialize()` creates a `GameObject` with a `TestRootInstaller` component and yields one frame. Unity calls `Awake()` on `TestRootInstaller`, which builds the container and populates `ProjectRootInstaller.RootContainer`. Because `TestRootInstaller` runs at `ExecutionOrder -280`, the container is ready before any `ZenjexBehaviour.Awake()` in the test scene.

### What the test container registers

```csharp
builder.RegisterValue(Substitute.For<ITimeService>(), ...);
builder.RegisterValue(Substitute.For<IInputService>(), ...);
builder.RegisterValue(Substitute.For<IPlayerDataSubervice>(), ...);
builder.RegisterValue(Substitute.For<IGameConfigSubservice>(), ...);
builder.RegisterValue(Substitute.For<IGameLog>(), ...);
builder.RegisterValue(Substitute.For<IAssetLoader>(), ...);
```

All registered dependencies are NSubstitute mocks. If a component has a `[Zenjex]` field not covered here, `ZenjexInjector` logs an error but doesn't throw, so tests don't fail silently from missing registrations.

### Tearing down

```csharp
[TearDown]
public void TearDown()
{
    Object.Destroy(_testGameObject);
    ZenjexTestBootstrap.Cleanup();
}
```

`Cleanup()` uses reflection to null out the static `ProjectRootInstaller.RootContainer` (private setter), then destroys the installer `GameObject`. Skipping this step causes static state to leak into the next test class.

### CreatePlayerGameObject helper

`PlayerHealth` and `PlayerDeath` both have `[RequireComponent]` attributes that auto-add `PlayerAnimator` and `PlayerMove`. Without the helper, Unity adds those components during `AddComponent<PlayerDeath>()` and they start ticking immediately - before `ZenjexInjector` has filled `ITimeService` and `IInputService`, causing cascading `NullReferenceException`s.

`CreatePlayerGameObject()` adds `CharacterController`, a stub `Animator`, `PlayerAnimator`, and `PlayerMove` in the right order, then **disables** the last two so their `Update()` loops don't run during tests.

---

## Edit Mode Tests

### SaveData

**`GameProgressTests`** - checks that a fresh `GameProgress` passes `IsValid()`, all domain sections are non-null, and a default-constructed progress fails validation.

**`PLayerStateTests`** and **`PlayerStatsTests`** - verify stat values match the mock `IPlayerDataSubervice` data and that `IsValid()` returns false when any critical value is zero.

**`BuffsRegistryTests`** and **`BuffSaveEntryTests`** - verify buff snapshot serialisation including `RemainingDuration` and `BuffState`, plus edge-case files for null registries and zero-count lists.

**`EnemiesKilledTests`** - checks that `HashSetData<string>` initialises correctly and spawner IDs can be added and queried.

**`SoulsCollectedTests`** - checks amount tracking and that `LeftSpawners` `DictionaryData` starts empty.

**`WorldDataTests`** and **`TransformOnLevelTests`** - verify position/rotation integrity and the `IsValid()` guard logic for `_initialSave`.

### Inventory

**`InventorySaveDataTests`** - slot count after `InitializeSlots`, all slots default empty, calling `InitializeSlots` twice overwrites cleanly.

**`InventorySlotDataTests`** - constructor defaults, `IsEmpty` logic, `Set()` and `Clear()` behaviour.

**`InventoryServiceTests`** - adding items, removing, slot selection, edge cases (full inventory, stacking identical items).

### Custom Collections

**`DictionaryDataTests`** - serialisation round-trip, null-key handling, duplicate-key rejection, `ForceSerialization()` behaviour.

**`HashSetDataTests`** - same pattern applied to `HashSetData<T>`.

**`PairDataTests`** - equality and serialisation of `PairData<TKey, TValue>`.

### Custom Types

**`Vector3DataTests`**, **`QuatDataTests`**, **`TransformDataTests`** - JSON round-trip, conversion to/from Unity types, edge cases (zero vectors, identity quaternion).

### FastMath

**`FMathTests`** - covers `FastSqrt`, `FastInvSqrt` (including precise double-iteration mode), `Clamp`, `FastNormalize`, `FastLength`, `FastDistance`, and `DistanceSquared`. Float comparisons use a tolerance of `0.01f`. One test explicitly checks that the precise mode (`prescise: true`) gives a tighter result than the single-iteration default.

**`FastMathExtensionsTests`** - extension methods on `Vector3` and `float3`.

### DevConsole

**`ConsoleStateTests`** - message list management, filter application, `Clear()` behaviour.

**`CommandHistoryTests`** - up/down history navigation, wrap-around at boundaries, empty-history guard.

**`DevConsoleServiceTests`** - `Execute()` dispatches to the right `IConsoleCommand`; unknown commands produce an error message.

Per-command tests (`ClearCommandTests`, `FilterLogsCommandTests`, `HelpCommandTests`, `LogStatsCommandTests`, `SetFPSCommandTests`, `ToggleUnityLogsCommandTests`) - argument validation, output message content, side effects on mocks.

### Services

**`BuffTrackerServiceTests`** - `AddBuff`, `RemoveBuff`, `GetPlayerBuffs`, `WriteToProgress` (snapshot correctness, Disabled buffs excluded), `ReadProgress` (restore routing per `ActivationType`), `Cleanup`.

**`DragDropServiceTests`** - drag source/target registration, transfer logic, invalid transfer rejection.

**`LootTrackerServiceTests`** - reactive loot count updates, `WriteToProgress` / `ReadProgress` round-trip.

**`PersistentProgressServiceTests`** - `Progress` and `SystemSettings` stored and retrieved correctly, `ProgressKey` and `SystemSettingsKey` are distinct.

### Extensions

**`ArrayExtensionsTests`** and **`FunctionalExtensionsTests`** - `With<T>` chaining, conditional `With`, and `Empty<T>` on reference arrays.

---

## Play Mode Tests

### Smoke

**`MonoBehaviourSmokeTests`** - every critical `MonoBehaviour` component attaches without throwing: `PlayerHealth`, `PlayerDeath`, `EnemyHealth`, `EnemyDeath`, `SaveComponent`, `TriggerObserver`, `UniqueId`, `AsyncStartMonoBehaviour`. A composite test adds all of them to one `GameObject` inside a single `Assert.DoesNotThrow` block.

`AsyncStartMonoBehaviour` test asserts that `IsInitialized` is `false` by default - the component must not self-initialise.

### Integration - Enemies

**`AggroTests`** - builds a real `Aggro` component with a `TriggerObserver` collider zone and a mock `IMovableAgent`. Tests: agent stops after `ManualStart()`; player entering the trigger calls `ContinueFollowing()`; player leaving does NOT immediately call `StopFollowingImmediately()` (respects `followDelay`); after waiting longer than `followDelay`, `StopFollowingImmediately()` fires; `Deactivate()` / `Activate()` toggle `enabled`; destroying the object doesn't throw.

**`EnemyHealthTests`** - `TakeDamage` reduces `CurrentHealth` (clamped at zero); `Heal` raises it (clamped at `MaxHealth`); `IsDead` observable fires when health hits zero.

**`EnemyDeathIntegrationTests`** - both `EnemyHealth` and `EnemyDeath` on one `GameObject`. Full lifecycle: full health on start, death animation on zero health, `DisappearDelay` respected before the `GameObject` is destroyed.

### Integration - Player

**`PlayerHealthTests`** - mirrors `EnemyHealthTests` for the player side, including save/restore via `ReadProgress` / `WriteToProgress`.

**`PlayerDeathTests`** - health reaches zero, death animation triggers, `GameStateMachine.EnterState<MainMenuState>()` fires after the death delay.

### Infrastructure

**`SaveComponentTests`** - `SaveComponent` calls `ISaveLoadService.SaveProgress()` when `Save()` is triggered.

**`TriggerObserverTests`** - `OnTriggerEntered` and `OnTriggerExited` observables fire on collider enter/exit.

**`AsyncStartMonoBehaviourTests`** - `IsInitialized` transitions to `true` after `StartAsync()` completes.

---

## Performance Tests

All performance tests use the **Unity Performance Testing Package** (`Measure.Method` and `Measure.Frames`).

### `PlayerHealth_TakeDamage_PerformanceUnder1ms`

```
Warmup:       5 runs
Measurements: 20
Iterations:   1 per measurement (each calls TakeDamage 100x)
```

Player health is set to 1 000 000; each call subtracts 0.001, so the player never dies during measurement - isolates the pure method cost from any death-chain callbacks.

### `EnemyHealth_TakeDamage_PerformanceUnder1ms`

Same structure, applied to `EnemyHealth` with `MaxHealth = 1 000 000`.

### `GameObject_CreateAndDestroy_WithComponents_Under5ms`

```
Warmup:       3 runs
Measurements: 10
```

Creates a player `GameObject` with all required components via `CreatePlayerGameObject()`, then calls `DestroyImmediate`. Measures the full component registration and injection pipeline on instantiation.

### `FrameTime_WithActivePlayerHealth_IsStable`

```
Warmup:       5 frames
Measurements: 20 frames
```

`Measure.Frames()` samples per-frame time with a live `PlayerHealth` component ticking. Checks that frame-time variance stays within Unity Performance Testing Package default tolerance bands.

---

## Testing Conventions

- **Arrange-Act-Assert** - all test methods follow this pattern; structure is clear from spacing alone, no comments needed.
- **Fixture isolation** - each test class creates fresh objects in `[SetUp]` / `[UnitySetUp]` and destroys them in `[TearDown]` / `[UnityTearDown]`. No shared state between tests.
- **Mock strategy** - NSubstitute for all interface mocks. Concrete dependencies that are cheap to construct (ScriptableObjects, plain data classes) are instantiated directly.
- **Tolerance** - float comparisons use `Is.EqualTo(x).Within(tolerance)`. FastMath tests use `0.01f`.
- **`ZenjexTestBootstrap` contract** - every PlayMode test touching `ZenjexBehaviour` must call `Initialize()` in setup and `Cleanup()` in teardown. Skipping `Cleanup()` leaks static state.

<!-- 📸 Screenshot: Unity Test Runner with all tests passing, green -->
