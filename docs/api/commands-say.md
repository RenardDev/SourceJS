# `require("commands/say")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Chat registrations and filters retain their callbacks for unload cleanup.

`ModuleBindings.cpp` installs all six native chat-command operations unconditionally.

## Location and purpose

The public wrapper lives in [`packages/sourcejs/commands/say.js`](../../packages/sourcejs/commands/say.js) and exposes the native chat-command runtime. Use it to register named chat triggers, observe or block chat with filters, and request all-chat or team-chat text from a connected player. Sending dispatches a `say` or `say_team` command through the engine; a true result confirms dispatch, not delivery or display to recipients. Raw callback payloads include chat-specific `Message` and `TeamOnly` fields; construct `Command` to validate them and read `Message` or `TeamOnly`.

## Import

```js
const {
	RegisterCommand,
	RegisterCommandFilter,
	SayCommand,
	SayTeamCommand,
	UnregisterCommand,
	UnregisterCommandFilter,
} = require("commands/say");

console.log(RegisterCommand, RegisterCommandFilter, SayCommand, SayTeamCommand, UnregisterCommand, UnregisterCommandFilter);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`RegisterCommand`](#registercommand) | Function | `RegisterCommand(strCommandName, Callback)` |
| [`RegisterCommandFilter`](#registercommandfilter) | Function | `RegisterCommandFilter(Callback, bEarly = false)` |
| [`SayCommand`](#saycommand) | Function | `SayCommand(Player, strMessage)` |
| [`SayTeamCommand`](#sayteamcommand) | Function | `SayTeamCommand(Player, strMessage)` |
| [`UnregisterCommand`](#unregistercommand) | Function | `UnregisterCommand(strCommandName, Callback?)` |
| [`UnregisterCommandFilter`](#unregistercommandfilter) | Function | `UnregisterCommandFilter(Callback, bEarly = false)` |

Pass `true` to run a filter before ordinary chat filters, regardless of plugin load order. Each phase preserves registration order. A blocking result stops both later filters and named chat callbacks for `say`, `say_team`, and incoming `say_squad` where supported. Squad chat sets `TeamOnly` to `true`; this does not change the engine's recipients for unblocked messages. To remove an early filter, pass the original callback and `true`. Existing one-argument calls keep their behavior.

Some engines dispatch stock chat without invoking the server plugin's `ClientCommand` callback. SourceJS uses `ConCommand::Dispatch` for each registered game-DLL chat command it can hook, resolving the virtual slot from the SDK declaration without checking the game name. If the hook is unavailable, including on legacy console SDKs, SourceJS handles chat through `ClientCommand` when the engine delivers it. When a hook is installed, the client callback leaves chat filtering to that hook so filters only run once.

Pass the original function to `UnregisterCommand` to remove only that callback. Omitting it **or passing a non-function value** selects removal of all callbacks registered under that name in the current runtime. A missing name or unmatched callback returns `false`; check the result during cleanup.

Use a string command name. The native registration and removal bindings preserve ordinary JavaScript string conversion, case, and UTF-8 content for supplied names; if `toString()` throws, the original exception reaches the caller and the runtime operation is not called. Embedded NUL characters produce `Error` before changing registrations. A conversion failure without a JavaScript exception reports a conversion error. Native registration, removal and filter boundaries translate C++ exceptions into contextual JavaScript errors without exposing the exception text; this does not guarantee rollback or recovery from an invalid native ABI.

`SayCommand()` and `SayTeamCommand()` require a primitive message string before reading the player selector and a connected player before dispatch. They dispatch the engine's exact `say` or `say_team` command through the server-side client-command path. The message is quoted, quotes/backslashes are escaped, and CR/LF become spaces. The SDK receives a C string, so an embedded NUL ends the command. An exception from an object's `Index` getter is preserved and stops dispatch. C++ failures become contextual `commands.Say()` or `commands.SayTeam()` JavaScript errors without replacing an existing JavaScript exception. The boolean reports dispatch, not confirmed delivery or rollback of completed native effects.

## Examples

### `RegisterCommand`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, SayCommand, UnregisterCommand } = require("commands/say");

function MarkReady(CommandPayload) {
	const SayCommandValue = new Command(CommandPayload);
	if (!SayCommand(SayCommandValue.Index, "Ready for the next round.")) {
		throw new Error("Unable to send the ready response.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("!ready", MarkReady)) {
		throw new Error("Unable to unregister the ready chat command.");
	}
}

if (!RegisterCommand("!ready", MarkReady)) {
	throw new Error("Unable to register the ready chat command.");
}

exports.Unload = UnloadPlugin;
```

### `RegisterCommandFilter`

```js
const { BLOCK, CONTINUE, Command } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/say");

function BlockSlashCommand(CommandPayload) {
	const ChatCommand = new Command(CommandPayload);

	return ChatCommand.Message.startsWith("/") ? BLOCK : CONTINUE;
}

function UnloadPlugin() {
	if (!UnregisterCommandFilter(BlockSlashCommand)) {
		throw new Error("Unable to unregister the slash-command filter.");
	}
}

if (!RegisterCommandFilter(BlockSlashCommand)) {
	throw new Error("Unable to register the slash-command filter.");
}

exports.Unload = UnloadPlugin;
```

### `SayCommand`

```js
const { SayCommand } = require("commands/say");

if (!SayCommand(1, "The rescue vehicle is ready!")) {
	throw new Error("Unable to send all-chat text for player 1.");
}
```

### `SayTeamCommand`

```js
const { SayTeamCommand } = require("commands/say");

if (!SayTeamCommand(1, "Tank behind us!")) {
	throw new Error("Unable to send team-chat text for player 1.");
}
```

### `UnregisterCommand`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, SayCommand, UnregisterCommand } = require("commands/say");

function ShowRules(CommandPayload) {
	const ChatCommand = new Command(CommandPayload);
	if (!SayCommand(ChatCommand.Index, "Stay with your team.")) {
		throw new Error("Unable to send the rules response.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("!rules", ShowRules)) {
		throw new Error("Unable to unregister the rules chat command.");
	}
}

if (!RegisterCommand("!rules", ShowRules)) {
	throw new Error("Unable to register the rules chat command.");
}

exports.Unload = UnloadPlugin;
```

### `UnregisterCommandFilter`

```js
const { CONTINUE, Command } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/say");

function AuditTeamChat(CommandPayload) {
	const ChatCommand = new Command(CommandPayload);
	if (ChatCommand.TeamOnly) {
		console.log(`Team chat from player ${ChatCommand.Index}.`);
	}

	return CONTINUE;
}

function UnloadPlugin() {
	if (!UnregisterCommandFilter(AuditTeamChat)) {
		throw new Error("Unable to unregister the team-chat audit filter.");
	}
}

if (!RegisterCommandFilter(AuditTeamChat)) {
	throw new Error("Unable to register the team-chat audit filter.");
}

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Keep every registered callback or filter reference and unregister that exact function during plugin unload. Omitting the callback from `UnregisterCommand`, or supplying a non-function, removes all callbacks for the chat trigger.
- Check the boolean result of every registration, unregistration, filter, and send operation; also handle thrown validation/runtime errors. A true send result means the engine command was issued, not that chat delivery or display was acknowledged.
- Construct `Command` to validate each native payload before using its fields. Current native payloads already use `Index`, `Message`, and `TeamOnly`; the wrapper does not convert old field names.
- Return `CONTINUE` from observational filters and `BLOCK` only when the chat message must stop. Named callbacks should return an explicit command result as well.
- Registration, cleanup, sending, and callback dispatch are synchronous. Return the command decision directly; native dispatch does not await a returned Promise.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.
- `SayCommand` and `SayTeamCommand` require a connected player index or player-like object plus a string. The binding surrounds the message with quotes, prefixes quotes/backslashes with a backslash, and replaces carriage returns/newlines with spaces; pass plain text rather than adding command quotes yourself. Avoid embedded NUL characters: the engine receives a C string, so a NUL truncates the dispatched command. This is command dispatch, not a byte-preserving messaging API.
- Use `TeamOnly` from the callback payload to distinguish incoming team chat. Choosing `SayTeamCommand` affects outgoing chat and does not change the incoming payload.
- Avoid feedback loops when a filter or named callback sends another chat command; guard against messages generated by the plugin when necessary.
- Do not log raw chat text or command arguments by default: they can contain credentials, tokens, or private messages. The audit example records only the player index.

## Related files

- [`commands.md`](commands.md) documents the shared `Command` payload and return values.
- [`commands-filter.md`](commands-filter.md) documents owned filter resources.
- [`commands-client.md`](commands-client.md) documents the parallel client-command runtime.
- [`packages/sourcejs/commands/say.js`](../../packages/sourcejs/commands/say.js) maps public names to the native runtime.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) validates player/message values and quotes outgoing chat arguments.
