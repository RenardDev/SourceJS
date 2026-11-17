#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unEntityBaseAddress = 0x1000n;
const g_flWorldCoordinateLimit = 16_384;

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs");
const g_strEnginesPath = g_Path.join(g_strPackageRoot, "engines.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "engines.md");
const g_vecExpectedExports = [
	"ClipRayToEntity",
	"EmitSound",
	"EntityCount",
	"EnumerateEntities",
	"GameDescription",
	"GameDirectory",
	"GetClientCVarValue",
	"GetPointContents",
	"InsertServerCommand",
	"IsDedicatedServer",
	"IsLoopingSound",
	"IsPointOutsideWorld",
	"IsSoundPrecached",
	"PrecacheDecal",
	"PrecacheGeneric",
	"PrecacheModel",
	"PrecacheSound",
	"PrefetchSound",
	"QueueServerCommand",
	"ServerCommand",
	"SoundDuration",
	"StopSound",
	"TraceRay",
];
const g_Attenuation = { Normal: 0.8 };
const g_Channel = { Item: 3 };
const g_Pitch = { Normal: 100 };
const g_SoundFlags = { NoFlags: 0 };
const g_ContentMasks = { All: 0xFFFFFFFF, Shot: 0x4600400B };
const g_vecCommandLog = [];
const g_vecEmittedSounds = [];
const g_vecStoppedSounds = [];
const g_mapPrecachedResources = new Map();
const g_setPrecachedSounds = new Set();
const g_setPrefetchedSounds = new Set();

function RequireNonEmptyString(strValue, strOperationName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strOperationName} requires a non-empty string`);
	}

	return strValue;
}

function RequireBoolean(bValue, strOperationName) {
	if (typeof bValue !== "boolean") {
		throw new TypeError(`${strOperationName} requires a boolean`);
	}

	return bValue;
}

function RequireVector(Value, strOperationName) {
	if (!Value || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperationName} requires a vector`);
	}

	for (const strComponentName of ["X", "Y", "Z"]) {
		const flComponentValue = Value[strComponentName];
		if ((typeof flComponentValue !== "number") || !Number.isFinite(flComponentValue)) {
			throw new TypeError(`${strOperationName} requires finite vector components`);
		}
	}

	return Value;
}

function RequireRay(Value, strOperationName) {
	if (!Value || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperationName} requires a ray`);
	}

	RequireVector(Value.Start, strOperationName);
	RequireVector(Value.End, strOperationName);

	if (Value.Minimums !== undefined) {
		RequireVector(Value.Minimums, strOperationName);
	}

	if (Value.Maximums !== undefined) {
		RequireVector(Value.Maximums, strOperationName);
	}

	return Value;
}

function RequireEntity(Value, strOperationName) {
	const unEntityIndex = Value?.Index;
	if (!Value || (typeof Value !== "object") || !Number.isSafeInteger(unEntityIndex) || (unEntityIndex < 0)) {
		throw new TypeError(`${strOperationName} requires an entity`);
	}

	return Value;
}

function Entity(unIndex) {
	return {
		Index: unIndex,
		Address: g_unEntityBaseAddress + BigInt(unIndex),
	};
}

function Player(unIndex) {
	return {
		...Entity(unIndex),
		IsConnected() {
			return true;
		},
		UserID: unIndex,
	};
}

const g_vecInitialEntityRecords = [Entity(0), Entity(3), Player(1)];
g_Assert.deepEqual(g_vecInitialEntityRecords.map((EntityRecord) => EntityRecord.Address), [0x1000n, 0x1003n, 0x1001n], "engine entity and player fixtures use exact BigInt addresses");

function MakeTraceResult(unEntityIndex, flFraction, strSurfaceName, unMask) {
	const EntityValue = Entity(unEntityIndex);

	return {
		AllSolid: false,
		Contents: unMask,
		DisplacementFlags: 0,
		EndPosition: { X: 128, Y: 0, Z: 64 },
		Entity: EntityValue,
		EntityIndex: unEntityIndex,
		Fraction: flFraction,
		Hit: true,
		HitNonWorldEntity: unEntityIndex > 0,
		HitWorld: unEntityIndex === 0,
		Hitbox: 2,
		HitGroup: 1,
		PhysicsBone: 0,
		Plane: {
			Distance: 64,
			Normal: { X: 0, Y: 0, Z: 1 },
			Type: 2,
		},
		StartPosition: { X: 0, Y: 0, Z: 64 },
		StartSolid: false,
		Surface: {
			Flags: 0,
			Name: strSurfaceName,
			Property: 1,
		},
	};
}

function PrecacheResource(strKind, strResourcePath, bPreload) {
	RequireNonEmptyString(strResourcePath, strKind);
	RequireBoolean(bPreload, `${strKind} preload`);

	const strKey = `${strKind}:${strResourcePath}`;
	if (!g_mapPrecachedResources.has(strKey)) {
		g_mapPrecachedResources.set(strKey, g_mapPrecachedResources.size + 1);
	}

	return g_mapPrecachedResources.get(strKey);
}

const g_NativeEngines = {
	ClipRayToEntity(Ray, unMask, EntityValue) {
		RequireRay(Ray, "ClipRayToEntity");
		RequireEntity(EntityValue, "ClipRayToEntity");

		return MakeTraceResult(EntityValue.Index, 0.25, "entity_surface", unMask);
	},
	EmitSound(Options) {
		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("EmitSound requires an options object");
		}

		RequireNonEmptyString(Options.Sample, "EmitSound Sample");
		g_vecEmittedSounds.push({ ...Options });

		return true;
	},
	EntityCount() {
		return 12;
	},
	EnumerateEntities(Ray, bIncludeTriggers = false, EnumeratorValue) {
		RequireRay(Ray, "EnumerateEntities");
		RequireBoolean(bIncludeTriggers, "EnumerateEntities bIncludeTriggers");

		const vecEntityIndexes = [];
		for (const unEntityIndex of [2, 3, 4]) {
			vecEntityIndexes.push(unEntityIndex);

			if (EnumeratorValue && (EnumeratorValue.EnumEntity(Entity(unEntityIndex)) === false)) {
				break;
			}
		}

		return vecEntityIndexes;
	},
	GameDescription() {
		return "Left 4 Dead 2";
	},
	GameDirectory() {
		return "C:/game/left4dead2";
	},
	GetClientCVarValue(ValueClient, strCVarName) {
		const unPlayerIndex = (typeof ValueClient === "object") ? ValueClient?.Index : ValueClient;
		if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 1)) {
			throw new TypeError("GetClientCVarValue requires a positive player index");
		}

		RequireNonEmptyString(strCVarName, "GetClientCVarValue");

		return (strCVarName === "cl_language") ? "english" : "";
	},
	GetPointContents(Position, unMask = g_ContentMasks.All) {
		RequireVector(Position, "GetPointContents");

		const EntityValue = Entity(2);

		return {
			Contents: 1,
			Entities: [EntityValue.Index],
			Entity: EntityValue,
			Mask: unMask,
		};
	},
	InsertServerCommand(strCommandLine) {
		g_vecCommandLog.push(["insert", RequireNonEmptyString(strCommandLine, "InsertServerCommand")]);

		return true;
	},
	IsDedicatedServer() {
		return true;
	},
	IsLoopingSound(strSample) {
		return RequireNonEmptyString(strSample, "IsLoopingSound").includes("klaxon");
	},
	IsPointOutsideWorld(Position) {
		const Point = RequireVector(Position, "IsPointOutsideWorld");

		return (Math.abs(Point.X) > g_flWorldCoordinateLimit) || (Math.abs(Point.Y) > g_flWorldCoordinateLimit) || (Math.abs(Point.Z) > g_flWorldCoordinateLimit);
	},
	IsSoundPrecached(strSample) {
		return g_setPrecachedSounds.has(RequireNonEmptyString(strSample, "IsSoundPrecached"));
	},
	PrecacheDecal(strName, bPreload = false) {
		return PrecacheResource("PrecacheDecal", strName, bPreload);
	},
	PrecacheGeneric(strResourcePath, bPreload = false) {
		return PrecacheResource("PrecacheGeneric", strResourcePath, bPreload);
	},
	PrecacheModel(strModelPath, bPreload = false) {
		return PrecacheResource("PrecacheModel", strModelPath, bPreload);
	},
	PrecacheSound(strSample, bPreload = false, bUISound = false) {
		RequireNonEmptyString(strSample, "PrecacheSound");
		RequireBoolean(bPreload, "PrecacheSound bPreload");
		RequireBoolean(bUISound, "PrecacheSound bUISound");
		g_setPrecachedSounds.add(strSample);

		return true;
	},
	PrefetchSound(strSample) {
		g_setPrefetchedSounds.add(RequireNonEmptyString(strSample, "PrefetchSound"));

		return true;
	},
	QueueServerCommand(strCommandLine) {
		g_vecCommandLog.push(["queue", RequireNonEmptyString(strCommandLine, "QueueServerCommand")]);

		return true;
	},
	ServerCommand(strCommandLine) {
		g_vecCommandLog.push(["execute", RequireNonEmptyString(strCommandLine, "ServerCommand")]);

		return true;
	},
	SoundDuration(strSample) {
		RequireNonEmptyString(strSample, "SoundDuration");

		return 2.5;
	},
	StopSound(Options) {
		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("StopSound requires an options object");
		}

		RequireNonEmptyString(Options.Sample, "StopSound Sample");
		g_vecStoppedSounds.push({ ...Options });

		return true;
	},
	TraceRay(Ray, unMask = g_ContentMasks.All) {
		RequireRay(Ray, "TraceRay");

		return MakeTraceResult(2, 0.5, "world/brick", unMask);
	},
};

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

function VerifyWorldEngineExample(Engines) {
	const strExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecOperations = [...strExample.matchAll(/^\tLogResult\("engines\.(?:GameDirectory|IsDedicatedServer|EntityCount)".*$/gm)].map((vecMatch) => vecMatch[0]);
	g_Assert.equal(vecOperations.length, 3, "world example must demonstrate the three actual engine exports");

	const strImports = `const { ${Object.keys(Engines).join(", ")} } = Engines;`;
	const RunExamples = new Function("Engines", "LogResult", `${strImports}\n${vecOperations.join("\n")}`);
	const mapResults = new Map();
	RunExamples(Engines, (strLabel, Callback) => mapResults.set(strLabel, Callback()));
	g_Assert.equal(mapResults.get("engines.GameDirectory"), Engines.GameDirectory());
	g_Assert.equal(mapResults.get("engines.IsDedicatedServer"), Engines.IsDedicatedServer());
	g_Assert.equal(mapResults.get("engines.EntityCount"), Engines.EntityCount());
}

function RunDocumentationExamples(Engines) {
	const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, 10, "engines documentation example count");
	const vecLogRecords = [];

	for (const strExample of vecExamples) {
		const DocumentationModule = { exports: {} };
		const DocumentationConsole = {
			log() {
			},
		};
		const DocumentationRequire = (strModuleName) => {
			switch (strModuleName) {
				case "engines":
					return Engines;

				case "engines/sound":
					return { Attenuation: g_Attenuation, Channel: g_Channel, Pitch: g_Pitch, SoundFlags: g_SoundFlags };

				case "engines/trace":
					return { ContentMasks: g_ContentMasks };

				case "entities/entity":
					return { Entity };

				case "loggers":
					return {
						LogInfo(strFormat, LogRecord) {
							g_Assert.equal(strFormat, "%j");
							g_Assert.equal(Object.keys(LogRecord)[0], "Operation");
							vecLogRecords.push(JSON.parse(JSON.stringify(LogRecord)));
						},
					};

				case "players/entity":
					return { Player };

				default:
					throw new Error(`Unexpected documentation import: ${strModuleName}`);
			}
		};
		const Execute = new Function("require", "module", "console", `"use strict";\n${strExample}`);
		Execute(DocumentationRequire, DocumentationModule, DocumentationConsole);

		g_Assert.equal(Object.hasOwn(DocumentationModule.exports, "unload"), false, "Documented examples must not export lowercase Unload aliases.");

		if (typeof DocumentationModule.exports.Unload === "function") {
			DocumentationModule.exports.Unload();
		}
	}

	for (const strOperation of [
		"ImportEngines",
		"QueryServerState",
		"QueryClientCVar",
		"PrecacheResources",
		"QuerySoundState",
		"QueryPointContents",
		"TraceSceneAndEntity",
		"EnumerateTraceEntities",
	]) {
		g_Assert.ok(vecLogRecords.some(LogRecord => LogRecord.Operation === strOperation), `missing structured engines diagnostic: ${strOperation}`);
	}

	const SceneRecord = vecLogRecords.find(LogRecord => LogRecord.Operation === "TraceSceneAndEntity");
	g_Assert.equal(typeof SceneRecord.SceneTraceFraction, "number");
	g_Assert.equal(typeof SceneRecord.SceneSurfaceName, "string");
	g_Assert.equal(typeof SceneRecord.SceneEntityIndex, "number");
}

InstallDependency(g_strRuntimePath, {
	GetModule(strModuleName) {
		if (strModuleName !== "engines") {
			throw new Error(`native module is unavailable: ${strModuleName}`);
		}

		return g_NativeEngines;
	},
});

delete require.cache[g_strEnginesPath];

const g_Engines = require(g_strEnginesPath);
g_Assert.equal(g_Engines, g_NativeEngines, "engines must export the exact native object");
g_Assert.deepEqual(Object.keys(g_Engines).sort(), g_vecExpectedExports, "engines must expose only its 23 direct native operations");
g_Assert.throws(() => g_Engines.ServerCommand(1), "ServerCommand must reject scalar coercion");
g_Assert.throws(() => g_Engines.GetClientCVarValue(1, 7), "GetClientCVarValue must reject scalar CVar names");

RunDocumentationExamples(g_Engines);
VerifyWorldEngineExample(g_Engines);

g_Assert.deepEqual(g_vecCommandLog.map(([strOperation]) => strOperation), ["execute", "queue", "insert"], "documentation must demonstrate all command orders");

for (const strResourceKind of ["PrecacheModel", "PrecacheGeneric", "PrecacheDecal"]) {
	g_Assert.ok([...g_mapPrecachedResources.keys()].some((strKey) => strKey.startsWith(`${strResourceKind}:`)), `documentation must precache ${strResourceKind} resources`);
}

g_Assert.ok(g_setPrecachedSounds.has("ambient/alarms/klaxon1.wav"), "documentation must precache the inspected sound");
g_Assert.ok(g_setPrefetchedSounds.has("ambient/alarms/klaxon1.wav"), "documentation must prefetch the inspected sound");
g_Assert.equal(g_vecEmittedSounds.length, 1, "documentation must emit one sound");
g_Assert.equal(g_vecStoppedSounds.length, 1, "documentation unload must stop the emitted sound");
g_Assert.equal(g_vecStoppedSounds[0].Sample, g_vecEmittedSounds[0].Sample, "documentation must stop the same sample it emitted");
g_Assert.equal(Object.hasOwn(g_Engines, "findGameRules"), false, "engines must not aggregate gamerules");
g_Assert.equal(Object.hasOwn(g_Engines, "server"), false, "engines must not aggregate engines/server");
g_Assert.equal(Object.hasOwn(g_Engines, "sound"), false, "engines must not aggregate engines/sound");
g_Assert.equal(Object.hasOwn(g_Engines, "trace"), false, "engines must not aggregate engines/trace");
g_Assert.equal(Object.hasOwn(g_Engines, "moduleName"), false, "engines must not expose module metadata");

console.log("[smoke_engines_root] ok");
