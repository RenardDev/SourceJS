#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strDataMapsDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-datamaps.md");
const g_strDataMapsPath = g_Path.join(g_strPackageRoot, "entities", "datamaps.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_unBaseDataMapAddress = 0x2710n;
const g_unPlayerDataMapAddress = 0x2AF8n;
const g_unFireOutputHookAddress = 0x61A8n;
const g_unTargetDataMapAddress = 0x2EE0n;
const g_unVariantAddress = 0x6590n;
const g_unFieldAddressStride = 0x20n;
const g_unEntityAddressStride = 0x400n;
const g_vecExpectedExports = [
	"FieldType",
	"TypeDescriptionFlags",
	"CallEntityInputFunction",
	"FindEntityDataMapField",
	"FindEntityDataMapFieldOffset",
	"GetEntityDataMap",
	"GetEntityDataMapField",
	"GetEntityInputFunction",
	"GetEntityDataMapProperty",
	"GetEntityDataMapPropertyBoolean",
	"GetEntityDataMapPropertyCharacter",
	"GetEntityDataMapPropertyColor",
	"GetEntityDataMapPropertyDouble",
	"GetEntityDataMapPropertyEntity",
	"GetEntityDataMapPropertyFloat",
	"GetEntityDataMapPropertyInteger",
	"GetEntityDataMapPropertyInterval",
	"GetEntityDataMapPropertyLong",
	"GetEntityDataMapPropertyLongLong",
	"GetEntityDataMapPropertyAddress",
	"GetEntityDataMapPropertyShort",
	"GetEntityDataMapPropertyString",
	"GetEntityDataMapPropertyStringArray",
	"GetEntityDataMapPropertyUnsignedCharacter",
	"GetEntityDataMapPropertyUnsignedInteger",
	"GetEntityDataMapPropertyUnsignedLong",
	"GetEntityDataMapPropertyUnsignedLongLong",
	"GetEntityDataMapPropertyUnsignedShort",
	"GetEntityDataMapPropertyVector",
	"CreateEntityDataMapInterval",
	"GetEntityDataMapFields",
	"SetEntityDataMapProperty",
	"SetEntityDataMapPropertyBoolean",
	"SetEntityDataMapPropertyCharacter",
	"SetEntityDataMapPropertyColor",
	"SetEntityDataMapPropertyDouble",
	"SetEntityDataMapPropertyEntity",
	"SetEntityDataMapPropertyFloat",
	"SetEntityDataMapPropertyInteger",
	"SetEntityDataMapPropertyInterval",
	"SetEntityDataMapPropertyLong",
	"SetEntityDataMapPropertyLongLong",
	"SetEntityDataMapPropertyAddress",
	"SetEntityDataMapPropertyShort",
	"SetEntityDataMapPropertyString",
	"SetEntityDataMapPropertyStringArray",
	"SetEntityDataMapPropertyUnsignedCharacter",
	"SetEntityDataMapPropertyUnsignedInteger",
	"SetEntityDataMapPropertyUnsignedLong",
	"SetEntityDataMapPropertyUnsignedLongLong",
	"SetEntityDataMapPropertyUnsignedShort",
	"SetEntityDataMapPropertyVector",
	"CreateEntityDataMapVariant",
	"CreateEntityDataMapVariantFromAddress",
];

const g_vecFieldRecordKeys = [
	"Address",
	"OwnerClassName",
	"Index",
	"Offset",
	"LocalOffset",
	"FlatOffset",
	"PackedOffset",
	"TypeID",
	"Type",
	"Name",
	"Path",
	"ElementCount",
	"Flags",
	"ExternalName",
	"SizeInBytes",
	"OverrideCount",
	"Tolerance",
	"Input",
	"Output",
	"Key",
	"Embedded",
	"SaveRestoreAddress",
	"OverrideFieldAddress",
	"InputFunctionAddress",
	"EmbeddedDatamapAddress",
];

const g_FieldType = Object.freeze({
	Void: 0,
	Float: 1,
	String: 2,
	Vector: 3,
	Quaternion: 4,
	Integer: 5,
	Boolean: 6,
	Short: 7,
	Character: 8,
	Color32: 9,
	Embedded: 10,
	Custom: 11,
	ClassAddress: 12,
	EntityHandle: 13,
	Edict: 14,
	PositionVector: 15,
	Time: 16,
	Tick: 17,
	ModelName: 18,
	SoundName: 19,
	Input: 20,
	Function: 21,
	VMatrix: 22,
	VMatrixWorldSpace: 23,
	Matrix3x4WorldSpace: 24,
	Interval: 25,
	ModelIndex: 26,
	MaterialIndex: 27,
	Vector2D: 28,
	TypeCount: 29,
});

const g_TypeDescriptionFlags = Object.freeze({
	Global: 0x0001,
	Save: 0x0002,
	Key: 0x0004,
	Input: 0x0008,
	Output: 0x0010,
	FunctionTable: 0x0020,
	Address: 0x0040,
	Override: 0x0080,
	InSendTable: 0x0100,
	Private: 0x0200,
	NoErrorCheck: 0x0400,
	ModelIndex: 0x0800,
	Index: 0x1000,
	ViewOtherPlayer: 0x2000,
	ViewOwnTeam: 0x4000,
	ViewNever: 0x8000,
});

let g_unNextFieldAddress = 0x7530n;
let g_unNextEntityAddress = 0xC350n;

function MakeField(strOwnerClassName, unIndex, strName, unOffset, unTypeID, strType, Options = {}) {
	const unFlags = Options.Flags ?? 0x00;
	const Field = {
		Address: g_unNextFieldAddress,
		OwnerClassName: strOwnerClassName,
		Index: unIndex,
		Offset: unOffset,
		LocalOffset: unOffset,
		FlatOffset: unOffset,
		PackedOffset: unOffset,
		TypeID: unTypeID,
		Type: strType,
		Name: strName,
		Path: Options.Path ?? strName,
		ElementCount: Options.ElementCount ?? 1,
		Flags: unFlags,
		ExternalName: Options.ExternalName ?? "",
		SizeInBytes: Options.SizeInBytes ?? 4,
		OverrideCount: 0,
		Tolerance: 0,
		Input: (unFlags & g_TypeDescriptionFlags.Input) !== 0x00,
		Output: (unFlags & g_TypeDescriptionFlags.Output) !== 0x00,
		Key: (unFlags & g_TypeDescriptionFlags.Key) !== 0x00,
		Embedded: unTypeID === g_FieldType.Embedded,
		SaveRestoreAddress: 0n,
		OverrideFieldAddress: 0n,
		InputFunctionAddress: Options.InputFunctionAddress ?? 0n,
		EmbeddedDatamapAddress: Options.EmbeddedDatamapAddress ?? 0n,
	};

	g_unNextFieldAddress += g_unFieldAddressStride;

	return Field;
}

const g_vecBaseFields = [
	MakeField("CBaseEntity", 0, "m_iName", 0x00, g_FieldType.String, "string", { ExternalName: "targetname", Flags: g_TypeDescriptionFlags.Key | g_TypeDescriptionFlags.Save }),
	MakeField("CBaseEntity", 1, "m_hOwnerEntity", 0x08, g_FieldType.EntityHandle, "entityhandle", { SizeInBytes: 4 }),
	MakeField("CBaseEntity", 2, "m_szLabel", 0x10, g_FieldType.Character, "char", { ElementCount: 32, SizeInBytes: 32 }),
	MakeField("CBaseEntity", 3, "m_flInterval", 0x30, g_FieldType.Interval, "interval", { SizeInBytes: 8 }),
];

// Synthetic layout: four-byte long slots and eight-byte address slots, not an SDK/host ABI model.
const g_vecPlayerFields = [
	MakeField("CBasePlayer", 0, "m_iHealth", 0x40, g_FieldType.Integer, "int", { Flags: g_TypeDescriptionFlags.Save }),
	MakeField("CBasePlayer", 1, "m_vecAbsVelocity", 0x44, g_FieldType.Vector, "vector", { SizeInBytes: 12 }),
	MakeField("CBasePlayer", 2, "m_clrRender", 0x50, g_FieldType.Color32, "color32", { SizeInBytes: 4 }),
	MakeField("CBasePlayer", 3, "m_bEnabled", 0x54, g_FieldType.Boolean, "bool", { SizeInBytes: 1 }),
	MakeField("CBasePlayer", 4, "m_cLetter", 0x55, g_FieldType.Character, "char", { SizeInBytes: 1 }),
	MakeField("CBasePlayer", 5, "m_u8", 0x56, g_FieldType.Character, "char", { SizeInBytes: 1 }),
	MakeField("CBasePlayer", 6, "m_i16", 0x58, g_FieldType.Short, "short", { SizeInBytes: 2 }),
	MakeField("CBasePlayer", 7, "m_u16", 0x5A, g_FieldType.Short, "short", { SizeInBytes: 2 }),
	MakeField("CBasePlayer", 8, "m_u32", 0x5C, g_FieldType.Integer, "int", { SizeInBytes: 4 }),
	MakeField("CBasePlayer", 9, "m_long", 0x60, g_FieldType.Integer, "int", { SizeInBytes: 4 }),
	MakeField("CBasePlayer", 10, "m_ulong", 0x64, g_FieldType.Integer, "int", { SizeInBytes: 4 }),
	MakeField("CBasePlayer", 11, "m_i64", 0x68, g_FieldType.Integer, "int", { SizeInBytes: 8 }),
	MakeField("CBasePlayer", 12, "m_u64", 0x70, g_FieldType.Integer, "int", { SizeInBytes: 8 }),
	MakeField("CBasePlayer", 13, "m_float", 0x78, g_FieldType.Float, "float", { SizeInBytes: 4 }),
	MakeField("CBasePlayer", 14, "m_double", 0x7C, g_FieldType.Float, "float", { SizeInBytes: 8 }),
	MakeField("CBasePlayer", 15, "m_address", 0x84, g_FieldType.ClassAddress, "classaddress", { SizeInBytes: 8 }),
];

const g_vecTargetFields = [
	MakeField("CBaseEntity", 0, "Kill", 0x00, g_FieldType.Void, "void", { ExternalName: "Kill", Flags: g_TypeDescriptionFlags.Input, InputFunctionAddress: 0xA410n, SizeInBytes: 0 }),
];

const g_mapDataMapDefinitions = new Map([
	[g_unBaseDataMapAddress, {
		Record: {
			Address: g_unBaseDataMapAddress,
			ClassName: "CBaseEntity",
			FieldCount: g_vecBaseFields.length,
			PackedSize: 56,
			ChainsValidated: true,
			PackedOffsetsComputed: true,
			BaseAddress: 0n,
		},
		Fields: g_vecBaseFields,
	}],
	[g_unPlayerDataMapAddress, {
		Record: {
			Address: g_unPlayerDataMapAddress,
			ClassName: "CBasePlayer",
			FieldCount: g_vecPlayerFields.length,
			PackedSize: 140,
			ChainsValidated: true,
			PackedOffsetsComputed: true,
			BaseAddress: g_unBaseDataMapAddress,
		},
		Fields: g_vecPlayerFields,
	}],
	[g_unTargetDataMapAddress, {
		Record: {
			Address: g_unTargetDataMapAddress,
			ClassName: "CBaseEntity",
			FieldCount: g_vecTargetFields.length,
			PackedSize: 56,
			ChainsValidated: true,
			PackedOffsetsComputed: true,
			BaseAddress: g_unBaseDataMapAddress,
		},
		Fields: g_vecTargetFields,
	}],
]);

function MakeEntity(nEntityIndex, unDataMapAddress) {
	const unAddress = g_unNextEntityAddress;
	g_unNextEntityAddress += g_unEntityAddressStride;

	return {
		Index: nEntityIndex,
		Address: unAddress,
		DataMapAddress: unDataMapAddress,
		Removed: false,
		Values: new Map([
			["m_iName", "sourcejs_target"],
			["m_hOwnerEntity", null],
			["m_szLabel", "sourcejs"],
			["m_flInterval", { Start: 2.5, Range: 7.5 }],
			["m_iHealth", 80],
			["m_vecAbsVelocity", { X: 1, Y: 2, Z: 3 }],
			["m_clrRender", { Red: 255, Green: 255, Blue: 255, Alpha: 255 }],
			["m_bEnabled", true],
			["m_cLetter", "A"],
			["m_u8", 200],
			["m_i16", -1_200],
			["m_u16", 50_000],
			["m_u32", 3_000_000_000],
			["m_long", -4_000],
			["m_ulong", 4_000_000_000],
			["m_i64", -9_007_199_254_740_993n],
			["m_u64", 18_014_398_509_481_986n],
			["m_float", 1.25],
			["m_double", 2.5],
			["m_address", 0xFA00n],
		]),
	};
}

const g_Player = MakeEntity(1, g_unPlayerDataMapAddress);

function RequireEntity(Value) {
	if (Value === g_Player) {
		return Value;
	}

	if (Value && (typeof Value === "object") && (Value.Values instanceof Map)) {
		return Value;
	}

	throw new TypeError("Expected a live Entity object.");
}

function ResolveDataMapDefinition(Value) {
	if (typeof Value === "bigint") {
		return g_mapDataMapDefinitions.get(Value) ?? null;
	}

	if (typeof Value === "string") {
		for (const Definition of g_mapDataMapDefinitions.values()) {
			if ((Definition.Record.ClassName === Value) && (Definition.Record.Address !== g_unTargetDataMapAddress)) {
				return Definition;
			}
		}

		return null;
	}

	if (Value && (typeof Value === "object")) {
		if (typeof Value.DataMapAddress === "bigint") {
			return g_mapDataMapDefinitions.get(Value.DataMapAddress) ?? null;
		}

		if ((typeof Value.Address === "bigint") && (typeof Value.ClassName === "string")) {
			return g_mapDataMapDefinitions.get(Value.Address) ?? null;
		}
	}

	return null;
}

function GetDataMap(Value) {
	const Definition = ResolveDataMapDefinition(Value);

	return Definition ? { ...Definition.Record } : null;
}

function GetField(DataMapSelector, unIndex) {
	const Definition = ResolveDataMapDefinition(DataMapSelector);
	if (!Definition || !Number.isSafeInteger(unIndex) || (unIndex < 0)) {
		return null;
	}

	return Definition.Fields[unIndex] ?? null;
}

function FindField(DataMapSelector, strName) {
	const Definition = ResolveDataMapDefinition(DataMapSelector);
	if (!Definition || (typeof strName !== "string")) {
		return null;
	}

	const DirectField = Definition.Fields.find((Field) => (Field.Name === strName) || (Field.Path === strName) || (Field.ExternalName === strName));
	if (DirectField) {
		return DirectField;
	}

	if (Definition.Record.BaseAddress !== 0n) {
		return FindField(Definition.Record.BaseAddress, strName);
	}

	return null;
}

function FindOffset(DataMapSelector, strName) {
	const Field = FindField(DataMapSelector, strName);

	return Field ? Field.Offset : -1;
}

function ListFields(DataMapSelector, bRecursive = true) {
	const Definition = ResolveDataMapDefinition(DataMapSelector);
	if (!Definition) {
		throw new TypeError("Expected a datamap selector.");
	}

	const vecFields = Definition.Fields.slice();
	if (bRecursive && (Definition.Record.BaseAddress !== 0n)) {
		vecFields.push(...ListFields(Definition.Record.BaseAddress, true));
	}

	return vecFields;
}

function NormalizeVariantType(Type) {
	if (typeof Type === "number") {
		const mapTypeNames = new Map([
			[g_FieldType.Void, "void"],
			[g_FieldType.Quaternion, "quaternion"],
			[g_FieldType.Boolean, "bool"],
			[g_FieldType.Color32, "color32"],
			[g_FieldType.Float, "float"],
			[g_FieldType.Integer, "int"],
			[g_FieldType.String, "string"],
			[g_FieldType.Vector, "vector"],
			[g_FieldType.PositionVector, "positionvector"],
			[g_FieldType.ClassAddress, "classaddress"],
			[g_FieldType.Short, "short"],
			[g_FieldType.Character, "char"],
			[g_FieldType.Embedded, "embedded"],
			[g_FieldType.Custom, "custom"],
			[g_FieldType.EntityHandle, "entityhandle"],
			[g_FieldType.Edict, "edict"],
			[g_FieldType.Time, "time"],
			[g_FieldType.Tick, "tick"],
			[g_FieldType.ModelName, "modelname"],
			[g_FieldType.SoundName, "soundname"],
			[g_FieldType.Input, "input"],
			[g_FieldType.Function, "function"],
			[g_FieldType.VMatrix, "vmatrix"],
			[g_FieldType.VMatrixWorldSpace, "vmatrixworldspace"],
			[g_FieldType.Matrix3x4WorldSpace, "matrix3x4worldspace"],
			[g_FieldType.Interval, "interval"],
			[g_FieldType.ModelIndex, "modelindex"],
			[g_FieldType.MaterialIndex, "materialindex"],
			[g_FieldType.Vector2D, "vector2d"],
		]);
		const strTypeName = mapTypeNames.get(Type);
		if (!strTypeName) {
			throw new TypeError("Unsupported variant type.");
		}

		return { TypeID: (Type === 0) ? 0 : Type, Type: strTypeName };
	}

	if (typeof Type !== "string") {
		throw new TypeError("Unsupported variant type.");
	}

	const TypeIDs = {
		void: g_FieldType.Void,
		bool: g_FieldType.Boolean,
		color32: g_FieldType.Color32,
		float: g_FieldType.Float,
		int: g_FieldType.Integer,
		string: g_FieldType.String,
		vector: g_FieldType.Vector,
		positionvector: g_FieldType.PositionVector,
		classaddress: g_FieldType.ClassAddress,
	};
	if (!Object.hasOwn(TypeIDs, Type)) {
		throw new TypeError("Unsupported variant type.");
	}

	return { TypeID: TypeIDs[Type], Type };
}

function CreateVariant(Type, Value) {
	const NormalizedType = NormalizeVariantType((arguments.length === 0) ? g_FieldType.Void : Type);

	return { TypeID: NormalizedType.TypeID, Type: NormalizedType.Type, Value: (arguments.length >= 2) ? Value : null };
}

function CreateVariantFromAddress(unAddress) {
	if (unAddress !== g_unVariantAddress) {
		throw new RangeError("Unknown variant address.");
	}

	return { Address: unAddress, TypeID: g_FieldType.Integer, Type: "int", Value: 42 };
}

function CreateInterval(StartValue, RangeValue) {
	const flMaximumNativeFloat = 3.4028234663852886e38;

	if (arguments.length === 0) {
		return { Start: 0, Range: 0 };
	}

	const RequireComponent = function RequireComponent(Value, bRequired) {
		if (bRequired && ((Value === null) || (Value === undefined))) {
			throw new TypeError("An interval component is required.");
		}

		const dblValue = +Value;
		if (!Number.isFinite(dblValue) || (dblValue < -flMaximumNativeFloat) || (dblValue > flMaximumNativeFloat)) {
			throw new RangeError("A finite native float interval component is required.");
		}

		return Math.fround(dblValue);
	};

	const bArray = Array.isArray(StartValue);
	if ((StartValue !== null) && ((typeof StartValue === "object") || (typeof StartValue === "function"))) {
		const flStart = RequireComponent(bArray ? StartValue[0] : StartValue.Start, true);
		const flRange = RequireComponent(bArray ? StartValue[1] : StartValue.Range, true);
		return { Start: flStart, Range: flRange };
	}

	const flStart = RequireComponent(StartValue, false);
	const flRange = (arguments.length >= 2) ? RequireComponent(RangeValue, false) : 0;

	return { Start: flStart, Range: flRange };
}

function GetInputFunction(Entity, FieldSelector) {
	const LiveEntity = RequireEntity(Entity);
	const DataMap = GetDataMap(LiveEntity);
	const Description = (typeof FieldSelector === "object") ? FieldSelector : FindField(DataMap, FieldSelector);
	if (!Description || !Description.Input) {
		throw new Error("Input function was not found.");
	}

	return { Address: Description.Address, Entity: LiveEntity.Address, Description };
}

function CallInputFunction(Entity, FieldSelector, Value = null, Activator = Entity, Caller = Entity) {
	const Input = GetInputFunction(Entity, FieldSelector);

	Entity.LastInput = { Name: Input.Description.ExternalName, Value, Activator, Caller };
	Entity.Removed = Input.Description.ExternalName === "Kill";

	return true;
}

function ResolvePropertyField(Entity, Property) {
	const LiveEntity = RequireEntity(Entity);
	const Definition = ResolveDataMapDefinition(LiveEntity);

	if (Property && (typeof Property === "object") && (typeof Property.Name === "string")) {
		return Property;
	}

	if (typeof Property === "string") {
		return FindField(Definition.Record.Address, Property);
	}

	if (Number.isSafeInteger(Property)) {
		return ListFields(Definition.Record.Address, true).find((Field) => Field.Offset === Property) ?? null;
	}

	return null;
}

function RequirePropertyField(Entity, Property) {
	const Field = ResolvePropertyField(Entity, Property);
	if (!Field) {
		throw new Error("Datamap property was not found.");
	}

	return Field;
}

function ReadStoredProperty(Entity, Property) {
	const LiveEntity = RequireEntity(Entity);
	const Field = RequirePropertyField(LiveEntity, Property);

	return LiveEntity.Values.get(Field.Name);
}

function WriteStoredProperty(Entity, Property, Value) {
	const LiveEntity = RequireEntity(Entity);
	const Field = RequirePropertyField(LiveEntity, Property);
	LiveEntity.Values.set(Field.Name, Value);

	return true;
}

function RequireBoolean(bValue) {
	if (typeof bValue !== "boolean") {
		throw new TypeError("Expected a boolean.");
	}

	return bValue;
}

function RequireFiniteNumber(dblValue) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
		throw new TypeError("Expected a finite number.");
	}

	return dblValue;
}

const g_nInt8Minimum = -128;
const g_nInt8Maximum = 127;
const g_nInt16Minimum = -32_768;
const g_nInt16Maximum = 32_767;
const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;
const g_unUInt8Maximum = 0xFF;
const g_unUInt16Maximum = 0xFFFF;

function RequireNativeInteger(nValue, nMinimum, nMaximum) {
	const nNormalizedValue = (typeof nValue === "bigint") ? Number(nValue) : nValue;
	if (!Number.isInteger(nNormalizedValue) || (nNormalizedValue < nMinimum) || (nNormalizedValue > nMaximum)) {
		throw new TypeError("Expected an integer in the native field storage range.");
	}

	return (nNormalizedValue === 0) ? 0 : nNormalizedValue;
}

function RequireInteger(nValue) {
	if (!Number.isSafeInteger(nValue)) {
		throw new TypeError("Expected a safe integer.");
	}

	return nValue;
}

function RequireBigInt(nValue) {
	if (typeof nValue !== "bigint") {
		throw new TypeError("Expected a bigint.");
	}

	return nValue;
}

function RequireString(strValue) {
	if (typeof strValue !== "string") {
		throw new TypeError("Expected a string.");
	}

	return strValue;
}

function GetPropertyBoolean(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyBoolean(Entity, Property, bValue) {
	return WriteStoredProperty(Entity, Property, RequireBoolean(bValue));
}

function GetPropertyCharacter(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyCharacter(Entity, Property, Value) {
	// Model signed eight-bit char here; these are decoded reads, not native byte storage.
	let unCharacterByte = 0;
	if (typeof Value === "number") {
		if (!Number.isInteger(Value) || (Value < g_nInt8Minimum) || (Value > g_nInt8Maximum)) {
			throw new Error("Expected a signed eight-bit character integer or string.");
		}

		unCharacterByte = Value & g_unUInt8Maximum;
	} else if (typeof Value === "string") {
		const vecEncodedBytes = Buffer.from(Value, "utf8");
		unCharacterByte = vecEncodedBytes[0] ?? 0;
	} else {
		throw new Error("Expected a signed eight-bit character integer or string.");
	}

	const strDecodedCharacter = (unCharacterByte === 0) ? "" : Buffer.from([unCharacterByte]).toString("utf8");

	return WriteStoredProperty(Entity, Property, strDecodedCharacter);
}

function GetPropertyUnsignedCharacter(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyUnsignedCharacter(Entity, Property, unValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(unValue, 0, g_unUInt8Maximum));
}

function GetPropertyShort(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyShort(Entity, Property, nValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(nValue, g_nInt16Minimum, g_nInt16Maximum));
}

function GetPropertyUnsignedShort(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyUnsignedShort(Entity, Property, unValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(unValue, 0, g_unUInt16Maximum));
}

function GetPropertyInteger(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyInteger(Entity, Property, nValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(nValue, g_nInt32Minimum, g_nInt32Maximum));
}

function VerifyCurrentDataMapFixtures() {
	const mapOriginalValues = new Map();
	try {
		for (const Scenario of [
			{ Name: "m_u8", Set: SetPropertyUnsignedCharacter, Get: GetPropertyUnsignedCharacter, Minimum: 0, Maximum: 255 },
			{ Name: "m_i16", Set: SetPropertyShort, Get: GetPropertyShort, Minimum: -32_768, Maximum: 32_767 },
			{ Name: "m_u16", Set: SetPropertyUnsignedShort, Get: GetPropertyUnsignedShort, Minimum: 0, Maximum: 0xFFFF },
			{ Name: "m_iHealth", Set: SetPropertyInteger, Get: GetPropertyInteger, Minimum: -2_147_483_648, Maximum: 2_147_483_647 },
		]) {
			mapOriginalValues.set(Scenario.Name, ReadStoredProperty(g_Player, Scenario.Name));

			for (const Value of [Scenario.Minimum, Scenario.Maximum, -0, BigInt(Scenario.Minimum), BigInt(Scenario.Maximum)]) {
				g_Assert.equal(Scenario.Set(g_Player, Scenario.Name, Value), true);
				const nExpected = Number(Value);
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), (nExpected === 0) ? 0 : nExpected, "datamap scalar fixture must preserve native-width integer writes");
			}

			for (const InvalidValue of [Scenario.Minimum - 1, Scenario.Maximum + 1, BigInt(Scenario.Minimum) - 1n, BigInt(Scenario.Maximum) + 1n, 0.5, Number.NaN, Infinity, -Infinity, true, null, undefined, "1", {}, []]) {
				const nBefore = Scenario.Get(g_Player, Scenario.Name);
				g_Assert.throws(() => Scenario.Set(g_Player, Scenario.Name, InvalidValue), TypeError, "datamap scalar fixture must reject invalid and out-of-range writes");
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), nBefore, "rejected datamap scalar writes must preserve fixture state");
			}
		}

		mapOriginalValues.set("m_cLetter", ReadStoredProperty(g_Player, "m_cLetter"));
		for (const [Value, strExpected] of [
			["", ""],
			["\u0000rest", ""],
			["AB", "A"],
			["\u007F", "\u007F"],
			["\u00E9", "\uFFFD"],
			["\uD83D\uDE00", "\uFFFD"],
			["\uD800", "\uFFFD"],
			[0, ""],
			[-0, ""],
			[65, "A"],
			[127, "\u007F"],
			[-1, "\uFFFD"],
			[-128, "\uFFFD"],
		]) {
			g_Assert.equal(SetPropertyCharacter(g_Player, "m_cLetter", Value), true);
			g_Assert.equal(GetPropertyCharacter(g_Player, "m_cLetter"), strExpected, "character fixture must decode only the first encoded byte, including NUL");
		}

		for (const InvalidValue of [-129, 128, 255, 0.5, Number.NaN, Infinity, -Infinity, 65n, true, null, undefined, {}, []]) {
			const strBefore = GetPropertyCharacter(g_Player, "m_cLetter");
			g_Assert.throws(() => SetPropertyCharacter(g_Player, "m_cLetter", InvalidValue), { name: "Error" });
			g_Assert.equal(GetPropertyCharacter(g_Player, "m_cLetter"), strBefore, "invalid character writes must preserve fixture state");
		}
	} finally {
		for (const [strName, Value] of mapOriginalValues) {
			WriteStoredProperty(g_Player, strName, Value);
		}
	}

	const Target = { Index: 3, Address: 0xD00Dn, DataMapAddress: g_unTargetDataMapAddress, Values: new Map(), Removed: false };
	const Input = GetInputFunction(Target, g_vecTargetFields[0]);
	g_Assert.equal(Input.Entity, 0xD00Dn, "datamap input function Entity must be a BigInt address");
	g_Assert.equal(Input.Address, 0x77B0n, "datamap input function Address must be the description address");
	g_Assert.equal(Input.Description.Name, "Kill");
	g_Assert.equal(CallInputFunction(Target, g_vecTargetFields[0], "fixture"), true);
	g_Assert.equal(Target.LastInput.Name, "Kill");
	g_Assert.equal(Target.Removed, true);
}

VerifyCurrentDataMapFixtures();

const g_unUInt32Maximum = 0xFFFFFFFF;
const g_nInt64Minimum = -(1n << 63n);
const g_nInt64Maximum = (1n << 63n) - 1n;
const g_unUInt64Maximum = (1n << 64n) - 1n;
const g_flMaximumFloat = 3.4028234663852886e38;

function RequireNativeBigInt(nValue, nMinimum, nMaximum) {
	const nCheckedValue = RequireBigInt(nValue);
	if ((nCheckedValue < nMinimum) || (nCheckedValue > nMaximum)) {
		throw new TypeError("Expected a BigInt in the native field storage range.");
	}

	return nCheckedValue;
}

// Floating and color inputs remain Number-only in this fixture; native V8 conversion is not modeled.
function RequireNativeFloat(flValue) {
	const flCheckedValue = RequireFiniteNumber(flValue);
	if (Math.abs(flCheckedValue) > g_flMaximumFloat) {
		throw new TypeError("Expected a finite float32 value.");
	}

	return Math.fround(flCheckedValue);
}

function RequireColorByte(unValue) {
	const unCheckedValue = RequireInteger(unValue);
	if ((unCheckedValue < 0) || (unCheckedValue > g_unUInt8Maximum)) {
		throw new TypeError("Expected an unsigned color byte.");
	}

	return (unCheckedValue === 0) ? 0 : unCheckedValue;
}

function GetPropertyUnsignedInteger(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyUnsignedInteger(Entity, Property, unValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(unValue, 0, g_unUInt32Maximum));
}

function GetPropertyLong(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyLong(Entity, Property, nValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(nValue, g_nInt32Minimum, g_nInt32Maximum));
}

function GetPropertyUnsignedLong(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyUnsignedLong(Entity, Property, unValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeInteger(unValue, 0, g_unUInt32Maximum));
}

function GetPropertyLongLong(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyLongLong(Entity, Property, nValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeBigInt(nValue, g_nInt64Minimum, g_nInt64Maximum));
}

function GetPropertyUnsignedLongLong(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyUnsignedLongLong(Entity, Property, unValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeBigInt(unValue, 0n, g_unUInt64Maximum));
}

function GetPropertyFloat(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyFloat(Entity, Property, flValue) {
	return WriteStoredProperty(Entity, Property, RequireNativeFloat(flValue));
}

function GetPropertyDouble(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyDouble(Entity, Property, dblValue) {
	return WriteStoredProperty(Entity, Property, RequireFiniteNumber(dblValue));
}

function GetPropertyString(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyString(Entity, Property, strValue) {
	return WriteStoredProperty(Entity, Property, RequireString(strValue));
}

function GetPropertyStringArray(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyStringArray(Entity, Property, strValue) {
	return WriteStoredProperty(Entity, Property, RequireString(strValue));
}

function GetPropertyAddress(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyAddress(Entity, Property, unAddress) {
	// The fixture stores classaddress in eight bytes; native validation uses the target width.
	if ((typeof unAddress !== "bigint") || (unAddress < 0n) || (unAddress > g_unUInt64Maximum)) {
		throw new TypeError("Expected a nonnegative 64-bit BigInt address.");
	}

	return WriteStoredProperty(Entity, Property, unAddress);
}

function MakeVectorView(Entity, Field) {
	const LiveEntity = RequireEntity(Entity);
	const StoredValue = ReadStoredProperty(LiveEntity, Field);
	const View = {};
	Object.defineProperties(View, {
		Address: { enumerable: true, value: LiveEntity.Address + BigInt(Field.Offset) },
		X: {
			enumerable: true,
			get: () => StoredValue.X,
			set: (flValue) => {
				StoredValue.X = RequireNativeFloat(flValue);
			},
		},
		Y: {
			enumerable: true,
			get: () => StoredValue.Y,
			set: (flValue) => {
				StoredValue.Y = RequireNativeFloat(flValue);
			},
		},
		Z: {
			enumerable: true,
			get: () => StoredValue.Z,
			set: (flValue) => {
				StoredValue.Z = RequireNativeFloat(flValue);
			},
		},
	});

	return View;
}

function GetPropertyVector(Entity, Property) {
	return MakeVectorView(Entity, RequirePropertyField(Entity, Property));
}

function SetPropertyVector(Entity, Property, Value) {
	const Field = RequirePropertyField(Entity, Property);
	const StoredValue = ReadStoredProperty(Entity, Field);
	const vecComponents = Array.isArray(Value) ? Value : [Value.X, Value.Y, Value.Z];
	const flX = RequireNativeFloat(vecComponents[0]);
	const flY = RequireNativeFloat(vecComponents[1]);
	const flZ = RequireNativeFloat(vecComponents[2]);

	StoredValue.X = flX;
	StoredValue.Y = flY;
	StoredValue.Z = flZ;

	return true;
}

function MakeColorView(Entity, Field) {
	const LiveEntity = RequireEntity(Entity);
	const StoredValue = ReadStoredProperty(LiveEntity, Field);
	const View = {};
	Object.defineProperties(View, {
		Address: { enumerable: true, value: LiveEntity.Address + BigInt(Field.Offset) },
		Red: {
			enumerable: true,
			get: () => StoredValue.Red,
			set: (unValue) => {
				StoredValue.Red = RequireColorByte(unValue);
			},
		},
		Green: {
			enumerable: true,
			get: () => StoredValue.Green,
			set: (unValue) => {
				StoredValue.Green = RequireColorByte(unValue);
			},
		},
		Blue: {
			enumerable: true,
			get: () => StoredValue.Blue,
			set: (unValue) => {
				StoredValue.Blue = RequireColorByte(unValue);
			},
		},
		Alpha: {
			enumerable: true,
			get: () => StoredValue.Alpha,
			set: (unValue) => {
				StoredValue.Alpha = RequireColorByte(unValue);
			},
		},
	});

	return View;
}

function GetPropertyColor(Entity, Property) {
	return MakeColorView(Entity, RequirePropertyField(Entity, Property));
}

function SetPropertyColor(Entity, Property, Value) {
	const Field = RequirePropertyField(Entity, Property);
	const StoredValue = ReadStoredProperty(Entity, Field);
	const vecComponents = Array.isArray(Value) ? Value : [Value.Red, Value.Green, Value.Blue, Value.Alpha];
	const unRed = RequireColorByte(vecComponents[0]);
	const unGreen = RequireColorByte(vecComponents[1]);
	const unBlue = RequireColorByte(vecComponents[2]);
	const unAlpha = RequireColorByte(vecComponents[3]);

	StoredValue.Red = unRed;
	StoredValue.Green = unGreen;
	StoredValue.Blue = unBlue;
	StoredValue.Alpha = unAlpha;

	return true;
}

function MakeIntervalView(Entity, Field) {
	const LiveEntity = RequireEntity(Entity);
	const StoredValue = ReadStoredProperty(LiveEntity, Field);
	const View = {};
	Object.defineProperties(View, {
		Address: { enumerable: true, value: LiveEntity.Address + BigInt(Field.Offset) },
		Start: {
			enumerable: true,
			get: () => StoredValue.Start,
			set: (flValue) => {
				StoredValue.Start = RequireNativeFloat(flValue);
			},
		},
		Range: {
			enumerable: true,
			get: () => StoredValue.Range,
			set: (flValue) => {
				StoredValue.Range = RequireNativeFloat(flValue);
			},
		},
	});

	return View;
}

function GetPropertyInterval(Entity, Property) {
	return MakeIntervalView(Entity, RequirePropertyField(Entity, Property));
}

function SetPropertyInterval(Entity, Property, Value) {
	const Field = RequirePropertyField(Entity, Property);
	const StoredValue = ReadStoredProperty(Entity, Field);
	const vecComponents = Array.isArray(Value) ? Value : [Value.Start, Value.Range];
	const flStart = RequireNativeFloat(vecComponents[0]);
	const flRange = RequireNativeFloat(vecComponents[1]);

	StoredValue.Start = flStart;
	StoredValue.Range = flRange;

	return true;
}

function GetPropertyEntity(Entity, Property) {
	return ReadStoredProperty(Entity, Property);
}

function SetPropertyEntity(Entity, Property, Value) {
	// This fixture models entityhandle values, not nullable edict/classaddress storage.
	RequireEntity(Value);

	return WriteStoredProperty(Entity, Property, Value);
}

function GetPropertyType(Field, strExplicitType) {
	if (strExplicitType !== undefined) {
		return strExplicitType;
	}

	const InferredTypes = {
		bool: "bool",
		char: (Field.SizeInBytes > 1) ? "stringarray" : "char",
		short: "short",
		int: "int",
		float: "float",
		string: "string",
		classaddress: "address",
		vector: "vector",
		color32: "color",
		interval: "interval",
		entityhandle: "entity",
	};

	return InferredTypes[Field.Type];
}

const g_PropertyGetters = {
	bool: GetPropertyBoolean,
	char: GetPropertyCharacter,
	uchar: GetPropertyUnsignedCharacter,
	short: GetPropertyShort,
	ushort: GetPropertyUnsignedShort,
	int: GetPropertyInteger,
	uint: GetPropertyUnsignedInteger,
	long: GetPropertyLong,
	ulong: GetPropertyUnsignedLong,
	longlong: GetPropertyLongLong,
	ulonglong: GetPropertyUnsignedLongLong,
	float: GetPropertyFloat,
	double: GetPropertyDouble,
	string: GetPropertyString,
	stringarray: GetPropertyStringArray,
	address: GetPropertyAddress,
	vector: GetPropertyVector,
	color: GetPropertyColor,
	interval: GetPropertyInterval,
	entity: GetPropertyEntity,
};

const g_PropertySetters = {
	bool: SetPropertyBoolean,
	char: SetPropertyCharacter,
	uchar: SetPropertyUnsignedCharacter,
	short: SetPropertyShort,
	ushort: SetPropertyUnsignedShort,
	int: SetPropertyInteger,
	uint: SetPropertyUnsignedInteger,
	long: SetPropertyLong,
	ulong: SetPropertyUnsignedLong,
	longlong: SetPropertyLongLong,
	ulonglong: SetPropertyUnsignedLongLong,
	float: SetPropertyFloat,
	double: SetPropertyDouble,
	string: SetPropertyString,
	stringarray: SetPropertyStringArray,
	address: SetPropertyAddress,
	vector: SetPropertyVector,
	color: SetPropertyColor,
	interval: SetPropertyInterval,
	entity: SetPropertyEntity,
};

function GetProperty(Entity, Property, strExplicitType) {
	const Field = RequirePropertyField(Entity, Property);
	const strType = GetPropertyType(Field, strExplicitType);
	const Getter = g_PropertyGetters[strType];
	if (!Getter) {
		throw new TypeError(`Unknown datamap property type: ${strType}`);
	}

	return Getter(Entity, Field);
}

function SetProperty(Entity, Property, Value, strExplicitType) {
	const Field = RequirePropertyField(Entity, Property);
	const strType = GetPropertyType(Field, strExplicitType);
	const Setter = g_PropertySetters[strType];
	if (!Setter) {
		throw new TypeError(`Unknown datamap property type: ${strType}`);
	}

	return Setter(Entity, Field, Value);
}

function VerifyRemainingDataMapFixtures() {
	const vecOriginalValues = [...g_Player.Values].map(([strName, Value]) => ({ Name: strName, Value, Snapshot: structuredClone(Value) }));
	try {
		for (const Scenario of [
			{ Name: "m_u32", Set: SetPropertyUnsignedInteger, Get: GetPropertyUnsignedInteger, Minimum: 0, Maximum: 0xFFFFFFFF },
			{ Name: "m_long", Set: SetPropertyLong, Get: GetPropertyLong, Minimum: -2_147_483_648, Maximum: 2_147_483_647 },
			{ Name: "m_ulong", Set: SetPropertyUnsignedLong, Get: GetPropertyUnsignedLong, Minimum: 0, Maximum: 0xFFFFFFFF },
		]) {
			for (const Value of [Scenario.Minimum, Scenario.Maximum, -0, BigInt(Scenario.Minimum), BigInt(Scenario.Maximum)]) {
				g_Assert.equal(Scenario.Set(g_Player, Scenario.Name, Value), true);
				const nExpected = Number(Value);
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), (nExpected === 0) ? 0 : nExpected, "datamap remaining integer fixture must preserve native-width writes");
			}

			for (const InvalidValue of [Scenario.Minimum - 1, Scenario.Maximum + 1, BigInt(Scenario.Minimum) - 1n, BigInt(Scenario.Maximum) + 1n, 0.5, Number.NaN, Infinity, -Infinity, true, null, undefined, "1", {}, []]) {
				const nBefore = Scenario.Get(g_Player, Scenario.Name);
				g_Assert.throws(() => Scenario.Set(g_Player, Scenario.Name, InvalidValue), TypeError, "datamap remaining integer fixture must reject invalid writes");
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), nBefore);
			}
		}

		for (const Scenario of [
			{ Name: "m_i64", Set: SetPropertyLongLong, Get: GetPropertyLongLong, Minimum: -(1n << 63n), Maximum: (1n << 63n) - 1n },
			{ Name: "m_u64", Set: SetPropertyUnsignedLongLong, Get: GetPropertyUnsignedLongLong, Minimum: 0n, Maximum: (1n << 64n) - 1n },
		]) {
			for (const nValue of [Scenario.Minimum, 0n, Scenario.Maximum]) {
				g_Assert.equal(Scenario.Set(g_Player, Scenario.Name, nValue), true);
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), nValue);
			}

			for (const InvalidValue of [Scenario.Minimum - 1n, Scenario.Maximum + 1n, 0, 1.5, "1", null, undefined]) {
				const nBefore = Scenario.Get(g_Player, Scenario.Name);
				g_Assert.throws(() => Scenario.Set(g_Player, Scenario.Name, InvalidValue), TypeError, "datamap 64-bit fixture must reject non-BigInt and overflowing writes");
				g_Assert.equal(Scenario.Get(g_Player, Scenario.Name), nBefore);
			}
		}

		SetPropertyFloat(g_Player, "m_float", 1.1);
		g_Assert.equal(GetPropertyFloat(g_Player, "m_float"), Math.fround(1.1), "datamap float fixture must round to float32");
		g_Assert.throws(() => SetPropertyFloat(g_Player, "m_float", Number.MAX_VALUE), TypeError);
		g_Assert.equal(GetPropertyFloat(g_Player, "m_float"), Math.fround(1.1));
		SetPropertyDouble(g_Player, "m_double", 1.1);
		g_Assert.equal(GetPropertyDouble(g_Player, "m_double"), 1.1);

		SetPropertyVector(g_Player, "m_vecAbsVelocity", [1.1, 2.2, 3.3]);
		const VectorSnapshot = { ...ReadStoredProperty(g_Player, "m_vecAbsVelocity") };
		g_Assert.deepEqual(Object.values(VectorSnapshot), [1.1, 2.2, 3.3].map(Math.fround));
		g_Assert.throws(() => SetPropertyVector(g_Player, "m_vecAbsVelocity", [9, Number.NaN, 12]), TypeError);
		g_Assert.deepEqual(ReadStoredProperty(g_Player, "m_vecAbsVelocity"), VectorSnapshot, "invalid vector writes must not partially commit");
		g_Assert.equal(GetPropertyVector(g_Player, "m_vecAbsVelocity").Address, 0xC394n);

		SetPropertyColor(g_Player, "m_clrRender", [1, 2, 3, 4]);
		const ColorSnapshot = { ...ReadStoredProperty(g_Player, "m_clrRender") };
		const Color = GetPropertyColor(g_Player, "m_clrRender");
		g_Assert.equal(Color.Address, 0xC3A0n);

		for (const InvalidValue of [-1, 256, 0.5, Number.NaN, 0n, "1"]) {
			g_Assert.throws(() => {
				Color.Red = InvalidValue;
			}, TypeError, "datamap color components must be bytes");
			g_Assert.deepEqual(ReadStoredProperty(g_Player, "m_clrRender"), ColorSnapshot);
		}

		g_Assert.throws(() => SetPropertyColor(g_Player, "m_clrRender", [5, 256, 7, 8]), TypeError);
		g_Assert.deepEqual(ReadStoredProperty(g_Player, "m_clrRender"), ColorSnapshot, "invalid color writes must not partially commit");
		SetPropertyInterval(g_Player, "m_flInterval", [1.1, 2.2]);
		const IntervalSnapshot = { ...ReadStoredProperty(g_Player, "m_flInterval") };
		g_Assert.deepEqual(IntervalSnapshot, { Start: Math.fround(1.1), Range: Math.fround(2.2) });
		g_Assert.throws(() => SetPropertyInterval(g_Player, "m_flInterval", [8, Number.NaN]), TypeError);
		g_Assert.deepEqual(ReadStoredProperty(g_Player, "m_flInterval"), IntervalSnapshot, "invalid interval writes must not partially commit");
		g_Assert.equal(GetPropertyInterval(g_Player, "m_flInterval").Address, 0xC380n);
	} finally {
		for (const Record of vecOriginalValues) {
			if ((Record.Value !== null) && (typeof Record.Value === "object")) {
				Object.assign(Record.Value, Record.Snapshot);

			} else {
				WriteStoredProperty(g_Player, Record.Name, Record.Value);
			}
		}
	}
}

VerifyRemainingDataMapFixtures();

const g_NativeDataMaps = {
	FieldType: g_FieldType,
	TypeDescriptionFlags: g_TypeDescriptionFlags,
	GetEntityDataMap: GetDataMap,
	GetEntityDataMapField: GetField,
	FindEntityDataMapField: FindField,
	FindEntityDataMapFieldOffset: FindOffset,
	GetEntityDataMapFields: ListFields,
	CreateEntityDataMapVariant: CreateVariant,
	CreateEntityDataMapVariantFromAddress: CreateVariantFromAddress,
	CreateEntityDataMapInterval: CreateInterval,
	GetEntityInputFunction: GetInputFunction,
	CallEntityInputFunction: CallInputFunction,
	GetEntityDataMapProperty: GetProperty,
	SetEntityDataMapProperty: SetProperty,
	GetEntityDataMapPropertyBoolean: GetPropertyBoolean,
	SetEntityDataMapPropertyBoolean: SetPropertyBoolean,
	GetEntityDataMapPropertyCharacter: GetPropertyCharacter,
	SetEntityDataMapPropertyCharacter: SetPropertyCharacter,
	GetEntityDataMapPropertyUnsignedCharacter: GetPropertyUnsignedCharacter,
	SetEntityDataMapPropertyUnsignedCharacter: SetPropertyUnsignedCharacter,
	GetEntityDataMapPropertyShort: GetPropertyShort,
	SetEntityDataMapPropertyShort: SetPropertyShort,
	GetEntityDataMapPropertyUnsignedShort: GetPropertyUnsignedShort,
	SetEntityDataMapPropertyUnsignedShort: SetPropertyUnsignedShort,
	GetEntityDataMapPropertyInteger: GetPropertyInteger,
	SetEntityDataMapPropertyInteger: SetPropertyInteger,
	GetEntityDataMapPropertyUnsignedInteger: GetPropertyUnsignedInteger,
	SetEntityDataMapPropertyUnsignedInteger: SetPropertyUnsignedInteger,
	GetEntityDataMapPropertyLong: GetPropertyLong,
	SetEntityDataMapPropertyLong: SetPropertyLong,
	GetEntityDataMapPropertyUnsignedLong: GetPropertyUnsignedLong,
	SetEntityDataMapPropertyUnsignedLong: SetPropertyUnsignedLong,
	GetEntityDataMapPropertyLongLong: GetPropertyLongLong,
	SetEntityDataMapPropertyLongLong: SetPropertyLongLong,
	GetEntityDataMapPropertyUnsignedLongLong: GetPropertyUnsignedLongLong,
	SetEntityDataMapPropertyUnsignedLongLong: SetPropertyUnsignedLongLong,
	GetEntityDataMapPropertyFloat: GetPropertyFloat,
	SetEntityDataMapPropertyFloat: SetPropertyFloat,
	GetEntityDataMapPropertyDouble: GetPropertyDouble,
	SetEntityDataMapPropertyDouble: SetPropertyDouble,
	GetEntityDataMapPropertyString: GetPropertyString,
	SetEntityDataMapPropertyString: SetPropertyString,
	GetEntityDataMapPropertyStringArray: GetPropertyStringArray,
	SetEntityDataMapPropertyStringArray: SetPropertyStringArray,
	GetEntityDataMapPropertyAddress: GetPropertyAddress,
	SetEntityDataMapPropertyAddress: SetPropertyAddress,
	GetEntityDataMapPropertyVector: GetPropertyVector,
	SetEntityDataMapPropertyVector: SetPropertyVector,
	GetEntityDataMapPropertyColor: GetPropertyColor,
	SetEntityDataMapPropertyColor: SetPropertyColor,
	GetEntityDataMapPropertyInterval: GetPropertyInterval,
	SetEntityDataMapPropertyInterval: SetPropertyInterval,
	GetEntityDataMapPropertyEntity: GetPropertyEntity,
	SetEntityDataMapPropertyEntity: SetPropertyEntity,
};

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function CreateDocumentationSnapshotFixture(strSource, bTyped) {
	// Isolate helper control flow from native storage/ABI; missing results and errors are deliberate.
	const PlayerValue = { Index: 1, Address: 0x1000n };
	const DataMap = { ClassName: "CBasePlayer" };
	const Field = { Path: "m_iHealth", Type: "int", ElementCount: 1, SizeInBytes: 4, Offset: 4 };
	const State = { Value: 83, Reads: 0, Writes: 0, Callbacks: 0, ThrowRead: false, ReadError: undefined, RawByte: 0x80 };
	const Read = function Read(EntityValue, Property) {
		g_Assert.equal(EntityValue, PlayerValue);
		g_Assert.ok((Property === Field.Path) || (Property === Field.Offset));
		State.Reads++;

		if (State.ThrowRead) {
			throw State.ReadError;
		}

		return State.Value;
	};
	const Write = function Write(strCodecName, EntityValue, Property, Value) {
		g_Assert.equal(EntityValue, PlayerValue);
		g_Assert.ok((Property === Field.Path) || (Property === Field.Offset));
		State.Writes++;

		if ((Value === undefined) || (Value === null)) {
			throw new Error("The controlled setter cannot restore a missing snapshot.");
		}

		if ((typeof Value === "number") && !Number.isFinite(Value)) {
			throw new Error("The controlled setter requires a finite value.");
		}

		if (strCodecName === "vector") {
			g_Assert.ok(Number.isFinite(Value.X) && Number.isFinite(Value.Y) && (!Object.hasOwn(Value, "Z") || Number.isFinite(Value.Z)));
		}

		if (strCodecName === "color") {
			g_Assert.ok([Value.Red, Value.Green, Value.Blue, Value.Alpha].every((unComponent) => Number.isInteger(unComponent) && (unComponent >= 0) && (unComponent <= g_unUInt8Maximum)));
		}

		if (strCodecName === "interval") {
			g_Assert.ok(Number.isFinite(Value.Start) && Number.isFinite(Value.Range));
		}

		if (strCodecName === "char") {
			State.RawByte = Buffer.from(Value, "utf8")[0] ?? 0;
		}

		State.Value = Value;

		return true;
	};
	const Native = {
		GetEntityDataMap(EntityValue) {
			g_Assert.equal(EntityValue, PlayerValue);

			return DataMap;
		},
		FindEntityDataMapField(DataMapValue, strName) {
			g_Assert.equal(DataMapValue, DataMap);
			g_Assert.equal(strName, Field.Path);

			return Field;
		},
		GetEntityDataMapProperty: Read,
		SetEntityDataMapProperty(EntityValue, Property, Value) {
			return Write("int", EntityValue, Property, Value);
		},
	};
	const vecCodecs = [
		["bool", "Boolean"],
		["char", "Character"],
		["uchar", "UnsignedCharacter"],
		["short", "Short"],
		["ushort", "UnsignedShort"],
		["int", "Integer"],
		["uint", "UnsignedInteger"],
		["long", "Long"],
		["ulong", "UnsignedLong"],
		["longlong", "LongLong"],
		["ulonglong", "UnsignedLongLong"],
		["float", "Float"],
		["double", "Double"],
		["string", "String"],
		["stringarray", "StringArray"],
		["address", "Address"],
		["vector", "Vector"],
		["color", "Color"],
		["interval", "Interval"],
		["entity", "Entity"],
	];
	for (const [strCodecName, strSuffix] of vecCodecs) {
		Native["GetEntityDataMapProperty" + strSuffix] = Read;
		Native["SetEntityDataMapProperty" + strSuffix] = (EntityValue, Property, Value) => Write(strCodecName, EntityValue, Property, Value);
	}

	const Run = function Run(strFixtureSource, bExposeHelpers) {
		const RequireFixture = function RequireFixture(strName) {
			if (strName === "entities/datamaps") {
				return Native;
			}

			if (strName === "players/entity") {
				return {
					Player(nIndex) {
						g_Assert.equal(nIndex, 1);

						return PlayerValue;
					},
				};
			}

			g_Assert.equal(strName, "loggers");

			return {
				LogInfo(strFormat, Record) {
					g_Assert.equal(strFormat, "%j");
					g_Assert.equal(Object.keys(Record)[0], "Operation");
				},
			};
		};
		const strExports = bExposeHelpers ? "return { TemporarilySet: g_TemporarilySetEntityDataMapProperty };" : "return {};";
		const Script = new g_VM.Script(`(function (require) {\n${strFixtureSource}\n${strExports}\n})`, { filename: "entities-datamaps.md:snapshot-fixture" });

		return Script.runInNewContext({})(RequireFixture);
	};
	const API = Run(strSource, bTyped);
	g_Assert.equal(State.Value, 83, "The healthy documentation example must restore the fixture.");

	State.Reads = 0;
	State.Writes = 0;

	const Callback = function Callback(Value) {
		State.Callbacks++;

		return Value;
	};

	return { State, API, Field, PlayerValue, Callback, Run };
}

function VerifyDocumentationSnapshotGuards(strSource) {
	const VerifyInvalidSnapshot = function VerifyInvalidSnapshot(strFixtureSource, vecCase) {
		const Fixture = CreateDocumentationSnapshotFixture(strFixtureSource, true);
		Fixture.State.Value = vecCase[1];
		let bThrew = false;
		try {
			Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, vecCase[0], vecCase[2], Fixture.Callback);
		} catch {
			bThrew = true;
		}

		g_Assert.equal(Fixture.State.Writes, 0, "Snapshot must be rejected before a native write.");
		g_Assert.equal(bThrew, true, "Invalid snapshots must fail, not silently skip the write.");
		g_Assert.equal(Fixture.State.Callbacks, 0);
		g_Assert.equal(Fixture.State.RawByte, 0x80);
	};
	const strCaptureDeclaration = "const g_CaptureEntityDataMapPropertyValue = function CaptureEntityDataMapPropertyValue(strCodecName, ValueEntityDataMapProperty) {";
	g_Assert.equal(strSource.split(strCaptureDeclaration).length, 2, "The current documentation capture helper must be present exactly once.");
	// Negative control: bypass only the capture guards in memory, never rewrite documentation.
	const strUnguardedSource = strSource.replace(strCaptureDeclaration, strCaptureDeclaration + "\nreturn ValueEntityDataMapProperty;");
	for (const vecCase of [
		["int", undefined, 100],
		["entity", null, { Index: 2 }],
		["float", Number.NaN, 1],
		["double", Infinity, 1],
		["vector", { X: Number.NaN, Y: 2, Z: 3 }, { X: 4, Y: 5, Z: 6 }],
		["vector", { X: 1, Y: 2, Z: Infinity }, { X: 4, Y: 5, Z: 6 }],
		["vector", { X: 1 }, { X: 4, Y: 5 }],
		["color", { Red: -1, Green: 2, Blue: 3, Alpha: 255 }, { Red: 4, Green: 5, Blue: 6, Alpha: 255 }],
		["color", { Red: 1, Green: 2, Blue: 3 }, { Red: 4, Green: 5, Blue: 6, Alpha: 255 }],
		["interval", { Start: Number.NaN, Range: 2 }, { Start: 3, Range: 4 }],
		["interval", { Start: 1, Range: undefined }, { Start: 3, Range: 4 }],
		["char", "\uFFFD", "A"],
	]) {
		VerifyInvalidSnapshot(strSource, vecCase);
		g_Assert.throws(() => VerifyInvalidSnapshot(strUnguardedSource, vecCase), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Snapshot must be rejected before a native write."), "The capture-guard negative control must fail on mutation, not unrelated setup.");
	}

	const VerifyInvalidCallback = function VerifyInvalidCallback(strFixtureSource) {
		const Fixture = CreateDocumentationSnapshotFixture(strFixtureSource, true);
		g_Assert.throws(() => Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, "int", 100, null), (Failure) => Failure.name === "TypeError");
		g_Assert.equal(Fixture.State.Reads, 0, "Invalid callback must be rejected before reads.");
		g_Assert.equal(Fixture.State.Writes, 0);
	};
	VerifyInvalidCallback(strSource);
	const strCallbackGuard = 'if (typeof Callback !== "function") {';
	g_Assert.equal(strSource.split(strCallbackGuard).length, 2);
	g_Assert.throws(() => VerifyInvalidCallback(strSource.replace(strCallbackGuard, "if (false) {")), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Invalid callback must be rejected before reads."));

	for (const [strCodecName, Value, TemporaryValue] of [
		["int", 0, 100],
		["bool", false, true],
		["string", "", "temporary"],
		["address", 0n, 0x1234n],
		["double", -0, 0.5],
		["longlong", g_nInt64Minimum, 1n],
		["ulonglong", g_unUInt64Maximum, 1n],
		["vector", { X: 1, Y: 2 }, { X: 3, Y: 4 }],
		["vector", { X: 1, Y: 2, Z: 3 }, { X: 4, Y: 5, Z: 6 }],
		["color", { Red: 1, Green: 2, Blue: 3, Alpha: 255 }, { Red: 4, Green: 5, Blue: 6, Alpha: 255 }],
		["interval", { Start: 1, Range: 2 }, { Start: 3, Range: 4 }],
		["char", "", "A"],
		["char", "A", "B"],
		["entity", { Index: 3 }, { Index: 2 }],
	]) {
		const Fixture = CreateDocumentationSnapshotFixture(strSource, true);
		Fixture.State.Value = Value;
		g_Assert.strictEqual(Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, strCodecName, TemporaryValue, Fixture.Callback), TemporaryValue);
		if ((Value !== null) && (typeof Value === "object") && (strCodecName !== "entity")) {
			g_Assert.deepEqual({ ...Fixture.State.Value }, Value);
			g_Assert.notStrictEqual(Fixture.State.Value, Value, "Structured snapshots must not alias the live view.");
		} else {
			g_Assert.ok(Object.is(Fixture.State.Value, Value), "Scalar snapshots, including signed zero and BigInt, must remain exact.");
		}

		g_Assert.equal(Fixture.State.Writes, 2);
		g_Assert.equal(Fixture.State.Callbacks, 1);
	}

	for (const ErrorValue of [undefined, null, 0, "Original", new Error("Original read failure")]) {
		const Fixture = CreateDocumentationSnapshotFixture(strSource, true);
		Fixture.State.ThrowRead = true;
		Fixture.State.ReadError = ErrorValue;
		g_Assert.throws(() => Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, "int", 100, Fixture.Callback), (Failure) => Failure === ErrorValue);
		g_Assert.equal(Fixture.State.Writes, 0);
		g_Assert.equal(Fixture.State.Callbacks, 0);
	}

	const Fixture = CreateDocumentationSnapshotFixture(strSource, true);
	let unLaterComponentReads = 0;
	const ComponentError = new Error("Original component failure");
	Fixture.State.Value = {
		get X() {
			throw ComponentError;
		},
		get Y() {
			unLaterComponentReads++;

			return 2;
		},
	};
	g_Assert.throws(() => Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, "vector", { X: 3, Y: 4 }, Fixture.Callback), (Failure) => Failure === ComponentError);
	g_Assert.equal(Fixture.State.Writes, 0);
	g_Assert.equal(unLaterComponentReads, 0);
	Fixture.State.Value = 37;
	const CallbackError = new Error("Original callback failure");
	g_Assert.throws(() => Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, "int", 100, () => {
		throw CallbackError;
	}), (Failure) => Failure === CallbackError);
	g_Assert.equal(Fixture.State.Value, 37);
	g_Assert.equal(Fixture.State.Writes, 2);

	const CallbackPromise = Promise.resolve("Not awaited");
	g_Assert.strictEqual(Fixture.API.TemporarilySet(Fixture.PlayerValue, Fixture.Field, "int", 100, () => CallbackPromise), CallbackPromise);
	g_Assert.equal(Fixture.State.Value, 37, "A Promise result must not postpone synchronous restoration.");
}

function VerifyGenericDocumentationSnapshotGuards(strSource) {
	const Verify = function Verify(strFixtureSource, Value) {
		const Fixture = CreateDocumentationSnapshotFixture(strFixtureSource, false);
		Fixture.State.Value = Value;
		let bThrew = false;
		try {
			Fixture.Run(strFixtureSource, false);
		} catch {
			bThrew = true;
		}

		g_Assert.equal(Fixture.State.Writes, 0, "Generic snapshot must be validated before a native write.");
		g_Assert.equal(bThrew, true);
	};
	const strGuard = "if (!Number.isInteger(g_nPreviousHealth)) {";
	g_Assert.equal(strSource.split(strGuard).length, 2);
	for (const Value of [undefined, null, Number.NaN, Infinity, 0.5, "83"]) {
		Verify(strSource, Value);
		g_Assert.throws(() => Verify(strSource.replace(strGuard, "if (false) {"), Value), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Generic snapshot must be validated before a native write."));
	}
}

function TrackModule(ModuleExports, setExercisedExports) {
	const TrackedExports = {};
	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setExercisedExports.add(strName);

				return Value;
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const unGenericSnapshotDocumentationBlockIndex = 9;
	const unTypedSnapshotDocumentationBlockIndex = 10;
	const unVariantDocumentationBlockIndex = 5;
	const unOutputVariantDocumentationBlockIndex = 6;
	const unVectorDocumentationBlockIndex = 11;
	const unInputOrKeyDocumentationBlockIndex = 13;
	const unIntervalDocumentationBlockIndex = 16;

	g_Assert.doesNotMatch(strSource, /\bconsole\./, "Documentation must use the typed logger.");

	if (unBlockIndex === unGenericSnapshotDocumentationBlockIndex) {
		VerifyGenericDocumentationSnapshotGuards(strSource);
	}

	if (unBlockIndex === unTypedSnapshotDocumentationBlockIndex) {
		VerifyDocumentationSnapshotGuards(strSource);
	}

	const Script = new g_VM.Script(`(function (require, module) {\n${strSource}\n})`, { filename: `entities-datamaps.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const PluginModule = { exports: {} };
	const vecLogRecords = [];
	const DocumentationLoggers = {
		LogInfo(strFormat, Record) {
			g_Assert.equal(strFormat, "%j");
			g_Assert.equal(Object.keys(Record)[0], "Operation");
			vecLogRecords.push(JSON.parse(JSON.stringify(Record)));
		},
	};
	const RequireDocumentation = (strModuleName) => {
		if (strModuleName === "loggers") {
			return DocumentationLoggers;
		}

		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};

	if (unBlockIndex === unVectorDocumentationBlockIndex) {
		for (const [strComponentName, flInvalidComponent] of [["X", NaN], ["Y", Infinity], ["Z", -Infinity]]) {
			const vecWrites = [];
			const GuardView = new Proxy({ Address: 0xFEDCBA9876543210n, X: 1, Y: 2, Z: 3, [strComponentName]: flInvalidComponent }, {
				set(Target, Property, Value, Receiver) {
					vecWrites.push(String(Property));

					return Reflect.set(Target, Property, Value, Receiver);
				},
			});
			const GuardDataMaps = new Proxy(Modules["entities/datamaps"], {
				get(Target, Property, Receiver) {
					if (Property === "GetEntityDataMapPropertyVector") {
						return function GetGuardVector() {
							return GuardView;
						};
					}

					return Reflect.get(Target, Property, Receiver);
				},
			});
			const RequireGuardDependency = function RequireGuardDependency(strModuleName) {
				return (strModuleName === "entities/datamaps") ? GuardDataMaps : RequireDocumentation(strModuleName);
			};
			g_Assert.throws(() => Callback(RequireGuardDependency, { exports: {} }), /not finite and cannot be restored safely/);
			g_Assert.deepEqual(vecWrites, [], `Non-finite ${strComponentName} must be rejected before any native-view write.`);
		}
	}

	Callback(RequireDocumentation, PluginModule);

	const vecExpectedOperations = [
		[],
		["InspectDataMapCapabilities"],
		["InspectDataMapInheritance"],
		["InspectDataMapFieldFlags"],
		["InspectDataMapFields"],
		["CreateDataMapVariants"],
		["InspectOutputVariant"],
		["CreateDataMapIntervals"],
		["InspectEntityInput"],
		["InspectTemporaryDataMapHealth"],
		["InspectTypedDataMapHealth"],
		["InspectLiveDataMapVelocity"],
		["InspectLiveDataMapColor"],
		["InspectDataMapInputOrKey"],
		["InspectDataMapExternalName"],
		["InspectDataMapOwnerEntity"],
		["InspectCharacterArrayMetadata", "InspectLiveDataMapInterval"],
	];
	g_Assert.ok(unBlockIndex < vecExpectedOperations.length);
	if (unBlockIndex === unInputOrKeyDocumentationBlockIndex) {
		g_Assert.ok(vecLogRecords.length > 0, "The fixture must exercise the input/key enumeration branch.");
		g_Assert.ok(vecLogRecords.every((Record) => Record.Operation === "InspectDataMapInputOrKey"));
	} else {
		g_Assert.deepEqual(vecLogRecords.map((Record) => Record.Operation), vecExpectedOperations[unBlockIndex]);
	}

	if (unBlockIndex === unVariantDocumentationBlockIndex) {
		g_Assert.deepEqual(vecLogRecords[0].IntegerVariant, { TypeID: g_FieldType.Integer, Type: "int", Value: 25 });
		g_Assert.equal(vecLogRecords[0].VectorZ, 32);
		g_Assert.equal(vecLogRecords[0].EmptyType, "void");
	}

	if (unBlockIndex === unOutputVariantDocumentationBlockIndex) {
		g_Assert.equal(typeof vecLogRecords[0].ValueText, "string");
	}

	if (unBlockIndex === unVectorDocumentationBlockIndex) {
		g_Assert.match(vecLogRecords[0].Address, /^0x[0-9A-F]+$/);
		g_Assert.equal(vecLogRecords[0].Z, 28);
	}

	if (unBlockIndex === unIntervalDocumentationBlockIndex) {
		g_Assert.match(vecLogRecords[1].Address, /^0x[0-9A-F]+$/);
		g_Assert.equal(typeof vecLogRecords[1].StartText, "string");
		g_Assert.equal(typeof vecLogRecords[1].RangeText, "string");
	}

	if (unBlockIndex === unOutputVariantDocumentationBlockIndex) {
		g_Assert.equal(typeof PluginModule.exports.Unload, "function", "The FireOutput example must export its canonical cleanup.");
	}

	g_Assert.equal(Object.hasOwn(PluginModule.exports, "unload"), false, "Documentation must not export the obsolete lowercase lifecycle.");

	if (typeof PluginModule.exports.Unload === "function") {
		PluginModule.exports.Unload();
	}
}

function CreateTargetEntity(strClassName) {
	g_Assert.equal(strClassName, "info_target");

	return MakeEntity(2, g_unTargetDataMapAddress);
}

let g_FireOutputCallback = null;
let g_bFireOutputHookRemoved = false;

const g_Outputs = {
	CreateEntityFireOutputHook(Callback) {
		g_FireOutputCallback = Callback;
		Callback({ ValueAddress: g_unVariantAddress, OutputName: "OnUser1" });

		return { Address: g_unFireOutputHookAddress };
	},

	GetEntityFireOutputContext(Payload) {
		return Payload;
	},

	RemoveEntityFireOutputHook() {
		g_bFireOutputHookRemoved = true;
		g_FireOutputCallback = null;

		return true;
	},
};

globalThis.sourcejs = { "entities/datamaps": g_NativeDataMaps };

delete require.cache[g_strDataMapsPath];

const g_DataMaps = require(g_strDataMapsPath);
g_Assert.strictEqual(g_DataMaps, g_NativeDataMaps);
g_Assert.equal(g_vecExpectedExports.length, 54);
g_Assert.deepEqual(Object.keys(g_DataMaps).sort(), g_vecExpectedExports.slice().sort());
g_Assert.equal(Object.isFrozen(g_DataMaps.FieldType), true);
g_Assert.equal(Object.isFrozen(g_DataMaps.TypeDescriptionFlags), true);

const g_PlayerDataMap = g_DataMaps.GetEntityDataMap(g_Player);
const g_BaseDataMap = g_DataMaps.GetEntityDataMap(g_PlayerDataMap.BaseAddress);
const g_HealthField = g_DataMaps.FindEntityDataMapField(g_PlayerDataMap, "m_iHealth");

g_Assert.equal(g_PlayerDataMap.ClassName, "CBasePlayer");
g_Assert.equal(g_BaseDataMap.ClassName, "CBaseEntity");
g_Assert.equal(g_DataMaps.GetEntityDataMapField(g_PlayerDataMap, 0), g_HealthField);
g_Assert.equal(g_DataMaps.FindEntityDataMapFieldOffset(g_PlayerDataMap, "m_iHealth"), g_HealthField.Offset);
g_Assert.equal(g_DataMaps.FindEntityDataMapField(g_PlayerDataMap, "targetname").Name, "m_iName");
g_Assert.equal(Object.hasOwn(g_HealthField, "Address"), true);
g_Assert.equal(Object.hasOwn(g_HealthField, "Name"), true);
g_Assert.equal(typeof g_PlayerDataMap.Address, "bigint");
g_Assert.equal(typeof g_BaseDataMap.Address, "bigint");
g_Assert.equal(g_BaseDataMap.BaseAddress, 0n);
g_Assert.equal(g_DataMaps.GetEntityDataMap(Number(g_unPlayerDataMapAddress)), null);
g_Assert.equal(g_DataMaps.GetEntityDataMap({ DataMapAddress: Number(g_unPlayerDataMapAddress) }), null);
g_Assert.equal(g_DataMaps.GetEntityDataMap({ Address: Number(g_unPlayerDataMapAddress), ClassName: "CBasePlayer" }), null);
g_Assert.equal(g_DataMaps.GetEntityDataMapFields(g_PlayerDataMap, false).length, g_vecPlayerFields.length);
g_Assert.equal(g_DataMaps.GetEntityDataMapFields(g_PlayerDataMap, true).length, g_vecPlayerFields.length + g_vecBaseFields.length);

for (const Field of g_DataMaps.GetEntityDataMapFields(g_PlayerDataMap, true)) {
	g_Assert.deepEqual(Object.keys(Field), g_vecFieldRecordKeys);

	for (const strAddressKey of ["Address", "SaveRestoreAddress", "OverrideFieldAddress", "InputFunctionAddress", "EmbeddedDatamapAddress"]) {
		g_Assert.equal(typeof Field[strAddressKey], "bigint");
	}
}

const g_vecTypedCases = [
	["GetEntityDataMapPropertyBoolean", "SetEntityDataMapPropertyBoolean", "m_bEnabled", false],
	["GetEntityDataMapPropertyCharacter", "SetEntityDataMapPropertyCharacter", "m_cLetter", "Z"],
	["GetEntityDataMapPropertyUnsignedCharacter", "SetEntityDataMapPropertyUnsignedCharacter", "m_u8", 201],
	["GetEntityDataMapPropertyShort", "SetEntityDataMapPropertyShort", "m_i16", -1_100],
	["GetEntityDataMapPropertyUnsignedShort", "SetEntityDataMapPropertyUnsignedShort", "m_u16", 50_001],
	["GetEntityDataMapPropertyInteger", "SetEntityDataMapPropertyInteger", "m_iHealth", 81],
	["GetEntityDataMapPropertyUnsignedInteger", "SetEntityDataMapPropertyUnsignedInteger", "m_u32", 3_000_000_001],
	["GetEntityDataMapPropertyLong", "SetEntityDataMapPropertyLong", "m_long", -3_999],
	["GetEntityDataMapPropertyUnsignedLong", "SetEntityDataMapPropertyUnsignedLong", "m_ulong", 4_000_000_001],
	["GetEntityDataMapPropertyLongLong", "SetEntityDataMapPropertyLongLong", "m_i64", -9_007_199_254_740_994n],
	["GetEntityDataMapPropertyUnsignedLongLong", "SetEntityDataMapPropertyUnsignedLongLong", "m_u64", 18_014_398_509_481_987n],
	["GetEntityDataMapPropertyFloat", "SetEntityDataMapPropertyFloat", "m_float", 3.25],
	["GetEntityDataMapPropertyDouble", "SetEntityDataMapPropertyDouble", "m_double", 4.5],
	["GetEntityDataMapPropertyString", "SetEntityDataMapPropertyString", "m_iName", "renamed_target"],
	["GetEntityDataMapPropertyStringArray", "SetEntityDataMapPropertyStringArray", "m_szLabel", "updated"],
	["GetEntityDataMapPropertyAddress", "SetEntityDataMapPropertyAddress", "m_address", 0xFDE8n],
];

for (const [strGetterName, strSetterName, strFieldName, Value] of g_vecTypedCases) {
	const PreviousValue = g_DataMaps[strGetterName](g_Player, strFieldName);
	g_Assert.equal(g_DataMaps[strSetterName](g_Player, strFieldName, Value), true);
	g_Assert.equal(g_DataMaps[strGetterName](g_Player, strFieldName), Value);
	g_DataMaps[strSetterName](g_Player, strFieldName, PreviousValue);
}

const g_Velocity = g_DataMaps.GetEntityDataMapPropertyVector(g_Player, "m_vecAbsVelocity");
const g_PreviousVelocity = { X: g_Velocity.X, Y: g_Velocity.Y, Z: g_Velocity.Z };

g_Assert.equal(typeof g_Velocity.Address, "bigint");
g_Assert.equal(g_Velocity.Address, g_Player.Address + 0x44n);
g_DataMaps.SetEntityDataMapPropertyVector(g_Player, "m_vecAbsVelocity", { X: 10, Y: 20, Z: 30 });
g_Assert.deepEqual({ X: g_Velocity.X, Y: g_Velocity.Y, Z: g_Velocity.Z }, { X: 10, Y: 20, Z: 30 });
g_DataMaps.SetEntityDataMapPropertyVector(g_Player, "m_vecAbsVelocity", g_PreviousVelocity);

const g_Color = g_DataMaps.GetEntityDataMapPropertyColor(g_Player, "m_clrRender");
const g_PreviousColor = { Red: g_Color.Red, Green: g_Color.Green, Blue: g_Color.Blue, Alpha: g_Color.Alpha };

g_Assert.equal(typeof g_Color.Address, "bigint");
g_Assert.equal(g_Color.Address, g_Player.Address + 0x50n);
g_DataMaps.SetEntityDataMapPropertyColor(g_Player, "m_clrRender", { Red: 10, Green: 20, Blue: 30, Alpha: 40 });
g_Assert.deepEqual({ Red: g_Color.Red, Green: g_Color.Green, Blue: g_Color.Blue, Alpha: g_Color.Alpha }, { Red: 10, Green: 20, Blue: 30, Alpha: 40 });
g_DataMaps.SetEntityDataMapPropertyColor(g_Player, "m_clrRender", g_PreviousColor);

const g_IntervalView = g_DataMaps.GetEntityDataMapPropertyInterval(g_Player, "m_flInterval");
const g_PreviousInterval = { Start: g_IntervalView.Start, Range: g_IntervalView.Range };

g_Assert.equal(typeof g_IntervalView.Address, "bigint");
g_Assert.equal(g_IntervalView.Address, g_Player.Address + 0x30n);
g_DataMaps.SetEntityDataMapPropertyInterval(g_Player, "m_flInterval", { Start: 3, Range: 6 });
g_Assert.deepEqual({ Start: g_IntervalView.Start, Range: g_IntervalView.Range }, { Start: 3, Range: 6 });
g_DataMaps.SetEntityDataMapPropertyInterval(g_Player, "m_flInterval", g_PreviousInterval);

const g_PreviousOwner = g_DataMaps.GetEntityDataMapPropertyEntity(g_Player, "m_hOwnerEntity");
try {
	g_Assert.equal(g_DataMaps.SetEntityDataMapPropertyEntity(g_Player, "m_hOwnerEntity", g_Player), true);
	g_Assert.strictEqual(g_DataMaps.GetEntityDataMapPropertyEntity(g_Player, "m_hOwnerEntity"), g_Player);
	g_Assert.throws(() => g_DataMaps.SetEntityDataMapPropertyEntity(g_Player, "m_hOwnerEntity", null), TypeError);
	g_Assert.strictEqual(g_DataMaps.GetEntityDataMapPropertyEntity(g_Player, "m_hOwnerEntity"), g_Player);
} finally {
	// Null handles cannot be written by this API; reset only the controlled fixture storage.
	WriteStoredProperty(g_Player, "m_hOwnerEntity", g_PreviousOwner);
}

const g_nPreviousHealth = g_DataMaps.GetEntityDataMapProperty(g_Player, g_HealthField);

g_DataMaps.SetEntityDataMapProperty(g_Player, g_HealthField.Offset, 90, "int");
g_Assert.equal(g_DataMaps.GetEntityDataMapProperty(g_Player, g_HealthField, "int"), 90);
g_DataMaps.SetEntityDataMapProperty(g_Player, g_HealthField, g_nPreviousHealth);
g_Assert.throws(() => g_DataMaps.GetEntityDataMapProperty(g_Player, g_HealthField, "unknown"), /Unknown datamap property type/);

g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapVariant(g_FieldType.Integer, 25), { TypeID: g_FieldType.Integer, Type: "int", Value: 25 });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapVariant(), { TypeID: g_FieldType.Void, Type: "void", Value: null });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapVariantFromAddress(g_unVariantAddress), { Address: g_unVariantAddress, TypeID: g_FieldType.Integer, Type: "int", Value: 42 });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval([2, 5]), { Start: 2, Range: 5 });

g_Assert.equal(g_DataMaps.CreateEntityDataMapVariant(-0).TypeID, 0);

g_Assert.throws(() => g_DataMaps.GetEntityInputFunction(g_Player, "MissingInput"), /Input function was not found/);
g_Assert.throws(() => g_DataMaps.GetEntityInputFunction(g_Player, "m_iHealth"), /Input function was not found/);

const g_SharedVariantValue = { Payload: true };
g_Assert.strictEqual(g_DataMaps.CreateEntityDataMapVariant(g_FieldType.Vector, g_SharedVariantValue).Value, g_SharedVariantValue);
g_Assert.equal(Object.hasOwn(g_DataMaps.CreateEntityDataMapVariant(g_FieldType.Integer, undefined), "Value"), true);
g_Assert.equal(g_DataMaps.CreateEntityDataMapVariant(g_FieldType.Integer, undefined).Value, undefined);

for (const Type of [undefined, null, true, 1n, -1, 1.5, NaN, Infinity, g_FieldType.TypeCount, ["int"], {}]) {
	g_Assert.throws(() => g_DataMaps.CreateEntityDataMapVariant(Type), /Unsupported variant type/);
}

const g_VariantTypeNameExceptions = { Boolean: "bool", Integer: "int", Character: "char" };
for (const [strMemberName, unFieldTypeID] of Object.entries(g_FieldType)) {
	if (strMemberName === "TypeCount") {
		continue;
	}

	const strTypeName = g_VariantTypeNameExceptions[strMemberName] || strMemberName.toLowerCase();
	g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapVariant(unFieldTypeID), { TypeID: unFieldTypeID, Type: strTypeName, Value: null });
}

g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval(), { Start: 0, Range: 0 });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval(1.1, 2.2), { Start: Math.fround(1.1), Range: Math.fround(2.2) });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval(null, true), { Start: 0, Range: 1 });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval("2.5", "7.5"), { Start: 2.5, Range: 7.5 });
g_Assert.deepEqual(g_DataMaps.CreateEntityDataMapInterval({ Start: 1.1, Range: 2.2 }, "ignored"), { Start: Math.fround(1.1), Range: Math.fround(2.2) });

for (const Value of [undefined, [1], [null, 2], [1, undefined], { Start: 1 }, { Start: NaN, Range: 1 }, Infinity, 1n, 3.5e38]) {
	g_Assert.throws(() => g_DataMaps.CreateEntityDataMapInterval(Value));
}

g_Assert.throws(() => g_DataMaps.CreateEntityDataMapInterval(1, undefined));

const g_vecIntervalComponentReads = [];
g_Assert.throws(() => g_DataMaps.CreateEntityDataMapInterval({
	get Start() {
		g_vecIntervalComponentReads.push("Start");

		return NaN;
	},
	get Range() {
		g_vecIntervalComponentReads.push("Range");

		return 1;
	},
}), /finite native float/);
g_Assert.deepEqual(g_vecIntervalComponentReads, ["Start"]);

const g_IntervalGetterError = new Error("Interval Start getter failed.");
g_Assert.throws(() => g_DataMaps.CreateEntityDataMapInterval({
	get Start() {
		throw g_IntervalGetterError;
	},
	get Range() {
		throw new Error("Range must not be read after Start fails.");
	},
}), (ErrorValue) => ErrorValue === g_IntervalGetterError);

const g_DirectInputTarget = CreateTargetEntity("info_target");
const g_DirectInput = g_DataMaps.GetEntityInputFunction(g_DirectInputTarget, "Kill");

g_Assert.equal(g_DirectInput.Description.ExternalName, "Kill");
g_Assert.equal(g_DirectInput.Entity, 0xC750n, "direct input fixture must expose the BigInt entity address");
g_Assert.equal(g_DataMaps.CallEntityInputFunction(g_DirectInputTarget, g_DirectInput.Description), true);
g_Assert.equal(g_DirectInputTarget.Removed, true);

g_Assert.throws(() => g_DataMaps.SetEntityDataMapPropertyBoolean(g_Player, "m_bEnabled", 1), /Expected a boolean/);

for (const AddressValue of [0xFDE8, "65000", -1n, 0x1_0000_0000_0000_0000n]) {
	g_Assert.throws(() => g_DataMaps.SetEntityDataMapPropertyAddress(g_Player, "m_address", AddressValue), /64-bit BigInt address/);
}

for (const unAddress of [0n, 0xFFFFFFFFFFFFFFFFn]) {
	const unPreviousAddress = g_DataMaps.GetEntityDataMapPropertyAddress(g_Player, "m_address");
	g_Assert.equal(g_DataMaps.SetEntityDataMapPropertyAddress(g_Player, "m_address", unAddress), true);
	g_Assert.equal(g_DataMaps.GetEntityDataMapPropertyAddress(g_Player, "m_address"), unAddress);
	g_DataMaps.SetEntityDataMapPropertyAddress(g_Player, "m_address", unPreviousAddress);
}

g_Assert.throws(() => g_DataMaps.CreateEntityDataMapVariantFromAddress(0n), /Unknown variant address/);
g_Assert.throws(() => g_DataMaps.CreateEntityDataMapVariantFromAddress(Number(g_unVariantAddress)), /Unknown variant address/);
g_Assert.throws(() => g_DataMaps.SetEntityDataMapPropertyLongLong(g_Player, "m_i64", 1), /Expected a bigint/);
g_Assert.throws(() => g_DataMaps.SetEntityDataMapPropertyUnsignedLongLong(g_Player, "m_u64", 1), /Expected a bigint/);

function VerifyLiveStructuredValueDocumentation(strDocumentation) {
	g_Assert.ok(/The specialized getters check address arithmetic and reject null storage\./.test(strDocumentation), "Datamap documentation must state address-arithmetic and null-storage checks.");
	g_Assert.ok(/Live vector and interval creation also checks float-component or `interval_t` alignment\./.test(strDocumentation), "Datamap documentation must state live vector/interval alignment checks.");
	g_Assert.ok(/These checks do not prove the reflected field type, actual field size, entity allocation extent, or storage lifetime\./.test(strDocumentation), "Datamap documentation must preserve live-view type/extent/lifetime limitations.");
	g_Assert.ok(/A numeric property offset or a field record with a valid integer `Offset` is consumed without reflected type metadata; address arithmetic checks do not prove entity-allocation bounds\./.test(strDocumentation), "Datamap documentation must distinguish raw-offset selection from allocation bounds and named metadata.");
	g_Assert.ok(!/The specialized helpers resolve the selected address but do not validate its field type, size, alignment, or extent\./.test(strDocumentation), "Datamap documentation must reject the obsolete no-alignment-check claim.");
}

const g_strDocumentation = g_FileSystem.readFileSync(g_strDataMapsDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_DocumentedDataMaps = TrackModule(g_DataMaps, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 17);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
g_Assert.doesNotMatch(g_strDocumentation, /parseWeaponINI\("Welcome to the SourceJS server!"\)/);
g_Assert.doesNotMatch(g_strDocumentation, /make_object|get_object_pointer|addressString/);

VerifyLiveStructuredValueDocumentation(g_strDocumentation);

for (const strRequiredSentence of [
	"The specialized getters check address arithmetic and reject null storage.",
	"Live vector and interval creation also checks float-component or `interval_t` alignment.",
	"These checks do not prove the reflected field type, actual field size, entity allocation extent, or storage lifetime.",
	"A numeric property offset or a field record with a valid integer `Offset` is consumed without reflected type metadata; address arithmetic checks do not prove entity-allocation bounds.",
]) {
	g_Assert.throws(() => VerifyLiveStructuredValueDocumentation(g_strDocumentation.replace(strRequiredSentence, "Invalid live-view contract.")), g_Assert.AssertionError);
}

g_Assert.throws(() => VerifyLiveStructuredValueDocumentation(g_strDocumentation + "\nThe specialized helpers resolve the selected address but do not validate its field type, size, alignment, or extent."), g_Assert.AssertionError);

for (const strRelatedPath of [
	"entities.md",
	"entities-classes.md",
	"entities-props.md",
	"entities-outputs.md",
	"entities-factories.md",
	"memory.md",
	"memory-hooks.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unBlockIndex, {
		"entities/datamaps": g_DocumentedDataMaps,
		"entities/entity": { Entity: () => g_Player },
		"entities/factories": { CreateAndSpawnEntityByClassName: CreateTargetEntity },
		"entities/outputs": g_Outputs,
		"players/entity": { Player: () => g_Player },
	});
}

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/datamaps.${strExportName}.`);
}

g_Assert.equal(g_bFireOutputHookRemoved, true);
g_Assert.equal(g_FireOutputCallback, null);
g_Assert.equal(g_Player.Values.get("m_iHealth"), 80);
g_Assert.deepEqual(g_Player.Values.get("m_vecAbsVelocity"), { X: 1, Y: 2, Z: 3 });
g_Assert.deepEqual(g_Player.Values.get("m_clrRender"), { Red: 255, Green: 255, Blue: 255, Alpha: 255 });
g_Assert.equal(g_Player.Values.get("m_hOwnerEntity"), null);

const g_DataMapsWithoutDirectInput = { ...g_NativeDataMaps };
delete g_DataMapsWithoutDirectInput.CallEntityInputFunction;
globalThis.sourcejs = { "entities/datamaps": g_DataMapsWithoutDirectInput };
delete require.cache[g_strDataMapsPath];

const g_ReducedDataMaps = require(g_strDataMapsPath);
g_Assert.equal(Object.keys(g_ReducedDataMaps).length, 53);
g_Assert.equal(Object.hasOwn(g_ReducedDataMaps, "CallEntityInputFunction"), false);

delete require.cache[g_strDataMapsPath];
delete require.cache[g_strRuntimePath];
delete globalThis.sourcejs;

g_Assert.throws(() => require(g_strDataMapsPath), /SourceJS native runtime is not installed/);

console.log("[smoke] entities/datamaps doubles and executable documentation passed (native SDK execution not covered)");

g_Module._load = g_OriginalModuleLoad;
