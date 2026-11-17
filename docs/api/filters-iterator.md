# `require("filters/iterator")`

> AI navigation: use the contents to locate contracts, examples, ownership, and errors. This hand-maintained reference describes the current `packages/sourcejs/filters/iterator.js` implementation; navigation does not replace a full review when required.

Module index: [SourceJS API Reference](README.md)

`filters/iterator` provides the reusable lazy collection and named-filter machinery used by entity, player, and weapon iterators. It has no engine dependency of its own and exports `IteratorFilter`, `IteratorObject`, and `FromItems`.

## Contents

- [Import](#import)
- [IteratorFilter](#iteratorfilter)
- [FromItems](#fromitems)
- [IteratorObject](#iteratorobject)
- [Named filter lifecycle](#named-filter-lifecycle)
- [Resolution and ownership](#resolution-and-ownership)
- [Errors](#errors)

## Import

```js
const { FromItems, IteratorFilter, IteratorObject } = require("filters/iterator");
```

## `IteratorFilter`

### Constructor

```text
new IteratorFilter(Items = [], Predicate = null)
```

The constructor stores the selected `Items` reference and validates the optional `Predicate` immediately. Omitted or `undefined` `Items` use a new empty array; an omitted or `undefined` predicate uses `null`. It does not normalize or validate the source until a terminal operation resolves it.

`Items` may be:

- an array or another iterable;
- a non-iterable plain object whose prototype is the current realm's `Object.prototype` or `null`, resolved through `Object.values`;
- a function that returns one of those sources each time the filter resolves; it receives no arguments and is called with the filter as `this`;
- `null` or `undefined`, which resolves to an empty collection.

`Predicate` must be a function or `null`. Each resolution validates the current predicate before invoking the source. It invokes a source function once, without recursively invoking or awaiting its result. Arrays are copied with `slice`, preserving holes; other iterables are consumed with `Array.from`. Iterable handling takes precedence over plain-object handling. Resolution copies the outer collection but retains references to its values.

### Fields

| Field | Meaning |
| --- | --- |
| `IteratorItems` | Mutable source value or source function, read on each resolution. |
| `IteratorPredicate` | Mutable function or `null`, applied after source normalization. |

### Methods

| Member | Behavior |
| --- | --- |
| `Resolve()` | Resolves the source now and returns a new filtered array. |
| `Values()` | Performs an equivalent current resolution with its own new array. |
| `ToArray()` | Performs an equivalent current resolution with its own new array. |
| `Count()` | Resolves now and returns the array length. |
| `First()` | Resolves now and returns the value at index zero, or `null` if that value is nullish or the array is empty. It does not search for a later non-nullish value. |
| `Filter(Predicate)` | Validates the callback immediately and returns a new lazy `IteratorFilter` over this filter's future resolutions. |
| `Map(Callback)` | Resolves now and returns `Array.prototype.map` output. |
| `ForEach(Callback)` | Resolves now, invokes the callback, and returns this filter. |
| `[Symbol.iterator]()` | Resolves now for spread and `for...of`. |

`Predicate`, `Filter`, `Map`, and `ForEach` callbacks use the corresponding Array method's `(Item, unIndex, vecItems)` arguments without binding a receiver. Source functions are the exception: they receive the filter as `this`. Named registry callbacks, described below, receive only `Item`.

`Filter`, `Map`, and `ForEach` validate their callback before resolving a source. An invalid callback therefore cannot trigger a source function, even though successful `Map` and `ForEach` calls resolve immediately.

All operations are synchronous. A source promise is not awaited and is not a supported collection. A promise returned by a predicate is truthy rather than an asynchronous decision; `Map` retains callback results, including promises, and `ForEach` does not await them. Use synchronous callbacks.

A function source makes a filter a live view over plugin-owned state:

```js
const { IteratorFilter } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_InspectPendingJobs = () => {
	const mapJobRecords = new Map([
		["MessageOfTheDay", { JobDone: false, JobName: "MessageOfTheDay", JobPriority: 1 }],
		["Statistics", { JobDone: true, JobName: "Statistics", JobPriority: 2 }],
	]);
	const vecVisitedJobNames = [];
	const GetJobValues = () => mapJobRecords.values();
	const IsPendingJob = (Job) => !Job.JobDone;
	const RecordVisitedJob = (Job) => vecVisitedJobNames.push(Job.JobName);
	const GetJobName = (Job) => Job.JobName;
	const PendingJobFilter = new IteratorFilter(GetJobValues, IsPendingJob);
	if (PendingJobFilter.ForEach(RecordVisitedJob) !== PendingJobFilter) {
		throw new Error("ForEach did not return the source filter.");
	}

	const FirstPendingJob = PendingJobFilter.First();
	const unInitialPendingJobCount = PendingJobFilter.Count();
	const vecPendingJobNames = PendingJobFilter.Map(GetJobName);
	const vecResolvedPendingJobs = PendingJobFilter.Resolve();
	const vecIteratorValues = PendingJobFilter.Values();
	const vecCopiedIteratorValues = PendingJobFilter.ToArray();
	const vecSpreadPendingJobs = [...PendingJobFilter];
	const strFirstPendingJobName = (FirstPendingJob === null) ? null : FirstPendingJob.JobName;

	mapJobRecords.set("Cleanup", { JobDone: false, JobName: "Cleanup", JobPriority: 3 });

	LogInfo("IteratorJobs %s", JSON.stringify({
		CopiedIteratorValues: vecCopiedIteratorValues,
		FirstPendingJobName: strFirstPendingJobName,
		InitialPendingJobCount: unInitialPendingJobCount,
		PendingJobNames: vecPendingJobNames,
		ResolvedPendingJobs: vecResolvedPendingJobs,
		SpreadPendingJobs: vecSpreadPendingJobs,
		UpdatedPendingJobCount: PendingJobFilter.Count(),
		IteratorValues: vecIteratorValues,
		VisitedJobNames: vecVisitedJobNames,
	}));
};

g_InspectPendingJobs();
```

Object and iterable sources are normalized explicitly:

```js
const { IteratorFilter } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_InspectNormalizedSources = () => {
	const NamedValueFilter = new IteratorFilter({ PrimaryValue: 10, SecondaryValue: 20 });
	const UniqueValueFilter = new IteratorFilter(new Set([10, 20, 20]));
	const EmptyValueFilter = new IteratorFilter(null);
	LogInfo("IteratorSources %s", JSON.stringify({ NamedValues: NamedValueFilter.ToArray(), UniqueValues: UniqueValueFilter.ToArray(), EmptyValues: EmptyValueFilter.ToArray() }));
};

g_InspectNormalizedSources();
```

`Filter()` remains lazy, while `Map()` returns an immediate array:

```js
const { FromItems } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_InspectLazyFilter = () => {
	const vecNumericValues = [1, 2, 3, 4];
	const GetNumericValues = () => vecNumericValues;
	const IsEvenValue = (nValue) => (nValue % 2) === 0;
	const MultiplyValueByTen = (nValue) => nValue * 10;
	const EvenValueFilter = FromItems(GetNumericValues).Filter(IsEvenValue);
	LogInfo("IteratorLazy InitialEvenValues=%s", JSON.stringify(EvenValueFilter.ToArray()));

	vecNumericValues.push(6);

	LogInfo("IteratorLazy UpdatedMappedValues=%s", JSON.stringify(EvenValueFilter.Map(MultiplyValueByTen)));
};

g_InspectLazyFilter();
```

## `FromItems`

### Signatures

```text
FromItems(Items, Predicate = null)
```

`FromItems` constructs and returns an `IteratorFilter` without adding another wrapper or snapshot. A scalar number is not a collection and throws when resolved.

This example builds a lazy human-player view over the current native player scan. Every terminal operation scans the current world again:

```js
const { GetAllPlayers } = require("filters");
const { FromItems } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_ListHumanPlayers = () => {
	const IsHumanPlayer = (Player) => !Player.FakeClient;
	const HumanPlayerFilter = FromItems(GetAllPlayers, IsHumanPlayer);
	for (const Player of HumanPlayerFilter) {
		LogInfo("IteratorPlayer Index=%d Name=%s", Player.Index, Player.Name);
	}
};

g_ListHumanPlayers();
```

## `IteratorObject`

### Constructor

```text
new IteratorObject(RequiredFilters = null, ExcludedFilters = null)
```

`IteratorObject` is abstract by convention, not by a constructor restriction: constructing the base class succeeds, but its default `Iterator()` throws when invoked. Subclass it and implement `static Iterator()` with a current iterable source. `Iterate()` calls that method with the subclass as `this` and no arguments. A non-iterable scan source (for example, a plain object without `Symbol.iterator` or a number) is not valid.

Each `RequiredFilters` and `ExcludedFilters` group accepts `null`, `undefined`, one non-empty filter name, or an iterable of non-empty filter names. The constructor copies normalized names and checks that every named filter is currently registered. These arrays remain mutable; their current types and visited names are checked by `IsValid()`.

### Fields

| Field | Meaning |
| --- | --- |
| `RequiredFilterNames` | Copied names that must all return truthy. |
| `ExcludedFilterNames` | Copied names where any truthy result rejects the item. |
| `IteratorItems` | Initially a lazy resolver that scans `Iterate()` and retains items accepted by `IsValid()`. Replacing this field replaces that entire pipeline. |
| `IteratorPredicate` | Initially `null`; assigning a function adds a post-source predicate, separate from the named-filter pipeline. |
| `static Filters` | Class-local Map from names to callbacks, created on first registry use. The property is enumerable, non-configurable, and non-writable; the Map itself remains mutable. |

### Static methods

| Member | Behavior |
| --- | --- |
| `Iterator()` | Current-source method to override; the base implementation throws. |
| `RegisterFilter(strFilterName, Callback)` | Adds one unique non-empty name and returns the callback. |
| `UnregisterFilter(strFilterName)` | Removes an existing name and returns `true`. |
| `HasFilter(strFilterName)` | Tests the class-local Map. |
| `GetFilterNames()` | Returns a new array of current Map keys. |
| `DefaultFilters()` | Returns a null-prototype object with one Set per registered name, each resolved separately through `new this(strFilterName)`. |

### Instance methods

| Member | Behavior |
| --- | --- |
| `Iterate()` | Calls `this.constructor.Iterator()` without materializing it. |
| `GetIteratorFilterCallback(strFilterName)` | Returns an existing class-local callback. |
| `IsValid(Item)` | Returns `false` on the first falsy required result. Only if every required result passes, tests excluded callbacks and returns `false` on the first truthy result; otherwise returns `true`. |

All `IteratorFilter` methods are inherited. While the installed `IteratorItems` resolver remains unchanged, each terminal call scans `Iterate()` again and applies `IsValid()`. Replacing `IteratorItems` bypasses both steps; an assigned `IteratorPredicate` still runs after the replacement source is normalized.

`IsValid()` validates both name-group fields as arrays before invoking any registered callback. A malformed `ExcludedFilterNames` value still throws when a required callback would have rejected the item. After those array checks, only visited names and callbacks are looked up.

For inherited `DefaultFilters()` to work, a subclass constructor must accept a required-filter group as its first argument. A subclass with a different constructor contract must override that method. Each registered name gets its own resolution, not a shared world snapshot.

## Named filter lifecycle

This complete subclass demonstrates registry and instance methods with plugin-owned client fixture records. It does not inspect connected engine clients:

```js
const { IteratorObject } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_InspectClientFilters = () => {
	const vecClients = [
		{ Connected: true, ClientIndex: 1, Bot: false },
		{ Connected: true, ClientIndex: 2, Bot: true },
		{ Connected: false, ClientIndex: 3, Bot: false },
	];
	const vecRegisteredIteratorFilterNames = [];
	const vecFailures = [];
	const IsConnectedClient = (Client) => Client.Connected;
	const IsBotClient = (Client) => Client.Bot;
	const GetClientIndex = (Client) => Client.ClientIndex;

	class ClientIterator extends IteratorObject {
		static Iterator() {
			return vecClients;
		}
	}

	try {
		const RegisteredConnectedClientFilter = ClientIterator.RegisterFilter("ConnectedClient", IsConnectedClient);
		vecRegisteredIteratorFilterNames.push("ConnectedClient");

		const RegisteredBotClientFilter = ClientIterator.RegisterFilter("BotClient", IsBotClient);
		vecRegisteredIteratorFilterNames.push("BotClient");

		if ((RegisteredConnectedClientFilter !== IsConnectedClient) || (RegisteredBotClientFilter !== IsBotClient)) {
			throw new Error("ClientIterator did not retain the registered callbacks.");
		}

		const HumanClientIterator = new ClientIterator("ConnectedClient", "BotClient");
		const ConnectedClientFilterCallback = HumanClientIterator.GetIteratorFilterCallback("ConnectedClient");
		const vecCurrentClients = ClientIterator.Iterator();
		const bFirstClientValid = HumanClientIterator.IsValid(vecCurrentClients[0]);
		const DefaultIteratorFilters = ClientIterator.DefaultFilters();
		LogInfo("IteratorClients %s", JSON.stringify({
			ConnectedClientIndexes: [...DefaultIteratorFilters.ConnectedClient].map(GetClientIndex),
			ConnectedClientFilterResult: ConnectedClientFilterCallback(vecClients[0]),
			IteratorFilterNames: ClientIterator.GetFilterNames(),
			FirstClientValid: bFirstClientValid,
			HasConnectedClientFilter: ClientIterator.HasFilter("ConnectedClient"),
			HumanClientIndexes: HumanClientIterator.ToArray().map(GetClientIndex),
		}));
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		for (const strIteratorFilterName of vecRegisteredIteratorFilterNames.reverse()) {
			try {
				if (!ClientIterator.UnregisterFilter(strIteratorFilterName) || ClientIterator.HasFilter(strIteratorFilterName)) {
					throw new Error(`Failed to remove filter: ${strIteratorFilterName}.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Client filtering and registered-filter cleanup failed.");
	}
};

g_InspectClientFilters();
```

The example attempts every recorded cleanup in reverse registration order, preserving thrown values without reading a presumed `.message`. A sole failure is rethrown unchanged; simultaneous failures become an `AggregateError` with the operation failure first, followed by cleanup failures in attempt order. A failed cleanup does not prove removal.

Registry methods create an own `Filters` Map on first use by each subclass. Before that first use, a direct static property read can see an inherited parent's Map; do not mutate it as if it already belonged to the child. The new own Map starts empty, rather than copying parent registrations. Register filters during plugin load and unregister them during unload when the class can outlive the registration owner.

## Resolution and ownership

- Every terminal method (`Resolve`, `Values`, `ToArray`, `Count`, `First`, `Map`, `ForEach`, and iteration) resolves independently. Single-use iterators and generators are consumed, not rewound; return a fresh iterable from a source function when repeated scans are needed.
- `Filter()` captures its parent and the validated callback; it does not freeze the parent's current array. Later changes to the parent's source or predicate affect the derived filter.
- Arrays returned by terminal resolution methods and Sets from `DefaultFilters()` are new outer containers. Changing their outer structure does not change the source; changing a shared object inside them can. Raw `Iterator()` and `Iterate()` may instead return the original borrowed collection without copying it.
- Objects inside a resolved collection retain their original identity and ownership. Resolving does not extend the lifetime of native resources referenced by those objects.
- `DefaultFilters()` can be expensive because it performs one complete resolution per registered name.
- Removing a filter after construction causes a `ReferenceError` when resolution actually looks up that name. An empty source or earlier rejection can prevent that lookup: required callbacks stop on falsy results and excluded callbacks stop on truthy results.

## Errors

The module throws for:

- a predicate other than a function or `null`, or a non-function `Filter`, `Map`, or `ForEach` callback;
- an `IteratorItems` source that resolves to a non-iterable, non-plain value other than `null`/`undefined`;
- empty or non-string filter names, duplicate registrations, missing removals/lookups, and unknown required/excluded filters;
- direct use of the base `IteratorObject.Iterator()`;
- a subclass whose `Iterator()` does not return an iterable.

```js
const { IteratorFilter, IteratorObject } = require("filters/iterator");
const { LogInfo } = require("loggers");

const g_InspectIteratorErrors = () => {
	class EmptyIterator extends IteratorObject {
		static Iterator() {
			return [];
		}
	}

	let bNonCollectionRejected = false;
	try {
		new IteratorFilter(42).ToArray();
	} catch (TypeErrorValue) {
		if (!(TypeErrorValue instanceof TypeError)) {
			throw TypeErrorValue;
		}

		bNonCollectionRejected = true;
		LogInfo("IteratorValidation Error=%s", TypeErrorValue.message);
	}

	if (!bNonCollectionRejected) {
		throw new Error("A scalar source was accepted as a collection.");
	}

	let bUnknownFilterRejected = false;
	try {
		new EmptyIterator("Missing");
	} catch (ReferenceErrorValue) {
		if (!(ReferenceErrorValue instanceof ReferenceError)) {
			throw ReferenceErrorValue;
		}

		bUnknownFilterRejected = true;
		LogInfo("IteratorValidation Error=%s", ReferenceErrorValue.message);
	}

	if (!bUnknownFilterRejected) {
		throw new Error("An unknown required filter was accepted.");
	}
};

g_InspectIteratorErrors();
```
