#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");
const { CreateNativePaths } = require("./native_paths_mock.js");

const g_unStringTableBaseAddress = 0x2000n;
const g_unMaximumStringsPerTable = 4_096;

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "engines-precache.md");

let g_strActiveMapName = "";
let g_strFailedDownloadPath = null;
const g_vecEventListenerRecords = [];
const g_vecPrecacheCalls = [];
const g_vecTrackedDownloads = [];
const g_StringTableValues = {
	decalprecache: [],
	downloadables: [],
	genericprecache: [],
	modelprecache: [],
	soundprecache: [],
};

function AddUnique(vecValues, strValue) {
	const nValueIndex = vecValues.indexOf(strValue);
	if (nValueIndex >= 0) {
		return nValueIndex;
	}

	vecValues.push(strValue);

	return vecValues.length - 1;
}

function RequireNonEmptyString(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

function ReadOptionalBoolean(bValue, strValueName) {
	if (bValue === undefined) {
		return false;
	}

	if (typeof bValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bValue;
}

function StringTable(strTableName) {
	const vecTableValues = Object.hasOwn(g_StringTableValues, strTableName) ? g_StringTableValues[strTableName] : null;
	if (!vecTableValues) {
		return null;
	}

	const unTableID = Object.keys(g_StringTableValues).indexOf(strTableName);

	return {
		get ID() {
			return unTableID;
		},
		get MaximumStringCount() {
			return g_unMaximumStringsPerTable;
		},
		get Name() {
			return strTableName;
		},
		get Address() {
			return g_unStringTableBaseAddress + BigInt(unTableID);
		},
		get StringCount() {
			return vecTableValues.length;
		},
	};
}

function RecordPrecache(strKind, strTableName, strValue, bPreload, bUISound = false) {
	const strResourceValue = RequireNonEmptyString(strValue, `${strKind} value`).split("\0", 1)[0];
	if (strResourceValue.length === 0) {
		throw new TypeError(`${strKind} value must have a non-empty native string prefix.`);
	}

	const bPreloadValue = ReadOptionalBoolean(bPreload, `${strKind} preload`);
	const bUISoundValue = ReadOptionalBoolean(bUISound, `${strKind} UISound`);
	g_vecPrecacheCalls.push({
		Kind: strKind,
		Preload: bPreloadValue,
		UISound: bUISoundValue,
		Value: strResourceValue,
	});

	return AddUnique(g_StringTableValues[strTableName], strResourceValue);
}

function RemoveEventListener(strEventName, Callback) {
	const nListenerIndex = g_vecEventListenerRecords.findIndex((ListenerRecord) => (ListenerRecord.EventName === strEventName) && (ListenerRecord.Callback === Callback));
	if (nListenerIndex < 0) {
		return false;
	}

	g_vecEventListenerRecords.splice(nListenerIndex, 1);

	return true;
}

function FireEvent(strEventName, Payload = {}, bDoNotBroadcast = false) {
	// Validate the native option; this fixture never performs network broadcasting.
	ReadOptionalBoolean(bDoNotBroadcast, "event broadcast flag");

	const GameEvent = {
		EventName: strEventName,
		GetEventValue(strKey, DefaultValue = undefined) {
			return (Payload && (typeof Payload === "object") && Object.prototype.hasOwnProperty.call(Payload, strKey)) ? Payload[strKey] : DefaultValue;
		},
	};

	for (const ListenerRecord of g_vecEventListenerRecords.slice()) {
		if (ListenerRecord.EventName === strEventName) {
			ListenerRecord.Callback(GameEvent);
		}
	}

	return true;
}

globalThis.sourcejs = {
	events: {
		FireEvent() {
			return true;
		},
	},
	"events/manager": {
		FireEvent,
		RegisterEventListener(strEventName, Callback) {
			RequireNonEmptyString(strEventName, "event name");

			if (typeof Callback !== "function") {
				throw new TypeError("event callback must be a function.");
			}

			g_vecEventListenerRecords.push({ Callback: Callback, EventName: strEventName });

			return true;
		},
		UnregisterEventListener: RemoveEventListener,
	},
	loggers: {
		LogError() {
			return true;
		},
	},
	"memory/hooks/exceptions": {
		Emit() {
			return true;
		},
		RemoveListener() {
			return true;
		},
		AddListener() {
			return true;
		},
	},
	"engines/server": {
		GetGlobalVariables() {
			return {
				MapName: g_strActiveMapName,
			};
		},
	},
	paths: CreateNativePaths({
		GAME_ROOT: "C:/game/left4dead2",
	}),
	"engines/precache": {
		PrecacheDecal(strName, bPreload = false) {
			return RecordPrecache("decal", "decalprecache", strName, bPreload);
		},
		PrecacheGeneric(strResourcePath, bPreload = false) {
			return RecordPrecache("generic", "genericprecache", strResourcePath, bPreload);
		},
		PrecacheModel(strModelPath, bPreload = false) {
			return RecordPrecache("model", "modelprecache", strModelPath, bPreload);
		},
		PrecacheSound(strSample, bPreload = false, bUISound = false) {
			RecordPrecache("sound", "soundprecache", strSample, bPreload, bUISound);

			return true;
		},
	},
	stringtables: {
		DOWNLOADABLES_TABLE_NAME: "downloadables",
		AddString(strTableName, strValue) {
			return AddUnique(g_StringTableValues[strTableName], RequireNonEmptyString(strValue, "string-table value"));
		},
		AddDownloadable(strDownloadPath) {
			const strValue = RequireNonEmptyString(strDownloadPath, "download path");
			if (strValue === g_strFailedDownloadPath) {
				throw new Error(`download registration failed for ${strValue}`);
			}

			AddUnique(g_vecTrackedDownloads, strValue);

			return AddUnique(g_StringTableValues.downloadables, strValue);
		},
		AddDownloadableDirectory() {
			return [];
		},
		HasDownloadable(strDownloadPath) {
			return g_vecTrackedDownloads.includes(strDownloadPath);
		},
		GetDownloadableIndex(strDownloadPath) {
			return g_vecTrackedDownloads.indexOf(strDownloadPath);
		},
		GetDownloadablesList() {
			return g_StringTableValues.downloadables.slice();
		},
		RestoreDownloadables() {
			return g_vecTrackedDownloads.length;
		},
		GetDownloadablesTable() {
			return StringTable("downloadables");
		},
		GetTrackedDownloadables() {
			return g_vecTrackedDownloads.slice();
		},
		UntrackDownloadable(strDownloadPath) {
			const nDownloadIndex = g_vecTrackedDownloads.indexOf(strDownloadPath);
			if (nDownloadIndex < 0) {
				return false;
			}

			g_vecTrackedDownloads.splice(nDownloadIndex, 1);

			return true;
		},
		UntrackDownloadableDirectory(strDirectory) {
			let unRemovedCount = 0;

			for (const strDownloadPath of g_vecTrackedDownloads.slice()) {
				if (strDownloadPath.startsWith(strDirectory)) {
					unRemovedCount += this.UntrackDownloadable(strDownloadPath) ? 1 : 0;
				}
			}

			return unRemovedCount;
		},
		FindStringTable(strTableName) {
			return StringTable(strTableName);
		},
		GetString(strTableName, unStringIndex) {
			return g_StringTableValues[strTableName]?.[unStringIndex] ?? null;
		},
		GetAllStringTables() {
			return Object.keys(g_StringTableValues).map(StringTable).filter(Boolean);
		},
	},
};

g_Assert.deepEqual(Object.keys(globalThis.sourcejs.events), ["FireEvent"], "precache fixture canonical event bridge");
g_Assert.deepEqual(Object.keys(globalThis.sourcejs.loggers), ["LogError"], "precache fixture canonical logger bridge");
g_Assert.deepEqual(Object.keys(globalThis.sourcejs["memory/hooks/exceptions"]).sort(), ["AddListener", "Emit", "RemoveListener"], "precache fixture canonical exception bridge");
g_Assert.throws(() => FireEvent("server_spawn", {}, "false"), TypeError, "Reject invalid broadcast options before local fixture dispatch");

for (const [unTableID, strTableName] of Object.keys(g_StringTableValues).entries()) {
	const Table = StringTable(strTableName);
	g_Assert.equal(typeof Table.Address, "bigint", "string table addresses must use BigInt");
	g_Assert.equal(Table.Address, g_unStringTableBaseAddress + BigInt(unTableID), "string table address identity");
}

g_Assert.equal(StringTable("toString"), null, "string table lookup excludes inherited object members");

const g_Precache = require(g_Path.join(g_strPackageRoot, "engines", "precache.js"));
const g_Events = require(g_Path.join(g_strPackageRoot, "events", "manager.js"));

process.removeAllListeners("uncaughtException");
process.removeAllListeners("unhandledRejection");

g_Assert.deepEqual(Object.keys(g_Precache).sort(), [
	"DecalPrecacheResource",
	"GenericPrecacheResource",
	"ModelPrecacheResource",
	"PrecacheDecal",
	"PrecacheGeneric",
	"PrecacheModel",
	"PrecacheResourceBase",
	"PrecacheResourceError",
	"PrecacheSound",
	"SoundPrecacheResource",
]);

g_Assert.throws(() => g_Precache.PrecacheModel(undefined), TypeError);
g_Assert.throws(() => g_Precache.PrecacheGeneric(""), TypeError);
g_Assert.throws(() => g_Precache.PrecacheDecal("decals/blood1", null), TypeError);
g_Assert.throws(() => g_Precache.PrecacheSound(12), TypeError);
g_Assert.throws(() => g_Precache.PrecacheSound("ui/buttonclick.wav", "yes"), TypeError);
g_Assert.throws(() => g_Precache.PrecacheSound("ui/buttonclick.wav", false, 1), TypeError);
g_Assert.throws(() => new g_Precache.ModelPrecacheResource("models/props_junk/wood_crate001a.mdl", { Preload: null }), TypeError);

const g_unNativeCallCountBeforeInvalidSamples = g_vecPrecacheCalls.length;
for (const strSample of ["", "\0", "\0suffix"]) {
	g_Assert.throws(() => g_Precache.PrecacheSound(strSample), TypeError);
}

g_Assert.equal(g_vecPrecacheCalls.length, g_unNativeCallCountBeforeInvalidSamples);
g_Assert.equal(g_Precache.PrecacheSound("ui/buttonclick.wav\0suffix"), true);
g_Assert.equal(g_vecPrecacheCalls.at(-1).Value, "ui/buttonclick.wav");

const g_unDelayedCallCount = g_vecPrecacheCalls.length;
const g_unDelayedListenerCount = g_vecEventListenerRecords.length;
const g_DelayedModel = new g_Precache.ModelPrecacheResource("models/sourcejs/delayed.mdl", {
	Download: true,
	Preload: true,
});

g_Assert.equal(g_vecPrecacheCalls.length, g_unDelayedCallCount);
g_Assert.equal(g_vecEventListenerRecords.length, g_unDelayedListenerCount + 1);
g_Assert.equal(g_DelayedModel.Registered, true);
g_Assert.equal(g_DelayedModel.Downloadables.has("models/sourcejs/delayed.mdl"), true);
g_Assert.equal(g_vecTrackedDownloads.includes("models/sourcejs/delayed.mdl"), true);

g_strActiveMapName = "c1m1_hotel";
g_Assert.equal(g_Events.EVENT_MANAGER.DispatchEvent("server_spawn"), true);
g_Assert.equal(g_vecPrecacheCalls.length, g_unDelayedCallCount + 1);
g_Assert.equal(g_vecPrecacheCalls.at(-1).Kind, "model");
g_Assert.equal(g_vecPrecacheCalls.at(-1).Preload, true);
g_Assert.equal(g_DelayedModel.GetPrecacheIndex(), 0);

g_Assert.equal(g_DelayedModel.Unload(), true);
g_Assert.equal(g_DelayedModel.Unload(), true);
g_Assert.equal(g_DelayedModel.Registered, false);
g_Assert.equal(g_DelayedModel.Downloadables, null);
g_Assert.equal(g_vecEventListenerRecords.length, g_unDelayedListenerCount + 1);
g_Assert.equal(g_vecTrackedDownloads.includes("models/sourcejs/delayed.mdl"), false);

const g_unSharedListenerCount = g_vecEventListenerRecords.length;

const g_CustomSound = new g_Precache.SoundPrecacheResource("sourcejs\\notify.wav", {
	Download: true,
	Preload: true,
	UISound: true,
});

g_Assert.equal(g_CustomSound.GetSoundSample(), "sourcejs\\notify.wav");
g_Assert.equal(g_CustomSound.GetPrecacheTableValue(), "sourcejs\\notify.wav");
g_Assert.equal(g_CustomSound.GetDownloadPath(), "sound/sourcejs/notify.wav");
g_Assert.equal(g_CustomSound.Downloadables.has("sound/sourcejs/notify.wav"), true);
g_Assert.equal(g_vecPrecacheCalls.at(-1).UISound, true);
g_CustomSound.Unload();
g_Assert.equal(g_vecTrackedDownloads.includes("sound/sourcejs/notify.wav"), false);

class MissingResource extends g_Precache.PrecacheResourceBase {
	GetPrecacheTableName() {
		return "missingprecache";
	}

	Precache() {
		return true;
	}
}

const g_MissingResourceInstance = new MissingResource("sourcejs/missing.bin");
g_Assert.throws(() => g_MissingResourceInstance.GetPrecacheIndex(), (ErrorValue) => {
	g_Assert.equal(ErrorValue instanceof g_Precache.PrecacheResourceError, true);
	g_Assert.equal(ErrorValue.name, "PrecacheResourceError");
	g_Assert.equal(ErrorValue.ResourcePath, "sourcejs/missing.bin");
	g_Assert.equal(ErrorValue.TableName, "missingprecache");

	return true;
});
g_MissingResourceInstance.Unload();

const g_unListenerCountBeforeFailure = g_vecEventListenerRecords.length;
g_strFailedDownloadPath = "models/sourcejs/failure.mdl";
g_Assert.throws(() => new g_Precache.ModelPrecacheResource(g_strFailedDownloadPath, { Download: true }), /download registration failed/);
g_Assert.equal(g_vecEventListenerRecords.length, g_unListenerCountBeforeFailure);
g_Assert.equal(g_vecTrackedDownloads.includes(g_strFailedDownloadPath), false);
g_strFailedDownloadPath = null;

function VerifyPrecacheCleanupFailures() {
	const strSourcePath = g_Path.join(g_strPackageRoot, "engines", "precache.js");
	const strSource = g_FileSystem.readFileSync(strSourcePath, "utf8");
	const vecThrownValues = [new Error("Controlled precache failure"), null, undefined, false, 0, "", Symbol("PrecacheFailure")];
	const Capture = (Callback) => {
		try {
			return { Threw: false, Value: Callback() };
		} catch (ErrorValue) {
			return { Threw: true, Value: ErrorValue };
		}
	};
	const CreateFixture = (State) => {
		class Downloadables extends Set {
			constructor() {
				super();
				State.Downloads = this;
			}

			Add(strPath) {
				State.Operations.push("Add");

				if (State.SetupFails) {
					throw State.SetupError;
				}

				this.add(strPath);

				return this;
			}

			Dispose() {
				State.Operations.push("Dispose");

				if (State.DisposeFails) {
					throw State.DisposeError;
				}

				this.clear();
				State.DownloadsDisposed = true;

				return true;
			}
		}

		const EventManager = {
			RegisterEventListener(strName, Callback) {
				g_Assert.equal(strName, "server_spawn");
				State.Operations.push("Register");
				State.Listeners.add(Callback);

				return true;
			},
			UnregisterEventListener(strName, Callback) {
				g_Assert.equal(strName, "server_spawn");
				State.Operations.push("Unregister");

				if (State.UnregisterFails) {
					throw State.UnregisterError;
				}

				g_Assert.equal(State.Listeners.delete(Callback), true);

				return true;
			},
		};
		const mapDependencies = new Map([
			["engines/server", { GetGlobalVariables: () => ({ MapName: "" }) }],
			["events/manager", { EVENT_MANAGER: EventManager }],
			["internal/runtime", { GetModule: () => ({}) }],
			["stringtables", { Downloadables }],
		]);
		const ModuleRecord = { exports: {} };
		const RequireDependency = (strName) => {
			g_Assert.equal(mapDependencies.has(strName), true);

			return mapDependencies.get(strName);
		};
		g_VM.runInNewContext(strSource, { module: ModuleRecord, require: RequireDependency }, { filename: strSourcePath });

		return class Resource extends ModuleRecord.exports.ModelPrecacheResource {
			GetDownloadPath() {
				State.Resource = this;

				return this.ResourcePath;
			}
		};
	};

	const unListenerCleanupFailureMask = 0x01;
	const unDownloadCleanupFailureMask = 0x02;
	const unAllCleanupFailuresMask = unListenerCleanupFailureMask | unDownloadCleanupFailureMask;

	let unScenarioCount = 0;
	for (const bConstructionFailure of [true, false]) {
		for (const ThrownValue of vecThrownValues) {
			for (const unFailureMask of [unListenerCleanupFailureMask, unDownloadCleanupFailureMask, unAllCleanupFailuresMask, 0]) {
				const SecondaryError = { Stage: "DownloadCleanup" };
				const State = {
					Operations: [],
					Listeners: new Set(),
					DownloadsDisposed: false,
					SetupFails: bConstructionFailure,
					SetupError: ThrownValue,
					UnregisterFails: false,
					UnregisterError: bConstructionFailure ? { Stage: "ListenerCleanup" } : ThrownValue,
					DisposeFails: false,
					DisposeError: (bConstructionFailure || (unFailureMask === unAllCleanupFailuresMask)) ? SecondaryError : ThrownValue,
				};
				const Resource = CreateFixture(State);
				let Result;

				if (bConstructionFailure) {
					State.UnregisterFails = (unFailureMask & unListenerCleanupFailureMask) !== 0;
					State.DisposeFails = (unFailureMask & unDownloadCleanupFailureMask) !== 0;
					Result = Capture(() => new Resource("models/controlled.mdl", { Download: true }));
					g_Assert.equal(Result.Threw, true);

				} else {
					new Resource("models/controlled.mdl", { Download: true });
					State.Operations.length = 0;
					State.UnregisterFails = (unFailureMask & unListenerCleanupFailureMask) !== 0;
					State.DisposeFails = (unFailureMask & unDownloadCleanupFailureMask) !== 0;
					Result = Capture(() => State.Resource.Unload());
					g_Assert.equal(Result.Threw, unFailureMask !== 0);
				}

				let CleanupError = Result.Value;
				if (bConstructionFailure && (unFailureMask !== 0)) {
					g_Assert.equal(Result.Value?.name, "AggregateError", "Construction cleanup must not replace the primary failure.");
					g_Assert.equal(Result.Value.errors[0], ThrownValue);
					g_Assert.equal(Result.Value.errors.length, 2);
					CleanupError = Result.Value.errors[1];

				} else if (bConstructionFailure) {
					g_Assert.equal(Result.Value, ThrownValue);

				} else if (unFailureMask === 0) {
					g_Assert.equal(Result.Value, true);
				}

				if (unFailureMask === unAllCleanupFailuresMask) {
					g_Assert.equal(CleanupError?.name, "AggregateError");
					g_Assert.deepEqual(Array.from(CleanupError.errors), [State.UnregisterError, State.DisposeError]);

				} else if (unFailureMask !== 0) {
					g_Assert.equal(CleanupError, (unFailureMask === unListenerCleanupFailureMask) ? State.UnregisterError : State.DisposeError);
				}

				g_Assert.deepEqual(State.Operations.slice(-2), ["Unregister", "Dispose"], "Every independent cleanup must be attempted.");
				g_Assert.equal(State.Resource.Registered, State.UnregisterFails);
				g_Assert.equal(State.Listeners.size, State.UnregisterFails ? 1 : 0);
				g_Assert.equal(State.Resource.Downloadables, State.DisposeFails ? State.Downloads : null);
				g_Assert.equal(State.DownloadsDisposed, !State.DisposeFails);

				const vecRetryOperations = [];
				if (State.UnregisterFails) {
					vecRetryOperations.push("Unregister");
				}

				if (State.DisposeFails) {
					vecRetryOperations.push("Dispose");
				}

				State.UnregisterFails = false;
				State.DisposeFails = false;
				State.Operations.length = 0;
				g_Assert.equal(State.Resource.Unload(), true);
				g_Assert.deepEqual(State.Operations, vecRetryOperations);
				g_Assert.equal(State.Resource.Registered, false);
				g_Assert.equal(State.Resource.Downloadables, null);
				g_Assert.equal(State.Listeners.size, 0);
				State.Operations.length = 0;
				g_Assert.equal(State.Resource.Unload(), true);
				g_Assert.deepEqual(State.Operations, []);
				unScenarioCount += 1;
			}
		}
	}

	g_Assert.equal(unScenarioCount, 56);
	console.log("Precache cleanup 56 profiles passed.");
}

VerifyPrecacheCleanupFailures();

function RequireDocumentationModule(strModuleName) {
	if (strModuleName === "engines/precache") {
		return g_Precache;
	}

	if (strModuleName === "engines/server") {
		return { GetGlobalVariables: () => ({ MapName: g_strActiveMapName }) };
	}

	throw new Error(`Unexpected documentation module: ${strModuleName}`);
}

function CreateDocumentationExampleError(unBlockIndex, ErrorValue) {
	return new Error(`Documentation JavaScript block ${unBlockIndex + 1} failed: ${ErrorValue?.stack ?? String(ErrorValue)}`);
}

function VerifyDocumentationFailureDiagnostics() {
	const OriginalError = new Error("Controlled documentation failure");
	const vecCases = [
		{ Value: OriginalError, Text: OriginalError.stack },
		{ Value: null, Text: "null" },
		{ Value: undefined, Text: "undefined" },
		{ Value: false, Text: "false" },
		{ Value: 0, Text: "0" },
		{ Value: "", Text: "" },
		{ Value: Symbol("PrecacheFailure"), Text: "Symbol(PrecacheFailure)" },
		{ Value: {}, Text: "[object Object]" },
		{ Value: 42n, Text: "42" },
	];
	for (const TestCase of vecCases) {
		const Failure = CreateDocumentationExampleError(0, TestCase.Value);
		g_Assert.equal(Failure.name, "Error");
		g_Assert.equal(Failure.message, `Documentation JavaScript block 1 failed: ${TestCase.Text}`);
	}

	g_Assert.equal(vecCases.length, 9);
	console.log("Precache documentation diagnostics 9 profiles passed.");
}

function RunDocumentationExamples() {
	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecCodeBlocks = Array.from(strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
	const vecLifecycleBlockIndexes = [2, 8];
	g_Assert.equal(vecCodeBlocks.length, 10);

	for (const [unBlockIndex, strCodeBlock] of vecCodeBlocks.entries()) {
		const ModuleRecord = { exports: {} };
		const DocumentationConsole = {
			log() {
			},
		};

		try {
			const RunExample = new Function("require", "console", "module", "exports", strCodeBlock);
			RunExample(RequireDocumentationModule, DocumentationConsole, ModuleRecord, ModuleRecord.exports);

			if (vecLifecycleBlockIndexes.includes(unBlockIndex)) {
				g_Assert.equal(typeof ModuleRecord.exports.Unload, "function", "Documented lifecycle example requires canonical Unload.");
			}

			g_Assert.equal(Object.hasOwn(ModuleRecord.exports, "unload"), false, "Documented examples must not export lowercase Unload aliases.");
		} catch (ErrorValue) {
			throw CreateDocumentationExampleError(unBlockIndex, ErrorValue);
		} finally {
			if (typeof ModuleRecord.exports.Unload === "function") {
				g_Assert.equal(ModuleRecord.exports.Unload(), true, "Documented plugin unload must finish cleanup.");
			}
		}
	}
}

VerifyDocumentationFailureDiagnostics();
RunDocumentationExamples();

const g_unPrecacheCallCountAfterExamples = g_vecPrecacheCalls.length;
FireEvent("server_spawn", { MapName: "after_documentation_cleanup" });
g_Assert.equal(g_vecPrecacheCalls.length, g_unPrecacheCallCountAfterExamples, "Documentation examples must not leave precache listeners active.");

g_Assert.equal(g_vecEventListenerRecords.length, g_unSharedListenerCount);
g_Assert.equal(g_vecTrackedDownloads.length, 0);

console.log("[smoke_engines_precache] ok");
