# Buff System

## Table of Contents
- [Overview](#overview)
- [BuffBase - the base class](#buffbase---the-base-class)
- [Activation Types](#activation-types)
- [Concrete Buff Implementations](#concrete-buff-implementations)
- [Visual Effects](#visual-effects)
- [BuffTrackerService](#bufftrackerservice)
- [Save & Restore](#save--restore)
- [BuffFactory](#bufffactory)
- [Adding a New Buff](#adding-a-new-buff)

---

## Overview

Buffs in Lone Brawler are plain C# classes - not `MonoBehaviour`s - that apply temporary or permanent modifications to the player. The system has three layers:

1. **`BuffBase`** - abstract base class with all shared logic: lifecycle, VFX loading, save/restore hooks, reactive state property.
2. **Concrete buff classes** - subclasses that override one or more virtual hooks to implement specific gameplay effects.
3. **`BuffTrackerService`** - infrastructure service that owns all active buff instances, connects the gameplay layer to the save system, and handles restore on load.

---

## BuffBase - the base class

`BuffBase` is not a `MonoBehaviour`. It gets its dependencies through constructor injection and holds protected references to `BuffOwner` (the player `GameObject`) and `BuffOwnerTransform`.

### Reactive state

```csharp
public ReadOnlyReactiveProperty<BuffState> BuffStateRP => _buffStateRP;
```

`BuffState` is an enum: `Passive`, `Active`, `Disabled`. Any UI element can subscribe to `BuffStateRP` rather than poll. The hotbar slot view, for example, subscribes to know when to grey out the icon.

### Constructor guard

The constructor throws `InvalidOperationException` if:
- `buffStaticData.Class == BuffClassName.None` - unregistered buff
- `buffStaticData.Class == BuffClassName.BuffBase` - direct instantiation of the abstract base

This catches misconfigured ScriptableObjects at runtime rather than producing silent incorrect behaviour.

### Duration tracking

`_buffDuration` counts down during the Duration tick loop. `RemainingDuration` is public read-only so `BuffTrackerService` can snapshot it into `BuffSaveEntry` at save time. `SetRemainingDuration(float)` is used on restore to move the timer to where it was when the game was saved.

---

## Activation Types

Three activation modes defined by `BuffActivationType`:

### Burst

One-shot activation. `BurstActivation()` fires once and the buff immediately moves to `Disabled`. Use for instant effects like a healing potion.

```csharp
// In HealthPotionBuff:
protected override void BurstActivation()
{
    _playerHealth.Heal(_healAmount);
    SpawnAndFadeEffectAsync().Forget();
}
```

VFX for burst buffs spawn and immediately get `TriggerStop()` - the particle system fades out and the `GameObject` is destroyed when `OnStopped` fires.

### Constant

Applied once, stays active permanently. `ConstantActivation()` mutates the player stat directly - `_playerAttack.Damage *= _damageMultiplier` - and spawns a persistent VFX. The changed value writes into `PlayerStats` on save, so on restore the number is already correct.

```csharp
// In DamageBuff:
protected override void ConstantActivation()
{
    _playerAttack.Damage *= _damageMultiplier;
    SpawnEffectAsync(BuffOwnerTransform, ...).Forget();
}

// Called on restore - stat already applied, only visuals needed:
protected override void OnConstantRestored()
{
    SpawnEffectAsync(BuffOwnerTransform).Forget();
}
```

### Duration

Runs a coroutine tick loop for `TotalDuration` seconds. Three virtual hooks fire:

| Hook | When |
|---|---|
| `OnDurationStarted()` | Once, before the first tick - apply effects, spawn VFX |
| `OnDurationTick()` | Every frame while active - per-frame effects like heal-per-second |
| `OnDurationEnded()` | Once, when time runs out - revert effects, trigger VFX fade |

The tick loop runs through `ICoroutineRunner` (the `GameInstance` `MonoBehaviour`), so it survives scene transitions without being tied to a scene-owned object.

---

## Concrete Buff Implementations

### `HealthPotionBuff` *(Burst)*
Reads `HealAmount` and `EffectLifetime` from `BuffStaticData`. Heals the player for `HealAmount` instantly. Spawns VFX, triggers `IParticleSmoothFade.TriggerStop()`, and destroys the effect when `OnStopped` fires - or after `EffectLifetime` seconds if `IParticleSmoothFade` isn't on the prefab.

### `DamageBuff` *(Constant)*
Reads `DamageMultiplier`. Multiplies `PlayerAttack.Damage` in `ConstantActivation()`. On restore it only respawns the VFX, since the multiplied value is already in `PlayerStats`.

### `HealthBuff` *(Constant)*
Reads `MaxHealthBonus`. Raises the player's maximum health via `PlayerHealth`. No VFX.

### `SpeedBuff` *(Duration)*
Reads `SpeedMultiplier` and `FadeOutThreshold`. Calls `PlayerMove.ApplySpeedMultiplier()` in `OnDurationStarted()`, reverts in `OnDurationEnded()`. In `OnDurationTick()` it checks if `elapsed >= TotalDuration * (1 - FadeOutThreshold)` and calls `IParticleSmoothFade.TriggerStop()` once when that threshold is crossed.

### `RegenBuff` *(Duration)*
Reads `HealPerSecond` and `FadeOutThreshold`. Calls `PlayerHealth.Heal(HealPerSecond * Time.UnscaledDeltaTime)` each tick. Same fade threshold pattern as `SpeedBuff`.

### `RageBuff` *(Duration)*
Reads `IncomingDamageModifier`, `OutgoingDamageMultiplier`, and `FadeOutThreshold`. Cuts incoming damage via `PlayerHealth.ApplyDamageModifier()` and multiplies outgoing damage through `PlayerAttack.Damage`. Both changes are reverted in `OnDurationEnded()`.

---

## Visual Effects

All VFX loading goes through `BuffBase.SpawnEffectAsync()`:

```csharp
protected async UniTask SpawnEffectAsync(Transform parent = null, CancellationToken ct = default)
{
    if (_buffStaticData.BuffEffectPrefab == null || string.IsNullOrEmpty(...AssetGUID))
        return;

    DestroyEffect(); // prevent stacking - destroy previous before spawning new
    SpawnedEffect = await _assetLoader.InstantiateAsync(_buffStaticData.BuffEffectPrefab, parent);
}
```

The prefab reference is an `AssetReference` in `BuffStaticData`, so effects load on demand via Addressables and sit in memory only while active. `DestroyEffect()` releases the Addressables handle and destroys the `GameObject` in one call.

`IParticleSmoothFade` is a custom interface on VFX prefabs with `TriggerStop()` and `Observable<Unit> OnStopped`. Duration and burst buffs use it to start the particle fade at the right moment rather than destroying the object abruptly.

---

## BuffTrackerService

`BuffTrackerService` is the single owner of all active buff instances during a session.

### Registry

Internally: `Dictionary<BuffClassName, List<BuffBase>>`. A buff class can have multiple instances (if the player applies the same buff twice), so each key maps to a list.

### Public API

```api
void | AddBuff(BuffBase buff, BuffClassName className)
void | RemoveBuff(BuffBase buff, BuffClassName className)
IReadOnlyList<BuffBase> | GetPlayerBuffs(BuffClassName className)
void | Cleanup() | full reset — called on level load
void | CleanupActiveBuffs() | calls Cleanup() on each live instance
```

`Cleanup()` runs at the start of `ReadProgress()` to discard all instances pointing to the previous scene's player object, stopping stale entries from being picked up during buff restore.

---

## Save & Restore

### Saving (`WriteToProgress`)

Called by `SaveLoadService` as part of the general save pass. Iterates `_playerBuffs` and writes a `BuffSaveEntry` snapshot for each active buff:

```csharp
playerProgress.BuffsRegistry.PlayerBuffs.Add(new BuffSaveEntry
{
    ClassName = className,
    ActivationType = buff.ActivationType,
    State = state,
    RemainingDuration = buff.RemainingDuration,
});
```

Buffs in `Disabled` state - Burst buffs that have already fired - are skipped. Nothing meaningful to restore.

### Restoring (`ReadProgress`)

Called after the player `GameObject` is spawned so `IPlayerReader.GetPlayer()` returns a valid reference. Takes a snapshot of the entries list to avoid `InvalidOperationException` if `WriteToProgress` runs mid-iteration.

For each entry:

| ActivationType | Restore action |
|---|---|
| `Duration` | `buff.SetRemainingDuration(entry.RemainingDuration)` then `buff.Activate()` |
| `Constant` | `buff.RestoreConstantBuff()` - marks Active, calls `OnConstantRestored()` for visuals |
| `Burst` | Skipped - already Disabled in any valid save |
| `Passive` | Registered in tracker but not activated - player hasn't used it yet |

Constant buffs do **not** re-apply stat effects on restore. The numbers are already in `PlayerStats` from the save; reapplying would double the modifier.

---

## BuffFactory

`BuffFactory` creates concrete buff instances from a `BuffClassName` enum value. It loads `BuffStaticData` from `StaticDataService`, then calls `new ConcreteBuffType(...)` with all dependencies from the DI container.

This is the only place where the `BuffClassName` to C# class mapping lives. Adding a new buff means registering it in `BuffFactory` - there's no reflection-based auto-discovery.

---

## Adding a New Buff

1. **Create the ScriptableObject config** - new `BuffStaticData` asset, unique `BuffClassName` enum value, set `ActivationType`, duration, and parameter values via the `BuffParameters` list.
2. **Add the enum value** to `BuffClassName` and `BuffActivationType` if needed.
3. **Write the C# class** - inherit `BuffBase`, override the right hooks (`BurstActivation`, `ConstantActivation`, or `OnDurationStarted` / `OnDurationTick` / `OnDurationEnded`).
4. **Register in `BuffFactory`** - add `case BuffClassName.YourBuff:` that constructs the new class.
5. **Add the icon** to `BuffStaticData` as `AssetReference<Sprite>`.
6. **Optionally create a VFX prefab** implementing `IParticleSmoothFade` and assign it to `BuffEffectPrefab` in the config.

<!-- 📸 Screenshot: BuffStaticData inspector showing parameters list, and a hotbar with active buff icons -->
