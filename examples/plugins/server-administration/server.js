"use strict";

const { Reload } = require("auth");
const { LogWarning } = require("core/logger");
const { CreateConVar, FindConVar, RevertConVarToDefault, SetConVar } = require("cvars");
const { CHEAT, PROTECTED } = require("cvars/flags");
const { ChangeLevel, ExecuteServerCommand, GetMapName, IsMapValid } = require("engines/server");
const { DoesFileExist, ReadTextFile } = require("filesystem");
const { GetAllPlayers } = require("filters/players");
const { TickDelay } = require("listeners/tick");
const { PagedESCMenu, PagedESCOption } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetUserMessageIndex, VGUIMenu } = require("messages");
const { CONFIG_ROOT } = require("paths");
const { GetUserIDFromIndex } = require("players/helpers");
const { DefineCommand, GetAvailableCommands, GetCommandAccessError, GetGrantedCommandPermissions, HasPermission, Reply, RequireTargets, RequireUnsignedInteger } = require("./administration");
const { Broadcast, GetCommunicationState, GetMessageAuthor, ReportAdminActivity } = require("./communication");
const { IsBlindAvailable } = require("./effects");
const { TrackRequestedMapChange } = require("./map-history");
const { ShowMapMenu } = require("./map-menu");
const { PlayMenuSound } = require("./menu-sounds");
const { AwaitCustomBanReason, BanPlayer, CancelPendingBanReason, KickPlayer } = require("./moderation");
const { IsSQLAuthorizationEnabled, RunSQLAuthorizationRequest } = require("./sql-authorization");
const { CommandFailure, CommandUsage, FormatBanDuration, GetFailureMessage, LabelValue, Phrase, Translate } = require("./translations");

const g_unMapChangeDelaySeconds = 3;
const g_strDefaultDateTimeFormat = "%m/%d/%Y - %H:%M:%S";
let g_DateTimeFormat = null;
let g_TimeAdjustment = null;
const g_setLivePlayerActions = new Set(["slay", "slap", "beacon", "timebomb", "burn", "firebomb", "freeze", "freezebomb", "gravity", "blind", "noclip", "drug"]);
const g_setPlayerActions = new Set(["ban", "kick", "gag", "rename", "who", ...g_setLivePlayerActions]);
const g_setLiveTargetVotes = new Set(["voteburn", "voteslay"]);
const g_setTargetVotes = new Set(["votekick", "voteban", ...g_setLiveTargetVotes]);
const g_setVotingMenuActions = new Set(["cancelvote", "votemap", "votegravity", "votealltalk", "voteff", ...g_setTargetVotes]);
const g_vecGravityVoteOptions = Object.freeze(["200", "400", "800", "1600", "3200"]);
const g_vecSlapDamage = ["0", "1", "5", "10", "20", "50", "99"];
const g_vecBanDurations = [["Permanent", "0"], ["10 minutes", "10"], ["30 minutes", "30"], ["1 hour", "60"], ["4 hours", "240"], ["1 day", "1440"], ["1 week", "10080"]];
const g_vecBanReasons = ["Abusive behavior", "Racism", "Cheating", "Microphone spam", "Team killing", "Breaking server rules", "Other"];
const g_vecBanReasonKeys = ["Abuse", "Racism", "Cheating", "MicrophoneSpam", "TeamKilling", "RuleViolation", "Other"];
const g_strBanReasonConfigurationPath = `${CONFIG_ROOT}/server-administration/BanReasons.json`;
const g_strConfigurationMenuPath = `${CONFIG_ROOT}/server-administration/Configurations.json`;
const g_ConfigurationFilePattern = /^[a-z0-9_-]+\.cfg$/i;
const g_ConVarNamePattern = /^[a-z0-9_]+$/i;
const g_setConsoleOnlyConVars = new Set(["sjs_show_activity"]);
const g_setServerConfigurationConVars = new Set(["servercfgfile", "lservercfgfile"]);
const g_mapAdminCategories = new Map([
	["ban", "Player bans"],
	["kick", "Remove a player"],
	["slay", "Player effects and actions"],
	["chat", "Chat and voice moderation"],
	["map", "Maps and rotation"],
	["vote", "Server votes"],
	["config", "Server configuration"],
	["admin", "Player information"],
]);
const g_mapAdminActionLabels = new Map([
	["ban", "Ban a player"],
	["kick", "Kick a player"],
	["slap", "Slap a player"],
	["slay", "Slay a player"],
	["rename", "Randomize a player's name"],
	["gag", "Manage chat and voice"],
	["who", "Identify player"],
	["beacon", "Toggle player beacon"],
	["timebomb", "Toggle time bomb"],
	["firebomb", "Toggle fire bomb"],
	["freezebomb", "Toggle freeze bomb"],
	["freeze", "Freeze or thaw player"],
	["burn", "Ignite a player"],
	["gravity", "Set player gravity"],
	["blind", "Set screen blindness"],
	["noclip", "Toggle noclip"],
	["drug", "Toggle disorientation"],
	["map", "Change the current map"],
	["setnextmap", "Set the next map"],
	["votemap", "Start a map vote"],
	["votekick", "Vote to kick a player"],
	["voteban", "Vote to ban a player"],
	["voteslay", "Vote to slay a player"],
	["voteburn", "Vote to ignite a player"],
	["votegravity", "Vote on server gravity"],
	["votealltalk", "Vote on all-talk"],
	["voteff", "Vote on friendly fire"],
	["cancelvote", "Cancel the active vote"],
	["execcfg", "Run a server configuration"],
	["reloadadmins", "Reload administrator permissions"],
]);
const g_mapCommunicationLabels = new Map([
	["gag", "Block text chat"],
	["ungag", "Restore text chat"],
	["mute", "Block voice chat"],
	["unmute", "Restore voice chat"],
	["silence", "Block text and voice"],
	["unsilence", "Restore text and voice"],
]);
const g_mapCommunicationKeys = new Map([
	["gag", "BlockText"],
	["ungag", "RestoreText"],
	["mute", "BlockVoice"],
	["unmute", "RestoreVoice"],
	["silence", "BlockBoth"],
	["unsilence", "RestoreBoth"],
]);
const g_mapAdminPhraseKeys = new Map([
	["ban", "Ban"],
	["kick", "Kick"],
	["slap", "Slap"],
	["slay", "Slay"],
	["rename", "Rename"],
	["gag", "Moderation"],
	["who", "PlayerInfo"],
	["beacon", "Beacon"],
	["timebomb", "TimeBomb"],
	["firebomb", "FireBomb"],
	["freezebomb", "FreezeBomb"],
	["freeze", "Freeze"],
	["burn", "Ignite"],
	["gravity", "Gravity"],
	["blind", "Blind"],
	["noclip", "Noclip"],
	["drug", "Disorient"],
	["map", "ChangeMap"],
	["setnextmap", "SetNextMap"],
	["votemap", "MapVote"],
	["votekick", "KickVote"],
	["voteban", "BanVote"],
	["voteslay", "SlayVote"],
	["voteburn", "BurnVote"],
	["votegravity", "GravityVote"],
	["votealltalk", "AllTalkVote"],
	["voteff", "FriendlyFireVote"],
	["cancelvote", "CancelVote"],
	["execcfg", "RunConfig"],
	["reloadadmins", "ReloadAdmins"],
]);
const g_mapAdminCategoryKeys = new Map([
	["ban", "Ban"],
	["kick", "Kick"],
	["slay", "PlayerActions"],
	["chat", "Moderation"],
	["map", "Maps"],
	["vote", "Votes"],
	["config", "Configuration"],
	["admin", "PlayerInfo"],
]);

const g_mapPlayerActionPresets = new Map([
	["gravity", [["Very high (4×)", "4"], ["High (2×)", "2"], ["Normal (1×)", "1"], ["Low (0.5×)", "0.5"], ["Very low (0.1×)", "0.1"]]],
	["blind", [["Fully blind", "255"], ["Partially blind", "240"], ["Clear blindness", "0"]]],
]);
let g_PendingMapChange = null;
let g_ReadRotationMaps = null;
let g_RecoverNextMap = null;
const g_mapAdminMenus = new Map();

function GetAdminActionText(unClientIndex, strAction) {
	return Translate(unClientIndex, g_mapAdminPhraseKeys.get(strAction), g_mapAdminActionLabels.get(strAction));
}

function GetAdminCategoryText(unClientIndex, strCategory) {
	return Translate(unClientIndex, g_mapAdminCategoryKeys.get(strCategory), g_mapAdminCategories.get(strCategory));
}

function CloseAdminMenu(unClientIndex) {
	const Menu = g_mapAdminMenus.get(unClientIndex);
	g_mapAdminMenus.delete(unClientIndex);
	Menu?.CloseMenu(unClientIndex);
}

function CloseAdminMenus() {
	const vecFailures = [];

	for (const unClientIndex of g_mapAdminMenus.keys()) {
		try {
			CloseAdminMenu(unClientIndex);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not close the administration menus.");
	}
}

function HasPendingMapChange() {
	return g_PendingMapChange !== null;
}

function CancelMapChange() {
	const PendingMapChange = g_PendingMapChange;
	g_PendingMapChange = null;

	if (PendingMapChange) {
		PendingMapChange.DisposeTickDelay();
	}
}

function RequireConVar(strName) {
	if (!g_ConVarNamePattern.test(strName ?? "")) {
		throw CommandFailure("CvarRequired", "A ConVar name is required.");
	}

	const ConVar = FindConVar(strName);
	if (ConVar.Exists !== true) {
		throw CommandFailure("CvarNotFound", "ConVar not found.");
	}

	return ConVar;
}

function IsProtectedConVar(strName, nFlags) {
	return ((nFlags & PROTECTED) !== 0) || strName.includes("password");
}

function FindAuthorizedConVar(unClientIndex, strName) {
	const ConVar = RequireConVar(strName);
	const strNormalizedName = strName.toLowerCase();
	if ((unClientIndex !== 0) && g_setConsoleOnlyConVars.has(strNormalizedName)) {
		throw CommandFailure("ConsoleOnly", "This ConVar is restricted to the server console.");
	}

	const nFlags = ConVar.Flags;
	if ((unClientIndex > 0) && (!Number.isInteger(nFlags) || !Number.isInteger(PROTECTED) || !Number.isInteger(CHEAT))) {
		throw CommandFailure("CvarNotFound", "This game cannot verify the ConVar's access flags.");
	}

	if (IsProtectedConVar(strNormalizedName, nFlags) && !HasPermission(unClientIndex, "password")) {
		throw CommandFailure("RequiresPermission", "This ConVar requires {Permission}.", { Permission: "sourcejs.password" });
	}

	if (((strNormalizedName === "sv_cheats") || ((nFlags & CHEAT) !== 0)) && !HasPermission(unClientIndex, "cheats")) {
		throw CommandFailure("RequiresPermission", "This ConVar requires {Permission}.", { Permission: "sourcejs.cheats" });
	}

	return ConVar;
}

function ApplyConVarChange(unClientIndex, strName, ConVar, Change, strActivity, strFailure) {
	const strNormalizedName = strName.toLowerCase();
	const nFlags = ConVar.Flags;
	const bCanAnnounce = Number.isInteger(nFlags) && Number.isInteger(PROTECTED) && !IsProtectedConVar(strNormalizedName, nFlags) && !g_setConsoleOnlyConVars.has(strNormalizedName);
	const strBefore = bCanAnnounce ? ConVar.Value : null;
	const Author = bCanAnnounce ? GetMessageAuthor(unClientIndex) : null;

	if (!Change()) {
		throw CommandFailure("CommandFailed", strFailure);
	}

	if (bCanAnnounce && (ConVar.Value !== strBefore)) {
		ReportAdminActivity(unClientIndex, Author, Phrase((strActivity === "Reset ConVar") ? "SettingReset" : "SettingUpdated", `${strActivity} {Setting}.`, { Setting: strName }));
	}
}

function HandleConVarCommand(unClientIndex, vecArguments) {
	const [strName, ...vecValue] = vecArguments;
	const strNormalizedName = strName?.toLowerCase();
	if (strNormalizedName === "protect") {
		if (unClientIndex !== 0) {
			throw CommandFailure("ConsoleOnly", "ConVar protection can only be configured from the server console.");
		}

		if (vecValue.length !== 1) {
			throw CommandUsage("sjs_cvar protect <cvar>.");
		}

		const [strConVarName] = vecValue;
		RequireConVar(strConVarName);
		g_setConsoleOnlyConVars.add(strConVarName.toLowerCase());

		return Phrase("CvarConsoleOnly", "{Setting} is now restricted to the server console.", { Setting: strConVarName });
	}

	const ConVar = FindAuthorizedConVar(unClientIndex, strName);

	if (vecValue.length > 0) {
		const strValue = vecValue.join(" ");
		if (g_setServerConfigurationConVars.has(strNormalizedName)) {
			if (!HasPermission(unClientIndex, "config")) {
				throw CommandFailure("RequiresPermission", "Changing this ConVar requires {Permission}.", { Permission: "sourcejs.config" });
			}

			if ((strValue !== "") && !g_ConfigurationFilePattern.test(strValue)) {
				throw CommandFailure("InvalidInput", "Specify a .cfg filename without a directory for this ConVar, or an empty value.");
			}
		}

		ApplyConVarChange(unClientIndex, strName, ConVar, () => SetConVar(strName, strValue), "Changed ConVar", "ConVar write was not accepted.");

		return Phrase("SettingUpdated", "{Setting} updated.", { Setting: strName });
	}

	if (IsProtectedConVar(strNormalizedName, ConVar.Flags)) {
		return Phrase("CvarHidden", "{Setting} is protected; its value is not displayed.", { Setting: strName });
	}

	return `${strName} = ${ConVar.Value}`;
}

function ResetConVar(unClientIndex, vecArguments) {
	if (vecArguments.length !== 1) {
		throw CommandUsage("sjs_resetcvar <cvar>.");
	}

	const [strName] = vecArguments;
	const ConVar = FindAuthorizedConVar(unClientIndex, strName);

	if (g_setServerConfigurationConVars.has(strName.toLowerCase()) && !HasPermission(unClientIndex, "config")) {
		throw CommandFailure("RequiresPermission", "Changing this ConVar requires {Permission}.", { Permission: "sourcejs.config" });
	}

	ApplyConVarChange(unClientIndex, strName, ConVar, () => RevertConVarToDefault(strName), "Reset ConVar", "ConVar reset was not accepted.");

	return Phrase("SettingReset", "{Setting} reset.", { Setting: strName });
}

function RequireMapName(strMapName) {
	if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(strMapName ?? "") || !IsMapValid(strMapName)) {
		throw CommandFailure("InvalidMap", "Specify an installed map name.");
	}

	return strMapName;
}

function ChangeMap(unClientIndex, vecArguments, strReason = "Admin command", unDelaySeconds = g_unMapChangeDelaySeconds) {
	const strMapName = RequireMapName(vecArguments[0]);
	const unInitiatorUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);

	CancelMapChange();

	const Delay = new TickDelay(unDelaySeconds, () => {
		if (g_PendingMapChange !== Delay) {
			return;
		}

		g_PendingMapChange = null;

		if ((unClientIndex !== 0) && ((GetUserIDFromIndex(unClientIndex) !== unInitiatorUserID) || !HasPermission(unClientIndex, "map"))) {
			Broadcast(Phrase("MapChangePermissionLost", "Map change cancelled: its initiator no longer has permission."));
			return;
		}

		try {
			if (IsMapValid(strMapName) && TrackRequestedMapChange(strMapName, strReason, ChangeLevel)) {
				return;
			}
		} catch (Failure) {
			LogWarning(`Could not submit map change to ${strMapName}: ${Failure?.message ?? "unknown error"}`);
		}

		g_RecoverNextMap(strMapName);
		Broadcast(Phrase("MapChangeFailed", "The server did not accept the map change to {Map}.", { Map: strMapName }));
	}, [], true);

	g_PendingMapChange = Delay;

	return Phrase("ChangingMap", "Changing map to {Map} in {Seconds} seconds.", { Map: strMapName, Seconds: unDelaySeconds });
}

function RunMapCommand(unClientIndex, vecArguments, bChat) {
	if (bChat && (unClientIndex > 0) && (vecArguments.length === 0)) {
		const Entry = GetAvailableCommands(unClientIndex).find((Command) => Command.Name === "map");
		if (!Entry) {
			throw CommandFailure("NoPermission", "You do not have permission to use this command.");
		}

		ShowMapMenu(unClientIndex, GetUserIDFromIndex(unClientIndex), Entry, g_ReadRotationMaps);
		return null;
	}

	const Announcement = ChangeMap(unClientIndex, vecArguments);
	Broadcast(Announcement, bChat ? unClientIndex : 0);

	return Announcement;
}

function ExecuteConfiguration(unClientIndex, vecArguments) {
	const [strFileName] = vecArguments;
	if ((vecArguments.length !== 1) || !g_ConfigurationFilePattern.test(strFileName)) {
		throw CommandFailure("InvalidInput", "Specify a .cfg filename without a directory.");
	}

	if (!DoesFileExist(`cfg/${strFileName}`)) {
		throw CommandFailure("ConfigNotFound", "Config not found: {File}.", { File: strFileName });
	}

	if (!ExecuteServerCommand(`exec ${strFileName}`)) {
		throw CommandFailure("CommandFailed", "Config execution was not accepted.");
	}

	return Phrase("ConfigSubmitted", "Config execution submitted: {File}.", { File: strFileName });
}

function ReadConfigurationMenu() {
	const unMaximumEntryCount = 64;
	const unMaximumLabelLength = 80;
	const strConfiguration = ReadTextFile(g_strConfigurationMenuPath);
	if (strConfiguration === null) {
		return [];
	}

	const vecEntries = JSON.parse(strConfiguration);
	if (!Array.isArray(vecEntries) || (vecEntries.length > unMaximumEntryCount)) {
		throw CommandFailure("InvalidInput", `Configurations.json must contain an array of up to ${unMaximumEntryCount} entries.`);
	}

	const setFiles = new Set();

	for (const Entry of vecEntries) {
		if (!Entry || (typeof Entry.File !== "string") || !g_ConfigurationFilePattern.test(Entry.File) || (typeof Entry.Label !== "string") || !Entry.Label.trim() || (Entry.Label.length > unMaximumLabelLength) || /[\x00-\x1F\x7F]/.test(Entry.Label) || setFiles.has(Entry.File.toLowerCase())) {
			throw CommandFailure("InvalidInput", "Configurations.json entries need a unique .cfg basename and a single-line label.");
		}

		setFiles.add(Entry.File.toLowerCase());
	}

	return vecEntries;
}

function ExecuteConsoleCommand(unClientIndex, vecArguments) {
	if (vecArguments.length === 0) {
		throw CommandUsage("sjs_rcon <command> [arguments].");
	}

	const [strCommandName, ...vecValues] = vecArguments;
	if (!/^[a-z0-9_+-]+$/i.test(strCommandName ?? "") || vecValues.some((strValue) => /[\x00-\x1F\x7F";\\]/.test(strValue))) {
		throw CommandFailure("InvalidInput", "Supply one console command without control characters, quotes, backslashes, or semicolons.");
	}

	const strCommand = [strCommandName, ...vecValues.map((strValue) => `"${strValue}"`)].join(" ");
	if (!ExecuteServerCommand(strCommand)) {
		throw CommandFailure("CommandFailed", "The engine did not accept the command.");
	}

	return (unClientIndex === 0) ? null : Phrase("ConsoleSubmitted", "Console command submitted; see server output.");
}

function FormatCommand(Entry) {
	return `sjs_${Entry.Name}${Entry.Usage ? ` ${Entry.Usage}` : ""}`;
}

function FormatCommandRow(Entry, unNumber) {
	return `[${String(unNumber).padStart(3, "0")}] ${FormatCommand(Entry)}`;
}

function ReplyCommandList(unClientIndex, bChat, vecLines) {
	for (const Line of vecLines) {
		Reply(unClientIndex, Line);
	}

	if (bChat && (unClientIndex > 0)) {
		Reply(unClientIndex, Phrase("SeeConsole", "See your console for the command list."), true);
	}
}

function ShowHelp(unClientIndex, vecArguments, bChat = false) {
	const unPageSize = 10;
	const unMaximumRequestedPage = 1_000;
	const [strQuery = "1"] = vecArguments;
	let unPage = 1;
	let vecEntries = GetAvailableCommands(unClientIndex);
	if (/^\d+$/.test(strQuery)) {
		unPage = RequireUnsignedInteger(strQuery, unMaximumRequestedPage, "Help page");

	} else {
		const strNeedle = strQuery.toLowerCase();
		vecEntries = vecEntries.filter((Entry) => FormatCommand(Entry).toLowerCase().includes(strNeedle));
	}

	const unPageCount = Math.max(1, Math.ceil(vecEntries.length / unPageSize));
	if ((unPage < 1) || (unPage > unPageCount)) {
		throw CommandFailure("HelpPageRange", "Help page must be in 1..{Maximum}.", { Maximum: unPageCount });
	}

	const unStart = (unPage - 1) * unPageSize;
	const vecPage = vecEntries.slice(unStart, unStart + unPageSize);
	const vecLines = [Phrase("HelpPage", "Commands (page {Page}/{Total}):", { Page: unPage, Total: unPageCount }), ...vecPage.map((Entry, unIndex) => FormatCommandRow(Entry, unStart + unIndex + 1))];

	if (vecPage.length === 0) {
		vecLines.push(Phrase("NoMatchingCommands", "No matching commands found."));
	}

	if (unPage < unPageCount) {
		vecLines.push(Phrase("MoreCommands", "Type {Command} for more commands.", { Command: `sjs_help ${unPage + 1}` }));
	}

	ReplyCommandList(unClientIndex, bChat, vecLines);
}

function SearchCommands(unClientIndex, vecArguments, bChat = false) {
	const [strQuery = ""] = vecArguments;
	const strNeedle = strQuery.toLowerCase();
	const vecMatches = GetAvailableCommands(unClientIndex).filter((Entry) => `sjs_${Entry.Name}`.includes(strNeedle));
	if (vecMatches.length === 0) {
		ReplyCommandList(unClientIndex, bChat, [Phrase("NoMatchingCommands", "No matching commands found.")]);
		return;
	}

	ReplyCommandList(unClientIndex, bChat, [Phrase("MatchingCommands", "Matching commands:"), ...vecMatches.map((Entry, unIndex) => FormatCommandRow(Entry, unIndex + 1))]);
}

function CanUseAdminMenu(unClientIndex, unUserID, strPermission) {
	return (GetUserIDFromIndex(unClientIndex) === unUserID) && HasPermission(unClientIndex, "admin") && HasPermission(unClientIndex, strPermission);
}

function CanUsePlayerMenuAction(unClientIndex, unUserID, Entry) {
	return (GetUserIDFromIndex(unClientIndex) === unUserID) && HasPermission(unClientIndex, "admin") && (GetCommandAccessError(unClientIndex, Entry) === null) && ((Entry.Name !== "blind") || IsBlindAvailable());
}

function RequiresLiveMenuTarget(Entry) {
	return g_setLivePlayerActions.has(Entry.Name) || g_setLiveTargetVotes.has(Entry.Name);
}

function RequiresHumanMenuTarget(Entry) {
	return (Entry.Name === "ban") || (Entry.Name === "blind") || (Entry.Name === "gag") || (Entry.Name === "voteban");
}

function RequireMenuTarget(unClientIndex, Entry, unUserID) {
	const [Target] = RequireTargets(unClientIndex, `#${unUserID}`);
	if (!Target.Connected || (RequiresHumanMenuTarget(Entry) && Target.FakeClient) || (RequiresLiveMenuTarget(Entry) && Target.Dead)) {
		throw CommandFailure("PlayerUnavailable", "The target player is no longer eligible.");
	}

	return Target;
}

function ExecutePlayerMenuAction(unClientIndex, Entry, unUserID, vecOptions, Execute = Entry.Execute) {
	try {
		RequireMenuTarget(unClientIndex, Entry, unUserID);

		const Result = Execute(unClientIndex, [`#${unUserID}`, ...vecOptions]);
		if (Result) {
			Reply(unClientIndex, Result, Entry.Name === "who");
		}
	} catch (Failure) {
		Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The player action failed.")));
	}
}

function ReadBanReasons() {
	const unMaximumReasonCount = 64;
	const unMaximumReasonLength = 100;
	const strConfiguration = ReadTextFile(g_strBanReasonConfigurationPath);
	if (strConfiguration === null) {
		return g_vecBanReasons;
	}

	const vecReasons = JSON.parse(strConfiguration);
	if (!Array.isArray(vecReasons) || (vecReasons.length > unMaximumReasonCount) || vecReasons.some((strReason) => (typeof strReason !== "string") || !strReason.trim() || (strReason.length > unMaximumReasonLength) || /[\x00-\x1F\x7F]/.test(strReason))) {
		throw CommandFailure("InvalidInput", `BanReasons.json must contain an array of up to ${unMaximumReasonCount} single-line reasons, each 1–${unMaximumReasonLength} characters.`);
	}

	return vecReasons;
}

function GetBuiltInBanReasonKey(vecReasons, strReason) {
	return (vecReasons === g_vecBanReasons) ? g_vecBanReasonKeys[g_vecBanReasons.indexOf(strReason)] : undefined;
}

function GetAdminRadioByteCount(strText) {
	let unByteCount = 0;
	for (const strCharacter of strText) {
		const unCodePoint = strCharacter.codePointAt(0);
		if (unCodePoint <= 0x7F) {
			unByteCount += 1;
		} else if (unCodePoint <= 0x7FF) {
			unByteCount += 2;
		} else if (unCodePoint <= 0xFFFF) {
			unByteCount += 3;
		} else {
			unByteCount += 4;
		}
	}

	return unByteCount;
}

function FitAdminRadioMenu(Menu, unClientIndex) {
	// Leave room below the observed client cutoff for the complete joined ShowMenu text.
	const unMaximumPageByteCount = 384;
	for (let unItemsPerPage = Menu.ItemsPerPage; unItemsPerPage > 0; unItemsPerPage -= 1) {
		Menu.ItemsPerPage = unItemsPerPage;
		const unPageCount = Menu.GetMenuPageCount();
		let bFits = true;
		for (let unPageIndex = 0; unPageIndex < unPageCount; unPageIndex += 1) {
			const { MenuMessage: strMenuMessage } = Menu.BuildMenuRenderData(unClientIndex, unPageIndex);
			if (GetAdminRadioByteCount(strMenuMessage) > unMaximumPageByteCount) {
				bFits = false;
				break;
			}
		}

		if (bFits) {
			Menu.SetPlayerPage(unClientIndex, 0);
			return true;
		}
	}

	return false;
}

function CreateAdminNavigationMenu(unClientIndex, MenuType, OptionType, Options, vecOptions) {
	const Menu = new MenuType(Options);
	Menu.UseTextDialogFallback = false;

	for (const { Text: strText, Value } of vecOptions) {
		Menu.AppendMenuItem(new OptionType((Value === null) ? Translate(unClientIndex, "Back", strText) : strText, Value));
	}

	return Menu;
}

function SendAdminNavigationMenu(unClientIndex, strTitle, vecOptions, SelectCallback, strDescription = "Select an option.") {
	const unMenuTimeoutSeconds = 30;
	const Options = {
		Title: strTitle,
		Description: Translate(unClientIndex, "SelectOption", strDescription),
		BackText: Translate(unClientIndex, "Previous", "Previous page"),
		NextText: Translate(unClientIndex, "Next", "Next page"),
		CloseText: Translate(unClientIndex, "Close", "Exit menu"),
		Fill: false,
		Timeout: unMenuTimeoutSeconds,
		InteractionCallback(unReceiverIndex, strInteraction, Item) {
			if (unReceiverIndex === unClientIndex) {
				PlayMenuSound(unReceiverIndex, ((strInteraction === "Select") && (Item?.Value === null)) ? "ExitBack" : strInteraction);
			}
		},
		SelectCallback(unReceiverIndex, Value) {
			if ((unReceiverIndex === unClientIndex) && (g_mapAdminMenus.get(unClientIndex) === Menu)) {
				SelectCallback(unReceiverIndex, Value);
			}
		},
		CloseCallback() {
			if (g_mapAdminMenus.get(unClientIndex) === Menu) {
				g_mapAdminMenus.delete(unClientIndex);
			}
		},
	};

	let Menu = null;
	if (GetUserMessageIndex("ShowMenu") >= 0) {
		Menu = CreateAdminNavigationMenu(unClientIndex, PagedRadioMenu, PagedRadioOption, Options, vecOptions);
		if (!FitAdminRadioMenu(Menu, unClientIndex)) {
			Menu = null;
		}
	}

	if (Menu === null) {
		Menu = CreateAdminNavigationMenu(unClientIndex, PagedESCMenu, PagedESCOption, Options, vecOptions);
	}

	CloseAdminMenu(unClientIndex);
	g_mapAdminMenus.set(unClientIndex, Menu);

	let bSent = false;
	try {
		bSent = GetPlayerMenuQueue(unClientIndex).SendMenu(Menu);

		return bSent;
	} finally {
		if (!bSent && (g_mapAdminMenus.get(unClientIndex) === Menu)) {
			CloseAdminMenu(unClientIndex);
		}
	}
}

function FormatPlayerAccess(Target, unRecipientIndex = null) {
	const vecPermissions = GetGrantedCommandPermissions(Target.Index);

	return `#${Target.UserID} ${Target.Name}: ${vecPermissions.join(", ") || Translate(unRecipientIndex, "NoPlayerPermissions", "no bundled command permissions")}`;
}

function ShowPlayers(unClientIndex, vecArguments, bChat = false) {
	if (vecArguments.length > 0) {
		const [Target] = RequireTargets(unClientIndex, vecArguments[0], false, true, (Player) => Player.Connected);

		return (unRecipientIndex) => FormatPlayerAccess(Target, unRecipientIndex);
	}

	const vecPlayers = GetAllPlayers().filter((Target) => Target.Connected);
	if (vecPlayers.length === 0) {
		return Phrase("NoEligiblePlayers", "No connected players.");
	}

	Reply(unClientIndex, vecPlayers.map((Target) => FormatPlayerAccess(Target)).join("\n"));

	return bChat ? Phrase("ConsoleOutput", "See your console for the player access list.") : null;
}

function ShowBanReasonMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, strMinutes, GoBack) {
	const Target = RequireMenuTarget(unClientIndex, Entry, unUserID);

	const vecBanReasons = ReadBanReasons();

	function SelectReason(unReceiverIndex, strReason) {
		if ((unReceiverIndex !== unClientIndex) || !CanUsePlayerMenuAction(unClientIndex, unInitiatorUserID, Entry)) {
			return;
		}

		try {
			if (strReason === null) {
				GoBack();
				return;
			}

			if (strReason === "") {
				const CurrentTarget = RequireMenuTarget(unClientIndex, Entry, unUserID);
				AwaitCustomBanReason(unClientIndex, unInitiatorUserID, CurrentTarget, strMinutes);
				return;
			}

			const strReasonKey = GetBuiltInBanReasonKey(vecBanReasons, strReason);
			ExecutePlayerMenuAction(unClientIndex, Entry, unUserID, [strMinutes, strReason], (unIndex, vecArguments) => BanPlayer(unIndex, vecArguments, strReasonKey));
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("BanFailed", "The ban could not be prepared.")));
		}
	}

	const vecReasons = vecBanReasons.map((strReason) => ({ Text: Translate(unClientIndex, GetBuiltInBanReasonKey(vecBanReasons, strReason), strReason), Value: strReason }));
	const vecOptions = [{ Text: Translate(unClientIndex, "CustomReason", "Custom reason (type in chat)"), Value: "" }, ...vecReasons, { Text: "Back to durations", Value: null }];

	if (!SendAdminNavigationMenu(unClientIndex, Translate(unClientIndex, "BanReason", "Ban reason: {Player}", { Player: Target.Name }), vecOptions, SelectReason)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function ShowBanDurationMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, GoBack) {
	const Target = RequireMenuTarget(unClientIndex, Entry, unUserID);

	function SelectDuration(unReceiverIndex, strMinutes) {
		if ((unReceiverIndex !== unClientIndex) || !CanUsePlayerMenuAction(unClientIndex, unInitiatorUserID, Entry)) {
			return;
		}

		if (strMinutes === null) {
			GoBack();
			return;
		}

		try {
			const ShowDurations = () => ShowBanDurationMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, GoBack);
			ShowBanReasonMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, strMinutes, ShowDurations);
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("BanFailed", "The ban could not be prepared.")));
		}
	}

	const vecOptions = g_vecBanDurations.map(([strText, strMinutes]) => ({ Text: FormatBanDuration(unClientIndex, Number(strMinutes), strText), Value: strMinutes }));
	vecOptions.push({ Text: "Back to players", Value: null });

	if (!SendAdminNavigationMenu(unClientIndex, Translate(unClientIndex, "BanDuration", "Ban duration: {Player}", { Player: Target.Name }), vecOptions, SelectDuration)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function ShowSlapDamageMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory) {
	const SelectCallback = (unReceiverIndex, strDamage) => {
		if ((unReceiverIndex !== unClientIndex) || !CanUsePlayerMenuAction(unClientIndex, unInitiatorUserID, Entry)) {
			return;
		}

		if (g_vecSlapDamage.includes(strDamage)) {
			ShowPlayerActionMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory, strDamage);
		} else if (strDamage === null) {
			ShowCategory(unClientIndex, Entry.Permission);
		}
	};

	const vecOptions = g_vecSlapDamage.map((strDamage) => ({ Text: (strDamage === "0") ? Translate(unClientIndex, "PushOnly", "No damage (push only)") : Translate(unClientIndex, "Damage", "{Count} damage", { Count: strDamage }), Value: strDamage }));
	vecOptions.push({ Text: "Back to actions", Value: null });

	if (!SendAdminNavigationMenu(unClientIndex, Translate(unClientIndex, "SlapDamage", "Slap damage"), vecOptions, SelectCallback)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function ShowCommunicationActionMenu(unClientIndex, unInitiatorUserID, Entry, unTargetUserID, ShowPlayers) {
	const Target = RequireMenuTarget(unClientIndex, Entry, unTargetUserID);
	const { Gagged: bGagged, Muted: bMuted } = GetCommunicationState(Target);
	const vecActions = [bMuted ? "unmute" : "mute", bGagged ? "ungag" : "gag", (bMuted && bGagged) ? "unsilence" : "silence"];
	const SelectCallback = (unReceiverIndex, strAction) => {
		if ((unReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unClientIndex, unInitiatorUserID, "chat")) {
			return;
		}

		if (strAction !== null) {
			const Action = GetAvailableCommands(unClientIndex).find((Candidate) => (Candidate.Name === strAction) && vecActions.includes(strAction));
			if (!Action) {
				return;
			}

			try {
				const CurrentTarget = RequireMenuTarget(unClientIndex, Entry, unTargetUserID);
				const State = GetCommunicationState(CurrentTarget);
				if ((State.Gagged === bGagged) && (State.Muted === bMuted)) {
					ExecutePlayerMenuAction(unClientIndex, Action, unTargetUserID, []);
				} else {
					ShowCommunicationActionMenu(unClientIndex, unInitiatorUserID, Entry, unTargetUserID, ShowPlayers);
					return;
				}
			} catch (Failure) {
				Reply(unClientIndex, GetFailureMessage(Failure, Phrase("PlayerUnavailable", "The player is no longer eligible.")));
			}
		}

		ShowPlayers();
	};

	const vecOptions = vecActions.map((strAction) => ({ Text: Translate(unClientIndex, g_mapCommunicationKeys.get(strAction), g_mapCommunicationLabels.get(strAction)), Value: strAction }));
	vecOptions.push({ Text: "Back to players", Value: null });

	if (!SendAdminNavigationMenu(unClientIndex, LabelValue("Moderation", Target.Name, `Communication: ${Target.Name}`)(unClientIndex), vecOptions, SelectCallback)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function ShowPlayerActionMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory, strSlapDamage = null) {
	function CanUseAction() {
		if ((ShowCategory === null) && (Entry.Name === "kick")) {
			return (GetUserIDFromIndex(unClientIndex) === unInitiatorUserID) && HasPermission(unClientIndex, "kick");
		}

		return CanUsePlayerMenuAction(unClientIndex, unInitiatorUserID, Entry);
	}

	if (!CanUseAction()) {
		return;
	}

	const bLiveTargetsOnly = RequiresLiveMenuTarget(Entry);
	const bHumansOnly = RequiresHumanMenuTarget(Entry);
	const vecPlayers = GetAllPlayers().filter((Target) => Target.Connected && (!bHumansOnly || !Target.FakeClient) && (!bLiveTargetsOnly || !Target.Dead) && ((Target.Index === unClientIndex) || Target.FakeClient || !HasPermission(Target.Index, "immunity") || HasPermission(unClientIndex, "targetimmune")));
	if (vecPlayers.length === 0) {
		Reply(unClientIndex, Phrase("NoEligiblePlayers", "There are no eligible players."));

		if (ShowCategory === null) {
			return;
		}
	}

	const SelectCallback = (unReceiverIndex, unUserID) => {
		if ((unReceiverIndex !== unClientIndex) || !CanUseAction()) {
			return;
		}

		if (unUserID === null) {
			if (strSlapDamage !== null) {
				ShowSlapDamageMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory);
			} else {
				ShowCategory?.(unClientIndex, Entry.Permission);
			}

			return;
		}

		const ShowPlayers = () => ShowPlayerActionMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory, strSlapDamage);

		if (Entry.Name === "ban") {
			try {
				CancelPendingBanReason(unClientIndex);
				ShowBanDurationMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, ShowPlayers);
			} catch (Failure) {
				Reply(unClientIndex, GetFailureMessage(Failure, Phrase("BanFailed", "The ban could not be prepared.")));
			}

			return;
		}

		if (Entry.Name === "gag") {
			try {
				ShowCommunicationActionMenu(unClientIndex, unInitiatorUserID, Entry, unUserID, ShowPlayers);
			} catch (Failure) {
				Reply(unClientIndex, GetFailureMessage(Failure, Phrase("PlayerUnavailable", "The player is no longer eligible.")));
			}

			return;
		}

		const vecPresets = g_mapPlayerActionPresets.get(Entry.Name);
		if (!vecPresets) {
			ExecutePlayerMenuAction(unClientIndex, Entry, unUserID, (strSlapDamage === null) ? [] : [strSlapDamage]);

			if (g_setLivePlayerActions.has(Entry.Name) || (Entry.Name === "rename") || ((Entry.Name === "kick") && (unUserID !== unInitiatorUserID))) {
				ShowPlayers();
			}

			return;
		}

		let Target = null;

		try {
			Target = RequireMenuTarget(unClientIndex, Entry, unUserID);
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("PlayerUnavailable", "The player is no longer eligible.")));
			ShowPlayers();
			return;
		}

		try {
			const vecOptions = vecPresets.map(([strText, strValue], unIndex) => {
				const strKey = (Entry.Name === "gravity") ? ["VeryHigh", "High", "Normal", "Low", "VeryLow"][unIndex] : ["FullyBlind", "PartlyBlind", "ClearBlind"][unIndex];
				const strLabel = Translate(unClientIndex, strKey, "");

				return { Text: strLabel ? ((Entry.Name === "gravity") ? `${strLabel} (${strValue}×)` : strLabel) : strText, Value: strValue };
			});
			vecOptions.push({ Text: "Back to players", Value: null });

			function SelectPreset(unPresetReceiverIndex, strPreset) {
				if ((unPresetReceiverIndex !== unClientIndex) || !CanUsePlayerMenuAction(unClientIndex, unInitiatorUserID, Entry)) {
					return;
				}

				if (strPreset !== null) {
					ExecutePlayerMenuAction(unClientIndex, Entry, unUserID, [strPreset]);
				}

				ShowPlayers();
			}

			if (!SendAdminNavigationMenu(unClientIndex, `${GetAdminActionText(unClientIndex, Entry.Name)}: ${Target.Name}`, vecOptions, SelectPreset)) {
				Reply(unClientIndex, FormatCommand(Entry));
			}
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The player action failed.")));
		}
	};

	let strTitle = GetAdminActionText(unClientIndex, Entry.Name);

	if (Entry.Name === "gag") {
		strTitle = Translate(unClientIndex, "Moderation", "Gag or mute a player");
	} else if (Entry.Name === "who") {
		strTitle = Translate(unClientIndex, "PlayerInfo", "Identify a player");
	} else if (strSlapDamage !== null) {
		strTitle = LabelValue("Slap", Translate(unClientIndex, "Damage", "{Count} damage", { Count: strSlapDamage }), `Slap player: ${strSlapDamage} damage`)(unClientIndex);
	}

	const vecOptions = vecPlayers.map((Target) => ({ Text: Target.Name, Value: Target.UserID }));
	if (ShowCategory !== null) {
		vecOptions.push({ Text: "Back to actions", Value: null });
	}

	if (!SendAdminNavigationMenu(unClientIndex, strTitle, vecOptions, SelectCallback)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function RunKickCommand(unClientIndex, vecArguments, bChat) {
	if (!bChat || (unClientIndex === 0) || (vecArguments.length > 0)) {
		return KickPlayer(unClientIndex, vecArguments);
	}

	const Entry = GetAvailableCommands(unClientIndex).find((Command) => Command.Name === "kick");
	if (!Entry) {
		throw CommandFailure("NoPermission", "You do not have permission to use this command.");
	}

	ShowPlayerActionMenu(unClientIndex, GetUserIDFromIndex(unClientIndex), Entry, null);

	return null;
}

function ShowConfigurationMenu(unClientIndex, unInitiatorUserID, Entry, GoBack) {
	const vecOptions = ReadConfigurationMenu().filter(({ File: strFile }) => DoesFileExist(`cfg/${strFile}`)).map(({ File: strFile, Label: strLabel }) => ({ Text: strLabel, Value: strFile }));
	if (vecOptions.length === 0) {
		Reply(unClientIndex, Phrase("ConfigMenuEmpty", "No config files are available in the menu. Configure Configurations.json or use sjs_execcfg."));
		GoBack();
		return;
	}

	vecOptions.push({ Text: "Back to server actions", Value: null });

	const SelectCallback = (unReceiverIndex, strFile) => {
		if ((unReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unClientIndex, unInitiatorUserID, Entry.Permission)) {
			return;
		}

		if (strFile === null) {
			GoBack();
			return;
		}

		try {
			if (!ReadConfigurationMenu().some((Entry) => Entry.File === strFile)) {
				throw CommandFailure("ConfigUnavailable", "That config is no longer listed in the menu.");
			}

			Reply(unClientIndex, Entry.Execute(unClientIndex, [strFile]));
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The config could not be executed.")));
		}
	};

	if (!SendAdminNavigationMenu(unClientIndex, Translate(unClientIndex, "RunConfig", "Choose a config"), vecOptions, SelectCallback)) {
		Reply(unClientIndex, FormatCommand(Entry));
	}
}

function ShowAdminMenu(unClientIndex) {
	if (unClientIndex === 0) {
		return ShowHelp(unClientIndex, []);
	}

	const vecOptions = Array.from(g_mapAdminCategories.keys()).filter((strPermission) => HasPermission(unClientIndex, strPermission));
	if (vecOptions.length === 0) {
		return ShowHelp(unClientIndex, []);
	}

	const unInitiatorUserID = GetUserIDFromIndex(unClientIndex);

	function ShowCategory(unReceiverIndex, strPermission) {
		if ((unReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unReceiverIndex, unInitiatorUserID, strPermission)) {
			return;
		}

		const vecEntries = GetAvailableCommands(unReceiverIndex).filter((Entry) => Entry.Permission === strPermission);

		if (strPermission === "config") {
			const vecServerActions = vecEntries.filter((Entry) => (Entry.Name === "execcfg") || (Entry.Name === "reloadadmins"));
			const vecOptions = vecServerActions.map((Entry) => ({ Text: GetAdminActionText(unReceiverIndex, Entry.Name), Value: Entry }));
			vecOptions.push({ Text: "Back to categories", Value: null });

			const SelectCallback = (unActionReceiverIndex, Entry) => {
				if ((unActionReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unClientIndex, unInitiatorUserID, "config")) {
					return;
				}

				if (Entry === null) {
					ShowAdminMenu(unClientIndex);
					return;
				}

				try {
					if (Entry.Name === "execcfg") {
						ShowConfigurationMenu(unClientIndex, unInitiatorUserID, Entry, () => ShowCategory(unClientIndex, "config"));
					} else {
						const Result = Entry.Execute(unClientIndex, []);
						if (Result) {
							Reply(unClientIndex, Result);
						}

						ShowCategory(unClientIndex, "config");
					}
				} catch (Failure) {
					Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The server action failed.")));
				}
			};

			if (SendAdminNavigationMenu(unReceiverIndex, Translate(unReceiverIndex, "Configuration", "Server actions"), vecOptions, SelectCallback)) {
				return;
			}
		}

		const vecMapAndVoteActions = vecEntries.filter((Entry) => (Entry.Name === "map") || (Entry.Name === "setnextmap") || g_setVotingMenuActions.has(Entry.Name));
		if (vecMapAndVoteActions.length > 0) {
			const vecOptions = vecMapAndVoteActions.map((Entry) => ({ Text: GetAdminActionText(unReceiverIndex, Entry.Name), Value: Entry }));
			vecOptions.push({ Text: "Back to categories", Value: null });

			const SelectMapOrVoteAction = (unActionReceiverIndex, Entry) => {
				if ((unActionReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unClientIndex, unInitiatorUserID, strPermission)) {
					return;
				}

				if (Entry === null) {
					ShowAdminMenu(unClientIndex);
					return;
				}

				const AccessError = GetCommandAccessError(unClientIndex, Entry);
				if (AccessError !== null) {
					Reply(unClientIndex, AccessError);
					return;
				}

				try {
					if ((Entry.Name === "map") || (Entry.Name === "setnextmap") || (Entry.Name === "votemap")) {
						ShowMapMenu(unClientIndex, unInitiatorUserID, Entry, g_ReadRotationMaps, () => ShowCategory(unClientIndex, strPermission));
						return;
					}

					if (g_setTargetVotes.has(Entry.Name)) {
						ShowPlayerActionMenu(unClientIndex, unInitiatorUserID, Entry, ShowCategory);
						return;
					}

					const vecArguments = (Entry.Name === "votegravity") ? g_vecGravityVoteOptions : [];
					const Result = Entry.Execute(unClientIndex, vecArguments);
					if (Result) {
						Reply(unClientIndex, Result);
					}
				} catch (Failure) {
					Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The menu action failed.")));
				}
			};

			const strTitle = (strPermission === "map") ? Translate(unReceiverIndex, "Maps", "Map actions") : Translate(unReceiverIndex, "Votes", "Voting actions");
			if (SendAdminNavigationMenu(unReceiverIndex, strTitle, vecOptions, SelectMapOrVoteAction)) {
				return;
			}
		}

		const vecPlayerActions = vecEntries.filter((Entry) => g_setPlayerActions.has(Entry.Name) && CanUsePlayerMenuAction(unReceiverIndex, unInitiatorUserID, Entry));
		if (vecPlayerActions.length > 0) {
			function SelectAction(unActionReceiverIndex, Entry) {
				if ((unActionReceiverIndex !== unClientIndex) || !CanUseAdminMenu(unClientIndex, unInitiatorUserID, strPermission)) {
					return;
				}

				if (Entry === null) {
					ShowAdminMenu(unClientIndex);
					return;
				}

				if (Entry.Name === "slap") {
					ShowSlapDamageMenu(unActionReceiverIndex, unInitiatorUserID, Entry, ShowCategory);
				} else {
					ShowPlayerActionMenu(unActionReceiverIndex, unInitiatorUserID, Entry, ShowCategory);
				}
			}

			const vecOptions = vecPlayerActions.map((Entry) => ({ Text: GetAdminActionText(unReceiverIndex, Entry.Name), Value: Entry }));
			vecOptions.push({ Text: "Back to categories", Value: null });

			if (SendAdminNavigationMenu(unReceiverIndex, GetAdminCategoryText(unReceiverIndex, strPermission), vecOptions, SelectAction, "Choose an action, then select a player.")) {
				return;
			}
		}

		Reply(unReceiverIndex, vecEntries.map(FormatCommand).join("\n"));
	}

	try {
		const vecCategories = vecOptions.map((strPermission) => ({ Text: GetAdminCategoryText(unClientIndex, strPermission), Value: strPermission }));
		if (SendAdminNavigationMenu(unClientIndex, Translate(unClientIndex, "Administration", "SourceJS administration"), vecCategories, ShowCategory, "Choose a category to manage the server.")) {
			return Phrase("SelectOption", "Choose a category to view its actions.");
		}
	} catch {
		return ShowHelp(unClientIndex, []);
	}

	return ShowHelp(unClientIndex, []);
}

function ShowFriendlyFireStatus() {
	const ConVar = FindConVar("mp_friendlyfire");
	if (ConVar.Exists === true) {
		return (Number(ConVar.Value) !== 0) ? Phrase("FriendlyFireOn", "Friendly fire is enabled.") : Phrase("FriendlyFireOff", "Friendly fire is disabled.");
	}

	const Difficulty = FindConVar("z_difficulty");
	if (Difficulty.Exists === true) {
		const strDifficulty = Difficulty.Value.toLowerCase();
		const strFactorName = (strDifficulty === "impossible") ? "expert" : (["easy", "normal", "hard"].includes(strDifficulty) ? strDifficulty : "normal");
		const Factor = FindConVar(`survivor_friendly_fire_factor_${strFactorName}`);
		const flFactor = Number(Factor.Value);
		if ((Factor.Exists === true) && Number.isFinite(flFactor)) {
			return Phrase("FriendlyFireDamage", "Survivor friendly-fire damage: {Percent}%.", { Percent: Math.round(flFactor * 100) });
		}
	}

	return Phrase("CvarNotFound", "This game does not expose a friendly-fire setting.");
}

function ShowMessageOfTheDay(unClientIndex) {
	const Panel = new VGUIMenu("info", { title: Translate(unClientIndex, "MotdTitle", "Message of the Day"), type: "1", msg: "motd" });
	if (!Panel.SendUserMessage(unClientIndex)) {
		throw CommandFailure("MotdUnavailable", "This game could not open the message-of-the-day panel.");
	}
}

function ShowServerClock() {
	const unMillisecondsPerSecond = 1_000;
	const unHoursPerHalfDay = 12;
	const strFormat = g_DateTimeFormat.Value || g_strDefaultDateTimeFormat;
	if (/[\x00-\x1F\x7F]/.test(strFormat)) {
		throw CommandFailure("InvalidInput", "sjs_datetime_format must be a single line without control characters.");
	}

	const nAdjustmentSeconds = Math.trunc(Number(g_TimeAdjustment.Value));
	const LocalTime = new Date(Date.now() + nAdjustmentSeconds * unMillisecondsPerSecond);
	if (!Number.isFinite(LocalTime.getTime())) {
		throw CommandFailure("InvalidInput", "sjs_time_adjustment does not produce a valid server time.");
	}

	const strYear = String(LocalTime.getFullYear()).padStart(4, "0");
	const strMonth = String(LocalTime.getMonth() + 1).padStart(2, "0");
	const strDay = String(LocalTime.getDate()).padStart(2, "0");
	const unHour = LocalTime.getHours();
	const strHours = String(unHour).padStart(2, "0");
	const strTwelveHour = String((unHour % unHoursPerHalfDay) || unHoursPerHalfDay).padStart(2, "0");
	const strMinutes = String(LocalTime.getMinutes()).padStart(2, "0");
	const strSeconds = String(LocalTime.getSeconds()).padStart(2, "0");

	// Keys match the case-sensitive time-format tokens accepted by the ConVar.
	const Tokens = {
		Y: strYear,
		m: strMonth,
		d: strDay,
		H: strHours,
		I: strTwelveHour,
		M: strMinutes,
		S: strSeconds,
		p: (unHour < unHoursPerHalfDay) ? "AM" : "PM",
		F: `${strYear}-${strMonth}-${strDay}`,
		T: `${strHours}:${strMinutes}:${strSeconds}`,
		"%": "%",
	};

	const strTimestamp = strFormat.replace(/%([\s\S]|$)/g, (strToken, strCode) => {
		if (!Object.hasOwn(Tokens, strCode)) {
			throw CommandFailure("InvalidInput", `Unsupported time format token: ${strToken}.`);
		}

		return Tokens[strCode];
	});

	return Phrase("ServerTime", "Server time: {Time}", { Time: strTimestamp });
}

function ReloadAdministrators(unClientIndex, vecArguments, bChat = false) {
	if (vecArguments.length !== 0) {
		throw CommandUsage("sjs_reloadadmins.");
	}

	const unUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	Reload();

	if (!IsSQLAuthorizationEnabled()) {
		return Phrase("AuthReloaded", "Authorization configuration read.");
	}

	Reply(unClientIndex, Phrase("AuthReloaded", "Authorization configuration read."), bChat);
	RunSQLAuthorizationRequest(null, (Failure) => {
		if ((unClientIndex !== 0) && !GetAllPlayers().some((Player) => Player.Connected && (Player.Index === unClientIndex) && (Player.UserID === unUserID))) {
			return;
		}

		Reply(unClientIndex, (Failure === null) ? Phrase("SQLUpdated", "SQL administrator permissions refreshed.") : Phrase("SQLFailed", "SQL administrator permissions could not be refreshed."), bChat);
	});
}

function RegisterServerCommands(ReadRotationMaps, RecoverNextMap) {
	g_ReadRotationMaps = ReadRotationMaps;
	g_RecoverNextMap = RecoverNextMap;

	g_DateTimeFormat = CreateConVar("sjs_datetime_format", g_strDefaultDateTimeFormat, "Local date and time format for thetime.");
	g_TimeAdjustment = CreateConVar("sjs_time_adjustment", "0", "Clock offset in seconds for thetime.");

	DefineCommand("kick", "kick", "<target> [reason]", RunKickCommand);
	DefineCommand("admin", "admin", "", ShowAdminMenu);
	DefineCommand("help", null, "[page|search]", ShowHelp);
	DefineCommand("searchcmd", null, "[command fragment]", SearchCommands);
	DefineCommand("who", "admin", "[target]", ShowPlayers);
	DefineCommand("map", "map", "<map>", RunMapCommand);
	DefineCommand("cvar", "cvar", "<cvar> [value] | protect <cvar>", HandleConVarCommand);
	DefineCommand("resetcvar", "cvar", "<cvar>", ResetConVar);
	DefineCommand("execcfg", "config", "<filename.cfg>", ExecuteConfiguration);
	DefineCommand("rcon", "rcon", "<command> [arguments]", ExecuteConsoleCommand);
	DefineCommand("reloadadmins", "config", "", ReloadAdministrators);
	DefineCommand("ff", null, "", ShowFriendlyFireStatus);
	DefineCommand("motd", null, "", ShowMessageOfTheDay, false, null, "The message-of-the-day panel is available in game only.");
	DefineCommand("currentmap", null, "", () => {
		const strMap = GetMapName();

		return strMap ? Phrase("CurrentMap", "Current map: {Map}.", { Map: strMap }) : Phrase("NoActiveMap", "No map is active.");
	});
	DefineCommand("thetime", null, "", ShowServerClock);
}

module.exports = { CloseAdminMenu, CloseAdminMenus, HasPendingMapChange, CancelMapChange, RequireMapName, ChangeMap, RegisterServerCommands };
