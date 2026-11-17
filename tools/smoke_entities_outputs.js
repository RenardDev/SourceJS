#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_Util = require("node:util");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-outputs.md");
const g_strOutputsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "outputs.js");
const g_strFilesystemPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "filesystem.js");
const g_strGlobalsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "globals.js");
const g_strHooksPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "memory", "hooks.js");
const g_strMemoryHelpersPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "memory", "helpers.js");
const g_strMemoryManagerPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "memory", "manager.js");
const g_strPathsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "paths.js");
const g_strDatamapsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "datamaps.js");
const g_strEntityPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "entity.js");
const g_strEntityHelpersPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "helpers.js");
const g_strListenersPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "listeners.js");
const g_strDataDirectory = g_Path.join(g_strProjectRoot, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs", "entityoutputs");
const g_strVirtualDataRoot = "C:/sourcejs-data";
const g_OriginalModuleLoad = g_Module._load;
const g_mapModulePaths = new Map([
	["filesystem", g_strFilesystemPath],
	["globals", g_strGlobalsPath],
	["memory/hooks", g_strHooksPath],
	["memory/helpers", g_strMemoryHelpersPath],
	["memory/manager", g_strMemoryManagerPath],
	["paths", g_strPathsPath],
	["entities/datamaps", g_strDatamapsPath],
	["entities/entity", g_strEntityPath],
	["entities/helpers", g_strEntityHelpersPath],
]);

g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	const strModulePath = g_mapModulePaths.get(strRequestName);
	if (strModulePath !== undefined) {
		return require(strModulePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_vecExpectedExports = [
	"ClearEntityOutputDataCache",
	"CreateEntityFireOutputHook",
	"GetEntityFireOutputArguments",
	"GetEntityFireOutputContext",
	"GetEntityFireOutputData",
	"GetEntityFireOutputHookOptions",
	"GetEntityFireOutputIdentifier",
	"GetEntityFireOutputAddress",
	"GetEntityOutputDataFilePath",
	"GetSupportedEntityOutputSDKBranches",
	"HasEntityOutputData",
	"LoadEntityOutputData",
	"NormalizeEntityFireOutputArguments",
	"ParseEntityOutputINI",
	"RemoveEntityFireOutputHook",
];
const g_vecExpectedBranches = [
	"blade",
	"bms",
	"csgo",
	"css",
	"dods",
	"gmod",
	"hl2dm",
	"l4d2",
	"orangebox",
	"sdk2013",
	"tf2",
];
const g_setTypeNames = new Set([
	"bool",
	"char",
	"double",
	"float",
	"int",
	"long",
	"longlong",
	"address",
	"short",
	"stringarray",
	"stringaddress",
	"uchar",
	"uint",
	"ulong",
	"ulonglong",
	"ushort",
]);
// Controlled hook fixtures use synthetic addresses; they do not execute native hooks or prove an ABI.
const g_mapOutputAddresses = new Map([
	[0x710000n, "OnUser1"],
	[0x710100n, "OnTrigger"],
	[0x710200n, "OnBreak"],
	[0x710300n, "OnUser2"],
]);
const g_unWorldEntityAddress = 0x760000n;
const g_unFirstEntityAddress = 0x730000n;
const g_unSecondEntityAddress = 0x740000n;
const g_unTrampolineAddressOffset = 0x80n;
const g_unXMMRegisterByteCount = 16;
const g_unXMMFixtureByteValue = 0xA5;
const g_unFPUFixtureControlWord = 0x037F;
const g_mapEntityIndexes = new Map([
	[g_unWorldEntityAddress, 0],
	[g_unFirstEntityAddress, 1],
	[g_unSecondEntityAddress, 2],
]);
const g_unInvalidEntityHandleValue = 0xFFFFFFFF;
const g_unIntegerVariantFieldType = 5;
const g_unValueAddress = 0x720000n;
const g_unFunctionAddress = 0x501000n;

const g_mapVirtualFiles = new Map();
const g_vecResolveCalls = [];
const g_mapHooks = new Map();
const g_vecHookEvents = [];
const g_vecListenerEvents = [];

let g_unNextHookID = 1;
let g_bShouldFailNextHookRemoval = false;
let g_bShouldFailNextPreRegistration = false;
let g_bThrowNextHookRemoval = false;
let g_bThrowNextPreRegistration = false;
let g_HookRemovalError = undefined;
let g_PreRegistrationError = undefined;

function VerifyEntityOutputRootPaths() {
	const strSource = g_FileSystem.readFileSync(g_strOutputsPath, "utf8");
	const vecRoots = [
		["//server/share", "//server/share"],
		["\\\\server\\share", "//server/share"],
		["//server//share///data/", "//server/share/data"],
		["C:\\game\\addons\\", "C:/game/addons"],
		["/srv/sourcejs/data", "/srv/sourcejs/data"],
		["relative\\data", "relative/data"],
	];
	let unScenarioCount = 0;
	for (const [strRoot, strExpectedRoot] of vecRoots) {
		const strIndexPath = `${strExpectedRoot}/entityoutputs/index.json`;
		const strDataPath = `${strExpectedRoot}/entityoutputs/Profile.ini`;
		const ModuleRecord = { exports: {} };
		const RequireDependency = (strName) => {
			if (strName === "paths") {
				return { SOURCE_DATA_ROOT: strRoot };
			}

			if (strName === "globals") {
				return { GetGlobalVariables: () => ({ SDKBranch: "l4d2" }) };
			}

			if (strName === "filesystem") {
				return {
					DoesFileExist(strPath) {
						g_Assert.ok((strPath === strIndexPath) || (strPath === strDataPath), "Entity output paths must preserve the UNC prefix.");

						return true;
					},
					ReadTextFile(strPath) {
						g_Assert.equal(strPath, strIndexPath);

						return JSON.stringify({ Format: 1, Profiles: { l4d2: "Profile" }, Entries: { Profile: "Profile.ini" } });
					},
				};
			}

			return {};
		};
		g_VM.runInNewContext(strSource, { module: ModuleRecord, require: RequireDependency }, { filename: g_strOutputsPath });
		g_Assert.equal(ModuleRecord.exports.GetEntityOutputDataFilePath(), strDataPath);
		g_Assert.deepEqual(Array.from(ModuleRecord.exports.GetSupportedEntityOutputSDKBranches()), ["l4d2"]);
		g_Assert.equal(ModuleRecord.exports.HasEntityOutputData("l4d2"), true);
		unScenarioCount += 3;
	}

	const JoinPath = g_VM.runInNewContext(strSource + "\nJoinSlashPath;", { module: { exports: {} }, require: () => ({}) });
	const vecPathCases = [
		[[], ""],
		[[null, undefined, "", "root"], "root"],
		[[12, "part"], "12/part"],
		[["root", 0n], "root/0"],
		[["///server/share", "child"], "/server/share/child"],
		[["//server/share", "child"], "//server/share/child"],
	];
	for (const [vecParts, strExpectedPath] of vecPathCases) {
		g_Assert.equal(JoinPath(...vecParts), strExpectedPath);
		unScenarioCount += 1;
	}

	g_Assert.equal(unScenarioCount, 24);
	console.log("Entity output root paths 24 profiles passed.");
}

VerifyEntityOutputRootPaths();

function JoinSlashPath(...vecParts) {
	return vecParts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function LoadVirtualData() {
	const vecPendingDirectories = [g_strDataDirectory];
	while (vecPendingDirectories.length > 0) {
		const strDirectory = vecPendingDirectories.pop();
		for (const Entry of g_FileSystem.readdirSync(strDirectory, { withFileTypes: true })) {
			const strEntryPath = g_Path.join(strDirectory, Entry.name);

			if (Entry.isDirectory()) {
				vecPendingDirectories.push(strEntryPath);
				continue;
			}

			const strRelativePath = g_Path.relative(g_strDataDirectory, strEntryPath).replace(/\\/g, "/");
			g_mapVirtualFiles.set(JoinSlashPath(g_strVirtualDataRoot, "entityoutputs", strRelativePath), g_FileSystem.readFileSync(strEntryPath, "utf8"));
		}
	}
}

function NormalizeType(strTypeName) {
	if (typeof strTypeName !== "string") {
		throw new TypeError("Memory type must be a string.");
	}

	const strNormalizedName = strTypeName.trim().toLowerCase();
	if (!g_setTypeNames.has(strNormalizedName)) {
		throw new TypeError(`Unknown memory type: ${strTypeName}`);
	}

	return strNormalizedName;
}

function RequireAddress(unAddress, strOperation) {
	if ((typeof unAddress !== "bigint") || (unAddress < 0n)) {
		throw new TypeError(`${strOperation} expects a non-negative BigInt address.`);
	}

	return unAddress;
}

function CreateRawArguments(unOutputAddress, flDelay = 2.5) {
	if ((g_MemoryManager.PLATFORM === "windows") && (g_MemoryManager.ARCHITECTURE === "x86")) {
		// Synthetic inline value/handle/type words, not an SDK layout model.
		return [unOutputAddress, 73, 0x00, 0x00, g_unInvalidEntityHandleValue, g_unIntegerVariantFieldType, g_unFirstEntityAddress, g_unSecondEntityAddress, flDelay];
	}

	return [unOutputAddress, g_unValueAddress, g_unFirstEntityAddress, g_unSecondEntityAddress, flDelay];
}

function MakePayload(Hook, Event) {
	const Payload = {
		Arguments: Event.Arguments,
		StackAddress: g_unValueAddress - g_unInlineVariantStackOffset,
		HookID: Hook.ID,
		TrampolineAddress: Hook.TrampolineAddress,
		Type: "pre",
		CallHookTrampoline(Options = {}) {
			if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
				throw new TypeError("CallHookTrampoline options must be an object.");
			}

			if ((Options.Arguments !== undefined) && !Array.isArray(Options.Arguments)) {
				throw new TypeError("CallHookTrampoline Arguments must be an array.");
			}

			if ((Options.Registers !== undefined) && (!Options.Registers || (typeof Options.Registers !== "object") || Array.isArray(Options.Registers))) {
				throw new TypeError("CallHookTrampoline Registers must be an object.");
			}

			Event.TrampolineCalls += 1;
			Event.TrampolineArguments = Options.Arguments ?? Payload.Arguments;
			Event.TrampolineRegisters = Options.Registers ?? {};

			const bIsX64 = g_MemoryManager.ARCHITECTURE === "x64";
			const strAccumulatorRegisterName = bIsX64 ? "RAX" : "EAX";
			const unAccumulatorValue = bIsX64 ? 0xFEDCBA9876543210n : 0xFEDCBA98n;
			Event.TrampolineResult = {
				Registers: {
					[strAccumulatorRegisterName]: unAccumulatorValue,
					FPUControlWord: g_unFPUFixtureControlWord,
					XMM0: new Array(g_unXMMRegisterByteCount).fill(g_unXMMFixtureByteValue),
					...Event.TrampolineRegisters,
				},
				ReturnValue: undefined,
			};

			return Event.TrampolineResult;
		},
		SetHookArgument(unIndex, Value) {
			if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex >= Payload.Arguments.length)) {
				throw new RangeError("SetHookArgument index is outside the hook argument array.");
			}

			Payload.Arguments[unIndex] = Value;
			Event.ArgumentWrites.push([unIndex, Value]);
		},
		SetHookReturnValue(Value) {
			Event.ReturnValue = Value;
		},
	};

	return Payload;
}

function CreateNativeHook(Options) {
	g_Assert.equal(typeof Options.Address, "bigint");
	g_Assert.equal(Options.Address, g_unFunctionAddress);
	for (const Hook of g_mapHooks.values()) {
		if (Hook.Address === Options.Address) {
			const ExistingHookView = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Hook));
			ExistingHookView.Created = false;

			return ExistingHookView;
		}
	}

	g_Assert.equal(Options.ReturnType, "void");
	g_Assert.ok(Array.isArray(Options.Arguments));
	g_Assert.ok(["cdecl", "stdcall", "thiscall", "fastcall"].includes(Options.Convention), "Match the native hook-signature parser; x64 ABI labels are not accepted option values.");

	const setPreCallbacks = new Set();
	const setPostCallbacks = new Set();
	const Hook = {
		ID: g_unNextHookID,
		Created: true,
		Address: Options.Address,
		TrampolineAddress: Options.Address + g_unTrampolineAddressOffset,
		Post(Callback) {
			if (typeof Callback !== "function") {
				return false;
			}

			setPostCallbacks.add(Callback);

			return true;
		},
		Pre(Callback) {
			if (typeof Callback !== "function") {
				return false;
			}

			if (g_bThrowNextPreRegistration) {
				g_bThrowNextPreRegistration = false;
				throw g_PreRegistrationError;
			}

			if (g_bShouldFailNextPreRegistration) {
				g_bShouldFailNextPreRegistration = false;
				return false;
			}

			setPreCallbacks.add(Callback);

			return true;
		},
		Remove() {
			if (g_bThrowNextHookRemoval) {
				g_bThrowNextHookRemoval = false;
				throw g_HookRemovalError;
			}

			if (g_bShouldFailNextHookRemoval) {
				g_bShouldFailNextHookRemoval = false;
				return false;
			}

			if (!g_mapHooks.has(Hook.ID)) {
				return false;
			}

			g_mapHooks.delete(Hook.ID);
			setPreCallbacks.clear();
			setPostCallbacks.clear();

			return true;
		},
		RemovePost(Callback) {
			return setPostCallbacks.delete(Callback);
		},
		RemovePre(Callback) {
			return setPreCallbacks.delete(Callback);
		},
	};

	Object.defineProperties(Hook, {
		Options: { value: { ...Options, Arguments: [...Options.Arguments] } },
		PostCallbacks: { value: setPostCallbacks },
		PreCallbacks: { value: setPreCallbacks },
	});

	g_unNextHookID += 1;
	g_mapHooks.set(Hook.ID, Hook);

	return Hook;
}

function DispatchOutput(unOutputAddress, flDelay = 2.5) {
	const strOutputName = g_mapOutputAddresses.get(unOutputAddress);
	g_Assert.ok(strOutputName);

	for (const Hook of g_mapHooks.values()) {
		const Event = {
			ArgumentWrites: [],
			Arguments: CreateRawArguments(unOutputAddress, flDelay),
			Blocked: false,
			HookID: Hook.ID,
			OriginalCalls: 0,
			OutputName: strOutputName,
			ReturnValue: undefined,
			TrampolineArguments: null,
			TrampolineCalls: 0,
			TrampolineRegisters: null,
		};
		const Payload = MakePayload(Hook, Event);

		for (const Callback of [...Hook.PreCallbacks]) {
			const Result = Callback(Payload);

			if ((Result !== undefined) && (Result !== null)) {
				Event.Blocked = true;
				Event.ReturnValue = Result;
			}
		}

		if (!Event.Blocked && (Event.TrampolineCalls === 0)) {
			Event.OriginalCalls += 1;
		}

		for (const Callback of [...Hook.PostCallbacks]) {
			Callback({ Arguments: [...Payload.Arguments], HookID: Hook.ID, ReturnValue: Event.ReturnValue, Type: "post" });
		}

		g_vecHookEvents.push(Event);
	}
}

function DispatchDocumentationOutputs() {
	for (const unOutputAddress of g_mapOutputAddresses.keys()) {
		DispatchOutput(unOutputAddress);
	}
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function TrackModule(ModuleExports, setExercisedExports) {
	const TrackedExports = {};
	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setExercisedExports.add(strName);

				return Value;
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unIndex, Modules) {
	const Script = new g_VM.Script(`(function (require, module, exports, console) {\n${strSource}\n})`, { filename: `entities-outputs.md:block-${unIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const PluginModule = { exports: {} };
	const setOriginalHookIDs = new Set(g_mapHooks.keys());
	const setOriginalListenerCallbacks = new Set(g_setActiveEntityOutputListenerCallbacks);
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Entity output documentation must use the typed logger.");
		},
	};

	Callback(DocumentationRequire, PluginModule, PluginModule.exports, DocumentationConsole);

	DispatchDocumentationOutputs();

	g_Assert.equal(Object.hasOwn(PluginModule.exports, "unload"), false, "Documentation must not export the obsolete lowercase lifecycle.");

	if (typeof PluginModule.exports.Unload === "function") {
		PluginModule.exports.Unload();
	}

	g_Assert.deepEqual(Array.from(g_mapHooks.keys()), Array.from(setOriginalHookIDs), "A documentation plugin left native hooks installed after unload.");
	g_Assert.deepEqual(Array.from(g_setActiveEntityOutputListenerCallbacks), Array.from(setOriginalListenerCallbacks), "A documentation plugin left entity-output listeners registered after unload.");
}

function VerifyDocumentationPartialHookInstallation(vecDocumentationBlocks) {
	const unExpectedInstallerCount = 6;
	const unExpectedFailureCaseCount = 81;
	const vecInstallerBlocks = vecDocumentationBlocks.flatMap((strBlock, unBlockIndex) => strBlock.includes("CreateEntityFireOutputHook(") ? [{ Source: strBlock, Index: unBlockIndex }] : []);
	g_Assert.equal(vecInstallerBlocks.length, unExpectedInstallerCount, "Every low-level output installer must be checked.");

	const UnformattableFailure = {
		toString() {
			throw new Error("Installation failures must not be stringified by cleanup diagnostics.");
		},
	};
	const vecInstallationFailures = [new Error("Controlled hook callback registration failure."), undefined, UnformattableFailure];
	const vecScenarios = [
		{ HookRetained: true, RemovalResult: true, CleanupThrows: false, RetainedAfterFailure: false },
		{ HookRetained: true, RemovalResult: false, CleanupThrows: false, RetainedAfterFailure: true },
		{ HookRetained: true, RemovalResult: false, CleanupThrows: true, RetainedAfterFailure: true },
		{ HookRetained: false, RemovalResult: false, CleanupThrows: false, RetainedAfterFailure: false },
	];
	let unVerifiedFailureCases = 0;
	for (const InstallerBlock of vecInstallerBlocks) {
		const strSource = InstallerBlock.Source.replaceAll("\r\n", "\n");
		const vecInstallerName = strSource.match(/const g_([A-Za-z0-9_]+) = function \1\(\) \{\n\tlet EntityFireOutputHook = null;/);
		const vecGuardMatch = strSource.match(/\tlet EntityFireOutputHook = null;\n(?:\tlet SameEntityFireOutputHook = null;\n)?\n\ttry \{\n((?:\t\t(?:Same)?EntityFireOutputHook = CreateEntityFireOutputHook\(g_[A-Za-z0-9_]+\);\n)+)\t\} catch \(InstallationFailure\) \{[\s\S]*?\n\t\}\n\n/);
		g_Assert.ok(vecInstallerName && vecGuardMatch, "Every installer must guard all callback registrations.");
		const strInstallerName = vecInstallerName[1];
		const unCreationCallCount = vecGuardMatch[1].trimEnd().split("\n").length;

		// Remove only acquisition cleanup, preserving valid declarations and all remaining example code.
		const strUnguardedCreation = vecGuardMatch[1].replace(/^\t\t/gm, "\tconst ");
		const strGuardBypassSource = strSource.replace(vecGuardMatch[0], `${strUnguardedCreation}\n`);

		for (let unFailingCreationCall = 1; unFailingCreationCall <= unCreationCallCount; unFailingCreationCall += 1) {
			for (const Scenario of vecScenarios) {
				if ((unFailingCreationCall > 1) && !Scenario.HookRetained) {
					continue;
				}

				for (const InstallationFailure of vecInstallationFailures) {
					const VerifyInstallationFailure = (strCode) => {
						let unCreationCalls = 0;
						let unRemovalAttempts = 0;
						let bHookRetained = false;
						const CleanupFailure = new Error("Controlled hook removal failure.");
						const Modules = {
							"entities/outputs": {
								CreateEntityFireOutputHook(HookCallback) {
									g_Assert.equal(typeof HookCallback, "function");

									unCreationCalls += 1;
									if (unCreationCalls < unFailingCreationCall) {
										bHookRetained = true;
										return {};
									}

									bHookRetained = Scenario.HookRetained;
									throw InstallationFailure;
								},
								GetEntityFireOutputContext() {
									throw new Error("A failed installation must not decode a hook payload.");
								},
								RemoveEntityFireOutputHook() {
									unRemovalAttempts += 1;

									if (Scenario.CleanupThrows) {
										throw CleanupFailure;
									}

									if (Scenario.RemovalResult) {
										bHookRetained = false;
									}

									return Scenario.RemovalResult;
								},
							},
							loggers: {
								LogInfo() {
									throw new Error("A failed installation must not reach output logging.");
								},
							},
						};
						let bFailureCaught = false;
						let CaughtFailure = null;

						try {
							ExecuteDocumentationBlock(strCode, InstallerBlock.Index, Modules);
						} catch (FailureValue) {
							bFailureCaught = true;
							CaughtFailure = FailureValue;
						}

						g_Assert.equal(bFailureCaught, true);
						g_Assert.equal(unCreationCalls, unFailingCreationCall);
						g_Assert.equal(unRemovalAttempts, 1, "Partial FireOutput installation must attempt cleanup.");
						g_Assert.equal(bHookRetained, Scenario.RetainedAfterFailure);

						if (Scenario.CleanupThrows) {
							g_Assert.equal(CaughtFailure.name, "AggregateError");
							g_Assert.equal(CaughtFailure.message, `${strInstallerName} installation and cleanup failed.`);
							g_Assert.equal(CaughtFailure.errors.length, 2);
							g_Assert.strictEqual(CaughtFailure.errors[0], InstallationFailure);
							g_Assert.strictEqual(CaughtFailure.errors[1], CleanupFailure);
						} else {
							g_Assert.equal(CaughtFailure.message, `${strInstallerName} failed. CleanupReportedRemoval=${Scenario.RemovalResult}`);
							g_Assert.equal(Object.hasOwn(CaughtFailure, "cause"), true);
							g_Assert.strictEqual(CaughtFailure.cause, InstallationFailure);
						}
					};
					VerifyInstallationFailure(strSource);
					g_Assert.throws(() => VerifyInstallationFailure(strGuardBypassSource), (FailureValue) => (FailureValue.code === "ERR_ASSERTION") && FailureValue.message.includes("Partial FireOutput installation must attempt cleanup."), "Removing the initializer guard must fail this specific cleanup regression.");
					unVerifiedFailureCases += 1;
				}
			}
		}
	}

	g_Assert.equal(unVerifiedFailureCases, unExpectedFailureCaseCount);
}

function VerifyDocumentationValueReporting(vecDocumentationBlocks, DocumentedEntityOutputs, DocumentationLoggers) {
	// Controlled value-formatting cases, not native datamap field-decoding validation.
	const vecCases = [
		{ Name: "Null", Value: null },
		{ Name: "Boolean", Value: false },
		{ Name: "Integer", Value: -73 },
		{ Name: "Float", Value: 0.25 },
		{ Name: "String", Value: "value\0with\"quotes" },
		{ Name: "Vector", Value: { X: 1.25, Y: -2.5, Z: 3.75 } },
		{ Name: "Color", Value: { R: 0, G: 127, B: 255, A: 255 } },
		{ Name: "WideEntityAddress", Value: 0xFEDCBA9876543210n },
	];
	const OriginalDocumentationValue = g_DocumentationVariantValue;
	const strOriginalPlatform = g_MemoryManager.PLATFORM;
	const strOriginalArchitecture = g_MemoryManager.ARCHITECTURE;

	try {
		for (const strPlatform of ["windows", "linux"]) {
			g_MemoryManager.PLATFORM = strPlatform;
			g_MemoryManager.ARCHITECTURE = "x64";

			for (const Case of vecCases) {
				g_DocumentationVariantValue = Case.Value;
				const strOriginalValue = (typeof Case.Value === "bigint") ? Case.Value.toString() : JSON.stringify(Case.Value);
				const unLogStart = g_vecDocumentationLogs.length;
				const unEventStart = g_vecHookEvents.length;
				for (const unBlockIndex of [5, 7, 10, 11]) {
					ExecuteDocumentationBlock(vecDocumentationBlocks[unBlockIndex], unBlockIndex, { "entities/outputs": DocumentedEntityOutputs, listeners: g_HighLevelListeners, loggers: DocumentationLoggers });
				}

				const vecLogs = g_vecDocumentationLogs.slice(unLogStart);
				g_Assert.equal(vecLogs.length, 7, Case.Name);
				const ExpectedValue = (typeof Case.Value === "bigint") ? Case.Value.toString() : Case.Value;
				for (const Record of vecLogs) {
					if (Record.Format === "CallUserEntityOutputTrampoline Registers=%j ReturnValue=%s") {
						g_Assert.equal(Record.Values[0].RAX, "0xFEDCBA9876543210");
						g_Assert.equal(Record.Values[0].FPUControlWord, g_unFPUFixtureControlWord);
						g_Assert.deepEqual(Array.from(Record.Values[0].XMM0), new Array(g_unXMMRegisterByteCount).fill(g_unXMMFixtureByteValue));
						g_Assert.equal(Record.Values[1], undefined);
						continue;
					}

					const LogValue = (Record.Format === "ObserveEntityFireOutput Result=%j") ? Record.Values[0].FireOutputValue : Record.Values[0].EntityOutputValue;
					g_Assert.equal(JSON.stringify(LogValue), JSON.stringify(ExpectedValue), Case.Name);
				}

				const vecTrampolineEvents = g_vecHookEvents.slice(unEventStart).filter(Event => Event.TrampolineCalls === 1);
				g_Assert.equal(vecTrampolineEvents.length, 1);
				g_Assert.equal(vecTrampolineEvents[0].TrampolineResult.Registers.RAX, 0xFEDCBA9876543210n, "Reporting must not rewrite the native register result.");
				g_Assert.equal(g_LastDocumentationVariant.Value, Case.Value, "Reporting must not rewrite the Variant snapshot.");
				g_Assert.equal((typeof Case.Value === "bigint") ? Case.Value.toString() : JSON.stringify(Case.Value), strOriginalValue, "Reporting must not mutate numeric component records.");
				g_Assert.equal(g_mapHooks.size, 0);
				g_Assert.equal(g_setActiveEntityOutputListenerCallbacks.size, 0);
			}
		}
	} finally {
		g_DocumentationVariantValue = OriginalDocumentationValue;
		g_MemoryManager.PLATFORM = strOriginalPlatform;
		g_MemoryManager.ARCHITECTURE = strOriginalArchitecture;
	}
}

function VerifyCanonicalEntityOutputProfile(OutputModule, strProfileFileName, bExpectedServerCheck, ExpectedDescriptor) {
	const strProfileText = g_FileSystem.readFileSync(g_Path.join(g_strDataDirectory, strProfileFileName), "utf8");
	g_Assert.ok(!strProfileText.includes("\r\n") || !strProfileText.replace(/\r\n/g, "").includes("\n"), `${strProfileFileName} line endings must be consistent`);

	const vecFunctionNames = [...strProfileText.matchAll(/^\t\[\[([^\]]+)]]/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecFunctionNames, ["FireOutput"], `${strProfileFileName} packaged public aliases must already use PascalCase`);

	const vecArgumentFields = [...strProfileText.matchAll(/^\t\targuments_(?:linux|windows(?:_x64)?) = ([^\r\n]+)/gm)];
	g_Assert.equal(vecArgumentFields.length, 3, `${strProfileFileName} must retain Linux, Windows x86, and Windows x64 argument lists`);

	for (const vecArgumentField of vecArgumentFields) {
		for (const strTypeName of vecArgumentField[1].split(",").map(strName => strName.trim())) {
			g_Assert.match(strTypeName, /^[a-z][a-z0-9]*$/, `${strProfileFileName} type discriminators must use canonical compact names`);
		}
	}

	const Profile = OutputModule.ParseEntityOutputINI(strProfileText);
	g_Assert.equal(Profile.Binary, "server");
	g_Assert.equal(Profile.ServerCheckEnabled, bExpectedServerCheck);
	g_Assert.deepEqual(Object.keys(Profile.Functions), ["FireOutput"]);
	g_Assert.deepEqual({ ...Profile.Functions.FireOutput }, ExpectedDescriptor);
}

function InstallDependency(strModulePath, ModuleExports) {
	require.cache[strModulePath] = {
		exports: ModuleExports,
		filename: strModulePath,
		id: strModulePath,
		loaded: true,
	};
}

function Entity(nEntityIndex) {
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 0)) {
		throw new RangeError("Entity requires a non-negative entity index.");
	}

	const unAddress = (nEntityIndex === 0) ? g_unWorldEntityAddress : (nEntityIndex === 1) ? g_unFirstEntityAddress : g_unSecondEntityAddress;

	return { ClassName: (nEntityIndex === 0) ? "worldspawn" : (nEntityIndex === 1) ? "player" : "logic_relay", Index: nEntityIndex, Address: unAddress };
}

const g_FileSystemRuntime = {
	DoesFileExist(strFilePath) {
		if (typeof strFilePath !== "string") {
			throw new TypeError("filesystem.DoesFileExist expects a string path.");
		}

		return g_mapVirtualFiles.has(strFilePath.replace(/\\/g, "/"));
	},
	ReadTextFile(strFilePath) {
		if (typeof strFilePath !== "string") {
			throw new TypeError("filesystem.ReadTextFile expects a string path.");
		}

		const strNormalizedPath = strFilePath.replace(/\\/g, "/");
		if (!g_mapVirtualFiles.has(strNormalizedPath)) {
			throw new Error(`Missing virtual file: ${strNormalizedPath}`);
		}

		return g_mapVirtualFiles.get(strNormalizedPath);
	},
};

const g_Globals = {
	GetGlobalVariables() {
		return { SDKBranch: "l4d2" };
	},
};

const g_MemoryHelpers = {
	Type: { Address: "address", NormalizeDataType: NormalizeType },
	IsNull(unAddress) {
		return RequireAddress(unAddress, "memory/helpers.IsNull") === 0n;
	},
};

const g_MemoryManager = {
	ARCHITECTURE: "x86",
	PLATFORM: "windows",
	ResolveBinaryIdentifier(strBinary, strIdentifier) {
		if ((typeof strBinary !== "string") || (typeof strIdentifier !== "string")) {
			throw new TypeError("memory/manager.ResolveBinaryIdentifier(strBinary, strIdentifier) expects binary and identifier strings.");
		}

		g_vecResolveCalls.push([strBinary, strIdentifier]);

		return ((strBinary === "server") && (strIdentifier.length > 0)) ? g_unFunctionAddress : 0n;
	},
};

const g_unInlineVariantStackOffset = 0x04n;

let g_DocumentationVariantValue = "payload-value";
let g_LastDocumentationVariant = null;
const g_Datamaps = {
	CreateEntityDataMapVariantFromAddress(unAddress) {
		RequireAddress(unAddress, "entities/datamaps.CreateEntityDataMapVariantFromAddress");

		if (unAddress !== g_unValueAddress) {
			throw new ReferenceError("Unknown Variant address.");
		}

		g_LastDocumentationVariant = { Address: unAddress, Type: "string", TypeID: 2, Value: g_DocumentationVariantValue };

		return g_LastDocumentationVariant;
	},
};

let g_LastOutputNameCaller = null;
const g_EntityHelpers = {
	FindEntityOutputNameByAddress(EntityInstance, unOutputAddress) {
		const nCallerIndex = (typeof EntityInstance === "number") ? EntityInstance : EntityInstance?.Index;
		if (!Number.isInteger(nCallerIndex) || !Array.from(g_mapEntityIndexes.values()).includes(nCallerIndex)) {
			throw new Error("entities/helpers.FindEntityOutputNameByAddress requires a live caller entity.");
		}

		RequireAddress(unOutputAddress, "entities/helpers.FindEntityOutputNameByAddress output");
		if (unOutputAddress === 0n) {
			throw new Error("entities/helpers.FindEntityOutputNameByAddress requires a non-zero BigInt output address.");
		}

		g_LastOutputNameCaller = EntityInstance;

		return (nCallerIndex === 2) ? (g_mapOutputAddresses.get(unOutputAddress) ?? null) : null;
	},
	GetEntityIndexFromEntityAddress(unAddress) {
		RequireAddress(unAddress, "entities/helpers.GetEntityIndexFromEntityAddress");

		if (!g_mapEntityIndexes.has(unAddress)) {
			throw new ReferenceError("Unknown entity address.");
		}

		return g_mapEntityIndexes.get(unAddress);
	},
};

const g_NativeHooks = { CreateFunctionHook: CreateNativeHook };

const g_setActiveEntityOutputListenerCallbacks = new Set();

const g_HighLevelListeners = {
	RegisterEntityOutputListener(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError("RegisterEntityOutputListener expects a callback.");
		}

		const Context = { OutputAddress: 0x710000n };
		const Value = g_Datamaps.CreateEntityDataMapVariantFromAddress(g_unValueAddress);

		Callback("OnUser1", Entity(1), Entity(2), Value, 0.5, Context);
		g_vecListenerEvents.push([Callback, Context]);
		g_setActiveEntityOutputListenerCallbacks.add(Callback);

		return {
			DisposeListener() {
				return g_setActiveEntityOutputListenerCallbacks.delete(Callback);
			},
		};
	},
};

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("unexpected");', 0, {}), /Entity output documentation must use the typed logger\./);
g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /Documentation must not export the obsolete lowercase lifecycle/);

LoadVirtualData();
InstallDependency(g_strFilesystemPath, g_FileSystemRuntime);
InstallDependency(g_strGlobalsPath, g_Globals);
InstallDependency(g_strHooksPath, g_NativeHooks);
InstallDependency(g_strMemoryHelpersPath, g_MemoryHelpers);
InstallDependency(g_strMemoryManagerPath, g_MemoryManager);
InstallDependency(g_strPathsPath, { SOURCE_DATA_ROOT: g_strVirtualDataRoot });
InstallDependency(g_strDatamapsPath, g_Datamaps);
InstallDependency(g_strEntityPath, { Entity });
InstallDependency(g_strEntityHelpersPath, g_EntityHelpers);

delete require.cache[g_strOutputsPath];
const g_EntityOutputs = require(g_strOutputsPath);
g_Assert.deepEqual(Object.keys(g_EntityOutputs).sort(), [...g_vecExpectedExports].sort());
g_Assert.ok(g_FileSystem.readdirSync(g_Path.dirname(g_strDataDirectory)).includes(g_Path.basename(g_strDataDirectory)), "Entity output data directory spelling must match the packaged directory exactly.");
g_Assert.deepEqual(g_EntityOutputs.GetSupportedEntityOutputSDKBranches().sort(), g_vecExpectedBranches);
g_Assert.equal(g_EntityOutputs.HasEntityOutputData("l4d2"), true);
g_Assert.equal(g_EntityOutputs.HasEntityOutputData("tf2"), true);
g_Assert.equal(g_EntityOutputs.HasEntityOutputData("l4d"), false);
g_Assert.throws(() => g_EntityOutputs.HasEntityOutputData(17), /non-empty string/);
g_Assert.match(g_EntityOutputs.GetEntityOutputDataFilePath("l4d2"), /entityoutputs\/l4d2\/CBaseEntityOutput\.ini$/);

const g_FirstProfile = g_EntityOutputs.LoadEntityOutputData("l4d2");
const g_SameProfile = g_EntityOutputs.LoadEntityOutputData("l4d2");

g_Assert.equal(g_FirstProfile, g_SameProfile);
g_Assert.equal(g_FirstProfile.Binary, "server");
g_Assert.equal(g_FirstProfile.ServerCheckEnabled, true);
g_Assert.deepEqual(g_FirstProfile.Functions.FireOutput.ArgumentsLinux, ["address", "address", "address", "float"]);
g_Assert.deepEqual(g_FirstProfile.Functions.FireOutput.ArgumentsWindows, ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"]);
g_Assert.deepEqual(g_FirstProfile.Functions.FireOutput.ArgumentsWindowsX64, ["address", "address", "address", "float"]);

const g_SharedOrangeBoxProfile = g_EntityOutputs.LoadEntityOutputData("tf2");
g_Assert.equal(g_EntityOutputs.LoadEntityOutputData("css"), g_SharedOrangeBoxProfile);

g_FirstProfile.Functions.FireOutput.IdentifierWindows = "TEST SIGNATURE";
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputIdentifier("l4d2"), "TEST SIGNATURE");

let g_unPlatformReadCount = 0;

Object.defineProperty(g_MemoryManager, "PLATFORM", {
	configurable: true,
	get() {
		g_unPlatformReadCount += 1;

		return "windows";
	},
});

g_Assert.equal(g_EntityOutputs.GetEntityFireOutputIdentifier("l4d2"), "TEST SIGNATURE");
g_Assert.equal(g_unPlatformReadCount, 1);

Object.defineProperty(g_MemoryManager, "PLATFORM", {
	configurable: true,
	value: "windows",
	writable: true,
});

g_FirstProfile.Functions.FireOutput.IdentifierWindows = "55 8B EC 81 EC 2A 2A 2A 2A A1";

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "blade/CBaseEntityOutput.ini", false, {
	IdentifierLinux: "_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f",
	IdentifierWindows: "55 8B EC 81 EC 1C 01 00 00 53 56",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

{
	const strProfileDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	g_Assert.match(strProfileDocumentation, /\[\[FireOutput]]/, "entities/outputs documentation must show the canonical public alias");
	g_Assert.doesNotMatch(strProfileDocumentation, /\[\[fire_output]]/, "entities/outputs documentation public aliases must use PascalCase");
}

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "bms/CBaseEntityOutput.ini", true, {
	IdentifierLinux: "_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f",
	IdentifierWindows: "55 8B EC 81 EC 2A 2A 2A 2A A1 2A 2A 2A 2A 33 C5 89 45 FC 53 8B 5D 20 8B C1 8B 4D 1C 56 57 8B",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "csgo/CBaseEntityOutput.ini", false, {
	IdentifierLinux: "55 89 E5 57 56 53 81 EC 4C 01 00 00 8B 45 08 65 8B 1D 14 00 00 00",
	IdentifierWindows: "55 8B EC 83 2A 2A 81 EC 2A 2A 2A 2A 8B C1 53 56 57 8B 2A 2A 89 2A 2A 2A 33",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "gmod/CBaseEntityOutput.ini", true, {
	IdentifierLinux: "_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f",
	IdentifierWindows: "55 8B EC 81 EC 24 01 00 00 53 8B C1",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "l4d2/CBaseEntityOutput.ini", true, {
	IdentifierLinux: "_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f",
	IdentifierWindows: "55 8B EC 81 EC 2A 2A 2A 2A A1 2A 2A 2A 2A 33 C5 89 2A 2A 8B 2A 2A 53 56 8B 2A 2A 57 8B 2A 2A 89 2A 2A 2A 2A 2A 89 2A 2A 2A 2A 2A 89 2A 2A 2A 2A 2A C7",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

VerifyCanonicalEntityOutputProfile(g_EntityOutputs, "orangebox/CBaseEntityOutput.ini", true, {
	IdentifierLinux: "_ZN17CBaseEntityOutput10FireOutputE9variant_tP11CBaseEntityS2_f",
	IdentifierWindows: "55 8B EC 81 EC 40 01 00 00 8B C1 53",
	ArgumentsLinux: ["address", "address", "address", "float"],
	ArgumentsWindows: ["uint", "uint", "uint", "uint", "uint", "address", "address", "float"],
	ArgumentsWindowsX64: ["address", "address", "address", "float"],
});

const g_ParsedProfile = g_EntityOutputs.ParseEntityOutputINI(`
binary = server
server_check = False
[function]
	[[fire_output]]
		identifier_linux = symbol
		identifier_windows = 55 8B
		arguments_linux = ADDRESS, ADDRESS, ADDRESS, FLOAT
		arguments_windows = UINT, UINT, UINT, UINT, UINT, ADDRESS, ADDRESS, FLOAT
		arguments_windows_x64 = ADDRESS, ADDRESS, ADDRESS, FLOAT
`);

g_Assert.equal(g_ParsedProfile.ServerCheckEnabled, false);
g_Assert.equal(g_ParsedProfile.Functions.FireOutput.IdentifierLinux, "symbol");

const g_vecINICommentCases = [
	{ INI: "\"plain # retained\" # trailing comment", Value: "plain # retained" },
	{ INI: String.raw`"quote \"# retained" # trailing comment`, Value: "quote \"# retained" },
	{ INI: String.raw`"even \\" # trailing comment`, Value: "even \\" },
	{ INI: String.raw`"odd \\\"# retained" # trailing comment`, Value: "odd \\\"# retained" },
	{ INI: "unquoted # removed", Value: "unquoted" },
];

for (const INICommentCase of g_vecINICommentCases) {
	const ParsedProfile = g_EntityOutputs.ParseEntityOutputINI(`binary = ${INICommentCase.INI}\n[function]\n[[fire_output]]`);
	g_Assert.equal(ParsedProfile.Binary, INICommentCase.Value);
}

const g_PrototypeNamedProfile = g_EntityOutputs.ParseEntityOutputINI(`
binary = server
server_check = True
[function]
	[[constructor]]
		identifier_linux = symbol
		identifier_windows = 55 8B
		arguments_linux = ADDRESS
		arguments_windows = ADDRESS
`);

g_Assert.equal(Object.getPrototypeOf(g_PrototypeNamedProfile.Functions), null);
g_Assert.equal(Object.hasOwn(g_PrototypeNamedProfile.Functions, "Constructor"), true);
g_Assert.equal(g_PrototypeNamedProfile.Functions.Constructor.IdentifierLinux, "symbol");
g_Assert.throws(() => g_EntityOutputs.ParseEntityOutputINI(17), /must be a string/);
g_Assert.throws(() => g_EntityOutputs.ParseEntityOutputINI("binary = server"), /function section/);
g_Assert.throws(() => g_EntityOutputs.ParseEntityOutputINI("[function]\n[[fire_output]]\narguments_linux = UNKNOWN"), /Unknown memory type/);

g_Assert.equal(g_EntityOutputs.ClearEntityOutputDataCache(), true);
const g_ReloadedProfile = g_EntityOutputs.LoadEntityOutputData("l4d2");
g_Assert.notEqual(g_ReloadedProfile, g_FirstProfile);
g_Assert.notEqual(g_EntityOutputs.LoadEntityOutputData("tf2"), g_SharedOrangeBoxProfile);

g_MemoryManager.PLATFORM = "windows";
g_MemoryManager.ARCHITECTURE = "x86";

g_Assert.deepEqual(g_EntityOutputs.GetEntityFireOutputArguments("l4d2"), ["address", "uint", "uint", "uint", "uint", "uint", "address", "address", "float"]);
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputAddress("l4d2"), g_unFunctionAddress);
g_Assert.equal(typeof g_EntityOutputs.GetEntityFireOutputAddress("l4d2"), "bigint");
g_Assert.equal(g_vecResolveCalls.at(-1)[0], "server");
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2").Convention, "thiscall");
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2").ReturnType, "void");
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2", { CallerCleanup: true }).CallerCleanup, true);
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2", null), /must be an object/);
g_Assert.deepEqual(g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n), g_unValueAddress - g_unInlineVariantStackOffset), [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 2.5]);

for (const InvalidStackAddress of [undefined, null, 0, -1n, 0n, 0xFFFFFFFCn, 0x100000000n]) {
	g_Assert.throws(() => g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n), InvalidStackAddress), /StackAddress/);
}

g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputContext({ Arguments: CreateRawArguments(0x710000n) }), /StackAddress/);
g_Assert.equal(g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n), 0xFFFFFFFBn)[1], 0xFFFFFFFFn);
g_Assert.deepEqual(g_EntityOutputs.NormalizeEntityFireOutputArguments([0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 2.5]), [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 2.5]);
g_Assert.throws(() => g_EntityOutputs.NormalizeEntityFireOutputArguments(new Array(8).fill(0)), /9 raw values or 5 normalized values/);

g_MemoryManager.PLATFORM = "linux";
g_MemoryManager.ARCHITECTURE = "x86";

g_Assert.deepEqual(g_EntityOutputs.GetEntityFireOutputArguments("l4d2"), ["address", "address", "address", "address", "float"]);
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2").Convention, "cdecl");
g_Assert.deepEqual(g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n)), [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 2.5]);
g_Assert.throws(() => g_EntityOutputs.NormalizeEntityFireOutputArguments(new Array(9).fill(0)), /must contain 5 values/);

g_MemoryManager.ARCHITECTURE = "x64";
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2").Convention, "cdecl");
g_MemoryManager.PLATFORM = "windows";
g_Assert.equal(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2").Convention, "thiscall");
g_Assert.deepEqual(g_EntityOutputs.GetEntityFireOutputArguments("l4d2"), ["address", "address", "address", "address", "float"]);
g_Assert.deepEqual(g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n)), [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 2.5]);
g_Assert.throws(() => g_EntityOutputs.NormalizeEntityFireOutputArguments(new Array(9).fill(0)), /must contain 5 values/);

{
	const Descriptor = g_EntityOutputs.GetEntityFireOutputData("l4d2");
	const vecOriginalTypes = Descriptor.ArgumentsWindowsX64;
	try {
		delete Descriptor.ArgumentsWindowsX64;
		g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputArguments("l4d2"), /no WindowsX64 arguments/);
	} finally {
		Descriptor.ArgumentsWindowsX64 = vecOriginalTypes;
	}
}

g_Assert.equal(g_EntityOutputs.GetEntityFireOutputContext({ Arguments: CreateRawArguments(0x710000n), get StackAddress() { throw new Error("An indirect Variant must not read StackAddress."); } }).ValueAddress, g_unValueAddress);
g_MemoryManager.ARCHITECTURE = "x86_64";
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2"), /Unsupported SourceJS architecture/);
g_MemoryManager.ARCHITECTURE = "x86";

g_MemoryManager.PLATFORM = "unsupported";
g_Assert.throws(() => g_EntityOutputs.NormalizeEntityFireOutputArguments(CreateRawArguments(0x710000n)), /Unsupported SourceJS platform/);
g_MemoryManager.PLATFORM = "windows";

let g_unHookArgumentsReadCount = 0;
const g_HookPayload = {
	StackAddress: g_unValueAddress - g_unInlineVariantStackOffset,
	get Arguments() {
		g_unHookArgumentsReadCount += 1;

		return CreateRawArguments(0x710000n, 0.75);
	},
};
const g_Context = g_EntityOutputs.GetEntityFireOutputContext(g_HookPayload);
g_Assert.equal(g_unHookArgumentsReadCount, 1);
g_Assert.deepEqual(g_Context.Arguments, [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, 0.75]);
g_Assert.equal(g_Context.OutputName, "OnUser1");
g_Assert.equal(g_Context.OutputAddress, 0x710000n);
g_Assert.equal(g_Context.ValueAddress, g_unValueAddress);
g_Assert.equal(g_Context.Value.Value, "payload-value");
g_Assert.equal(g_Context.Activator.Index, 1);
g_Assert.equal(g_Context.Caller.Index, 2);
g_Assert.equal(g_Context.Delay, 0.75);
g_Assert.equal(g_LastOutputNameCaller, g_Context.Caller);
g_Assert.throws(() => g_EntityHelpers.FindEntityOutputNameByAddress(0x740000n, 0x710000n), /live caller entity/);
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0n, g_unValueAddress, 0x730000n, 0x740000n, 0.5] }), /non-zero BigInt output address/);
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0x710000n, g_unValueAddress, 0x730000n, 0x740000n, "0.5"] }), /finite number/);
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0x710000n, null, 0x730000n, 0x740000n, 0.5] }), /ValueAddress/);
g_Assert.throws(() => g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0x710000n, g_unValueAddress, 0x730000n, 0x750000n, 0.5] }), /Unknown entity address/);

const g_NullCallerContext = g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0x710000n, 0n, 0n, 0n, 0.5] });
g_Assert.equal(g_NullCallerContext.Caller, null);
g_Assert.equal(g_NullCallerContext.Activator, null);
g_Assert.equal(g_NullCallerContext.Value, null);
g_Assert.equal(g_NullCallerContext.OutputName, null);
g_Assert.equal(g_LastOutputNameCaller, g_Context.Caller);

{
	const strOriginalPlatform = g_MemoryManager.PLATFORM;
	try {
		for (const strRuntimePlatform of ["windows", "linux"]) {
			g_MemoryManager.PLATFORM = strRuntimePlatform;
			const WorldContext = g_EntityOutputs.GetEntityFireOutputContext({ Arguments: [0x710000n, 0n, g_unWorldEntityAddress, g_unWorldEntityAddress, 0.5] });
			g_Assert.equal(WorldContext.Caller.Index, 0);
			g_Assert.equal(WorldContext.Caller.ClassName, "worldspawn");
			g_Assert.equal(WorldContext.Caller.Address, g_unWorldEntityAddress);
			g_Assert.equal(WorldContext.Activator.Index, 0);
			g_Assert.equal(WorldContext.Activator.Address, g_unWorldEntityAddress);
			g_Assert.strictEqual(g_LastOutputNameCaller, WorldContext.Caller);
			g_Assert.equal(WorldContext.OutputName, null);
		}
	} finally {
		g_MemoryManager.PLATFORM = strOriginalPlatform;
	}
}

let g_unFirstCallbackCount = 0;
let g_unSecondCallbackCount = 0;
const g_FirstCallback = () => {
	g_unFirstCallbackCount += 1;
};
const g_SecondCallback = () => {
	g_unSecondCallbackCount += 1;
};
const g_FirstHook = g_EntityOutputs.CreateEntityFireOutputHook(g_FirstCallback, "l4d2");
const g_OriginalGetGlobalVariables = g_Globals.GetGlobalVariables;

g_Globals.GetGlobalVariables = () => {
	throw new Error("The active SDK branch must not be read while reusing a FireOutput hook.");
};

const g_SameHook = g_EntityOutputs.CreateEntityFireOutputHook(g_SecondCallback);

g_Globals.GetGlobalVariables = g_OriginalGetGlobalVariables;

g_Assert.equal(g_FirstHook, g_SameHook);
g_Assert.equal(g_FirstHook.PreCallbacks.size, 2);
DispatchOutput(0x710000n);
g_Assert.equal(g_unFirstCallbackCount, 1);
g_Assert.equal(g_unSecondCallbackCount, 1);
g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), true);
g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), false);
g_Assert.equal(g_mapHooks.size, 0);
g_Assert.throws(() => g_EntityOutputs.CreateEntityFireOutputHook("callback"), /must be a function/);

const g_RetryableHook = g_EntityOutputs.CreateEntityFireOutputHook(undefined, "l4d2");

g_bShouldFailNextHookRemoval = true;
g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), false);
g_Assert.equal(g_mapHooks.has(g_RetryableHook.ID), true);
g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), true);
g_Assert.equal(g_mapHooks.size, 0);

g_bShouldFailNextPreRegistration = true;
g_Assert.throws(() => g_EntityOutputs.CreateEntityFireOutputHook(() => {}, "l4d2"), /Unable to register/);
g_Assert.equal(g_mapHooks.size, 1);
g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), true);
g_Assert.equal(g_mapHooks.size, 0);

function VerifyManagedOutputInitializationFailure() {
	const ListenerModule = { exports: {} };
	const ExecuteListeners = new Function("require", "module", "exports", g_FileSystem.readFileSync(g_strListenersPath, "utf8"));
	const RejectRuntimeBridge = () => {
		throw new Error("Entity-output initialization must not register a low-level listener bridge.");
	};
	const Runtime = { AddListener: RejectRuntimeBridge, RemoveListener: RejectRuntimeBridge };
	ExecuteListeners((strModuleName) => {
		if (strModuleName === "entities/outputs") {
			return g_EntityOutputs;
		}

		g_Assert.equal(strModuleName, "internal/runtime");

		return {
			GetModule(strRuntimeModuleName) {
				g_Assert.equal(strRuntimeModuleName, "listeners");
				return Runtime;
			},
		};
	}, ListenerModule, ListenerModule.exports);
	const vecFailures = [];
	let unScenarioCount = 0;

	for (const strHookState of ["FRESH", "CACHED", "NATIVE"]) {
		const Manager = new ListenerModule.exports.EntityOutputListenerManager();
		const ListenerCallback = () => {};
		const ForeignCallback = () => {};
		let SharedHook = null;
		if (strHookState === "CACHED") {
			SharedHook = g_EntityOutputs.CreateEntityFireOutputHook(ForeignCallback, "l4d2");
		} else if (strHookState === "NATIVE") {
			SharedHook = CreateNativeHook(g_EntityOutputs.GetEntityFireOutputHookOptions("l4d2"));
			g_Assert.equal(SharedHook.Pre(ForeignCallback), true);
		}

		try {
			g_bShouldFailNextPreRegistration = true;
			g_Assert.throws(() => Manager.RegisterListener(ListenerCallback), /Unable to register/);
			g_Assert.equal(Manager.ListenerCount, 0, "Failed initialization must not retain the managed listener.");
			g_Assert.equal(Manager.Initialized, false, "Failed initialization must leave the manager uninitialized.");
			g_Assert.equal(Manager.EntityOutputHook, null, "Failed initialization must not publish a successful hook acquisition.");

			if (SharedHook !== null) {
				g_Assert.strictEqual(g_mapHooks.get(SharedHook.ID), SharedHook, "Failed initialization must preserve the existing shared hook.");
				g_Assert.deepEqual([...SharedHook.PreCallbacks], [ForeignCallback], "Failed initialization must preserve the foreign subscriber exactly.");
			} else {
				if (g_mapHooks.size !== 0) {
					vecFailures.push(new Error("Failed fresh EntityOutputListenerManager initialization retained an installed hook with no listeners."));
				}

				g_Assert.strictEqual(Manager.RegisterListener(ListenerCallback), ListenerCallback, "A failed acquisition must remain retryable.");
				g_Assert.equal(Manager.ListenerCount, 1);
				g_Assert.equal(Manager.EntityOutputHook.PreCallbacks.size, 1, "Retry must not duplicate the managed hook callback.");
				g_Assert.equal(Manager.UnregisterListener(ListenerCallback), true);
				g_Assert.equal(g_mapHooks.size, 0, "Successful retry teardown must release its hook.");
			}

			unScenarioCount += 1;
		} catch (ScenarioFailure) {
			vecFailures.push(ScenarioFailure);
		} finally {
			g_bShouldFailNextPreRegistration = false;

			if (g_mapHooks.size !== 0) {
				g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), true, "Release only this isolated fixture's shared hook.");
			}
		}
	}

	const vecRegistrationFailures = [new Error("Controlled pre-hook failure."), undefined, null, false, 0, ""];
	const vecCleanupModes = [
		{ Name: "SUCCESS" },
		{ Name: "FALSE" },
		{ Name: "THROW", Value: new Error("Controlled hook removal failure.") },
		{ Name: "THROW", Value: undefined },
		{ Name: "THROW", Value: false },
	];

	for (const RegistrationFailure of vecRegistrationFailures) {
		for (const CleanupMode of vecCleanupModes) {
			const Manager = new ListenerModule.exports.EntityOutputListenerManager();
			const ListenerCallback = () => {};
			const bCleanupSucceeded = CleanupMode.Name === "SUCCESS";
			const unCreatedHookID = g_unNextHookID;
			g_bThrowNextPreRegistration = true;
			g_PreRegistrationError = RegistrationFailure;
			g_bShouldFailNextHookRemoval = CleanupMode.Name === "FALSE";
			g_bThrowNextHookRemoval = CleanupMode.Name === "THROW";
			g_HookRemovalError = CleanupMode.Value;

			try {
				g_Assert.throws(() => Manager.RegisterListener(ListenerCallback), (Failure) => {
					if (bCleanupSucceeded) {
						g_Assert.strictEqual(Failure, RegistrationFailure, "Successful rollback must preserve even a falsy registration failure.");
						return true;
					}

					g_Assert.ok(Failure instanceof AggregateError);
					g_Assert.equal(Failure.errors.length, 2);
					g_Assert.strictEqual(Failure.errors[0], RegistrationFailure, "Registration failure must remain first.");

					if (CleanupMode.Name === "FALSE") {
						g_Assert.match(Failure.errors[1].message, /Unable to remove newly created entity output hook/);
					} else {
						g_Assert.strictEqual(Failure.errors[1], CleanupMode.Value, "Cleanup failure identity must be preserved, including falsy values.");
					}

					return true;
				});
				g_Assert.equal(Manager.ListenerCount, 0);
				g_Assert.equal(Manager.Initialized, false);
				g_Assert.equal(Manager.EntityOutputHook, null);
				g_Assert.equal(g_mapHooks.size, bCleanupSucceeded ? 0 : 1, "Attempt cleanup once; retain the hook only after cleanup failure.");

				if (!bCleanupSucceeded) {
					const RetainedHook = g_EntityOutputs.CreateEntityFireOutputHook(undefined, "l4d2");
					g_Assert.equal(RetainedHook.ID, unCreatedHookID, "Failed cleanup must retain the same cached hook for explicit recovery.");
					g_Assert.equal(RetainedHook.PreCallbacks.size, 0);
				}

				unScenarioCount += 1;
			} catch (ScenarioFailure) {
				vecFailures.push(ScenarioFailure);
			} finally {
				g_bThrowNextPreRegistration = false;
				g_bThrowNextHookRemoval = false;
				g_bShouldFailNextHookRemoval = false;
				g_PreRegistrationError = undefined;
				g_HookRemovalError = undefined;

				if (g_mapHooks.size !== 0) {
					g_Assert.equal(g_EntityOutputs.RemoveEntityFireOutputHook(), true);
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, 33, "All independent shared/fresh and opaque failure/cleanup scenarios must execute.");

	if (vecFailures.length !== 0) {
		throw new AggregateError(vecFailures, "Entity-output listener initialization cleanup regressions.");
	}

	console.log("[  OK  ] entity-output manager initialization: 33 fresh/shared/native reuse and opaque failure/cleanup scenarios passed; controlled native doubles only");
}

VerifyManagedOutputInitializationFailure();

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_DocumentedEntityOutputs = TrackModule(g_EntityOutputs, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 12);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator|do not edit this file/i);
g_Assert.doesNotMatch(g_strDocumentation, /console\.log\(result\)|addressString|payload\.skip|\bargs\b|make_object|get_object_pointer/);
g_Assert.match(g_strDocumentation, /hidden `CBaseEntityOutput\* this` address/);
g_Assert.match(g_strDocumentation, /\| Windows \| x86 \|/);
g_Assert.ok(g_strDocumentation.includes("| " + String.fromCharCode(96) + "StackAddress" + String.fromCharCode(96) + " | Borrowed native entry-stack address"), "The pre-hook payload contract must document StackAddress and its borrowed lifetime.");
g_Assert.match(g_strDocumentation, /\| Linux \| x86 \|/);
g_Assert.match(g_strDocumentation, /Returning a value other than .* from the pre-hook/);
g_Assert.match(g_strDocumentation, /CallHookTrampoline\(\{ Arguments, Registers, CallerCleanup \}\)/);
g_Assert.match(g_strDocumentation, /Listener return values do not suppress the engine output/);
g_Assert.ok(/world index \x600\x60 is valid, not the null sentinel/.test(g_strDocumentation), "The documentation must preserve the world entity at index zero.");

for (const strRelatedPath of [
	"entities-entity.md",
	"entities-datamaps.md",
	"entities-helpers.md",
	"listeners.md",
	"memory-hooks.md",
	"memory-manager.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

g_vecHookEvents.length = 0;

const g_vecDocumentationLogs = [];
const g_DocumentationLoggers = {
	LogInfo(strFormat, ...vecValues) {
		g_Assert.equal(typeof strFormat, "string");
		g_Assert.doesNotMatch(strFormat, /^\s*\[/, "Typed logger messages must not duplicate severity.");
		const strRendered = g_Util.format(strFormat, ...vecValues);
		g_vecDocumentationLogs.push({ Format: strFormat, Values: vecValues, Rendered: strRendered });
	},
};

for (const [strPlatform, strArchitecture] of [
	["windows", "x86"],
	["windows", "x64"],
	["linux", "x86"],
	["linux", "x64"],
]) {
	g_MemoryManager.PLATFORM = strPlatform;
	g_MemoryManager.ARCHITECTURE = strArchitecture;

	for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
		ExecuteDocumentationBlock(strSource, unIndex, { "entities/outputs": g_DocumentedEntityOutputs, listeners: g_HighLevelListeners, loggers: g_DocumentationLoggers });
	}
}

g_MemoryManager.PLATFORM = "windows";
g_MemoryManager.ARCHITECTURE = "x86";
g_Assert.equal(g_vecDocumentationLogs.length, 72, "All executable reporting examples must run on all four controlled ABI profiles.");
g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|info|warn|error)\s*\(/, "Documentation must use the typed logger.");
g_Assert.equal(g_vecDocumentationLogs.some(Record => Record.Format === "ObserveSecondEntityOutput Callback=Second"), false, "The removed second observer must not be invoked.");
g_Assert.equal(g_vecDocumentationLogs.filter(Record => Record.Format === "ReportEntityFireOutputResolution Result=%j").every(Record => Record.Values[0].FireOutputAddress === "0x501000"), true);
g_Assert.equal(g_vecDocumentationLogs.filter(Record => Record.Format === "VerifyNormalizedEntityFireOutputArguments Values=%j").every(Record => JSON.stringify(Record.Values[0]) === JSON.stringify(["0x710000", "0x720000", "0x730000", "0x740000", 0.25])), true);
g_Assert.equal(g_mapHooks.size, 0);
g_Assert.equal(g_vecListenerEvents.length, 4);
g_Assert.equal(g_setActiveEntityOutputListenerCallbacks.size, 0);

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/outputs.${strExportName}.`);
}

const g_unWindowsX86DelayArgumentIndex = 8;
g_Assert.equal(g_vecHookEvents.some((Event) => (Event.OutputName === "OnTrigger") && Event.ArgumentWrites.some(([unIndex, Value]) => (unIndex === g_unWindowsX86DelayArgumentIndex) && (Value === 1))), true);
g_Assert.equal(g_vecHookEvents.some((Event) => (Event.OutputName === "OnBreak") && Event.Blocked && (Event.OriginalCalls === 0)), true);
g_Assert.equal(g_vecHookEvents.some((Event) => (Event.OutputName === "OnUser2") && (Event.TrampolineCalls === 1) && (Event.OriginalCalls === 0)), true);
g_Assert.equal(g_vecHookEvents.some((Event) => !Event.Blocked && (Event.TrampolineCalls === 0) && (Event.OriginalCalls === 1)), true);

VerifyDocumentationValueReporting(g_vecDocumentationBlocks, g_DocumentedEntityOutputs, g_DocumentationLoggers);
VerifyDocumentationPartialHookInstallation(g_vecDocumentationBlocks);

const g_strOutputsSource = g_FileSystem.readFileSync(g_strOutputsPath, "utf8");
g_Assert.match(g_strOutputsSource, /return \[g_MemoryHelpersRuntime\.Type\.Address, \.\.\.vecArgumentTypes\]/);
g_Assert.match(g_strOutputsSource, /\(strRuntimePlatform === "windows"\) \? "thiscall" : "cdecl"/);
g_Assert.match(g_strOutputsSource, /const g_unWindowsX86RawArgumentCount = 9;/);
g_Assert.match(g_strOutputsSource, /const unNormalizedArgumentCount = 5;/);
g_Assert.match(g_strOutputsSource, /unArgumentValueCount === g_unWindowsX86RawArgumentCount/);
g_Assert.match(g_strOutputsSource, /unArgumentValueCount === unNormalizedArgumentCount/);
g_Assert.match(g_strOutputsSource, /unArgumentValueCount !== unNormalizedArgumentCount/);
g_Assert.doesNotMatch(g_strOutputsSource, /const delay = Number\(/);
g_Assert.doesNotMatch(g_strOutputsSource, /if \(value === null \|\| value === undefined\)/);

const g_strListenersSource = g_FileSystem.readFileSync(g_strListenersPath, "utf8");
const g_nNotifyStart = g_strListenersSource.indexOf("class EntityOutputListenerManager");
g_Assert.ok(g_nNotifyStart >= 0, "Entity-output listener source section start must exist.");

const g_nNotifyEnd = g_strListenersSource.indexOf("function CreateListenerDecoratorFactory", g_nNotifyStart);
g_Assert.ok(g_nNotifyEnd > g_nNotifyStart, "Entity-output listener source section end must follow its start.");

const g_strNotifySource = g_strListenersSource.slice(g_nNotifyStart, g_nNotifyEnd);
g_Assert.match(g_strNotifySource, /this\.NotifyListeners\(/);
g_Assert.doesNotMatch(g_strNotifySource, /return this\.NotifyListeners/);

for (const strModulePath of [
	g_strOutputsPath,
	g_strFilesystemPath,
	g_strGlobalsPath,
	g_strHooksPath,
	g_strMemoryHelpersPath,
	g_strMemoryManagerPath,
	g_strPathsPath,
	g_strDatamapsPath,
	g_strEntityPath,
	g_strEntityHelpersPath,
]) {
	delete require.cache[strModulePath];
}

delete globalThis.sourcejs;
g_Module._load = g_OriginalModuleLoad;
g_Assert.throws(() => require(g_strOutputsPath), /SourceJS native runtime is not installed/);

console.log("[  OK  ] entities/outputs API, hooks, and documentation passed with controlled doubles; native ABI execution not exercised");
