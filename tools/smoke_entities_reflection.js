#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strClassesDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-classes.md");
const g_strClassesPath = g_Path.join(g_strPackageRoot, "entities", "classes.js");
const g_strPropertiesPath = g_Path.join(g_strPackageRoot, "entities", "props.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");

// Controlled reflection fixtures use synthetic addresses; no native SDK execution or ABI proof.
const g_unEntityAddressBase = 0x100000n;
const g_unEntityAddressStride = 0x100n;
const g_unDataTableProxyFunctionAddressBase = 0x7000n;
const g_unPropertyProxyFunctionAddressBase = 0x7100n;
const g_unVectorAddress = 0x1000n;
const g_unPropertyAddress = 0x2000n;
const g_unUnsignedSendPropertyFlag = 0x1;
const g_unUnsignedCharacterMaximum = 0xFF;
const g_unPropertyEntityIndex = 2;
const g_unAddressPropertyOffset = 0x300;
const g_unCharacterPropertyOffset = 0x304;
const g_unVectorPropertyOffset = 0x308;
const g_unHealthPropertyOffset = 0x64;
const g_nNativeIntegerMinimum = -0x80000000;
const g_nNativeIntegerMaximum = 0x7FFFFFFF;

const g_vecReflectionExpectedExports = [
	"SERVER_CLASSES",
	"ServerClassCollection",
	"ServerClassGenerator",
	"GetEntityClassName",
	"GetEntityClassNames",
	"GetEntitiesByClassName",
	"GetEntitySendProperty",
	"FindServerClass",
	"FindServerClassByName",
	"FindServerClassPropertyOffset",
	"GetEntityServerClass",
	"GetSendTable",
	"GetServerClassProperty",
	"GetServerClassProperties",
	"GetServerClassSendTable",
	"GetServerClasses",
	"GetServerClassBaseClassNames",
];
const g_mapTableDefinitions = new Map([
	["DT_BaseEntity", {
		Initialized: true,
		Address: 0x5100n,
		Properties: [
			{ BitCount: 10, HighValue: 1023, Name: "m_iHealth", Offset: g_unHealthPropertyOffset, Address: 0x6100n, Signed: true, Type: "int", TypeID: 0 },
			{ BitCount: 0, Name: "m_vecOrigin", Offset: 0x78, Address: 0x6104n, Signed: true, Type: "vector", TypeID: 2 },
		],
		ServerClassName: "CBaseEntity",
		WriteFlag: false,
	}],
	["DT_DynamicProp", {
		Initialized: true,
		Address: 0x5200n,
		Properties: [
			{ DataTableName: "DT_BaseEntity", Name: "baseclass", Offset: 0x0, Address: 0x6200n, Signed: false, Type: "datatable", TypeID: 6 },
			{ BitCount: 1, HighValue: 1, Name: "m_bDisabled", Offset: 0xC8, Address: 0x6204n, Signed: false, Type: "int", TypeID: 0 },
		],
		ServerClassName: "CDynamicProp",
		WriteFlag: false,
	}],
	["DT_TerrorPlayer", {
		Initialized: true,
		Address: 0x5300n,
		Properties: [
			{ DataTableName: "DT_BaseEntity", Name: "baseclass", Offset: 0x0, Address: 0x6300n, Signed: false, Type: "datatable", TypeID: 6 },
			{ BitCount: 5, HighValue: 31, Name: "m_iTeamNum", Offset: 0x12C, Address: 0x6304n, Signed: true, Type: "int", TypeID: 0 },
		],
		ServerClassName: "CTerrorPlayer",
		WriteFlag: false,
	}],
]);
const g_mapServerClassDefinitions = new Map([
	["CBaseEntity", { ClassIndex: 0, InstanceBaselineIndex: 10, NextAddress: 0x4200n, Address: 0x4100n, TableName: "DT_BaseEntity" }],
	["CDynamicProp", { ClassIndex: 1, InstanceBaselineIndex: 11, NextAddress: 0x4300n, Address: 0x4200n, TableName: "DT_DynamicProp" }],
	["CTerrorPlayer", { ClassIndex: 2, InstanceBaselineIndex: 12, NextAddress: 0n, Address: 0x4300n, TableName: "DT_TerrorPlayer" }],
]);
const g_vecEntityStates = [
	{ ClassName: "worldspawn", Health: 0, Index: 0, ServerClassName: "CBaseEntity" },
	{ ClassName: "player", Health: 80, Index: 1, ServerClassName: "CTerrorPlayer" },
	{ ClassName: "prop_dynamic", Health: 100, Index: 2, ServerClassName: "CDynamicProp" },
	{ ClassName: "prop_dynamic", Health: 250, Index: 3, ServerClassName: "CDynamicProp" },
];

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

function MakeSendProperty(PropertyDefinition, strTableName, strPathValue, unOffsetValue) {
	return {
		ArrayLengthProxyFunctionAddress: 0n,
		ArrayPropertyAddress: 0n,
		BitCount: PropertyDefinition.BitCount ?? 0,
		DataTable: PropertyDefinition.DataTableName ? MakeSendTable(PropertyDefinition.DataTableName, false) : null,
		DataTableProxyFunctionAddress: PropertyDefinition.DataTableName ? (g_unDataTableProxyFunctionAddressBase + BigInt(PropertyDefinition.Offset)) : 0n,
		ElementStride: 0,
		ExcludeDataTableName: "",
		ExcludedProperty: false,
		Flags: PropertyDefinition.Signed ? 0 : g_unUnsignedSendPropertyFlag,
		HighLowMultiplier: 0,
		HighValue: PropertyDefinition.HighValue ?? 0,
		Index: g_mapTableDefinitions.get(strTableName).Properties.indexOf(PropertyDefinition),
		InsideArray: false,
		Kind: "sendprop",
		ArrayLength: 0,
		LowValue: 0,
		Name: PropertyDefinition.Name,
		Offset: unOffsetValue,
		ParentArrayPropertyName: "",
		Path: strPathValue,
		Address: PropertyDefinition.Address,
		ProxyFunctionAddress: PropertyDefinition.DataTableName ? 0n : (g_unPropertyProxyFunctionAddressBase + BigInt(PropertyDefinition.Offset)),
		ServerClassName: g_mapTableDefinitions.get(strTableName).ServerClassName,
		Signed: PropertyDefinition.Signed,
		TableName: strTableName,
		Type: PropertyDefinition.Type,
		TypeID: PropertyDefinition.TypeID,
	};
}

function MakeSendTable(strTableName, bIncludeProperties = true) {
	const TableDefinition = g_mapTableDefinitions.get(strTableName);
	if (!TableDefinition) {
		return null;
	}

	return {
		Initialized: TableDefinition.Initialized,
		Kind: "sendtable",
		PropertyCount: TableDefinition.Properties.length,
		Name: strTableName,
		Address: TableDefinition.Address,
		Properties: bIncludeProperties ? TableDefinition.Properties.map((PropertyDefinition) => MakeSendProperty(PropertyDefinition, strTableName, PropertyDefinition.Name, PropertyDefinition.Offset)) : [],
		PropertiesEncodedAgainstTickCount: true,
		ServerClassName: TableDefinition.ServerClassName,
		WriteFlag: TableDefinition.WriteFlag,
	};
}

function MakeServerClass(strServerClassName) {
	const ServerClassDefinition = g_mapServerClassDefinitions.get(strServerClassName);
	if (!ServerClassDefinition) {
		return null;
	}

	return { ClassIndex: ServerClassDefinition.ClassIndex, InstanceBaselineIndex: ServerClassDefinition.InstanceBaselineIndex, Kind: "serverclass", Name: strServerClassName, NextAddress: ServerClassDefinition.NextAddress, Address: ServerClassDefinition.Address, Table: MakeSendTable(ServerClassDefinition.TableName) };
}

function IsNativeIntegerValue(Value) {
	return Number.isInteger(Value) && (Value >= g_nNativeIntegerMinimum) && (Value <= g_nNativeIntegerMaximum);
}

function GetEntityStateFromValue(Value, bAllowAddress = false) {
	if (IsNativeIntegerValue(Value)) {
		return g_vecEntityStates.find((EntityState) => EntityState.Index === Value) ?? null;
	}

	if (Value && ((typeof Value === "object") || (typeof Value === "function"))) {
		const nEntityIndex = Value.Index;
		return IsNativeIntegerValue(nEntityIndex) ? (g_vecEntityStates.find((EntityState) => EntityState.Index === nEntityIndex) ?? null) : null;
	}

	if (bAllowAddress && (typeof Value === "bigint")) {
		return g_vecEntityStates.find((EntityState) => (g_unEntityAddressBase + BigInt(EntityState.Index) * g_unEntityAddressStride) === Value) ?? null;
	}

	return null;
}

// This registry models only the synthetic fixture graph, not native address readability or storage safety.
function GetTableNameFromValue(Value) {
	const EntityState = GetEntityStateFromValue(Value, true);
	if (EntityState) {
		return g_mapServerClassDefinitions.get(EntityState.ServerClassName)?.TableName ?? null;
	}

	if (typeof Value === "string") {
		return g_mapServerClassDefinitions.get(Value)?.TableName ?? (g_mapTableDefinitions.has(Value) ? Value : null);
	}

	if (typeof Value === "bigint") {
		for (const ServerClassDefinition of g_mapServerClassDefinitions.values()) {
			if (ServerClassDefinition.Address === Value) {
				return ServerClassDefinition.TableName;
			}
		}

		for (const [strTableName, TableDefinition] of g_mapTableDefinitions) {
			if (TableDefinition.Address === Value) {
				return strTableName;
			}
		}

		return null;
	}

	if (!Value || ((typeof Value !== "object") && (typeof Value !== "function"))) {
		return null;
	}

	if (Value.Kind === "serverclass") {
		return g_mapServerClassDefinitions.get(Value.Name)?.TableName ?? null;
	}

	if (Value.Kind === "sendtable") {
		return g_mapTableDefinitions.has(Value.Name) ? Value.Name : null;
	}

	if (Value.ServerClassName) {
		return g_mapServerClassDefinitions.get(Value.ServerClassName)?.TableName ?? null;
	}

	return null;
}

function CollectProperties(strTableName, unBaseOffset = 0x0, strBasePath = "", setVisited = new Set()) {
	if (setVisited.has(strTableName)) {
		return [];
	}

	const TableDefinition = g_mapTableDefinitions.get(strTableName);
	if (!TableDefinition) {
		return [];
	}

	const setNextVisited = new Set(setVisited);
	const vecProperties = [];

	setNextVisited.add(strTableName);

	for (const PropertyDefinition of TableDefinition.Properties) {
		const strPropertyPath = strBasePath ? `${strBasePath}.${PropertyDefinition.Name}` : PropertyDefinition.Name;
		const unPropertyOffset = unBaseOffset + PropertyDefinition.Offset;

		vecProperties.push(MakeSendProperty(PropertyDefinition, strTableName, strPropertyPath, unPropertyOffset));

		if (PropertyDefinition.DataTableName) {
			vecProperties.push(...CollectProperties(PropertyDefinition.DataTableName, unPropertyOffset, strPropertyPath, setNextVisited));
		}
	}

	return vecProperties;
}

function MakeEntity(EntityState) {
	return {
		Kind: "baseentity",
		ClassName: EntityState.ClassName,
		GetEntityPropertyInteger(strPropertyName) {
			if ((strPropertyName === "m_iHealth") || strPropertyName.endsWith(".m_iHealth")) {
				return EntityState.Health;
			}

			throw new TypeError(`Unknown integer property: ${strPropertyName}`);
		},
		Index: EntityState.Index,
		Address: g_unEntityAddressBase + BigInt(EntityState.Index) * g_unEntityAddressStride,
		ServerClassName: EntityState.ServerClassName,
		Valid: true,
	};
}

function RequireReflectionName(strValue, strOperation) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new Error(`${strOperation} expects a non-empty string.`);
	}

	return strValue;
}

const g_NativeClasses = {
	GetEntitiesByClassName(strClassName) {
		const strExpectedClassName = RequireReflectionName(strClassName, "GetEntitiesByClassName");

		return g_vecEntityStates.filter((EntityState) => EntityState.ClassName === strExpectedClassName).map(MakeEntity);
	},
	GetEntityClassName(EntityValue) {
		if (arguments.length === 0) {
			throw new Error("GetEntityClassName(EntityValue) expects an entity value.");
		}

		return GetEntityStateFromValue(EntityValue)?.ClassName ?? "";
	},
	GetEntitySendProperty(EntityValue, strPropertyName) {
		if (arguments.length < 2) {
			throw new Error("GetEntitySendProperty(EntityValue, strPropertyName) requires two arguments.");
		}

		const EntityState = GetEntityStateFromValue(EntityValue, true);
		const strTableName = EntityState ? g_mapServerClassDefinitions.get(EntityState.ServerClassName)?.TableName : null;

		return strTableName ? g_NativeClasses.GetServerClassProperty(strTableName, strPropertyName) : null;
	},
	FindServerClassPropertyOffset(Value, strPropertyName) {
		if (arguments.length < 2) {
			throw new Error("FindServerClassPropertyOffset(Value, strPropertyName) requires two arguments.");
		}

		const strTableName = GetTableNameFromValue(Value);
		if (!strTableName) {
			return -1;
		}

		const strName = RequireReflectionName(strPropertyName, "FindServerClassPropertyOffset");

		return g_NativeClasses.GetServerClassProperty(strTableName, strName)?.Offset ?? -1;
	},
	FindServerClass(strServerClassName) {
		return MakeServerClass(RequireReflectionName(strServerClassName, "FindServerClass"));
	},
	FindServerClassByName(strServerClassName) {
		return MakeServerClass(RequireReflectionName(strServerClassName, "FindServerClass"));
	},
	GetServerClassProperty(Value, NameOrIndex) {
		if (arguments.length < 2) {
			throw new Error("GetServerClassProperty(Value, NameOrIndex) requires two arguments.");
		}

		const strTableName = GetTableNameFromValue(Value);
		if (!strTableName) {
			return null;
		}

		if (typeof NameOrIndex === "number") {
			if (!IsNativeIntegerValue(NameOrIndex)) {
				throw new Error("GetServerClassProperty(Value, NameOrIndex) requires a signed native integer property index.");
			}

			const vecPropertyDefinitions = g_mapTableDefinitions.get(strTableName).Properties;
			if ((NameOrIndex < 0) || (NameOrIndex >= vecPropertyDefinitions.length)) {
				return null;
			}

			const PropertyDefinition = vecPropertyDefinitions[NameOrIndex];

			return PropertyDefinition ? MakeSendProperty(PropertyDefinition, strTableName, PropertyDefinition.Name, PropertyDefinition.Offset) : null;
		}

		const strPropertyName = RequireReflectionName(NameOrIndex, "GetServerClassProperty");

		return CollectProperties(strTableName).find((Property) => (Property.Name === strPropertyName) || (Property.Path === strPropertyName)) ?? null;
	},
	GetSendTable(Value) {
		if (arguments.length === 0) {
			throw new Error("GetSendTable(Value) requires a class, table or entity.");
		}

		const strTableName = GetTableNameFromValue(Value);

		return strTableName ? MakeSendTable(strTableName) : null;
	},
	GetEntityClassNames() {
		return Array.from(new Set(g_vecEntityStates.map((EntityState) => EntityState.ClassName)));
	},
	GetServerClassProperties(Value) {
		if (arguments.length === 0) {
			throw new Error("GetServerClassProperties(Value) requires a class, table or entity.");
		}

		const strTableName = GetTableNameFromValue(Value);

		return strTableName ? CollectProperties(strTableName) : [];
	},
	GetServerClasses() {
		return Array.from(g_mapServerClassDefinitions.keys(), MakeServerClass);
	},
	GetServerClassSendTable(EntityValue) {
		if (arguments.length === 0) {
			throw new Error("GetServerClassSendTable(EntityValue) requires an entity.");
		}

		const EntityState = GetEntityStateFromValue(EntityValue, true);
		const strTableName = EntityState ? g_mapServerClassDefinitions.get(EntityState.ServerClassName)?.TableName : null;

		return strTableName ? MakeSendTable(strTableName) : null;
	},
	GetEntityServerClass(EntityValue) {
		if (arguments.length === 0) {
			throw new Error("GetEntityServerClass(EntityValue) requires an entity.");
		}

		const EntityState = GetEntityStateFromValue(EntityValue, true);

		return EntityState ? MakeServerClass(EntityState.ServerClassName) : null;
	},
};

const g_vecVectorComponents = [1, 2, 3];
const g_VectorView = { Address: g_unVectorAddress };

for (const [unComponentIndex, strComponentName] of ["X", "Y", "Z"].entries()) {
	Object.defineProperty(g_VectorView, strComponentName, {
		enumerable: true,
		get() {
			return g_vecVectorComponents[unComponentIndex];
		},
		set(dblValue) {
			g_vecVectorComponents[unComponentIndex] = dblValue;
		},
	});
}

// These return-value doubles validate forwarded argument roles, not native storage.
function AssertPropertyRequest(EntityValue, PropertyValue, unExpectedOffset) {
	g_Assert.equal(EntityValue?.Index, g_unPropertyEntityIndex, "Property getters must receive the requested entity.");
	g_Assert.equal(PropertyValue?.Offset, unExpectedOffset, "Property getters must receive the requested selector.");
}

const g_NativeProperties = {
	SPROP_UNSIGNED: g_unUnsignedSendPropertyFlag,
	SendPropFlags: { CHANGES_OFTEN: 0x8000, COORD: 0x2, UNSIGNED: g_unUnsignedSendPropertyFlag },
	SendPropType: { DATA_TABLE: 6, FLOAT: 1, INT: 0, VECTOR: 2 },
	GetEntityPropertyAddress(EntityValue, PropertyValue) {
		AssertPropertyRequest(EntityValue, PropertyValue, g_unAddressPropertyOffset);

		return g_unPropertyAddress;
	},
	GetEntityPropertyUnsignedCharacter(EntityValue, PropertyValue) {
		AssertPropertyRequest(EntityValue, PropertyValue, g_unCharacterPropertyOffset);

		return g_unUnsignedCharacterMaximum;
	},
	GetEntityPropertyVector(EntityValue, PropertyValue) {
		AssertPropertyRequest(EntityValue, PropertyValue, g_unVectorPropertyOffset);

		return g_VectorView;
	},
};

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function TrackModule(ModuleExports, setReferencedExports) {
	const TrackedExports = {};

	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setReferencedExports.add(strName);

				if (typeof Value !== "function") {
					return Value;
				}

				function TrackedFunction(...vecArguments) {
					setReferencedExports.add(strName);

					if (new.target) {
						return Reflect.construct(Value, vecArguments, Value);
					}

					return Value(...vecArguments);
				}

				TrackedFunction.prototype = Value.prototype;

				return TrackedFunction;
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\n})`, { filename: `entities-classes.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Entity class documentation must use the typed logger.");
		},
	};

	Callback(DocumentationRequire, DocumentationConsole);
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Entity class documentation must use the typed logger\./);

globalThis.sourcejs = { "entities/classes": g_NativeClasses, "entities/props": g_NativeProperties };

delete require.cache[g_strClassesPath];
delete require.cache[g_strPropertiesPath];

const g_Classes = require(g_strClassesPath);
const g_Properties = require(g_strPropertiesPath);

g_Assert.strictEqual(g_Classes, g_NativeClasses);
g_Assert.deepEqual(Object.keys(g_Classes).sort(), g_vecReflectionExpectedExports.slice().sort());
g_Assert.strictEqual(g_Properties, g_NativeProperties);
g_Assert.equal(g_Properties.SendPropType.DATA_TABLE, 6);

const g_PropertyEntity = MakeEntity(g_vecEntityStates[g_unPropertyEntityIndex]);
const g_AddressProperty = { Offset: g_unAddressPropertyOffset };
const g_CharacterProperty = { Offset: g_unCharacterPropertyOffset };
const g_VectorProperty = { Offset: g_unVectorPropertyOffset };

g_Assert.equal(g_Properties.SendPropFlags.CHANGES_OFTEN, 0x8000);
g_Assert.equal(g_Properties.SPROP_UNSIGNED, 0x1, "The controlled SDK unsigned flag must retain its bit value.");
g_Assert.equal(g_Properties.SendPropFlags.UNSIGNED, 0x1, "The controlled SDK unsigned flag must retain its bit value.");
g_Assert.equal(g_Properties.GetEntityPropertyUnsignedCharacter(g_PropertyEntity, g_CharacterProperty), 255, "Unsigned character results must remain byte-sized Numbers.");
g_Assert.equal(g_Properties.GetEntityPropertyAddress(g_PropertyEntity, g_AddressProperty), 0x2000n, "Property addresses must retain BigInt identity.");
g_Assert.equal(typeof g_Properties.GetEntityPropertyAddress(g_PropertyEntity, g_AddressProperty), "bigint");
// Legacy facade metadata is intentionally absent; these names are negative cases.
g_Assert.equal(Object.hasOwn(g_Properties, "available"), false);
g_Assert.equal(Object.hasOwn(g_Properties, "runtime"), false);
g_Assert.equal(Object.hasOwn(g_Properties, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_Properties, "default"), false);

const g_Vector = g_Properties.GetEntityPropertyVector(g_PropertyEntity, g_VectorProperty);
g_Assert.strictEqual(g_Vector, g_VectorView);
g_Assert.equal(g_Vector.Address, 0x1000n, "Vector view addresses must remain BigInt.");
g_Assert.equal(typeof g_Vector.Address, "bigint");

g_Vector.X = 12.5;
g_Assert.equal(g_vecVectorComponents[0], 12.5);

g_vecVectorComponents[1] = -4;
g_Assert.equal(g_Vector.Y, -4);

const g_DynamicPropClass = g_Classes.FindServerClass("CDynamicProp");
g_Assert.deepEqual(g_Classes.FindServerClassByName("CDynamicProp"), g_DynamicPropClass, "The native compatibility spelling must preserve the same lookup result.");
g_Assert.equal(typeof g_DynamicPropClass.Address, "bigint", "Reflection server-class addresses must remain BigInt.");
g_Assert.equal(typeof g_DynamicPropClass.NextAddress, "bigint", "Reflection next-class addresses must remain BigInt.");
g_Assert.equal(typeof g_DynamicPropClass.Table.Address, "bigint", "Reflection table addresses must remain BigInt.");

const g_HealthProperty = g_Classes.GetServerClassProperty(g_DynamicPropClass, "m_iHealth");
g_Assert.equal(g_HealthProperty.Path, "baseclass.m_iHealth");
g_Assert.equal(g_HealthProperty.Offset, g_unHealthPropertyOffset);
g_Assert.equal(typeof g_HealthProperty.Address, "bigint", "Reflection property addresses must remain BigInt.");
g_Assert.equal(typeof g_HealthProperty.ProxyFunctionAddress, "bigint", "Reflection proxy addresses must remain BigInt.");
g_Assert.equal(g_HealthProperty.ArrayPropertyAddress, 0n);
g_Assert.equal(g_HealthProperty.ArrayLengthProxyFunctionAddress, 0n);
g_Assert.equal(g_HealthProperty.TypeID, 0);
g_Assert.equal(Object.hasOwn(g_HealthProperty, "typeId"), false);
g_Assert.deepEqual(g_Classes.GetServerClassBaseClassNames(g_DynamicPropClass), ["CBaseEntity"]);

for (const Property of g_Classes.GetServerClassProperties(g_DynamicPropClass)) {
	for (const strFieldName of ["Address", "ArrayPropertyAddress", "ArrayLengthProxyFunctionAddress", "DataTableProxyFunctionAddress", "ProxyFunctionAddress"]) {
		g_Assert.equal(typeof Property[strFieldName], "bigint", "Reflection " + strFieldName + " must remain a BigInt address.");
	}
}

const g_vecWorldEntities = g_Classes.GetEntitiesByClassName("worldspawn");
g_Assert.equal(g_vecWorldEntities.length, 1, "The world fixture must remain discoverable.");
g_Assert.equal(g_vecWorldEntities[0].Index, 0, "World index zero is valid, not the null sentinel.");
g_Assert.equal(g_vecWorldEntities[0].Address, 0x100000n, "The world fixture must keep its BigInt base address.");
g_Assert.equal(g_Classes.GetEntityClassName(0), "worldspawn", "World index zero must retain its class name.");

for (const Value of [undefined, null, "", 0]) {
	g_Assert.throws(() => g_Classes.GetEntitiesByClassName(Value), { name: "Error", message: /non-empty string/ });
	g_Assert.throws(() => g_Classes.FindServerClass(Value), { name: "Error", message: /non-empty string/ });
	g_Assert.throws(() => g_Classes.FindServerClassByName(Value), { name: "Error", message: /non-empty string/ });
}

g_Assert.throws(() => g_Classes.GetEntitiesByClassName(), { name: "Error" });
g_Assert.throws(() => g_Classes.GetEntityClassName(), { name: "Error" });

for (const Value of [undefined, null, "2", 2.5, 0x80000000, -0x80000001, g_unEntityAddressBase]) {
	g_Assert.equal(g_Classes.GetEntityClassName(Value), "", "Class-name lookup must not coerce an invalid index or BigInt address.");
}

g_Assert.equal(g_Classes.GetEntityClassName({ Index: g_unPropertyEntityIndex }), "prop_dynamic");
g_Assert.equal(g_Classes.GetEntityServerClass(g_unPropertyEntityIndex).Name, "CDynamicProp");
g_Assert.equal(g_Classes.GetEntityServerClass(g_PropertyEntity.Address).Name, "CDynamicProp");
g_Assert.equal(g_Classes.GetSendTable(g_DynamicPropClass.Address).Name, "DT_DynamicProp");
g_Assert.equal(g_Classes.GetSendTable(g_DynamicPropClass.Table.Address).Name, "DT_DynamicProp");
g_Assert.equal(g_Classes.GetServerClassSendTable("CDynamicProp"), null, "The native function accepts entities, not class-name strings.");
g_Assert.equal(g_Classes.SERVER_CLASSES.GetServerClassSendTable("CDynamicProp").Name, "DT_DynamicProp", "The collection method resolves a class name before its native table query.");
g_Assert.equal(g_Classes.GetSendTable(undefined), null);
g_Assert.deepEqual(g_Classes.GetServerClassProperties(undefined), []);
g_Assert.equal(g_Classes.GetEntityServerClass(undefined), null);
g_Assert.throws(() => g_Classes.GetSendTable(), { name: "Error" });
g_Assert.throws(() => g_Classes.GetServerClassProperties(), { name: "Error" });
g_Assert.throws(() => g_Classes.GetEntityServerClass(), { name: "Error" });
g_Assert.throws(() => g_Classes.GetEntitySendProperty(undefined), { name: "Error" });
g_Assert.throws(() => g_Classes.FindServerClassPropertyOffset(g_DynamicPropClass), { name: "Error" });

for (const Value of [0x80000000, -0x80000001, 0.5, NaN, Infinity]) {
	g_Assert.throws(() => g_Classes.GetServerClassProperty(g_DynamicPropClass, Value), { name: "Error", message: /signed native integer/ });
	g_Assert.equal(g_Classes.GetServerClassProperty("MissingClass", Value), null, "Table resolution precedes selector validation.");
}

g_Assert.equal(g_Classes.GetServerClassProperty(g_DynamicPropClass, -1), null);
g_Assert.equal(g_Classes.GetServerClassProperty(g_DynamicPropClass, g_nNativeIntegerMaximum), null);

for (const Value of [0, 0n, undefined, null, ""]) {
	g_Assert.throws(() => g_Classes.FindServerClassPropertyOffset(g_DynamicPropClass, Value), { name: "Error", message: /non-empty string/ });
	g_Assert.equal(g_Classes.FindServerClassPropertyOffset("MissingClass", Value), -1, "Offset resolution must fail before validating an otherwise invalid selector.");
}

g_Assert.equal(g_Classes.FindServerClassPropertyOffset(g_DynamicPropClass, "m_iHealth"), g_unHealthPropertyOffset);

const g_OriginalFindServerClass = g_NativeClasses.FindServerClass;
const g_IndependentServerClassCollection = new g_Classes.ServerClassCollection();
const g_ServerClassLookupError = new Error("Controlled server-class lookup failure.");
const g_NoCoercionClassRecord = {
	[Symbol.toPrimitive]() {
		throw new Error("Class membership must not coerce a lookup result.");
	},
};
// Non-nullish invalid records retain the old predicate behavior; this is not native validation.
const g_vecMembershipCases = [
	{ Name: "record", Result: g_DynamicPropClass, Present: true },
	{ Name: "null", Result: null, Present: false },
	{ Name: "undefined", Result: undefined, Present: false },
	{ Name: "false", Result: false, Present: true },
	{ Name: "zero", Result: 0, Present: true },
	{ Name: "bigint-zero", Result: 0n, Present: true },
	{ Name: "empty-string", Result: "", Present: true },
	{ Name: "nan", Result: NaN, Present: true },
	{ Name: "symbol", Result: Symbol("controlled"), Present: true },
	{ Name: "no-coercion", Result: g_NoCoercionClassRecord, Present: true },
];
let g_ServerClassLookupResult = g_DynamicPropClass;
let g_unServerClassLookupCount = 0;
let g_bThrowServerClassLookup = false;

g_NativeClasses.FindServerClass = function FindServerClass(strServerClassName) {
	g_Assert.strictEqual(this, g_NativeClasses, "Native lookup receiver must be preserved.");
	g_Assert.equal(strServerClassName, "CDynamicProp");
	g_unServerClassLookupCount++;

	if (g_bThrowServerClassLookup) {
		throw g_ServerClassLookupError;
	}

	return g_ServerClassLookupResult;
};

try {
	for (const Collection of [g_Classes.SERVER_CLASSES, g_IndependentServerClassCollection]) {
		for (const MembershipCase of g_vecMembershipCases) {
			g_ServerClassLookupResult = MembershipCase.Result;
			g_unServerClassLookupCount = 0;
			g_Assert.equal(Collection.HasServerClass("CDynamicProp"), MembershipCase.Present, `HasServerClass must reject ${MembershipCase.Name} only when it is nullish.`);
			g_Assert.equal(g_unServerClassLookupCount, 1, "Membership must perform exactly one lookup.");
		}

		g_bThrowServerClassLookup = true;
		g_unServerClassLookupCount = 0;
		g_Assert.throws(() => Collection.HasServerClass("CDynamicProp"), (ErrorValue) => ErrorValue === g_ServerClassLookupError);
		g_Assert.equal(g_unServerClassLookupCount, 1);
		g_bThrowServerClassLookup = false;
	}
} finally {
	g_NativeClasses.FindServerClass = g_OriginalFindServerClass;
}

const g_GetterLookupCollection = new g_Classes.ServerClassCollection();
let g_unLookupGetterCount = 0;
let g_unOverriddenLookupCount = 0;

Object.defineProperty(g_GetterLookupCollection, "FindServerClass", {
	get() {
		g_unLookupGetterCount++;

		return function FindServerClass(strServerClassName) {
			g_Assert.strictEqual(this, g_GetterLookupCollection);
			g_Assert.equal(strServerClassName, "CDynamicProp");
			g_unOverriddenLookupCount++;
			return undefined;
		};
	},
});

g_Assert.equal(g_GetterLookupCollection.HasServerClass("CDynamicProp"), false);
g_Assert.equal(g_unLookupGetterCount, 1);
g_Assert.equal(g_unOverriddenLookupCount, 1);

const g_ThrowingLookupCollection = new g_Classes.ServerClassCollection();
Object.defineProperty(g_ThrowingLookupCollection, "FindServerClass", {
	get() {
		throw g_ServerClassLookupError;
	},
});

g_Assert.throws(() => g_ThrowingLookupCollection.HasServerClass("CDynamicProp"), (ErrorValue) => ErrorValue === g_ServerClassLookupError);
g_Assert.equal(g_Classes.SERVER_CLASSES.HasServerClass("CDynamicProp"), true, "The native backend must be restored before other scenarios.");

g_Assert.throws(() => new g_Classes.ServerClassGenerator(null), { name: "TypeError", message: /pattern must be a string/ });
g_Assert.throws(() => new g_Classes.ServerClassGenerator("", null), { name: "TypeError", message: /options must be an object/ });
g_Assert.throws(() => new g_Classes.ServerClassGenerator("", { Exact: 1 }), { name: "TypeError", message: /exact-match mode must be a boolean/ });

const g_MutableServerClassGenerator = new g_Classes.ServerClassGenerator();
const g_OriginalListServerClasses = g_NativeClasses.GetServerClasses;
const g_vecReplacementServerClasses = g_OriginalListServerClasses();

g_MutableServerClassGenerator.Exact = "true";
g_Assert.throws(() => Array.from(g_MutableServerClassGenerator), { name: "TypeError", message: /exact-match mode must be a boolean/ });

g_NativeClasses.GetServerClasses = function GetServerClasses() {
	return g_vecReplacementServerClasses;
};

g_Assert.strictEqual(g_Classes.SERVER_CLASSES.GetServerClasses(), g_vecReplacementServerClasses);
g_NativeClasses.GetServerClasses = g_OriginalListServerClasses;

const g_setReferencedExports = new Set();
const g_DocumentedClasses = TrackModule(g_Classes, g_setReferencedExports);
const g_strDocumentation = g_FileSystem.readFileSync(g_strClassesDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_vecDocumentationLogRecords = [];
const g_DocumentationLoggers = {
	LogInfo(strMessage, LogRecord) {
		g_Assert.equal(strMessage, "%j", "Structured documentation logs must use the JSON format token.");
		g_Assert.equal(Object.keys(LogRecord)[0], "Operation", "Documentation logs must put operation first.");
		g_vecDocumentationLogRecords.push(JSON.parse(JSON.stringify(LogRecord)));
	},
};

const g_unExpectedDocumentationBlockCount = 10;
g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);

for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unBlockIndex, { "entities/classes": g_DocumentedClasses, loggers: g_DocumentationLoggers });
}

g_Assert.deepEqual(g_vecDocumentationLogRecords, [
	{ Operation: "InspectEntityClassCapabilities", ReflectionAvailable: true },
	{ Operation: "ScanEntityClasses", Names: ["worldspawn", "player", "prop_dynamic"], EntityIndexes: [2, 3] },
	{ Operation: "InspectServerClass", Count: 3, ClassIndex: 1, TableName: "DT_DynamicProp" },
	{ Operation: "InspectSendProperty", Path: "m_bDisabled", TableName: "DT_DynamicProp", Type: "int", Offset: 0xC8 },
	{ Operation: "CompareEntitySendTables", EntityIndex: 2, ClassName: "CDynamicProp", TableName: "DT_DynamicProp" },
	{ Operation: "FindSendProperties", FirstDirectProperty: "baseclass", Path: "baseclass.m_iHealth", PropertyCount: 4 },
	{ Operation: "InspectClassInheritance", Names: ["CDynamicProp", "CBaseEntity"] },
	{ Operation: "GenerateServerClasses", Names: ["CBaseEntity"] },
	{ Operation: "InspectServerClassCollection", Names: ["CBaseEntity", "CDynamicProp", "CTerrorPlayer"] },
	{ Operation: "ReadEntityHealth", EntityIndex: 2, Health: 100 },
], "Every documentation block must emit its complete structured observation without native BigInt records.");

for (const strExportName of g_vecReflectionExpectedExports) {
	if (strExportName === "FindServerClassByName") {
		g_Assert.match(g_strDocumentation, /`FindServerClassByName\(strServerClassName\)`/, "The equivalent native alias must remain documented even without a redundant standalone example.");
		continue;
	}

	g_Assert.equal(g_setReferencedExports.has(strExportName), true, `Documentation did not reference entities/classes.${strExportName}.`);
}

const g_NativeClassesWithoutReflection = { GetEntitiesByClassName: g_NativeClasses.GetEntitiesByClassName, GetEntityClassName: g_NativeClasses.GetEntityClassName, GetEntityClassNames: g_NativeClasses.GetEntityClassNames };

globalThis.sourcejs = { "entities/classes": g_NativeClassesWithoutReflection };

delete require.cache[g_strClassesPath];

const g_ClassesWithoutReflection = require(g_strClassesPath);
g_Assert.strictEqual(g_ClassesWithoutReflection, g_NativeClassesWithoutReflection);
g_Assert.deepEqual(Object.keys(g_ClassesWithoutReflection).sort(), ["GetEntitiesByClassName", "GetEntityClassName", "GetEntityClassNames"], "Reduced SDK profile must preserve exactly the available exports.");
g_Assert.equal(Object.hasOwn(g_ClassesWithoutReflection, "GetServerClasses"), false);
g_Assert.equal(Object.hasOwn(g_ClassesWithoutReflection, "SERVER_CLASSES"), false);

delete require.cache[g_strClassesPath];
delete require.cache[g_strPropertiesPath];
delete globalThis.sourcejs;

delete require.cache[g_strRuntimePath];

g_Assert.throws(() => require(g_strClassesPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Classes must report native absence, not a lookup or unrelated error.");
g_Assert.throws(() => require(g_strPropertiesPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Properties must report native absence, not a lookup or unrelated error.");

g_Module._load = g_OriginalModuleLoad;
delete require.cache[g_strRuntimePath];

console.log("[  OK  ] entities classes/reflection and documentation passed with native doubles; native SDK execution not exercised");
