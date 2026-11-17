# `require("entities/outputs")`

> Warning: this module resolves and hooks `CBaseEntityOutput::FireOutput` in live server memory. Use addresses only during the callback that supplied them, remove every owned hook during plugin unload, and use the table of contents to keep ABI and lifetime rules together.

The [package](../../packages/sourcejs/entities/outputs.js), backed by [native hook bindings](../../src/sourcejs/MemoryHookManager.cpp), loads the selected Source 1 ABI profile from runtime `SOURCE_DATA_ROOT/entityoutputs` (packaged beneath `addons/sourcejs/data/sourcejs/entityoutputs`), resolves `CBaseEntityOutput::FireOutput` through `memory/manager`, lazily creates or reuses one module-scoped function hook, and converts its payload into Entity and Variant values.

Use `listeners.RegisterEntityOutputListener` for ordinary observation. Use this module when a plugin needs the raw function address, ABI signature, mutable hook arguments, deliberate output suppression, or direct trampoline access.

Install and remove hooks on the game thread. Entity/Variant decoding requires the live engine world; hooks do not make engine or V8 access safe from worker threads. Export cleanup through the case-sensitive SourceJS-owned `Unload` lifecycle key; no lowercase alias is installed, and a function exported only as `UnloadPlugin` is not called automatically.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Profiles and cache](#profiles-and-cache)
- [Profile records](#profile-records)
- [Function resolution](#function-resolution)
- [ABI arguments](#abi-arguments)
- [Decoded output context](#decoded-output-context)
- [Hook lifecycle](#hook-lifecycle)
- [Practical workflows](#practical-workflows)
- [Errors and lifetime](#errors-and-lifetime)
- [Related modules](#related-modules)

## Import and capabilities

```js
const g_EntityOutputs = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_ReportEntityOutputCapabilities = function ReportEntityOutputCapabilities() {
	LogInfo("ReportEntityOutputCapabilities Result=%j", { HasCurrentProfile: g_EntityOutputs.HasEntityOutputData(), ExportNames: Object.keys(g_EntityOutputs).sort(), SupportedSDKBranches: g_EntityOutputs.GetSupportedEntityOutputSDKBranches() });
};

g_ReportEntityOutputCapabilities();
```

The whole-module import is intentional in this capability inventory because the example inspects the exact runtime export set. Operational examples below import each function directly.

The module has exactly 15 PascalCase exports. It does not install lower-camel compatibility aliases:

| Export | Result |
| --- | --- |
| [`GetSupportedEntityOutputSDKBranches()`](#getsupportedentityoutputsdkbranches) | SDK branch names present in the required index. |
| [`HasEntityOutputData(strSDKBranch = GetActiveSDKBranch())`](#hasentityoutputdatastrsdkbranch--getactivesdkbranch) | Trims and lowercases a non-empty branch name, then returns whether the branch is indexed and its profile file exists. Throws `TypeError` for a non-string or blank branch name. |
| [`GetEntityOutputDataFilePath(strSDKBranch = GetActiveSDKBranch())`](#getentityoutputdatafilepathstrsdkbranch--getactivesdkbranch) | Resolves the branch profile and returns its absolute Source filesystem path under `SOURCE_DATA_ROOT/entityoutputs`. It does not check that the file exists. Invalid/blank branch names throw `TypeError`, unsupported branches throw `RangeError`, and a missing indexed data-file entry throws `Error`. |
| [`LoadEntityOutputData(strSDKBranch = GetActiveSDKBranch())`](#loadentityoutputdatastrsdkbranch--getactivesdkbranch) | Loads and parses the profile on a cache miss, then returns that profile's shared cached record object. |
| [`ClearEntityOutputDataCache()`](#clearentityoutputdatacache) | Clears the index and profile caches and returns `true`. |
| [`ParseEntityOutputINI(strEntityOutputINIText)`](#parseentityoutputinistrentityoutputinitext) | Strictly parses one profile without caching it. |
| [`GetEntityFireOutputData(strSDKBranch = GetActiveSDKBranch())`](#getentityfireoutputdatastrsdkbranch--getactivesdkbranch) | Returns the selected profile's cached `Functions.FireOutput` descriptor object; throws if that descriptor is absent. |
| [`GetEntityFireOutputIdentifier(strSDKBranch = GetActiveSDKBranch())`](#getentityfireoutputidentifierstrsdkbranch--getactivesdkbranch) | Returns the selected profile's active-platform binary identifier string (symbol or byte signature); throws if the profile has no non-empty identifier for that platform. |
| `GetEntityFireOutputArguments(strSDKBranch = GetActiveSDKBranch())` | Returns a new array of raw hook argument types: `"address"` for the C++ `this` argument first, followed by the selected profile's platform/architecture argument types. Windows x64 requires `ArgumentsWindowsX64`; it never falls back to the x86 layout. |
| [`GetEntityFireOutputAddress(strSDKBranch = GetActiveSDKBranch())`](#getentityfireoutputaddressstrsdkbranch--getactivesdkbranch) | Returns the resolved nonzero function address as `bigint`; throws `ReferenceError` if the profile identifier cannot be resolved. |
| [`GetEntityFireOutputHookOptions(strSDKBranch = GetActiveSDKBranch(), HookOverrides = {})`](#getentityfireoutputhookoptionsstrsdkbranch--getactivesdkbranch-hookoverrides--) | Returns a new `memory/hooks.CreateFunctionHook()` options object with `Address`, `Arguments`, `Convention`, and `ReturnType: "void"`; spreads `HookOverrides` last, so overrides replace matching defaults. |
| [`NormalizeEntityFireOutputArguments(vecFireOutputArgumentValues, unStackAddress = undefined)`](#normalizeentityfireoutputargumentsvecfireoutputargumentvalues-unstackaddress--undefined) | Returns a new normalized array. Windows x86 accepts nine raw values with the pre-hook's nonzero BigInt `StackAddress`, or copies five already-normalized values. Windows x64 and Linux require and copy exactly five values. Non-array input throws `TypeError`; invalid lengths throw `RangeError`. |
| [`GetEntityFireOutputContext(HookPayload)`](#getentityfireoutputcontexthookpayload) | Requires `HookPayload.Arguments`, normalizes it, and returns that array plus four non-negative BigInt addresses, finite `Delay`, nullable `OutputName`, nullable Variant `Value`, and nullable `Activator`/`Caller` entity wrappers. |
| [`CreateEntityFireOutputHook(HookCallback = undefined, strSDKBranch = undefined, bRollbackNewHookOnFailure = false)`](#createentityfireoutputhookhookcallback--undefined-strsdkbranch--undefined-brollbacknewhookonfailure--false) | Returns the single module-scoped hook, creating it with the requested (or active) SDK branch when absent; an existing hook is reused and the branch argument is ignored. A non-`undefined` callback must be a function and is registered with `.Pre()`; `undefined` creates/reuses without registering one. The optional boolean enables failed-registration rollback only for a native record created by this call; the default preserves the cached hook. |
| [`RemoveEntityFireOutputHook()`](#removeentityfireoutputhook) | Calls `Remove()` on the active hook and clears the module-scoped reference only on success. Returns `false` if no hook is active or removal fails, and `true` after successful removal. |

For profile APIs, the internal `GetActiveSDKBranch()` reads the real-time `GetGlobalVariables().SDKBranch` property whenever the branch argument is omitted. `CreateEntityFireOutputHook()` resolves that default only when it creates the shared hook. Passing a branch never selects another loaded engine; it selects profile data for diagnostics or explicit low-level work.

The shipped index currently maps `blade`, `bms`, `csgo`, `css`, `dods`, `gmod`, `hl2dm`, `l4d2`, `orangebox`, `sdk2013`, and `tf2`. Other SourceJS SDK branches can be valid server targets while having no entity-output profile. `HasEntityOutputData(strSDKBranch)` reports `false` for those branches; APIs that require a profile throw.

## Profiles and cache

### `GetSupportedEntityOutputSDKBranches()`

Reads `entityoutputs/index.json` and returns its exact profile keys. The returned array is a point-in-time list; changing it does not edit the index.

### `HasEntityOutputData(strSDKBranch = GetActiveSDKBranch())`

Trims and lowercases a non-empty branch string, then returns `true` only when the normalized branch is indexed and its mapped INI file exists. A well-formed unknown branch returns `false`; a non-string or blank branch throws `TypeError`.

### `GetEntityOutputDataFilePath(strSDKBranch = GetActiveSDKBranch())`

Returns the mapped INI path below `SOURCE_DATA_ROOT/entityoutputs` without checking whether the file exists. Slash normalization preserves a valid leading UNC pair (`//server/share`); it does not establish path containment. Invalid or blank branch names throw `TypeError`; unsupported branches throw `RangeError`; missing file mappings or invalid/empty file names throw `Error`.

### `LoadEntityOutputData(strSDKBranch = GetActiveSDKBranch())`

On a cache miss, parses the mapped INI and caches the result by profile name. Branches such as `css`, `dods`, `hl2dm`, `sdk2013`, and `tf2` share the `orangebox` profile and therefore receive the same cached object.

The returned record and its nested values are shared, mutable cache objects in the current plugin context, not a live view of the INI file. Changes to fields consumed by later `LoadEntityOutputData()`, `GetEntityFireOutputData()`, or address-resolution calls are visible until `ClearEntityOutputDataCache()` clears the caches; the next load rereads and parses the file.

### `ClearEntityOutputDataCache()`

Clears both the parsed index and every loaded profile, then returns `true`. Existing JavaScript references remain ordinary objects, but later loads create new records from disk. Removing a live hook is a separate operation.

```js
const {
	ClearEntityOutputDataCache,
	GetEntityOutputDataFilePath,
	HasEntityOutputData,
	LoadEntityOutputData,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_VerifyEntityOutputCache = function VerifyEntityOutputCache() {
	const strSDKBranch = "l4d2";
	if (!HasEntityOutputData(strSDKBranch)) {
		throw new Error("The L4D2 entity-output profile is not installed.");
	}

	const FirstProfile = LoadEntityOutputData(strSDKBranch);
	const SameProfile = LoadEntityOutputData(strSDKBranch);
	LogInfo("VerifyEntityOutputCache CachedIdentity=%s Path=%s", FirstProfile === SameProfile, GetEntityOutputDataFilePath(strSDKBranch));

	const strOriginalBinary = FirstProfile.Binary;
	const strTemporaryBinary = `${strOriginalBinary}_documentation`;

	try {
		FirstProfile.Binary = strTemporaryBinary;

		if (LoadEntityOutputData(strSDKBranch).Binary !== strTemporaryBinary) {
			throw new Error("LoadEntityOutputData() did not return the edited cached profile.");
		}
	} finally {
		FirstProfile.Binary = strOriginalBinary;
		ClearEntityOutputDataCache();
	}

	const ReloadedProfile = LoadEntityOutputData(strSDKBranch);
	if ((ReloadedProfile === FirstProfile) || (ReloadedProfile.Binary !== strOriginalBinary)) {
		throw new Error("Clearing the cache did not reload the profile from disk.");
	}

	LogInfo("VerifyEntityOutputCache ReloadedBinary=%s", ReloadedProfile.Binary);
};

g_VerifyEntityOutputCache();
```

## Profile records

### Profile object

`LoadEntityOutputData()` and `ParseEntityOutputINI()` return:

| Field | Type | Meaning |
| --- | --- | --- |
| `Binary` | `string` | Binary name passed to `memory/manager.ResolveBinaryIdentifier()`, normally `"server"`. |
| `ServerCheckEnabled` | `boolean` | Whether the profile's server check is enabled. |
| `Functions` | `object` | Function descriptors keyed by PascalCase names. |

### FireOutput descriptor

`Profile.Functions.FireOutput` and `GetEntityFireOutputData()` expose:

| Field | Type | Meaning |
| --- | --- | --- |
| `IdentifierLinux` | `string` | Linux ELF symbol or signature. |
| `IdentifierWindows` | `string` | Windows signature or exported symbol. |
| `ArgumentsLinux` | `string[]` | Profile argument types before SourceJS adds `this`. |
| `ArgumentsWindows` | `string[]` | Windows x86 layout: five `uint` words containing the inline by-value Variant, then activator/caller addresses and delay. |
| `ArgumentsWindowsX64` | `string[]` | Windows x64 layout: address of the by-value Variant copy, activator/caller addresses, then delay. |

The normalized top-level record exposes only `Binary`, `ServerCheckEnabled`, and `Functions`. Descriptor keys are normalized to PascalCase; additional descriptor values are retained under those normalized keys, though the module uses only the fields listed above. The descriptor and its argument arrays are mutable references in the shared cached profile. A hook uses the options supplied when it is created; later profile edits do not update it. Remove the active hook before changing profile data, then create a new hook to apply those changes.

### `ParseEntityOutputINI(strEntityOutputINIText)`

Parses one INI string without accessing the filesystem or cache. The returned record fields and descriptor names use PascalCase. A `#` starts a comment only outside a quoted value; an escaped quote does not close that value. Exact `True` and `False` values become booleans; argument type names are trimmed, lowercased, and validated by `memory/helpers.Type.NormalizeDataType()`.

The INI requires a non-empty `binary` and a `[function]` section, and every nested function descriptor must be an object. `server_check` defaults to `true`; when present, it must be boolean. Parsing normalizes those external INI keys to the PascalCase record fields above. Duplicate sections, nested sections without a parent, duplicate keys, malformed lines, and unknown memory types throw.

```js
const { ParseEntityOutputINI } = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_VerifyParsedEntityOutputProfile = function VerifyParsedEntityOutputProfile() {
	const unWindowsProfileArgumentCount = 8;
	const Profile = ParseEntityOutputINI(`
binary = server
server_check = True

[function]
	[[FireOutput]]
		identifier_linux = _ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f
		identifier_windows = 55 8B EC 81 EC 2A 2A 2A 2A
		arguments_linux = address, address, address, float
		arguments_windows = uint, uint, uint, uint, uint, address, address, float
		arguments_windows_x64 = address, address, address, float
`);
	if ((Profile.Binary !== "server") || !Profile.ServerCheckEnabled) {
		throw new Error("ParseEntityOutputINI() returned unexpected Binary or ServerCheckEnabled values.");
	}

	if (Profile.Functions.FireOutput.ArgumentsWindows.length !== unWindowsProfileArgumentCount) {
		throw new Error("ParseEntityOutputINI() returned an unexpected Windows FireOutput argument count.");
	}

	LogInfo("VerifyParsedEntityOutputProfile Result=%j", {
		WindowsArgumentTypes: Profile.Functions.FireOutput.ArgumentsWindows,
		WindowsX64ArgumentTypes: Profile.Functions.FireOutput.ArgumentsWindowsX64,
		ServerCheckEnabled: Profile.ServerCheckEnabled,
		Binary: Profile.Binary,
		IdentifierLinux: Profile.Functions.FireOutput.IdentifierLinux,
	});
};

g_VerifyParsedEntityOutputProfile();
```

## Function resolution

### `GetEntityFireOutputData(strSDKBranch = GetActiveSDKBranch())`

Returns the shared cached `Functions.FireOutput` descriptor object. Throws if the active profile has no `FireOutput` descriptor.

### `GetEntityFireOutputIdentifier(strSDKBranch = GetActiveSDKBranch())`

Selects `IdentifierWindows` or `IdentifierLinux` from the current `memory/manager.PLATFORM`. Unsupported platforms, or a selected value that is missing, empty, or not a string, throw.

Linux profiles commonly identify FireOutput by a mangled ELF symbol such as `_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f`; Windows profiles commonly use a byte signature. The native resolver receives either form as a string and returns the resolved address as a JavaScript `bigint`.

### `GetEntityFireOutputAddress(strSDKBranch = GetActiveSDKBranch())`

Calls `memory/manager.ResolveBinaryIdentifier(EntityOutputData.Binary, strSelectedFireOutputIdentifier)`. The native resolver decides whether the selected identifier is a symbol or signature. SourceJS does not guess in JavaScript or fall back to a fake address. Returns the resolved address as `bigint`; a null native address (`0n`) throws `ReferenceError`.

### `GetEntityFireOutputHookOptions(strSDKBranch = GetActiveSDKBranch(), HookOverrides = {})`

Returns a new object suitable for `memory/hooks.CreateFunctionHook()`:

| Field | Value |
| --- | --- |
| `Address` | Resolved `FireOutput` address as `bigint`. |
| `Arguments` | Complete argument type array from `GetEntityFireOutputArguments()`, including the leading `"address"` for `this`. |
| `Convention` | `"thiscall"` on Windows or `"cdecl"` on Linux. The native x64 implementation selects Windows x64 or System V AMD64 argument placement; `"win64"`/`"sysv"` are not accepted option strings. |
| `ReturnType` | Always `"void"`. |

Own enumerable properties from `HookOverrides` are applied last. `HookOverrides` defaults to `{}`; a supplied non-`undefined` value must be a non-null, non-array object or a `TypeError` is thrown. This is intended for an ABI expert who has verified a game-specific correction. Overriding `Address`, `Arguments`, `Convention`, or `ReturnType` incorrectly can crash the server.

```js
const {
	GetEntityFireOutputArguments,
	GetEntityFireOutputData,
	GetEntityFireOutputHookOptions,
	GetEntityFireOutputIdentifier,
	GetEntityFireOutputAddress,
	HasEntityOutputData,
	LoadEntityOutputData,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_ReportEntityFireOutputResolution = function ReportEntityFireOutputResolution() {
	if (!HasEntityOutputData()) {
		throw new Error("ReportEntityFireOutputResolution() requires an entity-output profile for the active SDK branch.");
	}

	const FireOutputDescriptor = GetEntityFireOutputData();
	const EntityOutputProfile = LoadEntityOutputData();
	const strFireOutputIdentifier = GetEntityFireOutputIdentifier();
	const unFireOutputAddress = GetEntityFireOutputAddress();
	const vecFireOutputArgumentTypes = GetEntityFireOutputArguments();
	const FireOutputHookOptions = GetEntityFireOutputHookOptions();
	if (FireOutputDescriptor !== EntityOutputProfile.Functions.FireOutput) {
		throw new Error("GetEntityFireOutputData() did not return the shared cached FireOutput descriptor.");
	}

	if ((FireOutputHookOptions.Address !== unFireOutputAddress) || (FireOutputHookOptions.ReturnType !== "void") || (JSON.stringify(FireOutputHookOptions.Arguments) !== JSON.stringify(vecFireOutputArgumentTypes))) {
		throw new Error("GetEntityFireOutputHookOptions() returned unexpected Address, ReturnType, or Arguments values.");
	}

	LogInfo("ReportEntityFireOutputResolution Result=%j", {
		FireOutputDescriptor,
		FireOutputAddress: `0x${unFireOutputAddress.toString(16).toUpperCase()}`,
		Binary: EntityOutputProfile.Binary,
		CallingConvention: FireOutputHookOptions.Convention,
		FireOutputIdentifier: strFireOutputIdentifier,
		ReturnType: FireOutputHookOptions.ReturnType,
		FireOutputArgumentTypes: vecFireOutputArgumentTypes,
	});
};

g_ReportEntityFireOutputResolution();
```

## ABI arguments

`GetEntityFireOutputArguments(strSDKBranch = GetActiveSDKBranch())` always adds the hidden `CBaseEntityOutput* this` address expected by SourceJS memory hooks.

| Platform | Architecture | `Convention` option | Raw type layout |
| --- | --- | --- | --- |
| Windows | x86 | `thiscall` | `address, uint, uint, uint, uint, uint, address, address, float` |
| Windows | x64 | `thiscall` (native Windows x64 ABI) | `address, address, address, address, float` |
| Linux | x86 | `cdecl` | `address, address, address, address, float` |
| Linux | x64 | `cdecl` (native System V AMD64 ABI) | `address, address, address, address, float` |

The profiles select `ArgumentsWindows` for Windows x86, `ArgumentsWindowsX64` for Windows x64, and `ArgumentsLinux` for both Linux architectures. Missing architecture data throws rather than reusing a different ABI. The runtime architecture labels are `x86` and `x64`, not `x86_64`.

Actual-SDK compiler probes for L4D2 x86 and TF2 x64 on Windows and Linux confirm these parameter shapes, not successful hooks in every game binary. In particular, a correct x64 type list does not make an x86 byte signature valid on x64. Verify the selected binary's identifier and ABI before installing a hook; `HookOverrides` must preserve a supported decoding shape or use callback-specific decoding.

Windows x86 passes a 20-byte `variant_t` inline as five words. The fifth word is the Variant's type, **not its address**. Its storage begins immediately after the four-byte return address at `HookPayload.StackAddress + 4n`. Windows x64 and Linux pass the nontrivially copyable Variant indirectly, so their second raw value already supplies its address. `StackAddress` is borrowed native entry-stack storage available only during a pre-hook callback; never retain or dereference it afterwards.

### `NormalizeEntityFireOutputArguments(vecFireOutputArgumentValues, unStackAddress = undefined)`

Returns a new canonical five-element array by layout; it does not validate the ordinary argument element types:

| Index | Value |
| --- | --- |
| `0` | `unOutputAddress`, the raw `CBaseEntityOutput* this` value as a non-negative `bigint`. |
| `1` | `unValueAddress`, a raw temporary `variant_t*` value as `bigint`, or `0n`. |
| `2` | `unActivatorAddress`, a raw `CBaseEntity*` value as `bigint`, or `0n`. |
| `3` | `unCallerAddress`, a raw `CBaseEntity*` value as `bigint`, or `0n`. |
| `4` | `flOutputDelay`, the raw delay value in seconds. |

Windows x86 accepts nine raw values only with a nonzero BigInt `unStackAddress` that fits an x86 address and leaves room for the return-address offset; it selects indexes 0 and 6–8 and derives the Variant address from that stack address. Missing/non-BigInt/negative stack addresses throw `TypeError`; zero or overflowing stack addresses throw `RangeError`. Five already-normalized Windows x86 values need no stack address. Windows x64 and Linux require exactly five values and do not use `unStackAddress`. A non-array input throws `TypeError`; unsupported counts throw `RangeError`.

Length and offset checks do not prove mapped memory, object lifetime, or a correct binary profile. `GetEntityFireOutputContext()` additionally requires non-negative BigInt addresses and a finite numeric delay; the native Variant reader validates the selected SDK storage range.

```js
const { GetEntityFireOutputArguments, NormalizeEntityFireOutputArguments } = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_VerifyNormalizedEntityFireOutputArguments = function VerifyNormalizedEntityFireOutputArguments() {
	const unWindowsRawArgumentCount = 9;
	const unNormalizedArgumentCount = 5;
	const unWindowsX86ReturnAddressByteCount = 4n;
	const unOutputAddress = 0x710000n;
	const unValueAddress = 0x720000n;
	const unActivatorAddress = 0x730000n;
	const unCallerAddress = 0x740000n;
	const flOutputDelay = 0.25;
	const vecRawFireOutputArgumentTypes = GetEntityFireOutputArguments();
	const vecExpectedFireOutputValues = [unOutputAddress, unValueAddress, unActivatorAddress, unCallerAddress, flOutputDelay];
	const vecSampleFireOutputArgumentValues = (vecRawFireOutputArgumentTypes.length === unWindowsRawArgumentCount) ? [unOutputAddress, 73, 0, 0, 0xFFFFFFFF, 5, unActivatorAddress, unCallerAddress, flOutputDelay] : vecExpectedFireOutputValues;
	const unSampleStackAddress = unValueAddress - unWindowsX86ReturnAddressByteCount;
	const vecNormalizedFireOutputValues = NormalizeEntityFireOutputArguments(vecSampleFireOutputArgumentValues, unSampleStackAddress);
	const bMatchingNormalizedAddresses = (vecNormalizedFireOutputValues.length === unNormalizedArgumentCount)
		&& (vecNormalizedFireOutputValues[0] === unOutputAddress)
		&& (vecNormalizedFireOutputValues[1] === unValueAddress)
		&& (vecNormalizedFireOutputValues[2] === unActivatorAddress)
		&& (vecNormalizedFireOutputValues[3] === unCallerAddress);
	const bMatchingNormalizedDelay = vecNormalizedFireOutputValues[4] === flOutputDelay;
	if (!bMatchingNormalizedAddresses || !bMatchingNormalizedDelay) {
		throw new Error("NormalizeEntityFireOutputArguments() returned unexpected address or delay values.");
	}

	const FormatValue = Value => (typeof Value === "bigint") ? `0x${Value.toString(16).toUpperCase()}` : Value;
	LogInfo("VerifyNormalizedEntityFireOutputArguments Values=%j", vecNormalizedFireOutputValues.map(FormatValue));
};

g_VerifyNormalizedEntityFireOutputArguments();
```

## Decoded output context

### `GetEntityFireOutputContext(HookPayload)`

Requires a memory pre-hook payload with an `Arguments` array and, for Windows x86's nine-value layout, the native pre-hook's `StackAddress` BigInt field. It reads `StackAddress` only for that inline layout, normalizes the ABI values, validates every address as a non-negative `bigint`, validates the delay as a finite number, resolves entities, finds the output name through the caller's real datamap, and reads the temporary Variant. Name lookup passes the resolved caller Entity wrapper to `entities/helpers.FindEntityOutputNameByAddress()`, not the raw BigInt caller address. Without a resolved caller, `OutputName` is `null` and lookup is skipped; with a resolved caller, the output address must be non-zero and fit native `uintptr_t`. Field names are exact; other casing is not inspected.

A non-zero activator or caller address resolving to entity index `0` produces the world Entity wrapper, not `null`. A `0n` address produces `null` without resolving an entity.

The returned object has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `Arguments` | `array` | New five-value array. |
| `OutputAddress` | `bigint` | Native `CBaseEntityOutput*` callback value; `0n` is accepted only when no caller resolves. |
| `ValueAddress` | `bigint` | Temporary `variant_t*`, or `0n`. |
| `ActivatorAddress` | `bigint` | Native activator address, or `0n`. |
| `CallerAddress` | `bigint` | Native caller address, or `0n`. |
| `Delay` | `number` | Delay in seconds. |
| `OutputName` | `string \| null` | Datamap external name such as `"OnUser1"`. |
| `Value` | `Variant` record or `null` | Decoded `{ Address, TypeID, Type, Value }` record. |
| `Activator` | `Entity \| null` | Entity wrapper resolved from the activator address, or `null`. |
| `Caller` | `Entity \| null` | Entity wrapper resolved from the caller address, or `null`. |

The Variant's decoded `Value` is a read-time value, not a writable native view. Its `Address` is the same temporary `variant_t*` exposed as `ValueAddress`, represented as `bigint`. Entity wrappers resolve their indexes on each access: deletion can invalidate them, and index reuse can make them observe another entity. They do not retain callback identity or native lifetime. The four top-level addresses and the nested Variant address are callback-lifetime values and must not be retained for later ticks.

The logging examples convert BigInts to strings only in reporting data, without changing the API values. Native address fields and register words use hexadecimal; a BigInt Variant payload uses an exact decimal string. Numeric Vector/Color records remain structured values.

The lifecycle example below assumes exclusive ownership of the module-scoped hook. Callback registration can fail after creation, so installation attempts removal before propagating the failure. A false cleanup result can mean either no active hook or failed removal; the error reports that result without assuming which occurred.

```js
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_ObserveEntityFireOutput = function ObserveEntityFireOutput(HookPayload) {
	const EntityFireOutputContext = GetEntityFireOutputContext(HookPayload);
	const ActivatorEntity = EntityFireOutputContext.Activator;
	const CallerEntity = EntityFireOutputContext.Caller;
	const FireOutputValueRecord = EntityFireOutputContext.Value;
	const nActivatorEntityIndex = (ActivatorEntity === null) ? null : ActivatorEntity.Index;
	const nCallerEntityIndex = (CallerEntity === null) ? null : CallerEntity.Index;
	const FireOutputValue = (FireOutputValueRecord === null) ? null : FireOutputValueRecord.Value;
	const strFireOutputType = (FireOutputValueRecord === null) ? null : FireOutputValueRecord.Type;
	const FireOutputLogValue = (typeof FireOutputValue === "bigint") ? FireOutputValue.toString() : FireOutputValue;
	LogInfo("ObserveEntityFireOutput Result=%j", {
		Delay: EntityFireOutputContext.Delay,
		ActivatorEntityIndex: nActivatorEntityIndex,
		CallerEntityIndex: nCallerEntityIndex,
		FireOutputValue: FireOutputLogValue,
		OutputAddress: `0x${EntityFireOutputContext.OutputAddress.toString(16).toUpperCase()}`,
		FireOutputType: strFireOutputType,
		OutputName: EntityFireOutputContext.OutputName,
	});
};

const g_InstallEntityFireOutputHook = function InstallEntityFireOutputHook() {
	let EntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_ObserveEntityFireOutput);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "InstallEntityFireOutputHook installation and cleanup failed.");
		}

		throw new Error(`InstallEntityFireOutputHook failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	const bHasValidID = Number.isSafeInteger(EntityFireOutputHook.ID) && (EntityFireOutputHook.ID > 0);
	const bHasValidAddress = (typeof EntityFireOutputHook.Address === "bigint") && (EntityFireOutputHook.Address > 0n);
	const bHasValidTrampolineAddress = (typeof EntityFireOutputHook.TrampolineAddress === "bigint") && (EntityFireOutputHook.TrampolineAddress > 0n);
	if (!bHasValidID || !bHasValidAddress || !bHasValidTrampolineAddress) {
		const bHookRemoved = RemoveEntityFireOutputHook();
		if (!bHookRemoved) {
			throw new Error("InstallEntityFireOutputHook() received an invalid ID, Address, or TrampolineAddress, and RemoveEntityFireOutputHook() failed.");
		}

		throw new Error("CreateEntityFireOutputHook() returned an invalid ID, Address, or TrampolineAddress.");
	}
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("FireOutput hook removal failed.");
	}
};

g_InstallEntityFireOutputHook();

module.exports.Unload = g_UnloadPlugin;
```

The callback intentionally returns `undefined`. For this `void` hook, any non-nullish callback result is treated as a successful override and skips the original function; no native return value is written.

## Hook lifecycle

### `CreateEntityFireOutputHook(HookCallback = undefined, strSDKBranch = undefined, bRollbackNewHookOnFailure = false)`

Creates the native function hook on first use. Later calls return the same hook object; a supplied callback is added to its pre-hook callback list. The callback must be a function when provided, and a failed native callback registration throws instead of being treated as success. When `strSDKBranch` is `undefined`, the first creation uses the trimmed, lowercase `GetGlobalVariables().SDKBranch`; later calls do not reselect the shared hook.

With the default `bRollbackNewHookOnFailure = false`, callback-registration failure does not roll back the shared hook. The low-level examples below assume exclusive ownership and attempt removal when either creation or callback registration throws. Coordinate ownership before applying this cleanup to a hook shared with another subsystem.

With `bRollbackNewHookOnFailure = true`, creation requires the current native `Created` boolean metadata. If callback registration fails, the function attempts to remove only a native record created by that call; an already cached hook or an existing native record is preserved, including foreign callbacks. Successful cleanup clears the shared cache and rethrows the registration failure unchanged. Cleanup failure retains the cache and throws `AggregateError` with the registration failure first and cleanup failure second; a false removal result becomes a cleanup error. An invalid non-boolean flag throws before acquisition. This mode is used by `EntityOutputListenerManager`; it does not change successful last-listener teardown ownership.

The returned native hook object has:

| Member | Type | Meaning |
| --- | --- | --- |
| `ID` | `number` | Positive hook ID. |
| `Created` | `boolean` | Whether the underlying `CreateFunctionHook()` call created the native record, rather than reused one. This is a creation snapshot, not an ownership lease; cached calls return the same object and do not refresh it. |
| `Address` | `bigint` | Patched function address. |
| `TrampolineAddress` | `bigint` | Callable Detours trampoline address. |
| `Pre(Callback)` | `function` | Registers a pre-hook callback and returns whether registration succeeded. |
| `Post(Callback)` | `function` | Registers a post-hook callback and returns whether registration succeeded. |
| `RemovePre(Callback)` | `function` | Removes the specified pre-hook callback and returns whether removal succeeded. |
| `RemovePost(Callback)` | `function` | Removes the specified post-hook callback and returns whether removal succeeded. |
| `Remove()` | `function` | Removes the native hook and every callback without clearing the package-local shared handle; returns whether removal succeeded. |

The callback supplied to `CreateEntityFireOutputHook()` receives the standard pre-hook payload from `memory/hooks`:

| Member | Meaning |
| --- | --- |
| `HookID` | Native hook ID. |
| `Type` | Always `"pre"`. |
| `Arguments` | Mutable array of raw ABI values; edits are applied to the hook context. |
| `StackAddress` | Borrowed native entry-stack address as `bigint`, at the return-address slot. Required for decoding Windows x86's inline Variant; valid only during this pre-hook callback. |
| `TrampolineAddress` | Detours trampoline address as `bigint`. |
| `SetHookArgument(nArgumentIndex, HookArgumentValue)` | Writes the zero-based raw call argument and reflects the value in `Arguments`. |
| `SetHookReturnValue(HookReturnValue)` | Writes a native return value for non-`void` signatures; this `FireOutput` hook has a `void` signature. |
| `CallHookTrampoline(CallOptions?)` | Calls the original through Detours and returns `ReturnValue` and `Registers`. |

`CallHookTrampoline({ Arguments, Registers, CallerCleanup })` accepts replacement raw arguments, register inputs, and an optional caller-cleanup override coerced to boolean. The result contains only `{ ReturnValue, Registers }`; only the PascalCase fields and methods shown here are installed. A completed native trampoline invocation suppresses SourceJS's automatic original call, including when later result construction fails. Invalid options can throw before any native call. Calling the trampoline explicitly again invokes the original again; it is not an exactly-once wrapper.

Omitting the options argument uses the current raw arguments and default register inputs. Passing `undefined` or `null` explicitly is not equivalent to omitting it: a supplied argument must be an object.

### `RemoveEntityFireOutputHook()`

Returns `false` when no hook exists or native removal fails. The module-scoped handle is cleared only after successful removal, so failure can be retried. Removing an individual callback or calling the hook object's `Remove()` method does not clear the package's shared handle; use this function for package lifecycle cleanup.

```js
const { CreateEntityFireOutputHook, RemoveEntityFireOutputHook } = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_FirstCallback = function FirstCallback() {
	LogInfo("ObserveFirstEntityOutput Callback=First");
};

const g_SecondCallback = function SecondCallback() {
	LogInfo("ObserveSecondEntityOutput Callback=Second");
};

const g_VerifySharedEntityFireOutputHook = function VerifySharedEntityFireOutputHook() {
	let EntityFireOutputHook = null;
	let SameEntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_FirstCallback);
		SameEntityFireOutputHook = CreateEntityFireOutputHook(g_SecondCallback);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "VerifySharedEntityFireOutputHook installation and cleanup failed.");
		}

		throw new Error(`VerifySharedEntityFireOutputHook failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	if (EntityFireOutputHook !== SameEntityFireOutputHook) {
		throw new Error("Entity-output hook identity changed inside one module instance.");
	}

	if (!EntityFireOutputHook.RemovePre(g_SecondCallback)) {
		throw new Error("The second pre-hook callback could not be unregistered.");
	}

	LogInfo("VerifySharedEntityFireOutputHook ID=%d Address=%s TrampolineAddress=%s", EntityFireOutputHook.ID, `0x${EntityFireOutputHook.Address.toString(16).toUpperCase()}`, `0x${EntityFireOutputHook.TrampolineAddress.toString(16).toUpperCase()}`);
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Entity-output hook removal failed.");
	}
};

g_VerifySharedEntityFireOutputHook();

module.exports.Unload = g_UnloadPlugin;
```

## Practical workflows

### Observe one output

Compare the external datamap name, not an internal field name:

```js
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_ObserveNamedEntityOutput = function ObserveNamedEntityOutput(HookPayload) {
	const EntityFireOutputContext = GetEntityFireOutputContext(HookPayload);
	if (EntityFireOutputContext.OutputName !== "OnUser1") {
		return;
	}

	if (EntityFireOutputContext.Caller === null) {
		throw new Error("A named entity output did not resolve its caller.");
	}

	const EntityOutputValueRecord = EntityFireOutputContext.Value;
	const EntityOutputValue = (EntityOutputValueRecord === null) ? null : EntityOutputValueRecord.Value;
	const EntityOutputLogValue = (typeof EntityOutputValue === "bigint") ? EntityOutputValue.toString() : EntityOutputValue;
	const strEntityOutputEvent = `entity ${EntityFireOutputContext.Caller.Index} fired ${EntityFireOutputContext.OutputName}`;
	LogInfo("ObserveNamedEntityOutput Result=%j", { EntityOutputValue: EntityOutputLogValue, EntityOutputEvent: strEntityOutputEvent });
};

const g_InstallNamedEntityOutputObserver = function InstallNamedEntityOutputObserver() {
	let EntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_ObserveNamedEntityOutput);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "InstallNamedEntityOutputObserver installation and cleanup failed.");
		}

		throw new Error(`InstallNamedEntityOutputObserver failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	if ((typeof EntityFireOutputHook.Address !== "bigint") || (EntityFireOutputHook.Address <= 0n)) {
		const bHookRemoved = RemoveEntityFireOutputHook();
		if (!bHookRemoved) {
			throw new Error("Entity-output hook has no valid address and could not be removed.");
		}

		throw new Error("Entity-output hook did not expose its native address.");
	}
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Entity-output hook removal failed.");
	}
};

g_InstallNamedEntityOutputObserver();

module.exports.Unload = g_UnloadPlugin;
```

### Cap an output delay above one second

The delay is always the final raw argument on every supported ABI. `SetHookArgument()` updates the live call frame immediately and mirrors the value into `HookPayload.Arguments`. Direct changes to that payload array are also copied to the call frame after the callback completes; the normalized `EntityFireOutputContext.Arguments` is a separate copy and does not propagate changes.

```js
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");

const g_ClampEntityOutputDelay = function ClampEntityOutputDelay(HookPayload) {
	const flMaximumOutputDelay = 1.0;
	const EntityFireOutputContext = GetEntityFireOutputContext(HookPayload);
	if ((EntityFireOutputContext.OutputName === "OnTrigger") && (EntityFireOutputContext.Delay > flMaximumOutputDelay)) {
		HookPayload.SetHookArgument(HookPayload.Arguments.length - 1, flMaximumOutputDelay);
	}
};

const g_InstallEntityOutputDelayClamp = function InstallEntityOutputDelayClamp() {
	let EntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_ClampEntityOutputDelay);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "InstallEntityOutputDelayClamp installation and cleanup failed.");
		}

		throw new Error(`InstallEntityOutputDelayClamp failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	if ((typeof EntityFireOutputHook.Address !== "bigint") || (EntityFireOutputHook.Address <= 0n)) {
		const bHookRemoved = RemoveEntityFireOutputHook();
		if (!bHookRemoved) {
			throw new Error("Entity-output hook has no valid address and could not be removed.");
		}

		throw new Error("Entity-output hook did not expose its native address.");
	}
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Entity-output hook removal failed.");
	}
};

g_InstallEntityOutputDelayClamp();

module.exports.Unload = g_UnloadPlugin;
```

### Deliberately suppress an output

Returning a value other than `undefined` or `null` from the pre-hook skips the automatic original call; because `FireOutput` is `void`, no native return value is written. Use this only when suppressing the engine output is intentional:

```js
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");

const g_SuppressEntityBreakOutput = function SuppressEntityBreakOutput(HookPayload) {
	const EntityFireOutputContext = GetEntityFireOutputContext(HookPayload);
	if (EntityFireOutputContext.OutputName === "OnBreak") {
		return 0;
	}

	return undefined;
};

const g_InstallEntityBreakOutputSuppression = function InstallEntityBreakOutputSuppression() {
	let EntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_SuppressEntityBreakOutput);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "InstallEntityBreakOutputSuppression installation and cleanup failed.");
		}

		throw new Error(`InstallEntityBreakOutputSuppression failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	if ((typeof EntityFireOutputHook.Address !== "bigint") || (EntityFireOutputHook.Address <= 0n)) {
		const bHookRemoved = RemoveEntityFireOutputHook();
		if (!bHookRemoved) {
			throw new Error("Entity-output hook has no valid address and could not be removed.");
		}

		throw new Error("Entity-output hook did not expose its native address.");
	}
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Entity-output hook removal failed.");
	}
};

g_InstallEntityBreakOutputSuppression();

module.exports.Unload = g_UnloadPlugin;
```

### Call the Detours trampoline immediately

This example invokes the original once from inside the hook and reports the captured post-call registers. The result includes the native binding's general-purpose, flags, x87, and SSE fields; it is not a promise to capture CPU state beyond those exposed fields:

```js
const {
	CreateEntityFireOutputHook,
	GetEntityFireOutputContext,
	RemoveEntityFireOutputHook,
} = require("entities/outputs");
const { LogInfo } = require("loggers");

const g_CallUserEntityOutputTrampoline = function CallUserEntityOutputTrampoline(HookPayload) {
	const EntityFireOutputContext = GetEntityFireOutputContext(HookPayload);
	if (EntityFireOutputContext.OutputName !== "OnUser2") {
		return;
	}

	const flImmediateOutputDelay = 0.0;
	const vecTrampolineArguments = [...HookPayload.Arguments];
	vecTrampolineArguments[vecTrampolineArguments.length - 1] = flImmediateOutputDelay;

	const HookCallContext = HookPayload.CallHookTrampoline({ Arguments: vecTrampolineArguments, Registers: {} });
	if ((HookCallContext === null) || (typeof HookCallContext !== "object") || Array.isArray(HookCallContext) || (HookCallContext.Registers === null) || (typeof HookCallContext.Registers !== "object") || Array.isArray(HookCallContext.Registers)) {
		throw new Error("The Detours trampoline did not return a captured register context.");
	}

	const FormatRegister = ([strRegisterName, RegisterValue]) => [strRegisterName, (typeof RegisterValue === "bigint") ? `0x${RegisterValue.toString(16).toUpperCase()}` : RegisterValue];
	const Registers = Object.fromEntries(Object.entries(HookCallContext.Registers).map(FormatRegister));
	LogInfo("CallUserEntityOutputTrampoline Registers=%j ReturnValue=%s", Registers, HookCallContext.ReturnValue);
};

const g_InstallUserEntityOutputTrampoline = function InstallUserEntityOutputTrampoline() {
	let EntityFireOutputHook = null;

	try {
		EntityFireOutputHook = CreateEntityFireOutputHook(g_CallUserEntityOutputTrampoline);
	} catch (InstallationFailure) {
		let bHookRemoved = false;

		try {
			bHookRemoved = RemoveEntityFireOutputHook();
		} catch (CleanupFailure) {
			throw new AggregateError([InstallationFailure, CleanupFailure], "InstallUserEntityOutputTrampoline installation and cleanup failed.");
		}

		throw new Error(`InstallUserEntityOutputTrampoline failed. CleanupReportedRemoval=${bHookRemoved}`, { cause: InstallationFailure });
	}

	if ((typeof EntityFireOutputHook.TrampolineAddress !== "bigint") || (EntityFireOutputHook.TrampolineAddress <= 0n)) {
		const bHookRemoved = RemoveEntityFireOutputHook();
		if (!bHookRemoved) {
			throw new Error("Entity-output hook has no valid trampoline and could not be removed.");
		}

		throw new Error("Entity-output hook did not expose its Detours trampoline.");
	}
};

const g_UnloadPlugin = function UnloadPlugin() {
	if (!RemoveEntityFireOutputHook()) {
		throw new Error("Entity-output hook removal failed.");
	}
};

g_InstallUserEntityOutputTrampoline();

module.exports.Unload = g_UnloadPlugin;
```

### Prefer the high-level listener for observation

On the successful lifecycle path, the listener manager creates the hook for its first entity-output listener and removes it when the last listener is disposed. Listener return values do not suppress the engine output. A failed first registration can still leave the low-level shared hook installed; registration is not a transactional rollback guarantee. Do not mix direct hook removal with an active listener manager.

```js
const { RegisterEntityOutputListener } = require("listeners");
const { LogInfo } = require("loggers");

const g_ObserveEntityOutput = function ObserveEntityOutput(strEntityOutputName, ActivatorEntity, CallerEntity, EntityOutputValueRecord, flDelay, EntityOutputContext) {
	if (CallerEntity === null) {
		throw new Error("A named entity output did not resolve its caller.");
	}

	const nActivatorEntityIndex = (ActivatorEntity === null) ? null : ActivatorEntity.Index;
	const EntityOutputValueData = (EntityOutputValueRecord === null) ? null : EntityOutputValueRecord.Value;
	const EntityOutputLogValue = (typeof EntityOutputValueData === "bigint") ? EntityOutputValueData.toString() : EntityOutputValueData;
	LogInfo("ObserveEntityOutput Result=%j", {
		Delay: flDelay,
		EntityOutputValue: EntityOutputLogValue,
		OutputAddress: `0x${EntityOutputContext.OutputAddress.toString(16).toUpperCase()}`,
		EntityOutputName: strEntityOutputName,
		ActivatorEntityIndex: nActivatorEntityIndex,
		CallerEntityIndex: CallerEntity.Index,
	});
};

const g_EntityOutputListener = RegisterEntityOutputListener(g_ObserveEntityOutput);

const g_UnloadPlugin = function UnloadPlugin() {
	if (!g_EntityOutputListener.DisposeListener()) {
		throw new Error("Entity-output listener disposal failed.");
	}
};

module.exports.Unload = g_UnloadPlugin;
```

## Errors and lifetime

- Profile names and INI text must be strings. Only unquoted exact `True`/`False` INI values become booleans; quoted values remain strings. Argument-type fields are subsequently normalized to arrays of canonical type names.
- Addresses in hook payloads are non-negative `bigint` values. Numbers, strings, object wrappers, and `null` are rejected.
- A wrong ABI argument count throws before any value is interpreted as an engine address.
- Windows x86's nine-value layout additionally requires the pre-hook's nonzero BigInt `StackAddress`; its Variant type word is never interpreted as an address. Windows x64 and Linux require five values and do not inspect `StackAddress`.
- A stale non-zero entity address can fail during entity-index resolution. A non-negative entity index is passed to `Entity()`; world index `0` is valid, not the null sentinel. A negative result becomes `null`. Zero (`0n`) activator, caller, or Variant addresses become `null` values where applicable.
- `OutputName` is `null` when the caller address is `0n` or the non-zero output address is not one of the caller's current output fields. A non-zero caller with a zero (`0n`) output address throws. Only the exact `OutputName` field is exposed; other casing is not aliased.
- The native Variant address, call-frame storage, and engine addresses carried by raw ABI values are valid only during the current `FireOutput` call. The decoded `Value` is a JavaScript snapshot; Entity wrappers keep their ordinary live-index lifetime.
- A cached profile may be edited, but changing ABI data while its old hook exists does not rebuild that hook.
- `RemoveEntityFireOutputHook()` removes all callbacks on the shared hook. Coordinate ownership when multiple subsystems use this low-level API in one plugin.
- Hook callbacks execute synchronously on the thread that enters `FireOutput` (normally the server thread). Do not wait for blocking CPR/HTTP, Redis, SOCI, or socket requests inside them.

## Related modules

- [`entities/entity`](entities-entity.md) documents the live Entity wrappers returned as caller and activator.
- [`entities/datamaps`](entities-datamaps.md) documents Variant records and native output fields.
- [`entities/helpers`](entities-helpers.md) documents address conversion and `FindEntityOutputNameByAddress()`.
- [`listeners`](listeners.md) owns the ordinary high-level `RegisterEntityOutputListener` lifecycle.
- [`memory/hooks`](memory-hooks.md) documents raw payloads, return control, callback removal, and trampoline calls.
- [`memory/manager`](memory-manager.md) documents binary symbol/signature resolution.
