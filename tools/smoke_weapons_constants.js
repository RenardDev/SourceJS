#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-constants.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strConstantsPath = g_Path.join(g_strPackageRootPath, "weapons", "constants.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strSourceJSDataRootPath = g_Path.join(g_strRepositoryRootPath, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs");
const g_strWeaponConstantsDataRootPath = g_Path.join(g_strSourceJSDataRootPath, "weapons", "constants");
const g_strCSSConstantsDataRootPath = g_Path.join(g_strWeaponConstantsDataRootPath, "orangebox", "cstrike");
const g_strCSGOConstantsDataRootPath = g_Path.join(g_strWeaponConstantsDataRootPath, "csgo");
const g_strTF2ConstantsDataRootPath = g_Path.join(g_strWeaponConstantsDataRootPath, "orangebox", "tf");
const g_strCSSWeaponIDPath = g_Path.join(g_strCSSConstantsDataRootPath, "WeaponID.ini");
const g_strCSSWeaponTypePath = g_Path.join(g_strCSSConstantsDataRootPath, "WeaponType.ini");
const g_strCSGOWeaponIDPath = g_Path.join(g_strCSGOConstantsDataRootPath, "WeaponID.ini");
const g_strCSGOWeaponSlotPath = g_Path.join(g_strCSGOConstantsDataRootPath, "WeaponSlot.ini");
const g_strCSGOWeaponTypePath = g_Path.join(g_strCSGOConstantsDataRootPath, "WeaponType.ini");
const g_strTF2WeaponIDPath = g_Path.join(g_strTF2ConstantsDataRootPath, "WeaponID.ini");
const g_strTF2WeaponSlotPath = g_Path.join(g_strTF2ConstantsDataRootPath, "WeaponSlot.ini");
const g_strTF2WeaponTypePath = g_Path.join(g_strTF2ConstantsDataRootPath, "WeaponType.ini");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecExpectedConstantPaths = [
	"MuzzleFlashStyle.ini",
	"WeaponID.ini",
	"csgo/WeaponID.ini",
	"csgo/WeaponSlot.ini",
	"csgo/WeaponType.ini",
	"orangebox/cstrike/WeaponID.ini",
	"orangebox/cstrike/WeaponSlot.ini",
	"orangebox/cstrike/WeaponType.ini",
	"orangebox/tf/WeaponID.ini",
	"orangebox/tf/WeaponSlot.ini",
	"orangebox/tf/WeaponType.ini",
];
const g_vecForbiddenExports = [
	"number",
	"string",
	"enums",
	"count",
	"names",
	"classes",
	"itemFlags",
	"weaponState",
	"moduleName",
	"default",
];
const g_vecWeaponConstantNamespaceNames = [
	"ItemFlags",
	"WeaponState",
	"WeaponProficiency",
	"WeaponSound",
];
const g_vecRelatedDocumentationFiles = [
	"weapons.md",
	"weapons-scripts.md",
	"entities-props.md",
	"memory-hooks.md",
];
const g_vecRequiredBindingTokens = [
	"SOURCEJS_HAS_WEAPON_SHAREDDEFS",
	"SOURCEJS_HAS_WEAPON_PARSE",
	"SOURCEJS_HAS_WEAPON_PROFICIENCY",
	"SOURCEJS_HAS_ITEM_FLAG_NOITEMPICKUP",
	"SOURCEJS_HAS_WEAPON_SOUND_TAUNT",
	"SOURCEJS_HAS_WEAPON_SOUND_UNKNOWN",
	"SOURCEJS_HAS_WEAPON_SOUND_FAST_RELOAD",
	'"ItemFlags"',
	'"WeaponState"',
	'"WeaponProficiency"',
	'"WeaponSound"',
];

const g_FullWeaponConstants = {
	CLASS_PREFIX: "weapon_",
	ENTITY_CLASS_PREFIX: "weapon_",
	INVALID_WEAPON_INDEX: -1,
	ItemFlags: {
		DoHitLocationDamage: 0x20,
		Exhaustible: 0x10,
		LimitInWorld: 0x08,
		NoAmmoPickups: 0x40,
		NoAutoReload: 0x02,
		NoAutoSwitchEmpty: 0x04,
		NoItemPickup: 0x80,
		SelectOnEmpty: 0x01,
	},
	WeaponProficiency: {
		Average: 1,
		Good: 2,
		Perfect: 4,
		Poor: 0,
		VeryGood: 3,
	},
	WeaponSound: {
		Burst: 5,
		Double: 3,
		DoubleNPC: 4,
		Empty: 0,
		FastReload: 20,
		MeleeHit: 9,
		MeleeHitWorld: 10,
		MeleeMiss: 8,
		Reload: 6,
		ReloadNPC: 7,
		Single: 1,
		SingleNPC: 2,
		Special1: 11,
		Special2: 12,
		Special3: 13,
		Taunt: 14,
		Unknown1: 15,
		Unknown2: 16,
		Unknown3: 17,
		Unknown4: 18,
		Unknown5: 19,
	},
	WeaponState: {
		Active: 2,
		CarriedByPlayer: 1,
		NotCarried: 0,
	},
};

const g_MinimalWeaponConstants = { CLASS_PREFIX: "weapon_", ENTITY_CLASS_PREFIX: "weapon_", INVALID_WEAPON_INDEX: -1 };

function ListINIFiles(strDirectoryPath) {
	const vecFilePaths = [];
	for (const Entry of g_FileSystem.readdirSync(strDirectoryPath, { withFileTypes: true })) {
		const strEntryPath = g_Path.join(strDirectoryPath, Entry.name);
		if (Entry.isDirectory()) {
			const vecNestedFilePaths = ListINIFiles(strEntryPath);
			for (const strNestedFilePath of vecNestedFilePaths) {
				vecFilePaths.push(strNestedFilePath);
			}

		} else if (Entry.isFile() && (g_Path.extname(Entry.name).toLowerCase() === ".ini")) {
			vecFilePaths.push(strEntryPath);
		}
	}

	return vecFilePaths;
}

function LoadConstants(NativeConstants) {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const ResolverDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_resolveFilename");
	const OriginalResolveFilename = ResolverDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/constants runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/constants package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/constants runtime fixture must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons/constants resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/constants cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/constants fixture property must be removable: " + strKey);
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

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "weapons/constants": NativeConstants } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "internal/runtime") {
					return g_strInternalRuntimePath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		Result = require(g_strConstantsPath);
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

			throw new AggregateError(vecFailures, "Weapons/constants fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function RequireDocumentationModule(strIdentifier, ConstantsAPI, OperationState) {
	if (strIdentifier === "weapons/constants") {
		return ConstantsAPI;
	}

	if (strIdentifier === "weapons") {
		return {
			GetWeaponsByClassName(strClassName) {
				OperationState.Count += 1;

				if (strClassName === "weapon_pistol") {
					return [{ Index: 20 }];
				}

				return [];
			},

			GetPropertyInteger(Weapon, strProperty) {
				OperationState.Count += 1;
				g_Assert.equal(Weapon.Index, 20, "documentation state weapon");
				g_Assert.equal(strProperty, "m_iState", "documentation state property");

				return ConstantsAPI.WeaponState.Active;
			},
		};
	}

	if (strIdentifier === "weapons/scripts") {
		return {
			Load(strName) {
				OperationState.Count += 1;
				g_Assert.equal(strName, "pistol", "documentation script name");

				return {
					KeyValues: {
						GetKeyValuesInteger(strKey, nFallback) {
							g_Assert.equal(strKey, "item_flags", "documentation script flag key");
							g_Assert.equal(nFallback, 0, "documentation script flag fallback");

							return ConstantsAPI.ItemFlags.SelectOnEmpty | ConstantsAPI.ItemFlags.NoAutoReload;
						},
					},
				};
			},
		};
	}

	if (strIdentifier === "entities/props") {
		return {
			GetEntitySendProperty(Weapon, strProperty) {
				OperationState.Count += 1;

				if ((Weapon.Index === 20) && (strProperty === "m_iState")) {
					return { Name: strProperty };
				}

				return null;
			},
		};
	}

	throw new Error(`Unexpected documentation import: ${strIdentifier}`);
}

function RunDocumentationBlock(strCodeSource, unBlockIndex, ConstantsAPI, OperationState) {
	const Context = g_VM.createContext({
		require(strIdentifier) {
			return RequireDocumentationModule(strIdentifier, ConstantsAPI, OperationState);
		},
	});
	const unOperationCountBefore = OperationState.Count;
	g_VM.runInContext(strCodeSource, Context, { filename: `${g_strDocumentationPath}#example-${unBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(OperationState.Count, unOperationCountBefore, `documentation block ${unBlockIndex + 1} has no eager lookup`);

	return Context;
}

const g_vecWeaponConstantPaths = ListINIFiles(g_strWeaponConstantsDataRootPath).sort();
const g_WeaponConstantsAPI = LoadConstants(g_FullWeaponConstants);
const g_strCSSWeaponIDSource = g_FileSystem.readFileSync(g_strCSSWeaponIDPath, "utf8");
const g_strCSSWeaponTypeSource = g_FileSystem.readFileSync(g_strCSSWeaponTypePath, "utf8");
const g_strCSGOWeaponIDSource = g_FileSystem.readFileSync(g_strCSGOWeaponIDPath, "utf8");
const g_strCSGOWeaponSlotSource = g_FileSystem.readFileSync(g_strCSGOWeaponSlotPath, "utf8");
const g_strCSGOWeaponTypeSource = g_FileSystem.readFileSync(g_strCSGOWeaponTypePath, "utf8");
const g_strTF2WeaponIDSource = g_FileSystem.readFileSync(g_strTF2WeaponIDPath, "utf8");
const g_strTF2WeaponSlotSource = g_FileSystem.readFileSync(g_strTF2WeaponSlotPath, "utf8");
const g_strTF2WeaponTypeSource = g_FileSystem.readFileSync(g_strTF2WeaponTypePath, "utf8");
const g_vecRelativeWeaponConstantPaths = [];
for (const strFilePath of g_vecWeaponConstantPaths) {
	g_vecRelativeWeaponConstantPaths.push(g_Path.relative(g_strWeaponConstantsDataRootPath, strFilePath).replace(/\\/g, "/"));
}

g_Assert.deepEqual(g_vecRelativeWeaponConstantPaths, g_vecExpectedConstantPaths, "exact packaged weapon-constant tables");

for (const strFilePath of g_vecWeaponConstantPaths) {
	const strINISource = g_FileSystem.readFileSync(strFilePath, "utf8");
	const strRelativePath = g_Path.relative(g_strWeaponConstantsDataRootPath, strFilePath).replace(/\\/g, "/");
	const mapConstantNamesByValue = new Map();

	g_Assert.doesNotMatch(strINISource, /^\s*#\s*[A-Z0-9_]+\s*=/m, `${strRelativePath} commented-out assignments are absent`);

	for (const strLine of strINISource.split(/\r?\n/)) {
		const vecMatch = /^([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+)$/.exec(strLine);
		if (!vecMatch) {
			continue;
		}

		const nValue = Number.parseInt(vecMatch[2], 10);
		g_Assert.equal(mapConstantNamesByValue.has(nValue), false, `${strRelativePath} duplicate value ${nValue}`);
		mapConstantNamesByValue.set(nValue, vecMatch[1]);
	}
}

g_Assert.match(g_strCSSWeaponIDSource, /^NIGHTVISION = 33$/m, "CSS canonical night-vision weapon ID");
g_Assert.doesNotMatch(g_strCSSWeaponIDSource, /^(?:NVG|NVGS)\s*=/m, "CSS night-vision aliases are absent");
g_Assert.match(g_strCSSWeaponTypeSource, /^SUBMACHINEGUN = 2$/m, "CSS canonical submachine-gun weapon type");
g_Assert.match(g_strCSSWeaponTypeSource, /^SNIPER_RIFLE = 5$/m, "CSS canonical sniper-rifle weapon type");
g_Assert.doesNotMatch(g_strCSSWeaponTypeSource, /^(?:SMG|SNIPERRIFLE|SNIPER|MG|EXPLOSIVE)\s*=/m, "CSS weapon-type aliases are absent");
g_Assert.match(g_strCSGOWeaponIDSource, /^NIGHTVISION = 54$/m, "CSGO canonical night-vision weapon ID");
g_Assert.doesNotMatch(g_strCSGOWeaponIDSource, /^(?:NVG|NVGS)\s*=/m, "CSGO night-vision aliases are absent");
g_Assert.doesNotMatch(g_strCSGOWeaponIDSource, /^\s*#\s*[A-Z0-9_]+\s*=/m, "CSGO commented-out weapon IDs are absent");
g_Assert.match(g_strCSGOWeaponSlotSource, /^BOOST = 11$/m, "CSGO canonical boost slot");
g_Assert.match(g_strCSGOWeaponSlotSource, /^UTILITY = 12$/m, "CSGO canonical utility slot");
g_Assert.doesNotMatch(g_strCSGOWeaponSlotSource, /^(?:SHIELD|TABLET)\s*=/m, "CSGO weapon-slot aliases are absent");
g_Assert.match(g_strCSGOWeaponTypeSource, /^SUBMACHINEGUN = 2$/m, "CSGO canonical submachine-gun weapon type");
g_Assert.match(g_strCSGOWeaponTypeSource, /^SNIPER_RIFLE = 5$/m, "CSGO canonical sniper-rifle weapon type");
g_Assert.match(g_strCSGOWeaponTypeSource, /^ZONE_REPULSOR = 18$/m, "CSGO canonical zone-repulsor weapon type");
g_Assert.doesNotMatch(g_strCSGOWeaponTypeSource, /^(?:SMG|SNIPERRIFLE|SNIPER|MG|EXPLOSIVE|ZONEREPULSOR)\s*=/m, "CSGO weapon-type aliases are absent");
g_Assert.match(g_strTF2WeaponTypeSource, /^PDA = 5$/m, "TF2 PDA weapon type");
g_Assert.match(g_strTF2WeaponSlotSource, /^TAUNT = 11$/m, "TF2 pinned SDK first taunt slot");
g_Assert.doesNotMatch(g_strTF2WeaponSlotSource, /^TAUNT1\s*=/m, "TF2 obsolete first-taunt alias is absent");
g_Assert.match(g_strTF2WeaponIDSource, /^ROCKETLAUNCHER_DIRECTHIT = 65$/m, "TF2 pinned SDK direct-hit weapon ID");
g_Assert.match(g_strTF2WeaponIDSource, /^HANDGUN_SCOUT_SECONDARY = 75$/m, "TF2 pinned SDK secondary handgun weapon ID");
g_Assert.match(g_strTF2WeaponIDSource, /^GRENADE_ORNAMENT_BALL = 83$/m, "TF2 pinned SDK ornament-ball weapon ID");
g_Assert.match(g_strTF2WeaponIDSource, /^FLAREGUN_REVENGE = 84$/m, "TF2 pinned SDK revenge flare-gun weapon ID");
g_Assert.doesNotMatch(g_strTF2WeaponIDSource, /^(?:DIRECTHIT|HANDGUN_SCOUT_SEC|GRENADE_ORNAMENT|RAYGUN_REVENGE)\s*=/m, "TF2 obsolete weapon-ID aliases are absent");

g_Assert.equal(g_WeaponConstantsAPI, g_FullWeaponConstants, "weapons/constants exposes the exact native object");
g_Assert.deepEqual(Object.keys(g_WeaponConstantsAPI).sort(), [
	"CLASS_PREFIX",
	"ENTITY_CLASS_PREFIX",
	"INVALID_WEAPON_INDEX",
	"ItemFlags",
	"WeaponProficiency",
	"WeaponSound",
	"WeaponState",
], "maximum constants exports");
g_Assert.deepEqual(Object.keys(g_WeaponConstantsAPI.ItemFlags).sort(), [
	"DoHitLocationDamage",
	"Exhaustible",
	"LimitInWorld",
	"NoAmmoPickups",
	"NoAutoReload",
	"NoAutoSwitchEmpty",
	"NoItemPickup",
	"SelectOnEmpty",
], "maximum item flags");
g_Assert.deepEqual(Object.keys(g_WeaponConstantsAPI.WeaponState).sort(), ["Active", "CarriedByPlayer", "NotCarried"], "weapon states");
g_Assert.deepEqual(Object.keys(g_WeaponConstantsAPI.WeaponProficiency).sort(), [
	"Average",
	"Good",
	"Perfect",
	"Poor",
	"VeryGood",
], "weapon proficiencies");
g_Assert.deepEqual(Object.keys(g_WeaponConstantsAPI.WeaponSound).sort(), [
	"Burst",
	"Double",
	"DoubleNPC",
	"Empty",
	"FastReload",
	"MeleeHit",
	"MeleeHitWorld",
	"MeleeMiss",
	"Reload",
	"ReloadNPC",
	"Single",
	"SingleNPC",
	"Special1",
	"Special2",
	"Special3",
	"Taunt",
	"Unknown1",
	"Unknown2",
	"Unknown3",
	"Unknown4",
	"Unknown5",
], "maximum weapon sounds");
g_Assert.equal(g_WeaponConstantsAPI.INVALID_WEAPON_INDEX, -1, "invalid weapon index");
g_Assert.equal(g_WeaponConstantsAPI.CLASS_PREFIX, "weapon_", "class prefix");
g_Assert.equal(g_WeaponConstantsAPI.ENTITY_CLASS_PREFIX, "weapon_", "entity class prefix");

{
	const nOriginalActiveState = g_FullWeaponConstants.WeaponState.Active;
	try {
		g_FullWeaponConstants.WeaponState.Active = 7;
		g_Assert.equal(g_WeaponConstantsAPI.WeaponState.Active, 7, "native enum objects remain live");
	} finally {
		g_FullWeaponConstants.WeaponState.Active = nOriginalActiveState;
	}
}

for (const strForbiddenExport of g_vecForbiddenExports) {
	g_Assert.equal(Object.hasOwn(g_WeaponConstantsAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [];
const g_DocumentationOperationState = { Count: 0 };

for (const vecMatch of g_strDocumentationSource.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 6, "all weapons/constants documentation JavaScript blocks are present");

const g_vecContexts = [];
for (let unBlockIndex = 0; unBlockIndex < g_vecCodeBlocks.length; unBlockIndex += 1) {
	g_vecContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unBlockIndex], unBlockIndex, g_WeaponConstantsAPI, g_DocumentationOperationState));
}

const g_ResolvedWeapon = g_vecContexts[1].ResolveWeaponClass("pistol");
g_Assert.deepEqual({ ClassName: g_ResolvedWeapon.ClassName, Index: g_ResolvedWeapon.Index, Weapon: g_ResolvedWeapon.Weapon }, { ClassName: "weapon_pistol", Index: 20, Weapon: g_ResolvedWeapon.Weapon }, "prefix workflow resolves a live weapon");
g_Assert.equal(g_ResolvedWeapon.Weapon.Index, 20, "prefix workflow returns the matched weapon");

const g_MissingWeapon = g_vecContexts[1].ResolveWeaponClass("missing");
g_Assert.equal(g_MissingWeapon.ClassName, "weapon_missing", "prefix workflow normalizes a missing class");
g_Assert.equal(g_MissingWeapon.Index, g_FullWeaponConstants.INVALID_WEAPON_INDEX, "prefix workflow returns the invalid sentinel");
g_Assert.equal(g_MissingWeapon.Weapon, null, "prefix workflow preserves missing null");

const g_ScriptFlagsResult = g_vecContexts[2].InspectScriptItemFlags("pistol");
const g_unExpectedScriptFlags = g_FullWeaponConstants.ItemFlags.SelectOnEmpty | g_FullWeaponConstants.ItemFlags.NoAutoReload;
const g_vecEnabledScriptFlags = [];
for (const strEnabledScriptFlag of g_ScriptFlagsResult.EnabledFlagNames) {
	g_vecEnabledScriptFlags.push(strEnabledScriptFlag);
}

g_Assert.equal(g_ScriptFlagsResult.ItemFlagsMask, g_unExpectedScriptFlags, "script workflow returns the native mask");
g_Assert.deepEqual(g_vecEnabledScriptFlags.sort(), ["NoAutoReload", "SelectOnEmpty"], "script workflow decodes enabled flags");
g_Assert.equal(g_ScriptFlagsResult.WeaponScriptRecord.KeyValues.GetKeyValuesInteger("item_flags", 0), g_ScriptFlagsResult.ItemFlagsMask, "script workflow retains the loaded script");

const g_WeaponStateResult = g_vecContexts[3].InspectWeaponState({ Index: 20 });
g_Assert.deepEqual({ StateName: g_WeaponStateResult.StateName, PropertyName: g_WeaponStateResult.PropertyName, Value: g_WeaponStateResult.Value }, { StateName: "Active", PropertyName: "m_iState", Value: g_FullWeaponConstants.WeaponState.Active }, "state workflow decodes a live sendprop");
g_Assert.equal(g_vecContexts[4].GetProficiencyName(g_FullWeaponConstants.WeaponProficiency.Good), "Good", "proficiency workflow decodes a hook argument");
g_Assert.equal(g_vecContexts[4].GetProficiencyName(99), null, "proficiency workflow preserves an unknown value");

const g_WeaponSoundResult = g_vecContexts[5].InspectWeaponSound(g_FullWeaponConstants.WeaponSound.Reload);
g_Assert.equal(g_WeaponSoundResult.WeaponSoundName, "Reload", "sound workflow decodes a hook argument");
g_Assert.deepEqual({ HasFastReload: g_WeaponSoundResult.Capabilities.HasFastReload, HasTaunt: g_WeaponSoundResult.Capabilities.HasTaunt, HasUnknownSlots: g_WeaponSoundResult.Capabilities.HasUnknownSlots }, { HasFastReload: true, HasTaunt: true, HasUnknownSlots: true }, "sound workflow reports optional capabilities");

const g_vecMinimalContexts = [];
for (let unBlockIndex = 0; unBlockIndex < g_vecCodeBlocks.length; unBlockIndex += 1) {
	const strCodeBlock = g_vecCodeBlocks[unBlockIndex];
	const MinimalContext = RunDocumentationBlock(strCodeBlock, unBlockIndex, g_MinimalWeaponConstants, g_DocumentationOperationState);
	g_vecMinimalContexts.push(MinimalContext);
}

g_Assert.throws(
	function InspectScriptFlagsWithoutCapability() {
		g_vecMinimalContexts[2].InspectScriptItemFlags("pistol");
	},
	/requires ItemFlags/,
	"minimal SDK script capability error",
);
g_Assert.throws(
	function InspectWeaponStateWithoutCapability() {
		g_vecMinimalContexts[3].InspectWeaponState({ Index: 20 });
	},
	/requires WeaponState/,
	"minimal SDK state capability error",
);
g_Assert.throws(
	function DecodeProficiencyWithoutCapability() {
		g_vecMinimalContexts[4].GetProficiencyName(2);
	},
	/requires WeaponProficiency/,
	"minimal SDK proficiency capability error",
);
g_Assert.throws(
	function InspectWeaponSoundWithoutCapability() {
		g_vecMinimalContexts[5].InspectWeaponSound(6);
	},
	/requires WeaponSound/,
	"minimal SDK sound capability error",
);
g_Assert.doesNotMatch(g_strDocumentationSource, /console\.(?:log|warn|error)/, "weapons/constants examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|const api =|Object\.keys\(ItemFlags\)/, "weapons/constants documentation is hand-maintained");

for (const strExportName of Object.keys(g_FullWeaponConstants)) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strNamespaceName of g_vecWeaponConstantNamespaceNames) {
	for (const strMemberName of Object.keys(g_FullWeaponConstants[strNamespaceName])) {
		g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strMemberName}\\b`), `documentation covers ${strNamespaceName}.${strMemberName}`);
	}
}

for (const strRelativeDocumentationPath of g_vecRelatedDocumentationFiles) {
	const strDocumentationLinkPath = g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeDocumentationPath);
	g_Assert.equal(g_FileSystem.existsSync(strDocumentationLinkPath), true, `documentation link exists: ${strRelativeDocumentationPath}`);
}

const g_MinimalWeaponConstantsAPI = LoadConstants(g_MinimalWeaponConstants);
g_Assert.equal(g_MinimalWeaponConstantsAPI, g_MinimalWeaponConstants, "minimal SDK module identity");
g_Assert.deepEqual(Object.keys(g_MinimalWeaponConstantsAPI).sort(), ["CLASS_PREFIX", "ENTITY_CLASS_PREFIX", "INVALID_WEAPON_INDEX"], "minimal SDK omits unavailable namespaces");

for (const strNamespaceName of g_vecWeaponConstantNamespaceNames) {
	g_Assert.equal(Object.hasOwn(g_MinimalWeaponConstantsAPI, strNamespaceName), false, `minimal SDK omits ${strNamespaceName}`);
}

const g_strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_nConstantsBindingStart = g_strModuleBindingsSource.indexOf("bool InstallWeaponConstants");
const g_nConstantsBindingEnd = g_strModuleBindingsSource.indexOf("bool RequireNetChannelPlayerIndexFromValue", g_nConstantsBindingStart);
g_Assert.notEqual(g_nConstantsBindingStart, -1, "native constants binding start exists");
g_Assert.notEqual(g_nConstantsBindingEnd, -1, "native constants binding end exists");
g_Assert.ok(g_nConstantsBindingEnd > g_nConstantsBindingStart, "native constants binding region is ordered");

const g_strConstantsBindingSource = g_strModuleBindingsSource.slice(g_nConstantsBindingStart, g_nConstantsBindingEnd);
for (const strRequiredToken of g_vecRequiredBindingTokens) {
	g_Assert.match(g_strConstantsBindingSource, new RegExp(strRequiredToken), `native constants binding contains ${strRequiredToken}`);
}

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeProcess = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strConstantsPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntimeProcess.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntimeProcess.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntimeProcess.status, 1, "weapons/constants requires the native runtime");
g_Assert.match(g_MissingRuntimeProcess.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_constants");
