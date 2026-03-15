# Собственные библиотеки и расширения

## Содержание
- [FastMath](#fastmath)
- [Сериализуемые векторные типы](#сериализуемые-векторные-типы)
- [Сериализуемые коллекции](#сериализуемые-коллекции)
- [UniTask Extensions](#unitask-extensions)
- [Functional Extensions](#functional-extensions)
- [Array Extensions](#array-extensions)
- [GameLogger](#gamelogger)
- [DrawDebugRuntime](#drawdebugruntime)
- [FilteredEnumAttribute](#filteredenumattribute)

---

## FastMath

`FastMath` - самодостаточная математическая библиотека в `Code.Common.FastMath`. Два бэкенда для разных контекстов: managed C# для общего использования, Burst-компилируемый для горячих путей.

### FMath - managed-бэкенд

`FMath` - `static partial class` с классическими fast-math алгоритмами.

#### Fast Inverse Square Root

Алгоритм быстрого обратного квадратного корня из Quake III Arena, с оригинальной магической константой:

```csharp
public static float FastInvSqrt(float x, bool prescise = false)
{
    const int MAGIC_NUMBER = 0x5f3759df;
    float xhalf = 0.5f * x;
    int i = FloatToInt32Bits(x);        // хакерские манипуляции с битами float
    i = MAGIC_NUMBER - (i >> 1);        // первый магический шаг
    x = Int32BitsToFloat(i);
    x = x * (1.5f - xhalf * x * x);    // одна итерация Ньютона-Рафсона

    if (prescise)
        x = x * (1.5f - xhalf * x * x);

    return x;
}
```

Битовая интерпретация через unsafe pointer casts - без аллокаций `BitConverter`:

```csharp
private static unsafe int FloatToInt32Bits(float value) => *(int*)&value;
private static unsafe float Int32BitsToFloat(int value)  => *(float*)&value;
```

#### Дополнительные методы

| Метод | Описание |
|---|---|
| `FastSqrt(float x)` | `x * FastInvSqrt(x)` - быстрее `Mathf.Sqrt` для приближённых вычислений |
| `FastNormalize(ref float x, ref float y, ref float z)` | Нормализация вектора in-place через `FastInvSqrt` |
| `FastLength(float x, float y, float z)` | Длина вектора через `FastInvSqrt` |
| `FastDistance(...)` | Расстояние между точками через `FastLength` |
| `DistanceSquared(...)` | Квадрат расстояния - без квадратного корня; для проверок `if (dist < r)` |
| `Clamp(float, float, float)` | Безветвенный зажим float |

**`DistanceSquared` - правильный выбор для проверок близости**: сравнение с порогом в квадрате пропускает вычисление квадратного корня - самая быстрая проверка расстояния из возможных.

### BurstMath - Burst-бэкенд

`BurstMath` - `[BurstCompile]`-класс, оборачивающий интринсики `Unity.Mathematics`. Все методы с `[MethodImpl(MethodImplOptions.AggressiveInlining)]`:

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

`BurstMath` - в системах внутри Burst-джобов. `FMath` - в обычной C#-логике там, где Burst недоступен.

### FastMathExtensions

Методы расширения на `Vector3` и `float3`, оборачивающие вызовы `FMath`:

```csharp
public static float FastMagnitude(this Vector3 v)    => FMath.FastLength(v.x, v.y, v.z);
public static Vector3 FastNormalized(this Vector3 v) => ...;
public static float SqrDistanceTo(this Vector3 a, Vector3 b) => FMath.DistanceSquared(...);
```

<!-- 📸 Скриншот: результаты перфоманс-тестов FastMath vs Mathf.Sqrt в Unity Test Runner -->

---

## Сериализуемые векторные типы

`Vector3`, `Quaternion` и `Transform` от Unity не сериализуются в JSON по умолчанию. Проект определяет кастомные аналоги для системы сохранений и статических данных.

### Vector3Data

```csharp
[Serializable]
public class Vector3Data { public float X, Y, Z; }
```

Поставляется с `PropertyDrawer`, совпадающим с нативным полем Unity `Vector3` - `x`, `y`, `z` на одной строке. Расширения: `ToVector3()`, `ToVector3Data()`, `ToFloat3()`.

### QuatData

```csharp
[Serializable]
public class QuatData { public float X, Y, Z, W; }
```

`QuatComplex` обрабатывает операции с комплексными числами для эффективного slerp без инстанцирования `Quaternion`. Расширения: `ToQuaternion()`, `ToQuatData()`.

### TransformData

Объединяет `Vector3Data Position`, `QuatData Rotation` и `Vector3Data Scale`. Используется в `PlayerWorldData` и любом персистированном трансформе. `PropertyDrawer` сворачивается в одну строку или разворачивается в три подполя.

### Coordinates

Как `TransformData`, но без масштаба - для позиций точек спауна в `LevelStaticData` и позиций лута в `SoulsCollected`. `PropertyDrawer` имеет кнопку "Copy from Scene Object", читающую трансформ выбранного объекта в SceneView и заполняющую поля.

### Расширения конвертации

`UnityConversionExtensions` покрывает полную поверхность конвертации:

```csharp
TransformData ToTransformData(this Transform t)
Coordinates   ToCoordinates(this Transform t)
void          ApplyTo(this TransformData d, Transform t)
```

---

## Сериализуемые коллекции

`DictionaryData<TKey, TValue>` и `HashSetData<T>` подробно разобраны в [Система сохранений - Сериализуемые коллекции](Save-System-RU#сериализуемые-коллекции).

Кратко: оба расширяют BCL-аналоги, реализуют `ISerializationCallbackReceiver` для синхронизации backing-листов, поставляются с `PropertyDrawer`. `DictionaryData` дополнительно предоставляет `ForceSerialization()` для редакторного кода.

---

## UniTask Extensions

Находится в `Code.Common.Extensions.UniTaskExtensions`.

Оператор `await` нельзя применить к `null`-выражению напрямую. Расширение добавляет `GetAwaiter()` для нуллабельных UniTask-типов:

```csharp
public static UniTask.Awaiter GetAwaiter(this UniTask? task)
    => (task ?? UniTask.CompletedTask).GetAwaiter();

public static UniTask<T>.Awaiter GetAwaiter<T>(this UniTask<T>? task)
    => (task ?? UniTask.FromResult(default(T))).GetAwaiter();
```

Null-conditional await работает чисто:

```csharp
await _service?.LoadAsync();           // UniTask? - завершается мгновенно если null
var result = await _repo?.GetAsync();  // UniTask<T>? - возвращает default(T) если null
```

Используется везде в слое фабрики и сервисов, где опциональные сервисы могут отсутствовать в некоторых конфигурациях.

---

## Functional Extensions

Находится в `Code.Common.Extensions.FunctionalExtensions`.

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

Fluent-инициализация без отдельного builder-класса:

```csharp
var config = new EnemyConfig()
    .With(c => c.MaxHealth = 100f)
    .With(c => c.AttackDamage = 15f)
    .With(c => c.IsElite = true, when: isElite);

var go = new GameObject("Enemy")
    .With(g => g.layer = enemyLayer)
    .With(g => g.tag = "Enemy");
```

Условный overload (`when: bool`) убирает `if`-выражения из цепочек, код фабрики остаётся линейным.

---

## Array Extensions

Находится в `Code.Common.Extensions.ArrayExtensions`.

```csharp
public static void Empty<T>(this T[] array) where T : class
{
    if (array == null) return;
    Array.Clear(array, 0, array.Length);
}
```

Null-safe обёртка `Array.Clear` для массивов ссылочных типов. Устанавливает все элементы в `null` без выделения нового массива. Используется когда пулированный массив нужно очистить перед возвратом в пул.

---

## GameLogger

Находится в `Code.Common.Logging.GameLogger`.

`GameLogger` (реализующий `IGameLog`) добавляет `[ClassName.MethodName]` к каждому сообщению через рефлексию `StackFrame`:

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

Всё тело метода внутри compile-time условия. В `Shipping`-сборках (оба символа не определены) метод компилируется в ничто - нулевые накладные расходы в продакшне.

`LogValue<TProperty, TValue>` - для логирования изменений свойств:

```csharp
_logger.LogValue(_speed, newSpeed);
// Вывод: "Log [PlayerMove.SetSpeed] Set _speed to 12.5"
```

`IGameLog` инжектируется через DI - тесты подставляют мок, захватывающий вызовы для assertion без записи в консоль Unity.

---

## DrawDebugRuntime

Находится в `Code.Common.DebugUtils.DrawDebugRuntime`.

Рисует отладочные фигуры в рантайме, не только в редакторе. `DrawSphere`, `DrawWireCube`, `DrawLine`, `DrawRay` - через `GL` immediate mode, рендерятся в Editor Play Mode и development-сборках.

Все методы внутри `#if DEVELOPMENT_BUILD || UNITY_EDITOR`, в Shipping компилируются в ничто - паттерн идентичен `GameLogger`.

---

## FilteredEnumAttribute

Находится в `Code.Common.Attributes.FilteredEnumAttribute`.

`PropertyAttribute`, убирающий конкретные значения из enum-дропдауна в инспекторе:

```csharp
[FilteredEnum(DebugConfiguration.None)]
public DebugConfiguration DebugConfiguration = DebugConfiguration.Development;
```

Сопутствующий `FilteredEnumDrawer` (`PropertyDrawer`) строит отфильтрованный `GUIContent[]`, исключающий указанное значение из popup. Конфиг не останется в состоянии сентинела `None`, обычно означающем "не настроено".

Применяется к `GameBuildData.DebugConfiguration` и `GameBuildData.TargetPlatform`.
