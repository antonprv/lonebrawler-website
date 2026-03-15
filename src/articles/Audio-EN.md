# Audio System

## Table of Contents
- [Overview](#overview)
- [MusicPlayer](#musicplayer)
- [Track Sequencer & Shuffle](#track-sequencer--shuffle)
- [Track Loader & Caching](#track-loader--caching)
- [Fader](#fader)
- [Sound Effects](#sound-effects)
- [SoundService - volume binding](#soundservice---volume-binding)
- [MenuButtonSound](#menubuttonsound)

---

## Overview

The audio system has two independent subsystems:

- **Music** - a fully async multi-track player with crossfade, shuffle, and per-level playlist support.
- **SFX** - a component-level sound list mapped to randomised audio clip groups.

Both read their volume from `ISoundService` reactive properties, so a single settings slider updates all active audio in real time.

---

## MusicPlayer

`MusicPlayer` is a `ZenjexBehaviour` that manages background music. It works with two `AudioSource` slots - `activeSource` and `stagingSource` - that swap roles after every crossfade.

### Three performance paths

The player picks one of three paths based on the loaded playlist:

| Playlist state | Path | Behaviour |
|---|---|---|
| Empty / null | No-op | All public methods return immediately; nothing loads |
| Single track | Native loop | `AudioSource.loop = true`; crossfade and auto-advance are bypassed |
| Multiple tracks | Crossfade loop | Next clip pre-loaded via Addressables; auto-advance with crossfade |

The single-track path matters for level music that uses one long ambient track - it hands looping to the engine with zero per-frame overhead.

### Play / Stop / CrossfadeTo

```api
UniTask | Play() | fade in from 0 to target volume
UniTask | Stop() | fade out to 0
UniTask | CrossfadeTo(MusicPlaylist playlist) | cancel current, start new crossfade
```

All three are `async UniTask` methods. Each call starts a new `CancellationTokenSource` session, cancelling any in-flight fade or crossfade before the new one begins - no overlapping async operations.

### Auto-advance loop

For multi-track playlists, after `Play()` finishes its fade-in, `AutoAdvanceLoop` runs as a background `UniTask`. It watches `activeSource.time` and - when remaining playback equals `crossfadeDuration` - starts a crossfade to the next track. During the crossfade the next track loads into `stagingSource`, its volume fades up while `activeSource` fades down. When complete, sources swap and the following track pre-loads immediately.

### Configuration

`MusicPlayerConfig` ScriptableObject drives all timings:

| Field | Default | Purpose |
|---|---|---|
| `fadeInDuration` | 1.5 s | Volume rise from 0 to target on `Play()` |
| `fadeOutDuration` | 1.5 s | Volume fall to 0 on `Stop()` |
| `crossfadeDuration` | 2 s | Overlap between outgoing and incoming tracks |

<!-- 📸 Screenshot: MusicPlayer component in inspector showing both AudioSources -->

---

## Track Sequencer & Shuffle

`TrackSequencer` (implementing `ITrackSequencer`) manages track ordering and looping.

- **Sequential mode** - tracks play in the order listed in `MusicPlaylist.tracks`.
- **Shuffle mode** - when `MusicPlaylist.shuffle = true`, the track list is shuffled with **Fisher-Yates** via `IRandomService` at the start of every loop cycle. The same sequence never repeats across two consecutive loops.
- **Loop control** - when `MusicPlaylist.loop = false`, `AutoAdvanceLoop` exits after the last track without scheduling a new crossfade, and the music stops after the final fade-out.

`IsSingleTrack` is exposed by `TrackSequencer` and used by `MusicPlayer` to pick the native-loop fast path.

---

## Track Loader & Caching

`TrackPreLoader` (implementing `ITrackLoader`) handles async loading of `AudioClip` assets from Addressables.

```csharp
public async UniTask<AudioClip> LoadAsync(AssetReferenceT<AudioClip> reference, CancellationToken ct)
```

Loaded clips are cached by asset GUID. When `AutoAdvanceLoop` calls `PreloadNext()`, the next clip fetches while the current track still has `crossfadeDuration` seconds left - so it's already in memory when the crossfade begins. `ReleaseAll()` releases every loaded handle in one call, used on `MusicPlayer.OnDestroy()` and before each `CrossfadeTo()`.

---

## Fader

`Fader` (implementing `IFader`) interpolates volume:

```csharp
public async UniTask Fade(AudioSource source, float from, float to, float duration, CancellationToken ct)
```

Volume lerps frame-by-frame using `ITimeService.UnscaledDeltaTime`, so fades are unaffected by `Time.timeScale` - pausing the game doesn't freeze a running fade. The `CancellationToken` lets any in-progress fade abort immediately when a new operation starts.

---

## Sound Effects

### SoundList

`SoundList` is a `ZenjexBehaviour` that implements `ISoundProvider`. It holds a `DictionaryData<SoundType, AudioClipGroup>` mapping sound event types to clip groups.

```csharp
public AudioClip GetSound(SoundType soundType)
{
    if (soundClips.TryGetValue(soundType, out AudioClipGroup group))
        return group.TryGetRandom(_random);
    return null;
}
```

`AudioClipGroup` is a simple array of `AudioClip` references. `TryGetRandom` picks one at random through `IRandomService`, giving variance to repeated sounds - footsteps, sword swings, impact hits. The same `SoundType` can have 3-5 variants in its group to avoid mechanical repetition.

### SoundPlayer

`SoundPlayer` is a `ZenjexBehaviour` placed alongside a `SoundComponent` on an actor. It resolves `ISoundProvider` from the sibling component and plays clips through typed `AudioSource` slots:

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

`PlaySound` is awaitable - callers can `await` it to know exactly when the clip finishes. `_cancellationToken` is bound to the component's `OnDestroy`, so a pending await cancels automatically if the actor is destroyed mid-play.

<!-- 📸 Screenshot: SoundList component in inspector showing DictionaryData of SoundType to AudioClipGroup -->

---

## SoundService - volume binding

`SoundService` (implementing `ISoundService`) is the single source of truth for audio volumes:

```csharp
public ReactiveProperty<float> SoundVolumeRP { get; set; } = new(1f);
public ReactiveProperty<float> MusicVolumeRP { get; set; } = new(1f);
```

`MusicPlayer` subscribes to `MusicVolumeRP` on `Awake` and updates `_targetVolume` reactively - no polling, no Update calls. SFX `AudioSource`s subscribe to `SoundVolumeRP` through `SoundComponent`. The settings UI just writes to these properties and everything propagates automatically.

Volume values persist in `SystemSettings`, a save object separate from `GameProgress`:

```csharp
public void ReadSettings(SystemSettings s)    { SoundVolumeRP.Value = s.SoundVolume; MusicVolumeRP.Value = s.MusicVolume; }
public void WriteToSettings(SystemSettings s) { s.SoundVolume = SoundVolumeRP.CurrentValue; s.MusicVolume = MusicVolumeRP.CurrentValue; }
```

`SaveLoadService` always writes `SystemSettings` on save regardless of `isInitial` - volume preferences survive new game starts.

---

## MenuButtonSound

`MenuButtonSound` adds hover and click audio to main menu buttons without requiring a subclass or extra setup. It's a standalone `MonoBehaviour` placed alongside a `Button` component.

```csharp
public void OnPointerEnter(PointerEventData eventData)
{
    if (!button.interactable) return;
    PlayHoverSound().Forget();
}
```

`_wasHovered` and `_wasPressed` bools stop sound stacking: if the hover or click sound is already playing, a second call returns immediately. This handles rapid mouse movement and double-clicks without per-frame tracking.

`OnClickSoundFinished` (`Observable<Unit>`) is exposed for cases where the caller needs to delay a scene transition until the click sound finishes - for example, not loading the next scene before the button click plays out.
