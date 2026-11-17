"use strict";

const { LogWarning } = require("core/logger");
const { CreateConVar, FindConVar } = require("cvars");
const { GetServerTime } = require("engines/server");
const { GetAllPlayers } = require("filters/players");
const { TickDelay } = require("listeners/tick");
const { GetUserMessageIndex, HintText } = require("messages");
const { PagedESCMenu, PagedESCOption, SimpleESCMenu, SimpleESCOption } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { SimpleRadioMenu, SimpleRadioOption } = require("menus/radio");
const { GetUserIDFromIndex } = require("players/helpers");
const { CommandFailure, CommandUsage, FormatBanDuration, LabelValue, Phrase, RenderPhrase, Translate } = require("./translations");
const { DefineCommand, HasPermission, Reply, RequireCurrentPlayer, RequireTargets, RequireUnsignedInteger } = require("./administration");
const { Broadcast, SendLocalizedMessage } = require("./communication");
const { MAXIMUM_VOTE_CHOICES } = require("./map-menu");
const { PlayMenuSound } = require("./menu-sounds");
const { AddBan, BanPlayer, BurnPlayer, KickPlayer, NormalizeSteamID, SlayPlayer } = require("./moderation");
const { ChangeMap, RequireMapName } = require("./server");

const g_unVoteDurationSeconds = 20;
const g_unVoteMapChangeDelaySeconds = 5;
const g_unMinimumVoteChoiceCount = 2;
const g_unMaximumVoteChoiceCount = 8;
const g_unMaximumSimpleESCChoices = 5;
const g_unMaximumQuestionVoteChoices = 5;
const g_unMaximumGravityVoteChoices = 5;
const g_unMaximumVoteBanMinutes = 2_147_483_647;
const g_strVoteBurnDurationSeconds = "19.8";
const g_unVoteHintIntervalSeconds = 1;
const g_unMaximumHintLeaderCount = 3;
const g_unMaximumHintLabelCharacters = 14;
const g_mapVoteThresholds = new Map();
const g_setDisconnectingClients = new Set();
let g_ActiveVote = null;
let g_VoteDelay = null;
let g_VoteBanDuration = null;
let g_VoteProgress = null;
let g_flLastCommandVoteEnd = -Infinity;

function IsVoteActive() {
	return g_ActiveVote !== null;
}

function IsMapRotationVoteActive() {
	return g_ActiveVote?.MapRotation === true;
}

function CloseVoteMenu(Vote, unClientIndex) {
	try {
		Vote.Menu.CloseMenu(unClientIndex);
	} catch (Failure) {
		LogWarning(`Could not close vote menu for client ${unClientIndex}: ${Failure?.message ?? "unknown error"}`);
	}
}

function CloseVoteMenus(Vote) {
	for (const unClientIndex of Vote.Voters.keys()) {
		CloseVoteMenu(Vote, unClientIndex);
	}
}

function ClearVote() {
	const ActiveVote = g_ActiveVote;
	g_ActiveVote = null;

	if (ActiveVote) {
		ActiveVote.Delay?.DisposeTickDelay();
		CloseVoteMenus(ActiveVote);
	}
}

function ResetVotes() {
	g_flLastCommandVoteEnd = -Infinity;

	ClearVote();
}

function RecordVoteEnd(Vote) {
	if (Vote.UseCommandDelay) {
		g_flLastCommandVoteEnd = GetServerTime();
	}
}

function RequireVoteDelayElapsed(unClientIndex) {
	if (HasPermission(unClientIndex, "cvar") || HasPermission(unClientIndex, "vote_delay_bypass")) {
		return;
	}

	const flDelay = Number(g_VoteDelay.Value);
	const flRemaining = g_flLastCommandVoteEnd + flDelay - GetServerTime();
	if ((flDelay >= 1) && (flRemaining > 0)) {
		throw CommandFailure("VoteDelay", "Wait {Seconds} second(s) before starting another vote.", { Seconds: Math.ceil(flRemaining) });
	}
}

function GetVoteAudience() {
	return GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient && !g_setDisconnectingClients.has(Player.Index));
}

function TrySendVoteFeedback(Send) {
	try {
		Send();
	} catch {
		// Optional progress messages and menu sounds must not interrupt voting.
	}
}

function CanVote(Vote, unClientIndex) {
	return (g_ActiveVote === Vote) && (unClientIndex !== 0) && Vote.Voters.has(unClientIndex) && (Vote.Voters.get(unClientIndex) === GetUserIDFromIndex(unClientIndex));
}

function GetVoteChoiceText(Vote, unOptionIndex, unClientIndex) {
	const Choice = Vote.Options[unOptionIndex];
	if (Vote.Binary) {
		return Translate(unClientIndex, (unOptionIndex === 0) ? "Yes" : "No", Choice);
	}

	return RenderPhrase(unClientIndex, Choice);
}

function ShowVoteHint(Vote) {
	if ((g_ActiveVote !== Vote) || !Vote.Delay || (Number(g_VoteProgress.HintBox.Value) === 0)) {
		return;
	}

	TrySendVoteFeedback(() => {
		if (GetUserMessageIndex("HintText") < 0) {
			return;
		}

		const vecRecipients = GetVoteAudience().map((Player) => Player.Index);
		if (vecRecipients.length === 0) {
			return;
		}

		const vecCounts = new Array(Vote.Options.length).fill(0);
		for (const unChoice of Vote.Ballots.values()) {
			++vecCounts[unChoice];
		}

		const vecLeaders = vecCounts.map((unCount, unChoice) => ({ Count: unCount, Choice: unChoice })).filter((Entry) => Entry.Count > 0).sort((Left, Right) => Right.Count - Left.Count).slice(0, g_unMaximumHintLeaderCount);
		const unRemainingSeconds = Math.max(0, Math.ceil(Vote.Delay.TimeRemainingSeconds));

		SendLocalizedMessage(vecRecipients, (unIndex) => {
			const vecLines = [Translate(unIndex, "VoteProgress", "Votes: {Count}/{Total} ({Seconds}s left)", { Count: Vote.Ballots.size, Total: Vote.VoterCount, Seconds: unRemainingSeconds })];
			for (const { Count: unCount, Choice: unChoice } of vecLeaders) {
				const strLabel = Array.from(GetVoteChoiceText(Vote, unChoice, unIndex)).slice(0, g_unMaximumHintLabelCharacters).join("");
				vecLines.push(`${vecLines.length}. ${strLabel}: ${unCount}`);
			}

			return vecLines.join("\n");
		}, (strText) => new HintText(strText));
	});
}

function AnnounceBallot(Vote, unClientIndex, unChoice) {
	const bChat = Number(g_VoteProgress.Chat.Value) !== 0;
	const bServerConsole = Number(g_VoteProgress.ServerConsole.Value) !== 0;
	const bClientConsole = Number(g_VoteProgress.ClientConsole.Value) !== 0;

	if (bChat || bServerConsole || bClientConsole) {
		TrySendVoteFeedback(() => {
			const vecAudience = GetVoteAudience();
			const Voter = vecAudience.find((Player) => Player.Index === unClientIndex);
			if (!Voter) {
				return;
			}

			const strName = Voter.Name.replace(/[\x00-\x1F\x7F]/g, " ");
			const bChangedVote = Vote.Revoting.delete(unClientIndex);
			const strFallback = bChangedVote ? "{Player} changed their vote to {Choice}." : "{Player} voted for {Choice}.";
			const Message = (unIndex) => Translate(unIndex, bChangedVote ? "BallotChanged" : "BallotCast", strFallback, { Player: strName, Choice: GetVoteChoiceText(Vote, unChoice, unIndex) });

			if (bServerConsole) {
				TrySendVoteFeedback(() => Reply(0, Message));
			}

			if (bChat) {
				TrySendVoteFeedback(() => Broadcast(Message));
			}

			if (bClientConsole) {
				for (const { Index: unRecipientIndex } of vecAudience) {
					TrySendVoteFeedback(() => Reply(unRecipientIndex, Message));
				}
			}
		});
	} else {
		Vote.Revoting.delete(unClientIndex);
	}

	ShowVoteHint(Vote);
}

function ApplyVoteResult(Vote) {
	const unPercentPerUnit = 100;
	const vecCounts = new Array(Vote.Options.length).fill(0);
	const mapConnectedUserIDs = new Map(GetAllPlayers().filter((Player) => Player.Connected && !Player.FakeClient).map((Player) => [Player.Index, Player.UserID]));

	for (const [unVoterIndex, unOptionIndex] of Vote.Ballots) {
		if (mapConnectedUserIDs.has(unVoterIndex) && (mapConnectedUserIDs.get(unVoterIndex) === Vote.Voters.get(unVoterIndex))) {
			++vecCounts[unOptionIndex];
		} else {
			Vote.Ballots.delete(unVoterIndex);
		}
	}

	const unHighestCount = Math.max(...vecCounts);
	const vecWinningIndices = vecCounts.flatMap((unCount, unIndex) => (unCount === unHighestCount) ? [unIndex] : []);
	const bTied = vecWinningIndices.length > 1;
	const bChooseWinner = bTied && Vote.RandomTieBreak && (Vote.Ballots.size > 0);
	const unWinningIndex = bChooseWinner ? vecWinningIndices[Math.floor(Math.random() * vecWinningIndices.length)] : vecWinningIndices[0];
	const bHasWinner = (Vote.Ballots.size > 0) && (!bTied || bChooseWinner);

	if (Vote.Threshold && (Vote.Ballots.size > 0) && !bTied) {
		const flRequired = Number(Vote.Threshold.Value);
		const flYesFraction = vecCounts[0] / Vote.Ballots.size;
		if ((unWinningIndex !== 0) || (flYesFraction < flRequired)) {
			Broadcast(Phrase("VoteRejected", "Vote did not pass: {Yes}% yes; {Required}% required.", { Yes: Math.round(unPercentPerUnit * flYesFraction), Required: Math.round(unPercentPerUnit * flRequired) }));
			return;
		}
	}

	const unClientIndex = Vote.InitiatorIndex;
	const bMayApplyResult = Boolean(Vote.ResolveResult) || (Boolean(Vote.Apply) && bHasWinner);
	if (bMayApplyResult && (unClientIndex !== 0) && (Vote.InitiatorDisconnected || (mapConnectedUserIDs.get(unClientIndex) !== Vote.InitiatorUserID) || !HasPermission(unClientIndex, "vote") || !HasPermission(unClientIndex, Vote.Permission))) {
		Broadcast(Phrase("VotePermissionLost", "Vote passed, but its initiator no longer has permission to apply it."));
		return;
	}

	try {
		if (Vote.ResolveResult) {
			const Result = Vote.ResolveResult(unClientIndex, vecCounts);
			if (Result) {
				Broadcast(Result);
			}

			return;
		}

		if (Vote.Ballots.size === 0) {
			Broadcast(Phrase("NoVotes", "No votes were cast."));
		} else if (!bHasWinner) {
			Broadcast(Phrase("NoWinner", "Vote ended without a winner."));
		} else if (Vote.Apply) {
			Broadcast(Vote.Apply(unClientIndex, unWinningIndex));
		} else {
			Broadcast((unRecipientIndex) => Translate(unRecipientIndex, "VoteResult", "Vote result: {Choice} ({Count}/{Total}).", {
				Choice: GetVoteChoiceText(Vote, unWinningIndex, unRecipientIndex),
				Count: unHighestCount,
				Total: Vote.Ballots.size,
			}));
		}
	} catch (Failure) {
		Broadcast(Phrase("VoteApplyFailed", "Vote passed, but the action could not be applied."));
		throw Failure;
	}
}

function FinishVote(Vote) {
	if (g_ActiveVote !== Vote) {
		return;
	}

	g_ActiveVote = null;
	RecordVoteEnd(Vote);

	Vote.Delay?.DisposeTickDelay();
	CloseVoteMenus(Vote);

	try {
		ApplyVoteResult(Vote);
	} finally {
		Vote.OnEnd?.();
	}
}

function FinishVoteIfReady(Vote) {
	if (Vote.Delay && (Vote.PendingVoters.size === 0)) {
		FinishVote(Vote);
	}
}

function UpdateVote() {
	const Vote = g_ActiveVote;
	if (!Vote?.Delay) {
		return;
	}

	// Menus can be replaced from another callback while the queue is transitioning.
	// Read its final owner on the next tick instead of finishing inside that transition.
	for (const unClientIndex of Vote.PendingVoters) {
		if (!CanVote(Vote, unClientIndex) || (GetPlayerMenuQueue(unClientIndex).ActiveMenu !== Vote.Menu)) {
			Vote.PendingVoters.delete(unClientIndex);
		}
	}

	FinishVoteIfReady(Vote);

	if ((g_ActiveVote !== Vote) || (Number(g_VoteProgress.HintBox.Value) === 0)) {
		return;
	}

	const flServerTime = GetServerTime();
	if (flServerTime >= Vote.NextHintTime) {
		Vote.NextHintTime = flServerTime + g_unVoteHintIntervalSeconds;
		ShowVoteHint(Vote);
	}
}

function HandleVoteDisconnect(unClientIndex) {
	const Vote = g_ActiveVote;
	if (!Vote) {
		return;
	}

	if (Vote.InitiatorIndex === unClientIndex) {
		Vote.InitiatorDisconnected = true;
	}

	if (!Vote.Voters.delete(unClientIndex)) {
		return;
	}

	Vote.Ballots.delete(unClientIndex);
	Vote.PendingVoters.delete(unClientIndex);
	Vote.Revoting.delete(unClientIndex);
	g_setDisconnectingClients.add(unClientIndex);

	try {
		CloseVoteMenu(Vote, unClientIndex);
		FinishVoteIfReady(Vote);
		ShowVoteHint(Vote);
	} finally {
		g_setDisconnectingClients.delete(unClientIndex);
	}
}

function CreateVoteMenu(Vote, Question) {
	const SelectCallback = (unClientIndex, unOptionIndex) => {
		if (!CanVote(Vote, unClientIndex) || !Vote.PendingVoters.has(unClientIndex) || Vote.Ballots.has(unClientIndex) || (GetPlayerMenuQueue(unClientIndex).ActiveMenu !== Vote.Menu) || !Number.isInteger(unOptionIndex) || (unOptionIndex < 0) || (unOptionIndex >= Vote.Options.length)) {
			return;
		}

		Vote.Ballots.set(unClientIndex, unOptionIndex);
		Vote.PendingVoters.delete(unClientIndex);

		TrySendVoteFeedback(() => PlayMenuSound(unClientIndex, "Select"));
		AnnounceBallot(Vote, unClientIndex, unOptionIndex);
		FinishVoteIfReady(Vote);
	};

	const MenuOptions = {
		SelectCallback,
		Timeout: Vote.DurationSeconds,
		Title: ((typeof Question === "string") || (typeof Question === "function")) ? Question : (unClientIndex) => RenderPhrase(unClientIndex, Question),
		Description: (unClientIndex) => Translate(unClientIndex, "CastVote", "Choose one answer to cast your vote."),
		BackText: (unClientIndex) => Translate(unClientIndex, "Previous", "Previous page"),
		NextText: (unClientIndex) => Translate(unClientIndex, "Next", "Next page"),
		CloseText: (unClientIndex) => Translate(unClientIndex, "SkipVote", "Skip vote"),
		Fill: false,
		InteractionCallback(unClientIndex, strInteraction) {
			if ((strInteraction !== "Select") && CanVote(Vote, unClientIndex)) {
				TrySendVoteFeedback(() => PlayMenuSound(unClientIndex, strInteraction));

				if (strInteraction === "Exit") {
					Vote.PendingVoters.delete(unClientIndex);
					FinishVoteIfReady(Vote);
				}
			}
		},
	};

	const bRadioAvailable = GetUserMessageIndex?.("ShowMenu") >= 0;
	const bSimpleDialog = !bRadioAvailable && (Vote.Options.length <= g_unMaximumSimpleESCChoices);
	const Menu = bRadioAvailable ? new SimpleRadioMenu(MenuOptions) : (bSimpleDialog ? new SimpleESCMenu(MenuOptions) : new PagedESCMenu(MenuOptions));
	// The selected renderer already closes its own menu.
	Menu.UseTextDialogFallback = false;

	for (let unOptionIndex = 0; unOptionIndex < Vote.Options.length; ++unOptionIndex) {
		const Choice = Vote.Options[unOptionIndex];
		const Label = (Vote.Binary || (typeof Choice !== "string")) ? (unClientIndex) => GetVoteChoiceText(Vote, unOptionIndex, unClientIndex) : Choice;
		let Option;
		if (bRadioAvailable || bSimpleDialog) {
			const OptionType = bRadioAvailable ? SimpleRadioOption : SimpleESCOption;
			Option = new OptionType(unOptionIndex + 1, Label, unOptionIndex);
		} else {
			Option = new PagedESCOption(Label, unOptionIndex);
		}
		Menu.AppendMenuItem(Option);
	}

	return Menu;
}

function StartVote(unClientIndex, Question, vecOptions, VoteOptions = {}) {
	const unMaximumLabelLength = 100;
	const {
		Apply = null,
		Binary: bBinary = false,
		ResolveResult = null,
		OnEnd = null,
		Permission: strPermission = "vote",
		Threshold: strThreshold = null,
		UseCommandDelay: bUseCommandDelay = true,
		ExcludedIndex: unExcludedIndex = 0,
		DurationSeconds: unDurationSeconds = g_unVoteDurationSeconds,
		RandomTieBreak: bRandomTieBreak = false,
		MapRotation: bMapRotation = false,
	} = VoteOptions;

	if (g_ActiveVote) {
		throw CommandFailure("VoteInProgress", "A vote is already in progress.");
	}

	const vecLabels = [RenderPhrase(null, Question ?? ""), ...vecOptions.map((Choice) => RenderPhrase(null, Choice))];
	if ((vecOptions.length < g_unMinimumVoteChoiceCount) || (vecOptions.length > g_unMaximumVoteChoiceCount) || vecLabels.some((strLabel) => !strLabel || (strLabel.length > unMaximumLabelLength) || /[\x00-\x1F\x7F]/.test(strLabel))) {
		throw CommandFailure("InvalidBallot", "A vote needs a question and 2–8 short choices.");
	}

	if ((Apply || ResolveResult) && !HasPermission(unClientIndex, strPermission)) {
		throw CommandFailure("RequiresPermission", "This vote also requires {Permission}.", { Permission: `sourcejs.${strPermission}` });
	}

	if (bUseCommandDelay) {
		RequireVoteDelayElapsed(unClientIndex);
	}

	const mapVoters = new Map(GetAllPlayers().filter((Target) => Target.Connected && !Target.FakeClient && (Target.Index !== unExcludedIndex) && !g_setDisconnectingClients.has(Target.Index)).map((Target) => [Target.Index, Target.UserID]));
	if (mapVoters.size === 0) {
		throw CommandFailure("NoVoters", "No eligible voters are connected.");
	}

	const unInitiatorUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Vote = {
		Options: vecOptions,
		Binary: bBinary || (!!strThreshold && (vecOptions.length === 2) && (vecOptions[0] === "Yes") && (vecOptions[1] === "No")),
		Apply,
		ResolveResult,
		OnEnd,
		DurationSeconds: unDurationSeconds,
		Permission: strPermission,
		Threshold: g_mapVoteThresholds.get(strThreshold),
		UseCommandDelay: bUseCommandDelay,
		RandomTieBreak: bRandomTieBreak && !strThreshold,
		MapRotation: bMapRotation,
		Voters: mapVoters,
		Ballots: new Map(),
		Revoting: new Set(),
		PendingVoters: new Set(mapVoters.keys()),
		VoterCount: 0,
		NextHintTime: 0,
		InitiatorIndex: unClientIndex,
		InitiatorUserID: unInitiatorUserID,
		InitiatorDisconnected: false,
		Menu: null,
		Delay: null,
	};

	Vote.Menu = CreateVoteMenu(Vote, Question);
	g_ActiveVote = Vote;
	try {
		for (const unVoterIndex of mapVoters.keys()) {
			try {
				if (GetPlayerMenuQueue(unVoterIndex).SendMenu(Vote.Menu)) {
					continue;
				}
			} catch (Failure) {
				LogWarning(`Could not send vote menu to client ${unVoterIndex}: ${Failure?.message ?? "unknown error"}`);
			}

			mapVoters.delete(unVoterIndex);
			Vote.PendingVoters.delete(unVoterIndex);
			Vote.Ballots.delete(unVoterIndex);
			CloseVoteMenu(Vote, unVoterIndex);
		}

		if (mapVoters.size === 0) {
			throw CommandFailure("MenuUnavailable", "The game could not display a vote menu to any eligible player.");
		}

		Vote.Delay = new TickDelay(unDurationSeconds, () => FinishVote(Vote), [], true);
		Vote.VoterCount = mapVoters.size;
		Vote.NextHintTime = GetServerTime() + g_unVoteHintIntervalSeconds;

		ShowVoteHint(Vote);
	} catch (Failure) {
		ClearVote();
		throw Failure;
	}

	FinishVoteIfReady(Vote);
}

function CastVote(unClientIndex, vecArguments) {
	const Vote = g_ActiveVote;
	if (!Vote || !CanVote(Vote, unClientIndex)) {
		throw CommandFailure("NotEligibleToVote", "You are not eligible for an active vote.");
	}

	const unChoice = RequireUnsignedInteger(vecArguments[0], Vote.Options.length, "Vote choice");
	if ((unChoice === 0) || Vote.Ballots.has(unClientIndex)) {
		throw CommandFailure("InvalidVoteChoice", "Choose an available option; each player can vote once.");
	}

	Vote.Ballots.set(unClientIndex, unChoice - 1);
	Vote.PendingVoters.delete(unClientIndex);

	CloseVoteMenu(Vote, unClientIndex);
	AnnounceBallot(Vote, unClientIndex, unChoice - 1);
	FinishVoteIfReady(Vote);

	return Phrase("VoteRecorded", "Vote recorded.");
}

function ReopenVote(unClientIndex) {
	const Vote = g_ActiveVote;
	if (!Vote) {
		throw CommandFailure("NoActiveVote", "No vote is in progress.");
	}

	if (!CanVote(Vote, unClientIndex)) {
		throw CommandFailure("NotEligibleToVote", "You are not eligible for this vote.");
	}

	const flRemainingSeconds = Vote.Delay?.TimeRemainingSeconds ?? 0;
	if (flRemainingSeconds <= 0) {
		throw CommandFailure("VoteExpired", "This vote has expired.");
	}

	const Menu = Vote.Menu;
	const unPreviousTimeout = Menu.Timeout;
	Menu.Timeout = Math.max(1, Math.floor(flRemainingSeconds));
	try {
		if (!GetPlayerMenuQueue(unClientIndex).SendMenu(Menu)) {
			throw CommandFailure("MenuUnavailable", "The game could not reopen the vote menu.");
		}
	} catch (Failure) {
		CloseVoteMenu(Vote, unClientIndex);
		throw Failure;
	} finally {
		Menu.Timeout = unPreviousTimeout;
	}

	// A successful redraw withdraws the previous ballot. Only the next choice counts.
	if (Vote.Ballots.delete(unClientIndex)) {
		Vote.Revoting.add(unClientIndex);
	}

	Vote.PendingVoters.add(unClientIndex);

	ShowVoteHint(Vote);
}

function StartTargetVote(unClientIndex, vecArguments, strAction, strPermission, strThreshold, Execute, bRequireAlive = false) {
	if (!HasPermission(unClientIndex, strPermission)) {
		throw CommandFailure("RequiresPermission", "This vote also requires {Permission}.", { Permission: `sourcejs.${strPermission}` });
	}

	if ((vecArguments.length === 0) || (bRequireAlive && (vecArguments.length !== 1))) {
		const strReasonUsage = bRequireAlive ? "" : " [reason]";
		throw CommandUsage(`sjs_vote${strThreshold} <target>${strReasonUsage}.`);
	}

	const [Target] = RequireTargets(unClientIndex, vecArguments[0]);
	const { Index: unTargetIndex, UserID: unTargetUserID } = Target;
	const CurrentTarget = RequireCurrentPlayer({ Index: unTargetIndex, UserID: unTargetUserID });
	if (bRequireAlive && CurrentTarget.Dead) {
		throw CommandFailure("LiveTargetRequired", "The vote requires a live target.");
	}

	const strUserSelector = `#${unTargetUserID}`;
	const Question = (unRecipientIndex) => `${Translate(unRecipientIndex, { burn: "BurnVote", kick: "KickVote", slay: "SlayVote" }[strThreshold], strAction)} ${Target.Name}?`;
	StartVote(unClientIndex, Question, ["Yes", "No"], {
		Apply(unIndex) {
			const CurrentPlayer = RequireCurrentPlayer({ Index: unTargetIndex, UserID: unTargetUserID });
			if (bRequireAlive && CurrentPlayer.Dead) {
				return Phrase("VoteTargetChanged", "Vote passed, but the target is no longer alive.");
			}

			return Execute(unIndex, [strUserSelector, ...vecArguments.slice(1)]);
		},
		Permission: strPermission,
		Threshold: strThreshold,
	});
}

function StartBurnVote(unClientIndex, vecArguments) {
	StartTargetVote(unClientIndex, vecArguments, "Burn", "slay", "burn", (unInitiatorIndex, vecTargetArguments) => BurnPlayer(unInitiatorIndex, [vecTargetArguments[0], g_strVoteBurnDurationSeconds], false), true);
}

function StartBanVote(unClientIndex, vecArguments) {
	if (vecArguments.length === 0) {
		throw CommandUsage("sjs_voteban <target> [reason].");
	}

	const [Target] = RequireTargets(unClientIndex, vecArguments[0]);
	const CurrentTarget = RequireCurrentPlayer(Target);
	if (CurrentTarget.FakeClient) {
		throw CommandFailure("HumanTargetRequired", "The vote requires a human target.");
	}

	const { Index: unTargetIndex, UserID: unTargetUserID } = Target;
	const strSteamID = NormalizeSteamID(CurrentTarget.NetworkID);
	const vecReason = vecArguments.slice(1);
	const strDuration = String(Math.min(g_unMaximumVoteBanMinutes, Math.trunc(Number(g_VoteBanDuration.Value))));
	const strAction = (strDuration === "0") ? "Permanently ban" : `Ban for ${strDuration} minutes:`;
	const Question = (unRecipientIndex) => {
		const strLabel = Translate(unRecipientIndex, "BanVote", strAction);

		return (strLabel === strAction) ? `${strAction} ${Target.Name}?` : `${strLabel}: ${Target.Name} (${FormatBanDuration(unRecipientIndex, Number(strDuration))})?`;
	};

	StartVote(unClientIndex, Question, ["Yes", "No"], {
		Apply(unIndex) {
			const ConnectedTarget = GetAllPlayers().find((Player) => (Player.Index === unTargetIndex) && (Player.UserID === unTargetUserID) && Player.Connected);
			if (ConnectedTarget && !g_setDisconnectingClients.has(unTargetIndex)) {
				if (strSteamID && (NormalizeSteamID(ConnectedTarget.NetworkID) !== strSteamID)) {
					throw CommandFailure("VoteTargetChanged", "The target's Steam identity changed during the vote.");
				}

				return BanPlayer(unIndex, [`#${unTargetUserID}`, strDuration, ...vecReason]);
			}

			if (!strSteamID) {
				return Phrase("VoteTargetChanged", "Vote passed, but the disconnected target had no valid Steam ID.");
			}

			return AddBan(unIndex, [strDuration, strSteamID, ...vecReason]);
		},
		Permission: "ban",
		Threshold: "ban",
	});
}

function StartMapVote(unClientIndex, vecArguments) {
	if (vecArguments.length === 0) {
		throw CommandUsage("sjs_votemap <map> [other maps...].");
	}

	const vecMaps = [...new Set(vecArguments.slice(0, MAXIMUM_VOTE_CHOICES).map(RequireMapName))];
	if (vecMaps.length === 1) {
		StartVote(unClientIndex, Phrase("ChangeMapQuestion", "Change map to {Map}?", { Map: vecMaps[0] }), ["Yes", "No"], {
			Apply: (unIndex) => ChangeMap(unIndex, vecMaps, "Map vote", g_unVoteMapChangeDelaySeconds),
			Permission: "map",
			Threshold: "map",
		});
		return;
	}

	StartVote(unClientIndex, Phrase("ChooseMap", "Choose the next map"), vecMaps, {
		Apply: (unIndex, unChoice) => ChangeMap(unIndex, [vecMaps[unChoice]], "Map vote", g_unVoteMapChangeDelaySeconds),
		Permission: "map",
		RandomTieBreak: true,
	});
}

function RequireVoteConVars(vecNames) {
	const vecConVars = vecNames.map(FindConVar);
	if (vecConVars.some((ConVar) => ConVar.Exists !== true)) {
		throw CommandFailure("CvarNotFound", "This game does not expose the required ConVar.");
	}

	return vecConVars;
}

function ApplyVoteConVars(vecNames, strNewValue) {
	const vecConVars = RequireVoteConVars(vecNames);
	const vecPreviousValues = vecConVars.map((ConVar) => ConVar.Value);
	let unAttempted = 0;

	try {
		for (const ConVar of vecConVars) {
			++unAttempted;
			ConVar.Value = strNewValue;
			if (Number(ConVar.Value) !== Number(strNewValue)) {
				throw new Error(`The engine rejected ${vecNames[unAttempted - 1]}.`);
			}
		}
	} catch (Failure) {
		const vecFailures = [Failure];
		for (let unIndex = unAttempted; unIndex > 0; --unIndex) {
			try {
				const ConVar = vecConVars[unIndex - 1];
				const strPreviousValue = vecPreviousValues[unIndex - 1];
				if (ConVar.Value !== strPreviousValue) {
					ConVar.Value = strPreviousValue;
				}

				if (ConVar.Value !== strPreviousValue) {
					throw new Error(`Could not restore ${vecNames[unIndex - 1]}.`);
				}
			} catch (RollbackFailure) {
				vecFailures.push(RollbackFailure);
			}
		}

		if (vecFailures.length > 1) {
			throw new AggregateError(vecFailures, "The vote change and its rollback did not complete.");
		}

		throw Failure;
	}
}

function StartToggleVote(unClientIndex, vecNames, strThreshold) {
	const vecConVars = RequireVoteConVars(vecNames);
	const strNewValue = vecConVars.every((ConVar) => Number(ConVar.Value) !== 0) ? "0" : "1";
	const strNames = vecNames.join(" and ");
	const Question = (unIndex) => {
		const strLabel = Translate(unIndex, (strThreshold === "ff") ? "FriendlyFireVote" : "AllTalkVote", "");

		return strLabel ? `${strLabel}: ${strNames} = ${strNewValue}?` : `Set ${strNames} to ${strNewValue}?`;
	};

	StartVote(unClientIndex, Question, ["Yes", "No"], {
		Apply() {
			ApplyVoteConVars(vecNames, strNewValue);

			return Phrase("VoteSettingChanged", "Vote passed: {Setting} set to {Value}.", { Setting: strNames, Value: strNewValue });
		},
		Permission: "cvar",
		Threshold: strThreshold,
	});
}

function StartAllTalkVote(unClientIndex, vecArguments) {
	if (vecArguments.length > 0) {
		throw CommandUsage("sjs_votealltalk.");
	}

	const vecNames = (FindConVar("sv_alltalk").Exists === true) ? ["sv_alltalk"] : ["sv_talk_enemy_living", "sv_talk_enemy_dead"];
	StartToggleVote(unClientIndex, vecNames, "alltalk");
}

function StartGravityVote(unClientIndex, vecArguments) {
	const unMaximumGravity = 10_000;
	const vecValues = [...new Set(vecArguments.slice(0, g_unMaximumGravityVoteChoices).map((strValue) => String(RequireUnsignedInteger(strValue, unMaximumGravity, "Gravity"))))];
	if ((vecValues.length === 0) || (FindConVar("sv_gravity").Exists !== true)) {
		throw CommandFailure("InvalidInput", "Specify a gravity value on a game that supports sv_gravity.");
	}

	const bYesNo = vecValues.length === 1;
	const Question = bYesNo ? LabelValue("GravityVote", `${vecValues[0]}?`, `Set gravity to ${vecValues[0]}?`) : Phrase("GravityVote", "Choose gravity");
	StartVote(unClientIndex, Question, bYesNo ? ["Yes", "No"] : vecValues, {
		Apply(...[, unChoice]) {
			const strGravity = vecValues[bYesNo ? 0 : unChoice];
			ApplyVoteConVars(["sv_gravity"], strGravity);

			return Phrase("VoteSettingChanged", "Vote passed: {Setting} set to {Value}.", { Setting: "sv_gravity", Value: strGravity });
		},
		Permission: "cvar",
		Threshold: bYesNo ? "gravity" : null,
		RandomTieBreak: !bYesNo,
	});
}

function RegisterVoteCommands() {
	const flMinimumYesFraction = 0.05;
	g_VoteDelay = CreateConVar("sjs_vote_delay", "30", "Seconds between command votes; zero disables the delay.", 0, 0);
	g_VoteBanDuration = CreateConVar("sjs_voteban_time", "30", "Vote-ban duration in minutes; zero is permanent.", 0, 0, g_unMaximumVoteBanMinutes);
	g_VoteProgress = {
		Chat: CreateConVar("sjs_vote_progress_chat", "0", "Announce player ballots in chat.", 0, 0, 1),
		ServerConsole: CreateConVar("sjs_vote_progress_console", "0", "Announce player ballots in the server console.", 0, 0, 1),
		ClientConsole: CreateConVar("sjs_vote_progress_client_console", "0", "Announce player ballots in client consoles.", 0, 0, 1),
		HintBox: CreateConVar("sjs_vote_progress_hintbox", "0", "Show the vote count, leaders, and time left in a hint box.", 0, 0, 1),
	};

	for (const strType of ["alltalk", "ban", "burn", "ff", "gravity", "kick", "map", "slay"]) {
		g_mapVoteThresholds.set(strType, CreateConVar(`sjs_vote_${strType}`, "0.60", `Minimum yes fraction for a ${strType} vote.`, 0, flMinimumYesFraction, 1));
	}

	DefineCommand("vote", "vote", "<question> [choices...]", (unClientIndex, vecArguments) => {
		const [strQuestion, ...vecOptions] = vecArguments;
		const bBinary = vecOptions.length <= 1;
		StartVote(unClientIndex, strQuestion, bBinary ? ["Yes", "No"] : vecOptions.slice(0, g_unMaximumQuestionVoteChoices), { Binary: bBinary, RandomTieBreak: true });
	});
	DefineCommand("votefor", null, "<choice number>", CastVote, false, null, "You are not eligible for an active vote.");
	DefineCommand("revote", null, "", ReopenVote, false, null, "This command is only available in-game.");
	DefineCommand("cancelvote", "vote", "", () => {
		if (!g_ActiveVote) {
			return Phrase("NoActiveVote", "No vote is in progress.");
		}

		const Vote = g_ActiveVote;
		RecordVoteEnd(Vote);
		ClearVote();
		Vote.OnEnd?.();

		Broadcast(Phrase("VoteCancelled", "Vote cancelled."));
	});

	DefineCommand("votemap", "vote", "<map> [other maps...]", StartMapVote, false, "map");
	DefineCommand("votekick", "vote", "<target> [reason]", (unClientIndex, vecArguments) => StartTargetVote(unClientIndex, vecArguments, "Kick", "kick", "kick", KickPlayer), false, "kick");
	DefineCommand("voteban", "vote", "<target> [reason]", StartBanVote, false, "ban");
	DefineCommand("voteslay", "vote", "<target>", (unClientIndex, vecArguments) => StartTargetVote(unClientIndex, vecArguments, "Slay", "slay", "slay", (unInitiatorIndex, vecTargetArguments) => SlayPlayer(unInitiatorIndex, vecTargetArguments, false), true), false, "slay");
	DefineCommand("voteburn", "vote", "<target>", StartBurnVote, false, "slay");
	DefineCommand("votealltalk", "vote", "", StartAllTalkVote, false, "cvar");
	DefineCommand("voteff", "vote", "", (unClientIndex) => StartToggleVote(unClientIndex, ["mp_friendlyfire"], "ff"), false, "cvar");
	DefineCommand("votegravity", "vote", "<gravity> [up to four other values]", StartGravityVote, false, "cvar");
}

module.exports = { IsVoteActive, IsMapRotationVoteActive, ResetVotes, UpdateVote, HandleVoteDisconnect, StartVote, RegisterVoteCommands };
