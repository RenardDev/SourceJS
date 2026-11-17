# `require("globals")`

> AI navigation: use the contents to locate a responsibility, then review one bounded chunk at a time. Importing the module does not establish that the engine's current `CGlobalVars` storage is available.

`globals` exposes the selected Source SDK's current `CGlobalVars` storage. It lives in `packages/sourcejs/globals.js`, which exports the exact native object registered by `ModuleBindings.cpp`. The module does not copy frame state or recreate `CGlobalVars` in JavaScript.

Use it on the game thread for synchronous timing diagnostics, map-load state, tick calculations, and carefully controlled low-level writes. Most fields are engine internals, not configuration settings. Run write examples only during an isolated, controlled engine phase; never dispatch them from a worker thread. Restore temporary writes immediately and never retain a view or borrowed address across plugin unload or engine shutdown.

Temporary-write examples retain their original failure and collect independent restoration failures in attempt order. Address guards prevent restoring captured values into storage at a different address; they do not pin storage or detect reuse at the same address. The isolated-phase restriction still applies.

## Contents

- [Import and exports](#import-and-exports)
- [MapLoadType](#maploadtype)
- [Live view semantics](#live-view-semantics)
- [Mandatory properties](#mandatory-properties)
- [Selected-SDK members](#selected-sdk-members)
- [Methods](#methods)
- [Strict values and address safety](#strict-values-and-address-safety)
- [Practical workflows](#practical-workflows)
- [Lifecycle and related modules](#lifecycle-and-related-modules)

## Import and exports

```js
const { GetGlobalVariables, MapLoadType } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportGlobalVariables = () => {
	const GlobalVariables = GetGlobalVariables();

	function IsCurrentMapLoadType(vecMapLoadTypeEntry) {
		const nMapLoadType = vecMapLoadTypeEntry[1];

		return nMapLoadType === GlobalVariables.MapLoadType;
	}

	const vecCurrentMapLoadTypeEntry = Object.entries(MapLoadType).find(IsCurrentMapLoadType);
	if (vecCurrentMapLoadTypeEntry === undefined) {
		throw new Error(`Unknown MapLoadType value: ${GlobalVariables.MapLoadType}.`);
	}

	LogInfo("GlobalVariables %s", JSON.stringify({ CurrentTime: GlobalVariables.CurrentTime, TickCount: GlobalVariables.TickCount, MapLoadType: vecCurrentMapLoadTypeEntry[0], MapName: GlobalVariables.MapName }));
};

g_ReportGlobalVariables();
```

| Export | Kind and contract |
| --- | --- |
| [`MapLoadType`](#maploadtype) | Object containing the exact integer values from the selected SDK's `MapLoadType_t`. |
| `GetGlobalVariables()` | Creates a fresh JavaScript accessor object over the current native `CGlobalVars` storage. |

The module has exactly two root names: `MapLoadType` and `GetGlobalVariables`. The function needs no arguments; its callback does not reject extra arguments. View installation can fail independently of later field access: creating an accessor object does not require the native storage, but reading or writing its live properties does.

## MapLoadType

| Member | HL2SDK value | Meaning |
| --- | --- | --- |
| `MapLoadType.NEW_GAME` | `MapLoad_NewGame` | A new map/game is being initialized. |
| `MapLoadType.LOAD_GAME` | `MapLoad_LoadGame` | State is being restored from a save. |
| `MapLoadType.TRANSITION` | `MapLoad_Transition` | A level transition carries state from another map. |
| `MapLoadType.BACKGROUND` | `MapLoad_Background` | A background or main-menu map is being loaded. |

Do not persist the numeric values independently of this namespace. Read the member exported by the running selected-SDK build.

## Live view semantics

Each `GetGlobalVariables()` call creates a different JavaScript object. Its accessors resolve the engine's current `CGlobalVars` storage on every read or write instead of retaining the address captured at creation. If the engine replaces that storage, existing views follow the new storage:

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_InspectLiveGlobalVariables = () => {
	const vecFailures = [];
	const FirstGlobalVariablesView = GetGlobalVariables();
	const unGlobalVariablesAddress = FirstGlobalVariablesView.Address;
	const SecondGlobalVariablesView = GetGlobalVariables();
	const flPreviousCurrentTime = FirstGlobalVariablesView.CurrentTime;

	try {
		if (FirstGlobalVariablesView.Address !== unGlobalVariablesAddress) {
			throw new Error("Current global storage changed before the temporary write.");
		}

		FirstGlobalVariablesView.CurrentTime = flPreviousCurrentTime + 0.125;
		if (SecondGlobalVariablesView.CurrentTime !== FirstGlobalVariablesView.CurrentTime) {
			throw new Error("Current-time write was not visible through the second view.");
		}

		LogInfo("GlobalLiveView CurrentTime=%s", String(SecondGlobalVariablesView.CurrentTime));
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		try {
			if (SecondGlobalVariablesView.Address !== unGlobalVariablesAddress) {
				throw new Error("Current global storage changed before current-time restoration.");
			}

			SecondGlobalVariablesView.CurrentTime = flPreviousCurrentTime;
			if (FirstGlobalVariablesView.CurrentTime !== flPreviousCurrentTime) {
				throw new Error("Current-time restoration failed.");
			}
		} catch (CleanupFailure) {
			vecFailures.push(CleanupFailure);
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Current-time inspection and restoration failed.");
	}
};

g_InspectLiveGlobalVariables();
```

The two returned objects are not strictly equal, but a write through either view is immediately visible through the other while the current storage is unchanged. This is a live non-owning view, not a snapshot and not a retained copy of the native address. Scalar values already read into local variables remain snapshots. A saved `Address` is borrowed and does not automatically follow subsequent storage changes. Each view also has an `SDKBranch` string containing the build's selected SDK branch; it is an own writable, enumerable, configurable data property, not a live `CGlobalVars` field. Creating this metadata does not invoke an inherited `SDKBranch` setter or depend on an inherited property's writability.

If the engine has no current global storage, live property reads/writes and available method calls throw a JavaScript `Error`; they do not return detached defaults or create replacement storage.

Native property getters and setters translate C++ preparation, current-address lookup, conversion, and result-construction exceptions into JavaScript errors identifying a property read or write. This boundary does not roll back a native field write already completed, and it does not validate arbitrary native memory or turn memory-access faults into C++ exceptions. Existing SDK availability errors, strict value checks, and BigInt address results remain unchanged.

View creation and the installed `IsClient`, `IsRemoteClient`, and `GetNetworkBase` methods also translate C++ failures into operation-specific JavaScript errors. Each available method is an own writable, enumerable, configurable data property; inherited setters and non-writable prototype properties do not intercept its installation. View installation preserves an original JavaScript property error or execution termination instead of replacing it with a generic installation error. An already caught JavaScript exception also survives C++ unwinding during installation; a plain C++ failure becomes the operation-specific error. Installation does not undo already completed work. SDK-dependent members remain conditional, including `MapLoadFailed`.

## Mandatory properties

| Property | Type | Access | Native storage and use |
| --- | --- | --- | --- |
| `Address` | bigint | read-only | Native address of the current `CGlobalVars`. Use only with an API that explicitly accepts this layout. |
| `RealTime` | number | read/write | `CGlobalVarsBase::realtime`, total real elapsed time. |
| `FrameCount` | integer | read/write | `CGlobalVarsBase::framecount`, rendered/server frame counter. |
| `AbsoluteFrameTime` | number | read/write | `CGlobalVarsBase::absoluteframetime`, unscaled duration of the previous frame. |
| `CurrentTime` | number | read/write | `CGlobalVarsBase::curtime`, current simulation time. |
| `FrameTime` | number | read/write | `CGlobalVarsBase::frametime`, scaled simulation frame duration. |
| `MaximumClients` | integer | read/write | `CGlobalVarsBase::maxClients`, active branch client limit. This is not a normal slot configuration API. |
| `TickCount` | integer | read/write | `CGlobalVarsBase::tickcount`, current simulation tick. |
| `IntervalPerTick` | number | read/write | `CGlobalVarsBase::interval_per_tick`, seconds per simulation tick. |
| `InterpolationAmount` | number | read/write | `CGlobalVarsBase::interpolation_amount`, current interpolation fraction. |
| `SaveRestoreDataAddress` | bigint | read/write | `CSaveRestoreData*` address; `0n` means null. The setter checks only the address representation and range, not the pointee's type or lifetime; write only a verified address to a live compatible object. |
| `MapName` | string | read-only | Current pooled `string_t` map name. |
| `MapVersion` | integer | read/write | Current map format/version value. |
| `StartSpot` | string | read-only | Current pooled `string_t` start landmark. |
| [`MapLoadType`](#maploadtype) | integer | read/write | One exact `MapLoadType` value. |
| `IsDeathmatch` | boolean | read/write | Current engine deathmatch mode flag. |
| `IsCooperative` | boolean | read/write | Current engine cooperative mode flag. |
| `IsTeamplay` | boolean | read/write | Current engine teamplay mode flag. |
| `MaximumEntities` | integer | read/write | Current entity capacity. This is not a resizing API. |

Read-only strings remain read-only because Source owns their string-pool storage. Assigning a JavaScript string cannot safely transfer that ownership.

### Tick and frame diagnostics

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportTickAndFrameDiagnostics = () => {
	const GlobalVariables = GetGlobalVariables();
	if ((GlobalVariables.IntervalPerTick <= 0) || (GlobalVariables.AbsoluteFrameTime <= 0)) {
		throw new RangeError(`Invalid frame timing: IntervalPerTick=${GlobalVariables.IntervalPerTick}, AbsoluteFrameTime=${GlobalVariables.AbsoluteFrameTime}.`);
	}

	const flTickRate = 1 / GlobalVariables.IntervalPerTick;
	const flFrameRate = 1 / GlobalVariables.AbsoluteFrameTime;
	LogInfo("GlobalTiming %s", JSON.stringify({ CurrentTime: GlobalVariables.CurrentTime, FrameRate: flFrameRate, InterpolationAmount: GlobalVariables.InterpolationAmount, TickRate: flTickRate }));

	const FrameDiagnostics = { FrameCount: GlobalVariables.FrameCount, TickCount: GlobalVariables.TickCount };
	if (Object.hasOwn(GlobalVariables, "SimulatedTicksThisFrame")) {
		FrameDiagnostics.SimulatedTicksThisFrame = GlobalVariables.SimulatedTicksThisFrame;
	}

	LogInfo("GlobalFrame %s", JSON.stringify(FrameDiagnostics));
};

g_ReportTickAndFrameDiagnostics();
```

### Map-load diagnostics

```js
const { GetGlobalVariables, MapLoadType } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportMapLoadDiagnostics = () => {
	const GlobalVariables = GetGlobalVariables();

	function IsCurrentMapLoadType(vecMapLoadTypeEntry) {
		const nMapLoadType = vecMapLoadTypeEntry[1];

		return nMapLoadType === GlobalVariables.MapLoadType;
	}

	const vecCurrentMapLoadTypeEntry = Object.entries(MapLoadType).find(IsCurrentMapLoadType);
	if (vecCurrentMapLoadTypeEntry === undefined) {
		throw new Error(`Unknown MapLoadType value: ${GlobalVariables.MapLoadType}.`);
	}

	const MapLoadDiagnostics = { MapVersion: GlobalVariables.MapVersion, MapLoadType: vecCurrentMapLoadTypeEntry[0], MapName: GlobalVariables.MapName, StartSpot: GlobalVariables.StartSpot };
	if (Object.hasOwn(GlobalVariables, "MapLoadFailed")) {
		MapLoadDiagnostics.MapLoadFailed = GlobalVariables.MapLoadFailed;
	}

	LogInfo("GlobalMapLoad %s", JSON.stringify(MapLoadDiagnostics));
};

g_ReportMapLoadDiagnostics();
```

## Selected-SDK members

These members are installed only when the selected HL2SDK branch declares the corresponding field or method. SourceJS does not synthesize unavailable members.

| Property or method | Type | Access | Capability |
| --- | --- | --- | --- |
| `AbsoluteFrameStartTimeStandardDeviation` | number | read/write | Present when `CGlobalVarsBase::absoluteframestarttimestddev` exists. |
| `ServerCount` | integer | read/write | Present when `CGlobalVars::serverCount` exists. |
| `EdictArrayAddress` | bigint | read/write | Present when `CGlobalVars::pEdicts` exists. `0n` means null; otherwise the address borrows the edict array. The setter validates only the BigInt representation and process width, not the array's type, extent, or lifetime. |
| `MapGroupName` | string | read-only | Present when `CGlobalVars::mapGroupName` exists. |
| `IsRemoteClient()` | function | call | Present when the selected `CGlobalVarsBase` declares `IsRemoteClient()`. |
| `SimulatedTicksThisFrame` | integer | read/write | Current simulation ticks for the frame, when exposed by the selected SDK. |
| `NetworkProtocol` | integer | read/write | Active network-protocol number, when exposed by the selected SDK. |
| `MapLoadFailed` | boolean | read/write | Whether the current map load failed, when exposed by the selected SDK. |
| `IsClient()` | function | call | Present when the selected `CGlobalVarsBase` declares `IsClient()`. |
| `GetNetworkBase(nTick, nEntityIndex)` | function | call | Present when the selected `CGlobalVarsBase` declares `GetNetworkBase()`; both arguments are exact signed 32-bit integers. |

Guard optional members by ownership, not by branch-name guesses:

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportGlobalVariableCapabilities = () => {
	const GlobalVariables = GetGlobalVariables();
	const GlobalVariableCapabilities = {
		HasAbsoluteFrameStartTimeStandardDeviation: Object.hasOwn(GlobalVariables, "AbsoluteFrameStartTimeStandardDeviation"),
		HasEdictArrayAddress: Object.hasOwn(GlobalVariables, "EdictArrayAddress"),
		HasGetNetworkBase: typeof GlobalVariables.GetNetworkBase === "function",
		HasIsClient: typeof GlobalVariables.IsClient === "function",
		HasMapGroupName: Object.hasOwn(GlobalVariables, "MapGroupName"),
		HasMapLoadFailed: Object.hasOwn(GlobalVariables, "MapLoadFailed"),
		HasNetworkProtocol: Object.hasOwn(GlobalVariables, "NetworkProtocol"),
		HasRemoteClient: typeof GlobalVariables.IsRemoteClient === "function",
		HasServerCount: Object.hasOwn(GlobalVariables, "ServerCount"),
		HasSimulatedTicksThisFrame: Object.hasOwn(GlobalVariables, "SimulatedTicksThisFrame"),
	};

	LogInfo("GlobalCapabilities %s", JSON.stringify(GlobalVariableCapabilities));
};

g_ReportGlobalVariableCapabilities();
```

## Methods

| Method | Return and contract |
| --- | --- |
| `IsClient()` | When available in the selected SDK, returns the result of `CGlobalVarsBase::IsClient()` for the current engine process. |
| `GetNetworkBase(nTick, nEntityIndex)` | When available in the selected SDK, synchronously returns its signed integer network base. Both arguments must be exact signed 32-bit integers; the wrapper does not validate entity existence or slot membership. |
| `IsRemoteClient()` | Returns the result of `CGlobalVarsBase::IsRemoteClient()` when the selected SDK declares it. |

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportGlobalNetworkDiagnostics = () => {
	const GlobalVariables = GetGlobalVariables();
	const NetworkDiagnostics = {};
	if (typeof GlobalVariables.IsClient === "function") {
		NetworkDiagnostics.IsClient = GlobalVariables.IsClient();
	}

	if (typeof GlobalVariables.GetNetworkBase === "function") {
		const nEntityIndex = 1;
		NetworkDiagnostics.NetworkBase = GlobalVariables.GetNetworkBase(GlobalVariables.TickCount, nEntityIndex);
	}

	if (typeof GlobalVariables.IsRemoteClient === "function") {
		NetworkDiagnostics.IsRemoteClient = GlobalVariables.IsRemoteClient();
	}

	LogInfo("GlobalNetwork %s", JSON.stringify(NetworkDiagnostics));
};

g_ReportGlobalNetworkDiagnostics();
```

## Strict values and address safety

- Floating-point setters require actual finite JavaScript numbers within the native `float` range. Conversion rounds to native `float`; sufficiently small magnitudes may become zero. Validation does not enforce positive time values or other engine invariants.
- Integer setters and `GetNetworkBase()` arguments require exact signed 32-bit integers.
- Boolean setters require actual booleans. `0`, `1`, and strings are rejected.
- `MapLoadType` accepts only one of the four integer values exported by `MapLoadType`.
- Address setters require non-negative `bigint` values that fit the current process's `uintptr_t` width. Numbers, strings, and objects are rejected; negative or out-of-range values are rejected without truncation. `0n` represents a null address where the property permits it.

```js
"use strict";

const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_VerifyInvalidGlobalVariableWrites = () => {
	const GlobalVariables = GetGlobalVariables();
	const vecInvalidGlobalVariableWrites = [
		["CurrentTime", "12.5"],
		["TickCount", 1.5],
		["MapLoadType", 99],
		["SaveRestoreDataAddress", -1n],
		["SaveRestoreDataAddress", 1],
	];
	if (Object.hasOwn(GlobalVariables, "MapLoadFailed")) {
		vecInvalidGlobalVariableWrites.push(["MapLoadFailed", 1]);
	}

	for (const vecInvalidPropertyEntry of vecInvalidGlobalVariableWrites) {
		const strPropertyName = vecInvalidPropertyEntry[0];
		const InvalidValue = vecInvalidPropertyEntry[1];
		let CaughtError = null;

		try {
			GlobalVariables[strPropertyName] = InvalidValue;
		} catch (ErrorValue) {
			CaughtError = ErrorValue;
		}

		if (!(CaughtError instanceof Error)) {
			throw new Error(`Property ${strPropertyName} did not reject ${String(InvalidValue)}.`);
		}

		LogInfo("GlobalRejectedWrite Property=%s Message=%s", strPropertyName, CaughtError.message);
	}
};

g_VerifyInvalidGlobalVariableWrites();
```

## Practical workflows

### Temporarily adjust timing and restore it

```js
const { GetGlobalVariables } = require("globals");

const g_VerifyTemporaryGlobalTiming = () => {
	const vecFailures = [];
	const GlobalVariables = GetGlobalVariables();
	const unGlobalVariablesAddress = GlobalVariables.Address;
	const PreviousGlobalTiming = {
		AbsoluteFrameTime: GlobalVariables.AbsoluteFrameTime,
		CurrentTime: GlobalVariables.CurrentTime,
		FrameTime: GlobalVariables.FrameTime,
		InterpolationAmount: GlobalVariables.InterpolationAmount,
		IntervalPerTick: GlobalVariables.IntervalPerTick,
		RealTime: GlobalVariables.RealTime,
	};

	const flTemporaryFrameInterval = 0.01;
	const TemporaryGlobalTiming = {
		AbsoluteFrameTime: Math.fround(flTemporaryFrameInterval),
		CurrentTime: Math.fround(PreviousGlobalTiming.CurrentTime + flTemporaryFrameInterval),
		FrameTime: Math.fround(flTemporaryFrameInterval),
		InterpolationAmount: Math.fround(0.5),
		IntervalPerTick: Math.fround(flTemporaryFrameInterval),
		RealTime: Math.fround(PreviousGlobalTiming.RealTime + flTemporaryFrameInterval),
	};

	try {
		if (GlobalVariables.Address !== unGlobalVariablesAddress) {
			throw new Error("Current global storage changed before the temporary write.");
		}

		Object.assign(GlobalVariables, TemporaryGlobalTiming);
		for (const vecTimingEntry of Object.entries(TemporaryGlobalTiming)) {
			const strPropertyName = vecTimingEntry[0];
			const flExpectedValue = vecTimingEntry[1];
			if (GlobalVariables[strPropertyName] !== flExpectedValue) {
				throw new Error(`Property ${strPropertyName} write did not reach CGlobalVars.`);
			}
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		for (const vecTimingEntry of Object.entries(PreviousGlobalTiming).reverse()) {
			const strPropertyName = vecTimingEntry[0];
			const flExpectedValue = vecTimingEntry[1];

			try {
				if (GlobalVariables.Address !== unGlobalVariablesAddress) {
					throw new Error(`Current global storage changed before restoring ${strPropertyName}.`);
				}

				GlobalVariables[strPropertyName] = flExpectedValue;
				if (GlobalVariables[strPropertyName] !== flExpectedValue) {
					throw new Error(`Property ${strPropertyName} restoration failed.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Temporary global writes and restoration failed.");
	}
};

g_VerifyTemporaryGlobalTiming();
```

### Verify integer setters without retaining changes

```js
const { GetGlobalVariables } = require("globals");

const g_VerifyTemporaryGlobalIntegers = () => {
	const vecFailures = [];
	const GlobalVariables = GetGlobalVariables();
	const unGlobalVariablesAddress = GlobalVariables.Address;
	const PreviousGlobalIntegerValues = {
		FrameCount: GlobalVariables.FrameCount,
		MapVersion: GlobalVariables.MapVersion,
		MaximumClients: GlobalVariables.MaximumClients,
		MaximumEntities: GlobalVariables.MaximumEntities,
		TickCount: GlobalVariables.TickCount,
	};

	const vecOptionalIntegerPropertyNames = [
		"NetworkProtocol",
		"ServerCount",
		"SimulatedTicksThisFrame",
	];
	for (const strPropertyName of vecOptionalIntegerPropertyNames) {
		if (Object.hasOwn(GlobalVariables, strPropertyName)) {
			PreviousGlobalIntegerValues[strPropertyName] = GlobalVariables[strPropertyName];
		}
	}

	const nMaximumSignedInteger = 2147483647;
	const TemporaryGlobalIntegerValues = {
		...PreviousGlobalIntegerValues,
		FrameCount: (PreviousGlobalIntegerValues.FrameCount === nMaximumSignedInteger) ? (PreviousGlobalIntegerValues.FrameCount - 1) : (PreviousGlobalIntegerValues.FrameCount + 1),
		TickCount: (PreviousGlobalIntegerValues.TickCount === nMaximumSignedInteger) ? (PreviousGlobalIntegerValues.TickCount - 1) : (PreviousGlobalIntegerValues.TickCount + 1),
	};

	try {
		if (GlobalVariables.Address !== unGlobalVariablesAddress) {
			throw new Error("Current global storage changed before the temporary write.");
		}

		Object.assign(GlobalVariables, TemporaryGlobalIntegerValues);
		for (const vecIntegerEntry of Object.entries(TemporaryGlobalIntegerValues)) {
			const strPropertyName = vecIntegerEntry[0];
			const nExpectedValue = vecIntegerEntry[1];
			if (GlobalVariables[strPropertyName] !== nExpectedValue) {
				throw new Error(`Property ${strPropertyName} write did not reach CGlobalVars.`);
			}
		}
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		for (const vecIntegerEntry of Object.entries(PreviousGlobalIntegerValues).reverse()) {
			const strPropertyName = vecIntegerEntry[0];
			const nExpectedValue = vecIntegerEntry[1];

			try {
				if (GlobalVariables.Address !== unGlobalVariablesAddress) {
					throw new Error(`Current global storage changed before restoring ${strPropertyName}.`);
				}

				GlobalVariables[strPropertyName] = nExpectedValue;
				if (GlobalVariables[strPropertyName] !== nExpectedValue) {
					throw new Error(`Property ${strPropertyName} restoration failed.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Temporary global writes and restoration failed.");
	}
};

g_VerifyTemporaryGlobalIntegers();
```

Changing `MaximumClients`, `MaximumEntities`, `NetworkProtocol`, or `ServerCount` does not reconfigure or resize the engine. Their setters expose the underlying storage for controlled low-level work only.

### Temporarily inspect mode transitions

```js
const { GetGlobalVariables, MapLoadType } = require("globals");
const { LogInfo } = require("loggers");

const g_VerifyTemporaryGlobalModes = () => {
	const vecFailures = [];
	const GlobalVariables = GetGlobalVariables();
	const unGlobalVariablesAddress = GlobalVariables.Address;
	const PreviousGlobalModes = { IsCooperative: GlobalVariables.IsCooperative, IsDeathmatch: GlobalVariables.IsDeathmatch, IsTeamplay: GlobalVariables.IsTeamplay, MapLoadType: GlobalVariables.MapLoadType };

	const TemporaryGlobalModes = { IsCooperative: true, IsDeathmatch: false, IsTeamplay: true, MapLoadType: MapLoadType.TRANSITION };
	if (Object.hasOwn(GlobalVariables, "MapLoadFailed")) {
		PreviousGlobalModes.MapLoadFailed = GlobalVariables.MapLoadFailed;
		TemporaryGlobalModes.MapLoadFailed = false;
	}

	try {
		if (GlobalVariables.Address !== unGlobalVariablesAddress) {
			throw new Error("Current global storage changed before the temporary write.");
		}

		Object.assign(GlobalVariables, TemporaryGlobalModes);
		for (const vecModeEntry of Object.entries(TemporaryGlobalModes)) {
			const strPropertyName = vecModeEntry[0];
			const ExpectedValue = vecModeEntry[1];
			if (GlobalVariables[strPropertyName] !== ExpectedValue) {
				throw new Error(`Property ${strPropertyName} mode write did not reach CGlobalVars.`);
			}
		}

		LogInfo("GlobalTemporaryModes %s", JSON.stringify(TemporaryGlobalModes));
	} catch (Failure) {
		vecFailures.push(Failure);
	} finally {
		for (const vecModeEntry of Object.entries(PreviousGlobalModes).reverse()) {
			const strPropertyName = vecModeEntry[0];
			const ExpectedValue = vecModeEntry[1];

			try {
				if (GlobalVariables.Address !== unGlobalVariablesAddress) {
					throw new Error(`Current global storage changed before restoring ${strPropertyName}.`);
				}

				GlobalVariables[strPropertyName] = ExpectedValue;
				if (GlobalVariables[strPropertyName] !== ExpectedValue) {
					throw new Error(`Property ${strPropertyName} restoration failed.`);
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Temporary global writes and restoration failed.");
	}
};

g_VerifyTemporaryGlobalModes();
```

### Inspect native addresses without replacing ownership

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_InspectGlobalAddresses = () => {
	const GlobalVariables = GetGlobalVariables();
	const GlobalAddressInformation = { GlobalVariablesAddress: GlobalVariables.Address, SaveRestoreDataAddress: GlobalVariables.SaveRestoreDataAddress };
	if (Object.hasOwn(GlobalVariables, "EdictArrayAddress")) {
		GlobalAddressInformation.EdictArrayAddress = GlobalVariables.EdictArrayAddress;
	}

	GlobalVariables.SaveRestoreDataAddress = GlobalAddressInformation.SaveRestoreDataAddress;
	if (GlobalVariables.SaveRestoreDataAddress !== GlobalAddressInformation.SaveRestoreDataAddress) {
		throw new Error("Same-value write to SaveRestoreDataAddress failed.");
	}

	if (Object.hasOwn(GlobalAddressInformation, "EdictArrayAddress")) {
		GlobalVariables.EdictArrayAddress = GlobalAddressInformation.EdictArrayAddress;
		if (GlobalVariables.EdictArrayAddress !== GlobalAddressInformation.EdictArrayAddress) {
			throw new Error("Same-value write to EdictArrayAddress failed.");
		}
	}

	const GlobalAddressReport = { GlobalVariablesAddress: GlobalAddressInformation.GlobalVariablesAddress.toString(), SaveRestoreDataAddress: GlobalAddressInformation.SaveRestoreDataAddress.toString() };
	if (Object.hasOwn(GlobalAddressInformation, "EdictArrayAddress")) {
		GlobalAddressReport.EdictArrayAddress = GlobalAddressInformation.EdictArrayAddress.toString();
	}

	LogInfo("GlobalAddresses %s", JSON.stringify(GlobalAddressReport));
};

g_InspectGlobalAddresses();
```

The assignments above intentionally write the same address values back without transferring ownership. Never deallocate these engine-owned addresses. Run this example without intervening engine callbacks or storage replacement; writing a previously borrowed address into different current storage is not a safe restore. Replacing either address with unrelated memory can corrupt the server.

### Pair a bounded timing override with cleanup

The helpers below are not plugin lifecycle hooks. Call them as a synchronous pair during an isolated engine phase, not across frames, map changes, plugin lifetime, or an asynchronous request. Restoring an old value into replacement global storage is unsafe; the guard detects a changed address before writing. It cannot detect storage reuse at the same address, so the isolated-phase lifetime restriction remains mandatory.

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_GlobalVariables = GetGlobalVariables();
let g_flPreviousCurrentTime = 0;
let g_unCurrentTimeOverrideAddress = 0n;
let g_bCurrentTimeOverrideActive = false;

function BeginCurrentTimeOverride() {
	if (g_bCurrentTimeOverrideActive) {
		throw new Error("Current-time override is already active.");
	}

	g_unCurrentTimeOverrideAddress = g_GlobalVariables.Address;
	g_flPreviousCurrentTime = g_GlobalVariables.CurrentTime;
	if (g_GlobalVariables.Address !== g_unCurrentTimeOverrideAddress) {
		throw new Error("Current global storage changed before the timing override.");
	}

	g_bCurrentTimeOverrideActive = true;
	g_GlobalVariables.CurrentTime = 0;
	if (g_GlobalVariables.CurrentTime !== 0) {
		throw new Error("Current-time override failed.");
	}
}

function EndCurrentTimeOverride() {
	if (!g_bCurrentTimeOverrideActive) {
		return;
	}

	if (g_GlobalVariables.Address !== g_unCurrentTimeOverrideAddress) {
		throw new Error("Current global storage changed; refusing to restore an old timing value into replacement storage.");
	}

	g_GlobalVariables.CurrentTime = g_flPreviousCurrentTime;
	if (g_GlobalVariables.CurrentTime !== g_flPreviousCurrentTime) {
		throw new Error("Current-time override restoration failed.");
	}

	g_bCurrentTimeOverrideActive = false;
}

const g_vecCurrentTimeOverrideFailures = [];
const g_bCurrentTimeOverridePreviouslyActive = g_bCurrentTimeOverrideActive;

try {
	BeginCurrentTimeOverride();
	LogInfo("GlobalCurrentTimeOverride CurrentTime=%s", String(g_GlobalVariables.CurrentTime));
} catch (Failure) {
	g_vecCurrentTimeOverrideFailures.push(Failure);
} finally {
	if (!g_bCurrentTimeOverridePreviouslyActive) {
		try {
			EndCurrentTimeOverride();
		} catch (CleanupFailure) {
			g_vecCurrentTimeOverrideFailures.push(CleanupFailure);
		}
	}
}

if (g_vecCurrentTimeOverrideFailures.length === 1) {
	throw g_vecCurrentTimeOverrideFailures[0];
}

if (g_vecCurrentTimeOverrideFailures.length > 1) {
	throw new AggregateError(g_vecCurrentTimeOverrideFailures, "Current-time override and restoration failed.");
}
```

The caller records prior ownership, so a rejected duplicate begin does not end an already active override. A failed restoration leaves the active flag set; do not clear it or start another override without resolving the failed cleanup and checking the storage lifetime. Operation and cleanup failures are retained rather than treating a failed restore as success.

## Lifecycle and related modules

- Use this synchronous API only on the game thread while the SourceJS runtime and engine interfaces are active; it is not a worker-thread or asynchronous request API.
- Do not retain the accessor object after plugin unload. It is non-owning even though every access resolves the current native globals address.
- Pair temporary writes with `finally` within one controlled phase. Do not hold an engine-state override across frames or asynchronous callbacks; plugin unload is not a substitute for timely restoration.
- Use [`engines/server`](engines-server.md) for the same live view through `engines/server.GetGlobalVariables()` and for higher-level server operations.
- Use [`listeners/tick`](listeners-tick.md) for scheduled work instead of manually advancing frame or tick counters.
- Use [`memory`](memory.md) only when an operation explicitly requires the native `Address` as `bigint`; ordinary timing and map-state code should stay on the named accessors.

Native fields use V8 data-property descriptors: inspect their `writable` flag without attempting an unsafe assignment. Native getter/setter callbacks are not JavaScript accessor functions, so `descriptor.set` does not distinguish read-only fields from writable ones.

```js
const { GetGlobalVariables } = require("globals");
const { LogInfo } = require("loggers");

const g_ReportReadOnlyGlobalProperties = () => {
	const GlobalVariables = GetGlobalVariables();
	const MapNamePropertyDescriptor = Object.getOwnPropertyDescriptor(GlobalVariables, "MapName");
	const AddressPropertyDescriptor = Object.getOwnPropertyDescriptor(GlobalVariables, "Address");
	if ((MapNamePropertyDescriptor === undefined) || (AddressPropertyDescriptor === undefined)) {
		throw new Error("Mandatory global property descriptor is missing.");
	}

	LogInfo("GlobalReadOnlyProperties %s", JSON.stringify({ MapNameWritable: MapNamePropertyDescriptor.writable === true, AddressWritable: AddressPropertyDescriptor.writable === true }));
};

g_ReportReadOnlyGlobalProperties();
```
