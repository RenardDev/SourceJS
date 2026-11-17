"use strict";

const { GetModule } = require("internal/runtime");
const { AUTH_MANAGER } = require("auth/manager");
const { GetClientCVarValue: g_GetClientCVarValue } = require("engines/server");
const { SOUND_FROM_WORLD, Sound, StreamSound } = require("engines/sound");
const g_TraceRuntime = require("engines/trace");
const { Entity, DecorateEntity } = require("entities");
const g_EntityCollisionsRuntime = require("entities/collisions");
const g_EntityConstantsRuntime = require("entities/constants");
const { FireEvent } = GetModule("events");
const { EntityTraceFilter } = require("filters/entities");
const { WeaponClassIterator } = require("filters/weapons");
const { QAngle, Vector } = require("mathlib");
const g_NetChannelRuntime = require("netchannel");
const { SteamID } = require("steam");
const { Weapon } = require("weapons");
const { WEAPON_MANAGER } = require("weapons/manager");
const g_WeaponRestrictionsRuntime = require("weapons/restrictions");
const { DropWeapon: g_DropPlayerWeapon } = require("players/dropweapon");
const g_TeamsRuntime = require("players/teams");
const { MUTE_MANAGER } = require("players/voice");

// Send-property and datamap paths retain the selected SDK's exact spelling.
const g_strOriginProperty = "m_vecOrigin";
const g_strViewOffsetProperty = "m_vecViewOffset[0]";
const g_strViewAngleProperty = "m_angEyeAngles[0]";
const g_strBaseVelocityProperty = "m_vecBaseVelocity";
const g_strMoveTypeProperty = "m_MoveType";
const g_strTakeDamageProperty = "m_takedamage";
const g_strFlagsProperty = "m_fFlags";
const g_strEffectsProperty = "m_fEffects";
const g_strObserverTargetProperty = "m_hObserverTarget";
const g_strObserverModeProperty = "m_iObserverMode";
const g_strVehicleProperty = "m_hVehicle";
const g_strPlayerClassProperty = "m_iClass";
const g_vecNativePlayerMethodNames = Object.freeze([
	"Ban",
	"ChangeTeam",
	"ExecuteClientCommand",
	"Kick",
	"Say",
	"SayTeam",
	"SetName",
	"Slay",
]);

const g_PlayersRuntime = GetModule("players");
const g_PlayerHelpersRuntime = GetModule("players/helpers");

function DefinePlayerMethod(TargetObject, strMethodName, MethodCallback) {
	if (!TargetObject || (typeof TargetObject !== "object") || (strMethodName in TargetObject)) {
		return;
	}

	Object.defineProperty(TargetObject, strMethodName, { configurable: true, enumerable: false, value: MethodCallback, writable: true });
}

function ResolvePlayerIndex(PlayerReference) {
	return g_PlayerHelpersRuntime.GetPlayerIndex(PlayerReference);
}

function ResolveVector(VectorLike) {
	return Vector.CreateMathStructureFromValue(VectorLike);
}

function ResolveAngle(AngleLike) {
	return QAngle.CreateMathStructureFromValue(AngleLike);
}

function RequireFiniteNumber(flNumberValue, strValueName) {
	if ((typeof flNumberValue !== "number") || !Number.isFinite(flNumberValue)) {
		throw new TypeError(`${strValueName} must be a finite number.`);
	}

	return flNumberValue;
}

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bBooleanValue;
}

function RequireNativePlayer(NativePlayer) {
	if (!NativePlayer || (typeof NativePlayer !== "object")) {
		throw new TypeError("player must be a native player object.");
	}

	for (const strMethodName of g_vecNativePlayerMethodNames) {
		if (typeof NativePlayer[strMethodName] !== "function") {
			throw new TypeError(`player must provide the native ${strMethodName}() method.`);
		}
	}

	return NativePlayer;
}

function ReadIntegerProperty(EntityReference, strPropertyPath) {
	return g_PlayersRuntime.GetIntegerProperty(EntityReference, strPropertyPath);
}

function WriteIntegerProperty(EntityReference, strPropertyPath, nIntegerValue) {
	return g_PlayersRuntime.SetIntegerProperty(EntityReference, strPropertyPath, nIntegerValue);
}

function ReadVectorProperty(EntityReference, strPropertyPath) {
	return ResolveVector(g_PlayersRuntime.GetVectorProperty(EntityReference, strPropertyPath));
}

function WriteVectorProperty(EntityReference, strPropertyPath, VectorLike) {
	return g_PlayersRuntime.SetVectorProperty(EntityReference, strPropertyPath, ResolveVector(VectorLike));
}

function ReadEntityProperty(EntityReference, strPropertyPath) {
	return g_PlayersRuntime.GetEntityProperty(EntityReference, strPropertyPath);
}

function ResolveWeaponClassName(WeaponClassReference) {
	if ((WeaponClassReference === null) || (WeaponClassReference === undefined)) {
		return null;
	}

	return WEAPON_MANAGER.FormatName(WeaponClassReference);
}

function GetAllowedWeaponClassNames(RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
	if ((RequiredWeaponFilters === null) && (ExcludedWeaponFilters === null)) {
		return null;
	}

	const vecWeaponClasses = new WeaponClassIterator(RequiredWeaponFilters, ExcludedWeaponFilters).ToArray();
	const setAllowedWeaponClassNames = new Set();
	for (const WeaponClass of vecWeaponClasses) {
		setAllowedWeaponClassNames.add(WeaponClass.ClassName);
	}

	return setAllowedWeaponClassNames;
}

function GetPlayerNetworkID(PlayerReference) {
	return g_PlayersRuntime.GetNetworkID(PlayerReference);
}

function GetWeaponIndexesFromProperties(PlayerReference) {
	return g_PlayersRuntime.GetWeaponIndices(PlayerReference, WEAPON_MANAGER.MyWeaponsProperty);
}

function GetProjectileAmmoPropertyPath(strProjectileName) {
	if ((typeof strProjectileName !== "string") || (strProjectileName.length === 0)) {
		throw new TypeError("strProjectileName must be a non-empty string.");
	}

	const ProjectileNames = WEAPON_MANAGER.Projectiles;
	const strWeaponName = Object.hasOwn(ProjectileNames, strProjectileName) ? ProjectileNames[strProjectileName] : strProjectileName;
	const WeaponInformation = WEAPON_MANAGER.Get(strWeaponName);
	if (!WeaponInformation) {
		throw new Error(`Projectile ammo is not available for ${strProjectileName}.`);
	}

	const WeaponAmmoProperty = WeaponInformation.AmmoProperty;
	if ((WeaponAmmoProperty === null) || (WeaponAmmoProperty === undefined) || (WeaponAmmoProperty === "")) {
		throw new Error(`Projectile ammo is not available for ${strProjectileName}.`);
	}

	return `${WEAPON_MANAGER.AmmoProperty}${String(WeaponAmmoProperty).padStart(3, "0")}`;
}

function Player(PlayerReference) {
	return DecoratePlayer(g_PlayersRuntime.GetPlayer(PlayerReference));
}

function ResolvePlayerObject(PlayerReference) {
	return (typeof PlayerReference === "number") ? Player(PlayerReference) : PlayerReference;
}

function FromUserID(nUserID) {
	return DecoratePlayer(g_PlayersRuntime.GetPlayerFromUserID(nUserID));
}

function IsConnected(PlayerReference) {
	return g_PlayersRuntime.IsConnected(PlayerReference);
}

function IsFakeClient(PlayerReference) {
	return g_PlayersRuntime.IsFakeClient(PlayerReference);
}

function IsHLTV(PlayerReference) {
	return g_PlayersRuntime.IsHLTV(PlayerReference);
}

function IsBot(PlayerReference) {
	return IsFakeClient(PlayerReference) || (GetPlayerNetworkID(PlayerReference).toUpperCase() === "BOT");
}

function IsInAVehicle(PlayerReference) {
	return g_PlayersRuntime.IsInVehicle(PlayerReference);
}

function IsObserver(PlayerReference) {
	return g_PlayersRuntime.IsObserver(PlayerReference);
}

function IsDead(PlayerReference) {
	return g_PlayersRuntime.IsDead(PlayerReference);
}

function GetRawSteamID(PlayerReference) {
	const strNetworkID = GetPlayerNetworkID(PlayerReference);
	if ((strNetworkID === null) || (strNetworkID === "")) {
		return null;
	}

	if (typeof strNetworkID !== "string") {
		throw new TypeError("Player network ID must be a string or null.");
	}

	if (strNetworkID.toUpperCase() === "BOT") {
		return null;
	}

	return SteamID.Parse(strNetworkID);
}

function GetPermissions(PlayerReference) {
	return AUTH_MANAGER.GetPlayerPermissionsFromSteamID(GetPlayerNetworkID(PlayerReference));
}

function GetName(PlayerReference) {
	return g_PlayersRuntime.GetName(PlayerReference);
}

function SetName(PlayerReference, strPlayerName) {
	return g_PlayersRuntime.SetName(PlayerReference, strPlayerName);
}

function GetTeam(PlayerReference) {
	return g_PlayersRuntime.GetTeam(PlayerReference);
}

function SetTeam(PlayerReference, TeamReference) {
	return ResolvePlayerObject(PlayerReference).ChangeTeam(g_TeamsRuntime.GetTeamNumber(TeamReference));
}

function GetTeamName(PlayerReference) {
	return g_TeamsRuntime.GetTeamName(GetTeam(PlayerReference));
}

function SetTeamName(PlayerReference, strTeamName) {
	if ((typeof strTeamName !== "string") || (strTeamName.length === 0)) {
		throw new TypeError("strTeamName must be a non-empty string.");
	}

	const TeamNames = g_TeamsRuntime.GetTeamNames();
	if (!Object.hasOwn(TeamNames, strTeamName)) {
		throw new RangeError("Invalid team name.");
	}

	return SetTeam(PlayerReference, TeamNames[strTeamName]);
}

function GetPlayerClass(PlayerReference) {
	return ReadIntegerProperty(PlayerReference, g_strPlayerClassProperty);
}

function SetPlayerClass(PlayerReference, nPlayerClass) {
	return WriteIntegerProperty(PlayerReference, g_strPlayerClassProperty, nPlayerClass);
}

function GetPlayerClassName(PlayerReference) {
	const nPlayerClass = GetPlayerClass(PlayerReference);
	const PlayerClassNames = g_TeamsRuntime.GetTeamClassesByNumber();
	if (!Object.hasOwn(PlayerClassNames, nPlayerClass)) {
		throw new RangeError(`Unknown player class number: ${nPlayerClass}.`);
	}

	return PlayerClassNames[nPlayerClass];
}

function SetPlayerClassName(PlayerReference, strPlayerClassName) {
	if ((typeof strPlayerClassName !== "string") || (strPlayerClassName.length === 0)) {
		throw new TypeError("strPlayerClassName must be a non-empty string.");
	}

	const PlayerClassNumbers = g_TeamsRuntime.GetTeamClassesByName();
	if (!Object.hasOwn(PlayerClassNumbers, strPlayerClassName)) {
		throw new RangeError("Invalid player class name.");
	}

	return SetPlayerClass(PlayerReference, PlayerClassNumbers[strPlayerClassName]);
}

function GetLanguage(PlayerReference) {
	return g_PlayerHelpersRuntime.GetClientLanguage(ResolvePlayerIndex(PlayerReference));
}

function ExecuteClientCommand(PlayerReference, strCommandText, bServerSide = false) {
	return ResolvePlayerObject(PlayerReference).ExecuteClientCommand(strCommandText, RequireBoolean(bServerSide, "bServerSide"));
}

function Slay(PlayerReference) {
	return ResolvePlayerObject(PlayerReference).Slay();
}

function Say(PlayerReference, strChatMessage) {
	return ResolvePlayerObject(PlayerReference).Say(strChatMessage);
}

function SayTeam(PlayerReference, strChatMessage) {
	return ResolvePlayerObject(PlayerReference).SayTeam(strChatMessage);
}

function Mute(PlayerReference, ReceiverReferences = null) {
	return MUTE_MANAGER.MutePlayer(ResolvePlayerIndex(PlayerReference), ReceiverReferences);
}

function Unmute(PlayerReference, ReceiverReferences = null) {
	return MUTE_MANAGER.UnmutePlayer(ResolvePlayerIndex(PlayerReference), ReceiverReferences);
}

function IsMuted(PlayerReference, ReceiverReferences = null) {
	return MUTE_MANAGER.IsMuted(ResolvePlayerIndex(PlayerReference), ReceiverReferences);
}

function Kick(PlayerReference, strKickMessage = "") {
	return ResolvePlayerObject(PlayerReference).Kick(strKickMessage);
}

function Ban(PlayerReference, unBanDuration = 0, bKickPlayer = true, bWriteBan = true) {
	return ResolvePlayerObject(PlayerReference).Ban(unBanDuration, bKickPlayer, bWriteBan);
}

function ChangeTeam(PlayerReference, TeamReference) {
	return ResolvePlayerObject(PlayerReference).ChangeTeam(g_TeamsRuntime.GetTeamNumber(TeamReference));
}

function PlaySound(PlayerReference, strSoundSample, SoundOptions = {}) {
	if (IsFakeClient(PlayerReference)) {
		return false;
	}

	if ((SoundOptions === null) || (typeof SoundOptions !== "object") || Array.isArray(SoundOptions)) {
		throw new TypeError("SoundOptions must be an object.");
	}

	const ProvidedStreamOption = SoundOptions.Stream;
	const bShouldStreamSound = (ProvidedStreamOption === undefined) ? false : RequireBoolean(ProvidedStreamOption, "Stream");
	const nProvidedEntity = SoundOptions.Entity;
	const nSoundEntity = ((nProvidedEntity === null) || (nProvidedEntity === undefined)) ? SOUND_FROM_WORLD : nProvidedEntity;
	const NormalizedSoundOptions = Object.create(SoundOptions, { Entity: { configurable: true, enumerable: true, value: nSoundEntity, writable: true } });
	const SoundConstructor = bShouldStreamSound ? StreamSound : Sound;
	const SoundInstance = new SoundConstructor(strSoundSample, NormalizedSoundOptions);
	const ConfiguredSoundRecipients = SoundInstance.Recipients;
	const SoundRecipients = (ConfiguredSoundRecipients === null) ? ResolvePlayerIndex(PlayerReference) : ConfiguredSoundRecipients;

	return SoundInstance.Play(SoundRecipients);
}

function FireGameEvent(PlayerReference, strEventName, EventPayload = {}, bDoNotBroadcast = false) {
	if ((EventPayload === null) || (typeof EventPayload !== "object") || Array.isArray(EventPayload)) {
		throw new TypeError("EventPayload must be an object.");
	}

	const PlayerEventPayload = Object.create(null);
	// The engine game-event schema requires the lowercase userid key.
	PlayerEventPayload.userid = g_PlayersRuntime.GetUserID(PlayerReference);

	for (const strEventFieldName in EventPayload) {
		if (Object.hasOwn(EventPayload, strEventFieldName)) {
			PlayerEventPayload[strEventFieldName] = EventPayload[strEventFieldName];
		}
	}

	return FireEvent(strEventName, PlayerEventPayload, RequireBoolean(bDoNotBroadcast, "bDoNotBroadcast"));
}

function GetOrigin(PlayerReference) {
	return ResolveVector(g_PlayersRuntime.GetOrigin(PlayerReference));
}

function SetOrigin(PlayerReference, Origin) {
	return WriteVectorProperty(PlayerReference, g_strOriginProperty, Origin);
}

function GetViewOffset(PlayerReference) {
	return ReadVectorProperty(PlayerReference, g_strViewOffsetProperty);
}

function GetViewAngle(PlayerReference) {
	return ResolveAngle(ReadVectorProperty(PlayerReference, g_strViewAngleProperty));
}

function SetViewAngle(PlayerReference, ViewAngle) {
	return WriteVectorProperty(PlayerReference, g_strViewAngleProperty, ResolveAngle(ViewAngle));
}

function GetObserverTargetIndex(PlayerReference) {
	const ObserverTarget = ReadEntityProperty(PlayerReference, g_strObserverTargetProperty);
	if (ObserverTarget === null) {
		return null;
	}

	if (typeof ObserverTarget !== "object") {
		throw new TypeError("Observer target must be a native entity object or null.");
	}

	const unObserverTargetIndex = ObserverTarget.Index;
	if (!Number.isSafeInteger(unObserverTargetIndex) || (unObserverTargetIndex < 0)) {
		throw new TypeError("Observer target index must be a non-negative safe integer.");
	}

	return unObserverTargetIndex;
}

function GetViewVector(PlayerReference) {
	return GetViewAngle(PlayerReference).ConvertQAngleToVectors().Forward;
}

function GetEyeLocation(PlayerReference) {
	return GetOrigin(PlayerReference).AddVector(GetViewOffset(PlayerReference));
}

function RequirePlayerTraceResult(TraceResult) {
	if ((TraceResult === null) || (typeof TraceResult !== "object") || Array.isArray(TraceResult)) {
		throw new TypeError("Player trace must return an object.");
	}

	if (typeof TraceResult.Hit !== "boolean") {
		throw new TypeError("Player trace hit must be a boolean.");
	}

	return TraceResult;
}

function GetTraceRay(PlayerReference, unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
	const TraceStart = GetEyeLocation(PlayerReference);
	const TraceEnd = TraceStart.AddVector(GetViewVector(PlayerReference).MultiplyScalar(g_TraceRuntime.MAX_TRACE_LENGTH));
	let EffectiveTraceFilter = TraceFilter;
	if (EffectiveTraceFilter === null) {
		EffectiveTraceFilter = new EntityTraceFilter([PlayerReference], g_TraceRuntime.TraceType.Everything);
	}

	return RequirePlayerTraceResult(g_TraceRuntime.TraceRay({ End: TraceEnd, Start: TraceStart }, unContentMask, EffectiveTraceFilter));
}

function GetViewCoordinates(PlayerReference, unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
	const TraceResult = GetTraceRay(PlayerReference, unContentMask, TraceFilter);

	return TraceResult.Hit ? ResolveVector(TraceResult.EndPosition) : null;
}

function SetViewCoordinates(PlayerReference, ViewCoordinates) {
	const EyeLocation = GetEyeLocation(PlayerReference);
	const EyeDelta = ResolveVector(ViewCoordinates).SubtractVector(EyeLocation);
	const ViewAngles = EyeDelta.ConvertVectorToQAngle();
	const CurrentViewAngle = GetViewAngle(PlayerReference);
	const flViewYaw = ViewAngles.Y;
	ViewAngles.Y = (flViewYaw < 0) ? (flViewYaw + 360) : flViewYaw;
	ViewAngles.Z = CurrentViewAngle.Z;

	return SetViewAngle(PlayerReference, ViewAngles);
}

function GetViewEntity(PlayerReference, unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
	const TraceResult = GetTraceRay(PlayerReference, unContentMask, TraceFilter);
	if (!TraceResult.Hit) {
		return null;
	}

	const unEntityIndex = TraceResult.EntityIndex;
	if (!Number.isSafeInteger(unEntityIndex) || (unEntityIndex < 0)) {
		throw new TypeError("Player trace entity index must be a non-negative safe integer.");
	}

	return (unEntityIndex > 0) ? Entity(unEntityIndex) : null;
}

function SetViewEntity(PlayerReference, EntityReference) {
	const TargetOrigin = ReadVectorProperty(EntityReference, g_strOriginProperty);

	return SetViewCoordinates(PlayerReference, TargetOrigin);
}

function GetViewPlayer(PlayerReference, unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
	const ViewedEntity = GetViewEntity(PlayerReference, unContentMask, TraceFilter);
	if (ViewedEntity === null) {
		return null;
	}

	const ViewedPlayer = g_PlayersRuntime.GetPlayer(ViewedEntity.Index);
	if (ViewedPlayer === null) {
		return null;
	}

	if (typeof ViewedPlayer !== "object") {
		throw new TypeError("Viewed player must be a native player object or null.");
	}

	return IsConnected(ViewedPlayer) ? DecoratePlayer(ViewedPlayer) : null;
}

function SetViewPlayer(PlayerReference, TargetPlayer) {
	return SetViewCoordinates(PlayerReference, GetEyeLocation(TargetPlayer));
}

function SetEyeLocation(PlayerReference, EyeLocation) {
	return SetOrigin(PlayerReference, ResolveVector(EyeLocation).SubtractVector(GetViewOffset(PlayerReference)));
}

function Push(PlayerReference, flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride = false) {
	const bShouldOverrideVertical = RequireBoolean(bVerticalOverride, "bVerticalOverride");
	const flHorizontalSpeed = RequireFiniteNumber(flHorizontalMultiplier, "flHorizontalMultiplier");
	const flVerticalSpeed = RequireFiniteNumber(flVerticalMultiplier, "flVerticalMultiplier");
	const ViewDirection = GetViewVector(PlayerReference);
	const BaseVelocity = new Vector(ViewDirection.X * flHorizontalSpeed, ViewDirection.Y * flHorizontalSpeed, bShouldOverrideVertical ? flVerticalSpeed : (ViewDirection.Z * flVerticalSpeed));

	return WriteVectorProperty(PlayerReference, g_strBaseVelocityProperty, BaseVelocity);
}

function GetNoClip(PlayerReference) {
	return ReadIntegerProperty(PlayerReference, g_strMoveTypeProperty) === g_EntityConstantsRuntime.MoveType.NoClip;
}

function SetNoClip(PlayerReference, bEnabled) {
	const bNoClipEnabled = RequireBoolean(bEnabled, "bEnabled");
	let nMoveType = g_EntityConstantsRuntime.MoveType.Walk;
	if (bNoClipEnabled) {
		nMoveType = g_EntityConstantsRuntime.MoveType.NoClip;
	}

	return WriteIntegerProperty(PlayerReference, g_strMoveTypeProperty, nMoveType);
}

function GetJetpack(PlayerReference) {
	return ReadIntegerProperty(PlayerReference, g_strMoveTypeProperty) === g_EntityConstantsRuntime.MoveType.Fly;
}

function SetJetpack(PlayerReference, bEnabled) {
	const nMoveType = RequireBoolean(bEnabled, "bEnabled") ? g_EntityConstantsRuntime.MoveType.Fly : g_EntityConstantsRuntime.MoveType.Walk;

	return WriteIntegerProperty(PlayerReference, g_strMoveTypeProperty, nMoveType);
}

function GetGodMode(PlayerReference) {
	return ReadIntegerProperty(PlayerReference, g_strTakeDamageProperty) === g_EntityConstantsRuntime.TakeDamage.No;
}

function SetGodMode(PlayerReference, bEnabled) {
	const bGodModeEnabled = RequireBoolean(bEnabled, "bEnabled");
	let nDamageMode = g_EntityConstantsRuntime.TakeDamage.Yes;
	if (bGodModeEnabled) {
		nDamageMode = g_EntityConstantsRuntime.TakeDamage.No;
	}

	return WriteIntegerProperty(PlayerReference, g_strTakeDamageProperty, nDamageMode);
}

function GetNoBlock(PlayerReference) {
	return g_EntityCollisionsRuntime.GetCollisionGroup(PlayerReference) === g_EntityCollisionsRuntime.CollisionGroup.DebrisTrigger;
}

function SetNoBlock(PlayerReference, bEnabled) {
	const bNoBlockEnabled = RequireBoolean(bEnabled, "bEnabled");
	let nCollisionGroup = g_EntityCollisionsRuntime.CollisionGroup.Player;
	if (bNoBlockEnabled) {
		nCollisionGroup = g_EntityCollisionsRuntime.CollisionGroup.DebrisTrigger;
	}

	return g_EntityCollisionsRuntime.SetCollisionGroup(PlayerReference, nCollisionGroup);
}

function GetFrozen(PlayerReference) {
	return (ReadIntegerProperty(PlayerReference, g_strFlagsProperty) & g_EntityConstantsRuntime.FL_FROZEN) !== 0;
}

function SetFrozen(PlayerReference, bEnabled) {
	const bShouldFreeze = RequireBoolean(bEnabled, "bEnabled");
	const nPlayerFlags = ReadIntegerProperty(PlayerReference, g_strFlagsProperty);
	let nFrozenFlags = nPlayerFlags & ~g_EntityConstantsRuntime.FL_FROZEN;
	if (bShouldFreeze) {
		nFrozenFlags = nPlayerFlags | g_EntityConstantsRuntime.FL_FROZEN;
	}

	return WriteIntegerProperty(PlayerReference, g_strFlagsProperty, nFrozenFlags);
}

function GetStuck(PlayerReference) {
	return ReadIntegerProperty(PlayerReference, g_strMoveTypeProperty) === g_EntityConstantsRuntime.MoveType.None;
}

function SetStuck(PlayerReference, bEnabled) {
	const bStuckEnabled = RequireBoolean(bEnabled, "bEnabled");
	let nMoveType = g_EntityConstantsRuntime.MoveType.Walk;
	if (bStuckEnabled) {
		nMoveType = g_EntityConstantsRuntime.MoveType.None;
	}

	return WriteIntegerProperty(PlayerReference, g_strMoveTypeProperty, nMoveType);
}

function GetFlashlight(PlayerReference) {
	return (ReadIntegerProperty(PlayerReference, g_strEffectsProperty) & g_EntityConstantsRuntime.EntityEffects.DimLight) !== 0;
}

function SetFlashlight(PlayerReference, bEnabled) {
	const bFlashlightEnabled = RequireBoolean(bEnabled, "bEnabled");
	const nEntityEffects = ReadIntegerProperty(PlayerReference, g_strEffectsProperty);
	let nFlashlightEffects = nEntityEffects & ~g_EntityConstantsRuntime.EntityEffects.DimLight;
	if (bFlashlightEnabled) {
		nFlashlightEffects = nEntityEffects | g_EntityConstantsRuntime.EntityEffects.DimLight;
	}

	return WriteIntegerProperty(PlayerReference, g_strEffectsProperty, nFlashlightEffects);
}

function GetClientCVarValue(PlayerReference, strConVarName) {
	return g_GetClientCVarValue(ResolvePlayerIndex(PlayerReference), strConVarName);
}

function GetNetInfo(PlayerReference) {
	return g_NetChannelRuntime.GetPlayerNetChannelInfo(ResolvePlayerIndex(PlayerReference));
}

function SendConVarValue(PlayerReference, strConVarName, strConVarValue) {
	return g_PlayersRuntime.SendConVarValue(PlayerReference, strConVarName, strConVarValue);
}

function GetSpectators(PlayerReference) {
	const unTargetPlayerIndex = ResolvePlayerIndex(PlayerReference);
	const vecNativePlayers = g_PlayersRuntime.GetAllPlayers();
	const vecSpectatorPlayers = [];
	for (const NativePlayer of vecNativePlayers) {
		const SpectatorPlayer = DecoratePlayer(NativePlayer);
		const unSpectatorPlayerIndex = SpectatorPlayer.Index;
		if ((unSpectatorPlayerIndex !== unTargetPlayerIndex) && (GetObserverTargetIndex(SpectatorPlayer) === unTargetPlayerIndex)) {
			vecSpectatorPlayers.push(SpectatorPlayer);
		}
	}

	return vecSpectatorPlayers;
}

function Spawn(PlayerReference, bForce = false) {
	const bForceRespawn = RequireBoolean(bForce, "bForce");

	return g_PlayersRuntime.SpawnPlayer(PlayerReference, bForceRespawn);
}

function GetActiveWeapon(PlayerReference) {
	return g_PlayersRuntime.GetActiveWeapon(PlayerReference);
}

function SetActiveWeapon(PlayerReference, WeaponReference) {
	return g_PlayersRuntime.SetActiveWeapon(PlayerReference, WeaponReference);
}

function GetWeaponIndexes(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
	const strExpectedWeaponClassName = ResolveWeaponClassName(strClassName);
	const setAllowedWeaponClassNames = GetAllowedWeaponClassNames(RequiredWeaponFilters, ExcludedWeaponFilters);
	const vecPlayerWeaponIndexes = GetWeaponIndexesFromProperties(PlayerReference);
	const vecOwnedWeaponIndexes = [];
	for (const unPlayerWeaponIndex of vecPlayerWeaponIndexes) {
		const OwnedWeapon = Weapon(unPlayerWeaponIndex);
		const strWeaponName = OwnedWeapon.Weapon;
		const strWeaponClassName = OwnedWeapon.ClassName;
		const bMatchesExpectedWeaponClass = (strExpectedWeaponClassName === null) || (strWeaponName === strExpectedWeaponClassName) || (strWeaponClassName === strExpectedWeaponClassName);
		if (!bMatchesExpectedWeaponClass) {
			continue;
		}

		const bMatchesAllowedWeaponClass = (setAllowedWeaponClassNames === null) || setAllowedWeaponClassNames.has(strWeaponName) || setAllowedWeaponClassNames.has(strWeaponClassName);
		if (!bMatchesAllowedWeaponClass) {
			continue;
		}

		vecOwnedWeaponIndexes.push(OwnedWeapon.Index);
	}

	return vecOwnedWeaponIndexes;
}

function GetWeapons(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
	const vecPlayerWeaponIndexes = GetWeaponIndexes(PlayerReference, strClassName, RequiredWeaponFilters, ExcludedWeaponFilters);
	const vecPlayerWeapons = [];
	for (const unPlayerWeaponIndex of vecPlayerWeaponIndexes) {
		vecPlayerWeapons.push(Weapon(unPlayerWeaponIndex));
	}

	return vecPlayerWeapons;
}

function GetWeapon(PlayerReference, strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
	const vecMatchingPlayerWeapons = GetWeapons(PlayerReference, strClassName, RequiredWeaponFilters, ExcludedWeaponFilters);
	if (vecMatchingPlayerWeapons.length === 0) {
		return null;
	}

	return vecMatchingPlayerWeapons[0];
}

function GetPrimaryWeapon(PlayerReference) {
	return GetWeapon(PlayerReference, null, "primary");
}

function GetSecondaryWeapon(PlayerReference) {
	return GetWeapon(PlayerReference, null, "secondary");
}

function GetProjectileAmmo(PlayerReference, strProjectileName) {
	return g_PlayersRuntime.GetProjectileAmmo(PlayerReference, GetProjectileAmmoPropertyPath(strProjectileName));
}

function SetProjectileAmmo(PlayerReference, strProjectileName, nAmmoValue) {
	return g_PlayersRuntime.SetProjectileAmmo(PlayerReference, GetProjectileAmmoPropertyPath(strProjectileName), nAmmoValue);
}

function GetProjectileIndexes(PlayerReference, strProjectileName) {
	if ((typeof strProjectileName !== "string") || (strProjectileName.length === 0)) {
		throw new TypeError("strProjectileName must be a non-empty string.");
	}

	const ProjectileDefinitions = WEAPON_MANAGER.Projectiles;
	if (Object.hasOwn(ProjectileDefinitions, strProjectileName)) {
		return g_PlayersRuntime.GetProjectileIndices(PlayerReference, strProjectileName);
	}

	return GetWeaponIndexes(PlayerReference, strProjectileName);
}

function* IterateWeaponReferences(vecWeaponReferences) {
	for (const WeaponReference of vecWeaponReferences) {
		if (!Array.isArray(WeaponReference)) {
			yield WeaponReference;
			continue;
		}

		for (const NestedWeaponReference of WeaponReference) {
			yield NestedWeaponReference;
		}
	}
}

function RestrictWeapons(PlayerReference, ...vecWeaponsToRestrict) {
	for (const WeaponReference of IterateWeaponReferences(vecWeaponsToRestrict)) {
		g_WeaponRestrictionsRuntime.RestrictPlayer(PlayerReference, WeaponReference);
	}

	return true;
}

function UnrestrictWeapons(PlayerReference, ...vecWeaponsToUnrestrict) {
	for (const WeaponReference of IterateWeaponReferences(vecWeaponsToUnrestrict)) {
		g_WeaponRestrictionsRuntime.UnrestrictPlayer(PlayerReference, WeaponReference);
	}

	return true;
}

function IsWeaponRestricted(PlayerReference, WeaponReference) {
	return !g_WeaponRestrictionsRuntime.CanUse(PlayerReference, WeaponReference);
}

function DropWeapon(PlayerReference, WeaponReference, DropTarget = null, DropVelocity = null) {
	return g_DropPlayerWeapon(PlayerReference, WeaponReference, DropTarget, DropVelocity);
}

function DecoratePlayer(NativePlayer) {
	RequireNativePlayer(NativePlayer);

	DecorateEntity(NativePlayer);

	DefinePlayerMethod(NativePlayer, "IsConnected", function PlayerIsConnected() {
		return IsConnected(this);
	});
	DefinePlayerMethod(NativePlayer, "IsFakeClient", function PlayerIsFakeClient() {
		return IsFakeClient(this);
	});
	DefinePlayerMethod(NativePlayer, "IsHLTV", function PlayerIsHLTV() {
		return IsHLTV(this);
	});
	DefinePlayerMethod(NativePlayer, "IsBot", function PlayerIsBot() {
		return IsBot(this);
	});
	DefinePlayerMethod(NativePlayer, "IsInAVehicle", function PlayerIsInAVehicle() {
		return IsInAVehicle(this);
	});
	DefinePlayerMethod(NativePlayer, "IsObserver", function PlayerIsObserver() {
		return IsObserver(this);
	});
	DefinePlayerMethod(NativePlayer, "IsDead", function PlayerIsDead() {
		return IsDead(this);
	});
	DefinePlayerMethod(NativePlayer, "GetRawSteamID", function PlayerGetRawSteamID() {
		return GetRawSteamID(this);
	});
	DefinePlayerMethod(NativePlayer, "GetPermissions", function PlayerGetPermissions() {
		return GetPermissions(this);
	});
	DefinePlayerMethod(NativePlayer, "GetName", function PlayerGetName() {
		return GetName(this);
	});
	DefinePlayerMethod(NativePlayer, "SetName", function PlayerSetName(strPlayerName) {
		return SetName(this, strPlayerName);
	});
	DefinePlayerMethod(NativePlayer, "GetTeam", function PlayerGetTeam() {
		return GetTeam(this);
	});
	DefinePlayerMethod(NativePlayer, "SetTeam", function PlayerSetTeam(TeamReference) {
		return SetTeam(this, TeamReference);
	});
	DefinePlayerMethod(NativePlayer, "GetTeamName", function PlayerGetTeamName() {
		return GetTeamName(this);
	});
	DefinePlayerMethod(NativePlayer, "SetTeamName", function PlayerSetTeamName(strTeamName) {
		return SetTeamName(this, strTeamName);
	});
	DefinePlayerMethod(NativePlayer, "GetPlayerClass", function PlayerGetPlayerClass() {
		return GetPlayerClass(this);
	});
	DefinePlayerMethod(NativePlayer, "SetPlayerClass", function PlayerSetPlayerClass(nPlayerClass) {
		return SetPlayerClass(this, nPlayerClass);
	});
	DefinePlayerMethod(NativePlayer, "GetPlayerClassName", function PlayerGetPlayerClassName() {
		return GetPlayerClassName(this);
	});
	DefinePlayerMethod(NativePlayer, "SetPlayerClassName", function PlayerSetPlayerClassName(strPlayerClassName) {
		return SetPlayerClassName(this, strPlayerClassName);
	});
	DefinePlayerMethod(NativePlayer, "GetLanguage", function PlayerGetLanguage() {
		return GetLanguage(this);
	});
	DefinePlayerMethod(NativePlayer, "ExecuteClientCommand", function PlayerExecuteClientCommand(strCommandText, bServerSide = false) {
		return ExecuteClientCommand(this, strCommandText, bServerSide);
	});
	DefinePlayerMethod(NativePlayer, "Slay", function PlayerSlay() {
		return Slay(this);
	});
	DefinePlayerMethod(NativePlayer, "Say", function PlayerSay(strChatMessage) {
		return Say(this, strChatMessage);
	});
	DefinePlayerMethod(NativePlayer, "SayTeam", function PlayerSayTeam(strChatMessage) {
		return SayTeam(this, strChatMessage);
	});
	DefinePlayerMethod(NativePlayer, "Mute", function PlayerMute(ReceiverReferences = null) {
		return Mute(this, ReceiverReferences);
	});
	DefinePlayerMethod(NativePlayer, "Unmute", function PlayerUnmute(ReceiverReferences = null) {
		return Unmute(this, ReceiverReferences);
	});
	DefinePlayerMethod(NativePlayer, "IsMuted", function PlayerIsMuted(ReceiverReferences = null) {
		return IsMuted(this, ReceiverReferences);
	});
	DefinePlayerMethod(NativePlayer, "Kick", function PlayerKick(strKickMessage = "") {
		return Kick(this, strKickMessage);
	});
	DefinePlayerMethod(NativePlayer, "Ban", function PlayerBan(unBanDuration = 0, bKickPlayer = true, bWriteBan = true) {
		return Ban(this, unBanDuration, bKickPlayer, bWriteBan);
	});
	DefinePlayerMethod(NativePlayer, "ChangeTeam", function PlayerChangeTeam(TeamReference) {
		return ChangeTeam(this, TeamReference);
	});
	DefinePlayerMethod(NativePlayer, "PlaySound", function PlayerPlaySound(strSoundSample, SoundOptions = {}) {
		return PlaySound(this, strSoundSample, SoundOptions);
	});
	DefinePlayerMethod(NativePlayer, "FireGameEvent", function PlayerFireGameEvent(strEventName, EventPayload = {}, bDoNotBroadcast = false) {
		return FireGameEvent(this, strEventName, EventPayload, bDoNotBroadcast);
	});
	DefinePlayerMethod(NativePlayer, "GetViewVector", function PlayerGetViewVector() {
		return GetViewVector(this);
	});
	DefinePlayerMethod(NativePlayer, "GetTraceRay", function PlayerGetTraceRay(unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
		return GetTraceRay(this, unContentMask, TraceFilter);
	});
	DefinePlayerMethod(NativePlayer, "GetViewCoordinates", function PlayerGetViewCoordinates(unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
		return GetViewCoordinates(this, unContentMask, TraceFilter);
	});
	DefinePlayerMethod(NativePlayer, "SetViewCoordinates", function PlayerSetViewCoordinates(ViewCoordinates) {
		return SetViewCoordinates(this, ViewCoordinates);
	});
	DefinePlayerMethod(NativePlayer, "GetViewEntity", function PlayerGetViewEntity(unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
		return GetViewEntity(this, unContentMask, TraceFilter);
	});
	DefinePlayerMethod(NativePlayer, "SetViewEntity", function PlayerSetViewEntity(EntityReference) {
		return SetViewEntity(this, EntityReference);
	});
	DefinePlayerMethod(NativePlayer, "GetViewPlayer", function PlayerGetViewPlayer(unContentMask = g_TraceRuntime.ContentMasks.All, TraceFilter = null) {
		return GetViewPlayer(this, unContentMask, TraceFilter);
	});
	DefinePlayerMethod(NativePlayer, "SetViewPlayer", function PlayerSetViewPlayer(TargetPlayer) {
		return SetViewPlayer(this, TargetPlayer);
	});
	DefinePlayerMethod(NativePlayer, "GetEyeLocation", function PlayerGetEyeLocation() {
		return GetEyeLocation(this);
	});
	DefinePlayerMethod(NativePlayer, "SetEyeLocation", function PlayerSetEyeLocation(EyeLocation) {
		return SetEyeLocation(this, EyeLocation);
	});
	DefinePlayerMethod(NativePlayer, "Push", function PlayerPush(flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride = false) {
		return Push(this, flHorizontalMultiplier, flVerticalMultiplier, bVerticalOverride);
	});
	DefinePlayerMethod(NativePlayer, "GetNoClip", function PlayerGetNoClip() {
		return GetNoClip(this);
	});
	DefinePlayerMethod(NativePlayer, "SetNoClip", function PlayerSetNoClip(bEnabled) {
		return SetNoClip(this, bEnabled);
	});
	DefinePlayerMethod(NativePlayer, "GetJetpack", function PlayerGetJetpack() {
		return GetJetpack(this);
	});
	DefinePlayerMethod(NativePlayer, "SetJetpack", function PlayerSetJetpack(bEnabled) {
		return SetJetpack(this, bEnabled);
	});
	DefinePlayerMethod(NativePlayer, "GetGodMode", function PlayerGetGodMode() {
		return GetGodMode(this);
	});
	DefinePlayerMethod(NativePlayer, "SetGodMode", function PlayerSetGodMode(bEnabled) {
		return SetGodMode(this, bEnabled);
	});
	DefinePlayerMethod(NativePlayer, "GetNoBlock", function PlayerGetNoBlock() {
		return GetNoBlock(this);
	});
	DefinePlayerMethod(NativePlayer, "SetNoBlock", function PlayerSetNoBlock(bEnabled) {
		return SetNoBlock(this, bEnabled);
	});

	if (Object.hasOwn(g_EntityConstantsRuntime, "FL_FROZEN")) {
		DefinePlayerMethod(NativePlayer, "GetFrozen", function PlayerGetFrozen() {
			return GetFrozen(this);
		});
		DefinePlayerMethod(NativePlayer, "SetFrozen", function PlayerSetFrozen(bEnabled) {
			return SetFrozen(this, bEnabled);
		});
	}

	DefinePlayerMethod(NativePlayer, "GetStuck", function PlayerGetStuck() {
		return GetStuck(this);
	});
	DefinePlayerMethod(NativePlayer, "SetStuck", function PlayerSetStuck(bEnabled) {
		return SetStuck(this, bEnabled);
	});
	DefinePlayerMethod(NativePlayer, "GetFlashlight", function PlayerGetFlashlight() {
		return GetFlashlight(this);
	});
	DefinePlayerMethod(NativePlayer, "SetFlashlight", function PlayerSetFlashlight(bEnabled) {
		return SetFlashlight(this, bEnabled);
	});
	DefinePlayerMethod(NativePlayer, "GetClientCVarValue", function PlayerGetClientCVarValue(strConVarName) {
		return GetClientCVarValue(this, strConVarName);
	});
	DefinePlayerMethod(NativePlayer, "GetNetInfo", function PlayerGetNetworkInformation() {
		return GetNetInfo(this);
	});
	DefinePlayerMethod(NativePlayer, "SendConVarValue", function PlayerSendConVarValue(strConVarName, strConVarValue) {
		return SendConVarValue(this, strConVarName, strConVarValue);
	});
	DefinePlayerMethod(NativePlayer, "GetSpectators", function PlayerGetSpectators() {
		return GetSpectators(this);
	});
	DefinePlayerMethod(NativePlayer, "Spawn", function PlayerSpawn(bForce = false) {
		return Spawn(this, bForce);
	});
	DefinePlayerMethod(NativePlayer, "GetActiveWeapon", function PlayerGetActiveWeapon() {
		return GetActiveWeapon(this);
	});
	DefinePlayerMethod(NativePlayer, "SetActiveWeapon", function PlayerSetActiveWeapon(WeaponReference) {
		return SetActiveWeapon(this, WeaponReference);
	});
	DefinePlayerMethod(NativePlayer, "GetWeaponIndexes", function PlayerGetWeaponIndexes(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
		return GetWeaponIndexes(this, strClassName, RequiredWeaponFilters, ExcludedWeaponFilters);
	});
	DefinePlayerMethod(NativePlayer, "GetWeapons", function PlayerGetWeapons(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
		return GetWeapons(this, strClassName, RequiredWeaponFilters, ExcludedWeaponFilters);
	});
	DefinePlayerMethod(NativePlayer, "GetWeapon", function PlayerGetWeapon(strClassName = null, RequiredWeaponFilters = null, ExcludedWeaponFilters = null) {
		return GetWeapon(this, strClassName, RequiredWeaponFilters, ExcludedWeaponFilters);
	});
	DefinePlayerMethod(NativePlayer, "GetPrimaryWeapon", function PlayerGetPrimaryWeapon() {
		return GetPrimaryWeapon(this);
	});
	DefinePlayerMethod(NativePlayer, "GetSecondaryWeapon", function PlayerGetSecondaryWeapon() {
		return GetSecondaryWeapon(this);
	});
	DefinePlayerMethod(NativePlayer, "GetProjectileAmmo", function PlayerGetProjectileAmmo(strProjectileName) {
		return GetProjectileAmmo(this, strProjectileName);
	});
	DefinePlayerMethod(NativePlayer, "SetProjectileAmmo", function PlayerSetProjectileAmmo(strProjectileName, nAmmoValue) {
		return SetProjectileAmmo(this, strProjectileName, nAmmoValue);
	});
	DefinePlayerMethod(NativePlayer, "GetProjectileIndexes", function PlayerGetProjectileIndexes(strProjectileName) {
		return GetProjectileIndexes(this, strProjectileName);
	});
	DefinePlayerMethod(NativePlayer, "RestrictWeapons", function PlayerRestrictWeapons(...vecWeaponsToRestrict) {
		return RestrictWeapons(this, ...vecWeaponsToRestrict);
	});
	DefinePlayerMethod(NativePlayer, "UnrestrictWeapons", function PlayerUnrestrictWeapons(...vecWeaponsToUnrestrict) {
		return UnrestrictWeapons(this, ...vecWeaponsToUnrestrict);
	});
	DefinePlayerMethod(NativePlayer, "IsWeaponRestricted", function PlayerIsWeaponRestricted(WeaponReference) {
		return IsWeaponRestricted(this, WeaponReference);
	});
	DefinePlayerMethod(NativePlayer, "DropWeapon", function PlayerDropWeapon(WeaponReference, DropTarget = null, DropVelocity = null) {
		return DropWeapon(this, WeaponReference, DropTarget, DropVelocity);
	});

	return NativePlayer;
}

function GetAllPlayers() {
	const vecConnectedPlayers = g_PlayersRuntime.GetAllPlayers();
	for (let unPlayerListIndex = 0; unPlayerListIndex < vecConnectedPlayers.length; ++unPlayerListIndex) {
		vecConnectedPlayers[unPlayerListIndex] = DecoratePlayer(vecConnectedPlayers[unPlayerListIndex]);
	}

	return vecConnectedPlayers;
}

function GetClientCount() {
	return g_PlayersRuntime.GetClientCount();
}

function GetMaximumClients() {
	return g_PlayersRuntime.GetMaximumClients();
}

const g_PlayersAPI = {
	Player,
	GetAllPlayers,
	Ban,
	ChangeTeam,
	ExecuteClientCommand,
	GetClientCount,
	DecoratePlayer,
	DropWeapon,
	FireGameEvent,
	FromUserID,
	GetActiveWeapon,
	GetClientCVarValue,
	GetEyeLocation,
	GetFlashlight,
	GetGodMode,
	GetJetpack,
	GetLanguage,
	GetNoBlock,
	GetNoClip,
	GetNetInfo,
	GetName,
	GetPermissions,
	GetProjectileAmmo,
	GetRawSteamID,
	GetStuck,
	GetTeam,
	GetTeamName,
	GetPlayerClass,
	GetPlayerClassName,
	GetTraceRay,
	GetViewCoordinates,
	GetViewEntity,
	GetViewPlayer,
	GetViewVector,
	GetWeapon,
	IsBot,
	IsConnected,
	IsDead,
	IsFakeClient,
	IsHLTV,
	IsInAVehicle,
	IsMuted,
	IsObserver,
	IsWeaponRestricted,
	Kick,
	GetMaximumClients,
	Mute,
	PlaySound,
	GetPrimaryWeapon,
	GetProjectileIndexes,
	Push,
	RestrictWeapons,
	Say,
	SayTeam,
	GetSecondaryWeapon,
	SendConVarValue,
	SetActiveWeapon,
	SetEyeLocation,
	SetFlashlight,
	SetGodMode,
	SetJetpack,
	SetName,
	SetNoBlock,
	SetNoClip,
	SetProjectileAmmo,
	SetPlayerClass,
	SetPlayerClassName,
	SetStuck,
	SetTeam,
	SetTeamName,
	SetViewCoordinates,
	SetViewEntity,
	SetViewPlayer,
	Slay,
	Spawn,
	GetSpectators,
	Unmute,
	UnrestrictWeapons,
	GetWeaponIndexes,
	GetWeapons,
};

if (Object.hasOwn(g_EntityConstantsRuntime, "FL_FROZEN")) {
	g_PlayersAPI.GetFrozen = GetFrozen;
	g_PlayersAPI.SetFrozen = SetFrozen;
}

module.exports = g_PlayersAPI;
