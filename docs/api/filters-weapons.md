# `require("filters/weapons")`

> AI navigation: use the contents to locate native scans, live fields, iterators, metadata, ownership, and errors. This hand-maintained reference follows the package and selected native bindings; navigation does not replace a full review when required.

Module index: [SourceJS API Reference](README.md)

`filters/weapons` combines direct native scans of the current edict list with lazy JavaScript iterators over live weapons and profile-backed weapon classes. Use it when a plugin needs to select current weapon entities, join them to weapon metadata, or define reusable weapon predicates.

Native scans, live entity access, and mutations run synchronously on the server/game thread. The iterator helpers do not enqueue backend IO requests or accept `Blocking` options.

## Contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [Native scans](#native-scans)
- [Weapon objects](#weapon-objects)
- [WeaponIterator](#weaponiterator)
- [WeaponClassIterator](#weaponclassiterator)
- [Inherited iterator API](#inherited-iterator-api)
- [Named filters](#named-filters)
- [Class metadata](#class-metadata)
- [Realtime and ownership](#realtime-and-ownership)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Import and capabilities

The module has eight public names: six native functions and two JavaScript iterator classes. The native module itself is required; SourceJS does not install a fallback object when the selected SDK cannot scan entities.

```js
const { LogInfo } = require("loggers");

const g_InspectWeaponCapabilities = () => {
	const WeaponFilterModule = require("filters/weapons");
	const vecExpectedExportNames = [
		"GetAllWeapons",
		"GetCurrentWeapon",
		"GetWeapon",
		"GetWeaponCount",
		"GetWeaponsByClassName",
		"GetWeaponsByName",
		"WeaponClassIterator",
		"WeaponIterator",
	];
	const vecExportedNames = Object.keys(WeaponFilterModule).sort();
	const vecWeaponEntities = WeaponFilterModule.GetAllWeapons();

	if (JSON.stringify(vecExportedNames) !== JSON.stringify(vecExpectedExportNames)) {
		throw new Error(`Unexpected filters/weapons exports: ${vecExportedNames.join(", ")}.`);
	}

	if (vecWeaponEntities.length === 0) {
		throw new Error("Weapon capability example requires a current weapon entity.");
	}

	const FirstWeapon = vecWeaponEntities[0];
	LogInfo("WeaponCapabilities %s", JSON.stringify({
		ExportedNames: vecExportedNames,
		HasDataMaps: typeof FirstWeapon.GetEntityDataMap === "function",
		HasEntityInputs: typeof FirstWeapon.CallEntityInput === "function",
		HasSendProperties: typeof FirstWeapon.GetEntityProperty === "function",
	}));
};

g_InspectWeaponCapabilities();
```

Entity input, send-property, and datamap methods are installed only when the selected SDK exposes the corresponding native capability. Check a method before using it in a cross-game plugin.

## Exports

| Export and signature | Result |
| --- | --- |
| `GetAllWeapons()` | Fresh array of every occupied `weapon_*` edict as native Weapon objects. |
| `GetWeaponsByClassName(strWeaponClassName)` | Fresh array whose current class name exactly matches a non-empty string such as `"weapon_rifle"`. |
| `GetWeaponsByName(strWeaponName)` | Fresh array for a non-empty short or prefixed name, such as `"rifle"` or `"weapon_rifle"`. |
| `GetWeapon(WeaponReference)` | Native Weapon for the current index, or `null` when the current edict is absent, free, or not a weapon. |
| `GetCurrentWeapon(PlayerReference)` | Current native Weapon object, or `null` when the player has no resolvable active weapon. |
| `GetWeaponCount()` | Current number of occupied `weapon_*` edicts. |
| [`new WeaponIterator(RequiredFilters = null, ExcludedFilters = null)`](#weaponiterator) | Lazy iterator over current native Weapon objects. |
| [`new WeaponClassIterator(RequiredFilters = null, ExcludedFilters = null)`](#weaponclassiterator) | Lazy iterator over composed weapon-class metadata. |

## Native scans

`GetAllWeapons()`/`GetWeaponsByClassName()`/`GetWeaponsByName()`/`GetWeaponCount()` scan the current edict list when called. Their arrays are point-in-time containers; call again after entity creation, removal, or a map change.

Separate calls, including a scan followed by `GetWeaponCount()`, are not one atomic world snapshot. A wrapper retains an index, not the entity lifetime or generation represented by an earlier scan.

```js
const {
	GetAllWeapons,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetWeapon,
	GetWeaponCount,
} = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectNativeWeapons = () => {
	const GetWeaponIndex = (Weapon) => Weapon.Index;
	const vecWeaponEntities = GetAllWeapons();
	if (vecWeaponEntities.length === 0) {
		throw new Error("Native weapon-scan example requires a current weapon entity.");
	}

	const FirstWeapon = vecWeaponEntities[0];
	const vecExactWeaponMatches = GetWeaponsByClassName(FirstWeapon.ClassName);
	const vecShortWeaponNameMatches = GetWeaponsByName(FirstWeapon.Weapon);
	const vecPrefixedWeaponNameMatches = GetWeaponsByName(FirstWeapon.ClassName);
	const ResolvedWeapon = GetWeapon(FirstWeapon);
	if ((ResolvedWeapon === null) || (ResolvedWeapon.Index !== FirstWeapon.Index)) {
		throw new Error("GetWeapon() did not resolve the scanned weapon.");
	}

	LogInfo("WeaponNativeScan %s", JSON.stringify({
		WeaponCount: GetWeaponCount(),
		ExactWeaponIndexes: vecExactWeaponMatches.map(GetWeaponIndex),
		PrefixedWeaponIndexes: vecPrefixedWeaponNameMatches.map(GetWeaponIndex),
		ResolvedWeaponIndex: ResolvedWeapon.Index,
		ShortWeaponNameIndexes: vecShortWeaponNameMatches.map(GetWeaponIndex),
	}));
};

g_InspectNativeWeapons();
```

`GetCurrentWeapon(PlayerReference)` accepts a non-negative player index or an object with an integer `Index`. It returns the player's current native Weapon object, or `null` when the active weapon cannot be resolved.

```js
const { GetCurrentWeapon } = require("filters/weapons");
const { GetAllPlayers } = require("filters/players");
const { LogInfo } = require("loggers");

const g_InspectCurrentWeapon = () => {
	const vecPlayers = GetAllPlayers();
	if (vecPlayers.length === 0) {
		throw new Error("Current-weapon example requires a connected player.");
	}

	const Player = vecPlayers[0];
	const CurrentWeapon = GetCurrentWeapon(Player);
	if ((CurrentWeapon === null) || (typeof CurrentWeapon !== "object") || !Number.isInteger(CurrentWeapon.Index)) {
		throw new Error("Current-weapon example requires a resolvable native Weapon object.");
	}

	LogInfo("WeaponCurrent WeaponIndex=%d PlayerIndex=%d", CurrentWeapon.Index, Player.Index);
};

g_InspectCurrentWeapon();
```

Several dropped weapons may share one name. `GetWeaponsByName()` therefore always returns an array.

## Weapon objects

Each native scan and `GetWeapon()` returns a native Weapon object. It contains the eleven live Entity fields plus two live weapon fields.

### Fields

| Field | Access | Meaning |
| --- | --- | --- |
| `Index` | read-only integer | Edict index represented by this wrapper. |
| `Valid` | read-only boolean | Whether that index currently contains an occupied edict. |
| `Free` | writable boolean | Current edict free flag. Normal plugins should not write it. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | writable integer | Current `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | writable integer | Current edict serial number. Normally engine-owned. |
| `Edict` | read-only object or `null` | Opaque current edict value. |
| `BaseEntity` | read-only object or `null` | Opaque current `CBaseEntity` value. |
| `Address` | read-only `bigint` | Current `CBaseEntity` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Current serial-aware SDK base handle. |
| `HandleValue` | read-only integer | Packed current handle, or `-1`. |
| `IsWeapon` | read-only boolean | Realtime test that the current class begins with `weapon_`. |
| `Weapon` | read-only string | Realtime class name without `weapon_`, or `""` after invalidation. |

Read live fields at the point of use. Although setters are exposed for low-level integration, `Free`, `StateFlags`, and `NetworkSerialNumber` are engine-managed state. A read-only inspection example avoids changing entity/network lifecycle invariants:

```js
const { GetAllWeapons } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectLiveWeaponFields = () => {
	const vecWeaponEntities = GetAllWeapons();
	if (vecWeaponEntities.length === 0) {
		throw new Error("Live weapon-field example requires a current weapon entity.");
	}

	const CurrentWeapon = vecWeaponEntities[0];
	LogInfo("WeaponLiveFields %s", JSON.stringify({
		Free: CurrentWeapon.Free,
		IsWeapon: CurrentWeapon.IsWeapon,
		Valid: CurrentWeapon.Valid,
		HandleValue: CurrentWeapon.HandleValue,
		HasBaseEntity: CurrentWeapon.BaseEntity !== null,
		HasBaseHandle: CurrentWeapon.BaseHandle !== null,
		HasEdict: CurrentWeapon.Edict !== null,
		Address: CurrentWeapon.Address.toString(),
		ClassName: CurrentWeapon.ClassName,
		Weapon: CurrentWeapon.Weapon,
		Index: CurrentWeapon.Index,
		NetworkSerialNumber: CurrentWeapon.NetworkSerialNumber,
		StateFlags: CurrentWeapon.StateFlags,
	}));
};

g_InspectLiveWeaponFields();
```

### Lifecycle methods

| Method | Capability and behavior |
| --- | --- |
| `RemoveEntity()` | Always present. Removes the currently indexed occupied entity and returns the native result. |
| `SlayEntity()` | Present with `CBaseEntity::AcceptInput`. Attempts `SetHealth 0`; only if that call returns `false`, attempts `Kill`. |
| `CallEntityInput(strInputName, InputValue = undefined, flInputDelay = 0)` | Present with `CBaseEntity::AcceptInput`. Sends or queues a native entity input. |

Create a disposable entity before demonstrating destructive methods. This example derives the class from current metadata instead of hardcoding one game's weapon name:

The creating entity record remains the cleanup owner even if weapon lookup throws or returns `null`. A sole failure is rethrown unchanged; simultaneous operation and cleanup failures are reported in that order through `AggregateError`. Failed cleanup does not establish that the engine removed the entity.

```js
const { CreateAndSpawnEntityByClassName } = require("entities/factories");
const { GetWeapon, WeaponClassIterator } = require("filters/weapons");

const g_InspectWeaponLifecycle = () => {
	const vecFailures = [];

	if (typeof CreateAndSpawnEntityByClassName !== "function") {
		throw new Error("The selected SDK does not expose entity creation.");
	}

	const WeaponClassInformation = new WeaponClassIterator().First();
	if (WeaponClassInformation === null) {
		throw new Error("The selected SDK profile has no weapon classes.");
	}

	const TemporaryEntity = CreateAndSpawnEntityByClassName(WeaponClassInformation.ClassName);
	if (TemporaryEntity === null) {
		throw new Error(`Failed to create ${WeaponClassInformation.ClassName}.`);
	}

	try {
		const TemporaryWeapon = GetWeapon(TemporaryEntity);
		if (TemporaryWeapon === null) {
			throw new Error("The temporary entity was not recognized as a weapon.");
		}

		if ((typeof TemporaryWeapon.CallEntityInput !== "function") || (typeof TemporaryWeapon.SlayEntity !== "function")) {
			throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput.");
		}

		if (!TemporaryWeapon.CallEntityInput("AddOutput", "targetname sourcejs_filter_example")) {
			throw new Error("Temporary weapon input failed.");
		}

		if (!TemporaryWeapon.SlayEntity()) {
			throw new Error("Temporary weapon slay failed.");
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (TemporaryEntity.Valid && !TemporaryEntity.RemoveEntity()) {
					throw new Error("Temporary entity cleanup failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Temporary weapon operation and entity cleanup failed.");
	}
};

g_InspectWeaponLifecycle();
```

### Send-property methods

With send-property support, every `Weapon` has the complete direct `Entity` family:

- `GetEntityProperty(strPropertyName, strPropertyType?)` and `SetEntityProperty(strPropertyName, PropertyValue, strPropertyType?)`;
- `GetEntityPropertyInteger(strPropertyName)` and `SetEntityPropertyInteger(strPropertyName, nPropertyValue)`;
- `GetEntityPropertyFloat(strPropertyName)` and `SetEntityPropertyFloat(strPropertyName, flPropertyValue)`;
- `GetEntityPropertyString(strPropertyName)` and `SetEntityPropertyString(strPropertyName, strPropertyValue)`;
- `GetEntityPropertyVector(strPropertyName)` and `SetEntityPropertyVector(strPropertyName, PropertyVector)`;
- `GetEntityPropertyEntity(strPropertyName)` and `SetEntityPropertyEntity(strPropertyName, EntityReference)`.

Property paths differ by class and SDK. `m_iClip1` is common to many `CBaseCombatWeapon` branches; inspect the current server class before relying on it:

```js
const { GetEntitySendProperty } = require("entities/props");
const { GetAllWeapons } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectWeaponClipProperty = () => {
	const HasWeaponClipProperty = (Weapon) => GetEntitySendProperty(Weapon, "m_iClip1") !== null;
	const CurrentWeapon = GetAllWeapons().find(HasWeaponClipProperty);
	if (CurrentWeapon === undefined) {
		throw new Error("No current weapon exposes m_iClip1.");
	}

	const vecRequiredPropertyMethodNames = [
		"GetEntityProperty",
		"GetEntityPropertyInteger",
		"SetEntityProperty",
		"SetEntityPropertyInteger",
	];
	const IsPropertyMethodUnavailable = (strMethodName) => typeof CurrentWeapon[strMethodName] !== "function";
	if (vecRequiredPropertyMethodNames.some(IsPropertyMethodUnavailable)) {
		throw new Error("The selected SDK does not expose send-property access.");
	}

	const ClipProperty = GetEntitySendProperty(CurrentWeapon, "m_iClip1");
	if (ClipProperty === null) {
		throw new Error("m_iClip1 disappeared before access.");
	}

	const nPreviousClipValue = CurrentWeapon.GetEntityPropertyInteger(ClipProperty.Path);
	const vecFailures = [];

	try {
		if (!CurrentWeapon.SetEntityPropertyInteger(ClipProperty.Path, nPreviousClipValue) || !CurrentWeapon.SetEntityProperty(ClipProperty.Path, nPreviousClipValue, "int")) {
			throw new Error("m_iClip1 write failed.");
		}

		const nGenericClipValue = CurrentWeapon.GetEntityProperty(ClipProperty.Path, "int");
		const nTypedClipValue = CurrentWeapon.GetEntityPropertyInteger(ClipProperty.Path);
		if ((nGenericClipValue !== nPreviousClipValue) || (nTypedClipValue !== nPreviousClipValue)) {
			throw new Error("m_iClip1 readback failed.");
		}

		LogInfo("WeaponClip GenericClipValue=%d TypedClipValue=%d", nGenericClipValue, nTypedClipValue);
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (!CurrentWeapon.SetEntityPropertyInteger(ClipProperty.Path, nPreviousClipValue)) {
				throw new Error("m_iClip1 restoration failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Weapon clip access and restoration failed.");
	}
};

g_InspectWeaponClipProperty();
```

Use [`entities/props`](entities-props.md) to inspect send tables and [`entities/entity`](entities-entity.md) for a reversible example of every typed method, including live vector and entity-handle values.

### DataMap methods

With datamap support, every `Weapon` has:

- `GetEntityDataMap()`;
- `GetEntityDataMapProperty(strPropertyName, strPropertyType?)` and `SetEntityDataMapProperty(strPropertyName, PropertyValue, strPropertyType?)`;
- `GetEntityDataMapPropertyInteger(strPropertyName)` and `SetEntityDataMapPropertyInteger(strPropertyName, nPropertyValue)`;
- `GetEntityDataMapPropertyFloat(strPropertyName)` and `SetEntityDataMapPropertyFloat(strPropertyName, flPropertyValue)`;
- `GetEntityDataMapPropertyString(strPropertyName)` and `SetEntityDataMapPropertyString(strPropertyName, strPropertyValue)`;
- `GetEntityDataMapPropertyVector(strPropertyName)` and `SetEntityDataMapPropertyVector(strPropertyName, PropertyVector)`;
- `GetEntityDataMapPropertyEntity(strPropertyName)` and `SetEntityDataMapPropertyEntity(strPropertyName, EntityReference)`.

Discover the current field before writing it. The following workflow uses the common `m_spawnflags` integer and restores it:

```js
const { FindEntityDataMapField } = require("entities/datamaps");
const { GetAllWeapons } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectWeaponDataMap = () => {
	const vecRequiredDataMapMethodNames = [
		"GetEntityDataMap",
		"GetEntityDataMapProperty",
		"GetEntityDataMapPropertyInteger",
		"SetEntityDataMapProperty",
		"SetEntityDataMapPropertyInteger",
	];

	const HasRequiredWeaponDataMapMethods = (Weapon) => {
		const IsDataMapMethodAvailable = (strMethodName) => typeof Weapon[strMethodName] === "function";

		return vecRequiredDataMapMethodNames.every(IsDataMapMethodAvailable);
	};

	const CurrentWeapon = GetAllWeapons().find(HasRequiredWeaponDataMapMethods);
	if (CurrentWeapon === undefined) {
		throw new Error("The selected SDK does not expose weapon datamaps.");
	}

	const EntityDataMap = CurrentWeapon.GetEntityDataMap();
	if (EntityDataMap === null) {
		throw new Error("The current weapon has no datamap.");
	}

	const SpawnFlagsField = FindEntityDataMapField(EntityDataMap, "m_spawnflags");
	if ((SpawnFlagsField === null) || (SpawnFlagsField.Type !== "int")) {
		throw new Error(`${EntityDataMap.ClassName} does not expose integer m_spawnflags.`);
	}

	const nPreviousSpawnFlags = CurrentWeapon.GetEntityDataMapPropertyInteger(SpawnFlagsField.Path);
	const vecFailures = [];

	try {
		if (!CurrentWeapon.SetEntityDataMapPropertyInteger(SpawnFlagsField.Path, nPreviousSpawnFlags) || !CurrentWeapon.SetEntityDataMapProperty(SpawnFlagsField.Path, nPreviousSpawnFlags, "int")) {
			throw new Error("m_spawnflags write failed.");
		}

		const nGenericSpawnFlagsValue = CurrentWeapon.GetEntityDataMapProperty(SpawnFlagsField.Path, "int");
		const nTypedSpawnFlagsValue = CurrentWeapon.GetEntityDataMapPropertyInteger(SpawnFlagsField.Path);
		if ((nGenericSpawnFlagsValue !== nPreviousSpawnFlags) || (nTypedSpawnFlagsValue !== nPreviousSpawnFlags)) {
			throw new Error("m_spawnflags readback failed.");
		}

		LogInfo("WeaponDataMap GenericSpawnFlagsValue=%d TypedSpawnFlagsValue=%d ClassName=%s", nGenericSpawnFlagsValue, nTypedSpawnFlagsValue, EntityDataMap.ClassName);
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (!CurrentWeapon.SetEntityDataMapPropertyInteger(SpawnFlagsField.Path, nPreviousSpawnFlags)) {
				throw new Error("m_spawnflags restoration failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Weapon datamap access and restoration failed.");
	}
};

g_InspectWeaponDataMap();
```

See [`entities/datamaps`](entities-datamaps.md) for field discovery, variants, address ownership, and examples of every typed method.

## `WeaponIterator`

`WeaponIterator` rescans native weapons whenever it resolves. Its built-in filters are:

| Filter | Predicate |
| --- | --- |
| `All` | Accepts every current weapon. |
| `Valid` | Requires `IsWeapon === true`, `Valid === true`, and `Free === false`. |
| current profile tags | Matches the live class metadata tag list. No game-specific tags are fabricated. |

Required filters all have to pass. Any matching excluded filter rejects the item. With no supplied names, neither `All` nor `Valid` is implicitly required; the current raw source is accepted.

Profile tag names retain their exact configured spelling. A tag named `all` is separate from the built-in `All`; filter names are not case-normalized. Metadata refresh runs during either iterator's construction and static source resolution. It removes obsolete callbacks installed by this module, but preserves callbacks replaced by the plugin and tolerates callbacks already unregistered by the plugin. Registry-only queries such as `HasFilter()` do not themselves refresh metadata.

```js
const { WeaponIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectWeaponIterator = () => {
	const GetWeaponIndex = (Weapon) => Weapon.Index;
	const GetWeaponName = (Weapon) => Weapon.Weapon;
	const HasWeaponAddress = (Weapon) => Weapon.Address !== 0n;
	const WeaponIteratorValue = new WeaponIterator(["All", "Valid"], []);
	const vecVisitedWeaponIndexes = [];
	const FilteredWeaponIterator = WeaponIteratorValue.Filter(HasWeaponAddress);
	const AppendVisitedWeaponIndex = (Weapon) => {
		vecVisitedWeaponIndexes.push(Weapon.Index);
	};

	if (WeaponIteratorValue.ForEach(AppendVisitedWeaponIndex) !== WeaponIteratorValue) {
		throw new Error("WeaponIterator.ForEach() did not return the source iterator.");
	}

	const FirstWeapon = WeaponIteratorValue.First();
	const nFirstWeaponIndex = (FirstWeapon === null) ? null : FirstWeapon.Index;
	const ValidWeaponFilterCallback = WeaponIteratorValue.GetIteratorFilterCallback("Valid");
	const bFirstWeaponValid = (FirstWeapon === null) ? false : (WeaponIteratorValue.IsValid(FirstWeapon) && ValidWeaponFilterCallback(FirstWeapon));
	LogInfo("WeaponIterator %s", JSON.stringify({
		WeaponIndexes: WeaponIteratorValue.ToArray().map(GetWeaponIndex),
		ExcludedFilterNames: WeaponIteratorValue.ExcludedFilterNames,
		FilteredWeaponIndexes: FilteredWeaponIterator.Map(GetWeaponIndex),
		IteratedWeaponIndexes: [...WeaponIteratorValue].map(GetWeaponIndex),
		MappedWeaponNames: WeaponIteratorValue.Map(GetWeaponName),
		RequiredFilterNames: WeaponIteratorValue.RequiredFilterNames,
		ResolvedWeaponIndexes: WeaponIteratorValue.Resolve().map(GetWeaponIndex),
		IteratorValueWeaponIndexes: WeaponIteratorValue.Values().map(GetWeaponIndex),
		VisitedWeaponIndexes: vecVisitedWeaponIndexes,
		ValidWeaponFilterResult: (FirstWeapon === null) ? null : ValidWeaponFilterCallback(FirstWeapon),
		FirstWeaponValid: bFirstWeaponValid,
		IteratorPredicate: WeaponIteratorValue.IteratorPredicate,
		IteratorItemSourceType: typeof WeaponIteratorValue.IteratorItems,
		WeaponCount: WeaponIteratorValue.Count(),
		FirstWeaponIndex: nFirstWeaponIndex,
		IterationWeaponCount: Array.from(WeaponIteratorValue).length,
	}));
};

g_InspectWeaponIterator();
```

`Filter()` returns a general `IteratorFilter`; it still resolves its source lazily. `Map()` resolves immediately and returns an array. `ForEach()` resolves immediately and returns the original iterator.

## `WeaponClassIterator`

`WeaponClassIterator` composes class records from three current sources in this order:

1. [`weapons/data`](weapons-data.md) profile records;
2. native class names currently present in the edict list;
3. [`weapons/scripts`](weapons-scripts.md) records attached as `WeaponScript`.

Its built-in filter is `All` plus each current profile tag that does not duplicate an existing filter name. A native-only class has the four mandatory fields and an empty `WeaponTags` array. Script-only classes also enter the result with those fields plus `WeaponScript`. Repeated profile records replace earlier metadata for that class; native names add only missing classes, and script attachments augment an existing record or create a minimal one. The class-keyed map prevents duplicate class entries.

```js
const { WeaponClassIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectWeaponClassIterator = () => {
	const GetWeaponClassName = (WeaponClassRecord) => WeaponClassRecord.ClassName;
	const GetWeaponClassTags = (WeaponClassRecord) => WeaponClassRecord.WeaponTags;
	const vecWeaponClassRecords = new WeaponClassIterator("All").ToArray();
	if (vecWeaponClassRecords.length === 0) {
		throw new Error("The selected SDK profile has no weapon classes.");
	}

	const vecCurrentWeaponTags = vecWeaponClassRecords.flatMap(GetWeaponClassTags);
	if (vecCurrentWeaponTags.length === 0) {
		throw new Error("The selected SDK profile has no weapon tags.");
	}

	const strDynamicWeaponTag = vecCurrentWeaponTags[0];
	const vecTaggedWeaponClasses = new WeaponClassIterator(strDynamicWeaponTag).ToArray();

	LogInfo("WeaponClassIterator %s", JSON.stringify({
		RegisteredIteratorFilterNames: WeaponClassIterator.GetFilterNames(),
		TaggedWeaponClassNames: vecTaggedWeaponClasses.map(GetWeaponClassName),
		WeaponClassNames: vecWeaponClassRecords.map(GetWeaponClassName),
		DynamicWeaponTag: strDynamicWeaponTag,
		StaticWeaponClassCount: WeaponClassIterator.Iterator().length,
	}));
};

g_InspectWeaponClassIterator();
```

## Inherited iterator API

Both weapon iterator classes inherit the complete [`IteratorObject`](filters-iterator.md) API.

Descriptions of automatic rescans and named filtering assume the installed `IteratorItems` resolver remains unchanged. Replacing that writable field replaces the pipeline and follows the replacement source's contract instead; an additional `IteratorPredicate` remains a separate post-source predicate.

### Static methods

| Member | Result |
| --- | --- |
| `Iterator()` | Current raw source iterable for that class. |
| `RegisterFilter(strFilterName, Callback)` | Registers one class-local predicate and returns the callback. |
| `UnregisterFilter(strFilterName)` | Removes an existing predicate and returns `true`. |
| `HasFilter(strFilterName)` | Reports whether a named predicate is registered. |
| `GetFilterNames()` | Fresh array of registered names. |
| `DefaultFilters()` | Null-prototype object whose values are separately resolved `Set` results for registered filters; not one atomic world snapshot. |

### Instance fields and methods

| Member | Behavior |
| --- | --- |
| `IteratorItems` | Initially the resolver installed by `IteratorObject`; writable replacement can bypass the native scan and required/excluded-name pipeline. |
| `IteratorPredicate` | Optional `IteratorFilter` predicate; `null` on a new weapon iterator. |
| `RequiredFilterNames` | Ordered array copied from the constructor input. |
| `ExcludedFilterNames` | Ordered array copied from the constructor input. |
| `Resolve()`, `Values()`, and `ToArray()` | Fresh materialized array from the current source. |
| `Count()` | Current resolved length. |
| `First()` | First current result or `null`. |
| `Filter(Predicate)` | New lazy `IteratorFilter`. |
| `Map(Callback)` | Immediate mapped array. |
| `ForEach(Callback)` | Immediate visit; returns `this`. |
| `[Symbol.iterator]()` | Iterator over a fresh resolution. |
| `Iterate()` | Delegates to the class's static `Iterator()` and returns the raw source; it bypasses the instance's required/excluded names and extra `IteratorPredicate`. |
| `GetIteratorFilterCallback(strFilterName)` | Registered predicate or `ReferenceError`. |
| `IsValid(Item)` | Applies required predicates, then excluded predicates. |

## Named filters

Registries are isolated per class and per plugin V8 context. Use a plugin-specific name and always unregister it during unload. Registering a duplicate or unregistering a missing name throws.

```js
const { WeaponIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectNamedWeaponFilter = () => {
	const strIteratorFilterName = "ExampleEvenWeaponIndex";
	const vecFailures = [];
	let bIteratorFilterRegistered = false;

	const IsEvenWeaponIndex = (Weapon) => (Weapon.Index % 2) === 0;
	const GetWeaponIndex = (Weapon) => Weapon.Index;

	try {
		const RegisteredEvenWeaponIndexFilter = WeaponIterator.RegisterFilter(strIteratorFilterName, IsEvenWeaponIndex);
		bIteratorFilterRegistered = true;

		if ((RegisteredEvenWeaponIndexFilter !== IsEvenWeaponIndex) || !WeaponIterator.HasFilter(strIteratorFilterName)) {
			throw new Error(`${strIteratorFilterName} registration failed.`);
		}

		const vecEvenIndexWeapons = new WeaponIterator(strIteratorFilterName).ToArray();
		const DefaultIteratorFilters = WeaponIterator.DefaultFilters();
		LogInfo("WeaponNamedFilter %s", JSON.stringify({
			HasIteratorFilter: WeaponIterator.HasFilter(strIteratorFilterName),
			IteratorFilterCallbackRegistered: RegisteredEvenWeaponIndexFilter === IsEvenWeaponIndex,
			DefaultFilteredWeaponCount: DefaultIteratorFilters[strIteratorFilterName].size,
			EvenWeaponIndexes: vecEvenIndexWeapons.map(GetWeaponIndex),
			IteratorFilterNames: WeaponIterator.GetFilterNames(),
		}));
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (bIteratorFilterRegistered && (!WeaponIterator.UnregisterFilter(strIteratorFilterName) || WeaponIterator.HasFilter(strIteratorFilterName))) {
				throw new Error(`${strIteratorFilterName} cleanup failed.`);
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Named weapon filtering and filter cleanup failed.");
	}
};

g_InspectNamedWeaponFilter();
```

The example preserves a sole failure unchanged and orders simultaneous operation/cleanup failures in an `AggregateError`. Duplicate-registration failure does not authorize removing another owner's filter. A cleanup failure does not prove successful removal; arrange unload-time removal for any plugin filter still registered.

## Class metadata

Every class record has these fields:

| Field | Meaning |
| --- | --- |
| `BaseWeaponName` | Profile key, or the class name without `weapon_` for a native-only record. |
| `ClassName` | Full entity class name. |
| `WeaponName` | Short weapon name. |
| `WeaponTags` | Profile tag array captured by reference, or `[]` for a native-only record. |

Profile-backed records may also have:

| Field | Meaning |
| --- | --- |
| `PrimaryAmmoProperty` | Primary ammo send-property prefix or `null`. |
| `WeaponClassNames` | Profile class-name array. |
| `WeaponClip` | Profile clip value or `null`. |
| `WeaponCost` | Profile cost or `null`. |
| `WeaponData` | Live normalized raw profile object. |
| `WeaponID` | Raw profile identifier or `null`. |
| `ItemDefinitionIndex` | Finite numeric item definition index or `null`. |
| `PrimaryMaximumAmmo` | Primary maximum-ammo ConVar/name or `null`. |
| `WeaponLookupNames` | Profile lookup-name array. |
| `ParentWeaponClassName` | Profile parent class or `null`. |
| `WeaponScript` | Attached script record or `null`. |
| `SecondaryAmmoProperty` | Secondary ammo property or `null`. |
| `SecondaryMaximumAmmo` | Secondary maximum-ammo value or `null`. |
| `WeaponSlot` | Profile slot or `null`. |
| `WeaponType` | Profile type or `null`. |

An attached `WeaponScript` record contains `ClassName`, live `KeyValues`, short `Name`, and physical `Path`. Script attachment does not replace profile `WeaponTags` or `WeaponData`.

Composition shallow-copies enumerable own profile fields, translating known names to the fields above and retaining additional field keys. Top-level class records are new mutable objects: copied scalars are not live getters, while object/array values retain their supplied references. Re-resolve to obtain new scalar metadata; do not mutate borrowed profile arrays or cache-owned objects unintentionally. Copying invokes profile getters, including `Script`; on a script-cache miss this can synchronously load a weapon-script file and create cache-owned `KeyValues`. Getter and loader failures propagate from metadata refresh, including iterator construction and source resolution.

Diagnostic examples project scalar/array metadata and report only the presence of borrowed `WeaponData` and native `KeyValues`; they do not serialize those cache-owned objects or handles.

```js
const { WeaponClassIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_ReportWeaponClassMetadata = () => {
	const vecOptionalWeaponClassFieldNames = [
		"PrimaryAmmoProperty",
		"WeaponClassNames",
		"WeaponClip",
		"WeaponCost",
		"WeaponID",
		"ItemDefinitionIndex",
		"PrimaryMaximumAmmo",
		"WeaponLookupNames",
		"ParentWeaponClassName",
		"SecondaryAmmoProperty",
		"SecondaryMaximumAmmo",
		"WeaponSlot",
		"WeaponType",
	];

	for (const WeaponClassRecord of new WeaponClassIterator()) {
		const WeaponClassReport = { WeaponTags: WeaponClassRecord.WeaponTags, BaseWeaponName: WeaponClassRecord.BaseWeaponName, ClassName: WeaponClassRecord.ClassName, WeaponName: WeaponClassRecord.WeaponName };

		for (const strWeaponClassFieldName of vecOptionalWeaponClassFieldNames) {
			if (Object.hasOwn(WeaponClassRecord, strWeaponClassFieldName)) {
				WeaponClassReport[strWeaponClassFieldName] = WeaponClassRecord[strWeaponClassFieldName];
			}
		}

		if (Object.hasOwn(WeaponClassRecord, "WeaponData")) {
			WeaponClassReport.HasWeaponData = WeaponClassRecord.WeaponData !== null;
		}

		if (Object.hasOwn(WeaponClassRecord, "WeaponScript")) {
			const WeaponScript = WeaponClassRecord.WeaponScript;
			if ((WeaponScript !== null) && (typeof WeaponScript !== "object")) {
				throw new TypeError(`${WeaponClassRecord.ClassName} has malformed script metadata.`);
			}

			if (WeaponScript !== null) {
				WeaponClassReport.WeaponScript = { HasKeyValues: WeaponScript.KeyValues !== null, ClassName: WeaponScript.ClassName, Name: WeaponScript.Name, Path: WeaponScript.Path };
			}
		}

		LogInfo("WeaponClassMetadata %s", JSON.stringify(WeaponClassReport));
	}
};

g_ReportWeaponClassMetadata();
```

Join metadata to current entities by exact class name:

```js
const { GetWeaponsByClassName, WeaponClassIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_ReportWeaponInventory = () => {
	const GetWeaponIndex = (Weapon) => Weapon.Index;

	const CreateWeaponInventoryEntry = (WeaponClassRecord) => {
		const WeaponInventoryEntry = { WeaponTags: WeaponClassRecord.WeaponTags, ClassName: WeaponClassRecord.ClassName, WeaponEntityIndexes: GetWeaponsByClassName(WeaponClassRecord.ClassName).map(GetWeaponIndex) };

		if (Object.hasOwn(WeaponClassRecord, "WeaponScript")) {
			const WeaponScript = WeaponClassRecord.WeaponScript;
			if ((WeaponScript !== null) && (typeof WeaponScript !== "object")) {
				throw new TypeError(`${WeaponClassRecord.ClassName} has malformed script metadata.`);
			}

			if (WeaponScript !== null) {
				WeaponInventoryEntry.WeaponScriptPath = WeaponScript.Path;
			}
		}

		return WeaponInventoryEntry;
	};

	const vecWeaponInventory = new WeaponClassIterator().Map(CreateWeaponInventoryEntry);
	LogInfo("WeaponInventory %s", JSON.stringify(vecWeaponInventory));
};

g_ReportWeaponInventory();
```

## Realtime and ownership

- Native scan arrays are point-in-time arrays. Their `Weapon` objects expose realtime properties tied to the represented edict index.
- A `Weapon` wrapper does not pin an entity or retain its original generation. Its getters resolve the current occupant of that index. If identity must survive deferred work, retain and compare the original serial-aware handle as well as current validity; merely rereading the current `BaseHandle` or `HandleValue` does not prove it is the original entity.
- With the installed source unchanged, `WeaponIterator` resolves native weapons again for every materializing operation. Replacing `IteratorItems` follows that replacement's contract instead.
- `WeaponClassIterator` composes a new top-level record array on every resolution. Retained top-level scalars can become stale; borrowed `WeaponData`, `WeaponTags`, and `WeaponScript` references follow their supplying modules' cache lifetimes.
- Named-filter maps belong to the iterator class in the current plugin context. They are not shared across isolated plugins.
- Script `KeyValues` handles belong to [`weapons/scripts`](weapons-scripts.md). Do not destroy them manually; `ClearCache()` owns that lifecycle.

This retained iterator re-resolves the current world and creates fresh wrappers without being reconstructed:

```js
const { WeaponIterator } = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_InspectRealtimeWeaponResolution = () => {
	const CreateWeaponIndexEntry = (Weapon) => [Weapon.Index, Weapon];
	const GetWeaponIndex = (Weapon) => Weapon.Index;
	const WeaponIteratorValue = new WeaponIterator("Valid");
	const vecFirstWeaponScan = WeaponIteratorValue.ToArray();
	const vecSecondWeaponScan = WeaponIteratorValue.ToArray();
	const mapFirstWeaponScanByIndex = new Map(vecFirstWeaponScan.map(CreateWeaponIndexEntry));

	const IsRepeatedWeaponIndex = (Weapon) => mapFirstWeaponScanByIndex.has(Weapon.Index);
	const RepeatedWeapon = vecSecondWeaponScan.find(IsRepeatedWeaponIndex);
	if (RepeatedWeapon === undefined) {
		throw new Error("Repeated weapon scan requires one stable current weapon index.");
	}

	const bUsesNewWeaponWrapperObjects = mapFirstWeaponScanByIndex.get(RepeatedWeapon.Index) !== RepeatedWeapon;
	if (!bUsesNewWeaponWrapperObjects) {
		throw new Error("Repeated weapon scan reused a stale wrapper.");
	}

	LogInfo("WeaponRealtimeResolution %s", JSON.stringify({
		UsesNewWeaponWrapperObjects: bUsesNewWeaponWrapperObjects,
		FirstWeaponIndexes: vecFirstWeaponScan.map(GetWeaponIndex),
		SecondWeaponIndexes: vecSecondWeaponScan.map(GetWeaponIndex),
	}));
};

g_InspectRealtimeWeaponResolution();
```

## Errors and common mistakes

`GetWeaponsByClassName()` and `GetWeaponsByName()` require non-empty strings. `GetCurrentWeapon()` and `GetWeapon()` require valid player or weapon references and reject missing, fractional, negative, or scalar-coerced references. `GetCurrentWeapon()` requires a live base entity with the native `m_hActiveWeapon` send property; invalid player resolution or a missing property throws rather than returning `null`. Native argument failures use `Error`, not a promised `TypeError` subclass; errors from user accessors may propagate. Iterator input validation uses `TypeError`, and missing registered names use `ReferenceError`. Iterator constructors accept a non-empty filter-name string, an iterable of non-empty strings, `null`, or `undefined`.

```js
const {
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetWeapon,
	GetCurrentWeapon,
	WeaponIterator,
} = require("filters/weapons");
const { LogInfo } = require("loggers");

const g_VerifyWeaponErrors = () => {
	const GetWeaponsWithEmptyClassName = () => GetWeaponsByClassName("");
	const GetWeaponsWithNumericName = () => GetWeaponsByName(42);
	const GetCurrentWeaponWithNullPlayer = () => GetCurrentWeapon(null);
	const GetNegativeWeaponIndex = () => GetWeapon(-1);
	const CreateIteratorWithUnknownFilter = () => new WeaponIterator("MissingFilter");
	const vecInvalidWeaponOperations = [
		{ ExpectedErrorType: Error, Operation: GetWeaponsWithEmptyClassName, OperationName: "Empty class name" },
		{ ExpectedErrorType: Error, Operation: GetWeaponsWithNumericName, OperationName: "Numeric weapon name" },
		{ ExpectedErrorType: Error, Operation: GetCurrentWeaponWithNullPlayer, OperationName: "Null player" },
		{ ExpectedErrorType: Error, Operation: GetNegativeWeaponIndex, OperationName: "Negative weapon index" },
		{ ExpectedErrorType: ReferenceError, Operation: CreateIteratorWithUnknownFilter, OperationName: "Unknown iterator filter" },
	];

	for (const InvalidWeaponOperation of vecInvalidWeaponOperations) {
		const ExpectedErrorType = InvalidWeaponOperation.ExpectedErrorType;
		const Operation = InvalidWeaponOperation.Operation;
		const strOperationName = InvalidWeaponOperation.OperationName;
		let CaughtError = null;

		try {
			Operation();
		} catch (ErrorValue) {
			CaughtError = ErrorValue;
		}

		if (!(CaughtError instanceof ExpectedErrorType)) {
			throw new Error(`${strOperationName} did not throw ${ExpectedErrorType.name}.`);
		}

		LogInfo("WeaponExpectedError Operation=%s ErrorType=%s Message=%s", strOperationName, CaughtError.name, CaughtError.message);
	}
};

g_VerifyWeaponErrors();
```

Common mistakes:

- treating the `Weapon` object returned by `GetCurrentWeapon()` as a weapon-name string;
- expecting `GetWeaponsByName()` to return only one dropped weapon;
- retaining a scan array as a live entity list;
- writing engine-managed `Free`, `StateFlags`, or `NetworkSerialNumber` instead of using normal engine lifecycle methods;
- assuming one game's tags, property paths, datamaps, or class names exist on every SDK;
- destroying a script `KeyValues` handle owned by the script cache;
- registering a generic filter name that can collide with another component in the same plugin;
- using a stale wrapper after its edict index was reused.

## Related modules

- [`filters/iterator`](filters-iterator.md) documents the generic lazy iterator contract.
- [`weapons/data`](weapons-data.md) owns selected-SDK profile records and tags.
- [`weapons/scripts`](weapons-scripts.md) owns KeyValues-backed weapon-script records.
- [`entities/entity`](entities-entity.md) documents native Entity fields and method families.
- [`entities/props`](entities-props.md) documents send-table discovery and typed access.
- [`entities/datamaps`](entities-datamaps.md) documents datamap discovery and typed access.
- [`entities/factories`](entities-factories.md) documents disposable entity creation.
- [`players/entity`](players-entity.md) provides the direct `Player` factory for constructing references accepted by `GetCurrentWeapon()`.
