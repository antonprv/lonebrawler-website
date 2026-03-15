# Zenjex - DI Framework

> GitHub: [antonprv/Zenjex](https://github.com/antonprv/Zenjex) · Docs: [antonprv.github.io/zenjex-website](https://antonprv.github.io/zenjex-website/docs.html)

## Table of Contents
- [What is Zenjex](#what-is-zenjex)
- [Core Concepts](#core-concepts)
- [Injection Passes](#injection-passes)
- [ZenjexBehaviour](#zenjexbehaviour)
- [Binding API](#binding-api)
- [Scene-Scoped Containers](#scene-scoped-containers)
- [IInitializable](#iinitializable)
- [Runtime Instantiation](#runtime-instantiation)
- [Editor Debugger](#editor-debugger)

---

## What is Zenjex

Zenjex is a custom DI framework written from scratch for this project and later open-sourced. It sits on top of the **Reflex** container and adds a Zenject-style API plus Unity-specific injection mechanics that Reflex doesn't cover natively:

- Field, property, and method injection via the `[Zenjex]` attribute
- Three-pass automatic scene injection with deduplication
- `ZenjexBehaviour` base class - guaranteed injection before `Awake`
- `IInitializable` lifecycle hook
- `ZenjexSceneContext` for scene-scoped sub-containers
- Built-in editor debugger

The framework ships as a separate Unity package and is reused across projects.

---

## Core Concepts

### The `[Zenjex]` attribute

Put `[Zenjex]` on any private readonly field, property, or method to request injection:

```csharp
public class PlayerMove : ZenjexBehaviour
{
    [Zenjex] private readonly IInputService _input;
    [Zenjex] private readonly ITimeService _time;
    [Zenjex] private readonly IPlayerDataSubervice _playerData;

    protected override void OnAwake()
    {
        // _input, _time, _playerData are injected here
    }
}
```

`ZenjexInjector` caches the reflection scan per type in `Dictionary<Type, TypeZenjexInfo>`, so `GetFields`, `GetProperties`, and `GetMethods` run exactly once per type over the application's lifetime.

### RootContext

`RootContext` is a static facade over `ProjectRootInstaller.RootContainer`:

```csharp
RootContext.Runtime       // live Container - for post-init bindings
RootContext.HasInstance   // check before resolving
RootContext.Resolve<T>()  // typed resolve
RootContext.Resolve(Type) // untyped resolve (used by ZenjexInjector internally)
```

---

## Injection Passes

`ZenjexRunner` hooks into three events at `[RuntimeInitializeOnLoadMethod(BeforeSceneLoad)]` and handles all scene-level injection automatically.

### Pass 1 - `OnContainerReady`

Fires **synchronously inside `ProjectRootInstaller.Awake()`** at `ExecutionOrder -280`. By the time any other `Awake()` in the scene runs (execution order above -280), `ZenjexRunner` has already walked every root `GameObject` in every loaded scene and filled all `[Zenjex]` members.

This is the standard path for the vast majority of components.

### Pass 2 - `OnGameLaunched`

Fires after `InstallGameInstanceRoutine()` completes and `LaunchGame()` has been called. Covers objects that depend on bindings added during async setup - for example, services registered only after Addressables finish loading.

### Pass 3 - `SceneManager.sceneLoaded`

Fires for scenes loaded additively after launch. Unity has already called `Awake()` on those objects by this point, so injection happens after `Awake()`. `ZenjexRunner` prints a `ZNX-LATE` warning to the console for each affected component - a signal to switch to `ZenjexBehaviour`.

### Deduplication

Each injected instance is stored by `GetInstanceID()` in a `HashSet<int>`. Before injecting, `ZenjexRunner` checks the set - if the ID is already there, the object is skipped. `ZenjexBehaviour.Awake()` calls `ZenjexRunner.MarkInjected(this)` to pre-register itself, so no subsequent pass touches it again.

```timeline
[Pass 1]
Component A | plain MonoBehaviour — injected
[ZenjexBehaviour.Awake]
Component B | self-injects -> MarkInjected(B)
[Pass 2]
Component C | depends on late binding — injected
Component B | already in HashSet — skipped
[Pass 3]
Component D | additive scene -> ZNX-LATE warning
```

---

## ZenjexBehaviour

`ZenjexBehaviour` is the recommended base class for any `MonoBehaviour` that uses `[Zenjex]`. It runs at `ExecutionOrder -100` - later than `ProjectRootInstaller` at -280 but ahead of the default 0, so the container is always populated when it ticks.

```csharp
[DefaultExecutionOrder(-100)]
public abstract class ZenjexBehaviour : MonoBehaviour
{
    private void Awake()
    {
        if (RootContext.HasInstance)
        {
            ZenjexInjector.Inject(this);
            ZenjexRunner.MarkInjected(this);
        }
        OnAwake();
    }

    protected virtual void OnAwake() { }
}
```

**Override `OnAwake()` instead of `Awake()`** - every `[Zenjex]` field is guaranteed non-null by the time `OnAwake()` runs.

For plain `MonoBehaviour` classes not inheriting `ZenjexBehaviour`, Pass 1 handles injection when the component is in the scene at startup. For dynamically created ones, call `ZenjexRunner.InjectGameObject(go)` right after `Instantiate`.

---

## Binding API

Bindings go into `ProjectRootInstaller.InstallBindings(ContainerBuilder builder)` through the fluent `BindingBuilder<T>`.

### Basic type binding

```csharp
// Interface -> concrete type, lazy singleton
builder.Bind<ISaveLoadService>()
       .To<SaveLoadService>()
       .AsSingle();

// Eager singleton - created when the container builds, not on first resolve
builder.Bind<IGameStateMachine>()
       .To<GameStateMachine>()
       .BindInterfacesAndSelf()
       .AsEagerSingleton();
```

### Instance binding

```csharp
var config = Resources.Load<GameConfig>("GameConfig");
builder.Bind<GameConfig>()
       .FromInstance(config)
       .AsSingle();
```

### Prefab-based MonoBehaviour singleton

```csharp
builder.Bind<CameraFollow>()
       .BindInterfacesAndSelf()
       .FromComponentInNewPrefab(cameraFollowPrefab)
       .WithGameObjectName("Camera")
       .UnderTransformGroup("Infrastructure")
       .NonLazy();
```

`UnderTransformGroup` creates a named parent `GameObject` and moves the instantiated prefab under it, keeping the scene hierarchy tidy.

### Constructor with mixed arguments

Some services need both container-resolved dependencies and explicit values - say, a reference to a spawned prefab. `WithArguments` handles the explicit side; the rest come from the container:

```csharp
builder.Bind<InputService>()
       .BindInterfacesAndSelf()
       .WithArguments(playerInput, cinemachineProvider)
       .AsSingle();
```

### Scoped bindings

`CopyIntoDirectSubContainers()` marks a binding as scoped - each scene sub-container built by `SceneInstaller` gets its own instance:

```csharp
builder.Bind<LevelProgressWatcher>()
       .BindInterfacesAndSelf()
       .CopyIntoDirectSubContainers()
       .AsSingle();
```

### Lifetime reference

| Method | Lifetime | Resolution |
|---|---|---|
| `AsSingle()` / `AsSingleton()` | Singleton | Lazy |
| `NonLazy()` / `AsEagerSingleton()` | Singleton | Eager |
| `AsTransient()` | Transient | New instance per resolve |
| `CopyIntoDirectSubContainers().AsSingle()` | Scoped | Lazy per sub-container |

### Post-init runtime binding

After the container is built, `RootContext.Runtime` lets you register values found at runtime:

```csharp
// Inside InstallGameInstanceRoutine, after Addressables finish:
RootContext.Runtime.RegisterValue(loadedConfig, new[] { typeof(ILevelConfig) });
```

---

## Scene-Scoped Containers

`ZenjexSceneContext` keeps a `Dictionary<int, Container>` keyed by `Scene.handle`. `SceneInstaller` - a `MonoBehaviour` in each gameplay scene - builds a sub-container that inherits from the root and registers it:

```csharp
// From any global service or state machine state:
var sceneContainer = ZenjexSceneContext.GetActive();
var watcher = sceneContainer.Resolve<LevelProgressWatcher>();

// Or in one call:
ZenjexSceneContext.Resolve<LevelProgressWatcher>();
```

On scene unload, `SceneInstaller.OnDestroy()` calls `ZenjexSceneContext.Unregister(scene)`, which disposes the sub-container and releases all scoped instances.

---

## IInitializable

Services that need to run code after injection but before `LaunchGame()` implement `IInitializable`:

```csharp
public class GameStateMachine : IInitializable
{
    private readonly StateFactory _stateFactory;

    public GameStateMachine(StateFactory stateFactory) =>
        _stateFactory = stateFactory;

    public void Initialize() => EnterState<BootstrapperState>();
}
```

For `ProjectRootInstaller` to discover the service, it **must expose `IInitializable` as a contract**:

```csharp
builder.Bind<GameStateMachine>()
       .BindInterfacesAndSelf() // registers IInitializable, IGameStateMachine, GameStateMachine
       .AsEagerSingleton();
```

`ProjectRootInstaller` calls `container.All<IInitializable>()` and iterates through the results, calling `Initialize()` on each. Order within the group follows registration order.

---

## Runtime Instantiation

For `GameObject`s created after launch via `Instantiate()`, call `ZenjexRunner.InjectGameObject(go)` right after:

```csharp
var enemy = Object.Instantiate(enemyPrefab);
ZenjexRunner.InjectGameObject(enemy);
```

This walks all `MonoBehaviour` components in the hierarchy, including inactive ones, and injects those with `[Zenjex]` members. Components already in the `_injected` set are skipped. `GameFactory` calls this internally after every `InstantiateAsync`, so individual systems don't need to do it themselves.

---

## Editor Debugger

Open via **Window -> Analysis -> Reflex Debugger**.

**Reflex tab** - tree view of all bindings in the root container, filterable by type name. Good for checking that a service is registered under the right interface.

**Zenjex tab** - table of every injected object with columns for type name, `GameObject` name, scene, injection pass, and a late-injection flag. A search field filters both the type list on the left and the records on the right. `ZNX-LATE` rows are highlighted, making it straightforward to spot components that need to be switched to `ZenjexBehaviour`.

<!-- 📸 Screenshot: Reflex Debugger window open on the Zenjex tab, showing injection records -->
