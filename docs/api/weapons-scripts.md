# `require("weapons/scripts")`

> AI navigation: check name/path rules and cache ownership first, then use the requested-script or catalog workflow.
> Cache refresh affects all records, and cleanup failures can leave a partially invalid cache.

> Warning: `ClearCache()` attempts to destroy every cached native `KeyValues` root; false results are ignored and thrown
> errors stop cleanup. Stop all consumers before clearing the cache and never use an old root afterward.

`weapons/scripts` loads Valve weapon-script files from `<GAME_ROOT>/scripts/weapon_<name>.txt` through the selected SDK's
native `KeyValues` implementation. It caches one owning record per normalized class name inside the current plugin
context and can discover scripts for weapon classes currently present in the world.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Name and Path Rules](#name-and-path-rules)
- [Script Record](#script-record)
- [Cache and Filesystem Semantics](#cache-and-filesystem-semantics)
- [Inspect a Requested Script](#inspect-a-requested-script)
- [Load a Native Script Record](#load-a-native-script-record)
- [Verify Cache Identity](#verify-cache-identity)
- [Build a Current-World Script Catalog](#build-a-current-world-script-catalog)
- [Refresh the Cache Deliberately](#refresh-the-cache-deliberately)
- [Ownership and Lifetime](#ownership-and-lifetime)
- [Errors and Partial Cleanup](#errors-and-partial-cleanup)
- [Related Modules](#related-modules)

## Import

```js
const {
	GetAll,
	GetClasses,
	ClearCache,
	Has,
	Load,
	GetNames,
	GetScriptPath,
} = require("weapons/scripts");
```

## Exports

| Export | Result |
| --- | --- |
| `GetScriptPath(strWeaponScriptName)` | Returns the normalized absolute path without checking the filesystem. |
| `Has(strWeaponScriptName)` | Checks whether the normalized path exists now. |
| `Load(strWeaponScriptName)` | Returns the cached owning record or loads and caches an existing script through native `KeyValues`. |
| `GetAll()` | Returns cached or newly loaded records for current native classes whose files exist now. |
| `GetClasses()` | Direct native function returning distinct current live weapon class names. |
| `GetNames()` | Direct native function returning distinct current live weapon short names. |
| `ClearCache()` | Attempts to destroy cached roots, clears the cache and returns `true` if no destroy call throws; false results are ignored. |

`GetClasses` and `GetNames` preserve the exact native function identities. Importing the module obtains those callbacks and
its dependencies but performs no edict scan, filesystem check, `KeyValues` load or native root destruction.

Calls are synchronous in the plugin's game-thread context. Native scans, file checks and `KeyValues` file loads can
block that thread; this module does not use the asynchronous network/database request contract.

## Name and Path Rules

Every name-taking operation uses the same normalization:

1. Require a non-empty JavaScript string.
2. Trim surrounding whitespace and lowercase it.
3. Preserve one existing `weapon_` prefix or prepend it.
4. Require the complete class name to match `^weapon_[a-z0-9_]+$`.

The resulting path uses the imported `GAME_ROOT` followed by `/scripts/<weapon-class-name>.txt`, with backslashes converted
to forward slashes and repeated slashes collapsed, except for the leading `//` of a UNC root. The accepted character set excludes path separators, dots, drive
markers, and traversal components.
`GetScriptPath()` does not resolve symlinks or prove that the path exists.

## Script Record

`Load()` and `GetAll()` return records with this exact shape:

| Field | Result |
| --- | --- |
| `ClassName` | Canonical full class name, such as `weapon_rifle`. |
| `KeyValues` | Owning native `KeyValues` root parsed from `Path`. |
| `Name` | Canonical short name, such as `rifle`. |
| `Path` | Normalized absolute script path. |

The cache returns the same record object for one entry. The record is an ordinary mutable JavaScript object, but treat
its metadata and `KeyValues` field as implementation-managed. Changing fields does not rename the cache key or move the
source file. Replacing `KeyValues` changes the target of later cleanup and can orphan the originally owned root; no
validation or ownership transfer protects such replacement. Root identity is stable only while that field is unchanged.

## Cache and Filesystem Semantics

`Has()` always calls the filesystem API. `Load()` behaves differently:

- It normalizes the name and returns an existing cached record immediately, without checking whether the file still
  exists or changed.
- On a cache miss, it builds the path, checks existence and loads it through `KeyValues.CreateKeyValuesFromFile()`.
- The cache entry is installed only after `CreateKeyValuesFromFile()` succeeds and the record has been created.
- `Load()` does not reload an edited cache entry. A non-throwing `ClearCache()` removes entries so the next load can read
  the file again.

`GetAll()` calls the native `GetClasses()` scan, then calls `Has(strWeaponClassName)` before
`Load(strWeaponClassName)` for each current class.
A file missing at its `Has()` check is therefore excluded even if an old record for that class remains cached. An edited existing file is
included but still uses its cached root until the cache is cleared.

## Inspect a Requested Script

Accept a weapon script name from the caller instead of selecting an arbitrary live class. This function distinguishes
path construction from current filesystem availability.

```js
const { Has, GetScriptPath } = require("weapons/scripts");

function InspectWeaponScript(strWeaponScriptName) {
	return { Exists: Has(strWeaponScriptName), WeaponScriptFilePath: GetScriptPath(strWeaponScriptName) };
}

module.exports = { InspectWeaponScript };
```

The filesystem can change between the two calls. Treat the pair as a report, not an atomic guarantee that a later
`Load()` will succeed.

## Load a Native Script Record

The cached record owns a native `KeyValues` root. Its methods read and edit that same root until `ClearCache()`
destroys it.

```js
const { Load } = require("weapons/scripts");

function ReadWeaponScript(strWeaponScriptName) {
	const WeaponScriptRecord = Load(strWeaponScriptName);

	return { WeaponClassName: WeaponScriptRecord.ClassName, Damage: WeaponScriptRecord.KeyValues.GetKeyValuesInteger("Damage", 0), KeyValues: WeaponScriptRecord.KeyValues, WeaponName: WeaponScriptRecord.Name, WeaponScriptFilePath: WeaponScriptRecord.Path };
}

module.exports = { ReadWeaponScript };
```

The returned `Damage` is read at call time. `KeyValues` is the live cached root, so its setters update that root.
Call `KeyValues.SaveKeyValuesToFile(WeaponScriptFilePath)` to persist changes. Do not destroy the root
directly because the module owns it.

## Verify Cache Identity

Short, full, uppercase and whitespace-padded names normalize to the same key. Return only identity facts while both
references are valid.

```js
const { Load } = require("weapons/scripts");

function VerifyWeaponScriptCache(strWeaponScriptName) {
	const FirstWeaponScriptRecord = Load(strWeaponScriptName);
	const SecondWeaponScriptRecord = Load(`  ${FirstWeaponScriptRecord.ClassName.toUpperCase()}  `);

	return { WeaponClassName: FirstWeaponScriptRecord.ClassName, RecordShared: FirstWeaponScriptRecord === SecondWeaponScriptRecord, RootShared: FirstWeaponScriptRecord.KeyValues === SecondWeaponScriptRecord.KeyValues };
}

module.exports = { VerifyWeaponScriptCache };
```

This verifies the current entry only, assuming its metadata and root field have not been modified. It does not promise
identity across `ClearCache()`.

## Build a Current-World Script Catalog

`GetAll()` is a current-edict scan filtered by file existence, not a recursive directory listing. Retain each live native
root and read only the scalar fields the catalog needs instead of cloning the complete tree.

```js
const { GetAll, GetClasses, GetNames } = require("weapons/scripts");

function BuildCurrentWeaponScriptCatalog() {
	const vecWeaponScriptRecords = GetAll();
	const vecWeaponScriptCatalog = [];
	for (const WeaponScriptRecord of vecWeaponScriptRecords) {
		vecWeaponScriptCatalog.push({ WeaponClassName: WeaponScriptRecord.ClassName, Damage: WeaponScriptRecord.KeyValues.GetKeyValuesInteger("Damage", 0), KeyValues: WeaponScriptRecord.KeyValues, WeaponName: WeaponScriptRecord.Name, WeaponScriptFilePath: WeaponScriptRecord.Path });
	}

	return { WeaponClassNames: GetClasses(), WeaponNames: GetNames(), WeaponScriptCatalog: vecWeaponScriptCatalog };
}

module.exports = { BuildCurrentWeaponScriptCatalog };
```

The three native scans occur independently and are not atomic. Current classes can change between `GetClasses()`,
`GetNames()` and the internal `GetClasses()` call made by `GetAll()`.

## Refresh the Cache Deliberately

Clear every cached script only after all old consumers have stopped. Return the newly loaded record without inspecting
or comparing the destroyed root.

```js
const { ClearCache, Load } = require("weapons/scripts");

function RefreshWeaponScript(strWeaponScriptName) {
	ClearCache();

	return Load(strWeaponScriptName);
}

module.exports = { RefreshWeaponScript };
```

This operation affects every cached weapon script in the plugin context, not only `strWeaponScriptName`. It is suitable
for controlled reload code, not an ordinary read path.

Clear and reload are not transactional: a cleanup error prevents `Load()`, and a later load error does not restore old
cache entries. A `true` clear result means only that no destroy call threw, not that every destroy returned `true`.

## Ownership and Lifetime

- The module cache owns every record's `KeyValues` root. Do not call `DestroyKeyValues()` on a cached root directly.
- Records and roots remain strongly reachable through the cache until `ClearCache()` completes or the plugin context
  is destroyed.
- `GetAll()` returns a fresh array but reuses cached record identities.
- `GetClasses()` and `GetNames()` return fresh native arrays describing current live weapon entities.
- Old records and roots must be treated as invalid immediately after cache cleanup, even if JavaScript still retains
  references.
- Script records describe files and metadata; they do not own or retain live weapon entities.
- Keep cache operations on the game thread and do not mutate record fields or trigger reentrant loads during cleanup.

## Errors and Partial Cleanup

- Non-string, empty, and unsupported names throw `TypeError` before filesystem access.
- A cache-miss `Load()` throws when the path does not exist and propagates `KeyValues.CreateKeyValuesFromFile()` load or
  allocation errors. The factory attempts root cleanup after a load failure; a cleanup error can replace that failure.
- A cache hit does not revalidate the path and therefore does not throw merely because the file was edited or deleted
  afterward.
- Native `GetClasses()`/`GetNames()` and current-world scans propagate unavailable-global-state and runtime errors.
- `GetAll()` has no rollback: if a later class fails, earlier successfully loaded records remain cached, but no array is
  returned. The catalog example likewise propagates field-read and scan failures.
- `ClearCache()` calls `DestroyKeyValues()` in cache insertion order. If a destroy call throws, iteration stops, the
  cache is not cleared, and earlier roots may already be destroyed while still referenced by cache records.
- A false return from `DestroyKeyValues()` is ignored; cleanup continues and the cache is cleared if no call throws.

The module has no JavaScript KeyValues parser, recursive script-directory scan, file watcher, per-entry eviction, or
SDK fallback.

## Related Modules

- [`keyvalues`](keyvalues.md) documents the native owning root and typed tree operations.
- [`weapons`](weapons.md) exposes current live weapon entities and native class/name scans.
- [`weapons/data`](weapons-data.md) provides packaged profile metadata independent of live entities and script files.
- [`filesystem`](filesystem.md) documents the existence check used by `Has()` and cache-miss `Load()`.
