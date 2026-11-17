"use strict";

const { BLOCK, Command } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/say");
const { LogWarning } = require("core/logger");
const { GetGameDirectory, GetMapName } = require("engines/server");
const { RegisterEventListener, UnregisterEventListener } = require("events/listener");
const { GetAllPlayers } = require("filters/players");
const {
	RegisterClientActiveListener,
	RegisterClientDisconnectListener,
	RegisterLevelShutdownListener,
	RegisterServerActivateListener,
	RegisterTickListener,
} = require("listeners");
const { ResetTranslations } = require("./translations");
const { DispatchChatCommand, RegisterConsoleCommands } = require("./administration");
const { ClosePreferences, ClosePreferenceSessions, ForgetPreferenceSession, RegisterPreferenceCommands } = require("./client-preferences");
const {
	ClearAnnouncementPanels,
	FilterAdminChatShortcut,
	FilterGaggedChat,
	HandleCommunicationDisconnect,
	ReapplyCommunicationMutes,
	RegisterCommunicationCommands,
	ResetCommunication,
} = require("./communication");
const { RegisterEffectsCommands, StopAllBeacons, StopAllFreezes, StopBeacon, StopFreeze } = require("./effects");
const { ClearFunCommandAssets, GetFunCommandAssets } = require("./fun-effects");
const { RecordMapEnd } = require("./map-history");
const { CloseMapMenu, CloseMapMenus } = require("./map-menu");
const { PrepareMenuSounds, RegisterMenuSounds, ResetMenuSounds } = require("./menu-sounds");
const { ClearPendingBanReasons, HandleBanDisconnect, HandleCustomBanReason, RegisterModerationCommands } = require("./moderation");
const {
	AnnounceMapTime,
	ApplyRoundEndMap,
	ForgetMapVoter,
	GetRotationMaps,
	HandleChangeLevelFailure,
	InitializeMapRotation,
	RecordMapVoteDeath,
	RecordMapVoteRound,
	RecoverFailedNextMap,
	RegisterMapRotationCommands,
	ResetMapRotation,
	ResetMapVoteScores,
	ResetTimeLeftRounds,
} = require("./rotation");
const { CancelMapChange, CloseAdminMenu, CloseAdminMenus, RegisterServerCommands } = require("./server");
const { RegisterSQLAdministrationCommands } = require("./sql-administration");
const { CloseSQLAuthorization, ConfigureSQLAuthorization, RefreshSQLAuthorizationOnMap } = require("./sql-authorization");
const { RegisterTimedEffectCommands, StopAllTimedEffects, StopTimedPlayerEffects } = require("./timed-effects");
const { HandleVoteDisconnect, RegisterVoteCommands, ResetVotes, UpdateVote } = require("./votes");

const g_vecSubscriptions = [];
const g_mapGameEventCallbacks = new Map();
let g_bChatRegistered = false;
let g_bWaitingForFirstMap = true;

function FilterChat(Payload) {
	const Invocation = new Command(Payload);
	if (FilterGaggedChat(Invocation) === BLOCK) {
		return BLOCK;
	}

	if ((FilterAdminChatShortcut(Invocation) === BLOCK) || HandleCustomBanReason(Invocation)) {
		return BLOCK;
	}

	return DispatchChatCommand(Invocation);
}

function HandleDisconnect(unClientIndex) {
	ForgetPreferenceSession(unClientIndex);
	HandleBanDisconnect(unClientIndex);
	HandleCommunicationDisconnect(unClientIndex);
	HandleVoteDisconnect(unClientIndex);
	ForgetMapVoter(unClientIndex);
	StopBeacon(unClientIndex);
	StopFreeze(unClientIndex, false);
	StopTimedPlayerEffects(unClientIndex, false);
	CloseMapMenu(unClientIndex);
	CloseAdminMenu(unClientIndex);
}

function ClearRoundEffects() {
	const vecFailures = [];

	for (const Release of [StopAllBeacons, StopAllTimedEffects, StopAllFreezes]) {
		try {
			Release();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not clear all Fun Commands effects.");
	}
}

function HandleRoundEnd(Event) {
	try {
		ClearRoundEffects();
	} finally {
		ApplyRoundEndMap();
		RecordMapVoteRound(Event);
	}
}

function HandleRoundRestart() {
	try {
		ClearRoundEffects();
	} finally {
		ResetMapVoteScores();
		ResetTimeLeftRounds();
	}
}

function HandlePlayerDeath(Event) {
	try {
		const nUserID = Event.GetEventInteger("userid");
		const Player = (nUserID > 0) ? GetAllPlayers().find((Target) => Target.Connected && (Target.UserID === nUserID)) : null;
		if (!Player) {
			return;
		}

		const vecFailures = [];

		for (const Release of [StopBeacon, StopTimedPlayerEffects, StopFreeze]) {
			try {
				Release(Player.Index);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		if (vecFailures.length > 0) {
			throw new AggregateError(vecFailures, "Could not clear all Fun Commands effects for the player who died.");
		}
	} finally {
		RecordMapVoteDeath(Event);
	}
}

function SubscribeToGameEvents(bReportUnavailable) {
	const strGame = GetGameDirectory().split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase();
	const vecRegistrations = (strGame === "tf") ? [
		["teamplay_win_panel", HandleRoundEnd],
		["teamplay_restart_round", HandleRoundRestart],
		["arena_win_panel", HandleRoundEnd],
	] : [[(strGame === "nucleardawn") ? "round_win" : "round_end", HandleRoundEnd]];
	vecRegistrations.push(["game_start", ResetTimeLeftRounds, true], ["game_newmap", ResetTimeLeftRounds, true], ["player_death", HandlePlayerDeath], ["server_changelevel_failed", HandleChangeLevelFailure, true]);

	for (const [strEventName, Callback, bOptional = false] of vecRegistrations) {
		if (g_mapGameEventCallbacks.has(strEventName)) {
			continue;
		}

		if (RegisterEventListener(strEventName, Callback)) {
			g_mapGameEventCallbacks.set(strEventName, Callback);
		} else if (bReportUnavailable && !bOptional) {
			LogWarning(`Server administration could not subscribe to "${strEventName}".`);
		}
	}
}

function UnsubscribeFromGameEvents() {
	const vecFailedEvents = [];

	for (const [strEventName, Callback] of g_mapGameEventCallbacks) {
		if (UnregisterEventListener(strEventName, Callback)) {
			g_mapGameEventCallbacks.delete(strEventName);
		} else {
			vecFailedEvents.push(strEventName);
		}
	}

	if (vecFailedEvents.length > 0) {
		throw new Error(`Could not unregister server administration events: ${vecFailedEvents.join(", ")}.`);
	}
}

function HandleLevelShutdown() {
	g_bWaitingForFirstMap = false;
	RecordMapEnd();
	ClosePreferenceSessions();
	ClearPendingBanReasons();
	CancelMapChange();
	ResetVotes();
	ResetMenuSounds();
	ResetMapRotation();

	try {
		ClearRoundEffects();
	} finally {
		ClearFunCommandAssets();
		ClearAnnouncementPanels();
		CloseMapMenus();
		CloseAdminMenus();
	}
}

function ActivateMap(bLateLoad) {
	g_bWaitingForFirstMap = false;
	ResetTranslations();
	ReapplyCommunicationMutes();
	SubscribeToGameEvents(true);
	GetFunCommandAssets();
	PrepareMenuSounds();
	CancelMapChange();
	InitializeMapRotation(bLateLoad);
	RefreshSQLAuthorizationOnMap();
}

function HandleServerActivate() {
	ActivateMap(false);
}

function HandleTick() {
	if (g_bWaitingForFirstMap && GetMapName()) {
		ActivateMap(true);
	}

	AnnounceMapTime();
	UpdateVote();
}

function DisposeChatFilter() {
	if (g_bChatRegistered) {
		if (!UnregisterCommandFilter(FilterChat)) {
			throw new Error("Could not remove the administration chat filter.");
		}

		g_bChatRegistered = false;
	}
}

function DisposeSubscriptions() {
	while (g_vecSubscriptions.length > 0) {
		const Subscription = g_vecSubscriptions[g_vecSubscriptions.length - 1];
		if (!Subscription.Disposed && !Subscription.DisposeListener()) {
			throw new Error("Could not dispose an administration listener.");
		}

		g_vecSubscriptions.pop();
	}
}

function Unload() {
	const vecFailures = [];

	for (const Release of [DisposeChatFilter, DisposeSubscriptions, UnsubscribeFromGameEvents, ClearPendingBanReasons, ResetVotes, CancelMapChange, ResetMapRotation, CloseMapMenus, CloseAdminMenus, ClearRoundEffects, ClearAnnouncementPanels, ResetCommunication, ClosePreferences, CloseSQLAuthorization]) {
		try {
			Release();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Server administration cleanup failed.");
	}
}

function Initialize() {
	RegisterMenuSounds();
	ConfigureSQLAuthorization();

	RegisterModerationCommands();
	RegisterCommunicationCommands();
	RegisterEffectsCommands();
	RegisterTimedEffectCommands();
	RegisterPreferenceCommands();
	RegisterSQLAdministrationCommands();
	RegisterServerCommands(GetRotationMaps, RecoverFailedNextMap);
	RegisterVoteCommands();
	RegisterMapRotationCommands();
	RegisterConsoleCommands();

	SubscribeToGameEvents(false);

	for (const vecRegistration of [
		[RegisterClientActiveListener, ReapplyCommunicationMutes],
		[RegisterClientDisconnectListener, HandleDisconnect],
		[RegisterLevelShutdownListener, HandleLevelShutdown],
		[RegisterServerActivateListener, HandleServerActivate],
		[RegisterTickListener, HandleTick],
	]) {
		const [Register, Callback] = vecRegistration;
		const Subscription = Register(Callback);
		if (!Subscription) {
			throw new Error("Could not register an administration listener.");
		}

		g_vecSubscriptions.push(Subscription);
	}

	if (!RegisterCommandFilter(FilterChat)) {
		throw new Error("Could not register the administration chat filter.");
	}

	g_bChatRegistered = true;
}

try {
	Initialize();
} catch (Failure) {
	try {
		Unload();
	} catch (CleanupFailure) {
		throw new AggregateError([Failure, CleanupFailure], "Server administration startup failed and cleanup was incomplete.");
	}

	throw Failure;
}

module.exports = { Unload };
