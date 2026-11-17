#!/usr/bin/env node

"use strict";

const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strAuthorizationPath = g_Path.join(g_strPackageRoot, "auth.js");
const g_strCommandsPath = g_Path.join(g_strPackageRoot, "commands.js");
const g_strCommandsAuthorizationPath = g_Path.join(g_strPackageRoot, "commands", "auth.js");
const g_strCommandsManagerPath = g_Path.join(g_strPackageRoot, "commands", "manager.js");
const g_strCommandsPlayerPath = g_Path.join(g_strPackageRoot, "commands", "player.js");
const g_strCommandsTypedPath = g_Path.join(g_strPackageRoot, "commands", "typed.js");
const g_strFiltersPlayersPath = g_Path.join(g_strPackageRoot, "filters", "players.js");
const g_strLoggersPath = g_Path.join(g_strPackageRoot, "loggers.js");
const g_strMessagesPath = g_Path.join(g_strPackageRoot, "messages.js");

process.env.NODE_PATH = [g_strPackageRoot, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const g_unMaximumCommandLength = 511;

const g_vecAuthorizationChecks = [];
const g_mapRegisteredCallbacks = new Map();
const g_vecUnregisteredCallbacks = [];

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertJSON(ActualValue, ExpectedValue, strErrorMessage) {
	AssertEqual(JSON.stringify(ActualValue), JSON.stringify(ExpectedValue), strErrorMessage);
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

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

function CreateCommandRuntime(strRuntimeName) {
	function Register(strName, Callback) {
		if ((typeof strName !== "string") || (strName.length === 0) || (typeof Callback !== "function")) {
			throw new TypeError("Native command registration requires a name and callback.");
		}

		g_mapRegisteredCallbacks.set(`${strRuntimeName}:${strName}`, Callback);

		return true;
	}

	function Unregister(strName, Callback) {
		if (g_mapRegisteredCallbacks.get(`${strRuntimeName}:${strName}`) !== Callback) {
			return false;
		}

		g_vecUnregisteredCallbacks.push([strRuntimeName, strName, Callback]);
		g_mapRegisteredCallbacks.delete(`${strRuntimeName}:${strName}`);

		return true;
	}

	if (strRuntimeName === "client") {
		return Object.freeze({ RegisterClientCommand: Register, UnregisterClientCommand: Unregister });
	}

	if (strRuntimeName === "say") {
		return Object.freeze({ RegisterSayCommand: Register, UnregisterSayCommand: Unregister });
	}

	if (strRuntimeName === "server") {
		return Object.freeze({ RegisterCommand: Register, UnregisterCommand: Unregister });
	}

	throw new TypeError("Unknown native command runtime.");
}

const g_CommandReturn = Object.freeze({
	Block: 1,
	Continue: 0,
	Handled: 1,
});
const g_RootCommandRuntime = {
	BLOCK: g_CommandReturn.Block,
	CONTINUE: g_CommandReturn.Continue,
	CommandReturn: g_CommandReturn,
	HANDLED: g_CommandReturn.Handled,
	ExecuteServerCommand() {
		return g_CommandReturn.Continue;
	},
	MAX_COMMAND_LENGTH: g_unMaximumCommandLength,
	RegisterCommand() {
		return true;
	},
	UnregisterCommand() {
		return true;
	},
};

const g_NativeAuthorization = {
	HasPlayerPermission(nPlayerIndex, strPermission) {
		g_vecAuthorizationChecks.push([nPlayerIndex, strPermission]);

		return (nPlayerIndex === 2) && (strPermission === "sourcejs.admin");
	},
};

InstallDependency(g_strAuthorizationPath, g_NativeAuthorization);
InstallDependency(g_strFiltersPlayersPath, {
	GetBotPlayers() {
		return [];
	},
	GetPlayersByTeam() {
		return [];
	},
	GetConnectedPlayers() {
		return [];
	},
	GetHumanPlayers() {
		return [];
	},
});
InstallDependency(g_strLoggersPath, {
	LogInfo() {
		return true;
	},
});
InstallDependency(g_strMessagesPath, {
	SendClientConsoleMessage() {
		return true;
	},
});

globalThis.sourcejs = {
	commands: g_RootCommandRuntime,
	"commands/client": CreateCommandRuntime("client"),
	"commands/say": CreateCommandRuntime("say"),
	"commands/server": CreateCommandRuntime("server"),
};

function CreateCommand(Command, strRawCommand, nIndex, strKind = "client") {
	const vecCommandArguments = strRawCommand.split(" ");

	return new Command({
		Arguments: vecCommandArguments,
		Index: nIndex,
		Kind: strKind,
		Message: "",
		Name: vecCommandArguments[0],
		Raw: strRawCommand,
		TeamOnly: false,
	});
}

try {
	const Commands = require(g_strCommandsPath);
	const { CreateAuthorizedCommandCallback } = require(g_strCommandsAuthorizationPath);
	const { CommandRegistrationManager } = require(g_strCommandsManagerPath);
	const { PlayerCommandRegistrationManager } = require(g_strCommandsPlayerPath);
	const Typed = require(g_strCommandsTypedPath);
	AssertEqual(Typed.TypedServerCommandRegistration.Manager.Runtime.Register, globalThis.sourcejs["commands/server"].RegisterCommand, "typed server registration export");
	AssertEqual(Typed.TypedServerCommandRegistration.Manager.Runtime.Unregister, globalThis.sourcejs["commands/server"].UnregisterCommand, "typed server unregistration export");
	AssertEqual(Typed.TypedClientCommandRegistration.Manager.Runtime.Register, globalThis.sourcejs["commands/client"].RegisterClientCommand, "typed client registration export");
	AssertEqual(Typed.TypedClientCommandRegistration.Manager.Runtime.Unregister, globalThis.sourcejs["commands/client"].UnregisterClientCommand, "typed client unregistration export");
	AssertEqual(Typed.TypedSayCommandRegistration.Manager.Runtime.Register, globalThis.sourcejs["commands/say"].RegisterSayCommand, "typed say registration export");
	AssertEqual(Typed.TypedSayCommandRegistration.Manager.Runtime.Unregister, globalThis.sourcejs["commands/say"].UnregisterSayCommand, "typed say unregistration export");

	for (const strModuleName of ["commands/server", "commands/client", "commands/say"]) {
		const NativeRuntime = globalThis.sourcejs[strModuleName];
		AssertEqual(Object.hasOwn(NativeRuntime, "Register"), false, "native runtime has no generic Register alias");
		AssertEqual(Object.hasOwn(NativeRuntime, "Unregister"), false, "native runtime has no generic Unregister alias");
	}

	const { Command } = Commands;

	AssertEqual(Commands.CommandReturn, g_CommandReturn, "commands should expose the native CommandReturn object");
	AssertEqual(Commands.CommandReturn.Block, Commands.BLOCK, "CommandReturn.Block");
	AssertEqual(Commands.CommandReturn.Continue, Commands.CONTINUE, "CommandReturn.Continue");
	AssertEqual(Commands.CommandReturn.Handled, Commands.HANDLED, "CommandReturn.Handled");
	AssertEqual(Object.hasOwn(Commands, "ModuleName"), false, "commands should not expose ModuleName");
	AssertThrows(() => CreateCommand(Command, "sjs_bad", 1.5), "Command should reject an invalid index");
	AssertThrows(() => new Command({ Arguments: [7], Index: 1, Kind: "client", Name: "sjs_bad", Raw: "sjs_bad" }), "Command should reject scalar argument coercion");

	let strAuthorizedCommandName = null;
	const AuthorizedCallback = CreateAuthorizedCommandCallback((CommandValue) => {
		strAuthorizedCommandName = CommandValue.Name;

		return g_CommandReturn.Block;
	}, "sourcejs.admin");
	AssertEqual(AuthorizedCallback(CreateCommand(Command, "sjs_test one", 2)), g_CommandReturn.Block, "authorized callback result");
	AssertEqual(strAuthorizedCommandName, "sjs_test", "authorized callback command");
	AssertJSON(g_vecAuthorizationChecks.at(-1), [2, "sourcejs.admin"], "authorization arguments");

	let nFailureCommandIndex = 0;
	const DeniedCallback = CreateAuthorizedCommandCallback(() => {
		throw new Error("Denied callback should not run.");
	}, "sourcejs.admin", (CommandValue) => {
		nFailureCommandIndex = CommandValue.Index;

		return g_CommandReturn.Handled;
	});
	AssertEqual(DeniedCallback(CreateCommand(Command, "sjs_test", 3)), g_CommandReturn.Handled, "denied failure callback result");
	AssertEqual(nFailureCommandIndex, 3, "denied failure callback command");
	AssertEqual(CreateAuthorizedCommandCallback(() => g_CommandReturn.Block, "sourcejs.admin")(CreateCommand(Command, "sjs_test", 4)), g_CommandReturn.Continue, "denied default result");
	AssertEqual(CreateAuthorizedCommandCallback(() => g_CommandReturn.Block)(CreateCommand(Command, "sjs_test", 5)), g_CommandReturn.Block, "permission-free callback");

	const ClientRuntime = globalThis.sourcejs["commands/client"];
	const PlayerManager = new PlayerCommandRegistrationManager({ Register: ClientRuntime.RegisterClientCommand, Unregister: ClientRuntime.UnregisterClientCommand });
	const PlayerRegistration = PlayerManager.Register(["sjs_admin", "sjs_root"], () => g_CommandReturn.Block, "sourcejs.admin");

	AssertEqual(g_mapRegisteredCallbacks.size, 2, "player manager registration count");
	AssertEqual(g_mapRegisteredCallbacks.get("client:sjs_admin")(CreateCommand(Command, "sjs_admin", 2)), g_CommandReturn.Block, "player manager authorized dispatch");
	AssertEqual(g_mapRegisteredCallbacks.get("client:sjs_admin")(CreateCommand(Command, "sjs_admin", 1)), g_CommandReturn.Continue, "player manager denied dispatch");
	AssertEqual(PlayerManager.Unregister(PlayerRegistration), true, "player manager Unregister");
	AssertEqual(g_vecUnregisteredCallbacks.length, 2, "player manager unregister count");
	AssertThrows(() => PlayerManager.Unregister(PlayerRegistration), "player manager should reject a released registration");

	const ServerRuntime = globalThis.sourcejs["commands/server"];
	const BaseManager = new CommandRegistrationManager({ Register: ServerRuntime.RegisterCommand, Unregister: ServerRuntime.UnregisterCommand });
	const BaseRegistration = BaseManager.Register("sjs_plain", () => g_CommandReturn.Continue);
	AssertEqual(BaseRegistration.Loaded, true, "base registration load state");
	AssertEqual(BaseManager.UnloadAll(), true, "base manager UnloadAll");
	AssertEqual(BaseRegistration.Loaded, false, "base registration unload state");

	const TypedRegistration = new Typed.TypedServerCommandRegistration("sjs_typed_smoke");
	TypedRegistration.Register((CommandContext) => CommandContext.AutoCommandReturn);
	AssertEqual(typeof g_mapRegisteredCallbacks.get("server:sjs_typed_smoke"), "function", "typed command native registration");
	AssertEqual(
		g_mapRegisteredCallbacks.get("server:sjs_typed_smoke")({
			Arguments: ["sjs_typed_smoke"],
			Index: 0,
			Kind: "server",
			Name: "sjs_typed_smoke",
			Raw: "sjs_typed_smoke",
		}),
		g_CommandReturn.Continue,
		"typed command dispatch");
	AssertEqual(TypedRegistration.Unload(), true, "typed command Unload");
	AssertEqual(TypedRegistration.Unload(), false, "typed command idempotent Unload");
	AssertEqual(Object.hasOwn(Typed, "ModuleName"), false, "typed commands should not expose ModuleName");

	console.log("[smoke_commands_auth_player] ok");
} finally {
	delete globalThis.sourcejs;
}
