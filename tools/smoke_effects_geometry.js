"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_vecInstances = [];
const g_vecCreations = [];
const g_vecNativeCalls = [];
let g_bCreationResult = true;

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = flX;
		this.Y = flY;
		this.Z = flZ;
	}

	static CreateMathStructureFromValue(Value) {
		return new Vector(Value.X, Value.Y, Value.Z);
	}
}

class TemporaryEntity {
	constructor(strName, Values = {}) {
		this.Name = strName;
		this.Values = { ...Values };
		g_vecInstances.push(this);
	}

	SetTemporaryEntityProperty(strName, Value) {
		this.Values[strName] = Value;
	}

	CreateTemporaryEntity(Recipients, flDelay, Values, bReliable) {
		g_vecCreations.push({ Instance: this, Recipients, Delay: flDelay, Values, Reliable: bReliable, Properties: { ...this.Values } });

		return g_bCreationResult;
	}
}

function Entity(unIndex) {
	return { Origin: new Vector(unIndex, unIndex + 1, unIndex + 2) };
}

function RecordNativeCall(...vecArguments) {
	g_vecNativeCalls.push(vecArguments);

	return vecArguments;
}

const g_NativeEffects = {
	BloodColor: {},
	ShatterSurface: {},
	GetTempEntity: RecordNativeCall,
	GetProperty: RecordNativeCall,
	PrecacheModel: RecordNativeCall,
	PrecacheGeneric: RecordNativeCall,
	PrecacheDecal: RecordNativeCall,
};
const g_Index = { CreateTemporaryEntity: RecordNativeCall, TemporaryEntity };
const g_Hooks = {
	RegisterTemporaryEntityPostCreateHook: RecordNativeCall,
	RegisterTemporaryEntityPreCreateHook: RecordNativeCall,
	TemporaryEntityPostCreateHook: {},
	TemporaryEntityPreCreateHook: {},
};
const g_Templates = {
	GetTemporaryEntityTemplate: RecordNativeCall,
	GetTemporaryEntityTemplates: RecordNativeCall,
	TEMP_ENTITY_TEMPLATES: {},
	TemporaryEntityTemplate: {},
	TemporaryEntityTemplateCollection: {},
};
const g_mapDependencies = new Map([
	["internal/runtime", { GetModule: (strName) => {
		g_Assert.equal(strName, "effects");

		return g_NativeEffects;
	} }],
	["effects/index", g_Index],
	["effects/hooks", g_Hooks],
	["effects/templates", g_Templates],
	["entities/entity", { Entity }],
	["mathlib", { Vector }],
]);

function RequireDependency(strModuleName) {
	g_Assert.ok(g_mapDependencies.has(strModuleName));

	return g_mapDependencies.get(strModuleName);
}

const g_strSourcePath = process.argv[2] ?? g_Path.join(__dirname, "../packages/sourcejs/effects.js");
const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strSourcePath, "utf8"), { module: g_Module, require: RequireDependency }, { filename: g_strSourcePath });

const g_Effects = g_Module.exports;
g_Assert.equal(g_Effects.CreateTemporaryEntity, g_Index.CreateTemporaryEntity);
g_Assert.equal(g_Effects.TemporaryEntity, TemporaryEntity);
g_Assert.equal(g_Effects.TEMP_ENTITY_TEMPLATES, g_Templates.TEMP_ENTITY_TEMPLATES);
g_Assert.equal(g_Effects.RegisterTemporaryEntityPreCreateHook, g_Hooks.RegisterTemporaryEntityPreCreateHook);
g_Assert.equal(g_Effects.ShatterSurface, g_NativeEffects.ShatterSurface);
g_Assert.deepEqual(g_Effects.GetTemporaryEntity("BeamPoints"), ["BeamPoints"]);
g_Assert.deepEqual(g_Effects.GetNativeTemporaryEntityProperty("BeamPoints", "Width"), ["BeamPoints", "Width"]);
g_Assert.deepEqual(g_Effects.PrecacheModel("model"), ["model", false]);
g_Assert.deepEqual(g_Effects.PrecacheGeneric("resource", true), ["resource", true]);
g_Assert.deepEqual(g_Effects.PrecacheDecal("decal"), ["decal", false]);
g_Assert.equal(g_vecNativeCalls.length, 5);

const g_Recipients = { Kind: "recipient-filter" };
const g_StagedEntity = new TemporaryEntity("Provided", { Width: 5 });
g_bCreationResult = false;
g_Assert.equal(g_Effects.CreateBeamEffect(g_Recipients, [1, 2, 3], { Origin: { X: 4, Y: 5, Z: 6 } }, false, { TempEntity: g_StagedEntity, Width: 99, Delay: 0.25, Reliable: true, Recipients: [] }), false);
g_Assert.equal(g_vecCreations.at(-1).Instance, g_StagedEntity);
g_Assert.equal(g_vecCreations.at(-1).Recipients, g_Recipients);
g_Assert.equal(g_vecCreations.at(-1).Delay, 0.25);
g_Assert.equal(g_vecCreations.at(-1).Reliable, true);
g_Assert.equal(g_vecCreations.at(-1).Values, undefined);
g_Assert.equal(g_StagedEntity.Values.Width, 5);
g_Assert.deepEqual(g_StagedEntity.Values.StartPoint, new Vector(1, 2, 3));
g_Assert.deepEqual(g_StagedEntity.Values.EndPoint, new Vector(4, 5, 6));

g_bCreationResult = true;
g_Assert.equal(g_Effects.CreateBeamEffect(g_Recipients, 7, { Index: 8 }, true, { Width: 2, EntityName: "Selected", Delay: 1 }), true);
g_Assert.equal(g_vecInstances.at(-1).Name, "Selected");
g_Assert.deepEqual({ ...g_vecInstances.at(-1).Values }, { Width: 2, StartEntityIndex: 7, EndEntityIndex: 8 });

g_Effects.CreateBeamEffect(g_Recipients, 7, [0, 1, 2]);
g_Assert.deepEqual(g_vecCreations.at(-1).Properties.StartPoint, new Vector(7, 8, 9));

const g_unPolygonStart = g_vecCreations.length;
const g_vecPoints = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
g_bCreationResult = false;
g_Assert.equal(g_Effects.CreatePolygonEffect(g_Recipients, g_vecPoints, false, { Width: 3 }), undefined);
const g_vecPolygon = g_vecCreations.slice(g_unPolygonStart);
g_Assert.equal(g_vecPolygon.length, 3);
g_Assert.equal(new Set(g_vecPolygon.map((Creation) => Creation.Instance)).size, 1);
g_Assert.deepEqual(g_vecPolygon.at(-1).Properties.EndPoint, new Vector(0, 0, 0));
g_Assert.equal(g_vecPolygon.at(-1).Properties.Width, 3);

const g_unSquareStart = g_vecCreations.length;
g_Assert.equal(g_Effects.CreateSquareEffect(g_Recipients, [0, 0, 0], [2, 3, 4]), undefined);
g_Assert.equal(g_vecCreations.length - g_unSquareStart, 4);
g_Assert.deepEqual(g_vecCreations[g_unSquareStart].Properties.EndPoint, new Vector(2, 3, 0));
g_Assert.deepEqual(g_vecCreations.at(-1).Properties.EndPoint, new Vector(0, 0, 0));

const g_unBoxStart = g_vecCreations.length;
g_Assert.equal(g_Effects.CreateBoxEffect(g_Recipients, [0, 0, 0], [2, 3, 4]), undefined);
const g_vecBox = g_vecCreations.slice(g_unBoxStart);
g_Assert.equal(g_vecBox.length, 12);
g_Assert.equal(new Set(g_vecBox.map((Creation) => Creation.Instance)).size, 1);
g_Assert.ok(g_vecBox.every((Creation) => Creation.Recipients === g_Recipients));

const g_unBallStart = g_vecCreations.length;
g_Assert.equal(g_Effects.CreateBallEffect(g_Recipients, [0, 0, 10], 2, 2), undefined);
const g_vecBall = g_vecCreations.slice(g_unBallStart);
g_Assert.deepEqual(g_vecBall.map((Creation) => Creation.Properties.Center.Z), [10, 11, 9]);
g_Assert.equal(g_vecBall[0].Properties.StartRadius, 4);
g_Assert.equal(g_vecBall[0].Properties.EndRadius, 3.9);
g_Assert.equal(g_vecBall[1].Properties.StartRadius, 4 * Math.sqrt(0.75));

const g_unDefaultBallStart = g_vecCreations.length;
g_Effects.CreateBallEffect(g_Recipients, [0, 0, 0], 2);
g_Assert.equal(g_vecCreations.length - g_unDefaultBallStart, 29);

const g_unLowerBallStart = g_vecCreations.length;
g_Effects.CreateBallEffect(g_Recipients, [0, 0, 0], 2, 2, false, true);
g_Assert.equal(g_vecCreations.length - g_unLowerBallStart, 2);

g_Assert.throws(() => g_Effects.CreateBeamEffect(g_Recipients, [1, 2], [0, 0, 0]), { name: "TypeError" });
g_Assert.throws(() => g_Effects.CreateBeamEffect(g_Recipients, { Index: -1 }, 0, true), { name: "TypeError" });
g_Assert.throws(() => g_Effects.CreatePolygonEffect(g_Recipients, [[0, 0, 0]]), { name: "TypeError" });
g_Assert.throws(() => g_Effects.CreateSquareEffect(g_Recipients, [], [], null), { name: "TypeError" });
g_Assert.throws(() => g_Effects.CreateBallEffect(g_Recipients, [], 0), { name: "RangeError" });
g_Assert.throws(() => g_Effects.CreateBallEffect(g_Recipients, [], 1, 0), { name: "RangeError" });
g_Assert.throws(() => g_Effects.CreateBallEffect(g_Recipients, [], 1, 1, false, false), { name: "RangeError" });

function VerifyGeometryOptionDataProperties() {
	const vecHelpers = [
		(Options) => g_Effects.CreateBeamEffect(null, [0, 0, 0], [1, 1, 1], false, Options),
		(Options) => g_Effects.CreatePolygonEffect(null, [[0, 0, 0], [1, 0, 0], [1, 1, 0]], false, Options),
		(Options) => g_Effects.CreateSquareEffect(null, [0, 0, 0], [1, 1, 1], Options),
		(Options) => g_Effects.CreateBoxEffect(null, [0, 0, 0], [1, 1, 1], Options),
		(Options) => g_Effects.CreateBallEffect(null, [0, 0, 0], 2, 1, true, false, Options),
	];
	const bOriginalCreationResult = g_bCreationResult;
	let unScenarioCount = 0;
	g_bCreationResult = true;

	try {
		for (const CreateGeometry of vecHelpers) {
			for (const FieldValue of [null, undefined, false, 0, { Marker: true }]) {
				const Options = { Width: 2 };
				let unGetterReadCount = 0;
				Object.defineProperty(Options, "__proto__", {
					enumerable: true,
					get() {
						unGetterReadCount += 1;

						return FieldValue;
					},
				});
				const OptionsPrototype = Object.getPrototypeOf(Options);
				const unInstanceCount = g_vecInstances.length;
				const unCreationCount = g_vecCreations.length;
				CreateGeometry(Options);
				g_Assert.equal(g_vecInstances.length, unInstanceCount + 1);
				g_Assert.equal(unGetterReadCount, 1);
				g_Assert.equal(Object.getPrototypeOf(Options), OptionsPrototype);

				const Values = g_vecInstances.at(-1).Values;
				g_Assert.equal(Object.hasOwn(Values, "__proto__"), true, "Geometry options must preserve an own __proto__ field.");
				const Descriptor = Object.getOwnPropertyDescriptor(Values, "__proto__");
				g_Assert.equal(Descriptor.value, FieldValue);
				g_Assert.equal(Descriptor.enumerable, true);
				g_Assert.equal(Descriptor.writable, true);
				g_Assert.equal(Descriptor.configurable, true);
				g_Assert.equal(Values.Width, 2);
				g_Assert.ok(g_vecCreations.length > unCreationCount);
				for (const Creation of g_vecCreations.slice(unCreationCount)) {
					g_Assert.equal(Object.hasOwn(Creation.Properties, "__proto__"), true);
					g_Assert.equal(Creation.Properties.__proto__, FieldValue);
				}

				unScenarioCount += 1;
			}

			const GetterError = new Error("Controlled geometry option getter failure");
			const Options = {};
			Object.defineProperty(Options, "__proto__", {
				enumerable: true,
				get() {
					throw GetterError;
				},
			});
			const unInstanceCount = g_vecInstances.length;
			const unCreationCount = g_vecCreations.length;
			g_Assert.throws(() => CreateGeometry(Options), (ErrorValue) => ErrorValue === GetterError);
			g_Assert.equal(g_vecInstances.length, unInstanceCount);
			g_Assert.equal(g_vecCreations.length, unCreationCount);
			unScenarioCount += 1;
		}
	} finally {
		g_bCreationResult = bOriginalCreationResult;
	}

	g_Assert.equal(unScenarioCount, 30);
	console.log("Effect geometry option data 30 profiles passed.");
}

VerifyGeometryOptionDataProperties();

console.log("Effect geometry smoke checks passed (actual JS helpers; staging/vector/native doubles, no engine playback).");
