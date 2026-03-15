# Система баффов

## Содержание
- [Обзор](#обзор)
- [BuffBase - базовый класс](#buffbase---базовый-класс)
- [Типы активации](#типы-активации)
- [Конкретные реализации баффов](#конкретные-реализации-баффов)
- [Визуальные эффекты](#визуальные-эффекты)
- [BuffTrackerService](#bufftrackerservice)
- [Сохранение и восстановление](#сохранение-и-восстановление)
- [BuffFactory](#bufffactory)
- [Добавление нового баффа](#добавление-нового-баффа)

---

## Обзор

Баффы в Lone Brawler - чистые C#-классы, не `MonoBehaviour`, которые накладывают временные или постоянные модификации на игрока. Система состоит из трёх слоёв:

1. **`BuffBase`** - абстрактный базовый класс со всей общей логикой: жизненный цикл, загрузка VFX, хуки сохранения/восстановления, реактивное свойство состояния.
2. **Конкретные классы баффов** - подклассы, переопределяющие нужные виртуальные хуки.
3. **`BuffTrackerService`** - инфраструктурный сервис, владеющий всеми активными инстансами, связывающий геймплей с системой сохранений и обрабатывающий восстановление при загрузке.

---

## BuffBase - базовый класс

`BuffBase` - не `MonoBehaviour`. Получает зависимости через конструкторную инъекцию и хранит защищённые ссылки на `BuffOwner` (GameObject игрока) и `BuffOwnerTransform`.

### Реактивное состояние

```csharp
public ReadOnlyReactiveProperty<BuffState> BuffStateRP => _buffStateRP;
```

`BuffState` - enum: `Passive`, `Active`, `Disabled`. UI-элементы подписываются на `BuffStateRP`, а не опрашивают. Слот хотбара, например, подписывается чтобы знать, когда серить иконку.

### Защита конструктора

Конструктор бросает `InvalidOperationException` если:
- `buffStaticData.Class == BuffClassName.None` - незарегистрированный бафф
- `buffStaticData.Class == BuffClassName.BuffBase` - прямое инстанцирование абстрактного базового класса

Это ловит неправильно настроенные ScriptableObjects в рантайме, а не производит молчаливое некорректное поведение.

### Отслеживание времени

`_buffDuration` убывает в тик-цикле Duration-баффа. `RemainingDuration` публичен (только чтение) - `BuffTrackerService` снапшотит его в `BuffSaveEntry` при сохранении. `SetRemainingDuration(float)` на восстановлении переводит таймер туда, где он был в момент сейва.

---

## Типы активации

Три режима, определяемые `BuffActivationType`:

### Burst

Одноразовая активация. `BurstActivation()` срабатывает один раз, бафф сразу переходит в `Disabled`. Для мгновенных эффектов вроде зелья лечения.

```csharp
// В HealthPotionBuff:
protected override void BurstActivation()
{
    _playerHealth.Heal(_healAmount);
    SpawnAndFadeEffectAsync().Forget();
}
```

VFX для burst-баффов спаунятся и сразу получают `TriggerStop()` - система частиц угасает, GameObject уничтожается когда срабатывает `OnStopped`.

### Constant

Применяется один раз, активен навсегда. `ConstantActivation()` напрямую мутирует стат - `_playerAttack.Damage *= _damageMultiplier` - и спаунит постоянный VFX. Изменённое значение записывается в `PlayerStats` при сохранении, поэтому при восстановлении число уже правильное.

```csharp
// В DamageBuff:
protected override void ConstantActivation()
{
    _playerAttack.Damage *= _damageMultiplier;
    SpawnEffectAsync(BuffOwnerTransform, ...).Forget();
}

// При восстановлении - стат уже применён, только визуалы:
protected override void OnConstantRestored()
{
    SpawnEffectAsync(BuffOwnerTransform).Forget();
}
```

### Duration

Запускает корутин тик-цикл на `TotalDuration` секунд. Три виртуальных хука:

| Хук | Когда |
|---|---|
| `OnDurationStarted()` | Однажды, до первого тика - применить эффекты, заспаунить VFX |
| `OnDurationTick()` | Каждый кадр пока активен - per-frame эффекты вроде лечения в секунду |
| `OnDurationEnded()` | Однажды, по истечении времени - откатить эффекты, запустить угасание VFX |

Тик-цикл работает через `ICoroutineRunner` (`MonoBehaviour` `GameInstance`), поэтому переживает переходы между сценами, не привязываясь к объектам конкретной сцены.

---

## Конкретные реализации баффов

### `HealthPotionBuff` *(Burst)*
Читает `HealAmount` и `EffectLifetime` из `BuffStaticData`. Мгновенно лечит на `HealAmount`. Спаунит VFX, вызывает `IParticleSmoothFade.TriggerStop()`, уничтожает эффект когда срабатывает `OnStopped` - или через `EffectLifetime` секунд если `IParticleSmoothFade` нет на префабе.

### `DamageBuff` *(Constant)*
Читает `DamageMultiplier`. Умножает `PlayerAttack.Damage` в `ConstantActivation()`. При восстановлении только заново спаунит VFX - умноженное значение уже в `PlayerStats`.

### `HealthBuff` *(Constant)*
Читает `MaxHealthBonus`. Поднимает максимальное здоровье через `PlayerHealth`. VFX нет.

### `SpeedBuff` *(Duration)*
Читает `SpeedMultiplier` и `FadeOutThreshold`. Вызывает `PlayerMove.ApplySpeedMultiplier()` в `OnDurationStarted()`, откатывает в `OnDurationEnded()`. В `OnDurationTick()` проверяет `elapsed >= TotalDuration * (1 - FadeOutThreshold)` и однократно вызывает `IParticleSmoothFade.TriggerStop()` при пересечении порога.

### `RegenBuff` *(Duration)*
Читает `HealPerSecond` и `FadeOutThreshold`. Вызывает `PlayerHealth.Heal(HealPerSecond * Time.UnscaledDeltaTime)` каждый тик. Та же схема порога угасания что у `SpeedBuff`.

### `RageBuff` *(Duration)*
Читает `IncomingDamageModifier`, `OutgoingDamageMultiplier` и `FadeOutThreshold`. Снижает входящий урон через `PlayerHealth.ApplyDamageModifier()`, умножает исходящий через `PlayerAttack.Damage`. Оба изменения откатываются в `OnDurationEnded()`.

---

## Визуальные эффекты

Вся загрузка VFX идёт через `BuffBase.SpawnEffectAsync()`:

```csharp
protected async UniTask SpawnEffectAsync(Transform parent = null, CancellationToken ct = default)
{
    if (_buffStaticData.BuffEffectPrefab == null || string.IsNullOrEmpty(...AssetGUID))
        return;

    DestroyEffect(); // защита от стакинга - уничтожить предыдущий перед спауном нового
    SpawnedEffect = await _assetLoader.InstantiateAsync(_buffStaticData.BuffEffectPrefab, parent);
}
```

Ссылка на префаб - `AssetReference` в `BuffStaticData`, эффекты загружаются через Addressables по требованию и лежат в памяти только пока бафф активен. `DestroyEffect()` освобождает Addressables-хэндл и уничтожает `GameObject` за один вызов.

`IParticleSmoothFade` - кастомный интерфейс на VFX-префабах с `TriggerStop()` и `Observable<Unit> OnStopped`. Duration и burst-баффы используют его для плавного угасания частиц в нужный момент, а не резкого уничтожения.

---

## BuffTrackerService

`BuffTrackerService` - единственный владелец всех активных инстансов баффов за сессию.

### Реестр

Внутри: `Dictionary<BuffClassName, List<BuffBase>>`. Один класс баффа может иметь несколько инстансов - если игрок применил один бафф дважды, - поэтому каждый ключ маппится на список.

### Публичный API

```csharp
void AddBuff(BuffBase buff, BuffClassName className)
void RemoveBuff(BuffBase buff, BuffClassName className)
IReadOnlyList<BuffBase> GetPlayerBuffs(BuffClassName className)
void Cleanup()            // полный сброс - вызывается при загрузке уровня
void CleanupActiveBuffs() // вызывает Cleanup() на каждом живом инстансе
```

`Cleanup()` запускается в начале `ReadProgress()` - выбрасывает все инстансы, указывающие на игрока из предыдущей сцены, чтобы устаревшие записи не подбирались при восстановлении баффов.

---

## Сохранение и восстановление

### Сохранение (`WriteToProgress`)

Вызывается `SaveLoadService` в рамках общего прохода сохранения. Итерирует `_playerBuffs` и записывает снапшот `BuffSaveEntry` для каждого активного баффа:

```csharp
playerProgress.BuffsRegistry.PlayerBuffs.Add(new BuffSaveEntry
{
    ClassName = className,
    ActivationType = buff.ActivationType,
    State = state,
    RemainingDuration = buff.RemainingDuration,
});
```

Баффы в `Disabled` - уже отработавшие Burst - пропускаются. Восстанавливать нечего.

### Восстановление (`ReadProgress`)

Вызывается после спауна GameObject игрока - `IPlayerReader.GetPlayer()` к этому моменту отдаёт валидную ссылку. Берёт снапшот списка записей, чтобы не получить `InvalidOperationException` если `WriteToProgress` запустится во время итерации.

Для каждой записи:

| ActivationType | Действие при восстановлении |
|---|---|
| `Duration` | `buff.SetRemainingDuration(entry.RemainingDuration)` затем `buff.Activate()` |
| `Constant` | `buff.RestoreConstantBuff()` - помечает Active, вызывает `OnConstantRestored()` для визуалов |
| `Burst` | Пропускается - уже Disabled в любом валидном сейве |
| `Passive` | Регистрируется в трекере, но не активируется - игрок ещё не использовал |

Constant-баффы **не** перезаписывают статы при восстановлении. Числа уже в `PlayerStats` из сейва; повторное применение удвоило бы модификатор.

---

## BuffFactory

`BuffFactory` создаёт конкретные инстансы баффов по значению enum `BuffClassName`. Загружает `BuffStaticData` из `StaticDataService`, затем вызывает `new КонкретныйКлассБаффа(...)` со всеми зависимостями из DI-контейнера.

Единственное место, где живёт маппинг `BuffClassName` -> C#-класс. Добавление нового баффа требует регистрации в `BuffFactory` - автодискавери через рефлексию нет.

---

## Добавление нового баффа

1. **Создать конфиг** - новый ассет `BuffStaticData`, уникальное значение `BuffClassName`, установить `ActivationType`, длительность и параметры через список `BuffParameters`.
2. **Добавить значение enum** в `BuffClassName` и `BuffActivationType` при необходимости.
3. **Написать C#-класс** - наследовать `BuffBase`, переопределить нужные хуки.
4. **Зарегистрировать в `BuffFactory`** - добавить `case BuffClassName.YourBuff:` с конструктором нового класса.
5. **Добавить иконку** в `BuffStaticData` как `AssetReference<Sprite>`.
6. **Опционально создать VFX-префаб**, реализующий `IParticleSmoothFade`, и назначить в `BuffEffectPrefab`.

<!-- 📸 Скриншот: инспектор BuffStaticData со списком параметров и хотбар с иконками активных баффов -->
