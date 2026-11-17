# `require("plugins/instance")`

> AI processing note: this page documents a name-bound live lifecycle wrapper. Keep stable wrapper identity,
> current manager queries, and destructive target-context operations distinct.

`plugins/instance` exports the `Plugin` lifecycle wrapper used by [`plugins/manager`](plugins-manager.md).
One wrapper stores a validated plugin name and manager reference; it does not cache a plugin record, load state,
or manifest metadata.

Use a controller plugin to manage another plugin. Synchronously unloading or disabling the plugin whose callback
is currently executing would destroy that callback's own V8 context.

## Contents

- [Import](#import)
- [Export](#export)
- [Constructor](#constructor)
- [Live Properties](#live-properties)
- [Lifecycle Methods](#lifecycle-methods)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const { Plugin } = require("plugins/instance");
```

## Export

| Export | Kind | Purpose |
| --- | --- | --- |
| [`Plugin`](#new-pluginstrpluginname-pluginmanager) | Class | Name-bound live view and lifecycle methods for one plugin. |

## Constructor

### `new Plugin(strPluginName, PluginManager)`

With the standard manager, `strPluginName` is validated through `PluginManager.GetPluginName(strPluginName)` and
must be a valid name rather than an index. `PluginManager` must be a non-null object, not an array or function, and provide the query and lifecycle methods used by this wrapper. Construction calls `GetPluginName()` and stores its result; it does not preflight every remaining method or require the plugin to be loaded. A custom manager is responsible for compatible validation and results.

```js
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER } = require("plugins/manager");

function CreatePluginController(strPluginName) {
	const ControlledPlugin = new Plugin(strPluginName, PLUGIN_MANAGER);

	return {
		Directory: ControlledPlugin.Directory,
		FilePath: ControlledPlugin.FilePath,
		Name: ControlledPlugin.Name,
		Manager: PLUGIN_MANAGER,
		Plugin: ControlledPlugin,
	};
}

module.exports = { CreatePluginController };
```

The `PluginManager` and `PluginName` fields remain ordinary mutable JavaScript properties. Treat both as construction-time values so manager maps and logs retain one stable identity. The wrapper retains the JavaScript manager reference but has no native-context ownership or cleanup operation.

## Live Properties

| Property | Result | Behavior |
| --- | --- | --- |
| `Name` | `string` | Reads the stored `PluginName`, without querying the manager. |
| `Record` | `PluginRecord \| null` | Calls `this.PluginManager.GetPluginRecord(this.PluginName)` now. |
| `Directory` | `string` | Uses the current record, then manager disk resolution. |
| `FilePath` | `string` | Uses the current entry, then manager disk resolution. |
| `Info` | `PluginInfo` | Synchronously reads current record/manifest metadata on every access; may perform filesystem IO. |
| `Loaded` | `boolean` | Calls `this.PluginManager.IsPluginLoaded(this.PluginName)` now. |
| `Enabled` | `boolean` | Calls `this.PluginManager.IsPluginEnabled(this.PluginName)` now. |

These result contracts describe the standard manager; the wrapper does not normalize custom manager return values. Native records are fresh JavaScript snapshots, not direct access to C++ state. Two reads create separate record objects even without a lifecycle operation; reference inequality does not prove a context-generation change. Re-read `Plugin.Record` after a lifecycle operation instead of retaining an old record. Separate getter calls are not one atomic snapshot, and custom manager callbacks may have their own side effects or reentrancy.

```js
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER } = require("plugins/manager");

function InspectPlugin(strPluginName) {
	const InspectedPlugin = new Plugin(strPluginName, PLUGIN_MANAGER);
	const Information = InspectedPlugin.Info;
	const PluginRecord = InspectedPlugin.Record;

	return {
		Directory: InspectedPlugin.Directory,
		Enabled: InspectedPlugin.Enabled,
		FilePath: InspectedPlugin.FilePath,
		Index: (PluginRecord === null) ? -1 : PluginRecord.Index,
		Loaded: InspectedPlugin.Loaded,
		Name: InspectedPlugin.Name,
		VerboseName: Information.VerboseName,
		Version: Information.Version,
	};
}

module.exports = { InspectPlugin };
```

## Lifecycle Methods

Each method synchronously forwards the stored name to its manager with that manager as the receiver. Return values and thrown values are preserved without coercion, retries or rollback. With the standard manager, native lifecycle work and any state-file IO run on the calling game thread; these methods are not asynchronous requests.

| Method | Manager call | Typical result |
| --- | --- | --- |
| `LoadPlugin()` | `this.PluginManager.LoadPlugin(this.PluginName)` | Loaded `Plugin` instance. |
| `UnloadPlugin()` | `this.PluginManager.UnloadPlugin(this.PluginName)` | `true`. |
| `ReloadPlugin()` | `this.PluginManager.ReloadPlugin(this.PluginName)` | Reloaded `Plugin` instance. |
| `DisablePlugin()` | `this.PluginManager.DisablePlugin(this.PluginName)` | `true`; current record disappears. |
| `EnablePlugin()` | `this.PluginManager.EnablePlugin(this.PluginName)` | Loaded `Plugin` instance. |

An exception can follow a completed native side effect or manager-map update; re-query current state before recovery. A failed reload can leave the target unloaded. The wrapper does not protect against self-targeting: caller policy must ensure that reload, unload and disable target another plugin, and callbacks triggered by those operations must not invalidate the controller's context either.

### Reload

On success, standard-manager reload destroys and recreates the target plugin context. The existing controller-side wrapper queries the replacement record even if the manager caches a new wrapper instance:

```js
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER } = require("plugins/manager");

function ReloadPlugin(strPluginName) {
	const ManagedPlugin = new Plugin(strPluginName, PLUGIN_MANAGER);
	if (!ManagedPlugin.Loaded) {
		const LoadedPlugin = ManagedPlugin.LoadPlugin();
		if (!(LoadedPlugin instanceof Plugin)) {
			throw new TypeError(`Plugin ${strPluginName} did not return a loaded Plugin instance.`);
		}
	}

	const PreviousPluginRecord = ManagedPlugin.Record;
	if (PreviousPluginRecord === null) {
		throw new Error(`Plugin ${strPluginName} has no record before reload.`);
	}

	const ReloadedPlugin = ManagedPlugin.ReloadPlugin();
	const CurrentPluginRecord = ManagedPlugin.Record;
	if (!(ReloadedPlugin instanceof Plugin) || (CurrentPluginRecord === null) || !ManagedPlugin.Loaded) {
		throw new Error(`Plugin ${strPluginName} has no current record after reload.`);
	}

	return { Name: ReloadedPlugin.Name };
}

module.exports = { ReloadPlugin };
```

### Disable And Enable

Disable normally removes the target's current record and marks its name disabled in memory. Enable clears that state and loads
from disk by name. Both attempt to save `PluginsState.json`, but directory/open/write failures are logged as warnings and do not by themselves make the lifecycle call fail. A successful result therefore does not prove persistence across restarts:

```js
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER } = require("plugins/manager");

function CyclePluginEnabledState(strPluginName) {
	const ManagedPlugin = new Plugin(strPluginName, PLUGIN_MANAGER);
	if (!ManagedPlugin.Loaded) {
		const InitiallyEnabledPlugin = ManagedPlugin.EnablePlugin();
		if (!(InitiallyEnabledPlugin instanceof Plugin)) {
			throw new TypeError(`Plugin ${strPluginName} did not return an enabled Plugin instance.`);
		}
	}

	const bPluginDisabled = ManagedPlugin.DisablePlugin();
	if ((bPluginDisabled !== true) || (ManagedPlugin.Record !== null) || ManagedPlugin.Loaded || ManagedPlugin.Enabled) {
		throw new Error(`Plugin ${strPluginName} did not enter disabled state.`);
	}

	const EnabledPlugin = ManagedPlugin.EnablePlugin();
	if (!(EnabledPlugin instanceof Plugin) || !ManagedPlugin.Loaded || !ManagedPlugin.Enabled) {
		throw new Error(`Plugin ${strPluginName} did not return to enabled state.`);
	}

	return EnabledPlugin.Name;
}

module.exports = { CyclePluginEnabledState };
```

### Unload And Load

Unload removes the current record but does not disable the plugin. A later load resolves the directory from disk;
there is no discovery-list dependency:

```js
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER } = require("plugins/manager");

function CyclePluginLoadedState(strPluginName) {
	const ManagedPlugin = new Plugin(strPluginName, PLUGIN_MANAGER);
	if (!ManagedPlugin.Loaded) {
		const InitiallyLoadedPlugin = ManagedPlugin.LoadPlugin();
		if (!(InitiallyLoadedPlugin instanceof Plugin)) {
			throw new TypeError(`Plugin ${strPluginName} did not return a loaded Plugin instance.`);
		}
	}

	const bPluginUnloaded = ManagedPlugin.UnloadPlugin();
	if ((bPluginUnloaded !== true) || (ManagedPlugin.Record !== null) || ManagedPlugin.Loaded) {
		throw new Error(`Plugin ${strPluginName} did not unload.`);
	}

	const LoadedPlugin = ManagedPlugin.LoadPlugin();
	if (!(LoadedPlugin instanceof Plugin) || !ManagedPlugin.Loaded) {
		throw new Error(`Plugin ${strPluginName} did not return to loaded state.`);
	}

	return LoadedPlugin.Name;
}

module.exports = { CyclePluginLoadedState };
```

The workflows verify a loaded target on success; the disable/enable workflow also verifies its enabled state. With the standard manager, reload and unload/load require an enabled target; they do not enable a disabled plugin. These checks establish current runtime state, not durable state-file persistence. If any step throws, earlier steps are not rolled back, so inspect current state rather than assuming restoration.

## Errors

- The constructor requires a non-null, non-array manager object and delegates name validation to `GetPluginName()`. Missing or non-callable methods fail when invoked; manager validation errors propagate directly.
- `Name` only reads stored identity. Other getters perform current manager queries, and path or metadata getters may perform synchronous filesystem work and propagate errors.
  An unloaded manifest-less plugin uses its resolved entry and constructor metadata defaults rather than requiring
  `plugin.json`.
- Lifecycle methods preserve manager return values and thrown values, including non-`Error` values from a custom manager; the wrapper does not log, catch or replace failures.
- Changing the `PluginName` or `PluginManager` fields can break stable identity and map ownership. Treat both as
  construction-time values.

## Lifecycle

The wrapper remains usable after the target unloads, reloads, disables, or enables because it stores only the stable
name and manager. Its `Record`, path, metadata, and state getters query again on every access.

Do not retain `Record` or `Info` values as live state. Re-read getters after every lifecycle operation; current record
indexes and manifest-derived values may change.

Controller code must target another plugin and handle the errors documented by [`plugins/manager`](plugins-manager.md). The wrapper's usability depends on a valid controller context and usable manager runtime dependencies; it does not keep a destroyed native context alive.

## Related Modules

- [`plugins/manager`](plugins-manager.md) validates selectors and owns wrapper identity.
- [`plugins/info`](plugins-info.md) supplies manifest metadata values.
- [`plugins`](plugins.md) exposes direct native records and lifecycle operations.
