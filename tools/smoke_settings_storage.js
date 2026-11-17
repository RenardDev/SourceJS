#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");
const { CreateSettingsSOCIModel } = require("./native_soci_settings_mock.js");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strSettingsStorageDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "settings-storage.md");
const g_strSettingsStorageSourcePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "settings", "storage.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_unDocumentationCompilationTimeoutMilliseconds = 1000;
const g_vecExpectedSettingsStorageExports = Object.freeze([
	"DEFAULT_STORAGE",
	"ROOT",
	"PlayerSettingsView",
	"SettingsStorage",
	"CreateStorage",
]);

const g_nLargeSignedSettingsValue = 9223372036854775807n;
const g_BaseSOCI = CreateSettingsSOCIModel();
const g_vecSOCICalls = [];
let g_FaultInjectedValueRow = null;

function RunSOCIRequest(Operation, Options, Callback) {
	g_Assert.equal((Options !== null) && (typeof Options === "object") && !Array.isArray(Options), true, "SOCI request options");
	g_Assert.equal((Options.Blocking === undefined) || (typeof Options.Blocking === "boolean"), true, "SOCI Blocking mode");
	g_Assert.equal(typeof Callback, "function", "SOCI completion callback");

	const bBlocking = Options.Blocking === true;

	const CompleteRequest = () => {
		let RequestError = null;
		let Result = null;

		try {
			Result = Operation();
		} catch (OperationError) {
			RequestError = (OperationError === null) ? new Error("SOCI fixture operation failed.", { cause: OperationError }) : OperationError;
		}

		Callback(RequestError, Result);
	};
	if (bBlocking) {
		CompleteRequest();

	} else {
		queueMicrotask(CompleteRequest);
	}
}

// Boundary assertions use the real callback contract in Blocking mode. Deferred
// delivery, queueing and callback failures are covered by smoke_settings_async.js.
function RunBlockingSettingsRequest(Target, strMethodName, vecArguments = []) {
	let bCompleted = false;
	let RequestError = null;
	let Result = null;

	const DirectResult = Target[strMethodName](...vecArguments, { Blocking: true }, (CompletionError, CompletionResult) => {
		g_Assert.equal(bCompleted, false, `${strMethodName} completes exactly once`);
		bCompleted = true;
		RequestError = CompletionError;
		Result = CompletionResult;
	});
	g_Assert.equal(DirectResult, undefined, `${strMethodName} does not return its result directly`);
	g_Assert.equal(bCompleted, true, `${strMethodName} completes before Blocking returns`);

	if (RequestError !== null) {
		throw RequestError;
	}

	return Result;
}

function CreateSOCIResultOperation(Result) {
	return (...vecArguments) => RunSOCIRequest(() => Result, vecArguments.at(-2), vecArguments.at(-1));
}

const g_SOCI = {
	Begin(hConnectionHandle, Options, Callback) {
		g_vecSOCICalls.push(["begin", hConnectionHandle]);
		RunSOCIRequest(() => g_BaseSOCI.Begin(hConnectionHandle), Options, Callback);
	},

	Close(hConnectionHandle, Options, Callback) {
		g_vecSOCICalls.push(["close", hConnectionHandle]);
		RunSOCIRequest(() => g_BaseSOCI.Close(hConnectionHandle), Options, Callback);
	},

	Commit(hConnectionHandle, Options, Callback) {
		g_vecSOCICalls.push(["commit", hConnectionHandle]);
		RunSOCIRequest(() => g_BaseSOCI.Commit(hConnectionHandle), Options, Callback);
	},

	Connect(strConnectionString, BackendOrOptions, OptionsOrCallback, Callback = undefined) {
		const strBackendName = (Callback === undefined) ? null : BackendOrOptions;
		const Options = (Callback === undefined) ? BackendOrOptions : OptionsOrCallback;
		const CompleteConnect = (Callback === undefined) ? OptionsOrCallback : Callback;

		g_vecSOCICalls.push(["connect", strConnectionString, strBackendName]);
		RunSOCIRequest(() => g_BaseSOCI.Connect(strConnectionString), Options, CompleteConnect);
	},

	Execute(hConnectionHandle, strStatementText, StatementParameters, Options, Callback) {
		g_vecSOCICalls.push(["execute", hConnectionHandle, strStatementText, StatementParameters]);
		RunSOCIRequest(() => {
			const nAffectedRowCount = g_BaseSOCI.Execute(hConnectionHandle, strStatementText, StatementParameters);
			g_Assert.equal(Number.isInteger(nAffectedRowCount), true, "base mock affected-row count");

			return BigInt(nAffectedRowCount);
		}, Options, Callback);
	},

	IsConnected(hConnectionHandle, Options, Callback) {
		RunSOCIRequest(() => g_BaseSOCI.IsConnected(hConnectionHandle), Options, Callback);
	},

	Query(hConnectionHandle, strStatementText, StatementParameters, Options, Callback) {
		g_vecSOCICalls.push(["query", hConnectionHandle, strStatementText, StatementParameters]);
		RunSOCIRequest(() => {
			const vecQueryRows = g_BaseSOCI.Query(hConnectionHandle, strStatementText, StatementParameters);
			if ((g_FaultInjectedValueRow !== null) && (StatementParameters.namespace === "fault-values") && strStatementText.startsWith("SELECT uniqueid, setting_name")) {
				return [...vecQueryRows, g_FaultInjectedValueRow];
			}

			return vecQueryRows;
		}, Options, Callback);
	},

	Reconnect(hConnectionHandle, Options, Callback) {
		g_vecSOCICalls.push(["reconnect", hConnectionHandle]);
		RunSOCIRequest(() => g_BaseSOCI.Reconnect(hConnectionHandle), Options, Callback);
	},

	Rollback(hConnectionHandle, Options, Callback) {
		g_vecSOCICalls.push(["rollback", hConnectionHandle]);
		RunSOCIRequest(() => g_BaseSOCI.Rollback(hConnectionHandle), Options, Callback);
	},
};

function ExecuteDocumentationCodeBlock(strDocumentationCode, unDocumentationBlockIndex, SettingsStorageAPI) {
	const strDocumentationBlockPath = `${g_strSettingsStorageDocumentationPath}:block-${unDocumentationBlockIndex}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strSettingsStorageDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strRequestedModuleName) {
		g_Assert.equal(strRequestedModuleName, "settings/storage", `settings/storage code block ${unDocumentationBlockIndex} import`);

		return SettingsStorageAPI;
	};
	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strDocumentationCode, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: g_unDocumentationCompilationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function NormalizeHeadingAnchor(strHeadingText) {
	return strHeadingText.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ToPlainValue(SourceValue) {
	if (Array.isArray(SourceValue)) {
		const vecPlainEntries = [];
		for (const SourceEntry of SourceValue) {
			vecPlainEntries.push(ToPlainValue(SourceEntry));
		}

		return vecPlainEntries;
	}

	if ((SourceValue !== null) && (typeof SourceValue === "object")) {
		const PlainValue = {};
		for (const strPropertyName in SourceValue) {
			if (Object.hasOwn(SourceValue, strPropertyName)) {
				Object.defineProperty(PlainValue, strPropertyName, { configurable: true, enumerable: true, value: ToPlainValue(SourceValue[strPropertyName]), writable: true });
			}
		}

		return PlainValue;
	}

	return SourceValue;
}

function CountSOCIOperations(strSOCIOperationName) {
	let unSOCIOperationCount = 0;
	for (const vecSOCICall of g_vecSOCICalls) {
		if (vecSOCICall[0] === strSOCIOperationName) {
			unSOCIOperationCount += 1;
		}
	}

	return unSOCIOperationCount;
}

function CreatePostDefinitionFailureProxy(SettingsValueRecord, strPropertyNameToFail, PropertyValueToFail, PropertyDefinitionError) {
	let bShouldFailDefinition = true;

	return new Proxy(SettingsValueRecord, {
		defineProperty(TargetRecord, strPropertyName, PropertyDescriptor) {
			const bPropertyDefinitionResult = Reflect.defineProperty(TargetRecord, strPropertyName, PropertyDescriptor);
			if (bShouldFailDefinition && (strPropertyName === strPropertyNameToFail) && (PropertyDescriptor.value === PropertyValueToFail)) {
				bShouldFailDefinition = false;
				throw PropertyDefinitionError;
			}

			return bPropertyDefinitionResult;
		},
	});
}

function CreatePostDeletionFailureProxy(SettingsValueRecord, strPropertyNameToFail, PropertyDeletionError) {
	let bShouldFailDeletion = true;

	return new Proxy(SettingsValueRecord, {
		deleteProperty(TargetRecord, strPropertyName) {
			const bPropertyDeletionResult = Reflect.deleteProperty(TargetRecord, strPropertyName);
			if (bShouldFailDeletion && (strPropertyName === strPropertyNameToFail)) {
				bShouldFailDeletion = false;
				throw PropertyDeletionError;
			}

			return bPropertyDeletionResult;
		},
	});
}

function VerifyDocumentationContentsAnchors(strDocumentationMarkdown) {
	const vecDocumentationContentsMatch = strDocumentationMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecDocumentationContentsMatch, "settings/storage contents section");

	const vecDocumentedSectionAnchors = [];
	const vecActualSectionAnchors = [];

	for (const vecDocumentedSectionAnchorMatch of vecDocumentationContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedSectionAnchors.push(vecDocumentedSectionAnchorMatch[1]);
	}

	for (const vecDocumentationSectionHeadingMatch of strDocumentationMarkdown.matchAll(/^## (.+)$/gm)) {
		const strActualSectionAnchor = NormalizeHeadingAnchor(vecDocumentationSectionHeadingMatch[1]);
		if (strActualSectionAnchor !== "contents") {
			vecActualSectionAnchors.push(strActualSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedSectionAnchors, vecActualSectionAnchors, "settings/storage contents anchors");
}

function VerifyDocumentationLinks(strDocumentationMarkdown) {
	const strDocumentationWithoutCode = strDocumentationMarkdown.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationLinkTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationLinkTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLinkTarget)) {
			continue;
		}

		const nFragmentSeparatorIndex = strDocumentationLinkTarget.indexOf("#");
		const strDocumentationTargetFileName = (nFragmentSeparatorIndex === -1) ? strDocumentationLinkTarget : strDocumentationLinkTarget.slice(0, nFragmentSeparatorIndex);
		const strDocumentationTargetFilePath = g_Path.resolve(g_Path.dirname(g_strSettingsStorageDocumentationPath), strDocumentationTargetFileName);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetFilePath), `settings/storage documentation link must exist: ${strDocumentationLinkTarget}`);
	}
}

const g_vecEnsuredDirectories = [];

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned settings/storage fixture property must be removable: " + strKey);
}

function ReleaseSettingsStorageFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	if (g_bLoaderOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		});
	}

	if (g_bPackageCacheOwned) {
		const unPreviousFailureCount = vecFailures.length;
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}

		if (vecFailures.length === unPreviousFailureCount) {
			g_bPackageCacheOwned = false;
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
			g_bSourceJSOwned = false;
		});
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Settings/storage fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseSettingsStorageFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Settings/storage runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Settings/storage loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed settings/storage cache entries must support exact restoration.");
}

// Exit cleanup also covers early synchronous assertion failures.
process.once("exit", ReleaseSettingsStorageFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

g_bSourceJSOwned = true;
Object.defineProperty(globalThis, "sourcejs", {
	configurable: true,
	enumerable: true,
	writable: true,
	value: {
		settings: {
			EnsureDirectoryExists(strDirectoryPath) {
				g_vecEnsuredDirectories.push(strDirectoryPath);

				return true;
			},

			Root: "memory/settings",
		},

		soci: g_SOCI,
	},
});

g_bLoaderOwned = true;
Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	value: function LoadSourceJSModule(strRequest, Parent, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, Parent, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, Parent, bIsMain);
	},
});

let g_SettingsStorageAPI = null;

try {
	g_SettingsStorageAPI = require(g_strSettingsStorageSourcePath);
} finally {
	RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;
}

g_Assert.deepEqual(Object.keys(g_SettingsStorageAPI), g_vecExpectedSettingsStorageExports, "settings/storage exact export order");

g_Assert.deepEqual(Object.getOwnPropertyNames(g_SettingsStorageAPI.SettingsStorage.prototype).sort(), [
	"Backend",
	"ClearPlayer",
	"ClearSettings",
	"Close",
	"ConnectionString",
	"CreateSchema",
	"Data",
	"DeleteSetting",
	"EnsureLoaded",
	"EnsurePlayer",
	"Entries",
	"ForEach",
	"GetAllSettings",
	"GetCachedPlayerValues",
	"GetCachedSettings",
	"GetPlayerValues",
	"GetSetting",
	"GetSettingsForPlayer",
	"Handle",
	"HasPlayer",
	"InsertValue",
	"Keys",
	"LoadPlayerValues",
	"LoadSettingsIfNeeded",
	"Loaded",
	"Namespace",
	"OnLevelShutdown",
	"Open",
	"OpenSession",
	"Options",
	"Path",
	"Reload",
	"ReloadSettings",
	"RunTransaction",
	"RunTransactionRequest",
	"Save",
	"SetSetting",
	"Values",
	"constructor",
].sort(), "SettingsStorage members");
g_Assert.equal(typeof g_SettingsStorageAPI.SettingsStorage.prototype[Symbol.iterator], "function", "SettingsStorage iterator");

g_Assert.deepEqual(Object.getOwnPropertyNames(g_SettingsStorageAPI.PlayerSettingsView.prototype).sort(), [
	"ClearSettings",
	"constructor",
	"DeleteSetting",
	"Entries",
	"ForEach",
	"GetCachedValues",
	"GetSetting",
	"HasSetting",
	"Keys",
	"SetSetting",
	"Size",
	"Storage",
	"UniqueID",
	"Values",
].sort(), "PlayerSettingsView members");
g_Assert.equal(typeof g_SettingsStorageAPI.PlayerSettingsView.prototype[Symbol.iterator], "function", "PlayerSettingsView iterator");

g_Assert.equal(g_SettingsStorageAPI.ROOT, "memory/settings", "settings storage root");
g_Assert.ok(g_SettingsStorageAPI.DEFAULT_STORAGE instanceof g_SettingsStorageAPI.SettingsStorage, "default storage type");
g_Assert.equal(g_SettingsStorageAPI.DEFAULT_STORAGE.Handle, null, "default storage opens lazily");
g_Assert.deepEqual(g_SettingsStorageAPI.SettingsStorage.Options, { Backend: "sqlite3", ConnectionString: null, DatabasePath: null }, "static storage defaults");

const g_PlayerSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.test", { DatabasePath: "memory/settings/test.sqlite3" });
const g_GetterBackedSettingsStorageOptions = {};
let g_unDatabasePathReadCount = 0;
Object.defineProperty(g_GetterBackedSettingsStorageOptions, "DatabasePath", {
	enumerable: true,

	get() {
		g_unDatabasePathReadCount += 1;

		return "memory/settings/getter.sqlite3";
	},
});

const g_GetterBackedSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.getter", g_GetterBackedSettingsStorageOptions);
const g_strPlayerUniqueID = "STEAM_1:1:1";

g_Assert.equal(g_PlayerSettingsStorage.Namespace, "players.test", "storage namespace");
g_Assert.equal(g_PlayerSettingsStorage.Path, "memory/settings/test.sqlite3", "database path");
g_Assert.equal(g_PlayerSettingsStorage.Backend, "sqlite3", "default backend");
g_Assert.equal(g_PlayerSettingsStorage.ConnectionString, "dbname=memory/settings/test.sqlite3", "default connection string");
g_Assert.equal(g_unDatabasePathReadCount, 1, "storage options are read once during construction");
g_Assert.equal(g_GetterBackedSettingsStorage.Path, "memory/settings/getter.sqlite3", "getter-backed database path");
g_Assert.equal(Object.getPrototypeOf(g_PlayerSettingsStorage.Data), null, "top-level cache has no prototype");
g_Assert.equal(g_PlayerSettingsStorage.Loaded, false, "storage starts unloaded");

const g_MalformedLoadedSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.loaded", { DatabasePath: "memory/settings/loaded.sqlite3" });
const g_MalformedLoadedDataIdentity = g_MalformedLoadedSettingsStorage.Data;
const g_unSOCICallCountBeforeMalformedLoadedState = g_vecSOCICalls.length;

g_MalformedLoadedSettingsStorage.ValueLoaded = "loaded";
g_Assert.throws(() => RunBlockingSettingsRequest(g_MalformedLoadedSettingsStorage, "HasPlayer", ["STEAM_1:1:2"]), (LoadedStateTypeError) => {
	return (LoadedStateTypeError instanceof TypeError) && (LoadedStateTypeError.message === "Settings loaded state must be a boolean.");
}, "malformed loaded state is rejected before database access");
g_Assert.equal(g_vecSOCICalls.length, g_unSOCICallCountBeforeMalformedLoadedState, "malformed loaded state does not access SOCI");
g_Assert.equal(g_MalformedLoadedSettingsStorage.Handle, null, "malformed loaded state does not open a handle");
g_Assert.equal(g_MalformedLoadedSettingsStorage.Data, g_MalformedLoadedDataIdentity, "malformed loaded state preserves cache identity");

const g_MalformedSaveSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.save", { DatabasePath: "memory/settings/save.sqlite3" });
const g_strMalformedSavePlayerUniqueID = "STEAM_1:1:3";
const g_MalformedSaveDataIdentity = g_MalformedSaveSettingsStorage.Data;
const g_MalformedSavePlayerSettingsValues = Object.create(null);

g_MalformedSavePlayerSettingsValues.Object = {};
g_MalformedSaveSettingsStorage.Data[g_strMalformedSavePlayerUniqueID] = g_MalformedSavePlayerSettingsValues;
g_MalformedSaveSettingsStorage.ValueLoaded = true;

const g_unSOCICallCountBeforeMalformedSave = g_vecSOCICalls.length;

g_Assert.throws(() => RunBlockingSettingsRequest(g_MalformedSaveSettingsStorage, "Save"), (SettingsValueTypeError) => {
	return (SettingsValueTypeError instanceof TypeError) && (SettingsValueTypeError.message === "SettingsStorage values must be null, boolean, string, finite Number or BigInt.");
}, "malformed live settings value is rejected before saving");
g_Assert.equal(g_vecSOCICalls.length, g_unSOCICallCountBeforeMalformedSave, "malformed live settings value does not access SOCI");
g_Assert.equal(g_MalformedSaveSettingsStorage.Handle, null, "malformed live settings value does not open a handle");
g_Assert.equal(g_MalformedSaveSettingsStorage.Loaded, true, "malformed live settings value preserves loaded state");
g_Assert.equal(g_MalformedSaveSettingsStorage.Data, g_MalformedSaveDataIdentity, "malformed live settings value preserves cache identity");
g_Assert.equal(g_MalformedSaveSettingsStorage.Data[g_strMalformedSavePlayerUniqueID], g_MalformedSavePlayerSettingsValues, "malformed live settings value preserves player cache identity");

g_Assert.throws(() => new g_SettingsStorageAPI.SettingsStorage("bad namespace"), TypeError, "invalid namespaces are rejected");
g_Assert.throws(() => new g_SettingsStorageAPI.SettingsStorage("valid", null), TypeError, "null options are rejected");
g_Assert.throws(() => new g_SettingsStorageAPI.SettingsStorage("valid", []), TypeError, "array options are rejected");
g_Assert.throws(() => new g_SettingsStorageAPI.SettingsStorage("valid", { Backend: "" }), TypeError, "empty backends are rejected");
g_Assert.throws(() => new g_SettingsStorageAPI.SettingsStorage("valid", { ConnectionString: "" }), TypeError, "empty connection strings are rejected");

const g_hPlayerSettingsStorage = RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open");
g_Assert.ok(Number.isSafeInteger(g_hPlayerSettingsStorage) && (g_hPlayerSettingsStorage > 0), "open returns a numeric SOCI handle");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), g_hPlayerSettingsStorage, "open reuses a connected handle");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), g_hPlayerSettingsStorage, "repeated open keeps reusing the connected handle");

const g_OriginalSOCIIsConnected = g_SOCI.IsConnected;
const g_OriginalSOCIReconnect = g_SOCI.Reconnect;

try {
	g_SOCI.IsConnected = CreateSOCIResultOperation(1);

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), TypeError, "open requires an exact connected-state result");

	g_SOCI.IsConnected = CreateSOCIResultOperation(false);
	g_SOCI.Reconnect = CreateSOCIResultOperation(1);

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), TypeError, "open requires an exact reconnect result");

	g_SOCI.Reconnect = CreateSOCIResultOperation(false);

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), /soci\.Reconnect\(\) failed/, "open rejects a failed reconnect");

	g_SOCI.Reconnect = CreateSOCIResultOperation(true);

	g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Open"), g_hPlayerSettingsStorage, "open returns the reconnected SOCI handle");
} finally {
	g_SOCI.IsConnected = g_OriginalSOCIIsConnected;
	g_SOCI.Reconnect = g_OriginalSOCIReconnect;
}

let g_bSettingsStorageConnectionCallFound = false;
for (const [strSOCIOperationName, strSOCIConnectionString, strSOCIBackendName] of g_vecSOCICalls) {
	if ((strSOCIOperationName === "connect") && (strSOCIConnectionString === g_PlayerSettingsStorage.ConnectionString) && (strSOCIBackendName === "sqlite3")) {
		g_bSettingsStorageConnectionCallFound = true;
		break;
	}
}

g_Assert.deepEqual(g_vecEnsuredDirectories, [g_SettingsStorageAPI.ROOT], "open ensures the storage root once");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "CreateSchema"), true, "CreateSchema succeeds for the current handle");
g_Assert.equal(g_bSettingsStorageConnectionCallFound, true, "open forwards backend and connection string");

const g_OriginalSettingsEnsureDirectory = globalThis.sourcejs.settings.EnsureDirectoryExists;
const g_InvalidDirectoryResultSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.invalidDirectoryResult");

try {
	globalThis.sourcejs.settings.EnsureDirectoryExists = () => 1;
	g_Assert.throws(() => RunBlockingSettingsRequest(g_InvalidDirectoryResultSettingsStorage, "Open"), TypeError, "open requires an exact directory result");
} finally {
	globalThis.sourcejs.settings.EnsureDirectoryExists = g_OriginalSettingsEnsureDirectory;
}

g_Assert.equal(g_InvalidDirectoryResultSettingsStorage.Handle, null, "invalid directory result does not create a SOCI handle");

const g_OriginalSOCIExecute = g_SOCI.Execute;
const g_SchemaCreationError = new Error("schema failure");
const g_SchemaFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.schemaFailure");

try {
	g_SOCI.Execute = () => {
		throw g_SchemaCreationError;
	};

	g_Assert.throws(() => RunBlockingSettingsRequest(g_SchemaFailureSettingsStorage, "Open"), (ThrownSchemaCreationError) => {
		return ThrownSchemaCreationError === g_SchemaCreationError;
	}, "schema failure preserves the exact error");
} finally {
	g_SOCI.Execute = g_OriginalSOCIExecute;
}

g_Assert.equal(g_SchemaFailureSettingsStorage.Handle, null, "schema failure closes and clears the new SOCI handle");

const g_OriginalSOCIClose = g_SOCI.Close;
const g_SchemaCleanupError = new Error("schema cleanup failure");
const g_SchemaCleanupFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.schemaCleanupFailure");

try {
	g_SOCI.Execute = () => {
		throw g_SchemaCreationError;
	};

	g_SOCI.Close = () => {
		throw g_SchemaCleanupError;
	};

	g_Assert.throws(() => RunBlockingSettingsRequest(g_SchemaCleanupFailureSettingsStorage, "Open"), (SchemaCleanupAggregateError) => {
		g_Assert.ok(SchemaCleanupAggregateError instanceof AggregateError, "schema cleanup raises AggregateError");
		g_Assert.deepEqual(SchemaCleanupAggregateError.errors, [g_SchemaCreationError, g_SchemaCleanupError], "schema cleanup reports both failures");

		return true;
	}, "schema cleanup failure is aggregated");
} finally {
	g_SOCI.Execute = g_OriginalSOCIExecute;
	g_SOCI.Close = g_OriginalSOCIClose;
}

g_Assert.ok(Number.isSafeInteger(g_SchemaCleanupFailureSettingsStorage.Handle), "failed cleanup retains the new SOCI handle");
g_Assert.equal(RunBlockingSettingsRequest(g_SchemaCleanupFailureSettingsStorage, "Close"), true, "retained schema cleanup handle can be closed later");
g_Assert.equal(g_SchemaCleanupFailureSettingsStorage.Handle, null, "successful cleanup clears the retained SOCI handle");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "HasPlayer", [g_strPlayerUniqueID]), false, "missing player state");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Null", null]), true, "null write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Boolean False", false]), true, "false write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Boolean True", true]), true, "true write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Empty String", ""]), true, "empty string write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "String", "ready"]), true, "string write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Number", 12.5]), true, "number write");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "BigInt", g_nLargeSignedSettingsValue]), true, "BigInt write");

g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "NaN", Number.NaN]), TypeError, "NaN is rejected");
g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Infinity", Number.POSITIVE_INFINITY]), TypeError, "infinity is rejected");
g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strPlayerUniqueID, "Object", {}]), TypeError, "objects are rejected");

const g_PostDefinitionFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.definitionFailure", { DatabasePath: "memory/settings/definition-failure.sqlite3" });
const g_strPostDefinitionFailurePlayerUniqueID = "STEAM_1:1:4";

g_Assert.equal(RunBlockingSettingsRequest(g_PostDefinitionFailureSettingsStorage, "SetSetting", [g_strPostDefinitionFailurePlayerUniqueID, "Setting", "before"]), true, "post-definition failure storage creates its initial value");

const g_PostDefinitionFailureDataIdentity = g_PostDefinitionFailureSettingsStorage.Data;
const g_PostDefinitionFailureSettingsValueRecord = g_PostDefinitionFailureDataIdentity[g_strPostDefinitionFailurePlayerUniqueID];
const g_SettingsValueRecordUpdateError = new Error("settings-value-record-update");
const g_PostDefinitionFailureSettingsValueProxy = CreatePostDefinitionFailureProxy(g_PostDefinitionFailureSettingsValueRecord, "Setting", "after", g_SettingsValueRecordUpdateError);

g_PostDefinitionFailureDataIdentity[g_strPostDefinitionFailurePlayerUniqueID] = g_PostDefinitionFailureSettingsValueProxy;

const g_unRollbackCountBeforeSettingsValueRecordUpdateFailure = CountSOCIOperations("rollback");

g_Assert.throws(() => RunBlockingSettingsRequest(g_PostDefinitionFailureSettingsStorage, "SetSetting", [g_strPostDefinitionFailurePlayerUniqueID, "Setting", "after"]), (ThrownSettingsValueRecordUpdateError) => ThrownSettingsValueRecordUpdateError === g_SettingsValueRecordUpdateError, "post-definition failure preserves the exact update error");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeSettingsValueRecordUpdateFailure + 1, "post-definition failure rolls back the SQL transaction exactly once");
g_Assert.equal(g_PostDefinitionFailureSettingsStorage.Data, g_PostDefinitionFailureDataIdentity, "post-definition failure preserves the top-level cache identity");
g_Assert.equal(g_PostDefinitionFailureDataIdentity[g_strPostDefinitionFailurePlayerUniqueID], g_PostDefinitionFailureSettingsValueProxy, "post-definition failure preserves the player cache identity");
g_Assert.equal(g_PostDefinitionFailureSettingsValueProxy.Setting, "before", "post-definition failure restores the original live value");

const g_DefinitionRollbackFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.definitionRollbackFailure", { DatabasePath: "memory/settings/definition-rollback-failure.sqlite3" });
const g_strDefinitionRollbackFailurePlayerUniqueID = "STEAM_1:1:5";

g_Assert.equal(RunBlockingSettingsRequest(g_DefinitionRollbackFailureSettingsStorage, "SetSetting", [g_strDefinitionRollbackFailurePlayerUniqueID, "Setting", "before"]), true, "definition rollback failure storage creates its initial value");

const g_DefinitionRollbackFailureDataIdentity = g_DefinitionRollbackFailureSettingsStorage.Data;
const g_DefinitionRollbackFailureSettingsValueRecord = g_DefinitionRollbackFailureDataIdentity[g_strDefinitionRollbackFailurePlayerUniqueID];
const g_SettingsValueRecordRollbackError = new Error("settings-value-record-rollback");
const g_DefinitionRollbackFailureProxy = CreatePostDefinitionFailureProxy(g_DefinitionRollbackFailureSettingsValueRecord, "Setting", "before", g_SettingsValueRecordRollbackError);
const g_SettingsValueRecordUpdateAndRollbackError = new Error("settings-value-record-update-and-rollback");
const g_DefinitionUpdateAndRollbackFailureProxy = CreatePostDefinitionFailureProxy(g_DefinitionRollbackFailureProxy, "Setting", "after", g_SettingsValueRecordUpdateAndRollbackError);

g_DefinitionRollbackFailureDataIdentity[g_strDefinitionRollbackFailurePlayerUniqueID] = g_DefinitionUpdateAndRollbackFailureProxy;

const g_unRollbackCountBeforeSettingsValueRecordRollbackFailure = CountSOCIOperations("rollback");

g_Assert.throws(() => RunBlockingSettingsRequest(g_DefinitionRollbackFailureSettingsStorage, "SetSetting", [g_strDefinitionRollbackFailurePlayerUniqueID, "Setting", "after"]), (SettingsValueRecordAggregateError) => {
	return (SettingsValueRecordAggregateError instanceof AggregateError) && (SettingsValueRecordAggregateError.message === "Settings value record update failed and rollback was unsuccessful.") && (SettingsValueRecordAggregateError.errors.length === 2) && (SettingsValueRecordAggregateError.errors[0] === g_SettingsValueRecordUpdateAndRollbackError) && (SettingsValueRecordAggregateError.errors[1] === g_SettingsValueRecordRollbackError);
}, "definition rollback failure reports both errors in operation order");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeSettingsValueRecordRollbackFailure + 1, "definition rollback failure rolls back the SQL transaction exactly once");
g_Assert.equal(g_DefinitionRollbackFailureSettingsStorage.Data, g_DefinitionRollbackFailureDataIdentity, "definition rollback failure preserves the top-level cache identity");
g_Assert.equal(g_DefinitionRollbackFailureDataIdentity[g_strDefinitionRollbackFailurePlayerUniqueID], g_DefinitionUpdateAndRollbackFailureProxy, "definition rollback failure preserves the player cache identity");
g_Assert.equal(g_DefinitionUpdateAndRollbackFailureProxy.Setting, "before", "definition rollback failure leaves the original value in memory");

const g_DeletionFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.deletionFailure", { DatabasePath: "memory/settings/deletion-failure.sqlite3" });
const g_strDeletionFailurePlayerUniqueID = "STEAM_1:1:6";

g_Assert.equal(RunBlockingSettingsRequest(g_DeletionFailureSettingsStorage, "SetSetting", [g_strDeletionFailurePlayerUniqueID, "Setting", "before"]), true, "deletion failure storage creates its initial value");

const g_DeletionFailureDataIdentity = g_DeletionFailureSettingsStorage.Data;
const g_DeletionFailureSettingsValueRecord = g_DeletionFailureDataIdentity[g_strDeletionFailurePlayerUniqueID];
const g_DeletionFailureSettingDescriptor = Object.getOwnPropertyDescriptor(g_DeletionFailureSettingsValueRecord, "Setting");
const g_SettingsValueRecordDeletionError = new Error("settings-value-record-deletion");
const g_PostDeletionFailureProxy = CreatePostDeletionFailureProxy(g_DeletionFailureSettingsValueRecord, "Setting", g_SettingsValueRecordDeletionError);

g_DeletionFailureDataIdentity[g_strDeletionFailurePlayerUniqueID] = g_PostDeletionFailureProxy;

const g_unRollbackCountBeforeSettingsValueRecordDeletionFailure = CountSOCIOperations("rollback");

g_Assert.throws(() => RunBlockingSettingsRequest(g_DeletionFailureSettingsStorage, "DeleteSetting", [g_strDeletionFailurePlayerUniqueID, "Setting"]), (SettingsValueRecordError) => SettingsValueRecordError === g_SettingsValueRecordDeletionError, "deletion failure rethrows the exact cache update error");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeSettingsValueRecordDeletionFailure + 1, "deletion failure rolls back the SQL transaction exactly once");
g_Assert.equal(g_DeletionFailureSettingsStorage.Data, g_DeletionFailureDataIdentity, "deletion failure preserves the top-level cache identity");
g_Assert.equal(g_DeletionFailureDataIdentity[g_strDeletionFailurePlayerUniqueID], g_PostDeletionFailureProxy, "deletion failure preserves the player cache identity");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_PostDeletionFailureProxy, "Setting"), g_DeletionFailureSettingDescriptor, "deletion failure restores the original setting descriptor");
g_Assert.equal(g_PostDeletionFailureProxy.Setting, "before", "deletion failure restores the original setting value");

const g_ClearPlayerFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.clearPlayerFailure", { DatabasePath: "memory/settings/clear-player-failure.sqlite3" });
const g_strClearPlayerFailurePlayerUniqueID = "STEAM_1:1:7";

g_Assert.equal(RunBlockingSettingsRequest(g_ClearPlayerFailureSettingsStorage, "SetSetting", [g_strClearPlayerFailurePlayerUniqueID, "Setting", "before"]), true, "ClearPlayer failure storage creates its initial value");

const g_ClearPlayerFailureDataRecord = g_ClearPlayerFailureSettingsStorage.Data;
const g_ClearPlayerFailureSettingsValueRecord = g_ClearPlayerFailureDataRecord[g_strClearPlayerFailurePlayerUniqueID];
const g_ClearPlayerFailureDescriptor = Object.getOwnPropertyDescriptor(g_ClearPlayerFailureDataRecord, g_strClearPlayerFailurePlayerUniqueID);
const g_ClearPlayerCacheDeletionError = new Error("clear-player-cache-deletion");
const g_ClearPlayerFailureDataProxy = CreatePostDeletionFailureProxy(g_ClearPlayerFailureDataRecord, g_strClearPlayerFailurePlayerUniqueID, g_ClearPlayerCacheDeletionError);

g_ClearPlayerFailureSettingsStorage.ValueData = g_ClearPlayerFailureDataProxy;

const g_unRollbackCountBeforeClearPlayerCacheFailure = CountSOCIOperations("rollback");

g_Assert.throws(() => RunBlockingSettingsRequest(g_ClearPlayerFailureSettingsStorage, "ClearPlayer", [g_strClearPlayerFailurePlayerUniqueID]), (SettingsDataUpdateError) => SettingsDataUpdateError === g_ClearPlayerCacheDeletionError, "ClearPlayer failure rethrows the exact cache update error");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeClearPlayerCacheFailure + 1, "ClearPlayer failure rolls back the SQL transaction exactly once");
g_Assert.equal(g_ClearPlayerFailureSettingsStorage.Data, g_ClearPlayerFailureDataProxy, "ClearPlayer failure preserves the top-level cache identity");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_ClearPlayerFailureDataProxy, g_strClearPlayerFailurePlayerUniqueID), g_ClearPlayerFailureDescriptor, "ClearPlayer failure restores the original player descriptor");
g_Assert.equal(g_ClearPlayerFailureDataProxy[g_strClearPlayerFailurePlayerUniqueID], g_ClearPlayerFailureSettingsValueRecord, "ClearPlayer failure restores the original player record identity");
g_Assert.equal(g_ClearPlayerFailureSettingsValueRecord.Setting, "before", "ClearPlayer failure restores the original setting value");

const g_ClearFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.clearFailure", { DatabasePath: "memory/settings/clear-failure.sqlite3" });
const g_strFirstClearFailurePlayerUniqueID = "STEAM_1:1:8";
const g_strSecondClearFailurePlayerUniqueID = "STEAM_1:1:9";

g_Assert.equal(RunBlockingSettingsRequest(g_ClearFailureSettingsStorage, "SetSetting", [g_strFirstClearFailurePlayerUniqueID, "Setting", "first"]), true, "clear failure storage creates its first value");
g_Assert.equal(RunBlockingSettingsRequest(g_ClearFailureSettingsStorage, "SetSetting", [g_strSecondClearFailurePlayerUniqueID, "Setting", "second"]), true, "clear failure storage creates its second value");

const g_ClearFailureDataRecord = g_ClearFailureSettingsStorage.Data;
const g_FirstClearFailureSettingsValueRecord = g_ClearFailureDataRecord[g_strFirstClearFailurePlayerUniqueID];
const g_SecondClearFailureSettingsValueRecord = g_ClearFailureDataRecord[g_strSecondClearFailurePlayerUniqueID];
const g_FirstClearFailurePlayerDescriptor = Object.getOwnPropertyDescriptor(g_ClearFailureDataRecord, g_strFirstClearFailurePlayerUniqueID);
const g_SecondClearFailurePlayerDescriptor = Object.getOwnPropertyDescriptor(g_ClearFailureDataRecord, g_strSecondClearFailurePlayerUniqueID);
const g_ClearCacheDeletionError = new Error("clear-cache-deletion");
const g_ClearFailureDataProxy = CreatePostDeletionFailureProxy(g_ClearFailureDataRecord, g_strSecondClearFailurePlayerUniqueID, g_ClearCacheDeletionError);

g_ClearFailureSettingsStorage.ValueData = g_ClearFailureDataProxy;

const g_unRollbackCountBeforeClearCacheFailure = CountSOCIOperations("rollback");

g_Assert.throws(() => RunBlockingSettingsRequest(g_ClearFailureSettingsStorage, "ClearSettings"), (SettingsDataUpdateError) => SettingsDataUpdateError === g_ClearCacheDeletionError, "ClearSettings failure rethrows the exact cache update error");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeClearCacheFailure + 1, "ClearSettings failure rolls back the SQL transaction exactly once");
g_Assert.equal(g_ClearFailureSettingsStorage.Data, g_ClearFailureDataProxy, "ClearSettings failure preserves the top-level cache identity");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_ClearFailureDataProxy, g_strFirstClearFailurePlayerUniqueID), g_FirstClearFailurePlayerDescriptor, "ClearSettings failure restores the first player descriptor");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_ClearFailureDataProxy, g_strSecondClearFailurePlayerUniqueID), g_SecondClearFailurePlayerDescriptor, "ClearSettings failure restores the second player descriptor");
g_Assert.equal(g_ClearFailureDataProxy[g_strFirstClearFailurePlayerUniqueID], g_FirstClearFailureSettingsValueRecord, "ClearSettings failure restores the first player record identity");
g_Assert.equal(g_ClearFailureDataProxy[g_strSecondClearFailurePlayerUniqueID], g_SecondClearFailureSettingsValueRecord, "ClearSettings failure restores the second player record identity");
g_Assert.equal(g_FirstClearFailureSettingsValueRecord.Setting, "first", "ClearSettings failure restores the first setting value");
g_Assert.equal(g_SecondClearFailureSettingsValueRecord.Setting, "second", "ClearSettings failure restores the second setting value");

const g_CommitFailureCacheRestoreSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.CommitFailureCacheRestore", { DatabasePath: "memory/settings/commit-failure-cache-restore.sqlite3" });
const g_strCommitFailureCacheRestorePlayerUniqueID = "STEAM_1:1:12";

g_Assert.equal(RunBlockingSettingsRequest(g_CommitFailureCacheRestoreSettingsStorage, "SetSetting", [g_strCommitFailureCacheRestorePlayerUniqueID, "Setting", "before"]), true, "commit failure cache-restore storage creates its baseline value");

const g_CommitFailureCacheRestoreDataRecord = g_CommitFailureCacheRestoreSettingsStorage.Data;
const g_CommitFailureCacheRestoreSettingsValueRecord = g_CommitFailureCacheRestoreDataRecord[g_strCommitFailureCacheRestorePlayerUniqueID];
const g_CommitFailureCacheRestoreSettingDescriptor = Object.getOwnPropertyDescriptor(g_CommitFailureCacheRestoreSettingsValueRecord, "Setting");
const g_OriginalSOCICommitForCacheRestore = g_SOCI.Commit;
const g_unRollbackCountBeforeCommitCacheRestore = CountSOCIOperations("rollback");

try {
	g_SOCI.Commit = CreateSOCIResultOperation(false);

	g_Assert.throws(() => RunBlockingSettingsRequest(g_CommitFailureCacheRestoreSettingsStorage, "SetSetting", [g_strCommitFailureCacheRestorePlayerUniqueID, "Setting", "after"]), (CommitFailureError) => {
		return (CommitFailureError instanceof Error) && !(CommitFailureError instanceof TypeError) && (CommitFailureError.message === "soci.Commit() failed.");
	}, "Commit failure after cache replacement preserves the exact error contract");
	g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeCommitCacheRestore + 1, "Commit failure after cache replacement rolls back SQL exactly once");
	g_Assert.equal(g_CommitFailureCacheRestoreSettingsStorage.Data, g_CommitFailureCacheRestoreDataRecord, "Commit failure after cache replacement preserves the top-level cache identity");
	g_Assert.equal(g_CommitFailureCacheRestoreDataRecord[g_strCommitFailureCacheRestorePlayerUniqueID], g_CommitFailureCacheRestoreSettingsValueRecord, "Commit failure after cache replacement preserves the player record identity");
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_CommitFailureCacheRestoreSettingsValueRecord, "Setting"), g_CommitFailureCacheRestoreSettingDescriptor, "Commit failure after cache replacement restores the setting descriptor");
	g_Assert.equal(g_CommitFailureCacheRestoreSettingsValueRecord.Setting, "before", "Commit failure after cache replacement restores the setting value");
} finally {
	g_SOCI.Commit = g_OriginalSOCICommitForCacheRestore;
}

const g_CacheRestoreFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.cacheRestoreFailure", { DatabasePath: "memory/settings/cache-restore-failure.sqlite3" });
const g_strCacheRestoreFailurePlayerUniqueID = "STEAM_1:1:13";

g_Assert.equal(RunBlockingSettingsRequest(g_CacheRestoreFailureSettingsStorage, "SetSetting", [g_strCacheRestoreFailurePlayerUniqueID, "Setting", "before"]), true, "cache-restore failure storage creates its baseline value");

const g_CacheRestoreFailureDataRecord = g_CacheRestoreFailureSettingsStorage.Data;
const g_CacheRestoreFailureSettingsValueRecord = g_CacheRestoreFailureDataRecord[g_strCacheRestoreFailurePlayerUniqueID];
const g_CommitFailureAfterCacheReplacementError = new Error("commit-after-cache-replacement");
const g_SettingsValueRecordRestoreFailureError = new Error("settings-value-record-restore-failure");
const g_CacheRestoreFailureProxy = CreatePostDefinitionFailureProxy(g_CacheRestoreFailureSettingsValueRecord, "Setting", "before", g_SettingsValueRecordRestoreFailureError);

g_CacheRestoreFailureDataRecord[g_strCacheRestoreFailurePlayerUniqueID] = g_CacheRestoreFailureProxy;

const g_OriginalSOCICommitForRestoreFailure = g_SOCI.Commit;
const g_unRollbackCountBeforeCacheRestoreFailure = CountSOCIOperations("rollback");

try {
	g_SOCI.Commit = () => {
		throw g_CommitFailureAfterCacheReplacementError;
	};

	g_Assert.throws(() => RunBlockingSettingsRequest(g_CacheRestoreFailureSettingsStorage, "SetSetting", [g_strCacheRestoreFailurePlayerUniqueID, "Setting", "after"]), (SettingsTransactionAndCacheRestoreAggregateError) => {
		return (SettingsTransactionAndCacheRestoreAggregateError instanceof AggregateError) && (SettingsTransactionAndCacheRestoreAggregateError.message === "Settings transaction failed and the live value record could not be restored.") && (SettingsTransactionAndCacheRestoreAggregateError.errors.length === 2) && (SettingsTransactionAndCacheRestoreAggregateError.errors[0] === g_CommitFailureAfterCacheReplacementError) && (SettingsTransactionAndCacheRestoreAggregateError.errors[1] === g_SettingsValueRecordRestoreFailureError);
	}, "cache-restore failure reports transaction and restore errors in operation order");
	g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeCacheRestoreFailure + 1, "cache-restore failure rolls back SQL exactly once");
	g_Assert.equal(g_CacheRestoreFailureSettingsStorage.Data, g_CacheRestoreFailureDataRecord, "cache-restore failure preserves the top-level cache identity");
	g_Assert.equal(g_CacheRestoreFailureDataRecord[g_strCacheRestoreFailurePlayerUniqueID], g_CacheRestoreFailureProxy, "cache-restore failure preserves the player record identity");
	g_Assert.equal(g_CacheRestoreFailureProxy.Setting, "after", "cache-restore failure retains the replacement value after failed restoration");
} finally {
	g_SOCI.Commit = g_OriginalSOCICommitForRestoreFailure;
}

const g_InvalidNamespaceSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.invalidNamespace", { DatabasePath: "memory/settings/invalid-namespace.sqlite3" });
const g_strInvalidNamespacePlayerUniqueID = "STEAM_1:1:14";
const g_InvalidNamespaceDataIdentity = g_InvalidNamespaceSettingsStorage.Data;
const g_unSOCICallCountBeforeInvalidNamespaceValidation = g_vecSOCICalls.length;
const g_strInvalidNamespaceValidationErrorMessage = "Settings namespace must contain only letters, digits, dots, underscores and hyphens.";

g_InvalidNamespaceSettingsStorage.ValueNamespace = "";

const g_vecInvalidNamespaceDirectArgumentOperations = [
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "SetSetting", ["", "", {}]), ExpectedErrorMessage: "Player unique ID must be a non-empty string.", OperationName: "SetSetting player unique ID validation" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "SetSetting", [g_strInvalidNamespacePlayerUniqueID, "", {}]), ExpectedErrorMessage: "Setting name must be a non-empty string.", OperationName: "SetSetting setting name validation" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "SetSetting", [g_strInvalidNamespacePlayerUniqueID, "Setting", {}]), ExpectedErrorMessage: "SettingsStorage values must be null, boolean, string, finite Number or BigInt.", OperationName: "SetSetting value validation" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "DeleteSetting", ["", ""]), ExpectedErrorMessage: "Player unique ID must be a non-empty string.", OperationName: "DeleteSetting player unique ID validation" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "DeleteSetting", [g_strInvalidNamespacePlayerUniqueID, ""]), ExpectedErrorMessage: "Setting name must be a non-empty string.", OperationName: "DeleteSetting setting name validation" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "ClearPlayer", [""]), ExpectedErrorMessage: "Player unique ID must be a non-empty string.", OperationName: "ClearPlayer unique ID validation" },
];
for (const InvalidNamespaceDirectArgumentOperation of g_vecInvalidNamespaceDirectArgumentOperations) {
	g_Assert.throws(InvalidNamespaceDirectArgumentOperation.ExecuteSettingsStorageOperation, (DirectArgumentTypeError) => {
		return (DirectArgumentTypeError instanceof TypeError) && (DirectArgumentTypeError.message === InvalidNamespaceDirectArgumentOperation.ExpectedErrorMessage);
	}, `${InvalidNamespaceDirectArgumentOperation.OperationName} precedes editable namespace validation`);
}

const g_vecInvalidNamespaceSettingsOperations = [
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "SetSetting", [g_strInvalidNamespacePlayerUniqueID, "Setting", null]), OperationName: "SetSetting" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "DeleteSetting", [g_strInvalidNamespacePlayerUniqueID, "Setting"]), OperationName: "DeleteSetting" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "ClearPlayer", [g_strInvalidNamespacePlayerUniqueID]), OperationName: "ClearPlayer" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "ClearSettings"), OperationName: "ClearSettings" },
	{ ExecuteSettingsStorageOperation: () => RunBlockingSettingsRequest(g_InvalidNamespaceSettingsStorage, "Save"), OperationName: "Save" },
];
for (const InvalidNamespaceSettingsOperation of g_vecInvalidNamespaceSettingsOperations) {
	g_Assert.throws(InvalidNamespaceSettingsOperation.ExecuteSettingsStorageOperation, (SettingsNamespaceTypeError) => {
		return (SettingsNamespaceTypeError instanceof TypeError) && (SettingsNamespaceTypeError.message === g_strInvalidNamespaceValidationErrorMessage);
	}, `${InvalidNamespaceSettingsOperation.OperationName} validates the editable namespace before loading`);
}

g_Assert.equal(g_vecSOCICalls.length, g_unSOCICallCountBeforeInvalidNamespaceValidation, "invalid namespace validation does not access SOCI");
g_Assert.equal(g_InvalidNamespaceSettingsStorage.Handle, null, "invalid namespace validation does not open a handle");
g_Assert.equal(g_InvalidNamespaceSettingsStorage.Loaded, false, "invalid namespace validation preserves the unloaded state");
g_Assert.equal(g_InvalidNamespaceSettingsStorage.Data, g_InvalidNamespaceDataIdentity, "invalid namespace validation preserves the top-level cache identity");
g_Assert.equal(Reflect.ownKeys(g_InvalidNamespaceDataIdentity).length, 0, "invalid namespace validation does not mutate the cache");

const g_CloseFailureSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("players.CloseFailure", { DatabasePath: "memory/settings/close-failure.sqlite3" });

RunBlockingSettingsRequest(g_CloseFailureSettingsStorage, "Reload");

const g_hCloseFailureSettingsStorage = g_CloseFailureSettingsStorage.Handle;
const g_OriginalSOCICloseForRetainedState = g_SOCI.Close;
const g_vecInvalidSOCICloseResultOperations = [
	{ ExpectedErrorConstructor: Error, ExpectedErrorMessage: "soci.Close() failed.", OperationName: "false SOCI close result", SOCICloseResult: false },
	{ ExpectedErrorConstructor: TypeError, ExpectedErrorMessage: "soci.Close() callback result must be a boolean.", OperationName: "non-boolean SOCI close result", SOCICloseResult: 1 },
];

g_Assert.ok(Number.isSafeInteger(g_hCloseFailureSettingsStorage) && (g_hCloseFailureSettingsStorage > 0), "Close failure fixture opens a numeric SOCI handle");
g_Assert.equal(g_CloseFailureSettingsStorage.Loaded, true, "close failure fixture starts loaded");

for (const InvalidSOCICloseResultOperation of g_vecInvalidSOCICloseResultOperations) {
	let unSOCICloseInvocationCount = 0;

	try {
		g_SOCI.Close = (hConnectionHandle, Options, Callback) => {
			unSOCICloseInvocationCount += 1;

			g_Assert.equal(hConnectionHandle, g_hCloseFailureSettingsStorage, `${InvalidSOCICloseResultOperation.OperationName} receives the exact handle`);

			RunSOCIRequest(() => InvalidSOCICloseResultOperation.SOCICloseResult, Options, Callback);
		};

		g_Assert.throws(() => RunBlockingSettingsRequest(g_CloseFailureSettingsStorage, "Close"), (SOCICloseResultError) => {
			return (SOCICloseResultError.constructor === InvalidSOCICloseResultOperation.ExpectedErrorConstructor) && (SOCICloseResultError.message === InvalidSOCICloseResultOperation.ExpectedErrorMessage);
		}, `${InvalidSOCICloseResultOperation.OperationName} is rejected`);
	} finally {
		g_SOCI.Close = g_OriginalSOCICloseForRetainedState;
	}

	g_Assert.equal(unSOCICloseInvocationCount, 1, `${InvalidSOCICloseResultOperation.OperationName} invokes SOCI once`);
	g_Assert.equal(g_CloseFailureSettingsStorage.Handle, g_hCloseFailureSettingsStorage, `${InvalidSOCICloseResultOperation.OperationName} preserves the handle`);
	g_Assert.equal(g_CloseFailureSettingsStorage.Loaded, true, `${InvalidSOCICloseResultOperation.OperationName} preserves the loaded state`);
}

const g_SOCICloseFailureError = new Error("injected SOCI close failure");
let g_unThrowingSOCICloseInvocationCount = 0;

try {
	g_SOCI.Close = (hConnectionHandle) => {
		g_unThrowingSOCICloseInvocationCount += 1;

		g_Assert.equal(hConnectionHandle, g_hCloseFailureSettingsStorage, "throwing SOCI close receives the exact handle");

		throw g_SOCICloseFailureError;
	};

	g_Assert.throws(() => RunBlockingSettingsRequest(g_CloseFailureSettingsStorage, "Close"), (ThrownSOCICloseFailureError) => ThrownSOCICloseFailureError === g_SOCICloseFailureError, "SOCI close errors preserve their exact identity");
} finally {
	g_SOCI.Close = g_OriginalSOCICloseForRetainedState;
}

g_Assert.equal(g_unThrowingSOCICloseInvocationCount, 1, "throwing SOCI close is invoked once");
g_Assert.equal(g_CloseFailureSettingsStorage.Handle, g_hCloseFailureSettingsStorage, "throwing SOCI close preserves the handle");
g_Assert.equal(g_CloseFailureSettingsStorage.Loaded, true, "throwing SOCI close preserves the loaded state");
g_Assert.equal(RunBlockingSettingsRequest(g_CloseFailureSettingsStorage, "Close"), true, "successful Close releases the retained SOCI handle");
g_Assert.equal(g_CloseFailureSettingsStorage.Handle, null, "successful Close clears the retained handle");
g_Assert.equal(g_CloseFailureSettingsStorage.Loaded, false, "successful Close clears the loaded state");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Save"), true, "Save rewrites namespace rows");

const g_PlayerSettingsDataIdentity = g_PlayerSettingsStorage.Data;

RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Reload");

g_Assert.equal(g_PlayerSettingsStorage.Data, g_PlayerSettingsDataIdentity, "Reload preserves top-level cache identity");

const g_PlayerSettingsValuesIdentityBeforeMalformedQuery = RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetPlayerValues", [g_strPlayerUniqueID]);
const g_strPlayerSettingsStringBeforeMalformedQuery = RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "String", null]);
const g_hPlayerSettingsHandleBeforeMalformedQuery = g_PlayerSettingsStorage.Handle;
const g_bPlayerSettingsLoadedStateBeforeMalformedQuery = g_PlayerSettingsStorage.Loaded;
const g_OriginalSOCIQuery = g_SOCI.Query;
let g_unMalformedSOCIQueryCallCount = 0;

try {
	g_SOCI.Query = (hConnectionHandle, strStatementText, StatementParameters, Options, Callback) => {
		g_unMalformedSOCIQueryCallCount += 1;
		RunSOCIRequest(() => ({}), Options, Callback);
	};

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Reload"), (QueryResultTypeError) => {
		return (QueryResultTypeError instanceof TypeError) && (QueryResultTypeError.message === "soci.Query() callback result must be an array.");
	}, "malformed SOCI query result is rejected");
} finally {
	g_SOCI.Query = g_OriginalSOCIQuery;
}

g_Assert.equal(g_unMalformedSOCIQueryCallCount, 1, "malformed SOCI query result is read once");
g_Assert.equal(g_PlayerSettingsStorage.Data, g_PlayerSettingsDataIdentity, "malformed SOCI query result preserves top-level cache identity");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetPlayerValues", [g_strPlayerUniqueID]), g_PlayerSettingsValuesIdentityBeforeMalformedQuery, "malformed SOCI query result preserves player cache identity");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "String", null]), g_strPlayerSettingsStringBeforeMalformedQuery, "malformed SOCI query result preserves cached values");
g_Assert.equal(g_PlayerSettingsStorage.Handle, g_hPlayerSettingsHandleBeforeMalformedQuery, "malformed SOCI query result preserves the SOCI handle");
g_Assert.equal(g_PlayerSettingsStorage.Loaded, g_bPlayerSettingsLoadedStateBeforeMalformedQuery, "malformed SOCI query result preserves loaded state");
g_Assert.equal(Object.getPrototypeOf(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetPlayerValues", [g_strPlayerUniqueID])), null, "player records have no prototype");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Null", null]), null, "Reload null");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Boolean False", null]), false, "Reload false");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Boolean True", null]), true, "Reload true");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Empty String", null]), "", "Reload empty string");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "String", null]), "ready", "Reload string");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Number", null]), 12.5, "Reload number");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "BigInt", null]), g_nLargeSignedSettingsValue, "Reload BigInt");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strPlayerUniqueID, "Missing", "default"]), "default", "GetSetting default value");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", ["__proto__", "__proto__", "safe"]), true, "prototype-like keys are accepted as data");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", ["__proto__", "__proto__", null]), "safe", "prototype-like keys remain ordinary values");
g_Assert.equal(Object.getPrototypeOf(g_PlayerSettingsStorage.Data), null, "prototype-like IDs do not change cache prototype");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Save"), true, "Save persists prototype-like keys");

const g_PlayerSettingsView = g_PlayerSettingsStorage.GetSettingsForPlayer(g_strPlayerUniqueID);
g_Assert.ok(g_PlayerSettingsView instanceof g_SettingsStorageAPI.PlayerSettingsView, "GetSettingsForPlayer returns PlayerSettingsView");
g_Assert.equal(g_PlayerSettingsView.Storage, g_PlayerSettingsStorage, "view storage");
g_Assert.equal(g_PlayerSettingsView.UniqueID, g_strPlayerUniqueID, "view unique ID");
g_Assert.equal(g_PlayerSettingsView.Size, 7, "view size");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "HasSetting", ["String"]), true, "HasSetting finds the view value");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "GetSetting", ["String", null]), "ready", "GetSetting reads the view value");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "SetSetting", ["Theme", "dark"]), true, "SetSetting updates the view");

const g_LivePlayerSettingsValues = RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetPlayerValues", [g_strPlayerUniqueID]);
const g_vecFirstPlayerSettingsViewKeys = g_PlayerSettingsView.Keys();
const g_vecSecondPlayerSettingsViewKeys = g_PlayerSettingsView.Keys();
const g_vecFirstPlayerSettingsViewEntries = g_PlayerSettingsView.Entries();
const g_vecSecondPlayerSettingsViewEntries = g_PlayerSettingsView.Entries();

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "Values"), g_LivePlayerSettingsValues, "Values deliver the exact live record");
g_Assert.equal(g_PlayerSettingsView.GetCachedValues(), g_LivePlayerSettingsValues, "GetCachedValues returns the exact live record without a request");
g_Assert.notEqual(g_vecFirstPlayerSettingsViewKeys, g_vecSecondPlayerSettingsViewKeys, "view keys return fresh arrays");
g_Assert.deepEqual(g_vecFirstPlayerSettingsViewKeys, g_vecSecondPlayerSettingsViewKeys, "fresh view key arrays retain values");
g_Assert.notEqual(g_vecFirstPlayerSettingsViewEntries, g_vecSecondPlayerSettingsViewEntries, "view entries return fresh arrays");
g_Assert.deepEqual(g_vecFirstPlayerSettingsViewEntries, g_vecSecondPlayerSettingsViewEntries, "fresh view entry arrays retain values");
g_Assert.notEqual(g_vecFirstPlayerSettingsViewEntries[0], g_vecSecondPlayerSettingsViewEntries[0], "view entries contain fresh entry arrays");
g_Assert.ok(g_vecFirstPlayerSettingsViewKeys.includes("Theme"), "view keys include the new setting");

const g_itPlayerSettingsView = g_PlayerSettingsView[Symbol.iterator]();
const g_strIteratorLateSettingName = "Iterator Late Value";
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "SetSetting", [g_strIteratorLateSettingName, "late"]), true, "SetSetting adds a value after iterator creation");

let g_unIteratedPlayerSettingCount = 0;
let g_bIteratedThemeSetting = false;
let g_bIteratedLateSetting = false;
for (const [strIteratedSettingName, IteratedSettingValue] of g_itPlayerSettingsView) {
	g_unIteratedPlayerSettingCount += 1;

	if ((strIteratedSettingName === "Theme") && (IteratedSettingValue === "dark")) {
		g_bIteratedThemeSetting = true;
	}

	if (strIteratedSettingName === g_strIteratorLateSettingName) {
		g_bIteratedLateSetting = true;
	}
}

g_Assert.equal(g_unIteratedPlayerSettingCount, g_vecFirstPlayerSettingsViewEntries.length, "iterator traverses the fresh entry array created with it");
g_Assert.equal(g_bIteratedThemeSetting, true, "iterator retains entries present at creation");
g_Assert.equal(g_bIteratedLateSetting, false, "iterator excludes entries added after creation");

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "DeleteSetting", [g_strIteratorLateSettingName]), true, "DeleteSetting removes the late setting");

const g_PlayerSettingsViewCallbackReceiver = {};
let g_unPlayerSettingsViewCallbackInvocationCount = 0;
let g_bPlayerSettingsViewThemeCallbackObserved = false;

function InspectPlayerSettingsViewEntry(SettingValue, strSettingName, CurrentPlayerSettingsView) {
	g_Assert.equal(this, g_PlayerSettingsViewCallbackReceiver, "ForEach preserves the callback receiver");
	g_Assert.equal(CurrentPlayerSettingsView, g_PlayerSettingsView, "ForEach passes the exact view");
	g_Assert.equal(Object.hasOwn(g_LivePlayerSettingsValues, strSettingName), true, "ForEach passes an own live setting name");
	g_Assert.equal(SettingValue, g_LivePlayerSettingsValues[strSettingName], "ForEach passes the exact live setting value");

	g_unPlayerSettingsViewCallbackInvocationCount += 1;

	if ((strSettingName === "Theme") && (SettingValue === "dark")) {
		g_bPlayerSettingsViewThemeCallbackObserved = true;
	}
}

InspectPlayerSettingsViewEntry.call = () => {
	throw new Error("ForEach must not dispatch through callback.call");
};

const g_PlayerSettingsViewForEachResult = g_PlayerSettingsView.ForEach(InspectPlayerSettingsViewEntry, g_PlayerSettingsViewCallbackReceiver);
g_Assert.equal(g_PlayerSettingsViewForEachResult, undefined, "ForEach returns undefined");
g_Assert.equal(g_unPlayerSettingsViewCallbackInvocationCount, g_vecSecondPlayerSettingsViewKeys.length, "ForEach visits every current setting once");
g_Assert.equal(g_bPlayerSettingsViewThemeCallbackObserved, true, "ForEach passes the Theme entry");
g_Assert.throws(() => g_PlayerSettingsView.ForEach(null), TypeError, "ForEach requires a callback");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "DeleteSetting", ["Theme"]), true, "DeleteSetting removes the view value");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "DeleteSetting", ["Theme"]), false, "DeleteSetting reports missing view values");

const g_vecFirstPlayerSettingsStorageKeys = g_PlayerSettingsStorage.Keys();
const g_vecSecondPlayerSettingsStorageKeys = g_PlayerSettingsStorage.Keys();
const g_vecFirstPlayerSettingsStorageValues = g_PlayerSettingsStorage.Values();
const g_vecSecondPlayerSettingsStorageValues = g_PlayerSettingsStorage.Values();
const g_vecFirstPlayerSettingsStorageEntries = g_PlayerSettingsStorage.Entries();
const g_vecSecondPlayerSettingsStorageEntries = g_PlayerSettingsStorage.Entries();

g_Assert.equal(g_PlayerSettingsStorage.Data, g_PlayerSettingsDataIdentity, "storage all retains the exact live top-level cache");
g_Assert.notEqual(g_vecFirstPlayerSettingsStorageKeys, g_vecSecondPlayerSettingsStorageKeys, "storage keys return fresh arrays");
g_Assert.deepEqual(g_vecFirstPlayerSettingsStorageKeys, g_vecSecondPlayerSettingsStorageKeys, "fresh storage key arrays retain values");
g_Assert.notEqual(g_vecFirstPlayerSettingsStorageValues, g_vecSecondPlayerSettingsStorageValues, "storage values return fresh arrays");
g_Assert.notEqual(g_vecFirstPlayerSettingsStorageEntries, g_vecSecondPlayerSettingsStorageEntries, "storage entries return fresh arrays");
g_Assert.equal(g_vecFirstPlayerSettingsStorageValues.length, g_vecFirstPlayerSettingsStorageKeys.length, "storage values contain one view for each key");
g_Assert.equal(g_vecFirstPlayerSettingsStorageEntries.length, g_vecFirstPlayerSettingsStorageKeys.length, "storage entries contain one tuple for each key");

for (let unPlayerSettingsCollectionIndex = 0; unPlayerSettingsCollectionIndex < g_vecFirstPlayerSettingsStorageKeys.length; unPlayerSettingsCollectionIndex += 1) {
	const strStoredPlayerUniqueID = g_vecFirstPlayerSettingsStorageKeys[unPlayerSettingsCollectionIndex];
	const FirstStoredPlayerSettingsView = g_vecFirstPlayerSettingsStorageValues[unPlayerSettingsCollectionIndex];
	const SecondStoredPlayerSettingsView = g_vecSecondPlayerSettingsStorageValues[unPlayerSettingsCollectionIndex];
	const vecFirstStoredPlayerSettingsEntry = g_vecFirstPlayerSettingsStorageEntries[unPlayerSettingsCollectionIndex];
	const vecSecondStoredPlayerSettingsEntry = g_vecSecondPlayerSettingsStorageEntries[unPlayerSettingsCollectionIndex];

	g_Assert.ok(FirstStoredPlayerSettingsView instanceof g_SettingsStorageAPI.PlayerSettingsView, "storage values contain PlayerSettingsView instances");
	g_Assert.equal(FirstStoredPlayerSettingsView.Storage, g_PlayerSettingsStorage, "storage values retain the exact storage");
	g_Assert.equal(FirstStoredPlayerSettingsView.UniqueID, strStoredPlayerUniqueID, "storage values retain the matching player unique ID");
	g_Assert.notEqual(FirstStoredPlayerSettingsView, SecondStoredPlayerSettingsView, "storage value arrays contain fresh views");
	g_Assert.notEqual(vecFirstStoredPlayerSettingsEntry, vecSecondStoredPlayerSettingsEntry, "storage entry arrays contain fresh tuples");
	g_Assert.equal(vecFirstStoredPlayerSettingsEntry[0], strStoredPlayerUniqueID, "storage entries retain the matching player unique ID");
	g_Assert.equal(vecFirstStoredPlayerSettingsEntry[1].Storage, g_PlayerSettingsStorage, "storage entries retain the exact storage");
}

const g_itPlayerSettingsStorage = g_PlayerSettingsStorage[Symbol.iterator]();
const g_strIteratorLatePlayerUniqueID = "STEAM_1:1:16";
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "SetSetting", [g_strIteratorLatePlayerUniqueID, "State", "late"]), true, "SetSetting adds a player after iterator creation");

let g_unIteratedPlayerSettingsEntryCount = 0;
let g_bIteratedPrimaryPlayerSettings = false;
let g_bIteratedLatePlayerSettings = false;
for (const [strIteratedPlayerUniqueID, IteratedPlayerSettingsView] of g_itPlayerSettingsStorage) {
	g_unIteratedPlayerSettingsEntryCount += 1;

	g_Assert.equal(IteratedPlayerSettingsView.Storage, g_PlayerSettingsStorage, "storage iterator entries retain the exact storage");

	if (strIteratedPlayerUniqueID === g_strPlayerUniqueID) {
		g_bIteratedPrimaryPlayerSettings = true;
	}

	if (strIteratedPlayerUniqueID === g_strIteratorLatePlayerUniqueID) {
		g_bIteratedLatePlayerSettings = true;
	}
}

g_Assert.equal(g_unIteratedPlayerSettingsEntryCount, g_vecFirstPlayerSettingsStorageEntries.length, "iterator traverses the fresh entry array created with it");
g_Assert.equal(g_bIteratedPrimaryPlayerSettings, true, "storage iterator retains players present at creation");
g_Assert.equal(g_bIteratedLatePlayerSettings, false, "storage iterator excludes players added after creation");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "ClearPlayer", [g_strIteratorLatePlayerUniqueID]), true, "ClearPlayer removes the late player");

const g_PlayerSettingsStorageCallbackReceiver = {};
let g_unPlayerSettingsStorageCallbackInvocationCount = 0;
let g_bPrimaryPlayerSettingsCallbackObserved = false;

function InspectPlayerSettingsStorageEntry(StoredPlayerSettingsView, strStoredPlayerUniqueID, CurrentPlayerSettingsStorage) {
	g_Assert.equal(this, g_PlayerSettingsStorageCallbackReceiver, "ForEach preserves the callback receiver");
	g_Assert.equal(CurrentPlayerSettingsStorage, g_PlayerSettingsStorage, "ForEach passes the exact storage");
	g_Assert.ok(StoredPlayerSettingsView instanceof g_SettingsStorageAPI.PlayerSettingsView, "ForEach passes PlayerSettingsView instances");
	g_Assert.equal(StoredPlayerSettingsView.Storage, g_PlayerSettingsStorage, "ForEach view retains the exact storage");
	g_Assert.equal(StoredPlayerSettingsView.UniqueID, strStoredPlayerUniqueID, "ForEach view retains the matching player unique ID");

	g_unPlayerSettingsStorageCallbackInvocationCount += 1;

	if (strStoredPlayerUniqueID === g_strPlayerUniqueID) {
		g_bPrimaryPlayerSettingsCallbackObserved = true;
	}
}

InspectPlayerSettingsStorageEntry.call = () => {
	throw new Error("ForEach must not dispatch through callback.call");
};

const g_PlayerSettingsStorageForEachResult = g_PlayerSettingsStorage.ForEach(InspectPlayerSettingsStorageEntry, g_PlayerSettingsStorageCallbackReceiver);
g_Assert.equal(g_PlayerSettingsStorageForEachResult, undefined, "ForEach returns undefined");
g_Assert.equal(g_unPlayerSettingsStorageCallbackInvocationCount, g_vecSecondPlayerSettingsStorageKeys.length, "ForEach visits every current player once");
g_Assert.equal(g_bPrimaryPlayerSettingsCallbackObserved, true, "ForEach passes the primary player entry");
g_Assert.throws(() => g_PlayerSettingsStorage.ForEach(null), TypeError, "ForEach requires a callback");

const g_strLowLevelPlayerUniqueID = "STEAM_1:1:2";
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "RunTransaction", [(hSettingsTransaction, Options, CompleteTransaction) => {
	g_PlayerSettingsStorage.EnsurePlayer(hSettingsTransaction, g_strLowLevelPlayerUniqueID, Options, (PlayerError) => {
		if (PlayerError !== null) {
			CompleteTransaction(PlayerError, null);
			return;
		}

		g_PlayerSettingsStorage.InsertValue(hSettingsTransaction, g_strLowLevelPlayerUniqueID, "Ready", true, Options, CompleteTransaction);
	});
}]), 1n, "borrowed requests complete the low-level transaction with the BigInt affected-row count");

RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Reload");

const g_PrototypePlayerSettingsValues = RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetPlayerValues", ["__proto__"]);

g_Assert.equal(g_PlayerSettingsStorage.Data, g_PlayerSettingsDataIdentity, "prototype-like Reload preserves top-level cache identity");
g_Assert.equal(Object.hasOwn(g_PlayerSettingsStorage.Data, "__proto__"), true, "prototype-like player ID remains an own cache key after Reload");
g_Assert.equal(Object.getPrototypeOf(g_PlayerSettingsStorage.Data), null, "prototype-like Reload preserves the top-level null prototype");
g_Assert.equal(Object.hasOwn(g_PrototypePlayerSettingsValues, "__proto__"), true, "prototype-like setting name remains an own player key after Reload");
g_Assert.equal(Object.getPrototypeOf(g_PrototypePlayerSettingsValues), null, "prototype-like Reload preserves the player-record null prototype");
g_Assert.equal(g_PrototypePlayerSettingsValues.__proto__, "safe", "prototype-like setting value survives Save and Reload");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "EnsureLoaded"), g_PlayerSettingsStorage.Data, "EnsureLoaded returns the live cache");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "GetSetting", [g_strLowLevelPlayerUniqueID, "Ready", null]), true, "low-level inserts appear after Reload");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "OnLevelShutdown"), true, "OnLevelShutdown saves the cache");
g_Assert.ok(CountSOCIOperations("commit") > 0, "transactions commit");

const g_unRollbackCountBeforeTransactionFailure = CountSOCIOperations("rollback");
const g_TransactionOperationError = new Error("rollback-test");
g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "RunTransaction", [() => {
	throw g_TransactionOperationError;
}]), (ThrownTransactionOperationError) => {
	return ThrownTransactionOperationError === g_TransactionOperationError;
}, "transaction rethrows the exact callback error");
g_Assert.equal(CountSOCIOperations("rollback"), g_unRollbackCountBeforeTransactionFailure + 1, "failed transactions roll back once");

const g_OriginalSOCICommit = g_SOCI.Commit;

try {
	const unRollbackCountBeforeFalseCommit = CountSOCIOperations("rollback");

	g_SOCI.Commit = CreateSOCIResultOperation(false);

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "RunTransaction", [(hSettingsTransaction, Options, CompleteTransaction) => CompleteTransaction(null, "uncommitted")]), (CommitFailureError) => {
		return (CommitFailureError instanceof Error) && !(CommitFailureError instanceof TypeError) && (CommitFailureError.message === "soci.Commit() failed.");
	}, "false commit results fail the transaction");
	g_Assert.equal(CountSOCIOperations("rollback"), unRollbackCountBeforeFalseCommit + 1, "false commit results roll back once");

	const unRollbackCountBeforeMalformedCommit = CountSOCIOperations("rollback");

	g_SOCI.Commit = CreateSOCIResultOperation("committed");

	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsStorage, "RunTransaction", [(hSettingsTransaction, Options, CompleteTransaction) => CompleteTransaction(null, "uncommitted")]), (CommitResultTypeError) => {
		return (CommitResultTypeError instanceof TypeError) && (CommitResultTypeError.message === "soci.Commit() callback result must be a boolean.");
	}, "non-boolean commit results fail the transaction");
	g_Assert.equal(CountSOCIOperations("rollback"), unRollbackCountBeforeMalformedCommit + 1, "non-boolean commit results roll back once");
} finally {
	g_SOCI.Commit = g_OriginalSOCICommit;
}

const g_OriginalSOCIRollback = g_SOCI.Rollback;
const g_vecRollbackFailureScenarios = [
	{ Name: "FalseResult", Result: false, Error: null, ThrowsError: false, ErrorConstructor: Error, ErrorMessage: "soci.Rollback() failed." },
	{ Name: "MalformedResult", Result: "rolled-back", Error: null, ThrowsError: false, ErrorConstructor: TypeError, ErrorMessage: "soci.Rollback() callback result must be a boolean." },
	{ Name: "CallbackError", Result: null, Error: new Error("rollback-callback-failure"), ThrowsError: false },
	{ Name: "SchedulingError", Result: null, Error: new Error("rollback-scheduling-failure"), ThrowsError: true },
];
for (const RollbackScenario of g_vecRollbackFailureScenarios) {
	// A failed rollback quarantines its session, so each fault owns a connection.
	const RollbackStorage = new g_SettingsStorageAPI.SettingsStorage("rollback-" + RollbackScenario.Name);
	const TransactionOperationError = new Error("rollback-operation-" + RollbackScenario.Name);

	RunBlockingSettingsRequest(RollbackStorage, "Open");

	const unRollbackCountBeforeFailure = CountSOCIOperations("rollback");

	try {
		g_SOCI.Rollback = (hConnectionHandle, Options, Callback) => {
			Reflect.apply(g_OriginalSOCIRollback, g_SOCI, [hConnectionHandle, Options, (RollbackError, bRolledBack) => {
				g_Assert.equal(RollbackError, null, "rollback fault performs the mock's underlying rollback");
				g_Assert.equal(bRolledBack, true, "underlying rollback succeeds before fault injection");

				if (RollbackScenario.ThrowsError) {
					throw RollbackScenario.Error;
				}

				Callback(RollbackScenario.Error, RollbackScenario.Result);
			}]);
		};

		g_Assert.throws(() => RunBlockingSettingsRequest(RollbackStorage, "RunTransaction", [() => {
			throw TransactionOperationError;
		}]), (RollbackAggregateError) => {
			g_Assert.ok(RollbackAggregateError instanceof AggregateError, RollbackScenario.Name);
			g_Assert.equal(RollbackAggregateError.message, "Settings transaction failed and rollback was unsuccessful.", RollbackScenario.Name);
			g_Assert.equal(RollbackAggregateError.errors.length, 2, RollbackScenario.Name);
			g_Assert.equal(RollbackAggregateError.errors[0], TransactionOperationError, "transaction error retains identity");

			const RollbackError = RollbackAggregateError.errors[1];
			if (RollbackScenario.Error !== null) {
				g_Assert.equal(RollbackError, RollbackScenario.Error, "rollback error retains identity");

			} else {
				g_Assert.equal(RollbackError.constructor, RollbackScenario.ErrorConstructor, RollbackScenario.Name);
				g_Assert.equal(RollbackError.message, RollbackScenario.ErrorMessage, RollbackScenario.Name);
			}

			return true;
		}, RollbackScenario.Name + " preserves both transaction errors in order");
		g_Assert.equal(CountSOCIOperations("rollback"), unRollbackCountBeforeFailure + 1, "each rollback fault invokes rollback once");

		const unSOCICallCountBeforeQuarantinedRequest = g_vecSOCICalls.length;
		g_Assert.throws(() => RunBlockingSettingsRequest(RollbackStorage, "RunTransaction", [(hSettingsTransaction, Options, CompleteTransaction) => CompleteTransaction(null, true)]), /close the storage before reusing its session/, "failed rollback rejects session reuse");
		g_Assert.equal(g_vecSOCICalls.length, unSOCICallCountBeforeQuarantinedRequest, "quarantined request does not access SOCI");
	} finally {
		g_SOCI.Rollback = g_OriginalSOCIRollback;
		g_Assert.equal(RunBlockingSettingsRequest(RollbackStorage, "Close"), true, "rollback fault releases its session");
	}
}

g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "ClearPlayer", [g_strLowLevelPlayerUniqueID]), true, "ClearPlayer removes one player");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "HasPlayer", [g_strLowLevelPlayerUniqueID]), false, "ClearPlayer updates cache membership");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsView, "ClearSettings"), true, "ClearSettings removes the player's values");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "HasPlayer", [g_strPlayerUniqueID]), false, "ClearSettings updates storage membership");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "ClearSettings"), true, "ClearSettings removes the namespace");
g_Assert.equal(g_PlayerSettingsStorage.Data, g_PlayerSettingsDataIdentity, "ClearSettings preserves top-level cache identity");
g_Assert.deepEqual(g_PlayerSettingsStorage.Keys(), [], "ClearSettings removes all keys");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Close"), true, "Close releases the SOCI handle");
g_Assert.equal(g_PlayerSettingsStorage.Handle, null, "Close clears the handle");
g_Assert.equal(g_PlayerSettingsStorage.Loaded, false, "Close marks cache unloaded");
g_Assert.equal(RunBlockingSettingsRequest(g_PlayerSettingsStorage, "Close"), false, "Close reports false when called twice");

// SQL row keys retain the persisted database schema's exact column names.
g_FaultInjectedValueRow = {
	setting_name: "Flag",
	uniqueid: "STEAM_1:1:99",
	value_kind: "boolean",
	value_number: null,
	value_text: "2",
};

const g_FaultInjectedSettingsStorage = new g_SettingsStorageAPI.SettingsStorage("fault-values");
g_Assert.throws(() => RunBlockingSettingsRequest(g_FaultInjectedSettingsStorage, "Reload"), /must be '0' or '1'/, "malformed stored booleans are rejected");
g_FaultInjectedValueRow = null;

g_Assert.equal(RunBlockingSettingsRequest(g_FaultInjectedSettingsStorage, "ClearSettings"), true, "malformed-value fixture clears its stored rows");
g_Assert.equal(RunBlockingSettingsRequest(g_FaultInjectedSettingsStorage, "Close"), true, "malformed-value fixture releases its session");

g_Assert.throws(() => new g_SettingsStorageAPI.PlayerSettingsView({}, g_strPlayerUniqueID), TypeError, "views require SettingsStorage");
g_Assert.throws(() => new g_SettingsStorageAPI.PlayerSettingsView(g_SettingsStorageAPI.DEFAULT_STORAGE, ""), TypeError, "views require non-empty IDs");

const g_PlayerSettingsViewConstructionError = new Error("player settings creation failed");
let g_unRejectedPlayerValuesCallCount = 0;
let g_strRejectedPlayerUniqueID = null;

class RejectingPlayerSettingsStorage extends g_SettingsStorageAPI.SettingsStorage {
	// No loading attempt is allowed during view construction, regardless of options.
	GetPlayerValues(strRequestedPlayerUniqueID, Options, Callback) {
		g_unRejectedPlayerValuesCallCount += 1;
		g_strRejectedPlayerUniqueID = strRequestedPlayerUniqueID;

		throw g_PlayerSettingsViewConstructionError;
	}
}

class PlayerSettingsViewConstructionProbe extends g_SettingsStorageAPI.PlayerSettingsView {
}

const g_RejectingPlayerSettingsStorage = new RejectingPlayerSettingsStorage("player-view-construction");
const g_strRejectedPlayerSettingsViewUniqueID = "STEAM_1:1:17";
const g_PurelyConstructedPlayerSettingsView = new PlayerSettingsViewConstructionProbe(g_RejectingPlayerSettingsStorage, g_strRejectedPlayerSettingsViewUniqueID);
g_Assert.equal(g_PurelyConstructedPlayerSettingsView.Storage, g_RejectingPlayerSettingsStorage, "view construction assigns the validated storage");
g_Assert.equal(g_PurelyConstructedPlayerSettingsView.UniqueID, g_strRejectedPlayerSettingsViewUniqueID, "view construction assigns the validated player unique ID");
g_Assert.equal(g_unRejectedPlayerValuesCallCount, 0, "view construction does not request player values");
g_Assert.equal(g_strRejectedPlayerUniqueID, null, "view construction never invokes the loading override");
g_Assert.equal(g_RejectingPlayerSettingsStorage.Handle, null, "view construction does not open a SOCI session");
g_Assert.equal(g_RejectingPlayerSettingsStorage.Loaded, false, "view construction does not load the cache");
g_Assert.equal(Object.hasOwn(g_RejectingPlayerSettingsStorage.Data, g_strRejectedPlayerSettingsViewUniqueID), false, "view construction does not create a player record");

const g_PlayerSettingsViewStorageBeforeValidation = g_PlayerSettingsView.Storage;

try {
	g_PlayerSettingsView.ValueStorage = {};

	g_Assert.throws(() => g_PlayerSettingsView.GetCachedValues(), (SettingsStorageTypeError) => {
		return (SettingsStorageTypeError instanceof TypeError) && (SettingsStorageTypeError.message === "SettingsStorage must be a SettingsStorage instance.");
	}, "GetCachedValues validates editable storage at operation time");
	g_Assert.throws(() => RunBlockingSettingsRequest(g_PlayerSettingsView, "HasSetting", [""]), (SettingNameTypeError) => {
		return (SettingNameTypeError instanceof TypeError) && (SettingNameTypeError.message === "Setting name must be a non-empty string.");
	}, "HasSetting validates its setting name before editable storage");
} finally {
	g_PlayerSettingsView.ValueStorage = g_PlayerSettingsViewStorageBeforeValidation;
}

const g_strPlayerSettingsViewUniqueIDBeforeValidation = g_PlayerSettingsView.UniqueID;

try {
	g_PlayerSettingsView.ValueUniqueID = "";

	g_Assert.throws(() => g_PlayerSettingsView.GetCachedValues(), (PlayerUniqueIDTypeError) => {
		return (PlayerUniqueIDTypeError instanceof TypeError) && (PlayerUniqueIDTypeError.message === "Player unique ID must be a non-empty string.");
	}, "GetCachedValues validates editable player unique ID at operation time");
} finally {
	g_PlayerSettingsView.ValueUniqueID = g_strPlayerSettingsViewUniqueIDBeforeValidation;
}

for (const Storage of [
	g_PostDefinitionFailureSettingsStorage,
	g_DefinitionRollbackFailureSettingsStorage,
	g_DeletionFailureSettingsStorage,
	g_ClearPlayerFailureSettingsStorage,
	g_ClearFailureSettingsStorage,
	g_CommitFailureCacheRestoreSettingsStorage,
	g_CacheRestoreFailureSettingsStorage,
]) {
	g_Assert.equal(RunBlockingSettingsRequest(Storage, "Close"), true, "cache-failure fixture releases its session");
	g_Assert.equal(Storage.Handle, null, "cache-failure fixture does not retain a session");
}

const g_strSettingsStorageDocumentationMarkdown = g_FileSystem.readFileSync(g_strSettingsStorageDocumentationPath, "utf8");
const g_vecSettingsStorageDocumentationCodeBlocks = [];
for (const vecDocumentationCodeBlockMatch of g_strSettingsStorageDocumentationMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecSettingsStorageDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
}

const g_vecSettingsStorageImportMatch = g_vecSettingsStorageDocumentationCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("settings\/storage"\);/);
g_Assert.ok(g_vecSettingsStorageImportMatch, "settings/storage exact import example");

const g_vecDocumentedSettingsStorageExports = [];
for (const strDocumentedSettingsStorageExportName of g_vecSettingsStorageImportMatch[1].split(",")) {
	const strNormalizedSettingsStorageExportName = strDocumentedSettingsStorageExportName.split(":", 1)[0].trim();
	if (strNormalizedSettingsStorageExportName.length > 0) {
		g_vecDocumentedSettingsStorageExports.push(strNormalizedSettingsStorageExportName);
	}
}

g_vecDocumentedSettingsStorageExports.sort();

const g_vecActualSettingsStorageExports = Object.keys(g_SettingsStorageAPI);
g_vecActualSettingsStorageExports.sort();

g_Assert.deepEqual(g_vecDocumentedSettingsStorageExports, g_vecActualSettingsStorageExports, "exact documented settings/storage exports");
g_Assert.equal(g_vecSettingsStorageDocumentationCodeBlocks.length, 8, "settings/storage JavaScript block count");
g_Assert.doesNotMatch(g_strSettingsStorageDocumentationMarkdown, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("settings\/storage"\)/, "settings/storage documentation must remain hand-written and use direct imports");
g_Assert.doesNotMatch(g_strSettingsStorageDocumentationMarkdown, /[^\x00-\x7F]/, "settings/storage documentation ASCII");
g_Assert.doesNotMatch(g_strSettingsStorageDocumentationMarkdown, /[ \t]+$/m, "settings/storage documentation trailing whitespace");

for (const strDocumentationCode of g_vecSettingsStorageDocumentationCodeBlocks) {
	g_Assert.doesNotMatch(strDocumentationCode, /^ +\S/m, "settings/storage JavaScript fence indentation must use tabs");
}

VerifyDocumentationContentsAnchors(g_strSettingsStorageDocumentationMarkdown);
VerifyDocumentationLinks(g_strSettingsStorageDocumentationMarkdown);

const g_SettingsStorageDocumentationWorkflows = Object.create(null);
const g_unSOCICallCountBeforeDocumentation = g_vecSOCICalls.length;
const g_unEnsuredDirectoryCountBeforeDocumentation = g_vecEnsuredDirectories.length;

for (const [unDocumentationBlockOffset, strDocumentationCode] of g_vecSettingsStorageDocumentationCodeBlocks.entries()) {
	const DocumentationBlockExports = ExecuteDocumentationCodeBlock(strDocumentationCode, unDocumentationBlockOffset + 1, g_SettingsStorageAPI);
	for (const strDocumentationWorkflowName of Object.keys(DocumentationBlockExports)) {
		g_SettingsStorageDocumentationWorkflows[strDocumentationWorkflowName] = DocumentationBlockExports[strDocumentationWorkflowName];
	}
}

g_Assert.equal(g_vecSOCICalls.length, g_unSOCICallCountBeforeDocumentation, "settings/storage code blocks must not call SOCI while loading");
g_Assert.equal(g_vecEnsuredDirectories.length, g_unEnsuredDirectoryCountBeforeDocumentation, "settings/storage code blocks must not touch directories while loading");

const g_vecActualSettingsStorageWorkflowNames = Object.keys(g_SettingsStorageDocumentationWorkflows);
g_vecActualSettingsStorageWorkflowNames.sort();

g_Assert.deepEqual(g_vecActualSettingsStorageWorkflowNames, [
	"ExerciseLiveSettingsCache",
	"ExerciseLowLevelSettingsStorage",
	"ExercisePlayerSettingsView",
	"ExerciseSettingsCollections",
	"ExerciseStoredValueKinds",
	"InspectStorageConfiguration",
	"VerifySettingsRollback",
], "settings/storage documented workflows");

async function VerifyThrownSettingsRequestFailures() {
	const OriginalConnect = g_SOCI.Connect;
	const OriginalQuery = g_SOCI.Query;
	const vecFailures = [new Error("Settings request fixture failure"), null, undefined, 0, false, "Settings failure"];
	const vecFailurePhases = [
		"TRANSACTION",
		"CONNECT",
		"QUERY",
		"PLAYER_RECORD",
		"VALUE_RECORD",
		"ENSURE_PLAYER",
		"SAVE_COPY",
		"HAS_PLAYER",
		"LOAD_GETTER",
		"LOAD_COPY",
		"VALUE_GETTER",
		"SET_COPY",
		"DELETE_COPY",
		"CLEAR_COPY",
		"REPLACE",
		"RELOAD_REPLACE",
		"VIEW_HAS",
	];
	let unScenarioIndex = 0;

	for (const bBlocking of [false, true]) {
		for (const strFailurePhase of vecFailurePhases) {
			for (const Failure of vecFailures) {
				const Storage = new g_SettingsStorageAPI.SettingsStorage(`request-failures-${unScenarioIndex}`);
				unScenarioIndex += 1;
				const unRollbackCount = CountSOCIOperations("rollback");
				const unCommitCount = CountSOCIOperations("commit");
				let unCallbackCount = 0;
				const strPlayerUniqueID = "FixturePlayer";
				const PlayerValues = Object.create(null);
				PlayerValues.StoredValue = 1;

				try {
					if (strFailurePhase === "CONNECT") {
						g_SOCI.Connect = function RejectSettingsConnection() {
							throw Failure;
						};

					} else if (["QUERY", "PLAYER_RECORD", "VALUE_RECORD", "ENSURE_PLAYER", "RELOAD_REPLACE"].includes(strFailurePhase)) {
						g_SOCI.Query = (...vecArguments) => {
							const vecRows = [];
							const bValueQuery = vecArguments[1].startsWith("SELECT uniqueid, setting_name");
							if (strFailurePhase === "QUERY") {
								Object.defineProperty(vecRows, "0", {
									get() {
										throw Failure;
									},
								});

							} else if ((strFailurePhase === "VALUE_RECORD") && bValueQuery) {
								const Row = { uniqueid: strPlayerUniqueID, setting_name: "StoredValue", value_text: null, value_number: 1 };
								Object.defineProperty(Row, "value_kind", {
									get() {
										throw Failure;
									},
								});
								vecRows.push(Row);

							} else if (!bValueQuery) {
								const Row = { uniqueid: strPlayerUniqueID };
								if ((strFailurePhase === "PLAYER_RECORD") || (strFailurePhase === "ENSURE_PLAYER")) {
									Object.defineProperty(Row, "uniqueid", {
										get() {
											throw Failure;
										},
									});
								}

								vecRows.push(Row);
							}

							return RunSOCIRequest(() => vecRows, vecArguments.at(-2), vecArguments.at(-1));
						};
					}

					if (["SAVE_COPY", "HAS_PLAYER", "LOAD_COPY", "CLEAR_COPY"].includes(strFailurePhase)) {
						const SettingsData = Object.create(null);
						if (strFailurePhase === "CLEAR_COPY") {
							SettingsData[strPlayerUniqueID] = PlayerValues;
						}

						Storage.ValueData = new Proxy(SettingsData, {
							ownKeys() {
								throw Failure;
							},

							getOwnPropertyDescriptor(Target, strPropertyName) {
								if (strFailurePhase === "HAS_PLAYER") {
									throw Failure;
								}

								return Object.getOwnPropertyDescriptor(Target, strPropertyName);
							},
						});
						Storage.ValueLoaded = true;

					} else if (strFailurePhase === "LOAD_GETTER") {
						Object.defineProperty(Storage.Data, strPlayerUniqueID, {
							get() {
								throw Failure;
							},
						});
						Storage.ValueLoaded = true;

					} else if (strFailurePhase === "VALUE_GETTER") {
						Object.defineProperty(PlayerValues, "StoredValue", {
							get() {
								throw Failure;
							},
						});
						Storage.Data[strPlayerUniqueID] = PlayerValues;
						Storage.ValueLoaded = true;

					} else if ((strFailurePhase === "SET_COPY") || (strFailurePhase === "DELETE_COPY")) {
						Storage.Data[strPlayerUniqueID] = new Proxy(PlayerValues, {
							ownKeys() {
								throw Failure;
							},
						});
						Storage.ValueLoaded = true;

					} else if (strFailurePhase === "VIEW_HAS") {
						Storage.Data[strPlayerUniqueID] = new Proxy(PlayerValues, {
							getOwnPropertyDescriptor() {
								throw Failure;
							},
						});
						Storage.ValueLoaded = true;

					} else if ((strFailurePhase === "REPLACE") || (strFailurePhase === "RELOAD_REPLACE")) {
						let bReplacementFailed = false;
						const bReload = strFailurePhase === "RELOAD_REPLACE";
						const TargetRecord = bReload ? Object.create(null) : PlayerValues;
						const FaultedRecord = new Proxy(TargetRecord, {
							defineProperty(Target, strPropertyName, Descriptor) {
								const bDefined = Reflect.defineProperty(Target, strPropertyName, Descriptor);
								if (!bReplacementFailed) {
									bReplacementFailed = true;
									throw Failure;
								}

								return bDefined;
							},
						});

						if (bReload) {
							Storage.ValueData = FaultedRecord;

						} else {
							Storage.Data[strPlayerUniqueID] = FaultedRecord;
							Storage.ValueLoaded = true;
						}
					}

					if (strFailurePhase === "ENSURE_PLAYER") {
						RunBlockingSettingsRequest(Storage, "Open");
					}

					const Observation = await new Promise((Resolve) => {
						const Callback = (RequestError, Result) => {
							unCallbackCount += 1;
							Resolve({ RequestError, Result });
						};

						const Options = { Blocking: bBlocking };
						let DirectResult = undefined;

						if (strFailurePhase === "TRANSACTION") {
							DirectResult = Storage.RunTransaction(() => {
								throw Failure;
							}, Options, Callback);

						} else if (strFailurePhase === "CONNECT") {
							DirectResult = Storage.Open(Options, Callback);

						} else if (strFailurePhase === "ENSURE_PLAYER") {
							DirectResult = Storage.EnsurePlayer(Storage.Handle, strPlayerUniqueID, Options, Callback);

						} else if (strFailurePhase === "SAVE_COPY") {
							DirectResult = Storage.Save(Options, Callback);

						} else if (strFailurePhase === "HAS_PLAYER") {
							DirectResult = Storage.HasPlayer(strPlayerUniqueID, Options, Callback);

						} else if (strFailurePhase === "VALUE_GETTER") {
							DirectResult = Storage.GetSetting(strPlayerUniqueID, "StoredValue", null, Options, Callback);

						} else if (strFailurePhase === "VIEW_HAS") {
							const View = Storage.GetSettingsForPlayer(strPlayerUniqueID);
							DirectResult = View.HasSetting("StoredValue", Options, Callback);

						} else if ((strFailurePhase === "SET_COPY") || (strFailurePhase === "REPLACE")) {
							DirectResult = Storage.SetSetting(strPlayerUniqueID, "StoredValue", 2, Options, Callback);

						} else if (strFailurePhase === "DELETE_COPY") {
							DirectResult = Storage.DeleteSetting(strPlayerUniqueID, "StoredValue", Options, Callback);

						} else if (strFailurePhase === "CLEAR_COPY") {
							DirectResult = Storage.ClearPlayer(strPlayerUniqueID, Options, Callback);

						} else if ((strFailurePhase === "LOAD_GETTER") || (strFailurePhase === "LOAD_COPY")) {
							DirectResult = Storage.GetPlayerValues(strPlayerUniqueID, Options, Callback);

						} else {
							DirectResult = Storage.Reload(Options, Callback);
						}

						g_Assert.equal(DirectResult, undefined, "request failures remain callback-based");
					});
					g_Assert.notEqual(Observation.RequestError, null, "a thrown operation must not complete as success");
					g_Assert.equal(unCallbackCount, 1, "thrown failure completes once");
					g_Assert.equal(CountSOCIOperations("commit"), unCommitCount, "failed work is not committed");
					const bNeedsRollback = (strFailurePhase === "TRANSACTION") || (strFailurePhase === "REPLACE");
					g_Assert.equal(CountSOCIOperations("rollback"), unRollbackCount + (bNeedsRollback ? 1 : 0), "thrown transaction work rolls back exactly once");

					if (strFailurePhase === "REPLACE") {
						g_Assert.equal(Storage.Data[strPlayerUniqueID].StoredValue, 1, "failed replacement restores the live cache");

					} else if (strFailurePhase === "RELOAD_REPLACE") {
						g_Assert.deepEqual(Object.keys(Storage.Data), [], "failed reload restores the top-level cache");
						g_Assert.equal(Storage.Loaded, false, "failed reload does not mark data loaded");
					}

					if (Failure === null) {
						g_Assert.equal(Observation.RequestError.name, "Error", "null operation failure is normalized");
						g_Assert.equal(Object.hasOwn(Observation.RequestError, "cause"), true, "null operation retains a cause");
						g_Assert.equal(Observation.RequestError.cause, null, "exact null cause");

					} else {
						g_Assert.equal(Observation.RequestError, Failure, "other thrown values retain identity");
					}
				} finally {
					g_SOCI.Connect = OriginalConnect;
					g_SOCI.Query = OriginalQuery;

					if (Storage.Handle !== null) {
						g_Assert.equal(RunBlockingSettingsRequest(Storage, "Close"), true, "thrown-request fixture releases its session");
					}
				}
			}
		}
	}

	for (const Failure of vecFailures) {
		const Storage = new g_SettingsStorageAPI.SettingsStorage(`callback-failures-${unScenarioIndex}`);
		unScenarioIndex += 1;
		let unCallbackCount = 0;
		let bCaught = false;
		let CaughtFailure = undefined;

		try {
			try {
				Storage.RunTransaction((hSOCIHandle, Options, CompleteTransaction) => {
					g_Assert.equal(hSOCIHandle, Storage.Handle, "callback uses the borrowed transaction handle");
					g_Assert.equal(Options.Blocking, true, "callback fixture uses Blocking");
					CompleteTransaction(null, true);
				}, { Blocking: true }, () => {
					unCallbackCount += 1;
					throw Failure;
				});
			} catch (CallbackFailure) {
				CaughtFailure = CallbackFailure;
				bCaught = true;
			}

			g_Assert.equal(bCaught, true, "caller callback exception propagates");
			g_Assert.equal(CaughtFailure, Failure, "caller exceptions are not normalized");
			g_Assert.equal(unCallbackCount, 1, "caller exception is not retried");
		} finally {
			g_Assert.equal(RunBlockingSettingsRequest(Storage, "Close"), true, "throwing-callback fixture releases its session");
		}
	}
}

async function VerifyStoredValueWorkflowCleanup() {
	const strWorkflowCode = g_vecSettingsStorageDocumentationCodeBlocks.find((strCode) => strCode.includes("function ExerciseStoredValueKinds("));
	g_Assert.equal(typeof strWorkflowCode, "string", "stored-value workflow code exists");
	const vecFailures = [new Error("Workflow fixture failure"), null, undefined, 0, false, "Workflow failure"];
	const vecCleanupModes = [
		{ ClearFailure: false, CloseFailure: false, LiveHandle: false },
		{ ClearFailure: true, CloseFailure: false, LiveHandle: false },
		{ ClearFailure: false, CloseFailure: true, LiveHandle: false },
		{ ClearFailure: true, CloseFailure: true, LiveHandle: false },
		{ ClearFailure: false, CloseFailure: false, LiveHandle: true },
	];

	for (const bBlocking of [false, true]) {
		for (const bWorkFails of [false, true]) {
			for (const Failure of vecFailures) {
				for (const CleanupMode of vecCleanupModes) {
					const vecCleanupVisits = [];
					const SettingsValues = Object.create(null);
					const CompleteSuccess = (Options, Callback, Result) => {
						g_Assert.equal(Options.Blocking, bBlocking, "workflow mode is forwarded");
						g_Assert.equal(typeof Callback, "function", "workflow callback is mandatory");
						const CompleteRequest = () => Callback(null, Result);
						if (bBlocking) {
							CompleteRequest();
							return;
						}

						queueMicrotask(CompleteRequest);
					};
					const Storage = {
						Handle: 1,

						SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
							g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "workflow identity");
							SettingsValues[strSettingName] = SettingsValue;
							CompleteSuccess(Options, Callback, true);
						},

						Save(Options, Callback) {
							CompleteSuccess(Options, Callback, true);
						},

						Reload(Options, Callback) {
							CompleteSuccess(Options, Callback, SettingsValues);
						},

						GetPlayerValues(strPlayerUniqueID, Options, Callback) {
							g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "workflow read identity");

							if (bWorkFails) {
								throw Failure;
							}

							CompleteSuccess(Options, Callback, SettingsValues);
						},

						GetSetting(strPlayerUniqueID, strSettingName, DefaultValue, Options, Callback) {
							g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "workflow fallback identity");
							CompleteSuccess(Options, Callback, Object.hasOwn(SettingsValues, strSettingName) ? SettingsValues[strSettingName] : DefaultValue);
						},

						DeleteSetting(strPlayerUniqueID, strSettingName, Options, Callback) {
							g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "workflow delete identity");
							const bDeleted = Reflect.deleteProperty(SettingsValues, strSettingName);
							CompleteSuccess(Options, Callback, bDeleted);
						},

						ClearSettings(Options, Callback) {
							vecCleanupVisits.push("ClearSettings");

							if (CleanupMode.ClearFailure) {
								throw Failure;
							}

							CompleteSuccess(Options, Callback, true);
						},

						Close(Options, Callback) {
							vecCleanupVisits.push("Close");

							if (CleanupMode.CloseFailure) {
								throw Failure;
							}

							if (!CleanupMode.LiveHandle) {
								this.Handle = null;
							}

							CompleteSuccess(Options, Callback, true);
						},
					};
					const Workflow = ExecuteDocumentationCodeBlock(strWorkflowCode, 0, {
						ROOT: "memory/settings",

						CreateStorage(strNamespace, StorageOptions) {
							g_Assert.equal(strNamespace, "cleanup-fixture", "workflow namespace");
							g_Assert.equal(StorageOptions.DatabasePath, "memory/settings/cleanup-fixture.sqlite3", "owned database path");

							return Storage;
						},
					});
					let bFailed = false;
					let CaughtFailure = undefined;
					let Result = undefined;

					try {
						Result = await Workflow.ExerciseStoredValueKinds("cleanup-fixture", "FixturePlayer", { Blocking: bBlocking });
					} catch (WorkflowFailure) {
						CaughtFailure = WorkflowFailure;
						bFailed = true;
					}

					g_Assert.deepEqual(vecCleanupVisits, ["ClearSettings", "Close"], "workflow attempts both cleanup operations");
					const bCleanupFails = CleanupMode.ClearFailure || CleanupMode.CloseFailure || CleanupMode.LiveHandle;
					g_Assert.equal(bFailed, bWorkFails || bCleanupFails, "workflow failure boundary");

					if (bCleanupFails) {
						g_Assert.equal(CaughtFailure.name, "AggregateError", "cleanup preserves all failures");
						g_Assert.equal(CaughtFailure.Storage, Storage, "cleanup failure retains the owned instance");

						const vecExpectedFailures = [];
						if (bWorkFails) {
							vecExpectedFailures.push(Failure);
						}

						if (CleanupMode.ClearFailure) {
							vecExpectedFailures.push(Failure);
						}

						if (CleanupMode.CloseFailure) {
							vecExpectedFailures.push(Failure);
						}

						if (CleanupMode.LiveHandle) {
							g_Assert.equal(CaughtFailure.errors.at(-1).message, "Settings close did not release its session.", "unreleased session is an error");
							vecExpectedFailures.push(CaughtFailure.errors.at(-1));
						}

						g_Assert.deepEqual(Array.from(CaughtFailure.errors), vecExpectedFailures, "work then clear then close failure identity");
						g_Assert.equal(Storage.Handle !== null, CleanupMode.CloseFailure || CleanupMode.LiveHandle, "live session remains owned");

					} else if (bWorkFails) {
						g_Assert.equal(CaughtFailure, Failure, "successful cleanup preserves the original work failure");

					} else {
						g_Assert.equal(Result.BigIntValue, g_nLargeSignedSettingsValue, "successful workflow result remains exact");
						g_Assert.equal(Storage.Handle, null, "successful workflow releases its session");
					}
				}
			}
		}
	}
}

async function VerifyOwnedSettingsWorkflowCleanup() {
	const vecWorkflows = [
		{ Name: "ExerciseLiveSettingsCache", FailureMethod: "GetPlayerValues", CollectionClear: false },
		{ Name: "ExerciseSettingsCollections", FailureMethod: "SetSetting", CollectionClear: true },
		{ Name: "ExerciseLowLevelSettingsStorage", FailureMethod: "RunTransaction", CollectionClear: false },
		{ Name: "VerifySettingsRollback", FailureMethod: "RunTransaction", CollectionClear: false },
		{ Name: "ExercisePlayerSettingsView", FailureMethod: "SetSetting", CollectionClear: false },
	];
	const vecFailures = [new Error("Owned workflow failure"), null, undefined, 0, false, "Owned workflow failure"];
	const vecCleanupModes = [
		{ ClearFailure: false, CloseFailure: false, LiveHandle: false },
		{ ClearFailure: true, CloseFailure: false, LiveHandle: false },
		{ ClearFailure: false, CloseFailure: true, LiveHandle: false },
		{ ClearFailure: true, CloseFailure: true, LiveHandle: false },
		{ ClearFailure: false, CloseFailure: false, LiveHandle: true },
	];
	let unScenarioIndex = 0;

	for (const WorkflowSpecification of vecWorkflows) {
		const strWorkflowCode = g_vecSettingsStorageDocumentationCodeBlocks.find((strCode) => strCode.includes(`function ${WorkflowSpecification.Name}(`));
		g_Assert.equal(typeof strWorkflowCode, "string", "owned workflow code exists");

		for (const bBlocking of [false, true]) {
			for (const bWorkFails of [false, true]) {
				for (const Failure of vecFailures) {
					for (const CleanupMode of vecCleanupModes) {
						const vecCleanupVisits = [];
						let Storage = null;
						let OriginalClear = null;
						let OriginalClose = null;
						let bCollectionClearPending = WorkflowSpecification.CollectionClear && !bWorkFails;

						class FixtureSettingsStorage extends g_SettingsStorageAPI.SettingsStorage {
							constructor(strNamespace) {
								super(strNamespace);
								Storage = this;
								OriginalClear = this.ClearSettings;
								OriginalClose = this.Close;

								// Fixture-only preopen makes ownership observable even when the first workflow request throws.
								RunBlockingSettingsRequest(this, "Open");
								this.ClearSettings = (Options, Callback) => {
									g_Assert.equal(Options.Blocking, bBlocking, "owned cleanup forwards mode");
									g_Assert.equal(typeof Callback, "function", "owned cleanup requires callback");

									if (bCollectionClearPending) {
										bCollectionClearPending = false;
										return Reflect.apply(OriginalClear, this, [Options, Callback]);
									}

									vecCleanupVisits.push("ClearSettings");

									if (CleanupMode.ClearFailure) {
										throw Failure;
									}

									return Reflect.apply(OriginalClear, this, [Options, Callback]);
								};
								this.Close = (Options, Callback) => {
									g_Assert.equal(Options.Blocking, bBlocking, "owned close forwards mode");
									g_Assert.equal(typeof Callback, "function", "owned close requires callback");
									vecCleanupVisits.push("Close");

									if (CleanupMode.CloseFailure) {
										throw Failure;
									}

									if (CleanupMode.LiveHandle) {
										const CompleteRequest = () => Callback(null, true);
										if (bBlocking) {
											CompleteRequest();
											return;
										}

										queueMicrotask(CompleteRequest);
										return;
									}

									return Reflect.apply(OriginalClose, this, [Options, Callback]);
								};

								if (bWorkFails) {
									this[WorkflowSpecification.FailureMethod] = () => {
										throw Failure;
									};
								}
							}
						}

						const Workflow = ExecuteDocumentationCodeBlock(strWorkflowCode, 0, { SettingsStorage: FixtureSettingsStorage, PlayerSettingsView: g_SettingsStorageAPI.PlayerSettingsView });
						const vecArguments = [`owned-cleanup-${unScenarioIndex}`, "FixturePlayer"];
						if (WorkflowSpecification.CollectionClear) {
							vecArguments.push("SecondFixturePlayer");
						}

						vecArguments.push({ Blocking: bBlocking });
						unScenarioIndex += 1;
						const vecFixtureCleanupErrors = [];
						let bFailed = false;
						let CaughtFailure = undefined;
						let Result = undefined;
						let VerificationError = undefined;
						let bVerificationFailed = false;

						try {
							try {
								Result = await Workflow[WorkflowSpecification.Name](...vecArguments);
							} catch (WorkflowFailure) {
								CaughtFailure = WorkflowFailure;
								bFailed = true;
							}

							g_Assert.deepEqual(vecCleanupVisits, ["ClearSettings", "Close"], "owned workflow attempts both cleanup operations");
							const bCleanupFails = CleanupMode.ClearFailure || CleanupMode.CloseFailure || CleanupMode.LiveHandle;
							g_Assert.equal(bFailed, bWorkFails || bCleanupFails, "owned workflow failure boundary");

							if (bCleanupFails) {
								g_Assert.equal(CaughtFailure.name, "AggregateError", "owned cleanup preserves all failures");
								g_Assert.equal(CaughtFailure.Storage, Storage, "owned cleanup retains its actual owner");

								const vecExpectedFailures = [];
								if (bWorkFails) {
									vecExpectedFailures.push(Failure);
								}

								if (CleanupMode.ClearFailure) {
									vecExpectedFailures.push(Failure);
								}

								if (CleanupMode.CloseFailure) {
									vecExpectedFailures.push(Failure);
								}

								if (CleanupMode.LiveHandle) {
									g_Assert.equal(CaughtFailure.errors.at(-1).message, "Settings close did not release its session.", "owned workflow rejects an unreleased session");
									vecExpectedFailures.push(CaughtFailure.errors.at(-1));
								}

								g_Assert.deepEqual(Array.from(CaughtFailure.errors), vecExpectedFailures, "owned work then clear then close failure identity");
								g_Assert.equal(Storage.Handle !== null, CleanupMode.CloseFailure || CleanupMode.LiveHandle, "failed close remains owned");

							} else if (bWorkFails) {
								g_Assert.equal(CaughtFailure, Failure, "owned successful cleanup preserves the original thrown value");

							} else {
								g_Assert.equal(typeof Result, "object", "owned workflow preserves its result record");
								g_Assert.equal(Storage.Handle, null, "owned successful cleanup releases its session");
							}
						} catch (ScenarioError) {
							VerificationError = ScenarioError;
							bVerificationFailed = true;
						} finally {
							if (Storage !== null) {
								Storage.ClearSettings = OriginalClear;
								Storage.Close = OriginalClose;

								try {
									g_Assert.equal(RunBlockingSettingsRequest(Storage, "ClearSettings"), true, "owned workflow fallback clears its stored rows");
								} catch (CleanupError) {
									vecFixtureCleanupErrors.push(CleanupError);
								}

								try {
									const bHadOpenSession = Storage.Handle !== null;
									g_Assert.equal(RunBlockingSettingsRequest(Storage, "Close"), bHadOpenSession, "owned workflow fallback closes any remaining session");
								} catch (CleanupError) {
									vecFixtureCleanupErrors.push(CleanupError);
								}
							}
						}

						if (vecFixtureCleanupErrors.length !== 0) {
							const vecErrors = bVerificationFailed ? [VerificationError, ...vecFixtureCleanupErrors] : vecFixtureCleanupErrors;
							const CleanupError = new AggregateError(vecErrors, "Owned workflow fixture cleanup failed.");
							CleanupError.Storage = Storage;
							throw CleanupError;
						}

						if (bVerificationFailed) {
							throw VerificationError;
						}
					}
				}
			}
		}
	}

	g_Assert.equal(unScenarioIndex, 600, "five owned documentation workflows cover both modes and every cleanup failure");
}

async function VerifyRollbackWorkflowUndefinedFailure() {
	const strWorkflowCode = g_vecSettingsStorageDocumentationCodeBlocks.find((strCode) => strCode.includes("function VerifySettingsRollback("));
	g_Assert.equal(typeof strWorkflowCode, "string", "rollback workflow code exists");

	for (const bBlocking of [false, true]) {
		let Storage = null;

		class FixtureSettingsStorage extends g_SettingsStorageAPI.SettingsStorage {
			constructor(strNamespace) {
				super(strNamespace);
				Storage = this;
			}

			InsertValue(hSOCIHandle, strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
				g_Assert.equal(hSOCIHandle, this.Handle, "rollback workflow retains the actual session");
				g_Assert.equal(strPlayerUniqueID, "FixturePlayer", "rollback workflow player identity");
				g_Assert.equal(strSettingName, "RejectedValue", "rollback workflow setting identity");
				g_Assert.equal(SettingsValue, 42, "rollback workflow insert value");
				g_Assert.equal(Options.Blocking, bBlocking, "rollback workflow insert forwards mode");
				g_Assert.equal(typeof Callback, "function", "rollback workflow insert requires callback");
				// Undefined is an error value; only null denotes successful completion.
				Callback(undefined);
			}
		}

		const Workflow = ExecuteDocumentationCodeBlock(strWorkflowCode, 0, { SettingsStorage: FixtureSettingsStorage });
		let bFailed = false;
		let CaughtFailure = null;

		try {
			await Workflow.VerifySettingsRollback(`rollback-undefined-${bBlocking}`, "FixturePlayer", { Blocking: bBlocking });
		} catch (WorkflowFailure) {
			CaughtFailure = WorkflowFailure;
			bFailed = true;
		}

		g_Assert.equal(bFailed, true, "undefined insert error cannot be replaced by the deliberate rejection");
		g_Assert.equal(CaughtFailure, undefined, "rollback workflow preserves the undefined insert error");
		g_Assert.equal(Storage.Handle, null, "rollback workflow closes its session after undefined failure");
	}
}

async function VerifySettingsStorageDocumentationWorkflows() {
	await VerifyThrownSettingsRequestFailures();
	await VerifyStoredValueWorkflowCleanup();
	await VerifyOwnedSettingsWorkflowCleanup();
	await VerifyRollbackWorkflowUndefinedFailure();

	for (const bBlocking of [false, true]) {
		g_Assert.deepEqual(ToPlainValue(g_SettingsStorageDocumentationWorkflows.InspectStorageConfiguration("db=sourcejs user=sourcejs host=/run/mysqld/mysqld.sock")), {
			DefaultSOCIHandle: null,
			DefaultSettingsNamespace: "players",
			DefaultStorageOptions: { Backend: "sqlite3", ConnectionString: null, DatabasePath: null },
			MariaDBStorageConfiguration: { Backend: "mysql", ConnectionString: "db=sourcejs user=sourcejs host=/run/mysqld/mysqld.sock" },
			SettingsRoot: "memory/settings",
			SQLiteStorageConfiguration: { Backend: "sqlite3", ConnectionString: "dbname=memory/settings/MatchHistory.sqlite3", DatabasePath: "memory/settings/MatchHistory.sqlite3" },
		}, "settings/storage configuration workflow");

		g_Assert.deepEqual(ToPlainValue(await g_SettingsStorageDocumentationWorkflows.ExerciseStoredValueKinds("docs-value-kinds", "STEAM_1:1:12345", { Blocking: bBlocking })), {
			BigIntValue: g_nLargeSignedSettingsValue,
			BooleanValue: true,
			EmptyStringValue: "",
			MissingValue: "default",
			NullValue: null,
			NumberValue: 12.5,
			StringValue: "ready",
		}, "settings/storage supported values workflow");

		g_Assert.deepEqual(ToPlainValue(await g_SettingsStorageDocumentationWorkflows.ExerciseLiveSettingsCache("docs-live-cache", "STEAM_1:1:20", { Blocking: bBlocking })), {
			HasPlayer: true,
			PlayerSettingsValuesIdentityChanged: true,
			SettingsDataIdentityPreserved: true,
			SettingsValues: { ShowDamage: true, Theme: "dark" },
		}, "settings/storage live cache workflow");

		const SettingsCollectionWorkflowResult = ToPlainValue(await g_SettingsStorageDocumentationWorkflows.ExerciseSettingsCollections("docs-collections", "STEAM_1:1:10", "STEAM_1:1:11", { Blocking: bBlocking }));
		g_Assert.deepEqual(SettingsCollectionWorkflowResult, {
			FirstPlayerClearSucceeded: true,
			FirstPlayerWasRemoved: true,
			IteratorPlayerUniqueIDs: ["STEAM_1:1:10", "STEAM_1:1:11"],
			PlayerSettingsEntries: [
				["STEAM_1:1:10", "STEAM_1:1:10"],
				["STEAM_1:1:11", "STEAM_1:1:11"],
			],
			PlayerSettingsVisits: [
				{ ColorSettingValue: "green", PlayerUniqueID: "STEAM_1:1:10", SameSettingsStorage: true },
				{ ColorSettingValue: "blue", PlayerUniqueID: "STEAM_1:1:11", SameSettingsStorage: true },
			],
			PlayerSettingsViewUniqueIDs: ["STEAM_1:1:10", "STEAM_1:1:11"],
			PlayerUniqueIDs: ["STEAM_1:1:10", "STEAM_1:1:11"],
			PlayerUniqueIDsAfterClear: [],
			SettingsStorageWasCleared: true,
		}, "settings/storage collection workflow");

		const LowLevelSettingsStorageWorkflowResult = await g_SettingsStorageDocumentationWorkflows.ExerciseLowLevelSettingsStorage("docs-low-level", "STEAM_1:1:30", { Blocking: bBlocking });
		g_Assert.equal(LowLevelSettingsStorageWorkflowResult.SettingsCacheIsLive, true, "low-level live cache identity");
		g_Assert.ok(Number.isSafeInteger(LowLevelSettingsStorageWorkflowResult.SOCIHandle) && (LowLevelSettingsStorageWorkflowResult.SOCIHandle > 0), "low-level numeric SOCI handle");
		g_Assert.equal(LowLevelSettingsStorageWorkflowResult.SOCIHandleIsCurrent, true, "low-level current SOCI handle");
		g_Assert.equal(LowLevelSettingsStorageWorkflowResult.ReadySettingValue, true, "low-level inserted value");
		g_Assert.equal(LowLevelSettingsStorageWorkflowResult.LevelShutdownSaveSucceeded, true, "OnLevelShutdown save");

		g_Assert.deepEqual(ToPlainValue(await g_SettingsStorageDocumentationWorkflows.VerifySettingsRollback("docs-rollback", "STEAM_1:1:35", { Blocking: bBlocking })), {
			SettingWasRolledBack: true,
			TransactionErrorMessage: "Reject this settings update",
		}, "settings/storage rollback workflow");

		g_Assert.deepEqual(ToPlainValue(await g_SettingsStorageDocumentationWorkflows.ExercisePlayerSettingsView("docs-player-view", "STEAM_1:1:40", { Blocking: bBlocking })), {
			ConstructorPlayerUniqueID: "STEAM_1:1:40",
			EmptyCachedSizeAfterClear: 0,
			FactoryPlayerUniqueID: "STEAM_1:1:40",
			HasVolumeSetting: true,
			IteratorSettingEntries: [
				["Language", "ru"],
				["Volume", 75],
			],
			LanguageSettingValue: "ru",
			LanguageSettingValueAfterClear: null,
			PlayerSettingsWereCleared: true,
			PlayerWasRecreated: true,
			PlayerWasRemoved: true,
			SettingCount: 2,
			SettingEntries: [
				["Language", "ru"],
				["Volume", 75],
			],
			SettingNames: ["Language", "Volume"],
			SettingsValues: { Language: "ru", Volume: 75 },
			SettingVisits: [
				{ SamePlayerSettingsView: true, SettingName: "Language", SettingValue: "ru" },
				{ SamePlayerSettingsView: true, SettingName: "Volume", SettingValue: 75 },
			],
			SettingsStorageIsCurrent: true,
			VolumeSettingWasDeleted: true,
		}, "settings/storage player view workflow");
	}
}

const g_unDocumentationTimeoutMilliseconds = 5000;
const g_MissingNativeRuntimeProcessResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSettingsStorageSourcePath)});`], { encoding: "utf8", env: { ...process.env, NODE_PATH: g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs") }, timeout: g_unDocumentationTimeoutMilliseconds });
g_Assert.equal(g_MissingNativeRuntimeProcessResult.error, undefined, "missing-runtime subprocess starts successfully");
g_Assert.equal(g_MissingNativeRuntimeProcessResult.status, 1, "missing-runtime subprocess reports the expected Node failure status");
g_Assert.notEqual(g_MissingNativeRuntimeProcessResult.status, 0, "settings/storage requires the native runtime");
g_Assert.match(g_MissingNativeRuntimeProcessResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

let g_DocumentationTimeoutTimer = null;

async function CompleteSettingsStorageDocumentation() {
	let PrimaryError = undefined;
	let bHasPrimaryError = false;

	try {
		await Promise.race([
			VerifySettingsStorageDocumentationWorkflows(),
			new Promise((Resolve, Reject) => {
				g_DocumentationTimeoutTimer = setTimeout(() => Reject(new Error("Settings-storage documentation workflows did not complete within the timeout.")), g_unDocumentationTimeoutMilliseconds);
			}),
		]);
	} catch (Failure) {
		PrimaryError = Failure;
		bHasPrimaryError = true;
	} finally {
		clearTimeout(g_DocumentationTimeoutTimer);

		try {
			ReleaseSettingsStorageFixture();
		} catch (CleanupFailure) {
			throw new AggregateError(bHasPrimaryError ? [PrimaryError, CleanupFailure] : [CleanupFailure], "Settings/storage asynchronous verification cleanup failed.");
		}
	}

	if (bHasPrimaryError) {
		throw PrimaryError;
	}
}

const g_DocumentationCompletion = CompleteSettingsStorageDocumentation();
g_DocumentationCompletion.then(() => {
	console.log("[  OK  ] smoke_settings_storage");
}, (DocumentationError) => {
	console.error(DocumentationError);
	process.exitCode = 1;
});
