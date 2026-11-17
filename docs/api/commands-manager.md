# `require("commands/manager")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CommandRegistrationManager`](#commandregistrationmanager)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Manager examples use owned `CommandRegistration` objects and an adapter over a native command module.

`CommandRegistrationManager` is a JavaScript helper, not a native module. It expects an adapter with `Register(strName, Callback)` and `Unregister(strName, Callback)` methods. Native command modules use command-kind-specific names, so do not pass the object returned by `GetCommandModuleRuntime()` directly.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/manager.js`](../../packages/sourcejs/commands/manager.js). It creates loaded `CommandRegistration` resources from one registration adapter, tracks ownership in one set, and releases individual or all owned registrations. Use it when a plugin owns several command names and needs one deterministic cleanup boundary.

If registration fails and rollback is incomplete, the manager retains the partial resource even though `Register()` throws. Keep the manager and call `UnloadAll()` to retry cleanup; do not assume a thrown registration left no commands installed.

## Import

```js
const { CommandRegistrationManager } = require("commands/manager");

console.log(CommandRegistrationManager);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CommandRegistrationManager`](#commandregistrationmanager-1) | Class | `new CommandRegistrationManager(NativeCommandRuntime)` |

## `CommandRegistrationManager`

| Member | Signature or access |
| --- | --- |
| [`Register`](#commandregistrationmanagerregister) | `Register(CommandNameOrNames, CommandCallback)` |
| [`Unregister`](#commandregistrationmanagerunregister) | `Unregister(Registration)` |
| [`UnloadAll`](#commandregistrationmanagerunloadall) | `UnloadAll()` |
| `Runtime` | Read/write property containing the supplied command registration adapter. |
| `Registrations` | Read/write property containing the live owned-registration `Set`. |

`Register()` adds a new registration to the owned set before loading it and returns it on success. If loading fails, it removes a fully rolled-back resource but retains one needing cleanup, then propagates the error. `Unregister()` rejects resources not owned by this manager, unloads and removes the resource, then returns `true`.

`UnloadAll()` unloads and removes every currently owned resource and returns `true`; a false unload result or exception stops the pass and leaves the failing and unprocessed resources owned. Previously removed resources stay removed; a retry is not a rollback. An already manually unloaded resource causes an error rather than being removed. Native falsy unregistration results cause `CommandRegistration.Unload()` to throw; successful cleanup depends on the adapter accurately reporting removal. Do not mutate `Runtime` or `Registrations`, or re-enter lifecycle methods from the adapter.

## Examples

### `CommandRegistrationManager`

```js
const { CommandRegistrationManager } = require("commands/manager");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all command registrations.");
	}
}

const g_RegistrationManager = new CommandRegistrationManager(g_ServerCommandRegistrationRuntime);

exports.Unload = UnloadPlugin;
```

### `CommandRegistrationManager.Registrations` and `Runtime`

```js
const { HANDLED } = require("commands");
const { CommandRegistrationManager } = require("commands/manager");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function HandleRuntimeStateCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all command registrations.");
	}
}

const g_RegistrationManager = new CommandRegistrationManager(g_ServerCommandRegistrationRuntime);
g_RegistrationManager.Register("sjs_runtime_state", HandleRuntimeStateCommand);

const g_ManagerState = { RegistrationCount: g_RegistrationManager.Registrations.size, UsesServerRuntime: g_RegistrationManager.Runtime === g_ServerCommandRegistrationRuntime };
console.log(JSON.stringify(g_ManagerState));

exports.Unload = UnloadPlugin;
```

### `CommandRegistrationManager.Register`

```js
const { HANDLED } = require("commands");
const { CommandRegistrationManager } = require("commands/manager");
const { GetGlobalVariables } = require("globals");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function ShowMapInformation() {
	console.log(GetGlobalVariables().MapName);

	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all command registrations.");
	}
}

const g_RegistrationManager = new CommandRegistrationManager(g_ServerCommandRegistrationRuntime);
g_RegistrationManager.Register(["sjs_mapinfo"], ShowMapInformation);

exports.Unload = UnloadPlugin;
```

### `CommandRegistrationManager.UnloadAll`

```js
const { HANDLED } = require("commands");
const { CommandRegistrationManager } = require("commands/manager");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function HandleMapInformationCommand() {
	return HANDLED;
}

function HandlePlayerCountCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all command registrations.");
	}
}

const g_RegistrationManager = new CommandRegistrationManager(g_ServerCommandRegistrationRuntime);
g_RegistrationManager.Register(["sjs_mapinfo"], HandleMapInformationCommand);
g_RegistrationManager.Register(["sjs_player_count"], HandlePlayerCountCommand);

exports.Unload = UnloadPlugin;
```

### `CommandRegistrationManager.Unregister`

```js
const { HANDLED } = require("commands");
const { CommandRegistrationManager } = require("commands/manager");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandModule = GetCommandModuleRuntime("server");
const g_ServerCommandRegistrationRuntime = Object.freeze({ Register: g_ServerCommandModule.RegisterCommand, Unregister: g_ServerCommandModule.UnregisterCommand });

function HandleDiagnosticsCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.Unregister(g_DiagnosticsRegistration)) {
		throw new Error("Unable to unregister the diagnostics command.");
	}
}

const g_RegistrationManager = new CommandRegistrationManager(g_ServerCommandRegistrationRuntime);
const g_DiagnosticsRegistration = g_RegistrationManager.Register(["sjs_diagnostics"], HandleDiagnosticsCommand);

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Adapt the selected native module to `Register` and `Unregister`: server modules expose `RegisterCommand`/`UnregisterCommand`, client modules expose `RegisterClientCommand`/`UnregisterClientCommand`, and say modules expose `RegisterSayCommand`/`UnregisterSayCommand`. Do not pass the native module directly.
- Treat every object returned by `Register(...)` as manager-owned. Calling its `Unload()` directly leaves a stale entry in the manager and makes a later `Unregister(...)` or `UnloadAll()` fail.
- Pass the exact owned registration to `Unregister(...)`. The manager rejects resources created elsewhere or resources it no longer owns.
- Call `UnloadAll()` from plugin cleanup when registrations may vary at runtime. Successfully unloaded resources are removed from the owned set as cleanup proceeds.
- The manager delegates cleanup to its owned `CommandRegistration` resources: falsy native unregistration results cause an error, and adapter exceptions propagate. Failed and unprocessed removals remain available for retry; successful removals are not repeated. The adapter must accurately report success without unreported side effects on failure.
- A failed `Register(...)` can leave a partial registration owned by the manager when rollback fails. Retain the manager and retry `UnloadAll()`; an exception is not proof that no callbacks remain registered. Do not re-enter manager lifecycle methods from adapter calls.
- Do not mutate `Runtime` or `Registrations`. They remain visible manager properties, but manager invariants depend on their original contents.
- Command callbacks still receive the payload shape supplied by the selected native runtime; validate raw payloads with `Command` when fields are needed.
- Registration, cleanup, and callback dispatch are synchronous. Client and say runtimes observe direct callback decisions, not eventual Promise results; the server runtime ignores callback results entirely.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.

## Related files

- [`commands-command.md`](commands-command.md) documents the owned `CommandRegistration` resource.
- [`commands-player.md`](commands-player.md) documents the permission-aware manager subclass.
- [`packages/sourcejs/commands/manager.js`](../../packages/sourcejs/commands/manager.js) implements ownership and cleanup.
- [`packages/sourcejs/internal/commands.js`](../../packages/sourcejs/internal/commands.js) returns native command modules by command kind.
- [`tools/smoke_commands_auth_player.js`](../../tools/smoke_commands_auth_player.js) verifies manager ownership, unregister, and unload behavior.
- [`tools/smoke_command_manager_rollback.js`](../../tools/smoke_command_manager_rollback.js) checks ownership after failed rollback, cleanup retries, and subsequent registration.
