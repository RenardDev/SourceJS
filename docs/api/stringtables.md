# `require("stringtables")`

> Warning: this reference is intentionally detailed. Use the contents list to open only the table or
> download-ownership workflow needed for the current task.

`stringtables` exposes the engine's current `INetworkStringTableContainer`, live native table descriptors, string
access and downloadables restoration. Its `Downloadables` sets coordinate shared paths within this package instance
in one plugin context. The native restoration collection is shared and does not reference-count owners across plugins.

String-table entries generally cannot be removed while a table is running. Download untracking changes SourceJS
restoration ownership; it does not erase the already-networked string from the current table.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Native Table Records](#native-table-records)
- [Root Table Operations](#root-table-operations)
- [`StringTable`](#stringtable)
- [`StringTableContainer`](#stringtablecontainer)
- [Downloadable Path Normalization](#downloadable-path-normalization)
- [Direct Download Tracking](#direct-download-tracking)
- [`Downloadables`](#downloadables)
- [Shared Ownership](#shared-ownership)
- [Restore And Shared Singleton](#restore-and-shared-singleton)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	DOWNLOADABLES,
	DOWNLOADABLES_TABLE_NAME,
	Downloadables,
	INVALID_STRING_INDEX,
	INVALID_STRING_TABLE,
	STRING_TABLES,
	StringTable,
	StringTableContainer,
	AddString,
	AddDownloadable,
	AddDownloadableDirectory,
	HasDownloadable,
	GetDownloadableIndex,
	GetDownloadablesList,
	RestoreDownloadables,
	GetDownloadablesTable,
	GetTrackedDownloadables,
	UntrackDownloadable,
	UntrackDownloadableDirectory,
	Find,
	GetRequiredString,
	GetString,
	GetStringUserData,
	SetStringUserData,
	GetAll,
} = require("stringtables");
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `INVALID_STRING_TABLE` | Number | Missing table sentinel, `-1`. |
| `INVALID_STRING_INDEX` | Number | Missing string sentinel, `-1`. |
| `DOWNLOADABLES_TABLE_NAME` | String | Native downloadables table name, `"downloadables"`. |
| `STRING_TABLES` | `StringTableContainer` | Shared high-level table container. |
| `DOWNLOADABLES` | `Downloadables` | Shared package-owned path set for this plugin context. |
| [`StringTable`](#stringtable) | Class | Live wrapper around one native table descriptor. |
| [`StringTableContainer`](#stringtablecontainer) | Class | Stateless table discovery and forwarding facade. |
| [`Downloadables`](#downloadables) | Class | Set-compatible plugin path owner with restoration. |
| `GetAll()` | Function | Returns a fresh array of current native descriptors. |
| `Find(strTableName)` | Function | Returns the current native descriptor or `null`. |
| `GetString(TableValue, nStringIndex)` | Function | Returns the current string or `null`. |
| `GetRequiredString(TableValue, unStringIndex)` | Function | Returns the required string or throws. |
| `AddString(TableValue, strStringValue)` | Function | Adds/finds a string and returns its index or `-1`. |
| `GetStringUserData(TableValue, nStringIndex)` | Function | Copies the entry's binary user data into a new `Uint8Array`, or returns `null`. |
| `SetStringUserData(TableValue, nStringIndex, arrBytes)` | Function | Replaces existing binary user data with an equal-length `Uint8Array`; returns whether the write was performed. |
| `GetDownloadablesTable()` | Function | Returns the current native downloadables descriptor. |
| `GetDownloadablesList()` | Function | Returns a fresh current table-entry array. |
| `GetTrackedDownloadables()` | Function | Returns a fresh SourceJS restoration array. |
| `GetDownloadableIndex(strPath)` | Function | Returns the normalized current table index or `-1`. |
| `HasDownloadable(strPath)` | Function | Tests normalized current table membership. |
| `AddDownloadable(strPath)` | Function | Adds and tracks one normalized path; returns its index. |
| `AddDownloadableDirectory(strPath, bRecursive = true)` | Function | Adds physical files and returns their normalized paths. |
| `UntrackDownloadable(strPath)` | Function | Stops restoring one path; returns whether it was tracked. |
| `UntrackDownloadableDirectory(strPath)` | Function | Stops restoring matching directory paths; returns a count. |
| `RestoreDownloadables()` | Function | Re-adds tracked paths and returns the restored count. |

## Native Table Records

`GetAll()`, `Find(strTableName)` and `GetDownloadablesTable()` return native JavaScript objects with native data properties
backed by V8 getter callbacks over the particular borrowed `INetworkStringTable`. These objects are neither field snapshots
nor lookups that retarget to a replacement table. Reflection returns data descriptors with `value`/`writable`, not `get`/`set`.
Obtaining a property descriptor invokes the native getter; its captured `value` is a snapshot.

These enumerable properties are read-only and cannot be deleted. A descriptor borrows its engine-owned table;
neither the descriptor nor a `StringTable` wrapper keeps that table alive. Discard descriptors and wrappers before
the engine destroys or recreates its string tables, and reacquire them afterward. Do not read their properties,
including `Valid`, after teardown: the native getter has no table-generation or stale-address check.

| Field | Type | Purpose |
| --- | --- | --- |
| `Address` | `bigint` | Exact address of the borrowed native table. |
| `Name` | String | Borrowed table name. |
| `ID` | Number | Borrowed table's container ID. |
| `StringCount` | Number | Current number of strings. |
| `MaximumStringCount` | Number | Current table capacity. |

The `TableValue` argument accepted by root get/add functions may be a non-empty table-name string, a `StringTable`, or an
object with a string `Name` field. Each operation reads that name once and passes the checked value to the native call;
an accessor exception propagates unchanged without performing the native operation. Native validation still rejects an empty name.

## Root Table Operations

Both user-data operations run on the game thread and accept an int32 string index. Missing tables,
missing entries and entries without user data return `null` on read and `false` on write.
The SDK does not expose fixed-width table schemas, so the setter also returns `false` for a different
length. It does not create or clear a payload. It rejects invalid arguments, detached buffers and
shared buffers. It copies only the supplied view, including embedded zero bytes. Mutating the input
after a write, or mutating the result of a read, does not modify the table. Only write data for which
you know the table's binary format; changes can replicate to clients.

Use the named imports from `stringtables` below. `Table` is a live table returned by `Find(strTableName)`; continue only if the table exists. The write example is for a plugin-owned entry whose first byte is a flag.

| Use | Example |
| --- | --- |
| Exclude the SDK's invalid table-ID sentinel. | `const bValidTableID = (Table.ID !== INVALID_STRING_TABLE);` |
| Read a detached copy of the entry at verified index `nStringIndex`. | `const arrBytes = GetStringUserData(Table, nStringIndex);` |
| Set the flag only when the entry has a nonempty payload. | `const bWritten = (arrBytes?.length > 0) && SetStringUserData(Table, nStringIndex, arrBytes.map((unValue, unByteIndex) => (unByteIndex === 0) ? 1 : unValue));` |

Adding a string is normally permanent for the current table lifetime.
Use a caller-owned value that the plugin really intends to network:

```js
const {
	INVALID_STRING_INDEX,
	AddString,
	Find,
	GetRequiredString,
	GetString,
	GetAll,
} = require("stringtables");

function InspectAndAddString(strTableName, strValue) {
	const vecTables = GetAll();
	const Table = Find(strTableName);
	if (Table === null) {
		throw new Error(`String table is unavailable: ${strTableName}`);
	}

	const nIndex = AddString(Table, strValue);
	if (nIndex === INVALID_STRING_INDEX) {
		throw new Error(`String could not be added to ${strTableName}: ${strValue}`);
	}

	const vecTableNames = [];
	for (const Entry of vecTables) {
		vecTableNames.push(Entry.Name);
	}

	return {
		Index: nIndex,
		Table,
		RequiredValue: GetRequiredString(strTableName, nIndex),
		Value: GetString(Table, nIndex),
		TableNames: vecTableNames,
	};
}

module.exports = { InspectAndAddString };
```

`GetString(TableValue, nStringIndex)` accepts only a signed 32-bit integral Number, without coercion. It returns `null`
for a missing table, a negative index or an index outside the table; malformed arguments and unavailable native support throw.
`GetRequiredString(TableValue, unStringIndex)` is appropriate when absence is a plugin error and forwards the native exception.

The native `GetString`, `GetRequiredString` and `AddString` operations reject table names that
cannot be encoded as UTF-8 or contain embedded NUL. `AddString` applies the same
check to the value before changing the engine table; an empty value remains
permitted. Required reads accept only a finite, nonnegative integral Number
within the native signed `int` range, without numeric coercion. Missing tables,
out-of-range indices, and null or empty native entries throw for a required read.
Conversion and result-construction failures preserve an existing JavaScript
exception rather than replacing it with an absence result.

## `StringTable`

### Constructor

```text
new StringTable(StringTableValue)
```

A name is resolved immediately and must exist.
A descriptor must be an object with a positive `bigint` `Address`; construction reads that address once, but does not
validate the remaining descriptor fields or acquire native ownership. Subsequent property reads still reach the descriptor.
Constructing from another `StringTable` shares its underlying live native descriptor.

### Properties

| Property | Purpose |
| --- | --- |
| `Address` | Current exact native `bigint` address. |
| `Name` | Current native table name. |
| `ID` | Current table ID. |
| `StringCount` | Current string count. |
| `MaximumStringCount` | Current capacity. |
| `Length` | Current `StringCount`. |
| `Valid` | Tests only `Address !== 0n` and `ID !== INVALID_STRING_TABLE`; not a lifetime, schema or native-capability check. |

### Methods And Iterators

| Method | Result |
| --- | --- |
| `Get(nStringIndex)` | Current string or `null`, using the table's `Name`. |
| `Add(strStringValue)` | Added or existing index, using the table's `Name`. |
| `GetStringUserData(nStringIndex)` | Copies the entry's binary user data, or returns `null`. |
| `SetStringUserData(nStringIndex, arrBytes)` | Replaces an existing payload with an equal-length byte view. |
| `IndexOf(strStringValue)` | First exact string match or `INVALID_STRING_INDEX`; rejects non-string values. |
| `Has(strStringValue)` | Whether the table currently contains the string. |
| `GetKeys()` | Generator of nonnegative indexes; reads `Length` again at each iteration, not a length snapshot. |
| `GetValues()` | Generator of non-null current strings. |
| `GetEntries()` | Generator of current `[unStringIndex, strStringValue]` pairs; `strStringValue` may be `null`, unlike `GetValues()`. |
| `[Symbol.iterator]()` | Same iterator as `GetValues()`. |

```js
const { StringTable } = require("stringtables");

function CollectValues(Iterable) {
	const vecCollectedValues = [];
	for (const Value of Iterable) {
		vecCollectedValues.push(Value);
	}

	return vecCollectedValues;
}

function InspectWrappedTable(strTableName, strValue) {
	const Table = new StringTable(strTableName);
	const SharedWrapper = new StringTable(Table);
	const unInitialLength = Table.Length;
	const nIndex = Table.Add(strValue);

	return {
		HasValue: Table.Has(strValue),
		LengthChanged: Table.Length >= unInitialLength,
		Valid: Table.Valid,
		Index: nIndex,
		IndexOfValue: Table.IndexOf(strValue),
		Address: Table.Address,
		SharedAddress: SharedWrapper.Address,
		Name: Table.Name,
		Length: Table.Length,
		MaximumStringCount: Table.MaximumStringCount,
		Value: Table.Get(nIndex),
		Entries: CollectValues(Table.GetEntries()),
		IteratedValues: CollectValues(Table),
		Keys: CollectValues(Table.GetKeys()),
		Values: CollectValues(Table.GetValues()),
	};
}

module.exports = { InspectWrappedTable };
```

Every property read reaches the retained descriptor. `Get` and `Add` instead resolve the current table by that descriptor's
`Name`, not its `Address`. An add is visible through existing wrappers while their borrowed table remains alive; this is not
permission to reuse a wrapper after table recreation. Discard and reacquire wrappers as described above.

## `StringTableContainer`

`new StringTableContainer()` creates a stateless facade. `STRING_TABLES` is the shared instance.

| Member | Result |
| --- | --- |
| `Length` | Current count obtained by allocating a fresh native-descriptor array and reading its length. |
| `GetAll()` | Fresh `StringTable` wrappers. |
| `GetNames()` | Fresh table-name array. |
| `Find(strTableName)` | `StringTable` or `null`. |
| `FindByID(nTableID)` | Requires a safe-integer Number; returns `StringTable` or `null`, including for an unmatched negative ID. |
| `Has(strTableName)` | Current table membership. |
| `GetString(TableValue, nStringIndex)` | Root optional-get forwarding. |
| `GetRequiredString(TableValue, unStringIndex)` | Root required-get forwarding. |
| `AddString(TableValue, strStringValue)` | Root add forwarding. |
| `GetStringUserData(TableValue, nStringIndex)` | Root binary read forwarding. |
| `SetStringUserData(TableValue, nStringIndex, arrBytes)` | Root binary write forwarding. |
| `GetDownloadables` | Property getter that allocates a current wrapper for `DOWNLOADABLES_TABLE_NAME`, or returns `null`. |
| `[Symbol.iterator]()` | Iterator over a fresh wrapper list. |

```js
const {
	DOWNLOADABLES_TABLE_NAME,
	STRING_TABLES,
	StringTableContainer,
} = require("stringtables");

function InspectStringTableContainer(strValue) {
	const Container = new StringTableContainer();
	const Downloadables = Container.Find(DOWNLOADABLES_TABLE_NAME);
	if (Downloadables === null) {
		throw new Error("The downloadables string table is unavailable.");
	}

	const nIndex = Container.AddString(Downloadables, strValue);
	const vecIteratedTables = [];
	for (const Table of Container) {
		vecIteratedTables.push(Table);
	}

	return {
		ListedTables: Container.GetAll(),
		Names: Container.GetNames(),
		HasDownloadables: Container.Has(DOWNLOADABLES_TABLE_NAME),
		Downloadables: Container.GetDownloadables,
		FoundByID: Container.FindByID(Downloadables.ID),
		SharedDownloads: STRING_TABLES.GetDownloadables,
		Length: Container.Length,
		Index: nIndex,
		RequiredValue: Container.GetRequiredString(Downloadables, nIndex),
		Value: Container.GetString(Downloadables, nIndex),
		IteratedTables: vecIteratedTables,
	};
}

module.exports = { InspectStringTableContainer };
```

Wrapper arrays are fresh, but each wrapper borrows its own native descriptor. The container iterator snapshots the wrapper
list, not table fields. The allocating `Length` and `GetDownloadables` getters retain their established public API names;
do not treat them as allocation-free queries or as lifetime-safe caches.

## Downloadable Path Normalization

The JavaScript facade first requires a string, applies Unicode `trim()`, replaces backslashes with `/`, collapses repeated
slashes and removes the case-insensitive `GAME_ROOT` prefix captured when the module loads, followed by `/`. Leading `./`
and `/` segments are then removed. A usual result is `"materials/sourcejs/logo.vmt"`; trailing slashes and `..` segments are not resolved or rejected.

After this JavaScript normalization, the native path normalizer rejects embedded NUL before its own trimming or filesystem
operations. `GetDownloadableIndex` checks the complete UTF-8 path before lookup;
encoding/NUL failures throw instead of looking up a truncated path.

Native physical-path operations decode UTF-8 independently of the Windows narrow code page. Filesystem-relative results
and enumerated filenames are encoded back to UTF-8; engine-relative paths use `/` separators.

Normalization does not verify that a single file exists or enforce filesystem containment. `AddDownloadableDirectory(strPath, bRecursive = true)`
enumerates physical regular files synchronously on the game thread after facade normalization. Relative directories resolve from the
game root; traversal and symlink paths are not a sandbox. `false` excludes nested files; omission or explicit `undefined` selects the
JavaScript default `true`, while other non-booleans throw. An absent or non-directory path returns an empty array.

## Direct Download Tracking

Direct functions use one native SourceJS tracking collection without per-plugin ownership or reference counts. The controllers below
are suitable only when their paths are exclusively managed: untracking a shared path can remove another plugin's restoration tracking.
For multiple owners within this package instance, use `Downloadables`; it cannot coordinate direct calls or other plugin contexts.

```js
const {
	INVALID_STRING_INDEX,
	AddDownloadable,
	AddDownloadableDirectory,
	HasDownloadable,
	GetDownloadableIndex,
	GetDownloadablesList,
	RestoreDownloadables,
	GetDownloadablesTable,
	GetTrackedDownloadables,
	UntrackDownloadable,
	UntrackDownloadableDirectory,
} = require("stringtables");

function TrackDownloadFile(strPath) {
	const nIndex = AddDownloadable(strPath);
	if (nIndex === INVALID_STRING_INDEX) {
		throw new Error(`Downloadable could not be added: ${strPath}`);
	}

	return {
		Index: nIndex,
		Inspect() {
			const nCurrentIndex = GetDownloadableIndex(strPath);
			const vecCurrentPaths = GetDownloadablesList();
			const vecTrackedPaths = GetTrackedDownloadables();
			let strNormalizedPath = null;
			let bTracked = false;

			if ((nCurrentIndex !== INVALID_STRING_INDEX) && (nCurrentIndex < vecCurrentPaths.length)) {
				strNormalizedPath = vecCurrentPaths[nCurrentIndex];
			}

			if (strNormalizedPath !== null) {
				for (const strTrackedPath of vecTrackedPaths) {
					if (strTrackedPath === strNormalizedPath) {
						bTracked = true;
						break;
					}
				}
			}

			return {
				HasPath: HasDownloadable(strPath),
				Index: nCurrentIndex,
				Listed: strNormalizedPath !== null,
				Path: strNormalizedPath,
				Table: GetDownloadablesTable(),
				Tracked: bTracked,
			};
		},
		Restore() {
			return RestoreDownloadables();
		},
		Dispose() {
			return UntrackDownloadable(strPath);
		},
	};
}

function TrackDownloadDirectory(strDirectory, bRecursive = true) {
	const vecPaths = AddDownloadableDirectory(strDirectory, bRecursive);

	return {
		Paths: vecPaths,
		Dispose() {
			return UntrackDownloadableDirectory(strDirectory);
		},
	};
}

module.exports = {
	TrackDownloadDirectory,
	TrackDownloadFile,
};
```

Untracking does not remove a path from `GetDownloadablesList()` during the current map.
It only removes SourceJS's direct restore ownership.
Avoid untracking a directory that another subsystem expects the direct native tracker to restore.

## `Downloadables`

`Downloadables` extends `Set`. Its values are normalized path strings; native tracking is coordinated across registered
instances in this package instance and isolated plugin context, not across other plugins or direct native-tracker users.
Use `Add`, not inherited `Set.add()` or direct `Set.prototype` mutations: those bypass normalization, native tracking and ownership cleanup.

### Constructor

```text
new Downloadables(vecValues = [])
```

`vecValues` must be an array of strings that remain non-empty after normalization. All paths are normalized before the
first native add. Successful construction registers the owner after all additions; an add failure attempts shared-owner
cleanup and rethrows the original exception if cleanup succeeds. If cleanup also fails, it throws `AggregateError` with
`errors` in construction/cleanup order and `UnreleasedDownloadables` containing the partial owner. That owner remains
registered to protect shared tracking; retain it and retry `Dispose()` after addressing the cleanup failure. No constructor
rollback removes strings already inserted in the engine table, and later native failures can leave partial native effects.

### Methods

| Method | Result |
| --- | --- |
| `Add(strPath)` | Adds/tracks once and returns this set; an already-owned path does not replay native tracking. |
| `delete(strPath)` | Removes local ownership; untracks only when no other registered local set owns the path. A native exception retains the local path for recovery. |
| `has(strPath)` | Tests normalized local ownership. |
| `AddDirectory(strPath, bRecursive = true)` | Adds returned physical files and returns the newly owned count; synchronous and non-transactional. |
| `RemoveDirectory(strPath)` | Removes an exact normalized path or its `/`-bounded descendants; trailing `/` is not stripped. Returns a count on success. |
| `clear()` | Deletes local paths with shared-owner rules; returns `undefined`. Stops on the first exception, retaining failed/unprocessed paths. |
| `Restore()` | Replays local paths and returns this set only if each add returns a nonnegative safe-integer index; failure throws, retaining paths. |
| `Dispose()` | Clears paths, then unregisters the owner and reports whether it was registered. Cleanup failure leaves it registered for retry. |

```js
const { Downloadables } = require("stringtables");

function CreateDownloadOwner(vecInitialPaths = []) {
	const setDownloads = new Downloadables(vecInitialPaths);

	return {
		Downloads: setDownloads,
		Add(strPath) {
			setDownloads.Add(strPath);

			return setDownloads.has(strPath);
		},
		AddDirectory(strDirectory, bRecursive = true) {
			return setDownloads.AddDirectory(strDirectory, bRecursive);
		},
		Remove(strPath) {
			return setDownloads.delete(strPath);
		},
		RemoveDirectory(strDirectory) {
			return setDownloads.RemoveDirectory(strDirectory);
		},
		Restore() {
			return setDownloads.Restore();
		},
		Clear() {
			return setDownloads.clear();
		},
		Dispose() {
			return setDownloads.Dispose();
		},
	};
}

module.exports = { CreateDownloadOwner };
```

Use `clear()` to remove all local ownership.
`RemoveDirectory("")` throws deliberately instead of treating an empty path as every entry.
For descendant removal, pass the directory without a trailing `/`; `"materials/"` is not equivalent to `"materials"`.
`clear()` keeps the owner registered; successful `Dispose()` is terminal for its ownership contract. `Add()`, `AddDirectory()`
and `Restore()` throw before native work on a disposed instance; create a new one instead. Repeated `Dispose()` still returns
`false`. Bulk removal and restoration are not transactional: earlier successful
operations remain committed when a later operation throws. Retained paths permit explicit recovery, not automatic replay or rollback.

## Shared Ownership

Two registered sets in this package instance may own the same path. Native tracking is removed only after the last local set
releases it; this protection does not extend across plugins or to direct-tracking users:

```js
const {
	Downloadables,
	GetTrackedDownloadables,
} = require("stringtables");

function IsDownloadTracked(strPath) {
	const vecTrackedPaths = GetTrackedDownloadables();
	for (const strTrackedPath of vecTrackedPaths) {
		if (strTrackedPath === strPath) {
			return true;
		}
	}

	return false;
}

function ExerciseSharedDownloadOwnership(strPath) {
	const vecOwners = [];
	let Result;
	let bOperationFailed = false;
	let OperationError;

	try {
		const setFirstOwner = new Downloadables();
		vecOwners.push(setFirstOwner);
		const setSecondOwner = new Downloadables();
		vecOwners.push(setSecondOwner);
		setFirstOwner.Add(strPath);
		setSecondOwner.Add(strPath);

		const strNormalizedPath = setFirstOwner.values().next().value;
		if (typeof strNormalizedPath !== "string") {
			throw new Error("The normalized download path is unavailable.");
		}

		const bFirstRemoved = setFirstOwner.delete(strPath);
		const bTrackedAfterFirst = IsDownloadTracked(strNormalizedPath);
		const bSecondStillOwns = setSecondOwner.has(strPath);
		const bRestored = setSecondOwner.Restore() === setSecondOwner;
		const bSecondRemoved = setSecondOwner.delete(strPath);
		const bTrackedAfterSecond = IsDownloadTracked(strNormalizedPath);
		Result = {
			FirstRemoved: bFirstRemoved,
			Restored: bRestored,
			SecondRemoved: bSecondRemoved,
			SecondStillOwns: bSecondStillOwns,
			TrackedAfterFirst: bTrackedAfterFirst,
			TrackedAfterSecond: bTrackedAfterSecond,
		};
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const vecUnreleasedOwners = [];
	for (const setOwner of vecOwners) {
		try {
			setOwner.Dispose();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
			vecUnreleasedOwners.push(setOwner);
		}
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Shared download ownership cleanup failed.");
		Failure.UnreleasedDownloadOwners = vecUnreleasedOwners;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { ExerciseSharedDownloadOwnership };
```

This workflow attempts every acquired owner's cleanup even when another `Dispose()` throws. Successful cleanup preserves any original
operation exception unchanged, including a falsy value. Failed cleanup reports `AggregateError.errors` with the operation error first
when present, followed by cleanup errors in owner order; retain `UnreleasedDownloadOwners` and explicitly retry those owners' `Dispose()`.
An original constructor-cleanup error can additionally carry its own `UnreleasedDownloadables` owner; that nested ownership also needs recovery.

## Restore And Shared Singleton

The first call that reaches download-add setup registers one package-level `server_spawn` listener before the native add.
`AddDownloadable` normalizes its path first; `AddDownloadableDirectory` checks `bRecursive` first but registers before path
normalization. An argument failure before registration does not install a listener. Once registered, it remains even if
later normalization or the native add fails; disposing owners does not unregister it.
On each spawn, the package callback restores the shared native tracking collection first, then replays its registered
`Downloadables` sets. An exception stops that callback before later sets are replayed; it does not roll back earlier additions.

`DOWNLOADABLES` is the shared package-owned set. Do not dispose it. Add only exclusively managed plugin paths and delete those
exact paths during unload. Multiple controllers using the same singleton path do not have separate ownership counts; use separate
`Downloadables` instances when independently releasing shared paths:

```js
const {
	DOWNLOADABLES,
	RestoreDownloadables,
} = require("stringtables");

function CreateSharedDownloadController(strPath) {
	DOWNLOADABLES.Add(strPath);

	return {
		Inspect() {
			return DOWNLOADABLES.has(strPath);
		},
		Restore() {
			const unNativeCount = RestoreDownloadables();
			const bOwnerRestored = DOWNLOADABLES.Restore() === DOWNLOADABLES;

			return { OwnerRestored: bOwnerRestored, NativeCount: unNativeCount };
		},
		Dispose() {
			return DOWNLOADABLES.delete(strPath);
		},
	};
}

module.exports = { CreateSharedDownloadController };
```

`RestoreDownloadables()` and `Downloadables.Restore()` add strings back when a table was recreated.
Neither operation removes stale strings or verifies that the referenced file still exists.

## Errors And Lifecycle

- Call iterator methods such as `GetEntries()`; they are methods, not snapshot properties.
- Pass strings to table add/search methods, signed 32-bit Number indices to optional reads, nonnegative native-int Number indices to required reads, and safe-integer Number IDs to `FindByID`.
- Native descriptors borrow one table without stale-address checks; reacquire them and their wrappers after teardown instead of querying `Valid` on expired memory.
- Do not expect untracking or `Dispose()` to erase a current table entry.
- Dispose every plugin-created `Downloadables` owner during unload, even after `clear()`.
- Do not dispose the shared `DOWNLOADABLES` singleton.
- Retain and explicitly clean up the `UnreleasedDownloadables` owner attached to a constructor-cleanup `AggregateError`.
- Use `clear()` explicitly instead of an empty `RemoveDirectory()` path.
- Register downloadable paths early enough for clients to receive them before use.

Native table capacity and engine failures propagate as JavaScript exceptions or the documented `-1`
sentinel; directory enumeration uses the best-effort rules below. An add can therefore be visible in the engine table even if later plugin setup fails; design initialization
with that irreversible effect in mind.

`Find(strTableName)` and `GetString(TableValue, nStringIndex)` reject a table name containing embedded NUL instead of looking up its
truncated prefix. For `GetAll()`, `Find(strTableName)` and `GetString(TableValue, nStringIndex)`, failed UTF-8 conversion, result allocation
or descriptor/array construction is an error, not a missing table or string. Genuine missing tables and out-of-range
`GetString` indexes still return `null`; a native null string address at an otherwise valid index retains the existing
empty-string result. Use these synchronous engine operations
on the game thread while the current table container and its tables remain alive.

`GetDownloadablesTable()`, `GetDownloadablesList()`, `GetTrackedDownloadables()`
and `GetDownloadableIndex(strPath)` preserve native/JavaScript conversion and
construction errors instead of returning an absence sentinel. Downloadable-list
and tracked-path results use own indexed data properties, so inherited array
setters do not intercept their creation; a failed build never returns a partial
array as a successful result.

The native `HasDownloadable`, `AddDownloadable`, `UntrackDownloadable`,
`UntrackDownloadableDirectory` and `AddDownloadableDirectory` boundaries check
the complete UTF-8 path and reject embedded NUL before normalization or mutation.
Native exceptions and result-allocation failures propagate as errors, not false,
`-1` or an empty success array. Directory addition retains best-effort enumeration:
permission-denied traversal is skipped, entry inspection/relative-path failures
skip that entry, and iterator failures stop that traversal while retaining the
candidates already collected. An absent/non-directory input returns an empty
array when the runtime paths and downloadables table are available. Successful
candidates are sorted and deduplicated before insertion; this is not an all-or-
nothing filesystem snapshot or a transactional engine-table update.

`UntrackDownloadableDirectory` and `RestoreDownloadables` reject a tracking list
larger than the native signed-int maximum before changing tracking state or
restoring entries, so their Number counts cannot overflow. Restoration does not
append to its own tracking list. These engine calls and directory traversal remain
synchronous game-thread operations; asynchronous external-library request options
do not apply to them.

## Related Modules

- [`paths`](paths.md) exposes the game root used during download-path normalization.
- [`filesystem`](filesystem.md) provides plugin-side physical file operations.
- [`events`](events.md) documents the `server_spawn` lifecycle used for restoration.
