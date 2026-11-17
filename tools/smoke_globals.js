#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strPackagePath = g_Path.join(g_strRootPath, "packages", "sourcejs", "globals.js");
const g_strDocumentationPath = g_Path.join(g_strRootPath, "docs", "api", "globals.md");
const g_strNativeBindingsPath = g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_flMaximumFloat = 3.4028234663852886e38;
const g_nInt32Minimum = -2147483648;
const g_nInt32Maximum = 2147483647;

// This test double models a 64-bit native address space; production uses uintptr_t.
const g_unMaximumMockAddress = 0xFFFFFFFFFFFFFFFFn;
const g_unNetworkBaseTickInterval = 100;
const g_MapLoadType = Object.freeze({
	NEW_GAME: 0,
	LOAD_GAME: 1,
	TRANSITION: 2,
	BACKGROUND: 3,
});
const g_vecMandatoryProperties = [
	"Address",
	"RealTime",
	"FrameCount",
	"AbsoluteFrameTime",
	"CurrentTime",
	"FrameTime",
	"MaximumClients",
	"TickCount",
	"IntervalPerTick",
	"InterpolationAmount",
	"SaveRestoreDataAddress",
	"MapName",
	"MapVersion",
	"StartSpot",
	"MapLoadType",
	"IsDeathmatch",
	"IsCooperative",
	"IsTeamplay",
	"MaximumEntities",
];
const g_vecMandatoryWritableProperties = g_vecMandatoryProperties.filter((strPropertyName) => !["Address", "MapName", "StartSpot"].includes(strPropertyName));
const g_vecOptionalProperties = [
	"AbsoluteFrameStartTimeStandardDeviation",
	"ServerCount",
	"EdictArrayAddress",
	"MapGroupName",
	"SimulatedTicksThisFrame",
	"NetworkProtocol",
	"MapLoadFailed",
];
const g_vecGlobalWriteTraits = [
	"kSDKCanWriteGlobalAbsoluteFrameStartTimeStandardDeviation",
	"kSDKCanWriteGlobalServerCount",
	"kSDKCanWriteGlobalEdictArrayAddress",
	"kSDKCanWriteGlobalSimulatedTicksThisFrame",
	"kSDKCanWriteGlobalNetworkProtocol",
	"kSDKCanWriteGlobalMapLoadFailed",
];

function RequireFloat(strPropertyName, flValue) {
	if ((typeof flValue !== "number") || !Number.isFinite(flValue) || (flValue < -g_flMaximumFloat) || (flValue > g_flMaximumFloat)) {
		throw new Error(`globals.GetGlobalVariables().${strPropertyName} requires a finite float value.`);
	}

	return Math.fround(flValue);
}

function RequireInteger(strPropertyName, nValue) {
	if (!Number.isInteger(nValue) || (nValue < g_nInt32Minimum) || (nValue > g_nInt32Maximum)) {
		throw new Error(`globals.GetGlobalVariables().${strPropertyName} requires an exact integer value.`);
	}

	return nValue;
}

function RequireBoolean(strPropertyName, bValue) {
	if (typeof bValue !== "boolean") {
		throw new Error(`globals.GetGlobalVariables().${strPropertyName} requires a boolean value.`);
	}

	return bValue;
}

function RequireAddress(strPropertyName, unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress < 0n) || (unAddress > g_unMaximumMockAddress)) {
		throw new Error(`globals.GetGlobalVariables().${strPropertyName} requires a non-negative BigInt address value.`);
	}

	return unAddress;
}

function RequireLoadType(strPropertyName, nLoadType) {
	const vecLoadTypes = Object.values(g_MapLoadType);
	if (!Number.isInteger(nLoadType) || !vecLoadTypes.includes(nLoadType)) {
		throw new Error(`globals.GetGlobalVariables().${strPropertyName} requires a MapLoadType integer.`);
	}

	return nLoadType;
}

// This controlled SDK fixture models current-storage lookup and value validation.
// Method return values and descriptor attributes are fixture choices, not native SDK execution.
function RequireGlobalsState(Runtime) {
	const State = Runtime.State;
	if ((State === null) || (State === undefined)) {
		throw new Error("engines/server global variables are not available.");
	}

	return State;
}

function InstallProperty(Target, Runtime, strPropertyName, Options = {}) {
	const Descriptor = {
		configurable: false,
		enumerable: true,

		get() {
			const State = RequireGlobalsState(Runtime);

			return State[strPropertyName];
		},
	};

	if (typeof Options.Validate === "function") {
		Descriptor.set = (Value) => {
			const State = RequireGlobalsState(Runtime);
			State[strPropertyName] = Options.Validate(strPropertyName, Value);
		};
	}

	Object.defineProperty(Target, strPropertyName, Descriptor);
}

function CreateGlobalsState() {
	return {
		Address: 0x100000n,
		RealTime: Math.fround(145.25),
		FrameCount: 4000,
		AbsoluteFrameTime: Math.fround(0.016),
		AbsoluteFrameStartTimeStandardDeviation: Math.fround(0.001),
		CurrentTime: Math.fround(64.5),
		FrameTime: Math.fround(0.015),
		MaximumClients: 8,
		TickCount: 4300,
		IntervalPerTick: Math.fround(0.015),
		InterpolationAmount: Math.fround(0.25),
		SimulatedTicksThisFrame: 1,
		NetworkProtocol: 24,
		SaveRestoreDataAddress: 0x200000n,
		MapName: "c1m1_hotel",
		MapVersion: 1,
		StartSpot: "",
		MapLoadType: g_MapLoadType.NEW_GAME,
		MapLoadFailed: false,
		IsDeathmatch: false,
		IsCooperative: true,
		IsTeamplay: true,
		MaximumEntities: 2048,
		ServerCount: 3,
		EdictArrayAddress: 0x300000n,
		MapGroupName: "L4D2C1",
	};
}

function CreateInformationView(Runtime, bIncludeOptionalProperties) {
	const Information = {};
	const vecFloatProperties = [
		"RealTime",
		"AbsoluteFrameTime",
		"CurrentTime",
		"FrameTime",
		"IntervalPerTick",
		"InterpolationAmount",
	];
	const vecIntegerProperties = [
		"FrameCount",
		"MaximumClients",
		"TickCount",
		"MapVersion",
		"MaximumEntities",
	];
	const vecBooleanProperties = [
		"IsDeathmatch",
		"IsCooperative",
		"IsTeamplay",
	];

	Information.SDKBranch = "mock-sdk";
	InstallProperty(Information, Runtime, "Address");

	for (const strPropertyName of vecFloatProperties) {
		InstallProperty(Information, Runtime, strPropertyName, { Validate: RequireFloat });
	}

	for (const strPropertyName of vecIntegerProperties) {
		InstallProperty(Information, Runtime, strPropertyName, { Validate: RequireInteger });
	}

	InstallProperty(Information, Runtime, "SaveRestoreDataAddress", { Validate: RequireAddress });
	InstallProperty(Information, Runtime, "MapName");
	InstallProperty(Information, Runtime, "StartSpot");
	InstallProperty(Information, Runtime, "MapLoadType", { Validate: RequireLoadType });

	for (const strPropertyName of vecBooleanProperties) {
		InstallProperty(Information, Runtime, strPropertyName, { Validate: RequireBoolean });
	}

	if (bIncludeOptionalProperties) {
		InstallProperty(Information, Runtime, "AbsoluteFrameStartTimeStandardDeviation", { Validate: RequireFloat });
		InstallProperty(Information, Runtime, "ServerCount", { Validate: RequireInteger });
		InstallProperty(Information, Runtime, "EdictArrayAddress", { Validate: RequireAddress });
		InstallProperty(Information, Runtime, "MapGroupName");
		InstallProperty(Information, Runtime, "SimulatedTicksThisFrame", { Validate: RequireInteger });
		InstallProperty(Information, Runtime, "NetworkProtocol", { Validate: RequireInteger });
		InstallProperty(Information, Runtime, "MapLoadFailed", { Validate: RequireBoolean });
		Object.defineProperties(Information, {
			IsClient: {
				configurable: false,
				enumerable: true,
				value() {
					RequireGlobalsState(Runtime);

					return false;
				},
			},

			GetNetworkBase: {
				configurable: false,
				enumerable: true,
				value(nTick, nEntityIndex) {
					const nExactTick = RequireInteger("GetNetworkBase.nTick", nTick);
					const nExactEntityIndex = RequireInteger("GetNetworkBase.nEntityIndex", nEntityIndex);
					RequireGlobalsState(Runtime);

					return nExactTick - (nExactTick % g_unNetworkBaseTickInterval) + nExactEntityIndex;
				},
			},
		});

		Object.defineProperty(Information, "IsRemoteClient", {
			configurable: false,
			enumerable: true,
			value() {
				RequireGlobalsState(Runtime);

				return true;
			},
		});
	}

	return Information;
}

function CreateNativeGlobals(Options = {}) {
	const bIncludeOptionalProperties = Options.IncludeOptionalProperties !== false;
	const Runtime = { State: CreateGlobalsState(), Module: null };
	Runtime.Module = {
		MapLoadType: g_MapLoadType,

		GetGlobalVariables() {
			return CreateInformationView(Runtime, bIncludeOptionalProperties);
		},
	};

	return Runtime;
}

// Each load owns a fresh bridge/dependency scope and restores the caller's exact state.
function LoadGlobals(NativeGlobals = undefined) {
	const OriginalGlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const OriginalModuleLoad = g_Module._load;
	const vecCachePaths = [g_strPackagePath, g_strRuntimePath];
	const mapOriginalCacheEntries = new Map(vecCachePaths.map((strPath) => [strPath, require.cache[strPath]]));

	try {
		for (const strPath of vecCachePaths) {
			delete require.cache[strPath];
		}

		if (NativeGlobals === undefined) {
			delete globalThis.sourcejs;
		} else {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { globals: NativeGlobals } });
		}

		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strPackagePath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		for (const [strPath, CacheEntry] of mapOriginalCacheEntries) {
			delete require.cache[strPath];

			if (CacheEntry !== undefined) {
				require.cache[strPath] = CacheEntry;
			}
		}

		if (OriginalGlobalDescriptor === undefined) {
			delete globalThis.sourcejs;
		} else {
			Object.defineProperty(globalThis, "sourcejs", OriginalGlobalDescriptor);
		}
	}
}

const g_RejectDocumentationConsole = () => {
	throw new Error("Global documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

function CreateDocumentationRequire(Globals, LogInfo) {
	return function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "globals") {
			return Globals;
		}

		if (strModuleName === "loggers") {
			return { LogInfo };
		}

		throw new Error(`Unexpected documentation module: ${strModuleName}`);
	};
}

function VerifyDocumentationRequireContracts() {
	const Globals = {};
	const vecCalls = [];
	const LogInfo = (...vecArguments) => vecCalls.push(vecArguments);
	const DocumentationRequire = CreateDocumentationRequire(Globals, LogInfo);
	g_Assert.strictEqual(DocumentationRequire("globals"), Globals);
	g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
	DocumentationRequire("loggers").LogInfo("GlobalProbe Count=%d", 1);
	g_Assert.deepEqual(vecCalls, [["GlobalProbe Count=%d", 1]]);
	g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
	g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
}

function ExtractDocumentationBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function CreateGlobalWriteDocumentationRunner(strExample, bCaptureOverrideState) {
	if (!bCaptureOverrideState) {
		return new Function("require", "console", strExample);
	}

	const strInvocationMarker = "\ntry {\n\tBeginCurrentTimeOverride();";
	const nInvocationStart = strExample.indexOf(strInvocationMarker);
	g_Assert(nInvocationStart >= 0);
	const strObservedExample = strExample.slice(0, nInvocationStart) + "\ntry {\n" + strExample.slice(nInvocationStart) + "\n} finally {\nCaptureOverrideState(g_bCurrentTimeOverrideActive);\n}";

	return new Function("require", "console", "CaptureOverrideState", strObservedExample);
}

function RunGlobalWriteDocumentationScenario(RunExample, Specification, PrimaryCase, strCleanupMode, bIncludeOptionalProperties) {
	const unReplacementAddressDelta = 0x1000n;

	const Runtime = CreateNativeGlobals({ IncludeOptionalProperties: bIncludeOptionalProperties });
	const InitialView = Runtime.Module.GetGlobalVariables();
	const vecProperties = [...Specification.Properties, ...(Specification.OptionalProperties ?? []).filter(strName => Object.hasOwn(InitialView, strName))];
	const PreviousValues = Object.fromEntries(vecProperties.map(strName => [strName, InitialView[strName]]));
	const CleanupFailure = new Error("Controlled global restoration failure.");
	const vecMainWrites = [];
	const vecRestoreWrites = [];
	let ReplacementSnapshot = null;
	let CapturedFailure = null;
	let bRestoring = false;
	let bOverrideStateObserved = false;
	let bOverrideActiveAfterRun = false;
	const CaptureOverrideState = bActive => {
		bOverrideStateObserved = true;
		bOverrideActiveAfterRun = bActive;
	};
	const DocumentationGlobals = {
		...Runtime.Module,
		GetGlobalVariables() {
			return new Proxy(Runtime.Module.GetGlobalVariables(), {
				get(Target, strPropertyName, Receiver) {
					const Value = Reflect.get(Target, strPropertyName, Receiver);
					if (!bRestoring && (vecMainWrites.length === vecProperties.length) && (strPropertyName === vecProperties[vecProperties.length - 1])) {
						bRestoring = true;
					}

					return Value;
				},
				set(Target, strPropertyName, Value, Receiver) {
					g_Assert(vecProperties.includes(strPropertyName));

					if (bRestoring) {
						vecRestoreWrites.push(strPropertyName);

						if (strPropertyName === Specification.FailureProperty) {
							if (strCleanupMode === "THROWS") {
								throw CleanupFailure;
							}

							if (strCleanupMode === "IGNORE") {
								return true;
							}
						}

						return Reflect.set(Target, strPropertyName, Value, Receiver);
					}

					g_Assert.equal(Reflect.set(Target, strPropertyName, Value, Receiver), true);
					vecMainWrites.push(strPropertyName);

					if (PrimaryCase.Throws && (strPropertyName === Specification.FailureProperty)) {
						if (PrimaryCase.ReplaceStorage) {
							const unNewAddress = Runtime.State.Address + unReplacementAddressDelta;
							Runtime.State = { ...CreateGlobalsState(), Address: unNewAddress };
							ReplacementSnapshot = { ...Runtime.State };
						}

						bRestoring = true;
						throw PrimaryCase.Value;
					}

					return true;
				},
			});
		},
	};
	const DocumentationRequire = CreateDocumentationRequire(DocumentationGlobals, () => undefined);
	try {
		if (Specification.ProtectsActiveOverride) {
			RunExample(DocumentationRequire, g_ConsoleDouble, CaptureOverrideState);
		} else {
			RunExample(DocumentationRequire, g_ConsoleDouble);
		}
	} catch (Failure) {
		CapturedFailure = { Value: Failure };
	}

	if (Specification.ProtectsActiveOverride) {
		g_Assert.equal(bOverrideStateObserved, true);
		g_Assert.equal(bOverrideActiveAfterRun, Boolean(PrimaryCase.ReplaceStorage) || (strCleanupMode !== "SUCCESS"), "Failed restoration must retain the active override state.");
	}

	if (PrimaryCase.ReplaceStorage) {
		g_Assert.notEqual(CapturedFailure, null);
		g_Assert(CapturedFailure.Value instanceof AggregateError);
		g_Assert.equal(CapturedFailure.Value.errors.length, vecProperties.length + 1);
		g_Assert.strictEqual(CapturedFailure.Value.errors[0], PrimaryCase.Value);
		for (const Failure of CapturedFailure.Value.errors.slice(1)) {
			g_Assert(Failure instanceof Error);
			g_Assert.match(Failure.message, /storage changed/);
		}

		g_Assert.deepEqual(vecRestoreWrites, [], "No captured value may be restored into replacement native storage.");
		g_Assert.deepEqual(Runtime.State, ReplacementSnapshot);
	} else {
		g_Assert.deepEqual(vecRestoreWrites, [...vecProperties].reverse(), "Every captured field must receive an independent reverse-order restoration attempt.");
		for (const strPropertyName of vecProperties) {
			if ((strCleanupMode === "SUCCESS") || (strPropertyName !== Specification.FailureProperty)) {
				g_Assert.strictEqual(Runtime.State[strPropertyName], PreviousValues[strPropertyName]);
			}
		}

		const unExpectedFailureCount = Number(PrimaryCase.Throws) + Number(strCleanupMode !== "SUCCESS");
		if (unExpectedFailureCount === 0) {
			g_Assert.equal(CapturedFailure, null);
		} else {
			g_Assert.notEqual(CapturedFailure, null);
			let PrimaryFailure = CapturedFailure.Value;
			let ReportedCleanupFailure = CapturedFailure.Value;
			if (unExpectedFailureCount === 2) {
				g_Assert(CapturedFailure.Value instanceof AggregateError);
				g_Assert.equal(CapturedFailure.Value.errors.length, unExpectedFailureCount);
				PrimaryFailure = CapturedFailure.Value.errors[0];
				ReportedCleanupFailure = CapturedFailure.Value.errors[1];
			}

			if (PrimaryCase.Throws) {
				g_Assert.strictEqual(PrimaryFailure, PrimaryCase.Value);
			}

			if (strCleanupMode === "THROWS") {
				g_Assert.strictEqual(ReportedCleanupFailure, CleanupFailure);
			} else if (strCleanupMode === "IGNORE") {
				g_Assert(ReportedCleanupFailure instanceof Error);
				g_Assert.match(ReportedCleanupFailure.message, /restoration failed/);
			}
		}
	}
}

function VerifyExistingGlobalOverrideOwnership(strExample, bIncludeOptionalProperties) {
	const Runtime = CreateNativeGlobals({ IncludeOptionalProperties: bIncludeOptionalProperties });
	const flPreviousCurrentTime = Runtime.State.CurrentTime;
	const strAddressLiteral = "0x" + Runtime.State.Address.toString(16).toUpperCase() + "n";
	let strExistingSource = strExample.replace("let g_flPreviousCurrentTime = 0;", "let g_flPreviousCurrentTime = " + String(flPreviousCurrentTime) + ";");
	strExistingSource = strExistingSource.replace("let g_unCurrentTimeOverrideAddress = 0n;", "let g_unCurrentTimeOverrideAddress = " + strAddressLiteral + ";");
	strExistingSource = strExistingSource.replace("let g_bCurrentTimeOverrideActive = false;", "let g_bCurrentTimeOverrideActive = true;");
	g_Assert(strExistingSource !== strExample);
	Runtime.State.CurrentTime = 0;
	const ExistingState = { ...Runtime.State };
	const RunExistingExample = CreateGlobalWriteDocumentationRunner(strExistingSource, true);
	let bOverrideStateObserved = false;
	let bOverrideActiveAfterRun = false;
	const CaptureOverrideState = bActive => {
		bOverrideStateObserved = true;
		bOverrideActiveAfterRun = bActive;
	};
	const DocumentationRequire = CreateDocumentationRequire(Runtime.Module, () => undefined);
	g_Assert.throws(() => RunExistingExample(DocumentationRequire, g_ConsoleDouble, CaptureOverrideState), /already active/);
	g_Assert.equal(bOverrideStateObserved, true);
	g_Assert.equal(bOverrideActiveAfterRun, true);
	g_Assert.deepEqual(Runtime.State, ExistingState, "A failed duplicate begin must not release a previous owner's override.");
}

function VerifyGlobalWriteDocumentationCleanup(vecExamples) {
	const unExpectedScenarioCount = 162;
	const vecSpecifications = [
		{ Name: "g_InspectLiveGlobalVariables", FailureProperty: "CurrentTime", Properties: ["CurrentTime"] },
		{
			Name: "g_VerifyTemporaryGlobalTiming",
			FailureProperty: "CurrentTime",
			Properties: [
				"AbsoluteFrameTime",
				"CurrentTime",
				"FrameTime",
				"InterpolationAmount",
				"IntervalPerTick",
				"RealTime",
			],
		},
		{
			Name: "g_VerifyTemporaryGlobalIntegers",
			FailureProperty: "TickCount",
			Properties: [
				"FrameCount",
				"MapVersion",
				"MaximumClients",
				"MaximumEntities",
				"TickCount",
			],
			OptionalProperties: [
				"NetworkProtocol",
				"ServerCount",
				"SimulatedTicksThisFrame",
			],
		},
		{
			Name: "g_VerifyTemporaryGlobalModes",
			FailureProperty: "MapLoadType",
			Properties: [
				"IsCooperative",
				"IsDeathmatch",
				"IsTeamplay",
				"MapLoadType",
			],
			OptionalProperties: ["MapLoadFailed"],
		},
		{ Name: "g_GlobalVariables", FailureProperty: "CurrentTime", Properties: ["CurrentTime"], ProtectsActiveOverride: true },
	];
	let unScenarioCount = 0;
	for (const bIncludeOptionalProperties of [true, false]) {
		for (const Specification of vecSpecifications) {
			const strExample = vecExamples.find(strSource => strSource.includes("const " + Specification.Name + " ="));
			g_Assert.equal(typeof strExample, "string");
			const RunExample = CreateGlobalWriteDocumentationRunner(strExample, Boolean(Specification.ProtectsActiveOverride));
			if (Specification.ProtectsActiveOverride) {
				VerifyExistingGlobalOverrideOwnership(strExample, bIncludeOptionalProperties);
				++unScenarioCount;
			}

			const vecPrimaryCases = [
				{ Throws: false },
				...[
					new Error("Controlled global write failure."),
					null,
					undefined,
					0,
				].map(Value => ({ Throws: true, Value })),
				{ Throws: true, Value: new Error("Controlled global storage replacement."), ReplaceStorage: true },
			];
			for (const PrimaryCase of vecPrimaryCases) {
				for (const strCleanupMode of PrimaryCase.ReplaceStorage ? ["SUCCESS"] : ["SUCCESS", "THROWS", "IGNORE"]) {
					RunGlobalWriteDocumentationScenario(RunExample, Specification, PrimaryCase, strCleanupMode, bIncludeOptionalProperties);
					++unScenarioCount;
				}
			}
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
}

function GetGlobalsNativeFunctionRegion(strGlobalsBlock, strFunctionName) {
	const strSource = strGlobalsBlock.replace(/\r\n/g, "\n");
	const vecDefinition = new RegExp("^(\\t{1,2})[^\\t\\n]*\\b" + strFunctionName + "\\([^\\n]*\\) \\{$", "m").exec(strSource);
	g_Assert(vecDefinition, "Missing native globals function: " + strFunctionName);
	const strTerminator = "\n" + vecDefinition[1] + "}";
	const nEnd = strSource.indexOf(strTerminator, vecDefinition.index);
	g_Assert(nEnd > vecDefinition.index, "Missing native globals function end: " + strFunctionName);

	return { Source: strSource, Start: vecDefinition.index, End: nEnd + strTerminator.length, Indentation: vecDefinition[1] };
}

function GetGlobalsNativeFunction(strGlobalsBlock, strFunctionName) {
	const Region = GetGlobalsNativeFunctionRegion(strGlobalsBlock, strFunctionName);

	// Normalize only a behavioral view; keep actual source regions for mutations.
	return Region.Source.slice(Region.Start, Region.End).split("\n").map((strLine) => strLine.startsWith(Region.Indentation) ? ("\t" + strLine.slice(Region.Indentation.length)) : strLine).join("\n");
}

function ReplaceGlobalsNativeFunction(strGlobalsBlock, strFunctionName, strBody) {
	const Region = GetGlobalsNativeFunctionRegion(strGlobalsBlock, strFunctionName);
	const strReplacement = strBody.split("\n").map((strLine) => strLine.startsWith("\t") ? (Region.Indentation + strLine.slice(1)) : strLine).join("\n");

	return Region.Source.slice(0, Region.Start) + strReplacement + Region.Source.slice(Region.End);
}

function VerifyNativeGlobalsAddressValidator(strGlobalsBlock) {
	const strValidator = GetGlobalsNativeFunction(strGlobalsBlock, "GetGlobalVariablesAddressFromValue");
	g_Assert.match(strValidator, /LocalValue\.IsEmpty\(\) \|\| !LocalValue->IsBigInt\(\)/);
	g_Assert.match(strValidator, /const std::uint64_t unAddressValue = LocalValue\.As<v8::BigInt>\(\)->Uint64Value\(&bLossless\)/);
	g_Assert.match(strValidator, /!bLossless \|\| \(unAddressValue > std::numeric_limits<std::uintptr_t>::max\(\)\)/);
	g_Assert.match(strValidator, /unAddressOut = static_cast<std::uintptr_t>\(unAddressValue\)/);
	g_Assert.doesNotMatch(strValidator, /IsNumber|NumberValue|k(?:SourceJSMaxSafeInteger|MaximumSafeNumberInteger)/);
}

function VerifyGlobalVariableNativeContracts(strGlobalsBlock) {
	const nFirstReader = strGlobalsBlock.indexOf("bool ReadGlobalVariablesAbsoluteFrameStartTimeStandardDeviation(");
	g_Assert(nFirstReader >= 0, "The first globals reader must exist.");
	for (const strTrait of g_vecGlobalWriteTraits) {
		const nTrait = strGlobalsBlock.indexOf("constexpr bool " + strTrait + " = requires(");
		g_Assert((nTrait >= 0) && (nTrait < nFirstReader), "SDK write-availability traits must precede globals implementations.");
	}

	for (const vecCallback of [
		["GetGlobalVariablesInformationPropertyCallback", "read"],
		["SetGlobalVariablesInformationPropertyValueCallback", "write"],
	]) {
		const strCallback = GetGlobalsNativeFunction(strGlobalsBlock, vecCallback[0]);
		const nGuard = strCallback.indexOf("if (!pIsolate");
		const nTry = strCallback.indexOf("try {");
		const nMetadata = strCallback.indexOf("CallbackInformation.Data()");
		const nLookup = strCallback.indexOf("RequireEngineGlobalVariables(");
		const nDispatch = strCallback.indexOf("switch (PropertyInformation)");
		const nCatch = strCallback.indexOf("} catch (...) {");
		g_Assert((nGuard >= 0) && (nTry > nGuard) && (nMetadata > nTry) && (nLookup > nMetadata) && (nDispatch > nLookup) && (nCatch > nDispatch), "Property preparation and dispatch must remain inside a catch-all C++ boundary after the isolate guard.");
		g_Assert(strCallback.includes('"globals.GetGlobalVariables() property ' + vecCallback[1] + ' failed with a native C++ exception."'), "Property failure diagnostics must distinguish reads and writes.");
		g_Assert(strCallback.includes("\n\t\t} catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), "A property callback must translate every C++ exception.");

		if (vecCallback[1] === "write") {
			g_Assert(strCallback.indexOf("GetCurrentContext()") > nTry, "Setter context preparation must be inside the C++ boundary.");
		}
	}

	for (const vecOutput of [
		["ReadGlobalVariablesServerCount", "nServerCountOut"],
		["ReadGlobalVariablesEdictArrayAddress", "unEdictArrayAddressOut"],
		["ReadGlobalVariablesMapGroupName", "strMapGroupNameOut"],
		["ReadGlobalVariablesRemoteClientState", "bRemoteClientOut"],
		["ReadGlobalVariablesSimulatedTicksThisFrame", "nSimulatedTicksThisFrameOut"],
		["ReadGlobalVariablesNetworkProtocol", "nNetworkProtocolOut"],
		["ReadGlobalVariablesMapLoadFailed", "bMapLoadFailedOut"],
		["ReadGlobalVariablesClientState", "bIsClientOut"],
	]) {
		const strHelper = GetGlobalsNativeFunction(strGlobalsBlock, vecOutput[0]);
		const nSupported = strHelper.indexOf("if constexpr (");
		const nCommit = strHelper.indexOf(vecOutput[1] + " = ");
		g_Assert((nSupported >= 0) && (nCommit > nSupported), "SDK-dependent outputs must be committed only on the supported success path.");
		g_Assert(!strHelper.includes(vecOutput[1] + ".clear()"), "An unsupported SDK member must not clear its output.");
	}

	const strReadDeviation = GetGlobalsNativeFunction(strGlobalsBlock, "ReadGlobalVariablesAbsoluteFrameStartTimeStandardDeviation");
	g_Assert(strReadDeviation.includes("flValueOut = pGlobalVariables->absoluteframestarttimestddev;\n\t\t\treturn true;"), "A single action and early return must remain adjacent.");
}

VerifyDocumentationRequireContracts();

const g_FullRuntime = CreateNativeGlobals();
const g_Globals = LoadGlobals(g_FullRuntime.Module);
const g_FirstInformation = g_Globals.GetGlobalVariables();
const g_SecondInformation = g_Globals.GetGlobalVariables();

g_Assert.strictEqual(g_Globals, g_FullRuntime.Module);
g_Assert.deepEqual(Object.keys(g_Globals).sort(), ["GetGlobalVariables", "MapLoadType"]);
g_Assert.deepEqual(g_Globals.MapLoadType, {
	BACKGROUND: 3,
	LOAD_GAME: 1,
	NEW_GAME: 0,
	TRANSITION: 2,
});
g_Assert.notStrictEqual(g_FirstInformation, g_SecondInformation);

for (const strPropertyName of g_vecMandatoryProperties) {
	g_Assert.equal(Object.hasOwn(g_FirstInformation, strPropertyName), true, `globals.GetGlobalVariables() must expose ${strPropertyName}`);
}

for (const strPropertyName of g_vecMandatoryWritableProperties) {
	const Descriptor = Object.getOwnPropertyDescriptor(g_FirstInformation, strPropertyName);
	g_Assert.equal(typeof Descriptor.get, "function", `${strPropertyName} must be a live getter`);
	g_Assert.equal(typeof Descriptor.set, "function", `${strPropertyName} must be a live setter`);
}

for (const strPropertyName of [
	"Address",
	"MapName",
	"StartSpot",
]) {
	const Descriptor = Object.getOwnPropertyDescriptor(g_FirstInformation, strPropertyName);
	g_Assert.equal(typeof Descriptor.get, "function", `${strPropertyName} must be a live getter`);
	g_Assert.equal(Descriptor.set, undefined, `${strPropertyName} must be read-only`);
}

for (const strPropertyName of g_vecOptionalProperties) {
	g_Assert.equal(Object.hasOwn(g_FirstInformation, strPropertyName), true, `maximum globals.GetGlobalVariables() surface must expose ${strPropertyName}`);
}

g_Assert.equal(typeof g_FirstInformation.IsClient, "function");
g_Assert.equal(typeof g_FirstInformation.GetNetworkBase, "function");
g_Assert.equal(typeof g_FirstInformation.IsRemoteClient, "function");
g_Assert.equal(g_FirstInformation.IsClient(), false);
g_Assert.equal(g_FirstInformation.IsRemoteClient(), true);
g_Assert.equal(g_FirstInformation.GetNetworkBase(4372, 5), 4305);
g_Assert.equal(typeof g_FirstInformation.Address, "bigint");
g_Assert.equal(g_FirstInformation.Address, g_FullRuntime.State.Address);

for (const strPropertyName of ["SaveRestoreDataAddress", "EdictArrayAddress"]) {
	const unOriginalAddress = g_FirstInformation[strPropertyName];
	try {
		for (const unAddress of [0n, 0xFEDCBA9876543210n, g_unMaximumMockAddress]) {
			g_FirstInformation[strPropertyName] = unAddress;
			g_Assert.equal(typeof g_FirstInformation[strPropertyName], "bigint");
			g_Assert.equal(g_SecondInformation[strPropertyName], unAddress);
		}
	} finally {
		g_FirstInformation[strPropertyName] = unOriginalAddress;
	}

	for (const InvalidAddress of [
		-1n,
		g_unMaximumMockAddress + 1n,
		0,
		1,
		1.5,
		"1",
		false,
		null,
		undefined,
		Object(1n),
	]) {
		g_Assert.throws(() => {
			g_FirstInformation[strPropertyName] = InvalidAddress;
		}, { name: "Error", message: `globals.GetGlobalVariables().${strPropertyName} requires a non-negative BigInt address value.` });
		g_Assert.equal(g_SecondInformation[strPropertyName], unOriginalAddress, "Rejected address writes must not change shared state.");
	}
}

const g_InitialState = { ...g_FullRuntime.State };
const g_ReplacementValues = {
	RealTime: 150.5,
	FrameCount: 4100,
	AbsoluteFrameTime: 0.02,
	AbsoluteFrameStartTimeStandardDeviation: 0.002,
	CurrentTime: 70.25,
	FrameTime: 0.02,
	MaximumClients: 16,
	TickCount: 4500,
	IntervalPerTick: 0.02,
	InterpolationAmount: 0.5,
	SimulatedTicksThisFrame: 2,
	NetworkProtocol: 25,
	SaveRestoreDataAddress: 0x210000n,
	MapVersion: 2,
	MapLoadType: g_MapLoadType.TRANSITION,
	MapLoadFailed: true,
	IsDeathmatch: true,
	IsCooperative: false,
	IsTeamplay: false,
	MaximumEntities: 4096,
	ServerCount: 4,
	EdictArrayAddress: 0x310000n,
};

try {
	for (const vecReplacementEntry of Object.entries(g_ReplacementValues)) {
		const strPropertyName = vecReplacementEntry[0];
		const Value = vecReplacementEntry[1];
		g_FirstInformation[strPropertyName] = Value;
		g_Assert.equal(g_SecondInformation[strPropertyName], g_FullRuntime.State[strPropertyName], `${strPropertyName} must share backing state`);
	}
} finally {
	for (const strPropertyName of g_vecMandatoryWritableProperties.concat(g_vecOptionalProperties.filter((strOptionalPropertyName) => strOptionalPropertyName !== "MapGroupName"))) {
		g_FirstInformation[strPropertyName] = g_InitialState[strPropertyName];
	}
}

g_Assert.deepEqual(g_FullRuntime.State, g_InitialState);
g_Assert.throws(() => {
	"use strict";
	g_FirstInformation.Address = 5n;
}, TypeError);
g_Assert.throws(() => {
	"use strict";
	g_FirstInformation.MapName = "other_map";
}, TypeError);
g_Assert.throws(() => {
	"use strict";
	g_FirstInformation.StartSpot = "landmark";
}, TypeError);

const g_vecInvalidPropertyEntries = [
	["CurrentTime", "1"],
	["CurrentTime", Number.NaN],
	["CurrentTime", Number.POSITIVE_INFINITY],
	["CurrentTime", g_flMaximumFloat * 2],
	["TickCount", 1.5],
	["TickCount", g_nInt32Maximum + 1],
	["MapLoadFailed", 1],
	["MapLoadType", -1],
	["MapLoadType", 4],
	["SaveRestoreDataAddress", -1n],
	["SaveRestoreDataAddress", 1.5],
	["SaveRestoreDataAddress", 1],
	["EdictArrayAddress", g_unMaximumMockAddress + 1n],
];
for (const vecInvalidPropertyEntry of g_vecInvalidPropertyEntries) {
	const strPropertyName = vecInvalidPropertyEntry[0];
	const InvalidValue = vecInvalidPropertyEntry[1];
	g_Assert.throws(() => {
		g_FirstInformation[strPropertyName] = InvalidValue;
	}, { name: "Error" }, `${strPropertyName} must reject ${String(InvalidValue)}`);
}

g_Assert.throws(() => g_FirstInformation.GetNetworkBase("4300", 1), { name: "Error" });
g_Assert.throws(() => g_FirstInformation.GetNetworkBase(4300, 1.5), { name: "Error" });
g_Assert.deepEqual(g_FullRuntime.State, g_InitialState);

const g_RetainedGlobalsState = g_FullRuntime.State;
const g_unBorrowedGlobalsAddress = g_FirstInformation.Address;
const g_flCapturedCurrentTime = g_FirstInformation.CurrentTime;
const g_ReplacedGlobalsState = { ...g_InitialState, Address: 0x400000n, CurrentTime: Math.fround(123.75) };
const g_UnavailableGlobalsError = { name: "Error", message: "engines/server global variables are not available." };
try {
	g_FullRuntime.State = g_ReplacedGlobalsState;

	g_Assert.equal(g_FirstInformation.Address, g_ReplacedGlobalsState.Address, "retained accessors must follow replacement current storage");
	g_Assert.equal(g_SecondInformation.CurrentTime, g_ReplacedGlobalsState.CurrentTime);
	g_Assert.equal(g_unBorrowedGlobalsAddress, g_RetainedGlobalsState.Address, "a copied address remains a borrowed snapshot");
	g_Assert.equal(g_flCapturedCurrentTime, g_RetainedGlobalsState.CurrentTime, "copied scalar values remain snapshots");

	for (const flValue of [0.1, Number.MIN_VALUE, -Number.MIN_VALUE, -3.125]) {
		g_FirstInformation.CurrentTime = flValue;
		g_Assert.equal(g_SecondInformation.CurrentTime, Math.fround(flValue), "current-state setters must round to native float");
	}

	g_Assert.deepEqual(g_RetainedGlobalsState, g_InitialState, "writes through retained views must not alter replaced storage");

	g_FullRuntime.State = null;
	const UnavailableInformation = g_Globals.GetGlobalVariables("ignored");
	g_Assert.equal(UnavailableInformation.SDKBranch, "mock-sdk", "view installation and metadata do not require current storage");

	for (const strPropertyName of g_vecMandatoryProperties.concat(g_vecOptionalProperties)) {
		g_Assert.throws(() => UnavailableInformation[strPropertyName], g_UnavailableGlobalsError, "live getters must fail without current storage: " + strPropertyName);

		const Descriptor = Object.getOwnPropertyDescriptor(UnavailableInformation, strPropertyName);
		if (typeof Descriptor.set === "function") {
			g_Assert.throws(() => {
				UnavailableInformation[strPropertyName] = g_InitialState[strPropertyName];
			}, g_UnavailableGlobalsError, "live setters must fail without current storage: " + strPropertyName);
		}
	}

	g_Assert.throws(() => g_FirstInformation.CurrentTime, g_UnavailableGlobalsError);
	g_Assert.throws(() => UnavailableInformation.IsClient(), g_UnavailableGlobalsError);
	g_Assert.throws(() => UnavailableInformation.IsRemoteClient(), g_UnavailableGlobalsError);
	g_Assert.throws(() => UnavailableInformation.GetNetworkBase(4300, 1), g_UnavailableGlobalsError);
	g_Assert.throws(() => UnavailableInformation.GetNetworkBase("4300", 1), { name: "Error", message: "globals.GetGlobalVariables().GetNetworkBase.nTick requires an exact integer value." });
} finally {
	g_FullRuntime.State = g_RetainedGlobalsState;
}

g_Assert.deepEqual(g_FullRuntime.State, g_InitialState);
g_Assert.equal(g_FirstInformation.Address, g_unBorrowedGlobalsAddress, "retained accessors must follow restored current storage");

const g_ReducedRuntime = CreateNativeGlobals({ IncludeOptionalProperties: false });
const g_ReducedGlobals = LoadGlobals(g_ReducedRuntime.Module);
const g_ReducedInformation = g_ReducedGlobals.GetGlobalVariables();

g_Assert.deepEqual(Object.keys(g_ReducedGlobals).sort(), ["GetGlobalVariables", "MapLoadType"]);

for (const strPropertyName of g_vecOptionalProperties) {
	g_Assert.equal(Object.hasOwn(g_ReducedInformation, strPropertyName), false, `reduced selected-SDK surface must omit ${strPropertyName}`);
}

for (const strMethodName of [
	"IsClient",
	"GetNetworkBase",
	"IsRemoteClient",
]) {
	g_Assert.equal(Object.hasOwn(g_ReducedInformation, strMethodName), false, "reduced SDK fixture must omit " + strMethodName);
}

const g_DocumentationRuntime = CreateNativeGlobals();
const g_DocumentationGlobals = LoadGlobals(g_DocumentationRuntime.Module);
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecExamples = ExtractDocumentationBlocks(g_strDocumentation);

g_Assert.equal(g_vecExamples.length, 13, "globals documentation must contain thirteen executable JavaScript blocks");
VerifyGlobalWriteDocumentationCleanup(g_vecExamples);

const g_vecDocumentationProfiles = [g_DocumentationGlobals, g_ReducedGlobals];
let g_unExecutedDocumentationExampleCount = 0;
for (const Globals of g_vecDocumentationProfiles) {
	const vecLogCalls = [];
	const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
	const DocumentationRequire = CreateDocumentationRequire(Globals, LogInfo);
	for (const strExample of g_vecExamples) {
		const RunExample = new Function("require", "console", strExample);
		RunExample(DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationExampleCount;
	}

	const unRejectedWriteCount = Object.hasOwn(Globals.GetGlobalVariables(), "MapLoadFailed") ? 6 : 5;
	const vecExpectedFormats = [
		"GlobalVariables %s",
		"GlobalLiveView CurrentTime=%s",
		"GlobalTiming %s",
		"GlobalFrame %s",
		"GlobalMapLoad %s",
		"GlobalCapabilities %s",
		"GlobalNetwork %s",
		...Array(unRejectedWriteCount).fill("GlobalRejectedWrite Property=%s Message=%s"),
		"GlobalTemporaryModes %s",
		"GlobalAddresses %s",
		"GlobalCurrentTimeOverride CurrentTime=%s",
		"GlobalReadOnlyProperties %s",
	];
	g_Assert.deepEqual(vecLogCalls.map(vecArguments => vecArguments[0]), vecExpectedFormats, "Every global diagnostic must use the typed logger in order.");
	const vecAddressDiagnostic = vecLogCalls.find(vecArguments => vecArguments[0] === "GlobalAddresses %s");
	g_Assert.ok(vecAddressDiagnostic);
	const AddressDiagnostic = JSON.parse(vecAddressDiagnostic[1]);
	const CurrentGlobals = Globals.GetGlobalVariables();
	g_Assert.equal(AddressDiagnostic.GlobalVariablesAddress, CurrentGlobals.Address.toString());
	g_Assert.equal(AddressDiagnostic.SaveRestoreDataAddress, CurrentGlobals.SaveRestoreDataAddress.toString());

	if (Object.hasOwn(CurrentGlobals, "EdictArrayAddress")) {
		g_Assert.equal(AddressDiagnostic.EdictArrayAddress, CurrentGlobals.EdictArrayAddress.toString());
	} else {
		g_Assert.equal(Object.hasOwn(AddressDiagnostic, "EdictArrayAddress"), false);
	}
}

g_Assert.equal(g_unExecutedDocumentationExampleCount, g_vecExamples.length * g_vecDocumentationProfiles.length, "All globals documentation blocks must execute on both SDK profiles.");
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "Global documentation must not use console logging.");

g_Assert.deepEqual(g_DocumentationRuntime.State, CreateGlobalsState(), "full SDK fixture documentation examples must restore globals state");
g_Assert.deepEqual(g_ReducedRuntime.State, CreateGlobalsState(), "reduced SDK fixture documentation examples must restore globals state");

const g_strBoundedOverrideExample = g_vecExamples.find((strExample) => strExample.includes("function EndCurrentTimeOverride()"));
g_Assert.equal(typeof g_strBoundedOverrideExample, "string", "documentation must contain the bounded timing restore guard");
const g_BoundedOverrideRuntime = CreateNativeGlobals();
const g_BoundedOverrideReplacementState = { ...CreateGlobalsState(), Address: 0x500000n, CurrentTime: Math.fround(27.5) };
const g_RunBoundedOverride = new Function("require", "console", g_strBoundedOverrideExample);
const g_ReplaceBoundedOverrideStorage = () => {
	g_BoundedOverrideRuntime.State = g_BoundedOverrideReplacementState;
};
const g_BoundedOverrideRequire = CreateDocumentationRequire(g_BoundedOverrideRuntime.Module, g_ReplaceBoundedOverrideStorage);
g_Assert.throws(() => g_RunBoundedOverride(g_BoundedOverrideRequire, g_ConsoleDouble), { name: "Error", message: "Current global storage changed; refusing to restore an old timing value into replacement storage." });
g_Assert.equal(g_BoundedOverrideReplacementState.CurrentTime, Math.fround(27.5), "timing cleanup must not overwrite replacement storage");

for (const strExportName of ["MapLoadType", "GetGlobalVariables"]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `Documentation must cover ${strExportName}`);
}

for (const strMemberName of Object.keys(g_MapLoadType)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `Documentation must cover MapLoadType.${strMemberName}`);
}

for (const strPropertyName of [...g_vecMandatoryProperties, ...g_vecOptionalProperties]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strPropertyName}\\b`), `Documentation must cover globals.GetGlobalVariables() property ${strPropertyName}`);
}

for (const strMethodName of [
	"GetNetworkBase",
	"IsClient",
	"IsRemoteClient",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMethodName}\\b`), `Documentation must cover globals.GetGlobalVariables().${strMethodName}()`);
}

for (const vecMatch of g_strDocumentation.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
	const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), vecMatch[1]);
	g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `Documentation link does not exist: ${vecMatch[1]}`);
}

for (const strForbiddenTerm of [
	"Generated by",
	"generate_api_docs",
	"console.log(instance)",
	"console.log(result)",
	"sourcejs:example",
	"globalVars",
	"snapshot wrapper",
]) {
	g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `Documentation must not contain ${strForbiddenTerm}`);
}

const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_strGlobalsBlock = g_strNativeBindings.split("enum class GlobalsInformationProperty", 2)[1].split("edict_t* RequireMessagePlayerEdict", 1)[0];

VerifyNativeGlobalsAddressValidator(g_strGlobalsBlock);

for (const vecValidatorMutation of [
	[/LocalValue->IsBigInt\(\)/, "LocalValue->IsNumber()"],
	[/!bLossless \|\| \(unAddressValue > std::numeric_limits<std::uintptr_t>::max\(\)\)/, "!bLossless"],
	[/unAddressOut = static_cast<std::uintptr_t>\(unAddressValue\);/, "if (unAddressValue > kMaximumSafeNumberInteger) {\n\t\t\treturn false;\n\t\t}\n\n\t\tunAddressOut = static_cast<std::uintptr_t>(unAddressValue);"],
]) {
	const Pattern = vecValidatorMutation[0];
	const strReplacement = vecValidatorMutation[1];
	const strChangedGlobalsBlock = g_strGlobalsBlock.replace(Pattern, strReplacement);
	g_Assert.notEqual(strChangedGlobalsBlock, g_strGlobalsBlock, "The source mutation must change the globals validator.");
	g_Assert.throws(() => VerifyNativeGlobalsAddressValidator(strChangedGlobalsBlock), { name: "AssertionError" });
}

VerifyGlobalVariableNativeContracts(g_strGlobalsBlock);

const g_vecGlobalVariableMutations = [
	["GetGlobalVariablesInformationPropertyCallback", "catch (...)", "catch (std::bad_alloc const&)"],
	["GetGlobalVariablesInformationPropertyCallback", "try {", "try /* lost boundary */ {"],
	["GetGlobalVariablesInformationPropertyCallback", "property read failed", "property write failed"],
	["SetGlobalVariablesInformationPropertyValueCallback", "catch (...)", "catch (std::bad_alloc const&)"],
	["SetGlobalVariablesInformationPropertyValueCallback", "try {", "try /* lost boundary */ {"],
	["SetGlobalVariablesInformationPropertyValueCallback", "property write failed", "property read failed"],
	["ReadGlobalVariablesServerCount", "if constexpr (", "nServerCountOut = 0;\n\t\tif constexpr ("],
	["ReadGlobalVariablesEdictArrayAddress", "if constexpr (", "unEdictArrayAddressOut = 0;\n\t\tif constexpr ("],
	["ReadGlobalVariablesMapGroupName", "if constexpr (", "strMapGroupNameOut.clear();\n\t\tif constexpr ("],
	["ReadGlobalVariablesRemoteClientState", "if constexpr (", "bRemoteClientOut = false;\n\t\tif constexpr ("],
	["ReadGlobalVariablesSimulatedTicksThisFrame", "if constexpr (", "nSimulatedTicksThisFrameOut = 0;\n\t\tif constexpr ("],
	["ReadGlobalVariablesNetworkProtocol", "if constexpr (", "nNetworkProtocolOut = 0;\n\t\tif constexpr ("],
	["ReadGlobalVariablesMapLoadFailed", "if constexpr (", "bMapLoadFailedOut = false;\n\t\tif constexpr ("],
	["ReadGlobalVariablesClientState", "if constexpr (", "bIsClientOut = false;\n\t\tif constexpr ("],
	["ReadGlobalVariablesAbsoluteFrameStartTimeStandardDeviation", "flValueOut = pGlobalVariables->absoluteframestarttimestddev;\n\t\t\treturn true;", "flValueOut = pGlobalVariables->absoluteframestarttimestddev;\n\n\t\t\treturn true;"],
];

for (const vecMutation of g_vecGlobalVariableMutations) {
	const strFunction = GetGlobalsNativeFunction(g_strGlobalsBlock, vecMutation[0]);
	g_Assert(strFunction.includes(vecMutation[1]), "The mutation must match the current function: " + vecMutation[0]);
	const strChangedFunction = strFunction.replace(vecMutation[1], vecMutation[2]);
	const strNormalizedGlobalsBlock = g_strGlobalsBlock.replace(/\r\n/g, "\n");
	g_Assert.equal(ReplaceGlobalsNativeFunction(strNormalizedGlobalsBlock, vecMutation[0], strFunction), strNormalizedGlobalsBlock, "The unmodified globals function view must round-trip exactly.");
	const strChangedGlobalsBlock = ReplaceGlobalsNativeFunction(strNormalizedGlobalsBlock, vecMutation[0], strChangedFunction);
	g_Assert.notEqual(strChangedGlobalsBlock, strNormalizedGlobalsBlock, "The globals source mutation must change its target function.");
	g_Assert.throws(() => VerifyGlobalVariableNativeContracts(strChangedGlobalsBlock), { name: "AssertionError" });
}

for (const strTrait of g_vecGlobalWriteTraits) {
	const strNormalizedGlobalsBlock = g_strGlobalsBlock.replace(/\r\n/g, "\n");
	const vecDefinition = new RegExp("^(\\t{1,2})template <typename TGlobalVariables>\\n\\1constexpr bool " + strTrait + " = requires\\(", "m").exec(strNormalizedGlobalsBlock);
	g_Assert(vecDefinition, "The trait-order mutation must match its declaration.");
	const nStart = vecDefinition.index;
	const strTerminator = "\n" + vecDefinition[1] + "};";
	const nEnd = strNormalizedGlobalsBlock.indexOf(strTerminator, nStart);
	g_Assert(nEnd > nStart, "The trait-order mutation needs the complete requires expression.");
	const strDeclaration = strNormalizedGlobalsBlock.slice(nStart, nEnd + strTerminator.length);
	const strChangedGlobalsBlock = strNormalizedGlobalsBlock.replace(strDeclaration, "") + "\n" + strDeclaration;
	g_Assert.notEqual(strChangedGlobalsBlock, strNormalizedGlobalsBlock, "The trait-order mutation must move the declaration.");
	g_Assert.throws(() => VerifyGlobalVariableNativeContracts(strChangedGlobalsBlock), { name: "AssertionError" });
}

g_Assert.match(g_strNativeBindings, /bool InstallMapLoadTypeConstants/);
g_Assert.match(g_strNativeBindings, /kNewGamePropertyName\[\] = "NEW_GAME"/);
g_Assert.match(g_strNativeBindings, /kLoadGamePropertyName\[\] = "LOAD_GAME"/);
g_Assert.match(g_strNativeBindings, /kTransitionPropertyName\[\] = "TRANSITION"/);
g_Assert.match(g_strNativeBindings, /kBackgroundPropertyName\[\] = "BACKGROUND"/);
g_Assert.match(g_strNativeBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalMapLoadTypeObject, kNewGamePropertyName, v8::Integer::New\(pIsolate, MapLoad_NewGame\)\)/);
g_Assert.match(g_strNativeBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalMapLoadTypeObject, kLoadGamePropertyName, v8::Integer::New\(pIsolate, MapLoad_LoadGame\)\)/);
g_Assert.match(g_strNativeBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalMapLoadTypeObject, kTransitionPropertyName, v8::Integer::New\(pIsolate, MapLoad_Transition\)\)/);
g_Assert.match(g_strNativeBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalMapLoadTypeObject, kBackgroundPropertyName, v8::Integer::New\(pIsolate, MapLoad_Background\)\)/);
g_Assert.match(g_strNativeBindings, /v8::MaybeLocal<v8::Object> MakeGlobalVariablesInformationObject/);
g_Assert.match(g_strNativeBindings, /GetGlobalVariablesInformationPropertyCallback, SetGlobalVariablesInformationPropertyValueCallback/);
g_Assert.match(g_strNativeBindings, /"GetGlobalVariables", GetGlobalVariablesCallback/);
g_Assert.match(g_strNativeBindings, /bool GetAddressSizedUnsignedIntegerFromValue/);
g_Assert.match(g_strNativeBindings, /LocalUnsignedIntegerValue->IsBigInt\(\)/);
g_Assert.match(g_strNativeBindings, /unValue > static_cast<std::uint64_t>\(std::numeric_limits<std::uintptr_t>::max\(\)\)/);
g_Assert.match(g_strNativeBindings, /GlobalsInformationMapName/);
g_Assert.match(g_strNativeBindings, /GlobalsInformationStartSpot/);
g_Assert.match(g_strNativeBindings, /GlobalsInformationMapGroupName/);
g_Assert.match(g_strNativeBindings, /kSDKHasGlobalAbsoluteFrameStartTimeStandardDeviation<CGlobalVars>/);
g_Assert.match(g_strNativeBindings, /kSDKHasGlobalServerCount<CGlobalVars>/);
g_Assert.match(g_strNativeBindings, /kSDKHasGlobalEdictArrayAddress<CGlobalVars>/);
g_Assert.match(g_strNativeBindings, /kSDKHasGlobalMapGroupName<CGlobalVars>/);
g_Assert.match(g_strNativeBindings, /kSDKHasGlobalIsRemoteClient<CGlobalVars>/);

for (const strPropertyName of g_vecMandatoryProperties) {
	g_Assert.match(g_strNativeBindings, new RegExp(`(?:\\{ "${strPropertyName}",|InstallGlobalVariablesInformationProperty\\([^\\n]+"${strPropertyName}")`), `Native globals binding must install ${strPropertyName}`);
}

for (const strForbiddenExpression of [
	"FromMaybe(0.0)",
	"FromMaybe(0)",
	"ValueToString(pIsolate, LocalValue)",
]) {
	g_Assert.equal(g_strGlobalsBlock.includes(strForbiddenExpression), false, `Native globals binding must not coerce failed writes through ${strForbiddenExpression}`);
}

g_Assert.equal(Object.hasOwn(g_DocumentationGlobals, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_DocumentationGlobals, "default"), false);

g_Assert.throws(() => LoadGlobals(), (ErrorValue) => (ErrorValue instanceof Error) && (ErrorValue.constructor === Error) && (ErrorValue.message === "SourceJS native runtime is not installed."), "Missing globals runtime must not be mistaken for module-resolution failure.");

console.log("[  OK  ] globals smoke passed: controlled BigInt/current-storage/float/availability contracts, thirteen examples on full/reduced SDK fixtures, bounded timing restore and twenty-four native source mutation rejections; native SDK execution not exercised");
