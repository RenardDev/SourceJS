# `require("paths")`

> AI navigation: use the contents below to read only the current contract or example section; paths are locations, not validation or ownership grants.

> Warning: these 35 initial values define shared runtime ownership boundaries. Restore temporary edits, create plugin-specific children below writable roots, and refuse to overwrite an existing file in examples or plugin migrations.

The `paths` module exposes runtime locations owned or recognized by SourceJS. Use these values instead of deriving the game directory from `__dirname`, embedding `addons/sourcejs`, or assuming Windows drive letters. The JavaScript facade lives in [`packages/sourcejs/paths.js`](../../packages/sourcejs/paths.js), while [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) populates the native object. Physical path operations are documented in [`filesystem`](filesystem.md).

## Contents

- [Import](#import)
- [Behavior](#behavior)
- [Game and SourceJS roots](#game-and-sourcejs-roots)
- [Data and configuration](#data-and-configuration)
- [Packages and documentation](#packages-and-documentation)
- [Resources](#resources)
- [Authorization](#authorization)
- [Update staging](#update-staging)
- [Examples](#examples)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	ADDON_ROOT,
	AUTH_CONFIG_ROOT,
	AUTH_PARENTS_FILE,
	AUTH_PLAYERS_FILE,
	AUTH_SIMPLE_FILE,
	AUTH_SQL_FILE,
	BACKEND_CONFIG_FILE,
	BACKEND_ROOT,
	BASE_ROOT,
	CONFIG_ROOT,
	CUSTOM_DATA_ROOT,
	CUSTOM_PACKAGE_DOCS_ROOT,
	CUSTOM_PACKAGE_ROOT,
	DATA_ROOT,
	DOCS_ROOT,
	EVENT_ROOT,
	EXTENSION_ROOT,
	GAME_ROOT,
	LANGUAGE_FILE,
	LOG_ROOT,
	PACKAGE_ROOT,
	PLUGIN_DATA_ROOT,
	PLUGIN_DOCS_ROOT,
	PLUGIN_ROOT,
	SITE_PACKAGE_ROOT,
	SOUND_ROOT,
	SOURCE_DATA_ROOT,
	SOURCE_DOCS_ROOT,
	SOURCE_PACKAGE_ROOT,
	TRANSLATION_CORE_FILE,
	TRANSLATION_CORE_ROOT,
	TRANSLATION_ROOT,
	UPDATE_DATA_ROOT,
	UPDATE_ROOT,
	UPDATE_SOURCE_DATA_ROOT,
} = require("paths");

const g_unExpectedRuntimePathCount = 35;
const g_vecRuntimePaths = [
	ADDON_ROOT,
	AUTH_CONFIG_ROOT,
	AUTH_PARENTS_FILE,
	AUTH_PLAYERS_FILE,
	AUTH_SIMPLE_FILE,
	AUTH_SQL_FILE,
	BACKEND_CONFIG_FILE,
	BACKEND_ROOT,
	BASE_ROOT,
	CONFIG_ROOT,
	CUSTOM_DATA_ROOT,
	CUSTOM_PACKAGE_DOCS_ROOT,
	CUSTOM_PACKAGE_ROOT,
	DATA_ROOT,
	DOCS_ROOT,
	EVENT_ROOT,
	EXTENSION_ROOT,
	GAME_ROOT,
	LANGUAGE_FILE,
	LOG_ROOT,
	PACKAGE_ROOT,
	PLUGIN_DATA_ROOT,
	PLUGIN_DOCS_ROOT,
	PLUGIN_ROOT,
	SITE_PACKAGE_ROOT,
	SOUND_ROOT,
	SOURCE_DATA_ROOT,
	SOURCE_DOCS_ROOT,
	SOURCE_PACKAGE_ROOT,
	TRANSLATION_CORE_FILE,
	TRANSLATION_CORE_ROOT,
	TRANSLATION_ROOT,
	UPDATE_DATA_ROOT,
	UPDATE_ROOT,
	UPDATE_SOURCE_DATA_ROOT,
];
const g_bHasInvalidRuntimePathCount = g_vecRuntimePaths.length !== g_unExpectedRuntimePathCount;
const g_bHasNonAbsoluteRuntimePath = g_vecRuntimePaths.some((strRuntimePath) => {
	const bHasRuntimePathString = (typeof strRuntimePath === "string") && (strRuntimePath.length > 0);
	const bHasUnixRuntimeRoot = bHasRuntimePathString && strRuntimePath.startsWith("/");
	const bHasUNCRuntimeRoot = bHasRuntimePathString && strRuntimePath.startsWith("\\\\");
	const bHasWindowsDriveRuntimeRoot = bHasRuntimePathString && /^[A-Za-z]:[\\/]/.test(strRuntimePath);

	return !bHasUnixRuntimeRoot && !bHasUNCRuntimeRoot && !bHasWindowsDriveRuntimeRoot;
});

if (g_bHasInvalidRuntimePathCount || g_bHasNonAbsoluteRuntimePath) {
	throw new Error(`The paths module did not expose all ${g_unExpectedRuntimePathCount} absolute runtime locations.`);
}
```

The module exports the exact editable native object without copying or freezing it. Destructuring an exported string captures that value; it is not a live binding to later property assignments. All 35 initial values are strings derived lexically from the initialized game root. Native path text is converted to UTF-8 before creating JavaScript strings, preserving the selected operating system's spelling and separators rather than using the Windows active code page. Native initialization resolves empty roots to the working directory and relative roots with the operating system's absolute-path rules, including Windows drive-relative and root-relative paths; absolute UNC roots keep their prefix. This is lexical resolution, not an existence check or symlink lookup. The native exporter does not independently validate the strings, and the import example defensively rejects malformed values. Reassignment is immediately visible to JavaScript modules that read a path at operation time, but it does not relocate directories retained internally by the engine or C++ runtime. Restore every temporary override in `finally` and do not use shared path mutation as a substitute for plugin-specific child directories.

The module does not create optional directories. A presence check is not proof of writability, safe ownership, or atomic file creation; `DoesFileExist()` can also fall back to the engine filesystem. Use `filesystem.EnsureDirectoryExists()` before writing to a directory that may not exist. Physical filesystem helpers accept `/` as a child separator on both supported platforms, so examples append controlled relative names with template strings.

## Behavior

- `GAME_ROOT` is the active game's content directory, such as `left4dead2` or `tf`.
- `ADDON_ROOT` is the shared Source addons root `<GAME_ROOT>/addons`.
- `BASE_ROOT` is the SourceJS installation root `<ADDON_ROOT>/sourcejs`.
- Paths do not carry VPK search-path semantics. Use `filesystem.OpenSourceFile()` or `filesystem.SourceFile.OpenSourceFile()` for engine-visible files.
- A path's presence does not imply that the directory or file already exists. Custom, documentation, log, and update locations are commonly created on demand.
- SourceJS owns names under its own roots. A plugin should normally create a plugin-specific child directory rather than writing directly into a shared root.

## Game and SourceJS roots

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `GAME_ROOT` | Active game directory | Game-relative resources, `cfg`, `logs`, and engine content. |
| `ADDON_ROOT` | `<GAME_ROOT>/addons` | Parent directory shared by Source addons. |
| `BASE_ROOT` | `<ADDON_ROOT>/sourcejs` | SourceJS installation and runtime content. |
| `PLUGIN_ROOT` | `<BASE_ROOT>/plugins` | Installed JavaScript plugins. |
| `EXTENSION_ROOT` | `<BASE_ROOT>/extensions` | Installed native SourceJS extensions. |

`ADDON_ROOT` deliberately names the shared addons directory, while `BASE_ROOT` names its SourceJS-specific `sourcejs` child.

## Data and configuration

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `DATA_ROOT` | `<BASE_ROOT>/data` | Shared root for persistent SourceJS data and runtime state. |
| `SOURCE_DATA_ROOT` | `<DATA_ROOT>/sourcejs` | Data owned by SourceJS core modules. |
| `CUSTOM_DATA_ROOT` | `<DATA_ROOT>/custom` | Administrator or custom-package data. |
| `PLUGIN_DATA_ROOT` | `<DATA_ROOT>/plugins` | Per-plugin persistent data. |
| `CONFIG_ROOT` | `<GAME_ROOT>/cfg/sourcejs` | SourceJS configuration files. |
| `LOG_ROOT` | `<GAME_ROOT>/logs/sourcejs` | SourceJS and plugin log files. |
| `LANGUAGE_FILE` | `<DATA_ROOT>/languages.ini` | Installed language registry. |

Use a stable plugin identifier below `PLUGIN_DATA_ROOT`, `CONFIG_ROOT`, or `LOG_ROOT`. Do not write plugin state into `SOURCE_DATA_ROOT`; core loaders may manage those files as part of packaging or updates.

## Packages and documentation

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `PACKAGE_ROOT` | `<BASE_ROOT>/packages` | Parent directory for JavaScript packages. |
| `SOURCE_PACKAGE_ROOT` | `<PACKAGE_ROOT>/sourcejs` | Built-in SourceJS packages. |
| `CUSTOM_PACKAGE_ROOT` | `<PACKAGE_ROOT>/custom` | Administrator-provided packages. |
| `SITE_PACKAGE_ROOT` | `<PACKAGE_ROOT>/site-packages` | Third-party site packages. |
| `DOCS_ROOT` | `<BASE_ROOT>/docs` | Parent directory for runtime documentation. |
| `SOURCE_DOCS_ROOT` | `<DOCS_ROOT>/sourcejs` | SourceJS package documentation. |
| `PLUGIN_DOCS_ROOT` | `<DOCS_ROOT>/plugins` | Plugin documentation. |
| `CUSTOM_PACKAGE_DOCS_ROOT` | `<DOCS_ROOT>/custom` | Custom-package documentation. |

These values describe loader and packaging locations. Writing a file into a package directory does not load it into an already running plugin context. Use the plugin or extension manager for lifecycle changes.

## Resources

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `TRANSLATION_ROOT` | `<GAME_ROOT>/resource/sourcejs/translations` | Translation files visible to SourceJS. |
| `TRANSLATION_CORE_ROOT` | `<TRANSLATION_ROOT>/_core` | Core translation catalog directory. |
| `TRANSLATION_CORE_FILE` | `<TRANSLATION_CORE_ROOT>/translations_strings.ini` | Core translation strings. |
| `EVENT_ROOT` | `<GAME_ROOT>/resource/sourcejs/events` | Custom game-event resource files. |
| `SOUND_ROOT` | `<GAME_ROOT>/sound/sourcejs` | Physical SourceJS sound assets. |

Engine APIs generally expect paths relative to their search root. For example, a file physically stored as `${SOUND_ROOT}/alerts/ready.wav` is normally precached or emitted as `sourcejs/alerts/ready.wav`, not by passing its absolute path.

## Authorization

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `AUTH_CONFIG_ROOT` | `<CONFIG_ROOT>/auth` | Authorization backend configuration. |
| `BACKEND_ROOT` | `<SOURCE_PACKAGE_ROOT>/auth/backends` | Built-in backend implementations. |
| `BACKEND_CONFIG_FILE` | `<AUTH_CONFIG_ROOT>/permissions.ini` | Selected backend and permission configuration. |
| `AUTH_PLAYERS_FILE` | `<AUTH_CONFIG_ROOT>/players.json` | Flat-file player grants. |
| `AUTH_PARENTS_FILE` | `<AUTH_CONFIG_ROOT>/parents.json` | Flat-file parent groups. |
| `AUTH_SIMPLE_FILE` | `<AUTH_CONFIG_ROOT>/simple.txt` | Simple authorization backend data. |
| `AUTH_SQL_FILE` | `<AUTH_CONFIG_ROOT>/permissions.sqlite3` | SQLite authorization database. |

The `SQL` acronym remains uppercase in `AUTH_SQL_FILE`. These files are owned by the authorization subsystem; inspect them when diagnosing configuration, but update permissions through the `auth` APIs rather than replacing active backend files from arbitrary plugins.

## Update staging

| Export | Runtime location | Intended use |
| --- | --- | --- |
| `UPDATE_ROOT` | `<BASE_ROOT>/update` | Root of a staged SourceJS update tree. |
| `UPDATE_DATA_ROOT` | `<UPDATE_ROOT>/addons/sourcejs/data` | Staged replacement data root. |
| `UPDATE_SOURCE_DATA_ROOT` | `<UPDATE_DATA_ROOT>/sourcejs` | Staged core SourceJS data. |

Writing into the update tree only stages files. It does not install, activate, or validate an update. Keep the complete package layout and let the update subsystem own activation.

## Examples

### Validate the runtime topology

This compares the exported roots lexically without hard-coding a game name. It does not inspect installation contents or canonical filesystem identity, resolve symlinks, or prove that the selected game directory is correct. Trailing separators are removed before appending child names.

```js
const { ADDON_ROOT, BASE_ROOT, GAME_ROOT } = require("paths");

function NormalizeRuntimeRoot(strRoot) {
	return strRoot.replace(/\\/g, "/").replace(/\/+$/, "");
}

const g_strNormalizedAddonRoot = NormalizeRuntimeRoot(ADDON_ROOT);
const g_strNormalizedBaseRoot = NormalizeRuntimeRoot(BASE_ROOT);
const g_strNormalizedGameRoot = NormalizeRuntimeRoot(GAME_ROOT);
const g_bHasExpectedAddonRoot = g_strNormalizedAddonRoot === `${g_strNormalizedGameRoot}/addons`;
const g_bHasExpectedBaseRoot = g_strNormalizedBaseRoot === `${g_strNormalizedAddonRoot}/sourcejs`;
const g_bHasDistinctRuntimeRoots = g_strNormalizedAddonRoot !== g_strNormalizedBaseRoot;
if (!g_bHasExpectedAddonRoot || !g_bHasExpectedBaseRoot || !g_bHasDistinctRuntimeRoots) {
	throw new Error("The SourceJS runtime roots do not form the expected topology.");
}
```

### Store per-plugin state

Run this only in a private, exclusively controlled directory: `WriteTextFile()` truncates an existing file, so a preceding existence check does not protect against another writer. The example refuses an already-present file, writes and reads JSON, and attempts cleanup on every exit while preserving operation and cleanup failures.

```js
const { DoesFileExist, EnsureDirectoryExists, ReadTextFile, RemoveFile, WriteTextFile } = require("filesystem");
const { PLUGIN_DATA_ROOT } = require("paths");

const g_strPluginDataDirectoryPath = `${PLUGIN_DATA_ROOT}/round-summary`;
const g_strPluginDataFilePath = `${g_strPluginDataDirectoryPath}/latest.json`;

if (!EnsureDirectoryExists(g_strPluginDataDirectoryPath) || DoesFileExist(g_strPluginDataFilePath)) {
	throw new Error("The round-summary example path is unavailable or already exists.");
}

let g_bOperationFailed = false;
let g_OperationErrorValue = null;

try {
	const ExpectedRoundSummary = { CompletedRoundCount: 3, SessionID: "example-session" };
	if (!WriteTextFile(g_strPluginDataFilePath, JSON.stringify(ExpectedRoundSummary))) {
		throw new Error("The round summary could not be written.");
	}

	const RoundSummary = JSON.parse(ReadTextFile(g_strPluginDataFilePath));
	if ((RoundSummary.CompletedRoundCount !== ExpectedRoundSummary.CompletedRoundCount) || (RoundSummary.SessionID !== ExpectedRoundSummary.SessionID)) {
		throw new Error("The persisted round summary did not round-trip exactly.");
	}
} catch (OperationError) {
	g_bOperationFailed = true;
	g_OperationErrorValue = OperationError;
	throw OperationError;
} finally {
	try {
		if (DoesFileExist(g_strPluginDataFilePath) && !RemoveFile(g_strPluginDataFilePath)) {
			throw new Error("The round-summary example file could not be removed.");
		}
	} catch (CleanupError) {
		if (g_bOperationFailed) {
			throw new AggregateError([g_OperationErrorValue, CleanupError], "Round-summary operation and cleanup both failed.");
		}

		throw CleanupError;
	}
}
```

### Keep configuration and logs separate

Both directories must be exclusively controlled by this example, with no concurrent writers. Each cleanup is attempted even if the other fails; cleanup errors are aggregated without losing an earlier operation failure.

```js
const { DoesFileExist, EnsureDirectoryExists, ReadTextFile, RemoveFile, WriteTextFile } = require("filesystem");
const { CONFIG_ROOT, LOG_ROOT } = require("paths");

const g_strLatencyWatchConfigurationDirectoryPath = `${CONFIG_ROOT}/latency-watch`;
const g_strLatencyWatchLogDirectoryPath = `${LOG_ROOT}/latency-watch`;
const g_strLatencyWatchConfigurationFilePath = `${g_strLatencyWatchConfigurationDirectoryPath}/settings.json`;
const g_strLatencyWatchLogFilePath = `${g_strLatencyWatchLogDirectoryPath}/startup.log`;
const g_bCreatedLatencyWatchConfigurationDirectory = EnsureDirectoryExists(g_strLatencyWatchConfigurationDirectoryPath);
const g_bCreatedLatencyWatchLogDirectory = g_bCreatedLatencyWatchConfigurationDirectory && EnsureDirectoryExists(g_strLatencyWatchLogDirectoryPath);
const g_bHasDistinctLatencyWatchDirectories = g_strLatencyWatchConfigurationDirectoryPath !== g_strLatencyWatchLogDirectoryPath;
if (!g_bCreatedLatencyWatchConfigurationDirectory || !g_bCreatedLatencyWatchLogDirectory || !g_bHasDistinctLatencyWatchDirectories) {
	throw new Error("Configuration and log directories were not created separately.");
}

const g_bHasExistingLatencyWatchConfigurationFile = DoesFileExist(g_strLatencyWatchConfigurationFilePath);
const g_bHasExistingLatencyWatchLogFile = DoesFileExist(g_strLatencyWatchLogFilePath);
if (g_bHasExistingLatencyWatchConfigurationFile || g_bHasExistingLatencyWatchLogFile) {
	throw new Error("The latency-watch example refuses to overwrite existing files.");
}

let g_bOperationFailed = false;
let g_OperationErrorValue = null;

try {
	if (!WriteTextFile(g_strLatencyWatchConfigurationFilePath, JSON.stringify({ LatencyThreshold: 0.15 })) || !WriteTextFile(g_strLatencyWatchLogFilePath, "latency-watch initialized\n")) {
		throw new Error("The latency-watch files could not be written.");
	}

	const LatencyWatchConfiguration = JSON.parse(ReadTextFile(g_strLatencyWatchConfigurationFilePath));
	const strLatencyWatchLogText = ReadTextFile(g_strLatencyWatchLogFilePath);
	if ((LatencyWatchConfiguration.LatencyThreshold !== 0.15) || (strLatencyWatchLogText !== "latency-watch initialized\n")) {
		throw new Error("Configuration or log data did not round-trip exactly.");
	}
} catch (OperationError) {
	g_bOperationFailed = true;
	g_OperationErrorValue = OperationError;
	throw OperationError;
} finally {
	const vecCleanupErrors = [];
	for (const strExampleFilePath of [g_strLatencyWatchConfigurationFilePath, g_strLatencyWatchLogFilePath]) {
		try {
			if (DoesFileExist(strExampleFilePath) && !RemoveFile(strExampleFilePath)) {
				throw new Error(`The latency-watch example file could not be removed: ${strExampleFilePath}.`);
			}
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (vecCleanupErrors.length > 0) {
		if (g_bOperationFailed) {
			vecCleanupErrors.unshift(g_OperationErrorValue);
		}

		throw new AggregateError(vecCleanupErrors, "Latency-watch operation or cleanup failed.");
	}
}
```

### Locate core, custom, and language data

Use presence checks for administrator-controlled or package-dependent files. The prefix comparisons below are lexical checks of exported values, not filesystem containment or symlink-security checks.

```js
const { DoesFileExist } = require("filesystem");
const { CUSTOM_DATA_ROOT, DATA_ROOT, LANGUAGE_FILE, SOURCE_DATA_ROOT } = require("paths");

const g_vecDataPathAvailability = [DoesFileExist(CUSTOM_DATA_ROOT), DoesFileExist(LANGUAGE_FILE), DoesFileExist(SOURCE_DATA_ROOT)];
const g_bHasInvalidDataPathAvailability = g_vecDataPathAvailability.some((bDataPathAvailability) => typeof bDataPathAvailability !== "boolean");
if (g_bHasInvalidDataPathAvailability) {
	throw new Error("The filesystem.DoesFileExist() API returned an invalid availability value.");
}

const g_strNormalizedCustomDataRoot = CUSTOM_DATA_ROOT.replace(/\\/g, "/");
const g_strNormalizedDataRoot = DATA_ROOT.replace(/\\/g, "/");
const g_strNormalizedSourceDataRoot = SOURCE_DATA_ROOT.replace(/\\/g, "/");
const g_bHasNestedCustomDataRoot = g_strNormalizedCustomDataRoot.startsWith(`${g_strNormalizedDataRoot}/`);
const g_bHasNestedSourceDataRoot = g_strNormalizedSourceDataRoot.startsWith(`${g_strNormalizedDataRoot}/`);
if (!g_bHasNestedCustomDataRoot || !g_bHasNestedSourceDataRoot) {
	throw new Error("The exported custom and source data roots do not belong to DATA_ROOT.");
}
```

### Inspect authorization layout

This inspects exported paths without changing authorization files. The prefix test checks spelling only; it does not resolve symlinks or authorize access to an untrusted path.

```js
const { DoesFileExist } = require("filesystem");
const {
	AUTH_CONFIG_ROOT,
	AUTH_PARENTS_FILE,
	AUTH_PLAYERS_FILE,
	AUTH_SIMPLE_FILE,
	AUTH_SQL_FILE,
	BACKEND_CONFIG_FILE,
	BACKEND_ROOT,
} = require("paths");

const g_vecAuthorizationFilePaths = [AUTH_PARENTS_FILE, AUTH_PLAYERS_FILE, AUTH_SIMPLE_FILE, AUTH_SQL_FILE, BACKEND_CONFIG_FILE];
const g_vecAuthorizationPathAvailability = [DoesFileExist(BACKEND_ROOT), ...g_vecAuthorizationFilePaths.map((strAuthorizationFilePath) => DoesFileExist(strAuthorizationFilePath))];
const g_bHasInvalidAuthorizationPathAvailability = g_vecAuthorizationPathAvailability.some((bAuthorizationPathAvailability) => typeof bAuthorizationPathAvailability !== "boolean");
if (g_bHasInvalidAuthorizationPathAvailability) {
	throw new Error("Authorization availability checks returned invalid values.");
}

const g_strNormalizedAuthorizationConfigurationRoot = AUTH_CONFIG_ROOT.replace(/\\/g, "/");
for (const strAuthorizationFilePath of g_vecAuthorizationFilePaths) {
	const strNormalizedAuthorizationFilePath = strAuthorizationFilePath.replace(/\\/g, "/");
	if (!strNormalizedAuthorizationFilePath.startsWith(`${g_strNormalizedAuthorizationConfigurationRoot}/`)) {
		throw new Error(`Authorization file escaped AUTH_CONFIG_ROOT: ${strAuthorizationFilePath}.`);
	}
}
```

### Inspect translation, event, and sound resources

These are presence and lexical-layout diagnostics, not containment or access-control checks.

```js
const { DoesFileExist } = require("filesystem");
const {
	EVENT_ROOT,
	SOUND_ROOT,
	TRANSLATION_CORE_FILE,
	TRANSLATION_CORE_ROOT,
	TRANSLATION_ROOT,
} = require("paths");

const g_vecResourceAvailability = [DoesFileExist(TRANSLATION_CORE_FILE), DoesFileExist(EVENT_ROOT), DoesFileExist(SOUND_ROOT)];
const g_bHasInvalidResourceAvailability = g_vecResourceAvailability.some((bResourceAvailability) => typeof bResourceAvailability !== "boolean");
if (g_bHasInvalidResourceAvailability) {
	throw new Error("Resource availability checks returned invalid values.");
}

const g_strNormalizedTranslationCoreFile = TRANSLATION_CORE_FILE.replace(/\\/g, "/");
const g_strNormalizedTranslationCoreRoot = TRANSLATION_CORE_ROOT.replace(/\\/g, "/");
const g_strNormalizedTranslationRoot = TRANSLATION_ROOT.replace(/\\/g, "/");
const g_bHasExpectedTranslationCoreRoot = g_strNormalizedTranslationCoreRoot === `${g_strNormalizedTranslationRoot}/_core`;
const g_bHasNestedTranslationCoreFile = g_strNormalizedTranslationCoreFile.startsWith(`${g_strNormalizedTranslationCoreRoot}/`);
if (!g_bHasExpectedTranslationCoreRoot || !g_bHasNestedTranslationCoreFile) {
	throw new Error("The core translation paths do not belong to TRANSLATION_ROOT.");
}
```

### Inspect plugin, extension, package, and documentation roots

The prefix checks compare exported spellings; they do not resolve symlinks or prove safe filesystem containment.

```js
const { DoesFileExist } = require("filesystem");
const {
	CUSTOM_PACKAGE_DOCS_ROOT,
	CUSTOM_PACKAGE_ROOT,
	DOCS_ROOT,
	EXTENSION_ROOT,
	PACKAGE_ROOT,
	PLUGIN_DOCS_ROOT,
	PLUGIN_ROOT,
	SITE_PACKAGE_ROOT,
	SOURCE_DOCS_ROOT,
	SOURCE_PACKAGE_ROOT,
} = require("paths");

const g_vecOptionalRootPaths = [CUSTOM_PACKAGE_DOCS_ROOT, CUSTOM_PACKAGE_ROOT, EXTENSION_ROOT, PLUGIN_DOCS_ROOT, PLUGIN_ROOT, SITE_PACKAGE_ROOT, SOURCE_DOCS_ROOT, SOURCE_PACKAGE_ROOT];
const g_vecOptionalRootAvailability = g_vecOptionalRootPaths.map((strOptionalRootPath) => DoesFileExist(strOptionalRootPath));
const g_bHasInvalidOptionalRootAvailability = g_vecOptionalRootAvailability.some((bOptionalRootAvailability) => typeof bOptionalRootAvailability !== "boolean");
const g_vecDocumentationRootPaths = [CUSTOM_PACKAGE_DOCS_ROOT, PLUGIN_DOCS_ROOT, SOURCE_DOCS_ROOT];
const g_vecPackageRootPaths = [CUSTOM_PACKAGE_ROOT, SITE_PACKAGE_ROOT, SOURCE_PACKAGE_ROOT];
const g_strNormalizedDocumentationRoot = DOCS_ROOT.replace(/\\/g, "/");
const g_strNormalizedPackageRoot = PACKAGE_ROOT.replace(/\\/g, "/");

if (g_bHasInvalidOptionalRootAvailability) {
	throw new Error("Package or documentation availability checks returned invalid values.");
}

for (const strDocumentationRootPath of g_vecDocumentationRootPaths) {
	const strNormalizedDocumentationRootPath = strDocumentationRootPath.replace(/\\/g, "/");
	if (!strNormalizedDocumentationRootPath.startsWith(`${g_strNormalizedDocumentationRoot}/`)) {
		throw new Error(`Documentation root escaped DOCS_ROOT: ${strDocumentationRootPath}.`);
	}
}

for (const strPackageRootPath of g_vecPackageRootPaths) {
	const strNormalizedPackageRootPath = strPackageRootPath.replace(/\\/g, "/");
	if (!strNormalizedPackageRootPath.startsWith(`${g_strNormalizedPackageRoot}/`)) {
		throw new Error(`Package root escaped PACKAGE_ROOT: ${strPackageRootPath}.`);
	}
}
```

### Stage core data for an update

Run this only with exclusive control of the staging directory, never while an updater or another writer is using it. It writes and removes an illustrative JSON file, not an updater-recognized manifest format or an update-validation protocol. Activation remains the updater's responsibility; checking for an existing file before `WriteTextFile()` is not atomic.

```js
const { DoesFileExist, EnsureDirectoryExists, ReadTextFile, RemoveFile, WriteTextFile } = require("filesystem");
const { UPDATE_DATA_ROOT, UPDATE_ROOT, UPDATE_SOURCE_DATA_ROOT } = require("paths");

const g_strStagedUpdateManifestPath = `${UPDATE_SOURCE_DATA_ROOT}/example-manifest.json`;
const g_strNormalizedUpdateDataRoot = UPDATE_DATA_ROOT.replace(/\\/g, "/");
const g_strNormalizedUpdateRoot = UPDATE_ROOT.replace(/\\/g, "/");
const g_strNormalizedUpdateSourceDataRoot = UPDATE_SOURCE_DATA_ROOT.replace(/\\/g, "/");
const g_bHasNestedUpdateDataRoot = g_strNormalizedUpdateDataRoot.startsWith(`${g_strNormalizedUpdateRoot}/`);
const g_bHasNestedUpdateSourceDataRoot = g_strNormalizedUpdateSourceDataRoot.startsWith(`${g_strNormalizedUpdateDataRoot}/`);

if (!g_bHasNestedUpdateDataRoot || !g_bHasNestedUpdateSourceDataRoot) {
	throw new Error("Update staging roots do not form the expected topology.");
}

const g_bCreatedUpdateSourceDataDirectory = EnsureDirectoryExists(UPDATE_SOURCE_DATA_ROOT);
const g_bHasExistingStagedUpdateManifest = g_bCreatedUpdateSourceDataDirectory && DoesFileExist(g_strStagedUpdateManifestPath);
if (!g_bCreatedUpdateSourceDataDirectory || g_bHasExistingStagedUpdateManifest) {
	throw new Error("The update example path is unavailable or already exists.");
}

let g_bOperationFailed = false;
let g_OperationErrorValue = null;

try {
	if (!WriteTextFile(g_strStagedUpdateManifestPath, JSON.stringify({ Files: [], Schema: 1 }))) {
		throw new Error("The staged update manifest could not be written.");
	}

	const StagedUpdateManifest = JSON.parse(ReadTextFile(g_strStagedUpdateManifestPath));
	if ((StagedUpdateManifest.Schema !== 1) || (StagedUpdateManifest.Files.length !== 0)) {
		throw new Error("The staged update manifest did not round-trip exactly.");
	}
} catch (OperationError) {
	g_bOperationFailed = true;
	g_OperationErrorValue = OperationError;
	throw OperationError;
} finally {
	try {
		if (DoesFileExist(g_strStagedUpdateManifestPath) && !RemoveFile(g_strStagedUpdateManifestPath)) {
			throw new Error("The staged update manifest could not be removed.");
		}
	} catch (CleanupError) {
		if (g_bOperationFailed) {
			throw new AggregateError([g_OperationErrorValue, CleanupError], "Staged-file operation and cleanup both failed.");
		}

		throw CleanupError;
	}
}
```

## Errors

- The module load fails when the native SourceJS runtime has not installed the `paths` object.
- Native installation creates path constants as own data properties without invoking inherited setters. It stops at the first string-conversion or property-creation failure, preserves pending JavaScript exceptions and execution termination, and contains C++ exceptions. Fields already created are not rolled back.
- Assignment to an exported property does not validate, normalize, or relocate the runtime's internal paths. Invalid edits can redirect JavaScript consumers to missing or unsafe locations; validate and restore temporary overrides. Destructured string values are snapshots, not live bindings to later assignments.
- A path value does not guarantee that its file or directory exists. Check the correct filesystem domain before reading.
- Writing can fail because of permissions, missing parents, an existing protected file, or an invalid platform path.

## Lifecycle

The native runtime installs initial path values once, while the exported JavaScript properties remain live and editable. Restore temporary overrides when finished; path strings require no disposal. Only files and directories actually created and exclusively owned by the plugin are its cleanup responsibility; being below a root does not grant ownership of existing content. For those owned resources: close handles, remove temporary files, and preserve administrator-owned data during unload or migration failure.

## Related modules

- [`filesystem`](filesystem.md) performs physical and Source search-path operations; choose the appropriate domain and check each result instead of treating a location as validated.
- [`plugins`](plugins.md) owns plugin loading below `PLUGIN_ROOT`.
- [`extensions`](extensions.md) owns extension loading below `EXTENSION_ROOT`.
- [`auth`](auth.md) manages files below `AUTH_CONFIG_ROOT`.
