# `require("settings")`

> AI processing note: this page documents the direct synchronous settings filesystem surface. Keep physical-file reads, engine-assisted existence checks and caller-owned path policy distinct.

`settings` initializes `Root` to `<game>/addons/sourcejs/data/settings` and exposes four native text-filesystem operations. It is intended for small persistent plugin configuration and state files; it does not add a sandbox, schema layer, transaction or lock.

The native `Root` path is converted to UTF-8 before JavaScript string creation, preserving native spelling and separators.
Physical path arguments are decoded from UTF-8 independently of the Windows active code page.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Build Owned Paths](#build-owned-paths)
- [Prepare A Directory](#prepare-a-directory)
- [Write JSON Settings](#write-json-settings)
- [Read JSON Settings](#read-json-settings)
- [Errors And Return Values](#errors-and-return-values)
- [Lifecycle And Safety](#lifecycle-and-safety)
- [Related Modules](#related-modules)

## Import

```js
const {
	EnsureDirectoryExists,
	DoesFileExist,
	ReadTextFile,
	Root,
	WriteTextFile,
} = require("settings");
```

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| `Root` | `string` | Writable module field initially containing SourceJS's physical settings-directory path for the current game. |
| `EnsureDirectoryExists(strDirectoryPath)` | `boolean` | Creates the physical directory tree and verifies that the final path is a directory. |
| `DoesFileExist(strFilePath)` | `boolean` | Checks operating-system existence first, then Source's `IFileSystem`; a physical directory also counts as existing. |
| `ReadTextFile(strFilePath)` | `string \| null` | Reads a physical file in binary mode and decodes its bytes as UTF-8, or returns `null` when it cannot be opened. |
| `WriteTextFile(strFilePath, strText)` | `boolean` | Creates physical parent directories, truncates the file and writes the UTF-8 encoding of the string. |

All four functions are synchronous. The native callbacks convert supplied path/text values to strings; an omitted required argument throws.

`Root` is JavaScript module state, not a setter for native path discovery. Reassigning it affects later field reads,
including `settings/storage.ROOT`, but does not relocate runtime directories or rewrite explicit path arguments.
Destructuring `Root` captures its current string; it does not create a live binding.

## Build Owned Paths

The native API accepts paths exactly as supplied and does not force them below `Root`. Keep each plugin inside a stable child directory and reject separators in caller-selected filenames:

```js
const { Root } = require("settings");

function GetMatchSettingsPath(strFileName) {
	if ((typeof strFileName !== "string") || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(strFileName)) {
		throw new TypeError("A simple match-settings filename is required.");
	}

	return `${Root}/match-control/${strFileName}`;
}

module.exports = { GetMatchSettingsPath };
```

Forward slashes are accepted by the supported Windows and Linux filesystem paths. Do not concatenate untrusted `../`, absolute paths or separators into a privileged server path.
The filename check is not a sandbox: symbolic links, platform-reserved filenames and filesystem permissions remain
the owner's responsibility. Converted paths containing an embedded NUL are rejected with `TypeError` before filesystem access.

## Prepare A Directory

`WriteTextFile()` already creates missing parents, but an explicit preparation step detects a conflicting file at the directory path before a larger workflow starts:

```js
const { EnsureDirectoryExists, Root } = require("settings");

function PrepareMatchSettingsDirectory() {
	const strDirectoryPath = `${Root}/match-control`;
	if (EnsureDirectoryExists(strDirectoryPath) !== true) {
		throw new Error(`Could not prepare settings directory: ${strDirectoryPath}`);
	}

	return strDirectoryPath;
}

module.exports = { PrepareMatchSettingsDirectory };
```

`EnsureDirectoryExists()` returns `true` when the directory already exists or was created. It returns `false` on a filesystem error or when the final path exists but is not a directory.

## Write JSON Settings

Serialize and validate the schema explicitly. The function below owns one plugin directory, captures each input
property once, and returns the exact path/text that reached `WriteTextFile()`. Getter exceptions propagate before
filesystem work; inherited properties are accepted, while unknown properties are ignored:

```js
const {
	EnsureDirectoryExists,
	Root,
	WriteTextFile,
} = require("settings");

function SaveMatchSettings(strFileName, Settings) {
	if ((typeof strFileName !== "string") || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(strFileName)) {
		throw new TypeError("A simple match-settings filename is required.");
	}

	if ((Settings === null) || (typeof Settings !== "object") || Array.isArray(Settings)) {
		throw new TypeError("Match settings must be an object.");
	}

	const bAutoReady = Settings.AutoReady;
	if (typeof bAutoReady !== "boolean") {
		throw new TypeError("Settings.AutoReady must be a boolean.");
	}

	const unMinimumPlayers = Settings.MinimumPlayers;
	if (!Number.isInteger(unMinimumPlayers) || (unMinimumPlayers < 1)) {
		throw new RangeError("Settings.MinimumPlayers must be a positive integer.");
	}

	const strDirectoryPath = `${Root}/match-control`;
	const strFilePath = `${strDirectoryPath}/${strFileName}`;
	const StoredSettings = {
		AutoReady: bAutoReady,
		MinimumPlayers: unMinimumPlayers,
	};
	const strText = `${JSON.stringify(StoredSettings, null, 2)}\n`;

	if (EnsureDirectoryExists(strDirectoryPath) !== true) {
		throw new Error(`Could not prepare settings directory: ${strDirectoryPath}`);
	}

	if (WriteTextFile(strFilePath, strText) !== true) {
		throw new Error(`Could not write settings file: ${strFilePath}`);
	}

	return { FilePath: strFilePath, Text: strText };
}

module.exports = { SaveMatchSettings };
```

`WriteTextFile()` opens the physical file in binary truncate mode. A `false` result can represent parent-directory creation, file-open or stream-write failure.

## Read JSON Settings

`DoesFileExist()` can see engine/VPK resources that `ReadTextFile()` cannot open. Treat `DoesFileExist() === true` followed by `ReadTextFile() === null` as a distinct failure instead of silently replacing a known resource with defaults:

```js
const {
	DoesFileExist,
	ReadTextFile,
	Root,
} = require("settings");

function LoadMatchSettings(strFileName) {
	if ((typeof strFileName !== "string") || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(strFileName)) {
		throw new TypeError("A simple match-settings filename is required.");
	}

	const strFilePath = `${Root}/match-control/${strFileName}`;
	if (DoesFileExist(strFilePath) !== true) {
		return null;
	}

	const strText = ReadTextFile(strFilePath);
	if (strText === null) {
		throw new Error(`Known settings path is not a readable physical file: ${strFilePath}`);
	}

	const Settings = JSON.parse(strText);
	if ((Settings === null) || (typeof Settings !== "object") || Array.isArray(Settings)) {
		throw new TypeError("Stored match settings must be an object.");
	}

	if (typeof Settings.AutoReady !== "boolean") {
		throw new TypeError("Stored Settings.AutoReady must be a boolean.");
	}

	if (!Number.isInteger(Settings.MinimumPlayers) || (Settings.MinimumPlayers < 1)) {
		throw new RangeError("Stored Settings.MinimumPlayers must be a positive integer.");
	}

	return {
		AutoReady: Settings.AutoReady,
		MinimumPlayers: Settings.MinimumPlayers,
	};
}

module.exports = { LoadMatchSettings };
```

`JSON.parse()` syntax errors propagate normally. A missing path returns `null`, while malformed or unreadable known content throws so the caller can distinguish absence from corruption.

## Errors And Return Values

- Missing required arguments throw the shared native callback errors, such as `filesystem.ReadTextFile(strFilePath) expects a path.`, because `settings` uses those callbacks directly.
- Supplied arguments are converted to strings by V8 rather than being restricted to JavaScript string values. Validate public plugin inputs before calling the native functions.
- An embedded NUL in a converted path throws `TypeError`; paths are not silently truncated. Shared callback diagnostics retain the `filesystem` prefix.
- `EnsureDirectoryExists()` and `WriteTextFile()` report ordinary filesystem failure with `false`.
- `ReadTextFile()` reports an unopenable physical path with `null`; it does not query `IFileSystem` or VPK contents.
- The read callback does not check the final stream status, so a returned string is not proof that every byte was
  read. UTF-8 text conversion is not a lossless arbitrary-byte API; use byte-oriented `filesystem` operations for binary data.
- If an operating-system existence check fails, `DoesFileExist()` requires the connected engine filesystem and propagates its interface error when unavailable.

## Lifecycle And Safety

`Root` is installed as a string when the plugin runtime context is created. The module has no open handles and needs no unload callback, but every operation blocks the game thread until its filesystem work completes.

Writes are truncating, non-transactional and unlocked. Coordinate shared files through one owning plugin, keep files small and do not present `WriteTextFile()` as crash-safe replacement; the current public [`filesystem`](filesystem.md) API does not expose a rename operation.

## Related Modules

- [`settings/menu`](settings-menu.md) builds menus for standalone registered settings.
- [`settings/player`](settings-player.md) owns per-player setting registries.
- [`settings/storage`](settings-storage.md) supplies higher-level storage classes.
- [`settings/types`](settings-types.md) defines typed setting values.
- [`filesystem`](filesystem.md) exposes handles, bytes and explicit file operations.
- [`paths`](paths.md) exposes other fixed SourceJS runtime roots.
