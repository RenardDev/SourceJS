# `require("core/update")`

> Warning: this API reference is dense for AI-agent processing. Use the table of contents to navigate directly to the relevant section.

> This page is maintained by hand. Network examples use the real GitHub release API contract.

## Table of contents

- [Location and purpose](#location-and-purpose)
- [Native module contract](#native-module-contract)
- [Import](#import)
- [Exports](#exports)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

[`packages/sourcejs/core/update.js`](../../packages/sourcejs/core/update.js) wraps the exact current-build metadata surface of the native `core/update` module and adds asynchronous CPR requests to GitHub's latest-release API.

On startup, SourceJS queues one background check of GitHub's latest published release. A newer version prints a banner in the server console with the current version, release version, build target, and release page. The check does not download an archive, replace the running binary, or write to the installation. To update, stop the server and install the matching build manually. A failed check reports a warning without preventing startup; an equal or older version prints no banner. The startup check is independent of [GameData refresh](memory-gamedata.md).

Use the other helpers to inspect the running build and find release assets for manual installation. The module-level update-in-progress flag neither starts an update nor provides a lock.

Every network request runs on its own worker thread. Completion callbacks receive `(Error, Result)` on the Source server thread; `Error` is `null` on success. Invalid arguments and queue-admission failures throw synchronously, while transport and response-validation errors are passed to the callback. At most 128 asynchronous tasks may be outstanding. JavaScript timeout validation requires positive safe integers in milliseconds; the native CPR binding imposes its own representable range. Artifact selection matches the normalized basename `sourcejs-<Platform>-<SDKBranch>-<Architecture>`, either exactly or followed by a dot suffix, ignoring URL queries and fragments.

## Native module contract

[`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) installs the native `core/update` object with these exact case-sensitive exports:

| Native export | Kind | Value or signature |
| --- | --- | --- |
| `Version` | String | Compiled `SOURCEJS_VERSION` value. |
| `GitCommit` | String | Compiled `SOURCEJS_GIT_COMMIT` value. |
| `SDKBranch` | String | Compiled `SOURCEJS_SDK_BRANCH` value. |
| `Platform` | String | Compiled `SOURCEJS_TARGET_PLATFORM` value. |
| `Architecture` | String | Compiled `SOURCEJS_TARGET_ARCH` value. |
| [`GetCurrentBuild`](#getcurrentbuild) | Function | `GetCurrentBuild()` |

Native `GetCurrentBuild()` returns a new object with the same five PascalCase fields, each an own writable, enumerable, configurable data property. Initialization bypasses inherited setters and inherited non-writable properties; changing the report does not change the binary metadata. The package-level `GetCurrentBuild()` requires a non-array object with non-empty string `Architecture`, `GitCommit`, `Platform`, `SDKBranch`, and `Version` fields and returns a fresh record. A missing or empty field throws `TypeError`; an unversioned build or empty embedded commit is not accepted by this query.

## Import

```js
const { GetBuildDownloadURL, GetCurrentBuild, IsNewVersionAvailable } = require("core/update");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`DEFAULT_TIMEOUT`](#default_timeout) | Number | Default request timeout of `3000` milliseconds. |
| [`LATEST_RELEASE_URL`](#latest_release_url) | String | GitHub latest-release API endpoint for `RenardDev/SourceJS`. |
| [`AnnounceAvailableUpdate`](#announceavailableupdate) | Function | `AnnounceAvailableUpdate()`; queues a metadata-only check and reports the result to the server console. |
| [`FetchJSON`](#fetchjson) | Function | `FetchJSON(strRequestURL, Options, Callback)` |
| [`GetBuildArtifactURLs`](#getbuildartifacturls) | Function | `GetBuildArtifactURLs(Options, Callback)` |
| [`GetBuildDownloadURL`](#getbuilddownloadurl) | Function | `GetBuildDownloadURL(Options, Callback)` |
| [`GetCurrentBuild`](#getcurrentbuild) | Function | `GetCurrentBuild()` |
| [`GetLatestRelease`](#getlatestrelease) | Function | `GetLatestRelease(Options, Callback)` |
| [`IsNewVersionAvailable`](#isnewversionavailable) | Function | `IsNewVersionAvailable(Options, Callback)` |
| [`IsUpdateInProgress`](#isupdateinprogress) | Function | `IsUpdateInProgress()` |
| [`SetUpdateInProgress`](#setupdateinprogress) | Function | `SetUpdateInProgress(bUpdateInProgress)` |

## Examples

### `DEFAULT_TIMEOUT`

```js
const { DEFAULT_TIMEOUT } = require("core/update");

console.log(`Release request timeout: ${DEFAULT_TIMEOUT} ms`);
```

### `LATEST_RELEASE_URL`

```js
const { LATEST_RELEASE_URL } = require("core/update");

console.log(`Checking SourceJS releases at ${LATEST_RELEASE_URL}.`);
```

### `GetCurrentBuild`

```js
const { GetCurrentBuild } = require("core/update");

const g_CurrentBuild = GetCurrentBuild();
console.log(`${g_CurrentBuild.Version}: ${g_CurrentBuild.SDKBranch}/${g_CurrentBuild.Platform}/${g_CurrentBuild.Architecture}`);
```

### `FetchJSON`

```js
const { FetchJSON, LATEST_RELEASE_URL } = require("core/update");

FetchJSON(LATEST_RELEASE_URL, { Timeout: 5000 }, (RequestError, LatestRelease) => {
	if (RequestError) {
		throw RequestError;
	}

	if ((LatestRelease === null) || (typeof LatestRelease !== "object") || Array.isArray(LatestRelease) || (typeof LatestRelease.tag_name !== "string") || (LatestRelease.tag_name.length === 0)) {
		throw new Error("GitHub release payload must be an object with a non-empty tag_name.");
	}

	console.log(`Latest release: ${LatestRelease.tag_name}`);
});
```

### `GetBuildArtifactURLs`

```js
const { GetBuildArtifactURLs } = require("core/update");

GetBuildArtifactURLs({ Timeout: 5000 }, (RequestError, vecArtifactURLs) => {
	if (RequestError) {
		throw RequestError;
	}

	for (const strArtifactURL of vecArtifactURLs) {
		console.log(strArtifactURL);
	}
});
```

### `GetBuildDownloadURL`

```js
const { GetBuildDownloadURL, GetCurrentBuild } = require("core/update");

const g_CurrentBuild = GetCurrentBuild();
const g_Options = {
	SDKBranch: g_CurrentBuild.SDKBranch,
	Platform: g_CurrentBuild.Platform,
	Architecture: g_CurrentBuild.Architecture,
	Timeout: 5000,
};
GetBuildDownloadURL(g_Options, (RequestError, strDownloadURL) => {
	if (RequestError) {
		throw RequestError;
	}

	console.log(`Matching artifact: ${strDownloadURL}`);
});
```

### `GetLatestRelease`

```js
const { GetLatestRelease } = require("core/update");

GetLatestRelease({ Timeout: 5000 }, (RequestError, LatestRelease) => {
	if (RequestError) {
		throw RequestError;
	}

	if ((LatestRelease === null) || (typeof LatestRelease !== "object") || Array.isArray(LatestRelease) || (typeof LatestRelease.tag_name !== "string") || (LatestRelease.tag_name.length === 0)) {
		throw new Error("GitHub release payload must be an object with a non-empty tag_name.");
	}

	const strPublishedAt = (typeof LatestRelease.published_at === "string") ? LatestRelease.published_at : "unknown";
	console.log(`${LatestRelease.tag_name} was published at ${strPublishedAt}.`);
});
```

### `IsNewVersionAvailable`

```js
const { GetCurrentBuild, IsNewVersionAvailable } = require("core/update");

const g_CurrentBuild = GetCurrentBuild();
IsNewVersionAvailable({ Timeout: 5000 }, (RequestError, bAvailable) => {
	if (RequestError) {
		throw RequestError;
	}

	console.log(`A newer release than ${g_CurrentBuild.Version} is available: ${bAvailable}`);
});
```

### `AnnounceAvailableUpdate`

SourceJS calls this once per successful load. Call it explicitly only when another check is wanted.

```js
const { AnnounceAvailableUpdate } = require("core/update");

AnnounceAvailableUpdate();
```

### `SetUpdateInProgress`

```js
const {
	GetBuildDownloadURL,
	GetCurrentBuild,
	IsUpdateInProgress,
	SetUpdateInProgress,
} = require("core/update");

if (IsUpdateInProgress()) {
	throw new Error("The SourceJS update flag is already set.");
}

SetUpdateInProgress(true);

let g_bUpdateFlagReleased = false;
const g_ReleaseUpdateFlag = () => {
	if (g_bUpdateFlagReleased) {
		return;
	}

	g_bUpdateFlagReleased = true;
	SetUpdateInProgress(false);
};

try {
	const CurrentBuild = GetCurrentBuild();
	const Options = {
		SDKBranch: CurrentBuild.SDKBranch,
		Platform: CurrentBuild.Platform,
		Architecture: CurrentBuild.Architecture,
		Timeout: 5000,
	};
	GetBuildDownloadURL(Options, (RequestError, strDownloadURL) => {
		try {
			if (RequestError) {
				throw RequestError;
			}

			console.log(`Update flag is ${IsUpdateInProgress() ? "set" : "clear"}; selected artifact: ${strDownloadURL}.`);
		} finally {
			g_ReleaseUpdateFlag();
		}
	});
} catch (Error) {
	g_ReleaseUpdateFlag();
	throw Error;
}
```

### `IsUpdateInProgress`

```js
const { IsUpdateInProgress, SetUpdateInProgress } = require("core/update");

if (IsUpdateInProgress()) {
	throw new Error("The SourceJS update flag is already set.");
}

SetUpdateInProgress(true);

try {
	console.log(`Update flag is set: ${IsUpdateInProgress()}. This example does not install an update.`);
} finally {
	SetUpdateInProgress(false);
}
```

## Safe use

- Except for `AnnounceAvailableUpdate()`, every network helper requires an options object and a callable callback. It normally returns `undefined`, not an HTTP response, artifact, or request ID. Receive the result through the callback; on failure, the helper passes only `Error`, leaving the result argument `undefined`.
- GitHub payload keys such as `tag_name`, `published_at`, `assets`, and `browser_download_url` retain their exact external API spelling; they are not project-owned PascalCase fields.
- The examples throw inside callbacks for demonstration. An asynchronous callback exception cannot be caught by a `try`/`catch` around request submission; handle callback failures explicitly at that callback boundary.
- Release requests are asynchronous by default, each on its own worker thread; callbacks run on the Source server thread. Pass a bounded timeout. JavaScript requires a positive safe integer in milliseconds, and the native CPR parser additionally rejects values outside its signed 32-bit integer range; JavaScript validation alone does not prove native acceptance.
- Invalid arguments, unsupported platform or architecture values, and queue-admission failures throw before return. Transport errors, non-success HTTP responses, invalid JSON, malformed release assets, and a missing matching artifact are passed to the completion callback as `Error`.
- `FetchJSON()` and `GetLatestRelease()` pass parsed JSON to the callback without validating a release-object schema. Check the object and fields before accessing them, as the examples do. Other helpers validate only the fields they consume, not every release property.
- `GetBuildDownloadURL()` passes the first matching URL to its callback after lowercasing the SDK branch and normalizing supported platform and architecture aliases; matching uses the asset basename case-insensitively, without the query or fragment. It does not validate the URL's scheme/host, inspect archive contents, verify signatures, download, or install anything. Validate trust and contents separately before using an artifact.
- `IsNewVersionAvailable()` and the startup check compare stable `MAJOR.MINOR.PATCH` versions numerically. An optional `v` prefix and build metadata do not affect precedence. Malformed versions and prerelease suffixes are rejected.
- `IsUpdateInProgress()` and `SetUpdateInProgress()` expose a module-local boolean, not an atomic lock or evidence of an actual update. Keep the flag set until the completion callback, and clear it on both callback failure and synchronous request-admission failure. The flag assumes no concurrent or reentrant writer changes it; provide separate synchronization when that assumption is invalid.
- HTTP helpers forward `Options.Blocking` only when it is an own property; an inherited value is not forwarded to CPR. For work that must finish before the game-frame loop starts, pass `Blocking: true`, a bounded `Timeout`, and the required callback; the callback runs before the helper returns. Blocking waits for that request, not every queued request, and never replaces the callback with a directly returned response. The default remains asynchronous; see [`cpr.md`](cpr.md).

## Related files

- [`packages/sourcejs/core/update.js`](../../packages/sourcejs/core/update.js) — validation, release lookup, artifact selection, and update-state implementation.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — native `core/update` installation, five direct build-metadata strings, and the `GetCurrentBuild()` callback.
- [`cpr.md`](cpr.md) — asynchronous and opt-in blocking HTTP request contract used by this package.
- [`core.md`](core.md) — core runtime module loading and shared lifecycle utilities.
