"use strict";

const { Command, CommandReturn, ExecuteCommand } = require("commands");
const g_ClientCommands = require("commands/client");
const g_SayCommands = require("commands/say");
const g_ServerCommands = require("commands/server");
const { RegisterTypedServerCommand } = require("commands/typed");
const { ConfigManager, ResolveConfigPath } = require("config");
const {
	CreateConVar,
	DoesConVarExist,
	GetConVar,
	GetConVarBoolean,
	GetConVarFloat,
	GetConVarInteger,
	GetConCommandBaseRecords,
	RequireConVar,
	RevertConVarToDefault,
	SetConVar,
} = require("cvars");
const { NOTIFY } = require("cvars/flags");
const { IsConVarPublic, RegisterPublicConVar } = require("cvars/public");
const { HasServerTag, GetServerTags } = require("cvars/tags");
const { RegisterPluginUnloadingListener } = require("listeners");
const { LogInfo, LogWarning } = require("loggers");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strPluginName = "api-commands-cvars";
const g_strCommandName = "sjs_api_commands";
const g_strTypedCommandName = "sjs_api_typed";
const g_strServerCommandName = "sjs_api_server";
const g_strClientCommandName = "sjs_api_client";
const g_strPublicSayCommandName = "!sjsapi";
const g_strPrivateSayCommandName = "/sjsapi";
const g_unSummaryEntryLimit = 8;
const g_unConfigurationPreviewWidth = 48;
const g_setSayCommandNames = new Set([g_strPublicSayCommandName, g_strPrivateSayCommandName]);
const g_TypedEchoRegistration = RegisterTypedServerCommand([g_strTypedCommandName, "echo"], { Parameters: [{ Name: "Message", Rest: true, Type: String }] });

const g_setPendingRegistrations = new Set();
let g_bCleaning = false;

function TrackRegistration(strName, Release) {
	const Registration = { Name: strName, Release: Release };
	g_setPendingRegistrations.add(Registration);

	return Registration;
}

function ReleaseRegistration(Registration) {
	if (!g_setPendingRegistrations.has(Registration)) {
		return;
	}

	if (Registration.Release() !== true) {
		throw new Error("Could not release " + Registration.Name + ".");
	}

	g_setPendingRegistrations.delete(Registration);
}

function GetCommandArguments(InputCommand) {
	return new Command(InputCommand).Arguments.slice(1);
}

function SummarizeValue(Value) {
	if (Array.isArray(Value)) {
		return `${Value.length} entries`;
	}

	if (Value && (typeof Value === "object")) {
		return `{ ${Object.keys(Value).slice(0, g_unSummaryEntryLimit).join(", ")} }`;
	}

	return String(Value);
}

function LogResult(strLabel, Value) {
	LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);
}

function ShowCommandAndConVarAPI(InputCommand) {
	const vecCommandArguments = GetCommandArguments(InputCommand);
	const bSetRequested = (vecCommandArguments[0] === "set") && (vecCommandArguments.length >= 4);
	const bConfirmed = vecCommandArguments[vecCommandArguments.length - 1] === "confirm";
	if ((vecCommandArguments.length > 0) && (!bSetRequested || !bConfirmed)) {
		LogWarning(`Usage: ${g_strCommandName} [set <cvar> <value> confirm]`);
		return CommandReturn.Handled;
	}

	if (bSetRequested && bConfirmed) {
		const strConVarName = vecCommandArguments[1];
		const strConVarValue = vecCommandArguments.slice(2, -1).join(" ");
		LogResult(`cvars.SetConVar(${strConVarName})`, SetConVar(strConVarName, strConVarValue));
		return CommandReturn.Handled;
	}

	LogResult("commands.ExecuteCommand", ExecuteCommand("echo SourceJS commands example"));

	const ParsedCommand = new Command(InputCommand);
	LogResult("commands.Command", {
		ArgumentString: ParsedCommand.ArgumentString,
		FirstArgument: ParsedCommand.GetArgument(0),
		ClientIndex: ParsedCommand.Index,
		Kind: ParsedCommand.Kind,
		ArgumentCount: ParsedCommand.Length,
		SecondArgument: ParsedCommand.GetArgument(1),
	});
	LogResult("cvars.DoesConVarExist(hostname)", DoesConVarExist("hostname"));
	LogResult("cvars.GetConVar(hostname)", GetConVar("hostname"));
	LogResult("cvars.GetConVarInteger(sv_cheats)", GetConVarInteger("sv_cheats"));
	LogResult("cvars.GetConVarFloat(host_timescale)", GetConVarFloat("host_timescale"));
	LogResult("cvars.GetConVarBoolean(sv_lan)", GetConVarBoolean("sv_lan"));

	const ConVar = RequireConVar("hostname");
	const ExampleConVar = CreateConVar("sourcejs_api_commands_demo", "0", "SourceJS cvars example", 0);
	SetConVar(ExampleConVar.Name, 1);
	const nChangedValue = ExampleConVar.IntValue;
	RevertConVarToDefault(ExampleConVar.Name);
	LogResult("cvars live ConVar", {
		ChangedValue: nChangedValue,
		DefaultValue: ExampleConVar.DefaultValue,
		Exists: ConVar.Exists,
		Flags: ConVar.Flags,
		HasMinimum: ConVar.HasMinimum,
		Address: ExampleConVar.Address,
		Value: ExampleConVar.Value,
	});
	LogResult(
		"cvars.GetConCommandBaseRecords",
		GetConCommandBaseRecords().slice(0, g_unSummaryEntryLimit).map(function GetConCommandBaseRecordName(Record) {
			return Record.Name;
		}),
	);
	LogResult("cvars/public.IsConVarPublic(hostname)", IsConVarPublic("hostname"));

	const PublicConVarRegistration = RegisterPublicConVar("sourcejs_api_public_demo", "0", "SourceJS public cvar example", { Flags: NOTIFY });
	const PendingPublicConVarRegistration = TrackRegistration("public ConVar " + PublicConVarRegistration.Name, () => PublicConVarRegistration.UnregisterPublicConVar(true));
	const vecPublicConVarErrors = [];
	let PublicConVarResult = null;

	try {
		PublicConVarResult = { Name: PublicConVarRegistration.Name, Public: IsConVarPublic(PublicConVarRegistration.Name), Value: PublicConVarRegistration.ConVar.Value };
	} catch (CaughtError) {
		vecPublicConVarErrors.push(CaughtError);
	}

	try {
		ReleaseRegistration(PendingPublicConVarRegistration);
	} catch (CleanupError) {
		vecPublicConVarErrors.push(CleanupError);
	}

	if (vecPublicConVarErrors.length === 1) {
		throw vecPublicConVarErrors[0];
	}

	if (vecPublicConVarErrors.length > 1) {
		throw new AggregateError(vecPublicConVarErrors, "Public ConVar inspection and cleanup failed.");
	}

	LogResult("cvars/public.PublicConVarRegistration", PublicConVarResult);

	const vecTags = GetServerTags();
	LogResult("cvars/tags.GetServerTags", vecTags);
	LogResult("cvars/tags.HasServerTag", { Count: vecTags.length, HasSourceJS: HasServerTag("sourcejs") });
	LogResult("cvars/flags.NOTIFY", NOTIFY);

	const strConfigurationPath = ResolveConfigPath("sourcejs/api-commands-cvars-preview.cfg");
	const ExampleConfigurationManager = new ConfigManager(strConfigurationPath, { MaxLineLength: g_unConfigurationPreviewWidth, PreserveUnused: false });
	ExampleConfigurationManager.AddConfigSection("SourceJS command example", { Width: g_unConfigurationPreviewWidth });
	ExampleConfigurationManager.AddCVarConfigEntry("sourcejs_api_commands_demo", "0", "Enable the commands example.");
	ExampleConfigurationManager.AddCommandConfigEntry("echo", "Print a config-generated message.", { Arguments: ["SourceJS", "config", "example"] });
	LogResult("config.ResolveConfigPath", strConfigurationPath);
	LogResult("config/manager RenderConfig", ExampleConfigurationManager.RenderConfig());
	LogInfo(`Use "${g_strCommandName} set <cvar> <value> confirm" to run cvars.SetConVar.`);

	return CommandReturn.Continue;
}

function OnServerCommand(InputCommand) {
	LogInfo("%s", `Server command arguments: ${GetCommandArguments(InputCommand).join(" ")}`);

	return CommandReturn.Handled;
}

function OnClientCommand(InputCommand) {
	const ParsedCommand = new Command(InputCommand);
	LogInfo("%s", `Client command from index ${ParsedCommand.Index}: ${ParsedCommand.ArgumentString}`);

	return CommandReturn.Block;
}

function OnSayCommand(InputCommand) {
	const ParsedCommand = new Command(InputCommand);
	LogInfo("%s", `Say command from index ${ParsedCommand.Index}: ${ParsedCommand.ArgumentString}`);

	return CommandReturn.Block;
}

function OnClientCommandFilter(InputCommand) {
	const ParsedCommand = new Command(InputCommand);
	if (ParsedCommand.Name === g_strClientCommandName) {
		LogInfo(`Client filter observed ${ParsedCommand.Name}`);
	}

	return CommandReturn.Continue;
}

function OnSayCommandFilter(InputCommand) {
	const ParsedCommand = new Command(InputCommand);
	const bIsExampleCommand = g_setSayCommandNames.has(ParsedCommand.Name);
	if (bIsExampleCommand) {
		LogInfo(`Say filter observed ${ParsedCommand.Name}`);
	}

	return CommandReturn.Continue;
}

function OnTypedCommand(Context, ...vecMessageParts) {
	const strMessage = vecMessageParts.join(" ") || "typed command works";
	LogInfo("%s", `Typed echo: ${strMessage}`);

	return Context.Reply(strMessage);
}

function Cleanup() {
	if (g_bCleaning) {
		return;
	}

	g_bCleaning = true;
	const vecErrors = [];
	try {
		for (const Registration of [...g_setPendingRegistrations]) {
			try {
				ReleaseRegistration(Registration);
			} catch (CleanupError) {
				vecErrors.push(CleanupError);
			}
		}
	} finally {
		g_bCleaning = false;
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Command example cleanup failed.");
	}
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (strUnloadingPluginName === g_strPluginName) {
		Cleanup();
	}
}

function UnloadPlugin() {
	Cleanup();
}

exports.Unload = UnloadPlugin;

try {
	if (!RegisterCommand(g_strCommandName, ShowCommandAndConVarAPI)) {
		throw new Error(`Could not register ${g_strCommandName}.`);
	}

	TrackRegistration("source command", () => UnregisterCommand(g_strCommandName, ShowCommandAndConVarAPI));
	g_TypedEchoRegistration.Register(OnTypedCommand);
	TrackRegistration("typed command", () => g_TypedEchoRegistration.Unload());

	if (!g_ServerCommands.RegisterCommand(g_strServerCommandName, OnServerCommand)) {
		throw new Error(`Could not register ${g_strServerCommandName}.`);
	}

	TrackRegistration("server command", () => g_ServerCommands.UnregisterCommand(g_strServerCommandName, OnServerCommand));

	if (!g_ClientCommands.RegisterCommand(g_strClientCommandName, OnClientCommand)) {
		throw new Error(`Could not register ${g_strClientCommandName}.`);
	}

	TrackRegistration("client command", () => g_ClientCommands.UnregisterCommand(g_strClientCommandName, OnClientCommand));

	if (!g_SayCommands.RegisterCommand(g_strPublicSayCommandName, OnSayCommand)) {
		throw new Error(`Could not register ${g_strPublicSayCommandName}.`);
	}

	TrackRegistration("public say command", () => g_SayCommands.UnregisterCommand(g_strPublicSayCommandName, OnSayCommand));

	if (!g_SayCommands.RegisterCommand(g_strPrivateSayCommandName, OnSayCommand)) {
		throw new Error(`Could not register ${g_strPrivateSayCommandName}.`);
	}

	TrackRegistration("private say command", () => g_SayCommands.UnregisterCommand(g_strPrivateSayCommandName, OnSayCommand));

	if (!g_ClientCommands.RegisterCommandFilter(OnClientCommandFilter)) {
		throw new Error("Could not register the client command filter.");
	}

	TrackRegistration("client command filter", () => g_ClientCommands.UnregisterCommandFilter(OnClientCommandFilter));

	if (!g_SayCommands.RegisterCommandFilter(OnSayCommandFilter)) {
		throw new Error("Could not register the say command filter.");
	}

	TrackRegistration("say command filter", () => g_SayCommands.UnregisterCommandFilter(OnSayCommandFilter));
	const PluginUnloadingRegistration = RegisterPluginUnloadingListener(HandlePluginUnloading);
	TrackRegistration("plugin unloading listener", () => PluginUnloadingRegistration.DisposeListener());

	LogWarning(`${g_strCommandName} set changes a live ConVar only after the confirm token.`);
	LogInfo(`Plugin loaded; run "${g_strCommandName}", "${g_strServerCommandName}" or "${g_strTypedCommandName} echo text".`);
} catch (CaughtError) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "Command example startup and cleanup failed.");
	}

	throw CaughtError;
}
