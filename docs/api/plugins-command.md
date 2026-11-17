# `require("plugins/command")`

> AI processing note: this page documents a plugin-owned typed subcommand controller. Keep the root command, manager
> selectors, logging policy, and registration cleanup explicit.

`plugins/command` builds typed server, client, and chat subcommands under one plugin-owned root command. It also provides
consistent logging and guarded calls into [`plugins/manager`](plugins-manager.md) for administrative plugin controllers.

This module does not replace the native `sjs plugins ...` command. Use a distinct root such as `sjs_tools` for plugin-defined
controls, register callbacks on the returned typed registrations, and export one unload function that calls `Dispose()`.

## Contents

- [Import](#import)
- [Export](#export)
- [Constructor](#constructor)
- [Typed Subcommands](#typed-subcommands)
- [Plugin Lifecycle Helpers](#plugin-lifecycle-helpers)
- [Plugin Listing](#plugin-listing)
- [Logging](#logging)
- [Cleanup](#cleanup)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const { SubCommandManager } = require("plugins/command");
```

## Export

| Export | Kind | Purpose |
| --- | --- | --- |
| [`SubCommandManager`](#new-subcommandmanagerpluginmanager--plugin_manager-strrootcommandname--sjs-commandoptions--) | Class extending `Array` | Owns typed subcommand registrations and plugin-management output. |

## Constructor

### `new SubCommandManager(PluginManager = PLUGIN_MANAGER, strRootCommandName = "sjs", CommandOptions = {})`

`PluginManager` supplies the lifecycle methods from `plugins/manager`. `strRootCommandName` is the first token prepended to every
subcommand path. `CommandOptions` supports:

| Option | Type | Purpose |
| --- | --- | --- |
| `Prefix` | `string` | Prefix added to informational and warning messages. Defaults to `[<COMMAND>] `. |
| `Logger.Info(strMessageText)` | `function` | Informational output target. |
| `Logger.Warning(strMessageText)` | `function` | Warning output target. |

The internal `CommandName`, `MessagePrefix`, `PluginManager`, and `CommandLogger` fields remain writable for
deliberate runtime reconfiguration. `CommandName` affects only future registration paths; it does not rename existing commands. The array storage owns registrations: do not remove entries manually. Array-copying methods return ordinary arrays containing the same registration objects, not independent owners.

```js
const { LogInfo, LogWarning } = require("loggers");
const { SubCommandManager } = require("plugins/command");
const { PLUGIN_MANAGER } = require("plugins/manager");

function CreateToolsCommandManager() {
	const vecManager = new SubCommandManager(PLUGIN_MANAGER, "sjs_tools", {
		Logger: { Info: LogInfo, Warning: LogWarning },
		Prefix: "[SourceJS Tools] ",
	});

	return {
		CommandName: vecManager.CommandName,
		Commands: vecManager,
		MessagePrefix: vecManager.MessagePrefix,
	};
}

function ReconfigureCommandManager(vecManager, strCommandName, strMessagePrefix) {
	if (!(vecManager instanceof SubCommandManager) || (vecManager.length !== 0)) {
		throw new Error("Reconfigure only an empty SubCommandManager before creating registrations.");
	}

	if ((typeof strCommandName !== "string") || (strCommandName.length === 0) || (typeof strMessagePrefix !== "string")) {
		throw new TypeError("CommandName and MessagePrefix must be valid strings.");
	}

	vecManager.CommandName = strCommandName;
	vecManager.MessagePrefix = strMessagePrefix;

	return { CommandName: vecManager.CommandName, MessagePrefix: vecManager.MessagePrefix };
}

module.exports = { CreateToolsCommandManager, ReconfigureCommandManager };
```

## Typed Subcommands

- `ServerSubCommand(CommandNames, CommandOptions = {})` returns a `TypedServerCommandRegistration` for a server-console
  subcommand.
- `ClientSubCommand(CommandNames, strRequiredPermission = null, CommandOptions = {})` returns a
  `TypedClientCommandRegistration` for a client-console subcommand.
- `SaySubCommand(CommandNames, strRequiredPermission = null, CommandOptions = {})` returns a `TypedSayCommandRegistration` for
  a chat subcommand.

`CommandNames` is one non-empty string or an array of non-empty strings. The manager prepends its root command but does not
register a callback automatically. Call `Register(Callback)` on the returned typed registration. `strRequiredPermission` uses the
authorization rules from [`commands/auth`](commands-auth.md). For client/chat factories, this explicit permission argument overrides `CommandOptions.Permission`, including when it is `null`. Options must be plain objects with `Object.prototype` or a null prototype. Existing console command tokens are public CLI contracts, not serialized property names.

This plugin example owns three concrete paths and releases them through one lifecycle export. Configure its permission policy to exclude the controller itself from reload targets: the helper does not establish caller identity or enforce that policy automatically. Failed load cleanup preserves both errors and retains the controller while the context is live; it does not prevent host teardown after failed loading:

```js
const { SubCommandManager } = require("plugins/command");

let g_vecCommands = null;

function Load() {
	if (g_vecCommands !== null) {
		throw new Error("The sjs_tools command controller is already loaded.");
	}

	g_vecCommands = new SubCommandManager(undefined, "sjs_tools");

	try {
		const ListCommand = g_vecCommands.ServerSubCommand("plugins", {
			Description: "List loaded SourceJS plugins.",
		});
		if (ListCommand.Register(() => g_vecCommands.PrintPlugins()) !== ListCommand) {
			throw new Error("The server subcommand did not return its registration.");
		}

		const ReloadCommand = g_vecCommands.ClientSubCommand(["plugins", "reload"], "sourcejs.plugins", {
			Description: "Reload a plugin by name.",
			Parameters: [{ Name: "strPluginName", Type: String }],
		});
		if (ReloadCommand.Register((Context, strPluginName) => {
			const Plugin = g_vecCommands.ReloadPlugin(strPluginName);
			Context.Reply((Plugin !== null) ? `Reloaded ${Plugin.Name}.` : `Could not reload ${strPluginName}.`);
		}) !== ReloadCommand) {
			throw new Error("The client subcommand did not return its registration.");
		}

		const CountCommand = g_vecCommands.SaySubCommand("plugin-count", null, {
			Description: "Show the loaded plugin count.",
		});
		if (CountCommand.Register((Context) => {
			Context.Reply(`${g_vecCommands.PluginManager.GetPluginRecords().length} plugin(s) loaded.`);
		}) !== CountCommand) {
			throw new Error("The say subcommand did not return its registration.");
		}
	} catch (CaughtError) {
		try {
			if (g_vecCommands.Dispose() !== true) {
				throw new Error("Command controller cleanup did not complete.");
			}
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Command registration and cleanup both failed.");
		}

		g_vecCommands = null;
		throw CaughtError;
	}

	return true;
}

function Unload() {
	if (g_vecCommands === null) {
		return false;
	}

	if (g_vecCommands.Dispose() !== true) {
		throw new Error("Command controller cleanup did not complete.");
	}

	g_vecCommands = null;

	return true;
}

module.exports = { Load, Unload };
```

## Plugin Lifecycle Helpers

| Method | Success | Failure |
| --- | --- | --- |
| `LoadPlugin(strPluginName)` | Loaded `Plugin` instance. | Logs a warning and returns `null`. |
| `UnloadPlugin(PluginSelector)` | Exact manager boolean. | Logs a warning and returns `false`. |
| `ReloadPlugin(PluginSelector)` | Reloaded `Plugin` instance. | Logs a warning and returns `null`. |

`LoadPlugin` accepts a plugin name because native loading resolves a disk directory by name. The unload and reload helpers
forward a manager selector, but a name is preferable in long-lived controller code because record indexes change after every
unload.

The controller must target another plugin. This workflow cycles a caller-selected plugin and leaves it loaded on success only. It is not transactional: a failure or logger exception can occur after a native side effect, and the initial state is not automatically restored. Capture names before replacing/unloading their plugin instances:

```js
const { SubCommandManager } = require("plugins/command");
const { PLUGIN_MANAGER } = require("plugins/manager");

function CyclePluginLifecycle(strPluginName) {
	const vecCommands = new SubCommandManager(PLUGIN_MANAGER, "sjs_tools");
	if (PLUGIN_MANAGER.IsPluginLoaded(strPluginName) && (vecCommands.UnloadPlugin(strPluginName) !== true)) {
		throw new Error(`Plugin ${strPluginName} could not be prepared for load.`);
	}

	const LoadedPlugin = vecCommands.LoadPlugin(strPluginName);
	if (LoadedPlugin === null) {
		throw new Error(`Plugin ${strPluginName} could not be loaded.`);
	}

	const strLoadedPluginName = LoadedPlugin.Name;

	const ReloadedPlugin = vecCommands.ReloadPlugin(strPluginName);
	if (ReloadedPlugin === null) {
		throw new Error(`Plugin ${strPluginName} could not be reloaded.`);
	}

	const strReloadedPluginName = ReloadedPlugin.Name;

	if (vecCommands.UnloadPlugin(strPluginName) !== true) {
		throw new Error(`Plugin ${strPluginName} could not be unloaded.`);
	}

	const RestoredPlugin = vecCommands.LoadPlugin(strPluginName);
	if (RestoredPlugin === null) {
		throw new Error(`Plugin ${strPluginName} could not be restored.`);
	}

	return {
		Loaded: strLoadedPluginName,
		Reloaded: strReloadedPluginName,
		Restored: RestoredPlugin.Name,
	};
}

module.exports = { CyclePluginLifecycle };
```

## Plugin Listing

### `PrintPlugins()`

`PrintPlugins()` reads fresh manager records, loads each manifest through `GetPluginInfo()`, writes one prefixed multiline
message, and returns the unprefixed lines. The controller does not filter `Loaded` or `Enabled`; it renders their current boolean values. Records and manifests come from the supplied manager, so a custom manager controls which plugins appear. An absent (`null`) or empty description uses the record's entry path; other non-string description values are rejected.

```js
const { SubCommandManager } = require("plugins/command");

function InspectPluginListing() {
	const vecMessages = [];
	const vecCommands = new SubCommandManager(undefined, "sjs_tools", {
		Logger: {
			Info(strMessageText) {
				vecMessages.push(strMessageText);
			},
			Warning(strMessageText) {
				throw new Error(`Unexpected listing warning: ${strMessageText}`);
			},
		},
	});
	const vecLines = vecCommands.PrintPlugins();

	return { Lines: vecLines, Messages: vecMessages };
}

module.exports = { InspectPluginListing };
```

## Logging

| Method | Purpose |
| --- | --- |
| `LogMessage(strMessageText)` | Sends a prefixed string to `CommandLogger.Info`. |
| `LogWarning(strMessageText)` | Sends a prefixed string to `CommandLogger.Warning`. |
| `LogPluginError(strPluginAction, PluginSelector, PluginLifecycleError)` | Maps known manager errors to concise warnings. |

Known mappings cover `InvalidPluginName`, `PluginAlreadyLoaded`, `PluginDisabled`, `PluginFileNotFoundError`,
`PluginNotLoaded`, and `PluginLoadError`. An unknown `Error` uses its non-empty string `message`; an empty message uses the
operation-specific fallback warning. `strPluginAction` accepts the exact existing public operation literals `"load"`, `"unload"` and `"reload"`; preserve this compatibility contract rather than changing their spelling. Non-`Error` thrown values are rejected by `LogPluginError()`.

Logging is synchronous and calls each logger with `CommandLogger` as its receiver. Logger errors propagate; even an error-reporting logger can throw. A failure after a successful manager operation is not proof that no plugin state changed.

```js
const { SubCommandManager } = require("plugins/command");
const { PluginNotLoaded } = require("plugins/manager");

function InspectControllerLogging() {
	const vecInfoMessages = [];
	const vecWarningMessages = [];
	const vecCommands = new SubCommandManager(undefined, "sjs_tools", {
		Logger: {
			Info(strMessageText) {
				vecInfoMessages.push(strMessageText);
			},
			Warning(strMessageText) {
				vecWarningMessages.push(strMessageText);
			},
		},
	});
	vecCommands.LogMessage("Plugin maintenance started.");
	vecCommands.LogWarning("Reloading plugins interrupts their callbacks.");
	vecCommands.LogPluginError("unload", "missing-plugin", new PluginNotLoaded("missing-plugin is not loaded"));

	return { InfoMessages: vecInfoMessages, WarningMessages: vecWarningMessages };
}

module.exports = { InspectControllerLogging };
```

## Cleanup

### `Dispose()`

`Dispose()` snapshots the current registration array, calls `Unload()` on each snapshot entry, and removes every successfully handled registration from the
manager array. If one registration throws or returns a non-boolean result, cleanup continues for the remaining registrations,
the failed registration remains available for another `Dispose()` call, and the first thrown value is rethrown after cleanup, including `null` or `undefined`. Both boolean results from a typed registration's `Unload()` are accepted: `false` means it was already unloaded. Successful disposal returns `true`, including for an empty controller; it does not aggregate subsequent cleanup errors.

Registrations added reentrantly during cleanup remain outside the snapshot. A `true` result therefore does not guarantee an empty controller under reentrancy; dispose retained registrations explicitly while the context is live.

The typed-subcommand example above exports the intended cleanup pattern. SourceJS also removes context-owned native callbacks
when a plugin unloads, but explicit disposal keeps JavaScript registration stores and native command ownership synchronized.

## Errors

- The constructor defaults an omitted or `undefined` manager to `PLUGIN_MANAGER`; it rejects null, primitive or array managers, empty roots, non-plain options, non-string prefixes, and loggers without `Info`/`Warning` functions. It does not prevalidate every manager method. Own options set to `undefined` use their defaults.
- Subcommand paths must contain non-empty strings. Typed registration and callback validation errors propagate directly.
- Lifecycle helpers validate inputs before invoking the manager. Nonempty string names and positive safe-integer selectors are accepted as applicable. Manager `Error` failures are logged and yield `null` for load/reload or `false` for unload; logging errors and non-`Error` thrown values can instead propagate. Invalid results raise `TypeError`; no substitute plugin record is created.
- `PrintPlugins()` and direct logging methods propagate logger, manifest and manager errors.
- `Dispose()` continues after a registration cleanup failure, removes successful registrations, retains failed registrations for
  retry, and rethrows the first cleanup error.

## Lifecycle

Constructing a `SubCommandManager` does not register commands. Each call to a typed subcommand factory creates one owned
registration; `Register(Callback)` activates it.

Create and register the controller during plugin `Load()`. Call `Dispose()` during `Unload()` and then release the manager
reference only after successful disposal. If disposal throws, retain the owner for a manual retry only while the context is still live. The native context cleanup remains a final safety boundary, not a replacement for explicit JavaScript ownership.

The example exports `Load` and `Unload`, the runtime's case-sensitive SourceJS-owned lifecycle keys; there are no lowercase aliases. The host ignores lifecycle return values. A thrown load error starts host unload and teardown; returning `false` or throwing from `Unload` does not cancel that teardown or preserve the controller for delayed retry.

Administrative helpers must target another plugin. Unloading or reloading the plugin whose callback is currently running
can invalidate its context and callback state. These helpers do not prevent self-targeting.

## Related Modules

- [`commands/typed`](commands-typed.md) defines registrations, parameters and callback contexts.
- [`plugins/manager`](plugins-manager.md) owns validated plugin lifecycle operations.
- [`plugins`](plugins.md) exposes the direct native lifecycle object.
- [`loggers`](loggers.md) provides the default output functions.
