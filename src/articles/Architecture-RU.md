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

<div class="gsm-diagram">
<svg viewBox="0 0 600 480" xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="gsm-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" class="gsm-arr" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>

  <!-- Pulsing rings behind GameLoop -->
  <circle class="gsm-ring gsm-r2" cx="300" cy="350" r="97" stroke-width="1"/>
  <circle class="gsm-ring gsm-r1" cx="300" cy="350" r="85" stroke-width="1.2"/>

  <!-- Forward arrows -->
  <line class="gsm-arr" x1="300" y1="72"  x2="300" y2="102" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line class="gsm-arr" x1="300" y1="147" x2="300" y2="177" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line class="gsm-arr" x1="300" y1="222" x2="300" y2="252" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line class="gsm-arr" x1="300" y1="297" x2="300" y2="324" stroke-width="1" marker-end="url(#gsm-ah)"/>

  <!-- Arrow labels -->
  <text class="gsm-lbl" x="306" y="87"  font-size="8" dominant-baseline="central">Scene loaded</text>
  <text class="gsm-lbl" x="306" y="162" font-size="8" dominant-baseline="central">Auto</text>
  <text class="gsm-lbl" x="306" y="237" font-size="8" dominant-baseline="central">New game / Continue</text>
  <text class="gsm-lbl" x="306" y="311" font-size="8" dominant-baseline="central">Level loaded</text>

  <!-- Back arrow: GameLoop → MainMenu (right) -->
  <path class="gsm-arr" d="M386,350 L472,350 L472,200 L387,200" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text class="gsm-lbl" x="476" y="275" font-size="8" dominant-baseline="central">quit_to_menu</text>

  <!-- Back arrow: GameLoop → LoadLevel (left) -->
  <path class="gsm-arr" d="M214,350 L128,350 L128,275 L213,275" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text class="gsm-lbl" x="124" y="312" font-size="8" text-anchor="end" dominant-baseline="central">Teleport</text>

  <!-- State 0: BootStrapperState -->
  <rect class="gsm-b0" x="214" y="28"  width="172" height="44" rx="7" stroke-width="0.8"/>
  <rect class="gsm-a0" x="214" y="34"  width="3"   height="32" rx="2"/>
  <text class="gsm-name" x="300" y="46"  font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">BootStrapperState</text>
  <text class="gsm-sub0" x="300" y="61"  font-size="8"               text-anchor="middle" dominant-baseline="central">Init &amp; config</text>

  <!-- State 1: LoadProgressState -->
  <rect class="gsm-b1" x="214" y="103" width="172" height="44" rx="7" stroke-width="0.8"/>
  <rect class="gsm-a1" x="214" y="109" width="3"   height="32" rx="2"/>
  <text class="gsm-name" x="300" y="121" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">LoadProgressState</text>
  <text class="gsm-sub1" x="300" y="136" font-size="8"               text-anchor="middle" dominant-baseline="central">Load / create save</text>

  <!-- State 2: MainMenuState -->
  <rect class="gsm-b2" x="214" y="178" width="172" height="44" rx="7" stroke-width="0.8"/>
  <rect class="gsm-a2" x="214" y="184" width="3"   height="32" rx="2"/>
  <text class="gsm-name" x="300" y="196" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">MainMenuState</text>
  <text class="gsm-sub2" x="300" y="211" font-size="8"               text-anchor="middle" dominant-baseline="central">Menu UI active</text>

  <!-- State 3: LoadLevelState -->
  <rect class="gsm-b3" x="214" y="253" width="172" height="44" rx="7" stroke-width="0.8"/>
  <rect class="gsm-a3" x="214" y="259" width="3"   height="32" rx="2"/>
  <text class="gsm-name" x="300" y="271" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">LoadLevelState</text>
  <text class="gsm-sub3" x="300" y="286" font-size="8"               text-anchor="middle" dominant-baseline="central">Setup game world</text>

  <!-- State 4: GameLoopState (active, animated border) -->
  <rect class="gsm-b4 gsm-gl" x="214" y="325" width="172" height="50" rx="9" stroke-width="1.5"/>
  <rect class="gsm-a4" x="214" y="332" width="3"   height="36" rx="2"/>
  <text class="gsm-name" x="300" y="345" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">GameLoopState</text>
  <circle class="gsm-sub4 gsm-dot" cx="270" cy="362" r="4"/>
  <text  class="gsm-sub4 gsm-dot" x="278" y="362" font-size="8" dominant-baseline="central">Running</text>

  <!-- Initial pseudostate -->
  <circle class="gsm-init" cx="300" cy="14" r="6"/>
  <line   class="gsm-arr"  x1="300" y1="20" x2="300" y2="27" stroke-width="1" marker-end="url(#gsm-ah)"/>

  <!-- Legend -->
  <line   class="gsm-arr"  x1="32"  y1="462" x2="66"  y2="462" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <text   class="gsm-lbl"  x="72"   y="462"  font-size="8" dominant-baseline="central">Auto</text>
  <line   class="gsm-arr"  x1="138" y1="462" x2="172" y2="462" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text   class="gsm-lbl"  x="178"  y="462"  font-size="8" dominant-baseline="central">Triggered</text>
  <circle class="gsm-sub4" cx="258" cy="462" r="4"/>
  <text   class="gsm-lbl"  x="266"  y="462"  font-size="8" dominant-baseline="central">Active state</text>
</svg>
</div>

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
