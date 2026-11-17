#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strAuthorizationPath = g_Path.join(g_strPackageRoot, "auth", "index.js");
const g_strFlatFilePath = g_Path.join(g_strPackageRoot, "auth", "backends", "flatfile.js");
const g_strAuthorizationManagerPath = g_Path.join(g_strPackageRoot, "auth", "manager.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strSQLPath = g_Path.join(g_strPackageRoot, "auth", "backends", "sql.js");
const g_strSteamPath = g_Path.join(g_strPackageRoot, "steam.js");

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

const g_NativeAuthorizationModule = {
	NetworkID() {
		return "76561197960265729";
	},
	Parents() {
		return {};
	},
	Players() {
		return {};
	},
	Reload() {
		return true;
	},
};

InstallDependency(g_strRuntimePath, {
	GetModule(strName) {
		if (strName !== "auth") {
			throw new Error(`unexpected native module ${strName}`);
		}

		return g_NativeAuthorizationModule;
	},
});

InstallDependency(g_strSteamPath, {
	SteamID: {
		Parse() {
			return {
				ConvertSteamIDToUInt64() {
					return 76561197960265730n;
				},
			};
		},
	},
});

delete require.cache[g_strAuthorizationPath];

const { Backend } = require(g_strAuthorizationPath);

class FlatFileBackend extends Backend {
	static BackendName = "flatfile";
}

class SQLBackend extends Backend {
	static BackendName = "sql";
}

InstallDependency(g_strFlatFilePath, { FlatFileBackend });

InstallDependency(g_strSQLPath, { SQLBackend });

delete require.cache[g_strAuthorizationManagerPath];

const { AUTH_MANAGER, GUEST_PARENT_NAME, AuthManager, PermissionBase } = require(g_strAuthorizationManagerPath);
const g_ModuleExports = require.cache[g_strAuthorizationManagerPath].exports;
const g_AuthorizationManager = new AuthManager();
g_Assert.deepEqual(g_AuthorizationManager.FindAndAddAvailableBackends().map((BackendRecord) => BackendRecord.Name), ["flatfile", "sql"]);
g_Assert.equal(g_AuthorizationManager.IsBackendLoaded("flatfile"), false);
g_Assert.throws(() => g_AuthorizationManager.FindAndAddAvailableBackends(new Set()), TypeError);

const g_AdminPermissions = g_AuthorizationManager.GetParentPermissions("admin");
const g_Options = {};
const g_Callback = () => {};
g_AdminPermissions.Add("sourcejs.admin.*", g_Options, g_Callback, null, false);

const g_PlayerPermissions = g_AuthorizationManager.GetPlayerPermissionsFromSteamID("STEAM_1:0:1");

// Native 64-bit SteamIDs must never pass through the Number representation.
const g_unMaximumSteamID64 = 0xFFFFFFFFFFFFFFFFn;
const g_unPlayerCountBeforeInvalidNumbers = g_AuthorizationManager.Players.size;
for (const dblInvalidSteamID of [0, 1, -1, 0.5, NaN, Infinity, Number(g_unMaximumSteamID64)]) {
	g_Assert.throws(() => g_AuthorizationManager.GetPlayerPermissionsFromSteamID(dblInvalidSteamID), TypeError);
	g_Assert.throws(() => g_AuthorizationManager.Players.GetOrCreate(dblInvalidSteamID), TypeError);
}

g_Assert.equal(g_AuthorizationManager.Players.size, g_unPlayerCountBeforeInvalidNumbers);

for (const unSteamID64 of [0n, g_unMaximumSteamID64]) {
	const PlayerNode = g_AuthorizationManager.GetPlayerPermissionsFromSteamID(unSteamID64);
	g_Assert.equal(g_AuthorizationManager.Players.get(unSteamID64.toString()), PlayerNode);
}

const g_unPlayerCountBeforeInvalidBigInts = g_AuthorizationManager.Players.size;
for (const nInvalidSteamID64 of [-1n, g_unMaximumSteamID64 + 1n]) {
	g_Assert.throws(() => g_AuthorizationManager.GetPlayerPermissionsFromSteamID(nInvalidSteamID64), TypeError);
	g_Assert.throws(() => g_AuthorizationManager.Players.GetOrCreate(nInvalidSteamID64), TypeError);
}

g_Assert.equal(g_AuthorizationManager.Players.size, g_unPlayerCountBeforeInvalidBigInts);

g_PlayerPermissions.AddParent("admin", g_Options, g_Callback, false);
g_PlayerPermissions.Add("sourcejs.player.self", g_Options, g_Callback, null, false);
g_Assert.equal(g_PlayerPermissions.HasPermission("sourcejs.admin.reload"), true);
g_Assert.equal(g_PlayerPermissions.HasDirectPermission("sourcejs.player.self"), true);
g_Assert.deepEqual(new Set(g_PlayerPermissions.Flatten()), new Set(["sourcejs.player.self", "sourcejs.admin.*"]));

// Native '*' consumes every character, including line terminators and nulls.
for (const strSeparator of ["\n", "\r", "\u2028", "\u2029", "\0"]) {
	g_Assert.equal(g_PlayerPermissions.HasPermission(`sourcejs.admin.first${strSeparator}second`), true);
	g_Assert.equal(g_PlayerPermissions.HasPermission(`sourcejs.player.self${strSeparator}`), false);
	g_Assert.equal(g_PlayerPermissions.HasPermission(`${strSeparator}sourcejs.player.self`), false);
}

g_PlayerPermissions.Add("literal.[value]?+$", g_Options, g_Callback, null, false);
g_Assert.equal(g_PlayerPermissions.HasPermission("literal.[value]?+$"), true);
g_Assert.equal(g_PlayerPermissions.HasPermission("literal.value"), false);
g_PlayerPermissions.Remove("literal.[value]?+$", g_Options, g_Callback, null, false);

const g_CyclePermissionsA = new PermissionBase("cycleA", g_AuthorizationManager);
const g_CyclePermissionsB = new PermissionBase("cycleB", g_AuthorizationManager);
g_CyclePermissionsA.Parents.add(g_CyclePermissionsB);
g_CyclePermissionsB.Parents.add(g_CyclePermissionsA);
g_CyclePermissionsB.Add("cycle.allowed", g_Options, g_Callback, null, false);
g_Assert.equal(g_CyclePermissionsA.HasPermission("cycle.allowed"), true);
g_Assert.equal(g_CyclePermissionsA.HasPermission("cycle.denied"), false);

const g_unLargePermissionCount = 200000;
const g_LargeParentPermissions = new PermissionBase("LargeParent", g_AuthorizationManager);
const g_LargeChildPermissions = new PermissionBase("LargeChild", g_AuthorizationManager);
const g_PermissionMatcher = /.*/;
for (let unPermissionIndex = 0; unPermissionIndex < g_unLargePermissionCount; ++unPermissionIndex) {
	g_LargeParentPermissions.set(`bulk.${unPermissionIndex}`, g_PermissionMatcher);
}

g_LargeChildPermissions.Add("child.direct", g_Options, g_Callback, null, false);
g_LargeChildPermissions.Parents.add(g_LargeParentPermissions);
const g_vecLargePermissionNames = g_LargeChildPermissions.Flatten();
g_Assert.equal(g_vecLargePermissionNames.length, g_unLargePermissionCount + 1);
g_Assert.equal(g_vecLargePermissionNames[0], "child.direct");
g_Assert.equal(g_vecLargePermissionNames[1], "bulk.0");
g_Assert.equal(g_vecLargePermissionNames[g_unLargePermissionCount], `bulk.${g_unLargePermissionCount - 1}`);
g_LargeChildPermissions.Clear();
g_LargeParentPermissions.Clear();

g_Assert.throws(() => g_AdminPermissions.Add(7, g_Options, g_Callback, null, false), TypeError);
g_Assert.throws(() => g_AdminPermissions.Add("permission", g_Options, g_Callback, "-1", false), TypeError);
g_Assert.equal(typeof AUTH_MANAGER, "object");
g_Assert.equal(GUEST_PARENT_NAME, "guest");
g_Assert.equal(Object.hasOwn(g_ModuleExports, "authManager"), false);
g_Assert.equal(Object.hasOwn(g_ModuleExports, "moduleName"), false);
g_Assert.equal(typeof g_AdminPermissions.toJSON, "undefined");

function CheckPermissionGraphTraversal() {
	const unDepth = 20000;
	const Root = new PermissionBase("DeepRoot");
	let Node = Root;
	for (let unIndex = 1; unIndex < unDepth; ++unIndex) {
		const Parent = new PermissionBase(`Deep${unIndex}`);
		Node.Parents.add(Parent);
		Node = Parent;
	}

	Node.set("deep.allowed", /^deep\.allowed$/);
	g_Assert.equal(Root.HasPermission("deep.allowed"), true);
	g_Assert.equal(Root.HasPermission("deep.denied"), false);
	g_Assert.deepEqual(Root.Flatten(), ["deep.allowed"]);
	Node.Parents.add(Root);
	g_Assert.equal(Root.HasPermission("deep.denied"), false);
	g_Assert.deepEqual(Root.Flatten(), ["deep.allowed"]);
	g_Assert.equal(Root.HasPermission("deep.allowed", new Set([Root])), false);
	g_Assert.deepEqual(Root.Flatten(new Set([Root])), []);
	g_Assert.throws(() => Root.HasPermission("deep.allowed", []), TypeError);
	g_Assert.throws(() => Root.Flatten([]), TypeError);

	const Diamond = new PermissionBase("Diamond");
	const Left = new PermissionBase("Left");
	const Right = new PermissionBase("Right");
	const Shared = new PermissionBase("Shared");
	const vecVisitedNames = [];
	for (const PermissionNode of [Diamond, Left, Right, Shared]) {
		PermissionNode.set(PermissionNode.Name, {
			test(strPermission) {
				vecVisitedNames.push(PermissionNode.Name);

				return strPermission === PermissionNode.Name;
			},
		});
	}

	Diamond.Parents.add(Left).add(Right);
	Left.Parents.add(Shared);
	Right.Parents.add(Shared);
	Shared.Parents.add(Diamond);
	g_Assert.equal(Diamond.HasPermission("absent"), false);
	g_Assert.deepEqual(vecVisitedNames, ["Diamond", "Left", "Shared", "Right"]);
	g_Assert.deepEqual(Diamond.Flatten(), ["Diamond", "Left", "Shared", "Right"]);

	const OverrideRoot = new PermissionBase("OverrideRoot");
	const OverrideParent = new PermissionBase("OverrideParent");
	const setVisited = new Set();
	OverrideRoot.Parents.add(OverrideParent);
	let unPermissionCalls = 0;
	let unFlattenCalls = 0;
	Object.defineProperties(OverrideParent, {
		HasPermission: {
			value(strPermission, setPassedVisited) {
				g_Assert.equal(this, OverrideParent);
				g_Assert.equal(strPermission, "override.allowed");
				g_Assert.equal(setPassedVisited, setVisited);
				unPermissionCalls++;

				return "granted";
			},
		},
		Flatten: {
			value(setPassedVisited) {
				g_Assert.equal(this, OverrideParent);
				g_Assert.equal(setPassedVisited, setVisited);
				unFlattenCalls++;

				return ["override.allowed"];
			},
		},
	});
	g_Assert.equal(OverrideRoot.HasPermission("override.allowed", setVisited), true);
	setVisited.clear();
	g_Assert.deepEqual(OverrideRoot.Flatten(setVisited), ["override.allowed"]);
	g_Assert.equal(unPermissionCalls, 1);
	g_Assert.equal(unFlattenCalls, 1);

	const LazyRoot = new PermissionBase("LazyRoot");
	const MatchingParent = new PermissionBase("MatchingParent");
	MatchingParent.set("lazy.allowed", /^lazy\.allowed$/);
	let bLazyIteratorClosed = false;
	LazyRoot.Parents[Symbol.iterator] = function* () {
		try {
			yield MatchingParent;
			g_Assert.fail("Permission traversal must not read past the matching parent.");
		} finally {
			bLazyIteratorClosed = true;
		}
	};
	g_Assert.equal(LazyRoot.HasPermission("lazy.allowed"), true);
	g_Assert.equal(bLazyIteratorClosed, true);

	const OpaqueFailure = Object.create(null);
	for (const Failure of [undefined, null, false, 0, -0, 0n, "", NaN, OpaqueFailure, new Error("graph failure")]) {
		for (const strMethod of ["HasPermission", "Flatten"]) {
			const FailureRoot = new PermissionBase("FailureRoot");
			const Middle = new PermissionBase("Middle");
			const Leaf = new PermissionBase("Leaf");
			const vecClosed = [];
			for (const [PermissionNode, Parent] of [[FailureRoot, Middle], [Middle, Leaf]]) {
				PermissionNode.Parents[Symbol.iterator] = function* () {
					try {
						yield Parent;
					} finally {
						vecClosed.push(PermissionNode.Name);
						throw new Error("iterator cleanup failure");
					}
				};
			}

			Leaf.set("failure", {
				test() {
					throw Failure;
				},
			});
			Leaf.keys = () => {
				throw Failure;
			};

			const vecArguments = (strMethod === "HasPermission") ? ["failure"] : [];
			let bCaught = false;
			try {
				FailureRoot[strMethod](...vecArguments);
			} catch (Exception) {
				g_Assert(Object.is(Exception, Failure));
				bCaught = true;
			}

			g_Assert(bCaught);
			g_Assert.deepEqual(vecClosed, ["Middle", "FailureRoot"]);
		}
	}

	console.log("Permission graph traversal passed:20000-node chain/cycle,DFS order,overrides,lazy iteration and20 opaque-error/iterator-close profiles (actual JS;no native IO).");
}

CheckPermissionGraphTraversal();

function CheckRuntimeFailureContracts() {
	const OriginalNativeMethods = {
		Parents: g_NativeAuthorizationModule.Parents,
		Players: g_NativeAuthorizationModule.Players,
		Reload: g_NativeAuthorizationModule.Reload,
	};
	const ResetNativeMethods = () => {
		g_NativeAuthorizationModule.Reload = () => true;
		g_NativeAuthorizationModule.Parents = () => ({});
		g_NativeAuthorizationModule.Players = () => ({});
	};
	const OpaqueFailure = Object.create(null);
	const vecFailures = [undefined, null, false, 0, -0, 0n, "", NaN, OpaqueFailure, new Error("native refresh failure")];
	let unScenarios = 0;
	try {
		for (const bBlocking of [false, true]) {
			for (const [strMethod, strStage] of [["Load", "Reload"], ["Load", "Parents"], ["Load", "Players"], ["Synchronize", "Parents"], ["Synchronize", "Players"]]) {
				for (const Failure of vecFailures) {
					ResetNativeMethods();
					g_NativeAuthorizationModule[strStage] = () => {
						throw Failure;
					};

					const Manager = new AuthManager();
					const vecArguments = (strMethod === "Load") ? [null] : [];
					let unCallbacks = 0;
					Manager[strMethod](...vecArguments, { Blocking: bBlocking }, (ErrorValue, Result) => {
						g_Assert(ErrorValue, "A falsy native exception must not be reported as success.");

						if (Failure) {
							g_Assert.equal(ErrorValue, Failure);
						} else {
							g_Assert(ErrorValue instanceof AggregateError);
							g_Assert.equal(ErrorValue.errors.length, 1);
							g_Assert(Object.is(ErrorValue.errors[0], Failure));
						}

						g_Assert.equal(Result, undefined);
						unCallbacks++;
					});
					g_Assert.equal(unCallbacks, 1);
					unScenarios++;
				}
			}

			for (const strMethod of ["Load", "Synchronize"]) {
				for (const bNativeFailure of [false, true]) {
					for (const Failure of vecFailures) {
						ResetNativeMethods();

						if (bNativeFailure) {
							g_NativeAuthorizationModule.Parents = () => {
								throw new Error("native refresh failure");
							};
						}

						const Manager = new AuthManager();
						const vecArguments = (strMethod === "Load") ? [null] : [];
						let unCallbacks = 0;
						let bCaught = false;
						try {
							Manager[strMethod](...vecArguments, { Blocking: bBlocking }, () => {
								unCallbacks++;
								throw Failure;
							});
						} catch (Exception) {
							g_Assert(Object.is(Exception, Failure));
							bCaught = true;
						}

						g_Assert(bCaught);
						g_Assert.equal(unCallbacks, 1);
						unScenarios++;
					}
				}
			}
		}
	} finally {
		Object.assign(g_NativeAuthorizationModule, OriginalNativeMethods);
	}

	g_Assert.equal(unScenarios, 180);
	console.log("AuthManager C2 180 native-refresh/falsy-error/callback scenarios passed (actual JS;controlled native methods,no native IO).");
}

CheckRuntimeFailureContracts();

function CheckManagerLifecycleContracts() {
	class ControlledBackend extends Backend {
		constructor() {
			super();
			this.m_vecRequests = [];
		}

		Load(Options, Callback) {
			this.m_vecRequests.push({ Operation: "Load", Options, Callback });
		}

		Unload(Options, Callback) {
			this.m_vecRequests.push({ Operation: "Unload", Options, Callback });
		}

		Synchronize(Options, Callback) {
			this.m_vecRequests.push({ Operation: "Synchronize", Options, Callback });
		}
	}

	Object.defineProperty(ControlledBackend, "BackendName", { value: "controlled" });

	const nServerID = 7;

	const Manager = new AuthManager();
	const BackendInstance = Manager.AddBackend(new ControlledBackend());
	const RetainedParent = Manager.GetParentPermissions("Retained");
	const RequestOptions = { Blocking: false };
	const vecCompletions = [];
	const Completion = (Error, Result) => {
		vecCompletions.push([Error, Result]);
	};
	const CompleteNext = (strOperation, Error = null) => {
		const Request = BackendInstance.m_vecRequests.shift();
		g_Assert.equal(Request.Operation, strOperation);
		g_Assert.equal(Request.Options, RequestOptions);

		if (Error === null) {
			if (strOperation === "Load") {
				BackendInstance.m_bLoaded = true;

			} else if (strOperation === "Unload") {
				BackendInstance.m_bLoaded = false;
			}
		}

		Request.Callback(Error, (Error === null) ? BackendInstance : undefined);
	};
	const OriginalNativeMethods = {
		Parents: g_NativeAuthorizationModule.Parents,
		Players: g_NativeAuthorizationModule.Players,
		Reload: g_NativeAuthorizationModule.Reload,
	};
	let unNativeCallCount = 0;
	g_NativeAuthorizationModule.Parents = () => {
		++unNativeCallCount;

		return { ImportedParent: { Permissions: ["imported.*"], Parents: [] } };
	};
	g_NativeAuthorizationModule.Players = () => {
		++unNativeCallCount;

		return {
			"76561197960265730": { Permissions: ["player.direct"], Parents: ["ImportedParent"] },
			BOT: { Permissions: [], Parents: [] },
		};
	};
	g_NativeAuthorizationModule.Reload = () => {
		++unNativeCallCount;

		return true;
	};

	try {
		const vecOperations = [
			(Options, Callback) => Manager.SetActiveBackend("controlled", Options, Callback),
			(Options, Callback) => Manager.Load(null, Options, Callback),
			(Options, Callback) => Manager.UnloadActiveBackend(Options, Callback),
			(Options, Callback) => Manager.Unload(Options, Callback),
			(Options, Callback) => Manager.Synchronize(Options, Callback),
		];
		for (const Operation of vecOperations) {
			for (const InvalidOptions of [undefined, null, false, 7, "invalid", [], () => {}]) {
				g_Assert.throws(() => Operation(InvalidOptions, Completion), TypeError);
			}

			for (const InvalidCallback of [undefined, null, false, 7, "invalid", [], {}]) {
				g_Assert.throws(() => Operation(RequestOptions, InvalidCallback), TypeError);
			}
		}

		g_Assert.equal(unNativeCallCount, 0);
		g_Assert.equal(BackendInstance.m_vecRequests.length, 0);
		g_Assert.equal(vecCompletions.length, 0);
		g_Assert.equal(Manager.GetParentPermissions("Retained"), RetainedParent);

		Manager.ServerID = nServerID;
		g_Assert.equal(Manager.ServerID, nServerID);
		g_Assert.equal(Manager.TargetsThisServer(nServerID), true);
		g_Assert.equal(Manager.TargetsThisServer(-1), true);
		g_Assert.equal(Manager.TargetsThisServer(null), true);
		g_Assert.equal(Manager.TargetsThisServer(8), false);
		g_Assert.throws(() => {
			Manager.ServerID = "7";
		}, TypeError);
		g_Assert.equal(Manager.ServerID, nServerID);

		Manager.Load(null, RequestOptions, Completion);
		g_Assert.equal(unNativeCallCount, 3);
		g_Assert.deepEqual(vecCompletions.pop(), [null, Manager]);
		g_Assert.equal(Manager.ActiveBackend, null);
		g_Assert.equal(Manager.Parents.has("Retained"), false);
		g_Assert.equal(Manager.Players.size, 1);
		const ImportedPlayer = Manager.Players.get("76561197960265730");
		const ImportedParent = Manager.Parents.get("ImportedParent");
		g_Assert.equal(ImportedPlayer.HasDirectPermission("player.direct"), true);
		g_Assert.equal(ImportedPlayer.HasPermission("imported.command"), true);
		g_Assert.equal(ImportedParent.Children.has(ImportedPlayer), true);

		Manager.SetActiveBackend("CONTROLLED", RequestOptions, Completion);
		g_Assert.equal(Manager.ActiveBackend, null);
		g_Assert.equal(vecCompletions.length, 0);
		g_Assert.equal(Manager.Players.size, 0);
		g_Assert.equal(ImportedPlayer.Parents.size, 0);
		g_Assert.equal(ImportedParent.Children.size, 0);
		CompleteNext("Load");
		g_Assert.equal(Manager.ActiveBackend, BackendInstance);
		g_Assert.deepEqual(vecCompletions.pop(), [null, BackendInstance]);
		g_Assert.equal(Manager.IsBackendLoaded("CONTROLLED"), true);

		Manager.Load(null, RequestOptions, Completion);
		g_Assert.equal(unNativeCallCount, 6);
		g_Assert.equal(Manager.ActiveBackend, BackendInstance);
		g_Assert.deepEqual(vecCompletions.pop(), [null, Manager]);

		Manager.Synchronize(RequestOptions, Completion);
		g_Assert.equal(vecCompletions.length, 0);
		CompleteNext("Synchronize");
		g_Assert.deepEqual(vecCompletions.pop(), [null, BackendInstance]);

		const UnloadFailure = new Error("controlled unload failure");
		Manager.UnloadActiveBackend(RequestOptions, Completion);
		CompleteNext("Unload", UnloadFailure);
		g_Assert.deepEqual(vecCompletions.pop(), [UnloadFailure, undefined]);
		g_Assert.equal(Manager.ActiveBackend, BackendInstance);
		g_Assert.equal(Manager.Players.size, 1);

		Manager.SetActiveBackend("controlled", RequestOptions, Completion);
		g_Assert.equal(vecCompletions.length, 0);
		CompleteNext("Unload");
		g_Assert.equal(Manager.ActiveBackend, null);
		g_Assert.equal(Manager.Players.size, 0);
		g_Assert.equal(vecCompletions.length, 0);
		const LoadFailure = new Error("controlled load failure");
		CompleteNext("Load", LoadFailure);
		g_Assert.deepEqual(vecCompletions.pop(), [LoadFailure, undefined]);
		g_Assert.equal(Manager.ActiveBackend, null);

		Manager.SetActiveBackend("controlled", RequestOptions, Completion);
		CompleteNext("Load");
		g_Assert.deepEqual(vecCompletions.pop(), [null, BackendInstance]);
		Manager.Unload(RequestOptions, Completion);
		g_Assert.equal(vecCompletions.length, 0);
		CompleteNext("Unload");
		g_Assert.deepEqual(vecCompletions.pop(), [null, true]);
		g_Assert.equal(Manager.ActiveBackend, null);
		g_Assert.equal(Manager.Parents.size, 0);
		g_Assert.equal(Manager.Players.size, 0);
		g_Assert.equal(BackendInstance.m_vecRequests.length, 0);
		g_Assert.equal(vecCompletions.length, 0);

		Manager.Synchronize(RequestOptions, Completion);
		g_Assert.deepEqual(vecCompletions.pop(), [null, Manager]);
		g_Assert.equal(unNativeCallCount, 8);

		const CallbackFailure = new Error("controlled callback failure");
		let unThrowingCallbackCount = 0;
		g_Assert.throws(() => Manager.Load(null, RequestOptions, () => {
			++unThrowingCallbackCount;
			throw CallbackFailure;
		}), (Error) => Error === CallbackFailure);
		g_Assert.equal(unThrowingCallbackCount, 1);
	} finally {
		Object.assign(g_NativeAuthorizationModule, OriginalNativeMethods);
	}
}

CheckManagerLifecycleContracts();

const g_PermissionExports = require(g_Path.join(g_strPackageRoot, "auth", "permissions.js"));
const g_vecPermissionExportNames = [
	"GUEST_PARENT_NAME",
	"ParentPermissionStore",
	"ParentPermissions",
	"PermissionBase",
	"PermissionStore",
	"PlayerPermissionStore",
	"PlayerPermissions",
];
g_Assert.deepEqual(Object.keys(g_PermissionExports), g_vecPermissionExportNames);

for (const strExportName of g_vecPermissionExportNames) {
	g_Assert.equal(g_PermissionExports[strExportName], g_ModuleExports[strExportName]);
}

const g_strPermissionDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "docs", "api", "auth-permissions.md"), "utf8");
const g_vecDetachedGraphExamples = [...g_strPermissionDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].filter(([, strExample]) => strExample.includes("g_mapTestManager"));
g_Assert.equal(g_vecDetachedGraphExamples.length, 1);
g_VM.runInNewContext(g_vecDetachedGraphExamples[0][1], {
	require(strModule) {
		if (strModule === "auth/permissions") {
			return g_PermissionExports;
		}

		g_Assert.equal(strModule, "auth/manager");

		return g_ModuleExports;
	},
}, { filename: "auth-permissions-example.js", timeout: 1000 });

console.log("[smoke_auth_manager] ok");
