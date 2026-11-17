"use strict";

const { LogWarning } = require("core/logger");
const { FindConVar } = require("cvars");
const { ReadTextFile, WriteTextFile } = require("filesystem");
const { PLUGIN_DATA_ROOT } = require("paths");

const MAXIMUM_HISTORY_ENTRIES = 20;
const g_strRecentMapsFile = `${PLUGIN_DATA_ROOT}/server-administration/RecentMaps.txt`;
const g_vecPreviousMaps = [];
const g_mapRecentMaps = new Map();
let g_bReadRecentMaps = false;
let g_CurrentMap = null;
let g_RequestedChange = null;

function IsRecentMapPersistenceEnabled() {
	return Number(FindConVar("sjs_mapvote_persistentmaps").Value) === 1;
}

function AddRecentMap(strMap) {
	if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(strMap)) {
		return;
	}

	const strKey = strMap.toLowerCase();
	g_mapRecentMaps.delete(strKey);
	g_mapRecentMaps.set(strKey, strMap);

	if (g_mapRecentMaps.size > MAXIMUM_HISTORY_ENTRIES) {
		g_mapRecentMaps.delete(g_mapRecentMaps.keys().next().value);
	}
}

function ReadRecentMaps() {
	if (g_bReadRecentMaps || !IsRecentMapPersistenceEnabled()) {
		return;
	}

	g_bReadRecentMaps = true;

	try {
		const strFileContents = ReadTextFile(g_strRecentMapsFile);
		if (strFileContents === null) {
			return;
		}

		const vecObservedMaps = [...g_mapRecentMaps.values()];
		for (const strLine of strFileContents.split(/\r?\n/)) {
			AddRecentMap(strLine.trim());
		}

		for (const strMap of vecObservedMaps) {
			AddRecentMap(strMap);
		}
	} catch (Failure) {
		LogWarning(`Could not read recent maps: ${Failure.message}`);
	}
}

function RecordRecentMap(strMap) {
	ReadRecentMaps();
	AddRecentMap(strMap);

	if (!IsRecentMapPersistenceEnabled()) {
		return;
	}

	try {
		const strFileContents = `${[...g_mapRecentMaps.values()].join("\n")}\n`;
		if (!WriteTextFile(g_strRecentMapsFile, strFileContents)) {
			LogWarning("Could not save recent maps; the current list is still available in memory.");
		}
	} catch (Failure) {
		LogWarning(`Could not save recent maps: ${Failure.message}`);
	}
}

function RecordMapStart(strMap) {
	if (!strMap) {
		return;
	}

	const PreviousMap = g_CurrentMap;
	if (PreviousMap && (PreviousMap.EndedAt === null) && (PreviousMap.Map === strMap) && !g_RequestedChange) {
		return;
	}

	const unStartedAt = Date.now();

	if (PreviousMap) {
		if (PreviousMap.EndedAt === null) {
			RecordRecentMap(PreviousMap.Map);
		}

		const strReason = (g_RequestedChange?.Map.toLowerCase() === strMap.toLowerCase()) ? g_RequestedChange.Reason : "Engine or unknown";
		g_vecPreviousMaps.push({ Map: PreviousMap.Map, StartedAt: PreviousMap.StartedAt, EndedAt: PreviousMap.EndedAt ?? unStartedAt, Reason: strReason });

		if (g_vecPreviousMaps.length > MAXIMUM_HISTORY_ENTRIES) {
			g_vecPreviousMaps.shift();
		}
	}

	g_CurrentMap = { Map: strMap, StartedAt: unStartedAt, EndedAt: null };
	g_RequestedChange = null;
}

function RecordMapEnd() {
	if (g_CurrentMap && (g_CurrentMap.EndedAt === null)) {
		g_CurrentMap.EndedAt = Date.now();
		RecordRecentMap(g_CurrentMap.Map);
	}
}

function TrackRequestedMapChange(strMap, strReason, Change) {
	const Request = { Map: strMap, Reason: strReason };
	g_RequestedChange = Request;
	let bAccepted = false;

	try {
		bAccepted = Change(strMap);

		return bAccepted;
	} finally {
		if (!bAccepted && (g_RequestedChange === Request)) {
			g_RequestedChange = null;
		}
	}
}

// The first lookup with persistence enabled may read the recent-map file synchronously.
function GetPreviousMaps(unCount) {
	if (unCount <= 0) {
		return [];
	}

	ReadRecentMaps();

	const strCurrentMap = g_CurrentMap?.Map.toLowerCase();

	return [...g_mapRecentMaps.values()].filter((strMap) => strMap.toLowerCase() !== strCurrentMap).slice(-unCount);
}

function FormatDuration(nMilliseconds) {
	const unMillisecondsPerSecond = 1000;
	const unSecondsPerMinute = 60;
	const unSecondsPerHour = 3600;
	const unSeconds = Math.max(0, Math.floor(nMilliseconds / unMillisecondsPerSecond));
	const unHours = Math.floor(unSeconds / unSecondsPerHour);
	const unMinutes = Math.floor((unSeconds % unSecondsPerHour) / unSecondsPerMinute);
	const unRemainingSeconds = unSeconds % unSecondsPerMinute;

	return (unHours > 0) ? `${unHours}h ${unMinutes}m ${unRemainingSeconds}s` : `${unMinutes}m ${unRemainingSeconds}s`;
}

function FormatMapHistory() {
	if (!g_CurrentMap) {
		return "No map history is available.";
	}

	const vecLines = ["Map history:", `Current map: ${g_CurrentMap.Map}`, "Map | Started | Played | Change reason"];
	for (const Entry of g_vecPreviousMaps.slice().reverse()) {
		const strStarted = new Date(Entry.StartedAt).toISOString();
		const strPlayed = FormatDuration(Entry.EndedAt - Entry.StartedAt);
		vecLines.push(`${Entry.Map} | ${strStarted} | ${strPlayed} | ${Entry.Reason}`);
	}

	return vecLines.join("\n");
}

module.exports = { MAXIMUM_HISTORY_ENTRIES, RecordMapStart, RecordMapEnd, TrackRequestedMapChange, GetPreviousMaps, FormatMapHistory };
