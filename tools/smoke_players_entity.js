#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "players", "index.js");
const g_strEntityPath = g_Path.join(g_strPackageRootPath, "players", "entity.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-entity.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_vecCalls = [];
const g_mapRestrictions = new Map();

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = flX;
		this.Y = flY;
		this.Z = flZ;
	}
}

const g_vecWeapons = [
	{ ClassName: "weapon_rifle", Index: 30, Weapon: "rifle" },
	{ ClassName: "weapon_pistol", Index: 31, Weapon: "pistol" },
];

const g_mapPlayerStates = new Map([
	[1, {
		ActiveWeapon: g_vecWeapons[0],
		Flashlight: false,
		Frozen: false,
		GodMode: false,
		Health: 82,
		Jetpack: false,
		MaximumHealth: 100,
		Muted: false,
		Name: "Ren",
		NoBlock: false,
		NoClip: false,
		PlayerClass: 1,
		ProjectileAmmo: 4,
		Stuck: false,
		Team: 2,
	}],
	[2, {
		ActiveWeapon: g_vecWeapons[1],
		Flashlight: false,
		Frozen: false,
		GodMode: false,
		Health: 100,
		Jetpack: false,
		MaximumHealth: 100,
		Muted: false,
		Name: "Spectator",
		NoBlock: false,
		NoClip: false,
		PlayerClass: 1,
		ProjectileAmmo: 2,
		Stuck: false,
		Team: 1,
	}],
]);

const g_mapPlayers = new Map();

const g_unDocumentationBlockCount = 15;
const g_unExpectedPlayerMethodCount = 77;
const g_unIntroductoryDocumentationBlockCount = 4;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_IntroductoryDocumentationBlocks = { Identity: 0, TemporaryProperties: 1, Profile: 2, Notification: 3 };
const g_StateDocumentationBlocks = { Administration: 4, MutedSender: 5, TemporaryState: 6, Movement: 7, View: 8 };
const g_InventoryDocumentationBlocks = { Network: 9, Weapons: 10, Projectile: 11, Restrictions: 12, Drop: 13, Loadout: 14 };

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
const g_mapPackageCacheDescriptors = new Map();

let g_bMainFailed = false;
let g_MainError = null;

function RecordCall(nPlayerIndex, strName, ...vecArguments) {
	g_vecCalls.push([nPlayerIndex, strName, ...vecArguments]);
}

function MakePlayer(nPlayerIndex) {
	const State = g_mapPlayerStates.get(nPlayerIndex);
	if (!State) {
		throw new RangeError(`Unknown fixture player index: ${nPlayerIndex}`);
	}

	const unBaseEntityAddress = 0x200000n + BigInt(nPlayerIndex);
	const unEdictAddress = 0x100000n + BigInt(nPlayerIndex);
	const Player = {
		Ban(unDuration = 0, bKickPlayer = true, bWriteBan = true) {
			RecordCall(nPlayerIndex, "Ban", unDuration, bKickPlayer, bWriteBan);

			return true;
		},

		BaseEntity: { Kind: "baseentity", Address: unBaseEntityAddress, Index: nPlayerIndex, ClassName: "player" },
		BaseHandle: { Kind: "basehandle", Value: 0x800 + nPlayerIndex, EntryIndex: nPlayerIndex, SerialNumber: 8, Valid: true },

		CallInput(strInputName, Value = null, flDelay = 0) {
			RecordCall(nPlayerIndex, "CallInput", strInputName, Value, flDelay);

			return true;
		},

		ChangeTeam(unTeam) {
			RecordCall(nPlayerIndex, "ChangeTeam", unTeam);
			State.Team = unTeam;

			return true;
		},

		ClassName: "player",

		ExecuteClientCommand(strCommand, bServerSide = false) {
			RecordCall(nPlayerIndex, "ExecuteClientCommand", strCommand, bServerSide);

			return true;
		},

		DropWeapon(Weapon, Target = null, Velocity = null) {
			RecordCall(nPlayerIndex, "DropWeapon", Weapon, Target, Velocity);

			return true;
		},

		Edict: { Kind: "edict", Address: unEdictAddress, Index: nPlayerIndex, ClassName: "player" },

		FireGameEvent(strEventName, Payload = {}, bDoNotBroadcast = false) {
			RecordCall(nPlayerIndex, "FireGameEvent", strEventName, Payload, bDoNotBroadcast);

			return true;
		},

		Free: false,

		GetActiveWeapon() {
			RecordCall(nPlayerIndex, "GetActiveWeapon");

			return State.ActiveWeapon;
		},

		GetClientCVarValue(strConVarName) {
			RecordCall(nPlayerIndex, "GetClientCVarValue", strConVarName);

			return (strConVarName === "cl_language") ? "russian" : "";
		},

		GetEyeLocation() {
			RecordCall(nPlayerIndex, "GetEyeLocation");

			return new Vector(10, 20, 72);
		},

		GetFlashlight() {
			RecordCall(nPlayerIndex, "GetFlashlight");

			return State.Flashlight;
		},

		GetFrozen() {
			RecordCall(nPlayerIndex, "GetFrozen");

			return State.Frozen;
		},

		GetGodMode() {
			RecordCall(nPlayerIndex, "GetGodMode");

			return State.GodMode;
		},

		GetJetpack() {
			RecordCall(nPlayerIndex, "GetJetpack");

			return State.Jetpack;
		},

		GetLanguage() {
			RecordCall(nPlayerIndex, "GetLanguage");

			return "russian";
		},

		GetName() {
			RecordCall(nPlayerIndex, "GetName");

			return State.Name;
		},

		GetNetInfo() {
			RecordCall(nPlayerIndex, "GetNetInfo");

			return {
				GetNetChannelLatency(nFlow) {
					RecordCall(nPlayerIndex, "GetNetChannelLatency", nFlow);

					return 0.05;
				},
			};
		},

		GetNoBlock() {
			RecordCall(nPlayerIndex, "GetNoBlock");

			return State.NoBlock;
		},

		GetNoClip() {
			RecordCall(nPlayerIndex, "GetNoClip");

			return State.NoClip;
		},

		GetPermissions() {
			RecordCall(nPlayerIndex, "GetPermissions");

			return { Permissions: ["admin"] };
		},

		GetPlayerClass() {
			RecordCall(nPlayerIndex, "GetPlayerClass");

			return State.PlayerClass;
		},

		GetPlayerClassName() {
			RecordCall(nPlayerIndex, "GetPlayerClassName");

			return "scout";
		},

		GetProjectileAmmo(strProjectileName) {
			RecordCall(nPlayerIndex, "GetProjectileAmmo", strProjectileName);

			return State.ProjectileAmmo;
		},

		GetRawSteamID() {
			RecordCall(nPlayerIndex, "GetRawSteamID");

			return {
				Render() {
					return "STEAM_1:1:1234";
				},
			};
		},

		GetStuck() {
			RecordCall(nPlayerIndex, "GetStuck");

			return State.Stuck;
		},

		GetTeam() {
			RecordCall(nPlayerIndex, "GetTeam");

			return State.Team;
		},

		GetTeamName() {
			RecordCall(nPlayerIndex, "GetTeamName");

			return (State.Team === 2) ? "survivor" : "spectator";
		},

		GetTraceRay() {
			RecordCall(nPlayerIndex, "GetTraceRay");

			return { EndPosition: new Vector(100, 20, 72), Fraction: 0.5, Hit: true };
		},

		GetViewCoordinates() {
			RecordCall(nPlayerIndex, "GetViewCoordinates");

			return new Vector(100, 20, 72);
		},

		GetViewEntity() {
			RecordCall(nPlayerIndex, "GetViewEntity");

			return { Index: 42 };
		},

		GetViewPlayer() {
			RecordCall(nPlayerIndex, "GetViewPlayer");

			if (!g_mapPlayers.has(2)) {
				g_mapPlayers.set(2, MakePlayer(2));
			}

			return g_mapPlayers.get(2);
		},

		GetViewVector() {
			RecordCall(nPlayerIndex, "GetViewVector");

			return new Vector(1, 0, 0);
		},

		GetWeapon(strClassName = null, vecRequiredFilters = null, vecExcludedFilters = null) {
			RecordCall(nPlayerIndex, "GetWeapon", strClassName, vecRequiredFilters, vecExcludedFilters);

			return g_vecWeapons[0];
		},

		GiveNamedItem(strItemClassName, nSubtype = 0, bRemoveIfNotCarried = undefined) {
			RecordCall(nPlayerIndex, "GiveNamedItem", strItemClassName, nSubtype, bRemoveIfNotCarried);

			return { ClassName: strItemClassName, Index: 40 };
		},

		HandleValue: 0x800 + nPlayerIndex,
		Index: nPlayerIndex,

		IsBot() {
			RecordCall(nPlayerIndex, "IsBot");

			return false;
		},

		IsConnected() {
			RecordCall(nPlayerIndex, "IsConnected");

			return true;
		},

		IsDead() {
			RecordCall(nPlayerIndex, "IsDead");

			return false;
		},

		IsFakeClient() {
			RecordCall(nPlayerIndex, "IsFakeClient");

			return false;
		},

		IsHLTV() {
			RecordCall(nPlayerIndex, "IsHLTV");

			return false;
		},

		IsInAVehicle() {
			RecordCall(nPlayerIndex, "IsInAVehicle");

			return false;
		},

		IsMuted() {
			RecordCall(nPlayerIndex, "IsMuted");

			return State.Muted;
		},

		IsObserver() {
			RecordCall(nPlayerIndex, "IsObserver");

			return nPlayerIndex === 2;
		},

		IsWeaponRestricted(strWeaponName) {
			RecordCall(nPlayerIndex, "IsWeaponRestricted", strWeaponName);

			return g_mapRestrictions.get(nPlayerIndex)?.has(strWeaponName) ?? false;
		},

		Kick(strMessage = "") {
			RecordCall(nPlayerIndex, "Kick", strMessage);

			return true;
		},

		Mute(vecReceivers = null) {
			RecordCall(nPlayerIndex, "Mute", vecReceivers);
			State.Muted = true;

			return true;
		},

		NetworkSerialNumber: 8,

		PlaySound(strSample, Options = {}) {
			RecordCall(nPlayerIndex, "PlaySound", strSample, Options);

			return true;
		},

		Address: unBaseEntityAddress,

		GetPrimaryWeapon() {
			RecordCall(nPlayerIndex, "GetPrimaryWeapon");

			return g_vecWeapons[0];
		},

		GetProjectileIndexes(strProjectileName) {
			RecordCall(nPlayerIndex, "GetProjectileIndexes", strProjectileName);

			return [50];
		},

		Push(flHorizontal, flVertical, bVerticalOverride = false) {
			RecordCall(nPlayerIndex, "Push", flHorizontal, flVertical, bVerticalOverride);

			return true;
		},

		Remove() {
			RecordCall(nPlayerIndex, "Remove");

			return true;
		},

		RestrictWeapons(...vecWeaponNames) {
			RecordCall(nPlayerIndex, "RestrictWeapons", ...vecWeaponNames);

			const vecValues = vecWeaponNames.flat();
			const setPlayerRestrictions = g_mapRestrictions.get(nPlayerIndex) ?? new Set();
			for (const strWeapon of vecValues) {
				setPlayerRestrictions.add(strWeapon);
			}

			g_mapRestrictions.set(nPlayerIndex, setPlayerRestrictions);

			return true;
		},

		Say(strMessage) {
			RecordCall(nPlayerIndex, "Say", strMessage);

			return true;
		},

		SayTeam(strMessage) {
			RecordCall(nPlayerIndex, "SayTeam", strMessage);

			return true;
		},

		GetSecondaryWeapon() {
			RecordCall(nPlayerIndex, "GetSecondaryWeapon");

			return g_vecWeapons[1];
		},

		SendConVarValue(strConVarName, strConVarValue) {
			RecordCall(nPlayerIndex, "SendConVarValue", strConVarName, strConVarValue);

			return true;
		},

		SetActiveWeapon(Weapon) {
			RecordCall(nPlayerIndex, "SetActiveWeapon", Weapon);
			State.ActiveWeapon = Weapon;

			return true;
		},

		SetEyeLocation(Value) {
			RecordCall(nPlayerIndex, "SetEyeLocation", Value);

			return true;
		},

		SetFlashlight(bEnabled) {
			RecordCall(nPlayerIndex, "SetFlashlight", bEnabled);
			State.Flashlight = bEnabled;

			return true;
		},

		SetFrozen(bEnabled) {
			RecordCall(nPlayerIndex, "SetFrozen", bEnabled);
			State.Frozen = bEnabled;

			return true;
		},

		SetGodMode(bEnabled) {
			RecordCall(nPlayerIndex, "SetGodMode", bEnabled);
			State.GodMode = bEnabled;

			return true;
		},

		SetJetpack(bEnabled) {
			RecordCall(nPlayerIndex, "SetJetpack", bEnabled);
			State.Jetpack = bEnabled;
			State.NoClip = false;
			State.Stuck = false;

			return true;
		},

		SetName(strName) {
			RecordCall(nPlayerIndex, "SetName", strName);
			State.Name = strName;

			return true;
		},

		SetNoBlock(bEnabled) {
			RecordCall(nPlayerIndex, "SetNoBlock", bEnabled);
			State.NoBlock = bEnabled;

			return true;
		},

		SetNoClip(bEnabled) {
			RecordCall(nPlayerIndex, "SetNoClip", bEnabled);
			State.Jetpack = false;
			State.NoClip = bEnabled;
			State.Stuck = false;

			return true;
		},

		SetPlayerClass(nPlayerClass) {
			RecordCall(nPlayerIndex, "SetPlayerClass", nPlayerClass);
			State.PlayerClass = nPlayerClass;

			return true;
		},

		SetPlayerClassName(strPlayerClassName) {
			RecordCall(nPlayerIndex, "SetPlayerClassName", strPlayerClassName);
			State.PlayerClass = (strPlayerClassName === "scout") ? 1 : State.PlayerClass;

			return true;
		},

		SetProjectileAmmo(strProjectileName, nAmmoValue) {
			RecordCall(nPlayerIndex, "SetProjectileAmmo", strProjectileName, nAmmoValue);
			State.ProjectileAmmo = nAmmoValue;

			return true;
		},

		SetStuck(bEnabled) {
			RecordCall(nPlayerIndex, "SetStuck", bEnabled);
			State.Jetpack = false;
			State.NoClip = false;
			State.Stuck = bEnabled;

			return true;
		},

		SetTeam(unTeam) {
			RecordCall(nPlayerIndex, "SetTeam", unTeam);
			State.Team = unTeam;

			return true;
		},

		SetTeamName(strTeamName) {
			RecordCall(nPlayerIndex, "SetTeamName", strTeamName);
			State.Team = (strTeamName === "survivor") ? 2 : State.Team;

			return true;
		},

		SetViewCoordinates(Value) {
			RecordCall(nPlayerIndex, "SetViewCoordinates", Value);

			return true;
		},

		SetViewEntity(Entity) {
			RecordCall(nPlayerIndex, "SetViewEntity", Entity);

			return true;
		},

		SetViewPlayer(Target) {
			RecordCall(nPlayerIndex, "SetViewPlayer", Target);

			return true;
		},

		Slay() {
			RecordCall(nPlayerIndex, "Slay");

			return true;
		},

		Spawn(bForce = false) {
			RecordCall(nPlayerIndex, "Spawn", bForce);

			return true;
		},

		GetSpectators() {
			RecordCall(nPlayerIndex, "GetSpectators");

			if (nPlayerIndex !== 1) {
				return [];
			}

			if (!g_mapPlayers.has(2)) {
				g_mapPlayers.set(2, MakePlayer(2));
			}

			return [g_mapPlayers.get(2)];
		},

		StateFlags: 0,

		Unmute(vecReceivers = null) {
			RecordCall(nPlayerIndex, "Unmute", vecReceivers);
			State.Muted = false;

			return true;
		},

		UnrestrictWeapons(...vecWeaponNames) {
			RecordCall(nPlayerIndex, "UnrestrictWeapons", ...vecWeaponNames);

			const vecValues = vecWeaponNames.flat();
			const setPlayerRestrictions = g_mapRestrictions.get(nPlayerIndex) ?? new Set();
			for (const strWeapon of vecValues) {
				setPlayerRestrictions.delete(strWeapon);
			}

			return true;
		},

		Valid: true,

		GetWeaponIndexes(strClassName = null, vecRequiredFilters = null, vecExcludedFilters = null) {
			RecordCall(nPlayerIndex, "GetWeaponIndexes", strClassName, vecRequiredFilters, vecExcludedFilters);

			return g_vecWeapons.map((Weapon) => Weapon.Index);
		},

		GetWeapons(strClassName = null, vecRequiredFilters = null, vecExcludedFilters = null) {
			RecordCall(nPlayerIndex, "GetWeapons", strClassName, vecRequiredFilters, vecExcludedFilters);

			return g_vecWeapons;
		},
	};

	Object.defineProperties(Player, {
		Connected: {
			enumerable: true,

			get() {
				return true;
			},
		},

		Dead: {
			enumerable: true,

			get() {
				return false;
			},
		},

		Deaths: {
			enumerable: true,

			get() {
				return 3;
			},
		},

		FakeClient: {
			enumerable: true,

			get() {
				return false;
			},
		},

		Frags: {
			enumerable: true,

			get() {
				return 12;
			},
		},

		Health: {
			enumerable: true,

			get() {
				return State.Health;
			},

			set(nHealth) {
				RecordCall(nPlayerIndex, "Health=", nHealth);
				State.Health = nHealth;
			},
		},

		Language: {
			enumerable: true,

			get() {
				return "russian";
			},
		},

		MaximumHealth: {
			enumerable: true,

			get() {
				return State.MaximumHealth;
			},

			set(nMaximumHealth) {
				RecordCall(nPlayerIndex, "MaximumHealth=", nMaximumHealth);
				State.MaximumHealth = nMaximumHealth;
			},
		},

		Model: {
			enumerable: true,

			get() {
				return "models/survivors/survivor_manager.mdl";
			},
		},

		Name: {
			enumerable: true,

			get() {
				return State.Name;
			},

			set(strPlayerName) {
				RecordCall(nPlayerIndex, "Name=", strPlayerName);
				State.Name = strPlayerName;
			},
		},

		NetworkID: {
			enumerable: true,

			get() {
				return "STEAM_1:1:1234";
			},
		},

		Origin: {
			enumerable: true,

			get() {
				return new Vector(10, 20, 0);
			},
		},

		RemoteAddress: {
			enumerable: true,

			get() {
				return "127.0.0.1:27005";
			},
		},

		Team: {
			enumerable: true,

			get() {
				return State.Team;
			},

			set(unTeam) {
				RecordCall(nPlayerIndex, "Team=", unTeam);
				State.Team = unTeam;
			},
		},

		UserID: {
			enumerable: true,

			get() {
				return nPlayerIndex + 100;
			},
		},

		Weapon: {
			enumerable: true,

			get() {
				return State.ActiveWeapon.Weapon;
			},
		},
	});

	return Player;
}

function Player(nPlayerIndex) {
	if (!g_mapPlayers.has(nPlayerIndex)) {
		g_mapPlayers.set(nPlayerIndex, MakePlayer(nPlayerIndex));
	}

	return g_mapPlayers.get(nPlayerIndex);
}

function IsPackageCachePath(strPath) {
	return (strPath === g_strPackageRootPath) || strPath.startsWith(g_strPackageRootPath + g_Path.sep);
}

function ClearPackageCache() {
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strPath) && !Reflect.deleteProperty(require.cache, strPath)) {
			throw new Error("Cannot clear temporary players/entity package cache: " + strPath);
		}
	}
}

function LoadPlayerEntityModule() {
	let EntityModule = null;
	let bFailed = false;
	let OriginalError = null;

	try {
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "players") {
				return require(g_strBasePath);
			}

			return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		EntityModule = require(g_strEntityPath);
	} catch (CaughtError) {
		bFailed = true;
		OriginalError = CaughtError;
	}

	try {
		Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
	} catch (CleanupError) {
		if (bFailed) {
			throw new AggregateError([OriginalError, CleanupError], "Player entity module loading and loader restoration failed.");
		}

		throw CleanupError;
	}

	if (bFailed) {
		throw OriginalError;
	}

	return EntityModule;
}

function RunDocumentationWorkflow(Workflow, strLabel) {
	// Same-realm closures preserve native values; this deadline is not a security sandbox or native IO cancellation.
	const Script = new g_VM.Script("Workflow()", { filename: g_strDocumentationPath + ":" + strLabel });

	return Script.runInNewContext({ Workflow }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function CompileDocumentationModule(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + ":fence" + (unBlockIndex + 1) });
}

function AssertThrownValue(Callback, Expected, strMissingErrorMessage = undefined, strOriginalErrorMessage = undefined) {
	let bThrown = false;
	let Actual = null;

	try {
		Callback();
	} catch (CaughtError) {
		bThrown = true;
		Actual = CaughtError;
	}

	g_Assert.equal(bThrown, true, strMissingErrorMessage);
	g_Assert.equal(Actual, Expected, strOriginalErrorMessage);
}

function InstallDependency(strFilePath, ModuleExports) {
	Object.defineProperty(require.cache, strFilePath, { configurable: true, enumerable: true, writable: true, value: { children: [], exports: ModuleExports, filename: strFilePath, id: strFilePath, loaded: true, paths: [] } });
}

function CheckCanonicalPlayerFactory() {
	const strSource = g_FileSystem.readFileSync(g_strBasePath, "utf8");
	const vecDefinition = strSource.match(/^function Player\(PlayerReference\) \{\r?\n\treturn DecoratePlayer\(g_PlayersRuntime.GetPlayer\(PlayerReference\)\);\r?\n\}/m);
	g_Assert.ok(vecDefinition, "Player must name and forward its number-or-object reference without coercion.");

	const CreateFactory = g_VM.compileFunction(vecDefinition[0] + "\nreturn Player;", ["g_PlayersRuntime", "DecoratePlayer"], { filename: g_strBasePath + ":Player" });
	for (const PlayerReference of [1, { Index: 1 }, Object.create({ Index: 1 })]) {
		const NativePlayer = {};
		const DecoratedPlayer = {};
		const vecCalls = [];
		const Runtime = {
			GetPlayer(Reference) {
				vecCalls.push(["NATIVE", Reference]);

				return NativePlayer;
			},
		};

		const Decorate = (Value) => {
			vecCalls.push(["DECORATE", Value]);

			return DecoratedPlayer;
		};
		const Factory = CreateFactory(Runtime, Decorate);
		g_Assert.equal(Factory(PlayerReference), DecoratedPlayer);
		g_Assert.deepEqual(vecCalls, [["NATIVE", PlayerReference], ["DECORATE", NativePlayer]]);
		g_Assert.equal(vecCalls[0][1], PlayerReference);
		g_Assert.equal(vecCalls[1][1], NativePlayer);
	}

	for (const Failure of [new Error("factory failure"), null]) {
		const FailingRuntime = {
			GetPlayer() {
				throw Failure;
			},
		};

		const RejectDecoration = () => {
			throw new Error("Decoration must not run after a native failure.");
		};
		const NativeFailureFactory = CreateFactory(FailingRuntime, RejectDecoration);
		AssertThrownValue(() => NativeFailureFactory(1), Failure);

		const NullRuntime = { GetPlayer: () => null };
		const FailDecoration = () => {
			throw Failure;
		};
		const DecorationFailureFactory = CreateFactory(NullRuntime, FailDecoration);
		AssertThrownValue(() => DecorationFailureFactory(1), Failure);
	}
}

g_Assert.equal(typeof g_OriginalModuleLoad, "function", "Node module loader must have its normal data descriptor.");

for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (IsPackageCachePath(strPath)) {
		const Descriptor = Object.getOwnPropertyDescriptor(require.cache, strPath);
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
		g_mapPackageCacheDescriptors.set(strPath, Descriptor);
	}
}

try {
	ClearPackageCache();
	CheckCanonicalPlayerFactory();
	InstallDependency(g_strBasePath, { Player });
	const g_Entity = LoadPlayerEntityModule();
	g_Assert.ok(g_Entity.Player === Player, "players/entity must expose the canonical Player factory directly.");
	g_Assert.ok(g_Entity.Player(1) === Player(1), "Player must preserve native wrapper identity.");
	g_Assert.deepEqual(Object.keys(g_Entity), ["Player"], "players/entity exact exports");
	g_Assert.ok(!Object.hasOwn(g_Entity, "byIndex"), "players/entity must not expose byIndex.");
	g_Assert.ok(!Object.hasOwn(g_Entity, "moduleName"), "players/entity must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_Entity, "default"), "players/entity must not expose a default alias.");

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "mathlib") {
			return { Vector };
		}

		if (strModuleName === "netchannel") {
			return { NET_FLOW: { InOut: 2, Incoming: 1, Outgoing: 0 } };
		}

		if (strModuleName === "players/entity") {
			return g_Entity;
		}

		if (strModuleName === "players/engines") {
			return { Branch: "csgo" };
		}

		if (strModuleName === "players/teams") {
			return {
				ClassesByNumber() {
					return { 1: "scout" };
				},

				Names() {
					return { spectator: 1, survivor: 2 };
				},
			};
		}

		throw new Error(`unexpected players/entity documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/entity documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/entity documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "players/entity documentation must not use console output.");
	g_Assert.ok(g_strDocumentation.includes("IPlayerInfo::ChangeTeam()"), "players/entity documentation must identify the native team writer.");
	g_Assert.ok(g_strDocumentation.includes("CBaseEntity::SetHealth()"), "players/entity documentation must identify the native health writer.");
	g_Assert.ok(g_strDocumentation.includes("CBasePlayer::GiveNamedItem()"), "players/entity documentation must identify the native item operation.");

	function CheckPlayerEntityIntroductoryDocumentation() {
		let unScenarioCount = 0;
		const CreateScenario = (unCodeBlockIndex, Configuration = {}) => {
			const State = Object.assign({ Address: 0x200001n, Connected: true, Health: 82, Index: 1, MaximumHealth: 100, Name: "Ren", NetworkID: "STEAM_1:1:1234", UserID: 101 }, Configuration.State);
			const vecCalls = [];
			const mapReads = new Map();
			const mapWrites = new Map();
			const PlayerValue = {};
			let unResolutions = 0;

			for (const strPropertyName of Object.keys(State)) {
				Object.defineProperty(PlayerValue, strPropertyName, {
					configurable: true,

					get() {
						const unReadCount = (mapReads.get(strPropertyName) || 0) + 1;
						mapReads.set(strPropertyName, unReadCount);

						if (Configuration.Read) {
							Configuration.Read(strPropertyName, unReadCount, State);
						}

						return State[strPropertyName];
					},

					set(Value) {
						const unWriteCount = (mapWrites.get(strPropertyName) || 0) + 1;
						mapWrites.set(strPropertyName, unWriteCount);
						vecCalls.push([strPropertyName, Value]);

						if (Configuration.Write) {
							Configuration.Write(strPropertyName, unWriteCount, State, Value);
						}

						State[strPropertyName] = Value;
					},
				});
			}

			for (const strMethodName of [
				"ExecuteClientCommand",
				"Say",
				"SayTeam",
				"PlaySound",
				"FireGameEvent",
				"SetName",
				"SetTeam",
				"SetTeamName",
				"SetPlayerClass",
				"SetPlayerClassName",
			]) {
				PlayerValue[strMethodName] = (...vecArguments) => {
					vecCalls.push([strMethodName, ...vecArguments]);

					return Configuration.MethodResult ? Configuration.MethodResult(strMethodName, vecArguments) : true;
				};
			}

			PlayerValue.IsConnected = () => Object.hasOwn(Configuration, "Connected") ? Configuration.Connected : true;
			PlayerValue.IsFakeClient = () => Object.hasOwn(Configuration, "FakeClient") ? Configuration.FakeClient : false;

			const PlayerFactory = () => {
				++unResolutions;

				if (Object.hasOwn(Configuration, "PlayerError")) {
					throw Configuration.PlayerError;
				}

				return PlayerValue;
			};
			const RequireExample = (strModuleName) => (strModuleName === "players/entity") ? { Player: PlayerFactory } : RequireDocumentationModule(strModuleName);

			const ModuleRecord = { exports: {} };
			const Callback = CompileDocumentationModule(g_vecCodeBlocks[unCodeBlockIndex], unCodeBlockIndex);
			Callback(RequireExample, ModuleRecord, ModuleRecord.exports);
			g_Assert.equal(unResolutions, 0, "Loading an example must not resolve players.");
			g_Assert.equal(vecCalls.length, 0, "Loading an example must not mutate players.");

			return {
				API: ModuleRecord.exports,
				Calls: vecCalls,
				Reads: mapReads,
				State,
				Writes: mapWrites,

				get ResolutionCount() {
					return unResolutions;
				},
			};
		};

		const Invoke = (Scenario, unCodeBlockIndex, ...vecIndexes) => {
			const nPlayerIndex = (vecIndexes.length === 0) ? 1 : vecIndexes[0];
			switch (unCodeBlockIndex) {
				case g_IntroductoryDocumentationBlocks.Identity:
					return Scenario.API.GetPlayerIdentity(nPlayerIndex);

				case g_IntroductoryDocumentationBlocks.TemporaryProperties:
					return Scenario.API.WithTemporaryPlayerProperties(nPlayerIndex, "Temporary");

				case g_IntroductoryDocumentationBlocks.Profile:
					return Scenario.API.ApplyPlayerProfile(nPlayerIndex, { Name: "New Name", PlayerClass: 1, Team: 2 });

				case g_IntroductoryDocumentationBlocks.Notification:
					return Scenario.API.NotifyPlayer(nPlayerIndex, "player_say", { text: "Hello" }, "buttons/button14.wav");

				default:
					throw new Error("Only the four reviewed introductory examples belong to this fixture.");
			}
		};

		for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_unIntroductoryDocumentationBlockCount; ++unCodeBlockIndex) {
			for (const InvalidIndex of [
				-1,
				0,
				1.5,
				NaN,
				Infinity,
				"1",
				1n,
				0x80000000,
				{},
				null,
				undefined,
			]) {
				const Scenario = CreateScenario(unCodeBlockIndex);
				g_Assert.throws(() => Invoke(Scenario, unCodeBlockIndex, InvalidIndex), TypeError);
				g_Assert.equal(Scenario.ResolutionCount, 0);
				g_Assert.equal(Scenario.Calls.length, 0);
				++unScenarioCount;
			}

			for (const LookupError of [new Error("native lookup failure"), null]) {
				const Scenario = CreateScenario(unCodeBlockIndex, { PlayerError: LookupError });
				AssertThrownValue(() => Invoke(Scenario, unCodeBlockIndex), LookupError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
				++unScenarioCount;
			}
		}

		const IdentityScenario = CreateScenario(g_IntroductoryDocumentationBlocks.Identity);
		g_Assert.deepEqual(Invoke(IdentityScenario, g_IntroductoryDocumentationBlocks.Identity), { Index: 1, Name: "Ren", NetworkID: "STEAM_1:1:1234", UserID: 101 });
		g_Assert.deepEqual([...IdentityScenario.Reads.values()], [1, 1, 1, 1]);
		++unScenarioCount;

		for (const State of [
			{ Index: 2 },
			{ Name: 3 },
			{ NetworkID: false },
			{ UserID: "101" },
			{ UserID: -2 },
			{ UserID: 0x80000000 },
		]) {
			g_Assert.throws(() => Invoke(CreateScenario(g_IntroductoryDocumentationBlocks.Identity, { State }), g_IntroductoryDocumentationBlocks.Identity), /invalid identity/);
			++unScenarioCount;
		}

		g_Assert.equal(Invoke(CreateScenario(g_IntroductoryDocumentationBlocks.Identity, { State: { UserID: -1 } }), g_IntroductoryDocumentationBlocks.Identity).UserID, -1);
		++unScenarioCount;

		const TemporaryScenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties);
		const TemporaryResult = Invoke(TemporaryScenario, g_IntroductoryDocumentationBlocks.TemporaryProperties);
		g_Assert.equal(TemporaryResult.Name, "Temporary");
		g_Assert.equal(TemporaryResult.Address, 0x200001n);
		g_Assert.equal(TemporaryScenario.State.Name, "Ren");
		g_Assert.equal(TemporaryScenario.State.Health, 82);
		g_Assert.equal(TemporaryScenario.State.MaximumHealth, 100);
		g_Assert.deepEqual(TemporaryScenario.Calls.map((vecCall) => vecCall[0]), ["Name", "MaximumHealth", "Health", "Name", "MaximumHealth", "Health"]);
		g_Assert.equal(TemporaryScenario.Reads.get("MaximumHealth"), 1, "Read the original maximum once.");
		++unScenarioCount;

		for (const PrimaryError of [new Error("result getter failure"), null]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, {
				Read(strPropertyName) {
					if (strPropertyName === "Connected") {
						throw PrimaryError;
					}
				},

				Write(strPropertyName, unWriteCount) {
					if ((strPropertyName === "Name") && (unWriteCount === 2)) {
						throw new Error("secondary restore failure");
					}
				},
			});
			AssertThrownValue(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.TemporaryProperties), PrimaryError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
			g_Assert.equal(Scenario.Writes.get("MaximumHealth"), 2);
			g_Assert.equal(Scenario.Writes.get("Health"), 2);
			++unScenarioCount;
		}

		for (const RestoreError of [new Error("restore failure"), null]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, {
				Write(strPropertyName, unWriteCount) {
					if ((strPropertyName === "Name") && (unWriteCount === 2)) {
						throw RestoreError;
					}
				},
			});
			AssertThrownValue(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.TemporaryProperties), RestoreError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
			g_Assert.equal(Scenario.Writes.get("MaximumHealth"), 2);
			g_Assert.equal(Scenario.Writes.get("Health"), 2);
			++unScenarioCount;
		}

		const PartialWriteError = new Error("setter changed state before failing");
		const PartialWriteScenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, {
			Write(strPropertyName, unWriteCount, State, Value) {
				if ((strPropertyName === "Health") && (unWriteCount === 1)) {
					State.Health = Value;
					throw PartialWriteError;
				}
			},
		});
		AssertThrownValue(() => Invoke(PartialWriteScenario, g_IntroductoryDocumentationBlocks.TemporaryProperties), PartialWriteError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
		g_Assert.equal(PartialWriteScenario.State.Name, "Ren");
		g_Assert.equal(PartialWriteScenario.Writes.get("Health"), 2);
		++unScenarioCount;

		const ReusedSlotScenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, {
			Read(strPropertyName, unReadCount, State) {
				if ((strPropertyName === "UserID") && (unReadCount > 1)) {
					State.UserID = 102;
				}
			},
		});
		g_Assert.throws(() => Invoke(ReusedSlotScenario, g_IntroductoryDocumentationBlocks.TemporaryProperties), /identity changed/);
		g_Assert.equal(ReusedSlotScenario.Calls.length, 3, "Never restore into a reused slot.");
		++unScenarioCount;

		for (const State of [
			{ Health: 0 },
			{ MaximumHealth: 1.5 },
			{ Health: 0x80000000 },
			{ Name: "" },
			{ Name: "bad\0name" },
			{ UserID: -1 },
		]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, { State });
			g_Assert.throws(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.TemporaryProperties));
			g_Assert.equal(Scenario.Calls.length, 0);
			++unScenarioCount;
		}

		const NumericAddressScenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties, { State: { Address: 0x200001 } });
		g_Assert.throws(() => Invoke(NumericAddressScenario, g_IntroductoryDocumentationBlocks.TemporaryProperties), /temporary player result/);
		g_Assert.equal(NumericAddressScenario.State.Name, "Ren");
		g_Assert.equal(NumericAddressScenario.Calls.length, 6);
		++unScenarioCount;

		const ProfileScenario = CreateScenario(g_IntroductoryDocumentationBlocks.Profile);
		const Profile = {};
		const mapProfileReads = new Map();
		for (const strFieldName of ["Name", "Team", "TeamName", "PlayerClass", "PlayerClassName"]) {
			Object.defineProperty(Profile, strFieldName, {
				get() {
					const unReadCount = (mapProfileReads.get(strFieldName) || 0) + 1;
					mapProfileReads.set(strFieldName, unReadCount);
					g_Assert.equal(unReadCount, 1, "Read each profile field only once.");

					return { Name: "New Name", PlayerClass: 1, Team: 2 }[strFieldName];
				},
			});
		}

		g_Assert.deepEqual(ProfileScenario.API.ApplyPlayerProfile(1, Profile), ["Name", "Team", "PlayerClass"]);
		g_Assert.deepEqual([...mapProfileReads.values()], [1, 1, 1, 1, 1]);
		++unScenarioCount;

		for (const InvalidProfile of [
			{ Team: 2, TeamName: "survivor" },
			{ PlayerClass: 1, PlayerClassName: "scout" },
			{ Name: 2 },
			{ Name: "bad\0name" },
			{ Team: -1 },
			{ Team: 0x80000000 },
			{ Team: {} },
			{ PlayerClass: 0x80000000 },
			{ PlayerClass: -0x80000001 },
			null,
			[],
		]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Profile);
			g_Assert.throws(() => Scenario.API.ApplyPlayerProfile(1, InvalidProfile), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			g_Assert.equal(Scenario.Calls.length, 0);
			++unScenarioCount;
		}

		for (const Result of [false, "true"]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Profile, { MethodResult: (strMethodName) => (strMethodName === "SetTeam") ? Result : true });
			g_Assert.throws(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.Profile), /Unable to apply/);
			g_Assert.deepEqual(Scenario.Calls.map((vecCall) => vecCall[0]), ["SetName", "SetTeam"]);
			++unScenarioCount;
		}

		const NotificationScenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification);
		let unPayloadReads = 0;
		const Payload = Object.create({ userid: 999, Inherited: "ignored" }, {
			text: {
				enumerable: true,

				get() {
					++unPayloadReads;

					return "Hello";
				},
			},
		});
		g_Assert.equal(NotificationScenario.API.NotifyPlayer(1, "player_say", Payload, "buttons/button14.wav"), true);
		g_Assert.equal(unPayloadReads, 1);
		g_Assert.deepEqual(Object.keys(NotificationScenario.Calls[4][2]), ["text"]);
		g_Assert.equal(NotificationScenario.Calls[4][2].text, "Hello");
		g_Assert.equal(NotificationScenario.Calls[4][3], true);
		++unScenarioCount;

		for (const Configuration of [{ Connected: false }, { FakeClient: true }]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification, Configuration);
			g_Assert.equal(Invoke(Scenario, g_IntroductoryDocumentationBlocks.Notification), false);
			g_Assert.equal(Scenario.Calls.length, 0);
			++unScenarioCount;
		}

		for (const Configuration of [{ Connected: 1 }, { FakeClient: "false" }]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification, Configuration);
			g_Assert.throws(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.Notification), TypeError);
			g_Assert.equal(Scenario.Calls.length, 0);
			++unScenarioCount;
		}

		const vecNotificationMethods = ["ExecuteClientCommand", "Say", "SayTeam", "PlaySound", "FireGameEvent"];
		for (let unMethodIndex = 0; unMethodIndex < vecNotificationMethods.length; ++unMethodIndex) {
			const strFailedMethod = vecNotificationMethods[unMethodIndex];
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification, { MethodResult: (strMethodName) => strMethodName !== strFailedMethod });
			g_Assert.throws(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.Notification), /Unable to/);
			g_Assert.deepEqual(Scenario.Calls.map((vecCall) => vecCall[0]), vecNotificationMethods.slice(0, unMethodIndex + 1));
			++unScenarioCount;
		}

		for (const vecArguments of [
			[1, "bad\0event", {}, "sample"],
			[1, "event", { userid: 101 }, "sample"],
			[1, "event", {}, "bad\0sample"],
			[1, "event", [], "sample"],
		]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification);
			g_Assert.throws(() => Scenario.API.NotifyPlayer(...vecArguments), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			g_Assert.equal(Scenario.Calls.length, 0);
			++unScenarioCount;
		}

		for (const InvalidName of ["", 3, new String("Temporary"), "bad\0name"]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.TemporaryProperties);
			g_Assert.throws(() => Scenario.API.WithTemporaryPlayerProperties(1, InvalidName), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		for (const InputError of [new Error("input getter failed"), null]) {
			const ProfileScenario = CreateScenario(g_IntroductoryDocumentationBlocks.Profile);
			const Profile = {
				get Name() {
					throw InputError;
				},
			};
			AssertThrownValue(() => ProfileScenario.API.ApplyPlayerProfile(1, Profile), InputError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
			g_Assert.equal(ProfileScenario.ResolutionCount, 0);
			g_Assert.equal(ProfileScenario.Calls.length, 0);

			const NotificationScenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification);
			const Payload = {
				get text() {
					throw InputError;
				},
			};
			AssertThrownValue(() => NotificationScenario.API.NotifyPlayer(1, "player_say", Payload, "sample"), InputError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
			g_Assert.equal(NotificationScenario.ResolutionCount, 0);
			g_Assert.equal(NotificationScenario.Calls.length, 0);
			unScenarioCount += 2;
		}

		for (const OperationError of [new Error("SDK operation failed"), null]) {
			const Scenario = CreateScenario(g_IntroductoryDocumentationBlocks.Notification, {
				MethodResult(strMethodName) {
					if (strMethodName === "PlaySound") {
						throw OperationError;
					}

					return true;
				},
			});
			AssertThrownValue(() => Invoke(Scenario, g_IntroductoryDocumentationBlocks.Notification), OperationError, "The documented operation must throw.", "Preserve the original thrown value, including null.");
			g_Assert.deepEqual(Scenario.Calls.map((vecCall) => vecCall[0]), ["ExecuteClientCommand", "Say", "SayTeam", "PlaySound"]);
			++unScenarioCount;
		}

		console.log("[  OK  ] players/entity introductory documentation: " + unScenarioCount + " scenarios, four reviewed examples (SDK doubles)");
	}

	RunDocumentationWorkflow(CheckPlayerEntityIntroductoryDocumentation, "introductory scenario suite");

	function CheckPlayerEntityStateDocumentation() {
		let unScenarioCount = 0;
		const CreateScenario = (unBlockIndex, Configuration = {}) => {
			const State = Object.assign({ UserID: 101, Flashlight: false, GodMode: false, NoBlock: false, Frozen: false, Jetpack: false, NoClip: false, Stuck: false, EyeLocation: new Vector(10, 20, 72) }, Configuration.State);
			const vecCalls = [];
			const mapCounts = new Map();
			const setMuted = new Set(Configuration.Muted || []);
			let unResolutions = 0;
			const Invoke = (strName, ...vecArguments) => {
				const unCount = (mapCounts.get(strName) || 0) + 1;
				mapCounts.set(strName, unCount);
				vecCalls.push({ Name: strName, Arguments: vecArguments });

				const Default = () => {
					if (strName === "UserID") {
						return State.UserID;
					}

					if (strName === "IsMuted") {
						return vecArguments[0].every((nPlayerIndex) => setMuted.has(nPlayerIndex));
					}

					if ((strName === "Mute") || (strName === "Unmute")) {
						for (const nPlayerIndex of vecArguments[0]) {
							if (strName === "Mute") {
								setMuted.add(nPlayerIndex);
							} else {
								setMuted.delete(nPlayerIndex);
							}
						}

						return true;
					}

					if (strName === "GetSpectators") {
						return [{ Index: 2 }];
					}

					if (strName === "GetTraceRay") {
						return { Fraction: 0.5 };
					}

					if ((strName === "GetViewEntity") || (strName === "GetViewPlayer")) {
						return { Index: 2 };
					}

					if ((strName === "GetViewCoordinates") || (strName === "GetViewVector")) {
						return new Vector(1, 2, 3);
					}

					if (strName === "GetEyeLocation") {
						return State.EyeLocation;
					}

					if (strName === "SetEyeLocation") {
						State.EyeLocation = vecArguments[0];
						return true;
					}

					const strFieldName = strName.slice(3);
					if (Object.hasOwn(State, strFieldName)) {
						if (strName.startsWith("Get")) {
							return State[strFieldName];
						}

						if (strName.startsWith("Set")) {
							State[strFieldName] = vecArguments[0];
							return true;
						}
					}

					return true;
				};

				return Configuration.Override ? Configuration.Override(strName, unCount, State, vecArguments, Default) : Default();
			};

			const PlayerValue = {
				get UserID() {
					return Invoke("UserID");
				},
			};
			for (const strName of [
				"Ban",
				"ChangeTeam",
				"Kick",
				"Spawn",
				"Slay",
				"Mute",
				"Unmute",
				"IsMuted",
				"GetSpectators",
				"GetEyeLocation",
				"SetEyeLocation",
				"Push",
				"GetTraceRay",
				"GetViewCoordinates",
				"GetViewEntity",
				"GetViewPlayer",
				"GetViewVector",
				"SetViewCoordinates",
				"SetViewEntity",
				"SetViewPlayer",
			]) {
				PlayerValue[strName] = (...vecArguments) => Invoke(strName, ...vecArguments);
			}

			for (const strFieldName of [
				"Flashlight",
				"GodMode",
				"NoBlock",
				"Frozen",
				"Jetpack",
				"NoClip",
				"Stuck",
			]) {
				if ((strFieldName === "Frozen") && Configuration.NoFrozen) {
					continue;
				}

				for (const strOperation of ["Get", "Set"]) {
					const strName = strOperation + strFieldName;
					PlayerValue[strName] = function (...vecArguments) {
						g_Assert.equal(this, PlayerValue, "Captured SDK methods must retain their receiver.");

						return Invoke(strName, ...vecArguments);
					};
				}
			}

			const ModuleRecord = { exports: {} };
			const RequireExample = (strName) => (strName === "mathlib") ? { Vector } : {
				Player() {
					++unResolutions;

					if (Object.hasOwn(Configuration, "PlayerError")) {
						throw Configuration.PlayerError;
					}

					return PlayerValue;
				},
			};

			const Callback = CompileDocumentationModule(g_vecCodeBlocks[unBlockIndex], unBlockIndex);
			RunDocumentationWorkflow(() => Callback(RequireExample, ModuleRecord, ModuleRecord.exports), "state load fence " + (unBlockIndex + 1));
			g_Assert.equal(unResolutions, 0);
			g_Assert.equal(vecCalls.length, 0);

			return {
				API: ModuleRecord.exports,
				Calls: vecCalls,
				Counts: mapCounts,
				Muted: setMuted,
				Player: PlayerValue,
				State,

				get ResolutionCount() {
					return unResolutions;
				},
			};
		};

		const vecRuns = [
			[g_StateDocumentationBlocks.Administration, (API, nPlayerIndex) => API.ApplyAdministrativeAction(nPlayerIndex, "KICK")],
			[g_StateDocumentationBlocks.MutedSender, (API, nPlayerIndex) => API.WithSenderMuted(nPlayerIndex, [2], () => 42)],
			[g_StateDocumentationBlocks.TemporaryState, (API, nPlayerIndex) => API.WithTemporaryPlayerState(nPlayerIndex)],
			[g_StateDocumentationBlocks.Movement, (API, nPlayerIndex) => API.SelectMovementMode(nPlayerIndex, "JETPACK")],
			[g_StateDocumentationBlocks.Movement, (API, nPlayerIndex) => API.MovePlayer(nPlayerIndex, new Vector(1, 2, 3), 1, 2)],
			[g_StateDocumentationBlocks.View, (API, nPlayerIndex) => API.InspectPlayerView(nPlayerIndex)],
			[g_StateDocumentationBlocks.View, (API, nPlayerIndex) => API.AimPlayerAt(nPlayerIndex, { Entity: 2 })],
		];

		for (const [unBlockIndex, Run] of vecRuns) {
			for (const InvalidIndex of [
				0,
				-1,
				1.5,
				"1",
				1n,
				NaN,
				Infinity,
				0x80000000,
				undefined,
			]) {
				const Scenario = CreateScenario(unBlockIndex);
				g_Assert.throws(() => Run(Scenario.API, InvalidIndex), TypeError);
				g_Assert.equal(Scenario.ResolutionCount, 0);
				g_Assert.equal(Scenario.Calls.length, 0);
				++unScenarioCount;
			}

			for (const LookupError of [new Error("lookup failed"), null]) {
				const Scenario = CreateScenario(unBlockIndex, { PlayerError: LookupError });
				AssertThrownValue(() => Run(Scenario.API, 1), LookupError, undefined, "Preserve the first thrown value.");
				++unScenarioCount;
			}
		}

		for (const strAction of ["BAN30", "CHANGETEAM", "KICK", "RESPAWN", "SLAY"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Administration);
			g_Assert.equal(Scenario.API.ApplyAdministrativeAction(1, strAction, 2), true);
			g_Assert.equal(Scenario.Calls.length, 1);
			++unScenarioCount;
		}

		for (const strAction of ["kick", "ban-30", "", null, {}]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Administration);
			g_Assert.throws(() => Scenario.API.ApplyAdministrativeAction(1, strAction));
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const MuteScenario = CreateScenario(g_StateDocumentationBlocks.MutedSender, { Muted: [2] });
		g_Assert.equal(MuteScenario.API.WithSenderMuted(1, [2, 2, 3], () => 42), 42);
		g_Assert.deepEqual([...MuteScenario.Muted], [2]);
		g_Assert.deepEqual(MuteScenario.Calls.filter((Call) => Call.Name === "Unmute").map((Call) => Call.Arguments[0]), [[3]]);
		++unScenarioCount;

		for (const PrimaryError of [new Error("callback failed"), null]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.MutedSender, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					if ((strName === "Unmute") && (vecArguments[0][0] === 2)) {
						throw new Error("secondary cleanup failure");
					}

					return Default();
				},
			});
			AssertThrownValue(() => Scenario.API.WithSenderMuted(1, [2, 3], () => {
				throw PrimaryError;
			}), PrimaryError, undefined, "Preserve the first thrown value.");
			g_Assert.equal(Scenario.Counts.get("Unmute"), 2);
			g_Assert.equal(Scenario.Muted.has(3), false);
			++unScenarioCount;
		}

		for (const vecReceivers of [
			[],
			[, 2],
			[0],
			[0x80000000],
			["2"],
		]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.MutedSender);
			g_Assert.throws(() => Scenario.API.WithSenderMuted(1, vecReceivers, () => 42), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const PromiseScenario = CreateScenario(g_StateDocumentationBlocks.MutedSender);
		g_Assert.throws(() => PromiseScenario.API.WithSenderMuted(1, [2], () => Promise.resolve(42)), TypeError);
		g_Assert.equal(PromiseScenario.Muted.size, 0);
		++unScenarioCount;

		const OwnedScenario = CreateScenario(g_StateDocumentationBlocks.MutedSender, { Muted: [2] });
		g_Assert.equal(OwnedScenario.API.WithSenderMuted(1, [2], () => null), null);
		g_Assert.equal(OwnedScenario.Counts.has("Mute"), false);
		g_Assert.equal(OwnedScenario.Counts.has("Unmute"), false);
		++unScenarioCount;

		for (const bNoFrozen of [false, true]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.TemporaryState, { NoFrozen: bNoFrozen });
			const Result = Scenario.API.WithTemporaryPlayerState(1);
			g_Assert.deepEqual(Result, { Frozen: bNoFrozen ? null : true, Flashlight: true, GodMode: true, NoBlock: true });
			g_Assert.equal(Scenario.State.Flashlight, false);
			g_Assert.equal(Scenario.State.GodMode, false);
			g_Assert.equal(Scenario.State.NoBlock, false);
			++unScenarioCount;
		}

		for (const PrimaryError of [new Error("state read failed"), null]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.TemporaryState, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					if ((strName === "GetGodMode") && (unCount === 2)) {
						throw PrimaryError;
					}

					if ((strName === "SetFlashlight") && (unCount === 2)) {
						throw new Error("secondary state cleanup failure");
					}

					return Default();
				},
			});
			AssertThrownValue(() => Scenario.API.WithTemporaryPlayerState(1), PrimaryError, undefined, "Preserve the first thrown value.");
			g_Assert.equal(Scenario.Counts.get("SetGodMode"), 2);
			g_Assert.equal(Scenario.Counts.get("SetNoBlock"), 2);
			g_Assert.equal(Scenario.Counts.get("SetFrozen"), 2);
			++unScenarioCount;
		}

		const MissingSetterScenario = CreateScenario(g_StateDocumentationBlocks.TemporaryState);
		delete MissingSetterScenario.Player.SetFrozen;
		g_Assert.throws(() => MissingSetterScenario.API.WithTemporaryPlayerState(1), TypeError);
		g_Assert.equal(MissingSetterScenario.Counts.has("SetFlashlight"), false);
		++unScenarioCount;

		const WrongBooleanScenario = CreateScenario(g_StateDocumentationBlocks.TemporaryState, { State: { GodMode: 1 } });
		g_Assert.throws(() => WrongBooleanScenario.API.WithTemporaryPlayerState(1), TypeError);
		g_Assert.equal(WrongBooleanScenario.Counts.has("SetFlashlight"), false);
		++unScenarioCount;

		const MoveScenario = CreateScenario(g_StateDocumentationBlocks.Movement);
		const Previous = MoveScenario.API.MovePlayer(1, new Vector(1, 2, 3), 4, 5, true);
		g_Assert.deepEqual([Previous.X, Previous.Y, Previous.Z], [10, 20, 72]);
		g_Assert.deepEqual([MoveScenario.State.EyeLocation.X, MoveScenario.State.EyeLocation.Y, MoveScenario.State.EyeLocation.Z], [1, 2, 3]);
		++unScenarioCount;

		for (const PrimaryError of [new Error("push failed"), null]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Movement, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					if (strName === "Push") {
						throw PrimaryError;
					}

					if ((strName === "SetEyeLocation") && (unCount === 2)) {
						throw new Error("eye restoration failed");
					}

					return Default();
				},
			});
			AssertThrownValue(() => Scenario.API.MovePlayer(1, new Vector(1, 2, 3), 4, 5), PrimaryError, undefined, "Preserve the first thrown value.");
			g_Assert.equal(Scenario.Counts.get("SetEyeLocation"), 2);
			++unScenarioCount;
		}

		for (const Value of [Infinity, "4", 1e100]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Movement);
			g_Assert.throws(() => Scenario.API.MovePlayer(1, new Vector(1, 2, 3), Value, 5), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const ModeScenario = CreateScenario(g_StateDocumentationBlocks.Movement);
		g_Assert.throws(() => ModeScenario.API.SelectMovementMode(1, "jetpack"), RangeError);
		g_Assert.equal(ModeScenario.ResolutionCount, 0);
		++unScenarioCount;

		let unFractionReads = 0;
		const ViewScenario = CreateScenario(g_StateDocumentationBlocks.View, {
			Override: (strName, unCount, State, vecArguments, Default) => (strName === "GetTraceRay") ? {
				get Fraction() {
					++unFractionReads;

					return 0.25;
				},
			} : Default(),
		});
		g_Assert.equal(ViewScenario.API.InspectPlayerView(1).Fraction, 0.25);
		g_Assert.equal(unFractionReads, 1);
		++unScenarioCount;

		for (const InvalidFraction of [-1, 2, NaN, Infinity, "0.5"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.View, { Override: (strName, unCount, State, vecArguments, Default) => (strName === "GetTraceRay") ? { Fraction: InvalidFraction } : Default() });
			g_Assert.throws(() => Scenario.API.InspectPlayerView(1), /fraction/);
			g_Assert.equal(Scenario.Counts.has("GetViewCoordinates"), false);
			++unScenarioCount;
		}

		let unSelectorReads = 0;
		let unIndexReads = 0;
		const Target = {
			get Entity() {
				++unSelectorReads;

				return {
					get Index() {
						++unIndexReads;

						return 42;
					},
				};
			},
		};

		const AimScenario = CreateScenario(g_StateDocumentationBlocks.View);
		g_Assert.equal(AimScenario.API.AimPlayerAt(1, Target), true);
		g_Assert.equal(unSelectorReads, 1);
		g_Assert.equal(unIndexReads, 1);
		g_Assert.equal(AimScenario.Calls[0].Name, "SetViewEntity");
		g_Assert.equal(AimScenario.Calls[0].Arguments[0], 42);
		++unScenarioCount;

		for (const Target of [
			{},
			{ Entity: 42, Player: 2 },
			{ Entity: 0x80000000 },
			{ Coordinates: { X: NaN, Y: 0, Z: 0 } },
		]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.View);
			g_Assert.throws(() => Scenario.API.AimPlayerAt(1, Target), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		for (const Result of [false, "true"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Administration, { Override: () => Result });
			if (Result === false) {
				g_Assert.equal(Scenario.API.ApplyAdministrativeAction(1, "KICK"), false);

			} else {
				g_Assert.throws(() => Scenario.API.ApplyAdministrativeAction(1, "KICK"), /non-boolean/);
			}

			++unScenarioCount;
		}

		for (const strMethodName of ["SetFlashlight", "SetGodMode", "SetNoBlock", "SetFrozen"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.TemporaryState, { Override: (strName, unCount, State, vecArguments, Default) => ((strName === strMethodName) && (unCount === 1)) ? false : Default() });
			g_Assert.throws(() => Scenario.API.WithTemporaryPlayerState(1), /write failed/);
			g_Assert.equal(Scenario.Counts.get(strMethodName), 2, "Attempt cleanup even when a setter reports failure.");
			++unScenarioCount;
		}

		for (const strMethodName of ["SetEyeLocation", "Push"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Movement, { Override: (strName, unCount, State, vecArguments, Default) => ((strName === strMethodName) && (unCount === 1)) ? false : Default() });
			g_Assert.throws(() => Scenario.API.MovePlayer(1, new Vector(1, 2, 3), 4, 5), /failed/);
			g_Assert.equal(Scenario.Counts.get("SetEyeLocation"), 2);
			++unScenarioCount;
		}

		for (const PrimaryError of [new Error("input getter failed"), null]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.View);
			const Target = {
				get Entity() {
					throw PrimaryError;
				},
			};
			AssertThrownValue(() => Scenario.API.AimPlayerAt(1, Target), PrimaryError, undefined, "Preserve the first thrown value.");
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const ReusedSender = CreateScenario(g_StateDocumentationBlocks.MutedSender);
		g_Assert.throws(() => ReusedSender.API.WithSenderMuted(1, [2], () => {
			ReusedSender.State.UserID = 102;
		}), /identity changed/);
		g_Assert.equal(ReusedSender.Counts.has("Unmute"), false);
		++unScenarioCount;

		const ReusedPlayer = CreateScenario(g_StateDocumentationBlocks.TemporaryState, {
			Override: (strName, unCount, State, vecArguments, Default) => {
				if ((strName === "GetNoBlock") && (unCount === 2)) {
					State.UserID = 102;
				}

				return Default();
			},
		});
		g_Assert.throws(() => ReusedPlayer.API.WithTemporaryPlayerState(1), /identity changed/);
		g_Assert.equal(ReusedPlayer.Counts.get("SetGodMode"), 1);
		++unScenarioCount;

		for (const PrimaryError of [new Error("partial mute failed"), null]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.MutedSender, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					const Result = Default();
					if (strName === "Mute") {
						throw PrimaryError;
					}

					return Result;
				},
			});
			AssertThrownValue(() => Scenario.API.WithSenderMuted(1, [2, 3], () => 42), PrimaryError, undefined, "Preserve the first thrown value.");
			g_Assert.equal(Scenario.Counts.get("Unmute"), 2);
			g_Assert.equal(Scenario.Muted.size, 0);
			++unScenarioCount;
		}

		const WrongMuteBoolean = CreateScenario(g_StateDocumentationBlocks.MutedSender, { Override: (strName, unCount, State, vecArguments, Default) => (strName === "IsMuted") ? 1 : Default() });
		g_Assert.throws(() => WrongMuteBoolean.API.WithSenderMuted(1, [2], () => 42), TypeError);
		g_Assert.equal(WrongMuteBoolean.Counts.has("Mute"), false);
		++unScenarioCount;

		const mapComponentReads = new Map();
		const Destination = {};
		for (const strComponent of ["X", "Y", "Z"]) {
			Object.defineProperty(Destination, strComponent, {
				get() {
					mapComponentReads.set(strComponent, (mapComponentReads.get(strComponent) || 0) + 1);

					return 1;
				},
			});
		}

		const ComponentScenario = CreateScenario(g_StateDocumentationBlocks.Movement);
		ComponentScenario.API.MovePlayer(1, Destination, 1, 2);
		g_Assert.deepEqual([...mapComponentReads.values()], [1, 1, 1]);
		g_Assert.notEqual(ComponentScenario.State.EyeLocation, Destination);
		++unScenarioCount;

		for (const strTarget of ["Coordinates", "Entity", "Player"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.View, { Override: () => false });
			const SelectedTarget = (strTarget === "Coordinates") ? new Vector(1, 2, 3) : 2;
			g_Assert.throws(() => Scenario.API.AimPlayerAt(1, { [strTarget]: SelectedTarget }), /aim operation failed/);
			g_Assert.equal(Scenario.Calls.length, 1);
			++unScenarioCount;
		}

		for (const State of [{ Jetpack: 1 }, { Jetpack: true, NoClip: true }]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Movement, { State });
			g_Assert.throws(() => Scenario.API.SelectMovementMode(1, "WALK"));
			g_Assert.equal(Scenario.Counts.has("SetNoClip"), false);
			++unScenarioCount;
		}

		for (const TeamReference of [-1, 0x80000000, "", "blue\0ignored"]) {
			const Scenario = CreateScenario(g_StateDocumentationBlocks.Administration);
			g_Assert.throws(() => Scenario.API.ApplyAdministrativeAction(1, "CHANGETEAM", TeamReference), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		console.log("[  OK  ] players/entity state documentation: " + unScenarioCount + " scenarios, five reviewed examples (SDK doubles)");
	}

	RunDocumentationWorkflow(CheckPlayerEntityStateDocumentation, "state scenario suite");

	function CheckPlayerEntityInventoryDocumentation() {
		let unScenarioCount = 0;
		const CreateScenario = (unBlockIndex, Configuration = {}) => {
			const State = Object.assign({
				UserID: 101,
				Connected: true,
				FakeClient: false,
				Ammo: 6,
				ActiveWeapon: { Index: 41 },
				SelectedWeapon: { Index: 41 },
				Weapons: [{ Index: 41 }, { Index: 42 }],
				WeaponIndexes: [41, 42],
				ProjectileIndexes: [51],
				Spectators: [{ Index: 2 }],
				DropTarget: new Vector(1, 2, 3),
			}, Configuration.State);
			const vecCalls = [];
			const mapCounts = new Map();
			const setRestrictions = new Set(Configuration.Restricted || []);
			let unResolutions = 0;
			const Invoke = (strName, ...vecArguments) => {
				const unCount = (mapCounts.get(strName) || 0) + 1;
				mapCounts.set(strName, unCount);
				vecCalls.push({ Name: strName, Arguments: vecArguments });

				const Default = () => {
					switch (strName) {
						case "UserID":
							return State.UserID;

						case "IsConnected":
							return State.Connected;

						case "IsFakeClient":
							return State.FakeClient;

						case "GetSpectators":
							return State.Spectators;

						case "GetNetInfo":
							return { GetNetChannelLatency: (nFlow) => Invoke("GetNetChannelLatency", nFlow) };

						case "GetClientCVarValue":
							return "english";

						case "GetNetChannelLatency":
							g_Assert.equal(vecArguments[0], 1, "Use NET_FLOW.Incoming from the current netchannel API.");
							return 0.02;

						case "GetActiveWeapon":
							return State.ActiveWeapon;

						case "GetWeapon":
							return State.SelectedWeapon;

						case "GetWeapons":
							return State.Weapons;

						case "GetWeaponIndexes":
							return State.WeaponIndexes;

						case "GetPrimaryWeapon":
							return { Index: 41 };

						case "GetSecondaryWeapon":
							return { Index: 42 };

						case "GetProjectileAmmo":
							return State.Ammo;

						case "GetProjectileIndexes":
							return State.ProjectileIndexes;

						case "GetViewCoordinates":
							return State.DropTarget;

						case "SetActiveWeapon":
							State.ActiveWeapon = vecArguments[0];
							return true;

						case "SetProjectileAmmo":
							State.Ammo = vecArguments[1];
							return true;

						case "IsWeaponRestricted":
							return setRestrictions.has(vecArguments[0]);

						case "RestrictWeapons":
							setRestrictions.add(vecArguments[0]);
							return true;

						case "UnrestrictWeapons":
							setRestrictions.delete(vecArguments[0]);
							return true;

						case "GiveNamedItem":
							return { Index: 61 };

						default:
							return true;
					}
				};

				return Configuration.Override ? Configuration.Override(strName, unCount, State, vecArguments, Default) : Default();
			};

			const PlayerValue = {
				get UserID() {
					return Invoke("UserID");
				},
			};
			for (const strName of [
				"IsConnected",
				"IsFakeClient",
				"GetSpectators",
				"GetNetInfo",
				"GetClientCVarValue",
				"SendConVarValue",
				"GetActiveWeapon",
				"SetActiveWeapon",
				"GetWeapon",
				"GetWeapons",
				"GetWeaponIndexes",
				"GetPrimaryWeapon",
				"GetSecondaryWeapon",
				"GetProjectileAmmo",
				"SetProjectileAmmo",
				"GetProjectileIndexes",
				"GetViewCoordinates",
				"DropWeapon",
				"IsWeaponRestricted",
				"RestrictWeapons",
				"UnrestrictWeapons",
				"GiveNamedItem",
			]) {
				PlayerValue[strName] = function (...vecArguments) {
					g_Assert.equal(this, PlayerValue, "SDK calls retain their player receiver.");

					return Invoke(strName, ...vecArguments);
				};
			}

			const ModuleRecord = { exports: {} };
			const RequireExample = (strName) => {
				if (strName === "mathlib") {
					return { Vector };
				}

				if (strName === "netchannel") {
					return { NET_FLOW: { Incoming: 1 } };
				}

				if (strName === "players/engines") {
					return { Branch: Configuration.Branch || "csgo" };
				}

				g_Assert.equal(strName, "players/entity");

				return {
					Player() {
						++unResolutions;

						if (Object.hasOwn(Configuration, "PlayerError")) {
							throw Configuration.PlayerError;
						}

						return PlayerValue;
					},
				};
			};

			const Callback = CompileDocumentationModule(g_vecCodeBlocks[unBlockIndex], unBlockIndex);
			Callback(RequireExample, ModuleRecord, ModuleRecord.exports);
			g_Assert.equal(unResolutions, 0);
			g_Assert.equal(vecCalls.length, 0);

			return {
				API: ModuleRecord.exports,
				Calls: vecCalls,
				Counts: mapCounts,
				Player: PlayerValue,
				Restrictions: setRestrictions,
				State,

				get ResolutionCount() {
					return unResolutions;
				},
			};
		};

		const vecRuns = [
			[g_InventoryDocumentationBlocks.Network, (API, nPlayerIndex) => API.InspectPlayerNetwork(nPlayerIndex)],
			[g_InventoryDocumentationBlocks.Network, (API, nPlayerIndex) => API.SendClientConVarValue(nPlayerIndex, "cl_language", "english")],
			[g_InventoryDocumentationBlocks.Weapons, (API, nPlayerIndex) => API.InspectPlayerWeapons(nPlayerIndex)],
			[g_InventoryDocumentationBlocks.Weapons, (API, nPlayerIndex) => API.SelectActiveWeapon(nPlayerIndex, "rifle")],
			[g_InventoryDocumentationBlocks.Projectile, (API, nPlayerIndex) => API.InspectProjectile(nPlayerIndex, "grenade_projectile")],
			[g_InventoryDocumentationBlocks.Projectile, (API, nPlayerIndex) => API.SetProjectileAmmo(nPlayerIndex, "grenade_projectile", 4)],
			[g_InventoryDocumentationBlocks.Restrictions, (API, nPlayerIndex) => API.WithWeaponRestrictions(nPlayerIndex, ["rifle"], () => 42)],
			[g_InventoryDocumentationBlocks.Drop, (API, nPlayerIndex) => API.DropActiveWeapon(nPlayerIndex)],
			[g_InventoryDocumentationBlocks.Loadout, (API, nPlayerIndex) => API.GiveLoadoutItem(nPlayerIndex, "weapon_rifle")],
		];

		for (const [unBlockIndex, Run] of vecRuns) {
			for (const InvalidIndex of [
				0,
				-1,
				1.5,
				"1",
				1n,
				NaN,
				Infinity,
				0x80000000,
				undefined,
			]) {
				const Scenario = CreateScenario(unBlockIndex);
				g_Assert.throws(() => Run(Scenario.API, InvalidIndex), TypeError);
				g_Assert.equal(Scenario.ResolutionCount, 0);
				g_Assert.equal(Scenario.Calls.length, 0);
				++unScenarioCount;
			}

			for (const LookupError of [new Error("lookup failed"), null]) {
				const Scenario = CreateScenario(unBlockIndex, { PlayerError: LookupError });
				AssertThrownValue(() => Run(Scenario.API, 1), LookupError);
				++unScenarioCount;
			}
		}

		const NetworkScenario = CreateScenario(g_InventoryDocumentationBlocks.Network);
		g_Assert.deepEqual(NetworkScenario.API.InspectPlayerNetwork(1), { Network: { ClientConVarName: "cl_language", ClientConVarValue: "english", IncomingLatency: 0.02 }, SpectatorIndexes: [2] });
		g_Assert.equal(NetworkScenario.Counts.get("GetNetChannelLatency"), 1);
		g_Assert.deepEqual(NetworkScenario.Calls.find((Call) => Call.Name === "GetNetChannelLatency").Arguments, [1]);
		++unScenarioCount;

		for (const State of [{ Connected: false }, { FakeClient: true }]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Network, { State });
			g_Assert.equal(Scenario.API.InspectPlayerNetwork(1).Network, null);
			g_Assert.equal(Scenario.API.SendClientConVarValue(1, "cl_language", "english"), false);
			g_Assert.equal(Scenario.Counts.has("GetNetInfo"), false);
			g_Assert.equal(Scenario.Counts.has("SendConVarValue"), false);
			++unScenarioCount;
		}

		for (const State of [{ Connected: 0 }, { FakeClient: "false" }]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Network, { State });
			g_Assert.throws(() => Scenario.API.InspectPlayerNetwork(1), TypeError);
			g_Assert.equal(Scenario.Counts.has("GetNetInfo"), false);
			++unScenarioCount;
		}

		for (const Latency of [-1, Infinity, NaN, "0.02"]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Network, { Override: (strName, unCount, State, vecArguments, Default) => (strName === "GetNetChannelLatency") ? Latency : Default() });
			g_Assert.throws(() => Scenario.API.InspectPlayerNetwork(1), /latency/);
			++unScenarioCount;
		}

		for (const nAmmo of [-0x80000000, -1, 0, 0x7FFFFFFF]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Projectile, { State: { Ammo: nAmmo } });
			g_Assert.equal(Scenario.API.InspectProjectile(1, "grenade_projectile").ProjectileAmmo, nAmmo);
			g_Assert.equal(Scenario.API.SetProjectileAmmo(1, "grenade_projectile", nAmmo), true);
			g_Assert.equal(Scenario.Calls.at(-1).Arguments[1], nAmmo);
			++unScenarioCount;
		}

		for (const InvalidAmmo of [-0x80000001, 0x80000000, 1.5, 1n, "4"]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Projectile);
			g_Assert.throws(() => Scenario.API.SetProjectileAmmo(1, "grenade_projectile", InvalidAmmo), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const InventoryScenario = CreateScenario(g_InventoryDocumentationBlocks.Weapons);
		let unIterations = 0;
		const FilterNames = {
			*[Symbol.iterator]() {
				++unIterations;
				yield "primary";
			},
		};
		const Inventory = InventoryScenario.API.InspectPlayerWeapons(1, null, FilterNames);
		g_Assert.equal(unIterations, 1);
		g_Assert.equal(InventoryScenario.Calls.filter((Call) => ["GetWeapons", "GetWeaponIndexes", "GetWeapon"].includes(Call.Name)).every((Call) => Call.Arguments[1][0] === "primary"), true);
		g_Assert.notEqual(Inventory.OwnedWeaponIndexes, InventoryScenario.State.WeaponIndexes);
		InventoryScenario.State.WeaponIndexes.push(99);
		g_Assert.deepEqual(Inventory.OwnedWeaponIndexes, [41, 42]);
		++unScenarioCount;

		let unWeaponIndexReads = 0;
		const WeaponReference = {
			get Index() {
				++unWeaponIndexReads;

				return 41;
			},
		};
		const WeaponScenario = CreateScenario(g_InventoryDocumentationBlocks.Weapons, { State: { SelectedWeapon: WeaponReference }, Override: (strName, unCount, State, vecArguments, Default) => (strName === "SetActiveWeapon") ? false : Default() });
		g_Assert.equal(WeaponScenario.API.SelectActiveWeapon(1, "rifle"), false);
		g_Assert.equal(unWeaponIndexReads, 1);
		++unScenarioCount;

		const ChangedInventory = CreateScenario(g_InventoryDocumentationBlocks.Weapons, { State: { WeaponIndexes: [42, 41] } });
		g_Assert.throws(() => ChangedInventory.API.InspectPlayerWeapons(1), /disagree/);
		++unScenarioCount;

		let unWeaponReads = 0;
		const NativeWeaponReference = {
			get Weapon() {
				++unWeaponReads;

				return "rifle";
			},
		};

		const NativeWeaponScenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions);
		g_Assert.equal(NativeWeaponScenario.API.WithWeaponRestrictions(1, [NativeWeaponReference], () => 42), 42);
		g_Assert.equal(unWeaponReads, 1, "Snapshot the native Weapon property exactly once.");
		g_Assert.equal(NativeWeaponScenario.Restrictions.size, 0);
		++unScenarioCount;

		const ObsoleteWeaponScenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions);
		g_Assert.throws(() => ObsoleteWeaponScenario.API.WithWeaponRestrictions(1, [{ WeaponName: "rifle" }], () => 42), TypeError);
		g_Assert.equal(ObsoleteWeaponScenario.ResolutionCount, 0, "Do not convert a stale weapon-field alias.");
		++unScenarioCount;

		const RestrictedScenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions, { Restricted: ["rifle"] });
		g_Assert.equal(RestrictedScenario.API.WithWeaponRestrictions(1, ["rifle", "rifle", "smg"], () => 42), 42);
		g_Assert.deepEqual([...RestrictedScenario.Restrictions], ["rifle"]);
		g_Assert.equal(RestrictedScenario.Counts.get("IsWeaponRestricted"), 4, "Query each distinct name only once in each phase.");
		g_Assert.deepEqual(RestrictedScenario.Calls.filter((Call) => Call.Name === "UnrestrictWeapons").map((Call) => Call.Arguments[0]), ["smg"]);
		++unScenarioCount;

		for (const PrimaryError of [new Error("callback failed"), null]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					if ((strName === "UnrestrictWeapons") && (unCount === 1)) {
						throw new Error("secondary cleanup failed");
					}

					return Default();
				},
			});
			AssertThrownValue(() => Scenario.API.WithWeaponRestrictions(1, ["rifle", "smg"], () => {
				throw PrimaryError;
			}), PrimaryError);
			g_Assert.equal(Scenario.Counts.get("UnrestrictWeapons"), 2);
			g_Assert.equal(Scenario.Restrictions.has("smg"), false);
			++unScenarioCount;
		}

		for (const PrimaryError of [new Error("partial restriction failed"), null]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions, {
				Override: (strName, unCount, State, vecArguments, Default) => {
					const Result = Default();
					if (strName === "RestrictWeapons") {
						throw PrimaryError;
					}

					return Result;
				},
			});
			AssertThrownValue(() => Scenario.API.WithWeaponRestrictions(1, ["rifle"], () => 42), PrimaryError);
			g_Assert.equal(Scenario.Counts.get("UnrestrictWeapons"), 1);
			g_Assert.equal(Scenario.Restrictions.size, 0);
			++unScenarioCount;
		}

		const PromiseScenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions);
		g_Assert.throws(() => PromiseScenario.API.WithWeaponRestrictions(1, ["rifle"], () => Promise.resolve(42)), TypeError);
		g_Assert.equal(PromiseScenario.Restrictions.size, 0);
		++unScenarioCount;

		const ReusedScenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions);
		g_Assert.throws(() => ReusedScenario.API.WithWeaponRestrictions(1, ["rifle"], () => {
			ReusedScenario.State.UserID = 102;
		}), /identity changed/);
		g_Assert.equal(ReusedScenario.Counts.has("UnrestrictWeapons"), false);
		++unScenarioCount;

		for (const [unBlockIndex, strMethodName, Run] of [
			[g_InventoryDocumentationBlocks.Network, "SendConVarValue", (API) => API.SendClientConVarValue(1, "cl_language", "english")],
			[g_InventoryDocumentationBlocks.Weapons, "SetActiveWeapon", (API) => API.SelectActiveWeapon(1, "rifle")],
			[g_InventoryDocumentationBlocks.Projectile, "SetProjectileAmmo", (API) => API.SetProjectileAmmo(1, "grenade_projectile", 4)],
			[g_InventoryDocumentationBlocks.Drop, "DropWeapon", (API) => API.DropActiveWeapon(1)],
		]) {
			for (const Result of [false, "true", undefined]) {
				const Scenario = CreateScenario(unBlockIndex, { Override: (strName, unCount, State, vecArguments, Default) => (strName === strMethodName) ? Result : Default() });
				if (Result === false) {
					g_Assert.equal(Run(Scenario.API), false);

				} else {
					g_Assert.throws(() => Run(Scenario.API));
				}

				++unScenarioCount;
			}
		}

		for (const State of [{ ActiveWeapon: null }, { DropTarget: null }]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Drop, { State });
			g_Assert.equal(Scenario.API.DropActiveWeapon(1), false);
			g_Assert.equal(Scenario.Counts.has("DropWeapon"), false);
			++unScenarioCount;
		}

		for (const flSpeed of [Infinity, NaN, 1e100]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Drop);
			g_Assert.throws(() => Scenario.API.DropActiveWeapon(1, flSpeed), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const GiveScenario = CreateScenario(g_InventoryDocumentationBlocks.Loadout);
		const GiveNamedItem = GiveScenario.Player.GiveNamedItem;
		let unMethodReads = 0;
		Object.defineProperty(GiveScenario.Player, "GiveNamedItem", {
			get() {
				++unMethodReads;

				return GiveNamedItem;
			},
		});
		g_Assert.equal(GiveScenario.API.GiveLoadoutItem(1, "weapon_rifle").Index, 61);
		g_Assert.equal(unMethodReads, 1);
		g_Assert.equal(GiveScenario.Calls[0].Arguments.length, 2);
		++unScenarioCount;

		const CSGOScenario = CreateScenario(g_InventoryDocumentationBlocks.Loadout);
		CSGOScenario.API.GiveLoadoutItem(1, "weapon_rifle", 0, false);
		g_Assert.equal(CSGOScenario.Calls[0].Arguments[2], false);
		++unScenarioCount;

		for (const strBranch of ["bms", "tf2", "orangebox", "l4d2"]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Loadout, { Branch: strBranch });
			g_Assert.throws(() => Scenario.API.GiveLoadoutItem(1, "weapon_rifle", 0, false), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		for (const [unBlockIndex, Run] of [
			[g_InventoryDocumentationBlocks.Network, (API) => API.InspectPlayerNetwork(1, "cl_language\0ignored")],
			[g_InventoryDocumentationBlocks.Network, (API) => API.SendClientConVarValue(1, "cl_language\0ignored", "english")],
			[g_InventoryDocumentationBlocks.Network, (API) => API.SendClientConVarValue(1, "cl_language", "english\0ignored")],
			[g_InventoryDocumentationBlocks.Weapons, (API) => API.InspectPlayerWeapons(1, "rifle\0ignored")],
			[g_InventoryDocumentationBlocks.Weapons, (API) => API.SelectActiveWeapon(1, "rifle\0ignored")],
			[g_InventoryDocumentationBlocks.Projectile, (API) => API.InspectProjectile(1, "grenade_projectile\0ignored")],
			[g_InventoryDocumentationBlocks.Projectile, (API) => API.SetProjectileAmmo(1, "grenade_projectile\0ignored", 4)],
			[g_InventoryDocumentationBlocks.Loadout, (API) => API.GiveLoadoutItem(1, "weapon_rifle\0ignored")],
		]) {
			const Scenario = CreateScenario(unBlockIndex);
			g_Assert.throws(() => Run(Scenario.API), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		for (const nSubtype of [-0x80000001, 0x80000000, 1.5]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Loadout);
			g_Assert.throws(() => Scenario.API.GiveLoadoutItem(1, "weapon_rifle", nSubtype), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		for (const vecIndexes of [[0x80000000], [0], [, 51]]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Projectile, { State: { ProjectileIndexes: vecIndexes } });
			g_Assert.throws(() => Scenario.API.InspectProjectile(1, "grenade_projectile"), TypeError);
			++unScenarioCount;
		}

		let unIteratorReads = 0;
		const IterableNames = {};
		Object.defineProperty(IterableNames, Symbol.iterator, {
			get() {
				++unIteratorReads;

				return function* () {
					g_Assert.equal(this, IterableNames);
					yield "primary";
				};
			},
		});

		const IterableScenario = CreateScenario(g_InventoryDocumentationBlocks.Weapons);
		IterableScenario.API.InspectPlayerWeapons(1, null, IterableNames);
		g_Assert.equal(unIteratorReads, 1);
		++unScenarioCount;

		for (const vecReferences of [[], [, "rifle"], ["rifle\0ignored"]]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Restrictions);
			g_Assert.throws(() => Scenario.API.WithWeaponRestrictions(1, vecReferences, () => 42), TypeError);
			g_Assert.equal(Scenario.ResolutionCount, 0);
			++unScenarioCount;
		}

		const MissingItemMethod = CreateScenario(g_InventoryDocumentationBlocks.Loadout);
		delete MissingItemMethod.Player.GiveNamedItem;
		g_Assert.throws(() => MissingItemMethod.API.GiveLoadoutItem(1, "weapon_rifle"), /does not expose/);
		g_Assert.equal(MissingItemMethod.Calls.length, 0);
		++unScenarioCount;

		const EmptyItem = CreateScenario(g_InventoryDocumentationBlocks.Loadout, { Override: () => null });
		g_Assert.equal(EmptyItem.API.GiveLoadoutItem(1, "weapon_rifle"), null);
		++unScenarioCount;

		for (const Item of [{ Index: 0 }, { Index: 0x80000000 }, undefined, []]) {
			const Scenario = CreateScenario(g_InventoryDocumentationBlocks.Loadout, { Override: () => Item });
			g_Assert.throws(() => Scenario.API.GiveLoadoutItem(1, "weapon_rifle"), TypeError);
			++unScenarioCount;
		}

		console.log("[  OK  ] players/entity inventory documentation: " + unScenarioCount + " scenarios, six reviewed examples (SDK doubles)");
	}

	RunDocumentationWorkflow(CheckPlayerEntityInventoryDocumentation, "inventory scenario suite");

	function CheckPlayerEntityDocumentationExamples() {
		const vecDocumentationModules = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			const Callback = CompileDocumentationModule(g_vecCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex);
			Callback(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports);
			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecCalls.length, 0, "players/entity examples must not touch players while code blocks load.");

		const DocumentationAPI = Object.assign({}, ...vecDocumentationModules);
		const Identity = DocumentationAPI.GetPlayerIdentity(1);
		const TemporaryProperties = DocumentationAPI.WithTemporaryPlayerProperties(1, "Temporary Ren");
		const Profile = DocumentationAPI.InspectPlayerProfile(1, true);
		const vecNumericProfileChanges = DocumentationAPI.ApplyPlayerProfile(1, { Name: "Ren", PlayerClass: 1, Team: 2 });
		const vecNamedProfileChanges = DocumentationAPI.ApplyPlayerProfile(1, { PlayerClassName: "scout", TeamName: "survivor" });
		const bNotified = DocumentationAPI.NotifyPlayer(1, "player_say", { text: "SourceJS smoke event" }, "buttons/button14.wav");

		g_Assert.deepEqual(Identity, { Index: 1, Name: "Ren", NetworkID: "STEAM_1:1:1234", UserID: 101 }, "documented player identity");
		g_Assert.equal(TemporaryProperties.Name, "Temporary Ren", "documented temporary property view");
		g_Assert.equal(Profile.PlayerClassName, "scout", "documented player profile inspection");
		g_Assert.deepEqual(vecNumericProfileChanges, ["Name", "Team", "PlayerClass"], "documented numeric profile changes");
		g_Assert.deepEqual(vecNamedProfileChanges, ["TeamName", "PlayerClassName"], "documented named profile changes");
		g_Assert.equal(bNotified, true, "documented player notification");

		g_Assert.equal(DocumentationAPI.ApplyAdministrativeAction(1, "BAN30"), true, "documented ban action");
		g_Assert.equal(DocumentationAPI.ApplyAdministrativeAction(1, "CHANGETEAM", 2), true, "documented team action");
		g_Assert.equal(DocumentationAPI.ApplyAdministrativeAction(1, "KICK"), true, "documented kick action");
		g_Assert.equal(DocumentationAPI.ApplyAdministrativeAction(1, "RESPAWN"), true, "documented respawn action");
		g_Assert.equal(DocumentationAPI.ApplyAdministrativeAction(1, "SLAY"), true, "documented slay action");

		const CheckMute = ({ Sender, SpectatorIndexes: vecSpectatorIndexes }) => ({ Muted: Sender.IsMuted([2]), SpectatorIndexes: vecSpectatorIndexes });
		const MuteResult = DocumentationAPI.WithSenderMuted(1, [2], CheckMute);
		g_Assert.deepEqual(MuteResult, { Muted: true, SpectatorIndexes: [2] }, "documented scoped voice mute");

		const ToggledState = DocumentationAPI.WithTemporaryPlayerState(1);
		g_Assert.deepEqual(ToggledState, { Flashlight: true, Frozen: true, GodMode: true, NoBlock: true }, "documented temporary player state");

		g_Assert.deepEqual(DocumentationAPI.SelectMovementMode(1, "JETPACK"), { PreviousMode: "OTHER", SelectedMode: "JETPACK" }, "documented jetpack mode");
		g_Assert.deepEqual(DocumentationAPI.SelectMovementMode(1, "NOCLIP"), { PreviousMode: "JETPACK", SelectedMode: "NOCLIP" }, "documented noclip mode");
		g_Assert.deepEqual(DocumentationAPI.SelectMovementMode(1, "STUCK"), { PreviousMode: "NOCLIP", SelectedMode: "STUCK" }, "documented stuck mode");
		g_Assert.deepEqual(DocumentationAPI.SelectMovementMode(1, "WALK"), { PreviousMode: "STUCK", SelectedMode: "WALK" }, "documented walk mode");

		const PreviousEyeLocation = DocumentationAPI.MovePlayer(1, new Vector(20, 30, 80), 240, 180, true);
		const View = DocumentationAPI.InspectPlayerView(1);

		g_Assert.ok(PreviousEyeLocation instanceof Vector, "documented previous eye location");
		g_Assert.equal(View.EntityIndex, 42, "documented view entity index");
		g_Assert.equal(DocumentationAPI.AimPlayerAt(1, { Coordinates: new Vector(100, 20, 72) }), true, "documented coordinate aim");
		g_Assert.equal(DocumentationAPI.AimPlayerAt(1, { Entity: { Index: 42 } }), true, "documented entity aim");
		g_Assert.equal(DocumentationAPI.AimPlayerAt(1, { Player: Player(2) }), true, "documented player aim");

		const Network = DocumentationAPI.InspectPlayerNetwork(1);
		g_Assert.equal(Network.Network.ClientConVarValue, "russian", "documented client ConVar inspection");
		g_Assert.deepEqual(Network.SpectatorIndexes, [2], "documented spectator inspection");
		g_Assert.equal(DocumentationAPI.SendClientConVarValue(1, "cl_language", "russian"), true, "documented client ConVar send");

		const Inventory = DocumentationAPI.InspectPlayerWeapons(1, "rifle", "primary", "secondary");
		g_Assert.equal(Inventory.MatchingWeaponIndex, 30, "documented matching weapon");
		g_Assert.ok(g_vecCalls.some((vecCall) => (vecCall[1] === "GetWeaponIndexes") && (vecCall[2] === "rifle") && (vecCall[3] === "primary") && (vecCall[4] === "secondary")), "documented weapon filter arguments");
		g_Assert.equal(DocumentationAPI.SelectActiveWeapon(1, "rifle"), true, "documented active weapon selection");
		g_Assert.deepEqual(DocumentationAPI.InspectProjectile(1, "grenade_projectile"), { OwnedProjectileIndexes: [50], ProjectileAmmo: 4 }, "documented projectile inspection");
		g_Assert.equal(DocumentationAPI.SetProjectileAmmo(1, "grenade_projectile", 4), true, "documented projectile ammo write");

		const CheckWeaponRestriction = (CurrentPlayer) => CurrentPlayer.IsWeaponRestricted("rifle");
		const bRestrictionResult = DocumentationAPI.WithWeaponRestrictions(1, ["rifle", "smg"], CheckWeaponRestriction);
		g_Assert.equal(bRestrictionResult, true, "documented temporary weapon restrictions");
		g_Assert.equal(DocumentationAPI.DropActiveWeapon(1, 120), true, "documented active weapon drop");

		const Item = DocumentationAPI.GiveLoadoutItem(1, "weapon_pistol", 0, false);
		g_Assert.equal(Item.ClassName, "weapon_pistol", "documented GiveNamedItem result");
		g_Assert.equal(g_mapPlayerStates.get(1).Health, 82, "property example must restore health.");
		g_Assert.equal(g_mapPlayerStates.get(1).MaximumHealth, 100, "property example must restore maximum health.");
		g_Assert.equal(g_mapPlayerStates.get(1).Name, "Ren", "property example must restore name.");
		g_Assert.equal(g_mapPlayerStates.get(1).Team, 2, "property example must restore team.");
		g_Assert.equal(g_mapPlayerStates.get(1).Muted, false, "voice example must restore mute state.");
		g_Assert.equal(g_mapPlayerStates.get(1).Flashlight, false, "state example must restore flashlight.");
		g_Assert.equal(g_mapPlayerStates.get(1).Frozen, false, "state example must restore frozen state.");
		g_Assert.equal(g_mapPlayerStates.get(1).GodMode, false, "state example must restore god mode.");
		g_Assert.equal(g_mapPlayerStates.get(1).NoBlock, false, "state example must restore collision state.");
		g_Assert.equal(g_mapPlayerStates.get(1).Jetpack, false, "movement example must end outside jetpack mode.");
		g_Assert.equal(g_mapPlayerStates.get(1).NoClip, false, "movement example must end outside noclip mode.");
		g_Assert.equal(g_mapPlayerStates.get(1).Stuck, false, "movement example must end outside stuck mode.");
		g_Assert.equal(g_mapRestrictions.get(1)?.size ?? 0, 0, "restriction example must restore restrictions.");
	}

	RunDocumentationWorkflow(CheckPlayerEntityDocumentationExamples, "complete documentation examples");

	const g_strBaseSource = g_FileSystem.readFileSync(g_strBasePath, "utf8");
	const g_vecDecoratedMethodNames = [...g_strBaseSource.matchAll(/DefinePlayerMethod\(\s*NativePlayer,\s*"([^"]+)"/g)].map((vecMatch) => vecMatch[1]);
	const g_vecPlayerMethodNames = [...new Set([...g_vecDecoratedMethodNames, "GiveNamedItem"])].sort();
	const g_setCapturedMethodNames = new Set([
		"GetFlashlight",
		"SetFlashlight",
		"GetGodMode",
		"SetGodMode",
		"GetNoBlock",
		"SetNoBlock",
		"GetFrozen",
		"SetFrozen",
		"GiveNamedItem",
	]);

	g_Assert.equal(g_vecPlayerMethodNames.length, g_unExpectedPlayerMethodCount, "players/entity documented method inventory");

	for (const strMethodName of g_vecPlayerMethodNames) {
		const bDirectCall = g_strDocumentation.includes(`.${strMethodName}(`);
		const bSnapshotCall = g_setCapturedMethodNames.has(strMethodName) && g_strDocumentation.includes(`CurrentPlayer.${strMethodName}`);
		g_Assert.ok(bDirectCall || bSnapshotCall, `players/entity documentation must use ${strMethodName}() in a practical example.`);
	}

	for (const strMethodName of g_vecPlayerMethodNames) {
		g_Assert.ok(g_vecCalls.some((vecCall) => vecCall[1] === strMethodName), `players/entity examples must execute ${strMethodName}().`);
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/entity documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	const g_nPlayerObjectStart = g_strModuleBindings.indexOf("v8::Local<v8::Object> MakePlayerObject(");
	const g_nPlayerObjectEnd = g_strModuleBindings.indexOf("IPlayerInfo* RequirePlayerInformationArgument(", g_nPlayerObjectStart);
	g_Assert.ok((g_nPlayerObjectStart >= 0) && (g_nPlayerObjectEnd > g_nPlayerObjectStart), "native MakePlayerObject source range");

	const g_strPlayerObjectSource = g_strModuleBindings.slice(g_nPlayerObjectStart, g_nPlayerObjectEnd);

	g_Assert.ok(g_strModuleBindings.includes("enum class PlayerLiveProperty"), "native Player live property inventory");
	g_Assert.ok(g_strModuleBindings.includes("PlayerGetLivePropertyCallback"), "native Player live getter");
	g_Assert.ok(g_strModuleBindings.includes("PlayerSetLiveProperty"), "native Player live setter");
	g_Assert.ok(g_strModuleBindings.includes("InstallPlayerLiveProperty"), "native Player live property installer");
	g_Assert.ok(g_strModuleBindings.includes("MakeEntityObject(pIsolate, LocalContext, nEntityIndex)"), "Player must retain the live Entity wrapper.");
	g_Assert.ok(g_strModuleBindings.includes('{ "Name", PlayerLiveProperty::Name },'), "Player.Name live property");
	g_Assert.ok(g_strModuleBindings.includes('{ "Team", PlayerLiveProperty::Team },'), "Player.Team live property");
	g_Assert.ok(g_strModuleBindings.includes('{ "Health", PlayerLiveProperty::Health },'), "Player.Health live property");
	g_Assert.ok(g_strModuleBindings.includes('{ "MaximumHealth", PlayerLiveProperty::MaximumHealth },'), "Player.MaximumHealth live property");
	g_Assert.ok(g_strModuleBindings.includes("pPlayerInformation->ChangeTeam(nTeamIndex);"), "Player.Team native writer");
	g_Assert.ok(g_strModuleBindings.includes("pPlayerEntity->SetHealth(nHealth);"), "Player.Health native writer");
	g_Assert.ok(g_strModuleBindings.includes("pPlayerEntity->SetMaxHealth(nHealth);"), "Player.MaximumHealth native writer");
	g_Assert.ok(g_strModuleBindings.includes('" expects an item name and optional integer subtype."'), "Player.GiveNamedItem diagnostic");
	g_Assert.ok(!g_strPlayerObjectSource.includes('SetString(pIsolate, LocalContext, LocalObject, "Name",'), "Player.Name must not be a snapshot.");
	g_Assert.ok(!g_strPlayerObjectSource.includes('SetInteger(pIsolate, LocalContext, LocalObject, "Health",'), "Player.Health must not be a snapshot.");
	g_Assert.ok(!g_strPlayerObjectSource.includes('SetBoolean(pIsolate, LocalContext, LocalObject, "Dead",'), "Player.Dead must not be a snapshot.");
} catch (CaughtError) {
	g_bMainFailed = true;
	g_MainError = CaughtError;
} finally {
	const vecCleanupErrors = [];
	const AttemptCleanup = (Cleanup) => {
		try {
			Cleanup();
		} catch (CaughtError) {
			vecCleanupErrors.push(CaughtError);
		}
	};
	AttemptCleanup(ClearPackageCache);

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		AttemptCleanup(() => Object.defineProperty(require.cache, strPath, Descriptor));
	}

	AttemptCleanup(() => Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor));

	if (g_bMainFailed) {
		vecCleanupErrors.unshift(g_MainError);
	}

	if (vecCleanupErrors.length === 1) {
		throw vecCleanupErrors[0];
	}

	if (vecCleanupErrors.length > 1) {
		throw new AggregateError(vecCleanupErrors, "Player entity smoke check and cleanup failed.");
	}
}

console.log("[  OK  ] smoke_players_entity");
