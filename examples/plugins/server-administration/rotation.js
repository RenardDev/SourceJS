"use strict";

const { LogWarning } = require("core/logger");
const { CreateConVar, FindConVar } = require("cvars");
const { GetGameDirectory, GetInstalledMaps, GetMapName, GetServerTime, IsMapValid } = require("engines/server");
const { ReadTextFile } = require("filesystem");
const { GetAllPlayers } = require("filters/players");
const { TickDelay } = require("listeners/tick");
const { PagedESCMenu, PagedESCOption } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetUserMessageIndex } = require("messages");
const { DefineCommand, HasPermission, Reply } = require("./administration");
const { Broadcast, GetMessageAuthor, ReportAdminActivity } = require("./communication");
const { FormatMapHistory, GetPreviousMaps, MAXIMUM_HISTORY_ENTRIES, RecordMapStart } = require("./map-history");
const { PlayMenuSound } = require("./menu-sounds");
const { ChangeMap, HasPendingMapChange, RequireMapName } = require("./server");
const { CommandError, CommandFailure, CommandUsage, GetFailureMessage, JoinPhrases, LabelValue, Phrase, RenderPhrase, Translate } = require("./translations");
const { IsMapRotationVoteActive, IsVoteActive, StartVote } = require("./votes");

const g_unMinimumVoteMaps = 2;
const g_unMaximumVoteMaps = 8;
const g_unSecondsPerMinute = 60;
const g_flAutomaticVoteCheckSeconds = 5;
const g_flMapVoteRetrySeconds = 5;
const g_flRandomCycleDelaySeconds = 5;
const g_MapChangeTime = Object.freeze({ Immediately: 0, RoundEnd: 1, MapEnd: 2 });
const g_ExtendMapChoice = { Label: Phrase("ExtendMap", "Extend Map"), Map: null };
const g_KeepMapChoice = { Label: Phrase("KeepMapChoice", "Don't Change"), Map: null };
const g_mapNominations = new Map();
const g_mapNominationMenus = new Map();
const g_mapRockers = new Map();
const g_mapTeamWins = new Map();
const g_mapFragScorers = new Map();
const g_setUsedAutomaticVoteTriggers = new Set();
const g_setFailedNextMaps = new Set();
let g_vecCycle = [];
let g_Options = null;
let g_AutomaticVote = null;
let g_RandomNextMapDelay = null;
let g_QueuedMapVote = null;
let g_flMapStarted = null;
let g_bMapLoadedLate = false;
let g_flLastRockTheVote = -Infinity;
let g_unMapExtensions = 0;
let g_unCompletedRounds = 0;
let g_unTimeLeftCompletedRounds = 0;
let g_flTimeLeftAnnouncementInterval = 0;
let g_flNextTimeLeftAnnouncement = null;
let g_strChosenMap = null;
// Map-local rotation resets must not erase the position across a detour.
let g_strLastMapInCycle = null;
let g_strManualNextMap = null;
let g_unManualNextMapRevision = 0;
let g_strRoundEndMap = null;

function ReadCycleFile(strConfigurationName) {
	if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.txt$/i.test(strConfigurationName)) {
		throw CommandFailure("InvalidInput", "The map cycle must be a relative .txt path under the game directory or cfg/.");
	}

	const strGameDirectory = GetGameDirectory();
	const strCycle = ReadTextFile(`${strGameDirectory}/${strConfigurationName}`) ?? ReadTextFile(`${strGameDirectory}/cfg/${strConfigurationName}`);
	if (strCycle === null) {
		throw new Error(`Could not read map cycle "${strConfigurationName}" from the game directory or cfg/.`);
	}

	const vecMaps = strCycle.split(/\r?\n/).map((strLine) => strLine.replace(/\/\/.*$/, "").trim()).filter((strName) => /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(strName) && IsMapValid(strName));
	if (vecMaps.length === 0) {
		throw new Error(`Map cycle "${strConfigurationName}" contains no installed maps.`);
	}

	return [...new Set(vecMaps)];
}

function ReadInstalledMapCycle() {
	const vecMaps = GetInstalledMaps().filter((strMap) => /^[a-z0-9_-]+$/i.test(strMap));
	if (vecMaps.length === 0) {
		throw CommandFailure("NoMaps", "The engine found no installed maps in maps/.");
	}

	return vecMaps;
}

function GetRotationMaps() {
	return g_vecCycle.filter(IsMapValid);
}

function ReadCycle() {
	const strOverride = g_Options.MapCycleFile.Value;
	if (strOverride === "*") {
		return ReadInstalledMapCycle();
	}

	if (strOverride) {
		return ReadCycleFile(strOverride);
	}

	const strEngineCycle = FindConVar("mapcyclefile").Value || "mapcycle.txt";
	try {
		return ReadCycleFile(strEngineCycle);
	} catch (Failure) {
		if (GetRotationMaps().length > 0) {
			throw Failure;
		}

		return ReadInstalledMapCycle();
	}
}

function PickSequentialMap() {
	const vecMaps = g_vecCycle.filter((strMap) => !g_setFailedNextMaps.has(strMap.toLowerCase()) && IsMapValid(strMap));
	if (vecMaps.length === 0) {
		return null;
	}

	const strCurrent = GetMapName()?.toLowerCase();
	const nCurrentIndex = vecMaps.findIndex((strMap) => strMap.toLowerCase() === strCurrent);
	const nCycleIndex = (nCurrentIndex >= 0) ? nCurrentIndex : vecMaps.findIndex((strMap) => strMap.toLowerCase() === g_strLastMapInCycle);

	return vecMaps[(nCycleIndex + 1) % vecMaps.length];
}

function PickRandomMap() {
	const strCurrent = GetMapName()?.toLowerCase();
	const vecCandidates = g_vecCycle.filter((strMap) => (strMap.toLowerCase() !== strCurrent) && IsMapValid(strMap));
	if (vecCandidates.length === 0) {
		return null;
	}

	const unExclude = Math.trunc(Number(g_Options.RandomCycleExclude.Value));
	const vecRecent = GetPreviousMaps(unExclude).map((strMap) => strMap.toLowerCase());
	for (let unIndex = 0; unIndex <= vecRecent.length; ++unIndex) {
		const setExcluded = new Set(vecRecent.slice(unIndex));
		const vecAvailable = vecCandidates.filter((strMap) => !setExcluded.has(strMap.toLowerCase()));
		if (vecAvailable.length > 0) {
			return vecAvailable[Math.floor(Math.random() * vecAvailable.length)];
		}
	}

	return null;
}

function PublishNextMap(strMap) {
	const NextLevel = FindConVar("nextlevel");
	if (NextLevel.Exists !== true) {
		throw CommandFailure("CvarNotFound", "This game has no nextlevel ConVar.");
	}

	NextLevel.Value = RequireMapName(strMap);
	if (NextLevel.Value?.toLowerCase() !== strMap.toLowerCase()) {
		throw CommandFailure("CommandFailed", "The engine did not accept the next map.");
	}

	return Phrase("NextMap", "Next map: {Map}.", { Map: strMap });
}

function CancelRandomNextMap() {
	const Delay = g_RandomNextMapDelay;
	g_RandomNextMapDelay = null;

	if (Delay) {
		Delay.DisposeTickDelay();
	}
}

function CancelQueuedMapVote() {
	const Request = g_QueuedMapVote;
	g_QueuedMapVote = null;
	Request?.Delay?.DisposeTickDelay();
}

function CancelAutomaticVoteCheck() {
	if (g_AutomaticVote) {
		g_AutomaticVote.DisposeTickDelay();
		g_AutomaticVote = null;
	}
}

function GetChosenMap() {
	const strCurrentNextLevel = FindConVar("nextlevel").Value;
	for (const strMap of [g_strManualNextMap, g_strChosenMap]) {
		if (strMap && (strCurrentNextLevel?.toLowerCase() === strMap.toLowerCase()) && IsMapValid(strMap)) {
			return strMap;
		}
	}

	return null;
}

function SetManualNextMap(unClientIndex, vecArguments) {
	if (vecArguments.length !== 1) {
		throw CommandUsage("sjs_setnextmap <map>.");
	}

	const [strMap] = vecArguments;
	const Result = PublishNextMap(strMap);
	g_strManualNextMap = strMap;
	g_strChosenMap = null;
	++g_unManualNextMapRevision;
	g_strRoundEndMap = null;

	CancelRandomNextMap();
	CancelAutomaticVoteCheck();
	CancelQueuedMapVote();

	ReportAdminActivity(unClientIndex, GetMessageAuthor(unClientIndex), Phrase("NextMap", "Set the next map to {Map}.", { Map: strMap }));

	return Result;
}

function PublishSequentialNextMap(strCurrent) {
	const NextLevel = FindConVar("nextlevel");
	if (NextLevel.Exists !== true) {
		return;
	}

	const strOverride = NextLevel.Value;
	if (strOverride && (strOverride.toLowerCase() !== strCurrent?.toLowerCase()) && IsMapValid(strOverride)) {
		return;
	}

	if ((Number(g_Options.NextMap.Value) !== 1) || (Number(g_Options.RandomCycle.Value) === 1)) {
		return;
	}

	const strNext = PickSequentialMap();
	if (!strNext) {
		return;
	}

	try {
		PublishNextMap(strNext);
	} catch (Failure) {
		LogWarning(`Could not choose the sequential next map: ${Failure?.message ?? "unknown error"}`);
		return;
	}

	return strNext;
}

function ScheduleRandomNextMap(strCurrent, strSequentialMap) {
	// Server configuration can change the mode or map list after ServerActivate.
	const Delay = new TickDelay(g_flRandomCycleDelaySeconds, () => {
		if (g_RandomNextMapDelay !== Delay) {
			return;
		}

		g_RandomNextMapDelay = null;

		if ((Number(g_Options.RandomCycle.Value) !== 1) || HasPendingMapChange() || IsMapRotationVoteActive() || GetChosenMap()) {
			return;
		}

		const NextLevel = FindConVar("nextlevel");
		if (NextLevel.Exists !== true) {
			return;
		}

		const strOverride = NextLevel.Value;
		const strNormalizedOverride = strOverride?.toLowerCase();
		if (strOverride && (strNormalizedOverride !== strCurrent?.toLowerCase()) && (strNormalizedOverride !== strSequentialMap?.toLowerCase()) && IsMapValid(strOverride)) {
			return;
		}

		try {
			g_vecCycle = ReadCycle();
			const strNext = PickRandomMap();
			if (strNext) {
				PublishNextMap(strNext);
			}
		} catch (Failure) {
			LogWarning(`Could not choose a random next map: ${Failure?.message ?? "unknown error"}`);
		}
	}, [], true);

	g_RandomNextMapDelay = Delay;
}

function ApplyRotationVote(unClientIndex, strMap, nChangeTime) {
	const Result = (nChangeTime === g_MapChangeTime.Immediately) ? ChangeMap(unClientIndex, [strMap], "Map vote") : PublishNextMap(strMap);
	g_strChosenMap = strMap;
	g_strRoundEndMap = (nChangeTime === g_MapChangeTime.RoundEnd) ? strMap : null;

	return Result;
}

function ApplyRoundEndMap() {
	const strMap = g_strRoundEndMap;
	g_strRoundEndMap = null;

	if (strMap && !HasPendingMapChange() && (GetChosenMap() === strMap)) {
		Broadcast(ChangeMap(0, [strMap], "Map vote"));
	}
}

function GetTimeLimitUnitsPerMinute() {
	return (Number(g_Options.TimeLimitInSeconds.Value) === 1) ? g_unSecondsPerMinute : 1;
}

function GetMapExtensionLimits() {
	const flRoundStep = Number(g_Options.ExtendRoundStep.Value);
	const vecSteps = [
		["mp_timelimit", Number(g_Options.ExtendTimeStep.Value) * GetTimeLimitUnitsPerMinute()],
		["mp_winlimit", flRoundStep],
		["mp_maxrounds", flRoundStep],
		["mp_fraglimit", Number(g_Options.ExtendFragStep.Value)],
	];

	return vecSteps.map(([strName, flStep]) => {
		const Limit = FindConVar(strName);
		const flValue = Number(Limit.Value);

		return { Limit, Value: flValue, Step: flStep };
	}).filter((Entry) => (Entry.Limit.Exists === true) && Number.isFinite(Entry.Value) && (Entry.Value > 0) && Number.isFinite(Entry.Value + Entry.Step) && (Entry.Step > 0));
}

function GetMapContinuationChoice(nChangeTime) {
	if ((nChangeTime !== g_MapChangeTime.MapEnd) && (Number(g_Options.VoteDontChange.Value) === 1)) {
		return g_KeepMapChoice;
	}

	if ((g_unMapExtensions < Number(g_Options.VoteExtend.Value)) && (GetMapExtensionLimits().length > 0)) {
		return g_ExtendMapChoice;
	}

	return null;
}

function GetRotationVoteMapLimit(ContinuationChoice) {
	const unMaximumMapChoices = ContinuationChoice ? (g_unMaximumVoteMaps - 1) : g_unMaximumVoteMaps;

	return Math.min(unMaximumMapChoices, Math.trunc(Number(g_Options.VoteInclude.Value)));
}

function ExtendCurrentMap() {
	if (g_unMapExtensions >= Number(g_Options.VoteExtend.Value)) {
		return Phrase("ExtendLimit", "The current map has reached its extension limit.");
	}

	let bExtended = false;
	for (const { Limit, Value: flValue, Step: flStep } of GetMapExtensionLimits()) {
		Limit.Value = String(flValue + flStep);
		if (Number(Limit.Value) > flValue) {
			bExtended = true;
		}
	}

	if (bExtended) {
		++g_unMapExtensions;
		ScheduleAutomaticVote();
	}

	return bExtended ? Phrase("MapExtended", "The current map was extended.") : Phrase("NoMapTime", "This game has no active map limit that can be extended.");
}

function StartMapBallot(unClientIndex, vecChoices, nChangeTime, unExcludedIndex, bRunoff = false, bAutomatic = false) {
	const unDurationSeconds = Math.trunc(Number(g_Options.VoteDuration.Value));
	const unManualNextMapRevision = g_unManualNextMapRevision;
	StartVote(unClientIndex, bRunoff ? Phrase("Runoff", "Runoff: choose the next map") : Phrase("ChooseMap", "Choose the next map"), vecChoices.map((Choice) => Choice.Label), {
		ResolveResult(unIndex, vecCounts) {
			if (unManualNextMapRevision !== g_unManualNextMapRevision) {
				return Phrase("MapVoteIgnored", "Map vote result ignored: an administrator selected the next map.");
			}

			const vecResults = vecChoices.map((Choice, unChoiceIndex) => ({ Choice, Index: unChoiceIndex, Votes: vecCounts[unChoiceIndex] })).filter((Entry) => Entry.Votes > 0).sort((First, Second) => (Second.Votes - First.Votes) || (First.Index - Second.Index));
			if (vecResults.length === 0) {
				const vecValidMaps = vecChoices.map((Choice) => Choice.Map).filter((strMap) => (strMap !== null) && IsMapValid(strMap));
				if ((Number(g_Options.VoteNoBallots.Value) === 1) && (vecValidMaps.length > 0) && !HasPendingMapChange()) {
					const strRandomMap = vecValidMaps[Math.floor(Math.random() * vecValidMaps.length)];
					return JoinPhrases([Phrase("NoVotes", "No votes were cast."), ApplyRotationVote(unIndex, strRandomMap, g_MapChangeTime.MapEnd)]);
				}

				return Phrase("NoVotes", "No votes were cast.");
			}

			const [Winner, RunnerUp] = vecResults;
			const unTotalVotes = vecCounts.reduce((unTotal, unCount) => unTotal + unCount, 0);
			const flRunoffPercent = Number(g_Options.VoteRunoffPercent.Value);

			if (HasPendingMapChange()) {
				return Phrase("MapVoteIgnored", "Map vote result ignored: a map change is already scheduled.");
			}

			if (!bRunoff && RunnerUp && (Number(g_Options.VoteRunoff.Value) === 1) && ((100 * Winner.Votes) < (unTotalVotes * flRunoffPercent))) {
				StartMapBallot(unIndex, [Winner.Choice, RunnerUp.Choice], nChangeTime, unExcludedIndex, true, bAutomatic);
				return (unRecipientIndex) => Translate(unRecipientIndex, "RunoffChoices", "Map vote runoff: {First} or {Second}.", { First: RenderPhrase(unRecipientIndex, Winner.Choice.Label), Second: RenderPhrase(unRecipientIndex, RunnerUp.Choice.Label) });
			}

			if (Winner.Choice === g_KeepMapChoice) {
				ScheduleAutomaticVote();
				return Phrase("KeepMap", "The current map stays.");
			}

			if (Winner.Choice === g_ExtendMapChoice) {
				return ExtendCurrentMap();
			}

			return ApplyRotationVote(unIndex, Winner.Choice.Map, nChangeTime);
		},
		Permission: "map",
		UseCommandDelay: false,
		MapRotation: true,
		OnEnd: bAutomatic ? ScheduleAutomaticVote : null,
		ExcludedIndex: unExcludedIndex,
		DurationSeconds: unDurationSeconds,
	});
}

function FillRandomMapChoices(vecMaps, vecCandidates, unLimit) {
	while ((vecMaps.length < unLimit) && (vecCandidates.length > 0)) {
		const unChoiceIndex = Math.floor(Math.random() * vecCandidates.length);
		const [strMap] = vecCandidates.splice(unChoiceIndex, 1);
		vecMaps.push(strMap);
	}
}

function SelectRotationVoteMaps(unLimit) {
	const strCurrent = GetMapName()?.toLowerCase();
	const unExclude = Math.trunc(Number(g_Options.VoteExclude.Value));
	const setRecent = new Set(GetPreviousMaps(unExclude).map((strMap) => strMap.toLowerCase()));
	const setSeen = new Set([strCurrent]);
	const vecMaps = [];

	for (const strMap of g_mapNominations.keys()) {
		const strKey = strMap.toLowerCase();
		if (setSeen.has(strKey)) {
			continue;
		}

		setSeen.add(strKey);
		vecMaps.push(strMap);

		if (vecMaps.length >= unLimit) {
			return vecMaps;
		}
	}

	const vecAvailable = [];
	const vecRecent = [];

	for (const strMap of g_vecCycle) {
		const strKey = strMap.toLowerCase();
		if (setSeen.has(strKey) || !IsMapValid(strMap)) {
			continue;
		}

		setSeen.add(strKey);
		const vecCandidates = setRecent.has(strKey) ? vecRecent : vecAvailable;
		vecCandidates.push(strMap);
	}

	FillRandomMapChoices(vecMaps, vecAvailable, unLimit);
	FillRandomMapChoices(vecMaps, vecRecent, g_unMinimumVoteMaps);

	return vecMaps;
}

function PruneNominations(unExcludedIndex = 0) {
	const mapUsers = new Map(GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient && (Player.Index !== unExcludedIndex)).map((Player) => [Player.Index, Player.UserID]));
	for (const [strMap, Nomination] of g_mapNominations) {
		if (!g_vecCycle.includes(strMap) || !IsMapValid(strMap) || ((Nomination.Index !== 0) && (mapUsers.get(Nomination.Index) !== Nomination.UserID))) {
			g_mapNominations.delete(strMap);
		}
	}
}

function CloseNominationMenu(unClientIndex) {
	const Menu = g_mapNominationMenus.get(unClientIndex);
	g_mapNominationMenus.delete(unClientIndex);
	Menu?.CloseMenu();
}

function CloseNominationMenus() {
	for (const unIndex of [...g_mapNominationMenus.keys()]) {
		CloseNominationMenu(unIndex);
	}
}

function StartRotationVote(unClientIndex, nChangeTime, unExcludedIndex = 0, bAutomatic = false) {
	PruneNominations(unExcludedIndex);
	const ContinuationChoice = GetMapContinuationChoice(nChangeTime);
	const vecMaps = SelectRotationVoteMaps(GetRotationVoteMapLimit(ContinuationChoice));
	if (vecMaps.length < g_unMinimumVoteMaps) {
		throw CommandFailure("NoMaps", "A map vote requires at least two eligible maps.");
	}

	const vecChoices = vecMaps.map((strMap) => ({ Label: strMap, Map: strMap }));
	if (ContinuationChoice) {
		vecChoices.push(ContinuationChoice);
	}

	StartMapBallot(unClientIndex, vecChoices, nChangeTime, unExcludedIndex, false, bAutomatic);

	g_mapNominations.clear();
	CloseNominationMenus();
}

function ScheduleQueuedMapVote(Request) {
	const Delay = new TickDelay(g_flMapVoteRetrySeconds, () => {
		if ((g_QueuedMapVote !== Request) || (Request.Delay !== Delay)) {
			return;
		}

		g_QueuedMapVote = null;

		const { Index: unClientIndex, UserID: unUserID, Chat: bChat } = Request;
		if ((unClientIndex !== 0) && !GetAllPlayers().some((Player) => Player.Connected && (Player.Index === unClientIndex) && (Player.UserID === unUserID))) {
			return;
		}

		try {
			if (!HasPermission(unClientIndex, "vote") || !HasPermission(unClientIndex, "map")) {
				throw CommandFailure("VotePermissionLost", "Queued map vote cancelled: the initiator no longer has permission.");
			}

			if (HasPendingMapChange() || GetChosenMap()) {
				throw CommandFailure("MapChangePending", "Queued map vote cancelled: a map has already been chosen or a change is scheduled.");
			}

			if (IsVoteActive()) {
				ScheduleQueuedMapVote(Request);
				return;
			}

			StartRotationVote(unClientIndex, g_MapChangeTime.MapEnd);
		} catch (Failure) {
			try {
				Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The queued map vote could not start.")), bChat);
			} catch {
				// The initiator may no longer be reachable.
			}
		}
	}, [], true);

	Request.Delay = Delay;
	g_QueuedMapVote = Request;
}

function RequestMapVote(unClientIndex, vecArguments, bChat) {
	if (!HasPermission(unClientIndex, "map")) {
		throw CommandFailure("RequiresPermission", "This vote also requires {Permission}.", { Permission: "sourcejs.map" });
	}

	if (HasPendingMapChange()) {
		throw CommandFailure("MapChangePending", "A map change is already scheduled.");
	}

	if (g_QueuedMapVote) {
		throw CommandFailure("MapVoteQueued", "A map vote is already queued.");
	}

	if (IsMapRotationVoteActive()) {
		throw CommandFailure("VoteInProgress", "A rotation vote is already in progress.");
	}

	if (!IsVoteActive()) {
		StartRotationVote(unClientIndex, g_MapChangeTime.MapEnd);
		return null;
	}

	const Player = GetAllPlayers().find((Target) => Target.Connected && (Target.Index === unClientIndex));
	if ((unClientIndex !== 0) && !Player) {
		throw CommandFailure("PlayerDisconnected", "The vote initiator is no longer connected.");
	}

	ScheduleQueuedMapVote({ Index: unClientIndex, UserID: Player?.UserID ?? 0, Chat: bChat, Delay: null });

	return Phrase("MapVoteQueued", "Map vote queued until the current vote ends.");
}

function ResetMapVoteScores() {
	g_mapTeamWins.clear();
	g_mapFragScorers.clear();
	g_unCompletedRounds = 0;
}

function ResetTimeLeftRounds() {
	g_unTimeLeftCompletedRounds = 0;
}

function ResetMapRotation() {
	g_mapNominations.clear();
	g_mapRockers.clear();
	CloseNominationMenus();

	g_flMapStarted = null;
	g_bMapLoadedLate = false;
	g_flTimeLeftAnnouncementInterval = 0;
	g_flNextTimeLeftAnnouncement = null;
	g_flLastRockTheVote = -Infinity;
	g_unMapExtensions = 0;
	g_strChosenMap = null;
	g_strManualNextMap = null;
	g_strRoundEndMap = null;
	g_setUsedAutomaticVoteTriggers.clear();
	g_setFailedNextMaps.clear();

	ResetMapVoteScores();
	ResetTimeLeftRounds();

	CancelRandomNextMap();
	CancelAutomaticVoteCheck();
	CancelQueuedMapVote();
}

function GetMapTimeRemaining() {
	const TimeLimit = FindConVar("mp_timelimit");
	const flMinutes = Number(TimeLimit.Value) / GetTimeLimitUnitsPerMinute();
	const vecLimits = [];

	if (g_bMapLoadedLate && (TimeLimit.Exists === true) && Number.isFinite(flMinutes) && (flMinutes > 0)) {
		vecLimits.push(Phrase("TimeUnavailableUntilNextMap", "Map time remaining is unavailable until the next map."));
	} else if ((TimeLimit.Exists === true) && Number.isFinite(flMinutes) && (flMinutes > 0) && (g_flMapStarted !== null)) {
		const unSeconds = Math.max(0, Math.ceil(flMinutes * g_unSecondsPerMinute - (GetServerTime() - g_flMapStarted)));
		if (unSeconds === 0) {
			return Phrase("MapTimeElapsed", "The map time limit has elapsed.");
		}

		vecLimits.push(Phrase("MapTimeRemaining", "Approximate map time remaining: {Minutes}m {Seconds}s.", { Minutes: Math.floor(unSeconds / g_unSecondsPerMinute), Seconds: unSeconds % g_unSecondsPerMinute }));
	}

	for (const [strName, strKey, strLabel] of [["mp_maxrounds", g_bMapLoadedLate ? "RoundLimit" : "RoundsLeft", g_bMapLoadedLate ? "Round limit" : "Rounds remaining"], ["mp_winlimit", "WinLimit", "Win limit"], ["mp_fraglimit", "FragLimit", "Frag limit"]]) {
		const Limit = FindConVar(strName);
		const nValue = Math.trunc(Number(Limit.Value));
		if ((Limit.Exists === true) && (nValue > 0) && Number.isFinite(nValue)) {
			const unValue = ((strName === "mp_maxrounds") && !g_bMapLoadedLate) ? Math.max(0, nValue - g_unTimeLeftCompletedRounds) : nValue;
			vecLimits.push(LabelValue(strKey, unValue, `${strLabel}: ${unValue}.`));
		}
	}

	return (vecLimits.length > 0) ? JoinPhrases(vecLimits) : Phrase("NoMapTime", "No map time limit is available.");
}

function ScheduleMapTimeAnnouncement(flNow) {
	const flInterval = Number(g_Options.TimeLeftInterval.Value);
	const flActiveInterval = (Number.isFinite(flInterval) && (flInterval >= 1)) ? flInterval : 0;
	if (flActiveInterval === g_flTimeLeftAnnouncementInterval) {
		return;
	}

	g_flTimeLeftAnnouncementInterval = flActiveInterval;
	g_flNextTimeLeftAnnouncement = (flActiveInterval > 0) ? (flNow + flActiveInterval) : null;
}

function AnnounceMapTime() {
	if (g_flMapStarted === null) {
		return;
	}

	const flNow = GetServerTime();
	ScheduleMapTimeAnnouncement(flNow);

	if ((g_flNextTimeLeftAnnouncement === null) || (flNow < g_flNextTimeLeftAnnouncement)) {
		return;
	}

	g_flNextTimeLeftAnnouncement = flNow + g_flTimeLeftAnnouncementInterval;

	const Announcement = GetMapTimeRemaining();
	Reply(0, Announcement);

	if (GetAllPlayers().some((Player) => Player.Connected && !Player.FakeClient)) {
		Broadcast(Announcement);
	}
}

function CanCheckAutomaticVote() {
	return (g_flMapStarted !== null) && (Number(g_Options.Chooser.Value) === 1) && (FindConVar("nextlevel").Exists === true) && (GetChosenMap() === null);
}

function GetPositiveMapLimit(strConVarName) {
	const Limit = FindConVar(strConVarName);
	const flLimit = Number(Limit.Value);

	return ((Limit.Exists === true) && Number.isFinite(flLimit) && (flLimit > 0)) ? flLimit : null;
}

function GetAutomaticVoteTriggers(vecPlayers) {
	const setTriggers = new Set();
	const unRoundLead = Math.trunc(Number(g_Options.VoteStartRound.Value));
	const flRoundLimit = GetPositiveMapLimit("mp_maxrounds");
	if ((flRoundLimit !== null) && (g_unCompletedRounds > 0) && (g_unCompletedRounds >= (flRoundLimit - unRoundLead))) {
		setTriggers.add(`round:${g_unCompletedRounds}:${flRoundLimit}:${unRoundLead}`);
	}

	const flWinLimit = GetPositiveMapLimit("mp_winlimit");
	if (flWinLimit !== null) {
		for (const [nTeam, unWins] of g_mapTeamWins) {
			if (unWins >= (flWinLimit - unRoundLead)) {
				setTriggers.add(`win:${nTeam}:${unWins}:${flWinLimit}:${unRoundLead}`);
			}
		}
	}

	const unFragLead = Math.trunc(Number(g_Options.VoteStartFrags.Value));
	const flFragLimit = GetPositiveMapLimit("mp_fraglimit");
	if ((flFragLimit !== null) && (g_mapFragScorers.size > 0)) {
		for (const Player of vecPlayers) {
			if (Player.Connected && (g_mapFragScorers.get(Player.Index) === Player.UserID) && (Player.Frags >= (flFragLimit - unFragLead))) {
				setTriggers.add(`frag:${Player.UserID}:${Player.Frags}:${flFragLimit}:${unFragLead}`);
			}
		}
	}

	if (!g_bMapLoadedLate) {
		const flMinutes = Number(FindConVar("mp_timelimit").Value) / GetTimeLimitUnitsPerMinute();
		const flLeadMinutes = Number(g_Options.VoteStart.Value);
		const flElapsedSeconds = GetServerTime() - g_flMapStarted;
		if (Number.isFinite(flMinutes) && (flMinutes > 0) && (flElapsedSeconds >= Math.max(0, (flMinutes - flLeadMinutes) * g_unSecondsPerMinute))) {
			setTriggers.add(`time:${flMinutes}:${flLeadMinutes}`);
		}
	}

	return setTriggers;
}

function ScheduleAutomaticVote() {
	if (!g_AutomaticVote && CanCheckAutomaticVote()) {
		const Delay = new TickDelay(g_flAutomaticVoteCheckSeconds, () => {
			if (g_AutomaticVote !== Delay) {
				return;
			}

			g_AutomaticVote = null;
			CheckAutomaticVote();
		}, [], true);

		g_AutomaticVote = Delay;
	}
}

function CheckAutomaticVote() {
	if (!CanCheckAutomaticVote()) {
		return;
	}

	const vecPlayers = GetAllPlayers();
	const strCurrent = GetMapName();
	const setTriggers = GetAutomaticVoteTriggers(vecPlayers);

	for (const strTrigger of g_setUsedAutomaticVoteTriggers) {
		if (!setTriggers.has(strTrigger)) {
			g_setUsedAutomaticVoteTriggers.delete(strTrigger);
		}
	}

	if ((setTriggers.size === g_setUsedAutomaticVoteTriggers.size) || HasPendingMapChange() || IsVoteActive() || g_QueuedMapVote || (g_vecCycle.filter((strMap) => (strMap !== strCurrent) && IsMapValid(strMap)).length < g_unMinimumVoteMaps) || !vecPlayers.some((Player) => Player.Connected && !Player.FakeClient)) {
		ScheduleAutomaticVote();
		return;
	}

	try {
		CancelAutomaticVoteCheck();
		StartRotationVote(0, g_MapChangeTime.MapEnd, 0, true);

		for (const strTrigger of setTriggers) {
			g_setUsedAutomaticVoteTriggers.add(strTrigger);
		}
	} catch {
		// A renderer or player may become available before the next check.
		ScheduleAutomaticVote();
	}
}

function RecoverFailedNextMap(strMap) {
	if ((g_flMapStarted === null) || (Number(g_Options.NextMap.Value) !== 1) || HasPendingMapChange()) {
		return;
	}

	const strFailedMap = strMap.toLowerCase();
	const NextLevel = FindConVar("nextlevel");
	if (!strFailedMap || (NextLevel.Exists !== true) || (NextLevel.Value?.toLowerCase() !== strFailedMap)) {
		return;
	}

	g_setFailedNextMaps.add(strFailedMap);

	const strCurrentMap = GetMapName()?.toLowerCase();
	const nFailedMapIndex = g_vecCycle.findIndex((strMap) => strMap.toLowerCase() === strFailedMap);
	const vecCandidates = [...g_vecCycle.slice(nFailedMapIndex + 1), ...g_vecCycle.slice(0, nFailedMapIndex + 1)];
	const strFallback = vecCandidates.find((strMap) => {
		const strNormalizedMap = strMap.toLowerCase();

		return (strNormalizedMap !== strCurrentMap) && !g_setFailedNextMaps.has(strNormalizedMap) && IsMapValid(strMap);
	});

	try {
		if (strFallback) {
			PublishNextMap(strFallback);
		} else {
			NextLevel.Value = "";
			if (NextLevel.Value) {
				throw CommandFailure("CommandFailed", "The engine did not clear nextlevel.");
			}
		}
	} catch (Failure) {
		LogWarning(`Could not recover from failed map change to ${strFailedMap}: ${Failure?.message ?? "unknown error"}`);
		return;
	}

	g_strManualNextMap = null;
	g_strChosenMap = null;
	g_strRoundEndMap = null;

	CancelRandomNextMap();
	ScheduleAutomaticVote();
}

function HandleChangeLevelFailure(Event) {
	RecoverFailedNextMap(Event.GetEventString("levelname"));
}

function InitializeMapRotation(bLateLoad) {
	ResetMapRotation();
	g_flMapStarted = GetServerTime();
	g_bMapLoadedLate = bLateLoad;
	ScheduleMapTimeAnnouncement(g_flMapStarted);

	try {
		g_vecCycle = ReadCycle();
	} catch (Failure) {
		LogWarning(`Could not load the map cycle: ${Failure.message} Keeping the previous list.`);
	}

	const strCurrent = GetMapName();
	const strNormalizedCurrent = strCurrent?.toLowerCase();
	if (g_vecCycle.some((strMap) => strMap.toLowerCase() === strNormalizedCurrent)) {
		g_strLastMapInCycle = strNormalizedCurrent;
	}

	RecordMapStart(strCurrent);

	const strNext = FindConVar("nextlevel").Value;
	if (!bLateLoad || !strNext || !IsMapValid(strNext)) {
		const strSequentialMap = PublishSequentialNextMap(strCurrent);
		ScheduleRandomNextMap(strCurrent, strSequentialMap);
	}

	ScheduleAutomaticVote();
}

function RecordMapVoteRound(Event) {
	if ((g_flMapStarted === null) || !Event) {
		return;
	}

	const strName = Event.EventName;
	const bWinPanel = (strName === "teamplay_win_panel") || (strName === "arena_win_panel");

	if ((strName === "teamplay_win_panel") && (Event.GetEventInteger("round_complete") !== 1)) {
		return;
	}

	++g_unTimeLeftCompletedRounds;

	const nFirstPlayingTeamIndex = 2;
	const strWinnerKey = bWinPanel ? "winning_team" : ((strName === "round_win") ? "team" : "winner");
	const nWinner = Event.GetEventInteger(strWinnerKey);
	if (!bWinPanel && (nWinner < nFirstPlayingTeamIndex)) {
		return;
	}

	++g_unCompletedRounds;

	if (nWinner >= nFirstPlayingTeamIndex) {
		const nRedWinPanelTeamIndex = 2;
		const nBlueWinPanelTeamIndex = 3;
		const unPreviousWins = g_mapTeamWins.get(nWinner) ?? 0;
		const strScoreKey = (nWinner === nRedWinPanelTeamIndex) ? "red_score" : ((nWinner === nBlueWinPanelTeamIndex) ? "blue_score" : "");
		const nScore = (bWinPanel && strScoreKey) ? Event.GetEventInteger(strScoreKey, -1) : -1;
		g_mapTeamWins.set(nWinner, (nScore >= 0) ? nScore : (unPreviousWins + 1));
	}

	CheckAutomaticVote();
}

function RecordMapVoteDeath(Event) {
	if ((g_flMapStarted === null) || !CanCheckAutomaticVote()) {
		return;
	}

	const nAttackerUserID = Event.GetEventInteger("attacker");
	if (nAttackerUserID <= 0) {
		return;
	}

	const Attacker = GetAllPlayers().find((Player) => Player.Connected && (Player.UserID === nAttackerUserID));
	if (Attacker) {
		g_mapFragScorers.set(Attacker.Index, nAttackerUserID);
		CheckAutomaticVote();
	}
}

function RequireNominationPlayer(unClientIndex) {
	if ((Number(g_Options.Nominations.Value) !== 1) || (unClientIndex <= 0)) {
		throw CommandFailure("NominationsUnavailable", "Player nominations are not enabled.");
	}

	if (g_flMapStarted === null) {
		throw CommandFailure("NominationsUnavailable", "Nominations are not available until the map is active.");
	}

	if (IsVoteActive() || GetChosenMap() || HasPendingMapChange()) {
		throw CommandFailure("NominationsClosed", "Nominations are closed for this vote or map change.");
	}

	const Player = GetAllPlayers().find((Target) => (Target.Index === unClientIndex) && Target.Connected && !Target.FakeClient);
	if (!Player) {
		throw CommandFailure("InGameOnly", "Only connected players can nominate maps.");
	}

	return Player;
}

function GetMapNominationReason(strMap) {
	if (!g_vecCycle.includes(strMap) || !IsMapValid(strMap)) {
		return Phrase("OutsideRotation", "Not in the current map rotation");
	}

	const strMapKey = strMap.toLowerCase();
	if (strMapKey === GetMapName()?.toLowerCase()) {
		return Phrase("CurrentMapLabel", "Current map");
	}

	const unExclude = Math.trunc(Number(g_Options.NominationHistoryLength.Value));
	if ((Number(g_Options.NominationExcludeOld.Value) === 1) && GetPreviousMaps(unExclude).some((strPreviousMap) => strPreviousMap.toLowerCase() === strMapKey)) {
		return Phrase("RecentlyPlayed", "Recently played");
	}

	if (g_mapNominations.has(strMap)) {
		return Phrase("AlreadyNominatedLabel", "Already nominated");
	}

	return null;
}

function StoreNomination(Player, strMap) {
	PruneNominations();
	const Reason = GetMapNominationReason(strMap);
	if (Reason) {
		throw new CommandError((unIndex) => {
			const strReason = RenderPhrase(unIndex, Reason);

			return Translate(unIndex, "NominationRejected", "Cannot nominate {Map}: {Reason}.", { Map: strMap, Reason: (unIndex === null) ? strReason.toLowerCase() : strReason });
		});
	}

	const Previous = [...g_mapNominations].find(([, Nomination]) => Nomination.Index === Player.Index);
	if (Previous) {
		// Replacing a nomination keeps its place in the vote.
		const [strPrevious] = Previous;
		const vecEntries = [...g_mapNominations].map(([strName, Nomination]) => [(strName === strPrevious) ? strMap : strName, Nomination]);
		g_mapNominations.clear();
		for (const [strName, Nomination] of vecEntries) {
			g_mapNominations.set(strName, Nomination);
		}

		return Phrase("NominationReplaced", "Replaced {Previous} with {Map}.", { Previous: strPrevious, Map: strMap });
	}

	if (g_mapNominations.size >= GetRotationVoteMapLimit(GetMapContinuationChoice(g_MapChangeTime.MapEnd))) {
		throw CommandFailure("NominationsUnavailable", "The nomination list is full.");
	}

	g_mapNominations.set(strMap, { Index: Player.Index, UserID: Player.UserID });

	try {
		Broadcast(Phrase("PlayerNominated", "{Player} nominated {Map}.", { Player: Player.Name, Map: strMap }));
		return null;
	} catch {
		return Phrase("Nominated", "Nominated {Map}.", { Map: strMap });
	}
}

function OpenNominationMenu(Player, vecMaps) {
	const unMenuTimeoutSeconds = 30;
	CloseNominationMenu(Player.Index);

	const SelectCallback = (unClientIndex, strMap) => {
		if ((unClientIndex !== Player.Index) || (g_mapNominationMenus.get(unClientIndex) !== Menu)) {
			return;
		}

		try {
			const Current = RequireNominationPlayer(unClientIndex);
			if (Current.UserID !== Player.UserID) {
				return;
			}

			const Response = StoreNomination(Current, strMap);
			if (Response) {
				Reply(unClientIndex, Response, true);
			}
		} catch (Failure) {
			Reply(unClientIndex, GetFailureMessage(Failure, Phrase("CommandFailed", "The nomination failed.")), true);
		}
	};

	const CloseCallback = (unClientIndex) => {
		if (g_mapNominationMenus.get(unClientIndex) === Menu) {
			g_mapNominationMenus.delete(unClientIndex);
		}
	};

	const Options = {
		Title: Translate(Player.Index, "NominateMap", "Nominate a map"),
		Description: Translate(Player.Index, "ChooseMap", "Choose a map to suggest for the next vote."),
		Timeout: unMenuTimeoutSeconds,
		BackText: Translate(Player.Index, "Previous", "Previous page"),
		NextText: Translate(Player.Index, "Next", "Next page"),
		CloseText: Translate(Player.Index, "Close", "Close nominations"),
		Fill: false,
		SelectCallback,
		CloseCallback,
		InteractionCallback: PlayMenuSound,
	};

	const bRadioAvailable = GetUserMessageIndex("ShowMenu") >= 0;
	const Menu = bRadioAvailable ? new PagedRadioMenu(Options) : new PagedESCMenu(Options);
	const Option = bRadioAvailable ? PagedRadioOption : PagedESCOption;
	Menu.UseTextDialogFallback = false;

	for (const strMap of vecMaps) {
		const Reason = GetMapNominationReason(strMap);
		Menu.AppendMenuItem(new Option(Reason ? `${strMap} (${RenderPhrase(Player.Index, Reason)})` : strMap, strMap, { Selectable: Reason === null }));
	}

	g_mapNominationMenus.set(Player.Index, Menu);

	try {
		if (!GetPlayerMenuQueue(Player.Index).SendMenu(Menu)) {
			throw CommandFailure("MenuUnavailable", "The game could not display the nomination menu. Specify a map name instead.");
		}
	} catch (Failure) {
		CloseNominationMenu(Player.Index);
		throw Failure;
	}
}

function NominateMap(unClientIndex, vecArguments) {
	const Player = RequireNominationPlayer(unClientIndex);
	const strQuery = vecArguments.join(" ").trim().toLowerCase();

	if (g_vecCycle.length === 0) {
		throw CommandFailure("NoMaps", "The map rotation is empty.");
	}

	if (!strQuery) {
		PruneNominations();
		OpenNominationMenu(Player, g_vecCycle);
		return null;
	}

	const strExact = g_vecCycle.find((strMap) => strMap.toLowerCase() === strQuery);
	if (strExact) {
		return StoreNomination(Player, strExact);
	}

	const vecMatches = g_vecCycle.filter((strMap) => strMap.toLowerCase().includes(strQuery));
	if (vecMatches.length === 0) {
		throw CommandFailure("InvalidMap", "No map in the current rotation matches that name.");
	}

	if (vecMatches.length === 1) {
		return StoreNomination(Player, vecMatches[0]);
	}

	PruneNominations();

	const unMaximumMatches = Math.trunc(Number(g_Options.NominationMaximumMatches.Value));
	OpenNominationMenu(Player, (unMaximumMatches > 0) ? vecMatches.slice(0, unMaximumMatches) : vecMatches);

	return null;
}

function ForceMapNomination(unClientIndex, vecArguments) {
	const strMap = RequireMapName(vecArguments[0]);
	if (IsVoteActive() || GetChosenMap() || HasPendingMapChange()) {
		throw CommandFailure("NominationsClosed", "Nominations are closed for this vote or map change.");
	}

	if (!g_vecCycle.includes(strMap) || (strMap === GetMapName())) {
		throw CommandFailure("InvalidMap", "Choose a different map from the current rotation.");
	}

	PruneNominations();

	if (g_mapNominations.has(strMap)) {
		throw CommandFailure("AlreadyNominated", "That map is already nominated.");
	}

	g_mapNominations.set(strMap, { Index: 0, UserID: 0 });
	const unLimit = GetRotationVoteMapLimit(GetMapContinuationChoice(g_MapChangeTime.MapEnd));
	while (g_mapNominations.size > unLimit) {
		g_mapNominations.delete(g_mapNominations.keys().next().value);
	}

	return Phrase("Nominated", "Nominated {Map} for the next vote.", { Map: strMap });
}

function RefreshMapCycle() {
	if (IsMapRotationVoteActive()) {
		throw CommandFailure("VoteInProgress", "The map cycle cannot be refreshed during a rotation vote.");
	}

	g_vecCycle = ReadCycle();

	CancelRandomNextMap();
	PruneNominations();
	CloseNominationMenus();
	ScheduleAutomaticVote();

	return Phrase("MapCycleLoaded", "Loaded {Count} map(s) from the map cycle.", { Count: g_vecCycle.length });
}

function GetRockTheVoteRestriction() {
	if ((Number(g_Options.RockTheVote.Value) !== 1) || (g_flMapStarted === null)) {
		return Phrase("RTVDisabled", "Rock the Vote is not enabled.");
	}

	if (HasPendingMapChange()) {
		return Phrase("MapChangePending", "A map change is already scheduled.");
	}

	if (g_QueuedMapVote) {
		return Phrase("MapVoteQueued", "A map vote is already queued.");
	}

	if (GetChosenMap() && (Number(g_Options.RTVPostVoteAction.Value) === 1)) {
		return Phrase("RTVClosed", "Rock the Vote is closed because the next map has already been chosen.");
	}

	const flInitialEnd = g_flMapStarted + Number(g_Options.RTVInitialDelay.Value);
	const flCooldownEnd = g_flLastRockTheVote + Number(g_Options.RTVInterval.Value);
	const flRemaining = Math.max(flInitialEnd, flCooldownEnd) - GetServerTime();
	if (flRemaining > 0) {
		return Phrase("RTVOpens", "Rock the Vote opens in {Seconds} second(s).", { Seconds: Math.ceil(flRemaining) });
	}

	return IsVoteActive() ? Phrase("VoteInProgress", "A vote is already in progress.") : null;
}

function GetRockTheVotePopulation(unExcludedIndex = 0) {
	const vecPlayers = GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient && (Player.Index !== unExcludedIndex));
	const unMinimum = Math.trunc(Number(g_Options.RTVMinimumPlayers.Value));
	const unRequired = (vecPlayers.length < unMinimum) ? Infinity : Math.max(1, Math.ceil(vecPlayers.length * Number(g_Options.RTVNeeded.Value)));
	const unRockedCount = vecPlayers.filter((Player) => g_mapRockers.get(Player.Index) === Player.UserID).length;

	return { Players: vecPlayers, Count: unRockedCount, Required: unRequired };
}

function StartRockTheVote(unExcludedIndex = 0) {
	const strChosenMap = GetChosenMap();
	let Result = Phrase("MapVoteStarted", "Map vote started.");
	if (strChosenMap) {
		Result = ChangeMap(0, [strChosenMap], "Rock the Vote");
		g_strRoundEndMap = null;
	} else {
		StartRotationVote(0, Math.trunc(Number(g_Options.RTVChangeTime.Value)), unExcludedIndex);
	}

	g_mapRockers.clear();
	g_flLastRockTheVote = GetServerTime();

	return Result;
}

function ForgetMapVoter(unClientIndex) {
	if (g_QueuedMapVote?.Index === unClientIndex) {
		CancelQueuedMapVote();
	}

	g_mapFragScorers.delete(unClientIndex);

	for (const [strMap, Nomination] of g_mapNominations) {
		if (Nomination.Index === unClientIndex) {
			g_mapNominations.delete(strMap);
		}
	}

	CloseNominationMenu(unClientIndex);
	g_mapRockers.delete(unClientIndex);

	if (GetRockTheVoteRestriction() === null) {
		const Population = GetRockTheVotePopulation(unClientIndex);
		if (Population.Count >= Population.Required) {
			try {
				Broadcast(StartRockTheVote(unClientIndex));
			} catch {
				// Keep valid requests when a disconnect cannot start a map vote.
			}
		}
	}
}

function RockTheVote(unClientIndex) {
	const Restriction = GetRockTheVoteRestriction();
	if (Restriction) {
		throw new CommandError(Restriction);
	}

	const Population = GetRockTheVotePopulation();
	const CurrentPlayer = Population.Players.find((Player) => Player.Index === unClientIndex);
	if (!CurrentPlayer) {
		throw CommandFailure("InGameOnly", "Only connected players can rock the vote.");
	}

	if (!Number.isFinite(Population.Required)) {
		throw CommandFailure("NoEligiblePlayers", "Not enough players are connected to rock the vote.");
	}

	if (g_mapRockers.get(unClientIndex) === CurrentPlayer.UserID) {
		if (Population.Count >= Population.Required) {
			return StartRockTheVote();
		}

		return Phrase("RTVAlready", "You already rocked the vote: {Count}/{Total}.", { Count: Population.Count, Total: Population.Required });
	}

	g_mapRockers.set(unClientIndex, CurrentPlayer.UserID);
	const unCount = Population.Count + 1;
	const Progress = Phrase("RTVProgress", "{Player} rocked the vote: {Count}/{Total}.", { Player: CurrentPlayer.Name, Count: unCount, Total: Population.Required });

	try {
		Broadcast(Progress);
	} catch {
		// The request still counts if the game cannot display the progress message.
	}

	if (unCount >= Population.Required) {
		return StartRockTheVote();
	}

	return null;
}

function ListMaps(unClientIndex, vecArguments, bChat) {
	const vecMaps = GetRotationMaps();
	Reply(unClientIndex, Phrase("MapCycle", "Map cycle:"));

	if (vecMaps.length === 0) {
		Reply(unClientIndex, Phrase("NoMaps", "The map cycle is empty."));
	}

	for (const strMap of vecMaps) {
		Reply(unClientIndex, strMap);
	}

	return bChat ? Phrase("ConsoleOutput", "See your console for the map cycle.") : null;
}

function RegisterMapRotationCommands() {
	const unMaximumExclusionHistoryCount = 19;
	const unMinimumVoteDurationSeconds = 5;
	const unMaximumVoteDurationSeconds = 255;
	const unMaximumTimeLeftIntervalSeconds = 1_800;
	const unMaximumRTVPlayerThreshold = 255;
	g_Options = {
		MapCycleFile: CreateConVar("sjs_mapcyclefile", "", "Map cycle file relative to the game directory or cfg; * uses installed maps, empty uses the engine setting."),
		NextMap: CreateConVar("sjs_nextmap_enabled", "0", "Automatically set the next sequential map.", 0, 0, 1),
		RandomCycle: CreateConVar("sjs_randomcycle", "0", "Enable random selection from the map cycle.", 0, 0, 1),
		RandomCycleExclude: CreateConVar("sjs_randomcycle_exclude", "5", "Number of previous maps excluded from random rotation where possible.", 0, 0, MAXIMUM_HISTORY_ENTRIES),
		Chooser: CreateConVar("sjs_mapchooser", "0", "Enable automatic map votes near the time limit.", 0, 0, 1),
		VoteStart: CreateConVar("sjs_mapvote_start", "3", "Minutes remaining when the automatic map vote opens.", 0, 1),
		VoteStartRound: CreateConVar("sjs_mapvote_startround", "2", "Rounds or wins remaining when the automatic map vote opens.", 0, 0),
		VoteStartFrags: CreateConVar("sjs_mapvote_startfrags", "5", "Frags remaining when the automatic map vote opens.", 0, 1),
		VoteInclude: CreateConVar("sjs_mapvote_include", "5", "Maximum number of maps in a rotation ballot.", 0, g_unMinimumVoteMaps, g_unMaximumVoteMaps),
		VoteExclude: CreateConVar("sjs_mapvote_exclude", "5", "Number of recent maps to avoid when filling a rotation ballot.", 0, 0, unMaximumExclusionHistoryCount),
		PersistentMaps: CreateConVar("sjs_mapvote_persistentmaps", "0", "Keep recent map exclusions across plugin reloads and server restarts.", 0, 0, 1),
		VoteDuration: CreateConVar("sjs_mapvote_voteduration", "20", "Duration of each rotation ballot in seconds.", 0, unMinimumVoteDurationSeconds, unMaximumVoteDurationSeconds),
		VoteNoBallots: CreateConVar("sjs_mapvote_novote", "1", "Pick a next map from the ballot when nobody votes.", 0, 0, 1),
		VoteRunoff: CreateConVar("sjs_mapvote_runoff", "0", "Hold a second ballot when the winner is below the runoff threshold.", 0, 0, 1),
		VoteRunoffPercent: CreateConVar("sjs_mapvote_runoffpercent", "50", "Vote percentage required to avoid a runoff.", 0, 0, 100),
		VoteExtend: CreateConVar("sjs_mapvote_extend", "0", "Number of extensions allowed on each map.", 0, 0),
		VoteDontChange: CreateConVar("sjs_mapvote_dontchange", "1", "Allow keeping the current map in a vote for an early change.", 0, 0, 1),
		ExtendTimeStep: CreateConVar("sjs_extendmap_timestep", "15", "Minutes added to a positive map time limit.", 0, 5),
		ExtendRoundStep: CreateConVar("sjs_extendmap_roundstep", "5", "Rounds or wins added to positive map limits.", 0, 1),
		ExtendFragStep: CreateConVar("sjs_extendmap_fragstep", "10", "Frags added to a positive map frag limit.", 0, 5),
		TimeLimitInSeconds: CreateConVar("sjs_mapvote_timelimit_seconds", "0", "Interpret mp_timelimit in seconds instead of minutes.", 0, 0, 1),
		TimeLeftInterval: CreateConVar("sjs_timeleft_interval", "0", "Seconds between automatic time-left announcements; values below one disable them.", 0, 0, unMaximumTimeLeftIntervalSeconds),
		Nominations: CreateConVar("sjs_nominations", "0", "Enable map nominations.", 0, 0, 1),
		NominationExcludeOld: CreateConVar("sjs_nominate_excludeold", "1", "Disallow nominations of recently played maps.", 0, 0, 1),
		NominationHistoryLength: CreateConVar("sjs_nominate_history", "5", "Number of previous maps checked for nomination exclusions.", 0, 0, unMaximumExclusionHistoryCount),
		NominationMaximumMatches: CreateConVar("sjs_nominate_maxfound", "0", "Maximum matches shown for a partial nomination name; zero is unlimited.", 0, 0),
		RockTheVote: CreateConVar("sjs_rockthevote", "0", "Enable player-initiated map votes.", 0, 0, 1),
		RTVNeeded: CreateConVar("sjs_rtv_needed", "0.60", "Fraction of connected humans needed to rock the vote.", 0, 0.05, 1),
		RTVMinimumPlayers: CreateConVar("sjs_rtv_minplayers", "0", "Minimum number of connected humans required to rock the vote.", 0, 0, unMaximumRTVPlayerThreshold),
		RTVInitialDelay: CreateConVar("sjs_rtv_initialdelay", "30", "Seconds after map activation before Rock the Vote opens.", 0, 0),
		RTVInterval: CreateConVar("sjs_rtv_interval", "240", "Seconds between Rock the Vote attempts that reach the threshold.", 0, 0),
		RTVChangeTime: CreateConVar("sjs_rtv_changetime", "0", "Change map after RTV: 0 now, 1 round end, 2 map end.", 0, g_MapChangeTime.Immediately, g_MapChangeTime.MapEnd),
		RTVPostVoteAction: CreateConVar("sjs_rtv_postvoteaction", "0", "After the next map has been chosen: 0 allow RTV to advance to it, 1 deny RTV.", 0, 0, 1),
	};

	DefineCommand("nextmap", null, "", () => {
		const strOverride = FindConVar("nextlevel").Value;

		if (CanCheckAutomaticVote()) {
			return Phrase("NextMapPending", "The next map is pending a map vote.");
		}

		const strNext = (strOverride && IsMapValid(strOverride)) ? strOverride : PickSequentialMap();

		return strNext ? Phrase("NextMap", "Next map: {Map}.", { Map: strNext }) : Phrase("NoNextMap", "No next map is available.");
	});
	DefineCommand("timeleft", null, "", GetMapTimeRemaining);
	DefineCommand("listmaps", null, "", ListMaps);
	DefineCommand("maphistory", "map", "", (unClientIndex, vecArguments, bChat) => {
		for (const strLine of FormatMapHistory().split("\n")) {
			Reply(unClientIndex, strLine);
		}

		return bChat ? Phrase("ConsoleOutput", "See console for map history.") : null;
	});
	DefineCommand("setnextmap", "map", "<map>", SetManualNextMap);
	DefineCommand("mapvote", "vote", "", RequestMapVote);
	DefineCommand("nominate", null, "[map]", NominateMap, false, null, "Only connected players can nominate maps.");
	DefineCommand("nominate_addmap", "map", "<map>", ForceMapNomination);
	DefineCommand("mapchooser_refresh", "map", "", RefreshMapCycle);
	DefineCommand("rtv", null, "", RockTheVote, false, null, "Only connected players can rock the vote.");
}

module.exports = {
	GetRotationMaps,
	ApplyRoundEndMap,
	ResetMapVoteScores,
	ResetTimeLeftRounds,
	ResetMapRotation,
	AnnounceMapTime,
	RecoverFailedNextMap,
	HandleChangeLevelFailure,
	InitializeMapRotation,
	RecordMapVoteRound,
	RecordMapVoteDeath,
	ForgetMapVoter,
	RegisterMapRotationCommands,
};
