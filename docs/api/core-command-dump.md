# `require("core/command/dump")`

> This page is maintained by hand. Examples use dump names backed by real `core/dumps` functions.

Requiring this module registers one `sjs dump <strName> [strFileName]` command for each supported dump name on `CORE_COMMAND`.
Supported names are `ClassInfo`, `ConVars`, `DataMaps`, `Entities`, `ServerClasses`, `StringTables`, and `WeaponScripts`.

## Location and purpose

The implementation lives in [`packages/sourcejs/core/command/dump.js`](../../packages/sourcejs/core/command/dump.js). It maps stable
command names to the corresponding `core/dumps` functions, logs the written path, and exposes the same dispatch through the
shared core command tree. Use it when diagnostics need one of the supported runtime snapshots without selecting a dump function
manually.

## Import

```js
const { RunDump } = require("core/command/dump");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`MODULE_NAME`](#module_name) | Constant | JavaScript module name, `"core/command/dump"`. |
| [`RunDump`](#rundump) | Function | `RunDump(strName, strFileName = strName)` |

## Examples

### `RunDump`

Dump names are case-sensitive and map to handlers as follows:

| Dump name | `core/dumps` handler |
| --- | --- |
| `ClassInfo` | `DumpClassInfo` |
| `ConVars` | `DumpConVars` |
| `DataMaps` | `DumpDataMaps` |
| `Entities` | `DumpEntities` |
| `ServerClasses` | `DumpServerClasses` |
| `StringTables` | `DumpStringTables` |
| `WeaponScripts` | `DumpWeaponScripts` |

`RunDump()` calls the selected handler, logs the returned path through `CORE_COMMAND`, and returns that path.

```js
const { RunDump } = require("core/command/dump");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = RunDump("ConVars", "diagnostics/convars");
const g_strConVarDumpText = ReadTextFile(g_strOutputPath);
if ((typeof g_strConVarDumpText !== "string") || !g_strConVarDumpText.includes("Variables:")) {
	throw new Error(`Unexpected ConVar dump in ${g_strOutputPath}.`);
}

console.log(`ConVar dump written to ${g_strOutputPath}.`);
```

Use the registered command tree when the dump is requested by an `sjs` console command:

```js
const { CORE_COMMAND } = require("core/command");
const { MODULE_NAME } = require("core/command/dump");

const g_bCommandHandled = CORE_COMMAND.RunCommand("sjs dump ServerClasses diagnostics/server-classes");
if (!g_bCommandHandled) {
	throw new Error(`Unable to run the server-class dump command registered by ${MODULE_NAME}.`);
}

console.log(`Server-class dump command handled: ${g_bCommandHandled}`);
```

### `MODULE_NAME`

```js
const { MODULE_NAME } = require("core/command/dump");

console.log(`Dump command module: ${MODULE_NAME}`);
```

## Safe use

- Pass one of the documented dump names. `RunDump()` throws for an unknown name instead of selecting a fallback handler.
- Treat `strFileName` as a trusted output path. The underlying `core/dumps` helper resolves relative names under the dump root,
  appends `.txt` when absent, and accepts absolute paths.
- Resolving an output name does not prove containment within the dump root. Reject embedded NUL in names before calling;
  native file helpers reject embedded NUL with `TypeError` instead of targeting a shortened prefix.
- Dumps can contain sensitive ConVar values or runtime records. Keep output access restricted and do not publish their contents
  without checking what they disclose; the examples print only the output path or command status.
- Use the path returned by direct `RunDump()` calls as the authoritative output location, and handle exceptions from dump
  collection, path validation, directory creation, or file writing.
- `CORE_COMMAND.RunCommand()` returns `true` after a successful invocation and `false` when no command matches; it does not
  return the dump path. The selected handler logs its output path, and handler exceptions propagate.
- Each registered command uses only its first command argument as the optional file name. Additional arguments are ignored.
- The command substitutes the dump name for an absent or empty filename; direct `RunDump()` calls default only for an omitted
  or `undefined` filename. A logging exception can occur after a dump has already been written; inspect the output before retrying.
- Requiring this module registers seven commands on the shared core command tree. Account for that side effect when loading
  command modules.

## Related files

- [`packages/sourcejs/core/command/dump.js`](../../packages/sourcejs/core/command/dump.js) — handler map and command registration.
- [`core-command.md`](core-command.md) — shared command manager used for registration and status output.
- [`core-dumps.md`](core-dumps.md) — supported dump functions and output-path behavior.
