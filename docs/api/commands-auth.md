# `require("commands/auth")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Authorized Callback](#authorized-callback)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. The example registers and cleans up the exact authorization wrapper returned by `CreateAuthorizedCommandCallback()`.

`commands/auth` is implemented in JavaScript; its authorization check delegates to the canonical `auth.HasPlayerPermission` operation.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/auth.js`](../../packages/sourcejs/commands/auth.js). It decorates a command callback with a player-permission check while preserving one stable wrapper function for registration metadata and unload cleanup. When command dispatch invokes the wrapper, the allowed callback and optional failure callback receive the same `Command` instance.

## Import

```js
const { CreateAuthorizedCommandCallback } = require("commands/auth");

console.log(CreateAuthorizedCommandCallback);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CreateAuthorizedCommandCallback`](#createauthorizedcommandcallback) | Function | `CreateAuthorizedCommandCallback(Callback, strPermission = null, FailCallback = null)` |

## Authorized Callback

| Member | Access |
| --- | --- |
| `Callback` | Metadata property containing the allowed callback. |
| `FailCallback` | Metadata property containing the authorization-failure callback or `null`. |
| `Permission` | Metadata property containing the required permission string or `null`. |

These properties are writable metadata snapshots. Changing them does not change dispatch behavior: the wrapper closes over the original arguments. The factory validates the callbacks immediately; permission checks happen synchronously when the wrapper is invoked. With a `null` permission it calls the allowed callback directly; a denied permission calls the failure callback when present, otherwise returns `CommandReturn.Continue`. Callback results, permission-check failures, and thrown errors propagate unchanged.

## Examples

### `CreateAuthorizedCommandCallback`

```js
const { BLOCK, HANDLED, ExecuteCommand } = require("commands");
const { CreateAuthorizedCommandCallback } = require("commands/auth");
const { RegisterCommand, UnregisterCommand } = require("commands/client");

function ReloadAllPlugins(Command) {
	if (!ExecuteCommand("sjs plugins reload_all")) {
		console.error(`Unable to request SourceJS plugin reload for player ${Command.Index}.`);
		return HANDLED;
	}

	console.log(`SourceJS plugin reload requested by player ${Command.Index}.`);

	return HANDLED;
}

function RejectUnauthorizedPlayer(Command) {
	console.log(`Player ${Command.Index} does not have sourcejs.admin.`);

	return BLOCK;
}

const g_AuthorizedReloadCommand = CreateAuthorizedCommandCallback(ReloadAllPlugins, "sourcejs.admin", RejectUnauthorizedPlayer);

function UnloadPlugin() {
	if (!UnregisterCommand("sjs_admin_reload", g_AuthorizedReloadCommand)) {
		throw new Error("Unable to unregister sjs_admin_reload.");
	}
}

if (!RegisterCommand("sjs_admin_reload", g_AuthorizedReloadCommand)) {
	throw new Error("Unable to register sjs_admin_reload.");
}

exports.Unload = UnloadPlugin;
```

### Authorized callback metadata

```js
const { BLOCK, HANDLED } = require("commands");
const { CreateAuthorizedCommandCallback } = require("commands/auth");

function HandleNavigationRebuild() {
	return HANDLED;
}

function RejectNavigationRebuild() {
	return BLOCK;
}

const g_AuthorizedNavigationRebuild = CreateAuthorizedCommandCallback(HandleNavigationRebuild, "sourcejs.navigation.rebuild", RejectNavigationRebuild);
const g_CommandPolicy = { CallbackName: g_AuthorizedNavigationRebuild.Callback.name, FailureHandlerName: g_AuthorizedNavigationRebuild.FailCallback.name, Permission: g_AuthorizedNavigationRebuild.Permission };
console.log(JSON.stringify(g_CommandPolicy));
```

## Safe use and common mistakes

- Register and unregister the returned wrapper function, not the original callback, and check both boolean results. The wrapper carries the permission check and the public `Callback`, `Permission`, and `FailCallback` metadata.
- Export cleanup through the SourceJS-owned, case-sensitive `exports.Unload` key; do not add lowercase lifecycle aliases.
- Pass a non-empty permission string or `null`. A `null` permission deliberately bypasses authorization and calls the allowed callback.
- Return an explicit command result from both callbacks. When permission is denied and no failure callback exists, the wrapper returns `CommandReturn.Continue`; provide a failure callback that returns `BLOCK` when denial must stop further dispatch.
- Do not perform privileged work in the failure callback; it runs only for a denied player and receives the same `Command` instance.
- Keep permission names stable and coordinate them with the active auth backend. Renaming a permission silently changes who is authorized.

## Related files

- [`commands.md`](commands.md) documents `Command`, registration, and command return values.
- [`commands-client.md`](commands-client.md) documents the client-command registry used by the direct example.
- [`commands-player.md`](commands-player.md) documents the registration manager that applies this wrapper automatically.
- [`auth.md`](auth.md) documents player-permission checks and identity rules.
- [`packages/sourcejs/commands/auth.js`](../../packages/sourcejs/commands/auth.js) implements the wrapper.
- [`tools/smoke_commands_auth_player.js`](../../tools/smoke_commands_auth_player.js) verifies allowed, denied, and permission-free callback behavior.
