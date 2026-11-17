#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strPackageRootPath = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "index.js");
const g_strBaseDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "memory-hooks-callbacks.md");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "memory-hooks.md");
const g_strExceptionsPath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "exceptions.js");
const g_strExceptionsDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "memory-hooks-exceptions.md");
const g_strHooksPath = g_Path.join(g_strPackageRootPath, "memory", "hooks.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strWarningsPath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "warnings.js");
const g_strWarningsDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "memory-hooks-warnings.md");

// Controlled fixture addresses are uint64 values, not proof of native executability.
const g_unMaximumMockHookAddress = 0xFFFFFFFFFFFFFFFFn;
const g_unMockTrampolineOffset = 0x100000n;
let g_bHooksDisabled = false;
let g_unNextHookID = 1;
const g_vecEmittedExceptions = [];
const g_vecEmittedWarnings = [];
const g_mapHookRecords = new Map();
const g_vecLoggerCallLog = [];
const g_vecNativeCallLog = [];
const g_ExpectedDocumentationExampleCounts = Object.freeze({ Hooks: 20, Callbacks: 9, Exceptions: 8, Warnings: 9 });
const g_ExecutedDocumentationExampleCounts = { Hooks: 0, Callbacks: 0, Exceptions: 0, Warnings: 0 };

function MarkUnhandledFailure() {
	process.exitCode = 1;
}

function RemoveCallback(vecCallbacks, Callback) {
	const nCallbackIndex = vecCallbacks.indexOf(Callback);
	if (nCallbackIndex === -1) {
		return false;
	}

	vecCallbacks.splice(nCallbackIndex, 1);

	return true;
}

function CreateEventRuntime(strEventName, vecEmittedPayloads) {
	const vecCallbacks = [];

	return {
		get CallbackCount() {
			return vecCallbacks.length;
		},

		Emit(strSerializedPayload = "") {
			g_Assert.equal(typeof strSerializedPayload, "string", `${strEventName} native payload type`);
			vecEmittedPayloads.push(strSerializedPayload);

			for (const Callback of [...vecCallbacks]) {
				Callback(strEventName, strSerializedPayload);
			}
		},

		RemoveListener(Callback) {
			return RemoveCallback(vecCallbacks, Callback);
		},

		AddListener(Callback) {
			if (typeof Callback !== "function") {
				throw new TypeError("Native event callback must be a function.");
			}

			vecCallbacks.push(Callback);

			return true;
		},
	};
}

function RequireMockHookAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress < 0n) || (unAddress > g_unMaximumMockHookAddress)) {
		throw new TypeError("The controlled hooks fixture requires a uint64 BigInt address.");
	}
}

function CreateHook(Options) {
	const unAddress = Options.Address;
	RequireMockHookAddress(unAddress);

	if (unAddress > (g_unMaximumMockHookAddress - g_unMockTrampolineOffset)) {
		throw new RangeError("The controlled hooks fixture trampoline exceeds the uint64 address range.");
	}

	const unTrampolineAddress = unAddress + g_unMockTrampolineOffset;
	const unHookID = g_unNextHookID;
	g_unNextHookID += 1;
	const HookRecord = {
		ID: unHookID,
		Address: unAddress,
		TrampolineAddress: unTrampolineAddress,
		Options,
		PostCallbacks: [],
		PreCallbacks: [],
	};

	g_mapHookRecords.set(unHookID, HookRecord);

	return {
		ID: unHookID,
		Address: HookRecord.Address,
		TrampolineAddress: HookRecord.TrampolineAddress,

		Post(Callback) {
			HookRecord.PostCallbacks.push(Callback);

			return true;
		},

		Pre(Callback) {
			HookRecord.PreCallbacks.push(Callback);

			return true;
		},

		Remove() {
			return g_mapHookRecords.delete(unHookID);
		},

		RemovePost(Callback) {
			return RemoveCallback(HookRecord.PostCallbacks, Callback);
		},

		RemovePre(Callback) {
			return RemoveCallback(HookRecord.PreCallbacks, Callback);
		},
	};
}

const g_NativeHooks = {
	HookType: Object.freeze({ Post: 1, Pre: 0 }),
	POST: 1,
	PRE: 0,

	CallFunction(Options) {
		RequireMockHookAddress(Options.Address);
		g_vecNativeCallLog.push(["CallFunction", Options]);

		return 77;
	},

	CreateFunctionHook(Options) {
		g_vecNativeCallLog.push(["CreateFunctionHook", Options]);

		return CreateHook(Options);
	},

	CreateVTableHook(Options) {
		g_vecNativeCallLog.push(["CreateVTableHook", Options]);

		return CreateHook(Options);
	},

	GetHooksDisabled() {
		return g_bHooksDisabled;
	},

	GetHookList() {
		return [...g_mapHookRecords.values()].map((HookRecord) => ({ ID: HookRecord.ID, Address: HookRecord.Address, TrampolineAddress: HookRecord.TrampolineAddress }));
	},

	AddPostHook(Options, Callback) {
		return CreateHook(Options).Post(Callback);
	},

	AddPreHook(Options, Callback) {
		return CreateHook(Options).Pre(Callback);
	},

	RemoveHook(unHookID) {
		return g_mapHookRecords.delete(unHookID);
	},

	RemoveAllHooks() {
		g_mapHookRecords.clear();

		return true;
	},

	SetHooksDisabled(bDisabled) {
		g_bHooksDisabled = bDisabled;

		return g_bHooksDisabled;
	},
};

const g_NativeExceptions = CreateEventRuntime("Exception", g_vecEmittedExceptions);
const g_NativeWarnings = CreateEventRuntime("Warning", g_vecEmittedWarnings);

const g_NativeLoggers = {
	LogError(strMessage) {
		g_vecLoggerCallLog.push(["error", strMessage]);
	},

	LogWarning(strMessage) {
		g_vecLoggerCallLog.push(["warning", strMessage]);
	},
};

function ExtractDocumentationExamples(Hooks) {
	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, g_ExpectedDocumentationExampleCounts.Hooks, "The memory/hooks executable example count changed.");
	g_Assert.equal(strDocumentation.includes("console."), false, "memory/hooks examples must verify results instead of printing them.");

	const strExports = strDocumentation.match(/^## Exports\r?\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
	const vecDocumentedNames = [...strExports.matchAll(/^\| \[?`(\w+)`(?:\]\(#[\w-]+\))? \|/gm)].map(([, strName]) => strName);
	g_Assert.deepEqual(vecDocumentedNames.sort(), Object.keys(Hooks).sort(), "The memory/hooks export table must match the public facade.");
	const strBindingsPath = g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp");
	const strBindings = g_FileSystem.readFileSync(strBindingsPath, "utf8");
	const vecNativeNames = [...strBindings.matchAll(/SetFunction\(pIsolate, LocalContext, LocalMemoryHooksModule, "(\w+)"/g)].map(([, strName]) => strName);
	g_Assert.notEqual(vecNativeNames.length, 0, "Could not locate native memory/hooks exports.");
	for (const strName of vecNativeNames) {
		g_Assert.ok(vecDocumentedNames.includes(strName), `Missing native memory/hooks export from the documentation: ${strName}`);
	}

	for (const strName of ["AddPreHook", "AddPostHook"]) {
		const strSection = new RegExp(`^### \`${strName}\`\\r?\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m").exec(strDocumentation)?.[1] ?? "";
		g_Assert.ok(strSection.includes(`${strName}(HookDefinition, Callback)`) && strSection.includes("```js"), `${strName} must have its own reference and executable example.`);
	}

	for (const strForbiddenText of [
		"Generated by",
		"_ZN16CCoreDispSurface4InitEv",
		"entity: 1",
		"pointer: pointer",
	]) {
		g_Assert.equal(strDocumentation.includes(strForbiddenText), false, `Forbidden memory/hooks example text remains: ${strForbiddenText}`);
	}

	g_Assert.doesNotMatch(strDocumentation, /const\s+\w*[Hh]ook\s*=\s*(?:(?:AddPostHook|AddPreHook)|\w+\.(?:Post|Pre))\(/, "AddPostHook(), AddPreHook(), Hook.Post() and Hook.Pre() return booleans, not hook handles.");

	return vecExamples;
}

function ExtractBaseDocumentationExamples() {
	const strDocumentation = g_FileSystem.readFileSync(g_strBaseDocumentationPath, "utf8");
	g_Assert.equal(strDocumentation.includes("Generated by"), false, "memory/hooks documentation must be maintained by hand.");
	g_Assert.equal(strDocumentation.includes("console."), false, "memory/hooks examples must verify results instead of printing them.");

	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, g_ExpectedDocumentationExampleCounts.Callbacks, "memory/hooks must have nine executable examples.");

	return vecExamples;
}

function ExtractExceptionsDocumentationExamples() {
	const strDocumentation = g_FileSystem.readFileSync(g_strExceptionsDocumentationPath, "utf8");
	g_Assert.equal(strDocumentation.includes("Generated by"), false, "memory/hooks/exceptions documentation must be maintained by hand.");
	g_Assert.equal(strDocumentation.includes("console."), false, "memory/hooks/exceptions examples must verify results instead of printing them.");

	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, g_ExpectedDocumentationExampleCounts.Exceptions, "memory/hooks/exceptions must have eight executable examples.");

	return vecExamples;
}

function ExtractWarningsDocumentationExamples() {
	const strDocumentation = g_FileSystem.readFileSync(g_strWarningsDocumentationPath, "utf8");
	g_Assert.equal(strDocumentation.includes("Generated by"), false, "memory/hooks/warnings documentation must be maintained by hand.");
	g_Assert.equal(strDocumentation.includes("console."), false, "memory/hooks/warnings examples must verify results instead of printing them.");

	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, g_ExpectedDocumentationExampleCounts.Warnings, "memory/hooks/warnings must have nine executable examples.");

	return vecExamples;
}

function LoadWithRuntimeModule(strModulePath) {
	// Process-level module handlers must not absorb failures in the test runner.
	const mapOriginalProcessListeners = new Map();
	for (const strEventName of ["uncaughtException", "unhandledRejection", "warning"]) {
		const mapListenerCounts = new Map();
		for (const Listener of process.rawListeners(strEventName)) {
			mapListenerCounts.set(Listener, (mapListenerCounts.get(Listener) ?? 0) + 1);
		}

		mapOriginalProcessListeners.set(strEventName, mapListenerCounts);
	}

	const OriginalModuleLoad = g_Module._load;
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "memory/hooks/index") {
			return require(g_strBasePath);
		}

		if (strRequestName === "memory/hooks/exceptions") {
			return require(g_strExceptionsPath);
		}

		if (strRequestName === "memory/hooks/warnings") {
			return require(g_strWarningsPath);
		}

		return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	try {
		return require(strModulePath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		// Tested modules append handlers; preserve caller duplicates and exact once wrappers.
		for (const [strEventName, mapOriginalListenerCounts] of mapOriginalProcessListeners) {
			const mapRemainingListenerCounts = new Map(mapOriginalListenerCounts);
			const vecAddedListeners = [];
			for (const Listener of process.rawListeners(strEventName)) {
				const unRemainingCount = mapRemainingListenerCounts.get(Listener) ?? 0;
				if (unRemainingCount > 0) {
					mapRemainingListenerCounts.set(Listener, unRemainingCount - 1);
				} else {
					vecAddedListeners.push(Listener);
				}
			}

			// Remove newer once wrappers before duplicate callbacks can match them.
			for (const Listener of vecAddedListeners.reverse()) {
				process.removeListener(strEventName, Listener);
			}
		}
	}
}

function CreateDocumentationRuntime() {
	const unAddressSize = 8;
	const unMaximumAddress = 0xFFFFFFFFFFFFFFFFn;
	const nMinimumAddressOffset = -(1n << 63n);
	const nMaximumAddressOffset = (1n << 63n) - 1n;
	const unMaximumInt32 = 0x7FFFFFFF;
	const unCreateInterfaceAddress = 0x1400n;
	const vecInterfaceRecords = Object.freeze([Object.freeze({ Name: "ServerGameDLL005", Address: 0x5000n })]);
	const mapAllocations = new Map();
	const mapHookIDsByAddress = new Map();
	const mapHookRecords = new Map();
	const mapAddressValues = new Map();
	let bCallbacksDisabled = false;
	let unNextAllocationAddress = 0x2000n;
	let unNextHookID = 1;

	function RequireAddress(unAddress, strOperationName) {
		if ((typeof unAddress !== "bigint") || (unAddress < 0n) || (unAddress > unMaximumAddress)) {
			throw new TypeError(`${strOperationName} requires a uint64 BigInt address.`);
		}
	}

	function Allocate(unSize) {
		if (!Number.isSafeInteger(unSize) || (unSize <= 0)) {
			throw new TypeError("Allocate(unSize) requires a positive safe integer.");
		}

		const unAddress = unNextAllocationAddress;
		const unAllocationStep = BigInt(Math.max(unSize, unAddressSize));
		if ((unAddress > unMaximumAddress) || ((unAllocationStep - 1n) > (unMaximumAddress - unAddress))) {
			throw new RangeError("Allocate(unSize) exceeds the uint64 address range.");
		}

		unNextAllocationAddress += unAllocationStep;
		mapAllocations.set(unAddress, unSize);

		return unAddress;
	}

	function AddAddress(unAddress, nAddressOffset) {
		RequireAddress(unAddress, "AddAddress(unAddress, nAddressOffset)");

		if ((typeof nAddressOffset !== "bigint") || (nAddressOffset < nMinimumAddressOffset) || (nAddressOffset > nMaximumAddressOffset)) {
			throw new TypeError("AddAddress(unAddress, nAddressOffset) requires an int64 BigInt offset.");
		}

		const unResultAddress = unAddress + nAddressOffset;
		RequireAddress(unResultAddress, "AddAddress(unAddress, nAddressOffset) result");

		return unResultAddress;
	}

	function Deallocate(unAddress) {
		RequireAddress(unAddress, "Deallocate(unAddress)");

		const unSize = mapAllocations.get(unAddress);
		if (unSize === undefined) {
			throw new Error(`Unknown allocation address: ${unAddress}`);
		}

		for (const unStoredAddress of mapAddressValues.keys()) {
			if ((unStoredAddress >= unAddress) && (unStoredAddress < (unAddress + BigInt(unSize)))) {
				mapAddressValues.delete(unStoredAddress);
			}
		}

		mapAllocations.delete(unAddress);

		return true;
	}

	function WriteAddress(unAddress, unValue) {
		RequireAddress(unAddress, "WriteAddress(unAddress, unValue)");
		RequireAddress(unValue, "WriteAddress(unAddress, unValue)");

		const bAllocationContainsAddress = [...mapAllocations].some(([unAllocationAddress, unSize]) => {
			return (unAddress >= unAllocationAddress) && (unAddress <= (unAllocationAddress + BigInt(unSize) - BigInt(unAddressSize)));
		});

		if (!bAllocationContainsAddress) {
			throw new Error(`Address write is outside an owned allocation: ${unAddress}`);
		}

		mapAddressValues.set(unAddress, unValue);

		return true;
	}

	function ReadAddress(unAddress) {
		RequireAddress(unAddress, "ReadAddress(unAddress)");

		if (!mapAddressValues.has(unAddress)) {
			throw new Error(`Address slot is not initialized: ${unAddress}`);
		}

		return mapAddressValues.get(unAddress);
	}

	function ResolveHookAddress(Options, bVTable) {
		if (!bVTable) {
			RequireAddress(Options.Address, "CreateFunctionHook(HookDefinition).Address");
			return Options.Address;
		}

		RequireAddress(Options.ObjectAddress, "CreateVTableHook(HookDefinition).ObjectAddress");

		const unVTableAddress = ReadAddress(Options.ObjectAddress);
		let unOffset = 0;
		if (Object.hasOwn(Options, "Index")) {
			if (!Number.isSafeInteger(Options.Index) || (Options.Index < 0) || (Options.Index > unMaximumInt32)) {
				throw new TypeError("CreateVTableHook(HookDefinition).Index must be a non-negative int32 integer.");
			}

			unOffset = Options.Index * unAddressSize;
		} else if (Object.hasOwn(Options, "Offset")) {
			if (!Number.isSafeInteger(Options.Offset) || (Options.Offset < 0) || (Options.Offset > unMaximumInt32)) {
				throw new TypeError("CreateVTableHook(HookDefinition).Offset must be a non-negative int32 integer.");
			}

			unOffset = Options.Offset;
		}

		return ReadAddress(unVTableAddress + BigInt(unOffset));
	}

	function RemoveCallbackFromRecord(vecCallbacks, Callback) {
		const nCallbackIndex = vecCallbacks.indexOf(Callback);
		if (nCallbackIndex === -1) {
			return false;
		}

		vecCallbacks.splice(nCallbackIndex, 1);

		return true;
	}

	function RemoveHookRecord(HookRecord) {
		mapHookIDsByAddress.delete(HookRecord.Address);

		return mapHookRecords.delete(HookRecord.ID);
	}

	function CreateHookHandle(HookRecord, bCreated) {
		return {
			ID: HookRecord.ID,
			Created: bCreated,
			Address: HookRecord.Address,
			TrampolineAddress: HookRecord.TrampolineAddress,

			Post(Callback) {
				if (typeof Callback !== "function") {
					throw new TypeError("Post(Callback) requires a function.");
				}

				HookRecord.PostCallbacks.push(Callback);

				return true;
			},

			Pre(Callback) {
				if (typeof Callback !== "function") {
					throw new TypeError("Pre(Callback) requires a function.");
				}

				HookRecord.PreCallbacks.push(Callback);

				return true;
			},

			Remove() {
				return RemoveHookRecord(HookRecord);
			},

			RemovePost(Callback) {
				return RemoveCallbackFromRecord(HookRecord.PostCallbacks, Callback);
			},

			RemovePre(Callback) {
				return RemoveCallbackFromRecord(HookRecord.PreCallbacks, Callback);
			},
		};
	}

	function GetOrCreateHook(Options, bVTable = false) {
		const unAddress = ResolveHookAddress(Options, bVTable);
		const unExistingHookID = mapHookIDsByAddress.get(unAddress);
		if (unExistingHookID !== undefined) {
			return CreateHookHandle(mapHookRecords.get(unExistingHookID), false);
		}

		if (unAddress > (unMaximumAddress - g_unMockTrampolineOffset)) {
			throw new RangeError("The documentation hooks fixture trampoline exceeds the uint64 address range.");
		}

		const unHookID = unNextHookID;
		unNextHookID += 1;
		const HookRecord = {
			ID: unHookID,
			Options,
			Address: unAddress,
			PostCallbacks: [],
			PreCallbacks: [],
			TrampolineAddress: unAddress + g_unMockTrampolineOffset,
		};

		mapHookIDsByAddress.set(unAddress, HookRecord.ID);
		mapHookRecords.set(HookRecord.ID, HookRecord);

		return CreateHookHandle(HookRecord, true);
	}

	function CallCreateInterface(vecArguments) {
		const InterfaceRecord = vecInterfaceRecords.find((Record) => Record.Name === vecArguments[0]);

		return (InterfaceRecord === undefined) ? 0n : InterfaceRecord.Address;
	}

	function CallFunction(Options) {
		RequireAddress(Options.Address, "CallFunction(HookDefinition).Address");

		if (Options.Address !== unCreateInterfaceAddress) {
			throw new Error(`Unknown executable address: ${Options.Address}`);
		}

		if (!Array.isArray(Options.Arguments)) {
			throw new TypeError("CallFunction(HookDefinition).Arguments must be an array.");
		}

		const vecArguments = [...Options.Arguments];
		const unHookID = mapHookIDsByAddress.get(Options.Address);
		const HookRecord = (unHookID === undefined) ? null : mapHookRecords.get(unHookID);
		const InitialRegisters = {
			RAX: 0n,
			RBX: 0x10n,
			RCX: 0x20n,
			RDX: 0x30n,
			RFLAGS: 0x202n,
			RSP: 0x7000n,
		};
		let OriginalResult = null;
		let PreReturnValue = undefined;
		let bHasPreReturnValue = false;

		function InvokeOriginal(vecArgumentValues, RegistersValue) {
			if (OriginalResult !== null) {
				throw new Error("The Detours trampoline can be called only once.");
			}

			if (!Array.isArray(vecArgumentValues)) {
				throw new TypeError("CallHookTrampoline(TrampolineOptions).Arguments must be an array.");
			}

			if ((RegistersValue === null) || (typeof RegistersValue !== "object") || Array.isArray(RegistersValue)) {
				throw new TypeError("CallHookTrampoline(TrampolineOptions).Registers must be an object.");
			}

			const ReturnValue = CallCreateInterface(vecArgumentValues);
			OriginalResult = { Registers: { ...RegistersValue, RAX: ReturnValue }, ReturnValue };

			return OriginalResult;
		}

		if ((HookRecord !== null) && !bCallbacksDisabled) {
			const PrePayload = {
				Arguments: vecArguments,
				Registers: InitialRegisters,

				CallHookTrampoline(TrampolineOptions) {
					return InvokeOriginal(TrampolineOptions.Arguments, TrampolineOptions.Registers);
				},

				SetHookArgument(nArgumentIndex, Value) {
					if (!Number.isSafeInteger(nArgumentIndex) || (nArgumentIndex < 0) || (nArgumentIndex >= vecArguments.length)) {
						throw new RangeError(`Invalid hook argument index: ${nArgumentIndex}`);
					}

					vecArguments[nArgumentIndex] = Value;

					return Value;
				},
			};

			for (const Callback of [...HookRecord.PreCallbacks]) {
				const CallbackResult = Callback(PrePayload);
				if (CallbackResult !== undefined) {
					PreReturnValue = CallbackResult;
					bHasPreReturnValue = true;
				}
			}
		}

		if (OriginalResult === null) {
			InvokeOriginal(vecArguments, InitialRegisters);
		}

		let ReturnValue = bHasPreReturnValue ? PreReturnValue : OriginalResult.ReturnValue;
		let ReturnRegisters = OriginalResult.Registers;

		if ((HookRecord !== null) && !bCallbacksDisabled) {
			const PostPayload = {
				Arguments: vecArguments,
				Registers: ReturnRegisters,
				ReturnValue,

				SetHookReturnValue(Value) {
					ReturnValue = Value;
					this.ReturnValue = Value;

					return Value;
				},
			};

			for (const Callback of [...HookRecord.PostCallbacks]) {
				Callback(PostPayload);
			}

			ReturnRegisters = PostPayload.Registers;
		}

		if (Options.ReturnContext === true) {
			return { Registers: ReturnRegisters, ReturnValue };
		}

		return ReturnValue;
	}

	const NativeHooksRuntime = {
		HookType: Object.freeze({ Post: 1, Pre: 0 }),
		POST: 1,
		PRE: 0,
		CallFunction,

		CreateFunctionHook(Options) {
			return GetOrCreateHook(Options);
		},

		CreateVTableHook(Options) {
			return GetOrCreateHook(Options, true);
		},

		GetHooksDisabled() {
			return bCallbacksDisabled;
		},

		GetHookList() {
			return [...mapHookRecords.values()].map((HookRecord) => ({ ID: HookRecord.ID, Address: HookRecord.Address, TrampolineAddress: HookRecord.TrampolineAddress }));
		},

		AddPostHook(Options, Callback) {
			return GetOrCreateHook(Options).Post(Callback);
		},

		AddPreHook(Options, Callback) {
			return GetOrCreateHook(Options).Pre(Callback);
		},

		RemoveHook(unHookID) {
			const HookRecord = mapHookRecords.get(unHookID);

			return (HookRecord === undefined) ? false : RemoveHookRecord(HookRecord);
		},

		RemoveAllHooks() {
			for (const HookRecord of [...mapHookRecords.values()]) {
				RemoveHookRecord(HookRecord);
			}

			return true;
		},

		SetHooksDisabled(bHooksDisabled) {
			if (typeof bHooksDisabled !== "boolean") {
				throw new TypeError("SetHooksDisabled(bHooksDisabled) requires a boolean.");
			}

			bCallbacksDisabled = bHooksDisabled;

			return bCallbacksDisabled;
		},
	};

	return {
		Add: AddAddress,
		Allocate,

		GetAllocationCount() {
			return mapAllocations.size;
		},

		Deallocate,

		GetHookCount() {
			return mapHookRecords.size;
		},

		Interfaces: {
			GetInterfaceRecord(strName) {
				const InterfaceRecord = vecInterfaceRecords.find((Record) => Record.Name === strName);

				return (InterfaceRecord === undefined) ? null : { Name: InterfaceRecord.Name, Available: true, Address: InterfaceRecord.Address };
			},

			GetAllInterfaceNames() {
				return vecInterfaceRecords.map((Record) => Record.Name);
			},
		},

		HooksRuntime: NativeHooksRuntime,
		ADDRESS_SIZE: unAddressSize,

		GetBinarySymbol(strModuleName, strSymbolName) {
			if ((strModuleName !== "server") || (strSymbolName !== "CreateInterface")) {
				throw new Error(`Unknown native symbol: ${strModuleName}!${strSymbolName}`);
			}

			return unCreateInterfaceAddress;
		},

		WriteAddress,
	};
}

function VerifyNativeHookDocumentationCleanupFailures(vecExamples, HooksFacade, vecExampleConfigurations = null) {
	const unExampleTimeoutMilliseconds = 1000;
	const unNonThrowingHookBoundaryCaseCount = 3;
	const vecAddressSetupFailureStages = ["ADDRESS_ADD", "WRITE"];
	const vecInvalidWriteModes = ["FALSE", "WRONG"];
	const vecConfigurations = vecExampleConfigurations ?? [
		{ Name: "MemoryHookDecorator", ExampleIndex: 4 },
		{ Name: "PostHook", ExampleIndex: 5 },
		{ Name: "PreHook", ExampleIndex: 6 },
	];
	const vecThrownValues = [
		new Error("Controlled native-hook failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecFailures = [
		{ Mode: "NONE" },
		...vecThrownValues.map(Value => ({ Mode: "THROW", Value })),
	];
	const vecCleanupFailures = [
		...vecFailures,
		...vecInvalidWriteModes.map(strMode => ({ Mode: strMode })),
	];
	const unBaseCasesPerExample = (vecFailures.length * vecCleanupFailures.length * vecCleanupFailures.length) + (vecThrownValues.length * vecCleanupFailures.length) + vecThrownValues.length + unNonThrowingHookBoundaryCaseCount;
	const unStorageCasesPerExample = vecThrownValues.length + 1 + (vecAddressSetupFailureStages.length * vecThrownValues.length * vecCleanupFailures.length) + (vecInvalidWriteModes.length * vecCleanupFailures.length) + (vecFailures.length * vecCleanupFailures.length);
	let unExpectedCaseCount = 0;
	let unCaseCount = 0;
	for (const Configuration of vecConfigurations) {
		const bVTable = Configuration.VTable === true;
		unExpectedCaseCount += unBaseCasesPerExample + (bVTable ? unStorageCasesPerExample : 0);
		const Run = new Function("require", '"use strict";\n' + vecExamples[Configuration.ExampleIndex]);
		const Check = (Primary, CallbackCleanup, HookCleanup, strForeignKind = "NONE", StorageCleanup = { Mode: "NONE" }) => {
			const Runtime = CreateDocumentationRuntime();
			const Native = Runtime.HooksRuntime;
			const Definition = { Address: Runtime.GetBinarySymbol("server", "CreateInterface"), Convention: "cdecl", ReturnType: "address", Arguments: ["string", "address"] };
			let ForeignHook = null;
			const ForeignCallback = () => undefined;

			if (strForeignKind !== "NONE") {
				ForeignHook = Native.CreateFunctionHook({ ...Definition, Address: (strForeignKind === "SAME") ? Definition.Address : (Definition.Address + 0x100n) });
				g_Assert.equal(ForeignHook.Pre(ForeignCallback), true);
			}

			const vecForeignRecords = Native.GetHookList();
			let unCreateCalls = 0;
			let unRegistrationCalls = 0;
			let unCallAttempts = 0;
			let unCallbackRemovalCalls = 0;
			let unHookRemovalCalls = 0;
			let unStorageReleaseCalls = 0;
			const ApplyCleanup = (Failure, Cleanup) => {
				if (Failure.Mode === "THROW") {
					throw Failure.Value;
				}

				if (Failure.Mode === "FALSE") {
					return false;
				}

				const Result = Cleanup();

				return (Failure.Mode === "WRONG") ? undefined : Result;
			};
			const Register = Operation => {
				unRegistrationCalls++;
				const Result = Operation();

				if (Primary.Stage === "REGISTER") {
					// Deliberately model a completed native registration followed by a throw.
					throw Primary.Value;
				}

				return Result;
			};
			const Create = (Options, bCreateVTable) => {
				unCreateCalls++;

				if (Primary.Stage === "CREATE") {
					if (Primary.Mode === "NULL") {
						return null;
					}

					throw Primary.Value;
				}

				const Hook = bCreateVTable ? Native.CreateVTableHook(Options) : Native.CreateFunctionHook(Options);
				const RemoveCallback = (strMethodName, Callback) => {
					unCallbackRemovalCalls++;

					return ApplyCleanup(CallbackCleanup, () => Hook[strMethodName](Callback));
				};

				return {
					...Hook,
					Pre: Callback => Register(() => Hook.Pre(Callback)),
					Post: Callback => Register(() => Hook.Post(Callback)),
					RemovePre: Callback => RemoveCallback("RemovePre", Callback),
					RemovePost: Callback => RemoveCallback("RemovePost", Callback),

					Remove() {
						unHookRemovalCalls++;

						return ApplyCleanup(HookCleanup, () => Hook.Remove());
					},
				};
			};
			const ControlledHooks = {
				...HooksFacade,
				...Native,
				CreateFunctionHook: Options => Create(Options, false),
				CreateVTableHook: Options => Create(Options, true),
				AddPreHook: (Options, Callback) => Register(() => Native.AddPreHook(Options, Callback)),

				CallFunction(Options) {
					unCallAttempts++;

					if (Primary.Mode === "THROW") {
						throw Primary.Value;
					}

					return Native.CallFunction(Options);
				},
			};
			const Require = strName => {
				if (strName === "interfaces") {
					return Runtime.Interfaces;
				}

				if (strName === "memory/manager") {
					return { GetBinarySymbol: Runtime.GetBinarySymbol };
				}

				if (strName === "memory") {
					return {
						Allocate(unSize) {
							if (Primary.Stage === "ALLOCATE") {
								if (Primary.Mode === "NULL") {
									return 0n;
								}

								throw Primary.Value;
							}

							return Runtime.Allocate(unSize);
						},

						Deallocate(unAddress) {
							unStorageReleaseCalls++;

							return ApplyCleanup(StorageCleanup, () => Runtime.Deallocate(unAddress));
						},
					};
				}

				if (strName === "memory/helpers") {
					return {
						ADDRESS_SIZE: Runtime.ADDRESS_SIZE,

						Add(unAddress, nOffset) {
							if (Primary.Stage === "ADDRESS_ADD") {
								throw Primary.Value;
							}

							return Runtime.Add(unAddress, nOffset);
						},

						WriteAddress(unAddress, unValue) {
							if (Primary.Stage === "WRITE") {
								if (Primary.Mode === "FALSE") {
									return false;
								}

								if (Primary.Mode === "WRONG") {
									return 1;
								}

								throw Primary.Value;
							}

							return Runtime.WriteAddress(unAddress, unValue);
						},
					};
				}

				g_Assert.equal(strName, "memory/hooks");

				return ControlledHooks;
			};
			let bThrown = false;
			let CaughtValue = undefined;
			try {
				try {
					const Context = g_VM.createContext({ Run, Require });
					new g_VM.Script("Run(Require);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
				} catch (CaughtError) {
					bThrown = true;
					CaughtValue = CaughtError;
				}

				const bForeignTarget = strForeignKind === "SAME";
				const bSetupFailed = ["ALLOCATE", "ADDRESS_ADD", "WRITE"].includes(Primary.Stage);
				const bCreateAttempted = !bForeignTarget && !bSetupFailed;
				const bCreated = bCreateAttempted && (Primary.Stage !== "CREATE");
				const bRegistered = bCreated && (Primary.Stage !== "REGISTER");
				const bAllocated = bVTable && !bForeignTarget && (Primary.Stage !== "ALLOCATE");
				g_Assert.equal(unCreateCalls, bCreateAttempted ? 1 : 0, Configuration.Name);
				g_Assert.equal(unRegistrationCalls, bCreated ? 1 : 0, Configuration.Name);
				g_Assert.equal(unCallAttempts, bRegistered ? 1 : 0, Configuration.Name);
				g_Assert.equal(unCallbackRemovalCalls, bRegistered ? 1 : 0, Configuration.Name + " callback removal must be attempted once");
				g_Assert.equal(unHookRemovalCalls, bCreated ? 1 : 0, Configuration.Name + " complete-hook removal must be independent");
				g_Assert.equal(unStorageReleaseCalls, bAllocated ? 1 : 0, Configuration.Name + " storage release must be independent");
				const vecExpectedFailures = [
					...(bForeignTarget ? [{ Mode: "FOREIGN" }] : ((Primary.Mode === "NONE") ? [] : [Primary])),
					...((bRegistered && (CallbackCleanup.Mode !== "NONE")) ? [CallbackCleanup] : []),
					...((bCreated && (HookCleanup.Mode !== "NONE")) ? [HookCleanup] : []),
					...((bAllocated && (StorageCleanup.Mode !== "NONE")) ? [StorageCleanup] : []),
				];
				g_Assert.equal(bThrown, vecExpectedFailures.length > 0, Configuration.Name);

				if (vecExpectedFailures.length > 1) {
					g_Assert(CaughtValue instanceof AggregateError, Configuration.Name + " all failures must be preserved");
				}

				const vecActualFailures = (vecExpectedFailures.length > 1) ? CaughtValue.errors : (bThrown ? [CaughtValue] : []);
				g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length, Configuration.Name);
				for (let unFailureIndex = 0; unFailureIndex < vecExpectedFailures.length; unFailureIndex++) {
					const Failure = vecExpectedFailures[unFailureIndex];
					if (Failure.Mode === "THROW") {
						g_Assert.strictEqual(vecActualFailures[unFailureIndex], Failure.Value, Configuration.Name);
					} else {
						g_Assert(vecActualFailures[unFailureIndex] instanceof Error, Configuration.Name);
					}
				}

				const bHookRetained = bCreated && ((HookCleanup.Mode === "THROW") || (HookCleanup.Mode === "FALSE"));
				const bStorageRetained = bAllocated && ((StorageCleanup.Mode === "THROW") || (StorageCleanup.Mode === "FALSE"));
				g_Assert.equal(Runtime.GetHookCount(), vecForeignRecords.length + (bHookRetained ? 1 : 0), Configuration.Name);
				g_Assert.equal(Runtime.GetAllocationCount(), bStorageRetained ? 1 : 0, Configuration.Name);

				if (ForeignHook !== null) {
					g_Assert.deepEqual(Native.GetHookList().filter(Record => Record.ID === ForeignHook.ID), vecForeignRecords);
					g_Assert.equal(ForeignHook.RemovePre(ForeignCallback), true, Configuration.Name + " must preserve foreign callbacks");
				}

				unCaseCount++;
			} finally {
				g_Assert.equal(Native.RemoveAllHooks(), true);
				g_Assert.equal(Runtime.GetHookCount(), 0);
				// Runtime owns isolated byte-map doubles; no OS allocation or foreign memory is released here.
			}
		};

		for (const Primary of vecFailures) {
			for (const CallbackCleanup of vecCleanupFailures) {
				for (const HookCleanup of vecCleanupFailures) {
					Check(Primary, CallbackCleanup, HookCleanup);
				}
			}
		}

		for (const Value of vecThrownValues) {
			for (const HookCleanup of vecCleanupFailures) {
				Check({ Stage: "REGISTER", Mode: "THROW", Value }, { Mode: "NONE" }, HookCleanup);
			}

			Check({ Stage: "CREATE", Mode: "THROW", Value }, { Mode: "NONE" }, { Mode: "NONE" });
		}

		Check({ Stage: "CREATE", Mode: "NULL" }, { Mode: "NONE" }, { Mode: "NONE" });
		Check({ Mode: "NONE" }, { Mode: "NONE" }, { Mode: "NONE" }, "SAME");
		Check({ Mode: "NONE" }, { Mode: "NONE" }, { Mode: "NONE" }, "OTHER");

		if (bVTable) {
			for (const Value of vecThrownValues) {
				Check({ Stage: "ALLOCATE", Mode: "THROW", Value }, { Mode: "NONE" }, { Mode: "NONE" });

				for (const strStage of vecAddressSetupFailureStages) {
					for (const StorageCleanup of vecCleanupFailures) {
						Check({ Stage: strStage, Mode: "THROW", Value }, { Mode: "NONE" }, { Mode: "NONE" }, "NONE", StorageCleanup);
					}
				}
			}

			Check({ Stage: "ALLOCATE", Mode: "NULL" }, { Mode: "NONE" }, { Mode: "NONE" });

			for (const StorageCleanup of vecCleanupFailures) {
				for (const strMode of vecInvalidWriteModes) {
					Check({ Stage: "WRITE", Mode: strMode }, { Mode: "NONE" }, { Mode: "NONE" }, "NONE", StorageCleanup);
				}

				for (const Primary of vecFailures) {
					Check(Primary, { Mode: "NONE" }, { Mode: "NONE" }, "NONE", StorageCleanup);
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, unExpectedCaseCount);

	return unCaseCount;
}

function VerifyLifecycleDocumentationFailures(vecExamples, vecSelectedCases = null) {
	const unExampleTimeoutMilliseconds = 1000;
	const strFacadeSource = g_FileSystem.readFileSync(g_strHooksPath, "utf8");
	const BaseHooks = require(g_strBasePath);
	const vecValues = [
		new Error("Controlled lifecycle failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, 0], "Controlled aggregate value"),
	];
	const vecCleanupFailures = [
		null,
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecStateFailures = [
		null,
		...vecValues.flatMap(Value => [
			{ Mode: "THROW", Value },
			{ Mode: "THROW_AFTER", Value },
		]),
		{ Mode: "WRONG" },
	];
	const vecGetterFailures = [
		null,
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCases = [];
	const AddCase = (strKind, vecFaults = [], Details = {}) => vecCases.push({ Kind: strKind, Faults: vecFaults.filter(Boolean), ...Details });
	const CreateOperationFault = (strOperation, unOccurrence, Failure) => Failure && { Operation: strOperation, Occurrence: unOccurrence, ...Failure };
	for (const strKind of ["REMOVE", "ALL"]) {
		const strOperation = (strKind === "REMOVE") ? "RemoveHook" : "RemoveAllHooks";
		AddCase(strKind);

		for (const Failure of vecStateFailures.slice(1)) {
			AddCase(strKind, [CreateOperationFault(strOperation, 1, Failure)]);
		}

		for (const Value of vecValues) {
			AddCase(strKind, [{ Operation: "CreateFunctionHook", Occurrence: 1, Mode: "THROW", Value }]);
			AddCase(strKind, [{ Operation: "GetHookList", Occurrence: (strKind === "REMOVE") ? 2 : 3, Mode: "THROW", Value }]);
		}

		AddCase(strKind, [{ Operation: "CreateFunctionHook", Occurrence: 1, Mode: "NULL" }]);

		for (const Failure of vecCleanupFailures) {
			if (strKind === "REMOVE") {
				AddCase(strKind, [CreateOperationFault("RemoveHandle", 1, Failure)], { InvalidHookID: true });
			} else {
				for (const Value of vecValues) {
					AddCase(strKind, [{ Operation: "GetHookList", Occurrence: 2, Mode: "THROW", Value }, CreateOperationFault("RemoveHandle", 1, Failure)]);
				}
			}
		}

		AddCase(strKind, [], { Foreign: "SAME" });
		AddCase(strKind, [], { Foreign: "OTHER" });
	}

	AddCase("ALL", [{ Operation: "GetHookList", Occurrence: 2, Mode: "FOREIGN" }]);

	const vecPrimaryFailures = [
		null,
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
	];
	const vecCreateFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "NULL" },
	];
	const vecInvalidCleanupModes = ["FALSE", "WRONG"];

	for (const bInitialDisabled of [false, true]) {
		for (const Primary of vecStateFailures) {
			for (const Restore of vecStateFailures) {
				for (const Verify of vecGetterFailures) {
					AddCase("SET", [
						CreateOperationFault("SetState", 1, Primary),
						CreateOperationFault("SetState", 2, Restore),
						CreateOperationFault("GetState", Primary ? 2 : 3, Verify),
					], { InitialDisabled: bInitialDisabled });
				}
			}
		}

		for (const Failure of vecGetterFailures.slice(1)) {
			AddCase("SET", [CreateOperationFault("GetState", 2, Failure)], { InitialDisabled: bInitialDisabled });
		}

		AddCase("SET", [{ Operation: "GetState", Occurrence: 1, Mode: "WRONG" }], { InitialDisabled: bInitialDisabled });

		for (const Primary of vecPrimaryFailures) {
			for (const CallbackCleanup of vecCleanupFailures) {
				for (const HookCleanup of vecCleanupFailures) {
					AddCase("WITH", [
						CreateOperationFault("CallFunction", 1, Primary),
						CreateOperationFault("RemoveCallback", 1, CallbackCleanup),
						CreateOperationFault("RemoveHandle", 1, HookCleanup),
					], { InitialDisabled: bInitialDisabled });
				}
			}
		}

		for (const unOccurrence of [1, 2, 3, 4]) {
			for (const Failure of vecStateFailures.slice(1)) {
				AddCase("WITH", [CreateOperationFault("SetState", unOccurrence, Failure)], { InitialDisabled: bInitialDisabled });
			}
		}

		for (const unOccurrence of [1, 2, 3, 4, 5]) {
			for (const Failure of vecGetterFailures.slice(1)) {
				AddCase("WITH", [CreateOperationFault("GetState", unOccurrence, Failure)], { InitialDisabled: bInitialDisabled });
			}
		}

		AddCase("WITH", [{ Operation: "GetState", Occurrence: 4, Mode: "NULL" }], { InitialDisabled: bInitialDisabled });

		for (let unValueIndex = 0; unValueIndex < vecValues.length; unValueIndex++) {
			const GetRotatedFailureValue = unOffset => vecValues[(unValueIndex + unOffset) % vecValues.length];
			AddCase("WITH", [
				{ Operation: "CallFunction", Occurrence: 1, Mode: "THROW", Value: GetRotatedFailureValue(0) },
				{ Operation: "SetState", Occurrence: 3, Mode: "THROW", Value: GetRotatedFailureValue(1) },
				{ Operation: "RemoveCallback", Occurrence: 1, Mode: "THROW", Value: GetRotatedFailureValue(2) },
				{ Operation: "RemoveHandle", Occurrence: 1, Mode: "THROW", Value: GetRotatedFailureValue(3) },
				{ Operation: "SetState", Occurrence: 4, Mode: "THROW", Value: GetRotatedFailureValue(4) },
				{ Operation: "GetState", Occurrence: 4, Mode: "THROW", Value: GetRotatedFailureValue(5) },
			], { InitialDisabled: bInitialDisabled });
		}

		for (const Failure of vecCreateFailures) {
			AddCase("WITH", [CreateOperationFault("CreateFunctionHook", 1, Failure)], { InitialDisabled: bInitialDisabled });
		}

		for (const Failure of vecStateFailures.slice(1)) {
			for (const Cleanup of vecCleanupFailures) {
				AddCase("WITH", [CreateOperationFault("Register", 1, Failure), CreateOperationFault("RemoveHandle", 1, Cleanup)], { InitialDisabled: bInitialDisabled });
			}
		}

		AddCase("WITH", [], { Foreign: "SAME", InitialDisabled: bInitialDisabled });
		AddCase("WITH", [], { Foreign: "OTHER", InitialDisabled: bInitialDisabled });
	}

	for (const Primary of vecPrimaryFailures) {
		for (const CallbackCleanup of vecCleanupFailures) {
			for (const HookCleanup of vecCleanupFailures) {
				AddCase("DISPOSE", [
					CreateOperationFault("CallFunction", 1, Primary),
					CreateOperationFault("RemoveCallback", 1, CallbackCleanup),
					CreateOperationFault("RemoveHandle", 1, HookCleanup),
				]);
			}
		}
	}

	for (const Failure of vecStateFailures.slice(1)) {
		for (const Cleanup of vecCleanupFailures) {
			AddCase("DISPOSE", [CreateOperationFault("Register", 1, Failure), CreateOperationFault("RemoveHandle", 1, Cleanup)]);
		}
	}

	for (const Failure of vecCreateFailures) {
		AddCase("DISPOSE", [CreateOperationFault("CreateFunctionHook", 1, Failure)]);
	}

	AddCase("DISPOSE", [], { Foreign: "SAME" });
	AddCase("DISPOSE", [], { Foreign: "OTHER" });

	const vecRegisterFailures = [...vecStateFailures.slice(1), { Mode: "FALSE" }];
	const vecCallFailures = [
		null,
		...vecValues.flatMap(Value => [
			{ Operation: "CallFunction", Occurrence: 1, Mode: "THROW", Value },
			{ Operation: "CallFunction", Occurrence: 2, Mode: "THROW", Value },
		]),
	];
	for (const Primary of vecCallFailures) {
		for (const CallbackCleanup of vecCleanupFailures) {
			for (const HookCleanup of vecCleanupFailures) {
				AddCase("REGISTER", [
					Primary,
					CreateOperationFault("RemoveCallback", (Primary?.Occurrence === 1) ? 1 : 2, CallbackCleanup),
					CreateOperationFault("RemoveHandle", 1, HookCleanup),
				]);
			}
		}
	}

	for (const Failure of vecRegisterFailures) {
		for (const HookCleanup of vecCleanupFailures) {
			AddCase("REGISTER", [CreateOperationFault("Register", 1, Failure), CreateOperationFault("RemoveHandle", 1, HookCleanup)]);

			for (const CallbackCleanup of vecCleanupFailures) {
				AddCase("REGISTER", [
					CreateOperationFault("Register", 2, Failure),
					CreateOperationFault("RemoveCallback", 1, CallbackCleanup),
					CreateOperationFault("RemoveHandle", 1, HookCleanup),
				]);
			}
		}
	}

	for (const PreviousRemoval of vecRegisterFailures) {
		for (const Rollback of vecCleanupFailures) {
			for (const HookCleanup of vecCleanupFailures) {
				AddCase("REGISTER", [
					CreateOperationFault("RemoveCallback", 1, PreviousRemoval),
					CreateOperationFault("RemoveCallback", 2, Rollback),
					CreateOperationFault("RemoveHandle", 1, HookCleanup),
				]);
			}
		}
	}

	for (let unValueIndex = 0; unValueIndex < vecValues.length; unValueIndex++) {
		AddCase("REGISTER", [
			{ Operation: "RemoveCallback", Occurrence: 1, Mode: "THROW", Value: vecValues[unValueIndex] },
			{ Operation: "RemoveCallback", Occurrence: 2, Mode: "THROW", Value: vecValues[(unValueIndex + 1) % vecValues.length] },
			{ Operation: "RemoveCallback", Occurrence: 3, Mode: "THROW", Value: vecValues[(unValueIndex + 2) % vecValues.length] },
			{ Operation: "RemoveHandle", Occurrence: 1, Mode: "THROW", Value: vecValues[(unValueIndex + 3) % vecValues.length] },
		]);
	}

	for (const strPreviousMode of vecInvalidCleanupModes) {
		for (const strRollbackMode of vecInvalidCleanupModes) {
			for (const strCleanupMode of vecInvalidCleanupModes) {
				for (const HookCleanup of vecCleanupFailures) {
					AddCase("REGISTER", [
						{ Operation: "RemoveCallback", Occurrence: 1, Mode: strPreviousMode },
						{ Operation: "RemoveCallback", Occurrence: 2, Mode: strRollbackMode },
						{ Operation: "RemoveCallback", Occurrence: 3, Mode: strCleanupMode },
						CreateOperationFault("RemoveHandle", 1, HookCleanup),
					]);
				}
			}
		}
	}

	for (const Failure of vecCreateFailures) {
		AddCase("REGISTER", [CreateOperationFault("CreateFunctionHook", 1, Failure)]);
	}

	AddCase("REGISTER", [], { Foreign: "SAME" });
	AddCase("REGISTER", [], { Foreign: "OTHER" });

	const vecScenarios = vecSelectedCases ?? vecCases;
	const ExampleIndices = {
		REMOVE: 11,
		ALL: 12,
		SET: 13,
		WITH: 14,
		DISPOSE: 15,
		REGISTER: 16,
	};
	let unCaseCount = 0;
	for (const Scenario of vecScenarios) {
		const Runtime = CreateDocumentationRuntime();
		const Native = Runtime.HooksRuntime;
		const bInitialDisabled = Scenario.InitialDisabled ?? false;
		g_Assert.equal(Native.SetHooksDisabled(bInitialDisabled), bInitialDisabled);
		const Definition = { Address: Runtime.GetBinarySymbol("server", "CreateInterface"), Convention: "cdecl", ReturnType: "address", Arguments: ["string", "address"] };
		const vecFailures = [];
		const vecOperations = [];
		const mapCounts = new Map();
		const setFaultHits = new Set();
		const setInjectedValues = new Set(Scenario.Faults.filter(Fault => Fault.Mode.startsWith("THROW")).map(Fault => Fault.Value));
		const vecForeignHooks = [];
		const ForeignCallback = () => undefined;
		const AddForeign = bSameAddress => {
			const Hook = Native.CreateFunctionHook({ ...Definition, Address: bSameAddress ? Definition.Address : (Definition.Address + 0x100n) });
			g_Assert.equal(Hook.Pre(ForeignCallback), true);
			vecForeignHooks.push(Hook);
		};

		if (Scenario.Foreign) {
			AddForeign(Scenario.Foreign === "SAME");
		}

		let OwnedHook = null;
		let bRegistrationCompleted = false;
		let bLastStateSetApplied = false;
		const Count = strName => mapCounts.get(strName) ?? 0;
		const Invoke = (strOperation, Operation) => {
			const unOccurrence = Count(strOperation) + 1;
			mapCounts.set(strOperation, unOccurrence);
			vecOperations.push(strOperation);
			const nFaultIndex = Scenario.Faults.findIndex(Fault => (Fault.Operation === strOperation) && (Fault.Occurrence === unOccurrence));
			const Fault = (nFaultIndex === -1) ? null : Scenario.Faults[nFaultIndex];
			if (Fault !== null) {
				setFaultHits.add(nFaultIndex);

				if (Fault.Mode === "FOREIGN") {
					AddForeign(false);
				} else if (Fault.Mode === "THROW") {
					vecFailures.push(Fault.Value);
					throw Fault.Value;
				} else if (Fault.Mode === "FALSE") {
					return false;
				} else if (Fault.Mode === "WRONG") {
					return 1;
				} else if (Fault.Mode === "NULL") {
					return null;
				}
			}

			const Result = Operation();

			if (Fault?.Mode === "THROW_AFTER") {
				vecFailures.push(Fault.Value);
				throw Fault.Value;
			}

			return Result;
		};
		const RecordError = ErrorType => function CreateRecordedError(strMessage) {
			const Failure = new ErrorType(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};
		const RecordedError = RecordError(Error);
		const RecordedTypeError = RecordError(TypeError);
		const Controlled = {
			...Native,
			CreateFunctionHook: Options => Invoke("CreateFunctionHook", () => {
				const Hook = Native.CreateFunctionHook(Options);
				OwnedHook = Hook;

				return {
					...Hook,
					ID: Scenario.InvalidHookID ? 0 : Hook.ID,

					Pre(Callback) {
						const Result = Invoke("Register", () => Hook.Pre(Callback));
						bRegistrationCompleted = Result === true;

						return Result;
					},

					RemovePre: Callback => Invoke("RemoveCallback", () => Hook.RemovePre(Callback)),
					RemovePost: Callback => Invoke("RemoveCallback", () => Hook.RemovePost(Callback)),
					Remove: () => Invoke("RemoveHandle", () => Hook.Remove()),
				};
			}),
			CallFunction: Options => Invoke("CallFunction", () => Native.CallFunction(Options)),
			GetHookList: () => Invoke("GetHookList", () => Native.GetHookList()),
			RemoveHook: unHookID => Invoke("RemoveHook", () => Native.RemoveHook(unHookID)),
			RemoveAllHooks: () => Invoke("RemoveAllHooks", () => Native.RemoveAllHooks()),
			GetHooksDisabled: () => Invoke("GetState", () => Native.GetHooksDisabled()),

			SetHooksDisabled(bDisabled) {
				bLastStateSetApplied = false;

				return Invoke("SetState", () => {
					const bResult = Native.SetHooksDisabled(bDisabled);
					bLastStateSetApplied = true;

					return bResult;
				});
			},
		};
		const FacadeModule = { exports: {} };
		const FacadeRequire = strName => {
			if (strName === "internal/runtime") {
				return {
					GetRawModule: strModuleName => {
						g_Assert.equal(strModuleName, "memory/hooks");

						return Controlled;
					},
				};
			}

			g_Assert.equal(strName, "memory/hooks/index");

			return BaseHooks;
		};
		new Function("require", "module", "Error", "TypeError", strFacadeSource)(FacadeRequire, FacadeModule, RecordedError, RecordedTypeError);
		const Require = strName => {
			if (strName === "interfaces") {
				return Runtime.Interfaces;
			}

			if (strName === "memory/manager") {
				return { GetBinarySymbol: Runtime.GetBinarySymbol };
			}

			g_Assert.equal(strName, "memory/hooks");

			return FacadeModule.exports;
		};
		const Run = new Function("require", "Error", "TypeError", '"use strict";\n' + vecExamples[ExampleIndices[Scenario.Kind]]);
		let bThrown = false;
		let CaughtValue = undefined;
		try {
			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError, RecordedTypeError });
				new g_VM.Script("Run(Require, RecordedError, RecordedTypeError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			const FlattenRecordedFailures = Value => {
				if (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) {
					return Value.errors.flatMap(FlattenRecordedFailures);
				}

				return [Value];
			};
			const vecActualFailures = bThrown ? FlattenRecordedFailures(CaughtValue) : [];
			g_Assert.equal(vecActualFailures.length, vecFailures.length, Scenario.Kind + " must preserve every failure");
			for (let unFailureIndex = 0; unFailureIndex < vecFailures.length; unFailureIndex++) {
				g_Assert.strictEqual(vecActualFailures[unFailureIndex], vecFailures[unFailureIndex], Scenario.Kind + " must preserve failure identity and causal order");
			}

			const bForeignGuard = (Scenario.Foreign === "SAME") || ((Scenario.Kind === "ALL") && Boolean(Scenario.Foreign));
			const bExpectedFailure = (Scenario.Faults.length > 0) || bForeignGuard || Boolean(Scenario.InvalidHookID);
			g_Assert.equal(bThrown, bExpectedFailure, Scenario.Kind);
			g_Assert.equal(setFaultHits.size, Scenario.Faults.length, Scenario.Kind + " every planned fault must be exercised");

			if ((Scenario.Kind === "WITH") || (Scenario.Kind === "DISPOSE")) {
				g_Assert.equal(Count("RemoveCallback"), bRegistrationCompleted ? 1 : 0, Scenario.Kind + " must not retry callback removal");
				g_Assert.equal(Count("RemoveHandle"), (OwnedHook === null) ? 0 : 1, Scenario.Kind + " hook cleanup must remain independent");
			}

			if (Scenario.Kind === "REGISTER") {
				const RegistrationFault = Scenario.Faults.find(Fault => Fault.Operation === "Register");
				const PreviousRemovalFault = Scenario.Faults.find(Fault => (Fault.Operation === "RemoveCallback") && (Fault.Occurrence === 1));
				let unExpectedCallbackRemovals = 0;
				if (Count("Register") > 0) {
					if (RegistrationFault?.Occurrence === 1) {
						unExpectedCallbackRemovals = 0;
					} else if ((Count("Register") === 1) || (RegistrationFault?.Occurrence === 2)) {
						unExpectedCallbackRemovals = 1;
					} else {
						unExpectedCallbackRemovals = PreviousRemovalFault ? 3 : 2;
					}
				}

				g_Assert.equal(Count("RemoveCallback"), unExpectedCallbackRemovals, "REGISTER replacement/rollback/owned-disposal attempts must remain distinct");
				g_Assert.equal(Count("RemoveHandle"), (OwnedHook === null) ? 0 : 1, "REGISTER hook cleanup must remain independent");
			}

			if (((Scenario.Kind === "REMOVE") || (Scenario.Kind === "ALL")) && (OwnedHook !== null)) {
				const strExplicitOperation = (Scenario.Kind === "REMOVE") ? "RemoveHook" : "RemoveAllHooks";
				if (Count(strExplicitOperation) === 0) {
					g_Assert.equal(Count("RemoveHandle"), 1, Scenario.Kind + " pre-removal failure must release only its owned handle");
				}

				if (Scenario.Faults.some(Fault => (Fault.Operation === strExplicitOperation) && (Fault.Occurrence === 1))) {
					g_Assert.equal(Count("RemoveHandle"), 0, Scenario.Kind + " must not retry a failed explicit removal");
				}
			}

			if (OwnedHook !== null) {
				const ReleaseFault = Scenario.Faults.find(Fault => ["RemoveHandle", "RemoveHook", "RemoveAllHooks"].includes(Fault.Operation) && (Fault.Occurrence === 1));
				const bExpectedRetained = Boolean(ReleaseFault) && ["THROW", "FALSE", "WRONG"].includes(ReleaseFault.Mode);
				g_Assert.equal(Native.GetHookList().some(Record => Record.ID === OwnedHook.ID), bExpectedRetained, Scenario.Kind);
			}

			for (const Hook of vecForeignHooks) {
				g_Assert.equal(Native.GetHookList().some(Record => Record.ID === Hook.ID), true, Scenario.Kind + " must retain foreign records");
				g_Assert.equal(Hook.RemovePre(ForeignCallback), true, Scenario.Kind + " must retain foreign callbacks");
			}

			if ((Scenario.Kind === "SET") || (Scenario.Kind === "WITH")) {
				if (Count("SetState") > 0) {
					g_Assert.deepEqual(vecOperations.slice(-2), ["SetState", "GetState"], Scenario.Kind + " state restoration and verification must run after resource cleanup");
				}

				if ((Count("SetState") === 0) || bLastStateSetApplied) {
					g_Assert.equal(Native.GetHooksDisabled(), bInitialDisabled, Scenario.Kind + " successful restoration must recover the initial state");
				}
			}

			unCaseCount++;
		} finally {
			g_Assert.equal(Native.RemoveAllHooks(), true);
			g_Assert.equal(Runtime.GetHookCount(), 0);
		}
	}

	g_Assert.equal(unCaseCount, vecScenarios.length);

	return unCaseCount;
}

function VerifyTrampolineDocumentationFailures(vecExamples) {
	const unExampleTimeoutMilliseconds = 1000;

	for (const strCallbackName of ["CallOriginal", "CallReplacement"]) {
		const strExample = vecExamples.find((strSource) => strSource.includes(`function ${strCallbackName}(Payload)`));
		g_Assert.equal(typeof strExample, "string", `Missing ${strCallbackName} documentation example.`);

		const vecCallbackMatch = strExample.match(new RegExp(`function ${strCallbackName}\\(Payload\\) \\{[\\s\\S]*?\\n\\}`));
		g_Assert.notEqual(vecCallbackMatch, null, `Missing complete ${strCallbackName} callback.`);

		const Context = g_VM.createContext({
			g_TrampolineContext: null,
			g_strInterfaceName: "ServerGameDLL999",
			g_strCustomRegisterName: "EBX",
			g_unCustomRegisterValue: 0x1234n,
		});
		const strInvocation = [
			`${strCallbackName}({`,
			"\tArguments: [],",
			"\tRegisters: {},",
			"\tCallHookTrampoline() {",
			"\t\treturn undefined;",
			"\t},",
			"});",
		].join("\n");
		const Script = new g_VM.Script(`"use strict";\n${vecCallbackMatch[0]}\n${strInvocation}`, { filename: `memory-hooks-${strCallbackName}-trampoline-failure.js` });
		const FailureType = g_VM.runInContext("Error", Context);
		g_Assert.throws(() => Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds }), (Failure) => (Failure instanceof FailureType) && (Failure.constructor === FailureType) && (Failure.message === "CallHookTrampoline did not return an execution context."), `${strCallbackName} must reject a failed trampoline result before dereferencing it.`);
	}
}

function ExecuteDocumentationExample(strExampleSource, unExampleIndex) {
	const unExampleTimeoutMilliseconds = 1000;

	const DocumentationRuntime = CreateDocumentationRuntime();
	const strHooksCacheKey = require.resolve(g_strHooksPath);
	const PreviousHooksCacheEntry = require.cache[strHooksCacheKey];
	const PreviousSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");

	try {
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "memory/hooks": DocumentationRuntime.HooksRuntime } });
		delete require.cache[strHooksCacheKey];
		const DocumentationHooks = LoadWithRuntimeModule(g_strHooksPath);
		const Context = g_VM.createContext({
			console: {
				log() {
					throw new Error("memory/hooks documentation examples must verify results instead of printing them");
				},
			},

			require(strModuleName) {
				switch (strModuleName) {
					case "interfaces":
						return DocumentationRuntime.Interfaces;

					case "memory":
						return { Allocate: DocumentationRuntime.Allocate, Deallocate: DocumentationRuntime.Deallocate };

					case "memory/helpers":
						return { ADDRESS_SIZE: DocumentationRuntime.ADDRESS_SIZE, Add: DocumentationRuntime.Add, WriteAddress: DocumentationRuntime.WriteAddress };

					case "memory/hooks":
						return DocumentationHooks;

					case "memory/manager":
						return { GetBinarySymbol: DocumentationRuntime.GetBinarySymbol };

					default:
						throw new Error(`Unexpected documentation module: ${strModuleName}`);
				}
			},
		});
		const Script = new g_VM.Script(`"use strict";\n${strExampleSource}`, { filename: `memory-hooks-example-${unExampleIndex + 1}.js` });

		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });

		g_Assert.equal(DocumentationRuntime.GetHookCount(), 0, `Documentation example ${unExampleIndex + 1} leaked a hook.`);
		g_Assert.equal(DocumentationRuntime.GetAllocationCount(), 0, `Documentation example ${unExampleIndex + 1} leaked memory.`);
		++g_ExecutedDocumentationExampleCounts.Hooks;
	} finally {
		delete require.cache[strHooksCacheKey];

		if (PreviousHooksCacheEntry !== undefined) {
			require.cache[strHooksCacheKey] = PreviousHooksCacheEntry;
		}

		if (PreviousSourceJSDescriptor === undefined) {
			delete globalThis.sourcejs;
		} else {
			Object.defineProperty(globalThis, "sourcejs", PreviousSourceJSDescriptor);
		}
	}
}

function ExecuteBaseDocumentationExample(strExampleSource, unExampleIndex) {
	const unExampleTimeoutMilliseconds = 1000;

	const Context = g_VM.createContext({
		console: {
			log() {
				throw new Error("memory/hooks documentation examples must verify results instead of printing them");
			},
		},

		require(strModuleName) {
			if (strModuleName !== "memory/hooks") {
				throw new Error(`Unexpected base-hook documentation module: ${strModuleName}`);
			}

			return require(g_strBasePath);
		},
	});
	const Script = new g_VM.Script(strExampleSource, { filename: `memory-hooks-base-example-${unExampleIndex + 1}.js` });

	Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	++g_ExecutedDocumentationExampleCounts.Callbacks;
}

function VerifyBaseDocumentationCleanupFailures(vecExamples, vecExampleConfigurations = null) {
	const unExampleTimeoutMilliseconds = 1000;
	const unSparseArrayLength = 3;
	const { HookBase, HookDecorator } = require(g_strBasePath);
	const vecConfigurations = vecExampleConfigurations ?? [
		{ Name: "Import", ExampleIndex: 0, Operation: "Call", Cleanup: "Dispose" },
		{ Name: "HookBase", ExampleIndex: 1, Operation: "Append", Cleanup: "Clear" },
		{ Name: "HookDecorator", ExampleIndex: 2, Operation: "Call", Cleanup: "Dispose" },
		{ Name: "HookBase.Append", ExampleIndex: 3, Operation: "Append", Cleanup: "Remove" },
		{ Name: "HookDecorator.Call", ExampleIndex: 7, Operation: "Call", Cleanup: "Dispose" },
	];
	const vecFailureValues = [
		new Error("Controlled callback failure"),
		null,
		undefined,
		0,
		false,
	];
	const vecFailures = [
		{ Mode: "NONE" },
		...vecFailureValues.map(Value => ({ Mode: "THROW", Value })),
	];
	const vecCleanupFailures = [...vecFailures, { Mode: "WRONG" }];
	const ForeignCallback = () => undefined;
	const vecForeignCallbacks = new HookBase();
	vecForeignCallbacks.Append(ForeignCallback);
	let unCaseCount = 0;
	try {
		const vecStoredValues = new HookBase();
		try {
			vecStoredValues.push("ExternalValue");
			g_Assert.equal(vecStoredValues.Remove("ExternalValue"), "ExternalValue");
			vecStoredValues.push(ForeignCallback, ForeignCallback);
			g_Assert.strictEqual(vecStoredValues.Remove(ForeignCallback), ForeignCallback);
			g_Assert.equal(vecStoredValues.length, 1);
			g_Assert.strictEqual(vecStoredValues[0], ForeignCallback);
			vecStoredValues.Clear();
			vecStoredValues.push(NaN);
			g_Assert.throws(() => vecStoredValues.Remove(NaN), /not registered/);
			vecStoredValues.length = unSparseArrayLength;
			g_Assert.equal(vecStoredValues.length, unSparseArrayLength);
			g_Assert.equal(vecStoredValues.Clear(), undefined);
			g_Assert.equal(vecStoredValues.length, 0);
		} finally {
			// Direct original cleanup is outside the controlled failure layer.
			HookBase.prototype.Clear.call(vecStoredValues);
		}

		for (const Configuration of vecConfigurations) {
			const Run = new Function("require", '"use strict";\n' + vecExamples[Configuration.ExampleIndex]);
			for (const Primary of vecFailures) {
				for (const Cleanup of vecCleanupFailures) {
					const vecOwners = [];
					let bOperationReached = false;
					let unCleanupCalls = 0;
					const FinishCleanup = (Result) => {
						unCleanupCalls++;
						if (Cleanup.Mode === "THROW") {
							throw Cleanup.Value;
						}

						return (Cleanup.Mode === "WRONG") ? null : Result;
					};

					class ControlledHookBase extends HookBase {
						constructor(...vecArguments) {
							super(...vecArguments);

							// Array species construction supplies a length, not a new example owner.
							if (vecArguments.length === 0) {
								vecOwners.push(this);
							}
						}

						Append(Callback) {
							const CallbackResult = super.Append(Callback);
							if (Configuration.Operation === "Append") {
								bOperationReached = true;
								if (Primary.Mode === "THROW") {
									throw Primary.Value;
								}
							}

							return CallbackResult;
						}

						Remove(Callback) {
							const CallbackResult = super.Remove(Callback);

							return (Configuration.Cleanup === "Remove") ? FinishCleanup(CallbackResult) : CallbackResult;
						}

						Clear() {
							const ClearResult = super.Clear();

							return (Configuration.Cleanup === "Clear") ? FinishCleanup(ClearResult) : ClearResult;
						}
					}

					class ControlledHookDecorator extends HookDecorator {
						Call(...vecArguments) {
							const Result = super.Call(...vecArguments);
							bOperationReached = true;
							if (Primary.Mode === "THROW") {
								throw Primary.Value;
							}

							return Result;
						}

						Dispose() {
							const CallbackResult = super.Dispose();

							return (Configuration.Cleanup === "Dispose") ? FinishCleanup(CallbackResult) : CallbackResult;
						}
					}

					const Require = (strName) => {
						g_Assert.equal(strName, "memory/hooks");

						return { HookBase: ControlledHookBase, HookDecorator: ControlledHookDecorator };
					};
					let bThrown = false;
					let CaughtValue = undefined;
					try {
						try {
							const Context = g_VM.createContext({ Run, Require });
							new g_VM.Script("Run(Require);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
						} catch (CaughtError) {
							bThrown = true;
							CaughtValue = CaughtError;
						}

						g_Assert.equal(bOperationReached, true, Configuration.Name);
						g_Assert.equal(unCleanupCalls, 1, Configuration.Name + " cleanup must run exactly once");
						g_Assert.equal(vecOwners.length, 1, Configuration.Name);
						g_Assert.equal(vecOwners[0].length, 0, Configuration.Name + " cleanup must remove its registrations");
						const vecExpectedFailures = [
							...((Primary.Mode === "NONE") ? [] : [Primary]),
							...((Cleanup.Mode === "NONE") ? [] : [Cleanup]),
						];
						g_Assert.equal(bThrown, vecExpectedFailures.length > 0, Configuration.Name);
						if (vecExpectedFailures.length > 1) {
							g_Assert(CaughtValue instanceof AggregateError, Configuration.Name + " cleanup must preserve operation and cleanup failures");
						}

						const vecActualFailures = (vecExpectedFailures.length > 1) ? CaughtValue.errors : (bThrown ? [CaughtValue] : []);
						g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length, Configuration.Name);
						for (let unFailureIndex = 0; unFailureIndex < vecExpectedFailures.length; unFailureIndex++) {
							const Failure = vecExpectedFailures[unFailureIndex];
							if (Failure.Mode === "THROW") {
								g_Assert.strictEqual(vecActualFailures[unFailureIndex], Failure.Value, Configuration.Name);
							} else {
								g_Assert(vecActualFailures[unFailureIndex] instanceof Error, Configuration.Name);
							}
						}

						g_Assert.equal(vecForeignCallbacks.length, 1);
						g_Assert.strictEqual(vecForeignCallbacks[0], ForeignCallback);
						unCaseCount++;
					} finally {
						for (const vecOwner of vecOwners) {
							HookBase.prototype.Clear.call(vecOwner);
						}
					}
				}
			}
		}

		g_Assert.equal(unCaseCount, vecConfigurations.length * (vecFailures.length * vecCleanupFailures.length));
	} finally {
		HookBase.prototype.Clear.call(vecForeignCallbacks);
	}
}

function VerifyExceptionDocumentationCleanupFailures(vecExamples) {
	const unExampleTimeoutMilliseconds = 1000;
	const unExpectedCaseCount = 770;
	const vecSpecifications = [
		{
			Index: 1,
			Stages: [
				"",
				"Append",
				"Report",
			],
			CleanupError: "The exception collection did not restore its callback state.",
		},
		{
			Index: 2,
			Stages: [
				"",
				"Construct",
				"Append",
				"Call",
				"Report",
			],
			CleanupError: "ExceptionHook did not release its callback.",
		},
		{
			Index: 3,
			Stages: [
				"",
				"Append",
				"Report",
			],
			CleanupError: "The independent exception collection did not clear its observer.",
		},
		{
			Index: 4,
			Stages: [
				"",
				"On",
				"Emit",
			],
			CleanupError: "The native exception channel did not remove its callback.",
		},
		{
			Index: 5,
			Stages: [
				"",
				"On",
				"Off1",
				"Off2",
			],
			CleanupError: "The native exception callback could not be cleaned up after the Off() check.",
		},
		{
			Index: 6,
			Stages: [
				"",
				"On",
				"Emit",
				"Off1",
			],
			CleanupError: "The native exception callback could not be removed during cleanup.",
		},
	];
	const vecPrimaryValues = [
		new Error("exception example primary failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupValues = [
		new Error("exception example cleanup failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupModes = [
		{ Kind: "NONE" },
		{ Kind: "STATUS" },
		...vecCleanupValues.map(Value => ({ Kind: "THROW", Value })),
	];
	let unCaseCount = 0;
	for (const Specification of vecSpecifications) {
		for (const strFailureStage of Specification.Stages) {
			for (const PrimaryValue of vecPrimaryValues) {
				for (const CleanupMode of vecCleanupModes) {
					const vecExpectedErrors = [];
					const setNativeCallbacks = new Set();
					const vecCollections = [];
					let bPrimaryThrown = false;
					let unCleanupCount = 0;
					let unOffCount = 0;
					const Step = strStage => {
						if (!bPrimaryThrown && (strFailureStage === strStage)) {
							bPrimaryThrown = true;
							vecExpectedErrors.push({ Value: PrimaryValue });
							throw PrimaryValue;
						}
					};
					const Cleanup = (Action, bStatusDetected = true) => {
						++unCleanupCount;

						if (CleanupMode.Kind === "THROW") {
							vecExpectedErrors.push({ Value: CleanupMode.Value });
							throw CleanupMode.Value;
						}

						if (CleanupMode.Kind === "STATUS") {
							if (bStatusDetected) {
								vecExpectedErrors.push({ Message: Specification.CleanupError });
							}

							return undefined;
						}

						return Action();
					};

					class ExceptionHooks {
						constructor() {
							this.Callbacks = [];
							vecCollections.push(this);
						}

						get length() {
							return this.Callbacks.length;
						}

						get ClassName() {
							return "ExceptionHooks";
						}

						Append(Callback) {
							Step("Append");
							this.Callbacks.push(Callback);

							return Callback;
						}

						Remove(Callback) {
							return Cleanup(() => {
								g_Assert.equal(this.Callbacks.length, 1);
								g_Assert.equal(this.Callbacks[0], Callback);
								this.Callbacks.length = 0;

								return Callback;
							});
						}

						Clear() {
							return Cleanup(() => {
								this.Callbacks.length = 0;
							}, this.Callbacks.length > 0);
						}

						PrintException(Value, Extra = {}) {
							Step("Report");
							const Exception = { Name: Value.name, Message: Value.message, Stack: Value.stack, Error: Value, ...Extra };
							for (const Callback of this.Callbacks) {
								Callback(Exception);
							}

							return Exception;
						}
					}

					const EXCEPTION_HOOKS = new ExceptionHooks();

					class ExceptionHook {
						constructor(Callback) {
							Step("Construct");
							this.Callback = Callback;
							this.ClassInstance = EXCEPTION_HOOKS;
							this.ClassInstance.Append(Callback);
						}

						Call(Payload) {
							Step("Call");

							return this.Callback(Payload);
						}

						Dispose() {
							return this.ClassInstance.Remove(this.Callback);
						}
					}

					const Exceptions = {
						EXCEPTION_HOOKS,
						ExceptionHook,
						ExceptionHooks,

						On(Callback) {
							Step("On");
							setNativeCallbacks.add(Callback);

							return Callback;
						},

						Off(Callback) {
							++unOffCount;
							if ((Specification.Index === 4) || bPrimaryThrown) {
								return Cleanup(() => setNativeCallbacks.delete(Callback));
							}

							Step("Off" + unOffCount);

							return setNativeCallbacks.delete(Callback);
						},

						Emit(Payload) {
							Step("Emit");
							for (const Callback of setNativeCallbacks) {
								Callback(JSON.parse(JSON.stringify(Payload)));
							}
						},
					};
					const Context = g_VM.createContext({
						Error,
						RangeError,
						TypeError,

						require(strModuleName) {
							g_Assert.equal(strModuleName, "memory/hooks/exceptions");

							return Exceptions;
						},
					});
					let bCaught = false;
					let CaughtValue = undefined;
					try {
						new g_VM.Script(vecExamples[Specification.Index], { filename: `exception-cleanup-${unCaseCount}.js` }).runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
					} catch (CaughtError) {
						bCaught = true;
						CaughtValue = CaughtError;
					}

					g_Assert.equal(bPrimaryThrown, strFailureStage !== "", "exception cleanup fixture reached its requested primary stage");
					g_Assert.ok(unCleanupCount <= 1, "exception example retries neither removal nor disposal");
					g_Assert.equal(bCaught, vecExpectedErrors.length > 0, "exception example failure state");
					const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
					if (vecExpectedErrors.length > 1) {
						g_Assert.ok(Array.isArray(vecActualErrors), "exception examples preserve primary and cleanup failures");
						g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length);
					}

					for (const [unFailureIndex, Expected] of vecExpectedErrors.entries()) {
						if (Object.hasOwn(Expected, "Value")) {
							g_Assert.ok(Object.is(vecActualErrors[unFailureIndex], Expected.Value), "exception examples preserve thrown value identity and order");

						} else {
							g_Assert.equal(vecActualErrors[unFailureIndex].message, Expected.Message);
						}
					}

					if (CleanupMode.Kind === "NONE") {
						g_Assert.equal(setNativeCallbacks.size, 0);
						g_Assert.ok(vecCollections.every(Collection => Collection.length === 0));
					}

					++unCaseCount;
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, unExpectedCaseCount, "six exception example cleanup matrices with thrown primitives");
}

function VerifyExceptionReportingDocumentationFailures(strExampleSource) {
	const unExampleTimeoutMilliseconds = 1000;
	const vecPrimaryValues = [
		new Error("reporting primary failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupValues = [
		new Error("reporting cleanup failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupModes = [
		{ Kind: "NONE" },
		{ Kind: "STATUS" },
		...vecCleanupValues.map(Value => ({ Kind: "THROW", Value })),
	];
	const vecFailureStages = [
		"",
		"Append",
		"On",
		"Normalize",
		"Emit",
		"Log",
	];
	let unCaseCount = 0;
	for (const strFailureStage of vecFailureStages) {
		for (const PrimaryValue of vecPrimaryValues) {
			for (const NativeCleanupMode of vecCleanupModes) {
				for (const LocalCleanupMode of vecCleanupModes) {
					const vecExpectedErrors = [];
					const vecCleanupNames = [];
					const vecLocalCallbacks = [];
					const setNativeCallbacks = new Set();
					let bPrimaryThrown = false;
					const Step = strStage => {
						if (strFailureStage === strStage) {
							bPrimaryThrown = true;
							vecExpectedErrors.push({ Value: PrimaryValue });
							throw PrimaryValue;
						}
					};
					const Cleanup = (strName, Mode, strFailureMessage, Action) => {
						vecCleanupNames.push(strName);

						if (Mode.Kind === "THROW") {
							vecExpectedErrors.push({ Value: Mode.Value });
							throw Mode.Value;
						}

						if (Mode.Kind === "STATUS") {
							vecExpectedErrors.push({ Message: strFailureMessage });
							return undefined;
						}

						return Action();
					};
					const Exceptions = {
						EXCEPTION_HOOKS: {
							get length() {
								return vecLocalCallbacks.length;
							},

							Append(Callback) {
								Step("Append");
								vecLocalCallbacks.push(Callback);

								return Callback;
							},

							Remove(Callback) {
								return Cleanup("Local", LocalCleanupMode, "The local exception collection did not restore its state.", () => {
									g_Assert.equal(vecLocalCallbacks.length, 1);
									g_Assert.equal(vecLocalCallbacks[0], Callback);
									vecLocalCallbacks.length = 0;

									return Callback;
								});
							},

							PrintException(Value, Extra, bCallbacks) {
								g_Assert.equal(bCallbacks, false);
								Step("Normalize");

								const Exception = { Name: Value.name, Message: Value.message, Stack: Value.stack, Error: Value, ...Extra };
								Step("Emit");

								for (const Callback of setNativeCallbacks) {
									Callback(JSON.parse(JSON.stringify(Exception)));
								}

								Step("Log");

								return Exception;
							},
						},

						On(Callback) {
							Step("On");
							setNativeCallbacks.add(Callback);

							return Callback;
						},

						Off(Callback) {
							return Cleanup("Native", NativeCleanupMode, "The native exception channel did not remove its observer.", () => setNativeCallbacks.delete(Callback));
						},
					};
					const Context = g_VM.createContext({
						Error,

						require(strModuleName) {
							g_Assert.equal(strModuleName, "memory/hooks/exceptions");

							return Exceptions;
						},
					});
					let bCaught = false;
					let CaughtValue = undefined;
					try {
						new g_VM.Script(strExampleSource, { filename: `exception-reporting-cleanup-${unCaseCount}.js` }).runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
					} catch (CaughtError) {
						bCaught = true;
						CaughtValue = CaughtError;
					}

					let vecExpectedCleanupNames = ["Native", "Local"];
					if (strFailureStage === "Append") {
						vecExpectedCleanupNames = [];

					} else if (strFailureStage === "On") {
						vecExpectedCleanupNames = ["Local"];
					}

					g_Assert.equal(bPrimaryThrown, strFailureStage !== "", "reporting fixture reached its requested primary stage");
					g_Assert.deepEqual(vecCleanupNames, vecExpectedCleanupNames, "reporting example cleans every owned observer once, in reverse order");
					g_Assert.equal(bCaught, vecExpectedErrors.length > 0, "reporting example failure state");
					const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
					if (vecExpectedErrors.length > 1) {
						g_Assert.ok(Array.isArray(vecActualErrors), "reporting example preserves primary and both cleanup failures");
						g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length);
					}

					for (const [unFailureIndex, Expected] of vecExpectedErrors.entries()) {
						if (Object.hasOwn(Expected, "Value")) {
							g_Assert.ok(Object.is(vecActualErrors[unFailureIndex], Expected.Value), "reporting example preserves thrown value identity and order");

						} else {
							g_Assert.equal(vecActualErrors[unFailureIndex].message, Expected.Message);
						}
					}

					if ((NativeCleanupMode.Kind === "NONE") && (LocalCleanupMode.Kind === "NONE")) {
						g_Assert.equal(vecLocalCallbacks.length, 0);
						g_Assert.equal(setNativeCallbacks.size, 0);
					}

					++unCaseCount;
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, 1470, "two-observer reporting failure matrix");
}

function VerifyExceptionJSONFailureContracts(Exceptions) {
	const unEmissionCountBefore = g_vecEmittedExceptions.length;
	const unLogCountBefore = g_vecLoggerCallLog.length;
	const CircularValue = {};
	CircularValue.Self = CircularValue;

	let unLocalCallbackCount = 0;
	const Observe = () => {
		unLocalCallbackCount += 1;
	};
	const RegisteredObserver = Exceptions.EXCEPTION_HOOKS.Append(Observe);

	try {
		g_Assert.ok(RegisteredObserver === Observe, "Exception observers must preserve callback identity.");

		for (const Value of [1n, CircularValue]) {
			g_Assert.throws(() => Exceptions.EXCEPTION_HOOKS.PrintException(Value), TypeError);
		}

		g_Assert.throws(() => Exceptions.EXCEPTION_HOOKS.PrintException(new Error("JSON conversion failure"), { Address: 1n }), TypeError);
		g_Assert.throws(() => Exceptions.Emit({ toJSON: () => undefined }), TypeError);
		g_Assert.equal(unLocalCallbackCount, 0, "serialization failure precedes local callbacks");
		g_Assert.equal(g_vecEmittedExceptions.length, unEmissionCountBefore, "serialization failure precedes native emission");
		g_Assert.equal(g_vecLoggerCallLog.length, unLogCountBefore, "serialization failure precedes logging");

		const Record = Exceptions.EXCEPTION_HOOKS.PrintException(1n, { Error: undefined });
		g_Assert.equal(Record.Message, "1");
		g_Assert.equal(Record.Error, undefined, "Extra.Error replaces the local original too");
		g_Assert.equal(unLocalCallbackCount, 1);
		g_Assert.equal(g_vecEmittedExceptions.length, unEmissionCountBefore + 1);
		g_Assert.equal(g_vecLoggerCallLog.length, unLogCountBefore + 1);
		g_Assert.equal(Object.hasOwn(JSON.parse(g_vecEmittedExceptions.at(-1)), "Error"), false);
	} finally {
		g_Assert.equal(Exceptions.EXCEPTION_HOOKS.Remove(Observe), Observe);
	}
}

function ExecuteExceptionsDocumentationExample(strExampleSource, unExampleIndex, Exceptions) {
	const unExecutionTimeoutMilliseconds = 1000;

	const Context = g_VM.createContext({
		Error,
		RangeError,
		TypeError,
		console: {
			log() {
				throw new Error("memory/hooks/exceptions documentation examples must verify results instead of printing them");
			},
		},

		require(strModuleName) {
			if (strModuleName !== "memory/hooks/exceptions") {
				throw new Error(`Unexpected exception-hook documentation module: ${strModuleName}`);
			}

			return Exceptions;
		},
	});

	const Script = new g_VM.Script(`"use strict";\n${strExampleSource}`, { filename: `memory-hooks-exceptions-example-${unExampleIndex + 1}.js` });

	g_Assert.equal(Exceptions.EXCEPTION_HOOKS.length, 0, "Exception documentation example began with a local callback leak.");
	g_Assert.equal(g_NativeExceptions.CallbackCount, 0, "Exception documentation example began with a native callback leak.");

	Script.runInContext(Context, { timeout: unExecutionTimeoutMilliseconds });

	g_Assert.equal(Exceptions.EXCEPTION_HOOKS.length, 0, `Exception-hook documentation example ${unExampleIndex + 1} leaked a local callback.`);
	g_Assert.equal(g_NativeExceptions.CallbackCount, 0, `Exception-hook documentation example ${unExampleIndex + 1} leaked a native callback.`);
	++g_ExecutedDocumentationExampleCounts.Exceptions;
}

function VerifyWarningDocumentationCleanupFailures(vecExamples) {
	const unExecutionTimeoutMilliseconds = 1000;
	const unExpectedCaseCount = 1370;

	const vecSpecifications = [
		{
			Index: 1,
			Stages: [
				"",
				"Construct",
				"Append",
				"Normalize",
				"Emit1",
				"Local",
				"Log",
			],
			RemovalError: "The local warning observer did not release its callback.",
			StateError: "The singleton warning callback collection did not return to its starting size.",
		},
		{
			Index: 2,
			Stages: [
				"",
				"Construct",
				"Append",
				"Call",
				"Normalize",
				"Emit1",
				"Local",
				"Log",
			],
			RemovalError: "WarningHook did not return its callback during disposal.",
			StateError: "The singleton warning callback collection did not return to its starting size.",
		},
		{
			Index: 3,
			Stages: [
				"",
				"Construct",
				"Append",
				"Normalize",
				"Emit1",
				"Local",
				"Log",
			],
			RemovalError: "The isolated warning collection did not release its observer.",
			StateError: "The isolated warning collection retained a callback.",
		},
		{
			Index: 4,
			Stages: [
				"",
				"On",
				"Emit1",
			],
			RemovalError: "The native warning observer was not removed.",
		},
		{
			Index: 5,
			Stages: [
				"",
				"On",
				"Emit1",
				"Off",
				"Emit2",
			],
			RemovalError: "The fallback native warning cleanup failed.",
		},
		{
			Index: 6,
			Stages: [
				"",
				"On",
				"Emit1",
			],
			RemovalError: "The native warning callback token was not removed.",
		},
		{
			Index: 8,
			Stages: [
				"",
				"Construct",
				"Append",
				"Normalize",
				"Emit1",
				"Local",
				"Log",
			],
			RemovalError: "The direct singleton observer did not release its callback.",
			StateError: "The direct warning collection did not return to its starting size.",
		},
	];
	const vecPrimaryValues = [
		new Error("warning example primary failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupModes = [
		{ Kind: "NONE" },
		{ Kind: "STATUS" },
		...[
			new Error("warning example cleanup failure"),
			undefined,
			null,
			0,
			"",
		].map(Value => ({ Kind: "THROW", Value })),
	];
	let unCaseCount = 0;
	for (const Specification of vecSpecifications) {
		for (const strFailureStage of Specification.Stages) {
			for (const PrimaryValue of vecPrimaryValues) {
				for (const CleanupMode of vecCleanupModes) {
					if ((Specification.Index === 5) && (strFailureStage === "Emit2") && (CleanupMode.Kind !== "NONE")) {
						continue;
					}

					const vecExpectedErrors = [];
					const vecCollections = [];
					const setNativeCallbacks = new Set();
					let bPrimaryThrown = false;
					let bDecoratorConstructed = false;
					let bNativeRegistered = false;
					let unDisposals = 0;
					let unOffCalls = 0;
					let unEmissions = 0;
					const Step = strStage => {
						if (strFailureStage === strStage) {
							bPrimaryThrown = true;
							vecExpectedErrors.push({ Value: PrimaryValue });
							throw PrimaryValue;
						}
					};
					const Emit = Payload => {
						++unEmissions;
						Step("Emit" + unEmissions);

						for (const Callback of setNativeCallbacks) {
							Callback(JSON.parse(JSON.stringify(Payload)));
						}
					};

					class WarningHooks {
						constructor() {
							this.Callbacks = [];
							vecCollections.push(this);
						}

						Append(Callback) {
							Step("Append");
							this.Callbacks.push(Callback);

							return Callback;
						}

						Remove(Callback) {
							++unDisposals;

							if (CleanupMode.Kind === "THROW") {
								vecExpectedErrors.push({ Value: CleanupMode.Value });
								throw CleanupMode.Value;
							}

							if (CleanupMode.Kind === "STATUS") {
								vecExpectedErrors.push({ Message: Specification.RemovalError });
								return undefined;
							}

							g_Assert.equal(this.Callbacks.length, 1);
							g_Assert.equal(this.Callbacks[0], Callback);
							this.Callbacks.length = 0;

							return Callback;
						}

						PrintWarning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {}) {
							Step("Normalize");

							const Record = { ...Extra, Message: strMessage, Category: strCategory, Filename: strFilename, LineNumber: unLineNumber };
							Emit(Record);
							Step("Local");

							for (const Callback of this.Callbacks) {
								Callback(Record);
							}

							Step("Log");

							return Record;
						}

						get length() {
							return this.Callbacks.length;
						}

						get ClassName() {
							return "WarningHooks";
						}
					}

					const WARNING_HOOKS = new WarningHooks();

					class WarningHook {
						constructor(Callback, ClassInstance = WARNING_HOOKS) {
							Step("Construct");
							this.Callback = Callback;
							this.ClassInstance = ClassInstance;
							this.ClassInstance.Append(Callback);
							bDecoratorConstructed = true;
						}

						Call(Record) {
							Step("Call");

							return this.Callback(Record);
						}

						Dispose() {
							return this.ClassInstance.Remove(this.Callback);
						}
					}

					const Warnings = {
						WARNING_HOOKS,
						WarningHook,
						WarningHooks,
						Emit,
						Warning: (...vecArguments) => WARNING_HOOKS.PrintWarning(...vecArguments),

						On(Callback) {
							Step("On");
							setNativeCallbacks.add(Callback);
							bNativeRegistered = true;

							return Callback;
						},

						Off(Callback) {
							++unOffCalls;

							if (!setNativeCallbacks.has(Callback)) {
								return false;
							}

							Step("Off");

							if (CleanupMode.Kind === "THROW") {
								vecExpectedErrors.push({ Value: CleanupMode.Value });
								throw CleanupMode.Value;
							}

							if (CleanupMode.Kind === "STATUS") {
								const strMessage = ((Specification.Index === 5) && !bPrimaryThrown) ? "Off() did not suppress delivery to the removed callback." : Specification.RemovalError;
								vecExpectedErrors.push({ Message: strMessage });
								return false;
							}

							return setNativeCallbacks.delete(Callback);
						},
					};

					const Context = g_VM.createContext({
						Error,

						require(strModuleName) {
							g_Assert.equal(strModuleName, "memory/hooks/warnings");

							return Warnings;
						},
					});
					let bCaught = false;
					let CaughtValue = undefined;
					try {
						new g_VM.Script(vecExamples[Specification.Index], { filename: `warning-cleanup-${unCaseCount}.js` }).runInContext(Context, { timeout: unExecutionTimeoutMilliseconds });
					} catch (CaughtError) {
						bCaught = true;
						CaughtValue = CaughtError;
					}

					if (bDecoratorConstructed && vecCollections.some(Collection => Collection.length !== 0)) {
						vecExpectedErrors.push({ Message: Specification.StateError });
					}

					g_Assert.equal(bPrimaryThrown, strFailureStage !== "", "warning fixture reaches the requested primary stage");
					g_Assert.equal(unDisposals, bDecoratorConstructed ? 1 : 0, "warning examples dispose each constructed decorator once");
					g_Assert.equal(unOffCalls, bNativeRegistered ? ((vecExpectedErrors.length === 0) ? 2 : 1) : 0, "warning examples do not retry failed native removal");
					g_Assert.equal(bCaught, vecExpectedErrors.length > 0, "warning example failure state");
					const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
					if (vecExpectedErrors.length > 1) {
						g_Assert.ok(Array.isArray(vecActualErrors), "warning examples preserve primary and cleanup failures");
						g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length);
					}

					for (const [unFailureIndex, Expected] of vecExpectedErrors.entries()) {
						if (Object.hasOwn(Expected, "Value")) {
							g_Assert.ok(Object.is(vecActualErrors[unFailureIndex], Expected.Value), "warning examples preserve thrown identity and failure order");

						} else {
							g_Assert.equal(vecActualErrors[unFailureIndex].message, Expected.Message);
						}
					}

					if (CleanupMode.Kind === "NONE") {
						const bExpectedNativeRetention = (Specification.Index === 5) && bNativeRegistered && (strFailureStage === "Off");
						g_Assert.equal(setNativeCallbacks.size, bExpectedNativeRetention ? 1 : 0, "a failed explicit removal remains owned until an owner-controlled retry");
						g_Assert.ok(vecCollections.every(Collection => Collection.length === 0));
					}

					++unCaseCount;
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, unExpectedCaseCount, "seven warning example failure matrices with thrown primitives");
}

function VerifyWarningFailureContracts(WarningsRuntime, Exceptions) {
	const Warnings = new WarningsRuntime.WarningHooks();
	const unEmissionCountBefore = g_vecEmittedWarnings.length;
	const unLogCountBefore = g_vecLoggerCallLog.length;
	const CircularValue = {};
	CircularValue.Self = CircularValue;

	let unLocalCallbackCount = 0;
	const Observe = () => {
		unLocalCallbackCount += 1;
	};

	try {
		Warnings.Append(Observe);

		for (const Extra of [{ Address: 1n }, { Context: CircularValue }]) {
			g_Assert.throws(() => Warnings.PrintWarning("JSON failure", "Warning", "", 0, Extra), TypeError);
		}

		g_Assert.throws(() => WarningsRuntime.Emit({ toJSON: () => undefined }), TypeError);
		g_Assert.equal(unLocalCallbackCount, 0, "warning serialization failure precedes local dispatch");
		g_Assert.equal(g_vecEmittedWarnings.length, unEmissionCountBefore, "warning serialization failure precedes native emission");
		g_Assert.equal(g_vecLoggerCallLog.length, unLogCountBefore, "warning serialization failure precedes logging");

		const Record = Warnings.PrintWarning("Canonical", "CanonicalWarning", "Origin.js", 7, { Message: "Ignored", Category: "Ignored", Filename: "Ignored.js", LineNumber: -1 });
		g_Assert.equal(Record.Message, "Canonical");
		g_Assert.equal(Record.Category, "CanonicalWarning");
		g_Assert.equal(Record.Filename, "Origin.js");
		g_Assert.equal(Record.LineNumber, 7);
		g_Assert.equal(unLocalCallbackCount, 1);
		g_Assert.equal(g_vecEmittedWarnings.length, unEmissionCountBefore + 1);
		g_Assert.equal(g_vecLoggerCallLog.length, unLogCountBefore + 1);
		g_Assert.equal(JSON.parse(g_vecEmittedWarnings.at(-1)).Message, "Canonical");
	} finally {
		Warnings.Clear();
	}

	const ReportError = new Error("Exception reporting failed.");
	const PreviousDescriptor = Object.getOwnPropertyDescriptor(Exceptions.EXCEPTION_HOOKS, "PrintException");
	const unEmissionCountBeforeObserverFailure = g_vecEmittedWarnings.length;
	const unLogCountBeforeObserverFailure = g_vecLoggerCallLog.length;
	let unLaterCallbackCount = 0;

	try {
		Warnings.Append(() => {
			throw new Error("Local warning callback failed.");
		});
		Warnings.Append(() => {
			unLaterCallbackCount += 1;
		});

		Exceptions.EXCEPTION_HOOKS.PrintException = () => {
			throw ReportError;
		};
		g_Assert.throws(() => Warnings.PrintWarning("Observer failure"), (ErrorValue) => {
			g_Assert.equal(ErrorValue, ReportError);

			return true;
		});
		g_Assert.equal(unLaterCallbackCount, 0, "failed exception reporting stops later local observers");
		g_Assert.equal(g_vecEmittedWarnings.length, unEmissionCountBeforeObserverFailure + 1, "native emission is not rolled back");
		g_Assert.equal(g_vecLoggerCallLog.length, unLogCountBeforeObserverFailure, "failed exception reporting prevents the final warning log");
	} finally {
		if (PreviousDescriptor === undefined) {
			delete Exceptions.EXCEPTION_HOOKS.PrintException;

		} else {
			Object.defineProperty(Exceptions.EXCEPTION_HOOKS, "PrintException", PreviousDescriptor);
		}

		Warnings.Clear();
	}
}

function ExecuteWarningsDocumentationExample(strExampleSource, unExampleIndex, WarningsRuntime) {
	const unExecutionTimeoutMilliseconds = 1000;

	const Context = g_VM.createContext({
		require(strModuleName) {
			if (strModuleName !== "memory/hooks/warnings") {
				throw new Error(`Unexpected warning-hook documentation module: ${strModuleName}`);
			}

			return WarningsRuntime;
		},
	});

	const Script = new g_VM.Script("\"use strict\";\n" + strExampleSource, { filename: `memory-hooks-warnings-example-${unExampleIndex + 1}.js` });

	g_Assert.equal(WarningsRuntime.WARNING_HOOKS.length, 0, "Warning documentation example began with a local callback leak.");
	g_Assert.equal(g_NativeWarnings.CallbackCount, 0, "Warning documentation example began with a native callback leak.");

	Script.runInContext(Context, { timeout: unExecutionTimeoutMilliseconds });

	g_Assert.equal(WarningsRuntime.WARNING_HOOKS.length, 0, `Warning-hook documentation example ${unExampleIndex + 1} leaked a local callback.`);
	g_Assert.equal(g_NativeWarnings.CallbackCount, 0, `Warning-hook documentation example ${unExampleIndex + 1} leaked a native callback.`);
	++g_ExecutedDocumentationExampleCounts.Warnings;
}

const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_OriginalModuleLoad = g_Module._load;
const g_vecCachePaths = [
	g_strHooksPath,
	g_strBasePath,
	g_strExceptionsPath,
	g_strWarningsPath,
	g_strRuntimePath,
];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strPath) => [strPath, require.cache[strPath]]));

function VerifyABICallPluginExample() {
	const unExecutionTimeoutMilliseconds = 1000;
	const unExpectedCaseCount = 46;
	const strExamplePath = g_Path.resolve(__dirname, "..", "examples", "plugins", "disabled", "abi-call", "index.js");
	const strExampleSource = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const CreateFixture = (strSource, unAddressByteCount, bRegister = true) => {
		const Fixture = {
			Calls: [],
			Information: [],
			Warnings: [],
			Unregistrations: [],
			Handler: null,
			Exports: {},
		};
		const Modules = {
			memory: {
				Convention: { Fastcall: "fastcall" },
				DataType: { Int: "int", String: "string" },
				Register: { RCX: "RCX", ECX: "ECX", RDX: "RDX", EDX: "EDX" },
			},
			"memory/helpers": { ADDRESS_SIZE: unAddressByteCount },
			"memory/hooks": {
				CallFunction(Request) {
					Fixture.Calls.push(Request);

					return { ReturnValue: 7, Registers: { RDX: 0n, EDX: 0n } };
				},
			},
			loggers: {
				LogInfo: strMessage => Fixture.Information.push(strMessage),
				LogWarning: strMessage => Fixture.Warnings.push(strMessage),
			},
			source: {
				RegisterCommand(strName, Callback) {
					g_Assert.equal(strName, "abi_call_example");
					Fixture.Handler = Callback;

					return bRegister;
				},

				UnregisterCommand(strName, Callback) {
					g_Assert.equal(strName, "abi_call_example");
					g_Assert.strictEqual(Callback, Fixture.Handler);
					Fixture.Unregistrations.push(strName);

					return true;
				},
			},
		};
		const RequireExample = strName => {
			g_Assert(Object.hasOwn(Modules, strName), "Unexpected ABI example dependency: " + strName);

			return Modules[strName];
		};

		new g_VM.Script(strSource, { filename: strExamplePath }).runInNewContext({ require: RequireExample, exports: Fixture.Exports }, { timeout: unExecutionTimeoutMilliseconds });
		g_Assert.equal(typeof Fixture.Handler, "function");
		g_Assert.equal(typeof Fixture.Exports.Unload, "function");

		return Fixture;
	};

	const CheckScenario = (strSource, unAddressByteCount, vecArguments, strDiagnostic) => {
		const Fixture = CreateFixture(strSource, unAddressByteCount);
		Fixture.Handler({ Arguments: ["abi_call_example", ...vecArguments] });

		const bExpectedCall = strDiagnostic === "CALL";
		g_Assert.equal(Fixture.Calls.length, bExpectedCall ? 1 : 0, "ABI example must reject the complete argument list before native execution");
		g_Assert.equal(Fixture.Information.some(strMessage => strMessage.startsWith("Usage:")), strDiagnostic === "USAGE");
		g_Assert.equal(Fixture.Warnings.length, (strDiagnostic === "WARNING") ? 1 : 0);

		if (bExpectedCall) {
			const Request = Fixture.Calls[0];
			const strThisRegisterName = (unAddressByteCount === 8) ? "RCX" : "ECX";
			g_Assert.equal(Request.Address, BigInt(vecArguments[0]));
			g_Assert.equal(Request.ThisObject, BigInt(vecArguments[1]));
			g_Assert.equal(Request.Registers[strThisRegisterName], Request.ThisObject);
			g_Assert.equal(Request.Convention, "fastcall");
			g_Assert.equal(Request.ReturnType, "int");
			g_Assert.equal(Request.ReturnContext, true);
			g_Assert.equal(Request.Arguments.length, 2);
			g_Assert.equal(Request.Arguments[0].Type, "int");
			g_Assert.equal(Request.Arguments[0].Value, 123);
			g_Assert.equal(Request.Arguments[1].Type, "string");
			g_Assert.equal(Request.Arguments[1].Value, "Use");
		}

		Fixture.Exports.Unload();
		Fixture.Exports.Unload();
		g_Assert.equal(Fixture.Unregistrations.length, 1, "ABI example cleanup is idempotent");
	};

	const vecUsageArgumentCases = [
		[],
		["1"],
		["1", "2"],
		["1", "2", "confirm", "extra"],
		["1", "2", "confirm", "extra", "more"],
		["1", "2", "CONFIRM"],
		["1", "2", "no"],
	];
	let unCases = 0;
	for (const unAddressByteCount of [4, 8]) {
		for (const vecArguments of vecUsageArgumentCases) {
			CheckScenario(strExampleSource, unAddressByteCount, vecArguments, "USAGE");
			++unCases;
		}

		const unMaximumAddress = (1n << BigInt(unAddressByteCount * 8)) - 1n;
		for (const strInvalidAddress of ["", "-1", "0", "1.5", "invalid", String(unMaximumAddress + 1n)]) {
			CheckScenario(strExampleSource, unAddressByteCount, [strInvalidAddress, "2", "confirm"], "WARNING");
			CheckScenario(strExampleSource, unAddressByteCount, ["1", strInvalidAddress, "confirm"], "WARNING");
			unCases += 2;
		}

		for (const vecArguments of [["1", "2", "confirm"], ["0x" + unMaximumAddress.toString(16), String(unMaximumAddress), "confirm"]]) {
			CheckScenario(strExampleSource, unAddressByteCount, vecArguments, "CALL");
			++unCases;
		}

		g_Assert.throws(() => CreateFixture(strExampleSource, unAddressByteCount, false), /Could not register abi_call_example/);
		++unCases;

		const strStrictArity = "vecCommandArguments.length !== 3";
		g_Assert.equal(strExampleSource.split(strStrictArity).length, 2, "Unique strict ABI command arity guard");
		const strLegacyAritySource = strExampleSource.replace(strStrictArity, "vecCommandArguments.length < 3");
		g_Assert.throws(() => CheckScenario(strLegacyAritySource, unAddressByteCount, ["1", "2", "confirm", "extra"], "USAGE"), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("ABI example must reject the complete argument list before native execution"), "Legacy extra-argument regression must fail for native dispatch, not an unrelated error");
		++unCases;
	}

	g_Assert.equal(unCases, unExpectedCaseCount);

	console.log("[smoke] ABI-call plugin command passed: " + unCases + " x86/x64 argument/BigInt/cleanup checks including two legacy-arity regressions; native calls are controlled doubles.");
}

try {
	for (const strPath of g_vecCachePaths) {
		delete require.cache[strPath];
	}

	// Tested process-level handlers must not turn an unhandled assertion into a passing smoke run.
	process.on("uncaughtExceptionMonitor", MarkUnhandledFailure);

	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			loggers: g_NativeLoggers,
			"memory/hooks": g_NativeHooks,
			"memory/hooks/exceptions": g_NativeExceptions,
			"memory/hooks/warnings": g_NativeWarnings,
		},
	});

	const g_Hooks = LoadWithRuntimeModule(g_strHooksPath);
	const { HookBase, HookDecorator } = LoadWithRuntimeModule(g_strBasePath);
	const g_Exceptions = LoadWithRuntimeModule(g_strExceptionsPath);
	const g_Warnings = LoadWithRuntimeModule(g_strWarningsPath);

	for (const strObsoletePath of [
		g_Path.join(g_strPackageRootPath, "hooks.js"),
		g_Path.join(g_strPackageRootPath, "hooks", "base.js"),
		g_Path.join(g_strPackageRootPath, "hooks", "exceptions.js"),
		g_Path.join(g_strPackageRootPath, "hooks", "warnings.js"),
	]) {
		g_Assert.equal(g_FileSystem.existsSync(strObsoletePath), false, `Obsolete hook module remains: ${strObsoletePath}`);
	}

	g_Assert.equal(g_Hooks.HookType.Pre, 0);
	g_Assert.equal(g_Hooks.HookType.Post, 1);
	g_Assert.strictEqual(g_Hooks.CallFunction, g_NativeHooks.CallFunction);
	g_Assert.strictEqual(g_Hooks.CreateFunctionHook, g_NativeHooks.CreateFunctionHook);

	const g_vecCallbacks = new HookBase();
	let g_unCallbackCount = 0;
	const g_TestCallback = () => {
		g_unCallbackCount += 1;
	};

	g_Assert.strictEqual(g_vecCallbacks.Append(g_TestCallback), g_TestCallback);
	g_Assert.throws(() => g_vecCallbacks.Append(g_TestCallback), /already registered/);
	g_Assert.strictEqual(g_vecCallbacks.Remove(g_TestCallback), g_TestCallback);
	g_Assert.throws(() => g_vecCallbacks.Remove(g_TestCallback), /not registered/);
	g_vecCallbacks.Append(g_TestCallback);
	g_vecCallbacks.Clear();
	g_Assert.equal(g_vecCallbacks.length, 0);

	class SmokeHook extends HookDecorator {
	}

	SmokeHook.ClassInstance = new HookBase();

	const g_DecoratedHook = new SmokeHook(g_TestCallback);
	g_DecoratedHook.Call();
	g_Assert.equal(g_unCallbackCount, 1);
	g_Assert.strictEqual(g_DecoratedHook.Dispose(), g_TestCallback);

	const g_Hook = g_Hooks.CreateFunctionHook({ Arguments: ["int"], Address: 0x1234n, Convention: "cdecl", ReturnType: "int" });
	const g_HookRecord = g_mapHookRecords.get(g_Hook.ID);

	const g_PreCallback = () => undefined;
	const g_PostCallback = () => undefined;

	const g_PreDecorator = new g_Hooks.PreHook(g_Hook, g_PreCallback);
	const g_PostDecorator = new g_Hooks.PostHook(g_Hook, g_PostCallback);

	g_Assert.equal(g_HookRecord.PreCallbacks.length, 1);
	g_Assert.equal(g_HookRecord.PostCallbacks.length, 1);
	g_Assert.equal(g_PreDecorator.Dispose(), true);
	g_Assert.equal(g_PostDecorator.Dispose(), true);
	g_Assert.equal(g_Hook.Remove(), true);
	g_Assert.equal(g_Hooks.AddPreHook({ Address: 0x2000n, Arguments: ["int"], Convention: "cdecl", ReturnType: "int" }, g_PreCallback), true);
	g_Assert.equal(g_Hooks.AddPostHook({ Address: 0x2001n, Arguments: ["int"], Convention: "cdecl", ReturnType: "int" }, g_PostCallback), true);
	g_Assert.equal(g_Hooks.CallFunction({ Address: 0x3000n, Arguments: [5], Convention: "cdecl", ReturnType: "int" }), 77);
	g_Assert.equal(g_Hooks.GetHookList().every((Entry) => (typeof Entry.Address === "bigint") && (typeof Entry.TrampolineAddress === "bigint")), true);
	g_Assert.equal(g_Hooks.RemoveAllHooks(), true);

	const g_strDisabledResult = g_Hooks.WithHooksDisabled(() => {
		g_Assert.equal(g_Hooks.GetHooksDisabled(), true);

		return "done";
	});
	g_Assert.equal(g_strDisabledResult, "done");
	g_Assert.equal(g_Hooks.GetHooksDisabled(), false);
	g_Assert.throws(() => g_Hooks.WithHooksDisabled(true), /callback/);
	g_Assert.throws(() => g_Hooks.WithHooksDisabled(() => true, 1), /boolean/);

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_Exceptions.ExceptionHook, "ClassInstance"), { configurable: true, enumerable: true, value: g_Exceptions.EXCEPTION_HOOKS, writable: true });

	let g_bExceptionSeen = false;
	const g_ExceptionHook = new g_Exceptions.ExceptionHook((ExceptionValue) => {
		g_bExceptionSeen = ExceptionValue.Message === "boom";
	});

	const g_ExceptionValue = g_Exceptions.EXCEPTION_HOOKS.PrintException(new Error("boom"));
	g_Assert.equal(g_ExceptionValue.Message, "boom");
	g_Assert.equal(g_bExceptionSeen, true);
	g_Assert.equal(g_vecEmittedExceptions.length, 1);
	g_Assert.equal(JSON.parse(g_vecEmittedExceptions[0]).Message, "boom");
	g_ExceptionHook.Dispose();
	g_Assert.throws(() => g_Exceptions.EXCEPTION_HOOKS.PrintException(new Error("bad extra"), []), /object/);
	g_Assert.throws(() => g_Exceptions.EXCEPTION_HOOKS.PrintException(new Error("bad callback state"), {}, 1), /boolean/);

	let g_bNativeExceptionSeen = false;
	let g_NativeExceptionPayload = null;

	const g_NativeExceptionCallback = (Payload) => {
		g_bNativeExceptionSeen = Payload.Kind === "NATIVE";
		g_NativeExceptionPayload = Payload;
	};

	g_Assert.strictEqual(g_Exceptions.On(g_NativeExceptionCallback), g_NativeExceptionCallback);
	g_Assert.throws(() => g_Exceptions.On(g_NativeExceptionCallback), /already registered/);
	const g_EmittedExceptionPayload = { Kind: "NATIVE" };

	g_Exceptions.Emit(g_EmittedExceptionPayload);
	g_Assert.equal(g_bNativeExceptionSeen, true);
	g_Assert.deepEqual(g_NativeExceptionPayload, g_EmittedExceptionPayload);
	g_Assert.notStrictEqual(g_NativeExceptionPayload, g_EmittedExceptionPayload);
	g_Assert.equal(g_Exceptions.Off(g_NativeExceptionCallback), true);
	g_Assert.equal(g_Exceptions.Off(g_NativeExceptionCallback), false);
	g_Assert.throws(() => g_Exceptions.Emit("native"), /object/);

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_Warnings.WarningHook, "ClassInstance"), { configurable: true, enumerable: true, value: g_Warnings.WARNING_HOOKS, writable: true });

	let g_bWarningSeen = false;
	const g_WarningHook = new g_Warnings.WarningHook((WarningValue) => {
		g_bWarningSeen = (WarningValue.Message === "careful") && (WarningValue.LineNumber === 42);
	});

	const g_WarningValue = g_Warnings.Warning("careful", "SmokeWarning", "file.js", 42);
	g_Assert.equal(g_WarningValue.Category, "SmokeWarning");
	g_Assert.equal(g_bWarningSeen, true);
	g_Assert.equal(g_vecEmittedWarnings.length, 1);
	g_Assert.equal(JSON.parse(g_vecEmittedWarnings[0]).Message, "careful");
	g_Assert.deepEqual(g_vecLoggerCallLog.at(-1), ["warning", "Memory hook diagnostic Category=\"SmokeWarning\" Message=\"careful\" Path=\"file.js\" Line=42"]);
	g_WarningHook.Dispose();
	g_Assert.throws(() => g_Warnings.Warning(7), /string/);
	g_Assert.throws(() => g_Warnings.Warning("message", ""), /non-empty string/);
	g_Assert.throws(() => g_Warnings.Warning("message", "Warning", 7), /filename/);
	g_Assert.throws(() => g_Warnings.Warning("message", "Warning", "file.js", 1.5), /safe non-negative integer/);
	g_Assert.throws(() => g_Warnings.Warning("message", "Warning", "file.js", 1, []), /object/);

	let g_bNativeWarningSeen = false;
	let g_NativeWarningPayload = null;

	const g_NativeWarningCallback = (Payload) => {
		g_bNativeWarningSeen = Payload.Kind === "NATIVE";
		g_NativeWarningPayload = Payload;
	};

	g_Assert.strictEqual(g_Warnings.On(g_NativeWarningCallback), g_NativeWarningCallback);
	g_Assert.throws(() => g_Warnings.On(g_NativeWarningCallback), /already registered/);
	g_Warnings.Emit({ Kind: "NATIVE" });
	g_Assert.equal(g_bNativeWarningSeen, true);
	g_Assert.deepEqual(g_NativeWarningPayload, { Kind: "NATIVE" });
	g_Assert.equal(g_Warnings.Off(g_NativeWarningCallback), true);
	g_Assert.equal(g_Warnings.Off(g_NativeWarningCallback), false);
	g_Assert.throws(() => g_Warnings.Emit("native"), /object/);
	g_Assert.equal(g_vecLoggerCallLog.some((vecEntry) => vecEntry[0] === "error"), true);
	g_Assert.equal(g_vecLoggerCallLog.some((vecEntry) => vecEntry[0] === "warning"), true);
	g_Assert.equal(g_vecNativeCallLog.some((vecEntry) => (vecEntry[0] === "CallFunction") && (vecEntry[1].Address === 0x3000n)), true);
	g_Assert.equal(g_vecNativeCallLog.every((vecEntry) => !("address" in vecEntry[1]) && !("args" in vecEntry[1])), true);
	g_Assert.equal(Object.hasOwn(g_Hooks, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Hooks, "default"), false);

	const g_vecDocumentationExamples = ExtractDocumentationExamples(g_Hooks);
	VerifyTrampolineDocumentationFailures(g_vecDocumentationExamples);
	VerifyNativeHookDocumentationCleanupFailures(g_vecDocumentationExamples, g_Hooks);
	g_Assert.equal(VerifyNativeHookDocumentationCleanupFailures(g_vecDocumentationExamples, g_Hooks, [
		{ Name: "CreateFunctionHook", ExampleIndex: 8 },
		{ Name: "CreateVTableHook", ExampleIndex: 9, VTable: true },
		{ Name: "AddPreHook", ExampleIndex: 10 },
	]), 1446);
	g_Assert.equal(VerifyLifecycleDocumentationFailures(g_vecDocumentationExamples), 9075);
	g_Assert.equal(VerifyNativeHookDocumentationCleanupFailures(g_vecDocumentationExamples, g_Hooks, [
		{ Name: "PostHook.Register", ExampleIndex: 17 },
		{ Name: "PreHook.Register", ExampleIndex: 18 },
	]), 864);
	VerifyBaseDocumentationCleanupFailures(g_vecDocumentationExamples, [
		{ Name: "memory/hooks.HookBase", ExampleIndex: 1, Operation: "Append", Cleanup: "Clear" },
		{ Name: "memory/hooks.HookDecorator", ExampleIndex: 2, Operation: "Call", Cleanup: "Dispose" },
	]);

	for (const [unExampleIndex, strExampleSource] of g_vecDocumentationExamples.entries()) {
		ExecuteDocumentationExample(strExampleSource, unExampleIndex);
	}

	const g_vecBaseDocumentationExamples = ExtractBaseDocumentationExamples();
	for (const [unExampleIndex, strExampleSource] of g_vecBaseDocumentationExamples.entries()) {
		ExecuteBaseDocumentationExample(strExampleSource, unExampleIndex);
	}

	VerifyBaseDocumentationCleanupFailures(g_vecBaseDocumentationExamples);

	VerifyExceptionJSONFailureContracts(g_Exceptions);

	const g_vecExceptionsDocumentationExamples = ExtractExceptionsDocumentationExamples();
	VerifyExceptionDocumentationCleanupFailures(g_vecExceptionsDocumentationExamples);
	VerifyExceptionReportingDocumentationFailures(g_vecExceptionsDocumentationExamples[7]);

	for (const [unExampleIndex, strExampleSource] of g_vecExceptionsDocumentationExamples.entries()) {
		ExecuteExceptionsDocumentationExample(strExampleSource, unExampleIndex, g_Exceptions);
	}

	VerifyWarningFailureContracts(g_Warnings, g_Exceptions);

	const g_vecWarningsDocumentationExamples = ExtractWarningsDocumentationExamples();
	VerifyWarningDocumentationCleanupFailures(g_vecWarningsDocumentationExamples);

	for (const [unExampleIndex, strExampleSource] of g_vecWarningsDocumentationExamples.entries()) {
		ExecuteWarningsDocumentationExample(strExampleSource, unExampleIndex, g_Warnings);
	}

	g_Assert.deepEqual(g_ExecutedDocumentationExampleCounts, g_ExpectedDocumentationExampleCounts, "Every hooks documentation example must execute.");
} finally {
	process.removeListener("uncaughtExceptionMonitor", MarkUnhandledFailure);
	g_Module._load = g_OriginalModuleLoad;

	for (const [strPath, CacheEntry] of g_mapOriginalCacheEntries) {
		delete require.cache[strPath];

		if (CacheEntry !== undefined) {
			require.cache[strPath] = CacheEntry;
		}
	}

	if (g_OriginalSourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;

	} else {
		Object.defineProperty(globalThis, "sourcejs", g_OriginalSourceJSDescriptor);
	}
}

VerifyABICallPluginExample();

console.log("[  OK  ] hooks smoke passed: 46 documentation examples, 294 callback cleanup cases, 3606 native-hook cleanup cases, 9075 lifecycle state/error cases, 2240 exception cleanup cases and 1370 warning cleanup cases with controlled doubles; native Detours/SDK execution not exercised");
