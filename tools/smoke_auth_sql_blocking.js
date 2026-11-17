"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");
const { Backend } = require("../packages/sourcejs/auth/index");

const g_strSQLPath = g_Path.resolve(__dirname, "../packages/sourcejs/auth/backends/sql.js");
const g_strSQLSource = g_FileSystem.readFileSync(g_strSQLPath, "utf8");

// Actual SQLBackend with a deterministic native-request double; native worker/wait tests are separate.
function CreateHarness(BackendOptions = {}, Profile = {}) {
	const mapPendingRequests = new Map();
	const setConnections = new Set();
	const vecWaitedOperations = [];
	const vecCallbackExceptions = [];
	const vecRequestOptions = [];
	const vecOperations = [];
	let bTransactionActive = false;
	let unNextConnection = 1;
	let unExecuteCount = 0;
	let strFailureOperation = "";
	const RequestError = new Error("Controlled SOCI failure.");

	const Dispatch = (strOperation, Options, Callback, Operation) => {
		vecOperations.push(strOperation);

		if (Object.hasOwn(Profile.SynchronousFailures ?? {}, strOperation)) {
			throw Profile.SynchronousFailures[strOperation];
		}

		if (strOperation !== "Unrelated") {
			vecRequestOptions.push(Options);
		}

		const Complete = () => {
			mapPendingRequests.delete(Callback);
			let Result;
			let ErrorValue = null;
			try {
				if (strOperation === strFailureOperation) {
					throw RequestError;
				}

				Result = Operation();
			} catch (Exception) {
				ErrorValue = Exception;
			}

			try {
				Callback(ErrorValue, Result);
			} catch (Exception) {
				vecCallbackExceptions.push(Exception);
			}
		};

		if (Options.Blocking === true) {
			Complete();
			return;
		}

		mapPendingRequests.set(Callback, { Complete, Operation: strOperation });
	};

	const SQLRuntime = {
		WaitForRequest(Callback) {
			const Request = mapPendingRequests.get(Callback);
			if (Request === undefined) {
				return false;
			}

			vecWaitedOperations.push(Request.Operation);
			Request.Complete();

			return true;
		},
	};

	const SOCI = {
		Connect(strConnectionString, ...vecArguments) {
			const Callback = vecArguments.pop();
			const Options = vecArguments.pop();
			const strBackendName = vecArguments[0];
			g_Assert.equal(typeof strConnectionString, "string");
			g_Assert.ok((strBackendName === undefined) || (typeof strBackendName === "string"));
			Dispatch("Connect", Options, Callback, () => {
				const hConnection = unNextConnection++;
				setConnections.add(hConnection);

				return hConnection;
			});
		},
		Execute(hConnection, strStatement, Parameters, Options, Callback) {
			g_Assert.ok(setConnections.has(hConnection));

			if (Profile.AllowMutationStatements !== true) {
				g_Assert.ok(strStatement.startsWith("CREATE TABLE IF NOT EXISTS "));
				g_Assert.equal(Object.keys(Parameters).length, 0);
			}

			if (Profile.BeforeExecute !== undefined) {
				Profile.BeforeExecute(hConnection, strStatement, Parameters);
			}

			Dispatch(`Execute${++unExecuteCount}`, Options, Callback, () => true);
		},
		IsConnected(hConnection, Options, Callback) {
			Dispatch("IsConnected", Options, Callback, () => setConnections.has(hConnection));
		},
		Reconnect(hConnection, Options, Callback) {
			Dispatch("Reconnect", Options, Callback, () => {
				setConnections.add(hConnection);

				return true;
			});
		},
		Close(hConnection, Options, Callback) {
			Dispatch("Close", Options, Callback, () => setConnections.delete(hConnection));
		},
		Begin(hConnection, Options, Callback) {
			g_Assert.ok(setConnections.has(hConnection));
			Dispatch("Begin", Options, Callback, () => {
				g_Assert.equal(bTransactionActive, false);
				bTransactionActive = true;

				return true;
			});
		},
		Commit(hConnection, Options, Callback) {
			Dispatch("Commit", Options, Callback, () => {
				g_Assert.equal(bTransactionActive, true);
				bTransactionActive = false;

				return true;
			});
		},
		Rollback(hConnection, Options, Callback) {
			Dispatch("Rollback", Options, Callback, () => {
				g_Assert.equal(bTransactionActive, true);
				bTransactionActive = false;

				return true;
			});
		},
		Query(hConnection, strStatement, Parameters, Options, Callback) {
			g_Assert.ok(setConnections.has(hConnection));
			g_Assert.equal(typeof strStatement, "string");
			g_Assert.ok((Parameters !== null) && (typeof Parameters === "object") && !Array.isArray(Parameters));
			Dispatch("Query", Options, Callback, () => (typeof Profile.QueryRows === "function") ? Profile.QueryRows(strStatement, Parameters) : (Profile.QueryRows ?? []));
		},
	};

	const Module = { exports: {} };
	const Context = g_VM.createContext({
		module: Module,
		require(strName) {
			switch (strName) {
				case "auth/index":
					return { Backend };

				case "filesystem":
					return Profile.Filesystem ?? {};

				case "internal/runtime":
					return { GetModule: (strModule) => (strModule === "auth/backends/sql") ? SQLRuntime : {} };

				case "paths":
					return Profile.Paths ?? {};

				case "soci":
					return SOCI;

				default:
					throw new Error(`Unexpected dependency: ${strName}`);
			}
		},
	});
	g_VM.runInContext(g_strSQLSource, Context, { filename: g_strSQLPath });

	const Instance = new Module.exports.SQLBackend({ BackendName: "sqlite3", ConnectionString: "dbname=controlled", ...BackendOptions });

	return {
		Dispatch,
		Instance,
		Pending: mapPendingRequests,
		RequestError,
		SetFailure: (strOperation) => {
			strFailureOperation = strOperation;
		},
		Connections: setConnections,
		CallbackExceptions: vecCallbackExceptions,
		RequestOptions: vecRequestOptions,
		WaitedOperations: vecWaitedOperations,
		Operations: vecOperations,
		get TransactionActive() {
			return bTransactionActive;
		},
	};
}

function VerifyJoinedOpen(strFailureOperation, unCompletedStages) {
	const Harness = CreateHarness();
	const { Instance } = Harness;
	const Options = {};
	const vecDelivered = [];
	const FirstCallbackException = new Error("First open callback failed.");
	Harness.SetFailure(strFailureOperation);
	Instance.Open(Options, (ErrorValue, hConnection) => {
		g_Assert.equal(ErrorValue, strFailureOperation ? Harness.RequestError : null);
		g_Assert.equal(hConnection, strFailureOperation ? null : Instance.m_hConnection);
		vecDelivered.push("First");
		throw FirstCallbackException;
	});

	for (let unStage = 0; unStage < unCompletedStages; ++unStage) {
		Harness.Pending.values().next().value.Complete();
	}

	Instance.Open({}, () => vecDelivered.push("Second"));

	let bUnrelatedCompleted = false;
	Harness.Dispatch("Unrelated", {}, () => {
		bUnrelatedCompleted = true;
	}, () => true);

	Instance.Open({ Blocking: true }, (ErrorValue) => {
		g_Assert.equal(ErrorValue, strFailureOperation ? Harness.RequestError : null);
		vecDelivered.push("Blocking");
	});
	g_Assert.deepEqual(vecDelivered, ["First", "Second", "Blocking"], "joining Blocking Open must deliver callbacks before returning");
	g_Assert.equal(bUnrelatedCompleted, false, "joining Open must not drain unrelated requests");
	g_Assert.equal(Harness.Pending.size, 1, "only unrelated request remains");
	g_Assert.equal(Instance.m_bOpening, false);
	g_Assert.equal(Instance.m_vecOpenCallbacks.length, 0);
	g_Assert.deepEqual(Harness.CallbackExceptions, [FirstCallbackException]);
	g_Assert.ok(Harness.RequestOptions.every((RequestOptions) => RequestOptions === Options), "original options identity is preserved");
	Harness.Pending.values().next().value.Complete();
}

function VerifyExistingConnection(bConnected, strFailureOperation) {
	const Harness = CreateHarness();
	const { Instance } = Harness;
	let unCallbackCount = 0;
	Instance.Open({ Blocking: true }, () => ++unCallbackCount);
	g_Assert.equal(unCallbackCount, 1, "initial Blocking Open completes inline");

	if (!bConnected) {
		Harness.Connections.delete(Instance.m_hConnection);
	}

	Harness.SetFailure(strFailureOperation);
	const CompleteOpen = (ErrorValue) => {
		g_Assert.equal(ErrorValue, strFailureOperation ? Harness.RequestError : null);
		++unCallbackCount;
	};
	Instance.Open({}, CompleteOpen);
	Instance.Open({ Blocking: true }, CompleteOpen);
	g_Assert.equal(unCallbackCount, 3, "joined connection check/reconnect completes inline");
	g_Assert.deepEqual(Harness.WaitedOperations, (bConnected || (strFailureOperation === "IsConnected")) ? ["IsConnected"] : ["IsConnected", "Reconnect"]);
	g_Assert.equal(Harness.Pending.size, 0);
}

function VerifyReentrantOpen() {
	const Harness = CreateHarness({ BackendName: null });
	const { Instance } = Harness;
	const vecDelivered = [];
	Instance.Open({}, (ErrorValue) => {
		g_Assert.equal(ErrorValue, null);
		vecDelivered.push("First");
		Instance.Open({}, (ReentrantError) => {
			g_Assert.equal(ReentrantError, null);
			vecDelivered.push("Reentrant");
		});
	});

	for (const Blocking of [null, 0, 1, "true", {}, []]) {
		g_Assert.throws(() => Instance.Open({ Blocking }, () => vecDelivered.push("Invalid")), { name: "TypeError" });
	}

	g_Assert.equal(Instance.m_vecOpenCallbacks.length, 1, "invalid Blocking options do not register waiters");
	Instance.Open({ Blocking: true }, () => vecDelivered.push("Blocking"));
	g_Assert.deepEqual(vecDelivered, ["First", "Blocking"], "joining wait follows its captured opening, not a reentrant new opening");
	g_Assert.equal(Harness.Pending.size, 1, "reentrant open remains asynchronous");
	Harness.Pending.values().next().value.Complete();
	g_Assert.deepEqual(vecDelivered, ["First", "Blocking", "Reentrant"]);
	g_Assert.equal(Instance.m_bOpening, false);
	g_Assert.equal(Harness.Pending.size, 0);
}

function VerifyLifecycleAndTransactions() {
	const OpaqueFailure = {
		toString() {
			throw new Error("SQL failures must not be coerced.");
		},
	};
	const vecFailures = [undefined, null, false, 0, -0, 0n, "", NaN, OpaqueFailure, new Error("controlled failure")];
	let unScenarioCount = 0;

	function Drain(Harness) {
		const unMaximumRequests = 64;
		let unCompletedRequests = 0;
		while (Harness.Pending.size > 0) {
			g_Assert.ok(unCompletedRequests++ < unMaximumRequests);
			Harness.Pending.values().next().value.Complete();
		}
	}

	function CheckFailure(ErrorValue, Original) {
		if (Original) {
			g_Assert.equal(ErrorValue, Original);
			return;
		}

		g_Assert.equal(ErrorValue.name, "AggregateError");
		g_Assert.equal(ErrorValue.errors.length, 1);
		g_Assert.ok(Object.is(ErrorValue.errors[0], Original));
	}

	for (const bBlocking of [false, true]) {
		for (const strOpenFailure of ["", "Connect", "Execute2"]) {
			const Harness = CreateHarness();
			Harness.SetFailure(strOpenFailure);
			const vecCompletions = [];
			Harness.Instance.Open({}, (OpenError) => {
				g_Assert.equal(OpenError, (strOpenFailure === "") ? null : Harness.RequestError);
			});
			Harness.Instance.Unload({ Blocking: bBlocking }, (UnloadError, bResult) => {
				g_Assert.equal(UnloadError, null);
				g_Assert.equal(bResult, true);
				g_Assert.equal(Harness.Connections.size, 0, "Unload completion cannot precede a late connection leak");
				vecCompletions.push(bResult);
			});
			if (!bBlocking) {
				g_Assert.equal(vecCompletions.length, 0, "an async unload must await the tracked opening");
			}

			Drain(Harness);
			g_Assert.deepEqual(vecCompletions, [true]);
			g_Assert.equal(Harness.Instance.m_hConnection, null);
			g_Assert.equal(Harness.Instance.m_bSchemaReady, false);
			g_Assert.equal(Harness.Instance.Loaded, false);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}

		for (const Failure of vecFailures) {
			const Harness = CreateHarness();
			const vecCompletions = [];
			Harness.Instance.RunTransaction({ Blocking: bBlocking }, () => {
				throw Failure;
			}, (TransactionError) => {
				CheckFailure(TransactionError, Failure);
				vecCompletions.push(TransactionError);
			});
			Drain(Harness);
			g_Assert.equal(vecCompletions.length, 1);
			g_Assert.deepEqual(Harness.Operations.filter(strOperation => ["Begin", "Commit", "Rollback"].includes(strOperation)), ["Begin", "Rollback"]);
			g_Assert.equal(Harness.TransactionActive, false);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}

		for (const strOperation of ["Begin", "Commit", "Rollback"]) {
			for (const Failure of vecFailures) {
				const Harness = CreateHarness({}, { SynchronousFailures: { [strOperation]: Failure } });
				const vecCompletions = [];
				Harness.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
					g_Assert.ok(Harness.Connections.has(hConnection));
					g_Assert.equal(Options.Blocking, bBlocking);
					Complete((strOperation === "Rollback") ? OpaqueFailure : null, false);
				}, (TransactionError) => {
					if (strOperation === "Rollback") {
						g_Assert.equal(TransactionError.name, "AggregateError");
						g_Assert.equal(TransactionError.errors.length, 2);
						g_Assert.equal(TransactionError.errors[0], OpaqueFailure);
						CheckFailure(TransactionError.errors[1], Failure);
					} else {
						CheckFailure(TransactionError, Failure);
					}

					vecCompletions.push(TransactionError);
				});
				Drain(Harness);
				g_Assert.equal(vecCompletions.length, 1, "synchronous dispatch failures still complete the caller");
				g_Assert.equal(Harness.TransactionActive, strOperation === "Rollback");
				g_Assert.equal(Harness.CallbackExceptions.length, 0);
				unScenarioCount++;
			}
		}

		for (const strOperation of ["Begin", "Commit", "Rollback"]) {
			const Harness = CreateHarness();
			Harness.SetFailure(strOperation);
			let unCallbacks = 0;
			Harness.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
				g_Assert.ok(Harness.Connections.has(hConnection));
				g_Assert.equal(Options.Blocking, bBlocking);
				Complete((strOperation === "Rollback") ? OpaqueFailure : null, false);
			}, (TransactionError) => {
				unCallbacks++;
				g_Assert.equal((strOperation === "Rollback") ? TransactionError.errors[1] : TransactionError, Harness.RequestError);
			});
			Drain(Harness);
			g_Assert.equal(unCallbacks, 1);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}

		for (const Failure of vecFailures.filter(Value => Value !== null)) {
			const Harness = CreateHarness();
			let unCallbacks = 0;
			Harness.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
				g_Assert.ok(Harness.Connections.has(hConnection));
				g_Assert.equal(Options.Blocking, bBlocking);
				Complete(Failure, false);
			}, (TransactionError) => {
				CheckFailure(TransactionError, Failure);
				unCallbacks++;
			});
			Drain(Harness);
			g_Assert.equal(unCallbacks, 1);
			g_Assert.equal(Harness.Operations.includes("Commit"), false);
			g_Assert.equal(Harness.TransactionActive, false);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}

		const DualFailure = CreateHarness({}, { SynchronousFailures: { Commit: null, Rollback: undefined } });
		let unDualCallbacks = 0;
		DualFailure.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
			g_Assert.ok(DualFailure.Connections.has(hConnection));
			g_Assert.equal(Options.Blocking, bBlocking);
			Complete(null, true);
		}, (TransactionError) => {
			unDualCallbacks++;
			g_Assert.equal(TransactionError.message, "SQL commit and rollback both failed.");
			g_Assert.equal(TransactionError.errors.length, 2);
			CheckFailure(TransactionError.errors[0], null);
			CheckFailure(TransactionError.errors[1], undefined);
		});
		Drain(DualFailure);
		g_Assert.equal(unDualCallbacks, 1);
		g_Assert.equal(DualFailure.TransactionActive, true, "failed rollback does not falsely clear transaction state");
		g_Assert.equal(DualFailure.CallbackExceptions.length, 0);
		unScenarioCount++;

		const Successful = CreateHarness();
		const vecResults = [];
		Successful.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
			g_Assert.ok(Successful.Connections.has(hConnection));
			g_Assert.equal(Options.Blocking, bBlocking);
			Complete(null, false);
			Complete(OpaqueFailure);
		}, (TransactionError, bResult) => {
			g_Assert.equal(TransactionError, null);
			vecResults.push(bResult);
		});
		Drain(Successful);
		g_Assert.deepEqual(vecResults, [false], "false remains a valid committed result and duplicate completions are ignored");
		g_Assert.equal(Successful.TransactionActive, false);
		g_Assert.equal(Successful.CallbackExceptions.length, 0);
		unScenarioCount++;

		const ThrowingCallback = CreateHarness();
		let unCallbacks = 0;
		ThrowingCallback.Instance.RunTransaction({ Blocking: bBlocking }, (hConnection, Options, Complete) => {
			g_Assert.ok(ThrowingCallback.Connections.has(hConnection));
			g_Assert.equal(Options.Blocking, bBlocking);
			Complete(null, true);
		}, () => {
			unCallbacks++;
			throw null;
		});
		Drain(ThrowingCallback);
		g_Assert.equal(unCallbacks, 1);
		g_Assert.deepEqual(ThrowingCallback.CallbackExceptions, [null]);
		g_Assert.equal(ThrowingCallback.Operations.includes("Rollback"), false, "a callback throw after commit is not a transaction failure");
		unScenarioCount++;
	}

	for (const Failure of vecFailures) {
		const Harness = CreateHarness({}, { SynchronousFailures: { Connect: Failure } });
		let unCallbacks = 0;
		Harness.Instance.Open({}, (OpenError, hConnection) => {
			CheckFailure(OpenError, Failure);
			g_Assert.equal(hConnection, null);
			unCallbacks++;
		});
		g_Assert.equal(unCallbacks, 1);
		g_Assert.equal(Harness.Pending.size, 0);
		g_Assert.equal(Harness.Instance.m_bOpening, false);
		unScenarioCount++;

		const Synchronization = CreateHarness();
		Synchronization.Instance.ReadState = (Options, Callback) => {
			g_Assert.equal(typeof Options, "object");
			Callback(null, {});
		};
		Synchronization.Instance.SynchronizeManager = () => {
			throw Failure;
		};
		unCallbacks = 0;
		Synchronization.Instance.Synchronize({}, (SynchronizationError) => {
			CheckFailure(SynchronizationError, Failure);
			unCallbacks++;
		});
		g_Assert.equal(unCallbacks, 1);
		unScenarioCount++;

		const Rows = CreateHarness({}, { QueryRows: new Proxy([], {
			get(Target, Key, Receiver) {
				if (Key === Symbol.iterator) {
					throw Failure;
				}

				return Reflect.get(Target, Key, Receiver);
			},
		}) });
		unCallbacks = 0;
		Rows.Instance.ReadState({ Blocking: true }, (ReadError) => {
			CheckFailure(ReadError, Failure);
			unCallbacks++;
		});
		g_Assert.equal(unCallbacks, 1);
		g_Assert.equal(Rows.CallbackExceptions.length, 0);
		unScenarioCount++;
	}

	const Reentrant = CreateHarness();
	const vecHandles = [];
	Reentrant.Instance.Open({}, (OpenError, hConnection) => {
		g_Assert.equal(OpenError, null);
		vecHandles.push(hConnection);
		Reentrant.Instance.Unload({ Blocking: true }, () => {});
	});
	Reentrant.Instance.Open({}, (OpenError, hConnection) => {
		g_Assert.equal(OpenError, null);
		vecHandles.push(hConnection);
	});
	Drain(Reentrant);
	g_Assert.deepEqual(vecHandles, [1, 1], "all detached waiters receive the completed opening's handle snapshot");
	g_Assert.equal(Reentrant.Connections.size, 0);
	g_Assert.equal(Reentrant.CallbackExceptions.length, 0);
	unScenarioCount++;

	const Reopened = CreateHarness();
	const vecReopenedHandles = [];
	Reopened.Instance.Open({}, (OpenError, hConnection) => {
		g_Assert.equal(OpenError, null);
		vecReopenedHandles.push(hConnection);
		Reopened.Instance.Unload({ Blocking: true }, () => {});
		Reopened.Instance.Open({ Blocking: true }, (NextError, hNextConnection) => {
			g_Assert.equal(NextError, null);
			g_Assert.equal(hNextConnection, 2);
		});
	});
	Reopened.Instance.Open({}, (OpenError, hConnection) => {
		g_Assert.equal(OpenError, null);
		vecReopenedHandles.push(hConnection);
	});
	Drain(Reopened);
	g_Assert.deepEqual(vecReopenedHandles, [1, 1]);
	g_Assert.equal(Reopened.Instance.m_hConnection, 2);
	g_Assert.equal(Reopened.CallbackExceptions.length, 0);
	unScenarioCount++;

	const CallbackFailures = CreateHarness();
	const vecCallbackOrder = [];
	CallbackFailures.Instance.Open({}, () => {
		vecCallbackOrder.push("First");
		throw null;
	});
	CallbackFailures.Instance.Open({}, () => {
		vecCallbackOrder.push("Second");
		throw OpaqueFailure;
	});
	CallbackFailures.Instance.Open({}, () => vecCallbackOrder.push("Third"));
	Drain(CallbackFailures);
	g_Assert.deepEqual(vecCallbackOrder, ["First", "Second", "Third"]);
	g_Assert.deepEqual(CallbackFailures.CallbackExceptions, [null], "the documented first callback exception policy is preserved");
	unScenarioCount++;

	const Loaded = CreateHarness();
	Loaded.Instance.Synchronize = (Options, Callback) => {
		g_Assert.equal(typeof Options, "object");
		Callback(OpaqueFailure);
	};
	let unCallbacks = 0;
	Loaded.Instance.Load({ Blocking: true }, (LoadError) => {
		g_Assert.equal(LoadError, OpaqueFailure);
		unCallbacks++;
	});
	g_Assert.equal(unCallbacks, 1);
	g_Assert.equal(Loaded.Instance.Loaded, true, "documented mark-loaded-before-synchronization contract is preserved");
	unScenarioCount++;

	console.log(`SQLBackend C2 ${unScenarioCount} open/unload/transaction/falsy-error lifecycle scenarios passed (controlled SOCI requests;no native IO).`);
}

function VerifyTailFailuresAndTransfers() {
	const Paths = { AUTH_CONFIG_ROOT: "root", AUTH_PARENTS_FILE: "parents", AUTH_PLAYERS_FILE: "players" };
	const OpaqueFailure = {
		toString() {
			throw new Error("Tail operation failures must not be coerced.");
		},
	};
	const vecFailures = [undefined, null, false, 0, -0, 0n, "", NaN, OpaqueFailure, new Error("controlled tail failure")];
	const vecNames = ["HasPlayerPermission", "HasParentPermission", "ExportFlatFile", "ImportFlatFile"];
	let unScenarioCount = 0;

	function RunOperation(Harness, strName, Callback) {
		if (strName === "HasPlayerPermission") {
			Harness.Instance.HasPlayerPermission("Player", "permission", {}, Callback);
			return;
		}

		if (strName === "HasParentPermission") {
			Harness.Instance.HasParentPermission("Parent", "permission", {}, Callback);
			return;
		}

		Harness.Instance[strName]({ Blocking: true }, Callback);
	}

	function CheckFailure(ErrorValue, Original) {
		if (Original) {
			g_Assert.equal(ErrorValue, Original);
			return;
		}

		g_Assert.ok(ErrorValue, "Falsy failure must not be delivered as success.");
		g_Assert.equal(ErrorValue.name, "AggregateError");
		g_Assert.equal(ErrorValue.errors.length, 1);
		g_Assert.ok(Object.is(ErrorValue.errors[0], Original));
	}

	function CreateFailureObject(strPropertyName, Failure) {
		const Value = {};
		Object.defineProperty(Value, strPropertyName, {
			enumerable: true,
			get() {
				throw Failure;
			},
		});

		return Value;
	}

	function Drain(Harness) {
		const unMaximumRequests = 64;
		let unCompletedRequests = 0;
		while (Harness.Pending.size > 0) {
			g_Assert.ok(unCompletedRequests++ < unMaximumRequests);
			Harness.Pending.values().next().value.Complete();
		}
	}

	for (const strName of vecNames) {
		for (const Failure of vecFailures) {
			const Harness = CreateHarness({}, { Paths, Filesystem: {
				EnsureDirectoryExists() {
					throw Failure;
				},
				ReadTextFile() {
					throw Failure;
				},
			} });
			Harness.Instance.ReadState = (Options, Callback) => {
				g_Assert.equal(typeof Options, "object");

				if (strName === "HasPlayerPermission") {
					Callback(null, CreateFailureObject("Players", Failure));
					return;
				}

				Callback(null, { Players: {}, Parents: {} });
			};
			Harness.Instance.Parents = (Options, Callback) => {
				g_Assert.equal(typeof Options, "object");
				Callback(null, CreateFailureObject("Parent", Failure));
			};
			let unCallbacks = 0;
			RunOperation(Harness, strName, (OperationError, ...vecResults) => {
				CheckFailure(OperationError, Failure);
				g_Assert.equal(vecResults.length, 0);
				unCallbacks++;
			});
			g_Assert.equal(unCallbacks, 1);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}
	}

	for (const bBlocking of [false, true]) {
		for (const Failure of vecFailures) {
			const Harness = CreateHarness({}, {
				Paths,
				AllowMutationStatements: true,
				Filesystem: { ReadTextFile: () => "{}" },
				BeforeExecute(hConnection, strStatement, Parameters) {
					g_Assert.ok(Harness.Connections.has(hConnection));
					g_Assert.deepEqual(Object.keys(Parameters), []);

					if (strStatement.startsWith("DELETE FROM ")) {
						throw Failure;
					}
				},
			});
			let unSynchronizations = 0;
			Harness.Instance.Synchronize = () => {
				unSynchronizations++;
			};
			let unCallbacks = 0;
			Harness.Instance.ImportFlatFile({ Blocking: bBlocking }, (ImportError) => {
				CheckFailure(ImportError, Failure);
				unCallbacks++;
			});
			Drain(Harness);
			g_Assert.equal(unCallbacks, 1);
			g_Assert.equal(unSynchronizations, 0, "failed import must not synchronize or report a commit");
			g_Assert.equal(Harness.Operations.includes("Commit"), false);
			g_Assert.equal(Harness.Operations.includes("Rollback"), true);
			g_Assert.equal(Harness.TransactionActive, false);
			g_Assert.equal(Harness.CallbackExceptions.length, 0);
			unScenarioCount++;
		}

		const Import = CreateHarness({}, { Paths, AllowMutationStatements: true, Filesystem: { ReadTextFile: () => "{}" } });
		const State = {};
		Import.Instance.Synchronize = (Options, Callback) => {
			g_Assert.equal(Options.Blocking, bBlocking);
			Callback(null, State);
		};
		let unCallbacks = 0;
		Import.Instance.ImportFlatFile({ Blocking: bBlocking }, (ImportError, ImportedState) => {
			g_Assert.equal(ImportError, null);
			g_Assert.equal(ImportedState, State);
			unCallbacks++;
		});
		Drain(Import);
		g_Assert.equal(unCallbacks, 1);
		g_Assert.equal(Import.Operations.includes("Commit"), true);
		g_Assert.equal(Import.Operations.includes("Rollback"), false);
		g_Assert.equal(Import.CallbackExceptions.length, 0);
		unScenarioCount++;
	}

	const vecWrites = [];
	const Export = CreateHarness({}, { Paths, Filesystem: {
		EnsureDirectoryExists(strPath) {
			g_Assert.equal(strPath, "root");

			return true;
		},
		WriteTextFile(strPath, strText) {
			vecWrites.push({ Path: strPath, Text: strText });

			return true;
		},
	} });
	const ExportedState = { Players: Object.create(null), Parents: Object.create(null) };
	ExportedState.Players["__proto__"] = { Parents: ["constructor"], Permissions: ["permission"] };
	ExportedState.Parents.constructor = { Parents: [], Permissions: ["*"] };
	Export.Instance.ReadState = (Options, Callback) => {
		g_Assert.equal(typeof Options, "object");
		Callback(null, ExportedState);
	};
	let unExportCallbacks = 0;
	Export.Instance.ExportFlatFile({}, (ExportError, State) => {
		g_Assert.equal(ExportError, null);
		g_Assert.equal(State, ExportedState);
		unExportCallbacks++;
	});
	g_Assert.equal(unExportCallbacks, 1);
	g_Assert.deepEqual(vecWrites.map(Entry => Entry.Path), ["players", "parents"]);
	const Players = JSON.parse(vecWrites[0].Text);
	g_Assert.equal(Object.hasOwn(Players, "__proto__"), true);
	g_Assert.deepEqual(Object.keys(Players["__proto__"]).sort(), ["Parents", "Permissions"]);
	g_Assert.equal(Object.hasOwn(JSON.parse(vecWrites[1].Text), "constructor"), true);
	unScenarioCount++;

	for (const strName of vecNames) {
		for (const bFailOperation of [false, true]) {
			const Harness = CreateHarness({}, { Paths, AllowMutationStatements: true, Filesystem: {
				EnsureDirectoryExists() {
					if (bFailOperation) {
						throw 0;
					}

					return true;
				},
				ReadTextFile() {
					if (bFailOperation) {
						throw 0;
					}

					return "{}";
				},
				WriteTextFile: () => true,
			} });
			Harness.Instance.ReadState = (Options, Callback) => {
				g_Assert.equal(typeof Options, "object");

				const State = bFailOperation ? CreateFailureObject("Players", 0) : { Players: { Player: { Permissions: ["permission"], Parents: [] } }, Parents: {} };
				Callback(null, State);
			};
			Harness.Instance.Parents = (Options, Callback) => {
				g_Assert.equal(typeof Options, "object");

				const Parents = bFailOperation ? CreateFailureObject("Parent", 0) : { Parent: { Permissions: ["permission"], Parents: [] } };
				Callback(null, Parents);
			};
			Harness.Instance.Synchronize = (Options, Callback) => {
				g_Assert.equal(typeof Options, "object");
				Callback(null, {});
			};
			let unCallbacks = 0;
			let bDirectThrow = false;
			try {
				RunOperation(Harness, strName, () => {
					unCallbacks++;
					throw null;
				});
				Drain(Harness);
			} catch (CallbackError) {
				bDirectThrow = true;
				g_Assert.equal(CallbackError, null);
			}

			g_Assert.equal(unCallbacks, 1);
			g_Assert.equal(Number(bDirectThrow) + Harness.CallbackExceptions.length, 1);

			if (!bDirectThrow) {
				g_Assert.deepEqual(Harness.CallbackExceptions, [null]);
			}

			unScenarioCount++;
		}
	}

	console.log(`SQLBackend C3 ${unScenarioCount} permission/flat-file/falsy-error/callback scenarios passed (controlled SOCI/filesystem;no native IO).`);
}

function VerifyAdministratorMutations() {
	const vecStatements = [];
	const Harness = CreateHarness({}, {
		AllowMutationStatements: true,
		BeforeExecute(hConnection, strStatement, Parameters) {
			vecStatements.push({ Statement: strStatement, Parameters });
		},
		QueryRows(strStatement, Parameters) {
			return (strStatement.includes("object_type = 'Parent'") && (Parameters.Identifier === "Operators")) ? [{ identifier: "Operators" }] : [];
		},
	});
	const Options = { Blocking: false };
	function Run(Operation) {
		let Completion = null;
		Operation((Failure, Result) => {
			Completion = { Failure, Result };
		});
		while (Harness.Pending.size > 0) {
			Harness.Pending.values().next().value.Complete();
		}

		g_Assert.ok(Completion);
		g_Assert.equal(Harness.TransactionActive, false);
		return Completion;
	}

	const strPlayerID = "76561197960265729";
	g_Assert.deepEqual(Run((Callback) => Harness.Instance.CreateAuthorizationObject(strPlayerID, "Player", Options, Callback)), { Failure: null, Result: true });
	g_Assert.deepEqual(Run((Callback) => Harness.Instance.ReplacePlayerParents(strPlayerID, ["Operators", "Operators"], Options, Callback)), { Failure: null, Result: true });
	g_Assert.equal(vecStatements.filter((Entry) => Entry.Statement.startsWith("INSERT INTO sourcejs_auth_parents")).length, 1);
	const Rejected = Run((Callback) => Harness.Instance.ReplacePlayerParents(strPlayerID, ["Nonexistent"], Options, Callback));
	g_Assert.match(Rejected.Failure.message, /does not exist/);
	g_Assert.equal(Harness.Operations.at(-1), "Rollback");
	g_Assert.deepEqual(Run((Callback) => Harness.Instance.DeleteAuthorizationObject("Operators", "Parent", Options, Callback)), { Failure: null, Result: true });
	g_Assert.equal(vecStatements.find((Entry) => Entry.Statement.includes("OR parent_identifier = :ParentIdentifier")).Parameters.ParentIdentifier, "Operators");
	g_Assert.ok(vecStatements.every((Entry) => !Entry.Statement.includes(strPlayerID) && !Entry.Statement.includes("Operators")));

	const unBeforeSchemaUpdate = vecStatements.length;
	g_Assert.deepEqual(Run((Callback) => Harness.Instance.UpdateSQLiteSchema(Options, Callback)), { Failure: null, Result: true });
	g_Assert.deepEqual(Harness.Operations.slice(-3), ["Begin", `Execute${vecStatements.length}`, "Commit"]);
	g_Assert.deepEqual(vecStatements.slice(unBeforeSchemaUpdate).map((Entry) => Entry.Statement), [
		"CREATE INDEX IF NOT EXISTS sourcejs_auth_parents_by_child ON sourcejs_auth_parents (child_identifier, child_type)",
	]);

	Harness.SetFailure(`Execute${vecStatements.length + 1}`);
	g_Assert.equal(Run((Callback) => Harness.Instance.UpdateSQLiteSchema(Options, Callback)).Failure, Harness.RequestError);
	g_Assert.equal(Harness.Operations.at(-1), "Rollback");

	console.log("SQLBackend administrator mutations passed: bound parameters, duplicate groups, atomic rollback, group cleanup, and schema maintenance.");
}

VerifyLifecycleAndTransactions();
VerifyTailFailuresAndTransfers();
VerifyAdministratorMutations();

for (const unCompletedStages of [0, 1, 2, 3]) {
	VerifyJoinedOpen("", unCompletedStages);
}

for (const strFailureOperation of ["Connect", "Execute1", "Execute2", "Execute3"]) {
	VerifyJoinedOpen(strFailureOperation, 0);
}

for (const bConnected of [false, true]) {
	VerifyExistingConnection(bConnected, "");
	VerifyExistingConnection(bConnected, "IsConnected");
}

VerifyExistingConnection(false, "Reconnect");
VerifyReentrantOpen();
console.log("SQLBackend joined Blocking Open contracts passed (controlled SOCI double; native waiting is tested separately).");
