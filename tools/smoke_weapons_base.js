#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_strEntitiesBasePath = g_Path.join(g_strPackageRootPath, "entities", "index.js");
const g_vecExpectedExports = [
	"AMMO_PROPERTY_PREFIX",
	"CLIP_PROPERTY",
	"OWNER_PROPERTY",
	"PRIMARY_AMMO_TYPE_PROPERTY",
	"SECONDARY_AMMO_TYPE_PROPERTY",
	"SECONDARY_CLIP_PROPERTY",
	"GetClassName",
	"GetClasses",
	"GetCount",
	"DecorateWeapon",
	"Drop",
	"GetAllWeapons",
	"GetAmmo",
	"GetClip",
	"GetCurrentWeapon",
	"GetOwner",
	"GetPrimaryAmmoType",
	"GetProperty",
	"GetPropertyEntity",
	"GetPropertyFloat",
	"GetPropertyInteger",
	"GetPropertyString",
	"GetPropertyStringArray",
	"GetSecondaryAmmo",
	"GetSecondaryAmmoType",
	"GetSecondaryClip",
	"GetWeaponName",
	"GetWeaponsByClassName",
	"GetWeaponsByName",
	"GetName",
	"GetNames",
	"Remove",
	"SetAmmo",
	"SetClip",
	"SetProperty",
	"SetPropertyEntity",
	"SetPropertyFloat",
	"SetPropertyInteger",
	"SetPropertyString",
	"SetPropertyStringArray",
	"SetSecondaryAmmo",
	"SetSecondaryClip",
	"Weapon",
];

const g_vecNativeCallLog = [];

// Preserve native SDK property selector strings in the fixture maps.
const g_mapIntegerPropertyValues = new Map([
	["2:m_iAmmo.002", 60],
	["11:m_iClip1", 30],
	["11:m_iClip2", 7],
	["11:m_iPrimaryAmmoType", 1],
	["11:m_iSecondaryAmmoType", 2],
]);
const g_mapWeaponOwners = new Map([[11, { Index: 2, Valid: true }], [12, null]]);

function InstallDependency(strDependencyPath, ModuleExports) {
	require.cache[strDependencyPath] = {
		children: [],
		exports: ModuleExports,
		filename: strDependencyPath,
		id: strDependencyPath,
		loaded: true,
		paths: [],
	};
}

function CreateWeapon(unIndex) {
	return { Free: false, IsWeapon: true, Valid: true, ClassName: "weapon_smg", Name: "smg", Index: unIndex };
}

function GetPropertyKey(Entity, strProperty) {
	const unIndex = (typeof Entity === "object") ? Entity.Index : Entity;

	return `${unIndex}:${strProperty}`;
}

function FindNativeCall(strCallName) {
	for (const vecNativeCall of g_vecNativeCallLog) {
		if (vecNativeCall[0] === strCallName) {
			return vecNativeCall;
		}
	}

	return null;
}

const g_NativeWeapons = {
	GetAmmo(unWeaponIndex) {
		g_vecNativeCallLog.push(["GetAmmo", unWeaponIndex]);

		return 90;
	},

	GetPropertyEntity(unWeaponIndex, strProperty) {
		g_vecNativeCallLog.push(["GetPropertyEntity", unWeaponIndex, strProperty]);

		const Owner = g_mapWeaponOwners.get(unWeaponIndex);
		if (Owner === undefined) {
			return null;
		}

		return Owner;
	},

	GetPropertyInteger(Entity, strProperty) {
		g_vecNativeCallLog.push(["GetPropertyInteger", Entity, strProperty]);

		const nPropertyValue = g_mapIntegerPropertyValues.get(GetPropertyKey(Entity, strProperty));
		if (nPropertyValue === undefined) {
			return -1;
		}

		return nPropertyValue;
	},

	GetName(unWeaponIndex) {
		g_vecNativeCallLog.push(["GetName", unWeaponIndex]);

		return "smg";
	},

	Remove(unWeaponIndex) {
		g_vecNativeCallLog.push(["Remove", unWeaponIndex]);

		return true;
	},

	SetAmmo(unWeaponIndex, nAmmo) {
		g_vecNativeCallLog.push(["SetAmmo", unWeaponIndex, nAmmo]);

		return true;
	},

	SetPropertyInteger(Entity, strProperty, nPropertyValue) {
		g_vecNativeCallLog.push(["SetPropertyInteger", Entity, strProperty, nPropertyValue]);
		g_mapIntegerPropertyValues.set(GetPropertyKey(Entity, strProperty), nPropertyValue);

		return true;
	},

	GetWeapon(unIndex) {
		g_vecNativeCallLog.push(["GetWeapon", unIndex]);

		return CreateWeapon(unIndex);
	},
};

const g_PlayerDropWeaponAPI = {
	DropWeapon(Owner, Weapon, Target, Velocity) {
		g_vecNativeCallLog.push(["DropWeapon", Owner, Weapon, Target, Velocity]);

		return true;
	},
};

function LoadTestAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const ResolverDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_resolveFilename");
	const OriginalResolveFilename = ResolverDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/base runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/base package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/base runtime fixture must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons/base resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/base cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/base fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bResolverOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		InstallDependency(g_strEntitiesBasePath, {
			DecorateEntity(Entity) {
				if (Entity) {
					Entity.Decorated = true;
				}

				return Entity;
			},
		});

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/dropweapon": g_PlayerDropWeaponAPI, weapons: g_NativeWeapons } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "entities") {
					return g_strEntitiesBasePath;
				}

				if (strRequest === "internal/runtime") {
					return g_strInternalRuntimePath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		Result = require(g_strBasePath);
	} catch (ExceptionValue) {
		Failure = ExceptionValue;
		bFailed = true;
	} finally {
		const vecFailures = [];
		const AttemptRestoration = Restore => {
			try {
				Restore();
			} catch (ExceptionValue) {
				vecFailures.push(ExceptionValue);
			}
		};

		if (bResolverOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_resolveFilename", ResolverDescriptor));
		}

		if (bCacheOwned) {
			for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
				if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
					AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
				}
			}

			for (const [strModulePath, Descriptor] of mapCachedModules) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
			}
		}

		if (bSourceJSOwned) {
			AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor));
		}

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Weapons/base fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function VerifyNativeAmmoFailure(LiveWeapon) {
	const OriginalGetAmmo = g_NativeWeapons.GetAmmo;

	try {
		g_NativeWeapons.GetAmmo = function ThrowNativeAmmoFailure() {
			throw new Error("native ammo failure");
		};

		g_Assert.throws(() => LiveWeapon.GetAmmo(), /native ammo failure/, "GetAmmo must expose native failures");
	} finally {
		g_NativeWeapons.GetAmmo = OriginalGetAmmo;
	}
}

const g_WeaponsBaseAPI = LoadTestAPI();
const g_LiveWeapon = g_WeaponsBaseAPI.Weapon(11);

g_Assert.deepEqual(Object.keys(g_WeaponsBaseAPI).sort(), g_vecExpectedExports.sort(), "weapons exact export surface");
g_Assert.equal(g_LiveWeapon.Index, 11, "Weapon index");
g_Assert.equal(g_LiveWeapon.Decorated, true, "Weapon must receive entity decoration.");
g_Assert.deepEqual(FindNativeCall("GetWeapon"), ["GetWeapon", 11], "Weapon must call the native weapon factory.");
g_Assert.equal(g_LiveWeapon.GetWeaponName(), "smg", "live weapon name");
g_Assert.equal(g_LiveWeapon.GetClip(), 30, "primary clip");
g_Assert.equal(g_LiveWeapon.GetPrimaryAmmoType(), 1, "primary ammo type");
g_Assert.equal(g_LiveWeapon.GetSecondaryAmmoType(), 2, "secondary ammo type");
g_Assert.equal(g_LiveWeapon.GetSecondaryClip(), 7, "secondary clip");
g_Assert.equal(g_LiveWeapon.GetSecondaryAmmo(), 60, "secondary reserve ammo");
g_Assert.equal(g_LiveWeapon.GetAmmo(), 90, "primary reserve ammo");

VerifyNativeAmmoFailure(g_LiveWeapon);

g_Assert.equal(g_LiveWeapon.SetClip(25), true, "primary clip setter result");
g_Assert.equal(g_LiveWeapon.SetSecondaryClip(5), true, "secondary clip setter result");
g_Assert.equal(g_LiveWeapon.SetSecondaryAmmo(55), true, "secondary ammo setter result");
g_Assert.equal(g_LiveWeapon.SetAmmo(80), true, "primary ammo setter result");

g_Assert.equal(g_mapIntegerPropertyValues.get("11:m_iClip1"), 25, "primary clip write-through");
g_Assert.equal(g_mapIntegerPropertyValues.get("11:m_iClip2"), 5, "secondary clip write-through");
g_Assert.equal(g_mapIntegerPropertyValues.get("2:m_iAmmo.002"), 55, "secondary ammo write-through");
g_Assert.deepEqual(FindNativeCall("SetAmmo"), ["SetAmmo", 11, 80], "primary ammo must use native SetAmmo.");

g_Assert.equal(g_LiveWeapon.Drop([1, 2, 3], [4, 5, 6]), true, "drop result");

const g_vecDropWeaponCall = FindNativeCall("DropWeapon");
g_Assert.notEqual(g_vecDropWeaponCall, null, "drop must call players/dropweapon.");
g_Assert.equal(g_vecDropWeaponCall[1].Index, 2, "drop owner index");
g_Assert.equal(g_vecDropWeaponCall[2].Index, 11, "drop weapon index");
g_Assert.deepEqual(g_vecDropWeaponCall[3], [1, 2, 3], "drop target forwarding");
g_Assert.deepEqual(g_vecDropWeaponCall[4], [4, 5, 6], "drop velocity forwarding");

g_Assert.equal(g_WeaponsBaseAPI.Remove(g_LiveWeapon), true, "remove result");
g_Assert.deepEqual(FindNativeCall("Remove"), ["Remove", 11], "remove must pass the weapon index to native weapons.");

g_Assert.equal(g_WeaponsBaseAPI.Drop(CreateWeapon(12)), false, "ownerless drop result");

g_Assert.equal(g_WeaponsBaseAPI.AMMO_PROPERTY_PREFIX, "m_iAmmo.", "ammo property prefix");
g_Assert.equal(g_WeaponsBaseAPI.CLIP_PROPERTY, "m_iClip1", "clip property");
g_Assert.equal(g_WeaponsBaseAPI.SECONDARY_CLIP_PROPERTY, "m_iClip2", "secondary clip property");

g_Assert.throws(() => g_WeaponsBaseAPI.Weapon("11"), /non-negative entity index/, "string weapon indexes must be rejected");
g_Assert.throws(() => g_WeaponsBaseAPI.GetSecondaryAmmoType({ Index: -1 }), /non-negative entity index/, "negative weapon indexes must be rejected");

g_Assert.ok(!Object.hasOwn(g_WeaponsBaseAPI, "byIndex"), "weapons must not expose byIndex.");
g_Assert.ok(!Object.hasOwn(g_WeaponsBaseAPI, "WeaponBase"), "weapons must not expose a copied WeaponBase class.");
g_Assert.ok(!Object.hasOwn(g_WeaponsBaseAPI, "moduleName"), "weapons must not expose moduleName.");
g_Assert.ok(!Object.hasOwn(g_WeaponsBaseAPI, "runtime"), "weapons must not expose the native runtime object.");
g_Assert.ok(!Object.hasOwn(g_WeaponsBaseAPI, "default"), "weapons must not expose a default alias.");
g_Assert.ok(!Object.hasOwn(g_LiveWeapon, "refresh"), "weapons must remain live without a refresh method.");
g_Assert.ok(!Object.hasOwn(g_LiveWeapon, "getInt"), "weapons must not expose abbreviated property aliases.");
g_Assert.ok(!Object.hasOwn(g_LiveWeapon, "getSecondaryFireClip"), "weapons must not expose secondaryFire compatibility names.");

console.log("[  OK  ] smoke_weapons_base");
