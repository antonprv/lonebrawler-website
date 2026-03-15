# UI & Frontend

## Table of Contents
- [Window System](#window-system)
- [Dev Console - MVVM](#dev-console---mvvm)
- [HUD](#hud)
- [Health Bars & Damage Popups](#health-bars--damage-popups)
- [Loading Screen](#loading-screen)
- [Platform Adapters](#platform-adapters)

---

## Window System

### WindowService

`WindowService` (implementing `IWindowService`) is the single entry point for opening UI windows. It takes `IUIFactory` through constructor injection and hands all creation work to it.

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

### UIFactory & Addressables

`IUIFactory` creates windows by loading their prefabs on demand through Addressables. Window prefabs are mapped in `WindowsManifest` - a ScriptableObject registry that links `WindowTypeId` enum values to `AssetReference` entries. No window prefab sits in memory until `Open()` is called for it.

`ConstructorContext.FromButton` passes the opening button's `RectTransform` to the window factory so windows can animate from the button position if needed.

### WindowBase

`WindowBase` is the abstract base for all windows. It has `Open()` and `Close()` with LeanTween scale/fade animations, and `DestroyOnClose()` to release the Addressables handle when the window is dismissed.

Supported window types: `Shop`, `Inventory`, `MainMenu`, `Credits`.

<!-- 📸 Screenshot: Inventory or Shop window open in-game -->

---

## Dev Console - MVVM

The developer console is the architecturally most layered UI component in the project. It follows strict MVVM separation across four layers.

### Model layer

**`ConsoleState`** - owns the message list (`List<string>`) and the active filter string. Has `AddMessage`, `ClearMessages`, `SetFilter`, and `IReadOnlyList<string> FilteredMessages`. Filtering applies lazily on read, not on write.

**`CommandHistory`** - a circular buffer of previously executed commands. `NavigateUp()` and `NavigateDown()` walk through history; `Push(string)` adds an entry. Consecutive duplicates are deduplicated.

**`MobileKeyboard`** - platform abstraction over `TouchScreenKeyboard`. On desktop this is a no-op; on mobile it manages keyboard open/close.

### ViewModel layer

**`ConsoleViewModel`** coordinates model mutations and exposes state to the View:

```csharp
public IReadOnlyList<string> Messages => _state.FilteredMessages;
public string InputText { get; private set; }
public bool IsVisible { get; private set; }

public void Submit()
public void ToggleVisibility()
public void NavigateHistory(bool up)
```

The ViewModel has no Unity UI references - it's pure C# data, fully unit-testable without a running scene.

### View layer

**`ConsoleRenderer`** - renders the entire console UI via IMGUI (`GUILayout`): header, scrollable message area, input field. Scroll position is managed by `ScrollDragHandler`, which intercepts touch drag events on mobile and converts them to `Vector2` scroll deltas for `GUILayout.BeginScrollView`.

**`ConsoleStyles`** - caches all `GUIStyle` instances. Creating styles is expensive; caching removes the allocation from every `OnGUI` frame.

**`PlatformService`** - provides `IsMobile` and `GetConsoleRootRect()`. On mobile the console rect shifts up to clear the soft keyboard. On desktop it fills the top 40% of the screen.

### Controller layer

**`DevConsoleController`** - a `ZenjexBehaviour` `MonoBehaviour` that wires ViewModel to View. Calls `ConsoleRenderer.Render()` from `OnGUI()`, forwards Unity Input events to the ViewModel, and manages `MobileKeyboard` lifecycle.

**`ConsoleButtonController`** - a separate `MonoBehaviour` on the mobile toggle button. Tap calls `ViewModel.ToggleVisibility()`.

### Available commands

| Command | Usage | Effect |
|---|---|---|
| `clear` | `clear` | Clears the message list |
| `help` | `help` | Lists all registered commands |
| `filter` | `filter <text>` | Filters visible messages |
| `toggle_unity_logs` | `toggle_unity_logs` | Toggles Unity Debug.Log forwarding |
| `export_logs` | `export_logs` | Exports log history to file |
| `log_stats` | `log_stats` | Prints current FPS, memory |
| `set_fps` | `set_fps <value>` | Sets `Application.targetFrameRate` |
| `stat_fps` | `stat_fps` | Toggles on-screen FPS counter |
| `add_souls` | `add_souls <amount>` | Adds souls to player balance |
| `load_level` | `load_level <levelName>` | Saves and loads the named level |
| `quit_to_menu` | `quit_to_menu` | Returns to main menu |
| `pause_game` | `pause_game` | Toggles `Time.timeScale` between 0 and 1 |
| `reset_game` | `reset_game` | Clears all save data and restarts |
| `warp_player` | `warp_player <x> <y> <z>` | Teleports player to world coordinates |

<!-- 📸 Screenshot: Dev console open in-game showing command output -->

---

## HUD

`HudView` is a `ZenjexBehaviour` that manages the in-game heads-up display. In `OnAwake()` it subscribes to `ISoulsTrackerService.SoulsRP` and updates the counter text reactively.

The HUD subscribes to player health via `IHealth.HealthRP` and drives the health bar fill amount. Every update is push-based - no polling.

<!-- 📸 Screenshot: HUD layout in-game showing health bar, souls counter, and hotbar -->

---

## Health Bars & Damage Popups

### HealthBar

`HealthBar` is a world-space UI element attached to a character. `LookAtCamera` rotates the bar to always face the main camera. Health changes drive `Image.fillAmount` via subscription to `IHealth.HealthRP`.

Enemy health bars are visible only when the enemy is damaged or in combat - they fade out at full health. `LeanTween` drives the fade.

### TextPopup

`TextPopup` spawns floating text above a character on events like damage, heal, or soul collection. Text moves upward and fades via `LeanTween`, then the `GameObject` returns to a pool. Font size and colour are set per popup type: damage is red, heal is green, souls are yellow.

<!-- 📸 Screenshot: Enemy health bar and floating damage numbers in combat -->

---

## Loading Screen

`LoadingCurtain` (implementing `ILoadScreen`) is a full-screen overlay used during scene transitions. `Show()` and `Hide()` run LeanTween alpha tweens on a `CanvasGroup`. `Show()` blocks input while the curtain is up.

The curtain is created by `InstallerFactory.CreateLoadingScreenRoutine()` and marked `DontDestroyOnLoad`, so it persists across all scene loads for the entire session.

<!-- 📸 Screenshot: Loading screen curtain transitioning between scenes -->

---

## Platform Adapters

### HideButtonsOnPC

`HideButtonsOnPC` checks `Application.isMobilePlatform` in `Awake()` and disables mobile-only `GameObject`s (virtual joystick, touch buttons, etc.) on desktop builds. Single `Awake()` call, no Update loop.

### CloudSaveSystemButton

`CloudSaveSystemButton` is a UI button that kicks off a manual cloud save push on tap. It disables itself while the async push is running to prevent double-taps, then re-enables on completion or error.
