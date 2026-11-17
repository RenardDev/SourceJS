#!/usr/bin/env node

"use strict";

const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strFieldsPath = g_Path.join(g_strPackageRoot, "effects", "fields.js");
const g_strFileSystemPath = g_Path.join(g_strPackageRoot, "filesystem.js");
const g_strGlobalsPath = g_Path.join(g_strPackageRoot, "globals.js");
const g_strHooksPath = g_Path.join(g_strPackageRoot, "effects", "hooks.js");
const g_strPathsPath = g_Path.join(g_strPackageRoot, "paths.js");
const g_strTemplatesPath = g_Path.join(g_strPackageRoot, "effects", "templates.js");
const g_strSourceDataRoot = g_Path.join(g_strProjectRoot, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs").replace(/\\/g, "/");
const g_vecExpectedSDKBranches = [
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
const g_FileSystemFaultState = {
	RejectNextEffectsDataFile: false,
};

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertArray(vecActualValues, vecExpectedValues, strErrorMessage) {
	AssertEqual(JSON.stringify(vecActualValues), JSON.stringify(vecExpectedValues), strErrorMessage);
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function VerifyEffectsSourceDataRoot(strSourceDataRoot, strExpectedIndexPath) {
	const ModuleRecord = { exports: {} };
	const FileSystem = {
		DoesFileExist(strFilePath) {
			AssertEqual(strFilePath, strExpectedIndexPath, "effects index existence path");

			return true;
		},
		ReadTextFile(strFilePath) {
			AssertEqual(strFilePath, strExpectedIndexPath, "effects index read path");

			return JSON.stringify({ Branches: { sdk2013: [] }, Groups: { common: [] } });
		},
	};
	const RequireDependency = strModuleName => {
		switch (strModuleName) {
			case "filesystem":
				return FileSystem;

			case "globals":
				return { GetGlobalVariables: () => ({ SDKBranch: "sdk2013" }) };

			case "paths":
				return { SOURCE_DATA_ROOT: strSourceDataRoot };

			default:
				throw new Error(`Unexpected effects path-test dependency: ${strModuleName}`);
		}
	};
	const strModuleSource = g_FileSystem.readFileSync(g_strFieldsPath, "utf8");
	g_VM.runInNewContext(strModuleSource, { module: ModuleRecord, require: RequireDependency }, { filename: g_strFieldsPath });
	AssertArray(ModuleRecord.exports.GetTemporaryEntityFieldGroups("sdk2013"), ["common"], "effects path-test index group");
}

InstallDependency(g_strFileSystemPath, {
	DoesFileExist(strFilePath) {
		if (g_FileSystemFaultState.RejectNextEffectsDataFile && !strFilePath.endsWith("/effects/index.json")) {
			g_FileSystemFaultState.RejectNextEffectsDataFile = false;
			return false;
		}

		return g_FileSystem.existsSync(strFilePath);
	},
	ReadTextFile(strFilePath) {
		return g_FileSystem.readFileSync(strFilePath, "utf8");
	},
});

InstallDependency(g_strGlobalsPath, {
	GetGlobalVariables() {
		return { SDKBranch: "sdk2013" };
	},
});

InstallDependency(g_strPathsPath, { SOURCE_DATA_ROOT: g_strSourceDataRoot });

let g_unNativeCreateCount = 0;
let g_NativeCreateCall = null;
let g_vecNativeTemplateListResult = null;

globalThis.sourcejs = {
	effects: {
		CreateTempEntity(strTemporaryEntityName, PropertyValues, vecRecipients, flEffectDelay, bReliableDelivery) {
			g_unNativeCreateCount += 1;
			g_NativeCreateCall = {
				EffectDelay: flEffectDelay,
				PropertyValues,
				Recipients: vecRecipients,
				ReliableDelivery: bReliableDelivery,
				TemporaryEntityName: strTemporaryEntityName,
			};

			return true;
		},
		GetTempEntity(strTemporaryEntityName) {
			if (strTemporaryEntityName === "MissingTemporaryEntity") {
				return null;
			}

			if (strTemporaryEntityName === "BrokenTemporaryEntity") {
				throw new Error("native temporary entity lookup failed");
			}

			return {
				ClassIndex: 1,
				ClassName: "CTEBeamEnts",
				Name: strTemporaryEntityName,
				Properties: [{ Name: "m_nSpeed", Path: "m_nSpeed", Offset: 0, Type: "int" }],
				Size: 64,
				TableName: "DT_TEBeamEnts",
			};
		},
		ListTempEntities() {
			g_vecNativeTemplateListResult = [this.GetTempEntity("BeamEnts")];

			return g_vecNativeTemplateListResult;
		},
	},
};

function VerifyOwnEffectProfileData() {
	const strSource = g_FileSystem.readFileSync(g_strFieldsPath, "utf8");
	let unScenarioCount = 0;
	const LoadProfile = (Index, vecFiles = []) => {
		const mapFiles = new Map([["/profiles/effects/index.json", JSON.stringify(Index)], ...vecFiles]);
		const ModuleRecord = { exports: {} };
		const RequireDependency = (strModuleName) => {
			if (strModuleName === "filesystem") {
				return {
					DoesFileExist(strFilePath) {
						return mapFiles.has(strFilePath);
					},
					ReadTextFile(strFilePath) {
						Assert(mapFiles.has(strFilePath), `Unexpected effects profile read: ${strFilePath}`);

						return mapFiles.get(strFilePath);
					},
				};
			}

			if (strModuleName === "globals") {
				return { GetGlobalVariables: () => ({ SDKBranch: "sdk2013" }) };
			}

			AssertEqual(strModuleName, "paths", "own-profile dependency");

			return { SOURCE_DATA_ROOT: "/profiles" };
		};
		const Context = g_VM.createContext({ module: ModuleRecord, require: RequireDependency });
		g_VM.runInContext(strSource, Context, { filename: g_strFieldsPath });

		return { API: ModuleRecord.exports, Prototype: g_VM.runInContext("Object.prototype", Context) };
	};
	const InjectPrototype = (Profile, strEntryName, Value, bSetter = false) => {
		const Descriptor = { configurable: true };
		if (bSetter) {
			Descriptor.set = () => {
				throw new Error("Inherited effects setter must not run.");
			};

		} else {
			Descriptor.enumerable = true;
			Descriptor.value = Value;
		}

		Object.defineProperty(Profile.Prototype, strEntryName, Descriptor);
	};
	const ExpectError = (Callback, strExpectedName) => {
		let bThrew = false;
		let CaughtError;

		try {
			Callback();
		} catch (ErrorValue) {
			bThrew = true;
			CaughtError = ErrorValue;
		}

		Assert(bThrew && (CaughtError?.name === strExpectedName), `Own-profile validation must throw ${strExpectedName}.`);
	};
	const CreateIndex = () => ({ Branches: { sdk2013: [] }, Groups: { common: [] } });
	const MissingClassProfile = LoadProfile(CreateIndex());
	for (const strClassName of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]) {
		const Definition = MissingClassProfile.API.GetTemporaryEntityFieldDefinition(strClassName, "sdk2013");
		AssertArray(Object.keys(Definition.Fields), [], "absent class must not resolve an inherited definition");
		AssertArray(Object.keys(Definition.Types), [], "absent class must not resolve inherited types");
		AssertEqual(Object.getPrototypeOf(Definition.Fields), MissingClassProfile.Prototype, "public definition map prototype");
		unScenarioCount += 1;
	}

	for (const strClassName of ["constructor", "__proto__", "CTEOrdinary"]) {
		const Index = CreateIndex();
		Index.Groups.common = [`${strClassName}.ini`];
		const Profile = LoadProfile(Index, [[`/profiles/effects/${strClassName}.ini`, "Width=m_flWidth"]]);
		const Data = Profile.API.GetTemporaryEntityFieldData();
		Assert(Object.hasOwn(Data.common, strClassName), "configured class must be an own data entry");
		AssertEqual(Object.getPrototypeOf(Data.common), Profile.Prototype, "public group prototype must not change");
		AssertEqual(Profile.API.GetTemporaryEntityFieldDefinition(strClassName).Fields.Width, "m_flWidth", "configured class field");
		unScenarioCount += 1;
	}

	for (const strGroupName of ["common", "__proto__", "constructor"]) {
		const Index = CreateIndex();
		Index.Groups = Object.create(null);
		Index.Groups.common = [];
		Index.Groups[strGroupName] = ["CTEOwn.ini"];
		const Profile = LoadProfile(Index, [["/profiles/effects/CTEOwn.ini", "Width=m_flWidth"]]);
		const Data = Profile.API.GetTemporaryEntityFieldData();
		Assert(Object.hasOwn(Data, strGroupName), "configured group must be an own data entry");
		Assert(Object.hasOwn(Data[strGroupName], "CTEOwn"), "configured group class");
		AssertEqual(Object.getPrototypeOf(Data), Profile.Prototype, "public aggregate prototype must not change");
		unScenarioCount += 1;
	}

	for (const strSDKBranch of ["constructor", "__proto__"]) {
		const Index = CreateIndex();
		Object.defineProperty(Index.Branches, strSDKBranch, { enumerable: true, value: [] });
		const Profile = LoadProfile(Index);
		AssertArray(Profile.API.GetTemporaryEntityFieldGroups(strSDKBranch), ["common"], "own custom branch entry");
		unScenarioCount += 1;
	}

	const BranchProfile = LoadProfile(CreateIndex());
	InjectPrototype(BranchProfile, "InjectedSDK", []);
	ExpectError(() => BranchProfile.API.GetTemporaryEntityFieldGroups("InjectedSDK"), "ReferenceError");
	unScenarioCount += 1;

	const GroupIndex = CreateIndex();
	GroupIndex.Branches.sdk2013 = ["InjectedGroup"];
	const GroupProfile = LoadProfile(GroupIndex);
	InjectPrototype(GroupProfile, "InjectedGroup", []);
	ExpectError(() => GroupProfile.API.GetTemporaryEntityFieldDefinition("CTEMissing"), "TypeError");
	unScenarioCount += 1;

	const ClassProfile = LoadProfile(CreateIndex());
	InjectPrototype(ClassProfile, "CTEInjected", { Fields: [["Width", "m_flWidth"]], Types: [] });
	AssertArray(Object.keys(ClassProfile.API.GetTemporaryEntityFieldDefinition("CTEInjected").Fields), [], "inherited class must not contribute fields");
	unScenarioCount += 1;

	for (const strIndexMember of ["Branches", "Groups"]) {
		const Index = CreateIndex();
		const Value = Index[strIndexMember];
		delete Index[strIndexMember];
		const Profile = LoadProfile(Index);
		InjectPrototype(Profile, strIndexMember, Value);
		ExpectError(() => Profile.API.GetTemporaryEntityFieldGroups(), "TypeError");
		unScenarioCount += 1;
	}

	for (const strSetterName of ["CTESetter", "Width", "Color", "common"]) {
		const Index = CreateIndex();
		Index.Groups.common = ["CTESetter.ini"];
		const Profile = LoadProfile(Index, [["/profiles/effects/CTESetter.ini", "Width=m_flWidth\n[Color]\nName=Red, Green, Blue\nType=color"]]);
		InjectPrototype(Profile, strSetterName, undefined, true);
		const Definition = Profile.API.GetTemporaryEntityFieldDefinition("CTESetter");
		AssertEqual(Definition.Fields.Width, "m_flWidth", "own field write bypasses inherited setter");
		AssertArray(Definition.Types.Color.ValueFields, ["Red", "Green", "Blue"], "own type write bypasses inherited setter");
		Assert(Object.hasOwn(Profile.API.GetTemporaryEntityFieldData(), "common"), "own aggregate write bypasses inherited setter");
		unScenarioCount += 1;
	}

	AssertEqual(unScenarioCount, 29, "own effects profile scenario count");
	console.log("Effect profile own-data 29 profiles passed.");
}

function VerifyCanonicalEffectProfile(Fields, strProfileFileName, strSDKBranch = "sdk2013", vecExpectedNameReferences = [], ExpectedFields = {}) {
	const strProfilePath = g_Path.join(g_strSourceDataRoot, "effects", strProfileFileName);
	const strProfileText = g_FileSystem.readFileSync(strProfilePath, "utf8");
	Assert(!strProfileText.includes("\r\n") || !strProfileText.replace(/\r\n/g, "").includes("\n"), `${strProfileFileName} line endings must be consistent`);

	const vecDescriptorNames = [...strProfileText.matchAll(/^\t*(?:\[+([A-Za-z_][A-Za-z0-9_]*)\]+|([A-Za-z_][A-Za-z0-9_]*)\s*=)/gm)].map(vecMatch => vecMatch[1] ?? vecMatch[2]);
	Assert(vecDescriptorNames.length > 0, `${strProfileFileName} must contain readable descriptors`);

	for (const strDescriptorName of vecDescriptorNames) {
		Assert(/^[A-Z][A-Za-z0-9]*$/.test(strDescriptorName), `${strProfileFileName} packaged descriptors must already be PascalCase`);
	}

	const vecNameReferences = [...strProfileText.matchAll(/^\t*Name\s*=\s*(.+)$/gm)].map(vecMatch => vecMatch[1].trim());
	for (const strExpectedReference of vecExpectedNameReferences) {
		Assert(vecNameReferences.includes(strExpectedReference), `${strProfileFileName} own field references must already use their PascalCase names`);
	}

	const strClassName = g_Path.basename(strProfileFileName, ".ini");
	const Definition = Fields.GetTemporaryEntityFieldDefinition(strClassName, strSDKBranch);
	Assert((Object.keys(Definition.Fields).length + Object.keys(Definition.Types).length) > 0, `${strProfileFileName} must participate in the actual field-data lookup`);

	for (const FieldType of Object.values(Definition.Types)) {
		Assert((typeof FieldType.Type === "string") && /^[a-z][a-z0-9]*$/.test(FieldType.Type), `${strProfileFileName} packaged type discriminators must already be compact lowercase`);
	}

	for (const vecFieldEntry of Object.entries(ExpectedFields)) {
		const strFieldName = vecFieldEntry[0];
		const strNativeFieldPath = vecFieldEntry[1];
		Assert(Definition.Fields[strFieldName] === strNativeFieldPath, `${strProfileFileName} actual SDK lookup must retain ${strFieldName} = ${strNativeFieldPath}`);
	}
}

try {
	const Fields = require(g_strFieldsPath);
	const Hooks = require(g_strHooksPath);
	const Templates = require(g_strTemplatesPath);

	VerifyOwnEffectProfileData();

	VerifyCanonicalEffectProfile(Fields, "CTEArmorRicochet.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEBSPDecal.ini", "sdk2013", ["EntityIndex", "DecalIndex"]);

	const BSPDecalFieldDefinition = Fields.GetTemporaryEntityFieldDefinition("CTEBSPDecal", "sdk2013");
	Assert(BSPDecalFieldDefinition.Types.Entity.Type === "entity", "BSP Entity adapter discriminator must already be compact lowercase");
	Assert(BSPDecalFieldDefinition.Types.Decal.Type === "decal", "BSP Decal adapter discriminator must already be compact lowercase");

	VerifyCanonicalEffectProfile(Fields, "CTEBeamEntPoint.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex", "StartEntityIndex", "EndEntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamEnts.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex", "StartEntityIndex", "EndEntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamFollow.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex", "EntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamLaser.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex", "StartEntityIndex", "EndEntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamRing.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex", "StartEntityIndex", "EndEntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamRingPoint.ini", "sdk2013", ["HaloIndex", "ModelIndex", "Red, Green, Blue, Alpha"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamSpline.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEBloodSprite.ini", "sdk2013", ["Red, Green, Blue, Alpha", "DropModelIndex", "SprayModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBloodStream.ini", "sdk2013", ["Red, Green, Blue, Alpha"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBreakModel.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBeamPoints.ini", "sdk2013", ["Red, Green, Blue, Alpha", "ModelIndex", "HaloIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBubbleTrail.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEBubbles.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEClientProjectile.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEDecal.ini", "sdk2013", ["EntityIndex", "DecalIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEDust.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEDynamicLight.ini", "sdk2013", ["Red, Green, Blue"]);
	VerifyCanonicalEffectProfile(Fields, "CTEEnergySplash.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEExplosion.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEFizz.ini", "sdk2013", ["EntityIndex", "ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEFootprintDecal.ini", "sdk2013", ["EntityIndex", "DecalIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEGaussExplosion.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEGlowSprite.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEImpact.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEKillPlayerAttachments.ini", "sdk2013", ["PlayerIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTELargeFunnel.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEMetalSparks.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEMuzzleFlash.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEPlayerDecal.ini", "sdk2013", ["EntityIndex", "PlayerIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEProjectedDecal.ini", "sdk2013", ["DecalIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEShatterSurface.ini");
	VerifyCanonicalEffectProfile(Fields, "CTEShowLine.ini");
	VerifyCanonicalEffectProfile(Fields, "CTESmoke.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTESparks.ini");
	VerifyCanonicalEffectProfile(Fields, "CTESprite.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTESpriteSpray.ini", "sdk2013", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "CTEWorldDecal.ini", "sdk2013", ["DecalIndex"]);
	VerifyCanonicalEffectProfile(Fields, "bms/CBlackMesaFireBullets.ini", "bms", ["EntityIndex"]);
	VerifyCanonicalEffectProfile(Fields, "bms/CTEEffectDispatch.ini", "bms", ["EntityIndex", "MaterialIndex"]);
	VerifyCanonicalEffectProfile(Fields, "bms/CTEPhysicsProp.ini", "bms", ["ModelIndex"]);
	VerifyCanonicalEffectProfile(Fields, "bms/CTEPlayerAnimEvent.ini", "bms");
	VerifyCanonicalEffectProfile(Fields, "bms/CTEWeaponBullets.ini", "bms", [], { WeaponID: "weaponId" });
	VerifyCanonicalEffectProfile(Fields, "bms/CTE_TauBeam.ini", "bms", ["PlayerIndex"]);
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEEffectDispatch.ini", "csgo", ["EntityIndex", "OtherEntityIndex", "MaterialIndex"], { ArePositionsRelativeToEntity: "m_EffectData.m_bPositionsAreRelativeToEntity", OtherEntityIndex: "m_EffectData.m_nOtherEntIndex" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEFireBullets.ini", "csgo", ["PlayerIndex"], { ItemDefinitionIndex: "m_nItemDefIndex", SoundType: "m_iSoundType" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEFoundryHelpers.ini", "csgo", ["EntityIndex"], { EntityIndex: "m_iEntity" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEPhysicsProp.ini", "csgo", ["ModelIndex"], { RenderColor: "m_clrRender", Effects: "m_nEffects" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEPlantBomb.ini", "csgo", ["PlayerIndex"], { PlayerIndex: "m_iPlayer", Option: "m_option" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTEPlayerAnimEvent.ini", "csgo", [], { PlayerHandle: "m_hPlayer" });
	VerifyCanonicalEffectProfile(Fields, "csgo/CTERadioIcon.ini", "csgo", ["PlayerIndex"], { PlayerIndex: "m_iAttachToClient" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEAntlionDust.ini", "gmod", [], { IsSpawnerBlocked: "m_bBlockedSpawner", Angles: "m_vecAngles" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEConcussiveExplosion.ini", "gmod", [], { Magnitude: "m_nMagnitude", Radius: "m_nRadius" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEEffectDispatch.ini", "gmod", ["EntityIndex", "MaterialIndex"], { AllowOverride: "m_bAllowOverride", HasCustomColors: "m_EffectData.m_bCustomColors" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEHL2MPFireBullets.ini", "gmod", ["PlayerIndex"], { DoImpacts: "m_bDoImpacts", TracerType: "m_TracerType", AmmoID: "m_iAmmoID" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEPhysicsProp.ini", "gmod", ["ModelIndex"], { Effects: "m_nEffects", Skin: "m_nSkin" });
	VerifyCanonicalEffectProfile(Fields, "gmod/CTEPlayerAnimEvent.ini", "gmod", [], { PlayerHandle: "m_hPlayer", Data: "m_nData" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTEBullets.ini", "l4d2", ["PlayerIndex"], { SoundTime: "m_flSoundTime", WeaponID: "m_iWeaponID" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTEEffectDispatch.ini", "l4d2", ["EntityIndex", "MaterialIndex"], { EntityIndex: "m_EffectData.entindex", MaterialIndex: "m_EffectData.m_nMaterial" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTEFoundryHelpers.ini", "l4d2", ["EntityIndex"], { EntityIndex: "m_iEntity" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTEPhysicsProp.ini", "l4d2", ["ModelIndex", "Red, Green, Blue"], { Red: "r", Green: "g", Blue: "b" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTEPlayerAnimEvent.ini", "l4d2", [], { PlayerHandle: "m_hPlayer", Event: "m_iEvent" });
	VerifyCanonicalEffectProfile(Fields, "l4d2/CTutorLesson.ini", "l4d2", [], { Lesson: "m_lesson", Subject: "m_subject" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/CTEEffectDispatch.ini", "sdk2013", ["EntityIndex", "MaterialIndex"], { HasCustomColors: "m_EffectData.m_bCustomColors", ParticleAttachment: "m_EffectData.m_ControlPoint1.m_eParticleAttachment" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/CTEPhysicsProp.ini", "orangebox", ["ModelIndex"], { Effects: "m_nEffects", ModelIndex: "m_nModelIndex" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/cstrike/CTEFireBullets.ini", "css", ["PlayerIndex"], { WeaponID: "m_iWeaponID", Inaccuracy: "m_fInaccuracy" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/cstrike/CTEPlantBomb.ini", "css", ["PlayerIndex"], { PlayerIndex: "m_iPlayer", Option: "m_option" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/cstrike/CTEPlayerAnimEvent.ini", "css", [], { PlayerHandle: "m_hPlayer", Event: "m_iEvent" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/cstrike/CTERadioIcon.ini", "css", ["PlayerIndex"], { PlayerIndex: "m_iAttachToClient" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/dod/CTEDODExplosion.ini", "dods", [], { Normal: "m_vecNormal" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/dod/CTEFireBullets.ini", "dods", ["PlayerIndex"], { WeaponID: "m_iWeaponID", Spread: "m_flSpread" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/dod/CTEPlayerAnimEvent.ini", "dods", [], { PlayerHandle: "m_hPlayer", Data: "m_nData" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/hl2mp/CTEAntlionDust.ini", "hl2dm", [], { IsSpawnerBlocked: "m_bBlockedSpawner", Angles: "m_vecAngles" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/hl2mp/CTEConcussiveExplosion.ini", "hl2dm", [], { Magnitude: "m_nMagnitude", Radius: "m_nRadius" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/hl2mp/CTEHL2MPFireBullets.ini", "hl2dm", ["PlayerIndex"], { AmmoID: "m_iAmmoID", Spread: "m_flSpread" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/tf/CTEFireBullets.ini", "tf2", ["PlayerIndex"], { WeaponID: "m_iWeaponID", Critical: "m_bCritical", Spread: "m_flSpread" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/tf/CTEPlayerAnimEvent.ini", "tf2", [], { PlayerIndex: "m_iPlayerIndex", Data: "m_nData" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/tf/CTETFBlood.ini", "tf2", ["EntityIndex"], { EntityIndex: "entindex", Normal: "m_vecNormal" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/tf/CTETFExplosion.ini", "tf2", ["EntityIndex"], { WeaponID: "m_iWeaponID", DefinitionID: "m_nDefID", CustomParticleIndex: "m_iCustomParticleIndex" });
	VerifyCanonicalEffectProfile(Fields, "orangebox/tf/CTETFParticleEffect.ini", "tf2", ["EntityIndex"], { ResetParticles: "m_bResetParticles", ParticleSystemIndex: "m_iParticleSystemIndex" });

	AssertArray(
		Object.keys(Templates),
		[
			"TEMP_ENTITY_TEMPLATES",
			"TemporaryEntityTemplate",
			"TemporaryEntityTemplateCollection",
			"GetTemporaryEntityTemplate",
			"GetTemporaryEntityTemplates",
		],
		"effects/templates exports",
	);
	AssertArray(
		Object.keys(Fields),
		[
			"ClearEffectsFieldCache",
			"GetTemporaryEntityFieldData",
			"GetTemporaryEntityFieldDefinition",
			"GetTemporaryEntityFieldGroups",
			"GetSupportedSDKBranches",
		],
		"effects/fields exports",
	);
	AssertArray(Fields.GetSupportedSDKBranches(), g_vecExpectedSDKBranches, "supported Source 1 branches");
	AssertArray(Fields.GetTemporaryEntityFieldGroups("tf2"), ["common", "orangebox", "orangebox/tf"], "TF2 field groups");
	AssertArray(Fields.GetTemporaryEntityFieldGroups("l4d2"), ["common", "l4d2"], "L4D2 field groups");

	for (const strUnsupportedAlias of [
		"blackmesa",
		"blackmesasource",
		"cstrike",
		"dod",
		"dodsource",
		"hl2deathmatch",
		"hl2mp",
		"left4dead2",
		"teamfortress2",
		"tf",
	]) {
		AssertThrows(() => Fields.GetTemporaryEntityFieldGroups(strUnsupportedAlias), `legacy SDK alias ${strUnsupportedAlias} should be rejected`);
	}

	AssertThrows(() => Fields.GetTemporaryEntityFieldGroups("blade"), "SDK without an effects profile should be rejected");
	AssertThrows(() => Fields.GetTemporaryEntityFieldGroups("dota"), "Source 2 field profile should be rejected");
	AssertThrows(() => Fields.GetTemporaryEntityFieldGroups("unknown"), "unknown field profile should be rejected");
	AssertThrows(() => Fields.GetTemporaryEntityFieldGroups(7), "field profile should reject scalar coercion");

	const CommonBeamPoints = Fields.GetTemporaryEntityFieldDefinition("CTEBeamPoints", "l4d2");
	AssertEqual(CommonBeamPoints.Types.Color.Type, "color", "common beam points color discriminator");
	AssertEqual(CommonBeamPoints.Types.Model.Type, "model", "common beam points model discriminator");
	AssertEqual(CommonBeamPoints.Types.Halo.Type, "model", "common beam points halo discriminator");
	AssertEqual(CommonBeamPoints.Types.Color.ValueFields.join(","), "Red,Green,Blue,Alpha", "common beam points color fields");
	AssertEqual(CommonBeamPoints.Types.Model.ValueFields, "ModelIndex", "common beam points model field");
	AssertEqual(CommonBeamPoints.Fields.StartPoint, "m_vecStartPoint", "common beam points native start path");

	const CommonBeamEntities = Fields.GetTemporaryEntityFieldDefinition("CTEBeamEnts", "sdk2013");
	AssertEqual(CommonBeamEntities.Fields.Speed, "m_nSpeed", "common beam speed path");
	AssertEqual(CommonBeamEntities.Types.Speed.Type, "int", "common beam speed type");
	AssertEqual(CommonBeamEntities.Types.Speed.ValueFields, "m_nSpeed", "common beam speed fields");

	const CommonBeamSpline = Fields.GetTemporaryEntityFieldDefinition("CTEBeamSpline", "sdk2013");
	AssertEqual(CommonBeamSpline.Fields.PointsLength, "m_nPoints", "common beam spline point count path");
	AssertEqual(CommonBeamSpline.Types.PointsLength.Type, "int", "common beam spline point count type");
	AssertEqual(CommonBeamSpline.Types.Points.ValueFields, "m_vecPoints", "common beam spline points path");
	AssertEqual(CommonBeamSpline.Types.Points.Type, "vector", "common beam spline point type");

	const L4D2EffectDispatch = Fields.GetTemporaryEntityFieldDefinition("CTEEffectDispatch", "l4d2");
	AssertEqual(L4D2EffectDispatch.Fields.Angles, "m_EffectData.m_vAngles", "L4D2 angles path");
	AssertEqual(L4D2EffectDispatch.Types.Angles.Type, "vector", "L4D2 angles type");
	AssertEqual(L4D2EffectDispatch.Types.Normal.Type, "vector", "L4D2 normal canonical type");
	AssertEqual(L4D2EffectDispatch.Types.Origin.Type, "vector", "L4D2 origin canonical type");
	AssertEqual(L4D2EffectDispatch.Types.Start.Type, "vector", "L4D2 start canonical type");
	AssertEqual(L4D2EffectDispatch.Types.Normal.ValueFields, "m_EffectData.m_vNormal", "L4D2 normal fields");

	const CSGOFireBullets = Fields.GetTemporaryEntityFieldDefinition("CTEFireBullets", "csgo");
	AssertEqual(CSGOFireBullets.Fields.ItemDefinitionIndex, "m_nItemDefIndex", "CS:GO item definition index path");
	AssertEqual(Object.hasOwn(CSGOFireBullets.Fields, "ItemDefitionIndex"), false, "CS:GO misspelled item definition index is absent");

	const TFPlayerAnimationEvent = Fields.GetTemporaryEntityFieldDefinition("CTEPlayerAnimEvent", "tf2");
	AssertEqual(TFPlayerAnimationEvent.Fields.Data, "m_nData", "TF2 animation data path");
	AssertEqual(TFPlayerAnimationEvent.Types.Data.Type, "int", "TF2 animation data type");

	Fields.ClearEffectsFieldCache();
	g_FileSystemFaultState.RejectNextEffectsDataFile = true;

	try {
		AssertThrows(() => Fields.GetTemporaryEntityFieldData(), "failed field-data load should throw");
	} finally {
		g_FileSystemFaultState.RejectNextEffectsDataFile = false;
	}

	const strInheritedFieldGroupName = "InheritedEffectFieldGroup";
	let ReloadedFieldData;

	Object.defineProperty(Object.prototype, strInheritedFieldGroupName, { configurable: true, enumerable: true, value: [] });

	try {
		ReloadedFieldData = Fields.GetTemporaryEntityFieldData();
	} finally {
		delete Object.prototype[strInheritedFieldGroupName];
	}

	AssertEqual(Object.hasOwn(ReloadedFieldData, "common"), true, "failed field-data load should not cache a partial result");
	AssertEqual(Object.hasOwn(ReloadedFieldData, strInheritedFieldGroupName), false, "field-data load should ignore inherited groups");
	AssertArray(Fields.GetTemporaryEntityFieldGroups(), ["common", "orangebox"], "active SDK field groups");
	AssertEqual(Object.hasOwn(Fields, "ModuleName"), false, "effects/fields should not expose ModuleName");
	AssertArray(
		Object.keys(Hooks),
		[
			"TemporaryEntityPostCreateHook",
			"TemporaryEntityPreCreateHook",
			"RegisterTemporaryEntityPostCreateHook",
			"RegisterTemporaryEntityPreCreateHook",
		],
		"effects/hooks exports",
	);

	const FirstBeforeCreateCallback = () => true;
	const ReplacementBeforeCreateCallback = () => false;
	const BeforeCreateHook = Hooks.RegisterTemporaryEntityPreCreateHook("BeamEnts", FirstBeforeCreateCallback);
	Assert(BeforeCreateHook instanceof Hooks.TemporaryEntityPreCreateHook, "RegisterTemporaryEntityPreCreateHook should return TemporaryEntityPreCreateHook");
	AssertEqual(BeforeCreateHook.Phase, "PreCreate", "pre-create hook phase");
	AssertEqual(BeforeCreateHook.Callback, FirstBeforeCreateCallback, "pre-create hook callback");
	AssertEqual(BeforeCreateHook.RegisterTemporaryEntityHook(ReplacementBeforeCreateCallback), ReplacementBeforeCreateCallback, "replace pre-create callback");
	AssertEqual(BeforeCreateHook.Callback, ReplacementBeforeCreateCallback, "replacement pre-create callback state");
	BeforeCreateHook.Phase = "invalid";
	AssertThrows(() => BeforeCreateHook.RegisterTemporaryEntityHook(FirstBeforeCreateCallback), "invalid replacement phase should throw before unregistering");
	AssertEqual(BeforeCreateHook.Callback, ReplacementBeforeCreateCallback, "invalid replacement should retain active callback");
	BeforeCreateHook.Phase = "PostCreate";
	BeforeCreateHook.Template = {};
	BeforeCreateHook.Callback = FirstBeforeCreateCallback;
	AssertEqual(BeforeCreateHook.UnregisterTemporaryEntityHook(), true, "remove replacement pre-create hook");
	AssertEqual(BeforeCreateHook.Callback, null, "removal should clear externally changed callback state");
	AssertEqual(BeforeCreateHook.UnregisterTemporaryEntityHook(), false, "idle pre-create hook removal");

	const SharedBeforeCreateCallback = () => true;
	const SharedBeforeCreateHook = Hooks.RegisterTemporaryEntityPreCreateHook("BeamEnts", SharedBeforeCreateCallback);
	const ConflictingBeforeCreateHook = new Hooks.TemporaryEntityPreCreateHook("BeamEnts");
	AssertThrows(() => ConflictingBeforeCreateHook.RegisterTemporaryEntityHook(SharedBeforeCreateCallback), "duplicate template callback should throw");
	AssertEqual(ConflictingBeforeCreateHook.Callback, null, "failed registration should not commit callback state");
	AssertEqual(SharedBeforeCreateHook.UnregisterTemporaryEntityHook(), true, "remove shared pre-create hook");

	const AfterCreateCallback = () => undefined;
	const AfterCreateHook = Hooks.RegisterTemporaryEntityPostCreateHook("BeamEnts", AfterCreateCallback);
	Assert(AfterCreateHook instanceof Hooks.TemporaryEntityPostCreateHook, "RegisterTemporaryEntityPostCreateHook should return TemporaryEntityPostCreateHook");
	AssertEqual(AfterCreateHook.Phase, "PostCreate", "post-create hook phase");
	AssertEqual(AfterCreateHook.Callback, AfterCreateCallback, "post-create hook callback");
	AssertEqual(AfterCreateHook.UnregisterTemporaryEntityHook(), true, "remove post-create hook");

	const SpeedPropertyDescriptor = { Name: "m_nSpeed", Path: "m_nSpeed", Offset: 0, Type: "int" };
	const TemplateInstance = new Templates.TemporaryEntityTemplate({
		ClassIndex: 1,
		ClassName: "CTEBeamEnts",
		Name: "BeamEnts",
		Properties: [SpeedPropertyDescriptor],
		Size: 64,
		TableName: "DT_TEBeamEnts",
	});
	const unFieldCountBeforeRebuild = TemplateInstance.GetTemporaryEntityFieldNames().length;

	AssertEqual(TemplateInstance.GetTemporaryEntityFieldNames(), TemplateInstance.FieldNames, "GetTemporaryEntityFieldNames should return the live field list");
	AssertEqual(typeof TemplateInstance.m_vecFieldNames, "undefined", "m_vecFieldNames compatibility alias should not exist");
	AssertEqual(typeof TemplateInstance.fieldNames, "undefined", "fieldNames compatibility alias should not exist");
	AssertEqual(typeof TemplateInstance.describeField, "undefined", "describeField compatibility alias should not exist");
	TemplateInstance.BuildTemporaryEntityFields();
	AssertEqual(TemplateInstance.GetTemporaryEntityFieldNames().length, unFieldCountBeforeRebuild, "rebuilding a template should not duplicate fields");
	AssertEqual(TemplateInstance.FindTemporaryEntityProperty("m_nSpeed"), SpeedPropertyDescriptor, "find property by native path");
	AssertEqual(TemplateInstance.FindTemporaryEntityProperty("MissingField"), null, "missing native property");
	AssertEqual(TemplateInstance.HasTemporaryEntityField("m_nSpeed"), true, "known template field");
	AssertEqual(TemplateInstance.HasTemporaryEntityField("MissingField"), false, "unknown template field");
	AssertEqual(TemplateInstance.ResolveTemporaryEntityPropertyName("m_nSpeed"), "m_nSpeed", "resolve native property name");
	AssertEqual(TemplateInstance.ResolveTemporaryEntityPropertyName("MissingField"), "MissingField", "preserve an unknown field name");
	TemplateInstance.AddTemporaryEntityFieldName("ComponentField", { ValueFields: ["Red", "Green"] });
	TemplateInstance.AddTemporaryEntityFieldName("InvalidComponentField", { ValueFields: [] });
	AssertEqual(TemplateInstance.ResolveTemporaryEntityPropertyName("ComponentField"), "Red", "resolve first component property name");
	AssertThrows(() => TemplateInstance.ResolveTemporaryEntityPropertyName("InvalidComponentField"), "reject an empty component field list");

	const DirectPropertyValues = { m_nSpeed: 10 };
	const TemporaryEntityForHooks = {};
	const RecipientsForHooks = { IsRecipientFilter: true };
	const BeforeCreateCallback = (TemporaryEntity, Recipients) => {
		AssertEqual(TemporaryEntity, TemporaryEntityForHooks, "pre-create entity identity");
		AssertEqual(Recipients, RecipientsForHooks, "pre-create non-array recipients identity");

		return true;
	};
	const CancelingBeforeCreateCallback = () => false;
	let bAfterCreateHookCalled = false;
	const Template = Templates.GetTemporaryEntityTemplate("BeamEnts");
	const AfterCreateTemplateCallback = (TemporaryEntity, Recipients) => {
		AssertEqual(TemporaryEntity, TemporaryEntityForHooks, "post-create entity identity");
		AssertEqual(Recipients, RecipientsForHooks, "post-create non-array recipients identity");
		bAfterCreateHookCalled = true;
	};

	AssertThrows(() => Template.RegisterTemporaryEntityPreCreateHook(null), "pre-create hook should require a callback");
	AssertEqual(Template.RegisterTemporaryEntityPreCreateHook(BeforeCreateCallback), BeforeCreateCallback, "register pre-create hook");
	AssertThrows(() => Template.RegisterTemporaryEntityPreCreateHook(BeforeCreateCallback), "duplicate pre-create hook");
	AssertThrows(() => Template.RegisterTemporaryEntityPostCreateHook(null), "post-create hook should require a callback");
	AssertEqual(Template.RegisterTemporaryEntityPostCreateHook(AfterCreateTemplateCallback), AfterCreateTemplateCallback, "register post-create hook");
	AssertThrows(() => Template.RegisterTemporaryEntityPostCreateHook(AfterCreateTemplateCallback), "duplicate post-create hook");

	AssertEqual(Template.CreateTemporaryEntity(DirectPropertyValues), true, "direct template create");
	AssertEqual(g_unNativeCreateCount, 1, "direct template create should call native runtime");
	AssertEqual(g_NativeCreateCall.TemporaryEntityName, "BeamEnts", "direct template native name");
	AssertEqual(g_NativeCreateCall.PropertyValues, DirectPropertyValues, "direct template property values");
	AssertEqual(g_NativeCreateCall.Recipients, undefined, "direct template recipients default");
	AssertEqual(g_NativeCreateCall.EffectDelay, 0, "direct template effect delay default");
	AssertEqual(g_NativeCreateCall.ReliableDelivery, false, "direct template reliable delivery default");
	AssertEqual(bAfterCreateHookCalled, false, "direct template create should bypass managed hooks");

	AssertEqual(Template.CreateTemporaryEntity(DirectPropertyValues, RecipientsForHooks, 0.25, true), true, "direct template create with explicit arguments");
	AssertEqual(g_unNativeCreateCount, 2, "explicit template create should call native runtime once");
	AssertEqual(g_NativeCreateCall.PropertyValues, DirectPropertyValues, "explicit template property values identity");
	AssertEqual(g_NativeCreateCall.Recipients, RecipientsForHooks, "direct template non-array recipients identity");
	AssertEqual(g_NativeCreateCall.EffectDelay, 0.25, "explicit template effect delay");
	AssertEqual(g_NativeCreateCall.ReliableDelivery, true, "explicit template reliable delivery");
	AssertEqual(bAfterCreateHookCalled, false, "explicit direct template create should bypass managed hooks");

	AssertEqual(Template.InvokeTemporaryEntityPreCreateHooks(TemporaryEntityForHooks, RecipientsForHooks), true, "invoke pre-create hooks");
	Template.RegisterTemporaryEntityPreCreateHook(CancelingBeforeCreateCallback);
	AssertEqual(Template.InvokeTemporaryEntityPreCreateHooks(TemporaryEntityForHooks, RecipientsForHooks), false, "cancel from pre-create hook");
	Template.UnregisterTemporaryEntityPreCreateHook(CancelingBeforeCreateCallback);
	Template.InvokeTemporaryEntityPostCreateHooks(TemporaryEntityForHooks, RecipientsForHooks);
	AssertEqual(bAfterCreateHookCalled, true, "invoke post-create hooks");
	AssertEqual(Template.UnregisterTemporaryEntityPreCreateHook(BeforeCreateCallback), true, "remove pre-create hook");
	AssertThrows(() => Template.UnregisterTemporaryEntityPreCreateHook(BeforeCreateCallback), "missing pre-create hook should be rejected");
	AssertEqual(Template.UnregisterTemporaryEntityPostCreateHook(AfterCreateTemplateCallback), true, "remove post-create hook");
	AssertThrows(() => Template.UnregisterTemporaryEntityPostCreateHook(AfterCreateTemplateCallback), "missing post-create hook should be rejected");
	AssertThrows(() => Template.AddTemporaryEntityFieldName(7, {}), "field name should reject scalar coercion");
	AssertThrows(() => Template.AddTemporaryEntityFieldName("SpeedValue", null), "field descriptor should be required");
	AssertThrows(() => Template.HasTemporaryEntityField(7), "field lookup should reject scalar coercion");
	AssertThrows(() => new Templates.TemporaryEntityTemplate({ ClassName: "CTEBroken", Name: "Broken", Properties: null }), "template descriptor should require properties");

	const CachedTemplateByName = Templates.GetTemporaryEntityTemplate("BeamEnts");
	AssertEqual(typeof CachedTemplateByName.m_TemplateInfo, "undefined", "m_TemplateInfo compatibility alias should not exist");
	const CachedTemplateByDescriptor = Templates.GetTemporaryEntityTemplate(CachedTemplateByName.TemplateInfo);
	const IndependentTemplateCollection = new Templates.TemporaryEntityTemplateCollection();
	const vecListedTemplates = Templates.GetTemporaryEntityTemplates();
	const [CachedTemplateByList] = vecListedTemplates;

	AssertThrows(() => Templates.TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate(null), "template collection should reject null");
	AssertThrows(() => Templates.TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate({ ClassName: "" }), "template collection should reject an empty class name");
	AssertThrows(() => Templates.TEMP_ENTITY_TEMPLATES.HasTemporaryEntityTemplate(null), "template lookup should reject null");
	AssertEqual(Templates.TEMP_ENTITY_TEMPLATES.HasTemporaryEntityTemplate("BeamEnts"), true, "existing native template");
	AssertEqual(Templates.TEMP_ENTITY_TEMPLATES.HasTemporaryEntityTemplate("MissingTemporaryEntity"), false, "missing native template");
	AssertThrows(() => Templates.TEMP_ENTITY_TEMPLATES.HasTemporaryEntityTemplate("BrokenTemporaryEntity"), "native template lookup errors should propagate");
	Assert(IndependentTemplateCollection instanceof Templates.TemporaryEntityTemplateCollection, "exported template collection class");
	Assert(IndependentTemplateCollection.TemplateCache instanceof Map, "independent template collection cache");
	Assert(IndependentTemplateCollection.TemplateCache !== Templates.TEMP_ENTITY_TEMPLATES.TemplateCache, "independent template collection ownership");
	Assert(Templates.TEMP_ENTITY_TEMPLATES.TemplateCache instanceof Map, "template collection should expose its live cache");
	AssertEqual(typeof Templates.TEMP_ENTITY_TEMPLATES.m_mapTemplateCache, "undefined", "m_mapTemplateCache compatibility alias should not exist");
	AssertEqual(typeof Templates.TEMP_ENTITY_TEMPLATES.cache, "undefined", "template cache compatibility alias should not exist");
	AssertEqual(Templates.TEMP_ENTITY_TEMPLATES.TemplateCache.get("CTEBeamEnts"), CachedTemplateByName, "canonical template cache key");
	AssertEqual(CachedTemplateByDescriptor, CachedTemplateByName, "template helper descriptor lookup should use canonical identity");
	AssertEqual(vecListedTemplates, g_vecNativeTemplateListResult, "template list should reuse the fresh native result array");
	AssertEqual(CachedTemplateByList, CachedTemplateByName, "template cache should use canonical ClassName identity");

	const [FirstTemplateFromCollection] = Templates.TEMP_ENTITY_TEMPLATES;
	AssertEqual(FirstTemplateFromCollection, CachedTemplateByName, "template collection iterator should use canonical template identity");
	AssertEqual(Object.hasOwn(Templates, "ModuleName"), false, "effects/templates should not expose ModuleName");

	VerifyEffectsSourceDataRoot("C:\\source-data", "C:/source-data/effects/index.json");
	VerifyEffectsSourceDataRoot("/srv/source-data/", "/srv/source-data/effects/index.json");
	VerifyEffectsSourceDataRoot("/srv///source-data", "/srv/source-data/effects/index.json");
	VerifyEffectsSourceDataRoot("///srv/source-data", "/srv/source-data/effects/index.json");
	VerifyEffectsSourceDataRoot("", "effects/index.json");
	VerifyEffectsSourceDataRoot("\\\\server\\share\\source-data", "//server/share/source-data/effects/index.json");
	VerifyEffectsSourceDataRoot("//server/share/source-data/", "//server/share/source-data/effects/index.json");

	console.log("[smoke_effects_fields] ok");
} finally {
	delete globalThis.sourcejs;
}
