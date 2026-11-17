# `require("core/command/plugin")`

> Warning: This API reference is large for AI-agent processing. Use the table of contents to navigate directly to the
> relevant section.

> This page is maintained by hand. Examples use real plugin names and native manager records.

`LoadPlugin()` accepts only a non-empty plugin name. `UnloadPlugin()`, `ReloadPlugin()`, `DisablePlugin()`, and `EnablePlugin()`
accept either a non-empty string selector or a positive 32-bit unsigned numeric index. Invalid argument types, empty strings,
and zero numeric indices throw rather than returning `false`. Indices are one-based positions in the manager's current plugin
vector, not permanent identifiers. Decimal string selectors also try an in-range index before falling back to a name lookup.

Requiring this module registers the `sjs plugins ...` command family on `CORE_COMMAND`.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/command/plugin.js`](../../packages/sourcejs/core/command/plugin.js). It wraps
the native `plugins` module with status logging and registers the same load, unload, reload, disable, enable, and list operations
on the shared core command tree. Use it for operator-facing lifecycle commands or direct calls with status logging. Individual
lifecycle operations return booleans on normal completion; validation and other exceptions can propagate instead.

## Import

```js
const { LoadPlugin, PrintPlugins, UnloadPlugin } = require("core/command/plugin");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name, `"core/command/plugin"`. |
| [`DisablePlugin`](#disableplugin) | Function | `DisablePlugin(PluginSelector)` |
| [`EnablePlugin`](#enableplugin) | Function | `EnablePlugin(PluginSelector)` |
| [`LoadPlugin`](#loadplugin) | Function | `LoadPlugin(strPluginName)` |
| [`PrintPlugins`](#printplugins) | Function | `PrintPlugins()` |
| [`ReloadAllPlugins`](#reloadallplugins) | Function | `ReloadAllPlugins()` |
| [`ReloadPlugin`](#reloadplugin) | Function | `ReloadPlugin(PluginSelector)` |
| [`UnloadAllPlugins`](#unloadallplugins) | Function | `UnloadAllPlugins()` |
| [`UnloadPlugin`](#unloadplugin) | Function | `UnloadPlugin(PluginSelector)` |

## Examples

### `DisablePlugin`

```js
const { DisablePlugin, EnablePlugin } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function IsHelloPluginRecord(PluginRecord) {
	return (PluginRecord.Name === "hello") && PluginRecord.Loaded && PluginRecord.Enabled;
}

const g_HelloPluginRecord = GetPluginRecords().find(IsHelloPluginRecord);
if (!g_HelloPluginRecord) {
	throw new Error("The hello example plugin must be loaded and enabled.");
}

// DisablePlugin unloads the plugin; EnablePlugin loads it again, so runtime state is not preserved.
if (!DisablePlugin(g_HelloPluginRecord.Index)) {
	throw new Error("Unable to disable the hello plugin.");
}

try {
	console.log("The hello plugin is disabled for this operation.");
} finally {
	if (!EnablePlugin("hello")) {
		throw new Error("Unable to restore the enabled hello plugin.");
	}
}
```

### `EnablePlugin`

```js
const { DisablePlugin, EnablePlugin } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function IsHelloPluginRecord(PluginRecord) {
	return (PluginRecord.Name === "hello") && PluginRecord.Loaded && PluginRecord.Enabled;
}

const g_bHelloPluginLoaded = GetPluginRecords().some(IsHelloPluginRecord);
if (!g_bHelloPluginLoaded) {
	throw new Error("The hello example plugin must be loaded and enabled before this example runs.");
}

// This cycle unloads and reloads the plugin; it does not restore its previous runtime state.
if (!DisablePlugin("hello")) {
	throw new Error("Unable to disable the hello plugin before enabling it.");
}

if (!EnablePlugin("hello")) {
	throw new Error("Unable to enable and load the hello plugin.");
}
```

### `LoadPlugin`

```js
const { LoadPlugin, UnloadPlugin } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function IsHelloPluginRecord(PluginRecord) {
	return PluginRecord.Name === "hello";
}

const g_ExistingPluginRecord = GetPluginRecords().find(IsHelloPluginRecord);
if (g_ExistingPluginRecord) {
	throw new Error("The hello plugin already has a manager record; choose a plugin absent from GetPluginRecords() for this example.");
}

if (!LoadPlugin("hello")) {
	throw new Error("Unable to load the hello plugin; check its installation, enabled state, and runtime diagnostics.");
}

try {
	console.log("The hello example plugin is loaded for this operation.");
} finally {
	if (!UnloadPlugin("hello")) {
		throw new Error("Unable to unload the hello example plugin during cleanup.");
	}
}
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/command/plugin");

console.log(`Plugin command module: ${MODULE_NAME}`);
```

### `PrintPlugins`

Returns the native list lines, including `"No plugins loaded."` when empty; the array length is not a plugin count.

```js
const { PrintPlugins } = require("core/command/plugin");

const g_vecPluginLines = PrintPlugins();
console.log(`Plugin list returned ${g_vecPluginLines.length} lines.`);
```

### `ReloadAllPlugins`

```js
const { ReloadAllPlugins } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function GetPluginRecordName(PluginRecord) {
	return PluginRecord.Name;
}

const g_bReloadAllCompleted = ReloadAllPlugins();
if (!g_bReloadAllCompleted) {
	throw new Error("The native reload-all call did not complete.");
}

const g_vecPluginRecordNames = GetPluginRecords().map(GetPluginRecordName);
const g_strPluginRecordNames = (g_vecPluginRecordNames.length > 0) ? g_vecPluginRecordNames.join(", ") : "none";
console.log(`Plugin records after reload-all: ${g_strPluginRecordNames}.`);
```

### `ReloadPlugin`

```js
const { ReloadPlugin } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function IsHelloPluginRecord(PluginRecord) {
	return (PluginRecord.Name === "hello") && PluginRecord.Loaded && PluginRecord.Enabled;
}

const g_HelloPluginRecord = GetPluginRecords().find(IsHelloPluginRecord);
if (!g_HelloPluginRecord) {
	throw new Error("The hello example plugin must be loaded and enabled.");
}

// ReloadPlugin unloads first; runtime state is lost and a failed load does not restore it.
if (!ReloadPlugin(g_HelloPluginRecord.Index)) {
	throw new Error("Unable to reload the hello plugin by index.");
}
```

### `UnloadAllPlugins`

```js
const { LoadPlugin, UnloadAllPlugins } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function GetPluginRecordName(PluginRecord) {
	return PluginRecord.Name;
}

function FindPluginRecord(strPluginName) {
	function IsNamedPluginRecord(PluginRecord) {
		return PluginRecord.Name === strPluginName;
	}

	return GetPluginRecords().find(IsNamedPluginRecord);
}

const g_vecPluginRecordNames = GetPluginRecords().map(GetPluginRecordName);
const g_vecPluginRestoreFailures = [];

// Run only in an isolated environment: loading again does not restore runtime state.
try {
	const bUnloadAllCompleted = UnloadAllPlugins();
	if (!bUnloadAllCompleted) {
		throw new Error("The native unload-all call did not complete.");
	}
} finally {
	for (const strPluginName of g_vecPluginRecordNames) {
		if (!FindPluginRecord(strPluginName) && !LoadPlugin(strPluginName)) {
			g_vecPluginRestoreFailures.push(strPluginName);
		}
	}

	if (g_vecPluginRestoreFailures.length > 0) {
		throw new Error(`Unable to reload plugins: ${g_vecPluginRestoreFailures.join(", ")}.`);
	}
}
```

### `UnloadPlugin`

```js
const { LoadPlugin, UnloadPlugin } = require("core/command/plugin");
const { GetPluginRecords } = require("plugins");

function IsHelloPluginRecord(PluginRecord) {
	return (PluginRecord.Name === "hello") && PluginRecord.Loaded && PluginRecord.Enabled;
}

const g_HelloPluginRecord = GetPluginRecords().find(IsHelloPluginRecord);
if (!g_HelloPluginRecord) {
	throw new Error("The hello example plugin must be loaded and enabled.");
}

// Loading again starts fresh; it does not restore the previous runtime state.
if (!UnloadPlugin(g_HelloPluginRecord.Index)) {
	throw new Error("Unable to unload the hello plugin by index.");
}

try {
	console.log("The hello plugin is unloaded for this operation.");
} finally {
	if (!LoadPlugin("hello")) {
		throw new Error("Unable to reload the hello plugin during cleanup.");
	}
}
```

### Registered commands

Requiring the module installs these nine case-sensitive command paths:

| Command | Operation |
| --- | --- |
| `sjs plugins` | `PrintPlugins()` |
| `sjs plugins list` | `PrintPlugins()` |
| `sjs plugins load <strPluginName>` | `LoadPlugin(strPluginName)` |
| `sjs plugins unload <strPluginSelector>` | `UnloadPlugin(strPluginSelector)` |
| `sjs plugins unload_all` | `UnloadAllPlugins()` |
| `sjs plugins reload <strPluginSelector>` | `ReloadPlugin(strPluginSelector)` |
| `sjs plugins reload_all` | `ReloadAllPlugins()` |
| `sjs plugins disable <strPluginSelector>` | `DisablePlugin(strPluginSelector)` |
| `sjs plugins enable <strPluginSelector>` | `EnablePlugin(strPluginSelector)` |

Command lookup uses the longest registered prefix. An unknown subcommand after `plugins` can fall back to listing; single-plugin
handlers use only the first remaining argument.

```js
const { CORE_COMMAND } = require("core/command");
const { MODULE_NAME } = require("core/command/plugin");

const g_bListCommandHandled = CORE_COMMAND.RunCommand("sjs plugins list");
if (!g_bListCommandHandled) {
	throw new Error(`Unable to run the plugin-list command registered by ${MODULE_NAME}.`);
}

// Reloading unloads the plugin and discards its runtime state.
const g_bReloadCommandHandled = CORE_COMMAND.RunCommand("sjs plugins reload hello");
if (!g_bReloadCommandHandled) {
	throw new Error(`Unable to run the plugin-reload command registered by ${MODULE_NAME}.`);
}

console.log("Plugin list and reload commands were handled.");
```

## Safe use

- Pass a plugin name to `LoadPlugin()`. The other single-plugin lifecycle helpers accept a name or a current 1-based index from
  `plugins.GetPluginRecords()`.
- Re-read plugin records before using an index. Load, unload, reload, enable, and disable operations can invalidate earlier
  index-to-plugin associations.
- Check every single-plugin lifecycle boolean, and treat a failed restore as a partial-state failure that requires operator
  attention.
- Run the lifecycle examples only in an isolated environment without concurrent lifecycle changes. Reloading or loading after
  an unload starts a fresh runtime; it does not restore previous plugin state. Cleanup can fail or throw, and an exception in
  cleanup can replace an earlier exception.
- These wrappers log after the native operation. Logging or lifecycle callbacks can throw after state has changed; a thrown
  exception is not proof that no change occurred. Inspect current records and diagnostics before retrying.
- `UnloadAllPlugins()` attempts to unload every currently loaded plugin. Its native binding returns `true` after the bulk call
  without aggregating individual unload failures. The wrapper logs completion of the pass, not success for every plugin.
- `ReloadAllPlugins()` unloads the current set and then runs normal auto-load discovery. Disabled plugins and plugins whose
  manifests set `"Autoload": false` are not loaded by that discovery pass; the native binding also returns `true` after the bulk
  call without aggregating individual failures. The wrapper logs completion of this enabled-plugin reload pass.
- `CORE_COMMAND.RunCommand()` reports whether a command was found and invoked, not whether the lifecycle callback returned
  `true`. For single-plugin paths, use the command log to inspect that callback result; bulk-path logs retain the
  non-aggregating limitation described above.
- Requiring this module registers nine command paths on the shared core command tree. Avoid the bulk paths in code that cannot
  tolerate broad lifecycle changes.

## Related files

- [`packages/sourcejs/core/command/plugin.js`](../../packages/sourcejs/core/command/plugin.js) — lifecycle wrappers and command
  registration.
- [`plugins.md`](plugins.md) — underlying plugin manager API and record shape.
- [`core-command.md`](core-command.md) — shared command manager used by this module.
