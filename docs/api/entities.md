# `require("entities")`

> Warning: this page documents both the root module and the live Entity objects it returns. Use the table of contents to jump to the relevant ownership boundary.

The root `entities` module lives in [packages/sourcejs/entities/index.js](../../packages/sourcejs/entities/index.js); native live objects are implemented in [src/sourcejs/modules/ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp). It scans the current edict list, creates live Entity objects, adds reflection, timer, sound, model, and hitbox conveniences, and exposes direct lifecycle operations. Entity fields are read from the engine when accessed; they are not snapshots. Use engine-backed operations on the server/game thread while the selected entity and metadata remain live. An index-bearing wrapper does not pin lifetime or prove the same entity still occupies that index.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [World queries](#world-queries)
- [Entity objects](#entity-objects)
- [Reflection](#reflection)
- [Inputs and outputs](#inputs-and-outputs)
- [Timers](#timers)
- [Sound](#sound)
- [Models and hitboxes](#models-and-hitboxes)
- [Send properties and datamaps](#send-properties-and-datamaps)
- [Lifecycle and safety](#lifecycle-and-safety)
- [Common mistakes](#common-mistakes)

## Import and capabilities

Import the operations that the plugin owns directly:

```js
const { Entity, GetEntitiesByClassName, GetEntityCount, GetMaximumEntityCount } = require("entities");
const { LogInfo } = require("loggers");

const g_unWorldEntityIndex = 0;
const g_WorldEntity = Entity(g_unWorldEntityIndex);
if (g_WorldEntity === null) {
	throw new Error("The world entity is not available before map initialization.");
}

LogInfo("ReportRootEntityCounts Result=%j", { ActiveEntityCount: GetEntityCount(), DynamicPropEntityCount: GetEntitiesByClassName("prop_dynamic").length, MaximumEntityCount: GetMaximumEntityCount(), WorldEntityIndex: g_WorldEntity.Index });
```

`Entity(nEntityIndex)` returns `null` when the edict is absent or free. Scans return only occupied edicts. Native Entity methods backed by send properties or datamaps are installed only when the selected HL2SDK exposes those systems; inspect the method before using an optional capability:

```js
const { Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 1;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Entity ${g_unEntityIndex} is not available on the current server.`);
}

const g_EntityCapabilities = {
	DataMapsSupported: typeof g_EntityValue.GetEntityDataMap === "function",
	SendPropertiesSupported: typeof g_EntityValue.GetEntityProperty === "function",
};
LogInfo("ReportRootEntityCapabilities Result=%j", g_EntityCapabilities);
```

Importing the module does not require an active map. Entity lookup and scans require the current global variables and edict list; `GetMaximumEntityCount()` requires `CGlobalVars`, while `GetEntityCount()` requires `IVEngineServer`. Missing prerequisites raise native errors. Use world/entity lookups after the server has established the required state.

## Exports

| Export | Signature | Ownership and result |
| --- | --- | --- |
| `Entity` | `Entity(nEntityIndex)` | Returns one decorated live Entity or `null`. |
| `GetAllEntities` | `GetAllEntities()` | Returns decorated live objects for every occupied edict. |
| `GetEntitiesByClassName` | `GetEntitiesByClassName(strEntityClassName)` | Returns occupied entities whose engine class name matches exactly. |
| `CallEntityInputFunction` | `CallEntityInputFunction(EntityReference, strInputName, InputValue = undefined, flInputDelay = 0)` | Sends or schedules an engine input. |
| `CancelEntityTimers` | `CancelEntityTimers(EntityReference)` | Cancels every `TickDelay` and `RepeatingTickTask` tracked for that entity index. |
| `GetEntityClassNameByIndex` | `GetEntityClassNameByIndex(EntityReference)` | Returns the current class name, or `""` for a free edict. |
| `GetEntityCount` | `GetEntityCount()` | Returns the engine's current entity count. |
| `DelayEntityCallback` | `DelayEntityCallback(EntityReference, flDelaySeconds, Callback, vecCallbackArguments = [], DelayOptions = {})` | Creates and tracks a `listeners/tick.TickDelay`. |
| `RepeatEntityCallback` | `RepeatEntityCallback(EntityReference, Callback, vecCallbackArguments = [], RepeatOptions = {})` | Creates and tracks a `listeners/tick.RepeatingTickTask`; call `StartRepeat()` explicitly. |
| `DecorateEntity` | `DecorateEntity(EntityObject)` | Installs missing convenience methods on an existing object in place. |
| `EmitEntitySound` | `EmitEntitySound(EntityReference, strSoundSample, SoundOptions = {})` | Creates, plays, and returns a `Sound` or `StreamSound`. |
| `GetEntityDynamicAttributes` | `GetEntityDynamicAttributes(EntityReference)` | Returns current reflection arrays grouped by role. |
| `GetEntityHitbox` | `GetEntityHitbox(EntityReference, unHitboxIndex, unHitboxSet = 0)` | Returns a live studio hitbox view. |
| `GetEntityInput` | `GetEntityInput(EntityReference, strInputName)` | Returns a native input-function descriptor or `null`. |
| `GetEntityInputs` | `GetEntityInputs(EntityReference)` | Returns current datamap input fields. |
| `GetEntityKeyValues` | `GetEntityKeyValues(EntityReference)` | Returns current datamap key fields. |
| `GetEntityModelName` | `GetEntityModelName(EntityReference)` | Returns the current model path from the SDK's exact native `m_ModelName` datamap field. |
| `GetEntityModelHeader` | `GetEntityModelHeader(EntityReference)` | Returns a borrowed live studio model header; the engine or another cache owner must retain the model. |
| `GetEntityOutput` | `GetEntityOutput(EntityReference, strOutputName)` | Returns one datamap output field or `null`. |
| `GetEntityOutputs` | `GetEntityOutputs(EntityReference)` | Returns current datamap output fields. |
| `GetEntityProperties` | `GetEntityProperties(EntityReference)` | Returns inherited send-property metadata. |
| `GetEntityServerClasses` | `GetEntityServerClasses(EntityReference)` | Returns the entity's server class followed by its base classes. |
| `IsEntityNetworked` | `IsEntityNetworked(EntityReference)` | Reports whether a server class can be resolved. |
| `GetMaximumEntityCount` | `GetMaximumEntityCount()` | Returns the current `CGlobalVars.maxEntities`. |
| `RemoveEntityByIndex` | `RemoveEntityByIndex(EntityReference)` | Removes one occupied entity and returns the native result. An exception thrown by the record's `Index` getter is preserved; no removal is attempted after that read fails. Native C++ failures become `Error` without replacing an already pending JavaScript exception. |

## World queries

`GetEntityCount()` is the engine count; `GetAllEntities().length` is the number of occupied edicts found during that particular scan. Do not assume the two remain equal across callbacks.

Native `Entity()`, `GetEntityCount()`, and `GetMaximumEntityCount()` translate C++ exceptions into contextual JavaScript errors while preserving any existing JavaScript exception. Their normal nullable entity and numeric count results are unchanged; these boundaries do not pin an entity or extend the lifetime of SDK interfaces.

The native backing operations for `GetAllEntities()`, `GetEntitiesByClassName()` and `GetEntityClassNameByIndex()` translate C++ exceptions into contextual JavaScript errors while retaining an existing JavaScript exception. Failed collection construction does not publish a partial array. The scans skip absent/free edicts; zero or negative native capacity retains the existing empty result. These guards do not make membership atomic, keep entities alive or guarantee allocator/OOM recovery.

```js
const {
	GetAllEntities,
	GetEntitiesByClassName,
	GetEntityClassNameByIndex,
	GetEntityCount,
	GetMaximumEntityCount,
} = require("entities");
const { LogInfo } = require("loggers");

const g_GetEntityIndex = function GetEntityIndex(EntityValue) {
	return EntityValue.Index;
};

const g_vecOccupiedEntities = GetAllEntities();
const g_vecDynamicPropEntities = GetEntitiesByClassName("prop_dynamic");
if (g_vecOccupiedEntities.length === 0) {
	throw new Error("No occupied edicts are available before map initialization.");
}

LogInfo("ReportOccupiedEntityScan Result=%j", { DynamicPropEntityIndexes: g_vecDynamicPropEntities.map(g_GetEntityIndex), FirstEntityClassName: GetEntityClassNameByIndex(g_vecOccupiedEntities[0].Index), ActiveEntityCount: GetEntityCount(), MaximumEntityCount: GetMaximumEntityCount(), OccupiedEdictCount: g_vecOccupiedEntities.length });
```

The returned array is a scan result; each Entity inside it is an index-based live view, not a snapshot or lifetime pin. An entity may be removed or its index reused after the scan. Re-run `GetAllEntities()` or `GetEntitiesByClassName()` when membership matters.

Native entity scans create own indexed data properties; inherited numeric setters do not intercept the array entries. A failure to create an Entity wrapper aborts the result instead of returning a partially built array. Missing and free edicts are still omitted normally.

## Entity objects

### Live fields

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index captured by the object. |
| `Valid` | read-only boolean | The indexed edict currently exists and is not free. |
| `Free` | live boolean | Inverse of `Valid`; writing it changes the edict free flag and is dangerous. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | live integer | Current `edict_t::m_fStateFlags`; writable. |
| `NetworkSerialNumber` | live integer | Current edict serial number; writable, but normally engine-owned. |
| `Edict` | read-only object or `null` | Opaque live edict value. |
| `BaseEntity` | read-only object or `null` | Opaque live `CBaseEntity` value. |
| `Address` | read-only `bigint` | Numeric `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Current SDK base-handle record. |
| `HandleValue` | read-only integer | Packed handle value, or `-1` when unavailable. |

Read a field at the point where it is needed. `StateFlags` and `NetworkSerialNumber` are writable, but direct writes do not notify the engine. Use [`entities/transmit`](entities-transmit.md) for transmit-mode changes, and change another engine-owned field only when the selected SDK contract is understood.

If a native live property cannot be installed, creation stops without returning a partial wrapper. An existing JavaScript exception propagates unchanged; a nonthrowing installation failure reports `Failed to install Entity live properties.`

```js
const { Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

LogInfo("ReportRootLiveEntityFields Result=%j", {
	Free: g_EntityValue.Free,
	Valid: g_EntityValue.Valid,
	HandleValue: g_EntityValue.HandleValue,
	HasBaseEntity: g_EntityValue.BaseEntity !== null,
	HasBaseHandle: g_EntityValue.BaseHandle !== null,
	HasEdict: g_EntityValue.Edict !== null,
	Address: `0x${g_EntityValue.Address.toString(16).toUpperCase()}`,
	ClassName: g_EntityValue.ClassName,
	Index: g_EntityValue.Index,
	NetworkSerialNumber: g_EntityValue.NetworkSerialNumber,
	StateFlags: g_EntityValue.StateFlags,
});
```

This report formats the `bigint` address as lossless hexadecimal and reports only the presence of borrowed native records. It does not serialize those records or change engine-owned fields. The separate live reads are not an atomic snapshot.

### Native lifecycle methods

Every Entity has `RemoveEntity()`. Branches compiled with `SOURCEJS_HAS_BASE_ENTITY` also install the two input-backed methods:

| Method | Availability | Result |
| --- | --- | --- |
| `SlayEntity()` | `SOURCEJS_HAS_BASE_ENTITY`; requires `CBaseEntity::AcceptInput()` at runtime. | Attempts `SetHealth 0`, then falls back to `Kill`; returns whether an input was accepted. |
| `CallEntityInput(strInputName, InputValue = undefined, flInputDelay = 0)` | `SOURCEJS_HAS_BASE_ENTITY`; requires `CBaseEntity::AcceptInput()` at runtime. | Sends or schedules an SDK input and returns the native result. |
| `RemoveEntity()` | Every supported branch. | Removes this entity and returns the native result. |

Use temporary entities when demonstrating destructive operations. The root `RemoveEntityByIndex(EntityReference)` and object `RemoveEntity()` are separate entry points:

```js
const { Entity, RemoveEntityByIndex } = require("entities");
const { CreateAndSpawnEntityByClassName } = require("entities/factories");

const g_strTemporaryEntityClassName = "info_target";

const g_CreateTemporaryEntity = function CreateTemporaryEntity() {
	const TemporaryEntity = CreateAndSpawnEntityByClassName(g_strTemporaryEntityClassName);
	if (TemporaryEntity === null) {
		throw new Error(`The selected SDK could not create ${g_strTemporaryEntityClassName}.`);
	}

	return TemporaryEntity;
};

const g_SlainEntity = g_CreateTemporaryEntity();
const g_nSlainEntityHandleValue = g_SlainEntity.HandleValue;
const g_nSlainEntityNetworkSerialNumber = g_SlainEntity.NetworkSerialNumber;

try {
	if (typeof g_SlainEntity.SlayEntity !== "function") {
		throw new Error("The selected SDK does not expose Entity.SlayEntity().");
	}

	if (!g_SlainEntity.SlayEntity()) {
		throw new Error("The temporary entity rejected its kill input.");
	}
} finally {
	if (g_SlainEntity.Valid && (g_SlainEntity.HandleValue === g_nSlainEntityHandleValue) && (g_SlainEntity.NetworkSerialNumber === g_nSlainEntityNetworkSerialNumber)) {
		if (!g_SlainEntity.RemoveEntity()) {
			throw new Error("The temporary slain entity could not be removed.");
		}
	}
}

const g_ObjectRemovedEntity = g_CreateTemporaryEntity();
const g_nObjectRemovedEntityHandleValue = g_ObjectRemovedEntity.HandleValue;
const g_nObjectRemovedEntityNetworkSerialNumber = g_ObjectRemovedEntity.NetworkSerialNumber;

try {
	if (!g_ObjectRemovedEntity.RemoveEntity()) {
		throw new Error("Entity.RemoveEntity() failed for the temporary entity.");
	}
} finally {
	if (g_ObjectRemovedEntity.Valid && (g_ObjectRemovedEntity.HandleValue === g_nObjectRemovedEntityHandleValue) && (g_ObjectRemovedEntity.NetworkSerialNumber === g_nObjectRemovedEntityNetworkSerialNumber)) {
		if (!g_ObjectRemovedEntity.RemoveEntity()) {
			throw new Error("The original object-removed temporary entity could not be cleaned up.");
		}
	}
}

const g_RootRemovedEntity = g_CreateTemporaryEntity();
const g_unRootRemovedEntityIndex = g_RootRemovedEntity.Index;
const g_nRootRemovedEntityHandleValue = g_RootRemovedEntity.HandleValue;
const g_nRootRemovedEntityNetworkSerialNumber = g_RootRemovedEntity.NetworkSerialNumber;

try {
	if (!RemoveEntityByIndex(g_unRootRemovedEntityIndex)) {
		throw new Error("entities.RemoveEntityByIndex(EntityReference) failed for the temporary entity.");
	}
} finally {
	if (g_RootRemovedEntity.Valid && (g_RootRemovedEntity.HandleValue === g_nRootRemovedEntityHandleValue) && (g_RootRemovedEntity.NetworkSerialNumber === g_nRootRemovedEntityNetworkSerialNumber)) {
		if (!g_RootRemovedEntity.RemoveEntity()) {
			throw new Error("The original root-removed temporary entity could not be cleaned up.");
		}
	}
}

const g_RemainingRootEntity = Entity(g_unRootRemovedEntityIndex);
if ((g_RemainingRootEntity !== null) && (g_RemainingRootEntity.HandleValue === g_nRootRemovedEntityHandleValue) && (g_RemainingRootEntity.NetworkSerialNumber === g_nRootRemovedEntityNetworkSerialNumber)) {
	throw new Error("The root remove operation left the temporary edict occupied.");
}
```

A successful `SlayEntity()` means an input was accepted, not necessarily that the entity was removed. Once identity is captured, these examples attempt cleanup in `finally`, including exceptional exits, and skip a replacement whose handle or serial differs. Cleanup is best-effort: if it fails, its error takes precedence over the original operation's error. After removal, existing wrappers keep their `Index` but their live `Valid`, `Free`, `Address`, `BaseHandle`, and `ClassName` fields change; an index can later resolve to a different entity. The final check distinguishes a replacement from the original temporary entity. Saved handle/serial generations are finite, not permanent lifetime pins.

### Decorated convenience methods

`Entity()`, `GetAllEntities()`, and `GetEntitiesByClassName()` call `DecorateEntity()` automatically. Decoration installs only methods that are not already present. It adds `CallEntityInputFunction()` only when the native runtime exposes `CallInput`, and adds the three model methods only when the runtime exposes `GetModel`:

| Method | Equivalent root operation |
| --- | --- |
| `IsEntityNetworked()` | `IsEntityNetworked(EntityReference)` |
| `GetEntityServerClasses()` | `GetEntityServerClasses(EntityReference)` |
| `GetEntityDynamicAttributes()` | `GetEntityDynamicAttributes(EntityReference)` |
| `GetEntityProperties()` | `GetEntityProperties(EntityReference)` |
| `GetEntityInputs()` | `GetEntityInputs(EntityReference)` |
| `GetEntityOutputs()` | `GetEntityOutputs(EntityReference)` |
| `GetEntityKeyValues()` | `GetEntityKeyValues(EntityReference)` |
| `GetEntityInput(strInputName)` | `GetEntityInput(EntityReference, strInputName)` |
| `GetEntityOutput(strOutputName)` | `GetEntityOutput(EntityReference, strOutputName)` |
| `CallEntityInputFunction(strInputName, InputValue = undefined, flInputDelay = 0)` | Preserves the native method when one already exists; otherwise delegates to `CallEntityInputFunction(EntityReference, ...)` when available. |
| `DelayEntityCallback(flDelaySeconds, Callback, vecCallbackArguments = [], DelayOptions = {})` | `DelayEntityCallback(EntityReference, ...)` |
| `RepeatEntityCallback(Callback, vecCallbackArguments = [], RepeatOptions = {})` | `RepeatEntityCallback(EntityReference, ...)` |
| `CancelEntityTimers()` | `CancelEntityTimers(EntityReference)` |
| `EmitEntitySound(strSoundSample, SoundOptions = {})` | `EmitEntitySound(EntityReference, ...)` |
| `GetEntityModelName()` | `GetEntityModelName(EntityReference)` |
| `GetEntityModelHeader()` | `GetEntityModelHeader(EntityReference)` |
| `GetEntityHitbox(unHitboxIndex, unHitboxSet = 0)` | `GetEntityHitbox(EntityReference, ...)` |

An extension can decorate an index-bearing object without replacing its own methods. Decoration does not turn arbitrary data into a native Entity and does not validate that the index remains occupied:

```js
const { DecorateEntity, Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_LiveEntity = Entity(g_unEntityIndex);
if (g_LiveEntity === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

const g_ExtensionEntity = { Source: "example-extension", Index: g_LiveEntity.Index };
const g_DecoratedEntity = DecorateEntity(g_ExtensionEntity);
const g_bEntityModelMethodsAvailable = typeof g_DecoratedEntity.GetEntityModelName === "function";
const g_strEntityModelName = g_bEntityModelMethodsAvailable ? g_DecoratedEntity.GetEntityModelName() : "";
LogInfo("ReportDecoratedEntity Result=%j", { EntityModelMethodsAvailable: g_bEntityModelMethodsAvailable, Networked: g_DecoratedEntity.IsEntityNetworked(), EntityModelName: g_strEntityModelName, Source: g_DecoratedEntity.Source });
```

## Reflection

Reflection helpers combine the canonical `entities/classes` and `entities/datamaps` modules. Metadata fields are copied into JavaScript records; their `bigint` addresses still refer to borrowed native structures. These records are not live Entity property views: editing a record does not write SDK storage, and retaining it does not extend native lifetime. Query again when current metadata is required. Raw records containing `bigint` values cannot be passed directly to `JSON.stringify()` without an explicit conversion.

```js
const {
	Entity,
	GetEntityDynamicAttributes,
	GetEntityInputs,
	GetEntityKeyValues,
	GetEntityOutputs,
	GetEntityProperties,
	GetEntityServerClasses,
	IsEntityNetworked,
} = require("entities");
const { LogInfo } = require("loggers");

const g_GetReflectionFieldName = function GetReflectionFieldName(ReflectionField) {
	return ReflectionField.Name;
};

const g_GetServerClassName = function GetServerClassName(ServerClass) {
	return ServerClass.Name;
};

const g_unEntityIndex = 2;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

const g_EntityDynamicAttributes = GetEntityDynamicAttributes(g_EntityValue);
LogInfo("ReportRootEntityReflection Result=%j", {
	InputNames: GetEntityInputs(g_EntityValue).map(g_GetReflectionFieldName),
	KeyValueNames: GetEntityKeyValues(g_EntityValue).map(g_GetReflectionFieldName),
	OutputNames: GetEntityOutputs(g_EntityValue).map(g_GetReflectionFieldName),
	PropertyNames: GetEntityProperties(g_EntityValue).map(g_GetReflectionFieldName),
	ServerClassNames: GetEntityServerClasses(g_EntityValue).map(g_GetServerClassName),
	Networked: IsEntityNetworked(g_EntityValue),
	DynamicCounts: {
		InputCount: g_EntityDynamicAttributes.Inputs.length,
		KeyValueCount: g_EntityDynamicAttributes.KeyValues.length,
		OutputCount: g_EntityDynamicAttributes.Outputs.length,
		PropertyCount: g_EntityDynamicAttributes.Properties.length,
		ServerClassCount: g_EntityDynamicAttributes.ServerClasses.length,
	},
});
```

Metadata names and available fields differ by SDK branch and entity class. Discover them at runtime instead of copying names from another game.

## Inputs and outputs

`GetEntityInput()` resolves a native datamap input-function descriptor with `Address`, `Entity`, and `Description` fields. Its `Address` identifies the native `typedescription_t` record, not directly callable machine code; `Entity` is the borrowed native entity address, and `Description` is field metadata. `GetEntityOutput()` returns the matching output field metadata. Both return `null` when the named field exists but has the wrong role, or when it is absent. Invoke ordinary named inputs through `CallEntityInputFunction()`; use `entities/datamaps.CallEntityInputFunction()` with the resolved descriptor when needed. Do not call its metadata address as machine code.

```js
const { CallEntityInputFunction, GetEntitiesByClassName, GetEntityInput, GetEntityOutput } = require("entities");
const { LogInfo } = require("loggers");

const g_strAnimationInputName = "SetAnimation";
const [g_AnimatedProp] = GetEntitiesByClassName("prop_dynamic");
if (g_AnimatedProp === undefined) {
	throw new Error("The current map has no prop_dynamic entity.");
}

const g_SetAnimationInput = GetEntityInput(g_AnimatedProp, g_strAnimationInputName);
const g_AnimationDoneOutput = GetEntityOutput(g_AnimatedProp, "OnAnimationDone");
if ((g_SetAnimationInput === null) || (g_AnimationDoneOutput === null)) {
	throw new Error("The selected entity profile does not expose the expected input/output pair.");
}

if (typeof g_AnimatedProp.CallEntityInputFunction !== "function") {
	throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput().");
}

if (!CallEntityInputFunction(g_AnimatedProp, g_strAnimationInputName, "idle_open")) {
	throw new Error("The prop rejected SetAnimation.");
}

if (!g_AnimatedProp.CallEntityInputFunction("Disable")) {
	throw new Error("The prop rejected Disable.");
}

LogInfo("ReportRootEntityInputMetadata Result=%j", { InputDescriptionAddress: `0x${g_SetAnimationInput.Address.toString(16).toUpperCase()}`, OutputName: g_AnimationDoneOutput.Name });
```

This example changes the first matching prop's animation and disables it. Run it only against a disposable entity on a test map; input acceptance does not mean the entity preserves its previous state.

The `InputValue` argument is converted through the selected SDK's `variant_t`; strings use the game's string pool. With global variables available, a positive `flInputDelay` is queued by SourceJS with the entity's full native handle and checked at dispatch, not scheduled by the engine. Queueing rejects an invalid handle, non-finite/out-of-range fire time, or exhausted internal sequence counter. Without global variables, even a positive delay falls back to an immediate call; do not rely on that path for deferred execution. Pending inputs are discarded at level shutdown and SourceJS unload; `CancelEntityTimers()` does not own this queue. Each pump considers only entries queued before it began. Inputs queued by a handler wait for a later pump, even when a positive delay rounds to the current 32-bit game time. Clearing the queue cancels its old pending entries; newly queued entries still wait for a later pump. Nonpositive delays and the missing-global-variables fallback remain immediate.

## Timers

Entity timers wrap `listeners/tick.TickDelay` and `listeners/tick.RepeatingTickTask` and are owned by the plugin runtime. Callback `this` is the original `EntityReference` passed to the helper, not a serial-pinned identity. The registry is keyed by entity index; it does not automatically detect removal or index reuse. Before a delayed callback accesses native state, verify a saved handle and network serial against a still-valid entity, as in the examples below. Skip stale callbacks and cancel tracked tasks before the entity lifetime or plugin context ends. These finite-generation checks do not pin lifetime.

`Callback` must be a function; invalid callbacks throw synchronously before a timer is created. Stopping a repeat releases its entity tracking, and starting or restarting it restores tracking before any immediate callback. Direct tick-task start/stop methods and the entity aliases share this lifecycle. Natural completion and `CancelOnLevelEnd` cancellation release tracking; failed starts release it when the task remains stopped. A callback exception does not detach a task that is still running.

### Delay

```js
const { DelayEntityCallback, Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_flDelaySeconds = 0.25;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

if (typeof g_EntityValue.CallEntityInputFunction !== "function") {
	throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput().");
}

const g_nEntityHandleValue = g_EntityValue.HandleValue;
const g_nEntityNetworkSerialNumber = g_EntityValue.NetworkSerialNumber;

const g_EnableEntity = function EnableEntity(strInputName) {
	if (!this.Valid || (this.HandleValue !== g_nEntityHandleValue) || (this.NetworkSerialNumber !== g_nEntityNetworkSerialNumber)) {
		return;
	}

	if (!this.CallEntityInputFunction(strInputName)) {
		throw new Error(`Entity ${this.Index} rejected ${strInputName}.`);
	}
};

const g_Delay = DelayEntityCallback(g_EntityValue, g_flDelaySeconds, g_EnableEntity, ["Enable"], { CancelOnLevelEnd: true });

try {
	LogInfo("ReportRootEntityDelay Result=%j", { Running: g_Delay.Running, TimeRemainingSeconds: g_Delay.TimeRemainingSeconds });
	g_Delay.CallDelay();
} finally {
	if (g_Delay.Running && !g_Delay.Cancel()) {
		throw new Error("Unable to cancel the entity delay.");
	}
}
```

### Repeat and cancellation

`RepeatEntityCallback()` creates a stopped `RepeatingTickTask`. The entity wrapper exposes `StartRepeat(flIntervalSeconds, unLoopCountLimit = Infinity, bExecuteCallbackOnStart = false)` as a bound alias for `StartRepeatingTickTask()`.

```js
const { CancelEntityTimers, Entity, RepeatEntityCallback } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_flRepeatIntervalSeconds = 1;
const g_unRepeatLoopCountLimit = 3;
const g_bExecuteCallbackOnStart = true;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

if (typeof g_EntityValue.CallEntityInputFunction !== "function") {
	throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput().");
}

const g_nEntityHandleValue = g_EntityValue.HandleValue;
const g_nEntityNetworkSerialNumber = g_EntityValue.NetworkSerialNumber;

const g_ToggleEntity = function ToggleEntity(strInputName) {
	if (!this.Valid || (this.HandleValue !== g_nEntityHandleValue) || (this.NetworkSerialNumber !== g_nEntityNetworkSerialNumber)) {
		return;
	}

	if (!this.CallEntityInputFunction(strInputName)) {
		throw new Error(`Entity ${this.Index} rejected ${strInputName}.`);
	}
};

const g_Repeat = RepeatEntityCallback(g_EntityValue, g_ToggleEntity, ["Toggle"], { CancelOnLevelEnd: true });

try {
	if (!g_Repeat.StartRepeat(g_flRepeatIntervalSeconds, g_unRepeatLoopCountLimit, g_bExecuteCallbackOnStart)) {
		throw new Error("Unable to start the entity repeat.");
	}
} finally {
	if (!CancelEntityTimers(g_EntityValue)) {
		throw new Error("Unable to cancel the entity timers.");
	}
}

LogInfo("ReportRootEntityRepeat Result=%j", { Running: g_Repeat.Running, Status: g_Repeat.Status });
```

The decorated methods use the same ownership registry:

```js
const { Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_flDelaySeconds = 5;
const g_flRepeatIntervalSeconds = 2;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

if (typeof g_EntityValue.CallEntityInputFunction !== "function") {
	throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput().");
}

const g_nEntityHandleValue = g_EntityValue.HandleValue;
const g_nEntityNetworkSerialNumber = g_EntityValue.NetworkSerialNumber;

const g_Delay = g_EntityValue.DelayEntityCallback(g_flDelaySeconds, function DisableLater() {
	if (!this.Valid || (this.HandleValue !== g_nEntityHandleValue) || (this.NetworkSerialNumber !== g_nEntityNetworkSerialNumber)) {
		return;
	}

	if (!this.CallEntityInputFunction("Disable")) {
		throw new Error(`Entity ${this.Index} rejected Disable.`);
	}
});

let g_Repeat = null;

try {
	g_Repeat = g_EntityValue.RepeatEntityCallback(function Pulse() {
		if (!this.Valid || (this.HandleValue !== g_nEntityHandleValue) || (this.NetworkSerialNumber !== g_nEntityNetworkSerialNumber)) {
			return;
		}

		if (!this.CallEntityInputFunction("Enable")) {
			throw new Error(`Entity ${this.Index} rejected Enable.`);
		}
	});
	if (!g_Repeat.StartRepeat(g_flRepeatIntervalSeconds)) {
		throw new Error("Unable to start the decorated entity repeat.");
	}

} finally {
	if (!g_EntityValue.CancelEntityTimers()) {
		throw new Error("Unable to cancel the decorated entity timers.");
	}
}

LogInfo("ReportDecoratedRootEntityTimers Result=%j", { DelayRunning: g_Delay.Running, RepeatRunning: g_Repeat.Running });
```

`CancelEntityTimers()` does not cancel delayed engine inputs created through `CallEntityInputFunction(..., flInputDelay)`.

These demonstrations cancel their tracked tasks in `finally`, including a delay created before repeat creation or immediate callback failure. Cleanup failures take precedence over the original failure; cancellation does not roll back callback side effects. The registry is index-based, so entity-wide cancellation affects all timers tracked for that index.

## Sound

`EmitEntitySound()` selects `Sound` by default and `StreamSound` when `SoundOptions.Stream === true`. It shallow-copies the options and defaults `Entity` to the supplied entity's index only when `SoundOptions.Entity` is missing or `undefined`. An explicit `Entity` follows the `Sound` constructor's signed-index and nullish-default rules; `EntityIndex` is not a source-entity option. It then calls `PlaySound()` with the copied `Recipients` (or `null` when absent/`undefined`) and returns the sound object so the caller retains lifecycle control. The caller's options are not modified; native dispatch does not prove client playback.

```js
const { EmitEntitySound, Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_unRecipientPlayerIndex = 1;
const g_vecRecipients = [g_unRecipientPlayerIndex];
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

const g_vecActiveSounds = [];

try {
	const MechanicalSound = EmitEntitySound(g_EntityValue, "doors/door_metal_medium_open1.wav", { Recipients: g_vecRecipients, Volume: 0.8 });
	g_vecActiveSounds.push(MechanicalSound);

	const StreamedVoice = g_EntityValue.EmitEntitySound("sourcejs/tutorial/line01.wav", { Recipients: g_vecRecipients, Stream: true });
	g_vecActiveSounds.push(StreamedVoice);

	LogInfo("ReportRootEntitySounds Result=%j", { StreamSample: StreamedVoice.EngineSample, MechanicalEntityIndex: MechanicalSound.Entity });
} finally {
	const vecStopFailures = [];
	for (const ActiveSound of g_vecActiveSounds) {
		try {
			if (!ActiveSound.StopSound()) {
				vecStopFailures.push(new Error("Unable to stop one or more entity sounds."));
			}
		} catch (ErrorValue) {
			vecStopFailures.push(ErrorValue);
		}
	}

	if (vecStopFailures.length !== 0) {
		throw vecStopFailures[0];
	}
}
```

Resource precaching and download ownership remain the caller's responsibility; see [`engines/sound`](engines-sound.md).

Cleanup attempts to stop every successfully returned sound even when an earlier stop throws or returns `false`. The first cleanup failure takes precedence over an emission or logging failure; this is best-effort cleanup, not rollback of native effects.

## Models and hitboxes

`GetEntityModelHeader()` resolves `GetEntityModelName(EntityReference) -> studio/cache.FindModelHandle(strModelPath) -> studio/cache.RequireModelHeader(hModelHandle)` and balances the temporary valid handle reference with `studio/cache.Release()` on success or failure. A single lookup or release failure propagates unchanged; if both fail, `AggregateError([HeaderError, ReleaseError], ...)` preserves both thrown values in order, including falsy values. Invalid handles are never released. It throws if releasing that reference leaves no owner; it never returns an unretained header. The returned header and `GetEntityHitbox()` result are borrowed live model-memory views, not owning cache references. The engine or another cache owner must keep the model retained; do not keep views across model unload or cache flush. For a longer lifetime, acquire and explicitly release an owning reference through [`studio/cache`](studio-cache.md#model-headers). A header and its hitboxes can be shared by many entities.

```js
const { Entity, GetEntityHitbox, GetEntityModelHeader, GetEntityModelName } = require("entities");
const { LogInfo } = require("loggers");

const g_unEntityIndex = 2;
const g_unHitboxIndex = 0;
const g_flMinimumXAdjustment = 1;
const g_EntityValue = Entity(g_unEntityIndex);
if (g_EntityValue === null) {
	throw new Error(`Expected entity ${g_unEntityIndex} to exist.`);
}

if (typeof g_EntityValue.GetEntityModelHeader !== "function") {
	throw new Error("The selected SDK does not expose entity model methods.");
}

const g_strModelPath = GetEntityModelName(g_EntityValue);
const g_ModelHeader = GetEntityModelHeader(g_EntityValue);
const g_Hitbox = GetEntityHitbox(g_EntityValue, g_unHitboxIndex);
if (g_Hitbox === null) {
	throw new Error(`Expected hitbox ${g_unHitboxIndex} to exist.`);
}

const g_flPreviousMinimumX = g_Hitbox.Mins.X;
if (!Number.isFinite(g_flPreviousMinimumX)) {
	throw new RangeError("Temporary hitbox access requires a finite original minimum X component.");
}

try {
	g_Hitbox.Mins.X = g_flPreviousMinimumX - g_flMinimumXAdjustment;

	LogInfo("ReportRootEntityHitbox Result=%j", { HitboxAddress: `0x${g_Hitbox.Address.toString(16).toUpperCase()}`, ModelHeaderAddress: `0x${g_ModelHeader.Address.toString(16).toUpperCase()}`, ModelPath: g_strModelPath });
} finally {
	g_Hitbox.Mins.X = g_flPreviousMinimumX;
}
```

Changing `Mins`, `Maxs`, bones, or other studio structures writes directly into shared model memory. The example rejects a non-finite original component before writing, because the public setter cannot restore it. Restore temporary changes and coordinate them across plugins. See [`studio`](studio.md) and [`studio/cache`](studio-cache.md).

## Send properties and datamaps

### Entity send-property methods

When send properties are supported, native Entity objects also expose:

- `GetEntityProperty(PropertyReference, strPropertyType?)` and `SetEntityProperty(PropertyReference, PropertyValue, strPropertyType?)`;
- `GetEntityPropertyInteger` / `SetEntityPropertyInteger`;
- `GetEntityPropertyFloat` / `SetEntityPropertyFloat`;
- `GetEntityPropertyString` / `SetEntityPropertyString`;
- `GetEntityPropertyVector` / `SetEntityPropertyVector`;
- `GetEntityPropertyEntity` / `SetEntityPropertyEntity`.

These are direct methods on the native object, not convenience methods installed by `DecorateEntity()`:

```js
const { Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_strHealthPropertyName = "m_iHealth";
const g_strOriginPropertyName = "m_vecOrigin";
const g_unPlayerEntityIndex = 1;
const g_nMinimumHealth = 1;
const g_nHealthAdjustment = 1;
const g_flOriginXAdjustment = 8;
const g_PlayerEntity = Entity(g_unPlayerEntityIndex);
if ((g_PlayerEntity === null) || (typeof g_PlayerEntity.GetEntityPropertyInteger !== "function")) {
	throw new Error("The selected SDK does not expose Entity send-property methods.");
}

const g_nPlayerEntityHandleValue = g_PlayerEntity.HandleValue;
const g_nPlayerEntityNetworkSerialNumber = g_PlayerEntity.NetworkSerialNumber;
const g_nPreviousHealth = g_PlayerEntity.GetEntityPropertyInteger(g_strHealthPropertyName);
const g_Origin = g_PlayerEntity.GetEntityPropertyVector(g_strOriginPropertyName);
if (!Number.isInteger(g_nPreviousHealth) || (g_Origin === null) || (g_Origin === undefined)) {
	throw new Error("Unable to read the player's health or origin.");
}

const g_flPreviousOriginX = g_Origin.X;
if (!Number.isFinite(g_flPreviousOriginX)) {
	throw new RangeError("Temporary entity property access requires a finite original origin X component.");
}

const g_nTemporaryHealth = Math.max(g_nMinimumHealth, g_nPreviousHealth - g_nHealthAdjustment);

try {
	if (!g_PlayerEntity.SetEntityPropertyInteger(g_strHealthPropertyName, g_nTemporaryHealth)) {
		throw new Error("Unable to write m_iHealth.");
	}

	g_Origin.X = g_flPreviousOriginX + g_flOriginXAdjustment;

	if (g_PlayerEntity.GetEntityPropertyInteger(g_strHealthPropertyName) !== g_nTemporaryHealth) {
		throw new Error("m_iHealth did not expose the native write.");
	}

	const nReportedHealth = g_PlayerEntity.GetEntityProperty(g_strHealthPropertyName, "int");
	const CurrentOrigin = g_PlayerEntity.GetEntityPropertyVector(g_strOriginPropertyName);
	const OriginSnapshot = ("Z" in CurrentOrigin) ? { X: CurrentOrigin.X, Y: CurrentOrigin.Y, Z: CurrentOrigin.Z } : { X: CurrentOrigin.X, Y: CurrentOrigin.Y };
	LogInfo("ReportRootEntityProperties Result=%j", { Health: nReportedHealth, Origin: OriginSnapshot });
} finally {
	if (g_PlayerEntity.Valid && (g_PlayerEntity.HandleValue === g_nPlayerEntityHandleValue) && (g_PlayerEntity.NetworkSerialNumber === g_nPlayerEntityNetworkSerialNumber)) {
		g_Origin.X = g_flPreviousOriginX;

		if (!g_PlayerEntity.SetEntityProperty(g_strHealthPropertyName, g_nPreviousHealth, "int")) {
			throw new Error("Unable to restore m_iHealth.");
		}
	}
}
```

Property paths such as `m_iHealth` and `m_vecOrigin` are exact external SDK names, not SourceJS public-field spellings. They are selected-SDK and class-specific. Discover them through `GetEntityProperties()` and use [`entities/props`](entities-props.md) for the complete typed API. The temporary examples restore state only while the saved handle and network serial still match a valid entity; cleanup skips a destroyed or replaced entity instead of touching its borrowed vector or another entity's properties. These are not atomic transactions: individual writes or cleanup can fail, and a cleanup failure is reported rather than proving complete restoration.

### Entity datamap methods

When datamaps are supported, native Entity objects also expose:

- `GetEntityDataMap()`;
- `GetEntityDataMapProperty(Property, strType?)` and `SetEntityDataMapProperty(Property, Value, strType?)`;
- `GetEntityDataMapPropertyInteger` / `SetEntityDataMapPropertyInteger`;
- `GetEntityDataMapPropertyFloat` / `SetEntityDataMapPropertyFloat`;
- `GetEntityDataMapPropertyString` / `SetEntityDataMapPropertyString`;
- `GetEntityDataMapPropertyVector` / `SetEntityDataMapPropertyVector`;
- `GetEntityDataMapPropertyEntity` / `SetEntityDataMapPropertyEntity`.

Use discovered fields and restore engine-owned state:

```js
const { GetEntitiesByClassName } = require("entities");
const { LogInfo } = require("loggers");

const g_strRelayEntityClassName = "logic_relay";
const g_strDelayFieldName = "m_flDelay";
const g_flDelayAdjustment = 0.25;
const [g_RelayEntity] = GetEntitiesByClassName(g_strRelayEntityClassName);
if ((g_RelayEntity === undefined) || (typeof g_RelayEntity.GetEntityDataMapPropertyFloat !== "function")) {
	throw new Error("The selected SDK does not expose Entity datamap methods.");
}

const g_EntityDataMap = g_RelayEntity.GetEntityDataMap();
if (g_EntityDataMap === null) {
	throw new Error("The logic_relay has no datamap.");
}

const g_nRelayEntityHandleValue = g_RelayEntity.HandleValue;
const g_nRelayEntityNetworkSerialNumber = g_RelayEntity.NetworkSerialNumber;
const g_flPreviousDelay = g_RelayEntity.GetEntityDataMapPropertyFloat(g_strDelayFieldName);
if (!Number.isFinite(g_flPreviousDelay)) {
	throw new Error("Unable to read m_flDelay.");
}

const g_flTemporaryDelay = Math.fround(g_flPreviousDelay + g_flDelayAdjustment);

try {
	if (!g_RelayEntity.SetEntityDataMapPropertyFloat(g_strDelayFieldName, g_flTemporaryDelay)) {
		throw new Error("Unable to write m_flDelay.");
	}

	if (g_RelayEntity.GetEntityDataMapPropertyFloat(g_strDelayFieldName) !== g_flTemporaryDelay) {
		throw new Error("m_flDelay did not expose the native write.");
	}

	LogInfo("ReportRootEntityDatamap Result=%j", { Delay: g_RelayEntity.GetEntityDataMapProperty(g_strDelayFieldName, "float"), ClassName: g_EntityDataMap.ClassName });
} finally {
	if (g_RelayEntity.Valid && (g_RelayEntity.HandleValue === g_nRelayEntityHandleValue) && (g_RelayEntity.NetworkSerialNumber === g_nRelayEntityNetworkSerialNumber)) {
		if (!g_RelayEntity.SetEntityDataMapProperty(g_strDelayFieldName, g_flPreviousDelay, "float")) {
			throw new Error("Unable to restore m_flDelay.");
		}
	}
}
```

The datamap `float` field stores a native 32-bit value. Round the computed temporary value with `Math.fround()` before exact read-back comparison; a JavaScript `Number` can otherwise retain precision the native field cannot represent. `m_flDelay` is an exact selected-SDK field name. See [`entities/datamaps`](entities-datamaps.md) for every type, variant, interval, input-function, and metadata operation.

## Lifecycle and safety

Entity indexes are reusable. Never retain an object indefinitely and assume its index still names the same engine object. Capture numeric `HandleValue` and `NetworkSerialNumber` snapshots before an operation that can remove or replace it; re-check both against a valid entity before a delayed mutation or cleanup. Comparing two live wrappers is not a snapshot: both can now resolve to the replacement. Saved generations are finite, not lifetime pins.

A practical cleanup pass should scan current membership, use an engine input when the class owns cleanup behavior, and tolerate objects disappearing between the scan and operation:

```js
const { Entity, GetEntitiesByClassName } = require("entities");

const g_strSpriteEntityClassName = "env_sprite";
const g_strCleanupInputName = "Kill";

for (const Sprite of GetEntitiesByClassName(g_strSpriteEntityClassName)) {
	const nSpriteHandleValue = Sprite.HandleValue;
	const nSpriteNetworkSerialNumber = Sprite.NetworkSerialNumber;
	const CurrentEntity = Entity(Sprite.Index);
	if ((CurrentEntity === null) || !CurrentEntity.Valid || (CurrentEntity.HandleValue !== nSpriteHandleValue) || (CurrentEntity.NetworkSerialNumber !== nSpriteNetworkSerialNumber)) {
		continue;
	}

	if (typeof CurrentEntity.CallEntityInputFunction !== "function") {
		throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput().");
	}

	if (!CurrentEntity.CallEntityInputFunction(g_strCleanupInputName)) {
		throw new Error(`Entity ${CurrentEntity.Index} rejected ${g_strCleanupInputName}.`);
	}
}
```

`Entity()` returning `null` is the normal missing/free result. The example checks an illustrative index; choose one known to be unoccupied on the selected server:

```js
const { Entity } = require("entities");
const { LogInfo } = require("loggers");

const g_unExampleEntityIndex = 9999;
const g_MissingEntity = Entity(g_unExampleEntityIndex);
LogInfo("ReportMissingRootEntity Result=%j", { EntityIndex: g_unExampleEntityIndex, Missing: g_MissingEntity === null });
```

## Common mistakes

- Passing a player user ID or Steam account ID to `Entity(nEntityIndex)`. It accepts an edict index only.
- Treating `GetAllEntities()` as a live collection. Its members are live, but the array membership is a point-in-time scan.
- Calling `RepeatEntityCallback()` without `RepeatTask.StartRepeat(...)`.
- Expecting `CancelEntityTimers()` to cancel delayed engine inputs.
- Writing `EntityReference.Free`, `NetworkSerialNumber`, send properties, datamaps, or studio memory without restoring temporary state.
- Keeping an Entity across map changes without re-resolving it.
- Assuming a send-property/datamap path from one game exists in another SDK branch.
- Passing native addresses back to APIs as a JavaScript `Number` or string. SourceJS address values are `bigint`; hexadecimal strings in these reports are display-only.
- Using `DecorateEntity()` as validation. It only installs missing helper methods on the object supplied by the caller.
