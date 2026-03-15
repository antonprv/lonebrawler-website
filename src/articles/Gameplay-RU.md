# Геймплейные системы

## Содержание
- [Персонаж игрока](#персонаж-игрока)
- [ИИ противников](#ии-противников)
- [Система душ](#система-душ)
- [Телепортация между уровнями](#телепортация-между-уровнями)

---

## Персонаж игрока

Персонаж разбит на дискретные `MonoBehaviour`-ы с единственной ответственностью, каждый реализует один или несколько доменных интерфейсов.

### Разбивка компонентов

| Компонент | Интерфейс(ы) | Ответственность |
|---|---|---|
| `PlayerMove` | `IMovableAgent`, `IProgressReader`, `IProgressWriter` | Перемещение через CharacterController, вращение, API множителя скорости |
| `PlayerHealth` | `IHealth`, `IProgressReader`, `IProgressWriter` | Отслеживание HP, `TakeDamage`, `Heal`, API модификатора урона |
| `PlayerDeath` | `IDeath` | Запускает анимацию смерти, ждёт `DeathDelay`, передаёт управление `MainMenuState` |
| `PlayerAnimator` | `IAnimator`, `IAnimationStateReader` | Управляет Animator Controller на основе движения и состояния |
| `PlayerBuffConsumer` | `IBuffConsumer`, `IBuffReceiver` | Направляет выбор в хотбаре к `BuffTrackerService.GetPlayerBuffs()` |

### Инициализация из сейва

При загрузке уровня `GameFactory.CreatePlayer()` инстанциирует префаб и вызывает `InformProgressReaders()`, который пушит текущий `GameProgress` в каждый `IProgressReader` - в том числе `PlayerMove` и `PlayerHealth`. Статы берутся из `PlayerStats` в сейве, поэтому скорость, урон и здоровье при загрузке в точности совпадают с последней точкой сохранения.

### API модификатора урона (`PlayerHealth`)

`PlayerHealth` имеет `ApplyDamageModifier(float modifier)` и `RemoveDamageModifier(float modifier)`, чтобы `RageBuff` снижал входящий урон без хранения отдельного множителя вне компонента здоровья. Модификатор применяется мультипликативно до вычитания из HP в `TakeDamage`.

### API множителя скорости (`PlayerMove`)

`PlayerMove` имеет `ApplySpeedMultiplier(float multiplier)` и `RemoveSpeedMultiplier(float multiplier)`, используемые `SpeedBuff`. Множители стакаются мультипликативно и хранятся в списке - несколько систем, влияющих на скорость, не конфликтуют.

<!-- 📸 Скриншот: иерархия компонентов игрока в инспекторе -->

---

## ИИ противников

### Разбивка компонентов

| Компонент | Интерфейс(ы) | Ответственность |
|---|---|---|
| `Aggro` | `IAggro` | Детекция близости через `TriggerObserver`, задержанное де-аггро |
| `EnemyMovement` | `IMovableAgent` | NavMeshAgent-навигация к игроку |
| `EnemyHealth` | `IHealth` | Отслеживание HP с `IEnemyStaticDataReceiver` для конфига |
| `EnemyDeath` | `IEnemyDeath` | Анимация смерти, задержка, деспаун, дроп лута |
| `EnemyAttacker` | `IEnemyAttacker` | Управление кулдауном атаки, делегирование `IAttackBehaviour` |
| `EnemyAnimator` | `IAnimator` | Animator Controller на основе движения и боевого состояния |
| `EnemyLootSpawner` | `ILootSpawner`, `IProgressReader`, `IProgressWriter` | Отслеживает, был ли уже собран лут этого спаунера |

### Система аггро

`Aggro` использует дочерний `TriggerObserver` для детекции входа/выхода игрока из зоны. При входе сразу вызывает `IMovableAgent.ContinueFollowing()`. При выходе запускает корутин `followDelay` - враг не останавливается мгновенно, а ждёт, давая игроку шанс вернуться без рывкообразной остановки. Де-аггро срабатывает только если игрок всё ещё снаружи по истечении задержки.

`Aggro` можно `Activate()` и `Deactivate()` независимо - логика спаунера может отключить аггро до полной инициализации врага.

### Поведение атаки

Атака вынесена за `IAttackBehaviour`. Две реализации:

- **`MeleeAttackBehaviour`** - проверяет `ICheckAttackRange`, ждёт окна анимации атаки, наносит урон всем целям в `AttackRadius` до `MaxEnemiesHit`.
- **`ProjectileAttackBehaviour`** - спаунит снаряд из пула (`IProjectilePool`) в кадре триггера атаки, с опциональным VFX из `IVfxPool`.

Конкретная реализация выбирается per-тип врага в `EnemyStaticData` через enum `EnemyAttackType` - ни один класс врага не знает, какой режим использует.

### Пулинг объектов

`ProjectilePool` и `VfxPool` прогреваются при загрузке уровня через интерфейсы `IProjectilePool` / `IVfxPool`. Возврат объекта в пул отключает его `GameObject`, а не уничтожает; получение из пула включает и сбрасывает состояние.

### Статические данные врага

Все настроечные значения в ScriptableObject `EnemyStaticData`: `MaxHealth`, `AttackDamage`, `AttackRange`, `AttackRadius`, `AttackCooldown`, `MovementSpeed`, `DisappearDelay`, `EnemyTypeId`, `EnemyAttackType`. Загружаются при спауне через `StaticDataService` - в префабах врагов нет захардкоженных значений.

<!-- 📸 Скриншот: гизмо зоны аггро во вью сцены или инспектор EnemyStaticData -->

---

## Система душ

`SoulsTrackerService` - авторитетный источник баланса душ за сессию.

### Реактивный баланс

```csharp
public ReadOnlyReactiveProperty<int> SoulsRP { get; }
```

HUD и UI магазина подписываются на `SoulsRP` через R3. Изменения сразу приходят подписчикам без поллинга и ручного связывания событий.

### Атомарное списание

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

Проверка и списание - один вызов. Если баланса не хватает, возвращается `false` и ничего не меняется. Вызывающий код обязан обработать `false` явно - скрытого частичного списания нет.

### Персистентность

`SoulsCollected.Amount` - часть `GameProgress`, сериализуется при каждом сохранении. `SoulsTrackerService.ReadProgress()` восстанавливает `_soulsRP.Value` при загрузке - реактивное свойство сразу синхронизировано с файлом сохранения.

<!-- 📸 Скриншот: счётчик душ в HUD, обновляющийся после убийства врага -->

---

## Телепортация между уровнями

`LevelTeleportTrigger` размещается в сцене фабрикой `GameFactory` на основе `LevelTeleportData` из `LevelStaticData`. Это триггерный коллайдер, срабатывающий при контакте с игроком.

### Последовательность триггера

```
Игрок входит в BoxCollider триггер
    |
    v  (one-shot: _triggered = true предотвращает двойное срабатывание)
UpdateLastTeleportName()  -> записывает uniqueName в WorldData
UpdateLastTeleportTime()  -> записывает DateTime.UtcNow.Ticks в WorldData
SaveProgress()            -> полное сохранение через SaveComponent
LoadLevel(levelKey)       -> GameStateMachine.EnterState<LoadLevelState, string>(levelKey)
```

### Восстановление точки спауна

Когда `LoadLevelState` загружает сцену назначения, читает `WorldData.LastTeleportUniqueName` и ищет совпадающий `TeleportEnterMarker` в новой сцене. Игрок спаунится в позиции маркера. Если маркер не найден (первое посещение или повреждённые данные), используются дефолтные `PlayerStartCoordinates` из `LevelStaticData`.

### UTC-метка времени

`LastTeleportTimeUTC` хранит `DateTime.UtcNow.Ticks`, а не float-секунды. Ticks не зависят от платформы и не ломаются при смене часового пояса. Метка используется для аналитики и будущих функций вроде телепортов с кулдауном.

<!-- 📸 Скриншот: коллайдер LevelTeleportTrigger во вью сцены и совпадающий TeleportEnterMarker в сцене назначения -->
