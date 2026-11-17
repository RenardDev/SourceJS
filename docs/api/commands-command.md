# `require("commands/command")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CommandRegistration`](#commandregistration)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Examples adapt a native command module to the two-method registration contract and retain the registration resource for cleanup.

`CommandRegistration` is a JavaScript helper, not a native module. It expects an adapter with `Register(strName, Callback)` and `Unregister(strName, Callback)` methods. Native command modules use command-kind-specific names, so do not pass the object returned by `GetCommandModuleRuntime()` directly.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/command.js`](../../packages/sourcejs/commands/command.js). It owns one callback registration across one or more normalized command names and provides explicit `Load()`/`Unload()` lifecycle control. This is a low-level resource wrapper over a command registration adapter; higher-level code normally uses a command registration manager.

Retain the instance before calling `Load()`. A failed load rolls back confirmed registrations; if rollback also fails, it throws an `AggregateError` containing the registration and cleanup errors, and the instance remains loaded for another `Unload()` attempt. Successful individual removals are not repeated. Adapters must report registration/removal success accurately and must not change registration state before returning failure or throwing; the helper cannot infer unreported side effects.

## Import

```js
const { CommandRegistration, RegisterCommand } = require("commands/command");

console.log(CommandRegistration, RegisterCommand);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CommandRegistration`](#commandregistration-1) | Class | `new CommandRegistration(NativeCommandRuntime, CommandNameOrNames, CommandCallback)` |
| [`RegisterCommand`](#registercommand) | Function | `RegisterCommand(NativeCommandRuntime, CommandNameOrNames, CommandCallback)` |

## `CommandRegistration`

| Member | Signature or access |
| --- | --- |
| `Names` | Read-only property returning a copy of the normalized command-name array. |
| `Loaded` | Read-only lifecycle state; remains `true` after incomplete cleanup, not proof that every name is registered. |
| `Callback` | Read-only registered callback. |
| [`Load`](#commandregistrationload) | `Load()` |
| `Runtime` | Read-only supplied command registration adapter. |
| [`Unload`](#commandregistrationunload) | `Unload()` |

The constructor accepts one command name or an array, trims every name, and rejects empty or duplicate normalized names. `Load()` throws when already loaded and returns the same instance on success. A falsy registration result or thrown error triggers rollback of earlier confirmed registrations. Successful rollback clears `Loaded` and propagates the original registration error; failed rollback throws an `AggregateError` whose `errors` array contains the registration error followed by the cleanup error.

Name arrays are captured slot by slot into a plain array before any registration. Holes and inherited indexed values are rejected; source `every`/`map` methods and species constructors are not invoked. Each source name is read and trimmed once. Later changes to the original array do not change the normalized names.

`Unload()` returns `false` when already unloaded. Otherwise it removes confirmed registrations in order, checking each result. A falsy result throws an error; an adapter exception propagates. Both leave `Loaded` true and retain the failed name and all later names for retry. Once all removals succeed, it clears `Loaded` and returns `true`. Retain an explicitly constructed instance when cleanup can fail: the eager `RegisterCommand()` factory does not return its instance if loading throws.

## Examples

### `CommandRegistration`

```js
const { HANDLED } = require("commands");
const { CommandRegistration } = require("commands/command");
const { GetGlobalVariables } = require("globals");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function ShowMapInformation() {
	console.log(GetGlobalVariables().MapName);

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_MapInformationRegistration.Unload()) {
		throw new Error("Map-info command registration is not loaded.");
	}
}

const g_MapInformationRegistration = new CommandRegistration(g_ServerCommandRegistrationRuntime, ["sjs_mapinfo"], ShowMapInformation);
g_MapInformationRegistration.Load();

exports.Unload = UnloadPlugin;
```

### `CommandRegistration.Callback`, `Loaded`, `Names`, and `Runtime`

```js
const { HANDLED } = require("commands");
const { CommandRegistration } = require("commands/command");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function RefreshStatus() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_StatusRegistration.Unload()) {
		throw new Error("Status command registration is not loaded.");
	}
}

const g_StatusRegistration = new CommandRegistration(g_ServerCommandRegistrationRuntime, ["sjs_refresh_status"], RefreshStatus);
g_StatusRegistration.Load();

const g_RegistrationState = { CallbackName: g_StatusRegistration.Callback.name, Loaded: g_StatusRegistration.Loaded, Names: g_StatusRegistration.Names, UsesServerRuntime: g_StatusRegistration.Runtime === g_ServerCommandRegistrationRuntime };
console.log(JSON.stringify(g_RegistrationState));

exports.Unload = UnloadPlugin;
```

### `RegisterCommand`

```js
const { HANDLED } = require("commands");
const { RegisterCommand } = require("commands/command");
const { GetCommandModuleRuntime } = require("internal/commands");
const { GetAllPlayers } = require("players");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function ShowPlayerCount() {
	console.log(GetAllPlayers().length);

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_PlayerCountRegistration.Unload()) {
		throw new Error("Player-count command registration is not loaded.");
	}
}

const g_PlayerCountRegistration = RegisterCommand(g_ServerCommandRegistrationRuntime, ["sjs_player_count"], ShowPlayerCount);

exports.Unload = UnloadPlugin;
```

### `CommandRegistration.Load`

```js
const { Command, HANDLED } = require("commands");
const { CommandRegistration } = require("commands/command");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");
const g_ClientCommandRegistrationRuntime = Object.freeze({ Register: g_ClientCommandModule.RegisterClientCommand, Unregister: g_ClientCommandModule.UnregisterClientCommand });

function MarkReady(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	console.log(`Player ${ClientCommand.Index} is ready.`);

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_ReadyRegistration.Unload()) {
		throw new Error("Ready command registration is not loaded.");
	}
}

const g_ReadyRegistration = new CommandRegistration(g_ClientCommandRegistrationRuntime, ["sjs_ready"], MarkReady);
g_ReadyRegistration.Load();

exports.Unload = UnloadPlugin;
```

### `CommandRegistration.Unload`

```js
const { HANDLED } = require("commands");
const { CommandRegistration } = require("commands/command");
const { VERSION } = require("core/version");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function ShowVersion() {
	console.log(VERSION);

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_VersionRegistration.Unload()) {
		throw new Error("Version command registration is not loaded.");
	}
}

const g_VersionRegistration = new CommandRegistration(g_ServerCommandRegistrationRuntime, ["sjs_build_version"], ShowVersion);
g_VersionRegistration.Load();

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Adapt the selected native module to `Register` and `Unregister`: server modules expose `RegisterCommand`/`UnregisterCommand`, client modules expose `RegisterClientCommand`/`UnregisterClientCommand`, and say modules expose `RegisterSayCommand`/`UnregisterSayCommand`. Do not pass the native module directly.
- Pass either one command-name string or a dense array of unique non-empty strings. Construction trims names, rejects duplicates, and stores a normalized copy.
- Call `Load()` only while unloaded; a successful `Unload()` permits another load. Registration failures, including exceptions, trigger rollback of confirmed registrations. An `AggregateError` indicates that rollback also failed; retain the instance and retry cleanup rather than loading again.
- Retain the registration object and check `Unload()` during plugin cleanup. It returns `false` when already unloaded. Falsy unregistration results and exceptions interrupt cleanup without discarding the remaining registrations. Retry removes only names not yet successfully removed; `Loaded` becomes false only after all removals succeed.
- `RegisterCommand(...)` is the convenience form that constructs and immediately loads the resource; do not call `Load()` again on its result.
- Prefer explicit construction followed by `Load()` when rollback can fail: the convenience factory cannot return the resource after a thrown load. Adapters must not re-enter the same resource's lifecycle methods, and must not report failure after changing registration state.
- Callback payload shape still belongs to the selected native runtime. Wrap raw payloads with `Command` before reading command fields.
- Registration, cleanup, and callback dispatch are synchronous. Client and say runtimes observe direct callback decisions, not eventual Promise results; the server runtime ignores callback results entirely.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.

## Related files

- [`commands-manager.md`](commands-manager.md) documents ownership of multiple registration resources.
- [`commands-server.md`](commands-server.md) and [`commands-client.md`](commands-client.md) document public command runtimes.
- [`packages/sourcejs/commands/command.js`](../../packages/sourcejs/commands/command.js) implements normalization, rollback, and lifecycle state.
- [`packages/sourcejs/internal/commands.js`](../../packages/sourcejs/internal/commands.js) selects the native runtime by command kind.
- [`tools/smoke_commands_auth_player.js`](../../tools/smoke_commands_auth_player.js) exercises base-manager registration and unload behavior.
- [`tools/smoke_command_registration_rollback.js`](../../tools/smoke_command_registration_rollback.js) checks registration failures, rollback failures, and retry cleanup.
