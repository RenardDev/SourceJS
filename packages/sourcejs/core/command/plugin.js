"use strict";

const {
	DisablePlugin: g_DisableNativePlugin,
	EnablePlugin: g_EnableNativePlugin,
	List,
	LoadPlugin: g_LoadNativePlugin,
	ReloadPlugin: g_ReloadNativePlugin,
	ReloadAllPlugins: g_ReloadAllNativePlugins,
	UnloadPlugin: g_UnloadNativePlugin,
	UnloadAllPlugins: g_UnloadAllNativePlugins,
} = require("plugins");
const { CORE_COMMAND } = require("core/command");

const g_strModuleName = "core/command/plugin";

function LoadPlugin(strPluginName) {
	const bPluginLoaded = g_LoadNativePlugin(strPluginName);
	const strLoadResultMessage = bPluginLoaded ? `Plugin "${strPluginName}" has been loaded.` : `Unable to load plugin "${strPluginName}".`;
	CORE_COMMAND.LogCommandMessage(strLoadResultMessage);

	return bPluginLoaded;
}

function UnloadPlugin(PluginSelector) {
	const bPluginUnloaded = g_UnloadNativePlugin(PluginSelector);
	const strUnloadResultMessage = bPluginUnloaded ? `Plugin "${PluginSelector}" has been unloaded.` : `Unable to unload plugin "${PluginSelector}".`;
	CORE_COMMAND.LogCommandMessage(strUnloadResultMessage);

	return bPluginUnloaded;
}

function ReloadPlugin(PluginSelector) {
	const bPluginReloaded = g_ReloadNativePlugin(PluginSelector);
	const strReloadResultMessage = bPluginReloaded ? `Plugin "${PluginSelector}" has been reloaded.` : `Unable to reload plugin "${PluginSelector}".`;
	CORE_COMMAND.LogCommandMessage(strReloadResultMessage);

	return bPluginReloaded;
}

function UnloadAllPlugins() {
	const bUnloadPassCompleted = g_UnloadAllNativePlugins();
	const strUnloadAllResultMessage = bUnloadPassCompleted ? "Plugin unload pass has completed." : "Unable to complete the plugin unload pass.";
	CORE_COMMAND.LogCommandMessage(strUnloadAllResultMessage);

	return bUnloadPassCompleted;
}

function ReloadAllPlugins() {
	const bReloadPassCompleted = g_ReloadAllNativePlugins();
	const strReloadAllResultMessage = bReloadPassCompleted ? "Enabled plugin reload pass has completed." : "Unable to complete the enabled plugin reload pass.";
	CORE_COMMAND.LogCommandMessage(strReloadAllResultMessage);

	return bReloadPassCompleted;
}

function DisablePlugin(PluginSelector) {
	const bPluginDisabled = g_DisableNativePlugin(PluginSelector);
	const strDisableResultMessage = bPluginDisabled ? `Plugin "${PluginSelector}" has been disabled.` : `Unable to disable plugin "${PluginSelector}".`;
	CORE_COMMAND.LogCommandMessage(strDisableResultMessage);

	return bPluginDisabled;
}

function EnablePlugin(PluginSelector) {
	const bPluginEnabled = g_EnableNativePlugin(PluginSelector);
	const strEnableResultMessage = bPluginEnabled ? `Plugin "${PluginSelector}" has been enabled.` : `Unable to enable plugin "${PluginSelector}".`;
	CORE_COMMAND.LogCommandMessage(strEnableResultMessage);

	return bPluginEnabled;
}

function PrintPlugins() {
	const vecPluginList = List();
	const strPluginListText = (vecPluginList.length > 0) ? vecPluginList.join("\n") : "No SourceJS plugins found.";
	CORE_COMMAND.LogCommandMessage(strPluginListText);

	return vecPluginList;
}

CORE_COMMAND.RegisterCommand(["plugins"], PrintPlugins, { Description: "List SourceJS plugins." });
CORE_COMMAND.RegisterCommand(["plugins", "list"], PrintPlugins, { Description: "List SourceJS plugins." });
CORE_COMMAND.RegisterCommand(["plugins", "load"], function LoadPluginCommand(CommandContext) {
	const [strPluginName] = CommandContext.CommandArguments;

	return LoadPlugin(strPluginName);
}, { Description: "Load a SourceJS plugin." });
CORE_COMMAND.RegisterCommand(["plugins", "unload"], function UnloadPluginCommand(CommandContext) {
	const [strPluginSelector] = CommandContext.CommandArguments;

	return UnloadPlugin(strPluginSelector);
}, { Description: "Unload a SourceJS plugin." });
CORE_COMMAND.RegisterCommand(["plugins", "unload_all"], UnloadAllPlugins, { Description: "Unload all SourceJS plugins." });
CORE_COMMAND.RegisterCommand(["plugins", "reload"], function ReloadPluginCommand(CommandContext) {
	const [strPluginSelector] = CommandContext.CommandArguments;

	return ReloadPlugin(strPluginSelector);
}, { Description: "Reload a SourceJS plugin." });
CORE_COMMAND.RegisterCommand(["plugins", "reload_all"], ReloadAllPlugins, { Description: "Reload all enabled SourceJS plugins." });
CORE_COMMAND.RegisterCommand(["plugins", "disable"], function DisablePluginCommand(CommandContext) {
	const [strPluginSelector] = CommandContext.CommandArguments;

	return DisablePlugin(strPluginSelector);
}, { Description: "Disable a SourceJS plugin." });
CORE_COMMAND.RegisterCommand(["plugins", "enable"], function EnablePluginCommand(CommandContext) {
	const [strPluginSelector] = CommandContext.CommandArguments;

	return EnablePlugin(strPluginSelector);
}, { Description: "Enable a SourceJS plugin." });

module.exports = {
	MODULE_NAME: g_strModuleName,
	DisablePlugin,
	EnablePlugin,
	LoadPlugin,
	PrintPlugins,
	ReloadAllPlugins,
	ReloadPlugin,
	UnloadAllPlugins,
	UnloadPlugin,
};
