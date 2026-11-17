# `require("effects")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`effects` provides the mutable `TemporaryEntity` staging object used by the root effect helpers. It resolves configured profile aliases to sendprop paths, converts typed values, and runs managed hooks around creation through the selected SDK. Constructing or editing a staging object is separate from requesting creation; field resolution alone does not prove that a request is valid for the running engine.

`TemporaryEntity.Values` is mutable JavaScript staging state, not a native-memory snapshot. A request can be cancelled by a pre-create hook or fail before playback. On the native path, after size validation, the implementation allocates fresh zeroed sender storage, applies supplied properties, validates recipients and options, and calls `IVEngineServer::PlaybackTempEntity`. Its `true` result reports that the void playback call returned, not client delivery or visibility. Post-create callback errors can still propagate after playback.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`TemporaryEntity`](#temporaryentity)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/effects/index.js`](../../packages/sourcejs/effects/index.js) implements `TemporaryEntity` staging and the managed creation path. [`packages/sourcejs/effects/templates.js`](../../packages/sourcejs/effects/templates.js) owns field resolution, while [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) owns the native sender called by the shared template.

Use this API when a plugin must stage readable temporary-entity fields, inspect or replace staged values, run managed hooks, and send the resulting effect through the selected SDK.

## Import

```js
const { TemporaryEntity, CreateTemporaryEntity } = require("effects");
```

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`TemporaryEntity`](#temporaryentity) | `new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues = {})` | Resolves a template and stages supplied own enumerable string-keyed properties through setters. Construction can throw and does not request playback. |
| `CreateTemporaryEntity` | `CreateTemporaryEntity(strTemporaryEntityName, PropertyValues = {}, Recipients?, flEffectDelay = 0, bReliableDelivery = false)` | Constructs a new staging object and delegates to its managed creation method. Returns `false` on pre-hook cancellation or a falsy template result, `true` after post-hooks complete; failures can throw, including after playback. |

## `TemporaryEntity`

### Fields

| Field | Meaning |
| --- | --- |
| `Template` | Shared template resolved during construction, subsequently used for field resolution, hooks and creation. |
| `Name` | Name copied from the resolved template during construction; not a live getter or an engine-validated rename operation. |
| `ClassName` | Server class name copied from that template during construction; not recomputed when public fields change. |
| `Values` | Mutable staging object initialized during construction. Creation passes its then-current contents to the template after pre-hooks; cancellation or failure can prevent playback. |

These are writable JavaScript properties, not immutable identity or ownership guarantees. Changing a copied name does not select another template. Directly replacing the template or staging object bypasses constructor/setter checks and can leave inconsistent state; prefer the documented operations. Neither retained staging data nor a template reference proves that the running engine still supports the request.

### General methods

| Method | Signature | Result |
| --- | --- | --- |
| [`HasTemporaryEntityProperty`](#hastemporaryentitypropertystrpropertyname) | `HasTemporaryEntityProperty(strPropertyName)` | Whether template resolution recognizes the name or staging has that exact own key. Does not prove a staged value exists for a recognized profile alias or validate playback. |
| `GetTemporaryEntityProperty` | `GetTemporaryEntityProperty(strPropertyName)` | Resolves a descriptor and delegates to the corresponding property/typed reader; otherwise performs ordinary staging-object property lookup, which can return `undefined` or an inherited value. Not a live native-memory read. |
| [`SetTemporaryEntityProperty`](#settemporaryentitypropertystrpropertyname-propertyvalue-and-gettemporaryentitypropertystrpropertyname) | `SetTemporaryEntityProperty(strPropertyName, PropertyValue)` | Resolves and converts a recognized field, or directly assigns an unresolved name in staging; returns this object. Resolution/conversion can throw. Does not request playback. |
| `CreateTemporaryEntity` | `CreateTemporaryEntity(Recipients?, flEffectDelay = 0, TemporaryEntityValues?, bReliableDelivery = false)` | Applies supplied value updates before pre-hooks; returns `false` on cancellation or a falsy template result, otherwise invokes post-hooks and returns `true`. Exceptions propagate and updates are not rolled back on cancellation/failure. |

### Typed accessors

| Getter | Setter | Conversion |
| --- | --- | --- |
| `GetTemporaryEntityPropertyBoolean(strPropertyName)` | `SetTemporaryEntityPropertyBoolean(strPropertyName, PropertyValue)` | Applies `Boolean` on read/write; nonempty strings such as `"false"` are truthy. |
| `GetTemporaryEntityPropertyFloat(strPropertyName)` | `SetTemporaryEntityPropertyFloat(strPropertyName, PropertyValue)` | Getter applies `Number` after replacing nullish values with `0`; setter applies `Number` directly. Neither wrapper checks finiteness or native float range. |
| `GetTemporaryEntityPropertyInteger(strPropertyName)` | `SetTemporaryEntityPropertyInteger(strPropertyName, PropertyValue)` | Applies `Number.parseInt(..., 10)`; getter replaces nullish values with `0` first. Accepts numeric prefixes, can yield `NaN`, and does not enforce a native integer range. |
| `GetTemporaryEntityPropertyString(strPropertyName)` | `SetTemporaryEntityPropertyString(strPropertyName, PropertyValue)` | Getter maps nullish values to `""`, otherwise uses `String`; setter always uses `String`, including for `null` and `undefined`. |
| `GetTemporaryEntityPropertyVector(strPropertyName)` | `SetTemporaryEntityPropertyVector(strPropertyName, PropertyValue)` | Delegates unchanged to general read/write; vector conversion depends on the resolved descriptor, not the accessor name. |
| `GetTemporaryEntityPropertyArray(strPropertyName)` | `SetTemporaryEntityPropertyArray(strPropertyName, PropertyValue)` | Getter requires an actual array and returns that array without copying. Setter requires a truthy iterable, passes arrays unchanged, otherwise uses `Array.from`, then delegates to general write. |

Validate application values before calling these methods. Coercions can throw or run user-defined conversion/iteration code; setters subsequently perform the general descriptor-driven write and return this object. `SetTemporaryEntityProperty()` skips the accessor's preliminary coercion, not descriptor conversion or validation. Array access does not promise an isolated copy, and these wrappers do not establish that native playback will accept the result.

Profile `ValueType` discriminators use compact lowercase: `"color"`, `"decal"`, `"entity"`, `"model"`, `"player"`, `"qangle"`, and `"vector"`. String model and decal inputs use the indexes returned by `PrecacheModel()` and `PrecacheDecal()`. A model index must be positive; a decal index may be zero. These writes do not create resource wrappers or listeners. Reads resolve the stored index through `modelprecache` or `decalprecache` and return a `ModelPrecacheResource` or `DecalPrecacheResource`. Call `Unload()` when you no longer need that wrapper. Entity and player reads resolve stored indices through their factories. These conversions can fail and are not pure JavaScript casts. Ordinary property descriptors whose sendprop type contains `vector` also use vector conversion.

## Examples

### Constructing `TemporaryEntity`

Create a reusable `BeamPoints` staging object with the current SDK's profiles. This does not request playback, but descriptor conversion can resolve resources through other modules; use an initialized server context with the model available. Reuse requires that its template and referenced resources remain valid:

```js
const { TemporaryEntity } = require("effects");
const { Color } = require("colors");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints", {
	Color: new Color(50, 190, 255, 255),
	EndWidth: 3,
	LifeTime: 1,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 3,
});
console.log({ TemporaryEntityClassName: g_BeamTemporaryEntity.ClassName, TemporaryEntityName: g_BeamTemporaryEntity.Name, StagedPropertyNames: Object.keys(g_BeamTemporaryEntity.Values) });
```

Construction requires a nonempty string name and a non-null, non-array object for values. Unknown-template lookup, profile loading, enumeration/getters, and descriptor conversion can throw. An unresolved property name is staged directly, so constructor success is not exhaustive field or playback validation.

### `HasTemporaryEntityProperty(strPropertyName)`

Check whether a fresh staging object's template recognizes the endpoint aliases. This does not stage endpoints or prove that their values and native paths will pass creation-time checks:

```js
const { TemporaryEntity } = require("effects");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints");
if (!g_BeamTemporaryEntity.HasTemporaryEntityProperty("StartPoint") || !g_BeamTemporaryEntity.HasTemporaryEntityProperty("EndPoint")) {
	throw new Error("The BeamPoints template does not recognize both endpoint aliases.");
}
```

An unresolved name can become an own staging key after `SetTemporaryEntityProperty()`, making `HasTemporaryEntityProperty()` return `true` without a template descriptor. If that key reaches native property application and no sendprop resolves it, application throws before playback. A pre-hook can cancel or change staging first; presence is not a native validity guarantee.

### `SetTemporaryEntityProperty(strPropertyName, PropertyValue)` and `GetTemporaryEntityProperty(strPropertyName)`

Write profile aliases and read converted staging values back. This example needs the running SDK's BeamPoints descriptors but does not request playback; the returned vector/color wrappers are not live engine-memory views:

```js
const { TemporaryEntity } = require("effects");
const { Color } = require("colors");
const { Vector } = require("mathlib");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints");
g_BeamTemporaryEntity.SetTemporaryEntityProperty("StartPoint", new Vector(0, 0, 64));
g_BeamTemporaryEntity.SetTemporaryEntityProperty("EndPoint", new Vector(256, 0, 64));
g_BeamTemporaryEntity.SetTemporaryEntityProperty("Color", new Color(255, 80, 40, 255));

const g_BeamStartPoint = g_BeamTemporaryEntity.GetTemporaryEntityProperty("StartPoint");
const g_BeamColor = g_BeamTemporaryEntity.GetTemporaryEntityProperty("Color");
console.log({ BeamColorChannels: g_BeamColor.ConvertColorToArray(), BeamStartPointCoordinates: g_BeamStartPoint.ConvertMathStructureToArray() });
```

`SetTemporaryEntityProperty()` returns the same instance for deliberate chaining; if a later setter fails, earlier staged updates remain. For an unresolved field, `GetTemporaryEntityProperty()` performs ordinary property lookup and can return `undefined` or an inherited value. Do not use that fallback as an own-key check or native-field validation.

### Boolean, float, and integer accessors

Observe accessor coercion on BeamPoints staging fields without requesting playback. Assigning boolean `true` to `Flags` demonstrates conversion only; it is not a named bitmask operation or a recommendation for a particular effect flag:

```js
const { TemporaryEntity } = require("effects");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints");
g_BeamTemporaryEntity.SetTemporaryEntityPropertyBoolean("Flags", true);
g_BeamTemporaryEntity.SetTemporaryEntityPropertyFloat("LifeTime", "1.25");
g_BeamTemporaryEntity.SetTemporaryEntityPropertyInteger("StartFrame", "4");

console.log({ BeamFlagsTruthy: g_BeamTemporaryEntity.GetTemporaryEntityPropertyBoolean("Flags"), BeamLifetime: g_BeamTemporaryEntity.GetTemporaryEntityPropertyFloat("LifeTime"), BeamStartFrame: g_BeamTemporaryEntity.GetTemporaryEntityPropertyInteger("StartFrame") });
```

Before requesting creation, validate the input and converted value against the target sendprop's type, range and flag semantics. Coercion is not strict parsing: for example, the integer wrapper accepts a numeric prefix and can produce `NaN`. Successful staging alone does not establish native validity.

### String accessors

Check the resolved sendprop's reported type before applying string coercion. The native metadata spells this type `"string"`, not `"String"`. This helper operates on an existing staging object and does not request playback or validate string capacity, encoding, or later native acceptance:

```js
function SetTemporaryEntityStringProperty(TemporaryEntity, strPropertyName, PropertyValue) {
	const PropertyDescriptor = TemporaryEntity.Template.FindTemporaryEntityProperty(strPropertyName);
	if (!PropertyDescriptor || (PropertyDescriptor.Type !== "string")) {
		throw new TypeError(`Temporary-entity field is not a string: ${strPropertyName}`);
	}

	TemporaryEntity.SetTemporaryEntityPropertyString(strPropertyName, PropertyValue);

	return TemporaryEntity.GetTemporaryEntityPropertyString(strPropertyName);
}
```

`GetTemporaryEntityPropertyString()` returns an empty string for `null` or `undefined`; `SetTemporaryEntityPropertyString()` uses JavaScript string conversion.

### Vector accessors

Stage endpoint coordinates through the BeamPoints vector descriptors and read their `Vector` representations. The accessor name alone does not enforce vector conversion; this example requires matching profile/native descriptors and does not request playback:

```js
const { TemporaryEntity } = require("effects");
const { Vector } = require("mathlib");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints");
g_BeamTemporaryEntity.SetTemporaryEntityPropertyVector("StartPoint", new Vector(16, 32, 64));
g_BeamTemporaryEntity.SetTemporaryEntityPropertyVector("EndPoint", { X: 256, Y: 32, Z: 64 });

const g_BeamStartPoint = g_BeamTemporaryEntity.GetTemporaryEntityPropertyVector("StartPoint");
const g_BeamEndPoint = g_BeamTemporaryEntity.GetTemporaryEntityPropertyVector("EndPoint");
console.log(`${g_BeamStartPoint.X},${g_BeamStartPoint.Y},${g_BeamStartPoint.Z} -> ${g_BeamEndPoint.X},${g_BeamEndPoint.Y},${g_BeamEndPoint.Z}`);
```

On this descriptor-driven path, setters store converted coordinate arrays and reads construct vectors from them; editing a returned vector does not write those coordinates back. Call `SetTemporaryEntityPropertyVector()` again to update staging. Do not generalize this to arbitrary manually injected values: the mathlib factory can return an existing `Vector` unchanged, and unresolved fields bypass descriptor conversion.

### Array accessors

Check a resolved sendprop's reported `"array"` type before using the array accessor. This helper does not check capacity or element validity and does not request playback:

```js
function SetTemporaryEntityArrayProperty(TemporaryEntity, strPropertyName, PropertyValue) {
	const PropertyDescriptor = TemporaryEntity.Template.FindTemporaryEntityProperty(strPropertyName);
	if (!PropertyDescriptor || (PropertyDescriptor.Type !== "array")) {
		throw new TypeError(`Temporary-entity field is not an array: ${strPropertyName}`);
	}

	TemporaryEntity.SetTemporaryEntityPropertyArray(strPropertyName, PropertyValue);

	return TemporaryEntity.GetTemporaryEntityPropertyArray(strPropertyName);
}
```

The accessor requires a truthy iterable: for example, an empty string is rejected even though it is iterable. Arrays are passed unchanged to the general setter; other iterables are materialized with `Array.from` before descriptor processing. Iteration and conversion can throw. The getter requires an array result and does not copy it; a getter failure after setting does not undo the write. Validate element values and capacity against the actual sendprop before requesting creation.

### `CreateTemporaryEntity(Recipients?, flEffectDelay = 0, TemporaryEntityValues?, bReliableDelivery = false)`

Keep a staging object and update endpoint values for a creation request. Run only with an initialized server, available BeamPoints profiles/model, and a valid connected recipient at index `1`. The reliable-delivery option is a request to the native recipient filter, not an acknowledgement of client delivery:

```js
const { TemporaryEntity } = require("effects");
const { Vector } = require("mathlib");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints", { LifeTime: 0.75, Model: "materials/sprites/laserbeam.vmt", StartWidth: 2 });
const g_bBeamTemporaryEntityCreated = g_BeamTemporaryEntity.CreateTemporaryEntity(
	[1], 0,
	{
		EndPoint: new Vector(192, 0, 72),
		StartPoint: new Vector(0, 0, 72),
	},
	true);
if (!g_bBeamTemporaryEntityCreated) {
	throw new Error("BeamPoints creation returned false; a pre-create hook may have cancelled it.");
}
```

When supplied, `TemporaryEntityValues` must be a non-null, non-array object; own enumerable string-keyed entries are applied through setters before pre-hooks. Updates are not atomic or temporary: successful earlier writes remain after a later error or cancellation. Omitted/nullish native recipients use the runtime's player collection. A non-nullish native delay is numerically coerced, then checked for finiteness and float range; non-nullish reliability must be boolean. The managed method returns `false` on cancellation or a falsy template result, and can throw before or after playback. Retaining the staging object does not guarantee template/resource validity across engine lifecycle changes.

### `CreateTemporaryEntity(strTemporaryEntityName, PropertyValues = {}, Recipients?, flEffectDelay = 0, bReliableDelivery = false)`

Request one effect without retaining the staging object in this example. Use an initialized server with valid profiles/model and a connected recipient at index `1`. Unlike the instance method, this helper takes the name and initial values before recipients; omitted delay/reliability use their defaults:

```js
const { CreateTemporaryEntity } = require("effects");
const { Vector } = require("mathlib");

const g_bBeamTemporaryEntityCreated = CreateTemporaryEntity(
	"BeamPoints",
	{
		EndPoint: new Vector(0, 192, 72),
		LifeTime: 0.5,
		Model: "materials/sprites/laserbeam.vmt",
		StartPoint: new Vector(0, 0, 72),
		StartWidth: 2,
	},
	[1]);
if (!g_bBeamTemporaryEntityCreated) {
	throw new Error("BeamPoints creation returned false; a pre-create hook may have cancelled it.");
}
```

The helper constructs a new `TemporaryEntity` and delegates to its creation method: constructor/profile failures can precede hook dispatch, and post-hook exceptions can follow playback. A `false` result covers cancellation or a falsy template result; `true` is not delivery confirmation. Hooks receive the staging object and can retain it, so this convenience API does not guarantee that the object becomes unreachable when the call returns.

## Errors and lifecycle

- Construct, edit, read, and create effects in the initialized server/game-thread context. Managed setters and hooks run synchronously on their caller; this API does not schedule work or await callback promises. Do not move staging/template operations to an IO worker thread.
- Use a native temporary-entity name such as `BeamPoints`, not its server class name such as `CTEBeamPoints`.
- Check `HasTemporaryEntityProperty()` before relying on SDK-specific fields. A custom staged key can exist in `Values` even when no native sendprop accepts it.
- Treat `Values` as persistent mutable state. Per-send overrides remain staged for later calls until they are replaced.
- Validate converted scalar values before creation. String-to-number helpers can produce values that the native sendprop rejects.
- Omit `Recipients` only when the native default player collection is intended; pass explicit valid recipients when targeting is required. Hook code receives the original argument before native recipient validation.
- Managed pre/post hooks run through `TemporaryEntity.CreateTemporaryEntity()` and the root helper. Direct `TemporaryEntityTemplate.CreateTemporaryEntity()` calls bypass them.
- Creation is not transactional: earlier staging updates survive later setter errors or cancellation. A post-hook can throw after playback, and `true` does not acknowledge client delivery.
- Do not use public names, template references, or staged values as lifetime/ownership guarantees. Reassess template and resource validity when the engine lifecycle changes; retained JavaScript state alone is insufficient.
- General unresolved-property lookup can read inherited values, while `HasTemporaryEntityProperty()` checks own staging keys only for unresolved names; recognized profile fields report template recognition even before a value is staged. Prefer recognized profile/native fields and do not treat arbitrary untrusted keys as safe staging metadata.

## Related modules

- [`effects`](effects.md) documents the complete root export surface and geometry helpers.
- [`effects/fields`](effects-fields.md) loads the selected SDK field profiles used by `TemporaryEntity`.
- [`effects/hooks`](effects-hooks.md) documents managed pre/post create callbacks.
- [`effects/templates`](effects-templates.md) resolves fields and performs direct native template creation.
