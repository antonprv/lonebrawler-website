# Система сохранений

## Содержание
- [Обзор](#обзор)
- [GameProgress - модель данных](#gameprogress---модель-данных)
- [SaveLoadService](#saveloadservice)
- [IProgressReader / IProgressWriter](#iprogressreader--iprogresswriter)
- [Live Progress Sync](#live-progress-sync)
- [Сериализуемые коллекции](#сериализуемые-коллекции)
- [Кастомные векторные типы](#кастомные-векторные-типы)

---

## Обзор

Всё изменяемое рантаймовое состояние хранится в одном сериализуемом корневом объекте (`GameProgress`). Сериализация - Newtonsoft Json.NET. Хранилище - `PlayerPrefs` для локальных сохранений и Yandex cloud API при включённых облачных. Каждый компонент с персистентным состоянием реализует `IProgressReader`, `IProgressWriter` или оба. `SaveLoadService` собирает всех writers, зарегистрированных в `GameFactory.ProgressWriters`, и вызывает их за один проход при сохранении.

---

## GameProgress - модель данных

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

### Доменные секции

**`WorldData`** - хранит `TransformOnLevel` (последняя позиция, ротация и имя сцены игрока), `LastTeleportUniqueName` и `LastTeleportTimeUTC`. `IsValid()` возвращает `false` если `TransformOnLevel` ни разу не записывался (начальное состояние сейва) - не даёт спаунить по телепорту до первого движения игрока.

**`PLayerState`** - `MaxHealth` и `CurrentHealth`. Инициализируется из `IPlayerDataSubervice` при новой игре. `IsValid()` возвращает `false` при нулевых значениях (дефолтный конструктор, никогда не заполнялся).

**`PlayerStats`** - `MovementSpeed`, `RotationSpeed`, `Damage`, `Range`, `Radius`, `MaxEnemiesHit`. Это *модифицированные* значения - если у игрока есть активные Constant-баффы, умноженные числа хранятся здесь. Намеренно: восстановление Constant-баффа не должно перемножать уже изменённые статы.

**`EnemiesKilled`** - содержит `HashSetData<string> ClearedSpawners`. Когда все враги из спаунера мертвы, уникальный ID спаунера попадает сюда. При следующей загрузке спаунер читает `ReadProgress` и пропускает спаун если его ID уже в сете.

**`SoulsCollected`** - `Amount` (текущий баланс) и `DictionaryData<string, Vector3> LeftSpawners` (ID спаунеров к позициям для душ, которые дропнулись но ещё не собраны).

**`BuffsRegistry`** - `List<BuffSaveEntry>`, каждая запись хранит `ClassName`, `ActivationType`, `State` и `RemainingDuration`. Детали восстановления - в [Системе баффов](Buff-System-RU).

**`InventorySaveData`** - два `List<InventorySlotData>` (основной инвентарь + хотбар) и `SelectedHotbarIndex`. Каждый `InventorySlotData` хранит `BuffClassName` и `Count`.

### Защитные проверки

У каждой секции есть `IsValid()`. `GameProgress` предоставляет составные проверки:

```csharp
public bool IsWorldDataValid()   => PlayerWorldData != null && PlayerWorldData.IsValid();
public bool IsPlayerStatsValid() => PlayerStats != null && PlayerStats.IsValid();
public bool IsPlayerDataValid()  => PLayerState != null && PLayerState.IsValid();
```

`LoadProgressState` вызывает их чтобы решить: загружать сейв или строить свежий `GameProgress`.

---

## SaveLoadService

`SaveLoadService` координирует сохранение и загрузку. Все зависимости через конструкторную инъекцию.

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

`isInitial` устанавливается в `true` только при старте новой игры. Тогда проход writers полностью пропускается - записать геймплейное состояние предыдущей сессии в свежий `GameProgress` значит испортить новую игру.

Настройки звука (`SystemSettings`) сохраняются всегда, независимо от `isInitial` - настройки громкости не зависят от сессии.

### `LoadProgress()` и `LoadSettings()`

Оба десериализуют из `PlayerPrefs` и возвращают `null` при отсутствии ключа. `LoadProgressState` обрабатывает null и строит дефолтный `GameProgress` когда нужно.

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

Любой компонент с персистентным состоянием реализует один или оба. `GameFactory` регистрирует каждый созданный компонент с этими интерфейсами в списки `ProgressReaders` и `ProgressWriters`.

### Флоу при загрузке уровня

```flow
LoadLevelState |
  GameFactory.CreatePlayer() | регистрирует PlayerHealth, PlayerMove
  GameFactory.CreateEnemySpawners() | регистрирует инстансы EnemyLootSpawner
InformProgressReaders(GameProgress) | вызывает ReadProgress() на каждом IProgressReader
  PlayerHealth | восстанавливает CurrentHealth / MaxHealth
  PlayerMove | восстанавливает MovementSpeed / RotationSpeed
  EnemyLootSpawner | проверяет ClearedSpawners -> пропускает или спаунит
  SoulsTrackerService | восстанавливает количество душ
```

### Флоу при сохранении

```flow
SaveLoadService.SaveProgress() |
  foreach writer in GameFactory.ProgressWriters | writer.WriteToProgress(progress)
  PlayerHealth | записывает CurrentHealth / MaxHealth -> PLayerState
  PlayerMove | записывает MovementSpeed -> PlayerStats
  PlayerHealth | записывает трансформ -> WorldData (через SaveComponent)
```

---

## Live Progress Sync

`LiveProgressSync` - `ZenjexBehaviour`, управляющий автосохранениями во время геймплея.

### Цикл автосохранения

```csharp
private IEnumerator SyncLoop()
{
    var interval = new WaitForSeconds(SyncIntervalSeconds); // 5 секунд
    while (true)
    {
        yield return interval;
        _saveLoad.SaveProgress();
    }
}
```

Цикл стартует в `GameLoopState.Enter()` и останавливается в `GameLoopState.Exit()`. В сцене главного меню не работает - `StartSyncLoop()` проверяет имя активной сцены и выходит досрочно если это меню.

### Сохранение при выгрузке страницы

```csharp
public void OnQuitGame()
{
    _saveLoad?.SaveProgress();
}
```

`OnQuitGame` вызывается Yandex Games SDK (плагин YG) при закрытии или обновлении вкладки браузера. Метод должен быть публичным без параметров - SDK вызывает его по имени через JavaScript interop. Сохранение синхронное, чтобы успеть до выгрузки страницы.

---

## Сериализуемые коллекции

Встроенная сериализация Unity не поддерживает `Dictionary<K,V>` и `HashSet<T>`. Проект предоставляет кастомные замены.

### DictionaryData\<TKey, TValue\>

Расширяет `Dictionary<K,V>` и реализует `ISerializationCallbackReceiver`:

```csharp
[SerializeField] private List<TKey>   keyData   = new();
[SerializeField] private List<TValue> valueData = new();

public void OnBeforeSerialize()  => SynchronizeListsWithDictionary();
public void OnAfterDeserialize() => RebuildDictionaryFromSerializedData();
```

`RebuildDictionaryFromSerializedData` использует `Mathf.Min(keyData.Count, valueData.Count)` для защиты от несовпадения длин списков (может возникнуть после Undo в Editor) и пропускает null или дефолтные ключи. `ForceSerialization()` - для редакторного кода, который вручную изменил словарь и хочет немедленной синхронизации списков.

### HashSetData\<T\>

Та же схема `ISerializationCallbackReceiver`. Backing `List<T>` дедуплицируется при `OnAfterDeserialize`, сохраняя семантику сета даже если сериализованные данные содержат дубликаты.

Оба типа поставляются с кастомными `PropertyDrawer` - в инспекторе выглядят как стандартные Unity list-поля.

---

## Кастомные векторные типы

`Vector3`, `Quaternion` и `Transform` от Unity не сериализуются в JSON по умолчанию. Проект определяет сериализуемые аналоги:

| Кастомный тип | Unity-аналог | Примечания |
|---|---|---|
| `Vector3Data` | `Vector3` | Поля `x`, `y`, `z`; расширения `ToVector3()` / `ToVector3Data()` |
| `QuatData` | `Quaternion` | `x`, `y`, `z`, `w`; `QuatComplex` для slerp-математики |
| `TransformData` | позиция + ротация + масштаб | Используется в `PlayerWorldData` |
| `Coordinates` | позиция + ротация (без масштаба) | Позиции точек спауна в `LevelStaticData` |

У всех четырёх типов есть `PropertyDrawer`, совпадающий по виду с нативными Unity-полями в инспекторе. `UnityConversionExtensions` предоставляет конвертацию: `ToTransformData()`, `ToCoordinates()`, `ApplyTo()` и другие.

<!-- 📸 Скриншот: данные PlayerPrefs в dev tools браузера, JSON-структура -->
