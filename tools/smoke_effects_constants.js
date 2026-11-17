#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strEffectsPath = g_Path.join(g_strPackageRoot, "effects.js");

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertApproximate(flActualValue, flExpectedValue, strErrorMessage) {
	if (!Number.isFinite(flActualValue) || !Number.isFinite(flExpectedValue) || (Math.abs(flActualValue - flExpectedValue) > Number.EPSILON)) {
		throw new Error(`${strErrorMessage}: expected ${String(flExpectedValue)}, got ${String(flActualValue)}`);
	}
}

function InstallDependency(strRelativePath, ModuleExports) {
	const strFilePath = g_Path.join(g_strPackageRoot, strRelativePath);
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

const g_vecInvalidApproximateCases = [
	{ ActualValue: NaN, ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: NaN },
	{ ActualValue: Infinity, ExpectedValue: Infinity },
	{ ActualValue: -Infinity, ExpectedValue: -Infinity },
	{ ActualValue: Infinity, ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: Infinity },
	{ ActualValue: -Infinity, ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: -Infinity },
	{ ActualValue: "0", ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: "0" },
	{ ActualValue: null, ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: null },
	{ ActualValue: undefined, ExpectedValue: 0 },
	{ ActualValue: 0, ExpectedValue: undefined },
	{ ActualValue: Number.EPSILON * 2, ExpectedValue: 0 },
];
for (const InvalidCase of g_vecInvalidApproximateCases) {
	let CaughtError = null;

	try {
		AssertApproximate(InvalidCase.ActualValue, InvalidCase.ExpectedValue, "Invalid approximate input");
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	AssertEqual(CaughtError instanceof Error, true, "approximate comparisons reject invalid or out-of-tolerance inputs");
	AssertEqual(CaughtError.message, `Invalid approximate input: expected ${String(InvalidCase.ExpectedValue)}, got ${String(InvalidCase.ActualValue)}`, "approximate comparison diagnostic");
}

AssertApproximate(0, 0, "exact approximate comparison");
AssertApproximate(Number.EPSILON, 0, "inclusive approximate comparison tolerance");

const g_vecCreatedTemporaryEntities = [];

class TemporaryEntity {
	constructor(strName, Values) {
		this.Name = strName;
		this.Values = { ...Values };
		this.Creations = [];
		g_vecCreatedTemporaryEntities.push(this);
	}

	SetTemporaryEntityProperty(strName, Value) {
		this.Values[strName] = Value;

		return this;
	}

	CreateTemporaryEntity(vecRecipients, flEffectDelay, Values, bReliableDelivery) {
		this.Creations.push({
			Delay: flEffectDelay,
			Recipients: vecRecipients,
			Reliable: bReliableDelivery,
			Values,
			Properties: { ...this.Values },
		});

		return true;
	}
}

class TemporaryEntityPreCreateHook {
}

class TemporaryEntityPostCreateHook {
}

class TemporaryEntityTemplate {
}

class TemporaryEntityTemplateCollection {
}

const TEMP_ENTITY_TEMPLATES = {
	GetTemporaryEntityTemplate() {
		return {
			GetTemporaryEntityTemplate: () => TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate(),
		};
	},
};

const g_BloodColor = { DONT_BLEED: -1, GREEN: 2, MECH: 3, RED: 0, YELLOW: 1 };
const g_ShatterSurface = { GLASS: 0, TILE: 1 };
const g_NativeEffects = {
	BloodColor: g_BloodColor,
	ShatterSurface: g_ShatterSurface,
	ExtraNativeValue: 7,
	CreateTempEntity() {
		return true;
	},
	GetProperty() {
		return null;
	},
	GetTempEntity() {
		return null;
	},
	PrecacheDecal() {
		return 1;
	},
	PrecacheGeneric() {
		return 2;
	},
	PrecacheModel() {
		return 3;
	},
};

InstallDependency(g_Path.join("effects", "index.js"), {
	TemporaryEntity,
	CreateTemporaryEntity: g_NativeEffects.CreateTempEntity,
});

InstallDependency(g_Path.join("effects", "hooks.js"), {
	TemporaryEntityPostCreateHook,
	TemporaryEntityPreCreateHook,
	RegisterTemporaryEntityPostCreateHook: () => new TemporaryEntityPostCreateHook(),
	RegisterTemporaryEntityPreCreateHook: () => new TemporaryEntityPreCreateHook(),
});

InstallDependency(g_Path.join("effects", "templates.js"), {
	TEMP_ENTITY_TEMPLATES,
	TemporaryEntityTemplate,
	TemporaryEntityTemplateCollection,
	GetTemporaryEntityTemplate: () => TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate(),
	GetTemporaryEntityTemplates: () => [],
});

InstallDependency(g_Path.join("entities", "entity.js"), {
	Entity(unIndex) {
		return { Index: unIndex, Origin: { X: 0, Y: 0, Z: 0 } };
	},
});

InstallDependency(g_Path.join("mathlib.js"), {
	Vector: class Vector {
		constructor(flX, flY, flZ) {
			this.X = flX;
			this.Y = flY;
			this.Z = flZ;
		}

		static CreateMathStructureFromValue(Value) {
			return (Value instanceof this) ? Value : new this(Value[0] ?? Value.X, Value[1] ?? Value.Y, Value[2] ?? Value.Z);
		}

		ConvertMathStructureToArray() {
			return [this.X, this.Y, this.Z];
		}
	},
});

globalThis.sourcejs = {
	effects: g_NativeEffects,
};

try {
	const Effects = require(g_strEffectsPath);
	AssertEqual(Effects === g_NativeEffects, false, "effects must expose a canonical API object");
	AssertEqual(Effects.BloodColor, g_BloodColor, "BloodColor exact native identity");
	AssertEqual(Effects.ShatterSurface, g_ShatterSurface, "ShatterSurface exact native identity");
	AssertEqual(Effects.BloodColor.RED, 0, "BloodColor.RED");
	AssertEqual(Effects.BloodColor.MECH, 3, "BloodColor.MECH");
	AssertEqual(Effects.ShatterSurface.GLASS, 0, "ShatterSurface.GLASS");
	AssertEqual(Effects.TEMP_ENTITY_TEMPLATES, TEMP_ENTITY_TEMPLATES, "template registry identity");
	AssertEqual(Effects.TemporaryEntity, TemporaryEntity, "TemporaryEntity direct export");
	AssertEqual(Effects.CreateTemporaryEntity, g_NativeEffects.CreateTempEntity, "CreateTemporaryEntity canonical export");
	AssertEqual(Effects.TemporaryEntityTemplateCollection, TemporaryEntityTemplateCollection, "template collection class export");
	AssertEqual(Object.hasOwn(Effects, "ModuleName"), false, "effects should not expose ModuleName");
	AssertEqual(Object.hasOwn(Effects, "ExtraNativeValue"), false, "effects should not expose native implementation fields");
	AssertEqual(Object.hasOwn(Effects, "CreateTempEntity"), false, "effects should not expose native implementation functions");
	AssertEqual(Object.hasOwn(Effects.BloodColor, "Red"), false, "BloodColor should not expose legacy aliases");

	Effects.JavaScriptMutation = 11;
	AssertEqual(Object.hasOwn(g_NativeEffects, "JavaScriptMutation"), false, "canonical API mutation must not update native runtime");

	g_NativeEffects.NativeMutation = 13;
	AssertEqual(Object.hasOwn(Effects, "NativeMutation"), false, "native mutation must not leak through canonical API");

	Effects.CreateBallEffect([1], { X: 0, Y: 0, Z: 64 }, 4, 2, true, false, { Model: "beam.vmt" });
	const UpperBall = g_vecCreatedTemporaryEntities.at(-1);
	AssertEqual(UpperBall.Name, "BeamRingPoint", "ball temp entity name");
	AssertEqual(UpperBall.Creations.length, 2, "upper ball ring count");
	AssertEqual(UpperBall.Creations[0].Properties.StartRadius, 8, "ball equator diameter");
	AssertEqual(UpperBall.Creations[0].Properties.EndRadius, 7.9, "ball equator end diameter");
	AssertEqual(UpperBall.Creations[0].Properties.Center.Z, 64, "ball equator height");
	AssertApproximate(UpperBall.Creations[1].Properties.StartRadius, 8 * Math.sqrt(0.75), "ball upper ring diameter");
	AssertEqual(UpperBall.Creations[1].Properties.Center.Z, 66, "ball upper ring height");

	Effects.CreateBallEffect([1], { X: 0, Y: 0, Z: 64 }, 4, 2, false, true);
	const LowerBall = g_vecCreatedTemporaryEntities.at(-1);
	AssertEqual(LowerBall.Creations.length, 2, "lower ball ring count");
	AssertEqual(LowerBall.Creations[0].Properties.StartRadius, 8, "lower ball equator diameter");
	AssertEqual(LowerBall.Creations[0].Properties.Center.Z, 64, "lower ball equator height");
	AssertEqual(LowerBall.Creations[1].Properties.Center.Z, 62, "lower ball ring height");

	const strTemporaryEntityPath = g_Path.join(g_strPackageRoot, "effects", "index.js");
	const strKnownModelPath = "beam.vmt";
	const strMissingModelPath = "missing.vmt";
	const unPrecachedModelIndex = 7;
	const unExplicitModelIndex = 12;
	const vecPrecacheCalls = [];
	const Template = {
		Name: "BeamRingPoint",
		ClassName: "CTEBeamRingPoint",
		ResolveTemporaryEntityField(strField) {
			return (strField === "Model") ? { ValueType: "model", ValueFields: "ModelIndex" } : null;
		},
	};
	const mapDependencies = new Map([
		["colors", {}],
		["effects/templates", { TEMP_ENTITY_TEMPLATES: { GetTemporaryEntityTemplate: () => Template } }],
		["engines/precache", {
			PrecacheModel(strModelPath) {
				vecPrecacheCalls.push(strModelPath);

				return (strModelPath === strKnownModelPath) ? unPrecachedModelIndex : 0;
			},
		}],
		["entities/entity", {}],
		["mathlib", {}],
		["players/entity", {}],
		["stringtables", {}],
	]);

	const Module = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(strTemporaryEntityPath, "utf8"), {
		module: Module,
		require(strName) {
			g_Assert(mapDependencies.has(strName), strName);

			return mapDependencies.get(strName);
		},
	}, { filename: strTemporaryEntityPath });

	const Beam = new Module.exports.TemporaryEntity("BeamRingPoint", { Model: strKnownModelPath });
	g_Assert.equal(Beam.Values.ModelIndex, unPrecachedModelIndex);

	Beam.SetTemporaryEntityProperty("Model", unExplicitModelIndex);
	g_Assert.equal(Beam.Values.ModelIndex, unExplicitModelIndex);

	g_Assert.throws(() => Beam.SetTemporaryEntityProperty("Model", strMissingModelPath), /Could not precache effect model/);
	g_Assert.equal(Beam.Values.ModelIndex, unExplicitModelIndex);
	g_Assert.deepEqual(vecPrecacheCalls, [strKnownModelPath, strMissingModelPath]);

	console.log("[smoke_effects_constants] ok");
} finally {
	delete globalThis.sourcejs;
}
