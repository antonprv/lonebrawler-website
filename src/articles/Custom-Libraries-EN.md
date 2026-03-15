# Custom Libraries & Extensions

## Table of Contents
- [FastMath](#fastmath)
- [Serialisable Vector Types](#serialisable-vector-types)
- [Serialisable Collections](#serialisable-collections)
- [UniTask Extensions](#unitask-extensions)
- [Functional Extensions](#functional-extensions)
- [Array Extensions](#array-extensions)
- [GameLogger](#gamelogger)
- [DrawDebugRuntime](#drawdebugruntime)
- [FilteredEnumAttribute](#filteredenumattribute)

---

## FastMath

`FastMath` is a standalone math utility library in `Code.Common.FastMath`. Two backends cover different contexts: managed C# for general use, Burst-compiled for hot paths.

### FMath - managed backend

`FMath` is a `static partial class` implementing classic fast-math algorithms.

#### Fast Inverse Square Root

The Quake III Arena fast inverse square root algorithm, complete with the original magic constant:

```csharp
public static float FastInvSqrt(float x, bool prescise = false)
{
    const int MAGIC_NUMBER = 0x5f3759df;
    float xhalf = 0.5f * x;
    int i = FloatToInt32Bits(x);        // evil floating point bit-level hack
    i = MAGIC_NUMBER - (i >> 1);        // first magic step
    x = Int32BitsToFloat(i);
    x = x * (1.5f - xhalf * x * x);    // one Newton-Raphson iteration

    if (prescise)
        x = x * (1.5f - xhalf * x * x);

    return x;
}
```

Bit reinterpretation uses unsafe pointer casts to avoid `BitConverter` allocation:

```csharp
private static unsafe int FloatToInt32Bits(float value) => *(int*)&value;
private static unsafe float Int32BitsToFloat(int value)  => *(float*)&value;
```

#### Additional methods

| Method | Description |
|---|---|
| `FastSqrt(float x)` | `x * FastInvSqrt(x)` - faster than `Mathf.Sqrt` for approximate use |
| `FastNormalize(ref float x, ref float y, ref float z)` | In-place vector normalisation via `FastInvSqrt` |
| `FastLength(float x, float y, float z)` | Vector length via `FastInvSqrt` |
| `FastDistance(...)` | Distance between two points via `FastLength` |
| `DistanceSquared(...)` | Squared distance - no square root at all; use for `if (dist < r)` checks |
| `Clamp(float, float, float)` | Branchless float clamp |

**`DistanceSquared` is the right choice for proximity checks** - comparing against a squared threshold skips the square root entirely and is the fastest possible distance test.

### BurstMath - Burst backend

`BurstMath` is a `[BurstCompile]` static class wrapping `Unity.Mathematics` intrinsics. All methods use `[MethodImpl(MethodImplOptions.AggressiveInlining)]`:

```csharp
[BurstCompile]
public static class BurstMath
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float BurstInvSqrt(float x)                    => math.rsqrt(x);
    public static float BurstSqrt(float x)                       => math.sqrt(x);
    public static float BurstDistanceSquared(float3 a, float3 b) => math.dot(b - a, b - a);
    public static float BurstDistance(float3 a, float3 b)        => math.distance(a, b);
    public static float3 BurstNormalize(float3 v)                => math.normalize(v);
}
```

`BurstMath` goes into systems running inside Burst jobs. `FMath` goes into regular C# game logic where Burst isn't available.

### FastMathExtensions

Extension methods on `Vector3` and `float3` wrapping `FMath` calls:

```csharp
public static float FastMagnitude(this Vector3 v)    => FMath.FastLength(v.x, v.y, v.z);
public static Vector3 FastNormalized(this Vector3 v) => ...;
public static float SqrDistanceTo(this Vector3 a, Vector3 b) => FMath.DistanceSquared(...);
```

<!-- 📸 Screenshot: Performance test results comparing FastMath vs Mathf.Sqrt in Unity Test Runner -->

---

## Serialisable Vector Types

Unity's `Vector3`, `Quaternion`, and `Transform` don't serialise to JSON by default. The project defines custom serialisable counterparts used throughout the save system and static data.

### Vector3Data

```csharp
[Serializable]
public class Vector3Data { public float X, Y, Z; }
```

Ships with a `PropertyDrawer` matching Unity's native `Vector3` field - `x`, `y`, `z` on one line. Extensions: `ToVector3()`, `ToVector3Data()`, `ToFloat3()`.

### QuatData

```csharp
[Serializable]
public class QuatData { public float X, Y, Z, W; }
```

`QuatComplex` handles complex number operations for efficient slerp without instantiating `Quaternion`. Extensions: `ToQuaternion()`, `ToQuatData()`.

### TransformData

Combines `Vector3Data Position`, `QuatData Rotation`, and `Vector3Data Scale`. Used for `PlayerWorldData` and any persisted `GameObject` transform. The `PropertyDrawer` collapses to a single inspector row or expands to show all three sub-fields.

### Coordinates

Like `TransformData` but without scale - used for spawn point positions in `LevelStaticData` and loot positions in `SoulsCollected`. Its `PropertyDrawer` has a "Copy from Scene Object" button that reads the selected object's transform in the SceneView and fills in the fields.

### Conversion extensions

`UnityConversionExtensions` covers the full conversion surface:

```csharp
TransformData ToTransformData(this Transform t)
Coordinates   ToCoordinates(this Transform t)
void          ApplyTo(this TransformData d, Transform t)
```

---

## Serialisable Collections

`DictionaryData<TKey, TValue>` and `HashSetData<T>` are covered in depth in [Save System - Serialisable Collections](Save-System-EN#serialisable-collections).

Short version: both extend their BCL counterparts, implement `ISerializationCallbackReceiver` to maintain backing lists, and ship with `PropertyDrawer` implementations. `DictionaryData` additionally exposes `ForceSerialization()` for Editor-side code.

---

## UniTask Extensions

Located in `Code.Common.Extensions.UniTaskExtensions`.

The `await` operator can't be applied to a `null` expression directly. This extension adds `GetAwaiter()` overloads for nullable UniTask types:

```csharp
public static UniTask.Awaiter GetAwaiter(this UniTask? task)
    => (task ?? UniTask.CompletedTask).GetAwaiter();

public static UniTask<T>.Awaiter GetAwaiter<T>(this UniTask<T>? task)
    => (task ?? UniTask.FromResult(default(T))).GetAwaiter();
```

This makes null-conditional await work cleanly:

```csharp
await _service?.LoadAsync();           // UniTask? - completes immediately if null
var result = await _repo?.GetAsync();  // UniTask<T>? - returns default(T) if null
```

Used throughout the factory and service layer wherever optional services may not be present in all configurations.

---

## Functional Extensions

Located in `Code.Common.Extensions.FunctionalExtensions`.

```csharp
public static T With<T>(this T self, Action<T> set)
{
    set.Invoke(self);
    return self;
}

public static T With<T>(this T self, Action<T> apply, bool when)
{
    if (when)
        apply?.Invoke(self);
    return self;
}
```

Enables fluent setup without a dedicated builder class:

```csharp
var config = new EnemyConfig()
    .With(c => c.MaxHealth = 100f)
    .With(c => c.AttackDamage = 15f)
    .With(c => c.IsElite = true, when: isElite);

var go = new GameObject("Enemy")
    .With(g => g.layer = enemyLayer)
    .With(g => g.tag = "Enemy");
```

The conditional overload (`when: bool`) removes `if` statements from chains, keeping factory code linear.

---

## Array Extensions

Located in `Code.Common.Extensions.ArrayExtensions`.

```csharp
public static void Empty<T>(this T[] array) where T : class
{
    if (array == null) return;
    Array.Clear(array, 0, array.Length);
}
```

A null-safe `Array.Clear` wrapper for reference-type arrays. Sets all elements to `null` without allocating a new array. Used when a pooled array needs clearing before returning to the pool.

---

## GameLogger

Located in `Code.Common.Logging.GameLogger`.

`GameLogger` (implementing `IGameLog`) prepends `[ClassName.MethodName]` to every message via `StackFrame` reflection:

```csharp
public void Log(string message)
{
#if DEVELOPMENT_BUILD || UNITY_EDITOR
    StackFrame frame = new(1);
    MethodBase callingMethod = frame.GetMethod();
    Type callerType = callingMethod?.DeclaringType;
    ULog.Log($"Log [{callerType.Name}.{callingMethod.Name}] {message}");
#endif
}
```

The entire method body is inside a compile-time conditional. In `Shipping` builds (`DEVELOPMENT_BUILD` and `UNITY_EDITOR` both undefined) the method compiles to nothing - zero runtime overhead in production.

`LogValue<TProperty, TValue>` is for property change logging:

```csharp
_logger.LogValue(_speed, newSpeed);
// Output: "Log [PlayerMove.SetSpeed] Set _speed to 12.5"
```

`IGameLog` is injected via DI, so tests can supply a mock that captures log calls for assertion without writing to the Unity console.

---

## DrawDebugRuntime

Located in `Code.Common.DebugUtils.DrawDebugRuntime`.

Draws debug shapes at runtime (not just in the Editor). `DrawSphere`, `DrawWireCube`, `DrawLine`, `DrawRay` - all via `GL` immediate mode, so they render in both Editor Play Mode and development builds.

All methods are inside `#if DEVELOPMENT_BUILD || UNITY_EDITOR` and compile to nothing in Shipping - same pattern as `GameLogger`.

---

## FilteredEnumAttribute

Located in `Code.Common.Attributes.FilteredEnumAttribute`.

A `PropertyAttribute` that removes specific values from an enum dropdown in the Inspector:

```csharp
[FilteredEnum(DebugConfiguration.None)]
public DebugConfiguration DebugConfiguration = DebugConfiguration.Development;
```

The companion `FilteredEnumDrawer` (`PropertyDrawer`) builds a filtered `GUIContent[]` that excludes the specified value from the popup. This stops a config from being left in the `None` sentinel state, which usually means "not configured".

Applied to `GameBuildData.DebugConfiguration` and `GameBuildData.TargetPlatform`.
