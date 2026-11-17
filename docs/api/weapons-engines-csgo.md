# `require("weapons/engines/csgo")`

> Warning: this is a Source 1 CS:GO-only native capability. The module property does not exist on other HL2SDK
> branches, and every setter writes live weapon memory synchronously.
>
> AI navigation: check Capability and Constants before importing; read Errors and Lifetime before the temporary-value
> examples. Distinguish native field writes from CS:GO game-side item transitions.

`weapons/engines/csgo` exposes three canonical CS:GO weapon sendprop paths and direct integer-property helpers for item
definition and primary reserve ammo. It is installed only inside the native `ENGINE_CSGO` compile-time branch.

The package file is `packages/sourcejs/weapons/engines/csgo.js`. It returns `sourcejs["weapons/engines/csgo"]` by
identity; it has no JavaScript wrappers, aliases, or fallback implementation.

## Contents

- [Import](#import)
- [Export Reference](#export-reference)
- [Capability and Constants](#capability-and-constants)
- [Inspecting CS:GO Property Metadata](#inspecting-csgo-property-metadata)
- [Editing the Item Definition](#editing-the-item-definition)
- [Editing Primary Reserve Ammo](#editing-primary-reserve-ammo)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	CLIP_PROPERTY,
	ITEM_DEFINITION_PROPERTY,
	PRIMARY_AMMO_PROPERTY,
	GetWeaponAmmo,
	GetWeaponItemDefinitionIndex,
	SetWeaponAmmo,
	SetWeaponItemDefinitionIndex,
} = require("weapons/engines/csgo");
```

Load a plugin file containing this import only on the `csgo` SDK branch. On every other branch, `require()` throws
`SourceJS module is not installed: weapons/engines/csgo` rather than returning an empty object.

## Export Reference

| Export | Exact value or behavior |
| --- | --- |
| `CLIP_PROPERTY` | `"m_iClip1"`. |
| `ITEM_DEFINITION_PROPERTY` | `"m_AttributeManager.m_Item.m_iItemDefinitionIndex"`. |
| `PRIMARY_AMMO_PROPERTY` | `"m_iPrimaryReserveAmmoCount"`. |
| `GetWeaponItemDefinitionIndex(Entity)` | Read `ITEM_DEFINITION_PROPERTY` using its inferred native integer storage. |
| `SetWeaponItemDefinitionIndex(Entity, nValue)` | Write `ITEM_DEFINITION_PROPERTY` using its inferred native integer storage; return `true`. |
| `GetWeaponAmmo(Weapon)` | Read `PRIMARY_AMMO_PROPERTY` using its inferred native integer storage. |
| `SetWeaponAmmo(Weapon, nValue)` | Write `PRIMARY_AMMO_PROPERTY` using its inferred native integer storage; return `true`. |

Weapon arguments accept a non-negative int32 entity index or indexed object at the native boundary. These shortcuts
use the same inferred storage as `GetEntityProperty()` and `SetEntityProperty()`: the engine's standard native proxy
determines integer width and signedness, not the property's network bit count. Storage up to 32 bits returns `number`
and accepts in-range integer `number` or `bigint` values; 64-bit storage returns and requires `bigint`. Unknown or
unavailable standard proxies throw rather than guessing a four-byte field. See [integer inference](entities-props.md).

The module exports no clip getter or setter. `CLIP_PROPERTY` is a canonical path for
[`entities/props`](entities-props.md) or the common [`weapons/engines`](weapons-engines.md) property functions.

## Capability and Constants

The three path strings are compile-time native properties. Treat them as read-only API constants even though the
plugin-context V8 object uses ordinary reflected values.

Mutating a reflected constant does not redirect the native helpers: their property paths are embedded in C++.

They name CS:GO send-table storage, not universal Source weapon fields:

- `CLIP_PROPERTY` is the primary clip count;
- `ITEM_DEFINITION_PROPERTY` selects the item definition index field;
- `PRIMARY_AMMO_PROPERTY` is the direct reserve-ammo count used by the specialized helpers.

Changing only an item definition index does not recreate the weapon, recalculate unrelated econ attributes, or apply
an item schema transaction. The helpers perform exactly one sendprop read or write.

## Inspecting CS:GO Property Metadata

Resolve metadata against a caller-selected current weapon before building reusable property logic:

```js
const {
	CLIP_PROPERTY,
	ITEM_DEFINITION_PROPERTY,
	PRIMARY_AMMO_PROPERTY,
} = require("weapons/engines/csgo");
const { GetEntitySendProperty } = require("entities/props");

function InspectCSGOWeaponProperties(WeaponReference) {
	const vecPropertyNames = [
		CLIP_PROPERTY,
		ITEM_DEFINITION_PROPERTY,
		PRIMARY_AMMO_PROPERTY,
	];
	const vecPropertyDetails = [];
	for (const strPropertyName of vecPropertyNames) {
		const SendProperty = GetEntitySendProperty(WeaponReference, strPropertyName);
		if (SendProperty === null) {
			throw new Error(`InspectCSGOWeaponProperties() cannot resolve a required sendprop. Property="${strPropertyName}".`);
		}

		vecPropertyDetails.push({ SendProperty, PropertyName: strPropertyName });
	}

	return vecPropertyDetails;
}
```

The returned metadata objects are reflection results for the weapon's current server class. Re-resolve them if the
caller changes entity identity or class assumptions.

## Editing the Item Definition

This workflow exposes a temporary item-definition value and attempts to restore the original in `finally`, including
when the callback throws. It does not provide an atomic game-state transaction:

```js
const {
	GetWeaponItemDefinitionIndex,
	SetWeaponItemDefinitionIndex,
} = require("weapons/engines/csgo");

function WithTemporaryItemDefinition(WeaponReference, nTemporaryItemDefinitionIndex, ItemDefinitionCallback) {
	if (typeof ItemDefinitionCallback !== "function") {
		throw new TypeError("WithTemporaryItemDefinition(WeaponReference, nTemporaryItemDefinitionIndex, ItemDefinitionCallback) expects a callback function.");
	}

	const nOriginalItemDefinitionIndex = GetWeaponItemDefinitionIndex(WeaponReference);

	SetWeaponItemDefinitionIndex(WeaponReference, nTemporaryItemDefinitionIndex);

	try {
		return ItemDefinitionCallback(GetWeaponItemDefinitionIndex(WeaponReference));
	} finally {
		SetWeaponItemDefinitionIndex(WeaponReference, nOriginalItemDefinitionIndex);
	}
}
```

Use this low-level write only when the caller owns the weapon-state transition. A different item-definition index can
require additional CS:GO game-side work that this module intentionally does not perform.

## Editing Primary Reserve Ammo

These helpers always use the direct `m_iPrimaryReserveAmmoCount` sendprop. They do not use the common weapon facade's
cross-game path that resolves an owner and ammo type.

```js
const {
	GetWeaponAmmo,
	SetWeaponAmmo,
} = require("weapons/engines/csgo");

function WithTemporaryCSGOAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) {
	if (typeof AmmoCallback !== "function") {
		throw new TypeError("WithTemporaryCSGOAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) expects a callback function.");
	}

	const nOriginalAmmo = GetWeaponAmmo(WeaponReference);

	SetWeaponAmmo(WeaponReference, nTemporaryAmmo);

	try {
		return AmmoCallback(GetWeaponAmmo(WeaponReference));
	} finally {
		SetWeaponAmmo(WeaponReference, nOriginalAmmo);
	}
}
```

Game rules can impose a narrower meaningful range than the inferred native integer storage. Choose values deliberately
and keep the callback synchronous. The same weapon and reference index must remain valid and stable through
restoration; do not change `WeaponReference.Index` inside the callback.

Both temporary workflows enter `try` only after the initial setter succeeds. If that setter throws, the callback and
restoration are not attempted. After a successful initial write, restoration is attempted once. If it throws, that
cleanup error replaces any callback error or result; callers that need both failures must retain and report them
explicitly. A callback returning a promise does not delay restoration.

## Errors and Lifetime

- Requiring the package without a SourceJS native runtime throws; there is no fallback.
- Requiring it on a non-CS:GO SourceJS build throws because the module property is absent.
- Getters require a current entity with the named sendprop.
- Setters require a current entity and an integer value within the inferred storage's signed or unsigned range.
- Missing arguments, invalid entities, missing properties, and incompatible values throw before a successful result.
- Setters write live send-table storage immediately on the server thread.
- Call reflection, getters, setters and temporary workflows on the game thread; these operations are not worker-thread APIs.
- Restoration can fail if the weapon disappears during a callback. Do not perform asynchronous work inside temporary
  workflows.
- The module and its native functions require no disposal.

## Common Mistakes

- Do not import this module from a code path loaded on non-CS:GO branches.
- Do not treat the constants as cross-game property guarantees.
- Do not expect `CLIP_PROPERTY` to imply specialized clip helper exports.
- Do not select an arbitrary current weapon for mutation.
- Do not expect `SetWeaponItemDefinitionIndex(Entity, nValue)` to recreate or fully reconfigure an econ item.
- Do not use the common ammo fallback when the direct CS:GO reserve field is specifically required.
- Do not add lower-camel aliases, duplicate class exports, synthetic capability helpers, defaults or module-name metadata.

## Related Modules

- [`weapons/engines`](weapons-engines.md) documents the common selected-SDK native facade.
- [`weapons/entity`](weapons-entity.md) documents decorated weapon objects.
- [`entities/props`](entities-props.md) documents metadata and generic access for the exported paths.
- [`globals`](globals.md) documents the selected SDK branch used for conditional loading decisions.
