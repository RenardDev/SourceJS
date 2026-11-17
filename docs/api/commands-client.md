# `require("commands/client")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Every registration example retains the exact callback needed for cleanup.

`commands/client` wraps five native client-command operations installed by `ModuleBindings.cpp`. Their presence does not guarantee that a particular registration or delivery attempt succeeds; check each operation's result.

## Location and purpose

The public wrapper lives in [`packages/sourcejs/commands/client.js`](../../packages/sourcejs/commands/client.js) and exposes the native client-command runtime. Use it to observe or block client commands, register callbacks for named commands, and send a command line to one connected client. A successful send reports dispatch through an engine interface, not confirmation that the client executed the command. Registered callbacks and filters receive a native payload that should be validated with `Command` before use.

## Import

```js
const {
	RegisterCommand,
	RegisterCommandFilter,
	SendCommand,
	UnregisterCommand,
	UnregisterCommandFilter,
} = require("commands/client");

console.log(RegisterCommand, RegisterCommandFilter, SendCommand, UnregisterCommand, UnregisterCommandFilter);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`RegisterCommand`](#registercommand) | Function | `RegisterCommand(strCommandName, Callback)` |
| [`RegisterCommandFilter`](#registercommandfilter) | Function | `RegisterCommandFilter(Callback)` |
| [`SendCommand`](#sendcommand) | Function | `SendCommand(Player, strCommand, bServerSide = false)` |
| [`UnregisterCommand`](#unregistercommand) | Function | `UnregisterCommand(strCommandName, Callback?)`. Pass the exact registered function to remove only that callback. Omitting it or passing a non-function removes all callbacks for that name in this runtime. |
| [`UnregisterCommandFilter`](#unregistercommandfilter) | Function | `UnregisterCommandFilter(Callback)` |

Use a string command name. Native registration and removal preserve ordinary JavaScript string conversion, case, and UTF-8 content for supplied names; an exception from `toString()` reaches the caller unchanged and stops the runtime operation. Embedded NUL characters produce `Error` before changing registrations. A nonthrowing conversion failure reports a conversion error. Registration, removal and filter boundaries translate C++ exceptions into contextual JavaScript errors without exposing exception text; they do not guarantee rollback or native ABI safety.

`SendCommand()` forwards to the native client-command sender, which requires a primitive non-empty command string and a connected player. The binding does not quote the command as a single argument. The SDK receives a C string, so an embedded NUL ends the command.

An omitted or nullish `bServerSide` requests the server-plugin-helpers client-command path; when those helpers are unavailable, the engine client-command path is used instead. `true` requests the engine path directly. A supplied non-nullish flag must be a primitive boolean. The native binding reads the player selector before validating that optional flag, preserving an exception from its `Index` getter. C++ failures become `Error("commands.Send() failed because a native C++ exception occurred.")` without replacing an existing JavaScript exception. The boolean reports dispatch, not confirmed command execution, and completed native effects are not rolled back.

## Examples

### `RegisterCommand`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function MarkReady(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	console.log(`Player ${ClientCommand.Index} is ready for the next round.`);

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_ready", MarkReady)) {
		throw new Error("Unable to unregister sjs_ready.");
	}
}

if (!RegisterCommand("sjs_ready", MarkReady)) {
	throw new Error("Unable to register sjs_ready.");
}

exports.Unload = UnloadPlugin;
```

### `RegisterCommandFilter`

```js
const { BLOCK, CONTINUE, Command } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/client");

function PreventSuicide(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	if (ClientCommand.Name === "kill") {
		return BLOCK;
	}

	return CONTINUE;
}

function UnloadPlugin() {
	if (!UnregisterCommandFilter(PreventSuicide)) {
		throw new Error("Unable to unregister the client-command filter.");
	}
}

if (!RegisterCommandFilter(PreventSuicide)) {
	throw new Error("Unable to register the client-command filter.");
}

exports.Unload = UnloadPlugin;
```

### `SendCommand`

```js
const { SendCommand } = require("commands/client");

if (!SendCommand(1, "playgamesound UI/buttonclick.wav", false)) {
	throw new Error("Unable to send the client command to player 1.");
}
```

### `UnregisterCommand`

```js
const { HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function ShowPlayerLoadout() {
	console.log("Loadout command received");

	return HANDLED;
}

function DisableLoadoutCommand() {
	if (!UnregisterCommand("sjs_loadout", ShowPlayerLoadout)) {
		throw new Error("Unable to unregister sjs_loadout.");
	}
}

if (!RegisterCommand("sjs_loadout", ShowPlayerLoadout)) {
	throw new Error("Unable to register sjs_loadout.");
}

exports.Unload = DisableLoadoutCommand;
```

### `UnregisterCommandFilter`

```js
const { CONTINUE, Command } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/client");

function LogClientCommands(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	console.log(`Client ${ClientCommand.Index}: ${ClientCommand.Name}`);

	return CONTINUE;
}

function DisableClientCommandLogging() {
	if (!UnregisterCommandFilter(LogClientCommands)) {
		throw new Error("Unable to unregister client-command logging.");
	}
}

if (!RegisterCommandFilter(LogClientCommands)) {
	throw new Error("Unable to register client-command logging.");
}

exports.Unload = DisableClientCommandLogging;
```

## Safe use and common mistakes

- Keep each registered callback or filter reference and unregister that exact function during plugin unload. An equivalent new function is not the same registration.
- Always pass the retained callback to `UnregisterCommand`: an omitted or non-function argument removes all callbacks for that command name in this runtime.
- Check the boolean result of every registration, unregistration, filter-registration, and send operation. Invalid arguments or unavailable runtime state may throw instead. A successful send means the engine/helper call was issued, not that the client executed the command.
- Construct `Command` from the native payload before reading its name, index, arguments, or raw text. Do not pass the raw payload into APIs that expect a `Command` instance.
- Do not log raw command text or arguments indiscriminately: they may contain passwords or tokens. Prefer the command name and non-sensitive diagnostic fields.
- Return `CONTINUE` from observational filters and `BLOCK` only when the client command must stop. Named callbacks should also return an explicit command result.
- Registration, removal, and sending are synchronous runtime operations, not queued worker requests. Callbacks and filters must return their command result synchronously. Returning a `Promise` does not postpone dispatch or block the command; later asynchronous work cannot retroactively stop it.
- `SendCommand` requires a connected player index or player-like object and a non-empty command line. Validate player identity and do not build command text from untrusted input without an allowlist.
- Set `bServerSide` deliberately. The default `false` uses the plugin-helper client-command path when available and otherwise falls back to the engine-server path; `true` selects the engine-server path directly.

## Related files

- [`commands.md`](commands.md) documents the shared `Command` payload wrapper and return values.
- [`commands-filter.md`](commands-filter.md) documents reusable filter registration objects.
- [`players-entity.md`](players-entity.md) documents player objects accepted by `SendCommand`.
- [`packages/sourcejs/commands/client.js`](../../packages/sourcejs/commands/client.js) maps public names to the native runtime.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) validates `SendCommand` arguments and installs the bindings.
