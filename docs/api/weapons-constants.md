# `require("weapons/constants")`

> Warning: this page documents compile-time selected SDK constants. Conditional namespaces and members are genuinely
> absent when their declarations are unavailable; check capabilities instead of supplying fallback numbers.

`weapons/constants` exposes weapon class prefixes, the invalid index sentinel, and optional weapon enum namespaces
compiled from the selected HL2SDK branch. Use it to interpret weapon scripts, sendprops, and hook arguments without
copying branch constants into plugin source.

The package file is `packages/sourcejs/weapons/constants.js`. It returns the plugin context's native
`sourcejs["weapons/constants"]` object by identity. Namespace objects are the native objects too; there are no
JavaScript aliases, synthesized values, or fallback enums.

## Contents

- [Import](#import)
- [Always-Available Exports](#always-available-exports)
- [Conditional Surface](#conditional-surface)
- [ItemFlags](#itemflags)
- [WeaponState](#weaponstate)
- [WeaponProficiency](#weaponproficiency)
- [WeaponSound](#weaponsound)
- [Resolving a Weapon Class](#resolving-a-weapon-class)
- [Reading Script Flags](#reading-script-flags)
- [Reading Live Weapon State](#reading-live-weapon-state)
- [Decoding Hook Arguments](#decoding-hook-arguments)
- [Errors and Ownership](#errors-and-ownership)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	CLASS_PREFIX,
	ENTITY_CLASS_PREFIX,
	INVALID_WEAPON_INDEX,
	ItemFlags,
	WeaponProficiency,
	WeaponSound,
	WeaponState,
} = require("weapons/constants");
```

Destructuring an unavailable optional namespace yields `undefined`. This is a capability result, not a substitute enum.

## Always-Available Exports

| Export | Type | Value | Use |
| --- | --- | --- | --- |
| `CLASS_PREFIX` | `string` | `"weapon_"` | Normalize short weapon names. |
| `ENTITY_CLASS_PREFIX` | `string` | `"weapon_"` | Build weapon entity class names. |
| `INVALID_WEAPON_INDEX` | `number` | `-1` | Represent no weapon in plugin-owned data. |

The two prefix exports currently contain the same text but retain distinct semantic names. Import the one matching
the operation instead of hard-coding the prefix.

## Conditional Surface

SourceJS installs `ItemFlags`, `WeaponState`, `WeaponProficiency`, and `WeaponSound` together only when the selected SDK
exposes all three required weapon header families:

- shared weapon definitions;
- weapon script parsing;
- weapon proficiency declarations.

If that combined capability is unavailable, none of the four properties exists.
`Object.hasOwn(require("weapons/constants"), "ItemFlags")` distinguishes an omitted property from one overwritten with
`undefined`; the examples below only need ordinary capability detection and use an exact imported check such as
`ItemFlags === undefined` after direct destructuring.

The namespace properties are ordinary `number` values and fit JavaScript's exact integer range. Treat the module and
namespace objects as read-only constants even though V8 reflection can modify ordinary properties in the current
plugin context.

SourceJS assigns each property from the selected header symbol directly. It does not normalize conditional enum
ordinals across branches, so the tables below name the authoritative SDK symbols instead of publishing a misleading
branch-independent numeric table.

## ItemFlags

`ItemFlags` contains selected-SDK `ITEM_FLAG_*` bit masks:

| Member | SDK constant | Meaning |
| --- | --- | --- |
| `SelectOnEmpty` | `ITEM_FLAG_SELECTONEMPTY` | Weapon can be selected with no ammo. |
| `NoAutoReload` | `ITEM_FLAG_NOAUTORELOAD` | Disable automatic reload. |
| `NoAutoSwitchEmpty` | `ITEM_FLAG_NOAUTOSWITCHEMPTY` | Do not switch away automatically when empty. |
| `LimitInWorld` | `ITEM_FLAG_LIMITINWORLD` | Apply the SDK's in-world item limit. |
| `Exhaustible` | `ITEM_FLAG_EXHAUSTIBLE` | Consume the item when its ammo is exhausted. |
| `DoHitLocationDamage` | `ITEM_FLAG_DOHITLOCATIONDMG` | Apply hit-location damage behavior. |
| `NoAmmoPickups` | `ITEM_FLAG_NOAMMOPICKUPS` | Disallow ordinary ammo pickups. |
| `NoItemPickup` | `ITEM_FLAG_NOITEMPICKUP` | Disallow item pickup; optional member. |

`NoItemPickup` exists only when the selected SDK declares its macro. Decode masks by enumerating current members so
the optional bit participates automatically.

## WeaponState

| Member | SDK constant |
| --- | --- |
| `NotCarried` | `WEAPON_NOT_CARRIED` |
| `CarriedByPlayer` | `WEAPON_IS_CARRIED_BY_PLAYER` |
| `Active` | `WEAPON_IS_ACTIVE` |

These values commonly appear in weapon `m_iState` sendprops. Property availability remains branch- and class-specific
even when the enum namespace exists.

## WeaponProficiency

| Member | SDK constant |
| --- | --- |
| `Poor` | `WEAPON_PROFICIENCY_POOR` |
| `Average` | `WEAPON_PROFICIENCY_AVERAGE` |
| `Good` | `WEAPON_PROFICIENCY_GOOD` |
| `VeryGood` | `WEAPON_PROFICIENCY_VERY_GOOD` |
| `Perfect` | `WEAPON_PROFICIENCY_PERFECT` |

## WeaponSound

The common selected-SDK sound values are:

| Member | SDK constant |
| --- | --- |
| `Empty` | `EMPTY` |
| `Single` | `SINGLE` |
| `SingleNPC` | `SINGLE_NPC` |
| `Double` | `WPN_DOUBLE` |
| `DoubleNPC` | `DOUBLE_NPC` |
| `Burst` | `BURST` |
| `Reload` | `RELOAD` |
| `ReloadNPC` | `RELOAD_NPC` |
| `MeleeMiss` | `MELEE_MISS` |
| `MeleeHit` | `MELEE_HIT` |
| `MeleeHitWorld` | `MELEE_HIT_WORLD` |
| `Special1` | `SPECIAL1` |
| `Special2` | `SPECIAL2` |
| `Special3` | `SPECIAL3` |

Three independent SDK capabilities add later members:

| Capability | Members |
| --- | --- |
| Taunt sound | `Taunt` from `TAUNT`. |
| Unknown sound slots | `Unknown1` through `Unknown5`. |
| Fast reload sound | `FastReload` from `FAST_RELOAD`. |

`Unknown1`, `Unknown2`, `Unknown3`, `Unknown4`, and `Unknown5` map directly to `UNKNOWNSOUND1`, `UNKNOWNSOUND2`,
`UNKNOWNSOUND3`, `UNKNOWNSOUND4`, and `UNKNOWNSOUND5`, respectively.

Do not infer an optional member merely because a lower numeric value exists. Check the exact member with
`Object.hasOwn(WeaponSound, "FastReload")`.

## Resolving a Weapon Class

This workflow normalizes caller input, performs a live class lookup, and returns the invalid sentinel instead of
retaining a missing wrapper:

```js
const {
	CLASS_PREFIX,
	ENTITY_CLASS_PREFIX,
	INVALID_WEAPON_INDEX,
} = require("weapons/constants");
const { GetWeaponsByClassName } = require("weapons");

function ResolveWeaponClass(strRequestedWeaponName) {
	let strWeaponClassName = strRequestedWeaponName;
	if (!strWeaponClassName.startsWith(CLASS_PREFIX)) {
		strWeaponClassName = `${ENTITY_CLASS_PREFIX}${strWeaponClassName}`;
	}

	const vecWeaponReferences = GetWeaponsByClassName(strWeaponClassName);
	const WeaponReference = (vecWeaponReferences.length > 0) ? vecWeaponReferences[0] : null;

	return { ClassName: strWeaponClassName, Index: (WeaponReference === null) ? INVALID_WEAPON_INDEX : WeaponReference.Index, Weapon: WeaponReference };
}
```

Validate `strRequestedWeaponName` as a non-empty string at the command or configuration boundary.
`GetWeaponsByClassName()` performs the native strict validation too.

## Reading Script Flags

`weapons/scripts.Load(strWeaponScriptName)` returns a module-local cached script record. The first load for a class name
reads its KeyValues from disk; later calls reuse that record rather than rereading the file. Decode its native `item_flags`
mask only when the namespace exists:

```js
const { ItemFlags } = require("weapons/constants");
const { Load } = require("weapons/scripts");

function InspectScriptItemFlags(strWeaponScriptName) {
	if (ItemFlags === undefined) {
		throw new Error("InspectScriptItemFlags() requires ItemFlags from the selected SDK.");
	}

	const WeaponScriptRecord = Load(strWeaponScriptName);
	const nItemFlagsMask = WeaponScriptRecord.KeyValues.GetKeyValuesInteger("item_flags", 0);
	const vecEnabledFlagNames = [];
	for (const [strFlagName, nItemFlag] of Object.entries(ItemFlags)) {
		if ((nItemFlagsMask & nItemFlag) !== 0) {
			vecEnabledFlagNames.push(strFlagName);
		}
	}

	return { ItemFlagsMask: nItemFlagsMask, WeaponScriptRecord, EnabledFlagNames: vecEnabledFlagNames };
}
```

This returns a new array of decoded names while retaining the shared script record for additional fields. Its KeyValues
remain live memory with the ownership and cache-invalidation rules documented by `weapons/scripts`; the report is not a snapshot.
Do not destroy the cached KeyValues yourself or use them after the cache is cleared.

## Reading Live Weapon State

Resolve the sendprop through metadata before reading a caller-selected weapon:

```js
const { WeaponState } = require("weapons/constants");
const { GetPropertyInteger } = require("weapons");
const { GetEntitySendProperty } = require("entities/props");

function InspectWeaponState(WeaponReference, strPropertyName = "m_iState") {
	if (WeaponState === undefined) {
		throw new Error("InspectWeaponState() requires WeaponState from the selected SDK.");
	}

	if (GetEntitySendProperty(WeaponReference, strPropertyName) === null) {
		throw new Error(`InspectWeaponState() could not resolve Property="${strPropertyName}".`);
	}

	const nWeaponState = GetPropertyInteger(WeaponReference, strPropertyName);
	let strStateName = null;
	for (const [strCandidateStateName, nCandidateWeaponState] of Object.entries(WeaponState)) {
		if (nCandidateWeaponState === nWeaponState) {
			strStateName = strCandidateStateName;
			break;
		}
	}

	return { PropertyName: strPropertyName, StateName: strStateName, Value: nWeaponState };
}
```

An unknown integer returns `StateName: null`; it is not silently mapped to `NotCarried`.

## Decoding Hook Arguments

Memory hooks can decode numeric proficiency and sound arguments with current SDK namespaces:

```js
const { WeaponProficiency } = require("weapons/constants");

function GetProficiencyName(nWeaponProficiency) {
	if (WeaponProficiency === undefined) {
		throw new Error("GetProficiencyName() requires WeaponProficiency from the selected SDK.");
	}

	for (const [strProficiencyName, nCandidateWeaponProficiency] of Object.entries(WeaponProficiency)) {
		if (nCandidateWeaponProficiency === nWeaponProficiency) {
			return strProficiencyName;
		}
	}

	return null;
}
```

```js
const { WeaponSound } = require("weapons/constants");

function InspectWeaponSound(nWeaponSound) {
	if (WeaponSound === undefined) {
		throw new Error("InspectWeaponSound() requires WeaponSound from the selected SDK.");
	}

	let strWeaponSoundName = null;
	for (const [strCandidateWeaponSoundName, nCandidateWeaponSound] of Object.entries(WeaponSound)) {
		if (nCandidateWeaponSound === nWeaponSound) {
			strWeaponSoundName = strCandidateWeaponSoundName;
			break;
		}
	}

	return {
		Capabilities: {
			HasFastReload: Object.hasOwn(WeaponSound, "FastReload"),
			HasTaunt: Object.hasOwn(WeaponSound, "Taunt"),
			HasUnknownSlots: Object.hasOwn(WeaponSound, "Unknown1"),
		},
		WeaponSound: nWeaponSound,
		WeaponSoundName: strWeaponSoundName,
	};
}
```

Pass the hook payload's actual integer to these functions. For an unknown value, `GetProficiencyName()` returns `null`
and `InspectWeaponSound()` returns `WeaponSoundName: null`, preserving the distinction from a missing namespace.

## Errors and Ownership

- Requiring the module without the SourceJS native runtime throws; there is no fallback.
- The four namespaces can all be absent on a minimal selected SDK.
- `NoItemPickup`, `Taunt`, and `FastReload` are independently conditional; `Unknown1` through `Unknown5` are installed as one conditional group.
- Namespace omission is checked before script, property, or hook work in the examples.
- Run the live class/sendprop examples on the game thread with current entity references; constants do not extend entity or script-memory lifetime.
- Constant objects are scoped to one plugin V8 context and require no disposal.
- Values are ordinary compile-time `number` values, not live SDK memory views. Do not mutate the objects.

## Common Mistakes

- Do not copy enum numbers from one SDK branch into a plugin intended for another branch.
- Do not replace a missing namespace or member with a guessed fallback constant.
- Do not use truthiness to detect a zero-valued enum member; use `Object.hasOwn()`.
- Do not assume `WeaponState` guarantees that `m_iState` exists on every weapon class.
- Do not confuse the packaged data-driven `WeaponID` and `WeaponType` tables with these native SDK namespaces.
- Do not add compatibility exports such as generic `number`, `string`, or `enums` functions, lowercase namespace names,
  aggregate listing helpers, a `default` object, or `moduleName` metadata.

## Related Modules

- [`weapons`](weapons.md) documents live weapon objects and sendprop access.
- [`weapons/scripts`](weapons-scripts.md) documents weapon-script loading and KeyValues ownership.
- [`entities/props`](entities-props.md) documents sendprop metadata and property validation.
- [`memory/hooks`](memory-hooks.md) documents function and virtual-function hook registration.
