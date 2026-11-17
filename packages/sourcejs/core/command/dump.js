"use strict";

const { CORE_COMMAND } = require("core/command");
const {
	DumpClassInfo,
	DumpConVars,
	DumpDataMaps,
	DumpEntities,
	DumpServerClasses,
	DumpStringTables,
	DumpWeaponScripts,
} = require("core/dumps");

const g_strModuleName = "core/command/dump";
const g_mapDumpHandlers = new Map([
	["ClassInfo", DumpClassInfo],
	["ConVars", DumpConVars],
	["DataMaps", DumpDataMaps],
	["Entities", DumpEntities],
	["ServerClasses", DumpServerClasses],
	["StringTables", DumpStringTables],
	["WeaponScripts", DumpWeaponScripts],
]);

function RunDump(strName, strFileName = strName) {
	const DumpHandler = g_mapDumpHandlers.get(strName);
	if (!DumpHandler) {
		throw new Error(`Unknown dump command: ${strName}`);
	}

	const strDumpPath = DumpHandler(strFileName);
	CORE_COMMAND.LogCommandMessage(`Dump written to ${strDumpPath}`);

	return strDumpPath;
}

for (const strName of g_mapDumpHandlers.keys()) {
	CORE_COMMAND.RegisterCommand(["dump", strName], function RunNamedDumpCommand(CommandContext) {
		const [strRequestedFileName] = CommandContext.CommandArguments;

		return RunDump(strName, strRequestedFileName || strName);
	}, { Description: `Write the ${strName} dump.` });
}

module.exports = { MODULE_NAME: g_strModuleName, RunDump };
