#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "entities-constants.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strPackagePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "entities", "constants.js");

const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;
const g_unSignBitIndex = 31;

const g_GroupEntries = {
	CollisionGroup: [
		["None", "COLLISION_GROUP_NONE"],
		["Debris", "COLLISION_GROUP_DEBRIS"],
		["DebrisTrigger", "COLLISION_GROUP_DEBRIS_TRIGGER"],
		["InteractiveDebris", "COLLISION_GROUP_INTERACTIVE_DEBRIS"],
		["Interactive", "COLLISION_GROUP_INTERACTIVE"],
		["Player", "COLLISION_GROUP_PLAYER"],
		["BreakableGlass", "COLLISION_GROUP_BREAKABLE_GLASS"],
		["Vehicle", "COLLISION_GROUP_VEHICLE"],
		["PlayerMovement", "COLLISION_GROUP_PLAYER_MOVEMENT"],
		["NPC", "COLLISION_GROUP_NPC"],
		["InVehicle", "COLLISION_GROUP_IN_VEHICLE"],
		["Weapon", "COLLISION_GROUP_WEAPON"],
		["VehicleClip", "COLLISION_GROUP_VEHICLE_CLIP"],
		["Projectile", "COLLISION_GROUP_PROJECTILE"],
		["DoorBlocker", "COLLISION_GROUP_DOOR_BLOCKER"],
		["PassableDoor", "COLLISION_GROUP_PASSABLE_DOOR"],
		["Dissolving", "COLLISION_GROUP_DISSOLVING"],
		["PushAway", "COLLISION_GROUP_PUSHAWAY"],
		["NPCActor", "COLLISION_GROUP_NPC_ACTOR"],
		["NPCScripted", "COLLISION_GROUP_NPC_SCRIPTED"],
	],
	DamageTypes: [
		["Generic", "DMG_GENERIC"],
		["Crush", "DMG_CRUSH"],
		["Bullet", "DMG_BULLET"],
		["Slash", "DMG_SLASH"],
		["Burn", "DMG_BURN"],
		["Vehicle", "DMG_VEHICLE"],
		["Fall", "DMG_FALL"],
		["Blast", "DMG_BLAST"],
		["Club", "DMG_CLUB"],
		["Shock", "DMG_SHOCK"],
		["Sonic", "DMG_SONIC"],
		["EnergyBeam", "DMG_ENERGYBEAM"],
		["PreventPhysicsForce", "DMG_PREVENT_PHYSICS_FORCE"],
		["NeverGib", "DMG_NEVERGIB"],
		["AlwaysGib", "DMG_ALWAYSGIB"],
		["Drown", "DMG_DROWN"],
		["Paralyze", "DMG_PARALYZE"],
		["NerveGas", "DMG_NERVEGAS"],
		["Poison", "DMG_POISON"],
		["Radiation", "DMG_RADIATION"],
		["DrownRecover", "DMG_DROWNRECOVER"],
		["Acid", "DMG_ACID"],
		["SlowBurn", "DMG_SLOWBURN"],
		["RemoveNoRagdoll", "DMG_REMOVENORAGDOLL"],
		["PhysicsGun", "DMG_PHYSGUN"],
		["Plasma", "DMG_PLASMA"],
		["Airboat", "DMG_AIRBOAT"],
		["Dissolve", "DMG_DISSOLVE"],
		["BlastSurface", "DMG_BLAST_SURFACE"],
		["Direct", "DMG_DIRECT"],
		["Buckshot", "DMG_BUCKSHOT"],
		["LastGenericFlag", "DMG_LASTGENERICFLAG"],
		["Headshot", "DMG_HEADSHOT"],
	],
	DissolveType: [
		["Normal", "ENTITY_DISSOLVE_NORMAL"],
		["Electrical", "ENTITY_DISSOLVE_ELECTRICAL"],
		["ElectricalLight", "ENTITY_DISSOLVE_ELECTRICAL_LIGHT"],
		["Core", "ENTITY_DISSOLVE_CORE"],
	],
	EntityEffects: [
		["BoneMerge", "EF_BONEMERGE"],
		["BrightLight", "EF_BRIGHTLIGHT"],
		["DimLight", "EF_DIMLIGHT"],
		["NoInterpolation", "EF_NOINTERP"],
		["NoShadow", "EF_NOSHADOW"],
		["NoDraw", "EF_NODRAW"],
		["NoReceiveShadow", "EF_NORECEIVESHADOW"],
		["BoneMergeFastCull", "EF_BONEMERGE_FASTCULL"],
		["ItemBlink", "EF_ITEM_BLINK"],
		["ParentAnimates", "EF_PARENT_ANIMATES"],
		["MarkedForFastReflection", "EF_MARKED_FOR_FAST_REFLECTION"],
		["NoShadowDepth", "EF_NOSHADOWDEPTH"],
		["NoFlashlight", "EF_NOFLASHLIGHT"],
	],
	EntityFlags: [
		["KillMe", "EFL_KILLME"],
		["Dormant", "EFL_DORMANT"],
		["NoClipActive", "EFL_NOCLIP_ACTIVE"],
		["SettingUpBones", "EFL_SETTING_UP_BONES"],
		["KeepOnRecreateEntities", "EFL_KEEP_ON_RECREATE_ENTITIES"],
		["DirtyShadowUpdate", "EFL_DIRTY_SHADOWUPDATE"],
		["Notify", "EFL_NOTIFY"],
		["ForceCheckTransmit", "EFL_FORCE_CHECK_TRANSMIT"],
		["BotFrozen", "EFL_BOT_FROZEN"],
		["ServerOnly", "EFL_SERVER_ONLY"],
		["NoAutoEdictAttach", "EFL_NO_AUTO_EDICT_ATTACH"],
		["DirtyAbsoluteTransform", "EFL_DIRTY_ABSTRANSFORM"],
		["DirtyAbsoluteVelocity", "EFL_DIRTY_ABSVELOCITY"],
		["DirtyAbsoluteAngularVelocity", "EFL_DIRTY_ABSANGVELOCITY"],
		["DirtySurroundingCollisionBounds", "EFL_DIRTY_SURROUNDING_COLLISION_BOUNDS"],
		["DirtySpatialPartition", "EFL_DIRTY_SPATIAL_PARTITION"],
		["HasPlayerChild", "EFL_HAS_PLAYER_CHILD"],
		["InSkybox", "EFL_IN_SKYBOX"],
		["UsePartitionWhenNotSolid", "EFL_USE_PARTITION_WHEN_NOT_SOLID"],
		["TouchingFluid", "EFL_TOUCHING_FLUID"],
		["IsBeingLiftedByBarnacle", "EFL_IS_BEING_LIFTED_BY_BARNACLE"],
		["NoRotorWashPush", "EFL_NO_ROTORWASH_PUSH"],
		["NoThinkFunction", "EFL_NO_THINK_FUNCTION"],
		["NoGamePhysicsSimulation", "EFL_NO_GAME_PHYSICS_SIMULATION"],
		["CheckUntouch", "EFL_CHECK_UNTOUCH"],
		["DoNotBlockLineOfSight", "EFL_DONTBLOCKLOS"],
		["DoNotWalkOn", "EFL_DONTWALKON"],
		["NoDissolve", "EFL_NO_DISSOLVE"],
		["NoMegaPhysicsCannonRagdoll", "EFL_NO_MEGAPHYSCANNON_RAGDOLL"],
		["NoWaterVelocityChange", "EFL_NO_WATER_VELOCITY_CHANGE"],
		["NoPhysicsCannonInteraction", "EFL_NO_PHYSCANNON_INTERACTION"],
		["NoDamageForces", "EFL_NO_DAMAGE_FORCES"],
	],
	EntityStates: [
		["Fly", "FL_FLY"],
		["Swim", "FL_SWIM"],
		["Conveyor", "FL_CONVEYOR"],
		["NPC", "FL_NPC"],
		["GodMode", "FL_GODMODE"],
		["NoTarget", "FL_NOTARGET"],
		["AimTarget", "FL_AIMTARGET"],
		["PartialGround", "FL_PARTIALGROUND"],
		["StaticProp", "FL_STATICPROP"],
		["Graphed", "FL_GRAPHED"],
		["Grenade", "FL_GRENADE"],
		["StepMovement", "FL_STEPMOVEMENT"],
		["DoNotTouch", "FL_DONTTOUCH"],
		["BaseVelocity", "FL_BASEVELOCITY"],
		["WorldBrush", "FL_WORLDBRUSH"],
		["Object", "FL_OBJECT"],
		["KillMe", "FL_KILLME"],
		["OnFire", "FL_ONFIRE"],
		["Dissolving", "FL_DISSOLVING"],
		["TransRagdoll", "FL_TRANSRAGDOLL"],
		["UnblockableByPlayer", "FL_UNBLOCKABLE_BY_PLAYER"],
	],
	MoveCollide: [
		["Default", "MOVECOLLIDE_DEFAULT"],
		["FlyBounce", "MOVECOLLIDE_FLY_BOUNCE"],
		["FlyCustom", "MOVECOLLIDE_FLY_CUSTOM"],
		["FlySlide", "MOVECOLLIDE_FLY_SLIDE"],
		["Count", "MOVECOLLIDE_COUNT"],
	],
	MoveType: [
		["None", "MOVETYPE_NONE"],
		["Isometric", "MOVETYPE_ISOMETRIC"],
		["Walk", "MOVETYPE_WALK"],
		["Step", "MOVETYPE_STEP"],
		["Fly", "MOVETYPE_FLY"],
		["FlyGravity", "MOVETYPE_FLYGRAVITY"],
		["VPhysics", "MOVETYPE_VPHYSICS"],
		["Push", "MOVETYPE_PUSH"],
		["NoClip", "MOVETYPE_NOCLIP"],
		["Ladder", "MOVETYPE_LADDER"],
		["Observer", "MOVETYPE_OBSERVER"],
		["Custom", "MOVETYPE_CUSTOM"],
	],
	RenderEffects: [
		["None", "kRenderFxNone"],
		["PulseSlow", "kRenderFxPulseSlow"],
		["PulseFast", "kRenderFxPulseFast"],
		["PulseSlowWide", "kRenderFxPulseSlowWide"],
		["PulseFastWide", "kRenderFxPulseFastWide"],
		["FadeSlow", "kRenderFxFadeSlow"],
		["FadeFast", "kRenderFxFadeFast"],
		["SolidSlow", "kRenderFxSolidSlow"],
		["SolidFast", "kRenderFxSolidFast"],
		["StrobeSlow", "kRenderFxStrobeSlow"],
		["StrobeFast", "kRenderFxStrobeFast"],
		["StrobeFaster", "kRenderFxStrobeFaster"],
		["FlickerSlow", "kRenderFxFlickerSlow"],
		["FlickerFast", "kRenderFxFlickerFast"],
		["NoDissipation", "kRenderFxNoDissipation"],
		["Distort", "kRenderFxDistort"],
		["Hologram", "kRenderFxHologram"],
		["Explode", "kRenderFxExplode"],
		["GlowShell", "kRenderFxGlowShell"],
		["ClampMinimumScale", "kRenderFxClampMinScale"],
		["EnvironmentRain", "kRenderFxEnvRain"],
		["EnvironmentSnow", "kRenderFxEnvSnow"],
		["Spotlight", "kRenderFxSpotlight"],
		["Ragdoll", "kRenderFxRagdoll"],
		["PulseFastWider", "kRenderFxPulseFastWider"],
		["FadeOut", "kRenderFxFadeOut"],
		["FadeIn", "kRenderFxFadeIn"],
	],
	RenderMode: [
		["Normal", "kRenderNormal"],
		["TranslucentColor", "kRenderTransColor"],
		["TranslucentTexture", "kRenderTransTexture"],
		["Glow", "kRenderGlow"],
		["TranslucentAlpha", "kRenderTransAlpha"],
		["TranslucentAdd", "kRenderTransAdd"],
		["Environmental", "kRenderEnvironmental"],
		["TranslucentAddFrameBlend", "kRenderTransAddFrameBlend"],
		["TranslucentAlphaAdd", "kRenderTransAlphaAdd"],
		["WorldGlow", "kRenderWorldGlow"],
		["None", "kRenderNone"],
	],
	SolidFlags: [
		["CustomRayTest", "FSOLID_CUSTOMRAYTEST"],
		["CustomBoxTest", "FSOLID_CUSTOMBOXTEST"],
		["NotSolid", "FSOLID_NOT_SOLID"],
		["Trigger", "FSOLID_TRIGGER"],
		["NotStandable", "FSOLID_NOT_STANDABLE"],
		["VolumeContents", "FSOLID_VOLUME_CONTENTS"],
		["ForceWorldAligned", "FSOLID_FORCE_WORLD_ALIGNED"],
		["UseTriggerBounds", "FSOLID_USE_TRIGGER_BOUNDS"],
		["RootParentAligned", "FSOLID_ROOT_PARENT_ALIGNED"],
		["TriggerTouchDebris", "FSOLID_TRIGGER_TOUCH_DEBRIS"],
	],
	SolidType: [
		["None", "SOLID_NONE"],
		["BSP", "SOLID_BSP"],
		["BoundingBox", "SOLID_BBOX"],
		["OBB", "SOLID_OBB"],
		["OBBYaw", "SOLID_OBB_YAW"],
		["Custom", "SOLID_CUSTOM"],
		["VPhysics", "SOLID_VPHYSICS"],
	],
	TakeDamage: [
		["No", "DAMAGE_NO"],
		["EventsOnly", "DAMAGE_EVENTS_ONLY"],
		["Yes", "DAMAGE_YES"],
		["Aim", "DAMAGE_AIM"],
	],
};

const g_setBitFlagGroups = new Set([
	"DamageTypes",
	"EntityEffects",
	"EntityFlags",
	"EntityStates",
	"SolidFlags",
]);
const g_setExercisedExports = new Set();
const g_mapExercisedMembers = new Map();
const g_EngineState = {
	EntityCount: 73,
	MaximumEntityCount: 2_048,
};
const g_mapEntityPropertyState = new Map([
	[1, { m_fFlags: 0x04 }],
	[2, { m_fFlags: 0x08 }],
]);
const g_CollisionState = {
	CollisionGroup: 5,
	SolidFlags: 0x00,
	SolidType: 6,
};
const g_vecInitialEntityPropertyState = structuredClone(Array.from(g_mapEntityPropertyState.entries()));
const g_InitialCollisionState = structuredClone(g_CollisionState);

// Synthetic values test facade passthrough and signed-mask operations, not SDK numeric assignments.
function GetFixtureConstantValue(strGroupName, unEntryIndex) {
	if (!g_setBitFlagGroups.has(strGroupName)) {
		return unEntryIndex;
	}

	if (unEntryIndex === g_unSignBitIndex) {
		return g_nInt32Minimum;
	}

	return 2 ** (unEntryIndex % g_unSignBitIndex);
}

function TrackGroup(strGroupName, vecEntries) {
	const Group = {};
	for (let unEntryIndex = 0; unEntryIndex < vecEntries.length; unEntryIndex += 1) {
		const [strMemberName, strDirectName] = vecEntries[unEntryIndex];
		const nValue = GetFixtureConstantValue(strGroupName, unEntryIndex);
		Group[strMemberName] = nValue;
		g_Assert.equal(typeof strDirectName, "string");
	}

	g_mapExercisedMembers.set(strGroupName, new Set());

	return new Proxy(Group, {
		get(Target, Property, Receiver) {
			if ((typeof Property === "string") && Object.hasOwn(Target, Property)) {
				g_mapExercisedMembers.get(strGroupName).add(Property);
			}

			return Reflect.get(Target, Property, Receiver);
		},
		ownKeys(Target) {
			for (const Property of Reflect.ownKeys(Target)) {
				if (typeof Property === "string") {
					g_mapExercisedMembers.get(strGroupName).add(Property);
				}
			}

			return Reflect.ownKeys(Target);
		},
	});
}

const g_NativeConstantsTarget = {
	BASEDAMAGE_NOT_SPECIFIED: -1,
	FIRST_ENTITY_INDEX: 0,
	FIRST_PLAYER_INDEX: 1,
	INVALID_ENTITY_INDEX: -1,
	INVALID_ENTITY_INTHANDLE: 0xFFFFFFFF,
	MAX_EDICTS: 2_048,
	WORLD_ENTITY_INDEX: 0,
	GetEntityCount() {
		return g_EngineState.EntityCount;
	},
	GetMaximumEntityCount() {
		return g_EngineState.MaximumEntityCount;
	},
};

for (const [strGroupName, vecEntries] of Object.entries(g_GroupEntries)) {
	g_NativeConstantsTarget[strGroupName] = TrackGroup(strGroupName, vecEntries);
}

const g_NativeConstants = new Proxy(g_NativeConstantsTarget, {
	get(Target, Property, Receiver) {
		if ((typeof Property === "string") && Object.hasOwn(Target, Property)) {
			g_setExercisedExports.add(Property);
		}

		return Reflect.get(Target, Property, Receiver);
	},
});

function Entity(nEntityIndex) {
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < g_nInt32Minimum) || (nEntityIndex > g_nInt32Maximum)) {
		throw new TypeError("Entity(nEntityIndex) expects an integer index.");
	}

	if (!g_mapEntityPropertyState.has(nEntityIndex)) {
		return null;
	}

	return {
		ClassName: (nEntityIndex === 1) ? "player" : "prop_physics",
		Index: nEntityIndex,
	};
}

function RequireEntityProperty(EntityValue, strPropertyName) {
	if (!EntityValue || !Number.isInteger(EntityValue.Index) || !g_mapEntityPropertyState.has(EntityValue.Index)) {
		throw new TypeError("A valid entity is required.");
	}

	if (typeof strPropertyName !== "string") {
		throw new TypeError("A property name must be a string.");
	}

	return g_mapEntityPropertyState.get(EntityValue.Index);
}

function RequireFixtureInteger(nValue, nMinimum, nMaximum, strErrorMessage) {
	const nNormalizedValue = (typeof nValue === "bigint") ? Number(nValue) : nValue;
	if (!Number.isInteger(nNormalizedValue) || (nNormalizedValue < nMinimum) || (nNormalizedValue > nMaximum)) {
		throw new TypeError(strErrorMessage);
	}

	return (nNormalizedValue === 0) ? 0 : nNormalizedValue;
}

const g_EntityProperties = {
	GetEntityPropertyInteger(EntityValue, strPropertyName) {
		return RequireEntityProperty(EntityValue, strPropertyName)[strPropertyName];
	},
	SetEntityPropertyInteger(EntityValue, strPropertyName, nValue) {
		const nNormalizedValue = RequireFixtureInteger(nValue, g_nInt32Minimum, g_nInt32Maximum, "An integer property value is required.");
		RequireEntityProperty(EntityValue, strPropertyName)[strPropertyName] = nNormalizedValue;

		return true;
	},
};

function RequireCollisionEntity(EntityValue) {
	if (!EntityValue || (EntityValue.Index !== 2)) {
		throw new TypeError("Entity 2 is required for the collision fixture.");
	}
}

const g_EntityCollisions = {
	GetEntityCollisionGroup(EntityValue) {
		RequireCollisionEntity(EntityValue);

		return g_CollisionState.CollisionGroup;
	},
	GetEntitySolidFlags(EntityValue) {
		RequireCollisionEntity(EntityValue);

		return g_CollisionState.SolidFlags;
	},
	GetEntitySolidType(EntityValue) {
		RequireCollisionEntity(EntityValue);

		return g_CollisionState.SolidType;
	},
	SetEntityCollisionGroup(EntityValue, nValue) {
		RequireCollisionEntity(EntityValue);
		g_CollisionState.CollisionGroup = RequireFixtureInteger(nValue, g_nInt32Minimum, g_nInt32Maximum, "An int32 collision group is required.");

		return true;
	},
	SetEntitySolidFlags(EntityValue, unValue) {
		RequireCollisionEntity(EntityValue);
		g_CollisionState.SolidFlags = RequireFixtureInteger(unValue, 0, 0xFFFF, "Unsigned 16-bit solid flags are required.");

		return true;
	},
	SetEntitySolidType(EntityValue, unValue) {
		RequireCollisionEntity(EntityValue);
		g_CollisionState.SolidType = RequireFixtureInteger(unValue, 0, 255, "An unsigned 8-bit solid type is required.");

		return true;
	},
};

for (const nMissingIndex of [-2_147_483_648, -1, 0, 2_147_483_647]) {
	g_Assert.equal(Entity(nMissingIndex), null, "entity fixture must preserve missing int32 indexes");
}

for (const InvalidIndex of [-2_147_483_649, 2_147_483_648, 0.5, Number.NaN, Infinity, -Infinity, 0n, "1", null, undefined]) {
	g_Assert.throws(() => Entity(InvalidIndex), TypeError, "entity fixture must reject invalid and out-of-int32 indexes");
}

function VerifyFixtureIntegerContracts() {
	const Player = Entity(1);
	const Prop = Entity(2);
	const nOriginalFlags = g_mapEntityPropertyState.get(1).m_fFlags;
	const CollisionSnapshot = { ...g_CollisionState };
	try {
		for (const Scenario of [
			{ Set: (nValue) => g_EntityProperties.SetEntityPropertyInteger(Player, "m_fFlags", nValue), Get: () => g_EntityProperties.GetEntityPropertyInteger(Player, "m_fFlags"), Minimum: -2_147_483_648, Maximum: 2_147_483_647 },
			{ Set: (nValue) => g_EntityCollisions.SetEntityCollisionGroup(Prop, nValue), Get: () => g_EntityCollisions.GetEntityCollisionGroup(Prop), Minimum: -2_147_483_648, Maximum: 2_147_483_647 },
			{ Set: (nValue) => g_EntityCollisions.SetEntitySolidFlags(Prop, nValue), Get: () => g_EntityCollisions.GetEntitySolidFlags(Prop), Minimum: 0, Maximum: 0xFFFF },
			{ Set: (nValue) => g_EntityCollisions.SetEntitySolidType(Prop, nValue), Get: () => g_EntityCollisions.GetEntitySolidType(Prop), Minimum: 0, Maximum: 255 },
		]) {
			for (const Value of [Scenario.Minimum, Scenario.Maximum, -0, BigInt(Scenario.Minimum), BigInt(Scenario.Maximum)]) {
				g_Assert.equal(Scenario.Set(Value), true);
				const nExpected = Number(Value);
				g_Assert.equal(Scenario.Get(), (nExpected === 0) ? 0 : nExpected, "constant documentation fixture must preserve native-width integer writes");
			}

			for (const InvalidValue of [Scenario.Minimum - 1, Scenario.Maximum + 1, BigInt(Scenario.Minimum) - 1n, BigInt(Scenario.Maximum) + 1n, 0.5, Number.NaN, Infinity, -Infinity, true, null, undefined, "1", {}, []]) {
				const nBefore = Scenario.Get();
				g_Assert.throws(() => Scenario.Set(InvalidValue), TypeError, "constant documentation fixture must reject invalid and out-of-range writes");
				g_Assert.equal(Scenario.Get(), nBefore, "rejected constant documentation writes must preserve fixture state");
			}
		}
	} finally {
		g_mapEntityPropertyState.get(1).m_fFlags = nOriginalFlags;
		Object.assign(g_CollisionState, CollisionSnapshot);
	}
}

VerifyFixtureIntegerContracts();

globalThis.sourcejs = {
	"entities/constants": g_NativeConstants,
};

delete require.cache[g_strPackagePath];

const g_Constants = require(g_strPackagePath);
const g_vecResolvedExports = Object.keys(g_NativeConstantsTarget).sort();

g_Assert.strictEqual(g_Constants, g_NativeConstants);
g_Assert.deepEqual(Object.keys(g_Constants).sort(), g_vecResolvedExports);

for (const [strGroupName, vecEntries] of Object.entries(g_GroupEntries)) {
	g_Assert.deepEqual(Object.keys(g_Constants[strGroupName]), vecEntries.map(([strMemberName]) => strMemberName));

	for (const [strMemberName, strDirectName] of vecEntries) {
		g_Assert.equal(typeof g_Constants[strGroupName][strMemberName], "number");
		g_Assert.equal(Object.hasOwn(g_Constants, strDirectName), false);
	}
}

g_Assert.equal(g_vecResolvedExports.length, 22);
g_Assert.equal(g_Constants.GetEntityCount(), 73);
g_Assert.equal(g_Constants.GetMaximumEntityCount(), 2_048);
g_Assert.equal(Object.hasOwn(g_Constants, "number"), false);
g_Assert.equal(Object.hasOwn(g_Constants, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_Constants, "default"), false);

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);

const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_nInstallerStart = g_strModuleBindings.indexOf("bool InstallEntityConstants(");
const g_nInstallerEnd = g_strModuleBindings.indexOf("void RemoveEntityCallback(", g_nInstallerStart);
g_Assert.ok((g_nInstallerStart >= 0) && (g_nInstallerEnd > g_nInstallerStart), "entity constant installer must have ordered bounds");

const g_strInstaller = g_strModuleBindings.slice(g_nInstallerStart, g_nInstallerEnd);

g_Assert.equal(g_vecDocumentationBlocks.length, 10);
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|generate_api_docs|const result =|moduleName|addressString/);
g_Assert.match(g_strInstaller, /v8::Local<v8::Object> const LocalNativeConstants = v8::Object::New\(pIsolate\);/);
g_Assert.ok(/auto const SetEntityConstant = \[pIsolate, LocalContext, LocalNativeConstants\]\(char const\* const pszName, const int nValue\) -> bool/.test(g_strInstaller), "The entity constant setter must keep its explicit capture and result contract.");
g_Assert.match(g_strInstaller, /return SetRecordProperty\(pIsolate, LocalContext, LocalNativeConstants, pszName, v8::Integer::New\(pIsolate, nValue\)\);/);
g_Assert.doesNotMatch(g_strInstaller, /return SetInteger\(pIsolate, LocalContext, LocalNativeConstants, pszName, nValue\);/);
g_Assert.doesNotMatch(g_strInstaller, /SOURCEJS_SET_ENTITY_CONSTANT/);
g_Assert.equal((g_strInstaller.match(/InstallEntityConstantGroup\(pIsolate, LocalContext, LocalEntityConstants,/g) || []).length, 13);

for (const [strGroupName, vecEntries] of Object.entries(g_GroupEntries)) {
	g_Assert.ok(g_strDocumentation.includes(`\`${strGroupName}\``), `Documentation is missing ${strGroupName}.`);

	for (const [strMemberName, strDirectName] of vecEntries) {
		g_Assert.ok(g_strDocumentation.includes(`\`${strMemberName}\``), `Documentation is missing ${strGroupName}.${strMemberName}.`);
		g_Assert.ok(g_strDocumentation.includes(`\`${strDirectName}\``), `Documentation is missing ${strDirectName}.`);
		g_Assert.ok(g_strInstaller.includes(`SetEntityConstant("${strDirectName}",`), `InstallEntityConstants has no native producer for ${strGroupName}.${strMemberName}: ${strDirectName}.`);
	}
}

const g_vecDocumentationLogRecords = [];
const g_DocumentationLoggers = {
	LogInfo(strMessage, LogRecord) {
		g_Assert.equal(strMessage, "%j", "Structured documentation logs must use the JSON format token.");
		g_Assert.equal(Object.keys(LogRecord)[0], "Operation", "Documentation logs must put operation first.");
		g_vecDocumentationLogRecords.push(JSON.parse(JSON.stringify(LogRecord)));
	},
};

function DocumentationRequire(strModuleName) {
	switch (strModuleName) {
		case "entities/constants":
			return g_Constants;

		case "entities/entity":
			return { Entity };

		case "entities/props":
			return g_EntityProperties;

		case "entities/collisions":
			return g_EntityCollisions;

		case "loggers":
			return g_DocumentationLoggers;

		default:
			throw new Error(`Unexpected documentation module: ${strModuleName}`);
	}
}

// Record documentation use separately from the earlier shape and implementation checks.
g_setExercisedExports.clear();
for (const setMembers of g_mapExercisedMembers.values()) {
	setMembers.clear();
}

for (let unBlockIndex = 0; unBlockIndex < g_vecDocumentationBlocks.length; unBlockIndex += 1) {
	g_VM.runInNewContext(g_vecDocumentationBlocks[unBlockIndex], {
		console: {
			log() {
			},
		},
		require: DocumentationRequire,
	}, {
		filename: `${g_strDocumentationPath}#block-${unBlockIndex + 1}`,
	});
}

g_Assert.deepEqual(g_vecDocumentationLogRecords, [
	{ Operation: "ImportEntityConstants", CollisionGroupCount: 20, DamageTypeCount: 33, EntityStateCount: 21, SolidFlagCount: 10, SolidTypeCount: 7 },
	{ Operation: "VerifyEntityConstantExports", NativeDamageAliasAbsent: true },
	{
		Operation: "InventoryEntityConstants",
		Namespaces: Object.fromEntries(Object.entries(g_GroupEntries).map(([strGroupName, vecEntries]) => [strGroupName, vecEntries.map(([strMemberName]) => strMemberName)])),
		StandaloneConstants: [
			"BASEDAMAGE_NOT_SPECIFIED",
			"FIRST_ENTITY_INDEX",
			"FIRST_PLAYER_INDEX",
			"INVALID_ENTITY_INDEX",
			"INVALID_ENTITY_INTHANDLE",
			"MAX_EDICTS",
			"WORLD_ENTITY_INDEX",
		],
	},
	{ Operation: "QueryEntityLimits", ActiveCount: g_EngineState.EntityCount, CurrentLimit: g_EngineState.MaximumEntityCount, FirstEntityIndex: 0, FirstPlayerIndex: 1, WorldEntityIndex: 0 },
	{ Operation: "ResolveEntityWithinLimit", EntityIndex: 2, ClassName: "prop_physics" },
	{ Operation: "InspectDamageMask", Blast: true, Burn: true },
	{ Operation: "EnableTemporaryEntityState", EntityIndex: 1, State: "NoTarget" },
	{ Operation: "ApplyTemporaryCollisionConfiguration", EntityIndex: 2, CollisionGroup: 1, SolidType: 2 },
	{ Operation: "DecodeEntityEnums", MoveType: "VPhysics", RenderEffect: "GlowShell", RenderMode: "Normal" },
	{ Operation: "ReportEntityConstantCapabilities", Capabilities: { HeadshotDamage: true, NoFlashlightEffect: true, NPCScriptedCollision: true, TriggerTouchDebris: true } },
], "Every constants documentation block must emit its complete structured observation.");

g_Assert.deepEqual(Array.from(g_mapEntityPropertyState.entries()), g_vecInitialEntityPropertyState);
g_Assert.deepEqual(g_CollisionState, g_InitialCollisionState);

for (const strExportName of g_vecResolvedExports) {
	g_Assert.ok(g_setExercisedExports.has(strExportName), `Documentation did not exercise export ${strExportName}.`);
}

for (const [strGroupName, vecEntries] of Object.entries(g_GroupEntries)) {
	const setExercisedGroupMembers = g_mapExercisedMembers.get(strGroupName);
	for (const [strMemberName] of vecEntries) {
		g_Assert.ok(setExercisedGroupMembers.has(strMemberName), `Documentation did not exercise ${strGroupName}.${strMemberName}.`);
	}
}

delete require.cache[g_strPackagePath];
delete globalThis.sourcejs;

g_Assert.throws(() => require(g_strPackagePath), /SourceJS native runtime is not installed/);

console.log("[smoke] entities/constants and documentation contracts passed");
