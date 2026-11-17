#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-data.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDataPath = g_Path.join(g_strPackageRootPath, "weapons", "data.js");
const g_strFileSystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strGlobalsPath = g_Path.join(g_strPackageRootPath, "globals.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");
const g_strScriptsPath = g_Path.join(g_strPackageRootPath, "weapons", "scripts.js");
const g_strRuntimeRootPath = g_Path.join(g_strRepositoryRootPath, "packaging", "runtime");
const g_strSourceDataRootPath = g_Path.join(g_strRuntimeRootPath, "addons", "sourcejs", "data", "sourcejs").replace(/\\/g, "/");
const g_LegacySchemaKeyPattern = /^\s*(?:ammoprop|myweapons|maxammo|secondary_fire_ammoprop|secondary_fire_maxammo)\s*=/m;
const g_vecExpectedBranches = [
	"blade",
	"bms",
	"csgo",
	"css",
	"dods",
	"gmod",
	"hl2dm",
	"l4d2",
	"tf2",
];
const g_vecExpectedExports = [
	"SUPPORTED_BRANCHES",
	"ClearCache",
	"FormatName",
	"Get",
	"GetAll",
	"GetClasses",
	"GetDataPath",
	"GetNames",
	"GetProjectiles",
	"GetProperties",
	"GetSpecialNames",
	"GetTags",
	"Has",
	"Load",
	"ParseConfigurationObject",
	"ParseWeaponINI",
];
const g_vecExpectedWeaponRecordFields = [
	"AmmoProperty",
	"BaseName",
	"ClassName",
	"Classes",
	"Clip",
	"Cost",
	"Data",
	"ID",
	"ItemDefinitionIndex",
	"MaximumAmmo",
	"Name",
	"Names",
	"ParentClass",
	"Script",
	"SecondaryAmmoProperty",
	"SecondaryMaximumAmmo",
	"Slot",
	"Tags",
	"Type",
];
const g_vecExpectedWeaponSummaryFields = [
	"AmmoProperty",
	"BaseName",
	"ClassName",
	"Classes",
	"Clip",
	"Cost",
	"Data",
	"ID",
	"ItemDefinitionIndex",
	"MaximumAmmo",
	"Name",
	"Names",
	"ParentClass",
	"SecondaryAmmoProperty",
	"SecondaryMaximumAmmo",
	"Slot",
	"Tags",
	"Type",
];

const g_mapWeaponScriptRecords = new Map();

let g_unFileSystemOperationCount = 0;
let g_unWeaponScriptLoadCount = 0;

const g_FileSystemDependency = {
	DoesFileExist(strFilePath) {
		g_unFileSystemOperationCount += 1;

		return g_FileSystem.existsSync(strFilePath);
	},

	ReadTextFile(strFilePath) {
		g_unFileSystemOperationCount += 1;

		return g_FileSystem.readFileSync(strFilePath, "utf8");
	},
};
const g_GlobalsDependency = {
	GetGlobalVariables() {
		return { SDKBranch: "tf2" };
	},
};
const g_PathsDependency = { SOURCE_DATA_ROOT: g_strSourceDataRootPath };
const g_ScriptsDependency = {
	Load(strClassName) {
		g_unWeaponScriptLoadCount += 1;

		if (!g_mapWeaponScriptRecords.has(strClassName)) {
			g_mapWeaponScriptRecords.set(strClassName, { ClassName: strClassName, KeyValues: { ClassName: strClassName }, Name: strClassName.slice(7), Path: `game/scripts/${strClassName}.txt` });
		}

		return g_mapWeaponScriptRecords.get(strClassName);
	},
};

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

function LoadTestAPI() {
	const ResolverDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_resolveFilename");
	const OriginalResolveFilename = ResolverDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/data package cache must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons/data resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/data cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/data fixture property must be removable: " + strKey);
	};

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

		InstallDependency(g_strFileSystemPath, g_FileSystemDependency);
		InstallDependency(g_strGlobalsPath, g_GlobalsDependency);
		InstallDependency(g_strPathsPath, g_PathsDependency);
		InstallDependency(g_strScriptsPath, g_ScriptsDependency);

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "filesystem") {
					return g_strFileSystemPath;
				}

				if (strRequest === "globals") {
					return g_strGlobalsPath;
				}

				if (strRequest === "paths") {
					return g_strPathsPath;
				}

				if (strRequest === "weapons/scripts") {
					return g_strScriptsPath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		Result = require(g_strDataPath);
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

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Weapons/data fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function CheckPathRoots() {
	const strOriginalRoot = g_PathsDependency.SOURCE_DATA_ROOT;
	const unOriginalFileSystemCount = g_unFileSystemOperationCount;
	const vecPathCases = [
		{ Root: String.raw`\\SourceJSFixtureServer\FixtureShare\addons\sourcejs\data\sourcejs`, Expected: "//SourceJSFixtureServer/FixtureShare/addons/sourcejs/data/sourcejs/weapons/tf2.ini" },
		{ Root: "//SourceJSFixtureServer/FixtureShare/addons//sourcejs/data/sourcejs/", Expected: "//SourceJSFixtureServer/FixtureShare/addons/sourcejs/data/sourcejs/weapons/tf2.ini" },
		{ Root: "c:/game//addons/sourcejs/data/sourcejs", Expected: "c:/game/addons/sourcejs/data/sourcejs/weapons/tf2.ini" },
		{ Root: "/game//addons/sourcejs/data/sourcejs", Expected: "/game/addons/sourcejs/data/sourcejs/weapons/tf2.ini" },
	];

	try {
		for (const PathCase of vecPathCases) {
			g_PathsDependency.SOURCE_DATA_ROOT = PathCase.Root;
			const WeaponDataAPI = LoadTestAPI();
			g_Assert.equal(WeaponDataAPI.GetDataPath("tf2"), PathCase.Expected, "native root prefix and normalized data path");
		}
	} finally {
		g_PathsDependency.SOURCE_DATA_ROOT = strOriginalRoot;
	}

	g_Assert.equal(g_unFileSystemOperationCount, unOriginalFileSystemCount, "root normalization performs no filesystem IO");
}

function CheckEmptyMappedNames(WeaponDataAPI) {
	const Profile = WeaponDataAPI.Load("l4d2");
	const OriginalSpecialNames = Profile.SpecialNames;
	const OriginalProjectiles = Profile.Projectiles;
	try {
		Profile.SpecialNames = Object.assign(Object.create(null), { empty_alias: "", redirected_alias: "empty_projectile" });
		Profile.Projectiles = Object.assign(Object.create(null), { empty_projectile: "" });
		g_Assert.equal(WeaponDataAPI.FormatName(" EMPTY_ALIAS ", "l4d2"), "", "empty special-name mapping does not receive a class prefix");
		g_Assert.equal(WeaponDataAPI.FormatName("redirected_alias", "l4d2"), "", "empty projectile mapping does not receive a class prefix");
		g_Assert.throws(() => WeaponDataAPI.FormatName(" \t", "l4d2"), /Weapon name must not be empty/, "empty caller input still fails before mapping");

		Profile.Projectiles[""] = "rifle_ak47";
		g_Assert.equal(WeaponDataAPI.FormatName("empty_alias", "l4d2"), "weapon_rifle_ak47", "projectiles can redirect an empty intermediate special-name result");
	} finally {
		Profile.SpecialNames = OriginalSpecialNames;
		Profile.Projectiles = OriginalProjectiles;
	}

	g_Assert.equal(Profile.SpecialNames, OriginalSpecialNames, "special-name mapping identity is restored");
	g_Assert.equal(Profile.Projectiles, OriginalProjectiles, "projectile mapping identity is restored");
}

CheckPathRoots();

const g_WeaponDataAPI = LoadTestAPI();
g_Assert.deepEqual(Object.keys(g_WeaponDataAPI).sort(), g_vecExpectedExports.sort(), "exact weapons/data exports");
g_Assert.deepEqual(g_WeaponDataAPI.SUPPORTED_BRANCHES, g_vecExpectedBranches, "supported profile branches");
g_Assert.equal(Object.isFrozen(g_WeaponDataAPI.SUPPORTED_BRANCHES), true, "supported branch array is frozen");

for (const strBranch of g_vecExpectedBranches) {
	g_Assert.equal(g_WeaponDataAPI.Has(strBranch), true, `packaged ${strBranch} profile`);
	g_Assert.equal(g_WeaponDataAPI.GetDataPath(strBranch).endsWith(`/weapons/${strBranch}.ini`), true, `${strBranch} profile path`);

	const Profile = g_WeaponDataAPI.Load(strBranch);
	const strProfileSource = g_FileSystem.readFileSync(g_WeaponDataAPI.GetDataPath(strBranch), "utf8");

	g_Assert.equal(Profile.Branch, strBranch, `${strBranch} profile identity`);
	g_Assert.equal(Profile.Path, g_WeaponDataAPI.GetDataPath(strBranch), `${strBranch} loaded path`);
	g_Assert.equal(Array.isArray(Profile.Weapons), true, `${strBranch} weapon records`);
	g_Assert.equal(Array.isArray(Profile.Tags), true, `${strBranch} tag records`);
	g_Assert.doesNotMatch(strProfileSource, g_LegacySchemaKeyPattern, `${strBranch} profile has no legacy schema keys`);
}

g_Assert.equal(g_WeaponDataAPI.Has("teamfortress2"), false, "alternative branch spelling does not resolve");
g_Assert.equal(g_WeaponDataAPI.Has("portal2"), false, "missing Portal 2 profile");
g_Assert.throws(function LoadMissingProfile() {
	g_WeaponDataAPI.Load("portal2");
}, /unavailable for SDK branch "portal2"/, "missing profile throws");
g_Assert.throws(function LoadEmptyBranch() {
	g_WeaponDataAPI.Load("");
}, /must not be empty/, "empty branch throws");
g_Assert.throws(function LoadNonStringBranch() {
	g_WeaponDataAPI.Load(7);
}, /must be a string/, "non-string branch throws");
g_Assert.throws(function BuildTraversalPath() {
	g_WeaponDataAPI.GetDataPath("../tf2");
}, /only letters, digits or underscores/, "branch traversal throws before path construction");
g_Assert.equal(g_WeaponDataAPI.FormatName("rocket", "tf2"), "tf_weapon_rocket", "TF2 class prefix");
g_Assert.equal(g_WeaponDataAPI.FormatName("ak47", "csgo"), "weapon_ak47", "CSGO class prefix");
CheckEmptyMappedNames(g_WeaponDataAPI);

g_Assert.equal(g_WeaponDataAPI.Get("ak47", "csgo").ID, "AK47", "string SDK weapon ID");
g_Assert.equal(g_WeaponDataAPI.Get("ak47", "csgo").ItemDefinitionIndex, null, "string ID is not an item index");
g_Assert.equal(g_WeaponDataAPI.Get("rifle_ak47", "l4d2").Clip, 40, "L4D2 weapon lookup");
g_Assert.equal(g_WeaponDataAPI.Get("missing", "l4d2"), null, "missing weapon lookup");
g_Assert.equal(g_WeaponDataAPI.GetProperties().Prefix, "tf_weapon_", "active branch profile");

const g_CSGOAWP = g_WeaponDataAPI.Get("awp", "csgo");
const g_CSGOBizon = g_WeaponDataAPI.Get("bizon", "csgo");
const g_CSGOHealthshot = g_WeaponDataAPI.Get("healthshot", "csgo");
const g_CSGOTablet = g_WeaponDataAPI.Get("tablet", "csgo");
const g_CSGOZoneRepulsor = g_WeaponDataAPI.Get("zone_repulsor", "csgo");

g_Assert.equal(g_WeaponDataAPI.GetProperties("csgo").AmmoProperty, "m_iAmmo.", "CSGO canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("csgo").MyWeaponsProperty, "m_hMyWeapons.", "CSGO canonical weapon-handle property");
g_Assert.equal(g_CSGOAWP.MaximumAmmo, 30, "CSGO canonical maximum ammo");
g_Assert.equal(g_CSGOAWP.AmmoProperty, 6, "CSGO canonical weapon ammo property");
g_Assert.equal(Object.hasOwn(g_CSGOAWP.Data, "ammoprop"), false, "CSGO legacy ammo-property key must be absent");
g_Assert.equal(Object.hasOwn(g_CSGOAWP.Data, "maxammo"), false, "CSGO legacy maximum-ammo key must be absent");
g_Assert.equal(g_CSGOAWP.Type, "SNIPER_RIFLE", "CSGO AWP uses the canonical sniper-rifle type");
g_Assert.equal(g_CSGOBizon.Type, "SUBMACHINEGUN", "CSGO Bizon uses the canonical submachine-gun type");
g_Assert.equal(g_CSGOHealthshot.Slot, "BOOST", "CSGO healthshot uses the canonical boost slot");
g_Assert.equal(g_CSGOTablet.Slot, "UTILITY", "CSGO tablet uses the canonical utility slot");
g_Assert.equal(g_CSGOZoneRepulsor.Type, "ZONE_REPULSOR", "CSGO zone repulsor uses the canonical weapon type");

const g_ScriptDescriptor = Object.getOwnPropertyDescriptor(g_CSGOAWP, "Script");
const g_unScriptLoadCountBeforeAccess = g_unWeaponScriptLoadCount;

g_Assert.equal(typeof g_ScriptDescriptor.get, "function", "weapon script is exposed by a getter");
g_Assert.equal(g_ScriptDescriptor.value, undefined, "weapon script is not a placeholder data value");

const g_CSGOAWPScript = g_CSGOAWP.Script;
g_Assert.equal(g_unWeaponScriptLoadCount, g_unScriptLoadCountBeforeAccess + 1, "weapon script getter is lazy");
g_Assert.equal(g_CSGOAWPScript.ClassName, g_CSGOAWP.ClassName, "weapon script class name");
g_Assert.equal(g_CSGOAWPScript.Name, g_CSGOAWP.Name, "weapon script short name");
g_Assert.equal(g_CSGOAWPScript.KeyValues.ClassName, g_CSGOAWP.ClassName, "weapon script KeyValues fixture");
g_Assert.strictEqual(g_CSGOAWP.Script, g_CSGOAWPScript, "weapon script cache identity");

{
	const strOriginalClassName = g_CSGOAWP.ClassName;

	try {
		g_CSGOAWP.ClassName = "weapon_metadata_probe";
		g_Assert.strictEqual(g_CSGOAWP.Script, g_CSGOAWPScript, "script lookup retains the normalization-time class despite mutable metadata");
		g_Assert.equal(g_CSGOAWP.Script.ClassName, strOriginalClassName, "script identity uses the captured class name");
	} finally {
		g_CSGOAWP.ClassName = strOriginalClassName;
	}
}

const g_CSSAWP = g_WeaponDataAPI.Get("awp", "css");
const g_CSSMAC10 = g_WeaponDataAPI.Get("mac10", "css");

g_Assert.equal(g_WeaponDataAPI.GetProperties("css").AmmoProperty, "localdata.m_iAmmo.", "CSS canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("css").MyWeaponsProperty, "m_hMyWeapons.", "CSS canonical weapon-handle property");
g_Assert.equal(g_CSSAWP.MaximumAmmo, "ammo_338mag_max", "CSS canonical maximum ammo");
g_Assert.equal(g_CSSAWP.AmmoProperty, 5, "CSS canonical weapon ammo property");
g_Assert.equal(Object.hasOwn(g_CSSAWP.Data, "ammoprop"), false, "CSS legacy ammo-property key must be absent");
g_Assert.equal(Object.hasOwn(g_CSSAWP.Data, "maxammo"), false, "CSS legacy maximum-ammo key must be absent");
g_Assert.equal(g_CSSAWP.Type, "SNIPER_RIFLE", "CSS AWP uses the canonical sniper-rifle type");
g_Assert.equal(g_CSSMAC10.Type, "SUBMACHINEGUN", "CSS MAC10 uses the canonical submachine-gun type");

const g_DODSGarand = g_WeaponDataAPI.Get("garand", "dods");

g_Assert.equal(g_WeaponDataAPI.GetProperties("dods").AmmoProperty, "localdata.m_iAmmo.", "DODS canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("dods").MyWeaponsProperty, "m_hMyWeapons.", "DODS canonical weapon-handle property");
g_Assert.equal(g_DODSGarand.AmmoProperty, 4, "DODS canonical weapon ammo property");
g_Assert.equal(Object.hasOwn(g_DODSGarand.Data, "ammoprop"), false, "DODS legacy ammo-property key must be absent");

g_Assert.equal(g_WeaponDataAPI.GetProperties("gmod").AmmoProperty, "localdata.m_iAmmo.", "GMod canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("gmod").MyWeaponsProperty, "m_hMyWeapons.", "GMod canonical weapon-handle property");

const g_HL2DMAR2 = g_WeaponDataAPI.Get("ar2", "hl2dm");

g_Assert.equal(g_WeaponDataAPI.GetProperties("hl2dm").AmmoProperty, "localdata.m_iAmmo.", "HL2DM canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("hl2dm").MyWeaponsProperty, "m_hMyWeapons.", "HL2DM canonical weapon-handle property");
g_Assert.equal(g_HL2DMAR2.MaximumAmmo, 60, "HL2DM canonical maximum ammo");
g_Assert.equal(g_HL2DMAR2.AmmoProperty, 1, "HL2DM canonical weapon ammo property");
g_Assert.equal(g_HL2DMAR2.SecondaryMaximumAmmo, 3, "HL2DM canonical secondary maximum ammo");
g_Assert.equal(g_HL2DMAR2.SecondaryAmmoProperty, 2, "HL2DM canonical secondary ammo property");
g_Assert.equal(Object.hasOwn(g_HL2DMAR2.Data, "secondary_fire_maxammo"), false, "HL2DM legacy secondary maximum-ammo key must be absent");
g_Assert.equal(Object.hasOwn(g_HL2DMAR2.Data, "secondary_fire_ammoprop"), false, "HL2DM legacy secondary ammo-property key must be absent");

const g_L4D2AK47 = g_WeaponDataAPI.Get("rifle_ak47", "l4d2");
const g_L4D2M60 = g_WeaponDataAPI.Get("rifle_m60", "l4d2");

g_Assert.equal(g_WeaponDataAPI.GetProperties("l4d2").AmmoProperty, "localdata.m_iAmmo.", "L4D2 canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("l4d2").MyWeaponsProperty, "m_hMyWeapons.", "L4D2 canonical weapon-handle property");
g_Assert.equal(g_L4D2AK47.MaximumAmmo, 360, "L4D2 canonical maximum ammo");
g_Assert.equal(g_L4D2AK47.AmmoProperty, 3, "L4D2 canonical weapon ammo property");
g_Assert.equal(g_L4D2M60.MaximumAmmo, null, "L4D2 M60 has no reserve-ammo limit");
g_Assert.equal(g_L4D2M60.AmmoProperty, null, "L4D2 M60 has no reserve-ammo property");
g_Assert.equal(Object.hasOwn(g_L4D2M60.Data, "maximum_ammo"), false, "L4D2 M60 empty maximum-ammo field must be absent");
g_Assert.equal(Object.hasOwn(g_L4D2M60.Data, "ammo_property"), false, "L4D2 M60 empty ammo-property field must be absent");

g_Assert.equal(g_WeaponDataAPI.GetProperties("tf2").AmmoProperty, "localdata.m_iAmmo.", "TF2 canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("tf2").MyWeaponsProperty, "m_hMyWeapons.", "TF2 canonical weapon-handle property");

const g_BMSMP5 = g_WeaponDataAPI.Get("mp5", "bms");
const g_BMSGluon = g_WeaponDataAPI.Get("gluon", "bms");

g_Assert.equal(g_WeaponDataAPI.GetProperties("bms").AmmoProperty, "localdata.m_iAmmo.", "BMS canonical ammo property");
g_Assert.equal(g_WeaponDataAPI.GetProperties("bms").MyWeaponsProperty, "m_hMyWeapons.", "BMS canonical weapon-handle property");
g_Assert.equal(g_BMSMP5.MaximumAmmo, "sk_ammo_9mm_max", "BMS canonical maximum ammo");
g_Assert.equal(g_BMSMP5.SecondaryAmmoProperty, 6, "BMS canonical secondary ammo property");
g_Assert.equal(g_BMSMP5.SecondaryMaximumAmmo, "sk_ammo_grenade_mp5_max", "BMS canonical secondary maximum ammo");
g_Assert.equal(Object.hasOwn(g_BMSMP5.Data, "ammoprop"), false, "BMS legacy ammo-property key must be absent");
g_Assert.equal(Object.hasOwn(g_BMSMP5.Data, "maxammo"), false, "BMS legacy maximum-ammo key must be absent");
g_Assert.equal(Object.hasOwn(g_BMSMP5.Data, "secondary_fire_ammoprop"), false, "BMS legacy secondary ammo-property key must be absent");
g_Assert.equal(Object.hasOwn(g_BMSMP5.Data, "secondary_fire_maxammo"), false, "BMS legacy secondary maximum-ammo key must be absent");
g_Assert.equal(g_BMSGluon.Tags.includes("laser"), true, "BMS laser tag spelling");
g_Assert.equal(g_BMSGluon.Tags.includes("lazer"), false, "BMS misspelled laser tag must be absent");

const g_FirstL4D2Profile = g_WeaponDataAPI.Load("l4d2");
const g_SecondL4D2Profile = g_WeaponDataAPI.Load("L4D2");

g_Assert.equal(g_FirstL4D2Profile, g_SecondL4D2Profile, "normalized branch names share a cached object");
g_Assert.equal(g_WeaponDataAPI.GetAll("l4d2"), g_FirstL4D2Profile.Weapons, "all returns the live weapon array");
g_Assert.equal(g_WeaponDataAPI.GetTags("l4d2"), g_FirstL4D2Profile.Tags, "tags returns the live tag array");
g_Assert.equal(g_WeaponDataAPI.GetProperties("l4d2"), g_FirstL4D2Profile.Properties, "properties returns the live record");
g_Assert.equal(g_WeaponDataAPI.GetSpecialNames("l4d2"), g_FirstL4D2Profile.SpecialNames, "special names returns the live record");
g_Assert.equal(g_WeaponDataAPI.GetProjectiles("l4d2"), g_FirstL4D2Profile.Projectiles, "projectiles returns the live record");
g_Assert.notEqual(g_WeaponDataAPI.GetNames("l4d2"), g_WeaponDataAPI.GetNames("l4d2"), "names returns fresh arrays");
g_Assert.notEqual(g_WeaponDataAPI.GetClasses("l4d2"), g_WeaponDataAPI.GetClasses("l4d2"), "classes returns fresh arrays");
g_Assert.equal(g_WeaponDataAPI.GetNames("l4d2").length, g_FirstL4D2Profile.Weapons.length, "name count matches weapons");
g_Assert.equal(g_WeaponDataAPI.GetClasses("l4d2").length, g_FirstL4D2Profile.Weapons.length, "class count matches weapons");

{
	const strOriginalL4D2Prefix = g_FirstL4D2Profile.Properties.Prefix;
	try {
		g_FirstL4D2Profile.Properties.Prefix = "custom_";
		g_Assert.equal(g_WeaponDataAPI.GetProperties("l4d2").Prefix, "custom_", "profile writes remain live");
		g_Assert.equal(g_WeaponDataAPI.ClearCache(), true, "ClearCache result");

		const ReloadedL4D2Profile = g_WeaponDataAPI.Load("l4d2");
		g_Assert.notEqual(ReloadedL4D2Profile, g_FirstL4D2Profile, "ClearCache releases the cached profile");
		g_Assert.equal(ReloadedL4D2Profile.Properties.Prefix, strOriginalL4D2Prefix, "ClearCache reparses disk state");
	} finally {
		g_FirstL4D2Profile.Properties.Prefix = strOriginalL4D2Prefix;
	}
}

const g_RawConfiguration = g_WeaponDataAPI.ParseConfigurationObject(`
[properties]
prefix = "weapon_"
description = "hash # remains text" # comment

[weapons]
[[__proto__]]
__proto__ = "safe"
clip = 12
weight = 1.5
`);
g_Assert.equal(Object.getPrototypeOf(g_RawConfiguration), null, "raw root has no prototype");
g_Assert.equal(Object.getPrototypeOf(g_RawConfiguration.properties), null, "raw section has no prototype");
g_Assert.equal(Object.getPrototypeOf(g_RawConfiguration.weapons.__proto__), null, "raw nested section has no prototype");
g_Assert.equal(Object.hasOwn(g_RawConfiguration.weapons, "__proto__"), true, "nested __proto__ is an own key");
g_Assert.equal(Object.hasOwn(g_RawConfiguration.weapons.__proto__, "__proto__"), true, "value __proto__ is an own key");
g_Assert.equal(g_RawConfiguration.weapons.__proto__.__proto__, "safe", "prototype-like value is preserved");
g_Assert.equal(g_RawConfiguration.weapons.__proto__.clip, 12, "integer scalar parsing");
g_Assert.equal(g_RawConfiguration.weapons.__proto__.weight, 1.5, "float scalar parsing");
g_Assert.equal(g_RawConfiguration.properties.description, "hash # remains text", "quoted hash parsing");

{
	const strCSGOProfileText = g_FileSystem.readFileSync(g_Path.join(g_strSourceDataRootPath, "weapons", "csgo.ini"), "utf8");
	g_Assert.ok(!strCSGOProfileText.includes("\r\n") || !strCSGOProfileText.replaceAll("\r\n", "").includes("\n"), "CSGO weapon profile line endings must be consistent");
	const CSGOProfile = g_WeaponDataAPI.ParseWeaponINI(strCSGOProfileText);
	const SilencedRifle = CSGOProfile.Weapons.find(Weapon => Weapon.ClassName === "weapon_m4a1_silencer");
	g_Assert.ok(SilencedRifle, "CSGO must retain the silenced M4A1 record");
	g_Assert.equal(SilencedRifle.Slot, "PRIMARY", "silenced M4A1 is in the primary slot");
	g_Assert.equal(SilencedRifle.Type, "RIFLE", "silenced M4A1 remains a rifle");
	g_Assert.ok(SilencedRifle.Tags.includes("primary"), "silenced M4A1 must match primary-weapon tag queries");
	g_Assert.ok(!SilencedRifle.Tags.includes("secondary"), "silenced M4A1 must not match secondary-weapon tag queries");
}

const g_ParsedWeaponData = g_WeaponDataAPI.ParseWeaponINI(`
[properties]
prefix = "weapon_"
ammo_property = "m_iAmmo."
my_weapons_property = "m_hMyWeapons."

[weapons]
[[test]]
id = 12
maximum_ammo = 42
ammo_property = 6
secondary_fire_ammo_property = 7
secondary_fire_maximum_ammo = 21
tags = "all,test,all"
`);
const g_ParsedWeapon = g_ParsedWeaponData.Weapons[0];
g_Assert.equal(g_ParsedWeapon.ClassName, "weapon_test", "normalized class name");
g_Assert.equal(g_ParsedWeapon.ItemDefinitionIndex, 12, "numeric item definition index");
g_Assert.equal(g_ParsedWeapon.MaximumAmmo, 42, "maximum ammo");
g_Assert.equal(g_ParsedWeapon.AmmoProperty, 6, "ammo property");
g_Assert.equal(g_ParsedWeapon.SecondaryAmmoProperty, 7, "secondary ammo property");
g_Assert.equal(g_ParsedWeapon.SecondaryMaximumAmmo, 21, "secondary maximum ammo");
g_Assert.deepEqual(g_ParsedWeapon.Tags, ["all", "test"], "weapon tags are unique");
g_Assert.deepEqual(Object.keys(g_ParsedWeapon).sort(), g_vecExpectedWeaponRecordFields, "exact normalized weapon-record fields");
g_Assert.deepEqual(g_ParsedWeaponData.Tags, ["all", "test"], "profile tags are unique");
g_Assert.equal(Object.getPrototypeOf(g_ParsedWeaponData.Projectiles), null, "missing projectiles use a null-prototype record");
g_Assert.equal(Object.getPrototypeOf(g_ParsedWeaponData.SpecialNames), null, "missing special names use a null-prototype record");
g_Assert.throws(function ParseMalformedLine() {
	g_WeaponDataAPI.ParseConfigurationObject("[properties]\ninvalid");
}, /must contain "="/, "malformed lines throw");
g_Assert.throws(function ParseDuplicateKeys() {
	g_WeaponDataAPI.ParseConfigurationObject("[properties]\nprefix=x\nprefix=y");
}, /Duplicate weapon data key/, "duplicate keys throw");
g_Assert.throws(function ParseUnterminatedQuote() {
	g_WeaponDataAPI.ParseConfigurationObject("[properties]\nprefix=\"broken");
}, /unterminated quoted value/, "unterminated quotes throw");
g_Assert.throws(function NormalizeMissingWeaponSection() {
	g_WeaponDataAPI.ParseWeaponINI("[properties]\nprefix=weapon_");
}, /requires a \[weapons] section/, "missing required section throws");

for (const strForbiddenExport of ["moduleName", "supportedBranches", "parseConfigObject", "parseWeaponIni", "default"]) {
	g_Assert.equal(Object.hasOwn(g_WeaponDataAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentation, /If the final mapped name is empty, it returns `""` without adding a prefix/, "documentation distinguishes empty mapped names from invalid empty caller input");
g_Assert.match(g_strDocumentation, /tag-deduplication searches can take quadratic time/, "documentation does not promise linear normalization cost");

const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
const g_unExpectedDocumentationExampleCount = 7;
const g_unDocumentationExampleTimeoutMilliseconds = 1000;
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch !== null) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

let g_unDocumentationGlobalVariablesQueryCount = 0;

function RequireDocumentationModule(strIdentifier) {
	if (strIdentifier === "weapons/data") {
		return g_WeaponDataAPI;
	}

	if (strIdentifier === "globals") {
		return {
			GetGlobalVariables() {
				g_unDocumentationGlobalVariablesQueryCount += 1;

				return { SDKBranch: "tf2" };
			},
		};
	}

	throw new Error(`Unexpected documentation import: ${strIdentifier}`);
}

function RunDocumentationBlock(strCode, unBlockIndex) {
	const strBlockName = `documentation block ${unBlockIndex + 1}`;
	const Context = g_VM.createContext({ require: RequireDocumentationModule });
	const unFileSystemOperationsBefore = g_unFileSystemOperationCount;
	const unGlobalVariablesQueriesBefore = g_unDocumentationGlobalVariablesQueryCount;

	g_VM.runInContext(strCode, Context, { filename: `${g_strDocumentationPath}#example-${unBlockIndex + 1}`, timeout: g_unDocumentationExampleTimeoutMilliseconds });

	g_Assert.equal(g_unFileSystemOperationCount, unFileSystemOperationsBefore, `${strBlockName} performs no filesystem work while loading`);
	g_Assert.equal(g_unDocumentationGlobalVariablesQueryCount, unGlobalVariablesQueriesBefore, `${strBlockName} performs no globals query while loading`);

	return Context;
}

g_Assert.equal(g_vecCodeBlocks.length, g_unExpectedDocumentationExampleCount, "all weapons/data documentation JavaScript blocks are present");

const g_vecContexts = [];
for (let unBlockIndex = 0; unBlockIndex < g_vecCodeBlocks.length; unBlockIndex += 1) {
	g_vecContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unBlockIndex], unBlockIndex));
}

const g_DefaultPackagedProfile = g_vecContexts[1].RequirePackagedWeaponProfile();
g_Assert.equal(g_DefaultPackagedProfile.Branch, "tf2", "packaged-profile workflow reads the current branch on invocation");
g_Assert.equal(g_DefaultPackagedProfile.Path.endsWith("/weapons/tf2.ini"), true, "packaged-profile workflow returns the exact current path");
g_Assert.equal(g_DefaultPackagedProfile.Profile.Branch, "tf2", "packaged-profile workflow loads the current profile");

const g_ExplicitPackagedProfile = g_vecContexts[1].RequirePackagedWeaponProfile(" L4D2 ");
g_Assert.equal(g_ExplicitPackagedProfile.Branch, "l4d2", "packaged-profile workflow normalizes an explicit branch");
g_Assert.equal(g_ExplicitPackagedProfile.Path.endsWith("/weapons/l4d2.ini"), true, "packaged-profile workflow returns an explicit path");
g_Assert.equal(g_ExplicitPackagedProfile.Profile, g_WeaponDataAPI.Load("l4d2"), "packaged-profile workflow returns the cached identity");
g_Assert.throws(function RequireUnsupportedPackagedProfile() {
	g_vecContexts[1].RequirePackagedWeaponProfile("portal2");
}, /not packaged for portal2/, "packaged-profile workflow rejects an unsupported branch");
g_Assert.throws(function RequireEmptyPackagedProfile() {
	g_vecContexts[1].RequirePackagedWeaponProfile(" ");
}, /must not be empty/, "packaged-profile workflow rejects an empty branch");
g_Assert.throws(function RequireNonStringPackagedProfile() {
	g_vecContexts[1].RequirePackagedWeaponProfile(7);
}, /must be a string/, "packaged-profile workflow rejects a non-string branch");

const g_RefreshedProfiles = g_vecContexts[2].RefreshWeaponProfiles("l4d2");
g_Assert.equal(g_RefreshedProfiles.PreviousProfile.Branch, "l4d2", "refresh workflow returns the previous profile");
g_Assert.equal(g_RefreshedProfiles.CurrentProfile.Branch, "l4d2", "refresh workflow returns the current profile");
g_Assert.equal(g_RefreshedProfiles.IdentityChanged, true, "refresh workflow proves cache identity replacement");
g_Assert.notEqual(g_RefreshedProfiles.CurrentProfile, g_RefreshedProfiles.PreviousProfile, "refresh workflow retains distinct identities");
g_Assert.equal(g_RefreshedProfiles.CurrentProfile, g_WeaponDataAPI.Load("l4d2"), "refresh workflow installs the current cached identity");

const g_Catalog = g_vecContexts[3].BuildLiveWeaponCatalog("l4d2");
const g_CatalogAK47 = g_Catalog.MapWeaponsByClassName.get("weapon_rifle_ak47");

g_Assert.equal(g_Catalog.Weapons, g_WeaponDataAPI.GetAll("l4d2"), "catalog workflow retains the live weapon array");
g_Assert.equal(g_Catalog.Tags, g_WeaponDataAPI.GetTags("l4d2"), "catalog workflow retains the live tag array");
g_Assert.equal(g_Catalog.Properties, g_WeaponDataAPI.GetProperties("l4d2"), "catalog workflow retains the live property record");
g_Assert.equal(g_Catalog.SpecialNames, g_WeaponDataAPI.GetSpecialNames("l4d2"), "catalog retains the live special-name record");
g_Assert.equal(g_Catalog.Projectiles, g_WeaponDataAPI.GetProjectiles("l4d2"), "catalog workflow retains the live projectile record");
g_Assert.deepEqual(g_Catalog.Names, g_WeaponDataAPI.GetNames("l4d2"), "catalog derives current names");
g_Assert.deepEqual(g_Catalog.ClassNames, g_WeaponDataAPI.GetClasses("l4d2"), "catalog derives current classes");
g_Assert.equal(g_CatalogAK47, g_WeaponDataAPI.Get("rifle_ak47", "l4d2"), "catalog map points to a live weapon record");

const g_ResolvedWeapon = g_vecContexts[4].ResolveWeaponMetadata("rifle_ak47", "l4d2");
const g_LiveResolvedWeapon = g_WeaponDataAPI.Get("rifle_ak47", "l4d2");

g_Assert.equal(g_ResolvedWeapon.ClassName, "weapon_rifle_ak47", "lookup workflow formats the weapon class");
g_Assert.notEqual(g_ResolvedWeapon.Weapon, g_LiveResolvedWeapon, "lookup workflow returns a detached record summary");
g_Assert.deepEqual(Object.keys(g_ResolvedWeapon.Weapon).sort(), g_vecExpectedWeaponSummaryFields, "lookup summary fields");
g_Assert.equal(Object.hasOwn(g_ResolvedWeapon.Weapon, "Script"), false, "lookup summary omits the live weapon script");
g_Assert.notEqual(g_ResolvedWeapon.Weapon.Classes, g_LiveResolvedWeapon.Classes, "lookup workflow copies classes");
g_Assert.notEqual(g_ResolvedWeapon.Weapon.Names, g_LiveResolvedWeapon.Names, "lookup workflow copies names");
g_Assert.notEqual(g_ResolvedWeapon.Weapon.Tags, g_LiveResolvedWeapon.Tags, "lookup workflow copies tags");
g_Assert.notEqual(g_ResolvedWeapon.Weapon.Data, g_LiveResolvedWeapon.Data, "lookup workflow copies raw data");
g_Assert.equal(g_ResolvedWeapon.Weapon.Clip, 40, "lookup workflow preserves scalar metadata");

const g_SharedSummaryValue = { Value: 7 };
const g_CustomSummarySource = Object.create(g_LiveResolvedWeapon);
g_CustomSummarySource.MaximumAmmo = g_SharedSummaryValue;
g_CustomSummarySource.Data = Object.assign(Object.create(null), g_LiveResolvedWeapon.Data, { CustomValue: g_SharedSummaryValue });

const g_ShallowWeaponSummary = g_vecContexts[4].CreateWeaponRecordSummary(g_CustomSummarySource);
g_Assert.equal(g_ShallowWeaponSummary.MaximumAmmo, g_SharedSummaryValue, "summary does not recursively clone object-valued metadata");
g_Assert.equal(g_ShallowWeaponSummary.Data.CustomValue, g_SharedSummaryValue, "summary does not recursively clone raw data values");
g_Assert.notEqual(g_ShallowWeaponSummary.Data, g_CustomSummarySource.Data, "summary still copies the outer raw data record");
g_Assert.equal(Object.getPrototypeOf(g_ShallowWeaponSummary.Data), null, "summary preserves a null-prototype raw data record");
g_Assert.match(g_strDocumentation, /not a recursive\s+clone/, "documentation states the shallow summary contract");
g_Assert.match(g_strDocumentation, /those nested objects remain shared/, "documentation warns about shared object-valued metadata");

const g_NonStringPropertyProfile = g_WeaponDataAPI.ParseWeaponINI("[properties]\nprefix = 7\nammo_property = 8\nmy_weapons_property = 9\n[weapons]");
g_Assert.equal(g_NonStringPropertyProfile.Properties.Prefix, 7, "normalization passes through a non-string prefix");
g_Assert.equal(g_NonStringPropertyProfile.Properties.AmmoProperty, 8, "normalization passes through a non-string ammo property");
g_Assert.equal(g_NonStringPropertyProfile.Properties.MyWeaponsProperty, 9, "normalization passes through a non-string weapons property");

const g_NonRecordMappingProfile = g_WeaponDataAPI.ParseWeaponINI("projectiles = 7\nspecial names = 8\n[properties]\n[weapons]");
g_Assert.equal(g_NonRecordMappingProfile.Projectiles, 7, "normalization passes through a non-record projectile mapping");
g_Assert.equal(g_NonRecordMappingProfile.SpecialNames, 8, "normalization passes through a non-record special-name mapping");
g_Assert.match(g_strDocumentation, /not type-checked by normalization/, "documentation does not claim complete profile validation");

const g_MissingWeapon = g_vecContexts[4].ResolveWeaponMetadata("missing", "l4d2");
g_Assert.equal(g_MissingWeapon.ClassName, "weapon_missing", "lookup workflow formats a missing class");
g_Assert.equal(g_MissingWeapon.Weapon, null, "lookup workflow preserves a missing result");

const g_RawProfile = g_vecContexts[5].ParseRawWeaponConfiguration();
g_Assert.equal(Object.getPrototypeOf(g_RawProfile.Configuration), null, "raw-parser workflow preserves the null-prototype root");
g_Assert.deepEqual(Object.keys(g_RawProfile.Configuration).sort(), ["Properties", "Weapons"], "raw-parser workflow preserves exact section names");
g_Assert.equal(g_RawProfile.Configuration.Properties.Description, "hash # remains data", "raw-parser workflow preserves quoted hashes");
g_Assert.equal(g_RawProfile.Configuration.Weapons.SampleWeapon.Clip, 12, "raw-parser workflow parses integers");
g_Assert.equal(g_RawProfile.Configuration.Weapons.SampleWeapon.Weight, 1.5, "raw-parser workflow parses decimals");
g_Assert.deepEqual(Array.from(g_RawProfile.WeaponNames), ["SampleWeapon"], "raw-parser workflow returns nested record names");
g_Assert.equal(Object.hasOwn(g_RawProfile.Configuration.Properties, "description"), false, "raw-parser workflow does not introduce lowercase property aliases");
g_Assert.equal(Object.hasOwn(g_RawProfile.Configuration.Weapons.SampleWeapon, "clip"), false, "raw-parser workflow does not introduce lowercase weapon aliases");
g_Assert.throws(function ParseRawProfileWithoutRequiredSections() {
	g_vecContexts[5].ParseRawWeaponConfiguration("[other]\nvalue = 1");
}, /requires Properties and Weapons sections/, "raw-parser workflow validates caller-required sections");

const g_ParsedProfile = g_vecContexts[6].ParseWeaponProfileText();
const g_vecParsedProfileWeaponFields = Object.keys(g_ParsedProfile.Weapon).sort();

g_Assert.equal(g_ParsedProfile.SpecialName, "pistol", "profile-parser workflow preserves a special-name mapping");
g_Assert.equal(g_ParsedProfile.Projectile, "grenade_projectile", "profile-parser workflow preserves projectiles");
g_Assert.deepEqual(g_vecParsedProfileWeaponFields, g_vecExpectedWeaponRecordFields, "profile-parser workflow returns the exact weapon shape");
g_Assert.equal(g_ParsedProfile.Weapon.ClassName, "weapon_pistol", "profile-parser workflow normalizes the class name");
g_Assert.equal(g_ParsedProfile.Weapon.ItemDefinitionIndex, 7, "profile-parser workflow derives the numeric item index");
g_Assert.equal(g_ParsedProfile.Weapon.MaximumAmmo, "ammo_9mm_max", "profile-parser workflow preserves string ammo limits");
g_Assert.equal(g_ParsedProfile.Weapon.SecondaryAmmoProperty, 7, "profile-parser workflow preserves secondary ammo metadata");
g_Assert.equal(g_ParsedProfile.Weapon.SecondaryMaximumAmmo, 3, "profile-parser workflow preserves secondary ammo limits");
g_Assert.deepEqual(Array.from(g_ParsedProfile.Weapon.Tags), ["all", "secondary"], "profile-parser workflow deduplicates tags");
g_Assert.deepEqual(Array.from(g_ParsedProfile.Profile.Tags), ["all", "secondary"], "profile-parser workflow aggregates profile tags");
g_Assert.equal(Object.hasOwn(g_ParsedProfile.Profile, "Branch"), false, "profile-parser workflow does not invent a branch");
g_Assert.equal(Object.hasOwn(g_ParsedProfile.Profile, "Path"), false, "profile-parser workflow does not invent a path");

g_Assert.equal(g_ParsedProfile.Weapon, g_ParsedProfile.Profile.Weapons[0], "profile-parser wrapper references its profile's first live record");
g_Assert.equal(Object.hasOwn(g_ParsedProfile.Profile.SpecialNames, "sidearm"), false, "profile-parser workflow preserves case-sensitive special-name keys");
g_Assert.equal(Object.hasOwn(g_ParsedProfile.Profile.Projectiles, "grenade"), false, "profile-parser workflow preserves case-sensitive projectile keys");
g_Assert.match(g_strDocumentation, /Calling the parser does not cache that profile/, "documentation distinguishes parser ownership from Load cache ownership");
g_Assert.match(g_strDocumentation, /helpers lowercase lookup names/, "documentation distinguishes raw mapping spelling from lookup normalization");

const g_SecondParsedProfile = g_vecContexts[6].ParseWeaponProfileText();
g_Assert.notEqual(g_SecondParsedProfile.Profile, g_ParsedProfile.Profile, "each parser invocation owns a fresh profile");
g_Assert.notEqual(g_SecondParsedProfile.Weapon, g_ParsedProfile.Weapon, "each parser invocation owns fresh weapon records");
g_Assert.notEqual(g_SecondParsedProfile.Profile.SpecialNames, g_ParsedProfile.Profile.SpecialNames, "each parser invocation owns fresh special-name mappings");
g_Assert.notEqual(g_SecondParsedProfile.Profile.Projectiles, g_ParsedProfile.Profile.Projectiles, "each parser invocation owns fresh projectile mappings");

g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "weapons/data examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|Selected-SDK rule|const api =/, "weapons/data documentation is hand-maintained");

for (const strExportName of ["SUPPORTED_BRANCHES", "GetAll", "GetClasses", "ClearCache", "GetDataPath", "FormatName", "Get", "Has", "Load", "GetNames", "ParseConfigurationObject", "ParseWeaponINI", "GetProjectiles", "GetProperties", "GetSpecialNames", "GetTags"]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strFieldName of g_vecExpectedWeaponRecordFields) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strFieldName}\\b`), `documentation covers weapon.${strFieldName}`);
}

for (const strRelativeLink of ["weapons.md", "weapons-scripts.md", "globals.md", "paths.md", "filesystem.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

g_Assert.equal(g_WeaponDataAPI.ClearCache(), true, "final weapon cache cleanup succeeds");

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strDataPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntime.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntime.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntime.status, 1, "weapons/data requires the native runtime dependencies");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_data");
