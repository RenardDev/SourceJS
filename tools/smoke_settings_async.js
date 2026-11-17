"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_settings_async.js\nExecutes settings/storage JavaScript and documentation examples with a SOCI model; no native workers or database IO.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_settings_async.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

// Persistent SQL column names are external storage-format keys, not public API properties.
// This model verifies JavaScript sequencing and errors, not native worker/driver behavior.
const g_unMaximumDrainSteps = 100000;
const g_unMaximumDocumentationSteps = 10000;
const g_nSigned64Maximum = 9223372036854775807n;
const g_vecPending = [];
const g_vecCalls = [];
const g_vecFaults = [];
const g_mapSessions = new Map();
const g_Database = { Players: new Map(), Values: new Map() };
let g_hNextSession = 1;

function GetPlayerKey(strNamespace, strUniqueID) {
	return JSON.stringify([strNamespace, strUniqueID]);
}

function GetValueKey(Parameters) {
	return JSON.stringify([Parameters.namespace, Parameters.uniqueid, Parameters.name]);
}

function CopyDatabase() {
	return { Players: new Map(g_Database.Players), Values: new Map(g_Database.Values) };
}

function RestoreDatabase(Snapshot) {
	g_Database.Players = new Map(Snapshot.Players);
	g_Database.Values = new Map(Snapshot.Values);
}

function RunNative(strMethod, vecArguments) {
	if (strMethod === "Connect") {
		const hSession = g_hNextSession++;
		g_mapSessions.set(hSession, { Connected: true, Snapshot: null });
		return hSession;
	}

	const Session = g_mapSessions.get(vecArguments[0]);
	if (!Session) {
		if (strMethod === "Close") {
			return false;
		}

		throw new Error("The test SOCI session is unavailable.");
	}

	switch (strMethod) {
		case "Close":
			if (Session.Snapshot !== null) {
				RestoreDatabase(Session.Snapshot);
			}

			g_mapSessions.delete(vecArguments[0]);
			return true;

		case "IsConnected":
			return Session.Connected;

		case "Reconnect":
			Session.Connected = true;
			return true;

		case "Begin":
			g_Assert.equal(Session.Snapshot, null, "no overlapping transactions");
			Session.Snapshot = CopyDatabase();
			return true;

		case "Commit":
			g_Assert.notEqual(Session.Snapshot, null);
			Session.Snapshot = null;
			return true;

		case "Rollback":
			g_Assert.notEqual(Session.Snapshot, null);
			RestoreDatabase(Session.Snapshot);
			Session.Snapshot = null;
			return true;
	}

	const strSQL = vecArguments[1];
	const Parameters = vecArguments[2];
	if (strMethod === "Query") {
		if (strSQL.startsWith("SELECT uniqueid FROM sourcejs_settings_players")) {
			return Array.from(g_Database.Players.values()).filter((Row) => (Row.namespace === Parameters.namespace) && ((Parameters.uniqueid === undefined) || (Row.uniqueid === Parameters.uniqueid))).map((Row) => ({ uniqueid: Row.uniqueid }));
		}

		if (strSQL.startsWith("SELECT uniqueid, setting_name, value_kind, value_text, value_number FROM sourcejs_settings_values")) {
			return Array.from(g_Database.Values.values()).filter((Row) => Row.namespace === Parameters.namespace).map((Row) => ({ ...Row }));
		}

		throw new Error("Unsupported query in the SOCI model: " + strSQL);
	}

	g_Assert.equal(strMethod, "Execute", "only declared SOCI methods");

	if (strSQL.startsWith("CREATE TABLE")) {
		return 0n;
	}

	if (strSQL.startsWith("INSERT INTO sourcejs_settings_players")) {
		g_Database.Players.set(GetPlayerKey(Parameters.namespace, Parameters.uniqueid), { namespace: Parameters.namespace, uniqueid: Parameters.uniqueid });
		return 1n;
	}

	if (strSQL.startsWith("INSERT INTO sourcejs_settings_values")) {
		g_Database.Values.set(GetValueKey(Parameters), { namespace: Parameters.namespace, uniqueid: Parameters.uniqueid, setting_name: Parameters.name, value_kind: Parameters.kind, value_text: Parameters.text, value_number: Parameters.number });
		return 1n;
	}

	if (!strSQL.startsWith("DELETE FROM sourcejs_settings_players") && !strSQL.startsWith("DELETE FROM sourcejs_settings_values")) {
		throw new Error("Unsupported statement in the SOCI model: " + strSQL);
	}

	let nAffectedRowCount = 0n;
	const mapRows = strSQL.includes("sourcejs_settings_players") ? g_Database.Players : g_Database.Values;
	for (const [strKey, Row] of mapRows) {
		if ((Row.namespace === Parameters.namespace) && ((Parameters.uniqueid === undefined) || (Row.uniqueid === Parameters.uniqueid)) && ((Parameters.name === undefined) || (Row.setting_name === Parameters.name))) {
			mapRows.delete(strKey);
			nAffectedRowCount++;
		}
	}

	return nAffectedRowCount;
}

function SubmitNative(strMethod, ...vecArguments) {
	const Callback = vecArguments.pop();
	const Options = vecArguments.pop();
	g_Assert.equal(typeof Callback, "function", "native callback required");
	g_Assert.equal(typeof Options.Blocking, "boolean", "native Options required");
	g_vecCalls.push({ Method: strMethod, Arguments: vecArguments, Blocking: Options.Blocking });

	const Complete = () => {
		let Result = null;
		let RequestError = null;
		const nFaultIndex = g_vecFaults.findIndex((Fault) => (Fault.Method === strMethod) && ((Fault.SQL === undefined) || String(vecArguments[1]).includes(Fault.SQL)));
		try {
			if (nFaultIndex >= 0) {
				const Fault = g_vecFaults.splice(nFaultIndex, 1)[0];
				if (Object.hasOwn(Fault, "Error")) {
					throw Fault.Error;
				}

				Result = Fault.Result;

			} else {
				Result = RunNative(strMethod, vecArguments);
			}
		} catch (Failure) {
			RequestError = Failure;
		}

		Callback(RequestError, Result);
	};

	if (Options.Blocking) {
		Complete();

	} else {
		g_vecPending.push(Complete);
	}
}

const g_SOCI = {};
for (const strMethod of ["Connect", "Close", "Execute", "Query", "IsConnected", "Reconnect", "Begin", "Commit", "Rollback"]) {
	g_SOCI[strMethod] = (...vecArguments) => SubmitNative(strMethod, ...vecArguments);
}

const g_Settings = { Root: "/settings", EnsureDirectoryExists: () => true };
const g_Module = { exports: {} };
const g_strStoragePath = g_Path.join(__dirname, "..", "packages", "sourcejs", "settings", "storage.js");
const g_LoadStorage = new Function("require", "module", g_FileSystem.readFileSync(g_strStoragePath, "utf8"));
g_LoadStorage((strModule) => {
	g_Assert.equal(strModule, "internal/runtime");

	return {
		GetModule(strName) {
			g_Assert.equal(["soci", "settings"].includes(strName), true, "only declared runtime dependencies");

			return (strName === "soci") ? g_SOCI : g_Settings;
		},
	};
}, g_Module);

const { SettingsStorage } = g_Module.exports;

function DrainPending() {
	let unSteps = 0;
	while (g_vecPending.length > 0) {
		unSteps++;
		g_Assert.equal(unSteps < g_unMaximumDrainSteps, true, "finite request sequence");
		g_vecPending.shift()();
	}
}

function RunRequest(Storage, strMethod, vecArguments = [], Options = {}) {
	let unCallbackCount = 0;
	let RequestError = null;
	let RequestResult = null;
	const Result = Storage[strMethod](...vecArguments, Options, (Failure, Value) => {
		unCallbackCount++;
		RequestError = Failure;
		RequestResult = Value;
	});
	g_Assert.equal(Result, undefined, strMethod + " has no direct result");

	if (Options.Blocking) {
		g_Assert.equal(unCallbackCount, 1, strMethod + " Blocking callback before return");

	} else {
		DrainPending();
	}

	g_Assert.equal(unCallbackCount, 1, strMethod + " completes once");

	return { Error: RequestError, Result: RequestResult };
}

async function VerifySettingsStorageDocumentation() {
	const strDocumentationPath = g_Path.join(__dirname, "..", "docs", "api", "settings-storage.md");
	const strDocumentation = g_FileSystem.readFileSync(strDocumentationPath, "utf8");
	const vecExamples = Array.from(strDocumentation.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g), (vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 8, "all storage documentation examples are covered");

	for (const strExample of vecExamples) {
		new Function("require", "module", strExample);
	}

	const Imports = new Function("require", vecExamples[0] + "\nreturn { DEFAULT_STORAGE, PlayerSettingsView, ROOT, SettingsStorage, CreateStorage };")((strModuleName) => {
		g_Assert.equal(strModuleName, "settings/storage");

		return g_Module.exports;
	});
	g_Assert.equal(Imports.DEFAULT_STORAGE, g_Module.exports.DEFAULT_STORAGE);
	g_Assert.equal(Imports.PlayerSettingsView, g_Module.exports.PlayerSettingsView);
	g_Assert.equal(Imports.ROOT, g_Settings.Root);
	g_Assert.equal(Imports.SettingsStorage, SettingsStorage);
	g_Assert.equal(Imports.CreateStorage, g_Module.exports.CreateStorage);

	const LoadExample = (strFunctionName) => {
		const strExample = vecExamples.find((strCode) => strCode.includes("function " + strFunctionName + "("));
		g_Assert.equal(typeof strExample, "string", strFunctionName + " is documented");

		const Module = { exports: {} };
		new Function("require", "module", strExample)((strModuleName) => {
			g_Assert.equal(strModuleName, "settings/storage");

			return g_Module.exports;
		}, Module);

		return Module.exports[strFunctionName];
	};
	const InspectStorageConfiguration = LoadExample("InspectStorageConfiguration");
	const unCallsBeforeInspection = g_vecCalls.length;
	const Configuration = InspectStorageConfiguration("host=example db=test user=test password=test");
	g_Assert.equal(Configuration.DefaultSOCIHandle, null);
	g_Assert.equal(Configuration.SQLiteStorageConfiguration.DatabasePath, g_Settings.Root + "/MatchHistory.sqlite3");
	g_Assert.equal(g_vecCalls.length, unCallsBeforeInspection, "configuration inspection performs no IO");

	const vecScenarios = [
		["ExerciseStoredValueKinds", ["DocKinds", "Player"], (Result) => {
			g_Assert.equal(Result.BigIntValue, g_nSigned64Maximum);
			g_Assert.equal(Result.BooleanValue, true);
			g_Assert.equal(Result.EmptyStringValue, "");
			g_Assert.equal(Result.MissingValue, "default");
			g_Assert.equal(Result.NullValue, null);
			g_Assert.equal(Result.NumberValue, 12.5);
			g_Assert.equal(Result.StringValue, "ready");
		}],
		["ExerciseLiveSettingsCache", ["DocLive", "Player"], (Result) => {
			g_Assert.equal(Result.HasPlayer, true);
			g_Assert.equal(Result.PlayerSettingsValuesIdentityChanged, true);
			g_Assert.equal(Result.SettingsDataIdentityPreserved, true);
			g_Assert.deepEqual(Result.SettingsValues, { ShowDamage: true, Theme: "dark" });
		}],
		["ExerciseSettingsCollections", ["DocCollections", "First", "Second"], (Result) => {
			g_Assert.deepEqual(Result.PlayerUniqueIDs, ["First", "Second"]);
			g_Assert.deepEqual(Result.IteratorPlayerUniqueIDs, ["First", "Second"]);
			g_Assert.equal(Result.PlayerSettingsEntries.length, 2);
			g_Assert.equal(Result.PlayerSettingsVisits.length, 2);
			g_Assert.equal(Result.PlayerSettingsVisits.every((Visit) => Visit.SameSettingsStorage), true);
			g_Assert.deepEqual(Result.PlayerSettingsViewUniqueIDs, ["First", "Second"]);
			g_Assert.equal(Result.FirstPlayerClearSucceeded, true);
			g_Assert.equal(Result.FirstPlayerWasRemoved, true);
			g_Assert.equal(Result.SettingsStorageWasCleared, true);
			g_Assert.deepEqual(Result.PlayerUniqueIDsAfterClear, []);
		}],
		["ExerciseLowLevelSettingsStorage", ["DocLowLevel", "Player"], (Result) => {
			g_Assert.equal(Result.LevelShutdownSaveSucceeded, true);
			g_Assert.equal(Result.ReadySettingValue, true);
			g_Assert.equal(Result.SettingsCacheIsLive, true);
			g_Assert.equal(Result.SOCIHandleIsCurrent, true);
		}],
		["VerifySettingsRollback", ["DocRollback", "Player"], (Result) => {
			g_Assert.equal(Result.SettingWasRolledBack, true);
			g_Assert.equal(Result.TransactionErrorMessage, "Reject this settings update");
		}],
		["ExercisePlayerSettingsView", ["DocView", "Player"], (Result) => {
			g_Assert.equal(Result.ConstructorPlayerUniqueID, "Player");
			g_Assert.equal(Result.FactoryPlayerUniqueID, "Player");
			g_Assert.equal(Result.HasVolumeSetting, true);
			g_Assert.equal(Result.LanguageSettingValue, "ru");
			g_Assert.equal(Result.SettingCount, 2);
			g_Assert.deepEqual(Result.SettingEntries, [["Language", "ru"], ["Volume", 75]]);
			g_Assert.deepEqual(Result.IteratorSettingEntries, Result.SettingEntries);
			g_Assert.deepEqual(Result.SettingNames, ["Language", "Volume"]);
			g_Assert.deepEqual(Result.SettingsValues, { Language: "ru", Volume: 75 });
			g_Assert.equal(Result.SettingVisits.every((Visit) => Visit.SamePlayerSettingsView), true);
			g_Assert.equal(Result.SettingsStorageIsCurrent, true);
			g_Assert.equal(Result.VolumeSettingWasDeleted, true);
			g_Assert.equal(Result.PlayerSettingsWereCleared, true);
			g_Assert.equal(Result.PlayerWasRemoved, true);
			g_Assert.equal(Result.EmptyCachedSizeAfterClear, 0);
			g_Assert.equal(Result.LanguageSettingValueAfterClear, null);
			g_Assert.equal(Result.PlayerWasRecreated, true);
		}],
	];
	for (const bBlocking of [false, true]) {
		for (const [strFunctionName, vecArguments, ValidateResult] of vecScenarios) {
			const Exercise = LoadExample(strFunctionName);
			let bCompleted = false;
			let RequestError = null;
			let RequestResult = null;
			Exercise(...vecArguments, { Blocking: bBlocking }).then((Result) => {
				RequestResult = Result;
				bCompleted = true;
			}, (Failure) => {
				RequestError = Failure;
				bCompleted = true;
			});

			for (let unStep = 0; !bCompleted && (unStep < g_unMaximumDocumentationSteps); unStep++) {
				DrainPending();
				await Promise.resolve();
			}

			g_Assert.equal(bCompleted, true, strFunctionName + " completes");
			g_Assert.equal(RequestError, null, strFunctionName + " succeeds");
			ValidateResult(RequestResult);
			g_Assert.equal(g_mapSessions.size, 0, strFunctionName + " closes its session");
			g_Assert.equal(g_vecPending.length, 0, strFunctionName + " leaves no requests");
		}
	}
}

const g_Storage = new SettingsStorage("Main");
g_Assert.equal(g_vecCalls.length, 0, "constructors do not perform IO");
g_Assert.throws(() => g_Storage.Open(), TypeError);
g_Assert.throws(() => g_Storage.Open({ Blocking: 1 }, () => {}), TypeError);
g_Assert.throws(() => g_Storage.Open([], () => {}), TypeError);
g_Assert.throws(() => g_Storage.GetSetting("Player", "Score", null, {}), TypeError);
g_Assert.equal(g_vecCalls.length, 0, "invalid callback rejected before IO");
g_Assert.throws(() => g_Storage.Keys(), /must be loaded/);

let g_unLoadCallbacks = 0;
g_Storage.Reload({}, (Failure, Values) => {
	g_Assert.equal(Failure, null);
	g_Assert.equal(Values, g_Storage.Data);
	g_unLoadCallbacks++;
});
g_Assert.equal(g_unLoadCallbacks, 0);
g_Assert.equal(g_vecPending.length, 1);
g_Assert.throws(() => g_Storage.Save({ Blocking: true }, () => {}), /pending operation/);
DrainPending();
g_Assert.equal(g_unLoadCallbacks, 1);

const g_DataIdentity = g_Storage.Data;
g_Assert.equal(RunRequest(g_Storage, "SetSetting", ["Player", "Score", g_nSigned64Maximum]).Error, null);
g_Assert.equal(RunRequest(g_Storage, "GetSetting", ["Player", "Score", null]).Result, g_nSigned64Maximum);
const g_PlayerValues = g_Storage.Data.Player;
const g_PlayerView = g_Storage.GetSettingsForPlayer("Player");
g_Assert.equal(g_PlayerView.Size, 1);
g_Assert.deepEqual(g_PlayerView.Keys(), ["Score"]);
g_Assert.equal(RunRequest(g_Storage, "HasPlayer", ["Player"]).Result, true);

const g_CommitFailure = new Error("commit failure");
g_vecFaults.push({ Method: "Commit", Error: g_CommitFailure });
g_Assert.equal(RunRequest(g_Storage, "SetSetting", ["Player", "Score", 7]).Error, g_CommitFailure);
g_Assert.equal(g_Storage.Data, g_DataIdentity);
g_Assert.equal(g_Storage.Data.Player, g_PlayerValues);
g_Assert.equal(g_PlayerValues.Score, g_nSigned64Maximum, "live record restored after failed commit");
g_Assert.equal(RunRequest(g_Storage, "Reload").Error, null);
g_Assert.equal(g_Storage.Data.Player.Score, g_nSigned64Maximum, "database rolled back");

const g_vecCompletions = [];
g_Storage.SetSetting("Player", "Score", 8, {}, (Failure) => {
	g_Assert.equal(Failure, null);
	g_vecCompletions.push("set");
});
g_Storage.Reload({}, (Failure) => {
	g_Assert.equal(Failure, null);
	g_vecCompletions.push("reload");
});
DrainPending();
g_Assert.deepEqual(g_vecCompletions, ["set", "reload"]);
g_Assert.equal(g_Storage.Data.Player.Score, 8, "queued reload observes committed value");
g_Assert.equal(RunRequest(g_Storage, "Save", [], { Blocking: true }).Error, null);
g_Assert.equal(RunRequest(g_Storage, "DeleteSetting", ["Player", "Score"], { Blocking: true }).Result, true);
g_Assert.equal(RunRequest(g_Storage, "DeleteSetting", ["Player", "Score"]).Result, false);
g_Assert.equal(RunRequest(g_Storage, "GetSetting", ["Player", "Missing", "default"]).Result, "default");

const g_SchemaStorage = new SettingsStorage("Schema");
const g_SchemaFailure = new Error("schema failure");
const g_CloseFailure = new Error("close failure");
g_vecFaults.push({ Method: "Execute", SQL: "CREATE TABLE", Error: g_SchemaFailure }, { Method: "Close", Error: g_CloseFailure });
const g_SchemaResult = RunRequest(g_SchemaStorage, "Open");
g_Assert.equal(g_SchemaResult.Error instanceof AggregateError, true);
g_Assert.notEqual(g_SchemaStorage.Handle, null, "failed cleanup retains handle");
g_Assert.equal(RunRequest(g_SchemaStorage, "Open").Error, null, "retained handle retries schema");

const g_RollbackFailure = new Error("rollback failure");
g_vecFaults.push({ Method: "Commit", Error: g_CommitFailure }, { Method: "Rollback", Error: g_RollbackFailure });
const g_FailedTransaction = RunRequest(g_Storage, "SetSetting", ["Player", "Score", 10]);
g_Assert.equal(g_FailedTransaction.Error instanceof AggregateError, true);
g_Assert.equal(RunRequest(g_Storage, "Open").Error instanceof Error, true, "unsafe session cannot be reused");
g_Assert.equal(RunRequest(g_Storage, "Close").Result, true);
g_Assert.equal(RunRequest(g_Storage, "Reload").Error, null);

const g_CallbackFailure = new Error("callback failure");
let g_unCallbackCount = 0;
g_Assert.throws(() => g_Storage.GetAllSettings({}, () => {
	g_unCallbackCount++;
	throw g_CallbackFailure;
}), (Failure) => Failure === g_CallbackFailure);
g_Assert.equal(g_unCallbackCount, 1);
g_Assert.equal(RunRequest(g_Storage, "Open").Error, null, "queue survives callback exception");

let g_unTransactionCallbacks = 0;
g_Storage.RunTransaction((hSession, Options, CompleteTransaction) => {
	g_SOCI.Execute(hSession, "CREATE TABLE IF NOT EXISTS Temporary (Value INTEGER)", {}, Options, (Failure) => CompleteTransaction(Failure, "transaction result"));
}, { Blocking: true }, (Failure, Result) => {
	g_Assert.equal(Failure, null);
	g_Assert.equal(Result, "transaction result");
	g_unTransactionCallbacks++;
});
g_Assert.equal(g_unTransactionCallbacks, 1);

g_Assert.equal(RunRequest(g_Storage, "ClearPlayer", ["Player"]).Result, true);
g_Assert.equal(RunRequest(g_Storage, "HasPlayer", ["Player"]).Result, false);
g_Assert.equal(RunRequest(g_Storage, "ClearSettings").Result, true);
g_Assert.equal(RunRequest(g_Storage, "Close", [], { Blocking: true }).Result, true);
g_Assert.equal(RunRequest(g_Storage, "Close", [], { Blocking: true }).Result, false);
g_Assert.equal(g_vecPending.length, 0);
g_Assert.equal(g_vecFaults.length, 0);
g_Assert.equal(g_vecCalls.some((Call) => Call.Blocking), true);
g_Assert.equal(g_vecCalls.some((Call) => !Call.Blocking), true);

const g_EdgeStorage = new SettingsStorage("Edge");
g_Assert.equal(RunRequest(g_EdgeStorage, "SetSetting", ["Player", "Score", 5]).Error, null);
const g_EdgeData = g_EdgeStorage.Data;
g_EdgeStorage.ValueData = new Proxy(g_EdgeData, {
	get(Target, PropertyName, Receiver) {
		return (PropertyName === "Player") ? null : Reflect.get(Target, PropertyName, Receiver);
	},
});
g_EdgeStorage.ValueLoaded = false;
let g_unBadRecordCallbacks = 0;
let g_unFollowingCallbacks = 0;
g_EdgeStorage.GetPlayerValues("Player", {}, (Failure) => {
	g_Assert.equal(Failure instanceof TypeError, true);
	g_unBadRecordCallbacks++;
});
g_EdgeStorage.HasPlayer("Player", {}, (Failure, bHasPlayer) => {
	g_Assert.equal(Failure, null);
	g_Assert.equal(bHasPlayer, true);
	g_unFollowingCallbacks++;
});
DrainPending();
g_Assert.equal(g_unBadRecordCallbacks, 1, "deferred invalid record completes once");
g_Assert.equal(g_unFollowingCallbacks, 1, "queue survives deferred invalid record");

g_EdgeStorage.ValueData = g_EdgeData;
const g_ProxyFailure = new Error("live record trap");
let g_bRejectOwnProperty = true;
g_EdgeStorage.ValueData = new Proxy(g_EdgeData, {
	getOwnPropertyDescriptor(Target, PropertyName) {
		if (g_bRejectOwnProperty && (PropertyName === "Player")) {
			throw g_ProxyFailure;
		}

		return Reflect.getOwnPropertyDescriptor(Target, PropertyName);
	},
});
g_Assert.equal(RunRequest(g_EdgeStorage, "HasPlayer", ["Player"]).Error, g_ProxyFailure);
g_Assert.equal(RunRequest(g_EdgeStorage, "ClearPlayer", ["Player"]).Error, g_ProxyFailure);
g_bRejectOwnProperty = false;
g_Assert.equal(RunRequest(g_EdgeStorage, "HasPlayer", ["Player"]).Result, true);

g_EdgeStorage.ValueData = g_EdgeData;
const g_PlayerData = g_EdgeStorage.Data.Player;
g_EdgeStorage.Data.Player = new Proxy(g_PlayerData, {
	getOwnPropertyDescriptor(Target, PropertyName) {
		if (PropertyName === "Score") {
			throw g_ProxyFailure;
		}

		return Reflect.getOwnPropertyDescriptor(Target, PropertyName);
	},
});
g_Assert.equal(RunRequest(g_EdgeStorage, "DeleteSetting", ["Player", "Score"]).Error, g_ProxyFailure);
const g_EdgeView = g_EdgeStorage.GetSettingsForPlayer("Player");
g_Assert.equal(RunRequest(g_EdgeView, "HasSetting", ["Score"]).Error, g_ProxyFailure);
g_EdgeStorage.Data.Player = g_PlayerData;
g_Assert.equal(RunRequest(g_EdgeStorage, "GetSetting", ["Player", "Score", null]).Result, 5);

const g_OtherStorage = new SettingsStorage("Other");
let g_unOtherCallbacks = 0;
g_EdgeStorage.Open({}, (Failure) => g_Assert.equal(Failure, null));
g_OtherStorage.Open({ Blocking: true }, (Failure) => {
	g_Assert.equal(Failure, null);
	g_unOtherCallbacks++;
});
g_Assert.equal(g_unOtherCallbacks, 1, "another instance can block while first is pending");
DrainPending();

let g_unNestedBlockingCallbacks = 0;
g_EdgeStorage.Open({}, (Failure) => {
	g_Assert.equal(Failure, null);
	g_EdgeStorage.Open({ Blocking: true }, (NestedError) => {
		g_Assert.equal(NestedError, null);
		g_unNestedBlockingCallbacks++;
	});
});
DrainPending();
g_Assert.equal(g_unNestedBlockingCallbacks, 1, "callbacks execute after releasing the instance queue");

const g_MutableOptions = { Blocking: false };
let g_unOptionCallbacks = 0;
g_EdgeStorage.Open(g_MutableOptions, (Failure) => {
	g_Assert.equal(Failure, null);
	g_unOptionCallbacks++;
});
g_MutableOptions.Blocking = true;
DrainPending();
g_Assert.equal(g_unOptionCallbacks, 1);
g_Assert.equal(g_vecCalls.at(-1).Blocking, false, "all steps preserve the option snapshot");

const g_QueuedCallbackFailure = new Error("queued callback failure");
let g_unQueuedCallbacks = 0;
g_EdgeStorage.Open({}, () => {
	g_unQueuedCallbacks++;
	throw g_CallbackFailure;
});
g_EdgeStorage.HasPlayer("Player", {}, () => {
	g_unQueuedCallbacks++;
	throw g_QueuedCallbackFailure;
});
g_Assert.throws(DrainPending, (Failure) => (Failure instanceof AggregateError) && (Failure.errors[0] === g_CallbackFailure) && (Failure.errors[1] === g_QueuedCallbackFailure));
g_Assert.equal(g_unQueuedCallbacks, 2, "each throwing queued callback is delivered once");
g_Assert.equal(RunRequest(g_EdgeStorage, "Open").Error, null, "queue survives aggregated callback exceptions");

const g_MalformedStorage = new SettingsStorage("Malformed");
g_Assert.equal(RunRequest(g_MalformedStorage, "Open").Error, null);
g_vecFaults.push({ Method: "Execute", SQL: "CREATE TABLE", Result: 0 });
g_Assert.equal(RunRequest(g_MalformedStorage, "CreateSchema").Error instanceof TypeError, true, "native affected-row results must be BigInt");
g_vecFaults.push({ Method: "Query", Result: null });
g_Assert.equal(RunRequest(g_MalformedStorage, "Reload").Error instanceof TypeError, true, "native query results must be row arrays");
g_Assert.equal(g_MalformedStorage.Loaded, false);
g_Assert.equal(RunRequest(g_MalformedStorage, "Reload").Error, null);
g_Assert.equal(RunRequest(g_MalformedStorage, "SetSetting", ["Player", "Score", 42]).Error, null);
const g_MalformedData = g_MalformedStorage.Data;
g_vecFaults.push({ Method: "Query", Result: [{ uniqueid: "Player" }, { uniqueid: "Player" }] });
g_Assert.match(RunRequest(g_MalformedStorage, "Reload").Error.message, /Duplicate settings player/);
g_Assert.equal(g_MalformedStorage.Data, g_MalformedData);
g_Assert.equal(g_MalformedStorage.Data.Player.Score, 42, "failed reload does not replace live data");
g_Assert.equal(RunRequest(g_MalformedStorage, "Close").Result, true);

g_vecFaults.push({ Method: "Commit", Error: g_CommitFailure }, { Method: "Rollback", Error: g_RollbackFailure });
g_Assert.equal(RunRequest(g_EdgeStorage, "SetSetting", ["Player", "Score", 99]).Error instanceof AggregateError, true);
g_Assert.equal(RunRequest(g_EdgeStorage, "CreateSchema").Error instanceof Error, true);
g_Assert.throws(() => g_EdgeStorage.EnsurePlayer(g_EdgeStorage.Handle, "Another", {}, () => {}), /rollback failed/);
g_Assert.throws(() => g_EdgeStorage.InsertValue(g_EdgeStorage.Handle, "Player", "Score", 99, {}, () => {}), /rollback failed/);
g_Assert.equal(RunRequest(g_EdgeStorage, "Close").Result, true);
g_Assert.equal(RunRequest(g_OtherStorage, "Close").Result, true);
g_Assert.equal(RunRequest(g_SchemaStorage, "Close").Result, true);
g_Assert.equal(g_vecPending.length, 0);
g_Assert.equal(g_vecFaults.length, 0);
g_Assert.equal(g_mapSessions.size, 0);

VerifySettingsStorageDocumentation().then(() => {
	console.log("settings/storage async smoke passed: callback IO, Blocking, FIFO, BigInt, rollback, live records, recovery and all documentation examples.");
}, (Failure) => {
	console.error(Failure);
	process.exitCode = 1;
});
