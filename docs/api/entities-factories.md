# `require("entities/factories")`

> Warning: this page covers native entity allocation, pre-spawn KeyValues, and destructive Hammer-ID operations. Use the table of contents to keep creation, spawning, and cleanup ownership explicit.

The [`entities/factories` package](../../packages/sourcejs/entities/factories.js) exposes the selected Source SDK's real `IServerTools` interface through [native bindings](../../src/sourcejs/modules/ModuleBindings.cpp). SourceJS does not recreate entity factories or KeyValue parsing in JavaScript.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [Creation options](#creation-options)
- [KeyValue types](#keyvalue-types)
- [Returned Entity objects](#returned-entity-objects)
- [Creation and spawning](#creation-and-spawning)
- [KeyValue access](#keyvalue-access)
- [Hammer IDs](#hammer-ids)
- [Practical workflows](#practical-workflows)
- [Ownership and safety](#ownership-and-safety)
- [Common mistakes](#common-mistakes)
- [Related modules](#related-modules)

## Import and capabilities

The whole module exists only when SourceJS was compiled with `SOURCEJS_HAS_SERVER_TOOLS` for an SDK that declares `IServerTools`. Importing it on another SDK throws the ordinary missing-module error. The runtime interface is requested using that SDK's `VSERVERTOOLS_INTERFACE_VERSION`, which is `VSERVERTOOLS001` on CSGO/L4D2 and `VSERVERTOOLS003` on TF2; missing-interface errors name the selected version. There is no `available`, `isAvailable`, or fallback object.

`DestroyEntityByHammerID` is installed only when that SDK's `IServerTools` declares `DestroyEntityByHammerId`. The other six operations share the base server-tools capability.

```js
const {
	CreateAndSpawnEntityByClassName,
	CreateEntityByClassName,
	DestroyEntityByHammerID,
	DispatchEntitySpawn,
	FindEntityByHammerID,
	GetEntityKeyValue,
	SetEntityKeyValue,
} = require("entities/factories");
const { LogInfo } = require("loggers");

const g_ReportEntityFactoryCapabilities = function ReportEntityFactoryCapabilities() {
	const EntityFactoryCapabilities = {
		CreateAndSpawnEntityByClassNameSupported: typeof CreateAndSpawnEntityByClassName === "function",
		CreateEntityByClassNameSupported: typeof CreateEntityByClassName === "function",
		DestroyEntityByHammerIDSupported: typeof DestroyEntityByHammerID === "function",
		DispatchEntitySpawnSupported: typeof DispatchEntitySpawn === "function",
		FindEntityByHammerIDSupported: typeof FindEntityByHammerID === "function",
		GetEntityKeyValueSupported: typeof GetEntityKeyValue === "function",
		SetEntityKeyValueSupported: typeof SetEntityKeyValue === "function",
	};
	LogInfo("ReportEntityFactoryCapabilities Result=%j", EntityFactoryCapabilities);
};

g_ReportEntityFactoryCapabilities();
```

The functions run on the game thread and require active server globals and a current entity list. Load the module at plugin startup if desired, but create or inspect entities only after map state exists. Returned Entity objects and addresses borrow engine-owned state; they do not retain an entity or survive index reuse as identity.

## Exports

| Export | Signature | Result |
| --- | --- | --- |
| [`CreateEntityByClassName`](#createentitybyclassnamestrclassname-options) | `CreateEntityByClassName(strClassName, Options?)` | Unspawned or optionally spawned live `Entity`, or `null` when the SDK cannot create the class. |
| [`CreateAndSpawnEntityByClassName`](#createandspawnentitybyclassnamestrclassname-options) | `CreateAndSpawnEntityByClassName(strClassName, Options?)` | Live spawned `Entity`, or `null` when creation fails. |
| `DispatchEntitySpawn` | `DispatchEntitySpawn(Entity)` | `true` after calling the real `IServerTools::DispatchSpawn`. |
| [`SetEntityKeyValue`](#setentitykeyvalueentity-strkeyname-value) | `SetEntityKeyValue(Entity, strKeyName, Value)` | The boolean returned by the selected SDK overload. |
| [`GetEntityKeyValue`](#getentitykeyvalueentity-strkeyname-nmaximumlength) | `GetEntityKeyValue(Entity, strKeyName, nMaximumLength?)` | String representation, or `null` when the SDK cannot return the key. |
| `FindEntityByHammerID` | `FindEntityByHammerID(nHammerID)` | Current live `Entity`, or `null` when no map entity has that ID. |
| `DestroyEntityByHammerID` | `DestroyEntityByHammerID(nHammerID)` | SDK boolean indicating whether the Hammer-ID entity was destroyed; capability-conditioned. |

These are the exact export names. The module does not install `create`, `createAndSpawn`, `dispatchSpawn`, `setKeyValue`, `getKeyValue`, `findByHammerID`, `destroyHammerID`, or other lower-camel compatibility aliases.

Native functions are installed as own data properties; inherited setters do not intercept their installation. The optional Hammer-ID destroy export retains its selected-SDK capability check.

Each `Entity` argument accepts a current live Entity object, an integer edict index, or a current native `edict_t*` or `CBaseEntity*` address as a JavaScript `BigInt`. Prefer the Entity object because it keeps the intent clear. Native addresses must not be passed as Numbers, strings, or address-wrapper objects.

`DispatchEntitySpawn()`, `SetEntityKeyValue()`, and `GetEntityKeyValue()` preserve exceptions thrown while resolving entity-record properties. Resolution failure stops the operation before querying `IServerTools`, spawning, or reading/writing native KeyValues.

Native C++ exceptions from factory operations become `Error` without replacing an already pending JavaScript exception, including one captured during entity resolution. SDK operations are not transactions: a failure can follow allocation, KeyValue application, or spawn; already completed native work is not rolled back.

## Creation options

Both creation functions require a primitive non-empty string class name without embedded NUL bytes. A NUL is rejected before SDK allocation instead of creating an entity with only the name prefix. An omitted or `undefined` second argument uses the defaults; otherwise supply a non-array, non-function object in one of two forms. `null` is rejected.

### Direct KeyValues

When the object has neither the canonical `DispatchSpawn` nor `KeyValues` own property, every own enumerable string-keyed property is treated as an entity KeyValue. Engine KeyValue names such as `origin`, `targetname`, and `spawnflags` retain their exact external spelling; only project-owned option and vector keys use PascalCase. Inherited, non-enumerable, and symbol-keyed properties are not enumerated as KeyValues:

```js
const { CreateEntityByClassName } = require("entities/factories");

const g_ExerciseDirectEntityKeyValues = function ExerciseDirectEntityKeyValues() {
	const MarkerEntity = CreateEntityByClassName("info_target", { origin: { X: 0, Y: 0, Z: 96 }, targetname: "sourcejs_direct_marker" });
	if (!MarkerEntity) {
		throw new Error("The selected SDK could not create info_target.");
	}

	if (!MarkerEntity.RemoveEntity()) {
		throw new Error("Unable to remove the unspawned marker.");
	}
};

g_ExerciseDirectEntityKeyValues();
```

`CreateEntityByClassName()` leaves this entity unspawned. `CreateAndSpawnEntityByClassName()` applies the same direct object and then dispatches spawn.

### Options object

`CreateEntityByClassName()` accepts these canonical option keys:

| Option | Type | Meaning |
| --- | --- | --- |
| `DispatchSpawn` | boolean | Dispatch spawn after all KeyValues are applied; defaults to `false`. |
| `KeyValues` | non-array object or `undefined` | Own enumerable string-keyed KeyValues to apply before optional spawn. |

`CreateAndSpawnEntityByClassName()` always dispatches spawn, so its options form accepts only `KeyValues`. An own `DispatchSpawn` property is rejected even when non-enumerable, without reading its value or allocating an entity. An earlier unknown enumerable option can fail first.

```js
const { CreateEntityByClassName } = require("entities/factories");
const { LogInfo } = require("loggers");

const g_ExerciseEntityCreationOptions = function ExerciseEntityCreationOptions() {
	const MarkerEntity = CreateEntityByClassName("info_target", {
		DispatchSpawn: true,
		KeyValues: {
			origin: [32, 64, 128],
			targetname: "sourcejs_spawned_marker",
		},
	});
	if (!MarkerEntity) {
		throw new Error("Failed to create the spawned marker.");
	}

	try {
		LogInfo("ExerciseEntityCreationOptions Result=%j", { Valid: MarkerEntity.Valid, ClassName: MarkerEntity.ClassName, EntityIndex: MarkerEntity.Index });
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the spawned marker.");
		}
	}
};

g_ExerciseEntityCreationOptions();
```

Own `DispatchSpawn` and `KeyValues` properties select the options form even when non-enumerable. Once either is present, additional own enumerable string keys are rejected. Put entity KeyValues inside `KeyValues` instead of mixing the direct and options forms.

## KeyValue types

SourceJS selects one of the real `IServerTools::SetKeyValue` overloads. Values are not converted with `String()`. The table uses guide-style parameter names; CSGO/L4D2 use `void*` for the entity argument, while TF2 uses `CBaseEntity*`. It describes overload shapes, not verbatim SDK declarations.

| JavaScript value | Native overload | Rules |
| --- | --- | --- |
| string | `SetKeyValue(void* pEntity, char const* pszKeyName, char const* pszValue)` | Empty strings are valid values; embedded NUL bytes are rejected instead of silently truncating the SDK string. |
| number | `SetKeyValue(void* pEntity, char const* pszKeyName, float flValue)` | Primitive finite Number in the native float range; conversion rounds to single precision and can underflow to zero. |
| `[X, Y, Z]` | `SetKeyValue(void* pEntity, char const* pszKeyName, Vector const& VectorValue)` | Exactly three finite numeric elements. |
| `{ X, Y, Z }` | `SetKeyValue(void* pEntity, char const* pszKeyName, Vector const& VectorValue)` | All three own properties must be finite numbers; live `mathlib.Vector` objects also work. |

Booleans, `null`, `BigInt`, functions, arbitrary objects, and incomplete vectors throw. Use explicit Source strings such as `"0"` or `"1"` when an entity key expects textual boolean syntax.

Vector components must be actual JavaScript numbers within the finite native float range; strings, booleans, `null`, and objects with `valueOf()` are not coerced. Getter or proxy-descriptor failures preserve the original exception and stop later parser reads. KeyValue records, vectors, option outputs, and KeyValue lists are committed only after successful validation, not partially updated on failure.

The creation helpers validate all JavaScript KeyValue shapes before allocating the entity. A native key can still be rejected for a particular class. Creation continues and returns the entity in that case; use individual `SetEntityKeyValue()` calls when each native boolean result matters.

## Returned Entity objects

Factory and Hammer-ID lookups return an undecorated native-backed Entity wrapper. Its getters resolve current engine state, but `Edict`, `BaseEntity`, and `BaseHandle` create ordinary JavaScript records on each read. Saved records do not refresh, and changing them does not write native state; re-read the Entity property for current values. Returned descriptors and addresses are borrowed snapshots, not ownership or a lifetime guarantee.

### Live fields

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index captured by this wrapper. |
| `Valid` | read-only boolean | Whether that edict currently exists and is occupied. |
| `Free` | writable boolean | Current edict free flag. Writing it bypasses normal removal. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | writable integer | Current `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | writable integer | Current edict serial number. Normally engine-owned. |
| `Edict` | read-only object or `null` | Point-in-time address record for the current `edict_t`. |
| `BaseEntity` | read-only object or `null` | Point-in-time address record for the current `CBaseEntity`. |
| `Address` | read-only `BigInt` | Native `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Point-in-time SDK handle record, not a live handle reference. |
| `HandleValue` | read-only integer | Packed handle value, or `-1` when unavailable. |

Only these PascalCase live fields are installed. Lower-camel compatibility aliases are not present.

Factory and Hammer-ID callbacks return the same undecorated native Entity wrapper as `GetNativeEntityByIndex()` from [`entities/entity`](entities-entity.md). Native methods can include `RemoveEntity()`, `SlayEntity()`, `CallEntityInput()`, and send-property or datamap access according to the selected SDK. The factories module does not run `DecorateEntity()`, so reflection conveniences, timers, sound, and model or hitbox helpers are not added automatically. Resolve the current `Index` through `Entity()` when those decorated helpers are required. Unsupported methods are omitted. Do not retain an Entity object as permanent identity after deletion because Source can reuse its index.

## Creation and spawning

### `CreateEntityByClassName(strClassName, Options?)`

`CreateEntityByClassName()` calls `CreateEntityByName`, applies validated KeyValues in own-property order, and dispatches spawn only when `DispatchSpawn === true`. It returns `null` if native creation produces no entity.

Use staged creation when fields must be checked before spawn:

```js
const {
	CreateEntityByClassName,
	DispatchEntitySpawn,
	GetEntityKeyValue,
	SetEntityKeyValue,
} = require("entities/factories");

const g_ExerciseStagedEntityCreation = function ExerciseStagedEntityCreation() {
	const strKeyName = "targetname";
	const strExpectedTargetName = "sourcejs_staged_marker";
	const MarkerEntity = CreateEntityByClassName("info_target");
	if (!MarkerEntity) {
		throw new Error("Failed to allocate info_target.");
	}

	try {
		if (!SetEntityKeyValue(MarkerEntity, strKeyName, strExpectedTargetName)) {
			throw new Error("info_target rejected targetname.");
		}

		if (GetEntityKeyValue(MarkerEntity, strKeyName) !== strExpectedTargetName) {
			throw new Error("The staged KeyValue did not round-trip.");
		}

		if (!DispatchEntitySpawn(MarkerEntity)) {
			throw new Error("Unable to dispatch spawn for the staged marker.");
		}
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the staged marker.");
		}
	}
};

g_ExerciseStagedEntityCreation();
```

`DispatchEntitySpawn()` is not an idempotency guard. Call it once for a newly allocated unspawned entity unless the selected game explicitly documents another lifecycle.

### `CreateAndSpawnEntityByClassName(strClassName, Options?)`

`CreateAndSpawnEntityByClassName()` is the concise path when all pre-spawn KeyValues are already known:

```js
const {
	CreateAndSpawnEntityByClassName,
	GetEntityKeyValue,
} = require("entities/factories");
const { LogInfo } = require("loggers");

const g_ExerciseCreateAndSpawnEntity = function ExerciseCreateAndSpawnEntity() {
	const strExpectedTargetName = "sourcejs_ready_marker";
	const MarkerEntity = CreateAndSpawnEntityByClassName("info_target", {
		KeyValues: {
			origin: { X: 128, Y: 0, Z: 64 },
			targetname: strExpectedTargetName,
		},
	});
	if (!MarkerEntity) {
		throw new Error("Failed to create and spawn info_target.");
	}

	try {
		const strTargetName = GetEntityKeyValue(MarkerEntity, "targetname");
		if (strTargetName !== strExpectedTargetName) {
			throw new Error(`Unexpected spawned marker targetname: ${strTargetName}`);
		}

		LogInfo("ExerciseCreateAndSpawnEntity Result=%j", { Origin: GetEntityKeyValue(MarkerEntity, "origin"), TargetName: strTargetName, EntityIndex: MarkerEntity.Index });
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the ready marker.");
		}
	}
};

g_ExerciseCreateAndSpawnEntity();
```

## KeyValue access

### `SetEntityKeyValue(Entity, strKeyName, Value)`

The key must be a non-empty string without embedded NUL bytes. The return value is the selected SDK's actual acceptance result, so check it for class-specific or misspelled keys.

The key and complete value are validated before resolving the entity selector. Array and component getters can run JavaScript, so entity-selector getters run afterwards. The selected index is then looked up against current engine state; an index with no live entity is rejected before any SDK write. This does not pin an entity or make an index stable across deletion and reuse.

```js
const {
	CreateEntityByClassName,
	GetEntityKeyValue,
	SetEntityKeyValue,
} = require("entities/factories");
const { LogInfo } = require("loggers");

const g_ExerciseTypedEntityKeyValues = function ExerciseTypedEntityKeyValues() {
	const MarkerEntity = CreateEntityByClassName("info_target");
	if (!MarkerEntity) {
		throw new Error("Failed to allocate a KeyValue test entity.");
	}

	try {
		const vecKeyValueUpdates = [
			["targetname", "sourcejs_typed_marker"],
			["spawnflags", 4],
			["origin", [16, 32, 48]],
		];
		for (const [strKeyName, Value] of vecKeyValueUpdates) {
			if (!SetEntityKeyValue(MarkerEntity, strKeyName, Value)) {
				throw new Error(`info_target rejected ${strKeyName}.`);
			}
		}

		LogInfo("ExerciseTypedEntityKeyValues Result=%j", { Origin: GetEntityKeyValue(MarkerEntity, "origin"), SpawnFlags: GetEntityKeyValue(MarkerEntity, "spawnflags"), TargetName: GetEntityKeyValue(MarkerEntity, "targetname") });
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the KeyValue test entity.");
		}
	}
};

g_ExerciseTypedEntityKeyValues();
```

### `GetEntityKeyValue(Entity, strKeyName, nMaximumLength?)`

The native API writes a textual representation into a caller-provided buffer. SourceJS allocates 256 bytes by default. `nMaximumLength` may be omitted, `undefined`, `null`, or a positive JavaScript `Int32`. The length includes room for the terminating null byte.

`strKeyName` must be non-empty and NUL-free. A NUL-containing name is rejected before the SDK getter is called, so it cannot silently query a different, prefix-only key.

If the SDK reports success without a null terminator inside that buffer, SourceJS throws instead of reading beyond the allocation. SDK failure still returns `null`.

```js
const {
	CreateEntityByClassName,
	GetEntityKeyValue,
	SetEntityKeyValue,
} = require("entities/factories");

const g_ExerciseEntityKeyValueBufferSize = function ExerciseEntityKeyValueBufferSize() {
	const MarkerEntity = CreateEntityByClassName("info_target");
	if (!MarkerEntity) {
		throw new Error("Failed to allocate a buffer-size example entity.");
	}

	try {
		const strKeyName = "targetname";
		const strExpectedName = "sourcejs_marker_with_a_deliberately_long_name";
		if (!SetEntityKeyValue(MarkerEntity, strKeyName, strExpectedName)) {
			throw new Error("info_target rejected targetname.");
		}

		const nMaximumLength = 1024;
		const strActualName = GetEntityKeyValue(MarkerEntity, strKeyName, nMaximumLength);
		if (strActualName !== strExpectedName) {
			throw new Error(`Unexpected targetname: ${strActualName}`);
		}
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the buffer-size example entity.");
		}
	}
};

g_ExerciseEntityKeyValueBufferSize();
```

The function returns `null` when `IServerTools::GetKeyValue` returns `false`. Buffer-too-small behavior is SDK-defined; request enough space instead of relying on truncation.

## Hammer IDs

Hammer IDs belong to map-authored entities and are not edict indexes, handles, or addresses. `FindEntityByHammerID()` performs a current server-tools lookup for a non-negative JavaScript `Int32`.

`DestroyEntityByHammerID()` is destructive and may permanently remove map logic for the current level. Guard it with both an expected class and a private target name rather than accepting arbitrary console input:

```js
const {
	DestroyEntityByHammerID,
	FindEntityByHammerID,
	GetEntityKeyValue,
} = require("entities/factories");
const { LogInfo } = require("loggers");

const g_DestroyOwnedHammerEntity = function DestroyOwnedHammerEntity() {
	if (typeof DestroyEntityByHammerID !== "function") {
		throw new Error("This SDK cannot destroy entities by Hammer ID.");
	}

	const nHammerID = 4242;
	const strExpectedTargetName = "sourcejs_disposable_marker";
	const HammerEntity = FindEntityByHammerID(nHammerID);
	if (!HammerEntity || (HammerEntity.ClassName !== "info_target") || (GetEntityKeyValue(HammerEntity, "targetname") !== strExpectedTargetName)) {
		throw new Error(`Hammer ID ${nHammerID} is not the owned disposable marker.`);
	}

	if (!DestroyEntityByHammerID(nHammerID)) {
		throw new Error(`Unable to destroy owned Hammer ID ${nHammerID}.`);
	}

	LogInfo("DestroyOwnedHammerEntity Result=%j", { Destroyed: true, HammerID: nHammerID });
};

g_DestroyOwnedHammerEntity();
```

Use `EntityInstance.RemoveEntity()` for plugin-created temporary entities. Reserve `DestroyEntityByHammerID()` for a map integration that deliberately owns the matching map entity.

## Practical workflows

### Spawn a named marker and remove it on unload

```js
const { CreateAndSpawnEntityByClassName } = require("entities/factories");

const g_setOwnedEntityRecords = new Set();

const g_CreateOwnedMarker = function CreateOwnedMarker() {
	const MarkerEntity = CreateAndSpawnEntityByClassName("info_target", { origin: { X: 0, Y: 0, Z: 128 }, targetname: "sourcejs_owned_marker" });
	if (!MarkerEntity) {
		throw new Error("Unable to create the plugin-owned marker.");
	}

	const nHandleValue = MarkerEntity.HandleValue;
	if (nHandleValue === -1) {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the marker without a native handle.");
		}

		throw new Error("The marker has no native handle for deferred cleanup.");
	}

	g_setOwnedEntityRecords.add({ Entity: MarkerEntity, HandleValue: nHandleValue, NetworkSerialNumber: MarkerEntity.NetworkSerialNumber });
};

const g_UnloadPlugin = function UnloadPlugin() {
	let bRemovalFailed = false;

	for (const OwnedEntityRecord of g_setOwnedEntityRecords) {
		const OwnedEntity = OwnedEntityRecord.Entity;
		if (!OwnedEntity.Valid || (OwnedEntity.HandleValue !== OwnedEntityRecord.HandleValue) || (OwnedEntity.NetworkSerialNumber !== OwnedEntityRecord.NetworkSerialNumber)) {
			continue;
		}

		if (!OwnedEntity.RemoveEntity()) {
			bRemovalFailed = true;
		}
	}

	g_setOwnedEntityRecords.clear();

	if (bRemovalFailed) {
		throw new Error("Unable to remove one or more plugin-owned entities.");
	}
};

g_CreateOwnedMarker();

module.exports.Unload = g_UnloadPlugin;
```

The saved handle and network serial detect a replacement at the same index; checking only `Valid` is insufficient. `-1` means the native handle is unavailable, while other negative packed handles can be valid. These finite-generation snapshots do not pin native lifetime or provide permanent identity. Keep this ownership set within one map and discard it at level shutdown if the plugin persists across maps. The case-sensitive SourceJS-owned `Unload` property is the plugin lifecycle contract; no lowercase alias is installed.

### Clone selected textual KeyValues into a new entity

This copies only an explicit allowlist. It does not treat an Entity as a serializable snapshot.

```js
const {
	CreateEntityByClassName,
	DispatchEntitySpawn,
	GetEntityKeyValue,
	SetEntityKeyValue,
} = require("entities/factories");
const { LogInfo } = require("loggers");

const g_CloneMarkerEntity = function CloneMarkerEntity(SourceEntity) {
	const nMaximumLength = 1024;
	const CloneEntity = CreateEntityByClassName("info_target");
	if (!CloneEntity) {
		throw new Error("Unable to allocate the marker clone.");
	}

	try {
		for (const strKeyName of ["origin", "targetname"]) {
			const strValue = GetEntityKeyValue(SourceEntity, strKeyName, nMaximumLength);
			if (strValue === null) {
				throw new Error(`Source marker did not expose ${strKeyName}.`);
			}

			if (!SetEntityKeyValue(CloneEntity, strKeyName, strValue)) {
				throw new Error(`Clone rejected ${strKeyName}.`);
			}
		}

		if (!DispatchEntitySpawn(CloneEntity)) {
			throw new Error("Unable to dispatch spawn for the marker clone.");
		}

		return CloneEntity;
	} catch (CaughtError) {
		if (CloneEntity.Valid && !CloneEntity.RemoveEntity()) {
			throw new Error("Unable to remove the incomplete marker clone.", { cause: CaughtError });
		}

		throw CaughtError;
	}
};

const g_ExerciseMarkerClone = function ExerciseMarkerClone() {
	const SourceEntity = CreateEntityByClassName("info_target", { origin: [8, 16, 24], targetname: "sourcejs_clone_source" });
	if (!SourceEntity) {
		throw new Error("Unable to create the marker clone source.");
	}

	let CloneEntity = null;

	try {
		CloneEntity = g_CloneMarkerEntity(SourceEntity);
		LogInfo("ExerciseMarkerClone Result=%j", { CloneEntityIndex: CloneEntity.Index, SourceEntityIndex: SourceEntity.Index });
	} finally {
		const bCloneRemoved = !CloneEntity || !CloneEntity.Valid || CloneEntity.RemoveEntity();
		const bSourceRemoved = !SourceEntity.Valid || SourceEntity.RemoveEntity();
		if (!bCloneRemoved || !bSourceRemoved) {
			throw new Error("Unable to remove the marker clone or its source.");
		}
	}
};

g_ExerciseMarkerClone();
```

The clone writes textual values because `GetEntityKeyValue()` returns text. Use typed native entity properties or datamaps to preserve binary types and live-memory semantics.

## Ownership and safety

- `CreateEntityByClassName()` and `CreateAndSpawnEntityByClassName()` allocate engine entities; SourceJS does not automatically remove them when the plugin unloads.
- Apply required KeyValues before `DispatchEntitySpawn()`. Some games initialize or cache state during spawn.
- Check `SetEntityKeyValue()` results for class-specific keys. A valid JavaScript value does not guarantee the entity class accepts that key.
- Keep explicit ownership of every plugin-created entity. Remove owned entities while their map is still live, and discard ownership records at level shutdown before a new map can reuse indexes.
- After removal, the Entity object can become invalid and its edict index can be reused. An old wrapper can become `Valid` again for a different entity; compare saved handle and serial values before deferred cleanup, within the same map.
- Do not change `Free` or `NetworkSerialNumber` to manage ownership; those fields are engine-owned lifecycle state, not an alternative to normal entity removal.
- Native addresses are borrowed `BigInt` values, not retained entities. Keep factory, lookup, KeyValue, and removal calls on the game thread.
- `FindEntityByHammerID()` returns current map state, not a retained identity or discovery snapshot.
- `DestroyEntityByHammerID()` is not a generic replacement for `RemoveEntity()` and should never accept an unvalidated public ID.
- The JavaScript [`keyvalues`](keyvalues.md) module wraps Valve `KeyValues` trees. It is a different API and its handles are not accepted as entity KeyValue option objects here.

## Common mistakes

- Passing `"info_target"` is valid; passing an object, number, or empty class name is not.
- Passing `false`, `null`, an array, or a function as `Options` throws instead of being ignored.
- Do not mix canonical `{ DispatchSpawn, KeyValues }` options with direct entity keys in the same object.
- `CreateAndSpawnEntityByClassName()` does not accept `DispatchSpawn`; it always spawns.
- Key names are non-empty strings without embedded NUL bytes. Values are NUL-free strings, primitive Numbers within the finite native float range, or complete three-component vectors whose numeric components fit the same range.
- A boolean entity value must be encoded explicitly in the textual or numeric form expected by that class.
- `GetEntityKeyValue()` returns text even when the value was set through the float or Vector overload.
- Hammer IDs, edict indexes, and BigInt native addresses are distinct identifiers.
- A `null` creation or lookup result is a real native failure or no-match result, not a fallback Entity.

## Related modules

- [`entities`](entities.md) for current world scans and decorated operations.
- [`entities/entity`](entities-entity.md) for native Entity fields, methods, and the optional decorated wrapper.
- [`entities/engines`](entities-engines.md) for the selected-SDK minimal creation and scan object.
- [`entities/props`](entities-props.md) for typed live send-property access.
- [`entities/datamaps`](entities-datamaps.md) for typed live datamap access and direct inputs.
- [`entities/outputs`](entities-outputs.md) for map output hooks.
- [`keyvalues`](keyvalues.md) for Valve `KeyValues` trees rather than entity KeyValues.
