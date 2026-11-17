#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-manager.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strCVarsPath = g_Path.join(g_strPackageRootPath, "cvars.js");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_strDataPath = g_Path.join(g_strPackageRootPath, "weapons", "data.js");
const g_strInstancePath = g_Path.join(g_strPackageRootPath, "weapons", "instance.js");
const g_strManagerPath = g_Path.join(g_strPackageRootPath, "weapons", "manager.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");

const g_strWeaponClassNamePrefix = "weapon_";
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unChildTimeoutMilliseconds = 5000;

const g_vecNativeCallLog = [];
const g_vecProfileCallLog = [];
const g_vecLiveWeaponRecords = [
	{ ClassName: "weapon_rifle", Index: 10, OwnerIndex: 1, WeaponName: "rifle" },
	{ ClassName: "weapon_pistol", Index: 11, OwnerIndex: 2, WeaponName: "pistol" },
];
const g_WeaponProperties = { AmmoProperty: "m_iAmmo.", MyWeaponsProperty: "m_hMyWeapons.", Prefix: g_strWeaponClassNamePrefix };
const g_ProjectileNames = Object.assign(Object.create(null), { grenade_projectile: "grenade" });
const g_SpecialWeaponNames = Object.assign(Object.create(null), { ak: "rifle" });
const g_vecWeaponTags = ["all", "primary", "secondary"];
const g_vecWeaponRecords = [
	{
		AmmoProperty: 2,
		BaseName: "rifle",
		ClassName: "weapon_rifle",
		Clip: 30,
		Cost: 0,
		Data: Object.create(null),
		ID: null,
		ItemDefinitionIndex: null,
		MaximumAmmo: 90,
		Name: "rifle",
		Names: ["rifle", "ak"],
		ParentClass: null,
		Script: null,
		SecondaryAmmoProperty: null,
		SecondaryMaximumAmmo: null,
		Slot: 0,
		Tags: ["all", "primary"],
		Type: null,
	},
	{
		AmmoProperty: 3,
		BaseName: "pistol",
		ClassName: "weapon_pistol",
		Clip: 15,
		Cost: 0,
		Data: Object.create(null),
		ID: null,
		ItemDefinitionIndex: null,
		MaximumAmmo: 120,
		Name: "pistol",
		Names: ["pistol"],
		ParentClass: null,
		Script: null,
		SecondaryAmmoProperty: null,
		SecondaryMaximumAmmo: null,
		Slot: 1,
		Tags: ["all", "secondary"],
		Type: null,
	},
];

function InstallDependency(strDependencyPath, ModuleExports) {
	delete require.cache[strDependencyPath];
	require.cache[strDependencyPath] = { children: [], exports: ModuleExports, filename: strDependencyPath, id: strDependencyPath, loaded: true, paths: [] };
}

function CreateNativeWeapon(WeaponRecord) {
	if (!WeaponRecord) {
		return null;
	}

	return {
		GetOwner() {
			return (WeaponRecord.OwnerIndex === null) ? null : { Index: WeaponRecord.OwnerIndex };
		},

		GetWeaponName() {
			return WeaponRecord.WeaponName;
		},

		IsWeapon: true,
		Free: false,
		Valid: true,
		EntityDecorated: false,
		ClassName: WeaponRecord.ClassName,
		Index: WeaponRecord.Index,
	};
}

function RequireNativeName(strNameValue, strArgumentLabel) {
	if ((typeof strNameValue !== "string") || (strNameValue.length === 0)) {
		throw new TypeError(`${strArgumentLabel} must be a non-empty string`);
	}

	return strNameValue;
}

function RequireProfileName(strNameValue, strArgumentLabel) {
	if ((typeof strNameValue !== "string") || (strNameValue.trim().length === 0)) {
		throw new TypeError(`${strArgumentLabel} must be a non-empty string`);
	}

	return strNameValue.trim().toLowerCase();
}

const g_NativeWeaponsManager = {
	GetAllWeapons() {
		const vecNativeWeapons = [];

		g_vecNativeCallLog.push(["all"]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			vecNativeWeapons.push(CreateNativeWeapon(LiveWeaponRecord));
		}

		return vecNativeWeapons;
	},

	GetWeaponsByClassName(strClassName) {
		const strValidatedClassName = RequireNativeName(strClassName, "Weapon class name");
		const vecNativeWeapons = [];

		g_vecNativeCallLog.push(["byClassName", strValidatedClassName]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			if (LiveWeaponRecord.ClassName === strValidatedClassName) {
				vecNativeWeapons.push(CreateNativeWeapon(LiveWeaponRecord));
			}
		}

		return vecNativeWeapons;
	},

	GetWeaponsByName(strWeaponName) {
		const strValidatedWeaponName = RequireNativeName(strWeaponName, "Weapon name");
		const vecNativeWeapons = [];
		let strWeaponClassName = strValidatedWeaponName;
		if (!strWeaponClassName.startsWith(g_strWeaponClassNamePrefix)) {
			strWeaponClassName = `${g_strWeaponClassNamePrefix}${strWeaponClassName}`;
		}

		g_vecNativeCallLog.push(["byName", strValidatedWeaponName]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			if (LiveWeaponRecord.ClassName === strWeaponClassName) {
				vecNativeWeapons.push(CreateNativeWeapon(LiveWeaponRecord));
			}
		}

		return vecNativeWeapons;
	},

	GetClasses() {
		const vecWeaponClassNames = [];

		g_vecNativeCallLog.push(["classes"]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			if (!vecWeaponClassNames.includes(LiveWeaponRecord.ClassName)) {
				vecWeaponClassNames.push(LiveWeaponRecord.ClassName);
			}
		}

		return vecWeaponClassNames;
	},

	GetCount() {
		g_vecNativeCallLog.push(["count"]);

		return g_vecLiveWeaponRecords.length;
	},

	GetCurrentWeapon(PlayerReference) {
		let PlayerIndexValue = PlayerReference;
		if (!Number.isSafeInteger(PlayerIndexValue) && PlayerReference) {
			PlayerIndexValue = PlayerReference.Index;
		}

		if (!Number.isSafeInteger(PlayerIndexValue) || (PlayerIndexValue < 0)) {
			throw new TypeError("Current weapon requires a player");
		}

		g_vecNativeCallLog.push(["current", PlayerIndexValue]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			if (LiveWeaponRecord.OwnerIndex === PlayerIndexValue) {
				return CreateNativeWeapon(LiveWeaponRecord);
			}
		}

		return null;
	},

	GetNames() {
		const vecWeaponNames = [];

		g_vecNativeCallLog.push(["names"]);

		for (const LiveWeaponRecord of g_vecLiveWeaponRecords) {
			if (!vecWeaponNames.includes(LiveWeaponRecord.WeaponName)) {
				vecWeaponNames.push(LiveWeaponRecord.WeaponName);
			}
		}

		return vecWeaponNames;
	},
};

function FormatProfileName(strWeaponName) {
	let strNormalizedWeaponName = RequireProfileName(strWeaponName, "Weapon name");
	const strSpecialWeaponName = g_SpecialWeaponNames[strNormalizedWeaponName];
	if ((strSpecialWeaponName !== null) && (strSpecialWeaponName !== undefined)) {
		strNormalizedWeaponName = strSpecialWeaponName;
	}

	const strProjectileWeaponName = g_ProjectileNames[strNormalizedWeaponName];
	if ((strProjectileWeaponName !== null) && (strProjectileWeaponName !== undefined)) {
		strNormalizedWeaponName = strProjectileWeaponName;
	}

	if (strNormalizedWeaponName.startsWith(g_WeaponProperties.Prefix)) {
		return strNormalizedWeaponName;
	}

	return `${g_WeaponProperties.Prefix}${strNormalizedWeaponName}`;
}

function FindProfileRecord(strWeaponName) {
	const strNormalizedWeaponName = RequireProfileName(strWeaponName, "Weapon name");
	const strWeaponClassName = FormatProfileName(strNormalizedWeaponName);

	for (const WeaponRecord of g_vecWeaponRecords) {
		if (WeaponRecord.ClassName === strWeaponClassName) {
			return WeaponRecord;
		}

		if (WeaponRecord.Name === strNormalizedWeaponName) {
			return WeaponRecord;
		}

		if (WeaponRecord.Names.includes(strNormalizedWeaponName)) {
			return WeaponRecord;
		}
	}

	return null;
}

function CollectWeaponIndexes(vecWeaponEntities) {
	const vecWeaponIndexes = [];
	for (const WeaponEntity of vecWeaponEntities) {
		vecWeaponIndexes.push(WeaponEntity.Index);
	}

	return vecWeaponIndexes;
}

function AllWeaponEntitiesAreDecorated(vecWeaponEntities) {
	for (const WeaponEntity of vecWeaponEntities) {
		if (!WeaponEntity.EntityDecorated) {
			return false;
		}
	}

	return true;
}

function RequireDocumentationModule(strModuleIdentifier, WeaponsManagerAPI) {
	if (strModuleIdentifier === "weapons/manager") {
		return WeaponsManagerAPI;
	}

	throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
}

function LoadWeaponsManagerAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const strPackagePathPrefix = `${g_strPackageRootPath}${g_Path.sep}`;
	const mapOriginalPackageCache = new Map(Object.getOwnPropertyNames(require.cache).filter(strCachedPath => strCachedPath.startsWith(strPackagePathPrefix)).map(strCachedPath => [strCachedPath, Object.getOwnPropertyDescriptor(require.cache, strCachedPath)]));
	g_Assert.ok(LoaderDescriptor?.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/manager loader must support exact restoration.");
	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/manager runtime fixture must support installation.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/manager runtime fixture must support exact restoration.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/manager package cache must support exact restoration.");
	g_Assert.ok(Array.from(mapOriginalPackageCache.values()).every(Descriptor => Descriptor.configurable), "Weapons/manager cache entries must support exact restoration.");

	function RestoreProperty(Target, strName, Descriptor) {
		if (Descriptor === undefined) {
			g_Assert.equal(Reflect.deleteProperty(Target, strName), true, `Owned weapons/manager fixture property must be removable: ${strName}`);
			return;
		}

		Object.defineProperty(Target, strName, Descriptor);
	}

	let bCacheOwned = false;
	let bLoaderOwned = false;
	let bRuntimeOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;
	const vecCleanupFailures = [];
	try {
		bCacheOwned = true;

		for (const strCachedPath of mapOriginalPackageCache.keys()) {
			RestoreProperty(require.cache, strCachedPath, undefined);
		}

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function Load(strRequest, ParentModule, bIsMain) {
				if (strRequest === "cvars") {
					return require(g_strCVarsPath);
				}

				if (strRequest === "internal/runtime") {
					return require(g_strRuntimePath);
				}

				if (strRequest === "weapons") {
					return require(g_strBasePath);
				}

				if (strRequest === "weapons/data") {
					return require(g_strDataPath);
				}

				if (strRequest === "weapons/instance") {
					return require(g_strInstancePath);
				}

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		InstallDependency(g_strCVarsPath, {
			GetConVarInteger() {
				throw new Error("numeric fixture limits must not read cvars");
			},
		});

		InstallDependency(g_strBasePath, {
			DecorateWeapon(WeaponEntity) {
				if (!WeaponEntity || !WeaponEntity.IsWeapon || !WeaponEntity.Valid || WeaponEntity.Free) {
					return WeaponEntity;
				}

				WeaponEntity.EntityDecorated = true;

				return WeaponEntity;
			},
		});

		InstallDependency(g_strDataPath, {
			GetAll() {
				g_vecProfileCallLog.push(["all"]);

				return g_vecWeaponRecords;
			},

			GetClasses() {
				const vecWeaponClassNames = [];

				g_vecProfileCallLog.push(["classes"]);

				for (const WeaponRecord of g_vecWeaponRecords) {
					vecWeaponClassNames.push(WeaponRecord.ClassName);
				}

				return vecWeaponClassNames;
			},

			FormatName(strWeaponName) {
				g_vecProfileCallLog.push(["formatName", strWeaponName]);

				return FormatProfileName(strWeaponName);
			},

			Get(strWeaponName) {
				g_vecProfileCallLog.push(["get", strWeaponName]);

				return FindProfileRecord(strWeaponName);
			},

			GetProjectiles() {
				g_vecProfileCallLog.push(["projectiles"]);

				return g_ProjectileNames;
			},

			GetProperties() {
				g_vecProfileCallLog.push(["properties"]);

				return g_WeaponProperties;
			},

			GetSpecialNames() {
				g_vecProfileCallLog.push(["specialNames"]);

				return g_SpecialWeaponNames;
			},

			GetTags() {
				g_vecProfileCallLog.push(["tags"]);

				return g_vecWeaponTags;
			},
		});

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: SourceJSDescriptor?.enumerable ?? true, writable: true, value: { "weapons/manager": g_NativeWeaponsManager } });
		bRuntimeOwned = true;

		Result = { WeaponClass: require(g_strInstancePath).WeaponClass, WeaponsManagerAPI: require(g_strManagerPath) };
	} catch (CaughtError) {
		bFailed = true;
		Failure = CaughtError;
	} finally {
		if (bLoaderOwned) {
			try {
				RestoreProperty(g_Module, "_load", LoaderDescriptor);
			} catch (CleanupError) {
				vecCleanupFailures.push(CleanupError);
			}
		}

		if (bRuntimeOwned) {
			try {
				RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
			} catch (CleanupError) {
				vecCleanupFailures.push(CleanupError);
			}
		}

		if (bCacheOwned) {
			for (const strCachedPath of Object.getOwnPropertyNames(require.cache)) {
				if (strCachedPath.startsWith(strPackagePathPrefix)) {
					try {
						RestoreProperty(require.cache, strCachedPath, undefined);
					} catch (CleanupError) {
						vecCleanupFailures.push(CleanupError);
					}
				}
			}

			for (const [strCachedPath, Descriptor] of mapOriginalPackageCache) {
				try {
					RestoreProperty(require.cache, strCachedPath, Descriptor);
				} catch (CleanupError) {
					vecCleanupFailures.push(CleanupError);
				}
			}
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (bFailed) {
			vecCleanupFailures.unshift(Failure);
		}

		throw new AggregateError(vecCleanupFailures, "Weapons/manager fixture cleanup failed.");
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const { WeaponClass, WeaponsManagerAPI: g_WeaponsManagerAPI } = LoadWeaponsManagerAPI();

g_Assert.equal(g_vecNativeCallLog.length, 0, "manager import performs no native scan");
g_Assert.equal(g_vecProfileCallLog.length, 0, "manager import performs no profile load");
g_Assert.deepEqual(Object.keys(g_WeaponsManagerAPI).sort(), [
	"GetAllWeapons",
	"GetClasses",
	"GetCount",
	"GetCurrentWeapon",
	"GetNames",
	"GetWeaponsByClassName",
	"GetWeaponsByName",
	"WEAPON_MANAGER",
	"WeaponManager",
], "exact weapons/manager exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_WeaponsManagerAPI.WeaponManager.prototype).sort(), [
	"AmmoProperty",
	"constructor",
	"Entries",
	"FormatName",
	"Get",
	"Has",
	"Keys",
	"MyWeaponsProperty",
	"Prefix",
	"Projectiles",
	"SpecialNames",
	"Tags",
	"Values",
].sort(), "exact WeaponManager string members");
g_Assert.deepEqual(Object.getOwnPropertySymbols(g_WeaponsManagerAPI.WeaponManager.prototype), [Symbol.iterator], "exact WeaponManager symbol members");
g_Assert.equal(g_WeaponsManagerAPI.GetClasses, g_NativeWeaponsManager.GetClasses, "direct native classes export");
g_Assert.equal(g_WeaponsManagerAPI.GetCount, g_NativeWeaponsManager.GetCount, "direct native count export");
g_Assert.equal(g_WeaponsManagerAPI.GetNames, g_NativeWeaponsManager.GetNames, "direct native names export");

const g_vecFirstAllWeapons = g_WeaponsManagerAPI.GetAllWeapons();
const g_vecSecondAllWeapons = g_WeaponsManagerAPI.GetAllWeapons();
g_Assert.deepEqual(CollectWeaponIndexes(g_vecFirstAllWeapons), [10, 11], "native all indexes");
g_Assert.ok(AllWeaponEntitiesAreDecorated(g_vecFirstAllWeapons), "all results are decorated");
g_Assert.notEqual(g_vecFirstAllWeapons, g_vecSecondAllWeapons, "all returns a fresh array");
g_Assert.notEqual(g_vecFirstAllWeapons[0], g_vecSecondAllWeapons[0], "all returns current native objects");
g_Assert.deepEqual(CollectWeaponIndexes(g_WeaponsManagerAPI.GetWeaponsByClassName("weapon_rifle")), [10], "class lookup");
g_Assert.deepEqual(CollectWeaponIndexes(g_WeaponsManagerAPI.GetWeaponsByName("rifle")), [10], "name lookup");
g_Assert.deepEqual(CollectWeaponIndexes(g_WeaponsManagerAPI.GetWeaponsByName("weapon_rifle")), [10], "full-class name lookup");
g_Assert.deepEqual(g_WeaponsManagerAPI.GetWeaponsByClassName(" weapon_rifle "), [], "native class lookup does not trim");
g_Assert.deepEqual(g_WeaponsManagerAPI.GetWeaponsByName("RIFLE"), [], "native name lookup does not normalize case");
g_Assert.equal(g_WeaponsManagerAPI.GetCurrentWeapon({ Index: 1 }).Index, 10, "current weapon hit");
g_Assert.equal(g_WeaponsManagerAPI.GetCurrentWeapon(2).Index, 11, "numeric current-player index");
g_Assert.equal(g_WeaponsManagerAPI.GetCurrentWeapon({ Index: 99 }), null, "mocked current weapon miss");
g_Assert.deepEqual(g_WeaponsManagerAPI.GetNames(), ["rifle", "pistol"], "native live names");
g_Assert.deepEqual(g_WeaponsManagerAPI.GetClasses(), ["weapon_rifle", "weapon_pistol"], "native live classes");
g_Assert.equal(g_WeaponsManagerAPI.GetCount(), 2, "native live count");
g_Assert.throws(function CallByNameWithEmptyName() {
	g_WeaponsManagerAPI.GetWeaponsByName("");
}, /non-empty string/, "empty native lookup must throw");

const g_WeaponManager = g_WeaponsManagerAPI.WEAPON_MANAGER;
const g_SecondaryWeaponManager = new g_WeaponsManagerAPI.WeaponManager();
const g_FirstWeaponClass = g_WeaponManager.Get("rifle");
const g_SameRecordWeaponClass = g_WeaponManager.Get("weapon_rifle");

g_Assert.ok(g_WeaponManager instanceof g_WeaponsManagerAPI.WeaponManager, "WEAPON_MANAGER type");
g_Assert.deepEqual(Object.keys(g_SecondaryWeaponManager), [], "additional managers have no instance state");
g_Assert.ok(g_FirstWeaponClass instanceof WeaponClass, "manager values are WeaponClass instances");
g_Assert.equal(g_FirstWeaponClass, g_SameRecordWeaponClass, "one record keeps one stable wrapper");
g_Assert.equal(g_SecondaryWeaponManager.Get("rifle"), g_FirstWeaponClass, "manager instances share wrapper identity");

const g_OriginalCachedWeaponRecord = g_FirstWeaponClass.ValueRecord;
const g_RedirectedCachedWeaponRecord = { ClassName: "weapon_plugin_copy", Name: "plugin_copy", Tags: ["plugin"] };
try {
	g_FirstWeaponClass.ValueRecord = g_RedirectedCachedWeaponRecord;
	g_Assert.equal(g_WeaponManager.Get("rifle"), g_FirstWeaponClass, "record-key lookup still returns the same cached wrapper after its backing field is rebound");
	g_Assert.equal(g_SecondaryWeaponManager.Get("rifle").Record, g_RedirectedCachedWeaponRecord, "rebound cached wrapper is shared across manager consumers");
	g_Assert.equal(g_SameRecordWeaponClass.Name, "plugin_copy", "an already retained consumer observes the replacement backing record");
	g_Assert.equal(g_OriginalCachedWeaponRecord.Name, "rifle", "rebinding a wrapper does not replace or modify the original cache key record");
} finally {
	g_FirstWeaponClass.ValueRecord = g_OriginalCachedWeaponRecord;
}

g_Assert.equal(g_WeaponManager.Prefix, "weapon_", "live prefix");
g_Assert.equal(g_WeaponManager.AmmoProperty, "m_iAmmo.", "live ammo property");
g_Assert.equal(g_WeaponManager.MyWeaponsProperty, "m_hMyWeapons.", "live my-weapons property");
g_Assert.equal(g_WeaponManager.Projectiles, g_ProjectileNames, "live projectiles record");
g_Assert.equal(g_WeaponManager.SpecialNames, g_SpecialWeaponNames, "live special-names record");
g_Assert.equal(g_WeaponManager.Tags, g_vecWeaponTags, "live tags array");
g_Assert.equal(g_WeaponManager.FormatName("ak"), "weapon_rifle", "special-name formatting");
g_Assert.equal(g_WeaponManager.FormatName("ak", "unavailable-branch"), "weapon_rifle", "extra method arguments do not select another branch");
g_Assert.equal(g_WeaponManager.Get("rifle", "unavailable-branch"), g_FirstWeaponClass, "extra lookup arguments retain the active-branch cached wrapper");
g_Assert.equal(g_WeaponManager.FormatName("grenade_projectile"), "weapon_grenade", "projectile formatting");
g_Assert.equal(g_WeaponManager.Has("rifle"), true, "manager membership hit");
g_Assert.equal(g_WeaponManager.Has("missing"), false, "manager membership miss");
g_Assert.equal(g_WeaponManager.Get("missing"), null, "missing manager value");
g_Assert.deepEqual(g_WeaponManager.Keys(), ["weapon_rifle", "weapon_pistol"], "manager keys");

const g_vecWeaponClasses = g_WeaponManager.Values();
const g_vecWeaponEntries = g_WeaponManager.Entries();
const g_vecIteratedWeaponClasses = [];
const g_vecValueWeaponClassNames = [];
const g_vecEntryWeaponClassNames = [];

for (const WeaponClassValue of g_vecWeaponClasses) {
	g_vecValueWeaponClassNames.push(WeaponClassValue.ClassName);
}

for (const vecWeaponEntry of g_vecWeaponEntries) {
	g_vecEntryWeaponClassNames.push(vecWeaponEntry[0]);
}

for (const WeaponClassValue of g_WeaponManager) {
	g_vecIteratedWeaponClasses.push(WeaponClassValue);
}

g_Assert.deepEqual(g_vecValueWeaponClassNames, g_WeaponManager.Keys(), "manager values order");
g_Assert.deepEqual(g_vecEntryWeaponClassNames, g_WeaponManager.Keys(), "manager entries keys");
g_Assert.equal(g_vecWeaponEntries[0][1], g_FirstWeaponClass, "entries preserve wrapper identity");
g_Assert.equal(g_vecIteratedWeaponClasses[0], g_FirstWeaponClass, "iterator preserves wrapper identity");

const g_OriginalWeaponRecord = g_vecWeaponRecords[0];
const g_vecReplacementWeaponNames = [];
const g_vecReplacementWeaponTags = [];

for (const strWeaponName of g_OriginalWeaponRecord.Names) {
	g_vecReplacementWeaponNames.push(strWeaponName);
}

for (const strWeaponTag of g_OriginalWeaponRecord.Tags) {
	g_vecReplacementWeaponTags.push(strWeaponTag);
}

const g_ReplacementWeaponRecord = Object.assign({}, g_OriginalWeaponRecord);
g_ReplacementWeaponRecord.Data = Object.create(null);
g_ReplacementWeaponRecord.Names = g_vecReplacementWeaponNames;
g_ReplacementWeaponRecord.Tags = g_vecReplacementWeaponTags;

try {
	g_vecWeaponRecords[0] = g_ReplacementWeaponRecord;

	const ReplacementWeaponClass = g_WeaponManager.Get("rifle");
	g_Assert.notEqual(ReplacementWeaponClass, g_FirstWeaponClass, "new record identity creates a new wrapper");
	g_Assert.equal(g_SecondaryWeaponManager.Get("rifle"), ReplacementWeaponClass, "new wrapper is shared across managers");
} finally {
	g_vecWeaponRecords[0] = g_OriginalWeaponRecord;
}

g_Assert.equal(g_WeaponManager.Get("rifle"), g_FirstWeaponClass, "restored record reuses its wrapper");

const g_strOriginalWeaponPrefix = g_WeaponProperties.Prefix;
try {
	g_WeaponProperties.Prefix = "custom_";
	g_Assert.equal(g_WeaponManager.Prefix, "custom_", "profile properties are live");
} finally {
	g_WeaponProperties.Prefix = g_strOriginalWeaponPrefix;
}

for (const strForbiddenExport of ["weaponManager", "getClass", "properties", "moduleName", "runtime", "default"]) {
	g_Assert.equal(Object.hasOwn(g_WeaponsManagerAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_DocumentationBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationMatch = g_DocumentationBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationMatch[1]);
	g_vecDocumentationMatch = g_DocumentationBlockPattern.exec(g_strDocumentationSource);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 7, "all weapons/manager documentation JavaScript blocks are present");

const g_vecDocumentationModuleExports = [];
const g_unNativeCallsBeforeDocumentationLoad = g_vecNativeCallLog.length;
const g_unProfileCallsBeforeDocumentationLoad = g_vecProfileCallLog.length;
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const DocumentationModule = { exports: {} };
	g_VM.runInNewContext(g_vecDocumentationCodeBlocks[unDocumentationBlockIndex], {
		module: DocumentationModule,
		require: function RequireDocumentationDependency(strModuleIdentifier) {
			return RequireDocumentationModule(strModuleIdentifier, g_WeaponsManagerAPI);
		},
	}, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_vecDocumentationModuleExports.push(DocumentationModule.exports);
}

g_Assert.equal(g_vecNativeCallLog.length, g_unNativeCallsBeforeDocumentationLoad, "documentation blocks perform no native scan while loading");
g_Assert.equal(g_vecProfileCallLog.length, g_unProfileCallsBeforeDocumentationLoad, "documentation blocks perform no profile work while loading");

const g_DocumentedLiveReport = g_vecDocumentationModuleExports[1].CollectLiveWeaponReport();
g_Assert.deepEqual(Array.from(g_DocumentedLiveReport.WeaponClassNames), ["weapon_rifle", "weapon_pistol"], "documented live report classes");
g_Assert.deepEqual(Array.from(g_DocumentedLiveReport.WeaponNames), ["rifle", "pistol"], "documented live report names");
g_Assert.equal(g_DocumentedLiveReport.ReportedCount, 2, "documented live report native count");
g_Assert.equal(g_DocumentedLiveReport.ScannedCount, 2, "documented live report scanned count");
g_Assert.equal(g_DocumentedLiveReport.WeaponReports.length, 2, "documented live report weapon count");
g_Assert.equal(g_DocumentedLiveReport.WeaponReports[0].WeaponClassName, "weapon_rifle", "documented live report class name");
g_Assert.equal(g_DocumentedLiveReport.WeaponReports[0].WeaponIndex, 10, "documented live report index");
g_Assert.equal(g_DocumentedLiveReport.WeaponReports[0].WeaponName, "rifle", "documented live report weapon name");
g_Assert.equal(g_DocumentedLiveReport.WeaponReports[0].OwnerIndex, 1, "documented live report owner index");

const g_DocumentedIndexes = g_vecDocumentationModuleExports[2].FindLiveWeaponIndexes("weapon_rifle", "pistol");
const g_DocumentedSkippedIndexes = g_vecDocumentationModuleExports[2].FindLiveWeaponIndexes(null, null);
g_Assert.deepEqual(Array.from(g_DocumentedIndexes.ClassWeaponIndexes), [10], "documented live class lookup");
g_Assert.deepEqual(Array.from(g_DocumentedIndexes.NamedWeaponIndexes), [11], "documented live name lookup");
g_Assert.equal(g_DocumentedSkippedIndexes.ClassWeaponIndexes.length, 0, "documented lookup can skip class scan");
g_Assert.equal(g_DocumentedSkippedIndexes.NamedWeaponIndexes.length, 0, "documented lookup can skip name scan");
g_Assert.throws(function FindDocumentedWeaponsWithEmptyClassName() {
	g_vecDocumentationModuleExports[2].FindLiveWeaponIndexes("", null);
}, /non-empty string/, "documented class lookup preserves native validation");
g_Assert.throws(function FindDocumentedWeaponsWithEmptyName() {
	g_vecDocumentationModuleExports[2].FindLiveWeaponIndexes(null, "");
}, /non-empty string/, "documented name lookup preserves native validation");

const g_DocumentedCurrentWeapon = g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 1 });
g_Assert.equal(g_DocumentedCurrentWeapon.WeaponClassName, "weapon_rifle", "documented current weapon class name");
g_Assert.equal(g_DocumentedCurrentWeapon.WeaponIndex, 10, "documented current weapon index");
g_Assert.equal(g_DocumentedCurrentWeapon.WeaponName, "rifle", "documented current weapon name");
g_Assert.equal(g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 99 }), null, "documented mocked current weapon miss");
g_Assert.throws(function InspectDocumentedCurrentWeaponWithoutPlayer() {
	g_vecDocumentationModuleExports[3].InspectCurrentWeapon(null);
}, /requires a player/i, "documented current weapon preserves native validation");

{
	const vecNativeMethodNames = ["GetAllWeapons", "GetWeaponsByClassName", "GetWeaponsByName", "GetCurrentWeapon"];
	const mapOriginalMethods = new Map(vecNativeMethodNames.map(strName => [strName, Object.getOwnPropertyDescriptor(g_NativeWeaponsManager, strName)]));
	for (const Descriptor of mapOriginalMethods.values()) {
		g_Assert.ok(Descriptor?.configurable && Descriptor.writable, "owned native fixture methods support exact restoration");
	}

	const InstallNativeView = NativeView => {
		for (const strName of vecNativeMethodNames.slice(0, 3)) {
			Object.defineProperty(g_NativeWeaponsManager, strName, { ...mapOriginalMethods.get(strName), value: () => [NativeView] });
		}

		Object.defineProperty(g_NativeWeaponsManager, "GetCurrentWeapon", { ...mapOriginalMethods.get("GetCurrentWeapon"), value: () => NativeView });
	};

	const CreateObservedView = Flags => {
		const NativeView = Object.assign(CreateNativeWeapon(g_vecLiveWeaponRecords[0]), Flags);
		let unMethodCallCount = 0;
		NativeView.GetOwner = () => {
			unMethodCallCount++;

			return { Index: 1 };
		};
		NativeView.GetWeaponName = () => {
			unMethodCallCount++;

			return "rifle";
		};

		return { NativeView, GetMethodCallCount: () => unMethodCallCount };
	};

	let unStateProfileCount = 0;
	let unMissingMethodProfileCount = 0;
	try {
		for (const bIsWeapon of [false, true]) {
			for (const bValid of [false, true]) {
				for (const bFree of [false, true]) {
					const Observed = CreateObservedView({ IsWeapon: bIsWeapon, Valid: bValid, Free: bFree });
					const NativeView = Observed.NativeView;
					InstallNativeView(NativeView);
					const bShouldDecorate = bIsWeapon && bValid && !bFree;

					for (const ReadView of [
						() => g_WeaponsManagerAPI.GetAllWeapons()[0],
						() => g_WeaponsManagerAPI.GetWeaponsByClassName("weapon_rifle")[0],
						() => g_WeaponsManagerAPI.GetWeaponsByName("rifle")[0],
						() => g_WeaponsManagerAPI.GetCurrentWeapon({ Index: 1 }),
					]) {
						g_Assert.equal(ReadView(), NativeView, "conditional decoration preserves the original native view identity");
					}

					g_Assert.equal(Boolean(NativeView.EntityDecorated), bShouldDecorate, "decoration fixture mirrors production validity gate");

					if (bShouldDecorate) {
						g_Assert.equal(g_vecDocumentationModuleExports[1].CollectLiveWeaponReport().WeaponReports[0].WeaponName, "rifle", "live report preserves the valid decorated path");
						g_Assert.equal(g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 1 }).WeaponName, "rifle", "current weapon report preserves the valid decorated path");
						g_Assert.equal(Observed.GetMethodCallCount(), 3, "valid reports invoke only their required methods");

					} else {
						g_Assert.throws(() => g_vecDocumentationModuleExports[1].CollectLiveWeaponReport(), { name: "TypeError", message: /requires valid decorated weapon views/ }, "live report rejects gate failures before methods");
						g_Assert.throws(() => g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 1 }), { name: "TypeError", message: /requires a valid decorated weapon view/ }, "current weapon report rejects gate failures before methods");
						g_Assert.equal(Observed.GetMethodCallCount(), 0, "rejected views do not invoke borrowed weapon methods");
					}

					unStateProfileCount++;
				}
			}
		}

		for (const Profile of [
			{ Overrides: { GetOwner: undefined }, CurrentReportAllowed: true },
			{ Overrides: { GetWeaponName: false }, CurrentReportAllowed: false },
			{ Overrides: { GetOwner: 0, GetWeaponName: null }, CurrentReportAllowed: false },
		]) {
			const Observed = CreateObservedView({ IsWeapon: true, Valid: true, Free: false });
			Object.assign(Observed.NativeView, Profile.Overrides);
			InstallNativeView(Observed.NativeView);
			g_Assert.throws(() => g_vecDocumentationModuleExports[1].CollectLiveWeaponReport(), { name: "TypeError", message: /requires valid decorated weapon views/ }, "live report rejects unavailable methods before calling them");

			if (Profile.CurrentReportAllowed) {
				g_Assert.equal(g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 1 }).WeaponName, "rifle", "current report does not require an unused owner method");

			} else {
				g_Assert.throws(() => g_vecDocumentationModuleExports[3].InspectCurrentWeapon({ Index: 1 }), { name: "TypeError", message: /requires a valid decorated weapon view/ }, "current report rejects unavailable methods before calling them");
			}

			g_Assert.equal(Observed.GetMethodCallCount(), Profile.CurrentReportAllowed ? 1 : 0, "missing methods do not cause partial borrowed reads");
			unMissingMethodProfileCount++;
		}
	} finally {
		for (const [strName, Descriptor] of mapOriginalMethods) {
			Object.defineProperty(g_NativeWeaponsManager, strName, Descriptor);
		}
	}

	g_Assert.equal(unStateProfileCount, 8, "all weapon/valid/free flag combinations are checked");
	g_Assert.equal(unMissingMethodProfileCount, 3, "all blocked-method profiles are checked");
	console.log("[smoke_weapons_manager] Decoration profiles passed: states=8 missing-methods=3");
}

const g_DocumentedRules = g_vecDocumentationModuleExports[4].InspectProfileRules("ak");
g_Assert.equal(g_DocumentedRules.AmmoProperty, g_WeaponProperties.AmmoProperty, "documented profile ammo property");
g_Assert.equal(g_DocumentedRules.FormattedWeaponClassName, "weapon_rifle", "documented profile name formatting");
g_Assert.equal(g_DocumentedRules.MyWeaponsProperty, g_WeaponProperties.MyWeaponsProperty, "documented profile weapon property");
g_Assert.equal(g_DocumentedRules.WeaponPrefix, g_WeaponProperties.Prefix, "documented profile prefix");
g_Assert.equal(g_DocumentedRules.Projectiles, g_ProjectileNames, "documented profile projectile identity");
g_Assert.equal(g_DocumentedRules.SpecialNames, g_SpecialWeaponNames, "documented profile special-name identity");
g_Assert.equal(g_DocumentedRules.Tags, g_vecWeaponTags, "documented profile tag identity");

const g_DocumentedMetadata = g_vecDocumentationModuleExports[5].ResolveProfileMetadata("rifle");
g_Assert.equal(g_DocumentedMetadata.WeaponClassName, "weapon_rifle", "documented metadata class name");
g_Assert.equal(g_DocumentedMetadata.KnownBySecondaryManager, true, "documented metadata membership");
g_Assert.equal(g_DocumentedMetadata.WeaponName, "rifle", "documented metadata name");
g_Assert.equal(g_DocumentedMetadata.SameWrapper, true, "documented metadata wrapper identity");
g_Assert.deepEqual(Array.from(g_DocumentedMetadata.WeaponTags), ["all", "primary"], "documented metadata tag copy");
g_Assert.equal(g_vecDocumentationModuleExports[5].ResolveProfileMetadata("missing"), null, "documented metadata miss");

const g_vecDocumentedCatalog = g_vecDocumentationModuleExports[6].BuildProfileCatalog();
g_Assert.equal(g_vecDocumentedCatalog.length, 2, "documented profile catalog length");
g_Assert.equal(g_vecDocumentedCatalog[0].WeaponClassName, "weapon_rifle", "documented profile catalog class name");
g_Assert.equal(g_vecDocumentedCatalog[0].WeaponName, "rifle", "documented profile catalog name");
g_Assert.equal(g_vecDocumentedCatalog[0].Slot, 0, "documented profile catalog slot");
g_Assert.deepEqual(Array.from(g_vecDocumentedCatalog[0].Tags), ["all", "primary"], "documented profile catalog tag copy");

const g_OriginalKeysDescriptor = Object.getOwnPropertyDescriptor(g_WeaponManager, "Keys");
try {
	g_WeaponManager.Keys = function ReturnReorderedWeaponKeys() {
		return ["weapon_pistol", "weapon_rifle"];
	};

	g_Assert.throws(function BuildDocumentedCatalogWithInconsistentOrdering() {
		g_vecDocumentationModuleExports[6].BuildProfileCatalog();
	}, /ordering change/, "documented profile catalog detects inconsistent ordering");
} finally {
	if (g_OriginalKeysDescriptor) {
		Object.defineProperty(g_WeaponManager, "Keys", g_OriginalKeysDescriptor);
	} else {
		delete g_WeaponManager.Keys;
	}
}

g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|classes\(branch|names\(branch|classes\(\)\[0\]|Player\(1\)|console\.|const api =/, "weapons/manager documentation is hand-maintained and action-oriented");
g_Assert.match(g_strDocumentationSource, /class name starts with `weapon_`/, "documentation describes exact native weapon classification rather than profile-driven matching");
g_Assert.match(g_strDocumentationSource, /These native operations run synchronously on the game thread/, "documentation describes native scan thread confinement");
g_Assert.match(g_strDocumentationSource, /without changing the `WeakMap`'s original record\s+key/, "documentation warns that rebinding a shared wrapper does not rekey its cache");
g_Assert.match(g_strDocumentationSource, /a returned borrowed object can remain undecorated if that gate fails/, "documentation does not promise unconditional decoration of invalid native objects");
g_Assert.match(g_strDocumentationSource, /proxies can still run caller-provided code synchronously and reenter/, "documentation distinguishes queued callbacks from synchronous reentrancy");
g_Assert.match(g_strDocumentationSource, /Extra JavaScript arguments are ignored/, "documentation does not invent branch-argument validation");

for (const strRelativeLink of ["weapons-instance.md", "weapons-data.md", "weapons-entity.md", "players-entity.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strManagerPath)});`], { encoding: "utf8", env: { ...process.env, NODE_PATH: g_strPackageRootPath }, timeout: g_unChildTimeoutMilliseconds });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and finishes before the timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child is not terminated by a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/manager requires the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

let g_bNativeClassLookupCalled = false;
let g_bNativeNameLookupCalled = false;
let g_bNativeCurrentLookupCalled = false;

for (const vecNativeCall of g_vecNativeCallLog) {
	const strNativeCallName = vecNativeCall[0];
	const NativeCallValue = vecNativeCall[1];

	if ((strNativeCallName === "byClassName") && (NativeCallValue === "weapon_rifle")) {
		g_bNativeClassLookupCalled = true;
	}

	if ((strNativeCallName === "byName") && (NativeCallValue === "rifle")) {
		g_bNativeNameLookupCalled = true;
	}

	if ((strNativeCallName === "current") && (NativeCallValue === 1)) {
		g_bNativeCurrentLookupCalled = true;
	}
}

g_Assert.equal(g_bNativeClassLookupCalled, true, "native class lookup is called");
g_Assert.equal(g_bNativeNameLookupCalled, true, "native name lookup is called");
g_Assert.equal(g_bNativeCurrentLookupCalled, true, "native current lookup is called");

console.log("[  OK  ] smoke_weapons_manager");
