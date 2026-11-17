# `require("core/version")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

`core/version` exposes build identity and the native-module/public-package inventories held by the running SourceJS registry. Use it for startup diagnostics, compatibility checks, and bug reports that need the SDK build metadata.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [Build information](#build-information)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/core/version.js`](../../packages/sourcejs/core/version.js) returns the native `core/version` object installed by [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp).

Use this module when diagnostics or compatibility checks need the compiled version, Git commit, SDK branch, target platform, target architecture, native-module inventory, or public-package inventory. Read metadata from the native surface instead of duplicating it in plugins. These strings describe the build configuration; they are not a binary fingerprint or proof that a particular API is usable.

## Import

```js
const { GetVersion, GetInfo, GetModules } = require("core/version");
```

The package returns the native object directly. `GetVersion()` and `IsUnversioned()` use the compiled version; `GetInfo()` combines build metadata with runtime information. `GetModules()` and `GetPublicPackages()` read the current registry inventories.

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`VERSION`](#version) | Constant | Version embedded when SourceJS was built. |
| [`GIT_COMMIT`](#git_commit) | Constant | Commit embedded when SourceJS was built. |
| [`GetVersion`](#getversion) | Function | `GetVersion()` |
| [`GetInfo`](#getinfo) | Function | `GetInfo()` |
| [`GetModules`](#getmodules) | Function | `GetModules()` |
| [`GetPublicPackages`](#getpublicpackages) | Function | `GetPublicPackages()` |
| [`IsUnversioned`](#isunversioned) | Function | `IsUnversioned()` |

## Build information

`GetInfo()` returns a new object with these stable public fields. Each is an own writable, enumerable, configurable data property; initialization bypasses inherited setters and inherited non-writable properties. The fields are copied report values, not live accessors to binary metadata or the runtime path:

| Field | Type | Meaning |
| --- | --- | --- |
| `Version` | `string` | Embedded SourceJS version. |
| `GitCommit` | `string` | Embedded Git commit. |
| `SDKBranch` | `string` | HL2SDK branch used to compile the binary. |
| `Platform` | `string` | Target platform, such as `windows` or `linux`. |
| `Architecture` | `string` | Compiled `SOURCEJS_TARGET_ARCH` value, such as `x86` or `x64`. |
| `Runtime` | `string` | JavaScript runtime; currently `v8`. |
| `GameName` | `string` | Filename component of the runtime game-root path. |
| `SourceEngine` | `string` | Engine family; currently `source`. |
| `SourceEngineBranch` | `string` | Compiled SDK branch, the same `SOURCEJS_SDK_BRANCH` value used for `SDKBranch`. |

## Examples

### `VERSION`

Use the embedded version in a command or startup message instead of maintaining a second plugin-side copy:

```js
const { VERSION, IsUnversioned } = require("core/version");
const { LogInfo } = require("core/logger");

const g_strDisplayVersion = IsUnversioned() ? "unversioned build" : VERSION;
LogInfo(`Running SourceJS ${g_strDisplayVersion}.`);
```

### `GIT_COMMIT`

Include the commit in a diagnostic only when the build embedded one:

```js
const { GIT_COMMIT } = require("core/version");
const { LogInfo } = require("core/logger");

if (GIT_COMMIT) {
	LogInfo(`SourceJS commit: ${GIT_COMMIT}`);
} else {
	LogInfo("This SourceJS build has no embedded Git commit.");
}
```

### `GetVersion()`

`GetVersion()` reads the same compile-time version as `VERSION`. A diagnostics plugin can verify both surfaces before reporting a build:

```js
const { VERSION, GetVersion } = require("core/version");

const g_strReportedVersion = GetVersion();
if (g_strReportedVersion !== VERSION) {
	throw new Error(`SourceJS version metadata is inconsistent: ${g_strReportedVersion} != ${VERSION}`);
}
```

The native `GetVersion()` callback reports a C++ failure as `Error("core.GetVersion() failed because a native C++ exception occurred.")`. An existing JavaScript exception is preserved. The public `require("core").GetSourceJSVersion()` helper also calls that native callback; this failure handling does not change the compiled version value.

### `GetInfo()`

Build a useful one-line server diagnostic with the exact SDK, platform, and architecture:

```js
const { GetInfo } = require("core/version");
const { LogInfo } = require("core/logger");

const g_BuildInformation = GetInfo();
const g_strSourceJSVersion = g_BuildInformation.Version || "unversioned";
LogInfo(`SourceJS ${g_strSourceJSVersion} (${g_BuildInformation.SDKBranch}, ${g_BuildInformation.Platform}/${g_BuildInformation.Architecture}) is running on ${g_BuildInformation.GameName}.`);
```

The returned object is a report. Changing it does not modify the loaded binary or its compile-time metadata.

### `IsUnversioned()`

Report an empty embedded version before deciding whether to run release checks. This diagnostic does not disable an updater, and an empty version alone does not identify a local or debug build:

```js
const { IsUnversioned } = require("core/version");
const { LogWarning } = require("core/logger");

if (IsUnversioned()) {
	LogWarning("SourceJS has no embedded version; select an update policy explicitly.");
}
```

`IsUnversioned()` tests the embedded version string. It does not inspect the Git working tree.

### `GetModules()`

Check required native-module names before a plugin starts registering commands or hooks; separately validate the particular API and runtime capability it needs:

```js
const { GetModules } = require("core/version");

const g_setAvailableModules = new Set(GetModules());
const g_vecRequiredModules = ["players", "memory"];
const g_vecMissingModules = g_vecRequiredModules.filter(function IsModuleMissing(strModuleName) {
	return !g_setAvailableModules.has(strModuleName);
});
if (g_vecMissingModules.length > 0) {
	throw new Error(`SourceJS is missing required native modules: ${g_vecMissingModules.join(", ")}`);
}
```

The returned array copies the registry's native-module names. Membership alone does not guarantee that every member function is available or supported for the current SDK branch and runtime state.

### `GetPublicPackages()`

Check expected top-level names against the registry's package inventory and report missing names together. This is not a filesystem or import-success check:

```js
const { GetPublicPackages } = require("core/version");

const g_setAvailablePackages = new Set(GetPublicPackages());
const g_vecRequiredPackages = ["players", "events", "memory"];
const g_vecMissingPackages = g_vecRequiredPackages.filter(function IsPackageMissing(strPackageName) {
	return !g_setAvailablePackages.has(strPackageName);
});
if (g_vecMissingPackages.length > 0) {
	throw new Error(`SourceJS is missing required packages: ${g_vecMissingPackages.join(", ")}`);
}
```

`GetPublicPackages()` copies the top-level package-name inventory initialized by `ModuleRegistry`; it does not scan installed files. Check the actual required import, including submodules such as `players/entity`, and handle loading failures separately.

## Safe use

- These metadata and registry queries run synchronously on the runtime's Source server thread. They do not start network requests, load packages, or test native capabilities.
- Treat `VERSION`, `GIT_COMMIT`, all function names, and the PascalCase `GetInfo()` fields as stable public compatibility keys. Do not rename them to internal systems-Hungarian spellings in consuming code or documentation.
- `IsUnversioned()` returns whether the compiled version string is empty. It does not read a reassigned JavaScript `VERSION` property or inspect `GIT_COMMIT`, repository state, tags, or semantic-version ordering.
- `GetInfo()` returns a fresh report object. Mutating that object does not alter the loaded binary or its compile-time metadata.
- `GetModules()` and `GetPublicPackages()` return snapshot arrays. Validate names before use, but do not treat mutations of those arrays as registry changes.
- Registry membership is not proof of file availability, successful import, or branch-specific API support. Check actual required capabilities before registering dependent commands, hooks, or listeners.

## Related files

- [`packages/sourcejs/core/version.js`](../../packages/sourcejs/core/version.js) — JavaScript entry point that returns the native module unchanged.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — stable exports, build-info keys, and native registry snapshots.
- [`core.md`](core.md) — shared core runtime and module-registry APIs.
- [`core-update.md`](core-update.md) — release lookup and artifact selection that consume current-build metadata.
