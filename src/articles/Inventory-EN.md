# Inventory & Hotbar

## Table of Contents
- [Data Model](#data-model)
- [InventoryService](#inventoryservice)
- [InventorySlotView - drag & drop cell](#inventoryslotview---drag--drop-cell)
- [Drag & Drop Services](#drag--drop-services)
- [HotbarView](#hotbarview)
- [Tooltip System](#tooltip-system)
- [Save & Restore](#save--restore)

---

## Data Model

The inventory's persistent state lives in `InventorySaveData`, a field of `GameProgress`:

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

Slot counts come from `InventorySystemConfig` at runtime (currently `InventorySize = 44`, `HotbarSize = 3`). `InitializeSlots()` pre-fills both lists with empty `InventorySlotData` instances so the lists are always the right length - no null-slot checks needed at runtime.

---

## InventoryService

`InventoryService` (implementing `IInventoryService`) is the runtime owner of inventory state. It holds the slot arrays in memory and exposes a reactive API for UI to subscribe to.

### Reactive events

```csharp
Observable<int>  OnInventorySlotChanged   // fires with slotIndex when a slot changes
Observable<int>  OnHotbarSlotChanged      // fires with slotIndex when a hotbar slot changes
Observable<Unit> OnHotbarSelectionChanged // fires when SelectedHotbarIndex changes
```

UI components subscribe rather than poll. When `InventoryService.SetSlot()` is called, it updates the in-memory data and emits the right event - the affected `InventorySlotView` calls `RefreshViewAsync()` in its subscription callback.

### Core operations

```csharp
bool TryAddItem(BuffClassName buffClass, int count)  // false if inventory is full
void RemoveItem(int slotIndex, int count)
void MoveItem(int fromIndex, int toIndex, DragSource source)
void SelectHotbarSlot(int index)
InventorySaveData GetSaveData()  // snapshot for SaveLoadService
```

`TryAddItem` first looks for an existing slot with the same `BuffClassName` and stacks on top. If no stackable slot is found it fills the first empty slot. If both fail it returns `false`.

`MoveItem` handles all combinations: inventory-to-inventory, hotbar-to-hotbar, inventory-to-hotbar, and hotbar-to-inventory. Swapping with a non-empty target is supported - items are exchanged rather than dropped.

---

## InventorySlotView - drag & drop cell

`InventorySlotView` is a `ZenjexBehaviour` that acts as both a visual cell and a full drag-and-drop handler. It implements the complete Unity EventSystem drag chain:

```csharp
IBeginDragHandler  // picks up item, shows drag icon, hides local icon
IDragHandler       // moves drag icon to cursor/finger
IEndDragHandler    // clears drag state if drop wasn't completed
IDropHandler       // receives dropped item, calls MoveItem
IPointerEnterHandler // shows tooltip
IPointerExitHandler  // hides tooltip
IPointerClickHandler // handles click-to-use (hotbar activation)
```

### Async icon loading

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

Icon sprites are `AssetReference` fields in `BuffStaticData`, loaded on demand via Addressables. Sprites only load when a slot actually contains that item - memory footprint tracks inventory contents, not total item count.

### Selection colour animation

`SetSelected()` calls `SwitchColor(background, selectedColor)`, which runs a LeanTween colour tween on the background `Image` at `colorSwitchSpeed`. The transition is smooth, giving visible feedback on hotbar key presses.

---

## Drag & Drop Services

### DragDropService

Keeps the current drag state: which slot is the source, what item is being dragged, and the `DragSource` enum (Inventory or Hotbar). When `IDropHandler.OnDrop` fires on a target slot, it calls `InventoryService.MoveItem` with source index, target index, and source type.

### DragIconProvider

Manages the floating icon `GameObject` that follows the cursor during a drag. On `IBeginDragHandler` the icon is enabled and positioned at the cursor. On `IDragHandler` it tracks the pointer each frame. On `IEndDragHandler` or a successful `IDropHandler` it hides again.

The drag icon's sprite matches the dragged slot's icon. On mobile it follows the touch position; on PC it follows the mouse cursor.

<!-- 📸 Screenshot: Inventory window with an item being dragged between slots -->

---

## HotbarView

`HotbarView` renders the hotbar strip at the bottom of the screen. It creates slot views via `IInventoryFactory.CreateHotbarElementAsync()` and subscribes to `InventoryService` events:

```csharp
_inventoryService.OnHotbarSlotChanged
    .Subscribe(OnSlotChanged)
    .AddTo(_disposables);

_inventoryService.OnHotbarSelectionChanged
    .Subscribe(_ => UpdateSelection())
    .AddTo(_disposables);
```

`HandleHotbarInput()` runs in `Update()` and reads `IInputService.ActiveHotbar` - a `KeyValuePair<int, bool>` where the key is the slot index and the value is whether that slot's key was pressed this frame. On press, `InventoryService.SelectHotbarSlot(index)` fires, which routes to `TryUseBuff` via `PlayerBuffConsumer`.

<!-- 📸 Screenshot: Hotbar at the bottom of the screen with buff icons -->

---

## Tooltip System

`ITooltipProvider` is injected into `InventorySlotView`. On pointer enter the slot calls `_tooltipProvider.Show(buffData)`, which shows a tooltip with the buff's name and description. On pointer exit `_tooltipProvider.Hide()` is called.

The tooltip reads content from `BuffStaticData` (name, description, icon) - the same Addressables-loaded data as the slot icon. No separate tooltip data asset is needed.

<!-- 📸 Screenshot: Tooltip appearing above an inventory slot on hover -->

---

## Save & Restore

### Saving

`SaveLoadService.SaveProgress()` calls `_inventoryService.GetSaveData()` and assigns the result to `_progressService.Progress.Inventory`. This snapshots the current in-memory slot arrays.

### Restoring

`LoadLevelState` calls `InventoryService.LoadFromSaveData(progress.Inventory)` after the player is created. This restores slot contents and `SelectedHotbarIndex`, then emits change events so all slot views refresh their icons on the first frame.

The hotbar selection applies before the first render, so the correct slot appears highlighted immediately on load.
