# `require("entities/constants")`

> AI-processing note: this page is a hand-maintained reference for the complete selected SDK entity-constant surface. Read the capability rules before treating a name as portable across games.

`entities/constants` uses the [package facade](../../packages/sourcejs/entities/constants.js) to return the native module installed by [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). It exposes entity limits reported by the running server and `PascalCase` namespaces populated directly from the selected HL2SDK. Namespace members also use descriptive `PascalCase` names. The package does not rename, synthesize, or reconstruct another game's constants in JavaScript.

Root sentinel/limit constants, grouped members, namespace attachments, and both count functions are own data properties; inherited setters are not invoked. Only `undefined` native entries are omitted. A native-property read that throws stops group construction immediately, preserving the original JavaScript exception without attaching a partially built group.

Constants and namespace objects are ordinary mutable JavaScript records populated during module installation, not live SDK bindings. The package returns the shared native module object; changing a property affects later imports of that object, not the compiled SDK value or engine state. Treat these records as read-only by convention. Only the two count functions query current engine state.

## Table of contents

- [Import](#import)
- [SDK capabilities](#sdk-capabilities)
- [Runtime limits](#runtime-limits)
- [DamageTypes](#damagetypes)
- [EntityStates](#entitystates)
- [EntityEffects](#entityeffects)
- [DissolveType](#dissolvetype)
- [TakeDamage](#takedamage)
- [EntityFlags](#entityflags)
- [MoveType](#movetype)
- [MoveCollide](#movecollide)
- [SolidType](#solidtype)
- [SolidFlags](#solidflags)
- [RenderMode](#rendermode)
- [RenderEffects](#rendereffects)
- [CollisionGroup](#collisiongroup)
- [Practical workflows](#practical-workflows)
- [Common mistakes](#common-mistakes)

## Import

Import only the exact groups used by the calling script:

```js
const { CollisionGroup, DamageTypes, EntityStates, SolidFlags, SolidType } = require("entities/constants");
const { LogInfo } = require("loggers");

LogInfo("%j", {
	Operation: "ImportEntityConstants",
	CollisionGroupCount: Object.keys(CollisionGroup).length,
	DamageTypeCount: Object.keys(DamageTypes).length,
	EntityStateCount: Object.keys(EntityStates).length,
	SolidFlagCount: Object.keys(SolidFlags).length,
	SolidTypeCount: Object.keys(SolidType).length,
});
```

## SDK capabilities

The package returns the native object created from the selected HL2SDK branch during module installation; it does not add an adapter layer.

- Every standalone JavaScript constant is a `number` under its canonical `UPPER_SNAKE_CASE` name.
- Every namespace member is populated from the matching HL2SDK constant under one descriptive `PascalCase` name. Grouped values are signed 32-bit JavaScript `Number` values; a flag with bit 31 set is negative. Use `>>> 0` when an unsigned 32-bit representation is needed, without changing the stored SDK value.
- The tables below show the originating HL2SDK identifier for source-level verification; those identifiers are not duplicate JavaScript exports.
- Every namespace object is present, but members unsupported by the selected SDK are omitted.
- `BASEDAMAGE_NOT_SPECIFIED` is present only when the selected SDK defines it.
- On SDK branches without the corresponding Source interfaces, the `DamageTypes`, `DissolveType`, `TakeDamage`, and `EntityFlags` objects remain present but omit those unsupported members.
- Optional render effects, `SolidFlags.TriggerTouchDebris`, `CollisionGroup.NPCScripted`, and other branch additions are omitted instead of being replaced by guessed values.
- The module has no generic name lookup, default aggregate, availability snapshot, or cross-game fallback API.

For example, `DamageTypes.Blast` is the sole JavaScript name for the selected SDK's `DMG_BLAST` value:

```js
const g_Constants = require("entities/constants");
const { LogInfo } = require("loggers");

if (Object.hasOwn(g_Constants, "DMG_BLAST")) {
	throw new Error("The native SDK identifier leaked as a duplicate export.");
}

LogInfo("%j", { Operation: "VerifyEntityConstantExports", NativeDamageAliasAbsent: true });
```

This whole-object import is intentional only for proving that the native `DMG_BLAST` identifier is not a duplicate JavaScript export. Runtime code should import `DamageTypes.Blast` through the direct group import above.

Use `Object.hasOwn(Namespace, strMemberName)` before enabling optional game behavior. Do not invent a value for a missing member.

## Runtime limits

### Fixed and selected SDK constants

| Export | Meaning |
| --- | --- |
| `INVALID_ENTITY_INDEX` | `-1`; no entity index. |
| `WORLD_ENTITY_INDEX` | `0`; the world edict. |
| `FIRST_ENTITY_INDEX` | `0`; first index in the complete edict range. |
| `FIRST_PLAYER_INDEX` | `1`; first possible client slot. It does not guarantee a connected player. |
| `MAX_EDICTS` | Compile-time edict ceiling from the selected SDK. |
| `INVALID_ENTITY_INTHANDLE` | Selected SDK invalid packed entity handle value. |
| `BASEDAMAGE_NOT_SPECIFIED` | Optional SDK sentinel for an unspecified base-damage value. |

Use named imports from `entities/constants`. The example inputs are raw integer values read from the selected SDK, not entity indexes.

| Use | Example |
| --- | --- |
| Reject an invalid packed entity handle before resolving it. | `const bHandleMayResolve = (nPackedHandle !== INVALID_ENTITY_INTHANDLE);` |
| Identify the optional unspecified-damage sentinel. | `const bBaseDamageUnspecified = (typeof BASEDAMAGE_NOT_SPECIFIED === "number") && (nBaseDamage === BASEDAMAGE_NOT_SPECIFIED);` |

### Live functions

| Function | Result |
| --- | --- |
| `GetEntityCount()` | Current `IVEngineServer::GetEntityCount()` result. |
| `GetMaximumEntityCount()` | Current `CGlobalVars::maxEntities` value. |

`GetEntityCount()` is an engine count, not a stable array length. `GetMaximumEntityCount()` is the current server limit, while `MAX_EDICTS` is the compiled ceiling.

Both functions return JavaScript `Number` values. `GetEntityCount()` raises an error when `IVEngineServer` is unavailable; `GetMaximumEntityCount()` raises an error when `CGlobalVars` is unavailable. Call these live server queries on the server thread, not arbitrary worker threads.

## `DamageTypes`

`DamageTypes` is a damage-mask namespace. Combine nonzero classification flags with `|` and test them with `&`; `Generic` is the zero value and does not add a bit. Unsupported members are absent from the namespace.

The descriptions summarize SDK classifications; actual handling depends on the game's damage code. Boundary markers such as `LastGenericFlag` can alias another damage flag and are not additional independent damage categories.

| Member | HL2SDK constant | Meaning |
| --- | --- | --- |
| `Generic` | `DMG_GENERIC` | No more specific damage classification. |
| `Crush` | `DMG_CRUSH` | Physics-collision crushing without an additional damage force. |
| `Bullet` | `DMG_BULLET` | Bullet impact. |
| `Slash` | `DMG_SLASH` | Cutting or slashing damage. |
| `Burn` | `DMG_BURN` | Fire damage. |
| `Vehicle` | `DMG_VEHICLE` | Vehicle impact. |
| `Fall` | `DMG_FALL` | Falling damage. |
| `Blast` | `DMG_BLAST` | Explosion damage. |
| `Club` | `DMG_CLUB` | Blunt melee damage. |
| `Shock` | `DMG_SHOCK` | Electrical shock. |
| `Sonic` | `DMG_SONIC` | Sonic damage. |
| `EnergyBeam` | `DMG_ENERGYBEAM` | Energy-beam damage. |
| `PreventPhysicsForce` | `DMG_PREVENT_PHYSICS_FORCE` | Suppresses the normal damage force. |
| `NeverGib` | `DMG_NEVERGIB` | Prevents gibbing. |
| `AlwaysGib` | `DMG_ALWAYSGIB` | Forces gibbing when allowed by the game. |
| `Drown` | `DMG_DROWN` | Drowning damage. |
| `Paralyze` | `DMG_PARALYZE` | Paralysis classification. |
| `NerveGas` | `DMG_NERVEGAS` | Nerve-gas classification. |
| `Poison` | `DMG_POISON` | Poison damage. |
| `Radiation` | `DMG_RADIATION` | Radiation damage. |
| `DrownRecover` | `DMG_DROWNRECOVER` | Drowning-health recovery. |
| `Acid` | `DMG_ACID` | Acid damage. |
| `SlowBurn` | `DMG_SLOWBURN` | Slow-burning damage. |
| `RemoveNoRagdoll` | `DMG_REMOVENORAGDOLL` | Removes the target without creating a ragdoll. |
| `PhysicsGun` | `DMG_PHYSGUN` | Physics-gun damage. |
| `Plasma` | `DMG_PLASMA` | Plasma damage. |
| `Airboat` | `DMG_AIRBOAT` | Airboat weapon damage. |
| `Dissolve` | `DMG_DISSOLVE` | Dissolve damage. |
| `BlastSurface` | `DMG_BLAST_SURFACE` | Water-surface blast classification that excludes underwater targets. |
| `Direct` | `DMG_DIRECT` | Direct damage classification; handling is game-defined. |
| `Buckshot` | `DMG_BUCKSHOT` | Buckshot damage. |
| `LastGenericFlag` | `DMG_LASTGENERICFLAG` | SDK boundary marker for generic damage flags. |
| `Headshot` | `DMG_HEADSHOT` | Optional branch-specific headshot flag. |

## `EntityStates`

These are `FL_*` bit flags used by the engine's entity-state field, commonly `m_fFlags`.

| Member | HL2SDK constant |
| --- | --- |
| `Fly` | `FL_FLY` |
| `Swim` | `FL_SWIM` |
| `Conveyor` | `FL_CONVEYOR` |
| `NPC` | `FL_NPC` |
| `GodMode` | `FL_GODMODE` |
| `NoTarget` | `FL_NOTARGET` |
| `AimTarget` | `FL_AIMTARGET` |
| `PartialGround` | `FL_PARTIALGROUND` |
| `StaticProp` | `FL_STATICPROP` |
| `Graphed` | `FL_GRAPHED` |
| `Grenade` | `FL_GRENADE` |
| `StepMovement` | `FL_STEPMOVEMENT` |
| `DoNotTouch` | `FL_DONTTOUCH` |
| `BaseVelocity` | `FL_BASEVELOCITY` |
| `WorldBrush` | `FL_WORLDBRUSH` |
| `Object` | `FL_OBJECT` |
| `KillMe` | `FL_KILLME` |
| `OnFire` | `FL_ONFIRE` |
| `Dissolving` | `FL_DISSOLVING` |
| `TransRagdoll` | `FL_TRANSRAGDOLL` |
| `UnblockableByPlayer` | `FL_UNBLOCKABLE_BY_PLAYER` |

Do not confuse `EntityStates` (`FL_*`) with `EntityFlags` (`EFL_*`) or the edict `StateFlags` field.

## `EntityEffects`

These `EF_*` bits control visual and interpolation behavior.

| Member | HL2SDK constant | Capability |
| --- | --- | --- |
| `BoneMerge` | `EF_BONEMERGE` | Common |
| `BrightLight` | `EF_BRIGHTLIGHT` | Common |
| `DimLight` | `EF_DIMLIGHT` | Common |
| `NoInterpolation` | `EF_NOINTERP` | Common |
| `NoShadow` | `EF_NOSHADOW` | Common |
| `NoDraw` | `EF_NODRAW` | Common |
| `NoReceiveShadow` | `EF_NORECEIVESHADOW` | Common |
| `BoneMergeFastCull` | `EF_BONEMERGE_FASTCULL` | Common |
| `ItemBlink` | `EF_ITEM_BLINK` | Common |
| `ParentAnimates` | `EF_PARENT_ANIMATES` | Common |
| `MarkedForFastReflection` | `EF_MARKED_FOR_FAST_REFLECTION` | Optional |
| `NoShadowDepth` | `EF_NOSHADOWDEPTH` | Optional |
| `NoFlashlight` | `EF_NOFLASHLIGHT` | Optional |

## `DissolveType`

| Member | HL2SDK constant |
| --- | --- |
| `Normal` | `ENTITY_DISSOLVE_NORMAL` |
| `Electrical` | `ENTITY_DISSOLVE_ELECTRICAL` |
| `ElectricalLight` | `ENTITY_DISSOLVE_ELECTRICAL_LIGHT` |
| `Core` | `ENTITY_DISSOLVE_CORE` |

On SDKs without the corresponding dissolve API, the `DissolveType` object remains present but all four members are omitted.

## `TakeDamage`

| Member | HL2SDK constant | Meaning |
| --- | --- | --- |
| `No` | `DAMAGE_NO` | Entity does not take normal damage. |
| `EventsOnly` | `DAMAGE_EVENTS_ONLY` | Damage events run without normal health damage. |
| `Yes` | `DAMAGE_YES` | Entity takes damage. |
| `Aim` | `DAMAGE_AIM` | Entity participates in aim-related damage behavior. |

## `EntityFlags`

These are internal `EFL_*` engine flags. They are not the same storage as `EntityStates`.

| Member | HL2SDK constant | Member | HL2SDK constant |
| --- | --- | --- | --- |
| `KillMe` | `EFL_KILLME` | `Dormant` | `EFL_DORMANT` |
| `NoClipActive` | `EFL_NOCLIP_ACTIVE` | `SettingUpBones` | `EFL_SETTING_UP_BONES` |
| `KeepOnRecreateEntities` | `EFL_KEEP_ON_RECREATE_ENTITIES` | `DirtyShadowUpdate` | `EFL_DIRTY_SHADOWUPDATE` |
| `Notify` | `EFL_NOTIFY` | `ForceCheckTransmit` | `EFL_FORCE_CHECK_TRANSMIT` |
| `BotFrozen` | `EFL_BOT_FROZEN` | `ServerOnly` | `EFL_SERVER_ONLY` |
| `NoAutoEdictAttach` | `EFL_NO_AUTO_EDICT_ATTACH` | `DirtyAbsoluteTransform` | `EFL_DIRTY_ABSTRANSFORM` |
| `DirtyAbsoluteVelocity` | `EFL_DIRTY_ABSVELOCITY` | `DirtyAbsoluteAngularVelocity` | `EFL_DIRTY_ABSANGVELOCITY` |
| `DirtySurroundingCollisionBounds` | `EFL_DIRTY_SURROUNDING_COLLISION_BOUNDS` | `DirtySpatialPartition` | `EFL_DIRTY_SPATIAL_PARTITION` |
| `HasPlayerChild` | `EFL_HAS_PLAYER_CHILD` | `InSkybox` | `EFL_IN_SKYBOX` |
| `UsePartitionWhenNotSolid` | `EFL_USE_PARTITION_WHEN_NOT_SOLID` | `TouchingFluid` | `EFL_TOUCHING_FLUID` |
| `IsBeingLiftedByBarnacle` | `EFL_IS_BEING_LIFTED_BY_BARNACLE` | `NoRotorWashPush` | `EFL_NO_ROTORWASH_PUSH` |
| `NoThinkFunction` | `EFL_NO_THINK_FUNCTION` | `NoGamePhysicsSimulation` | `EFL_NO_GAME_PHYSICS_SIMULATION` |
| `CheckUntouch` | `EFL_CHECK_UNTOUCH` | `DoNotBlockLineOfSight` | `EFL_DONTBLOCKLOS` |
| `DoNotWalkOn` | `EFL_DONTWALKON` | `NoDissolve` | `EFL_NO_DISSOLVE` |
| `NoMegaPhysicsCannonRagdoll` | `EFL_NO_MEGAPHYSCANNON_RAGDOLL` | `NoWaterVelocityChange` | `EFL_NO_WATER_VELOCITY_CHANGE` |
| `NoPhysicsCannonInteraction` | `EFL_NO_PHYSCANNON_INTERACTION` | `NoDamageForces` | `EFL_NO_DAMAGE_FORCES` |

`NoWaterVelocityChange` is additionally omitted when the older console-style SDK interface is selected. On SDK branches without these `EFL_*` constants, every `EntityFlags` member is omitted, but the namespace object remains present.

## `MoveType`

| Member | HL2SDK constant |
| --- | --- |
| `None` | `MOVETYPE_NONE` |
| `Isometric` | `MOVETYPE_ISOMETRIC` |
| `Walk` | `MOVETYPE_WALK` |
| `Step` | `MOVETYPE_STEP` |
| `Fly` | `MOVETYPE_FLY` |
| `FlyGravity` | `MOVETYPE_FLYGRAVITY` |
| `VPhysics` | `MOVETYPE_VPHYSICS` |
| `Push` | `MOVETYPE_PUSH` |
| `NoClip` | `MOVETYPE_NOCLIP` |
| `Ladder` | `MOVETYPE_LADDER` |
| `Observer` | `MOVETYPE_OBSERVER` |
| `Custom` | `MOVETYPE_CUSTOM` |

## `MoveCollide`

| Member | HL2SDK constant |
| --- | --- |
| `Default` | `MOVECOLLIDE_DEFAULT` |
| `FlyBounce` | `MOVECOLLIDE_FLY_BOUNCE` |
| `FlyCustom` | `MOVECOLLIDE_FLY_CUSTOM` |
| `FlySlide` | `MOVECOLLIDE_FLY_SLIDE` |
| `Count` | `MOVECOLLIDE_COUNT` |

`Count` is the SDK enum boundary, not a movement behavior to assign.

## `SolidType`

| Member | HL2SDK constant |
| --- | --- |
| `None` | `SOLID_NONE` |
| `BSP` | `SOLID_BSP` |
| `BoundingBox` | `SOLID_BBOX` |
| `OBB` | `SOLID_OBB` |
| `OBBYaw` | `SOLID_OBB_YAW` |
| `Custom` | `SOLID_CUSTOM` |
| `VPhysics` | `SOLID_VPHYSICS` |

## `SolidFlags`

These are `FSOLID_*` bit flags.

| Member | HL2SDK constant | Capability |
| --- | --- | --- |
| `CustomRayTest` | `FSOLID_CUSTOMRAYTEST` | Common |
| `CustomBoxTest` | `FSOLID_CUSTOMBOXTEST` | Common |
| `NotSolid` | `FSOLID_NOT_SOLID` | Common |
| `Trigger` | `FSOLID_TRIGGER` | Common |
| `NotStandable` | `FSOLID_NOT_STANDABLE` | Common |
| `VolumeContents` | `FSOLID_VOLUME_CONTENTS` | Common |
| `ForceWorldAligned` | `FSOLID_FORCE_WORLD_ALIGNED` | Common |
| `UseTriggerBounds` | `FSOLID_USE_TRIGGER_BOUNDS` | Common |
| `RootParentAligned` | `FSOLID_ROOT_PARENT_ALIGNED` | Common |
| `TriggerTouchDebris` | `FSOLID_TRIGGER_TOUCH_DEBRIS` | Optional |

`TriggerTouchDebris` is omitted when the older console-style SDK interface is selected.

## `RenderMode`

| Member | HL2SDK constant |
| --- | --- |
| `Normal` | `kRenderNormal` |
| `TranslucentColor` | `kRenderTransColor` |
| `TranslucentTexture` | `kRenderTransTexture` |
| `Glow` | `kRenderGlow` |
| `TranslucentAlpha` | `kRenderTransAlpha` |
| `TranslucentAdd` | `kRenderTransAdd` |
| `Environmental` | `kRenderEnvironmental` |
| `TranslucentAddFrameBlend` | `kRenderTransAddFrameBlend` |
| `TranslucentAlphaAdd` | `kRenderTransAlphaAdd` |
| `WorldGlow` | `kRenderWorldGlow` |
| `None` | `kRenderNone` |

The HL2SDK source identifiers retain their original leading `k`; only the grouped members form the public JavaScript API.

## `RenderEffects`

| Member | HL2SDK constant | Capability |
| --- | --- | --- |
| `None` | `kRenderFxNone` | Common |
| `PulseSlow` | `kRenderFxPulseSlow` | Common |
| `PulseFast` | `kRenderFxPulseFast` | Common |
| `PulseSlowWide` | `kRenderFxPulseSlowWide` | Common |
| `PulseFastWide` | `kRenderFxPulseFastWide` | Common |
| `FadeSlow` | `kRenderFxFadeSlow` | Common |
| `FadeFast` | `kRenderFxFadeFast` | Common |
| `SolidSlow` | `kRenderFxSolidSlow` | Common |
| `SolidFast` | `kRenderFxSolidFast` | Common |
| `StrobeSlow` | `kRenderFxStrobeSlow` | Common |
| `StrobeFast` | `kRenderFxStrobeFast` | Common |
| `StrobeFaster` | `kRenderFxStrobeFaster` | Common |
| `FlickerSlow` | `kRenderFxFlickerSlow` | Common |
| `FlickerFast` | `kRenderFxFlickerFast` | Common |
| `NoDissipation` | `kRenderFxNoDissipation` | Common |
| `Distort` | `kRenderFxDistort` | Legacy render API |
| `Hologram` | `kRenderFxHologram` | Legacy render API |
| `Explode` | `kRenderFxExplode` | Legacy render API |
| `GlowShell` | `kRenderFxGlowShell` | Common |
| `ClampMinimumScale` | `kRenderFxClampMinScale` | Legacy render API |
| `EnvironmentRain` | `kRenderFxEnvRain` | Legacy render API |
| `EnvironmentSnow` | `kRenderFxEnvSnow` | Legacy render API |
| `Spotlight` | `kRenderFxSpotlight` | Legacy render API |
| `Ragdoll` | `kRenderFxRagdoll` | Legacy render API |
| `PulseFastWider` | `kRenderFxPulseFastWider` | Common |
| `FadeOut` | `kRenderFxFadeOut` | Optional render-fade API |
| `FadeIn` | `kRenderFxFadeIn` | Optional render-fade API |

## `CollisionGroup`

| Member | HL2SDK constant | Capability |
| --- | --- | --- |
| `None` | `COLLISION_GROUP_NONE` | Common |
| `Debris` | `COLLISION_GROUP_DEBRIS` | Common |
| `DebrisTrigger` | `COLLISION_GROUP_DEBRIS_TRIGGER` | Common |
| `InteractiveDebris` | `COLLISION_GROUP_INTERACTIVE_DEBRIS` | Common |
| `Interactive` | `COLLISION_GROUP_INTERACTIVE` | Common |
| `Player` | `COLLISION_GROUP_PLAYER` | Common |
| `BreakableGlass` | `COLLISION_GROUP_BREAKABLE_GLASS` | Common |
| `Vehicle` | `COLLISION_GROUP_VEHICLE` | Common |
| `PlayerMovement` | `COLLISION_GROUP_PLAYER_MOVEMENT` | Common |
| `NPC` | `COLLISION_GROUP_NPC` | Common |
| `InVehicle` | `COLLISION_GROUP_IN_VEHICLE` | Common |
| `Weapon` | `COLLISION_GROUP_WEAPON` | Common |
| `VehicleClip` | `COLLISION_GROUP_VEHICLE_CLIP` | Common |
| `Projectile` | `COLLISION_GROUP_PROJECTILE` | Common |
| `DoorBlocker` | `COLLISION_GROUP_DOOR_BLOCKER` | Common |
| `PassableDoor` | `COLLISION_GROUP_PASSABLE_DOOR` | Common |
| `Dissolving` | `COLLISION_GROUP_DISSOLVING` | Common |
| `PushAway` | `COLLISION_GROUP_PUSHAWAY` | Common |
| `NPCActor` | `COLLISION_GROUP_NPC_ACTOR` | Common |
| `NPCScripted` | `COLLISION_GROUP_NPC_SCRIPTED` | Optional |

`NPCScripted` is omitted when the older console-style SDK interface is selected.

## Practical workflows

### Inspect the selected-SDK surface

This inventories both direct constants and grouped members without assuming another game's capabilities:

```js
const g_Constants = require("entities/constants");
const { LogInfo } = require("loggers");

const g_vecNamespaceNames = [
	"CollisionGroup",
	"DamageTypes",
	"DissolveType",
	"EntityEffects",
	"EntityFlags",
	"EntityStates",
	"MoveCollide",
	"MoveType",
	"RenderEffects",
	"RenderMode",
	"SolidFlags",
	"SolidType",
	"TakeDamage",
];

const g_GetConstantNamespaceEntry = function GetConstantNamespaceEntry(strNamespaceName) {
	return [strNamespaceName, Object.keys(g_Constants[strNamespaceName])];
};

const g_IsStandaloneNumericConstant = function IsStandaloneNumericConstant([, ExportValue]) {
	return typeof ExportValue === "number";
};

const g_GetConstantName = function GetConstantName([strConstantName]) {
	return strConstantName;
};

const g_Namespaces = Object.fromEntries(g_vecNamespaceNames.map(g_GetConstantNamespaceEntry));
const g_vecStandaloneConstants = Object.entries(g_Constants).filter(g_IsStandaloneNumericConstant).map(g_GetConstantName);

LogInfo("%j", { Operation: "InventoryEntityConstants", Namespaces: g_Namespaces, StandaloneConstants: g_vecStandaloneConstants });
```

The whole-object import is intentional for this dynamic export inventory. Operational workflows import the exact constants and functions they use.

### Compare current occupancy with server limits

```js
const {
	FIRST_ENTITY_INDEX,
	FIRST_PLAYER_INDEX,
	GetEntityCount,
	GetMaximumEntityCount,
	MAX_EDICTS,
	WORLD_ENTITY_INDEX,
} = require("entities/constants");
const { LogInfo } = require("loggers");

const g_unActiveCount = GetEntityCount();
const g_unCurrentLimit = GetMaximumEntityCount();
if (g_unCurrentLimit > MAX_EDICTS) {
	throw new Error("The runtime entity limit exceeds the selected SDK ceiling.");
}

LogInfo("%j", { Operation: "QueryEntityLimits", ActiveCount: g_unActiveCount, CurrentLimit: g_unCurrentLimit, FirstEntityIndex: FIRST_ENTITY_INDEX, FirstPlayerIndex: FIRST_PLAYER_INDEX, WorldEntityIndex: WORLD_ENTITY_INDEX });
```

### Validate an index before resolving an entity

An index in range can still refer to a free edict, so resolution remains nullable:

```js
const { Entity } = require("entities/entity");
const { GetMaximumEntityCount, INVALID_ENTITY_INDEX } = require("entities/constants");
const { LogInfo } = require("loggers");

const g_IsEntityIndexValid = function IsEntityIndexValid(nEntityIndex) {
	return Number.isInteger(nEntityIndex) && (nEntityIndex !== INVALID_ENTITY_INDEX) && (nEntityIndex >= 0) && (nEntityIndex < GetMaximumEntityCount());
};

const g_nRequestedIndex = 2;
if (!g_IsEntityIndexValid(g_nRequestedIndex)) {
	throw new RangeError(`Entity index ${g_nRequestedIndex} is outside the current server range.`);
}

const g_EntityValue = Entity(g_nRequestedIndex);
if (!g_EntityValue) {
	throw new Error(`Edict ${g_nRequestedIndex} is currently free.`);
}

LogInfo("%j", { Operation: "ResolveEntityWithinLimit", EntityIndex: g_EntityValue.Index, ClassName: g_EntityValue.ClassName });
```

### Build and inspect a damage mask

JavaScript bitwise operators use 32-bit operands. The helper accepts a signed SDK flag (`nDamageType`) and an unsigned normalized mask (`unDamageMask`). Reject zero-valued markers and normalize both comparison operands to unsigned values so a flag in the high bit remains comparable to the numeric SDK constant:

```js
const { DamageTypes } = require("entities/constants");
const { LogInfo } = require("loggers");

const g_HasDamageType = function HasDamageType(unDamageMask, nDamageType) {
	return (nDamageType !== 0) && (((unDamageMask & nDamageType) >>> 0) === (nDamageType >>> 0));
};

if (!Object.hasOwn(DamageTypes, "Blast") || !Object.hasOwn(DamageTypes, "Burn")) {
	throw new Error("The selected SDK does not expose Blast and Burn damage flags.");
}

const g_unIncendiaryExplosion = (DamageTypes.Blast | DamageTypes.Burn) >>> 0;
LogInfo("%j", { Operation: "InspectDamageMask", Blast: g_HasDamageType(g_unIncendiaryExplosion, DamageTypes.Blast), Burn: g_HasDamageType(g_unIncendiaryExplosion, DamageTypes.Burn) });
```

### Temporarily change `m_fFlags`

`EntityStates` belongs to the entity `m_fFlags` value. Preserve every unrelated bit and restore the original value:

```js
const { Entity } = require("entities/entity");
const { EntityStates } = require("entities/constants");
const { GetEntityPropertyInteger, SetEntityPropertyInteger } = require("entities/props");
const { LogInfo } = require("loggers");

const g_Player = Entity(1);
if (!g_Player) {
	throw new Error("Expected player entity 1 to exist.");
}

if (!Object.hasOwn(EntityStates, "NoTarget")) {
	throw new Error("The selected SDK does not expose FL_NOTARGET.");
}

const g_nPreviousEntityFlags = GetEntityPropertyInteger(g_Player, "m_fFlags");
if (!Number.isInteger(g_nPreviousEntityFlags)) {
	throw new Error("Unable to read m_fFlags as an integer.");
}

try {
	if (!SetEntityPropertyInteger(g_Player, "m_fFlags", g_nPreviousEntityFlags | EntityStates.NoTarget)) {
		throw new Error("Unable to enable the temporary NoTarget state.");
	}

	LogInfo("%j", { Operation: "EnableTemporaryEntityState", EntityIndex: g_Player.Index, State: "NoTarget" });
} finally {
	if (!SetEntityPropertyInteger(g_Player, "m_fFlags", g_nPreviousEntityFlags)) {
		throw new Error("Unable to restore m_fFlags.");
	}
}
```

### Apply a temporary collision configuration

The constants identify engine values; `entities/collisions` performs the live reads and writes:

```js
const { Entity } = require("entities/entity");
const { CollisionGroup, SolidFlags, SolidType } = require("entities/constants");
const {
	GetEntityCollisionGroup,
	GetEntitySolidFlags,
	GetEntitySolidType,
	SetEntityCollisionGroup,
	SetEntitySolidFlags,
	SetEntitySolidType,
} = require("entities/collisions");
const { LogInfo } = require("loggers");

const g_EntityValue = Entity(2);
if (!g_EntityValue) {
	throw new Error("Expected entity 2 to exist.");
}

const g_nPreviousCollisionGroup = GetEntityCollisionGroup(g_EntityValue);
const g_unPreviousSolidFlags = GetEntitySolidFlags(g_EntityValue);
const g_unPreviousSolidType = GetEntitySolidType(g_EntityValue);
if (!Number.isInteger(g_nPreviousCollisionGroup) || !Number.isInteger(g_unPreviousSolidFlags) || !Number.isInteger(g_unPreviousSolidType)) {
	throw new Error("Unable to read the current collision configuration as integers.");
}

try {
	if (!SetEntityCollisionGroup(g_EntityValue, CollisionGroup.Debris) || !SetEntitySolidType(g_EntityValue, SolidType.BoundingBox) || !SetEntitySolidFlags(g_EntityValue, g_unPreviousSolidFlags | SolidFlags.Trigger)) {
		throw new Error("Unable to apply the temporary collision configuration.");
	}

	LogInfo("%j", { Operation: "ApplyTemporaryCollisionConfiguration", EntityIndex: g_EntityValue.Index, CollisionGroup: CollisionGroup.Debris, SolidType: SolidType.BoundingBox });
} finally {
	const bSolidFlagsRestored = SetEntitySolidFlags(g_EntityValue, g_unPreviousSolidFlags);
	const bSolidTypeRestored = SetEntitySolidType(g_EntityValue, g_unPreviousSolidType);
	const bCollisionGroupRestored = SetEntityCollisionGroup(g_EntityValue, g_nPreviousCollisionGroup);
	if (!bSolidFlagsRestored || !bSolidTypeRestored || !bCollisionGroupRestored) {
		throw new Error("Unable to restore the collision configuration.");
	}
}
```

### Decode movement and rendering values in diagnostics

This is useful when a datamap, sendprop, hook argument, or engine callback provides a numeric enum value:

```js
const { MoveType, RenderEffects, RenderMode } = require("entities/constants");
const { LogInfo } = require("loggers");

const g_RequireEnumMemberName = function RequireEnumMemberName(Namespace, nValue) {
	const IsRequestedEnumMember = function IsRequestedEnumMember([, nMemberValue]) {
		return nMemberValue === nValue;
	};

	const vecEntry = Object.entries(Namespace).find(IsRequestedEnumMember);
	if (!vecEntry) {
		throw new RangeError(`Unknown enum value: ${nValue}`);
	}

	return vecEntry[0];
};

LogInfo("%j", {
	Operation: "DecodeEntityEnums",
	MoveType: g_RequireEnumMemberName(MoveType, MoveType.VPhysics),
	RenderEffect: g_RequireEnumMemberName(RenderEffects, RenderEffects.GlowShell),
	RenderMode: g_RequireEnumMemberName(RenderMode, RenderMode.Normal),
});
```

### Report optional selected-SDK members

```js
const { CollisionGroup, DamageTypes, EntityEffects, SolidFlags } = require("entities/constants");
const { LogInfo } = require("loggers");

const g_Capabilities = {
	HeadshotDamage: Object.hasOwn(DamageTypes, "Headshot"),
	NoFlashlightEffect: Object.hasOwn(EntityEffects, "NoFlashlight"),
	NPCScriptedCollision: Object.hasOwn(CollisionGroup, "NPCScripted"),
	TriggerTouchDebris: Object.hasOwn(SolidFlags, "TriggerTouchDebris"),
};

LogInfo("%j", { Operation: "ReportEntityConstantCapabilities", Capabilities: g_Capabilities });
```

## Common mistakes

- Do not cache `GetEntityCount()` or `GetMaximumEntityCount()` across map transitions; both describe current engine state.
- Do not use `MAX_EDICTS` as the occupied entity count.
- Do not assume `FIRST_PLAYER_INDEX` is connected or even occupied.
- Do not compare a bitmask with `===` when testing one flag; reject zero and normalize both operands for a signed SDK flag, for example `(nFlag !== 0) && (((unValue & nFlag) >>> 0) === (nFlag >>> 0))`.
- Do not treat a zero-valued enum member such as `DamageTypes.Generic` as a set bit; an AND test cannot distinguish it.
- Do not write `EntityStates` into edict `StateFlags`; they describe different engine fields.
- Do not assign `MoveCollide.Count` as a movement mode; it is an enum boundary.
- Do not invent absent constants from another SDK branch.
- Restore temporary flags, collision state, and property writes in `finally` blocks.

Related modules: [`entities`](entities.md), [`entities/collisions`](entities-collisions.md), [`entities/props`](entities-props.md), and [`globals`](globals.md).
