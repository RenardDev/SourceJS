# `require("core/dumps")`

> Warning: This API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the
> relevant section.

> This page is maintained by hand. Every dump example writes and inspects real diagnostic output; the path example validates
> resolution without creating a file.

Relative names are prefixed with the native SourceJS dump root; this is not a containment check, and `..` can escape that root.
Names receive a `.txt` suffix unless they already end in `.txt` case-insensitively. Absolute Windows
and POSIX path spellings are not rebased under the dump root; backslashes become forward slashes. Entity, datamap, server-class, string-table, and
weapon dumps reflect the current engine state and may contain no entries before a map is loaded, even when headings remain.
The native dump-root text is converted to UTF-8 before JavaScript string creation, independently of the Windows active code
page. `ResolveDumpPath()` normalizes separators in the supplied dump name, not in that native root.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core/dumps.js`](../../packages/sourcejs/core/dumps.js). It collects runtime state
from cvars, native modules, entities, datamaps, send properties, string tables, and weapons, renders diagnostic text, and writes
that text through the native `core/dumps` module. Use it for operator diagnostics and point-in-time runtime inventories, not as
a stable serialization format.

## Import

```js
const { DumpConVars, DumpEntities, WriteDump } = require("core/dumps");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`DumpClassInfo`](#dumpclassinfo) | Function | `DumpClassInfo(strDumpFileName = "classInfo")` |
| [`DumpConVars`](#dumpconvars) | Function | `DumpConVars(strDumpFileName = "convars")` |
| [`DumpDataMaps`](#dumpdatamaps) | Function | `DumpDataMaps(strDumpFileName = "datamaps")` |
| [`DumpEntities`](#dumpentities) | Function | `DumpEntities(strDumpFileName = "entities")` |
| [`DumpServerClasses`](#dumpserverclasses) | Function | `DumpServerClasses(strDumpFileName = "serverClasses")` |
| [`DumpStringTables`](#dumpstringtables) | Function | `DumpStringTables(strDumpFileName = "stringTables")` |
| [`DumpWeaponScripts`](#dumpweaponscripts) | Function | `DumpWeaponScripts(strDumpFileName = "weaponScripts")` |
| [`ResolveDumpPath`](#resolvedumppath) | Function | `ResolveDumpPath(strDumpFileName)` |
| [`WriteDump`](#writedump) | Function | `WriteDump(strDumpFileName, DumpText)` |

## Examples

### `DumpClassInfo`

Lists own enumerable string-keyed exports on each current runtime module object. JavaScript package augmentation can appear;
this is not a native-only snapshot, and export getters are not invoked just to list their names.

```js
const { DumpClassInfo } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpClassInfo("diagnostics/runtime-classes");
const g_strClassInformation = ReadTextFile(g_strOutputPath);
if (typeof g_strClassInformation !== "string") {
	throw new Error("Unable to read the runtime module surface dump.");
}

const g_vecClassInformationLines = g_strClassInformation.split("\n").slice(1).filter(Boolean);
console.log(`Recorded ${g_vecClassInformationLines.length} runtime module surfaces in ${g_strOutputPath}.`);
```

### `DumpConVars`

```js
const { DumpConVars } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpConVars("diagnostics/convars");
const g_strConVarDumpText = ReadTextFile(g_strOutputPath);
if ((typeof g_strConVarDumpText !== "string") || !g_strConVarDumpText.includes("\nCommands:")) {
	throw new Error(`Unexpected ConVar dump in ${g_strOutputPath}.`);
}

console.log(`ConVar dump written to ${g_strOutputPath}.`);
```

### `DumpDataMaps`

```js
const { DumpDataMaps } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpDataMaps("diagnostics/datamaps");
const g_strDataMapText = ReadTextFile(g_strOutputPath);
if (typeof g_strDataMapText !== "string") {
	throw new Error(`Unable to read the datamap dump in ${g_strOutputPath}.`);
}

const g_vecDataMapLines = g_strDataMapText.split("\n").slice(1).filter(Boolean);
console.log(`Recorded ${g_vecDataMapLines.length} datamap and field lines.`);
```

### `DumpEntities`

```js
const { DumpEntities } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpEntities("diagnostics/live-entities");
const g_strEntityDumpText = ReadTextFile(g_strOutputPath);
if (typeof g_strEntityDumpText !== "string") {
	throw new Error(`Unable to read the entity dump in ${g_strOutputPath}.`);
}

const g_vecEntityLines = g_strEntityDumpText.split("\n").filter(Boolean);
console.log(`Recorded ${g_vecEntityLines.length} non-empty entity dump lines.`);
```

### `DumpServerClasses`

```js
const { DumpServerClasses } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

function IsClassLink(strClassLine) {
	return strClassLine.includes(" -> ");
}

const g_strOutputPath = DumpServerClasses("diagnostics/server-classes");
const g_strServerClassDumpText = ReadTextFile(g_strOutputPath);
if (typeof g_strServerClassDumpText !== "string") {
	throw new Error(`Unable to read the server-class dump in ${g_strOutputPath}.`);
}

const g_unClassLinkLineCount = g_strServerClassDumpText.split("\n").filter(IsClassLink).length;
console.log(`Recorded ${g_unClassLinkLineCount} lines containing class links.`);
```

### `DumpStringTables`

```js
const { DumpStringTables } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpStringTables("diagnostics/string-tables");
const g_strStringTableDumpText = ReadTextFile(g_strOutputPath);
if (typeof g_strStringTableDumpText !== "string") {
	throw new Error(`Unable to read the string-table dump in ${g_strOutputPath}.`);
}

const g_vecStringTableLines = g_strStringTableDumpText.split("\n").filter(Boolean);
console.log(`Recorded ${g_vecStringTableLines.length} non-empty string-table dump lines.`);
```

### `DumpWeaponScripts`

```js
const { DumpWeaponScripts } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_strOutputPath = DumpWeaponScripts("diagnostics/weapons");
const g_strWeaponDumpText = ReadTextFile(g_strOutputPath);
if ((typeof g_strWeaponDumpText !== "string") || !g_strWeaponDumpText.includes("Weapon names:") || !g_strWeaponDumpText.includes("Weapon classes:") || !g_strWeaponDumpText.includes("Live weapons:")) {
	throw new Error(`Unexpected weapon dump in ${g_strOutputPath}.`);
}

console.log(`Weapon dump written to ${g_strOutputPath}.`);
```

### `ResolveDumpPath`

```js
const { ResolveDumpPath } = require("core/dumps");

const g_strOutputPath = ResolveDumpPath("diagnostics/plugin-health");
if (!g_strOutputPath.endsWith("/diagnostics/plugin-health.txt")) {
	throw new Error(`Unexpected dump path: ${g_strOutputPath}`);
}

console.log(`Resolved dump path: ${g_strOutputPath}`);
```

### `WriteDump`

```js
const { GetGlobalInfo } = require("core");
const { WriteDump } = require("core/dumps");
const { ReadTextFile } = require("filesystem");

const g_RuntimeInformation = GetGlobalInfo();
const g_strVersionReportLine = `Version=${g_RuntimeInformation.Version}`;
const g_strSDKBranchReportLine = `SDKBranch=${g_RuntimeInformation.SDKBranch}`;
const g_strArchitectureReportLine = `Architecture=${g_RuntimeInformation.Architecture}`;
const g_vecPluginHealthReportLines = [g_strVersionReportLine, g_strSDKBranchReportLine, g_strArchitectureReportLine];
const g_strPluginHealthReportText = g_vecPluginHealthReportLines.join("\n");
const g_strOutputPath = WriteDump("diagnostics/plugin-health", g_strPluginHealthReportText);
if (ReadTextFile(g_strOutputPath) !== g_strPluginHealthReportText) {
	throw new Error(`Unexpected plugin health report in ${g_strOutputPath}.`);
}

console.log(`Plugin health report written to ${g_strOutputPath}.`);
```

## Safe use

- Treat every dump file name as trusted input. Relative names are placed under the SourceJS dump root, but absolute paths remain
  absolute and `..` path segments are not removed by `ResolveDumpPath()`.
- `ResolveDumpPath()` requires a non-empty string, normalizes backslashes in the supplied name, and appends `.txt` when the
  normalized name has no `.txt` suffix. Path resolution does not reject embedded NUL; native directory and file helpers
  reject NUL-containing paths with `TypeError` instead of accessing a shortened prefix. Validate names before writing.
- `WriteDump()` converts the supplied text with `String()`, creates the parent directory when needed, throws on directory or
  write failure, and returns the actual output path.
- Directory creation precedes text conversion and writing. A later exception can leave directories behind; the native writer
  overwrites existing files and is not an atomic replacement. Use dedicated diagnostic paths, never files containing data you
  need to preserve. Readback checks in these examples do not provide rollback or durable-storage guarantees.
- Dump contents are diagnostic snapshots of current runtime state. Do not parse them as a stable machine protocol unless the
  project explicitly adds and tests such a contract.
- The seven `Dump*` writers prepend a `# Generated by core/dumps; ...` provenance line; exclude it when counting runtime records.
  Generic `WriteDump()` preserves caller text without adding a header.
- Top-level `bigint` values render as exact decimal text; nested JSON values use exact decimal strings instead of lossy numbers.
  Decode a known address/integer string with `BigInt(...)` when needed.
- Review diagnostic content before sharing it. Runtime values can contain sensitive data; neither this wrapper nor a successful
  write/readback check establishes that the output is safe to publish.

## Related files

- [`packages/sourcejs/core/dumps.js`](../../packages/sourcejs/core/dumps.js) — formatting, path resolution, and dump writers.
- [`core-command-dump.md`](core-command-dump.md) — command-dispatch wrapper for named dumps.
- [`filesystem.md`](filesystem.md) — text-file reads used to inspect generated dumps.
- [`core.md`](core.md) — runtime information used by the custom `WriteDump()` example.
