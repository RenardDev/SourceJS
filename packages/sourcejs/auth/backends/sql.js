"use strict";

const { EnsureDirectoryExists, ReadTextFile, WriteTextFile } = require("filesystem");
const { GetModule } = require("internal/runtime");
const { AUTH_CONFIG_ROOT, AUTH_PARENTS_FILE, AUTH_PLAYERS_FILE, AUTH_SQL_FILE } = require("paths");
const { Backend } = require("auth/index");
const { Begin, Close, Commit, Connect, Execute, IsConnected, Query, Reconnect, Rollback } = require("soci");

const g_AuthorizationRuntime = GetModule("auth");
const g_SQLRuntime = GetModule("auth/backends/sql");

// SQL table/column and bound-parameter spellings are database contracts, not public JavaScript properties.
const g_strObjectTable = "sourcejs_auth_objects";
const g_strPermissionTable = "sourcejs_auth_permissions";
const g_strParentTable = "sourcejs_auth_parents";
const g_strParentChildIndex = "sourcejs_auth_parents_by_child";

function RequireText(strValue, strName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strName} must be a non-empty string.`);
	}

	return strValue;
}

function RequireRequestParameters(Options, Callback, strOperationName) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError(`${strOperationName} expects an options object.`);
	}

	if (typeof Callback !== "function") {
		throw new TypeError(`${strOperationName} expects a callback function.`);
	}
}

function GetDefaultDatabasePath() {
	return RequireText(AUTH_SQL_FILE, "Auth SQL path");
}

function GetRowValue(Row, strName) {
	if (!Object.prototype.hasOwnProperty.call(Row, strName)) {
		throw new Error(`SOCI result is missing column '${strName}'.`);
	}

	return Row[strName];
}

function CreateEmptyRecord(strName) {
	return {
		Name: strName,
		Parents: [],
		Permissions: [],
	};
}

function AddUnique(vecValues, strValue) {
	if (vecValues.includes(strValue)) {
		return;
	}

	vecValues.push(strValue);
}

function CompilePermission(strPermission) {
	const strEscapedPermission = RequireText(strPermission, "Permission").replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	// Native wildcards include line terminators, unlike the default RegExp dot.
	const strPermissionPattern = strEscapedPermission.replace(/\*/g, "[\\s\\S]*");

	return new RegExp(`^${strPermissionPattern}$`);
}

function HasRecordPermission(RecordsByName, strName, strPermission, setVisitedNames = new Set()) {
	function* TraverseRecord(strRecordName) {
		if ((RecordsByName === null) || (typeof RecordsByName !== "object")) {
			throw new TypeError("RecordsByName must be an object.");
		}

		if (!(setVisitedNames instanceof Set)) {
			throw new TypeError("setVisitedNames must be a Set.");
		}

		RequireText(strRecordName, "Record name");
		RequireText(strPermission, "Permission");

		if (setVisitedNames.has(strRecordName)) {
			return false;
		}

		setVisitedNames.add(strRecordName);

		if (!Object.prototype.hasOwnProperty.call(RecordsByName, strRecordName)) {
			return false;
		}

		const Record = RecordsByName[strRecordName];
		if (Record === undefined) {
			return false;
		}

		for (const strStoredPermission of Record.Permissions) {
			if (CompilePermission(strStoredPermission).test(strPermission)) {
				return true;
			}
		}

		for (const strParentName of Record.Parents) {
			const bHasInheritedPermission = yield strParentName;
			if (bHasInheritedPermission) {
				return true;
			}
		}

		return false;
	}

	// Generator frames preserve lazy iterator cleanup without recursive JavaScript calls.
	const vecTraversals = [TraverseRecord(strName)];
	let bHasPermission = false;
	let bFailed = false;
	let Failure = null;

	while (vecTraversals.length > 0) {
		const itTraversal = vecTraversals[vecTraversals.length - 1];
		let Step;
		try {
			Step = bFailed ? itTraversal.throw(Failure) : itTraversal.next(bHasPermission);
		} catch (TraversalError) {
			vecTraversals.pop();
			bFailed = true;
			Failure = TraversalError;
			continue;
		}

		bFailed = false;

		if (Step.done) {
			vecTraversals.pop();
			bHasPermission = Step.value;
			continue;
		}

		bHasPermission = false;
		vecTraversals.push(TraverseRecord(Step.value));
	}

	if (bFailed) {
		throw Failure;
	}

	return bHasPermission;
}

function RequireObjectType(strObjectType) {
	RequireText(strObjectType, "Auth object type");

	if ((strObjectType !== "Player") && (strObjectType !== "Parent")) {
		throw new TypeError("Auth object type must be Player or Parent.");
	}

	return strObjectType;
}

function RequireServerID(nServerID) {
	if (!Number.isInteger(nServerID)) {
		throw new TypeError("Server ID must be an integer.");
	}

	return nServerID;
}

function GetNodeDescriptor(Node) {
	if ((Node === null) || ((typeof Node !== "object") && (typeof Node !== "function"))) {
		throw new TypeError("SQL auth operations expect PlayerPermissions or ParentPermissions.");
	}

	if (Node.SteamID64 !== undefined) {
		return {
			Identifier: RequireText(Node.SteamID64, "Player Identifier"),
			Type: "Player",
		};
	}

	if ((Node.Name !== undefined) && (Node.Children instanceof Set)) {
		return {
			Identifier: RequireText(Node.Name, "Parent Identifier"),
			Type: "Parent",
		};
	}

	throw new TypeError("SQL auth operations expect PlayerPermissions or ParentPermissions.");
}

function GetSubjectIdentifier(Subject) {
	if (typeof Subject === "number") {
		return RequireText(g_AuthorizationRuntime.NetworkID(Subject), "Player identifier");
	}

	return RequireText(Subject, "Player identifier");
}

function ParseRecords(strText, strFilePath) {
	if (strText === null) {
		throw new Error(`${strFilePath} does not exist.`);
	}

	const Records = JSON.parse(strText);
	if ((Records === null) || Array.isArray(Records) || (typeof Records !== "object")) {
		throw new TypeError(`${strFilePath} must contain a JSON object.`);
	}

	return Records;
}

function RunOpenRequest(OpenRequest, Request, vecArguments, Options, Callback) {
	const RequestCallback = (...vecResults) => {
		if (OpenRequest.Callback === RequestCallback) {
			OpenRequest.Callback = null;
		}

		Callback(...vecResults);
	};
	OpenRequest.Callback = RequestCallback;

	try {
		Request(...vecArguments, Options, RequestCallback);
	} catch (Exception) {
		if (OpenRequest.Callback === RequestCallback) {
			OpenRequest.Callback = null;
		}

		throw Exception;
	}
}

function NormalizeSQLOperationError(OperationError, strOperationName) {
	return OperationError || new AggregateError([OperationError], `${strOperationName} failed.`);
}

class SQLBackend extends Backend {
	constructor(Options = {}) {
		super(Options);
		this.m_hConnection = null;
		this.m_bOpening = false;
		this.m_OpenRequest = null;
		this.m_vecOpenCallbacks = [];
		this.m_bSchemaReady = false;
		this.m_Manager = this.m_Options.Manager;
		this.m_strDatabasePath = (this.m_Options.DatabasePath === null) ? null : RequireText(this.m_Options.DatabasePath, "SQL DatabasePath");
		this.m_strBackendName = (this.m_Options.BackendName === null) ? null : RequireText(this.m_Options.BackendName, "SQL BackendName");
		this.m_strConnectionString = this.GetConnectionStringFromOptions();
	}

	GetConnectionStringFromOptions() {
		const strSQLiteURIPrefix = "sqlite:///";

		if (this.m_Options.ConnectionString !== null) {
			return RequireText(this.m_Options.ConnectionString, "SQL ConnectionString");
		}

		if (this.m_Options.URI !== null) {
			const strDatabaseURI = RequireText(this.m_Options.URI, "SQL URI");
			if (strDatabaseURI.startsWith(strSQLiteURIPrefix)) {
				this.m_strBackendName = "sqlite3";
				this.m_strDatabasePath = strDatabaseURI.slice(strSQLiteURIPrefix.length);
				return `dbname=${this.m_strDatabasePath}`;
			}

			return strDatabaseURI;
		}

		return null;
	}

	Open(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Open");

		const bBlocking = Options.Blocking;
		if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
			throw new TypeError("SQLBackend.Open Blocking option must be a boolean.");
		}

		this.m_vecOpenCallbacks.push(Callback);

		if (this.m_bOpening) {
			const OpenRequest = this.m_OpenRequest;
			if (bBlocking === true) {
				// Each wait delivers one native continuation; it never pumps unrelated requests.
				while (!OpenRequest.Completed) {
					if ((OpenRequest.Callback === null) || !g_SQLRuntime.WaitForRequest(OpenRequest.Callback)) {
						throw new Error("SQLBackend.Open cannot wait for an unavailable native continuation.");
					}
				}
			}

			return;
		}

		this.m_bOpening = true;
		const OpenRequest = { Callback: null, Complete: null, Completed: false };
		this.m_OpenRequest = OpenRequest;

		const CompleteOpen = (OpenError) => {
			if (OpenRequest.Completed) {
				return;
			}

			OpenRequest.Completed = true;
			OpenRequest.Callback = null;
			this.m_bOpening = false;
			this.m_OpenRequest = null;

			const vecOpenCallbacks = this.m_vecOpenCallbacks;
			this.m_vecOpenCallbacks = [];

			const CompletionError = (OpenError === null) ? null : NormalizeSQLOperationError(OpenError, "SQLBackend.Open");
			const hCompletedConnection = (CompletionError === null) ? this.m_hConnection : null;

			// A user callback must not prevent delivery to the other detached waiters.
			let bCallbackFailed = false;
			let FirstCallbackException;

			for (const OpenCallback of vecOpenCallbacks) {
				try {
					OpenCallback(CompletionError, hCompletedConnection);
				} catch (Exception) {
					if (!bCallbackFailed) {
						bCallbackFailed = true;
						FirstCallbackException = Exception;
					}
				}
			}

			if (bCallbackFailed) {
				throw FirstCallbackException;
			}
		};
		OpenRequest.Complete = CompleteOpen;

		const CompleteConnection = (ConnectionError, hConnection) => {
			if (ConnectionError !== null) {
				CompleteOpen(ConnectionError);
				return;
			}

			this.m_hConnection = hConnection;

			if (this.m_bSchemaReady) {
				CompleteOpen(null);
				return;
			}

			this.CreateSchema(Options, CompleteOpen);
		};

		try {
			if (this.m_hConnection !== null) {
				RunOpenRequest(OpenRequest, IsConnected, [this.m_hConnection], Options, (ConnectionCheckError, bIsConnected) => {
					if (ConnectionCheckError !== null) {
						CompleteOpen(ConnectionCheckError);
						return;
					}

					if (bIsConnected) {
						CompleteConnection(null, this.m_hConnection);
						return;
					}

					RunOpenRequest(OpenRequest, Reconnect, [this.m_hConnection], Options, (ReconnectError) => {
						CompleteConnection(ReconnectError, this.m_hConnection);
					});
				});
				return;
			}

			if (this.m_strConnectionString === null) {
				this.m_strDatabasePath ??= GetDefaultDatabasePath();
				this.m_strConnectionString = `dbname=${this.m_strDatabasePath}`;
			}

			if (this.m_strBackendName === null) {
				RunOpenRequest(OpenRequest, Connect, [this.m_strConnectionString], Options, CompleteConnection);
				return;
			}

			RunOpenRequest(OpenRequest, Connect, [this.m_strConnectionString, this.m_strBackendName], Options, CompleteConnection);
		} catch (Exception) {
			if (OpenRequest.Completed) {
				throw Exception;
			}

			CompleteOpen(NormalizeSQLOperationError(Exception, "SQLBackend.Open"));
		}
	}

	CreateSchema(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.CreateSchema");

		const strObjectTableStatement = [
			`CREATE TABLE IF NOT EXISTS ${g_strObjectTable} (`,
			"identifier VARCHAR(64) NOT NULL,",
			"object_type VARCHAR(16) NOT NULL,",
			"PRIMARY KEY (identifier, object_type)",
			")",
		].join(" ");
		const strPermissionTableStatement = [
			`CREATE TABLE IF NOT EXISTS ${g_strPermissionTable} (`,
			"object_identifier VARCHAR(64) NOT NULL,",
			"object_type VARCHAR(16) NOT NULL,",
			"server_id INTEGER NOT NULL,",
			"permission VARCHAR(255) NOT NULL,",
			"PRIMARY KEY (object_identifier, object_type, server_id, permission)",
			")",
		].join(" ");
		const strParentTableStatement = [
			`CREATE TABLE IF NOT EXISTS ${g_strParentTable} (`,
			"parent_identifier VARCHAR(64) NOT NULL,",
			"child_identifier VARCHAR(64) NOT NULL,",
			"child_type VARCHAR(16) NOT NULL,",
			"PRIMARY KEY (parent_identifier, child_identifier, child_type)",
			")",
		].join(" ");

		const hConnection = this.m_hConnection;
		const OpenRequest = this.m_OpenRequest;
		const ExecuteStatement = (strStatement, StatementCallback) => {
			if ((OpenRequest !== null) && (OpenRequest.Complete === Callback)) {
				RunOpenRequest(OpenRequest, Execute, [hConnection, strStatement, {}], Options, StatementCallback);
				return;
			}

			Execute(hConnection, strStatement, {}, Options, StatementCallback);
		};

		this.m_bSchemaReady = false;
		ExecuteStatement(strObjectTableStatement, (ObjectTableError) => {
			if (ObjectTableError !== null) {
				Callback(ObjectTableError);
				return;
			}

			ExecuteStatement(strPermissionTableStatement, (PermissionTableError) => {
				if (PermissionTableError !== null) {
					Callback(PermissionTableError);
					return;
				}

				ExecuteStatement(strParentTableStatement, (ParentTableError) => {
					if (ParentTableError !== null) {
						Callback(ParentTableError);
						return;
					}

					this.m_bSchemaReady = true;
					Callback(null, true);
				});
			});
		});
	}

	RunTransaction(Options, Transaction, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("SQLBackend.RunTransaction expects an options object.");
		}

		if (typeof Transaction !== "function") {
			throw new TypeError("SQLBackend.RunTransaction expects a transaction function.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("SQLBackend.RunTransaction expects a callback function.");
		}

		this.Open(Options, (OpenError, hConnection) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			let bBeginCompleted = false;
			const CompleteBegin = (BeginError) => {
				if (bBeginCompleted) {
					return;
				}

				bBeginCompleted = true;

				if (BeginError !== null) {
					Callback(NormalizeSQLOperationError(BeginError, "SQLBackend.RunTransaction.Begin"));
					return;
				}

				let bTransactionCompleted = false;
				const RollbackTransaction = (TransactionError, strFailureMessage) => {
					let bRollbackCompleted = false;
					const CompleteRollback = (RollbackError) => {
						if (bRollbackCompleted) {
							return;
						}

						bRollbackCompleted = true;

						if (RollbackError !== null) {
							Callback(new AggregateError([TransactionError, NormalizeSQLOperationError(RollbackError, "SQLBackend.RunTransaction.Rollback")], strFailureMessage));
							return;
						}

						Callback(TransactionError);
					};

					try {
						Rollback(hConnection, Options, CompleteRollback);
					} catch (Exception) {
						if (bRollbackCompleted) {
							throw Exception;
						}

						CompleteRollback(NormalizeSQLOperationError(Exception, "SQLBackend.RunTransaction.Rollback"));
					}
				};

				const CompleteTransaction = (TransactionError, TransactionResult) => {
					if (bTransactionCompleted) {
						return;
					}

					bTransactionCompleted = true;

					if (TransactionError !== null) {
						RollbackTransaction(NormalizeSQLOperationError(TransactionError, "SQLBackend.RunTransaction"), "SQL transaction and rollback both failed.");
						return;
					}

					let bCommitCompleted = false;
					const CompleteCommit = (CommitError) => {
						if (bCommitCompleted) {
							return;
						}

						bCommitCompleted = true;

						if (CommitError !== null) {
							RollbackTransaction(NormalizeSQLOperationError(CommitError, "SQLBackend.RunTransaction.Commit"), "SQL commit and rollback both failed.");
							return;
						}

						Callback(null, TransactionResult);
					};

					try {
						Commit(hConnection, Options, CompleteCommit);
					} catch (Exception) {
						if (bCommitCompleted) {
							throw Exception;
						}

						CompleteCommit(NormalizeSQLOperationError(Exception, "SQLBackend.RunTransaction.Commit"));
					}
				};

				try {
					Transaction(hConnection, Options, CompleteTransaction);
				} catch (Exception) {
					if (bTransactionCompleted) {
						throw Exception;
					}

					CompleteTransaction(NormalizeSQLOperationError(Exception, "SQLBackend.RunTransaction"));
				}
			};

			try {
				Begin(hConnection, Options, CompleteBegin);
			} catch (Exception) {
				if (bBeginCompleted) {
					throw Exception;
				}

				CompleteBegin(NormalizeSQLOperationError(Exception, "SQLBackend.RunTransaction.Begin"));
			}
		});
	}

	UpdateSQLiteSchema(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.UpdateSQLiteSchema");

		const Update = (hConnection, RequestOptions, Complete) => {
			// The primary key starts with the parent; membership replacement and removal look up the child.
			Execute(hConnection, `CREATE INDEX IF NOT EXISTS ${g_strParentChildIndex} ON ${g_strParentTable} (child_identifier, child_type)`, {}, RequestOptions, (Failure) => {
				Complete(Failure, Failure === null);
			});
		};

		this.RunTransaction(Options, Update, Callback);
	}

	EnsureObject(hConnection, strIdentifier, strObjectType, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.EnsureObject");

		const strObjectIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strSelectedObjectType = RequireObjectType(strObjectType);
		const StatementParameters = { identifier: strObjectIdentifier, type: strSelectedObjectType };

		Query(hConnection, `SELECT identifier FROM ${g_strObjectTable} WHERE identifier = :identifier AND object_type = :type`, StatementParameters, Options, (QueryError, vecMatchingRows) => {
			if (QueryError !== null) {
				Callback(QueryError);
				return;
			}

			if (vecMatchingRows.length !== 0) {
				Callback(null);
				return;
			}

			Execute(hConnection, `INSERT INTO ${g_strObjectTable} (identifier, object_type) VALUES (:identifier, :type)`, StatementParameters, Options, Callback);
		});
	}

	CreateAuthorizationObject(strIdentifier, strObjectType, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.CreateAuthorizationObject");
		const strObjectIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strSelectedObjectType = RequireObjectType(strObjectType);
		this.RunTransaction(Options, (hConnection, RequestOptions, Complete) => {
			this.EnsureObject(hConnection, strObjectIdentifier, strSelectedObjectType, RequestOptions, (Failure) => Complete(Failure, Failure === null));
		}, Callback);
	}

	DeleteAuthorizationObject(strIdentifier, strObjectType, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.DeleteAuthorizationObject");
		const strObjectIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strSelectedObjectType = RequireObjectType(strObjectType);
		const Parameters = { Identifier: strObjectIdentifier, ObjectType: strSelectedObjectType };
		const strDeleteChildren = (strSelectedObjectType === "Parent") ? " OR parent_identifier = :ParentIdentifier" : "";
		const RelationParameters = (strSelectedObjectType === "Parent") ? { ...Parameters, ParentIdentifier: strObjectIdentifier } : Parameters;
		this.RunTransaction(Options, (hConnection, RequestOptions, Complete) => {
			Execute(hConnection, `DELETE FROM ${g_strParentTable} WHERE (child_identifier = :Identifier AND child_type = :ObjectType)${strDeleteChildren}`, RelationParameters, RequestOptions, (RelationError) => {
				if (RelationError !== null) {
					Complete(RelationError);
					return;
				}

				Execute(hConnection, `DELETE FROM ${g_strPermissionTable} WHERE object_identifier = :Identifier AND object_type = :ObjectType`, Parameters, RequestOptions, (PermissionError) => {
					if (PermissionError !== null) {
						Complete(PermissionError);
						return;
					}

					Execute(hConnection, `DELETE FROM ${g_strObjectTable} WHERE identifier = :Identifier AND object_type = :ObjectType`, Parameters, RequestOptions, (ObjectError, nAffectedRows) => Complete(ObjectError, nAffectedRows > 0));
				});
			});
		}, Callback);
	}

	ReplacePlayerParents(strPlayerIdentifier, vecParentNames, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ReplacePlayerParents");
		const strIdentifier = RequireText(strPlayerIdentifier, "Auth player identifier");
		if (!Array.isArray(vecParentNames) || (vecParentNames.length > 32)) {
			throw new TypeError("SQLBackend.ReplacePlayerParents expects up to 32 group names.");
		}

		const vecGroups = [...new Set(vecParentNames.map((strName) => RequireText(strName, "Parent name")))];
		this.RunTransaction(Options, (hConnection, RequestOptions, Complete) => {
			this.EnsureObject(hConnection, strIdentifier, "Player", RequestOptions, (EnsureError) => {
				if (EnsureError !== null) {
					Complete(EnsureError);
					return;
				}

				Execute(hConnection, `DELETE FROM ${g_strParentTable} WHERE child_identifier = :Identifier AND child_type = 'Player'`, { Identifier: strIdentifier }, RequestOptions, (DeleteError) => {
					if (DeleteError !== null) {
						Complete(DeleteError);
						return;
					}

					let unIndex = 0;
					const InsertNext = (InsertError) => {
						if (InsertError !== null) {
							Complete(InsertError);
							return;
						}

						if (unIndex === vecGroups.length) {
							Complete(null, true);
							return;
						}

						const strParentName = vecGroups[unIndex++];
						Query(hConnection, `SELECT identifier FROM ${g_strObjectTable} WHERE identifier = :Identifier AND object_type = 'Parent'`, { Identifier: strParentName }, RequestOptions, (QueryError, vecRows) => {
							if (QueryError !== null) {
								Complete(QueryError);
								return;
							}

							if (vecRows.length !== 1) {
								Complete(new Error("An assigned authorization group does not exist."));
								return;
							}

							this.InsertParent(hConnection, strIdentifier, "Player", strParentName, RequestOptions, InsertNext);
						});
					};
					InsertNext(null);
				});
			});
		}, Callback);
	}

	Load(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Load");

		this.Open(Options, (OpenError) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			this.m_bLoaded = true;
			this.Synchronize(Options, Callback);
		});
	}

	Unload(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Unload");

		if (this.m_bOpening) {
			// Finish the tracked opening before closing any handle it creates.
			this.Open(Options, () => {
				this.Unload(Options, Callback);
			});
			return;
		}

		if (this.m_hConnection === null) {
			this.m_bSchemaReady = false;
			this.m_bLoaded = false;
			Callback(null, true);
			return;
		}

		Close(this.m_hConnection, Options, (CloseError) => {
			if (CloseError !== null) {
				Callback(CloseError);
				return;
			}

			this.m_hConnection = null;
			this.m_bSchemaReady = false;
			this.m_bLoaded = false;
			Callback(null, true);
		});
	}

	Reload(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Reload");

		this.Unload(Options, (UnloadError) => {
			if (UnloadError !== null) {
				Callback(UnloadError);
				return;
			}

			this.Load(Options, Callback);
		});
	}

	Synchronize(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Synchronize");

		this.ReadState(Options, (ReadError, AuthorizationState) => {
			if (ReadError !== null) {
				Callback(ReadError);
				return;
			}

			try {
				this.SynchronizeManager(AuthorizationState);
			} catch (Exception) {
				Callback(NormalizeSQLOperationError(Exception, "SQLBackend.Synchronize"));
				return;
			}

			Callback(null, AuthorizationState);
		});
	}

	Save(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Save");

		this.Synchronize(Options, Callback);
	}

	Path() {
		return this.m_strDatabasePath ?? GetDefaultDatabasePath();
	}

	ReadState(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ReadState");

		this.Open(Options, (OpenError, hConnection) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			const AuthorizationState = {
				Parents: {},
				Players: {},
			};
			const EnsureRecord = (RecordsByIdentifier, strIdentifier) => {
				if (Object.prototype.hasOwnProperty.call(RecordsByIdentifier, strIdentifier)) {
					return RecordsByIdentifier[strIdentifier];
				}

				const AuthorizationRecord = CreateEmptyRecord(strIdentifier);
				Object.defineProperty(RecordsByIdentifier, strIdentifier, { configurable: true, enumerable: true, value: AuthorizationRecord, writable: true });

				return AuthorizationRecord;
			};

			const ReadRows = (strStatement, StatementParameters, ProcessRow, CompletionCallback) => {
				Query(hConnection, strStatement, StatementParameters, Options, (QueryError, vecRows) => {
					if (QueryError !== null) {
						CompletionCallback(QueryError);
						return;
					}

					try {
						for (const Row of vecRows) {
							ProcessRow(Row);
						}
					} catch (Exception) {
						CompletionCallback(NormalizeSQLOperationError(Exception, "SQLBackend.ReadState"));
						return;
					}

					CompletionCallback(null);
				});
			};

			const ReadParentRelationships = () => {
				ReadRows(
					`SELECT parent_identifier, child_identifier, child_type FROM ${g_strParentTable}`,
					{},
					(Row) => {
						const strParentName = RequireText(GetRowValue(Row, "parent_identifier"), "SOCI parent identifier");
						const strChildName = RequireText(GetRowValue(Row, "child_identifier"), "SOCI child identifier");
						const strChildType = RequireText(GetRowValue(Row, "child_type"), "SOCI child type");
						if ((strChildType !== "Player") && (strChildType !== "Parent")) {
							throw new Error(`SOCI child type '${strChildType}' is invalid.`);
						}

						const RecordsByIdentifier = (strChildType === "Player") ? AuthorizationState.Players : AuthorizationState.Parents;
						const ChildRecord = EnsureRecord(RecordsByIdentifier, strChildName);

						EnsureRecord(AuthorizationState.Parents, strParentName);
						AddUnique(ChildRecord.Parents, strParentName);
					},
					(ReadError) => {
						if (ReadError !== null) {
							Callback(ReadError);
							return;
						}

						Callback(null, AuthorizationState);
					}
				);
			};

			const ReadPermissionRecords = () => {
				const nServerID = (this.m_Manager === null) ? -1 : this.m_Manager.ServerID;
				if (!Number.isInteger(nServerID)) {
					Callback(new TypeError("Auth manager ServerID must be an integer."));
					return;
				}

				const strPermissionStatement = `SELECT object_identifier, object_type, permission FROM ${g_strPermissionTable} WHERE server_id = -1 OR server_id = :ServerID`;
				ReadRows(
					strPermissionStatement,
					{ ServerID: nServerID },
					(Row) => {
						const strIdentifier = RequireText(GetRowValue(Row, "object_identifier"), "SOCI object identifier");
						const strObjectType = RequireText(GetRowValue(Row, "object_type"), "SOCI object type");
						if ((strObjectType !== "Player") && (strObjectType !== "Parent")) {
							throw new Error(`SOCI object type '${strObjectType}' is invalid.`);
						}

						const RecordsByIdentifier = (strObjectType === "Player") ? AuthorizationState.Players : AuthorizationState.Parents;
						const AuthorizationRecord = EnsureRecord(RecordsByIdentifier, strIdentifier);
						AddUnique(AuthorizationRecord.Permissions, RequireText(GetRowValue(Row, "permission"), "SOCI permission"));
					},
					(ReadError) => {
						if (ReadError !== null) {
							Callback(ReadError);
							return;
						}

						ReadParentRelationships();
					}
				);
			};

			const ReadObjects = () => {
				ReadRows(
					`SELECT identifier, object_type FROM ${g_strObjectTable}`,
					{},
					(Row) => {
						const strIdentifier = RequireText(GetRowValue(Row, "identifier"), "SOCI identifier");
						const strObjectType = RequireText(GetRowValue(Row, "object_type"), "SOCI object type");
						if ((strObjectType !== "Player") && (strObjectType !== "Parent")) {
							throw new Error(`SOCI object type '${strObjectType}' is invalid.`);
						}

						const RecordsByIdentifier = (strObjectType === "Player") ? AuthorizationState.Players : AuthorizationState.Parents;
						EnsureRecord(RecordsByIdentifier, strIdentifier);
					},
					(ReadError) => {
						if (ReadError !== null) {
							Callback(ReadError);
							return;
						}

						ReadPermissionRecords();
					}
				);
			};

			ReadObjects();
		});
	}

	SynchronizeManager(AuthorizationState) {
		if (this.m_Manager === null) {
			return AuthorizationState;
		}

		this.m_Manager.m_mapParents.Clear();
		this.m_Manager.m_mapPlayers.Clear();

		const Options = {};
		const Callback = () => {
		};

		for (const strParentName of Object.keys(AuthorizationState.Parents)) {
			this.m_Manager.m_mapParents.GetOrCreate(strParentName);
		}

		for (const [strParentName, ParentRecord] of Object.entries(AuthorizationState.Parents)) {
			const ParentNode = this.m_Manager.m_mapParents.GetOrCreate(strParentName);
			for (const strPermission of ParentRecord.Permissions) {
				ParentNode.Add(strPermission, Options, Callback, null, false);
			}

			for (const strInheritedParentName of ParentRecord.Parents) {
				ParentNode.AddParent(strInheritedParentName, Options, Callback, false);
			}
		}

		for (const [strPlayerIdentifier, PlayerRecord] of Object.entries(AuthorizationState.Players)) {
			const PlayerNode = this.m_Manager.m_mapPlayers.GetOrCreate(strPlayerIdentifier);
			if (PlayerNode === null) {
				throw new TypeError(`SQL auth player identifier '${strPlayerIdentifier}' is invalid.`);
			}

			for (const strPermission of PlayerRecord.Permissions) {
				PlayerNode.Add(strPermission, Options, Callback, null, false);
			}

			for (const strParentName of PlayerRecord.Parents) {
				PlayerNode.AddParent(strParentName, Options, Callback, false);
			}
		}

		return AuthorizationState;
	}

	Players(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Players");

		this.ReadState(Options, (ReadError, AuthorizationState) => {
			if (ReadError !== null) {
				Callback(ReadError);
				return;
			}

			Callback(null, AuthorizationState.Players);
		});
	}

	Parents(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.Parents");

		this.ReadState(Options, (ReadError, AuthorizationState) => {
			if (ReadError !== null) {
				Callback(ReadError);
				return;
			}

			Callback(null, AuthorizationState.Parents);
		});
	}

	GetPlayer(Subject, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.GetPlayer");

		const strPlayerIdentifier = GetSubjectIdentifier(Subject);
		this.Players(Options, (PlayersError, PlayersByIdentifier) => {
			if (PlayersError !== null) {
				Callback(PlayersError);
				return;
			}

			const PlayerNode = Object.prototype.hasOwnProperty.call(PlayersByIdentifier, strPlayerIdentifier) ? PlayersByIdentifier[strPlayerIdentifier] : null;
			Callback(null, PlayerNode);
		});
	}

	GetParent(strName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.GetParent");

		const strParentName = RequireText(strName, "Parent name");
		this.Parents(Options, (ParentsError, ParentsByName) => {
			if (ParentsError !== null) {
				Callback(ParentsError);
				return;
			}

			const ParentNode = Object.prototype.hasOwnProperty.call(ParentsByName, strParentName) ? ParentsByName[strParentName] : null;
			Callback(null, ParentNode);
		});
	}

	HasPlayerPermission(Subject, strPermission, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.HasPlayerPermission");

		const strPlayerIdentifier = GetSubjectIdentifier(Subject);
		const strRequiredPermission = RequireText(strPermission, "Permission");
		this.ReadState(Options, (ReadError, AuthorizationState) => {
			if (ReadError !== null) {
				Callback(ReadError);
				return;
			}

			let bHasPermission = false;
			try {
				if (Object.prototype.hasOwnProperty.call(AuthorizationState.Players, strPlayerIdentifier)) {
					const PlayerRecord = AuthorizationState.Players[strPlayerIdentifier];
					if (PlayerRecord !== undefined) {
						for (const strStoredPermission of PlayerRecord.Permissions) {
							if (CompilePermission(strStoredPermission).test(strRequiredPermission)) {
								bHasPermission = true;
								break;
							}
						}

						if (!bHasPermission) {
							const setVisitedParentNames = new Set();
							for (const strParentName of PlayerRecord.Parents) {
								if (HasRecordPermission(AuthorizationState.Parents, strParentName, strRequiredPermission, setVisitedParentNames)) {
									bHasPermission = true;
									break;
								}
							}
						}
					}
				}
			} catch (Exception) {
				Callback(NormalizeSQLOperationError(Exception, "SQLBackend.HasPlayerPermission"));
				return;
			}

			Callback(null, bHasPermission);
		});
	}

	HasParentPermission(strName, strPermission, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.HasParentPermission");

		const strParentName = RequireText(strName, "Parent name");
		const strRequiredPermission = RequireText(strPermission, "Permission");
		this.Parents(Options, (ParentsError, ParentsByName) => {
			if (ParentsError !== null) {
				Callback(ParentsError);
				return;
			}

			let bHasPermission = false;
			try {
				bHasPermission = HasRecordPermission(ParentsByName, strParentName, strRequiredPermission);
			} catch (Exception) {
				Callback(NormalizeSQLOperationError(Exception, "SQLBackend.HasParentPermission"));
				return;
			}

			Callback(null, bHasPermission);
		});
	}

	PermissionAdded(Node, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.PermissionAdded");

		const ObjectDescriptor = GetNodeDescriptor(Node);
		this.AddPermission(ObjectDescriptor.Identifier, ObjectDescriptor.Type, strPermission, nServerID, Options, Callback);
	}

	PermissionRemoved(Node, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.PermissionRemoved");

		const ObjectDescriptor = GetNodeDescriptor(Node);
		this.RemovePermission(ObjectDescriptor.Identifier, ObjectDescriptor.Type, strPermission, nServerID, Options, Callback);
	}

	ParentAdded(Node, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ParentAdded");

		const ObjectDescriptor = GetNodeDescriptor(Node);
		this.AddParent(ObjectDescriptor.Identifier, ObjectDescriptor.Type, strParentName, Options, Callback);
	}

	ParentRemoved(Node, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ParentRemoved");

		const ObjectDescriptor = GetNodeDescriptor(Node);
		this.RemoveParent(ObjectDescriptor.Identifier, ObjectDescriptor.Type, strParentName, Options, Callback);
	}

	AddPermission(strIdentifier, strObjectType, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddPermission");

		const strSelectPermissionStatement = [
			`SELECT permission FROM ${g_strPermissionTable}`,
			"WHERE object_identifier = :Identifier",
			"AND object_type = :Type",
			"AND server_id = :ServerID",
			"AND permission = :Permission",
		].join(" ");
		const strInsertPermissionStatement = [
			`INSERT INTO ${g_strPermissionTable} (object_identifier, object_type, server_id, permission)`,
			"VALUES (:Identifier, :Type, :ServerID, :Permission)",
		].join(" ");

		const strObjectIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strPermissionName = RequireText(strPermission, "Permission");
		const strSelectedObjectType = RequireObjectType(strObjectType);
		const nSelectedServerID = RequireServerID(nServerID);

		this.RunTransaction(Options, (hConnection, TransactionOptions, CompleteTransaction) => {
			this.EnsureObject(hConnection, strObjectIdentifier, strSelectedObjectType, TransactionOptions, (EnsureError) => {
				if (EnsureError !== null) {
					CompleteTransaction(EnsureError);
					return;
				}

				const StatementParameters = { Identifier: strObjectIdentifier, Permission: strPermissionName, ServerID: nSelectedServerID, Type: strSelectedObjectType };
				Query(hConnection, strSelectPermissionStatement, StatementParameters, TransactionOptions, (QueryError, vecMatchingRows) => {
					if (QueryError !== null) {
						CompleteTransaction(QueryError);
						return;
					}

					if (vecMatchingRows.length !== 0) {
						CompleteTransaction(null, true);
						return;
					}

					Execute(hConnection, strInsertPermissionStatement, StatementParameters, TransactionOptions, (ExecuteError) => {
						if (ExecuteError !== null) {
							CompleteTransaction(ExecuteError);
							return;
						}

						CompleteTransaction(null, true);
					});
				});
			});
		}, Callback);
	}

	RemovePermission(strIdentifier, strObjectType, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemovePermission");

		const strDeletePermissionStatement = [
			`DELETE FROM ${g_strPermissionTable}`,
			"WHERE object_identifier = :Identifier",
			"AND object_type = :Type",
			"AND server_id = :ServerID",
			"AND permission = :Permission",
		].join(" ");

		const StatementParameters = {
			Identifier: RequireText(strIdentifier, "Auth object identifier"),
			Permission: RequireText(strPermission, "Permission"),
			ServerID: RequireServerID(nServerID),
			Type: RequireObjectType(strObjectType),
		};

		this.Open(Options, (OpenError, hConnection) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			Execute(hConnection, strDeletePermissionStatement, StatementParameters, Options, (ExecuteError, nAffectedRowCount) => {
				if (ExecuteError !== null) {
					Callback(ExecuteError);
					return;
				}

				Callback(null, nAffectedRowCount > 0);
			});
		});
	}

	AddParent(strIdentifier, strObjectType, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddParent");

		const strSelectParentStatement = [
			`SELECT parent_identifier FROM ${g_strParentTable}`,
			"WHERE parent_identifier = :ParentIdentifier",
			"AND child_identifier = :ChildIdentifier",
			"AND child_type = :ChildType",
		].join(" ");
		const strInsertParentStatement = [
			`INSERT INTO ${g_strParentTable} (parent_identifier, child_identifier, child_type)`,
			"VALUES (:ParentIdentifier, :ChildIdentifier, :ChildType)",
		].join(" ");

		const strChildIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strChildType = RequireObjectType(strObjectType);
		const strParentIdentifier = RequireText(strParentName, "Parent name");

		this.RunTransaction(Options, (hConnection, TransactionOptions, CompleteTransaction) => {
			this.EnsureObject(hConnection, strChildIdentifier, strChildType, TransactionOptions, (ChildObjectError) => {
				if (ChildObjectError !== null) {
					CompleteTransaction(ChildObjectError);
					return;
				}

				this.EnsureObject(hConnection, strParentIdentifier, "Parent", TransactionOptions, (ParentObjectError) => {
					if (ParentObjectError !== null) {
						CompleteTransaction(ParentObjectError);
						return;
					}

					const StatementParameters = { ChildIdentifier: strChildIdentifier, ChildType: strChildType, ParentIdentifier: strParentIdentifier };
					Query(hConnection, strSelectParentStatement, StatementParameters, TransactionOptions, (QueryError, vecMatchingRows) => {
						if (QueryError !== null) {
							CompleteTransaction(QueryError);
							return;
						}

						if (vecMatchingRows.length !== 0) {
							CompleteTransaction(null, true);
							return;
						}

						Execute(hConnection, strInsertParentStatement, StatementParameters, TransactionOptions, (ExecuteError) => {
							if (ExecuteError !== null) {
								CompleteTransaction(ExecuteError);
								return;
							}

							CompleteTransaction(null, true);
						});
					});
				});
			});
		}, Callback);
	}

	RemoveParent(strIdentifier, strObjectType, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemoveParent");

		const strDeleteParentStatement = [
			`DELETE FROM ${g_strParentTable}`,
			"WHERE parent_identifier = :ParentIdentifier",
			"AND child_identifier = :ChildIdentifier",
			"AND child_type = :ChildType",
		].join(" ");

		const StatementParameters = {
			ChildIdentifier: RequireText(strIdentifier, "Auth object identifier"),
			ChildType: RequireObjectType(strObjectType),
			ParentIdentifier: RequireText(strParentName, "Parent name"),
		};

		this.Open(Options, (OpenError, hConnection) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			Execute(hConnection, strDeleteParentStatement, StatementParameters, Options, (ExecuteError, nAffectedRowCount) => {
				if (ExecuteError !== null) {
					Callback(ExecuteError);
					return;
				}

				Callback(null, nAffectedRowCount > 0);
			});
		});
	}

	AddPlayerPermission(Subject, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddPlayerPermission");

		this.AddPermission(GetSubjectIdentifier(Subject), "Player", strPermission, nServerID, Options, Callback);
	}

	RemovePlayerPermission(Subject, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemovePlayerPermission");

		this.RemovePermission(GetSubjectIdentifier(Subject), "Player", strPermission, nServerID, Options, Callback);
	}

	AddPlayerParent(Subject, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddPlayerParent");

		this.AddParent(GetSubjectIdentifier(Subject), "Player", strParentName, Options, Callback);
	}

	RemovePlayerParent(Subject, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemovePlayerParent");

		this.RemoveParent(GetSubjectIdentifier(Subject), "Player", strParentName, Options, Callback);
	}

	AddParentPermission(strParentName, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddParentPermission");

		this.AddPermission(RequireText(strParentName, "Parent name"), "Parent", strPermission, nServerID, Options, Callback);
	}

	RemoveParentPermission(strParentName, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemoveParentPermission");

		this.RemovePermission(RequireText(strParentName, "Parent name"), "Parent", strPermission, nServerID, Options, Callback);
	}

	AddParentParent(strParentName, strInheritedParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.AddParentParent");

		this.AddParent(RequireText(strParentName, "Parent name"), "Parent", strInheritedParentName, Options, Callback);
	}

	RemoveParentParent(strParentName, strInheritedParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.RemoveParentParent");

		this.RemoveParent(RequireText(strParentName, "Parent name"), "Parent", strInheritedParentName, Options, Callback);
	}

	ExportFlatFile(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ExportFlatFile");

		this.ReadState(Options, (ReadError, AuthorizationState) => {
			if (ReadError !== null) {
				Callback(ReadError);
				return;
			}

			try {
				const CreateFlatFileRecords = (Records) => {
					const FlatFileRecords = Object.create(null);
					for (const [strIdentifier, Record] of Object.entries(Records)) {
						FlatFileRecords[strIdentifier] = { Parents: Record.Parents, Permissions: Record.Permissions };
					}

					return FlatFileRecords;
				};

				if (!EnsureDirectoryExists(AUTH_CONFIG_ROOT)) {
					throw new Error(`Unable to create authorization directory: ${AUTH_CONFIG_ROOT}`);
				}

				if (!WriteTextFile(AUTH_PLAYERS_FILE, JSON.stringify(CreateFlatFileRecords(AuthorizationState.Players), null, 2))) {
					throw new Error(`Unable to write player authorization file: ${AUTH_PLAYERS_FILE}`);
				}

				if (!WriteTextFile(AUTH_PARENTS_FILE, JSON.stringify(CreateFlatFileRecords(AuthorizationState.Parents), null, 2))) {
					throw new Error(`Unable to write parent authorization file: ${AUTH_PARENTS_FILE}`);
				}
			} catch (Exception) {
				Callback(NormalizeSQLOperationError(Exception, "SQLBackend.ExportFlatFile"));
				return;
			}

			Callback(null, AuthorizationState);
		});
	}

	ImportFlatFile(Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.ImportFlatFile");

		let PlayersByIdentifier;
		let ParentsByName;
		try {
			PlayersByIdentifier = ParseRecords(ReadTextFile(AUTH_PLAYERS_FILE), AUTH_PLAYERS_FILE);
			ParentsByName = ParseRecords(ReadTextFile(AUTH_PARENTS_FILE), AUTH_PARENTS_FILE);
		} catch (Exception) {
			Callback(NormalizeSQLOperationError(Exception, "SQLBackend.ImportFlatFile"));
			return;
		}

		this.RunTransaction(Options, (hConnection, TransactionOptions, CompleteTransaction) => {
			const vecOperations = [
				(hConnection, Options, Callback) => Execute(hConnection, `DELETE FROM ${g_strParentTable}`, {}, Options, Callback),
				(hConnection, Options, Callback) => Execute(hConnection, `DELETE FROM ${g_strPermissionTable}`, {}, Options, Callback),
				(hConnection, Options, Callback) => Execute(hConnection, `DELETE FROM ${g_strObjectTable}`, {}, Options, Callback),
			];

			for (const [strParentName, ParentRecord] of Object.entries(ParentsByName)) {
				vecOperations.push((hConnection, Options, Callback) => this.EnsureObject(hConnection, strParentName, "Parent", Options, Callback));

				for (const strPermission of ParentRecord.Permissions) {
					vecOperations.push((hConnection, Options, Callback) => this.InsertPermission(hConnection, strParentName, "Parent", strPermission, -1, Options, Callback));
				}

				for (const strInheritedParentName of ParentRecord.Parents) {
					vecOperations.push((hConnection, Options, Callback) => this.InsertParent(hConnection, strParentName, "Parent", strInheritedParentName, Options, Callback));
				}
			}

			for (const [strPlayerIdentifier, PlayerRecord] of Object.entries(PlayersByIdentifier)) {
				vecOperations.push((hConnection, Options, Callback) => this.EnsureObject(hConnection, strPlayerIdentifier, "Player", Options, Callback));

				for (const strPermission of PlayerRecord.Permissions) {
					vecOperations.push((hConnection, Options, Callback) => this.InsertPermission(hConnection, strPlayerIdentifier, "Player", strPermission, -1, Options, Callback));
				}

				for (const strParentName of PlayerRecord.Parents) {
					vecOperations.push((hConnection, Options, Callback) => this.InsertParent(hConnection, strPlayerIdentifier, "Player", strParentName, Options, Callback));
				}
			}

			let unNextOperationIndex = 0;
			let bProcessingOperations = false;
			const RunNextOperation = () => {
				if (bProcessingOperations) {
					return;
				}

				bProcessingOperations = true;

				while (unNextOperationIndex < vecOperations.length) {
					let bOperationCompleted = false;
					let OperationError = null;
					const Operation = vecOperations[unNextOperationIndex++];
					try {
						Operation(hConnection, TransactionOptions, (RequestError) => {
							if (bOperationCompleted) {
								return;
							}

							bOperationCompleted = true;
							OperationError = RequestError;

							if (bProcessingOperations) {
								return;
							}

							if (RequestError !== null) {
								CompleteTransaction(RequestError);
								return;
							}

							RunNextOperation();
						});
					} catch (Exception) {
						if (bOperationCompleted) {
							throw Exception;
						}

						bProcessingOperations = false;
						CompleteTransaction(NormalizeSQLOperationError(Exception, "SQLBackend.ImportFlatFile.Operation"));
						return;
					}

					if (!bOperationCompleted) {
						bProcessingOperations = false;
						return;
					}

					if (OperationError !== null) {
						bProcessingOperations = false;
						CompleteTransaction(OperationError);
						return;
					}
				}

				bProcessingOperations = false;
				CompleteTransaction(null, true);
			};

			RunNextOperation();
		}, (TransactionError) => {
			if (TransactionError !== null) {
				Callback(TransactionError);
				return;
			}

			this.Synchronize(Options, Callback);
		});
	}

	InsertPermission(hConnection, strIdentifier, strObjectType, strPermission, nServerID, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.InsertPermission");

		const strInsertPermissionStatement = [
			`INSERT INTO ${g_strPermissionTable} (object_identifier, object_type, server_id, permission)`,
			"VALUES (:Identifier, :Type, :ServerID, :Permission)",
		].join(" ");

		const StatementParameters = {
			Identifier: RequireText(strIdentifier, "Auth object identifier"),
			Permission: RequireText(strPermission, "Permission"),
			ServerID: RequireServerID(nServerID),
			Type: RequireObjectType(strObjectType),
		};

		Execute(hConnection, strInsertPermissionStatement, StatementParameters, Options, Callback);
	}

	InsertParent(hConnection, strIdentifier, strObjectType, strParentName, Options, Callback) {
		RequireRequestParameters(Options, Callback, "SQLBackend.InsertParent");

		const strInsertParentStatement = [
			`INSERT INTO ${g_strParentTable} (parent_identifier, child_identifier, child_type)`,
			"VALUES (:ParentIdentifier, :ChildIdentifier, :ChildType)",
		].join(" ");

		const strChildIdentifier = RequireText(strIdentifier, "Auth object identifier");
		const strChildType = RequireObjectType(strObjectType);
		const strParentIdentifier = RequireText(strParentName, "Parent name");
		const StatementParameters = { ChildIdentifier: strChildIdentifier, ChildType: strChildType, ParentIdentifier: strParentIdentifier };

		this.EnsureObject(hConnection, strParentIdentifier, "Parent", Options, (EnsureError) => {
			if (EnsureError !== null) {
				Callback(EnsureError);
				return;
			}

			Execute(hConnection, strInsertParentStatement, StatementParameters, Options, Callback);
		});
	}
}

Object.defineProperties(SQLBackend, {
	BackendName: {
		configurable: true,
		enumerable: true,
		value: "sql",
		writable: true,
	},
	Options: {
		configurable: true,
		enumerable: true,
		value: {
			BackendName: "sqlite3",
			ConnectionString: null,
			DatabasePath: null,
			Manager: null,
			URI: null,
		},
		writable: true,
	},
});

const g_SQLBackend = new SQLBackend();
Object.defineProperties(g_SQLRuntime, {
	SQL_BACKEND: {
		enumerable: true,
		value: g_SQLBackend,
	},
	SQLBackend: {
		enumerable: true,
		value: SQLBackend,
	},
});

module.exports = g_SQLRuntime;
