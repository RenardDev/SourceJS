> AI processing note: this document is long; read it by section and use the contents links to navigate.

# `require("weapons/engines")`

> Warning: this module is a direct native selected-SDK facade. Its objects and sendprop views refer to live engine
> memory, its scans are not atomic, and setters and remove operations act synchronously on the server thread.

`weapons/engines` exposes the exact V8 object installed for the compiled HL2SDK branch. It provides current
weapon-edict discovery, active-weapon lookup, reserve ammo, generic sendprops, typed sendprops and immediate removal
without the JavaScript decoration added by `require("weapons")`.

The package file is `packages/sourcejs/weapons/engines.js`. It performs no adaptation: requiring it returns
`sourcejs["weapons/engines"]` by identity.

## Contents

- [Import](#import)
- [Export Reference](#export-reference)
- [Inspecting Current Inventory](#inspecting-current-inventory)
- [Reading an Active Weapon](#reading-an-active-weapon)
- [Editing Reserve Ammo](#editing-reserve-ammo)
- [Generic Sendprops](#generic-sendprops)
- [Editing a Generic Sendprop](#editing-a-generic-sendprop)
- [Typed Integer and Float Sendprops](#typed-integer-and-float-sendprops)
- [Entity-Handle Sendprops](#entity-handle-sendprops)
- [Character-Array Sendprops](#character-array-sendprops)
- [Removing a Caller-Owned Weapon](#removing-a-caller-owned-weapon)
- [Selected-SDK Surface](#selected-sdk-surface)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	BRANCH,
	GetAllWeapons,
	GetWeapon,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClassName,
	GetName,
	GetCurrentWeapon,
	Remove,
	GetProperty,
	SetProperty,
	GetPropertyInteger,
	SetPropertyInteger,
	GetPropertyFloat,
	SetPropertyFloat,
	GetPropertyString,
	SetPropertyString,
	GetPropertyStringArray,
	SetPropertyStringArray,
	GetPropertyEntity,
	SetPropertyEntity,
	GetAmmo,
	SetAmmo,
} = require("weapons/engines");
```

There are no JavaScript wrappers, public compatibility aliases, fallback functions or aggregate game-specific members.

## Export Reference

| Export | Return or effect |
| --- | --- |
| `BRANCH` | Compile-time `SOURCEJS_SDK_BRANCH` string. |
| `GetAllWeapons()` | Fresh array of current native weapon objects. |
| `GetWeapon(WeaponReference)` | Fresh native weapon object for a valid current weapon, otherwise `null`. |
| `GetWeaponsByClassName(strWeaponClassName)` | Fresh exact-class match array. |
| `GetWeaponsByName(strWeaponName)` | Fresh normalized short-name match array. |
| `GetClassName(WeaponReference)` | Current entity class name, or `""` when unresolved. |
| `GetName(WeaponReference)` | Current short weapon name, or `""` when unresolved. |
| `GetCurrentWeapon(PlayerReference)` | Player's current active native weapon, or `null`. |
| `Remove(WeaponReference)` | Immediately remove a valid weapon entity and return the native boolean result. |
| `GetAmmo(WeaponReference)` | Read primary reserve ammo through the selected branch's supported path. |
| `SetAmmo(WeaponReference, nAmmo)` | Write primary reserve ammo and return `true`. |
| `GetProperty(WeaponReference, strPropertyName, strPropertyType?)` | Read an inferred or explicit canonical sendprop type. |
| `SetProperty(WeaponReference, strPropertyName, PropertyValue, strPropertyType?)` | Write an inferred or explicit canonical sendprop type and return `true`. |
| `GetPropertyInteger(WeaponReference, strPropertyName)` | Read signed 32-bit integer storage. |
| `SetPropertyInteger(WeaponReference, strPropertyName, nPropertyValue)` | Write signed 32-bit integer storage and return `true`. |
| `GetPropertyFloat(WeaponReference, strPropertyName)` | Read a floating-point sendprop. |
| `SetPropertyFloat(WeaponReference, strPropertyName, flPropertyValue)` | Write a floating-point sendprop and return `true`. |
| `GetPropertyEntity(WeaponReference, strPropertyName)` | Read an entity-handle sendprop as a live entity or `null`. |
| `SetPropertyEntity(WeaponReference, strPropertyName, EntityReference)` | Write a valid entity handle, index or indexed object and return `true`. |
| `GetPropertyString(WeaponReference, strPropertyName)` | Read a reflected fixed character array as a string. |
| `SetPropertyString(WeaponReference, strPropertyName, strPropertyValue)` | Write a reflected fixed character array and return `true`. |
| `GetPropertyStringArray(WeaponReference, strPropertyName)` | Read through the explicit fixed-array export. |
| `SetPropertyStringArray(WeaponReference, strPropertyName, strPropertyValue)` | Write through the explicit fixed-array export and return `true`. |

Weapon and player arguments accept non-negative int32 entity indexes or indexed objects at the native boundary. Discovery
and lookup objects are native live wrappers, not decorated `Weapon` objects.

## Inspecting Current Inventory

Use caller-supplied selectors rather than mutating an arbitrary `GetAllWeapons()[0]` result:

```js
const {
	BRANCH,
	GetAllWeapons,
	GetWeapon,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClassName,
	GetName,
} = require("weapons/engines");

function InspectWeaponInventory(unWeaponIndex, strWeaponClassNameQuery, strWeaponNameQuery) {
	const vecClassMatchIndexes = [];
	const vecWeaponInventory = [];
	const vecNameMatchIndexes = [];
	const SelectedWeapon = GetWeapon(unWeaponIndex);
	let SelectedWeaponDetails = null;

	for (const MatchingWeapon of GetWeaponsByClassName(strWeaponClassNameQuery)) {
		vecClassMatchIndexes.push(MatchingWeapon.Index);
	}

	for (const CurrentWeapon of GetAllWeapons()) {
		vecWeaponInventory.push({ ClassName: GetClassName(CurrentWeapon), Index: CurrentWeapon.Index, Name: GetName(CurrentWeapon) });
	}

	for (const MatchingWeapon of GetWeaponsByName(strWeaponNameQuery)) {
		vecNameMatchIndexes.push(MatchingWeapon.Index);
	}

	if (SelectedWeapon !== null) {
		SelectedWeaponDetails = { ClassName: GetClassName(SelectedWeapon), Index: SelectedWeapon.Index, Name: GetName(SelectedWeapon) };
	}

	return { Branch: BRANCH, ClassMatchIndexes: vecClassMatchIndexes, WeaponInventory: vecWeaponInventory, NameMatchIndexes: vecNameMatchIndexes, SelectedWeaponDetails };
}
```

Each lookup is an independent current-edict operation. Entity creation or removal between calls can produce different
memberships. Returned arrays own their membership, while native weapon objects remain tied to engine lifetime.

## Reading an Active Weapon

`GetCurrentWeapon(PlayerReference)` resolves the player's live active-weapon handle. It returns `null` when the handle
is invalid or resolves to no live edict. A live edict is wrapped without separately checking its weapon class; use the
result's live `IsWeapon` property when that distinction matters.

```js
const {
	GetCurrentWeapon,
	GetName,
} = require("weapons/engines");

function InspectActiveWeapon(PlayerReference) {
	const ActiveWeapon = GetCurrentWeapon(PlayerReference);
	if (ActiveWeapon === null) {
		return null;
	}

	return { Index: ActiveWeapon.Index, Name: GetName(ActiveWeapon), Weapon: ActiveWeapon };
}
```

The caller chooses and validates the player. The returned `Weapon` is still live; copy scalar fields before retaining
or serializing the report.

## Editing Reserve Ammo

The selected SDK branch implements reserve ammo through either its direct field or the weapon owner and primary
ammo-type sendprops. Unsupported owner, type or property state throws; no branch-independent value is invented.

```js
const {
	GetAmmo,
	SetAmmo,
} = require("weapons/engines");

function WithTemporaryWeaponAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) {
	if (typeof AmmoCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponAmmo(WeaponReference, nTemporaryAmmo, AmmoCallback) expects a callback function.");
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

Choose `nTemporaryAmmo` within the signed int32 range and game rules. Restoration is attempted only after the initial
write succeeds and can itself fail if the weapon or owner disappears during the callback. Its error replaces any
callback error or result. Keep the weapon, owner and ammo-type selection stable; avoid asynchronous work inside this
workflow. Returning a promise does not delay restoration.

## Generic Sendprops

`GetProperty(WeaponReference, strPropertyName, strPropertyType?)` and `SetProperty(WeaponReference, strPropertyName, PropertyValue, strPropertyType?)` resolve a nested sendprop path against the current weapon's server class. With an
explicit `strPropertyType`, the canonical strings are:

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
| `stringarray` | string | String truncated to reflected fixed-array capacity. |
| `address` | `bigint` | Non-negative `bigint` within the platform pointer width. |
| `vector` | Live write-through `{ X, Y, Z }` view | Vector-compatible value. |
| `vectorxy` | Live write-through `{ X, Y }` view | Vector-compatible value; only `X`/`Y` are written. |
| `entity` | Live entity object or `null` | Valid entity handle, index or indexed object. |

When `strPropertyType` is omitted, `undefined` or `null`, SourceJS infers float, vector or vectorxy, fixed string,
datatable address as `bigint`, or native integer storage. For integers, standard native proxies determine signedness
and the 8-, 16-, 32- or 64-bit storage width, not the property's network bit count or flags. Reads up to 32 bits return
`number`; 64-bit reads return `bigint`. Unknown or unavailable standard integer proxies throw instead of guessing a
four-byte field. An inferred datatable address is read-only;
`SetProperty(WeaponReference, strPropertyName, PropertyValue, strPropertyType?)` throws instead of guessing writable storage.

Integer writes validate the selected storage type's numeric range; explicit types must match the actual native layout.
64-bit integer reads and writes and native addresses use `bigint`; explicit
address writes require a non-negative value representable by the platform's `uintptr_t`. Vector component assignment
writes directly to engine memory.

## Editing a Generic Sendprop

Copy vector components before setting a temporary value. This controller is intended for scalar, vector, string and
address properties; use the dedicated entity-handle controller below for entity lifetime handling.

```js
const {
	GetProperty,
	SetProperty,
} = require("weapons/engines");

function CopyWeaponPropertyValue(PropertyValue) {
	if ((PropertyValue === null) || (typeof PropertyValue !== "object") || (typeof PropertyValue.X !== "number") || (typeof PropertyValue.Y !== "number")) {
		return PropertyValue;
	}

	const CopiedPropertyValue = { X: PropertyValue.X, Y: PropertyValue.Y };
	if ("Z" in PropertyValue) {
		CopiedPropertyValue.Z = PropertyValue.Z;
	}

	return CopiedPropertyValue;
}

function WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, WeaponPropertyCallback) {
	if (strPropertyType === "entity") {
		throw new TypeError("WithTemporaryWeaponProperty() cannot manage entity sendprops; use WithTemporaryWeaponEntity().");
	}

	if (typeof WeaponPropertyCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponProperty(WeaponReference, strPropertyName, strPropertyType, TemporaryPropertyValue, WeaponPropertyCallback) expects a callback function.");
	}

	const OriginalPropertyValue = CopyWeaponPropertyValue(GetProperty(WeaponReference, strPropertyName, strPropertyType));

	SetProperty(WeaponReference, strPropertyName, TemporaryPropertyValue, strPropertyType);

	try {
		return WeaponPropertyCallback(GetProperty(WeaponReference, strPropertyName, strPropertyType));
	} finally {
		SetProperty(WeaponReference, strPropertyName, OriginalPropertyValue, strPropertyType);
	}
}
```

The callback must stay synchronous and the weapon and property selection must remain stable through restoration.
Returning its live vector view beyond restoration would expose the restored engine field, not a detached copy.
The copy helper detaches `X`/`Y` and optional `Z` only; it does not deep-clone arbitrary objects. Initial setter failure
prevents the callback and restoration; cleanup failure replaces a callback error or result. No atomic rollback is guaranteed.

## Typed Integer and Float Sendprops

The dedicated pairs avoid a type string while retaining property existence and native range validation. The integer
pair explicitly selects signed C++ `int` storage (32-bit on the supported SDK targets); it does not infer a narrower
field or different signedness from the native proxy. Use generic `GetProperty()`/`SetProperty()` without
`strPropertyType` when proxy-based inference is required. Every typed access must match the actual field layout:

```js
const {
	GetPropertyInteger,
	SetPropertyInteger,
	GetPropertyFloat,
	SetPropertyFloat,
} = require("weapons/engines");

function WithTemporaryWeaponScalars(WeaponReference, strIntegerPropertyName, nTemporaryIntegerPropertyValue, strFloatPropertyName, flTemporaryFloatPropertyValue, WeaponScalarsCallback) {
	if (typeof WeaponScalarsCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponScalars(WeaponReference, strIntegerPropertyName, nTemporaryIntegerPropertyValue, strFloatPropertyName, flTemporaryFloatPropertyValue, WeaponScalarsCallback) expects a callback function.");
	}

	const nOriginalIntegerPropertyValue = GetPropertyInteger(WeaponReference, strIntegerPropertyName);
	const flOriginalFloatPropertyValue = GetPropertyFloat(WeaponReference, strFloatPropertyName);

	try {
		SetPropertyInteger(WeaponReference, strIntegerPropertyName, nTemporaryIntegerPropertyValue);
		SetPropertyFloat(WeaponReference, strFloatPropertyName, flTemporaryFloatPropertyValue);

		return WeaponScalarsCallback({ FloatPropertyValue: GetPropertyFloat(WeaponReference, strFloatPropertyName), IntegerPropertyValue: GetPropertyInteger(WeaponReference, strIntegerPropertyName) });
	} finally {
		try {
			SetPropertyFloat(WeaponReference, strFloatPropertyName, flOriginalFloatPropertyValue);
		} finally {
			SetPropertyInteger(WeaponReference, strIntegerPropertyName, nOriginalIntegerPropertyValue);
		}
	}
}
```

Resolve branch-specific and class-specific property names through [`entities/props`](entities-props.md) before using
this workflow. Both originals are read before the writes. Cleanup attempts float restoration first and integer
restoration even if the first attempt throws, including after an initial setter failure. The last throwing cleanup
action replaces any earlier error or callback result; this is not an atomic two-property transaction.

## Entity-Handle Sendprops

`GetPropertyEntity(WeaponReference, strPropertyName)` returns a live entity wrapper or `null`. `SetPropertyEntity(WeaponReference, strPropertyName, EntityReference)` requires a valid entity handle,
index or indexed object; this API does not use `null` as a portable clear-handle value.

```js
const {
	GetPropertyEntity,
	SetPropertyEntity,
} = require("weapons/engines");

function WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, WeaponEntityCallback) {
	if (typeof WeaponEntityCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponEntity(WeaponReference, strPropertyName, TemporaryEntityReference, WeaponEntityCallback) expects a callback function.");
	}

	const OriginalEntity = GetPropertyEntity(WeaponReference, strPropertyName);
	if (OriginalEntity === null) {
		throw new Error(`WithTemporaryWeaponEntity() cannot restore an empty entity property. Property="${strPropertyName}".`);
	}

	SetPropertyEntity(WeaponReference, strPropertyName, TemporaryEntityReference);

	try {
		return WeaponEntityCallback(GetPropertyEntity(WeaponReference, strPropertyName));
	} finally {
		SetPropertyEntity(WeaponReference, strPropertyName, OriginalEntity);
	}
}
```

The weapon and original entity must remain valid until restoration finishes. Use a valid temporary entity and keep
the weapon index and property selection stable. Initial setter failure prevents the callback and restoration; a
restoration error replaces any callback error or result. No entity ownership is transferred by this workflow.

## Character-Array Sendprops

`GetPropertyString(WeaponReference, strPropertyName)` and `GetPropertyStringArray(WeaponReference, strPropertyName)` are separate native exports backed by the same
fixed character-array reader. Their setters follow the same contract; the package does not add JavaScript compatibility
exports.

```js
const {
	GetPropertyString,
	SetPropertyString,
	GetPropertyStringArray,
	SetPropertyStringArray,
} = require("weapons/engines");

function WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryStringPropertyValue, WeaponStringCallback) {
	if (typeof WeaponStringCallback !== "function") {
		throw new TypeError("WithTemporaryWeaponString(WeaponReference, strPropertyName, strTemporaryStringPropertyValue, WeaponStringCallback) expects a callback function.");
	}

	const strOriginalStringPropertyValue = GetPropertyString(WeaponReference, strPropertyName);
	const strOriginalStringArrayPropertyValue = GetPropertyStringArray(WeaponReference, strPropertyName);
	if (strOriginalStringPropertyValue !== strOriginalStringArrayPropertyValue) {
		throw new Error(`WithTemporaryWeaponString() readers disagree. Property="${strPropertyName}".`);
	}

	SetPropertyString(WeaponReference, strPropertyName, strTemporaryStringPropertyValue);

	try {
		const strCurrentStringArrayPropertyValue = GetPropertyStringArray(WeaponReference, strPropertyName);
		SetPropertyStringArray(WeaponReference, strPropertyName, strCurrentStringArrayPropertyValue);

		return WeaponStringCallback({ StringArrayPropertyValue: strCurrentStringArrayPropertyValue, StringPropertyValue: GetPropertyString(WeaponReference, strPropertyName) });
	} finally {
		SetPropertyStringArray(WeaponReference, strPropertyName, strOriginalStringPropertyValue);
	}
}
```

The setter copies UTF-8 bytes, not JavaScript characters, up to capacity minus one and writes a final NUL. It uses a
positive reflected element count as capacity; otherwise it falls back to 256 bytes. That fallback is not proof of the
actual field size: select verified character-array storage through [`entities/props`](entities-props.md).

The readers require valid NUL-terminated native storage; they do not bound the read by reflected capacity. Embedded
NUL ends the visible string, and byte truncation can split a UTF-8 sequence. Read the value back when truncation matters.
Keep the weapon and property selection stable and the callback synchronous. Initial setter failure prevents the
callback and restoration; restoration is attempted after a successful write and its error replaces any callback
error or result. A returned promise does not defer cleanup.

## Removing a Caller-Owned Weapon

`Remove()` acts immediately and invalidates live wrappers for that entity. Keep creation and ownership policy outside
this facade:

```js
const { Remove } = require("weapons/engines");

function RemoveCallerOwnedWeapon(WeaponReference) {
	if ((WeaponReference === null) || (WeaponReference === undefined)) {
		throw new TypeError("RemoveCallerOwnedWeapon(WeaponReference) expects a weapon reference.");
	}

	return Remove(WeaponReference);
}
```

Pass only an entity created and owned by the calling operation. Never select an arbitrary live weapon from `GetAllWeapons()`
for deletion.

## Selected-SDK Surface

`BRANCH` reports the compile-time SDK selection. Treat its reflected JavaScript value as read-only; changing it does
not change the compiled native implementation or install another branch's capabilities. The common facade has the
exact 23 exports listed above.

Game-specific modules are separate capabilities. On Source 1 CS:GO builds,
[`weapons/engines/csgo`](weapons-engines-csgo.md) adds item-definition and primary-reserve fields. That module
property is absent on every other branch and is never aggregated here.

## Errors and Lifetime

- Requiring the module without the SourceJS native runtime throws; there is no fallback.
- `GetWeapon()` requires a non-negative int32 index or indexed object; class/name scans require non-empty strings.
- `GetClassName()` and `GetName()` return `""` for missing or unresolvable references; exceptions from an `Index` getter still propagate.
- Valid lookup inputs can return empty arrays, `""` or `null` when no current weapon resolves.
- Ammo and property operations throw for unresolved entities, missing properties, incompatible types, out-of-range values and
  unavailable branch state.
- Every property path is resolved against the supplied entity's current server class.
- The shared entity-property callbacks do not enforce a weapon class. Validate the supplied entity's weapon identity before
  using this facade's property helpers.
- Native objects, entity results and vector views are borrowed live state. Entity deletion and index reuse invalidate
  assumptions.
- Run discovery, lookup, reads, writes, removal and temporary workflows on the game thread, not a worker thread.
- Setters and removal act synchronously. Keep temporary workflows synchronous and short; no atomic rollback is promised.
- Restoration errors can replace a callback error or result. Avoid workflows whose entity lifetime is not controlled by the
  caller.

## Common Mistakes

- Do not assume several inventory scans observe one atomic engine state.
- Do not expect direct native weapon objects to contain decorated clip, ammo or drop methods.
- Do not hard-code a property because it exists on one game or weapon class.
- Do not retain a live vector when a detached `{ X, Y, Z }` copy is required.
- Do not convert `BigInt` property values to `Number` without an explicit range decision.
- Do not pass address strings; address values use `bigint`.
- Do not try to clear entity handles by passing `null` to `SetPropertyEntity()`.
- Do not remove a weapon whose ownership was not established by the caller.
- Do not add compatibility aliases, synthetic capability helpers, defaults, module metadata or aggregate properties.

## Related Modules

- [`weapons`](weapons.md) documents the decorated common facade and collection helpers.
- [`weapons/entity`](weapons-entity.md) documents the decorated `Weapon` factory.
- [`weapons/engines/csgo`](weapons-engines-csgo.md) documents the conditional CS:GO capability.
- [`entities/props`](entities-props.md) documents reflection, canonical types and live memory views.
- [`players/entity`](players-entity.md) documents player objects accepted by `GetCurrentWeapon()`.
