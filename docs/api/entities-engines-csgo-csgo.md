# `require("entities/engines/csgo/csgo")`

> AI-processing note: this page is a hand-maintained reference for the complete CS:GO entity engine module. The module is a direct native CommonJS object installed only by a CS:GO build with sendprop support.

`entities/engines/csgo/csgo` combines the selected-SDK entity lookup surface with direct access to CS:GO's `m_iItemDefinitionIndex` network property. Use it when a plugin must inspect or temporarily change the concrete economy item represented by a weapon entity.

The [package facade](../../packages/sourcejs/entities/engines/csgo/csgo.js) returns the native object registered in [ModuleBindings.cpp](../../src/sourcejs/modules/ModuleBindings.cpp); it adds no JavaScript lookup or property-write implementation.

## Table of contents

- [Import](#import)
- [Availability and ownership](#availability-and-ownership)
- [Returned entity objects](#returned-entity-objects)
- [API reference](#api-reference)
- [Practical workflows](#practical-workflows)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Import

The maximum canonical surface has eight exports. `CreateEntityByClassName` is omitted when the CS:GO build has no supported server-tools interface.

```js
const {
	BRANCH,
	ITEM_DEFINITION_PROPERTY,
	CreateEntityByClassName,
	FindEntityByClassName,
	GetEntitiesByClassName,
	GetEntityByIndex,
	GetEntityItemDefinitionIndex,
	SetEntityItemDefinitionIndex,
} = require("entities/engines/csgo/csgo");
```

These eight names are the complete maximum public surface. The package does not export lowercase or mixed-case aliases, a JavaScript `Entity` subclass, `ModuleName`, or a default export. There is no shorter `entities/engines/csgo` module path.

## Availability and ownership

| Use | Example |
| --- | --- |
| Check the branch tag after successfully importing the CS:GO-specific module. | `const bUsesCSGOEntities = (BRANCH === "csgo");` |

The complete module is installed only when SourceJS is built for `ENGINE_CSGO` with sendprop support. Requiring it on L4D2, TF2, CSS, or another SDK throws the normal missing-native-module error. No game-neutral substitute is installed.

`BRANCH` is therefore `"csgo"` for a valid module. Test the module by requiring it as part of a CS:GO-only plugin or by declaring the plugin's SDK requirement; do not catch the error and continue with guessed property offsets.

`CreateEntityByClassName` is a separate capability. It exists only when the same binary exposes `IServerTools::CreateEntityByName`. Check the actual property:

```js
const { CreateEntityByClassName } = require("entities/engines/csgo/csgo");
const { LogInfo } = require("loggers");

LogInfo("InspectCSGOEntityCreation Result=%j", { CanCreateNativeEntities: typeof CreateEntityByClassName === "function" });
```

The item-definition functions resolve the sendprop on every call. They do not cache an offset in JavaScript and do not fall back to a datamap or hardcoded memory layout.

Call these synchronous engine operations on the server/game thread. Returned Entity wrappers borrow engine-owned state: they neither keep an entity alive nor reserve its index. Resolve and validate the entity again after any deferred callback; a reused index can refer to a different entity.

## Returned entity objects

`GetEntityByIndex()`, `GetEntitiesByClassName()`, `FindEntityByClassName()`, and `CreateEntityByClassName()` return the same live native Entity values used by the root entity modules.

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index represented by this wrapper; does not pin the current occupant. |
| `Valid` | read-only boolean | Whether the represented edict currently exists and is not free. |
| `Free` | live boolean | Writable edict free flag, normally owned by the engine. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | live integer | Writable `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | live integer | Writable edict serial number, normally engine-owned. |
| `Edict` | read-only object or `null` | Point-in-time address record for the current `edict_t`. |
| `BaseEntity` | read-only object or `null` | Point-in-time address record for the current `CBaseEntity`. |
| `Address` | read-only `BigInt` | Native `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Point-in-time SDK handle record, not a live handle reference. |
| `HandleValue` | read-only integer | Packed handle value, or `-1` when unavailable. |

The `Edict`, `BaseEntity`, and `BaseHandle` getters create ordinary JavaScript records on each read. Those records do not refresh themselves, own native storage, or keep an entity alive. Changing a record does not write native state. Re-read the Entity property for current values; a saved address or handle must not be reused after deletion or index reuse.

Only the canonical PascalCase field names in the table are installed. Lowercase and mixed-case aliases are not Entity properties.

Every returned Entity exposes `RemoveEntity()`. The selected SDK's `CBaseEntity::AcceptInput` capability adds `SlayEntity()` and `CallEntityInput(strInputName, InputValue?, flInputDelay?)`. Because this module requires sendprops, its Entity values also expose the selected-SDK sendprop accessors documented by [`entities/props`](entities-props.md).

Only the canonical PascalCase methods are installed. Lowercase and mixed-case aliases are not Entity methods.

Arrays returned by `GetEntitiesByClassName()` are point-in-time membership arrays. Their Entity elements remain live, but the array does not update when entities are created or deleted.

## API reference

### `BRANCH`

```text
BRANCH: "csgo"
```

The build-time HL2SDK branch identifier.

### `ITEM_DEFINITION_PROPERTY`

```text
ITEM_DEFINITION_PROPERTY: "m_AttributeManager.m_Item.m_iItemDefinitionIndex"
```

The exact CS:GO sendprop path used by both item-definition helpers. It is useful when the same property must be passed to a generic Entity sendprop accessor.

### `GetEntityByIndex(nEntityIndex)`

```text
GetEntityByIndex(nEntityIndex) -> Entity | null
```

Requires an integer Number in the signed-32-bit range; missing arguments, strings, BigInt, and out-of-range values throw. Returns a current live Entity, or `null` for a negative, absent, or free edict index.

### `GetEntitiesByClassName(strClassName)`

```text
GetEntitiesByClassName(strClassName) -> Entity[]
```

Requires a non-empty string and returns every current non-free edict whose class name matches exactly. Matching is case-sensitive and does not support wildcards.

### `FindEntityByClassName(strClassName)`

```text
FindEntityByClassName(strClassName) -> Entity | null
```

Requires a non-empty string and returns the first exact class-name match in edict-index order, or `null`.

### `CreateEntityByClassName(strClassName, Options?)`

```text
CreateEntityByClassName(strClassName, Options?) -> Entity | null
```

This export is optional. It calls the real CS:GO `IServerTools::CreateEntityByName` and returns the new live Entity, or `null` when the engine cannot create the class. Its presence indicates compiled capability; a missing runtime server-tools interface can still make the operation throw. The class name must be non-empty and contain no NUL bytes.

The optional object supports a wrapped-options form and a direct-KeyValues form. The wrapped form accepts only the canonical property spellings:

| Form | Meaning |
| --- | --- |
| `{ DispatchSpawn?, KeyValues? }` | Optionally set `DispatchSpawn` (defaults to `false`) and provide a non-array, non-function KeyValue object. |
| `{ targetname: "...", origin: { X, Y, Z }, ... }` | Treat the whole object as direct KeyValues; spawning defaults to `false`. |

An omitted or `undefined` second argument uses the defaults; otherwise it must be a non-array, non-function object (`null` is rejected). The dispatch-spawn option must be a boolean, and once either canonical reserved own option key is present, other enumerated own option names are rejected. Direct or nested KeyValues accept only strings, finite numbers, exact three-element arrays, or objects with all three own finite numeric `X`, `Y`, and `Z` properties. Key names must be non-empty, and names/string values must contain no NUL bytes. Numeric values and vector components must fit finite native float storage and are passed through the SDK's float/vector overloads, not exact 64-bit integer storage. Creation validates the complete JavaScript shape before allocation and forwards values through the selected SDK's real server-tools overloads.

### `GetEntityItemDefinitionIndex(Entity)`

```text
GetEntityItemDefinitionIndex(Entity) -> number | bigint
```

Reads `ITEM_DEFINITION_PROPERTY` from a live networked Entity using the engine's standard native proxy to determine storage width and signedness. It returns `number` for storage up to 32 bits and `bigint` for 64-bit storage. The network bit count is not the native field width. It throws for an invalid Entity or edict, a missing property, or an unknown/unavailable standard proxy instead of assuming a signed four-byte `int`.

### `SetEntityItemDefinitionIndex(Entity, nValue)`

```text
SetEntityItemDefinitionIndex(Entity, nValue) -> true
```

Writes `nValue` to the same live sendprop using its inferred native width and signed or unsigned range, and returns `true`. Storage up to 32 bits accepts an in-range integer `number` or `bigint`; 64-bit storage requires `bigint`. It throws for an invalid Entity or edict, a missing property, an unknown/unavailable standard proxy, or an incompatible value. SourceJS does not verify that the item definition is valid for the entity class. A successful write changes engine memory immediately. See [integer inference](entities-props.md).

## Practical workflows

### Inspect the selected weapon classes

```js
const { GetEntitiesByClassName, GetEntityItemDefinitionIndex } = require("entities/engines/csgo/csgo");
const { LogInfo } = require("loggers");

const g_InspectSelectedWeaponClasses = function InspectSelectedWeaponClasses() {
	const vecWeapons = GetEntitiesByClassName("weapon_ak47");
	if (vecWeapons.length === 0) {
		throw new Error("The current server has no weapon_ak47 entity.");
	}

	for (const Weapon of vecWeapons) {
		LogInfo("InspectCSGOWeapon Result=%j", { ItemDefinitionIndexText: String(GetEntityItemDefinitionIndex(Weapon)), Address: `0x${Weapon.Address.toString(16).toUpperCase()}`, ClassName: Weapon.ClassName, EntityIndex: Weapon.Index });
	}
};

g_InspectSelectedWeaponClasses();
```

### Resolve an entity again by index

```js
const { FindEntityByClassName, GetEntityByIndex } = require("entities/engines/csgo/csgo");
const { LogInfo } = require("loggers");

const g_ResolveEntityAgainByIndex = function ResolveEntityAgainByIndex() {
	const FirstKnife = FindEntityByClassName("weapon_knife");
	if (!FirstKnife) {
		throw new Error("The current server has no weapon_knife entity.");
	}

	const nFirstKnifeHandleValue = FirstKnife.HandleValue;
	if (nFirstKnifeHandleValue === -1) {
		throw new Error("The weapon_knife entity has no valid packed handle.");
	}

	const ResolvedKnife = GetEntityByIndex(FirstKnife.Index);
	if (!ResolvedKnife || (ResolvedKnife.HandleValue !== nFirstKnifeHandleValue)) {
		throw new Error("The weapon_knife identity changed during resolution.");
	}

	LogInfo("ResolveCSGOEntity Result=%j", { Valid: ResolvedKnife.Valid, FirstEntityIndex: FirstKnife.Index, ResolvedEntityIndex: ResolvedKnife.Index });
};

g_ResolveEntityAgainByIndex();
```

Do not require JavaScript object identity from the two wrappers. Validate and snapshot the original `HandleValue` before the second lookup and compare it with the resolved handle. Check the unavailable `-1` sentinel, not the sign of the packed value. Comparing two live handle getters afterward can miss index reuse because both wrappers may already observe the replacement. A valid handle snapshot detects that mismatch; it does not extend the entity's lifetime.

### Use the property constant with the generic accessor

```js
const { ITEM_DEFINITION_PROPERTY, FindEntityByClassName, GetEntityItemDefinitionIndex } = require("entities/engines/csgo/csgo");

const g_CompareItemDefinitionAccessors = function CompareItemDefinitionAccessors() {
	const Weapon = FindEntityByClassName("weapon_ak47");
	if (!Weapon || (typeof Weapon.GetEntityProperty !== "function")) {
		throw new Error("The current server has no weapon_ak47 with sendprop access.");
	}

	const nGenericItemDefinitionIndex = Weapon.GetEntityProperty(ITEM_DEFINITION_PROPERTY);
	const nShortcutItemDefinitionIndex = GetEntityItemDefinitionIndex(Weapon);
	if (nGenericItemDefinitionIndex !== nShortcutItemDefinitionIndex) {
		throw new Error("The item-definition accessors disagree.");
	}
};

g_CompareItemDefinitionAccessors();
```

### Change an item definition temporarily

```js
const { FindEntityByClassName, GetEntityItemDefinitionIndex, SetEntityItemDefinitionIndex } = require("entities/engines/csgo/csgo");

const g_ChangeItemDefinitionTemporarily = function ChangeItemDefinitionTemporarily() {
	const Weapon = FindEntityByClassName("weapon_ak47");
	if (!Weapon) {
		throw new Error("The current server has no weapon_ak47 entity.");
	}

	const nPreviousItemDefinitionIndex = GetEntityItemDefinitionIndex(Weapon);
	const nTemporaryItemDefinitionIndex = (typeof nPreviousItemDefinitionIndex === "bigint") ? 7n : 7;

	try {
		if (!SetEntityItemDefinitionIndex(Weapon, nTemporaryItemDefinitionIndex)) {
			throw new Error("Unable to write the temporary item definition.");
		}

		if (GetEntityItemDefinitionIndex(Weapon) !== nTemporaryItemDefinitionIndex) {
			throw new Error("The temporary item definition was not visible in native memory.");
		}
	} finally {
		if (!SetEntityItemDefinitionIndex(Weapon, nPreviousItemDefinitionIndex)) {
			throw new Error("Unable to restore the item definition.");
		}
	}
};

g_ChangeItemDefinitionTemporarily();
```

Restore temporary writes even when later plugin logic throws. Without restoration, the temporary value remains in the live entity after the callback returns. Preserve the getter's Number/BigInt representation when choosing and restoring values; do not convert 64-bit storage through Number. Keep this synchronous scope on the game thread and do not delete or replace the entity between the read and restoration. `finally` attempts restoration but cannot preserve entity lifetime or roll back other engine side effects; a restoration error propagates and can replace an earlier exception.

### Create, initialize, and remove a weapon entity

```js
const { CreateEntityByClassName, GetEntityItemDefinitionIndex, SetEntityItemDefinitionIndex } = require("entities/engines/csgo/csgo");
const { LogInfo } = require("loggers");

const g_CreateInitializeAndRemoveWeaponEntity = function CreateInitializeAndRemoveWeaponEntity() {
	if (typeof CreateEntityByClassName !== "function") {
		throw new Error("This CS:GO build does not expose native entity creation.");
	}

	const Weapon = CreateEntityByClassName("weapon_ak47", { DispatchSpawn: true, KeyValues: { targetname: "sourcejs_temporary_ak47" } });
	if (!Weapon) {
		throw new Error("CS:GO rejected weapon_ak47 creation.");
	}

	try {
		const nCurrentItemDefinitionIndex = GetEntityItemDefinitionIndex(Weapon);
		const nTemporaryItemDefinitionIndex = (typeof nCurrentItemDefinitionIndex === "bigint") ? 7n : 7;
		if (!SetEntityItemDefinitionIndex(Weapon, nTemporaryItemDefinitionIndex)) {
			throw new Error("Unable to initialize the temporary weapon item definition.");
		}

		LogInfo("InitializeCSGOWeapon Result=%j", { ItemDefinitionIndexText: String(GetEntityItemDefinitionIndex(Weapon)), EntityIndex: Weapon.Index });
	} finally {
		if (Weapon.Valid && !Weapon.RemoveEntity()) {
			throw new Error("Unable to remove the temporary CS:GO weapon.");
		}
	}
};

g_CreateInitializeAndRemoveWeaponEntity();
```

Use [`entities/factories`](entities-factories.md) when an unspawned entity needs separate KeyValue and dispatch phases.

## Errors and common mistakes

- Requiring this module on a non-CS:GO build is an error. Use [`entities/engines`](entities-engines.md) for cross-SDK lookup code.
- `GetEntityByIndex(nEntityIndex)` requires a JavaScript `Int32`. A numeric string is not converted.
- `GetEntitiesByClassName()`, `FindEntityByClassName()`, and `CreateEntityByClassName()` require non-empty strings.
- `GetEntityItemDefinitionIndex()` is valid only for entities whose send table contains `ITEM_DEFINITION_PROPERTY`; world, player, and arbitrary prop entities can reject it.
- `SetEntityItemDefinitionIndex()` writes immediately and does not validate economy schema compatibility.
- Missing required item-definition arguments report the corresponding `entities/engines/csgo/csgo.GetEntityItemDefinitionIndex(Entity)` or `entities/engines/csgo/csgo.SetEntityItemDefinitionIndex(Entity, nValue)` operation; weapon-module calls retain their own operation names.
- The class-name helpers match engine class names. They do not translate display names or weapon profile names.
- `CreateEntityByClassName()` is optional; verify that the export is a function before calling it, and remove temporary entities explicitly.
- A deleted entity's index can be reused. Do not retain an Entity wrapper as permanent identity.

## Related modules

- [`entities/engines`](entities-engines.md) provides the game-neutral selected-SDK lookup and optional creation surface.
- [`entities/entity`](entities-entity.md) provides the decorated Entity factory.
- [`entities/props`](entities-props.md) exposes all strict sendprop accessors and reflection records.
- [`entities/factories`](entities-factories.md) owns the complete server-tools creation lifecycle.
- [`weapons/engines/csgo`](weapons-engines-csgo.md) owns weapon-oriented CS:GO item-definition and reserve-ammo operations.
- [`weapons/data`](weapons-data.md) provides profile records such as item-definition indexes and parent classes.
