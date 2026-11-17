#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strProjectRootPath, "packages", "sourcejs");
const g_strPlayersPath = g_Path.join(g_strPackageRootPath, "players", "index.js");
const g_strPlayersDocumentationPath = g_Path.join(g_strProjectRootPath, "docs", "api", "players.md");
const g_unMoveTypeNone = 0;
const g_unMoveTypeWalk = 2;
const g_unMoveTypeFly = 4;
const g_unMoveTypeNoClip = 8;
const g_unTakeDamageYes = 2;
const g_unTakeDamageNo = 0;
const g_unFrozenFlag = 0x20;
const g_unDimLightEffect = 0x04;
const g_unCollisionGroupPlayer = 5;
const g_unCollisionGroupDebrisTrigger = 2;

function GetPackagePath(strName) {
	if ((strName === "entities") || (strName === "players") || (strName === "weapons")) {
		return g_Path.join(g_strPackageRootPath, strName, "index.js");
	}

	return g_Path.join(g_strPackageRootPath, `${strName}.js`);
}

function InstallDependency(strName, ModuleExports) {
	const strFilePath = GetPackagePath(strName);
	delete require.cache[strFilePath];
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = flX;
		this.Y = flY;
		this.Z = flZ;
	}

	static CreateMathStructureFromValue(VectorLike) {
		if (VectorLike instanceof this) {
			return VectorLike;
		}

		return new this(VectorLike.X, VectorLike.Y, VectorLike.Z);
	}

	AddVector(Operand) {
		const OtherVector = Vector.CreateMathStructureFromValue(Operand);

		return new Vector(this.X + OtherVector.X, this.Y + OtherVector.Y, this.Z + OtherVector.Z);
	}

	SubtractVector(Operand) {
		const OtherVector = Vector.CreateMathStructureFromValue(Operand);

		return new Vector(this.X - OtherVector.X, this.Y - OtherVector.Y, this.Z - OtherVector.Z);
	}

	MultiplyScalar(flScalar) {
		return new Vector(this.X * flScalar, this.Y * flScalar, this.Z * flScalar);
	}

	ConvertVectorToQAngle() {
		return new QAngle(0, 0, 0);
	}

	ConvertMathStructureToArray() {
		return [this.X, this.Y, this.Z];
	}
}

class QAngle extends Vector {
	ConvertQAngleToVectors() {
		return { Forward: new Vector(1, 0, 0), Right: new Vector(0, 1, 0), Up: new Vector(0, 0, 1) };
	}
}

class Sound {
	constructor(strSample, Options) {
		this.Options = Options;
		this.Sample = strSample;
	}

	Play(vecRecipients) {
		g_vecSoundCalls.push({ Recipients: vecRecipients, Sample: this.Sample, Stream: false });

		return true;
	}
}

class StreamSound extends Sound {
	Play(vecRecipients) {
		g_vecSoundCalls.push({ Recipients: vecRecipients, Sample: this.Sample, Stream: true });

		return true;
	}
}

class EntityTraceFilter {
	constructor(vecIgnoredEntities, nTraceType) {
		this.IgnoredEntities = vecIgnoredEntities;
		this.TraceType = nTraceType;
	}
}

class WeaponClassIterator {
	constructor(strRequiredFilters) {
		this.RequiredFilters = strRequiredFilters;
	}

	ToArray() {
		if (this.RequiredFilters === "primary") {
			return [{ ClassName: "weapon_rifle" }];
		}

		if (this.RequiredFilters === "secondary") {
			return [{ ClassName: "weapon_pistol" }];
		}

		return [{ ClassName: "weapon_pistol" }, { ClassName: "weapon_rifle" }];
	}
}

const g_vecActionCalls = [];
const g_vecEventCalls = [];
const g_vecSoundCalls = [];
const g_vecNetchannelCalls = [];
const g_vecDroppedWeapons = [];
const g_mapRestrictedWeapons = new Map();
const g_mapMutedSenders = new Map();
const g_mapEntityOrigins = new Map([[100, new Vector(512, 0, 64)]]);
const g_mapWeaponRecords = new Map([
	[10, { ClassName: "weapon_rifle", Index: 10, Weapon: "rifle" }],
	[11, { ClassName: "weapon_pistol", Index: 11, Weapon: "pistol" }],
]);

const g_mapPlayerStates = new Map();
const g_mapNativePlayers = new Map();
let g_unTraceEntityIndex = 2;

function CreatePlayerState(unIndex, unUserID, strName, unTeam, strNetworkID, unObserverTarget = null) {
	return {
		ActiveWeaponIndex: 10,
		Ammo: 4,
		CollisionGroup: g_unCollisionGroupPlayer,
		Connected: true,
		Dead: false,
		Effects: 0,
		FakeClient: false,
		Flags: 0,
		InVehicle: false,
		MoveType: g_unMoveTypeWalk,
		Name: strName,
		NetworkID: strNetworkID,
		Observer: unObserverTarget !== null,
		ObserverTarget: unObserverTarget,
		Origin: new Vector(unIndex * 64, 0, 0),
		PlayerClass: 1,
		TakeDamage: g_unTakeDamageYes,
		Team: unTeam,
		UserID: unUserID,
		ViewAngle: new QAngle(0, 0, 0),
		ViewOffset: new Vector(0, 0, 64),
	};
}

function CreateNativePlayer(unIndex) {
	const State = g_mapPlayerStates.get(unIndex);
	const Player = {
		Index: unIndex,
		UserID: State.UserID,

		Ban(unDuration, bKickPlayer, bWriteBan) {
			g_vecActionCalls.push(["Ban", unIndex, unDuration, bKickPlayer, bWriteBan]);

			return true;
		},

		ChangeTeam(unTeam) {
			State.Team = unTeam;

			return true;
		},

		ExecuteClientCommand(strCommand, bServerSide) {
			g_vecActionCalls.push(["ExecuteClientCommand", unIndex, strCommand, bServerSide]);

			return true;
		},

		Kick(strMessage) {
			g_vecActionCalls.push(["Kick", unIndex, strMessage]);

			return true;
		},

		Say(strMessage) {
			g_vecActionCalls.push(["Say", unIndex, strMessage]);

			return true;
		},

		SayTeam(strMessage) {
			g_vecActionCalls.push(["SayTeam", unIndex, strMessage]);

			return true;
		},

		SetName(strName) {
			State.Name = strName;

			return true;
		},

		Slay() {
			g_vecActionCalls.push(["Slay", unIndex]);

			return true;
		},
	};

	g_mapNativePlayers.set(unIndex, Player);

	return Player;
}

g_mapPlayerStates.set(1, CreatePlayerState(1, 11, "Alice", 2, "STEAM_1:1:100"));
g_mapPlayerStates.set(2, CreatePlayerState(2, 22, "Bob", 2, "STEAM_1:0:200", 1));
CreateNativePlayer(1);
CreateNativePlayer(2);

function GetPlayerState(PlayerOrIndex) {
	const unPlayerIndex = (typeof PlayerOrIndex === "number") ? PlayerOrIndex : PlayerOrIndex.Index;

	return g_mapPlayerStates.get(unPlayerIndex);
}

function GetIntegerProperty(State, strPropertyName) {
	switch (strPropertyName) {
		case "m_iClass":
			return State.PlayerClass;

		case "m_MoveType":
			return State.MoveType;

		case "m_takedamage":
			return State.TakeDamage;

		case "m_fFlags":
			return State.Flags;

		case "m_fEffects":
			return State.Effects;

		default:
			throw new Error(`unexpected integer property ${strPropertyName}`);
	}
}

function SetIntegerProperty(State, strPropertyName, nValue) {
	switch (strPropertyName) {
		case "m_iClass":
			State.PlayerClass = nValue;
			break;

		case "m_MoveType":
			State.MoveType = nValue;
			break;

		case "m_takedamage":
			State.TakeDamage = nValue;
			break;

		case "m_fFlags":
			State.Flags = nValue;
			break;

		case "m_fEffects":
			State.Effects = nValue;
			break;

		default:
			throw new Error(`unexpected integer property ${strPropertyName}`);
	}
}

let g_vecLatestNativePlayerList = null;

const g_PlayersRuntime = {
	GetAllPlayers() {
		g_vecLatestNativePlayerList = [...g_mapNativePlayers.values()];

		return g_vecLatestNativePlayerList;
	},

	GetClientCount() {
		return g_mapNativePlayers.size;
	},

	GetPlayerFromUserID(unUserID) {
		return [...g_mapNativePlayers.values()].find((Player) => Player.UserID === unUserID) ?? null;
	},

	GetActiveWeapon(Player) {
		return g_mapWeaponRecords.get(GetPlayerState(Player).ActiveWeaponIndex) ?? null;
	},

	GetEntityProperty(Player, strPropertyName) {
		g_Assert.equal(strPropertyName, "m_hObserverTarget");

		const unObserverTarget = GetPlayerState(Player).ObserverTarget;

		return (unObserverTarget === null) ? null : { Index: unObserverTarget };
	},

	GetIntegerProperty(Player, strPropertyName) {
		return GetIntegerProperty(GetPlayerState(Player), strPropertyName);
	},

	GetName(Player) {
		return GetPlayerState(Player).Name;
	},

	GetNetworkID(Player) {
		return GetPlayerState(Player).NetworkID;
	},

	GetOrigin(Player) {
		return Vector.CreateMathStructureFromValue(GetPlayerState(Player).Origin);
	},

	GetProjectileAmmo(Player, strPropertyName) {
		g_Assert.equal(strPropertyName, "m_iAmmo.003");

		return GetPlayerState(Player).Ammo;
	},

	GetTeam(Player) {
		return GetPlayerState(Player).Team;
	},

	GetUserID(Player) {
		return GetPlayerState(Player).UserID;
	},

	GetVectorProperty(EntityReference, strPropertyName) {
		const State = GetPlayerState(EntityReference);
		if (State === undefined) {
			return Vector.CreateMathStructureFromValue(g_mapEntityOrigins.get(EntityReference.Index));
		}

		switch (strPropertyName) {
			case "m_vecOrigin":
				return Vector.CreateMathStructureFromValue(State.Origin);

			case "m_vecViewOffset[0]":
				return Vector.CreateMathStructureFromValue(State.ViewOffset);

			case "m_angEyeAngles[0]":
				return Vector.CreateMathStructureFromValue(State.ViewAngle);

			default:
				throw new Error(`unexpected vector property ${strPropertyName}`);
		}
	},

	IsConnected(Player) {
		return GetPlayerState(Player).Connected;
	},

	IsDead(Player) {
		return GetPlayerState(Player).Dead;
	},

	IsFakeClient(Player) {
		return GetPlayerState(Player).FakeClient;
	},

	IsHLTV() {
		return false;
	},

	IsInVehicle(Player) {
		return GetPlayerState(Player).InVehicle;
	},

	IsObserver(Player) {
		return GetPlayerState(Player).Observer;
	},

	GetMaximumClients() {
		return 8;
	},

	GetPlayer(unIndex) {
		return g_mapNativePlayers.get(unIndex) ?? null;
	},

	GetProjectileIndices(Player, strClassName) {
		g_Assert.equal(strClassName, "grenade_projectile");

		return [90];
	},

	SetActiveWeapon(Player, Weapon) {
		GetPlayerState(Player).ActiveWeaponIndex = Weapon.Index;

		return true;
	},

	SetIntegerProperty(Player, strPropertyName, nValue) {
		SetIntegerProperty(GetPlayerState(Player), strPropertyName, nValue);

		return true;
	},

	SetName(Player, strName) {
		GetPlayerState(Player).Name = strName;

		return true;
	},

	SendConVarValue(Player, strConVarName, strConVarValue) {
		g_vecNetchannelCalls.push({ ConVarName: strConVarName, ConVarValue: strConVarValue, PlayerIndex: Player.Index });

		return true;
	},

	SetProjectileAmmo(Player, strPropertyName, nAmmoValue) {
		g_Assert.equal(strPropertyName, "m_iAmmo.003");

		GetPlayerState(Player).Ammo = nAmmoValue;

		return true;
	},

	SetVectorProperty(EntityReference, strPropertyName, VectorLike) {
		const State = GetPlayerState(EntityReference);
		if (strPropertyName === "m_vecOrigin") {
			State.Origin = Vector.CreateMathStructureFromValue(VectorLike);

		} else if (strPropertyName === "m_angEyeAngles[0]") {
			State.ViewAngle = QAngle.CreateMathStructureFromValue(VectorLike);

		} else if (strPropertyName === "m_vecBaseVelocity") {
			State.BaseVelocity = Vector.CreateMathStructureFromValue(VectorLike);

		} else {
			throw new Error(`unexpected vector property ${strPropertyName}`);
		}

		return true;
	},

	SpawnPlayer(Player, bForce) {
		g_vecActionCalls.push(["SpawnPlayer", Player.Index, bForce]);

		return true;
	},

	GetWeaponIndices(Player, strPropertyName) {
		g_Assert.equal(strPropertyName, "m_hMyWeapons.");

		return [10, 11];
	},
};

const g_HelperRuntime = {
	GetClientLanguage(unIndex) {
		return (unIndex === 1) ? "english" : "russian";
	},

	GetPlayerIndex(PlayerOrIndex) {
		return (typeof PlayerOrIndex === "number") ? PlayerOrIndex : PlayerOrIndex.Index;
	},
};

const g_mapPermissions = new Map([["players.inspect", /^players\.inspect$/]]);

const g_AuthManager = {
	GetPlayerPermissionsFromSteamID() {
		return g_mapPermissions;
	},
};

const g_TraceRuntime = {
	ContentMasks: { All: 0xFFFFFFFF },
	MAX_TRACE_LENGTH: 8192,
	TraceType: { Everything: 0 },

	TraceRay(Ray) {
		return { EndPosition: Vector.CreateMathStructureFromValue(Ray.End), EntityIndex: g_unTraceEntityIndex, Fraction: 0.5, Hit: true };
	},
};

const g_CollisionRuntime = {
	CollisionGroup: { DebrisTrigger: g_unCollisionGroupDebrisTrigger, Player: g_unCollisionGroupPlayer },

	GetCollisionGroup(Player) {
		return GetPlayerState(Player).CollisionGroup;
	},

	SetCollisionGroup(Player, unCollisionGroup) {
		GetPlayerState(Player).CollisionGroup = unCollisionGroup;

		return true;
	},
};

const g_EntityConstants = {
	EntityEffects: { DimLight: g_unDimLightEffect },
	FL_FROZEN: g_unFrozenFlag,
	MoveType: {
		Fly: g_unMoveTypeFly,
		NoClip: g_unMoveTypeNoClip,
		None: g_unMoveTypeNone,
		Walk: g_unMoveTypeWalk,
	},
	TakeDamage: { No: g_unTakeDamageNo, Yes: g_unTakeDamageYes },
};

const g_NetchannelRuntime = {
	NET_FLOW: Object.freeze({ InOut: 2, Incoming: 1, Outgoing: 0 }),

	Channel(unChannelIndex) {
		return {
			SendData(BufferValue) {
				g_vecNetchannelCalls.push([unChannelIndex, BufferValue.Values]);

				return true;
			},
		};
	},

	GetPlayerNetChannelInfo() {
		return {
			GetNetChannelLatency(nFlow) {
				g_Assert.ok((nFlow === g_NetchannelRuntime.NET_FLOW.Outgoing) || (nFlow === g_NetchannelRuntime.NET_FLOW.Incoming), "Use an exported NET_FLOW member.");

				return 0.025;
			},
		};
	},
};

const g_TeamsRuntime = {
	GetTeamClassesByName() {
		return { Soldier: 1 };
	},

	GetTeamClassesByNumber() {
		return { 1: "Soldier" };
	},

	GetTeamName(nTeamNumber) {
		return this.GetTeamNumbers()[nTeamNumber] ?? "";
	},

	GetTeamNames() {
		return { Players: 2 };
	},

	GetTeamNumbers() {
		return { 2: "Players" };
	},

	GetTeamNumber(TeamReference) {
		return (typeof TeamReference === "number") ? TeamReference : (this.GetTeamNames()[TeamReference] ?? -1);
	},
};

const g_MuteManager = {
	IsMuted(unSender, vecReceivers) {
		return (vecReceivers ?? [...g_mapNativePlayers.keys()]).every((unReceiver) => g_mapMutedSenders.get(unReceiver)?.has(unSender) ?? false);
	},

	MutePlayer(unSender, vecReceivers) {
		for (const unReceiver of vecReceivers ?? g_mapNativePlayers.keys()) {
			if (!g_mapMutedSenders.has(unReceiver)) {
				g_mapMutedSenders.set(unReceiver, new Set());
			}

			g_mapMutedSenders.get(unReceiver).add(unSender);
		}

		return true;
	},

	UnmutePlayer(unSender, vecReceivers) {
		for (const unReceiver of vecReceivers ?? g_mapNativePlayers.keys()) {
			g_mapMutedSenders.get(unReceiver)?.delete(unSender);
		}

		return true;
	},
};

const g_WeaponManager = {
	AmmoProperty: "m_iAmmo.",

	FormatName(strName) {
		return strName.startsWith("weapon_") ? strName : `weapon_${strName}`;
	},

	Get(strName) {
		return (strName === "hegrenade") ? { AmmoProperty: 3 } : null;
	},

	MyWeaponsProperty: "m_hMyWeapons.",
	Projectiles: { grenade_projectile: "hegrenade" },
};

const g_WeaponRestrictions = {
	CanUse(Player, Weapon) {
		return !g_mapRestrictedWeapons.get(Player.Index)?.has(Weapon);
	},

	RestrictPlayer(Player, Weapon) {
		if (!g_mapRestrictedWeapons.has(Player.Index)) {
			g_mapRestrictedWeapons.set(Player.Index, new Set());
		}

		g_mapRestrictedWeapons.get(Player.Index).add(Weapon);

		return true;
	},

	UnrestrictPlayer(Player, Weapon) {
		g_mapRestrictedWeapons.get(Player.Index)?.delete(Weapon);

		return true;
	},
};

function RestorePlayersProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		delete Owner[strName];
		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

function CheckActualPlayerTeamProfile(PlayersAPI) {
	const strTeamPath = GetPackagePath("players/teams");
	const TeamNames = { Defenders: 7, Attackers: 13 };
	const TeamNumbers = { 7: "Defenders", 13: "Attackers" };
	const ClassNames = { Scout: 31, Infiltrator: 47 };
	const ClassNumbers = { 31: "Scout", 47: "Infiltrator" };

	let bHasFailure = false;
	let Failure = null;

	const ThrowIfRequested = () => {
		if (bHasFailure) {
			throw Failure;
		}
	};

	const NativeTeamRuntime = {
		GetTeamNumber(TeamReference) {
			ThrowIfRequested();

			return (typeof TeamReference === "number") ? TeamReference : (TeamNames[TeamReference] ?? -1);
		},

		GetTeamName(nTeamNumber) {
			ThrowIfRequested();

			return TeamNumbers[nTeamNumber] ?? "";
		},

		GetTeamNames() {
			ThrowIfRequested();

			return { ...TeamNames };
		},

		GetTeamNumbers() {
			return { ...TeamNumbers };
		},

		GetTeamClassesByName() {
			ThrowIfRequested();

			return { ...ClassNames };
		},

		GetTeamClassesByNumber() {
			ThrowIfRequested();

			return { ...ClassNumbers };
		},
	};

	const RequireDependency = (strName) => {
		g_Assert.equal(strName, "internal/runtime");

		return {
			GetModule(strModuleName) {
				g_Assert.equal(strModuleName, "players/teams");

				return NativeTeamRuntime;
			},
		};
	};

	const ModuleRecord = { exports: {} };
	const Evaluate = g_VM.compileFunction(g_FileSystem.readFileSync(strTeamPath, "utf8"), ["require", "module", "exports"], { filename: strTeamPath });
	Evaluate(RequireDependency, ModuleRecord, ModuleRecord.exports);
	const TeamAPI = ModuleRecord.exports;
	g_Assert.equal(TeamAPI, NativeTeamRuntime);

	const mapDescriptors = new Map(Object.keys(TeamAPI).map((strName) => [strName, Object.getOwnPropertyDescriptor(g_TeamsRuntime, strName)]));
	const State = g_mapPlayerStates.get(1);
	const nPreviousTeam = State.Team;
	const nPreviousClass = State.PlayerClass;

	try {
		for (const strLegacyName of ["NumberOf", "NameOf", "Names", "NamesByNumber", "ClassesByName", "ClassesByNumber"]) {
			g_Assert.equal(Object.hasOwn(g_TeamsRuntime, strLegacyName), false);
			g_Assert.equal(Object.hasOwn(TeamAPI, strLegacyName), false);
		}

		for (const strName of Object.keys(TeamAPI)) {
			Object.defineProperty(g_TeamsRuntime, strName, { configurable: true, enumerable: true, value: TeamAPI[strName], writable: true });
		}

		g_Assert.equal(PlayersAPI.SetTeam(1, "Attackers"), true);
		g_Assert.equal(State.Team, 13);
		g_Assert.equal(PlayersAPI.GetTeamName(1), "Attackers");
		g_Assert.equal(PlayersAPI.SetTeamName(PlayersAPI.Player(1), "Defenders"), true);
		g_Assert.equal(State.Team, 7);
		g_Assert.equal(PlayersAPI.ChangeTeam(1, "Attackers"), true);
		g_Assert.equal(State.Team, 13);
		g_Assert.equal(PlayersAPI.SetPlayerClassName(1, "Scout"), true);
		g_Assert.equal(State.PlayerClass, 31);
		g_Assert.equal(PlayersAPI.GetPlayerClassName(1), "Scout");
		g_Assert.equal(PlayersAPI.SetPlayerClassName(PlayersAPI.Player(1), "Infiltrator"), true);
		g_Assert.equal(State.PlayerClass, 47);
		g_Assert.equal(PlayersAPI.GetPlayerClassName(1), "Infiltrator");
		g_Assert.throws(() => PlayersAPI.SetTeamName(1, "Missing"), RangeError);
		g_Assert.throws(() => PlayersAPI.SetPlayerClassName(1, "Missing"), RangeError);
		g_Assert.equal(State.Team, 13);
		g_Assert.equal(State.PlayerClass, 47);

		bHasFailure = true;

		for (const ErrorValue of [new Error("current team profile failed"), null]) {
			Failure = ErrorValue;
			for (const Operation of [
				() => PlayersAPI.SetTeam(1, 7),
				() => PlayersAPI.ChangeTeam(1, 7),
				() => PlayersAPI.GetTeamName(1),
				() => PlayersAPI.SetTeamName(1, "Defenders"),
				() => PlayersAPI.GetPlayerClassName(1),
				() => PlayersAPI.SetPlayerClassName(1, "Scout"),
			]) {
				g_Assert.throws(Operation, (Thrown) => Thrown === Failure);
			}
		}
	} finally {
		State.Team = nPreviousTeam;
		State.PlayerClass = nPreviousClass;

		for (const [strName, Descriptor] of mapDescriptors) {
			RestorePlayersProperty(g_TeamsRuntime, strName, Descriptor);
		}
	}
}

function CheckPlayerPermissionsDocumentation(DocumentationAPI, PlayersAPI) {
	class PlayerPermissionsFixture extends Map {
	}

	const mapPermissions = new PlayerPermissionsFixture([["players.inspect", /^players\.inspect$/]]);
	const Descriptor = Object.getOwnPropertyDescriptor(g_AuthManager, "GetPlayerPermissionsFromSteamID");

	try {
		Object.defineProperty(g_AuthManager, "GetPlayerPermissionsFromSteamID", { configurable: true, enumerable: true, value: () => mapPermissions, writable: true });

		const Report = DocumentationAPI.ReadIdentity(PlayersAPI.Player(1));
		g_Assert.equal(Object.hasOwn(mapPermissions, "Permissions"), false);
		g_Assert.deepEqual(Report.Permissions, ["players.inspect"]);
		Report.Permissions.push("caller-only");
		g_Assert.equal(mapPermissions.has("caller-only"), false);

		g_AuthManager.GetPlayerPermissionsFromSteamID = () => null;
		g_Assert.equal(DocumentationAPI.ReadIdentity(PlayersAPI.Player(1)).Permissions, null);

		g_AuthManager.GetPlayerPermissionsFromSteamID = () => ({ Permissions: ["legacy-shape"] });
		g_Assert.throws(() => DocumentationAPI.ReadIdentity(PlayersAPI.Player(1)), /permissions record/);

		for (const Failure of [new Error("permission lookup failed"), null]) {
			g_AuthManager.GetPlayerPermissionsFromSteamID = () => {
				throw Failure;
			};
			g_Assert.throws(() => DocumentationAPI.ReadIdentity(PlayersAPI.Player(1)), (Thrown) => Thrown === Failure);
		}
	} finally {
		RestorePlayersProperty(g_AuthManager, "GetPlayerPermissionsFromSteamID", Descriptor);
	}
}

function CheckActualPlayerNetworkInformation(PlayersAPI) {
	const strNetChannelPath = GetPackagePath("netchannel");
	const strSource = g_FileSystem.readFileSync(strNetChannelPath, "utf8");

	const unAddress = 0x20000000000001n;
	const Information = { Address: unAddress, LatencyIncoming: 0.0125, LatencyOutgoing: 0.025 };

	let bMissingChannel = false;
	let bHasFailure = false;
	let Failure = null;

	const NativeRuntime = {
		GetFlowConstants() {
			return { Outgoing: 17, Incoming: 23, InOut: 41 };
		},

		GetInformation(unPlayerIndex) {
			g_Assert.equal(unPlayerIndex, 1);

			if (bHasFailure) {
				throw Failure;
			}

			return bMissingChannel ? null : Information;
		},

		GetRequiredInformationFromAddress(unValueAddress) {
			g_Assert.equal(unValueAddress, unAddress);

			return Information;
		},
	};

	const RequireDependency = (strName) => {
		if (strName === "internal/runtime") {
			return {
				GetModule(strModuleName) {
					g_Assert.equal(strModuleName, "netchannel");

					return NativeRuntime;
				},
			};
		}

		if (strName === "memory") {
			return { RegisterObjectType: () => undefined };
		}

		g_Assert.equal(strName, "bitbuffers");

		return {
			BitBufferWrite: class BitBufferWrite {
			},
		};
	};

	const ModuleRecord = { exports: {} };
	const Evaluate = g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: strNetChannelPath });
	Evaluate(RequireDependency, ModuleRecord, ModuleRecord.exports);

	const NetChannelAPI = ModuleRecord.exports;
	g_Assert.equal(typeof NetChannelAPI.GetPlayerNetChannelInfo, "function");
	g_Assert.equal(Object.hasOwn(NetChannelAPI, "GetInfo"), false);

	const Descriptor = Object.getOwnPropertyDescriptor(g_NetchannelRuntime, "GetPlayerNetChannelInfo");

	try {
		Object.defineProperty(g_NetchannelRuntime, "GetPlayerNetChannelInfo", { configurable: true, enumerable: true, value: NetChannelAPI.GetPlayerNetChannelInfo, writable: true });

		const ChannelInformation = PlayersAPI.GetNetInfo(1);
		g_Assert.ok(ChannelInformation instanceof NetChannelAPI.NetChannelInfo);
		g_Assert.equal(ChannelInformation.Address, unAddress);
		g_Assert.equal(ChannelInformation.PlayerIndex, 1);
		g_Assert.equal(ChannelInformation.GetNetChannelLatency(NetChannelAPI.NET_FLOW.Incoming), Information.LatencyIncoming);
		g_Assert.equal(ChannelInformation.GetNetChannelLatency(NetChannelAPI.NET_FLOW.Outgoing), Information.LatencyOutgoing);

		bMissingChannel = true;
		g_Assert.equal(PlayersAPI.GetNetInfo(1), null);
		bMissingChannel = false;
		bHasFailure = true;

		for (const ErrorValue of [new Error("native channel lookup failed"), null]) {
			Failure = ErrorValue;
			let bThrown = false;
			let Thrown = null;

			try {
				PlayersAPI.GetNetInfo(1);
			} catch (CaughtError) {
				bThrown = true;
				Thrown = CaughtError;
			}

			g_Assert.equal(bThrown, true);
			g_Assert.equal(Thrown, ErrorValue);
		}
	} finally {
		RestorePlayersProperty(g_NetchannelRuntime, "GetPlayerNetChannelInfo", Descriptor);
	}
}

function IsPackageCachePath(strFilePath) {
	const strRelativePath = g_Path.relative(g_strPackageRootPath, strFilePath);

	return (strRelativePath.length > 0) && !g_Path.isAbsolute(strRelativePath) && (strRelativePath !== "..") && !strRelativePath.startsWith(".." + g_Path.sep);
}

function CapturePackageCacheDescriptors() {
	const mapDescriptors = new Map();
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strFilePath)) {
			mapDescriptors.set(strFilePath, Object.getOwnPropertyDescriptor(require.cache, strFilePath));
		}
	}

	return mapDescriptors;
}

function RestorePackageCacheDescriptors(mapDescriptors) {
	const vecErrors = [];
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (!IsPackageCachePath(strFilePath)) {
			continue;
		}

		try {
			delete require.cache[strFilePath];
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	for (const [strFilePath, Descriptor] of mapDescriptors) {
		try {
			RestorePlayersProperty(require.cache, strFilePath, Descriptor);
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Players smoke package-cache restoration failed.");
	}
}

function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const unScriptTimeoutMilliseconds = 1000;

	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, Arguments)", { filename: `${g_strPlayersDocumentationPath}:${strLabel}` });

	// Bounds synchronous JavaScript, not native IO; this is not an untrusted-code sandbox.
	return Script.runInNewContext({ Callback, Receiver, Arguments: vecArguments }, { timeout: unScriptTimeoutMilliseconds });
}

const g_mapOriginalPackageCacheDescriptors = CapturePackageCacheDescriptors();
const g_OriginalModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
let g_bPackageCacheMutated = false;
let g_bExecutionFailed = false;
let g_ExecutionErrorValue = null;

try {
	for (const [strFilePath, Descriptor] of g_mapOriginalPackageCacheDescriptors) {
		if (!Descriptor.configurable) {
			throw new TypeError(`Players smoke cannot replace a non-configurable package cache entry: ${strFilePath}`);
		}
	}

	g_bPackageCacheMutated = true;
	for (const strFilePath of g_mapOriginalPackageCacheDescriptors.keys()) {
		delete require.cache[strFilePath];
	}

	InstallDependency("internal/runtime", {
		GetModule(strModuleName) {
			if (strModuleName === "players") {
				return g_PlayersRuntime;
			}

			if (strModuleName === "players/helpers") {
				return g_HelperRuntime;
			}

			if (strModuleName === "events") {
				return {
					FireEvent: (...vecArguments) => {
						g_vecEventCalls.push({ DoNotBroadcast: vecArguments[2], Name: vecArguments[0], Payload: vecArguments[1] });

						return true;
					},
				};
			}

			throw new Error(`unexpected native module ${strModuleName}`);
		},
	});

	InstallDependency("auth/manager", { AUTH_MANAGER: g_AuthManager });
	InstallDependency("engines/sound", { SOUND_FROM_WORLD: 0, Sound, StreamSound });

	InstallDependency("engines/server", {
		GetClientCVarValue(unIndex, strConVarName) {
			g_Assert.ok(g_mapNativePlayers.has(unIndex));
			g_Assert.ok(["cl_language", "rate"].includes(strConVarName));

			return (strConVarName === "rate") ? "30000" : "english";
		},
	});

	InstallDependency("engines/trace", g_TraceRuntime);

	InstallDependency("entities", {
		Entity(unIndex) {
			return { Index: unIndex };
		},

		DecorateEntity(EntityValue) {
			return EntityValue;
		},
	});

	InstallDependency("entities/collisions", g_CollisionRuntime);
	InstallDependency("entities/constants", g_EntityConstants);
	InstallDependency("entities/helpers", {});

	InstallDependency("events", {
		FireEvent(strEventName, EventPayload, bDoNotBroadcast) {
			g_vecEventCalls.push({ DoNotBroadcast: bDoNotBroadcast, Name: strEventName, Payload: EventPayload });

			return true;
		},
	});

	InstallDependency("filters/entities", { EntityTraceFilter });
	InstallDependency("filters/weapons", { WeaponClassIterator });
	InstallDependency("netchannel", g_NetchannelRuntime);

	InstallDependency("steam", {
		SteamID: {
			Parse(strSteamValue) {
				return {
					Render() {
						return strSteamValue;
					},
				};
			},
		},
	});

	InstallDependency("weapons", {
		Weapon(unIndex) {
			return g_mapWeaponRecords.get(unIndex);
		},
	});

	InstallDependency("mathlib", { QAngle, Vector });

	InstallDependency("players/dropweapon", {
		DropWeapon(Player, Weapon, Target, Velocity) {
			g_vecDroppedWeapons.push({ Player, Target, Velocity, Weapon });

			return true;
		},
	});

	InstallDependency("players/teams", g_TeamsRuntime);
	InstallDependency("players/voice", { MUTE_MANAGER: g_MuteManager });
	InstallDependency("weapons/manager", { WEAPON_MANAGER: g_WeaponManager });
	InstallDependency("weapons/restrictions", g_WeaponRestrictions);

	function LoadPlayersModule() {
		const OriginalModuleLoad = g_Module._load;
		const ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");

		const Load = function Load(strRequestName, ParentModule, bIsMain) {
			const strModulePath = GetPackagePath(strRequestName);
			if (Object.hasOwn(require.cache, strModulePath)) {
				return require.cache[strModulePath].exports;
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		try {
			Object.defineProperty(g_Module, "_load", { configurable: true, enumerable: ModuleLoadDescriptor.enumerable, writable: true, value: Load });

			return require(g_strPlayersPath);
		} finally {
			RestorePlayersProperty(g_Module, "_load", ModuleLoadDescriptor);
		}
	}

	delete require.cache[g_strPlayersPath];

	const g_Players = LoadPlayersModule();
	CheckActualPlayerTeamProfile(g_Players);
	CheckActualPlayerNetworkInformation(g_Players);

	const bOriginalVehicleState = g_mapPlayerStates.get(1).InVehicle;

	try {
		g_mapPlayerStates.get(1).InVehicle = false;
		g_Assert.equal(g_Players.IsInAVehicle(1), false, "IsInAVehicle must read the native IsInVehicle result.");
		g_mapPlayerStates.get(1).InVehicle = true;
		g_Assert.equal(g_Players.IsInAVehicle(1), true, "IsInAVehicle must preserve a true native vehicle state.");
		g_Assert.equal(g_Players.Player(1).IsInAVehicle(), true, "Decorated player IsInAVehicle must use the native IsInVehicle contract.");
	} finally {
		g_mapPlayerStates.get(1).InVehicle = bOriginalVehicleState;
	}

	const g_vecExpectedExports = [
		"Player",
		"Ban",
		"ChangeTeam",
		"DecoratePlayer",
		"DropWeapon",
		"ExecuteClientCommand",
		"FireGameEvent",
		"FromUserID",
		"GetActiveWeapon",
		"GetAllPlayers",
		"GetClientCVarValue",
		"GetClientCount",
		"GetEyeLocation",
		"GetFlashlight",
		"GetFrozen",
		"GetGodMode",
		"GetJetpack",
		"GetLanguage",
		"GetMaximumClients",
		"GetName",
		"GetNetInfo",
		"GetNoBlock",
		"GetNoClip",
		"GetPermissions",
		"GetPlayerClass",
		"GetPlayerClassName",
		"GetPrimaryWeapon",
		"GetProjectileAmmo",
		"GetProjectileIndexes",
		"GetRawSteamID",
		"GetSecondaryWeapon",
		"GetSpectators",
		"GetStuck",
		"GetTeam",
		"GetTeamName",
		"GetTraceRay",
		"GetViewCoordinates",
		"GetViewEntity",
		"GetViewPlayer",
		"GetViewVector",
		"GetWeapon",
		"GetWeaponIndexes",
		"GetWeapons",
		"IsBot",
		"IsConnected",
		"IsDead",
		"IsFakeClient",
		"IsHLTV",
		"IsInAVehicle",
		"IsMuted",
		"IsObserver",
		"IsWeaponRestricted",
		"Kick",
		"Mute",
		"PlaySound",
		"Push",
		"RestrictWeapons",
		"Say",
		"SayTeam",
		"SendConVarValue",
		"SetActiveWeapon",
		"SetEyeLocation",
		"SetFlashlight",
		"SetFrozen",
		"SetGodMode",
		"SetJetpack",
		"SetName",
		"SetNoBlock",
		"SetNoClip",
		"SetPlayerClass",
		"SetPlayerClassName",
		"SetProjectileAmmo",
		"SetStuck",
		"SetTeam",
		"SetTeamName",
		"SetViewCoordinates",
		"SetViewEntity",
		"SetViewPlayer",
		"Slay",
		"Spawn",
		"Unmute",
		"UnrestrictWeapons",
	].sort();

	g_Assert.deepEqual(Object.keys(g_Players).sort(), g_vecExpectedExports, "players must expose the exact root API.");

	const g_vecConnectedPlayers = g_Players.GetAllPlayers();
	g_Assert.strictEqual(g_vecConnectedPlayers, g_vecLatestNativePlayerList, "GetAllPlayers must decorate the fresh native array in place.");
	g_Assert.equal(g_vecConnectedPlayers.length, 2, "GetAllPlayers must decorate every native player.");
	g_Assert.equal(g_Players.Player(1).Index, 1, "Player must resolve a live native player.");
	g_Assert.equal(g_Players.FromUserID(22).Index, 2, "FromUserID must resolve a live native player.");
	g_Assert.throws(() => g_Players.DecoratePlayer({ Index: 3 }), /native Ban\(\) method/, "DecoratePlayer must reject non-native snapshots.");

	g_unTraceEntityIndex = 100;
	g_Assert.equal(g_Players.GetViewPlayer(g_Players.Player(1)), null, "GetViewPlayer must return null for an ordinary entity.");
	g_unTraceEntityIndex = 2;
	g_Assert.equal(g_Players.GetViewPlayer(g_Players.Player(1)).Index, 2, "GetViewPlayer must decorate a connected hit player.");

	const g_OriginalPlayerTraceRayDescriptor = Object.getOwnPropertyDescriptor(g_TraceRuntime, "TraceRay");

	try {
		Object.defineProperty(g_TraceRuntime, "TraceRay", { configurable: true, enumerable: g_OriginalPlayerTraceRayDescriptor?.enumerable ?? true, writable: true, value: () => null });
		g_Assert.throws(() => g_Players.GetTraceRay(g_Players.Player(1)), /Player trace must return an object/);

		g_TraceRuntime.TraceRay = () => ({ Hit: 1 });
		g_Assert.throws(() => g_Players.GetTraceRay(g_Players.Player(1)), /Player trace hit must be a boolean/);

		g_TraceRuntime.TraceRay = () => ({ EntityIndex: -1, Hit: true });
		g_Assert.throws(() => g_Players.GetViewEntity(g_Players.Player(1)), /entity index must be a non-negative safe integer/);
	} finally {
		RestorePlayersProperty(g_TraceRuntime, "TraceRay", g_OriginalPlayerTraceRayDescriptor);
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecCodeBlocks.length, 18, "players documentation must retain all practical workflows.");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes('"Ren"'), "players documentation must not contain generated placeholder values.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.[A-Za-z_$]/, "players documentation must use checked workflows instead of console output.");

	const g_vecRootImport = g_vecCodeBlocks[0].match(/const \{([\s\S]*?)\} = require\("players"\);/);
	g_Assert.ok(g_vecRootImport, "players documentation root import.");

	const g_vecImportedExports = [...g_vecRootImport[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)(?:\s*:\s*[A-Za-z][A-Za-z0-9_]*)?,$/gm)].map((vecMatch) => vecMatch[1]).sort();
	g_Assert.deepEqual(g_vecImportedExports, g_vecExpectedExports, "players documentation root import must list the exact API.");

	const g_setDocumentedExports = new Set();
	for (const strLine of g_strDocumentation.split(/\r?\n/)) {
		if (!strLine.startsWith("| `")) {
			continue;
		}

		const strFirstCell = strLine.split("|", 3)[1];
		for (const vecMatch of strFirstCell.matchAll(/`([A-Za-z][A-Za-z0-9]*)(?:\([^`]*)?`/g)) {
			g_setDocumentedExports.add(vecMatch[1]);
		}
	}

	g_Assert.deepEqual([...g_setDocumentedExports].sort(), g_vecExpectedExports, "players documentation must list the exact root API.");

	const g_vecContents = g_strDocumentation.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(g_vecContents, "players documentation contents section.");

	const g_vecContentsAnchors = [...g_vecContents[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const g_vecSectionAnchors = [...g_strDocumentation.matchAll(/^## (.+)$/gm)].map((vecMatch) => vecMatch[1].toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(g_vecContentsAnchors, g_vecSectionAnchors, "players documentation contents anchors.");

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players") {
			return g_Players;
		}

		return require(GetPackagePath(strModuleName));
	}

	const g_vecRootDocumentationModules = [];
	for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; ++unIndex) {
		const ModuleRecord = { exports: {} };
		const Script = new g_VM.Script(`(function(require, module, exports) {\n${g_vecCodeBlocks[unIndex]}\n})`, { filename: `${g_strPlayersDocumentationPath}:example-${unIndex + 1}` });
		const Callback = Script.runInThisContext();
		RunDocumentationFunction(Callback, undefined, [RequireDocumentationModule, ModuleRecord, ModuleRecord.exports], `example-${unIndex + 1}:initialize`);
		g_vecRootDocumentationModules.push(ModuleRecord.exports);

		if (typeof ModuleRecord.exports.DropActiveWeapon === "function") {
			g_Assert.equal(RunDocumentationFunction(ModuleRecord.exports.DropActiveWeapon, ModuleRecord.exports, [g_Players.Player(1)], `example-${unIndex + 1}:DropActiveWeapon`), true, "DropActiveWeapon documentation helper.");
		}
	}

	CheckPlayerPermissionsDocumentation(g_vecRootDocumentationModules[2], g_Players);

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players documentation link must exist: ${strTarget}`);
	}

	g_Assert.equal(g_mapPlayerStates.get(1).Name, "Alice", "rename example must restore the player name.");
	g_Assert.equal(g_mapPlayerStates.get(1).CollisionGroup, g_unCollisionGroupPlayer, "state example must restore collision state.");
	g_Assert.equal(g_mapPlayerStates.get(1).TakeDamage, g_unTakeDamageYes, "state example must restore damage state.");
	g_Assert.equal(g_mapPlayerStates.get(1).Effects, 0, "state example must restore flashlight state.");
	g_Assert.equal(g_mapPlayerStates.get(1).Flags, 0, "state example must restore frozen state.");

	let g_unStreamOptionReadCount = 0;
	const g_OneReadSoundOptions = {
		get Stream() {
			++g_unStreamOptionReadCount;

			return false;
		},
	};

	g_Players.PlaySound(g_Players.Player(1), "buttons/button14.wav", g_OneReadSoundOptions);

	g_Assert.equal(g_unStreamOptionReadCount, 1, "PlaySound must read the stream option once per operation.");
	g_Assert.throws(() => g_Players.PlaySound(g_Players.Player(1), "buttons/button14.wav", null), /SoundOptions must be an object/, "PlaySound must reject null options.");

	let g_unEventFieldReadCount = 0;
	const g_OneReadEventPayload = {
		get text() {
			++g_unEventFieldReadCount;

			return "one read";
		},
	};

	g_Players.FireGameEvent(g_Players.Player(1), "player_say", g_OneReadEventPayload, false);

	g_Assert.equal(g_unEventFieldReadCount, 1, "FireGameEvent must read each payload field once per operation.");
	g_Assert.throws(() => g_Players.FireGameEvent(g_Players.Player(1), "player_say", null, false), /EventPayload must be an object/, "FireGameEvent must reject null payloads.");

	const g_unNetchannelCallCountBeforeSuccess = g_vecNetchannelCalls.length;
	g_Assert.equal(g_Players.SendConVarValue(g_Players.Player(1), "cl_language", "english"), true, "SendConVarValue must return the exact native send result.");
	g_Assert.deepEqual(g_vecNetchannelCalls[g_unNetchannelCallCountBeforeSuccess], { ConVarName: "cl_language", ConVarValue: "english", PlayerIndex: 1 }, "SendConVarValue must forward the player and both ConVar strings directly.");

	const g_OriginalSendConVarValueDescriptor = Object.getOwnPropertyDescriptor(g_PlayersRuntime, "SendConVarValue");
	const g_unNetchannelCallCountBeforeSendFailure = g_vecNetchannelCalls.length;

	try {
		Object.defineProperty(g_PlayersRuntime, "SendConVarValue", {
			configurable: true,
			enumerable: g_OriginalSendConVarValueDescriptor?.enumerable ?? true,
			writable: true,

			value: function FailSendConVarValue() {
				return false;
			},
		});

		g_Assert.equal(g_Players.SendConVarValue(g_Players.Player(1), "cl_language", "english"), false, "SendConVarValue must return a failed native send result.");
	} finally {
		RestorePlayersProperty(g_PlayersRuntime, "SendConVarValue", g_OriginalSendConVarValueDescriptor);
	}

	g_Assert.equal(g_vecNetchannelCalls.length, g_unNetchannelCallCountBeforeSendFailure, "SendConVarValue must forward a failed native send result without creating a second request.");

	g_Assert.ok(g_vecEventCalls.some((EventCall) => (EventCall.Name === "player_say") && (EventCall.Payload.userid === 11)), "FireGameEvent must inject the current UserID.");
	g_Assert.ok(g_vecSoundCalls.some((SoundCall) => SoundCall.Sample === "buttons/button14.wav"), "PlaySound example must use the sound service.");
	g_Assert.ok(g_vecNetchannelCalls.length > 0, "SendConVarValue example must send a netchannel message.");
	g_Assert.ok(g_vecDroppedWeapons.length > 0, "DropWeapon example must call the selected SDK implementation.");
	g_Assert.equal(g_mapRestrictedWeapons.get(1)?.size ?? 0, 0, "restriction example must clean up its state.");
	g_Assert.equal(g_mapMutedSenders.get(2)?.size ?? 0, 0, "voice example must clean up its state.");

	let g_unRootDocumentationScenarioCount = 0;
	const g_RenameDocumentation = g_vecRootDocumentationModules[3];
	const g_RenamePlayer = g_Players.Player(1);

	function VerifyRootDocumentationCase(strScenarioName, Callback) {
		g_Assert.doesNotThrow(Callback, strScenarioName);
		++g_unRootDocumentationScenarioCount;
	}

	function WithDocumentedNameMethods(GetNameReplacement, SetNameReplacement, Callback) {
		const GetNameDescriptor = Object.getOwnPropertyDescriptor(g_PlayersRuntime, "GetName");
		const SetNameDescriptor = Object.getOwnPropertyDescriptor(g_PlayersRuntime, "SetName");

		try {
			Object.defineProperty(g_PlayersRuntime, "GetName", { configurable: true, enumerable: GetNameDescriptor?.enumerable ?? true, writable: true, value: GetNameReplacement });
			Object.defineProperty(g_PlayersRuntime, "SetName", { configurable: true, enumerable: SetNameDescriptor?.enumerable ?? true, writable: true, value: SetNameReplacement });

			Callback();
		} finally {
			RestorePlayersProperty(g_PlayersRuntime, "GetName", GetNameDescriptor);
			RestorePlayersProperty(g_PlayersRuntime, "SetName", SetNameDescriptor);
		}
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("temporary rename requires exact true before restoration", () => {
			let unWrites = 0;
			let strName = "Original";
			WithDocumentedNameMethods(() => strName, (CurrentPlayer, strNewName) => {
				g_Assert.equal(CurrentPlayer, g_RenamePlayer);
				++unWrites;
				strName = strNewName;

				return (unWrites === 1) ? InvalidStatus : true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), /temporary player name/);
				g_Assert.equal(unWrites, 2);
			});
		});

		VerifyRootDocumentationCase("restoration requires exact true", () => {
			let unWrites = 0;
			let strName = "Original";
			WithDocumentedNameMethods(() => strName, (CurrentPlayer, strNewName) => {
				g_Assert.equal(CurrentPlayer, g_RenamePlayer);
				++unWrites;
				strName = strNewName;

				return (unWrites === 2) ? InvalidStatus : true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), /original player name/);
				g_Assert.equal(unWrites, 2);
			});
		});
	}

	for (const InvalidName of [undefined, null, 1, false, {}, []]) {
		for (const bPreviousName of [true, false]) {
			VerifyRootDocumentationCase("invalid names reject before either write", () => {
				let unWrites = 0;
				WithDocumentedNameMethods(() => bPreviousName ? InvalidName : "Original", () => {
					++unWrites;

					return true;
				}, () => {
					g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, bPreviousName ? "Temporary" : InvalidName], "RenamePlayerTemporarily"), TypeError);
					g_Assert.equal(unWrites, 0);
				});
			});
		}
	}

	for (const Failure of [new Error("original name operation failure"), null]) {
		VerifyRootDocumentationCase("initial getter failure propagates without a write", () => {
			let unWrites = 0;
			WithDocumentedNameMethods(() => {
				throw Failure;
			}, () => {
				++unWrites;

				return true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), (ErrorValue) => ErrorValue === Failure);
				g_Assert.equal(unWrites, 0);
			});
		});

		VerifyRootDocumentationCase("failed initial write retains original failure after restoration", () => {
			let unWrites = 0;
			WithDocumentedNameMethods(() => "Original", (CurrentPlayer, strNewName) => {
				++unWrites;
				if (unWrites === 1) {
					throw Failure;
				}

				g_Assert.equal(CurrentPlayer, g_RenamePlayer);
				g_Assert.equal(strNewName, "Original");

				return true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), (ErrorValue) => ErrorValue === Failure);
				g_Assert.equal(unWrites, 2);
			});
		});

		VerifyRootDocumentationCase("post-write getter failure retains original failure after restoration", () => {
			let unReads = 0;
			let unWrites = 0;
			WithDocumentedNameMethods(() => {
				++unReads;
				if (unReads === 2) {
					throw Failure;
				}

				return "Original";
			}, () => {
				++unWrites;

				return true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), (ErrorValue) => ErrorValue === Failure);
				g_Assert.equal(unWrites, 2);
			});
		});

		VerifyRootDocumentationCase("cleanup-only failure propagates unchanged", () => {
			let unWrites = 0;
			let strName = "Original";
			WithDocumentedNameMethods(() => strName, (CurrentPlayer, strNewName) => {
				++unWrites;
				if (unWrites === 2) {
					throw Failure;
				}

				strName = strNewName;

				return true;
			}, () => {
				g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), (ErrorValue) => ErrorValue === Failure);
				g_Assert.equal(unWrites, 2);
			});
		});

		for (const CleanupFailure of [new Error("original name cleanup failure"), null]) {
			VerifyRootDocumentationCase("dual failure aggregates original operation before cleanup", () => {
				let unWrites = 0;
				WithDocumentedNameMethods(() => "Original", () => {
					++unWrites;
					throw (unWrites === 1) ? Failure : CleanupFailure;
				}, () => {
					g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), (ErrorValue) => {
						g_Assert.ok(ErrorValue instanceof AggregateError);
						g_Assert.equal(ErrorValue.errors.length, 2);
						g_Assert.equal(ErrorValue.errors[0], Failure);
						g_Assert.equal(ErrorValue.errors[1], CleanupFailure);

						return true;
					});
					g_Assert.equal(unWrites, 2);
				});
			});
		}
	}

	VerifyRootDocumentationCase("successful temporary rename writes and restores the live original name", () => {
		let unWrites = 0;
		let strName = "Original";
		WithDocumentedNameMethods(() => strName, (CurrentPlayer, strNewName) => {
			g_Assert.equal(CurrentPlayer, g_RenamePlayer);
			++unWrites;
			strName = strNewName;

			return true;
		}, () => {
			g_Assert.equal(RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), true);
			g_Assert.equal(strName, "Original");
			g_Assert.equal(unWrites, 2);
		});
	});

	VerifyRootDocumentationCase("accepted write without requested live name still attempts restoration", () => {
		let unWrites = 0;
		WithDocumentedNameMethods(() => "Original", () => {
			++unWrites;

			return true;
		}, () => {
			g_Assert.throws(() => RunDocumentationFunction(g_RenameDocumentation.RenamePlayerTemporarily, g_RenameDocumentation, [g_RenamePlayer, "Temporary"], "RenamePlayerTemporarily"), /temporary player name/);
			g_Assert.equal(unWrites, 2);
		});
	});

	const g_DocumentationBlockIndexes = {
		Communication: 5,
		AdministrativeActions: 6,
		Mute: 7,
		TemporaryState: 8,
		Movement: 9,
		Launch: 10,
		View: 11,
		Aim: 12,
		Networking: 13,
		Weapons: 14,
		Projectiles: 15,
		Restrictions: 16,
		DropWeapon: 17,
	};

	function ExecuteRootDocumentation(unBlockIndex, Overrides) {
		const PlayersFacade = Object.assign({}, g_Players, Overrides);
		const ModuleRecord = { exports: {} };
		const Script = new g_VM.Script("(function(require, module, exports) {\n" + g_vecCodeBlocks[unBlockIndex] + "\n})", { filename: `${g_strPlayersDocumentationPath}:isolated-${unBlockIndex + 1}` });
		const Callback = Script.runInThisContext();
		RunDocumentationFunction(Callback, undefined, [(strModuleName) => (strModuleName === "players") ? PlayersFacade : RequireDocumentationModule(strModuleName), ModuleRecord, ModuleRecord.exports], `isolated-${unBlockIndex + 1}:initialize`);

		return ModuleRecord.exports;
	}

	function CaptureRootDocumentationFailure(Callback) {
		let bThrew = false;
		let Failure = null;

		try {
			Callback();
		} catch (CaughtFailure) {
			bThrew = true;
			Failure = CaughtFailure;
		}

		g_Assert.equal(bThrew, true, "the documented operation must fail");

		return Failure;
	}

	function CreateDocumentedStateFixture(Options = {}) {
		const PreviousState = { Flashlight: false, GodMode: true, NoBlock: false, Frozen: true };
		const State = Object.assign({}, PreviousState);
		const vecRestoredFields = [];
		const mapReads = new Map();
		const Overrides = { GetAllPlayers: () => [{ Index: 1 }] };

		for (const strField of Object.keys(PreviousState)) {
			Overrides["Get" + strField] = () => {
				const unRead = (mapReads.get(strField) ?? 0) + 1;
				mapReads.set(strField, unRead);

				return Options.Read ? Options.Read(strField, unRead, State[strField]) : State[strField];
			};

			Overrides["Set" + strField] = (PlayerReference, bValue) => {
				g_Assert.equal(PlayerReference.Index, 1);

				const bRestoring = bValue === PreviousState[strField];
				if (bRestoring) {
					vecRestoredFields.push(strField);
				}

				State[strField] = bValue;

				return Options.Write ? Options.Write(strField, bRestoring) : true;
			};
		}

		if (Options.Frozen === false) {
			Overrides.GetFrozen = undefined;
			Overrides.SetFrozen = undefined;
		}

		return { Overrides, PreviousState, State, RestoredFields: vecRestoredFields };
	}

	for (const bFrozen of [false, true]) {
		VerifyRootDocumentationCase("temporary states restore every supported field", () => {
			const Fixture = CreateDocumentedStateFixture({ Frozen: bFrozen });
			ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides);
			g_Assert.deepEqual(Fixture.State, Fixture.PreviousState);
			g_Assert.deepEqual(Fixture.RestoredFields, bFrozen ? ["Flashlight", "GodMode", "NoBlock", "Frozen"] : ["Flashlight", "GodMode", "NoBlock"]);
		});
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("temporary state update rejects non-true status and still restores all fields", () => {
			const Fixture = CreateDocumentedStateFixture({ Write: (strField, bRestoring) => ((strField === "Flashlight") && !bRestoring) ? InvalidStatus : true });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides), /not applied/);
			g_Assert.deepEqual(Fixture.State, Fixture.PreviousState);
			g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
		});

		VerifyRootDocumentationCase("temporary state cleanup rejects non-true status without skipping later restoration", () => {
			const Fixture = CreateDocumentedStateFixture({ Write: (strField, bRestoring) => ((strField === "Flashlight") && bRestoring) ? InvalidStatus : true });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides), /could not be restored/);
			g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
		});
	}

	for (const InvalidValue of [undefined, null, 1, "true"]) {
		VerifyRootDocumentationCase("temporary state validates original booleans before any mutation", () => {
			const Fixture = CreateDocumentedStateFixture({ Read: (strField, unRead, bValue) => ((strField === "GodMode") && (unRead === 1)) ? InvalidValue : bValue });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides), /must return booleans/);
			g_Assert.deepEqual(Fixture.State, Fixture.PreviousState);
			g_Assert.deepEqual(Fixture.RestoredFields, []);
		});

		VerifyRootDocumentationCase("temporary state rejects malformed update readback and restores", () => {
			const Fixture = CreateDocumentedStateFixture({ Read: (strField, unRead, bValue) => ((strField === "GodMode") && (unRead === 2)) ? InvalidValue : bValue });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides), /not applied/);
			g_Assert.deepEqual(Fixture.State, Fixture.PreviousState);
		});
	}

	for (const OperationFailure of [new Error("state update fault"), null]) {
		VerifyRootDocumentationCase("temporary state preserves thrown values after successful cleanup", () => {
			const Fixture = CreateDocumentedStateFixture({
				Write: (strField, bRestoring) => {
					if ((strField === "GodMode") && !bRestoring) {
						throw OperationFailure;
					}

					return true;
				},
			});
			g_Assert.equal(CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides)), OperationFailure);
			g_Assert.deepEqual(Fixture.State, Fixture.PreviousState);
			g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
		});

		VerifyRootDocumentationCase("temporary state aggregates original and all independent cleanup faults in order", () => {
			const FirstCleanupFailure = new Error("flashlight restore fault");
			const SecondCleanupFailure = new Error("no-block restore fault");
			const Fixture = CreateDocumentedStateFixture({
				Write: (strField, bRestoring) => {
					if ((strField === "GodMode") && !bRestoring) {
						throw OperationFailure;
					}

					if (bRestoring && (strField === "Flashlight")) {
						throw FirstCleanupFailure;
					}

					if (bRestoring && (strField === "NoBlock")) {
						throw SecondCleanupFailure;
					}

					return true;
				},
			});
			const Failure = CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides));
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.deepEqual(Failure.errors, [OperationFailure, FirstCleanupFailure, SecondCleanupFailure]);
			g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
		});
	}

	VerifyRootDocumentationCase("temporary state exposes incomplete frozen capabilities before mutation", () => {
		const Fixture = CreateDocumentedStateFixture();
		Fixture.Overrides.SetFrozen = undefined;
		g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides), /incomplete frozen-state/);
		g_Assert.deepEqual(Fixture.RestoredFields, []);
	});

	VerifyRootDocumentationCase("temporary state preserves a sole cleanup throw without replacing its identity", () => {
		const CleanupFailure = new Error("sole cleanup fault");
		const Fixture = CreateDocumentedStateFixture({
			Write: (strField, bRestoring) => {
				if ((strField === "Flashlight") && bRestoring) {
					throw CleanupFailure;
				}

				return true;
			},
		});
		g_Assert.equal(CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides)), CleanupFailure);
		g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
	});

	VerifyRootDocumentationCase("temporary state aggregates multiple cleanup faults even without an update failure", () => {
		const CleanupFailure = new Error("cleanup fault");
		const Fixture = CreateDocumentedStateFixture({
			Write: (strField, bRestoring) => {
				if (bRestoring && (strField !== "Frozen")) {
					throw CleanupFailure;
				}

				return true;
			},
		});
		const Failure = CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.TemporaryState, Fixture.Overrides));
		g_Assert.ok(Failure instanceof AggregateError);
		g_Assert.deepEqual(Failure.errors, [CleanupFailure, CleanupFailure, CleanupFailure]);
		g_Assert.deepEqual(Fixture.RestoredFields, ["Flashlight", "GodMode", "NoBlock", "Frozen"]);
	});

	function CreateDocumentedMuteFixture(Options = {}) {
		let bMuted = Options.Muted ?? false;
		let unReads = 0;
		const vecActions = [];
		const Overrides = {
			GetAllPlayers: () => [{ Index: 1 }, { Index: 2 }],

			GetSpectators: () => Options.Spectators ? Options.Spectators() : [],

			IsMuted: () => {
				++unReads;

				return Options.Read ? Options.Read(unReads, bMuted) : bMuted;
			},

			Mute: (Sender, vecReceivers) => {
				g_Assert.deepEqual(vecReceivers, [2]);
				g_Assert.equal(Sender.Index, 1);
				vecActions.push("MUTE");
				bMuted = true;

				return Options.Mute ? Options.Mute() : true;
			},

			Unmute: (Sender, vecReceivers) => {
				g_Assert.deepEqual(vecReceivers, [2]);
				g_Assert.equal(Sender.Index, 1);
				vecActions.push("UNMUTE");
				bMuted = false;

				return Options.Unmute ? Options.Unmute() : true;
			},
		};

		return { Overrides, Actions: vecActions, IsMuted: () => bMuted };
	}

	for (const bMuted of [false, true]) {
		VerifyRootDocumentationCase("temporary mute preserves pre-existing manager ownership", () => {
			const Fixture = CreateDocumentedMuteFixture({ Muted: bMuted });
			ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides);
			g_Assert.deepEqual(Fixture.Actions, bMuted ? [] : ["MUTE", "UNMUTE"]);
			g_Assert.equal(Fixture.IsMuted(), bMuted);
		});
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("temporary mute rejects non-true status after a partial mutation and cleans up", () => {
			const Fixture = CreateDocumentedMuteFixture({ Mute: () => InvalidStatus });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides), /could not mute/);
			g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
			g_Assert.equal(Fixture.IsMuted(), false);
		});

		VerifyRootDocumentationCase("temporary mute exposes non-true cleanup status", () => {
			const Fixture = CreateDocumentedMuteFixture({ Unmute: () => InvalidStatus });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides), /could not be removed/);
			g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
		});
	}

	for (const OperationFailure of [new Error("mute operation fault"), null]) {
		VerifyRootDocumentationCase("temporary mute preserves original thrown values after cleanup", () => {
			const Fixture = CreateDocumentedMuteFixture({
				Spectators: () => {
					throw OperationFailure;
				},
			});
			g_Assert.equal(CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides)), OperationFailure);
			g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
		});

		VerifyRootDocumentationCase("temporary mute preserves operation and cleanup failures in order", () => {
			const CleanupFailure = new Error("unmute fault");
			const Fixture = CreateDocumentedMuteFixture({
				Spectators: () => {
					throw OperationFailure;
				},

				Unmute: () => {
					throw CleanupFailure;
				},
			});
			const Failure = CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides));
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.deepEqual(Failure.errors, [OperationFailure, CleanupFailure]);
			g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
		});
	}

	for (const InvalidValue of [undefined, null, 1, "true"]) {
		VerifyRootDocumentationCase("temporary mute rejects non-boolean update readback and still removes the pair", () => {
			const Fixture = CreateDocumentedMuteFixture({ Read: (unRead, bMuted) => (unRead === 2) ? InvalidValue : bMuted });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides), /not applied/);
			g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
			g_Assert.equal(Fixture.IsMuted(), false);
		});

		VerifyRootDocumentationCase("temporary mute rejects non-boolean initial state without writes", () => {
			const Fixture = CreateDocumentedMuteFixture({ Read: () => InvalidValue });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides), /must return a boolean/);
			g_Assert.deepEqual(Fixture.Actions, []);
		});
	}

	VerifyRootDocumentationCase("temporary mute verifies the cleanup readback", () => {
		const Fixture = CreateDocumentedMuteFixture({ Read: (unRead, bMuted) => (unRead === 3) ? true : bMuted });
		g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Mute, Fixture.Overrides), /could not be removed/);
		g_Assert.deepEqual(Fixture.Actions, ["MUTE", "UNMUTE"]);
	});

	for (const strMode of ["JETPACK", "NOCLIP", "STUCK", "WALK"]) {
		VerifyRootDocumentationCase("movement selection uses documented uppercase modes and exact postconditions", () => {
			let strSelectedMode = "";
			const Overrides = {
				SetJetpack: () => {
					strSelectedMode = "JETPACK";

					return true;
				},

				SetNoClip: (PlayerReference, bEnabled) => {
					g_Assert.equal(PlayerReference.Index, 1);
					strSelectedMode = bEnabled ? "NOCLIP" : "WALK";

					return true;
				},

				SetStuck: () => {
					strSelectedMode = "STUCK";

					return true;
				},

				GetJetpack: () => strSelectedMode === "JETPACK",

				GetNoClip: () => strSelectedMode === "NOCLIP",

				GetStuck: () => strSelectedMode === "STUCK",
			};
			const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.Movement, Overrides);
			g_Assert.equal(RunDocumentationFunction(Documentation.SelectMovementMode, Documentation, [{ Index: 1 }, strMode], "SelectMovementMode"), true);
			g_Assert.equal(strSelectedMode, strMode);
			g_Assert.throws(() => RunDocumentationFunction(Documentation.SelectMovementMode, Documentation, [{ Index: 1 }, strMode.toLowerCase()], "SelectMovementMode"), RangeError);
		});
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("movement selection rejects non-true setters", () => {
			const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.Movement, { SetNoClip: () => InvalidStatus, GetNoClip: () => true });
			g_Assert.throws(() => RunDocumentationFunction(Documentation.SelectMovementMode, Documentation, [{ Index: 1 }, "NOCLIP"], "SelectMovementMode"), /not applied/);
		});
	}

	VerifyRootDocumentationCase("administrative actions preserve arguments and reject unknown action codes", () => {
		const vecCalls = [];
		const Overrides = {};
		for (const strOperation of ["Ban", "Kick", "Spawn", "Slay"]) {
			Overrides[strOperation] = (...vecArguments) => {
				vecCalls.push([strOperation, ...vecArguments]);

				return false;
			};
		}

		const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.AdministrativeActions, Overrides);
		const PlayerReference = { Index: 1 };
		for (const strAction of ["BAN30", "KICK", "RESPAWN", "SLAY"]) {
			g_Assert.equal(RunDocumentationFunction(Documentation.ApplyAdministrativeAction, Documentation, [PlayerReference, strAction], "ApplyAdministrativeAction"), false);
		}

		g_Assert.deepEqual(vecCalls, [
			["Ban", PlayerReference, 30, true, true],
			["Kick", PlayerReference, "Removed by an administrator"],
			["Spawn", PlayerReference, true],
			["Slay", PlayerReference],
		]);
		g_Assert.throws(() => RunDocumentationFunction(Documentation.ApplyAdministrativeAction, Documentation, [PlayerReference, "kick"], "ApplyAdministrativeAction"), RangeError);
	});

	for (const strOperation of ["ExecuteClientCommand", "Say", "SayTeam", "PlaySound", "FireGameEvent"]) {
		VerifyRootDocumentationCase("communication operations reject a truthy non-boolean result", () => {
			const Overrides = {
				GetAllPlayers: () => [{ IsConnected: () => true, IsFakeClient: () => false }],

				GetName: () => "Example",
			};
			for (const strMethod of ["ExecuteClientCommand", "Say", "SayTeam", "PlaySound", "FireGameEvent"]) {
				Overrides[strMethod] = () => (strMethod === strOperation) ? 1 : true;
			}

			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Communication, Overrides), /communication operations failed/);
		});
	}

	for (const strOperation of ["SetEyeLocation", "Push"]) {
		VerifyRootDocumentationCase("launch rejects a truthy non-boolean result", () => {
			const EyeLocation = { X: 1, Y: 2, Z: 3 };
			const Overrides = { GetEyeLocation: () => EyeLocation, SetEyeLocation: () => true, Push: () => true };
			Overrides[strOperation] = () => 1;
			const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.Launch, Overrides);
			g_Assert.throws(() => RunDocumentationFunction(Documentation.LaunchPlayer, Documentation, [{ Index: 1 }], "LaunchPlayer"), /could not be launched/);
		});
	}

	for (const strOperation of ["SetViewCoordinates", "SetViewEntity", "SetViewPlayer"]) {
		VerifyRootDocumentationCase("aim rejects a truthy non-boolean result", () => {
			const Overrides = { GetViewCoordinates: () => ({ X: 1, Y: 2, Z: 3 }), SetViewCoordinates: () => true, SetViewEntity: () => true, SetViewPlayer: () => true };
			Overrides[strOperation] = () => 1;
			const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.Aim, Overrides);
			g_Assert.throws(() => RunDocumentationFunction(Documentation.AimPlayer, Documentation, [{ Index: 1 }, { Index: 2 }], "AimPlayer"), /could not aim/);
		});
	}

	function CreateViewDocumentationOverrides() {
		return {
			GetAllPlayers: () => [],

			GetTraceRay: () => ({ Fraction: 0.5 }),

			GetViewCoordinates: () => null,

			GetViewEntity: () => null,

			GetViewPlayer: () => null,

			GetViewVector: () => ({ X: 1, Y: 0, Z: 0 }),
		};
	}

	VerifyRootDocumentationCase("view helper preserves null miss/world targets", () => {
		const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.View, CreateViewDocumentationOverrides());
		g_Assert.deepEqual(RunDocumentationFunction(Documentation.ReadViewTarget, Documentation, [{ Index: 1 }], "ReadViewTarget"), { Coordinates: null, EntityIndex: null, Forward: { X: 1, Y: 0, Z: 0 }, Fraction: 0.5, PlayerIndex: null });
	});

	for (const strOperation of ["GetTraceRay", "GetViewCoordinates", "GetViewEntity", "GetViewPlayer", "GetViewVector"]) {
		for (const InvalidValue of [undefined, 1, [], {}]) {
			VerifyRootDocumentationCase("view helper rejects malformed result records", () => {
				const Overrides = CreateViewDocumentationOverrides();
				Overrides[strOperation] = () => InvalidValue;
				const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.View, Overrides);
				g_Assert.throws(() => RunDocumentationFunction(Documentation.ReadViewTarget, Documentation, [{ Index: 1 }], "ReadViewTarget"), /invalid|not finite/);
			});
		}
	}

	VerifyRootDocumentationCase("view helper retains finite components and positive target indices", () => {
		const Overrides = CreateViewDocumentationOverrides();
		Overrides.GetViewCoordinates = () => ({ X: 4, Y: 5, Z: 6 });

		Overrides.GetViewEntity = () => ({ Index: 2 });

		Overrides.GetViewPlayer = () => ({ Index: 2 });
		const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.View, Overrides);
		g_Assert.deepEqual(RunDocumentationFunction(Documentation.ReadViewTarget, Documentation, [{ Index: 1 }], "ReadViewTarget"), { Coordinates: { X: 4, Y: 5, Z: 6 }, EntityIndex: 2, Forward: { X: 1, Y: 0, Z: 0 }, Fraction: 0.5, PlayerIndex: 2 });
	});

	function WithTemporaryFixtureMethods(Owner, Replacements, Callback) {
		const mapDescriptors = new Map(Object.keys(Replacements).map((strName) => [strName, Object.getOwnPropertyDescriptor(Owner, strName)]));
		let bFailed = false;
		let Failure = null;
		let Result = undefined;

		try {
			for (const [strName, Replacement] of Object.entries(Replacements)) {
				Object.defineProperty(Owner, strName, { configurable: true, enumerable: mapDescriptors.get(strName)?.enumerable ?? true, writable: true, value: Replacement });
			}

			// Only synchronous fixture callbacks are supported.
			Result = Callback();
		} catch (ErrorValue) {
			bFailed = true;
			Failure = ErrorValue;
		}

		const vecCleanupErrors = [];
		for (const [strName, Descriptor] of mapDescriptors) {
			try {
				RestorePlayersProperty(Owner, strName, Descriptor);
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}

		if (vecCleanupErrors.length > 0) {
			if (bFailed) {
				vecCleanupErrors.unshift(Failure);
			}

			throw new AggregateError(vecCleanupErrors, "Players fixture temporary-method restoration failed.");
		}

		if (bFailed) {
			throw Failure;
		}

		return Result;
	}

	VerifyRootDocumentationCase("player weapon queries use the current manager property contracts", () => {
		WithTemporaryFixtureMethods(g_PlayersRuntime, {
			GetWeaponIndices(PlayerReference, strPropertyName) {
				g_Assert.equal(PlayerReference.Index, 1);
				g_Assert.equal(strPropertyName, g_WeaponManager.MyWeaponsProperty);

				return [];
			},

			GetProjectileIndices(PlayerReference, strClassName) {
				g_Assert.equal(PlayerReference.Index, 1);
				g_Assert.equal(strClassName, "grenade_projectile");

				return [501];
			},

			GetProjectileAmmo(PlayerReference, strPropertyName) {
				g_Assert.equal(PlayerReference.Index, 1);
				g_Assert.equal(strPropertyName, g_WeaponManager.AmmoProperty + "003");

				return 71;
			},
		}, () => {
			g_Assert.deepEqual(g_Players.GetWeaponIndexes(g_Players.Player(1)), []);
			g_Assert.deepEqual(g_Players.GetProjectileIndexes(g_Players.Player(1), "grenade_projectile"), [501]);
			g_Assert.equal(g_Players.GetProjectileAmmo(g_Players.Player(1), "grenade_projectile"), 71);
		});
	});

	function CreateNetworkDocumentationOverrides(Options = {}) {
		return {
			GetAllPlayers: () => [{ IsConnected: () => true, IsFakeClient: () => false }],

			GetNetInfo: () => Object.hasOwn(Options, "Channel") ? Options.Channel : { GetNetChannelLatency: () => 0.01 },

			GetClientCVarValue: () => Object.hasOwn(Options, "Language") ? Options.Language : "en",

			SendConVarValue: Options.Send ?? (() => true),
		};
	}

	for (const InvalidValue of [undefined, null, 1, []]) {
		VerifyRootDocumentationCase("client networking validates reads before sending a ConVar update", () => {
			let unSends = 0;
			const Overrides = CreateNetworkDocumentationOverrides({
				Language: InvalidValue,

				Send: () => {
					++unSends;

					return true;
				},
			});
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Networking, Overrides), /could not be read/);
			g_Assert.equal(unSends, 0);
		});
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("client networking requires an exact send-success result", () => {
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Networking, CreateNetworkDocumentationOverrides({ Send: () => InvalidStatus })), /could not be sent/);
		});
	}

	function CreateWeaponDocumentationFixture(Options = {}) {
		const OriginalWeapon = { Index: 101 };
		const SelectedWeapon = { Index: 102 };
		let ActiveWeapon = OriginalWeapon;
		let unWrites = 0;
		const Overrides = {
			GetAllPlayers: () => [{ Index: 1 }],

			GetActiveWeapon: () => ActiveWeapon,

			GetWeapons: () => [SelectedWeapon],

			GetWeaponIndexes: () => [SelectedWeapon.Index],

			GetWeapon: () => SelectedWeapon,

			GetPrimaryWeapon: () => SelectedWeapon,

			GetSecondaryWeapon: () => null,

			SetActiveWeapon: (PlayerReference, WeaponReference) => {
				g_Assert.equal(PlayerReference.Index, 1);
				++unWrites;
				ActiveWeapon = WeaponReference;

				return Options.Write ? Options.Write(unWrites, WeaponReference) : true;
			},
		};

		return { Overrides, OriginalWeapon, GetActiveWeapon: () => ActiveWeapon, GetWriteCount: () => unWrites };
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("active weapon selection restores after a non-true status", () => {
			const Fixture = CreateWeaponDocumentationFixture({ Write: (unWrite) => (unWrite === 1) ? InvalidStatus : true });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Weapons, Fixture.Overrides), /could not become active/);
			g_Assert.equal(Fixture.GetActiveWeapon(), Fixture.OriginalWeapon);
			g_Assert.equal(Fixture.GetWriteCount(), 2);
		});

		VerifyRootDocumentationCase("active weapon restoration rejects a non-true status", () => {
			const Fixture = CreateWeaponDocumentationFixture({ Write: (unWrite) => (unWrite === 2) ? InvalidStatus : true });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Weapons, Fixture.Overrides), /could not be restored/);
			g_Assert.equal(Fixture.GetWriteCount(), 2);
		});
	}

	for (const OperationFailure of [new Error("weapon selection fault"), null]) {
		VerifyRootDocumentationCase("active weapon selection preserves original thrown values after cleanup", () => {
			const Fixture = CreateWeaponDocumentationFixture({
				Write: (unWrite) => {
					if (unWrite === 1) {
						throw OperationFailure;
					}

					return true;
				},
			});
			g_Assert.equal(CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Weapons, Fixture.Overrides)), OperationFailure);
			g_Assert.equal(Fixture.GetActiveWeapon(), Fixture.OriginalWeapon);
		});

		VerifyRootDocumentationCase("active weapon selection preserves both failures in order", () => {
			const CleanupFailure = new Error("weapon restoration fault");
			const Fixture = CreateWeaponDocumentationFixture({
				Write: (unWrite) => {
					throw (unWrite === 1) ? OperationFailure : CleanupFailure;
				},
			});
			const Failure = CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Weapons, Fixture.Overrides));
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.deepEqual(Failure.errors, [OperationFailure, CleanupFailure]);
		});
	}

	function CreateRestrictionDocumentationFixture(Options = {}) {
		const FirstWeapon = { Index: 101 };
		const SecondWeapon = { Index: 102 };
		const setRestricted = new Set(Options.PreviouslyRestricted ? [SecondWeapon] : []);
		const vecRemovedWeapons = [];
		const Overrides = {
			GetAllPlayers: () => [{ Index: 1 }],

			GetWeapons: () => [FirstWeapon, SecondWeapon],

			IsWeaponRestricted: (PlayerReference, WeaponReference) => {
				g_Assert.equal(PlayerReference.Index, 1);

				return setRestricted.has(WeaponReference);
			},

			RestrictWeapons: (PlayerReference, ...vecWeapons) => {
				g_Assert.equal(PlayerReference.Index, 1);

				for (const WeaponReference of vecWeapons) {
					setRestricted.add(WeaponReference);
				}

				return Options.Restrict ? Options.Restrict() : true;
			},

			UnrestrictWeapons: (PlayerReference, WeaponReference) => {
				g_Assert.equal(PlayerReference.Index, 1);
				vecRemovedWeapons.push(WeaponReference);
				setRestricted.delete(WeaponReference);

				return Options.Remove ? Options.Remove(WeaponReference, FirstWeapon) : true;
			},
		};

		return { Overrides, FirstWeapon, SecondWeapon, Restricted: setRestricted, RemovedWeapons: vecRemovedWeapons };
	}

	VerifyRootDocumentationCase("temporary restrictions do not remove pre-existing ownership", () => {
		const Fixture = CreateRestrictionDocumentationFixture({ PreviouslyRestricted: true });
		ExecuteRootDocumentation(g_DocumentationBlockIndexes.Restrictions, Fixture.Overrides);
		g_Assert.deepEqual(Fixture.RemovedWeapons, [Fixture.FirstWeapon]);
		g_Assert.deepEqual([...Fixture.Restricted], [Fixture.SecondWeapon]);
	});

	for (const OperationFailure of [new Error("restriction update fault"), null]) {
		VerifyRootDocumentationCase("temporary restrictions restore every weapon after a partial update throws", () => {
			const Fixture = CreateRestrictionDocumentationFixture({
				Restrict: () => {
					throw OperationFailure;
				},
			});
			g_Assert.equal(CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Restrictions, Fixture.Overrides)), OperationFailure);
			g_Assert.deepEqual(Fixture.RemovedWeapons, [Fixture.FirstWeapon, Fixture.SecondWeapon]);
			g_Assert.equal(Fixture.Restricted.size, 0);
		});

		VerifyRootDocumentationCase("temporary restrictions preserve the original error and still attempt every cleanup", () => {
			const CleanupFailure = new Error("restriction cleanup fault");
			const Fixture = CreateRestrictionDocumentationFixture({
				Restrict: () => {
					throw OperationFailure;
				},

				Remove: (WeaponReference, FirstWeapon) => {
					if (WeaponReference === FirstWeapon) {
						throw CleanupFailure;
					}

					return true;
				},
			});
			const Failure = CaptureRootDocumentationFailure(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Restrictions, Fixture.Overrides));
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.deepEqual(Failure.errors, [OperationFailure, CleanupFailure]);
			g_Assert.deepEqual(Fixture.RemovedWeapons, [Fixture.FirstWeapon, Fixture.SecondWeapon]);
		});
	}

	for (const InvalidStatus of [undefined, null, false, 1, "true"]) {
		VerifyRootDocumentationCase("temporary restriction cleanup rejects non-true results and continues", () => {
			const Fixture = CreateRestrictionDocumentationFixture({ Remove: (WeaponReference, FirstWeapon) => (WeaponReference === FirstWeapon) ? InvalidStatus : true });
			g_Assert.throws(() => ExecuteRootDocumentation(g_DocumentationBlockIndexes.Restrictions, Fixture.Overrides), /could not be restored/);
			g_Assert.deepEqual(Fixture.RemovedWeapons, [Fixture.FirstWeapon, Fixture.SecondWeapon]);
		});
	}

	VerifyRootDocumentationCase("drop helper preserves its nullable lookup sentinel without dispatch", () => {
		let unDispatches = 0;
		const Documentation = ExecuteRootDocumentation(g_DocumentationBlockIndexes.DropWeapon, {
			GetActiveWeapon: () => null,

			GetViewCoordinates: () => null,

			DropWeapon: () => {
				++unDispatches;

				return true;
			},
		});
		g_Assert.equal(RunDocumentationFunction(Documentation.DropActiveWeapon, Documentation, [{ Index: 1 }], "DropActiveWeapon"), false);
		g_Assert.equal(unDispatches, 0);
	});

	for (const MissingMapping of [null, {}, { AmmoProperty: null }, { AmmoProperty: "" }]) {
		VerifyRootDocumentationCase("projectile example skips weapon records without an ammo mapping", () => {
			let unAmmoReads = 0;
			WithTemporaryFixtureMethods(g_WeaponManager, { Get: () => MissingMapping }, () => {
				ExecuteRootDocumentation(g_DocumentationBlockIndexes.Projectiles, {
					GetAllPlayers: () => [{ Index: 1 }],

					GetProjectileAmmo: () => {
						++unAmmoReads;

						return 71;
					},
				});
				g_Assert.equal(unAmmoReads, 0);
			});
		});
	}

	function VerifyWorldPlayerExample(Players) {
		const unScriptTimeoutMilliseconds = 1000;
		const unMaximumBanDurationMinutes = 2147483647;

		const strExamplePath = g_Path.join(g_strProjectRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
		const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
		const vecMatch = strExample.match(/\tLogResult\("players\/entity.Player",[\s\S]*?\r?\n\t}\);/);
		g_Assert.ok(vecMatch, "world player inspection callback must remain available");

		const vecSnapshots = Players.GetAllPlayers().map((Player) => ({ Connected: Player.IsConnected(), Index: Player.Index }));
		g_Assert.ok(vecSnapshots.some((Player) => Player.Connected), "world player profile must contain a connected client");

		for (const vecPlayers of [[], vecSnapshots]) {
			let Result = undefined;
			g_VM.runInNewContext(vecMatch[0], {
				Player: Players.Player,

				GetAllPlayers: () => vecPlayers,

				GetClientCVarValue: Players.GetClientCVarValue,

				GetPlayerInformationFromUserID: (unUserID) => g_PlayersRuntime.GetPlayerFromUserID(unUserID),

				LogResult: (strLabel, Callback) => {
					g_Assert.equal(strLabel, "players/entity.Player");
					Result = Callback();
				},
			}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

			if (vecPlayers.length === 0) {
				g_Assert.equal(Result.Connected, false);
				continue;
			}

			const FirstPlayer = vecPlayers.find((Player) => Player.Connected);
			g_Assert.equal(Result.Index, FirstPlayer.Index);
			g_Assert.equal(Result.IndexFromUserID, FirstPlayer.Index);
			g_Assert.equal(Result.Connected, true);
			g_Assert.equal(Result.ClientRate, "30000");
			g_Assert.equal(Array.isArray(Result.Spectators) && Array.isArray(Result.Weapons), true);
			g_Assert.equal(Array.isArray(Result.EyeLocation) && Array.isArray(Result.ViewVector), true);
		}

		const vecFunctionSources = ["IsInt32", "ParseIndex", "RunPlayerAction"].map((strName) => {
			const nStart = strExample.indexOf(`\nfunction ${strName}(`);
			const nEnd = strExample.indexOf("\nfunction ", nStart + 1);
			g_Assert.ok((nStart >= 0) && (nEnd > nStart), `world action ${strName} must remain available`);

			return strExample.slice(nStart, nEnd);
		});

		const unPlayerIndex = vecSnapshots.find((Player) => Player.Connected).Index;
		const unOriginalActionCount = g_vecActionCalls.length;

		try {
			for (const strDuration of ["0", String(unMaximumBanDurationMinutes), "-1", "2147483648", "1.5", "x"]) {
				g_VM.runInNewContext(`${vecFunctionSources.join("\n")}\nRunPlayerAction(["player", String(unPlayerIndex), "ban", strDuration, "confirm"]);`, {
					Player: Players.Player,
					g_strCommandName: "sjs_api_world",
					unPlayerIndex,
					strDuration,

					LogWarning: () => undefined,
				}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
			}

			g_Assert.deepEqual(g_vecActionCalls.slice(unOriginalActionCount), [["Ban", unPlayerIndex, 0, true, false], ["Ban", unPlayerIndex, unMaximumBanDurationMinutes, true, false]]);
		} finally {
			g_vecActionCalls.length = unOriginalActionCount;
		}
	}

	VerifyWorldPlayerExample(g_Players);

	console.log(`[  OK  ] players root documentation cases=${g_unRootDocumentationScenarioCount}; SDK doubles and isolated fault fixtures`);

} catch (ErrorValue) {
	g_bExecutionFailed = true;
	g_ExecutionErrorValue = ErrorValue;
} finally {
	const vecCleanupErrors = [];

	try {
		if (g_bPackageCacheMutated) {
			RestorePackageCacheDescriptors(g_mapOriginalPackageCacheDescriptors);
		}
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	try {
		RestorePlayersProperty(g_Module, "_load", g_OriginalModuleLoadDescriptor);
	} catch (ErrorValue) {
		vecCleanupErrors.push(ErrorValue);
	}

	if (vecCleanupErrors.length > 0) {
		if (g_bExecutionFailed) {
			vecCleanupErrors.unshift(g_ExecutionErrorValue);
		}

		throw new AggregateError(vecCleanupErrors, "Players smoke execution and temporary-state restoration failed.");
	}
}

if (g_bExecutionFailed) {
	throw g_ExecutionErrorValue;
}

console.log("[smoke_players] ok");
