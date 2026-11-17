# `require("effects")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Native discovery](#native-discovery)
- [Resource precaching](#resource-precaching)
- [Templates](#templates)
- [Creating effects](#creating-effects)
- [Create hooks](#create-hooks)
- [Geometry](#geometry)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Related modules](#related-modules)

## Location and purpose

[`packages/sourcejs/effects.js`](../../packages/sourcejs/effects.js) combines the native `effects` module installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) with reusable templates, create hooks, and beam-geometry helpers.

Use this module to discover native temporary entities, combine their send properties with field profiles, precache resources, and request visual effects through `IVEngineServer::PlaybackTempEntity`. Effect duration depends on the effect and its values, not a universal one-frame lifetime. Managed creation adds field conversion and hooks; direct template creation bypasses that pipeline. A successful playback return is not a client-delivery acknowledgement.

Discovery, precaching, creation, hooks, and geometry run synchronously in the initialized server/game-thread context. They do not schedule worker requests or await callback promises; do not move engine/template operations onto an IO worker thread.

Native discovery depends on available server-class metadata. The native `ListTempEntities`, `GetTempEntity`, `GetProperty`, and `CreateTempEntity` functions are installed only when both `SOURCEJS_HAS_SENDPROPS` and `SOURCEJS_HAS_RECIPIENT_FILTER` are enabled. JavaScript wrappers can still be exported without those native functions; their presence alone does not establish SDK support or a valid server state. Use the module while the required metadata and resources remain valid; no fallback implementation is supplied for these missing native functions.

## Import

```js
const { CreateTemporaryEntity, GetTemporaryEntity, PrecacheModel } = require("effects");
```

## Exports

### Native values and discovery

| Export | Signature | Result |
| --- | --- | --- |
| `BloodColor` | Native value object | `DONT_BLEED`, `RED`, `YELLOW`, `GREEN`, and `MECH`. |
| `ShatterSurface` | Native value object | `GLASS` and `TILE`. |
| [`GetNativeTemporaryEntityProperty`](#getnativetemporaryentitypropertystrtemporaryentityname-strpropertyname) | `GetNativeTemporaryEntityProperty(strTemporaryEntityName, strPropertyName)` | Delegates to native `GetProperty`; returns a property descriptor or `null` for a normal miss. Requires non-empty string names; validation, unavailable server state, and descriptor-construction errors propagate. |
| [`GetTemporaryEntity`](#gettemporaryentitystrtemporaryentityname) | `GetTemporaryEntity(strTemporaryEntityName)` | Delegates to native `GetTempEntity`; returns a descriptor or `null` for an unknown name. Requires a non-empty string; validation, unavailable server state, and descriptor-construction errors propagate. |
| [`PrecacheDecal`](#precachedecalstrdecalname-bpreload--false) | `PrecacheDecal(strDecalName, bPreload = false)` | Forwards the decal name and preload flag to native `PrecacheDecal`; returns its result unchanged. |
| [`PrecacheGeneric`](#precachegenericstrfilename-bpreload--false) | `PrecacheGeneric(strFileName, bPreload = false)` | Forwards the resource name and preload flag to native `PrecacheGeneric`; returns its result unchanged. |
| [`PrecacheModel`](#precachemodelstrmodelname-bpreload--false) | `PrecacheModel(strModelName, bPreload = false)` | Forwards the model/resource name and preload flag to native `PrecacheModel`; returns its signed native index unchanged. |

### Creation and templates

| Export | Signature | Result |
| --- | --- | --- |
| [`TEMP_ENTITY_TEMPLATES`](#temp_entity_templates) | Collection | Default module-instance cache with lookup, cache-populating presence checks, enumeration and iteration; shared with `effects/templates`. |
| [`TemporaryEntity`](#temporaryentity) | `new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues = {})` | Mutable staged values using a template from the default collection; construction applies field conversion but does not request playback. |
| [`TemporaryEntityTemplate`](#temporaryentitytemplate) | `new TemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)` | Separate resolver built from a name lookup or descriptor; underlying descriptor/profile references can be shared. |
| [`TemporaryEntityTemplateCollection`](#temporaryentitytemplatecollection) | `new TemporaryEntityTemplateCollection()` | Separate initially empty cache map, using the same runtime/profile dependencies; not independent native ownership. |
| [`CreateTemporaryEntity`](#createtemporaryentitystrtemporaryentityname-propertyvalues---recipients--undefined-fleffectdelay--0-breliabledelivery--false) | `CreateTemporaryEntity(strTemporaryEntityName, PropertyValues = {}, Recipients = undefined, flEffectDelay = 0, bReliableDelivery = false)` | Constructs a staged entity and runs managed creation. Returns `false` on pre-hook cancellation or a falsy direct creation result, and `true` after post-hooks complete; exceptions propagate. Not a delivery acknowledgement. |
| [`GetTemporaryEntityTemplate`](#gettemporaryentitytemplatetemporaryentitynameordescriptor) | `GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)` | Default collection lookup by descriptor class-name key. A string still triggers native lookup before cache access; cache hits do not refresh the existing template. |
| [`GetTemporaryEntityTemplates`](#gettemporaryentitytemplates) | `GetTemporaryEntityTemplates()` | Native enumeration mapped to default-collection templates. Can populate earlier cache entries before a later lookup/construction failure. |

### Create hooks

| Export | Signature | Result |
| --- | --- | --- |
| `TemporaryEntityPostCreateHook` | `new TemporaryEntityPostCreateHook(strTemporaryEntityName)` | Resolves a template and creates an initially unregistered post-create handle; call `RegisterTemporaryEntityHook` to attach a callback. |
| `TemporaryEntityPreCreateHook` | `new TemporaryEntityPreCreateHook(strTemporaryEntityName)` | Resolves a template and creates an initially unregistered pre-create handle; call `RegisterTemporaryEntityHook` to attach a callback. |
| [`RegisterTemporaryEntityPostCreateHook`](#registertemporaryentitypostcreatehookstrtemporaryentityname-hookcallback) | `RegisterTemporaryEntityPostCreateHook(strTemporaryEntityName, HookCallback)` | Constructs and registers a post-create handle, then returns it. Retain it for explicit `UnregisterTemporaryEntityHook()` cleanup. |
| [`RegisterTemporaryEntityPreCreateHook`](#registertemporaryentityprecreatehookstrtemporaryentityname-hookcallback) | `RegisterTemporaryEntityPreCreateHook(strTemporaryEntityName, HookCallback)` | Constructs and registers a pre-create handle, then returns it. Retain it for explicit `UnregisterTemporaryEntityHook()` cleanup. |

Managed pre-create callbacks receive `(TemporaryEntity, Recipients)`; only an exact `false` cancels creation. Post-create callbacks receive those arguments after a truthy direct creation result, not after a delivery acknowledgement. `Recipients` is forwarded unchanged and need not be an array. Invocation is synchronous, promises are not awaited, and exceptions propagate. Managed `TemporaryEntity.CreateTemporaryEntity()` and the root `CreateTemporaryEntity()` use this pipeline; direct `TemporaryEntityTemplate.CreateTemporaryEntity()` bypasses it. Handle construction/registration can throw; neither dropping a handle nor this API description guarantees automatic plugin cleanup.

### Geometry

| Export | Signature | Result |
| --- | --- | --- |
| [`CreateBallEffect`](#createballeffectrecipients-ballcenter-flballradius-unringcount--15-bupperhalf--true-blowerhalf--true-effectoptions--) | `CreateBallEffect(Recipients, BallCenter, flBallRadius, unRingCount = 15, bUpperHalf = true, bLowerHalf = true, EffectOptions = {})` | Attempts horizontal rings through managed creation, reusing one staged entity. Returns `undefined`, ignores individual `false` results, and stops on an exception without undoing earlier playback. Requires a positive finite radius, positive safe-integer ring count, boolean half flags with at least one enabled, and a non-null, non-array options object. |
| [`CreateBeamEffect`](#createbeameffectrecipients-beamstart-beamend-bparenttoentities--false-effectoptions--) | `CreateBeamEffect(Recipients, BeamStart, BeamEnd, bParentToEntities = false, EffectOptions = {})` | Updates endpoints on `EffectOptions.TempEntity` or a new staged entity (default `BeamEntPoint`), then returns its `CreateTemporaryEntity` result. With the standard entity this includes managed hooks, not just native playback. Requires a boolean parent flag and a non-null, non-array options object; exceptions propagate and staged updates are not rolled back. |
| [`CreateBoxEffect`](#createboxeffectrecipients-minimumpoint-maximumpoint-effectoptions--) | `CreateBoxEffect(Recipients, MinimumPoint, MaximumPoint, EffectOptions = {})` | Attempts twelve axis-aligned box edges through managed creation, reusing one staged entity (default `BeamPoints`). Returns `undefined` and ignores individual `false` results; exceptions stop later edges without undoing earlier playback. Requires a non-null, non-array options object. |
| [`CreatePolygonEffect`](#createpolygoneffectrecipients-vecpolygonpoints-bparenttoentities--false-effectoptions--) | `CreatePolygonEffect(Recipients, vecPolygonPoints, bParentToEntities = false, EffectOptions = {})` | Attempts a closed chain of beams, including the last-to-first edge, reusing one staged entity (default `BeamEntPoint`). Requires an array of at least three entries, a boolean parent flag, and a non-null, non-array options object. Returns `undefined`, ignores beam results, and stops on an exception without undoing earlier edges; the array-length check does not validate polygon geometry. |
| [`CreateSquareEffect`](#createsquareeffectrecipients-squarestart-squareend-effectoptions--) | `CreateSquareEffect(Recipients, SquareStart, SquareEnd, EffectOptions = {})` | Attempts four coplanar rectangle edges using the endpoints' XY positions and Z heights; equal side lengths are not enforced. Reuses one staged entity (default `BeamPoints`), returns `undefined`, and ignores individual `false` results. Exceptions stop later edges without undoing earlier playback. Requires a non-null, non-array options object. |

Geometry vector resolution accepts arrays with at least three entries (only the first three are used), numeric entity indexes, objects exposing `Origin`, and objects accepted by `Vector.CreateMathStructureFromValue`. An `Origin` value is resolved recursively; malformed or cyclic inputs are not a safe contract. Entity lookup and vector conversion can throw. In beam parent mode, a number or an object exposing `Index` selects the entity-reference path, which requires a non-negative safe-integer index; that numeric check alone does not establish a live entity.

When a geometry helper constructs its staged entity, own enumerable string-keyed option properties other than `EntityName`, `TempEntity`, `Recipients`, `Delay`, and `Reliable` are copied as field values. The copy creates own data properties without invoking inherited setters or changing its prototype; even `__proto__` remains a field key, not a prototype operation. This does not bypass the template's field-name validation or add native properties. The explicit `Recipients` argument controls recipients; `EffectOptions.Recipients` is excluded, not used as an override. Only `CreateBeamEffect` reuses a supplied non-nullish `EffectOptions.TempEntity`; in that case it does not copy the remaining option fields into that object. Existing nested values are not deep-copied.

## Native discovery

When native discovery is available, use `GetTemporaryEntity(strTemporaryEntityName)` to resolve one native descriptor or `GetTemporaryEntityTemplates()` to enumerate available templates. `GetNativeTemporaryEntityProperty(strTemporaryEntityName, strPropertyName)` queries one property by its native entity name; it does not take a descriptor object. A normal lookup miss can return `null`, while invalid input and unavailable server state are errors. The native `ListTempEntities`, `GetTempEntity`, `GetProperty`, and `CreateTempEntity` callbacks are installed as own function properties without invoking inherited setters, and retain their callback runtime data.

### `BloodColor` and `ShatterSurface`

Inspect the value objects supplied by the native binding. Their values are explicitly defined by the binding, not dynamically discovered SDK enums; use them only for compatible effect properties: `BloodColor` and `ShatterSurface` members are own numeric data properties; both module exports are also installed as own properties without invoking inherited setters.

| Object | Member | Value |
| --- | --- | ---: |
| `BloodColor` | `DONT_BLEED` | `-1` |
| `BloodColor` | `RED` | `0` |
| `BloodColor` | `YELLOW` | `1` |
| `BloodColor` | `GREEN` | `2` |
| `BloodColor` | `MECH` | `3` |
| `ShatterSurface` | `GLASS` | `0` |
| `ShatterSurface` | `TILE` | `1` |

```js
const { BloodColor, ShatterSurface } = require("effects");

console.log({ GlassSurface: ShatterSurface.GLASS, RedBlood: BloodColor.RED, TileSurface: ShatterSurface.TILE });
```

### `GetTemporaryEntity(strTemporaryEntityName)`

Inspect the native server class before relying on a game-specific effect:

```js
const { GetTemporaryEntity } = require("effects");

const g_BeamTemporaryEntityInformation = GetTemporaryEntity("BeamPoints");
if (g_BeamTemporaryEntityInformation === null) {
	throw new Error("BeamPoints metadata is unavailable in the current server state.");
}

console.log({ ClassIndex: g_BeamTemporaryEntityInformation.ClassIndex, ClassName: g_BeamTemporaryEntityInformation.ClassName, PropertyCount: g_BeamTemporaryEntityInformation.Properties.length, TableName: g_BeamTemporaryEntityInformation.TableName });
```

The descriptor is built from the current `ServerClass` and includes `ServerClass` and property descriptors. Its `Kind` type discriminator is `"tempentity"`; this lowercase value is distinct from the PascalCase property names and the `TempEntity` geometry-option key. Its public `ClassIndex` value remains signed because it represents the native `int`; the diagnostic output uses `ClassIndex` accordingly. Construction checks sender-size computation and the `int` size limit, descriptor creation, and property assignment; an empty construction result becomes an error in the callback. These checks are not proof that arbitrary metadata is safe or that native references remain valid after server-state changes. Do not retain referenced native addresses beyond their owning metadata's lifetime.

### `GetNativeTemporaryEntityProperty(strTemporaryEntityName, strPropertyName)`

Request native property metadata by path, property name, or alias. Matching also considers the parent path segment and normalizes case, separators, and recognized native member prefixes.

Member-prefix removal uses the original `m_` spelling before case/separator normalization. A typed prefix must end at an uppercase character, digit, or underscore; the plain `m_` scope prefix can precede an untyped name. Both `m_fLife` and `m_flLife` produce the lookup alias `life`, without consuming the role's first letter. Ordinary unprefixed names such as `material` are not shortened. These normalized lookup aliases are not renamed SDK fields or managed PascalCase profile aliases.

This call does not use the managed field-profile map:

```js
const { GetNativeTemporaryEntityProperty } = require("effects");

const g_StartPointPropertyDescriptor = GetNativeTemporaryEntityProperty("BeamPoints", "m_vecStartPoint");
if (g_StartPointPropertyDescriptor === null) {
	throw new Error("BeamPoints m_vecStartPoint metadata is unavailable in the current server state.");
}

console.log({ Offset: g_StartPointPropertyDescriptor.Offset, Path: g_StartPointPropertyDescriptor.Path, Type: g_StartPointPropertyDescriptor.Type });
```

A normal missing-class or missing-property lookup returns `null`. Non-string or empty names and descriptor-construction failures throw; unavailable native APIs or server state can also fail before lookup. Returned metadata does not grant ownership of native objects or keep their addresses valid after the server metadata changes.

## Resource precaching

These native precache callbacks accept a string whose UTF-8 representation is converted through a C-string boundary: an embedded NUL truncates the path/name there, so do not pass one. The resulting string must be non-empty. An omitted or `undefined` preload argument uses `false`; an explicit value, including `null`, must be boolean. The callbacks do not verify asset existence before calling the engine.

### `PrecacheDecal(strDecalName, bPreload = false)`

Pass a non-empty decal name and optional preload flag to the selected engine. Resource availability and the permitted precaching window are engine/game-specific; the wrapper does not check them in advance. The sample asset is not guaranteed to exist in every game:

```js
const { PrecacheDecal } = require("effects");

const g_nScorchDecalIndex = PrecacheDecal("decals/scorch1", true);
console.log(`Scorch decal index: ${g_nScorchDecalIndex}`);
```

The wrapper returns the engine's signed index without interpreting it as success or failure. Engine availability and argument-validation errors propagate. Logging the index does not verify asset availability or successful rendering; interpret the result according to the selected engine's contract before using it.

### `PrecacheGeneric(strFileName, bPreload = false)`

Request generic-resource precaching while the engine permits it. Use a resource path valid for the selected game; the sample manifest is illustrative:

```js
const { PrecacheGeneric } = require("effects");

const g_nManifestIndex = PrecacheGeneric("scripts/game_sounds_manifest.txt", false);
console.log(`Generic file index: ${g_nManifestIndex}`);
```

The native handler requires the engine server, checks the non-empty C-string path and preload argument as described above, then returns the engine's signed index unchanged. The wrapper does not translate engine-specific failure values into exceptions or verify the file's contents. Printing a result does not establish that the resource exists or that precaching succeeded.

### `PrecacheModel(strModelName, bPreload = false)`

Request precaching of a beam asset supported by the selected game before using its index in an effect. The sample path must exist in that game's content, and the engine must permit precaching at the call site:

```js
const { PrecacheModel } = require("effects");

const g_nBeamModelIndex = PrecacheModel("materials/sprites/laserbeam.vmt", true);
console.log(`Beam model index: ${g_nBeamModelIndex}`);
```

These wrappers delegate to the selected engine's precache calls. Path/preload validation and engine-interface failures propagate; returned signed indexes are passed through without translating engine-specific failure values. Interpret the index using the selected engine's contract before supplying it to an effect. Printing it does not prove the asset was loaded or can render.

## Templates

### `GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor)`

Get a profile-backed template from the default collection by passing a non-empty native temporary-entity name or a descriptor object with a non-empty `ClassName`. Name input is looked up natively before the class-name cache is consulted; a descriptor is used directly. Cache hits do not refresh native metadata or extend its lifetime:

```js
const { GetTemporaryEntityTemplate } = require("effects");

const g_BeamTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
const g_StartPointFieldDescriptor = g_BeamTemporaryEntityTemplate.ResolveTemporaryEntityField("StartPoint");
if (g_StartPointFieldDescriptor === null) {
	throw new Error("BeamPoints field metadata is incomplete.");
}

console.log({ Name: g_StartPointFieldDescriptor.Name, ValueFields: g_StartPointFieldDescriptor.ValueFields });
```

`StartPoint` is the supplied profile alias, not a Systems Hungarian variable name. A resolved mapping can share mutable descriptor data and does not prove that native creation will accept its field or value. Invalid names/descriptors, failed native lookups, and template-construction errors throw.

### `TemporaryEntityTemplate`

Construct a resolver outside the default collection, with its own initially empty hook arrays. Descriptor/profile data can still be shared. This example filters recorded names containing the case-sensitive substring `Width`; it does not validate native support for those fields:

```js
const { TemporaryEntityTemplate } = require("effects");

function IsWidthTemporaryEntityFieldName(strFieldName) {
	return strFieldName.includes("Width");
}

const g_BeamTemporaryEntityTemplate = new TemporaryEntityTemplate("BeamPoints");
const g_vecTemporaryEntityFieldNames = g_BeamTemporaryEntityTemplate.GetTemporaryEntityFieldNames();
console.log(g_vecTemporaryEntityFieldNames.filter(IsWidthTemporaryEntityFieldName));
```

### `TemporaryEntityTemplateCollection`

Use a separate cache map for a subsystem. The runtime and profile dependencies remain shared, so this does not establish independent native ownership. The identity check assumes enumeration still includes the same class and the map has not been changed directly:

```js
const { TemporaryEntityTemplateCollection } = require("effects");

function IsBeamPointsTemporaryEntityTemplate(TemporaryEntityTemplate) {
	return TemporaryEntityTemplate.ClassName === "CTEBeamPoints";
}

const g_SubsystemTemporaryEntityTemplates = new TemporaryEntityTemplateCollection();
const g_DirectBeamPointsTemporaryEntityTemplate = g_SubsystemTemporaryEntityTemplates.GetTemporaryEntityTemplate("BeamPoints");
const g_ListedBeamPointsTemporaryEntityTemplate = g_SubsystemTemporaryEntityTemplates.GetTemporaryEntityTemplates().find(IsBeamPointsTemporaryEntityTemplate);
if (g_ListedBeamPointsTemporaryEntityTemplate !== g_DirectBeamPointsTemporaryEntityTemplate) {
	throw new Error("The subsystem template cache lost canonical identity.");
}
```

### `GetTemporaryEntityTemplates()`

List enumerated templates whose names begin with `Beam`, using a case-sensitive prefix check. The name filter is not a test of field compatibility or successful creation:

```js
const { GetTemporaryEntityTemplates } = require("effects");

function IsBeamTemporaryEntityTemplate(TemporaryEntityTemplate) {
	return TemporaryEntityTemplate.Name.startsWith("Beam");
}

function GetTemporaryEntityTemplateName(TemporaryEntityTemplate) {
	return TemporaryEntityTemplate.Name;
}

const g_vecBeamTemporaryEntityTemplateNames = GetTemporaryEntityTemplates().filter(IsBeamTemporaryEntityTemplate).map(GetTemporaryEntityTemplateName).sort();
console.log(g_vecBeamTemporaryEntityTemplateNames);
```

Each call performs native enumeration and resolves descriptors through the default collection. An exception prevents a normal result, but earlier templates may already have entered the cache before a later construction fails; the operation is not transactional. Cache hits reuse existing objects without refreshing metadata. `map()` creates a separate name array here, so sorting does not reorder the template cache or the enumeration result.

### `TEMP_ENTITY_TEMPLATES`

The root lookup function delegates to this same default collection. With an unchanged class-name key and no direct map mutation, both paths return the same template:

```js
const { TEMP_ENTITY_TEMPLATES, GetTemporaryEntityTemplate } = require("effects");

const g_CollectionBeamPointsTemporaryEntityTemplate = TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate("BeamPoints");
const g_ResolvedBeamPointsTemporaryEntityTemplate = GetTemporaryEntityTemplate("BeamPoints");
if (g_CollectionBeamPointsTemporaryEntityTemplate !== g_ResolvedBeamPointsTemporaryEntityTemplate) {
	throw new Error("The shared temporary-entity cache lost object identity.");
}
```

Detailed template methods are documented in [effects-templates.md](effects-templates.md).

## Creating effects

The following examples use `BeamPoints` aliases from the packaged effect profile. `TemporaryEntityTemplate.HasTemporaryEntityField(strFieldName)` checks whether a mapping resolves; it does not verify the selected game's native property layout or acceptable values. Before playback, confirm the target class, required properties, resources and recipient state for that game. Managed creation can be cancelled or throw, and a successful return does not acknowledge client delivery.

### `TemporaryEntity`

Build reusable staged beam values and request playback for client index `1`. Replace that index with a valid intended recipient; the server, profile and model asset must be available:

```js
const { TemporaryEntity } = require("effects");
const { Color } = require("colors");
const { Vector } = require("mathlib");

const g_BeamTemporaryEntity = new TemporaryEntity("BeamPoints", {
	Color: new Color(40, 180, 255, 255),
	EndWidth: 3,
	LifeTime: 1,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 3,
});
g_BeamTemporaryEntity.SetTemporaryEntityProperty("StartPoint", new Vector(0, 0, 64));
g_BeamTemporaryEntity.SetTemporaryEntityProperty("EndPoint", new Vector(256, 0, 64));

if (!g_BeamTemporaryEntity.CreateTemporaryEntity([1])) {
	throw new Error("BeamPoints creation was cancelled or returned a failure result.");
}
```

The object retains `Values` between calls, including changes made by hooks. Update the fields needed for each request; a failed update or creation does not restore earlier staged values. An exception from a post-create hook can occur after native playback. A `true` result does not acknowledge delivery. Full property access is documented in [effects-temp-entity.md](effects-temp-entity.md).

### `CreateTemporaryEntity(strTemporaryEntityName, PropertyValues = {}, Recipients = undefined, flEffectDelay = 0, bReliableDelivery = false)`

This example sends a `BeamPoints` temporary entity with a 0.1-second engine delay and reliable delivery enabled. Replace the illustrative recipient index `1` with a valid intended recipient, and ensure the profile and model asset are available. Reliability does not provide a delivery acknowledgement:

```js
const { CreateTemporaryEntity } = require("effects");
const { Vector } = require("mathlib");

const g_bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", {
	EndPoint: new Vector(128, 128, 96),
	EndWidth: 2,
	LifeTime: 0.5,
	Model: "materials/sprites/laserbeam.vmt",
	StartPoint: new Vector(0, 0, 96),
	StartWidth: 2,
}, [1], 0.1, true);
if (!g_bBeamTemporaryEntityCreated) {
	throw new Error("BeamPoints creation was cancelled or returned a failure result.");
}
```

`Recipients` accepts one player/recipient value, an array of recipient values, or a filter object with a `RecipientIndexes` array. Omitting it or passing `null` selects all current players, including bots; provide an explicit selector for a limited preview. The helper constructs a new staged entity and invokes managed creation. It returns `false` on exact-false pre-hook cancellation or a falsy direct creation result, and `true` only after post-hooks complete. Validation, conversion, resource, native creation and callback errors propagate; a post-hook error can occur after playback. The helper does not roll back prior side effects, and callbacks may retain the staged object. Argument defaults and validation follow the managed and native contracts described above, not JavaScript truthiness-based coercion.

## Create hooks

### `RegisterTemporaryEntityPreCreateHook(strTemporaryEntityName, HookCallback)`

Limit the start width while this callback is registered in the default `BeamPoints` template, then remove it after one managed request. Other callbacks can still alter or cancel creation. Use a valid intended recipient and available model/profile:

```js
const { CreateTemporaryEntity, RegisterTemporaryEntityPreCreateHook } = require("effects");
const { Vector } = require("mathlib");

const g_flMaximumStartWidth = 16;

function ClampTemporaryEntityStartWidth(TemporaryEntity) {
	const flStartWidth = TemporaryEntity.GetTemporaryEntityPropertyFloat("StartWidth");
	if (flStartWidth > g_flMaximumStartWidth) {
		TemporaryEntity.SetTemporaryEntityPropertyFloat("StartWidth", g_flMaximumStartWidth);
	}

	return true;
}

const g_BeamTemporaryEntityPreCreateHook = RegisterTemporaryEntityPreCreateHook("BeamPoints", ClampTemporaryEntityStartWidth);

try {
	if (!CreateTemporaryEntity("BeamPoints", {
		EndPoint: new Vector(128, 0, 64),
		EndWidth: 2,
		LifeTime: 0.5,
		Model: "materials/sprites/laserbeam.vmt",
		StartPoint: new Vector(0, 0, 64),
		StartWidth: 32,
	}, [1])) {
		throw new Error("BeamPoints creation was cancelled or returned a failure result.");
	}
} finally {
	if (!g_BeamTemporaryEntityPreCreateHook.UnregisterTemporaryEntityHook()) {
		throw new Error("The BeamPoints pre-create hook could not be removed.");
	}
}
```

The width check is not full numeric validation: `NaN`, for example, does not exceed the limit. Cleanup is attempted even when creation throws, but a cleanup exception can replace the earlier error. The callback remains active for any reentrant managed creation through the same template until removal; this example does not establish exclusive hook ownership.

### `RegisterTemporaryEntityPostCreateHook(strTemporaryEntityName, HookCallback)`

Count post-create callback invocations, not delivered effects. The check assumes no reentrant creation or other callback interrupts this request. Use a valid intended client index and available model/profile:

```js
const { CreateTemporaryEntity, RegisterTemporaryEntityPostCreateHook } = require("effects");
const { Vector } = require("mathlib");

let g_unObservedTemporaryEntityPostCalls = 0;

function RecordBeamTemporaryEntityPostCall(TemporaryEntity, Recipients) {
	g_unObservedTemporaryEntityPostCalls += 1;
	console.log(`Post-create: ${TemporaryEntity.Name}`, Recipients);
}

const g_BeamTemporaryEntityPostCreateHook = RegisterTemporaryEntityPostCreateHook("BeamPoints", RecordBeamTemporaryEntityPostCall);

try {
	const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", {
		EndPoint: new Vector(128, 32, 64),
		LifeTime: 0.5,
		Model: "materials/sprites/laserbeam.vmt",
		StartPoint: new Vector(0, 32, 64),
	}, [1]);
	if (!bBeamTemporaryEntityCreated || (g_unObservedTemporaryEntityPostCalls !== 1)) {
		throw new Error("BeamPoints creation failed or the expected post-create count changed.");
	}
} finally {
	if (!g_BeamTemporaryEntityPostCreateHook.UnregisterTemporaryEntityHook()) {
		throw new Error("The BeamPoints post-create hook could not be removed.");
	}
}
```

`Recipients` is the unchanged argument, not a normalized recipient count. Logging can throw after the counter increments and native playback has occurred. Callback errors propagate; cleanup is still attempted, and its own error can replace the original exception. Returning from the callback does not confirm delivery.

### `TemporaryEntityPreCreateHook` and `TemporaryEntityPostCreateHook`

Construct handles before registration and protect each successful registration with cleanup. This example requires a valid intended recipient and available model/profile; other callbacks can still cancel, throw or modify values:

```js
const { CreateTemporaryEntity, TemporaryEntityPostCreateHook, TemporaryEntityPreCreateHook } = require("effects");
const { Vector } = require("mathlib");

let g_bBeamTemporaryEntityPreCreateCalled = false;
let g_bBeamTemporaryEntityPostCreateCalled = false;

function PrepareBeamTemporaryEntity(TemporaryEntity) {
	g_bBeamTemporaryEntityPreCreateCalled = true;
	TemporaryEntity.SetTemporaryEntityPropertyFloat("LifeTime", 0.25);

	return true;
}

function RecordBeamTemporaryEntityCreation(TemporaryEntity) {
	g_bBeamTemporaryEntityPostCreateCalled = true;
	console.log(`Post-create observed: ${TemporaryEntity.Name}.`);
}

const g_BeamTemporaryEntityPreCreateHook = new TemporaryEntityPreCreateHook("BeamPoints");
const g_BeamTemporaryEntityPostCreateHook = new TemporaryEntityPostCreateHook("BeamPoints");
g_BeamTemporaryEntityPreCreateHook.RegisterTemporaryEntityHook(PrepareBeamTemporaryEntity);

try {
	g_BeamTemporaryEntityPostCreateHook.RegisterTemporaryEntityHook(RecordBeamTemporaryEntityCreation);

	try {
		const bBeamTemporaryEntityCreated = CreateTemporaryEntity("BeamPoints", {
			EndPoint: new Vector(96, 64, 64),
			LifeTime: 1,
			Model: "materials/sprites/laserbeam.vmt",
			StartPoint: new Vector(0, 64, 64),
		}, [1]);
		if (!bBeamTemporaryEntityCreated || !g_bBeamTemporaryEntityPreCreateCalled || !g_bBeamTemporaryEntityPostCreateCalled) {
			throw new Error("One or more BeamPoints hook phases did not run.");
		}
	} finally {
		if (!g_BeamTemporaryEntityPostCreateHook.UnregisterTemporaryEntityHook()) {
			throw new Error("The BeamPoints post-create hook could not be removed.");
		}
	}
} finally {
	if (!g_BeamTemporaryEntityPreCreateHook.UnregisterTemporaryEntityHook()) {
		throw new Error("The BeamPoints pre-create hook could not be removed.");
	}
}
```

The outer `finally` attempts pre-hook removal even if post-hook registration, dispatch or removal fails. Cleanup errors can replace earlier exceptions; these callbacks do not guarantee delivery or exclusive access to the shared template. Detailed hook lifecycle behavior is documented in [effects-hooks.md](effects-hooks.md).

## Geometry

Geometry helpers synchronously attempt managed creation; the `Delay` option is forwarded to native playback. This does not guarantee immediate rendering or delivery. Resolved points are world coordinates; `CreateBeamEffect()` and `CreatePolygonEffect()` can instead set entity-index endpoints when `bParentToEntities = true` and the corresponding argument is an entity reference.

`CreateBeamEffect()` returns the underlying managed-creation result. The polygon, square, box, and ball helpers return `undefined` and ignore individual false results. Exceptions interrupt iteration without rolling back earlier effects; hooks can cancel, mutate values or throw.

### `CreateBeamEffect(Recipients, BeamStart, BeamEnd, bParentToEntities = false, EffectOptions = {})`

Attempt one short blue beam using the default `BeamEntPoint` template. `Recipients` is forwarded as a native selector: pass a player value, an array of recipient values, or a filter object with a `RecipientIndexes` array. An explicit `null` or `undefined` selects all current players, including bots. Recipient index `1` in this example must identify an intended valid recipient, and the model/profile must be available:

```js
const { CreateBeamEffect } = require("effects");
const { Color } = require("colors");
const { Vector } = require("mathlib");

const g_bBeamEffectCreated = CreateBeamEffect([1], new Vector(0, 0, 64), new Vector(256, 0, 64), false, {
	Color: new Color(40, 180, 255, 255),
	EndWidth: 3,
	LifeTime: 1,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 3,
});
if (!g_bBeamEffectCreated) {
	throw new Error("Managed beam creation returned false.");
}
```

### `CreatePolygonEffect(Recipients, vecPolygonPoints, bParentToEntities = false, EffectOptions = {})`

Attempt a closed triangular boundary. The helper requires at least three points and connects the last point back to the first, reusing one staging entity. This example requires the default `BeamEntPoint` profile, an available model and an intended valid recipient at index `1`; returning `undefined` does not confirm that every segment was created or delivered:

```js
const { CreatePolygonEffect } = require("effects");
const { Vector } = require("mathlib");

CreatePolygonEffect([1], [
	new Vector(0, 0, 64),
	new Vector(192, 0, 64),
	new Vector(96, 160, 64),
], false, {
	LifeTime: 2,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 2,
});
```

### `CreateSquareEffect(Recipients, SquareStart, SquareEnd, EffectOptions = {})`

Attempt a vertical rectangle using both endpoints' XY positions and Z heights. The helper forms the other corners as `(End.X, End.Y, Start.Z)` and `(Start.X, Start.Y, End.Z)`; equal side lengths are not enforced. Equal endpoint heights collapse two vertical edges to zero length. This example requires the default `BeamPoints` profile, an available model and an intended valid recipient at index `1`; individual false results are ignored:

```js
const { CreateSquareEffect } = require("effects");
const { Vector } = require("mathlib");

CreateSquareEffect([1], new Vector(-64, -64, 8), new Vector(64, -64, 136), {
	LifeTime: 1.5,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 2,
});
```

### `CreateBoxEffect(Recipients, MinimumPoint, MaximumPoint, EffectOptions = {})`

Attempt the twelve edges of an axis-aligned volume; this is a visual outline, not a trigger or collision entity. One staging entity is reused; the helper returns `undefined` and ignores individual false results. This example requires the default `BeamPoints` profile, an available model and an intended valid recipient at index `1`:

```js
const { CreateBoxEffect } = require("effects");
const { Vector } = require("mathlib");

CreateBoxEffect([1], new Vector(-32, -32, 0), new Vector(32, 32, 72), {
	LifeTime: 2,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 2,
});
```

### `CreateBallEffect(Recipients, BallCenter, flBallRadius, unRingCount = 15, bUpperHalf = true, bLowerHalf = true, EffectOptions = {})`

Attempt a sphere-like stack with twelve height samples per half: both halves together produce 23 ring attempts, sharing the equator and omitting the poles. This example requires the default `BeamRingPoint` profile, an available model and an intended valid recipient at index `1`. The helper reuses one staging entity, returns `undefined`, and ignores individual false results:

```js
const { CreateBallEffect } = require("effects");
const { Vector } = require("mathlib");

CreateBallEffect([1], new Vector(0, 0, 72), 96, 12, true, true, {
	LifeTime: 1,
	Model: "materials/sprites/laserbeam.vmt",
	StartWidth: 2,
});
```

`flBallRadius` must be a positive finite number, `unRingCount` a positive safe integer, and both half flags booleans with at least one enabled. These checks do not impose a practical work limit or ensure every derived value fits native fields. The current formula sets the `StartRadius` property to `2 * flBallRadius * Math.sqrt(1 - (unRingIndex / unRingCount) ** 2)` and `EndRadius` to that value minus `0.1`; very small radii can produce a negative end value, and extreme inputs can overflow. Use bounded values appropriate to the engine; an exception does not undo earlier ring attempts.

## Errors and lifecycle

- `GetTemporaryEntity()` and `GetNativeTemporaryEntityProperty()` return `null` for an ordinary lookup miss, but invalid input, unavailable required interfaces and metadata-construction failures can throw. Their required arguments are not coerced to strings.
- Native `GetTempEntity()`, `GetProperty()`, and `CreateTempEntity()` retain each input name's complete UTF-8 length before lookup, rather than truncating at an embedded NUL. Lookup still normalizes case and discards non-alphanumeric characters, including NUL; this is not byte-exact identifier matching. Do not use NUL-containing names. These callbacks translate native C++ exceptions into JavaScript errors. The named metadata lookup callbacks preserve an existing JavaScript exception instead of treating a construction failure as an ordinary miss.
- Native named-class lookup checks complete numeric ranges and alignment for SDK class records and their optional send tables before access, and stops when it encounters a repeated class record. These checks do not prove arbitrary memory is mapped or live: providers must supply live, correctly typed SDK records and valid terminated names.
- Send-table traversal validates the complete property-array range and checks nested offsets before narrowing. Table traversal and nested array-size calculation are depth-bounded. Constructed temporary-entity metadata and its property array use own data properties rather than invoking inherited setters; normalized `Alias` values remain native lookup candidates, not renamed SDK fields.
- Vector-component preparation accepts PascalCase input components and preserves native lowercase component names during lookup. Each resolved float write must fit the actual staging-buffer capacity; missing native components are skipped. Partial-vector inputs retain their existing zero defaults, and exceptions from JavaScript component getters are preserved.
- Native temporary-entity enumeration checks SDK interface, class and optional send-table numeric ranges before access, rejects repeated class records, and reports native C++ failures instead of letting them escape the callback boundary. Valid records retain their native enumeration order.
- Native property preparation bounds writes by the actual staging-buffer capacity and stops on failed array access or string conversion. Arrays are truncated to the native element count; an empty write count leaves storage unchanged. String values are converted to UTF-8, then copied through a C-string boundary with capacity-limited copying and null termination; embedded NUL truncates the stored text, and the byte limit can split a multibyte character. Earlier successful writes can remain when a later property fails; preparation is not a transactional update of the buffer.
- Property keys retain their complete UTF-8 byte length. Keys containing NUL are rejected before reading their value or looking up/writing SDK storage; they are never shortened to another property's name. The named metadata lookup and property/preparation scopes preserve an original JavaScript exception when a C++ failure unwinds the same scope.
- Native `CreateTempEntity()` captures the class index and staging extent before property getters. After property and recipient preparation, it revalidates numeric storage ranges, the send-table identity, the class index, and the current sender extent. A changed class/table or a layout that no longer fits the staging buffer causes an error before playback is requested. This recheck does not extend borrowed SDK-record lifetimes.
- Precache calls reject empty or non-string paths and require the selected SDK's engine-server interface.
- An exact `false` from a managed pre-create callback cancels the send and suppresses post-create callbacks. `TemporaryEntityTemplate.CreateTemporaryEntity()` is the low-level bypass and invokes neither managed hook phase.
- Templates are cached by the loaded module's default collection; do not assume plugin-private hook arrays or extended native metadata lifetime. Unregister plugin-owned hooks during unload and check each removal result; retaining a handle is not automatic cleanup.
- `CreateBeamEffect()` exposes its managed-creation result. Polygon, square, box, and ball helpers return `undefined` and ignore individual false results. All can throw; composites can stop after partial work. A post-create exception can occur after native playback was requested. Neither a true result nor a callback confirms client delivery.
- Keep the geometry option keys `EntityName`, `TempEntity`, `Recipients`, `Delay`, and `Reliable` unchanged. Field extraction copies other own enumerable string-keyed properties. The explicit recipient argument is used, not `EffectOptions.Recipients`. Only `CreateBeamEffect()` reuses `EffectOptions.TempEntity`; when supplied, it does not copy other field options into that entity. The other helpers construct their own staging entity.

## Related modules

- [`effects/templates`](effects-templates.md) owns template discovery, field resolution, direct sends, and shared hook arrays.
- [The `TemporaryEntity` guide](effects-temp-entity.md) documents typed mutable staging and managed creation through `effects`.
- [`effects/fields`](effects-fields.md) supplies selected-SDK readable field profiles.
- [`effects/hooks`](effects-hooks.md) documents explicit registration and removal of pre-create and post-create hooks.
