# `require("engines/trace")`

> Warning: this page documents the exact SourceJS runtime contract. Use the table of contents, and do not infer JavaScript Ray classes, fallback stubs, or constants that the selected HL2SDK branch does not expose. Result records and borrowed entity/address lifetimes are described separately below.

The [`engines/trace` package](../../packages/sourcejs/engines/trace.js) exports the runtime module obtained from `GetModule("engines/trace")`; it does not add a JavaScript argument-normalization layer. Its native registration is in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). The selected Source 1 SDK's `IEngineTrace` supplies the tracing operations; the native V8 binding translates rays, filters, enumerators, collideables, and trace results.

Use this module for line of sight, bullet and hull traces, point-content tests, collideable sweeps, and broad-phase entity enumeration. It operates on current engine state and must run on the server thread. Native calls and any filter/enumerator callbacks are synchronous; the dedicated Redis/HTTP/SQL/socket request workers do not execute engine trace operations.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [Constants](#constants)
- [Ray input](#ray-input)
- [Trace filters](#trace-filters)
- [Entity enumerators](#entity-enumerators)
- [Trace results](#trace-results)
- [Point and collideable queries](#point-and-collideable-queries)
- [Ray and hull traces](#ray-and-hull-traces)
- [Entity enumeration](#entity-enumeration)
- [World queries](#world-queries)
- [Practical workflows](#practical-workflows)
- [Lifecycle and safety](#lifecycle-and-safety)
- [Common mistakes](#common-mistakes)
- [Related modules](#related-modules)

## Import and capabilities

Import the package directly:

```js
const { MAX_TRACE_LENGTH } = require("engines/trace");
const { LogInfo } = require("loggers");

LogInfo("%j", { Operation: "ImportTrace", MaximumTraceLength: MAX_TRACE_LENGTH });
```

Native module installation is gated by `SOURCEJS_HAS_ENGINE_TRACE`; successful import does not by itself establish runtime interface readiness. The binding omits the following members when compiled with `SOURCEJS_OLD_CONSOLE_API`, rather than installing placeholder properties:

- `CONTENTS_BLOCKLOS` and `ContentFlags.BlockLineOfSight`.
- `CONTENTS_UNUSED` and `ContentFlags.Unused`.
- `MASK_BLOCKLOS` and `ContentMasks.BlockLineOfSight`.
- `MASK_BLOCKLOS_AND_NPCS` and `ContentMasks.BlockLineOfSightAndNPCs`.
- `SurfaceFlags.Sky2D` and `SurfaceFlags.NoPortal`.

Test a branch-dependent property before using it:

```js
const { ContentMasks } = require("engines/trace");
const { LogInfo } = require("loggers");

if (!Object.hasOwn(ContentMasks, "BlockLineOfSight")) {
	throw new Error("This SDK does not expose MASK_BLOCKLOS.");
}

const g_unLineOfSightMask = ContentMasks.BlockLineOfSight;
LogInfo("%j", { Operation: "SelectTraceMask", Mask: `0x${g_unLineOfSightMask.toString(16).toUpperCase().padStart(8, "0")}` });
```

SourceJS exports only the direct native functions and namespaces listed on this page; it does not add JavaScript wrapper classes or alternate enum-member spellings.

## Exports

The complete possible selected-SDK surface contains 78 direct properties: 11 functions, five namespaces, 33 standalone content constants, nine coordinate constants, and 20 standalone masks. Branch-dependent constants reduce that count on old-console SDKs.

| Export | Signature | Result |
| --- | --- | --- |
| [`GetPointContents`](#getpointcontentsposition-uncontentsmask--mask_all) | `GetPointContents(Position, unContentsMask = MASK_ALL)` | New `{ Contents, Mask, Entity, Entities }` object: signed contents, unsigned mask, an `{ Index, Handle, Exists }` entity record or `null`, and zero or one nonnegative entity index. Omitted/nullish mask uses `MASK_ALL`; other masks require Uint32. SDK overloads without mask support reject a non-`MASK_ALL` mask. |
| `GetPointContentsOfCollideable` | `GetPointContentsOfCollideable(EntityValue, Position)` | Engine-returned signed content flags. Requires an entity index or index-bearing object resolving to a non-free edict with `ICollideable`, and a position with accepted vector components. An unavailable collideable is an error, not a zero-content result; this argument is not a raw collideable address. |
| [`TraceRay`](#tracerayray-uncontentsmask--mask_all-filtervalue--null-tracetarget--null) | `TraceRay(Ray, unContentsMask = MASK_ALL, FilterValue = null, TraceTarget = null)` | Trace result object. `Ray` requires accepted `Start` and `End` vectors; optional `Minimums` and `Maximums` must be present together. Omitted/nullish mask selects `MASK_ALL`; other masks require Uint32. Filters may call JavaScript synchronously; a failed filter invalidates the operation instead of returning a successful trace. Omitted/nullish target creates an object; a supplied non-array object is populated in place and returned after tracing. Target writes are sequential and can leave partial changes on failure. |
| [`ClipRayToEntity`](#clipraytoentityray-uncontentsmask-entityvalue-tracetarget--null) | `ClipRayToEntity(Ray, unContentsMask, EntityValue, TraceTarget = null)` | Trace result against an entity resolved by index. Requires three argument positions; a nullish mask selects `MASK_ALL`, otherwise Uint32 is required. Missing entity resolution is an error. Uses the same ray conversion and optional in-place result target as `TraceRay`, but no trace filter. |
| [`ClipRayToCollideable`](#clipraytocollideableray-uncontentsmask-entityvalue-tracetarget--null) | `ClipRayToCollideable(Ray, unContentsMask, EntityValue, TraceTarget = null)` | Trace result against an entity's `ICollideable`, resolved by index rather than raw address. Requires three argument positions; a nullish mask selects `MASK_ALL`, otherwise Uint32 is required. Missing collideable resolution is an error. Uses `TraceRay`'s ray conversion and optional in-place result target, without a filter. |
| [`EnumerateEntities`](#enumerateentitiesray-bincludetriggers--false-enumeratorvalue--null) | `EnumerateEntities(Ray, bIncludeTriggers = false, EnumeratorValue = null)` | Visited nonnegative entity-index array, without deduplication. Omitted/`undefined` trigger flag uses `false`; `null` and other non-booleans are rejected. Enumerator callbacks run synchronously and must return a boolean; each valid index is recorded before the callback. A callback failure invalidates the result. |
| [`EnumerateEntitiesInBox`](#enumerateentitiesinboxminimumbounds-maximumbounds-enumeratorvalue--null) | `EnumerateEntitiesInBox(MinimumBounds, MaximumBounds, EnumeratorValue = null)` | New visited nonnegative entity-index array. Requires two accepted vectors; the binding orders their components into minimum/maximum bounds before the SDK call. Uses the same synchronous enumerator and pre-callback index collection as `EnumerateEntities`, without a trigger flag or deduplication. |
| [`GetCollideable`](#getcollideableentityvalue-and-getpointcontentsofcollideableentityvalue-position) | `GetCollideable(EntityValue)` | New `{ EntityIndex, Address, Entity }` record; `Entity` is an `{ Index, Handle, Exists }` record. Invalid entity indexes or missing/free edicts throw; a valid edict without a collideable returns `null`. `Address` is an exact `BigInt` representation of the native address; it is borrowed, not owned. |
| [`IsPointOutsideWorld`](#ispointoutsideworldposition) | `IsPointOutsideWorld(Position)` | Engine's boolean `PointOutsideWorld` result after required vector conversion. An unavailable interface or invalid position is an error, not `false`. |
| [`GetLeafContainingPoint`](#getleafcontainingpointposition) | `GetLeafContainingPoint(Position)` | Engine-returned signed BSP leaf index after required vector conversion; the binding does not validate the returned index against a leaf count. An unavailable interface or invalid position is an error. |
| [`SweepCollideable`](#sweepcollideableentityvalue-startposition-endposition-sweepangles-uncontentsmask-filtervalue--null-tracetarget--null) | `SweepCollideable(EntityValue, StartPosition, EndPosition, SweepAngles, unContentsMask, FilterValue = null, TraceTarget = null)` | Trace result for an entity's index-resolved `ICollideable`. Requires five argument positions and accepted start/end/angle vectors; a nullish mask selects `MASK_ALL`, otherwise Uint32 is required. Uses the same synchronous filter and optional in-place result target as `TraceRay`. A missing collideable or failed filter is an error, not a successful sweep. |
| [`TraceType`](#tracetype) | Namespace | Native `TraceType_t` values. |
| [`DisplacementFlags`](#displacementflags) | Namespace | Displacement-surface result bits. |
| [`SurfaceFlags`](#surfaceflags) | Namespace | BSP surface bits. |
| `ContentFlags` | Namespace | PascalCase content bits. |
| `ContentMasks` | Namespace | PascalCase trace masks. |

`GetCollideable().Address` is a `BigInt` containing the exact nonnegative native address. It is not an ownership handle and does not extend the collideable's lifetime. Masks instead require V8's strict unsigned-32-bit `Number` check; strings, boxed numbers, and `BigInt` masks are not coerced.

Checked result creation and property writes can fail. If a result builder returns an empty handle without a pending exception, the callback returns `undefined`; this is distinct from the documented native `null` sentinels. Check the returned object or array before reading it. A supplied `TraceTarget` may already contain partial updates when construction fails.

## Constants

The SDK-spelled top-level constants and the `TraceType`, `DisplacementFlags`, `SurfaceFlags`, `ContentFlags`, and `ContentMasks` records and their entries are own writable, enumerable, configurable data properties, installed without invoking inherited setters. The five records retain ordinary object prototypes. Numeric values and branch availability still come from the selected SDK; the established export names are unchanged.

### `TraceType`

| Member | Value | Filter scope |
| --- | ---: | --- |
| `Everything` | `0` | World and entities. |
| `WorldOnly` | `1` | World geometry, excluding static props. |
| `EntitiesOnly` | `2` | Entities, excluding static props. |
| `EverythingFilterProperties` | `3` | World and entities, with static props also passed through the filter. The export name is exact; “properties” here does not mean JavaScript object properties. |

### `DisplacementFlags`

| Member | Value | Meaning |
| --- | ---: | --- |
| `Surface` | `0x01` | The result surface is a displacement. |
| `Walkable` | `0x02` | The displacement is walkable. |
| `Buildable` | `0x04` | The displacement is buildable. |
| `SurfaceProperty1` | `0x08` | First displacement surface-property bit. |
| `SurfaceProperty2` | `0x10` | Second displacement surface-property bit. |

### `SurfaceFlags`

| Member | Value | Member | Value |
| --- | ---: | --- | ---: |
| `Light` | `0x0001` | `Sky2D` | `0x0002`, capability |
| `Sky` | `0x0004` | `Warp` | `0x0008` |
| `Translucent` | `0x0010` | `NoPortal` | `0x0020`, capability |
| `Trigger` | `0x0040` | `NoDraw` | `0x0080` |
| `Hint` | `0x0100` | `Skip` | `0x0200` |
| `NoLight` | `0x0400` | `BumpLight` | `0x0800` |
| `NoShadows` | `0x1000` | `NoDecals` | `0x2000` |
| `NoChop` | `0x4000` | `Hitbox` | `0x8000` |

### Content flags

Each PascalCase `ContentFlags` member has the matching standalone `UPPER_SNAKE_CASE` constant. `LastVisible` maps to `LAST_VISIBLE_CONTENTS`; `AllVisible` maps to `ALL_VISIBLE_CONTENTS`.

| `ContentFlags` member | Standalone constant | Value |
| --- | --- | ---: |
| `Empty` | `CONTENTS_EMPTY` | `0x00000000` |
| `Solid` | `CONTENTS_SOLID` | `0x00000001` |
| `Window` | `CONTENTS_WINDOW` | `0x00000002` |
| `Auxiliary` | `CONTENTS_AUX` | `0x00000004` |
| `Grate` | `CONTENTS_GRATE` | `0x00000008` |
| `Slime` | `CONTENTS_SLIME` | `0x00000010` |
| `Water` | `CONTENTS_WATER` | `0x00000020` |
| `BlockLineOfSight` | `CONTENTS_BLOCKLOS` | `0x00000040`, capability |
| `Opaque` | `CONTENTS_OPAQUE` | `0x00000080` |
| `LastVisible` | `LAST_VISIBLE_CONTENTS` | `0x00000080` |
| `AllVisible` | `ALL_VISIBLE_CONTENTS` | `0x000000FF` |
| `TestFogVolume` | `CONTENTS_TESTFOGVOLUME` | `0x00000100` |
| `Unused` | `CONTENTS_UNUSED` | `0x00000200`, capability |
| `Team1` | `CONTENTS_TEAM1` | `0x00000800` |
| `Team2` | `CONTENTS_TEAM2` | `0x00001000` |
| `IgnoreNoDrawOpaque` | `CONTENTS_IGNORE_NODRAW_OPAQUE` | `0x00002000` |
| `Moveable` | `CONTENTS_MOVEABLE` | `0x00004000` |
| `AreaPortal` | `CONTENTS_AREAPORTAL` | `0x00008000` |
| `PlayerClip` | `CONTENTS_PLAYERCLIP` | `0x00010000` |
| `MonsterClip` | `CONTENTS_MONSTERCLIP` | `0x00020000` |
| `Current0` | `CONTENTS_CURRENT_0` | `0x00040000` |
| `Current90` | `CONTENTS_CURRENT_90` | `0x00080000` |
| `Current180` | `CONTENTS_CURRENT_180` | `0x00100000` |
| `Current270` | `CONTENTS_CURRENT_270` | `0x00200000` |
| `CurrentUp` | `CONTENTS_CURRENT_UP` | `0x00400000` |
| `CurrentDown` | `CONTENTS_CURRENT_DOWN` | `0x00800000` |
| `Origin` | `CONTENTS_ORIGIN` | `0x01000000` |
| `Monster` | `CONTENTS_MONSTER` | `0x02000000` |
| `Debris` | `CONTENTS_DEBRIS` | `0x04000000` |
| `Detail` | `CONTENTS_DETAIL` | `0x08000000` |
| `Translucent` | `CONTENTS_TRANSLUCENT` | `0x10000000` |
| `Ladder` | `CONTENTS_LADDER` | `0x20000000` |
| `Hitbox` | `CONTENTS_HITBOX` | `0x40000000` |

Combine content bits with bitwise OR and normalize the signed JavaScript bitwise result back to an unsigned mask:

```js
const { ContentFlags } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_unWaterOrSlime = (ContentFlags.Water | ContentFlags.Slime) >>> 0;
const g_unBlocksPlayers = (ContentFlags.Solid | ContentFlags.PlayerClip) >>> 0;

LogInfo("%j", {
	Operation: "CombineContentMasks",
	BlocksPlayersMask: `0x${g_unBlocksPlayers.toString(16).toUpperCase().padStart(8, "0")}`,
	WaterOrSlimeMask: `0x${g_unWaterOrSlime.toString(16).toUpperCase().padStart(8, "0")}`,
});
```

### Content masks

Each PascalCase member maps to the matching standalone mask.

| `ContentMasks` member | Standalone constant | L4D2 value | Intended query |
| --- | --- | ---: | --- |
| `All` | `MASK_ALL` | `0xFFFFFFFF` | Every content bit. |
| `Solid` | `MASK_SOLID` | `0x0200400B` | Normally solid world and entities. |
| `PlayerSolid` | `MASK_PLAYERSOLID` | `0x0201400B` | Player movement. |
| `NPCSolid` | `MASK_NPCSOLID` | `0x0202400B` | NPC movement. |
| `Water` | `MASK_WATER` | `0x00004030` | Water, slime, and moveable water. |
| `Opaque` | `MASK_OPAQUE` | `0x00004081` | Lighting blockers. |
| `OpaqueAndNPCs` | `MASK_OPAQUE_AND_NPCS` | `0x02004081` | Lighting blockers plus NPCs. |
| `BlockLineOfSight` | `MASK_BLOCKLOS` | `0x00004041`, capability | AI line of sight. |
| `BlockLineOfSightAndNPCs` | `MASK_BLOCKLOS_AND_NPCS` | `0x02004041`, capability | AI line of sight plus NPCs. |
| `Visible` | `MASK_VISIBLE` | `0x00006081` | Player-visible blockers. |
| `VisibleAndNPCs` | `MASK_VISIBLE_AND_NPCS` | `0x02006081` | Player-visible blockers plus NPCs. |
| `Shot` | `MASK_SHOT` | `0x46004003` | Raycast bullets and hitboxes. |
| `ShotHull` | `MASK_SHOT_HULL` | `0x0600400B` | Hull weapons, including grates. |
| `ShotPortal` | `MASK_SHOT_PORTAL` | `0x02004003` | Portal-style solid test. |
| `SolidBrushOnly` | `MASK_SOLID_BRUSHONLY` | `0x0000400B` | World and solid brushes, no monsters. |
| `PlayerSolidBrushOnly` | `MASK_PLAYERSOLID_BRUSHONLY` | `0x0001400B` | Player movement against brushes. |
| `NPCWorldStatic` | `MASK_NPCWORLDSTATIC` | `0x0002000B` | Static NPC route world. |
| `SplitAreaPortal` | `MASK_SPLITAREAPORTAL` | `0x00000030` | Water and slime area-portal splitters. |
| `Current` | `MASK_CURRENT` | `0x00FC0000` | Every directional current. |
| `DeadSolid` | `MASK_DEADSOLID` | `0x0001000B` | Corpse movement. |

Numeric values are selected-SDK macros. Use named masks in plugin code instead of embedding the L4D2 values.

### Coordinate limits

| Export | Common Source 1 value | Meaning |
| --- | ---: | --- |
| `MAX_COORD_INTEGER` | `16384` | Maximum integer coordinate. |
| `MIN_COORD_INTEGER` | `-16384` | Minimum integer coordinate. |
| `MAX_COORD_FRACTION` | `0.9375` | Maximum SDK world-coordinate fraction constant, not the BitCoord quantization bound. |
| `MIN_COORD_FRACTION` | `-0.9375` | Minimum SDK world-coordinate fraction constant; negative counterpart of `MAX_COORD_FRACTION`. |
| `MAX_COORD_FLOAT` | `16384` | Maximum floating coordinate. |
| `MIN_COORD_FLOAT` | `-16384` | Minimum floating coordinate. |
| `COORD_EXTENT` | `32768` | Full coordinate span. |
| `MAX_TRACE_LENGTH` | Approximately `sqrt(3) * COORD_EXTENT` | Longest diagonal trace through the coordinate cube; the SDK uses a decimal approximation of `sqrt(3)`. |
| `MAX_COORD_RANGE` | `16384` | Maximum coordinate magnitude. |

## Ray input

A ray is an object with required `Start` and `End` vectors:

```js
const { MAX_TRACE_LENGTH } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_PlayerEntity = Player(1);
if (!g_PlayerEntity) {
	throw new Error("Player 1 is unavailable.");
}

const g_StartPosition = g_PlayerEntity.GetEyeLocation();
const g_EndPosition = g_StartPosition.AddVector(g_PlayerEntity.GetViewVector().MultiplyScalar(MAX_TRACE_LENGTH));
const g_ViewRay = { Start: g_StartPosition, End: g_EndPosition };
LogInfo("%j", {
	Operation: "CreateViewRay",
	Start: [g_ViewRay.Start.X, g_ViewRay.Start.Y, g_ViewRay.Start.Z],
	End: [g_ViewRay.End.X, g_ViewRay.End.Y, g_ViewRay.End.Z],
});
```

An axis-aligned swept hull additionally provides both `Minimums` and `Maximums` as vectors with at least one accepted component. Nullish, primitive, or component-free bounds are treated as absent. One present bound with an absent counterpart is an error:

```js
const { LogInfo } = require("loggers");
const { Vector } = require("mathlib");

const g_HullRay = {
	Start: new Vector(0, 0, 64),
	End: new Vector(256, 0, 64),
	Minimums: new Vector(-16, -16, -36),
	Maximums: new Vector(16, 16, 36),
};
LogInfo("%j", {
	Operation: "CreateHullRay",
	Start: [g_HullRay.Start.X, g_HullRay.Start.Y, g_HullRay.Start.Z],
	End: [g_HullRay.End.X, g_HullRay.End.Y, g_HullRay.End.Z],
	Minimums: [g_HullRay.Minimums.X, g_HullRay.Minimums.Y, g_HullRay.Minimums.Z],
	Maximums: [g_HullRay.Maximums.X, g_HullRay.Maximums.Y, g_HullRay.Maximums.Z],
});
```

The examples log explicit numeric component snapshots. A current `mathlib.Vector` keeps its `BigInt` address in private storage, so that address alone does not make the wrapper's default JSON serialization fail. Component reads, including those performed by serialization, still require valid backing storage for address-backed views.

Vectors accept arrays or objects. Array indexes `0`, `1`, and `2` map to X, Y, and Z. For objects, each non-nullish `X`, `Y`, or `Z` takes priority over its `Pitch`, `Yaw`, or `Roll` fallback. Missing/nullish components default to zero; an entirely absent vector is not a valid required endpoint. Present components undergo JavaScript numeric conversion and must produce finite values within the native `float` range. Conversion and getter errors propagate unchanged and abort parsing; nullish defaults never replace a failed lookup. Use ordinary numeric components to avoid coercion and reentrant getters. After component conversion, ray construction rejects out-of-range derived coordinate operations before calling the SDK: endpoint subtraction, hull bound subtraction and addition before halving, and the centered start. Centering retains the SDK's float-sum rounding. These are coordinate-range checks, not engine-world bounds, hull-order validation, or a replacement for SDK ray classification.

## Trace filters

The filter argument accepted by `TraceRay` and `SweepCollideable` has four exact forms.

### No filter

Use `null`, `undefined`, or omit the argument to use the default `TraceType.Everything` behavior.

### Ignore entity or entities

Pass an array of entity objects or non-negative entity indexes to ignore those entities. This is useful for excluding the shooter:

```js
const { ContentMasks, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_flTraceDistance = 2048;

const g_Shooter = Player(1);
if (!g_Shooter) {
	throw new Error("Player 1 is unavailable.");
}

const g_StartPosition = g_Shooter.GetEyeLocation();
const g_EndPosition = g_StartPosition.AddVector(g_Shooter.GetViewVector().MultiplyScalar(g_flTraceDistance));
const g_TraceResult = TraceRay({ Start: g_StartPosition, End: g_EndPosition }, ContentMasks.Shot, [g_Shooter]);
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

LogInfo("%j", { Operation: "IgnoreTraceEntity", EntityIndex: g_TraceResult.EntityIndex });
```

The object form also accepts `Ignore` as one entity value or an array of entity values. Each value must resolve to a nonnegative Int32 index; this collection step does not establish that the indexed entity is live. A nullish `Ignore` means an empty list, but nullish or invalid array entries are errors. Array and entity `Index` getters may execute during collection; their original exceptions propagate. The collected indexes preserve input order and duplicates and are committed only after the entire list succeeds.

### Callback filter

A callback receives a new trace-entity descriptor `{ Index, Handle, Exists }` and the current signed content mask. The descriptor retains an ordinary object prototype; its three fields are own writable, enumerable, configurable data properties created without invoking inherited setters. `Index` is the handle's entry index, or `-1` for a missing/invalid handle; `Handle` is the packed signed 32-bit handle, or `-1` when no entity is supplied. `Exists` reports a nonnegative handle index, not a separate live-entity lookup. The callback must return an actual boolean:

```js
const { ContentMasks, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 1024, Y: 0, Z: 64 },
};
const g_ShouldHitSelectedIndexes = (EntityInformation, nContentsMask) => {
	LogInfo("%j", { Operation: "EvaluateTraceFilter", EntityIndex: EntityInformation.Index, Mask: `0x${(nContentsMask >>> 0).toString(16).toUpperCase().padStart(8, "0")}` });

	return (EntityInformation.Index >= 1) && (EntityInformation.Index <= 2);
};

const g_TraceResult = TraceRay(g_Ray, ContentMasks.Shot, g_ShouldHitSelectedIndexes);
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

LogInfo("%j", { Operation: "FilteredTrace", EntityIndex: g_TraceResult.EntityIndex });
```

### Filter object

An object may provide:

- `Ignore`: one entity value or an array of entity values; each value may be an entity object or a non-negative entity index;
- `TraceType`: one of the four exported integer `TraceType` values;
- `GetTraceType()`: function returning one of the four exported integer `TraceType` values;
- `ShouldHitEntity(EntityInformation, nContentsMask)`: function returning a boolean.

If both are non-nullish, `TraceType` takes precedence over `GetTraceType()`. Other integers are rejected before conversion to the native enum. Each selected `ShouldHitEntity`, `TraceType`, and `GetTraceType` property is read once per filter initialization; its captured value supplies both presence and value validation. A non-nullish `TraceType` prevents the `GetTraceType` lookup entirely. Getter errors propagate unchanged and abort initialization. A pending JavaScript error also remains unchanged if a native C++ exception crosses a method-lookup or callback handler. Unexpected native exceptions without a pending JavaScript error become operation-specific errors and invalidate the filter. Object methods use the filter object as their receiver. Use stable properties and only one trace-type source in a filter:

```js
const { ContentMasks, TraceType, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_IgnoredPlayer = Player(2);
if (!g_IgnoredPlayer) {
	throw new Error("Player 2 is unavailable.");
}

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 1024, Y: 0, Z: 64 },
};
const g_TraceFilter = {
	Ignore: g_IgnoredPlayer,
	GetTraceType() {
		return TraceType.EverythingFilterProperties;
	},
	ShouldHitEntity(EntityInformation) {
		return EntityInformation.Exists;
	},
};

const g_TraceResult = TraceRay(g_Ray, ContentMasks.Solid, g_TraceFilter);
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

LogInfo("%j", { Operation: "ObjectTraceFilter", EntityIndex: g_TraceResult.EntityIndex });
```

Filter callback exceptions propagate into JavaScript. Non-boolean results are errors, not coerced values. After a callback error, the filter becomes invalid and further native calls to it do not invoke JavaScript. Returning `false` normally rejects that entity without invalidating the filter. Native C++ preparation failures are translated into JavaScript errors rather than escaping the SDK callback boundary.

## Entity enumerators

The optional enumerator argument accepted by `EnumerateEntities` and `EnumerateEntitiesInBox` has these forms:

- `null`, `undefined`, or omission to collect every visited non-negative entity index;
- a function `(EntityInformation) => boolean`;
- an object with `EnumEntity(EntityInformation) => boolean`.

The callback receives the same `{ Index, Handle, Exists }` descriptor used by trace filters. A non-negative entity index is appended to the returned visited-index array before the callback runs. Returning `false` stops enumeration, so the stopping entity's non-negative index remains in the array. Object methods use the enumerator object as their receiver. Getter and callback exceptions propagate unchanged; non-boolean returns are errors. After an error, further native calls neither invoke the callback nor append indexes. Native C++ collection/preparation failures are translated into JavaScript errors rather than escaping the SDK callback boundary. Returned visited-index arrays retain `Array.prototype` and create their indexed elements as own data properties without invoking inherited setters.

## Trace results

`TraceRay`, `ClipRayToEntity`, `ClipRayToCollideable`, and `SweepCollideable` return objects with the same result fields. If the optional target argument is a non-array object, SourceJS fills and returns that exact object. A nullish or omitted target creates a new object; any other target is an error. Writes to a supplied target are sequential, so a failure can leave it partially updated. Checked construction can return `undefined` without a pending exception; validate the result before using these fields.

New results and their `Plane` and `Surface` records retain ordinary object prototypes and define own writable, enumerable, configurable data properties without invoking inherited setters. A supplied target instead retains ordinary top-level assignment behavior, including its own/inherited setters and proxy set traps; those writes keep their existing order and partial-failure behavior. Its newly created `Plane` and `Surface` records still use own data properties.

| Property | Type | Meaning |
| --- | --- | --- |
| `StartPosition` | Plain `{ X, Y, Z }` record | Effective start position. |
| `EndPosition` | Plain `{ X, Y, Z }` record | Position reached at `Fraction`. |
| `Plane.Normal` | Plain `{ X, Y, Z }` record | Collision-plane normal. |
| `Plane.Distance` | Number | Plane distance. |
| `Plane.Type` | Integer | Engine plane type. |
| `Plane.SignBits` | Integer | Plane-normal sign mask. |
| `Fraction` | Number | Travel fraction in the range normally used by Source traces. |
| `Contents` | Signed integer | Content bits at the hit. |
| [`DisplacementFlags`](#displacementflags) | Integer | `DisplacementFlags` bits. |
| `AllSolid` | Boolean | Ray remained completely in solid. |
| `StartSolid` | Boolean | Ray began in solid. |
| `Hit` | Boolean | Any hit occurred. |
| `HitWorld` | Boolean | `Hit` is true and `EntityIndex` is zero. |
| `HitNonWorldEntity` | Boolean | `Hit` is true and `EntityIndex` is greater than zero. |
| `EntityIndex` | Integer | Hit entity index, or `-1` when no hit entity is available. |
| `FractionLeftSolid` | Number | Fraction at which the trace left solid. |
| `Surface.Name` | String | Engine-provided surface name; an absent native name becomes an empty string. |
| `Surface.SurfaceProperties` | Integer | Surface-property index. |
| `Surface.Flags` | Unsigned integer | `SurfaceFlags` bits. |
| `HitGroup` | Integer | Player/NPC hit group. |
| `PhysicsBone` | Integer | Physics-bone index. |
| `Hitbox` | Integer | Studio hitbox index. |
| `Entity` | Entity or `null` | SourceJS entity object for a non-negative `EntityIndex`; otherwise `null`. |

Inspect the result before using hit-specific fields:

```js
const { ContentMasks, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_flTraceDistance = 4096;

const g_Shooter = Player(1);
if (!g_Shooter) {
	throw new Error("Player 1 is unavailable.");
}

const g_StartPosition = g_Shooter.GetEyeLocation();
const g_EndPosition = g_StartPosition.AddVector(g_Shooter.GetViewVector().MultiplyScalar(g_flTraceDistance));
const g_TraceResult = TraceRay({ Start: g_StartPosition, End: g_EndPosition }, ContentMasks.Shot, [g_Shooter]);
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

if (g_TraceResult.Hit) {
	LogInfo("%j", {
		Operation: "InspectTraceHit",
		Fraction: g_TraceResult.Fraction,
		EntityIndex: g_TraceResult.EntityIndex,
		Hitbox: g_TraceResult.Hitbox,
		HitGroup: g_TraceResult.HitGroup,
		SurfaceName: g_TraceResult.Surface.Name,
		EndPosition: g_TraceResult.EndPosition,
	});
}
```

Pass a non-array object as the optional `TraceTarget` argument to reuse the outer result object. Native code writes the trace fields into that same object, but still creates nested vector, plane, and surface records:

```js
const { ContentMasks, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 512, Y: 0, Z: 64 },
};
const g_ReusableResult = { RequestID: 42 };
const g_TraceResult = TraceRay(g_Ray, ContentMasks.Visible, null, g_ReusableResult);
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

LogInfo("%j", { Operation: "ReuseTraceResult", Reused: g_TraceResult === g_ReusableResult, RequestID: g_TraceResult.RequestID, Fraction: g_TraceResult.Fraction });
```

`StartPosition`, `EndPosition`, and `Plane.Normal` are plain `{ X, Y, Z }` records, not `mathlib.Vector` instances. The nested `Plane` and `Surface` records are also result data, not persistent live-memory views. Perform a new trace to observe changed engine state. The hit entity index and the borrowed surface name are captured before result construction or property writes can invoke JavaScript setters. Target writes still occur in order and may leave partial changes if a setter throws; the original thrown value is preserved. The `Entity` object remains a live index-based view, not a lifetime guarantee for the hit entity.

## Point and collideable queries

### `GetPointContents(Position, unContentsMask = MASK_ALL)`

Returns:

- `Contents`: engine-returned signed integer content bits. The binding passes `unContentsMask` to a supported SDK overload but does not post-mask the returned value;
- `Mask`: the actual unsigned mask used;
- `Entity`: `{ Index, Handle, Exists }` for the entity returned by the engine query, or `null`;
- `Entities`: an empty array or a one-element array containing the same non-negative entity index.

On SDK branches with the masked point-query overload, pass `ContentMasks.Water` as the query mask and test the returned water bit rather than assuming all other returned bits are zero. Branches without that overload accept only `MASK_ALL` and throw when a narrower mask is requested.

`Position` getter and component-conversion errors propagate unchanged; invalid components retain their parser diagnostic. Native C++ failures during interface lookup, the query, or result construction become an operation-specific JavaScript error rather than escaping the V8 callback boundary or returning a successful result. This does not roll back native query side effects.

Native entity index and handle data are captured before result construction. The outer result and its nested `Entity` descriptor retain ordinary object prototypes; their fields are own writable, enumerable, configurable data properties created without invoking inherited setters. `Entities` retains `Array.prototype` and creates its indexed elements as own data properties. `Entity` and `Entities` retain the query snapshot, not a live view or an entity-lifetime guarantee. The outer properties are defined in `Contents`, `Mask`, `Entity`, `Entities` order.

```js
const { ContentFlags, ContentMasks, GetPointContents } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_FeetPosition = { X: 64, Y: 32, Z: -16 };
const g_PointContents = GetPointContents(g_FeetPosition, ContentMasks.Water);
if (!g_PointContents) {
	throw new Error("GetPointContents() did not return a result.");
}

const g_bInWater = (g_PointContents.Contents & ContentFlags.Water) !== 0;
LogInfo("%j", {
	Operation: "QueryPointContents",
	InWater: g_bInWater,
	OwnerEntityIndex: g_PointContents.Entity?.Index ?? null,
});
```

### `GetCollideable(EntityValue)` and `GetPointContentsOfCollideable(EntityValue, Position)`

`EntityValue` may be a valid entity object or a non-negative entity index. `GetCollideable` validates it and returns `null` when that valid entity has no `ICollideable`. A successful result contains `EntityIndex`, an exact `BigInt` native `Address`, and the `{ Index, Handle, Exists }` `Entity` descriptor. The address is borrowed; do not retain it across entity deletion or map changes.

The native address and entity data are captured before the outer result fields are defined. The outer record and its nested `Entity` descriptor retain ordinary object prototypes; their fields are own writable, enumerable, configurable data properties created without invoking inherited setters. The outer fields are defined in `EntityIndex`, `Address`, `Entity` order. The record is a snapshot, not a lifetime lease: `Entity.Exists` is not a live check, and the borrowed `Address` does not keep native storage alive.

`GetPointContentsOfCollideable` requires a valid entity with `ICollideable`, tests a point against that collideable, and returns signed integer content flags. It throws when entity or collideable resolution fails; call `GetCollideable` first when absence is expected. The entity must expose a valid native handle. Its index and serial are copied before reading `Position`; after the vector getters finish, the operation resolves a fresh collideable only for that same entity identity. Removal, slot reuse with a different serial, an invalid handle, or a missing collideable throws before native query dispatch. Replacing only the collideable while retaining the entity identity uses the fresh collideable. The user-supplied entity index is read only once; getter side effects and original thrown values are not rolled back or replaced.

`GetCollideable`, `GetPointContentsOfCollideable`, `TraceRay`, `ClipRayToEntity`, `ClipRayToCollideable`, `EnumerateEntities`, `EnumerateEntitiesInBox`, `IsPointOutsideWorld`, `GetLeafContainingPoint`, and `SweepCollideable` preserve original entity `Index`, ray, vector, bounds, and angle getter/conversion errors. Invalid ray/vector input retains its parser diagnostic. Native C++ preparation, lookup, dispatch, and result-construction failures become operation-specific JavaScript errors; this does not roll back completed native operations or user callback side effects.

```js
const { ContentFlags, GetCollideable, GetPointContentsOfCollideable } = require("engines/trace");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_Prop = Entity(7);
if (!g_Prop) {
	throw new Error("Entity 7 is unavailable.");
}

const g_Collideable = GetCollideable(g_Prop);
if (g_Collideable === undefined) {
	throw new Error("GetCollideable() did not return a result.");
}

if (g_Collideable) {
	const nContents = GetPointContentsOfCollideable(g_Prop, { X: 320, Y: 0, Z: 0 });
	const bInsideSolid = (nContents & ContentFlags.Solid) !== 0;
	LogInfo("%j", { Operation: "QueryCollideableContents", InsideSolid: bInsideSolid, Address: `0x${g_Collideable.Address.toString(16).toUpperCase()}` });
}
```

The JSON diagnostic converts `Address` to a hexadecimal string to preserve every `BigInt` bit; the API property itself remains a `BigInt`.

## Ray and hull traces

### `TraceRay(Ray, unContentsMask = MASK_ALL, FilterValue = null, TraceTarget = null)`

This is the general world/entity trace. Use a mask that matches the gameplay question; `MASK_ALL` is rarely the best production choice.

### `ClipRayToEntity(Ray, unContentsMask, EntityValue, TraceTarget = null)`

Clips a ray against one entity without broad-phase selection. The entity must expose a valid native handle.

The native index and serial are copied before any `Ray` property or component getters run. After ray, mask, and target validation, SourceJS resolves the current entity address for that same identity instead of reusing the pre-getter address. Removal, a freed edict, an invalid handle, missing native entity data, or slot reuse with a different serial throws before SDK dispatch. The user-supplied entity index is read only once. Original getter exceptions propagate unchanged; getter side effects are not rolled back. This identity check does not add a requirement for `ICollideable`.

```js
const { ClipRayToEntity, ContentMasks } = require("engines/trace");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_Prop = Entity(7);
if (!g_Prop) {
	throw new Error("Entity 7 is unavailable.");
}

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 512, Y: 0, Z: 64 },
};
const g_TraceResult = ClipRayToEntity(g_Ray, ContentMasks.Shot, g_Prop);
if (!g_TraceResult) {
	throw new Error("ClipRayToEntity() did not return a trace result.");
}

LogInfo("%j", { Operation: "ClipEntityRay", Fraction: g_TraceResult.Fraction });
```

### `ClipRayToCollideable(Ray, unContentsMask, EntityValue, TraceTarget = null)`

Uses the entity's `ICollideable`. A valid entity without a collideable is an error for this operation. Its native handle must also be valid.

The owner index and serial are copied before `Ray` property or component getters. After input validation, SourceJS resolves a fresh collideable only for that same native identity. Removal, slot reuse with a different serial, an invalid handle, or a missing collideable throws before SDK dispatch. Replacing only the collideable while retaining the entity identity uses the fresh collideable. The user-supplied entity index is read only once; original getter exceptions and getter side effects are preserved.

```js
const { ClipRayToCollideable, ContentMasks } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_TargetPlayer = Player(2);
if (!g_TargetPlayer) {
	throw new Error("Player 2 is unavailable.");
}

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 512, Y: 0, Z: 64 },
};
const g_TraceResult = ClipRayToCollideable(g_Ray, ContentMasks.Shot, g_TargetPlayer);
if (!g_TraceResult) {
	throw new Error("ClipRayToCollideable() did not return a trace result.");
}

if (g_TraceResult.Hit) {
	LogInfo("%j", { Operation: "ClipCollideableRay", Hitbox: g_TraceResult.Hitbox, HitGroup: g_TraceResult.HitGroup });
}
```

### `SweepCollideable(EntityValue, StartPosition, EndPosition, SweepAngles, unContentsMask, FilterValue = null, TraceTarget = null)`

Sweeps a valid entity's `ICollideable` between positions at the supplied `QAngle`-compatible rotation. Entity or collideable resolution failure is an error. The operation is useful for validating a planned move before changing the entity origin.

The owner must expose a valid native handle. Its index and serial are copied before reading `StartPosition`, `EndPosition`, or `SweepAngles` components. After input and filter preparation, SourceJS resolves a fresh collideable for that same identity immediately before SDK dispatch. Removal, slot reuse with a different serial, an invalid handle, or a missing collideable throws before dispatch; replacing only the collideable while preserving the owner identity uses the fresh collideable. The user-supplied entity index is read only once. Original preparation-callback exceptions propagate unchanged, and completed side effects are not rolled back.

This preparation-time check does not keep the entity alive during the native query. Do not destroy or replace the swept entity or its collideable inside callbacks invoked by an active SDK query: the SDK can still be using that borrowed object.

```js
const { ContentMasks, GetCollideable, SweepCollideable } = require("engines/trace");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_Prop = Entity(7);
if (!g_Prop) {
	throw new Error("Entity 7 is unavailable.");
}

const g_PropCollideable = GetCollideable(g_Prop);
if (g_PropCollideable === undefined) {
	throw new Error("GetCollideable() did not return a result.");
}

if (!g_PropCollideable) {
	throw new Error("Entity 7 has no ICollideable.");
}

const g_StartPosition = { X: 320, Y: 0, Z: 0 };
const g_EndPosition = { X: 512, Y: 0, Z: 0 };
const g_SweepAngles = { Pitch: 0, Yaw: 90, Roll: 0 };
const g_TraceResult = SweepCollideable(g_Prop, g_StartPosition, g_EndPosition, g_SweepAngles, ContentMasks.Solid);
if (!g_TraceResult) {
	throw new Error("SweepCollideable() did not return a trace result.");
}

LogInfo("%j", { Operation: "SweepCollideable", Blocked: g_TraceResult.Hit, StopPosition: g_TraceResult.EndPosition });
```

The angles value uses the same finite array/object vector contract as positions; the `Pitch`, `Yaw`, and `Roll` aliases are useful for rotations. Filters and reusable targets follow the same contracts as `TraceRay`.

## Entity enumeration

Enumerator method lookups and callbacks preserve the original JavaScript error, including when a native C++ exception unwinds their handlers. Unexpected native exceptions without a pending JavaScript error become operation-specific errors; the enumeration fails rather than returning a partial success.

### `EnumerateEntities(Ray, bIncludeTriggers = false, EnumeratorValue = null)`

Enumerates entities intersecting the ray or swept hull. Set `bIncludeTriggers` to an actual boolean; `1`, `0`, and `null` are rejected.

```js
const { EnumerateEntities } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_unStopEntityIndex = 7;

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 0 },
	End: { X: 512, Y: 0, Z: 0 },
};
const g_ShouldContinueEnumeration = (EntityInformation) => {
	LogInfo("%j", { Operation: "VisitRayEntity", EntityIndex: EntityInformation.Index });

	return EntityInformation.Index !== g_unStopEntityIndex;
};

const g_vecVisitedEntityIndexes = EnumerateEntities(g_Ray, true, g_ShouldContinueEnumeration);
if (!Array.isArray(g_vecVisitedEntityIndexes)) {
	throw new Error("EnumerateEntities() did not return an index array.");
}

LogInfo("%j", { Operation: "EnumerateRayEntities", EntityIndexes: g_vecVisitedEntityIndexes });
```

### `EnumerateEntitiesInBox(MinimumBounds, MaximumBounds, EnumeratorValue = null)`

Enumerates entities overlapping an axis-aligned world-space box. Reversed component bounds are normalized natively:

```js
const { EnumerateEntitiesInBox } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_MinimumBounds = { X: -32, Y: -32, Z: -32 };
const g_MaximumBounds = { X: 200, Y: 32, Z: 96 };
const g_LoggingEntityEnumerator = {
	EnumEntity(EntityInformation) {
		LogInfo("%j", { Operation: "VisitBoxEntity", EntityIndex: EntityInformation.Index });

		return true;
	},
};

const g_vecOverlappingEntityIndexes = EnumerateEntitiesInBox(g_MinimumBounds, g_MaximumBounds, g_LoggingEntityEnumerator);
if (!Array.isArray(g_vecOverlappingEntityIndexes)) {
	throw new Error("EnumerateEntitiesInBox() did not return an index array.");
}

LogInfo("%j", { Operation: "EnumerateBoxEntities", EntityIndexes: g_vecOverlappingEntityIndexes });
```

Enumeration is a broad-phase query. Follow it with an entity property check, `ClipRayToEntity`, or a collideable test when exact geometry matters.

## World queries

### `IsPointOutsideWorld(Position)`

Calls `IEngineTrace::PointOutsideWorld` and returns a boolean.

### `GetLeafContainingPoint(Position)`

Returns the signed integer BSP leaf index containing the point. Leaf indexes are map-specific and become invalid after a map change:

```js
const { GetLeafContainingPoint, IsPointOutsideWorld } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_Position = { X: 64, Y: 32, Z: 16 };
const g_bOutsideWorld = IsPointOutsideWorld(g_Position);
LogInfo("%j", { Operation: "QueryWorldBounds", OutsideWorld: g_bOutsideWorld });

if (!g_bOutsideWorld) {
	const nLeafIndex = GetLeafContainingPoint(g_Position);
	LogInfo("%j", { Operation: "QueryBSPLeaf", LeafIndex: nLeafIndex });
}
```

## Practical workflows

### World-only visibility

Use `TraceType.WorldOnly` when entities must not block a world-geometry line-of-sight check. This mode also excludes static props:

```js
const { ContentMasks, TraceType, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 1024, Y: 0, Z: 64 },
};
const g_TraceResult = TraceRay(g_Ray, ContentMasks.Visible, { TraceType: TraceType.WorldOnly });
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

LogInfo("%j", { Operation: "WorldVisibility", BlockedByWorld: g_TraceResult.HitWorld, Fraction: g_TraceResult.Fraction });
```

### Decode a player hitbox surface

After confirming `Hit`, treat `Surface.Flags` and `Contents` as bit sets. Test bits instead of comparing the whole integer:

```js
const { ContentFlags, ContentMasks, ClipRayToEntity, SurfaceFlags } = require("engines/trace");
const { LogInfo } = require("loggers");
const { Player } = require("players/entity");

const g_TargetPlayer = Player(2);
if (!g_TargetPlayer) {
	throw new Error("Player 2 is unavailable.");
}

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 64 },
	End: { X: 512, Y: 0, Z: 64 },
};
const g_TraceResult = ClipRayToEntity(g_Ray, ContentMasks.Shot, g_TargetPlayer);
if (!g_TraceResult) {
	throw new Error("ClipRayToEntity() did not return a trace result.");
}

if (g_TraceResult.Hit) {
	const bHitStudioHitbox = (g_TraceResult.Surface.Flags & SurfaceFlags.Hitbox) !== 0;
	const bHitHitboxContents = (g_TraceResult.Contents & ContentFlags.Hitbox) !== 0;
	LogInfo("%j", {
		Operation: "DecodeHitboxSurface",
		HitboxContents: bHitHitboxContents,
		StudioHitbox: bHitStudioHitbox,
		Hitbox: g_TraceResult.Hitbox,
	});
}
```

### Decode displacement properties

After confirming `Hit`, treat displacement flags as independent bits:

```js
const { ContentMasks, DisplacementFlags, TraceType, TraceRay } = require("engines/trace");
const { LogInfo } = require("loggers");

const g_Ray = {
	Start: { X: 0, Y: 0, Z: 256 },
	End: { X: 0, Y: 0, Z: -256 },
};
const g_TraceResult = TraceRay(g_Ray, ContentMasks.Solid, { TraceType: TraceType.WorldOnly });
if (!g_TraceResult) {
	throw new Error("TraceRay() did not return a trace result.");
}

if (g_TraceResult.Hit) {
	const bIsDisplacement = (g_TraceResult.DisplacementFlags & DisplacementFlags.Surface) !== 0;
	const bIsWalkable = (g_TraceResult.DisplacementFlags & DisplacementFlags.Walkable) !== 0;
	LogInfo("%j", { Operation: "DecodeDisplacement", IsDisplacement: bIsDisplacement, IsWalkable: bIsWalkable });
}
```

### Broad phase followed by collideable resolution

Resolve collideable descriptors only for the current operation. Their `BigInt` `Address` field is output-only metadata and is not accepted by trace APIs. The diagnostic uses hexadecimal strings without changing the borrowed-address records:

```js
const { EnumerateEntitiesInBox, GetCollideable } = require("engines/trace");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_MinimumBounds = { X: -64, Y: -64, Z: -64 };
const g_MaximumBounds = { X: 384, Y: 64, Z: 128 };
const g_vecEntityIndexes = EnumerateEntitiesInBox(g_MinimumBounds, g_MaximumBounds);
if (!Array.isArray(g_vecEntityIndexes)) {
	throw new Error("EnumerateEntitiesInBox() did not return an index array.");
}

const g_ResolveCollideable = (unEntityIndex) => {
	const ResolvedEntity = Entity(unEntityIndex);
	if (!ResolvedEntity) {
		return null;
	}

	const Collideable = GetCollideable(ResolvedEntity);
	if (Collideable === undefined) {
		throw new Error("GetCollideable() did not return a result.");
	}

	return Collideable;
};

const g_IsCollideableAvailable = (Collideable) => Collideable !== null;
const g_FormatCollideable = (Collideable) => ({ EntityIndex: Collideable.EntityIndex, Address: `0x${Collideable.Address.toString(16).toUpperCase()}` });

const g_vecCollideables = g_vecEntityIndexes.map(g_ResolveCollideable).filter(g_IsCollideableAvailable);
LogInfo("%j", { Operation: "ResolveCollideables", Collideables: g_vecCollideables.map(g_FormatCollideable) });
```

## Lifecycle and safety

For `GetPointContents`, `GetPointContentsOfCollideable`, `TraceRay`, `ClipRayToEntity`, `ClipRayToCollideable`, `EnumerateEntities`, `EnumerateEntitiesInBox`, `GetCollideable`, `IsPointOutsideWorld`, `GetLeafContainingPoint`, and `SweepCollideable`, an error caught by an argument-lookup scope survives native C++ unwinding of that scope. Native failures without such a pending error become operation-specific errors. A failed argument lookup aborts the query before engine dispatch.

- Run trace operations on the server thread. Do not call `IEngineTrace` from arbitrary worker threads.
- Entity objects, handles, BSP leaf indexes, and collideable addresses can become invalid after deletion, disconnect, or map change.
- Treat `GetCollideable().Address` as a transient snapshot of a borrowed native address. Never deallocate it or use it as a stable identity.
- A trace result describes one completed native call. Run the query again for real-time state.
- Filter and enumerator callbacks execute synchronously inside the native trace. Keep them short and do not mutate the entity list while enumeration is active.
- Reuse a trace target only within one plugin context; do not share mutable result objects across isolated plugins.
- Prefer the narrowest named mask that answers the gameplay question.

## Common mistakes

- Using `{ Start, Delta }`; SourceJS rays require `{ Start, End }`.
- Supplying only one hull bound that the vector parser recognizes; `Minimums` and `Maximums` must either both parse as component-bearing vectors or both be absent.
- Returning `0`, `1`, an entity, or `undefined` from a filter/enumerator callback; the return must be boolean.
- Passing a negative, stale, or unresolved entity index; `EntityValue` accepts entity objects and non-negative indexes, but operations requiring a live entity still validate resolution.
- Reading legacy `m_*` or differently cased trace-result fields; exact names include `Plane.SignBits`, `HitGroup`, and `PhysicsBone`.
- Treating `GetPointContents()` as an integer or assuming a result always exists; check for a missing result before reading its integer `Contents` field.
- Treating a missing `GetCollideable()` result as normal absence: valid non-collideable entities return `null`, but checked record construction can return `undefined` without a pending exception.
- Keeping a collideable address or BSP leaf index across map transitions.
- Comparing an entire bit set to one flag instead of testing with `&`.
- Assuming old-console capability constants exist on every SDK branch.

## Related modules

- [`engines`](engines.md) exposes the smaller root trace surface.
- [`entities/entity`](entities-entity.md) and [`players/entity`](players-entity.md) provide lookup helpers and entity objects accepted wherever `EntityValue` is documented.
- [`mathlib`](mathlib.md) provides Vector objects accepted as ray and hull input values; trace-result vector fields are plain `{ X, Y, Z }` records.
