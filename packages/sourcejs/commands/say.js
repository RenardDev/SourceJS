"use strict";

const { GetCommandModuleRuntime } = require("internal/commands");

const g_SayCommandRuntime = GetCommandModuleRuntime("say");

module.exports = {
	RegisterCommand: g_SayCommandRuntime.RegisterSayCommand,
	RegisterCommandFilter: g_SayCommandRuntime.RegisterSayCommandFilter,
	SayCommand: g_SayCommandRuntime.Say,
	SayTeamCommand: g_SayCommandRuntime.SayToTeam,
	UnregisterCommand: g_SayCommandRuntime.UnregisterSayCommand,
	UnregisterCommandFilter: g_SayCommandRuntime.UnregisterSayCommandFilter,
};
