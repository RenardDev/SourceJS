# `require("memory/gamedata")`

> Warning: This is a dense API reference. AI agents should use the contents list and process one section at a time.

`memory/gamedata` locates and merges SourceJS ConfigObject-style INI files for one selected Source 1 SDK branch. It is used by memory layouts, global addresses, entity metadata, temporary entities, clients, and entity-output hooks.

The module reads files below `paths.SOURCE_DATA_ROOT`. It never scans binaries or resolves signatures itself; consumers pass the loaded records to [`memory/manager`](memory-manager.md).

KeyValues `.txt` files use a separate loader: [`memory/manager.LoadGameDataFile(strFilePath)`](memory-manager.md#loadgamedatafile). The manager looks under `memory/manager.DATA_ROOT` (`addons/sourcejs/gamedata`), not this module's `SOURCE_DATA_ROOT` (`addons/sourcejs/data/sourcejs`). Do not pass KeyValues text to `ParseConfigObject()` or expect `LoadGameData()` to search the manager root.

Before V8 and plugin initialization, SourceJS refreshes its managed GameData snapshot over HTTPS. The download waits for at most 10 seconds. An offline start or failed update uses the last complete snapshot if available. The installer does not include that snapshot, so features that rely on it may be unavailable on a first offline start.

The updater does not write SourceJS INI data or custom GameData. The active snapshot and its sibling directories with `.Previous` and `.Pending` suffixes are reserved for the updater. Keep overrides outside those directories or load them using an absolute path. A stale `.Pending` directory can block the next refresh if the server stops during an update. Remove only that directory after confirming no server is updating the same installation.

Relative `.txt` lookups prefer the active snapshot. Absolute paths and other file types use the ordinary manager lookup.
The file inventory reports the active copy of each relative file and omits staging and backup copies.

`HasGameData()` checks the filesystem synchronously, and `LoadGameData()` reads and parses existing files synchronously on cache misses. Run these operations during controlled setup or reload, not in latency-sensitive per-frame callbacks. Cache hits avoid file reads but still validate the current source-root value.

## Contents

- [Import](#import)
- [Profile Order](#profile-order)
- [Path API](#path-api)
- [Data API](#data-api)
- [Related APIs](#related-apis)

## Import

```js
const {
	ClearGameDataCache,
	GetGameDataGroups,
	GetGameDataPath,
	GetGameDataPaths,
	HasGameData,
	LoadGameData,
	ParseConfigObject,
} = require("memory/gamedata");

const g_vecGameDataOperations = [
	ClearGameDataCache,
	GetGameDataGroups,
	GetGameDataPath,
	GetGameDataPaths,
	HasGameData,
	LoadGameData,
	ParseConfigObject,
];

for (const GameDataOperation of g_vecGameDataOperations) {
	if (typeof GameDataOperation !== "function") {
		throw new Error("memory/gamedata export is not callable.");
	}
}
```

## Profile Order

Every lookup starts with the common file at `<SOURCE_DATA_ROOT>/<kind>/<file-name>`. Branch groups are appended in order, and later files override matching values from earlier files.

| Kind | Group selection | Typical data |
| --- | --- | --- |
| `client` | Engine family | `CBaseClient.ini` |
| `effects` | Engine and game family | Temporary-entity fields |
| `entities` | Engine and game family | Entity classes and properties |
| `entityOutputs` | Engine family | `CBaseEntityOutput.ini` |
| `memory` | Engine family | `GlobalAddresses.ini` |

Omitting `strSDKBranch` reads the current value from `globals.GetGlobalVariables().SDKBranch`. Unknown kinds, unsupported branches, unsafe relative paths, and non-string INI text throw immediately. Source 2 branch names are unsupported.

## Path API

### `GetGameDataGroups`

`GetGameDataGroups(strGameDataKind, strSDKBranch = GetActiveSDKBranch())` returns a new array containing the branch-specific groups in merge order. A game-specific group, when present, follows its engine-family group.

```js
const { GetGlobalVariables } = require("globals");
const { GetGameDataGroups } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_vecGameDataGroups = GetGameDataGroups("entities", g_strSDKBranch);
const g_vecFreshGameDataGroups = GetGameDataGroups("entities", g_strSDKBranch);

function IsValidGameDataGroup(strGameDataGroup) {
	return (typeof strGameDataGroup === "string") && (strGameDataGroup.length > 0);
}

if ((g_vecGameDataGroups === g_vecFreshGameDataGroups) || (g_vecGameDataGroups.length === 0) || !g_vecGameDataGroups.every(IsValidGameDataGroup) || (g_vecGameDataGroups.join("\n") !== g_vecFreshGameDataGroups.join("\n"))) {
	throw new Error(`Invalid ${g_strSDKBranch} entity group order.`);
}

g_vecGameDataGroups.push("SourceJSDocumentationProbe");
if (GetGameDataGroups("entities", g_strSDKBranch).includes("SourceJSDocumentationProbe")) {
	throw new Error("GetGameDataGroups() returned shared mutable storage.");
}
```

### `GetGameDataPath`

`GetGameDataPath(strGameDataKind, strGameDataGroup, strDataFileName)` joins the current SourceJS data root with a validated relative group and file name. Group and file-name strings are trimmed first. An empty group addresses the common file; otherwise `strGameDataGroup` must be a normalized relative path without leading, trailing, or repeated `/`, backslashes, colons, or `.`/`..` segments. `strDataFileName` must be a non-empty single file name without `/`, `\`, or `:`, and cannot be `.` or `..`. Non-string inputs and an empty file name raise `TypeError`; invalid relative-path shapes raise `RangeError`. This is lexical path validation, not a filesystem or symlink-containment check.

Source-root separators are normalized to `/`. A leading UNC `//` pair is preserved; duplicated separators elsewhere are collapsed.

```js
const { DoesFileExist } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { GetGameDataGroups, GetGameDataPath } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_vecGameDataGroups = GetGameDataGroups("memory", g_strSDKBranch);
const g_strGameDataFilePath = GetGameDataPath("memory", g_vecGameDataGroups[0], "GlobalAddresses.ini");
if (!DoesFileExist(g_strGameDataFilePath)) {
	throw new Error(`Required ${g_strSDKBranch} address data is missing: ${g_strGameDataFilePath}.`);
}

if (!g_strGameDataFilePath.endsWith(`/memory/${g_vecGameDataGroups[0]}/GlobalAddresses.ini`)) {
	throw new Error(`Unexpected normalized GameData path: ${g_strGameDataFilePath}.`);
}
```

### `GetGameDataPaths`

`GetGameDataPaths(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch())` returns every candidate path in exact merge order. It reads the current `paths.SOURCE_DATA_ROOT` value once per call. Paths are returned whether or not the corresponding file exists.

```js
const { GetGlobalVariables } = require("globals");
const { GetGameDataGroups, GetGameDataPath, GetGameDataPaths } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_vecGameDataGroups = GetGameDataGroups("memory", g_strSDKBranch);
const g_vecCandidatePaths = GetGameDataPaths("memory", "GlobalAddresses.ini", g_strSDKBranch);

function GetGameDataGroupPath(strGameDataGroup) {
	return GetGameDataPath("memory", strGameDataGroup, "GlobalAddresses.ini");
}

const g_vecExpectedPaths = [
	GetGameDataPath("memory", "", "GlobalAddresses.ini"),
	...g_vecGameDataGroups.map(GetGameDataGroupPath),
];

function IsExpectedGameDataPath(strGameDataFilePath, unCandidateIndex) {
	return strGameDataFilePath === g_vecExpectedPaths[unCandidateIndex];
}

if ((g_vecCandidatePaths.length !== g_vecExpectedPaths.length) || !g_vecCandidatePaths.every(IsExpectedGameDataPath)) {
	throw new Error(`Unexpected ${g_strSDKBranch} address path order.`);
}
```

## Data API

### `HasGameData`

`HasGameData(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch())` reports whether at least one candidate file exists. It calls the current live `filesystem.DoesFileExist()` method and requires a boolean result. Use it before loading optional profile data.

```js
const { DoesFileExist } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { GetGameDataPaths, HasGameData } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_vecCandidatePaths = GetGameDataPaths("memory", "GlobalAddresses.ini", g_strSDKBranch);
const g_bCandidateFileExists = g_vecCandidatePaths.some(DoesFileExist);
const g_bHasGameData = HasGameData("memory", "GlobalAddresses.ini", g_strSDKBranch);
if (g_bCandidateFileExists !== g_bHasGameData) {
	throw new Error("HasGameData() disagrees with the current candidate files.");
}

if (!g_bHasGameData) {
	throw new Error(`This installation is missing ${g_strSDKBranch} global-address data.`);
}
```

### `LoadGameData`

`LoadGameData(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch())` parses every existing candidate, recursively merges its sections, and returns the live cached object. The parser uppercases an initial lowercase letter and removes `_` before a lowercase letter or digit while uppercasing that character; other characters are preserved. For example, the input key `identifier_windows` becomes the `IdentifierWindows` property.

Cache identity includes the validated source-root string from `paths.SOURCE_DATA_ROOT`, data kind, SDK branch, and file name. Every call reads and validates the root once, including cache hits; a cache miss uses that same root snapshot for all candidate paths. Switching roots selects an independent cached object, and switching back reuses the earlier one until `ClearGameDataCache()` is called. Cache hits do not re-read files.

```js
const { GetGlobalVariables } = require("globals");
const { HasGameData, LoadGameData } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_GlobalAddresses = LoadGameData("memory", "GlobalAddresses.ini", g_strSDKBranch);
if ((g_GlobalAddresses === null) || (typeof g_GlobalAddresses !== "object") || Array.isArray(g_GlobalAddresses) || (LoadGameData("memory", "GlobalAddresses.ini", g_strSDKBranch) !== g_GlobalAddresses)) {
	throw new Error("LoadGameData() did not return one live cached object.");
}

const g_vecDescriptorNames = Object.keys(g_GlobalAddresses);
if (HasGameData("memory", "GlobalAddresses.ini", g_strSDKBranch) && (g_vecDescriptorNames.length === 0)) {
	throw new Error(`The ${g_strSDKBranch} global-address profile is empty.`);
}

for (const strDescriptorName of g_vecDescriptorNames) {
	const Descriptor = g_GlobalAddresses[strDescriptorName];
	if ((Descriptor === null) || (typeof Descriptor !== "object") || Array.isArray(Descriptor)) {
		throw new Error(`Invalid global-address descriptor: ${strDescriptorName}.`);
	}

	if (Object.hasOwn(Descriptor, "Binary") && ((typeof Descriptor.Binary !== "string") || (Descriptor.Binary.length === 0))) {
		throw new Error(`Invalid binary in global-address descriptor: ${strDescriptorName}.`);
	}
}
```

If no candidate file exists for a supported kind and branch, `LoadGameData()` returns a live empty object. It never substitutes data from another SDK branch.

### `ClearGameDataCache`

`ClearGameDataCache()` discards every merged object and returns `true`. Existing object references remain ordinary JavaScript objects, while the next `LoadGameData()` creates a fresh record from disk. Clear the cache only at a controlled reload boundary.

```js
const { GetGlobalVariables } = require("globals");
const { ClearGameDataCache, LoadGameData } = require("memory/gamedata");

const g_strSDKBranch = GetGlobalVariables().SDKBranch;
const g_FirstGameData = LoadGameData("memory", "GlobalAddresses.ini", g_strSDKBranch);
const g_strProbeName = "SourceJSDocumentationProbe";
if (Object.hasOwn(g_FirstGameData, g_strProbeName)) {
	throw new Error(`GameData already contains reserved probe ${g_strProbeName}.`);
}

try {
	g_FirstGameData[g_strProbeName] = { Active: true };
	if ((LoadGameData("memory", "GlobalAddresses.ini", g_strSDKBranch) !== g_FirstGameData) || (g_FirstGameData[g_strProbeName].Active !== true)) {
		throw new Error("GameData cache identity changed before ClearGameDataCache().");
	}
} finally {
	delete g_FirstGameData[g_strProbeName];
}

if (!ClearGameDataCache()) {
	throw new Error("GameData cache cleanup failed.");
}

const g_ReloadedGameData = LoadGameData("memory", "GlobalAddresses.ini", g_strSDKBranch);
if ((g_ReloadedGameData === g_FirstGameData) || Object.hasOwn(g_ReloadedGameData, g_strProbeName)) {
	throw new Error("GameData was not reloaded from disk.");
}
```

### `ParseConfigObject`

`ParseConfigObject(strGameDataText)` parses ConfigObject-style sections, nested sections, `#` comments, booleans, safe decimal and hexadecimal integers, comma-separated arrays, and quoted values. It uppercases an initial lowercase letter and removes `_` before a lowercase letter or digit while uppercasing that character; other characters are preserved. Thus, the input key `identifier_windows` becomes `IdentifierWindows`. Malformed assignments, unterminated quotes, section declarations that collide with an existing non-record value, empty keys, and integers outside JavaScript's safe range throw immediately. It does not read or cache a file.

Quoting protects commas and `#` from splitting or comment removal, but does not disable scalar conversion: `"true"` becomes boolean `true`, and `"20"` becomes number `20`. Backslash escapes are retained, not decoded. Comma-separated arrays omit empty scalar entries; without a separator, an empty value remains `""`.

```js
const { ParseConfigObject } = require("memory/gamedata");

const g_ParsedDescriptor = ParseConfigObject(`
[ExampleFunction]
binary = server
identifier_windows = "55 8B EC"
offset_windows = 20
enabled = true
[[signature]]
arguments = address, int
`);
const g_ExampleFunction = g_ParsedDescriptor.ExampleFunction;
if ((g_ExampleFunction.Binary !== "server") || (g_ExampleFunction.IdentifierWindows !== "55 8B EC") || (g_ExampleFunction.OffsetWindows !== 20) || (g_ExampleFunction.Enabled !== true)) {
	throw new Error("Scalar GameData values were not parsed correctly.");
}

if (g_ExampleFunction.Signature.Arguments.join(",") !== "address,int") {
	throw new Error("Nested GameData arguments were not parsed correctly.");
}
```

## Related APIs

- [`filesystem`](filesystem.md)
- [`globals`](globals.md)
- [`memory/manager`](memory-manager.md)
- [`paths`](paths.md)
