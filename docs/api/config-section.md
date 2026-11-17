# `require("config/section")`

> Warning: this API reference is maintained by hand. Keep examples synchronized with the implementation.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`ConfigSectionManager`](#configsectionmanager)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/config/section.js`](../../packages/sourcejs/config/section.js). It creates three comment-prefixed strings used to separate named sections in generated Source-style configuration files. Use single-line names and separators to obtain three physical lines. Use it directly for standalone rendering or through `ConfigManager.AddConfigSection()` when a manager owns the complete file.

## Import

```js
const { ConfigSectionManager, CreateConfigSection } = require("config/section");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`ConfigSectionManager`](#configsectionmanager-1) | Class | `new ConfigSectionManager(Name, Options = {})`; name accepts a string or a translation object returning a string. |
| [`CreateConfigSection`](#createconfigsection) | Function | `CreateConfigSection(Name, Options = {})`; returns a new `ConfigSectionManager`. |

## `ConfigSectionManager`

| Member | Signature |
| --- | --- |
| `Name` | Writable property containing the heading rendered between the separator lines. |
| `Separator` | Writable property containing the text repeated to form each separator line. |
| `Width` | Writable property containing the number of separator repetitions to render. |
| [`RenderConfigEntry`](#configsectionmanagerrenderconfigentry) | `RenderConfigEntry(ConfigurationManager = null)`; returns a new array of three strings. With no manager, uses `//`; otherwise requires a string `CommentPrefix`, without a legacy prefixed-field fallback. |

## Examples

### `ConfigSectionManager`

```js
const { ConfigSectionManager } = require("config/section");

const g_MovementConfigurationSection = new ConfigSectionManager("Movement", { Separator: "=", Width: 48 });
console.log(g_MovementConfigurationSection.RenderConfigEntry().join("\n"));
```

### `ConfigSectionManager` properties

```js
const { ConfigSectionManager } = require("config/section");

const g_RuntimeConfigurationSection = new ConfigSectionManager("Runtime controls", { Separator: "=", Width: 48 });
console.log(JSON.stringify({ Name: g_RuntimeConfigurationSection.Name, Separator: g_RuntimeConfigurationSection.Separator, Width: g_RuntimeConfigurationSection.Width }));

console.log(g_RuntimeConfigurationSection.RenderConfigEntry().join("\n"));
```

### `CreateConfigSection`

```js
const { CreateConfigSection } = require("config/section");

const g_LoggingConfigurationSection = CreateConfigSection("Plugin logging", { Separator: "-", Width: 60 });
console.log(g_LoggingConfigurationSection.RenderConfigEntry().join("\n"));
```

### `ConfigSectionManager.RenderConfigEntry`

```js
const { ConfigSectionManager } = require("config/section");
const { ConfigManager } = require("config/manager");

const g_ConfigurationManager = new ConfigManager("sourcejs_gameplay");
const g_MovementConfigurationSection = new ConfigSectionManager("Movement", { Separator: "=", Width: 48 });
const g_vecConfigurationLines = g_MovementConfigurationSection.RenderConfigEntry(g_ConfigurationManager);
console.log(g_vecConfigurationLines.join("\n"));
```

## Safe use

- Pass a non-empty name and separator plus a safe integer `Width` of at least `8`; invalid constructor input throws `TypeError`. `Options` must be a non-null, non-array object. The default separator is `"-"`, and the default width is `79`; nullish option fields use those defaults.
- Width counts separator repetitions, not characters or display columns. Multi-character separators multiply the output length. Choose a bounded width appropriate for the application: passing integer validation does not guarantee that the resulting string fits the runtime's allocation limits.
- Names are resolved once during construction using `ResolveConfigText` from [`config/cvar`](config-cvar.md). `GetTranslation()` takes precedence over `GetString()`; a translation error or non-string result does not trigger a fallback.
- Public properties are live PascalCase fields, not snapshots or legacy prefixed aliases. Configure section state through constructor options: direct property writes are not revalidated during rendering and may change the output or throw. Each render returns a fresh array.
- Pass `null`/`undefined` or omit the manager for `//`, or pass a non-array object whose `CommentPrefix` is a string. A real `ConfigManager` is accepted but not required; an invalid manager or prefix throws `TypeError`. There is no legacy prefixed-field fallback.
- Names, separators, and comment prefixes are inserted without newline sanitization. Use trusted single-line strings when generating executable configuration files; embedded newlines can introduce uncommented text. Rendering only returns strings and does not write files or execute commands.

## Related files

- [`packages/sourcejs/config/section.js`](../../packages/sourcejs/config/section.js) contains the implementation documented here.
- [`config-manager.md`](config-manager.md) documents the manager that owns and renders section entries.
- [`config.md`](config.md) describes the aggregate configuration API.
