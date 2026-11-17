# `require("commands/player")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`PlayerCommandRegistrationManager`](#playercommandregistrationmanager)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Examples adapt the native client-command module so authorization checks receive a real player index and the inherited manager receives its required generic registration methods.

`PlayerCommandRegistrationManager` is a JavaScript helper, not a native module. It inherits the `Register`/`Unregister` adapter contract from `CommandRegistrationManager`; do not pass the object returned by `GetCommandModuleRuntime("client")` directly.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/player.js`](../../packages/sourcejs/commands/player.js). It extends `CommandRegistrationManager` by wrapping every registered callback with `CreateAuthorizedCommandCallback`, adding an optional permission requirement and denial callback to manager-owned cleanup. The default `strRequiredPermission = null` bypasses permission checks; supply a permission explicitly for restricted commands. Cleanup failures retain pending registrations for retry through the inherited manager lifecycle.

## Import

```js
const { PlayerCommandRegistrationManager } = require("commands/player");

console.log(PlayerCommandRegistrationManager);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`PlayerCommandRegistrationManager`](#playercommandregistrationmanager-1) | Class | `new PlayerCommandRegistrationManager(NativeCommandRuntime)` |

## `PlayerCommandRegistrationManager`

| Member | Signature or access |
| --- | --- |
| [`Register`](#playercommandregistrationmanagerregister) | `Register(CommandNameOrNames, CommandCallback, strRequiredPermission = null, AuthorizationFailureCallback = null)` |
| [`Unregister`](#playercommandregistrationmanagerunregister) | Inherited `Unregister(Registration)` |
| [`UnloadAll`](#playercommandregistrationmanagerunloadall) | Inherited `UnloadAll()` |
| `Runtime` | Inherited read/write property containing the supplied command registration adapter. |
| `Registrations` | Inherited read/write property containing the live owned-registration `Set`. |

`Register()` wraps the supplied callback with `CreateAuthorizedCommandCallback` before delegating to the base manager. A null permission allows the callback, a granted permission calls the supplied callback, and denial calls the optional failure callback or returns `CONTINUE` when no failure callback was supplied.

## Examples

### `PlayerCommandRegistrationManager`

```js
const { Command } = require("commands");
const { PlayerCommandRegistrationManager } = require("commands/player");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");

const g_mapCommandCallbacks = new WeakMap();

const g_ClientCommandRegistrationRuntime = Object.freeze({
	Register(strCommandName, Callback) {
		let NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			const NativeCommandCallback = (CommandPayload) => Callback(new Command(CommandPayload));
			g_mapCommandCallbacks.set(Callback, NativeCommandCallback);
			NativeCallback = NativeCommandCallback;
		}

		return g_ClientCommandModule.RegisterClientCommand(strCommandName, NativeCallback);
	},
	Unregister(strCommandName, Callback) {
		const NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			return false;
		}

		return g_ClientCommandModule.UnregisterClientCommand(strCommandName, NativeCallback);
	},
});

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all player command registrations.");
	}
}

const g_RegistrationManager = new PlayerCommandRegistrationManager(g_ClientCommandRegistrationRuntime);

exports.Unload = UnloadPlugin;
```

### `PlayerCommandRegistrationManager.Registrations` and `Runtime`

```js
const { HANDLED, Command } = require("commands");
const { PlayerCommandRegistrationManager } = require("commands/player");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");

const g_mapCommandCallbacks = new WeakMap();

const g_ClientCommandRegistrationRuntime = Object.freeze({
	Register(strCommandName, Callback) {
		let NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			const NativeCommandCallback = (CommandPayload) => Callback(new Command(CommandPayload));
			g_mapCommandCallbacks.set(Callback, NativeCommandCallback);
			NativeCallback = NativeCommandCallback;
		}

		return g_ClientCommandModule.RegisterClientCommand(strCommandName, NativeCallback);
	},
	Unregister(strCommandName, Callback) {
		const NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			return false;
		}

		return g_ClientCommandModule.UnregisterClientCommand(strCommandName, NativeCallback);
	},
});

function HandleModeratorStatusCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all player command registrations.");
	}
}

const g_RegistrationManager = new PlayerCommandRegistrationManager(g_ClientCommandRegistrationRuntime);
g_RegistrationManager.Register(["sjs_moderator_status"], HandleModeratorStatusCommand, "sourcejs.moderator");

const g_ManagerState = { RegistrationCount: g_RegistrationManager.Registrations.size, UsesClientRuntime: g_RegistrationManager.Runtime === g_ClientCommandRegistrationRuntime };
console.log(JSON.stringify(g_ManagerState));

exports.Unload = UnloadPlugin;
```

### `PlayerCommandRegistrationManager.Register`

```js
const { BLOCK, HANDLED, Command } = require("commands");
const { PlayerCommandRegistrationManager } = require("commands/player");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");

const g_mapCommandCallbacks = new WeakMap();

const g_ClientCommandRegistrationRuntime = Object.freeze({
	Register(strCommandName, Callback) {
		let NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			const NativeCommandCallback = (CommandPayload) => Callback(new Command(CommandPayload));
			g_mapCommandCallbacks.set(Callback, NativeCommandCallback);
			NativeCallback = NativeCommandCallback;
		}

		return g_ClientCommandModule.RegisterClientCommand(strCommandName, NativeCallback);
	},
	Unregister(strCommandName, Callback) {
		const NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			return false;
		}

		return g_ClientCommandModule.UnregisterClientCommand(strCommandName, NativeCallback);
	},
});

function ShowAdministratorStatus(ClientCommand) {
	console.log(`Player ${ClientCommand.Index}: Administrator access confirmed.`);

	return HANDLED;
}

function RejectAdministratorStatus(ClientCommand) {
	console.log(`Player ${ClientCommand.Index}: Missing permission sourcejs.admin.`);

	return BLOCK;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all player command registrations.");
	}
}

const g_RegistrationManager = new PlayerCommandRegistrationManager(g_ClientCommandRegistrationRuntime);
g_RegistrationManager.Register(["sjs_admin_status"], ShowAdministratorStatus, "sourcejs.admin", RejectAdministratorStatus);

exports.Unload = UnloadPlugin;
```

### `PlayerCommandRegistrationManager.UnloadAll`

```js
const { HANDLED, Command } = require("commands");
const { PlayerCommandRegistrationManager } = require("commands/player");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");

const g_mapCommandCallbacks = new WeakMap();

const g_ClientCommandRegistrationRuntime = Object.freeze({
	Register(strCommandName, Callback) {
		let NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			const NativeCommandCallback = (CommandPayload) => Callback(new Command(CommandPayload));
			g_mapCommandCallbacks.set(Callback, NativeCommandCallback);
			NativeCallback = NativeCommandCallback;
		}

		return g_ClientCommandModule.RegisterClientCommand(strCommandName, NativeCallback);
	},
	Unregister(strCommandName, Callback) {
		const NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			return false;
		}

		return g_ClientCommandModule.UnregisterClientCommand(strCommandName, NativeCallback);
	},
});

function HandleModeratorReloadCommand() {
	return HANDLED;
}

function HandleModeratorMapCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.UnloadAll()) {
		throw new Error("Unable to unload all player command registrations.");
	}
}

const g_RegistrationManager = new PlayerCommandRegistrationManager(g_ClientCommandRegistrationRuntime);
g_RegistrationManager.Register(["sjs_moderator_reload"], HandleModeratorReloadCommand, "sourcejs.moderator.reload");
g_RegistrationManager.Register(["sjs_moderator_map"], HandleModeratorMapCommand, "sourcejs.moderator.map");

exports.Unload = UnloadPlugin;
```

### `PlayerCommandRegistrationManager.Unregister`

```js
const { HANDLED, Command } = require("commands");
const { PlayerCommandRegistrationManager } = require("commands/player");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");

const g_mapCommandCallbacks = new WeakMap();

const g_ClientCommandRegistrationRuntime = Object.freeze({
	Register(strCommandName, Callback) {
		let NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			const NativeCommandCallback = (CommandPayload) => Callback(new Command(CommandPayload));
			g_mapCommandCallbacks.set(Callback, NativeCommandCallback);
			NativeCallback = NativeCommandCallback;
		}

		return g_ClientCommandModule.RegisterClientCommand(strCommandName, NativeCallback);
	},
	Unregister(strCommandName, Callback) {
		const NativeCallback = g_mapCommandCallbacks.get(Callback);
		if (NativeCallback === undefined) {
			return false;
		}

		return g_ClientCommandModule.UnregisterClientCommand(strCommandName, NativeCallback);
	},
});

function HandleAuditStatusCommand() {
	return HANDLED;
}

function UnloadPlugin() {
	if (!g_RegistrationManager.Unregister(g_AuditRegistration)) {
		throw new Error("Unable to unregister the audit-status command.");
	}
}

const g_RegistrationManager = new PlayerCommandRegistrationManager(g_ClientCommandRegistrationRuntime);
const g_AuditRegistration = g_RegistrationManager.Register(["sjs_audit_status"], HandleAuditStatusCommand, "sourcejs.audit");

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Adapt a native `client` or `say` module to generic `Register` and `Unregister` methods so every callback carries a real player index. Client modules expose `RegisterClientCommand`/`UnregisterClientCommand`; say modules expose `RegisterSayCommand`/`UnregisterSayCommand`. A server-command payload does not identify an authorizable player.
- The authorization wrapper reads `Index` and passes its input unchanged to the allowed or failure callback; it does not construct or validate `Command`. Current native payloads already expose `Index`. These examples construct `Command` in the adapter to validate the payload before either callback; this is optional validation, not an old-format conversion. Both callbacks then receive that `Command`. Preserve the validating callback's identity for unregistration, as the examples do with a `WeakMap`.
- A `null` permission bypasses authorization. Supply a stable non-empty permission string whenever the command performs privileged work.
- When authorization fails and no failure callback is supplied, the wrapper returns `CommandReturn.Continue`; provide a failure callback when denial must block or notify the player.
- Registrations returned by `Register(...)` are manager-owned. Release them through `Unregister(...)` or `UnloadAll()`, not by calling their `Unload()` method directly.
- Cleanup is delegated to owned `CommandRegistration` resources: falsy native unregistration results cause an error, and exceptions propagate. Failed and unprocessed removals remain owned for retry; successful removals are not repeated. The adapter must accurately report removal and must not change registration state before reporting failure.
- A thrown `Register(...)` can leave a partial resource owned by the manager if rollback fails. Retain the manager and retry `UnloadAll()`. Do not re-enter lifecycle methods from adapter calls.
- Keep inherited `Runtime` and `Registrations` unchanged; they are writable public properties whose contents maintain manager invariants, not supported mutation points.
- Registration, permission checks, and callback dispatch are synchronous. Return the command decision directly; native dispatch does not await a returned Promise.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.

## Related files

- [`commands-auth.md`](commands-auth.md) documents the authorization wrapper and callback metadata.
- [`commands-manager.md`](commands-manager.md) documents inherited ownership and cleanup behavior.
- [`commands-client.md`](commands-client.md) documents the client-command runtime.
- [`auth.md`](auth.md) documents permission lookup and player identity.
- [`packages/sourcejs/commands/player.js`](../../packages/sourcejs/commands/player.js) implements permission-aware registration.
- [`tools/smoke_commands_auth_player.js`](../../tools/smoke_commands_auth_player.js) verifies allowed, denied, permission-free, ownership, and unload paths.
