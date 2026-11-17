# `require("filters/entities")`

> AI processing note: this page is hand-maintained from the entity and iterator packages and native world/trace bindings. Use the contents for navigation and keep examples, validation, and lifetime rules aligned with the current implementations.

Module index: [SourceJS API Reference](README.md)

`filters/entities` combines direct native world scans with reusable JavaScript iterators. By default, each resolution calls `entities.GetAllEntities()` and builds a new collection; replacing the public `IteratorItems` source can bypass that scan and its filtering pipeline. Native scans are synchronous: perform engine access on the server/game thread.

Selected-SDK rule: entity fields and methods that the selected SDK cannot implement are omitted from returned Entity objects. SourceJS does not add fallback stubs.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Direct scans](#direct-scans)
- [BaseEntityIterator](#baseentityiterator)
- [EntityIterator](#entityiterator)
- [Inherited iterator API](#inherited-iterator-api)
- [EntityTraceFilter](#entitytracefilter)
- [Workflows](#workflows)
- [Errors and ownership](#errors-and-ownership)

## Import

```js
const { BaseEntityIterator, EntityIterator, EntityTraceFilter, GetAllEntities, GetValidEntities } = require("filters/entities");
```

## Exports

| Export | Kind | Contract |
| --- | --- | --- |
| [`GetAllEntities()`](#getallentities) | Function | Returns every current non-free edict exposed by `entities.GetAllEntities()`. |
| [`GetValidEntities()`](#getvalidentities) | Function | Returns entries whose live `Valid` is true and `Free` is false. |
| [`BaseEntityIterator`](#baseentityiterator) | Class | Re-scannable class-name and registered-filter iterator over `GetAllEntities()`. |
| [`EntityIterator`](#entityiterator) | Class | Same iterator API, but invalid/free entities are removed before filtering. |
| [`EntityTraceFilter`](#entitytracefilter) | Class | Ignored-index and trace-type state for explicit adaptation to an engine-trace callback. |

The direct arrays and default iterator resolutions are point-in-time collections, not stable entity-identity snapshots. Their entity objects expose live native properties; an index can be reused, and retaining an object does not pin its native lifetime. Capture `Index` and `NetworkSerialNumber` as values, re-resolve before use within the current map, and check the generation and current validity. See [`entities/entity`](entities-entity.md) for the full Entity surface.

## Direct scans

### `GetAllEntities()`

Returns a new array from the current native entity scan. It can contain entries whose `Valid` field is false if the engine still exposes a non-free edict for them.

### `GetValidEntities()`

Returns a new array containing only entities for which `Valid` is true and `Free` is false.

Use both when diagnosing edict state, but report the counts separately: these are independent scans, so subtracting them does not count invalid entities from either collection.

```js
const { GetAllEntities, GetValidEntities } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_ReportEntityValidity = () => {
	const vecAllEntities = GetAllEntities();
	const vecValidEntities = GetValidEntities();
	LogInfo("EntityValidityScans AllEntityCountAtFirstScan=%d ValidEntityCountAtSecondScan=%d", vecAllEntities.length, vecValidEntities.length);
};

g_ReportEntityValidity();
```

## `BaseEntityIterator`

### Constructor

```text
new BaseEntityIterator(ClassNames = null, bExactMatch = true, RequiredFilters = null, ExcludedFilters = null)
```

| Argument | Contract |
| --- | --- |
| `ClassNames` | Nullish, one non-empty string, or an iterable of non-empty strings; an empty selection matches all class names. |
| `bExactMatch` | boolean. `true` compares complete class names; `false` uses case-sensitive substring matching. |
| `RequiredFilters` | Nullish, one registered filter name, or an iterable of names that must all return truthy results. |
| `ExcludedFilters` | Nullish, one registered filter name, or an iterable of names; any truthy result rejects the entity. |

### Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `ClassNames` | string[] | Copied normalized class-name selectors. |
| `ExactMatch` | boolean | Exact versus substring comparison mode. |
| `RequiredFilterNames` | string[] | Copied required filter names. |
| `ExcludedFilterNames` | string[] | Copied exclusion filter names. |
| `IteratorItems` | array / iterable / plain-prototype object / function / null / undefined | Default source function scans and applies `IsValid()`; replacing it replaces that pipeline. Source functions are called with the iterator as `this`. |
| `IteratorPredicate` | function / null | Base `IteratorFilter` predicate; registered filters are handled by `IsValid()`. |

Each class exposes its own static `Filters` Map. `BaseEntityIterator` and `EntityIterator` have separate registries, so registering on one class does not modify the other. The Map property itself cannot be replaced, but its contents are mutable; use the registry methods rather than inserting unchecked values directly.

Constructors normalize and copy class-name and filter-name inputs. The resulting arrays are mutable, and `ClassNames`/`ExactMatch` setters store values without validating them. `MatchesClassName()` checks the current array and boolean types, then visits selectors until the first match; a later malformed selector is not checked after an earlier match succeeds.

`BaseEntityIterator.IsValid()` visits required filters, then excluded filters, and only then class-name matching, with short-circuiting at each stage. A class-name mismatch cannot prevent an earlier named-filter lookup. `EntityIterator` additionally rejects invalid/free entities before inherited filtering. Registered callbacks are looked up again while resolving: removing a named filter causes a `ReferenceError` only when that lookup is visited. An empty source, an entity rejected by `EntityIterator`'s validity check, or an earlier required/excluded filter result can prevent the missing lookup. Replacing `IteratorItems` can bypass the whole default pipeline.

### Own methods

| Member | Contract |
| --- | --- |
| `static Iterator()` / `static GetAllEntities()` | Performs a fresh `entities.GetAllEntities()` scan. |
| `static DefaultFilters()` | Returns a null-prototype object mapping every registered filter name to a fresh Set; each filter performs its own scan. |
| `MatchesClassName(Entity)` | Applies the configured exact/substring class-name selectors. |
| `IsValid(Entity)` | Applies inherited required/excluded filters, then class-name matching. |

Exact and substring scans are explicit:

```js
const { BaseEntityIterator } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_ReportEntityIteratorMatches = () => {
	const ExactWeaponIterator = new BaseEntityIterator(["weapon_rifle", "weapon_pistol"]);
	const PhysicsPropIterator = new BaseEntityIterator("prop_physics", false);
	const vecEntitiesAtScan = BaseEntityIterator.Iterator();

	const GetEntityIndex = (Entity) => Entity.Index;
	const vecPhysicsPropIndexes = PhysicsPropIterator.Map(GetEntityIndex);
	const vecWeaponIndexes = ExactWeaponIterator.Map(GetEntityIndex);
	const bRifleClassNameMatches = ExactWeaponIterator.MatchesClassName({ ClassName: "weapon_rifle" });
	LogInfo(`BaseEntityIterator EntityCountAtScan=${vecEntitiesAtScan.length} RifleClassNameMatches=${bRifleClassNameMatches} PhysicsPropIndexes=${vecPhysicsPropIndexes.join(",")} WeaponIndexes=${vecWeaponIndexes.join(",")}`);
};

g_ReportEntityIteratorMatches();
```

## `EntityIterator`

`EntityIterator` extends `BaseEntityIterator` with the same constructor, fields, static filter registry, and methods. Its `static Iterator()` and `static GetAllEntities()` remove entities unless `(Entity.Valid === true) && (Entity.Free === false)` passes before class-name and registered filters run.

Use it for normal gameplay operations:

```js
const { EntityIterator } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_InspectDoors = () => {
	const DoorIterator = new EntityIterator("prop_door", false);
	const vecValidEntitiesAtScan = EntityIterator.Iterator();
	for (const Door of DoorIterator) {
		LogInfo("EntityDoor Index=%d ClassName=%s", Door.Index, Door.ClassName);
	}

	LogInfo("EntityIterator ValidEntityCountAtScan=%d", vecValidEntitiesAtScan.length);
};

g_InspectDoors();
```

## Inherited iterator API

Both entity iterator classes inherit the complete `IteratorObject` and `IteratorFilter` contract.

### Static filter registry

| Member | Result |
| --- | --- |
| `Filters` | Class-local `Map` of registered callbacks. |
| `RegisterFilter(strFilterName, Callback)` | Registers one unique callback and returns it. |
| `UnregisterFilter(strFilterName)` | Removes an existing callback and returns `true`. |
| `HasFilter(strFilterName)` | Tests the class-local Map. |
| `GetFilterNames()` | Returns a new array of registered names. |
| `DefaultFilters()` | Resolves every registered filter into a new Set with a separate scan per filter, not one shared snapshot. |

Built-in filters are `All` and `Valid`. Names are exact and case-sensitive. Callbacks run synchronously, their results are tested for truthiness, and thrown errors propagate; they are not implicitly bound to an entity or iterator. A temporary plugin filter must be removed during unload:

```js
const { EntityIterator } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_VerifyTemporaryEntityFilter = () => {
	const strEntityFilterName = "PhysicsProp";

	const IsPhysicsProp = (Entity) => Entity.ClassName.startsWith("prop_physics");
	const GetEntityIndex = (Entity) => Entity.Index;
	const vecFailures = [];
	const RegisteredEntityFilter = EntityIterator.RegisterFilter(strEntityFilterName, IsPhysicsProp);
	try {
		if ((RegisteredEntityFilter !== IsPhysicsProp) || !EntityIterator.HasFilter(strEntityFilterName)) {
			throw new Error("PhysicsProp filter registration failed.");
		}

		const PhysicsPropIterator = new EntityIterator(null, true, strEntityFilterName);
		LogInfo("EntityFilter PhysicsPropEntityIndexes=%s", JSON.stringify(PhysicsPropIterator.Map(GetEntityIndex)));
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (!EntityIterator.UnregisterFilter(strEntityFilterName) || EntityIterator.HasFilter(strEntityFilterName)) {
				throw new Error("PhysicsProp filter cleanup failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Entity filtering and temporary-filter cleanup failed.");
	}
};

g_VerifyTemporaryEntityFilter();
```

The example preserves a sole failure unchanged and reports simultaneous filtering/cleanup failures in an `AggregateError`, in that order. A cleanup failure does not establish that the filter was removed; arrange unload-time removal for any plugin filter that remains registered.

### Instance resolution

| Member | Result |
| --- | --- |
| `Iterate()` | Calls the concrete class's current static `Iterator()`. |
| `GetIteratorFilterCallback(strFilterName)` | Returns a registered callback or throws. |
| `IsValid(Entity)` | Applies required and excluded filters plus class matching. |
| `Resolve()`, `Values()`, `ToArray()` | Copies the current source into a new array and applies `IteratorPredicate` if present; the default source already applies entity and registered filters. |
| `Count()` | Resolves and returns the current length. |
| `First()` | Resolves and returns the first value or `null`. |
| `Filter(Predicate)` | Returns a lazy `IteratorFilter` over this iterator's current results. |
| `Map(Callback)` | Resolves now and returns the mapped array. |
| `ForEach(Callback)` | Resolves now, invokes the callback, and returns this iterator. |
| `[Symbol.iterator]()` | Resolves now and supports `for...of` or spread. |

These methods do not share one hidden snapshot; each call through the default source can observe a different world state. Replacing `IteratorItems` bypasses class-name and registered-filter checks; it is not merely an additional input to them. `IteratorPredicate` is a separate post-source predicate:

```js
const { EntityIterator } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_ReportInstanceResolution = () => {
	const PhysicsPropIterator = new EntityIterator("prop_", false);
	const vecSeenEntityIndexes = [];

	const RecordSeenEntityIndex = (Entity) => vecSeenEntityIndexes.push(Entity.Index);
	const GetEntityIndex = (Entity) => Entity.Index;
	const IsHeavyPhysicsProp = (Entity) => Entity.ClassName === "prop_physics";

	if (PhysicsPropIterator.ForEach(RecordSeenEntityIndex) !== PhysicsPropIterator) {
		throw new Error("ForEach() did not return the source iterator.");
	}

	const FirstEntity = PhysicsPropIterator.First();
	const unCurrentEntityCount = PhysicsPropIterator.Count();
	const vecCurrentEntityIndexes = PhysicsPropIterator.Map(GetEntityIndex);
	const vecHeavyPhysicsPropEntities = PhysicsPropIterator.Filter(IsHeavyPhysicsProp).ToArray();
	const vecRawSourceEntities = [...PhysicsPropIterator.Iterate()];
	const vecResolvedEntities = PhysicsPropIterator.Resolve();
	const vecIteratorValues = PhysicsPropIterator.Values();
	const ValidEntityFilterCallback = PhysicsPropIterator.GetIteratorFilterCallback("Valid");
	const nFirstEntityIndex = (FirstEntity === null) ? null : FirstEntity.Index;
	const bFirstEntityValid = (FirstEntity === null) ? false : (PhysicsPropIterator.IsValid(FirstEntity) && ValidEntityFilterCallback(FirstEntity));
	LogInfo("EntityIteratorResolution %s", JSON.stringify({
		FirstEntityIndex: nFirstEntityIndex,
		CurrentEntityIndexes: vecCurrentEntityIndexes,
		HeavyPhysicsPropEntityIndexes: vecHeavyPhysicsPropEntities.map(GetEntityIndex),
		IteratorValueEntityIndexes: vecIteratorValues.map(GetEntityIndex),
		RawSourceEntityIndexes: vecRawSourceEntities.map(GetEntityIndex),
		ResolvedEntityIndexes: vecResolvedEntities.map(GetEntityIndex),
		SeenEntityIndexes: vecSeenEntityIndexes,
		FirstEntityValid: bFirstEntityValid,
		CurrentEntityCount: unCurrentEntityCount,
	}));
};

g_ReportInstanceResolution();
```

The report logs entity indexes and scalar values rather than JSON-serializing native entity wrappers; the iterator results themselves remain entity arrays.

Inspect the built-in registry without mutating it:

```js
const { BaseEntityIterator, EntityIterator } = require("filters/entities");
const { LogInfo } = require("loggers");

const g_InspectBuiltInEntityFilters = () => {
	const BaseEntityFilterDefaults = BaseEntityIterator.DefaultFilters();
	const EntityFilterDefaults = EntityIterator.DefaultFilters();
	const vecBaseEntityFilterNames = BaseEntityIterator.GetFilterNames();
	const vecEntityFilterNames = EntityIterator.GetFilterNames();
	const bBaseIteratorHasValidFilter = BaseEntityIterator.HasFilter("Valid");
	const bEntityIteratorHasValidFilter = EntityIterator.HasFilter("Valid");
	const unBaseValidEntityCount = BaseEntityFilterDefaults.Valid.size;
	const unValidEntityCount = EntityFilterDefaults.Valid.size;
	LogInfo("EntityFilterRegistry %s", JSON.stringify({
		BaseEntityFilterNames: vecBaseEntityFilterNames,
		EntityFilterNames: vecEntityFilterNames,
		BaseIteratorHasValidFilter: bBaseIteratorHasValidFilter,
		EntityIteratorHasValidFilter: bEntityIteratorHasValidFilter,
		BaseValidEntityCount: unBaseValidEntityCount,
		ValidEntityCount: unValidEntityCount,
	}));
};

g_InspectBuiltInEntityFilters();
```

See [`filters/iterator`](filters-iterator.md) for the generic source and predicate behavior.

## `EntityTraceFilter`

### Constructor

```text
new EntityTraceFilter(EntitiesToIgnore, nTraceType)
```

`EntitiesToIgnore` may be nullish, one non-negative safe-integer entity index, one object with a non-negative safe-integer `Index`, or an iterable of those values. Use `nTraceType` from the selected SDK's `engines/trace.TraceType` namespace. The JavaScript helper validates signed 32-bit integer shape, not membership in that SDK enum.

### Fields and methods

| Member | Type / Result |
| --- | --- |
| `IgnoredEntityIndexes` | Set<number> initialized with copied indexes; later mutation is live, and the setter does not validate replacements. |
| `TraceType` | Editable value stored without setter validation; `GetTraceType()` checks signed 32-bit integer shape. |
| `ShouldHitEntity(Entity)` | Validates the current Set and a non-negative safe-integer index (or object with one); returns `false` for an ignored index and `true` otherwise. It does not validate every stored Set member. |
| `GetTraceType()` | Validates and returns the current `TraceType`. |

The `engines/trace.TraceRay` filter adapter uses `ShouldHitEntity` and `GetTraceType` (or a `TraceType` property). `ShouldHitEntity` receives a trace-entity record with `Index`, `Handle`, and `Exists`, followed by the contents mask. `Handle` is an encoded entity identifier, not a memory address. Unindexed candidates have `Index = -1` and `Exists = false`; do not pass that sentinel to the strict non-negative index helper. This example explicitly allows unindexed candidates and applies its ignored Set only to indexed candidates:

```js
const { EntityTraceFilter } = require("filters/entities");
const { ContentMasks, TraceRay, TraceType } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_TraceIgnoringEntities = () => {
	const EntityTraceRay = { End: [1024, 0, 64], Start: [0, 0, 64] };
	const EntityTraceFilterValue = new EntityTraceFilter([1, { Index: 8 }], TraceType.Everything);
	const NativeTraceFilter = {
		GetTraceType: () => EntityTraceFilterValue.GetTraceType(),
		ShouldHitEntity: (TraceEntity) => !TraceEntity.Exists || EntityTraceFilterValue.ShouldHitEntity(TraceEntity.Index),
	};
	const EntityTraceResult = TraceRay(EntityTraceRay, ContentMasks.Shot, NativeTraceFilter);
	LogInfo("TraceRay Hit=%s EntityIndex=%d", EntityTraceResult.Hit, EntityTraceResult.EntityIndex);
};

g_TraceIgnoringEntities();
```

## Workflows

### Re-check before mutation

An index alone is not a stable identity. Snapshot its network generation and re-resolve before an action; also re-check validity and the intended class. This synchronous workflow is limited to the current map and explicitly rejects a selected SDK without the input-call method:

```js
const { EntityIterator } = require("filters/entities");
const { Entity } = require("entities/entity");

const g_WakeCurrentPhysicsProps = () => {
	const CaptureEntityIdentity = (EntityValue) => ({ Index: EntityValue.Index, NetworkSerialNumber: EntityValue.NetworkSerialNumber });
	const vecPhysicsPropEntityIdentities = new EntityIterator("prop_physics").Map(CaptureEntityIdentity);
	for (const EntityIdentity of vecPhysicsPropEntityIdentities) {
		const CurrentEntity = Entity(EntityIdentity.Index);
		if ((CurrentEntity === null) || !CurrentEntity.Valid || CurrentEntity.Free || (CurrentEntity.NetworkSerialNumber !== EntityIdentity.NetworkSerialNumber) || (CurrentEntity.ClassName !== "prop_physics")) {
			continue;
		}

		if (typeof CurrentEntity.CallEntityInputFunction !== "function") {
			throw new Error("The selected SDK does not expose the entity input-call method.");
		}

		if (!CurrentEntity.CallEntityInputFunction("Wake")) {
			throw new Error(`Failed to wake entity #${EntityIdentity.Index}.`);
		}
	}
};

g_WakeCurrentPhysicsProps();
```

## Errors and ownership

- Direct scans require current globals and engine edicts; missing prerequisites throw.
- Constructor class-name strings, `bExactMatch`, callback function types, filter names, signed 32-bit trace-type shape, and safe-integer entity indexes are strict. Callback results use truthiness, and later field assignment does not repeat constructor validation.
- Entity records use exact `ClassName`, `Index`, `Valid`, and `Free` properties. Legacy member-prefixed fields are not read; class-name and trace-filter state is stored privately behind the documented PascalCase properties.
- Duplicate `RegisterFilter()` calls and `UnregisterFilter()` calls for a missing filter throw `ReferenceError`.
- Unknown required and excluded filters throw `ReferenceError` during iterator construction.
- Arrays, Sets, Maps, and iterator objects belong to the current plugin context; they do not own or extend the native entity lifetimes.
- Entity `Address` and `Edict.Address` values are borrowed. Never deallocate them or retain them across index reuse or a map transition.
- A trace filter copies indexes at construction; changing the source iterable later has no effect.
