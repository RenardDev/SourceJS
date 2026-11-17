"use strict";

const { GetCommandModuleRuntime } = require("internal/commands");

const g_ClientCommandRuntime = GetCommandModuleRuntime("client");

module.exports = {
	RegisterCommand: g_ClientCommandRuntime.RegisterClientCommand,
	RegisterCommandFilter: g_ClientCommandRuntime.RegisterClientCommandFilter,
	SendCommand: g_ClientCommandRuntime.SendClientCommand,
	UnregisterCommand: g_ClientCommandRuntime.UnregisterClientCommand,
	UnregisterCommandFilter: g_ClientCommandRuntime.UnregisterClientCommandFilter,
};
