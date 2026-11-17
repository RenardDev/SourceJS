# `require("config/manager")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Parsed Config Entry](#parsed-config-entry)
- [Parsed Config Text](#parsed-config-text)
- [Execution Result](#execution-result)
- [`ConfigManager`](#configmanager)
- [`ConfigTextEntry`](#configtextentry)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/config/manager.js`](../../packages/sourcejs/config/manager.js). It parses Source-style config text, resolves `.cfg` paths, owns ordered entry objects, preserves prior values while rendering, writes the managed file, and executes CVar/command entries. Use it when one plugin needs an explicit owner for the complete config lifecycle rather than ad hoc file writes and command execution.

`ConfigTextEntry` and `SetHeaderLines` use `NormalizeDescription` from `config/cvar`: array inputs become validated plain snapshots, with one read of the current length and each own slot. Sparse/inherited slots are rejected, and custom `map`, iterators, or array species cannot replace validation. Scalar text and translation behavior are unchanged. A failed `SetHeaderLines` leaves the previous header intact; `ConfigTextEntry.RenderConfigEntry` still returns a fresh copy of its stored lines.

## Import

```js
const { ConfigManager, ParseConfigText } = require("config/manager");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`ConfigManager`](#configmanager-1) | Class | `new ConfigManager(strFilePath, Options = {})` |
| [`ConfigTextEntry`](#configtextentry-1) | Class | `new ConfigTextEntry(Text = [])`; accepts text, a translation object, an array of text/translation objects, or null/undefined. |
| [`GetUnusedConfigEntries`](#getunusedconfigentries) | Function | `GetUnusedConfigEntries(vecEntries = [], setUsedNames = new Set())`; returns a new filtered array sorted by locale-comparison of names, then source line index; entry objects are not copied. |
| [`ParseConfigLine`](#parseconfigline) | Function | `ParseConfigLine(strConfigurationLine)`; returns a parsed entry or null for a line without tokens. |
| [`ParseConfigText`](#parseconfigtext) | Function | `ParseConfigText(strConfigurationText)`; returns parsed entries and maps indexed by name. |
| [`ResolveConfigPath`](#resolveconfigpath) | Function | `ResolveConfigPath(strFilePath, strRootPath)`; omitted root defaults to the runtime config module's `Root`. Adds `.cfg` if absent and normalizes path separators. |

## Parsed Config Entry

| Member | Signature |
| --- | --- |
| `ArgumentLine` | Quoted argument string reconstructed from parsed tokens. |
| `Arguments` | Array of unquoted argument strings. |
| `Line` | Trimmed source line without its comment. |
| `Name` | Parsed command or CVar name. |
| `Value` | Single argument or space-joined argument value. |
| `LineIndex` | Zero-based source line index appended by `ParseConfigText()`. |

## Parsed Config Text

| Member | Signature |
| --- | --- |
| `ArgumentLines` | `Map` from entry names to quoted argument strings; the last occurrence of a name wins. |
| `Entries` | Ordered array of all parsed entries, retaining duplicate names and source line indices. |
| `Values` | `Map` from entry names to parsed values; the last occurrence of a name wins. |

## Execution Result

| Member | Signature |
| --- | --- |
| `Kind` | `"command"` or `"cvar"`. |
| `Name` | Command or CVar name. |
| `Value` | Value submitted to the CVar setter, including failed attempts; absent for command entries. |
| `Command` | Command line submitted for execution, including failed attempts; absent for CVar entries. |
| `Success` | Native boolean returned by the execution/set operation, not a numeric exit code or independent verification of the resulting engine state. |

## `ConfigManager`

| Member | Signature |
| --- | --- |
| `RootPath` | Writable property containing the root directory used for relative config paths. |
| `CVarPrefix` | Writable property containing the prefix applied to managed CVar names. |
| `Indentation` | Writable property retaining the configured indentation value; current manager methods do not use it to format output. |
| `MaxLineLength` | Writable property supplying the default section width; not a hard limit on every rendered line. |
| `Encoding` | Writable property retaining the encoding label; current read/write calls do not pass it to the runtime. |
| `CommentPrefix` | Writable property containing the generated-comment prefix. |
| `SectionSeparator` | Writable property containing the default section separator. |
| `PreserveUnused` | Writable property controlling preservation of unknown entries as comments. |
| `FilePath` | Writable property containing the resolved `.cfg` path. |
| `Entries` | Writable property containing the live ordered entry array. |
| `HeaderLines` | Writable property containing normalized header comment lines. |
| [`ApplyCVarPrefix`](#configmanagerapplycvarprefix) | `ApplyCVarPrefix(strName)`; prepends the configured prefix unless empty or already present. |
| [`AddCommandConfigEntry`](#configmanageraddcommandconfigentry) | `AddCommandConfigEntry(NameOrText, Description = "", Options = {})`; appends and returns a command entry without applying the CVar prefix. |
| [`AddCVarConfigEntry`](#configmanageraddcvarconfigentry) | `AddCVarConfigEntry(strName, DefaultValue, Description = "", Options = {})`; applies the prefix, appends and returns a CVar entry. |
| [`AddConfigSection`](#configmanageraddconfigsection) | `AddConfigSection(Name, Options = {})`; appends and returns a section, accepting a string or translation object as its name. |
| [`AddConfigTextEntry`](#configmanageraddconfigtextentry) | `AddConfigTextEntry(Text = [])`; normalizes text, appends and returns a text entry. |
| [`SetHeaderLines`](#configmanagersetheaderlines) | `SetHeaderLines(HeaderText)`; replaces normalized header lines and returns this manager. |
| [`ReadConfigText`](#configmanagerreadconfigtext) | `ReadConfigText()`; delegates to the runtime text-file reader for the resolved path. |
| [`RenderConfig`](#configmanagerrenderconfig) | `RenderConfig()`; reads previous file contents and returns generated configuration text ending in a newline. |
| [`WriteConfig`](#configmanagerwriteconfig) | `WriteConfig()`; renders and writes the file, then returns its path; throws when the writer reports failure. |
| [`ExecuteConfig`](#configmanagerexecuteconfig) | `ExecuteConfig()`; writes a missing file, reads it, then attempts managed entries in order and returns result records. False results do not stop later entries; an exception stops execution without rollback. |
| `[Symbol.iterator]` | `[Symbol.iterator]()`; returns an iterator over the backing entry array. |

## `ConfigTextEntry`

| Member | Signature |
| --- | --- |
| [`Lines`](#configtextentrylines) | Writable property containing lines emitted verbatim. |
| [`RenderConfigEntry`](#configtextentryrenderconfigentry) | `RenderConfigEntry()`; returns a shallow copy of the stored line array. |

## Examples

### `ConfigManager`

```js
const { ConfigManager } = require("config/manager");

const g_GameplayConfigurationManager = new ConfigManager("sourcejs_gameplay", { CommentPrefix: "//", MaxLineLength: 72, PreserveUnused: true });
g_GameplayConfigurationManager.SetHeaderLines(["SourceJS gameplay configuration."]);
g_GameplayConfigurationManager.AddConfigSection("Movement");
g_GameplayConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");

const g_strConfigurationText = g_GameplayConfigurationManager.RenderConfig();
console.log(`Configuration rendered: ${g_strConfigurationText.length} UTF-16 code units.`);
```

### `ConfigManager` properties

```js
const { ConfigManager } = require("config/manager");

function GetConstructorName(ConfigurationEntry) {
	return ConfigurationEntry.constructor.name;
}

const g_strSourceJSConfigurationRoot = "cfg/sourcejs";
const g_RuntimeConfigurationManager = new ConfigManager("runtime", {
	RootPath: g_strSourceJSConfigurationRoot,
	CVarPrefix: "sourcejs_",
	Indentation: 4,
	MaxLineLength: 48,
	Encoding: "utf-8",
	CommentPrefix: "//",
	SectionSeparator: "=",
	PreserveUnused: false,
});
g_RuntimeConfigurationManager.SetHeaderLines(["SourceJS runtime configuration."]);
g_RuntimeConfigurationManager.AddConfigSection("Runtime");
g_RuntimeConfigurationManager.AddCVarConfigEntry("tick_rate", 60, "Plugin update frequency.");
g_RuntimeConfigurationManager.AddConfigTextEntry(["sourcejs_runtime_ready"]);

console.log(JSON.stringify({
	RootPath: g_RuntimeConfigurationManager.RootPath,
	CVarPrefix: g_RuntimeConfigurationManager.CVarPrefix,
	Indentation: g_RuntimeConfigurationManager.Indentation,
	MaxLineLength: g_RuntimeConfigurationManager.MaxLineLength,
	Encoding: g_RuntimeConfigurationManager.Encoding,
	CommentPrefix: g_RuntimeConfigurationManager.CommentPrefix,
	SectionSeparator: g_RuntimeConfigurationManager.SectionSeparator,
	PreserveUnused: g_RuntimeConfigurationManager.PreserveUnused,
	FilePath: g_RuntimeConfigurationManager.FilePath,
	Entries: g_RuntimeConfigurationManager.Entries.map(GetConstructorName),
	HeaderLines: g_RuntimeConfigurationManager.HeaderLines,
}));

const g_strConfigurationText = g_RuntimeConfigurationManager.RenderConfig();
console.log(`Configuration rendered: ${g_strConfigurationText.length} UTF-16 code units.`);
```

### `ConfigTextEntry`

```js
const { ConfigTextEntry } = require("config/manager");

const g_PreambleConfigurationEntry = new ConfigTextEntry(["// Execute network settings before gameplay settings.", "exec sourcejs/network.cfg"]);
console.log(g_PreambleConfigurationEntry.RenderConfigEntry().join("\n"));
```

### `ConfigTextEntry.Lines`

```js
const { ConfigTextEntry } = require("config/manager");

const g_StartupCommandsEntry = new ConfigTextEntry(["exec sourcejs/network.cfg", "exec sourcejs/gameplay.cfg"]);
console.log(g_StartupCommandsEntry.Lines, g_StartupCommandsEntry.RenderConfigEntry().join("\n"));
```

### `ParseConfigLine`

```js
const { ParseConfigLine } = require("config/manager");

const g_ParsedConfigurationEntry = ParseConfigLine("sv_gravity \"600\" // Low-gravity server.");
if (g_ParsedConfigurationEntry) {
	console.log(JSON.stringify({
		ArgumentLine: g_ParsedConfigurationEntry.ArgumentLine,
		Arguments: g_ParsedConfigurationEntry.Arguments,
		Line: g_ParsedConfigurationEntry.Line,
		Name: g_ParsedConfigurationEntry.Name,
		Value: g_ParsedConfigurationEntry.Value,
	}));
}
```

### `ParseConfigText`

```js
const { ParseConfigText } = require("config/manager");

const g_ParsedConfigurationText = ParseConfigText(`
sv_gravity "600"
log "on"
exec "sourcejs/rotation.cfg"
`);
const g_vecArgumentLineEntries = Array.from(g_ParsedConfigurationText.ArgumentLines);
const g_vecValueEntries = Array.from(g_ParsedConfigurationText.Values);
console.log(JSON.stringify({
	ArgumentLineEntries: g_vecArgumentLineEntries,
	Entries: g_ParsedConfigurationText.Entries,
	ValueEntries: g_vecValueEntries,
}));
```

### `ResolveConfigPath`

```js
const { ResolveConfigPath } = require("config/manager");

const g_strGameplayConfigurationPath = ResolveConfigPath("sourcejs_gameplay");
console.log(`Resolved gameplay config: ${g_strGameplayConfigurationPath}`);
```

### `GetUnusedConfigEntries`

```js
const { GetUnusedConfigEntries, ParseConfigText } = require("config/manager");

const g_PreviousConfigurationText = ParseConfigText(`
sv_gravity "600"
sourcejs_log_level "2"
sourcejs_removed_option "1"
`);
const g_setActiveNames = new Set(["sv_gravity", "sourcejs_log_level"]);
const g_vecObsoleteEntries = GetUnusedConfigEntries(g_PreviousConfigurationText.Entries, g_setActiveNames);
for (const ConfigurationEntry of g_vecObsoleteEntries) {
	console.log(`Unused entry name: ${ConfigurationEntry.Name}`);
}
```

### `ConfigManager.ApplyCVarPrefix`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_logging", { CVarPrefix: "sourcejs_" });
const g_strCVarName = g_ConfigurationManager.ApplyCVarPrefix("log_level");
console.log(g_strCVarName);
// sourcejs_log_level
```

### `ConfigManager.AddCommandConfigEntry`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_server_startup");
const g_LoggingCommandEntry = g_ConfigurationManager.AddCommandConfigEntry("log", "Enable the engine server log.", { Arguments: ["on"] });
console.log(g_LoggingCommandEntry.RenderConfigEntry(g_ConfigurationManager).join("\n"));
```

### `ConfigManager.AddCVarConfigEntry`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
const g_GravityConfigurationEntry = g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.", { ValueMinimum: 100, ValueMaximum: 2000 });
console.log(g_GravityConfigurationEntry.RenderConfigEntry(g_ConfigurationManager).join("\n"));
```

### `ConfigManager.ExecuteConfig`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_runtime");
g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");
g_ConfigurationManager.AddCommandConfigEntry("log", "Enable the engine server log.", { Arguments: ["on"] });

const g_vecExecutionResults = g_ConfigurationManager.ExecuteConfig();
for (const ExecutionResult of g_vecExecutionResults) {
	console.log(`${ExecutionResult.Kind} ${ExecutionResult.Name}: ${ExecutionResult.Success ? "ok" : "failed"}`);
}
```

### `ConfigManager.SetHeaderLines`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
g_ConfigurationManager.SetHeaderLines(["SourceJS gameplay configuration.", "Review values before applying changes."]);

g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");

const g_strConfigurationText = g_ConfigurationManager.RenderConfig();
console.log(`Configuration rendered: ${g_strConfigurationText.length} UTF-16 code units.`);
```

### `ConfigManager.ReadConfigText`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
const g_strConfigurationText = g_ConfigurationManager.ReadConfigText();
if (typeof g_strConfigurationText === "string") {
	console.log(`Configuration read: ${g_strConfigurationText.length} UTF-16 code units.`);

} else {
	console.log("Configuration text is unavailable.");
}
```

### `ConfigManager.RenderConfig`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
g_ConfigurationManager.AddConfigSection("Movement");
g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");

const g_strConfigurationText = g_ConfigurationManager.RenderConfig();
console.log(`Configuration rendered: ${g_strConfigurationText.length} UTF-16 code units.`);
```

### `ConfigManager.AddConfigSection`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
const g_MovementConfigurationSection = g_ConfigurationManager.AddConfigSection("Movement", { Separator: "=", Width: 48 });
console.log(g_MovementConfigurationSection.RenderConfigEntry(g_ConfigurationManager).join("\n"));
```

### `ConfigManager.AddConfigTextEntry`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_server_startup");
g_ConfigurationManager.AddConfigTextEntry(["// Load network settings before enabling the server log.", "exec sourcejs/network.cfg"]);

g_ConfigurationManager.AddCommandConfigEntry("log", "Enable the engine server log.", { Arguments: ["on"] });

const g_strConfigurationText = g_ConfigurationManager.RenderConfig();
console.log(`Configuration rendered: ${g_strConfigurationText.length} UTF-16 code units.`);
```

### `ConfigManager.WriteConfig`

```js
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
g_ConfigurationManager.SetHeaderLines(["SourceJS gameplay configuration."]);
g_ConfigurationManager.AddConfigSection("Movement");
g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");

const g_strGameplayConfigurationPath = g_ConfigurationManager.WriteConfig();
console.log(`Wrote ${g_strGameplayConfigurationPath}`);
```

### `ConfigTextEntry.RenderConfigEntry`

```js
const { ConfigTextEntry } = require("config/manager");

const g_StartupCommandsEntry = new ConfigTextEntry(["// Load network settings before gameplay settings.", "exec sourcejs/network.cfg"]);
console.log(g_StartupCommandsEntry.RenderConfigEntry().join("\n"));
```

### `ConfigManager[Symbol.iterator]`

```js
const { ConfigManager } = require("config/manager");

function GetEntryName(ConfigurationEntry) {
	return ConfigurationEntry.Key ?? ConfigurationEntry.Name ?? "text/section";
}

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
g_ConfigurationManager.AddConfigSection("Movement");
g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.");
g_ConfigurationManager.AddCommandConfigEntry("log", "Enable the engine server log.", { Arguments: ["on"] });

for (const ConfigurationEntry of g_ConfigurationManager) {
	console.log(GetEntryName(ConfigurationEntry));
}
```

## Safe use

- `WriteConfig()` truncates and overwrites the manager's resolved target file and throws when the native write fails. This is not atomic replacement or a durable-storage guarantee. Use a project-owned configuration path and handle that exception at the application boundary.
- `ConfigTextEntry` emits its lines verbatim. Treat those lines as executable configuration input and do not build them from untrusted text.
- `ExecuteConfig()` attempts only managed CVar and command entries, not arbitrary text entries or every line in the file. A missing file is written first. A false operation result does not stop later entries; an exception stops processing without undoing earlier changes. Inspect every returned result and handle exceptions; success is the underlying operation's report, not an independent state check.
- Parsing and rendering are not lossless round trips: duplicate names remain in parsed entries, but lookup maps keep the last occurrence; argument lines are reconstructed from tokens. Use trusted names, values, descriptions, and paths. Quoting does not reject embedded newlines, and a resolved path is not proof of containment within the root.
- Avoid printing existing or rendered configuration and execution payloads when they may contain secrets. Rendering reads the current file; it is not a pure operation over the manager's entries alone.
- Iteration uses the backing entry array, not a snapshot. Do not assume mutation during iteration is isolated.
- Public properties are live PascalCase fields, not compatibility aliases. Prefer constructors and the public `Add...`, `SetHeaderLines`, and rendering methods over manual field edits; changing `RootPath` does not resolve `FilePath` again.
- Command/CVar/help rendering requires a non-array object with a string `CommentPrefix`. Only section rendering permits an omitted or null manager. Legacy prefixed fields are not accepted.
- Configuration file I/O and execution are synchronous and can occupy the game thread; these methods do not use the network/database `Options, Callback` protocol. Avoid per-frame file access. Native file helpers reject NUL-containing paths with `TypeError` before IO instead of using a shortened prefix. Text reading and writing preserve embedded NUL through explicit UTF-8 byte lengths; they are not arbitrary-byte APIs.

## Related files

- [`packages/sourcejs/config/manager.js`](../../packages/sourcejs/config/manager.js) contains the implementation documented here.
- [`config.md`](config.md) describes the aggregate configuration API.
- [`config-command.md`](config-command.md) and [`config-cvar.md`](config-cvar.md) document the concrete command and ConVar entry types.
