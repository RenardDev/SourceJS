# `require("core/command")`

> Warning: This API reference is large for AI-agent processing. Use the table of contents to navigate directly to the
> relevant section.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Registered Command Record](#registered-command-record)
- [Command List Row](#command-list-row)
- [Command Callback Context](#command-callback-context)
- [`CoreCommandManager`](#corecommandmanager)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/command.js`](../../packages/sourcejs/core/command.js). `CoreCommandManager`
normalizes command paths, dispatches the longest registered prefix, and builds help text. The exported `CORE_COMMAND` instance
owns the shared `sjs` command tree; separately constructed managers have their own registrations. A
callback receives the full normalized `Arguments` array and the unmatched `CommandArguments` tail.

## Import

```js
const { CORE_COMMAND, CoreCommandManager, NormalizeCommandPath } = require("core/command");
```

## Exports

| Export | Kind | Contract |
| --- | --- | --- |
| [`CORE_COMMAND`](#core_command) | Instance | Shared `CoreCommandManager` for the `sjs` command tree. |
| [`CoreCommandManager`](#corecommandmanager-1) | Class | `new CoreCommandManager(Options = {})` |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name (`"core/command"`). |
| [`NormalizeCommandPath`](#normalizecommandpath) | Function | `NormalizeCommandPath(CommandPath)`; accepts a string or an array of strings. |

## Registered Command Record

| Member | Purpose |
| --- | --- |
| `Callback` | Writable property containing the registered command callback. |
| `Description` | Writable property containing the help description. |
| `Path` | Writable property containing the normalized command path array. |

## Command List Row

| Member | Purpose |
| --- | --- |
| `Description` | Help description. |
| `Signature` | Root-prefixed command signature. |

## Command Callback Context

| Member | Purpose |
| --- | --- |
| Custom fields | Own enumerable fields copied from the `RunCommand()` context before the required fields below replace collisions. |
| `Arguments` | Full normalized arguments after an optional leading root command name. |
| `CommandArguments` | Tail after the longest matching registered path. |
| `CommandManager` | Dispatching `CoreCommandManager`. |

## `CoreCommandManager`

### Constructor options

| Option | Purpose |
| --- | --- |
| `Name` | Non-empty root command name; defaults to `"sjs"`. |
| `Logger` | Object or function providing `LogInfo(strMessage)` and `LogWarning(strMessage)`. |

### `RegisterCommand` options

| Option | Purpose |
| --- | --- |
| `Description` | Help description stored with the command; defaults to `""`. |

### Members

| Member | Contract |
| --- | --- |
| `Name` | Writable root command name, initially set from `Options.Name` or `"sjs"`. |
| `Commands` | Writable property containing the live `Map` keyed by normalized command paths. |
| `Logger` | Writable property containing the logger used by message and warning methods. |
| `GetCommandPathKey` | `GetCommandPathKey(CommandPath)` |
| `RegisterCommand` | `RegisterCommand(CommandPath, Callback, Options = {})` |
| `UnregisterCommand` | `UnregisterCommand(CommandPath)` |
| `RunCommand` | `RunCommand(CommandLine, Context = {})`; accepts a command-line string or an array of string tokens. |
| `GetCommandList` | `GetCommandList(CommandPath = [])` |
| `GetCommandHelp` | `GetCommandHelp(CommandPath = [])` |
| `LogCommandMessage` | `LogCommandMessage(Message)`; converts `Message` with `String()` before calling the configured logger. |
| `LogCommandWarning` | `LogCommandWarning(Message)`; converts `Message` with `String()` before calling the configured logger. |
| `PrintSourceJSCredits` | `PrintSourceJSCredits()` |
| `PrintSourceJSInfo` | `PrintSourceJSInfo()` |
| `PrintCommandHelp` | `PrintCommandHelp(CommandPath = [])` |

## Examples

### `CORE_COMMAND`

```js
const { CORE_COMMAND } = require("core/command");

function ShowMatchStatus(CommandContext) {
	const strMatchID = CommandContext.CommandArguments[0] ?? "current";
	console.log(`Showing status for match ${strMatchID}.`);
}

const g_vecCommandPath = ["match", "status"];
const g_strCommandPathKey = CORE_COMMAND.GetCommandPathKey(g_vecCommandPath);
if (CORE_COMMAND.Commands.has(g_strCommandPathKey)) {
	throw new Error("The match status command is already registered; choose another path.");
}

CORE_COMMAND.RegisterCommand(g_vecCommandPath, ShowMatchStatus, { Description: "Show the current match status." });

function UnloadPlugin() {
	const CommandRecord = CORE_COMMAND.Commands.get(g_strCommandPathKey);
	if (!CommandRecord || (CommandRecord.Callback !== ShowMatchStatus)) {
		return false;
	}

	return CORE_COMMAND.UnregisterCommand(g_vecCommandPath);
}

exports.Unload = UnloadPlugin;
```

### `CoreCommandManager`

```js
const { CoreCommandManager } = require("core/command");

function ShowMatchStatus(CommandContext) {
	const strMatchID = CommandContext.CommandArguments[0] ?? "current";
	console.log(`Match status requested for ${strMatchID}.`);
}

const g_MatchCommandManager = new CoreCommandManager({ Name: "sjs_match" });
g_MatchCommandManager.RegisterCommand(["status"], ShowMatchStatus, { Description: "Show one match." });

if (!g_MatchCommandManager.RunCommand("sjs_match status \"finals-1\"")) {
	throw new Error("Unable to dispatch the match status command.");
}
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/command");

console.log(`Command tree implementation: ${MODULE_NAME}`);
```

### `NormalizeCommandPath`

```js
const { NormalizeCommandPath } = require("core/command");

const g_vecCommandPath = NormalizeCommandPath("plugins load \"match stats\"");
console.log(g_vecCommandPath);
// ["plugins", "load", "match stats"]
```

### `CoreCommandManager.GetCommandHelp`

```js
const { CoreCommandManager } = require("core/command");

function ReloadPlugin() {
}

function ReloadAllPlugins() {
}

// These no-op callbacks demonstrate help formatting, not plugin lifecycle operations.
const g_PluginCommandManager = new CoreCommandManager();
g_PluginCommandManager.RegisterCommand(["plugins", "reload"], ReloadPlugin, { Description: "Reload one plugin." });
g_PluginCommandManager.RegisterCommand(["plugins", "reload_all"], ReloadAllPlugins, { Description: "Reload every loaded plugin." });

console.log(g_PluginCommandManager.GetCommandHelp(["plugins"]));
```

### `CoreCommandManager.GetCommandList`

```js
const { CoreCommandManager } = require("core/command");

function LoadExtension() {
}

function UnloadExtension() {
}

// These callbacks are placeholders for listing commands; they do not change extensions.
const g_ExtensionCommandManager = new CoreCommandManager();
g_ExtensionCommandManager.RegisterCommand(["extensions", "load"], LoadExtension, { Description: "Load an extension by name." });
g_ExtensionCommandManager.RegisterCommand(["extensions", "unload"], UnloadExtension, { Description: "Unload an extension by name or index." });

for (const CommandListRow of g_ExtensionCommandManager.GetCommandList(["extensions"])) {
	console.log(`${CommandListRow.Signature}: ${CommandListRow.Description}`);
}
```

### `CoreCommandManager.LogCommandMessage`

```js
const { CoreCommandManager } = require("core/command");

const g_CommandManager = new CoreCommandManager();
g_CommandManager.LogCommandMessage("Core command logging example.");
```

### `CoreCommandManager.LogCommandWarning`

```js
const { CoreCommandManager } = require("core/command");

const g_CommandManager = new CoreCommandManager();
g_CommandManager.LogCommandWarning("Demonstration warning; no plugin state was checked.");
```

### `CoreCommandManager.GetCommandPathKey`

```js
const { CoreCommandManager } = require("core/command");

const g_CommandManager = new CoreCommandManager();
const g_strCommandPathKey = g_CommandManager.GetCommandPathKey(["plugins", "reload"]);
console.log(g_strCommandPathKey);
// plugins reload
```

### `CoreCommandManager.PrintSourceJSCredits`

```js
const { CoreCommandManager } = require("core/command");

const g_CommandManager = new CoreCommandManager();
const g_strCredits = g_CommandManager.PrintSourceJSCredits();
console.log(`Printed ${g_strCredits.split("\n").length} output lines.`);
```

### `CoreCommandManager.PrintCommandHelp`

```js
const { CoreCommandManager } = require("core/command");

function ListPlugins() {
	console.log("Plugin-list demonstration callback invoked.");
}

function LoadPlugin(CommandContext) {
	const strPluginPath = CommandContext.CommandArguments[0];
	if (!strPluginPath) {
		throw new Error("Usage: sjs plugins load <strPluginPath>");
	}

	console.log(`Demonstration path: ${strPluginPath}; no plugin is loaded.`);
}

// These local demonstration commands only illustrate help output.
const g_PluginCommandManager = new CoreCommandManager();
g_PluginCommandManager.RegisterCommand(["plugins", "list"], ListPlugins, { Description: "Demonstrate a plugin-list command." });
g_PluginCommandManager.RegisterCommand(["plugins", "load"], LoadPlugin, { Description: "Demonstrate a path argument without loading a plugin." });

g_PluginCommandManager.PrintCommandHelp(["plugins"]);
```

### `CoreCommandManager.PrintSourceJSInfo`

```js
const { CoreCommandManager } = require("core/command");

const g_CommandManager = new CoreCommandManager();
const g_strRuntimeInformation = g_CommandManager.PrintSourceJSInfo();
console.log(`Printed runtime information (${g_strRuntimeInformation.length} UTF-16 code units).`);
```

### `CoreCommandManager.RegisterCommand`

```js
const { CORE_COMMAND } = require("core/command");

function StartMatch(CommandContext) {
	const strMapName = CommandContext.CommandArguments[0];
	if (!strMapName) {
		throw new Error("Usage: sjs match start <strMapName>");
	}

	console.log(`Demonstration map: ${strMapName}; no match is started.`);
}

const g_vecCommandPath = ["match", "start"];
const g_strCommandPathKey = CORE_COMMAND.GetCommandPathKey(g_vecCommandPath);
if (CORE_COMMAND.Commands.has(g_strCommandPathKey)) {
	throw new Error("The match start command is already registered; choose another path.");
}

const g_RegisteredCallback = CORE_COMMAND.RegisterCommand(g_vecCommandPath, StartMatch, { Description: "Demonstrate a map argument without starting a match." });
console.log(`Registered callback: ${g_RegisteredCallback.name || "anonymous"}`);

function UnloadPlugin() {
	const CommandRecord = CORE_COMMAND.Commands.get(g_strCommandPathKey);
	if (!CommandRecord || (CommandRecord.Callback !== g_RegisteredCallback)) {
		return false;
	}

	return CORE_COMMAND.UnregisterCommand(g_vecCommandPath);
}

exports.Unload = UnloadPlugin;
```

### `CoreCommandManager.RunCommand`

```js
const { CoreCommandManager } = require("core/command");

function ReportPlayerScore(CommandContext) {
	const unPlayerIndex = Number(CommandContext.CommandArguments[0]);
	if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 1)) {
		throw new Error("Usage: sjs_match player score <unPlayerIndex> (positive safe integer)");
	}

	console.log(`${CommandContext.RequestedBy} used ${CommandContext.CommandManager.Name} to request the score for player ${unPlayerIndex}.`);
}

const g_CommandManager = new CoreCommandManager({ Name: "sjs_match" });
g_CommandManager.RegisterCommand(["player", "score"], ReportPlayerScore);

const g_bCommandHandled = g_CommandManager.RunCommand("sjs_match player score 3", { RequestedBy: "server console" });
console.log(`Command handled: ${g_bCommandHandled}`);
```

### `CoreCommandManager.UnregisterCommand`

```js
const { CoreCommandManager } = require("core/command");

function CancelMatch() {
	console.log("Demonstration callback invoked; no match is cancelled.");
}

const g_CommandManager = new CoreCommandManager();
const g_vecCommandPath = ["match", "cancel"];
g_CommandManager.RegisterCommand(g_vecCommandPath, CancelMatch);

const g_bCommandRemoved = g_CommandManager.UnregisterCommand(g_vecCommandPath);
console.log(`Command removed: ${g_bCommandRemoved}`);
```

### `CoreCommandManager` state

```js
const { CoreCommandManager } = require("core/command");

const g_vecLogMessages = [];
const g_CommandLogger = {
	LogInfo(strMessage) {
		g_vecLogMessages.push({ Level: "INFO", Message: strMessage });
	},
	LogWarning(strMessage) {
		g_vecLogMessages.push({ Level: "WARNING", Message: strMessage });
	},
};
const g_CommandManager = new CoreCommandManager({ Name: "sjs_match", Logger: g_CommandLogger });

function ShowMatchStatus() {
	console.log("Current match status requested.");
}

g_CommandManager.RegisterCommand(["match", "status"], ShowMatchStatus, { Description: "Show the current match status." });

const g_StatusCommandRecord = g_CommandManager.Commands.get("match status");
if (!g_StatusCommandRecord) {
	throw new Error("The match status command was not registered.");
}

g_CommandManager.LogCommandMessage(`Registered commands: ${g_CommandManager.Commands.size}`);

const g_CommandRecordState = {
	CallbackName: g_StatusCommandRecord.Callback.name,
	Description: g_StatusCommandRecord.Description,
	Path: g_StatusCommandRecord.Path,
};
const g_CommandManagerState = {
	Name: g_CommandManager.Name,
	CommandRecord: g_CommandRecordState,
	LogMessages: g_vecLogMessages,
};
console.log(g_CommandManagerState);
```

## Safe use

- Pair each shared `CORE_COMMAND.RegisterCommand()` call with `UnregisterCommand()` during the plugin's `Unload` lifecycle.
- Treat `Commands` and its command records as live state. Prefer the manager methods instead of mutating the map directly.
- `RegisterCommand()` replaces an existing record with the same normalized path, performs no cleanup for the replaced callback,
  and returns the newly registered callback.
- Registration keys join tokens with a single space; token boundaries are not escaped. For example, `["a b"]` and `["a", "b"]`
  share a key. Use unambiguous registration tokens and check for an occupied key before registering shared commands. During
  cleanup, verify that the record still belongs to your callback before removing it.
- `UnregisterCommand()` returns `true` only when it removes an existing normalized path.
- `RunCommand()` normalizes a command-line string or an array of string tokens through `NormalizeCommandPath()`. It removes
  an optional leading root name,
  dispatches the longest matching path, and returns `false` after logging when no path matches. After a callback returns,
  `RunCommand()` returns `true` regardless of the callback's return value; callback exceptions propagate to the caller.
- Dispatch is synchronous and does not await a returned promise. Handle asynchronous failures within the callback; the returned
  boolean does not report asynchronous completion. Logging and context getters can also throw, so failure paths need not return
  a boolean.
- Required callback-context fields replace colliding custom context fields. Do not use `Arguments`,
  `CommandArguments`, or `CommandManager` for unrelated context data.
- `NormalizeCommandPath()` returns a fresh array. String inputs are tokenized, while array inputs must contain only strings;
  empty array elements are discarded.
- A custom logger must expose callable `LogInfo()` and `LogWarning()` members.
- `PrintSourceJSInfo()` reads [`core.GetGlobalInfo()`](core.md) and logs its own enumerable string-keyed runtime-information fields before returning the formatted text. Review whether
  those values are suitable for the configured log destination; printing only a summary afterward does not hide that output.

## Related files

- [`core`](core.md) provides `Tokenizer` and the runtime information printed by `PrintSourceJSInfo()`.
- [`commands`](commands.md) provides higher-level command managers and decorators.
- [`loggers`](loggers.md) supplies the default information and warning functions.
