# `require("entities/engines")`

> AI-processing note: this page is a hand-maintained reference for the complete selected-SDK entity router. The module is a direct native CommonJS object; it does not aggregate game namespaces or recreate HL2SDK behavior in JavaScript.

`entities/engines` exposes the entity operations shared by the exact HL2SDK branch used to build the loaded SourceJS binary. It is useful when plugin code needs to report its selected branch, resolve native entities directly, or create an entity only when that SDK exposes `IServerTools`.

The [package facade](../../packages/sourcejs/entities/engines.js) returns the native object registered in [ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp); it adds no JavaScript entity lookup or creation implementation.

## Table of contents

- [Import](#import)
- [SDK ownership and capabilities](#sdk-ownership-and-capabilities)
- [Returned entity objects](#returned-entity-objects)
- [API reference](#api-reference)
- [Practical workflows](#practical-workflows)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Import

The maximum canonical surface has five exports. `CreateEntityByClassName` is omitted when the selected SDK has no supported server-tools interface.

```js
const {
	BRANCH,
	CreateEntityByClassName,
	FindEntityByClassName,
	GetEntitiesByClassName,
	GetEntityByIndex,
} = require("entities/engines");
```

These five names are the complete maximum public surface. The package does not export `branch`, `entity`, `byClassName`, `find`, `create`, `available`, `isAvailable`, `byIndex`, `Entity`, a nested CS:GO namespace, `moduleName`, or a default export.

## SDK ownership and capabilities

`BRANCH` reports the exact Source 1 HL2SDK branch compiled into the binary, such as `l4d2`, `tf2`, `css`, or `csgo`. It is not inferred from a JavaScript profile. Assigning another value to the JavaScript property cannot change the compiled SDK selection. The complete supported branch list and per-architecture build matrix are documented in [SDK support](../sdk-support.md).

The branch constant and three lookup exports are always installed with the module:

- `BRANCH`
- `GetEntityByIndex`
- `GetEntitiesByClassName`
- `FindEntityByClassName`

`CreateEntityByClassName` is installed only when SourceJS was compiled with `SOURCEJS_HAS_SERVER_TOOLS`. It calls the selected SDK's real `IServerTools::CreateEntityByName`; a missing runtime server-tools interface can still make the operation throw. Unsupported builds omit the property. Calling an absent `CreateEntityByClassName(...)` value therefore produces the ordinary JavaScript `TypeError` for invoking `undefined`; no throw-only fallback is installed.

Entity scans read the current edict array on every call. Their arrays are point-in-time membership results, while each returned Entity remains a live native view. Re-run `GetEntitiesByClassName()` when current membership matters.

Call these synchronous engine operations on the server/game thread. Entity wrappers borrow engine-owned state: they neither keep an entity alive nor reserve its index. Resolve and validate the entity again after any deferred callback; a reused index can refer to a different entity.

## Returned entity objects

`GetEntityByIndex()`, `GetEntitiesByClassName()`, `FindEntityByClassName()`, and `CreateEntityByClassName()` return the same selected-SDK Entity shape as [`entities`](entities.md) and [`entities/entity`](entities-entity.md).

### Live fields

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index represented by this wrapper; does not pin the current occupant. |
| `Valid` | read-only boolean | Whether that edict exists and is not free. |
| `Free` | live boolean | Writable edict free flag; normally engine-owned. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | live integer | Writable `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | live integer | Writable edict serial number, normally engine-owned. |
| `Edict` | read-only object or `null` | Point-in-time address record for the current `edict_t`. |
| `BaseEntity` | read-only object or `null` | Point-in-time address record for the current `CBaseEntity`. |
| `Address` | read-only `BigInt` | Native `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Point-in-time SDK handle record, not a live handle reference. |
| `HandleValue` | read-only integer | Packed handle value, or `-1` when unavailable. |

The `Edict`, `BaseEntity`, and `BaseHandle` getters create ordinary JavaScript records on each read. Those records do not refresh themselves, own native storage, or keep an entity alive. Changing a record does not write native state. Re-read the Entity property for current values; a saved address or handle must not be reused after deletion or index reuse.

Only the PascalCase live-field names in the table are installed. Plain spellings such as `index`, `valid`, `className`, and `address` are not Entity properties.

Every returned Entity exposes `RemoveEntity()`. The selected SDK's `CBaseEntity::AcceptInput` capability adds `SlayEntity()` and `CallEntityInput(strInputName, InputValue?, flInputDelay?)`; sendprop and datamap methods are also installed only when their native systems exist. The objects expose native `Address` values as `BigInt`, never as `Number`, strings, or address wrappers.

Only the canonical PascalCase methods are installed. Lower-camel-case spellings such as `remove`, `slay`, `callInput`, `getProperty*`, `setProperty*`, `getDataMap*`, and `setDataMap*` are not Entity methods.

## API reference

### `BRANCH`

```text
BRANCH: string
```

The build-time SDK branch identifier. It matches the branch used by CMake, packaged data routing, and the SourceJS artifact name.

### `GetEntityByIndex(nEntityIndex)`

```text
GetEntityByIndex(nEntityIndex) -> Entity | null
```

Requires an integer Number in the signed-32-bit range; missing arguments, strings, BigInt, and out-of-range values throw. Returns the current live Entity, or `null` for a negative, absent, or free edict index. It does not cache the result.

### `GetEntitiesByClassName(strClassName)`

```text
GetEntitiesByClassName(strClassName) -> Entity[]
```

Requires a non-empty string and returns every current non-free edict whose class name matches exactly. The search is case-sensitive and does not accept glob or prefix patterns.

### `FindEntityByClassName(strClassName)`

```text
FindEntityByClassName(strClassName) -> Entity | null
```

Requires a non-empty string and returns the first matching current entity in edict-index order, or `null` when no match exists.

### `CreateEntityByClassName(strClassName, Options?)`

```text
CreateEntityByClassName(strClassName, Options?) -> Entity | null
```

This capability is optional. It requires a non-empty class-name string without NUL bytes and returns the native entity produced by `IServerTools`, or `null` if the SDK factory cannot create that class.

The optional object supports a wrapped-options form and a direct-KeyValues form. The wrapped form accepts only the canonical property spellings:

| Form | Meaning |
| --- | --- |
| `{ DispatchSpawn?, KeyValues? }` | Optionally control whether `DispatchSpawn` runs (defaults to `false`) and provide a non-array, non-function KeyValue object. |
| `{ targetname: "...", origin: { X, Y, Z }, ... }` | Treat the whole object as direct KeyValues; `DispatchSpawn` defaults to `false`. |

An omitted or `undefined` second argument uses the defaults; otherwise it must be a non-array, non-function object (`null` is rejected). The dispatch-spawn option must be a boolean, and once either canonical reserved own option key is present, other enumerated own option names are rejected. Direct or nested KeyValues accept only strings, finite numbers, exact three-element arrays, or objects with all three own finite numeric `X`, `Y`, and `Z` properties. Key names must be non-empty, and names/string values must contain no NUL bytes. Numeric values and vector components must fit finite native float storage and are passed through the SDK's float/vector overloads, not exact 64-bit integer storage. Creation validates the complete JavaScript shape before allocation and forwards values through the selected SDK's real server-tools overloads. Creation does not make SourceJS the long-term owner of the engine entity; remove temporary entities explicitly.

KeyValue names such as `origin` and `targetname` retain their exact engine spelling; they are not project-owned PascalCase option or vector-component names.

## Practical workflows

### Report the selected SDK and inspect one class

```js
const {
	BRANCH,
	FindEntityByClassName,
	GetEntitiesByClassName,
	GetEntityByIndex,
} = require("entities/engines");
const { LogInfo } = require("loggers");

const g_strPhysicsPropClassName = "prop_physics";
const g_vecPhysicsProps = GetEntitiesByClassName(g_strPhysicsPropClassName);
const g_FirstPhysicsProp = FindEntityByClassName(g_strPhysicsPropClassName);
if (!g_FirstPhysicsProp) {
	throw new Error("The current map has no prop_physics entity.");
}

const g_nFirstPhysicsPropHandleValue = g_FirstPhysicsProp.HandleValue;
if (g_nFirstPhysicsPropHandleValue === -1) {
	throw new Error("The prop_physics entity has no valid packed handle.");
}

const g_ResolvedPhysicsProp = GetEntityByIndex(g_FirstPhysicsProp.Index);
if (!g_ResolvedPhysicsProp || (g_ResolvedPhysicsProp.HandleValue !== g_nFirstPhysicsPropHandleValue)) {
	throw new Error("The prop_physics identity changed during resolution.");
}

LogInfo("InspectEngineEntities Result=%j", { SDKBranch: BRANCH, FirstEntityIndex: g_FirstPhysicsProp.Index, PhysicsPropCount: g_vecPhysicsProps.length, ResolvedEntityIndex: g_ResolvedPhysicsProp.Index });
```

The two Entity wrappers can be different JavaScript objects even when they represent the same index. Validate and snapshot the original `HandleValue` before the second lookup and compare it with the resolved handle. Check the unavailable `-1` sentinel, not the sign of the packed value. Comparing both live getters afterward can miss index reuse because both wrappers may already observe the replacement. A valid handle snapshot detects that mismatch; it does not extend the entity's lifetime.

### Read live entity state

```js
const { GetEntityByIndex } = require("entities/engines");
const { LogInfo } = require("loggers");

const g_WorldEntity = GetEntityByIndex(0);
if (!g_WorldEntity) {
	throw new Error("The world entity is not available yet.");
}

LogInfo("ReadEngineEntity Result=%j", { Valid: g_WorldEntity.Valid, HandleValue: g_WorldEntity.HandleValue, Address: `0x${g_WorldEntity.Address.toString(16).toUpperCase()}`, ClassName: g_WorldEntity.ClassName, EntityIndex: g_WorldEntity.Index, StateFlags: g_WorldEntity.StateFlags });
```

### Create, spawn, use, and remove an entity

Capability checks should inspect the actual property, not a branch-name allowlist:

```js
const { BRANCH, CreateEntityByClassName } = require("entities/engines");
const { LogInfo } = require("loggers");

const g_CreateUseAndRemoveEntity = function CreateUseAndRemoveEntity() {
	if (typeof CreateEntityByClassName !== "function") {
		throw new Error(`Entity creation is unavailable on ${BRANCH}.`);
	}

	const MarkerEntity = CreateEntityByClassName("info_target", {
		DispatchSpawn: true,
		KeyValues: {
			origin: { X: 0, Y: 0, Z: 64 },
			targetname: "sourcejs_engine_marker",
		},
	});
	if (!MarkerEntity) {
		throw new Error("The selected SDK could not create info_target.");
	}

	try {
		if (typeof MarkerEntity.CallEntityInput !== "function") {
			throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput.");
		}

		if (!MarkerEntity.CallEntityInput("FireUser1")) {
			throw new Error("The temporary marker rejected FireUser1.");
		}

		LogInfo("CreateEngineMarker Result=%j", { ClassName: MarkerEntity.ClassName, EntityIndex: MarkerEntity.Index });
	} finally {
		if (MarkerEntity.Valid && !MarkerEntity.RemoveEntity()) {
			throw new Error("Unable to remove the temporary marker.");
		}
	}
};

g_CreateUseAndRemoveEntity();
```

Use [`entities/factories`](entities-factories.md) when dispatch, Hammer ID, or KeyValue operations are the main task. `CreateEntityByClassName()` is the minimal selected-SDK creation entrypoint.

## Errors and common mistakes

- `GetEntityByIndex(nEntityIndex)` requires a JavaScript `Int32` index. Strings such as `"1"` and integers outside the `Int32` range are invalid.
- `GetEntitiesByClassName()` and `FindEntityByClassName()` require a non-empty string. Numbers and booleans are not converted to class names.
- An empty scan array and `FindEntityByClassName() === null` are normal no-match results, not fallback entities.
- `CreateEntityByClassName()` is optional; verify that the export is a function before calling it, and do not infer availability from `BRANCH`.
- `CreateEntityByClassName(..., { DispatchSpawn: false })` returns an unspawned engine allocation. Dispatch it later through [`entities/factories`](entities-factories.md) or remove it.
- Arrays returned by `GetEntitiesByClassName()` do not gain later creations or lose deleted entities automatically.
- A live Entity can become invalid after deletion, and Source can reuse its index. Do not retain it as permanent identity.
- `BRANCH` reports the compiled native ABI selection. Changing the property does not switch SDKs or enable game-specific APIs from another SDK module.

## Related modules

- [`entities`](entities.md) provides the complete cross-SDK entity and decoration API.
- [`entities/entity`](entities-entity.md) is the direct decorated Entity factory.
- [`entities/factories`](entities-factories.md) exposes the complete server-tools lifecycle when available.
- [`entities/dictionary`](entities-dictionary.md) provides listener-backed lazy and synchronized caches.
- [`entities/engines/csgo/csgo`](entities-engines-csgo-csgo.md) owns CS:GO-only item-definition operations and is omitted on other games.
