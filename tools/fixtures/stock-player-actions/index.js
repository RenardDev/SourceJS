"use strict";

// This fixture quits the disposable server after exercising the runtime.
const { SQLBackend } = require("auth/backends/sql");
const { RegisterCommand } = require("commands/server");
const { LogError, LogInfo } = require("core/logger");
const { ExecuteServerCommand } = require("engines/server");
const { MoveType } = require("entities/constants");
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyColor,
	GetEntityDataMapPropertyEntity,
	GetEntityDataMapPropertyFloat,
	GetEntityDataMapPropertyInteger,
	GetEntityDataMapPropertyUnsignedCharacter,
	GetEntityDataMapPropertyVector,
	SetEntityDataMapPropertyInteger,
} = require("entities/datamaps");
const { RegisterEventListener, UnregisterEventListener } = require("events");
const { GetAllPlayers } = require("filters/players");
const { GetGlobalVariables } = require("globals");
const { GetModule } = require("internal/runtime");
const { RegisterServerActivateListener } = require("listeners");
const { EmitTickEvent, RegisterTickListener, TickDelay, UnregisterTickListener } = require("listeners/tick");
const { AUTH_CONFIG_ROOT } = require("paths");
const { CreateStorage, ROOT } = require("settings/storage");
const { Connect, Receive } = require("socket");
const { SetDefaultLanguage, GetLanguage } = require("translations");
const { CreateTranslationCatalog } = require("translations/catalog");

const { GetPlayer } = GetModule("players");
const g_AsyncOptions = Object.freeze({ Blocking: false });
let g_bClockStarted = false;

function RequireTest(bCondition, strDescription) {
	if (!bCondition) {
		throw new Error(strDescription);
	}
}

function FailTest(Failure) {
	LogError(`Stock player actions test failed: ${Failure?.stack ?? Failure}`);
	ExecuteServerCommand("quit");
}

function After(flSeconds, Callback) {
	return new TickDelay(flSeconds, () => {
		try {
			Callback();
		} catch (Failure) {
			FailTest(Failure);
		}
	}, [], true);
}

function AwaitRequest(Submit) {
	return new Promise((Resolve, Reject) => {
		Submit((Failure, Result) => {
			if (Failure !== null) {
				Reject(Failure);
				return;
			}

			Resolve(Result);
		});
	});
}

async function VerifySQLAdministration() {
	const Backend = new SQLBackend({ DatabasePath: `${AUTH_CONFIG_ROOT}/StockPlayerActions.sqlite3` });
	const strGroupName = "StockActionFixture";
	const strPlayerID = "76561197960265729";
	try {
		await AwaitRequest((Callback) => Backend.CreateAuthorizationObject(strGroupName, "Parent", g_AsyncOptions, Callback));
		await AwaitRequest((Callback) => Backend.AddParentPermission(strGroupName, "sourcejs.kick", -1, g_AsyncOptions, Callback));
		await AwaitRequest((Callback) => Backend.ReplacePlayerParents(strPlayerID, [strGroupName], g_AsyncOptions, Callback));
		const State = await AwaitRequest((Callback) => Backend.ReadState(g_AsyncOptions, Callback));
		RequireTest(State.Players[strPlayerID]?.Parents.includes(strGroupName), "SQL group assignment did not persist.");
		RequireTest(State.Parents[strGroupName]?.Permissions.includes("sourcejs.kick"), "SQL group grant did not persist.");
		await AwaitRequest((Callback) => Backend.DeleteAuthorizationObject(strGroupName, "Parent", g_AsyncOptions, Callback));
		const UpdatedState = await AwaitRequest((Callback) => Backend.ReadState(g_AsyncOptions, Callback));
		RequireTest(!Object.hasOwn(UpdatedState.Parents, strGroupName) && (UpdatedState.Players[strPlayerID]?.Parents.length === 0), "SQL group removal did not revoke membership.");
		await AwaitRequest((Callback) => Backend.DeleteAuthorizationObject(strPlayerID, "Player", g_AsyncOptions, Callback));
	} finally {
		await AwaitRequest((Callback) => Backend.Unload(g_AsyncOptions, Callback));
	}
}

async function VerifyPlayerPreferences() {
	const StorageOptions = { DatabasePath: `${ROOT}/StockPlayerActions.sqlite3` };
	const strPlayerID = "STEAM_1:1:0";
	const Storage = CreateStorage("StockPlayerActions", StorageOptions);
	try {
		await AwaitRequest((Callback) => Storage.SetSetting(strPlayerID, "AdminSounds", false, g_AsyncOptions, Callback));
	} finally {
		await AwaitRequest((Callback) => Storage.Close(g_AsyncOptions, Callback));
	}

	const ReopenedStorage = CreateStorage("StockPlayerActions", StorageOptions);
	try {
		const Setting = await AwaitRequest((Callback) => ReopenedStorage.GetSetting(strPlayerID, "AdminSounds", true, g_AsyncOptions, Callback));
		RequireTest(Setting === false, "Sound opt-out was lost when reopening SQLite.");
		await AwaitRequest((Callback) => ReopenedStorage.DeleteSetting(strPlayerID, "AdminSounds", g_AsyncOptions, Callback));
	} finally {
		await AwaitRequest((Callback) => ReopenedStorage.Close(g_AsyncOptions, Callback));
	}
}

async function FinishTest() {
	await VerifySQLAdministration();
	await VerifyPlayerPreferences();
	LogInfo("Stock player actions test passed: noclip, freeze, restore, eye roll, additive velocity, slap damage and score preservation, burn lifetime, freezebomb, firebomb and timebomb area effects, SQL administration, and player preferences.");
	ExecuteServerCommand("quit");
}

function ReadMoveType(CurrentPlayer) {
	const Field = FindEntityDataMapField(GetEntityDataMap(CurrentPlayer), "m_MoveType");
	RequireTest(Field?.SizeInBytes === 1, "Expected a byte-wide movement field.");

	return GetEntityDataMapPropertyUnsignedCharacter(CurrentPlayer, Field.Path);
}

function GetEyeLocation(Player) {
	const Origin = Player.Origin;
	const ViewOffset = GetEntityDataMapPropertyVector(Player, "m_vecViewOffset");
	RequireTest(ViewOffset && (ViewOffset.Z > 0), "Expected a valid player eye offset.");

	return { X: Origin.X + ViewOffset.X, Y: Origin.Y + ViewOffset.Y, Z: Origin.Z + ViewOffset.Z };
}

function SnapshotRenderColor(Player) {
	const Color = GetEntityDataMapPropertyColor(Player, "m_clrRender");
	RequireTest(Color, "Expected a readable player render color.");

	return { Red: Color.Red, Green: Color.Green, Blue: Color.Blue, Alpha: Color.Alpha };
}

function TestFreezeBomb(unExcludedUserID, Next, unAttempts = 4) {
	const vecLiveBots = GetAllPlayers().filter((Player) => Player.Connected && Player.FakeClient && !Player.Dead && (Player.UserID !== unExcludedUserID));
	const Carrier = vecLiveBots[0];
	const Teammate = Carrier && vecLiveBots.find((Player) => (Player.Index !== Carrier.Index) && (Player.TeamNumber === Carrier.TeamNumber));
	if (!Teammate) {
		RequireTest(unAttempts > 0, "The server did not create two live teammates for freezebomb.");
		ExecuteServerCommand("sb_add");
		After(1, () => TestFreezeBomb(unExcludedUserID, Next, unAttempts - 1));
		return;
	}

	const unFuse = 5;
	const unFreezeDuration = 2;
	const unBlastRadius = 3_000;
	const flFreezeSettlingSeconds = 0.6;
	const flThawSettlingSeconds = 1.2;
	const vecTargets = [Carrier, Teammate].map(({ Index: unPlayerIndex, UserID: unUserID }) => {
		const Player = GetPlayer(unPlayerIndex);
		const unMovementType = ReadMoveType(Player);
		RequireTest(unMovementType !== MoveType.None, "Freezebomb targets must be able to move before the blast.");

		return { Index: unPlayerIndex, UserID: unUserID, MovementType: unMovementType, Color: SnapshotRenderColor(Player) };
	});

	ExecuteServerCommand("sjs_cvar sb_stop 1");
	ExecuteServerCommand(`sjs_cvar sjs_freezebomb_ticks ${unFuse}`);
	ExecuteServerCommand(`sjs_cvar sjs_freezebomb_radius ${unBlastRadius}`);
	ExecuteServerCommand("sjs_cvar sjs_freezebomb_mode 1");
	ExecuteServerCommand(`sjs_cvar sjs_freeze_duration ${unFreezeDuration}`);
	ExecuteServerCommand(`sjs_freezebomb #${Carrier.UserID} 1`);
	After(unFuse + flFreezeSettlingSeconds, () => {
		for (const Target of vecTargets) {
			const Player = GetPlayer(Target.Index);
			RequireTest((Player?.UserID === Target.UserID) && !Player.Dead, "Expected the same live freezebomb target.");
			RequireTest(ReadMoveType(Player) === MoveType.None, `Freezebomb did not freeze UserID=${Target.UserID}.`);
			const Color = SnapshotRenderColor(Player);
			RequireTest((Color.Red === 0) && (Color.Green === 128) && (Color.Blue === 255), `Freezebomb did not apply the freeze tint to UserID=${Target.UserID}.`);
		}
	});
	After(unFuse + unFreezeDuration + flThawSettlingSeconds, () => {
		for (const Target of vecTargets) {
			const Player = GetPlayer(Target.Index);
			RequireTest((Player?.UserID === Target.UserID) && !Player.Dead, "Expected the same live freezebomb target after thaw.");
			RequireTest(ReadMoveType(Player) === Target.MovementType, `Freezebomb did not restore movement for UserID=${Target.UserID}.`);
			const Color = SnapshotRenderColor(Player);
			RequireTest((Color.Red === Target.Color.Red) && (Color.Green === Target.Color.Green) && (Color.Blue === Target.Color.Blue) && (Color.Alpha === Target.Color.Alpha), `Freezebomb did not restore tint for UserID=${Target.UserID}.`);
		}

		LogInfo(`Stock player actions test freezebomb: carrier and teammate thawed CarrierUserID=${Carrier.UserID} TeammateUserID=${Teammate.UserID}.`);
		Next();
	});
}

function GetAttachedFlameExpiry(Player) {
	const unLifetimeFieldByteCount = 4;
	const EffectField = FindEntityDataMapField(GetEntityDataMap(Player), "m_hEffectEntity");
	RequireTest(EffectField?.Type === "entityhandle", "Expected a reflected effect entity handle.");
	const Flame = GetEntityDataMapPropertyEntity(Player, EffectField.Path);
	if (!Flame) {
		return null;
	}

	const LifetimeField = FindEntityDataMapField(GetEntityDataMap(Flame), "m_flLifetime");
	RequireTest(((LifetimeField?.Type === "time") || (LifetimeField?.Type === "float")) && (LifetimeField.SizeInBytes === unLifetimeFieldByteCount) && (LifetimeField.ElementCount === 1), `Expected a scalar float or time for the attached flame's expiry, got ${LifetimeField?.Type ?? "no field"}.`);

	return GetEntityDataMapPropertyFloat(Flame, LifetimeField.Path);
}

function TestBurn(unPlayerIndex, unUserID, Next) {
	const unBurnDuration = 3;
	const flBurnLifetimeToleranceSeconds = 0.4;
	const flFlameCleanupSettlingSeconds = 1.8;
	const Player = GetPlayer(unPlayerIndex);
	RequireTest((Player.UserID === unUserID) && !Player.Dead, "Expected the original live burn target.");
	RequireTest(GetAttachedFlameExpiry(Player) === null, "Expected the burn target to start without an attached flame.");
	const nInitialHealth = Player.Health;
	const flStartTime = GetGlobalVariables().CurrentTime;
	ExecuteServerCommand(`sjs_burn #${unUserID} ${unBurnDuration}`);
	const flFlameExpiry = GetAttachedFlameExpiry(GetPlayer(unPlayerIndex));
	const flLifetime = flFlameExpiry - flStartTime;
	RequireTest(Number.isFinite(flFlameExpiry) && (Math.abs(flLifetime - unBurnDuration) < flBurnLifetimeToleranceSeconds), `Burn did not attach a flame for the requested duration. Lifetime=${flLifetime}`);

	After(unBurnDuration + flFlameCleanupSettlingSeconds, () => {
		const Target = GetPlayer(unPlayerIndex);
		RequireTest((Target.UserID === unUserID) && !Target.Dead, "Expected the same live target after the burn.");
		RequireTest(GetGlobalVariables().CurrentTime >= flFlameExpiry, "Burn expiry check ran before the native flame lifetime ended.");
		RequireTest(GetAttachedFlameExpiry(Target) === null, "The native flame remained attached after expiry.");
		LogInfo(`Stock player actions test burn: UserID=${unUserID} Lifetime=${flLifetime.toFixed(2)} HealthBefore=${nInitialHealth} HealthAfter=${Target.Health} FlameExpired=true.`);
		Next();
	});
}

function TestFireBomb(unExcludedUserID, Next, unAttempts = 4) {
	const vecLiveBots = GetAllPlayers().filter((Player) => Player.Connected && Player.FakeClient && !Player.Dead && (Player.UserID !== unExcludedUserID));
	const Carrier = vecLiveBots[0];
	const Teammate = Carrier && vecLiveBots.find((Player) => (Player.Index !== Carrier.Index) && (Player.TeamNumber === Carrier.TeamNumber));
	if (!Teammate) {
		RequireTest(unAttempts > 0, "The server did not create two live teammates for firebomb.");
		ExecuteServerCommand("sb_add");
		After(1, () => TestFireBomb(unExcludedUserID, Next, unAttempts - 1));
		return;
	}

	const unBlastRadius = 600;
	const unBurnDuration = 7;
	const unFuseSeconds = 5;
	const flDetonationObservationDelaySeconds = 5.6;
	RequireTest((GetAttachedFlameExpiry(GetPlayer(Carrier.Index)) === null) && (GetAttachedFlameExpiry(GetPlayer(Teammate.Index)) === null), "Firebomb targets must not already be burning.");
	ExecuteServerCommand("sjs_cvar sb_stop 1");
	ExecuteServerCommand(`sjs_cvar sjs_firebomb_ticks ${unFuseSeconds}`);
	ExecuteServerCommand(`sjs_cvar sjs_firebomb_radius ${unBlastRadius}`);
	ExecuteServerCommand("sjs_cvar sjs_firebomb_mode 1");
	ExecuteServerCommand(`sjs_cvar sjs_burn_duration ${unBurnDuration}`);
	ExecuteServerCommand(`sjs_firebomb #${Carrier.UserID} 1`);
	After(flDetonationObservationDelaySeconds, () => {
		const CurrentCarrier = GetPlayer(Carrier.Index);
		const CurrentTeammate = GetPlayer(Teammate.Index);
		RequireTest((CurrentCarrier.UserID === Carrier.UserID) && (CurrentTeammate.UserID === Teammate.UserID), "Expected the original firebomb targets.");
		const flCarrierExpiry = GetAttachedFlameExpiry(CurrentCarrier);
		const flTeammateExpiry = GetAttachedFlameExpiry(CurrentTeammate);
		RequireTest(Number.isFinite(flCarrierExpiry) && Number.isFinite(flTeammateExpiry), "Firebomb did not attach flames to both the carrier and its nearby teammate.");
		const flExpiryDifference = flCarrierExpiry - flTeammateExpiry;
		RequireTest((flExpiryDifference > 0) && (flExpiryDifference < unBurnDuration), "The firebomb's nearby flame did not expire earlier than the carrier's flame.");
		LogInfo(`Stock player actions test firebomb: CarrierExpiry=${flCarrierExpiry} TeammateExpiry=${flTeammateExpiry} Difference=${flExpiryDifference}`);
		Next();
	});
}

function TestTimeBomb(unExcludedUserID, unAttempts = 4) {
	const vecLiveBots = GetAllPlayers().filter((Player) => Player.Connected && Player.FakeClient && !Player.Dead && (Player.UserID !== unExcludedUserID));
	const Carrier = vecLiveBots[0];
	const Teammate = Carrier && vecLiveBots.find((Player) => (Player.Index !== Carrier.Index) && (Player.TeamNumber === Carrier.TeamNumber));
	if (!Teammate) {
		RequireTest(unAttempts > 0, "The server did not create two live teammates.");
		ExecuteServerCommand("sb_add");
		After(1, () => TestTimeBomb(unExcludedUserID, unAttempts - 1));
		return;
	}

	const CurrentCarrier = GetPlayer(Carrier.Index);
	const CurrentTeammate = GetPlayer(Teammate.Index);
	const InitialCarrierEye = GetEyeLocation(CurrentCarrier);
	const InitialTeammateEye = GetEyeLocation(CurrentTeammate);
	const flDistance = Math.hypot(InitialTeammateEye.X - InitialCarrierEye.X, InitialTeammateEye.Y - InitialCarrierEye.Y, InitialTeammateEye.Z - InitialCarrierEye.Z);
	const unRadius = 3_000;
	const nInitialHealth = 350;
	const unMaximumExpectedBlastDamage = 220;
	const unDamageTolerance = 3;
	const flMinimumUpwardImpulse = 35;
	const unFuseSeconds = 5;
	const unBlastObservationTimeoutSeconds = 10;
	RequireTest(flDistance < (unRadius / 2), "The bots are too far apart to observe blast damage.");
	ExecuteServerCommand("sjs_cvar sb_stop 1");
	ExecuteServerCommand(`sjs_cvar sjs_timebomb_ticks ${unFuseSeconds}`);
	ExecuteServerCommand(`sjs_cvar sjs_timebomb_radius ${unRadius}`);
	ExecuteServerCommand("sjs_cvar sjs_timebomb_mode 1");

	let Blast = null;
	let Timeout = null;

	const DeathListener = (Event) => {
		if (Event.GetEventInteger("userid") !== Carrier.UserID) {
			return;
		}

		UnregisterEventListener("player_death", DeathListener);

		try {
			const Target = GetPlayer(Teammate.Index);
			RequireTest((Target.UserID === Teammate.UserID) && !Target.Dead, "Expected the same live teammate before the blast.");
			// Establish health in the carrier's death callback, before area damage and before another game frame can clamp it.
			RequireTest(Target.SetEntityPropertyInteger("m_iHealth", nInitialHealth) && (Target.Health === nInitialHealth), "Could not establish the teammate's starting health.");
			const CarrierEye = GetEyeLocation(GetPlayer(Carrier.Index));
			const TargetEye = GetEyeLocation(Target);
			const flBlastDistance = Math.hypot(TargetEye.X - CarrierEye.X, TargetEye.Y - CarrierEye.Y, TargetEye.Z - CarrierEye.Z);
			const unExpectedDamage = Math.floor(unMaximumExpectedBlastDamage * (1 - (flBlastDistance / unRadius)));
			const Velocity = GetEntityDataMapPropertyVector(Target, "m_vecAbsVelocity");
			const flInitialVelocityZ = Velocity.Z;
			Blast = { ExpectedDamage: unExpectedDamage, InitialVelocityZ: flInitialVelocityZ };
		} catch (Failure) {
			FailTest(Failure);
		}
	};

	// Run after the already-registered timer scheduler in the same Tick dispatch, before another simulation frame.
	const VerifyBlast = () => {
		if (Blast === null) {
			return;
		}

		try {
			RequireTest(UnregisterTickListener(VerifyBlast), "Could not remove the blast observer.");
			Timeout.CancelTickDelay();

			const CurrentTarget = GetPlayer(Teammate.Index);
			RequireTest((CurrentTarget.UserID === Teammate.UserID) && !CurrentTarget.Dead, "Expected the same live teammate after the blast.");
			const nDamage = nInitialHealth - CurrentTarget.Health;
			const flVelocityDeltaZ = GetEntityDataMapPropertyVector(CurrentTarget, "m_vecAbsVelocity").Z - Blast.InitialVelocityZ;
			LogInfo(`Stock player actions test timebomb: Damage=${nDamage} ExpectedDamage=${Blast.ExpectedDamage} VelocityDeltaZ=${flVelocityDeltaZ}`);
			RequireTest((nDamage > 0) && (Math.abs(nDamage - Blast.ExpectedDamage) <= unDamageTolerance), "Timebomb did not deal the expected distance-based damage.");
			RequireTest(flVelocityDeltaZ > flMinimumUpwardImpulse, "Timebomb did not add an upward impulse.");
			FinishTest().catch(FailTest);
		} catch (Failure) {
			FailTest(Failure);
		}
	};

	RequireTest(RegisterEventListener("player_death", DeathListener), "Could not observe the timebomb carrier's death.");
	RequireTest(RegisterTickListener(VerifyBlast), "Could not register the blast observer.");
	Timeout = After(unBlastObservationTimeoutSeconds, () => {
		UnregisterEventListener("player_death", DeathListener);
		UnregisterTickListener(VerifyBlast);

		const Target = GetPlayer(Teammate.Index);
		const BombCarrier = GetPlayer(Carrier.Index);
		FailTest(new Error(`Timebomb did not complete the area-damage scenario. CarrierHealth=${BombCarrier.Health} TeammateHealth=${Target.Health} CarrierUserID=${BombCarrier.UserID}`));
	});

	ExecuteServerCommand(`sjs_timebomb #${Carrier.UserID} 1`);
}

function TestActions(unPlayerIndex, unUserID) {
	const strIndonesian = GetLanguage("indonesian");
	RequireTest(strIndonesian === "id", "Indonesian is missing from the installed language registry.");

	const { Translate } = CreateTranslationCatalog("server-administration");
	SetDefaultLanguage("ru");

	try {
		RequireTest(Translate(0, "ChangingMap", "Changing map to {Map} in {Seconds} seconds.", { Map: "c1m1_hotel", Seconds: 3 }) === "Переход на карту c1m1_hotel через 3 сек.", "The installed Russian catalog did not render the map notice.");
	} finally {
		SetDefaultLanguage("en");
	}

	const CurrentPlayer = GetPlayer(unPlayerIndex);
	RequireTest((CurrentPlayer.UserID === unUserID) && !CurrentPlayer.Dead, "Expected the same live test bot.");

	// A raw datamap read does not refresh the engine's cached absolute velocity.
	RequireTest(CurrentPlayer.AddVelocity({ X: 0, Y: 0, Z: 0 }) === true, "Could not establish an up-to-date velocity baseline.");
	const BeforeTeleport = CurrentPlayer.Origin;
	const InitialVelocity = GetEntityDataMapPropertyVector(CurrentPlayer, "m_vecAbsVelocity");
	const vecInitialVelocity = [InitialVelocity.X, InitialVelocity.Y, InitialVelocity.Z];
	const InitialAngles = CurrentPlayer.GetEyeAngles();
	RequireTest(InitialAngles !== null, "Player.GetEyeAngles() did not return angles.");
	RequireTest(CurrentPlayer.Teleport() === false, "Player.Teleport() without arguments must be a no-op.");
	RequireTest(CurrentPlayer.Teleport(null, { Pitch: 10, Yaw: 270, Roll: 25 }, null) === true, "An angle-only Player.Teleport() did not dispatch.");
	RequireTest(CurrentPlayer.Teleport(null, InitialAngles) === true, "Player.Teleport() did not restore the original view.");
	const AfterTeleport = CurrentPlayer.Origin;
	RequireTest((BeforeTeleport.X === AfterTeleport.X) && (BeforeTeleport.Y === AfterTeleport.Y) && (BeforeTeleport.Z === AfterTeleport.Z), "An angle-only Player.Teleport() changed the bot's position.");
	const PreservedVelocity = GetEntityDataMapPropertyVector(CurrentPlayer, "m_vecAbsVelocity");
	RequireTest((PreservedVelocity.X === vecInitialVelocity[0]) && (PreservedVelocity.Y === vecInitialVelocity[1]) && (PreservedVelocity.Z === vecInitialVelocity[2]), "An angle-only Player.Teleport() changed the bot's velocity.");

	// Re-establish the velocity baseline after Teleport invalidates the engine's transform cache.
	RequireTest(CurrentPlayer.AddVelocity({ X: 0, Y: 0, Z: 0 }) === true, "Could not refresh the velocity baseline after teleport.");
	const BeforeImpulse = GetEntityDataMapPropertyVector(CurrentPlayer, "m_vecAbsVelocity");
	const vecBeforeImpulse = [BeforeImpulse.X, BeforeImpulse.Y, BeforeImpulse.Z];
	const flVelocityTolerance = 0.01;
	const Impulse = { X: 25, Y: -30, Z: 100 };
	RequireTest(CurrentPlayer.AddVelocity(Impulse) === true, "Player.AddVelocity() did not dispatch.");
	const AfterImpulse = GetEntityDataMapPropertyVector(CurrentPlayer, "m_vecAbsVelocity");
	const vecDelta = [AfterImpulse.X - vecBeforeImpulse[0], AfterImpulse.Y - vecBeforeImpulse[1], AfterImpulse.Z - vecBeforeImpulse[2]];
	RequireTest((Math.abs(vecDelta[0] - Impulse.X) < flVelocityTolerance) && (Math.abs(vecDelta[1] - Impulse.Y) < flVelocityTolerance) && (Math.abs(vecDelta[2] - Impulse.Z) < flVelocityTolerance), `Player.AddVelocity() changed velocity by ${vecDelta.join(",")} instead of ${Impulse.X},${Impulse.Y},${Impulse.Z}.`);

	const unSlapDamage = 5;
	const nBeforeSlapHealth = CurrentPlayer.Health;
	ExecuteServerCommand(`sjs_slap #${unUserID} ${unSlapDamage}`);
	RequireTest(CurrentPlayer.Health === (nBeforeSlapHealth - unSlapDamage), "sjs_slap did not apply its requested damage.");

	TestBurn(unPlayerIndex, unUserID, () => {
		const Target = GetPlayer(unPlayerIndex);
		RequireTest((Target.UserID === unUserID) && (Target.Health > 0) && !Target.Dead, "Expected the same live test bot before the lethal slap.");
		const unFragFieldByteCount = 4;
		const FragField = FindEntityDataMapField(GetEntityDataMap(Target), "m_iFrags");
		RequireTest((FragField?.Type === "int") && (FragField.SizeInBytes === unFragFieldByteCount) && (FragField.ElementCount === 1), "Expected a signed 32-bit frag field.");
		const nExpectedFrags = 7;
		RequireTest(SetEntityDataMapPropertyInteger(Target, FragField.Path, nExpectedFrags), "Could not initialize the test bot's frag count.");
		RequireTest(GetEntityDataMapPropertyInteger(Target, FragField.Path) === nExpectedFrags, "Could not read back the test bot's frag count.");
		let bSawDeath = false;
		const DeathListener = (Event) => {
			bSawDeath ||= Event.GetEventInteger("userid") === unUserID;
		};
		RegisterEventListener("player_death", DeathListener);
		try {
			ExecuteServerCommand(`sjs_slap #${unUserID} ${Target.Health}`);
			const ResultPlayer = GetPlayer(unPlayerIndex);
			const nResultFrags = GetEntityDataMapPropertyInteger(ResultPlayer, FragField.Path);
			LogInfo(`Stock player actions test lethal slap: DeathEvent=${bSawDeath} FragsBefore=${nExpectedFrags} FragsAfter=${nResultFrags}`);
			RequireTest(bSawDeath, "Lethal slap did not emit the death event.");
			RequireTest(nResultFrags === nExpectedFrags, "Lethal slap changed the bot's frag count.");
		} finally {
			UnregisterEventListener("player_death", DeathListener);
		}

		After(1, () => TestFreezeBomb(unUserID, () => TestFireBomb(unUserID, () => TestTimeBomb(unUserID))));
	});
}

function TestFreezeToggle(unPlayerIndex, unUserID, strSelector) {
	const flMovementSettlingSeconds = 0.3;
	ExecuteServerCommand(`sjs_freeze ${strSelector}`);
	After(flMovementSettlingSeconds, () => {
		RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.None, "Default freeze did not immobilize the bot.");
		ExecuteServerCommand(`sjs_freeze ${strSelector}`);
		After(flMovementSettlingSeconds, () => {
			RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.Walk, "Repeated default freeze did not thaw the bot.");
			LogInfo("Stock player actions test freeze toggle: restored movement before expiry.");
			TestActions(unPlayerIndex, unUserID);
		});
	});
}

function TestMovement(unAttempts = 4) {
	const Bot = GetAllPlayers().find((Target) => Target.FakeClient && (Target.Health > 0) && !Target.Dead);
	if (!Bot) {
		RequireTest(unAttempts > 0, "The server did not create a live test bot.");
		ExecuteServerCommand("sb_add");
		After(1, () => TestMovement(unAttempts - 1));
		return;
	}

	const unPlayerIndex = Bot.Index;
	const unUserID = Bot.UserID;
	const strSelector = `#${unUserID}`;
	RequireTest(ReadMoveType(Bot) !== MoveType.NoClip, "Expected the bot to start outside noclip.");
	ExecuteServerCommand(`sjs_noclip ${strSelector}`);
	After(0.3, () => {
		RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.NoClip, "The command did not set noclip.");
		ExecuteServerCommand(`sjs_freeze ${strSelector} 1`);
		After(0.3, () => {
			RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.None, "The command did not freeze the bot.");
			After(1.2, () => {
				RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.NoClip, "Freeze did not restore the previous mode.");
				ExecuteServerCommand(`sjs_noclip ${strSelector}`);
				After(0.3, () => {
					RequireTest(ReadMoveType(GetPlayer(unPlayerIndex)) === MoveType.Walk, "The command did not clear noclip.");
					TestFreezeToggle(unPlayerIndex, unUserID, strSelector);
				});
			});
		});
	});
}

function StartTestClock() {
	if (g_bClockStarted) {
		return;
	}

	g_bClockStarted = true;
	Connect("127.0.0.1", 27352, { Timeout: 1_000 }, (ConnectionError, nHandle) => {
		if (ConnectionError !== null) {
			LogError("The stock player actions loopback test clock is unavailable.");
			return;
		}

		let unPulses = 0;
		const Pulse = () => {
			Receive(nHandle, 1, { Timeout: 200 }, (ReceiveError, Bytes) => {
				if (((ReceiveError === null) && (Bytes.length === 0)) || (++unPulses > 120)) {
					return;
				}

				// A dedicated server with no human players may not emit simulating-frame ticks.
				EmitTickEvent('{"Arguments":[]}');
				Pulse();
			});
		};
		Pulse();
	});
}

function StartTest() {
	LogInfo("Stock player actions test map activated.");
	ExecuteServerCommand("sv_cheats 1");
	ExecuteServerCommand("sjs_cvar sb_all_bot_game 1");
	ExecuteServerCommand("sjs_cvar allow_all_bot_survivor_team 1");
	ExecuteServerCommand("sjs_cvar sv_hibernate_when_empty 0");
	StartTestClock();
	After(4, TestMovement);
}

RegisterServerActivateListener(StartTest);
RegisterCommand("sjs_stock_test_tick", () => {
	EmitTickEvent('{"Arguments":[]}');
	return 1;
});
