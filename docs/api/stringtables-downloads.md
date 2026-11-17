# `require("stringtables/downloads")`

> Warning: this is the raw native downloadables module. Its restore tracking is process-wide SourceJS state, not
> per-plugin ownership. Use [`require("stringtables")`](stringtables.md) when a plugin needs managed restoration and
> last-owner cleanup.

`stringtables/downloads` exposes the current engine `downloadables` table and SourceJS's native restore-tracking vector.
The package returns the installed native module object by identity; it does not copy functions, add aliases or provide
a fallback implementation.

## Contents

- [Import](#import)
- [Identity And Native State](#identity-and-native-state)
- [Exports](#exports)
- [Live Table Record](#live-table-record)
- [Path Normalization](#path-normalization)
- [Track A File](#track-a-file)
- [Track A Directory](#track-a-directory)
- [Restore Tracked Paths](#restore-tracked-paths)
- [Global Ownership And Lifecycle](#global-ownership-and-lifecycle)
- [Errors](#errors)
- [Related Modules](#related-modules)

## Import

```js
const {
	DOWNLOADABLES_TABLE_NAME,
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
} = require("stringtables/downloads");
```

## Identity And Native State

`require("stringtables/downloads")` returns the exact object installed at `sourcejs["stringtables/downloads"]`.
Loading it does not load the managed root `stringtables` package and therefore does not register a `server_spawn`
listener.

The current implementation exports `DOWNLOADABLES_TABLE_NAME` as the literal string `"downloadables"`.
Table strings and the native restore vector are shared runtime state. Arrays returned to JavaScript are copies, but
later native calls still observe and modify their underlying engine/vector state.

## Exports

| Export | Result |
| --- | --- |
| `DOWNLOADABLES_TABLE_NAME` | Native table name, `"downloadables"`. |
| `GetDownloadablesTable()` | Current table record with live V8 accessors. |
| `GetDownloadablesList()` | Fresh array of every current table string. |
| `GetTrackedDownloadables()` | Fresh array of SourceJS's native restore vector. |
| `GetDownloadableIndex(strDownloadableFilePath)` | Current normalized table index or `-1`. |
| `HasDownloadable(strDownloadableFilePath)` | Whether the normalized path is in the current table. |
| `AddDownloadable(strDownloadableFilePath)` | Finds/adds and tracks one path; returns its index or `-1`. |
| `AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal = true)` | Adds enumerated regular files and returns the paths successfully tracked. |
| `UntrackDownloadable(strDownloadableFilePath)` | Removes one exact normalized restore entry and reports whether it existed. |
| `UntrackDownloadableDirectory(strDownloadableDirectoryPath)` | Removes an exact directory entry and descendants; returns the removed count. |
| `RestoreDownloadables()` | Finds/adds every tracked path; returns the number of successful paths. |

## Live Table Record

`GetDownloadablesTable()` requires the current table to exist and returns an object with these enumerable, read-only,
non-configurable native data properties. V8 getter callbacks keep ordinary property reads live. Reflection returns data
descriptors with `value` and `writable`, not JavaScript `get`/`set` functions; the descriptor's captured `value` is a
snapshot, not a live view. Reading a descriptor also accesses the borrowed native table.

| Field | Type | Purpose |
| --- | --- | --- |
| `Address` | `bigint` | Exact address of the borrowed `INetworkStringTable` object. |
| `Name` | String | Current table name. |
| `ID` | Number | Borrowed table's container ID. |
| `StringCount` | Number | Current number of table strings. |
| `MaximumStringCount` | Number | Current table capacity. |

The record borrows the specific native table object resolved at creation. Its getters observe that object's current fields;
they do not resolve the table again by name or retarget after engine recreation. Do not retain or use the record or its
address across table destruction/recreation. Obtain a fresh record for the new table; stale access is not guaranteed to throw safely.

This workflow returns one borrowed record plus independent snapshot values and arrays:

```js
const {
	DOWNLOADABLES_TABLE_NAME,
	GetDownloadablesList,
	GetDownloadablesTable,
	GetTrackedDownloadables,
} = require("stringtables/downloads");

function InspectNativeDownloadTable() {
	const Table = GetDownloadablesTable();

	return {
		Entries: GetDownloadablesList(),
		NameMatches: Table.Name === DOWNLOADABLES_TABLE_NAME,
		ID: Table.ID,
		Table,
		Address: Table.Address,
		Name: Table.Name,
		MaximumStringCount: Table.MaximumStringCount,
		StringCount: Table.StringCount,
		Tracked: GetTrackedDownloadables(),
	};
}

module.exports = { InspectNativeDownloadTable };
```

Mutating an array returned by `GetDownloadablesList()` or `GetTrackedDownloadables()` does not mutate native state.
Call the matching native add/untrack operation instead.

## Path Normalization

Single-path lookup, add and untrack functions, plus `UntrackDownloadableDirectory()`, require a non-empty string and apply
this native normalization:

1. Trims leading and trailing bytes classified as whitespace by native `std::isspace` in the current C locale; this is not JavaScript's Unicode `trim()` contract.
2. Replaces `\` with `/`.
3. Attempts to convert an absolute path to a path relative to the game root when runtime paths are available. If filesystem relativization reports an error, the original path spelling remains for the following steps.
4. Removes repeated leading `./` segments.
5. Removes leading `/` or `\` separators.

The raw module deliberately does not apply the root package's stronger slash normalization. It does not collapse
internal `//`, remove a trailing `/`, reject `..` segments or verify a single-file path. Pass canonical engine-relative
paths when possible. An absolute path outside the game root can normalize to a relative path containing `..`. Embedded NUL
characters are rejected before lookup, tracking, or enumeration instead of truncating the path. Other UTF-8 conversion failures also throw.

`AddDownloadableDirectory()` instead trims its required non-empty string and interprets it as a platform
`std::filesystem::path` decoded from UTF-8, independently of the Windows narrow code page. Absolute single-path inputs
use the same UTF-8 decoding; relative paths and enumerated native filenames are encoded back to UTF-8 for the engine.
It resolves relative directories below the game root and applies `lexically_normal()` before
enumeration. Returned file paths are then relative to the game root and pass through the normalization above. Table
lookup follows the selected engine's string-table behavior, including its case handling.

Directory enumeration is not a filesystem sandbox: absolute paths, parent segments, and symlinks can refer outside the game root.
Regular-file symlinks are inspected as files; recursive enumeration does not request traversal of directory symlinks.
Use trusted, canonical directory inputs. On platforms where `\` is not a native directory separator, directory enumeration
does not treat it like the single-path normalizer does.

## Track A File

`AddDownloadable()` first searches the current table. It adds a missing string, then stores one unique normalized path in
the global restore vector. Existing table entries can therefore become tracked without increasing `StringCount`.

The following controller exposes the current table spelling through a live getter and releases its raw tracking entry:

```js
const {
	AddDownloadable,
	HasDownloadable,
	GetDownloadableIndex,
	GetDownloadablesList,
	RestoreDownloadables,
	GetTrackedDownloadables,
	UntrackDownloadable,
} = require("stringtables/downloads");

function CreateNativeDownloadFileController(strPath) {
	const nIndex = AddDownloadable(strPath);
	if (nIndex < 0) {
		throw new Error(`Downloadable could not be added: ${strPath}`);
	}

	function ReadCurrentEntry() {
		const nCurrentIndex = GetDownloadableIndex(strPath);
		let strStoredPath = null;
		if (nCurrentIndex >= 0) {
			const vecCurrentPaths = GetDownloadablesList();
			if (nCurrentIndex >= vecCurrentPaths.length) {
				throw new Error(`Downloadable index is unavailable: ${nCurrentIndex}`);
			}

			strStoredPath = vecCurrentPaths[nCurrentIndex];
		}

		return { Index: nCurrentIndex, Path: strStoredPath };
	}

	return {
		Index: nIndex,
		get Path() {
			return ReadCurrentEntry().Path;
		},
		Inspect() {
			const Entry = ReadCurrentEntry();
			const vecTrackedPaths = GetTrackedDownloadables();
			let bTracked = false;
			if (Entry.Path !== null) {
				for (const strTrackedPath of vecTrackedPaths) {
					if (strTrackedPath === Entry.Path) {
						bTracked = true;
						break;
					}
				}
			}

			return {
				HasPath: HasDownloadable(strPath),
				Index: Entry.Index,
				Listed: Entry.Path !== null,
				Path: Entry.Path,
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

module.exports = { CreateNativeDownloadFileController };
```

`Dispose()` does not erase the path from the current engine table. Because the tracking vector has no owner metadata,
it can also remove tracking established by another plugin for the same path.

## Track A Directory

`AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal)` resolves a relative directory below the game root, walks regular files
and adds each path relative to the game root. `bRecursiveTraversal` defaults to `true` only when omitted and must be a Boolean when supplied;
explicit `undefined` is not an omitted argument. Enumeration is synchronous and may block the game thread.

An absent or non-directory path returns an empty array. Permission and iterator errors are handled with
`std::error_code`; enumeration may therefore return a partial array instead of throwing. Successfully enumerated paths
are sorted lexicographically before they are added and returned.

```js
const {
	AddDownloadableDirectory,
	HasDownloadable,
	RestoreDownloadables,
	GetTrackedDownloadables,
	UntrackDownloadableDirectory,
} = require("stringtables/downloads");

function IsTrackedPath(vecTrackedPaths, strPath) {
	for (const strTrackedPath of vecTrackedPaths) {
		if (strTrackedPath === strPath) {
			return true;
		}
	}

	return false;
}

function CreateNativeDownloadDirectoryController(strDirectory, bRecursive = true) {
	const vecPaths = AddDownloadableDirectory(strDirectory, bRecursive);

	return {
		Paths: vecPaths,
		Inspect() {
			const vecTrackedPaths = GetTrackedDownloadables();
			const vecInspections = [];
			for (const strPath of vecPaths) {
				vecInspections.push({ HasPath: HasDownloadable(strPath), Path: strPath, Tracked: IsTrackedPath(vecTrackedPaths, strPath) });
			}

			return vecInspections;
		},
		Restore() {
			return RestoreDownloadables();
		},
		Dispose() {
			return UntrackDownloadableDirectory(strDirectory);
		},
	};
}

module.exports = { CreateNativeDownloadDirectoryController };
```

`UntrackDownloadableDirectory()` matches the normalized directory itself or a descendant separated by `/`. A sibling such
as `materials/sourcejs-old` does not match `materials/sourcejs`. The operation removes every matching raw tracking
entry, including entries added by other callers, so use it only for an exclusively owned directory namespace. Pass the canonical
directory spelling without a trailing slash; the raw normalizer does not remove it before checking the descendant boundary.

The controller's `Paths` array is a mutable local result, not native ownership metadata. Changing it changes the example's
inspection inventory but does not change table strings, tracking, or the directory-wide scope of `Dispose()`.

## Restore Tracked Paths

`RestoreDownloadables()` requires the current table and visits every path in the global tracking vector. Its result counts
successful paths, including paths already present; it is not the number of newly inserted strings.

```js
const {
	GetDownloadablesList,
	RestoreDownloadables,
	GetTrackedDownloadables,
} = require("stringtables/downloads");

function RestoreNativeDownloads() {
	const vecTrackedBefore = GetTrackedDownloadables();
	const unRestoredCount = RestoreDownloadables();

	return {
		TableEntries: GetDownloadablesList(),
		TrackedAfter: GetTrackedDownloadables(),
		TrackedBefore: vecTrackedBefore,
		RestoredCount: unRestoredCount,
	};
}

module.exports = { RestoreNativeDownloads };
```

The raw module installs no lifecycle callback. Call restoration from an appropriate engine event only when managing
the global vector directly. Requiring the root `stringtables` package provides managed `server_spawn` restoration.

## Global Ownership And Lifecycle

- The native restore vector is shared across SourceJS plugin contexts.
- Repeated `AddDownloadable(strDownloadableFilePath)` calls create one vector entry, not reference-counted ownership.
- One `UntrackDownloadable(strDownloadableFilePath)` removes that entry regardless of which plugin added it first.
- `UntrackDownloadableDirectory()` has the same global effect for a directory boundary.
- Plugin unload does not make raw ownership safe automatically; release only paths whose global ownership policy is known.
- Current string-table entries generally cannot be removed until the engine recreates the table.
- Native calls and borrowed table records are game-thread APIs, not values to use in request worker threads.
- Discard borrowed records at table recreation and call `GetDownloadablesTable()` again; owning a JavaScript wrapper does not keep its native table alive.

For ordinary plugin code, prefer `Downloadables` from the root module. Its live sets coordinate last-owner cleanup only
inside one isolated plugin context; they do not reference-count paths across separate plugins. The raw module remains
available for runtime-level integrations that intentionally own the process-wide native vector.

## Errors

- `GetDownloadablesTable()`, `GetDownloadablesList()`, `GetDownloadableIndex(strDownloadableFilePath)`, `HasDownloadable(strDownloadableFilePath)`,
  `AddDownloadable(strDownloadableFilePath)`, `AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal)` and `RestoreDownloadables()` throw when
  the downloadables table is unavailable.
- `AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal)` also throws when runtime paths are unavailable.
- Missing, non-string, NUL-containing or normalized-empty single paths throw; `AddDownloadableDirectory(strDownloadableDirectoryPath, bRecursiveTraversal)` also rejects an empty or
  whitespace-only directory string.
- A supplied non-Boolean `bRecursiveTraversal` value throws, including `undefined` and boxed Boolean objects.
- `AddDownloadable(strDownloadableFilePath)` returns `-1` when the engine cannot find or add the table string, including a capacity failure.
- `UntrackDownloadable(strDownloadableFilePath)` and `UntrackDownloadableDirectory(strDownloadableDirectoryPath)` operate on the restore vector and do not
  require the current engine table.

Native failures are translated into operation-specific JavaScript errors without replacing an already pending JavaScript error
or termination. Adding, directory enumeration, restoration, and untracking are not rollback transactions: an error after an engine
insertion, tracking change, or earlier path can leave that work applied even when no result array/count is returned. Reinspect state
before choosing recovery; do not assume an exception means no mutation occurred.

## Related Modules

- [`stringtables`](stringtables.md) provides normalized paths, managed restoration and `Downloadables` owner sets.
- [`paths`](paths.md) exposes the game root used for absolute-path relativization.
- [`events`](events.md) documents lifecycle events suitable for explicit restoration.
