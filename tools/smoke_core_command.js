"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_vecMessages = [];
const g_vecCommandContexts = [];
const g_Information = {
	Architecture: "x64",
	GameName: "TestGame",
	GitCommit: "TestCommit",
	Platform: "TestPlatform",
	Runtime: "TestRuntime",
	SDKBranch: "TestSDKBranch",
	SourceEngine: "TestEngine",
	SourceEngineBranch: "TestEngineBranch",
	Version: "TestVersion",
};
let g_unInformationReads = 0;

function RejectNativeOperation() {
	throw new Error("Core command checks must not perform native IO.");
}

const g_Logger = {
	// Trap the removed logger name; this is not a forwarding alias.
	Info: RejectNativeOperation,
	LogInfo(strMessage) {
		g_vecMessages.push({ Severity: "INFO", Message: strMessage });
	},
	LogWarning(strMessage) {
		g_vecMessages.push({ Severity: "WARNING", Message: strMessage });
	},
};
const g_mapNativeModules = new Map([
	["core", {
		GetInfo() {
			++g_unInformationReads;

			return g_Information;
		},
	}],
	["cpr", {}],
	["interfaces", {}],
	["listeners", {}],
]);

function LoadPackage(strRelativePath, RequireDependency) {
	const strPackagePath = g_Path.join(__dirname, "../packages/sourcejs", strRelativePath);
	const Module = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(strPackagePath, "utf8"), { module: Module, require: RequireDependency }, { filename: strPackagePath });

	return Module.exports;
}

function RequireCoreDependency(strModuleName) {
	switch (strModuleName) {
		case "filesystem":
			return { DoesFileExist: RejectNativeOperation, ReadTextFile: RejectNativeOperation };

		case "internal/runtime":
			return {
				GetModule(strNativeModuleName) {
					g_Assert.ok(g_mapNativeModules.has(strNativeModuleName), `Unexpected native module ${strNativeModuleName}`);

					return g_mapNativeModules.get(strNativeModuleName);
				},
			};

		case "loggers":
			return g_Logger;

		case "paths":
			return { CONFIG_ROOT: "cfg/sourcejs" };

		default:
			throw new Error(`Unexpected core dependency ${strModuleName}`);
	}
}

const g_Core = LoadPackage("core.js", RequireCoreDependency);

function RequireCommandDependency(strModuleName) {
	switch (strModuleName) {
		case "core":
			return g_Core;

		case "loggers":
			return g_Logger;

		default:
			throw new Error(`Unexpected core command dependency ${strModuleName}`);
	}
}

const { CORE_COMMAND, CoreCommandManager, NormalizeCommandPath } = LoadPackage("core/command.js", RequireCommandDependency);
const g_FormatInformationEntry = ([strFieldName, FieldValue]) => `${strFieldName}: ${FieldValue}`;
const g_strExpectedInformation = Object.entries(g_Information).map(g_FormatInformationEntry).join("\n");
g_Assert.equal(CORE_COMMAND.RunCommand("sjs info"), true);
g_Assert.equal(g_unInformationReads, 1);
g_Assert.deepEqual(g_vecMessages, [{ Severity: "INFO", Message: g_strExpectedInformation }]);
g_Assert.equal(CORE_COMMAND.PrintSourceJSInfo(), g_strExpectedInformation);
g_Assert.equal(g_unInformationReads, 2);

g_Assert.deepEqual(Array.from(NormalizeCommandPath('group "quoted value"')), ["group", "quoted value"]);

const g_vecOriginalPath = ["group", "", "action"];
const g_vecNormalizedPath = Array.from(NormalizeCommandPath(g_vecOriginalPath));
g_Assert.deepEqual(g_vecNormalizedPath, ["group", "action"]);
g_Assert.deepEqual(g_vecOriginalPath, ["group", "", "action"]);

const g_Manager = new CoreCommandManager({ Name: "custom", Logger: g_Logger });
const g_RecordCommand = (CommandContext) => {
	g_vecCommandContexts.push(CommandContext);

	return false;
};
g_Assert.equal(g_Manager.RegisterCommand(["group"], g_RecordCommand, { Description: "Group command" }), g_RecordCommand);
g_Manager.RegisterCommand(["group", "action"], g_RecordCommand, { Description: "Action command" });
g_Assert.equal(g_Manager.RunCommand("custom group action value", { RequestedBy: "Operator", Arguments: null, CommandManager: null }), true);
g_Assert.equal(g_vecCommandContexts.length, 1);
g_Assert.deepEqual(Array.from(g_vecCommandContexts[0].Arguments), ["group", "action", "value"]);
g_Assert.deepEqual(Array.from(g_vecCommandContexts[0].CommandArguments), ["value"]);
g_Assert.equal(g_vecCommandContexts[0].CommandManager, g_Manager);
g_Assert.equal(g_vecCommandContexts[0].RequestedBy, "Operator");
g_Assert.equal(g_Manager.RunCommand(["custom", "group", "tail"]), true);
g_Assert.deepEqual(Array.from(g_vecCommandContexts[1].CommandArguments), ["tail"]);
g_Assert.equal(g_Manager.GetCommandPathKey(["group", "", "action"]), "group action");
g_Assert.deepEqual(Array.from(g_Manager.GetCommandList("group"), (CommandRow) => CommandRow.Signature), ["custom group", "custom group action"]);
g_Assert.equal(g_Manager.GetCommandHelp("group action"), "custom group action - Action command");
g_Assert.equal(g_Manager.GetCommandHelp("missing"), "No commands found for custom missing");
g_Assert.equal(g_Manager.UnregisterCommand("group action"), true);
g_Assert.equal(g_Manager.UnregisterCommand("group action"), false);
g_Assert.equal(g_Manager.RunCommand("custom missing"), false);
g_Assert.deepEqual(g_vecMessages.at(-1), { Severity: "INFO", Message: 'Command "custom missing" was not found.' });

for (const InvalidPath of [null, undefined, 0, {}, [1]]) {
	g_Assert.throws(() => NormalizeCommandPath(InvalidPath), (ErrorValue) => ErrorValue.name === "TypeError");
}

for (const InvalidContext of [null, false, 0, "Context", []]) {
	g_Assert.throws(() => g_Manager.RunCommand("group", InvalidContext), (ErrorValue) => ErrorValue.name === "TypeError");
}

g_Assert.throws(() => g_Manager.RegisterCommand("group", null), (ErrorValue) => ErrorValue.name === "TypeError");
g_Assert.throws(() => g_Manager.RegisterCommand("group", g_RecordCommand, { Description: 1 }), (ErrorValue) => ErrorValue.name === "TypeError");

const g_unConsoleMessageCount = g_vecMessages.length;
g_Assert.equal(g_Core.SendConsoleMessage("Console message regression.\r\n"), undefined);
g_Assert.equal(g_Core.SendConsoleMessage(null), undefined);
g_Assert.equal(g_Core.SendConsoleMessage(73), undefined);
g_Assert.equal(g_Core.SendConsoleMessage("Keep one newline.\n\n"), undefined);
g_Assert.deepEqual(g_vecMessages.slice(g_unConsoleMessageCount), [
	{ Severity: "INFO", Message: "Console message regression." },
	{ Severity: "INFO", Message: "" },
	{ Severity: "INFO", Message: "73" },
	{ Severity: "INFO", Message: "Keep one newline.\n" },
]);

const g_ConsoleMessageConversionFailure = new Error("Console message conversion failed.");
const g_InvalidConsoleMessage = {
	toString() {
		throw g_ConsoleMessageConversionFailure;
	},
};
g_Assert.throws(() => g_Core.SendConsoleMessage(g_InvalidConsoleMessage), (ErrorValue) => ErrorValue === g_ConsoleMessageConversionFailure);
g_Assert.equal(g_vecMessages.length, g_unConsoleMessageCount + 4);

const g_strAuthTestNetworkID = "STEAM_1:0:12345";
const g_strAuthTestPermission = "sourcejs.kick";
const g_vecAuthorizationCalls = [];
const g_Auth = {
	AddPlayerPermission(strSubject, strPermission) {
		g_vecAuthorizationCalls.push(["add", strSubject, strPermission]);

		return true;
	},
	HasPlayerPermission(strSubject, strPermission) {
		g_vecAuthorizationCalls.push(["test", strSubject, strPermission]);

		return true;
	},
	RemovePlayerPermission(strSubject, strPermission) {
		g_vecAuthorizationCalls.push(["remove", strSubject, strPermission]);

		return true;
	},
};

const { DispatchAuthenticationCommand } = LoadPackage("core/command/auth.js", (strModuleName) => {
	switch (strModuleName) {
		case "auth":
			return g_Auth;

		case "core/command":
			return { CORE_COMMAND };

		default:
			throw new Error(`Unexpected authorization dependency ${strModuleName}`);
	}
});

DispatchAuthenticationCommand(["auth"]);
g_Assert.match(g_vecMessages.at(-1).Message, /sjs auth permission player add/);

for (const strAction of ["add", "test", "remove"]) {
	DispatchAuthenticationCommand(["auth", "permission", "player", strAction, g_strAuthTestNetworkID, g_strAuthTestPermission]);
}

g_Assert.deepEqual(g_vecAuthorizationCalls, ["add", "test", "remove"].map((strAction) => [strAction, g_strAuthTestNetworkID, g_strAuthTestPermission]));

DispatchAuthenticationCommand(["auth", "permission", "player", "add", "STEAM_1", ":", "0", ":", "12345", g_strAuthTestPermission]);
g_Assert.deepEqual(g_vecAuthorizationCalls.at(-1), ["add", g_strAuthTestNetworkID, g_strAuthTestPermission]);

for (const vecArguments of [
	["auth", "permission", "player", "add", "", g_strAuthTestPermission],
	["auth", "permission", "player", "add", g_strAuthTestNetworkID],
	["auth", "permission", "player", "add", g_strAuthTestNetworkID, g_strAuthTestPermission, "extra"],
	["auth", "permission", "player", "add", "STEAM_1", ":", "0", ":", "invalid", g_strAuthTestPermission],
	["auth", "permission", "parent", "test", "admins", g_strAuthTestPermission],
	["auth", "permission", "player", "unknown"],
	["info"],
]) {
	DispatchAuthenticationCommand(vecArguments);
	g_Assert.equal(g_vecMessages.at(-1).Severity, "WARNING");
}

g_Assert.equal(g_vecAuthorizationCalls.length, 4);

console.log("Core command and authorization smoke checks passed; native IO disabled.");
