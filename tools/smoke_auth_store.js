#!/usr/bin/env node

"use strict";

const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strAuthorizationPath = g_Path.join(g_strPackageRoot, "auth.js");
const g_strFlatFilePath = g_Path.join(g_strPackageRoot, "auth", "backends", "flatfile.js");
const g_strSQLPath = g_Path.join(g_strPackageRoot, "auth", "backends", "sql.js");

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertJSON(ActualValue, ExpectedValue, strErrorMessage) {
	const strActualText = JSON.stringify(ActualValue);
	const strExpectedText = JSON.stringify(ExpectedValue);
	if (strActualText !== strExpectedText) {
		throw new Error(`${strErrorMessage}: expected ${strExpectedText}, got ${strActualText}`);
	}
}

function RequireText(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

const g_AuthorizationState = {
	Parents: {},
	Players: {},
};

const g_SQLState = {
	Objects: [],
	Parents: [],
	Permissions: [],
};

const g_setSQLSessions = new Set();
const g_mapVirtualFiles = new Map();
let g_unTextFileReadCount = 0;
let g_unSOCIRequestCount = 0;
let g_unNextSOCIConnection = 1;

function CloneRecord(Record) {
	return Record ? {
		Name: Record.Name,
		Parents: Record.Parents.slice(),
		Permissions: Record.Permissions.slice(),
	} : null;
}

function CloneRecords(Records) {
	return Object.fromEntries(Object.entries(Records).map(([strRecordName, AuthorizationRecord]) => [strRecordName, CloneRecord(AuthorizationRecord)]));
}

function GetOrCreateRecord(Records, strName) {
	const strRecordName = RequireText(strName, "Auth record name");
	if (!Object.prototype.hasOwnProperty.call(Records, strRecordName)) {
		Object.defineProperty(Records, strRecordName, {
			configurable: true,
			enumerable: true,
			value: { Name: strRecordName, Parents: [], Permissions: [] },
			writable: true,
		});
	}

	return Records[strRecordName];
}

function AddUnique(vecValues, strValue) {
	const strText = RequireText(strValue, "Auth value");
	if (!vecValues.includes(strText)) {
		vecValues.push(strText);
	}

	return true;
}

function RemoveValue(vecValues, strValue) {
	const nValueIndex = vecValues.indexOf(RequireText(strValue, "Auth value"));
	if (nValueIndex < 0) {
		return false;
	}

	vecValues.splice(nValueIndex, 1);

	return true;
}

function PermissionMatches(strPattern, strPermission) {
	const strEscapedPattern = RequireText(strPattern, "Permission pattern").replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, "[\\s\\S]*");

	return new RegExp(`^${strEscapedPattern}$`).test(RequireText(strPermission, "Permission"));
}

function HasRecordPermission(Records, strName, strPermission, setVisited = new Set()) {
	const strRecordName = RequireText(strName, "Auth record name");
	if (setVisited.has(strRecordName)) {
		return false;
	}

	setVisited.add(strRecordName);

	if (!Object.prototype.hasOwnProperty.call(Records, strRecordName)) {
		return false;
	}

	const CurrentRecord = Records[strRecordName];
	if (CurrentRecord.Permissions.some((strPermissionPattern) => PermissionMatches(strPermissionPattern, strPermission))) {
		return true;
	}

	return CurrentRecord.Parents.some((strParentName) => HasRecordPermission(g_AuthorizationState.Parents, strParentName, strPermission, setVisited));
}

function CreateAuthorizationRuntime(ExtraFunctions = {}) {
	const FindRecord = (Records, strName, strValueName) => {
		const strRecordName = RequireText(strName, strValueName);
		if (!Object.prototype.hasOwnProperty.call(Records, strRecordName)) {
			return null;
		}

		return Records[strRecordName];
	};

	return {
		AddParentParent(strParent, strInheritedParent) {
			return AddUnique(GetOrCreateRecord(g_AuthorizationState.Parents, strParent).Parents, strInheritedParent);
		},
		AddParentPermission(strParent, strPermission) {
			return AddUnique(GetOrCreateRecord(g_AuthorizationState.Parents, strParent).Permissions, strPermission);
		},
		AddPlayerParent(strSubject, strParent) {
			GetOrCreateRecord(g_AuthorizationState.Parents, strParent);

			return AddUnique(GetOrCreateRecord(g_AuthorizationState.Players, strSubject).Parents, strParent);
		},
		AddPlayerPermission(strSubject, strPermission) {
			return AddUnique(GetOrCreateRecord(g_AuthorizationState.Players, strSubject).Permissions, strPermission);
		},
		GetParent(strName) {
			return CloneRecord(FindRecord(g_AuthorizationState.Parents, strName, "Parent name"));
		},
		GetPlayer(strSubject) {
			return CloneRecord(FindRecord(g_AuthorizationState.Players, strSubject, "Player subject"));
		},
		HasParentPermission(strName, strPermission) {
			return HasRecordPermission(g_AuthorizationState.Parents, strName, strPermission);
		},
		HasPermission(strSubject, strPermission) {
			return this.HasPlayerPermission(strSubject, strPermission) || this.HasParentPermission(strSubject, strPermission);
		},
		HasPlayerPermission(strSubject, strPermission) {
			return HasRecordPermission(g_AuthorizationState.Players, strSubject, strPermission);
		},
		IsAuthorized(strSubject, strPermission) {
			return this.HasPermission(strSubject, strPermission);
		},
		Load() {
			return { Parents: CloneRecords(g_AuthorizationState.Parents), Players: CloneRecords(g_AuthorizationState.Players) };
		},
		NetworkID(unPlayerIndex) {
			if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex <= 0)) {
				throw new TypeError("Player index must be a positive safe integer.");
			}

			return String(unPlayerIndex);
		},
		Parents() {
			return CloneRecords(g_AuthorizationState.Parents);
		},
		Players() {
			return CloneRecords(g_AuthorizationState.Players);
		},
		Reload() {
			return this.Load();
		},
		RemoveParentParent(strParent, strInheritedParent) {
			const CurrentRecord = FindRecord(g_AuthorizationState.Parents, strParent, "Parent name");

			return CurrentRecord ? RemoveValue(CurrentRecord.Parents, strInheritedParent) : false;
		},
		RemoveParentPermission(strParent, strPermission) {
			const CurrentRecord = FindRecord(g_AuthorizationState.Parents, strParent, "Parent name");

			return CurrentRecord ? RemoveValue(CurrentRecord.Permissions, strPermission) : false;
		},
		RemovePlayerParent(strSubject, strParent) {
			const CurrentRecord = FindRecord(g_AuthorizationState.Players, strSubject, "Player subject");

			return CurrentRecord ? RemoveValue(CurrentRecord.Parents, strParent) : false;
		},
		RemovePlayerPermission(strSubject, strPermission) {
			const CurrentRecord = FindRecord(g_AuthorizationState.Players, strSubject, "Player subject");

			return CurrentRecord ? RemoveValue(CurrentRecord.Permissions, strPermission) : false;
		},
		Save() {
			return true;
		},
		...ExtraFunctions,
	};
}

function ExecuteSQL(hSOCIConnection, strSQLStatement, Parameters = {}) {
	AssertEqual(g_setSQLSessions.has(hSOCIConnection), true, "valid SOCI session");

	if (strSQLStatement.startsWith("CREATE TABLE")) {
		return 0n;
	}

	if (strSQLStatement === "DELETE FROM sourcejs_auth_parents") {
		const unPreviousCount = g_SQLState.Parents.length;
		g_SQLState.Parents = [];
		return BigInt(unPreviousCount);
	}

	if (strSQLStatement === "DELETE FROM sourcejs_auth_permissions") {
		const unPreviousCount = g_SQLState.Permissions.length;
		g_SQLState.Permissions = [];
		return BigInt(unPreviousCount);
	}

	if (strSQLStatement === "DELETE FROM sourcejs_auth_objects") {
		const unPreviousCount = g_SQLState.Objects.length;
		g_SQLState.Objects = [];
		return BigInt(unPreviousCount);
	}

	if (strSQLStatement.startsWith("INSERT INTO sourcejs_auth_objects")) {
		g_SQLState.Objects.push({ identifier: Parameters.identifier, object_type: Parameters.type });
		return 1n;
	}

	if (strSQLStatement.startsWith("INSERT INTO sourcejs_auth_permissions")) {
		g_SQLState.Permissions.push({
			object_identifier: Parameters.Identifier,
			object_type: Parameters.Type,
			permission: Parameters.Permission,
			server_id: Parameters.ServerID,
		});

		return 1n;
	}

	if (strSQLStatement.startsWith("INSERT INTO sourcejs_auth_parents")) {
		g_SQLState.Parents.push({
			child_identifier: Parameters.ChildIdentifier,
			child_type: Parameters.ChildType,
			parent_identifier: Parameters.ParentIdentifier,
		});

		return 1n;
	}

	if (strSQLStatement.startsWith("DELETE FROM sourcejs_auth_permissions WHERE")) {
		const unPreviousCount = g_SQLState.Permissions.length;
		g_SQLState.Permissions = g_SQLState.Permissions.filter((PermissionRecord) => (PermissionRecord.object_identifier !== Parameters.Identifier) || (PermissionRecord.object_type !== Parameters.Type) || (PermissionRecord.server_id !== Parameters.ServerID) || (PermissionRecord.permission !== Parameters.Permission));

		return BigInt(unPreviousCount - g_SQLState.Permissions.length);
	}

	if (strSQLStatement.startsWith("DELETE FROM sourcejs_auth_parents WHERE")) {
		const unPreviousCount = g_SQLState.Parents.length;
		g_SQLState.Parents = g_SQLState.Parents.filter((ParentRecord) => (ParentRecord.parent_identifier !== Parameters.ParentIdentifier) || (ParentRecord.child_identifier !== Parameters.ChildIdentifier) || (ParentRecord.child_type !== Parameters.ChildType));

		return BigInt(unPreviousCount - g_SQLState.Parents.length);
	}

	throw new Error(`Unexpected SQL execute statement: ${strSQLStatement}`);
}

function QuerySQL(hSOCIConnection, strSQLStatement, Parameters = {}) {
	AssertEqual(g_setSQLSessions.has(hSOCIConnection), true, "valid SOCI session");

	if (strSQLStatement === "SELECT identifier, object_type FROM sourcejs_auth_objects") {
		return g_SQLState.Objects.map((ObjectRecord) => ({ ...ObjectRecord }));
	}

	if (strSQLStatement.startsWith("SELECT identifier FROM sourcejs_auth_objects WHERE")) {
		return g_SQLState.Objects
			.filter((ObjectRecord) => (ObjectRecord.identifier === Parameters.identifier) && (ObjectRecord.object_type === Parameters.type))
			.map((ObjectRecord) => ({ identifier: ObjectRecord.identifier }));
	}

	if (strSQLStatement.startsWith("SELECT object_identifier, object_type, permission FROM sourcejs_auth_permissions")) {
		return g_SQLState.Permissions
			.filter((PermissionRecord) => (PermissionRecord.server_id === -1) || (PermissionRecord.server_id === Parameters.ServerID))
			.map((PermissionRecord) => ({ ...PermissionRecord }));
	}

	if (strSQLStatement === "SELECT parent_identifier, child_identifier, child_type FROM sourcejs_auth_parents") {
		return g_SQLState.Parents.map((ParentRecord) => ({ ...ParentRecord }));
	}

	if (strSQLStatement.startsWith("SELECT permission FROM sourcejs_auth_permissions WHERE")) {
		return g_SQLState.Permissions
			.filter((PermissionRecord) => (PermissionRecord.object_identifier === Parameters.Identifier) && (PermissionRecord.object_type === Parameters.Type) && (PermissionRecord.server_id === Parameters.ServerID) && (PermissionRecord.permission === Parameters.Permission))
			.map((PermissionRecord) => ({ permission: PermissionRecord.permission }));
	}

	if (strSQLStatement.startsWith("SELECT parent_identifier FROM sourcejs_auth_parents WHERE")) {
		return g_SQLState.Parents
			.filter((ParentRecord) => (ParentRecord.parent_identifier === Parameters.ParentIdentifier) && (ParentRecord.child_identifier === Parameters.ChildIdentifier) && (ParentRecord.child_type === Parameters.ChildType))
			.map((ParentRecord) => ({ parent_identifier: ParentRecord.parent_identifier }));
	}

	throw new Error(`Unexpected SQL query statement: ${strSQLStatement}`);
}

const g_NativePaths = {
	AUTH_CONFIG_ROOT: "cfg/sourcejs/auth",
	AUTH_PARENTS_FILE: "cfg/sourcejs/auth/parents.json",
	AUTH_PLAYERS_FILE: "cfg/sourcejs/auth/players.json",
	AUTH_SQL_FILE: "cfg/sourcejs/auth/permissions.sqlite3",
};

const g_NativeAuthorization = CreateAuthorizationRuntime();

const g_NativeSQLAuthorization = CreateAuthorizationRuntime({
	ExportFlatFile() {
		return true;
	},
	ImportFlatFile() {
		return true;
	},
	Path() {
		return g_NativePaths.AUTH_SQL_FILE;
	},
	Players() {
		return CloneRecords(g_AuthorizationState.Players);
	},
	Parents() {
		return CloneRecords(g_AuthorizationState.Parents);
	},
});

const g_NativeFilesystem = {
	EnsureDirectoryExists(strDirectoryPath) {
		RequireText(strDirectoryPath, "Directory path");

		return true;
	},
	ReadTextFile(strFilePath) {
		RequireText(strFilePath, "File path");
		++g_unTextFileReadCount;

		if (g_mapVirtualFiles.has(strFilePath)) {
			return g_mapVirtualFiles.get(strFilePath);
		}

		if (strFilePath === g_NativePaths.AUTH_PLAYERS_FILE) {
			return JSON.stringify(g_AuthorizationState.Players);
		}

		if (strFilePath === g_NativePaths.AUTH_PARENTS_FILE) {
			return JSON.stringify(g_AuthorizationState.Parents);
		}

		throw new Error(`Unexpected virtual file: ${strFilePath}`);
	},
	GetSeekTypes() {
		return { Current: 1, Head: 0, Tail: 2 };
	},
	WriteTextFile(strFilePath, strText) {
		RequireText(strFilePath, "File path");

		if (typeof strText !== "string") {
			throw new TypeError("File text must be a string.");
		}

		g_mapVirtualFiles.set(strFilePath, strText);

		return true;
	},
};

// Models callback timing for the auth SQL subset, not native workers, transactions, or IO.
function DispatchSOCIRequest(Options, Callback, Operation) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("SOCI mock expects an options object.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("SOCI mock expects a callback function.");
	}

	++g_unSOCIRequestCount;

	const CompleteRequest = () => {
		let Result;
		try {
			Result = Operation();
		} catch (Error) {
			Callback(Error);
			return;
		}

		Callback(null, Result);
	};

	if (Options.Blocking) {
		CompleteRequest();
		return;
	}

	setImmediate(CompleteRequest);
}

const g_SOCIMock = {
	Begin(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => g_setSQLSessions.has(hSOCIConnection));
	},
	Close(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => g_setSQLSessions.delete(hSOCIConnection));
	},
	Commit(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => g_setSQLSessions.has(hSOCIConnection));
	},
	Connect(strConnectionString, strBackendName, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => {
			RequireText(strConnectionString, "SOCI connection string");

			if (strBackendName !== undefined) {
				RequireText(strBackendName, "SOCI backend name");
			}

			const hSOCIConnection = g_unNextSOCIConnection++;
			g_setSQLSessions.add(hSOCIConnection);

			return hSOCIConnection;
		});
	},
	Execute(hSOCIConnection, strSQLStatement, Parameters, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => ExecuteSQL(hSOCIConnection, strSQLStatement, Parameters));
	},
	IsConnected(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => g_setSQLSessions.has(hSOCIConnection));
	},
	Query(hSOCIConnection, strSQLStatement, Parameters, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => QuerySQL(hSOCIConnection, strSQLStatement, Parameters));
	},
	Reconnect(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => {
			if (!Number.isSafeInteger(hSOCIConnection) || (hSOCIConnection <= 0)) {
				throw new TypeError("SOCI handle must be a positive safe integer.");
			}

			g_setSQLSessions.add(hSOCIConnection);

			return true;
		});
	},
	Rollback(hSOCIConnection, Options, Callback) {
		DispatchSOCIRequest(Options, Callback, () => g_setSQLSessions.has(hSOCIConnection));
	},
};

globalThis.sourcejs = {
	auth: g_NativeAuthorization,
	"auth/backends/sql": g_NativeSQLAuthorization,
	filesystem: g_NativeFilesystem,
	paths: g_NativePaths,
};

const g_OriginalModuleLoad = g_Module._load;

g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "soci") {
		return g_SOCIMock;
	}

	if (strRequestName === "steam") {
		// The manager integration cases use decimal IDs; native Steam parsing is out of scope here.
		return {
			SteamID: {
				Parse(strSteamID64) {
					const unSteamID64 = BigInt(strSteamID64);

					return { ConvertSteamIDToUInt64: () => unSteamID64 };
				},
			},
		};
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

function CheckSQLPermissionTraversal() {
	const strSource = g_FileSystem.readFileSync(g_strSQLPath, "utf8");
	const nClassOffset = strSource.indexOf("class SQLBackend extends Backend");
	AssertEqual(nClassOffset > 0, true, "SQL helper prefix must end before the class");

	const Helpers = new Function("require", strSource.slice(0, nClassOffset) + "return { CompilePermission, HasRecordPermission };")(() => ({ GetModule: () => ({}) }));
	const vecPatterns = ["permission", "*", "a*b", "a?b", "a.b", "a[b]", "a\\b", "a^b$", "a+b", "a|b", "a(b)", "a{b}", "a\nb", "a\0b", "é*", "**x*", "*suffix"];
	const vecQueries = ["", "permission", "permission\n", "permission\r", "permission\r\n", "permission\u2028", "permission\u2029", "xpermission", "a*b", "ab", "a\nb", "a\0b", "a?b", "a.b", "a[b]", "a\\b", "a^b$", "a+b", "a|b", "a(b)", "a{b}", "é🙂", "x", "suffix", "\0", "a", "\n", "**"];
	let unMatchCaseCount = 0;
	let unTraversalCaseCount = 0;

	function MatchesWildcard(strPattern, strValue) {
		let unPatternIndex = 0;
		let unValueIndex = 0;
		let nLastStarIndex = -1;
		let unRetryIndex = 0;
		while (unValueIndex < strValue.length) {
			if (strPattern[unPatternIndex] === "*") {
				nLastStarIndex = unPatternIndex++;
				unRetryIndex = unValueIndex;
				continue;
			}

			if (strPattern[unPatternIndex] === strValue[unValueIndex]) {
				unPatternIndex++;
				unValueIndex++;
				continue;
			}

			if (nLastStarIndex < 0) {
				return false;
			}

			unPatternIndex = nLastStarIndex + 1;
			unValueIndex = ++unRetryIndex;
		}

		while (strPattern[unPatternIndex] === "*") {
			unPatternIndex++;
		}

		return unPatternIndex === strPattern.length;
	}

	for (const strPattern of vecPatterns) {
		for (const strQuery of vecQueries) {
			AssertEqual(Helpers.CompilePermission(strPattern).test(strQuery), MatchesWildcard(strPattern, strQuery), "SQL full-string wildcard matching");
			unMatchCaseCount++;
		}
	}

	const Records = Object.create(null);
	const unDepth = 20000;
	for (let unIndex = 0; unIndex < unDepth; unIndex++) {
		Records["Parent" + unIndex] = { Permissions: [], Parents: (unIndex === (unDepth - 1)) ? [] : ["Parent" + (unIndex + 1)] };
	}

	Records["Parent" + (unDepth - 1)].Permissions.push("permission");
	AssertEqual(Helpers.HasRecordPermission(Records, "Parent0", "permission"), true, "deep graph reaches the granting parent without recursion overflow");
	AssertEqual(Helpers.HasRecordPermission(Records, "Parent0", "denied"), false, "deep graph safely exhausts");
	Records["Parent" + (unDepth - 1)].Parents.push("Parent0");
	AssertEqual(Helpers.HasRecordPermission(Records, "Parent0", "denied"), false, "deep graph cycle terminates");
	AssertEqual(Helpers.HasRecordPermission(Records, "Parent0", "permission", new Set(["Parent0"])), false, "caller visited seed is respected");
	unTraversalCaseCount += 4;

	const vecTrace = [];
	function* EnumerateParents(strName, vecNames) {
		try {
			for (const strParentName of vecNames) {
				vecTrace.push("Next:" + strName + ":" + strParentName);
				yield strParentName;
			}
		} finally {
			vecTrace.push("Close:" + strName);
		}
	}

	const Ordered = {
		get Root() {
			vecTrace.push("Lookup:Root");

			return { Permissions: [], Parents: EnumerateParents("Root", ["Left", "Right"]) };
		},
		get Left() {
			vecTrace.push("Lookup:Left");

			return { Permissions: [], Parents: EnumerateParents("Left", ["Leaf"]) };
		},
		get Leaf() {
			vecTrace.push("Lookup:Leaf");

			return { Permissions: ["permission"], Parents: [] };
		},
		get Right() {
			throw new Error("The unneeded sibling must not be read eagerly.");
		},
	};
	const setVisited = new Set();
	AssertEqual(Helpers.HasRecordPermission(Ordered, "Root", "permission", setVisited), true, "DFS grants before inspecting a later sibling");
	AssertJSON(Array.from(setVisited), ["Root", "Left", "Leaf"], "DFS visited order is preserved");
	AssertJSON(vecTrace, ["Lookup:Root", "Next:Root:Left", "Lookup:Left", "Next:Left:Leaf", "Lookup:Leaf", "Close:Left", "Close:Root"], "lazy iteration and reverse-order close are preserved");
	unTraversalCaseCount++;

	const OpaqueFailure = {
		toString() {
			throw new Error("Traversal errors must not be coerced.");
		},
	};
	for (const Failure of [undefined, null, false, 0, NaN, Symbol("failure"), OpaqueFailure, new Error("controlled traversal failure")]) {
		for (const bClosingThrows of [false, true]) {
			let bClosed = false;
			let bFailed = false;
			let ObservedFailure;
			const Graph = {
				Root: {
					Permissions: [],
					Parents: {
						*[Symbol.iterator]() {
							try {
								yield "Bad";
							} finally {
								bClosed = true;

								if (bClosingThrows) {
									throw new Error("Secondary close failure must not mask the original throw.");
								}
							}
						},
					},
				},
				Bad: {
					get Permissions() {
						throw Failure;
					},
				},
			};
			try {
				Helpers.HasRecordPermission(Graph, "Root", "permission");
			} catch (TraversalError) {
				bFailed = true;
				ObservedFailure = TraversalError;
			}

			AssertEqual(bFailed, true, "traversal errors propagate");
			AssertEqual(Object.is(ObservedFailure, Failure), true, "original opaque failure retains identity");
			AssertEqual(bClosed, true, "ancestor parent iterator closes after child failure");
			unTraversalCaseCount++;
		}
	}

	for (const bChildGrants of [false, true]) {
		let bFailed = false;
		let ObservedFailure;
		const Graph = {
			Root: {
				Permissions: [],
				Parents: {
					*[Symbol.iterator]() {
						try {
							yield "Child";
						} finally {
							throw OpaqueFailure;
						}
					},
				},
			},
			Child: { Permissions: bChildGrants ? ["permission"] : [], Parents: [] },
		};
		try {
			Helpers.HasRecordPermission(Graph, "Root", "permission");
		} catch (TraversalError) {
			bFailed = true;
			ObservedFailure = TraversalError;
		}

		AssertEqual(bFailed, true, "iterator close failures override boolean completion");
		AssertEqual(ObservedFailure, OpaqueFailure, "close failure retains identity");
		unTraversalCaseCount++;
	}

	for (const vecArguments of [[null, "Root", "permission"], [undefined, "Root", "permission"], [{}, "Root", "permission", {}], [{}, "", "permission"], [{}, 1, "permission"], [{}, "Root", ""], [{}, "Root", null]]) {
		let bTypeError = false;
		try {
			Helpers.HasRecordPermission(...vecArguments);
		} catch (TraversalError) {
			bTypeError = TraversalError instanceof TypeError;
		}

		AssertEqual(bTypeError, true, "original traversal input validation is preserved");
		unTraversalCaseCount++;
	}

	const Inherited = Object.create({ Hidden: { Permissions: ["permission"], Parents: [] } });
	AssertEqual(Helpers.HasRecordPermission(Inherited, "Hidden", "permission"), false, "prototype records must not grant permissions");
	AssertEqual(Helpers.HasRecordPermission({ Missing: undefined }, "Missing", "permission"), false, "undefined records remain absent");
	AssertEqual(Helpers.HasRecordPermission({}, "Missing", "permission"), false, "missing records remain absent");
	unTraversalCaseCount += 3;

	console.log(`[  OK  ] SQL permission helpers ${unMatchCaseCount} wildcard cases and ${unTraversalCaseCount} DFS/deep-graph/iterator profiles passed (current source prefix only; no native IO)`);
}

function CheckFlatFileFailureCallbacks(FlatFileBackend, NativeRuntime) {
	const OpaqueFailure = {
		toString() {
			throw new Error("Failure values must not be coerced.");
		},
	};
	const vecFailures = [null, undefined, false, 0, -0, 0n, "", NaN, new Error("controlled failure"), OpaqueFailure, Symbol("failure"), "failure"];
	const Parent = { Name: "parent" };
	const Player = { SteamID64: "76561197960265729" };
	const vecMethods = [
		{ Name: "Load", Native: "Reload", Arguments: [] },
		{ Name: "Synchronize", Native: "Reload", Arguments: [] },
		{ Name: "Save", Native: "Save", Arguments: [] },
		{ Name: "PermissionAdded", Native: "AddPlayerPermission", Arguments: [Player, "example.permission", null] },
		{ Name: "PermissionAdded", Native: "AddParentPermission", Arguments: [Parent, "example.permission", null] },
		{ Name: "PermissionRemoved", Native: "RemovePlayerPermission", Arguments: [Player, "example.permission", null] },
		{ Name: "PermissionRemoved", Native: "RemoveParentPermission", Arguments: [Parent, "example.permission", null] },
		{ Name: "ParentAdded", Native: "AddPlayerParent", Arguments: [Player, "parent"] },
		{ Name: "ParentAdded", Native: "AddParentParent", Arguments: [Parent, "parent"] },
		{ Name: "ParentRemoved", Native: "RemovePlayerParent", Arguments: [Player, "parent"] },
		{ Name: "ParentRemoved", Native: "RemoveParentParent", Arguments: [Parent, "parent"] },
	];
	let unScenarioCount = 0;

	function WithNativeOperation(strName, Operation, Action) {
		const Descriptor = Object.getOwnPropertyDescriptor(NativeRuntime, strName);
		AssertEqual((Descriptor !== undefined) && Object.hasOwn(Descriptor, "value") && Descriptor.configurable, true, "controlled native method must be restorable");
		Object.defineProperty(NativeRuntime, strName, { ...Descriptor, value: Operation });

		try {
			return Action();
		} finally {
			Object.defineProperty(NativeRuntime, strName, Descriptor);
		}
	}

	for (const Method of vecMethods) {
		for (const Failure of vecFailures) {
			const BackendInstance = new FlatFileBackend();
			const vecCompletions = [];
			WithNativeOperation(Method.Native, () => {
				throw Failure;
			}, () => BackendInstance[Method.Name](...Method.Arguments, {}, (...vecArguments) => {
				vecCompletions.push(vecArguments);
			}));
			AssertEqual(vecCompletions.length, 1, "a native failure completes once");
			AssertEqual(vecCompletions[0].length, 1, "a native failure must not provide a success result");

			const OperationError = vecCompletions[0][0];
			if (Failure) {
				AssertEqual(Object.is(OperationError, Failure), true, "truthy failures retain identity");
			} else {
				AssertEqual(OperationError instanceof AggregateError, true, "falsy failures must not signal success");
				AssertEqual(OperationError.errors.length, 1, "falsy failure carrier preserves one original value");
				AssertEqual(Object.is(OperationError.errors[0], Failure), true, "original falsy failure is preserved exactly");
				AssertEqual(OperationError.message, `FlatFileBackend.${Method.Name} failed.`, "failure diagnostic identifies the operation");
			}

			AssertEqual(BackendInstance.Loaded, false, "failed load must not publish loaded state");
			unScenarioCount++;
		}

		if (Method.Native !== "Reload") {
			const BackendInstance = new FlatFileBackend();
			const vecCompletions = [];
			WithNativeOperation(Method.Native, () => false, () => BackendInstance[Method.Name](...Method.Arguments, {}, (...vecArguments) => {
				vecCompletions.push(vecArguments);
			}));
			AssertJSON(vecCompletions, [[null, false]], "false remains an explicit operation result,not an exception");
			unScenarioCount++;
		}

		for (const bNativeFailure of [false, true]) {
			const BackendInstance = new FlatFileBackend();
			let unCallbackCount = 0;
			let bCallbackThrew = false;
			WithNativeOperation(Method.Native, () => {
				if (bNativeFailure) {
					throw OpaqueFailure;
				}

				return (Method.Native === "Reload") ? { Parents: {}, Players: {} } : true;
			}, () => {
				try {
					BackendInstance[Method.Name](...Method.Arguments, {}, () => {
						unCallbackCount++;
						throw null;
					});
				} catch (CallbackError) {
					bCallbackThrew = true;
					AssertEqual(CallbackError, null, "callback exceptions propagate without wrapping");
				}
			});
			AssertEqual(bCallbackThrew, true, "callback failure must escape to caller");
			AssertEqual(unCallbackCount, 1, "callback exceptions must not trigger another callback");
			unScenarioCount++;
		}
	}

	console.log(`[  OK  ] FlatFileBackend ${unScenarioCount} falsy/opaque-error, false-result and callback-throw scenarios passed (controlled native auth methods)`);
}

try {
	const Authorization = require(g_strAuthorizationPath);
	const { FLAT_FILE_BACKEND, FlatFileBackend } = require(g_strFlatFilePath);
	const { ExportFlatFile, ImportFlatFile, Path, SQL_BACKEND, SQLBackend } = require(g_strSQLPath);
	const SQLModuleExports = require.cache[g_strSQLPath].exports;

	CheckSQLPermissionTraversal();
	CheckFlatFileFailureCallbacks(FlatFileBackend, g_NativeAuthorization);

	AssertEqual(Authorization, g_NativeAuthorization, "auth should expose the exact native object");
	AssertEqual(SQLModuleExports, g_NativeSQLAuthorization, "SQL auth should expose the exact native object");
	AssertEqual(Authorization.NetworkID(7), "7", "auth native NetworkID");
	AssertEqual(Authorization.AddParentPermission("admin", "sourcejs.admin.*"), true, "AddParentPermission");
	AssertEqual(Authorization.AddParentParent("owner", "admin"), true, "AddParentParent");
	AssertEqual(Authorization.AddPlayerParent("STEAM_1:0:1", "owner"), true, "AddPlayerParent");
	AssertEqual(Authorization.AddPlayerPermission("STEAM_1:0:1", "sourcejs.player.self"), true, "AddPlayerPermission");
	AssertEqual(Authorization.IsAuthorized("STEAM_1:0:1", "sourcejs.admin.reload"), true, "parent wildcard auth");
	AssertEqual(Authorization.HasPlayerPermission("STEAM_1:0:1", "sourcejs.player.self"), true, "direct player permission");
	AssertEqual(Authorization.HasParentPermission("owner", "sourcejs.admin.reload"), true, "parent inheritance permission");

	// This native API double must match native wildcard and full-string semantics.
	for (const strSeparator of ["\n", "\r", "\u2028", "\u2029", "\0"]) {
		AssertEqual(Authorization.HasParentPermission("owner", `sourcejs.admin.first${strSeparator}second`), true, "native double wildcard includes every character");
		AssertEqual(Authorization.HasPlayerPermission("STEAM_1:0:1", `sourcejs.admin.first${strSeparator}second`), true, "native double inherited wildcard includes every character");
		AssertEqual(Authorization.HasPlayerPermission("STEAM_1:0:1", `sourcejs.player.self${strSeparator}`), false, "native double exact permission rejects suffixes");
	}

	AssertEqual(Authorization.HasParentPermission("owner", "SOURCEJS.admin.reload"), false, "native double wildcard remains case-sensitive");
	AssertEqual(Authorization.HasParentPermission("owner", "prefix.sourcejs.admin.reload"), false, "native double wildcard remains anchored");

	AssertJSON(Authorization.GetPlayer("STEAM_1:0:1"), {
		Name: "STEAM_1:0:1",
		Parents: ["owner"],
		Permissions: ["sourcejs.player.self"],
	}, "GetPlayer clone");
	AssertEqual(Authorization.RemovePlayerPermission("STEAM_1:0:1", "sourcejs.player.self"), true, "RemovePlayerPermission");
	AssertEqual(Authorization.HasPlayerPermission("STEAM_1:0:1", "sourcejs.player.self"), false, "removed player permission");

	AssertEqual(FLAT_FILE_BACKEND instanceof FlatFileBackend, true, "flat-file singleton type");
	let FlatFileAuthorizationState;
	FLAT_FILE_BACKEND.Load({}, (Error, Result) => {
		if (Error !== null) {
			throw Error;
		}

		FlatFileAuthorizationState = Result;
	});
	AssertEqual(FlatFileAuthorizationState.Parents.owner.Name, "owner", "flat-file Load state");

	let bSaveResult;
	FLAT_FILE_BACKEND.Save({}, (Error, Result) => {
		if (Error !== null) {
			throw Error;
		}

		bSaveResult = Result;
	});
	AssertEqual(bSaveResult, true, "flat-file Save store");

	let bUnloadResult;
	FLAT_FILE_BACKEND.Unload({}, (Error, Result) => {
		if (Error !== null) {
			throw Error;
		}

		bUnloadResult = Result;
	});
	AssertEqual(bUnloadResult, true, "flat-file Unload result");
	AssertEqual(FLAT_FILE_BACKEND.Loaded, false, "flat-file Unload state");

	AssertEqual(SQL_BACKEND instanceof SQLBackend, true, "SQL singleton type");
	AssertEqual(Path(), g_NativePaths.AUTH_SQL_FILE, "native SQL database path");
	AssertEqual(ImportFlatFile(), true, "native SQL ImportFlatFile result");
	AssertEqual(ExportFlatFile(), true, "native SQL ExportFlatFile result");

	const { AuthManager } = require("auth/manager");
	const SynchronizationManager = new AuthManager();
	SynchronizationManager.m_ActiveBackend = {
		PermissionAdded() {
			throw new Error("Manager synchronization must not persist permission changes.");
		},
		ParentAdded() {
			throw new Error("Manager synchronization must not persist parent changes.");
		},
	};
	const SynchronizationBackend = new SQLBackend({ Manager: SynchronizationManager });
	const SynchronizationState = {
		Parents: {
			Admin: { Name: "Admin", Parents: [], Permissions: ["sourcejs.admin.*"] },
			Owner: { Name: "Owner", Parents: ["Admin"], Permissions: [] },
		},
		Players: {
			"76561197960265729": { Name: "76561197960265729", Parents: ["Owner"], Permissions: ["sourcejs.self"] },
		},
	};
	AssertEqual(SynchronizationBackend.SynchronizeManager(SynchronizationState), SynchronizationState, "SQL synchronization preserves the state result");
	const AdminPermissions = SynchronizationManager.m_mapParents.get("Admin");
	const OwnerPermissions = SynchronizationManager.m_mapParents.get("Owner");
	const PlayerPermissions = SynchronizationManager.m_mapPlayers.get("76561197960265729");
	AssertEqual(AdminPermissions.has("sourcejs.admin.*"), true, "SQL synchronization restores parent permissions");
	AssertEqual(OwnerPermissions.Parents.has(AdminPermissions), true, "SQL synchronization restores parent inheritance");
	AssertEqual(PlayerPermissions.has("sourcejs.self"), true, "SQL synchronization restores player permissions");
	AssertEqual(PlayerPermissions.Parents.has(OwnerPermissions), true, "SQL synchronization restores player inheritance");

	const ReplacementState = {
		Parents: {
			Observer: { Name: "Observer", Parents: [], Permissions: ["sourcejs.observe"] },
		},
		Players: {
			"76561197960265729": { Name: "76561197960265729", Parents: ["Observer"], Permissions: [] },
		},
	};
	SynchronizationBackend.SynchronizeManager(ReplacementState);
	const ReplacementPlayer = SynchronizationManager.m_mapPlayers.get("76561197960265729");
	AssertEqual(SynchronizationManager.m_mapParents.has("Admin"), false, "SQL resynchronization removes old parents");
	AssertEqual(SynchronizationManager.m_mapParents.has("Owner"), false, "SQL resynchronization removes old parent inheritance");
	AssertEqual(ReplacementPlayer.has("sourcejs.self"), false, "SQL resynchronization removes old player permissions");
	AssertEqual(ReplacementPlayer.Parents.has(OwnerPermissions), false, "SQL resynchronization removes old player inheritance");
	AssertEqual(ReplacementPlayer.Parents.has(SynchronizationManager.m_mapParents.get("Observer")), true, "SQL resynchronization restores new player inheritance");

	const ValidationBackend = new SQLBackend({ BackendName: "sqlite3", ConnectionString: "dbname=request-validation" });
	const vecRequestOperations = [
		{ Name: "Unload", Invoke: (Options, Callback) => ValidationBackend.Unload(Options, Callback) },
		{ Name: "Open", Invoke: (Options, Callback) => ValidationBackend.Open(Options, Callback) },
		{ Name: "CreateSchema", Invoke: (Options, Callback) => ValidationBackend.CreateSchema(Options, Callback) },
		{ Name: "EnsureObject", Invoke: (Options, Callback) => ValidationBackend.EnsureObject(1, "validation", "Parent", Options, Callback) },
		{ Name: "Load", Invoke: (Options, Callback) => ValidationBackend.Load(Options, Callback) },
		{ Name: "Reload", Invoke: (Options, Callback) => ValidationBackend.Reload(Options, Callback) },
		{ Name: "Synchronize", Invoke: (Options, Callback) => ValidationBackend.Synchronize(Options, Callback) },
		{ Name: "Save", Invoke: (Options, Callback) => ValidationBackend.Save(Options, Callback) },
		{ Name: "ReadState", Invoke: (Options, Callback) => ValidationBackend.ReadState(Options, Callback) },
		{ Name: "Players", Invoke: (Options, Callback) => ValidationBackend.Players(Options, Callback) },
		{ Name: "Parents", Invoke: (Options, Callback) => ValidationBackend.Parents(Options, Callback) },
		{ Name: "GetPlayer", Invoke: (Options, Callback) => ValidationBackend.GetPlayer("validation", Options, Callback) },
		{ Name: "GetParent", Invoke: (Options, Callback) => ValidationBackend.GetParent("validation", Options, Callback) },
		{ Name: "HasPlayerPermission", Invoke: (Options, Callback) => ValidationBackend.HasPlayerPermission("validation", "sourcejs.validation", Options, Callback) },
		{ Name: "HasParentPermission", Invoke: (Options, Callback) => ValidationBackend.HasParentPermission("validation", "sourcejs.validation", Options, Callback) },
		{ Name: "PermissionAdded", Invoke: (Options, Callback) => ValidationBackend.PermissionAdded(AdminPermissions, "sourcejs.validation", -1, Options, Callback) },
		{ Name: "PermissionRemoved", Invoke: (Options, Callback) => ValidationBackend.PermissionRemoved(AdminPermissions, "sourcejs.validation", -1, Options, Callback) },
		{ Name: "ParentAdded", Invoke: (Options, Callback) => ValidationBackend.ParentAdded(AdminPermissions, "Owner", Options, Callback) },
		{ Name: "ParentRemoved", Invoke: (Options, Callback) => ValidationBackend.ParentRemoved(AdminPermissions, "Owner", Options, Callback) },
		{ Name: "AddPermission", Invoke: (Options, Callback) => ValidationBackend.AddPermission("validation", "Parent", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "RemovePermission", Invoke: (Options, Callback) => ValidationBackend.RemovePermission("validation", "Parent", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "AddParent", Invoke: (Options, Callback) => ValidationBackend.AddParent("validation", "Parent", "Admin", Options, Callback) },
		{ Name: "RemoveParent", Invoke: (Options, Callback) => ValidationBackend.RemoveParent("validation", "Parent", "Admin", Options, Callback) },
		{ Name: "RunTransaction", Invoke: (Options, Callback) => ValidationBackend.RunTransaction(Options, () => {}, Callback) },
		{ Name: "AddPlayerPermission", Invoke: (Options, Callback) => ValidationBackend.AddPlayerPermission("validation", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "RemovePlayerPermission", Invoke: (Options, Callback) => ValidationBackend.RemovePlayerPermission("validation", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "AddPlayerParent", Invoke: (Options, Callback) => ValidationBackend.AddPlayerParent("validation", "Admin", Options, Callback) },
		{ Name: "RemovePlayerParent", Invoke: (Options, Callback) => ValidationBackend.RemovePlayerParent("validation", "Admin", Options, Callback) },
		{ Name: "AddParentPermission", Invoke: (Options, Callback) => ValidationBackend.AddParentPermission("validation", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "RemoveParentPermission", Invoke: (Options, Callback) => ValidationBackend.RemoveParentPermission("validation", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "AddParentParent", Invoke: (Options, Callback) => ValidationBackend.AddParentParent("validation", "Admin", Options, Callback) },
		{ Name: "RemoveParentParent", Invoke: (Options, Callback) => ValidationBackend.RemoveParentParent("validation", "Admin", Options, Callback) },
		{ Name: "ExportFlatFile", Invoke: (Options, Callback) => ValidationBackend.ExportFlatFile(Options, Callback) },
		{ Name: "ImportFlatFile", Invoke: (Options, Callback) => ValidationBackend.ImportFlatFile(Options, Callback) },
		{ Name: "InsertPermission", Invoke: (Options, Callback) => ValidationBackend.InsertPermission(1, "validation", "Parent", "sourcejs.validation", -1, Options, Callback) },
		{ Name: "InsertParent", Invoke: (Options, Callback) => ValidationBackend.InsertParent(1, "validation", "Parent", "Admin", Options, Callback) },
	];
	const unConnectionCountBeforeValidation = g_unNextSOCIConnection;
	const unTextFileReadCountBeforeValidation = g_unTextFileReadCount;
	const unSOCIRequestCountBeforeValidation = g_unSOCIRequestCount;
	let unValidationCallbackCount = 0;
	const ValidationCallback = () => {
		++unValidationCallbackCount;
	};

	for (const RequestOperation of vecRequestOperations) {
		for (const InvalidOptions of [undefined, null, [], false, 1, "invalid"]) {
			let bTypeErrorCaught = false;
			try {
				RequestOperation.Invoke(InvalidOptions, ValidationCallback);
			} catch (Exception) {
				bTypeErrorCaught = Exception instanceof TypeError;
			}

			AssertEqual(bTypeErrorCaught, true, `${RequestOperation.Name} rejects invalid options synchronously`);
		}

		for (const InvalidCallback of [undefined, null, {}, false, 1, "invalid"]) {
			let bTypeErrorCaught = false;
			try {
				RequestOperation.Invoke({ Blocking: true }, InvalidCallback);
			} catch (Exception) {
				bTypeErrorCaught = Exception instanceof TypeError;
			}

			AssertEqual(bTypeErrorCaught, true, `${RequestOperation.Name} rejects invalid callbacks synchronously`);
		}
	}

	AssertEqual(g_unNextSOCIConnection, unConnectionCountBeforeValidation, "invalid requests do not create SOCI connections");
	AssertEqual(g_unTextFileReadCount, unTextFileReadCountBeforeValidation, "invalid requests do not read files");
	AssertEqual(g_unSOCIRequestCount, unSOCIRequestCountBeforeValidation, "invalid requests do not dispatch SOCI work");
	AssertEqual(unValidationCallbackCount, 0, "invalid requests do not invoke callbacks");
	AssertEqual(ValidationBackend.m_hConnection, null, "invalid requests preserve the backend connection state");

	const VerifyOpenCallbackDelivery = (CompletionError, FirstCallbackException) => {
		const QueuedBackend = new SQLBackend({ BackendName: "sqlite3", ConnectionString: "dbname=callback-queue" });
		const Options = { Blocking: true };
		const vecDeliveredCallbacks = [];
		let CompleteSchema;
		QueuedBackend.CreateSchema = (SchemaOptions, Callback) => {
			AssertEqual(SchemaOptions, Options, "queued open schema options");
			CompleteSchema = Callback;
		};

		QueuedBackend.Open(Options, (OpenError, hConnection) => {
			AssertEqual(OpenError, CompletionError, "first queued open error");
			AssertEqual(hConnection, (CompletionError === null) ? QueuedBackend.m_hConnection : null, "first queued open handle");
			vecDeliveredCallbacks.push("First");
			throw FirstCallbackException;
		});
		QueuedBackend.Open({}, (OpenError) => {
			AssertEqual(OpenError, CompletionError, "second queued open error");
			vecDeliveredCallbacks.push("Second");
			throw new Error("Later callback failure must not replace the first failure.");
		});
		QueuedBackend.Open({}, (OpenError) => {
			AssertEqual(OpenError, CompletionError, "third queued open error");
			vecDeliveredCallbacks.push("Third");
		});
		AssertEqual(typeof CompleteSchema, "function", "schema callback captured");
		AssertEqual(vecDeliveredCallbacks.length, 0, "open callbacks wait for schema completion");

		let bExceptionCaught = false;
		try {
			CompleteSchema(CompletionError);
		} catch (Exception) {
			bExceptionCaught = true;
			AssertEqual(Exception, FirstCallbackException, "first callback exception preserved");
		}

		AssertEqual(bExceptionCaught, true, "callback exception propagated");
		AssertJSON(vecDeliveredCallbacks, ["First", "Second", "Third"], "all queued callbacks delivered in registration order");
		AssertEqual(QueuedBackend.m_bOpening, false, "queued open state reset before callback delivery");
		AssertEqual(QueuedBackend.m_vecOpenCallbacks.length, 0, "completed callbacks detached from queue");
		g_SOCIMock.Close(QueuedBackend.m_hConnection, Options, (CloseError, bClosed) => {
			AssertEqual(CloseError, null, "queued open test connection close error");
			AssertEqual(bClosed, true, "queued open test connection closed");
		});
	};

	VerifyOpenCallbackDelivery(null, new Error("First callback failed."));
	VerifyOpenCallbackDelivery(new Error("Schema creation failed."), undefined);

	const SQLBackendInstance = new SQLBackend({ DatabasePath: g_NativePaths.AUTH_SQL_FILE });
	const SQLOptions = { Blocking: true };
	const InvokeBlockingOperation = (Operation) => {
		let OperationError = null;
		let OperationResult;
		let unCallbackCount = 0;
		Operation((Error, Result) => {
			++unCallbackCount;
			OperationError = Error;
			OperationResult = Result;
		});
		AssertEqual(unCallbackCount, 1, "Blocking operation completes its callback exactly once before returning");

		if (OperationError !== null) {
			throw OperationError;
		}

		return OperationResult;
	};

	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.AddParentPermission("sql-admin", "sourcejs.sql.*", -1, SQLOptions, Callback)), true, "SQL parent permission insert");
	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.AddPlayerParent("STEAM_1:0:2", "sql-admin", SQLOptions, Callback)), true, "SQL player parent insert");
	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasParentPermission("sql-admin", "sourcejs.sql.reload", SQLOptions, Callback)), true, "SQL parent wildcard permission");
	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasPlayerPermission("STEAM_1:0:2", "sourcejs.sql.reload", SQLOptions, Callback)), true, "SQL inherited player permission");

	for (const strSeparator of ["\n", "\r", "\u2028", "\u2029", "\0"]) {
		const strPermission = `sourcejs.sql.first${strSeparator}second`;
		AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasParentPermission("sql-admin", strPermission, SQLOptions, Callback)), true, "SQL wildcard includes every character");
		AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasPlayerPermission("STEAM_1:0:2", strPermission, SQLOptions, Callback)), true, "SQL inherited wildcard includes every character");
	}

	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasParentPermission("sql-admin", "SOURCEJS.sql.reload", SQLOptions, Callback)), false, "SQL wildcard remains case-sensitive");
	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.HasParentPermission("sql-admin", "prefix.sourcejs.sql.reload", SQLOptions, Callback)), false, "SQL wildcard remains anchored");

	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.ExportFlatFile(SQLOptions, Callback)).Parents["sql-admin"].Permissions[0], "sourcejs.sql.*", "SQL flat-file export");
	const ExportedParentRecords = JSON.parse(g_mapVirtualFiles.get(g_NativePaths.AUTH_PARENTS_FILE));
	AssertJSON(ExportedParentRecords["sql-admin"], { Parents: [], Permissions: ["sourcejs.sql.*"] }, "SQL export uses the current native flat-file record shape");
	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.AddParentPermission("__proto__", "sourcejs.prototype", -1, SQLOptions, Callback)), true, "SQL prototype-named parent insert");
	InvokeBlockingOperation((Callback) => SQLBackendInstance.ExportFlatFile(SQLOptions, Callback));
	const ExportedPrototypeRecords = JSON.parse(g_mapVirtualFiles.get(g_NativePaths.AUTH_PARENTS_FILE));
	AssertEqual(Object.hasOwn(ExportedPrototypeRecords, "__proto__"), true, "SQL export preserves a prototype-named parent as data");
	AssertJSON(ExportedPrototypeRecords["__proto__"].Permissions, ["sourcejs.prototype"], "SQL export preserves prototype-named permissions");

	const ImportedParentRecords = JSON.parse('{"Root":{"Permissions":["sourcejs.root.*"],"Parents":[]},"__proto__":{"Permissions":["sourcejs.prototype.imported"],"Parents":[]}}');
	const ImportedPlayerRecords = {
		"76561197960265729": { Permissions: ["sourcejs.self.imported"], Parents: ["Root"] },
	};
	g_mapVirtualFiles.set(g_NativePaths.AUTH_PARENTS_FILE, JSON.stringify(ImportedParentRecords));
	g_mapVirtualFiles.set(g_NativePaths.AUTH_PLAYERS_FILE, JSON.stringify(ImportedPlayerRecords));
	const ImportedState = InvokeBlockingOperation((Callback) => SQLBackendInstance.ImportFlatFile(SQLOptions, Callback));
	AssertJSON(ImportedState.Players["76561197960265729"].Permissions, ["sourcejs.self.imported"], "SQL import reads current native permission keys");
	AssertJSON(ImportedState.Players["76561197960265729"].Parents, ["Root"], "SQL import reads current native parent keys");
	AssertEqual(Object.hasOwn(ImportedState.Parents, "__proto__"), true, "SQL import preserves prototype-named records");
	AssertJSON(ImportedState.Parents["__proto__"].Permissions, ["sourcejs.prototype.imported"], "SQL import reads prototype-named permissions");
	AssertEqual(Object.hasOwn(ImportedState.Parents, "sql-admin"), false, "SQL import replaces rather than merges old records");

	AssertEqual(InvokeBlockingOperation((Callback) => SQLBackendInstance.Unload(SQLOptions, Callback)), true, "SQL backend Unload result");
	AssertEqual(SQLBackendInstance.Loaded, false, "SQL backend Unload state");
	AssertEqual(Object.hasOwn(Authorization, "moduleName"), false, "auth should not expose moduleName");
	AssertEqual(Object.hasOwn(SQLModuleExports, "importFlatfile"), false, "SQL auth should not expose importFlatfile alias");
	AssertEqual(Object.hasOwn(SQLModuleExports, "exportFlatfile"), false, "SQL auth should not expose exportFlatfile alias");

	const PrototypeRecords = {};
	const PrototypeRecord = GetOrCreateRecord(PrototypeRecords, "__proto__");
	AssertEqual(Object.hasOwn(PrototypeRecords, "__proto__"), true, "prototype-named auth record should be stored as data");
	AssertEqual(Object.getPrototypeOf(PrototypeRecords), Object.prototype, "prototype-named auth record must not alter the dictionary prototype");
	AssertEqual(PrototypeRecord.Name, "__proto__", "prototype-named auth record data");
	AssertEqual(HasRecordPermission(PrototypeRecords, "constructor", "sourcejs.test"), false, "inherited keys are not auth records");
	AssertEqual(g_NativeAuthorization.GetParent("__proto__"), null, "missing prototype-named parent lookup");
	AssertEqual(g_NativeAuthorization.RemoveParentPermission("__proto__", "sourcejs.test"), false, "missing prototype-named parent removal");

	console.log("[smoke_auth_store] ok");
} finally {
	g_Module._load = g_OriginalModuleLoad;
	delete globalThis.sourcejs;
}
