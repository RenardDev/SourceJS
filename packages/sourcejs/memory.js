"use strict";

const { GetRawModule } = require("internal/runtime");
const g_GameData = require("memory/gamedata");
const g_MemoryHooks = require("memory/hooks");
const g_MemoryHelpers = require("memory/helpers");
const {
	Add,
	BaseAddress,
	Compare,
	Copy,
	GetDataTypeSize,
	Move,
	Address: CreateAddress,
	Read,
	ReadAddress,
	SearchBytes,
	SetProtection,
	Subtract,
	Type,
	TYPE_SIZES,
	VirtualFunction,
	Write,
} = g_MemoryHelpers;

const g_DataType = Object.freeze({
	Void: "void",
	Bool: "bool",
	Char: "char",
	UChar: "uchar",
	Short: "short",
	UShort: "ushort",
	Int: "int",
	UInt: "uint",
	Long: "long",
	ULong: "ulong",
	LongLong: "longlong",
	ULongLong: "ulonglong",
	Float: "float",
	Double: "double",
	Address: "address",
	String: "string",
	StringAddress: "stringaddress",
	StringArray: "stringarray",
});

const g_Convention = Object.freeze({
	Cdecl: "cdecl",
	Thiscall: "thiscall",
	Stdcall: "stdcall",
	Fastcall: "fastcall",
});

const g_Protection = Object.freeze({
	None: 0,
	Read: 1,
	ReadWrite: 2,
	Execute: 3,
	ExecuteRead: 4,
	ExecuteReadWrite: 5,
});

const g_Register = Object.freeze({
	AL: "AL",
	CL: "CL",
	DL: "DL",
	BL: "BL",
	AH: "AH",
	CH: "CH",
	DH: "DH",
	BH: "BH",
	AX: "AX",
	CX: "CX",
	DX: "DX",
	BX: "BX",
	SP: "SP",
	BP: "BP",
	SI: "SI",
	DI: "DI",
	EAX: "EAX",
	ECX: "ECX",
	EDX: "EDX",
	EBX: "EBX",
	ESP: "ESP",
	EBP: "EBP",
	ESI: "ESI",
	EDI: "EDI",
	RAX: "RAX",
	RCX: "RCX",
	RDX: "RDX",
	RBX: "RBX",
	RSP: "RSP",
	RBP: "RBP",
	RSI: "RSI",
	RDI: "RDI",
	R8: "R8",
	R9: "R9",
	R10: "R10",
	R11: "R11",
	R12: "R12",
	R13: "R13",
	R14: "R14",
	R15: "R15",
	MM0: "MM0",
	MM1: "MM1",
	MM2: "MM2",
	MM3: "MM3",
	MM4: "MM4",
	MM5: "MM5",
	MM6: "MM6",
	MM7: "MM7",
	XMM0: "XMM0",
	XMM1: "XMM1",
	XMM2: "XMM2",
	XMM3: "XMM3",
	XMM4: "XMM4",
	XMM5: "XMM5",
	XMM6: "XMM6",
	XMM7: "XMM7",
	XMM8: "XMM8",
	XMM9: "XMM9",
	XMM10: "XMM10",
	XMM11: "XMM11",
	XMM12: "XMM12",
	XMM13: "XMM13",
	XMM14: "XMM14",
	XMM15: "XMM15",
	CS: "CS",
	SS: "SS",
	DS: "DS",
	ES: "ES",
	FS: "FS",
	GS: "GS",
	ST0: "ST0",
});

const g_unNullAddress = 0n;

const g_MemoryRuntime = GetRawModule("memory");
// Capture native operations before the public facade replaces these properties.
const {
	Allocate: g_AllocateNative,
	Reallocate: g_ReallocateNative,
	Deallocate: g_DeallocateNative,
} = g_MemoryRuntime;
const g_MemoryManagerRuntime = GetRawModule("memory/manager");
const { GetBinary } = g_MemoryManagerRuntime;
const { HookType } = g_MemoryHooks;
const g_mapMemoryObjectTypes = new Map();

function ResolveObjectTypeSize(unObjectTypeSizeValue) {
	return (Number.isSafeInteger(unObjectTypeSizeValue) && (unObjectTypeSizeValue > 0)) ? unObjectTypeSizeValue : 0;
}

function NormalizeFunctionArguments(vecArgumentTypes) {
	if ((vecArgumentTypes === null) || (vecArgumentTypes === undefined)) {
		return [];
	}

	if (!Array.isArray(vecArgumentTypes)) {
		throw new TypeError("Function ArgumentTypes must be an array.");
	}

	const unArgumentCount = vecArgumentTypes.length;
	const vecNormalizedArgumentTypes = new Array(unArgumentCount);
	for (let unArgumentIndex = 0; unArgumentIndex < unArgumentCount; unArgumentIndex += 1) {
		vecNormalizedArgumentTypes[unArgumentIndex] = Type.NormalizeDataType(vecArgumentTypes[unArgumentIndex]);
	}

	return vecNormalizedArgumentTypes;
}

function NormalizeReturnType(strReturnType) {
	if ((strReturnType === null) || (strReturnType === undefined)) {
		return g_DataType.Void;
	}

	if (Type.IsNativeDataType(strReturnType)) {
		return Type.NormalizeDataType(strReturnType);
	}

	if ((typeof strReturnType !== "string") || (strReturnType.trim().length === 0)) {
		throw new TypeError("Function ReturnType must be a native type or non-empty object type name.");
	}

	return strReturnType;
}

class FunctionInfo {
	constructor(FunctionOptions = {}) {
		if ((FunctionOptions === null) || (typeof FunctionOptions !== "object") || Array.isArray(FunctionOptions)) {
			throw new TypeError("FunctionInfo Options must be an object.");
		}

		const bIsVirtual = Object.hasOwn(FunctionOptions, "IsVirtual") ? FunctionOptions.IsVirtual : false;
		const nThisAddressOffset = Object.hasOwn(FunctionOptions, "ThisAddressOffset") ? FunctionOptions.ThisAddressOffset : 0;
		const nVTableIndex = Object.hasOwn(FunctionOptions, "VTableIndex") ? FunctionOptions.VTableIndex : -1;
		const unVTableOffset = Object.hasOwn(FunctionOptions, "VTableOffset") ? FunctionOptions.VTableOffset : 0;
		const strCallingConvention = Object.hasOwn(FunctionOptions, "CallingConvention") ? FunctionOptions.CallingConvention : g_Convention.Cdecl;
		const strReturnTypeValue = FunctionOptions.ReturnType;
		const vecArgumentTypeValues = FunctionOptions.ArgumentTypes;

		if (typeof bIsVirtual !== "boolean") {
			throw new TypeError("FunctionInfo IsVirtual must be a boolean.");
		}

		if (!Number.isSafeInteger(nThisAddressOffset)) {
			throw new TypeError("FunctionInfo ThisAddressOffset must be a safe integer.");
		}

		if (!Number.isSafeInteger(nVTableIndex) || (nVTableIndex < -1)) {
			throw new TypeError("FunctionInfo VTableIndex must be a safe integer greater than or equal to -1.");
		}

		if (!Number.isSafeInteger(unVTableOffset) || (unVTableOffset < 0)) {
			throw new TypeError("FunctionInfo VTableOffset must be a non-negative safe integer.");
		}

		if ((typeof strCallingConvention !== "string") || (strCallingConvention.trim().length === 0)) {
			throw new TypeError("FunctionInfo CallingConvention must be a non-empty string.");
		}

		const strReturnType = NormalizeReturnType(strReturnTypeValue);
		const vecArgumentTypes = NormalizeFunctionArguments(vecArgumentTypeValues);

		this.IsVirtual = bIsVirtual;
		this.ThisAddressOffset = nThisAddressOffset;
		this.VTableIndex = nVTableIndex;
		this.VTableOffset = unVTableOffset;
		this.ReturnType = strReturnType;
		this.ArgumentTypes = vecArgumentTypes;
		this.CallingConvention = strCallingConvention;
	}

	ToHookOptions() {
		return { Arguments: this.ArgumentTypes, Convention: this.CallingConvention, ReturnType: this.ReturnType };
	}
}

function NormalizeFunctionInformation(FunctionInformationLike) {
	if (FunctionInformationLike instanceof FunctionInfo) {
		return FunctionInformationLike;
	}

	if ((FunctionInformationLike === null) || (typeof FunctionInformationLike !== "object") || Array.isArray(FunctionInformationLike)) {
		throw new TypeError("Function info entries must be FunctionInfo instances or objects.");
	}

	return new FunctionInfo(FunctionInformationLike);
}

function NormalizeFunctionInformationList(FunctionInformationLike) {
	const vecFunctionInformationValues = Array.isArray(FunctionInformationLike) ? FunctionInformationLike : [FunctionInformationLike];
	const unFunctionInformationCount = vecFunctionInformationValues.length;
	if (unFunctionInformationCount === 0) {
		throw new TypeError("Function info overload lists must not be empty.");
	}

	const vecNormalizedFunctionInformation = new Array(unFunctionInformationCount);
	for (let unFunctionInformationIndex = 0; unFunctionInformationIndex < unFunctionInformationCount; unFunctionInformationIndex += 1) {
		vecNormalizedFunctionInformation[unFunctionInformationIndex] = NormalizeFunctionInformation(vecFunctionInformationValues[unFunctionInformationIndex]);
	}

	return vecNormalizedFunctionInformation;
}

function NormalizeClassInformation(ClassInformation = {}) {
	if ((ClassInformation === null) || (typeof ClassInformation !== "object") || Array.isArray(ClassInformation)) {
		throw new TypeError("Class info must be a Map or object.");
	}

	const NormalizedClassInformation = Object.create(null);
	const FunctionInformationEntries = (ClassInformation instanceof Map) ? ClassInformation.entries() : Object.entries(ClassInformation);
	for (const [strFunctionName, FunctionInformationLike] of FunctionInformationEntries) {
		if ((typeof strFunctionName !== "string") || (strFunctionName.trim().length === 0)) {
			throw new TypeError("Class info function names must be non-empty strings.");
		}

		NormalizedClassInformation[strFunctionName] = NormalizeFunctionInformationList(FunctionInformationLike);
	}

	return NormalizedClassInformation;
}

function ResolveObjectTypeRecord(ObjectTypeReference) {
	if ((ObjectTypeReference === null) || (ObjectTypeReference === undefined)) {
		return null;
	}

	if (typeof ObjectTypeReference === "string") {
		const RegisteredObjectTypeRecord = g_mapMemoryObjectTypes.get(ObjectTypeReference);
		return (RegisteredObjectTypeRecord === undefined) ? null : RegisteredObjectTypeRecord;
	}

	if (typeof ObjectTypeReference === "function") {
		for (const RegisteredObjectTypeRecord of g_mapMemoryObjectTypes.values()) {
			if (RegisteredObjectTypeRecord.Constructor === ObjectTypeReference) {
				return RegisteredObjectTypeRecord;
			}
		}

		if (typeof ObjectTypeReference.CreateFromAddress !== "function") {
			return null;
		}

		const ObjectClassInformationValue = ObjectTypeReference.ClassInfo;

		return { ClassInfo: NormalizeClassInformation((ObjectClassInformationValue === undefined) ? {} : ObjectClassInformationValue), Constructor: ObjectTypeReference, Name: ObjectTypeReference.name, Size: ResolveObjectTypeSize(ObjectTypeReference.TypeSize) };
	}

	if (typeof ObjectTypeReference === "object") {
		return ResolveObjectTypeRecord(ObjectTypeReference.constructor);
	}

	return null;
}

function RequireObjectTypeRecord(ObjectTypeReference) {
	const ObjectTypeRecord = ResolveObjectTypeRecord(ObjectTypeReference);
	const ObjectTypeConstructor = (ObjectTypeRecord === null) ? null : ObjectTypeRecord.Constructor;
	if ((typeof ObjectTypeConstructor !== "function") || (typeof ObjectTypeConstructor.CreateFromAddress !== "function")) {
		throw new TypeError(`Unknown SourceJS object type: ${String(ObjectTypeReference)}`);
	}

	return ObjectTypeRecord;
}

function RequireObjectTypeSize(ObjectTypeRecord, ObjectTypeReference) {
	const unObjectTypeSize = ObjectTypeRecord.Size;
	if (!Number.isSafeInteger(unObjectTypeSize) || (unObjectTypeSize <= 0)) {
		throw new TypeError(`SourceJS object type has no registered size: ${String(ObjectTypeReference)}`);
	}

	return unObjectTypeSize;
}

function CallArgument(ArgumentValue, strArgumentType) {
	if (!strArgumentType || !Type.IsNativeDataType(strArgumentType)) {
		return ArgumentValue;
	}

	const strNormalizedArgumentType = Type.NormalizeDataType(strArgumentType);
	let strNativeArgumentType = strNormalizedArgumentType;
	if ((strNormalizedArgumentType === g_DataType.StringAddress) || (strNormalizedArgumentType === g_DataType.StringArray)) {
		strNativeArgumentType = g_DataType.String;
	}

	return { Type: strNativeArgumentType, Value: ArgumentValue };
}

function CallArguments(vecArgumentValues, vecArgumentTypes) {
	if (!Array.isArray(vecArgumentValues) || !Array.isArray(vecArgumentTypes)) {
		throw new TypeError("CallArguments() expects argument value and type arrays.");
	}

	const unArgumentCount = vecArgumentValues.length;
	const vecNativeArguments = new Array(unArgumentCount);
	for (let unArgumentIndex = 0; unArgumentIndex < unArgumentCount; unArgumentIndex += 1) {
		vecNativeArguments[unArgumentIndex] = CallArgument(vecArgumentValues[unArgumentIndex], vecArgumentTypes[unArgumentIndex]);
	}

	return vecNativeArguments;
}

function ResolveBinaryAddress(strBinaryName, BinaryIdentifier) {
	return g_MemoryManagerRuntime.ResolveBinaryIdentifier(strBinaryName, BinaryIdentifier);
}

function ResolveAddressValue(AddressLike) {
	if (AddressLike instanceof BaseAddress) {
		return CreateAddress(AddressLike.Address);
	}

	return CreateAddress(AddressLike);
}

function ResolveOptionalObjectAddress(AddressLike) {
	if ((AddressLike === null) || (AddressLike === undefined)) {
		return undefined;
	}

	if (typeof AddressLike === "bigint") {
		return CreateAddress(AddressLike);
	}

	if (AddressLike instanceof BaseAddress) {
		return CreateAddress(AddressLike.Address);
	}

	if ((typeof AddressLike !== "object") && (typeof AddressLike !== "function")) {
		return undefined;
	}

	const GetAddress = AddressLike.GetMemoryAddress;
	if (typeof GetAddress === "function") {
		return CreateAddress(GetAddress.call(AddressLike));
	}

	const unAddressValue = AddressLike.Address;

	return (typeof unAddressValue === "bigint") ? CreateAddress(unAddressValue) : undefined;
}

function Allocate(unByteCount) {
	return g_AllocateNative(unByteCount);
}

function Reallocate(unAddress, unByteCount) {
	return g_ReallocateNative(unAddress, unByteCount);
}

function Deallocate(unAddress) {
	return g_DeallocateNative(unAddress);
}

const g_BinaryFileName = Symbol("BinaryFileName");

class BinaryFile {
	constructor(strBinaryName) {
		if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
			throw new TypeError("BinaryFile strBinaryName must be a non-empty string.");
		}

		this[g_BinaryFileName] = strBinaryName;
	}

	ResolveBinaryAddress(BinaryIdentifier) {
		return ResolveBinaryAddress(this.Name, BinaryIdentifier);
	}

	DereferenceBinaryAddress(BinaryIdentifier, nAddressOffset = 0n, unDereferenceCount = 0) {
		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("BinaryFile.DereferenceBinaryAddress nAddressOffset must be a BigInt.");
		}

		if (!Number.isSafeInteger(unDereferenceCount) || (unDereferenceCount < 0)) {
			throw new RangeError("BinaryFile.DereferenceBinaryAddress unDereferenceCount must be a non-negative safe integer.");
		}

		let unAddressValue = this.ResolveBinaryAddress(BinaryIdentifier);
		if ((unAddressValue === null) || (unAddressValue === 0n)) {
			return 0n;
		}

		if (nAddressOffset !== 0n) {
			unAddressValue = Add(unAddressValue, nAddressOffset);
		}

		for (let unDereferenceIndex = 0; unDereferenceIndex < unDereferenceCount; unDereferenceIndex += 1) {
			if (unAddressValue === 0n) {
				return 0n;
			}

			unAddressValue = ReadAddress(unAddressValue);
		}

		return unAddressValue;
	}

	get Name() {
		return this[g_BinaryFileName];
	}

	set Name(strBinaryName) {
		if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
			throw new TypeError("BinaryFile strBinaryName must be a non-empty string.");
		}

		this[g_BinaryFileName] = strBinaryName;
	}

	// Preserve the public getter; each successful native lookup creates a detached information record.
	get Information() {
		const BinaryInformation = GetBinary(this.Name);
		if (BinaryInformation === null) {
			return null;
		}

		return { Name: BinaryInformation.Name, Path: BinaryInformation.Path, Address: BinaryInformation.Address, ByteCount: BinaryInformation.Size };
	}

	get Address() {
		const BinaryInformation = this.Information;

		return (BinaryInformation === null) ? 0n : BinaryInformation.Address;
	}

	get ByteCount() {
		const BinaryInformation = this.Information;

		return (BinaryInformation === null) ? 0 : BinaryInformation.ByteCount;
	}
}

class Address extends BaseAddress {
	constructor(unAddress = 0n, bOwned = false) {
		if (typeof bOwned !== "boolean") {
			throw new TypeError("Address bOwned must be a boolean.");
		}

		super(unAddress);

		this.Owned = bOwned;
	}

	static CreateFromAddress(unAddress) {
		return new Address(unAddress);
	}

	GetMemoryAddress() {
		return super.Address;
	}

	HasMemoryAddress() {
		return this.GetMemoryAddress() !== 0n;
	}

	Add(nAddressOffset) {
		return new Address(Add(super.Address, nAddressOffset));
	}

	Subtract(nAddressOffset) {
		return new Address(Subtract(super.Address, nAddressOffset));
	}

	Equals(AddressLike) {
		const unComparisonAddress = ResolveAddressValue(AddressLike);

		return super.Address === unComparisonAddress;
	}

	CompareTo(AddressLike) {
		const unAddressValue = super.Address;
		const unComparisonAddress = ResolveAddressValue(AddressLike);
		if (unAddressValue < unComparisonAddress) {
			return -1;
		}

		if (unAddressValue > unComparisonAddress) {
			return 1;
		}

		return 0;
	}

	GetBool(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Bool, nAddressOffset);
	}

	// Native Write returns true on success and throws on failure; setters retain the fluent Address result.
	SetBool(bBooleanValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Bool, bBooleanValue, nAddressOffset);

		return this;
	}

	GetChar(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Char, nAddressOffset);
	}

	SetChar(nCharacterValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Char, nCharacterValue, nAddressOffset);

		return this;
	}

	GetUChar(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.UChar, nAddressOffset);
	}

	SetUChar(unByteValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.UChar, unByteValue, nAddressOffset);

		return this;
	}

	GetShort(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Short, nAddressOffset);
	}

	SetShort(nShortValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Short, nShortValue, nAddressOffset);

		return this;
	}

	GetUShort(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.UShort, nAddressOffset);
	}

	SetUShort(unShortValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.UShort, unShortValue, nAddressOffset);

		return this;
	}

	GetInt(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Int, nAddressOffset);
	}

	SetInt(nIntegerValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Int, nIntegerValue, nAddressOffset);

		return this;
	}

	GetUInt(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.UInt, nAddressOffset);
	}

	SetUInt(unIntegerValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.UInt, unIntegerValue, nAddressOffset);

		return this;
	}

	GetLong(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Long, nAddressOffset);
	}

	SetLong(nLongValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Long, nLongValue, nAddressOffset);

		return this;
	}

	GetULong(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.ULong, nAddressOffset);
	}

	SetULong(unLongValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.ULong, unLongValue, nAddressOffset);

		return this;
	}

	GetLongLong(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.LongLong, nAddressOffset);
	}

	SetLongLong(nLongLongValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.LongLong, nLongLongValue, nAddressOffset);

		return this;
	}

	GetULongLong(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.ULongLong, nAddressOffset);
	}

	SetULongLong(unLongLongValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.ULongLong, unLongLongValue, nAddressOffset);

		return this;
	}

	GetFloat(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Float, nAddressOffset);
	}

	SetFloat(flFloatValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Float, flFloatValue, nAddressOffset);

		return this;
	}

	GetDouble(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.Double, nAddressOffset);
	}

	SetDouble(dblDoubleValue, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Double, dblDoubleValue, nAddressOffset);

		return this;
	}

	GetStringAddress(nAddressOffset = 0n) {
		return Read(super.Address, g_DataType.StringAddress, nAddressOffset);
	}

	SetAddress(AddressLike, nAddressOffset = 0n) {
		Write(super.Address, g_DataType.Address, ResolveAddressValue(AddressLike), nAddressOffset);

		return this;
	}

	ReadAddress(nAddressOffset = 0n) {
		return ReadAddress(super.Address, nAddressOffset);
	}

	GetVirtualFunction(unVirtualFunctionIndex) {
		return VirtualFunction(super.Address, unVirtualFunctionIndex);
	}

	MakeFunction(CallingConventionOrFunctionInformation = g_Convention.Cdecl, vecArgumentTypes = [], strReturnType = g_DataType.Void) {
		if (CallingConventionOrFunctionInformation instanceof FunctionInfo) {
			const FunctionInformation = CallingConventionOrFunctionInformation;
			return new Function(super.Address, FunctionInformation.CallingConvention, FunctionInformation.ArgumentTypes, FunctionInformation.ReturnType);
		}

		return new Function(super.Address, CallingConventionOrFunctionInformation, vecArgumentTypes, strReturnType);
	}

	MakeVirtualFunction(VirtualFunctionIndexOrInformation, strCallingConvention = g_Convention.Thiscall, vecArgumentTypes = [], strReturnType = g_DataType.Void) {
		if (VirtualFunctionIndexOrInformation instanceof FunctionInfo) {
			const FunctionInformation = VirtualFunctionIndexOrInformation;
			const unFunctionAddress = this.GetVirtualFunction(FunctionInformation.VTableIndex);
			const vecSignatureArgumentTypes = FunctionInformation.ArgumentTypes;
			let vecUserArgumentTypes = vecSignatureArgumentTypes;
			if (vecSignatureArgumentTypes[0] === g_DataType.Address) {
				const unUserArgumentCount = vecSignatureArgumentTypes.length - 1;
				vecUserArgumentTypes = new Array(unUserArgumentCount);
				for (let unArgumentIndex = 0; unArgumentIndex < unUserArgumentCount; unArgumentIndex += 1) {
					vecUserArgumentTypes[unArgumentIndex] = vecSignatureArgumentTypes[unArgumentIndex + 1];
				}
			}

			return new Function(unFunctionAddress, FunctionInformation.CallingConvention, vecUserArgumentTypes, FunctionInformation.ReturnType, null, super.Address, vecSignatureArgumentTypes);
		}

		const unFunctionAddress = this.GetVirtualFunction(VirtualFunctionIndexOrInformation);

		return new Function(unFunctionAddress, strCallingConvention, vecArgumentTypes, strReturnType, null, super.Address);
	}

	Reallocate(unByteCount) {
		if (!this.Owned) {
			throw new Error("Address.Reallocate requires owned allocated memory.");
		}

		BaseAddress.RebindAddress(this, Reallocate(super.Address, unByteCount));

		return this;
	}

	Deallocate() {
		if (!this.Owned) {
			throw new Error("Address.Deallocate requires owned allocated memory.");
		}

		const bDeallocationResult = Deallocate(super.Address);
		if (bDeallocationResult) {
			BaseAddress.RebindAddress(this, 0n);
			this.Owned = false;
		}

		return bDeallocationResult;
	}

	Compare(AddressLike, unByteCount) {
		return Compare(super.Address, ResolveAddressValue(AddressLike), unByteCount);
	}

	IsOverlapping(DestinationAddressLike, unByteCount) {
		const unSourceAddress = ResolveAddressValue(super.Address);
		const unDestinationAddress = ResolveAddressValue(DestinationAddressLike);
		if (!Number.isSafeInteger(unByteCount) || (unByteCount <= 0)) {
			throw new TypeError("Address.IsOverlapping unByteCount must be a positive safe integer.");
		}

		const unBigIntByteCount = BigInt(unByteCount);

		return (unSourceAddress < (unDestinationAddress + unBigIntByteCount)) && (unDestinationAddress < (unSourceAddress + unBigIntByteCount));
	}

	SearchBytes(BytePattern, unByteCount) {
		return SearchBytes(super.Address, BytePattern, unByteCount);
	}

	CopyTo(DestinationAddressLike, unByteCount) {
		return Copy(super.Address, ResolveAddressValue(DestinationAddressLike), unByteCount);
	}

	CopyFrom(SourceAddressLike, unByteCount) {
		return Copy(ResolveAddressValue(SourceAddressLike), super.Address, unByteCount);
	}

	MoveTo(DestinationAddressLike, unByteCount) {
		return Move(super.Address, ResolveAddressValue(DestinationAddressLike), unByteCount);
	}

	MoveFrom(SourceAddressLike, unByteCount) {
		return Move(ResolveAddressValue(SourceAddressLike), super.Address, unByteCount);
	}

	SetProtection(MemoryProtection, unByteCount) {
		return SetProtection(super.Address, unByteCount, MemoryProtection);
	}
}

function CreateNativeFunctionOptions(FunctionOptions) {
	const NativeFunctionOptions = { Address: FunctionOptions.Address, Arguments: FunctionOptions.Arguments, Convention: FunctionOptions.Convention, ReturnType: FunctionOptions.ReturnType };
	if ((FunctionOptions.ThisObject !== null) && (FunctionOptions.ThisObject !== undefined)) {
		NativeFunctionOptions.ThisObject = FunctionOptions.ThisObject;
	}

	return NativeFunctionOptions;
}

class Function extends Address {
	constructor(unFunctionAddress = 0n, strCallingConvention = g_Convention.Cdecl, vecArgumentTypes = [], strReturnType = g_DataType.Void, ReturnConverter = null, ThisObject = null, vecSignatureArgumentTypes = null) {
		const vecNormalizedArgumentTypes = NormalizeFunctionArguments(vecArgumentTypes);
		const bUsesCallArgumentTypes = (vecSignatureArgumentTypes === null) || (vecSignatureArgumentTypes === undefined);
		const vecNormalizedSignatureArgumentTypes = bUsesCallArgumentTypes ? vecNormalizedArgumentTypes : NormalizeFunctionArguments(vecSignatureArgumentTypes);
		const strNormalizedReturnType = NormalizeReturnType(strReturnType);
		const strNormalizedCallingConvention = ((strCallingConvention === null) || (strCallingConvention === undefined)) ? g_Convention.Cdecl : strCallingConvention;

		if ((typeof unFunctionAddress !== "bigint") || (unFunctionAddress < 0n)) {
			throw new TypeError(`Function unFunctionAddress must be a non-negative bigint; received ${typeof unFunctionAddress}.`);
		}

		if ((typeof strNormalizedCallingConvention !== "string") || (strNormalizedCallingConvention.trim().length === 0)) {
			throw new TypeError("Function strCallingConvention must be a non-empty string.");
		}

		if ((ReturnConverter !== null) && (typeof ReturnConverter !== "function")) {
			throw new TypeError("Function ReturnConverter must be a function or null.");
		}

		const unThisObjectAddress = ((ThisObject === null) || (ThisObject === undefined)) ? null : ResolveAddressValue(ThisObject);
		super(unFunctionAddress);
		this.ArgumentTypes = vecNormalizedArgumentTypes;
		this.SignatureArgumentTypes = vecNormalizedSignatureArgumentTypes;
		this.ReturnType = strNormalizedReturnType;
		this.ReturnConverter = ReturnConverter;
		this.Convention = strNormalizedCallingConvention;
		this.ThisObject = unThisObjectAddress;
		this.Hook = null;
	}

	Call(...vecArgumentValues) {
		const ReturnConverter = this.ReturnConverter;
		if ((ReturnConverter !== null) && (typeof ReturnConverter !== "function")) {
			throw new TypeError("Function ReturnConverter must be a function or null.");
		}

		const FunctionOptions = this.Options;
		const NativeFunctionOptions = CreateNativeFunctionOptions(FunctionOptions);
		NativeFunctionOptions.Arguments = CallArguments(vecArgumentValues, this.ArgumentTypes);

		const FunctionResult = g_MemoryHooks.CallFunction(NativeFunctionOptions);
		if (ReturnConverter === null) {
			return FunctionResult;
		}

		return ReturnConverter(FunctionResult);
	}

	IsCallable() {
		return !super.Null;
	}

	IsHooked() {
		return this.Hook !== null;
	}

	AddHook(unHookTypeValue, HookCallback) {
		if ((unHookTypeValue !== HookType.Pre) && (unHookTypeValue !== HookType.Post)) {
			throw new RangeError("Function.AddHook unHookTypeValue must be HookType.Pre or HookType.Post.");
		}

		if (typeof HookCallback !== "function") {
			throw new TypeError("Function.AddHook HookCallback must be a function.");
		}

		const ExistingHook = this.Hook;
		const HookHandle = (ExistingHook === null) ? g_MemoryHooks.CreateFunctionHook(CreateNativeFunctionOptions(this.Options)) : ExistingHook;
		if (HookHandle === null) {
			throw new Error("Function.AddHook could not create the native hook.");
		}

		const bNativeHookCreated = (ExistingHook === null) && (HookHandle.Created === true);
		if (ExistingHook === null) {
			this.Hook = HookHandle;
		}

		let bRegistrationResult = false;
		try {
			bRegistrationResult = (unHookTypeValue === HookType.Post) ? HookHandle.Post(HookCallback) : HookHandle.Pre(HookCallback);
		} catch (OperationError) {
			if (!bNativeHookCreated) {
				throw OperationError;
			}

			const vecErrors = [OperationError];
			try {
				if (HookHandle.Remove() !== true) {
					throw new Error("Function.AddHook could not remove the native hook after callback registration threw.");
				}

				if (this.Hook === HookHandle) {
					this.Hook = null;
				}
			} catch (CleanupError) {
				vecErrors.push(CleanupError);
			}

			if (vecErrors.length > 1) {
				throw new AggregateError(vecErrors, "Function.AddHook callback registration and native hook cleanup failed.");
			}

			throw OperationError;
		}

		if (!bRegistrationResult) {
			if (bNativeHookCreated && HookHandle.Remove() && (this.Hook === HookHandle)) {
				this.Hook = null;
			}

			return false;
		}

		return bRegistrationResult;
	}

	RemoveHook(unHookTypeValue = null, HookCallback = null) {
		if ((HookCallback === null) && (unHookTypeValue !== null)) {
			throw new TypeError("Function.RemoveHook unHookTypeValue requires HookCallback.");
		}

		if ((HookCallback !== null) && (typeof HookCallback !== "function")) {
			throw new TypeError("Function.RemoveHook HookCallback must be a function or null.");
		}

		if ((HookCallback !== null) && (unHookTypeValue !== HookType.Pre) && (unHookTypeValue !== HookType.Post)) {
			throw new RangeError("Function.RemoveHook unHookTypeValue must be HookType.Pre or HookType.Post.");
		}

		const HookHandle = this.Hook;
		if (HookHandle === null) {
			return false;
		}

		if (HookCallback !== null) {
			return (unHookTypeValue === HookType.Post) ? HookHandle.RemovePost(HookCallback) : HookHandle.RemovePre(HookCallback);
		}

		const bRemovalResult = HookHandle.Remove();
		if (bRemovalResult && (this.Hook === HookHandle)) {
			this.Hook = null;
		}

		return bRemovalResult;
	}

	AddPreHook(HookCallback) {
		return this.AddHook(HookType.Pre, HookCallback);
	}

	AddPostHook(HookCallback) {
		return this.AddHook(HookType.Post, HookCallback);
	}

	RemovePreHook(HookCallback) {
		if (typeof HookCallback !== "function") {
			throw new TypeError("Function.RemovePreHook HookCallback must be a function.");
		}

		return this.RemoveHook(HookType.Pre, HookCallback);
	}

	RemovePostHook(HookCallback) {
		if (typeof HookCallback !== "function") {
			throw new TypeError("Function.RemovePostHook HookCallback must be a function.");
		}

		return this.RemoveHook(HookType.Post, HookCallback);
	}

	// Preserve the public getter; each read allocates a shallow record borrowing SignatureArgumentTypes.
	get Options() {
		return { Address: super.Address, Arguments: this.SignatureArgumentTypes, Convention: this.Convention, ReturnType: this.ReturnType, ThisObject: this.ThisObject };
	}
}

function RegisterObjectType(strObjectTypeName, ObjectTypeConstructor, TypeOptions = {}) {
	if ((typeof strObjectTypeName !== "string") || (strObjectTypeName.trim().length === 0) || (typeof ObjectTypeConstructor !== "function")) {
		throw new TypeError("RegisterObjectType expects a non-empty strObjectTypeName and callable ObjectTypeConstructor.");
	}

	if ((TypeOptions === null) || (typeof TypeOptions !== "object") || Array.isArray(TypeOptions)) {
		throw new TypeError("RegisterObjectType TypeOptions must be an object.");
	}

	let unObjectTypeSizeValue = TypeOptions.Size;
	let ObjectClassInformationValue = TypeOptions.ClassInfo;
	if (unObjectTypeSizeValue === undefined) {
		unObjectTypeSizeValue = ObjectTypeConstructor.TypeSize;
	}

	if (ObjectClassInformationValue === undefined) {
		ObjectClassInformationValue = ObjectTypeConstructor.ClassInfo;
	}

	const bHasObjectTypeSize = (unObjectTypeSizeValue !== null) && (unObjectTypeSizeValue !== undefined);
	const unObjectTypeSize = bHasObjectTypeSize ? ResolveObjectTypeSize(unObjectTypeSizeValue) : 0;
	if (bHasObjectTypeSize && (unObjectTypeSize === 0)) {
		throw new TypeError("RegisterObjectType Size must be a positive safe integer when provided.");
	}

	const ObjectClassInformation = NormalizeClassInformation((ObjectClassInformationValue === undefined) ? {} : ObjectClassInformationValue);
	const ObjectTypeRecord = { ClassInfo: ObjectClassInformation, Constructor: ObjectTypeConstructor, Name: strObjectTypeName, Size: unObjectTypeSize };
	g_mapMemoryObjectTypes.set(strObjectTypeName, ObjectTypeRecord);

	return true;
}

function ObjectType(strObjectTypeName) {
	if ((typeof strObjectTypeName !== "string") || (strObjectTypeName.trim().length === 0)) {
		throw new TypeError("ObjectType strObjectTypeName must be a non-empty string.");
	}

	const ObjectTypeRecord = g_mapMemoryObjectTypes.get(strObjectTypeName);

	return (ObjectTypeRecord === undefined) ? null : ObjectTypeRecord.Constructor;
}

function ObjectTypeInfo(ObjectTypeValue) {
	const ObjectTypeRecord = ResolveObjectTypeRecord(ObjectTypeValue);
	if (ObjectTypeRecord === null) {
		return null;
	}

	return ObjectTypeRecord;
}

function GetClass(strObjectTypeName) {
	const ObjectTypeConstructor = ObjectType(strObjectTypeName);
	if (ObjectTypeConstructor === null) {
		throw new ReferenceError(`Unknown SourceJS exposed class: ${strObjectTypeName}`);
	}

	return ObjectTypeConstructor;
}

function GetClassName(ObjectTypeValue) {
	const ObjectTypeRecord = RequireObjectTypeRecord(ObjectTypeValue);
	const strObjectTypeName = ObjectTypeRecord.Name;
	if ((typeof strObjectTypeName !== "string") || (strObjectTypeName.length === 0)) {
		throw new ReferenceError("SourceJS object type has no exposed class name.");
	}

	return strObjectTypeName;
}

function GetClassInfo(ObjectTypeValue) {
	const ObjectTypeRecord = RequireObjectTypeRecord(ObjectTypeValue);

	return ObjectTypeRecord.ClassInfo;
}

function GetFunctionInfo(ObjectTypeValue, strFunctionName, unFunctionIndex = 0) {
	if ((typeof strFunctionName !== "string") || (strFunctionName.trim().length === 0)) {
		throw new TypeError("GetFunctionInfo strFunctionName must be a non-empty string.");
	}

	if (!Number.isSafeInteger(unFunctionIndex) || (unFunctionIndex < 0)) {
		throw new RangeError("GetFunctionInfo unFunctionIndex must be a non-negative safe integer.");
	}

	const ObjectClassInformation = GetClassInfo(ObjectTypeValue);
	if (!Object.hasOwn(ObjectClassInformation, strFunctionName)) {
		throw new ReferenceError(`Unknown SourceJS function info: ${GetClassName(ObjectTypeValue)}.${strFunctionName}`);
	}

	const vecFunctionOverloads = ObjectClassInformation[strFunctionName];
	if (!Array.isArray(vecFunctionOverloads)) {
		throw new TypeError(`SourceJS function info is malformed: ${GetClassName(ObjectTypeValue)}.${strFunctionName}`);
	}

	const unOverloadCount = vecFunctionOverloads.length;
	if (unOverloadCount === 0) {
		throw new TypeError(`SourceJS function info is malformed: ${GetClassName(ObjectTypeValue)}.${strFunctionName}`);
	}

	if (unFunctionIndex >= unOverloadCount) {
		throw new RangeError(`Function info overload index out of range: ${unFunctionIndex}`);
	}

	return vecFunctionOverloads[unFunctionIndex];
}

function ObjectTypeSize(ObjectTypeValue) {
	const ObjectTypeRecord = RequireObjectTypeRecord(ObjectTypeValue);

	return RequireObjectTypeSize(ObjectTypeRecord, ObjectTypeValue);
}

function AllocateObject(ObjectTypeValue) {
	return Allocate(ObjectTypeSize(ObjectTypeValue));
}

function GetObjectAddress(ObjectValue) {
	if ((ObjectValue === null) || (ObjectValue === undefined)) {
		return 0n;
	}

	const unObjectAddress = ResolveOptionalObjectAddress(ObjectValue);
	if (unObjectAddress !== undefined) {
		return unObjectAddress;
	}

	throw new TypeError("GetObjectAddress ObjectValue must be a BigInt address or address-backed object.");
}

function GetVirtualFunction(ObjectValue, strFunctionName, unFunctionIndex = 0) {
	const unObjectAddress = GetObjectAddress(ObjectValue);
	if (unObjectAddress === 0n) {
		throw new TypeError("GetVirtualFunction ObjectValue must be address-backed.");
	}

	return new Address(unObjectAddress).MakeVirtualFunction(GetFunctionInfo(ObjectValue, strFunctionName, unFunctionIndex));
}

function MakeObject(ObjectTypeValue, AddressLike, nAddressOffset = 0n) {
	const ObjectTypeRecord = RequireObjectTypeRecord(ObjectTypeValue);
	const unBaseAddress = GetObjectAddress(AddressLike);
	const unObjectAddress = (nAddressOffset === 0n) ? unBaseAddress : Add(unBaseAddress, nAddressOffset);

	return ObjectTypeRecord.Constructor.CreateFromAddress(unObjectAddress);
}

// Native Copy returns true on success and throws on invalid input; these helpers return the requested address or object.
function CopyObjectToAddress(SourceValue, DestinationAddressLike, ObjectTypeValue = null, nAddressOffset = 0n) {
	const ResolvedObjectTypeValue = (ObjectTypeValue === null) ? SourceValue : ObjectTypeValue;
	const ObjectTypeRecord = RequireObjectTypeRecord(ResolvedObjectTypeValue);
	const unObjectByteCount = RequireObjectTypeSize(ObjectTypeRecord, ResolvedObjectTypeValue);
	const unDestinationBaseAddress = GetObjectAddress(DestinationAddressLike);
	const unDestinationAddress = (nAddressOffset === 0n) ? unDestinationBaseAddress : Add(unDestinationBaseAddress, nAddressOffset);
	const unSourceAddress = ResolveOptionalObjectAddress(SourceValue);
	if ((unSourceAddress !== undefined) && (unSourceAddress !== 0n)) {
		Copy(unSourceAddress, unDestinationAddress, unObjectByteCount);
		return unDestinationAddress;
	}

	const DestinationObjectView = MakeObject(ObjectTypeRecord.Constructor, unDestinationAddress);
	const CopyFrom = DestinationObjectView.CopyMathStructureFrom;
	if (typeof CopyFrom !== "function") {
		throw new TypeError(`SourceJS object type cannot copy values into memory: ${ObjectTypeRecord.Name}`);
	}

	CopyFrom.call(DestinationObjectView, SourceValue);

	return unDestinationAddress;
}

function CopyAddressToObject(SourceAddressLike, TargetOrObjectTypeOut, nAddressOffset = 0n) {
	const unSourceBaseAddress = GetObjectAddress(SourceAddressLike);
	const unSourceAddress = (nAddressOffset === 0n) ? unSourceBaseAddress : Add(unSourceBaseAddress, nAddressOffset);

	if ((typeof TargetOrObjectTypeOut === "string") || (typeof TargetOrObjectTypeOut === "function")) {
		return MakeObject(TargetOrObjectTypeOut, unSourceAddress);
	}

	const ObjectTypeRecord = RequireObjectTypeRecord(TargetOrObjectTypeOut);
	const unObjectByteCount = RequireObjectTypeSize(ObjectTypeRecord, TargetOrObjectTypeOut);
	const unTargetAddress = ResolveOptionalObjectAddress(TargetOrObjectTypeOut);
	if (unTargetAddress === undefined) {
		throw new TypeError(`SourceJS object type is not address-backed: ${ObjectTypeRecord.Name}`);
	}

	if (unTargetAddress !== 0n) {
		Copy(unSourceAddress, unTargetAddress, unObjectByteCount);
		return TargetOrObjectTypeOut;
	}

	throw new TypeError(`SourceJS object type cannot copy values from memory: ${ObjectTypeRecord.Name}`);
}

RegisterObjectType("Address", Address, { Size: TYPE_SIZES.address });
RegisterObjectType("Function", Function, { Size: TYPE_SIZES.address });

Object.assign(g_MemoryRuntime, {
	Allocate,
	BinaryFile,
	Convention: g_Convention,
	DataType: g_DataType,
	Function,
	FunctionInfo,
	NULL: g_unNullAddress,
	Address,
	Protection: g_Protection,
	Reallocate,
	Deallocate,
	Register: g_Register,
	TYPE_SIZES,
	AllocateObject,
	CopyObjectToAddress,
	CopyAddressToObject,
	GetDataTypeSize,
	GameData: g_GameData,
	GetClass,
	GetClassInfo,
	GetClassName,
	GetFunctionInfo,
	GetObjectAddress,
	GetVirtualFunction,
	Helpers: g_MemoryHelpers,
	MakeObject,
	ObjectType,
	ObjectTypeInfo,
	ObjectTypeSize,
	RegisterObjectType,
});

// Preserve the public lazy getter and the memory/manager import cycle; first access may initialize that module.
Object.defineProperty(g_MemoryRuntime, "Manager", {
	configurable: true,
	enumerable: true,
	get() {
		return require("memory/manager");
	},
});

module.exports = g_MemoryRuntime;
