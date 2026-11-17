# `require("commands/server")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Registration examples include the matching unload operation.

`ModuleBindings.cpp` installs all three native server-command operations unconditionally: `ExecuteServerCommand`, `RegisterCommand`, and `UnregisterCommand`. The public wrapper exposes them as `ExecuteCommand`, `RegisterCommand`, and `UnregisterCommand`.

## Location and purpose

The public wrapper lives in [`packages/sourcejs/commands/server.js`](../../packages/sourcejs/commands/server.js) and exposes the native server-command runtime. Use it to execute server console text and register callbacks for plugin-owned server commands without involving a player or chat channel.

## Import

```js
const { ExecuteCommand, RegisterCommand, UnregisterCommand } = require("commands/server");

console.log(ExecuteCommand, RegisterCommand, UnregisterCommand);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`ExecuteCommand`](#executecommand) | Function | `ExecuteCommand(strCommand)` |
| [`RegisterCommand`](#registercommand) | Function | `RegisterCommand(strCommandName, Callback)` |
| [`UnregisterCommand`](#unregistercommand) | Function | `UnregisterCommand(strCommandName, Callback?)` |

Pass the original callback to remove only that registration. An omitted callback or non-function value removes all callbacks for the name in the current runtime. A missing name or unmatched callback returns `false`; check cleanup results.

Use a string command name. Native registration and removal preserve ordinary JavaScript string conversion, case, and UTF-8 content; an exception from `toString()` reaches the caller unchanged and stops the runtime operation. Embedded NUL characters produce `Error` before registration or removal, instead of allowing the SDK to see a truncated name. A nonthrowing conversion failure reports a conversion error. Registration, removal and execution boundaries translate C++ exceptions into contextual JavaScript errors without exposing exception text. Execution submits the command before asking the engine to execute it, so a later failure does not roll back that submission.

## Examples

### `ExecuteCommand`

```js
const { ExecuteCommand } = require("commands/server");

if (!ExecuteCommand("sjs plugins list")) {
	throw new Error("Unable to execute the plugin-list command.");
}
```

### `RegisterCommand`

```js
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { GetGlobalVariables } = require("globals");

function ShowCurrentMap() {
	console.log(GetGlobalVariables().MapName);
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_current_map", ShowCurrentMap)) {
		throw new Error("Unable to unregister the current-map command.");
	}
}

if (!RegisterCommand("sjs_current_map", ShowCurrentMap)) {
	throw new Error("Unable to register the current-map command.");
}

exports.Unload = UnloadPlugin;
```

### `UnregisterCommand`

```js
const { RegisterCommand, UnregisterCommand } = require("commands/server");
const { GetAllPlayers } = require("players");

function ShowPlayerCount() {
	console.log(GetAllPlayers().length);
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_player_count", ShowPlayerCount)) {
		throw new Error("Unable to unregister the player-count command.");
	}
}

if (!RegisterCommand("sjs_player_count", ShowPlayerCount)) {
	throw new Error("Unable to register the player-count command.");
}

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Keep each registered callback reference and unregister the same command-name/callback pair during plugin unload. Omitting `Callback` or passing a non-function removes all callbacks for that name.
- Root `commands/server` callback results are ignored by native dispatch. Return semantic results only from `commands/client` or `commands/say` callbacks and filters, where the runtime observes them.
- Server-command callbacks receive a native payload with current PascalCase fields. Construct `Command` to validate names, arguments, and raw text; the wrapper does not convert old field names.
- Registration, cleanup, execution, and callback invocation are synchronous. Callback results, including Promises, are ignored; asynchronous work does not delay completion of server dispatch.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.
- Treat `ExecuteCommand` as direct server-console execution. Use fixed commands or a strict allowlist instead of concatenating untrusted player, network, or configuration text.
- Check the boolean result of every registration, unregistration, and execution, and handle thrown validation/runtime errors. `ExecuteCommand` appends a newline, submits the text to the engine, and calls `ServerExecute`; `true` confirms those calls, not that the command was recognized or achieved its intended effect.
- Avoid embedded NUL characters: the engine receives a C string and sees only the text before the first NUL. Do not log full command arguments by default, since they may contain credentials or tokens.

## Related files

- [`commands.md`](commands.md) documents shared command payloads and return values.
- [`commands-command.md`](commands-command.md) documents owned registration resources over an adapter for this native module.
- [`commands-manager.md`](commands-manager.md) documents ownership of multiple registrations.
- [`packages/sourcejs/commands/server.js`](../../packages/sourcejs/commands/server.js) maps public names to the native runtime.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs server command registration, unregistration, and execution callbacks.
