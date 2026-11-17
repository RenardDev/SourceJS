"use strict";

const { LogInfo } = require("core/logger");
const { CreateConVar } = require("cvars");
const { MoveType } = require("entities/constants");
const { GetAllPlayers } = require("filters/players");
const { RepeatingTickTask } = require("listeners/tick");
const { FADE_FLAGS, Fade, GetUserMessageIndex, HintText, HUDTextMessage, SCREEN_FADE_FRACTION_BITS, SendUserMessageValue } = require("messages");
const { GetUserIDFromIndex } = require("players/helpers");
const { DefineCommand, HasPermission, RequireCurrentPlayer, RequireTargets, RequireUnsignedInteger } = require("./administration");
const { GetMessageAuthor, ReportAdminActivity } = require("./communication");
const { EmitFunSound, GetFunCommandAssets, ReadEyePosition, SendFreezeGlow, SendFunRings, TryFunEffect } = require("./fun-effects");
const { GetMovementType, GetPlayerGravity, SetMovementType, SetPlayerGravity } = require("./movement");
const { ApplyPlayerTint, ReleasePlayerTint } = require("./player-tint");
const { CommandFailure, CommandUsage, FormatEffectResult, LabelValue, Phrase, RenderPhrase } = require("./translations");

const g_mapBeacons = new Map();
const g_mapFreezes = new Map();
const g_unBeaconIntervalSeconds = 1;
const g_unMaximumFreezeSeconds = 120;
const g_unBlindFadeDurationUnits = 1_536;
const g_InitialFreezeTint = Object.freeze({ Red: 0, Green: 128, Blue: 255, Alpha: 192 });
const g_FreezeTickTint = Object.freeze({ ...g_InitialFreezeTint, Alpha: 135 });
let g_BeaconRadius = null;
let g_FreezeDuration = null;

function StopBeacon(unPlayerIndex) {
	const Beacon = g_mapBeacons.get(unPlayerIndex);
	if (!Beacon) {
		return false;
	}

	g_mapBeacons.delete(unPlayerIndex);
	Beacon.Task.DisposeRepeatingTickTask();

	return true;
}

function StopAllBeacons() {
	const vecFailures = [];

	for (const unPlayerIndex of g_mapBeacons.keys()) {
		try {
			StopBeacon(unPlayerIndex);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not clear all player beacons.");
	}
}

function ToggleBeacons(unClientIndex, vecArguments) {
	if ((vecArguments.length < 1) || (vecArguments.length > 2)) {
		throw CommandUsage("sjs_beacon <target> [0|1].");
	}

	const [strTarget, strMode] = vecArguments;
	if ((strMode !== undefined) && (strMode !== "0") && (strMode !== "1")) {
		throw CommandFailure("BeaconMode", "Use 0 to disable or 1 to enable. Set sjs_beacon_radius to change the ring radius.");
	}

	const bToggle = strMode === undefined;
	const bEnable = bToggle || (strMode === "1");
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Target) => Target.Connected && !Target.Dead);
	const Author = GetMessageAuthor(unClientIndex);
	let unStartedCount = 0;
	let unStoppedCount = 0;

	for (const Target of vecTargets) {
		const PreviousBeacon = g_mapBeacons.get(Target.Index);
		if (PreviousBeacon && (PreviousBeacon.UserID !== Target.UserID)) {
			StopBeacon(Target.Index);
		} else if (PreviousBeacon) {
			if ((bToggle || !bEnable) && StopBeacon(Target.Index)) {
				++unStoppedCount;
			}

			continue;
		}

		if (!bEnable || RequireCurrentPlayer(Target).Dead) {
			continue;
		}

		const Assets = GetFunCommandAssets();

		function DrawBeacon() {
			if (g_mapBeacons.get(Target.Index) !== Beacon) {
				return;
			}

			try {
				if (GetUserIDFromIndex(Target.Index) !== Target.UserID) {
					StopBeacon(Target.Index);
					return;
				}

				const CurrentPlayer = RequireCurrentPlayer(Target);
				if (CurrentPlayer.Dead) {
					StopBeacon(Target.Index);
					return;
				}

				const vecRecipients = GetAllPlayers().filter((Recipient) => Recipient.Connected).map((Recipient) => Recipient.Index);
				const nTeam = CurrentPlayer.Team;
				const InnerColor = ((nTeam >= 1) && (nTeam <= 4)) ? Assets.TeamColors[nTeam] : Assets.UnknownColor;
				SendFunRings(Assets, CurrentPlayer.Origin, Number(g_BeaconRadius.Value), vecRecipients, Assets.OuterColor, InnerColor);

				if (g_mapBeacons.get(Target.Index) === Beacon) {
					EmitFunSound(CurrentPlayer, ReadEyePosition(CurrentPlayer), Assets.Blip);
				}
			} catch (Failure) {
				if (g_mapBeacons.get(Target.Index) === Beacon) {
					StopBeacon(Target.Index);
				}

				throw Failure;
			}
		}

		const Task = new RepeatingTickTask(DrawBeacon, [], true);
		const Beacon = { Task, UserID: Target.UserID };
		if (!Task.StartRepeatingTickTask(g_unBeaconIntervalSeconds)) {
			throw CommandFailure("TimerFailed", "Could not start the {Effect} timer.", { Effect: "beacon" });
		}

		g_mapBeacons.set(Target.Index, Beacon);
		++unStartedCount;
	}

	const Result = FormatEffectResult("BeaconEffect", "beacon", unStartedCount, unStoppedCount);
	if ((unStartedCount > 0) || (unStoppedCount > 0)) {
		ReportAdminActivity(unClientIndex, Author, Result);
	}

	return Result;
}

function SendFreezeHint(Player, Text) {
	if (Player.FakeClient) {
		return;
	}

	TryFunEffect("freeze hint", () => {
		const strText = RenderPhrase(Player.Index, Text);
		const Message = (GetUserMessageIndex("HintText") >= 0) ? new HintText(strText) : new HUDTextMessage(strText);

		return SendUserMessageValue([Player.Index], Message);
	});
}

function StopFreeze(unPlayerIndex, bRestorePlayer = true, bShowFeedback = false) {
	const Freeze = g_mapFreezes.get(unPlayerIndex);
	if (!Freeze) {
		return false;
	}

	let CurrentPlayer = null;
	if (bRestorePlayer && (GetUserIDFromIndex(unPlayerIndex) === Freeze.UserID)) {
		const Target = { Index: unPlayerIndex, UserID: Freeze.UserID };
		CurrentPlayer = RequireCurrentPlayer(Target);
		if (!CurrentPlayer.Dead) {
			const unMovementType = GetMovementType(CurrentPlayer);
			const bNeedsRestore = unMovementType === MoveType.None;
			if (!Number.isInteger(unMovementType) || (bNeedsRestore && (!SetMovementType(CurrentPlayer, Freeze.MovementType) || (GetMovementType(RequireCurrentPlayer(Target)) !== Freeze.MovementType)))) {
				throw new Error("Could not restore the player's movement after freezing.");
			}
		}
	}

	g_mapFreezes.delete(unPlayerIndex);

	try {
		Freeze.Task.DisposeRepeatingTickTask();
	} finally {
		TryFunEffect("restore freeze tint", () => ReleasePlayerTint(unPlayerIndex, Freeze.UserID, Freeze.TintOwner, bRestorePlayer));

		if (bShowFeedback && CurrentPlayer && (GetUserIDFromIndex(unPlayerIndex) === Freeze.UserID) && !CurrentPlayer.Dead) {
			EmitFunSound(CurrentPlayer, ReadEyePosition(CurrentPlayer), Freeze.Assets.Freeze);
			SendFreezeHint(CurrentPlayer, Phrase("Thawed", "You are no longer frozen."));
		}
	}

	return true;
}

function StopAllFreezes() {
	const vecFailures = [];
	for (const unPlayerIndex of g_mapFreezes.keys()) {
		try {
			StopFreeze(unPlayerIndex);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not clear all player freezes.");
	}
}

function FreezePlayer(Target, unDuration = Math.trunc(Number(g_FreezeDuration.Value))) {
	const unFreezeIntervalSeconds = 1;
	const CurrentPlayer = RequireCurrentPlayer(Target);
	if (CurrentPlayer.Dead) {
		return false;
	}

	const unMovementType = GetMovementType(CurrentPlayer);
	const Previous = g_mapFreezes.get(Target.Index);
	const bAlreadyOwned = (Previous?.UserID === Target.UserID) && (unMovementType === MoveType.None);
	if (!Number.isInteger(unMovementType) || ((unMovementType === MoveType.None) && !bAlreadyOwned)) {
		return false;
	}

	const Assets = GetFunCommandAssets();
	const Freeze = { UserID: Target.UserID, MovementType: bAlreadyOwned ? Previous.MovementType : unMovementType, RemainingSeconds: unDuration, Assets, TintOwner: bAlreadyOwned ? Previous.TintOwner : {}, Task: null };

	function UpdateFreeze() {
		if (g_mapFreezes.get(Target.Index) !== Freeze) {
			return;
		}

		if (GetUserIDFromIndex(Target.Index) !== Freeze.UserID) {
			StopFreeze(Target.Index, false);
			return;
		}

		const Player = RequireCurrentPlayer(Target);
		if (Player.Dead || (GetMovementType(Player) !== MoveType.None)) {
			StopFreeze(Target.Index);
			return;
		}

		if (Freeze.RemainingSeconds > 0) {
			--Freeze.RemainingSeconds;
		}

		if (Freeze.RemainingSeconds === 0) {
			StopFreeze(Target.Index, true, true);
			return;
		}

		SendFreezeHint(Player, Phrase("FreezeCountdown", "Unfrozen in {Seconds}s.", { Seconds: Freeze.RemainingSeconds }));
		TryFunEffect("freeze tint", () => ApplyPlayerTint(Player, Freeze.TintOwner, g_FreezeTickTint));
		const vecRecipients = GetAllPlayers().filter((Recipient) => !Recipient.FakeClient).map((Recipient) => Recipient.Index);
		SendFreezeGlow(Assets, Player.Origin, vecRecipients);
	}

	const Task = new RepeatingTickTask(UpdateFreeze, [], true);
	if (!Task.StartRepeatingTickTask(unFreezeIntervalSeconds)) {
		throw CommandFailure("TimerFailed", "Could not start the {Effect} timer.", { Effect: "freeze" });
	}

	try {
		if (!bAlreadyOwned && (!SetMovementType(CurrentPlayer, MoveType.None) || (GetMovementType(RequireCurrentPlayer(Target)) !== MoveType.None))) {
			throw new Error(`Could not freeze ${Target.Name}.`);
		}
	} catch (Failure) {
		Task.DisposeRepeatingTickTask();
		throw Failure;
	}

	Previous?.Task.DisposeRepeatingTickTask();
	Freeze.Task = Task;
	g_mapFreezes.set(Target.Index, Freeze);

	if (Previous && !bAlreadyOwned) {
		TryFunEffect("restore previous freeze tint", () => ReleasePlayerTint(Target.Index, Previous.UserID, Previous.TintOwner));
	}

	TryFunEffect("freeze tint", () => ApplyPlayerTint(CurrentPlayer, Freeze.TintOwner, g_InitialFreezeTint));
	EmitFunSound(CurrentPlayer, ReadEyePosition(CurrentPlayer), Assets.Freeze);
	SendFreezeHint(CurrentPlayer, Phrase("FreezeCountdown", "Unfrozen in {Seconds}s.", { Seconds: unDuration }));

	return true;
}

function TogglePlayerFreeze(Target) {
	if (g_mapFreezes.get(Target.Index)?.UserID === Target.UserID) {
		return StopFreeze(Target.Index, true, true);
	}

	return FreezePlayer(Target);
}

function FreezePlayers(unClientIndex, vecArguments) {
	if ((vecArguments.length < 1) || (vecArguments.length > 2)) {
		throw CommandUsage("sjs_freeze <target> [seconds].");
	}

	const [strTarget, strDuration] = vecArguments;
	const bToggle = strDuration === undefined;
	const unDuration = bToggle ? 0 : RequireUnsignedInteger(strDuration, g_unMaximumFreezeSeconds, "Freeze duration");
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected && !Player.Dead);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	let unChangedCount = 0;
	let unNoOpCount = 0;

	for (const Target of vecTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.Dead || ((Player.Index !== unClientIndex) && !Player.FakeClient && HasPermission(Player.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			const bHasFreeze = g_mapFreezes.get(Target.Index)?.UserID === Target.UserID;
			if (!bToggle && (unDuration === 0) && !bHasFreeze) {
				++unNoOpCount;
				continue;
			}

			const bChanged = bToggle ? TogglePlayerFreeze(Target) : ((unDuration === 0) ? StopFreeze(Target.Index, true, true) : FreezePlayer(Target, unDuration));
			if (bChanged) {
				++unChangedCount;
			}
		} catch {
			// A failed movement change or an invalidated connection must not stop the batch.
		}
	}

	if ((unChangedCount === 0) && (unNoOpCount !== vecTargets.length)) {
		throw CommandFailure("NoEffectApplied", "Could not update freeze for any eligible target.");
	}

	const Result = Phrase("ActionCount", "Freeze updated for {Count} of {Total} player(s).", { Count: unChangedCount, Total: vecTargets.length });
	if (unChangedCount > 0) {
		ReportAdminActivity(unClientIndex, Author, Result);
	}

	return Result;
}

function ToggleNoClip(unClientIndex, vecArguments) {
	if (vecArguments.length !== 1) {
		throw CommandUsage("sjs_noclip <target>.");
	}

	const vecTargets = RequireTargets(unClientIndex, vecArguments[0], true, true, (Player) => Player.Connected && !Player.Dead);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	let unChangedCount = 0;
	let unFrozenCount = 0;

	for (const Target of vecTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay") || !HasPermission(unClientIndex, "cheats")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.Dead || ((Player.Index !== unClientIndex) && !Player.FakeClient && HasPermission(Player.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			if (g_mapFreezes.get(Player.Index)?.UserID === Player.UserID) {
				++unFrozenCount;
				continue;
			}

			const unMovementType = GetMovementType(Player);
			if (!Number.isInteger(unMovementType)) {
				continue;
			}

			const unNextMovementType = (unMovementType === MoveType.NoClip) ? MoveType.Walk : MoveType.NoClip;
			if (SetMovementType(Player, unNextMovementType) && (GetMovementType(RequireCurrentPlayer(Target)) === unNextMovementType)) {
				++unChangedCount;
				LogInfo(`No-clip updated CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID} Enabled=${unNextMovementType === MoveType.NoClip}.`);
			}
		} catch {
			// A failed write or an invalidated connection must not stop the batch.
		}
	}

	if (unChangedCount === 0) {
		if (unFrozenCount === vecTargets.length) {
			return Phrase("NoEffectApplied", "No-clip was not changed for frozen players.");
		}

		throw CommandFailure("NoEffectApplied", "Could not update no-clip for any eligible target.");
	}

	const Result = Phrase("ActionCount", "No-clip updated for {Count} of {Total} player(s).", { Count: unChangedCount, Total: vecTargets.length });
	ReportAdminActivity(unClientIndex, Author, Result);

	return Result;
}

function ChangeGravity(unClientIndex, vecArguments) {
	const [strTarget, strMultiplier = "1"] = vecArguments;
	const dblParsedMultiplier = Number(strMultiplier);
	const flParsedMultiplier = Math.fround(dblParsedMultiplier);
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(strMultiplier) || !Number.isFinite(flParsedMultiplier)) {
		throw CommandFailure("InvalidInput", "Gravity must be a finite numeric multiplier.");
	}

	const flMultiplier = Math.max(0, flParsedMultiplier);
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected && !Player.Dead);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	let unChangedCount = 0;
	let unUnchangedCount = 0;

	for (const Target of vecTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.Dead || ((Player.Index !== unClientIndex) && !Player.FakeClient && HasPermission(Player.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			const flPreviousGravity = GetPlayerGravity(Player);
			if (flPreviousGravity === flMultiplier) {
				++unUnchangedCount;
				continue;
			}

			if (Number.isFinite(flPreviousGravity) && SetPlayerGravity(Player, flMultiplier) && (GetPlayerGravity(RequireCurrentPlayer(Target)) === flMultiplier)) {
				++unChangedCount;
				LogInfo(`Gravity applied CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID} Multiplier=${flMultiplier}.`);
			}
		} catch {
			// A failed write or an invalidated connection must not stop the batch.
		}
	}

	if (unChangedCount === 0) {
		if (unUnchangedCount === vecTargets.length) {
			return Phrase("NoChange", "Gravity was already set for all selected players.");
		}

		throw CommandFailure("NoEffectApplied", "Could not update gravity for any eligible target.");
	}

	const dblMultiplier = Math.max(0, dblParsedMultiplier);
	ReportAdminActivity(unClientIndex, Author, LabelValue("Gravity", `${dblMultiplier} × · ${unChangedCount}`, `Set gravity to ${dblMultiplier} for ${unChangedCount} player(s).`));

	return Phrase("ActionCount", "Gravity updated for {Count} of {Total} player(s).", { Count: unChangedCount, Total: vecTargets.length });
}

function IsBlindAvailable() {
	return (typeof Fade === "function") && (GetUserMessageIndex("Fade") >= 0);
}

function BlindPlayers(unClientIndex, vecArguments) {
	if (!IsBlindAvailable()) {
		throw CommandFailure("FadeUnavailable", "The game does not support the Fade user message.");
	}

	const [strTarget, strAlpha = "0"] = vecArguments;
	const nAlpha = Number(strAlpha);
	if (!/^[+-]?\d+$/.test(strAlpha) || !Number.isSafeInteger(nAlpha)) {
		throw CommandFailure("InvalidInput", "Blind opacity must be an integer.");
	}

	const unMaximumOpacity = 255;
	const unAlpha = Math.min(unMaximumOpacity, Math.max(0, nAlpha));
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Target) => Target.Connected && !Target.FakeClient && !Target.Dead);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	const Color = { Red: 0, Green: 0, Blue: 0, Alpha: unAlpha };
	const flFadeSeconds = g_unBlindFadeDurationUnits / (1 << SCREEN_FADE_FRACTION_BITS);
	const unFlags = (unAlpha === 0) ? (FADE_FLAGS.In | FADE_FLAGS.Purge) : (FADE_FLAGS.Out | FADE_FLAGS.StayOut);
	const FadeMessage = new Fade({ Color, Duration: flFadeSeconds, HoldTime: flFadeSeconds, Flags: unFlags });
	let unSubmittedCount = 0;

	for (const Target of vecTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.FakeClient || Player.Dead || ((Player.Index !== unClientIndex) && HasPermission(Player.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			if (FadeMessage.SendUserMessage(Player.Index)) {
				++unSubmittedCount;
				LogInfo(`Blind fade submitted CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID} Opacity=${unAlpha}.`);
			}
		} catch {
			// A failed send or an invalidated connection must not stop the batch.
		}
	}

	if (unSubmittedCount === 0) {
		throw CommandFailure("NoEffectApplied", "The game did not accept the screen fade.");
	}

	const strActivity = (unAlpha === 0) ? `Cleared blindness for ${unSubmittedCount} player(s).` : `Set blindness to opacity ${unAlpha} for ${unSubmittedCount} player(s).`;
	const strActivityKey = (unAlpha === 0) ? "ClearBlind" : "Blind";
	ReportAdminActivity(unClientIndex, Author, LabelValue(strActivityKey, `${Math.round(unAlpha / unMaximumOpacity * 100)}% · ${unSubmittedCount}`, strActivity));

	return Phrase("ActionCount", "Screen fade submitted for {Count} of {Total} player(s).", { Count: unSubmittedCount, Total: vecTargets.length });
}

function RegisterEffectsCommands() {
	g_BeaconRadius = CreateConVar("sjs_beacon_radius", "375", "Radius of the beacon's rings.", 0, 50, 1500);
	g_FreezeDuration = CreateConVar("sjs_freeze_duration", "10", "Default freeze and freezebomb duration in seconds.", 0, 1, g_unMaximumFreezeSeconds);

	DefineCommand("beacon", "slay", "<target> [0|1]", ToggleBeacons);
	DefineCommand("blind", "slay", "<target> [opacity]", BlindPlayers);
	DefineCommand("freeze", "slay", "<target> [seconds]", FreezePlayers);
	DefineCommand("gravity", "slay", "<target> [multiplier]", ChangeGravity);
	DefineCommand("noclip", "slay", "<target>", ToggleNoClip, false, "cheats");
}

module.exports = {
	StopBeacon,
	StopAllBeacons,
	StopFreeze,
	StopAllFreezes,
	TogglePlayerFreeze,
	FreezePlayers,
	IsBlindAvailable,
	RegisterEffectsCommands,
};
