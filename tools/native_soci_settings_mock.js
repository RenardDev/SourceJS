"use strict";

// The model owns only the settings SQL subset, not SOCI's request boundary.
// Database columns and bound parameter names retain the persisted SQL schema.
function CreateSettingsSOCIModel() {
	const mapDatabases = new Map();
	const mapSessions = new Map();
	const mapTransactions = new Map();
	let unNextHandle = 1;

	function RequireSessionDatabase(hHandle) {
		if (!Number.isSafeInteger(hHandle) || (hHandle <= 0)) {
			throw new TypeError("Settings SOCI session handles must be positive safe integers.");
		}

		if (!mapSessions.has(hHandle)) {
			throw new Error(`Unknown settings SOCI session ${hHandle}.`);
		}

		return mapSessions.get(hHandle);
	}

	function SelectDatabase(strConnectionString) {
		if ((typeof strConnectionString !== "string") || (strConnectionString.length === 0)) {
			throw new TypeError("Settings SOCI connection strings must be non-empty strings.");
		}

		if (!mapDatabases.has(strConnectionString)) {
			mapDatabases.set(strConnectionString, { Players: [], Values: [] });
		}

		return mapDatabases.get(strConnectionString);
	}

	function RequireStatement(strStatement) {
		if ((typeof strStatement !== "string") || (strStatement.length === 0)) {
			throw new TypeError("Settings SOCI statements must be non-empty strings.");
		}
	}

	function RequireParameters(Parameters) {
		if (!Parameters || (typeof Parameters !== "object") || Array.isArray(Parameters)) {
			throw new TypeError("Settings SOCI parameters must be an object.");
		}
	}

	return {
		Begin(hHandle) {
			const DatabaseState = RequireSessionDatabase(hHandle);

			if (mapTransactions.has(hHandle)) {
				throw new Error(`Settings SOCI session ${hHandle} already has an active transaction.`);
			}

			// Rows are never mutated in place, so independent arrays suffice.
			mapTransactions.set(hHandle, { Players: DatabaseState.Players.slice(), Values: DatabaseState.Values.slice() });

			return true;
		},
		Close(hHandle) {
			mapTransactions.delete(hHandle);

			return mapSessions.delete(hHandle);
		},
		Commit(hHandle) {
			RequireSessionDatabase(hHandle);

			if (!mapTransactions.delete(hHandle)) {
				throw new Error(`Settings SOCI session ${hHandle} does not have an active transaction.`);
			}

			return true;
		},
		Connect(strConnectionString) {
			if (!Number.isSafeInteger(unNextHandle)) {
				throw new Error("Settings SOCI session handle range is exhausted.");
			}

			const DatabaseState = SelectDatabase(strConnectionString);
			const hHandle = unNextHandle;
			unNextHandle += 1;
			mapSessions.set(hHandle, DatabaseState);

			return hHandle;
		},
		Execute(hHandle, strStatement, Parameters = {}) {
			const DatabaseState = RequireSessionDatabase(hHandle);

			RequireStatement(strStatement);
			RequireParameters(Parameters);

			if (strStatement.startsWith("CREATE TABLE")) {
				return 0;
			}

			if (strStatement.startsWith("INSERT INTO sourcejs_settings_players")) {
				DatabaseState.Players.push({ namespace: Parameters.namespace, uniqueid: Parameters.uniqueid });
				return 1;
			}

			if (strStatement.startsWith("INSERT INTO sourcejs_settings_values")) {
				DatabaseState.Values.push({
					namespace: Parameters.namespace,
					setting_name: Parameters.name,
					uniqueid: Parameters.uniqueid,
					value_kind: Parameters.kind,
					value_number: Parameters.number,
					value_text: Parameters.text,
				});
				return 1;
			}

			if (strStatement.startsWith("DELETE FROM sourcejs_settings_values")) {
				const unPreviousCount = DatabaseState.Values.length;
				DatabaseState.Values = DatabaseState.Values.filter((Record) => {
					if (Record.namespace !== Parameters.namespace) {
						return true;
					}

					if ((Parameters.uniqueid !== undefined) && (Record.uniqueid !== Parameters.uniqueid)) {
						return true;
					}

					return (Parameters.name !== undefined) && (Record.setting_name !== Parameters.name);
				});

				return unPreviousCount - DatabaseState.Values.length;
			}

			if (strStatement.startsWith("DELETE FROM sourcejs_settings_players")) {
				const unPreviousCount = DatabaseState.Players.length;
				DatabaseState.Players = DatabaseState.Players.filter((Record) => (Record.namespace !== Parameters.namespace) || ((Parameters.uniqueid !== undefined) && (Record.uniqueid !== Parameters.uniqueid)));

				return unPreviousCount - DatabaseState.Players.length;
			}

			throw new Error(`Unexpected settings SQL Execute statement: ${strStatement}`);
		},
		IsConnected(hHandle) {
			return mapSessions.has(hHandle);
		},
		Query(hHandle, strStatement, Parameters = {}) {
			const DatabaseState = RequireSessionDatabase(hHandle);

			RequireStatement(strStatement);
			RequireParameters(Parameters);

			if (strStatement.startsWith("SELECT uniqueid FROM sourcejs_settings_players")) {
				return DatabaseState.Players.filter((Record) => (Record.namespace === Parameters.namespace) && ((Parameters.uniqueid === undefined) || (Record.uniqueid === Parameters.uniqueid))).map((Record) => ({ uniqueid: Record.uniqueid }));
			}

			if (strStatement.startsWith("SELECT uniqueid, setting_name, value_kind, value_text, value_number FROM sourcejs_settings_values")) {
				return DatabaseState.Values.filter((Record) => Record.namespace === Parameters.namespace).map((Record) => ({ ...Record }));
			}

			throw new Error(`Unexpected settings SQL Query statement: ${strStatement}`);
		},
		Reconnect(hHandle) {
			RequireSessionDatabase(hHandle);

			return true;
		},
		Rollback(hHandle) {
			const DatabaseState = RequireSessionDatabase(hHandle);
			const TransactionState = mapTransactions.get(hHandle);
			if (!TransactionState) {
				throw new Error(`Settings SOCI session ${hHandle} does not have an active transaction.`);
			}

			DatabaseState.Players = TransactionState.Players;
			DatabaseState.Values = TransactionState.Values;
			mapTransactions.delete(hHandle);

			return true;
		},
	};
}

function RequireSettingsSOCIRequest(Options, Callback) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Settings SOCI requests require an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Settings SOCI Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Settings SOCI requests require a Callback function.");
	}

	return bBlocking === true;
}

function RequireSettingsSOCIHandle(Handle) {
	const hSessionHandle = ((Handle !== null) && (typeof Handle === "object")) ? Handle.Handle : Handle;
	if (!Number.isSafeInteger(hSessionHandle) || (hSessionHandle <= 0)) {
		throw new TypeError("Settings SOCI session handles must be positive safe integers.");
	}

	return hSessionHandle;
}

function SnapshotSettingsSOCIStatement(strStatement, Parameters) {
	if ((typeof strStatement !== "string") || (strStatement.length === 0)) {
		throw new TypeError("Settings SOCI statements must be non-empty strings.");
	}

	if ((Parameters === null) || (Parameters === undefined)) {
		return {};
	}

	if ((typeof Parameters !== "object") || Array.isArray(Parameters)) {
		throw new TypeError("The settings SOCI mock supports named SQL parameters only.");
	}

	return { ...Parameters };
}

// Microtasks model deferred completion only; they do not test native workers,
// drivers, runtime ownership or cancellation. Blocking invokes one callback inline.
function CreateSettingsSOCIMock() {
	const Model = CreateSettingsSOCIModel();

	function RunRequest(Operation, bBlocking, Callback) {
		const CompleteRequest = () => {
			let RequestError = null;
			let Result = null;

			try {
				Result = Operation();
			} catch (OperationError) {
				RequestError = OperationError;
			}

			// Keep user code outside the operation catch; never retry a callback.
			Callback(RequestError, Result);
		};

		if (bBlocking) {
			CompleteRequest();

		} else {
			queueMicrotask(CompleteRequest);
		}
	}

	function RunSessionRequest(strOperationName, Handle, Options, Callback) {
		const bBlocking = RequireSettingsSOCIRequest(Options, Callback);
		const hSessionHandle = RequireSettingsSOCIHandle(Handle);
		RunRequest(() => Model[strOperationName](hSessionHandle), bBlocking, Callback);
	}

	function RunStatementRequest(strOperationName, Handle, strStatement, ParametersOrOptions, OptionsOrCallback, Callback) {
		const Options = (Callback === undefined) ? ParametersOrOptions : OptionsOrCallback;
		const CompleteStatement = (Callback === undefined) ? OptionsOrCallback : Callback;
		const Parameters = (Callback === undefined) ? undefined : ParametersOrOptions;
		const bBlocking = RequireSettingsSOCIRequest(Options, CompleteStatement);
		const hSessionHandle = RequireSettingsSOCIHandle(Handle);
		const StatementParameters = SnapshotSettingsSOCIStatement(strStatement, Parameters);
		RunRequest(() => {
			const Result = Model[strOperationName](hSessionHandle, strStatement, StatementParameters);

			return (strOperationName === "Execute") ? BigInt(Result) : Result;
		}, bBlocking, CompleteStatement);
	}

	return {
		Begin(Handle, Options, Callback) {
			RunSessionRequest("Begin", Handle, Options, Callback);
		},
		Close(Handle, Options, Callback) {
			RunSessionRequest("Close", Handle, Options, Callback);
		},
		Commit(Handle, Options, Callback) {
			RunSessionRequest("Commit", Handle, Options, Callback);
		},
		Connect(strConnectionString, BackendOrOptions, OptionsOrCallback, Callback = undefined) {
			const strBackendName = (Callback === undefined) ? undefined : BackendOrOptions;
			const Options = (Callback === undefined) ? BackendOrOptions : OptionsOrCallback;
			const CompleteConnect = (Callback === undefined) ? OptionsOrCallback : Callback;
			const bBlocking = RequireSettingsSOCIRequest(Options, CompleteConnect);

			if ((typeof strConnectionString !== "string") || (strConnectionString.length === 0)) {
				throw new TypeError("Settings SOCI connection strings must be non-empty strings.");
			}

			if ((strBackendName !== null) && (strBackendName !== undefined) && (typeof strBackendName !== "string")) {
				throw new TypeError("Settings SOCI backend names must be strings or nullish.");
			}

			RunRequest(() => Model.Connect(strConnectionString), bBlocking, CompleteConnect);
		},
		Execute(Handle, strStatement, ParametersOrOptions, OptionsOrCallback, Callback = undefined) {
			RunStatementRequest("Execute", Handle, strStatement, ParametersOrOptions, OptionsOrCallback, Callback);
		},
		IsConnected(Handle, Options, Callback) {
			RunSessionRequest("IsConnected", Handle, Options, Callback);
		},
		Query(Handle, strStatement, ParametersOrOptions, OptionsOrCallback, Callback = undefined) {
			RunStatementRequest("Query", Handle, strStatement, ParametersOrOptions, OptionsOrCallback, Callback);
		},
		Reconnect(Handle, Options, Callback) {
			RunSessionRequest("Reconnect", Handle, Options, Callback);
		},
		Rollback(Handle, Options, Callback) {
			RunSessionRequest("Rollback", Handle, Options, Callback);
		},
	};
}

module.exports = { CreateSettingsSOCIModel, CreateSettingsSOCIMock };
