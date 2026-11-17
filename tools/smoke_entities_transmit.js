"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_Util = require("node:util");
const g_VM = require("node:vm");

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strTransmitPackagePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "entities", "transmit.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "entities-transmit.md");
const g_strRuntimePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

// Controlled state/notification doubles do not execute the native SDK or prove its ABI.
const g_unFullCheck = 0x00;
const g_unAlways = 0x01 << 3;
const g_unDoNotSend = 0x01 << 4;
const g_unPVSCheck = 0x01 << 5;
const g_unTransmitMask = g_unAlways | g_unDoNotSend | g_unPVSCheck;
const g_unEdictChanged = 0x01 << 0;
const g_unFullEdictChanged = 0x01 << 1;
const g_unEngineOwnedFlag = 0x01 << 6;
const g_unBaselineFlags = g_unEdictChanged | g_unFullEdictChanged | g_unEngineOwnedFlag | g_unPVSCheck;

const g_vecMaximumExports = [
	"ALWAYS",
	"ClearTransmitState",
	"DONT_SEND",
	"FULL_CHECK",
	"GetTransmitStateFlags",
	"PVS_CHECK",
	"SetTransmitState",
	"SetTransmitStateFlags",
];
const g_vecReducedExports = [
	"ALWAYS",
	"DONT_SEND",
	"FULL_CHECK",
	"GetTransmitStateFlags",
	"PVS_CHECK",
];

const g_State = { Flags: g_unBaselineFlags, Live: true, Notifications: [] };
const g_EntityRecord = {
	Index: 1,
	get Valid() {
		return g_State.Live;
	},
	get HandleValue() {
		return this.Index;
	},
	NetworkSerialNumber: 0,
};
const g_setCoveredExports = new Set();

function ResetState() {
	g_State.Flags = g_unBaselineFlags;
	g_State.Live = true;
	g_State.Notifications.length = 0;
}

function RequireEntity(Value, strOperationName) {
	if (!g_State.Live || (Value !== g_EntityRecord)) {
		throw new Error(`${strOperationName} requires a valid entity.`);
	}

	return g_EntityRecord;
}

function RequireSignedInteger32(nValue, strOperationName) {
	const nMinimumValue = -0x80000000;
	const nMaximumValue = 0x7FFFFFFF;

	if (!Number.isInteger(nValue) || (nValue < nMinimumValue) || (nValue > nMaximumValue)) {
		throw new TypeError(`${strOperationName} expects a signed 32-bit integer value.`);
	}

	return nValue;
}

function MarkStateChanged(strOperationName) {
	g_State.Flags |= g_unEdictChanged | g_unFullEdictChanged;
	g_State.Notifications.push({ EntityIndex: g_EntityRecord.Index, Flags: g_State.Flags, OperationName: strOperationName });
}

function DefineTrackedConstant(NativeModule, strConstantName, nValue) {
	Object.defineProperty(NativeModule, strConstantName, {
		enumerable: true,
		get() {
			g_setCoveredExports.add(strConstantName);

			return nValue;
		},
	});
}

function CreateNativeModule(bMutable) {
	const NativeModule = {};

	DefineTrackedConstant(NativeModule, "FULL_CHECK", g_unFullCheck);
	DefineTrackedConstant(NativeModule, "ALWAYS", g_unAlways);
	DefineTrackedConstant(NativeModule, "DONT_SEND", g_unDoNotSend);
	DefineTrackedConstant(NativeModule, "PVS_CHECK", g_unPVSCheck);

	NativeModule.GetTransmitStateFlags = function GetTransmitStateFlags(EntityValue) {
		g_setCoveredExports.add("GetTransmitStateFlags");
		RequireEntity(EntityValue, "entities/transmit.GetTransmitStateFlags(EntityValue)");

		return g_State.Flags;
	};

	if (!bMutable) {
		return NativeModule;
	}

	NativeModule.SetTransmitStateFlags = function SetTransmitStateFlags(EntityValue, nStateFlags) {
		g_setCoveredExports.add("SetTransmitStateFlags");
		RequireEntity(EntityValue, "entities/transmit.SetTransmitStateFlags(EntityValue, nStateFlags)");
		g_State.Flags = RequireSignedInteger32(nStateFlags, "entities/transmit.SetTransmitStateFlags(EntityValue, nStateFlags)");
		MarkStateChanged("SetTransmitStateFlags");

		return true;
	};

	NativeModule.SetTransmitState = function SetTransmitState(EntityValue, nTransmitState) {
		g_setCoveredExports.add("SetTransmitState");
		RequireEntity(EntityValue, "entities/transmit.SetTransmitState(EntityValue, nTransmitState)");
		RequireSignedInteger32(nTransmitState, "entities/transmit.SetTransmitState(EntityValue, nTransmitState)");

		if (![g_unFullCheck, g_unAlways, g_unDoNotSend, g_unPVSCheck].includes(nTransmitState)) {
			throw new RangeError("entities/transmit.SetTransmitState(EntityValue, nTransmitState) received an invalid transmit state.");
		}

		g_State.Flags &= ~g_unTransmitMask;
		g_State.Flags |= nTransmitState;
		MarkStateChanged("SetTransmitState");

		return true;
	};

	NativeModule.ClearTransmitState = function ClearTransmitState(EntityValue) {
		g_setCoveredExports.add("ClearTransmitState");
		RequireEntity(EntityValue, "entities/transmit.ClearTransmitState(EntityValue)");
		g_State.Flags &= ~g_unTransmitMask;
		MarkStateChanged("ClearTransmitState");

		return true;
	};

	return NativeModule;
}

function LoadTransmitPackage(NativeModule) {
	globalThis.sourcejs = { "entities/transmit": NativeModule };
	delete require.cache[require.resolve(g_strTransmitPackagePath)];

	return require(g_strTransmitPackagePath);
}

function Entity(unEntityIndex) {
	if (!Number.isInteger(unEntityIndex) || (unEntityIndex !== g_EntityRecord.Index) || !g_State.Live) {
		throw new Error(`Entity ${unEntityIndex} is not live.`);
	}

	return g_EntityRecord;
}

function VerifyWorldTransmitExample(TransmitAPI) {
	const strExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("entities\/transmit worldspawn state",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world example must retain its transmit callback");

	const RunExample = new Function("TransmitAPI", "GetEntitiesByClassName", "LogResult", `const { ALWAYS, DONT_SEND, FULL_CHECK, PVS_CHECK, GetTransmitStateFlags } = TransmitAPI;\n${vecMatch[0]}`);
	const unOriginalEntityIndex = g_EntityRecord.Index;

	try {
		g_EntityRecord.Index = 0;

		for (const vecEntities of [[], [g_EntityRecord]]) {
			let Result = undefined;
			RunExample(TransmitAPI, (strClassName) => {
				g_Assert.equal(strClassName, "worldspawn");

				return vecEntities;
			}, (strLabel, Callback) => {
				g_Assert.equal(strLabel, "entities/transmit worldspawn state");

				Result = Callback();
			});

			if (vecEntities.length === 0) {
				g_Assert.equal(Result, null);
				continue;
			}

			g_Assert.ok(Result && (typeof Result === "object"), "World index zero must produce a transmit record.");
			g_Assert.equal(Result.Index, 0, "World index zero must not be treated as a null sentinel.");
			g_Assert.equal(Result.StateFlags, g_State.Flags);

			for (const strName of ["ALWAYS", "DONT_SEND", "FULL_CHECK", "PVS_CHECK"]) {
				g_Assert.equal(Result.Constants[strName], TransmitAPI[strName]);
			}
		}
	} finally {
		g_EntityRecord.Index = unOriginalEntityIndex;
	}
}

function ReadDocumentationBlocks() {
	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");

	return Array.from(strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function VerifyCallbackRestorationDocumentation(vecDocumentationBlocks, TransmitModule) {
	// Identity tokens below are controlled sentinels, not an SDK handle-packing model.
	const unEntityIndex = 1;
	const unOriginalHandleValue = 7;
	const unOriginalNetworkSerialNumber = 3;
	const nPreservedStateMask = g_unEngineOwnedFlag | g_unEdictChanged | g_unFullEdictChanged;
	const nAdditionalEngineStateFlag = 0x01 << 7;
	const strCallbackResult = "callback-result";
	const vecHelperSpecifications = [
		{ BlockIndex: 1, Name: "WithForcedEntityTransmission", Arguments: "Index" },
		{ BlockIndex: 4, Name: "WithEntityTransmitState", Arguments: "Mode" },
		{ BlockIndex: 7, Name: "WithEntityPVSCheck", Arguments: "Flags" },
	];
	const vecScenarios = [
		"Success",
		"CallbackFailure",
		"RemovedEntity",
		"ChangedHandle",
		"ChangedSerial",
		"ChangedNonTransmitBit",
		"InitialNotificationFailure",
		"RestorationNotificationFailure",
		"CallbackAndRestorationNotificationFailure",
	];

	for (const Specification of vecHelperSpecifications) {
		for (const strScenario of vecScenarios) {
			const State = { bValid: true, bInjectNotificationFailure: false, unHandleValue: unOriginalHandleValue, unNetworkSerialNumber: unOriginalNetworkSerialNumber, nFlags: TransmitModule.FULL_CHECK | g_unEngineOwnedFlag, unWriteCount: 0, unCallbackCount: 0 };
			const InitialNotificationError = new Error("The initial write notification failed after committing flags.");
			const RestorationNotificationError = new Error("The restoration notification failed after committing flags.");
			const EntityValue = {
				Index: unEntityIndex,
				get Valid() {
					return State.bValid;
				},
				get HandleValue() {
					return State.unHandleValue;
				},
				get NetworkSerialNumber() {
					return State.unNetworkSerialNumber;
				},
			};
			const nTransmitMask = TransmitModule.ALWAYS | TransmitModule.DONT_SEND | TransmitModule.PVS_CHECK;
			const CommitFlags = (nFlags) => {
				State.nFlags = nFlags | g_unEdictChanged | g_unFullEdictChanged;
				State.unWriteCount++;

				if (State.bInjectNotificationFailure && (strScenario === "InitialNotificationFailure") && (State.unWriteCount === 1)) {
					throw InitialNotificationError;
				}

				if (State.bInjectNotificationFailure && ((strScenario === "RestorationNotificationFailure") || (strScenario === "CallbackAndRestorationNotificationFailure")) && (State.unWriteCount === 2)) {
					throw RestorationNotificationError;
				}

				return true;
			};

			const FixtureTransmit = {
				ALWAYS: TransmitModule.ALWAYS,
				DONT_SEND: TransmitModule.DONT_SEND,
				FULL_CHECK: TransmitModule.FULL_CHECK,
				PVS_CHECK: TransmitModule.PVS_CHECK,
				GetTransmitStateFlags(CurrentEntity) {
					g_Assert.strictEqual(CurrentEntity, EntityValue);

					return State.nFlags;
				},
				SetTransmitStateFlags(CurrentEntity, nFlags) {
					g_Assert.strictEqual(CurrentEntity, EntityValue);

					return CommitFlags(nFlags);
				},
				SetTransmitState(CurrentEntity, nMode) {
					g_Assert.strictEqual(CurrentEntity, EntityValue);

					return CommitFlags((State.nFlags & ~nTransmitMask) | nMode);
				},
			};
			const strSource = vecDocumentationBlocks[Specification.BlockIndex];
			const vecBindingMatch = new RegExp("const (\\w+) = function " + Specification.Name + "\\(").exec(strSource);
			g_Assert.ok(vecBindingMatch, `Missing reviewed helper: ${Specification.Name}.`);

			const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\nreturn ${vecBindingMatch[1]};\n})`, { filename: `entities-transmit.md:${Specification.Name}` });
			const Load = Script.runInNewContext({});
			const DocumentationRequire = (strModuleName) => {
				if (strModuleName === "entities/transmit") {
					return FixtureTransmit;
				}

				if (strModuleName === "entities/entity") {
					return { Entity: () => EntityValue };
				}

				if (strModuleName === "loggers") {
					return {
						LogInfo() {
						},
					};
				}

				throw new Error(`Unexpected documentation module: ${strModuleName}.`);
			};
			const DocumentationConsole = {
				log() {
					throw new Error("Entity transmit documentation must use the typed logger.");
				},
			};
			g_Assert.throws(() => DocumentationConsole.log("must fail"), /Entity transmit documentation must use the typed logger\./);

			const Invoke = Load(DocumentationRequire, DocumentationConsole);
			const nPreviousFlags = State.nFlags;
			g_Assert.equal(nPreviousFlags & nPreservedStateMask, nPreservedStateMask, "Example writes retain engine-owned bits and add change markers.");

			State.unWriteCount = 0;
			State.bInjectNotificationFailure = true;
			const CallbackError = new Error("The callback failed.");
			const Callback = (Value) => {
				State.unCallbackCount++;

				if (Specification.Arguments === "Flags") {
					g_Assert.equal(Value, State.nFlags);

				} else {
					g_Assert.strictEqual(Value, EntityValue);
				}

				if (strScenario === "RemovedEntity") {
					State.bValid = false;

				} else if (strScenario === "ChangedHandle") {
					State.unHandleValue++;

				} else if (strScenario === "ChangedSerial") {
					State.unNetworkSerialNumber++;

				} else if (strScenario === "ChangedNonTransmitBit") {
					State.nFlags |= nAdditionalEngineStateFlag;
				}

				if ((strScenario === "CallbackFailure") || (strScenario === "CallbackAndRestorationNotificationFailure")) {
					throw CallbackError;
				}

				return strCallbackResult;
			};
			const vecArguments = (Specification.Arguments === "Index") ? [unEntityIndex, Callback] : (Specification.Arguments === "Mode") ? [EntityValue, FixtureTransmit.ALWAYS, Callback] : [EntityValue, Callback];
			if (strScenario === "CallbackFailure") {
				g_Assert.throws(() => Invoke(...vecArguments), (ErrorValue) => ErrorValue === CallbackError);

			} else if (strScenario === "InitialNotificationFailure") {
				g_Assert.throws(() => Invoke(...vecArguments), (ErrorValue) => ErrorValue === InitialNotificationError);

			} else if ((strScenario === "RestorationNotificationFailure") || (strScenario === "CallbackAndRestorationNotificationFailure")) {
				g_Assert.throws(() => Invoke(...vecArguments), (ErrorValue) => ErrorValue === RestorationNotificationError);

			} else {
				g_Assert.equal(Invoke(...vecArguments), strCallbackResult);
			}

			const bOriginalEntity = !["RemovedEntity", "ChangedHandle", "ChangedSerial"].includes(strScenario);
			g_Assert.equal(State.unWriteCount, bOriginalEntity ? 2 : 1, `Unexpected restoration by ${Specification.Name} after ${strScenario}.`);
			g_Assert.equal(State.unCallbackCount, (strScenario === "InitialNotificationFailure") ? 0 : 1);

			if (bOriginalEntity) {
				const bPreserveCallbackFlags = (Specification.Arguments === "Mode") && (strScenario === "ChangedNonTransmitBit");
				const nExpectedFlags = bPreserveCallbackFlags ? (nPreviousFlags | nAdditionalEngineStateFlag) : nPreviousFlags;
				g_Assert.equal(State.nFlags, nExpectedFlags);
			}
		}
	}
}

function VerifyStandaloneRestorationDocumentation(vecDocumentationBlocks, TransmitModule) {
	// Controlled lifecycle changes model the short operation, not an actual engine notification ABI.
	const unOriginalHandleValue = 7;
	const unOriginalNetworkSerialNumber = 3;
	const nInitialFlags = TransmitModule.PVS_CHECK | g_unEngineOwnedFlag | g_unEdictChanged | g_unFullEdictChanged;
	const nTransmitMask = TransmitModule.ALWAYS | TransmitModule.DONT_SEND | TransmitModule.PVS_CHECK;
	const vecSpecifications = [
		{ BlockIndex: 5, Name: "SuppressEntityDuringServerStateUpdate", SuccessWriteCount: 2 },
		{ BlockIndex: 6, Name: "VerifyClearTransmitState", SuccessWriteCount: 3 },
	];
	const vecScenarios = [
		"Success",
		"OperationFailure",
		"RemovedEntity",
		"ChangedHandle",
		"ChangedSerial",
		"InitialNotificationFailure",
		"RestorationNotificationFailure",
	];
	for (const Specification of vecSpecifications) {
		for (const strScenario of vecScenarios) {
			const State = { bValid: true, unHandleValue: unOriginalHandleValue, unNetworkSerialNumber: unOriginalNetworkSerialNumber, nFlags: nInitialFlags, unWriteCount: 0, unMutationAttemptCount: 0 };
			const EntityValue = {
				Index: 1,
				get Valid() {
					return State.bValid;
				},
				get HandleValue() {
					return State.unHandleValue;
				},
				get NetworkSerialNumber() {
					return State.unNetworkSerialNumber;
				},
			};
			const OperationError = new Error("The short server-side operation failed.");
			const InvalidEntityError = new Error("The entity is no longer live.");
			const InitialNotificationError = new Error("The first notification failed after flag commit.");
			const RestorationNotificationError = new Error("The restoration notification failed after flag commit.");
			const RequireLiveEntity = (CurrentEntity) => {
				g_Assert.strictEqual(CurrentEntity, EntityValue);

				if (!State.bValid) {
					throw InvalidEntityError;
				}
			};
			const RunOperation = () => {
				if (strScenario === "OperationFailure") {
					throw OperationError;
				}

				if (strScenario === "RemovedEntity") {
					State.bValid = false;

				} else if (strScenario === "ChangedHandle") {
					State.unHandleValue++;

				} else if (strScenario === "ChangedSerial") {
					State.unNetworkSerialNumber++;
				}
			};
			const CommitFlags = (CurrentEntity, nFlags) => {
				State.unMutationAttemptCount++;
				RequireLiveEntity(CurrentEntity);

				State.nFlags = nFlags | g_unEdictChanged | g_unFullEdictChanged;
				State.unWriteCount++;

				if ((strScenario === "InitialNotificationFailure") && (State.unWriteCount === 1)) {
					throw InitialNotificationError;
				}

				if ((strScenario === "RestorationNotificationFailure") && (State.unWriteCount === Specification.SuccessWriteCount)) {
					throw RestorationNotificationError;
				}

				return true;
			};
			const FixtureTransmit = {
				ALWAYS: TransmitModule.ALWAYS,
				DONT_SEND: TransmitModule.DONT_SEND,
				FULL_CHECK: TransmitModule.FULL_CHECK,
				PVS_CHECK: TransmitModule.PVS_CHECK,
				GetTransmitStateFlags(CurrentEntity) {
					RequireLiveEntity(CurrentEntity);

					return State.nFlags;
				},
				SetTransmitState(CurrentEntity, nMode) {
					return CommitFlags(CurrentEntity, (State.nFlags & ~nTransmitMask) | nMode);
				},
				ClearTransmitState(CurrentEntity) {
					CommitFlags(CurrentEntity, State.nFlags & ~nTransmitMask);
					RunOperation();

					return true;
				},
			};
			const DocumentationRequire = (strModuleName) => {
				if (strModuleName === "entities/entity") {
					return { Entity: () => EntityValue };
				}

				if (strModuleName === "entities/transmit") {
					return FixtureTransmit;
				}

				if (strModuleName === "loggers") {
					return { LogInfo: RunOperation };
				}

				throw new Error(`Unexpected documentation module: ${strModuleName}.`);
			};
			const Script = new g_VM.Script(`(function (require, console) {\n${vecDocumentationBlocks[Specification.BlockIndex]}\n})`, { filename: `entities-transmit.md:${Specification.Name}:${strScenario}` });
			const Run = Script.runInNewContext({});
			const DocumentationConsole = {
				log() {
					throw new Error("Entity transmit documentation must use the typed logger.");
				},
			};
			g_Assert.throws(() => DocumentationConsole.log("must fail"), /Entity transmit documentation must use the typed logger\./);

			const Execute = () => Run(DocumentationRequire, DocumentationConsole);
			let ExpectedError = null;
			if (strScenario === "OperationFailure") {
				ExpectedError = OperationError;

			} else if (strScenario === "InitialNotificationFailure") {
				ExpectedError = InitialNotificationError;

			} else if (strScenario === "RestorationNotificationFailure") {
				ExpectedError = RestorationNotificationError;

			} else if ((strScenario === "RemovedEntity") && (Specification.BlockIndex === 6)) {
				ExpectedError = InvalidEntityError;
			}

			if (ExpectedError === null) {
				g_Assert.doesNotThrow(Execute);

			} else {
				g_Assert.throws(Execute, ErrorValue => ErrorValue === ExpectedError);
			}

			const bOriginalEntity = !["RemovedEntity", "ChangedHandle", "ChangedSerial"].includes(strScenario);
			const unExpectedWriteCount = (strScenario === "InitialNotificationFailure") ? 2 : bOriginalEntity ? Specification.SuccessWriteCount : (Specification.SuccessWriteCount - 1);
			g_Assert.equal(State.unWriteCount, unExpectedWriteCount, Specification.Name + ":" + strScenario);
			g_Assert.equal(State.unMutationAttemptCount, unExpectedWriteCount, "Cleanup must not write through a removed or rebound entity wrapper.");

			if (bOriginalEntity) {
				g_Assert.equal(State.nFlags, nInitialFlags, "Mode restoration must preserve current engine-owned bits.");
			}
		}
	}
}

function RunDocumentationBlocks(TransmitModule) {
	const unExpectedDocumentationBlockCount = 8;
	const unFunctionsLogIndex = 0;
	const unConstantsLogIndex = 1;
	const unForcedEntityLogIndex = 2;
	const unStateLogIndex = 3;
	const unInspectionLogIndex = 4;
	const unAlwaysLogIndex = 5;
	const unSuppressionLogIndex = 6;
	const unFlagWriteLogIndex = 7;
	const vecBlocks = ReadDocumentationBlocks();
	g_Assert.equal(vecBlocks.length, unExpectedDocumentationBlockCount);

	const vecReviewedLogs = [];
	let unCurrentBlockIndex = 0;
	const DocumentationLoggers = {
		LogInfo(strFormat, ...vecValues) {
			g_Assert.equal(typeof strFormat, "string");
			g_Assert.doesNotMatch(strFormat, /^\s*\[/, "The typed logger owns the severity marker.");
			vecReviewedLogs.push({ BlockIndex: unCurrentBlockIndex, Format: strFormat, Values: vecValues, StateFlags: g_State.Flags, Rendered: g_Util.format(strFormat, ...vecValues) });
		},
	};

	const DocumentationRequire = (strModuleName) => {
		if (strModuleName === "entities/transmit") {
			return TransmitModule;
		}

		if (strModuleName === "entities/entity") {
			return { Entity };
		}

		if (strModuleName === "loggers") {
			return DocumentationLoggers;
		}

		throw new Error(`Unexpected documentation module: ${strModuleName}`);
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Entity transmit documentation must use the typed logger.");
		},
	};
	g_Assert.throws(() => DocumentationConsole.log("must fail"), /Entity transmit documentation must use the typed logger\./);

	for (const [unBlockIndex, strBlock] of vecBlocks.entries()) {
		unCurrentBlockIndex = unBlockIndex;
		const nPreviousFlags = g_State.Flags;
		const Script = new g_VM.Script(`(function (require, console) {\n${strBlock}\n})`, { filename: `${g_strDocumentationPath}#${unBlockIndex + 1}` });
		const RunBlock = Script.runInThisContext();

		RunBlock(DocumentationRequire, DocumentationConsole);
		g_Assert.equal(g_State.Flags, nPreviousFlags, `documentation block ${unBlockIndex + 1} did not restore edict flags`);
	}

	g_Assert.deepEqual(vecReviewedLogs.map(Log => Log.Format), [
		"ReportEntityTransmitFunctions Result=%j",
		"ReportEntityTransmitConstants Result=%j",
		"LogForcedEntity EntityIndex=%d",
		"InspectCurrentEntityTransmitState Result=%j",
		"InspectEntityTransmission Result=%j",
		"VerifyAlwaysTransmitState EntityIndex=%d",
		"SuppressEntityDuringServerStateUpdate EntityIndex=%d",
		"VerifyCompleteEntityStateFlagWrite Result=%j",
	]);
	g_Assert.deepEqual(JSON.parse(JSON.stringify(vecReviewedLogs[unFunctionsLogIndex].Values[0])), { ClearTransmitStateType: "function", GetTransmitStateFlagsType: "function", SetTransmitStateFlagsType: "function", SetTransmitStateType: "function" });
	g_Assert.deepEqual(JSON.parse(JSON.stringify(vecReviewedLogs[unConstantsLogIndex].Values[0])), { AlwaysTransmitState: TransmitModule.ALWAYS, DoNotSendTransmitState: TransmitModule.DONT_SEND, FullCheckTransmitState: TransmitModule.FULL_CHECK, PVSTransmitState: TransmitModule.PVS_CHECK });
	g_Assert.equal(vecReviewedLogs[unForcedEntityLogIndex].Values[0], g_EntityRecord.Index);

	const StateLog = vecReviewedLogs[unStateLogIndex];
	g_Assert.deepEqual(JSON.parse(JSON.stringify(StateLog.Values[0])), { EntityStateFlags: StateLog.StateFlags, EntityTransmitState: StateLog.StateFlags & g_unTransmitMask, EntityTransmitStateMask: g_unTransmitMask });

	const InspectionLog = vecReviewedLogs[unInspectionLogIndex];
	g_Assert.deepEqual(JSON.parse(JSON.stringify(InspectionLog.Values[0])), { Always: (InspectionLog.StateFlags & TransmitModule.ALWAYS) !== 0, DoNotSend: (InspectionLog.StateFlags & TransmitModule.DONT_SEND) !== 0, PVSCheck: (InspectionLog.StateFlags & TransmitModule.PVS_CHECK) !== 0, EntityStateFlags: InspectionLog.StateFlags });
	g_Assert.equal(vecReviewedLogs[unAlwaysLogIndex].Values[0], g_EntityRecord.Index);
	g_Assert.equal(vecReviewedLogs[unSuppressionLogIndex].Values[0], g_EntityRecord.Index);
	g_Assert.deepEqual(JSON.parse(JSON.stringify(vecReviewedLogs[unFlagWriteLogIndex].Values[0])), { EntityStateFlags: vecReviewedLogs[unFlagWriteLogIndex].StateFlags });
}

function AssertRejectedTransmitCall(strOperationName, Invoke, ErrorExpectation) {
	const nPreviousFlags = g_State.Flags;
	const unPreviousNotificationCount = g_State.Notifications.length;
	g_Assert.throws(Invoke, ErrorExpectation, strOperationName + " must reject the invalid call with the expected error.");
	g_Assert.equal(g_State.Flags, nPreviousFlags, strOperationName + " rejected calls must not change flags.");
	g_Assert.equal(g_State.Notifications.length, unPreviousNotificationCount, strOperationName + " rejected calls must not emit notifications.");
}

ResetState();

const g_MaximumNativeModule = CreateNativeModule(true);
const g_Transmit = LoadTransmitPackage(g_MaximumNativeModule);

g_Assert.strictEqual(g_Transmit, g_MaximumNativeModule);
g_Assert.deepEqual(Object.keys(g_Transmit).sort(), g_vecMaximumExports);
g_Assert.equal(g_Transmit.FULL_CHECK, 0x00);
g_Assert.equal(g_Transmit.ALWAYS, 0x08);
g_Assert.equal(g_Transmit.DONT_SEND, 0x10);
g_Assert.equal(g_Transmit.PVS_CHECK, 0x20);

g_State.Flags = g_unBaselineFlags | g_unDoNotSend;
g_Assert.equal(g_Transmit.GetTransmitStateFlags(g_EntityRecord), g_unBaselineFlags | g_unDoNotSend);

g_Assert.equal(g_Transmit.SetTransmitState(g_EntityRecord, g_Transmit.ALWAYS), true);
g_Assert.equal(g_State.Flags & g_unTransmitMask, g_unAlways);
g_Assert.equal(g_State.Flags & g_unEngineOwnedFlag, g_unEngineOwnedFlag, "Transmit mode changes must preserve engine-owned flags.");
g_Assert.equal(g_State.Flags & g_unEdictChanged, g_unEdictChanged, "Transmit changes must mark ordinary dirty bits.");
g_Assert.equal(g_State.Flags & g_unFullEdictChanged, g_unFullEdictChanged, "Transmit changes must mark full dirty bits.");
g_Assert.deepEqual(g_State.Notifications.at(-1), { EntityIndex: 1, Flags: g_State.Flags, OperationName: "SetTransmitState" }, "Mutators must record entity, flags and operation notifications.");

g_Assert.equal(g_Transmit.SetTransmitState(g_EntityRecord, g_Transmit.FULL_CHECK), true);
g_Assert.equal(g_State.Flags & g_unTransmitMask, 0x00, "FULL_CHECK and clear operations must remove all transmit selection bits.");
g_Assert.equal(g_State.Flags & g_unEngineOwnedFlag, g_unEngineOwnedFlag, "Transmit mode changes must preserve engine-owned flags.");

g_State.Flags = g_unBaselineFlags | g_unAlways | g_unDoNotSend;
g_Assert.equal(g_Transmit.ClearTransmitState(g_EntityRecord), true);
g_Assert.equal(g_State.Flags & g_unTransmitMask, 0x00, "FULL_CHECK and clear operations must remove all transmit selection bits.");
g_Assert.equal(g_State.Flags & g_unEngineOwnedFlag, g_unEngineOwnedFlag, "Transmit mode changes must preserve engine-owned flags.");

g_Assert.equal(g_Transmit.SetTransmitStateFlags(g_EntityRecord, g_unDoNotSend), true);
g_Assert.equal(g_State.Flags, g_unDoNotSend | g_unEdictChanged | g_unFullEdictChanged, "Raw flag writes must retain caller flags and required dirty bits.");
g_Assert.equal(g_State.Flags & g_unEngineOwnedFlag, 0x00);
g_Assert.equal(g_State.Notifications.at(-1).OperationName, "SetTransmitStateFlags");

for (const nFlags of [-0x80000000, 0x00, 0x7FFFFFFF]) {
	ResetState();
	g_Assert.equal(g_Transmit.SetTransmitStateFlags(g_EntityRecord, nFlags), true);
	g_Assert.equal(g_Transmit.GetTransmitStateFlags(g_EntityRecord), nFlags | g_unEdictChanged | g_unFullEdictChanged, "Signed 32-bit flag boundaries and dirty bits must be preserved.");
	g_Assert.equal(g_State.Notifications.length, 1, "A valid raw flag write must issue exactly one notification.");
}

ResetState();

AssertRejectedTransmitCall("SetTransmitState", () => g_Transmit.SetTransmitState(g_EntityRecord, g_unAlways | g_unDoNotSend), { name: "RangeError", message: /invalid transmit state/ });
AssertRejectedTransmitCall("SetTransmitState", () => g_Transmit.SetTransmitState(g_EntityRecord, 1.5), { name: "TypeError", message: /integer/ });
AssertRejectedTransmitCall("SetTransmitState", () => g_Transmit.SetTransmitState(g_EntityRecord, "8"), { name: "TypeError", message: /integer/ });

for (const InvalidValue of [1.5, 0x80000000, -0x80000001, 1n, "16", NaN, Infinity, null, undefined, true]) {
	AssertRejectedTransmitCall("SetTransmitStateFlags", () => g_Transmit.SetTransmitStateFlags(g_EntityRecord, InvalidValue), { name: "TypeError", message: /integer/ });
}

AssertRejectedTransmitCall("GetTransmitStateFlags", () => g_Transmit.GetTransmitStateFlags({ Index: 1 }), { name: "Error", message: /valid entity/ });
AssertRejectedTransmitCall("ClearTransmitState", () => g_Transmit.ClearTransmitState({ Index: 1 }), { name: "Error", message: /valid entity/ });

g_State.Live = false;
AssertRejectedTransmitCall("GetTransmitStateFlags", () => g_Transmit.GetTransmitStateFlags(g_EntityRecord), { name: "Error", message: /valid entity/ });
AssertRejectedTransmitCall("SetTransmitStateFlags", () => g_Transmit.SetTransmitStateFlags(g_EntityRecord, 0x00), { name: "Error", message: /valid entity/ });
AssertRejectedTransmitCall("SetTransmitState", () => g_Transmit.SetTransmitState(g_EntityRecord, g_unAlways), { name: "Error", message: /valid entity/ });
AssertRejectedTransmitCall("ClearTransmitState", () => g_Transmit.ClearTransmitState(g_EntityRecord), { name: "Error", message: /valid entity/ });

ResetState();

const g_ReducedNativeModule = CreateNativeModule(false);
const g_ReducedTransmit = LoadTransmitPackage(g_ReducedNativeModule);

g_Assert.strictEqual(g_ReducedTransmit, g_ReducedNativeModule);
g_Assert.deepEqual(Object.keys(g_ReducedTransmit).sort(), g_vecReducedExports, "The reduced profile must expose only available transmit operations.");
g_Assert.equal(typeof g_ReducedTransmit.SetTransmitStateFlags, "undefined");
g_Assert.equal(typeof g_ReducedTransmit.SetTransmitState, "undefined");
g_Assert.equal(typeof g_ReducedTransmit.ClearTransmitState, "undefined");
g_Assert.equal(g_ReducedTransmit.GetTransmitStateFlags(g_EntityRecord), g_unBaselineFlags);

ResetState();
g_setCoveredExports.clear();

const g_DocumentedTransmit = LoadTransmitPackage(g_MaximumNativeModule);

VerifyCallbackRestorationDocumentation(ReadDocumentationBlocks(), g_DocumentedTransmit);
VerifyStandaloneRestorationDocumentation(ReadDocumentationBlocks(), g_DocumentedTransmit);
RunDocumentationBlocks(g_DocumentedTransmit);
g_Assert.deepEqual([...g_setCoveredExports].sort(), g_vecMaximumExports, "Executable documentation must cover every full-profile export.");
g_Assert.ok(g_State.Notifications.length > 0);
g_Assert.equal(g_State.Flags, g_unBaselineFlags);

const g_unEntityIndexBeforeWorldProfiles = g_EntityRecord.Index;
VerifyWorldTransmitExample(g_DocumentedTransmit);
g_Assert.equal(g_EntityRecord.Index, g_unEntityIndexBeforeWorldProfiles, "World profile checks must restore the original entity index.");
VerifyWorldTransmitExample(g_ReducedTransmit);
g_Assert.equal(g_EntityRecord.Index, g_unEntityIndexBeforeWorldProfiles, "Reduced world profile checks must restore the original entity index.");

const g_WorldQueryError = new Error("The controlled world query failed.");
const g_FailingWorldProfile = {
	...g_MaximumNativeModule,
	GetTransmitStateFlags(EntityValue) {
		g_Assert.strictEqual(EntityValue, g_EntityRecord);
		throw g_WorldQueryError;
	},
};
g_Assert.throws(() => VerifyWorldTransmitExample(g_FailingWorldProfile), (ErrorValue) => ErrorValue === g_WorldQueryError);
g_Assert.equal(g_EntityRecord.Index, g_unEntityIndexBeforeWorldProfiles, "A failed world query must restore the original entity index.");

delete globalThis.sourcejs;
delete require.cache[require.resolve(g_strTransmitPackagePath)];
delete require.cache[g_strRuntimePath];

g_Assert.throws(() => require(g_strTransmitPackagePath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Transmit must report native absence, not a lookup or unrelated error.");

g_Module._load = g_OriginalModuleLoad;
delete require.cache[g_strRuntimePath];

console.log("[  OK  ] entities/transmit smoke passed with native doubles; native SDK execution not exercised");
