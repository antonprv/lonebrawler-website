# Инвентарь и хотбар

## Содержание
- [Модель данных](#модель-данных)
- [InventoryService](#inventoryservice)
- [InventorySlotView - drag & drop ячейка](#inventoryslotview---drag--drop-ячейка)
- [Сервисы drag & drop](#сервисы-drag--drop)
- [HotbarView](#hotbarview)
- [Система тултипов](#система-тултипов)
- [Сохранение и восстановление](#сохранение-и-восстановление)

---

## Модель данных

Персистентное состояние инвентаря хранится в `InventorySaveData`, поле `GameProgress`:

```csharp
[Serializable]
public class InventorySaveData
{
    public List<InventorySlotData> InventorySlots;
    public List<InventorySlotData> HotbarSlots;
    public int SelectedHotbarIndex;
}

[Serializable]
public class InventorySlotData
{
    public BuffClassName BuffClass;
    public int Count;
    public bool IsEmpty => BuffClass == BuffClassName.None || Count <= 0;
}
```

Размеры слотов берутся из `InventorySystemConfig` в рантайме (текущие: `InventorySize = 44`, `HotbarSize = 3`). `InitializeSlots()` предзаполняет оба списка пустыми `InventorySlotData` - списки всегда нужной длины, нулевые слоты в рантайме не проверяются.

---

## InventoryService

`InventoryService` (реализующий `IInventoryService`) - рантаймовый владелец состояния инвентаря. Хранит массивы слотов в памяти и предоставляет реактивный API для подписки UI.

### Реактивные события

```csharp
Observable<int>  OnInventorySlotChanged   // срабатывает с slotIndex при изменении слота
Observable<int>  OnHotbarSlotChanged      // срабатывает с slotIndex при изменении слота хотбара
Observable<Unit> OnHotbarSelectionChanged // срабатывает при изменении SelectedHotbarIndex
```

UI-компоненты подписываются, а не опрашивают. При вызове `InventoryService.SetSlot()` обновляются данные в памяти и emitится событие - соответствующий `InventorySlotView` вызывает `RefreshViewAsync()` в коллбэке подписки.

### Основные операции

```csharp
bool TryAddItem(BuffClassName buffClass, int count)  // false если инвентарь полон
void RemoveItem(int slotIndex, int count)
void MoveItem(int fromIndex, int toIndex, DragSource source)
void SelectHotbarSlot(int index)
InventorySaveData GetSaveData()  // снапшот для SaveLoadService
```

`TryAddItem` сначала ищет слот с тем же `BuffClassName` и стакает поверх. Если не нашёл - занимает первый пустой. Если оба варианта не сработали - возвращает `false`.

`MoveItem` обрабатывает все комбинации: инвентарь-инвентарь, хотбар-хотбар, инвентарь-хотбар, хотбар-инвентарь. Обмен с непустым целевым слотом поддерживается - предметы меняются местами, а не дропаются.

---

## InventorySlotView - drag & drop ячейка

`InventorySlotView` - `ZenjexBehaviour`, выступающий одновременно визуальной ячейкой и drag-and-drop обработчиком. Реализует полную цепочку drag Unity EventSystem:

```csharp
IBeginDragHandler  // подбирает предмет, показывает иконку drag, скрывает локальную
IDragHandler       // перемещает иконку к курсору/пальцу
IEndDragHandler    // очищает состояние drag если дроп не завершился
IDropHandler       // получает дропнутый предмет, вызывает MoveItem
IPointerEnterHandler // показывает тултип
IPointerExitHandler  // скрывает тултип
IPointerClickHandler // клик для использования (активация хотбара)
```

### Асинхронная загрузка иконки

```csharp
public async UniTask RefreshViewAsync()
{
    var slot = GetSlotData();
    if (slot == null || slot.IsEmpty) { SetEmpty(); return; }

    var buffData = await _buffDataService.ForBuffAsync(slot.BuffClass);
    icon.sprite = await _assetLoader.LoadAsync<Sprite>(buffData.Icon);
    countText.text = slot.Count > 1 ? slot.Count.ToString() : "";
}
```

Иконки - `AssetReference`-поля в `BuffStaticData`, загружаются через Addressables по требованию. Спрайт загружается только когда слот реально содержит предмет - потребление памяти следует за содержимым инвентаря, а не за общим числом предметов.

### Цветовая анимация выбора

`SetSelected()` вызывает `SwitchColor(background, selectedColor)`, запускающий LeanTween-твин цвета фоновой `Image` со скоростью `colorSwitchSpeed`. Переход плавный - даёт видимую обратную связь при нажатии клавиш хотбара.

---

## Сервисы drag & drop

### DragDropService

Хранит текущее состояние drag: какой слот является источником, какой предмет перетаскивается, enum `DragSource` (Inventory или Hotbar). Когда `IDropHandler.OnDrop` срабатывает на целевом слоте, вызывает `InventoryService.MoveItem` с индексом источника, индексом цели и типом источника.

### DragIconProvider

Управляет плавающим `GameObject`-иконкой, следующим за курсором. При `IBeginDragHandler` иконка включается и позиционируется в курсоре. При `IDragHandler` следит за указателем каждый кадр. При `IEndDragHandler` или успешном `IDropHandler` скрывается.

Спрайт иконки drag совпадает с иконкой перетаскиваемого слота. На мобильных следует за тачем, на ПК - за мышью.

<!-- 📸 Скриншот: инвентарь с предметом, перетаскиваемым между слотами -->

---

## HotbarView

`HotbarView` отображает полосу хотбара внизу экрана. Создаёт виды слотов через `IInventoryFactory.CreateHotbarElementAsync()` и подписывается на события `InventoryService`:

```csharp
_inventoryService.OnHotbarSlotChanged
    .Subscribe(OnSlotChanged)
    .AddTo(_disposables);

_inventoryService.OnHotbarSelectionChanged
    .Subscribe(_ => UpdateSelection())
    .AddTo(_disposables);
```

`HandleHotbarInput()` работает в `Update()` и читает `IInputService.ActiveHotbar` - `KeyValuePair<int, bool>`, где ключ - индекс слота, значение - была ли нажата клавиша этого слота в текущем кадре. При нажатии вызывается `InventoryService.SelectHotbarSlot(index)`, что через `PlayerBuffConsumer` запускает `TryUseBuff`.

<!-- 📸 Скриншот: хотбар внизу экрана с иконками баффов -->

---

## Система тултипов

`ITooltipProvider` инжектируется в `InventorySlotView`. При наведении слот вызывает `_tooltipProvider.Show(buffData)` - появляется тултип с именем и описанием баффа. При уходе курсора - `_tooltipProvider.Hide()`.

Тултип читает содержимое из `BuffStaticData` (имя, описание, иконка) - те же данные, загруженные через Addressables, что и иконка слота. Отдельный ассет данных тултипа не нужен.

<!-- 📸 Скриншот: тултип над слотом инвентаря при наведении -->

---

## Сохранение и восстановление

### Сохранение

`SaveLoadService.SaveProgress()` вызывает `_inventoryService.GetSaveData()` и присваивает результат `_progressService.Progress.Inventory`. Это снапшот текущих in-memory массивов слотов.

### Восстановление

`LoadLevelState` вызывает `InventoryService.LoadFromSaveData(progress.Inventory)` после создания игрока. Восстанавливает содержимое слотов и `SelectedHotbarIndex`, затем emitит события изменения - все слот-виды обновят иконки в первом кадре.

Выбор хотбара применяется до первого рендера, нужный слот сразу подсвечен при загрузке.
