"use strict";

const { HasPlayerPermission } = require("auth");
const { LogInfo } = require("core/logger");
const { CreateConVar, FindConVar } = require("cvars");
const { ExecuteServerCommand } = require("engines/server");
const { FindEntityDataMapField, GetEntityDataMap, GetEntityDataMapPropertyInteger, SetEntityDataMapPropertyInteger } = require("entities/datamaps");
const { GetUserIDFromIndex } = require("players/helpers");
const { SteamID } = require("steam");
const { DefineCommand, HasPermission, ReadChatText, Reply, RequireCurrentPlayer, RequireTargets, RequireUnsignedInteger } = require("./administration");
const { GetMessageAuthor, ReportAdminActivity } = require("./communication");
const { EmitFunSound, GetFunCommandAssets, TryFunEffect } = require("./fun-effects");
const { AllowsSQLIdentityPermission } = require("./sql-authorization");
const { CommandFailure, CommandUsage, FormatBanDuration, GetFailureMessage, JoinPhrases, LabelValue, Phrase, Translate } = require("./translations");

const g_unMaximumBanMinutes = 2_147_483_647;
const g_unMaximumSteamAccountID = 4_294_967_295;
const g_unMaximumSteam2AccountNumber = Math.floor(g_unMaximumSteamAccountID / 2);
const g_strHealthProperty = "m_iHealth";
const g_mapPendingBanReasons = new Map();
const g_unMaximumCustomReasonLength = 200;
let g_BurnDuration = null;

function RequireEngineCommand(strCommand) {
	if (!ExecuteServerCommand(strCommand)) {
		throw CommandFailure("CommandFailed", "The engine did not accept the command.");
	}
}

function RequireSteamBanSupport() {
	const LAN = FindConVar("sv_lan");
	if ((LAN.Exists === true) && (Number(LAN.Value) !== 0)) {
		throw CommandFailure("SteamBanLAN", "Steam ID bans are unavailable in LAN mode. Use an IPv4 ban instead.");
	}
}

function NormalizeSteamID(strValue) {
	const vecSteamID3 = /^\[U:([1-5]):(\d{1,10})\]$/i.exec(strValue ?? "");
	if (vecSteamID3) {
		const unAccountID = Number(vecSteamID3[2]);
		if ((unAccountID === 0) || (unAccountID > g_unMaximumSteamAccountID)) {
			return null;
		}

		return `STEAM_${vecSteamID3[1]}:${unAccountID % 2}:${Math.floor(unAccountID / 2)}`;
	}

	const vecMatch = /^STEAM_([0-5])[:_]([01])[:_](\d{1,10})$/i.exec(strValue ?? "");
	if (!vecMatch || (Number(vecMatch[3]) > g_unMaximumSteam2AccountNumber)) {
		return null;
	}

	return `STEAM_${vecMatch[1]}:${vecMatch[2]}:${Number(vecMatch[3])}`;
}

function HasOfflineBanImmunity(strSteamID) {
	const strPermission = "sourcejs.immunity";
	const SteamAccount = SteamID.Parse(strSteamID);
	const unSteamID64 = SteamAccount.ConvertSteamIDToUInt64();
	const vecIdentities = [strSteamID, SteamAccount.ConvertSteamIDToSteamID3(), unSteamID64.toString()];
	const vecPublicUniverse = /^STEAM_([01]):(.+)$/.exec(strSteamID);
	if (vecPublicUniverse) {
		const strAlternateUniverse = (vecPublicUniverse[1] === "0") ? "1" : "0";
		vecIdentities.push(`STEAM_${strAlternateUniverse}:${vecPublicUniverse[2]}`);
	}

	return vecIdentities.some((strIdentity) => HasPlayerPermission(strIdentity, strPermission)) || AllowsSQLIdentityPermission(unSteamID64, strPermission);
}

function RequireBanReason(vecReason) {
	const strReason = vecReason.join(" ");
	if ((strReason.length > g_unMaximumCustomReasonLength) || /[\x00-\x1F\x7F]/.test(strReason)) {
		throw CommandFailure("SingleLineRequired", `A ban reason must be a single line of up to ${g_unMaximumCustomReasonLength} characters.`);
	}

	return strReason;
}

function SubmitBanListChange(strCommand, strWriteCommand, Result) {
	RequireEngineCommand(strCommand);

	if (strWriteCommand && !ExecuteServerCommand(strWriteCommand)) {
		return JoinPhrases([Result, Phrase("BanWriteFailed", "The engine did not accept the ban-list write request.")]);
	}

	return Result;
}

function RequestBanKick(Target, strReason) {
	try {
		return RequireCurrentPlayer(Target).Kick(strReason || Translate(Target.Index, "Banned", "Banned from this server.")) === true;
	} catch {
		// The ban may already have disconnected the target before the separate kick request.
		return false;
	}
}

function NormalizeIPv4(strValue) {
	if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(strValue ?? "")) {
		return null;
	}

	const vecOctets = strValue.split(".").map(Number);
	return vecOctets.every((unOctet) => unOctet <= 255) ? vecOctets.join(".") : null;
}

function BanPlayer(unClientIndex, vecArguments, strReasonKey = undefined) {
	const [strTarget, strMinutes, ...vecReason] = vecArguments;
	const unMinutes = RequireUnsignedInteger(strMinutes, g_unMaximumBanMinutes, "Ban duration");
	const strReason = RequireBanReason(vecReason);
	RequireSteamBanSupport();

	const [Target] = RequireTargets(unClientIndex, strTarget);
	const CurrentPlayer = RequireCurrentPlayer(Target);
	const Author = GetMessageAuthor(unClientIndex);

	if (CurrentPlayer.FakeClient || !CurrentPlayer.Ban(unMinutes, false, false)) {
		throw CommandFailure("BanFailed", "Could not ban this player.");
	}

	const vecResults = [Phrase("BanSubmitted", "Ban submitted for {Target}.", { Target: Target.Name })];
	if ((unMinutes === 0) && !ExecuteServerCommand("writeid")) {
		vecResults.push(Phrase("BanWriteFailed", "The engine did not accept the ban-list write request."));
	}

	const strKickReason = (typeof strReasonKey === "string") ? Translate(Target.Index, strReasonKey, strReason) : strReason;
	const bKickConfirmed = RequestBanKick(Target, strKickReason);

	const strDuration = (unMinutes === 0) ? "permanently" : `for ${unMinutes} ${(unMinutes === 1) ? "minute" : "minutes"}`;
	ReportAdminActivity(unClientIndex, Author, LabelValue("Ban", (unIndex) => `${Target.Name} (${FormatBanDuration(unIndex, unMinutes)})`, `Submitted a ban for ${Target.Name} (${strDuration}).`));

	if (!bKickConfirmed) {
		vecResults.push(Phrase("KickUnconfirmed", "The kick was not confirmed."));
	}

	return JoinPhrases(vecResults);
}

function AwaitCustomBanReason(unClientIndex, unInitiatorUserID, Target, strMinutes) {
	Reply(unClientIndex, Phrase("EnterBanReason", "Type the ban reason in chat, or use /abortban to cancel."), true);
	g_mapPendingBanReasons.set(unClientIndex, { InitiatorUserID: unInitiatorUserID, TargetIndex: Target.Index, TargetUserID: Target.UserID, Minutes: strMinutes });
}

function HandleCustomBanReason(Invocation) {
	const unClientIndex = Invocation.Index;
	const Pending = g_mapPendingBanReasons.get(unClientIndex);
	if (!Pending) {
		return false;
	}

	if (GetUserIDFromIndex(unClientIndex) !== Pending.InitiatorUserID) {
		g_mapPendingBanReasons.delete(unClientIndex);
		return false;
	}

	const strReason = ReadChatText(Invocation);
	if (strReason.startsWith("!") || strReason.startsWith("/") || strReason.startsWith("@")) {
		return false;
	}

	if (!HasPermission(unClientIndex, "admin") || !HasPermission(unClientIndex, "ban")) {
		g_mapPendingBanReasons.delete(unClientIndex);
		Reply(unClientIndex, Phrase("BanPermissionLost", "Pending ban cancelled because you no longer have permission."), true);
		return true;
	}

	if (!strReason || (strReason.length > g_unMaximumCustomReasonLength) || /[\x00-\x1F\x7F]/.test(strReason)) {
		Reply(unClientIndex, Phrase("BanReasonLength", "Enter a ban reason of 1–{Maximum} characters, or use /abortban.", { Maximum: g_unMaximumCustomReasonLength }), true);
		return true;
	}

	g_mapPendingBanReasons.delete(unClientIndex);

	try {
		if (GetUserIDFromIndex(Pending.TargetIndex) !== Pending.TargetUserID) {
			throw CommandFailure("PlayerDisconnected", "The ban target is no longer connected.");
		}

		Reply(unClientIndex, BanPlayer(unClientIndex, [`#${Pending.TargetUserID}`, Pending.Minutes, strReason]), true);
	} catch (Failure) {
		Reply(unClientIndex, GetFailureMessage(Failure, Phrase("BanFailed", "The ban could not be applied.")), true);
	}

	return true;
}

function CancelPendingBanReason(unClientIndex) {
	return g_mapPendingBanReasons.delete(unClientIndex);
}

function AbortBan(unClientIndex) {
	return CancelPendingBanReason(unClientIndex) ? Phrase("BanCancelled", "Pending ban cancelled.") : Phrase("NoPendingBan", "No ban is waiting for a custom reason.");
}

function ClearPendingBanReasons() {
	g_mapPendingBanReasons.clear();
}

function HandleBanDisconnect(unClientIndex) {
	CancelPendingBanReason(unClientIndex);

	for (const [unInitiatorIndex, Pending] of g_mapPendingBanReasons) {
		if (Pending.TargetIndex === unClientIndex) {
			g_mapPendingBanReasons.delete(unInitiatorIndex);
		}
	}
}

function AddBan(unClientIndex, vecArguments) {
	const [strMinutes, strIdentity, ...vecReason] = vecArguments;
	const unMinutes = RequireUnsignedInteger(strMinutes, g_unMaximumBanMinutes, "Ban duration");
	const strSteamID = NormalizeSteamID(strIdentity);
	if (!strSteamID) {
		throw CommandFailure("InvalidInput", "Expected a Steam2 or Steam3 individual account ID.");
	}

	const strReason = RequireBanReason(vecReason);
	RequireSteamBanSupport();

	if (!HasPermission(unClientIndex, "targetimmune") && HasOfflineBanImmunity(strSteamID)) {
		throw CommandFailure("ImmuneTarget", "The target account is immune.");
	}

	const Result = SubmitBanListChange(`banid ${unMinutes} ${strSteamID}`, (unMinutes === 0) ? "writeid" : null, Phrase("BanSubmitted", "Ban submitted for {Target}.", { Target: strSteamID }));
	LogInfo(`Offline ban submitted SteamID=${strSteamID} Minutes=${unMinutes} ReasonProvided=${Boolean(strReason)}.`);

	return Result;
}

function BanIP(unClientIndex, vecArguments) {
	const [strTarget, strMinutes, ...vecReason] = vecArguments;
	if (strTarget === "0") {
		throw CommandFailure("InvalidInput", "Cannot ban the unspecified IPv4 address.");
	}

	const unMinutes = RequireUnsignedInteger(strMinutes, g_unMaximumBanMinutes, "Ban duration");
	const strReason = RequireBanReason(vecReason);
	let strAddress = NormalizeIPv4(strTarget);
	let Target = null;
	if (strAddress) {
		if (!HasPermission(unClientIndex, "rcon")) {
			throw CommandFailure("RequiresPermission", "Banning an arbitrary IP requires {Permission}.", { Permission: "sourcejs.rcon" });
		}
	} else {
		[Target] = RequireTargets(unClientIndex, strTarget);
		const CurrentPlayer = RequireCurrentPlayer(Target);
		strAddress = NormalizeIPv4(CurrentPlayer.RemoteAddress?.replace(/:\d+$/, ""));
		if (!strAddress || CurrentPlayer.FakeClient) {
			throw CommandFailure("InvalidInput", "This player does not have a usable IPv4 address.");
		}
	}

	if (strAddress === "0.0.0.0") {
		throw CommandFailure("InvalidInput", "Cannot ban the unspecified IPv4 address.");
	}

	const Result = SubmitBanListChange(`addip ${unMinutes} ${strAddress}`, (unMinutes === 0) ? "writeip" : null, Phrase("IPBanSubmitted", "IP ban submitted."));

	if (Target && !RequestBanKick(Target, strReason)) {
		return JoinPhrases([Result, Phrase("KickUnconfirmed", "The kick was not confirmed.")]);
	}

	return Result;
}

function UnbanPlayer(unClientIndex, vecArguments) {
	if (vecArguments.length !== 1) {
		throw CommandUsage("sjs_unban <Steam2 ID|Steam3 ID|IPv4>.");
	}

	const [strIdentity] = vecArguments;
	const strSteamID = NormalizeSteamID(strIdentity);
	if (strSteamID) {
		RequireSteamBanSupport();
		return SubmitBanListChange(`removeid ${strSteamID}`, "writeid", Phrase("UnbanSubmitted", "Unban submitted for {Target}.", { Target: strSteamID }));
	}

	const strAddress = NormalizeIPv4(strIdentity);
	if (!strAddress) {
		throw CommandFailure("InvalidInput", "Expected a Steam2 ID, Steam3 ID, or IPv4 address.");
	}

	return SubmitBanListChange(`removeip ${strAddress}`, "writeip", Phrase("IPUnbanSubmitted", "IP unban submitted."));
}

function KickPlayer(unClientIndex, vecArguments) {
	if (vecArguments.length === 0) {
		throw CommandUsage("sjs_kick <target> [reason].");
	}

	const [strTarget, ...vecReason] = vecArguments;
	const strReason = vecReason.join(" ");
	if (/[\x00-\x1F\x7F]/.test(strReason)) {
		throw CommandFailure("SingleLineRequired", "The kick reason must be a single line without control characters.");
	}

	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	const vecOtherTargets = vecTargets.filter((Target) => Target.Index !== unClientIndex);
	const Self = vecTargets.find((Target) => Target.Index === unClientIndex);
	if (Self) {
		vecOtherTargets.push(Self);
	}

	const vecKickedNames = [];

	for (const Target of vecOtherTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "kick")) {
			break;
		}

		try {
			const CurrentPlayer = RequireCurrentPlayer(Target);
			if ((Target.Index !== unClientIndex) && !CurrentPlayer.FakeClient && HasPermission(Target.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune")) {
				continue;
			}

			const strTargetName = CurrentPlayer.Name;
			if (CurrentPlayer.Kick(strReason || Translate(Target.Index, "Kicked", "Kicked by an administrator."))) {
				vecKickedNames.push(strTargetName);
				LogInfo(`Kick submitted CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID}.`);
			}
		} catch {
			// An earlier kick may have invalidated this target; continue with the remaining identities.
		}
	}

	if (vecKickedNames.length === 0) {
		throw CommandFailure("NoEffectApplied", "The kick was not accepted for any target.");
	}

	const Activity = (vecKickedNames.length === 1)
		? Phrase("KickSubmitted", "Kicked {Target}.", { Target: vecKickedNames[0] })
		: (unIndex) => {
			const strEnglish = `Kick submitted for ${vecKickedNames.length} of ${vecTargets.length} players.`;
			const strText = Translate(unIndex, "KicksSubmitted", "Kick submitted for {Count} of {Total} players.", { Count: vecKickedNames.length, Total: vecTargets.length });

			return (strText === strEnglish) ? `Kicked ${vecKickedNames.length} players.` : strText;
		};
	ReportAdminActivity(unClientIndex, Author, Activity);

	return (vecTargets.length === 1) ? Phrase("KickSubmitted", "Kick submitted for {Target}.", { Target: vecKickedNames[0] }) : Phrase("KicksSubmitted", "Kick submitted for {Count} of {Total} players.", { Count: vecKickedNames.length, Total: vecTargets.length });
}

function ApplyLivePlayerCommand(unClientIndex, vecTargets, strAction, strActionKey, Apply, bReportActivity = true) {
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	const vecAffectedNames = [];

	for (const Target of vecTargets) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if (Player.Dead || ((Target.Index !== unClientIndex) && !Player.FakeClient && HasPermission(Target.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune"))) {
				continue;
			}

			const strName = Player.Name;
			if (Apply(Player)) {
				vecAffectedNames.push(strName);
				LogInfo(`${strAction} CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID}.`);
			}
		} catch {
			// A failed action or an invalidated connection must not stop the batch.
		}
	}

	if (bReportActivity && (vecAffectedNames.length > 0)) {
		const strTarget = (vecAffectedNames.length === 1) ? vecAffectedNames[0] : `${vecAffectedNames.length} players`;
		ReportAdminActivity(unClientIndex, Author, LabelValue(strActionKey, (vecAffectedNames.length === 1) ? strTarget : vecAffectedNames.length, `${strAction} ${strTarget}.`));
	}

	return vecAffectedNames.length;
}

function SlayPlayer(unClientIndex, vecArguments, bReportActivity = true) {
	if (vecArguments.length !== 1) {
		throw CommandUsage("sjs_slay <target>.");
	}

	const vecTargets = RequireTargets(unClientIndex, vecArguments[0], true, true, (Player) => Player.Connected && !Player.Dead);
	const unSlayCount = ApplyLivePlayerCommand(unClientIndex, vecTargets, "Slay submitted for", "Slay", (Player) => Player.Slay(), bReportActivity);
	if (unSlayCount === 0) {
		throw CommandFailure("NoEffectApplied", "Could not slay any live target. Check the player-action GameData for this server.");
	}

	return Phrase("ActionCount", "Slay submitted for {Count} of {Total} player(s).", { Count: unSlayCount, Total: vecTargets.length });
}

function PlaySlapSound(Player, vecSounds) {
	if (vecSounds.length > 0) {
		const strSample = vecSounds[Math.floor(Math.random() * vecSounds.length)];
		TryFunEffect("slap sound", () => EmitFunSound(Player, Player.Origin, strSample));
	}
}

function GetSlapHorizontalImpulse() {
	const unMinimumImpulseMagnitude = 50;
	const unImpulseMagnitudeCount = 180;
	const unMagnitude = unMinimumImpulseMagnitude + Math.floor(Math.random() * unImpulseMagnitudeCount);

	return (Math.random() < 0.5) ? -unMagnitude : unMagnitude;
}

function SlaySlappedPlayer(Player) {
	const unFragFieldByteCount = 4;
	const strFragFieldName = GetFunCommandAssets().SlapFragField;
	let Field = null;
	let nPreviousFrags = null;

	if (strFragFieldName !== null) {
		TryFunEffect("read slap frags", () => {
			const DataMap = GetEntityDataMap(Player);
			Field = DataMap ? FindEntityDataMapField(DataMap, strFragFieldName) : null;
			if ((Field?.Type === "int") && (Field.SizeInBytes === unFragFieldByteCount) && (Field.ElementCount === 1)) {
				nPreviousFrags = GetEntityDataMapPropertyInteger(Player, Field.Path);
			}
		});
	}

	const unPlayerIndex = Player.Index;
	const unUserID = Player.UserID;

	if (!Player.Slay()) {
		return false;
	}

	if (Number.isInteger(nPreviousFrags) && (GetUserIDFromIndex(unPlayerIndex) === unUserID)) {
		TryFunEffect("restore slap frags", () => {
			const CurrentPlayer = RequireCurrentPlayer({ Index: unPlayerIndex, UserID: unUserID });

			return (GetEntityDataMapPropertyInteger(CurrentPlayer, Field.Path) === nPreviousFrags) || SetEntityDataMapPropertyInteger(CurrentPlayer, Field.Path, nPreviousFrags);
		});
	}

	return true;
}

function ApplyPlayerSlap(Player, unDamage, vecSounds = []) {
	const unMinimumVerticalImpulse = 100;
	const unVerticalImpulseCount = 200;
	const Target = { Index: Player.Index, UserID: Player.UserID };
	const Impulse = {
		X: GetSlapHorizontalImpulse(),
		Y: GetSlapHorizontalImpulse(),
		Z: unMinimumVerticalImpulse + Math.floor(Math.random() * unVerticalImpulseCount),
	};
	if (!Player.AddVelocity?.(Impulse)) {
		return false;
	}

	const CurrentPlayer = RequireCurrentPlayer(Target);
	if (CurrentPlayer.Dead) {
		return false;
	}

	const nPreviousHealth = CurrentPlayer.Health;
	if ((unDamage > 0) && (unDamage >= nPreviousHealth)) {
		PlaySlapSound(CurrentPlayer, vecSounds);
		return SlaySlappedPlayer(RequireCurrentPlayer(Target));
	}

	if (unDamage > 0) {
		const nExpectedHealth = nPreviousHealth - unDamage;
		if (!CurrentPlayer.SetEntityPropertyInteger?.(g_strHealthProperty, nExpectedHealth) || (RequireCurrentPlayer(Target).Health !== nExpectedHealth)) {
			return false;
		}
	}

	PlaySlapSound(RequireCurrentPlayer(Target), vecSounds);

	return true;
}

function SlapPlayer(unClientIndex, vecArguments) {
	if ((vecArguments.length < 1) || (vecArguments.length > 2)) {
		throw CommandUsage("sjs_slap <target> [damage].");
	}

	const [strTarget, strDamage = "0"] = vecArguments;
	const unMaximumDamage = 10_000;
	const unDamage = RequireUnsignedInteger(strDamage, unMaximumDamage, "Slap damage");
	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected && !Player.Dead);
	const vecSounds = GetFunCommandAssets().Slap;
	const unSlappedCount = ApplyLivePlayerCommand(unClientIndex, vecTargets, "Slapped", "Slap", (Player) => ApplyPlayerSlap(Player, unDamage, vecSounds));
	if (unSlappedCount === 0) {
		throw CommandFailure("NoEffectApplied", "Could not slap any live target. Check the player-action GameData for this server.");
	}

	return Phrase("ActionCount", "Slapped {Count} of {Total} player(s).", { Count: unSlappedCount, Total: vecTargets.length });
}

function RenamePlayer(unClientIndex, vecArguments) {
	const [strTarget, ...vecName] = vecArguments;
	const strRequestedName = vecName.join(" ");
	const strName = strRequestedName.trim();
	if ((vecName.length > 0) && (!strName || /[\x00-\x1F\x7F]/.test(strRequestedName))) {
		throw CommandFailure("InvalidInput", "Supply a non-empty name without control characters.");
	}

	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected);
	const unCallerUserID = (unClientIndex === 0) ? 0 : GetUserIDFromIndex(unClientIndex);
	const Author = GetMessageAuthor(unClientIndex);
	const vecRenamedPlayers = [];
	let unUnchangedCount = 0;

	for (const [unIndex, Target] of vecTargets.entries()) {
		if (((unClientIndex !== 0) && (GetUserIDFromIndex(unClientIndex) !== unCallerUserID)) || !HasPermission(unClientIndex, "slay")) {
			break;
		}

		try {
			const Player = RequireCurrentPlayer(Target);
			if ((Target.Index !== unClientIndex) && !Player.FakeClient && HasPermission(Target.Index, "immunity") && !HasPermission(unClientIndex, "targetimmune")) {
				continue;
			}

			const strPreviousName = Player.Name;
			const vecCharacters = Array.from(strPreviousName);
			const strNewName = strName ? ((vecTargets.length > 1) ? `${strName} ${unIndex + 1}` : strName) : vecCharacters.map(() => vecCharacters[Math.floor(Math.random() * vecCharacters.length)]).join("").trim();
			if (!strNewName || (strNewName === strPreviousName)) {
				++unUnchangedCount;
				continue;
			}

			if (Player.SetName(strNewName) && (RequireCurrentPlayer(Target).Name !== strPreviousName)) {
				vecRenamedPlayers.push(strPreviousName);
				LogInfo(`Rename applied CallerUserID=${unCallerUserID} TargetUserID=${Target.UserID}.`);
			}
		} catch {
			// A game callback can invalidate the current target without affecting the others.
		}
	}

	if (vecRenamedPlayers.length === 0) {
		if (unUnchangedCount === vecTargets.length) {
			return Phrase("NamesUnchanged", "No name changes were needed.");
		}

		throw CommandFailure("NoEffectApplied", "No player was renamed. The engine may not support server-side renaming or may have rejected the name.");
	}

	const strActivity = (vecRenamedPlayers.length === 1) ? `Renamed ${vecRenamedPlayers[0]}.` : `Renamed ${vecRenamedPlayers.length} players.`;
	ReportAdminActivity(unClientIndex, Author, LabelValue("Rename", (vecRenamedPlayers.length === 1) ? vecRenamedPlayers[0] : vecRenamedPlayers.length, strActivity));

	return Phrase("ActionCount", "Renamed {Count} of {Total} player(s).", { Count: vecRenamedPlayers.length, Total: vecTargets.length });
}

function GetBurnDuration() {
	return Number(g_BurnDuration.Value);
}

function BurnPlayer(unClientIndex, vecArguments, bReportActivity = true) {
	if ((vecArguments.length < 1) || (vecArguments.length > 2)) {
		throw CommandUsage("sjs_burn <target> [seconds].");
	}

	const [strTarget, strDuration] = vecArguments;
	const unMaximumDurationSeconds = 300;
	const flDuration = (strDuration === undefined) ? GetBurnDuration() : Number(strDuration);
	if (((strDuration !== undefined) && !/^\d+(?:\.\d+)?$/.test(strDuration)) || !Number.isFinite(flDuration) || (flDuration <= 0) || (flDuration > unMaximumDurationSeconds)) {
		throw CommandFailure("InvalidInput", `Burn duration must be greater than 0 and at most ${unMaximumDurationSeconds} seconds.`);
	}

	const vecTargets = RequireTargets(unClientIndex, strTarget, true, true, (Player) => Player.Connected && !Player.Dead);
	const Author = GetMessageAuthor(unClientIndex);
	const unBurnedCount = ApplyLivePlayerCommand(unClientIndex, vecTargets, "Burn submitted for", "Ignite", (Player) => Player.Ignite?.(flDuration), false);
	if (unBurnedCount === 0) {
		throw CommandFailure("NoEffectApplied", "Could not ignite any live target. Check the player-action GameData for this server.");
	}

	if (bReportActivity) {
		ReportAdminActivity(unClientIndex, Author, LabelValue("Ignite", (unIndex) => `${unBurnedCount} · ${Translate(unIndex, "Seconds", "{Count} s", { Count: flDuration })}`, `Ignited ${unBurnedCount} player(s) for ${flDuration} seconds.`));
	}

	return Phrase("ActionCount", "Burn submitted for {Count} of {Total} player(s).", { Count: unBurnedCount, Total: vecTargets.length });
}

function RegisterModerationCommands() {
	g_BurnDuration = CreateConVar("sjs_burn_duration", "20", "Default burn and firebomb duration in seconds.", 0, 0.5, 20);

	DefineCommand("ban", "ban", "<target> <minutes|0> [reason]", BanPlayer);
	DefineCommand("abortban", "ban", "", AbortBan);
	DefineCommand("addban", "rcon", "<minutes|0> <Steam2 ID|Steam3 ID> [reason]", AddBan);
	DefineCommand("banip", "ban", "<target|IPv4> <minutes|0> [reason]", BanIP);
	DefineCommand("unban", "unban", "<Steam2 ID|Steam3 ID|IPv4>", UnbanPlayer);
	DefineCommand("slay", "slay", "<target>", (unClientIndex, vecArguments) => SlayPlayer(unClientIndex, vecArguments));
	DefineCommand("slap", "slay", "<target> [damage]", SlapPlayer);
	DefineCommand("rename", "slay", "<target> [new name]", RenamePlayer);
	DefineCommand("burn", "slay", "<target> [seconds]", BurnPlayer);
}

module.exports = {
	NormalizeSteamID,
	BanPlayer,
	AwaitCustomBanReason,
	HandleCustomBanReason,
	CancelPendingBanReason,
	ClearPendingBanReasons,
	HandleBanDisconnect,
	AddBan,
	KickPlayer,
	SlayPlayer,
	ApplyPlayerSlap,
	GetBurnDuration,
	BurnPlayer,
	RegisterModerationCommands,
};
