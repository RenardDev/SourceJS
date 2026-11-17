# `require("entities/dictionary")`

> AI-processing note: this page is a hand-maintained reference for the complete entity dictionary API. Native registry calls return point-in-time containers whose Entity values remain live, while JavaScript dictionary instances own listener-backed caches inside one isolated plugin context.

`entities/dictionary` exposes the current engine entity registry and two `Map` subclasses for plugin-owned entity caches. The package lives in [`dictionary.js`](../../packages/sourcejs/entities/dictionary.js); its native registry is installed by [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) from the selected HL2SDK branch.

## Table of contents

- [Import](#import)
- [Ownership and lifecycle](#ownership-and-lifecycle)
- [Returned entity objects](#returned-entity-objects)
- [Native registry API](#native-registry-api)
- [EntityDictionary](#entitydictionary)
- [ENTITY_DICTIONARY](#entity_dictionary)
- [SyncedEntityDictionary](#syncedentitydictionary)
- [Practical workflows](#practical-workflows)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Import

The canonical API consists of these eleven exports:

```js
const {
	ENTITY_DICTIONARY,
	Entity,
	EntityDictionary,
	SyncedEntityDictionary,
	GetAllEntities,
	GetEntity,
	GetEntityDictionaryEntries,
	GetEntityDictionaryKeys,
	GetEntityDictionaryValues,
	GetEntityFromDictionary,
	HasEntityInDictionary,
} = require("entities/dictionary");
```

These eleven names are the complete public surface. The package does not export `all`, `get`, `has`, `keys`, `values`, `entries`, `entity`, `moduleName`, `byIndex`, `refresh`, `dispose`, a default export, or a discovery facade. `Entity()` is the JavaScript wrapper that accepts either an index or an Entity-like object; `GetEntityFromDictionary()` accepts either representation. `GetEntity()` is a separate native numeric-index operation, not an alias of the JavaScript wrapper.

## Ownership and lifecycle

The API has three distinct ownership models:

1. `GetAllEntities()`, `GetEntityDictionaryKeys()`, `GetEntityDictionaryValues()`, and `GetEntityDictionaryEntries()` scan the native edict registry on each call. Their object/array containers are point-in-time results. Entity values inside those containers remain live native views.
2. `EntityDictionary` caches only indexes requested through that instance. It subscribes to `NetworkedEntityDeleted` immediately and removes cached entries when the engine reports deletion.
3. `SyncedEntityDictionary` additionally scans an iterator at construction and subscribes to `NetworkedEntityCreated`, so its membership follows a selected entity set.

Every JavaScript dictionary and callback set belongs to the current isolated plugin context. Plugins do not share `ENTITY_DICTIONARY`, custom dictionary instances, factories, or callback state. They do observe the same engine entity registry through their own native objects. Perform registry lookups and listener-backed cache operations on the server thread.

Call `Unload()` on every custom dictionary during plugin unload. It removes listener registrations but deliberately leaves cached JavaScript values intact. Use `clear()` separately when those references must be released immediately.

The module-owned `ENTITY_DICTIONARY` is initialized once for the plugin context. Do not call `Unload()` on it during normal plugin operation; SourceJS releases the context and its listeners when the plugin unloads.

## Returned entity objects

`Entity()`, `GetEntity()`, `GetEntityFromDictionary()`, `GetEntityDictionaryValues()`, `GetEntityDictionaryEntries()`, and `GetAllEntities()` return the same native Entity shape used by [`entities`](entities.md) and [`entities/entity`](entities-entity.md).

### Live fields

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index represented by the object. |
| `Valid` | read-only boolean | Whether that edict currently exists and is not free. |
| `Free` | live boolean | Current free flag; writing it is dangerous and normally engine-owned. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | live integer | Writable `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | live integer | Writable edict serial number, normally engine-owned. |
| `Edict` | read-only object or `null` | Point-in-time address record for the current edict. |
| `BaseEntity` | read-only object or `null` | Point-in-time address record for the current `CBaseEntity`. |
| `Address` | read-only `BigInt` | Native `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Point-in-time SDK handle record, not a live handle reference. |
| `HandleValue` | read-only integer | Packed integer handle, or `-1` when unavailable. |

The `Edict`, `BaseEntity`, and `BaseHandle` getters create ordinary JavaScript records on each read. Those records do not refresh themselves, own the native allocation, or keep an entity alive. Changing a returned record does not write native state. Re-read the Entity property for current values, and do not reuse a saved address or handle after deletion or index reuse.

Only the PascalCase live-field names in the table are installed. Plain spellings such as `index`, `valid`, `className`, and `address` are not Entity properties.

Every Entity exposes `RemoveEntity()`. The selected SDK's `CBaseEntity::AcceptInput` capability adds `SlayEntity()` and `CallEntityInput(strInputName, InputValue?, flInputDelay?)`; sendprop and datamap methods are also installed only when their native systems exist. Missing capabilities are absent properties, not fallback methods. See [`entities`](entities.md), [`entities/props`](entities-props.md), and [`entities/datamaps`](entities-datamaps.md) for their complete contracts.

Only the canonical PascalCase methods are installed. Lower-camel-case spellings such as `remove`, `slay`, `callInput`, `getProperty*`, `setProperty*`, `getDataMap*`, and `setDataMap*` are not Entity methods.

The object resolves state by index whenever a live field or method is used. Do not retain it after a deletion callback and assume that it still represents the same engine allocation; Source can reuse an edict index.

## Native registry API

The seven native registry functions inspect current non-free edicts. The JavaScript `Entity()` wrapper delegates to `GetEntityFromDictionary()` after normalizing an index or Entity-like object. Before a level has entities, the returned containers can be empty. SourceJS does not fabricate world or player entries.

| API | Return | Behavior |
| --- | --- | --- |
| `GetAllEntities()` | object | Returns numeric-keyed Entity properties plus integer `Count`. |
| [`Entity(EntityReference)`](#entityentityreference) | Entity or `null` | Validates a non-negative safe-integer Number or an object with such an `Index`, then resolves the current entity. An index outside the native signed-32-bit range returns `null`; BigInt addresses are not accepted. |
| `GetEntity(nEntityIndex)` | Entity or `null` | Requires an integer Number in the signed-32-bit range; other inputs or an omitted argument throw. Returns `null` for a negative, absent, or free edict index. Does not accept an Entity-like object. |
| `GetEntityFromDictionary(EntityValue)` | Entity or `null` | Accepts an integer Number in the signed-32-bit range or an object with such an `Index`; returns the current Entity for a non-free edict. Negative indexes and invalid selectors return `null`; an omitted argument throws. |
| `HasEntityInDictionary(EntityValue)` | boolean | Uses the same selectors as `GetEntityFromDictionary()`; negative indexes, invalid selectors, and absent/free edicts return `false`. An omitted argument throws. |
| `GetEntityDictionaryKeys()` | integer array | Returns current entity indexes. |
| `GetEntityDictionaryValues()` | Entity array | Returns current live Entity objects. |
| `GetEntityDictionaryEntries()` | `[nEntityIndex, Entity][]` | Returns current signed-index/value pairs. |

The arrays and `GetAllEntities()` object do not update their membership after the call. Re-run the operation whenever current membership matters.

The native `GetAllEntities()` result uses own numeric-keyed data properties and an own `Count`. `GetEntityDictionaryKeys()`, `GetEntityDictionaryValues()`, and `GetEntityDictionaryEntries()` likewise create own array indexes, including both fields of each entry pair; inherited numeric setters cannot intercept these writes. If creation of an Entity wrapper fails, no partially built dictionary or values/entries array is returned.

`GetEntityFromDictionary()` and `HasEntityInDictionary()` propagate an exception from an input object's `Index` getter before attempting the edict lookup. An ordinary absent or free edict still returns `null` from `GetEntityFromDictionary()` and `false` from `HasEntityInDictionary()`.

Native `GetAllEntities()`, `GetEntity()`, `GetEntityFromDictionary()`, `HasEntityInDictionary()`, `GetEntityDictionaryKeys()`, `GetEntityDictionaryValues()` and `GetEntityDictionaryEntries()` translate C++ exceptions into JavaScript errors without replacing an existing selector exception or returning a partial container. The collection operations' index collector leaves its previous output unchanged when an SDK failure occurs after earlier accepted indexes. These guards do not keep entities alive or guarantee allocator/OOM recovery.

### Inspect the current registry

```js
const {
	Entity,
	GetAllEntities,
	GetEntity,
	GetEntityDictionaryEntries,
	GetEntityDictionaryKeys,
	GetEntityDictionaryValues,
	GetEntityFromDictionary,
	HasEntityInDictionary,
} = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_InspectCurrentRegistry = function InspectCurrentRegistry() {
	const EntityRegistry = GetAllEntities();
	const vecEntityIndexes = GetEntityDictionaryKeys();
	const vecEntityValues = GetEntityDictionaryValues();
	const vecEntityEntries = GetEntityDictionaryEntries();
	const unFirstEntityIndex = vecEntityIndexes.find(g_IsNonWorldEntityIndex);
	if (unFirstEntityIndex === undefined) {
		throw new Error("The current registry has no non-world entities.");
	}

	const WrappedEntity = Entity(unFirstEntityIndex);
	const NativeEntity = GetEntity(unFirstEntityIndex);
	const LookedUpEntity = GetEntityFromDictionary(unFirstEntityIndex);
	if (!WrappedEntity || !NativeEntity || !LookedUpEntity || !HasEntityInDictionary(unFirstEntityIndex)) {
		throw new Error(`Entity ${unFirstEntityIndex} disappeared during registry inspection.`);
	}

	LogInfo("InspectEntityRegistry Result=%j", { WrappedClassName: WrappedEntity.ClassName, NativeIndex: NativeEntity.Index, LookupClassName: LookedUpEntity.ClassName, EntityCount: EntityRegistry.Count, EntryCount: vecEntityEntries.length, ValueCount: vecEntityValues.length });
};

g_InspectCurrentRegistry();
```

### `Entity(EntityReference)`

`Entity(EntityReference)` accepts a non-negative safe-integer Number or an object whose `Index` is one. It then asks the native registry for the current entity; an index outside the signed-32-bit range or a free/absent edict returns `null`. The argument is an edict index, not a native address; BigInt addresses are rejected.

This wrapper is useful when the caller needs one Entity without changing any dictionary cache:

```js
const { Entity, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
if (g_unEntityIndex === undefined) {
	throw new Error("The current registry has no non-world entities.");
}

const g_EntityValue = Entity(g_unEntityIndex);
if (!g_EntityValue) {
	throw new Error(`Entity ${g_unEntityIndex} disappeared before resolution.`);
}

LogInfo("InspectEntity Result=%j", { Valid: g_EntityValue.Valid, Address: `0x${g_EntityValue.Address.toString(16).toUpperCase()}`, ClassName: g_EntityValue.ClassName, Index: g_EntityValue.Index });
```

## `EntityDictionary`

### Constructor

```text
new EntityDictionary(EntityFactory = Entity, ...vecFactoryArguments)
```

`EntityFactory` is either a function or `null`. A function receives `(unEntityIndex, ...vecFactoryArguments)` and must return a value other than `null` or `undefined`. `null` disables automatic creation: existing Map entries can be read, but a missing `get()` throws instead of manufacturing a value. It does not disable inherited `set()` or `clear()`.

The constructor registers its deletion listener before returning. If plugin initialization later fails, call `Unload()` in the surrounding cleanup path.

### Public fields

| Field | Type | Meaning |
| --- | --- | --- |
| `EntityFactory` | function or `null` | Factory used for uncached indexes. |
| `EntityFactoryArguments` | array | Extra constructor arguments passed after every index. |
| `NetworkedEntityDeletedCallback` | function | Stable bound deletion callback registered with listeners. |
| `NetworkedEntityDeletedListenerRegistered` | boolean | Whether the deletion listener is currently owned. |
| `size` | integer | Inherited live `Map` entry count. |

The PascalCase fields are defined by `EntityDictionary`; `size` is inherited from `Map`.

### Methods

| Method | Return | Behavior |
| --- | --- | --- |
| `CreateMissingEntity(unEntityIndex)` | factory result | Always calls the factory, even for a cached index, and replaces that entry unless the new result is deletion-marked. Unlike `get()`, this direct method does not normalize or validate the index; pass a non-negative safe-integer Number. Factory failures retain the original thrown value as `cause`, including when diagnostic formatting fails. |
| `get(EntityReference)` | cached/factory value | Requires a non-negative safe index or object with `Index`, returns a cached value, or calls `CreateMissingEntity()`. |
| `has(EntityReference)` | boolean | Checks this cache, not the native registry. |
| `keys()` | Map iterator | Returns a live iterator over cached indexes. |
| `values()` | Map iterator | Returns a live iterator over cached values. |
| `entries()` | Map iterator | Returns a live iterator over cached `[unEntityIndex, ValueEntityCache]` pairs. |
| `delete(EntityReference)` | boolean | Deletes one cached value without touching the engine entity. |
| `FromIntegerHandle(unEntityHandle)` | cached/factory value | Converts a packed handle through `entities/helpers.GetEntityIndexFromIntegerHandle()` and delegates to `get()`. |
| `OnNetworkedEntityDeleted(EntityReference)` | boolean | Returns `false` for an uncached index. Otherwise calls `OnAutomaticallyRemoved(unEntityIndex)` and deletes the cached entry in `finally`, even if the hook throws. Returns `true` only when that hook completes. |
| `OnAutomaticallyRemoved(unEntityIndex)` | `undefined` | Empty subclass hook invoked before automatic deletion. |
| `Unload()` | boolean | Unregisters the deletion listener and clears its registration flag on success; later calls return `false`. If removal throws, the flag remains set so a later call can retry. Cached values remain intact. |
| `[Symbol.iterator]()` | Map iterator | Iterates cached `[unEntityIndex, ValueEntityCache]` pairs without creating an array. |

The PascalCase methods are SourceJS-specific operations. `get`, `has`, and `delete` retain conventional `Map` names but are overridden to normalize entity references and implement the documented cache behavior. `keys`, `values`, `entries`, and `[Symbol.iterator]` explicitly delegate to the corresponding `Map` methods. `set` and `clear` remain inherited without an override; none of the documented spellings is a style alias.

Inherited `set(unEntityIndex, ValueEntityCache)` and `clear()` operate only on the JavaScript cache. They do not validate entity existence and do not create, remove, or modify engine entities.

### Cache decorated records

Factory arguments are useful for attaching plugin metadata without modifying the native Entity object:

```js
const { Entity, EntityDictionary, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_CreateEntityCacheRecord = function CreateEntityCacheRecord(unEntityIndex, strOwner) {
	const EntityValue = Entity(unEntityIndex);
	if (!EntityValue) {
		throw new Error(`Entity ${unEntityIndex} disappeared before cache creation.`);
	}

	return { Entity: EntityValue, Owner: strOwner };
};

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_CacheDecoratedRecords = function CacheDecoratedRecords() {
	const unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
	if (unEntityIndex === undefined) {
		throw new Error("The current registry has no non-world entities.");
	}

	const mapEntityCache = new EntityDictionary(g_CreateEntityCacheRecord, "round-controller");

	try {
		const CreatedRecord = mapEntityCache.CreateMissingEntity(unEntityIndex);
		const CachedRecord = mapEntityCache.get(unEntityIndex);
		if (CreatedRecord.Entity.HandleValue < 0) {
			throw new Error(`Entity ${unEntityIndex} has no valid packed handle.`);
		}

		const RecordFromHandle = mapEntityCache.FromIntegerHandle(CreatedRecord.Entity.HandleValue);
		const vecIteratedRecords = [...mapEntityCache];
		LogInfo("CacheDecoratedEntities Result=%j", {
			EntityIndexes: Array.from(mapEntityCache.keys()),
			CachedIdentity: CachedRecord === CreatedRecord,
			FromHandleIdentity: RecordFromHandle === CreatedRecord,
			HasEntity: mapEntityCache.has(unEntityIndex),
			Owner: CreatedRecord.Owner,
			EntryCount: Array.from(mapEntityCache.entries()).length,
			IteratedRecordCount: vecIteratedRecords.length,
			ValueCount: Array.from(mapEntityCache.values()).length,
		});

		if (!mapEntityCache.delete(unEntityIndex)) {
			throw new Error(`Unable to delete cached entity ${unEntityIndex}.`);
		}
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the entity-cache listener.");
		}
	}
};

g_CacheDecoratedRecords();
```

### Read-only cache

Use a `null` factory when missing entries are programming errors:

```js
const { Entity, EntityDictionary, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_UseReadOnlyCache = function UseReadOnlyCache() {
	const unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
	if (unEntityIndex === undefined) {
		throw new Error("The current registry has no non-world entities.");
	}

	const EntityValue = Entity(unEntityIndex);
	if (!EntityValue) {
		throw new Error(`Entity ${unEntityIndex} disappeared before cache insertion.`);
	}

	const mapEntityCache = new EntityDictionary(null);

	try {
		mapEntityCache.set(unEntityIndex, EntityValue);
		LogInfo("ReadEntityCache Result=%j", { ClassName: mapEntityCache.get(unEntityIndex).ClassName });

		if (!mapEntityCache.delete(unEntityIndex)) {
			throw new Error(`Unable to delete cached entity ${unEntityIndex}.`);
		}

		let MissingError = null;

		try {
			mapEntityCache.get(unEntityIndex);
		} catch (ErrorValue) {
			MissingError = ErrorValue;
		}

		if (!MissingError) {
			throw new Error("The read-only cache unexpectedly created a missing entry.");
		}

		LogInfo("ReadMissingEntityCache Result=%j", { Error: MissingError.message });
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the read-only cache listener.");
		}
	}
};

g_UseReadOnlyCache();
```

### Deletion hook

Override `OnAutomaticallyRemoved(unEntityIndex)` to release metadata tied to an entity. The engine calls `OnNetworkedEntityDeleted(EntityReference)` through the registered listener; calling it directly is also useful in deterministic plugin tests.

```js
const { Entity, EntityDictionary, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_CreateTrackedEntityRecord = function CreateTrackedEntityRecord(unEntityIndex) {
	const EntityValue = Entity(unEntityIndex);
	if (!EntityValue) {
		throw new Error(`Entity ${unEntityIndex} disappeared before cache creation.`);
	}

	return { Samples: [], Entity: EntityValue };
};

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

class TrackingEntityDictionary extends EntityDictionary {
	constructor() {
		super(g_CreateTrackedEntityRecord);
		this.RemovedEntityIndexes = [];
	}

	OnAutomaticallyRemoved(unEntityIndex) {
		this.RemovedEntityIndexes.push(unEntityIndex);
	}
}

const g_VerifyDeletionHook = function VerifyDeletionHook() {
	const unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
	if (unEntityIndex === undefined) {
		throw new Error("The current registry has no non-world entities.");
	}

	const EntityValue = Entity(unEntityIndex);
	if (!EntityValue) {
		throw new Error(`Entity ${unEntityIndex} disappeared before deletion handling.`);
	}

	const mapEntityCache = new TrackingEntityDictionary();

	try {
		mapEntityCache.get(unEntityIndex).Samples.push(unEntityIndex);
		const bRemoved = mapEntityCache.OnNetworkedEntityDeleted(EntityValue);
		if (!bRemoved || mapEntityCache.has(unEntityIndex) || (mapEntityCache.RemovedEntityIndexes.length !== 1) || (mapEntityCache.RemovedEntityIndexes[0] !== unEntityIndex)) {
			throw new Error("The automatic deletion callback did not remove the cached entity.");
		}

		LogInfo("HandleEntityDeletion Result=%j", { RemovedEntityIndexes: mapEntityCache.RemovedEntityIndexes, Removed: bRemoved });
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the tracking-cache listener.");
		}
	}
};

g_VerifyDeletionHook();
```

### Deletion-marked factory result

When an object-valued factory result has a callable `IsEntityMarkedForDeletion`, that method must return a Boolean. Primitive and function-valued results are not inspected; a missing or non-callable member is ignored. A `true` result prevents caching the new value, while that provisional value is still returned to the caller. An existing cached value is not removed by this check:

```js
const { EntityDictionary, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

let g_bEntityMarkedForDeletion = true;

const g_IsEntityMarkedForDeletion = function IsEntityMarkedForDeletion() {
	return g_bEntityMarkedForDeletion;
};

const g_CreateDeletionMarkedEntityRecord = function CreateDeletionMarkedEntityRecord(unEntityIndex) {
	return { IsEntityMarkedForDeletion: g_IsEntityMarkedForDeletion, Index: unEntityIndex };
};

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_VerifyDeletionMarkedFactoryResult = function VerifyDeletionMarkedFactoryResult() {
	const unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
	if (unEntityIndex === undefined) {
		throw new Error("The current registry has no non-world entities.");
	}

	const mapEntityCache = new EntityDictionary(g_CreateDeletionMarkedEntityRecord);

	try {
		const ProvisionalRecord = mapEntityCache.CreateMissingEntity(unEntityIndex);
		const bCachedWhileMarked = mapEntityCache.has(unEntityIndex);

		g_bEntityMarkedForDeletion = false;

		const RetainedRecord = mapEntityCache.get(unEntityIndex);
		if (bCachedWhileMarked || !mapEntityCache.has(unEntityIndex) || (ProvisionalRecord.Index !== unEntityIndex) || (RetainedRecord.Index !== unEntityIndex)) {
			throw new Error("Deletion-marked cache retention did not follow the factory contract.");
		}

		LogInfo("CreateDeletionMarkedEntity Result=%j", { ProvisionalEntityIndex: ProvisionalRecord.Index, RetainedEntityIndex: RetainedRecord.Index });
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the marked-result cache listener.");
		}
	}
};

g_VerifyDeletionMarkedFactoryResult();
```

## `ENTITY_DICTIONARY`

`ENTITY_DICTIONARY` is one `EntityDictionary` using `Entity` as its factory. It starts empty, creates native Entity objects lazily, and removes cached values on networked deletion. It is not the same thing as `GetAllEntities()` and does not automatically contain every current edict.

```js
const { ENTITY_DICTIONARY, GetEntityDictionaryKeys } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_IsNonWorldEntityIndex = function IsNonWorldEntityIndex(unEntityIndex) {
	return unEntityIndex > 0;
};

const g_unEntityIndex = GetEntityDictionaryKeys().find(g_IsNonWorldEntityIndex);
if (g_unEntityIndex === undefined) {
	throw new Error("The current registry has no non-world entities.");
}

const g_FirstEntityRead = ENTITY_DICTIONARY.get(g_unEntityIndex);
const g_SecondEntityRead = ENTITY_DICTIONARY.get(g_unEntityIndex);
if (g_FirstEntityRead !== g_SecondEntityRead) {
	throw new Error("ENTITY_DICTIONARY did not preserve cached identity.");
}

LogInfo("ReadSharedEntityCache Result=%j", { ClassName: g_FirstEntityRead.ClassName, EntityIndex: g_FirstEntityRead.Index });

if (!ENTITY_DICTIONARY.delete(g_unEntityIndex)) {
	throw new Error(`Unable to delete cached entity ${g_unEntityIndex}.`);
}
```

## `SyncedEntityDictionary`

### Constructor

```text
new SyncedEntityDictionary(EntityFactory = Entity, EntityIterable = null, ...vecFactoryArguments)
```

The default entity iterable scans `GetEntityDictionaryValues()` and accepts every current entity. A custom `EntityIterable` must be iterable and may implement `IsEntityValid(EntityReference)` as a function to filter both initial synchronization and later creation callbacks; it need not implement an iterator's `next()` method. This predicate uses truthiness, unlike the strictly Boolean `IsEntityMarkedForDeletion()` factory-result method.

Construction performs these steps in order:

1. register the inherited deletion listener;
2. call `Resynchronize()`;
3. register the creation listener.

If synchronization or creation-listener registration throws, construction attempts to release the inherited deletion listener. Successful cleanup preserves the original thrown value; if cleanup also throws, `AggregateError([ConstructionError, CleanupError], ...)` retains both values in order, including falsy values.

Unlike `EntityDictionary`, a synchronized dictionary never creates an unknown index through `get()`. A cache miss throws `Entity index is not synced`.

`Resynchronize()` clears the existing cache before iterating. An iterator, predicate, factory, or hook error propagates and can leave a partially rebuilt cache; this operation is not transactional. The constructor attempts to release its inherited deletion listener if its initial synchronization fails; a cleanup failure leaves that registration owned rather than claiming it was released.

### Additional fields

| Field | Type | Meaning |
| --- | --- | --- |
| `EntityIterator` | iterable | Source used by `Resynchronize()` and optional creation filtering. |
| `NetworkedEntityCreatedCallback` | function | Stable bound creation callback. |
| `NetworkedEntityCreatedListenerRegistered` | boolean | Whether the creation listener is currently owned. |

The inherited `EntityFactory`, `EntityFactoryArguments`, deletion fields, `size`, and Map operations remain available.

Only the PascalCase additional fields in the table are defined by `SyncedEntityDictionary`; the shorter field spellings are not installed.

### Additional and overridden methods

| Method | Return | Behavior |
| --- | --- | --- |
| `CreateMissingEntity(unEntityIndex)` | never returns | Always throws for an unsynchronized index. Internal creation handling deliberately calls the base implementation. |
| `Resynchronize()` | this dictionary | Clears the cache and processes every iterator value through `OnNetworkedEntityCreated()`; rejected values and deletion-marked factory results are not retained. |
| `OnNetworkedEntityCreated(EntityReference)` | boolean | Applies `EntityIterator.IsEntityValid` when defined, runs the base factory/cache path, and invokes `OnAutomaticallyCreated(unEntityIndex)`. Each accepted callback runs the factory again, even for a cached index. A hook error propagates without rolling back an entry already cached by the factory path; otherwise returns whether the reference was accepted. |
| `OnAutomaticallyCreated(unEntityIndex)` | `undefined` | Empty subclass hook invoked after accepted factory processing; it can run when a deletion-marked result was not retained. |
| `Unload()` | boolean | Attempts creation- and deletion-listener removal independently, in that order. Successful steps clear their own registration flags; failed steps remain recorded for retry. One thrown value propagates unchanged; two produce `AggregateError([CreationError, DeletionError], ...)`. With no errors, returns whether either listener was removed; cached values remain intact. |

Only the PascalCase SourceJS methods in the table are defined by `SyncedEntityDictionary`; lower-camel-case variants are not installed.

### Mirror all current entities

```js
const { SyncedEntityDictionary } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_MirrorAllCurrentEntities = function MirrorAllCurrentEntities() {
	const mapEntityCache = new SyncedEntityDictionary();

	try {
		const vecEntityIndexesBeforeSynchronization = Array.from(mapEntityCache.keys());

		if (mapEntityCache.Resynchronize() !== mapEntityCache) {
			throw new Error("SyncedEntityDictionary.Resynchronize() did not return its dictionary.");
		}

		const vecSynchronizedEntities = Array.from(mapEntityCache.values());
		if (vecSynchronizedEntities.length === 0) {
			throw new Error("The synchronized dictionary has no current entities.");
		}

		LogInfo("ResynchronizeEntities Result=%j", { FirstClassName: vecSynchronizedEntities[0].ClassName, AfterCount: mapEntityCache.size, BeforeCount: vecEntityIndexesBeforeSynchronization.length });

		const unMissingEntityIndex = Number.MAX_SAFE_INTEGER;
		let MissingError = null;

		try {
			mapEntityCache.get(unMissingEntityIndex);
		} catch (ErrorValue) {
			MissingError = ErrorValue;
		}

		if (!MissingError) {
			throw new Error("The synchronized dictionary unexpectedly created an unsynchronized entity.");
		}

		LogInfo("ReadUnsynchronizedEntityCache Result=%j", { Error: MissingError.message });
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the synchronized dictionary listeners.");
		}
	}
};

g_MirrorAllCurrentEntities();
```

### Filter and decorate synchronized entities

The iterable can own a reusable predicate, while a subclass observes automatic additions and removals. The base constructor synchronizes before the derived constructor body, so keep any indexes already recorded by those hooks:

```js
const { Entity, GetEntityDictionaryValues, SyncedEntityDictionary } = require("entities/dictionary");
const { LogInfo } = require("loggers");

const g_CreatePropEntityRecord = function CreatePropEntityRecord(unEntityIndex, strOwner) {
	const EntityValue = Entity(unEntityIndex);
	if (!EntityValue) {
		throw new Error(`Entity ${unEntityIndex} disappeared before cache creation.`);
	}

	return { Entity: EntityValue, Owner: strOwner };
};

const g_PropEntityIterable = {
	*[Symbol.iterator]() {
		yield* GetEntityDictionaryValues();
	},
	IsEntityValid(EntityValue) {
		return EntityValue.ClassName.startsWith("prop_");
	},
};

class PropEntityDictionary extends SyncedEntityDictionary {
	constructor() {
		super(g_CreatePropEntityRecord, g_PropEntityIterable, "physics-monitor");
		// The base constructor can invoke these hooks during synchronization.
		this.CreatedEntityIndexes ??= [];
		this.RemovedEntityIndexes ??= [];
	}

	OnAutomaticallyCreated(unEntityIndex) {
		(this.CreatedEntityIndexes ??= []).push(unEntityIndex);
	}

	OnAutomaticallyRemoved(unEntityIndex) {
		(this.RemovedEntityIndexes ??= []).push(unEntityIndex);
	}
}

const g_IsNonPropEntity = function IsNonPropEntity(EntityValue) {
	return !EntityValue.ClassName.startsWith("prop_");
};

const g_IsPropEntity = function IsPropEntity(EntityValue) {
	return EntityValue.ClassName.startsWith("prop_");
};

const g_VerifySynchronizedPredicateLifecycle = function VerifySynchronizedPredicateLifecycle() {
	const mapEntityCache = new PropEntityDictionary();

	try {
		const vecCurrentEntities = GetEntityDictionaryValues();
		const PropEntity = vecCurrentEntities.find(g_IsPropEntity);
		const NonPropEntity = vecCurrentEntities.find(g_IsNonPropEntity);
		if (!PropEntity || !NonPropEntity) {
			throw new Error("The current registry needs both prop and non-prop entities for this example.");
		}

		const bAcceptedNonPropEntity = mapEntityCache.OnNetworkedEntityCreated(NonPropEntity);
		const bAcceptedPropEntity = mapEntityCache.OnNetworkedEntityCreated(PropEntity);
		const bRemovedPropEntity = mapEntityCache.OnNetworkedEntityDeleted(PropEntity);

		if (bAcceptedNonPropEntity || !bAcceptedPropEntity || !bRemovedPropEntity || !mapEntityCache.CreatedEntityIndexes.includes(PropEntity.Index) || !mapEntityCache.RemovedEntityIndexes.includes(PropEntity.Index)) {
			throw new Error("The synchronized predicate lifecycle did not match the selected entities.");
		}

		LogInfo("SynchronizePropEntities Result=%j", { AcceptedNonPropEntity: bAcceptedNonPropEntity, AcceptedPropEntity: bAcceptedPropEntity, RemovedPropEntity: bRemovedPropEntity });
	} finally {
		if (!mapEntityCache.Unload()) {
			throw new Error("Unable to unregister the prop dictionary listeners.");
		}
	}
};

g_VerifySynchronizedPredicateLifecycle();
```

## Practical workflows

Choose the smallest ownership model that matches the task:

| Need | API |
| --- | --- |
| One current entity with no cache | `Entity(EntityReference)` |
| Current engine membership point-in-time scan | `GetEntityDictionaryKeys()`, `GetEntityDictionaryValues()`, `GetEntityDictionaryEntries()`, or `GetAllEntities()` |
| Nullable current lookup by index or Entity-like object | `GetEntityFromDictionary(EntityValue)` |
| Strictly typed numeric-index lookup | `GetEntity(nEntityIndex)` |
| Lazy per-plugin Entity cache | `ENTITY_DICTIONARY` |
| Lazy cache of custom records | `EntityDictionary` |
| Strict pre-populated cache | `EntityDictionary(null)` plus inherited `set()` |
| Live membership synchronized from all entities | `SyncedEntityDictionary` |
| Live membership synchronized from a filtered iterable | `SyncedEntityDictionary(EntityFactory, EntityIterable, ...vecFactoryArguments)` |

For a one-off scan, prefer native `GetEntityDictionaryValues()` or [`filters/entities`](filters-entities.md). Do not create a synchronized dictionary merely to run one loop.

## Errors and common mistakes

- `Entity()` and JavaScript dictionary index methods require non-negative safe-integer Numbers. Native lookup indexes use signed-32-bit Numbers: `GetEntity()` rejects other argument types/ranges, while `GetEntityFromDictionary()` and `HasEntityInDictionary()` return `null`/`false` for invalid selectors. Strings such as `"1"` and raw BigInt addresses are not entity-index references.
- `EntityReference` objects must expose the canonical `Index` field; a plain `index` field is not read.
- Native `GetEntityFromDictionary(EntityValue)` returning `null` can mean an invalid selector or a negative, absent, or free edict index. It is not a fallback Entity. Omitted arguments throw; an `Index` getter's exception propagates.
- `EntityDictionary.has(EntityReference)` checks the cache, while top-level `HasEntityInDictionary(EntityValue)` checks the engine registry.
- `delete()` and `clear()` affect only JavaScript cache entries. Use Entity `RemoveEntity()` when engine removal is intended.
- A factory returning `null` or `undefined` throws. Factory exceptions are wrapped with the original value in the standard `cause` property, including falsy values. If formatting an Error's `message` or a different thrown value throws, the wrapper uses a fixed fallback message without replacing that original cause. Factory and hook side effects are not rolled back.
- A synchronized cache miss is an error by design; call `Resynchronize()` or wait for the creation callback instead of forcing `CreateMissingEntity()`.
- `keys()`, `values()`, and `entries()` on dictionary classes return live standard `Map` iterators; call `Array.from(...)` only when an operation requires a point-in-time array.
- `Unload()` is the only SourceJS lifecycle method on these dictionaries. The API has no `unload()` alias or `dispose()` method.
- Never keep entity-owned resources solely by numeric index without handling index reuse after deletion.

## Related modules

- [`entities`](entities.md) documents every native and decorated Entity field/method.
- [`entities/entity`](entities-entity.md) is the direct Entity factory package.
- [`entities/helpers`](entities-helpers.md) contains handle, edict, base-entity, and address conversions.
- [`listeners`](listeners.md) documents the creation/deletion managers that back automatic cache maintenance.
- [`filters/entities`](filters-entities.md) provides reusable filtered entity iteration without persistent cache ownership.
