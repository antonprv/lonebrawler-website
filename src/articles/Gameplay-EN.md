# Gameplay Systems

## Table of Contents
- [Player](#player)
- [Enemy AI](#enemy-ai)
- [Souls System](#souls-system)
- [Level Teleportation](#level-teleportation)

---

## Player

The player character is split into discrete, single-responsibility `MonoBehaviour`s, each implementing one or more domain interfaces.

### Component breakdown

| Component | Interface(s) | Responsibility |
|---|---|---|
| `PlayerMove` | `IMovableAgent`, `IProgressReader`, `IProgressWriter` | CharacterController movement, rotation, speed multiplier API |
| `PlayerHealth` | `IHealth`, `IProgressReader`, `IProgressWriter` | HP tracking, `TakeDamage`, `Heal`, damage modifier API |
| `PlayerDeath` | `IDeath` | Triggers death animation, waits `DeathDelay`, hands off to `MainMenuState` |
| `PlayerAnimator` | `IAnimator`, `IAnimationStateReader` | Drives the Animator Controller based on movement and state |
| `PlayerBuffConsumer` | `IBuffConsumer`, `IBuffReceiver` | Routes hotbar selection to `BuffTrackerService.GetPlayerBuffs()` |

### Initialisation from save

On level load, `GameFactory.CreatePlayer()` instantiates the player prefab and calls `InformProgressReaders()`, which pushes the current `GameProgress` to every `IProgressReader`, including `PlayerMove` and `PlayerHealth`. Stats come from `PlayerStats` in the save file, so speed, damage, and health on load exactly match the last save point.

### Damage modifier API (`PlayerHealth`)

`PlayerHealth` has `ApplyDamageModifier(float modifier)` and `RemoveDamageModifier(float modifier)` so `RageBuff` can cut incoming damage without keeping a separate multiplier outside the health component. The modifier applies multiplicatively before `TakeDamage` subtracts from current HP.

### Speed multiplier API (`PlayerMove`)

`PlayerMove` has `ApplySpeedMultiplier(float multiplier)` and `RemoveSpeedMultiplier(float multiplier)`, used by `SpeedBuff`. Multipliers stack multiplicatively and live in a list, so multiple speed-affecting systems don't conflict.

<!-- 📸 Screenshot: Player component hierarchy in the inspector -->

---

## Enemy AI

### Component breakdown

| Component | Interface(s) | Responsibility |
|---|---|---|
| `Aggro` | `IAggro` | Proximity detection via `TriggerObserver`, delayed deaggro |
| `EnemyMovement` | `IMovableAgent` | NavMeshAgent pathfinding toward the player |
| `EnemyHealth` | `IHealth` | HP tracking with `IEnemyStaticDataReceiver` for config |
| `EnemyDeath` | `IEnemyDeath` | Death animation, delay, despawn, loot drop |
| `EnemyAttacker` | `IEnemyAttacker` | Attack cooldown, delegates to `IAttackBehaviour` |
| `EnemyAnimator` | `IAnimator` | Animator Controller driven by movement and combat state |
| `EnemyLootSpawner` | `ILootSpawner`, `IProgressReader`, `IProgressWriter` | Tracks whether this spawner's loot was already collected |

### Aggro system

`Aggro` uses a `TriggerObserver` child to detect when the player enters or exits the zone. On trigger enter it immediately calls `IMovableAgent.ContinueFollowing()`. On trigger exit it starts a `followDelay` coroutine - the enemy doesn't stop at once but waits a short time, giving the player a chance to re-enter without a jarring stop. Deaggro only happens if the player is still outside when the delay expires.

`Aggro` can be `Activate()`d and `Deactivate()`d independently, letting spawner logic disable aggro before the enemy is fully initialised.

### Attack behaviour

The attack sits behind `IAttackBehaviour`. Two implementations:

- **`MeleeAttackBehaviour`** - checks `ICheckAttackRange`, waits for the animation attack window, then deals damage to all targets within `AttackRadius` up to `MaxEnemiesHit`.
- **`ProjectileAttackBehaviour`** - spawns a projectile from an object pool (`IProjectilePool`) on the attack trigger frame, with optional VFX from `IVfxPool`.

The concrete implementation is picked per enemy in `EnemyStaticData` via `EnemyAttackType` enum - no enemy class knows which mode it uses.

### Object pooling

`ProjectilePool` and `VfxPool` are pre-warmed at level load and managed through `IProjectilePool` / `IVfxPool`. Returning an object to the pool disables its `GameObject` instead of destroying it; acquiring one re-enables it and resets its state.

### Enemy static data

All tuning values live in `EnemyStaticData` ScriptableObjects: `MaxHealth`, `AttackDamage`, `AttackRange`, `AttackRadius`, `AttackCooldown`, `MovementSpeed`, `DisappearDelay`, `EnemyTypeId`, `EnemyAttackType`. Loaded at spawn time via `StaticDataService` - no hardcoded values in enemy prefabs.

<!-- 📸 Screenshot: Enemy aggro zone gizmo in scene view, or EnemyStaticData inspector -->

---

## Souls System

`SoulsTrackerService` is the authoritative source for the souls balance during a play session.

### Reactive balance

```csharp
public ReadOnlyReactiveProperty<int> SoulsRP { get; }
```

The HUD and shop UI subscribe to `SoulsRP` via R3. Changes push to subscribers immediately without polling or manual event wiring in individual UI classes.

### Atomic spend

```csharp
public bool TrySpendSouls(int amount)
{
    int current = _progressService.Progress.SoulsCollected.Amount;
    if (current < amount) return false;

    _progressService.Progress.SoulsCollected.Amount -= amount;
    _soulsRP.Value = _progressService.Progress.SoulsCollected.Amount;
    return true;
}
```

Check and deduct happen in a single call. If the balance is too low, `false` comes back and nothing changes. The caller must handle `false` explicitly - no silent partial deduction.

### Persistence

`SoulsCollected.Amount` is part of `GameProgress` and serialised on every save. `SoulsTrackerService.ReadProgress()` restores `_soulsRP.Value` on load, so the reactive property is immediately in sync with the save file.

<!-- 📸 Screenshot: Souls counter in HUD updating after enemy kill -->

---

## Level Teleportation

`LevelTeleportTrigger` is placed in the scene by `GameFactory` based on `LevelTeleportData` from `LevelStaticData`. It's a trigger collider that fires on player contact.

### Trigger sequence

```
Player enters BoxCollider trigger
    |
    v  (one-shot guard: _triggered = true prevents double-fire)
UpdateLastTeleportName()  -> writes uniqueName to WorldData
UpdateLastTeleportTime()  -> writes DateTime.UtcNow.Ticks to WorldData
SaveProgress()            -> full save via SaveComponent
LoadLevel(levelKey)       -> GameStateMachine.EnterState<LoadLevelState, string>(levelKey)
```

### Spawn point restoration

When `LoadLevelState` loads the destination scene, it reads `WorldData.LastTeleportUniqueName` to find the matching `TeleportEnterMarker` in the new scene. The player spawns at that marker's position. If no matching marker is found (first visit or corrupted data), the default `PlayerStartCoordinates` from `LevelStaticData` is used.

### UTC timestamp

`LastTeleportTimeUTC` stores `DateTime.UtcNow.Ticks` rather than float seconds. Ticks are platform-independent and survive timezone changes between sessions. The timestamp is used for analytics and future features like cooldown-based teleports.

<!-- 📸 Screenshot: LevelTeleportTrigger collider in scene view and the matching TeleportEnterMarker in the destination scene -->
