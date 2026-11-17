# `require("core")`

> Warning: this API reference is large for AI-agent processing. Use the table of contents to navigate by section.

## Contents

- [Location and purpose](#location-and-purpose)
- [Import](#import)
- [Exports](#exports)
- [`MessageSeverity`](#messageseverity)
- [`OutputReturn`](#outputreturn)
- [Core Info](#core-info)
- [Server Output Entry](#server-output-entry)
- [Server Output Capture](#server-output-capture)
- [`AutomaticUnload`](#automaticunload)
- [`ConfigurationFile`](#configurationfile)
- [`Tokenizer`](#tokenizer)
- [`WeakAutomaticUnload`](#weakautomaticunload)
- [Examples](#examples)
- [Safe use](#safe-use)
- [Related files](#related-files)

## Location and purpose

The implementation lives in [`packages/sourcejs/core.js`](../../packages/sourcejs/core.js). It aggregates lifecycle ownership, configuration-file parsing, tokenization, console and server-output helpers, checksums, runtime metadata, public-package discovery, and engine-interface lookup. Use this module for shared runtime facilities that do not belong to a narrower SourceJS package.

## Import

```js
const { AutomaticUnload, CaptureServerOutput, OutputReturn } = require("core");
```

## Exports

| Export | Kind | Signature |
| --- | --- | --- |
| [`AutomaticUnload`](#automaticunload-1) | Class | `new AutomaticUnload(Owner = "global")` |
| [`CaptureServerOutput`](#captureserveroutput) | Function | `CaptureServerOutput(unOutputAction = OutputReturn.CONTINUE, CaptureCallback = null)` |
| [`CheckInformationOutput`](#checkinformationoutput) | Function | `CheckInformationOutput(strInformationOutput)` |
| [`ConfigurationFile`](#configurationfile-1) | Class | `new ConfigurationFile(strFilePath, Options = {})` |
| [`CreateChecksum`](#createchecksum) | Function | `CreateChecksum(strChecksumData, bIgnoreWhitespace = true)` |
| [`GetCoreModules`](#getcoremodules) | Function | `GetCoreModules()` |
| [`GetGlobalInfo`](#getglobalinfo) | Function | `GetGlobalInfo()` |
| [`GetPublicIPAddress`](#getpublicipaddress) | Function | `GetPublicIPAddress(URLOrCallback, Callback)` or `GetPublicIPAddress(Callback)`; `URLOrCallback` accepts a non-empty URL string or `undefined` for `"https://api.ipify.org/"`, or the callback in the one-argument form. |
| [`GetPublicPackages`](#getpublicpackages) | Function | `GetPublicPackages()` |
| [`GetSourceEngineInterface`](#getsourceengineinterface) | Function | `GetSourceEngineInterface(strInterfaceName)` |
| [`GetSourceJSVersion`](#getsourcejsversion) | Function | `GetSourceJSVersion()` |
| [`MessageSeverity`](#messageseverity-1) | Frozen object | Numeric server-output severity values. |
| [`OutputReturn`](#outputreturn-1) | Frozen object | Numeric server-output listener actions. |
| [`RunIgnoringUnicodeErrors`](#runignoringunicodeerrors) | Function | `RunIgnoringUnicodeErrors(Callback, FallbackValue = "")` |
| [`ReplaceEscapedSequences`](#replaceescapedsequences) | Function | `ReplaceEscapedSequences(strEscapedText)` |
| [`SendConsoleMessage`](#sendconsolemessage) | Function | `SendConsoleMessage(Message)` |
| [`Tokenizer`](#tokenizer-1) | Class | `new Tokenizer(strText = "", Options = {})` |
| [`WeakAutomaticUnload`](#weakautomaticunload-1) | Class | `new WeakAutomaticUnload(Owner = "global")` |
| [`GAME_NAME`](#game_name) | Read-only getter | Runtime game-root filename component, obtained through `GetGlobalInfo()`. |
| [`MODULE_NAME`](#module_name) | Constant | Native module name (`"core"`). |
| [`PLATFORM`](#platform) | Read-only getter | Build target platform, obtained through `GetGlobalInfo()`. |
| [`SOURCE_ENGINE`](#source_engine) | Read-only getter | Engine family, obtained through `GetGlobalInfo()`. |
| [`SOURCE_ENGINE_BRANCH`](#source_engine_branch) | Read-only getter | Compiled Source engine SDK branch, obtained through `GetGlobalInfo()`. |

`GetPublicIPAddress` submits one asynchronous [CPR](cpr.md) `Get(Options, Callback)` request with a 3000 ms timeout and returns `undefined`, not a request handle. The required callback runs in the owning JavaScript context on the game thread. Success calls `Callback(null, strIPAddress)` with the trimmed response text for an HTTP status from 200 through 299; it does not validate the address format. A request or HTTP error calls `Callback(RequestError)` without a second argument. Invalid arguments throw before submitting a request.

## `MessageSeverity`

| Member | Value |
| --- | --- |
| `MESSAGE` | `0` |
| `WARNING` | `1` |
| `ASSERT` | `2` |
| `ERROR` | `3` |
| `LOG` | `4` |

## `OutputReturn`

| Member | Value |
| --- | --- |
| `BLOCK` | `0` |
| `CONTINUE` | `1` |

## Core Info

`GetGlobalInfo()` returns a new object with these PascalCase build and runtime fields:

| Member | Signature |
| --- | --- |
| `Architecture` | Build target architecture. |
| `GameName` | Filename component of the runtime game-root path. |
| `GitCommit` | SourceJS build commit. |
| `Platform` | Build target platform. |
| `Runtime` | Runtime identifier (`"v8"`). |
| `SDKBranch` | Compiled HL2SDK branch. |
| `SourceEngine` | Engine family (`"source"`). |
| `SourceEngineBranch` | Compiled Source engine SDK branch, matching `SDKBranch`. |
| `Version` | SourceJS version. |

## Server Output Entry

`CaptureServerOutput()` records each emitted server-output entry with these fields:

| Member | Signature |
| --- | --- |
| `Message` | Captured server-output text. |
| `Severity` | Numeric `MessageSeverity` value. |

## Server Output Capture

Without a callback, `CaptureServerOutput()` returns the object below. With a callback, it passes the live entries array to that callback and returns its result after attempting listener removal exactly once; it does not await a returned promise. Successful cleanup preserves an exact thrown callback value. A cleanup failure after a successful callback propagates as before; if both callback and cleanup fail, an `AggregateError` preserves the callback and cleanup failures in that order, including falsy thrown values.

| Member | Signature |
| --- | --- |
| `OutputEntries` | Live array of captured server-output entries. |
| `CloseServerOutputCapture` | `CloseServerOutputCapture()` returns `true` after successful removal; `false` if already closed or native removal returns false. A failed removal leaves it open for retry; native exceptions propagate. |

## `AutomaticUnload`

| Member | Signature |
| --- | --- |
| `Instances` | Static map of owners to registered instances. |
| `Owner` | Writable field containing the normalized owner assigned at construction. |
| [`AddUnloadInstance`](#automaticunloadaddunloadinstance) | `AddUnloadInstance(Owner = this.Owner)` appends this instance and returns it; duplicates are allowed and `Owner` is not changed. |
| [`UnloadInstance`](#automaticunloadunloadinstance) | `UnloadInstance()` must be implemented by a subclass; the base method throws. |
| [`UnloadOwnerInstances`](#automaticunloadunloadownerinstances) | Static `UnloadOwnerInstances(Owner)` |
| [`ClearOwnerInstances`](#automaticunloadclearownerinstances) | Static `ClearOwnerInstances(Owner)` |

Construction accepts any owner value convertible by `String()`, normalizes it with `String(Owner ?? "global")`, and immediately registers the instance. `UnloadOwnerInstances()` invokes a snapshot in reverse registration order. After each normally returning call, it removes the last matching registration only if that owner's array is still the same array; callbacks can change the registry. On normal completion it returns the snapshot length, ignoring callback results and not awaiting promises. A thrown exception stops the pass before removal of that invocation; earlier cleanup is not rolled back. `ClearOwnerInstances()` removes the owner entry without invoking any instance and returns the number of discarded registrations. Both static methods return `0` for an absent owner and throw for a present non-array registry value.

## `ConfigurationFile`

### Options

| Option | Signature |
| --- | --- |
| `CommentPrefix` | Non-empty string marking an ignored remainder at a token boundary outside quotes. Omitted, `undefined`, or `null` uses `"//"`; unlike `Tokenizer`, `null` does not disable comments here. |
| `AsStrings` | Boolean, default `false` (also for `null`). When true, store each row with tokens as `Tokenizer.toString()` instead of a `Tokenizer`; escape sequences are processed first, and comments recognized outside quotes at token boundaries are removed. |

### Members

| Member | Signature |
| --- | --- |
| `FilePath` | Path used for reading: the requested path if it exists, otherwise a spelling prefixed with `CONFIG_ROOT` from `paths`. It is not necessarily absolute or canonical, and does not guarantee containment within that root. |
| `[Symbol.species]` | Static getter returning `Array`; species-aware operations such as `map()` and `filter()` create plain arrays. |
| `[Symbol.iterator]` | Inherited `[Symbol.iterator]()` over parsed `Tokenizer` rows or source strings. |

## `Tokenizer`

### Options

| Option | Signature |
| --- | --- |
| `CommentPrefix` | Non-empty string marking an ignored remainder at a token boundary outside quotes. Omitted, `undefined`, or `null` disables comment removal. |

### Members

| Member | Signature |
| --- | --- |
| `SourceText` | Writable string containing the original text, or the prefix before a recognized comment with trailing whitespace removed. Changing token elements does not recompute it. |
| `[Symbol.species]` | Static getter returning `Array`; species-aware operations such as `map()` and `filter()` create plain arrays. |
| `toString` | `toString()` returns `SourceText`, not the current tokens joined together. |
| `GetTokenHash` | `GetTokenHash()` returns the lowercase 32-character MD5 hexadecimal digest of `SourceText`, including whitespace; it does not hash the current token array. |
| `[Symbol.iterator]` | Inherited `[Symbol.iterator]()` over parsed tokens. |

## `WeakAutomaticUnload`

| Member | Signature |
| --- | --- |
| `Instances` | Static map from normalized owner strings to maps of registration tokens and `WeakRef` values. |
| `Owner` | Inherited writable field initialized to the normalized owner; changing it affects the default owner used by `AddUnloadInstance()`. |
| [`AddUnloadInstance`](#weakautomaticunloadaddunloadinstance) | Overridden `AddUnloadInstance(Owner = this.Owner)`; returns `this`. |
| `UnloadInstance` | Inherited `UnloadInstance()` method to override; the base implementation throws an error. |
| [`UnloadOwnerInstances`](#weakautomaticunloadunloadownerinstances) | Static `UnloadOwnerInstances(Owner)` |
| `ClearOwnerInstances` | Static `ClearOwnerInstances(Owner)` |

Each registration creates a separate weak reference; registering the same instance repeatedly can invoke it repeatedly. `UnloadOwnerInstances()` visits a snapshot in registration order, removes dead references, and removes each live reference after `UnloadInstance()` returns normally. It returns the number of completed live invocations, ignores their results, and does not await promises. A thrown exception stops the pass before removing that invocation's reference; earlier cleanup is not rolled back. `ClearOwnerInstances()` removes the owner entry without invoking live instances and returns the number of discarded references, including dead ones. Both static methods return `0` for an absent owner and throw for a present non-map registry value. Weak registration alone does not keep an instance alive or guarantee cleanup before garbage collection.

## Examples

### `AutomaticUnload`

```js
const { AutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class TickSubscription extends AutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("Tick", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("Tick", this.Callback)) {
			throw new Error("Unable to unregister the tick listener.");
		}

		this.Registered = false;

		return true;
	}
}

function RunTick() {
	// Run plugin work on each game tick.
}

const g_TickSubscription = new TickSubscription("my_plugin", RunTick);

exports.Unload = function UnloadPlugin() {
	return TickSubscription.UnloadOwnerInstances(g_TickSubscription.Owner);
};
```

### `ConfigurationFile`

```js
const { ConfigurationFile } = require("core");

const g_vecServerConfigurationRows = new ConfigurationFile("server.cfg", { CommentPrefix: "//" });
console.log(`Loaded configuration: ${g_vecServerConfigurationRows.FilePath}`);

for (const vecTokens of g_vecServerConfigurationRows) {
	console.log(`Command: ${vecTokens[0]}, arguments: ${vecTokens.slice(1).join(" ")}`);
}
```

### `ConfigurationFile` options

```js
const { ConfigurationFile } = require("core");

const g_vecServerConfigurationLines = new ConfigurationFile("server.cfg", { CommentPrefix: "//", AsStrings: true });
for (const strLine of g_vecServerConfigurationLines) {
	console.log(`Config source: ${strLine}`);
}
```

### `MessageSeverity`

```js
const { CaptureServerOutput, MessageSeverity, OutputReturn } = require("core");
const { ExecuteCommand } = require("commands");

function CaptureServerStatusOutput(vecOutput) {
	if (!ExecuteCommand("status")) {
		throw new Error("Unable to execute the status command.");
	}

	return vecOutput.slice();
}

const g_vecCapturedOutput = CaptureServerOutput(OutputReturn.CONTINUE, CaptureServerStatusOutput);
for (const OutputEntry of g_vecCapturedOutput) {
	if ((OutputEntry.Severity === MessageSeverity.WARNING) || (OutputEntry.Severity === MessageSeverity.ERROR)) {
		console.log(`Engine issue: ${OutputEntry.Message}`);
	}
}
```

### `OutputReturn`

```js
const { CaptureServerOutput, OutputReturn, SendConsoleMessage } = require("core");
const { ExecuteCommand } = require("commands");

function CaptureServerStatusOutput(vecOutput) {
	if (!ExecuteCommand("status")) {
		throw new Error("Unable to execute the status command.");
	}

	return vecOutput.slice();
}

const g_vecCapturedOutput = CaptureServerOutput(OutputReturn.BLOCK, CaptureServerStatusOutput);
SendConsoleMessage(`Captured ${g_vecCapturedOutput.length} status output entries with BLOCK requested.`);
```

### `Tokenizer`

```js
const { Tokenizer } = require("core");

const g_vecCommandTokenizer = new Tokenizer("exec \"sourcejs/gameplay.cfg\" // Load plugin settings.", { CommentPrefix: "//" });
const [g_strCommandName, g_strConfigurationPath] = g_vecCommandTokenizer;
console.log(`${g_strCommandName} will load ${g_strConfigurationPath}`);
```

### `WeakAutomaticUnload`

```js
const { WeakAutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class WeakLevelEndSubscription extends WeakAutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("LevelEnd", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("LevelEnd", this.Callback)) {
			throw new Error("Unable to unregister the level-end listener.");
		}

		this.Registered = false;

		return true;
	}
}

function ReportLevelEnd() {
	console.log("The current level ended.");
}

const g_LevelEndSubscription = new WeakLevelEndSubscription("my_plugin", ReportLevelEnd);

exports.Unload = function UnloadPlugin() {
	return WeakLevelEndSubscription.UnloadOwnerInstances(g_LevelEndSubscription.Owner);
};
```

### `CheckInformationOutput`

```js
const { CheckInformationOutput, CreateChecksum } = require("core");

const g_vecModuleLines = ["core", "commands", "events"];
const g_strChecksum = CreateChecksum(g_vecModuleLines.join(""));
const g_strInformationOutput = [
	`Checksum: ${g_strChecksum}`,
	...g_vecModuleLines,
	"--------------------------------",
].join("\n");
console.log(`Module list checksum mismatch: ${CheckInformationOutput(g_strInformationOutput)}`);
```

### `SendConsoleMessage`

```js
const { SendConsoleMessage } = require("core");

SendConsoleMessage("Example message from the core console helper.");
```

### `CreateChecksum`

`CreateChecksum(strChecksumData, bIgnoreWhitespace = true)` returns a lowercase 32-character MD5 hexadecimal digest of the UTF-8 input. By default it removes whitespace before encoding; pass `false` to hash the exact string, including embedded NUL characters. An empty string is valid. Invalid argument types throw `TypeError`; native encoding, input-size, or C++ failures throw `Error` instead of silently hashing an empty replacement. An existing JavaScript exception is preserved.

```js
const { CreateChecksum } = require("core");

const g_strConfigurationText = "sv_gravity \"800\"\nsourcejs_log_level \"2\"\n";
const g_strWhitespaceStrippedChecksum = CreateChecksum(g_strConfigurationText);
const g_strExactChecksum = CreateChecksum(g_strConfigurationText, false);
console.log(`Whitespace-stripped checksum: ${g_strWhitespaceStrippedChecksum}`);
console.log(`Exact checksum: ${g_strExactChecksum}`);
```

### `GAME_NAME`

```js
const { GAME_NAME, SendConsoleMessage } = require("core");

SendConsoleMessage(`Running on ${GAME_NAME}.`);
```

### `GetCoreModules`

```js
const { GetCoreModules } = require("core");

const g_vecCoreModules = GetCoreModules();
if (!g_vecCoreModules.includes("core")) {
	throw new Error("The native core module is not registered.");
}

console.log(g_vecCoreModules.join(", "));
```

### `GetSourceEngineInterface`

```js
const { GetSourceEngineInterface } = require("core");
const { GetAllInterfaceNames } = require("interfaces");

const [g_strInterfaceName] = GetAllInterfaceNames();
if (!g_strInterfaceName) {
	throw new Error("The engine exposed no interfaces.");
}

const g_ResolvedInterface = GetSourceEngineInterface(g_strInterfaceName);
if (!g_ResolvedInterface) {
	throw new Error(`Unable to resolve engine interface: ${g_strInterfaceName}`);
}

console.log(`${g_ResolvedInterface.Name}: ${g_ResolvedInterface.Address}`);
```

### `GetPublicIPAddress`

This asynchronous request contacts `https://api.ipify.org/` with a 3000 ms timeout, exposing the caller's network address to that service. The helper trims the successful response text but does not validate an IP address or prove that the game server is reachable at it. Its callback receives `(ErrorValue, strPublicIPAddress)`; `ErrorValue` is `null` on success, and network or non-success HTTP status failures are reported through `ErrorValue`.

```js
const { GetPublicIPAddress, SendConsoleMessage } = require("core");

GetPublicIPAddress((ErrorValue, strPublicIPAddress) => {
	if (ErrorValue) {
		SendConsoleMessage(`Public IP request failed: ${ErrorValue.message}`);
		return;
	}

	SendConsoleMessage(`Public IP service response: ${strPublicIPAddress}`);
});
```

### `GetPublicPackages`

```js
const { GetPublicPackages } = require("core");

const g_vecPublicPackages = GetPublicPackages();
console.log(`Public packages (${g_vecPublicPackages.length}): ${g_vecPublicPackages.join(", ")}`);
```

### `RunIgnoringUnicodeErrors`

```js
const { RunIgnoringUnicodeErrors } = require("core");

function DecodeInvalidName() {
	return decodeURIComponent("%E0%A4%A");
}

const g_strDecodedName = RunIgnoringUnicodeErrors(DecodeInvalidName, "<invalid UTF-8 player name>");
console.log(g_strDecodedName);
```

### `GetGlobalInfo`

```js
const { GetGlobalInfo, SendConsoleMessage } = require("core");

const g_GlobalInformation = GetGlobalInfo();
const g_strSummary = [
	`SourceJS ${g_GlobalInformation.Version} (${g_GlobalInformation.GitCommit})`,
	`runtime=${g_GlobalInformation.Runtime}`,
	`game=${g_GlobalInformation.GameName}`,
	`engine=${g_GlobalInformation.SourceEngine}/${g_GlobalInformation.SourceEngineBranch}`,
	`SDK=${g_GlobalInformation.SDKBranch}`,
	`target=${g_GlobalInformation.Platform}/${g_GlobalInformation.Architecture}`,
].join(", ");
SendConsoleMessage(`${g_strSummary}.`);
```

### `MODULE_NAME`

```js
const { GetCoreModules, MODULE_NAME } = require("core");

if (!GetCoreModules().includes(MODULE_NAME)) {
	throw new Error(`Native module ${MODULE_NAME} is not registered.`);
}
```

### `PLATFORM`

```js
const { PLATFORM, SendConsoleMessage } = require("core");

SendConsoleMessage(`SourceJS platform: ${PLATFORM}`);
```

### `ReplaceEscapedSequences`

```js
const { ReplaceEscapedSequences } = require("core");

const g_strEscapedMessage = "Round started\\nType !help for commands.\\tHave fun!";
const g_strMessage = ReplaceEscapedSequences(g_strEscapedMessage);
console.log(g_strMessage);
```

### `CaptureServerOutput`

```js
const { CaptureServerOutput, OutputReturn } = require("core");
const { ExecuteCommand } = require("commands");

const g_Capture = CaptureServerOutput(OutputReturn.CONTINUE);

exports.Unload = function UnloadPlugin() {
	return g_Capture.CloseServerOutputCapture();
};

try {
	if (!ExecuteCommand("status")) {
		throw new Error("Unable to execute the status command.");
	}

	for (const OutputEntry of g_Capture.OutputEntries) {
		console.log(`[${OutputEntry.Severity}] ${OutputEntry.Message}`);
	}
} catch (ErrorValue) {
	if (!g_Capture.CloseServerOutputCapture()) {
		throw new Error("The capture operation failed and its output listener could not be removed.");
	}

	throw ErrorValue;
}
```

### `SOURCE_ENGINE`

```js
const { SendConsoleMessage, SOURCE_ENGINE } = require("core");

SendConsoleMessage(`Source engine family: ${SOURCE_ENGINE}`);
```

### `SOURCE_ENGINE_BRANCH`

```js
const { SendConsoleMessage, SOURCE_ENGINE_BRANCH } = require("core");

SendConsoleMessage(`Source engine branch: ${SOURCE_ENGINE_BRANCH}`);
```

### `GetSourceJSVersion`

Returns the compiled version through the native `core.GetVersion()` callback. Native C++ failures report `Error("core.GetVersion() failed because a native C++ exception occurred.")`; existing JavaScript exceptions propagate unchanged. See the shared [`GetVersion()` contract](core-version.md#getversion). The public `core` helper is named `GetSourceJSVersion`, not `GetVersion`.

```js
const { GetSourceJSVersion, SendConsoleMessage } = require("core");

SendConsoleMessage(`SourceJS version: ${GetSourceJSVersion()}`);
```

### `AutomaticUnload.AddUnloadInstance`

```js
const { AutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class ManagedTickSubscription extends AutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("Tick", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("Tick", this.Callback)) {
			throw new Error("Unable to unregister the managed tick listener.");
		}

		this.Registered = false;

		return true;
	}
}

function HandleManagedTick() {
}

if (ManagedTickSubscription.Instances.has("bootstrap") || ManagedTickSubscription.Instances.has("my_plugin")) {
	throw new Error("The example requires unused bootstrap and my_plugin owner names.");
}

const g_ManagedTickSubscription = new ManagedTickSubscription("bootstrap", HandleManagedTick);

const g_unClearedBootstrapInstanceCount = ManagedTickSubscription.ClearOwnerInstances("bootstrap");
if (g_unClearedBootstrapInstanceCount !== 1) {
	throw new Error("Unable to clear the bootstrap unload registration.");
}

g_ManagedTickSubscription.AddUnloadInstance("my_plugin");

const g_vecOwnerInstances = ManagedTickSubscription.Instances.get("my_plugin");
if (!Array.isArray(g_vecOwnerInstances)) {
	throw new Error("The plugin unload registry is unavailable.");
}

console.log(`Managed tick subscriptions: ${g_vecOwnerInstances.length}`);

exports.Unload = function UnloadPlugin() {
	return ManagedTickSubscription.UnloadOwnerInstances("my_plugin");
};
```

### `AutomaticUnload.ClearOwnerInstances`

```js
const { AutomaticUnload } = require("core");

class ManagedCache extends AutomaticUnload {
	constructor(strOwner) {
		super(strOwner);
		this.Values = new Map([["map", "c1m1_hotel"]]);
	}

	UnloadInstance() {
		this.Values.clear();

		return true;
	}
}

if (ManagedCache.Instances.has("bootstrap")) {
	throw new Error("The example requires an unused bootstrap owner name.");
}

const g_ManagedCacheInstance = new ManagedCache("bootstrap");

const g_unDetachedCount = ManagedCache.ClearOwnerInstances("bootstrap");
if ((g_unDetachedCount !== 1) || (g_ManagedCacheInstance.Values.size !== 1)) {
	throw new Error("Unable to detach the populated cache from its bootstrap owner.");
}

console.log(`Detached ${g_unDetachedCount} cache registration without clearing its stored value.`);
```

### `AutomaticUnload.UnloadInstance`

```js
const { AutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class ManagedLevelEndSubscription extends AutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("LevelEnd", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("LevelEnd", this.Callback)) {
			throw new Error("Unable to unregister the managed level-end listener.");
		}

		this.Registered = false;

		return true;
	}
}

function HandleLevelEnd() {
}

if (ManagedLevelEndSubscription.Instances.has("my_plugin")) {
	throw new Error("The example requires an unused my_plugin owner name.");
}

const g_LevelEndSubscription = new ManagedLevelEndSubscription("my_plugin", HandleLevelEnd);
const g_bLevelEndSubscriptionUnloaded = g_LevelEndSubscription.UnloadInstance();

const g_unClearedLevelEndInstanceCount = ManagedLevelEndSubscription.ClearOwnerInstances("my_plugin");
if (!g_bLevelEndSubscriptionUnloaded || (g_unClearedLevelEndInstanceCount !== 1)) {
	throw new Error("Unable to unload and detach the level-end subscription.");
}

console.log("Level-end subscription removed.");
```

### `AutomaticUnload.UnloadOwnerInstances`

```js
const { AutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class ManagedTickSubscription extends AutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("Tick", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("Tick", this.Callback)) {
			throw new Error("Unable to unregister the managed tick listener.");
		}

		this.Registered = false;

		return true;
	}
}

function HandleManagedTick() {
}

function HandleSecondManagedTick() {
}

if (ManagedTickSubscription.Instances.has("my_plugin")) {
	throw new Error("The example requires an unused my_plugin owner name.");
}

const g_FirstTickSubscription = new ManagedTickSubscription("my_plugin", HandleManagedTick);
const g_SecondTickSubscription = new ManagedTickSubscription("my_plugin", HandleSecondManagedTick);
if (!g_FirstTickSubscription.Registered || !g_SecondTickSubscription.Registered) {
	const unFailedRegistrationCleanupCount = ManagedTickSubscription.UnloadOwnerInstances("my_plugin");
	throw new Error(`Unable to register both tick subscriptions; cleaned ${unFailedRegistrationCleanupCount} owner registrations.`);
}

const g_unUnloadedInstanceCount = ManagedTickSubscription.UnloadOwnerInstances("my_plugin");
if ((g_unUnloadedInstanceCount !== 2) || g_FirstTickSubscription.Registered || g_SecondTickSubscription.Registered) {
	throw new Error(`Expected to unload 2 tick subscriptions, unloaded ${g_unUnloadedInstanceCount}.`);
}

console.log(`Unloaded ${g_unUnloadedInstanceCount} tick subscriptions.`);
```

### `Tokenizer.GetTokenHash`

```js
const { Tokenizer } = require("core");

const g_vecCommandTokenizer = new Tokenizer("exec \"sourcejs/gameplay.cfg\"", { CommentPrefix: "//" });
const g_strChecksum = g_vecCommandTokenizer.GetTokenHash();
console.log(`Command checksum: ${g_strChecksum}`);
```

### `Tokenizer.toString`

```js
const { Tokenizer } = require("core");

const g_vecCommandTokenizer = new Tokenizer("exec \"sourcejs/gameplay.cfg\" // Plugin settings.", { CommentPrefix: "//" });
console.log(`Stored command: ${g_vecCommandTokenizer.toString()}`);
// Stored command: exec "sourcejs/gameplay.cfg"
```

### `WeakAutomaticUnload.AddUnloadInstance`

```js
const { WeakAutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class WeakTickSubscription extends WeakAutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("Tick", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("Tick", this.Callback)) {
			throw new Error("Unable to unregister the weak tick listener.");
		}

		this.Registered = false;

		return true;
	}
}

function HandleWeakTick() {
}

if (WeakTickSubscription.Instances.has("bootstrap") || WeakTickSubscription.Instances.has("my_plugin")) {
	throw new Error("The example requires unused bootstrap and my_plugin owner names.");
}

const g_WeakTickSubscription = new WeakTickSubscription("bootstrap", HandleWeakTick);

const g_unClearedBootstrapReferenceCount = WeakTickSubscription.ClearOwnerInstances("bootstrap");
if (!g_WeakTickSubscription.Registered || (g_unClearedBootstrapReferenceCount !== 1)) {
	throw new Error("Unable to establish the bootstrap weak tick subscription.");
}

g_WeakTickSubscription.AddUnloadInstance("my_plugin");

const g_mapOwnerReferences = WeakTickSubscription.Instances.get("my_plugin");
if (!(g_mapOwnerReferences instanceof Map) || (g_mapOwnerReferences.size !== 1)) {
	throw new Error("The plugin weak unload registry is unavailable.");
}

console.log(`Weak registrations: ${g_mapOwnerReferences.size}`);

exports.Unload = function UnloadPlugin() {
	const unUnloadedInstanceCount = WeakTickSubscription.UnloadOwnerInstances("my_plugin");
	if ((unUnloadedInstanceCount !== 1) || g_WeakTickSubscription.Registered) {
		throw new Error(`Expected to unload 1 weak tick subscription, unloaded ${unUnloadedInstanceCount}.`);
	}

	return unUnloadedInstanceCount;
};
```

### `WeakAutomaticUnload.UnloadOwnerInstances`

```js
const { WeakAutomaticUnload } = require("core");
const { RegisterListener, UnregisterListener } = require("listeners");

class WeakTickSubscription extends WeakAutomaticUnload {
	constructor(strOwner, Callback) {
		super(strOwner);
		this.Callback = Callback;
		this.Registered = RegisterListener("Tick", Callback);
	}

	UnloadInstance() {
		if (!this.Registered) {
			return false;
		}

		if (!UnregisterListener("Tick", this.Callback)) {
			throw new Error("Unable to unregister the weak tick listener.");
		}

		this.Registered = false;

		return true;
	}
}

function HandleWeakTick() {
}

if (WeakTickSubscription.Instances.has("my_plugin")) {
	throw new Error("The example requires an unused my_plugin owner name.");
}

const g_WeakTickSubscriptionInstance = new WeakTickSubscription("my_plugin", HandleWeakTick);
if (!g_WeakTickSubscriptionInstance.Registered) {
	const unClearedReferenceCount = WeakTickSubscription.ClearOwnerInstances("my_plugin");
	throw new Error(`Unable to register the weak tick subscription; cleared ${unClearedReferenceCount} owner reference.`);
}

const g_unUnloadedInstanceCount = WeakTickSubscription.UnloadOwnerInstances("my_plugin");
if ((g_unUnloadedInstanceCount !== 1) || g_WeakTickSubscriptionInstance.Registered) {
	throw new Error(`Expected to unload 1 live weak subscription, unloaded ${g_unUnloadedInstanceCount}.`);
}

console.log(`Unloaded ${g_unUnloadedInstanceCount} live weak subscription.`);
```

## Safe use

- Implement `UnloadInstance()` with truthful resource state. Owner-wide cleanup ignores its return value and does not await promises: throw on a failed cleanup that must preserve the registration for retry. A thrown exception stops the pass without rolling back earlier cleanups.
- `ClearOwnerInstances()` removes registry ownership without calling `UnloadInstance()`. Use it only when intentionally transferring or detaching a still-live resource.
- Treat each executable example as a separate plugin/module, not one concatenated script. Owner names must belong exclusively to that example; never clear an unrelated owner's registrations. Transfer examples assume no reentrant registry changes. Their exact-count assertions describe a single run, not a guarantee that repeated unload calls return the same count.
- Constructors register ownership before subclass initialization and listener registration finish. A later exception may leave a partially initialized registered instance; initialize cleanup state before external calls and arrange recovery for failed construction. Weak registration does not keep an instance alive or guarantee resource cleanup by garbage collection; retain it until explicit cleanup.
- Do not mutate the `AutomaticUnload.Instances` or `WeakAutomaticUnload.Instances` registries directly; use the lifecycle methods.
- The callback form of `CaptureServerOutput()` attempts listener removal exactly once after the callback returns or throws, without awaiting a returned promise. A cleanup failure after a successful callback propagates; if both fail, an `AggregateError` preserves the callback failure followed by the cleanup failure. The manual form must call `CloseServerOutputCapture()` on success and failure paths and check its status; a false result does not prove the listener was removed. A persistent capture keeps appending entries without a size limit until closed, so bound its lifetime and avoid logging recursively from captured work.
- The native SDK logging callback contains C++ exceptions from message conversion, event dispatch, and forwarding. It reports failure directly to `stderr` because the engine-backed logger can reenter the same callback. The affected output may be lost; this boundary does not roll back native logging-state transitions or prove live-engine behavior.
- `ConfigurationFile` reads synchronously, skips rows without tokens, and applies escape replacement before tokenization. Its path fallback does not enforce containment within `CONFIG_ROOT` from `paths`. Use trusted paths; this helper is not a filesystem sandbox. `null` disables comments only in `Tokenizer`, not in `ConfigurationFile`.
- Token arrays are mutable, but changing their elements does not update `SourceText`, `toString()`, or `GetTokenHash()`. Tokenization accepts unmatched quotes; do not treat it as strict syntax validation. Default checksum input removes whitespace even inside quoted text; a matching checksum does not establish command equivalence or authenticity.
- `GetPublicIPAddress()` makes an asynchronous HTTP request with a 3000 ms timeout. Its default external service sees the caller's network address; successful response text is trimmed, not validated as an IP. Keep it out of hot paths and handle exceptions. The helper rejects a non-empty transport error regardless of HTTP status, including 2xx, then rejects non-2xx statuses; a partial response body is not returned as a successful address.
- `RunIgnoringUnicodeErrors()` catches synchronous errors matching its own realm's `TypeError` or `URIError` constructors, including ordinary programming type errors unrelated to Unicode. Foreign-realm errors may not match; other exceptions propagate. It returns promises unchanged and does not handle later rejections. Use it only around the narrowly intended operation.
- Metadata getters and module/package inventories are not proof that an import or branch-specific API call will succeed. Destructuring a getter captures its value at import time. Interface addresses are `bigint` values borrowing engine-owned storage; obtaining one does not transfer ownership or establish a lifetime for later use.

## Related files

- [`packages/sourcejs/core.js`](../../packages/sourcejs/core.js) contains the implementation documented here.
- [`listeners.md`](listeners.md) documents the listener registration APIs used by the lifecycle examples.
- [`commands.md`](commands.md) documents command execution used by server-output capture.
- [`filesystem.md`](filesystem.md) and [`interfaces.md`](interfaces.md) document two native services aggregated by this module.
- [`core-cache.md`](core-cache.md) documents the cache helpers built alongside the core package.
