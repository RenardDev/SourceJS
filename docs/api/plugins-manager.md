# `require("plugins/manager")`

> AI processing note: this page documents current native records, direct disk resolution and disk-backed disabled-name
> state. Keep transient indexes, stable names and lazy wrapper ownership distinct.

`plugins/manager` adds validated disk lookup, typed errors and stable `Plugin` wrapper ownership to the direct native
[`plugins`](plugins.md) lifecycle API. It deliberately distinguishes:

- current records, which represent only loaded V8 contexts;
- plugin directories and entry paths that resolve on disk;
- the disk disabled-name snapshot in `PluginsState.json`, updated on a best-effort basis by native code.

There is no unloaded discovery list. Name-based disk queries resolve the filesystem when called, while numeric
selectors apply only to the latest current record list.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Constructor](#constructor)
- [Current Records](#current-records)
- [Name Validation](#name-validation)
- [Disk Queries](#disk-queries)
- [Wrapper Identity](#wrapper-identity)
- [Load And Unload](#load-and-unload)
- [Disable And Enable](#disable-and-enable)
- [All Plugins](#all-plugins)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	PLUGIN_MANAGER,
	InvalidPluginName,
	PluginAlreadyLoaded,
	PluginDisabled,
	PluginError,
	PluginFileNotFoundError,
	PluginLoadError,
	PluginManager,
	PluginNotLoaded,
} = require("plugins/manager");
```

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `PLUGIN_MANAGER` | `PluginManager` | Shared manager for the current plugin context. |
| [`PluginManager`](#new-pluginmanagerpluginmanageroptions--) | Class extending `Map` | Current `name -> Plugin` wrapper ownership. |
| `PluginError` | Error class | Base class for manager lifecycle errors. |
| `InvalidPluginName` | Error class | Name violates the configured pattern or filesystem safety. |
| `PluginAlreadyLoaded` | Error class | `LoadPlugin()` targeted a current record. |
| `PluginDisabled` | Error class | `LoadPlugin()` targeted a disabled disk plugin. |
| `PluginFileNotFoundError` | Error class | Directory or resolved entry file does not exist. |
| `PluginLoadError` | Error class | Native lifecycle, state JSON or manifest entry validation failed. |
| `PluginNotLoaded` | Error class | A valid disk plugin or record index has no current context. |

All typed errors inherit from `PluginError`, which in turn inherits from `Error`.
Filesystem, JSON parsing, metadata and custom override failures are not universally wrapped in these classes; their original errors may propagate.

## Constructor

### `new PluginManager(PluginManagerOptions = {})`

`PluginManagerOptions.ValidPluginPattern` may provide a non-global, non-sticky `RegExp`. The default accepts letters first,
letters/digits/underscore/hyphen internally, and a letter or digit last. Filesystem safety is always enforced even
with a custom expression: empty names, `.`, `..`, slashes, backslashes, colon, C0 control characters, DEL, and Unicode
line separators remain invalid. Other names remain subject to the configured pattern and the native loader's own validation.

Options must be a non-null object, not an array or function. Only an own `ValidPluginPattern` selects a custom expression; an own `undefined` value is invalid rather than a request for the default. The expression is retained by reference in the mutable `ValidPluginPattern` property. Name checks revalidate its type and flags, so changing that property can make even `IsValidPluginName()` throw. Use standard `RegExp` matching behavior, not an overridden `test()` method that changes the result contract.

The class extends `Map`, but it populates wrappers lazily from current native records. Constructing a manager does not
load, unload or discover plugins.

## Current Records

| API | Result | Purpose |
| --- | --- | --- |
| `GetPluginRecords()` | `PluginRecord[]` | Fresh native current-record values. |
| `GetPluginRecordByName(strPluginName)` | `PluginRecord \| null` | Exact validated name lookup. |
| `GetPluginRecord(PluginSelector)` | `PluginRecord \| null` | Name or positive 1-based integer lookup. |
| `RequirePluginRecord(PluginSelector)` | `PluginRecord` | Current lookup with typed missing/not-loaded errors. |
| `PluginNames` | `string[]` | Current loaded names. |
| `LoadedPlugins` | `Plugin[]` | Synchronized current wrappers. |
| `Refresh()` | `this` | Synchronizes wrappers with current native records. |
| `SyncPluginInstances()` | `this` | Adds/removes wrappers to match current records. |

`Refresh()` does not rescan disk and does not call a nonexistent native refresh function. Use `ReloadAllPlugins()` when a
disk rescan and enabled-plugin load are intended.

`GetPluginRecords()` directly returns the native runtime's result; it does not itself normalize or validate a substituted runtime. Native values are fresh snapshots, and separate queries are not an atomic snapshot.

`SyncPluginInstances()` requires an array of plain records with own `Name`, `Directory`, `Entry`, `Enabled`, `Loaded` and `Index` fields. Names must be valid and unique, paths non-empty strings, states booleans, and indexes unique positive safe integers. Records marked unloaded are validated but do not receive cached wrappers. The method validates the set and stages missing wrappers before its own map updates. Ordinary record-validation or wrapper-construction failures occur before those updates; side effects from overridden factories, accessors or map methods are not rolled back. Retained map entries and newly created wrappers must be `Plugin` instances.

`Refresh()`, `SyncPluginInstances()` and the `LoadedPlugins` getter can change the cache. None owns or releases a native context merely by adding or removing a JavaScript wrapper.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function InspectCurrentPlugins() {
	const mapRefreshedManager = PLUGIN_MANAGER.Refresh();
	const mapSynchronizedManager = PLUGIN_MANAGER.SyncPluginInstances();
	const vecCurrentPluginNames = PLUGIN_MANAGER.PluginNames;
	const vecInspectedPluginRecords = [];
	for (const CurrentPluginRecord of PLUGIN_MANAGER.GetPluginRecords()) {
		const PluginRecordByName = PLUGIN_MANAGER.GetPluginRecordByName(CurrentPluginRecord.Name);
		const PluginRecordByIndex = PLUGIN_MANAGER.GetPluginRecord(CurrentPluginRecord.Index);
		const RequiredPluginRecord = PLUGIN_MANAGER.RequirePluginRecord(CurrentPluginRecord.Name);
		if ((PluginRecordByName === null) || (PluginRecordByIndex === null)) {
			throw new Error(`Current plugin record disappeared while inspecting ${CurrentPluginRecord.Name}.`);
		}

		if ((PluginRecordByName.Entry !== PluginRecordByIndex.Entry) || (RequiredPluginRecord.Entry !== PluginRecordByName.Entry) || (RequiredPluginRecord.Index !== PluginRecordByName.Index)) {
			throw new Error(`Current plugin record changed while inspecting ${CurrentPluginRecord.Name}.`);
		}

		vecInspectedPluginRecords.push({
			Entry: CurrentPluginRecord.Entry,
			Index: CurrentPluginRecord.Index,
			Loaded: RequiredPluginRecord.Loaded,
			Name: CurrentPluginRecord.Name,
		});
	}

	const vecLoadedPluginNames = [];
	for (const LoadedPlugin of PLUGIN_MANAGER.LoadedPlugins) {
		vecLoadedPluginNames.push(LoadedPlugin.Name);
	}

	return { ManagerIdentity: (mapRefreshedManager === PLUGIN_MANAGER) && (mapSynchronizedManager === PLUGIN_MANAGER), Names: vecCurrentPluginNames, Records: vecInspectedPluginRecords, Wrappers: vecLoadedPluginNames };
}

module.exports = { InspectCurrentPlugins };
```

Indexes are transient and are never zero-based. Re-read records immediately before an index operation.

## Name Validation

| API | Result |
| --- | --- |
| `IsValidPluginName(strPluginName)` | `boolean` |
| `AssertValidPluginName(strPluginName)` | `undefined` or throws `InvalidPluginName` |
| `GetPluginName(strPluginName)` | The validated string |

```js
const { InvalidPluginName, PluginManager } = require("plugins/manager");

function ValidatePluginNames(vecPluginNameCandidates) {
	const mapManager = new PluginManager({ ValidPluginPattern: /^[a-z][a-z0-9-]*$/ });
	const vecPluginNameValidationResults = [];
	for (const strPluginNameCandidate of vecPluginNameCandidates) {
		const bPluginNameIsValid = mapManager.IsValidPluginName(strPluginNameCandidate);

		try {
			mapManager.AssertValidPluginName(strPluginNameCandidate);

			if (!bPluginNameIsValid) {
				throw new Error(`Plugin name validation disagreed for ${strPluginNameCandidate}.`);
			}

			vecPluginNameValidationResults.push({ Error: null, Name: mapManager.GetPluginName(strPluginNameCandidate), Valid: bPluginNameIsValid });
		} catch (PluginNameValidationError) {
			if (!(PluginNameValidationError instanceof InvalidPluginName)) {
				throw PluginNameValidationError;
			}

			vecPluginNameValidationResults.push({ Error: PluginNameValidationError.message, Name: strPluginNameCandidate, Valid: bPluginNameIsValid });
		}
	}

	return vecPluginNameValidationResults;
}

module.exports = { ValidatePluginNames };
```

## Disk Queries

These APIs accept a name for unloaded or disabled plugins. A positive record index is useful only while that record
exists.

| API | Result | Purpose |
| --- | --- | --- |
| `PluginExists(strPluginName)` | `boolean` | Tests whether the validated directory resolves to an existing entry file. |
| `GetPluginDirectory(PluginSelector)` | `string` | Current record path or name-based disk directory. |
| `GetPluginFilePath(PluginSelector)` | `string` | Current entry or validated manifest/default disk entry. |
| `GetPluginInfo(PluginSelector)` | `PluginInfo` | Current or disk metadata; unloaded values use `Index = -1`. |

`GetPluginFilePath()` reads a loaded record's editable `Entry` field exactly once and returns that validated value.

Disk manifest entries may use a relative subdirectory such as `dist/index.js`; backslashes are normalized to slashes. Rooted paths, a leading drive prefix and any `..` component throw `PluginLoadError`. These are lexical checks, not a filesystem sandbox: they do not resolve symbolic links or establish canonical-path containment. Use trusted plugin roots and manifests. Loaded-record paths only receive the non-empty-string checks described above.

`PluginExists(strPluginName)` requires an exact boolean from the live filesystem runtime. Malformed results raise
`PluginLoadError`, while filesystem exceptions propagate unchanged.

All disk queries require exact filesystem booleans. Current native record directories and entry paths must be
non-empty strings, and a loaded managed plugin must return a real `PluginInfo` view.

Disk and manifest IO is synchronous on the caller's game thread. A positive existence result does not prove that the script will compile or initialize successfully. Metadata and lazy-wrapper queries may populate the manager cache; record snapshots and metadata edits do not mutate native state or rewrite disk files.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function InspectDiskPlugin(strPluginName) {
	if (PLUGIN_MANAGER.PluginExists(strPluginName) !== true) {
		return null;
	}

	const Information = PLUGIN_MANAGER.GetPluginInfo(strPluginName);

	return {
		Directory: PLUGIN_MANAGER.GetPluginDirectory(strPluginName),
		Enabled: Information.Enabled,
		FilePath: PLUGIN_MANAGER.GetPluginFilePath(strPluginName),
		Index: Information.Index,
		Loaded: Information.Loaded,
		Name: Information.Name,
		VerboseName: Information.VerboseName,
		Version: Information.Version,
	};
}

module.exports = { InspectDiskPlugin };
```

## Wrapper Identity

| API | Result | Purpose |
| --- | --- | --- |
| `GetPluginInstance(PluginSelector)` | `Plugin \| null` | Stable manager-owned wrapper for a current record. |
| `CreatePluginInstance(strPluginName)` | `Plugin` | Creates an unregistered wrapper after name validation. |

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function InspectWrapperIdentity(strPluginName) {
	PLUGIN_MANAGER.SyncPluginInstances();

	const SharedPluginInstance = PLUGIN_MANAGER.GetPluginInstance(strPluginName);
	const DirectPluginInstance = PLUGIN_MANAGER.CreatePluginInstance(strPluginName);

	return {
		DirectIsShared: DirectPluginInstance === SharedPluginInstance,
		DirectName: DirectPluginInstance.Name,
		Loaded: SharedPluginInstance !== null,
		SharedIdentity: (SharedPluginInstance !== null) && (SharedPluginInstance === PLUGIN_MANAGER.GetPluginInstance(strPluginName)),
		SharedName: (SharedPluginInstance === null) ? null : SharedPluginInstance.Name,
	};
}

module.exports = { InspectWrapperIdentity };
```

Use the shared wrapper for identity-sensitive controller state. A direct wrapper remains a live manager view, but it
is not inserted into the manager map. Lazy lookup reads the record's loaded state once and validates a newly created
`Plugin` before inserting it into the map.

Wrapper identity is stable while that valid map entry is retained, not across every lifecycle operation: reload replaces it, and unload/disable removes it. Existing controller-side wrappers still query by name. Mutating the inherited map or wrapper identity fields manually can break the cache contract; clearing a JavaScript map does not unload native plugins.

## Load And Unload

When an explicit load throws, classify the captured `Failure` using the named error classes from `plugins/manager`. Report an unexpected failure as-is rather than treating it as an absent plugin.

| Use | Example |
| --- | --- |
| The selected plugin is disabled. | `const bDisabled = Failure instanceof PluginDisabled;` |
| The plugin directory or entry file is missing. | `const bEntryMissing = Failure instanceof PluginFileNotFoundError;` |
| Loading failed for another documented lifecycle or manifest reason. | `const bLoadFailed = Failure instanceof PluginLoadError;` |

### `LoadPlugin(strPluginName)` and `UnloadPlugin(PluginSelector)`

`LoadPlugin()` accepts a name only, checks disk and disabled state, invokes the native loader, stores a wrapper and
returns it. `UnloadPlugin()` accepts a name or current 1-based index, removes the native context and manager wrapper,
and returns `true`. If the native manager refuses a repeated request for an already-unloading plugin, this wrapper throws `PluginLoadError` and keeps its wrapper entry; cleanup remains owned by the outer unload call.

These operations are synchronous and may execute plugin startup/shutdown code. Use another plugin as the target; callbacks must not destroy the controller's own context. A failure after native work can leave changed state or a stale cache. The manager does not provide a general lifecycle transaction, so inspect current records before recovery rather than assuming rollback.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function CyclePluginLoadedState(strPluginName) {
	if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) !== true) {
		PLUGIN_MANAGER.LoadPlugin(strPluginName);
	}

	if (PLUGIN_MANAGER.UnloadPlugin(strPluginName) !== true) {
		throw new Error(`Plugin ${strPluginName} did not unload by name.`);
	}

	PLUGIN_MANAGER.LoadPlugin(strPluginName);

	const CurrentPluginRecord = PLUGIN_MANAGER.RequirePluginRecord(strPluginName);
	if (PLUGIN_MANAGER.UnloadPlugin(CurrentPluginRecord.Index) !== true) {
		throw new Error(`Plugin ${strPluginName} did not unload by index.`);
	}

	const RestoredPlugin = PLUGIN_MANAGER.LoadPlugin(strPluginName);
	if (!RestoredPlugin.Loaded) {
		throw new Error(`Plugin ${strPluginName} did not return to loaded state.`);
	}

	return RestoredPlugin.Name;
}

module.exports = { CyclePluginLoadedState };
```

### `ReloadPlugin(PluginSelector)`

Reload accepts a name or current positive index and requires a current record. Success recreates its V8 context, replaces the manager-owned wrapper and returns the replacement. If native reload fails, the manager tries to resynchronize its map before throwing `PluginLoadError`; that synchronization can itself throw. Reload is not atomic and can leave the target unloaded when loading the replacement fails.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function ReloadPlugin(strPluginName) {
	if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) !== true) {
		PLUGIN_MANAGER.LoadPlugin(strPluginName);
	}

	const PreviousPluginInstance = PLUGIN_MANAGER.GetPluginInstance(strPluginName);
	const ReloadedPlugin = PLUGIN_MANAGER.ReloadPlugin(strPluginName);
	if ((PreviousPluginInstance === null) || (PreviousPluginInstance === ReloadedPlugin) || !ReloadedPlugin.Loaded) {
		throw new Error(`Plugin ${strPluginName} did not replace its loaded wrapper.`);
	}

	return ReloadedPlugin.Name;
}

module.exports = { ReloadPlugin };
```

## Disable And Enable

### `DisablePlugin(PluginSelector)` and `EnablePlugin(strPluginName)`

Disable accepts a current index or a validated disk name, updates the native in-memory disabled-name set and removes any current wrapper.
Enable accepts a name, verifies disk, clears native in-memory disabled state, loads the plugin and returns its
current `Plugin` wrapper. Both operations attempt to save `PluginsState.json`; directory/open/write failures are logged by native code and do not by themselves turn runtime success into a failure.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function CyclePluginEnabledState(strPluginName) {
	if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) !== true) {
		if (PLUGIN_MANAGER.IsPluginEnabled(strPluginName) === true) {
			PLUGIN_MANAGER.LoadPlugin(strPluginName);
		} else {
			PLUGIN_MANAGER.EnablePlugin(strPluginName);
		}
	}

	const CurrentPluginRecord = PLUGIN_MANAGER.RequirePluginRecord(strPluginName);
	if (PLUGIN_MANAGER.DisablePlugin(CurrentPluginRecord.Index) !== true) {
		throw new Error(`Plugin ${strPluginName} did not disable.`);
	}

	if ((PLUGIN_MANAGER.IsPluginLoaded(strPluginName) === true) || (PLUGIN_MANAGER.IsPluginEnabled(strPluginName) === true) || (PLUGIN_MANAGER.PluginExists(strPluginName) !== true)) {
		throw new Error(`Plugin ${strPluginName} has inconsistent disabled state.`);
	}

	const EnabledPlugin = PLUGIN_MANAGER.EnablePlugin(strPluginName);
	if (!EnabledPlugin.Loaded || (PLUGIN_MANAGER.IsPluginEnabled(strPluginName) !== true)) {
		throw new Error(`Plugin ${strPluginName} did not return to enabled state.`);
	}

	return EnabledPlugin.Name;
}

module.exports = { CyclePluginEnabledState };
```

`IsPluginLoaded(PluginSelector)` checks current record state. `IsPluginEnabled(PluginSelector)` reads current records first and
otherwise reads `PluginsState.json` at call time; it does not keep a stale JavaScript state snapshot. Both queries
read the selected record field once and require an exact boolean. The disk-backed path also requires an exact boolean
from `filesystem.DoesFileExist()` and raises `PluginLoadError` for invalid existence flags or parsed state structure. Missing or whitespace-empty state files mean an empty disabled-name set; malformed JSON becomes `PluginLoadError` with the original parse error as its `cause`. When no current record exists, this disk-backed result can disagree with native in-memory state after a failed save or an external state-file edit; it is not a persistence acknowledgment.

| Query | Result |
| --- | --- |
| `IsPluginLoaded(PluginSelector)` | Whether the selected current record exists and reports `Loaded`. |
| `IsPluginEnabled(PluginSelector)` | Live current/disk enabled state; an absent numeric index returns `false`. |

## All Plugins

| API | Result | Behavior |
| --- | --- | --- |
| `UnloadAllPlugins()` | `true` or throws | Runs native unload-all and reconciles wrappers with current records. |
| `ReloadAllPlugins()` | `true` or throws | Runs native unload-all, rescans disk, attempts enabled auto-load-eligible plugins and reconciles wrappers. |

The current native bulk routines continue after individual `false` load/unload results and do not aggregate them. A returned `true` reports completion of the native callback, not proof that every requested plugin reached its desired state. Inspect current records and relevant native diagnostics. Both package methods synchronize the cache before checking the reported result; a synchronization failure may be the error that reaches the caller.

The following whole-server workflow requires a host/admin JavaScript context outside the set of managed plugin contexts. Do not run it from a loaded plugin: unload-all includes that caller, and a safe teardown does not make subsequent JavaScript execution in its destroyed context safe. If no such unmanaged context is available, use native host administration instead.

```js
const { PLUGIN_MANAGER } = require("plugins/manager");

function RestartAllPlugins() {
	const vecLoadedPluginNamesBeforeRestart = PLUGIN_MANAGER.PluginNames;
	const bUnloadAllReportedSuccess = PLUGIN_MANAGER.UnloadAllPlugins();
	const vecCurrentPluginRecordsAfterUnload = PLUGIN_MANAGER.GetPluginRecords();
	if ((bUnloadAllReportedSuccess !== true) || (vecCurrentPluginRecordsAfterUnload.length !== 0) || (PLUGIN_MANAGER.size !== 0)) {
		throw new Error("Not every plugin unloaded.");
	}

	const bReloadAllReportedSuccess = PLUGIN_MANAGER.ReloadAllPlugins();
	if (bReloadAllReportedSuccess !== true) {
		throw new Error("ReloadAllPlugins() did not report success.");
	}

	PLUGIN_MANAGER.Refresh();

	const vecLoadedPluginNamesAfterRestart = PLUGIN_MANAGER.PluginNames;
	const vecLoadedPluginWrapperNames = [];
	for (const LoadedPlugin of PLUGIN_MANAGER.LoadedPlugins) {
		vecLoadedPluginWrapperNames.push(LoadedPlugin.Name);
	}

	return { NamesBefore: vecLoadedPluginNamesBeforeRestart, NamesNow: vecLoadedPluginNamesAfterRestart, Wrappers: vecLoadedPluginWrapperNames };
}

module.exports = { RestartAllPlugins };
```

`RestartAllPlugins()` is server-wide and attempts to unload current contexts before rescanning disk. Its empty-record check detects an incomplete unload, but its reload result is an observation, not proof that every eligible plugin loaded. Never assume bulk failure rolls back earlier changes.

## Errors

Catch a specific subtype when recovery differs, or `PluginError` for one administrative failure boundary:

| Error | Trigger |
| --- | --- |
| `TypeError` | Invalid constructor options, pattern type/flags or selector type. |
| `InvalidPluginName` | Pattern or filesystem-safety validation fails. |
| `PluginAlreadyLoaded` | `LoadPlugin(strPluginName)` finds a current record. |
| `PluginDisabled` | `LoadPlugin(strPluginName)` observes disabled state through `IsPluginEnabled()`. |
| `PluginFileNotFoundError` | Plugin directory or resolved entry file is absent. |
| `PluginNotLoaded` | A valid disk name or numeric record index has no current context. |
| `PluginLoadError` | Native lifecycle reporting, state JSON parsing or lexical manifest entry validation fails. |

This workflow distinguishes an already loaded plugin from the same valid, enabled disk plugin while unloaded, then
restores it:

```js
const {
	PLUGIN_MANAGER,
	PluginAlreadyLoaded,
	PluginError,
	PluginNotLoaded,
} = require("plugins/manager");

function InspectPluginLifecycleErrors(strPluginName) {
	if (PLUGIN_MANAGER.IsPluginEnabled(strPluginName) !== true) {
		throw new Error(`Plugin ${strPluginName} must be enabled for this workflow.`);
	}

	if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) !== true) {
		PLUGIN_MANAGER.LoadPlugin(strPluginName);
	}

	let strPluginAlreadyLoadedMessage = null;
	let strPluginNotLoadedMessage = null;
	let bRecordLookupFailed = false;
	let RecordLookupFailure = undefined;

	try {
		PLUGIN_MANAGER.LoadPlugin(strPluginName);
		throw new Error(`Plugin ${strPluginName} unexpectedly loaded twice.`);
	} catch (PluginAlreadyLoadedError) {
		if (!(PluginAlreadyLoadedError instanceof PluginAlreadyLoaded)) {
			throw PluginAlreadyLoadedError;
		}

		strPluginAlreadyLoadedMessage = PluginAlreadyLoadedError.message;
	}

	if (PLUGIN_MANAGER.UnloadPlugin(strPluginName) !== true) {
		throw new Error(`Plugin ${strPluginName} did not unload for the error workflow.`);
	}

	try {
		PLUGIN_MANAGER.RequirePluginRecord(strPluginName);
		throw new Error(`Plugin ${strPluginName} unexpectedly retained a record.`);
	} catch (PluginNotLoadedError) {
		if (!(PluginNotLoadedError instanceof PluginNotLoaded) || !(PluginNotLoadedError instanceof PluginError)) {
			bRecordLookupFailed = true;
			RecordLookupFailure = PluginNotLoadedError;
		} else {
			strPluginNotLoadedMessage = PluginNotLoadedError.message;
		}
	}

	try {
		if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) !== true) {
			PLUGIN_MANAGER.LoadPlugin(strPluginName);
		}
	} catch (RestorationError) {
		if (bRecordLookupFailed) {
			throw new AggregateError([RecordLookupFailure, RestorationError], `Plugin ${strPluginName} record check and restoration failed.`);
		}

		throw RestorationError;
	}

	if (bRecordLookupFailed) {
		throw RecordLookupFailure;
	}

	return { AlreadyLoadedMessage: strPluginAlreadyLoadedMessage, NotLoadedMessage: strPluginNotLoadedMessage };
}

module.exports = { InspectPluginLifecycleErrors };
```

Package errors are synchronous and the package does not itself log them. Some methods deliberately handle or translate failures: `PluginExists()` maps a missing-file error to `false`, state JSON errors retain a `cause`, and lifecycle methods may reconcile state before reporting failure. Native code can log independently. The example preserves both an unexpected record-check failure and a restoration failure in order, including non-`Error` thrown values; it does not undo prior lifecycle effects or guarantee restoration when recovery fails.

## Lifecycle

`PLUGIN_MANAGER` belongs to the current plugin context. Its map caches wrappers and can retain stale entries after lifecycle operations elsewhere or a failed update. `Refresh()`, `SyncPluginInstances()` and `LoadedPlugins` reconcile that map whenever they run; cached membership alone is not proof of current native load state.

Record arrays and objects are snapshots of native state. `PluginInfo` has live accessors over its supplied JavaScript record, not over the native manager, plus mutable metadata read during construction. Re-read records and metadata after lifecycle operations rather than expecting old objects to track native changes. State queries and name-based disk methods read native records, filesystem paths and `PluginsState.json` when called.

`UnloadPlugin()`, `ReloadPlugin()`, `DisablePlugin()`, `UnloadAllPlugins()` and `ReloadAllPlugins()` can destroy one or more V8 contexts synchronously.
A controller must not target its own executing context, retain callbacks from a destroyed context or assume that a
failed multi-plugin reload rolls back earlier changes.

## Related Modules

- [`plugins`](plugins.md) owns native lifecycle and current records.
- [`plugins/instance`](plugins-instance.md) implements live name-bound wrappers.
- [`plugins/info`](plugins-info.md) validates manifest metadata.
- [`plugins/command`](plugins-command.md) maps typed errors to administrative output.
- [`paths`](paths.md) exposes `PLUGIN_ROOT` and `DATA_ROOT`.
- [`filesystem`](filesystem.md) performs disk and state-file reads.
