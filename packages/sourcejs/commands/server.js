"use strict";

const { GetCommandModuleRuntime } = require("internal/commands");

const g_ServerCommandRuntime = GetCommandModuleRuntime("server");

module.exports = {
	ExecuteCommand: g_ServerCommandRuntime.ExecuteServerCommand,
	RegisterCommand: g_ServerCommandRuntime.RegisterCommand,
	UnregisterCommand: g_ServerCommandRuntime.UnregisterCommand,
};
