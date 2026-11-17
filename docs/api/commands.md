# `require("commands")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`Command`](#command)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Registration examples include plugin unload cleanup and use complete native command payloads. Callbacks run synchronously on the game thread: root callbacks do not block dispatch through their return values; client/say handlers use direct command-return results, not awaited promises. The examples export the case-sensitive SourceJS-owned lifecycle key `exports.Unload`; CommonJS does not define these hooks, and SourceJS does not install lowercase aliases.

Native boundary: [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the root `commands` module unconditionally with `ExecuteServerCommand`, `RegisterCommand`, `UnregisterCommand`, command-return values, and lookup helpers. `MAX_COMMAND_LENGTH` exposes the SDK's `CCommand::MaxCommandLength()` and is omitted for `SOURCEJS_OLD_CONSOLE_API`; the package's `MAX_COMMAND_LENGTH` exports are therefore `undefined` on that legacy SDK family. This constant does not imply that every command API validates that limit: root `ExecuteCommand` checks for a non-empty string, submits it to the engine with an appended newline, and calls `ServerExecute` without a SourceJS length check.

## Location and purpose

The public wrapper lives in [`packages/sourcejs/commands.js`](../../packages/sourcejs/commands.js), above the native bindings in `ModuleBindings.cpp`; [`src/sourcejs/V8Runtime.cpp`](../../src/sourcejs/V8Runtime.cpp) owns SourceJS-created commands and constructs callback payloads. Use it to create and remove SourceJS-owned server commands, execute server command text immediately, share command-return constants with the client/say packages, and validate the native payload passed to a callback. Root registration rejects a same-named command that already exists outside SourceJS. Root callbacks receive the command event, but their return values do not block dispatch. `Command` copies the native fields and argument array into its own storage; its getter-only accessors expose normalized values, and `Arguments` returns a fresh array. This isolates handlers from later raw-payload changes, but does not make the instance immutable: its backing implementation properties remain writable.

## Import

```js
const { Command, CommandReturn, RegisterCommand, UnregisterCommand } = require("commands");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`BLOCK`](#block) | Constant | Integer `1`; same value as `CommandReturn.Block`. |
| [`CONTINUE`](#continue) | Constant | Integer `0`; same value as `CommandReturn.Continue`. |
| [`Command`](#command-1) | Class | `new Command(NativePayload)` |
| [`CommandReturn`](#commandreturn) | Object | `{ Continue: 0, Block: 1, Handled: 1 }`; native initialization creates own writable, enumerable, configurable data properties, without invoking inherited setters. |
| [`HANDLED`](#handled) | Constant | Integer `1`; same value as `CommandReturn.Handled`. |
| [`ExecuteCommand`](#executecommand) | Function | `ExecuteCommand(strCommand)`; calls native `ExecuteServerCommand` and returns a dispatch-success boolean. |
| [`MAX_COMMAND_LENGTH`](#max_command_length) | Constant | SDK `CCommand::MaxCommandLength()` on modern console APIs; `undefined` with `SOURCEJS_OLD_CONSOLE_API`. Not automatically enforced by root `ExecuteCommand`. |
| [`RegisterCommand`](#registercommand) | Function | `RegisterCommand(strCommandName, Callback)`; creates or reuses a SourceJS-owned command, adds the root callback, and returns a boolean. |
| [`UnregisterCommand`](#unregistercommand) | Function | `UnregisterCommand(strCommandName, Callback?)`; removes the specified function callback, or all root callbacks when the second argument is omitted or is not a function. Unregisters the owned command after the last callback and returns a boolean; a missing registration or unmatched function returns `false`. Pass the original callback function to avoid removing other handlers. |

`RegisterCommand` and `UnregisterCommand` use JavaScript string conversion for `strCommandName`, preserve its case and UTF-8 content, and reject embedded NUL characters with `Error` before changing registrations. Exceptions raised by name conversion propagate unchanged. The same name validation applies to the server, client, and say command packages; it does not change command-text dispatch.

## `Command`

| Member | Signature or access |
| --- | --- |
| [`MAX_COMMAND_LENGTH`](#commandmax_command_length) | Static copy of the package's SDK limit; `undefined` with `SOURCEJS_OLD_CONSOLE_API`. Does not add length validation to `Command` or root `ExecuteCommand`. |
| [`ArgumentString`](#commandargumentstring) | Read-only property containing arguments after the command name, joined by spaces. |
| [`Arguments`](#commandarguments) | Read-only property returning a copy of the argument array, including the command name at index `0`. |
| [`GetArgument`](#commandgetargument) | `GetArgument(nIndex)`; requires an integer or throws `TypeError`. Directly indexes the stored array; an absent element (including an ordinary negative index) returns `undefined`, with no range error. |
| [`Index`](#commandindex) | Read-only native source index; root server callbacks use `0`, while client/say callbacks use the client index. |
| [`Kind`](#commandkind) | Read-only native command kind: `"server"`, `"client"`, or `"say"`. |
| [`Length`](#commandlength) | Read-only argument count, including the command name. |
| [`Message`](#commandmessage) | Read-only chat message, or an empty string when absent. |
| [`Name`](#commandname) | Read-only command name. |
| [`Raw`](#commandraw) | Read-only native `Raw` field: arguments rejoined with spaces for server/client payloads, or the original message text for say payloads. |
| [`TeamOnly`](#commandteamonly) | Read-only team-chat flag; defaults to `false`. |
| `[Symbol.iterator]` | `[Symbol.iterator]()`; iterates the stored argument array in order, including the command name. Unlike `Arguments`, it does not create an array copy. |

These descriptions reflect native payload conventions. The constructor validates field types and a dense string argument array, but does not restrict `Kind` to the listed strings, require a nonnegative source index, or verify that the first argument matches `Name`. Do not treat a successfully constructed `Command` as proof that an arbitrary input came from the engine.

Each payload field and source argument is captured once and validated before storage. The constructor copies own string argument slots without calling a custom array `slice` method or species constructor; holes, including inherited indexed values, are rejected. Later raw-payload mutation cannot change the captured values. This is not an atomic snapshot of arbitrary getters that mutate other fields while construction is in progress.

Native callback payload construction defines checked own fields and own argument-array indexes without invoking inherited setters or being blocked by non-writable inherited properties. This applies to SourceJS-created callback records, not arbitrary objects later passed to `new Command()`.

## Examples

### `BLOCK`

```js
const { BLOCK } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function BlockMaintenanceCommand() {
	return BLOCK;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_maintenance", BlockMaintenanceCommand)) {
		throw new Error("Unable to unregister sjs_maintenance.");
	}
}

if (!RegisterCommand("sjs_maintenance", BlockMaintenanceCommand)) {
	throw new Error("Unable to register sjs_maintenance.");
}

exports.Unload = UnloadPlugin;
```

### `CONTINUE`

```js
const { Command, CONTINUE } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function ObserveStatusCommand(CommandPayload) {
	const StatusCommand = new Command(CommandPayload);
	console.log(`Command requested: ${StatusCommand.Name}`);

	return CONTINUE;
}

function UnloadPlugin() {
	if (!UnregisterCommand("status", ObserveStatusCommand)) {
		throw new Error("Unable to unregister status.");
	}
}

if (!RegisterCommand("status", ObserveStatusCommand)) {
	throw new Error("Unable to register status.");
}

exports.Unload = UnloadPlugin;
```

### `Command`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function ShowCommand(CommandPayload) {
	const ReceivedCommand = new Command(CommandPayload);
	console.log(`${ReceivedCommand.Kind} command at source index ${ReceivedCommand.Index}: ${ReceivedCommand.Name}`);

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_command_info", ShowCommand)) {
		throw new Error("Unable to unregister sjs_command_info.");
	}
}

if (!RegisterCommand("sjs_command_info", ShowCommand)) {
	throw new Error("Unable to register sjs_command_info.");
}

exports.Unload = UnloadPlugin;
```

### `CommandReturn`

```js
const { Command, CommandReturn } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function HandleMaintenanceCommand(CommandPayload) {
	const MaintenanceCommand = new Command(CommandPayload);
	if (MaintenanceCommand.GetArgument(1) !== "confirm") {
		console.log("Usage: sjs_maintenance confirm");
		return CommandReturn.Block;
	}

	console.log("Maintenance confirmation accepted");

	return CommandReturn.Handled;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_maintenance", HandleMaintenanceCommand)) {
		throw new Error("Unable to unregister sjs_maintenance.");
	}
}

if (!RegisterCommand("sjs_maintenance", HandleMaintenanceCommand)) {
	throw new Error("Unable to register sjs_maintenance.");
}

exports.Unload = UnloadPlugin;
```

### `HANDLED`

```js
const { HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function HandleReloadConfigurationCommand() {
	console.log("Reload command received; this example does not reload configuration.");

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_reload_config", HandleReloadConfigurationCommand)) {
		throw new Error("Unable to unregister sjs_reload_config.");
	}
}

if (!RegisterCommand("sjs_reload_config", HandleReloadConfigurationCommand)) {
	throw new Error("Unable to register sjs_reload_config.");
}

exports.Unload = UnloadPlugin;
```

### `ExecuteCommand`

```js
const { ExecuteCommand } = require("commands");

if (!ExecuteCommand("status")) {
	throw new Error("Unable to execute status.");
}
```

### `MAX_COMMAND_LENGTH`

```js
const { MAX_COMMAND_LENGTH } = require("commands");

function GetUTF8ByteLength(strText) {
	return encodeURIComponent(strText).replace(/%[0-9A-F]{2}|./g, "x").length;
}

function ValidateCommandLine(strCommandLine) {
	if (MAX_COMMAND_LENGTH === undefined) {
		throw new Error("MAX_COMMAND_LENGTH is unavailable with the legacy console API.");
	}

	if (GetUTF8ByteLength(strCommandLine) >= MAX_COMMAND_LENGTH) {
		throw new RangeError(`Command must be shorter than ${MAX_COMMAND_LENGTH} UTF-8 bytes.`);
	}
}

ValidateCommandLine("sjs plugins list");
```

This example checks only a caller-selected length limit, not command syntax or execution success. Empty strings pass this length check; root `ExecuteCommand` rejects them. Unpaired UTF-16 surrogates cause `GetUTF8ByteLength` to throw `URIError`. The check measures the supplied string only, before any newline appended by the execution API.

### `RegisterCommand`

```js
const { SetConVar } = require("cvars");
const { Command, RegisterCommand, UnregisterCommand } = require("commands");

function SetGravity(CommandPayload) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	const GravityCommand = new Command(CommandPayload);
	const strGravity = GravityCommand.GetArgument(1);
	const dblGravity = Number(strGravity);
	if ((strGravity === undefined) || (strGravity.trim() === "") || !Number.isFinite(dblGravity) || (Math.abs(dblGravity) > dblMaximumConVarValue)) {
		console.log("Usage: sjs_gravity <value>");
		return;
	}

	if (!SetConVar("sv_gravity", dblGravity)) {
		throw new Error("Unable to set server gravity.");
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_gravity", SetGravity)) {
		throw new Error("Unable to unregister sjs_gravity.");
	}
}

if (!RegisterCommand("sjs_gravity", SetGravity)) {
	throw new Error("Unable to register sjs_gravity.");
}

exports.Unload = UnloadPlugin;
```

### `UnregisterCommand`

```js
const { RegisterCommand, UnregisterCommand } = require("commands");

function ShowRotation() {
	console.log("Rotation command received; this example does not change the map rotation.");
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_rotation", ShowRotation)) {
		throw new Error("Unable to unregister sjs_rotation.");
	}
}

if (!RegisterCommand("sjs_rotation", ShowRotation)) {
	throw new Error("Unable to register sjs_rotation.");
}

exports.Unload = UnloadPlugin;
```

### `Command.MAX_COMMAND_LENGTH`

```js
const { Command, ExecuteCommand, RegisterCommand, UnregisterCommand } = require("commands");

function GetUTF8ByteLength(strText) {
	return encodeURIComponent(strText).replace(/%[0-9A-F]{2}|./g, "x").length;
}

function ForwardServerCommand(CommandPayload) {
	// Trusted server-console input only: this forwards executable command text.
	// ArgumentString rejoins tokens; it does not preserve original quoting.
	const ForwardCommand = new Command(CommandPayload);
	const strCommandLine = ForwardCommand.ArgumentString;

	if (Command.MAX_COMMAND_LENGTH === undefined) {
		console.log("sjs_forward requires the modern console API.");
		return;
	}

	const unCommandByteLength = GetUTF8ByteLength(strCommandLine);
	if ((unCommandByteLength === 0) || (unCommandByteLength >= Command.MAX_COMMAND_LENGTH)) {
		console.log(`Usage: sjs_forward <command shorter than ${Command.MAX_COMMAND_LENGTH} UTF-8 bytes>`);
		return;
	}

	if (!ExecuteCommand(strCommandLine)) {
		throw new Error("Unable to execute the forwarded command.");
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_forward", ForwardServerCommand)) {
		throw new Error("Unable to unregister sjs_forward.");
	}
}

if (!RegisterCommand("sjs_forward", ForwardServerCommand)) {
	throw new Error("Unable to register sjs_forward.");
}

exports.Unload = UnloadPlugin;
```

Use this forwarding example only with trusted server-console input. It permits arbitrary server commands; the length check is not authorization or sanitization. `ArgumentString` rejoins parsed arguments with spaces and does not preserve their original quoting, so this is not a lossless command forwarder. Unpaired UTF-16 surrogates throw `URIError` during byte counting; the length check also excludes the newline appended by `ExecuteCommand`.

### `Command.ArgumentString`

```js
const { Command, RegisterCommand, UnregisterCommand } = require("commands");
const { SayText2 } = require("messages");

function Announce(CommandPayload) {
	const AnnouncementCommand = new Command(CommandPayload);
	const Message = new SayText2(AnnouncementCommand.ArgumentString);
	if (!Message.SendUserMessage([1])) {
		throw new Error("Unable to send the announcement.");
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_announce", Announce)) {
		throw new Error("Unable to unregister sjs_announce.");
	}
}

if (!RegisterCommand("sjs_announce", Announce)) {
	throw new Error("Unable to register sjs_announce.");
}

exports.Unload = UnloadPlugin;
```

### `Command.Arguments`

```js
const { Command, ExecuteCommand, RegisterCommand, UnregisterCommand } = require("commands");

function GetUTF8ByteLength(strText) {
	return encodeURIComponent(strText).replace(/%[0-9A-F]{2}|./g, "x").length;
}

function RunCommandBatch(CommandPayload) {
	const BatchCommand = new Command(CommandPayload);
	const vecCommandLines = BatchCommand.Arguments.slice(1);
	if (vecCommandLines.length === 0) {
		console.log('Usage: sjs_batch "status" "sjs version"');
		return;
	}

	for (const strCommandLine of vecCommandLines) {
		if (strCommandLine.length === 0) {
			console.log("Unable to execute an empty batch command.");
			continue;
		}

		if ((Command.MAX_COMMAND_LENGTH !== undefined) && (GetUTF8ByteLength(strCommandLine) >= Command.MAX_COMMAND_LENGTH)) {
			console.log(`Batch command must be shorter than ${Command.MAX_COMMAND_LENGTH} UTF-8 bytes.`);
			continue;
		}

		if (!ExecuteCommand(strCommandLine)) {
			console.log("Unable to execute a batch command.");
		}
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_batch", RunCommandBatch)) {
		throw new Error("Unable to unregister sjs_batch.");
	}
}

if (!RegisterCommand("sjs_batch", RunCommandBatch)) {
	throw new Error("Unable to register sjs_batch.");
}

exports.Unload = UnloadPlugin;
```

Use this batch example only with trusted server-console input: each argument can execute arbitrary server commands. Execution is sequential and not atomic. Empty or overlong entries are skipped, and an execution result of `false` is logged before continuing; an exception stops the remaining batch without rolling back earlier commands. With the legacy console API, this example skips the length check entirely. On modern APIs, an unpaired UTF-16 surrogate throws `URIError` during byte counting. The limit check measures each supplied argument before the newline appended by `ExecuteCommand`; it is not syntax validation or authorization.

### `Command.GetArgument`

```js
const { SetConVar } = require("cvars");
const { Command, RegisterCommand, UnregisterCommand } = require("commands");

function SetGravity(CommandPayload) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	const GravityCommand = new Command(CommandPayload);
	const strGravity = GravityCommand.GetArgument(1);
	const dblGravity = Number(strGravity);
	if ((strGravity === undefined) || (strGravity.trim() === "") || !Number.isFinite(dblGravity) || (Math.abs(dblGravity) > dblMaximumConVarValue)) {
		console.log("Usage: sjs_gravity <value>");
		return;
	}

	if (!SetConVar("sv_gravity", dblGravity)) {
		throw new Error("Unable to set server gravity.");
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_gravity", SetGravity)) {
		throw new Error("Unable to unregister sjs_gravity.");
	}
}

if (!RegisterCommand("sjs_gravity", SetGravity)) {
	throw new Error("Unable to register sjs_gravity.");
}

exports.Unload = UnloadPlugin;
```

### `Command.Index`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { SayText2 } = require("messages");

function ShowClientIndex(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	const Message = new SayText2(`Your client index is ${ClientCommand.Index}.`);
	if (!Message.SendUserMessage([ClientCommand.Index])) {
		throw new Error("Unable to send the client index.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_client_index", ShowClientIndex)) {
		throw new Error("Unable to unregister sjs_client_index.");
	}
}

if (!RegisterCommand("sjs_client_index", ShowClientIndex)) {
	throw new Error("Unable to register sjs_client_index.");
}

exports.Unload = UnloadPlugin;
```

### `Command.Kind`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { SayText2 } = require("messages");

function ShowCommandChannel(CommandPayload) {
	const ChannelCommand = new Command(CommandPayload);
	const Message = new SayText2(`Command channel: ${ChannelCommand.Kind}.`);
	if (!Message.SendUserMessage([ChannelCommand.Index])) {
		throw new Error("Unable to send the command channel.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_command_channel", ShowCommandChannel)) {
		throw new Error("Unable to unregister sjs_command_channel.");
	}
}

if (!RegisterCommand("sjs_command_channel", ShowCommandChannel)) {
	throw new Error("Unable to register sjs_command_channel.");
}

exports.Unload = UnloadPlugin;
```

### `Command.Length`

```js
const { Command, ExecuteCommand, RegisterCommand, UnregisterCommand } = require("commands");

function RequestRestart(CommandPayload) {
	const RestartCommand = new Command(CommandPayload);
	if ((RestartCommand.Length !== 2) || (RestartCommand.GetArgument(1) !== "confirm")) {
		console.log("Usage: sjs_restart_round confirm");
		return;
	}

	if (!ExecuteCommand("restart")) {
		throw new Error("Unable to dispatch the restart command.");
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_restart_round", RequestRestart)) {
		throw new Error("Unable to unregister sjs_restart_round.");
	}
}

if (!RegisterCommand("sjs_restart_round", RequestRestart)) {
	throw new Error("Unable to register sjs_restart_round.");
}

exports.Unload = UnloadPlugin;
```

This example demonstrates argument-count validation, not a portable round-restart API. Confirm the availability and meaning of the engine command `restart` for your game before using it. `ExecuteCommand` returning `true` reports dispatch, not confirmation that a round restarted. The registered name `sjs_restart_round` is only this example's command name.

### `Command.Message`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/say");
const { SayText2 } = require("messages");

function EchoChatCommand(CommandPayload) {
	const ChatCommand = new Command(CommandPayload);
	const Message = new SayText2(`Received chat text: ${ChatCommand.Message}`);
	if (!Message.SendUserMessage([ChatCommand.Index])) {
		throw new Error("Unable to deliver the chat response.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("!echo", EchoChatCommand)) {
		throw new Error("Unable to unregister !echo.");
	}
}

if (!RegisterCommand("!echo", EchoChatCommand)) {
	throw new Error("Unable to register !echo.");
}

exports.Unload = UnloadPlugin;
```

### `Command.Name`

```js
const { Command, ExecuteCommand, RegisterCommand, UnregisterCommand } = require("commands");

const g_mapTargetCommands = new Map([["sjs_show_status", "status"], ["sjs_show_version", "sjs version"]]);
const g_vecRegisteredCommandNames = [];

function ExecuteNamedTarget(CommandPayload) {
	const NamedCommand = new Command(CommandPayload);
	const strTargetCommand = g_mapTargetCommands.get(NamedCommand.Name);
	if (!strTargetCommand) {
		return;
	}

	if (!ExecuteCommand(strTargetCommand)) {
		throw new Error(`Unable to execute target command: ${strTargetCommand}`);
	}
}

function UnregisterNamedTargets() {
	while (g_vecRegisteredCommandNames.length !== 0) {
		const strName = g_vecRegisteredCommandNames[0];
		if (!UnregisterCommand(strName, ExecuteNamedTarget)) {
			throw new Error(`Unable to unregister command: ${strName}`);
		}

		g_vecRegisteredCommandNames.shift();
	}
}

function UnloadPlugin() {
	UnregisterNamedTargets();
}

try {
	for (const strName of g_mapTargetCommands.keys()) {
		if (!RegisterCommand(strName, ExecuteNamedTarget)) {
			throw new Error(`Unable to register command: ${strName}`);
		}

		g_vecRegisteredCommandNames.push(strName);
	}
} catch (RegistrationError) {
	try {
		UnregisterNamedTargets();
	} catch (CleanupError) {
		throw new AggregateError([RegistrationError, CleanupError], "Named command registration failed and rollback is incomplete.");
	}

	throw RegistrationError;
}

exports.Unload = UnloadPlugin;
```

Registration in this example is not atomic: a `false` result or exception triggers cleanup of previously recorded registrations. Cleanup removes each successfully unregistered name from the tracking array and stops on a `false` result or exception, preserving remaining entries. If rollback also fails, `AggregateError.errors` contains the registration error followed by the cleanup error. A failed module evaluation may leave no accessible cleanup export, so callers still need an explicit recovery policy for incomplete rollback. The example assumes registration does not install a callback and then report failure; it cannot track an unreported side effect.

### `Command.Raw`

```js
const { Command, RegisterCommand, UnregisterCommand } = require("commands");

function AuditCommandPayload(CommandPayload) {
	const AuditCommand = new Command(CommandPayload);
	// Report UTF-16 length, not command text that may contain credentials.
	console.log(`[command-audit] RawLength=${AuditCommand.Raw.length}`);
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_audit", AuditCommandPayload)) {
		throw new Error("Unable to unregister sjs_audit.");
	}
}

if (!RegisterCommand("sjs_audit", AuditCommandPayload)) {
	throw new Error("Unable to register sjs_audit.");
}

exports.Unload = UnloadPlugin;
```

This example logs only the UTF-16 code-unit length, not the command text. Length is still metadata: omit it too if your threat model treats it as sensitive. Never log passwords, tokens, or other secrets supplied as command arguments. For root server callbacks, `Raw` is reconstructed by joining parsed arguments with spaces, so original quoting and spacing are not preserved. It is not a byte-for-byte audit record of the submitted command line.

### `Command.TeamOnly`

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/say");
const { SayText2 } = require("messages");

function ShowChatAudience(CommandPayload) {
	const AudienceCommand = new Command(CommandPayload);
	const strAudience = AudienceCommand.TeamOnly ? "team chat" : "all chat";
	const Message = new SayText2(`This command came from ${strAudience}.`);
	if (!Message.SendUserMessage([AudienceCommand.Index])) {
		throw new Error("Unable to deliver the audience response.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!UnregisterCommand("!audience", ShowChatAudience)) {
		throw new Error("Unable to unregister !audience.");
	}
}

if (!RegisterCommand("!audience", ShowChatAudience)) {
	throw new Error("Unable to register !audience.");
}

exports.Unload = UnloadPlugin;
```

### `Command[Symbol.iterator]`

```js
const { Command, RegisterCommand, UnregisterCommand } = require("commands");
const { DoesConVarExist } = require("cvars");

function InspectConVars(CommandPayload) {
	const InspectionCommand = new Command(CommandPayload);
	const [, ...vecConVarNames] = InspectionCommand;
	if (vecConVarNames.length === 0) {
		console.log("Usage: sjs_cvars <name> [name ...]");
		return;
	}

	for (const strConVarName of vecConVarNames) {
		console.log(DoesConVarExist(strConVarName) ? `${strConVarName} exists` : `${strConVarName} does not exist`);
	}
}

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_cvars", InspectConVars)) {
		throw new Error("Unable to unregister sjs_cvars.");
	}
}

if (!RegisterCommand("sjs_cvars", InspectConVars)) {
	throw new Error("Unable to register sjs_cvars.");
}

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Keep the original callback reference and unregister the same name/callback pair during plugin unload. Recreating an equivalent function does not identify the registered callback.
- Check every registration and unregistration result. Abort plugin loading after rolling back any earlier successful registrations, and report cleanup failures during unload.
- Wrap callback payloads with `Command` before reading them. The constructor validates required native fields, and `Arguments` deliberately returns a copy.
- Treat an out-of-range `GetArgument(nIndex)` result as absent. It rejects non-integer indexes but returns `undefined` when a valid integer is outside the argument array.
- Root `RegisterCommand` creates a SourceJS-owned engine command for the first callback and adds later callbacks to the same SourceJS-owned command. It returns `false` when the same name already belongs to a command outside SourceJS. Root `UnregisterCommand` removes the selected callback, or every callback when its second argument is omitted or is not a function, and unregisters the owned engine command after the last callback is removed.
- `V8Runtime::DispatchCommand` ignores root-command callback results. Return values control `commands/client` and `commands/say` callbacks and filters: boolean `false` and integer `1` block (`BLOCK` and `HANDLED` are both `1`); boolean `true`, nullish values, and all other results continue.
- In callbacks whose result is observed, return the semantic `CONTINUE`, `BLOCK`, or `HANDLED` export instead of a numeric literal. `BLOCK` and `HANDLED` currently share numeric value `1`, but their names communicate callback intent.
- `Message` and `TeamOnly` describe chat payloads. The wrapper defaults absent fields to an empty string and `false`, regardless of `Kind`; it preserves supplied valid values rather than enforcing consistency with the command kind.
- Validate and allowlist any client-derived text before passing it to `ExecuteCommand`. It executes server console text rather than escaping or sandboxing it.
- Check that `MAX_COMMAND_LENGTH` or `Command.MAX_COMMAND_LENGTH` is defined before enforcing it; the legacy console API omits the native limit. The examples use the SDK value as an exclusive UTF-8 byte-length limit, not a JavaScript character count. Root `ExecuteCommand` does not enforce this limit itself, and appends a newline before submission; a local length check is not a guarantee of engine acceptance or successful execution.

## Related files

- [`packages/sourcejs/commands.js`](../../packages/sourcejs/commands.js) implements the public wrapper.
- [`packages/sourcejs/internal/commands.js`](../../packages/sourcejs/internal/commands.js) resolves root and command-kind native modules.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native command bindings and return values.
- [`src/sourcejs/V8Runtime.cpp`](../../src/sourcejs/V8Runtime.cpp) creates callback payloads and applies callback results.
- [`tools/smoke_commands_runtime.js`](../../tools/smoke_commands_runtime.js) contains command-package smoke checks with test callback/filter stores and recorded send operations; it does not run the native engine.
- [`commands-client.md`](commands-client.md) documents client-command registration.
- [`commands-say.md`](commands-say.md) documents chat-command registration.
- [`commands-server.md`](commands-server.md) documents server-command registration.
