# Аудиосистема

## Содержание
- [Обзор](#обзор)
- [MusicPlayer](#musicplayer)
- [TrackSequencer и shuffle](#tracksequencer-и-shuffle)
- [TrackLoader и кеширование](#trackloader-и-кеширование)
- [Fader](#fader)
- [Звуковые эффекты](#звуковые-эффекты)
- [SoundService - привязка громкости](#soundservice---привязка-громкости)
- [MenuButtonSound](#menubuttonsound)

---

## Обзор

Аудиосистема состоит из двух независимых подсистем:

- **Музыка** - полностью асинхронный многотрековый плеер с кросфейдом, shuffle и поддержкой плейлистов per-уровень.
- **SFX** - компонентный список звуков, маппированный на рандомизированные группы аудиоклипов.

Обе читают громкость из реактивных свойств `ISoundService` - единственный слайдер настроек обновляет всё активное аудио в реальном времени.

---

## MusicPlayer

`MusicPlayer` - `ZenjexBehaviour`, управляющий фоновой музыкой. Работает с двумя слотами `AudioSource` - `activeSource` и `stagingSource` - меняющимися ролями после каждого кросфейда.

### Три пути выполнения

Плеер выбирает один из трёх путей по состоянию загруженного плейлиста:

| Состояние плейлиста | Путь | Поведение |
|---|---|---|
| Пустой / null | No-op | Все публичные методы сразу возвращают управление; ничего не загружается |
| Один трек | Нативный loop | `AudioSource.loop = true`; кросфейд и авто-переход обходятся |
| Несколько треков | Crossfade loop | Следующий клип предзагружается через Addressables; авто-переход с кросфейдом |

Путь с одним треком важен для уровневой музыки с одним длинным ambient-треком - лупинг делегируется движку с нулевыми накладными расходами на кадр.

### Play / Stop / CrossfadeTo

```api
UniTask | Play() | нарастание громкости с 0 до цели
UniTask | Stop() | спад громкости до 0
UniTask | CrossfadeTo(MusicPlaylist playlist) | отмена текущего, запуск кросфейда
```

Все три - `async UniTask`-методы. Каждый вызов запускает новую сессию `CancellationTokenSource`, отменяя любой выполняющийся fade или crossfade до начала нового - операции не перекрываются.

### Цикл авто-перехода

Для многотрековых плейлистов после завершения fade-in `Play()` в фоне запускается `AutoAdvanceLoop` как `UniTask`. Следит за `activeSource.time` и при оставшемся времени равном `crossfadeDuration` начинает кросфейд к следующему треку. Во время кросфейда следующий трек загружается в `stagingSource`, его громкость нарастает пока `activeSource` угасает. По завершении источники меняются ролями и следующий трек сразу предзагружается.

### Конфигурация

ScriptableObject `MusicPlayerConfig` задаёт все тайминги:

| Поле | По умолчанию | Назначение |
|---|---|---|
| `fadeInDuration` | 1.5 с | Нарастание громкости с 0 до цели в `Play()` |
| `fadeOutDuration` | 1.5 с | Спад громкости до 0 в `Stop()` |
| `crossfadeDuration` | 2 с | Перекрытие уходящего и входящего треков |

<!-- 📸 Скриншот: компонент MusicPlayer в инспекторе с обоими AudioSource -->

---

## TrackSequencer и shuffle

`TrackSequencer` (реализующий `ITrackSequencer`) управляет порядком треков и лупингом.

- **Последовательный режим** - треки воспроизводятся в порядке из `MusicPlaylist.tracks`.
- **Shuffle-режим** - при `MusicPlaylist.shuffle = true` список перемешивается алгоритмом **Фишера-Йетса** через `IRandomService` в начале каждого цикла. Одна и та же последовательность не повторяется в двух соседних циклах.
- **Управление лупом** - при `MusicPlaylist.loop = false` `AutoAdvanceLoop` выходит после последнего трека без планирования нового кросфейда, музыка останавливается после финального fade-out.

`IsSingleTrack` предоставляется `TrackSequencer` и используется `MusicPlayer` для выбора быстрого пути с нативным лупом.

---

## TrackLoader и кеширование

`TrackPreLoader` (реализующий `ITrackLoader`) загружает ассеты `AudioClip` из Addressables асинхронно.

```csharp
public async UniTask<AudioClip> LoadAsync(
    AssetReferenceT<AudioClip> reference,
    CancellationToken ct)
```

Загруженные клипы кешируются по GUID ассета. Когда `AutoAdvanceLoop` вызывает `PreloadNext()`, следующий клип грузится пока в текущем треке ещё `crossfadeDuration` секунд - к началу кросфейда он уже в памяти. `ReleaseAll()` освобождает все загруженные хэндлы за один вызов - в `MusicPlayer.OnDestroy()` и перед каждым `CrossfadeTo()`.

---

## Fader

`Fader` (реализующий `IFader`) интерполирует громкость:

```csharp
public async UniTask Fade(
    AudioSource source,
    float from,
    float to,
    float duration,
    CancellationToken ct)
```

Громкость лерпируется покадрово через `ITimeService.UnscaledDeltaTime` - фейды не зависят от `Time.timeScale`, пауза не замораживает выполняющийся fade. `CancellationToken` позволяет немедленно прервать любой fade при запуске новой операции.

---

## Звуковые эффекты

### SoundList

`SoundList` - `ZenjexBehaviour`, реализующий `ISoundProvider`. Хранит `DictionaryData<SoundType, AudioClipGroup>` - маппинг типов звуковых событий на группы клипов.

```csharp
public AudioClip GetSound(SoundType soundType)
{
    if (soundClips.TryGetValue(soundType, out AudioClipGroup group))
        return group.TryGetRandom(_random);
    return null;
}
```

`AudioClipGroup` - простой массив `AudioClip`. `TryGetRandom` выбирает один случайно через `IRandomService` - шаги, удары, попадания звучат по-разному. Один `SoundType` может иметь 3-5 вариантов в группе.

### SoundPlayer

`SoundPlayer` - `ZenjexBehaviour` рядом с `SoundComponent` на акторе. Резолвит `ISoundProvider` из соседнего компонента и воспроизводит клипы через типизированные `AudioSource`-слоты:

```csharp
public async UniTask PlaySound(SoundType type, Action onSoundFinished = null)
{
    var sound = _soundProvider.GetSound(type);
    if (sound == null) return;

    if (soundComponent.SoundSources.TryGetValue(type, out AudioSource source))
    {
        source.clip = sound;
        soundComponent.PlaySound(type);
        await UniTask.WaitWhile(() => source.isPlaying, ..., _cancellationToken);
        onSoundFinished?.Invoke();
    }
}
```

`PlaySound` - awaitable-метод: вызывающий код может `await`-ить его чтобы знать точный момент завершения клипа. `_cancellationToken` привязан к `OnDestroy` компонента - ожидание отменяется при уничтожении актора.

<!-- 📸 Скриншот: компонент SoundList в инспекторе с DictionaryData SoundType -> AudioClipGroup -->

---

## SoundService - привязка громкости

`SoundService` (реализующий `ISoundService`) - единственный источник истины для громкостей:

```csharp
public ReactiveProperty<float> SoundVolumeRP { get; set; } = new(1f);
public ReactiveProperty<float> MusicVolumeRP { get; set; } = new(1f);
```

`MusicPlayer` подписывается на `MusicVolumeRP` в `Awake` и реактивно обновляет `_targetVolume` - без поллинга, без Update. SFX `AudioSource`-ы подписываются на `SoundVolumeRP` через `SoundComponent`. UI настроек просто пишет в эти свойства, изменения propagate автоматически.

Значения громкости персистируются в `SystemSettings`, отдельном от `GameProgress` объекте сохранения:

```csharp
public void ReadSettings(SystemSettings s)
{
    SoundVolumeRP.Value = s.SoundVolume;
    MusicVolumeRP.Value = s.MusicVolume;
}

public void WriteToSettings(SystemSettings s)
{
    s.SoundVolume = SoundVolumeRP.CurrentValue;
    s.MusicVolume = MusicVolumeRP.CurrentValue;
}
```

`SaveLoadService` всегда пишет `SystemSettings` при сохранении, вне зависимости от `isInitial` - настройки громкости переживают старты новых игр.

---

## MenuButtonSound

`MenuButtonSound` добавляет звук наведения и клика к кнопкам главного меню без подкласса или дополнительной настройки. Самодостаточный `MonoBehaviour` рядом с компонентом `Button`.

```csharp
public void OnPointerEnter(PointerEventData eventData)
{
    if (!button.interactable) return;
    PlayHoverSound().Forget();
}
```

Булевые флаги `_wasHovered` и `_wasPressed` останавливают стакинг звуков: если звук уже играет, повторный вызов сразу возвращает управление. Это корректно обрабатывает быстрые движения мыши и двойные клики.

`OnClickSoundFinished` (`Observable<Unit>`) - для случаев, когда нужно задержать переход сцены до завершения звука клика.
