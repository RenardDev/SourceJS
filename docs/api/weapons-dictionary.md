# `require("weapons/dictionary")`

> Warning: this module combines independent realtime native scans with listener-owning JavaScript caches. Each native
> call returns current data, but returned containers do not refresh their membership. Every constructed
> `WeaponDictionary` must release its deletion listener with `Unload()`.
>
> AI navigation: read Current Result Semantics and Ownership and Lifecycle before running examples; distinguish
> direct native inventory queries from the class's local Map cache.

`weapons/dictionary` exposes current weapon-edict inventory functions and the plugin-owned lazy `WeaponDictionary`
class. Direct functions query the engine on every call. A class instance starts empty and caches only indexes requested
through that instance.

The package file is `packages/sourcejs/weapons/dictionary.js`. It returns the native
`sourcejs["weapons/dictionary"]` object by identity and installs `WeaponDictionary` as one non-writable enumerable
property. There is no process-global weapon cache.

## Contents

- [Import](#import)
- [Direct Export Reference](#direct-export-reference)
- [Inspecting Current Weapons](#inspecting-current-weapons)
- [Current Result Semantics](#current-result-semantics)
- [WeaponDictionary Reference](#weapondictionary-reference)
- [Using the Lazy Cache](#using-the-lazy-cache)
- [Supplying a Custom Factory](#supplying-a-custom-factory)
- [Managing a Manual Cache](#managing-a-manual-cache)
- [Handling Automatic Eviction](#handling-automatic-eviction)
- [Factory and Eviction Errors](#factory-and-eviction-errors)
- [Ownership and Lifecycle](#ownership-and-lifecycle)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

```js
const {
	WeaponDictionary,
	Get,
	GetAll,
	GetEntries,
	GetKeys,
	GetValues,
	GetWeapon,
	Has,
} = require("weapons/dictionary");
```

The native object supplies `GetAll`, `GetEntries`, `Get`, `Has`, `GetKeys`, `GetValues` and `GetWeapon`. JavaScript adds only
`WeaponDictionary`; it does not replace or wrap the native functions.

## Direct Export Reference

| Export | Return | Engine work |
| --- | --- | --- |
| `GetAll()` | Fresh ordinary object with numeric-string keys and `Count`. | Scans all current weapon edicts once. |
| `Get(WeaponReference)` | Fresh native weapon object or `null`. | Resolves one current edict by index. |
| `Has(WeaponReference)` | `boolean` | Checks whether one current edict has a weapon class. |
| `GetKeys()` | Fresh array of numeric weapon indexes. | Scans all current weapon edicts once. |
| `GetValues()` | Fresh native weapon-object array. | Scans and wraps all current weapon edicts once. |
| `GetEntries()` | Fresh array of `[unWeaponIndex, Weapon]` pairs. | Scans and wraps all current weapon edicts once. |
| `GetWeapon(WeaponReference)` | Fresh native weapon object or `null`. | Runs the native weapon factory for one index. |

`Get(WeaponReference)` and `GetWeapon(WeaponReference)` require a non-negative int32 entity index or an indexed object
(including a function object) whose `Index` is such a value. A malformed or missing argument throws; a valid index that
is not a current weapon returns `null`. `Has(WeaponReference)` performs a permissive lookup and returns `false` when
its value cannot resolve to a current weapon.

An exception thrown by an object's `Index` getter still propagates. `Has(WeaponReference)` is not an exception barrier.

Direct weapon values are live native objects but are not passed through the high-level `Weapon` decorator. Use
[`weapons/entity`](weapons-entity.md) when clip, ammo, owner and drop helpers are required.

## Inspecting Current Weapons

This workflow captures every native view independently and resolves one caller-selected index:

```js
const {
	Get,
	GetAll,
	GetEntries,
	GetKeys,
	GetValues,
	GetWeapon,
	Has,
} = require("weapons/dictionary");

function InspectCurrentWeaponDictionary(unWeaponIndex) {
	const CurrentWeaponsByIndex = GetAll();
	const vecCurrentWeaponEntries = GetEntries();
	const vecCurrentWeaponIndexes = GetKeys();
	const vecCurrentWeaponValues = GetValues();

	return {
		SelectedWeapon: { Present: Has(unWeaponIndex), FromFactory: GetWeapon(unWeaponIndex), FromGet: Get(unWeaponIndex) },
		CurrentWeaponsByIndex,
		WeaponCount: CurrentWeaponsByIndex.Count,
		CurrentWeaponEntries: vecCurrentWeaponEntries,
		CurrentWeaponIndexes: vecCurrentWeaponIndexes,
		CurrentWeaponValues: vecCurrentWeaponValues,
	};
}
```

Call this function on the game thread only while engine globals and the edict list are available. Returned arrays and
`CurrentWeaponsByIndex` are owning JavaScript containers. Their weapon values still refer to live engine entities.

## Current Result Semantics

Every direct function is a separate native operation. If an entity is created or removed between `GetAll()`, `GetKeys()`,
`GetValues()` and `GetEntries()`, their memberships can differ. Several calls do not form one atomic engine read.

`GetAll()` rechecks each discovered index before wrapping it and installs weapon records as own numeric-string
properties. `Count` is the number of installed numeric-index properties, excluding the `Count` metadata property itself.
Native weapon methods are installed as own data properties without invoking inherited setters. An index invalidated
before its turn is skipped and is not counted. This does not pin entities or make the scan atomic. Those keys and the count
describe that returned container; invoke `GetAll()` again to observe later membership changes. Mutating a returned
container does not alter the engine dictionary.

Native weapon objects can become invalid after entity removal or index reuse. Revalidate them through their live
fields or resolve the current index again before mutation.

## WeaponDictionary Reference

`WeaponDictionary` extends [`EntityDictionary`](entities-dictionary.md), which extends `Map`.

Constructor: `new WeaponDictionary(Factory = Weapon, ...vecFactoryArguments)`.

Construction validates the factory, creates an empty map, binds `OnNetworkedEntityDeleted(EntityReference)` and immediately
registers that callback with `NetworkedEntityDeletedManager`.

### Public Fields

| Field | Value |
| --- | --- |
| `EntityFactory` | Default decorated `Weapon` factory, caller factory or explicit `null`. |
| `EntityFactoryArguments` | Owning array appended after the requested index on every cache miss. |
| `NetworkedEntityDeletedCallback` | Bound callback registered with the deletion listener manager. |
| `NetworkedEntityDeletedListenerRegistered` | `true` while this instance owns that listener. |
| `size` | Inherited `Map` size for locally cached keys only. |

Treat lifecycle fields as observable state, not as settings. Assigning them manually can orphan listener ownership.

### Methods

| Method | Exact behavior |
| --- | --- |
| `get(EntityReference)` | Normalizes the index, returns a cached value or calls `CreateMissingEntity()`. |
| `has(EntityReference)` | Normalizes the index and checks only this local map. |
| `keys()` | Returns the standard live Map key iterator. |
| `values()` | Returns the standard live Map value iterator. |
| `entries()` | Returns the standard live Map entry iterator. |
| `delete(EntityReference)` | Normalizes the index and deletes the local entry. |
| `CreateMissingEntity(unEntityIndex)` | Calls `EntityFactory(unEntityIndex, ...EntityFactoryArguments)` and conditionally caches its result. |
| `FromIntegerHandle(unEntityHandle)` | Resolves through `entities/helpers.GetEntityIndexFromIntegerHandle(unEntityHandle)`, then calls `get(EntityReference)`. |
| `OnNetworkedEntityDeleted(EntityReference)` | Calls the removal hook and evicts a cached entity index. |
| `OnAutomaticallyRemoved(unEntityIndex)` | Empty subclass hook called before automatic eviction. |
| `Unload()` | Unregisters the deletion listener once; returns `true`, then `false`. |
| `set(Key, Value)` | Inherited `Map.set()`; performs no index normalization. |
| `clear()` | Inherited `Map.clear()`; removes local entries but not the listener. |
| `forEach(Callback, ThisArgument?)` | Inherited `Map.forEach()` over local entries. |
| `[Symbol.iterator]()` | Returns the standard live Map entry iterator. |

Class normalization accepts a non-negative safe-integer `number`, or a non-null value with `typeof` equal to
`"object"` whose `Index` is such a number. This local cache-key range is wider than the native int32 index range;
a manually cached key need not identify a live engine weapon. `CreateMissingEntity(unEntityIndex)` bypasses index
normalization, so normally use `get(EntityReference)` instead.

The inherited `keys()`, `values()` and `entries()` return the standard live Map iterators. Use `Array.from()` when an owning array is
required.

## Using the Lazy Cache

The default factory returns a decorated high-level weapon. Repeated `get(EntityReference)` calls return one local identity until
explicit or automatic eviction.

```js
const { WeaponDictionary } = require("weapons/dictionary");

function InspectLazyWeaponCache(unWeaponIndex) {
	const mapWeapons = new WeaponDictionary();
	const CacheReport = { EntryIndexes: [], IteratedIndexes: [], ValueIndexes: [] };

	try {
		const FirstWeapon = mapWeapons.get(unWeaponIndex);
		const SecondWeapon = mapWeapons.get(unWeaponIndex);

		CacheReport.CallbackBound = typeof mapWeapons.NetworkedEntityDeletedCallback === "function";
		CacheReport.ListenerRegistered = mapWeapons.NetworkedEntityDeletedListenerRegistered;
		CacheReport.SameIdentity = FirstWeapon === SecondWeapon;
		CacheReport.HasWeaponIndex = mapWeapons.has(unWeaponIndex);
		CacheReport.FactoryType = typeof mapWeapons.EntityFactory;
		CacheReport.FactoryArgumentCount = mapWeapons.EntityFactoryArguments.length;
		CacheReport.Size = mapWeapons.size;
		CacheReport.KeyIndexes = Array.from(mapWeapons.keys());

		for (const [unEntryWeaponIndex, Weapon] of mapWeapons.entries()) {
			CacheReport.EntryIndexes.push([unEntryWeaponIndex, Weapon.Index]);
		}

		for (const [unIteratedWeaponIndex, Weapon] of mapWeapons) {
			CacheReport.IteratedIndexes.push([unIteratedWeaponIndex, Weapon.Index]);
		}

		for (const Weapon of mapWeapons.values()) {
			CacheReport.ValueIndexes.push(Weapon.Index);
		}
	} finally {
		CacheReport.ListenerRemoved = mapWeapons.Unload();
	}

	return CacheReport;
}
```

The returned report owns only primitive metadata and index arrays. It does not retain the dictionary or a live weapon beyond listener
teardown.

## Supplying a Custom Factory

Factory arguments are retained by the instance and appended to every requested index. This controller wraps a
decorated weapon with plugin-local metadata and keeps listener ownership inside one function:

```js
const { WeaponDictionary } = require("weapons/dictionary");
const { Weapon } = require("weapons/entity");

function CreateTrackedWeapon(unWeaponIndex, strLabel) {
	const CurrentWeapon = Weapon(unWeaponIndex);
	if (CurrentWeapon === null) {
		throw new Error(`CreateTrackedWeapon() cannot resolve a live weapon. WeaponIndex=${unWeaponIndex}.`);
	}

	return {
		IsEntityMarkedForDeletion() {
			return (typeof CurrentWeapon.IsEntityMarkedForDeletion === "function") && CurrentWeapon.IsEntityMarkedForDeletion();
		},
		Weapon: CurrentWeapon,
		Label: strLabel,
		Index: unWeaponIndex,
	};
}

function WithTrackedWeapon(unWeaponIndex, strLabel, TrackedWeaponCallback) {
	if (typeof TrackedWeaponCallback !== "function") {
		throw new TypeError("WithTrackedWeapon(unWeaponIndex, strLabel, TrackedWeaponCallback) expects a callback function.");
	}

	const mapWeapons = new WeaponDictionary(CreateTrackedWeapon, strLabel);

	try {
		const TrackedWeapon = mapWeapons.CreateMissingEntity(unWeaponIndex);
		const bWeaponCached = mapWeapons.has(unWeaponIndex);

		return TrackedWeaponCallback({ Cached: bWeaponCached, SameIdentity: bWeaponCached && (mapWeapons.get(unWeaponIndex) === TrackedWeapon), TrackedWeapon, FactoryArguments: mapWeapons.EntityFactoryArguments.slice() });
	} finally {
		mapWeapons.Unload();
	}
}
```

`CreateMissingEntity(unEntityIndex)` accepts any non-null/undefined factory result. If a result with `typeof` equal to
`"object"` has an `IsEntityMarkedForDeletion()` method, that method must return a boolean. `true` returns the result without caching it;
`false` allows caching. A non-boolean marker throws `TypeError` before inserting an entry.

## Managing a Manual Cache

An explicit `null` factory disables lazy creation. Existing manually inserted entries remain readable, while a missing
`get(EntityReference)` throws.

Because `set(Key, Value)` is inherited directly from Map, validate and normalize keys before insertion:

```js
const { WeaponDictionary } = require("weapons/dictionary");

function InspectManualWeaponCache(vecWeaponRecords, unWeaponIndexToRemove) {
	const mapWeapons = new WeaponDictionary(null);

	try {
		for (const WeaponRecord of vecWeaponRecords) {
			if (!Number.isSafeInteger(WeaponRecord.Index) || (WeaponRecord.Index < 0)) {
				throw new TypeError("InspectManualWeaponCache(vecWeaponRecords, unWeaponIndexToRemove) expects non-negative safe weapon indexes.");
			}

			mapWeapons.set(WeaponRecord.Index, WeaponRecord);
		}

		const vecVisitedWeaponEntries = [];
		mapWeapons.forEach(function CollectManualWeapon(WeaponRecord, unWeaponIndex) {
			vecVisitedWeaponEntries.push([unWeaponIndex, WeaponRecord.Name]);
		});

		const SelectedWeaponRecord = (vecWeaponRecords.length === 0) ? null : mapWeapons.get(vecWeaponRecords[0].Index);
		const bWeaponRemoved = mapWeapons.delete(unWeaponIndexToRemove);
		const vecRemainingWeaponEntries = Array.from(mapWeapons.entries());

		mapWeapons.clear();

		return { WeaponRemoved: bWeaponRemoved, SelectedWeaponRecord, SizeAfterClear: mapWeapons.size, RemainingWeaponEntries: vecRemainingWeaponEntries, VisitedWeaponEntries: vecVisitedWeaponEntries };
	} finally {
		mapWeapons.clear();
		mapWeapons.Unload();
	}
}
```

`clear()` and `delete(EntityReference)` affect only this JavaScript map. They do not remove engine weapon entities.

## Handling Automatic Eviction

Networked entity deletion evicts a cached index. Override `OnAutomaticallyRemoved(unEntityIndex)` for plugin-local cleanup, not
for cancelling removal:

```js
const { WeaponDictionary } = require("weapons/dictionary");

class AuditedWeaponDictionary extends WeaponDictionary {
	constructor() {
		super();
		this.RemovedWeaponIndexes = [];
	}

	OnAutomaticallyRemoved(unWeaponIndex) {
		this.RemovedWeaponIndexes.push(unWeaponIndex);
	}
}

function ResolveAndEvictWeaponHandle(unEntityHandle) {
	const mapWeapons = new AuditedWeaponDictionary();

	try {
		const CurrentWeapon = mapWeapons.FromIntegerHandle(unEntityHandle);
		const bWeaponRemoved = mapWeapons.OnNetworkedEntityDeleted(CurrentWeapon);

		return { StillCached: mapWeapons.has(CurrentWeapon.Index), WeaponRemoved: bWeaponRemoved, WeaponIndex: CurrentWeapon.Index, RemovedWeaponIndexes: mapWeapons.RemovedWeaponIndexes.slice() };
	} finally {
		mapWeapons.Unload();
	}
}
```

Production code normally lets `NetworkedEntityDeletedManager` call the bound callback. The explicit call above makes
the complete eviction transaction testable without waiting for an engine event.

## Factory and Eviction Errors

- A constructor factory must be a function or `null`; other values throw `TypeError` before listener ownership begins.
- A `null` factory makes uncached `get(EntityReference)` and `CreateMissingEntity(unEntityIndex)` throw `Error`.
- Factory exceptions are wrapped with the requested index and retained as `error.cause`.
- A factory returning `null` or `undefined` throws and does not add a map entry.
- A marked-for-deletion result is returned but not cached.
- A non-boolean `IsEntityMarkedForDeletion()` result throws `TypeError` and leaves the index uncached.
- `OnNetworkedEntityDeleted(EntityReference)` returns `false` without calling the hook when the index is not cached.
- If `OnAutomaticallyRemoved(unEntityIndex)` throws, the error propagates, but a `finally` block still deletes the cached entry.
- Index validation applies to `get(EntityReference)`, `has(EntityReference)`, `delete(EntityReference)` and deletion events. Inherited `set(Key, Value)` does not validate.

## Ownership and Lifecycle

- Each instance owns exactly one deletion-listener registration after successful construction.
- Always call `Unload()` in `finally`; `clear()` does not release the listener.
- `Unload()` does not clear cached entries. Clear them separately when they retain meaningful plugin objects.
- Calling `Unload()` twice is safe and returns `false` the second time.
- If listener unregistration throws, `Unload()` propagates that error and leaves the registration flag set for retry.
  A cleanup error thrown from `finally` replaces an earlier error in these examples; retain and report both in callers
  that require combined diagnostics.
- A dictionary caches plugin-local wrappers, not engine ownership. Removing a map entry never removes an entity.
- Automatic eviction follows networked entity deletion. Explicitly validate retained objects before other engine
  mutations or index reuse.
- Direct native arrays/objects and class-local arrays/maps never synchronize with one another.

## Common Mistakes

- Do not compare memberships from several direct scans as though they were atomic.
- Do not expect direct `GetWeapon(WeaponReference)`/`Get(WeaponReference)` values to include high-level decorated methods.
- Do not confuse native `Has(WeaponReference)` with `mapWeapons.has(WeaponReference)`; one checks the engine, the other checks a local
  cache.
- Do not call `mapWeapons.set(EntityReference, Value)` and expect `mapWeapons.get(EntityReference.Index)` to find it.
- Do not return a dictionary from a helper that already called `Unload()` and imply it still receives deletion events.
- Do not use automatic eviction as an entity-removal command.
- Do not add compatibility exports that duplicate `WeaponDictionary`, expose internal runtime state, or attach a default or module-name alias.

## Related Modules

- [`entities/dictionary`](entities-dictionary.md) documents the complete base and synchronized dictionary contracts.
- [`entities/helpers`](entities-helpers.md) documents integer-handle conversion.
- [`listeners`](listeners.md) documents networked entity lifecycle managers.
- [`weapons/entity`](weapons-entity.md) documents the decorated `Weapon` factory and methods.
- [`weapons`](weapons.md) documents direct live weapon operations.
