"use strict";

const { HasPlayerPermission } = require("auth");
const { CreateConVar, FindConVar } = require("cvars");
const { GetMaximumHumanClients } = require("engines/server");
const { GetAllPlayers } = require("filters/players");
const { GetModule } = require("internal/runtime");
const { RepeatingTickTask, TickDelay } = require("listeners/tick");
const { GetPlayerNetChannelInfo, NET_FLOW } = require("netchannel");
const { Translate } = require("./translations");

const { GetPlayer, IsObserver } = GetModule("players");

const g_flAdmissionDelaySeconds = 0.1;
const g_flVisibilityIntervalSeconds = 1;
const g_ReservationMode = Object.freeze({ AdmitWithoutDisplacement: 0, LimitDisplacement: 2 });
const g_KickSelectionMode = Object.freeze({ LongestConnected: 1, Random: 2 });
const g_mapPendingAdmissions = new Map();
const g_mapPendingKicks = new Map();
let g_ReservedSlots = null;
let g_HideSlots = null;
let g_ReserveType = null;
let g_ReserveMaximumAdministrators = null;
let g_ReserveKickType = null;
let g_VisibleCapacity = null;
let g_VisibilityTask = null;
let g_strPreviousVisibleCapacity = null;
let g_strWrittenVisibleCapacity = null;
let g_bMapActive = false;

function HasReservation(unClientIndex) {
	return HasPlayerPermission(unClientIndex, "sourcejs.reservation");
}

function GetPopulation(unExcludedIndex) {
	const unMaximumClients = GetMaximumHumanClients();
	const unReservedSlots = Math.trunc(Number(g_ReservedSlots.Value));
	const unPublicLimit = Math.max(0, unMaximumClients - unReservedSlots);
	const vecHumans = (Number.isInteger(unMaximumClients) && (unMaximumClients > 0) && (unReservedSlots > 0)) ? GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient && (Player.Index !== unExcludedIndex)) : [];

	return { MaximumClients: unMaximumClients, ReservedSlots: unReservedSlots, PublicLimit: unPublicLimit, Humans: vecHumans };
}

function IsReservationEnabled(Population) {
	return Number.isInteger(Population.MaximumClients) && (Population.MaximumClients > 0) && Number.isInteger(Population.ReservedSlots) && (Population.ReservedSlots > 0);
}

function RestoreVisibleCapacity() {
	if (g_strPreviousVisibleCapacity === null) {
		return;
	}

	if (g_VisibleCapacity.Value === g_strWrittenVisibleCapacity) {
		g_VisibleCapacity.Value = g_strPreviousVisibleCapacity;
	}

	g_strPreviousVisibleCapacity = null;
	g_strWrittenVisibleCapacity = null;
}

function UpdateVisibleCapacity(unExcludedIndex = 0) {
	if (!g_bMapActive || !g_VisibleCapacity?.Exists) {
		return;
	}

	if (Number(g_HideSlots.Value) !== 1) {
		RestoreVisibleCapacity();
		return;
	}

	const Population = GetPopulation(unExcludedIndex);
	if (!IsReservationEnabled(Population)) {
		RestoreVisibleCapacity();
		return;
	}

	const strCurrent = g_VisibleCapacity.Value;
	const strCapacity = String(Math.min(Population.MaximumClients, Math.max(Population.PublicLimit, Population.Humans.length)));
	if (strCurrent === strCapacity) {
		return;
	}

	if ((g_strPreviousVisibleCapacity === null) || (strCurrent !== g_strWrittenVisibleCapacity)) {
		g_strPreviousVisibleCapacity = strCurrent;
	}

	g_VisibleCapacity.Value = strCapacity;
	g_strWrittenVisibleCapacity = strCapacity;
}

function GetKickScore(unClientIndex, nKickType) {
	if (nKickType === g_KickSelectionMode.Random) {
		return Math.random();
	}

	try {
		const Information = GetPlayerNetChannelInfo(unClientIndex);
		const flScore = (nKickType === g_KickSelectionMode.LongestConnected) ? Information?.TimeConnected : Information?.GetNetChannelAverageLatency(NET_FLOW.Outgoing);

		return Number.isFinite(flScore) ? flScore : 0;
	} catch {
		// The network channel can disappear while a player is leaving.
		return 0;
	}
}

function SelectKickTarget(vecHumans) {
	const nKickType = Math.trunc(Number(g_ReserveKickType.Value));
	let Target = null;
	let bTargetIsObserver = false;
	let flBestScore = -Infinity;

	for (const Player of vecHumans) {
		const unPlayerIndex = Player.Index;
		if (HasReservation(unPlayerIndex) || HasPlayerPermission(unPlayerIndex, "sourcejs.reskick_immunity")) {
			continue;
		}

		const bObserver = IsObserver(unPlayerIndex) === true;
		const flScore = GetKickScore(unPlayerIndex, nKickType);
		if (!Target || (bObserver && !bTargetIsObserver) || ((bObserver === bTargetIsObserver) && (flScore >= flBestScore))) {
			Target = Player;
			bTargetIsObserver = bObserver;
			flBestScore = flScore;
		}
	}

	return Target;
}

function CheckAdmission(unClientIndex, Pending) {
	if (!g_bMapActive || (g_mapPendingAdmissions.get(unClientIndex) !== Pending)) {
		return;
	}

	g_mapPendingAdmissions.delete(unClientIndex);

	const Population = GetPopulation(0);
	const vecHumans = Population.Humans.filter((Player) => g_mapPendingKicks.get(Player.Index) !== Player.UserID);
	const Joining = vecHumans.find((Player) => (Player.Index === unClientIndex) && (Player.UserID === Pending.UserID));
	if (!Joining || !IsReservationEnabled(Population) || (vecHumans.length <= Population.PublicLimit)) {
		return;
	}

	const nReserveType = Math.trunc(Number(g_ReserveType.Value));
	const bReservedAccess = HasReservation(unClientIndex);

	if (nReserveType === g_ReservationMode.LimitDisplacement) {
		const unAdministrators = vecHumans.filter((Player) => HasReservation(Player.Index)).length;
		if (unAdministrators >= Math.trunc(Number(g_ReserveMaximumAdministrators.Value))) {
			return;
		}
	}

	const Target = bReservedAccess
		? ((nReserveType === g_ReservationMode.AdmitWithoutDisplacement) ? null : SelectKickTarget(vecHumans))
		: Joining;
	if (!Target) {
		return;
	}

	const CurrentPlayer = GetPlayer(Target.Index);
	if (!CurrentPlayer?.Connected || CurrentPlayer.FakeClient || (CurrentPlayer.UserID !== Target.UserID) || HasReservation(Target.Index)) {
		return;
	}

	g_mapPendingKicks.set(Target.Index, Target.UserID);
	let bKicked = false;

	try {
		bKicked = CurrentPlayer.Kick(Translate(Target.Index, "ReservedSlot", "This slot is reserved for a player with reservation access."));
	} finally {
		if (!bKicked) {
			g_mapPendingKicks.delete(Target.Index);
		}
	}
}

function HandleReservationActive(unClientIndex) {
	UpdateVisibleCapacity();

	if (!g_bMapActive || !(Number(g_ReservedSlots.Value) >= 1)) {
		return;
	}

	const CurrentPlayer = GetPlayer(unClientIndex);
	if (!CurrentPlayer?.Connected || CurrentPlayer.FakeClient || (g_mapPendingKicks.get(unClientIndex) === CurrentPlayer.UserID)) {
		return;
	}

	const unUserID = CurrentPlayer.UserID;
	const Pending = g_mapPendingAdmissions.get(unClientIndex);
	if (Pending?.UserID === unUserID) {
		return;
	}

	Pending?.Delay.DisposeTickDelay();
	g_mapPendingAdmissions.delete(unClientIndex);

	const Population = GetPopulation(0);
	if (!IsReservationEnabled(Population) || (Population.Humans.length <= Population.PublicLimit)) {
		return;
	}

	const Admission = { UserID: unUserID, Delay: null };
	Admission.Delay = new TickDelay(g_flAdmissionDelaySeconds, () => CheckAdmission(unClientIndex, Admission), [], true);
	g_mapPendingAdmissions.set(unClientIndex, Admission);
}

function HandleReservationDisconnect(unClientIndex) {
	g_mapPendingAdmissions.get(unClientIndex)?.Delay.DisposeTickDelay();
	g_mapPendingAdmissions.delete(unClientIndex);
	g_mapPendingKicks.delete(unClientIndex);

	UpdateVisibleCapacity(unClientIndex);
}

function HandleReservationLevelEnd() {
	g_bMapActive = false;

	for (const { Delay } of g_mapPendingAdmissions.values()) {
		Delay.DisposeTickDelay();
	}

	g_mapPendingAdmissions.clear();
	g_mapPendingKicks.clear();

	RestoreVisibleCapacity();
}

function HandleReservationServerActivate() {
	g_bMapActive = true;

	UpdateVisibleCapacity();
}

function LoadReservations() {
	const unMaximumConfiguredSlots = 255;
	g_ReservedSlots = CreateConVar("sjs_reserved_slots", "0", "Number of slots reserved for clients with sourcejs.reservation.", 0, 0, unMaximumConfiguredSlots);
	g_HideSlots = CreateConVar("sjs_hide_slots", "0", "Hide unoccupied reserved slots from the server browser.", 0, 0, 1);
	g_ReserveType = CreateConVar("sjs_reserve_type", "0", "Reserved slot policy: 0 admit, 1 make room, 2 make room until the administrator threshold.", 0, 0, g_ReservationMode.LimitDisplacement);
	g_ReserveMaximumAdministrators = CreateConVar("sjs_reserve_maxadmins", "1", "Connected reservation holders at which policy 2 stops reserving slots.", 0, 0, unMaximumConfiguredSlots);
	g_ReserveKickType = CreateConVar("sjs_reserve_kicktype", "0", "Displacement priority: 0 highest outgoing latency, 1 longest connected, 2 random.", 0, 0, g_KickSelectionMode.Random);
	g_VisibleCapacity = FindConVar("sv_visiblemaxplayers");

	g_bMapActive = true;

	if (g_VisibleCapacity?.Exists) {
		// Read configuration changes even on SDKs without native ConVar change events.
		g_VisibilityTask = new RepeatingTickTask(UpdateVisibleCapacity);
		g_VisibilityTask.StartRepeatingTickTask(g_flVisibilityIntervalSeconds);
		UpdateVisibleCapacity();
	}
}

function UnloadReservations() {
	g_VisibilityTask?.DisposeRepeatingTickTask();
	g_VisibilityTask = null;

	HandleReservationLevelEnd();
}

module.exports = { HandleReservationActive, HandleReservationDisconnect, HandleReservationLevelEnd, HandleReservationServerActivate, LoadReservations, UnloadReservations };
