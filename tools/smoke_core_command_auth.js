"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

class Backend {
}

class SQLBackend {
}

const g_vecNativeCalls = [];
const g_vecMessages = [];
const g_mapCommands = new Map();
const g_PlayerRecords = { Player: { Name: "Player", Permissions: ["test.read"], Parents: ["Group"] } };
const g_ParentRecords = { Group: { Name: "Group", Permissions: ["test.read"], Parents: [] } };
let g_bOperationResult = true;
let g_OperationError = null;

function CreateNativeOperation(strMethodName) {
	return function NativeAuthorizationOperation(...vecArguments) {
		if (g_OperationError !== null) {
			throw g_OperationError;
		}

		g_vecNativeCalls.push({ Method: strMethodName, Arguments: vecArguments });

		return g_bOperationResult;
	};
}

const g_AuthorizationRuntime = {
	Parents() {
		return g_ParentRecords;
	},
	Players() {
		return g_PlayerRecords;
	},
};
for (const strMethodName of ["AddParentParent", "AddParentPermission", "AddPlayerParent", "AddPlayerPermission", "HasPlayerPermission", "RemoveParentParent", "RemoveParentPermission", "RemovePlayerParent", "RemovePlayerPermission"]) {
	g_AuthorizationRuntime[strMethodName] = CreateNativeOperation(strMethodName);
}

function LoadPackage(strRelativePath, RequireDependency) {
	const strPackagePath = g_Path.join(__dirname, "../packages/sourcejs", strRelativePath);
	const Module = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(strPackagePath, "utf8"), { module: Module, require: RequireDependency }, { filename: strPackagePath });

	return Module.exports;
}

function RequireAuthorizationDependency(strModuleName) {
	switch (strModuleName) {
		case "internal/runtime":
			return {
				GetModule(strNativeModuleName) {
					g_Assert.equal(strNativeModuleName, "auth");

					return g_AuthorizationRuntime;
				},
			};

		case "auth/index":
			return { Backend };

		case "auth/backends/sql":
			return { SQLBackend };

		default:
			throw new Error(`Unexpected auth dependency ${strModuleName}`);
	}
}

const g_Authorization = LoadPackage("auth.js", RequireAuthorizationDependency);
const g_CoreCommand = {
	RegisterCommand(vecPath, Callback) {
		const strCommandKey = Array.from(vecPath).join(" ");
		g_Assert.equal(g_mapCommands.has(strCommandKey), false);
		g_mapCommands.set(strCommandKey, Callback);

		return Callback;
	},
	LogCommandMessage(strMessage) {
		g_vecMessages.push(strMessage);
	},
};

function RequireCommandDependency(strModuleName) {
	switch (strModuleName) {
		case "auth":
			return g_Authorization;

		case "core/command":
			return { CORE_COMMAND: g_CoreCommand };

		default:
			throw new Error(`Unexpected auth command dependency ${strModuleName}`);
	}
}

const g_CoreAuthorization = LoadPackage("core/command/auth.js", RequireCommandDependency);
g_Assert.equal(g_CoreAuthorization.MODULE_NAME, "core/command/auth");
g_Assert.equal(g_CoreAuthorization.TestPermission("Player", "test.read"), true);
g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: "HasPlayerPermission", Arguments: ["Player", "test.read"] });
g_Assert.equal(g_vecMessages.pop(), 'Permission "test.read" for "Player": yes');

const g_vecOperationCases = [
	{ PublicName: "GrantPlayerPermission", NativeName: "AddPlayerPermission", Path: "auth permission player add", Arguments: ["Player", "test.read"] },
	{ PublicName: "RevokePlayerPermission", NativeName: "RemovePlayerPermission", Path: "auth permission player remove", Arguments: ["Player", "test.read"] },
	{ PublicName: "AddPlayerToParent", NativeName: "AddPlayerParent", Path: "auth permission player add_parent", Arguments: ["Player", "Group"] },
	{ PublicName: "RemovePlayerFromParent", NativeName: "RemovePlayerParent", Path: "auth permission player remove_parent", Arguments: ["Player", "Group"] },
	{ PublicName: "TestPermission", NativeName: "HasPlayerPermission", Path: "auth permission player test", Arguments: ["Player", "test.read"] },
	{ PublicName: "GrantParentPermission", NativeName: "AddParentPermission", Path: "auth permission parent add", Arguments: ["Group", "test.read"] },
	{ PublicName: "RevokeParentPermission", NativeName: "RemoveParentPermission", Path: "auth permission parent remove", Arguments: ["Group", "test.read"] },
	{ PublicName: "AddParentToParent", NativeName: "AddParentParent", Path: "auth permission parent add_parent", Arguments: ["Group", "InheritedGroup"] },
	{ PublicName: "RemoveParentFromParent", NativeName: "RemoveParentParent", Path: "auth permission parent remove_parent", Arguments: ["Group", "InheritedGroup"] },
];
g_Assert.deepEqual(Array.from(g_mapCommands.keys()).sort(), [...g_vecOperationCases.map((TestCase) => TestCase.Path), "auth permission parent list", "auth permission player list"].sort());

for (const TestCase of g_vecOperationCases) {
	for (const bOperationResult of [true, false]) {
		g_bOperationResult = bOperationResult;
		g_Assert.equal(g_CoreAuthorization[TestCase.PublicName](...TestCase.Arguments), bOperationResult);
		g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: TestCase.NativeName, Arguments: TestCase.Arguments });
		g_Assert.equal(g_mapCommands.get(TestCase.Path)({ CommandArguments: TestCase.Arguments }), bOperationResult);
		g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: TestCase.NativeName, Arguments: TestCase.Arguments });
	}
}

g_bOperationResult = true;

for (const Subject of [1, { NetworkID: "Player" }]) {
	g_Assert.equal(g_CoreAuthorization.TestPermission(Subject, "test.read"), true);
	g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: "HasPlayerPermission", Arguments: [Subject, "test.read"] });
}

g_Assert.equal(g_CoreAuthorization.PrintAuthPlayers(), g_PlayerRecords);
g_Assert.equal(g_vecMessages.pop(), JSON.stringify(g_PlayerRecords, null, "\t"));
g_Assert.equal(g_CoreAuthorization.PrintAuthParents(), g_ParentRecords);
g_Assert.equal(g_vecMessages.pop(), JSON.stringify(g_ParentRecords, null, "\t"));
g_Assert.equal(g_mapCommands.get("auth permission player list")(), g_PlayerRecords);
g_Assert.equal(g_mapCommands.get("auth permission parent list")(), g_ParentRecords);

const g_unMessageCount = g_vecMessages.length;
g_OperationError = new Error("Native operation failed");
g_Assert.throws(() => g_CoreAuthorization.GrantPlayerPermission("Player", "test.read"), (ErrorValue) => ErrorValue === g_OperationError);
g_Assert.equal(g_vecMessages.length, g_unMessageCount);
g_Assert.equal(g_vecNativeCalls.length, 0);

console.log("Core auth command smoke checks passed (actual JS wrapper/facade; native and command-registry doubles, no IO).");
