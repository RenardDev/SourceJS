"use strict";

const { HasPlayerPermission } = require("auth");
const { BLOCK, CONTINUE, Command } = require("commands");
const g_ClientCommands = require("commands/client");
const g_ServerCommands = require("commands/server");
const { Tokenizer } = require("core");
const { LogInfo } = require("core/logger");
const { CreateConVar } = require("cvars");
const { PrintToClientConsole } = require("engines/server");
const { GetAllPlayers } = require("filters/players");
const { GetModule } = require("internal/runtime");
const { GetUserMessageIndex, HUD_DESTINATION, HUDTextMessage, SayText, SayText2 } = require("messages");
const { CommandError, CommandFailure, GetFailureMessage, Phrase, RenderPhrase } = require("./translations");
const { AllowsSQLPermission } = require("./sql-authorization");

const { GetPlayer } = GetModule("players");

const g_mapCommands = new Map();
const g_setBareInformationCommands = new Set(["currentmap", "ff", "motd", "nextmap", "thetime", "timeleft"]);
let g_TriggerShow = null;

function HasPermission(unClientIndex, strPermission) {
	const strQualifiedPermission = `sourcejs.${strPermission}`;

	return (unClientIndex === 0) || ((unClientIndex > 0) && ((HasPlayerPermission(unClientIndex, strQualifiedPermission) === true) || AllowsSQLPermission(unClientIndex, strQualifiedPermission)));
}

function Reply(unClientIndex, Message, bChat = false) {
	if (unClientIndex === 0) {
		LogInfo(RenderPhrase(null, Message));
		return;
	}

	if (GetPlayer(unClientIndex)?.FakeClient === true) {
		return;
	}

	if (bChat) {
		const strMessage = RenderPhrase(unClientIndex, Message);
		try {
			if (!strMessage.includes("\n")) {
				const ChatMessage = (GetUserMessageIndex("SayText") >= 0) ? SayText : SayText2;
				if ((typeof ChatMessage === "function") && new ChatMessage(`[SourceJS] ${strMessage}`, { Chat: true }).SendUserMessage(unClientIndex)) {
					return;
				}
			}
		} catch {
			// Fall back to the English console reply.
		}
	}

	const strReply = `[SourceJS] ${RenderPhrase(null, Message)}\n`;
	try {
		if ((typeof HUDTextMessage === "function") && (HUD_DESTINATION?.Console !== undefined) && (GetUserMessageIndex("TextMsg") >= 0)) {
			const ConsoleMessage = new HUDTextMessage(strReply, { Destination: HUD_DESTINATION.Console });
			if (ConsoleMessage.SendUserMessage(unClientIndex)) {
				return;
			}
		}
	} catch {
		// Use the engine console when the selected game cannot deliver the user message.
	}

	PrintToClientConsole(unClientIndex, strReply);
}

function RequireUnsignedInteger(strValue, unMaximumValue, strRole) {
	const unValue = Number(strValue);
	if (!/^\d+$/.test(strValue ?? "") || !Number.isSafeInteger(unValue) || (unValue > unMaximumValue)) {
		throw new CommandError(Phrase("InvalidInteger", "{Parameter} must be an integer from 0 through {Maximum}.", { Parameter: strRole, Maximum: unMaximumValue }));
	}

	return unValue;
}

function FindTargets(unClientIndex, strSelector, vecPlayers) {
	if (!strSelector) {
		throw CommandFailure("TargetRequired", "A player target is required.");
	}

	const strSearch = strSelector.toLowerCase();
	switch (strSearch) {
		case "@all":
			return vecPlayers;

		case "@me":
			return vecPlayers.filter((Target) => Target.Index === unClientIndex);

		case "@!me":
			return vecPlayers.filter((Target) => Target.Index !== unClientIndex);

		case "@bots":
			return vecPlayers.filter((Target) => Target.FakeClient);

		case "@humans":
			return vecPlayers.filter((Target) => !Target.FakeClient);

		case "@alive":
			return vecPlayers.filter((Target) => !Target.Dead);

		case "@dead":
			return vecPlayers.filter((Target) => Target.Dead);
	}

	if (/^#\d+$/.test(strSearch)) {
		return vecPlayers.filter((Target) => Target.UserID === Number(strSearch.slice(1)));
	}

	if (strSearch.startsWith("#")) {
		const strExactName = strSearch.slice(1);
		const strNetworkID = strExactName.replace(/^steam_(\d+)_(\d+)_(\d+)$/, "steam_$1:$2:$3");
		return vecPlayers.filter((Target) => (Target.Name.toLowerCase() === strExactName) || (Target.NetworkID?.toLowerCase() === strNetworkID));
	}

	const vecExactNames = vecPlayers.filter((Target) => Target.Name.toLowerCase() === strSearch);
	return (vecExactNames.length > 0) ? vecExactNames : vecPlayers.filter((Target) => Target.Name.toLowerCase().includes(strSearch));
}

function RequireTargets(unClientIndex, strSelector, bAllowMultiple = false, bCheckImmunity = true, Filter = null) {
	const vecPlayers = GetAllPlayers();
	const vecTargets = FindTargets(unClientIndex, strSelector, Filter ? vecPlayers.filter(Filter) : vecPlayers);
	const bGroup = ["@all", "@!me", "@bots", "@humans", "@alive", "@dead"].includes(strSelector.toLowerCase());
	if ((vecTargets.length === 0) || ((vecTargets.length > 1) && (!bAllowMultiple || !bGroup))) {
		throw (vecTargets.length === 0) ? CommandFailure("NoTarget", "No matching player.") : CommandFailure("AmbiguousTarget", "Ambiguous target; use an exact name or #userid.");
	}

	if (bCheckImmunity && !HasPermission(unClientIndex, "targetimmune")) {
		for (const Target of vecTargets) {
			if ((Target.Index !== unClientIndex) && !Target.FakeClient && HasPermission(Target.Index, "immunity")) {
				throw CommandFailure("ImmuneTarget", "The selection contains an immune player.");
			}
		}
	}

	return vecTargets;
}

function RequireCurrentPlayer(Target) {
	const CurrentPlayer = GetPlayer(Target.Index);
	if (!CurrentPlayer || (CurrentPlayer.UserID !== Target.UserID) || (CurrentPlayer.Connected !== true)) {
		throw new CommandError(Phrase("PlayerDisconnected", "The target player is no longer connected."));
	}

	return CurrentPlayer;
}

function DefineCommand(strName, strPermission, strUsage, Execute, bServerOnly = false, strAdditionalPermission = null, strServerConsoleError = null) {
	g_mapCommands.set(strName, { Name: strName, Permission: strPermission, Usage: strUsage, Execute, ServerOnly: bServerOnly, AdditionalPermission: strAdditionalPermission, ServerConsoleError: strServerConsoleError });
}

function GetCommandAccessError(unClientIndex, Entry) {
	if ((unClientIndex === 0) && Entry.ServerConsoleError) {
		return Entry.ServerConsoleError;
	}

	if (Entry.ServerOnly && (unClientIndex !== 0)) {
		return Phrase("ConsoleOnly", "This command is restricted to the server console.");
	}

	if (Entry.Permission && !HasPermission(unClientIndex, Entry.Permission)) {
		return Phrase("NoPermission", "You do not have permission to use this command.");
	}

	if (Entry.AdditionalPermission && !HasPermission(unClientIndex, Entry.AdditionalPermission)) {
		return Phrase("RequiresPermission", "This command also requires {Permission}.", { Permission: `sourcejs.${Entry.AdditionalPermission}` });
	}

	return null;
}

function GetAvailableCommands(unClientIndex) {
	return Array.from(g_mapCommands.values()).filter((Entry) => GetCommandAccessError(unClientIndex, Entry) === null);
}

function GetGrantedCommandPermissions(unClientIndex) {
	const setPermissions = new Set();

	for (const Entry of g_mapCommands.values()) {
		if (Entry.Permission) {
			setPermissions.add(Entry.Permission);
		}

		if (Entry.AdditionalPermission) {
			setPermissions.add(Entry.AdditionalPermission);
		}
	}

	return Array.from(setPermissions).filter((strPermission) => HasPermission(unClientIndex, strPermission)).sort();
}

function DispatchCommand(unClientIndex, Entry, vecArguments, bChat = false, bBroadcast = false) {
	try {
		const AccessError = GetCommandAccessError(unClientIndex, Entry);
		if (AccessError !== null) {
			Reply(unClientIndex, AccessError, bChat);
			return;
		}

		const Response = Entry.Execute(unClientIndex, vecArguments, bChat);
		if (Response) {
			if (bBroadcast) {
				for (const Player of GetAllPlayers()) {
					if (Player.Connected && !Player.FakeClient) {
						Reply(Player.Index, Response, true);
					}
				}
			} else {
				Reply(unClientIndex, Response, bChat);
			}
		}
	} catch (Failure) {
		try {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "Command failed.")), bChat);
		} catch {
			// The command may have disconnected its caller. Preserve the chat visibility decision.
		}
	}
}

function ReadChatText(Invocation) {
	let strChatText = (Invocation.Message || Invocation.Raw).trim();
	if (strChatText.startsWith('"') && strChatText.endsWith('"')) {
		strChatText = strChatText.slice(1, -1).trim();
	}

	return strChatText;
}

function DispatchChatCommand(Invocation) {
	const strChatText = ReadChatText(Invocation);
	const strPrefix = strChatText[0];
	if ((strPrefix !== "!") && (strPrefix !== "/")) {
		const strLowerChatText = strChatText.toLowerCase();
		const strAlias = (strLowerChatText === "rockthevote") ? "rtv" : strLowerChatText;
		const bInformationCommand = g_setBareInformationCommands.has(strAlias);
		if (bInformationCommand || (strAlias === "rtv") || (strAlias === "nominate")) {
			const Entry = g_mapCommands.get(strAlias);
			if (Entry) {
				const bBroadcast = bInformationCommand && (Number(g_TriggerShow.Value) === 1);
				DispatchCommand(Invocation.Index, Entry, [], true, bBroadcast);
			}
		}

		return CONTINUE;
	}

	const [strCommand, ...vecArguments] = new Tokenizer(strChatText);
	const strName = strCommand.slice(1).toLowerCase().replace(/^sjs_/, "");
	const Entry = g_mapCommands.get(strName);
	if (!Entry) {
		return CONTINUE;
	}

	DispatchCommand(Invocation.Index, Entry, vecArguments, true);

	return (strPrefix === "/") ? BLOCK : CONTINUE;
}

function RegisterConsoleCommands() {
	g_TriggerShow = CreateConVar("sjs_trigger_show", "0", "Show bare information-trigger replies to all players instead of only the requester.", 0, 0, 1);

	for (const Entry of g_mapCommands.values()) {
		const strConsoleName = `sjs_${Entry.Name}`;
		function RunConsoleCommand(Payload) {
			const Invocation = new Command(Payload);
			DispatchCommand(Invocation.Index, Entry, Invocation.Arguments.slice(1));

			return BLOCK;
		}

		if (!g_ClientCommands.RegisterCommand(strConsoleName, RunConsoleCommand) || !g_ServerCommands.RegisterCommand(strConsoleName, RunConsoleCommand)) {
			throw new Error(`Could not register ${strConsoleName}.`);
		}
	}
}

module.exports = {
	HasPermission,
	Reply,
	RequireUnsignedInteger,
	RequireTargets,
	RequireCurrentPlayer,
	DefineCommand,
	GetCommandAccessError,
	GetAvailableCommands,
	GetGrantedCommandPermissions,
	ReadChatText,
	DispatchChatCommand,
	RegisterConsoleCommands,
};
