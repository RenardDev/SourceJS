# `require("weapons")`

> AI navigation: read Weapon Values and the selected workflow first, then check native type, branch availability and
> lifetime contracts before mutation. Collection scans are independent; temporary workflows are synchronous.

> Warning: this facade includes direct send-table writes and immediate entity removal. Resolve branch-specific
> properties before mutation and attempt temporary cleanup with `finally`; cleanup is not a lifetime guarantee.

`weapons` enumerates live edicts whose class name begins with `weapon_`, resolves active weapons and exposes direct
sendprop/ammo operations. Use it for current world inventory, selected weapon lookup and low-level weapon state that is
not already covered by the decorated `weapons/entity` methods.

The package entry is `packages/sourcejs/weapons/index.js`. Its collection, factory, decoration, clip, ammo, owner, drop,
removal, and native sendprop operations share one export surface. There are no compatibility aliases, cached entity-state
copies or fallback implementations.

Native weapon creation propagates live-property installation exceptions unchanged and never returns a partially installed wrapper. Nonthrowing installation failures identify the owning stage with `Failed to install Entity live properties.` or `Failed to install Weapon live properties.`

The native shared property/ammo installers register their declared methods as own writable, enumerable and configurable data properties on fresh ordinary module objects. The native [weapons/constants](weapons-constants.md) installer does the same for its metadata, available SDK tables and table entries. Inherited accessors and read-only properties cannot intercept these writes. This guarantee concerns these native installers, not arbitrary wrappers or every other facade export; SDK-dependent availability and values remain unchanged.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Weapon Values](#weapon-values)
- [Current Inventory](#current-inventory)
- [Resolving Weapons](#resolving-weapons)
- [Active Weapon](#active-weapon)
- [Reserve Ammo](#reserve-ammo)
- [Generic Sendprops](#generic-sendprops)
- [Typed Scalar Sendprops](#typed-scalar-sendprops)
- [Entity Sendprops](#entity-sendprops)
- [Character-Array Sendprops](#character-array-sendprops)
- [Removing A Weapon](#removing-a-weapon)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	AMMO_PROPERTY_PREFIX,
	CLIP_PROPERTY,
	OWNER_PROPERTY,
	PRIMARY_AMMO_TYPE_PROPERTY,
	SECONDARY_AMMO_TYPE_PROPERTY,
	SECONDARY_CLIP_PROPERTY,
	Weapon,
	GetAllWeapons,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClassName,
	GetClasses,
	GetCount,
	GetCurrentWeapon,
	DecorateWeapon,
	Drop,
	GetAmmo,
	GetClip,
	GetOwner,
	GetProperty,
	GetPropertyEntity,
	GetPropertyFloat,
	GetPropertyInteger,
	GetPropertyString,
	GetPropertyStringArray,
	GetPrimaryAmmoType,
	GetSecondaryAmmo,
	GetSecondaryAmmoType,
	GetSecondaryClip,
	GetWeaponName,
	GetName,
	GetNames,
	Remove,
	SetAmmo,
	SetClip,
	SetProperty,
	SetPropertyEntity,
	SetPropertyFloat,
	SetPropertyInteger,
	SetPropertyString,
	SetPropertyStringArray,
	SetSecondaryAmmo,
	SetSecondaryClip,
} = require("weapons");
```

Importing the module does not enumerate edicts or touch weapon memory.

## Exports

| Export | Result |
| --- | --- |
| `AMMO_PROPERTY_PREFIX` | Player ammo-array prefix used by branch profiles. |
| `CLIP_PROPERTY` | Primary clip sendprop path. |
| `OWNER_PROPERTY` | Weapon owner-handle sendprop path. |
| `PRIMARY_AMMO_TYPE_PROPERTY` | Primary ammo-type sendprop path. |
| `SECONDARY_AMMO_TYPE_PROPERTY` | Secondary ammo-type sendprop path. |
| `SECONDARY_CLIP_PROPERTY` | Secondary clip sendprop path. |
| `Weapon(WeaponValue)` | Decorated live weapon object or `null`. |
| `GetAllWeapons()` | Fresh decorated array of all current weapon edicts. |
| `GetWeaponsByClassName(strWeaponClassName)` | Fresh decorated array matching one exact full class name. |
| `GetWeaponsByName(strWeaponName)` | Fresh decorated array matching a short or `weapon_`-prefixed name. |
| `GetClassName(WeaponReference)` | Current full class name, or `""` when invalid. |
| `GetClasses()` | Fresh unique full class names in first-edict order. |
| `GetCount()` | Current number of weapon edicts. |
| `GetCurrentWeapon(PlayerReference)` | Borrowed active-weapon entity view passed through conditional decoration, or `null`. |
| `DecorateWeapon(Weapon)` | Returns the same input; eligible objects are decorated in place, preserving existing method names. |
| `Drop(WeaponValue, DropTarget?, DropVelocity?)` | Drops through a positive-index owner; returns `false` when no such owner resolves. |
| `GetAmmo(WeaponValue)` | Current primary reserve ammo integer. |
| `SetAmmo(WeaponValue, nAmmo)` | Writes primary reserve ammo and returns `true`. |
| `GetClip(WeaponValue)` | Current primary clip integer; negative clip storage throws. |
| `SetClip(WeaponValue, nPrimaryClip)` | Requires a readable non-negative current clip, then writes and returns `true`. |
| `GetOwner(WeaponValue)` | Decorated current owner entity or `null`. |
| `GetPrimaryAmmoType(WeaponValue)` | Current non-negative primary ammo-type index; negative storage throws. |
| `GetSecondaryAmmoType(WeaponValue)` | Current non-negative secondary ammo-type index; negative storage throws. |
| `GetSecondaryClip(WeaponValue)` | Current secondary clip integer; negative clip storage throws. |
| `SetSecondaryClip(WeaponValue, nSecondaryClip)` | Requires a readable non-negative current clip, then writes and returns `true`. |
| `GetSecondaryAmmo(WeaponValue)` | Current secondary reserve ammo; requires a resolvable owner and ammo type. |
| `SetSecondaryAmmo(WeaponValue, nSecondaryAmmo)` | Writes secondary reserve ammo through the owner and returns `true`. |
| `GetWeaponName(WeaponValue)` | Normalizes the selector first, then returns the native short name or `""`; malformed selectors throw. |
| `GetProperty(WeaponReference, strPropertyName, strPropertyType?)` | Reads an explicitly typed or inferred sendprop. |
| `SetProperty(WeaponReference, strPropertyName, PropertyValue, strPropertyType?)` | Writes an explicitly typed or inferred sendprop and returns `true`. |
| `GetPropertyEntity(WeaponReference, strPropertyName)` | Current entity-handle target or `null`. |
| `SetPropertyEntity(WeaponReference, strPropertyName, EntityReference)` | Writes a valid entity handle and returns `true`. |
| `GetPropertyFloat(WeaponReference, strPropertyName)` | Current `float` value. |
| `SetPropertyFloat(WeaponReference, strPropertyName, flPropertyValue)` | Writes a finite float and returns `true`. |
| `GetPropertyInteger(WeaponReference, strPropertyName)` | Current signed 32-bit integer. |
| `SetPropertyInteger(WeaponReference, strPropertyName, nPropertyValue)` | Writes an in-range integer and returns `true`. |
| `GetPropertyString(WeaponReference, strPropertyName)` | Current fixed character-array text. |
| `SetPropertyString(WeaponReference, strPropertyName, strPropertyValue)` | Writes fixed character-array text and returns `true`. |
| `GetPropertyStringArray(WeaponReference, strPropertyName)` | Current fixed character-array text. |
| `SetPropertyStringArray(WeaponReference, strPropertyName, strPropertyValue)` | Writes fixed character-array text and returns `true`. |
| `GetName(WeaponReference)` | Current class name without a leading `weapon_`, or `""`. |
| `GetNames()` | Fresh unique short names in first-edict order. |
| `Remove(WeaponValue)` | Attempts `Drop()`, then returns native removal success; a thrown drop error prevents removal. |

The two `String` and `StringArray` name pairs are separate public exports wired to the same native fixed-array callbacks.
Neither pair accesses arbitrary `char*` storage.

Calls are synchronous in the plugin's game-thread context. They do not queue work, pin entities or serialize a coherent
multi-field snapshot. Native property/name exports retain the runtime callback identities; the decorated factory,
collection, ammo, clip, owner and removal helpers are JavaScript wrappers.

## Weapon Values

Import the named operations below from `weapons`. `CurrentWeapon` must be a live weapon resolved for the current command, not a wrapper retained across a disconnect or level change. Only use clip and reserve operations if the weapon has the corresponding ammo channel; for reserve, it must also have a live owner. The write examples are separate, explicit test-server operations, not steps to run as part of diagnostics.

| Use | Example |
| --- | --- |
| Attach the convenience methods to a verified weapon wrapper and read its short name. | `const WeaponView = DecorateWeapon(CurrentWeapon);` `const strWeaponName = GetWeaponName(WeaponView);` |
| Find the current owner before reading reserve ammunition. | `const WeaponOwner = GetOwner(CurrentWeapon);` |
| Inspect both supported clip sizes and their ammo-type indexes. | `const unPrimaryClip = GetClip(CurrentWeapon);` `const unSecondaryClip = GetSecondaryClip(CurrentWeapon);` `const unPrimaryAmmoType = GetPrimaryAmmoType(CurrentWeapon);` `const unSecondaryAmmoType = GetSecondaryAmmoType(CurrentWeapon);` |
| Read the owner's reserve for the weapon's secondary channel. | `const nSecondaryReserve = GetSecondaryAmmo(CurrentWeapon);` |
| Compare the configured weapon metadata paths against a reviewed sendprop inventory. | `const vecWeaponPropertyPaths = [CLIP_PROPERTY, SECONDARY_CLIP_PROPERTY, OWNER_PROPERTY, PRIMARY_AMMO_TYPE_PROPERTY, SECONDARY_AMMO_TYPE_PROPERTY];` `const vecAmmoPropertyPaths = vecOwnerPropertyPaths.filter((strPath) => strPath.startsWith(AMMO_PROPERTY_PREFIX));` |
| Apply a validated clip count as part of an explicit reset. | `const bPrimaryClipSet = SetClip(CurrentWeapon, nPrimaryClip);` `const bSecondaryClipSet = SetSecondaryClip(CurrentWeapon, nSecondaryClip);` |
| Apply a validated secondary reserve count to the current owner. | `const bSecondaryReserveSet = SetSecondaryAmmo(CurrentWeapon, nSecondaryReserve);` |
| Ask the owning player's selected SDK to drop the weapon at its default position. Only call on a supported branch. | `const bDropSubmitted = Drop(CurrentWeapon);` |

Weapon references accept a non-negative safe-integer entity index or an object with such a public `Index`; the selected
native call additionally checks its index range. `Weapon()` rejects a
malformed index, returns `null` when the edict is absent or not a `weapon_` class, and otherwise decorates a newly
created native weapon object.

JavaScript object-to-index normalization captures `Index` once and validates that captured value. Compound helpers may
perform several separate conversions; this is not an entity-lifetime guarantee.

Decorated objects expose live native entity fields and the methods documented by `weapons/entity`. Collection arrays
are freshly allocated, but their objects refer to current engine state. Wrapper identity is not a durable entity
identity: these objects are borrowed views, not ownership handles, and do not keep an edict alive.

`DecorateWeapon()` returns its input unchanged when the JavaScript gate fails: it requires truthy `IsWeapon` and `Valid`
and falsy `Free`. An eligible object is mutated in place. The decorator preserves any existing or inherited method name,
even if its value is not callable. This gate does not prove native lifetime, and field access or installation can throw.

`GetClassName()` and `GetName()` are deliberately tolerant: an omitted, malformed, removed or non-weapon selector normally
produces `""`, but a thrown selector getter or native failure still propagates. `GetWeaponName()` first performs strict
JavaScript index normalization. Property and ammo functions also validate strictly; null-returning lookups are not a
general error-suppression rule.

## Current Inventory

`GetAllWeapons()`, `GetCount()`, `GetClasses()` and `GetNames()` scan the current edict range independently. Empty arrays and
a zero count are valid when initialized native globals expose no matching edicts; unavailable globals instead throw.
Because each call is a separate live scan, a changing world can produce a report
whose fields describe slightly different instants.

```js
const {
	GetAllWeapons,
	GetClassName,
	GetClasses,
	GetCount,
	GetName,
	GetNames,
} = require("weapons");

function InspectWeaponInventory() {
	const vecWeaponEntries = [];
	for (const Weapon of GetAllWeapons()) {
		vecWeaponEntries.push({ ClassName: GetClassName(Weapon), Index: Weapon.Index, Name: GetName(Weapon), Weapon });
	}

	return { ClassNames: GetClasses(), Count: GetCount(), Names: GetNames(), Weapons: vecWeaponEntries };
}
```

Use the returned `Weapons.length` when one internally consistent enumeration count matters. The separate native `GetCount()`
value is useful as a real-time cross-check, not as a stable array length guarantee.

## Resolving Weapons

`GetWeaponsByClassName()` compares the complete class name exactly and case-sensitively. `GetWeaponsByName()` prepends `weapon_` when it is
absent, then performs the same exact comparison. Both reject empty/non-string input.

```js
const {
	Weapon,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClassName,
	GetName,
} = require("weapons");

function ResolveWeaponMatches(unWeaponIndex, strExpectedWeaponClassName, strExpectedWeaponName) {
	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		return null;
	}

	return { ClassMatches: GetWeaponsByClassName(strExpectedWeaponClassName), ClassName: GetClassName(CurrentWeapon), Name: GetName(CurrentWeapon), NameMatches: GetWeaponsByName(strExpectedWeaponName), Weapon: CurrentWeapon };
}
```

The returned match arrays can contain several entities with the same class. Compare their public `Index` values when identity matters.

## Active Weapon

`GetCurrentWeapon(PlayerReference)` delegates to the selected SDK's live active-weapon binding. It accepts the player forms supported by
`players/entity` and returns `null` when the handle is invalid or does not resolve to a current entity.
The resolved edict is not separately checked for a weapon class. Inspect its live `IsWeapon` property before invoking
weapon-specific operations; views that fail the decoration gate remain undecorated.
Unavailable runtime state, property lookup failures and thrown selectors still propagate; `null` is not a fallback for
all errors.

```js
const { GetCurrentWeapon, GetClassName, GetName } = require("weapons");

function InspectActiveWeapon(PlayerReference) {
	const CurrentWeapon = GetCurrentWeapon(PlayerReference);
	if (CurrentWeapon === null) {
		return null;
	}

	return { ClassName: GetClassName(CurrentWeapon), Index: CurrentWeapon.Index, Name: GetName(CurrentWeapon), Weapon: CurrentWeapon };
}
```

Pass a resolved player object or index supplied by the caller; do not hard-code client slot `1` into a reusable plugin workflow.

## Reserve Ammo

The ammo helpers use weapon sendprop `m_iPrimaryReserveAmmoCount` when the selected branch exposes it. On branches
whose native layout stores reserve ammo on the owner, SourceJS reads `m_iPrimaryAmmoType`, resolves `m_hOwnerEntity`
and accesses the owner's `m_iAmmo.NNN` slot. This alternate native layout requires a valid owner and ammo type.

Native reserve-ammo operations use checked byte copies for unaligned integer fields and 32-bit owner-handle storage. Invalid SDK record alignment and overflowing numeric field ranges are rejected before access; thrown JavaScript entity selectors are preserved, and native C++ failures are translated into JavaScript errors. These checks do not establish lifetime or protect against invalid-memory faults.

This controller changes ammo for a synchronous callback and returns its result, then attempts restoration:

```js
const { GetAmmo, SetAmmo } = require("weapons");

function WithTemporaryReserveAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) {
	if (typeof AmmoCallback !== "function") {
		throw new TypeError("WithTemporaryReserveAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) expects a function callback.");
	}

	const nOriginalAmmo = GetAmmo(WeaponReference);

	SetAmmo(WeaponReference, nTemporaryAmmo);

	try {
		return AmmoCallback(GetAmmo(WeaponReference));
	} finally {
		SetAmmo(WeaponReference, nOriginalAmmo);
	}
}
```

The setter accepts the integer range supported by the backing field; SourceJS does not invent branch-independent ammo limits.

Only a successful initial setter enters the cleanup-protected callback phase. The callback must leave the same weapon,
owner and backing ammo storage valid until cleanup finishes. A cleanup error can replace the callback's result or error.
Returning a promise does not defer cleanup; the helper does not await it.

## Generic Sendprops

`GetProperty()` and `SetProperty()` resolve a nested sendprop path against the weapon's current server class. With an
explicit type, the following canonical strings are accepted:

| Type | Read result | Write value |
| --- | --- | --- |
| `bool` | boolean | boolean. |
| `char` | Text decoded from one native byte; empty for NUL | In-range integer `number` or string; writes the first UTF-8 byte, with an empty string writing NUL. |
| `uchar` | number | In-range integer or `bigint`. |
| `short`, `ushort` | number | In-range integer or `bigint`. |
| `int`, `uint` | number | In-range integer or `bigint`. |
| `long`, `ulong` | number for a 32-bit native `long`; `bigint` for a 64-bit native `long` | In-range integer `number` or `bigint` for 32-bit storage; in-range `bigint` only for 64-bit storage. |
| `longlong`, `ulonglong` | `bigint` | In-range `bigint` only. |
| `float`, `double` | number | Finite number. |
| `stringaddress` | string | String stored in SourceJS-owned stable native text storage. |
| `stringarray` | string | String truncated to the reflected fixed-array capacity. |
| `address` | `bigint` | Non-negative `bigint` within the platform pointer width. |
| `vector` | Live write-through `{ X, Y, Z }` view | Vector-compatible value. |
| `vectorxy` | Live write-through `{ X, Y }` view | Vector-compatible value; only `X`/`Y` are written. |
| `entity` | Live entity object or `null` | Valid entity handle/index/object. |

When `strPropertyType` is `undefined`, `null` or omitted, SourceJS infers from sendprop metadata: float, vector/vectorxy, fixed
string, datatable address as `bigint`, or native integer storage. Standard native proxies determine integer signedness
and the 8-, 16-, 32- or 64-bit storage width, not the property's network bit count or flags. Reads up to 32 bits return
`number`; 64-bit reads return `bigint`. Unknown or unavailable standard integer proxies throw instead of guessing a
four-byte field. An inferred datatable address is read-only; `SetProperty()` throws rather than guessing writable storage.

```js
const { GetProperty, SetProperty } = require("weapons");

function CopyWeaponPropertyValue(PropertyValue) {
	if ((PropertyValue === null) || (typeof PropertyValue !== "object")) {
		return PropertyValue;
	}

	if ((typeof PropertyValue.X !== "number") || (typeof PropertyValue.Y !== "number")) {
		return PropertyValue;
	}

	const OwnedPropertyValue = { X: PropertyValue.X, Y: PropertyValue.Y };
	if ("Z" in PropertyValue) {
		OwnedPropertyValue.Z = PropertyValue.Z;
	}

	return OwnedPropertyValue;
}

function WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, PropertyCallback) {
	if (typeof PropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, PropertyCallback) expects a function callback.");
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

Explicit scalar types must match the actual native field layout; omit `strPropertyType` for proxy-based integer inference.
For `vector` and `vectorxy`, mutating components on the returned object writes directly to entity memory; copy component
values first when a detached copy is required.

The generic workflow uses the same synchronous cleanup rules as the ammo workflow. It copies only vector components,
not arbitrary objects; any other borrowed result retains its own lifetime requirements. Keep the entity and property
storage valid until restoration completes. A returned promise is not awaited, and cleanup errors can replace earlier
results or failures.

## Typed Scalar Sendprops

The dedicated pairs select signed 32-bit integer or native `float` storage without a type string and retain native
range/property validation. Choose the pair for the actual storage representation, not as a conversion between engine
field types:

```js
const { GetPropertyFloat, GetPropertyInteger, SetPropertyFloat, SetPropertyInteger } = require("weapons");

function WithTemporaryWeaponInteger(WeaponReference, strPropertyName, nTemporaryPropertyValue, PropertyCallback) {
	if (typeof PropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponInteger(WeaponReference, strPropertyName, nTemporaryPropertyValue, PropertyCallback) expects a function callback.");
	}

	const nOriginalPropertyValue = GetPropertyInteger(WeaponReference, strPropertyName);

	SetPropertyInteger(WeaponReference, strPropertyName, nTemporaryPropertyValue);

	try {
		return PropertyCallback(GetPropertyInteger(WeaponReference, strPropertyName));
	} finally {
		SetPropertyInteger(WeaponReference, strPropertyName, nOriginalPropertyValue);
	}
}

function WithTemporaryWeaponFloat(WeaponReference, strPropertyName, flTemporaryPropertyValue, PropertyCallback) {
	if (typeof PropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponFloat(WeaponReference, strPropertyName, flTemporaryPropertyValue, PropertyCallback) expects a function callback.");
	}

	const flOriginalPropertyValue = GetPropertyFloat(WeaponReference, strPropertyName);

	SetPropertyFloat(WeaponReference, strPropertyName, flTemporaryPropertyValue);

	try {
		return PropertyCallback(GetPropertyFloat(WeaponReference, strPropertyName));
	} finally {
		SetPropertyFloat(WeaponReference, strPropertyName, flOriginalPropertyValue);
	}
}
```

Both helpers reject a non-function callback before reading or mutating weapon memory. Native property functions validate
the entity, property and value, but do not separately classify the entity as a weapon.

## Entity Sendprops

`GetPropertyEntity()` decodes a `CBaseHandle` and returns a current entity object. Invalid, stale or unresolved handles
produce `null`. `SetPropertyEntity()` requires `EntityReference` to resolve to a valid entity handle; `null` does not clear
the property.

```js
const { GetPropertyEntity, SetPropertyEntity } = require("weapons");

function WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, EntityCallback) {
	if (typeof EntityCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, EntityCallback) expects a function callback.");
	}

	const OriginalEntityReference = GetPropertyEntity(WeaponReference, strPropertyName);
	if (OriginalEntityReference === null) {
		throw new Error(`WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, EntityCallback) cannot restore unresolved property "${strPropertyName}".`);
	}

	SetPropertyEntity(WeaponReference, strPropertyName, TemporaryEntityReference);

	try {
		return EntityCallback(GetPropertyEntity(WeaponReference, strPropertyName));
	} finally {
		SetPropertyEntity(WeaponReference, strPropertyName, OriginalEntityReference);
	}
}
```

Both returned entity objects are live and can become invalid independently. Use this temporary pattern only when both
entities are expected to remain valid through restoration.

## Character-Array Sendprops

Both string name pairs read and write fixed character arrays. The setter reserves a terminating NUL byte and copies
UTF-8 bytes, not JavaScript characters: truncation can split a multibyte sequence, and embedded NUL stops the copy.
It uses a positive reflected element count when available, otherwise its native 256-byte fallback. That fallback is not
proof of the actual field capacity; verify the selected SDK's storage metadata before writing.

```js
const { GetPropertyString, GetPropertyStringArray, SetPropertyString, SetPropertyStringArray } = require("weapons");

function WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryPropertyValue, PropertyCallback) {
	if (typeof PropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryPropertyValue, PropertyCallback) expects a function callback.");
	}

	const strOriginalPropertyValue = GetPropertyString(WeaponReference, strPropertyName);

	SetPropertyString(WeaponReference, strPropertyName, strTemporaryPropertyValue);

	try {
		return PropertyCallback(GetPropertyStringArray(WeaponReference, strPropertyName));
	} finally {
		SetPropertyStringArray(WeaponReference, strPropertyName, strOriginalPropertyValue);
	}
}
```

Character-array properties are game-specific. Resolve the property and reflected capacity through `entities/props`
instead of assuming a CS:GO field exists on another SDK.

## Removing A Weapon

`Remove(WeaponValue)` first attempts to drop through the current owner. A `false` drop result does not prevent native
removal, but a thrown owner/property/drop error does. The native removal result can be `false`; invalid or expired
references can instead throw during the earlier strict owner lookup. There is no queued removal or rollback of a drop.
Remove only an entity that the plugin deliberately created or otherwise owns.

```js
const { GetClassName, GetName, Remove } = require("weapons");

function RemoveOwnedWeapon(WeaponReference) {
	const RemovalReport = { ClassName: GetClassName(WeaponReference), Index: null, Name: "", Removed: false };
	if (RemovalReport.ClassName === "") {
		return RemovalReport;
	}

	RemovalReport.Index = WeaponReference.Index;
	RemovalReport.Name = GetName(WeaponReference);
	RemovalReport.Removed = Remove(WeaponReference);

	return RemovalReport;
}
```

Capture only copied scalar metadata before removal. Do not read the wrapper after success, and remember that the engine
may later reuse the same entity index for an unrelated edict.

This example takes an indexed weapon object. An empty class-name result returns `Index: null`, `Name: ""` and
`Removed: false` without reading remaining metadata or attempting removal. Classification itself can still throw,
and a positive class-name result does not pin the object during the subsequent reads and removal.

## Errors and Lifetime

- Requiring the module without the SourceJS native runtime throws; there is no fallback.
- Enumeration requires initialized globals and a usable edict list, normally after map startup.
- `GetCount()` throws when the current count exceeds the supported signed integer range.
- `GetWeaponsByClassName()` and `GetWeaponsByName()` reject empty or non-string input.
- Native weapon argument readers preserve existing JavaScript conversion errors and do not commit failed reads to their outputs. Enumeration, name/class-name lookup, counting, removal, and dictionary callbacks translate C++ failures at their boundaries. A failed index conversion stops before engine lookup or removal.
- Native weapon/name arrays, dictionary entries, and dictionary result properties are created as own data properties, bypassing inherited setters. Failed construction returns no partial result and preserves the underlying JavaScript error.
- `Weapon()` rejects malformed/negative input but returns `null` for a valid non-weapon index.
- `GetCurrentWeapon()` throws for malformed player input and returns `null` for an unresolved active handle.
- The alternate owner-ammo layout path throws when reserve storage, owner, ammo type or owner ammo storage cannot be resolved.
- Property access throws for an invalid entity reference, unknown sendprop path, unknown explicit type or incompatible value.
- Setter functions write engine memory synchronously and return `true` after a completed write.
- Temporary helpers attempt restoration only after the initial setter completes. They do not await promises; callback,
  follow-up read and cleanup errors propagate, and a cleanup error can replace an earlier result or error.
- `GetClip()`/`GetSecondaryClip()` and ammo-type getters reject negative current storage. Clip setters first perform the
  corresponding getter; writing a negative clip can make a later guarded read or restoration fail.
- `Drop()` can return `false` for an unresolved positive-index owner; `Remove()` ignores that boolean but not an exception.
- Weapon wrappers hold no ownership. Removal, map changes and index reuse invalidate prior assumptions immediately.

## Common Mistakes

- Do not mutate `GetAllWeapons()[0]` merely because it is the first current weapon; resolve a weapon owned by the intended workflow.
- Do not assume separate inventory scans describe one atomic world state.
- Do not hard-code a branch-specific sendprop without checking `entities/props` metadata.
- Do not use `GetPropertyString()` for an address-valued string; select explicit `stringaddress` only when the storage
  really is `char*`.
- Do not pass `null` to `SetPropertyEntity()` expecting an invalid handle to be written.
- Do not retain a weapon wrapper after successful removal.
- Do not add compatibility aliases, aggregate submodules, defaults or module-name metadata.

## Related Modules

- [`weapons/entity`](weapons-entity.md) documents decorated weapon fields and methods.
- [`entities/props`](entities-props.md) documents send-table reflection and every property storage type.
- [`weapons/manager`](weapons-manager.md) combines live weapon scans with cached profile metadata.
