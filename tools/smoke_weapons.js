#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strEntitiesPath = g_Path.join(g_strPackageRootPath, "entities", "index.js");
const g_strWeaponsPath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
// Native property selector keys are fixture data, not public JavaScript member names.
const g_strCustomNameProperty = "m_AttributeManager.m_Item.m_szCustomName";

const g_vecNativeCallLog = [];
const g_mapWeaponState = new Map([
	[10, {
		Ammo: 90,
		ClassName: "weapon_rifle",
		Properties: {
			[g_strCustomNameProperty]: "Primary",
			m_flNextPrimaryAttack: 1.25,
			m_hOwnerEntity: 1,
			m_iClip1: 30,
			m_iClip2: 6,
			m_iPrimaryAmmoType: 1,
			m_iSecondaryAmmoType: 2,
			m_vecVerification: { X: 1, Y: 2, Z: 3 },
		},
	}],
	[11, {
		Ammo: 45,
		ClassName: "weapon_pistol",
		Properties: {
			[g_strCustomNameProperty]: "Secondary",
			m_flNextPrimaryAttack: 2.5,
			m_hOwnerEntity: 1,
			m_iClip1: 15,
			m_iClip2: 3,
			m_iPrimaryAmmoType: 1,
			m_iSecondaryAmmoType: 2,
		},
	}],
]);
const g_mapOriginalWeaponState = structuredClone(g_mapWeaponState);
const g_mapOwnerIntegerProperties = new Map([[1, { "m_iAmmo.002": 45 }]]);

function InstallDependency(strPathName, ModuleExports) {
	require.cache[strPathName] = {
		children: [],
		exports: ModuleExports,
		filename: strPathName,
		id: strPathName,
		loaded: true,
		paths: [],
	};
}

function GetOptionalIndex(Value) {
	if (Number.isSafeInteger(Value)) {
		return Value;
	}

	if (Value && (typeof Value === "object")) {
		const nIndex = Value.Index;
		if (Number.isSafeInteger(nIndex)) {
			return nIndex;
		}
	}

	return null;
}

function GetWeaponIndex(Value) {
	const nIndex = GetOptionalIndex(Value);
	if ((nIndex === null) || (nIndex < 0)) {
		throw new TypeError("weapon must be a non-negative index or indexed object");
	}

	return nIndex;
}

function RequireWeapon(Value) {
	const nIndex = GetWeaponIndex(Value);
	const State = g_mapWeaponState.get(nIndex);
	if (!State) {
		throw new Error(`weapon not found: ${nIndex}`);
	}

	return { Index: nIndex, State };
}

function CreateWeapon(nIndex) {
	const State = g_mapWeaponState.get(nIndex);
	if (!State) {
		return null;
	}

	return { Address: BigInt(nIndex) * 0x100n, Free: false, IsWeapon: true, Valid: true, ClassName: State.ClassName, Index: nIndex };
}

function GetPropertyRecord(Value, strProperty) {
	const { State } = RequireWeapon(Value);
	if ((typeof strProperty !== "string") || !Object.hasOwn(State.Properties, strProperty)) {
		throw new Error(`weapon property not found: ${String(strProperty)}`);
	}

	return State.Properties;
}

function ReadProperty(Value, strProperty) {
	return GetPropertyRecord(Value, strProperty)[strProperty];
}

function WriteProperty(Value, strProperty, PropertyValue) {
	GetPropertyRecord(Value, strProperty)[strProperty] = PropertyValue;

	return true;
}

function GetShortWeaponName(strClassName) {
	return strClassName.startsWith("weapon_") ? strClassName.slice("weapon_".length) : strClassName;
}

const g_NativeWeapons = {
	GetAllWeapons() {
		const vecWeapons = [];
		for (const nIndex of g_mapWeaponState.keys()) {
			vecWeapons.push(CreateWeapon(nIndex));
		}

		return vecWeapons;
	},

	GetWeaponsByClassName(strClassName) {
		if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
			throw new TypeError("strClassName must be a non-empty string");
		}

		g_vecNativeCallLog.push(["GetWeaponsByClassName", strClassName]);

		const vecWeapons = [];
		for (const [nIndex, State] of g_mapWeaponState) {
			if (State.ClassName !== strClassName) {
				continue;
			}

			vecWeapons.push(CreateWeapon(nIndex));
		}

		return vecWeapons;
	},

	GetWeaponsByName(strName) {
		if ((typeof strName !== "string") || (strName.length === 0)) {
			throw new TypeError("strName must be a non-empty string");
		}

		g_vecNativeCallLog.push(["GetWeaponsByName", strName]);

		const strExpectedShortName = GetShortWeaponName(strName);
		const vecWeapons = [];
		for (const [nIndex, State] of g_mapWeaponState) {
			if (GetShortWeaponName(State.ClassName) !== strExpectedShortName) {
				continue;
			}

			vecWeapons.push(CreateWeapon(nIndex));
		}

		return vecWeapons;
	},

	GetClassName(Value = -1) {
		const nIndex = GetOptionalIndex(Value);
		if (nIndex === null) {
			return "";
		}

		const State = g_mapWeaponState.get(nIndex);

		return State ? State.ClassName : "";
	},

	GetClasses() {
		const vecClassNames = [];
		const setSeenClassNames = new Set();
		for (const State of g_mapWeaponState.values()) {
			if (setSeenClassNames.has(State.ClassName)) {
				continue;
			}

			setSeenClassNames.add(State.ClassName);
			vecClassNames.push(State.ClassName);
		}

		return vecClassNames;
	},

	GetCount() {
		return g_mapWeaponState.size;
	},

	GetCurrentWeapon(Player) {
		const nPlayerIndex = GetOptionalIndex(Player);
		if ((nPlayerIndex === null) || (nPlayerIndex < 0)) {
			throw new TypeError("Player must be a non-negative index or indexed object");
		}

		g_vecNativeCallLog.push(["GetCurrentWeapon", nPlayerIndex]);

		if (nPlayerIndex === 1) {
			return CreateWeapon(10);
		}

		return null;
	},

	GetAmmo(Value) {
		return RequireWeapon(Value).State.Ammo;
	},

	GetProperty(Value, strProperty, strType = undefined) {
		g_vecNativeCallLog.push(["GetProperty", strProperty, strType]);

		return ReadProperty(Value, strProperty);
	},

	GetPropertyEntity(Value, strProperty) {
		const nEntityIndex = ReadProperty(Value, strProperty);
		if (!Number.isSafeInteger(nEntityIndex) || (nEntityIndex < 0)) {
			return null;
		}

		return { Index: nEntityIndex };
	},

	GetPropertyFloat(Value, strProperty) {
		return ReadProperty(Value, strProperty);
	},

	GetPropertyInteger(Value, strProperty) {
		const OwnerProperties = g_mapOwnerIntegerProperties.get(GetOptionalIndex(Value));
		if (OwnerProperties && Object.hasOwn(OwnerProperties, strProperty)) {
			return OwnerProperties[strProperty];
		}

		return ReadProperty(Value, strProperty);
	},

	GetPropertyString(Value, strProperty) {
		return ReadProperty(Value, strProperty);
	},

	GetPropertyStringArray(Value, strProperty) {
		return ReadProperty(Value, strProperty);
	},

	GetName(Value = -1) {
		const nIndex = GetOptionalIndex(Value);
		if (nIndex === null) {
			return "";
		}

		const State = g_mapWeaponState.get(nIndex);

		return State ? GetShortWeaponName(State.ClassName) : "";
	},

	GetNames() {
		const vecNames = [];
		const setSeenNames = new Set();
		for (const State of g_mapWeaponState.values()) {
			const strWeaponName = GetShortWeaponName(State.ClassName);
			if (setSeenNames.has(strWeaponName)) {
				continue;
			}

			setSeenNames.add(strWeaponName);
			vecNames.push(strWeaponName);
		}

		return vecNames;
	},

	Remove(Value) {
		const nIndex = GetWeaponIndex(Value);
		const bRemoved = g_mapWeaponState.delete(nIndex);

		g_vecNativeCallLog.push(["Remove", nIndex]);

		return bRemoved;
	},

	SetAmmo(Value, nAmmo) {
		if (!Number.isSafeInteger(nAmmo)) {
			throw new TypeError("nAmmo must be an integer");
		}

		RequireWeapon(Value).State.Ammo = nAmmo;

		return true;
	},

	SetProperty(Value, strProperty, PropertyValue, strType = undefined) {
		g_vecNativeCallLog.push(["SetProperty", strProperty, PropertyValue, strType]);

		return WriteProperty(Value, strProperty, PropertyValue);
	},

	SetPropertyEntity(Value, strProperty, Entity) {
		const nEntityIndex = GetOptionalIndex(Entity);
		if ((nEntityIndex === null) || (nEntityIndex < 0)) {
			throw new TypeError("Entity must be a non-negative index or indexed object");
		}

		return WriteProperty(Value, strProperty, nEntityIndex);
	},

	SetPropertyFloat(Value, strProperty, flPropertyValue) {
		if ((typeof flPropertyValue !== "number") || !Number.isFinite(flPropertyValue)) {
			throw new TypeError("property value must be finite");
		}

		return WriteProperty(Value, strProperty, flPropertyValue);
	},

	SetPropertyInteger(Value, strProperty, nPropertyValue) {
		if (!Number.isSafeInteger(nPropertyValue)) {
			throw new TypeError("property value must be an integer");
		}

		return WriteProperty(Value, strProperty, nPropertyValue);
	},

	SetPropertyString(Value, strProperty, strPropertyValue) {
		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteProperty(Value, strProperty, strPropertyValue);
	},

	SetPropertyStringArray(Value, strProperty, strPropertyValue) {
		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteProperty(Value, strProperty, strPropertyValue);
	},

	GetWeapon(Value) {
		const nIndex = GetWeaponIndex(Value);
		g_vecNativeCallLog.push(["GetWeapon", nIndex]);

		const Weapon = g_mapWeaponState.has(nIndex) ? CreateWeapon(nIndex) : null;

		return Weapon;
	},
};

let g_unNativeOperationCount = 0;

for (const [strOperationName, Operation] of Object.entries(g_NativeWeapons)) {
	g_NativeWeapons[strOperationName] = function TrackedNativeOperation() {
		g_unNativeOperationCount += 1;

		return Reflect.apply(Operation, this, arguments);
	};
}

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

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons runtime fixture must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons fixture property must be removable: " + strKey);
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

		Object.defineProperty(globalThis, "sourcejs", {
			configurable: true,
			enumerable: true,
			writable: true,
			value: {
				"players/dropweapon": {
					DropWeapon() {
						return true;
					},
				},
				weapons: g_NativeWeapons,
			},
		});
		bSourceJSOwned = true;

		InstallDependency(g_strEntitiesPath, {
			DecorateEntity(Entity) {
				if (Entity) {
					Entity.Decorated = true;
				}

				return Entity;
			},
		});

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "entities") {
					return g_strEntitiesPath;
				}

				if (strRequest === "internal/runtime") {
					return g_strInternalRuntimePath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		Result = require(g_strWeaponsPath);
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

			throw new AggregateError(vecFailures, "Weapons fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_WeaponsAPI = LoadTestAPI();

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
	"GetName",
	"GetNames",
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

for (const nExpectedIndex of [0, 10]) {
	let unIndexReadCount = 0;
	const Entity = {
		get Index() {
			unIndexReadCount += 1;

			return (unIndexReadCount === 1) ? nExpectedIndex : NaN;
		},
	};
	g_Assert.equal(GetOptionalIndex(Entity), nExpectedIndex, "index validation returns the captured value");
	g_Assert.equal(unIndexReadCount, 1, "index validation reads the getter once");
}

g_Assert.deepEqual(Object.keys(g_WeaponsAPI).sort(), g_vecExpectedExports.sort(), "exact weapons exports");
g_Assert.equal(g_WeaponsAPI.Weapon(10).Index, 10, "Weapon index");
g_Assert.equal(g_WeaponsAPI.Weapon(10).Decorated, true, "Weapon result is decorated");
g_Assert.equal(g_WeaponsAPI.Weapon(999), null, "missing weapon is null");

for (const Weapon of g_WeaponsAPI.GetAllWeapons()) {
	g_Assert.equal(Weapon.Decorated, true, "all results are decorated");
}

g_Assert.equal(g_WeaponsAPI.GetWeaponsByClassName("weapon_rifle")[0].Decorated, true, "class lookup result is decorated");
g_Assert.equal(g_WeaponsAPI.GetWeaponsByName("rifle")[0].Decorated, true, "name lookup result is decorated");
g_Assert.equal(g_WeaponsAPI.GetCurrentWeapon({ Index: 1 }).Decorated, true, "current weapon is decorated");
g_Assert.equal(g_WeaponsAPI.GetCurrentWeapon({ Index: 2 }), null, "missing active weapon is null");
g_Assert.equal(g_WeaponsAPI.GetClassName({ Index: 10 }), "weapon_rifle", "weapon class name");
g_Assert.equal(g_WeaponsAPI.GetName({ Index: 10 }), "rifle", "weapon short name");
g_Assert.deepEqual(g_WeaponsAPI.GetClasses().sort(), ["weapon_pistol", "weapon_rifle"], "current class names");
g_Assert.deepEqual(g_WeaponsAPI.GetNames().sort(), ["pistol", "rifle"], "current short names");
g_Assert.equal(g_WeaponsAPI.GetCount(), 2, "current weapon count");

const g_Rifle = g_WeaponsAPI.Weapon(10);
const g_nOriginalAmmo = g_WeaponsAPI.GetAmmo(g_Rifle);
const g_OriginalProperties = structuredClone(g_mapWeaponState.get(10).Properties);

g_Assert.equal(g_WeaponsAPI.GetName(null), "", "the native name query preserves its tolerant malformed-selector result");
g_Assert.throws(() => g_WeaponsAPI.GetWeaponName(null), /Weapon reference must be a non-negative entity index/, "the JavaScript name helper normalizes selectors strictly");

const g_SelectorError = new Error("weapon selector getter failed");
const g_ThrowingWeaponSelector = {
	get Index() {
		throw g_SelectorError;
	},
};
g_Assert.throws(() => g_WeaponsAPI.GetName(g_ThrowingWeaponSelector), ErrorValue => ErrorValue === g_SelectorError, "name lookup does not swallow selector errors");
g_Assert.throws(() => g_WeaponsAPI.GetWeaponName(g_ThrowingWeaponSelector), ErrorValue => ErrorValue === g_SelectorError, "strict index normalization preserves getter exceptions");

const g_vecWeaponIndexSnapshotCases = [
	{ FirstIndex: 10, LaterIndex: 999, ShouldThrow: false },
	{ FirstIndex: -1, LaterIndex: 10, ShouldThrow: true },
];
for (const IndexSnapshotCase of g_vecWeaponIndexSnapshotCases) {
	let unIndexReadCount = 0;
	const WeaponReference = {
		get Index() {
			unIndexReadCount += 1;

			return (unIndexReadCount === 1) ? IndexSnapshotCase.FirstIndex : IndexSnapshotCase.LaterIndex;
		},
	};
	if (IndexSnapshotCase.ShouldThrow) {
		g_Assert.throws(() => g_WeaponsAPI.GetWeaponName(WeaponReference), /Weapon reference must be a non-negative entity index/, "normalization rejects the captured invalid index");
	} else {
		g_Assert.equal(g_WeaponsAPI.GetWeaponName(WeaponReference), "rifle", "normalization returns the captured valid index");
	}

	g_Assert.equal(unIndexReadCount, 1, "one object-to-index conversion reads Index once");
}

const g_InvalidWeaponDecoration = { IsWeapon: false, Valid: true, Free: false, Index: 10 };
g_Assert.equal(g_WeaponsAPI.DecorateWeapon(g_InvalidWeaponDecoration), g_InvalidWeaponDecoration, "a failed decoration gate returns the exact input");
g_Assert.equal(Object.hasOwn(g_InvalidWeaponDecoration, "GetAmmo"), false, "a failed gate installs no weapon method");

const g_InheritedWeaponMethods = { GetClip: null, Drop: false };
const g_PreservedWeapon = Object.assign(Object.create(g_InheritedWeaponMethods), { IsWeapon: true, Valid: true, Free: false, Index: 10 });
g_Assert.equal(g_WeaponsAPI.DecorateWeapon(g_PreservedWeapon), g_PreservedWeapon, "eligible decoration mutates the exact input");
g_Assert.equal(g_PreservedWeapon.GetClip, null, "decoration preserves an inherited non-callable method value");
g_Assert.equal(Object.hasOwn(g_PreservedWeapon, "GetClip"), false, "decoration does not shadow the inherited method name");
g_Assert.equal(g_PreservedWeapon.Drop, false, "decoration preserves another inherited non-callable method name");
g_Assert.equal(typeof g_PreservedWeapon.GetAmmo, "function", "decoration fills a genuinely missing method name");

g_Assert.equal(g_WeaponsAPI.SetAmmo(g_Rifle, g_nOriginalAmmo + 1), true, "SetAmmo result");
g_Assert.equal(g_WeaponsAPI.GetAmmo(g_Rifle), g_nOriginalAmmo + 1, "SetAmmo mutation");
g_Assert.equal(g_WeaponsAPI.SetAmmo(g_Rifle, g_nOriginalAmmo), true, "direct ammo test restores the original value");
g_Assert.equal(g_WeaponsAPI.GetProperty(g_Rifle, "m_iClip1", "int"), 30, "generic property read");
g_Assert.equal(g_WeaponsAPI.SetProperty(g_Rifle, "m_iClip1", 31, "int"), true, "generic property write");
g_Assert.equal(g_WeaponsAPI.GetPropertyInteger(g_Rifle, "m_iClip1"), 31, "integer property read");
g_Assert.equal(g_WeaponsAPI.SetPropertyInteger(g_Rifle, "m_iClip1", 30), true, "integer property write");
g_Assert.equal(g_WeaponsAPI.GetPropertyFloat(g_Rifle, "m_flNextPrimaryAttack"), 1.25, "float property read");
g_Assert.equal(g_WeaponsAPI.SetPropertyFloat(g_Rifle, "m_flNextPrimaryAttack", 1.5), true, "float property write");
g_Assert.equal(g_WeaponsAPI.SetPropertyFloat(g_Rifle, "m_flNextPrimaryAttack", 1.25), true, "direct float test restores the original value");
g_Assert.equal(g_WeaponsAPI.GetPropertyEntity(g_Rifle, "m_hOwnerEntity").Index, 1, "entity property read");
g_Assert.equal(g_WeaponsAPI.SetPropertyEntity(g_Rifle, "m_hOwnerEntity", { Index: 1 }), true, "entity property write");
g_Assert.equal(g_WeaponsAPI.GetPropertyString(g_Rifle, g_strCustomNameProperty), "Primary", "string property read");
g_Assert.equal(g_WeaponsAPI.SetPropertyString(g_Rifle, g_strCustomNameProperty, "Changed"), true, "string property write");
g_Assert.equal(g_WeaponsAPI.GetPropertyStringArray(g_Rifle, g_strCustomNameProperty), "Changed", "string-array property read");
g_Assert.equal(g_WeaponsAPI.SetPropertyStringArray(g_Rifle, g_strCustomNameProperty, "Primary"), true, "string-array property write");
g_Assert.deepEqual(g_mapWeaponState.get(10).Properties, g_OriginalProperties, "direct property tests restore state");
g_Assert.equal(typeof g_WeaponsAPI.GetAmmo, "function", "full GetAmmo export");
g_Assert.equal(typeof g_WeaponsAPI.SetAmmo, "function", "full SetAmmo export");

let g_bNativeWeaponFactoryCalled = false;
for (const vecNativeCall of g_vecNativeCallLog) {
	if ((vecNativeCall[0] === "GetWeapon") && (vecNativeCall[1] === 10)) {
		g_bNativeWeaponFactoryCalled = true;
		break;
	}
}

g_Assert.ok(g_bNativeWeaponFactoryCalled, "Weapon calls the native factory");

for (const strForbiddenExport of ["byIndex", "weapon", "constants", "moduleName", "default"]) {
	g_Assert.equal(Object.hasOwn(g_WeaponsAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

function VerifyWorldWeaponPropertyImports(Weapons) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecImportMatch = strExample.match(/const\s*\{([^}]+)\}\s*=\s*require\("weapons"\);/);
	g_Assert.ok(vecImportMatch, "world example must retain its root weapon imports");

	const vecImportNames = vecImportMatch[1].split(",").map((strName) => strName.trim()).filter((strName) => strName.length > 0);
	for (const strName of vecImportNames) {
		g_Assert.equal(Object.hasOwn(Weapons, strName), true, `world example imports an absent weapon export: ${strName}`);
	}

	const vecConstantsMatch = strExample.match(/LogResult\("weapons read helpers",[\s\S]*?const Constants = (\{[\s\S]*?\r?\n\t\t});/);
	g_Assert.ok(vecConstantsMatch, "world read-helper example must retain its property constants");

	const strConstantsPayload = vecConstantsMatch[1].replace(/\r\n/g, "\n").replace(/\n\t\t/g, "\n");
	const strConstantsSource = `const { ${vecImportNames.join(", ")} } = Weapons;\n\n(${strConstantsPayload});`;
	const Constants = g_VM.runInNewContext(strConstantsSource, { Weapons }, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
	for (const strName of ["AMMO_PROPERTY_PREFIX", "CLIP_PROPERTY", "OWNER_PROPERTY", "PRIMARY_AMMO_TYPE_PROPERTY", "SECONDARY_AMMO_TYPE_PROPERTY", "SECONDARY_CLIP_PROPERTY"]) {
		g_Assert.equal(typeof Constants[strName], "string");
		g_Assert.equal(Constants[strName], Weapons[strName]);
	}
}

function VerifyWorldWeaponExamples(Weapons) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8").replace(/\r\n/g, "\n");
	const strEntityModulePath = g_Path.join(g_strPackageRootPath, "weapons", "entity.js");
	const EntityModule = { exports: {} };
	const LoadEntityModule = new Function("require", "module", "exports", g_FileSystem.readFileSync(strEntityModulePath, "utf8"));
	LoadEntityModule((strName) => {
		if (strName === "weapons") {
			return Weapons;
		}

		g_Assert.equal(strName, "internal/runtime");

		return {
			GetModule(strModuleName) {
				g_Assert.equal(strModuleName, "weapons/entity");

				return g_NativeWeapons;
			},
		};
	}, EntityModule, EntityModule.exports);

	const vecOriginalWeapons = Array.from(g_mapWeaponState);
	const OriginalGetWeapon = g_NativeWeapons.GetWeapon;
	const vecProfiles = [
		{ HasWeapons: false, Players: [] },
		{ HasWeapons: true, Players: [] },
		{ HasWeapons: true, Players: [{ Connected: true, Index: 1 }] },
		{ HasWeapons: true, Players: [{ Connected: true, Index: 1 }], MissingFactory: true },
		{ HasWeapons: true, Players: [{ Connected: true, Index: 1 }], Unowned: true },
	];

	try {
		for (const Profile of vecProfiles) {
			g_mapWeaponState.clear();

			if (Profile.HasWeapons) {
				for (const [nIndex, State] of vecOriginalWeapons) {
					const CurrentState = structuredClone(State);
					if (Profile.Unowned) {
						CurrentState.Properties.m_hOwnerEntity = -1;
					}

					g_mapWeaponState.set(nIndex, CurrentState);
				}
			}

			g_NativeWeapons.GetWeapon = Profile.MissingFactory ? () => null : OriginalGetWeapon;
			const mapResults = new Map();
			for (const strLabel of ["weapons current state and facade", "weapons read helpers", "weapons/entity live facade"]) {
				const strMarker = `\tLogResult("${strLabel}", () => {`;
				const strEndMarker = "\n\t});";
				const nStart = strExample.indexOf(strMarker);
				const nEnd = strExample.indexOf(strEndMarker, nStart);
				g_Assert.ok((nStart >= 0) && (nEnd > nStart), `world callback must remain available: ${strLabel}`);
				g_VM.runInNewContext(strExample.slice(nStart, nEnd + strEndMarker.length), {
					...Weapons,
					g_EntityWeapon: EntityModule.exports.Weapon,
					g_GetEntityWeaponProperty: EntityModule.exports.GetProperty,
					g_GetEntityWeaponPropertyEntity: EntityModule.exports.GetPropertyEntity,
					g_GetEntityWeaponPropertyInteger: EntityModule.exports.GetPropertyInteger,
					GetAllPlayers: () => Profile.Players,
					GetEntityIndexes: (vecEntities) => vecEntities.map((EntityInstance) => EntityInstance.Index),
					LogResult: (strName, Callback) => mapResults.set(strName, Callback()),
				}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
			}

			const RootResult = mapResults.get("weapons current state and facade");
			const ReadResult = mapResults.get("weapons read helpers");
			const EntityResult = mapResults.get("weapons/entity live facade");
			if (!Profile.HasWeapons) {
				g_Assert.deepEqual(Array.from(RootResult.All), []);
				g_Assert.equal(ReadResult.Weapon, null);
				g_Assert.equal(EntityResult, null);
				continue;
			}

			g_Assert.equal(ReadResult.Weapon.DecoratedIndex, 10);
			g_Assert.equal(ReadResult.Weapon.Index, Profile.MissingFactory ? null : 10);
			g_Assert.equal(ReadResult.Weapon.OwnerIndex, Profile.Unowned ? null : 1);

			if (Profile.MissingFactory) {
				g_Assert.equal(RootResult, null);
				g_Assert.equal(EntityResult, null);
				continue;
			}

			g_Assert.equal(RootResult.Facade.Index, 10);
			g_Assert.equal(RootResult.Facade.ClassName, "weapon_rifle");
			g_Assert.equal(RootResult.Facade.WeaponName, "rifle");
			g_Assert.equal(EntityResult.Index, 10);
			g_Assert.equal(EntityResult.ClassName, "weapon_rifle");
			g_Assert.equal(typeof EntityResult.Address, "bigint");
			g_Assert.equal(EntityResult.OwnerIndex, Profile.Unowned ? null : 1);

			if ((Profile.Players.length > 0) && !Profile.Unowned) {
				g_Assert.equal(ReadResult.Weapon.Ammo, 90);
				g_Assert.equal(ReadResult.Weapon.SecondaryAmmo, 45);
			}
		}
	} finally {
		g_NativeWeapons.GetWeapon = OriginalGetWeapon;
		g_mapWeaponState.clear();

		for (const [nIndex, State] of vecOriginalWeapons) {
			g_mapWeaponState.set(nIndex, State);
		}
	}
}

VerifyWorldWeaponPropertyImports(g_WeaponsAPI);
VerifyWorldWeaponExamples(g_WeaponsAPI);

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

function RequireDocumentationModule(strIdentifier) {
	if (strIdentifier === "weapons") {
		return g_WeaponsAPI;
	}

	throw new Error(`Unexpected documentation import: ${strIdentifier}`);
}

function RunDocumentationBlock(strCodeBlockSource, unBlockIndex) {
	const unDocumentationTimeoutMilliseconds = 1000;

	const DocumentationContext = g_VM.createContext({ require: RequireDocumentationModule });

	const unOperationCountBefore = g_unNativeOperationCount;
	const mapWeaponStateBefore = structuredClone(g_mapWeaponState);

	g_VM.runInContext(strCodeBlockSource, DocumentationContext, { filename: `${g_strDocumentationPath}#example-${unBlockIndex + 1}`, timeout: unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unNativeOperationCount, unOperationCountBefore, `documentation block ${unBlockIndex + 1} performs no native weapon operation while loading`);
	g_Assert.deepEqual(g_mapWeaponState, mapWeaponStateBefore, `documentation block ${unBlockIndex + 1} changes no weapon state while loading`);

	return DocumentationContext;
}

g_Assert.equal(g_vecCodeBlocks.length, 10, "all weapons documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unBlockIndex = 0; unBlockIndex < g_vecCodeBlocks.length; unBlockIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unBlockIndex], unBlockIndex));
}

const g_WeaponInventory = g_vecDocumentationContexts[1].InspectWeaponInventory();
const g_vecInventoryClassNames = [];
const g_vecInventoryNames = [];
const g_vecInventoryWeaponIndexes = [];
for (const strClassName of g_WeaponInventory.ClassNames) {
	g_vecInventoryClassNames.push(strClassName);
}

for (const strWeaponName of g_WeaponInventory.Names) {
	g_vecInventoryNames.push(strWeaponName);
}

for (const WeaponEntry of g_WeaponInventory.Weapons) {
	g_vecInventoryWeaponIndexes.push(WeaponEntry.Weapon.Index);
}

g_Assert.equal(g_WeaponInventory.Count, 2, "inventory workflow returns the live count");
g_Assert.deepEqual(g_vecInventoryClassNames.sort(), ["weapon_pistol", "weapon_rifle"], "inventory workflow returns current classes");
g_Assert.deepEqual(g_vecInventoryNames.sort(), ["pistol", "rifle"], "inventory workflow returns current names");
g_Assert.deepEqual(g_vecInventoryWeaponIndexes, [10, 11], "inventory workflow returns decorated weapon records");

const g_WeaponResolution = g_vecDocumentationContexts[2].ResolveWeaponMatches(10, "weapon_rifle", "rifle");

const g_vecClassMatchWeaponIndexes = [];
const g_vecNameMatchWeaponIndexes = [];
for (const Weapon of g_WeaponResolution.ClassMatches) {
	g_vecClassMatchWeaponIndexes.push(Weapon.Index);
}

for (const Weapon of g_WeaponResolution.NameMatches) {
	g_vecNameMatchWeaponIndexes.push(Weapon.Index);
}

const g_MissingWeaponResolution = g_vecDocumentationContexts[2].ResolveWeaponMatches(999, "weapon_missing", "missing");

g_Assert.equal(g_WeaponResolution.Weapon.Index, 10, "resolution workflow preserves weapon identity");
g_Assert.equal(g_WeaponResolution.ClassName, "weapon_rifle", "resolution workflow returns the full class");
g_Assert.equal(g_WeaponResolution.Name, "rifle", "resolution workflow returns the short name");
g_Assert.deepEqual(g_vecClassMatchWeaponIndexes, [10], "resolution workflow returns class matches");
g_Assert.deepEqual(g_vecNameMatchWeaponIndexes, [10], "resolution workflow returns name matches");
g_Assert.equal(g_MissingWeaponResolution, null, "resolution workflow preserves missing null");

const g_ActiveWeapon = g_vecDocumentationContexts[3].InspectActiveWeapon({ Index: 1 });
g_Assert.equal(g_ActiveWeapon.Index, 10, "active workflow returns the current weapon");
g_Assert.equal(g_ActiveWeapon.ClassName, "weapon_rifle", "active workflow returns the current class");
g_Assert.equal(g_ActiveWeapon.Name, "rifle", "active workflow returns the current short name");
g_Assert.equal(g_vecDocumentationContexts[3].InspectActiveWeapon({ Index: 2 }), null, "active workflow preserves missing null");

const g_nTemporaryAmmoResult = g_vecDocumentationContexts[4].WithTemporaryReserveAmmo(g_Rifle, 123, function DoubleTemporaryAmmo(nTemporaryAmmo) {
	g_Assert.equal(nTemporaryAmmo, 123, "ammo workflow exposes the temporary value");

	return nTemporaryAmmo * 2;
});

g_Assert.equal(g_nTemporaryAmmoResult, 246, "ammo workflow returns the callback result");
g_Assert.equal(g_WeaponsAPI.GetAmmo(g_Rifle), g_nOriginalAmmo, "ammo workflow restores the original value");
g_Assert.throws(() => g_vecDocumentationContexts[4].WithTemporaryReserveAmmo(g_Rifle, 124, () => {
	throw new Error("stop ammo inspection");
}), /stop ammo inspection/, "ammo workflow propagates callback errors");
g_Assert.equal(g_WeaponsAPI.GetAmmo(g_Rifle), g_nOriginalAmmo, "ammo callback error restores the original value");

const g_PendingWorkflowPromise = new Promise(() => undefined);

function ReturnPendingWorkflowPromise() {
	return g_PendingWorkflowPromise;
}

g_Assert.equal(g_vecDocumentationContexts[4].WithTemporaryReserveAmmo(g_Rifle, 125, ReturnPendingWorkflowPromise), g_PendingWorkflowPromise, "the ammo workflow returns an unresolved promise without awaiting it");
g_Assert.equal(g_WeaponsAPI.GetAmmo(g_Rifle), g_nOriginalAmmo, "ammo cleanup finishes before the returned promise settles");

const g_nGenericPropertyResult = g_vecDocumentationContexts[5].WithTemporaryWeaponProperty(g_Rifle, "m_iClip1", "int", 7, nTemporaryClip => nTemporaryClip + 1);

g_Assert.equal(g_nGenericPropertyResult, 8, "generic workflow returns its callback result");
g_Assert.equal(g_WeaponsAPI.GetPropertyInteger(g_Rifle, "m_iClip1"), 30, "generic workflow restores the original property");
g_Assert.equal(g_vecDocumentationContexts[5].WithTemporaryWeaponProperty(g_Rifle, "m_iClip1", "int", 8, ReturnPendingWorkflowPromise), g_PendingWorkflowPromise, "the generic property workflow does not await its callback result");
g_Assert.equal(g_WeaponsAPI.GetPropertyInteger(g_Rifle, "m_iClip1"), 30, "generic property cleanup finishes before the returned promise settles");

function CopyVectorComponents(VectorValue) {
	return { X: VectorValue.X, Y: VectorValue.Y, Z: VectorValue.Z };
}

const g_VectorPropertyResult = g_vecDocumentationContexts[5].WithTemporaryWeaponProperty(g_Rifle, "m_vecVerification", "vector", { X: 4, Y: 5, Z: 6 }, CopyVectorComponents);
const g_RestoredVectorProperty = g_WeaponsAPI.GetProperty(g_Rifle, "m_vecVerification", "vector");

g_Assert.deepEqual(g_VectorPropertyResult, { X: 4, Y: 5, Z: 6 }, "generic workflow exposes temporary vector components");
g_Assert.deepEqual(CopyVectorComponents(g_RestoredVectorProperty), { X: 1, Y: 2, Z: 3 }, "generic workflow restores vector components");

const g_nTypedIntegerResult = g_vecDocumentationContexts[6].WithTemporaryWeaponInteger(g_Rifle, "m_iClip1", 9, nTemporaryClip => nTemporaryClip);
const g_flTypedFloatResult = g_vecDocumentationContexts[6].WithTemporaryWeaponFloat(g_Rifle, "m_flNextPrimaryAttack", 3.5, flTemporaryAttackTime => flTemporaryAttackTime);

g_Assert.equal(g_nTypedIntegerResult, 9, "typed integer workflow exposes the temporary value");
g_Assert.equal(g_flTypedFloatResult, 3.5, "typed float workflow exposes the temporary value");
g_Assert.equal(g_WeaponsAPI.GetPropertyInteger(g_Rifle, "m_iClip1"), 30, "typed integer workflow restores state");
g_Assert.equal(g_WeaponsAPI.GetPropertyFloat(g_Rifle, "m_flNextPrimaryAttack"), 1.25, "typed float workflow restores state");

const g_nTemporaryEntityIndex = g_vecDocumentationContexts[7].WithTemporaryWeaponEntity(g_Rifle, "m_hOwnerEntity", { Index: 2 }, TemporaryOwner => TemporaryOwner.Index);

g_Assert.equal(g_nTemporaryEntityIndex, 2, "entity workflow exposes the temporary target");
g_Assert.equal(g_WeaponsAPI.GetPropertyEntity(g_Rifle, "m_hOwnerEntity").Index, 1, "entity workflow restores the original target");

const g_strTemporaryStringResult = g_vecDocumentationContexts[8].WithTemporaryWeaponString(g_Rifle, g_strCustomNameProperty, "Verification", strTemporaryString => strTemporaryString);

g_Assert.equal(g_strTemporaryStringResult, "Verification", "string workflow reads through the second public name");

const g_strRestoredCustomName = g_WeaponsAPI.GetPropertyString(g_Rifle, g_strCustomNameProperty);
g_Assert.equal(g_strRestoredCustomName, "Primary", "string workflow restores through the second setter name");

const g_nRemovalWeaponIndex = 99;
g_mapWeaponState.set(g_nRemovalWeaponIndex, {
	Ammo: 0,
	ClassName: "weapon_verification",
	Properties: {
		[g_strCustomNameProperty]: "Temporary",
		m_flNextPrimaryAttack: 0,
		m_hOwnerEntity: 1,
		m_iClip1: 0,
	},
});

const g_RemovalReport = g_vecDocumentationContexts[9].RemoveOwnedWeapon(CreateWeapon(g_nRemovalWeaponIndex));
g_Assert.equal(g_RemovalReport.ClassName, "weapon_verification", "removal workflow captures the class before removal");
g_Assert.equal(g_RemovalReport.Index, g_nRemovalWeaponIndex, "removal workflow captures the index before removal");
g_Assert.equal(g_RemovalReport.Name, "verification", "removal workflow captures the name before removal");
g_Assert.equal(g_RemovalReport.Removed, true, "removal workflow reports successful removal");
g_Assert.equal(g_mapWeaponState.has(g_nRemovalWeaponIndex), false, "removal workflow destroys the owned weapon");

const g_unExpectedClassificationReadCount = 1;
let g_unUnresolvedSelectorReadCount = 0;
const g_ExpiredMetadataError = new Error("unresolved weapon metadata was read after classification");
const g_UnresolvedWeapon = {
	get Index() {
		g_unUnresolvedSelectorReadCount += 1;

		if (g_unUnresolvedSelectorReadCount > g_unExpectedClassificationReadCount) {
			throw g_ExpiredMetadataError;
		}

		return 999;
	},
};
const g_UnresolvedRemovalReport = g_vecDocumentationContexts[9].RemoveOwnedWeapon(g_UnresolvedWeapon);
g_Assert.deepEqual(structuredClone(g_UnresolvedRemovalReport), { ClassName: "", Index: null, Name: "", Removed: false }, "an unresolved removal workflow returns an explicit report without reading remaining metadata");
g_Assert.equal(g_unUnresolvedSelectorReadCount, g_unExpectedClassificationReadCount, "an unresolved workflow reads only the selector required for classification");

const g_nUnownedWeaponIndex = 97;
g_mapWeaponState.set(g_nUnownedWeaponIndex, { ClassName: "weapon_unowned_verification", Ammo: 0, Properties: { m_hOwnerEntity: -1 } });
const g_UnownedWeapon = g_WeaponsAPI.Weapon(g_nUnownedWeaponIndex);
g_Assert.equal(g_WeaponsAPI.Drop(g_UnownedWeapon), false, "an unresolved owner reports a false drop result");
g_Assert.equal(g_WeaponsAPI.Remove(g_UnownedWeapon), true, "a false drop result still permits native removal");
g_Assert.equal(g_mapWeaponState.has(g_nUnownedWeaponIndex), false, "ownerless removal releases the test weapon");
g_Assert.throws(() => g_WeaponsAPI.Remove(g_UnownedWeapon), /weapon not found: 97/, "expired removal can throw in strict owner lookup before reaching native removal");

g_Assert.deepEqual(structuredClone(g_mapWeaponState), g_mapOriginalWeaponState, "documentation workflows restore weapon state");
g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "weapons examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|new name\(\)|m_iHealth/, "weapons documentation is hand-maintained");
g_Assert.match(g_strDocumentation, /\| `longlong`, `ulonglong` \| `bigint` \| In-range `bigint` only\./, "documentation requires BigInt for 64-bit writes");
g_Assert.match(g_strDocumentation, /writes the first UTF-8 byte, with an empty string writing NUL/, "documentation describes native byte rather than Unicode-character writes");
g_Assert.match(g_strDocumentation, /An eligible object is mutated in place/, "documentation describes decoration identity");
g_Assert.match(g_strDocumentation, /even if its value is not callable/, "documentation does not promise replacement of existing method names");
g_Assert.match(g_strDocumentation, /Returning a promise does not defer cleanup/, "documentation states synchronous temporary-workflow cleanup");
g_Assert.match(g_strDocumentation, /unavailable globals instead throw/, "documentation does not equate missing globals with an empty inventory");
g_Assert.match(g_strDocumentation, /thrown selector getter or native failure still propagates/, "documentation preserves selector and native errors");
g_Assert.match(g_strDocumentation, /256-byte fallback/, "documentation exposes the native string-capacity fallback");
g_Assert.match(g_strDocumentation, /truncation can split a multibyte sequence/, "documentation describes byte-counted fixed-string writes");
g_Assert.match(g_strDocumentation, /`Index: null`, `Name: ""` and/, "documentation defines an unresolved removal report");
g_Assert.match(g_strDocumentation, /a thrown owner\/property\/drop error does/, "documentation distinguishes a false drop result from an exception");

for (const strExportName of [
	"AMMO_PROPERTY_PREFIX",
	"CLIP_PROPERTY",
	"OWNER_PROPERTY",
	"PRIMARY_AMMO_TYPE_PROPERTY",
	"SECONDARY_AMMO_TYPE_PROPERTY",
	"SECONDARY_CLIP_PROPERTY",
	"Weapon",
	"GetAllWeapons",
	"GetWeaponsByClassName",
	"GetWeaponsByName",
	"GetClassName",
	"GetClasses",
	"GetCount",
	"GetCurrentWeapon",
	"DecorateWeapon",
	"Drop",
	"GetAmmo",
	"GetClip",
	"GetOwner",
	"GetProperty",
	"GetPropertyEntity",
	"GetPropertyFloat",
	"GetPropertyInteger",
	"GetPropertyString",
	"GetPropertyStringArray",
	"GetPrimaryAmmoType",
	"GetSecondaryAmmo",
	"GetSecondaryAmmoType",
	"GetSecondaryClip",
	"GetWeaponName",
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
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

const g_strDocumentationDirectory = g_Path.dirname(g_strDocumentationPath);
for (const strRelativeLink of ["weapons-entity.md", "entities-props.md", "weapons-manager.md"]) {
	const strLinkedDocumentationPath = g_Path.join(g_strDocumentationDirectory, strRelativeLink);
	g_Assert.equal(g_FileSystem.existsSync(strLinkedDocumentationPath), true, `documentation link exists: ${strRelativeLink}`);
}

const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_vecCurrentCallbackSections = g_strModuleBindings.split("void GetCurrentWeaponCallback");
g_Assert.equal(g_vecCurrentCallbackSections.length, 2, "exactly one current-weapon callback definition is required");

const g_vecCurrentCallbackBoundaries = g_vecCurrentCallbackSections[1].split("bool GetWeaponClassName");
g_Assert.equal(g_vecCurrentCallbackBoundaries.length, 2, "exactly one following weapon-class-name boundary is required");

const g_strCurrentCallbackBinding = g_vecCurrentCallbackBoundaries[0];
g_Assert.match(g_strCurrentCallbackBinding, /GetPlayerActiveWeaponCallback\(CallbackInformation\);/, "weapons.GetCurrentWeapon uses the active-weapon SDK binding");
g_Assert.doesNotMatch(g_strCurrentCallbackBinding, /GetWeaponName\(\)|RequirePlayerInfoManager/, "weapons.GetCurrentWeapon does not return an IPlayerInfo name value");

const g_unRuntimeCheckTimeoutMilliseconds = 5000;
const g_MissingNativeRuntimeProcess = g_ChildProcess.spawnSync(process.execPath, ["-e", "require(process.argv[1]);", g_strWeaponsPath], {
	encoding: "utf8",
	timeout: g_unRuntimeCheckTimeoutMilliseconds,
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
});
g_Assert.equal(g_MissingNativeRuntimeProcess.error, undefined, "missing-runtime subprocess starts and completes before its timeout");
g_Assert.equal(g_MissingNativeRuntimeProcess.signal, null, "missing-runtime subprocess is not terminated by a signal");
g_Assert.equal(g_MissingNativeRuntimeProcess.status, 1, "weapons requires the native runtime");
g_Assert.match(g_MissingNativeRuntimeProcess.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons");
