"use strict";

const { HasPlayerPermission } = require("auth");
const { BLOCK, CONTINUE } = require("commands");
const { RegisterCommandFilter, UnregisterCommandFilter } = require("commands/say");
const { CreateConVar } = require("cvars");
const { GetServerTime, PrintToClientConsole } = require("engines/server");
const { GetModule } = require("internal/runtime");
const { RegisterClientActiveListener, RegisterClientDisconnectListener, RegisterLevelEndListener, RegisterServerActivateListener } = require("listeners");
const { GetUserMessageIndex, HUD_DESTINATION, HUDTextMessage, SendUserMessageValue } = require("messages");
const {
	HandleReservationActive,
	HandleReservationDisconnect,
	HandleReservationLevelEnd,
	HandleReservationServerActivate,
	LoadReservations,
	UnloadReservations,
} = require("./reserved-slots");
const { ResetTranslations, Translate } = require("./translations");

const { GetPlayer } = GetModule("players");

const g_unMaximumFloodStrikes = 3;
const g_flFloodPenaltySeconds = 3;
const g_mapChatLimits = new Map();
const g_vecSubscriptions = [];
let g_FloodInterval = null;
let g_bChatFilterRegistered = false;

function WarnFloodingPlayer(unClientIndex) {
	const strMessage = `[SourceJS] ${Translate(unClientIndex, "Flood", "You are sending chat messages too quickly.")}`;
	try {
		if ((GetUserMessageIndex("TextMsg") >= 0) && HUD_DESTINATION && SendUserMessageValue([unClientIndex], new HUDTextMessage(strMessage, { Destination: HUD_DESTINATION.Talk }))) {
			return;
		}
	} catch {
		// A missing message backend must not prevent the console fallback.
	}

	try {
		PrintToClientConsole(unClientIndex, "[SourceJS] You are sending chat messages too quickly.\n");
	} catch {
		// Warning delivery must not let a blocked message reach chat or command handlers.
	}
}

function FilterChat(Invocation) {
	const nClientIndex = Invocation.Index;
	const flInterval = Number(g_FloodInterval.Value);
	if (!Number.isFinite(flInterval) || (flInterval <= 0) || !Number.isInteger(nClientIndex) || (nClientIndex <= 0) || HasPlayerPermission(nClientIndex, "sourcejs.flood")) {
		return CONTINUE;
	}

	const CurrentPlayer = GetPlayer(nClientIndex);
	if (!CurrentPlayer || CurrentPlayer.FakeClient || (CurrentPlayer.Connected !== true)) {
		return CONTINUE;
	}

	const flNow = GetServerTime();
	if (!Number.isFinite(flNow)) {
		return CONTINUE;
	}

	const unUserID = CurrentPlayer.UserID;
	const Previous = g_mapChatLimits.get(nClientIndex);
	const bSamePlayer = Previous?.UserID === unUserID;
	const bTooSoon = bSamePlayer && (flNow <= Previous.NextMessageTime);
	const unPreviousStrikes = bSamePlayer ? Previous.Strikes : 0;
	const bBlocked = bTooSoon && (unPreviousStrikes >= g_unMaximumFloodStrikes);
	const flNextMessageTime = flNow + flInterval + (bBlocked ? g_flFloodPenaltySeconds : 0);
	const unStrikes = bTooSoon ? Math.min(g_unMaximumFloodStrikes, unPreviousStrikes + 1) : Math.max(0, unPreviousStrikes - 1);
	g_mapChatLimits.set(nClientIndex, { UserID: unUserID, NextMessageTime: flNextMessageTime, Strikes: unStrikes });

	if (bBlocked) {
		WarnFloodingPlayer(nClientIndex);
		return BLOCK;
	}

	return CONTINUE;
}

function HandleClientDisconnect(unClientIndex) {
	g_mapChatLimits.delete(unClientIndex);

	HandleReservationDisconnect(unClientIndex);
}

function HandleLevelEnd() {
	ResetTranslations();

	g_mapChatLimits.clear();

	HandleReservationLevelEnd();
}

function Unload() {
	g_mapChatLimits.clear();

	const vecFailures = [];

	try {
		UnloadReservations();
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	if (g_bChatFilterRegistered) {
		try {
			if (!UnregisterCommandFilter(FilterChat, true)) {
				throw new Error("Could not unregister the flood-protection filter.");
			}

			g_bChatFilterRegistered = false;
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	for (const Subscription of g_vecSubscriptions.splice(0)) {
		try {
			if (!Subscription.Disposed && !Subscription.DisposeListener()) {
				throw new Error("Could not dispose a server-protection listener.");
			}
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Server protection cleanup failed.");
	}
}

function Load() {
	const unMaximumFloodIntervalSeconds = 10;
	g_FloodInterval = CreateConVar("sjs_flood_time", "0.75", "Minimum time between chat messages in seconds; zero disables flood protection.", 0, 0, unMaximumFloodIntervalSeconds);

	LoadReservations();

	if (!RegisterCommandFilter(FilterChat, true)) {
		throw new Error("Could not register the flood-protection filter.");
	}

	g_bChatFilterRegistered = true;
	for (const Subscribe of [
		() => RegisterClientActiveListener(HandleReservationActive),
		() => RegisterClientDisconnectListener(HandleClientDisconnect),
		() => RegisterLevelEndListener(HandleLevelEnd),
		() => RegisterServerActivateListener(HandleReservationServerActivate),
	]) {
		const Subscription = Subscribe();
		if (!Subscription) {
			throw new Error("Could not register a server-protection listener.");
		}

		g_vecSubscriptions.push(Subscription);
	}
}

module.exports = { Load, Unload };
