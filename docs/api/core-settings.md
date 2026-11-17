# `require("core/settings")`

> This page is maintained by hand. Examples use plugin-owned files below the SourceJS settings roots.

`Root` points to persistent SourceJS data settings. `ConfigurationRoot` points to `cfg/sourcejs` under the current game. The examples
build complete plugin-owned paths from those roots. `WriteTextFile()` creates missing parent directories before opening and
truncating the target file. Both native roots are converted to UTF-8 before JavaScript string creation, preserving native path
spelling and separators independently of the Windows active code page.

## Location and purpose

The JavaScript wrapper lives in [`packages/sourcejs/core/settings.js`](../../packages/sourcejs/core/settings.js) and resolves the
native object registered in [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). Use it for
small plugin-owned settings files when direct filesystem paths and boolean status results are preferable to the higher-level
`settings` storage API.

## Import

```js
const { ConfigurationRoot, ReadTextFile, Root, WriteTextFile } = require("core/settings");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`Root`](#root) | String | Absolute persistent settings path. |
| [`ConfigurationRoot`](#configurationroot) | String | Absolute `cfg/sourcejs` path. |
| [`DoesFileExist`](#doesfileexist) | Function | `DoesFileExist(strFilePath)` |
| [`ReadTextFile`](#readtextfile) | Function | `ReadTextFile(strFilePath)` |
| [`WriteTextFile`](#writetextfile) | Function | `WriteTextFile(strFilePath, strText)` |
| [`EnsureDirectoryExists`](#ensuredirectoryexists) | Function | `EnsureDirectoryExists(strDirectoryPath)` |

## Examples

### `ConfigurationRoot`

```js
const { ConfigurationRoot } = require("core/settings");

const g_strPluginConfigurationPath = `${ConfigurationRoot}/match-stats.cfg`;
console.log(`Match Stats configuration: ${g_strPluginConfigurationPath}`);
```

### `EnsureDirectoryExists`

```js
const { EnsureDirectoryExists, Root } = require("core/settings");

const g_strPluginSettingsDirectory = `${Root}/match-stats`;
if (!EnsureDirectoryExists(g_strPluginSettingsDirectory)) {
	throw new Error(`Unable to create ${g_strPluginSettingsDirectory}.`);
}
```

### `DoesFileExist`

```js
const { DoesFileExist, Root, WriteTextFile } = require("core/settings");

const g_strPluginSettingsDirectory = `${Root}/match-stats`;
const g_strStatePath = `${g_strPluginSettingsDirectory}/state.json`;
if (DoesFileExist(g_strStatePath)) {
	throw new Error(`Refusing to overwrite existing state at ${g_strStatePath}.`);
}

// Run without concurrent writers; the existence check is not an exclusive file creation.
const g_strMatchStateText = JSON.stringify({ Round: 3 });
if (!WriteTextFile(g_strStatePath, g_strMatchStateText)) {
	throw new Error(`Unable to persist ${g_strStatePath}.`);
}

if (!DoesFileExist(g_strStatePath)) {
	throw new Error(`Expected ${g_strStatePath} to exist.`);
}

console.log(`State file exists: ${g_strStatePath}`);
```

### `ReadTextFile`

```js
const { DoesFileExist, ReadTextFile, Root, WriteTextFile } = require("core/settings");

const g_strPluginSettingsDirectory = `${Root}/match-stats`;
const g_strStatePath = `${g_strPluginSettingsDirectory}/round-trip-state.json`;
if (DoesFileExist(g_strStatePath)) {
	throw new Error(`Refusing to overwrite existing state at ${g_strStatePath}.`);
}

// Run without concurrent writers; this check and write are not atomic.
const g_strMatchStateText = JSON.stringify({ Map: "c1m1_hotel", Round: 3 }, null, "\t");
if (!WriteTextFile(g_strStatePath, g_strMatchStateText)) {
	throw new Error(`Unable to persist ${g_strStatePath}.`);
}

const g_strPersistedMatchStateText = ReadTextFile(g_strStatePath);
if (typeof g_strPersistedMatchStateText !== "string") {
	throw new Error(`Unable to read ${g_strStatePath}.`);
}

if (g_strPersistedMatchStateText !== g_strMatchStateText) {
	throw new Error(`Unexpected state content in ${g_strStatePath}.`);
}

const g_MatchState = JSON.parse(g_strPersistedMatchStateText);
console.log(`Read round ${g_MatchState.Round} on ${g_MatchState.Map}.`);
```

### `Root`

```js
const { Root } = require("core/settings");

console.log(`Persistent SourceJS settings root: ${Root}`);
```

### `WriteTextFile`

```js
const { DoesFileExist, Root, WriteTextFile } = require("core/settings");

const g_strPluginSettingsDirectory = `${Root}/match-stats`;
const g_strStatePath = `${g_strPluginSettingsDirectory}/write-example.json`;
if (DoesFileExist(g_strStatePath)) {
	throw new Error(`Refusing to overwrite existing state at ${g_strStatePath}.`);
}

// Run without concurrent writers; this check and write are not atomic.
const g_strMatchStateText = JSON.stringify({ Map: "c1m1_hotel", Round: 3 }, null, "\t");
if (!WriteTextFile(g_strStatePath, g_strMatchStateText)) {
	throw new Error(`Unable to write ${g_strStatePath}.`);
}
```

## Safe use

- Use the public property spellings `Root` and `ConfigurationRoot` directly. Do not invent replacement exports or aliases for
  these unique names.
- Build plugin-owned paths below one of the provided roots. The native callbacks accept arbitrary paths and do not sandbox a
  caller to those roots.
- `DoesFileExist()` checks the local filesystem first and then the engine filesystem. Ordinary checks return a boolean; path
  conversion or an unavailable engine-filesystem interface can throw, while low-level context/encoding failures can leave no
  explicit result. One path argument is required; omitting it throws a type error.
- `ReadTextFile()` reads a local file as binary text and, for a valid path, returns `null` when the file cannot be opened.
- `WriteTextFile()` requires two arguments and converts the path and text before creating directories or opening the file.
  It creates missing parent directories and truncates the target; ordinary filesystem failures return `false`, while argument
  conversion can throw. Its boolean checks stream state after close but does not guarantee durability or atomic replacement.
- Use these write examples only for an absent plugin-owned file without concurrent writers. Existence checks do not reserve
  the path; the examples leave their file behind. Inspect and remove only your demonstration file before repeating them.
- File operations are synchronous on the calling thread and can occupy the game thread. They do not use the
  network/database `Options, Callback` request protocol. Keep file access bounded and avoid per-frame disk I/O.
- Native file helpers reject embedded NUL in paths with `TypeError`. Text uses explicit UTF-8 byte
  lengths and preserves embedded NUL characters; it is not a general binary-storage API. A failed write can leave directories,
  a truncated file, or partial output behind.
- `EnsureDirectoryExists()` creates all missing directory components and returns whether the final path is a directory.

## Related files

- [`packages/sourcejs/core/settings.js`](../../packages/sourcejs/core/settings.js) — JavaScript wrapper around the native object.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — native paths and filesystem
  callbacks.
- [`filesystem.md`](filesystem.md) — broader native filesystem API using the same callback family.
- [`settings.md`](settings.md) — higher-level settings storage and serialization.
