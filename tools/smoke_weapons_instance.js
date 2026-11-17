#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-instance.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strCVarsPath = g_Path.join(g_strPackageRootPath, "cvars.js");
const g_strInstancePath = g_Path.join(g_strPackageRootPath, "weapons", "instance.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_vecForbiddenWeaponsInstanceExports = ["WeaponInstance", "Weapon", "weaponClass", "create", "byIndex", "moduleName", "default"];
const g_vecRelatedDocumentationLinks = ["weapons-data.md", "weapons-manager.md", "weapons-entity.md", "weapons-engines.md", "cvars.md"];
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unChildTimeoutMilliseconds = 5000;

const g_vecCVarReadLog = [];
const g_vecDataReadLog = [];
const g_mapCVarValues = new Map([
	["ammo_grenade_limit_default", 3],
	["ammo_grenade_limit_secondary", 2],
]);
const g_WeaponDataRecord = {
	AmmoProperty: 14,
	BaseName: "hegrenade",
	ClassName: "weapon_hegrenade",
	Clip: 1,
	Cost: 300,
	Data: { Source: "profile" },
	ID: "HEGRENADE",
	ItemDefinitionIndex: 44,
	MaximumAmmo: "ammo_grenade_limit_default",
	Name: "hegrenade",
	ParentClass: "grenade",
	Script: { Damage: 98 },
	SecondaryAmmoProperty: 15,
	SecondaryMaximumAmmo: "ammo_grenade_limit_secondary",
	Slot: "GRENADE",
	Tags: ["all", "grenade"],
	Type: "GRENADE",
};
const g_strInitialWeaponDataRecordJSON = JSON.stringify(g_WeaponDataRecord);

function InstallDependency(strDependencyPath, ModuleExports) {
	delete require.cache[strDependencyPath];
	require.cache[strDependencyPath] = { children: [], exports: ModuleExports, filename: strDependencyPath, id: strDependencyPath, loaded: true, paths: [] };
}

function LoadWeaponsInstanceAPI() {
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const strPackagePathPrefix = `${g_strPackageRootPath}${g_Path.sep}`;
	const mapOriginalPackageCache = new Map(Object.getOwnPropertyNames(require.cache).filter(strCachedPath => strCachedPath.startsWith(strPackagePathPrefix)).map(strCachedPath => [strCachedPath, Object.getOwnPropertyDescriptor(require.cache, strCachedPath)]));
	g_Assert.ok(LoaderDescriptor?.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/instance loader must support exact restoration.");
	g_Assert.ok(Object.isExtensible(require.cache) && Array.from(mapOriginalPackageCache.values()).every(Descriptor => Descriptor.configurable), "Weapons/instance package cache must support exact restoration.");

	function RestoreProperty(Target, strName, Descriptor) {
		if (Descriptor === undefined) {
			g_Assert.equal(Reflect.deleteProperty(Target, strName), true, `Owned weapons/instance fixture property must be removable: ${strName}`);
			return;
		}

		Object.defineProperty(Target, strName, Descriptor);
	}

	let bCacheOwned = false;
	let bLoaderOwned = false;
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

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		InstallDependency(g_strCVarsPath, {
			GetConVarInteger(strCVarName) {
				g_vecCVarReadLog.push(strCVarName);

				if (!g_mapCVarValues.has(strCVarName)) {
					throw new Error(`ConVar not found: ${strCVarName}`);
				}

				return g_mapCVarValues.get(strCVarName);
			},
		});

		Result = require(g_strInstancePath);
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

		throw new AggregateError(vecCleanupFailures, "Weapons/instance fixture cleanup failed.");
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, WeaponsInstanceAPI) {
	function RequireDocumentationModule(strModuleIdentifier) {
		if (strModuleIdentifier === "weapons/instance") {
			return WeaponsInstanceAPI;
		}

		if (strModuleIdentifier === "weapons/data") {
			return {
				GetAll(strSDKBranch) {
					g_vecDataReadLog.push({ Operation: "GetAll", SDKBranch: strSDKBranch });

					return [g_WeaponDataRecord];
				},

				Get(strWeaponName, strSDKBranch) {
					g_vecDataReadLog.push({ Operation: "Get", SDKBranch: strSDKBranch, WeaponName: strWeaponName });

					if ([g_WeaponDataRecord.Name, g_WeaponDataRecord.BaseName, g_WeaponDataRecord.ClassName].includes(strWeaponName)) {
						return g_WeaponDataRecord;
					}

					return null;
				},
			};
		}

		throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
	}

	const DocumentationModule = { exports: {} };
	g_VM.runInNewContext(strDocumentationCode, { module: DocumentationModule, require: RequireDocumentationModule }, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	return DocumentationModule.exports;
}

const g_WeaponsInstanceAPI = LoadWeaponsInstanceAPI();
g_Assert.deepEqual(Object.keys(g_WeaponsInstanceAPI), ["WeaponClass"], "exact weapons/instance exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_WeaponsInstanceAPI.WeaponClass.prototype).sort(), [
	"AmmoProperty",
	"BaseName",
	"ClassName",
	"Clip",
	"Cost",
	"constructor",
	"Data",
	"HasTag",
	"ID",
	"ItemDefinitionIndex",
	"MaximumAmmo",
	"Name",
	"ParentClass",
	"Record",
	"Script",
	"SecondaryAmmoProperty",
	"SecondaryMaximumAmmo",
	"Slot",
	"Tags",
	"Type",
].sort(), "exact WeaponClass prototype members");

const g_WeaponClass = new g_WeaponsInstanceAPI.WeaponClass(g_WeaponDataRecord);
g_Assert.equal(g_WeaponClass.Record, g_WeaponDataRecord, "canonical record identity");
g_Assert.equal(g_WeaponClass.ValueRecord, g_WeaponDataRecord, "constructor stores the exact record in ValueRecord");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_WeaponClass, "ValueRecord"), { value: g_WeaponDataRecord, writable: true, enumerable: true, configurable: true }, "ValueRecord is an ordinary own writable field");
g_Assert.equal(g_WeaponClass.AmmoProperty, 14, "ammo property");
g_Assert.equal(g_WeaponClass.BaseName, "hegrenade", "base name");
g_Assert.equal(g_WeaponClass.ClassName, "weapon_hegrenade", "class name");
g_Assert.equal(g_WeaponClass.Clip, 1, "clip");
g_Assert.equal(g_WeaponClass.Cost, 300, "cost");
g_Assert.equal(g_WeaponClass.Data, g_WeaponDataRecord.Data, "live data record");
g_Assert.equal(g_WeaponClass.ID, "HEGRENADE", "weapon identifier");
g_Assert.equal(g_WeaponClass.ItemDefinitionIndex, 44, "item definition index");
g_Assert.equal(g_WeaponClass.MaximumAmmo, 3, "ConVar-backed primary maximum ammo");
g_Assert.equal(g_WeaponClass.Name, "hegrenade", "weapon name");
g_Assert.equal(g_WeaponClass.ParentClass, "grenade", "parent class");
g_Assert.equal(g_WeaponClass.Script, g_WeaponDataRecord.Script, "live script record");
g_Assert.equal(g_WeaponClass.SecondaryAmmoProperty, 15, "secondary ammo property");
g_Assert.equal(g_WeaponClass.SecondaryMaximumAmmo, 2, "ConVar-backed secondary maximum ammo");
g_Assert.equal(g_WeaponClass.Slot, "GRENADE", "weapon slot");
g_Assert.equal(g_WeaponClass.Tags, g_WeaponDataRecord.Tags, "live tag array");
g_Assert.equal(g_WeaponClass.Type, "GRENADE", "weapon type");
g_Assert.equal(g_WeaponClass.HasTag("grenade"), true, "HasTag hit");
g_Assert.equal(g_WeaponClass.HasTag("Grenade"), false, "HasTag is case-sensitive");
g_Assert.deepEqual(g_vecCVarReadLog.slice(0, 2), ["ammo_grenade_limit_default", "ammo_grenade_limit_secondary"], "ammo ConVar names");

const g_RedirectedWeaponClass = new g_WeaponsInstanceAPI.WeaponClass(g_WeaponDataRecord);
const g_RedirectedWeaponRecord = { Clip: 7, MaximumAmmo: 8n, SecondaryMaximumAmmo: null, Tags: ["replacement"] };
const g_unCVarReadsBeforeRecordReplacement = g_vecCVarReadLog.length;
g_RedirectedWeaponClass.ValueRecord = g_RedirectedWeaponRecord;
g_Assert.equal(g_RedirectedWeaponClass.Record, g_RedirectedWeaponRecord, "Record follows a replacement ValueRecord");
g_Assert.equal(g_RedirectedWeaponClass.Clip, 7, "scalar getters follow the replacement backing record");
g_Assert.equal(g_RedirectedWeaponClass.HasTag("replacement"), true, "HasTag follows the replacement backing record");
g_Assert.equal(g_RedirectedWeaponClass.MaximumAmmo, 8n, "non-string ammo metadata is returned without coercion");
g_Assert.equal(g_RedirectedWeaponClass.SecondaryMaximumAmmo, null, "null ammo metadata is returned unchanged");
g_Assert.equal(g_vecCVarReadLog.length, g_unCVarReadsBeforeRecordReplacement, "record replacement and non-string limits perform no native CVar reads");
g_Assert.equal(g_WeaponClass.Record, g_WeaponDataRecord, "replacement does not redirect a separate wrapper");

const g_vecAmmoLimitSnapshotCases = [
	{ PropertyName: "MaximumAmmo", ConVarName: "ammo_grenade_limit_default" },
	{ PropertyName: "SecondaryMaximumAmmo", ConVarName: "ammo_grenade_limit_secondary" },
];
for (const AmmoLimitCase of g_vecAmmoLimitSnapshotCases) {
	for (const bConVarFirst of [false, true]) {
		let unMetadataReadCount = 0;
		const FirstValue = bConVarFirst ? AmmoLimitCase.ConVarName : 8n;
		const LaterValue = bConVarFirst ? 8n : AmmoLimitCase.ConVarName;
		const Record = {
			get [AmmoLimitCase.PropertyName]() {
				unMetadataReadCount += 1;
				return (unMetadataReadCount === 1) ? FirstValue : LaterValue;
			},
		};
		const WrappedWeapon = new g_WeaponsInstanceAPI.WeaponClass(Record);
		const ExpectedFirstValue = bConVarFirst ? g_mapCVarValues.get(AmmoLimitCase.ConVarName) : 8n;
		const ExpectedLaterValue = bConVarFirst ? 8n : g_mapCVarValues.get(AmmoLimitCase.ConVarName);
		const unCVarReadsBeforeSnapshot = g_vecCVarReadLog.length;
		g_Assert.equal(WrappedWeapon[AmmoLimitCase.PropertyName], ExpectedFirstValue, "ammo accessor uses the captured first value");
		g_Assert.equal(unMetadataReadCount, 1, "one ammo accessor read captures its backing field once");
		g_Assert.equal(g_vecCVarReadLog.length - unCVarReadsBeforeSnapshot, bConVarFirst ? 1 : 0, "the first captured type selects ConVar dispatch");
		g_Assert.equal(WrappedWeapon[AmmoLimitCase.PropertyName], ExpectedLaterValue, "a later ammo access observes the changed backing value");
		g_Assert.equal(unMetadataReadCount, 2, "separate ammo accesses do not cache the backing value");
		g_Assert.equal(g_vecCVarReadLog.length - unCVarReadsBeforeSnapshot, 1, "only the captured string value reads a ConVar");
	}
}

g_Assert.throws(function RejectRecordAccessorAssignment() {
	g_RedirectedWeaponClass.Record = g_WeaponDataRecord;
}, TypeError, "Record remains a getter without a setter");

g_RedirectedWeaponClass.ValueRecord = null;
g_Assert.equal(g_RedirectedWeaponClass.Record, null, "ValueRecord replacement is not revalidated");
g_Assert.throws(function ReadInvalidReplacementRecord() {
	return g_RedirectedWeaponClass.Clip;
}, TypeError, "invalid replacement fails when a member is read");

const g_unOriginalPrimaryAmmoLimit = g_mapCVarValues.get("ammo_grenade_limit_default");
try {
	g_mapCVarValues.set("ammo_grenade_limit_default", 4);
	g_Assert.equal(g_WeaponClass.MaximumAmmo, 4, "primary maximum ammo is read in realtime");
} finally {
	g_mapCVarValues.set("ammo_grenade_limit_default", g_unOriginalPrimaryAmmoLimit);
}

const g_ReplacementWeaponData = { Source: "replacement" };
const g_unOriginalClip = g_WeaponDataRecord.Clip;
const g_unOriginalTagCount = g_WeaponDataRecord.Tags.length;
const g_OriginalWeaponData = g_WeaponDataRecord.Data;
try {
	g_WeaponDataRecord.Clip = 2;
	g_WeaponDataRecord.Tags.push("explosive");
	g_WeaponDataRecord.Data = g_ReplacementWeaponData;
	g_Assert.equal(g_WeaponClass.Clip, 2, "live clip update");
	g_Assert.equal(g_WeaponClass.HasTag("explosive"), true, "live tag update");
	g_Assert.equal(g_WeaponClass.Data, g_ReplacementWeaponData, "replaced data object is read live");
} finally {
	g_WeaponDataRecord.Clip = g_unOriginalClip;
	g_WeaponDataRecord.Tags.length = g_unOriginalTagCount;
	g_WeaponDataRecord.Data = g_OriginalWeaponData;
}

g_Assert.equal(g_WeaponDataRecord.Data, g_OriginalWeaponData, "temporary record edits restore the original data object identity");

const g_NumericAmmoRecord = Object.assign({}, g_WeaponDataRecord);
g_NumericAmmoRecord.MaximumAmmo = 90;
g_NumericAmmoRecord.SecondaryMaximumAmmo = null;

const g_NumericWeaponClass = new g_WeaponsInstanceAPI.WeaponClass(g_NumericAmmoRecord);
const g_unReadsBeforeNumericLimits = g_vecCVarReadLog.length;
g_Assert.equal(g_NumericWeaponClass.MaximumAmmo, 90, "numeric primary maximum ammo");
g_Assert.equal(g_NumericWeaponClass.SecondaryMaximumAmmo, null, "null secondary maximum ammo");
g_Assert.equal(g_vecCVarReadLog.length, g_unReadsBeforeNumericLimits, "numeric limits bypass cvars");

const g_SparseWeaponClass = new g_WeaponsInstanceAPI.WeaponClass({});
g_Assert.equal(g_SparseWeaponClass.Name, undefined, "missing fields remain undefined");
g_Assert.throws(function ReadMalformedWeaponTags() {
	g_SparseWeaponClass.HasTag("all");
}, TypeError, "malformed tags use the V8 property error");

const g_MissingConVarRecord = Object.assign({}, g_WeaponDataRecord);
g_MissingConVarRecord.MaximumAmmo = "missing_weapon_ammo_limit";

const g_MissingConVarClass = new g_WeaponsInstanceAPI.WeaponClass(g_MissingConVarRecord);
g_Assert.throws(function ReadMissingConVarLimit() {
	return g_MissingConVarClass.MaximumAmmo;
}, /ConVar not found/, "native CVar failure propagates");

for (const WeaponRecord of [null, undefined, "weapon_pistol", [], 1]) {
	g_Assert.throws(function ConstructInvalidWeaponRecord() {
		return new g_WeaponsInstanceAPI.WeaponClass(WeaponRecord);
	}, /requires a weapon data record/, "invalid record must throw");
}

g_Assert.throws(function ReadNonStringWeaponTag() {
	g_WeaponClass.HasTag(7);
}, /tag must be a string/, "non-string tag must throw");

for (const strForbiddenExport of g_vecForbiddenWeaponsInstanceExports) {
	g_Assert.equal(Object.hasOwn(g_WeaponsInstanceAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_DocumentationCodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationCodeBlockMatch[1]);
	g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 7, "all weapons/instance documentation JavaScript blocks are present");

const g_vecDocumentationModules = [];
const g_unDataReadsBeforeBlockLoad = g_vecDataReadLog.length;
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const strDocumentationCode = g_vecDocumentationCodeBlocks[unDocumentationBlockIndex];
	g_vecDocumentationModules.push(RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, g_WeaponsInstanceAPI));
}

g_Assert.equal(g_vecDataReadLog.length, g_unDataReadsBeforeBlockLoad, "documentation blocks perform no profile work while loading");

const g_DocumentedWrappedClass = g_vecDocumentationModules[1].WrapWeaponRecord(g_WeaponDataRecord);
g_Assert.equal(g_DocumentedWrappedClass.Record, g_WeaponDataRecord, "documented constructor workflow preserves record identity");
g_Assert.throws(function WrapInvalidDocumentationRecord() {
	g_vecDocumentationModules[1].WrapWeaponRecord(null);
}, /requires a weapon data record/, "documented constructor workflow validates records");
g_Assert.throws(function WrapFunctionDocumentationRecord() {
	g_vecDocumentationModules[1].WrapWeaponRecord(WrapFunctionDocumentationRecord);
}, /requires a weapon data record/, "a callable JavaScript object is not an accepted record");

const g_DocumentedRequiredWeaponClass = g_vecDocumentationModules[2].RequireWeaponClass("hegrenade", "l4d2");
g_Assert.equal(g_DocumentedRequiredWeaponClass.Record, g_WeaponDataRecord, "documented required-class workflow preserves record identity");
g_Assert.throws(function RequireUnknownDocumentationWeaponClass() {
	g_vecDocumentationModules[2].RequireWeaponClass("unknown", "l4d2");
}, /Unknown weapon class/, "documented required-class workflow rejects unknown names");

const g_DocumentedWeaponMetadata = g_vecDocumentationModules[3].InspectWeaponClass("hegrenade", "l4d2");
g_Assert.equal(g_DocumentedWeaponMetadata.AmmoProperty, g_WeaponDataRecord.AmmoProperty, "documented metadata ammo property");
g_Assert.equal(g_DocumentedWeaponMetadata.BaseName, g_WeaponDataRecord.BaseName, "documented metadata base name");
g_Assert.equal(g_DocumentedWeaponMetadata.ClassName, g_WeaponDataRecord.ClassName, "documented metadata class name");
g_Assert.equal(g_DocumentedWeaponMetadata.Clip, g_WeaponDataRecord.Clip, "documented metadata clip");
g_Assert.equal(g_DocumentedWeaponMetadata.Cost, g_WeaponDataRecord.Cost, "documented metadata cost");
g_Assert.equal(g_DocumentedWeaponMetadata.Data, g_WeaponDataRecord.Data, "documented metadata data identity");
g_Assert.equal(g_DocumentedWeaponMetadata.ID, g_WeaponDataRecord.ID, "documented metadata identifier");
g_Assert.equal(g_DocumentedWeaponMetadata.ItemDefinitionIndex, g_WeaponDataRecord.ItemDefinitionIndex, "documented metadata item definition index");
g_Assert.equal(g_DocumentedWeaponMetadata.MaximumAmmo, g_mapCVarValues.get("ammo_grenade_limit_default"), "documented metadata primary ammo limit");
g_Assert.equal(g_DocumentedWeaponMetadata.Name, g_WeaponDataRecord.Name, "documented metadata name");
g_Assert.equal(g_DocumentedWeaponMetadata.ParentClass, g_WeaponDataRecord.ParentClass, "documented metadata parent class");
g_Assert.equal(g_DocumentedWeaponMetadata.Record, g_WeaponDataRecord, "documented metadata record identity");
g_Assert.equal(g_DocumentedWeaponMetadata.Script, g_WeaponDataRecord.Script, "documented metadata script identity");
g_Assert.equal(g_DocumentedWeaponMetadata.SecondaryAmmoProperty, g_WeaponDataRecord.SecondaryAmmoProperty, "documented metadata secondary ammo property");
g_Assert.equal(g_DocumentedWeaponMetadata.SecondaryMaximumAmmo, g_mapCVarValues.get("ammo_grenade_limit_secondary"), "documented metadata secondary ammo limit");
g_Assert.equal(g_DocumentedWeaponMetadata.Slot, g_WeaponDataRecord.Slot, "documented metadata slot");
g_Assert.equal(g_DocumentedWeaponMetadata.Tags, g_WeaponDataRecord.Tags, "documented metadata tags identity");
g_Assert.equal(g_DocumentedWeaponMetadata.Type, g_WeaponDataRecord.Type, "documented metadata type");
g_Assert.equal(g_DocumentedWeaponMetadata.ValueRecord, g_WeaponDataRecord, "documented metadata includes the current writable backing field");
g_Assert.equal(g_vecDocumentationModules[3].InspectWeaponClass("unknown", "l4d2"), null, "documented metadata workflow reports unknown names");

const g_vecDocumentedWeaponCatalog = g_vecDocumentationModules[4].BuildWeaponTagCatalog("grenade", "l4d2");
g_Assert.equal(g_vecDocumentedWeaponCatalog.length, 1, "documented tag catalog includes matching records");
g_Assert.equal(g_vecDocumentedWeaponCatalog[0].ClassName, g_WeaponDataRecord.ClassName, "documented tag catalog class name");
g_Assert.equal(g_vecDocumentedWeaponCatalog[0].Name, g_WeaponDataRecord.Name, "documented tag catalog name");
g_Assert.equal(g_vecDocumentedWeaponCatalog[0].Slot, g_WeaponDataRecord.Slot, "documented tag catalog slot");
g_Assert.equal(g_vecDocumentedWeaponCatalog[0].Type, g_WeaponDataRecord.Type, "documented tag catalog type");
g_Assert.equal(g_vecDocumentationModules[4].BuildWeaponTagCatalog("melee", "l4d2").length, 0, "documented tag catalog excludes non-matches");
g_Assert.throws(function BuildDocumentationCatalogWithInvalidTag() {
	g_vecDocumentationModules[4].BuildWeaponTagCatalog(4, "l4d2");
}, /tag must be a string/i, "documented tag catalog validates tags");

const g_DocumentedAmmoReader = g_vecDocumentationModules[5].CreateAmmoLimitReader("hegrenade", "l4d2");
const g_DocumentedInitialAmmoLimits = g_DocumentedAmmoReader();
g_Assert.equal(g_DocumentedInitialAmmoLimits.ClassName, g_WeaponDataRecord.ClassName, "documented ammo reader class name");
g_Assert.equal(g_DocumentedInitialAmmoLimits.MaximumAmmo, 3, "documented ammo reader primary limit");
g_Assert.equal(g_DocumentedInitialAmmoLimits.MaximumAmmoSource, "ammo_grenade_limit_default", "documented ammo reader primary source");
g_Assert.equal(g_DocumentedInitialAmmoLimits.SecondaryMaximumAmmo, 2, "documented ammo reader secondary limit");
g_Assert.equal(g_DocumentedInitialAmmoLimits.SecondaryMaximumAmmoSource, "ammo_grenade_limit_secondary", "documented ammo reader secondary source");

try {
	g_mapCVarValues.set("ammo_grenade_limit_default", 5);
	g_Assert.equal(g_DocumentedAmmoReader().MaximumAmmo, 5, "documented ammo reader observes realtime ConVar changes");
} finally {
	g_mapCVarValues.set("ammo_grenade_limit_default", g_unOriginalPrimaryAmmoLimit);
}

g_Assert.throws(function CreateUnknownDocumentationAmmoReader() {
	g_vecDocumentationModules[5].CreateAmmoLimitReader("unknown", "l4d2");
}, /Unknown weapon class/, "documented ammo reader rejects unknown names");

const g_DocumentedPluginWeaponClass = g_vecDocumentationModules[6].CreatePluginWeaponClass("hegrenade", ["pluginOwned", "grenade"], "l4d2");
g_Assert.notEqual(g_DocumentedPluginWeaponClass.Record, g_WeaponDataRecord, "documented plugin workflow owns its record");
g_Assert.notEqual(g_DocumentedPluginWeaponClass.Data, g_WeaponDataRecord.Data, "documented plugin workflow owns its data object");
g_Assert.notEqual(g_DocumentedPluginWeaponClass.Tags, g_WeaponDataRecord.Tags, "documented plugin workflow owns its tag array");
g_Assert.equal(g_DocumentedPluginWeaponClass.HasTag("pluginOwned"), true, "documented plugin workflow adds a tag");

let g_unDocumentedGrenadeTagCount = 0;
for (const strWeaponTag of g_DocumentedPluginWeaponClass.Tags) {
	if (strWeaponTag === "grenade") {
		g_unDocumentedGrenadeTagCount += 1;
	}
}

g_Assert.equal(g_unDocumentedGrenadeTagCount, 1, "documented plugin workflow deduplicates tags");
g_Assert.throws(function CreateDocumentationClassWithInvalidTags() {
	g_vecDocumentationModules[6].CreatePluginWeaponClass("hegrenade", [7], "l4d2");
}, /array of strings/, "documented plugin workflow validates tags");
g_Assert.throws(function CreateUnknownDocumentationPluginClass() {
	g_vecDocumentationModules[6].CreatePluginWeaponClass("unknown", [], "l4d2");
}, /Unknown weapon class/, "documented plugin workflow rejects unknown names");

const g_ScriptPropertyDescriptor = Object.getOwnPropertyDescriptor(g_WeaponDataRecord, "Script");
const g_FirstScriptValue = { Damage: 111 };
const g_ScriptCopyError = new Error("The source Script getter failed during copying.");
let g_CurrentScriptValue = g_FirstScriptValue;
let g_unLazyScriptReadCount = 0;
let g_bFailScriptCopy = false;
try {
	Object.defineProperty(g_WeaponDataRecord, "Script", {
		configurable: true,
		enumerable: true,
		get() {
			g_unLazyScriptReadCount += 1;

			if (g_bFailScriptCopy) {
				throw g_ScriptCopyError;
			}

			return g_CurrentScriptValue;
		},
	});

	const PluginWeaponClass = g_vecDocumentationModules[6].CreatePluginWeaponClass("hegrenade", [], "l4d2");
	g_Assert.equal(g_unLazyScriptReadCount, 1, "the documented shallow copy invokes the source Script getter immediately");
	g_Assert.equal(Object.getOwnPropertyDescriptor(PluginWeaponClass.Record, "Script").get, undefined, "the copied Script is an ordinary field, not a retained accessor");
	g_CurrentScriptValue = { Damage: 222 };
	g_Assert.equal(PluginWeaponClass.Script, g_FirstScriptValue, "a later source getter result does not replace the copied Script field");
	g_Assert.equal(g_unLazyScriptReadCount, 1, "copied Script reads do not invoke the source getter again");
	g_FirstScriptValue.Damage = 333;
	g_Assert.equal(PluginWeaponClass.Script.Damage, 333, "the copied Script value is still shared, not deeply cloned");
	g_bFailScriptCopy = true;
	g_Assert.throws(function CopyWeaponRecordWithFailingScript() {
		g_vecDocumentationModules[6].CreatePluginWeaponClass("hegrenade", [], "l4d2");
	}, function PreserveScriptCopyError(CaughtError) {
		return CaughtError === g_ScriptCopyError;
	}, "the documented shallow copy propagates the original Script getter error");
} finally {
	Object.defineProperty(g_WeaponDataRecord, "Script", g_ScriptPropertyDescriptor);
}

{
	const StringTagsClass = new g_WeaponsInstanceAPI.WeaponClass({ Tags: "grenade" });
	g_Assert.equal(StringTagsClass.HasTag("nade"), true, "custom string tags retain their includes semantics");

	// Implement the existing Array-like includes contract, not a new project method.
	const TagStorage = {
		includes(strTag) {
			g_Assert.strictEqual(this, TagStorage, "custom tag includes receives its original receiver");

			return strTag;
		},
	};
	const CustomTagsClass = new g_WeaponsInstanceAPI.WeaponClass({ Tags: TagStorage });
	g_Assert.equal(CustomTagsClass.HasTag("MixedTag"), "MixedTag", "custom tag includes results are returned unchanged");

	const OriginalData = g_WeaponDataRecord.Data;
	const RawData = Object.create(null);
	const PrototypeValue = { Marker: "RawFieldValue" };
	RawData.Source = "profile";
	RawData["constructor"] = "RawConstructor";
	RawData["toString"] = "RawToString";

	try {
		for (const Value of ["RawLiteral", PrototypeValue]) {
			RawData["__proto__"] = Value;
			g_WeaponDataRecord.Data = RawData;

			const PluginWeaponClass = g_vecDocumentationModules[6].CreatePluginWeaponClass("hegrenade", [], "l4d2");
			g_Assert.equal(Object.hasOwn(PluginWeaponClass.Data, "__proto__"), true, "raw data clone preserves the own prototype-named key");
			g_Assert.equal(Object.getPrototypeOf(PluginWeaponClass.Data), null, "raw data clone keeps a null prototype");
			g_Assert.strictEqual(PluginWeaponClass.Data["__proto__"], Value, "raw data clone preserves scalar and shared object values");
			g_Assert.equal(PluginWeaponClass.Data["constructor"], "RawConstructor", "raw data clone preserves constructor-named data");
			g_Assert.equal(PluginWeaponClass.Data["toString"], "RawToString", "raw data clone preserves toString-named data");
			g_Assert.deepEqual(Object.keys(PluginWeaponClass.Data), Object.keys(RawData), "raw data clone retains all enumerable keys");
			g_Assert.notStrictEqual(PluginWeaponClass.Data, RawData, "raw data clone remains independently owned");
		}
	} finally {
		g_WeaponDataRecord.Data = OriginalData;
	}
}

g_Assert.equal(JSON.stringify(g_WeaponDataRecord), g_strInitialWeaponDataRecordJSON, "documentation workflows preserve source records");

let g_bSelectedBranchCatalogRead = false;
let g_bWeaponNameLookupRead = false;

for (const DataRead of g_vecDataReadLog) {
	if ((DataRead.Operation === "GetAll") && (DataRead.SDKBranch === "l4d2")) {
		g_bSelectedBranchCatalogRead = true;
	}

	if ((DataRead.Operation === "Get") && (DataRead.WeaponName === "hegrenade")) {
		g_bWeaponNameLookupRead = true;
	}
}

g_Assert.equal(g_bSelectedBranchCatalogRead, true, "documented catalog reads the selected branch");
g_Assert.equal(g_bWeaponNameLookupRead, true, "documented lookup workflows resolve by name");

g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|GetAll\(\)\[0\]|console\.|const api =/, "weapons/instance documentation is hand-maintained and action-oriented");
g_Assert.match(g_strDocumentationSource, /Replacing `ValueRecord` redirects every getter and `HasTag\(\)`/, "documentation describes record replacement without claiming immutable backing storage");
g_Assert.match(g_strDocumentationSource, /String-backed reads are synchronous native CVar operations on the game thread/, "documentation states native CVar thread confinement");
g_Assert.match(g_strDocumentationSource, /stores its returned value as an ordinary field, not a lazy accessor/, "documentation explains eager Script evaluation during shallow copying");
g_Assert.match(g_strDocumentationSource, /Record accessors and proxies can throw/, "documentation does not promise caller-controlled property reads are side-effect-free");

for (const strRelativeLink of g_vecRelatedDocumentationLinks) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strInstancePath)});`], { encoding: "utf8", env: { ...process.env, NODE_PATH: g_strPackageRootPath }, timeout: g_unChildTimeoutMilliseconds });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and finishes before the timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child is not terminated by a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/instance requires the native runtime through cvars");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_instance");
