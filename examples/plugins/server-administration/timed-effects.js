"use strict";

const { CreateConVar } = require("cvars");
const { GetAllPlayers } = require("filters/players");
const { RepeatingTickTask } = require("listeners/tick");
const { FADE_FLAGS, Fade, HUDTextMessage, SCREEN_FADE_FRACTION_BITS } = require("messages");
const { GetUserIDFromIndex } = require("players/helpers");
const { DefineCommand, RequireCurrentPlayer, RequireTargets, RequireUnsignedInteger } = require("./administration");
const { GetMessageAuthor, ReportAdminActivity, SendLocalizedMessage } = require("./communication");
const { TogglePlayerFreeze } = require("./effects");
const { EmitFunSound, GetFunCommandAssets, GrayRingColor, ReadEyePosition, SendFireBombRings, SendFreezeBombBeam, SendFunExplosion, SendFunRings, TryFunEffect, WhiteRingColor } = require("./fun-effects");
const { ApplyPlayerSlap, GetBurnDuration } = require("./moderation");
const { ApplyPlayerTint, ReleasePlayerTint } = require("./player-tint");
const { CommandFailure, CommandUsage, FormatEffectResult, Translate } = require("./translations");

const g_mapPlayerEffects = new Map();
const g_unDrugPulseFadeUnits = 255;
const g_unDrugClearFadeUnits = 1_536;
const g_unDrugOpacity = 128;
const g_vecDrugRollDegrees = [0, 5, 10, 15, 20, 25, 20, 15, 10, 5, 0, -5, -10, -15, -20, -25, -20, -15, -10, -5];
const g_BombMode = Object.freeze({ CarrierOnly: 0, Teammates: 1, AllPlayers: 2 });
const g_unTimedEffectTickSeconds = 1;

function StorePlayerEffect(unPlayerIndex, strEffectName, Effect) {
	const mapEffects = g_mapPlayerEffects.get(unPlayerIndex) ?? new Map();
	mapEffects.set(strEffectName, Effect);
	g_mapPlayerEffects.set(unPlayerIndex, mapEffects);
}

function GetPlayerEffect(unPlayerIndex, strEffectName) {
	return g_mapPlayerEffects.get(unPlayerIndex)?.get(strEffectName);
}

function StopPlayerEffect(unPlayerIndex, strEffectName, bRestorePlayer = true) {
	const mapEffects = g_mapPlayerEffects.get(unPlayerIndex);
	const Effect = mapEffects?.get(strEffectName);
	if (!Effect) {
		return false;
	}

	mapEffects.delete(strEffectName);
	if (mapEffects.size === 0) {
		g_mapPlayerEffects.delete(unPlayerIndex);
	}

	Effect.Stop(bRestorePlayer);

	return true;
}

function FindCurrentPlayerEffect(Target, strEffectName) {
	const Effect = GetPlayerEffect(Target.Index, strEffectName);
	if (Effect && (Effect.UserID !== Target.UserID)) {
		StopPlayerEffect(Target.Index, strEffectName, false);
		return undefined;
	}

	return Effect;
}

function StopTimedPlayerEffects(unPlayerIndex, bRestorePlayer = true) {
	const mapEffects = g_mapPlayerEffects.get(unPlayerIndex);
	if (!mapEffects) {
		return;
	}

	const vecFailures = [];

	for (const strEffectName of mapEffects.keys()) {
		try {
			StopPlayerEffect(unPlayerIndex, strEffectName, bRestorePlayer);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, `Could not clear all timed effects for player ${unPlayerIndex}.`);
	}
}

function StopAllTimedEffects() {
	const vecFailures = [];

	for (const unPlayerIndex of g_mapPlayerEffects.keys()) {
		try {
			StopTimedPlayerEffects(unPlayerIndex);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Could not clear all timed player effects.");
	}
}

function ForEachNearbyBombTarget(Carrier, Position, flRadius, nMode, vecPlayers, GetPosition, Apply) {
	if (!Number.isFinite(flRadius) || (flRadius <= 0) || ((nMode !== g_BombMode.Teammates) && (nMode !== g_BombMode.AllPlayers))) {
		return;
	}

	for (const Target of vecPlayers) {
		if ((Target.Index === Carrier.Index) || !Target.Connected || Target.Dead || ((nMode === g_BombMode.Teammates) && (Target.TeamNumber !== Carrier.Team))) {
			continue;
		}

		TryFunEffect("secondary bomb target", () => {
			if (GetUserIDFromIndex(Target.Index) !== Target.UserID) {
				return;
			}

			const OtherPlayer = RequireCurrentPlayer(Target);
			if (OtherPlayer.Dead || ((nMode === g_BombMode.Teammates) && (OtherPlayer.Team !== Carrier.Team))) {
				return;
			}

			const OtherPosition = GetPosition(OtherPlayer);
			const flDistance = Math.hypot(OtherPosition.X - Position.X, OtherPosition.Y - Position.Y, OtherPosition.Z - Position.Z);
			if ((flDistance <= flRadius) && (GetUserIDFromIndex(Target.Index) === Target.UserID) && !OtherPlayer.Dead) {
				Apply({ Player: OtherPlayer, Target, Position: OtherPosition, Fraction: 1 - (flDistance / flRadius) });
			}
		});
	}
}

function DetonateTimeBomb(Player, Assets, vecPlayers, vecRecipients, flRadius, nMode) {
	const unMaximumBlastDamage = 220;
	const Carrier = { Index: Player.Index, Team: Player.Team };
	const Position = ReadEyePosition(Player);

	SendFunExplosion(Assets, Position, Math.trunc(flRadius), vecRecipients);
	EmitFunSound(Player, Position, Assets.Boom);
	TryFunEffect("timebomb carrier slay", () => Player.Slay());

	ForEachNearbyBombTarget(Carrier, Position, flRadius, nMode, vecPlayers, ReadEyePosition, ({ Player: OtherPlayer, Position: OtherPosition, Fraction: flFraction }) => {
		const unDamage = Math.floor(unMaximumBlastDamage * flFraction);
		TryFunEffect("timebomb blast slap", () => ApplyPlayerSlap(OtherPlayer, unDamage));
		SendFunExplosion(Assets, OtherPosition, 1, vecRecipients, true);
	});
}

function StartBomb(Target, Bomb) {
	const unPulseRadiusDivisor = 3;
	const Assets = GetFunCommandAssets();
	const unDuration = Math.trunc(Number(Bomb.Ticks.Value));
	if (!Number.isSafeInteger(unDuration) || (unDuration <= 0)) {
		throw CommandFailure("InvalidFuse", "The {Effect} fuse must be a positive integer.", { Effect: Bomb.Name });
	}

	let unSecondsLeft = unDuration;
	const TintOwner = {};

	function UpdateBomb() {
		if (GetPlayerEffect(Target.Index, Bomb.Name) !== Effect) {
			return;
		}

		if (GetUserIDFromIndex(Target.Index) !== Target.UserID) {
			StopPlayerEffect(Target.Index, Bomb.Name, false);
			return;
		}

		const Player = RequireCurrentPlayer(Target);
		if (Player.Dead) {
			StopPlayerEffect(Target.Index, Bomb.Name);
			return;
		}

		--unSecondsLeft;

		const vecPlayers = GetAllPlayers().filter((Recipient) => Recipient.Connected);
		const vecRecipients = vecPlayers.map((Recipient) => Recipient.Index);
		const flRadius = Number(Bomb.Radius.Value);
		if (unSecondsLeft === 0) {
			StopPlayerEffect(Target.Index, Bomb.Name);
			Bomb.Detonate(Player, Assets, vecPlayers, vecRecipients, flRadius, Math.trunc(Number(Bomb.Mode.Value)));
			return;
		}

		EmitFunSound(Player, ReadEyePosition(Player), (unSecondsLeft === 1) ? Assets.Final : Assets.Beep);
		const flTintFraction = (unSecondsLeft === 1) ? 0 : (unSecondsLeft / unDuration);
		TryFunEffect(`${Bomb.Name} tint`, () => ApplyPlayerTint(Player, TintOwner, Bomb.GetTint(flTintFraction)));

		const vecHumanRecipients = vecPlayers.filter((Recipient) => !Recipient.FakeClient).map((Recipient) => Recipient.Index);
		if (vecHumanRecipients.length > 0) {
			const strFallback = (unSecondsLeft === 1) ? "{Player} will explode in {Seconds} second!" : "{Player} will explode in {Seconds} seconds!";
			TryFunEffect(`${Bomb.Name} center text`, () => SendLocalizedMessage(vecHumanRecipients, (unIndex) => Translate(unIndex, "BombCountdown", strFallback, { Player: Player.Name, Seconds: unSecondsLeft }), (strText) => new HUDTextMessage(strText)));
		}

		SendFunRings(Assets, Player.Origin, flRadius / unPulseRadiusDivisor, vecRecipients, GrayRingColor, WhiteRingColor);
	}

	const Task = new RepeatingTickTask(UpdateBomb, [], true);
	const Effect = {
		UserID: Target.UserID,
		Stop(bRestorePlayer) {
			try {
				Task.DisposeRepeatingTickTask();
			} finally {
				TryFunEffect(`restore ${Bomb.Name} tint`, () => ReleasePlayerTint(Target.Index, Target.UserID, TintOwner, bRestorePlayer));
			}
		},
	};

	if (!Task.StartRepeatingTickTask(g_unTimedEffectTickSeconds)) {
		throw CommandFailure("TimerFailed", "Could not start the {Effect} timer.", { Effect: Bomb.Name });
	}

	StorePlayerEffect(Target.Index, Bomb.Name, Effect);
}

function ToggleBombs(Bomb, unClientIndex, vecArguments) {
	if ((vecArguments.length < 1) || (vecArguments.length > 2)) {
		throw CommandUsage(`sjs_${Bomb.Name} <target> [0|1].`);
	}

	const [strTarget, strMode] = vecArguments;
	if ((strMode !== undefined) && (strMode !== "0") && (strMode !== "1")) {
		throw CommandFailure("BombMode", "Use 0 to cancel or 1 to enable. Set {Setting} to change the fuse.", { Setting: `sjs_${Bomb.Name}_ticks` });
	}

	const bToggle = strMode === undefined;
	const bEnable = bToggle || (strMode === "1");
	const Author = GetMessageAuthor(unClientIndex);
	let unStartedCount = 0;
	let unStoppedCount = 0;

	for (const Target of RequireTargets(unClientIndex, strTarget, true, true, (Target) => Target.Connected && !Target.Dead)) {
		if (FindCurrentPlayerEffect(Target, Bomb.Name)) {
			if (bToggle || !bEnable) {
				StopPlayerEffect(Target.Index, Bomb.Name);
				++unStoppedCount;
			}

			continue;
		}

		if (bEnable && !RequireCurrentPlayer(Target).Dead) {
			StartBomb(Target, Bomb);
			++unStartedCount;
		}
	}

	const Result = FormatEffectResult(Bomb.EffectKey, Bomb.Name, unStartedCount, unStoppedCount);
	if ((unStartedCount > 0) || (unStoppedCount > 0)) {
		ReportAdminActivity(unClientIndex, Author, Result);
	}

	return Result;
}

function RegisterBomb(strName, strEffectKey, GetTint, Detonate) {
	const unMinimumFuseSeconds = 5;
	const unMaximumFuseSeconds = 120;
	const unMinimumBlastRadius = 50;
	const unMaximumBlastRadius = 3_000;
	const Bomb = {
		Name: strName,
		EffectKey: strEffectKey,
		Ticks: CreateConVar(`sjs_${strName}_ticks`, "10", `${strName} fuse in seconds.`, 0, unMinimumFuseSeconds, unMaximumFuseSeconds),
		Radius: CreateConVar(`sjs_${strName}_radius`, "600", `${strName} blast radius.`, 0, unMinimumBlastRadius, unMaximumBlastRadius),
		Mode: CreateConVar(`sjs_${strName}_mode`, "0", `${strName} targets: 0 = target, 1 = teammates, 2 = everyone.`, 0, g_BombMode.CarrierOnly, g_BombMode.AllPlayers),
		GetTint,
		Detonate,
	};

	DefineCommand(strName, "slay", "<target> [0|1]", (unClientIndex, vecArguments) => ToggleBombs(Bomb, unClientIndex, vecArguments));
}

function SendDrugFade(unPlayerIndex, Color, unFadeUnits, unFlags) {
	const flFadeSeconds = unFadeUnits / (1 << SCREEN_FADE_FRACTION_BITS);
	const Message = new Fade({ Color, Duration: flFadeSeconds, HoldTime: flFadeSeconds, Flags: unFlags });

	return Message.SendUserMessage(unPlayerIndex);
}

function RandomColorChannel() {
	const unColorChannelValueCount = 256;

	return Math.floor(Math.random() * unColorChannelValueCount);
}

function SetDrugRoll(Player, flRollDegrees) {
	const Angles = Player.GetEyeAngles?.();

	return !!Angles && (Player.Teleport?.(null, { ...Angles, Roll: flRollDegrees }, null) === true);
}

function StartDrug(Target) {
	const unPlayerIndex = Target.Index;
	const unUserID = Target.UserID;
	let bFadeSubmitted = false;
	let bRollSubmitted = false;
	let bTryEyeRoll = true;

	function UpdateDrug() {
		if (GetPlayerEffect(unPlayerIndex, "drug") !== Effect) {
			return;
		}

		if (GetUserIDFromIndex(unPlayerIndex) !== unUserID) {
			StopPlayerEffect(unPlayerIndex, "drug", false);
			return;
		}

		const Player = RequireCurrentPlayer(Target);
		if (Player.Dead) {
			StopPlayerEffect(unPlayerIndex, "drug");
			return;
		}

		if (bTryEyeRoll) {
			bTryEyeRoll = false;
			TryFunEffect("drug eye roll", () => {
				const flRollDegrees = g_vecDrugRollDegrees[Math.floor(Math.random() * g_vecDrugRollDegrees.length)];
				const bSubmitted = SetDrugRoll(Player, flRollDegrees);
				bTryEyeRoll = bSubmitted;
				bRollSubmitted ||= bSubmitted;

				return bSubmitted;
			});
		}

		const Color = { Red: RandomColorChannel(), Green: RandomColorChannel(), Blue: RandomColorChannel(), Alpha: g_unDrugOpacity };
		TryFunEffect("drug fade", () => {
			const bSent = SendDrugFade(unPlayerIndex, Color, g_unDrugPulseFadeUnits, FADE_FLAGS.Out);
			bFadeSubmitted ||= bSent;

			return bSent;
		});
	}

	function RestoreDrugEffects(bRestorePlayer) {
		if (!bRestorePlayer || (GetUserIDFromIndex(unPlayerIndex) !== unUserID)) {
			return;
		}

		if (bRollSubmitted) {
			TryFunEffect("clear drug eye roll", () => SetDrugRoll(RequireCurrentPlayer(Target), 0));
		}

		if (bFadeSubmitted) {
			const ClearColor = { Red: 0, Green: 0, Blue: 0, Alpha: 0 };
			TryFunEffect("clear drug fade", () => SendDrugFade(unPlayerIndex, ClearColor, g_unDrugClearFadeUnits, FADE_FLAGS.In | FADE_FLAGS.Purge));
		}
	}

	const Task = new RepeatingTickTask(UpdateDrug, [], true);
	const Effect = {
		UserID: unUserID,
		Stop(bRestorePlayer) {
			try {
				Task.DisposeRepeatingTickTask();
			} finally {
				RestoreDrugEffects(bRestorePlayer);
			}
		},
	};

	if (!Task.StartRepeatingTickTask(g_unTimedEffectTickSeconds)) {
		throw CommandFailure("TimerFailed", "Could not start the {Effect} timer.", { Effect: "drug" });
	}

	StorePlayerEffect(unPlayerIndex, "drug", Effect);
}

function ToggleDrug(unClientIndex, vecArguments) {
	const unEnableMode = 1;
	if ((typeof Fade !== "function") || !Number.isInteger(SCREEN_FADE_FRACTION_BITS)) {
		throw CommandFailure("FadeUnavailable", "This game does not expose screen fades.");
	}

	const [strTarget, strMode] = vecArguments;
	const bToggle = strMode === undefined;
	const bEnable = bToggle || (RequireUnsignedInteger(strMode, unEnableMode, "Drug mode") === unEnableMode);
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Target) => Target.Connected && !Target.FakeClient && !Target.Dead);
	let unStartedCount = 0;
	let unStoppedCount = 0;

	for (const Target of vecTargets) {
		if (FindCurrentPlayerEffect(Target, "drug")) {
			if (bToggle || !bEnable) {
				StopPlayerEffect(Target.Index, "drug");
				++unStoppedCount;
			}

			continue;
		}

		if (!bEnable || RequireCurrentPlayer(Target).Dead) {
			continue;
		}

		StartDrug(Target);
		++unStartedCount;
	}

	const Result = FormatEffectResult("DrugEffect", "drug", unStartedCount, unStoppedCount);
	if ((unStartedCount > 0) || (unStoppedCount > 0)) {
		ReportAdminActivity(unClientIndex, GetMessageAuthor(unClientIndex), Result);
	}

	return Result;
}

function DetonateFireBomb(Player, Assets, vecPlayers, vecRecipients, flRadius, nMode) {
	const flExplosionScale = 0.1;
	const Carrier = { Index: Player.Index, Team: Player.Team };
	const Position = ReadEyePosition(Player);

	SendFunExplosion(Assets, Position, Math.trunc(flRadius), vecRecipients, false, flExplosionScale);
	const BlastOrigin = SendFireBombRings(Assets, Player.Origin, Position, flRadius, vecRecipients);
	EmitFunSound(Player, BlastOrigin, Assets.Boom);

	const flDuration = GetBurnDuration();
	TryFunEffect("firebomb ignition", () => Player.Ignite?.(flDuration) ?? false);

	ForEachNearbyBombTarget(Carrier, BlastOrigin, flRadius, nMode, vecPlayers, (OtherPlayer) => OtherPlayer.Origin, ({ Player: OtherPlayer, Fraction: flFraction }) => {
		if (flFraction > 0) {
			TryFunEffect("firebomb secondary ignition", () => OtherPlayer.Ignite?.(flDuration * flFraction) ?? false);
		}
	});
}

function DetonateFreezeBomb(Player, Assets, vecPlayers, vecRecipients, flRadius, nMode) {
	const Carrier = { Index: Player.Index, Team: Player.Team };
	const Position = ReadEyePosition(Player);

	SendFunExplosion(Assets, Position, Math.trunc(flRadius), vecRecipients);
	EmitFunSound(Player, Position, Assets.Boom);

	TryFunEffect("freezebomb freeze", () => TogglePlayerFreeze(Player));

	ForEachNearbyBombTarget(Carrier, Position, flRadius, nMode, vecPlayers, ReadEyePosition, ({ Target, Position: OtherPosition }) => {
		SendFreezeBombBeam(Assets, Position, OtherPosition, vecRecipients);
		TryFunEffect("freezebomb secondary freeze", () => TogglePlayerFreeze(Target));
	});
}

function RegisterTimedEffectCommands() {
	const unMaximumColorChannel = 255;
	const unTimeBombGreen = 128;
	RegisterBomb("timebomb", "TimeBombEffect", (flFraction) => ({ Red: unMaximumColorChannel, Green: unTimeBombGreen, Blue: Math.floor(unTimeBombGreen * flFraction), Alpha: unMaximumColorChannel }), DetonateTimeBomb);
	RegisterBomb("firebomb", "FireBombEffect", (flFraction) => {
		const unChannel = Math.floor(unMaximumColorChannel * flFraction);

		return { Red: unMaximumColorChannel, Green: unChannel, Blue: unChannel, Alpha: unMaximumColorChannel };
	}, DetonateFireBomb);

	RegisterBomb("freezebomb", "FreezeBombEffect", (flFraction) => {
		const unChannel = Math.floor(unMaximumColorChannel * flFraction);

		return { Red: unChannel, Green: unChannel, Blue: unMaximumColorChannel, Alpha: unMaximumColorChannel };
	}, DetonateFreezeBomb);

	DefineCommand("drug", "slay", "<target> [0|1]", ToggleDrug);
}

module.exports = { StopTimedPlayerEffects, StopAllTimedEffects, RegisterTimedEffectCommands };
