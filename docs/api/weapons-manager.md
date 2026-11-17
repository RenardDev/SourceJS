# `require("weapons/manager")`

> AI agents: distinguish Live Entity Functions from Profile Cache and Identity before using the examples.
> This module deliberately combines borrowed live weapon entities with cached profile metadata. Do not
> retain an entity object as proof that its edict is still valid.

`weapons/manager` combines realtime native scans of spawned weapon edicts with a JavaScript `WeaponManager` over the
active selected SDK profile. Module functions return borrowed entity views passed through conditional decoration; manager methods return `WeaponClass`
metadata wrappers and never inspect a spawned entity.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Live Entity Functions](#live-entity-functions)
- [WeaponManager Members](#weaponmanager-members)
- [Profile Cache and Identity](#profile-cache-and-identity)
- [Collect a Live Weapon Report](#collect-a-live-weapon-report)
- [Find Requested Live Weapons](#find-requested-live-weapons)
- [Inspect a Player's Current Weapon](#inspect-a-players-current-weapon)
- [Inspect Active Profile Rules](#inspect-active-profile-rules)
- [Resolve Profile Metadata](#resolve-profile-metadata)
- [Build a Profile Catalog](#build-a-profile-catalog)
- [Ownership and Lifetime](#ownership-and-lifetime)
- [Errors](#errors)
- [Related Modules](#related-modules)

## Import

```js
const {
	WEAPON_MANAGER,
	WeaponManager,
	GetAllWeapons,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClasses,
	GetCount,
	GetCurrentWeapon,
	GetNames,
} = require("weapons/manager");
```

## Exports

| Export | Type | Purpose |
| --- | --- | --- |
| `WEAPON_MANAGER` | `WeaponManager` | Singleton over the active profile in the current plugin context. |
| `WeaponManager` | Class | Constructs another stateless profile view that shares the module cache. |
| `GetAllWeapons()` | Function | Returns a fresh array of current weapon entity views passed through `DecorateWeapon()`. |
| `GetWeaponsByClassName(strWeaponClassName)` | Function | Returns current weapons whose exact entity class is `strWeaponClassName`. |
| `GetWeaponsByName(strWeaponName)` | Function | Converts a short name to a runtime weapon class and returns current matches. |
| `GetClasses()` | Native function | Returns distinct full class names represented by current weapon edicts. |
| `GetCount()` | Native function | Returns the number of weapon edicts found by a fresh scan. |
| `GetCurrentWeapon(PlayerReference)` | Function | Returns the current weapon, or `null` for an invalid handle. |
| `GetNames()` | Native function | Returns distinct short names represented by current weapon edicts. |

`GetClasses`, `GetCount`, and `GetNames` preserve the exact native function identities. The JavaScript `GetAllWeapons`,
`GetWeaponsByClassName`, `GetWeaponsByName`, and `GetCurrentWeapon` wrappers pass native weapon entities through
`DecorateWeapon()` before returning them. Decoration is conditional on truthy `IsWeapon` and `Valid` and falsy `Free`;
a returned borrowed object can remain undecorated if that gate fails. Importing the module obtains its native module
object and constructs `WEAPON_MANAGER`, but performs no edict scan or profile load.

## Live Entity Functions

Each call reads current server state and takes no profile branch argument:

- `GetAllWeapons()` scans every edict index and returns non-free entities whose exact class name starts with `weapon_`.
- `GetWeaponsByClassName(strWeaponClassName)` requires a non-empty string and compares the full class name exactly.
- `GetWeaponsByName(strWeaponName)` requires a non-empty string, preserves an existing recognized weapon class or prepends the
  runtime `weapon_` prefix, then scans for that class.
- `GetClasses()` and `GetNames()` return unique strings in first-encountered edict order.
- `GetCount()` performs its own complete scan; it is not derived from an earlier `GetAllWeapons()` result.
- `GetCurrentWeapon(PlayerReference)` accepts a native indexed player value, reads `m_hActiveWeapon`, and returns `null` when
  the handle cannot resolve to a valid edict.

Each call reads server state independently. A weapon can be created, removed, or switched between `GetAllWeapons()`, `GetCount()`,
and `GetCurrentWeapon()` calls.

These native operations run synchronously on the game thread. An array or JavaScript reference does not keep an engine
entity alive; all entity and owner reads in the report workflows require those borrowed views to remain valid.

## WeaponManager Members

| Member | Result |
| --- | --- |
| `AmmoProperty` | Active profile's player reserve-ammo property prefix. |
| `MyWeaponsProperty` | Active profile's prefix for player weapon handle properties. |
| `Prefix` | Active profile's weapon entity prefix. |
| `Projectiles` | Exact current cached record mapping projectile classes to weapon names. |
| `SpecialNames` | Exact current cached record mapping alternate names to normalized names. |
| `Tags` | Exact current cached array of distinct profile tags. |
| `FormatName(strWeaponName)` | Normalize an alternate name, projectile class, or weapon name to a full class name. |
| `Get(strWeaponName)` | Stable `WeaponClass` wrapper for a profile name or `null`. |
| `Has(strWeaponName)` | Whether the active profile contains the name. |
| `Keys()` | Fresh array of profile class names. |
| `Values()` | Fresh array containing the cached `WeaponClass` for every profile record. |
| `Entries()` | Fresh `[strWeaponClassName, WeaponClass]` pairs. |
| `[Symbol.iterator]()` | Iterate the current `Values()` result. |

The class has no constructor arguments or instance fields. Every access delegates to `weapons/data` for the active
branch; callers cannot select another branch through `WeaponManager`.

Profile queries and accessors are synchronous: selecting the branch reads native SDK globals, and a cache miss can load
profile files on the calling game thread. Use these views inside their originating plugin context; they do not dispatch
profile loading to a worker.

## Profile Cache and Identity

A module-level `WeakMap` keeps one `WeaponClass` per normalized record object inside the current plugin's V8 context.
The singleton and every `new WeaponManager()` therefore return the same wrapper identity for the same cached record
through `Get()`, `Values()`, `Entries()`, and iteration.

Calling `weapons/data.ClearCache()` removes profile cache entries, not existing wrapper objects. A retained old wrapper
continues to reference its old record. The next manager access reparses the profile and obtains new records, so wrappers
for that new profile have new identities. Other isolated plugins have their own JavaScript manager, data cache, and
wrapper cache.

The wrapper's own `ValueRecord` field is writable; its `Record` accessor reads that field. Rebinding a shared wrapper
redirects every manager consumer that already holds that same wrapper, without changing the `WeakMap`'s original record
key. A later lookup of that original record still returns the redirected wrapper. Do not rebind a shared cached wrapper
for independent plugin metadata; create a plugin-owned record and `WeaponClass` as shown in
[`weapons/instance`](weapons-instance.md#create-a-plugin-owned-class).

## Collect a Live Weapon Report

Return a report owned by the caller from the current edict scans. The `ScannedCount` and `ReportedCount` can differ
when server state changes between calls.

```js
const { GetAllWeapons, GetClasses, GetCount, GetNames } = require("weapons/manager");

function CollectLiveWeaponReport() {
	const vecWeaponEntities = GetAllWeapons();
	const vecWeaponReports = [];
	for (const WeaponEntity of vecWeaponEntities) {
		if (!WeaponEntity || !WeaponEntity.IsWeapon || !WeaponEntity.Valid || WeaponEntity.Free || (typeof WeaponEntity.GetOwner !== "function") || (typeof WeaponEntity.GetWeaponName !== "function")) {
			throw new TypeError("CollectLiveWeaponReport() requires valid decorated weapon views.");
		}

		const WeaponOwner = WeaponEntity.GetOwner();
		vecWeaponReports.push({ WeaponClassName: WeaponEntity.ClassName, WeaponName: WeaponEntity.GetWeaponName(), OwnerIndex: (WeaponOwner === null) ? null : WeaponOwner.Index, WeaponIndex: WeaponEntity.Index });
	}

	return { ReportedCount: GetCount(), ScannedCount: vecWeaponEntities.length, WeaponClassNames: GetClasses(), WeaponNames: GetNames(), WeaponReports: vecWeaponReports };
}

module.exports = { CollectLiveWeaponReport };
```

The returned scalar values and summary objects belong to the caller. The function uses each borrowed decorated entity
only while it builds the report. A failed decoration gate or a blocked required method throws `TypeError` before invoking that view's
methods. These checks do not pin entities or prevent synchronous reentrancy.

## Find Requested Live Weapons

Make the requested class and short name explicit. Each non-null query performs its own native scan and returns current
entity indexes.

```js
const { GetWeaponsByClassName, GetWeaponsByName } = require("weapons/manager");

function CollectWeaponIndexes(vecWeaponEntities) {
	const vecWeaponIndexes = [];
	for (const WeaponEntity of vecWeaponEntities) {
		vecWeaponIndexes.push(WeaponEntity.Index);
	}

	return vecWeaponIndexes;
}

function FindLiveWeaponIndexes(strWeaponClassName, strWeaponName) {
	let vecClassWeaponIndexes = [];
	let vecNamedWeaponIndexes = [];

	if (strWeaponClassName !== null) {
		vecClassWeaponIndexes = CollectWeaponIndexes(GetWeaponsByClassName(strWeaponClassName));
	}

	if (strWeaponName !== null) {
		vecNamedWeaponIndexes = CollectWeaponIndexes(GetWeaponsByName(strWeaponName));
	}

	return { ClassWeaponIndexes: vecClassWeaponIndexes, NamedWeaponIndexes: vecNamedWeaponIndexes };
}

module.exports = { FindLiveWeaponIndexes };
```

Pass `null` to skip one query. Any other value is forwarded to the corresponding native operation, including its
validation for nonempty strings.

## Inspect a Player's Current Weapon

Accept an already validated player object from the caller. This avoids assuming a fixed client slot and keeps
the policy for selecting players outside the helper.

```js
const { GetCurrentWeapon } = require("weapons/manager");

function InspectCurrentWeapon(PlayerReference) {
	const CurrentWeapon = GetCurrentWeapon(PlayerReference);
	if (CurrentWeapon === null) {
		return null;
	}

	if (!CurrentWeapon.IsWeapon || !CurrentWeapon.Valid || CurrentWeapon.Free || (typeof CurrentWeapon.GetWeaponName !== "function")) {
		throw new TypeError("InspectCurrentWeapon(PlayerReference) requires a valid decorated weapon view.");
	}

	return { WeaponClassName: CurrentWeapon.ClassName, WeaponName: CurrentWeapon.GetWeaponName(), WeaponIndex: CurrentWeapon.Index };
}

module.exports = { InspectCurrentWeapon };
```

The returned object does not keep the decorated weapon alive as an engine entity. Call `GetCurrentWeapon(PlayerReference)` again
when current state matters. A resolved edict need not satisfy the decoration gate; this helper throws `TypeError` when
the view is invalid, is not a weapon, is free, or lacks a callable `GetWeaponName()`. Native `null` results are preserved;
rejected views are not converted to `null`. The checks do not pin the entity through later reads.

## Inspect Active Profile Rules

Profile properties are selected by the current SDK and remain shared with `weapons/data`.

```js
const { WEAPON_MANAGER } = require("weapons/manager");

function InspectProfileRules(strWeaponName) {
	return { Projectiles: WEAPON_MANAGER.Projectiles, SpecialNames: WEAPON_MANAGER.SpecialNames, AmmoProperty: WEAPON_MANAGER.AmmoProperty, FormattedWeaponClassName: WEAPON_MANAGER.FormatName(strWeaponName), MyWeaponsProperty: WEAPON_MANAGER.MyWeaponsProperty, WeaponPrefix: WEAPON_MANAGER.Prefix, Tags: WEAPON_MANAGER.Tags };
}

module.exports = { InspectProfileRules };
```

The three container values preserve their cached identities. Mutating them changes the active cache in the current
plugin context. Build an explicit copy only when the caller needs an independent report.

## Resolve Profile Metadata

`Get(strWeaponName)` accepts normalized names, full classes, and profile alternate names. It returns the same wrapper while
the underlying record object remains cached.

```js
const { WEAPON_MANAGER, WeaponManager } = require("weapons/manager");

function ResolveProfileMetadata(strWeaponName) {
	const SecondaryWeaponManager = new WeaponManager();
	const WeaponClassView = WEAPON_MANAGER.Get(strWeaponName);
	if (WeaponClassView === null) {
		return null;
	}

	const vecWeaponTags = [];
	for (const strWeaponTag of WeaponClassView.Tags) {
		vecWeaponTags.push(strWeaponTag);
	}

	return { KnownBySecondaryManager: SecondaryWeaponManager.Has(strWeaponName), SameWrapper: WeaponClassView === SecondaryWeaponManager.Get(strWeaponName), WeaponClassName: WeaponClassView.ClassName, WeaponName: WeaponClassView.Name, WeaponTags: vecWeaponTags };
}

module.exports = { ResolveProfileMetadata };
```

## Build a Profile Catalog

`Keys()`, `Values()`, `Entries()`, and iteration read the active profile independently. With unchanged profile records
and wrapper backing fields they have matching order and share each record's `WeaponClass` identity. Rebinding a cached
wrapper's `ValueRecord` can change an entry's class name without changing the corresponding `Keys()` value or cache key.

```js
const { WEAPON_MANAGER } = require("weapons/manager");

function CopyWeaponTags(WeaponClassView) {
	const vecWeaponTags = [];
	for (const strWeaponTag of WeaponClassView.Tags) {
		vecWeaponTags.push(strWeaponTag);
	}

	return vecWeaponTags;
}

function BuildProfileCatalog() {
	const vecWeaponClassNames = WEAPON_MANAGER.Keys();
	const vecWeaponClasses = WEAPON_MANAGER.Values();
	const vecWeaponEntries = WEAPON_MANAGER.Entries();
	const vecIteratedWeaponClasses = [];
	const vecWeaponCatalog = [];
	for (const WeaponClassView of WEAPON_MANAGER) {
		vecIteratedWeaponClasses.push(WeaponClassView);
	}

	if (vecWeaponClassNames.length !== vecWeaponClasses.length) {
		throw new Error("BuildProfileCatalog() observed inconsistent profile collection sizes.");
	}

	if (vecWeaponClasses.length !== vecWeaponEntries.length) {
		throw new Error("BuildProfileCatalog() observed inconsistent profile collection sizes.");
	}

	if (vecWeaponEntries.length !== vecIteratedWeaponClasses.length) {
		throw new Error("BuildProfileCatalog() observed inconsistent profile collection sizes.");
	}

	for (let unProfileIndex = 0; unProfileIndex < vecWeaponEntries.length; ++unProfileIndex) {
		const vecWeaponEntry = vecWeaponEntries[unProfileIndex];
		const strWeaponClassName = vecWeaponEntry[0];
		const WeaponClassView = vecWeaponEntry[1];

		if (strWeaponClassName !== vecWeaponClassNames[unProfileIndex]) {
			throw new Error("BuildProfileCatalog() observed a profile ordering change.");
		}

		if (WeaponClassView !== vecWeaponClasses[unProfileIndex]) {
			throw new Error("BuildProfileCatalog() observed a profile identity change.");
		}

		if (WeaponClassView !== vecIteratedWeaponClasses[unProfileIndex]) {
			throw new Error("BuildProfileCatalog() observed an iterator identity change.");
		}

		vecWeaponCatalog.push({ WeaponClassName: strWeaponClassName, WeaponName: WeaponClassView.Name, Slot: WeaponClassView.Slot, Tags: CopyWeaponTags(WeaponClassView) });
	}

	return vecWeaponCatalog;
}

module.exports = { BuildProfileCatalog };
```

Ordinary queued JavaScript callbacks do not interleave with this synchronous function. Overridden methods, getters,
and proxies can still run caller-provided code synchronously and reenter or mutate the shared state. The guards check
collection sizes, ordering, and wrapper identities; they do not lock, retry, or guarantee a coherent metadata snapshot.
Scalar fields and tags can change without changing a wrapper's identity.

## Ownership and Lifetime

- `GetAllWeapons()`, `GetWeaponsByClassName()`, and `GetWeaponsByName()` return fresh arrays. Their entity objects are borrowed
  views of current edicts, pass through conditional decoration, and can become invalid after removal or index reuse.
- `GetCurrentWeapon(PlayerReference)` returns the same kind of borrowed entity view, or `null`; it does not transfer
  ownership of the active weapon.
- `GetClasses()` and `GetNames()` return fresh string arrays, while `GetCount()` returns a scalar from its own scan.
- `WEAPON_MANAGER` is a singleton only inside the current plugin's isolated V8 context.
- `Projectiles`, `SpecialNames`, and `Tags` return exact containers from the current profile cache. Mutating them
  changes later reads in the same context until the cache is cleared.
- `Keys()` returns a fresh array of class names. `Values()` and `Entries()` return fresh outer arrays; `Entries()` also
  creates fresh pair arrays. Iteration creates an iterator over a fresh `Values()` array. All retain shared `WeaponClass`
  objects rather than copying their records.
- A `WeaponClass` owns no entity and remains ordinary JavaScript metadata after every matching spawned entity has been
  removed.

`WeaponManager.Keys()` describes the packaged active profile. The module-level `GetClasses()` function describes only
weapon entities currently present in the world; the two sets are allowed to differ.

## Errors

- Import throws when the native `weapons/manager` module or another required package runtime is unavailable.
- Live scans throw when global entity state is not available.
- `GetWeaponsByClassName(strWeaponClassName)` and `GetWeaponsByName(strWeaponName)` require non-empty strings; native validation errors propagate
  directly.
- `GetCurrentWeapon(PlayerReference)` requires an argument. Player-resolution errors and missing `m_hActiveWeapon` support
  throw. Failure to read the handle storage, an unresolved handle, or an invalid resolved edict returns `null`; native C++
  exceptions are translated to a JavaScript error.
- `FormatName(strWeaponName)`, `Get(strWeaponName)`, and `Has(strWeaponName)` require a valid weapon name string through
  `weapons/data`.
- Profile parse, filesystem, selected branch, and native CVar errors from `weapons/data` or a returned `WeaponClass`
  propagate unchanged.
- Manager methods always use the active branch. Extra JavaScript arguments are ignored, not interpreted as branch
  selectors; an unavailable active profile does not fall back to another SDK profile.

The module exports no alternate singleton or class-factory aliases, bulk profile-property object, module/runtime metadata
or default export. Import the documented names directly.

## Related Modules

- [`weapons/instance`](weapons-instance.md) documents each cached `WeaponClass` metadata wrapper.
- [`weapons/data`](weapons-data.md) parses profiles, exposes branch-aware access and controls the cache.
- [`weapons/entity`](weapons-entity.md) documents decorated live weapon methods and accessors.
- [`players/entity`](players-entity.md) provides player objects accepted by `GetCurrentWeapon(PlayerReference)`.
