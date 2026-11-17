#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strProjectRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strProjectRootPath, "packages", "sourcejs");
const g_strPlayersBasePath = g_Path.join(g_strPackageRootPath, "players", "index.js");

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");

function IsPackageCachePath(strFilePath) {
	const strRelativePath = g_Path.relative(g_strPackageRootPath, strFilePath);

	return (strRelativePath === "") || ((strRelativePath !== "..") && !strRelativePath.startsWith(`..${g_Path.sep}`) && !g_Path.isAbsolute(strRelativePath));
}

function RestorePlayersBaseProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Players-base fixture could not delete temporary property ${strName}.`);
		}

		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

function CapturePackageCacheDescriptors() {
	const mapDescriptors = new Map();
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strFilePath)) {
			const Descriptor = Object.getOwnPropertyDescriptor(require.cache, strFilePath);
			if (!Descriptor.configurable) {
				throw new Error(`Players-base fixture cannot replace non-configurable package cache entry ${strFilePath}.`);
			}

			mapDescriptors.set(strFilePath, Descriptor);
		}
	}

	return mapDescriptors;
}

function RestorePackageCacheDescriptors(mapDescriptors) {
	const vecCleanupErrors = [];
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strFilePath)) {
			try {
				RestorePlayersBaseProperty(require.cache, strFilePath, undefined);
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}
	}

	for (const [strFilePath, Descriptor] of mapDescriptors) {
		try {
			RestorePlayersBaseProperty(require.cache, strFilePath, Descriptor);
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	if (vecCleanupErrors.length > 0) {
		throw new AggregateError(vecCleanupErrors, "Players-base fixture package-cache restoration failed.");
	}
}

function GetPackagePath(strName) {
	if ((strName === "entities") || (strName === "players") || (strName === "weapons")) {
		return g_Path.join(g_strPackageRootPath, strName, "index.js");
	}

	return g_Path.join(g_strPackageRootPath, `${strName}.js`);
}

function InstallDependency(strName, ModuleExports) {
	const strFilePath = GetPackagePath(strName);
	delete require.cache[strFilePath];
	require.cache[strFilePath] = { children: [], exports: ModuleExports, filename: strFilePath, id: strFilePath, loaded: true, paths: [] };
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
}

class QAngle extends Vector {
}

class BitBufferWrite {
}

class Sound {
}

class StreamSound {
}

class EntityTraceFilter {
}

class SteamID {
}

class WeaponClassIterator {
	constructor(RequiredFilters, ExcludedFilters) {
		this.ExcludedFilters = ExcludedFilters;
		this.RequiredFilters = RequiredFilters;
	}

	ToArray() {
		return [{ ClassName: "weapon_rifle" }];
	}
}

const g_vecNativeCalls = [];
const g_mapNativePlayers = new Map([
	[2, {
		Index: 2,
		TeamNumber: 2,
		UserID: 20,

		Ban() {
			return true;
		},

		ChangeTeam() {
			return true;
		},

		ExecuteClientCommand() {
			return true;
		},

		Kick() {
			return true;
		},

		Say() {
			return true;
		},

		SayTeam() {
			return true;
		},

		SetName() {
			return true;
		},

		Slay() {
			return true;
		},
	}],
]);

const g_PlayersRuntime = {
	GetPlayerFromUserID(unUserID) {
		g_vecNativeCalls.push(["FromUserID", unUserID]);

		return g_mapNativePlayers.get(2);
	},

	GetProjectileAmmo(Player, strPropertyName) {
		g_vecNativeCalls.push(["GetProjectileAmmo", Player, strPropertyName]);

		return 7;
	},

	GetPlayer(unIndex) {
		g_vecNativeCalls.push(["GetPlayer", unIndex]);

		return g_mapNativePlayers.get(unIndex);
	},

	GetProjectileIndices(Player, strClassName) {
		g_vecNativeCalls.push(["GetProjectileIndices", Player, strClassName]);

		return [91];
	},

	SetProjectileAmmo(Player, strPropertyName, nAmmoValue) {
		g_vecNativeCalls.push(["SetProjectileAmmo", Player, strPropertyName, nAmmoValue]);

		return true;
	},

	GetWeaponIndices(Player, strPropertyName) {
		g_vecNativeCalls.push(["GetWeaponIndices", Player, strPropertyName]);

		return [10, 11];
	},
};

const g_HelperRuntime = {
	GetPlayerIndex(PlayerOrIndex) {
		return (typeof PlayerOrIndex === "number") ? PlayerOrIndex : PlayerOrIndex.Index;
	},
};

// Native send-property names and entity class names remain exact.
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

const g_vecRestrictionCalls = [];

const g_WeaponRestrictions = {
	CanUse(Player, Weapon) {
		g_vecRestrictionCalls.push(["CanUse", Player, Weapon]);

		return Weapon !== "blocked";
	},

	RestrictPlayer(Player, Weapon) {
		g_vecRestrictionCalls.push(["RestrictPlayer", Player, Weapon]);

		return true;
	},

	UnrestrictPlayer(Player, Weapon) {
		g_vecRestrictionCalls.push(["UnrestrictPlayer", Player, Weapon]);

		return true;
	},
};

const g_EventsRuntime = {
	FireEvent() {
		return true;
	},
};

function LoadPlayersBaseModule() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		configurable: true,
		enumerable: g_ModuleLoadDescriptor?.enumerable ?? true,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			const strModulePath = GetPackagePath(strRequestName);
			if (Object.hasOwn(require.cache, strModulePath)) {
				return require.cache[strModulePath].exports;
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},

		writable: true,
	});

	const PlayersAPI = require(g_strPlayersBasePath);

	RestorePlayersBaseProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return PlayersAPI;
}

const g_mapPackageCacheDescriptors = CapturePackageCacheDescriptors();
let g_bExecutionFailed = false;
let g_Failure = null;

try {
	InstallDependency("internal/runtime", {
		GetModule(strModuleName) {
			if (strModuleName === "players") {
				return g_PlayersRuntime;
			}

			if (strModuleName === "players/helpers") {
				return g_HelperRuntime;
			}

			if (strModuleName === "events") {
				return g_EventsRuntime;
			}

			throw new Error(`unexpected native module ${strModuleName}`);
		},
	});

	InstallDependency("bitbuffers", { BitBufferWrite });
	InstallDependency("auth/manager", { AUTH_MANAGER: {} });
	InstallDependency("engines/sound", { SOUND_FROM_WORLD: 0, Sound, StreamSound });

	InstallDependency("engines/server", {
		GetClientCVarValue() {
			return "";
		},
	});

	InstallDependency("engines/trace", {});

	InstallDependency("entities", {
		Entity(unIndex) {
			return { Index: unIndex };
		},

		DecorateEntity(EntityValue) {
			return EntityValue;
		},
	});

	InstallDependency("entities/collisions", {});
	InstallDependency("entities/constants", { FL_FROZEN: 0x20 });
	InstallDependency("entities/helpers", {});
	InstallDependency("filters/entities", { EntityTraceFilter });
	InstallDependency("filters/weapons", { WeaponClassIterator });
	InstallDependency("netchannel", {});
	InstallDependency("steam", { SteamID });

	InstallDependency("weapons", {
		Weapon(unIndex) {
			return { ClassName: (unIndex === 10) ? "weapon_rifle" : "weapon_pistol", Index: unIndex, WeaponName: (unIndex === 10) ? "weapon_rifle" : "weapon_pistol" };
		},
	});

	InstallDependency("mathlib", { QAngle, Vector });

	InstallDependency("players/dropweapon", {
		DropWeapon() {
			return true;
		},
	});

	InstallDependency("players/teams", {});
	InstallDependency("players/voice", { MUTE_MANAGER: {} });
	InstallDependency("weapons/manager", { WEAPON_MANAGER: g_WeaponManager });
	InstallDependency("weapons/restrictions", g_WeaponRestrictions);

	delete require.cache[g_strPlayersBasePath];

	const g_PlayersAPI = LoadPlayersBaseModule();
	const g_Player = g_mapNativePlayers.get(2);

	g_Assert.ok(g_PlayersAPI.Player(2) === g_Player, "Player must return and decorate the native player object.");
	g_Assert.ok(g_PlayersAPI.FromUserID(20) === g_Player, "FromUserID must call the canonical native method.");
	g_Assert.equal(g_PlayersAPI.GetWeaponIndexes(g_Player).join(","), "10,11", "owned weapon indices");
	g_Assert.equal(g_vecNativeCalls.find((vecCall) => vecCall[0] === "GetWeaponIndices")[2], "m_hMyWeapons.", "live my-weapons property");
	g_Assert.equal(g_PlayersAPI.GetWeaponIndexes(g_Player, "rifle").join(","), "10", "weapon class filtering");
	g_Assert.equal(g_PlayersAPI.GetWeaponIndexes(g_Player, null, "primary").join(","), "10", "weapon filter iterator integration");
	g_Assert.equal(g_PlayersAPI.GetProjectileAmmo(g_Player, "grenade_projectile"), 7, "projectile ammo read");
	g_Assert.ok(g_PlayersAPI.SetProjectileAmmo(g_Player, "grenade_projectile", 8), "projectile ammo write");
	g_Assert.equal(g_vecNativeCalls.find((vecCall) => vecCall[0] === "GetProjectileAmmo")[2], "m_iAmmo.003", "projectile ammo property");
	g_Assert.equal(g_PlayersAPI.GetProjectileIndexes(g_Player, "grenade_projectile")[0], 91, "projectile native lookup");

	g_Assert.ok(g_PlayersAPI.RestrictWeapons(g_Player, "rifle", ["pistol"]), "player weapon restriction");
	g_Assert.ok(g_PlayersAPI.UnrestrictWeapons(g_Player, "rifle"), "player weapon unrestriction");
	g_Assert.ok(g_PlayersAPI.IsWeaponRestricted(g_Player, "blocked"), "restricted weapon query");
	g_Assert.ok(!g_PlayersAPI.IsWeaponRestricted(g_Player, "rifle"), "allowed weapon query");
	g_Assert.ok(g_vecRestrictionCalls.some((vecCall) => (vecCall[0] === "RestrictPlayer") && (vecCall[2] === "pistol")), "RestrictWeapons must use RestrictPlayer.");
	g_Assert.ok(g_vecRestrictionCalls.some((vecCall) => vecCall[0] === "UnrestrictPlayer"), "UnrestrictWeapons must use UnrestrictPlayer.");

	const g_DecoratedPlayer = g_PlayersAPI.DecoratePlayer({
		Index: 3,

		Ban() {
			return true;
		},

		ChangeTeam() {
			return true;
		},

		ExecuteClientCommand() {
			return true;
		},

		Kick() {
			return true;
		},

		Say() {
			return true;
		},

		SayTeam() {
			return true;
		},

		SetName() {
			return true;
		},

		Slay() {
			return true;
		},
	});
	g_Assert.equal(typeof g_DecoratedPlayer.RestrictWeapons, "function", "decorated RestrictWeapons");
	g_Assert.equal(typeof g_DecoratedPlayer.UnrestrictWeapons, "function", "decorated UnrestrictWeapons");
	g_Assert.equal(typeof g_DecoratedPlayer.IsWeaponRestricted, "function", "decorated IsWeaponRestricted");
	g_Assert.throws(() => g_PlayersAPI.DecoratePlayer({ Index: 4 }), /native Ban\(\) method/, "DecoratePlayer must reject snapshot-only objects.");

	// Negative assertions intentionally retain obsolete public spellings.
	g_Assert.ok(!Object.hasOwn(g_PlayersAPI, "moduleName"), "Players API must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_PlayersAPI, "fromUserId"), "Players API must preserve the ID acronym.");
	g_Assert.ok(!Object.hasOwn(g_PlayersAPI, "getRawSteamId"), "Players API must preserve the SteamID acronym.");
	g_Assert.ok(!Object.hasOwn(g_PlayersAPI, "isHltv"), "Players API must preserve the HLTV acronym.");
} catch (ErrorValue) {
	g_bExecutionFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecCleanupErrors = [];
	for (const Restore of [
		() => RestorePlayersBaseProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestorePackageCacheDescriptors(g_mapPackageCacheDescriptors),
	]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	if (vecCleanupErrors.length > 0) {
		if (g_bExecutionFailed) {
			vecCleanupErrors.unshift(g_Failure);
		}

		throw new AggregateError(vecCleanupErrors, "Players-base fixture restoration failed.");
	}
}

if (g_bExecutionFailed) {
	throw g_Failure;
}

console.log("[smoke_players_base] ok");
