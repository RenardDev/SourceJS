#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strBasePath = g_Path.join(g_strPackageRoot, "effects", "index.js");
const g_DependencyPaths = {
	Colors: g_Path.join(g_strPackageRoot, "colors.js"),
	Entities: g_Path.join(g_strPackageRoot, "entities", "entity.js"),
	Mathlib: g_Path.join(g_strPackageRoot, "mathlib.js"),
	Players: g_Path.join(g_strPackageRoot, "players", "entity.js"),
	Precache: g_Path.join(g_strPackageRoot, "engines", "precache.js"),
	StringTables: g_Path.join(g_strPackageRoot, "stringtables.js"),
	Templates: g_Path.join(g_strPackageRoot, "effects", "templates.js"),
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

function AssertThrows(Callback, Pattern, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert((CaughtError instanceof Error) && Pattern.test(CaughtError.message), strErrorMessage);
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

class ModelPrecacheResource {
	constructor(strModelPath) {
		if (typeof strModelPath !== "string") {
			throw new TypeError("Model path must be a string.");
		}

		this.ResourcePath = strModelPath;
	}
}

class DecalPrecacheResource {
	constructor(strDecalPath) {
		if (typeof strDecalPath !== "string") {
			throw new TypeError("Decal path must be a string.");
		}

		this.ResourcePath = strDecalPath;
	}
}

const g_mapStringTableValues = new Map([
	["modelprecache:2", "models/sourcejs/example.mdl"],
	["decalprecache:1", "decals/sourcejs/example"],
]);
const g_mapDescriptors = new Map([
	["Model", { ValueFields: "ModelIndex", ValueType: "model" }],
	["Decal", { ValueFields: "DecalIndex", ValueType: "decal" }],
	["NativeString", { Path: "FixtureString", Property: { Type: "string" }, ValueType: "property" }],
	["NativeArray", { Path: "FixtureArray", Property: { Type: "array" }, ValueType: "property" }],
	["LegacyProperty", { ValueFields: "FixtureLegacy", Property: { Type: "string" }, ValueType: "property" }],
]);
let g_vecCreationArguments = [];
let g_bReplaceTemplateDuringPreHook = false;
const g_vecCreateLifecycle = [];
const g_ReplacementTemplate = {
	CreateTemporaryEntity() {
		g_vecCreateLifecycle.push("replacement:create");

		return true;
	},
	InvokeTemporaryEntityPostCreateHooks() {
		g_vecCreateLifecycle.push("replacement:post");

		return true;
	},
};
const g_Template = {
	ClassName: "CTEEffectDispatch",
	CreateTemporaryEntity(...vecArguments) {
		g_vecCreateLifecycle.push("template:create");
		g_vecCreationArguments = vecArguments;

		return true;
	},
	FindTemporaryEntityProperty() {
		return null;
	},
	HasTemporaryEntityField(strName) {
		return g_mapDescriptors.has(strName);
	},
	InvokeTemporaryEntityPostCreateHooks() {
		g_vecCreateLifecycle.push("template:post");

		return true;
	},
	InvokeTemporaryEntityPreCreateHooks(TemporaryEntity) {
		g_vecCreateLifecycle.push("template:pre");

		if (g_bReplaceTemplateDuringPreHook) {
			TemporaryEntity.Template = g_ReplacementTemplate;
		}

		return true;
	},
	Name: "SourceJSSmokeEffect",
	ResolveTemporaryEntityField(strName) {
		return g_mapDescriptors.get(strName) ?? null;
	},
};

let g_vecColorConstructorArguments = [];
InstallDependency(g_DependencyPaths.Colors, { Color: class Color {
	constructor(...vecComponents) {
		g_vecColorConstructorArguments = vecComponents;
	}
} });

InstallDependency(g_DependencyPaths.Entities, { Entity: (unIndex) => ({ Index: unIndex }) });

InstallDependency(g_DependencyPaths.Mathlib, {
	QAngle: { CreateMathStructureFromValue: (Value) => Value },
	Vector: { CreateMathStructureFromValue: (Value) => Value },
});

InstallDependency(g_DependencyPaths.Players, { Player: (unIndex) => ({ Index: unIndex }) });

InstallDependency(g_DependencyPaths.Precache, { DecalPrecacheResource, ModelPrecacheResource });

InstallDependency(g_DependencyPaths.StringTables, {
	GetRequiredString(strTableName, unIndex) {
		if ((typeof strTableName !== "string") || !Number.isSafeInteger(unIndex) || (unIndex < 0)) {
			throw new Error(`String table index is not available: ${strTableName}[${String(unIndex)}]`);
		}

		const strValue = g_mapStringTableValues.get(`${strTableName}:${unIndex}`);
		if (strValue === undefined) {
			throw new Error(`String table value is not available: ${strTableName}[${unIndex}]`);
		}

		return strValue;
	},
});

InstallDependency(g_DependencyPaths.Templates, {
	TEMP_ENTITY_TEMPLATES: {
		GetTemporaryEntityTemplate(strName) {
			AssertEqual(strName, "SourceJSSmokeEffect", "template name");

			return g_Template;
		},
	},
});

const g_EffectsBase = require(g_strBasePath);
const { TemporaryEntity, CreateTemporaryEntity } = g_EffectsBase;
const g_Effect = new TemporaryEntity("SourceJSSmokeEffect", { DecalIndex: 1, ModelIndex: 2 });

AssertEqual(Object.keys(g_EffectsBase).join(","), "TemporaryEntity,CreateTemporaryEntity", "effects exact exports");
AssertEqual(g_EffectsBase.TemporaryEntity, TemporaryEntity, "TemporaryEntity export identity");
AssertEqual(g_EffectsBase.CreateTemporaryEntity, CreateTemporaryEntity, "CreateTemporaryEntity export identity");

AssertEqual(g_Effect.Name, "SourceJSSmokeEffect", "staging identity uses public template Name");
AssertEqual(g_Effect.ClassName, "CTEEffectDispatch", "staging identity uses public template ClassName");

AssertEqual(g_Effect.GetTemporaryEntityPropertyString("NativeString"), "", "native Path-only string getter accepts unstaged storage");
AssertEqual(g_Effect.SetTemporaryEntityPropertyString("NativeString", 73), g_Effect, "native Path-only string setter preserves fluent return");
AssertEqual(g_Effect.Values.FixtureString, "73", "native Path-only string setter resolves its storage path");
AssertEqual(g_Effect.GetTemporaryEntityPropertyString("NativeString"), "73", "native Path-only string getter resolves its storage path");

const g_vecNativeArray = [1, 2, 3];
AssertEqual(g_Effect.SetTemporaryEntityPropertyArray("NativeArray", g_vecNativeArray), g_Effect, "native Path-only array setter preserves fluent return");
AssertEqual(g_Effect.GetTemporaryEntityPropertyArray("NativeArray"), g_vecNativeArray, "native Path-only array getter preserves array identity");
AssertEqual(g_Effect.Values.FixtureArray, g_vecNativeArray, "native Path-only array setter uses its storage path");

AssertEqual(g_Effect.SetTemporaryEntityPropertyString("LegacyProperty", "preserved"), g_Effect, "ValueFields-only descriptor remains supported");
AssertEqual(g_Effect.GetTemporaryEntityPropertyString("LegacyProperty"), "preserved", "ValueFields-only descriptor getter remains supported");
AssertEqual(g_Effect.Values.FixtureLegacy, "preserved", "ValueFields-only descriptor resolves its storage path");

Assert(g_Effect.GetTemporaryEntityProperty("Model") instanceof ModelPrecacheResource, "model wrapper");
AssertEqual(g_Effect.GetTemporaryEntityProperty("Model").ResourcePath, "models/sourcejs/example.mdl", "model string-table lookup");
Assert(g_Effect.GetTemporaryEntityProperty("Decal") instanceof DecalPrecacheResource, "decal wrapper");
AssertEqual(g_Effect.GetTemporaryEntityProperty("Decal").ResourcePath, "decals/sourcejs/example", "decal string-table lookup");

g_Effect.SetTemporaryEntityPropertyInteger("ModelIndex", 9);
AssertThrows(() => g_Effect.GetTemporaryEntityProperty("Model"), /modelprecache\[9\]/, "missing model string-table value");
g_Effect.SetTemporaryEntityPropertyInteger("ModelIndex", -1);
AssertThrows(() => g_Effect.GetTemporaryEntityProperty("Model"), /modelprecache\[-1\]/, "invalid model string-table index");
g_Effect.SetTemporaryEntityPropertyInteger("DecalIndex", 9);
AssertThrows(() => g_Effect.GetTemporaryEntityProperty("Decal"), /decalprecache\[9\]/, "missing decal string-table value");
AssertThrows(() => g_Effect.GetTemporaryEntityProperty(7), /property names/, "property names should reject scalar coercion");

g_Effect.GetTemporaryEntityColorProperty(["Red", "Green", "Blue", "Alpha"]);
AssertEqual(g_vecColorConstructorArguments.join(","), "0,0,0,255", "missing color components retain opaque alpha");
g_Effect.SetStoredTemporaryEntityValue("Alpha", 64);
g_Effect.GetTemporaryEntityColorProperty(["Red", "Green", "Blue", "Alpha"]);
AssertEqual(g_vecColorConstructorArguments.join(","), "0,0,0,64", "stored alpha overrides the opaque default");

AssertEqual(g_Effect.SetTemporaryEntityPropertyFloat("FloatValue", "1.25"), g_Effect, "float coercion preserves fluent return");
AssertEqual(g_Effect.GetTemporaryEntityPropertyFloat("FloatValue"), 1.25, "float setter accepts string input");
g_Effect.SetTemporaryEntityPropertyInteger("IntegerValue", "17trailing");
AssertEqual(g_Effect.GetTemporaryEntityPropertyInteger("IntegerValue"), 17, "integer setter accepts a decimal prefix");
g_Effect.SetTemporaryEntityPropertyInteger("IntegerValue", "0x10");
AssertEqual(g_Effect.GetTemporaryEntityPropertyInteger("IntegerValue"), 0, "integer setter retains explicit decimal radix");
g_Effect.SetTemporaryEntityPropertyString("StringValue", null);
AssertEqual(g_Effect.GetTemporaryEntityPropertyString("StringValue"), "null", "string setter retains null conversion");
g_Effect.SetTemporaryEntityPropertyString("StringValue", undefined);
AssertEqual(g_Effect.GetTemporaryEntityPropertyString("StringValue"), "undefined", "string setter retains undefined conversion");

const g_DelayToken = {};
const g_ReliableToken = {};
Assert(g_Effect.CreateTemporaryEntity(undefined, g_DelayToken, undefined, g_ReliableToken), "effect create result");
AssertEqual(g_vecCreationArguments[2], g_DelayToken, "effect delay native pass-through");
AssertEqual(g_vecCreationArguments[3], g_ReliableToken, "effect reliable native pass-through");
AssertEqual(typeof g_Effect.toJSON, "undefined", "TemporaryEntity should not expose snapshots");

g_vecCreateLifecycle.length = 0;
g_bReplaceTemplateDuringPreHook = true;
g_Effect.Template = g_Template;
g_Effect.CreateTemporaryEntity();

AssertEqual(g_vecCreateLifecycle.join(","), "template:pre,template:create,template:post", "operation-consistent template lifecycle");
AssertEqual(g_Effect.Template, g_ReplacementTemplate, "pre-hook template mutation should remain live after create");

g_vecCreateLifecycle.length = 0;
g_bReplaceTemplateDuringPreHook = false;

Assert(CreateTemporaryEntity("SourceJSSmokeEffect", { ModelIndex: 2 }, [1], g_DelayToken, g_ReliableToken), "factory create result");
AssertEqual(g_vecCreationArguments[0].ModelIndex, 2, "factory property values");
AssertEqual(g_vecCreationArguments[1][0], 1, "factory recipients");
AssertEqual(g_vecCreationArguments[2], g_DelayToken, "factory delay pass-through");
AssertEqual(g_vecCreationArguments[3], g_ReliableToken, "factory reliable pass-through");

console.log("[smoke_effects_base] ok");
