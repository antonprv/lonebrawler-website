# Zenjex - DI Framework

> GitHub: [antonprv/Zenjex](https://github.com/antonprv/Zenjex) · Документация: [antonprv.github.io/zenjex-website](https://antonprv.github.io/zenjex-website/docs.html)

## Содержание
- [Что такое Zenjex](#что-такое-zenjex)
- [Ключевые концепции](#ключевые-концепции)
- [Проходы инъекции](#проходы-инъекции)
- [ZenjexBehaviour](#zenjexbehaviour)
- [Binding API](#binding-api)
- [Scene-scoped контейнеры](#scene-scoped-контейнеры)
- [IInitializable](#iinitializable)
- [Рантаймовое инстанцирование](#рантаймовое-инстанцирование)
- [Редакторный дебаггер](#редакторный-дебаггер)

---

## Что такое Zenjex

Zenjex - собственный DI-фреймворк, написанный с нуля для этого проекта и впоследствии открытый. Он надстраивается над контейнером **Reflex**, добавляя Zenject-подобный API и Unity-специфичную механику инъекции, которой в Reflex нет:

- Инъекция полей, свойств и методов через атрибут `[Zenjex]`
- Три прохода автоматической инъекции по сцене с дедупликацией
- Базовый класс `ZenjexBehaviour` - гарантированная инъекция до `Awake`
- Хук жизненного цикла `IInitializable`
- `ZenjexSceneContext` для scene-scoped sub-контейнеров
- Встроенный редакторный дебаггер

Фреймворк поставляется отдельным Unity-пакетом и переиспользуется в разных проектах.

---

## Ключевые концепции

### Атрибут `[Zenjex]`

Поставьте `[Zenjex]` на любое приватное readonly-поле, свойство или метод - и зависимость будет заполнена автоматически:

```csharp
public class PlayerMove : ZenjexBehaviour
{
    [Zenjex] private readonly IInputService _input;
    [Zenjex] private readonly ITimeService _time;
    [Zenjex] private readonly IPlayerDataSubervice _playerData;

    protected override void OnAwake()
    {
        // _input, _time, _playerData уже заполнены
    }
}
```

`ZenjexInjector` кеширует результат рефлексии в `Dictionary<Type, TypeZenjexInfo>`, поэтому `GetFields`, `GetProperties` и `GetMethods` вызываются ровно один раз за время жизни приложения.

### RootContext

`RootContext` - статический фасад над `ProjectRootInstaller.RootContainer`:

```csharp
RootContext.Runtime       // живой Container - для постинициализационных биндингов
RootContext.HasInstance   // проверка перед резолвом
RootContext.Resolve<T>()  // типизированный резолв
RootContext.Resolve(Type) // нетипизированный резолв (внутри ZenjexInjector)
```

---

## Проходы инъекции

`ZenjexRunner` подписывается на три события при `[RuntimeInitializeOnLoadMethod(BeforeSceneLoad)]` и берёт на себя всю инъекцию на уровне сцен.

### Проход 1 - `OnContainerReady`

Срабатывает **синхронно внутри `ProjectRootInstaller.Awake()`** с `ExecutionOrder -280`. К моменту, когда любой другой `Awake()` в сцене запускается (порядок выполнения выше -280), `ZenjexRunner` уже обошёл все корневые `GameObject`-ы во всех загруженных сценах и заполнил все `[Zenjex]`-поля.

Это стандартный путь для подавляющего большинства компонентов.

### Проход 2 - `OnGameLaunched`

Срабатывает после завершения `InstallGameInstanceRoutine()` и вызова `LaunchGame()`. Покрывает объекты, зависящие от биндингов, добавленных в ходе асинхронной настройки - например, сервисов, зарегистрированных только после загрузки Addressables.

### Проход 3 - `SceneManager.sceneLoaded`

Срабатывает для сцен, загруженных аддитивно после запуска. Unity к этому моменту уже вызвал `Awake()` на объектах новой сцены, поэтому инъекция происходит после `Awake()`. `ZenjexRunner` выводит предупреждение `ZNX-LATE` в консоль для каждого такого компонента - сигнал перевести его на `ZenjexBehaviour`.

### Дедупликация

Каждый инжектированный инстанс записывается по `GetInstanceID()` в `HashSet<int>`. До инъекции `ZenjexRunner` проверяет сет - если ID уже есть, объект пропускается. `ZenjexBehaviour.Awake()` вызывает `ZenjexRunner.MarkInjected(this)`, предрегистрируя себя, - ни один последующий проход его не тронет.

```
Проход 1 инжектирует:  Компонент A (plain MonoBehaviour)
ZenjexBehaviour.Awake инжектирует: Компонент B -> MarkInjected(B)
Проход 2 инжектирует:  Компонент C (зависит от позднего биндинга)
                       Компонент B -> пропущен (уже в HashSet)
Проход 3 инжектирует:  Компонент D (аддитивная сцена) -> ZNX-LATE
```

---

## ZenjexBehaviour

`ZenjexBehaviour` - рекомендуемый базовый класс для любого `MonoBehaviour` с `[Zenjex]`. Запускается с `ExecutionOrder -100` - позже `ProjectRootInstaller` с -280, но раньше дефолтного 0, контейнер к этому моменту всегда готов.

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

**Переопределяйте `OnAwake()` вместо `Awake()`** - к его вызову все `[Zenjex]`-поля гарантированно не-null.

Для plain `MonoBehaviour`-классов без наследования от `ZenjexBehaviour` Проход 1 покрывает инъекцию если компонент есть в сцене при старте. Для динамически созданных - вызовите `ZenjexRunner.InjectGameObject(go)` сразу после `Instantiate`.

---

## Binding API

Биндинги регистрируются в `ProjectRootInstaller.InstallBindings(ContainerBuilder builder)` через fluent `BindingBuilder<T>`.

### Базовый биндинг типа

```csharp
// Интерфейс -> конкретный тип, lazy синглтон
builder.Bind<ISaveLoadService>()
       .To<SaveLoadService>()
       .AsSingle();

// Eager синглтон - создаётся при сборке контейнера, а не при первом резолве
builder.Bind<IGameStateMachine>()
       .To<GameStateMachine>()
       .BindInterfacesAndSelf()
       .AsEagerSingleton();
```

### Биндинг инстанса

```csharp
var config = Resources.Load<GameConfig>("GameConfig");
builder.Bind<GameConfig>()
       .FromInstance(config)
       .AsSingle();
```

### Prefab-based MonoBehaviour синглтон

```csharp
builder.Bind<CameraFollow>()
       .BindInterfacesAndSelf()
       .FromComponentInNewPrefab(cameraFollowPrefab)
       .WithGameObjectName("Camera")
       .UnderTransformGroup("Infrastructure")
       .NonLazy();
```

`UnderTransformGroup` создаёт именованный родительский `GameObject` и перемещает инстанцированный префаб под него - иерархия сцены остаётся аккуратной.

### Конструктор со смешанными аргументами

Некоторым сервисам нужны и контейнерные зависимости, и явные значения - например, ссылка на заспауненный префаб. `WithArguments` берёт явные; остальные параметры конструктора резолвятся из контейнера:

```csharp
builder.Bind<InputService>()
       .BindInterfacesAndSelf()
       .WithArguments(playerInput, cinemachineProvider)
       .AsSingle();
```

### Scoped биндинги

`CopyIntoDirectSubContainers()` делает биндинг scoped - каждый scene sub-контейнер, построенный `SceneInstaller`, получает свой инстанс:

```csharp
builder.Bind<LevelProgressWatcher>()
       .BindInterfacesAndSelf()
       .CopyIntoDirectSubContainers()
       .AsSingle();
```

### Справочник по лайфтаймам

| Метод | Лайфтайм | Resolution |
|---|---|---|
| `AsSingle()` / `AsSingleton()` | Singleton | Lazy |
| `NonLazy()` / `AsEagerSingleton()` | Singleton | Eager |
| `AsTransient()` | Transient | Новый инстанс на каждый резолв |
| `CopyIntoDirectSubContainers().AsSingle()` | Scoped | Lazy на sub-контейнер |

### Постинициализационный рантаймовый биндинг

После сборки контейнера `RootContext.Runtime` открывает прямой доступ для регистрации значений, найденных в рантайме:

```csharp
// Внутри InstallGameInstanceRoutine, после загрузки Addressables:
RootContext.Runtime.RegisterValue(loadedConfig, new[] { typeof(ILevelConfig) });
```

---

## Scene-scoped контейнеры

`ZenjexSceneContext` ведёт `Dictionary<int, Container>` с ключом по `Scene.handle`. `SceneInstaller` - `MonoBehaviour` в каждой геймплейной сцене - строит sub-контейнер, наследующий от корневого, и регистрирует его:

```csharp
// Из любого глобального сервиса или состояния машины:
var sceneContainer = ZenjexSceneContext.GetActive();
var watcher = sceneContainer.Resolve<LevelProgressWatcher>();

// Или сразу:
ZenjexSceneContext.Resolve<LevelProgressWatcher>();
```

При выгрузке сцены `SceneInstaller.OnDestroy()` вызывает `ZenjexSceneContext.Unregister(scene)`, диспозит sub-контейнер и освобождает все scoped-инстансы.

---

## IInitializable

Сервисам, которым нужно выполнить код после инъекции, но до `LaunchGame()`, достаточно реализовать `IInitializable`:

```csharp
public class GameStateMachine : IInitializable
{
    private readonly StateFactory _stateFactory;

    public GameStateMachine(StateFactory stateFactory) =>
        _stateFactory = stateFactory;

    public void Initialize() => EnterState<BootstrapperState>();
}
```

Чтобы `ProjectRootInstaller` нашёл сервис, он **должен предоставлять `IInitializable` как контракт**:

```csharp
builder.Bind<GameStateMachine>()
       .BindInterfacesAndSelf() // регистрирует IInitializable, IGameStateMachine, GameStateMachine
       .AsEagerSingleton();
```

`ProjectRootInstaller` вызывает `container.All<IInitializable>()` и итерирует, вызывая `Initialize()` на каждом. Порядок внутри группы - порядок регистрации.

---

## Рантаймовое инстанцирование

Для `GameObject`-ов, создаваемых после запуска через `Instantiate()`, вызовите `ZenjexRunner.InjectGameObject(go)` сразу после:

```csharp
var enemy = Object.Instantiate(enemyPrefab);
ZenjexRunner.InjectGameObject(enemy);
```

Обходит все `MonoBehaviour`-компоненты в иерархии, включая неактивные, и инжектирует те, у которых есть `[Zenjex]`-поля. Компоненты, уже записанные в сет `_injected`, пропускаются. `GameFactory` вызывает это внутренне после каждого `InstantiateAsync`, так что отдельным системам делать это вручную не нужно.

---

## Редакторный дебаггер

Открывается через **Window -> Analysis -> Reflex Debugger**.

**Вкладка Reflex** - дерево всех биндингов в корневом контейнере с фильтром по имени типа. Удобно проверить, что сервис зарегистрирован под нужным интерфейсом.

**Вкладка Zenjex** - таблица каждого инжектированного объекта: имя типа, имя `GameObject`, сцена, проход инъекции, флаг поздней инъекции. Поле поиска фильтрует список типов слева и записи справа одновременно. Строки `ZNX-LATE` подсвечиваются - сразу видно, какие компоненты нужно перевести на `ZenjexBehaviour`.

<!-- 📸 Скриншот: окно Reflex Debugger на вкладке Zenjex с записями инъекций -->
