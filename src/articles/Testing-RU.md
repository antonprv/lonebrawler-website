# Тестирование

## Содержание
- [Обзор](#обзор)
- [Тестовая инфраструктура - ZenjexTestBootstrap](#тестовая-инфраструктура---zenjextestbootstrap)
- [Edit Mode тесты](#edit-mode-тесты)
- [Play Mode тесты](#play-mode-тесты)
- [Перфоманс-тесты](#перфоманс-тесты)
- [Соглашения по тестированию](#соглашения-по-тестированию)

---

## Обзор

В проекте **53 тестовых файла** в двух сборках: `Code.Tests.EditMode` и `Code.Tests.PlayMode`.

| Сборка | Фреймворк | Фокус |
|---|---|---|
| EditMode | NUnit + NSubstitute | Чистая C#-логика, модели данных, сервисы |
| PlayMode | NUnit + NSubstitute + Unity Test Framework | Жизненный цикл MonoBehaviour, физика, интеграционные цепочки |
| Performance | Unity Performance Testing Package | Тайминги горячих путей, стабильность кадра |

---

## Тестовая инфраструктура - ZenjexTestBootstrap

Все PlayMode-тесты с `ZenjexBehaviour`-компонентами требуют минимального DI-контейнера до первого вызова `Awake()`. `ZenjexTestBootstrap` решает это без лишних усилий.

### Инициализация контейнера

```csharp
[UnitySetUp]
public IEnumerator SetUp()
{
    yield return ZenjexTestBootstrap.Initialize();
    // Контейнер активен - можно добавлять ZenjexBehaviour-компоненты
}
```

`Initialize()` создаёт `GameObject` с компонентом `TestRootInstaller` и уступает один кадр. Unity вызывает `Awake()` на `TestRootInstaller`, тот строит контейнер и заполняет `ProjectRootInstaller.RootContainer`. Поскольку `TestRootInstaller` работает с `ExecutionOrder -280`, контейнер готов до любого `ZenjexBehaviour.Awake()` в тестовой сцене.

### Что регистрирует тестовый контейнер

```csharp
builder.RegisterValue(Substitute.For<ITimeService>(), ...);
builder.RegisterValue(Substitute.For<IInputService>(), ...);
builder.RegisterValue(Substitute.For<IPlayerDataSubervice>(), ...);
builder.RegisterValue(Substitute.For<IGameConfigSubservice>(), ...);
builder.RegisterValue(Substitute.For<IGameLog>(), ...);
builder.RegisterValue(Substitute.For<IAssetLoader>(), ...);
```

Все зависимости - NSubstitute-моки. Если у компонента есть `[Zenjex]`-поле, не покрытое здесь, `ZenjexInjector` логирует ошибку, но не бросает - тесты не сламываются молчаливо.

### Teardown

```csharp
[TearDown]
public void TearDown()
{
    Object.Destroy(_testGameObject);
    ZenjexTestBootstrap.Cleanup();
}
```

`Cleanup()` через рефлексию обнуляет статическое `ProjectRootInstaller.RootContainer` (приватный setter), затем уничтожает installer-`GameObject`. Без этого статическое состояние утекает в следующий тестовый класс.

### Хелпер CreatePlayerGameObject

`PlayerHealth` и `PlayerDeath` имеют атрибуты `[RequireComponent]`, автоматически добавляющие `PlayerAnimator` и `PlayerMove`. Без хелпера Unity добавит эти компоненты при `AddComponent<PlayerDeath>()` и они начнут тикать немедленно - до того как `ZenjexInjector` заполнит `ITimeService` и `IInputService`, вызывая каскад `NullReferenceException`.

`CreatePlayerGameObject()` добавляет `CharacterController`, стаб `Animator`, `PlayerAnimator` и `PlayerMove` в правильном порядке, затем **отключает** последние два - их `Update()` не работает во время тестов.

---

## Edit Mode тесты

### SaveData

**`GameProgressTests`** - свежий `GameProgress` проходит `IsValid()`, все секции не-null, дефолтно-сконструированный прогресс проваливает валидацию.

**`PLayerStateTests`** и **`PlayerStatsTests`** - значения статов совпадают с данными мок-`IPlayerDataSubervice`, `IsValid()` возвращает false при нулевом критическом значении.

**`BuffsRegistryTests`** и **`BuffSaveEntryTests`** - сериализация снапшотов баффов с `RemainingDuration` и `BuffState`, плюс edge-case-файлы для null-реестров и нулевых списков.

**`EnemiesKilledTests`** - `HashSetData<string>` инициализируется корректно, ID спаунеров добавляются и запрашиваются.

**`SoulsCollectedTests`** - отслеживание количества, `LeftSpawners` `DictionaryData` стартует пустым.

**`WorldDataTests`** и **`TransformOnLevelTests`** - целостность позиции/ротации, логика защиты `IsValid()` для `_initialSave`.

### Инвентарь

**`InventorySaveDataTests`** - количество слотов после `InitializeSlots`, все дефолтно пусты, повторный вызов `InitializeSlots` перезаписывает чисто.

**`InventorySlotDataTests`** - дефолты конструктора, логика `IsEmpty`, поведение `Set()` и `Clear()`.

**`InventoryServiceTests`** - добавление, удаление, выбор слота, edge cases (полный инвентарь, стакинг одинаковых предметов).

### Кастомные коллекции

**`DictionaryDataTests`** - round-trip сериализации, обработка null-ключей, отклонение дубликатов, поведение `ForceSerialization()`.

**`HashSetDataTests`** - та же схема для `HashSetData<T>`.

**`PairDataTests`** - равенство и сериализация `PairData<TKey, TValue>`.

### Кастомные типы

**`Vector3DataTests`**, **`QuatDataTests`**, **`TransformDataTests`** - JSON round-trip, конвертация в/из Unity-типов, edge cases (нулевые векторы, единичный кватернион).

### FastMath

**`FMathTests`** - `FastSqrt`, `FastInvSqrt` (включая точный режим с двойной итерацией), `Clamp`, `FastNormalize`, `FastLength`, `FastDistance`, `DistanceSquared`. Float-сравнения с допуском `0.01f`. Один тест явно проверяет, что точный режим (`prescise: true`) точнее одиночной итерации.

**`FastMathExtensionsTests`** - методы расширения на `Vector3` и `float3`.

### DevConsole

**`ConsoleStateTests`** - управление списком сообщений, применение фильтра, поведение `Clear()`.

**`CommandHistoryTests`** - навигация по истории вверх/вниз, wrap-around на границах, защита от пустой истории.

**`DevConsoleServiceTests`** - `Execute()` диспатчит в правильный `IConsoleCommand`; неизвестные команды дают сообщение об ошибке.

Per-command тесты (`ClearCommandTests`, `FilterLogsCommandTests`, `HelpCommandTests`, `LogStatsCommandTests`, `SetFPSCommandTests`, `ToggleUnityLogsCommandTests`) - валидация аргументов, содержимое выходных сообщений, побочные эффекты на моках.

### Сервисы

**`BuffTrackerServiceTests`** - `AddBuff`, `RemoveBuff`, `GetPlayerBuffs`, `WriteToProgress` (корректность снапшота, Disabled исключаются), `ReadProgress` (маршрутизация по `ActivationType`), `Cleanup`.

**`DragDropServiceTests`** - регистрация источника/цели, логика переноса, отклонение невалидного переноса.

**`LootTrackerServiceTests`** - реактивные обновления счётчика, round-trip `WriteToProgress` / `ReadProgress`.

**`PersistentProgressServiceTests`** - `Progress` и `SystemSettings` хранятся и извлекаются корректно, `ProgressKey` и `SystemSettingsKey` различаются.

### Расширения

**`ArrayExtensionsTests`** и **`FunctionalExtensionsTests`** - цепочки `With<T>`, условный `With`, `Empty<T>` на массивах ссылочных типов.

---

## Play Mode тесты

### Smoke

**`MonoBehaviourSmokeTests`** - каждый критический `MonoBehaviour` подключается без броска исключения: `PlayerHealth`, `PlayerDeath`, `EnemyHealth`, `EnemyDeath`, `SaveComponent`, `TriggerObserver`, `UniqueId`, `AsyncStartMonoBehaviour`. Составной тест добавляет все сразу на один `GameObject` внутри одного `Assert.DoesNotThrow`.

Тест `AsyncStartMonoBehaviour` проверяет, что `IsInitialized` по умолчанию `false` - компонент не должен самоинициализироваться.

### Интеграция - Враги

**`AggroTests`** - реальный `Aggro` с зоной `TriggerObserver` и мок-`IMovableAgent`. Тесты: агент останавливается после `ManualStart()`; игрок входит в триггер - вызывается `ContinueFollowing()`; выходит - `StopFollowingImmediately()` не вызывается немедленно (соблюдается `followDelay`); после ожидания дольше `followDelay` - вызывается; `Deactivate()` / `Activate()` переключают `enabled`; уничтожение объекта не бросает исключений.

**`EnemyHealthTests`** - `TakeDamage` снижает `CurrentHealth` (зажим на нуле); `Heal` поднимает (зажим на `MaxHealth`); observable `IsDead` срабатывает при нуле.

**`EnemyDeathIntegrationTests`** - `EnemyHealth` и `EnemyDeath` на одном `GameObject`. Полный цикл: полное здоровье при старте, анимация смерти при нуле, `DisappearDelay` соблюдается до уничтожения `GameObject`.

### Интеграция - Игрок

**`PlayerHealthTests`** - зеркало `EnemyHealthTests` для стороны игрока, включая сохранение/восстановление через `ReadProgress` / `WriteToProgress`.

**`PlayerDeathTests`** - здоровье нуль, анимация смерти, `GameStateMachine.EnterState<MainMenuState>()` вызывается после задержки смерти.

### Инфраструктура

**`SaveComponentTests`** - `SaveComponent` вызывает `ISaveLoadService.SaveProgress()` при триггере `Save()`.

**`TriggerObserverTests`** - observables `OnTriggerEntered` и `OnTriggerExited` срабатывают на входе/выходе коллайдера.

**`AsyncStartMonoBehaviourTests`** - `IsInitialized` переходит в `true` после завершения `StartAsync()`.

---

## Перфоманс-тесты

Все перфоманс-тесты через **Unity Performance Testing Package** (`Measure.Method` и `Measure.Frames`).

### `PlayerHealth_TakeDamage_PerformanceUnder1ms`

```
Warmup:       5 запусков
Измерений:    20
Итераций:     1 на измерение (каждая вызывает TakeDamage 100 раз)
```

Здоровье игрока - 1 000 000; каждый вызов вычитает 0.001, игрок не умирает - измеряется чистая стоимость метода без коллбэков цепочки смерти.

### `EnemyHealth_TakeDamage_PerformanceUnder1ms`

Та же структура, применённая к `EnemyHealth` с `MaxHealth = 1 000 000`.

### `GameObject_CreateAndDestroy_WithComponents_Under5ms`

```
Warmup:    3 запуска
Измерений: 10
```

Создаёт GameObject игрока со всеми компонентами через `CreatePlayerGameObject()`, затем `DestroyImmediate`. Измеряет накладные расходы полного пайплайна регистрации компонентов и инъекции.

### `FrameTime_WithActivePlayerHealth_IsStable`

```
Warmup:    5 кадров
Измерений: 20 кадров
```

`Measure.Frames()` сэмплирует frametime с тикающим `PlayerHealth`. Дисперсия должна укладываться в дефолтные допуски Unity Performance Testing Package.

---

## Соглашения по тестированию

- **Arrange-Act-Assert** - все тесты следуют этой схеме; структура читается из пустых строк, комментарии не нужны.
- **Изоляция фикстур** - каждый тестовый класс создаёт объекты в `[SetUp]` / `[UnitySetUp]` и уничтожает в `[TearDown]` / `[UnityTearDown]`. Общего состояния между тестами нет.
- **Стратегия моков** - NSubstitute для интерфейсных моков. Дешёвые конкретные зависимости (ScriptableObjects, чистые data-классы) инстанцируются напрямую.
- **Допуск** - float-сравнения через `Is.EqualTo(x).Within(tolerance)`. FastMath-тесты - `0.01f`.
- **Контракт `ZenjexTestBootstrap`** - каждый PlayMode-тест с `ZenjexBehaviour` обязан вызвать `Initialize()` в setup и `Cleanup()` в teardown. Без `Cleanup()` - утечка статического состояния.

<!-- 📸 Скриншот: Unity Test Runner с зелёными результатами всех тестов -->
