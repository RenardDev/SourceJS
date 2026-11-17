# `require("weapons/entity")`

> Warning: `Weapon()` returns a decorated view over a current engine entity. Methods, entity results and
> vector properties are live; entity deletion or index reuse invalidates retained assumptions.
>
> AI navigation: start with Factory and Decoration for returned-object guarantees, then check resource capability and
> Errors and Lifetime before mutation. Native field writes and `finally` cleanup are not atomic game-state transactions.

`weapons/entity` combines one JavaScript `Weapon(WeaponReference)` decorator with the native selected-SDK weapon property
callbacks. The factory adds high-level primary and secondary ammo, clip, owner and drop operations to a valid native
weapon object while preserving inherited entity behavior.

The package file is `packages/sourcejs/weapons/entity.js`. It exports `Weapon` plus exact native function references
from `sourcejs["weapons/entity"]`; there are no fallback implementations or compatibility aliases.

Native wrapper creation propagates an existing live-property installation exception unchanged. A nonthrowing failure in the additional weapon properties reports `Failed to install Weapon live properties.` Failure in the inherited entity properties reports `Failed to install Entity live properties.` Neither path returns a partial wrapper.

## Contents

- [Import](#import)
- [Module Export Reference](#module-export-reference)
- [Factory and Decoration](#factory-and-decoration)
- [Weapon Object Reference](#weapon-object-reference)
- [Inspecting a Weapon](#inspecting-a-weapon)
- [Editing Primary Resources](#editing-primary-resources)
- [Editing Secondary Resources](#editing-secondary-resources)
- [Generic Sendprops](#generic-sendprops)
- [Editing a Generic Sendprop](#editing-a-generic-sendprop)
- [Direct Ammo and Scalar Sendprops](#direct-ammo-and-scalar-sendprops)
- [Direct Entity Sendprops](#direct-entity-sendprops)
- [Direct Character-Array Sendprops](#direct-character-array-sendprops)
- [Dropping a Caller-Owned Weapon](#dropping-a-caller-owned-weapon)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	Weapon,
	GetAmmo,
	GetProperty,
	GetPropertyEntity,
	GetPropertyFloat,
	GetPropertyInteger,
	GetPropertyString,
	GetPropertyStringArray,
	SetAmmo,
	SetProperty,
	SetPropertyEntity,
	SetPropertyFloat,
	SetPropertyInteger,
	SetPropertyString,
	SetPropertyStringArray,
} = require("weapons/entity");
```

## Module Export Reference

| Export | Return or effect |
| --- | --- |
| `Weapon(WeaponReference)` | Accepts a nonnegative int32 weapon index or indexed object; decorates a valid current native weapon. Valid indexes for absent or non-weapon edicts normally return `null`; missing or malformed arguments throw. See construction-state caveats below. |
| `GetAmmo(WeaponReference)` | Read primary reserve ammo through the selected branch path. |
| `SetAmmo(WeaponReference, nAmmo)` | Write primary reserve ammo and return `true`. |
| `GetProperty(WeaponReference, strPropertyName, strPropertyType?)` | Read an inferred or explicit canonical sendprop type. |
| `SetProperty(WeaponReference, strPropertyName, PropertyValue, strPropertyType?)` | Write an inferred or explicit canonical sendprop type and return `true`. |
| `GetPropertyInteger(WeaponReference, strPropertyName)` | Read signed 32-bit integer storage. |
| `SetPropertyInteger(WeaponReference, strPropertyName, nPropertyValue)` | Write signed 32-bit integer storage and return `true`. |
| `GetPropertyFloat(WeaponReference, strPropertyName)` | Read a floating-point sendprop. |
| `SetPropertyFloat(WeaponReference, strPropertyName, flPropertyValue)` | Write a floating-point sendprop and return `true`. |
| `GetPropertyEntity(WeaponReference, strPropertyName)` | Read an entity-handle sendprop as a live entity or `null`. |
| `SetPropertyEntity(WeaponReference, strPropertyName, EntityReference)` | Write a valid entity handle, index or object and return `true`. |
| `GetPropertyString(WeaponReference, strPropertyName)` | Read a reflected fixed character array. |
| `SetPropertyString(WeaponReference, strPropertyName, strPropertyValue)` | Write a reflected fixed character array and return `true`. |
| `GetPropertyStringArray(WeaponReference, strPropertyName)` | Exact second native name for the same fixed-array reader. |
| `SetPropertyStringArray(WeaponReference, strPropertyName, strPropertyValue)` | Exact second native name for the same fixed-array writer; returns `true`. |

The 14 direct functions are the native function identities. Only `Weapon()` is a JavaScript wrapper.

## Factory and Decoration

`Weapon(WeaponReference)` calls the native `weapons/entity.GetWeapon(WeaponReference)` factory and then `DecorateWeapon()`.

Decoration occurs only when the returned object is truthy, `IsWeapon` is truthy, `Valid` is truthy and `Free` is
falsy. A normal missing or non-weapon edict returns `null`. If entity state changes during construction and a native
object no longer satisfies those conditions, the object is returned without weapon-specific members rather than
receiving fabricated behavior.

Decoration first applies [`entities/entity`](entities-entity.md) behavior, then adds weapon members:

- methods are configurable, writable and non-enumerable;
- any existing property with a targeted method name on the object or prototype chain prevents installation, even
  when the value is not a function or is an accessor;
- repeated decoration does not replace existing methods.

The object remains a native live wrapper. Decoration does not copy engine state or transfer entity ownership.

## Weapon Object Reference

The native object includes the live fields and methods documented by `entities/entity`, plus native `IsWeapon` and
`Weapon` properties.

Both additional properties are read-only and query the current entity class on access. `IsWeapon` tests the exact case-sensitive engine prefix `weapon_`; `Weapon` removes that prefix when present and otherwise returns the class name unchanged. An absent or free edict produces `false` and `""`, respectively. They follow the Entity live-property exception and borrowed-lifetime contract; writing either property is not a rename operation.

### Methods

| Method | Exact behavior |
| --- | --- |
| `GetWeaponName()` | Return the current normalized short weapon name. |
| `GetOwner()` | Read `m_hOwnerEntity` and decorate the live entity result; return `null` when unresolved. |
| `GetClip()` | Read `m_iClip1`; throw when the value is negative. |
| `SetClip(nPrimaryClip)` | Confirm primary clip capability, then write `m_iClip1` and return `true`. |
| `GetPrimaryAmmoType()` | Read `m_iPrimaryAmmoType`; throw when negative. |
| `GetSecondaryAmmoType()` | Read `m_iSecondaryAmmoType`; throw when negative. |
| `GetAmmo()` | Read selected-branch primary reserve ammo. |
| `SetAmmo(nAmmo)` | Write selected-branch primary reserve ammo and return `true`. |
| `GetSecondaryClip()` | Read `m_iClip2`; throw when negative. |
| `SetSecondaryClip(nSecondaryClip)` | Confirm secondary clip capability, then write `m_iClip2` and return `true`. |
| `GetSecondaryAmmo()` | Read the owner's `m_iAmmo.NNN` slot selected by secondary ammo type. |
| `SetSecondaryAmmo(nSecondaryAmmo)` | Write that owner ammo slot and return `true`. |
| `Drop(DropTarget = null, DropVelocity = null)` | Ask owner to drop weapon; return `false` unless owner index is positive. |

The secondary ammo path pads its non-negative type index to at least three digits, such as type `3` becoming
`m_iAmmo.003`. It requires a current owner and valid owner property.

## Inspecting a Weapon

Resolve a caller-selected index and return only copied identity fields plus the live object explicitly:

```js
const { Weapon } = require("weapons/entity");

function InspectWeapon(unWeaponIndex) {
	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		return null;
	}

	const WeaponOwner = CurrentWeapon.GetOwner();

	return { IsWeapon: CurrentWeapon.IsWeapon, Weapon: CurrentWeapon, NativeWeaponName: CurrentWeapon.Weapon, WeaponName: CurrentWeapon.GetWeaponName(), OwnerIndex: (WeaponOwner === null) ? null : WeaponOwner.Index, WeaponIndex: CurrentWeapon.Index };
}
```

The scalar identity fields report values read during this call. The returned `Weapon` remains borrowed live state and
should not cross asynchronous or plugin boundaries.

## Editing Primary Resources

Methods address the same primary clip and ammo storage. This workflow attempts restoration in reverse order:

```js
const { Weapon } = require("weapons/entity");

function WithTemporaryPrimaryResources(unWeaponIndex, nTemporaryPrimaryClip, nTemporaryAmmo, PrimaryResourceCallback) {
	if (typeof PrimaryResourceCallback !== "function") {
		throw new TypeError("WithTemporaryPrimaryResources(unWeaponIndex, nTemporaryPrimaryClip, nTemporaryAmmo, PrimaryResourceCallback) expects a callback function.");
	}

	if (((typeof nTemporaryPrimaryClip === "number") || (typeof nTemporaryPrimaryClip === "bigint")) && (nTemporaryPrimaryClip < 0)) {
		throw new RangeError("WithTemporaryPrimaryResources(unWeaponIndex, nTemporaryPrimaryClip, nTemporaryAmmo, PrimaryResourceCallback) expects a nonnegative temporary clip.");
	}

	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		throw new Error(`WithTemporaryPrimaryResources() weapon does not exist WeaponIndex=${unWeaponIndex}.`);
	}

	const nOriginalPrimaryClip = CurrentWeapon.GetClip();
	const nOriginalAmmo = CurrentWeapon.GetAmmo();

	try {
		CurrentWeapon.SetClip(nTemporaryPrimaryClip);
		CurrentWeapon.SetAmmo(nTemporaryAmmo);

		return PrimaryResourceCallback({ Ammo: CurrentWeapon.GetAmmo(), PrimaryClip: CurrentWeapon.GetClip(), PrimaryAmmoType: CurrentWeapon.GetPrimaryAmmoType() });
	} finally {
		try {
			CurrentWeapon.SetAmmo(nOriginalAmmo);
		} finally {
			CurrentWeapon.SetClip(nOriginalPrimaryClip);
		}
	}
}
```

Negative clip and ammo type values are explicit getter capability failures, not zero. Clip setters validate capability
by reading first; an existing field does not make every signed int32 value meaningful to game rules.
The decorated clip setters reject a negative current clip, not a negative requested value. These workflows reject
negative temporary clips before native operations because writing one would prevent decorated clip restoration.

## Editing Secondary Resources

Not every selected game or weapon class has secondary clip and ammo storage. Resolve that capability before
mutation and let unavailable getters throw clearly:

```js
const { Weapon } = require("weapons/entity");

function WithTemporarySecondaryResources(unWeaponIndex, nTemporarySecondaryClip, nTemporarySecondaryAmmo, SecondaryResourceCallback) {
	if (typeof SecondaryResourceCallback !== "function") {
		throw new TypeError("WithTemporarySecondaryResources(unWeaponIndex, nTemporarySecondaryClip, nTemporarySecondaryAmmo, SecondaryResourceCallback) expects a callback function.");
	}

	if (((typeof nTemporarySecondaryClip === "number") || (typeof nTemporarySecondaryClip === "bigint")) && (nTemporarySecondaryClip < 0)) {
		throw new RangeError("WithTemporarySecondaryResources(unWeaponIndex, nTemporarySecondaryClip, nTemporarySecondaryAmmo, SecondaryResourceCallback) expects a nonnegative temporary clip.");
	}

	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		throw new Error(`WithTemporarySecondaryResources() weapon does not exist WeaponIndex=${unWeaponIndex}.`);
	}

	const nOriginalSecondaryClip = CurrentWeapon.GetSecondaryClip();
	const nOriginalSecondaryAmmo = CurrentWeapon.GetSecondaryAmmo();

	try {
		CurrentWeapon.SetSecondaryClip(nTemporarySecondaryClip);
		CurrentWeapon.SetSecondaryAmmo(nTemporarySecondaryAmmo);

		return SecondaryResourceCallback({ SecondaryAmmo: CurrentWeapon.GetSecondaryAmmo(), SecondaryAmmoType: CurrentWeapon.GetSecondaryAmmoType(), SecondaryClip: CurrentWeapon.GetSecondaryClip() });
	} finally {
		try {
			CurrentWeapon.SetSecondaryAmmo(nOriginalSecondaryAmmo);
		} finally {
			CurrentWeapon.SetSecondaryClip(nOriginalSecondaryClip);
		}
	}
}
```

The owner, weapon and ammo-type selection must remain valid and stable through the synchronous callback and restoration.
Both resource workflows read originals before any write. Once their `try` starts, cleanup attempts ammo restoration
and then clip restoration even if the initial setters or ammo restoration throw. The last throwing cleanup action
replaces any earlier error or callback result. Neither workflow guarantees atomic rollback, and a returned promise
does not delay cleanup.

## Generic Sendprops

`GetProperty()` and `SetProperty()` accept the complete canonical type surface:

| Type | Read result | Accepted write value |
| --- | --- | --- |
| `bool` | boolean | boolean. |
| `char` | string containing zero or one character | In-range integer `number`, or string whose first UTF-8 byte is used; empty string writes NUL. |
| `uchar` | number | In-range integer or `bigint`. |
| `short`, `ushort` | number | In-range integer or `bigint`. |
| `int`, `uint` | number | In-range integer or `bigint`. |
| `long`, `ulong` | number for at most 32-bit native `long`, otherwise `bigint` | In-range integer `number` or `bigint` for 32-bit storage; `bigint` only for 64-bit storage. |
| `longlong`, `ulonglong` | `bigint` | In-range `bigint` only. |
| `float`, `double` | number | Finite number. |
| `stringaddress` | string | String retained in SourceJS-owned stable native storage. |
| `stringarray` | string | UTF-8 string subject to the native byte-capacity and NUL contract. |
| `address` | `bigint` | Non-negative `bigint` within the platform pointer width. |
| `vector` | Live write-through `{ X, Y, Z }` view | Vector-compatible value. |
| `vectorxy` | Live write-through `{ X, Y }` view | Vector-compatible value; only `X` and `Y` are written. |
| `entity` | Live entity object or `null` | Valid entity handle, index or object. |

When `strPropertyType` is omitted, `undefined` or `null`, metadata inference supports float, vector, `vectorxy`, fixed string,
datatable addresses as `bigint` and native integer storage. Standard native proxies determine integer signedness
and the 8-, 16-, 32- or 64-bit storage width, not the property's network bit count or flags. Unknown or unavailable integer
proxies throw instead of guessing a four-byte field. Inferred datatable addresses are read-only.

Integer writes validate the selected storage type's numeric range; explicit types must match the actual native layout.
64-bit integer reads and writes and native addresses use `bigint`. The fixed-array byte-capacity,
fallback and NUL-termination requirements are the same as [`weapons/engines`](weapons-engines.md#character-array-sendprops).

## Editing a Generic Sendprop

Copy live vector components before replacing a field. Entity handles use the dedicated controller below.

```js
const {
	GetProperty,
	SetProperty,
} = require("weapons/entity");

function CopyWeaponPropertyValue(PropertyValue) {
	if ((PropertyValue === null) || (typeof PropertyValue !== "object") || (typeof PropertyValue.X !== "number") || (typeof PropertyValue.Y !== "number")) {
		return PropertyValue;
	}

	const OwnedPropertyValue = { X: PropertyValue.X, Y: PropertyValue.Y };
	if ("Z" in PropertyValue) {
		OwnedPropertyValue.Z = PropertyValue.Z;
	}

	return OwnedPropertyValue;
}

function WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, PropertyCallback) {
	if (strPropertyType === "entity") {
		throw new TypeError("WithTemporaryWeaponProperty() does not accept entity sendprops; use WithTemporaryWeaponEntity().");
	}

	if (typeof PropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, PropertyCallback) expects a callback function.");
	}

	const OriginalPropertyValue = CopyWeaponPropertyValue(GetProperty(WeaponReference, strPropertyName, strPropertyType));

	SetProperty(WeaponReference, strPropertyName, TemporaryPropertyValue, strPropertyType);

	try {
		return PropertyCallback(GetProperty(WeaponReference, strPropertyName, strPropertyType));
	} finally {
		SetProperty(WeaponReference, strPropertyName, OriginalPropertyValue, strPropertyType);
	}
}
```

Do not return the callback's live vector and present it as a detached result; copy components inside the callback.
This helper detaches `X`/`Y` and optional `Z` only, not arbitrary nested objects. Keep the weapon and property selection
stable through restoration. Initial setter failure prevents the callback and cleanup; restoration failure replaces
a callback error or result. A returned promise does not delay cleanup.

## Direct Ammo and Scalar Sendprops

Module-level functions bypass decorated method selection while retaining native validation. The integer pair selects
signed 32-bit C++ `int` storage rather than inferring width or signedness from native proxies. Use generic
`GetProperty()`/`SetProperty()` without `strPropertyType` for inference; typed accesses must match the field layout:

```js
const {
	GetAmmo,
	GetPropertyFloat,
	GetPropertyInteger,
	SetAmmo,
	SetPropertyFloat,
	SetPropertyInteger,
} = require("weapons/entity");

function WithTemporaryDirectScalars(WeaponReference, nTemporaryAmmo, strIntegerPropertyName, nTemporaryIntegerPropertyValue, strFloatPropertyName, flTemporaryFloatPropertyValue, ScalarPropertyCallback) {
	if (typeof ScalarPropertyCallback !== "function") {
		throw new TypeError("WithTemporaryDirectScalars(WeaponReference, nTemporaryAmmo, strIntegerPropertyName, nTemporaryIntegerPropertyValue, strFloatPropertyName, flTemporaryFloatPropertyValue, ScalarPropertyCallback) expects a callback function.");
	}

	const nOriginalAmmo = GetAmmo(WeaponReference);
	const nOriginalIntegerPropertyValue = GetPropertyInteger(WeaponReference, strIntegerPropertyName);
	const flOriginalFloatPropertyValue = GetPropertyFloat(WeaponReference, strFloatPropertyName);

	try {
		SetAmmo(WeaponReference, nTemporaryAmmo);
		SetPropertyInteger(WeaponReference, strIntegerPropertyName, nTemporaryIntegerPropertyValue);
		SetPropertyFloat(WeaponReference, strFloatPropertyName, flTemporaryFloatPropertyValue);

		return ScalarPropertyCallback({ FloatPropertyValue: GetPropertyFloat(WeaponReference, strFloatPropertyName), Ammo: GetAmmo(WeaponReference), IntegerPropertyValue: GetPropertyInteger(WeaponReference, strIntegerPropertyName) });
	} finally {
		try {
			SetPropertyFloat(WeaponReference, strFloatPropertyName, flOriginalFloatPropertyValue);
		} finally {
			try {
				SetPropertyInteger(WeaponReference, strIntegerPropertyName, nOriginalIntegerPropertyValue);
			} finally {
				SetAmmo(WeaponReference, nOriginalAmmo);
			}
		}
	}
}
```

The nested cleanup attempts float, integer and ammo restoration in that order, including after an initial setter
failure. Each later restoration is attempted even if an earlier one throws. The last throwing cleanup action replaces
an earlier error or callback result; no atomic rollback is guaranteed. Keep the weapon, owner, ammo type and property
selection stable through cleanup, and keep the callback synchronous.

## Direct Entity Sendprops

`SetPropertyEntity()` requires `EntityReference` to resolve to a valid entity handle, index or object. Passing `null` is not a portable clear-handle
operation.

```js
const {
	GetPropertyEntity,
	SetPropertyEntity,
} = require("weapons/entity");

function WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, EntityCallback) {
	if (typeof EntityCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, EntityCallback) expects a callback function.");
	}

	const OriginalEntityReference = GetPropertyEntity(WeaponReference, strPropertyName);
	if (OriginalEntityReference === null) {
		throw new Error(`WithTemporaryWeaponEntity() cannot restore unresolved property "${strPropertyName}".`);
	}

	SetPropertyEntity(WeaponReference, strPropertyName, TemporaryEntityReference);

	try {
		return EntityCallback(GetPropertyEntity(WeaponReference, strPropertyName));
	} finally {
		SetPropertyEntity(WeaponReference, strPropertyName, OriginalEntityReference);
	}
}
```

The weapon and original entity must remain valid until restoration completes. Use a valid temporary entity and keep
the weapon and property selection stable. Initial setter failure prevents the callback and cleanup; restoration
failure replaces a callback error or result. This workflow does not acquire ownership of any entity.

## Direct Character-Array Sendprops

`GetPropertyString()` and `GetPropertyStringArray()` use the fixed character-array native reader.
`SetPropertyString()` and `SetPropertyStringArray()` use the matching native writer:

```js
const {
	GetPropertyString,
	GetPropertyStringArray,
	SetPropertyString,
	SetPropertyStringArray,
} = require("weapons/entity");

function WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryPropertyValue, StringPropertyCallback) {
	if (typeof StringPropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryPropertyValue, StringPropertyCallback) expects a callback function.");
	}

	const strOriginalPropertyValue = GetPropertyString(WeaponReference, strPropertyName);
	const strOriginalStringArrayPropertyValue = GetPropertyStringArray(WeaponReference, strPropertyName);
	if (strOriginalPropertyValue !== strOriginalStringArrayPropertyValue) {
		throw new Error(`WithTemporaryWeaponString() readers disagree Property="${strPropertyName}".`);
	}

	SetPropertyString(WeaponReference, strPropertyName, strTemporaryPropertyValue);

	try {
		const strStringArrayPropertyValue = GetPropertyStringArray(WeaponReference, strPropertyName);
		SetPropertyStringArray(WeaponReference, strPropertyName, strStringArrayPropertyValue);

		return StringPropertyCallback({ StringArrayPropertyValue: strStringArrayPropertyValue, StringPropertyValue: GetPropertyString(WeaponReference, strPropertyName) });
	} finally {
		SetPropertyStringArray(WeaponReference, strPropertyName, strOriginalPropertyValue);
	}
}
```

Read values back after writes when byte truncation matters. These are borrowed NUL-terminated string reads, not
capacity-bounded reads. Writers use a positive reflected element count as byte capacity, otherwise a 256-byte
fallback, copying at most capacity minus one and adding NUL. Verify actual character-array storage; a fallback size
does not prove its extent. Embedded NUL ends the visible string, and truncation can split UTF-8 sequences; see the
[`weapons/engines` string contract](weapons-engines.md#character-array-sendprops).

Keep the weapon and property selection stable and the callback synchronous. Initial setter failure prevents the
callback and cleanup; after a successful write, restoration is attempted once. Its error replaces any callback
error or result. A returned promise does not defer restoration.

## Dropping a Caller-Owned Weapon

`Drop(DropTarget = null, DropVelocity = null)` resolves the current owner each time and delegates to the selected
SDK's player drop operation. This controller accepts an already caller-owned weapon and preserves target and velocity forwarding:

```js
const { Weapon } = require("weapons/entity");

function DropCallerOwnedWeapon(unWeaponIndex, DropTarget = null, DropVelocity = null) {
	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		throw new Error(`DropCallerOwnedWeapon() weapon does not exist WeaponIndex=${unWeaponIndex}.`);
	}

	const WeaponOwner = CurrentWeapon.GetOwner();
	const nOwnerIndex = (WeaponOwner === null) ? null : WeaponOwner.Index;
	const unResolvedWeaponIndex = CurrentWeapon.Index;

	const bWasDropped = CurrentWeapon.Drop(DropTarget, DropVelocity);

	return { WasDropped: bWasDropped, OwnerIndex: nOwnerIndex, WeaponIndex: unResolvedWeaponIndex };
}
```

`Drop()` is not an entity-removal request, but selected-game behavior and hooks can invalidate live views during it.
The caller remains responsible for any later removal of a surviving entity and must not choose an arbitrary weapon
from global inventory.
The report copies indexes before the drop operation, so it does not read borrowed identity fields after drop hooks
have run. `OwnerIndex` describes the earlier owner lookup, not an atomic guarantee about ownership during `Drop()`.

## Errors and Lifetime

- Requiring the module without the SourceJS native runtime throws; there is no fallback.
- `Weapon(WeaponReference)` requires a nonnegative int32 index or indexed-object argument; missing or malformed arguments throw. Valid indexes for absent or non-weapon edicts normally return `null`. Decoration-state caveats above still apply.
- Clip and ammo-type getters throw when the native value is negative.
- Secondary ammo throws when owner, ammo type or owner property is unavailable.
- Direct property functions throw for unresolved entities or missing properties, incompatible types and out-of-range values.
- Direct property functions share entity-property callbacks; they do not independently require a weapon-class entity.
- Native objects and decorated owners are borrowed live views. Decoration does not make durable handles.
- Run factory, methods, reads, writes, drop and temporary workflows on the game thread, not a worker thread.
- Setters write synchronously; getters and borrowed accessors read live state.
- Temporary callbacks must remain synchronous; promises do not delay cleanup. Restoration can fail after entity deletion or owner, ammo-type or property changes.
- Cleanup can replace an earlier error or result. Temporary workflows do not promise atomic rollback.
- Decorated objects and direct function values require no disposal.

## Common Mistakes

- Do not resolve or mutate an arbitrary `GetAllWeapons()[0]` weapon.
- Do not treat a negative clip or ammo type as zero.
- Do not assume every weapon supports secondary clip or secondary ammo.
- Do not retain a decorated object across entity deletion or index reuse without revalidation.
- Do not confuse method and accessor convenience with a detached copy of state.
- Do not pass address strings or coerce `BigInt` properties to `Number` without an explicit range decision.
- Do not clear entity handles with `null` through `SetPropertyEntity()`.
- Do not expect `Drop()` to remove a weapon.
- Do not add compatibility aliases, defaults or module-name metadata.

## Related Modules

- [`weapons`](weapons.md) documents collection lookup and removal.
- [`weapons/engines`](weapons-engines.md) documents direct undecorated selected-SDK objects.
- [`entities/entity`](entities-entity.md) documents inherited decorated entity behavior.
- [`entities/props`](entities-props.md) documents property reflection and canonical types.
- [`players/dropweapon`](players-dropweapon.md) documents the drop operation used internally.
