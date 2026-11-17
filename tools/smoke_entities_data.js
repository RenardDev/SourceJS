#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const { CreateNativePaths } = require("./native_paths_mock.js");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRootPath, "docs", "api", "entities-data.md");
const g_strGameDataDocumentationPath = g_Path.join(g_strRootPath, "docs", "api", "memory-gamedata.md");
const g_strPackageRootPath = g_Path.join(g_strRootPath, "packages", "sourcejs");
const g_strSourceDataRoot = g_Path.join(g_strRootPath, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs").replace(/\\/g, "/");
const g_strEntityDataPath = g_Path.join(g_strPackageRootPath, "entities", "data.js");
const g_strEntityDictionaryPath = g_Path.join(g_strPackageRootPath, "entities", "dictionary.js");
const g_strFilesystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strGlobalsPath = g_Path.join(g_strPackageRootPath, "globals.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strListenersPath = g_Path.join(g_strPackageRootPath, "listeners.js");
const g_strMemoryGameDataPath = g_Path.join(g_strPackageRootPath, "memory", "gamedata.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");

function CreateListenerManager() {
	const setCallbacks = new Set();

	return {
		RegisterListener(Callback) {
			if (setCallbacks.has(Callback)) {
				throw new Error("Listener callback already registered.");
			}

			setCallbacks.add(Callback);

			return Callback;
		},
		UnregisterListener(Callback) {
			if (!setCallbacks.delete(Callback)) {
				throw new Error("Listener callback not registered.");
			}

			return Callback;
		},
	};
}

function InstallDependency(strModulePath, Dependency) {
	require.cache[strModulePath] = {
		exports: Dependency,
		filename: strModulePath,
		id: strModulePath,
		loaded: true,
	};
}

const g_NetworkedEntityCreatedManager = CreateListenerManager();
const g_NetworkedEntityDeletedManager = CreateListenerManager();
const g_mapEntityDataFixtureTexts = new Map();
const g_NativeFilesystem = {
	DoesFileExist(strFilePath) {
		if (typeof strFilePath !== "string") {
			throw new TypeError("filesystem.DoesFileExist(strFilePath) expects a string.");
		}

		return g_FileSystem.existsSync(strFilePath);
	},
	ReadTextFile(strFilePath) {
		if (typeof strFilePath !== "string") {
			throw new TypeError("filesystem.ReadTextFile(strFilePath) expects a string.");
		}

		if (g_mapEntityDataFixtureTexts.has(strFilePath)) {
			return g_mapEntityDataFixtureTexts.get(strFilePath);
		}

		return g_FileSystem.readFileSync(strFilePath, "utf8");
	},
};

const g_NativeGlobals = {
	GetGlobalVariables() {
		return {
			SDKBranch: "sdk2013",
		};
	},
};

const g_NativePaths = {
	...CreateNativePaths({ SOURCE_DATA_ROOT: g_strSourceDataRoot }),
};

const g_NativeEntityDictionary = {
	GetAllEntities() {
		return {
			Count: 0,
		};
	},
	GetEntityDictionaryEntries() {
		return [];
	},
	GetEntity(unIndex) {
		return {
			Index: unIndex,
		};
	},
	GetEntityFromDictionary(unIndex) {
		return {
			Index: unIndex,
		};
	},
	HasEntityInDictionary() {
		return false;
	},
	GetEntityDictionaryKeys() {
		return [];
	},
	GetEntityDictionaryValues() {
		return [];
	},
};

globalThis.sourcejs = {
	"entities/dictionary": g_NativeEntityDictionary,
	"entities/helpers": {
		GetEntityIndexFromIntegerHandle() {
			return 12;
		},
	},
};

InstallDependency(g_strFilesystemPath, g_NativeFilesystem);
InstallDependency(g_strGlobalsPath, g_NativeGlobals);
InstallDependency(g_strListenersPath, {
	NetworkedEntityCreatedManager: g_NetworkedEntityCreatedManager,
	NetworkedEntityDeletedManager: g_NetworkedEntityDeletedManager,
});
InstallDependency(g_strPathsPath, g_NativePaths);

const g_OriginalResolveFilename = g_Module._resolveFilename;
g_Module._resolveFilename = function ResolveFilename(strRequest, Parent, bIsMain, Options) {
	if (strRequest === "filesystem") {
		return g_strFilesystemPath;
	}

	if (strRequest === "globals") {
		return g_strGlobalsPath;
	}

	if (strRequest === "listeners") {
		return g_strListenersPath;
	}

	if (strRequest === "internal/runtime") {
		return g_strRuntimePath;
	}

	if (strRequest === "paths") {
		return g_strPathsPath;
	}

	return g_OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
};

function VerifyEntityDataRootPaths() {
	const strSource = g_FileSystem.readFileSync(g_strEntityDataPath, "utf8");
	const vecRootPaths = [
		["//server/share", "//server/share/entities/index.json"],
		["\\\\server\\share", "//server/share/entities/index.json"],
		["//server//share///data/", "//server/share/data/entities/index.json"],
		["C:\\game\\addons\\", "C:/game/addons/entities/index.json"],
		["/srv/sourcejs/data", "/srv/sourcejs/data/entities/index.json"],
		["relative\\data", "relative/data/entities/index.json"],
	];
	let unScenarioCount = 0;
	for (const [strSourceDataRoot, strExpectedIndexPath] of vecRootPaths) {
		const ModuleRecord = { exports: {} };
		const RequireDependency = (strName) => {
			g_Assert.ok(["filesystem", "globals", "paths"].includes(strName));

			return (strName === "paths") ? { SOURCE_DATA_ROOT: strSourceDataRoot } : {};
		};
		g_VM.runInNewContext(strSource, { module: ModuleRecord, require: RequireDependency }, { filename: g_strEntityDataPath });
		g_Assert.equal(ModuleRecord.exports.GetEntityDataPath(), strExpectedIndexPath, "Entity profile paths must preserve the UNC prefix.");
		const strExpectedProfilePath = strExpectedIndexPath.replace(/index\.json$/, "nested/CBaseEntity.ini");
		g_Assert.equal(ModuleRecord.exports.GetEntityDataPath("nested\\CBaseEntity.ini"), strExpectedProfilePath);
		unScenarioCount += 2;
	}

	const ModuleRecord = { exports: {} };
	const JoinPath = g_VM.runInNewContext(strSource + "\nJoinSlashPath;", {
		module: ModuleRecord,
		require() {
			return {};
		},
	});
	for (const InvalidPart of [null, undefined, 1, {}, []]) {
		g_Assert.throws(() => JoinPath("root", InvalidPart), (ErrorValue) => ErrorValue.name === "TypeError");
		unScenarioCount += 1;
	}

	g_Assert.equal(JoinPath("", ""), "");
	unScenarioCount += 1;
	g_Assert.equal(unScenarioCount, 18);
	console.log("Entity profile root paths 18 profiles passed.");
}

VerifyEntityDataRootPaths();

function VerifyEntityDataSectionKeys() {
	const strSource = g_FileSystem.readFileSync(g_strEntityDataPath, "utf8");
	const mapFiles = new Map([
		["/profiles/entities/index.json", JSON.stringify({ Branches: { sdk2013: [] }, Groups: { common: ["CBaseEntity.ini"] } })],
		["/profiles/entities/CBaseEntity.ini", "[property]\nHealth=m_iHealth"],
	]);
	const ModuleRecord = { exports: {} };
	const RequireDependency = (strName) => {
		if (strName === "filesystem") {
			return {
				DoesFileExist(strPath) {
					return mapFiles.has(strPath);
				},
				ReadTextFile(strPath) {
					g_Assert.equal(mapFiles.has(strPath), true);

					return mapFiles.get(strPath);
				},
			};
		}

		if (strName === "globals") {
			return { GetGlobalVariables: () => ({ SDKBranch: "sdk2013" }) };
		}

		g_Assert.equal(strName, "paths");

		return { SOURCE_DATA_ROOT: "/profiles" };
	};
	const Context = g_VM.createContext({ module: ModuleRecord, require: RequireDependency });
	g_VM.runInContext(strSource, Context, { filename: g_strEntityDataPath });

	const Prototype = g_VM.runInContext("Object.prototype", Context);
	const DataModule = ModuleRecord.exports;
	const ClassData = DataModule.GetEntityClassData("CBaseEntity", "sdk2013");
	let unScenarioCount = 0;
	for (const strSectionName of ["BasedAttributes", "Functions", "Inputs", "InstanceAttributes", "KeyValues", "Properties", "VirtualFunctions"]) {
		g_Assert.equal(DataModule.GetEntityDataSection("CBaseEntity", strSectionName, "sdk2013"), ClassData[strSectionName]);
		const strRawSectionName = strSectionName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
		g_Assert.equal(DataModule.GetEntityDataSection("CBaseEntity", strRawSectionName, "sdk2013"), ClassData[strSectionName]);

		const strInjectedSectionName = `Injected${strSectionName}`;
		Object.defineProperty(Prototype, strInjectedSectionName, { configurable: true, value: strSectionName });
		g_Assert.equal(DataModule.GetEntityDataSection("CBaseEntity", strInjectedSectionName, "sdk2013"), null, "Unknown entity data sections must not use inherited aliases.");
		unScenarioCount += 3;
	}

	Object.defineProperty(Prototype, "InjectedScalar", { configurable: true, value: "Binary" });
	g_Assert.equal(DataModule.GetEntityDataSection("CBaseEntity", "InjectedScalar", "sdk2013"), null);
	unScenarioCount += 1;
	g_Assert.equal(unScenarioCount, 22);
	console.log("Entity profile section keys 22 profiles passed.");
}

VerifyEntityDataSectionKeys();

function GetUnroutedEntityProfileClassData(DataModule, strProfileFileName, strProfileText) {
	const strGroupName = g_Path.posix.dirname(strProfileFileName);
	g_Assert.ok(DataModule.GetSupportedEntityDataGroups().includes(strGroupName), `${strProfileFileName} must retain its indexed group`);

	for (const strCandidateSDKBranch of DataModule.GetSupportedEntityDataSDKBranches()) {
		g_Assert.ok(!DataModule.GetEntityDataGroups(strCandidateSDKBranch).includes(strGroupName), `${strProfileFileName} must remain unselected by ${strCandidateSDKBranch}`);
	}

	const ProfileModule = { exports: {} };
	const ProfileTools = g_VM.runInNewContext(g_FileSystem.readFileSync(g_strEntityDataPath, "utf8") + "\n({ ParseEntityDataConfiguration, NormalizeEntityDataConfiguration });", {
		module: ProfileModule,
		exports: ProfileModule.exports,
		require(strModuleName) {
			g_Assert.ok(["filesystem", "globals", "paths"].includes(strModuleName));

			return {};
		},
	});

	return ProfileTools.NormalizeEntityDataConfiguration(ProfileTools.ParseEntityDataConfiguration(strProfileText));
}

function VerifyCanonicalEntityProfile(DataModule, strProfileFileName, strSDKBranch, unExpectedAliasCount, ExpectedAliases = {}, vecExpectedCanonicalTypes = []) {
	const strProfilePath = g_Path.join(g_strSourceDataRoot, "entities", strProfileFileName);
	const strProfileText = g_FileSystem.readFileSync(strProfilePath, "utf8");
	g_Assert.ok(!strProfileText.includes("\r\n") || !strProfileText.replace(/\r\n/g, "").includes("\n"), `${strProfileFileName} line endings must be consistent`);

	const vecAliasNames = [...strProfileText.matchAll(/^\t(?:\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]|([A-Za-z_][A-Za-z0-9_]*)\s*=)/gm)].map(vecMatch => vecMatch[1] ?? vecMatch[2]);
	g_Assert.equal(vecAliasNames.length, unExpectedAliasCount, `${strProfileFileName} must retain every public alias`);

	for (const strAliasName of vecAliasNames) {
		g_Assert.match(strAliasName, /^[A-Z][A-Za-z0-9]*$/, `${strProfileFileName} packaged aliases must already use PascalCase`);
	}

	const vecTypeNames = [...strProfileText.matchAll(/^\t{2}(?:type|return_type|arguments)\s*=\s*([^\r\n]+)/gm)].flatMap(vecMatch => vecMatch[1].split(",").map(strTypeName => strTypeName.trim()));
	for (const strTypeName of vecTypeNames) {
		g_Assert.match(strTypeName, /^[a-z][a-z0-9]*$/, `${strProfileFileName} type discriminators must use canonical compact names`);
	}

	for (const strTypeName of vecExpectedCanonicalTypes) {
		g_Assert.ok(vecTypeNames.includes(strTypeName), `${strProfileFileName} type discriminators must use canonical compact names`);
	}

	const ClassData = (strSDKBranch === null) ? GetUnroutedEntityProfileClassData(DataModule, strProfileFileName, strProfileText) : DataModule.GetEntityClassData(g_Path.basename(strProfileFileName, ".ini"), strSDKBranch);
	for (const vecSectionEntry of Object.entries(ExpectedAliases)) {
		const strSectionName = vecSectionEntry[0];
		const AliasNames = vecSectionEntry[1];
		for (const vecAliasEntry of Object.entries(AliasNames)) {
			const strAliasName = vecAliasEntry[0];
			const strNativeName = vecAliasEntry[1];
			g_Assert.equal(ClassData[strSectionName]?.[strAliasName]?.Name, strNativeName, `${strProfileFileName} actual SDK lookup must retain ${strSectionName}.${strAliasName}`);
		}
	}
}

let g_Data = null;
let g_Dictionary = null;
let g_GameData = null;

try {
	g_Data = require(g_strEntityDataPath);
	g_Dictionary = require(g_strEntityDictionaryPath);
	g_GameData = require(g_strMemoryGameDataPath);
} finally {
	g_Module._resolveFilename = g_OriginalResolveFilename;
}

const g_vecExpectedBranches = [
	"bgt",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"css",
	"darkm",
	"dods",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2dm",
	"insurgency",
	"l4d",
	"l4d2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf2",
];
const g_vecExpectedExports = [
	"ClearEntityDataCache",
	"GetEntityBasedAttributeDescriptor",
	"GetEntityClassData",
	"GetEntityClassDataNames",
	"GetEntityDataGroups",
	"GetEntityDataPath",
	"GetEntityDataSection",
	"GetEntityFunctionDescriptor",
	"GetEntityInputDescriptor",
	"GetEntityInstanceAttributeDescriptor",
	"GetEntityKeyValueDescriptor",
	"GetEntityPropertyDescriptor",
	"GetEntityVirtualFunctionDescriptor",
	"GetSupportedEntityDataGroups",
	"GetSupportedEntityDataSDKBranches",
	"HasEntityClassData",
	"LoadEntityData",
];

g_Assert.deepEqual(g_Data.GetSupportedEntityDataSDKBranches(), g_vecExpectedBranches);
g_Assert.equal(Object.isFrozen(g_Data.GetSupportedEntityDataSDKBranches()), true);
g_Assert.deepEqual(Object.keys(g_Data).sort(), g_vecExpectedExports);

for (const strSource2Branch of ["cs2", "deadlock", "dota"]) {
	g_Assert.equal(g_Data.GetSupportedEntityDataSDKBranches().includes(strSource2Branch), false);
	g_Assert.throws(() => g_Data.GetEntityDataGroups(strSource2Branch), /Unsupported entity data SDK branch/);
}

g_Assert.deepEqual(g_Data.GetEntityDataGroups("tf2"), ["common", "orangebox", "orangebox/tf"]);
g_Assert.deepEqual(g_Data.GetEntityDataGroups("l4d2"), ["common", "l4d2"]);
g_Assert.deepEqual(g_Data.GetEntityDataGroups("blade"), ["common"]);
g_Assert.equal(g_Data.HasEntityClassData("CBaseEntity", "blade"), true);

const g_BaseEntity = g_Data.GetEntityClassData("CBaseEntity", "tf2");
g_Assert.equal(g_BaseEntity.ClassName, "CBaseEntity");
g_Assert.equal(g_BaseEntity.VirtualFunctions.SetModel.Arguments[0], "string");
g_Assert.equal(g_BaseEntity.VirtualFunctions.GetSolidMask.ReturnType, "uint");
g_Assert.equal(g_Data.GetEntityKeyValueDescriptor("CBaseEntity", "RenderAmount", "tf2").Type, "short");
g_Assert.equal(g_Data.GetEntityInputDescriptor("CBaseEntity", "AddContext", "tf2").Name, "AddContext");
g_Assert.equal(g_Data.GetEntityClassData("CBaseEntity", "csgo").ServerCheckEnabled, false);
g_Assert.equal(g_BaseEntity.KeyValues.ViewOffset.Name, "view_ofs");
g_Assert.equal(Object.hasOwn(g_BaseEntity.KeyValues, "viewOfs"), false);
g_Assert.equal(Object.hasOwn(g_BaseEntity.KeyValues, "renderAmt"), false);

const g_BasePlayer = g_Data.GetEntityClassData("CBasePlayer", "tf2");
g_Assert.equal(g_BasePlayer.Properties.HiddenHUDElements.Name, "m_Local.m_iHideHUD");
g_Assert.equal(Object.hasOwn(g_BasePlayer.Properties, "hiddenHuds"), false);

const g_BaseTrigger = g_Data.GetEntityClassData("CBaseTrigger", "tf2");
g_Assert.equal(g_BaseTrigger.Inputs.EndTouch.Name, "EndTouch");
g_Assert.equal(g_BaseTrigger.Inputs.StartTouch.Name, "StartTouch");
g_Assert.equal(Object.hasOwn(g_BaseTrigger.Inputs, "inputEndTouch"), false);
g_Assert.equal(Object.hasOwn(g_BaseTrigger.Inputs, "inputStartTouch"), false);

const g_Breakable = g_Data.GetEntityClassData("CBreakable", "tf2");
g_Assert.equal(g_Breakable.KeyValues.ExplosionMagnitude.Name, "explodemagnitude");
g_Assert.equal(g_Breakable.KeyValues.GibDirection.Name, "gibdir");
g_Assert.equal(g_Breakable.KeyValues.MinimumHealthDamage.Name, "minhealthdmg");
g_Assert.equal(g_Breakable.KeyValues.PhysicsDamageScale.Name, "physdamagescale");
g_Assert.equal(g_Breakable.Properties.ExplosionRadius.Name, "m_explodeRadius");
g_Assert.equal(g_Breakable.Properties.MaximumBreakableSize.Name, "m_iMaxBreakableSize");
g_Assert.equal(Object.hasOwn(g_Breakable.KeyValues, "explodeMagnitude"), false);
g_Assert.equal(Object.hasOwn(g_Breakable.KeyValues, "gibDir"), false);
g_Assert.equal(Object.hasOwn(g_Breakable.KeyValues, "minHealthDmg"), false);
g_Assert.equal(Object.hasOwn(g_Breakable.KeyValues, "physDamageScale"), false);
g_Assert.equal(Object.hasOwn(g_Breakable.Properties, "explodeRadius"), false);
g_Assert.equal(Object.hasOwn(g_Breakable.Properties, "maxBreakableSize"), false);

const g_CombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "tf2");
g_Assert.equal(g_CombatCharacter.KeyValues.PhysicsDamageScale.Name, "physdamagescale");
g_Assert.equal(Object.hasOwn(g_CombatCharacter.KeyValues, "physDamageScale"), false);

const g_BreakableProp = g_Data.GetEntityClassData("CBreakableProp", "tf2");
g_Assert.equal(g_BreakableProp.KeyValues.ExplosionDamage.Name, "ExplodeDamage");
g_Assert.equal(g_BreakableProp.KeyValues.ExplosionRadius.Name, "ExplodeRadius");
g_Assert.equal(g_BreakableProp.KeyValues.MinimumHealthDamage.Name, "minhealthdmg");
g_Assert.equal(g_BreakableProp.KeyValues.PhysicsDamageScale.Name, "physdamagescale");
g_Assert.equal(g_BreakableProp.Properties.FlareEntity.Name, "m_hFlareEnt");
g_Assert.equal(g_BreakableProp.Properties.MaximumBreakableSize.Name, "m_iMaxBreakableSize");
g_Assert.equal(g_BreakableProp.Properties.BreakableChunkCount.Name, "m_iNumBreakableChunks");
g_Assert.equal(Object.hasOwn(g_BreakableProp.KeyValues, "explodeDamage"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.KeyValues, "explodeRadius"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.KeyValues, "minHealthDmg"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.KeyValues, "physDamageScale"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.Properties, "flareEnt"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.Properties, "maxBreakableSize"), false);
g_Assert.equal(Object.hasOwn(g_BreakableProp.Properties, "numBreakableChunks"), false);

const g_DynamicLight = g_Data.GetEntityClassData("CDynamicLight", "tf2");
g_Assert.equal(g_DynamicLight.Properties.IsOn.Name, "m_On");
g_Assert.equal(g_DynamicLight.Properties.SpotlightRadius.Name, "m_SpotRadius");
g_Assert.equal(Object.hasOwn(g_DynamicLight.Properties, "on"), false);
g_Assert.equal(Object.hasOwn(g_DynamicLight.Properties, "spotRadius"), false);

const g_DynamicProp = g_Data.GetEntityClassData("CDynamicProp", "tf2");
g_Assert.equal(g_DynamicProp.KeyValues.DefaultAnimation.Name, "DefaultAnim");
g_Assert.equal(g_DynamicProp.KeyValues.MaximumAnimationTime.Name, "MaxAnimTime");
g_Assert.equal(g_DynamicProp.KeyValues.MinimumAnimationTime.Name, "MinAnimTime");
g_Assert.equal(g_DynamicProp.Properties.BoneCount.Name, "m_BoneFollowerManager.m_iNumBones");
g_Assert.equal(g_DynamicProp.Properties.UsesHitboxesForRenderBox.Name, "m_bUseHitboxesForRenderBox");
g_Assert.equal(Object.hasOwn(g_DynamicProp.KeyValues, "defaultAnim"), false);
g_Assert.equal(Object.hasOwn(g_DynamicProp.KeyValues, "maxAnimTime"), false);
g_Assert.equal(Object.hasOwn(g_DynamicProp.KeyValues, "minAnimTime"), false);
g_Assert.equal(Object.hasOwn(g_DynamicProp.Properties, "numBones"), false);
g_Assert.equal(Object.hasOwn(g_DynamicProp.Properties, "useHitboxes"), false);

const g_EnvironmentExplosion = g_Data.GetEntityClassData("CEnvExplosion", "tf2");
g_Assert.equal(g_EnvironmentExplosion.Properties.IgnoredClass.Name, "m_iClassIgnore");
g_Assert.equal(g_EnvironmentExplosion.Properties.IgnoredEntity.Name, "m_hEntityIgnore");
g_Assert.equal(Object.hasOwn(g_EnvironmentExplosion.Properties, "classIgnore"), false);
g_Assert.equal(Object.hasOwn(g_EnvironmentExplosion.Properties, "entityIgnore"), false);

const g_ProjectedTexture = g_Data.GetEntityClassData("CEnvProjectedTexture", "tf2");
g_Assert.equal(g_ProjectedTexture.KeyValues.LightColor.Name, "lightcolor");
g_Assert.equal(g_ProjectedTexture.KeyValues.LightColor.Type, "string");
g_Assert.equal(g_ProjectedTexture.Properties.IsEnabled.Name, "m_bState");
g_Assert.equal(Object.hasOwn(g_ProjectedTexture.KeyValues, "lightColorString"), false);
g_Assert.equal(Object.hasOwn(g_ProjectedTexture.Properties, "state"), false);

const g_EnvironmentSpark = g_Data.GetEntityClassData("CEnvSpark", "tf2");
g_Assert.equal(g_EnvironmentSpark.KeyValues.MaximumDelay.Name, "MaxDelay");
g_Assert.equal(Object.hasOwn(g_EnvironmentSpark.KeyValues, "maxDelay"), false);

const g_FogController = g_Data.GetEntityClassData("CFogController", "tf2");
g_Assert.equal(g_FogController.Inputs.SetColorInterpolationTarget.Name, "SetColorLerpTo");
g_Assert.equal(g_FogController.Inputs.SetSecondaryColor.Name, "SetColorSecondary");
g_Assert.equal(g_FogController.Inputs.SetSecondaryColorInterpolationTarget.Name, "SetColorSecondaryLerpTo");
g_Assert.equal(g_FogController.Inputs.SetEndDistance.Name, "SetEndDist");
g_Assert.equal(g_FogController.Inputs.SetEndDistanceInterpolationTarget.Name, "SetEndDistLerpTo");
g_Assert.equal(g_FogController.Inputs.SetMaximumDensity.Name, "SetMaxDensity");
g_Assert.equal(g_FogController.Inputs.SetStartDistance.Name, "SetStartDist");
g_Assert.equal(g_FogController.Inputs.SetStartDistanceInterpolationTarget.Name, "SetStartDistLerpTo");
g_Assert.equal(g_FogController.KeyValues.FogBlendingEnabled.Name, "fogblend");
g_Assert.equal(g_FogController.KeyValues.SecondaryFogColor.Name, "fogcolor2");
g_Assert.equal(g_FogController.KeyValues.FogDirection.Name, "fogdir");
g_Assert.equal(g_FogController.KeyValues.FogEnabled.Name, "fogenable");
g_Assert.equal(g_FogController.KeyValues.FogEndDistance.Name, "fogend");
g_Assert.equal(g_FogController.KeyValues.FogInterpolationTime.Name, "foglerptime");
g_Assert.equal(g_FogController.KeyValues.FogMaximumDensity.Name, "fogmaxdensity");
g_Assert.equal(g_FogController.KeyValues.FogStartDistance.Name, "fogstart");
g_Assert.equal(g_FogController.KeyValues.UsesAngles.Name, "use_angles");
g_Assert.equal(Object.hasOwn(g_FogController.Inputs, "setColorLerpTo"), false);
g_Assert.equal(Object.hasOwn(g_FogController.Inputs, "setEndDist"), false);
g_Assert.equal(Object.hasOwn(g_FogController.Inputs, "setMaxDensity"), false);
g_Assert.equal(Object.hasOwn(g_FogController.Inputs, "setStartDist"), false);
g_Assert.equal(Object.hasOwn(g_FogController.KeyValues, "fogColor2"), false);
g_Assert.equal(Object.hasOwn(g_FogController.KeyValues, "fogDir"), false);
g_Assert.equal(Object.hasOwn(g_FogController.KeyValues, "fogLerpTime"), false);
g_Assert.equal(Object.hasOwn(g_FogController.KeyValues, "fogMaxDensity"), false);

const g_Rotating = g_Data.GetEntityClassData("CFuncRotating", "tf2");
g_Assert.equal(g_Rotating.Inputs.StopAtStartPosition.Name, "StopAtStartPos");
g_Assert.equal(g_Rotating.KeyValues.Damage.Name, "dmg");
g_Assert.equal(g_Rotating.Properties.StartAngle.Name, "m_angStart");
g_Assert.equal(g_Rotating.Properties.MaximumSpeed.Name, "m_flMaxSpeed");
g_Assert.equal(g_Rotating.Properties.MovementAngle.Name, "m_vecMoveAng");
g_Assert.equal(g_Rotating.Properties.StopAtStartPosition.Name, "m_bStopAtStartPos");
g_Assert.equal(Object.hasOwn(g_Rotating.Inputs, "stopAtStartPos"), false);
g_Assert.equal(Object.hasOwn(g_Rotating.KeyValues, "dmg"), false);
g_Assert.equal(Object.hasOwn(g_Rotating.Properties, "angStart"), false);
g_Assert.equal(Object.hasOwn(g_Rotating.Properties, "maxSpeed"), false);
g_Assert.equal(Object.hasOwn(g_Rotating.Properties, "moveAng"), false);
g_Assert.equal(Object.hasOwn(g_Rotating.Properties, "stopAtStartPos"), false);

const g_unParticleControlPointCount = 63;
const g_unParentedParticleControlPointCount = 7;

const g_ParticleSystem = g_Data.GetEntityClassData("CParticleSystem", "tf2");
const g_vecParticleControlPoints = Object.keys(g_ParticleSystem.KeyValues).filter((strName) => /^ControlPoint\d+$/.test(strName));
g_Assert.equal(g_vecParticleControlPoints.length, g_unParticleControlPointCount);

for (let unControlPointNumber = 1; unControlPointNumber <= g_unParticleControlPointCount; unControlPointNumber += 1) {
	g_Assert.equal(g_ParticleSystem.KeyValues[`ControlPoint${unControlPointNumber}`].Name, `cpoint${unControlPointNumber}`);
}

for (let unControlPointNumber = 1; unControlPointNumber <= g_unParentedParticleControlPointCount; unControlPointNumber += 1) {
	g_Assert.equal(g_ParticleSystem.KeyValues[`ControlPoint${unControlPointNumber}Parent`].Name, `cpoint${unControlPointNumber}_parent`);
}

g_Assert.equal(g_ParticleSystem.KeyValues.StartsActive.Name, "start_active");
g_Assert.equal(g_ParticleSystem.KeyValues.IsWeather.Name, "flag_as_weather");
g_Assert.equal(g_ParticleSystem.Properties.IsActive.Name, "m_bActive");
g_Assert.equal(g_ParticleSystem.Properties.IsWeatherEffect.Name, "m_bWeatherEffect");
g_Assert.equal(Object.hasOwn(g_ParticleSystem.KeyValues, "cpoint1"), false);
g_Assert.equal(Object.hasOwn(g_ParticleSystem.KeyValues, "startActive"), false);
g_Assert.equal(Object.hasOwn(g_ParticleSystem.KeyValues, "flagAsWeather"), false);
g_Assert.equal(Object.hasOwn(g_ParticleSystem.Properties, "active"), false);
g_Assert.equal(Object.hasOwn(g_ParticleSystem.Properties, "weatherEffect"), false);

const g_PointHurt = g_Data.GetEntityClassData("CPointHurt", "tf2");
g_Assert.equal(g_PointHurt.KeyValues.DamageDelay.Name, "DamageDelay");
g_Assert.equal(g_PointHurt.KeyValues.DamageRadius.Name, "DamageRadius");
g_Assert.equal(g_PointHurt.KeyValues.DamageTarget.Name, "DamageTarget");
g_Assert.equal(Object.hasOwn(g_PointHurt.KeyValues, "delay"), false);
g_Assert.equal(Object.hasOwn(g_PointHurt.KeyValues, "radius"), false);
g_Assert.equal(Object.hasOwn(g_PointHurt.KeyValues, "target"), false);

const g_Precipitation = g_Data.GetEntityClassData("CPrecipitation", "tf2");
g_Assert.equal(g_Precipitation.KeyValues.PrecipitationType.Name, "preciptype");
g_Assert.equal(Object.hasOwn(g_Precipitation.KeyValues, "precipType"), false);

const g_SpriteTrail = g_Data.GetEntityClassData("CSpriteTrail", "tf2");
g_Assert.equal(g_SpriteTrail.KeyValues.IsAnimated.Name, "animate");
g_Assert.equal(g_SpriteTrail.Properties.MinimumFadeLength.Name, "m_flMinFadeLength");
g_Assert.equal(g_SpriteTrail.Properties.TextureResolution.Name, "m_flTextureRes");
g_Assert.equal(Object.hasOwn(g_SpriteTrail.KeyValues, "animate"), false);
g_Assert.equal(Object.hasOwn(g_SpriteTrail.Properties, "minFadeLength"), false);
g_Assert.equal(Object.hasOwn(g_SpriteTrail.Properties, "textureRes"), false);

const g_Team = g_Data.GetEntityClassData("CTeam", "tf2");
g_Assert.equal(g_Team.Properties.TeamNumber.Name, "m_iTeamNum");
g_Assert.equal(Object.hasOwn(g_Team.Properties, "team"), false);

const g_World = g_Data.GetEntityClassData("CWorld", "tf2");
g_Assert.equal(g_World.KeyValues.IsColdWorld.Name, "coldworld");
g_Assert.equal(g_World.KeyValues.MaximumOccludeeArea.Name, "maxoccludeearea");
g_Assert.equal(g_World.KeyValues.MaximumPropScreenWidth.Name, "maxpropscreenwidth");
g_Assert.equal(g_World.KeyValues.MinimumOccluderArea.Name, "minoccluderarea");
g_Assert.equal(g_World.KeyValues.MinimumPropScreenWidth.Name, "minpropscreenwidth");
g_Assert.equal(g_World.KeyValues.StartsDark.Name, "startdark");
g_Assert.equal(g_World.Properties.DisplaysTitle.Name, "m_bDisplayTitle");
g_Assert.equal(g_World.Properties.WorldMaximumBounds.Name, "m_WorldMaxs");
g_Assert.equal(g_World.Properties.WorldMinimumBounds.Name, "m_WorldMins");
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "coldWorld"), false);
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "maxOccluderArea"), false);
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "maxPropScreenWidth"), false);
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "minOccluderArea"), false);
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "minPropScreenWidth"), false);
g_Assert.equal(Object.hasOwn(g_World.KeyValues, "startDark"), false);
g_Assert.equal(Object.hasOwn(g_World.Properties, "displayTitle"), false);
g_Assert.equal(Object.hasOwn(g_World.Properties, "worldMaxs"), false);
g_Assert.equal(Object.hasOwn(g_World.Properties, "worldMins"), false);

const g_CSGOCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "csgo");
g_Assert.equal(g_CSGOCombatWeapon.Properties.PrimaryReserveAmmoCount.Name, "m_iPrimaryReserveAmmoCount");
g_Assert.equal(g_CSGOCombatWeapon.Properties.SecondaryReserveAmmoCount.Name, "m_iSecondaryReserveAmmoCount");
g_Assert.equal(Object.hasOwn(g_CSGOCombatWeapon.Properties, "primaryAmmoCount"), false);
g_Assert.equal(Object.hasOwn(g_CSGOCombatWeapon.Properties, "secondaryAmmoCount"), false);

const g_CSGOGrenadeProjectile = g_Data.GetEntityClassData("CBaseCSGrenadeProjectile", "csgo");
g_Assert.equal(g_CSGOGrenadeProjectile.Properties.BounceCount.Name, "m_nBounces");
g_Assert.equal(Object.hasOwn(g_CSGOGrenadeProjectile.Properties, "bounces"), false);

const g_CSGOBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "csgo");
g_Assert.equal(g_CSGOBasePlayer.BasedAttributes.Assists.Base, "m_iFrags");
g_Assert.equal(g_CSGOBasePlayer.BasedAttributes.Assists.Offset, 0x04);
g_Assert.equal(g_CSGOBasePlayer.Properties.ViewOffset.Name, "localdata.m_vecViewOffset[0]");
g_Assert.equal(g_CSGOBasePlayer.Properties.ViewOffset.Type, "vector");

const g_CSGOBombTarget = g_Data.GetEntityClassData("CBombTarget", "csgo");
g_Assert.equal(g_CSGOBombTarget.Inputs.BombExploded.Name, "BombExplode");
g_Assert.equal(Object.hasOwn(g_CSGOBombTarget.Inputs, "bombExplode"), false);

const g_CSGOBreakableProp = g_Data.GetEntityClassData("CBreakableProp", "csgo");
g_Assert.equal(g_CSGOBreakableProp.Properties.UsesClientPhysics.Name, "m_bClientPhysics");
g_Assert.equal(Object.hasOwn(g_CSGOBreakableProp.Properties, "clientPhysics"), false);

const g_BMSBreakableProp = g_Data.GetEntityClassData("CBreakableProp", "bms");
g_Assert.equal(g_BMSBreakableProp.Properties.UsesClientPhysics.Name, "m_bClientPhysics");
g_Assert.equal(Object.hasOwn(g_BMSBreakableProp.Properties, "clientPhysics"), false);

const g_CSGOPlayer = g_Data.GetEntityClassData("CCSPlayer", "csgo");
g_Assert.deepEqual(g_CSGOPlayer.Functions.AddAccount.Arguments, ["int", "bool", "bool", "string"]);
g_Assert.deepEqual(g_CSGOPlayer.Functions.BuyInternal.Arguments, ["string", "int", "bool"]);
g_Assert.deepEqual(g_CSGOPlayer.Functions.Deafen.Arguments, ["float"]);
g_Assert.equal(g_CSGOPlayer.Functions.RoundRespawn.Name.length > 0, true);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Functions, "spawn"), false);
g_Assert.equal(g_CSGOPlayer.BasedAttributes.MVPCount.Offset, 0x0B);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.BasedAttributes, "mvps"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.BasedAttributes, "MvpCount"), false);
g_Assert.equal(g_CSGOPlayer.Properties.HasNightVision.Name, "m_bHasNightVision");
g_Assert.equal(g_CSGOPlayer.Properties.IsInBombZone.Name, "m_bInBombZone");
g_Assert.equal(g_CSGOPlayer.Properties.IsInBuyZone.Name, "m_bInBuyZone");
g_Assert.equal(g_CSGOPlayer.Properties.IsInHostageRescueZone.Name, "m_bInHostageRescueZone");
g_Assert.equal(g_CSGOPlayer.Properties.NightVisionEnabled.Name, "m_bNightVisionOn");
g_Assert.equal(g_CSGOPlayer.Properties.MaximumFlashAlpha.Name, "m_flFlashMaxAlpha");
g_Assert.equal(g_CSGOPlayer.Properties.GunGameImmunity.Name, "m_bGunGameImmunity");
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "hasNightvision"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "inBombZone"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "inBuyZone"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "inRescueZone"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "nightvisionOn"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "flashAlpha"), false);
g_Assert.equal(Object.hasOwn(g_CSGOPlayer.Properties, "gungameImmunity"), false);

const g_CSGODynamicProp = g_Data.GetEntityClassData("CDynamicProp", "csgo");
g_Assert.equal(g_CSGODynamicProp.Inputs.SetGlowBlueValue.Name, "GlowColorBlueValue");
g_Assert.equal(g_CSGODynamicProp.Inputs.SetGlowGreenValue.Name, "GlowColorGreenValue");
g_Assert.equal(g_CSGODynamicProp.Inputs.SetGlowRedValue.Name, "GlowColorRedValue");
g_Assert.equal(g_CSGODynamicProp.Inputs.DisableGlow.Name, "SetGlowDisabled");
g_Assert.equal(g_CSGODynamicProp.Inputs.EnableGlow.Name, "SetGlowEnabled");
g_Assert.equal(g_CSGODynamicProp.KeyValues.AnimatesEveryFrame.Name, "AnimateEveryFrame");
g_Assert.equal(g_CSGODynamicProp.KeyValues.BoneFollowersDisabled.Name, "DisableBoneFollowers");
g_Assert.equal(g_CSGODynamicProp.KeyValues.HoldsAnimation.Name, "HoldAnimation");
g_Assert.equal(g_CSGODynamicProp.Properties.IsAnimationDone.Name, "m_bAnimationDone");
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.Inputs, "colorGlowBlue"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.Inputs, "setGlowDisabled"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.Inputs, "setGlowEnabled"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.KeyValues, "animateEveryFrame"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.KeyValues, "disableBoneFollowers"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.KeyValues, "holdAnimation"), false);
g_Assert.equal(Object.hasOwn(g_CSGODynamicProp.Properties, "animationDone"), false);

const g_CSGOProjectedTexture = g_Data.GetEntityClassData("CEnvProjectedTexture", "csgo");
g_Assert.equal(g_CSGOProjectedTexture.Inputs.DisableAlwaysUpdate.Name, "AlwaysUpdateOff");
g_Assert.equal(g_CSGOProjectedTexture.Inputs.EnableAlwaysUpdate.Name, "AlwaysUpdateOn");
g_Assert.equal(g_CSGOProjectedTexture.Properties.AlwaysUpdates.Name, "m_bAlwaysUpdate");
g_Assert.equal(Object.hasOwn(g_CSGOProjectedTexture.Inputs, "alwaysUpdateOff"), false);
g_Assert.equal(Object.hasOwn(g_CSGOProjectedTexture.Inputs, "alwaysUpdateOn"), false);
g_Assert.equal(Object.hasOwn(g_CSGOProjectedTexture.Properties, "alwaysUpdate"), false);

const g_CSGOMapInformation = g_Data.GetEntityClassData("CMapInfo", "csgo");
g_Assert.equal(g_CSGOMapInformation.KeyValues.BotMaximumVisionDistance.Name, "botmaxvisiondistance");
g_Assert.equal(g_CSGOMapInformation.KeyValues.DisableAutoGeneratedDeathmatchSpawns.Name, "disableautogenerateddmspawns");
g_Assert.equal(g_CSGOMapInformation.KeyValues.UseNormalSpawnsForDeathmatch.Name, "usenormalspawnsfordm");
g_Assert.equal(Object.hasOwn(g_CSGOMapInformation.KeyValues, "botMaxVisionDistance"), false);
g_Assert.equal(Object.hasOwn(g_CSGOMapInformation.KeyValues, "disableAutoGeneratedDmSpawns"), false);
g_Assert.equal(Object.hasOwn(g_CSGOMapInformation.KeyValues, "useNormalSpawnsForDm"), false);

const g_MolotovProjectile = g_Data.GetEntityClassData("CMolotovProjectile", "csgo");
g_Assert.equal(g_MolotovProjectile.Properties.IsIncendiaryGrenade.Name, "m_bIsIncGrenade");
g_Assert.equal(Object.hasOwn(g_MolotovProjectile.Properties, "isIncGrenade"), false);

const g_PlantedC4 = g_Data.GetEntityClassData("CPlantedC4", "csgo");
g_Assert.equal(g_PlantedC4.Properties.IsDefused.Name, "m_bBombDefused");
g_Assert.equal(g_PlantedC4.Properties.IsTicking.Name, "m_bBombTicking");
g_Assert.equal(g_PlantedC4.Properties.DetonationTime.Name, "m_flC4Blow");
g_Assert.equal(g_PlantedC4.Properties.DefuseCountdown.Name, "m_flDefuseCountDown");
g_Assert.equal(Object.hasOwn(g_PlantedC4.Properties, "defused"), false);
g_Assert.equal(Object.hasOwn(g_PlantedC4.Properties, "ticking"), false);
g_Assert.equal(Object.hasOwn(g_PlantedC4.Properties, "c4Blow"), false);
g_Assert.equal(Object.hasOwn(g_PlantedC4.Properties, "defuseCountDown"), false);

const g_SmokeGrenadeProjectile = g_Data.GetEntityClassData("CSmokeGrenadeProjectile", "csgo");
g_Assert.equal(g_SmokeGrenadeProjectile.Properties.SmokeEffectStartTick.Name, "m_nSmokeEffectTickBegin");
g_Assert.equal(g_SmokeGrenadeProjectile.Properties.HasProducedSmokeEffect.Name, "m_bDidSmokeEffect");
g_Assert.equal(Object.hasOwn(g_SmokeGrenadeProjectile.Properties, "smokeEffectTickBegin"), false);
g_Assert.equal(Object.hasOwn(g_SmokeGrenadeProjectile.Properties, "didSmokeEffect"), false);

const g_CSGOTeam = g_Data.GetEntityClassData("CTeam", "csgo");
g_Assert.equal(g_CSGOTeam.Properties.HasSurrendered.Name, "m_bSurrendered");
g_Assert.equal(g_CSGOTeam.Properties.TotalScore.Name, "m_scoreTotal");
g_Assert.equal(Object.hasOwn(g_CSGOTeam.Properties, "surrendered"), false);
g_Assert.equal(Object.hasOwn(g_CSGOTeam.Properties, "score"), false);

const g_GMODBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "gmod");
g_Assert.deepEqual(g_GMODBasePlayer.VirtualFunctions.BumpWeapon.Arguments, ["address"]);
g_Assert.deepEqual(g_GMODBasePlayer.VirtualFunctions.GiveNamedItem.Arguments, ["string", "int", "bool", "address"]);
g_Assert.equal(g_GMODBasePlayer.Properties.ViewOffset.Type, "vector");

const g_L4D2BreakableProp = g_Data.GetEntityClassData("CBreakableProp", "l4d2");
g_Assert.equal(g_L4D2BreakableProp.Properties.UsesClientPhysics.Name, "m_bClientPhysics");
g_Assert.equal(g_L4D2BreakableProp.Properties.GhostCollisionDisabled.Name, "m_noGhostCollision");
g_Assert.equal(Object.hasOwn(g_L4D2BreakableProp.Properties, "clientPhysics"), false);
g_Assert.equal(Object.hasOwn(g_L4D2BreakableProp.Properties, "ghostCollision"), false);

const g_L4D2DynamicProp = g_Data.GetEntityClassData("CDynamicProp", "l4d2");
g_Assert.equal(g_L4D2DynamicProp.KeyValues.GlowRangeMinimum.Name, "glowrangemin");
g_Assert.equal(Object.hasOwn(g_L4D2DynamicProp.KeyValues, "glowRangeMin"), false);

const g_L4D2Precipitation = g_Data.GetEntityClassData("CPrecipitation", "l4d2");
g_Assert.equal(g_L4D2Precipitation.KeyValues.MaximumSpeed.Name, "maxSpeed");
g_Assert.equal(g_L4D2Precipitation.KeyValues.MinimumSpeed.Name, "minSpeed");
g_Assert.equal(Object.hasOwn(g_L4D2Precipitation.KeyValues, "maxSpeed"), false);
g_Assert.equal(Object.hasOwn(g_L4D2Precipitation.KeyValues, "minSpeed"), false);

const g_TerrorWeapon = g_Data.GetEntityClassData("CTerrorWeapon", "l4d2");
g_Assert.equal(g_TerrorWeapon.Properties.LoadedUpgradedPrimaryAmmoCount.Name, "m_nUpgradedPrimaryAmmoLoaded");
g_Assert.equal(Object.hasOwn(g_TerrorWeapon.Properties, "upgradedAmmo"), false);

const g_L4D2World = g_Data.GetEntityClassData("CWorld", "l4d2");
g_Assert.equal(g_L4D2World.KeyValues.MusicPostfix.Name, "musicpostfix");
g_Assert.equal(Object.hasOwn(g_L4D2World.KeyValues, "musicPostFix"), false);

const g_OrangeBoxAnimating = g_Data.GetEntityClassData("CBaseAnimating", "tf2");
VerifyCanonicalEntityProfile(g_Data, "CBaseAnimating.ini", "tf2", 17, {
	Inputs: { BecomeRagdoll: "BecomeRagdoll", IgniteNumHitboxFires: "IgniteNumHitboxFires" },
	KeyValues: { Body: "body", HitboxSet: "hitboxset", PlaybackRate: "playbackrate" },
	Properties: { ModelScale: "m_flModelScale" },
});
VerifyCanonicalEntityProfile(g_Data, "CBaseButton.ini", "tf2", 8, {
	Inputs: { Lock: "Lock", Unlock: "Unlock" },
	KeyValues: { MoveDir: "movedir" },
	Properties: { Locked: "m_bLocked" },
});
VerifyCanonicalEntityProfile(g_Data, "CBaseEntity.ini", "tf2", 21, {
	Inputs: { AddContext: "AddContext", SetParentAttachmentMaintainOffset: "SetParentAttachmentMaintainOffset" },
	KeyValues: { ViewOffset: "view_ofs", RenderAmount: "renderamt" },
}, ["short"]);
VerifyCanonicalEntityProfile(g_Data, "CBaseGrenade.ini", "tf2", 7, {
	Properties: { Radius: "m_DmgRadius", IsLive: "m_bIsLive", Thrower: "m_hThrower", DetonateTime: "m_flDetonateTime" },
});
VerifyCanonicalEntityProfile(g_Data, "CBasePlayer.ini", "tf2", 23, {
	Inputs: { SetFogController: "SetFogController", SetHUDVisibility: "SetHUDVisibility" },
	Properties: { HiddenHUDElements: "m_Local.m_iHideHUD", FOV: "m_iFOV", FOVStart: "m_iFOVStart", FOVTime: "m_flFOVTime", DefaultFOV: "m_iDefaultFOV", FOVRate: "m_Local.m_flFOVRate", LifeState: "m_lifeState", Dead: "pl.deadflag" },
});

{
	const BasePlayerData = g_Data.GetEntityClassData("CBasePlayer", "tf2");
	g_Assert.ok(!Object.hasOwn(BasePlayerData.Inputs, "SetHudVisibility"), "CBasePlayer must not expose the legacy HUD input alias");
	for (const strLegacyPropertyName of ["HiddenHudElements", "Fov", "FovStart", "FovTime", "DefaultFov", "FovRate"]) {
		g_Assert.ok(!Object.hasOwn(BasePlayerData.Properties, strLegacyPropertyName), "CBasePlayer must not expose a legacy HUD/FOV property alias");
	}
}

VerifyCanonicalEntityProfile(g_Data, "CBasePropDoor.ini", "tf2", 15, {
	Inputs: { OpenAwayFrom: "OpenAwayFrom", Unlock: "Unlock" },
	KeyValues: { ReturnDelay: "returndelay", SoundLockedOverride: "soundlockedoverride", SlaveName: "slavename" },
});
VerifyCanonicalEntityProfile(g_Data, "CBaseTrigger.ini", "tf2", 7, {
	Inputs: { EndTouch: "EndTouch", StartTouch: "StartTouch" },
	KeyValues: { StartDisabled: "StartDisabled", FilterName: "filtername" },
});
VerifyCanonicalEntityProfile(g_Data, "CBaseViewModel.ini", "tf2", 1, { Properties: { WeaponHandle: "m_hWeapon" } });
VerifyCanonicalEntityProfile(g_Data, "CBreakable.ini", "tf2", 25, {
	Inputs: { AddHealth: "AddHealth", Break: "Break" },
	KeyValues: { ExplosionMagnitude: "explodemagnitude", PhysicsDamageScale: "physdamagescale" },
	Properties: { ExplosionRadius: "m_explodeRadius", Breaker: "m_hBreaker", MaximumBreakableSize: "m_iMaxBreakableSize", ImpactEnergyScale: "m_impactEnergyScale" },
});
VerifyCanonicalEntityProfile(g_Data, "CBreakableProp.ini", "tf2", 23, {
	Inputs: { Break: "Break", SetHealth: "SetHealth" },
	KeyValues: { ExplosionDamage: "ExplodeDamage", PhysicsDamageScale: "physdamagescale" },
	Properties: { FlareEntity: "m_hFlareEnt", BreakableChunkCount: "m_iNumBreakableChunks", PreferredCarryAngles: "m_preferredCarryAngles" },
});
VerifyCanonicalEntityProfile(g_Data, "CDynamicLight.ini", "tf2", 16, {
	Inputs: { Toggle: "Toggle", TurnOn: "TurnOn" },
	KeyValues: { SpotlightRadius: "spotlight_radius" },
	Properties: { ActualFlags: "m_ActualFlags", IsOn: "m_On", SpotlightRadius: "m_SpotRadius" },
});
VerifyCanonicalEntityProfile(g_Data, "CDynamicProp.ini", "tf2", 19, {
	Inputs: { SetAnimation: "SetAnimation", SetPlaybackRate: "SetPlaybackRate" },
	KeyValues: { DefaultAnimation: "DefaultAnim", MaximumAnimationTime: "MaxAnimTime", MinimumAnimationTime: "MinAnimTime" },
	Properties: { BoneCount: "m_BoneFollowerManager.m_iNumBones", UsesHitboxesForRenderBox: "m_bUseHitboxesForRenderBox" },
});
VerifyCanonicalEntityProfile(g_Data, "CEntityDissolve.ini", "tf2", 3, {
	Inputs: { Dissolve: "Dissolve" },
	KeyValues: { DissolveType: "dissolvetype", Magnitude: "magnitude" },
});
VerifyCanonicalEntityProfile(g_Data, "CEnvExplosion.ini", "tf2", 9, {
	Inputs: { Explode: "Explode" },
	Properties: { Magnitude: "m_iMagnitude", RadiusOverride: "m_iRadiusOverride", SpriteScale: "m_spriteScale", DamageForce: "m_flDamageForce", Inflictor: "m_hInflictor", CustomDamageType: "m_iCustomDamageType", IgnoredClass: "m_iClassIgnore", IgnoredEntity: "m_hEntityIgnore" },
});
VerifyCanonicalEntityProfile(g_Data, "CEnvProjectedTexture.ini", "tf2", 19, {
	Inputs: { FOV: "FOV", SpotlightTexture: "SpotlightTexture", Target: "Target", TurnOff: "TurnOff", TurnOn: "TurnOn" },
	KeyValues: { Ambient: "ambient", CameraSpace: "cameraspace", EnableShadows: "enableshadows", FarZ: "farz", LightFOV: "lightfov", LightOnlyTarget: "lightonlytarget", LightWorld: "lightworld", NearZ: "nearz", ShadowQuality: "shadowquality", TextureFrame: "textureframe", LightColor: "lightcolor" },
	Properties: { IsEnabled: "m_bState", TargetEntity: "m_hTargetEntity", TextureName: "texturename" },
}, ["string"]);

{
	const ProjectedTextureData = g_Data.GetEntityClassData("CEnvProjectedTexture", "tf2");
	g_Assert.ok(!Object.hasOwn(ProjectedTextureData.Inputs, "Fov"), "CEnvProjectedTexture must not expose the legacy FOV input alias");
	g_Assert.ok(!Object.hasOwn(ProjectedTextureData.KeyValues, "LightFov"), "CEnvProjectedTexture must not expose the legacy FOV keyvalue alias");
	g_Assert.equal(ProjectedTextureData.KeyValues.LightColor.Type, "string", "CEnvProjectedTexture LightColor must retain its normalized string type");
}

VerifyCanonicalEntityProfile(g_Data, "CEnvSpark.ini", "tf2", 8, {
	Inputs: { SparkOnce: "SparkOnce", StartSpark: "StartSpark", StopSpark: "StopSpark", ToggleSpark: "ToggleSpark" },
	KeyValues: { Magnitude: "Magnitude", MaximumDelay: "MaxDelay", TrailLength: "TrailLength" },
	Properties: { GlowSpriteIndex: "m_nGlowSpriteIndex" },
});
VerifyCanonicalEntityProfile(g_Data, "CFire.ini", "tf2", 8, {
	Inputs: { Extinguish: "Extinguish", ExtinguishTemporary: "ExtinguishTemporary", StartFire: "StartFire" },
	KeyValues: { DamageScale: "damagescale", FireAttack: "fireattack", FireSize: "firesize", FireType: "firetype", IgnitionPoint: "ignitionpoint" },
});
VerifyCanonicalEntityProfile(g_Data, "CFogController.ini", "tf2", 25, {
	Inputs: {
		SetAngles: "SetAngles",
		SetColor: "SetColor",
		SetColorInterpolationTarget: "SetColorLerpTo",
		SetSecondaryColor: "SetColorSecondary",
		SetSecondaryColorInterpolationTarget: "SetColorSecondaryLerpTo",
		SetEndDistance: "SetEndDist",
		SetEndDistanceInterpolationTarget: "SetEndDistLerpTo",
		SetFarZ: "SetFarZ",
		SetMaximumDensity: "SetMaxDensity",
		SetStartDistance: "SetStartDist",
		SetStartDistanceInterpolationTarget: "SetStartDistLerpTo",
		StartFogTransition: "StartFogTransition",
		TurnOff: "TurnOff",
		TurnOn: "TurnOn",
	},
	KeyValues: {
		FarZ: "farz",
		FogBlendingEnabled: "fogblend",
		FogColor: "fogcolor",
		SecondaryFogColor: "fogcolor2",
		FogDirection: "fogdir",
		FogEnabled: "fogenable",
		FogEndDistance: "fogend",
		FogInterpolationTime: "foglerptime",
		FogMaximumDensity: "fogmaxdensity",
		FogStartDistance: "fogstart",
		UsesAngles: "use_angles",
	},
});
VerifyCanonicalEntityProfile(g_Data, "CFuncRotating.ini", "tf2", 20, {
	Inputs: { Reverse: "Reverse", SetSpeed: "SetSpeed", Start: "Start", StartBackward: "StartBackward", StartForward: "StartForward", Stop: "Stop", StopAtStartPosition: "StopAtStartPos", Toggle: "Toggle" },
	KeyValues: { Damage: "dmg", Message: "message", SolidBSP: "solidbsp", FanFriction: "fanfriction" },
	Properties: { StartAngle: "m_angStart", Attenuation: "m_flAttenuation", MaximumSpeed: "m_flMaxSpeed", MovementAngle: "m_vecMoveAng", Reversed: "m_bReversed", StopAtStartPosition: "m_bStopAtStartPos", TargetSpeed: "m_flTargetSpeed", Volume: "m_flVolume" },
}, ["int"]);

{
	const RotatingData = g_Data.GetEntityClassData("CFuncRotating", "tf2");
	g_Assert.ok(!Object.hasOwn(RotatingData.KeyValues, "SolidBsp"), "CFuncRotating must not expose the legacy BSP keyvalue alias");
	g_Assert.equal(RotatingData.KeyValues.FanFriction.Type, "int", "CFuncRotating FanFriction must retain its normalized int type");
}

VerifyCanonicalEntityProfile(g_Data, "CGameEnd.ini", "tf2", 1, { Inputs: { EndGame: "EndGame" } });
VerifyCanonicalEntityProfile(g_Data, "CParticleSystem.ini", "tf2", 77, {
	Inputs: { Start: "Start", Stop: "Stop" },
	KeyValues: {
		ControlPoint1: "cpoint1",
		ControlPoint1Parent: "cpoint1_parent",
		ControlPoint2: "cpoint2",
		ControlPoint2Parent: "cpoint2_parent",
		ControlPoint3: "cpoint3",
		ControlPoint3Parent: "cpoint3_parent",
		ControlPoint4: "cpoint4",
		ControlPoint4Parent: "cpoint4_parent",
		ControlPoint5: "cpoint5",
		ControlPoint5Parent: "cpoint5_parent",
		ControlPoint6: "cpoint6",
		ControlPoint6Parent: "cpoint6_parent",
		ControlPoint7: "cpoint7",
		ControlPoint7Parent: "cpoint7_parent",
		ControlPoint8: "cpoint8",
		ControlPoint9: "cpoint9",
		ControlPoint10: "cpoint10",
		ControlPoint11: "cpoint11",
		ControlPoint12: "cpoint12",
		ControlPoint13: "cpoint13",
		ControlPoint14: "cpoint14",
		ControlPoint15: "cpoint15",
		ControlPoint16: "cpoint16",
		ControlPoint17: "cpoint17",
		ControlPoint18: "cpoint18",
		ControlPoint19: "cpoint19",
		ControlPoint20: "cpoint20",
		ControlPoint21: "cpoint21",
		ControlPoint22: "cpoint22",
		ControlPoint23: "cpoint23",
		ControlPoint24: "cpoint24",
		ControlPoint25: "cpoint25",
		ControlPoint26: "cpoint26",
		ControlPoint27: "cpoint27",
		ControlPoint28: "cpoint28",
		ControlPoint29: "cpoint29",
		ControlPoint30: "cpoint30",
		ControlPoint31: "cpoint31",
		ControlPoint32: "cpoint32",
		ControlPoint33: "cpoint33",
		ControlPoint34: "cpoint34",
		ControlPoint35: "cpoint35",
		ControlPoint36: "cpoint36",
		ControlPoint37: "cpoint37",
		ControlPoint38: "cpoint38",
		ControlPoint39: "cpoint39",
		ControlPoint40: "cpoint40",
		ControlPoint41: "cpoint41",
		ControlPoint42: "cpoint42",
		ControlPoint43: "cpoint43",
		ControlPoint44: "cpoint44",
		ControlPoint45: "cpoint45",
		ControlPoint46: "cpoint46",
		ControlPoint47: "cpoint47",
		ControlPoint48: "cpoint48",
		ControlPoint49: "cpoint49",
		ControlPoint50: "cpoint50",
		ControlPoint51: "cpoint51",
		ControlPoint52: "cpoint52",
		ControlPoint53: "cpoint53",
		ControlPoint54: "cpoint54",
		ControlPoint55: "cpoint55",
		ControlPoint56: "cpoint56",
		ControlPoint57: "cpoint57",
		ControlPoint58: "cpoint58",
		ControlPoint59: "cpoint59",
		ControlPoint60: "cpoint60",
		ControlPoint61: "cpoint61",
		ControlPoint62: "cpoint62",
		ControlPoint63: "cpoint63",
		EffectName: "effect_name",
		StartsActive: "start_active",
	},
	Properties: { IsActive: "m_bActive", EffectIndex: "m_iEffectIndex", StartTime: "m_flStartTime" },
});
VerifyCanonicalEntityProfile(g_Data, "CPointHurt.ini", "tf2", 6, {
	Inputs: { Hurt: "Hurt" },
	KeyValues: { Damage: "Damage", DamageDelay: "DamageDelay", DamageRadius: "DamageRadius", DamageTarget: "DamageTarget", DamageType: "DamageType" },
});
VerifyCanonicalEntityProfile(g_Data, "CPointServerCommand.ini", "tf2", 1, { Inputs: { Command: "Command" } });
VerifyCanonicalEntityProfile(g_Data, "CPrecipitation.ini", "tf2", 1, { KeyValues: { PrecipitationType: "preciptype" } });
VerifyCanonicalEntityProfile(g_Data, "CSmokeStack.ini", "tf2", 16, {
	Inputs: { Toggle: "Toggle", TurnOff: "TurnOff", TurnOn: "TurnOn" },
	KeyValues: {
		BaseSpread: "BaseSpread",
		EndSize: "EndSize",
		InitialState: "InitialState",
		JetLength: "JetLength",
		Rate: "Rate",
		Roll: "Roll",
		Speed: "Speed",
		SpreadSpeed: "SpreadSpeed",
		StartSize: "StartSize",
		Twist: "Twist",
		WindAngle: "WindAngle",
		WindSpeed: "WindSpeed",
		SmokeMaterial: "SmokeMaterial",
	},
}, ["string"]);
VerifyCanonicalEntityProfile(g_Data, "CSpriteTrail.ini", "tf2", 10, {
	KeyValues: { IsAnimated: "animate", EndWidth: "endwidth", LifeTime: "lifetime", SpriteName: "spritename", StartWidth: "startwidth" },
	Properties: { MinimumFadeLength: "m_flMinFadeLength", SkyboxOrigin: "m_vecSkyboxOrigin", SkyboxScale: "m_flSkyboxScale", StartWidthVariance: "m_flStartWidthVariance", TextureResolution: "m_flTextureRes" },
});
VerifyCanonicalEntityProfile(g_Data, "CStripWeapons.ini", "tf2", 2, { Inputs: { Strip: "Strip", StripWeaponsAndSuit: "StripWeaponsAndSuit" } });
VerifyCanonicalEntityProfile(g_Data, "CTeam.ini", "tf2", 2, { Properties: { TeamNumber: "m_iTeamNum", TeamName: "m_szTeamname" } });
VerifyCanonicalEntityProfile(g_Data, "CWorld.ini", "tf2", 14, {
	KeyValues: {
		ChapterTitle: "chaptertitle",
		IsColdWorld: "coldworld",
		DetailMaterial: "detailmaterial",
		GameTitle: "gametitle",
		MaximumOccludeeArea: "maxoccludeearea",
		MaximumPropScreenWidth: "maxpropscreenwidth",
		MinimumOccluderArea: "minoccluderarea",
		MinimumPropScreenWidth: "minpropscreenwidth",
		StartsDark: "startdark",
	},
	Properties: { DetailSpriteMaterial: "m_iszDetailSpriteMaterial", DisplaysTitle: "m_bDisplayTitle", WaveHeight: "m_flWaveHeight", WorldMaximumBounds: "m_WorldMaxs", WorldMinimumBounds: "m_WorldMins" },
});
VerifyCanonicalEntityProfile(g_Data, "bms/CBaseAnimating.ini", "bms", 5, {
	Inputs: { SetModelScale: "SetModelScale" },
	KeyValues: { FadeMaxDist: "fademaxdist", FadeMinDist: "fademindist", FadeScale: "fadescale", ModelScale: "modelscale" },
});

{
	const BMSAnimatingData = g_Data.GetEntityClassData("CBaseAnimating", "bms");
	g_Assert.ok(!Object.hasOwn(BMSAnimatingData.KeyValues, "Modelscale"), "BMS CBaseAnimating must not expose the legacy Modelscale keyvalue alias");
	g_Assert.equal(g_Data.GetEntityKeyValueDescriptor("CBaseAnimating", "ModelScale", "bms")?.Name, "modelscale", "BMS ModelScale public lookup must retain the native keyvalue target");
	g_Assert.equal(g_Data.GetEntityKeyValueDescriptor("CBaseAnimating", "Modelscale", "bms"), null, "BMS legacy Modelscale public lookup must remain absent");
	g_Assert.equal(BMSAnimatingData.Properties.ModelScale.Name, "m_flModelScale", "BMS keyvalue casing must preserve the inherited common ModelScale property");
}

VerifyCanonicalEntityProfile(g_Data, "bms/CBaseCombatCharacter.ini", "bms", 2, {
	VirtualFunctions: { OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
}, ["address", "int", "bool"]);
// Virtual-function offsets below are vtable slot indices, not byte offsets.
{
	const BMSCombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "bms");
	g_Assert.deepEqual(BMSCombatCharacter.VirtualFunctions.OnTakeDamageAlive.Arguments, ["address"]);
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.OnTakeDamageAlive.ReturnType, "int");
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.OnTakeDamageAlive.OffsetLinux, 293);
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.OnTakeDamageAlive.OffsetWindows, 292);
	g_Assert.deepEqual(BMSCombatCharacter.VirtualFunctions.WeaponSwitch.Arguments, ["address", "int"]);
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.WeaponSwitch.ReturnType, "bool");
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.WeaponSwitch.OffsetLinux, 285);
	g_Assert.equal(BMSCombatCharacter.VirtualFunctions.WeaponSwitch.OffsetWindows, 284);
}

VerifyCanonicalEntityProfile(g_Data, "bms/CBaseCombatWeapon.ini", "bms", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});
{
	const BMSCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "bms");
	g_Assert.equal(BMSCombatWeapon.VirtualFunctions.PrimaryAttack.OffsetLinux, 296);
	g_Assert.equal(BMSCombatWeapon.VirtualFunctions.PrimaryAttack.OffsetWindows, 295);
	g_Assert.equal(BMSCombatWeapon.VirtualFunctions.SecondaryAttack.OffsetLinux, 297);
	g_Assert.equal(BMSCombatWeapon.VirtualFunctions.SecondaryAttack.OffsetWindows, 296);
}

VerifyCanonicalEntityProfile(g_Data, "bms/CBaseEntity.ini", "bms", 10, {
	VirtualFunctions: { SetModel: "SetModel", SetParent: "SetParent", OnTakeDamage: "OnTakeDamage", Teleport: "Teleport", SetTransmit: "SetTransmit", StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", GetSolidMask: "GetSolidMask" },
	Inputs: { DispatchEffect: "DispatchEffect" },
}, ["string", "address", "int", "bool", "uint"]);
{
	const BMSBaseEntity = g_Data.GetEntityClassData("CBaseEntity", "bms");
	const vecFunctionContracts = [
		["SetModel", 27, 26, ["string"], undefined],
		["SetParent", 38, 37, ["address", "int"], undefined],
		["OnTakeDamage", 69, 68, ["address"], "int"],
		["Teleport", 119, 118, ["address", "address", "address"], undefined],
		["SetTransmit", 23, 22, ["address", "bool"], undefined],
		["StartTouch", 108, 107, ["address"], undefined],
		["Touch", 109, 108, ["address"], undefined],
		["EndTouch", 110, 109, ["address"], undefined],
		["GetSolidMask", 180, 179, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = BMSBaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "bms/CBaseFlex.ini", "bms", 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "bms/CBasePlayer.ini", "bms", 6, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon", DropWeapon: "DropWeapon", GiveNamedItem: "GiveNamedItem", PreThink: "PreThink", PostThink: "PostThink", RunCommand: "RunCommand" },
}, ["address", "bool", "string", "int"]);
{
	const BMSBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "bms");
	const vecFunctionContracts = [
		["BumpWeapon", 417, 416, ["address"], "bool"],
		["DropWeapon", 284, 283, ["address", "address", "address"], undefined],
		["GiveNamedItem", 423, 422, ["string", "int", "int", "int"], "address"],
		["PreThink", 355, 354, undefined, undefined],
		["PostThink", 356, 355, undefined, undefined],
		["RunCommand", 444, 443, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = BMSBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "bms/CBlackMesaPlayer.ini", "bms", 2, {
	Properties: { Ragdoll: "m_hRagdoll", EyeAngle: "blackmesalocaldata.m_angEyeAngles[0]" },
}, ["qangle"]);

VerifyCanonicalEntityProfile(g_Data, "bms/CBreakableProp.ini", "bms", 2, {
	KeyValues: { BreakModelMessage: "BreakModelMessage" },
	Properties: { UsesClientPhysics: "m_bClientPhysics" },
});

VerifyCanonicalEntityProfile(g_Data, "bms/CDynamicProp.ini", "bms", 5, {
	KeyValues: { AnimateEveryFrame: "AnimateEveryFrame", DisableBoneFollowers: "DisableBoneFollowers", HoldAnimation: "HoldAnimation" },
	Properties: { SpawnSolid: "m_SpawnSolid", AnimationDone: "m_bAnimationDone" },
});

VerifyCanonicalEntityProfile(g_Data, "bms/CParticleSystem.ini", "bms", 3, {
	Inputs: { Reset: "Reset" },
	KeyValues: { FlagAsWeather: "flag_as_weather" },
	Properties: { WeatherEffect: "m_bWeatherEffect" },
});

VerifyCanonicalEntityProfile(g_Data, "bms/CTeam.ini", "bms", 2, { Properties: { RoundsWon: "m_iRoundsWon", Score: "m_iScore" } });

VerifyCanonicalEntityProfile(g_Data, "bms/CWorld.ini", "bms", 1, { KeyValues: { UnderWaterParticle: "underwaterparticle" } });

VerifyCanonicalEntityProfile(g_Data, "csgo/CBaseCSGrenadeProjectile.ini", "csgo", 3, {
	Functions: { SetAttacker: "SetAttacker" },
	Properties: { BounceCount: "m_nBounces", InitialVelocity: "m_vInitialVelocity" },
}, ["address"]);
{
	const CSGOGrenadeProjectile = g_Data.GetEntityClassData("CBaseCSGrenadeProjectile", "csgo");
	g_Assert.equal(CSGOGrenadeProjectile.ServerCheckEnabled, false);
	g_Assert.deepEqual(CSGOGrenadeProjectile.Functions.SetAttacker.Arguments, ["address"]);
	g_Assert.equal(CSGOGrenadeProjectile.Functions.SetAttacker.IdentifierWindows, "55 8B EC 53 8B 5D 08 56 57 8B F9 53");
	g_Assert.equal(CSGOGrenadeProjectile.Functions.SetAttacker.IdentifierLinux, "55 89 E5 57 56 53 83 EC 2C 8B 5D 08 8B 7D 0C 8B 83 2A 2A 00 00 83 F8 FF 0F 84 2A 2A 00 00 8B 0D");
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CBaseCombatCharacter.ini", "csgo", 3, {
	VirtualFunctions: { IsInFieldOfView: "IsInFieldOfView", OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
}, ["address", "bool", "int"]);
{
	const CSGOCombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "csgo");
	g_Assert.equal(CSGOCombatCharacter.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["IsInFieldOfView", 276, 275, ["address"], "bool"],
		["OnTakeDamageAlive", 300, 299, ["address"], "int"],
		["WeaponSwitch", 290, 289, ["address", "int"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOCombatCharacter.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CBaseCombatWeapon.ini", "csgo", 4, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
	Properties: { PrimaryReserveAmmoCount: "m_iPrimaryReserveAmmoCount", SecondaryReserveAmmoCount: "m_iSecondaryReserveAmmoCount" },
});
{
	const CSGOCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "csgo");
	g_Assert.equal(CSGOCombatWeapon.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["PrimaryAttack", 318, 312, undefined, undefined],
		["SecondaryAttack", 319, 313, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOCombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CBaseEntity.ini", "csgo", 9, {
	VirtualFunctions: { SetModel: "SetModel", SetParent: "SetParent", OnTakeDamage: "OnTakeDamage", Teleport: "Teleport", SetTransmit: "SetTransmit", StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", GetSolidMask: "GetSolidMask" },
}, ["string", "address", "int", "bool", "uint"]);
{
	const CSGOBaseEntity = g_Data.GetEntityClassData("CBaseEntity", "csgo");
	g_Assert.equal(CSGOBaseEntity.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["SetModel", 28, 27, ["string"], undefined],
		["SetParent", 40, 39, ["address", "int"], undefined],
		["OnTakeDamage", 69, 68, ["address"], "int"],
		["Teleport", 115, 114, ["address", "address", "address", "bool"], undefined],
		["SetTransmit", 24, 23, ["address", "bool"], undefined],
		["StartTouch", 103, 102, ["address"], undefined],
		["Touch", 104, 103, ["address"], undefined],
		["EndTouch", 105, 104, ["address"], undefined],
		["GetSolidMask", 169, 168, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOBaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

const g_strTeleportDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.ok(g_strTeleportDocumentation.includes('The CS:GO `CBaseEntity.Teleport` virtual-function descriptor declares `["address", "address", "address", "bool"]`'), "The CS:GO Teleport documentation must describe its four-argument native ABI.");
g_Assert.ok(g_strTeleportDocumentation.includes("Callers of the CS:GO raw descriptor must provide it explicitly"), "The CS:GO Teleport boolean is mandatory.");

VerifyCanonicalEntityProfile(g_Data, "csgo/CBaseGrenade.ini", "csgo", 6, {
	Properties: { Damage: "m_flDamage", Thrower: "m_hThrower", IsLive: "m_bIsLive", Velocity: "m_vecVelocity", DetonateTime: "m_flDetonateTime", DamageRadius: "m_DmgRadius" },
});

VerifyCanonicalEntityProfile(g_Data, "csgo/CBasePlayer.ini", "csgo", 11, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon", DropWeapon: "DropWeapon", GiveNamedItem: "GiveNamedItem", IncrementAssistsCount: "IncrementAssistsCount", IncrementDeathCount: "IncrementDeathCount", IncrementFragCount: "IncrementFragCount", RunCommand: "RunCommand", PreThink: "PreThink", PostThink: "PostThink" },
	BasedAttributes: { Assists: "Assists" },
	Properties: { ViewOffset: "localdata.m_vecViewOffset[0]" },
}, ["address", "bool", "string", "int", "vector"]);
{
	const CSGOBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "csgo");
	g_Assert.equal(CSGOBasePlayer.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["BumpWeapon", 454, 453, ["address"], "bool"],
		["DropWeapon", 289, 288, ["address", "address", "address"], undefined],
		["GiveNamedItem", 459, 458, ["string", "int", "address", "bool", "address"], "address"],
		["IncrementAssistsCount", 501, 500, ["int"], undefined],
		["IncrementDeathCount", 502, 501, ["int"], undefined],
		["IncrementFragCount", 500, 499, ["int", "int"], undefined],
		["RunCommand", 479, 478, ["address", "address"], undefined],
		["PreThink", 373, 372, undefined, undefined],
		["PostThink", 374, 373, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

{
	const CSGOBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "csgo");
	g_Assert.equal(CSGOBasePlayer.BasedAttributes.Assists.Base, "m_iFrags");
	g_Assert.equal(CSGOBasePlayer.BasedAttributes.Assists.Offset, 0x04);
	g_Assert.equal(CSGOBasePlayer.BasedAttributes.Assists.Type, "int");
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CBombTarget.ini", "csgo", 3, { Inputs: { BombDefused: "BombDefused", BombExploded: "BombExplode", BombPlanted: "BombPlanted" } });

VerifyCanonicalEntityProfile(g_Data, "csgo/CBreakableProp.ini", "csgo", 1, { Properties: { UsesClientPhysics: "m_bClientPhysics" } });

VerifyCanonicalEntityProfile(g_Data, "csgo/CCSPlayer.ini", "csgo", 31, {
	Functions: { AddAccount: "AddAccount", BuyInternal: "BuyInternal", Deafen: "Deafen", RoundRespawn: "RoundRespawn", SwitchTeam: "SwitchTeam" },
	VirtualFunctions: { EquipWeapon: "EquipWeapon", Blind: "Blind" },
	Inputs: { OnRescueZoneTouch: "OnRescueZoneTouch" },
	BasedAttributes: { MVPCount: "MVPCount", Score: "Score", ClanTag: "ClanTag" },
	Properties: {
		ArmsModelName: "m_szArmsModel",
		Stamina: "cslocaldata.m_flStamina",
		ShotsFired: "cslocaldata.m_iShotsFired",
		Armor: "m_ArmorValue",
		HasDefuser: "m_bHasDefuser",
		HasHelmet: "m_bHasHelmet",
		HasNightVision: "m_bHasNightVision",
		IsInBombZone: "m_bInBombZone",
		IsInBuyZone: "m_bInBuyZone",
		IsInHostageRescueZone: "m_bInHostageRescueZone",
		IsDefusing: "m_bIsDefusing",
		NightVisionEnabled: "m_bNightVisionOn",
		FlashDuration: "m_flFlashDuration",
		MaximumFlashAlpha: "m_flFlashMaxAlpha",
		Cash: "m_iAccount",
		PlayerClass: "m_iClass",
		PlayerState: "m_iPlayerState",
		Ragdoll: "m_hRagdoll",
		GunGameImmunity: "m_bGunGameImmunity",
		EyeAngle: "m_angEyeAngles[0]",
	},
}, ["int", "bool", "string", "float", "address", "stringarray", "qangle"]);
{
	const CSGOPlayer = g_Data.GetEntityClassData("CCSPlayer", "csgo");
	g_Assert.equal(CSGOPlayer.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["EquipWeapon", 287, 286, ["address"], undefined],
		["Blind", 551, 548, ["float", "float", "float"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOPlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

{
	const CSGOPlayer = g_Data.GetEntityClassData("CCSPlayer", "csgo");
	const vecFunctionContracts = [
		["AddAccount", "55 8B EC 83 E4 F8 81 EC 4C 01 00 00 53 56 57 8B F9 8B 07 8B 80", "55 89 E5 57 56 53 81 EC 2A 01 00 00 8B 45 10 8B 5D 08 89", ["int", "bool", "bool", "string"], undefined],
		["BuyInternal", "55 8B EC 83 EC 24 53 56 57 6A 01", "55 89 E5 57 56 53 83 EC 54 8B 5D 08 6A 01 8B 7D 14", ["string", "int", "bool"], "int"],
		["Deafen", "55 8B EC 83 EC 28 56 57 8B F9 F3 0F 11 4D FC", "55 89 E5 57 56 53 83 EC 38 8B 5D 08 8B 03 53 FF 90 2A 2A 00 00 83 C4 10 85 C0", ["float"], undefined],
		["RoundRespawn", "55 8B EC 83 EC 0C 53 56 57 8B F9 8B 0D 2A 2A 2A 2A 8B 01", "55 89 E5 56 53 83 EC 1C 8B 5D 08 FF 35 2A 2A 2A 2A E8 2A 2A 2A 2A 83 C4 10 84 C0 0F 85 2A 2A 2A 2A 8B 13", undefined, undefined],
		["SwitchTeam", "55 8B EC 83 EC 10 53 56 8B 75 08 57 8B F9 85 F6", "55 89 E5 56 53 83 EC 2C 8B 5D 0C 8B 75 08 53", ["int"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOPlayer.Functions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.IdentifierWindows, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.IdentifierLinux, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}

	const vecBasedAttributeContracts = [
		["MVPCount", "m_bIsHoldingLookAtWeapon", 0x0B, "int"],
		["Score", "m_bIsHoldingLookAtWeapon", 0x33, "int"],
		["ClanTag", "m_flGroundAccelLinearFracLastTime", 0x8C, "stringarray"],
	];
	for (const vecBasedAttributeContract of vecBasedAttributeContracts) {
		const AttributeDescriptor = CSGOPlayer.BasedAttributes[vecBasedAttributeContract[0]];
		g_Assert.equal(AttributeDescriptor.Base, vecBasedAttributeContract[1]);
		g_Assert.equal(AttributeDescriptor.Offset, vecBasedAttributeContract[2]);
		g_Assert.equal(AttributeDescriptor.Type, vecBasedAttributeContract[3]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CDecoyProjectile.ini", "csgo", 1, { Functions: { Detonate: "Detonate" } });
{
	const CSGODecoy = g_Data.GetEntityClassData("CDecoyProjectile", "csgo");
	g_Assert.equal(CSGODecoy.ServerCheckEnabled, false);
	g_Assert.equal(CSGODecoy.Functions.Detonate.IdentifierWindows, "55 8B EC 51 56 8B F1 57 8B 86 D4 00 00 00");
	g_Assert.equal(CSGODecoy.Functions.Detonate.IdentifierLinux, "55 89 E5 57 56 53 83 EC 1C 8B 5D 08 F6 83 2A 00 00 00 10");
	g_Assert.equal(CSGODecoy.Functions.Detonate.Arguments, undefined);
	g_Assert.equal(CSGODecoy.Functions.Detonate.ReturnType, undefined);
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CDynamicProp.ini", "csgo", 15, {
	Inputs: {
		BecomeRagdoll: "BecomeRagdoll",
		FadeAndKill: "FadeAndKill",
		SetGlowBlueValue: "GlowColorBlueValue",
		SetGlowGreenValue: "GlowColorGreenValue",
		SetGlowRedValue: "GlowColorRedValue",
		SetAnimationNoReset: "SetAnimationNoReset",
		SetGlowColor: "SetGlowColor",
		DisableGlow: "SetGlowDisabled",
		EnableGlow: "SetGlowEnabled",
	},
	KeyValues: { AnimatesEveryFrame: "AnimateEveryFrame", BoneFollowersDisabled: "DisableBoneFollowers", HoldsAnimation: "HoldAnimation", GlowColor: "glowcolor", GlowEnabled: "glowenabled" },
	Properties: { IsAnimationDone: "m_bAnimationDone" },
});
VerifyCanonicalEntityProfile(g_Data, "csgo/CEconEntity.ini", "csgo", 1, { Properties: { ItemDefinitionIndex: "m_AttributeManager.m_Item.m_iItemDefinitionIndex" } });

VerifyCanonicalEntityProfile(g_Data, "csgo/CEnvProjectedTexture.ini", "csgo", 16, {
	Inputs: { DisableAlwaysUpdate: "AlwaysUpdateOff", EnableAlwaysUpdate: "AlwaysUpdateOn", SetFarZ: "SetFarZ", SetLightStyle: "SetLightStyle", SetNearZ: "SetNearZ", SetPattern: "SetPattern" },
	KeyValues: { BrightnessScale: "brightnessscale", ColorTransitionTime: "colortransitiontime", DefaultStyle: "defaultstyle", Pattern: "pattern", ProjectionRotation: "projection_rotation", ProjectionSize: "projection_size", SimpleProjection: "simpleprojection", Style: "style" },
	Properties: { AlwaysUpdates: "m_bAlwaysUpdate", LightColor: "m_LightColor" },
}, ["color"]);

VerifyCanonicalEntityProfile(g_Data, "csgo/CFlashbangProjectile.ini", "csgo", 2, {
	VirtualFunctions: { Detonate: "Detonate" },
	Inputs: { SetTimer: "SetTimer" },
});
{
	const CSGOFlashbang = g_Data.GetEntityClassData("CFlashbangProjectile", "csgo");
	g_Assert.equal(CSGOFlashbang.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["Detonate", 239, 238, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOFlashbang.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CHEGrenadeProjectile.ini", "csgo", 2, {
	VirtualFunctions: { Detonate: "Detonate" },
	Inputs: { InitializeSpawnFromWorld: "InitializeSpawnFromWorld" },
});
{
	const CSGOHEGrenade = g_Data.GetEntityClassData("CHEGrenadeProjectile", "csgo");
	g_Assert.equal(CSGOHEGrenade.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["Detonate", 239, 238, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOHEGrenade.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CHostage.ini", "csgo", 4, {
	Inputs: { OnRescueZoneTouch: "OnRescueZoneTouch" },
	Properties: { IsRescued: "m_isRescued", Leader: "m_leader", LifeState: "m_lifeState" },
});

VerifyCanonicalEntityProfile(g_Data, "csgo/CMapInfo.ini", "csgo", 6, {
	Inputs: { FireWinCondition: "FireWinCondition" },
	KeyValues: { BotMaximumVisionDistance: "botmaxvisiondistance", DisableAutoGeneratedDeathmatchSpawns: "disableautogenerateddmspawns", HostageCount: "hostagecount", PetPopulation: "petpopulation", UseNormalSpawnsForDeathmatch: "usenormalspawnsfordm" },
});

VerifyCanonicalEntityProfile(g_Data, "csgo/CMolotovProjectile.ini", "csgo", 3, {
	VirtualFunctions: { Detonate: "Detonate" },
	Inputs: { InitializeSpawnFromWorld: "InitializeSpawnFromWorld" },
	Properties: { IsIncendiaryGrenade: "m_bIsIncGrenade" },
});
{
	const CSGOMolotov = g_Data.GetEntityClassData("CMolotovProjectile", "csgo");
	g_Assert.equal(CSGOMolotov.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["Detonate", 239, 238, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOMolotov.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CParticleSystem.ini", "csgo", 2, { Inputs: { DestroyImmediately: "DestroyImmediately", StopPlayEndCap: "StopPlayEndCap" } });

VerifyCanonicalEntityProfile(g_Data, "csgo/CPlantedC4.ini", "csgo", 7, {
	VirtualFunctions: { Explode: "Explode" },
	Properties: { IsDefused: "m_bBombDefused", IsTicking: "m_bBombTicking", DetonationTime: "m_flC4Blow", DefuseCountdown: "m_flDefuseCountDown", DefuseLength: "m_flDefuseLength", TimerLength: "m_flTimerLength" },
}, ["address", "int"]);
{
	const CSGOPlantedBomb = g_Data.GetEntityClassData("CPlantedC4", "csgo");
	g_Assert.equal(CSGOPlantedBomb.ServerCheckEnabled, false);

	const vecFunctionContracts = [
		["Explode", 236, 235, ["address", "int"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSGOPlantedBomb.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CPointWorldText.ini", "csgo", 4, {
	KeyValues: { Message: "message" },
	Properties: { Text: "m_szText", TextSize: "m_flTextSize", TextColor: "m_textColor" },
}, ["string"]);

VerifyCanonicalEntityProfile(g_Data, "csgo/CSensorGrenadeProjectile.ini", "csgo", 4, {
	Functions: { StartTimer: "StartTimer", Detonate: "Detonate", DoDetectWave: "DoDetectWave" },
	InstanceAttributes: { Timer: "Timer" },
}, ["float"]);
{
	const CSGOSensorGrenade = g_Data.GetEntityClassData("CSensorGrenadeProjectile", "csgo");
	const TimerInstanceAttribute = g_Data.GetEntityInstanceAttributeDescriptor("CSensorGrenadeProjectile", "Timer", "csgo");
	g_Assert.equal(CSGOSensorGrenade.ServerCheckEnabled, false);
	g_Assert.equal(TimerInstanceAttribute.Name, "Timer");
	g_Assert.equal(TimerInstanceAttribute.Section, "InstanceAttribute");
	g_Assert.equal(TimerInstanceAttribute.Type, "float");
	g_Assert.equal(TimerInstanceAttribute.OffsetWindows, 0x570);
	g_Assert.equal(TimerInstanceAttribute.OffsetLinux, 0x588);
	g_Assert.equal(CSGOSensorGrenade.InstanceAttributes.Timer, TimerInstanceAttribute);
	g_Assert.equal(g_Data.GetEntityDataSection("CSensorGrenadeProjectile", "InstanceAttributes", "csgo").Timer, TimerInstanceAttribute);
	g_Assert.equal(g_Data.GetEntityDataSection("CSensorGrenadeProjectile", "instance_attributes", "csgo").Timer, TimerInstanceAttribute);
	g_Assert.equal(g_Data.GetEntityInstanceAttributeDescriptor("CSensorGrenadeProjectile", "timer", "csgo"), TimerInstanceAttribute);
	g_Assert.equal(g_Data.GetEntityInstanceAttributeDescriptor("CSensorGrenadeProjectile", "MissingTimer", "csgo"), null);
	g_Assert.equal(g_Data.GetEntityInstanceAttributeDescriptor("MissingSensorClass", "Timer", "csgo"), null);
	g_Assert.throws(() => g_Data.GetEntityInstanceAttributeDescriptor("", "Timer", "csgo"), /non-empty/);
	g_Assert.equal(0x1000n + BigInt(TimerInstanceAttribute.OffsetLinux), 0x1588n);
}

{
	// Private parser intermediates retain profile-schema keys; public descriptors use PascalCase.
	const DataModule = { exports: {} };
	const DataTools = g_VM.runInNewContext(g_FileSystem.readFileSync(g_strEntityDataPath, "utf8") + "\n({ NormalizeEntityDataInstanceAttributeOffset, NormalizeEntityDataConfiguration, MergeEntityClassData, CreateEmptyEntityClassData });", {
		module: DataModule,
		exports: DataModule.exports,
		require(strModuleName) {
			g_Assert.ok(["filesystem", "globals", "paths"].includes(strModuleName));

			return {};
		},
	});

	for (const vecOffsetCase of [[0x00, 0x00], [0x20, 0x20], ["0x588", 0x588], ["0X570", 0x570]]) {
		g_Assert.equal(DataTools.NormalizeEntityDataInstanceAttributeOffset(vecOffsetCase[0]), vecOffsetCase[1]);
	}

	for (const OffsetValue of [null, [], {}, true, "32", "0xG", "-0x1"]) {
		g_Assert.throws(() => DataTools.NormalizeEntityDataInstanceAttributeOffset(OffsetValue), /must be a number or hexadecimal/);
	}

	for (const OffsetValue of [-1, 0.5, NaN, Infinity, "0x20000000000000"]) {
		g_Assert.throws(() => DataTools.NormalizeEntityDataInstanceAttributeOffset(OffsetValue), /nonnegative safe integer/);
	}

	for (const AttributeData of [null, [], 42, "invalid"]) {
		g_Assert.throws(() => DataTools.NormalizeEntityDataConfiguration({ instanceAttribute: AttributeData }), /must be an object/);
	}

	const EmptyData = DataTools.CreateEmptyEntityClassData("SensorFixture");
	g_Assert.deepEqual(Object.keys(EmptyData.InstanceAttributes), []);

	const BaseData = DataTools.NormalizeEntityDataConfiguration({ instanceAttribute: { Timer: { offsetWindows: "0x570", offsetLinux: "0x588", type: "FLOAT" } } });
	DataTools.MergeEntityClassData(EmptyData, BaseData);
	g_Assert.equal(EmptyData.InstanceAttributes.Timer.OffsetWindows, 0x570);
	g_Assert.equal(EmptyData.InstanceAttributes.Timer.OffsetLinux, 0x588);

	const OverrideData = DataTools.NormalizeEntityDataConfiguration({ instanceAttribute: { Timer: { offsetWindows: 0x574, type: "float" } } });
	DataTools.MergeEntityClassData(EmptyData, OverrideData);
	g_Assert.equal(EmptyData.InstanceAttributes.Timer.OffsetWindows, 0x574);
	g_Assert.equal(EmptyData.InstanceAttributes.Timer.OffsetLinux, 0x588);
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CSmokeGrenadeProjectile.ini", "csgo", 3, {
	Functions: { Detonate: "Detonate" },
	Properties: { SmokeEffectStartTick: "m_nSmokeEffectTickBegin", HasProducedSmokeEffect: "m_bDidSmokeEffect" },
});
{
	const CSGOSmokeGrenade = g_Data.GetEntityClassData("CSmokeGrenadeProjectile", "csgo");
	g_Assert.equal(CSGOSmokeGrenade.ServerCheckEnabled, false);
	g_Assert.equal(CSGOSmokeGrenade.Functions.Detonate.IdentifierWindows, "55 8B EC 83 EC 18 56 8B F1 8B 0D 2A 2A 2A 2A 57");
	g_Assert.equal(CSGOSmokeGrenade.Functions.Detonate.IdentifierLinux, "55 89 E5 57 56 53 83 EC 50 8B 5D 08 68 00 00 26 43 53 FF 35");
	g_Assert.equal(CSGOSmokeGrenade.Functions.Detonate.Arguments, undefined);
	g_Assert.equal(CSGOSmokeGrenade.Functions.Detonate.ReturnType, undefined);
}

VerifyCanonicalEntityProfile(g_Data, "csgo/CTeam.ini", "csgo", 7, {
	Properties: { HasSurrendered: "m_bSurrendered", ClanID: "m_iClanID", FirstHalfScore: "m_scoreFirstHalf", OvertimeScore: "m_scoreOvertime", SecondHalfScore: "m_scoreSecondHalf", TotalScore: "m_scoreTotal", ClanName: "m_szClanTeamname" },
});
{
	const CSGOTeam = g_Data.GetEntityClassData("CTeam", "csgo");
	g_Assert.equal(CSGOTeam.Properties.ClanID.Name, "m_iClanID");
	g_Assert.equal(Object.hasOwn(CSGOTeam.Properties, "ClanId"), false);
	g_Assert.equal(g_Data.GetEntityPropertyDescriptor("CTeam", "ClanID", "csgo").Name, "m_iClanID");
	g_Assert.equal(g_Data.GetEntityPropertyDescriptor("CTeam", "ClanId", "csgo"), null);
}

VerifyCanonicalEntityProfile(g_Data, "gmod/CBaseCombatCharacter.ini", "gmod", 2, {
	VirtualFunctions: { OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
}, ["address", "int", "bool"]);
{
	const GMODCombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "gmod");
	g_Assert.equal(GMODCombatCharacter.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["OnTakeDamageAlive", 329, 328, ["address"], "int"],
		["WeaponSwitch", 321, 320, ["address", "int"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = GMODCombatCharacter.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "gmod/CBaseCombatWeapon.ini", "gmod", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});
{
	const GMODCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "gmod");
	g_Assert.equal(GMODCombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 329, 328, undefined, undefined],
		["SecondaryAttack", 330, 329, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = GMODCombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "gmod/CBaseEntity.ini", "gmod", 9, {
	VirtualFunctions: { SetModel: "SetModel", SetParent: "SetParent", OnTakeDamage: "OnTakeDamage", Teleport: "Teleport", SetTransmit: "SetTransmit", StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", GetSolidMask: "GetSolidMask" },
}, ["string", "address", "int", "bool", "uint"]);
{
	const GMODBaseEntity = g_Data.GetEntityClassData("CBaseEntity", "gmod");
	g_Assert.equal(GMODBaseEntity.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["SetModel", 25, 24, ["string"], undefined],
		["SetParent", 35, 34, ["address", "int"], undefined],
		["OnTakeDamage", 64, 63, ["address"], "int"],
		["Teleport", 111, 110, ["address", "address", "address"], undefined],
		["SetTransmit", 21, 20, ["address", "bool"], undefined],
		["StartTouch", 101, 100, ["address"], undefined],
		["Touch", 102, 101, ["address"], undefined],
		["EndTouch", 103, 102, ["address"], undefined],
		["GetSolidMask", 173, 172, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = GMODBaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "gmod/CBasePlayer.ini", "gmod", 7, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon", DropWeapon: "DropWeapon", GiveNamedItem: "GiveNamedItem", RunCommand: "RunCommand", PreThink: "PreThink", PostThink: "PostThink" },
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["address", "bool", "string", "int", "vector"]);
{
	const GMODBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "gmod");
	g_Assert.equal(GMODBasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["BumpWeapon", 453, 452, ["address"], "bool"],
		["DropWeapon", 320, 319, ["address", "address", "address"], undefined],
		["GiveNamedItem", 457, 456, ["string", "int", "bool", "address"], "address"],
		["RunCommand", 475, 474, ["address", "address"], undefined],
		["PreThink", 389, 388, undefined, undefined],
		["PostThink", 390, 389, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = GMODBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "gmod/CGMOD_Player.ini", "gmod", 2, {
	Properties: { Ragdoll: "m_hRagdoll", EyeAngle: "hl2mplocaldata.m_angEyeAngles[0]" },
}, ["qangle"]);

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBaseCombatCharacter.ini", "l4d2", 2, {
	VirtualFunctions: { OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
}, ["address", "int", "bool"]);
{
	const L4D2CombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "l4d2");
	g_Assert.equal(L4D2CombatCharacter.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["OnTakeDamageAlive", 293, 292, ["address"], "int"],
		["WeaponSwitch", 285, 284, ["address", "int"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = L4D2CombatCharacter.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBaseCombatWeapon.ini", "l4d2", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});
{
	const L4D2CombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "l4d2");
	g_Assert.equal(L4D2CombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 283, 282, undefined, undefined],
		["SecondaryAttack", 284, 283, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = L4D2CombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBaseEntity.ini", "l4d2", 9, {
	VirtualFunctions: { SetModel: "SetModel", SetParent: "SetParent", OnTakeDamage: "OnTakeDamage", Teleport: "Teleport", SetTransmit: "SetTransmit", StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", GetSolidMask: "GetSolidMask" },
}, ["string", "address", "int", "bool", "uint"]);
{
	const L4D2BaseEntity = g_Data.GetEntityClassData("CBaseEntity", "l4d2");
	g_Assert.equal(L4D2BaseEntity.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["SetModel", 28, 27, ["string"], undefined],
		["SetParent", 38, 37, ["address", "int"], undefined],
		["OnTakeDamage", 73, 72, ["address"], "int"],
		["Teleport", 119, 118, ["address", "address", "address"], undefined],
		["SetTransmit", 23, 22, ["address", "bool"], undefined],
		["StartTouch", 108, 107, ["address"], undefined],
		["Touch", 109, 108, ["address"], undefined],
		["EndTouch", 110, 109, ["address"], undefined],
		["GetSolidMask", 178, 177, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = L4D2BaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBasePlayer.ini", "l4d2", 7, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon", DropWeapon: "DropWeapon", GiveNamedItem: "GiveNamedItem", RunCommand: "RunCommand", PreThink: "PreThink", PostThink: "PostThink" },
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["address", "bool", "string", "int", "vector"]);
{
	const L4D2BasePlayer = g_Data.GetEntityClassData("CBasePlayer", "l4d2");
	g_Assert.equal(L4D2BasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["BumpWeapon", 427, 426, ["address"], "bool"],
		["DropWeapon", 284, 283, ["address", "address", "address"], undefined],
		["GiveNamedItem", 432, 431, ["string", "int", "bool", "address"], "address"],
		["RunCommand", 455, 454, ["address", "address"], undefined],
		["PreThink", 357, 356, undefined, undefined],
		["PostThink", 358, 357, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = L4D2BasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBreakable.ini", "l4d2", 1, { KeyValues: { BreakableType: "BreakableType" } });

VerifyCanonicalEntityProfile(g_Data, "l4d2/CBreakableProp.ini", "l4d2", 2, { Properties: { UsesClientPhysics: "m_bClientPhysics", GhostCollisionDisabled: "m_noGhostCollision" } });

VerifyCanonicalEntityProfile(g_Data, "l4d2/CCSPlayer.ini", "l4d2", 2, {
	Properties: { Ragdoll: "m_hRagdoll", EyeAngle: "m_angEyeAngles[0]" },
}, ["qangle"]);

VerifyCanonicalEntityProfile(g_Data, "l4d2/CDynamicProp.ini", "l4d2", 9, {
	Inputs: { SetGlowOverride: "SetGlowOverride", SetGlowRange: "SetGlowRange", StartGlowing: "StartGlowing", StopGlowing: "StopGlowing" },
	KeyValues: { GlowColor: "glowcolor", GlowRange: "glowrange", GlowRangeMinimum: "glowrangemin", GlowState: "glowstate", UpdateChildren: "updatechildren" },
});

VerifyCanonicalEntityProfile(g_Data, "l4d2/CEnvProjectedTexture.ini", "l4d2", 1, { Properties: { LinearFloatLightColor: "m_LinearFloatLightColor" } });

VerifyCanonicalEntityProfile(g_Data, "l4d2/CPrecipitation.ini", "l4d2", 2, { KeyValues: { MaximumSpeed: "maxSpeed", MinimumSpeed: "minSpeed" } });

VerifyCanonicalEntityProfile(g_Data, "l4d2/CStripWeapons.ini", "l4d2", 2, { Inputs: { StripActiveWeapon: "StripActiveWeapon", StripWeaponByClassName: "StripWeaponByClassname" } });
{
	const L4D2StripWeapons = g_Data.GetEntityClassData("CStripWeapons", "l4d2");
	g_Assert.equal(L4D2StripWeapons.Inputs.StripWeaponByClassName.Name, "StripWeaponByClassname");
	g_Assert.equal(Object.hasOwn(L4D2StripWeapons.Inputs, "StripWeaponByClassname"), false);
	g_Assert.equal(g_Data.GetEntityInputDescriptor("CStripWeapons", "StripWeaponByClassName", "l4d2").Name, "StripWeaponByClassname");
	g_Assert.equal(g_Data.GetEntityInputDescriptor("CStripWeapons", "StripWeaponByClassname", "l4d2"), null);
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CTerrorGun.ini", "l4d2", 8, {
	VirtualFunctions: { AddUpgrade: "AddUpgrade", HasUpgrade: "HasUpgrade", IsDualWielding: "IsDualWielding", IsWeaponUpgraded: "IsWeaponUpgraded", RemoveAllUpgrades: "RemoveAllUpgrades", RemoveUpgrade: "RemoveUpgrade" },
	Properties: { IsDualWielding: "m_isDualWielding", UpgradeBits: "m_upgradeBitVec" },
}, ["int", "bool"]);
{
	const L4D2TerrorGun = g_Data.GetEntityClassData("CTerrorGun", "l4d2");
	g_Assert.equal(L4D2TerrorGun.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["AddUpgrade", 426, 425, ["int"], undefined],
		["HasUpgrade", 429, 428, ["int"], undefined],
		["IsDualWielding", 413, 412, undefined, "bool"],
		["IsWeaponUpgraded", 412, 411, undefined, "bool"],
		["RemoveAllUpgrades", 428, 427, undefined, undefined],
		["RemoveUpgrade", 427, 426, ["int"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = L4D2TerrorGun.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "l4d2/CTerrorWeapon.ini", "l4d2", 1, { Properties: { LoadedUpgradedPrimaryAmmoCount: "m_nUpgradedPrimaryAmmoLoaded" } });

VerifyCanonicalEntityProfile(g_Data, "l4d2/CWorld.ini", "l4d2", 2, { KeyValues: { MusicPostfix: "musicpostfix", StartMusicType: "startmusictype" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/CBaseAnimating.ini", "orangebox", 3, { KeyValues: { FadeMaximumDistance: "fademaxdist", FadeMinimumDistance: "fademindist", FadeScale: "fadescale" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/CBaseCombatCharacter.ini", "orangebox", 2, {
	VirtualFunctions: { OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
}, ["address", "int", "bool"]);
{
	const OrangeBoxCombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "orangebox");
	g_Assert.equal(OrangeBoxCombatCharacter.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["OnTakeDamageAlive", 279, 278, ["address"], "int"],
		["WeaponSwitch", 271, 270, ["address", "int"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = OrangeBoxCombatCharacter.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/CBaseEntity.ini", "orangebox", 10, {
	VirtualFunctions: { SetTransmit: "SetTransmit", SetModel: "SetModel", SetParent: "SetParent", OnTakeDamage: "OnTakeDamage", StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", Teleport: "Teleport", GetSolidMask: "GetSolidMask" },
	Inputs: { DispatchEffect: "DispatchEffect" },
}, ["address", "bool", "string", "int", "uint"]);
{
	const OrangeBoxBaseEntity = g_Data.GetEntityClassData("CBaseEntity", "orangebox");
	g_Assert.equal(OrangeBoxBaseEntity.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["SetTransmit", 23, 22, ["address", "bool"], undefined],
		["SetModel", 27, 26, ["string"], undefined],
		["SetParent", 37, 36, ["address", "int"], undefined],
		["OnTakeDamage", 65, 64, ["address"], "int"],
		["StartTouch", 101, 100, ["address"], undefined],
		["Touch", 102, 101, ["address"], undefined],
		["EndTouch", 103, 102, ["address"], undefined],
		["Teleport", 111, 110, ["address", "address", "address"], undefined],
		["GetSolidMask", 171, 170, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = OrangeBoxBaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/CBasePlayer.ini", "orangebox", 4, {
	VirtualFunctions: { DropWeapon: "DropWeapon", PreThink: "PreThink", PostThink: "PostThink", RunCommand: "RunCommand" },
}, ["address"]);
{
	const OrangeBoxBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "orangebox");
	g_Assert.equal(OrangeBoxBasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["DropWeapon", 270, 269, ["address", "address", "address"], undefined],
		["PreThink", 339, 338, undefined, undefined],
		["PostThink", 340, 339, undefined, undefined],
		["RunCommand", undefined, undefined, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = OrangeBoxBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/CBreakableProp.ini", "orangebox", 1, { KeyValues: { BreakModelMessage: "BreakModelMessage" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/CDynamicProp.ini", "orangebox", 1, { KeyValues: { BoneFollowersDisabled: "DisableBoneFollowers" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/CEnvProjectedTexture.ini", "orangebox", 1, { Properties: { LinearFloatLightColor: "m_LinearFloatLightColor" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/CParticleSystem.ini", "orangebox", 2, {
	KeyValues: { IsWeather: "flag_as_weather" },
	Properties: { IsWeatherEffect: "m_bWeatherEffect" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/CTeam.ini", "orangebox", 2, { Properties: { RoundsWon: "m_iRoundsWon", Score: "m_iScore" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBaseAnimating.ini", "css", 2, {
	Inputs: { SetModelScale: "SetModelScale" },
	KeyValues: { ModelScale: "modelscale" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBaseCSGrenade.ini", "css", 2, { Properties: { IsPinPulled: "m_bPinPulled", ThrowTime: "m_fThrowTime" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBaseCSGrenadeProjectile.ini", "css", 1, { Properties: { InitialVelocity: "m_vInitialVelocity" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBaseCombatWeapon.ini", "css", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});
{
	const CSSCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "css");
	g_Assert.equal(CSSCombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 280, 279, undefined, undefined],
		["SecondaryAttack", 281, 280, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSSCombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBaseGrenade.ini", "css", 1, { VirtualFunctions: { Detonate: "Detonate" } });
{
	const CSSBaseGrenade = g_Data.GetEntityClassData("CBaseGrenade", "css");
	g_Assert.equal(CSSBaseGrenade.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["Detonate", 233, 232, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSSBaseGrenade.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBasePlayer.ini", "css", 4, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon", GiveNamedItem: "GiveNamedItem", RunCommand: "RunCommand" },
	Properties: { ViewOffset: "localdata.m_vecViewOffset[0]" },
}, ["address", "bool", "string", "int", "vector"]);
{
	const CSSBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "css");
	g_Assert.equal(CSSBasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["BumpWeapon", 405, 404, ["address"], "bool"],
		["GiveNamedItem", 409, 408, ["string", "int"], "address"],
		["RunCommand", 427, 426, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSSBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CBombTarget.ini", "css", 3, { Inputs: { BombDefused: "BombDefused", BombExploded: "BombExplode", BombPlanted: "BombPlanted" } });

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CCSPlayer.ini", "css", 29, {
	Functions: { AddAccount: "AddAccount", Autobuy: "Autobuy", BuyInternal: "BuyInternal", Rebuy: "Rebuy", Deafen: "Deafen", SwitchTeam: "SwitchTeam" },
	VirtualFunctions: { EquipWeapon: "EquipWeapon", Blind: "Blind" },
	Inputs: { OnRescueZoneTouch: "OnRescueZoneTouch" },
	BasedAttributes: { MVPCount: "MVPCount", ClanTag: "ClanTag" },
	Properties: {
		Stamina: "cslocaldata.m_flStamina",
		ShotsFired: "cslocaldata.m_iShotsFired",
		Armor: "m_ArmorValue",
		HasDefuser: "m_bHasDefuser",
		HasHelmet: "m_bHasHelmet",
		HasNightVision: "m_bHasNightVision",
		IsInBombZone: "m_bInBombZone",
		IsInBuyZone: "m_bInBuyZone",
		IsInHostageRescueZone: "m_bInHostageRescueZone",
		IsDefusing: "m_bIsDefusing",
		NightVisionEnabled: "m_bNightVisionOn",
		FlashDuration: "m_flFlashDuration",
		MaximumFlashAlpha: "m_flFlashMaxAlpha",
		Cash: "m_iAccount",
		PlayerClass: "m_iClass",
		PlayerState: "m_iPlayerState",
		Ragdoll: "m_hRagdoll",
		EyeAngle: "m_angEyeAngles[0]",
	},
}, ["int", "bool", "string", "float", "address", "stringarray", "qangle"]);
{
	const CSSPlayer = g_Data.GetEntityClassData("CCSPlayer", "css");
	g_Assert.equal(CSSPlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["EquipWeapon", 268, 267, ["address"], undefined],
		["Blind", 479, 476, ["float", "float", "float"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSSPlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

{
	const CSSPlayer = g_Data.GetEntityClassData("CCSPlayer", "css");
	const vecFunctionContracts = [
		["AddAccount", "55 8B EC 83 EC 18 89 4D FC 8D 45 08", "_ZN9CCSPlayer10AddAccountEibbPKc", ["int", "bool", "bool", "string"], undefined],
		["Autobuy", "55 8B EC 83 EC 0C 89 4D F8 8B 4D F8 E8", "_ZN9CCSPlayer7AutoBuyEv", undefined, undefined],
		["BuyInternal", "55 8B EC 83 EC 28 89 4D F8 6A 00", "_ZN9CCSPlayer26HandleCommand_Buy_InternalEPKc", ["string"], "int"],
		["Rebuy", "55 8B EC 81 EC 10 01 2A 2A 89 4D FC", "_ZN9CCSPlayer5RebuyEv", undefined, undefined],
		["Deafen", "55 8B EC 83 EC 28 89 4D FC 8B 45 FC 8B 10", "_ZN9CCSPlayer6DeafenEf", ["float"], undefined],
		["SwitchTeam", "55 8B EC 83 EC 5C 89 4D FC", "_ZN9CCSPlayer10SwitchTeamEi", ["int"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = CSSPlayer.Functions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.IdentifierWindows, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.IdentifierLinux, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}

	g_Assert.equal(CSSPlayer.BasedAttributes.MVPCount.Base, "cslocaldata.m_bPlayerDominatingMe.065");
	g_Assert.equal(CSSPlayer.BasedAttributes.MVPCount.Offset, 0x04);
	g_Assert.equal(CSSPlayer.BasedAttributes.MVPCount.Type, "int");
	g_Assert.equal(Object.hasOwn(CSSPlayer.BasedAttributes, "MvpCount"), false);
	g_Assert.equal(g_Data.GetEntityBasedAttributeDescriptor("CCSPlayer", "MVPCount", "css").Name, "MVPCount");
	g_Assert.equal(g_Data.GetEntityBasedAttributeDescriptor("CCSPlayer", "MvpCount", "css"), null);
	g_Assert.equal(CSSPlayer.BasedAttributes.ClanTag.Base, "m_flFlashDuration");
	g_Assert.equal(CSSPlayer.BasedAttributes.ClanTag.Offset, -0x1C);
	g_Assert.equal(CSSPlayer.BasedAttributes.ClanTag.Type, "stringarray");
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CHostage.ini", "css", 4, {
	Inputs: { OnRescueZoneTouch: "OnRescueZoneTouch" },
	Properties: { IsRescued: "m_isRescued", Leader: "m_leader", LifeState: "m_lifeState" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CMapInfo.ini", "css", 1, {
	Inputs: { FireWinCondition: "FireWinCondition" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CPlantedC4.ini", "css", 5, {
	Properties: { IsTicking: "m_bBombTicking", DetonationTime: "m_flC4Blow", TimerLength: "m_flTimerLength", DefuseLength: "m_flDefuseLength", DefuseCountdown: "m_flDefuseCountDown" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/cstrike/CSmokeGrenadeProjectile.ini", "css", 1, {
	Functions: { Detonate: "Detonate" },
});

{
	const CSSSmokeProjectile = g_Data.GetEntityClassData("CSmokeGrenadeProjectile", "css");
	const DetonateDescriptor = CSSSmokeProjectile.Functions.Detonate;
	g_Assert.equal(DetonateDescriptor.IdentifierWindows, "55 8B EC 83 EC 2C 53 56 8B F1 57");
	g_Assert.equal(DetonateDescriptor.IdentifierLinux, "_ZN23CSmokeGrenadeProjectile14Think_DetonateEv");
	g_Assert.equal(DetonateDescriptor.Arguments, undefined);
	g_Assert.equal(DetonateDescriptor.ReturnType, undefined);
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/dod/CBaseCombatWeapon.ini", "dods", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});

{
	const DODCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "dods");
	g_Assert.equal(DODCombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 280, 279, undefined, undefined],
		["SecondaryAttack", 281, 280, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = DODCombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/dod/CBasePlayer.ini", "dods", 2, {
	Properties: { ViewOffset: "localdata.m_vecViewOffset[0]" },
	VirtualFunctions: { RunCommand: "RunCommand" },
}, ["vector", "address"]);

{
	const DODBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "dods");
	g_Assert.equal(DODBasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["RunCommand", 426, 425, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = DODBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/dod/CDODPlayer.ini", "dods", 3, {
	Properties: { Ragdoll: "m_hRagdoll", EyeAngle: "m_angEyeAngles[0]" },
	VirtualFunctions: { GiveNamedItem: "GiveNamedItem" },
}, ["qangle", "string", "int", "address"]);

{
	const DODPlayer = g_Data.GetEntityClassData("CDODPlayer", "dods");
	g_Assert.equal(DODPlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["GiveNamedItem", 408, 407, ["string", "int"], "address"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = DODPlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/ep2/CBaseFlex.ini", null, 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/episodic/CBaseFlex.ini", null, 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2/CBaseFlex.ini", null, 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CBaseCombatWeapon.ini", "hl2dm", 3, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack", Materialize: "Materialize" },
});

{
	const HL2MPCombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "hl2dm");
	g_Assert.equal(HL2MPCombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 280, 279, undefined, undefined],
		["SecondaryAttack", 281, 280, undefined, undefined],
		["Materialize", 353, 352, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = HL2MPCombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CBaseFlex.ini", "hl2dm", 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CBaseGrenade.ini", "hl2dm", 1, {
	VirtualFunctions: { Detonate: "Detonate" },
});

{
	const HL2MPGrenade = g_Data.GetEntityClassData("CBaseGrenade", "hl2dm");
	g_Assert.equal(HL2MPGrenade.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["Detonate", 233, 232, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = HL2MPGrenade.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CBasePlayer.ini", "hl2dm", 6, {
	Functions: { IncrementFragCount: "IncrementFragCount", IncrementDeathCount: "IncrementDeathCount" },
	VirtualFunctions: { BumpWeapon: "BumpWeapon", GiveNamedItem: "GiveNamedItem", RunCommand: "RunCommand" },
	Properties: { Armor: "m_ArmorValue" },
}, ["int", "address", "bool", "string"]);

{
	const HL2MPBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "hl2dm");
	g_Assert.equal(HL2MPBasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["BumpWeapon", 404, 403, ["address"], "bool"],
		["GiveNamedItem", 408, 407, ["string", "int"], "address"],
		["RunCommand", 426, 425, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = HL2MPBasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

{
	const HL2MPBasePlayer = g_Data.GetEntityClassData("CBasePlayer", "hl2dm");
	const vecFunctionContracts = [
		["IncrementFragCount", "55 8B EC 8B 45 08 01 81 68 0E 00 00", "_ZN11CBasePlayer18IncrementFragCountEi"],
		["IncrementDeathCount", "55 8B EC 8B 45 08 01 81 6C 0E 00 00", "_ZN11CBasePlayer19IncrementDeathCountEi"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = HL2MPBasePlayer.Functions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.IdentifierWindows, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.IdentifierLinux, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, ["int"]);
		g_Assert.equal(FunctionDescriptor.ReturnType, undefined);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CGrenadeFrag.ini", "hl2dm", 3, {
	Inputs: { SetTimer: "SetTimer" },
	Properties: { GlowTrail: "m_pGlowTrail", MainGlow: "m_pMainGlow" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CHL2MP_Player.ini", "hl2dm", 2, {
	Properties: { Ragdoll: "m_hRagdoll", EyeAngle: "m_angEyeAngles[0]" },
}, ["qangle"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CHL2_Player.ini", "hl2dm", 2, {
	Properties: { ActiveDevices: "m_HL2Local.m_bitsActiveDevices", SuitPowerLoad: "m_flSuitPowerLoad" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CItem.ini", "hl2dm", 1, {
	VirtualFunctions: { Materialize: "Materialize" },
});

{
	const HL2MPItem = g_Data.GetEntityClassData("CItem", "hl2dm");
	g_Assert.equal(HL2MPItem.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["Materialize", 224, 223, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = HL2MPItem.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/hl2mp/CPropCombineBall.ini", "hl2dm", 22, {
	Inputs: { Explode: "Explode", FadeAndRespawn: "FadeAndRespawn", Socketed: "Socketed" },
	Properties: {
		DiesOnBounce: "m_bBounceDie",
		IsCaptureInProgress: "m_bCaptureInProgress",
		IsEmitting: "m_bEmit",
		HasFiredGrabbedOutput: "m_bFiredGrabbedOutput",
		MovesForward: "m_bForward",
		IsHeld: "m_bHeld",
		IsLaunched: "m_bLaunched",
		HasStruckEntity: "m_bStruckEntity",
		WasLaunchedByWeapon: "m_bWeaponLaunched",
		LastBounceTime: "m_flLastBounceTime",
		LastCaptureTime: "m_flLastCaptureTime",
		NextDamageTime: "m_flNextDamageTime",
		Radius: "m_flRadius",
		Speed: "m_flSpeed",
		Spawner: "m_hSpawner",
		BounceCount: "m_nBounceCount",
		MaximumBounces: "m_nMaxBounces",
		State: "m_nState",
		GlowTrail: "m_pGlowTrail",
	},
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/portal/CBaseFlex.ini", null, 1, {
	Properties: { ViewOffset: "m_vecViewOffset[0]" },
}, ["vector"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/portal/CPortal_Player.ini", null, 1, {
	Properties: { EyeAngle: "m_angEyeAngles[0]" },
}, ["qangle"]);

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CBaseCombatCharacter.ini", "tf2", 2, {
	VirtualFunctions: { OnTakeDamageAlive: "OnTakeDamageAlive", WeaponSwitch: "WeaponSwitch" },
});

{
	const TF2CombatCharacter = g_Data.GetEntityClassData("CBaseCombatCharacter", "tf2");
	g_Assert.equal(TF2CombatCharacter.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["OnTakeDamageAlive", 284, 283, ["address"], "int"],
		["WeaponSwitch", 276, 275, ["address", "int"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = TF2CombatCharacter.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CBaseCombatWeapon.ini", "tf2", 2, {
	VirtualFunctions: { PrimaryAttack: "PrimaryAttack", SecondaryAttack: "SecondaryAttack" },
});

{
	const TF2CombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "tf2");
	g_Assert.equal(TF2CombatWeapon.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["PrimaryAttack", 293, 287, undefined, undefined],
		["SecondaryAttack", 294, 288, undefined, undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = TF2CombatWeapon.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CBaseEntity.ini", "tf2", 5, {
	VirtualFunctions: { StartTouch: "StartTouch", Touch: "Touch", EndTouch: "EndTouch", Teleport: "Teleport", GetSolidMask: "GetSolidMask" },
}, ["uint"]);

{
	const TF2BaseEntity = g_Data.GetEntityClassData("CBaseEntity", "tf2");
	g_Assert.equal(TF2BaseEntity.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["StartTouch", 105, 104, ["address"], undefined],
		["Touch", 106, 105, ["address"], undefined],
		["EndTouch", 107, 106, ["address"], undefined],
		["Teleport", 115, 114, ["address", "address", "address"], undefined],
		["GetSolidMask", 175, 174, undefined, "uint"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = TF2BaseEntity.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CBasePlayer.ini", "tf2", 5, {
	VirtualFunctions: { DropWeapon: "DropWeapon", PreThink: "PreThink", PostThink: "PostThink", RunCommand: "RunCommand" },
	Properties: { ViewOffset: "localdata.m_vecViewOffset[0]" },
}, ["vector"]);

{
	const TF2BasePlayer = g_Data.GetEntityClassData("CBasePlayer", "tf2");
	g_Assert.equal(TF2BasePlayer.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["DropWeapon", 275, 274, ["address", "address", "address"], undefined],
		["PreThink", 345, 344, undefined, undefined],
		["PostThink", 346, 345, undefined, undefined],
		["RunCommand", 432, 431, ["address", "address"], undefined],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = TF2BasePlayer.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CEconEntity.ini", "tf2", 1, {
	Properties: { ItemDefinitionIndex: "m_AttributeManager.m_Item.m_iItemDefinitionIndex" },
});

VerifyCanonicalEntityProfile(g_Data, "orangebox/tf/CTFPlayer.ini", "tf2", 5, {
	VirtualFunctions: { BumpWeapon: "BumpWeapon" },
	Properties: { Ragdoll: "m_hRagdoll", PlayerClass: "m_PlayerClass.m_iClass", DesiredPlayerClass: "m_Shared.m_iDesiredPlayerClass", EyeAngle: "tfnonlocaldata.m_angEyeAngles[0]" },
}, ["address", "bool", "qangle"]);

{
	const TF2Player = g_Data.GetEntityClassData("CTFPlayer", "tf2");
	g_Assert.equal(TF2Player.ServerCheckEnabled, true);

	const vecFunctionContracts = [
		["BumpWeapon", 410, 409, ["address"], "bool"],
	];
	for (const vecFunctionContract of vecFunctionContracts) {
		const FunctionDescriptor = TF2Player.VirtualFunctions[vecFunctionContract[0]];
		g_Assert.equal(FunctionDescriptor.OffsetLinux, vecFunctionContract[1]);
		g_Assert.equal(FunctionDescriptor.OffsetWindows, vecFunctionContract[2]);
		g_Assert.deepEqual(FunctionDescriptor.Arguments, vecFunctionContract[3]);
		g_Assert.equal(FunctionDescriptor.ReturnType, vecFunctionContract[4]);
	}
}

{
	const TypeModule = { exports: {} };
	const NormalizeType = g_VM.runInNewContext(g_FileSystem.readFileSync(g_strEntityDataPath, "utf8") + "\nNormalizeEntityDataType;", {
		module: TypeModule,
		exports: TypeModule.exports,
		require(strModuleName) {
			g_Assert.ok(["filesystem", "globals", "paths"].includes(strModuleName));

			return {};
		},
	});

	const LegacyTypeNames = {
		BOOL: "bool",
		Color: "color",
		FLOAT: "float",
		INT: "int",
		ADDRESS: "address",
		QAngle: "qangle",
		SHORT: "short",
		STRING: "string",
		STRING_ARRAY: "stringarray",
		UINT: "uint",
		Vector: "vector",
	};
	for (const vecTypeEntry of Object.entries(LegacyTypeNames)) {
		const strTypeName = vecTypeEntry[1];
		g_Assert.equal(NormalizeType(vecTypeEntry[0]), strTypeName);
		g_Assert.equal(NormalizeType(strTypeName), strTypeName);
	}

	g_Assert.throws(() => NormalizeType("invalid-type-for-test"), /Unknown entity data type/);
	g_Assert.throws(() => NormalizeType(null), /must be a string/);
}

VerifyCanonicalEntityProfile(g_Data, "CBaseCombatCharacter.ini", "tf2", 6, {
	Inputs: { KilledNPC: "KilledNPC" },
	KeyValues: { PhysicsDamageScale: "physdamagescale" },
	Properties: { ActiveWeaponHandle: "m_hActiveWeapon", GunOffset: "m_HackedGunPos", Hitgroup: "m_LastHitGroup" },
});

{
	const BaseCombatCharacterData = g_Data.GetEntityClassData("CBaseCombatCharacter", "tf2");
	g_Assert.ok(!Object.hasOwn(BaseCombatCharacterData.Inputs, "KilledNpc"), "CBaseCombatCharacter must not expose the legacy NPC acronym alias");
}

VerifyCanonicalEntityProfile(g_Data, "CBaseCombatWeapon.ini", "tf2", 9, {
	Inputs: { HideWeapon: "HideWeapon" },
	Properties: { NextAttack: "LocalActiveWeaponData.m_flNextPrimaryAttack", AmmoProperty: "LocalWeaponData.m_iPrimaryAmmoType", WorldModelIndex: "m_iWorldModelIndex" },
});
VerifyCanonicalEntityProfile(g_Data, "CBaseDoor.ini", "tf2", 22, {
	Inputs: { Open: "Open", Unlock: "Unlock" },
	KeyValues: { Damage: "dmg", MoveDirection: "movedir", LockedSound: "locked_sound", UnlockedSound: "unlocked_sound" },
	Properties: { Locked: "m_bLocked" },
});

g_Assert.equal(g_OrangeBoxAnimating.KeyValues.FadeMaximumDistance.Name, "fademaxdist");
g_Assert.equal(g_OrangeBoxAnimating.KeyValues.FadeMinimumDistance.Name, "fademindist");
g_Assert.equal(Object.hasOwn(g_OrangeBoxAnimating.KeyValues, "fadeMaxDist"), false);
g_Assert.equal(Object.hasOwn(g_OrangeBoxAnimating.KeyValues, "fadeMinDist"), false);

const g_OrangeBoxDynamicProp = g_Data.GetEntityClassData("CDynamicProp", "tf2");
g_Assert.equal(g_OrangeBoxDynamicProp.KeyValues.BoneFollowersDisabled.Name, "DisableBoneFollowers");
g_Assert.equal(Object.hasOwn(g_OrangeBoxDynamicProp.KeyValues, "disableBoneFollowers"), false);

const g_CSSAnimating = g_Data.GetEntityClassData("CBaseAnimating", "css");
g_Assert.equal(g_CSSAnimating.KeyValues.ModelScale.Name, "modelscale");
g_Assert.equal(Object.hasOwn(g_CSSAnimating.KeyValues, "modelscale"), false);

const g_CSSGrenade = g_Data.GetEntityClassData("CBaseCSGrenade", "css");
g_Assert.equal(g_CSSGrenade.Properties.IsPinPulled.Name, "m_bPinPulled");
g_Assert.equal(g_CSSGrenade.Properties.ThrowTime.Name, "m_fThrowTime");
g_Assert.equal(Object.hasOwn(g_CSSGrenade.Properties, "pulled"), false);
g_Assert.equal(Object.hasOwn(g_CSSGrenade.Properties, "throwtime"), false);

const g_CSSBombTarget = g_Data.GetEntityClassData("CBombTarget", "css");
g_Assert.equal(g_CSSBombTarget.Inputs.BombExploded.Name, "BombExplode");
g_Assert.equal(Object.hasOwn(g_CSSBombTarget.Inputs, "bombExplode"), false);

const g_CSSPlayer = g_Data.GetEntityClassData("CCSPlayer", "css");
g_Assert.deepEqual(g_CSSPlayer.Functions.AddAccount.Arguments, ["int", "bool", "bool", "string"]);
g_Assert.deepEqual(g_CSSPlayer.Functions.Deafen.Arguments, ["float"]);
g_Assert.equal(g_CSSPlayer.BasedAttributes.MVPCount.Offset, 0x04);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.BasedAttributes, "mvps"), false);
g_Assert.equal(g_CSSPlayer.Properties.HasNightVision.Name, "m_bHasNightVision");
g_Assert.equal(g_CSSPlayer.Properties.IsInBombZone.Name, "m_bInBombZone");
g_Assert.equal(g_CSSPlayer.Properties.IsInBuyZone.Name, "m_bInBuyZone");
g_Assert.equal(g_CSSPlayer.Properties.IsInHostageRescueZone.Name, "m_bInHostageRescueZone");
g_Assert.equal(g_CSSPlayer.Properties.NightVisionEnabled.Name, "m_bNightVisionOn");
g_Assert.equal(g_CSSPlayer.Properties.MaximumFlashAlpha.Name, "m_flFlashMaxAlpha");
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "hasNightvision"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "inBombZone"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "inBuyZone"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "inRescueZone"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "nightvisionOn"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlayer.Properties, "flashAlpha"), false);

const g_CSSPlantedC4 = g_Data.GetEntityClassData("CPlantedC4", "css");
g_Assert.equal(g_CSSPlantedC4.Properties.IsTicking.Name, "m_bBombTicking");
g_Assert.equal(g_CSSPlantedC4.Properties.DetonationTime.Name, "m_flC4Blow");
g_Assert.equal(g_CSSPlantedC4.Properties.DefuseCountdown.Name, "m_flDefuseCountDown");
g_Assert.equal(Object.hasOwn(g_CSSPlantedC4.Properties, "ticking"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlantedC4.Properties, "c4Blow"), false);
g_Assert.equal(Object.hasOwn(g_CSSPlantedC4.Properties, "defuseCountDown"), false);

const g_HL2DMCombineBall = g_Data.GetEntityClassData("CPropCombineBall", "hl2dm");
g_Assert.equal(g_HL2DMCombineBall.Properties.DiesOnBounce.Name, "m_bBounceDie");
g_Assert.equal(g_HL2DMCombineBall.Properties.IsCaptureInProgress.Name, "m_bCaptureInProgress");
g_Assert.equal(g_HL2DMCombineBall.Properties.IsEmitting.Name, "m_bEmit");
g_Assert.equal(g_HL2DMCombineBall.Properties.HasFiredGrabbedOutput.Name, "m_bFiredGrabbedOutput");
g_Assert.equal(g_HL2DMCombineBall.Properties.MovesForward.Name, "m_bForward");
g_Assert.equal(g_HL2DMCombineBall.Properties.IsHeld.Name, "m_bHeld");
g_Assert.equal(g_HL2DMCombineBall.Properties.IsLaunched.Name, "m_bLaunched");
g_Assert.equal(g_HL2DMCombineBall.Properties.HasStruckEntity.Name, "m_bStruckEntity");
g_Assert.equal(g_HL2DMCombineBall.Properties.WasLaunchedByWeapon.Name, "m_bWeaponLaunched");
g_Assert.equal(g_HL2DMCombineBall.Properties.MaximumBounces.Name, "m_nMaxBounces");
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "bounceDie"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "captureInProgress"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "emit"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "firedGrabbedOutput"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "forward"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "held"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "launched"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "struckEntity"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "weaponLaunched"), false);
g_Assert.equal(Object.hasOwn(g_HL2DMCombineBall.Properties, "maxBounces"), false);

const g_CombatWeapon = g_Data.GetEntityClassData("CBaseCombatWeapon", "tf2");
g_Assert.equal(g_CombatWeapon.Properties.AmmoProperty.Name, "LocalWeaponData.m_iPrimaryAmmoType");
g_Assert.equal(g_CombatWeapon.Properties.SecondaryFireAmmoProperty.Name, "LocalWeaponData.m_iSecondaryAmmoType");
g_Assert.equal(g_CombatWeapon.Properties.Clip.Name, "m_iClip1");
g_Assert.equal(g_CombatWeapon.Properties.SecondaryFireClip.Name, "m_iClip2");
g_Assert.equal(Object.hasOwn(g_CombatWeapon.Properties, "ammoprop"), false);
g_Assert.equal(Object.hasOwn(g_CombatWeapon.Properties, "secondaryFireAmmoprop"), false);

const g_BaseDoor = g_Data.GetEntityClassData("CBaseDoor", "tf2");
g_Assert.equal(g_BaseDoor.KeyValues.Damage.Name, "dmg");
g_Assert.equal(g_BaseDoor.KeyValues.MoveDirection.Name, "movedir");
g_Assert.equal(g_BaseDoor.KeyValues.SpawnPosition.Name, "spawnpos");
g_Assert.equal(Object.hasOwn(g_BaseDoor.KeyValues, "dmg"), false);
g_Assert.equal(Object.hasOwn(g_BaseDoor.KeyValues, "moveDir"), false);
g_Assert.equal(Object.hasOwn(g_BaseDoor.KeyValues, "spawnPos"), false);

const g_LiveData = g_Data.LoadEntityData("tf2");
g_LiveData.CBaseEntity.TestValue = 42;
g_Assert.strictEqual(g_Data.LoadEntityData("tf2"), g_LiveData);
g_Assert.equal(g_Data.LoadEntityData("tf2").CBaseEntity.TestValue, 42);
delete g_LiveData.CBaseEntity.TestValue;

g_Assert.throws(() => g_Data.GetEntityDataGroups("left4dead2"), /Unsupported entity data SDK branch/);

{
	const strBaseEntityPath = `${g_strSourceDataRoot}/entities/CBaseEntity.ini`;
	const strConfigurationText = g_NativeFilesystem.ReadTextFile(strBaseEntityPath);
	const vecCommentCases = [
		{ Name: "PlainHash", Line: '"Plain # text" # outside', Documentation: "Plain # text" },
		{ Name: "EscapedQuote", Line: String.raw`"Quoted \" # text" # outside`, Documentation: 'Quoted " # text' },
		{ Name: "EscapedBackslash", Line: String.raw`"Backslash \\" # outside`, Documentation: "Backslash \\" },
		{ Name: "EscapedBackslashAndQuote", Line: String.raw`"Both \\\" # text" # outside`, Documentation: 'Both \\" # text' },
		{ Name: "UnquotedHash", Line: "Plain # outside", Documentation: "Plain" },
		{ Name: "EmptyQuotedValue", Line: '"" # outside', Documentation: "" },
	];
	const vecFixtureSections = vecCommentCases.map((CommentCase) => `[[${CommentCase.Name}]]\ndocumentation = ${CommentCase.Line}`);
	const vecSectionCases = [
		{ INISection: "based_attribute", Container: "BasedAttributes", Section: "BasedAttribute" },
		{ INISection: "function", Container: "Functions", Section: "Function" },
		{ INISection: "input", Container: "Inputs", Section: "Input" },
		{ INISection: "keyvalue", Container: "KeyValues", Section: "KeyValue" },
		{ INISection: "property", Container: "Properties", Section: "Property" },
		{ INISection: "virtual_function", Container: "VirtualFunctions", Section: "VirtualFunction" },
	];
	const vecSectionFixtures = vecSectionCases.map((SectionCase) => `[${SectionCase.INISection}]\nSectionProbe = m_iHealth`);
	g_mapEntityDataFixtureTexts.set(strBaseEntityPath, `${strConfigurationText}\n${vecSectionFixtures.join("\n")}\n${vecFixtureSections.join("\n")}\n`);

	try {
		g_Data.ClearEntityDataCache();
		const BaseEntityData = g_Data.GetEntityClassData("CBaseEntity", "tf2");
		for (const CommentCase of vecCommentCases) {
			g_Assert.equal(BaseEntityData.VirtualFunctions[CommentCase.Name].Documentation, CommentCase.Documentation, CommentCase.Name);
			g_Assert.equal(BaseEntityData.VirtualFunctions[CommentCase.Name].Section, "VirtualFunction", CommentCase.Name);
		}

		for (const SectionCase of vecSectionCases) {
			g_Assert.equal(BaseEntityData[SectionCase.Container].SectionProbe.Section, SectionCase.Section, SectionCase.Container);
			g_Assert.equal(BaseEntityData[SectionCase.Container].SectionProbe.Name, "m_iHealth", SectionCase.Container);
		}
	} finally {
		g_mapEntityDataFixtureTexts.delete(strBaseEntityPath);
		g_Data.ClearEntityDataCache();
	}
}

g_Data.ClearEntityDataCache();
g_Assert.deepEqual(g_Data.GetEntityDataGroups(), ["common", "orangebox"]);
g_Assert.deepEqual(g_GameData.GetGameDataGroups("entities", "css"), ["orangebox", "orangebox/cstrike"]);
g_Assert.deepEqual(
	g_GameData.GetGameDataPaths("entities", "CBasePlayer.ini", "css").map((strFilePath) => strFilePath.replace(g_strSourceDataRoot, "<data>")),
	["<data>/entities/CBasePlayer.ini", "<data>/entities/orangebox/CBasePlayer.ini", "<data>/entities/orangebox/cstrike/CBasePlayer.ini"],
);

const g_CSSPlayerData = g_GameData.LoadGameData("entities", "CBasePlayer.ini", "css");
g_Assert.equal(g_CSSPlayerData.Property.Speed, "localdata.m_flLaggedMovementValue");
g_Assert.equal(g_CSSPlayerData.VirtualFunction.GiveNamedItem.OffsetWindows, 408);
g_Assert.equal(g_CSSPlayerData.VirtualFunction.GiveNamedItem.OffsetLinux, 409);

const g_BladeGlobalAddresses = g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "blade");
g_Assert.equal(g_BladeGlobalAddresses.CEntityFactoryDictionary.ServerCheck, false);
g_Assert.equal(g_BladeGlobalAddresses.CGlobalEntityList.ServerCheck, false);
g_Assert.equal(g_BladeGlobalAddresses.IServer.ServerCheck, false);
g_Assert.equal(g_BladeGlobalAddresses.CBaseTempEntity.ServerCheck, false);
g_Assert.equal(Object.hasOwn(g_BladeGlobalAddresses.CEntityFactoryDictionary, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_BladeGlobalAddresses.CGlobalEntityList, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_BladeGlobalAddresses.IServer, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_BladeGlobalAddresses.CBaseTempEntity, "srvCheck"), false);

const g_CSGOGlobalAddresses = g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "csgo");
g_Assert.equal(g_CSGOGlobalAddresses.CEntityFactoryDictionary.ServerCheck, false);
g_Assert.equal(g_CSGOGlobalAddresses.CGlobalEntityList.ServerCheck, false);
g_Assert.equal(g_CSGOGlobalAddresses.IServer.ServerCheck, false);
g_Assert.equal(g_CSGOGlobalAddresses.CBaseTempEntity.ServerCheck, false);
g_Assert.equal(Object.hasOwn(g_CSGOGlobalAddresses.CEntityFactoryDictionary, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_CSGOGlobalAddresses.CGlobalEntityList, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_CSGOGlobalAddresses.IServer, "srvCheck"), false);
g_Assert.equal(Object.hasOwn(g_CSGOGlobalAddresses.CBaseTempEntity, "srvCheck"), false);

g_Assert.throws(() => g_GameData.GetGameDataGroups(1, "l4d2"), /must be a string/);
g_Assert.throws(() => g_GameData.GetGameDataGroups("unknown", "l4d2"), /Unsupported GameData kind/);
g_Assert.throws(() => g_GameData.GetGameDataGroups("memory", "dota"), /Unsupported GameData SDK branch/);
g_Assert.throws(() => g_GameData.GetGameDataGroups("memory", "__proto__"), /Unsupported GameData SDK branch/);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", 1, "GlobalAddresses.ini"), /must be a string/);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "../outside", "GlobalAddresses.ini"), /traversal/);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "/outside", "GlobalAddresses.ini"), /normalized relative path/);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "orangebox", "../GlobalAddresses.ini"), /without path separators/);
g_Assert.throws(() => g_GameData.ParseConfigObject(1), /must be a string/);

// Configuration counts are Numbers; actual native addresses are BigInt.
for (const strUnsafeIntegerText of ["0x20000000000000", String(2 ** 53)]) {
	g_Assert.throws(() => g_GameData.ParseConfigObject(`Count = ${strUnsafeIntegerText}`), /safe integer range/);
}

g_Assert.throws(() => g_GameData.ParseConfigObject("= 1"), /GameData key must be a non-empty string/);
g_Assert.throws(() => g_GameData.ParseConfigObject("invalid line"), /Invalid GameData assignment/);
g_Assert.throws(() => g_GameData.ParseConfigObject("\ninvalid line"), /line 2/);
g_Assert.throws(() => g_GameData.ParseConfigObject("entry = 1\n[entry]"), /section conflicts with an existing value/);

const g_PrototypeSafeConfiguration = g_GameData.ParseConfigObject("[constructor]\nvalue = 7");
const g_QuotedConfiguration = g_GameData.ParseConfigObject(String.raw`message = "value\"#still" # comment
items = "first,second", third
quoted_boolean = "TrUe"
quoted_decimal = "20"
quoted_hexadecimal = "0x14"
empty_items = ,,"",first,,
empty_value = ""`);

g_Assert.equal(Object.getPrototypeOf(g_PrototypeSafeConfiguration), Object.prototype);
g_Assert.equal(Object.hasOwn(g_PrototypeSafeConfiguration, "Constructor"), true);
g_Assert.equal(g_PrototypeSafeConfiguration.Constructor.Value, 7);
g_Assert.equal(g_QuotedConfiguration.Message, String.raw`value\"#still`);
g_Assert.deepEqual(g_QuotedConfiguration.Items, ["first,second", "third"]);
g_Assert.equal(g_QuotedConfiguration.QuotedBoolean, true);
g_Assert.equal(g_QuotedConfiguration.QuotedDecimal, 20);
g_Assert.equal(g_QuotedConfiguration.QuotedHexadecimal, 20);
g_Assert.deepEqual(g_QuotedConfiguration.EmptyItems, ["first"]);
g_Assert.equal(g_QuotedConfiguration.EmptyValue, "");
g_Assert.throws(() => g_GameData.ParseConfigObject("entry = first,second\n[entry]"), SyntaxError);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", null, "GlobalAddresses.ini"), TypeError);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "orangebox", null), TypeError);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "orangebox", "  "), TypeError);
g_Assert.throws(() => g_GameData.GetGameDataPath("memory", "../outside", "GlobalAddresses.ini"), RangeError);
g_Assert.equal(g_GameData.GetGameDataPath("memory", " orangebox ", " GlobalAddresses.ini "), g_GameData.GetGameDataPath("memory", "orangebox", "GlobalAddresses.ini"));

const g_OriginalSourceDataRootDescriptor = Object.getOwnPropertyDescriptor(g_NativePaths, "SOURCE_DATA_ROOT");
let g_unSourceDataRootReadCount = 0;

Object.defineProperty(g_NativePaths, "SOURCE_DATA_ROOT", {
	configurable: true,
	enumerable: true,
	get() {
		g_unSourceDataRootReadCount += 1;

		return `${g_strSourceDataRoot}/live`;
	},
});

try {
	const vecLivePaths = g_GameData.GetGameDataPaths("memory", "GlobalAddresses.ini", "l4d2");
	g_Assert.equal(g_unSourceDataRootReadCount, 1);
	g_Assert.equal(vecLivePaths.every((strFilePath) => strFilePath.startsWith(`${g_strSourceDataRoot}/live/memory/`)), true);

	const LiveGameData = g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "csgo");
	g_Assert.notStrictEqual(LiveGameData, g_CSGOGlobalAddresses, "a live source-root change must not reuse the previous root's cached data");
	g_Assert.deepEqual(LiveGameData, {});
	g_Assert.equal(g_unSourceDataRootReadCount, 2, "one source-root snapshot per load");
	g_Assert.strictEqual(g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "csgo"), LiveGameData);
	g_Assert.equal(g_unSourceDataRootReadCount, 3, "cached loads still resolve their live source-root identity");

	for (const strNetworkRoot of [String.raw`\\server\share\root`, "//server/share//root/"]) {
		Object.defineProperty(g_NativePaths, "SOURCE_DATA_ROOT", { configurable: true, enumerable: true, value: strNetworkRoot });
		g_Assert.deepEqual(g_GameData.GetGameDataPaths("memory", "GlobalAddresses.ini", "csgo"), ["//server/share/root/memory/GlobalAddresses.ini", "//server/share/root/memory/csgo/GlobalAddresses.ini"]);
	}

	for (const strPOSIXRoot of ["/", "///"]) {
		Object.defineProperty(g_NativePaths, "SOURCE_DATA_ROOT", { configurable: true, enumerable: true, value: strPOSIXRoot });
		g_Assert.deepEqual(g_GameData.GetGameDataPaths("memory", "GlobalAddresses.ini", "csgo"), ["/memory/GlobalAddresses.ini", "/memory/csgo/GlobalAddresses.ini"]);
	}

	for (const InvalidSourceRoot of [null, ""]) {
		Object.defineProperty(g_NativePaths, "SOURCE_DATA_ROOT", { configurable: true, enumerable: true, value: InvalidSourceRoot });
		g_Assert.throws(() => g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "csgo"), /Source data root must be/);
	}
} finally {
	Object.defineProperty(g_NativePaths, "SOURCE_DATA_ROOT", g_OriginalSourceDataRootDescriptor);
}

g_Assert.strictEqual(g_GameData.LoadGameData("memory", "GlobalAddresses.ini", "csgo"), g_CSGOGlobalAddresses, "restoring the original root restores its independent cached object");

const g_OriginalGetGlobalVariables = g_NativeGlobals.GetGlobalVariables;

try {
	g_NativeGlobals.GetGlobalVariables = function LiveGetGlobalVariables() {
		return { SDKBranch: "css" };
	};
	g_Assert.deepEqual(g_GameData.GetGameDataGroups("entities"), ["orangebox", "orangebox/cstrike"]);
} finally {
	g_NativeGlobals.GetGlobalVariables = g_OriginalGetGlobalVariables;
}

const g_OriginalDoesFileExist = g_NativeFilesystem.DoesFileExist;
let g_unFilesystemExistsCallCount = 0;

try {
	g_NativeFilesystem.DoesFileExist = function LiveDoesFileExist(strGameDataFilePath) {
		g_Assert.equal(this, g_NativeFilesystem);
		g_Assert.equal(typeof strGameDataFilePath, "string");
		g_unFilesystemExistsCallCount += 1;

		return g_unFilesystemExistsCallCount === 2;
	};
	g_Assert.equal(g_GameData.HasGameData("memory", "GlobalAddresses.ini", "l4d2"), true);
	g_Assert.equal(g_unFilesystemExistsCallCount, 2);

	g_NativeFilesystem.DoesFileExist = function InvalidDoesFileExist() {
		return 1;
	};
	g_Assert.throws(() => g_GameData.HasGameData("memory", "GlobalAddresses.ini", "l4d2"), /must return a boolean/);
} finally {
	g_NativeFilesystem.DoesFileExist = g_OriginalDoesFileExist;
}

const g_strGameDataDocumentation = g_FileSystem.readFileSync(g_strGameDataDocumentationPath, "utf8");
const g_vecGameDataDocumentationBlocks = Array.from(g_strGameDataDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
const g_setGameDataDocumentationCalls = new Set();
const g_DocumentedGameData = new Proxy(g_GameData, {
	get(Target, strProperty, Receiver) {
		const Value = Reflect.get(Target, strProperty, Receiver);
		if ((typeof strProperty !== "string") || (typeof Value !== "function")) {
			return Value;
		}

		return (...vecArguments) => {
			g_setGameDataDocumentationCalls.add(strProperty);

			return Reflect.apply(Value, Target, vecArguments);
		};
	},
});

g_Assert.equal(g_vecGameDataDocumentationBlocks.length, 8);
g_Assert.doesNotMatch(g_strGameDataDocumentation, /Generated by|generate_api_docs|const result =|Welcome to the SourceJS server|moduleName|addressString/);

for (const vecLinkMatch of g_strGameDataDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strLinkTarget = vecLinkMatch[1].split("#", 1)[0];
	if ((strLinkTarget.length === 0) || /^[a-z]+:/i.test(strLinkTarget)) {
		continue;
	}

	const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strGameDataDocumentationPath), strLinkTarget);
	g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `Missing memory/gamedata documentation link: ${strLinkTarget}`);
}

function RequireGameDataDocumentation(strModuleName) {
	if (strModuleName === "filesystem") {
		return g_NativeFilesystem;
	}

	if (strModuleName === "globals") {
		return g_NativeGlobals;
	}

	if (strModuleName === "memory/gamedata") {
		return g_DocumentedGameData;
	}

	throw new Error(`Unexpected memory/gamedata documentation module: ${strModuleName}`);
}

for (const [unBlockIndex, strDocumentationBlock] of g_vecGameDataDocumentationBlocks.entries()) {
	g_Assert.doesNotMatch(strDocumentationBlock, /^(?:const|let) (?!g_|[A-Z][A-Z0-9_]*\s*=)[A-Za-z]\w*\s*=/m, "documentation module implementation state retains g_ and its actual value category");
	g_VM.runInNewContext('"use strict";\n' + strDocumentationBlock, {
		console: {
			log() {
				throw new Error("memory/gamedata documentation must verify results instead of printing them");
			},
		},
		require: RequireGameDataDocumentation,
	}, {
		filename: `${g_strGameDataDocumentationPath}#block-${unBlockIndex + 1}`,
	});
}

g_Assert.deepEqual([...g_setGameDataDocumentationCalls].sort(), Object.keys(g_GameData).sort(), "memory/gamedata documentation must call every export");

const g_strCacheDocumentationBlock = g_vecGameDataDocumentationBlocks.find((strDocumentationBlock) => strDocumentationBlock.includes("{ ClearGameDataCache, LoadGameData }"));
g_Assert.equal(typeof g_strCacheDocumentationBlock, "string");

const g_CacheProbeData = {};
let g_unCacheProbeLoadCount = 0;
const g_CacheFailureGameData = {
	LoadGameData() {
		++g_unCacheProbeLoadCount;

		return (g_unCacheProbeLoadCount === 1) ? g_CacheProbeData : {};
	},
	ClearGameDataCache() {
		g_Assert.fail("The failed cache probe must not clear unrelated cached records.");
	},
};

const g_RequireCacheProbe = function (strModuleName) {
	if (strModuleName === "globals") {
		return g_NativeGlobals;
	}

	if (strModuleName === "memory/gamedata") {
		return g_CacheFailureGameData;
	}

	throw new Error(`Unexpected cache documentation dependency: ${strModuleName}`);
};

g_Assert.throws(() => g_VM.runInNewContext('"use strict";\n' + g_strCacheDocumentationBlock, { require: g_RequireCacheProbe }), /GameData cache identity changed before ClearGameDataCache/);
g_Assert.equal(Object.hasOwn(g_CacheProbeData, "SourceJSDocumentationProbe"), false, "the failed documentation cache probe removes its own temporary property");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = Array.from(g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
const g_setDocumentationCalls = new Set();
const g_DocumentationData = new Proxy(g_Data, {
	get(Target, strProperty, Receiver) {
		const Value = Reflect.get(Target, strProperty, Receiver);
		if ((typeof strProperty !== "string") || (typeof Value !== "function")) {
			return Value;
		}

		return (...vecArguments) => {
			g_setDocumentationCalls.add(strProperty);

			return Reflect.apply(Value, Target, vecArguments);
		};
	},
});

g_Assert.equal(g_vecDocumentationBlocks.length, 11);
g_Assert.ok(g_strDocumentation.includes("| `Offset` | number | Byte offset relative to `Base` for a based attribute, or relative to the entity instance for an instance attribute. |"), "Offset must describe a byte offset relative to Base or the instance, not an absolute native address.");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|generate_api_docs|const result =|Welcome to the SourceJS server|parseWeaponINI|moduleName|addressString/);

for (const strRelatedDocument of [
	"entities-datamaps.md",
	"entities-outputs.md",
	"entities-props.md",
	"memory-gamedata.md",
	"memory-manager.md",
]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelatedDocument)), true, `Missing related document: ${strRelatedDocument}`);
}

const g_vecEntityDataDocumentationRecords = [];
const g_EntityDataDocumentationLoggers = {
	LogInfo(strFormat, Record) {
		g_Assert.equal(strFormat, "%j");
		g_Assert.equal(Object.keys(Record)[0], "Operation");
		g_vecEntityDataDocumentationRecords.push(JSON.parse(JSON.stringify(Record)));
	},
};

function RequireDocumentation(strModuleName) {
	if (strModuleName === "entities/data") {
		return g_DocumentationData;
	}

	if (strModuleName === "loggers") {
		return g_EntityDataDocumentationLoggers;
	}

	throw new Error(`Unexpected documentation module: ${strModuleName}`);
}

const g_unMutationDocumentationBlockIndex = 8;

for (let unBlockIndex = 0; unBlockIndex < g_vecDocumentationBlocks.length; unBlockIndex += 1) {
	let DocumentationDescriptor = null;
	let bHadDocumentation = false;
	let strPreviousDocumentation = undefined;

	if (unBlockIndex === g_unMutationDocumentationBlockIndex) {
		DocumentationDescriptor = g_Data.GetEntityVirtualFunctionDescriptor("CBaseEntity", "SetModel", "tf2");
		bHadDocumentation = Object.hasOwn(DocumentationDescriptor, "Documentation");
		strPreviousDocumentation = DocumentationDescriptor.Documentation;
	}

	g_VM.runInNewContext(g_vecDocumentationBlocks[unBlockIndex], {
		require: RequireDocumentation,
	}, {
		filename: `${g_strDocumentationPath}#block-${unBlockIndex + 1}`,
	});

	if (unBlockIndex === g_unMutationDocumentationBlockIndex) {
		g_Assert.equal(Object.hasOwn(DocumentationDescriptor, "Documentation"), bHadDocumentation);
		g_Assert.equal(DocumentationDescriptor.Documentation, strPreviousDocumentation);
	}
}

g_Assert.deepEqual(
	[...g_setDocumentationCalls].sort(),
	g_vecExpectedExports.filter((strExportName) => /^[A-Z]/.test(strExportName)).sort(),
	"entities/data documentation must call every export",
);

g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\s*\(/);
g_Assert.deepEqual(g_vecEntityDataDocumentationRecords.map((Record) => Record.Operation), [
	"InspectEntityInstanceAttribute",
	"InspectEntityDataCoverage",
	"InspectEntityClassData",
	"InspectEntityDescriptors",
	"InspectEntityCallableMetadata",
	"OverrideEntityMetadata",
	"ReloadEntityMetadata",
	"RequireEntityMetadata",
]);
g_Assert.deepEqual(g_vecEntityDataDocumentationRecords[0], { Operation: "InspectEntityInstanceAttribute", LinuxByteOffset: 0x588, Type: "float", WindowsByteOffset: 0x570 });
g_Assert.equal(g_vecEntityDataDocumentationRecords[1].SDKBranchCount, 24);
g_Assert.deepEqual(g_vecEntityDataDocumentationRecords[1].TF2EntityDataGroups, ["common", "orangebox", "orangebox/tf"]);
g_Assert.equal(g_vecEntityDataDocumentationRecords[2].SameRecord, true);
g_Assert.equal(g_vecEntityDataDocumentationRecords[5].Documentation, "Temporary plugin-local note");
g_Assert.ok(Array.isArray(g_vecEntityDataDocumentationRecords[6].ClassNames));

const g_vecRemovedEntityIndexes = [];
const g_mapLazyDictionary = new g_Dictionary.EntityDictionary((unIndex, strSuffix) => ({ Index: unIndex, Label: `${unIndex}:${strSuffix}` }), "ok");

g_mapLazyDictionary.OnAutomaticallyRemoved = (unIndex) => g_vecRemovedEntityIndexes.push(unIndex);

const g_LazyEntity = g_mapLazyDictionary.get(7);
g_Assert.equal(g_LazyEntity.Label, "7:ok");
g_Assert.strictEqual(g_mapLazyDictionary.get(7), g_LazyEntity);
g_Assert.deepEqual(Array.from(g_mapLazyDictionary.keys()), [7]);
g_Assert.strictEqual(g_mapLazyDictionary.FromIntegerHandle(0), g_mapLazyDictionary.get(12));
g_Assert.equal(g_mapLazyDictionary.OnNetworkedEntityDeleted({ Index: 7 }), true);
g_Assert.deepEqual(g_vecRemovedEntityIndexes, [7]);
g_Assert.equal(g_mapLazyDictionary.has(7), false);
g_Assert.equal(g_mapLazyDictionary.delete(7), false);
g_Assert.equal(g_mapLazyDictionary.Unload(), true);
g_Assert.equal(g_mapLazyDictionary.Unload(), false);

const g_mapUncachedDictionary = new g_Dictionary.EntityDictionary((unIndex) => ({
	Index: unIndex,
	IsEntityMarkedForDeletion() {
		return true;
	},
}));
const g_FirstUncachedEntity = g_mapUncachedDictionary.get(3);
g_Assert.equal(g_mapUncachedDictionary.has(3), false);
g_Assert.notStrictEqual(g_FirstUncachedEntity, g_mapUncachedDictionary.get(3));
g_Assert.equal(g_mapUncachedDictionary.Unload(), true, "uncached entity dictionary must unload successfully");

const g_mapDisabledDictionary = new g_Dictionary.EntityDictionary(null);
g_Assert.throws(() => g_mapDisabledDictionary.get(1), /Entity index is not cached/);
g_Assert.equal(g_mapDisabledDictionary.Unload(), true, "disabled entity dictionary must unload successfully");

const g_vecCreatedEntityIndexes = [];

const g_EntityIterator = {
	*[Symbol.iterator]() {
		yield { Index: 4, IsValid: true };
		yield { Index: 5, IsValid: false };
	},
	IsEntityValid(Entity) {
		return Entity.IsValid;
	},
};

const g_mapSyncedDictionary = new g_Dictionary.SyncedEntityDictionary((unIndex) => ({ Index: unIndex, Synced: true }), g_EntityIterator);

g_mapSyncedDictionary.OnAutomaticallyCreated = (unIndex) => g_vecCreatedEntityIndexes.push(unIndex);
g_Assert.equal(g_mapSyncedDictionary.has(4), true);
g_Assert.equal(g_mapSyncedDictionary.has(5), false);
g_Assert.throws(() => g_mapSyncedDictionary.get(8), /Entity index is not synced/);
g_Assert.equal(g_mapSyncedDictionary.OnNetworkedEntityCreated({ Index: 6, IsValid: true }), true);
g_Assert.equal(g_mapSyncedDictionary.has(6), true);
g_Assert.deepEqual(g_vecCreatedEntityIndexes, [6]);
g_Assert.equal(g_mapSyncedDictionary.OnNetworkedEntityCreated({ Index: 9, IsValid: false }), false);
g_Assert.equal(g_mapSyncedDictionary.Unload(), true);

delete require.cache[g_strEntityDataPath];
delete require.cache[g_strFilesystemPath];
delete require.cache[g_strGlobalsPath];
delete require.cache[g_strPathsPath];
delete globalThis.sourcejs;

const g_FinalResolveFilename = g_Module._resolveFilename;
g_Module._resolveFilename = function ResolveFilename(strRequest, Parent, bIsMain, Options) {
	if (strRequest === "filesystem") {
		return g_strFilesystemPath;
	}

	if (strRequest === "internal/runtime") {
		return g_strRuntimePath;
	}

	return g_FinalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
};

try {
	g_Assert.throws(() => require(g_strEntityDataPath), /SourceJS native runtime is not installed/);
} finally {
	g_Module._resolveFilename = g_FinalResolveFilename;
}

console.log("[smoke] entities/data and documentation contracts passed");
