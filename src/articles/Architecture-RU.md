# Архитектура

## Содержание
- [Обзор](#обзор)
- [Game State Machine](#game-state-machine)
- [Dependency Injection - Zenjex](#dependency-injection--zenjex)
- [Addressables и управление ассетами](#addressables-и-управление-ассетами)
- [InstallerFactory и последовательность запуска](#installerfactory-и-последовательность-запуска)

---

## Обзор

Архитектурный хребет проекта держат три системы: **Game State Machine**, управляющая жизненным циклом приложения; **кастомный DI-фреймворк Zenjex**, связывающий сервисы; и **Unity Addressables** с кеширующим слоем для загрузки ассетов по требованию. Вместе они задают последовательность запуска, владение рантаймовыми объектами и контракты между системами.

---

## Game State Machine

### Назначение

`GameStateMachine` - единственная точка управления всеми крупными переходами в приложении. В каждый момент активно ровно одно состояние, и все загрузки сцен, рестарты и переходы в меню проходят только через неё.

### Типы состояний

Два интерфейса покрывают все состояния:

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

`IGameExitableState` добавляет `Exit()` и `StateType Type { get; }`, поэтому машина всегда выходит из текущего состояния до входа в следующее, вне зависимости от конкретного класса.

### Граф переходов

```flow
BootstrapperState | загружает Addressables, строит DI-контейнер, инициализирует сервисы
LoadProgressState | читает PlayerPrefs / облачный сейв, валидирует GameProgress
MainMenuState | создаёт UI главного меню, ждёт ввода игрока
LoadLevelState | получает string payload (ключ уровня)
  сохраняет прогресс, загружает сцену, спаунит игрока |
GameLoopState | запускает LiveProgressSync, активирует геймплей
```

### Реализация машины

Машина не содержит геймплейной логики. Она вызывает `Exit()` на уходящем состоянии, резолвит новое через `StateFactory` и вызывает `Enter()` или `Enter(payload)`:

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

`StateFactory` резолвит состояния из DI-контейнера, поэтому каждое состояние получает зависимости через конструкторную инъекцию - никаких service locator-вызовов внутри логики состояний.

### Запрос текущего состояния

`GetCurrentState()` возвращает значение enum `StateType`, позволяя любой системе проверить текущую фазу приложения без прямой ссылки на внутренности машины.

<figure class="diagram-gif-wrap">
  <img class="diagram-gif--dark"  data-img="gamestate_diagram_dark.gif"  alt="Диаграмма переходов GameState — тёмная тема" width="640" height="480">
  <img class="diagram-gif--light" data-img="gamestate_diagram_light.gif" alt="Диаграмма переходов GameState — светлая тема" width="640" height="480">
</figure>

---

## Dependency Injection - Zenjex

Zenjex подробно разобран в отдельной статье: **[Zenjex - DI Framework](Zenjex-RU)**.

Кратко для контекста: все сервисы, зарегистрированные в `ProjectRootInstaller.InstallBindings()`, доступны глобально через `RootContext`. Компоненты `ZenjexBehaviour` получают зависимости автоматически до вызова `OnAwake()`. Двухфазный бутстрап (`OnContainerReady` затем `OnGameLaunched`) гарантирует инъекцию в асинхронно загруженные объекты до первого обращения к ним.

---

## Addressables и управление ассетами

### AssetLoader

`AssetLoader` - единственный шлюз для всех рантаймовых операций с ассетами. Оборачивает Unity Addressables двумя слоями внутреннего состояния:

- **`_completedHandles`** - кеширует `AsyncOperationHandle` по GUID или адресу после первой успешной загрузки. Повторные вызовы `LoadAsync<T>` с тем же ключом минуют Addressables и возвращают кешированный результат.
- **`_calledHandles`** - хранит все когда-либо запрошенные хэндлы; используется в `Cleanup()` для единовременного освобождения всех хэндлов.
- **`_instantiatedObjects`** - хранит хэндлы из `InstantiateAsync`. `Cleanup()` вызывает `Addressables.ReleaseInstance()` на каждом - уничтожает GameObject и одновременно освобождает ссылку на бандл.

### API

```api
UniTask<T> | LoadAsync<T>(AssetReference assetReference)
UniTask<T> | LoadAsync<T>(string assetAddress)
UniTask<GameObject> | InstantiateAsync(string address)
UniTask<GameObject> | InstantiateAsync(string address, Transform parent)
UniTask<GameObject> | InstantiateAsync(AssetReference assetReference)
UniTask<GameObject> | InstantiateAsync(AssetReference assetReference, Transform parent)
T | Load<T>(string path) | синхронный fallback через Resources
void | Cleanup()
```

### Предзагрузка

`AssetsPreloader` запускается при старте внутри `LoadProgressState` и прогревает фиксированный список Addressable-адресов до начала геймплея. Это убирает задержки при первом обращении к часто используемым ассетам - префабам врагов, VFX и другим.

### Константы адресов

Все Addressable-ключи - строковые константы в статических классах `AssetAddresses`, по одному на каждый фиче-домен. Никаких строковых литералов по всей кодовой базе, и опечатка в адресе становится ошибкой рефакторинга, а не рантаймовым падением.

<!-- 📸 Скриншот: окно Addressables Groups с организацией ассетов -->

---

## InstallerFactory и последовательность запуска

`InstallerFactory` обрабатывает самые первые моменты запуска приложения - до существования DI-контейнера и до активации любого `ZenjexBehaviour`.

### Дизайн с двумя рутинами

Фабрика предоставляет два корутин-метода, которые нужно вызвать по порядку:

**1. `CreateLoadingScreenRoutine(onComplete)`**

Загружает и инстанциирует префаб загрузочного экрана через Addressables. GameObject помечается `DontDestroyOnLoad`. Компонент `ILoadScreen` возвращается через `onComplete`, чтобы вызывающий код мог зарегистрировать его в DI-контейнере до создания `GameInstance`.

**2. `CreateGameInstanceRoutine(onBeforeActivate, onComplete)`**

Загружает префаб `GameInstance`. До вызова `Instantiate` выставляется `prefab.SetActive(false)` - это останавливает Unity от вызова `Awake()` на компонентах `ZenjexBehaviour` до регистрации DI-биндингов. `onBeforeActivate` срабатывает с ещё неактивным инстансом, давая окно для регистрации оставшихся биндингов. Только после этого вызывается `go.SetActive(true)` - и все `Awake()` срабатывают с полностью заполненным контейнером.

```flow
CreateLoadingScreenRoutine() |
  Addressables.LoadAsync -> Instantiate -> DontDestroyOnLoad |
  onComplete(ILoadScreen) | зарегистрировать в контейнере
CreateGameInstanceRoutine() |
  Addressables.LoadAsync -> prefab.SetActive(false) -> Instantiate |
  onBeforeActivate(instance) | зарегистрировать рантаймовые биндинги
  go.SetActive(true) | ZenjexBehaviour.Awake() срабатывает
GameInstance.Awake() |
  IGameStateMachine резолвится | EnterState<BootstrapperState>()
```

### Зачем деактивировать префаб

Если бы `GameInstance` инстанциировался активным, Unity немедленно вызвал бы `Awake()` на каждом компоненте. Компоненты, читающие `[Zenjex]`-поля в `Awake()`, получили бы `null` - нужные биндинги ещё не зарегистрированы. Временная деактивация прерывает цепочку Awake и даёт коду бутстрапа безопасное окно для завершения связывания до первого тика.

<!-- 📸 Скриншот: компонент ProjectRootInstaller в иерархии сцены или префаб GameInstance в Project-окне -->
