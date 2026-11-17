#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_Util = require("node:util");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-props.md");
const g_strPropertiesPath = g_Path.join(g_strPackageRoot, "entities", "props.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");

// Controlled reflection/property fixtures use synthetic addresses; they do not execute the native SDK or prove ABI layout.
const g_nSignedInteger64Minimum = -0x8000000000000000n;
const g_unUnsignedInteger64Maximum = 0xFFFFFFFFFFFFFFFFn;
const g_unEntityAddressBase = 0x100000n;
const g_unEntityAddressStride = 0x1000n;
const g_unPropertyProxyFunctionAddressBase = 0x7100n;
const g_unDataTableProxyFunctionAddressBase = 0x7200n;
const g_unArrayLengthProxyFunctionAddressBase = 0x7300n;
const g_unHealthOffset = 0x64;
const g_unOriginOffset = 0x78;
const g_unMovementValueOffset = 0x88;
const g_unOwnerEntityOffset = 0xC8;
const g_unTeamNumberOffset = 0x12C;

const g_vecCanonicalTypes = [
	"bool",
	"char",
	"uchar",
	"short",
	"ushort",
	"int",
	"uint",
	"long",
	"ulong",
	"longlong",
	"ulonglong",
	"float",
	"double",
	"stringaddress",
	"stringarray",
	"address",
	"vector",
	"vectorxy",
	"entity",
];

const g_vecTypeAccessors = [
	["bool", "GetEntityPropertyBoolean", "SetEntityPropertyBoolean", true],
	["char", "GetEntityPropertyCharacter", "SetEntityPropertyCharacter", "Q"],
	["uchar", "GetEntityPropertyUnsignedCharacter", "SetEntityPropertyUnsignedCharacter", 255],
	["short", "GetEntityPropertyShort", "SetEntityPropertyShort", -1234],
	["ushort", "GetEntityPropertyUnsignedShort", "SetEntityPropertyUnsignedShort", 65000],
	["int", "GetEntityPropertyInteger", "SetEntityPropertyInteger", -123456],
	["uint", "GetEntityPropertyUnsignedInteger", "SetEntityPropertyUnsignedInteger", 4000000000],
	["long", "GetEntityPropertyLong", "SetEntityPropertyLong", -400],
	["ulong", "GetEntityPropertyUnsignedLong", "SetEntityPropertyUnsignedLong", 400],
	["longlong", "GetEntityPropertyLongLong", "SetEntityPropertyLongLong", g_nSignedInteger64Minimum],
	["ulonglong", "GetEntityPropertyUnsignedLongLong", "SetEntityPropertyUnsignedLongLong", g_unUnsignedInteger64Maximum],
	["float", "GetEntityPropertyFloat", "SetEntityPropertyFloat", 1.25],
	["double", "GetEntityPropertyDouble", "SetEntityPropertyDouble", 2.5],
	["stringaddress", "GetEntityPropertyStringAddress", "SetEntityPropertyStringAddress", "address text"],
	["stringarray", "GetEntityPropertyStringArray", "SetEntityPropertyStringArray", "array text"],
	["address", "GetEntityPropertyAddress", "SetEntityPropertyAddress", 0x123456n],
	["vector", "GetEntityPropertyVector", "SetEntityPropertyVector", { X: 4, Y: 5, Z: 6 }],
	["entity", "GetEntityPropertyEntity", "SetEntityPropertyEntity", null],
];

const g_SendPropertyTypes = Object.freeze({ Array: 5, DataTable: 6, Float: 1, Int: 0, String: 4, Vector: 2, VectorXY: 3 });
const g_SendPropertyFlags = Object.freeze({
	ChangesOften: 0x01 << 15,
	Collapsible: 0x01 << 11,
	Coord: 0x01 << 1,
	CoordMP: 0x01 << 12,
	CoordMPIntegral: 0x01 << 14,
	CoordMPLowPrecision: 0x01 << 13,
	Exclude: 0x01 << 6,
	InsideArray: 0x01 << 8,
	IsVectorElement: 0x01 << 10,
	NoScale: 0x01 << 2,
	Normal: 0x01 << 5,
	ProxyAlwaysYes: 0x01 << 9,
	RoundDown: 0x01 << 3,
	RoundUp: 0x01 << 4,
	Unsigned: 0x01,
	XYZE: 0x01 << 7,
});
const g_StandaloneFlags = Object.freeze({
	SPROP_CHANGES_OFTEN: g_SendPropertyFlags.ChangesOften,
	SPROP_COLLAPSIBLE: g_SendPropertyFlags.Collapsible,
	SPROP_COORD: g_SendPropertyFlags.Coord,
	SPROP_COORD_MP: g_SendPropertyFlags.CoordMP,
	SPROP_COORD_MP_INTEGRAL: g_SendPropertyFlags.CoordMPIntegral,
	SPROP_COORD_MP_LOWPRECISION: g_SendPropertyFlags.CoordMPLowPrecision,
	SPROP_EXCLUDE: g_SendPropertyFlags.Exclude,
	SPROP_INSIDEARRAY: g_SendPropertyFlags.InsideArray,
	SPROP_IS_A_VECTOR_ELEM: g_SendPropertyFlags.IsVectorElement,
	SPROP_NORMAL: g_SendPropertyFlags.Normal,
	SPROP_NOSCALE: g_SendPropertyFlags.NoScale,
	SPROP_PROXY_ALWAYS_YES: g_SendPropertyFlags.ProxyAlwaysYes,
	SPROP_ROUNDDOWN: g_SendPropertyFlags.RoundDown,
	SPROP_ROUNDUP: g_SendPropertyFlags.RoundUp,
	SPROP_UNSIGNED: g_SendPropertyFlags.Unsigned,
	SPROP_XYZE: g_SendPropertyFlags.XYZE,
});

const g_vecReflectionExports = [
	"GetEntitySendProperty",
	"FindServerClassPropertyOffset",
	"FindServerClassByName",
	"GetServerClassProperty",
	"GetSendTable",
	"GetServerClassProperties",
	"GetServerClasses",
	"GetEntitySendTable",
	"GetEntityServerClass",
];
const g_vecPropertyExports = ["GetEntityProperty", "SetEntityProperty", "CreateEntityPropertyVariant"];
const g_vecTypedExports = g_vecTypeAccessors.flatMap(([, strGetterName, strSetterName]) => [strGetterName, strSetterName]);
const g_vecExpectedExports = [
	...g_vecReflectionExports,
	...g_vecPropertyExports,
	...g_vecTypedExports,
	"SendPropFlags",
	"SendPropType",
	...Object.keys(g_StandaloneFlags),
];
const g_vecServerClassFields = [
	"Kind",
	"Address",
	"Name",
	"ClassIndex",
	"InstanceBaselineIndex",
	"Table",
	"NextAddress",
];
const g_vecSendTableFields = [
	"Kind",
	"Address",
	"Name",
	"ServerClassName",
	"PropertyCount",
	"Initialized",
	"WriteFlag",
	"PropertiesEncodedAgainstTickCount",
	"Properties",
];
const g_vecSendPropertyFields = [
	"ArrayLengthProxyFunctionAddress",
	"ArrayPropertyAddress",
	"BitCount",
	"DataTable",
	"DataTableProxyFunctionAddress",
	"ElementStride",
	"ExcludeDataTableName",
	"ExcludedProperty",
	"Flags",
	"HighLowMultiplier",
	"HighValue",
	"Index",
	"InsideArray",
	"Kind",
	"ArrayLength",
	"LowValue",
	"Name",
	"Offset",
	"ParentArrayPropertyName",
	"Path",
	"Address",
	"ProxyFunctionAddress",
	"ServerClassName",
	"Signed",
	"TableName",
	"Type",
	"TypeID",
];
const g_mapTableDefinitions = new Map([
	["DT_BaseEntity", {
		Address: 0x5100n,
		Properties: [
			{ BitCount: 11, Flags: 0, HighValue: 2047, Name: "m_iHealth", Offset: g_unHealthOffset, Address: 0x6100n, Type: "int", TypeID: g_SendPropertyTypes.Int },
			{ Flags: g_SendPropertyFlags.ChangesOften, Name: "m_vecOrigin", Offset: g_unOriginOffset, Address: 0x6104n, Type: "vector", TypeID: g_SendPropertyTypes.Vector },
			{ Flags: 0, Name: "m_flLaggedMovementValue", Offset: g_unMovementValueOffset, Address: 0x6108n, Type: "float", TypeID: g_SendPropertyTypes.Float },
		],
		ServerClassName: "CBaseEntity",
	}],
	["DT_BaseCombatWeapon", {
		Address: 0x5200n,
		Properties: [
			{ DataTableName: "DT_BaseEntity", Flags: 0, Name: "baseclass", Offset: 0, Address: 0x6200n, Type: "datatable", TypeID: g_SendPropertyTypes.DataTable },
			{ BitCount: 21, Flags: g_SendPropertyFlags.Unsigned, Name: "m_hOwnerEntity", Offset: g_unOwnerEntityOffset, Address: 0x6204n, Type: "int", TypeID: g_SendPropertyTypes.Int },
		],
		ServerClassName: "CBaseCombatWeapon",
	}],
	["DT_TerrorPlayer", {
		Address: 0x5300n,
		Properties: [
			{ DataTableName: "DT_BaseEntity", Flags: 0, Name: "baseclass", Offset: 0, Address: 0x6300n, Type: "datatable", TypeID: g_SendPropertyTypes.DataTable },
			{ BitCount: 4, Flags: 0, Name: "m_iTeamNum", Offset: g_unTeamNumberOffset, Address: 0x6304n, Type: "int", TypeID: g_SendPropertyTypes.Int },
		],
		ServerClassName: "CTerrorPlayer",
	}],
]);
const g_mapServerClassDefinitions = new Map([
	["CBaseEntity", { ClassIndex: 0, InstanceBaselineIndex: 10, NextAddress: 0x4200n, Address: 0x4100n, TableName: "DT_BaseEntity" }],
	["CBaseCombatWeapon", { ClassIndex: 1, InstanceBaselineIndex: 11, NextAddress: 0x4300n, Address: 0x4200n, TableName: "DT_BaseCombatWeapon" }],
	["CTerrorPlayer", { ClassIndex: 2, InstanceBaselineIndex: 12, NextAddress: 0n, Address: 0x4300n, TableName: "DT_TerrorPlayer" }],
]);
const g_mapEntityStates = new Map();

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

function MakeEntityState(unIndex, strClassName, strServerClassName) {
	const EntityState = { ClassName: strClassName, Index: unIndex, Address: g_unEntityAddressBase + BigInt(unIndex) * g_unEntityAddressStride, ServerClassName: strServerClassName, Values: new Map() };

	g_mapEntityStates.set(unIndex, EntityState);

	return EntityState;
}

const g_PlayerState = MakeEntityState(1, "player", "CTerrorPlayer");
const g_WeaponState = MakeEntityState(2, "weapon_pistol", "CBaseCombatWeapon");
MakeEntityState(3, "target_dummy", "CBaseEntity");

g_PlayerState.Values.set(g_unHealthOffset, 80);
g_PlayerState.Values.set(g_unOriginOffset, [10, 20, 30]);
g_PlayerState.Values.set(g_unMovementValueOffset, 1);
g_PlayerState.Values.set(g_unTeamNumberOffset, 2);
g_WeaponState.Values.set(g_unHealthOffset, 100);
g_WeaponState.Values.set(g_unOriginOffset, [0, 0, 0]);
g_WeaponState.Values.set(g_unMovementValueOffset, 1);

function MakeEntity(EntityState) {
	if (!EntityState) {
		throw new TypeError("Entity(unIndex) expects a live entity index.");
	}

	return { Kind: "entity", ClassName: EntityState.ClassName, Index: EntityState.Index, Address: EntityState.Address, ServerClassName: EntityState.ServerClassName, Valid: true, HandleValue: EntityState.Index, NetworkSerialNumber: 0 };
}

function Entity(unIndex) {
	if (!Number.isInteger(unIndex)) {
		throw new TypeError("Entity(unIndex) expects an integer index.");
	}

	return MakeEntity(g_mapEntityStates.get(unIndex));
}

g_WeaponState.Values.set(g_unOwnerEntityOffset, Entity(1));

function RequireString(strValue, strOperation) {
	if ((typeof strValue !== "string") || !strValue) {
		throw new TypeError(`${strOperation} expects a non-empty string.`);
	}

	return strValue;
}

function MakeSendProperty(PropertyDefinition, strTableName, strPathValue, unOffsetValue) {
	const TableDefinition = g_mapTableDefinitions.get(strTableName);
	const nPropertyIndex = TableDefinition.Properties.indexOf(PropertyDefinition);
	const bIsExcluded = (PropertyDefinition.Flags & g_SendPropertyFlags.Exclude) !== 0;
	const bIsDataTable = PropertyDefinition.TypeID === g_SendPropertyTypes.DataTable;

	return {
		Kind: "sendprop",
		Address: PropertyDefinition.Address,
		Name: PropertyDefinition.Name,
		Path: strPathValue,
		Offset: unOffsetValue,
		DataTable: PropertyDefinition.DataTableName ? MakeSendTable(PropertyDefinition.DataTableName, false) : null,
		ServerClassName: TableDefinition.ServerClassName,
		TableName: strTableName,
		Index: nPropertyIndex,
		TypeID: PropertyDefinition.TypeID,
		Type: PropertyDefinition.Type,
		Flags: PropertyDefinition.Flags,
		ArrayLengthProxyFunctionAddress: (!bIsExcluded && (PropertyDefinition.TypeID === g_SendPropertyTypes.Array)) ? (g_unArrayLengthProxyFunctionAddressBase + BigInt(unOffsetValue)) : 0n,
		ArrayPropertyAddress: 0n,
		BitCount: PropertyDefinition.BitCount ?? 0,
		DataTableProxyFunctionAddress: (!bIsExcluded && bIsDataTable) ? (g_unDataTableProxyFunctionAddressBase + BigInt(unOffsetValue)) : 0n,
		ElementStride: PropertyDefinition.ElementStride ?? 0,
		ExcludeDataTableName: "",
		ExcludedProperty: bIsExcluded,
		HighLowMultiplier: 0,
		HighValue: PropertyDefinition.HighValue ?? 0,
		InsideArray: false,
		ArrayLength: PropertyDefinition.ArrayLength ?? 0,
		LowValue: PropertyDefinition.LowValue ?? 0,
		ParentArrayPropertyName: "",
		ProxyFunctionAddress: (!bIsExcluded && !bIsDataTable) ? (g_unPropertyProxyFunctionAddressBase + BigInt(unOffsetValue)) : 0n,
		Signed: (PropertyDefinition.Flags & g_SendPropertyFlags.Unsigned) === 0,
	};
}

function MakeSendTable(strTableName, bIncludeProperties = true) {
	const TableDefinition = g_mapTableDefinitions.get(strTableName);
	if (!TableDefinition) {
		return null;
	}

	return {
		Kind: "sendtable",
		Address: TableDefinition.Address,
		Name: strTableName,
		ServerClassName: TableDefinition.ServerClassName,
		PropertyCount: TableDefinition.Properties.length,
		Initialized: true,
		WriteFlag: false,
		PropertiesEncodedAgainstTickCount: true,
		Properties: bIncludeProperties ? TableDefinition.Properties.map((PropertyDefinition) => MakeSendProperty(PropertyDefinition, strTableName, PropertyDefinition.Name, PropertyDefinition.Offset)) : [],
	};
}

function MakeServerClass(strServerClassName) {
	const ServerClassDefinition = g_mapServerClassDefinitions.get(strServerClassName);
	if (!ServerClassDefinition) {
		return null;
	}

	return { Kind: "serverclass", Address: ServerClassDefinition.Address, Name: strServerClassName, ClassIndex: ServerClassDefinition.ClassIndex, InstanceBaselineIndex: ServerClassDefinition.InstanceBaselineIndex, Table: MakeSendTable(ServerClassDefinition.TableName), NextAddress: ServerClassDefinition.NextAddress };
}

function GetTableNameFromValue(Value) {
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

	if (!Value || (typeof Value !== "object")) {
		return null;
	}

	if (Value.Kind === "serverclass") {
		return g_mapServerClassDefinitions.get(Value.Name)?.TableName ?? null;
	}

	if (Value.Kind === "sendtable") {
		const strTableName = Value.Name;

		return g_mapTableDefinitions.has(strTableName) ? strTableName : null;
	}

	if (Value.Kind === "sendprop") {
		const strTableName = Value.TableName;

		return g_mapTableDefinitions.has(strTableName) ? strTableName : null;
	}

	if (Value.ServerClassName) {
		return g_mapServerClassDefinitions.get(Value.ServerClassName)?.TableName ?? null;
	}

	const strTableName = Value.Table?.Name ?? Value.DataTable?.Name ?? null;

	return (strTableName && g_mapTableDefinitions.has(strTableName)) ? strTableName : null;
}

function CollectProperties(strTableName, unBaseOffset = 0, strBasePath = "", setVisited = new Set()) {
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

function FindProperty(Value, PropertySelector) {
	const strTableName = GetTableNameFromValue(Value);
	if (!strTableName) {
		return null;
	}

	if (typeof PropertySelector === "number") {
		if (!Number.isInteger(PropertySelector)) {
			throw new TypeError("FindProperty(Value, PropertySelector) expects an integer property index.");
		}

		const PropertyDefinition = g_mapTableDefinitions.get(strTableName).Properties[PropertySelector];

		return PropertyDefinition ? MakeSendProperty(PropertyDefinition, strTableName, PropertyDefinition.Name, PropertyDefinition.Offset) : null;
	}

	const strPropertyName = RequireString(PropertySelector, "FindProperty(Value, PropertySelector)");

	return CollectProperties(strTableName).find((Property) => (Property.Name === strPropertyName) || (Property.Path === strPropertyName)) ?? null;
}

function RequireEntity(EntityValue, strOperation) {
	if (!EntityValue || !Number.isInteger(EntityValue.Index) || !g_mapEntityStates.has(EntityValue.Index)) {
		throw new TypeError(`${strOperation} expects a live entity.`);
	}

	return g_mapEntityStates.get(EntityValue.Index);
}

function ResolveProperty(EntityState, PropertyValue) {
	if (typeof PropertyValue === "number") {
		if (!Number.isInteger(PropertyValue)) {
			throw new TypeError("A property offset must be an integer.");
		}

		return { Flags: 0, Offset: PropertyValue, Type: "unknown", TypeID: -1 };
	}

	if (PropertyValue && (typeof PropertyValue === "object")) {
		if (Number.isInteger(PropertyValue.Offset)) {
			return PropertyValue;
		}

		PropertyValue = PropertyValue.Path ?? PropertyValue.Name;
	}

	const strPropertyName = RequireString(PropertyValue, "property access");
	const Property = FindProperty(EntityState.ServerClassName, strPropertyName);
	if (!Property) {
		throw new TypeError(`Unable to find entity property: ${strPropertyName}`);
	}

	return Property;
}

function RequireCanonicalType(strTypeName) {
	if ((typeof strTypeName !== "string") || !g_vecCanonicalTypes.includes(strTypeName)) {
		throw new TypeError("Unknown entities/props property type.");
	}

	return strTypeName;
}

function GetDefaultValue(strTypeName) {
	switch (strTypeName) {
		case "bool":
			return false;

		case "char":
			return "\0";

		case "longlong":
		case "ulonglong":
		case "address":
			return 0n;

		case "stringarray":
		case "stringaddress":
			return "";

		case "vector":
			return [0, 0, 0];

		case "vectorxy":
			return [0, 0];

		case "entity":
			return null;

		default:
			return 0;
	}
}

function RequireInteger(nValue, nMinimum, nMaximum, strTypeName) {
	if (!Number.isInteger(nValue) || (nValue < nMinimum) || (nValue > nMaximum)) {
		throw new TypeError(`${strTypeName} expects an in-range integer.`);
	}

	return nValue;
}

function NormalizeValue(strTypeName, Value) {
	// Scalar ranges model 8/16/32-bit storage; long/ulong are intentionally 32-bit here.
	const nSignedInteger8Minimum = -0x80;
	const nSignedInteger8Maximum = 0x7F;
	const unUnsignedInteger8Maximum = 0xFF;
	const nSignedInteger16Minimum = -0x8000;
	const nSignedInteger16Maximum = 0x7FFF;
	const unUnsignedInteger16Maximum = 0xFFFF;
	const nSignedInteger32Minimum = -0x80000000;
	const nSignedInteger32Maximum = 0x7FFFFFFF;
	const unUnsignedInteger32Maximum = 0xFFFFFFFF;

	switch (strTypeName) {
		case "bool":
			if (typeof Value !== "boolean") {
				throw new TypeError("bool expects a boolean value.");
			}

			return Value;

		case "char":
			if (typeof Value === "string") {
				return Value ? Value[0] : "\0";
			}

			return String.fromCharCode(RequireInteger(Value, nSignedInteger8Minimum, nSignedInteger8Maximum, strTypeName) & unUnsignedInteger8Maximum);

		case "uchar":
			return RequireInteger(Value, 0, unUnsignedInteger8Maximum, strTypeName);

		case "short":
			return RequireInteger(Value, nSignedInteger16Minimum, nSignedInteger16Maximum, strTypeName);

		case "ushort":
			return RequireInteger(Value, 0, unUnsignedInteger16Maximum, strTypeName);

		case "int":
		case "long":
			return RequireInteger(Value, nSignedInteger32Minimum, nSignedInteger32Maximum, strTypeName);

		case "uint":
		case "ulong":
			return RequireInteger(Value, 0, unUnsignedInteger32Maximum, strTypeName);

		case "longlong": {
			const nSignedInteger64Maximum = -g_nSignedInteger64Minimum - 1n;
			if ((typeof Value !== "bigint") || (Value < g_nSignedInteger64Minimum) || (Value > nSignedInteger64Maximum)) {
				throw new TypeError("longlong expects an in-range signed BigInt.");
			}

			return Value;
		}

		case "ulonglong":
			if ((typeof Value !== "bigint") || (Value < 0n) || (Value > g_unUnsignedInteger64Maximum)) {
				throw new TypeError("ulonglong expects an in-range unsigned BigInt.");
			}

			return Value;

		case "float":
		case "double":
			if ((typeof Value !== "number") || !Number.isFinite(Value)) {
				throw new TypeError(`${strTypeName} expects a finite number.`);
			}

			return Value;

		case "stringarray":
		case "stringaddress":
			if (typeof Value !== "string") {
				throw new TypeError(`${strTypeName} expects a string.`);
			}

			return Value;

		case "address":
			if ((typeof Value !== "bigint") || (Value < 0n)) {
				throw new TypeError("address expects a non-negative BigInt address.");
			}

			return Value;

		case "vector":
		case "vectorxy": {
			const bArray = Array.isArray(Value);
			const dblX = bArray ? Value[0] : Value?.X ?? Value?.Pitch;
			const dblY = bArray ? Value[1] : Value?.Y ?? Value?.Yaw;
			const dblZ = bArray ? Value[2] : Value?.Z ?? Value?.Roll;

			if (!Value || (typeof Value !== "object") || !Number.isFinite(dblX) || !Number.isFinite(dblY) || ((strTypeName === "vector") && !Number.isFinite(dblZ))) {
				throw new TypeError(`${strTypeName} expects finite components.`);
			}

			return (strTypeName === "vectorxy") ? [dblX, dblY] : [dblX, dblY, dblZ];
		}

		case "entity":
			if (typeof Value === "number") {
				// MakeEntity() exposes serial-zero handles whose value equals the fixture index.
				const EntityState = Array.from(g_mapEntityStates.values()).find((CurrentEntityState) => CurrentEntityState.Index === Value);
				if (EntityState === undefined) {
					throw new TypeError("The fixture cannot resolve this packed entity handle.");
				}

				return MakeEntity(EntityState);
			}

			RequireEntity(Value, "entity property");

			return Value;

		default:
			throw new TypeError(`Unknown storage type: ${strTypeName}`);
	}
}

function MakeVectorView(EntityState, Property, vecComponents, bHasZ) {
	const VectorView = { Address: EntityState.Address + BigInt(Property.Offset) };
	const vecComponentNames = bHasZ ? ["X", "Y", "Z"] : ["X", "Y"];

	for (const [unComponentIndex, strComponentName] of vecComponentNames.entries()) {
		Object.defineProperty(VectorView, strComponentName, {
			enumerable: true,
			get() {
				return vecComponents[unComponentIndex];
			},
			set(dblValue) {
				if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
					throw new TypeError("Vector components must be finite numbers.");
				}

				vecComponents[unComponentIndex] = dblValue;
			},
		});
	}

	return VectorView;
}

function GetTypedProperty(EntityValue, PropertyValue, strTypeName) {
	const EntityState = RequireEntity(EntityValue, `GetEntityProperty${strTypeName}`);
	const Property = ResolveProperty(EntityState, PropertyValue);
	let StoredValue = EntityState.Values.get(Property.Offset);

	if (StoredValue === undefined) {
		StoredValue = GetDefaultValue(strTypeName);
		EntityState.Values.set(Property.Offset, StoredValue);
	}

	if ((strTypeName === "vector") || (strTypeName === "vectorxy")) {
		return MakeVectorView(EntityState, Property, StoredValue, strTypeName === "vector");
	}

	if ((strTypeName === "uint") && StoredValue && (StoredValue.Kind === "entity")) {
		return StoredValue.HandleValue;
	}

	return StoredValue;
}

function SetTypedProperty(EntityValue, PropertyValue, strTypeName, Value) {
	const EntityState = RequireEntity(EntityValue, `SetEntityProperty${strTypeName}`);
	const Property = ResolveProperty(EntityState, PropertyValue);
	const NormalizedValue = NormalizeValue(strTypeName, Value);
	const StoredValue = EntityState.Values.get(Property.Offset);
	if (((strTypeName === "vector") || (strTypeName === "vectorxy")) && Array.isArray(StoredValue)) {
		for (let unComponentIndex = 0; unComponentIndex < NormalizedValue.length; unComponentIndex++) {
			StoredValue[unComponentIndex] = NormalizedValue[unComponentIndex];
		}

	} else {
		EntityState.Values.set(Property.Offset, NormalizedValue);
	}

	return true;
}

function InferType(Property) {
	if (Property.Type === "float") {
		return "float";
	}

	if (Property.Type === "vector") {
		return "vector";
	}

	if (Property.Type === "vectorxy") {
		return "vectorxy";
	}

	if (Property.Type === "string") {
		return "stringarray";
	}

	return ((Property.Flags & g_SendPropertyFlags.Unsigned) !== 0) ? "uint" : "int";
}

const g_NativeProperties = {
	...g_StandaloneFlags,
	SendPropFlags: {
		UNSIGNED: g_SendPropertyFlags.Unsigned,
		COORD: g_SendPropertyFlags.Coord,
		NO_SCALE: g_SendPropertyFlags.NoScale,
		ROUND_DOWN: g_SendPropertyFlags.RoundDown,
		ROUND_UP: g_SendPropertyFlags.RoundUp,
		NORMAL: g_SendPropertyFlags.Normal,
		EXCLUDE: g_SendPropertyFlags.Exclude,
		XYZE: g_SendPropertyFlags.XYZE,
		INSIDE_ARRAY: g_SendPropertyFlags.InsideArray,
		PROXY_ALWAYS_YES: g_SendPropertyFlags.ProxyAlwaysYes,
		IS_VECTOR_ELEMENT: g_SendPropertyFlags.IsVectorElement,
		COLLAPSIBLE: g_SendPropertyFlags.Collapsible,
		COORD_MP: g_SendPropertyFlags.CoordMP,
		COORD_MP_LOW_PRECISION: g_SendPropertyFlags.CoordMPLowPrecision,
		COORD_MP_INTEGRAL: g_SendPropertyFlags.CoordMPIntegral,
		CHANGES_OFTEN: g_SendPropertyFlags.ChangesOften,
	},
	SendPropType: { INT: g_SendPropertyTypes.Int, FLOAT: g_SendPropertyTypes.Float, VECTOR: g_SendPropertyTypes.Vector, VECTOR_XY: g_SendPropertyTypes.VectorXY, STRING: g_SendPropertyTypes.String, ARRAY: g_SendPropertyTypes.Array, DATA_TABLE: g_SendPropertyTypes.DataTable },
	GetEntitySendProperty(EntityValue, strPropertyName) {
		const EntityState = RequireEntity(EntityValue, "GetEntitySendProperty");

		return FindProperty(EntityState.ServerClassName, RequireString(strPropertyName, "GetEntitySendProperty"));
	},
	FindServerClassPropertyOffset(Value, strPropertyName) {
		if (arguments.length < 2) {
			throw new TypeError("FindServerClassPropertyOffset(Value, strPropertyName) expects a reference and property name.");
		}

		return FindProperty(Value, RequireString(strPropertyName, "FindServerClassPropertyOffset"))?.Offset ?? -1;
	},
	FindServerClassByName(strServerClassName) {
		return MakeServerClass(RequireString(strServerClassName, "FindServerClassByName"));
	},
	GetServerClassProperty(Value, PropertySelector) {
		if (arguments.length < 2) {
			throw new TypeError("GetServerClassProperty(Value, PropertySelector) expects a reference and property selector.");
		}

		return FindProperty(Value, PropertySelector);
	},
	GetEntityProperty(EntityValue, PropertyValue, strTypeName) {
		if (arguments.length < 2) {
			throw new TypeError("GetEntityProperty(EntityValue, PropertyValue, strTypeName?) expects an entity and property.");
		}

		const EntityState = RequireEntity(EntityValue, "GetEntityProperty");
		const Property = ResolveProperty(EntityState, PropertyValue);

		if (strTypeName !== undefined) {
			return GetTypedProperty(EntityValue, Property, RequireCanonicalType(strTypeName));
		}

		if (Property.Type === "datatable") {
			return EntityState.Address + BigInt(Property.Offset);
		}

		return GetTypedProperty(EntityValue, Property, InferType(Property));
	},
	GetSendTable(Value) {
		if (arguments.length < 1) {
			throw new TypeError("GetSendTable(Value) expects a class, table, or entity.");
		}

		const strTableName = GetTableNameFromValue(Value);

		return strTableName ? MakeSendTable(strTableName) : null;
	},
	GetServerClassProperties(Value) {
		if (arguments.length < 1) {
			throw new TypeError("GetServerClassProperties(Value) expects a class, table, or entity.");
		}

		const strTableName = GetTableNameFromValue(Value);

		return strTableName ? CollectProperties(strTableName) : [];
	},
	GetServerClasses() {
		return Array.from(g_mapServerClassDefinitions.keys(), MakeServerClass);
	},
	GetEntitySendTable(EntityValue) {
		const EntityState = RequireEntity(EntityValue, "GetEntitySendTable");

		return MakeSendTable(g_mapServerClassDefinitions.get(EntityState.ServerClassName).TableName);
	},
	GetEntityServerClass(EntityValue) {
		const EntityState = RequireEntity(EntityValue, "GetEntityServerClass");

		return MakeServerClass(EntityState.ServerClassName);
	},
	SetEntityProperty(EntityValue, PropertyValue, Value, strTypeName) {
		if (arguments.length < 3) {
			throw new TypeError("SetEntityProperty(EntityValue, PropertyValue, Value, strTypeName?) expects an entity, property, and value.");
		}

		const EntityState = RequireEntity(EntityValue, "SetEntityProperty");
		const Property = ResolveProperty(EntityState, PropertyValue);

		if (strTypeName !== undefined) {
			return SetTypedProperty(EntityValue, Property, RequireCanonicalType(strTypeName), Value);
		}

		if (Property.Type === "datatable") {
			throw new TypeError("SetEntityProperty cannot infer writable data-table storage.");
		}

		return SetTypedProperty(EntityValue, Property, InferType(Property), Value);
	},
	CreateEntityPropertyVariant(strTypeName = "int", Value = null) {
		return { Type: RequireCanonicalType(strTypeName), Value };
	},
};

for (const [strTypeName, strGetterName, strSetterName] of g_vecTypeAccessors) {
	g_NativeProperties[strGetterName] = function GetTyped(EntityValue, PropertyValue) {
		if (arguments.length < 2) {
			throw new TypeError(`${strGetterName}(EntityValue, PropertyValue) expects an entity and property.`);
		}

		return GetTypedProperty(EntityValue, PropertyValue, strTypeName);
	};
	g_NativeProperties[strSetterName] = function SetTyped(EntityValue, PropertyValue, Value) {
		if (arguments.length < 3) {
			throw new TypeError(`${strSetterName}(EntityValue, PropertyValue, Value) expects an entity, property, and value.`);
		}

		return SetTypedProperty(EntityValue, PropertyValue, strTypeName, Value);
	};
}

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

				return function TrackedFunction(...vecArguments) {
					setReferencedExports.add(strName);

					return Value(...vecArguments);
				};
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const Script = new g_VM.Script(`(function (require, console, module) {\n${strSource}\n})`, { filename: `entities-props.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Entity property documentation must use the typed logger.");
		},
	};

	Callback(DocumentationRequire, DocumentationConsole, { exports: {} });
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Entity property documentation must use the typed logger\./);

function VerifyProxyReflectionFields() {
	const strTableName = "DT_BaseEntity";
	const SourceProperty = g_mapTableDefinitions.get(strTableName).Properties[0];
	const vecTypes = [
		{ TypeID: g_SendPropertyTypes.Int, Name: "int" },
		{ TypeID: g_SendPropertyTypes.Array, Name: "array" },
		{ TypeID: g_SendPropertyTypes.DataTable, Name: "datatable" },
	];
	for (const Type of vecTypes) {
		const nTypeID = Type.TypeID;
		for (const bExcluded of [false, true]) {
			const PropertyDefinition = { ...SourceProperty, TypeID: nTypeID, Type: Type.Name, Flags: bExcluded ? g_SendPropertyFlags.Exclude : 0, DataTableName: (nTypeID === g_SendPropertyTypes.DataTable) ? strTableName : undefined };
			const Property = MakeSendProperty(PropertyDefinition, strTableName, PropertyDefinition.Name, PropertyDefinition.Offset);
			g_Assert.equal(Property.ExcludedProperty, bExcluded);
			g_Assert.equal(Property.ProxyFunctionAddress, (!bExcluded && (nTypeID !== g_SendPropertyTypes.DataTable)) ? (g_unPropertyProxyFunctionAddressBase + BigInt(PropertyDefinition.Offset)) : 0n);
			g_Assert.equal(Property.DataTableProxyFunctionAddress, (!bExcluded && (nTypeID === g_SendPropertyTypes.DataTable)) ? (g_unDataTableProxyFunctionAddressBase + BigInt(PropertyDefinition.Offset)) : 0n);
			g_Assert.equal(Property.ArrayLengthProxyFunctionAddress, (!bExcluded && (nTypeID === g_SendPropertyTypes.Array)) ? (g_unArrayLengthProxyFunctionAddressBase + BigInt(PropertyDefinition.Offset)) : 0n);
		}
	}
}

function VerifyTemporaryPropertySnapshotDocumentation(strTypedSource, Modules, EntityValue, Property) {
	const unExpectedFiniteCases = 21;
	const unExpectedRawCases = 18;
	const strSource = strTypedSource.replaceAll("\r\n", "\n");
	const vecHelperBindingMatch = /const (\w+) = function WithTemporaryEntityProperty\(/.exec(strSource);
	g_Assert.ok(vecHelperBindingMatch);

	const CreateInvoker = (strCode, FixtureProperties) => {
		const PluginModule = { exports: {} };
		const Script = new g_VM.Script(`(function (require, module) {\n${strCode}\nmodule.exports.Invoke = ${vecHelperBindingMatch[1]};\n})`, { filename: "entities-props.md:snapshot-regression" });
		const Run = Script.runInNewContext({});
		Run((strModuleName) => (strModuleName === "entities/props") ? FixtureProperties : Modules[strModuleName], PluginModule);

		return PluginModule.exports.Invoke;
	};

	const strScalarGuard = "\tif (((strPropertyStorageType === \"float\") || (strPropertyStorageType === \"double\")) && !Number.isFinite(EntityPropertyValue)) {\n\t\tthrow new RangeError(\"Temporary property access cannot restore a non-finite floating-point value.\");\n\t}\n\n";
	const strVectorGuard = "\t\tif (!vecComponents.every(Number.isFinite)) {\n\t\t\tthrow new RangeError(\"Temporary property access cannot restore non-finite vector components.\");\n\t\t}\n";
	const strRawCodecStart = "\tif (strPropertyStorageType === \"entity\") {\n\t\tReadPreviousEntityProperty =";
	const strRawCodecEnd = "\n\tconst CurrentEntityPropertyValue = ReadPreviousEntityProperty(";
	const nRawCodecStart = strSource.indexOf(strRawCodecStart);
	const nRawCodecEnd = strSource.indexOf(strRawCodecEnd, nRawCodecStart);
	g_Assert.equal(strSource.split(strScalarGuard).length, 2);
	g_Assert.equal(strSource.split(strVectorGuard).length, 2);
	g_Assert.ok((nRawCodecStart >= 0) && (nRawCodecEnd > nRawCodecStart));

	const strRawCodecBypassSource = strSource.slice(0, nRawCodecStart) + strSource.slice(nRawCodecEnd);
	let unFiniteCases = 0;
	for (const dblNonFiniteValue of [NaN, Infinity, -Infinity]) {
		const vecCases = [
			{ StorageType: "float", Value: dblNonFiniteValue, Getter: "GetEntityPropertyFloat", Setter: "SetEntityPropertyFloat" },
			{ StorageType: "double", Value: dblNonFiniteValue, Getter: "GetEntityPropertyDouble", Setter: "SetEntityPropertyDouble" },
		];
		for (const vecComponentNames of [["X", "Y"], ["X", "Y", "Z"]]) {
			for (const strInvalidComponent of vecComponentNames) {
				vecCases.push({ StorageType: "vector", Value: Object.fromEntries(vecComponentNames.map(strComponent => [strComponent, (strComponent === strInvalidComponent) ? dblNonFiniteValue : 1])), Getter: "GetEntityPropertyVector", Setter: "SetEntityPropertyVector" });
			}
		}

		for (const Case of vecCases) {
			const VerifyNoWrite = (strCode) => {
				let unWrites = 0;
				let unCallbacks = 0;
				let CaughtFailure = null;
				const FixtureProperties = {
					...Modules["entities/props"],
					[Case.Getter]: () => Case.Value,
					[Case.Setter]: () => {
						unWrites += 1;
						return true;
					},
				};
				const Invoke = CreateInvoker(strCode, FixtureProperties);

				try {
					Invoke(EntityValue, Property, Case.StorageType, (Case.StorageType === "vector") ? [1, 2, 3] : 1, () => {
						unCallbacks += 1;
					});
				} catch (FailureValue) {
					CaughtFailure = FailureValue;
				}

				g_Assert.equal(unWrites, 0, "A non-finite original property must be rejected before any write.");
				g_Assert.equal(unCallbacks, 0);
				g_Assert.equal(CaughtFailure?.name, "RangeError");
				g_Assert.equal(CaughtFailure.message, (Case.StorageType === "vector") ? "Temporary property access cannot restore non-finite vector components." : "Temporary property access cannot restore a non-finite floating-point value.");
			};
			VerifyNoWrite(strSource);
			const strGuard = (Case.StorageType === "vector") ? strVectorGuard : strScalarGuard;
			g_Assert.throws(() => VerifyNoWrite(strSource.replace(strGuard, "")), FailureValue => (FailureValue.code === "ERR_ASSERTION") && FailureValue.message.includes("A non-finite original property must be rejected before any write."));
			unFiniteCases += 1;
		}
	}

	const vecRawCases = [
		{ StorageType: "entity", Originals: [0, 0xABC00001, 0xFFFFFFFF], RawGetter: "GetEntityPropertyUnsignedInteger", RawSetter: "SetEntityPropertyUnsignedInteger", Getter: "GetEntityPropertyEntity", Setter: "SetEntityPropertyEntity", Temporary: { Handle: 0xBCD00002 } },
		{ StorageType: "stringaddress", Originals: [0n, 0xFFFFFFFFn, 0xFEDCBA9876543210n], RawGetter: "GetEntityPropertyAddress", RawSetter: "SetEntityPropertyAddress", Getter: "GetEntityPropertyStringAddress", Setter: "SetEntityPropertyStringAddress", Temporary: "temporary", TemporaryRaw: 0x710000n },
		{ StorageType: "char", Originals: [0, 0x80, 0xFF], RawGetter: "GetEntityPropertyUnsignedCharacter", RawSetter: "SetEntityPropertyUnsignedCharacter", Getter: "GetEntityPropertyCharacter", Setter: "SetEntityPropertyCharacter", Temporary: "A" },
	];
	let unRawCases = 0;
	for (const Case of vecRawCases) {
		for (const unOriginalValue of Case.Originals) {
			for (const bCallbackThrows of [false, true]) {
				const VerifyRawSnapshot = (strCode) => {
					const State = { Stored: unOriginalValue, RawReads: 0, RawWrites: 0, CallbackCalls: 0, TypedWrites: 0, ObservedHandle: unOriginalValue };
					const CallbackFailure = new Error("Controlled temporary-property callback failure.");
					const FixtureProperties = { ...Modules["entities/props"] };
					FixtureProperties[Case.RawGetter] = () => {
						State.RawReads += 1;

						return State.Stored;
					};
					FixtureProperties[Case.RawSetter] = (CurrentEntity, CurrentProperty, unStoredValue) => {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.RawWrites += 1;
						State.Stored = unStoredValue;

						return true;
					};
					FixtureProperties[Case.Getter] = () => {
						if (Case.StorageType === "entity") {
							if (State.Stored === 0xFFFFFFFF) {
								return null;
							}

							return {
								get HandleValue() {
									return State.ObservedHandle;
								},
							};
						}

						if (Case.StorageType === "char") {
							return (State.Stored === 0) ? "" : Buffer.from([State.Stored]).toString("utf8");
						}

						return (State.Stored === 0n) ? "" : "stored-text";
					};
					FixtureProperties[Case.Setter] = (CurrentEntity, CurrentProperty, Value) => {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.TypedWrites += 1;
						if (Case.StorageType === "entity") {
							if (Value === null) {
								throw new TypeError("A valid packed handle is required.");
							}

							State.Stored = Value.Handle ?? Value.HandleValue;

						} else if (Case.StorageType === "char") {
							State.Stored = Buffer.from(Value)[0] ?? 0;

						} else {
							State.Stored = Case.TemporaryRaw + BigInt(State.TypedWrites);
						}

						return true;
					};
					const Invoke = CreateInvoker(strCode, FixtureProperties);
					let CaughtFailure = null;

					try {
						Invoke(EntityValue, Property, Case.StorageType, Case.Temporary, () => {
							State.CallbackCalls += 1;
							State.ObservedHandle = 0xCDE00003;

							if (bCallbackThrows) {
								throw CallbackFailure;
							}
						});
					} catch (FailureValue) {
						CaughtFailure = FailureValue;
					}

					g_Assert.equal(State.RawReads, 1, "The raw temporary-property snapshot codec must be used.");
					g_Assert.equal(State.RawWrites, 1);
					g_Assert.strictEqual(State.Stored, unOriginalValue);
					g_Assert.equal(State.CallbackCalls, 1);
					g_Assert.equal(State.TypedWrites, 1);
					g_Assert.strictEqual(CaughtFailure, bCallbackThrows ? CallbackFailure : null);
				};
				VerifyRawSnapshot(strSource);
				g_Assert.throws(() => VerifyRawSnapshot(strRawCodecBypassSource), FailureValue => (FailureValue.code === "ERR_ASSERTION") && FailureValue.message.includes("The raw temporary-property snapshot codec must be used."));
				unRawCases += 1;
			}
		}
	}

	g_Assert.equal(unFiniteCases, unExpectedFiniteCases);
	g_Assert.equal(unRawCases, unExpectedRawCases);
}

function VerifyRejectedPropertyWorkflowDocumentation(vecDocumentationBlocks) {
	const unExpectedCaseCount = 14;
	const strOriginGuard = "\tif (!vecPreviousOrigin.every(Number.isFinite)) {\n\t\tthrow new RangeError(\"The original entity origin must be finite before a temporary write.\");\n\t}\n\n";
	const strMultiplierGuard = "\tif (!Number.isFinite(flPreviousMultiplier)) {\n\t\tthrow new RangeError(\"The original movement multiplier must be finite before a temporary write.\");\n\t}\n\n";
	const strTypeGuard = "\tif ((MovementProperty === null) || (MovementProperty.Type !== \"float\")) {";
	const vecCases = [];
	for (const dblNonFiniteValue of [NaN, Infinity, -Infinity]) {
		for (const strComponentName of ["X", "Y", "Z"]) {
			vecCases.push({ FunctionName: "VerifyLiveVectorAccess", Component: strComponentName, Value: dblNonFiniteValue, PropertyType: "vector", Guard: strOriginGuard, BeforeRead: false, ErrorName: "RangeError", Message: "The original entity origin must be finite before a temporary write." });
		}

		vecCases.push({ FunctionName: "ApplyAndRestoreMovementMultiplier", Value: dblNonFiniteValue, PropertyType: "float", Guard: strMultiplierGuard, BeforeRead: false, ErrorName: "RangeError", Message: "The original movement multiplier must be finite before a temporary write." });
	}

	for (const strPropertyType of ["int", "vector"]) {
		vecCases.push({ FunctionName: "ApplyAndRestoreMovementMultiplier", Value: 1, PropertyType: strPropertyType, Guard: strTypeGuard, BeforeRead: true, ErrorName: "Error", Message: "The live entity has no float m_flLaggedMovementValue SendProp." });
	}

	g_Assert.equal(vecCases.length, unExpectedCaseCount);

	for (const Case of vecCases) {
		const nBlockIndex = vecDocumentationBlocks.findIndex(strBlock => strBlock.includes(`function ${Case.FunctionName}()`));
		g_Assert.ok(nBlockIndex >= 0);
		const strSource = vecDocumentationBlocks[nBlockIndex].replaceAll("\r\n", "\n");
		g_Assert.equal(strSource.split(Case.Guard).length, 2, "The workflow must have exactly one reviewed guard.");
		const bVectorWorkflow = Case.FunctionName === "VerifyLiveVectorAccess";
		const VerifyRejectedWorkflow = (strCode) => {
			const State = { Vector: { X: 1, Y: 2, Z: 3 }, Multiplier: Case.Value, Reads: 0, Writes: 0 };
			if (bVectorWorkflow) {
				State.Vector[Case.Component] = Case.Value;
			}

			const EntityValue = { Index: 1 };
			const Property = { Type: Case.PropertyType };
			const Modules = {
				"entities/entity": {
					Entity(nEntityIndex) {
						g_Assert.equal(nEntityIndex, 1);

						return EntityValue;
					},
				},
				"entities/props": {
					GetEntitySendProperty(CurrentEntity, strPropertyName) {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.equal(strPropertyName, bVectorWorkflow ? "m_vecOrigin" : "m_flLaggedMovementValue");

						return Property;
					},
					GetEntityPropertyVector(CurrentEntity, CurrentProperty) {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.Reads += 1;

						const View = { Address: 0x710000n };
						for (const strComponentName of ["X", "Y", "Z"]) {
							Object.defineProperty(View, strComponentName, {
								get() {
									return State.Vector[strComponentName];
								},
								set(flValue) {
									State.Writes += 1;
									State.Vector[strComponentName] = flValue;
								},
							});
						}

						return View;
					},
					SetEntityPropertyVector(CurrentEntity, CurrentProperty, vecComponents) {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.Writes += 1;
						State.Vector = { X: vecComponents[0], Y: vecComponents[1], Z: vecComponents[2] };

						return true;
					},
					GetEntityPropertyFloat(CurrentEntity, CurrentProperty) {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.Reads += 1;

						return State.Multiplier;
					},
					SetEntityPropertyFloat(CurrentEntity, CurrentProperty, flValue) {
						g_Assert.strictEqual(CurrentEntity, EntityValue);
						g_Assert.strictEqual(CurrentProperty, Property);

						State.Writes += 1;
						State.Multiplier = flValue;

						return true;
					},
				},
				loggers: {
					LogInfo() {
						throw new Error("A rejected property workflow must not reach logging.");
					},
				},
			};
			let CaughtFailure = null;

			try {
				ExecuteDocumentationBlock(strCode, nBlockIndex, Modules);
			} catch (FailureValue) {
				CaughtFailure = FailureValue;
			}

			if (Case.BeforeRead) {
				g_Assert.equal(State.Reads, 0, "An incompatible property type must be rejected before the float read.");
			}

			g_Assert.equal(State.Writes, 0, "An unrestorable original property must be rejected before any write.");
			g_Assert.equal(State.Reads, Case.BeforeRead ? 0 : 1);
			g_Assert.equal(CaughtFailure?.name, Case.ErrorName);
			g_Assert.equal(CaughtFailure.message, Case.Message);
		};
		VerifyRejectedWorkflow(strSource);
		const strBypassSource = strSource.replace(Case.Guard, Case.BeforeRead ? "\tif (MovementProperty === null) {" : "");
		const strExpectedFailure = Case.BeforeRead ? "An incompatible property type must be rejected before the float read." : "An unrestorable original property must be rejected before any write.";
		g_Assert.throws(() => VerifyRejectedWorkflow(strBypassSource), FailureValue => (FailureValue.code === "ERR_ASSERTION") && FailureValue.message.includes(strExpectedFailure));
	}
}

function VerifyTemporaryPropertyDocumentation(vecDocumentationBlocks) {
	const unTypedPropertyBlockIndex = 4;
	const unLiveVectorBlockIndex = 5;
	const unPlayerEntityIndex = 1;
	const nOriginalHealth = 80;
	const nTemporaryHealth = 1;
	const unOriginalHandleValue = 1;
	const unOriginalNetworkSerialNumber = 0;
	const nHealthPropertyOffset = 0x64;
	const nOriginPropertyOffset = 0x78;
	const strCallbackResult = "callback-result";

	const State = { bValid: true, unHandleValue: unOriginalHandleValue, unNetworkSerialNumber: unOriginalNetworkSerialNumber, nHealth: nOriginalHealth, unWriteCount: 0 };
	const EntityValue = {
		Index: unPlayerEntityIndex,
		get Valid() {
			return State.bValid;
		},
		get HandleValue() {
			return State.unHandleValue;
		},
		get NetworkSerialNumber() {
			return State.unNetworkSerialNumber;
		},
	};
	const HealthProperty = { Path: "m_iHealth", Offset: nHealthPropertyOffset, Type: "int" };
	const OriginProperty = { Path: "m_vecOrigin", Offset: nOriginPropertyOffset, Type: "vector" };
	const arrOrigin = new Float32Array([10, 20, Math.fround(1023.99994)]);
	const vecOriginalOrigin = Array.from(arrOrigin);
	const Origin = { Address: 0xFEDCBA9876543210n };
	for (const [unComponentIndex, strComponentName] of ["X", "Y", "Z"].entries()) {
		Object.defineProperty(Origin, strComponentName, {
			get() {
				return arrOrigin[unComponentIndex];
			},
			set(flValue) {
				arrOrigin[unComponentIndex] = flValue;
			},
		});
	}

	const FixtureProperties = Object.fromEntries(g_vecTypeAccessors.flatMap(([, strGetterName, strSetterName]) => [
		[strGetterName, () => {
			throw new Error(`Unexpected getter: ${strGetterName}.`);
		}],
		[strSetterName, () => {
			throw new Error(`Unexpected setter: ${strSetterName}.`);
		}],
	]));
	FixtureProperties.GetEntitySendProperty = (CurrentEntity, strPropertyName) => {
		g_Assert.strictEqual(CurrentEntity, EntityValue);

		if (strPropertyName === HealthProperty.Path) {
			return HealthProperty;
		}

		if (strPropertyName === OriginProperty.Path) {
			return OriginProperty;
		}

		throw new Error(`Unexpected property: ${strPropertyName}.`);
	};
	FixtureProperties.GetEntityPropertyInteger = () => State.nHealth;
	FixtureProperties.SetEntityPropertyInteger = (CurrentEntity, Property, nHealth) => {
		g_Assert.strictEqual(CurrentEntity, EntityValue);
		g_Assert.strictEqual(Property, HealthProperty);

		State.nHealth = nHealth;
		State.unWriteCount++;

		return true;
	};
	FixtureProperties.GetEntityPropertyVector = () => Origin;
	FixtureProperties.SetEntityPropertyVector = (CurrentEntity, Property, vecComponents) => {
		g_Assert.strictEqual(CurrentEntity, EntityValue);
		g_Assert.strictEqual(Property, OriginProperty);

		arrOrigin.set(vecComponents);

		return true;
	};
	const vecVectorLogs = [];
	const DocumentationLoggers = {
		LogInfo(strFormat, ...vecValues) {
			vecVectorLogs.push({ Format: strFormat, Values: vecValues, Rendered: g_Util.format(strFormat, ...vecValues) });
		},
	};
	const Modules = {
		"entities/entity": { Entity: () => EntityValue },
		"entities/props": FixtureProperties,
		loggers: DocumentationLoggers,
	};
	const strTypedSource = vecDocumentationBlocks[unTypedPropertyBlockIndex];
	const vecHelperBindingMatch = /const (\w+) = function WithTemporaryEntityProperty\(/.exec(strTypedSource);
	g_Assert.ok(vecHelperBindingMatch, "The reviewed typed-property example must declare its temporary-property helper.");

	const PluginModule = { exports: {} };
	const Script = new g_VM.Script(`(function (require, console, module) {\n${strTypedSource}\nmodule.exports.Invoke = ${vecHelperBindingMatch[1]};\n})`, { filename: "entities-props.md:temporary-property-regression" });
	const Run = Script.runInNewContext({});
	const DocumentationConsole = {
		log() {
			throw new Error("Entity property documentation must use the typed logger.");
		},
	};
	g_Assert.throws(() => DocumentationConsole.log("must fail"), /Entity property documentation must use the typed logger\./);

	Run((strModuleName) => Modules[strModuleName], DocumentationConsole, PluginModule);

	VerifyTemporaryPropertySnapshotDocumentation(strTypedSource, Modules, EntityValue, HealthProperty);

	VerifyRejectedPropertyWorkflowDocumentation(vecDocumentationBlocks);

	for (const strScenario of ["Success", "CallbackFailure", "RemovedEntity", "ChangedHandle", "ChangedSerial"]) {
		State.bValid = true;
		State.unHandleValue = unOriginalHandleValue;
		State.unNetworkSerialNumber = unOriginalNetworkSerialNumber;
		State.nHealth = nOriginalHealth;
		State.unWriteCount = 0;
		const CallbackError = new Error("The callback failed.");
		const Callback = (nHealth) => {
			g_Assert.equal(nHealth, nTemporaryHealth);

			if (strScenario === "RemovedEntity") {
				State.bValid = false;

			} else if (strScenario === "ChangedHandle") {
				State.unHandleValue++;

			} else if (strScenario === "ChangedSerial") {
				State.unNetworkSerialNumber++;
			}

			if (strScenario === "CallbackFailure") {
				throw CallbackError;
			}

			return strCallbackResult;
		};
		if (strScenario === "CallbackFailure") {
			g_Assert.throws(() => PluginModule.exports.Invoke(EntityValue, HealthProperty, "int", nTemporaryHealth, Callback), (ErrorValue) => ErrorValue === CallbackError);

		} else {
			g_Assert.equal(PluginModule.exports.Invoke(EntityValue, HealthProperty, "int", nTemporaryHealth, Callback), strCallbackResult);
		}

		const bOriginalEntity = (strScenario === "Success") || (strScenario === "CallbackFailure");
		g_Assert.equal(State.unWriteCount, bOriginalEntity ? 2 : 1, `Unexpected restoration after ${strScenario}.`);
		g_Assert.equal(State.nHealth, bOriginalEntity ? nOriginalHealth : nTemporaryHealth);
	}

	State.bValid = true;
	State.unHandleValue = unOriginalHandleValue;
	State.unNetworkSerialNumber = unOriginalNetworkSerialNumber;
	State.nHealth = nOriginalHealth;
	State.unWriteCount = 0;

	const UnrecognizedStorageType = {
		[Symbol.toPrimitive]() {
			throw new Error("An invalid storage-type selector must not be coerced.");
		},
	};
	for (const StorageType of ["constructor", "toString", "__proto__", "valueOf", "INT", "", null, undefined, 1, Symbol("int"), UnrecognizedStorageType]) {
		g_Assert.throws(() => PluginModule.exports.Invoke(EntityValue, HealthProperty, StorageType, nTemporaryHealth, () => g_Assert.fail("An invalid storage type must not invoke the callback.")), { name: "TypeError", message: "Unknown property storage type; use a canonical storage-type string." });
		g_Assert.equal(State.unWriteCount, 0, "An invalid storage type must not write native memory.");
		g_Assert.equal(State.nHealth, nOriginalHealth);
	}

	ExecuteDocumentationBlock(vecDocumentationBlocks[unLiveVectorBlockIndex], unLiveVectorBlockIndex, Modules);
	g_Assert.deepEqual(Array.from(arrOrigin), vecOriginalOrigin, "The live-vector example must restore its float32 components.");
	g_Assert.equal(vecVectorLogs.length, 1, "The live-vector example must report through the typed logger.");
	g_Assert.equal(vecVectorLogs[0].Format, "VerifyLiveVectorAccess Address=0x%s Result=%j");
	g_Assert.equal(vecVectorLogs[0].Values[0], "FEDCBA9876543210", "The native address must retain every bit without Number conversion.");
	g_Assert.deepEqual(JSON.parse(JSON.stringify(vecVectorLogs[0].Values[1])), { X: vecOriginalOrigin[0], Y: vecOriginalOrigin[1], Z: vecOriginalOrigin[2] });
	g_Assert.equal(vecVectorLogs[0].Rendered, `VerifyLiveVectorAccess Address=0xFEDCBA9876543210 Result=${JSON.stringify({ X: vecOriginalOrigin[0], Y: vecOriginalOrigin[1], Z: vecOriginalOrigin[2] })}`);
}

function VerifyVectorDiscoveryDocumentation(vecDocumentationBlocks) {
	const unVectorDiscoveryBlockIndex = 11;
	const unFirstAddress = 0xFEDCBA9876543210n;
	const unSecondAddress = 0xABCDEF9876543210n;
	const vecProperties = [
		{ TypeID: g_SendPropertyTypes.Vector, Path: "m_vecOrigin", Offset: 0x78, Address: unFirstAddress },
		{ TypeID: g_SendPropertyTypes.VectorXY, Path: "m_vecOriginXY", Offset: 0x84, Address: unSecondAddress },
		{ TypeID: g_SendPropertyTypes.Int, Path: "m_iHealth", Offset: 0x64, Address: unFirstAddress },
	];
	for (const bHasVectorXY of [false, true]) {
		const vecLogs = [];
		const SendPropType = { VECTOR: g_SendPropertyTypes.Vector };
		if (bHasVectorXY) {
			SendPropType.VECTOR_XY = g_SendPropertyTypes.VectorXY;
		}

		ExecuteDocumentationBlock(vecDocumentationBlocks[unVectorDiscoveryBlockIndex], unVectorDiscoveryBlockIndex, {
			"entities/entity": { Entity: () => ({ Index: 1 }) },
			"entities/props": { GetEntitySendTable: () => ({ Name: "DT_ReviewedFixture" }), GetServerClassProperties: () => vecProperties, SendPropType },
			loggers: {
				LogInfo(strFormat, ...vecValues) {
					vecLogs.push({ Format: strFormat, Values: vecValues, Rendered: g_Util.format(strFormat, ...vecValues) });
				},
			},
		});
		const vecExpectedProperties = bHasVectorXY ? vecProperties.slice(0, 2) : vecProperties.slice(0, 1);
		g_Assert.equal(vecLogs.length, vecExpectedProperties.length);

		for (const [unPropertyIndex, Property] of vecExpectedProperties.entries()) {
			const Log = vecLogs[unPropertyIndex];
			const strAddress = Property.Address.toString(16).toUpperCase();
			const ExpectedFields = { PropertyPath: Property.Path, PropertyOffset: Property.Offset };
			g_Assert.equal(Log.Format, "FindVectorProperty Address=0x%s Result=%j");
			g_Assert.equal(Log.Values[0], strAddress, "Vector metadata addresses must retain every bit.");
			g_Assert.deepEqual(JSON.parse(JSON.stringify(Log.Values[1])), ExpectedFields);
			g_Assert.equal(Log.Rendered, `FindVectorProperty Address=0x${strAddress} Result=${JSON.stringify(ExpectedFields)}`);
		}
	}
}

function VerifyEntityHandleDocumentation(vecDocumentationBlocks) {
	const unHandleBlockIndex = 6;
	const unTargetEntityIndex = 1;
	const unPreviousOwnerIndex = 2;
	const unReplacementOwnerIndex = 3;
	const unOriginalTargetHandle = 0x00070001;
	const unOriginalTargetSerial = 7;
	const unOriginalOwnerHandle = 0x00030002;
	const unReplacementOwnerHandle = 0x00050003;
	const nOwnerPropertyOffset = 0x88;

	for (const strScenario of ["OriginalEntities", "PreviousOwnerChangedHandle", "PreviousOwnerRemoved", "TargetRemoved", "TargetChangedHandle", "TargetChangedSerial"]) {
		const State = { bTargetValid: true, bPreviousOwnerValid: true, unTargetHandle: unOriginalTargetHandle, unTargetSerial: unOriginalTargetSerial, unPreviousOwnerHandle: unOriginalOwnerHandle, unStoredHandle: unOriginalOwnerHandle, unWriteCount: 0 };
		const Target = {
			Index: unTargetEntityIndex,
			get Valid() {
				return State.bTargetValid;
			},
			get HandleValue() {
				return State.unTargetHandle;
			},
			get NetworkSerialNumber() {
				return State.unTargetSerial;
			},
		};
		const PreviousOwner = {
			Index: unPreviousOwnerIndex,
			get Valid() {
				return State.bPreviousOwnerValid;
			},
			get HandleValue() {
				return State.unPreviousOwnerHandle;
			},
		};
		const ReplacementOwner = { Index: unReplacementOwnerIndex, Valid: true, HandleValue: unReplacementOwnerHandle };
		const OwnerProperty = { Path: "m_hOwnerEntity", Offset: nOwnerPropertyOffset };
		const FixtureProperties = {
			GetEntitySendProperty(EntityValue, strPropertyName) {
				g_Assert.equal(strPropertyName, OwnerProperty.Path);

				return (EntityValue === Target) ? OwnerProperty : null;
			},
			GetEntityPropertyUnsignedInteger(EntityValue, Property) {
				g_Assert.strictEqual(EntityValue, Target);
				g_Assert.strictEqual(Property, OwnerProperty);

				return State.unStoredHandle;
			},
			GetEntityPropertyEntity(EntityValue, Property) {
				g_Assert.strictEqual(EntityValue, Target);
				g_Assert.strictEqual(Property, OwnerProperty);

				return (State.unStoredHandle === unReplacementOwnerHandle) ? ReplacementOwner : PreviousOwner;
			},
			SetEntityPropertyEntity(EntityValue, Property, Value) {
				g_Assert.strictEqual(EntityValue, Target);
				g_Assert.strictEqual(Property, OwnerProperty);

				if (typeof Value === "number") {
					State.unStoredHandle = Value;

				} else {
					g_Assert.equal(Value.Valid, true, "The previous owner must not be resolved again after removal.");

					State.unStoredHandle = Value.HandleValue;
				}

				State.unWriteCount++;

				if (State.unWriteCount === 1) {
					if (strScenario === "PreviousOwnerChangedHandle") {
						State.unPreviousOwnerHandle++;

					} else if (strScenario === "PreviousOwnerRemoved") {
						State.bPreviousOwnerValid = false;

					} else if (strScenario === "TargetRemoved") {
						State.bTargetValid = false;

					} else if (strScenario === "TargetChangedHandle") {
						State.unTargetHandle++;

					} else if (strScenario === "TargetChangedSerial") {
						State.unTargetSerial++;
					}
				}

				return true;
			},
		};
		ExecuteDocumentationBlock(vecDocumentationBlocks[unHandleBlockIndex], unHandleBlockIndex, { entities: { GetAllEntities: () => [Target, PreviousOwner, ReplacementOwner] }, "entities/props": FixtureProperties });

		const bOriginalTarget = !strScenario.startsWith("Target");
		g_Assert.equal(State.unWriteCount, bOriginalTarget ? 2 : 1, `Unexpected owner restoration after ${strScenario}.`);
		g_Assert.equal(State.unStoredHandle, bOriginalTarget ? unOriginalOwnerHandle : unReplacementOwnerHandle, `The packed owner handle changed after ${strScenario}.`);
	}
}

function SnapshotPropertyValue(Value) {
	if (typeof Value === "bigint") {
		return { BigInt: Value.toString() };
	}

	if (Array.isArray(Value)) {
		return Value.slice();
	}

	if (Value && Number.isInteger(Value.Index)) {
		return { EntityIndex: Value.Index };
	}

	return Value;
}

function SnapshotEntityState() {
	return JSON.stringify(Array.from(g_mapEntityStates.values(), (EntityState) => ({
		Index: EntityState.Index,
		Values: Array.from(EntityState.Values, ([unOffset, Value]) => [unOffset, SnapshotPropertyValue(Value)]),
	})));
}

function VerifyBigIntPropertyContracts(Properties, EntityInstance) {
	const unPropertyOffsetBase = 0x1000;
	const unPropertyOffsetStride = 0x10;
	const vecIntegerCases = [
		{ GetterName: "GetEntityPropertyLongLong", SetterName: "SetEntityPropertyLongLong", Minimum: -0x8000000000000000n, Maximum: 0x7FFFFFFFFFFFFFFFn },
		{ GetterName: "GetEntityPropertyUnsignedLongLong", SetterName: "SetEntityPropertyUnsignedLongLong", Minimum: 0n, Maximum: 0xFFFFFFFFFFFFFFFFn },
	];

	g_Assert.equal(typeof EntityInstance.Address, "bigint", "Entity addresses must remain BigInt.");

	for (const ServerClass of Properties.GetServerClasses()) {
		g_Assert.deepEqual(Object.keys(ServerClass).sort(), g_vecServerClassFields.slice().sort(), "Server-class record fields must match the public schema.");
		g_Assert.equal(typeof ServerClass.Address, "bigint", "Server-class addresses must remain BigInt.");
		g_Assert.equal(typeof ServerClass.NextAddress, "bigint", "Next-server-class addresses, including null, must remain BigInt.");
		g_Assert.equal(typeof ServerClass.ClassIndex, "number");
		g_Assert.deepEqual(Object.keys(ServerClass.Table).sort(), g_vecSendTableFields.slice().sort(), "Send-table record fields must match the public schema.");
		g_Assert.equal(typeof ServerClass.Table.Address, "bigint", "Send-table addresses must remain BigInt.");

		for (const Property of Properties.GetServerClassProperties(ServerClass)) {
			g_Assert.deepEqual(Object.keys(Property).sort(), g_vecSendPropertyFields.slice().sort(), "Send-property record fields must match the public schema.");

			for (const strFieldName of ["Address", "ArrayLengthProxyFunctionAddress", "ArrayPropertyAddress", "DataTableProxyFunctionAddress", "ProxyFunctionAddress"]) {
				g_Assert.equal(typeof Property[strFieldName], "bigint", strFieldName + " must remain a BigInt address.");
			}

			g_Assert.equal(typeof Property.Offset, "number");
			g_Assert.equal(typeof Property.Flags, "number");
		}
	}

	for (const [unCaseIndex, Case] of vecIntegerCases.entries()) {
		const Property = { Offset: unPropertyOffsetBase + unCaseIndex * unPropertyOffsetStride };
		for (const nValue of [Case.Minimum, Case.Maximum]) {
			g_Assert.equal(Properties[Case.SetterName](EntityInstance, Property, nValue), true);
			g_Assert.equal(Properties[Case.GetterName](EntityInstance, Property), nValue, Case.GetterName + " must preserve full-width BigInt boundaries.");
		}

		for (const InvalidValue of [0, 1, -1, 0.5, NaN, Infinity, "1", null, undefined, {}, Case.Minimum - 1n, Case.Maximum + 1n]) {
			const nValueBefore = Properties[Case.GetterName](EntityInstance, Property);
			g_Assert.throws(() => Properties[Case.SetterName](EntityInstance, Property, InvalidValue), { name: "TypeError", message: /BigInt/ }, Case.SetterName + " must reject invalid or out-of-range values.");
			g_Assert.equal(Properties[Case.GetterName](EntityInstance, Property), nValueBefore, "Rejected 64-bit writes must not change storage.");
		}
	}

	// This controlled storage model checks precision, not native address-space validity.
	const AddressProperty = { Offset: unPropertyOffsetBase + vecIntegerCases.length * unPropertyOffsetStride };
	g_Assert.equal(Properties.GetEntityPropertyAddress(EntityInstance, AddressProperty), 0n, "Unset address storage must be a BigInt null address.");

	for (const unAddress of [0n, 0x123456n, 0x20000000000001n]) {
		g_Assert.equal(Properties.SetEntityPropertyAddress(EntityInstance, AddressProperty, unAddress), true);
		g_Assert.equal(Properties.GetEntityPropertyAddress(EntityInstance, AddressProperty), unAddress, "Address storage must preserve exact BigInt precision.");
	}

	for (const InvalidValue of [-1n, 0, 1, NaN, Infinity, "4096", null, undefined, {}]) {
		const unAddressBefore = Properties.GetEntityPropertyAddress(EntityInstance, AddressProperty);
		g_Assert.throws(() => Properties.SetEntityPropertyAddress(EntityInstance, AddressProperty, InvalidValue), { name: "TypeError", message: /BigInt address/ }, "Address writes must reject invalid BigInt addresses.");
		g_Assert.equal(Properties.GetEntityPropertyAddress(EntityInstance, AddressProperty), unAddressBefore, "Rejected address writes must not change storage.");
	}
}

const g_unExpectedPropertyExportCount = 66;
const g_unInvalidBooleanPropertyOffset = 0xBB8;
const g_unInvalidStringPropertyOffset = 0xBB9;
const g_unInvalidAddressPropertyOffset = 0xBBA;

require.cache[g_strRuntimePath] = {
	children: [],
	exports: {
		GetModule(strModuleName) {
			if (strModuleName === "entities/props") {
				return g_NativeProperties;
			}

			throw new Error(`Unexpected native module: ${strModuleName}`);
		},
	},
	filename: g_strRuntimePath,
	id: g_strRuntimePath,
	loaded: true,
	paths: [],
};

globalThis.sourcejs = { "entities/props": g_NativeProperties };

delete require.cache[g_strPropertiesPath];

const g_Properties = require(g_strPropertiesPath);
g_Assert.strictEqual(g_Properties, g_NativeProperties);
g_Assert.equal(g_vecExpectedExports.length, g_unExpectedPropertyExportCount);
g_Assert.deepEqual(Object.keys(g_Properties).sort(), g_vecExpectedExports.slice().sort());

const g_Player = Entity(1);
const g_Weapon = Entity(2);
const g_PlayerClass = g_Properties.FindServerClassByName("CTerrorPlayer");
const g_PlayerTable = g_Properties.GetSendTable(g_PlayerClass);
const g_HealthProperty = g_Properties.GetServerClassProperty(g_PlayerTable, "m_iHealth");

g_Assert.equal(Object.hasOwn(g_PlayerClass, "Name"), true);
g_Assert.equal(Object.hasOwn(g_PlayerClass, "Table"), true);
g_Assert.equal(Object.hasOwn(g_PlayerTable, "Name"), true);
g_Assert.equal(Object.hasOwn(g_PlayerTable, "Properties"), true);
g_Assert.equal(Object.hasOwn(g_HealthProperty, "Name"), true);
g_Assert.equal(Object.hasOwn(g_HealthProperty, "Offset"), true);
g_Assert.equal(g_HealthProperty.Path, "baseclass.m_iHealth");
g_Assert.equal(g_HealthProperty.Offset, g_unHealthOffset);
VerifyBigIntPropertyContracts(g_Properties, g_Player);
g_Assert.equal(g_Properties.GetSendTable(g_PlayerTable.Address).Name, g_PlayerTable.Name);
g_Assert.equal(g_Properties.GetSendTable(g_PlayerClass.Address).Name, g_PlayerTable.Name);
g_Assert.equal(g_Properties.FindServerClassPropertyOffset(g_PlayerClass, "m_iHealth"), g_unHealthOffset);
g_Assert.equal(g_Properties.GetServerClassProperty(g_PlayerTable, -1), null);
g_Assert.equal(g_Properties.FindServerClassByName("MissingClass"), null);
g_Assert.equal(g_Properties.GetSendTable("MissingTable"), null);
g_Assert.deepEqual(g_Properties.GetServerClassProperties("MissingTable"), []);
g_Assert.equal(g_Properties.FindServerClassPropertyOffset("MissingTable", "m_iHealth"), -1);

const g_unTypedPropertyOffsetBase = 0x3E8;
const g_unGenericPropertyOffsetBase = 0x7D0;
const g_unPropertyOffsetStride = 0x10;

for (const [unTypeIndex, [strTypeName, strGetterName, strSetterName, ConfiguredValue]] of g_vecTypeAccessors.entries()) {
	const Property = { Offset: g_unTypedPropertyOffsetBase + unTypeIndex * g_unPropertyOffsetStride };
	const Value = (strTypeName === "entity") ? g_Weapon : ConfiguredValue;

	g_Assert.equal(g_Properties[strSetterName](g_Player, Property, Value), true);

	const Result = g_Properties[strGetterName](g_Player, Property);

	if (strTypeName === "vector") {
		g_Assert.equal(Result.Address, g_Player.Address + BigInt(Property.Offset), "Vector view addresses must preserve BigInt byte offsets.");
		g_Assert.deepEqual({ X: Result.X, Y: Result.Y, Z: Result.Z }, ConfiguredValue);
		Result.X = 40;
		g_Assert.equal(g_Properties[strGetterName](g_Player, Property).X, 40);

	} else {
		g_Assert.deepEqual(Result, Value);
	}
}

for (const [unTypeIndex, strTypeName] of g_vecCanonicalTypes.entries()) {
	const Property = { Offset: g_unGenericPropertyOffsetBase + unTypeIndex * g_unPropertyOffsetStride };
	let Value = g_vecTypeAccessors.find(([strCandidateType]) => strCandidateType === strTypeName)?.[3];

	if (strTypeName === "vectorxy") {
		Value = { X: 7, Y: 8, Z: 9 };

	} else if (strTypeName === "entity") {
		Value = g_Weapon;
	}

	g_Assert.equal(g_Properties.SetEntityProperty(g_Player, Property, Value, strTypeName), true);

	const Result = g_Properties.GetEntityProperty(g_Player, Property, strTypeName);

	if (strTypeName === "vector") {
		g_Assert.equal(Result.Address, g_Player.Address + BigInt(Property.Offset), "Vector view addresses must preserve BigInt byte offsets.");
		g_Assert.deepEqual({ X: Result.X, Y: Result.Y, Z: Result.Z }, Value);

	} else if (strTypeName === "vectorxy") {
		g_Assert.equal(Result.Address, g_Player.Address + BigInt(Property.Offset), "VectorXY view addresses must preserve BigInt byte offsets.");
		g_Assert.deepEqual({ X: Result.X, Y: Result.Y }, { X: Value.X, Y: Value.Y });
		g_Assert.equal(Object.hasOwn(Result, "Z"), false);

	} else {
		g_Assert.deepEqual(Result, Value);
	}
}

g_Assert.equal(g_Properties.GetEntityProperty(g_Player, g_HealthProperty), 80);
g_Assert.equal(g_Properties.SetEntityProperty(g_Player, g_HealthProperty, 79), true);
g_Assert.equal(g_Properties.GetEntityPropertyInteger(g_Player, g_HealthProperty), 79);
g_Assert.equal(g_Properties.SetEntityPropertyInteger(g_Player, g_HealthProperty, 80), true);

const g_BaseTableProperty = g_Properties.GetServerClassProperty(g_PlayerTable, "baseclass");
g_Assert.equal(g_Properties.GetEntityProperty(g_Player, g_BaseTableProperty), g_Player.Address);
g_Assert.throws(() => g_Properties.SetEntityProperty(g_Player, g_BaseTableProperty, 1), /cannot infer writable data-table storage/);

const g_OriginProperty = g_Properties.GetEntitySendProperty(g_Player, "m_vecOrigin");
const g_Origin = g_Properties.GetEntityPropertyVector(g_Player, g_OriginProperty);

g_Origin.Y = 25;
g_Assert.equal(g_Properties.GetEntityPropertyVector(g_Player, g_OriginProperty).Y, 25);
g_Origin.Y = 20;

const g_OwnerProperty = g_Properties.GetEntitySendProperty(g_Weapon, "m_hOwnerEntity");
g_Assert.equal(g_Properties.GetEntityPropertyEntity(g_Weapon, g_OwnerProperty).Index, 1);
g_Assert.equal(g_Properties.SetEntityPropertyEntity(g_Weapon, g_OwnerProperty, g_Player), true);
g_Assert.equal(g_Properties.GetEntityPropertyEntity(g_Weapon, g_OwnerProperty).Index, 1);

g_Assert.deepEqual(g_Properties.CreateEntityPropertyVariant(), { Type: "int", Value: null });
g_Assert.deepEqual(g_Properties.CreateEntityPropertyVariant("vector", { X: 1, Y: 2, Z: 3 }), { Type: "vector", Value: { X: 1, Y: 2, Z: 3 } });
g_Assert.throws(() => g_Properties.CreateEntityPropertyVariant("uint32", 1), /Unknown/);
g_Assert.throws(() => g_Properties.SetEntityPropertyBoolean(g_Player, { Offset: g_unInvalidBooleanPropertyOffset }, 1), /boolean/);
g_Assert.throws(() => g_Properties.SetEntityPropertyStringArray(g_Player, { Offset: g_unInvalidStringPropertyOffset }, 10), /string/);
g_Assert.throws(() => g_Properties.SetEntityPropertyAddress(g_Player, { Offset: g_unInvalidAddressPropertyOffset }, "4096"), /address/);
g_Assert.throws(() => g_Properties.SetEntityPropertyAddress(g_Player, { Offset: g_unInvalidAddressPropertyOffset }, 4096), /address/);
g_Assert.throws(() => g_Properties.FindServerClassByName(123), /string/);
g_Assert.throws(() => g_Properties.GetEntitySendProperty(g_Player, ""), /string/);
g_Assert.throws(() => g_Properties.GetEntityPropertyBoolean(), /expects/);
g_Assert.throws(() => g_Properties.SetEntityPropertyBoolean(g_Player, { Offset: 0x01 }), /expects/);

for (const strTypeAlias of [
	"boolean",
	"entity_handle",
	"handle",
	"int16",
	"int64",
	"long_long",
	"ptr",
	"string",
	"string_array",
	"string_pointer",
	"uint16",
	"uint32",
	"uint64",
	"ulong_long",
	"vector_xy",
]) {
	g_Assert.throws(() => g_Properties.GetEntityProperty(g_Player, g_HealthProperty, strTypeAlias), /Unknown/);
	g_Assert.throws(() => g_Properties.SetEntityProperty(g_Player, g_HealthProperty, 1, strTypeAlias), /Unknown/);
}

function VerifyWorldPropertyExample(Properties) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("entities\/props worldspawn reflection",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world property callback must remain available");

	for (const vecEntities of [[], [g_Player]]) {
		let Result = undefined;
		g_VM.runInNewContext(vecMatch[0], {
			...Properties,
			GetEntitiesByClassName: () => vecEntities,
			LogResult: (strLabel, Callback) => {
				g_Assert.equal(strLabel, "entities/props worldspawn reflection");

				Result = Callback();
			},
		}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

		if (vecEntities.length === 0) {
			g_Assert.equal(Result, null);
			continue;
		}

		const Property = Properties.GetServerClassProperties(g_Player)[0];
		g_Assert.ok(Property, "populated property profile must contain metadata");
		g_Assert.equal(Result.FirstProperty.Path, Property.Path);
		g_Assert.equal(Result.FirstProperty.Offset, Property.Offset);
		g_Assert.equal(Result.FirstProperty.Address, Property.Address);
		g_Assert.deepEqual(Result.FirstProperty.Value, Properties.GetEntityProperty(g_Player, Property.Path));
	}
}

VerifyWorldPropertyExample(g_Properties);

const g_strStateBeforeDocumentation = SnapshotEntityState();
const g_setReferencedExports = new Set();
const g_TrackedProperties = TrackModule(g_Properties, g_setReferencedExports);
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);

const g_unExpectedDocumentationBlockCount = 14;
g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);
VerifyProxyReflectionFields();
VerifyTemporaryPropertyDocumentation(g_vecDocumentationBlocks);
VerifyEntityHandleDocumentation(g_vecDocumentationBlocks);
VerifyVectorDiscoveryDocumentation(g_vecDocumentationBlocks);

const g_vecDocumentationLogs = [];
const g_DocumentationLoggers = {
	LogInfo(strFormat, ...vecValues) {
		g_Assert.equal(typeof strFormat, "string");
		g_Assert.doesNotMatch(strFormat, /^\s*\[/, "Typed logger messages must not duplicate severity.");
		g_vecDocumentationLogs.push({ Format: strFormat, Values: vecValues, Rendered: g_Util.format(strFormat, ...vecValues) });
	},
};

for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unBlockIndex, {
		entities: {
			GetAllEntities() {
				return Array.from(g_mapEntityStates.values(), (EntityState) => MakeEntity(EntityState));
			},
		},
		"entities/entity": { Entity },
		"entities/props": g_TrackedProperties,
		loggers: g_DocumentationLoggers,
	});
}

const g_setVectorTypeIDs = new Set([g_Properties.SendPropType.VECTOR]);
if (Object.hasOwn(g_Properties.SendPropType, "VECTOR_XY")) {
	g_setVectorTypeIDs.add(g_Properties.SendPropType.VECTOR_XY);
}

const g_vecExpectedVectorProperties = g_Properties.GetServerClassProperties(g_Properties.GetEntitySendTable(Entity(1))).filter(Property => g_setVectorTypeIDs.has(Property.TypeID));
const g_unExpectedFixedDocumentationLogCount = 8;
const g_unVectorPropertyLogBeginIndex = 7;
const g_unCapabilitiesLogIndex = 0;
const g_unResolvedMetadataLogIndex = 1;
const g_unPropertyIdentifiersLogIndex = 2;
const g_unLiveVectorLogIndex = 3;
const g_unPropertyVariantLogIndex = 4;
const g_unSendPropertyConstantsLogIndex = 5;
const g_unHealthPropertyLogIndex = 6;
g_Assert.equal(g_vecDocumentationLogs.length, g_unExpectedFixedDocumentationLogCount + g_vecExpectedVectorProperties.length, "All reporting examples must use the typed logger.");
g_Assert.deepEqual(Object.keys(g_vecDocumentationLogs[g_unCapabilitiesLogIndex].Values[0]).sort(), ["GetEntityPropertyIntegerType", "GetEntitySendPropertyType", "SetEntityPropertyIntegerType"]);
g_Assert.equal(Object.values(g_vecDocumentationLogs[g_unCapabilitiesLogIndex].Values[0]).every(strTypeName => strTypeName === "function"), true);
g_Assert.equal(g_vecDocumentationLogs[g_unCapabilitiesLogIndex].Format, "ReportEntityPropertyCapabilities Result=%j");
g_Assert.equal(g_vecDocumentationLogs[g_unResolvedMetadataLogIndex].Format, "ReportResolvedServerClassMetadata Result=%j");
g_Assert.equal(g_vecDocumentationLogs[g_unPropertyIdentifiersLogIndex].Format, "ReportEntityPropertyIdentifiers Result=%j");

const g_ResolvedMetadataLog = g_vecDocumentationLogs[g_unResolvedMetadataLogIndex].Values[0];
const g_ReportedServerClass = g_Properties.FindServerClassByName(g_ResolvedMetadataLog.ClassName);
g_Assert.notEqual(g_ReportedServerClass, null);
g_Assert.equal(g_ResolvedMetadataLog.ServerClassCount, g_Properties.GetServerClasses().length);
g_Assert.equal(g_ResolvedMetadataLog.TableName, g_ReportedServerClass.Table.Name);
g_Assert.equal(g_ResolvedMetadataLog.VerifiedPropertyOffset, g_Properties.FindServerClassPropertyOffset(g_ReportedServerClass, g_ResolvedMetadataLog.PropertyPath));

const g_PropertyIdentifiersLog = g_vecDocumentationLogs[g_unPropertyIdentifiersLogIndex].Values[0];
g_Assert.equal(g_PropertyIdentifiersLog.HealthByRecord, g_Properties.GetEntityPropertyInteger(Entity(1), g_PropertyIdentifiersLog.PropertyPath));
g_Assert.equal(g_PropertyIdentifiersLog.ServerClassName, g_Properties.GetEntityServerClass(Entity(1)).Name);
g_Assert.equal(g_PropertyIdentifiersLog.TableName, g_Properties.GetEntitySendTable(Entity(1)).Name);

const g_LiveOrigin = g_Properties.GetEntityPropertyVector(Entity(1), "m_vecOrigin");
const g_LiveVectorLog = g_vecDocumentationLogs[g_unLiveVectorLogIndex];
g_Assert.equal(g_LiveVectorLog.Format, "VerifyLiveVectorAccess Address=0x%s Result=%j");
g_Assert.equal(g_LiveVectorLog.Values[0], g_LiveOrigin.Address.toString(16).toUpperCase());
g_Assert.deepEqual(JSON.parse(JSON.stringify(g_LiveVectorLog.Values[1])), { X: g_LiveOrigin.X, Y: g_LiveOrigin.Y, Z: g_LiveOrigin.Z });

const g_PropertyVariantLog = g_vecDocumentationLogs[g_unPropertyVariantLogIndex];
g_Assert.equal(g_PropertyVariantLog.Format, "VerifyEntityPropertyVariants Result=%j");
g_Assert.deepEqual(JSON.parse(JSON.stringify(g_PropertyVariantLog.Values[0])), {
	DestinationVariant: { Type: "vector", Value: { X: 256, Y: -32, Z: 64 } },
	EmptyVariant: { Type: "int", Value: null },
	HealthVariant: { Type: "int", Value: 100 },
});
g_Assert.equal(g_vecDocumentationLogs[g_unSendPropertyConstantsLogIndex].Format, "VerifySendPropertyConstants Result=%j");
g_Assert.deepEqual(Array.from(g_vecDocumentationLogs[g_unSendPropertyConstantsLogIndex].Values[0].SendPropertyTypeMembers), Object.keys(g_Properties.SendPropType));

const g_HealthPropertyForLogging = g_Properties.GetEntitySendProperty(Entity(1), "m_iHealth");
const g_HealthPropertyLog = g_vecDocumentationLogs[g_unHealthPropertyLogIndex];
g_Assert.equal(g_HealthPropertyLog.Format, "InspectHealthSendProperty Result=%j");
g_Assert.deepEqual(JSON.parse(JSON.stringify(g_HealthPropertyLog.Values[0])), { HealthChangesOften: (g_HealthPropertyForLogging.Flags & g_Properties.SendPropFlags.CHANGES_OFTEN) !== 0, HealthIsUnsigned: (g_HealthPropertyForLogging.Flags & g_Properties.SendPropFlags.UNSIGNED) !== 0, PropertyPath: g_HealthPropertyForLogging.Path, PropertyType: g_HealthPropertyForLogging.Type });

for (const [unPropertyIndex, Property] of g_vecExpectedVectorProperties.entries()) {
	const Log = g_vecDocumentationLogs[g_unVectorPropertyLogBeginIndex + unPropertyIndex];
	g_Assert.equal(Log.Format, "FindVectorProperty Address=0x%s Result=%j");
	g_Assert.equal(Log.Values[0], Property.Address.toString(16).toUpperCase());
	g_Assert.deepEqual(JSON.parse(JSON.stringify(Log.Values[1])), { PropertyPath: Property.Path, PropertyOffset: Property.Offset });
}

const g_unMaximumReportedPropertyPathCount = 20;
const g_vecComparableServerClasses = g_Properties.GetServerClasses().filter(ServerClass => g_Properties.GetServerClassProperties(ServerClass).length > 0);
const g_vecFirstClassPaths = g_Properties.GetServerClassProperties(g_vecComparableServerClasses[0]).map(Property => Property.Path);
const g_setSecondClassPaths = new Set(g_Properties.GetServerClassProperties(g_vecComparableServerClasses[1]).map(Property => Property.Path));
const g_ComparisonLog = g_vecDocumentationLogs[g_unVectorPropertyLogBeginIndex + g_vecExpectedVectorProperties.length];
g_Assert.equal(g_ComparisonLog.Format, "DiagnosePropertyDifferencesBetweenClasses Result=%j");
g_Assert.deepEqual(JSON.parse(JSON.stringify(g_ComparisonLog.Values[0])), { FirstServerClassOnlyPropertyPaths: g_vecFirstClassPaths.filter(strPath => !g_setSecondClassPaths.has(strPath)).slice(0, g_unMaximumReportedPropertyPathCount), FirstServerClassName: g_vecComparableServerClasses[0].Name, SecondServerClassName: g_vecComparableServerClasses[1].Name });
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\(/, "Executable documentation must use the typed logger.");

g_Assert.equal(SnapshotEntityState(), g_strStateBeforeDocumentation);

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setReferencedExports.has(strExportName), true, `Documentation did not reference entities/props.${strExportName}.`);
}

g_Assert.equal(g_strDocumentation.includes("Generated reference"), false);
g_Assert.equal(g_strDocumentation.includes("parseWeaponINI(\"Welcome to the SourceJS server!\")"), false);
g_Assert.match(g_strDocumentation, /It has no default export or alternate module path\./);

delete require.cache[g_strPropertiesPath];
delete globalThis.sourcejs;
delete require.cache[g_strRuntimePath];

// The runtime-path hook keeps this boundary check independent of NODE_PATH.
g_Assert.throws(() => require(g_strPropertiesPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Native runtime absence must be reported, not a module-resolution or unrelated error.");

g_Module._load = g_OriginalModuleLoad;

console.log("[  OK  ] entities props and documentation passed with controlled doubles; native SDK execution not exercised");
