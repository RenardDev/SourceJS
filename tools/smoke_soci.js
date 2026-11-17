#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "soci.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_unExpectedCodeBlockCount = 6;
const g_unRequestControlArgumentCount = 2;
const g_nInitialSequenceValue = 1001n;
const g_vecExpectedExports = [
	"Begin",
	"Close",
	"Commit",
	"Connect",
	"Execute",
	"GetBackendName",
	"GetNextSequenceValue",
	"IsConnected",
	"LastInsertId",
	"Query",
	"Reconnect",
	"Rollback",
];

const g_mapSessions = new Map();
const g_vecSOCICalls = [];

let g_unNextHandle = 1;

function CloneRows(mapRows) {
	return new Map(Array.from(mapRows, ([unIdentifier, Row]) => [unIdentifier, { ...Row }]));
}

function CloneSessionData(Session) {
	return { Audits: CloneRows(Session.Audits), LastInsertID: Session.LastInsertID, Players: CloneRows(Session.Players) };
}

function RestoreSessionData(Session, Snapshot) {
	Session.Audits = CloneRows(Snapshot.Audits);
	Session.LastInsertID = Snapshot.LastInsertID;
	Session.Players = CloneRows(Snapshot.Players);
}

function RequireSession(hSessionHandle) {
	const Session = g_mapSessions.get(hSessionHandle);
	if (!Session) {
		throw new Error("Unknown soci session handle.");
	}

	return Session;
}

const g_SOCIOperations = {
	GetBackendName(hSessionHandle) {
		g_vecSOCICalls.push(["GetBackendName", hSessionHandle]);

		return RequireSession(hSessionHandle).Backend;
	},

	Begin(hSessionHandle) {
		const Session = RequireSession(hSessionHandle);
		if (Session.Snapshot !== null) {
			throw new Error("A transaction is already active.");
		}

		g_vecSOCICalls.push(["Begin", hSessionHandle]);
		Session.Snapshot = CloneSessionData(Session);

		return true;
	},

	Close(hSessionHandle) {
		g_vecSOCICalls.push(["Close", hSessionHandle]);

		return g_mapSessions.delete(hSessionHandle);
	},

	Commit(hSessionHandle) {
		const Session = RequireSession(hSessionHandle);
		if (Session.Snapshot === null) {
			throw new Error("No transaction is active.");
		}

		g_vecSOCICalls.push(["Commit", hSessionHandle]);
		Session.Snapshot = null;

		return true;
	},

	Connect(strConnectionString, strBackend = null) {
		if ((typeof strConnectionString !== "string") || (strConnectionString.length === 0)) {
			throw new TypeError("SOCI Connection string must not be empty.");
		}

		const hSessionHandle = g_unNextHandle;
		g_unNextHandle += 1;
		g_vecSOCICalls.push(["Connect", strConnectionString, strBackend]);
		g_mapSessions.set(hSessionHandle, {
			Audits: new Map(),
			Backend: strBackend ?? "sqlite3",
			Connected: true,
			LastInsertID: 0n,
			Players: new Map(),
			Sequences: new Map(),
			Snapshot: null,
		});

		return hSessionHandle;
	},

	Execute(hSessionHandle, strStatement, StatementParameters = null) {
		const Session = RequireSession(hSessionHandle);

		g_vecSOCICalls.push(["Execute", hSessionHandle, strStatement, StatementParameters]);

		if (strStatement.startsWith("CREATE TABLE")) {
			return 0n;
		}

		if (strStatement.startsWith("INSERT INTO SourceJSPlayers")) {
			Session.LastInsertID += 1n;
			Session.Players.set(Session.LastInsertID, { ID: Session.LastInsertID, Name: StatementParameters.Name, Score: StatementParameters.Score });

			return 1n;
		}

		if (strStatement.startsWith("UPDATE SourceJSPlayers SET Score = Score -")) {
			const [unAmount, unIdentifier, unMinimum] = StatementParameters;
			const Row = Session.Players.get(BigInt(unIdentifier));
			if (!Row || (Row.Score < unMinimum)) {
				return 0n;
			}

			Row.Score -= unAmount;

			return 1n;
		}

		if (strStatement.startsWith("UPDATE SourceJSPlayers SET Score = Score +")) {
			const [unAmount, unIdentifier] = StatementParameters;
			const Row = Session.Players.get(BigInt(unIdentifier));
			if (!Row) {
				return 0n;
			}

			Row.Score += unAmount;

			return 1n;
		}

		if (strStatement.startsWith("INSERT INTO SourceJSAudit")) {
			Session.LastInsertID += 1n;
			Session.Audits.set(Session.LastInsertID, { EventName: StatementParameters.EventName, ID: Session.LastInsertID, PayloadJSON: StatementParameters.PayloadJSON });

			return 1n;
		}

		throw new Error(`Unexpected SOCI statement: ${strStatement}`);
	},

	IsConnected(hSessionHandle) {
		g_vecSOCICalls.push(["IsConnected", hSessionHandle]);

		return RequireSession(hSessionHandle).Connected;
	},

	LastInsertId(hSessionHandle, strTable) {
		g_vecSOCICalls.push(["LastInsertId", hSessionHandle, strTable]);

		return RequireSession(hSessionHandle).LastInsertID;
	},

	GetNextSequenceValue(hSessionHandle, strSequence) {
		const Session = RequireSession(hSessionHandle);
		const nSequenceValue = Session.Sequences.get(strSequence) ?? g_nInitialSequenceValue;

		g_vecSOCICalls.push(["GetNextSequenceValue", hSessionHandle, strSequence]);
		Session.Sequences.set(strSequence, nSequenceValue + 1n);

		return nSequenceValue;
	},

	Query(hSessionHandle, strStatement, StatementParameters = null) {
		const Session = RequireSession(hSessionHandle);

		g_vecSOCICalls.push(["Query", hSessionHandle, strStatement, StatementParameters]);

		if (strStatement.includes("FROM SourceJSPlayers")) {
			const Row = Session.Players.get(BigInt(StatementParameters.ID));
			return Row ? [{ ...Row }] : [];
		}

		if (strStatement.includes("FROM SourceJSAudit")) {
			const Row = Session.Audits.get(BigInt(StatementParameters.ID));
			return Row ? [{ ...Row }] : [];
		}

		throw new Error(`Unexpected SOCI Query: ${strStatement}`);
	},

	Reconnect(hSessionHandle) {
		const Session = RequireSession(hSessionHandle);

		g_vecSOCICalls.push(["Reconnect", hSessionHandle]);
		Session.Connected = true;

		return true;
	},

	Rollback(hSessionHandle) {
		const Session = RequireSession(hSessionHandle);
		if (Session.Snapshot === null) {
			throw new Error("No transaction is active.");
		}

		g_vecSOCICalls.push(["Rollback", hSessionHandle]);
		RestoreSessionData(Session, Session.Snapshot);
		Session.Snapshot = null;

		return true;
	},
};

// This double models copied requests and callback timing, not native threads, SQL engines or IO.
const g_SOCI = Object.fromEntries(g_vecExpectedExports.map((strMethodName) => {
	const Operation = g_SOCIOperations[strMethodName];

	return [strMethodName, (...vecArguments) => {
		if (vecArguments.length < g_unRequestControlArgumentCount) {
			throw new TypeError(`${strMethodName} requires an options object and callback.`);
		}

		const Callback = vecArguments.pop();
		const Options = vecArguments.pop();
		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError(`${strMethodName} requires an options object.`);
		}

		if (typeof Callback !== "function") {
			throw new TypeError(`${strMethodName} requires a callback.`);
		}

		const bBlocking = Options.Blocking;
		if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
			throw new TypeError(`${strMethodName} requires a boolean Blocking option.`);
		}

		const vecRequestArguments = structuredClone(vecArguments);
		const ExecuteRequest = () => {
			let Result = undefined;

			try {
				Result = Operation(...vecRequestArguments);
			} catch (RequestError) {
				const OperationError = (RequestError === null) ? new Error(`${strMethodName} fixture operation failed.`, { cause: RequestError }) : RequestError;
				Callback(OperationError, undefined);
				return;
			}

			Callback(null, Result);
		};

		if (bBlocking) {
			ExecuteRequest();

		} else {
			queueMicrotask(ExecuteRequest);
		}
	}];
}));

function CallSOCI(strMethodName, ...vecArguments) {
	let bCallbackCompleted = false;
	let RequestError = null;
	let Result = undefined;
	g_SOCI[strMethodName](...vecArguments, { Blocking: true }, (CallbackError, CallbackResult) => {
		RequestError = CallbackError;
		Result = CallbackResult;
		bCallbackCompleted = true;
	});

	if (!bCallbackCompleted) {
		throw new Error("Blocking SOCI smoke callback did not run before return.");
	}

	if (RequestError !== null) {
		throw RequestError;
	}

	return Result;
}

function ExecuteCodeBlock(strCode, unBlockIndex, SOCIAPI = g_SOCI) {
	const unSetupTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:block-${unBlockIndex}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));

	ModuleRecord.require = function RequireDocumentationModule(strModuleIdentifier) {
		g_Assert.equal(strModuleIdentifier, "soci", `soci code block ${unBlockIndex} import`);

		return SOCIAPI;
	};

	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strCode, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: unSetupTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CloneForAssertion(Value) {
	return structuredClone(Value);
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "soci contents section");

	const vecDocumentedAnchors = [...vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => NormalizeHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "soci contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinks = [...strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `soci documentation link must exist: ${strTarget}`);
	}
}

function ExtractNativeSOCIHelperSource(strSource, strSignature, strNextSignature) {
	const nStartOffset = strSource.indexOf(strSignature);
	g_Assert.ok(nStartOffset >= 0, `native SOCI helper exists: ${strSignature}`);

	const nEndOffset = strSource.indexOf(strNextSignature, nStartOffset + strSignature.length);
	g_Assert.ok(nEndOffset > nStartOffset, `native SOCI helper boundary exists: ${strNextSignature}`);

	return strSource.slice(nStartOffset, nEndOffset);
}

function VerifyNativeSOCIHelperContracts(strSource) {
	// These are narrow static regression guards, not native IO, V8 callback or thread-runtime tests.
	const strSessionLookupSource = ExtractNativeSOCIHelperSource(strSource, "\tstd::shared_ptr<SOCISessionRecord> RequireSOCISessionRecordFromCallbackInformation(", "\tstd::string FormatSOCITimeValue(");
	g_Assert.doesNotMatch(strSessionLookupSource, /std::(?:lock_guard|unique_lock|scoped_lock)|->m_Mutex|->m_pSession/, "game-thread SOCI session lookup must not wait on a worker lock or access its native session");

	const strParameterSource = ExtractNativeSOCIHelperSource(strSource, "\tbool SetSOCIParameterFromValue(", "\tbool ParseSOCIParametersFromValue(");
	g_Assert.match(strParameterSource, /LocalNumberSOCIParameterValue->IsInt32\(\)/, "integer Number binding is limited to int32");
	g_Assert.match(strParameterSource, /const int nIntegerSOCIParameterValue = static_cast<int>\(dblNumberSOCIParameterValue\);/, "int32 Number binding uses an int");
	g_Assert.doesNotMatch(strParameterSource, /k(?:SourceJSMaxSafeInteger|MaximumSafeNumberInteger)|static_cast<(?:long long|std::u?int64_t)>\(dblNumberSOCIParameterValue\)/, "Number parameters must not be inferred as 64-bit integers");
	g_Assert.match(strParameterSource, /LocalSOCIParameterValue->IsBigInt\(\)[\s\S]*?GetInt64Argument\(/, "signed 64-bit parameters retain lossless BigInt validation");

	const strParserSource = ExtractNativeSOCIHelperSource(strSource, "\tbool ParseSOCIParametersFromValue(", "\tbool IsNamedSOCIParameterReferenced(");
	g_Assert.match(strParserSource, /std::vector<SOCIBoundParameter>& vecSOCIParametersOut/, "parameter parsing publishes an owning snapshot");
	g_Assert.match(strParserSource, /vecSOCIParametersOut = std::move\(vecSOCIParameters\);/, "validated parameter snapshots are committed after parsing");
	g_Assert.doesNotMatch(strParserSource, /soci::values/, "game-thread parsing must not allocate unmanaged SOCI values");

	const strBindingSource = ExtractNativeSOCIHelperSource(strSource, "\tvoid ExchangeSOCIParameters(", "\tstruct SOCISessionRecord");
	g_Assert.match(strBindingSource, /SOCIStatement\.exchange\(soci::use\(Value, Parameter\.m_Indicator, Parameter\.m_strName\)\)/, "native statement owns named bindings");
	g_Assert.match(strBindingSource, /SOCIStatement\.exchange\(soci::use\(Value, Parameter\.m_Indicator\)\)/, "native statement owns positional bindings");
	g_Assert.match(strBindingSource, /!IsNamedSOCIParameterReferenced\(strSQLQuery, Parameter\.m_strName\)/, "unused named parameters retain the SOCI compatibility filter");

	const strExecuteSource = ExtractNativeSOCIHelperSource(strSource, "\tvoid ExecuteSOCICallback(", "\tvoid QuerySOCICallback(");
	const strQuerySource = ExtractNativeSOCIHelperSource(strSource, "\tvoid QuerySOCICallback(", "\tvoid GetSOCIBackendNameCallback(");
	for (const strOperationSource of [strExecuteSource, strQuerySource]) {
		g_Assert.match(strOperationSource, /std::vector<SOCIBoundParameter> vecSOCIParameters \{\}/, "SQL requests own their copied parameter data before scheduling");
		g_Assert.doesNotMatch(strOperationSource, /soci::values/, "SQL requests must not capture unmanaged SOCI values");
		g_Assert.match(strOperationSource, /ExchangeSOCIParameters\(SOCIStatement, vecSOCIParameters, strSQLQuery\)/, "SQL workers bind the owned parameter snapshot");
	}

	g_Assert.match(strExecuteSource, /SOCIStatement\.execute\(true\)/, "Execute must exchange bound data and actually execute parameterized statements");
}

function RequestSOCI(strMethodName, vecArguments, Options = {}) {
	return new Promise((Resolve, Reject) => {
		g_SOCI[strMethodName](...vecArguments, Options, (RequestError, Result) => {
			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		});
	});
}

async function VerifyDocumentedSOCIWorkflowFailures() {
	// Synthetic completion faults exercise the reviewed examples, not native IO or worker scheduling.
	const vecFailures = [
		new Error("SOCI operation failed"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("SOCI operation failed"),
	];
	const vecCases = [
		{ BlockIndex: 1, Name: "StoreSQLitePlayer", Arguments: ["dbname=memory/fault.sqlite3", "Player", 1], Steps: ["Connect", "Execute", "Execute", "LastInsertId", "Query", "IsConnected", "GetBackendName"] },
		{ BlockIndex: 2, Name: "TransferScore", Arguments: [11, 1n, 2n, 1], Steps: ["Begin", "Execute", "Execute", "Commit"] },
		{ BlockIndex: 3, Name: "EnsureSessionConnection", Arguments: [11], Steps: ["IsConnected", "Reconnect", "IsConnected"] },
		{ BlockIndex: 4, Name: "ReserveSequenceValue", Arguments: [11, "PlayerSequence"], Steps: ["GetNextSequenceValue", "GetBackendName"] },
		{ BlockIndex: 5, Name: "InsertMariaDBAudit", Arguments: ["db=sourcejs", "PlayerJoined", { PlayerName: "Player" }], Steps: ["Connect", "Execute", "Execute", "LastInsertId", "Query", "GetBackendName"] },
	];
	let unScenarioCount = 0;

	function CreateFaultAPI(TestCase, unFailureStep, OperationError, bThrowOperation, CleanupFailure = null) {
		const vecCalls = [];
		let unOperationCount = 0;
		let unConnectionCheckCount = 0;
		const API = {};

		for (const strMethodName of g_vecExpectedExports) {
			API[strMethodName] = (...vecArguments) => {
				vecCalls.push(strMethodName);
				const Options = vecArguments.at(-2);
				const Callback = vecArguments.at(-1);
				g_Assert.equal(Options.Blocking, undefined, "reviewed Promise workflows use default nonblocking options");
				g_Assert.equal(typeof Callback, "function", "reviewed Promise workflows supply a callback");

				const bCleanup = (strMethodName === "Close") || (strMethodName === "Rollback");
				if (bCleanup && (CleanupFailure !== null)) {
					if (CleanupFailure.ReturnFalse) {
						Callback(null, false);
						return;
					}

					if (CleanupFailure.Throw) {
						throw CleanupFailure.Error;
					}

					Callback(CleanupFailure.Error, undefined);
					return;
				}

				if (!bCleanup) {
					unOperationCount++;
					g_Assert.equal(strMethodName, TestCase.Steps[unOperationCount - 1], "reviewed workflow operation order");

					if (unOperationCount === unFailureStep) {
						if (bThrowOperation) {
							throw OperationError;
						}

						Callback(OperationError, undefined);
						return;
					}
				}

				let Result = true;
				if (strMethodName === "Connect") {
					Result = 11;

				} else if (["Execute", "LastInsertId", "GetNextSequenceValue"].includes(strMethodName)) {
					Result = 1n;

				} else if (strMethodName === "Query") {
					Result = [];

				} else if (strMethodName === "GetBackendName") {
					Result = "sqlite3";

				} else if (strMethodName === "IsConnected") {
					unConnectionCheckCount++;
					Result = (TestCase.Name !== "EnsureSessionConnection") || (unConnectionCheckCount > 1);
				}

				Callback(null, Result);
			};
		}

		return { API, Calls: vecCalls };
	}

	async function CaptureFailure(TestCase, Fixture) {
		const Workflows = ExecuteCodeBlock(g_vecCodeBlocks[TestCase.BlockIndex], TestCase.BlockIndex + 1, Fixture.API);

		try {
			await Workflows[TestCase.Name](...TestCase.Arguments);
		} catch (CaughtError) {
			return { Failed: true, Error: CaughtError };
		}

		return { Failed: false, Error: null };
	}

	for (const TestCase of vecCases) {
		for (let unFailureStep = 1; unFailureStep <= TestCase.Steps.length; unFailureStep++) {
			for (const bThrowOperation of [false, true]) {
				for (const OperationError of vecFailures) {
					if (!bThrowOperation && (OperationError === null)) {
						continue;
					}

					const Fixture = CreateFaultAPI(TestCase, unFailureStep, OperationError, bThrowOperation);
					const Failure = await CaptureFailure(TestCase, Fixture);
					g_Assert.equal(Failure.Failed, true, "operation failure is never reported as success");
					g_Assert.equal(Failure.Error, OperationError, "operation failure identity is preserved");
					const vecExpectedCalls = TestCase.Steps.slice(0, unFailureStep);
					if (["StoreSQLitePlayer", "InsertMariaDBAudit"].includes(TestCase.Name) && (unFailureStep > 1)) {
						vecExpectedCalls.push("Close");

					} else if ((TestCase.Name === "TransferScore") && (unFailureStep > 1)) {
						vecExpectedCalls.push("Rollback");
					}

					g_Assert.deepEqual(Fixture.Calls, vecExpectedCalls, "failure stops work and performs only required cleanup");
					unScenarioCount++;
				}
			}
		}
	}

	const vecCleanupCases = [{ ReturnFalse: true }];
	for (const bThrowCleanup of [false, true]) {
		for (const CleanupError of vecFailures) {
			if (!bThrowCleanup && (CleanupError === null)) {
				continue;
			}

			vecCleanupCases.push({ Error: CleanupError, Throw: bThrowCleanup });
		}
	}

	const vecOperationStates = [{ Failed: false, Error: null }, ...vecFailures.map((OperationError) => ({ Failed: true, Error: OperationError }))];
	for (const OperationState of vecOperationStates) {
		const OperationError = OperationState.Error;
		const bOperationFailed = OperationState.Failed;
		for (const TestCase of [vecCases[0], vecCases[4]]) {
			for (const CleanupFailure of vecCleanupCases) {
				const Fixture = CreateFaultAPI(TestCase, bOperationFailed ? 4 : 0, OperationError, true, CleanupFailure);
				const Failure = await CaptureFailure(TestCase, Fixture);
				g_Assert.equal(Failure.Failed, true, "unconfirmed close cannot return success");
				g_Assert.equal(Failure.Error.name, "AggregateError", "close failure preserves diagnostic ownership");
				g_Assert.equal(Failure.Error.SessionHandle, 11, "unconfirmed close retains the handle for owner recovery");
				const vecErrors = Array.from(Failure.Error.errors);
				g_Assert.equal(vecErrors.length, bOperationFailed ? 2 : 1, "close failure retains all errors");

				if (bOperationFailed) {
					g_Assert.equal(vecErrors[0], OperationError, "close failure retains the original operation error");
					g_Assert.equal(Failure.Error.cause, OperationError, "close failure retains the exact original cause");
				}

				if (CleanupFailure.ReturnFalse) {
					g_Assert.match(vecErrors.at(-1).message, /did not confirm/, "false close has an explicit diagnostic");

				} else {
					g_Assert.equal(vecErrors.at(-1), CleanupFailure.Error, "close error remains exact");

					if (!bOperationFailed) {
						g_Assert.equal(Failure.Error.cause, CleanupFailure.Error, "cleanup-only error retains its exact cause");
					}
				}

				g_Assert.equal(Fixture.Calls.filter((strName) => strName === "Close").length, 1, "close attempted exactly once");
				unScenarioCount++;
			}
		}
	}

	for (const OperationError of vecFailures) {
		for (const CleanupFailure of vecCleanupCases.filter((Failure) => !Failure.ReturnFalse)) {
			const Fixture = CreateFaultAPI(vecCases[1], 2, OperationError, true, CleanupFailure);
			const Failure = await CaptureFailure(vecCases[1], Fixture);
			g_Assert.equal(Failure.Failed, true, "failed rollback cannot return success");
			g_Assert.equal(Failure.Error.name, "AggregateError", "rollback failure is safe for non-Error throws");
			g_Assert.deepEqual(Array.from(Failure.Error.errors), [OperationError, CleanupFailure.Error], "rollback preserves both failures without mutating either");
			g_Assert.equal(Failure.Error.cause, OperationError, "rollback retains the original cause");
			g_Assert.deepEqual(Fixture.Calls, ["Begin", "Execute", "Rollback"], "failed rollback stops the transaction");
			unScenarioCount++;
		}
	}

	const MariaDBCase = vecCases[4];
	for (const EventName of [
		null,
		undefined,
		1,
		{},
		Symbol("Invalid event"),
		"",
		"A".repeat(129),
	]) {
		const TestCase = { ...MariaDBCase, Arguments: ["db=sourcejs", EventName, {}] };
		const Fixture = CreateFaultAPI(TestCase, 0, null, false);
		const Failure = await CaptureFailure(TestCase, Fixture);
		g_Assert.equal(Failure.Failed, true, "invalid audit event fails before Connect");
		g_Assert.equal(Failure.Error.name, "TypeError", "invalid audit event diagnostic");
		g_Assert.deepEqual(Fixture.Calls, [], "invalid audit event never opens a session");
		unScenarioCount++;
	}

	const CircularPayload = {};
	CircularPayload.Self = CircularPayload;
	for (const Payload of [
		undefined,
		() => {
		},
		Symbol("Invalid payload"),
		1n,
		{ Value: 1n },
		CircularPayload,
	]) {
		const TestCase = { ...MariaDBCase, Arguments: ["db=sourcejs", "PlayerJoined", Payload] };
		const Fixture = CreateFaultAPI(TestCase, 0, null, false);
		const Failure = await CaptureFailure(TestCase, Fixture);
		g_Assert.equal(Failure.Failed, true, "unserializable audit payload fails before Connect");
		g_Assert.equal(Failure.Error.name, "TypeError", "unserializable audit payload diagnostic");
		g_Assert.deepEqual(Fixture.Calls, [], "unserializable audit payload never opens a session");
		unScenarioCount++;
	}

	for (const PayloadError of vecFailures) {
		const Payload = {
			toJSON() {
				throw PayloadError;
			},
		};
		const TestCase = { ...MariaDBCase, Arguments: ["db=sourcejs", "PlayerJoined", Payload] };
		const Fixture = CreateFaultAPI(TestCase, 0, null, false);
		const Failure = await CaptureFailure(TestCase, Fixture);
		g_Assert.equal(Failure.Failed, true, "audit serialization failure never reports success");
		g_Assert.equal(Failure.Error, PayloadError, "audit serialization preserves the exact thrown value");
		g_Assert.deepEqual(Fixture.Calls, [], "throwing audit serialization never opens a session");
		unScenarioCount++;
	}

	g_Assert.equal(unScenarioCount, 621, "every reviewed workflow step, preflight and cleanup failure is covered");
}

async function VerifySOCIRequestContracts() {
	const unLargeIdentifier = (1n << 62n) + 1n;
	const strInsertSQL = "INSERT INTO SourceJSPlayers (Name, Score) VALUES (:Name, :Score)";
	const strQuerySQL = "SELECT ID, Name, Score FROM SourceJSPlayers WHERE ID = :ID";
	const strSequenceName = "SourceJSPlayersIDSequence";

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.throws(() => g_SOCI[strExportName]({}, null), /requires a callback/, `${strExportName} requires Callback`);
		g_Assert.throws(() => g_SOCI[strExportName](null, () => {
		}), /requires an options object/, `${strExportName} requires Options`);
		g_Assert.throws(() => g_SOCI[strExportName]({ Blocking: "true" }, () => {
		}), /boolean Blocking/, `${strExportName} requires boolean Blocking`);
	}

	const hSessionHandle = CallSOCI("Connect", "dbname=memory/contracts.sqlite3", "sqlite3");

	try {
		let bCallbackCalled = false;
		const PendingConnection = new Promise((Resolve, Reject) => {
			g_SOCI.IsConnected(hSessionHandle, {}, (RequestError, bConnected) => {
				bCallbackCalled = true;

				if (RequestError !== null) {
					Reject(RequestError);
					return;
				}

				Resolve(bConnected);
			});
		});
		g_Assert.equal(bCallbackCalled, false, "default SOCI callback is deferred");
		g_Assert.equal(await PendingConnection, true, "default SOCI request completes");
		g_Assert.equal(bCallbackCalled, true, "default SOCI callback completes");

		bCallbackCalled = false;
		g_SOCI.IsConnected(hSessionHandle, { Blocking: true }, (RequestError, bConnected) => {
			g_Assert.equal(RequestError, null, "Blocking SOCI callback error");
			g_Assert.equal(bConnected, true, "Blocking SOCI result");
			bCallbackCalled = true;
		});
		g_Assert.equal(bCallbackCalled, true, "Blocking SOCI callback runs before return");

		const Parameters = { Name: "Original", Score: 25 };
		const PendingInsert = RequestSOCI("Execute", [hSessionHandle, strInsertSQL, Parameters]);
		Parameters.Name = "Changed";
		Parameters.Score = 99;
		g_Assert.equal(await PendingInsert, 1n, "small affected-row count remains BigInt");
		g_Assert.equal(await RequestSOCI("LastInsertId", [hSessionHandle, "SourceJSPlayers"]), 1n, "small generated ID remains BigInt");
		g_Assert.deepEqual(await RequestSOCI("Query", [hSessionHandle, strQuerySQL, { ID: 1n }]), [{ ID: 1n, Name: "Original", Score: 25 }], "queued named parameters are copied");

		// Set only the fixture's ID/sequence source; native backend widths require separate runtime tests.
		const Session = RequireSession(hSessionHandle);
		Session.LastInsertID = unLargeIdentifier - 1n;
		Session.Sequences.set(strSequenceName, unLargeIdentifier);
		g_Assert.equal(await RequestSOCI("Execute", [hSessionHandle, strInsertSQL, { Name: "LargeID", Score: 42 }]), 1n, "large-ID insertion completes");
		g_Assert.equal(await RequestSOCI("LastInsertId", [hSessionHandle, "SourceJSPlayers"], { Blocking: true }), unLargeIdentifier, "large generated ID is exact in Blocking mode");
		g_Assert.deepEqual(await RequestSOCI("Query", [hSessionHandle, strQuerySQL, { ID: unLargeIdentifier }]), [{ ID: unLargeIdentifier, Name: "LargeID", Score: 42 }], "query lookup never narrows a BigInt ID");
		g_Assert.equal(await RequestSOCI("GetNextSequenceValue", [hSessionHandle, strSequenceName]), unLargeIdentifier, "large sequence value remains exact");
		g_Assert.equal(await RequestSOCI("GetNextSequenceValue", [hSessionHandle, strSequenceName], { Blocking: true }), unLargeIdentifier + 1n, "sequence advances without precision loss");

		for (const bBlocking of [false, true]) {
			let unCallbackCount = 0;
			let OperationError = null;
			let Result = "NOT_CALLED";
			const PendingFailure = new Promise((Resolve) => {
				g_SOCI.Execute(hSessionHandle, "UnsupportedSQL", { Blocking: bBlocking }, (RequestError, RequestResult) => {
					unCallbackCount += 1;
					OperationError = RequestError;
					Result = RequestResult;
					Resolve();
				});
			});
			g_Assert.equal(unCallbackCount, bBlocking ? 1 : 0, "SOCI failure obeys request delivery mode");

			await PendingFailure;

			g_Assert.ok(OperationError instanceof Error, "SOCI operation failure reaches Callback");
			g_Assert.match(OperationError.message, /Unexpected SOCI statement/);
			g_Assert.equal(Result, undefined, "failed SOCI request publishes no result");
			g_Assert.equal(unCallbackCount, 1, "SOCI error Callback runs exactly once");
		}
	} finally {
		g_Assert.equal(CallSOCI("Close", hSessionHandle), true, "request fixture closes its session");
	}

	g_Assert.equal(g_mapSessions.size, 0, "request fixture leaves no sessions");
}

async function VerifyDocumentedSOCIWorkflows() {
	await VerifyDocumentedSOCIWorkflowFailures();

	const Workflows = {};
	const unCallCountBeforeDocumentation = g_vecSOCICalls.length;
	const unSessionCountBeforeDocumentation = g_mapSessions.size;

	for (const [unBlockOffset, strCode] of g_vecCodeBlocks.entries()) {
		Object.assign(Workflows, ExecuteCodeBlock(strCode, unBlockOffset + 1));
	}

	g_Assert.equal(g_vecSOCICalls.length, unCallCountBeforeDocumentation, "soci code blocks must not call native APIs while loading");
	g_Assert.equal(g_mapSessions.size, unSessionCountBeforeDocumentation, "soci code blocks must not open sessions while loading");
	g_Assert.deepEqual(Object.keys(Workflows).sort(), [
		"EnsureSessionConnection",
		"InsertMariaDBAudit",
		"ReserveSequenceValue",
		"StoreSQLitePlayer",
		"TransferScore",
	], "soci documented workflows");

	g_Assert.deepEqual(CloneForAssertion(await Workflows.StoreSQLitePlayer("dbname=memory/soci.sqlite3", "Ren", 25)), {
		AffectedRowCount: 1n,
		BackendName: "sqlite3",
		Connected: true,
		InsertID: 1n,
		Rows: [{ ID: 1n, Name: "Ren", Score: 25 }],
	}, "documented SQLite workflow");

	const hTransactionSession = CallSOCI("Connect", "dbname=memory/transaction.sqlite3", "sqlite3");

	try {
		const unCallCountBeforeInvalidIdentifiers = g_vecSOCICalls.length;
		for (const Value of [
			1,
			0n,
			-1n,
			1n << 63n,
			"1",
			null,
			undefined,
		]) {
			await g_Assert.rejects(Workflows.TransferScore(hTransactionSession, Value, 2n, 1), /positive signed 64-bit BigInts/, "invalid source ID is rejected before Begin");
			await g_Assert.rejects(Workflows.TransferScore(hTransactionSession, 1n, Value, 1), /positive signed 64-bit BigInts/, "invalid destination ID is rejected before Begin");
		}

		g_Assert.equal(g_vecSOCICalls.length, unCallCountBeforeInvalidIdentifiers, "invalid IDs never start a transaction");

		g_Assert.equal(CallSOCI("Execute", hTransactionSession, "INSERT INTO SourceJSPlayers (Name, Score) VALUES (:Name, :Score)", { Name: "Source", Score: 50 }), 1n, "transaction fixture inserts one source player");
		g_Assert.equal(CallSOCI("Execute", hTransactionSession, "INSERT INTO SourceJSPlayers (Name, Score) VALUES (:Name, :Score)", { Name: "Destination", Score: 10 }), 1n, "transaction fixture inserts one destination player");

		g_Assert.deepEqual(CloneForAssertion(await Workflows.TransferScore(hTransactionSession, 1n, 2n, 15)), { AddedRowCount: 1n, Committed: true, RemovedRowCount: 1n }, "documented transaction commit");

		const Session = RequireSession(hTransactionSession);
		g_Assert.equal(Session.Players.get(1n).Score, 35, "transaction debits source");
		g_Assert.equal(Session.Players.get(2n).Score, 25, "transaction credits destination");

		await g_Assert.rejects(Workflows.TransferScore(hTransactionSession, 1n, 99n, 5), /did not update both players/, "documented transaction failure");

		g_Assert.equal(Session.Players.get(1n).Score, 35, "Rollback restores source score");
		g_Assert.equal(Session.Players.get(2n).Score, 25, "Rollback preserves destination score");
	} finally {
		g_Assert.equal(CallSOCI("Close", hTransactionSession), true, "transaction session cleanup");
	}

	const hReconnectSession = CallSOCI("Connect", "dbname=memory/reconnect.sqlite3", "sqlite3");

	try {
		RequireSession(hReconnectSession).Connected = false;

		g_Assert.equal(await Workflows.EnsureSessionConnection(hReconnectSession), true, "documented Reconnect");
		g_Assert.equal(await Workflows.EnsureSessionConnection(hReconnectSession), false, "documented connected fast path");
	} finally {
		g_Assert.equal(CallSOCI("Close", hReconnectSession), true, "Reconnect session cleanup");
	}

	const hSequenceSession = CallSOCI("Connect", "db=sequence-test", "sequence-test");

	try {
		g_Assert.deepEqual(CloneForAssertion(await Workflows.ReserveSequenceValue(hSequenceSession, "SourceJSPlayersIDSequence")), { BackendName: "sequence-test", SequenceValue: g_nInitialSequenceValue }, "documented sequence workflow");
	} finally {
		g_Assert.equal(CallSOCI("Close", hSequenceSession), true, "sequence session cleanup");
	}

	g_Assert.deepEqual(CloneForAssertion(await Workflows.InsertMariaDBAudit("db=sourcejs user=test", "PluginLoaded", { Plugin: "hello" })), {
		AffectedRowCount: 1n,
		BackendName: "mysql",
		InsertID: 1n,
		Rows: [{ EventName: "PluginLoaded", ID: 1n, PayloadJSON: "{\"Plugin\":\"hello\"}" }],
	}, "documented MariaDB workflow");

	const unCallCountBeforeInvalidPayload = g_vecSOCICalls.length;

	await g_Assert.rejects(Workflows.InsertMariaDBAudit("db=sourcejs user=test", "PluginLoaded", undefined), /JSON representation/, "documented JSON validation");

	g_Assert.equal(g_vecSOCICalls.length, unCallCountBeforeInvalidPayload, "invalid payload does not open a session");
	g_Assert.equal(g_mapSessions.size, 0, "documentation closes every soci session");

	const setExercisedExports = new Set(g_vecSOCICalls.map(([strOperation]) => strOperation));
	g_Assert.deepEqual([...setExercisedExports].sort(), g_vecExpectedExports, "documentation exercises every soci export");

	await VerifySOCIRequestContracts();
}

const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
VerifyNativeSOCIHelperContracts(g_strModuleBindings);

const g_strNumberLimitedSOCIParametersSource = g_strModuleBindings.replace("const int nIntegerSOCIParameterValue = static_cast<int>(dblNumberSOCIParameterValue);", "const int nIntegerSOCIParameterValue = static_cast<int>(dblNumberSOCIParameterValue);\n\t\tif (dblNumberSOCIParameterValue > kMaximumSafeNumberInteger) {\n\t\t\treturn false;\n\t\t}");
g_Assert.notEqual(g_strNumberLimitedSOCIParametersSource, g_strModuleBindings, "The source mutation must add a Number limit to SOCI parameter conversion.");
g_Assert.throws(() => VerifyNativeSOCIHelperContracts(g_strNumberLimitedSOCIParametersSource), { name: "AssertionError" }, "SOCI int64 conversion must reject Number-precision limits under their current name");

const g_vecRegistrationMatch = g_strModuleBindings.match(/v8::Local<v8::Object> const LocalSOCIModule = MakeModule[\s\S]*?InstallModule\(pIsolate, LocalContext, LocalSourceJS, "soci", LocalSOCIModule\)/);
g_Assert.ok(g_vecRegistrationMatch, "native soci registration block");

const g_vecRegisteredExports = [...g_vecRegistrationMatch[0].matchAll(/SetFunction\([^\r\n]+LocalSOCIModule, "([^"]+)"/g)].map((vecMatch) => vecMatch[1]).sort();
g_Assert.deepEqual(g_vecRegisteredExports, g_vecExpectedExports, "exact native soci exports");
g_Assert.match(g_strModuleBindings, /soci::register_factory_sqlite3\(\);/, "SQLite3 backend registration");
g_Assert.match(g_strModuleBindings, /soci::register_factory_mysql\(\);/, "MySQL backend registration");
g_Assert.match(g_strModuleBindings, /m_strPluginName != strPluginName/, "SOCI handles are plugin-owned");
g_Assert.match(g_strModuleBindings, /itSOCISession->second && \(itSOCISession->second->m_strPluginName == strPluginName\)/, "SOCI handles are released on plugin unload");
g_Assert.deepEqual(Object.keys(g_SOCI).sort(), g_vecExpectedExports, "exact soci smoke exports");

const g_strMarkdown = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [...g_strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
g_Assert.equal(g_vecCodeBlocks.length, g_unExpectedCodeBlockCount, "soci JavaScript block count");

const g_vecImportMatch = g_vecCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("soci"\);/);
g_Assert.ok(g_vecImportMatch, "soci exact import example");

const g_vecDocumentedExports = g_vecImportMatch[1].split(",").map((strName) => strName.trim()).filter(Boolean).sort();
g_Assert.deepEqual(g_vecDocumentedExports, g_vecExpectedExports, "exact documented soci exports");
g_Assert.doesNotMatch(g_strMarkdown, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("soci"\)/, "soci documentation must remain hand-written and use direct imports");
g_Assert.doesNotMatch(g_strMarkdown, /[^\x00-\x7F]/, "soci documentation ASCII");
g_Assert.doesNotMatch(g_strMarkdown, /[ \t]+$/m, "soci documentation trailing whitespace");

for (const strCode of g_vecCodeBlocks) {
	g_Assert.doesNotMatch(strCode, /^ +\S/m, "soci JavaScript fence indentation must use tabs");
}

VerifyContentsAnchors(g_strMarkdown);
VerifyDocumentationLinks(g_strMarkdown);

const g_unCompletionTimeoutMilliseconds = 5000;
let g_CompletionTimeoutTimer = null;

async function CompleteSOCIWorkflowChecks() {
	try {
		const CompletionDeadline = new Promise((Resolve, Reject) => {
			g_CompletionTimeoutTimer = setTimeout(() => Reject(new Error("callback completion deadline exceeded.")), g_unCompletionTimeoutMilliseconds);
		});
		await Promise.race([VerifyDocumentedSOCIWorkflows(), CompletionDeadline]);
	} finally {
		clearTimeout(g_CompletionTimeoutTimer);
	}
}

CompleteSOCIWorkflowChecks().then(() => {
	console.log("SOCI smoke passed: exact exports, all documentation workflows, callback controls, snapshots and BigInt results (Node double).");
}, (RequestError) => {
	process.exitCode = 1;
	console.error("SOCI smoke failed:", RequestError);
});
