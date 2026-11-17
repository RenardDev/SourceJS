> AI processing note: this page documents native plugin-context lifecycle control. Keep name-only loading, transient selectors, context destruction, in-memory disabled state and attempted disk persistence distinct.

# `require("plugins")`

`plugins` controls the native SourceJS plugin lifecycle. It loads entry files directly from `addons/sourcejs/plugins/<name>/`, reports only plugins that are currently loaded, and tracks disabled names in memory with best-effort saves to `addons/sourcejs/data/PluginsState.json`.

SourceJS scans plugin directories during startup and attempts to load every valid plugin
that is not disabled and does not set `"Autoload": false` in `plugin.json`.
Explicit `LoadPlugin(strPluginName)` and `EnablePlugin(strPluginName)` calls may still start an Autoload-disabled
plugin. There is no persistent discovery registry: `LoadPlugin(strPluginName)` resolves that
name from disk at the time of the call. An unloaded or disabled plugin is
removed from `List()` and `GetPluginRecords()` immediately.

## Contents

- [Plugin Layout](#plugin-layout)
- [Import](#import)
- [Exports](#exports)
- [Plugin Records](#plugin-records)
- [Inspect Loaded Plugins](#inspect-loaded-plugins)
- [Load From Disk](#load-from-disk)
- [Reload One Plugin](#reload-one-plugin)
- [Disable And Enable](#disable-and-enable)
- [Unload One Plugin](#unload-one-plugin)
- [Reload Or Unload Everything](#reload-or-unload-everything)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Plugin Layout

The default entry file is `index.js`. A plugin may select another relative entry in `plugin.json`:

```text
addons/sourcejs/plugins/hello/
|-- index.js
`-- plugin.json
```

```json
{
  "Entry": "index.js",
  "Autoload": false
}
```

`Autoload` defaults to `true`. The bundled [server administration plugin](../server-administration.md)
loads automatically. The demonstrations are installed under `addons/sourcejs/plugins/disabled`;
move a demonstration out of that directory to load it by name. They still set `Autoload` to `false`.

SourceJS creates one isolated `v8::Context` per plugin, with its own CommonJS module cache and `module.exports` object. The current runtime invokes the case-sensitive SourceJS-owned lifecycle export keys `Load` and `Unload` when present. Lowercase `load`/`unload` are not looked up; SourceJS does not install lifecycle aliases. JavaScript objects and callbacks are not shared between contexts; use serialized payloads through [`plugins/bus`](plugins-bus.md) for explicit cross-plugin communication.

Bare names such as `require("loggers")` load SourceJS modules. A leading `./`
loads a JavaScript file or directory (`index.js`) from the current plugin
module's directory and caches it inside that plugin context. SourceJS rejects
`../` imports and any resolved path outside the plugin root.

```js
const { LogInfo } = require("loggers");

function Load() {
	LogInfo("hello loaded");
}

function Unload() {
	LogInfo("hello unloaded");
}

exports.Load = Load;
exports.Unload = Unload;
```

## Import

```js
const {
	DisablePlugin,
	EnablePlugin,
	List,
	LoadPlugin,
	GetPluginRecords,
	ReloadPlugin,
	ReloadAllPlugins,
	UnloadPlugin,
	UnloadAllPlugins,
} = require("plugins");
```

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `List()` | `string[]` | Returns console-ready lines for the currently loaded plugins. |
| `GetPluginRecords()` | `PluginRecord[]` | Returns structured records for the currently loaded plugins. |
| `LoadPlugin(strPluginName)` | `boolean` | Loads a plugin directory from disk by name only; returns `false` on ordinary manager failure. |
| `UnloadPlugin(PluginSelector)` | `boolean` | Unloads one current plugin and removes its record; returns `false` if that plugin is already unloading. |
| `ReloadPlugin(PluginSelector)` | `boolean` | Unloads and loads one current plugin; returns `false` if either operation fails. |
| `DisablePlugin(PluginSelector)` | `boolean` | Unloads a plugin and marks its name disabled in memory; saving is best-effort. |
| `EnablePlugin(PluginSelector)` | `boolean` | Clears in-memory disabled state, attempts to save it and loads the plugin; returns the load result. |
| `UnloadAllPlugins()` | `true` | Attempts to unload every current plugin; individual results are not aggregated. |
| `ReloadAllPlugins()` | `true` | Runs the unload pass, rescans disk, and attempts to load enabled plugins whose manifests permit Autoload; individual results are not aggregated. |

`strPluginName` must be a non-empty string. `LoadPlugin(strPluginName)` never accepts an index. `PluginSelector` is either a
non-empty plugin name or a positive 1-based 32-bit unsigned integer from the latest `GetPluginRecords()` result. Decimal strings
try an in-range index before falling back to a name lookup. Numeric `0`, non-integral numbers, numbers outside the 32-bit unsigned
range, empty strings, and invalid argument types raise argument errors instead of returning `false`. A valid selector that does
not resolve to a plugin returns `false`.

Indexes are transient. Every unload changes the indexes that follow the removed record. A disabled plugin has no current index, so re-enable it by name.

## Plugin Records

Every object returned by `GetPluginRecords()` has this shape:

| Property | Type | Meaning |
| --- | --- | --- |
| `Index` | `number` | Current 1-based position in the loaded-plugin list. |
| `Name` | `string` | Plugin directory name and lifecycle identity. |
| `Directory` | `string` | Absolute plugin directory path. |
| `Entry` | `string` | Absolute resolved CommonJS entry path. |
| `Enabled` | `boolean` | Whether the current record is enabled. |
| `Loaded` | `boolean` | Whether its isolated V8 context completed loading. |

`Directory` and `Entry` preserve Unicode through UTF-8 conversion from the native paths, independently of the Windows ANSI code page. Native spelling and separators are preserved; these fields do not normalize paths. Native encoding conversion or allocation failures raise an error instead of returning a partial record.

`GetPluginRecords()` builds a new array from the native manager's current records on every call. Do not retain an index across lifecycle operations; find the plugin by name again.

## Inspect Loaded Plugins

Use `List()` for console output and `GetPluginRecords()` when code needs fields:

```js
const { List, GetPluginRecords } = require("plugins");

function InspectLoadedPlugins() {
	const vecLines = List();
	const vecCurrentRecords = GetPluginRecords();
	if (vecCurrentRecords.length === 0) {
		if ((vecLines.length !== 1) || (vecLines[0] !== "No plugins loaded.")) {
			throw new Error("List() and GetPluginRecords() disagree about the empty plugin set.");
		}

		return { Lines: vecLines, Records: [] };
	}

	if (vecLines.length !== vecCurrentRecords.length) {
		throw new Error("List() and GetPluginRecords() returned different plugin counts.");
	}

	return {
		Lines: vecLines,
		Records: vecCurrentRecords.map((Record) => ({
			Directory: Record.Directory,
			Enabled: Record.Enabled,
			Entry: Record.Entry,
			Index: Record.Index,
			Loaded: Record.Loaded,
			Name: Record.Name,
		})),
	};
}

module.exports = { InspectLoadedPlugins };
```

When no plugin is loaded, `List()` returns an array containing `No plugins loaded.` and `GetPluginRecords()` returns an empty array.

## Load From Disk

The load operation does not depend on a previously discovered record. This controller resolves the resulting record by stable name instead of retaining an index:

```js
const { LoadPlugin, GetPluginRecords } = require("plugins");

function LoadPluginFromDisk(strPluginName) {
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError("strPluginName must be a non-empty string.");
	}

	if (!LoadPlugin(strPluginName)) {
		throw new Error(`Plugin ${strPluginName} could not be loaded; inspect the native diagnostics.`);
	}

	const LoadedRecord = GetPluginRecords().find((Record) => Record.Name === strPluginName);
	if ((LoadedRecord === undefined) || (LoadedRecord.Loaded !== true) || (LoadedRecord.Enabled !== true)) {
		throw new Error(`Plugin ${strPluginName} has no loaded record after LoadPlugin().`);
	}

	return LoadedRecord;
}

module.exports = { LoadPluginFromDisk };
```

`LoadPlugin(strPluginName)` returns `true` when the plugin loads or is already loaded. It returns `false` for ordinary manager
failures, including an invalid name, missing directory or entry, disabled state, or failed plugin execution. It does not return
a `Plugin` wrapper; use `GetPluginRecords()` to inspect the resulting snapshot. Argument validation, V8 failures and translated
C++ exceptions can raise JavaScript errors instead. A failure does not guarantee that no lifecycle side effects occurred.

## Reload One Plugin

Resolve the current index immediately before using it. Reload tears down the previous V8 context, CommonJS cache, callbacks, hooks and plugin-owned resource registrations before loading a new instance. New startup code must register callbacks/hooks and acquire resources again; old registrations are not copied. Pending operations may retain native resources as described under [Lifecycle](#lifecycle).

```js
const { GetPluginRecords, ReloadPlugin } = require("plugins");

function ReloadPluginAndVerify(PluginSelector) {
	const vecRecordsBeforeReload = GetPluginRecords();
	let TargetRecord = null;
	if (Number.isInteger(PluginSelector)) {
		TargetRecord = vecRecordsBeforeReload.find((Record) => Record.Index === PluginSelector) ?? null;
	} else if ((typeof PluginSelector === "string") && /^\d+$/.test(PluginSelector)) {
		const unSelectorIndex = Number.parseInt(PluginSelector, 10);
		TargetRecord = vecRecordsBeforeReload.find((Record) => Record.Index === unSelectorIndex) ?? vecRecordsBeforeReload.find((Record) => Record.Name === PluginSelector) ?? null;
	} else if (typeof PluginSelector === "string") {
		TargetRecord = vecRecordsBeforeReload.find((Record) => Record.Name === PluginSelector) ?? null;
	}

	if (TargetRecord === null) {
		throw new Error(`No loaded plugin matches selector ${PluginSelector}.`);
	}

	if (!ReloadPlugin(PluginSelector)) {
		throw new Error(`Plugin ${TargetRecord.Name} could not be reloaded; its previous runtime state may be gone.`);
	}

	const ReloadedRecord = GetPluginRecords().find((Record) => Record.Name === TargetRecord.Name);
	if ((ReloadedRecord === undefined) || (ReloadedRecord.Loaded !== true)) {
		throw new Error(`Plugin ${TargetRecord.Name} has no record after ReloadPlugin().`);
	}

	return ReloadedRecord;
}

module.exports = { ReloadPluginAndVerify };
```

## Disable And Enable

Disable updates in-memory state and attempts to save it to `PluginsState.json`. Directory/open/write failures are logged and do not by themselves make an otherwise successful lifecycle call fail, so success does not guarantee persistence across restarts. The disabled plugin disappears from the current records; therefore `EnablePlugin(strPluginName)` uses its name here:

```js
const { DisablePlugin, EnablePlugin, GetPluginRecords, LoadPlugin } = require("plugins");

function CyclePluginEnabledState(strPluginName) {
	if (GetPluginRecords().some((Record) => Record.Name === strPluginName) !== true) {
		if (!LoadPlugin(strPluginName)) {
			throw new Error(`Plugin ${strPluginName} could not be loaded before the enable-state cycle.`);
		}
	}

	const CurrentRecord = GetPluginRecords().find((Record) => Record.Name === strPluginName);
	if ((CurrentRecord === undefined) || (DisablePlugin(CurrentRecord.Index) !== true)) {
		throw new Error(`Plugin ${strPluginName} could not be disabled.`);
	}

	if (GetPluginRecords().some((Record) => Record.Name === strPluginName)) {
		throw new Error(`Disabled plugin ${strPluginName} remained in GetPluginRecords().`);
	}

	if (!EnablePlugin(strPluginName)) {
		throw new Error(`Plugin ${strPluginName} could not be enabled and loaded.`);
	}

	const EnabledRecord = GetPluginRecords().find((Record) => Record.Name === strPluginName);
	if ((EnabledRecord === undefined) || (EnabledRecord.Enabled !== true)) {
		throw new Error(`Plugin ${strPluginName} has no enabled record after EnablePlugin().`);
	}

	return EnabledRecord;
}

module.exports = { CyclePluginEnabledState };
```

## Unload One Plugin

After `UnloadPlugin()`, reacquire all records and indexes. This controller restores the named plugin from disk before returning:

```js
const { GetPluginRecords, LoadPlugin, UnloadPlugin } = require("plugins");

function CyclePluginLoadedState(strPluginName) {
	const CurrentRecord = GetPluginRecords().find((Record) => Record.Name === strPluginName);
	if (CurrentRecord === undefined) {
		throw new Error(`Plugin ${strPluginName} is not loaded.`);
	}

	if (UnloadPlugin(CurrentRecord.Index) !== true) {
		throw new Error(`Plugin ${strPluginName} could not be unloaded.`);
	}

	if (GetPluginRecords().some((Record) => Record.Name === strPluginName)) {
		throw new Error(`Plugin ${strPluginName} remained loaded after UnloadPlugin().`);
	}

	if (!LoadPlugin(strPluginName)) {
		throw new Error(`Plugin ${strPluginName} could not be restored; its previous runtime state is gone.`);
	}

	const RestoredRecord = GetPluginRecords().find((Record) => Record.Name === strPluginName);
	if (RestoredRecord === undefined) {
		throw new Error(`Plugin ${strPluginName} has no record after restore.`);
	}

	return RestoredRecord;
}

module.exports = { CyclePluginLoadedState };
```

## Reload Or Unload Everything

`UnloadAllPlugins()` preserves disabled-state configuration. `ReloadAllPlugins()` then scans the plugin root again, so directories added since startup are included and disabled names stay unloaded. Both return `true` after their manager loops complete, not an aggregate success result. This example checks that unload emptied the records and returns before/after observations; it does not require the same names to return. Previously loaded plugins with `"Autoload": false` intentionally stay unloaded, and eligible plugins may fail independently. Inspect current records and native diagnostics rather than treating a completed bulk callback as proof that every plugin loaded.

Run this whole-server workflow only from an unmanaged host/admin JavaScript context outside the managed plugin set. A controller plugin is not safe: unload-all includes its executing context. If no such unmanaged context is available, use native host administration instead.

```js
const { GetPluginRecords, ReloadAllPlugins, UnloadAllPlugins } = require("plugins");

function RestartAllPlugins() {
	const vecNamesBefore = GetPluginRecords().map((Record) => Record.Name);

	if ((UnloadAllPlugins() !== true) || (GetPluginRecords().length !== 0)) {
		throw new Error("UnloadAllPlugins() did not empty the current plugin records.");
	}

	if (ReloadAllPlugins() !== true) {
		throw new Error("ReloadAllPlugins() could not start the disk rescan.");
	}

	const vecNamesAfter = GetPluginRecords().map((Record) => Record.Name);

	return { NamesAfter: vecNamesAfter, NamesBefore: vecNamesBefore };
}

module.exports = { RestartAllPlugins };
```

## Errors

- `LoadPlugin(strPluginName)` accepts only a non-empty string. A numeric argument raises an argument error; a decimal string reaches the manager but returns `false` because index-like names are not loadable.
- Lifecycle selectors accept a non-empty name, a positive integer, or decimal text produced by console command parsing. Resolve indexes from a current `GetPluginRecords()` call immediately before use.
- `List()` and `GetPluginRecords()` reject a native result whose count exceeds the V8 array-length range; neither publishes a partially built array.
- Native name/selector parsing and list/record queries preserve V8 failures/termination and translate C++ exceptions.
  Failed conversions do not overwrite parser outputs or replace an existing V8 exception with an argument error.
- List/record arrays use checked own indexed properties. Record construction installs own `Index`, `Name`, `Directory`,
  `Entry`, `Enabled` and `Loaded` fields without invoking inherited setters; counts and one-based indexes are checked
  before narrowing. These records are completed JavaScript snapshots, not live references to manager records.
- Plugin `require(strModuleName)` stores private callback metadata as own properties without invoking inherited numeric setters.
  Its native callback preserves metadata-getter errors, existing loader V8 errors and active termination; a failed local load without an existing V8 error still raises a module-load error.
- Script-entry and package CommonJS module objects initialize their own standard `exports` field without invoking inherited setters or being blocked by an inherited non-writable `exports` property.
- Ordinary single-plugin manager failures return `false`; inspect the native diagnostic in the SourceJS log. Invalid arguments and exceptional V8/C++ failures can raise JavaScript errors. No JavaScript fallback record or context is created.
- If native execution succeeds but storing the manager record throws, the manager attempts to unload that runtime before rethrowing the original exception. A rollback exception is logged without replacing the original failure. This is not a general lifecycle transaction: startup side effects are not undone, and failed rollback may require runtime shutdown for complete cleanup.
- If CommonJS execution or the `Load` export raises a C++ exception after the native runtime record is stored, runtime startup attempts to unload that plugin before rethrowing the original exception.
  A cleanup exception is logged without replacing the startup failure; a retained runtime may still require a later unload or shutdown. Ordinary `false` results retain their existing cleanup behavior.
- Native lifecycle callbacks check V8 failure/termination before parsing, before calling the manager and before
  publishing its boolean result; C++ exceptions are translated at the callback boundary. These checks do not
  roll back manager side effects or make unloading the currently executing plugin safe.
- `ReloadPlugin(PluginSelector)` unloads first and has no rollback. If the new entry fails, the old context and record remain gone.
- `UnloadAllPlugins()` and `ReloadAllPlugins()` return `true` after their manager loops complete; inspect `GetPluginRecords()` and logs to detect individual unload or reload failures.

## Lifecycle

Unload releases callbacks, memory hooks, KeyValues handles, SOCI/Redis registrations, socket connections, module-cache values and the isolated V8 context owned by that plugin. Pending worker operations can retain their native resources until completion; unloading is not a guarantee of immediate IO cancellation. Reload creates a new context and CommonJS cache rather than reusing JavaScript objects from the previous instance.

Call these synchronous lifecycle operations only on the owning JavaScript/game thread. They can run plugin code and resource cleanup inline; they are not asynchronous worker requests.

A repeated `UnloadPlugin()` request for a plugin whose unload is already in progress returns `false` without invoking its unload export again. The outer call owns cleanup, and unloading another plugin remains independent. This guard does not make arbitrary synchronous self-unload from other active callbacks safe.

Administrative code must target another plugin. A plugin must not synchronously unload, reload, disable or include itself in an all-plugin operation while its callback is executing, because that destroys the current context and its stack.

Native code attempts to save disabled names to `PluginsState.json`; a successful lifecycle result is not a persistence acknowledgment. `UnloadPlugin()` does not disable a plugin, and `UnloadAllPlugins()` does not modify disabled state.

## Related Modules

- [`plugins/bus`](plugins-bus.md) provides serialized communication between isolated plugins.
- [`plugins/info`](plugins-info.md) reads and validates plugin manifests.
- [`plugins/instance`](plugins-instance.md) wraps one named plugin.
- [`plugins/manager`](plugins-manager.md) provides higher-level validation and typed lifecycle errors.
- [`core/command/plugin`](core-command-plugin.md) implements plugin-management subcommands.
- [Architecture](../architecture.md) explains V8 context and resource ownership.
