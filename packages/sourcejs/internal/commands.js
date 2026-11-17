"use strict";

const { GetModule } = require("internal/runtime");

const g_CommandModules = Object.freeze({ client: "commands/client", say: "commands/say", server: "commands/server" });
const g_CommandsRuntime = GetModule("commands");

function GetCommandModuleRuntime(strCommandKind) {
	if ((typeof strCommandKind !== "string") || !Object.hasOwn(g_CommandModules, strCommandKind)) {
		throw new TypeError("GetCommandModuleRuntime(strCommandKind) expects client, say, or server.");
	}

	return GetModule(g_CommandModules[strCommandKind]);
}

module.exports = {
	BLOCK: g_CommandsRuntime.BLOCK,
	CONTINUE: g_CommandsRuntime.CONTINUE,
	CommandReturn: g_CommandsRuntime.CommandReturn,
	HANDLED: g_CommandsRuntime.HANDLED,
	CommandsRuntime: g_CommandsRuntime,
	ExecuteCommand: g_CommandsRuntime.ExecuteServerCommand,
	GetCommandModuleRuntime,
	MAX_COMMAND_LENGTH: g_CommandsRuntime.MAX_COMMAND_LENGTH,
	RegisterCommand: g_CommandsRuntime.RegisterCommand,
	UnregisterCommand: g_CommandsRuntime.UnregisterCommand,
};
