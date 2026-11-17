# `require("extensions")`

> Warning: this page is maintained by hand from `ExtensionManager` and the native V8 binding. Keep lifecycle, selector, filesystem, and return-value details synchronized with the implementation.

The `extensions` module controls native SourceJS extension libraries. It lists loaded libraries and any awaiting cleanup, loads a named extension directly from disk, unloads or reloads active libraries, and persists disabled names across server restarts. ABI 3 extensions publish native V8 callbacks that plugins load through `require()`.

Use this module for administrative tooling on the game thread. Library loading, filesystem access, and extension callbacks run synchronously; they are not worker-queue requests. Do not perform these operations every tick or unload an extension that any loaded plugin or extension still needs.

Related documentation:

- [Extension model](../architecture.md#extension-model)
- [`sjs extensions` commands](../runtime-commands.md#extensions)
- [Runtime paths](paths.md)

## Contents

- [Import](#import)
- [Extension layout](#extension-layout)
- [JavaScript modules](#javascript-modules)
- [Lifecycle](#lifecycle)
- [Selectors](#selectors)
- [Exports](#exports)
- [Inspect loaded extensions](#inspect-loaded-extensions)
- [Load from disk](#load-from-disk)
- [Unload and restore](#unload-and-restore)
- [Reload by name](#reload-by-name)
- [Reload by current index](#reload-by-current-index)
- [Disable and enable](#disable-and-enable)
- [Reload every enabled extension](#reload-every-enabled-extension)
- [Errors and ownership](#errors-and-ownership)

## Import

```js
const {
	DisableExtension,
	EnableExtension,
	GetLoadedExtensions,
	LoadExtension,
	ReloadAllExtensions,
	ReloadExtension,
	UnloadAllExtensions,
	UnloadExtension,
} = require("extensions");

const g_VerifyExtensionOperations = () => {
	const vecExtensionOperations = [
		DisableExtension,
		EnableExtension,
		GetLoadedExtensions,
		LoadExtension,
		ReloadAllExtensions,
		ReloadExtension,
		UnloadAllExtensions,
		UnloadExtension,
	];
	for (const ExtensionOperation of vecExtensionOperations) {
		if (typeof ExtensionOperation !== "function") {
			throw new Error("The native extensions module has an incomplete lifecycle surface.");
		}
	}
};

g_VerifyExtensionOperations();
```

The package exports a context-local API object backed by the native module. It exposes the eight PascalCase function names below without lowercase aliases, a default export, a discovery snapshot, or a JavaScript fallback manager.

## Extension layout

An extension name identifies a directory below `addons/sourcejs/extensions`:

```text
addons/sourcejs/extensions/echo/
	extension.json
	bin/
		windows-x86/
			echo.dll
		windows-x64/
			echo.dll
		linux-x86/
			echo.so
		linux-x64/
			echo.so
```

Without an explicit manifest `Binary` field, SourceJS first checks `bin/<platform>-<architecture>/<name>.dll` on Windows or `.so` on Linux, then falls back to `bin/<name>.dll` or `.so`. A relative `Binary` value in `extension.json` overrides that default. The manager does not sandbox an overridden binary path; install only trusted manifests and native libraries.

`Autoload` defaults to `true`. Setting `"Autoload": false` keeps the extension available for an explicit `LoadExtension()` or `EnableExtension()` call while excluding it from startup and `ReloadAllExtensions()` scans. The runtime ZIP includes no native extension examples or headers; clone the repository to develop an extension. Controls are case-sensitive: manifests containing legacy `binary` or `autoload` keys are rejected before loading a native library, even when the canonical controls are also present. Rename these controls to `Binary` and `Autoload`; there are no aliases. This avoids silently replacing an old binary override or enabling startup loading after ignoring `autoload: false`. Descriptive `Name` and `Description` keys do not control loading; the directory still selects the extension name.

The library exports `SourceJS_GetNativeExtensionAPI` and must match the requested ABI version, record size and V8 ABI tag. Compile it with the headers, architecture and V8 feature configuration of the host; do not link a second V8 engine. ABI 2 binaries are rejected and must be rebuilt.

The load context, its strings and the local context handle are borrowed until the callback returns. The root path is the addon root in native narrow filesystem encoding; SDK branch, platform and architecture are ASCII. Native code is trusted server code. Callbacks must not re-enter the extension manager or let C++ exceptions escape. A load callback that returns false must clean up its own partial state. Unload must release extension-owned persistent handles, unregister external callbacks and stop or join owned work. Do not install process-wide V8 callbacks or use the extension isolate on another thread.

## JavaScript modules

An ABI 3 library registers real C++ V8 callbacks through `m_pGetModuleCount`
and `m_pGetModule`. The host reads the descriptor table at load time. It
requires 1–128 modules per extension and 1–256 functions per module, with no
duplicate names or missing callbacks. Module names are slash-separated ASCII
paths using letters, digits, `_`, `-`, and `.`, with no empty, `.` or `..`
segments. Function names start with an uppercase letter and use only ASCII
letters, digits and `_`. Individual names are shorter than 256 bytes.

Each loaded extension owns one V8 isolate and context. Its callbacks may
include `v8.h` and use the same V8 engine as SourceJS inside that isolate.
The library does not supply JavaScript source. SourceJS publishes host-owned
functions under `extensions/<extension-name>/<module-name>` and caches them
per plugin context. Package files cannot shadow that reserved namespace.

```js
const { Echo } = require("extensions/echo/echo");

const g_strEchoValue = Echo("SourceJS");
if (g_strEchoValue !== "SourceJS") {
	throw new Error("The extension did not return the supplied value.");
}
```

Build and load the [native example](../../examples/extensions/echo/README.md)
before running this snippet. Calls are synchronous on the game thread. They
copy arguments and results through V8 structured cloning, preserving numeric
types, `BigInt`, typed-array bytes, and object graphs without sharing
identity or backing memory. There is no transfer list or host object
serializer. Functions, promises, shared memory and native wrappers with
internal fields cannot cross. Do not pass engine handles as a way to share
live objects. Calls accept at most 1,024 arguments; each serialized payload
is limited to 16 MiB. Callbacks receive ordinary arguments, not the plugin's
`this`. SourceJS does not pump extension microtasks or deliver asynchronous
results across this boundary. Extensions should avoid blocking the game thread.

An unload invalidates the cached module and permanently revokes all of its
host functions, including references that a plugin already saved. A later
load publishes new functions with different IDs. Old functions throw
instead of calling the replacement. Previously copied data is still usable.
An unload requested during an active call is rejected; retry after it
returns. On success, SourceJS calls the cleanup callback in the extension
isolate, clears host-owned persistent handles, destroys the isolate, and
only then releases its native library handle. If cleanup fails, the
functions stay revoked and the library is retained for a cleanup retry.
If another owner keeps a loader reference, SourceJS does not decrement
that reference or report successful removal. Release it and retry unload.

## Lifecycle

During SourceJS startup, the manager scans the extension root and attempts to load each directory whose name is not in the disabled-name list stored in `addons/sourcejs/data/ExtensionsState.json` and whose manifest permits autoload. This host-managed state file contains extension names, not paths. Duplicate valid entries are ignored, but malformed state or an invalid name rejects the entire file after the in-memory disabled set has been cleared; no names from that file remain disabled. This scan is not exposed as a discovery list: `GetLoadedExtensions()` contains active records only.

An unload removes the active record. A later `LoadExtension(strExtensionName)` constructs a new record from the directory and manifest on disk. `ReloadAllExtensions()` unloads the active set, rescans the extension root, and loads every enabled directory whose manifest permits autoload.

## Selectors

`LoadExtension(strExtensionName)` accepts only an extension directory name. A decimal string is rejected because loading by a stale list position could select a different library after another unload.

`UnloadExtension`, `ReloadExtension`, `DisableExtension`, and `EnableExtension` accept either an exact name or a selector string:

- the exact extension name;
- a one-based decimal string from the current `GetLoadedExtensions()` order, such as `"2"`.

Use the exact name whenever the extension is not loaded. In particular, a disabled extension is absent from `GetLoadedExtensions()`, so `EnableExtension` normally needs its directory name rather than its former index.

## Exports

| Export | Signature | Result | Behavior |
| --- | --- | --- | --- |
| `GetLoadedExtensions` | `GetLoadedExtensions()` | `string[]` | Current active-extension display lines, or `["No extensions loaded."]`. |
| `LoadExtension` | `LoadExtension(strExtensionName)` | `boolean` | Loads one enabled extension directory by name; an already loaded name succeeds. |
| `UnloadExtension` | `UnloadExtension(strExtensionSelector)` | `boolean` | Calls the unload callback, closes the library, and removes its active record. |
| `ReloadExtension` | `ReloadExtension(strExtensionSelector)` | `boolean` | Resolves an active record, unloads it, then loads the same name from disk. |
| `UnloadAllExtensions` | `UnloadAllExtensions()` | `true` | Attempts to unload every active extension; continues after individual unload failures. |
| `ReloadAllExtensions` | `ReloadAllExtensions()` | `true` | Attempts to unload all, rescans disk, and attempts to load every enabled directory whose manifest permits autoload. |
| `DisableExtension` | `DisableExtension(strExtensionSelector)` | `boolean` | Unloads the selected extension when active, marks its name disabled, and attempts to save the disabled set. |
| `EnableExtension` | `EnableExtension(strExtensionSelector)` | `boolean` | Clears the disabled name and immediately loads the extension. |

The complete public surface has eight function names, with no lowercase aliases.

Every name or selector argument must be a non-empty JavaScript string; omitted arguments, non-strings, and empty strings raise a JavaScript error rather than being coerced. Individual load, unload, and reload failures return `false` and are logged. The bulk operations' `true` result means the operation returned normally, not that every library loaded or unloaded successfully: inspect the active list and logs. Native allocation failures and V8 installation failures may instead raise a JavaScript error.

## Inspect loaded extensions

`GetLoadedExtensions()` returns console-ready text, not record objects. Each active line contains its one-based position, exact name, state, and resolved binary path.

```js
const { GetLoadedExtensions } = require("extensions");
const { LogInfo } = require("loggers");

const g_InspectLoadedExtensions = () => {
	const IsNonStringExtensionLine = (strExtensionLine) => typeof strExtensionLine !== "string";
	const vecLoadedExtensionLines = GetLoadedExtensions();
	if (!Array.isArray(vecLoadedExtensionLines) || vecLoadedExtensionLines.some(IsNonStringExtensionLine)) {
		throw new Error("GetLoadedExtensions() returned an invalid result.");
	}

	for (const strExtensionLine of vecLoadedExtensionLines) {
		LogInfo("GetLoadedExtensions %s", strExtensionLine);
	}
};

g_InspectLoadedExtensions();
```

A typical line is:

```text
1. echo [loaded, enabled] .../addons/sourcejs/extensions/echo/bin/windows-x86/echo.dll
```

Treat the text as an administrative display contract. Keep the extension name separately when application logic needs a stable identifier.

## Load from disk

This example loads the `echo` directory directly through canonical `LoadExtension`. It works whether `echo` was already active or needs to be opened from disk.

```js
const { GetLoadedExtensions, LoadExtension } = require("extensions");

const g_VerifyExtensionLoad = () => {
	const strExtensionName = "echo";
	const HasActiveExtensionLine = (strExtensionLine) => strExtensionLine.includes(`. ${strExtensionName} [`);
	if (!LoadExtension(strExtensionName)) {
		throw new Error(`Could not load the ${strExtensionName} extension.`);
	}

	const bExtensionActive = GetLoadedExtensions().some(HasActiveExtensionLine);
	if (!bExtensionActive) {
		throw new Error(`${strExtensionName} loaded but is absent from the active list.`);
	}
};

g_VerifyExtensionLoad();
```

`LoadExtension()` never selects from a cached discovery result. An already loaded name succeeds without reopening its binary or rereading the manifest. For a new load, it resolves `addons/sourcejs/extensions/<strExtensionName>` and the current platform binary at call time; use `ReloadExtension()` when an active extension must be refreshed from disk.

## Unload and restore

`UnloadExtension` removes the record from `GetLoadedExtensions()`. The `finally` block attempts to restore the extension even when validation fails and reports a failed restoration.

```js
const { GetLoadedExtensions, LoadExtension, UnloadExtension } = require("extensions");

const g_VerifyExtensionUnloadAndRestore = () => {
	const strExtensionName = "echo";
	const HasSelectedExtensionLine = (strExtensionLine) => strExtensionLine.includes(`. ${strExtensionName} [`);
	if (!LoadExtension(strExtensionName)) {
		throw new Error(`Could not prepare ${strExtensionName}.`);
	}

	let OperationFailure = null;
	try {
		if (!UnloadExtension(strExtensionName)) {
			throw new Error(`Could not unload ${strExtensionName}.`);
		}

		const bExtensionStillLoaded = GetLoadedExtensions().some(HasSelectedExtensionLine);
		if (bExtensionStillLoaded) {
			throw new Error(`${strExtensionName} remained in the active list.`);
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!LoadExtension(strExtensionName)) {
				throw new Error(`Could not restore ${strExtensionName}.`);
			}
		} catch (RestorationError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, RestorationError], "Extension operation and restoration both failed.");
			}

			throw RestorationError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}
};

g_VerifyExtensionUnloadAndRestore();
```

SourceJS revokes every registered binding on unload. Extensions must still release any dependencies they created outside the managed isolate before the library can be closed.

## Reload by name

`ReloadExtension` resolves the active record first. It cannot reload an extension that is not loaded; use `LoadExtension` to prepare it and `GetLoadedExtensions` to validate the result.

```js
const { GetLoadedExtensions, LoadExtension, ReloadExtension } = require("extensions");

const g_VerifyExtensionReloadByName = () => {
	const strExtensionName = "echo";
	const HasSelectedExtensionLine = (strExtensionLine) => strExtensionLine.includes(`. ${strExtensionName} [`);
	if (!LoadExtension(strExtensionName)) {
		throw new Error(`Could not prepare ${strExtensionName}.`);
	}

	if (!ReloadExtension(strExtensionName)) {
		throw new Error(`Could not reload ${strExtensionName}.`);
	}

	if (!GetLoadedExtensions().some(HasSelectedExtensionLine)) {
		throw new Error(`${strExtensionName} disappeared after reload.`);
	}
};

g_VerifyExtensionReloadByName();
```

The new load rereads `extension.json`, resolves the binary again, validates the ABI again, and receives a fresh native load context. Existing plugin JavaScript contexts are not recreated.

## Reload by current index

An index is a one-based decimal string derived from the current `GetLoadedExtensions` result. Use `LoadExtension` to make the extension active, then resolve its index immediately before `ReloadExtension` because any unload can renumber later entries.

```js
const { GetLoadedExtensions, LoadExtension, ReloadExtension } = require("extensions");

const g_VerifyExtensionReloadByCurrentIndex = () => {
	const strExtensionName = "echo";
	const IsSelectedExtensionLine = (strExtensionLine) => strExtensionLine.includes(`. ${strExtensionName} [`);
	if (!LoadExtension(strExtensionName)) {
		throw new Error(`Could not prepare ${strExtensionName}.`);
	}

	const vecCurrentExtensionLines = GetLoadedExtensions();
	const nZeroBasedExtensionIndex = vecCurrentExtensionLines.findIndex(IsSelectedExtensionLine);
	if (nZeroBasedExtensionIndex < 0) {
		throw new Error(`${strExtensionName} has no current list index.`);
	}

	const strExtensionSelector = String(nZeroBasedExtensionIndex + 1);
	if (!ReloadExtension(strExtensionSelector)) {
		throw new Error(`Could not reload extension selector ${strExtensionSelector}.`);
	}
};

g_VerifyExtensionReloadByCurrentIndex();
```

`LoadExtension("1")` is intentionally invalid. Use the extension name for loads and the current decimal selector only for operations on active records.

## Disable and enable

`DisableExtension` unloads the active library, adds its name to the in-memory disabled set, and attempts to save that set. `EnableExtension` clears the name and attempts to save before loading the directory immediately. State-file failures are logged but do not change these return values; success does not guarantee persistence across restart. A failed enable does not restore the prior disabled state. Use `GetLoadedExtensions` and the logs to observe the actual transition.

If unloading reports failure, `DisableExtension()` stops before marking the name disabled. A cleanup failure leaves the library loaded but its bindings revoked. Inspect the log and retry cleanup before disabling it.

```js
const { DisableExtension, EnableExtension, GetLoadedExtensions, LoadExtension } = require("extensions");

const g_VerifyExtensionDisableAndEnable = () => {
	const strExtensionName = "echo";
	const HasSelectedExtensionLine = (strExtensionLine) => strExtensionLine.includes(`. ${strExtensionName} [`);
	if (!LoadExtension(strExtensionName)) {
		throw new Error(`Could not prepare ${strExtensionName}.`);
	}

	let OperationFailure = null;
	try {
		if (!DisableExtension(strExtensionName)) {
			throw new Error(`Could not disable ${strExtensionName}.`);
		}

		if (GetLoadedExtensions().some(HasSelectedExtensionLine)) {
			throw new Error(`${strExtensionName} remained loaded after disable.`);
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (!EnableExtension(strExtensionName)) {
				throw new Error(`Could not enable and restore ${strExtensionName}.`);
			}
		} catch (RestorationError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, RestorationError], "Extension operation and restoration both failed.");
			}

			throw RestorationError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}
};

g_VerifyExtensionDisableAndEnable();
```

An enabled extension whose manifest permits autoload will be considered by the next startup scan and `ReloadAllExtensions()`. Explicit `EnableExtension()` loads immediately even with `"Autoload": false`. A disabled extension is skipped by autoload even though its directory remains on disk.

## Reload every enabled extension

`UnloadAllExtensions()` and `ReloadAllExtensions()` are maintenance operations. The example checks the active list after unload and uses `finally` to request an autoload scan. That scan does not restore explicitly loaded extensions whose manifests specify `"Autoload": false`; restore those by name when required.

```js
const { GetLoadedExtensions, ReloadAllExtensions, UnloadAllExtensions } = require("extensions");
const { LogInfo } = require("loggers");

const g_VerifyExtensionAutoloadScan = () => {
	let OperationFailure = null;
	try {
		if (UnloadAllExtensions() !== true) {
			throw new Error("The bulk unload did not return normally.");
		}

		const vecExtensionLinesAfterUnload = GetLoadedExtensions();
		if ((vecExtensionLinesAfterUnload.length !== 1) || (vecExtensionLinesAfterUnload[0] !== "No extensions loaded.")) {
			throw new Error("The active extension registry was not cleared.");
		}
	} catch (ErrorValue) {
		OperationFailure = { Value: ErrorValue };
	} finally {
		try {
			if (ReloadAllExtensions() !== true) {
				throw new Error("The autoload scan did not return normally.");
			}
		} catch (RestorationError) {
			if (OperationFailure !== null) {
				throw new AggregateError([OperationFailure.Value, RestorationError], "Extension operation and restoration both failed.");
			}

			throw RestorationError;
		}
	}

	if (OperationFailure !== null) {
		throw OperationFailure.Value;
	}

	const vecExtensionLinesAfterScan = GetLoadedExtensions();
	for (const strExtensionLine of vecExtensionLinesAfterScan) {
		LogInfo("GetLoadedExtensions %s", strExtensionLine);
	}
};

g_VerifyExtensionAutoloadScan();
```

Run this only when dependent plugins have been stopped or when the extension set is known to be independent of the caller.

The restoration examples attempt their recovery operation after success or failure. They rethrow a sole original failure unchanged, or use `AggregateError` containing the operation failure followed by the restoration failure when both occur. Restoration requests a new load or autoload scan; it does not roll back the previous binary, native state, module objects, or persisted settings.

## Errors and ownership

- The module is available before a map starts because `ExtensionManager` belongs to the SourceJS core lifecycle, not the current server map.
- All functions are synchronous and execute on the calling server thread.
- Native list/string parsing and lifecycle callbacks preserve V8 exceptions/termination and translate C++
  exceptions at the boundary. String outputs and callback results are committed only after their checks succeed;
  numeric selectors are not coerced to strings. This does not roll back an extension operation's side effects.
- `false` means the requested manager operation failed, not that nothing changed. An unload callback failure returns `false` after revoking the bindings but before closing the library. Inspect the SourceJS log for the filesystem, binary, symbol, ABI, callback, or selector reason.
- `GetLoadedExtensions()` rejects more than `2147483647` native result lines before narrowing to the signed length accepted by `v8::Array::New`; it never publishes a partially built array.
- Native list construction checks own indexed-property creation, bypassing inherited setters, and checks the
  count before narrowing. This protects result publication, not the lifetime or validity of extension-owned data.
- Closing a library during `UnloadExtension()` or `DisableExtension()` revokes its published functions. Any external native dependencies remain the extension author's responsibility.
- `ReloadExtension()` performs an unload followed by a fresh disk load; state survives only when the extension stores and restores it explicitly.
- The one-based index is transient. Names are the stable administrative identifiers.
- Passing a number, empty string, object, `null`, or `undefined` where a name or selector is required throws directly from the native V8 binding.
