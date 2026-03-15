# UI и фронтенд

## Содержание
- [Оконная система](#оконная-система)
- [Dev Console - MVVM](#dev-console---mvvm)
- [HUD](#hud)
- [Шкалы здоровья и попапы урона](#шкалы-здоровья-и-попапы-урона)
- [Экран загрузки](#экран-загрузки)
- [Адаптеры платформы](#адаптеры-платформы)

---

## Оконная система

### WindowService

`WindowService` (реализующий `IWindowService`) - единственная точка входа для открытия UI-окон. Берёт `IUIFactory` через конструкторную инъекцию и отдаёт всю работу по созданию ей.

```csharp
public void Open(WindowTypeId typeId, Button openButton)
{
    switch (typeId)
    {
        case WindowTypeId.Shop:
            _uiFactory.CreateWindow(typeId, openButton, ConstructorContext.FromButton).Forget();
            break;
        case WindowTypeId.Inventory:
            _uiFactory.CreateWindow(typeId, openButton, ConstructorContext.FromButton).Forget();
            break;
        // ...
    }
}
```

### UIFactory и Addressables

`IUIFactory` создаёт окна, загружая их префабы по требованию через Addressables. Префабы маппируются в `WindowsManifest` - ScriptableObject-реестре, связывающем значения `WindowTypeId` с записями `AssetReference`. Префаб окна не в памяти до вызова `Open()` для него.

`ConstructorContext.FromButton` передаёт `RectTransform` открывающей кнопки в фабрику - окна могут анимироваться из позиции кнопки при необходимости.

### WindowBase

`WindowBase` - абстрактный базовый класс для всех окон. Имеет `Open()` и `Close()` с LeanTween-анимациями масштаба/прозрачности и `DestroyOnClose()` для освобождения Addressables-хэндла при закрытии.

Поддерживаемые типы: `Shop`, `Inventory`, `MainMenu`, `Credits`.

<!-- 📸 Скриншот: открытое окно инвентаря или магазина в игре -->

---

## Dev Console - MVVM

Консоль разработчика - самый слоёный UI-компонент проекта. Строго следует MVVM-разделению на четыре слоя.

### Слой Model

**`ConsoleState`** - владеет списком сообщений (`List<string>`) и строкой активного фильтра. Имеет `AddMessage`, `ClearMessages`, `SetFilter` и `IReadOnlyList<string> FilteredMessages`. Фильтрация применяется лениво при чтении, не при записи.

**`CommandHistory`** - кольцевой буфер ранее выполненных команд. `NavigateUp()` и `NavigateDown()` ходят по истории; `Push(string)` добавляет запись. Последовательные дубликаты дедуплицируются.

**`MobileKeyboard`** - платформенная абстракция над `TouchScreenKeyboard`. На десктопе - no-op; на мобильных управляет открытием/закрытием клавиатуры.

### Слой ViewModel

**`ConsoleViewModel`** координирует мутации модели и предоставляет состояние View:

```csharp
public IReadOnlyList<string> Messages => _state.FilteredMessages;
public string InputText { get; private set; }
public bool IsVisible { get; private set; }

public void Submit()
public void ToggleVisibility()
public void NavigateHistory(bool up)
```

ViewModel не имеет Unity UI-ссылок - чистый C#, полностью unit-тестируемый без сцены.

### Слой View

**`ConsoleRenderer`** - рендерит весь UI консоли через IMGUI (`GUILayout`): заголовок, скроллируемая область сообщений, поле ввода. Позиция скролла управляется `ScrollDragHandler`, перехватывающим тач-drag на мобильных и переводящим в `Vector2`-дельты для `GUILayout.BeginScrollView`.

**`ConsoleStyles`** - кешируёт все `GUIStyle`-инстансы. Создание стилей дорого; кеширование убирает аллокацию из каждого кадра `OnGUI`.

**`PlatformService`** - предоставляет `IsMobile` и `GetConsoleRootRect()`. На мобильных прямоугольник консоли смещается вверх чтобы не перекрываться с экранной клавиатурой. На десктопе занимает верхние 40% экрана.

### Слой Controller

**`DevConsoleController`** - `ZenjexBehaviour` `MonoBehaviour`, связывающий ViewModel с View. Вызывает `ConsoleRenderer.Render()` из `OnGUI()`, пробрасывает события Unity Input во ViewModel и управляет жизненным циклом `MobileKeyboard`.

**`ConsoleButtonController`** - отдельный `MonoBehaviour` на кнопке мобильного переключения. Нажатие вызывает `ViewModel.ToggleVisibility()`.

### Доступные команды

| Команда | Использование | Эффект |
|---|---|---|
| `clear` | `clear` | Очищает список сообщений |
| `help` | `help` | Список всех зарегистрированных команд |
| `filter` | `filter <text>` | Фильтрует видимые сообщения |
| `toggle_unity_logs` | `toggle_unity_logs` | Включает/выключает пробрасывание Unity Debug.Log |
| `export_logs` | `export_logs` | Экспортирует историю логов в файл |
| `log_stats` | `log_stats` | Выводит текущий FPS, потребление памяти |
| `set_fps` | `set_fps <value>` | Устанавливает `Application.targetFrameRate` |
| `stat_fps` | `stat_fps` | Переключает on-screen FPS-счётчик |
| `add_souls` | `add_souls <amount>` | Добавляет души к балансу |
| `load_level` | `load_level <levelName>` | Сохраняет и загружает указанный уровень |
| `quit_to_menu` | `quit_to_menu` | Возврат в главное меню |
| `pause_game` | `pause_game` | Переключает `Time.timeScale` между 0 и 1 |
| `reset_game` | `reset_game` | Удаляет все сохранения и перезапускает |
| `warp_player` | `warp_player <x> <y> <z>` | Телепортирует игрока в мировые координаты |

<!-- 📸 Скриншот: дев-консоль открыта в игре с выводом команд -->

---

## HUD

`HudView` - `ZenjexBehaviour`, управляющий игровым HUD. В `OnAwake()` подписывается на `ISoulsTrackerService.SoulsRP` и реактивно обновляет счётчик.

HUD подписывается на здоровье игрока через `IHealth.HealthRP` и управляет заполнением шкалы здоровья. Каждое обновление push-based - без поллинга.

<!-- 📸 Скриншот: HUD в игре с шкалой здоровья, счётчиком душ и хотбаром -->

---

## Шкалы здоровья и попапы урона

### HealthBar

`HealthBar` - UI-элемент в мировом пространстве. `LookAtCamera` поворачивает полосу к главной камере. Изменения здоровья управляют `Image.fillAmount` через подписку на `IHealth.HealthRP`.

Шкалы здоровья врагов видны только когда враг получил урон или в бою - угасают при полном здоровье. Анимацию угасания ведёт `LeanTween`.

### TextPopup

`TextPopup` спаунит плавающий текст над персонажем при уроне, лечении или сборе душ. Текст движется вверх и угасает через `LeanTween`, затем `GameObject` возвращается в пул. Размер и цвет - per-тип: урон красный, лечение зелёное, души жёлтые.

<!-- 📸 Скриншот: шкала здоровья врага и плавающие числа урона в бою -->

---

## Экран загрузки

`LoadingCurtain` (реализующий `ILoadScreen`) - полноэкранное перекрытие при переходах между сценами. `Show()` и `Hide()` запускают LeanTween alpha-твины на `CanvasGroup`. `Show()` блокирует ввод пока шторка видима.

Создаётся в `InstallerFactory.CreateLoadingScreenRoutine()` и помечается `DontDestroyOnLoad` - живёт всю сессию.

<!-- 📸 Скриншот: шторка загрузки при переходе между сценами -->

---

## Адаптеры платформы

### HideButtonsOnPC

Проверяет `Application.isMobilePlatform` в `Awake()` и отключает mobile-only `GameObject`-ы (виртуальный джойстик, тач-кнопки) на десктопных сборках. Один вызов `Awake()`, Update-цикла нет.

### CloudSaveSystemButton

Кнопка, инициирующая ручной push облачного сохранения по нажатию. Отключает себя на время асинхронного push - двойные нажатия невозможны. Включается по завершению или ошибке.
