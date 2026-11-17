"use strict";

const { LogInfo } = require("loggers");
const { CreateChannel } = require("plugins/bus");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strPluginName = "plugin-bus";
const g_strCommandName = "sjs_plugin_bus";
const g_MessageChannel = CreateChannel("Examples:PluginBus", { Source: g_strPluginName });
let g_bUnloading = false;
let g_bCleanupInProgress = false;
let g_bCommandRegistered = false;
let g_bMessageRegistered = false;

function GetCommandArguments(Command) {
	return Command.Arguments.slice(1);
}

function OnMessage(Payload, Envelope) {
	if (g_bUnloading) {
		return;
	}

	LogInfo("%s", `Message ${Envelope.Source || "anonymous"} -> ${Envelope.Target || "*"}: ${JSON.stringify(Payload)}`);
}

function RunCommand(Command) {
	if (g_bUnloading) {
		return;
	}

	const vecCommandArguments = GetCommandArguments(Command);
	const strText = (vecCommandArguments.length > 0) ? vecCommandArguments.join(" ") : "hello from plugin-bus";

	if (g_bUnloading) {
		return;
	}

	g_MessageChannel.Emit({ Text: strText }, { Type: "example" });
}

function Cleanup() {
	g_bUnloading = true;

	if (g_bCleanupInProgress) {
		return false;
	}

	g_bCleanupInProgress = true;

	const vecCleanupErrors = [];
	try {
		if (g_bMessageRegistered) {
			try {
				if (!g_MessageChannel.Off(OnMessage)) {
					throw new Error("Unable to remove the plugin-bus message listener.");
				}

				g_bMessageRegistered = false;
			} catch (CleanupError) {
				vecCleanupErrors.push(CleanupError);
			}
		}

		if (g_bCommandRegistered) {
			try {
				if (!UnregisterCommand(g_strCommandName, RunCommand)) {
					throw new Error(`Unable to remove the ${g_strCommandName} command.`);
				}

				g_bCommandRegistered = false;
			} catch (CleanupError) {
				vecCleanupErrors.push(CleanupError);
			}
		}
	} finally {
		g_bCleanupInProgress = false;
	}

	if (vecCleanupErrors.length > 0) {
		throw new AggregateError(vecCleanupErrors, "Unable to clean up the plugin-bus example.");
	}

	return true;
}

function Initialize() {
	g_bMessageRegistered = g_MessageChannel.On(OnMessage);
	if (!g_bMessageRegistered) {
		throw new Error("Unable to register the plugin-bus message listener.");
	}

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	g_bCommandRegistered = RegisterCommand(g_strCommandName, RunCommand);
	if (!g_bCommandRegistered) {
		throw new Error(`Unable to register the ${g_strCommandName} command.`);
	}

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	LogInfo("%s", `Loaded; run "${g_strCommandName} <message>".`);
}

exports.Unload = Cleanup;

try {
	Initialize();
} catch (InitializationError) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([InitializationError, CleanupError], "Plugin-bus example initialization and cleanup failed.");
	}

	throw InitializationError;
}
