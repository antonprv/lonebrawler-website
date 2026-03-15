# Редакторный инструментарий

## Содержание
- [Scene Switcher Overlay](#scene-switcher-overlay)
- [Quick Look](#quick-look)
- [Level Static Data Editor](#level-static-data-editor)
- [Scene Data Selector](#scene-data-selector)
- [Манифесты и типизированные дропдауны](#манифесты-и-типизированные-дропдауны)
- [Кастомные редакторы Static Data](#кастомные-редакторы-static-data)
- [Конфигурация сборки](#конфигурация-сборки)
- [Документация соглашений по именованию](#документация-соглашений-по-именованию)
- [Manual Save Editor](#manual-save-editor)

---

## Scene Switcher Overlay

`SceneSwitcherOverlay` регистрируется в тулбаре Unity SceneView через `[Overlay(typeof(SceneView), "Scene Switcher", true)]`. Содержит один элемент `SceneSwitcherDropdown`.

Дропдаун читает все сцены из `EditorBuildSettings.scenes`, показывает их как всплывающее меню и открывает выбранную через `EditorSceneManager.OpenScene()`. Никакого меню File, Build Settings и Project-окна - один клик из любого места в SceneView.

<!-- 📸 Скриншот: дропдаун Scene Switcher в тулбаре SceneView -->

---

## Quick Look

`QuickLook` - стыкуемый `EditorWindow` через **Window -> Quick Look**. Хранит шортлист часто используемых префабов и ScriptableObjects.

### Добавление ассетов

Два способа:
- **Drag & drop** прямо в окно - `HandleDragAndDrop()` принимает `GameObject` и `ScriptableObject`.
- **Object Picker** - нажатие "Add New" открывает `EditorGUIUtility.ShowObjectPicker<GameObject>()`, выбранный объект добавляется при закрытии пикера.

Дубликаты молчаливо отклоняются через `_prefabs.Contains(obj)`.

### Персистентное хранилище

Список сохраняется в ScriptableObject `QuickLookStaticData` по пути `Resources/Editor/QuickLook/QuickLookStaticData`. "Save File" вызывает `EditorUtility.SetDirty` + `AssetDatabase.SaveAssets()`. "Load File" читает из того же ассета. Список переживает перезапуск редактора - это ассет проекта, не EditorPrefs.

### Адаптивная сетка

Сетка кнопок рефлоится при изменении размера окна:

```csharp
private int CalculateColumnsCountBasedOnWindowWidth()
{
    float availableWidth = position.width - (WindowEdgePadding * 2) - scrollbarWidth;
    for (int columns = MaxColumns; columns >= 1; columns--)
    {
        float widthPerButton = (availableWidth - (columns - 1) * SpacingBetweenButtons) / columns;
        if (widthPerButton >= MinButtonWidth)
            return columns;
    }
    return 1;
}
```

До `MaxColumns = 5`, никогда не уже `MinButtonWidth = 60f` на кнопку.

<!-- 📸 Скриншот: окно Quick Look, пристыкованное в редакторе, с сеткой ярлыков -->

---

## Level Static Data Editor

`LevelStaticDataEditor` - `CustomEditor` для ScriptableObject `LevelStaticData`. Заменяет стандартный инспектор структурированным видом без ручного ввода данных.

### Scene picker

Вместо сырого строкового поля `LevelKey` - дропдаун из `InspectorUtils.GetAllScenes()`, читающего `EditorBuildSettings.scenes`. Выбор сцены пишет строку с именем - никаких опечаток и устаревших имён.

### Collect All Data

Кнопка "Collect all data" последовательно запускает три метода:

**`CollectSpawners()`** - находит все `EnemySpawnMarker` в открытой сцене через `FindObjectsByType`. Для каждого маркера читает `UniqueId`, позицию, `EnemyTypeId` и количество, пишет `EnemySpawnerData` в список `EnemySpawners` ScriptableObject.

**`CollectTeleports()`** - находит все `TeleportMarker`, читает `UniqueName`, целевой уровень, размер/позицию коллайдера, пишет `LevelTeleportData`.

**`CollectPlayerStart()`** - находит первый `GameObject` с тегом старта и пишет его `Coordinates` в `PlayerStartCoordinates`.

После каждого сбора вызываются `EditorUtility.SetDirty(target)` и `AssetDatabase.SaveAssets()`. Изменения сразу видны в системе контроля версий.

<!-- 📸 Скриншот: инспектор LevelStaticData с кнопками Collect и заполненным списком спаунеров -->

---

## Scene Data Selector

`SceneDataSelectorButton` - кнопка в тулбаре SceneView (через `[Overlay]`), отправляющая инспектор прямо к ассету `LevelStaticData` для открытой сцены.

По нажатию вызывает `StaticDataService.ForLevel(SceneManager.GetActiveScene().name)` и передаёт результат в `Selection.activeObject`. Инспектор сразу показывает нужный ScriptableObject. Маппинг сцены к ScriptableObject - через `LevelsManifest`.

<!-- 📸 Скриншот: кнопка Scene Data Selector в тулбаре и LevelStaticData в инспекторе -->

---

## Манифесты и типизированные дропдауны

### ManifestEditorBase

`ManifestEditorBase` - переиспользуемый базовый класс `CustomEditor` для всех манифест-ScriptableObjects. Рендерит каждую запись как пару ключ-значение, где ключ использует кастомный drawer.

Два key-drawer:

**`SceneDropdownKeyDrawer`** - заменяет строковое ключевое поле дропдауном из всех сцен Build Settings. Невалидные имена сцен не попадут.

**`EnumDropdownKeyDrawer`** - заменяет int/string-ключ типизированным enum-дропдауном. Значения вне диапазона не попадут.

### Типы манифестов

| Манифест | Тип ключа | Тип значения | Использование |
|---|---|---|---|
| `LevelsManifest` | имя сцены | `AssetReference<LevelStaticData>` | Маппит сцены к StaticData |
| `EnemyManifest` | enum `EnemyTypeId` | `AssetReference<EnemyStaticData>` | Конфиги врагов при спауне |
| `BuffsManifest` | enum `BuffClassName` | `AssetReference<BuffStaticData>` | Конфиги баффов в BuffFactory |
| `WindowsManifest` | enum `WindowTypeId` | `AssetReference<GameObject>` | Типы окон к адресам префабов |
| `LevelMusicManifest` | имя сцены | `AssetReference<MusicPlaylist>` | Сцены к музыкальным плейлистам |

Все манифесты загружаются `StaticDataService` при старте. Содержимое раздаётся через типизированные интерфейсы субсервисов (`IEnemyDataSubservice`, `IBuffDataSubservice` и т.д.).

<!-- 📸 Скриншот: инспектор BuffsManifest с enum-дропдаун ключами -->

---

## Кастомные редакторы Static Data

Большинство `StaticData` ScriptableObjects имеют `CustomEditor`, наследующий `ManualSaveEditor`:

- Рендерит стандартный инспектор через `DrawDefaultInspectorWithManualSave()`
- Добавляет явную кнопку "Save" с вызовом `EditorUtility.SetDirty` + `AssetDatabase.SaveAssets()`
- Без автосохранения при каждом изменении поля - коммит когда разработчик готов

**`EnemyStaticDataEditor`** добавляет превью атаки: `Handles.DrawWireDisc`-гизмо в SceneView показывает радиус ближнего боя/снаряда при выборе ассета.

**`BuffStaticDataEditor`** рендерит `BuffParameters` как именованную таблицу ключ-значение с валидацией - предупреждает при пустом имени параметра или нулевом float-значении.

**`AttackPresetStaticDataEditor`** показывает радиус, дальность и `MaxEnemiesHit` как числовые метки, с кнопкой "Test in Scene" для временной сферы визуализации.

---

## Конфигурация сборки

`GameBuildDataEditor` - `CustomEditor` для `GameBuildData`:

- `DebugConfiguration` и `TargetPlatform` - дропдауны, отфильтрованные `FilteredEnumAttribute` (сентинел `None` не отображается).
- `UseCloudSave` и `UseAddSdk` - чётко подписанные переключатели с help-текстом.
- Кнопка "Apply to Player Settings" синхронизирует `TargetPlatform` с Unity `BuildTarget` и выставляет `Development Build` в `BuildOptions` под `DebugConfiguration`.

<!-- 📸 Скриншот: инспектор GameBuildData с полным редакторным UI -->

---

## Документация соглашений по именованию

`NamingConvention` - ScriptableObject (`CreateAssetMenu`), хранящий гайд как rich-text строку `TextArea`. Доступен через **Assets -> Create -> Documentation -> Naming Convention**.

В инспекторе гайд рендерится в прокручиваемом `TextArea` с жирными заголовками и курсивными примечаниями. Документирует:

- Префиксы префабов: `P_`, `P_V_`, `PA_`, `PAV_`, `PP_`, `PAI_`, `PUI_`
- Суффиксы UI-элементов: `_CNT`, `_BTN`, `_BG`, `_TXT`, `_IMG`

`NamingConventionEditor` добавляет подсветку синтаксиса - сканирует текст на известные префиксы и рендерит их отдельным цветом, упрощая беглое чтение.

---

## Manual Save Editor

`ManualSaveEditor` - базовый класс, от которого наследуют большинство редакторов Static Data. Добавляет кнопку "Save Asset" в нижнюю часть любого инспектора:

```csharp
protected void DrawDefaultInspectorWithManualSave()
{
    DrawDefaultInspector();
    if (GUILayout.Button("Save Asset"))
    {
        EditorUtility.SetDirty(target);
        AssetDatabase.SaveAssets();
    }
}
```

Без этого изменения полей ScriptableObject попадают на диск только при автосохранении Unity. Явная кнопка даёт контроль над моментом коммита - важно когда несколько человек редактируют ассеты параллельно в системе контроля версий.
