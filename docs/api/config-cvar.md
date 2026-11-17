# `require("config/cvar")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`CVarConfigEntry`](#cvarconfigentry)
- [`CVarConfigListManager`](#cvarconfiglistmanager)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/config/cvar.js`](../../packages/sourcejs/config/cvar.js). It normalizes scalar values and translated text, renders CVar entries with optional range/flag/help comments, and builds reusable help lists. Use it directly for standalone entry rendering or through `ConfigManager.AddCVarConfigEntry(...)` when a manager owns the file lifecycle.

## Import

```js
const { CVarConfigEntry, CVarConfigListManager, CreateCVarConfigEntry } = require("config/cvar");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`CVarConfigEntry`](#cvarconfigentry-1) | Class | `new CVarConfigEntry(strName, DefaultValue, Description = "", Options = {})` |
| [`CVarConfigListManager`](#cvarconfiglistmanager-1) | Class | `new CVarConfigListManager(Name, Options = {})` |
| [`CreateCVarConfigEntry`](#createcvarconfigentry) | Function | `CreateCVarConfigEntry(strName, DefaultValue, Description = "", Options = {})` |
| [`FormatConfigValue`](#formatconfigvalue) | Function | `FormatConfigValue(ConfigurationValue)`; returns a string for strings, finite numbers, booleans, null or undefined; throws for unsupported values. |
| [`NormalizeDescription`](#normalizedescription) | Function | `NormalizeDescription(ValueDescription)`; returns an array of resolved description lines. |
| [`QuoteConfigValue`](#quoteconfigvalue) | Function | `QuoteConfigValue(ConfigurationValue)`; formats the value, escapes backslashes and double quotes, then encloses it in double quotes. |
| [`ResolveConfigText`](#resolveconfigtext) | Function | `ResolveConfigText(ConfigurationValue)`; accepts a string or a translation object returning a string. |

`NormalizeDescription` resolves array descriptions from left to right into a plain dense array, reading the input length and each own slot once. Custom `map`, iterators, and array species cannot replace validation; later input-array changes do not alter the resolved lines. Translation calls retain their receiver and error behavior. `AddHelpText` appends no lines if normalization fails. This does not change `ExtendListItems`, which retains earlier appended items when a later item fails.

`FormatConfigValue(null)` and `FormatConfigValue(undefined)` return an empty string; booleans become `"1"` or `"0"`. Strings are retained unchanged, and finite numbers use JavaScript's `String(...)` conversion. Objects, raw `bigint`, non-finite numbers, and other unsupported types throw `TypeError`.

## `CVarConfigEntry`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the CVar name written to the config file. |
| `DefaultValue` | Writable property containing the value used when no previous CVar value exists. |
| `Description` | Writable property containing comment lines rendered above the CVar. |
| `Flags` | Live value retained from `Options.Flags`; emitted as comment-only metadata when not `null`, without installing engine flags. |
| `Minimum` | Live value retained from `Options.ValueMinimum`; supplies lower-bound comment metadata, without enforcing a minimum. |
| `Maximum` | Live value retained from `Options.ValueMaximum`; supplies upper-bound comment metadata, without enforcing a maximum. |
| `ShowDefault` | Writable property controlling whether the default-value comment is rendered. |
| `HelpEntries` | Writable property containing help lines and `CVarConfigListManager` instances. |
| [`Key`](#cvarconfigentrykey) | Read-only CVar name used by `ConfigManager`. |
| [`AddHelpText`](#cvarconfigentryaddhelptext) | `AddHelpText(HelpText = [])`; normalizes and appends descriptions, then returns this entry. |
| [`CreateHelpList`](#cvarconfigentrycreatehelplist) | `CreateHelpList(Name, Options = {})`; resolves a string or translation heading, appends and returns a new `CVarConfigListManager`. |
| [`GetHelpLines`](#cvarconfigentrygethelplines) | `GetHelpLines(ConfigurationManager)`; returns a new array of comment-prefixed help lines, rendering nested lists. |
| [`RenderConfigEntry`](#cvarconfigentryrenderconfigentry) | `RenderConfigEntry(ConfigurationManager, mapPreviousValues = new Map())`; returns a new array of comments and the quoted CVar assignment. Any existing map entry overrides the default, including an empty string. |

## `CVarConfigListManager`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the heading rendered above the list. |
| `ItemMarker` | Writable property containing the marker inserted before each item. |
| `Indent` | Writable property containing the number of spaces inserted before each marker. |
| `Items` | Writable property containing the live item strings. |
| [`AppendListItem`](#cvarconfiglistmanagerappendlistitem) | `AppendListItem(Text)`; resolves a string or translation object, appends it and returns this list. |
| [`ExtendListItems`](#cvarconfiglistmanagerextendlistitems) | `ExtendListItems(vecLines = [])`; requires an array, appends items in order and returns this list. Earlier items remain appended if a later item throws. |
| [`RenderList`](#cvarconfiglistmanagerrenderlist) | `RenderList(ConfigurationManager)`; returns a new array containing the comment-prefixed heading and indented items. |
| `[Symbol.iterator]` | `[Symbol.iterator]()`; returns an iterator over the backing item array, not a snapshot. |

## Examples

### `CVarConfigEntry`

```js
const { CVarConfigEntry } = require("config/cvar");

const g_GravityConfigurationEntry = new CVarConfigEntry("sv_gravity", 800, "World gravity in units per second squared.", { ValueMinimum: 100, ValueMaximum: 2000 });
console.log(`${g_GravityConfigurationEntry.Name}: Default=${g_GravityConfigurationEntry.DefaultValue}, Range=${g_GravityConfigurationEntry.Minimum}-${g_GravityConfigurationEntry.Maximum}`);
```

### `CVarConfigEntry` properties

```js
const { CVarConfigEntry } = require("config/cvar");

const g_TickRateConfigurationEntry = new CVarConfigEntry("sourcejs_update_rate", 60, "Example plugin update frequency in Hz.\nThe consuming plugin must implement this setting.", { Flags: "archive notify", ValueMinimum: 20, ValueMaximum: 100, ShowDefault: false });
g_TickRateConfigurationEntry.AddHelpText(["Use lower values on CPU-constrained servers."]);

console.log(JSON.stringify({
	Name: g_TickRateConfigurationEntry.Name,
	DefaultValue: g_TickRateConfigurationEntry.DefaultValue,
	Description: g_TickRateConfigurationEntry.Description,
	Flags: g_TickRateConfigurationEntry.Flags,
	Minimum: g_TickRateConfigurationEntry.Minimum,
	Maximum: g_TickRateConfigurationEntry.Maximum,
	ShowDefault: g_TickRateConfigurationEntry.ShowDefault,
	HelpEntries: g_TickRateConfigurationEntry.HelpEntries,
}));

console.log(g_TickRateConfigurationEntry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n"));
```

### `CVarConfigListManager`

```js
const { CVarConfigListManager } = require("config/cvar");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs/logging");
const g_LogLevelsList = new CVarConfigListManager("Allowed log levels", { ItemMarker: "- ", Indent: 2 });
g_LogLevelsList.ExtendListItems(["0 - disabled", "1 - errors only", "2 - informational messages", "3 - debug messages"]);

console.log(g_LogLevelsList.RenderList(g_ConfigurationManager).join("\n"));
```

### `CVarConfigListManager.Name`, `ItemMarker`, `Indent`, and `Items`

```js
const { CVarConfigListManager } = require("config/cvar");

const g_LogLevelsList = new CVarConfigListManager("Runtime log levels", { ItemMarker: "- ", Indent: 4 });
g_LogLevelsList.ExtendListItems(["errors", "info", "debug"]);

console.log(JSON.stringify({ Name: g_LogLevelsList.Name, ItemMarker: g_LogLevelsList.ItemMarker, Indent: g_LogLevelsList.Indent, Items: g_LogLevelsList.Items }));

console.log(g_LogLevelsList.RenderList({ CommentPrefix: "//" }).join("\n"));
```

### `CreateCVarConfigEntry`

```js
const { CreateCVarConfigEntry } = require("config/cvar");

const g_LogLevelConfigurationEntry = CreateCVarConfigEntry("sourcejs_log_level", 2, "Verbosity of this plugin's log output.", { ValueMinimum: 0, ValueMaximum: 3 });
console.log(g_LogLevelConfigurationEntry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n"));
```

### `FormatConfigValue`

```js
const { FormatConfigValue } = require("config/cvar");

const g_vecConfigurationLines = [`sourcejs_logging_enabled ${FormatConfigValue(true)}`, `sourcejs_log_level ${FormatConfigValue(2)}`];
console.log(g_vecConfigurationLines.join("\n"));
```

### `NormalizeDescription`

```js
const { NormalizeDescription } = require("config/cvar");

function FormatCommentLine(strDescriptionLine) {
	return `// ${strDescriptionLine}`;
}

const g_vecDescriptionLines = NormalizeDescription("Example plugin log verbosity.\nThe consuming plugin determines when changes apply.");
const g_vecCommentLines = g_vecDescriptionLines.map(FormatCommentLine);
console.log(g_vecCommentLines.join("\n"));
```

### `QuoteConfigValue`

```js
const { QuoteConfigValue } = require("config/cvar");

const g_strHostname = "Ren's \"Co-op\" Server";
console.log(`hostname ${QuoteConfigValue(g_strHostname)}`);
```

### `ResolveConfigText`

The following integration example requires a runtime-loadable `my_plugin` translation resource containing the `Log level` phrase. `LangStrings` loads that resource during construction; a missing phrase is reported explicitly below.

```js
const { ResolveConfigText } = require("config/cvar");
const { LangStrings } = require("translations/strings");

const g_LanguageStrings = new LangStrings("my_plugin");
const g_LogDescription = g_LanguageStrings.Get("Log level");
if (!g_LogDescription) {
	throw new Error("Translation phrase \"Log level\" is missing.");
}

console.log(ResolveConfigText(g_LogDescription));
```

### `CVarConfigEntry.GetHelpLines`

```js
const { CVarConfigEntry } = require("config/cvar");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs/logging");
const g_LogLevelConfigurationEntry = new CVarConfigEntry("sourcejs_log_level", 2);
g_LogLevelConfigurationEntry.AddHelpText(["Higher values produce more detailed plugin logs."]);
const g_AcceptedValuesList = g_LogLevelConfigurationEntry.CreateHelpList("Accepted values");
g_AcceptedValuesList.ExtendListItems(["0 - disabled", "1 - errors only", "2 - informational messages", "3 - debug messages"]);

console.log(g_LogLevelConfigurationEntry.GetHelpLines(g_ConfigurationManager).join("\n"));
```

### `CVarConfigEntry.Key`

```js
const { CVarConfigEntry } = require("config/cvar");

const g_LogLevelConfigurationEntry = new CVarConfigEntry("sourcejs_log_level", 2);
console.log(g_LogLevelConfigurationEntry.Key);
// sourcejs_log_level
```

### `CVarConfigEntry.CreateHelpList`

```js
const { CVarConfigEntry } = require("config/cvar");

const g_LogLevelConfigurationEntry = new CVarConfigEntry("sourcejs_log_level", 2);
const g_AcceptedValuesList = g_LogLevelConfigurationEntry.CreateHelpList("Accepted values");
g_AcceptedValuesList.ExtendListItems(["0 - disabled", "1 - errors only", "2 - informational messages", "3 - debug messages"]);

console.log(g_LogLevelConfigurationEntry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n"));
```

### `CVarConfigEntry.RenderConfigEntry`

```js
const { CVarConfigEntry } = require("config/cvar");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs/gameplay");
const g_GravityConfigurationEntry = new CVarConfigEntry("sv_gravity", 800, "World gravity.");
const g_mapPreviousValues = new Map([["sv_gravity", "600"]]);
const g_vecConfigurationLines = g_GravityConfigurationEntry.RenderConfigEntry(g_ConfigurationManager, g_mapPreviousValues);
console.log(g_vecConfigurationLines.join("\n"));
```

### `CVarConfigEntry.AddHelpText`

```js
const { CVarConfigEntry } = require("config/cvar");

const g_LoggingEnabledConfigurationEntry = new CVarConfigEntry("sourcejs_logging_enabled", true);
g_LoggingEnabledConfigurationEntry.AddHelpText(["Set to 1 to emit plugin logs.", "Set to 0 to silence all non-error output."]);

console.log(g_LoggingEnabledConfigurationEntry.RenderConfigEntry({ CommentPrefix: "//" }).join("\n"));
```

### `CVarConfigListManager.AppendListItem`

```js
const { CVarConfigListManager } = require("config/cvar");

const g_LogLevelsList = new CVarConfigListManager("Allowed log levels");
g_LogLevelsList.AppendListItem("0 - disabled");
g_LogLevelsList.AppendListItem("1 - errors only");

console.log(g_LogLevelsList.RenderList({ CommentPrefix: "//" }).join("\n"));
```

### `CVarConfigListManager.ExtendListItems`

```js
const { CVarConfigListManager } = require("config/cvar");

const g_LogLevelsList = new CVarConfigListManager("Allowed log levels");
g_LogLevelsList.ExtendListItems(["0 - disabled", "1 - errors only", "2 - informational messages"]);

console.log(g_LogLevelsList.Items.join(", "));
```

### `CVarConfigListManager.RenderList`

```js
const { CVarConfigListManager } = require("config/cvar");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs/logging");
const g_LogLevelsList = new CVarConfigListManager("Allowed log levels", { ItemMarker: "- ", Indent: 2 });
g_LogLevelsList.ExtendListItems(["disabled", "errors", "info", "debug"]);

console.log(g_LogLevelsList.RenderList(g_ConfigurationManager).join("\n"));
```

### `CVarConfigListManager[Symbol.iterator]`

```js
const { CVarConfigListManager } = require("config/cvar");

const g_LogLevelsList = new CVarConfigListManager("Allowed log levels");
g_LogLevelsList.ExtendListItems(["disabled", "errors", "info", "debug"]);

for (const strLevel of g_LogLevelsList) {
	console.log(strLevel);
}
```

## Safe use

When both translation methods exist, `GetTranslation()` takes precedence. Its exceptions or non-string results do not trigger a fallback to `GetString()`. An empty description string produces no description lines.

CVar names must be non-empty strings without whitespace; unlike list headings, they do not accept translation objects. `FormatConfigValue(...)` accepts strings, booleans, finite numbers, `null`, and `undefined`. `ResolveConfigText(...)` accepts only strings or objects whose `GetTranslation()` or `GetString()` returns a string; it does not perform scalar conversion. `NormalizeDescription(...)` accepts these text forms, arrays of them, or `null`/`undefined` for no description. Non-array text is split into lines; array elements are not split further.

Public properties are live PascalCase fields, not snapshots or legacy prefixed aliases. Prefer constructor options and `AddHelpText(...)`/`CreateHelpList(...)` over manually mutating those fields. `ValueMinimum`, `ValueMaximum`, and `Flags` supply comments only: they do not enforce ranges, clamp values, or install engine flags. Construction does not validate that a default value can be formatted; rendering may throw later. Rendering returns text and does not itself create or update an engine CVar.

Rendering entries, help lines, and lists requires a non-null, non-array manager object with a string `CommentPrefix`; there is no legacy prefixed-field fallback. The returned line arrays are fresh, while nested help-list objects remain live. A preserved CVar value overrides the assignment, but does not suppress default-value or range formatting; invalid comment metadata can still fail rendering.

Both constructors require a non-null, non-array `Options` object. List headings and items accept the same translation forms as `ResolveConfigText`. `ItemMarker` defaults to `"  * "`, and `Indent` defaults to `9`; indentation must be a nonnegative safe integer. Names/descriptions/items are resolved when added, not translated again on every render. `ExtendListItems` may keep earlier appended items when a later one fails; `AddHelpText` normalizes its entire input before appending.

Use trusted names, values, descriptions, and help text. Quoting escapes backslashes and double quotes but does not reject newlines; rendering is not a command-sanitization boundary. Avoid logging rendered configuration containing secrets. A list iterator reads the backing array; do not assume it is a snapshot when mutating the list during iteration.

## Related files

- [`config.md`](config.md) documents the combined public module and manager workflow.
- [`packages/sourcejs/config/cvar.js`](../../packages/sourcejs/config/cvar.js) implements this API.
- [`packages/sourcejs/config/manager.js`](../../packages/sourcejs/config/manager.js) owns ordered entries, rendering, file I/O, and execution.
