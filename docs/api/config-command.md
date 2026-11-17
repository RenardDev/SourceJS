# `require("config/command")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CommandConfigEntry`](#commandconfigentry)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/config/command.js`](../../packages/sourcejs/config/command.js). It resolves and validates one non-empty command name without whitespace, normalizes description lines, and stores the supplied argument array by reference. Arguments are quoted when the argument line is requested, not normalized or copied at construction. Rendering prefers an argument line from the supplied previous-arguments map when that map contains the command name. Use it directly for standalone entry construction or through `ConfigManager.AddCommandConfigEntry(...)` when a manager owns the file lifecycle.

## Import

```js
const { CommandConfigEntry, CreateCommandConfigEntry } = require("config/command");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CommandConfigEntry`](#commandconfigentry-1) | Class | `new CommandConfigEntry(NameOrText, DescriptionOrLines = "", Options = {})` |
| [`CreateCommandConfigEntry`](#createcommandconfigentry) | Function | `CreateCommandConfigEntry(NameOrText, DescriptionOrLines = "", Options = {})` |

`NameOrText` accepts a string or an object whose `GetTranslation()` or `GetString()` returns a string. `DescriptionOrLines` accepts the same forms, an array of them, or `null`/`undefined` for no description. A non-array description is split into lines; array elements are retained as individual entries without splitting embedded newlines.

When both text methods exist, `GetTranslation()` takes precedence; a thrown error or non-string result is not retried through `GetString()`. An empty description string produces no description lines.

## `CommandConfigEntry`

`Options` must be a non-null, non-array object. Its `Arguments` property defaults to a new empty array when nullish and must otherwise be an array. Its `WriteEmpty` property defaults to `false` when nullish and must otherwise be a boolean. These project property names are part of the public configuration-entry contract.

Argument values are checked when `ArgumentLine` or rendering quotes them: strings, booleans, finite numbers, and nullish values are supported. Each serialization reads the current length and each own slot once; arrays must be dense. Custom `map`, iterators, or array species cannot bypass quoting. The array remains live between calls. Raw `bigint`, non-finite numbers, and objects are rejected rather than silently coerced. A matching previous-arguments entry bypasses the current argument array; its value must already be the serialized string to emit.

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the command name written to the config file. |
| `Description` | Writable property containing comment lines rendered above the command. |
| `Arguments` | Writable property holding the supplied argument array by reference; used when the previous-arguments map lacks this command name. |
| `WriteEmpty` | Writable property controlling whether a command without arguments is rendered. |
| [`Key`](#commandconfigentrykey) | Read-only command name used by `ConfigManager`. |
| [`ArgumentLine`](#commandconfigentryargumentline) | Read-only string containing the serialized command arguments. |
| [`RenderConfigEntry`](#commandconfigentryrenderconfigentry) | `RenderConfigEntry(ConfigurationManager, mapPreviousArguments = new Map())`; returns an array of rendered lines. An existing map entry, including an empty string, overrides the current arguments. |

## Examples

### `CommandConfigEntry`

```js
const { CommandConfigEntry } = require("config/command");

const g_NetworkConfigurationEntry = new CommandConfigEntry("exec", "Load network settings before the map starts.", { Arguments: ["sourcejs/network.cfg"] });
console.log(`${g_NetworkConfigurationEntry.Key} ${g_NetworkConfigurationEntry.ArgumentLine}`);
```

### `CommandConfigEntry.Arguments`, `Description`, `Name`, and `WriteEmpty`

```js
const { CommandConfigEntry } = require("config/command");

const g_HeartbeatCommandEntry = new CommandConfigEntry("sourcejs_heartbeat", "Emit a heartbeat without command arguments.", { Arguments: [], WriteEmpty: true });
console.log(JSON.stringify({ Arguments: g_HeartbeatCommandEntry.Arguments, Description: g_HeartbeatCommandEntry.Description, Name: g_HeartbeatCommandEntry.Name, WriteEmpty: g_HeartbeatCommandEntry.WriteEmpty }));

console.log(g_HeartbeatCommandEntry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n"));
```

### `CreateCommandConfigEntry`

```js
const { CreateCommandConfigEntry } = require("config/command");

const g_EnableLoggingCommandEntry = CreateCommandConfigEntry("log", "Enable the engine server log.", { Arguments: ["on"] });
const g_vecConfigurationLines = g_EnableLoggingCommandEntry.RenderConfigEntry({ CommentPrefix: "//" });
console.log(g_vecConfigurationLines.join("\n"));
```

### `CommandConfigEntry.ArgumentLine`

```js
const { CommandConfigEntry } = require("config/command");

const g_RotationConfigurationEntry = new CommandConfigEntry("exec", "Load the map rotation.", { Arguments: ["sourcejs/rotation.cfg"] });
console.log(g_RotationConfigurationEntry.ArgumentLine);
// "sourcejs/rotation.cfg"
```

### `CommandConfigEntry.Key`

```js
const { CommandConfigEntry } = require("config/command");

const g_RotationConfigurationEntry = new CommandConfigEntry("exec", "Load the map rotation.");
console.log(g_RotationConfigurationEntry.Key);
// exec
```

### `CommandConfigEntry.RenderConfigEntry`

```js
const { CommandConfigEntry } = require("config/command");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs/server_startup");
const g_RotationConfigurationEntry = new CommandConfigEntry("exec", "Load the map rotation.", { Arguments: ["sourcejs/rotation.cfg"] });
const g_mapPreviousArguments = new Map([["exec", "\"sourcejs/custom_rotation.cfg\""]]);
const g_vecConfigurationLines = g_RotationConfigurationEntry.RenderConfigEntry(g_ConfigurationManager, g_mapPreviousArguments);
console.log(g_vecConfigurationLines.join("\n"));
```

## Safe use

Command names must be non-empty and contain no whitespace. Prefer constructor options or `ConfigManager.AddCommandConfigEntry(...)` over mutating the entry's properties after construction. When calling `RenderConfigEntry(...)` directly, provide a manager-like object with a string `CommentPrefix` and store already-serialized argument lines in `mapPreviousArguments`.

The render manager must be a non-null, non-array object; it has no legacy prefixed-field fallback. Public entry fields are live PascalCase properties. Changing the retained `Arguments` array affects later serialization, while `Description` and translated names were resolved at construction. Rendering returns a fresh line array, not the entry's backing storage. An empty argument line omits the command unless `WriteEmpty` is true; description lines can still be returned.

Use trusted command names, descriptions, arguments, and preserved lines. Rendering is not command sanitization: argument quoting escapes backslashes and double quotes but does not reject newlines; preserved argument lines are inserted verbatim. Rendering returns text and does not itself execute the command.

## Related files

- [`config.md`](config.md) documents the combined public module and manager workflow.
- [`packages/sourcejs/config/command.js`](../../packages/sourcejs/config/command.js) implements this API.
- [`packages/sourcejs/config/manager.js`](../../packages/sourcejs/config/manager.js) owns ordered entries, rendering, file I/O, and execution.
