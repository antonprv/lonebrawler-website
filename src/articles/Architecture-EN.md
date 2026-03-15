# Architecture

## Table of Contents
- [Overview](#overview)
- [Game State Machine](#game-state-machine)
- [Dependency Injection - Zenjex](#dependency-injection--zenjex)
- [Addressables & Asset Management](#addressables--asset-management)
- [InstallerFactory & Bootstrap Sequence](#installerfactory--bootstrap-sequence)

---

## Overview

Three systems form the architectural backbone of the project: a **Game State Machine** that drives the application lifecycle, a **custom DI framework (Zenjex)** that wires all services together, and **Unity Addressables** wrapped with a caching layer for on-demand asset loading. Together they define the startup sequence, runtime object ownership, and the contracts between systems.

---

## Game State Machine

### Purpose

`GameStateMachine` is the single point of control for all major application transitions. It holds one active state at a time, and all scene loads, game restarts, and menu transitions go through it.

### State types

Two interfaces cover all states:

```csharp
public interface IGameState : IGameExitableState
{
    void Enter();
}

public interface IGamePayloadedState<TPayload> : IGameExitableState
{
    void Enter(TPayload payload);
}
```

`IGameExitableState` adds `Exit()` and `StateType Type { get; }`, so the machine can always exit the current state before entering the next one, regardless of which concrete class is active.

### Transition flow

```flow
BootstrapperState | loads Addressables, builds DI container, initialises services
LoadProgressState | reads PlayerPrefs / cloud save, validates GameProgress
MainMenuState | creates main menu UI, waits for player input
LoadLevelState | receives string payload (level key)
  saves current progress, loads scene, spawns player |
GameLoopState | starts LiveProgressSync, activates gameplay
```

### Machine implementation

The machine holds no game logic. It calls `Exit()` on the outgoing state, resolves the new one through `StateFactory`, and calls `Enter()` or `Enter(payload)`:

```csharp
public void EnterState<TState>() where TState : class, IGameState
{
    IGameState gameState = ChangeState<TState>();
    gameState.Enter();
}

public void EnterState<TState, TPayload>(TPayload payload)
    where TState : class, IGamePayloadedState<TPayload>
{
    IGamePayloadedState<TPayload> gameState = ChangeState<TState>();
    gameState.Enter(payload);
}

private TState ChangeState<TState>() where TState : class, IGameExitableState
{
    _activeState?.Exit();
    TState gameState = _stateFactory.CreateState<TState>();
    _activeState = gameState;
    return gameState;
}
```

`StateFactory` resolves states from the DI container, so every state gets its dependencies through constructor injection - no service locator calls inside state logic.

### Current state query

`GetCurrentState()` returns a `StateType` enum value, letting any system check the current application phase without holding a reference to the machine's internals.

<figure class="diagram-gif-wrap">
  <img class="diagram-gif--dark"  src="images/gamestate_diagram_dark.gif"  alt="GameState transition diagram — dark theme" width="640" height="480">
  <img class="diagram-gif--light" src="images/gamestate_diagram_light.gif" alt="GameState transition diagram — light theme" width="640" height="480">
</figure>

---

## Dependency Injection - Zenjex

Zenjex is covered in its own article: **[Zenjex - DI Framework](Zenjex-EN)**.

Brief context: all services registered in `ProjectRootInstaller.InstallBindings()` are available globally through `RootContext`. `ZenjexBehaviour` components get their dependencies automatically before `OnAwake()` runs. The two-phase bootstrap (`OnContainerReady` then `OnGameLaunched`) guarantees that async-loaded objects are injected before first use.

---

## Addressables & Asset Management

### AssetLoader

`AssetLoader` is the single gateway for all runtime asset operations. It wraps Unity Addressables with two layers of internal state:

- **`_completedHandles`** - caches `AsyncOperationHandle` by GUID or address after the first successful load. Repeat calls to `LoadAsync<T>` with the same key skip the Addressables pipeline entirely and return the cached result.
- **`_calledHandles`** - tracks every handle ever requested, used in `Cleanup()` to release all in-flight and completed handles in one pass.
- **`_instantiatedObjects`** - tracks handles from `InstantiateAsync`. `Cleanup()` calls `Addressables.ReleaseInstance()` on each one, destroying the GameObject and releasing the underlying bundle reference at the same time.

### API surface

```api
UniTask<T> | LoadAsync<T>(AssetReference assetReference)
UniTask<T> | LoadAsync<T>(string assetAddress)
UniTask<GameObject> | InstantiateAsync(string address)
UniTask<GameObject> | InstantiateAsync(string address, Transform parent)
UniTask<GameObject> | InstantiateAsync(AssetReference assetReference)
UniTask<GameObject> | InstantiateAsync(AssetReference assetReference, Transform parent)
T | Load<T>(string path) | synchronous Resources fallback
void | Cleanup()
```

### Pre-loading

`AssetsPreloader` runs at startup inside `LoadProgressState` and pre-warms a fixed list of Addressable addresses before gameplay begins. This avoids first-use hitches on high-frequency assets like enemy prefabs and VFX.

### Address constants

All Addressable keys are string constants in per-domain `AssetAddresses` static classes. No string literals are scattered across the codebase, and address typos become refactoring errors rather than runtime failures.

<!-- 📸 Screenshot: Addressables Groups window showing asset organisation -->

---

## InstallerFactory & Bootstrap Sequence

`InstallerFactory` handles the earliest moments of application startup - before the DI container exists and before any `ZenjexBehaviour` is active.

### Two-routine design

The factory exposes two coroutine methods that must run in order:

**1. `CreateLoadingScreenRoutine(onComplete)`**

Loads and instantiates the loading curtain prefab via Addressables. The curtain `GameObject` is marked `DontDestroyOnLoad`. The `ILoadScreen` component comes back through `onComplete`, so the caller can register it in the DI container before `GameInstance` is created.

**2. `CreateGameInstanceRoutine(onBeforeActivate, onComplete)`**

Loads the `GameInstance` prefab. Before `Instantiate` is called, `prefab.SetActive(false)` is set - this stops Unity from calling `Awake()` on `ZenjexBehaviour` components before DI bindings are registered. `onBeforeActivate` fires with the still-inactive instance, giving the caller a window to register the remaining runtime bindings. Only then does `go.SetActive(true)` run, triggering all `Awake()` calls against a fully populated container.

```flow
CreateLoadingScreenRoutine() |
  Addressables.LoadAsync -> Instantiate -> DontDestroyOnLoad |
  onComplete(ILoadScreen) | register in container
CreateGameInstanceRoutine() |
  Addressables.LoadAsync -> prefab.SetActive(false) -> Instantiate |
  onBeforeActivate(instance) | register runtime bindings
  go.SetActive(true) | ZenjexBehaviour.Awake() fires
GameInstance.Awake() |
  IGameStateMachine resolved | EnterState<BootstrapperState>()
```

### Why deactivate the prefab

If `GameInstance` were instantiated while active, Unity would call `Awake()` on every component immediately. Components that read `[Zenjex]` fields in `Awake()` would get `null` because the relevant bindings haven't been registered yet. Temporary deactivation breaks the Awake chain and gives bootstrap code a safe window to finish wiring before anything ticks.

<!-- 📸 Screenshot: ProjectRootInstaller component in the scene hierarchy, or the GameInstance prefab in the Project window -->
