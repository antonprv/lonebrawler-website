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
<style>
.gsm-diagram{margin:1.4rem 0 1.6rem;--gd-text:#e8e4dc;--gd-muted:#6a6860;--gd-arr:#4a4840;--gd-gray-bg:#252428;--gd-gray-acc:#72706a;--gd-gray-bor:#383636;--gd-blue-bg:#132030;--gd-blue-acc:#4490d8;--gd-blue-bor:#1c3858;--gd-purp-bg:#1c1838;--gd-purp-acc:#7a70d0;--gd-purp-bor:#2c2858;--gd-crl-bg:#2a1610;--gd-crl-acc:#cc5828;--gd-crl-bor:#442416;--gd-teal-bg:#0a2620;--gd-teal-acc:#1aa07a;--gd-teal-bor:#1aa07a;--gd-teal-hi:#52c8a0}
html[data-theme="light"] .gsm-diagram{--gd-text:#1a1a18;--gd-muted:#5a5850;--gd-arr:#a0988a;--gd-gray-bg:#eae8e2;--gd-gray-acc:#666460;--gd-gray-bor:#c0beb8;--gd-blue-bg:#daeaf8;--gd-blue-acc:#1860a8;--gd-blue-bor:#a0c4e4;--gd-purp-bg:#eae8fc;--gd-purp-acc:#4e3ab2;--gd-purp-bor:#b0a8e4;--gd-crl-bg:#fce6de;--gd-crl-acc:#a03518;--gd-crl-bor:#e4a890;--gd-teal-bg:#d6f0e8;--gd-teal-acc:#0d6e56;--gd-teal-bor:#0d6e56;--gd-teal-hi:#0d6e56}
.gsm-diagram svg{display:block;width:100%;height:auto}
@keyframes gsm-r1{0%,100%{opacity:.12}50%{opacity:.40}}
@keyframes gsm-r2{0%,100%{opacity:.04}50%{opacity:.16}}
@keyframes gsm-dt{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes gsm-gl{0%,100%{stroke-opacity:.6;stroke-width:1.2}50%{stroke-opacity:1;stroke-width:2}}
.gsm-r1{animation:gsm-r1 2.2s ease-in-out infinite}
.gsm-r2{animation:gsm-r2 2.2s ease-in-out infinite .5s}
.gsm-dt{animation:gsm-dt 1.1s ease-in-out infinite}
.gsm-gl{animation:gsm-gl 2.2s ease-in-out infinite}
</style>
<svg viewBox="0 0 600 480" xmlns="http://www.w3.org/2000/svg" font-family="inherit">
  <defs>
    <marker id="gsm-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>

  <!-- Pulsing rings behind GameLoop -->
  <circle class="gsm-r2" cx="300" cy="350" r="97" fill="none" stroke="var(--gd-teal-bor)" stroke-width="1"/>
  <circle class="gsm-r1" cx="300" cy="350" r="85" fill="none" stroke="var(--gd-teal-bor)" stroke-width="1.2"/>

  <!-- Forward arrows -->
  <line x1="300" y1="72"  x2="300" y2="102" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line x1="300" y1="147" x2="300" y2="177" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line x1="300" y1="222" x2="300" y2="252" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <line x1="300" y1="297" x2="300" y2="324" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>

  <!-- Arrow labels -->
  <text x="306" y="87"  font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Scene loaded</text>
  <text x="306" y="162" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Auto</text>
  <text x="306" y="237" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">New game / Continue</text>
  <text x="306" y="311" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Level loaded</text>

  <!-- Back arrow: GameLoop → MainMenu (right) -->
  <path d="M386,350 L472,350 L472,200 L387,200" fill="none" stroke="var(--gd-arr)" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text x="476" y="275" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">quit_to_menu</text>

  <!-- Back arrow: GameLoop → LoadLevel (left) -->
  <path d="M214,350 L128,350 L128,275 L213,275" fill="none" stroke="var(--gd-arr)" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text x="124" y="312" font-size="8" fill="var(--gd-muted)" text-anchor="end" dominant-baseline="central">Teleport</text>

  <!-- State 0: BootStrapperState -->
  <rect x="214" y="28"  width="172" height="44" rx="7" fill="var(--gd-gray-bg)" stroke="var(--gd-gray-bor)" stroke-width="0.8"/>
  <rect x="214" y="34"  width="3"   height="32" rx="2" fill="var(--gd-gray-acc)"/>
  <text x="300" y="46"  font-size="10" font-weight="600" fill="var(--gd-text)"     text-anchor="middle" dominant-baseline="central">BootStrapperState</text>
  <text x="300" y="61"  font-size="8"               fill="var(--gd-gray-acc)" text-anchor="middle" dominant-baseline="central">Init &amp; config</text>

  <!-- State 1: LoadProgressState -->
  <rect x="214" y="103" width="172" height="44" rx="7" fill="var(--gd-blue-bg)" stroke="var(--gd-blue-bor)" stroke-width="0.8"/>
  <rect x="214" y="109" width="3"   height="32" rx="2" fill="var(--gd-blue-acc)"/>
  <text x="300" y="121" font-size="10" font-weight="600" fill="var(--gd-text)"     text-anchor="middle" dominant-baseline="central">LoadProgressState</text>
  <text x="300" y="136" font-size="8"               fill="var(--gd-blue-acc)" text-anchor="middle" dominant-baseline="central">Load / create save</text>

  <!-- State 2: MainMenuState -->
  <rect x="214" y="178" width="172" height="44" rx="7" fill="var(--gd-purp-bg)" stroke="var(--gd-purp-bor)" stroke-width="0.8"/>
  <rect x="214" y="184" width="3"   height="32" rx="2" fill="var(--gd-purp-acc)"/>
  <text x="300" y="196" font-size="10" font-weight="600" fill="var(--gd-text)"     text-anchor="middle" dominant-baseline="central">MainMenuState</text>
  <text x="300" y="211" font-size="8"               fill="var(--gd-purp-acc)" text-anchor="middle" dominant-baseline="central">Menu UI active</text>

  <!-- State 3: LoadLevelState -->
  <rect x="214" y="253" width="172" height="44" rx="7" fill="var(--gd-crl-bg)" stroke="var(--gd-crl-bor)" stroke-width="0.8"/>
  <rect x="214" y="259" width="3"   height="32" rx="2" fill="var(--gd-crl-acc)"/>
  <text x="300" y="271" font-size="10" font-weight="600" fill="var(--gd-text)"     text-anchor="middle" dominant-baseline="central">LoadLevelState</text>
  <text x="300" y="286" font-size="8"               fill="var(--gd-crl-acc)"  text-anchor="middle" dominant-baseline="central">Setup game world</text>

  <!-- State 4: GameLoopState (active, animated) -->
  <rect class="gsm-gl" x="214" y="325" width="172" height="50" rx="9" fill="var(--gd-teal-bg)" stroke="var(--gd-teal-bor)" stroke-width="1.5"/>
  <rect x="214" y="332" width="3"   height="36" rx="2" fill="var(--gd-teal-acc)"/>
  <text x="300" y="345" font-size="10" font-weight="600" fill="var(--gd-text)" text-anchor="middle" dominant-baseline="central">GameLoopState</text>
  <circle class="gsm-dt" cx="270" cy="362" r="4" fill="var(--gd-teal-hi)"/>
  <text x="278" y="362" font-size="8" fill="var(--gd-teal-hi)" dominant-baseline="central">Running</text>

  <!-- Initial pseudostate -->
  <circle cx="300" cy="14" r="6" fill="var(--gd-teal-acc)"/>
  <line x1="300" y1="20" x2="300" y2="27" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>

  <!-- Legend -->
  <line x1="32" y1="462" x2="66" y2="462" stroke="var(--gd-arr)" stroke-width="1" marker-end="url(#gsm-ah)"/>
  <text x="72" y="462" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Auto</text>
  <line x1="138" y1="462" x2="172" y2="462" stroke="var(--gd-arr)" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#gsm-ah)"/>
  <text x="178" y="462" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Triggered</text>
  <circle cx="258" cy="462" r="4" fill="var(--gd-teal-hi)"/>
  <text x="266" y="462" font-size="8" fill="var(--gd-muted)" dominant-baseline="central">Active state</text>
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
