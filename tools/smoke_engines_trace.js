#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strTracePath = g_Path.join(g_strPackageRoot, "engines", "trace.js");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "engines-trace.md");

function ConvertToUnsigned32(nValue) {
	return nValue >>> 0;
}

const CONTENTS_EMPTY = 0x00;
const CONTENTS_SOLID = 0x1;
const CONTENTS_WINDOW = 0x2;
const CONTENTS_AUX = 0x4;
const CONTENTS_GRATE = 0x8;
const CONTENTS_SLIME = 0x10;
const CONTENTS_WATER = 0x20;
const CONTENTS_BLOCKLOS = 0x40;
const CONTENTS_OPAQUE = 0x80;
const CONTENTS_TESTFOGVOLUME = 0x100;
const LAST_VISIBLE_CONTENTS = CONTENTS_OPAQUE;
const ALL_VISIBLE_CONTENTS = LAST_VISIBLE_CONTENTS | (LAST_VISIBLE_CONTENTS - 1);
const CONTENTS_UNUSED = 0x200;
const CONTENTS_TEAM1 = 0x800;
const CONTENTS_TEAM2 = 0x1000;
const CONTENTS_IGNORE_NODRAW_OPAQUE = 0x2000;
const CONTENTS_MOVEABLE = 0x4000;
const CONTENTS_AREAPORTAL = 0x8000;
const CONTENTS_PLAYERCLIP = 0x10000;
const CONTENTS_MONSTERCLIP = 0x20000;
const CONTENTS_CURRENT_0 = 0x40000;
const CONTENTS_CURRENT_90 = 0x80000;
const CONTENTS_CURRENT_180 = 0x100000;
const CONTENTS_CURRENT_270 = 0x200000;
const CONTENTS_CURRENT_UP = 0x400000;
const CONTENTS_CURRENT_DOWN = 0x800000;
const CONTENTS_ORIGIN = 0x1000000;
const CONTENTS_MONSTER = 0x2000000;
const CONTENTS_DEBRIS = 0x4000000;
const CONTENTS_DETAIL = 0x8000000;
const CONTENTS_TRANSLUCENT = 0x10000000;
const CONTENTS_LADDER = 0x20000000;
const CONTENTS_HITBOX = 0x40000000;
const MAX_COORD_INTEGER = 16_384;
const MIN_COORD_INTEGER = -16_384;
const MAX_COORD_FRACTION = 0.9375;
const MIN_COORD_FRACTION = -0.9375;
const MAX_COORD_FLOAT = 16_384;
const MIN_COORD_FLOAT = -16_384;
const COORD_EXTENT = 32_768;
const MAX_TRACE_LENGTH = 1.732050807569 * COORD_EXTENT;
const MAX_COORD_RANGE = MAX_COORD_FLOAT;
const MASK_ALL = 0xFFFFFFFF;
const MASK_SOLID = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_WINDOW | CONTENTS_MONSTER | CONTENTS_GRATE);
const MASK_PLAYERSOLID = ConvertToUnsigned32(MASK_SOLID | CONTENTS_PLAYERCLIP);
const MASK_NPCSOLID = ConvertToUnsigned32(MASK_SOLID | CONTENTS_MONSTERCLIP);
const MASK_WATER = ConvertToUnsigned32(CONTENTS_WATER | CONTENTS_MOVEABLE | CONTENTS_SLIME);
const MASK_OPAQUE = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_OPAQUE);
const MASK_OPAQUE_AND_NPCS = ConvertToUnsigned32(MASK_OPAQUE | CONTENTS_MONSTER);
const MASK_BLOCKLOS = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_BLOCKLOS);
const MASK_BLOCKLOS_AND_NPCS = ConvertToUnsigned32(MASK_BLOCKLOS | CONTENTS_MONSTER);
const MASK_VISIBLE = ConvertToUnsigned32(MASK_OPAQUE | CONTENTS_IGNORE_NODRAW_OPAQUE);
const MASK_VISIBLE_AND_NPCS = ConvertToUnsigned32(MASK_OPAQUE_AND_NPCS | CONTENTS_IGNORE_NODRAW_OPAQUE);
const MASK_SHOT = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_MONSTER | CONTENTS_WINDOW | CONTENTS_DEBRIS | CONTENTS_HITBOX);
const MASK_SHOT_HULL = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_MONSTER | CONTENTS_WINDOW | CONTENTS_DEBRIS | CONTENTS_GRATE);
const MASK_SHOT_PORTAL = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_WINDOW | CONTENTS_MONSTER);
const MASK_SOLID_BRUSHONLY = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_MOVEABLE | CONTENTS_WINDOW | CONTENTS_GRATE);
const MASK_PLAYERSOLID_BRUSHONLY = ConvertToUnsigned32(MASK_SOLID_BRUSHONLY | CONTENTS_PLAYERCLIP);
const MASK_NPCWORLDSTATIC = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_WINDOW | CONTENTS_MONSTERCLIP | CONTENTS_GRATE);
const MASK_SPLITAREAPORTAL = ConvertToUnsigned32(CONTENTS_WATER | CONTENTS_SLIME);
const MASK_CURRENT = ConvertToUnsigned32(CONTENTS_CURRENT_0 | CONTENTS_CURRENT_90 | CONTENTS_CURRENT_180 | CONTENTS_CURRENT_270 | CONTENTS_CURRENT_UP | CONTENTS_CURRENT_DOWN);
const MASK_DEADSOLID = ConvertToUnsigned32(CONTENTS_SOLID | CONTENTS_PLAYERCLIP | CONTENTS_WINDOW | CONTENTS_GRATE);

// Exact values from the selected L4D2 SDK, including its decimal diagonal approximation.
g_Assert.equal(ALL_VISIBLE_CONTENTS, 0x000000FF);
g_Assert.equal(MAX_TRACE_LENGTH, 56755.84086242099);

const g_TraceType = {
	Everything: 0,
	WorldOnly: 1,
	EntitiesOnly: 2,
	EverythingFilterProperties: 3,
};

const g_DisplacementFlags = {
	Surface: 0x01,
	Walkable: 0x02,
	Buildable: 0x04,
	SurfaceProperty1: 0x08,
	SurfaceProperty2: 0x10,
};

const g_SurfaceFlags = {
	Light: 0x1,
	Sky2D: 0x2,
	Sky: 0x4,
	Warp: 0x8,
	Translucent: 0x10,
	NoPortal: 0x20,
	Trigger: 0x40,
	NoDraw: 0x80,
	Hint: 0x100,
	Skip: 0x200,
	NoLight: 0x400,
	BumpLight: 0x800,
	NoShadows: 0x1000,
	NoDecals: 0x2000,
	NoChop: 0x4000,
	Hitbox: 0x8000,
};

const g_ContentFlags = {
	Empty: CONTENTS_EMPTY,
	Solid: CONTENTS_SOLID,
	Window: CONTENTS_WINDOW,
	Auxiliary: CONTENTS_AUX,
	Grate: CONTENTS_GRATE,
	Slime: CONTENTS_SLIME,
	Water: CONTENTS_WATER,
	BlockLineOfSight: CONTENTS_BLOCKLOS,
	Opaque: CONTENTS_OPAQUE,
	LastVisible: LAST_VISIBLE_CONTENTS,
	AllVisible: ALL_VISIBLE_CONTENTS,
	TestFogVolume: CONTENTS_TESTFOGVOLUME,
	Unused: CONTENTS_UNUSED,
	Team1: CONTENTS_TEAM1,
	Team2: CONTENTS_TEAM2,
	IgnoreNoDrawOpaque: CONTENTS_IGNORE_NODRAW_OPAQUE,
	Moveable: CONTENTS_MOVEABLE,
	AreaPortal: CONTENTS_AREAPORTAL,
	PlayerClip: CONTENTS_PLAYERCLIP,
	MonsterClip: CONTENTS_MONSTERCLIP,
	Current0: CONTENTS_CURRENT_0,
	Current90: CONTENTS_CURRENT_90,
	Current180: CONTENTS_CURRENT_180,
	Current270: CONTENTS_CURRENT_270,
	CurrentUp: CONTENTS_CURRENT_UP,
	CurrentDown: CONTENTS_CURRENT_DOWN,
	Origin: CONTENTS_ORIGIN,
	Monster: CONTENTS_MONSTER,
	Debris: CONTENTS_DEBRIS,
	Detail: CONTENTS_DETAIL,
	Translucent: CONTENTS_TRANSLUCENT,
	Ladder: CONTENTS_LADDER,
	Hitbox: CONTENTS_HITBOX,
};

const g_ContentMasks = {
	All: MASK_ALL,
	Solid: MASK_SOLID,
	PlayerSolid: MASK_PLAYERSOLID,
	NPCSolid: MASK_NPCSOLID,
	Water: MASK_WATER,
	Opaque: MASK_OPAQUE,
	OpaqueAndNPCs: MASK_OPAQUE_AND_NPCS,
	BlockLineOfSight: MASK_BLOCKLOS,
	BlockLineOfSightAndNPCs: MASK_BLOCKLOS_AND_NPCS,
	Visible: MASK_VISIBLE,
	VisibleAndNPCs: MASK_VISIBLE_AND_NPCS,
	Shot: MASK_SHOT,
	ShotHull: MASK_SHOT_HULL,
	ShotPortal: MASK_SHOT_PORTAL,
	SolidBrushOnly: MASK_SOLID_BRUSHONLY,
	PlayerSolidBrushOnly: MASK_PLAYERSOLID_BRUSHONLY,
	NPCWorldStatic: MASK_NPCWORLDSTATIC,
	SplitAreaPortal: MASK_SPLITAREAPORTAL,
	Current: MASK_CURRENT,
	DeadSolid: MASK_DEADSOLID,
};

const g_vecExpectedExports = [
	"ALL_VISIBLE_CONTENTS",
	"COORD_EXTENT",
	"CONTENTS_AREAPORTAL",
	"CONTENTS_AUX",
	"CONTENTS_BLOCKLOS",
	"CONTENTS_CURRENT_0",
	"CONTENTS_CURRENT_180",
	"CONTENTS_CURRENT_270",
	"CONTENTS_CURRENT_90",
	"CONTENTS_CURRENT_DOWN",
	"CONTENTS_CURRENT_UP",
	"CONTENTS_DEBRIS",
	"CONTENTS_DETAIL",
	"CONTENTS_EMPTY",
	"CONTENTS_GRATE",
	"CONTENTS_HITBOX",
	"CONTENTS_IGNORE_NODRAW_OPAQUE",
	"CONTENTS_LADDER",
	"CONTENTS_MONSTER",
	"CONTENTS_MONSTERCLIP",
	"CONTENTS_MOVEABLE",
	"CONTENTS_OPAQUE",
	"CONTENTS_ORIGIN",
	"CONTENTS_PLAYERCLIP",
	"CONTENTS_SLIME",
	"CONTENTS_SOLID",
	"CONTENTS_TEAM1",
	"CONTENTS_TEAM2",
	"CONTENTS_TESTFOGVOLUME",
	"CONTENTS_TRANSLUCENT",
	"CONTENTS_UNUSED",
	"CONTENTS_WATER",
	"CONTENTS_WINDOW",
	"ContentFlags",
	"ContentMasks",
	"DisplacementFlags",
	"LAST_VISIBLE_CONTENTS",
	"MASK_ALL",
	"MASK_BLOCKLOS",
	"MASK_BLOCKLOS_AND_NPCS",
	"MASK_CURRENT",
	"MASK_DEADSOLID",
	"MASK_NPCSOLID",
	"MASK_NPCWORLDSTATIC",
	"MASK_OPAQUE",
	"MASK_OPAQUE_AND_NPCS",
	"MASK_PLAYERSOLID",
	"MASK_PLAYERSOLID_BRUSHONLY",
	"MASK_SHOT",
	"MASK_SHOT_HULL",
	"MASK_SHOT_PORTAL",
	"MASK_SOLID",
	"MASK_SOLID_BRUSHONLY",
	"MASK_SPLITAREAPORTAL",
	"MASK_VISIBLE",
	"MASK_VISIBLE_AND_NPCS",
	"MASK_WATER",
	"MAX_COORD_FLOAT",
	"MAX_COORD_FRACTION",
	"MAX_COORD_INTEGER",
	"MAX_COORD_RANGE",
	"MAX_TRACE_LENGTH",
	"MIN_COORD_FLOAT",
	"MIN_COORD_FRACTION",
	"MIN_COORD_INTEGER",
	"SurfaceFlags",
	"TraceType",
	"ClipRayToCollideable",
	"ClipRayToEntity",
	"EnumerateEntities",
	"EnumerateEntitiesInBox",
	"GetCollideable",
	"GetLeafContainingPoint",
	"GetPointContents",
	"GetPointContentsOfCollideable",
	"IsPointOutsideWorld",
	"SweepCollideable",
	"TraceRay",
].sort();

const g_vecNativeCalls = [];
const g_mapEntities = new Map([
	[0, {
		ClassName: "worldspawn",
		CollideableAddress: 0x1000n,
		Exists: true,
		Handle: 1000,
		Index: 0,
		IsPlayer: false,
		Origin: { X: 0, Y: 0, Z: 0 },
	}],
	[1, {
		ClassName: "player",
		CollideableAddress: 0x1100n,
		Exists: true,
		Handle: 1001,
		Index: 1,
		IsPlayer: true,
		Origin: { X: 0, Y: 0, Z: 0 },
	}],
	[2, {
		ClassName: "player",
		CollideableAddress: 0x1200n,
		Exists: true,
		Handle: 1002,
		Index: 2,
		IsPlayer: true,
		Origin: { X: 160, Y: 0, Z: 0 },
	}],
	[4, {
		ClassName: "info_target",
		CollideableAddress: 0n,
		Exists: true,
		Handle: 1004,
		Index: 4,
		IsPlayer: false,
		Origin: { X: 32, Y: 32, Z: 32 },
	}],
	[7, {
		ClassName: "prop_physics",
		CollideableAddress: 0x1700n,
		Exists: true,
		Handle: 1007,
		Index: 7,
		IsPlayer: false,
		Origin: { X: 320, Y: 0, Z: 0 },
	}],
	[9, {
		ClassName: "trigger_multiple",
		CollideableAddress: 0x1900n,
		Exists: true,
		Handle: 1009,
		Index: 9,
		IsPlayer: false,
		Origin: { X: 96, Y: 32, Z: 0 },
	}],
]);

g_Assert.deepEqual([...g_mapEntities.values()].map((EntityRecord) => EntityRecord.CollideableAddress), [0x1000n, 0x1100n, 0x1200n, 0n, 0x1700n, 0x1900n], "collideable fixture addresses must be exact BigInt values, including null");

function RequirePlainObject(ObjectValue, strOperationName) {
	if ((ObjectValue === null) || (typeof ObjectValue !== "object") || Array.isArray(ObjectValue)) {
		throw new TypeError(`${strOperationName} expects an object.`);
	}

	return ObjectValue;
}

function RequireFiniteNumber(dblValue, strOperationName) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
		throw new TypeError(`${strOperationName} expects a finite number.`);
	}

	return dblValue;
}

function RequireInteger(nValue, strOperationName) {
	if (!Number.isSafeInteger(nValue)) {
		throw new TypeError(`${strOperationName} expects an integer.`);
	}

	return nValue;
}

function RequireUnsigned(unValue, strOperationName) {
	if (!Number.isSafeInteger(unValue) || (unValue < 0) || (unValue > MASK_ALL)) {
		throw new TypeError(`${strOperationName} expects an unsigned 32-bit integer.`);
	}

	return unValue;
}

function RequireVector(VectorValue, strOperationName) {
	if ((VectorValue === null) || (typeof VectorValue !== "object")) {
		throw new TypeError(`${strOperationName} expects an object.`);
	}

	const VectorRecord = Array.isArray(VectorValue) ? { X: VectorValue[0], Y: VectorValue[1], Z: VectorValue[2] } : VectorValue;
	const flX = VectorRecord.X ?? VectorRecord.Pitch;
	const flY = VectorRecord.Y ?? VectorRecord.Yaw;
	const flZ = VectorRecord.Z ?? VectorRecord.Roll;
	if ((flX === undefined) && (flY === undefined) && (flZ === undefined)) {
		throw new TypeError(`${strOperationName} must provide at least one component.`);
	}

	return {
		X: RequireFiniteNumber(flX ?? 0, `${strOperationName}.X`),
		Y: RequireFiniteNumber(flY ?? 0, `${strOperationName}.Y`),
		Z: RequireFiniteNumber(flZ ?? 0, `${strOperationName}.Z`),
	};
}

function IsRayGeometrySafe(Ray) {
	const flMaximumFloat = 3.4028234663852886e38;
	const IsFiniteFloatValue = (dblValue) => Number.isFinite(dblValue) && (Math.abs(dblValue) <= flMaximumFloat);
	for (const strComponent of ["X", "Y", "Z"]) {
		const flStart = Math.fround(Ray.Start[strComponent]);
		const flEnd = Math.fround(Ray.End[strComponent]);
		if (!IsFiniteFloatValue(flEnd - flStart)) {
			return false;
		}

		if (Ray.Minimums !== undefined) {
			const flMinimum = Math.fround(Ray.Minimums[strComponent]);
			const flMaximum = Math.fround(Ray.Maximums[strComponent]);
			const dblExtent = flMaximum - flMinimum;
			const dblBoundsSum = flMinimum + flMaximum;
			if (!IsFiniteFloatValue(dblExtent) || !IsFiniteFloatValue(dblBoundsSum)) {
				return false;
			}

			const dblStartOffset = Math.fround(dblBoundsSum) * 0.5;
			if (!IsFiniteFloatValue(flStart + dblStartOffset)) {
				return false;
			}
		}
	}

	return true;
}

function RequireRay(RayValue, strOperationName) {
	const Ray = RequirePlainObject(RayValue, strOperationName);
	const bHasMinimums = Object.hasOwn(Ray, "Minimums");
	const bHasMaximums = Object.hasOwn(Ray, "Maximums");
	if (bHasMinimums !== bHasMaximums) {
		throw new TypeError(`${strOperationName} Minimums and Maximums must be provided together.`);
	}

	const NormalizedRay = {
		End: RequireVector(Ray.End, `${strOperationName}.End`),
		Start: RequireVector(Ray.Start, `${strOperationName}.Start`),
	};
	if (bHasMinimums) {
		NormalizedRay.Minimums = RequireVector(Ray.Minimums, `${strOperationName}.Minimums`);
		NormalizedRay.Maximums = RequireVector(Ray.Maximums, `${strOperationName}.Maximums`);
	}

	if (!IsRayGeometrySafe(NormalizedRay)) {
		throw new RangeError(strOperationName + " derived coordinates exceed the finite float range.");
	}

	return NormalizedRay;
}

function RequireEntity(EntityValue, strOperationName) {
	const EntityRecord = RequirePlainObject(EntityValue, strOperationName);
	const unEntityIndex = RequireInteger(EntityRecord.Index, `${strOperationName}.Index`);
	const Entity = g_mapEntities.get(unEntityIndex);
	if ((Entity === undefined) || !Entity.Exists) {
		throw new RangeError(`${strOperationName} expects an existing entity.`);
	}

	return Entity;
}

function TraceEntity(Entity) {
	return {
		Exists: Entity.Exists,
		Handle: Entity.Handle,
		Index: Entity.Index,
	};
}

function NormalizeIgnoreList(IgnoreValue, strOperationName) {
	if ((IgnoreValue === null) || (IgnoreValue === undefined)) {
		return new Set();
	}

	const vecValues = Array.isArray(IgnoreValue) ? IgnoreValue : [IgnoreValue];

	return new Set(vecValues.map((EntityValue) => RequireEntity(EntityValue, strOperationName).Index));
}

function NormalizeTraceFilter(FilterValue, strOperationName) {
	if ((FilterValue === null) || (FilterValue === undefined)) {
		return {
			Ignore: new Set(),
			ShouldHitEntity: null,
			TraceType: g_TraceType.Everything,
		};
	}

	if (Array.isArray(FilterValue)) {
		return {
			Ignore: NormalizeIgnoreList(FilterValue, `${strOperationName}.Ignore`),
			ShouldHitEntity: null,
			TraceType: g_TraceType.Everything,
		};
	}

	if (typeof FilterValue === "function") {
		return {
			Ignore: new Set(),
			ShouldHitEntity: FilterValue,
			TraceType: g_TraceType.Everything,
		};
	}

	const Filter = RequirePlainObject(FilterValue, strOperationName);
	const ShouldHitEntity = Filter.ShouldHitEntity;
	if ((ShouldHitEntity !== null) && (ShouldHitEntity !== undefined) && (typeof ShouldHitEntity !== "function")) {
		throw new TypeError(`${strOperationName}.ShouldHitEntity expects a function.`);
	}

	let nTraceType = g_TraceType.Everything;
	const TraceTypeValue = Filter.TraceType;
	if ((TraceTypeValue !== null) && (TraceTypeValue !== undefined)) {
		nTraceType = RequireInteger(TraceTypeValue, `${strOperationName}.TraceType`);
	} else {
		const GetTraceType = Filter.GetTraceType;
		if ((GetTraceType !== null) && (GetTraceType !== undefined)) {
			if (typeof GetTraceType !== "function") {
				throw new TypeError(`${strOperationName}.GetTraceType expects a function.`);
			}

			nTraceType = RequireInteger(GetTraceType.call(Filter), `${strOperationName}.GetTraceType()`);
		}
	}

	if (!Object.values(g_TraceType).includes(nTraceType)) {
		throw new RangeError(`${strOperationName}.TraceType expects a supported native trace type.`);
	}

	return {
		Ignore: NormalizeIgnoreList(Filter.Ignore, `${strOperationName}.Ignore`),
		ShouldHitEntity: ((ShouldHitEntity === null) || (ShouldHitEntity === undefined)) ? null : ShouldHitEntity.bind(Filter),
		TraceType: nTraceType,
	};
}

function VerifyTraceFilterPropertySnapshot() {
	for (const strProperty of ["ShouldHitEntity", "TraceType", "GetTraceType"]) {
		for (const strMode of ["Present", "Null", "Undefined"]) {
			const Filter = {};
			let unReads = 0;
			const Callback = function() {
				g_Assert.equal(this, Filter);

				return (strProperty === "GetTraceType") ? 2 : false;
			};
			Object.defineProperty(Filter, strProperty, {
				get() {
					if (++unReads > 1) {
						throw new Error("Trace filter repeated property getter.");
					}

					return (strMode === "Null") ? null : ((strMode === "Undefined") ? undefined : ((strProperty === "TraceType") ? 1 : Callback));
				},
			});
			const Normalized = NormalizeTraceFilter(Filter, "Trace snapshot");
			const nExpectedTraceType = (strMode === "Present") ? ((strProperty === "TraceType") ? 1 : ((strProperty === "GetTraceType") ? 2 : 0)) : 0;
			g_Assert.equal(Normalized.TraceType, nExpectedTraceType);

			if ((strMode === "Present") && (strProperty === "ShouldHitEntity")) {
				g_Assert.equal(Normalized.ShouldHitEntity({}, 0), false);

			} else {
				g_Assert.equal(Normalized.ShouldHitEntity, null);
			}

			g_Assert.equal(unReads, 1);
		}

		for (const Original of [undefined, null, Symbol("trace getter"), new Error("Original trace getter")]) {
			const Filter = {};
			Object.defineProperty(Filter, strProperty, {
				get() {
					throw Original;
				},
			});
			let bCaught = false;
			try {
				NormalizeTraceFilter(Filter, "Trace snapshot failure");
			} catch (Failure) {
				bCaught = true;
				g_Assert.strictEqual(Failure, Original);
			}

			g_Assert.equal(bCaught, true);
		}
	}

	const Precedence = {
		TraceType: 1,
		get GetTraceType() {
			throw new Error("Do not read a lower-precedence trace type source.");
		},
	};
	g_Assert.equal(NormalizeTraceFilter(Precedence, "Trace snapshot precedence").TraceType, 1);
}

VerifyTraceFilterPropertySnapshot();

function VerifyTraceRayDerivedCoordinates() {
	const flMaximumFloat = 3.4028234663852886e38;
	const MakeVector = (strComponent, flValue) => ({ X: 0, Y: 0, Z: 0, [strComponent]: flValue });
	for (const strComponent of ["X", "Y", "Z"]) {
		const Zero = MakeVector(strComponent, 0);
		const Positive = MakeVector(strComponent, flMaximumFloat);
		const Negative = MakeVector(strComponent, -flMaximumFloat);
		const Quarter = MakeVector(strComponent, flMaximumFloat / 4);
		const NegativeQuarter = MakeVector(strComponent, -flMaximumFloat / 4);
		for (const Ray of [
			{ Start: Negative, End: Positive },
			{ Start: Zero, End: Zero, Minimums: Negative, Maximums: Positive },
			{ Start: Zero, End: Zero, Minimums: Positive, Maximums: Positive },
			{ Start: Positive, End: Positive, Minimums: Quarter, Maximums: Quarter },
		]) {
			g_Assert.throws(() => RequireRay(Ray, "Ray range"), /derived coordinates/);
		}

		for (const Ray of [
			{ Start: Positive, End: Positive },
			{ Start: Zero, End: Quarter },
			{ Start: Zero, End: Zero, Minimums: NegativeQuarter, Maximums: Quarter },
			{ Start: Zero, End: Zero, Minimums: MakeVector(strComponent, 4), Maximums: MakeVector(strComponent, -4) },
		]) {
			g_Assert.doesNotThrow(() => RequireRay(Ray, "Safe ray range"));
		}
	}
}

VerifyTraceRayDerivedCoordinates();

function FilterAcceptsEntity(Filter, Entity, unMask, strOperationName) {
	if (Filter.Ignore.has(Entity.Index)) {
		return false;
	}

	if (!Filter.ShouldHitEntity) {
		return true;
	}

	const bShouldHit = Filter.ShouldHitEntity(TraceEntity(Entity), unMask);
	if (typeof bShouldHit !== "boolean") {
		throw new TypeError(`${strOperationName}.ShouldHitEntity must return a boolean.`);
	}

	return bShouldHit;
}

function SelectTraceEntity(Filter, unMask, strOperationName) {
	if (Filter.TraceType === g_TraceType.WorldOnly) {
		return g_mapEntities.get(0);
	}

	for (const unEntityIndex of [2, 7]) {
		const Entity = g_mapEntities.get(unEntityIndex);
		if (FilterAcceptsEntity(Filter, Entity, unMask, strOperationName)) {
			return Entity;
		}
	}

	return (Filter.TraceType === g_TraceType.EntitiesOnly) ? null : g_mapEntities.get(0);
}

function ResolveResultTarget(TargetValue, strOperationName) {
	if ((TargetValue === null) || (TargetValue === undefined)) {
		return {};
	}

	return RequirePlainObject(TargetValue, strOperationName);
}

function Interpolate(Start, End, flFraction) {
	return {
		X: Start.X + (End.X - Start.X) * flFraction,
		Y: Start.Y + (End.Y - Start.Y) * flFraction,
		Z: Start.Z + (End.Z - Start.Z) * flFraction,
	};
}

function PopulateTraceResult(Ray, unMask, Entity, Target, flFraction = 0.35) {
	const bHit = Entity !== null;
	const bHitWorld = bHit && (Entity.Index === 0);
	const bHitPlayer = bHit && Entity.IsPlayer;

	Object.assign(Target, {
		AllSolid: false,
		DisplacementFlags: bHitWorld ? (g_DisplacementFlags.Surface | g_DisplacementFlags.Walkable) : 0x00,
		EndPosition: Interpolate(Ray.Start, Ray.End, bHit ? flFraction : 1),
		Entity: bHit ? Entity : null,
		EntityIndex: bHit ? Entity.Index : -1,
		Fraction: bHit ? flFraction : 1,
		FractionLeftSolid: 0,
		Hit: bHit,
		HitGroup: bHitPlayer ? 1 : 0,
		HitNonWorldEntity: bHit && !bHitWorld,
		HitWorld: bHitWorld,
		Hitbox: bHitPlayer ? 3 : -1,
		PhysicsBone: bHitPlayer ? 0 : -1,
		Plane: {
			Distance: 128,
			Normal: { X: -1, Y: 0, Z: 0 },
			SignBits: 0x01,
			Type: 0,
		},
		StartPosition: { ...Ray.Start },
		StartSolid: false,
		Surface: {
			Flags: bHitPlayer ? g_SurfaceFlags.Hitbox : 0x00,
			Name: bHitPlayer ? "flesh" : "concrete",
			SurfaceProperties: bHitPlayer ? 2 : 5,
		},
		Contents: unMask,
	});

	return Target;
}

function NormalizeEnumerator(EnumeratorValue, strOperationName) {
	if ((EnumeratorValue === null) || (EnumeratorValue === undefined)) {
		return null;
	}

	if (typeof EnumeratorValue === "function") {
		return EnumeratorValue;
	}

	const Enumerator = RequirePlainObject(EnumeratorValue, strOperationName);
	const EnumEntity = Enumerator.EnumEntity;
	if (typeof EnumEntity !== "function") {
		throw new TypeError(`${strOperationName}.EnumEntity expects a function.`);
	}

	return EnumEntity.bind(Enumerator);
}

function EnumerateIndexes(vecIndexes, EnumeratorValue, strOperationName) {
	const Enumerator = NormalizeEnumerator(EnumeratorValue, strOperationName);
	const vecVisitedIndexes = [];
	for (const unEntityIndex of vecIndexes) {
		const Entity = g_mapEntities.get(unEntityIndex);

		vecVisitedIndexes.push(unEntityIndex);

		if (Enumerator) {
			const bShouldContinue = Enumerator(TraceEntity(Entity));
			if (typeof bShouldContinue !== "boolean") {
				throw new TypeError(`${strOperationName} callback must return a boolean.`);
			}

			if (!bShouldContinue) {
				break;
			}
		}
	}

	return vecVisitedIndexes;
}

const g_NativeTrace = {
	ALL_VISIBLE_CONTENTS,
	COORD_EXTENT,
	CONTENTS_AREAPORTAL,
	CONTENTS_AUX,
	CONTENTS_BLOCKLOS,
	CONTENTS_CURRENT_0,
	CONTENTS_CURRENT_180,
	CONTENTS_CURRENT_270,
	CONTENTS_CURRENT_90,
	CONTENTS_CURRENT_DOWN,
	CONTENTS_CURRENT_UP,
	CONTENTS_DEBRIS,
	CONTENTS_DETAIL,
	CONTENTS_EMPTY,
	CONTENTS_GRATE,
	CONTENTS_HITBOX,
	CONTENTS_IGNORE_NODRAW_OPAQUE,
	CONTENTS_LADDER,
	CONTENTS_MONSTER,
	CONTENTS_MONSTERCLIP,
	CONTENTS_MOVEABLE,
	CONTENTS_OPAQUE,
	CONTENTS_ORIGIN,
	CONTENTS_PLAYERCLIP,
	CONTENTS_SLIME,
	CONTENTS_SOLID,
	CONTENTS_TEAM1,
	CONTENTS_TEAM2,
	CONTENTS_TESTFOGVOLUME,
	CONTENTS_TRANSLUCENT,
	CONTENTS_UNUSED,
	CONTENTS_WATER,
	CONTENTS_WINDOW,
	ContentFlags: g_ContentFlags,
	ContentMasks: g_ContentMasks,
	DisplacementFlags: g_DisplacementFlags,
	LAST_VISIBLE_CONTENTS,
	MASK_ALL,
	MASK_BLOCKLOS,
	MASK_BLOCKLOS_AND_NPCS,
	MASK_CURRENT,
	MASK_DEADSOLID,
	MASK_NPCSOLID,
	MASK_NPCWORLDSTATIC,
	MASK_OPAQUE,
	MASK_OPAQUE_AND_NPCS,
	MASK_PLAYERSOLID,
	MASK_PLAYERSOLID_BRUSHONLY,
	MASK_SHOT,
	MASK_SHOT_HULL,
	MASK_SHOT_PORTAL,
	MASK_SOLID,
	MASK_SOLID_BRUSHONLY,
	MASK_SPLITAREAPORTAL,
	MASK_VISIBLE,
	MASK_VISIBLE_AND_NPCS,
	MASK_WATER,
	MAX_COORD_FLOAT,
	MAX_COORD_FRACTION,
	MAX_COORD_INTEGER,
	MAX_COORD_RANGE,
	MAX_TRACE_LENGTH,
	MIN_COORD_FLOAT,
	MIN_COORD_FRACTION,
	MIN_COORD_INTEGER,
	SurfaceFlags: g_SurfaceFlags,
	TraceType: g_TraceType,
	ClipRayToCollideable(RayValue, unMaskValue, EntityValue, TargetValue) {
		const Ray = RequireRay(RayValue, "ClipRayToCollideable.Ray");
		const unMask = RequireUnsigned(unMaskValue, "ClipRayToCollideable.unMask");
		const Entity = RequireEntity(EntityValue, "ClipRayToCollideable.Entity");
		const Target = ResolveResultTarget(TargetValue, "ClipRayToCollideable.Target");

		if (!Entity.CollideableAddress) {
			throw new Error("ClipRayToCollideable Entity has no ICollideable.");
		}

		g_vecNativeCalls.push(["ClipRayToCollideable", Entity.Index]);

		return PopulateTraceResult(Ray, unMask, Entity, Target, 0.42);
	},
	ClipRayToEntity(RayValue, unMaskValue, EntityValue, TargetValue) {
		const Ray = RequireRay(RayValue, "ClipRayToEntity.Ray");
		const unMask = RequireUnsigned(unMaskValue, "ClipRayToEntity.unMask");
		const Entity = RequireEntity(EntityValue, "ClipRayToEntity.Entity");
		const Target = ResolveResultTarget(TargetValue, "ClipRayToEntity.Target");

		g_vecNativeCalls.push(["ClipRayToEntity", Entity.Index]);

		return PopulateTraceResult(Ray, unMask, Entity, Target, 0.5);
	},
	EnumerateEntities(RayValue, bIncludeTriggers = false, EnumeratorValue) {
		RequireRay(RayValue, "EnumerateEntities.Ray");

		if (typeof bIncludeTriggers !== "boolean") {
			throw new TypeError("EnumerateEntities.bIncludeTriggers expects a boolean.");
		}

		const vecEntityIndexes = bIncludeTriggers ? [1, 2, 7, 9] : [1, 2, 7];

		g_vecNativeCalls.push(["EnumerateEntities", bIncludeTriggers]);

		return EnumerateIndexes(vecEntityIndexes, EnumeratorValue, "EnumerateEntities.Enumerator");
	},
	EnumerateEntitiesInBox(MinimumsValue, MaximumsValue, EnumeratorValue) {
		const Minimums = RequireVector(MinimumsValue, "EnumerateEntitiesInBox.Minimums");
		const Maximums = RequireVector(MaximumsValue, "EnumerateEntitiesInBox.Maximums");
		const AbsoluteMinimums = {
			X: Math.min(Minimums.X, Maximums.X),
			Y: Math.min(Minimums.Y, Maximums.Y),
			Z: Math.min(Minimums.Z, Maximums.Z),
		};
		const AbsoluteMaximums = {
			X: Math.max(Minimums.X, Maximums.X),
			Y: Math.max(Minimums.Y, Maximums.Y),
			Z: Math.max(Minimums.Z, Maximums.Z),
		};
		const vecEntityIndexes = [1, 2, 7].filter((unEntityIndex) => {
			const Origin = g_mapEntities.get(unEntityIndex).Origin;

			return (Origin.X >= AbsoluteMinimums.X) && (Origin.X <= AbsoluteMaximums.X) && (Origin.Y >= AbsoluteMinimums.Y) && (Origin.Y <= AbsoluteMaximums.Y) && (Origin.Z >= AbsoluteMinimums.Z) && (Origin.Z <= AbsoluteMaximums.Z);
		});

		g_vecNativeCalls.push(["EnumerateEntitiesInBox", vecEntityIndexes.length]);

		return EnumerateIndexes(vecEntityIndexes, EnumeratorValue, "EnumerateEntitiesInBox.Enumerator");
	},
	GetCollideable(EntityValue) {
		const Entity = RequireEntity(EntityValue, "GetCollideable.Entity");

		g_vecNativeCalls.push(["GetCollideable", Entity.Index]);

		if (!Entity.CollideableAddress) {
			return null;
		}

		return {
			Entity: TraceEntity(Entity),
			EntityIndex: Entity.Index,
			Address: Entity.CollideableAddress,
		};
	},
	GetLeafContainingPoint(PositionValue) {
		const flLeafWidth = 128;

		const Position = RequireVector(PositionValue, "GetLeafContainingPoint.Position");

		g_vecNativeCalls.push(["GetLeafContainingPoint", Position.X]);

		return Math.floor((Position.X + MAX_COORD_FLOAT) / flLeafWidth);
	},
	GetPointContents(PositionValue, unMaskValue = MASK_ALL) {
		const flSolidRegionMinimumX = 280;
		const flSolidRegionMaximumX = 360;

		const Position = RequireVector(PositionValue, "GetPointContents.Position");
		const unMask = RequireUnsigned(unMaskValue, "GetPointContents.unMask");
		let unContents = CONTENTS_EMPTY;
		let Entity = null;

		if (Position.Z < 0) {
			unContents = CONTENTS_WATER;
		} else if ((Position.X >= flSolidRegionMinimumX) && (Position.X <= flSolidRegionMaximumX)) {
			unContents = CONTENTS_SOLID;
			Entity = g_mapEntities.get(7);
		}

		g_vecNativeCalls.push(["GetPointContents", unMask]);

		return {
			Contents: ConvertToUnsigned32(unContents & unMask),
			Entities: Entity ? [Entity.Index] : [],
			Entity: Entity ? TraceEntity(Entity) : null,
			Mask: unMask,
		};
	},
	GetPointContentsOfCollideable(EntityValue, PositionValue) {
		const flSolidHalfExtent = 32;

		const Entity = RequireEntity(EntityValue, "GetPointContentsOfCollideable.Entity");
		const Position = RequireVector(PositionValue, "GetPointContentsOfCollideable.Position");

		if (!Entity.CollideableAddress) {
			throw new Error("GetPointContentsOfCollideable Entity has no ICollideable.");
		}

		g_vecNativeCalls.push(["GetPointContentsOfCollideable", Entity.Index]);

		return (Math.abs(Position.X - Entity.Origin.X) <= flSolidHalfExtent) ? CONTENTS_SOLID : CONTENTS_EMPTY;
	},
	IsPointOutsideWorld(PositionValue) {
		const Position = RequireVector(PositionValue, "IsPointOutsideWorld.Position");

		g_vecNativeCalls.push(["IsPointOutsideWorld", Position.X]);

		return (Math.abs(Position.X) > MAX_COORD_FLOAT) || (Math.abs(Position.Y) > MAX_COORD_FLOAT) || (Math.abs(Position.Z) > MAX_COORD_FLOAT);
	},
	SweepCollideable(EntityValue, StartValue, EndValue, AnglesValue, unMaskValue, FilterValue, TargetValue) {
		const Entity = RequireEntity(EntityValue, "SweepCollideable.Entity");
		const Ray = {
			End: RequireVector(EndValue, "SweepCollideable.End"),
			Start: RequireVector(StartValue, "SweepCollideable.Start"),
		};

		RequireVector(AnglesValue, "SweepCollideable.Angles");

		if (!Entity.CollideableAddress) {
			throw new Error("SweepCollideable Entity has no ICollideable.");
		}

		const unMask = RequireUnsigned(unMaskValue, "SweepCollideable.unMask");
		const Filter = NormalizeTraceFilter(FilterValue, "SweepCollideable.Filter");
		const HitEntity = SelectTraceEntity(Filter, unMask, "SweepCollideable.Filter");
		const Target = ResolveResultTarget(TargetValue, "SweepCollideable.Target");

		g_vecNativeCalls.push(["SweepCollideable", Entity.Index]);

		return PopulateTraceResult(Ray, unMask, HitEntity, Target, 0.6);
	},
	TraceRay(RayValue, unMaskValue = MASK_ALL, FilterValue, TargetValue) {
		const Ray = RequireRay(RayValue, "TraceRay.Ray");
		const unMask = RequireUnsigned(unMaskValue, "TraceRay.unMask");
		const Filter = NormalizeTraceFilter(FilterValue, "TraceRay.Filter");
		const Entity = SelectTraceEntity(Filter, unMask, "TraceRay.Filter");
		const Target = ResolveResultTarget(TargetValue, "TraceRay.Target");

		g_vecNativeCalls.push(["TraceRay", unMask]);

		return PopulateTraceResult(Ray, unMask, Entity, Target);
	},
};

function LoadTrace(NativeModule) {
	globalThis.sourcejs = {
		"engines/trace": NativeModule,
	};
	delete require.cache[g_strTracePath];

	return require(g_strTracePath);
}

const g_TraceModule = LoadTrace(g_NativeTrace);
g_Assert.equal(g_TraceModule, g_NativeTrace);
g_Assert.deepEqual(Object.keys(g_TraceModule).sort(), g_vecExpectedExports);
g_Assert.equal(g_TraceModule.ContentFlags.Solid, g_TraceModule.CONTENTS_SOLID);
g_Assert.equal(g_TraceModule.ContentMasks.Shot, g_TraceModule.MASK_SHOT);
g_Assert.equal(g_TraceModule.DisplacementFlags.Buildable, 0x04);
g_Assert.equal(g_TraceModule.SurfaceFlags.Sky, 0x04);
g_Assert.equal(g_TraceModule.TraceType.EverythingFilterProperties, 3);
g_Assert.equal(g_TraceModule.MAX_TRACE_LENGTH, MAX_TRACE_LENGTH);

const g_Ray = {
	End: { X: 1_024, Y: 0, Z: 64 },
	Start: { X: 0, Y: 0, Z: 64 },
};
const g_PlayerEntity = g_mapEntities.get(1);
const g_InfectedEntity = g_mapEntities.get(2);
const g_PropEntity = g_mapEntities.get(7);

const g_PointContents = g_TraceModule.GetPointContents({ X: 320, Y: 0, Z: 16 }, g_TraceModule.ContentMasks.Solid);
g_Assert.equal(g_PointContents.Contents, g_TraceModule.CONTENTS_SOLID);
g_Assert.deepEqual(g_PointContents.Entities, [7]);
g_Assert.equal(g_PointContents.Entity.Index, 7);
g_Assert.equal(g_TraceModule.GetPointContentsOfCollideable(g_PropEntity, { X: 320, Y: 0, Z: 0 }), g_TraceModule.CONTENTS_SOLID);

const g_TraceResult = g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, [g_PlayerEntity]);
g_Assert.equal(g_TraceResult.EntityIndex, 2);
g_Assert.equal(g_TraceResult.Entity, g_InfectedEntity);
g_Assert.equal(g_TraceResult.Hit, true);
g_Assert.equal(g_TraceResult.HitNonWorldEntity, true);
g_Assert.equal(g_TraceResult.HitGroup, 1);
g_Assert.equal(g_TraceResult.PhysicsBone, 0);
g_Assert.equal(g_TraceResult.Plane.SignBits, 0x01);
g_Assert.equal(Object.hasOwn(g_TraceResult.Plane, "signbits"), false);
g_Assert.equal(Object.hasOwn(g_TraceResult, "hitgroup"), false);
g_Assert.equal(Object.hasOwn(g_TraceResult, "physicsbone"), false);

const g_ReusableResult = { RequestID: 17 };
g_Assert.equal(g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Visible, null, g_ReusableResult), g_ReusableResult);
g_Assert.equal(g_ReusableResult.RequestID, 17);
g_Assert.equal(g_TraceModule.ClipRayToEntity(g_Ray, g_TraceModule.ContentMasks.Shot, g_PropEntity).EntityIndex, 7);
g_Assert.equal(g_TraceModule.ClipRayToCollideable(g_Ray, g_TraceModule.ContentMasks.Shot, g_InfectedEntity).Fraction, 0.42);
g_Assert.equal(g_TraceModule.SweepCollideable(g_PropEntity, g_Ray.Start, g_Ray.End, { X: 0, Y: 90, Z: 0 }, g_TraceModule.ContentMasks.Solid).Fraction, 0.6);
g_Assert.equal(g_TraceModule.GetCollideable(g_PropEntity).Address, 0x1700n);
g_Assert.equal(g_TraceModule.GetCollideable(g_mapEntities.get(4)), null);
g_Assert.equal(g_TraceModule.IsPointOutsideWorld({ X: 20_000, Y: 0, Z: 0 }), true);
g_Assert.equal(Number.isSafeInteger(g_TraceModule.GetLeafContainingPoint({ X: 64, Y: 0, Z: 0 })), true);

const g_vecVisited = [];
const g_vecRayEntityIndexes = g_TraceModule.EnumerateEntities(g_Ray, true, (Entity) => {
	g_vecVisited.push(Entity.Index);

	return Entity.Index !== 7;
});
g_Assert.deepEqual(g_vecRayEntityIndexes, [1, 2, 7]);
g_Assert.deepEqual(g_vecVisited, [1, 2, 7]);
g_Assert.deepEqual(g_TraceModule.EnumerateEntitiesInBox({ X: -16, Y: -16, Z: -16 }, { X: 200, Y: 16, Z: 16 }), [1, 2]);

g_Assert.throws(() => g_TraceModule.TraceRay({ Start: g_Ray.Start }, g_TraceModule.ContentMasks.Shot), /End/);
g_Assert.throws(() => g_TraceModule.TraceRay({ ...g_Ray, Minimums: { X: -1, Y: -1, Z: -1 } }, g_TraceModule.ContentMasks.Shot), /together/);
g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, { ShouldHitEntity: () => 1 }), /boolean/);
g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, { GetTraceType: () => "all" }), /integer/);

for (const nInvalidTraceType of [-1, 4, 2_147_483_647]) {
	g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, { TraceType: nInvalidTraceType }), /supported native trace type/);
	g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, { GetTraceType: () => nInvalidTraceType }), /supported native trace type/);
}

const g_PrecedenceFilter = {
	TraceType: g_TraceType.WorldOnly,
	get GetTraceType() {
		throw new Error("TraceType must take precedence.");
	},
};
g_Assert.equal(g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, g_PrecedenceFilter).EntityIndex, 0);

const g_ReceiverFilter = {
	ExpectedIndex: 7,
	GetTraceType() {
		g_Assert.equal(this, g_ReceiverFilter);

		return g_TraceType.EntitiesOnly;
	},
	ShouldHitEntity(EntityInformation) {
		return EntityInformation.Index === this.ExpectedIndex;
	},
};
g_Assert.equal(g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, g_ReceiverFilter).EntityIndex, 7);

g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, 1), /object/);
g_Assert.throws(() => g_TraceModule.TraceRay(g_Ray, g_TraceModule.ContentMasks.Shot, null, []), /object/);
g_Assert.throws(() => g_TraceModule.EnumerateEntities(g_Ray, null), /boolean/);
g_Assert.throws(() => g_TraceModule.EnumerateEntities(g_Ray, false, () => "continue"), /boolean/);
g_Assert.throws(() => g_TraceModule.GetPointContents(7), /object/);
g_Assert.throws(() => g_TraceModule.GetCollideable(7), /object/);

for (const strAliasName of ["EntityEnumerator", "EverythingFilterProps", "Ray", "engineTrace", "moduleName", "number", "object"]) {
	g_Assert.equal(Object.hasOwn(g_TraceModule, strAliasName), false, `unexpected engines/trace alias: ${strAliasName}`);
}

const g_LimitedNativeTrace = {
	...g_NativeTrace,
	ContentFlags: { ...g_ContentFlags },
	ContentMasks: { ...g_ContentMasks },
	SurfaceFlags: { ...g_SurfaceFlags },
};
for (const strExportName of ["CONTENTS_BLOCKLOS", "CONTENTS_UNUSED", "MASK_BLOCKLOS", "MASK_BLOCKLOS_AND_NPCS"]) {
	delete g_LimitedNativeTrace[strExportName];
}

for (const strMemberName of ["BlockLineOfSight", "Unused"]) {
	delete g_LimitedNativeTrace.ContentFlags[strMemberName];
}

for (const strMemberName of ["BlockLineOfSight", "BlockLineOfSightAndNPCs"]) {
	delete g_LimitedNativeTrace.ContentMasks[strMemberName];
}

for (const strMemberName of ["NoPortal", "Sky2D"]) {
	delete g_LimitedNativeTrace.SurfaceFlags[strMemberName];
}

const g_LimitedTraceModule = LoadTrace(g_LimitedNativeTrace);
g_Assert.equal(g_LimitedTraceModule, g_LimitedNativeTrace);
g_Assert.equal(Object.hasOwn(g_LimitedTraceModule, "CONTENTS_BLOCKLOS"), false);
g_Assert.equal(Object.hasOwn(g_LimitedTraceModule.ContentFlags, "BlockLineOfSight"), false);
g_Assert.equal(Object.hasOwn(g_LimitedTraceModule.ContentMasks, "BlockLineOfSightAndNPCs"), false);
g_Assert.equal(Object.hasOwn(g_LimitedTraceModule.SurfaceFlags, "Sky2D"), false);

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = RequireFiniteNumber(flX, "Vector.X");
		this.Y = RequireFiniteNumber(flY, "Vector.Y");
		this.Z = RequireFiniteNumber(flZ, "Vector.Z");
	}

	AddVector(VectorValue) {
		const OtherVector = RequireVector(VectorValue, "Vector.AddVector");

		return new Vector(this.X + OtherVector.X, this.Y + OtherVector.Y, this.Z + OtherVector.Z);
	}

	MultiplyScalar(flScale) {
		const flScalar = RequireFiniteNumber(flScale, "Vector.MultiplyScalar");

		return new Vector(this.X * flScalar, this.Y * flScalar, this.Z * flScalar);
	}
}

function Player(unIndex) {
	const EntityRecord = RequireEntity({ Index: unIndex }, "Player");
	if (!EntityRecord.IsPlayer) {
		throw new TypeError("Player expects a player index.");
	}

	const PlayerRecord = {
		...EntityRecord,
		GetEyeLocation() {
			return new Vector(EntityRecord.Origin.X, EntityRecord.Origin.Y, EntityRecord.Origin.Z + 64);
		},
		GetViewVector() {
			return new Vector(1, 0, 0);
		},
	};

	return PlayerRecord;
}

function Entity(unIndex) {
	const EntityRecord = RequireEntity({ Index: unIndex }, "Entity");

	return EntityRecord;
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function ExecuteDocumentationBlock(strSource, unIndex, ModuleMap) {
	const bInspectResult = strSource.includes("SurfaceName:");
	const bInspectSweep = strSource.includes("SweepCollideable(");
	let bVerifiedPosition = false;
	const InspectTraceRecord = (TraceInformation) => {
		if (!bInspectResult && !bInspectSweep) {
			return;
		}

		g_Assert.ok(TraceInformation && (typeof TraceInformation === "object"), "trace example must log a result record");

		const strPositionPropertyName = bInspectResult ? "EndPosition" : "StopPosition";
		g_Assert.ok(Object.hasOwn(TraceInformation, strPositionPropertyName), `trace example must preserve ${strPositionPropertyName}`);

		const Position = TraceInformation[strPositionPropertyName];
		g_Assert.ok(Position && (typeof Position === "object"), "trace example must read the public EndPosition record");

		for (const strAxisName of ["X", "Y", "Z"]) {
			g_Assert.equal(typeof Position[strAxisName], "number");
			g_Assert.ok(Number.isFinite(Position[strAxisName]));
		}

		bVerifiedPosition = true;
	};

	const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\n})`, {
		filename: `engines-trace.md:block-${unIndex + 1}`,
	});
	const Callback = Script.runInNewContext({});
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(ModuleMap, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strFormat, LogRecord) {
					ModuleMap.loggers.LogInfo(strFormat, LogRecord);
					InspectTraceRecord(LogRecord);
				},
			};
		}

		return ModuleMap[strModuleName];
	};
	const DocumentationConsole = { log: InspectTraceRecord };

	Callback(DocumentationRequire, DocumentationConsole);

	if (bInspectResult || bInspectSweep) {
		g_Assert.ok(bVerifiedPosition, "trace example must inspect a hit position");
	}
}

const g_vecDocumentationLogRecords = [];
const g_DocumentationModules = {
	"engines/trace": g_NativeTrace,
	"entities/entity": { Entity },
	loggers: {
		LogInfo(strFormat, LogRecord) {
			g_Assert.equal(strFormat, "%j");
			g_Assert.equal(Object.keys(LogRecord)[0], "Operation");
			g_Assert.equal(typeof LogRecord.Operation, "string");
			g_vecDocumentationLogRecords.push(JSON.parse(JSON.stringify(LogRecord)));
		},
	},
	mathlib: { Vector },
	"players/entity": { Player },
};

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
g_Assert.equal(g_vecDocumentationBlocks.length, 22);

for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, g_DocumentationModules);
}

for (const strOperation of [
	"ImportTrace",
	"SelectTraceMask",
	"CombineContentMasks",
	"CreateViewRay",
	"CreateHullRay",
	"IgnoreTraceEntity",
	"EvaluateTraceFilter",
	"FilteredTrace",
	"ObjectTraceFilter",
	"InspectTraceHit",
	"ReuseTraceResult",
	"QueryPointContents",
	"QueryCollideableContents",
	"ClipEntityRay",
	"ClipCollideableRay",
	"SweepCollideable",
	"VisitRayEntity",
	"EnumerateRayEntities",
	"VisitBoxEntity",
	"EnumerateBoxEntities",
	"QueryWorldBounds",
	"QueryBSPLeaf",
	"WorldVisibility",
	"DecodeHitboxSurface",
	"DecodeDisplacement",
	"ResolveCollideables",
]) {
	g_Assert.ok(g_vecDocumentationLogRecords.some(LogRecord => LogRecord.Operation === strOperation), `missing structured trace diagnostic: ${strOperation}`);
}

const g_setExercisedOperations = new Set(g_vecNativeCalls.map(([strOperation]) => strOperation));
for (const strOperation of [
	"ClipRayToCollideable",
	"ClipRayToEntity",
	"EnumerateEntities",
	"EnumerateEntitiesInBox",
	"GetCollideable",
	"GetLeafContainingPoint",
	"GetPointContents",
	"GetPointContentsOfCollideable",
	"IsPointOutsideWorld",
	"SweepCollideable",
	"TraceRay",
]) {
	g_Assert.equal(g_setExercisedOperations.has(strOperation), true, `missing exercised native operation: ${strOperation}`);
}

globalThis.sourcejs = {};
delete require.cache[g_strTracePath];
g_Assert.throws(() => require(g_strTracePath), /SourceJS module is not installed/);

console.log("[smoke] engines/trace contracts passed");
