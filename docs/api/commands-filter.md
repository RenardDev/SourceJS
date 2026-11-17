# `require("commands/filter")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CommandFilterRegistration`](#commandfilterregistration)
- [Examples](#examples)
- [Safe use and common mistakes](#safe-use-and-common-mistakes)
- [Related files](#related-files)

This page is maintained by hand. Filter examples adapt a native command module to the two-method filter-registration contract and retain the registration resource for deterministic cleanup.

`CommandFilterRegistration` is a JavaScript helper, not a native module. It expects an adapter with `RegisterFilter(Callback)` and `UnregisterFilter(Callback)` methods. Native client and say command modules use command-kind-specific names, so do not pass the object returned by `GetCommandModuleRuntime()` directly.

## Location and purpose

The implementation lives in [`packages/sourcejs/commands/filter.js`](../../packages/sourcejs/commands/filter.js). It wraps one filter callback and one filter-registration adapter in an explicitly loaded resource. Use it when filter registration must be owned, inspected, and deterministically released; direct public runtime functions remain simpler for isolated registrations.

## Import

```js
const { CommandFilterRegistration, RegisterCommandFilter } = require("commands/filter");

console.log(CommandFilterRegistration, RegisterCommandFilter);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CommandFilterRegistration`](#commandfilterregistration-1) | Class | `new CommandFilterRegistration(NativeCommandRuntime, CommandFilterCallback)` |
| [`RegisterCommandFilter`](#registercommandfilter) | Function | `RegisterCommandFilter(NativeCommandRuntime, CommandFilterCallback)` |

## `CommandFilterRegistration`

| Member | Signature or access |
| --- | --- |
| `Loaded` | Writable current registration state. |
| `Callback` | Writable registered filter callback. |
| [`Load`](#commandfilterregistrationload) | `Load()` |
| `Runtime` | Writable supplied filter-registration adapter. |
| [`Unload`](#commandfilterregistrationunload) | `Unload()` |

`Load()` throws when already loaded or when `RegisterFilter` returns a falsy result; on success it marks the resource loaded and returns the same instance. `Unload()` returns `false` when already unloaded, throws when `UnregisterFilter` returns a falsy result, and otherwise clears the loaded state and returns `true`. Adapter exceptions propagate; failed calls do not update the loaded state or roll back adapter side effects. Do not mutate `Runtime`, `Callback`, or `Loaded` while registered: cleanup uses their current values, not a snapshot of the original registration.

## Examples

### `CommandFilterRegistration`

```js
const { BLOCK, CONTINUE, Command } = require("commands");
const { CommandFilterRegistration } = require("commands/filter");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");
const g_ClientCommandFilterRuntime = Object.freeze({ RegisterFilter: g_ClientCommandModule.RegisterClientCommandFilter, UnregisterFilter: g_ClientCommandModule.UnregisterClientCommandFilter });

function PreventSuicide(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);

	return (ClientCommand.Name === "kill") ? BLOCK : CONTINUE;
}

function UnloadPlugin() {
	if (!g_SuicideFilter.Unload()) {
		throw new Error("Suicide command filter is not loaded.");
	}
}

const g_SuicideFilter = new CommandFilterRegistration(g_ClientCommandFilterRuntime, PreventSuicide).Load();

exports.Unload = UnloadPlugin;
```

### `CommandFilterRegistration.Callback`, `Loaded`, and `Runtime`

```js
const { CONTINUE } = require("commands");
const { CommandFilterRegistration } = require("commands/filter");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");
const g_ClientCommandFilterRuntime = Object.freeze({ RegisterFilter: g_ClientCommandModule.RegisterClientCommandFilter, UnregisterFilter: g_ClientCommandModule.UnregisterClientCommandFilter });

function AuditClientCommand() {
	return CONTINUE;
}

function UnloadPlugin() {
	if (!g_ClientAuditFilter.Unload()) {
		throw new Error("Client audit filter is not loaded.");
	}
}

const g_ClientAuditFilter = new CommandFilterRegistration(g_ClientCommandFilterRuntime, AuditClientCommand).Load();
const g_FilterState = { CallbackName: g_ClientAuditFilter.Callback.name, Loaded: g_ClientAuditFilter.Loaded, UsesClientRuntime: g_ClientAuditFilter.Runtime === g_ClientCommandFilterRuntime };
console.log(JSON.stringify(g_FilterState));

exports.Unload = UnloadPlugin;
```

### `RegisterCommandFilter`

```js
const { Command, CONTINUE } = require("commands");
const { RegisterCommandFilter } = require("commands/filter");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");
const g_ClientCommandFilterRuntime = Object.freeze({ RegisterFilter: g_ClientCommandModule.RegisterClientCommandFilter, UnregisterFilter: g_ClientCommandModule.UnregisterClientCommandFilter });

function LogClientCommand(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	console.log(`Client ${ClientCommand.Index}: ${ClientCommand.Name}`);

	return CONTINUE;
}

function UnloadPlugin() {
	if (!g_LoggingFilter.Unload()) {
		throw new Error("Client command logging filter is not loaded.");
	}
}

const g_LoggingFilter = RegisterCommandFilter(g_ClientCommandFilterRuntime, LogClientCommand);

exports.Unload = UnloadPlugin;
```

### `CommandFilterRegistration.Load`

```js
const { BLOCK, CONTINUE, Command } = require("commands");
const { CommandFilterRegistration } = require("commands/filter");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_SayCommandModule = GetCommandModuleRuntime("say");
const g_SayCommandFilterRuntime = Object.freeze({ RegisterFilter: g_SayCommandModule.RegisterSayCommandFilter, UnregisterFilter: g_SayCommandModule.UnregisterSayCommandFilter });

function BlockEmptyChat(CommandPayload) {
	const SayCommand = new Command(CommandPayload);

	return (SayCommand.Message.trim().length === 0) ? BLOCK : CONTINUE;
}

function UnloadPlugin() {
	if (!g_ChatFilter.Unload()) {
		throw new Error("Empty-chat filter is not loaded.");
	}
}

const g_ChatFilter = new CommandFilterRegistration(g_SayCommandFilterRuntime, BlockEmptyChat);
g_ChatFilter.Load();

exports.Unload = UnloadPlugin;
```

### `CommandFilterRegistration.Unload`

```js
const { CONTINUE, Command } = require("commands");
const { CommandFilterRegistration } = require("commands/filter");
const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandModule = GetCommandModuleRuntime("client");
const g_ClientCommandFilterRuntime = Object.freeze({ RegisterFilter: g_ClientCommandModule.RegisterClientCommandFilter, UnregisterFilter: g_ClientCommandModule.UnregisterClientCommandFilter });

function AuditClientCommands(CommandPayload) {
	const ClientCommand = new Command(CommandPayload);
	console.log(`Client command: ${ClientCommand.Name}`);

	return CONTINUE;
}

function UnloadPlugin() {
	if (!g_AuditFilter.Unload()) {
		throw new Error("Client audit filter is not loaded.");
	}
}

const g_AuditFilter = new CommandFilterRegistration(g_ClientCommandFilterRuntime, AuditClientCommands).Load();

exports.Unload = UnloadPlugin;
```

## Safe use and common mistakes

- Adapt the selected native module to `RegisterFilter` and `UnregisterFilter`: client modules expose `RegisterClientCommandFilter`/`UnregisterClientCommandFilter`, while say modules expose `RegisterSayCommandFilter`/`UnregisterSayCommandFilter`. The server command module has no filter registration pair.
- Call `Load()` only while unloaded. It throws if the resource is already loaded or if native filter registration fails. After a successful `Unload()`, the same resource can be loaded again.
- Retain the resource and call `Unload()` during plugin cleanup. A falsy unregistration result or an adapter exception throws and leaves `Loaded` true. Before retrying, account for any adapter side effects; the wrapper does not undo them.
- `RegisterCommandFilter(...)` constructs and immediately loads the resource; do not call `Load()` again on its result.
- The public `Runtime`, `Callback`, and `Loaded` properties are writable. Do not mutate them while loaded, because unload must use the same runtime/callback pair that performed registration.
- Native filters receive raw payloads. Construct `Command` before reading fields, return `CONTINUE` for observation, and reserve `BLOCK` for commands that must stop.
- Return the filter decision synchronously. Native dispatch does not await a returned Promise; an `async` filter cannot block a command through its eventual result.
- The examples use `exports.Unload` because the current plugin runtime invokes that exact cleanup export.
- Avoid logging raw command text or arguments, which may contain credentials. Log the command name and other non-sensitive fields instead.

## Related files

- [`commands.md`](commands.md) documents `Command` and command return values.
- [`commands-command.md`](commands-command.md) documents the analogous named-command registration resource.
- [`commands-client.md`](commands-client.md) and [`commands-say.md`](commands-say.md) document direct public filter functions.
- [`packages/sourcejs/commands/filter.js`](../../packages/sourcejs/commands/filter.js) implements filter lifecycle and public properties.
- [`packages/sourcejs/internal/commands.js`](../../packages/sourcejs/internal/commands.js) returns native command modules by command kind.
