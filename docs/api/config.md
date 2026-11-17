# `require("config")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`ConfigManager`](#configmanager)
- [Parsing and formatting](#parsing-and-formatting)
- [Entry classes](#entry-classes)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The public module is assembled in [`packages/sourcejs/config.js`](../../packages/sourcejs/config.js) by attaching entry/manager exports from [`packages/sourcejs/config/`](../../packages/sourcejs/config/) to the native `config` runtime object. It resolves configuration paths, preserves existing values when rendering managed entries, writes generated text, and can execute managed CVar and command entries. Rendering depends on current file contents; execution does not run arbitrary text entries or every line in the generated file. Use it when a plugin owns a Source-style `.cfg` file and needs one explicit read/render/write/execute lifecycle.

The native `Root` path is converted to UTF-8 before JavaScript string creation, preserving native spelling and separators independently of the Windows active code page.

## Import

```js
const g_ConfigurationAPI = require("config");
console.log(g_ConfigurationAPI.ConfigManager, g_ConfigurationAPI.ResolveConfigPath, g_ConfigurationAPI.WriteTextFile);
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| `Root` | Property | Default directory formed from the game root plus `cfg/sourcejs`. |
| `DoesFileExist` | Function | `DoesFileExist(strFilePath)`; checks local existence, then the engine filesystem. A local directory also satisfies the first check. |
| `ReadTextFile` | Function | `ReadTextFile(strFilePath)`; reads a local file, returning text or null when opening fails; does not use the engine filesystem fallback. |
| `WriteTextFile` | Function | `WriteTextFile(strFilePath, strText)`; creates parent directories, truncates/writes a local file, and returns a boolean stream-status result. UTF-8 text conversion uses an explicit byte length and preserves embedded NUL characters. Not an atomic replacement or durability guarantee. |
| `EnsureDirectoryExists` | Function | `EnsureDirectoryExists(strDirectoryPath)`; creates local directories recursively and reports whether the resulting path is a directory. |
| [`CommandConfigEntry`](#commandconfigentry) | Class | `new CommandConfigEntry(NameOrText, DescriptionOrLines = "", Options = {})` |
| [`ConfigManager`](#configmanager) | Class | `new ConfigManager(strFilePath, Options = {})` |
| [`ConfigSectionManager`](#configsectionmanager) | Class | `new ConfigSectionManager(Name, Options = {})` |
| [`ConfigTextEntry`](#configtextentry) | Class | `new ConfigTextEntry(Text = [])` |
| [`CVarConfigEntry`](#cvarconfigentry) | Class | `new CVarConfigEntry(strName, DefaultValue, Description = "", Options = {})` |
| [`CVarConfigListManager`](#cvarconfiglistmanager) | Class | `new CVarConfigListManager(Name, Options = {})` |
| `CreateCommandConfigEntry` | Function | `CreateCommandConfigEntry(NameOrText, DescriptionOrLines = "", Options = {})` |
| `CreateConfigSection` | Function | `CreateConfigSection(Name, Options = {})` |
| `CreateCVarConfigEntry` | Function | `CreateCVarConfigEntry(strName, DefaultValue, Description = "", Options = {})` |
| `FormatConfigValue` | Function | `FormatConfigValue(ConfigurationValue)` |
| `GetUnusedConfigEntries` | Function | `GetUnusedConfigEntries(vecEntries = [], setUsedNames = new Set())` |
| `NormalizeDescription` | Function | `NormalizeDescription(ValueDescription)` |
| `ParseConfigLine` | Function | `ParseConfigLine(strConfigurationLine)` |
| `ParseConfigText` | Function | `ParseConfigText(strConfigurationText)` |
| `QuoteConfigValue` | Function | `QuoteConfigValue(ConfigurationValue)` |
| `ResolveConfigPath` | Function | `ResolveConfigPath(strFilePath, strRootPath)`; omitted root uses the runtime module's `Root`. |
| `ResolveConfigText` | Function | `ResolveConfigText(ConfigurationValue)` |

The native file helpers preserve complete UTF-8 path lengths and reject embedded NUL with `TypeError` before IO. They never target only the prefix before NUL; `WriteTextFile()` rejects an invalid path before coercing its text argument.

Use the named imports from `config` for these statements. The file examples target a plugin-owned directory under the current configuration root; a read can still return `null` after an existence check.

| Use | Example |
| --- | --- |
| Resolve a path without changing the shared root. | `const strDirectoryPath = Root + "/match-control";` |
| Create the plugin's own configuration directory. | `const bDirectoryReady = EnsureDirectoryExists(strDirectoryPath);` |
| Test a configuration path. | `const bExists = DoesFileExist(strDirectoryPath + "/rules.cfg");` |
| Read existing configuration. | `const strConfiguration = ReadTextFile(strDirectoryPath + "/rules.cfg");` |
| Start a section before attaching entries to a manager. | `const Section = CreateConfigSection("Gameplay");` |
| Prepare a command entry without dispatching the command. | `const Entry = CreateCommandConfigEntry("exec", "Load rotation.", { Arguments: ["sourcejs/rotation.cfg"] });` |
| Prepare a default ConVar entry without applying it. | `const Entry = CreateCVarConfigEntry("sv_gravity", 800, "World gravity.");` |
| Turn a multi-line description into help lines. | `const vecHelpLines = NormalizeDescription("Match rules.\nReload after edits.");` |

## `ConfigManager`

`ConfigManager` owns entries and the resolved file path. The public workflow is:

```js
const { ConfigManager, ResolveConfigPath } = require("config");

const g_strConfigurationPath = ResolveConfigPath("gameplay.cfg");
const g_ConfigurationManager = new ConfigManager("gameplay.cfg", { PreserveUnused: false, MaxLineLength: 48 });
g_ConfigurationManager.SetHeaderLines(["SourceJS gameplay configuration."]);
g_ConfigurationManager.AddConfigSection("Movement");
g_ConfigurationManager.AddCVarConfigEntry("sv_gravity", 800, "World gravity.", { ValueMinimum: 100, ValueMaximum: 2000 });
g_ConfigurationManager.AddCommandConfigEntry("exec", "Load the rotation.", { Arguments: ["sourcejs/rotation.cfg"] });

const g_strRenderedConfiguration = g_ConfigurationManager.RenderConfig();
console.log(`Configuration ${g_strConfigurationPath} preview: ${g_strRenderedConfiguration.length} UTF-16 code units.`);

const g_strWrittenPath = g_ConfigurationManager.WriteConfig();
console.log(`Wrote ${g_strWrittenPath}`);

const g_vecExecutionResults = g_ConfigurationManager.ExecuteConfig();
for (const ExecutionResult of g_vecExecutionResults) {
	console.log(`${ExecutionResult.Kind} ${ExecutionResult.Name}: ${ExecutionResult.Success ? "ok" : "failed"}`);
}
```

| Member | Signature |
| --- | --- |
| `RootPath` | Writable property containing the configured root directory. |
| `CVarPrefix` | Writable property containing the CVar prefix. |
| `Indentation` | Retained value; current manager methods do not use it to format output. |
| `MaxLineLength` | Default section width, not a hard limit on rendered line length. |
| `Encoding` | Retained encoding label; current read/write calls do not pass it to the runtime. |
| `CommentPrefix` | Writable property containing the comment prefix. |
| `SectionSeparator` | Writable property containing the default section separator. |
| `PreserveUnused` | Writable property controlling preservation of unmanaged entries as comments. |
| `FilePath` | Writable property containing the resolved config path. |
| `Entries` | Writable property containing the mutable entry list rendered in order. |
| `HeaderLines` | Writable property containing normalized header lines. |
| `ApplyCVarPrefix` | `ApplyCVarPrefix(strName)`; returns the prefixed name. |
| `AddCommandConfigEntry` | `AddCommandConfigEntry(NameOrText, Description = "", Options = {})`; appends and returns an entry without applying the CVar prefix. |
| `AddCVarConfigEntry` | `AddCVarConfigEntry(strName, DefaultValue, Description = "", Options = {})`; applies the prefix, appends and returns an entry. |
| `AddConfigSection` | `AddConfigSection(Name, Options = {})`; appends and returns a section entry. |
| `AddConfigTextEntry` | `AddConfigTextEntry(Text = [])`; appends and returns a text entry. |
| `SetHeaderLines` | `SetHeaderLines(HeaderText)`; replaces normalized header lines and returns this manager. |
| `ReadConfigText` | `ReadConfigText()`; delegates to the native local-file reader. |
| `RenderConfig` | `RenderConfig()`; returns generated text ending with a newline. |
| `WriteConfig` | `WriteConfig()`; returns the resolved path or throws on write failure. |
| `ExecuteConfig` | `ExecuteConfig()`; returns ordered result records for managed CVar/command entries. |
| `[Symbol.iterator]` | `[Symbol.iterator]()` |

## Parsing and formatting

```js
const {
	FormatConfigValue,
	GetUnusedConfigEntries,
	ParseConfigLine,
	ParseConfigText,
	QuoteConfigValue,
	ResolveConfigText,
} = require("config");

const g_ParsedConfigurationLine = ParseConfigLine("sv_gravity \"600\" // existing value");
const g_ParsedConfiguration = ParseConfigText("sv_gravity \"600\"\nexec \"sourcejs/rotation.cfg\"");
const g_vecUnusedConfigurationEntries = GetUnusedConfigEntries(g_ParsedConfiguration.Entries, new Set(["sv_gravity"]));
console.log(g_ParsedConfigurationLine, g_ParsedConfiguration, g_vecUnusedConfigurationEntries);

console.log(FormatConfigValue(true));
console.log(QuoteConfigValue("Ren's server"));
console.log(ResolveConfigText("Description"));
```

`ParseConfigLine` returns `null` for blank or comment-only lines. `ParseConfigText` returns `Entries`, `Values`, and `ArgumentLines`: entries retain duplicates, while maps keep the last occurrence of each name. `GetUnusedConfigEntries` returns a new filtered array sorted by locale-comparison of names, then source line index; entry objects remain shared. The example prints fixed non-sensitive inputs, not arbitrary configuration contents.

`FormatConfigValue` accepts strings, booleans (`1`/`0`), finite numbers, and nullish values (empty text). It rejects `bigint`, non-finite numbers, and objects rather than coercing them. `QuoteConfigValue` applies the same value contract before escaping and quoting. `ResolveConfigText` accepts strings or translation values with `GetTranslation()` or `GetString()` returning a string; `GetTranslation()` takes precedence when both exist. `NormalizeDescription` accepts one such value or an array; a scalar text is split at line breaks, while array elements remain individual lines. Nullish values and the empty string yield no description lines.

## Entry classes

```js
const {
	CommandConfigEntry,
	ConfigSectionManager,
	ConfigTextEntry,
	CVarConfigEntry,
	CVarConfigListManager,
} = require("config");

const g_CommandEntry = new CommandConfigEntry("exec", "Load a config.", { Arguments: ["sourcejs/rotation.cfg"] });
const g_CVarEntry = new CVarConfigEntry("sv_gravity", 800, "World gravity.", { ValueMinimum: 100, ValueMaximum: 2000 });
g_CVarEntry.CreateHelpList("Example gravity values").ExtendListItems(["800", "600"]);

const g_ListManager = new CVarConfigListManager("Accepted values");
g_ListManager.ExtendListItems(["0 - disabled", "1 - enabled"]);

const g_Section = new ConfigSectionManager("Movement", { Width: 48 });
const g_TextEntry = new ConfigTextEntry(["// managed by SourceJS"]);
console.log(g_CommandEntry, g_CVarEntry, g_ListManager, g_Section, g_TextEntry);
```

### `CommandConfigEntry`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the command name. |
| `Description` | Writable property containing normalized description lines. |
| `Arguments` | Writable property retaining the supplied argument array by reference; values are quoted when rendering or requesting the argument line. |
| `WriteEmpty` | Writable property controlling emission without arguments. |
| `Key` | Read-only command key. |
| `ArgumentLine` | Read-only quoted argument line. |
| `RenderConfigEntry` | `RenderConfigEntry(ConfigurationManager, mapPreviousArguments = new Map())`; a matching map entry, including an empty string, overrides current arguments. |

### `ConfigTextEntry`

| Member | Signature |
| --- | --- |
| `Lines` | Writable property containing normalized text lines. |
| `RenderConfigEntry` | `RenderConfigEntry()`; returns a shallow copy of the stored line array. |

### `ConfigSectionManager`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the section name. |
| `Separator` | Writable property containing the separator text. |
| `Width` | Writable property containing the number of separator repetitions, not a character or display-column limit. |
| `RenderConfigEntry` | `RenderConfigEntry(ConfigurationManager = null)`; returns three comment-prefixed strings, using `//` when the manager is omitted or null; otherwise requires a non-array object with a string `CommentPrefix`. No legacy prefixed-field fallback. |

### `CVarConfigListManager`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the list name. |
| `ItemMarker` | Writable property containing the item marker. |
| `Indent` | Writable property containing the item indentation. |
| `Items` | Writable property containing list items. |
| `AppendListItem` | `AppendListItem(Text)`; accepts a string or translation object and returns this list. |
| `ExtendListItems` | `ExtendListItems(vecLines = [])`; appends in order and returns this list; earlier additions remain if a later item throws. |
| `RenderList` | `RenderList(ConfigurationManager)`; returns a new array containing the comment-prefixed list heading followed by one comment-prefixed line per item, using the configured indentation and marker. |
| `[Symbol.iterator]` | `[Symbol.iterator]()`; iterates the backing item array, not a snapshot. |

### `CVarConfigEntry`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the CVar name. |
| `DefaultValue` | Writable property containing the default value. |
| `Description` | Writable property containing normalized description lines. |
| `Flags` | Retained `Options.Flags` value, formatted as comment-only metadata; `null` suppresses it. Does not install engine flags. |
| `Minimum` | Retained `Options.ValueMinimum` value, formatted as a comment-only lower bound; `null` suppresses it. Does not validate or clamp values. |
| `Maximum` | Retained `Options.ValueMaximum` value, formatted as a comment-only upper bound; `null` suppresses it. Does not validate or clamp values. |
| `ShowDefault` | Writable property controlling default-value help text. |
| `HelpEntries` | Writable property containing extra help entries. |
| `Key` | Read-only CVar key. |
| `AddHelpText` | `AddHelpText(HelpText = [])`; appends normalized descriptions and returns this entry. |
| `CreateHelpList` | `CreateHelpList(Name, Options = {})`; appends and returns a new list. |
| `GetHelpLines` | `GetHelpLines(ConfigurationManager)` |
| `RenderConfigEntry` | `RenderConfigEntry(ConfigurationManager, mapPreviousValues = new Map())`; a matching map entry overrides the default, including an empty string. |

Use `ConfigManager` as the owner of file I/O and ordered entries. The entry classes only render their own lines. Their public properties are live PascalCase fields, not snapshots or aliases; prefer constructors and `Add...` methods over manual field edits. Rendering commands, CVar entries, and help lists requires a non-array manager object with a string `CommentPrefix`; only section rendering permits an omitted or null manager. Legacy prefixed fields are not accepted.

## Safe use

`WriteConfig()` truncates and rewrites the resolved file; it is not an atomic replacement. `ExecuteConfig()` attempts managed CVar and command entries in order, using file values when present and defaults otherwise. It does not execute arbitrary text entries. A missing file is written first. Check returned operation results and handle exceptions: a false result allows later entries to run, while an exception stops the loop without undoing earlier changes.

These file helpers and manager methods are synchronous; they do not use the native network/database `Options, Callback` request protocol. File I/O and command execution can occupy the calling game thread. Keep file access trusted and bounded, and schedule configuration work deliberately rather than on every frame. Execution results retain the native boolean status, not a numeric exit code or a guarantee of the command's eventual effect.

Resolve paths deliberately and keep contents trusted. `ResolveConfigPath` accepts absolute paths and does not establish containment within its root. Native file functions take paths directly; they do not automatically prepend `config.Root`. NUL-containing paths throw `TypeError` before IO. Text reading and writing use explicit byte lengths for UTF-8 conversion and preserve embedded NUL characters; these are text APIs, not arbitrary-byte APIs.

`RenderConfig()` reads current file contents; inspection does not freeze that state. `WriteConfig()` renders again and `ExecuteConfig()` reads again, so a preview is not a transaction or guarantee that the same values will be used. Do not print existing/rendered configuration or execution payloads when they can contain secrets. Quoting escapes backslashes and double quotes, but does not reject embedded newlines.

File existence and readability are different: `DoesFileExist()` can find local directories or engine-filesystem entries that `ReadTextFile()` cannot open. A null read result means opening failed, not necessarily that the file is absent. The current reader does not separately report stream errors after opening. The writer explicitly closes its stream before checking its boolean status, but does not request durable storage synchronization; neither return value proves complete durable I/O.

## Related files

- [`packages/sourcejs/config.js`](../../packages/sourcejs/config.js) assembles the public module.
- [`packages/sourcejs/config/manager.js`](../../packages/sourcejs/config/manager.js) owns parsing, rendering, file I/O, and execution.
- [`packages/sourcejs/config/command.js`](../../packages/sourcejs/config/command.js), [`packages/sourcejs/config/cvar.js`](../../packages/sourcejs/config/cvar.js), and [`packages/sourcejs/config/section.js`](../../packages/sourcejs/config/section.js) implement the entry types.
