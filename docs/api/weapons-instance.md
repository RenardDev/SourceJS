# `require("weapons/instance")`

> AI agents: read Construction, Members, Ownership and Lifetime, and Errors before changing a cached profile record.
> This reference is intentionally explicit about shared record ownership, lazy Script reads, and realtime ConVar reads.

`weapons/instance` contains the JavaScript `WeaponClass` view used for one normalized weapon-data record. It does not
represent a spawned entity and does not read an edict. Use it to build class catalogs, inspect selected-SDK metadata
and retain plugin-owned copies of profile records.

## Contents

- [Import](#import)
- [Export](#export)
- [Construction](#construction)
- [Members](#members)
- [Realtime Ammo Limits](#realtime-ammo-limits)
- [Resolve a Class by Name](#resolve-a-class-by-name)
- [Build a Complete Metadata Record](#build-a-complete-metadata-record)
- [Build a Tag Catalog](#build-a-tag-catalog)
- [Create a Realtime Ammo Reader](#create-a-realtime-ammo-reader)
- [Create a Plugin-Owned Class](#create-a-plugin-owned-class)
- [Ownership and Lifetime](#ownership-and-lifetime)
- [Errors](#errors)
- [Related Modules](#related-modules)

## Import

```js
const { WeaponClass } = require("weapons/instance");
```

## Export

| Export | Type | Purpose |
| --- | --- | --- |
| `WeaponClass` | Class | Exposes one weapon-data record through named getters and exact tag membership. |

The module exports no singleton and does not load profiles or read ConVars merely by importing `WeaponClass`.
Importing it resolves its `cvars` dependency and requires the native runtime; it is not a standalone offline module.

## Construction

```js
const { WeaponClass } = require("weapons/instance");

function WrapWeaponRecord(WeaponRecord) {
	return new WeaponClass(WeaponRecord);
}

module.exports = { WrapWeaponRecord };
```

The constructor's `Record` argument must be non-null, satisfy `typeof Record === "object"`, and not be an array. It stores that exact object in the
own writable, enumerable `ValueRecord` field; the inherited read-only `Record` accessor reads the current `ValueRecord`.
The constructor does not copy, normalize or validate the record's fields. Use
[`weapons/data`](weapons-data.md) when the caller needs a record normalized from the packaged selected-SDK profile.

The class getters are inherited accessors without setters. Each getter reads the current property from `ValueRecord`, so
replacing a scalar or object on the record is visible through an existing `WeaponClass`. Assigning to a getter itself
in strict JavaScript throws instead of changing the record. Replacing `ValueRecord` redirects every getter and `HasTag()`
to that replacement without revalidating it; keep it a valid record. `Record` is not an immutable snapshot.

`MaximumAmmo` and `SecondaryMaximumAmmo` capture their backing field once per getter access, then either resolve that
captured string as a ConVar name or return the captured non-string value unchanged. Later accesses read the record again.

## Members

| Member | Result |
| --- | --- |
| `ValueRecord` | Own writable field holding the current backing record; initially the exact constructor argument. |
| `Record` | The current `ValueRecord`; inherited accessor without a setter. |
| `AmmoProperty` | `Record.AmmoProperty`; the primary reserve-ammo property path in normalized data. |
| `BaseName` | `Record.BaseName`; the profile section name before prefix normalization. |
| `ClassName` | `Record.ClassName`; the full entity class name. |
| `Clip` | `Record.Clip`; the primary clip capacity in normalized data. |
| `Cost` | `Record.Cost`; the purchase cost in normalized data. |
| `Data` | The exact `Record.Data` object. |
| `ID` | `Record.ID`; the selected-SDK weapon identifier. |
| `ItemDefinitionIndex` | `Record.ItemDefinitionIndex`; a finite numeric `ID` copied by `weapons/data`, otherwise `null`. |
| `MaximumAmmo` | `Record.MaximumAmmo`, or the current integer value of the ConVar named by a string value. |
| `Name` | `Record.Name`; the normalized name without the configured class prefix. |
| `ParentClass` | `Record.ParentClass`; the parent entity class in normalized data. |
| `Script` | The exact `Record.Script` result. Normalized `weapons/data` records load it lazily through `weapons/scripts.Load()`; access can perform filesystem IO. |
| `SecondaryAmmoProperty` | `Record.SecondaryAmmoProperty`; the secondary reserve-ammo property path. |
| `SecondaryMaximumAmmo` | `Record.SecondaryMaximumAmmo`, or the current integer value of the ConVar named by a string value. |
| `Slot` | `Record.Slot`; the selected-SDK inventory slot value. |
| `Tags` | The exact `Record.Tags` array. |
| `Type` | `Record.Type`; the selected-SDK weapon type value. |
| `HasTag(strTag)` | Returns `Record.Tags.includes(strTag)` after requiring `strTag` to be a string. |

For a record returned by `weapons/data`, absent optional scalar and numeric fields are `null`, `Tags` is an array, and
`Data` is the retained raw profile section. A caller-created record can contain other values because `WeaponClass`
deliberately remains a small view rather than a second normalization layer.

For standard array-valued `Tags`, `HasTag()` uses case-sensitive exact JavaScript element membership. The wrapper
does not trim, lowercase or expand the tag. It does not validate `Tags` as an array or coerce the result to a boolean:
a caller-provided `Tags.includes()` implementation controls its own matching behavior and return value.

## Realtime Ammo Limits

`MaximumAmmo` and `SecondaryMaximumAmmo` are the only getters that interpret a record value:

- A string is treated as a ConVar name and passed directly to `cvars.GetConVarInteger()` on every getter access.
- Any non-string value is returned unchanged.
- The getter does not cache the integer or replace the original record value.
- A changed ConVar is therefore visible through an already-created instance.

The raw configured values remain in `Record.MaximumAmmo` and `Record.SecondaryMaximumAmmo`. This distinction lets a
caller report both the profile source and its current resolved limit.

String-backed reads are synchronous native CVar operations on the game thread, not queued worker requests. An explicit
profile branch does not switch the running server's ConVars. A pair of getter reads is not an atomic snapshot.

## Resolve a Class by Name

Resolve a requested name through `weapons/data` before wrapping it. The input may use a normalized name, base name,
full class name or configured special or projectile name accepted by `Get()`.

```js
const { Get } = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

function RequireWeaponClass(strWeaponName, strSDKBranch) {
	const WeaponRecord = Get(strWeaponName, strSDKBranch);
	if (WeaponRecord === null) {
		throw new RangeError(`Unknown weapon class: ${strWeaponName}`);
	}

	return new WeaponClass(WeaponRecord);
}

module.exports = { RequireWeaponClass };
```

Calling `RequireWeaponClass("pistol")` uses the active SDK branch. Passing an explicit packaged branch is useful for
cross-branch catalog work within the configured runtime; it does not make that branch's entity APIs or ConVars available
in the running server, nor remove the module's native-runtime dependency.

## Build a Complete Metadata Record

This workflow reads the exposed metadata fields and accessors and returns structured data to its caller. The returned
`Record`, `ValueRecord`, `Data`, `Script` and `Tags` values retain their original identities; copy them when the receiver
needs independent ownership.

```js
const { Get } = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

function InspectWeaponClass(strWeaponName, strSDKBranch) {
	const WeaponRecord = Get(strWeaponName, strSDKBranch);
	if (WeaponRecord === null) {
		return null;
	}

	const WeaponClassView = new WeaponClass(WeaponRecord);

	return {
		AmmoProperty: WeaponClassView.AmmoProperty,
		BaseName: WeaponClassView.BaseName,
		ClassName: WeaponClassView.ClassName,
		Clip: WeaponClassView.Clip,
		Cost: WeaponClassView.Cost,
		Data: WeaponClassView.Data,
		ID: WeaponClassView.ID,
		ItemDefinitionIndex: WeaponClassView.ItemDefinitionIndex,
		MaximumAmmo: WeaponClassView.MaximumAmmo,
		Name: WeaponClassView.Name,
		ParentClass: WeaponClassView.ParentClass,
		Record: WeaponClassView.Record,
		Script: WeaponClassView.Script,
		SecondaryAmmoProperty: WeaponClassView.SecondaryAmmoProperty,
		SecondaryMaximumAmmo: WeaponClassView.SecondaryMaximumAmmo,
		Slot: WeaponClassView.Slot,
		Tags: WeaponClassView.Tags,
		Type: WeaponClassView.Type,
		ValueRecord: WeaponClassView.ValueRecord,
	};
}

module.exports = { InspectWeaponClass };
```

Either ammo getter can throw while this function builds the result if its record contains a ConVar name that the
native CVar API cannot resolve. The `Script` read can also perform synchronous filesystem IO or throw. The workflow
does not assign shared record fields, but reads can invoke accessors and dependency operations; it is not an atomic
snapshot or a side-effect-free deep copy. Custom record accessors can run arbitrary caller-provided code.

## Build a Tag Catalog

Build a selected-SDK catalog from all records that contain one exact tag. This returns plain caller-owned summary
objects without assigning shared profile fields. `GetAll()` may load the profile into the module's cache first.

```js
const { GetAll } = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

function BuildWeaponTagCatalog(strWeaponTag, strSDKBranch) {
	if (typeof strWeaponTag !== "string") {
		throw new TypeError("Weapon tag must be a string.");
	}

	const vecWeaponCatalog = [];
	for (const WeaponRecord of GetAll(strSDKBranch)) {
		const WeaponClassView = new WeaponClass(WeaponRecord);
		if (WeaponClassView.HasTag(strWeaponTag)) {
			vecWeaponCatalog.push({ ClassName: WeaponClassView.ClassName, Name: WeaponClassView.Name, Slot: WeaponClassView.Slot, Type: WeaponClassView.Type });
		}
	}

	return vecWeaponCatalog;
}

module.exports = { BuildWeaponTagCatalog };
```

Packaged normalization uses `"all"` when a profile entry has no non-empty tags. Other tag names remain profile data
and can differ between SDK branches.

## Create a Realtime Ammo Reader

Create the closure once, then invoke it whenever a menu, command or event handler needs the current limits. A
string-backed value performs a fresh native ConVar read on every call.

```js
const { Get } = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

function CreateAmmoLimitReader(strWeaponName, strSDKBranch) {
	const WeaponRecord = Get(strWeaponName, strSDKBranch);
	if (WeaponRecord === null) {
		throw new RangeError(`Unknown weapon class: ${strWeaponName}`);
	}

	const WeaponClassView = new WeaponClass(WeaponRecord);

	function ReadAmmoLimits() {
		return { MaximumAmmo: WeaponClassView.MaximumAmmo, SecondaryMaximumAmmo: WeaponClassView.SecondaryMaximumAmmo, ClassName: WeaponClassView.ClassName, MaximumAmmoSource: WeaponClassView.Record.MaximumAmmo, SecondaryMaximumAmmoSource: WeaponClassView.Record.SecondaryMaximumAmmo };
	}

	return ReadAmmoLimits;
}

module.exports = { CreateAmmoLimitReader };
```

Do not retain the returned numbers as realtime state. Retain and call the reader when the current ConVar value matters.

## Create a Plugin-Owned Class

Records returned by `weapons/data` belong to that module's per-plugin cache. Copy the record and its exposed mutable
containers before adding plugin metadata.

```js
const { Get } = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

function CreatePluginWeaponClass(strWeaponName, vecAdditionalTags, strSDKBranch) {
	if (!Array.isArray(vecAdditionalTags)) {
		throw new TypeError("Additional weapon tags must be an array of strings.");
	}

	for (const strAdditionalTag of vecAdditionalTags) {
		if (typeof strAdditionalTag !== "string") {
			throw new TypeError("Additional weapon tags must be an array of strings.");
		}
	}

	const SourceWeaponRecord = Get(strWeaponName, strSDKBranch);
	if (SourceWeaponRecord === null) {
		throw new RangeError(`Unknown weapon class: ${strWeaponName}`);
	}

	const PluginWeaponRecord = Object.assign({}, SourceWeaponRecord);
	PluginWeaponRecord.Data = Object.assign(Object.create(null), SourceWeaponRecord.Data);
	PluginWeaponRecord.Tags = SourceWeaponRecord.Tags.slice();
	for (const strAdditionalTag of vecAdditionalTags) {
		if (!PluginWeaponRecord.Tags.includes(strAdditionalTag)) {
			PluginWeaponRecord.Tags.push(strAdditionalTag);
		}
	}

	return new WeaponClass(PluginWeaponRecord);
}

module.exports = { CreatePluginWeaponClass };
```

The returned class owns the new top-level record, `Data` object and `Tags` array. Other nested values remain shared
because the example performs a deliberate shallow copy; copy them too when the plugin intends to mutate them.

The `Data` copy uses a null-prototype target so raw keys such as `__proto__` remain own data fields instead of
selecting the copy's prototype.

`Object.assign({}, SourceWeaponRecord)` reads enumerable getters immediately. In a normalized record, this invokes
the lazy `Script` getter during copying and stores its returned value as an ordinary field, not a lazy accessor.
Later source getter results do not replace that field; its existing nested value still remains shared. Copying can
therefore perform synchronous filesystem IO or throw before a class is returned. A retained `MaximumAmmo` string
still triggers a fresh native ConVar read through the new class. This copy is not a deep clone or an atomic snapshot.

## Ownership and Lifetime

`WeaponClass` is an ordinary JavaScript object. Its `ValueRecord` retains a strong reference to the current backing record.
The wrapper has no explicit disposal method, native handle or entity lifetime. Garbage collection can reclaim the wrapper
and a plugin-owned record when no JavaScript reference remains.

A normalized record returned by `weapons/data` belongs to that module's current cache:

- Multiple wrappers around the same record observe the same scalar replacements and nested mutations.
- Replacing one wrapper's `ValueRecord` redirects only that wrapper; it does not replace other wrappers' backing records.
- `ClearCache()` removes the data module's cache entries but does not invalidate an existing wrapper; the wrapper
  continues to retain its old record.
- A later `GetAll()`, `Get()` or `Load()` after `ClearCache()` can return newly parsed record objects that are independent
  of old wrappers.
- Mutating a cached record changes what later wrappers in the same plugin context observe until that cache entry is
  cleared.

Numeric limits, identifiers, slots and types are profile metadata, not live entity sendprops. Only string-backed
ammo-limit getters cross into the native CVar API. Use [`weapons/entity`](weapons-entity.md) or
[`weapons/engines`](weapons-engines.md) for spawned weapon state.

Metadata with no native-backed reads is ordinary JavaScript data. Call string-backed ammo getters and workflows that
may reach the native CVar API on the game thread; retaining a JavaScript wrapper does not make those operations worker-safe.

## Errors

- `new WeaponClass(Record)` throws `TypeError` when `Record` is nullish, primitive, a function, or an array.
- `HasTag(strTag)` throws `TypeError` when `strTag` is not a string.
- A caller-created record without an array-like `Tags.includes` operation causes the normal V8 property or call error
  when `HasTag()` reaches it.
- A string `MaximumAmmo` or `SecondaryMaximumAmmo` value is passed directly to `cvars.GetConVarInteger()`. Missing ConVars and native
  CVar failures propagate unchanged.
- Other getters do not validate their field. A missing field is returned as `undefined`; malformed caller-owned
  values are returned unchanged unless property access itself fails. Record accessors and proxies can throw.
- Replacing `ValueRecord` with an invalid value is not rejected at assignment time; later member access can throw.
- Profile lookup, parsing, branch and filesystem errors from `weapons/data` propagate through the example workflows.

The module has no lowercase-class, factory, module-name or default compatibility export. Import the documented
`WeaponClass` member directly.

## Related Modules

- [`weapons/data`](weapons-data.md) parses packaged profiles, selects branches and owns normalized record caches.
- [`weapons/manager`](weapons-manager.md) provides cached class lookup by weapon name.
- [`weapons/entity`](weapons-entity.md) decorates one spawned weapon edict.
- [`weapons/engines`](weapons-engines.md) exposes the selected-SDK native weapon operations directly.
- [`cvars`](cvars.md) provides the native `GetConVarInteger()` operation used for string-backed ammo limits.
