# `require("commands/typed")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`ValidationError`](#validationerror)
- [`CommandTreeNode`](#commandtreenode)
- [`CommandTreeStore`](#commandtreestore)
- [`TypedCommandNode`](#typedcommandnode)
- [`TypedCommandContext`](#typedcommandcontext)
- [`TypedCommandParser`](#typedcommandparser)
- [Typed Registration Instances](#typed-registration-instances)
- [`TypedPlayerCommandRegistration`](#typedplayercommandregistration)
- [Configured Typed Registration Classes](#configured-typed-registration-classes)
- [Examples](#examples)

This page is maintained by hand. Examples build real typed command trees, converters, registrations and validation paths.

Selected-SDK rule: unavailable native operations are omitted. Calling an absent export throws a normal JavaScript error; SourceJS does not install fallback stubs.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/typed.js`](../../packages/sourcejs/commands/typed.js). It builds typed command trees, converts argument values, reports structured validation failures, performs player selection and authorization, and owns native server/client/chat registrations. Use it when a command family needs nested paths, generated help, reusable parameter descriptors, and one registration lifecycle instead of hand-parsing raw arguments.

The `RegisterTyped*Command` factories create unloaded registration instances; call the instance's `Register(CommandCallback)` to install it. Each channel's manager uses a private adapter for the actual native registration methods, without adding aliases to the native module.

## Import

```js
const { RegisterTypedClientCommand, RegisterTypedSayCommand, RegisterTypedServerCommand } = require("commands/typed");

console.log(RegisterTypedClientCommand, RegisterTypedSayCommand, RegisterTypedServerCommand);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`ArgumentError`](#argumenterror) | Class | `new ArgumentError(strValidationMessage = "", ValidationOptions = {})` |
| [`ArgumentNumberMismatch`](#argumentnumbermismatch) | Class | `new ArgumentNumberMismatch(strValidationMessage = "", ValidationOptions = {})` |
| [`CommandTreeNode`](#commandtreenode-1) | Class | `new CommandTreeNode(vecCommandPath = [], strCommandDescription = null)` |
| [`CommandTreeStore`](#commandtreestore-1) | Class | `new CommandTreeStore(vecCommandPath = [], strCommandDescription = null)` |
| [`InvalidArgumentValue`](#invalidargumentvalue) | Class | `new InvalidArgumentValue(strValidationMessage = "", ValidationOptions = {})` |
| [`PRIVATE_COMMAND_PREFIX`](#private_command_prefix) | Constant | String `"/"`. |
| [`SubCommandError`](#subcommanderror) | Class | `new SubCommandError(strValidationMessage = "", ValidationOptions = {})` |
| [`SubCommandExpectedError`](#subcommandexpectederror) | Class | `new SubCommandExpectedError(strValidationMessage = "", ValidationOptions = {})` |
| [`SubCommandNotFound`](#subcommandnotfound) | Class | `new SubCommandNotFound(strValidationMessage = "", ValidationOptions = {})` |
| [`TypedClientCommandRegistration`](#typedclientcommandregistration) | Class | `new TypedClientCommandRegistration(CommandPath, RegistrationOptions = {})` |
| [`TypedCommandContext`](#typedcommandcontext-1) | Class | `new TypedCommandContext(CommandPayload, TypedCommand)` |
| [`TypedCommandNode`](#typedcommandnode-1) | Class | `new TypedCommandNode(vecCommandPath, vecCommandParameters, CommandCallback, strCommandDescription, RequiredPermission, AuthorizationFailureCallback, bRequiresRegistration)` |
| [`TypedCommandParser`](#typedcommandparser-1) | Class | `new TypedCommandParser(vecCommandPath = [], strCommandDescription = null)` |
| [`TypedPlayerCommandRegistration`](#typedplayercommandregistration-1) | Base class | Authorization-aware base for client and say registrations. |
| [`TypedSayCommandRegistration`](#typedsaycommandregistration) | Class | `new TypedSayCommandRegistration(CommandPath, RegistrationOptions = {})` |
| [`TypedServerCommandRegistration`](#typedservercommandregistration) | Class | `new TypedServerCommandRegistration(CommandPath, RegistrationOptions = {})` |
| [`ValidationError`](#validationerror-1) | Class | `new ValidationError(strValidationMessage = "", ValidationOptions = {})` |
| [`FilterPlayers`](#filterplayers) | Function | `FilterPlayers(strPlayerExpression)` |
| [`RegisterTypedClientCommand`](#registertypedclientcommand) | Function | `RegisterTypedClientCommand(CommandPath, RegistrationOptions = {})` |
| [`RegisterTypedSayCommand`](#registertypedsaycommand) | Function | `RegisterTypedSayCommand(CommandPath, RegistrationOptions = {})` |
| [`RegisterTypedServerCommand`](#registertypedservercommand) | Function | `RegisterTypedServerCommand(CommandPath, RegistrationOptions = {})` |

## `ValidationError`

| Member | Signature or access |
| --- | --- |
| `Language` | Writable reply language or `null`. |
| `Tokens` | Writable reply token object. |

The constructor copies `Language` and `Tokens` from the options without type validation; nullish values become `null` and a new empty object respectively. A supplied token object is retained by reference, not cloned. These fields describe reply metadata, not a guarantee that the values are valid for a particular message backend.

## `CommandTreeNode`

| Member | Signature or access |
| --- | --- |
| `Commands` | Internal writable property containing the live command path. |
| `Description` | Internal writable property containing the description or `null`. |
| `Signature` | Read-only property containing the formatted command path. |

## `CommandTreeStore`

| Member | Signature or access |
| --- | --- |
| [`HasCommand`](#commandtreestorehascommand) | `HasCommand(strCommandName)` |
| [`GetCommand`](#commandtreestoregetcommand) | `GetCommand(strCommandName)` |
| [`SetCommand`](#commandtreestoresetcommand) | `SetCommand(strCommandName, CommandNode)` |
| [`DeleteCommand`](#commandtreestoredeletecommand) | `DeleteCommand(strCommandName)` |
| [`Values`](#commandtreestorevalues) | `Values()` |
| `Size` | Read-only property containing the child count. |
| `HelpText` | Read-only property containing sorted child help text. |
| `Signature` | Read-only property containing the sub-command signature. |
| `Commands` | Inherited internal writable property containing the live command path. |
| `Description` | Inherited internal writable property containing the description or `null`. |
| `Children` | Internal writable property containing the live child-node `Map`. |

## `TypedCommandNode`

| Member | Signature or access |
| --- | --- |
| `Signature` | Read-only property containing the typed command signature. |
| `Commands` | Inherited internal writable property containing the live command path. |
| `Description` | Inherited internal writable property containing the description or `null`. |
| `Parameters` | Internal writable property retaining the supplied parameter-descriptor array; direct construction does not normalize or copy it. |
| `Callback` | Internal writable property containing the command callback. |
| `Permission` | Internal writable property containing the dot-joined command path when `RequiredPermission === true`, or the supplied permission value otherwise. |
| `FailureCallback` | Internal writable property retaining the supplied authorization-failure callback value; direct construction supplies no default or validation. |
| `RequiresRegistration` | Internal writable property indicating whether a native root registration is required. |
| `CommandToRegister` | Internal writable property containing the root native command name. |

## `TypedCommandContext`

| Member | Signature |
| --- | --- |
| `Command` | Internal writable property containing the original native command payload object with PascalCase keys. |
| `TypedCommand` | Internal writable property containing the configured typed registration class. |
| `Arguments` | Getter returning the original mutable payload argument array, not a copy or the converted typed arguments. |
| `Index` | Writable property reading and updating the original payload's `Index`; assignment is not validated here. |
| `TeamOnly` | Getter coerces the original payload's `TeamOnly` to boolean; the setter writes `Boolean(bTeamOnlyFlag)` back to that payload. This does not validate the command's origin. |
| [`Reply`](#typedcommandcontextreply) | `Reply(strReplyMessage, strLanguageCode = null, TranslationTokens = {})`; forwards to the configured class's `SendMessage` and preserves its result or exception. |
| [`IsPrivateCommand`](#typedcommandcontextisprivatecommand) | `IsPrivateCommand()` |
| `AutoCommandReturn` | Read-only property containing the channel-specific automatic return value. |

## `TypedCommandParser`

| Member | Signature |
| --- | --- |
| `Commands` | Inherited internal writable property containing the parser root path. |
| `Description` | Inherited writable internal property containing the description or `null`. |
| `Children` | Inherited internal writable property containing the live root-node `Map`. |
| `Signature` | Inherited read-only sub-command signature. |
| `HelpText` | Inherited read-only property containing sorted root help text. |
| `HasCommand` | Inherited `HasCommand(strCommandName)` |
| `SetCommand` | Inherited `SetCommand(strCommandName, CommandNode)` |
| `DeleteCommand` | Inherited `DeleteCommand(strCommandName)` |
| `Values` | Inherited `Values()` |
| `Size` | Inherited read-only root-node count. |
| [`AddCommand`](#typedcommandparseraddcommand) | `AddCommand(CommandPath, vecCommandParameters, CommandCallback, strCommandDescription = null, RequiredPermission = null, AuthorizationFailureCallback = null)` |
| [`RemoveCommand`](#typedcommandparserremovecommand) | `RemoveCommand(CommandPath)` |
| [`RemoveCommandPath`](#typedcommandparserremovecommandpath) | `RemoveCommandPath(vecNormalizedCommandPath)` |
| [`GetNode`](#typedcommandparsergetnode) | `GetNode(CommandPath)` |
| [`GetCommand`](#typedcommandparsergetcommand) | `GetCommand(CommandPath)` |
| [`SetNodeDescription`](#typedcommandparsersetnodedescription) | `SetNodeDescription(CommandPath, strNodeDescription)` |
| [`ParseCommand`](#typedcommandparserparsecommand) | `ParseCommand(CommandContext)` |
| [`CleanCommand`](#typedcommandparsercleancommand) | `CleanCommand(CommandNode, vecArgumentValues)` |

`AddCommand` accepts a command string or a non-empty dense array of non-empty names without spaces, plus a dense parameter array (which may be empty). Array lengths and own slots are read once into plain arrays; custom iterators, `slice`, `map`, and array species do not override validation. Parameter descriptors are normalized before checking that a rest parameter is last. Removal traverses and prunes the tree iteratively, without a command-depth limit imposed by the JavaScript call stack; missing paths throw before deletion, and shared sibling branches remain intact. `RemoveCommand` and `RemoveCommandPath` return `true` when that path's root entry is removed; `false` can accompany a successful leaf removal when sibling commands keep a parent store alive.

## Typed Registration Instances

These members are inherited by `TypedServerCommandRegistration`, `TypedPlayerCommandRegistration`, `TypedClientCommandRegistration`, and `TypedSayCommandRegistration`. `TypedPlayerCommandRegistration` is the authorization-aware base class; use a configured server, client, or say class for registration. These properties are implementation state and should not be mutated directly, especially while a registration is loaded.

| Member | Signature |
| --- | --- |
| `Commands` | Internal writable property containing the command path. |
| `Permission` | Internal writable property retaining the supplied permission option, including `true` for a path-derived permission, or `null` when nullish. |
| `FailureCallback` | Internal writable property retaining the failure-callback option, or `null` when nullish; `Register` checks that a non-null value is a function. |
| `Description` | Internal writable property containing the description or `null`. |
| `Parameters` | Internal writable property containing the default parameter descriptors. |
| `CommandNode` | Internal writable property containing the loaded `TypedCommandNode` or `null`. |
| `Register` | `Register(CommandCallback, vecCommandParameters = this.Parameters)` |
| `Unload` | `Unload()` |

`Register` rolls back a failed native registration using the node's validated path snapshot, without reading the original path array again. Successful rollback clears `CommandNode` and rethrows the exact registration failure. If rollback also throws, an `AggregateError` retains both failures in registration/cleanup order and the node remains available for inspection. Native registration must not reenter or mutate the parser.

`Unload()` returns `false` when already unloaded. It verifies that the stored path still identifies this registration's node. When removing the last command beneath a native root, it unregisters the native handler before removing the parser node: a native failure leaves the original node available for a retry. Removing one of several sibling commands retains the shared native handler. Success clears `CommandNode` and returns `true`. Native unregistration must not reenter or mutate the parser; direct mutation of implementation properties is unsupported.

## `TypedPlayerCommandRegistration`

| Member | Signature |
| --- | --- |
| `RunCommand` | Static `RunCommand(CommandContext, CommandNode, vecConvertedArgumentValues)` |

## Configured Typed Registration Classes

These static members are available on `TypedServerCommandRegistration`, `TypedClientCommandRegistration`, and `TypedSayCommandRegistration`.

| Member | Signature |
| --- | --- |
| `HandleCommand` | Static `HandleCommand(CommandPayload)`; parses and converts arguments, then invokes `RunCommand`. Nullish callback results select `AutoCommandReturn`; other results are preserved. A `ValidationError` is sent as a reply and returns `Continue`. If that reply returns `false` or throws, an `AggregateError` retains the validation error followed by the reply error. Other exceptions propagate. |
| `RunCommand` | Static `RunCommand(CommandContext, CommandNode, vecConvertedArgumentValues)` |
| `SendMessage` | Static `SendMessage(CommandContext, strReplyMessage)` |
| `GetCommandReturn` | Static `GetCommandReturn()` on server/client registrations and `GetCommandReturn(CommandContext)` on say registrations. |
| `Parser` | Static live `TypedCommandParser`. |
| `Manager` | Static `CommandRegistrationManager` for the native channel. |
| `NativeRegistrations` | Static live map keyed by lowercase root command names so case-insensitive sibling paths share one native registration. The native registration retains the original root spelling. |
| `CommandHandler` | Static native callback `CommandHandler(CommandPayload)`. |

### Channel Behavior

| Class | `SendMessage` target | Automatic return |
| --- | --- | --- |
| [`TypedServerCommandRegistration`](#typedservercommandregistration) | SourceJS logger. | `CONTINUE` |
| [`TypedClientCommandRegistration`](#typedclientcommandregistration) | Invoking client's console. | `BLOCK` |
| [`TypedSayCommandRegistration`](#typedsaycommandregistration) | Invoking client's console. | `BLOCK` for `/` commands; otherwise `CONTINUE`. |

## Examples

### `ArgumentError`

```js
const { ArgumentError } = require("commands/typed");

function RequireMapName(strMapName) {
	if (strMapName.trim().length === 0) {
		throw new ArgumentError("Map name is required.", { Language: "en", Tokens: { Argument: "map" } });
	}

	return strMapName;
}

RequireMapName("c1m1_hotel");
```

### `ArgumentNumberMismatch`

```js
const { ArgumentNumberMismatch } = require("commands/typed");

function RequireExactlyTwoArguments(vecArgumentValues) {
	if (vecArgumentValues.length !== 2) {
		throw new ArgumentNumberMismatch("Usage: sjs_teleport <player> <target>");
	}
}

RequireExactlyTwoArguments(["Ren", "Ellis"]);
```

### `CommandTreeNode`

```js
const { CommandTreeNode } = require("commands/typed");

const g_MapCommandTreeNode = new CommandTreeNode(["sjs", "map"], "Show the current map.");
g_MapCommandTreeNode.Description = "Print the current map name.";
console.log(JSON.stringify({ Commands: g_MapCommandTreeNode.Commands, Description: g_MapCommandTreeNode.Description, Signature: g_MapCommandTreeNode.Signature }));
```

### `CommandTreeStore`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTreeRoot = new CommandTreeStore(["sjs"], "SourceJS commands");
g_CommandTreeRoot.SetCommand("map", new CommandTreeNode(["sjs", "map"], "Show the current map."));
g_CommandTreeRoot.SetCommand("players", new CommandTreeNode(["sjs", "players"], "Show connected players."));

g_CommandTreeRoot.Description = "SourceJS administration commands";
console.log(JSON.stringify({ Children: Array.from(g_CommandTreeRoot.Children.keys()), Commands: g_CommandTreeRoot.Commands, Description: g_CommandTreeRoot.Description, Signature: g_CommandTreeRoot.Signature, Size: g_CommandTreeRoot.Size }));
console.log(g_CommandTreeRoot.HelpText);
```

### `InvalidArgumentValue`

```js
const { InvalidArgumentValue } = require("commands/typed");

function ParsePositiveInteger(strIntegerText) {
	const nInteger = Number(strIntegerText);
	if (!Number.isSafeInteger(nInteger) || (nInteger < 1)) {
		throw new InvalidArgumentValue("Expected a positive safe integer.");
	}

	return nInteger;
}

ParsePositiveInteger("12");
```

### `PRIVATE_COMMAND_PREFIX`

```js
const { PRIVATE_COMMAND_PREFIX } = require("commands/typed");

const g_strCommandName = "/admin";
const g_bIsPrivate = g_strCommandName.startsWith(PRIVATE_COMMAND_PREFIX);

console.log(`Hide command from chat: ${g_bIsPrivate}`);
```

### `SubCommandError`

```js
const { TypedCommandParser, SubCommandError } = require("commands/typed");

function ShowMap() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], ShowMap, "Show the current map.");

try {
	g_CommandParser.ParseCommand({ Arguments: ["sjs", "unknown"] });
} catch (ErrorValue) {
	if (ErrorValue instanceof SubCommandError) {
		console.log(ErrorValue.message);

	} else {
		throw ErrorValue;
	}
}
```

### `SubCommandExpectedError`

```js
const { TypedCommandParser, SubCommandExpectedError } = require("commands/typed");

function ShowMap() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], ShowMap, "Show the current map.");

try {
	g_CommandParser.ParseCommand({ Arguments: ["sjs"] });
} catch (ErrorValue) {
	if (ErrorValue instanceof SubCommandExpectedError) {
		console.log(ErrorValue.message);

	} else {
		throw ErrorValue;
	}
}
```

### `SubCommandNotFound`

```js
const { TypedCommandParser, SubCommandNotFound } = require("commands/typed");

function ShowMap() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], ShowMap, "Show the current map.");

try {
	g_CommandParser.ParseCommand({ Arguments: ["sjs", "players"] });
} catch (ErrorValue) {
	if (ErrorValue instanceof SubCommandNotFound) {
		console.log(ErrorValue.message);

	} else {
		throw ErrorValue;
	}
}
```

### `TypedClientCommandRegistration`

```js
const { SendCommand } = require("commands/client");
const { TypedClientCommandRegistration } = require("commands/typed");

function RejectVolumeCommand(TypedCommandContext) {
	if (!TypedCommandContext.Reply("Missing permission: sourcejs.volume")) {
		throw new Error("Unable to send the permission failure response.");
	}
}

function SetVolume(TypedCommandContext, dblValue) {
	if (!SendCommand(TypedCommandContext.Index, `volume ${dblValue}`, false)) {
		throw new Error("Unable to issue the volume command.");
	}

	if (!TypedCommandContext.Reply(`Volume change requested: ${dblValue}.`)) {
		throw new Error("Unable to send the volume response.");
	}
}

function GetParameterName(ParameterDescriptor) {
	return ParameterDescriptor.Name;
}

function UnloadPlugin() {
	if (!g_VolumeCommandRegistration.Unload()) {
		throw new Error("Volume command registration is not loaded.");
	}
}

const g_VolumeCommandRegistration = new TypedClientCommandRegistration(["sjs_volume"], { Permission: "sourcejs.volume", FailureCallback: RejectVolumeCommand, Description: "Set the client volume.", Parameters: [{ Name: "value", Type: Number }] });
g_VolumeCommandRegistration.Register(SetVolume);

console.log(JSON.stringify({ CommandPath: g_VolumeCommandRegistration.Commands, Permission: g_VolumeCommandRegistration.Permission, HasFailureCallback: g_VolumeCommandRegistration.FailureCallback !== null, Description: g_VolumeCommandRegistration.Description, Parameters: g_VolumeCommandRegistration.Parameters.map(GetParameterName), CommandSignature: g_VolumeCommandRegistration.CommandNode.Signature }));

exports.Unload = UnloadPlugin;
```

### `TypedCommandContext`

```js
const { TypedCommandContext, TypedSayCommandRegistration } = require("commands/typed");

const g_CommandPayload = { Kind: "say", Name: "/ready", Raw: "/ready", Index: 1, Arguments: ["/ready"], Message: "/ready", TeamOnly: false };
const g_CommandContext = new TypedCommandContext(g_CommandPayload, TypedSayCommandRegistration);
console.log(JSON.stringify({ AutomaticCommandReturn: g_CommandContext.AutoCommandReturn, CommandMatches: g_CommandContext.Command === g_CommandPayload, ClientIndex: g_CommandContext.Index, TeamOnly: g_CommandContext.TeamOnly, TypedCommandRegistrationClass: g_CommandContext.TypedCommand.name }));

if (g_CommandContext.IsPrivateCommand()) {
	if (!g_CommandContext.Reply("Ready command context inspected.")) {
		throw new Error("Unable to send the context response.");
	}
}
```

### `TypedCommandNode`

```js
const { SetConVar } = require("cvars");
const { TypedCommandNode } = require("commands/typed");

function SetGravity(TypedCommandContext, dblValue) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumConVarValue)) {
		throw new RangeError("Gravity must be a finite value within the float range.");
	}

	if (!SetConVar("sv_gravity", dblValue)) {
		throw new Error("Unable to set server gravity.");
	}

	return TypedCommandContext.Reply(`Server gravity set to ${dblValue}.`);
}

function RejectGravityChange(TypedCommandContext) {
	return TypedCommandContext.Reply("Missing permission: sourcejs.admin");
}

function GetParameterName(ParameterDescriptor) {
	return ParameterDescriptor.Name;
}

const g_CommandNode = new TypedCommandNode(["sjs", "gravity"], [{ Name: "value", Type: Number, Required: true, Rest: false }], SetGravity, "Set server gravity.", "sourcejs.admin", RejectGravityChange, true);
console.log(JSON.stringify({ CallbackName: g_CommandNode.Callback.name, CommandToRegister: g_CommandNode.CommandToRegister, Commands: g_CommandNode.Commands, Description: g_CommandNode.Description, FailureCallbackName: g_CommandNode.FailureCallback.name, Parameters: g_CommandNode.Parameters.map(GetParameterName), Permission: g_CommandNode.Permission, RequiresRegistration: g_CommandNode.RequiresRegistration, Signature: g_CommandNode.Signature }));
```

### `TypedCommandParser`

```js
const { SetConVar } = require("cvars");
const { TypedCommandParser } = require("commands/typed");

function SetGravity(TypedCommandContext, dblValue) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumConVarValue)) {
		throw new RangeError("Gravity must be a finite value within the float range.");
	}

	if (!SetConVar("sv_gravity", dblValue)) {
		throw new Error("Unable to set server gravity.");
	}

	return TypedCommandContext.Reply(`Server gravity set to ${dblValue}.`);
}

function GetCommandSignature(CommandTreeNode) {
	return CommandTreeNode.Signature;
}

const g_CommandParser = new TypedCommandParser(["sjs"], "SourceJS commands");
const g_GravityCommandNode = g_CommandParser.AddCommand(["sjs", "gravity"], [{ Name: "value", Type: Number }], SetGravity, "Set server gravity.");

const g_vecCommandTreeNodeSignatures = Array.from(g_CommandParser.Values(), GetCommandSignature);
console.log(JSON.stringify({ Children: Array.from(g_CommandParser.Children.keys()), Commands: g_CommandParser.Commands, Description: g_CommandParser.Description, GravityCommandNodeMatches: g_CommandParser.GetNode(["sjs"]).GetCommand("gravity") === g_GravityCommandNode, HasRoot: g_CommandParser.HasCommand("sjs"), Signature: g_CommandParser.Signature, Size: g_CommandParser.Size, CommandTreeNodeSignatures: g_vecCommandTreeNodeSignatures }));
console.log(g_CommandParser.HelpText);
```

### `TypedPlayerCommandRegistration`

```js
const { TypedClientCommandRegistration, TypedPlayerCommandRegistration } = require("commands/typed");

const g_ClientCommandRegistration = new TypedClientCommandRegistration(["sjs_ready"]);
console.log(g_ClientCommandRegistration instanceof TypedPlayerCommandRegistration);
```

### `TypedPlayerCommandRegistration.RunCommand` and configured static API

```js
const { HANDLED } = require("commands");
const { TypedClientCommandRegistration, TypedCommandContext } = require("commands/typed");

let g_dblInvocationCount = 0;

function RunDiagnostic(CommandContext, dblCount) {
	g_dblInvocationCount += dblCount;
	if (!CommandContext.Reply(`Diagnostic invocation count: ${g_dblInvocationCount}`)) {
		throw new Error("Unable to send the diagnostic response.");
	}

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_DiagnosticCommandRegistration.Unload()) {
		throw new Error("Diagnostic command registration is not loaded.");
	}
}

const g_DiagnosticCommandRegistration = new TypedClientCommandRegistration(["sjs_typed_diagnostic"], { Parameters: [{ Name: "count", Type: Number }] });
g_DiagnosticCommandRegistration.Register(RunDiagnostic);

const g_CommandPayload = { Kind: "client", Name: "sjs_typed_diagnostic", Raw: "sjs_typed_diagnostic 2", Index: 1, Arguments: ["sjs_typed_diagnostic", "2"], Message: "", TeamOnly: false };
const g_CommandContext = new TypedCommandContext(g_CommandPayload, TypedClientCommandRegistration);
const g_CommandNode = TypedClientCommandRegistration.Parser.GetCommand(["sjs_typed_diagnostic"]);
const g_vecConvertedArgumentValues = TypedClientCommandRegistration.Parser.CleanCommand(g_CommandNode, ["2"]);
const g_unRunCommandReturn = TypedClientCommandRegistration.RunCommand(g_CommandContext, g_CommandNode, g_vecConvertedArgumentValues);
const g_unHandledCommandReturn = TypedClientCommandRegistration.HandleCommand(g_CommandPayload);
const g_unCallbackCommandReturn = TypedClientCommandRegistration.CommandHandler(g_CommandPayload);
const g_unAutomaticCommandReturn = TypedClientCommandRegistration.GetCommandReturn();

if (!TypedClientCommandRegistration.SendMessage(g_CommandContext, "Static typed API completed.")) {
	throw new Error("Unable to send the static API response.");
}

console.log(JSON.stringify({ AutomaticCommandReturn: g_unAutomaticCommandReturn, CallbackCommandReturn: g_unCallbackCommandReturn, CommandHandlerType: typeof TypedClientCommandRegistration.CommandHandler, HandledCommandReturn: g_unHandledCommandReturn, InvocationCount: g_dblInvocationCount, ManagerOwnsNativeRegistration: TypedClientCommandRegistration.Manager.Registrations.size > 0, NativeRegistrationExists: TypedClientCommandRegistration.NativeRegistrations.has("sjs_typed_diagnostic"), TypedCommandParserNodeMatches: TypedClientCommandRegistration.Parser.GetCommand(["sjs_typed_diagnostic"]) === g_CommandNode, RunCommandReturn: g_unRunCommandReturn }));

exports.Unload = UnloadPlugin;
```

### `TypedSayCommandRegistration`

```js
const { TypedSayCommandRegistration } = require("commands/typed");
const { Player } = require("players/entity");

function MarkReady(TypedCommandContext) {
	if (!Player(TypedCommandContext.Index).Say("Ready.")) {
		throw new Error("Unable to issue the ready chat command.");
	}
}

function UnloadPlugin() {
	if (!g_ReadyCommandRegistration.Unload()) {
		throw new Error("Ready command registration is not loaded.");
	}
}

const g_ReadyCommandRegistration = new TypedSayCommandRegistration(["/ready"], { Description: "Say Ready in chat; no readiness state is stored." });
g_ReadyCommandRegistration.Register(MarkReady);

exports.Unload = UnloadPlugin;
```

### `TypedServerCommandRegistration`

```js
const { SetConVar } = require("cvars");
const { TypedServerCommandRegistration } = require("commands/typed");

function SetGravity(TypedCommandContext, dblValue) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumConVarValue)) {
		throw new RangeError("Gravity must be a finite value within the ConVar float range.");
	}

	if (!SetConVar("sv_gravity", dblValue)) {
		throw new Error("Unable to set server gravity.");
	}

	return TypedCommandContext.Reply(`Server gravity set to ${dblValue}.`);
}

function UnloadPlugin() {
	if (!g_GravityCommandRegistration.Unload()) {
		throw new Error("Gravity command registration is not loaded.");
	}
}

const g_GravityCommandRegistration = new TypedServerCommandRegistration(["sjs", "gravity"], { Description: "Set server gravity.", Parameters: [{ Name: "value", Type: Number }] });
g_GravityCommandRegistration.Register(SetGravity);

exports.Unload = UnloadPlugin;
```

### `ValidationError`

```js
const { ValidationError } = require("commands/typed");
const { GetConnectedPlayers } = require("filters/players");

function ParseConnectedPlayerIndex(strPlayerIndex) {
	const nClientIndex = Number(strPlayerIndex);
	const MatchesPlayerIndex = (PlayerRecord) => PlayerRecord.Index === nClientIndex;
	if (!Number.isSafeInteger(nClientIndex) || !GetConnectedPlayers().some(MatchesPlayerIndex)) {
		throw new ValidationError(`Player "${strPlayerIndex}" is not connected.`, { Language: "en", Tokens: { Player: strPlayerIndex } });
	}

	return nClientIndex;
}

try {
	ParseConnectedPlayerIndex("not-an-index");
} catch (ErrorValue) {
	if (!(ErrorValue instanceof ValidationError)) {
		throw ErrorValue;
	}

	console.log(`[${ErrorValue.Language}] ${ErrorValue.message}; Player=${ErrorValue.Tokens.Player}`);
}
```

### `FilterPlayers`

```js
const { FilterPlayers } = require("commands/typed");

const g_vecHumanPlayers = FilterPlayers("#humans");
for (const PlayerRecord of g_vecHumanPlayers) {
	console.log(`${PlayerRecord.Index}: ${PlayerRecord.Name}`);
}
```

### `RegisterTypedClientCommand`

```js
const { SendCommand } = require("commands/client");
const { RegisterTypedClientCommand } = require("commands/typed");

function SetVolume(TypedCommandContext, dblValue) {
	if (!SendCommand(TypedCommandContext.Index, `volume ${dblValue}`, false)) {
		throw new Error("Unable to issue the volume command.");
	}
}

function UnloadPlugin() {
	if (!g_VolumeCommandRegistration.Unload()) {
		throw new Error("Volume command registration is not loaded.");
	}
}

const g_VolumeCommandRegistration = RegisterTypedClientCommand(["sjs_volume"], { Parameters: [{ Name: "value", Type: Number }] });
g_VolumeCommandRegistration.Register(SetVolume);

exports.Unload = UnloadPlugin;
```

### `RegisterTypedSayCommand`

```js
const { RegisterTypedSayCommand } = require("commands/typed");
const { Player } = require("players/entity");

function MarkReady(TypedCommandContext) {
	if (!Player(TypedCommandContext.Index).Say("Ready.")) {
		throw new Error("Failed to send the ready message.");
	}
}

function UnloadPlugin() {
	if (!g_ReadyCommandRegistration.Unload()) {
		throw new Error("Failed to unload the ready command.");
	}
}

const g_ReadyCommandRegistration = RegisterTypedSayCommand(["/ready"], { Description: "Say Ready in chat; no readiness state is stored." });
g_ReadyCommandRegistration.Register(MarkReady);

exports.Unload = UnloadPlugin;
```

### `RegisterTypedServerCommand`

```js
const { SetConVar } = require("cvars");
const { RegisterTypedServerCommand } = require("commands/typed");

function SetGravity(TypedCommandContext, dblValue) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumConVarValue)) {
		throw new RangeError("Gravity must be a finite value within the ConVar float range.");
	}

	if (!SetConVar("sv_gravity", dblValue)) {
		throw new Error("Failed to set server gravity.");
	}

	return TypedCommandContext.Reply(`Server gravity set to ${dblValue}.`);
}

function UnloadPlugin() {
	if (!g_GravityCommandRegistration.Unload()) {
		throw new Error("Failed to unload the gravity command.");
	}
}

const g_GravityCommandRegistration = RegisterTypedServerCommand(["sjs", "gravity"], { Description: "Set server gravity.", Parameters: [{ Name: "value", Type: Number }] });
g_GravityCommandRegistration.Register(SetGravity);

exports.Unload = UnloadPlugin;
```

### `CommandTreeStore.DeleteCommand`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTree = new CommandTreeStore(["sjs"]);
g_CommandTree.SetCommand("map", new CommandTreeNode(["sjs", "map"], "Show the current map."));

if (!g_CommandTree.DeleteCommand("map")) {
	throw new Error("The map command was not found.");
}

console.log(g_CommandTree.HasCommand("map"));
```

### `CommandTreeStore.GetCommand`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTree = new CommandTreeStore(["sjs"]);
g_CommandTree.SetCommand("map", new CommandTreeNode(["sjs", "map"], "Show the current map."));

console.log(g_CommandTree.GetCommand("map").Description);
```

### `CommandTreeStore.HasCommand`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTree = new CommandTreeStore(["sjs"]);
g_CommandTree.SetCommand("players", new CommandTreeNode(["sjs", "players"]));

if (g_CommandTree.HasCommand("players")) {
	console.log("Player command is present in this tree.");
}
```

### `CommandTreeStore.SetCommand`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTree = new CommandTreeStore(["sjs"]);
g_CommandTree.SetCommand("gravity", new CommandTreeNode(["sjs", "gravity"], "Set server gravity."));

console.log(g_CommandTree.HelpText);
```

### `CommandTreeStore.Values`

```js
const { CommandTreeNode, CommandTreeStore } = require("commands/typed");

const g_CommandTree = new CommandTreeStore(["sjs"]);
g_CommandTree.SetCommand("map", new CommandTreeNode(["sjs", "map"]));
g_CommandTree.SetCommand("players", new CommandTreeNode(["sjs", "players"]));

for (const CommandNode of g_CommandTree.Values()) {
	console.log(CommandNode.Signature);
}
```

### `TypedCommandContext.IsPrivateCommand`

```js
const { TypedCommandContext, TypedSayCommandRegistration } = require("commands/typed");

const g_CommandPayload = { Kind: "say", Name: "/ready", Raw: "/ready", Index: 1, Arguments: ["/ready"], Message: "/ready", TeamOnly: false };
const g_CommandContext = new TypedCommandContext(g_CommandPayload, TypedSayCommandRegistration);
console.log(g_CommandContext.IsPrivateCommand());
```

### `TypedCommandContext.Reply`

```js
const { TypedCommandContext, TypedSayCommandRegistration } = require("commands/typed");

const g_CommandPayload = { Kind: "say", Name: "/ready", Raw: "/ready", Index: 1, Arguments: ["/ready"], Message: "/ready", TeamOnly: false };
const g_CommandContext = new TypedCommandContext(g_CommandPayload, TypedSayCommandRegistration);
if (!g_CommandContext.Reply("Ready command context inspected.")) {
	throw new Error("Failed to send the command reply.");
}
```

### `TypedCommandParser.AddCommand`

```js
const { SetConVar } = require("cvars");
const { TypedCommandParser } = require("commands/typed");

function SetGravity(TypedCommandContext, dblValue) {
	const dblMaximumConVarValue = 3.4028234663852886e38;
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumConVarValue)) {
		throw new RangeError("Gravity must be a finite value within the ConVar float range.");
	}

	if (!SetConVar("sv_gravity", dblValue)) {
		throw new Error("Failed to set server gravity.");
	}

	return TypedCommandContext.Reply(`Server gravity set to ${dblValue}.`);
}

function RejectGravityChange(TypedCommandContext) {
	return TypedCommandContext.Reply("Missing permission: sourcejs.admin");
}

const g_CommandParser = new TypedCommandParser();
const g_GravityCommandNode = g_CommandParser.AddCommand(["sjs", "gravity"], [{ Name: "value", Type: Number }], SetGravity, "Set server gravity.", "sourcejs.admin", RejectGravityChange);
console.log(g_GravityCommandNode.Signature);
```

### `TypedCommandParser.CleanCommand`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
const g_CommandNode = g_CommandParser.AddCommand(["sjs", "gravity"], [{ Name: "value", Type: Number }], NoOperation);
const [g_dblGravity] = g_CommandParser.CleanCommand(g_CommandNode, ["600"]);
console.log(g_dblGravity);
```

### `TypedCommandParser.GetCommand`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], NoOperation, "Show the current map.");

console.log(g_CommandParser.GetCommand(["sjs", "map"]).Description);
```

### `TypedCommandParser.GetNode`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], NoOperation, "Show the current map.");

console.log(g_CommandParser.GetNode(["sjs"]).HelpText);
```

### `TypedCommandParser.ParseCommand`

`ParseCommand()` selects the command node and returns the remaining raw arguments; `CleanCommand()` performs parameter conversion and validation.

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "gravity"], [{ Name: "value", Type: Number }], NoOperation);

const [g_TypedCommandNode, g_vecArgumentValues] = g_CommandParser.ParseCommand({ Arguments: ["sjs", "gravity", "600"] });
console.log(g_TypedCommandNode.Signature);
console.log(g_vecArgumentValues);
```

### `TypedCommandParser.RemoveCommand`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], NoOperation);

const g_bRootRemoved = g_CommandParser.RemoveCommand(["sjs", "map"]);
console.log(g_bRootRemoved);
console.log(g_CommandParser.HasCommand("sjs"));
```

### `TypedCommandParser.RemoveCommandPath`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "gravity"], [], NoOperation);

const g_bRootRemoved = g_CommandParser.RemoveCommandPath(["sjs", "gravity"]);
console.log(g_bRootRemoved);
console.log(g_CommandParser.HasCommand("sjs"));
```

### `TypedCommandParser.SetNodeDescription`

```js
const { TypedCommandParser } = require("commands/typed");

function NoOperation() {
	return undefined;
}

const g_CommandParser = new TypedCommandParser();
g_CommandParser.AddCommand(["sjs", "map"], [], NoOperation);

g_CommandParser.SetNodeDescription(["sjs", "map"], "Show the current map.");

console.log(g_CommandParser.GetCommand(["sjs", "map"]).Description);
```

### `TypedClientCommandRegistration.Register`

```js
const { SendCommand } = require("commands/client");
const { TypedClientCommandRegistration } = require("commands/typed");

function SetVolume(TypedCommandContext, dblValue) {
	if (!SendCommand(TypedCommandContext.Index, `volume ${dblValue}`, false)) {
		throw new Error("Failed to send the volume command.");
	}
}

function UnloadPlugin() {
	if (!g_VolumeCommandRegistration.Unload()) {
		throw new Error("Failed to unload the volume command.");
	}
}

const g_VolumeCommandRegistration = new TypedClientCommandRegistration(["sjs_volume"]);
g_VolumeCommandRegistration.Register(SetVolume, [{ Name: "value", Type: Number }]);

exports.Unload = UnloadPlugin;
```

### `TypedClientCommandRegistration.Unload`

```js
const { TypedClientCommandRegistration } = require("commands/typed");

function MarkReady(TypedCommandContext) {
	if (!TypedCommandContext.Reply("Ready command received.")) {
		throw new Error("Failed to send the command reply.");
	}
}

function UnloadPlugin() {
	if (!g_ReadyCommandRegistration.Unload()) {
		throw new Error("Failed to unload the ready command.");
	}
}

const g_ReadyCommandRegistration = new TypedClientCommandRegistration(["sjs_ready"]);
g_ReadyCommandRegistration.Register(MarkReady);

exports.Unload = UnloadPlugin;
```
