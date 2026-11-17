"use strict";

const { GetRawModule } = require("internal/runtime");

const g_NoDefault = Symbol("sourcejs.memory.NO_DEFAULT");

const g_HelpersRuntime = GetRawModule("memory/helpers");
const g_MemoryManagerRuntime = GetRawModule("memory/manager");
const g_MemoryRuntime = GetRawModule("memory");
const g_MemoryHooksRuntime = GetRawModule("memory/hooks");

function RequireMemoryAddressSize() {
	const unMemoryAddressSize = g_HelpersRuntime.ADDRESS_SIZE;
	if (!Number.isSafeInteger(unMemoryAddressSize) || (unMemoryAddressSize <= 0)) {
		throw new TypeError("memory/helpers.ADDRESS_SIZE is not a positive safe integer.");
	}

	return unMemoryAddressSize;
}

function LoadHelpersRuntimeStrings(strPropertyName) {
	const vecRuntimeStrings = g_HelpersRuntime[strPropertyName];
	if (!Array.isArray(vecRuntimeStrings)) {
		throw new TypeError(`memory/helpers.${strPropertyName} is not an array.`);
	}

	const vecLoadedStrings = [];
	for (const strRuntimeString of vecRuntimeStrings) {
		if ((typeof strRuntimeString !== "string") || (strRuntimeString.length === 0)) {
			throw new TypeError(`memory/helpers.${strPropertyName} contains an invalid string.`);
		}

		vecLoadedStrings.push(strRuntimeString);
	}

	return Object.freeze(vecLoadedStrings);
}

function LoadMemoryDataTypeSizes() {
	const RuntimeDataTypeSizes = g_HelpersRuntime.DATA_TYPE_SIZES;
	if ((RuntimeDataTypeSizes === null) || (typeof RuntimeDataTypeSizes !== "object") || Array.isArray(RuntimeDataTypeSizes)) {
		throw new TypeError("memory/helpers.DATA_TYPE_SIZES is not an object.");
	}

	const DataTypeSizes = {};
	for (const strDataTypeName of Object.keys(RuntimeDataTypeSizes)) {
		const unDataTypeSize = RuntimeDataTypeSizes[strDataTypeName];
		if (!Number.isSafeInteger(unDataTypeSize) || (unDataTypeSize <= 0)) {
			throw new TypeError(`memory/helpers.DATA_TYPE_SIZES.${strDataTypeName} is not a positive safe integer.`);
		}

		DataTypeSizes[strDataTypeName] = unDataTypeSize;
	}

	return Object.freeze(DataTypeSizes);
}

const g_unAddressSize = RequireMemoryAddressSize();
const g_vecDataTypes = LoadHelpersRuntimeStrings("DATA_TYPES");
const g_vecCallingConventions = LoadHelpersRuntimeStrings("CALLING_CONVENTIONS");
const g_TypeSizes = LoadMemoryDataTypeSizes();

class KeyError extends Error {
	constructor(strErrorMessage) {
		super(strErrorMessage);
		this.name = "KeyError";
	}
}

function NormalizeDataType(strDataType) {
	if (typeof strDataType !== "string") {
		throw new TypeError("SourceJS memory data type must be a string.");
	}

	if (!Object.hasOwn(g_TypeSizes, strDataType)) {
		throw new TypeError(`Unknown SourceJS memory data type: ${strDataType}`);
	}

	return strDataType;
}

function GetPlatformDataKey(strPropertyName) {
	const strRuntimePlatform = g_MemoryManagerRuntime.PLATFORM;
	if ((typeof strRuntimePlatform !== "string") || (strRuntimePlatform.length === 0)) {
		throw new TypeError("memory/manager.PLATFORM is not a non-empty string.");
	}

	const strNormalizedPlatform = strRuntimePlatform.toLowerCase();
	if (strNormalizedPlatform === "windows") {
		return `${strPropertyName}Windows`;
	}

	if (strNormalizedPlatform === "linux") {
		return `${strPropertyName}Linux`;
	}

	throw new Error(`Unsupported SourceJS runtime platform: ${strRuntimePlatform}.`);
}

function GetDescriptorDataValue(DescriptorData, strPropertyName, DefaultValue) {
	if ((DescriptorData === null) || (typeof DescriptorData !== "object") || Array.isArray(DescriptorData)) {
		throw new TypeError("Descriptor data must be an object.");
	}

	const strPlatformDataKey = GetPlatformDataKey(strPropertyName);
	if (Object.hasOwn(DescriptorData, strPlatformDataKey)) {
		return DescriptorData[strPlatformDataKey];
	}

	if (Object.hasOwn(DescriptorData, strPropertyName)) {
		return DescriptorData[strPropertyName];
	}

	if (DefaultValue === g_NoDefault) {
		throw new KeyError(`Missing information for key "${strPropertyName}".`);
	}

	return DefaultValue;
}

function NormalizeParseDataDescriptor(vecDescriptorEntry) {
	if (!Array.isArray(vecDescriptorEntry)) {
		throw new TypeError("ParseData key descriptors must be arrays.");
	}

	const unDescriptorLength = vecDescriptorEntry.length;
	if ((unDescriptorLength < 2) || (unDescriptorLength > 3)) {
		throw new RangeError("ParseData key descriptors must contain two or three values.");
	}

	const strPropertyName = vecDescriptorEntry[0];
	const ValueConverter = vecDescriptorEntry[1];

	if ((typeof strPropertyName !== "string") || (strPropertyName.length === 0)) {
		throw new TypeError("ParseData descriptor property names must be non-empty strings.");
	}

	if (typeof ValueConverter !== "function") {
		throw new TypeError(`ParseData descriptor converter for "${strPropertyName}" must be a function.`);
	}

	return { PropertyName: strPropertyName, ValueConverter: ValueConverter, DefaultValue: (unDescriptorLength === 3) ? vecDescriptorEntry[2] : g_NoDefault };
}

function RequireArrayIndex(unArrayIndex, unArrayLength) {
	if (!Number.isSafeInteger(unArrayIndex) || (unArrayIndex < 0)) {
		throw new RangeError("Array indexes must be non-negative safe integers.");
	}

	if (unArrayLength !== null) {
		if (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0)) {
			throw new RangeError("Array lengths must be non-negative safe integers or null.");
		}

		if (unArrayIndex >= unArrayLength) {
			throw new RangeError(`Array index out of range: ${unArrayIndex}`);
		}
	}

	return unArrayIndex;
}

function Address(unAddress = 0n) {
	return g_HelpersRuntime.GetAddress(unAddress);
}

function IsNull(unAddress) {
	return g_HelpersRuntime.IsNull(unAddress);
}

function Add(unAddressValue, nAddressOffset) {
	return g_HelpersRuntime.Add(unAddressValue, nAddressOffset);
}

function Subtract(unAddressValue, nAddressOffset) {
	return g_HelpersRuntime.Subtract(unAddressValue, nAddressOffset);
}

function Difference(unLeftAddress, unRightAddress) {
	return g_HelpersRuntime.GetDifference(unLeftAddress, unRightAddress);
}

function Compare(unLeftAddress, unRightAddress, unByteCount) {
	return g_HelpersRuntime.Compare(unLeftAddress, unRightAddress, unByteCount);
}

function Copy(unSourceAddress, unDestinationAddress, unByteCount) {
	return g_HelpersRuntime.Copy(unSourceAddress, unDestinationAddress, unByteCount);
}

function Move(unSourceAddress, unDestinationAddress, unByteCount) {
	return g_HelpersRuntime.Move(unSourceAddress, unDestinationAddress, unByteCount);
}

function SearchBytes(unAddress, BytePattern, unByteCount) {
	return g_HelpersRuntime.SearchBytes(unAddress, BytePattern, unByteCount);
}

function SetProtection(unAddress, unByteCount, MemoryProtection) {
	return g_HelpersRuntime.SetProtection(unAddress, unByteCount, MemoryProtection);
}

function ReadAddress(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.ReadAddress(unAddress, nAddressOffset);
}

function Read(unAddress, strDataType = "address", nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, strDataType, nAddressOffset);
}

function Write(unAddress, strDataType, DataValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, strDataType, DataValue, nAddressOffset);
}

function WriteAddress(unAddress, unStoredAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "address", unStoredAddress, nAddressOffset);
}

function ReadBool(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, "bool", nAddressOffset);
}

function WriteBool(unAddress, bBooleanValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "bool", bBooleanValue, nAddressOffset);
}

function ReadInt(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, "int", nAddressOffset);
}

function WriteInt(unAddress, nSignedIntegerValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "int", nSignedIntegerValue, nAddressOffset);
}

function ReadUInt(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, "uint", nAddressOffset);
}

function WriteUInt(unAddress, unUnsignedIntegerValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "uint", unUnsignedIntegerValue, nAddressOffset);
}

function ReadFloat(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, "float", nAddressOffset);
}

function WriteFloat(unAddress, flFloatValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "float", flFloatValue, nAddressOffset);
}

function ReadDouble(unAddress, nAddressOffset = 0n) {
	return g_HelpersRuntime.Read(unAddress, "double", nAddressOffset);
}

function WriteDouble(unAddress, dblDoubleValue, nAddressOffset = 0n) {
	return g_HelpersRuntime.Write(unAddress, "double", dblDoubleValue, nAddressOffset);
}

function GetDataTypeSize(strDataType) {
	const strNormalizedDataType = NormalizeDataType(strDataType);

	return g_TypeSizes[strNormalizedDataType];
}

function VirtualTable(unAddress) {
	return g_HelpersRuntime.GetVirtualTable(unAddress);
}

function VirtualFunction(unAddress, unVirtualFunctionIndex) {
	return g_HelpersRuntime.GetVirtualFunction(unAddress, unVirtualFunctionIndex);
}

function NormalizeConvention(strCallingConvention) {
	if (typeof strCallingConvention !== "string") {
		throw new TypeError("SourceJS calling convention must be a string.");
	}

	if (!g_vecCallingConventions.includes(strCallingConvention)) {
		throw new TypeError(`Unknown SourceJS calling convention: ${strCallingConvention}`);
	}

	return strCallingConvention;
}

class Type {
	static NormalizeDataType(strTypeName) {
		return NormalizeDataType(strTypeName);
	}

	static IsNativeDataType(strTypeName) {
		if (typeof strTypeName !== "string") {
			throw new TypeError("SourceJS memory type names must be strings.");
		}

		return Object.hasOwn(g_TypeSizes, strTypeName);
	}

	static GetDataTypeSize(strTypeName) {
		return GetDataTypeSize(strTypeName);
	}
}

Object.defineProperties(Type, {
	Bool: { configurable: true, enumerable: true, value: "bool", writable: true },
	Char: { configurable: true, enumerable: true, value: "char", writable: true },
	UChar: { configurable: true, enumerable: true, value: "uchar", writable: true },
	Short: { configurable: true, enumerable: true, value: "short", writable: true },
	UShort: { configurable: true, enumerable: true, value: "ushort", writable: true },
	Int: { configurable: true, enumerable: true, value: "int", writable: true },
	UInt: { configurable: true, enumerable: true, value: "uint", writable: true },
	Long: { configurable: true, enumerable: true, value: "long", writable: true },
	ULong: { configurable: true, enumerable: true, value: "ulong", writable: true },
	LongLong: { configurable: true, enumerable: true, value: "longlong", writable: true },
	ULongLong: { configurable: true, enumerable: true, value: "ulonglong", writable: true },
	Float: { configurable: true, enumerable: true, value: "float", writable: true },
	Double: { configurable: true, enumerable: true, value: "double", writable: true },
	Address: { configurable: true, enumerable: true, value: "address", writable: true },
	StringAddress: { configurable: true, enumerable: true, value: "stringaddress", writable: true },
	StringArray: { configurable: true, enumerable: true, value: "stringarray", writable: true },
});

function CreateTypedCallValue(ArgumentValue, strDataTypeName) {
	if (!Type.IsNativeDataType(strDataTypeName)) {
		return ArgumentValue;
	}

	const strNormalizedDataType = Type.NormalizeDataType(strDataTypeName);
	switch (strNormalizedDataType) {
		case "string":
		case "stringaddress":
		case "stringarray":
			return { Type: "string", Value: ArgumentValue };

		default:
			return { Type: strNormalizedDataType, Value: ArgumentValue };
	}
}

function CreateTypedCallArguments(vecArgumentValues, vecArgumentTypes) {
	if (!Array.isArray(vecArgumentValues) || !Array.isArray(vecArgumentTypes)) {
		throw new TypeError("Typed call arguments and types must be arrays.");
	}

	const unArgumentCount = vecArgumentValues.length;
	if (vecArgumentTypes.length !== unArgumentCount) {
		throw new RangeError(`Typed call expected ${vecArgumentTypes.length} arguments but received ${unArgumentCount}.`);
	}

	const vecTypedArguments = [];
	for (let unArgumentIndex = 0; unArgumentIndex < unArgumentCount; unArgumentIndex += 1) {
		vecTypedArguments.push(CreateTypedCallValue(vecArgumentValues[unArgumentIndex], vecArgumentTypes[unArgumentIndex]));
	}

	return vecTypedArguments;
}

class DataKey {
	// Converter callbacks receive TypeManager first; retain that public position even when unused.
	static AsBoolean(TypeManager, BooleanValue) {
		if (typeof BooleanValue === "boolean") {
			return BooleanValue;
		}

		if (typeof BooleanValue !== "string") {
			throw new TypeError("SourceJS memory boolean values must be booleans or strings.");
		}

		const strNormalizedBooleanText = BooleanValue.toLowerCase();
		if (strNormalizedBooleanText === "true") {
			return true;
		}

		if (strNormalizedBooleanText === "false") {
			return false;
		}

		throw new TypeError(`Cannot convert "${BooleanValue}" to a boolean value.`);
	}

	static AsArguments(TypeManager, vecArgumentTypes) {
		if (!Array.isArray(vecArgumentTypes)) {
			throw new TypeError("SourceJS memory arguments must be an array.");
		}

		const vecNormalizedArgumentTypes = [];
		for (const strArgumentType of vecArgumentTypes) {
			vecNormalizedArgumentTypes.push(Type.NormalizeDataType(strArgumentType));
		}

		return vecNormalizedArgumentTypes;
	}

	static AsReturnType(TypeManager, strReturnTypeName) {
		if (strReturnTypeName === undefined) {
			return "void";
		}

		if ((typeof strReturnTypeName !== "string") || (strReturnTypeName.length === 0)) {
			throw new TypeError("SourceJS memory return type names must be non-empty strings or undefined.");
		}

		return Type.IsNativeDataType(strReturnTypeName) ? Type.NormalizeDataType(strReturnTypeName) : strReturnTypeName;
	}

	static AsIdentifier(TypeManager, FunctionIdentifier) {
		if (typeof FunctionIdentifier !== "string") {
			if ((typeof FunctionIdentifier !== "bigint") || (FunctionIdentifier < 0n)) {
				throw new TypeError("SourceJS function identifiers must be non-empty strings or non-negative BigInt addresses.");
			}

			return FunctionIdentifier;
		}

		if (FunctionIdentifier.length === 0) {
			throw new TypeError("SourceJS function identifiers must be non-empty strings or non-negative BigInt addresses.");
		}

		const strCompactIdentifier = FunctionIdentifier.replace(/\s+/g, "");
		if (/^(?:[0-9a-fA-F]{2})+$/.test(strCompactIdentifier) && FunctionIdentifier.includes(" ")) {
			return strCompactIdentifier.replace(/[0-9a-fA-F]{2}/g, "\\x$&");
		}

		return FunctionIdentifier;
	}

	static AsConvention(TypeManager, strCallingConvention) {
		return NormalizeConvention(strCallingConvention);
	}

	static AsAttributeType(TypeManager, strAttributeTypeName) {
		if ((typeof strAttributeTypeName !== "string") || (strAttributeTypeName.length === 0)) {
			throw new TypeError("SourceJS memory attribute type names must be non-empty strings.");
		}

		return Type.IsNativeDataType(strAttributeTypeName) ? Type.NormalizeDataType(strAttributeTypeName) : strAttributeTypeName;
	}

	static AsString(TypeManager, ExternalValue) {
		return String(ExternalValue);
	}

	static AsInteger(TypeManager, IntegerValue) {
		let nNormalizedInteger = 0;
		if (typeof IntegerValue === "number") {
			nNormalizedInteger = Math.trunc(IntegerValue);
		} else if (typeof IntegerValue === "bigint") {
			const nMinimumSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);
			const nMaximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
			if ((IntegerValue < nMinimumSafeInteger) || (IntegerValue > nMaximumSafeInteger)) {
				throw new RangeError("SourceJS memory integers must fit in the safe JavaScript integer range.");
			}

			nNormalizedInteger = Number(IntegerValue);
		} else if (typeof IntegerValue === "string") {
			const strIntegerText = IntegerValue.trim();
			const bIsHexadecimal = /^[+-]?0[xX][0-9a-fA-F]+$/.test(strIntegerText);
			const bIsDecimal = /^[+-]?[0-9]+$/.test(strIntegerText);
			if (!bIsHexadecimal && !bIsDecimal) {
				throw new TypeError(`Cannot convert "${IntegerValue}" to an integer.`);
			}

			nNormalizedInteger = Number.parseInt(strIntegerText, bIsHexadecimal ? 16 : 10);
		} else {
			throw new TypeError("SourceJS memory integers must be numbers, bigints, or strings.");
		}

		if (!Number.isSafeInteger(nNormalizedInteger)) {
			throw new RangeError("SourceJS memory integers must resolve to safe JavaScript integers.");
		}

		return nNormalizedInteger;
	}

	static AsInt64(TypeManager, IntegerValue) {
		let nNormalizedInteger = 0n;
		if (typeof IntegerValue === "bigint") {
			nNormalizedInteger = IntegerValue;
		} else if (typeof IntegerValue === "number") {
			if (!Number.isSafeInteger(IntegerValue)) {
				throw new RangeError("SourceJS int64 values supplied as numbers must be safe integers.");
			}

			nNormalizedInteger = BigInt(IntegerValue);
		} else if (typeof IntegerValue === "string") {
			const strIntegerText = IntegerValue.trim();
			const bIsHexadecimal = /^[+-]?0[xX][0-9a-fA-F]+$/.test(strIntegerText);
			const bIsDecimal = /^[+-]?[0-9]+$/.test(strIntegerText);
			if (!bIsHexadecimal && !bIsDecimal) {
				throw new TypeError(`Cannot convert "${IntegerValue}" to an int64 value.`);
			}

			const bIsNegative = strIntegerText.startsWith("-");
			const strSignlessIntegerText = strIntegerText.replace(/^[+-]/, "");
			const unIntegerMagnitude = BigInt(strSignlessIntegerText);
			nNormalizedInteger = bIsNegative ? -unIntegerMagnitude : unIntegerMagnitude;
		} else {
			throw new TypeError("SourceJS int64 values must be numbers, bigints, or strings.");
		}

		const nMinimumInt64Value = -(1n << 63n);
		const nMaximumInt64Value = (1n << 63n) - 1n;
		if ((nNormalizedInteger < nMinimumInt64Value) || (nNormalizedInteger > nMaximumInt64Value)) {
			throw new RangeError("SourceJS int64 values must fit the signed 64-bit range.");
		}

		return nNormalizedInteger;
	}
}

Object.defineProperties(DataKey, {
	Binary: { value: "Binary", writable: true, enumerable: true, configurable: true },
	ServerCheck: { value: "ServerCheck", writable: true, enumerable: true, configurable: true },
	Size: { value: "Size", writable: true, enumerable: true, configurable: true },
	Offset: { value: "Offset", writable: true, enumerable: true, configurable: true },
	TypeName: { value: "TypeName", writable: true, enumerable: true, configurable: true },
	Length: { value: "Length", writable: true, enumerable: true, configurable: true },
	Level: { value: "Level", writable: true, enumerable: true, configurable: true },
	Accessor: { value: "Accessor", writable: true, enumerable: true, configurable: true },
	AccessorOffset: { value: "AccessorOffset", writable: true, enumerable: true, configurable: true },
	Arguments: { value: "Arguments", writable: true, enumerable: true, configurable: true },
	ReturnType: { value: "ReturnType", writable: true, enumerable: true, configurable: true },
	Convention: { value: "Convention", writable: true, enumerable: true, configurable: true },
	Identifier: { value: "Identifier", writable: true, enumerable: true, configurable: true },
	Documentation: { value: "Documentation", writable: true, enumerable: true, configurable: true },
});

class BaseAddress {
	constructor(unAddress = 0n) {
		BaseAddress.RebindAddress(this, unAddress);
	}

	static RebindAddress(AddressValue, unAddress) {
		AddressValue.#m_unAddress = Address(unAddress);
	}

	HasAddress() {
		return !IsNull(this.#m_unAddress);
	}

	Add(nAddressOffset) {
		return new this.constructor(Add(this.#m_unAddress, nAddressOffset));
	}

	Subtract(nAddressOffset) {
		return new this.constructor(Subtract(this.#m_unAddress, nAddressOffset));
	}

	Read(strDataType = "address", nAddressOffset = 0n) {
		return g_HelpersRuntime.Read(this.#m_unAddress, strDataType, nAddressOffset);
	}

	Write(strDataType, DataValue, nAddressOffset = 0n) {
		return g_HelpersRuntime.Write(this.#m_unAddress, strDataType, DataValue, nAddressOffset);
	}

	ReadAddress(nAddressOffset = 0n) {
		return g_HelpersRuntime.ReadAddress(this.#m_unAddress, nAddressOffset);
	}

	WriteAddress(unStoredAddress, nAddressOffset = 0n) {
		return g_HelpersRuntime.Write(this.#m_unAddress, "address", unStoredAddress, nAddressOffset);
	}

	valueOf() {
		return this.#m_unAddress;
	}

	toString() {
		return `0x${this.#m_unAddress.toString(16)}`;
	}

	get Address() {
		return this.#m_unAddress;
	}

	get Null() {
		return IsNull(this.#m_unAddress);
	}

	#m_unAddress;
}

function GetArrayElementByteCount(TypeManager, bIsAddressArray, strArrayTypeName) {
	if (typeof bIsAddressArray !== "boolean") {
		throw new TypeError("ArrayView address-array value must be a boolean.");
	}

	if ((typeof strArrayTypeName !== "string") || (strArrayTypeName.length === 0)) {
		throw new TypeError("ArrayView strArrayTypeName must be a non-empty string.");
	}

	if (bIsAddressArray) {
		return g_unAddressSize;
	}

	if (Type.IsNativeDataType(strArrayTypeName)) {
		return Type.GetDataTypeSize(strArrayTypeName);
	}

	if ((TypeManager === null) || ((typeof TypeManager !== "object") && (typeof TypeManager !== "function"))) {
		throw new TypeError("ArrayView custom types require a type manager.");
	}

	const GetClass = TypeManager.GetClass;
	if (typeof GetClass !== "function") {
		throw new TypeError("ArrayView type manager must provide GetClass().");
	}

	const CustomTypeConstructor = GetClass.call(TypeManager, strArrayTypeName);
	if ((CustomTypeConstructor === null) || (CustomTypeConstructor === undefined)) {
		throw new ReferenceError(`Unknown class "${strArrayTypeName}".`);
	}

	if (typeof CustomTypeConstructor !== "function") {
		throw new TypeError(`ArrayView class "${strArrayTypeName}" is not a constructor.`);
	}

	const unTypeByteCount = CustomTypeConstructor.TypeSize;
	if (!Number.isSafeInteger(unTypeByteCount) || (unTypeByteCount <= 0)) {
		throw new TypeError("ArrayView custom TypeSize must be a positive safe integer.");
	}

	return unTypeByteCount;
}

function GetArrayElementAddressOffset(unArrayIndex, unArrayLength, TypeManager, bIsAddressArray, strArrayTypeName) {
	const unValidatedArrayIndex = RequireArrayIndex(unArrayIndex, unArrayLength);
	const unTypeByteCount = GetArrayElementByteCount(TypeManager, bIsAddressArray, strArrayTypeName);
	const unAddressOffset = BigInt(unValidatedArrayIndex) * BigInt(unTypeByteCount);

	return unAddressOffset;
}

function RequireArrayLength(unArrayLength, strArrayOperationName) {
	if (unArrayLength === null) {
		throw new TypeError(`Cannot ${strArrayOperationName} an ArrayView without a length.`);
	}

	if (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0)) {
		throw new RangeError("ArrayView length must be a non-negative safe integer or null.");
	}

	return unArrayLength;
}

function ConvertArrayElementAddress(TypeManager, strArrayTypeName, unAddressValue) {
	if ((TypeManager === null) || ((typeof TypeManager !== "object") && (typeof TypeManager !== "function"))) {
		throw new TypeError("ArrayView custom types require a type manager.");
	}

	const Convert = TypeManager.Convert;
	if (typeof Convert !== "function") {
		throw new TypeError("ArrayView type manager must provide Convert().");
	}

	return Convert.call(TypeManager, strArrayTypeName, unAddressValue);
}

function AllocateArrayElementAddress(unArrayAddress, unAddressOffset, strArrayTypeName, setAllocatedAddresses) {
	if (!(setAllocatedAddresses instanceof Set)) {
		throw new TypeError("Address-array auto-allocation requires an owning CustomType.");
	}

	const unAllocatedAddress = g_MemoryRuntime.Allocate(Type.GetDataTypeSize(strArrayTypeName));
	let bAddressTracked = false;

	try {
		Set.prototype.add.call(setAllocatedAddresses, unAllocatedAddress);
		bAddressTracked = true;

		const bAddressWriteResult = Write(unArrayAddress, "address", unAllocatedAddress, unAddressOffset);
		if (bAddressWriteResult !== true) {
			throw new Error("ArrayView could not store its allocated element address.");
		}

		return unAllocatedAddress;
	} catch (AllocationError) {
		const vecAllocationCleanupErrors = [];
		let bAddressDeallocated = false;

		try {
			const bDeallocationResult = g_MemoryRuntime.Deallocate(unAllocatedAddress);
			if (bDeallocationResult === true) {
				bAddressDeallocated = true;
			} else {
				vecAllocationCleanupErrors.push(new Error("ArrayView could not release its failed element allocation."));
			}
		} catch (DeallocationError) {
			vecAllocationCleanupErrors.push(DeallocationError);
		}

		if (bAddressTracked && bAddressDeallocated) {
			try {
				if (!Set.prototype.delete.call(setAllocatedAddresses, unAllocatedAddress)) {
					vecAllocationCleanupErrors.push(new Error("ArrayView could not remove its released element address."));
				}
			} catch (RemovalError) {
				vecAllocationCleanupErrors.push(RemovalError);
			}
		}

		if (vecAllocationCleanupErrors.length > 0) {
			vecAllocationCleanupErrors.unshift(AllocationError);
			throw new AggregateError(vecAllocationCleanupErrors, "Could not roll back ArrayView element allocation.");
		}

		throw AllocationError;
	}
}

function StoreCustomArrayElementAddress(unArrayAddress, unAddressOffset, ElementValue, mapAddressValues) {
	if (!(mapAddressValues instanceof Map)) {
		throw new TypeError("Custom address arrays require an owning address-value map.");
	}

	if ((ElementValue === null) || ((typeof ElementValue !== "object") && (typeof ElementValue !== "function"))) {
		throw new TypeError("Custom address-array values must be address-backed objects.");
	}

	const unElementAddress = Address(ElementValue.Address);
	const unAddressSlot = Add(unArrayAddress, unAddressOffset);
	const bPreviousAddressValueExists = Map.prototype.has.call(mapAddressValues, unAddressSlot);
	const PreviousAddressValue = bPreviousAddressValueExists ? Map.prototype.get.call(mapAddressValues, unAddressSlot) : undefined;
	let bAddressValueRetentionChanged = false;

	try {
		Map.prototype.set.call(mapAddressValues, unAddressSlot, ElementValue);
		bAddressValueRetentionChanged = true;

		const bAddressWriteResult = Write(unArrayAddress, "address", unElementAddress, unAddressOffset);
		if (bAddressWriteResult !== true) {
			throw new Error("ArrayView could not store its custom element address.");
		}
	} catch (AddressWriteError) {
		if (bAddressValueRetentionChanged) {
			try {
				if (bPreviousAddressValueExists) {
					Map.prototype.set.call(mapAddressValues, unAddressSlot, PreviousAddressValue);
				} else if (!Map.prototype.delete.call(mapAddressValues, unAddressSlot)) {
					throw new Error("ArrayView could not remove its failed address-value retention.");
				}
			} catch (RetentionRestorationError) {
				throw new AggregateError([AddressWriteError, RetentionRestorationError], "Could not restore ArrayView address-value retention.");
			}
		}

		throw AddressWriteError;
	}
}

class ArrayView extends BaseAddress {
	constructor(TypeManager, bIsAddressArray, strTypeName, unAddressValue, unArrayLength = null, setAllocatedAddresses = null, mapAddressValues = new Map()) {
		if (typeof bIsAddressArray !== "boolean") {
			throw new TypeError("ArrayView bIsAddressArray must be a boolean.");
		}

		if ((typeof strTypeName !== "string") || (strTypeName.length === 0)) {
			throw new TypeError("ArrayView strTypeName must be a non-empty string.");
		}

		if ((unArrayLength !== null) && (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0))) {
			throw new RangeError("ArrayView unArrayLength must be a non-negative safe integer or null.");
		}

		if ((setAllocatedAddresses !== null) && !(setAllocatedAddresses instanceof Set)) {
			throw new TypeError("ArrayView setAllocatedAddresses must be a Set or null.");
		}

		if (!(mapAddressValues instanceof Map)) {
			throw new TypeError("ArrayView mapAddressValues must be a Map.");
		}

		super(unAddressValue);
		this.#m_TypeManager = TypeManager;
		this.#m_bAddressArray = bIsAddressArray;
		this.#m_strTypeName = strTypeName;
		this.#m_unLength = unArrayLength;
		this.#m_setAllocatedAddresses = setAllocatedAddresses;
		this.#m_mapAddressValues = mapAddressValues;
	}

	GetOffset(unArrayIndex) {
		return GetArrayElementAddressOffset(unArrayIndex, this.#m_unLength, this.#m_TypeManager, this.#m_bAddressArray, this.#m_strTypeName);
	}

	At(unArrayIndex) {
		const TypeManager = this.#m_TypeManager;
		const bIsAddressArray = this.#m_bAddressArray;
		const strArrayTypeName = this.#m_strTypeName;
		const unArrayLength = this.#m_unLength;
		const unArrayAddress = super.Address;
		const unAddressOffset = GetArrayElementAddressOffset(unArrayIndex, unArrayLength, TypeManager, bIsAddressArray, strArrayTypeName);
		const bIsNativeType = Type.IsNativeDataType(strArrayTypeName);

		if (bIsAddressArray) {
			const unTargetAddress = ReadAddress(unArrayAddress, unAddressOffset);
			if (bIsNativeType) {
				return Read(unTargetAddress, Type.NormalizeDataType(strArrayTypeName));
			}

			return ConvertArrayElementAddress(TypeManager, strArrayTypeName, unTargetAddress);
		}

		if (bIsNativeType) {
			return Read(unArrayAddress, Type.NormalizeDataType(strArrayTypeName), unAddressOffset);
		}

		const unElementAddress = Add(unArrayAddress, unAddressOffset);

		return ConvertArrayElementAddress(TypeManager, strArrayTypeName, unElementAddress);
	}

	Set(unArrayIndex, ElementValue) {
		const TypeManager = this.#m_TypeManager;
		const bIsAddressArray = this.#m_bAddressArray;
		const strArrayTypeName = this.#m_strTypeName;
		const unArrayLength = this.#m_unLength;
		const unArrayAddress = super.Address;
		const unAddressOffset = GetArrayElementAddressOffset(unArrayIndex, unArrayLength, TypeManager, bIsAddressArray, strArrayTypeName);
		const bIsNativeType = Type.IsNativeDataType(strArrayTypeName);

		if (bIsAddressArray) {
			if (bIsNativeType) {
				let unTargetAddress = ReadAddress(unArrayAddress, unAddressOffset);
				if (IsNull(unTargetAddress)) {
					const setAllocatedAddresses = this.#m_setAllocatedAddresses;
					unTargetAddress = AllocateArrayElementAddress(unArrayAddress, unAddressOffset, strArrayTypeName, setAllocatedAddresses);
				}

				Write(unTargetAddress, Type.NormalizeDataType(strArrayTypeName), ElementValue);
				return this;
			}

			const mapAddressValues = this.#m_mapAddressValues;
			StoreCustomArrayElementAddress(unArrayAddress, unAddressOffset, ElementValue, mapAddressValues);
			return this;
		}

		if (bIsNativeType) {
			Write(unArrayAddress, Type.NormalizeDataType(strArrayTypeName), ElementValue, unAddressOffset);
			return this;
		}

		const unElementAddress = Add(unArrayAddress, unAddressOffset);
		g_MemoryRuntime.CopyObjectToAddress(ElementValue, unElementAddress, strArrayTypeName);

		return this;
	}

	Add(nAddressOffset) {
		const TypeManager = this.#m_TypeManager;
		const bIsAddressArray = this.#m_bAddressArray;
		const strArrayTypeName = this.#m_strTypeName;
		const unArrayLength = this.#m_unLength;
		const setAllocatedAddresses = this.#m_setAllocatedAddresses;
		const mapAddressValues = this.#m_mapAddressValues;
		const unAddressValue = Add(super.Address, nAddressOffset);

		return new ArrayView(TypeManager, bIsAddressArray, strArrayTypeName, unAddressValue, unArrayLength, setAllocatedAddresses, mapAddressValues);
	}

	Subtract(nAddressOffset) {
		const TypeManager = this.#m_TypeManager;
		const bIsAddressArray = this.#m_bAddressArray;
		const strArrayTypeName = this.#m_strTypeName;
		const unArrayLength = this.#m_unLength;
		const setAllocatedAddresses = this.#m_setAllocatedAddresses;
		const mapAddressValues = this.#m_mapAddressValues;
		const unAddressValue = Subtract(super.Address, nAddressOffset);

		return new ArrayView(TypeManager, bIsAddressArray, strArrayTypeName, unAddressValue, unArrayLength, setAllocatedAddresses, mapAddressValues);
	}

	ToArray() {
		const unArrayLength = RequireArrayLength(this.#m_unLength, "convert");
		const ArrayElementReader = this.At;
		if (typeof ArrayElementReader !== "function") {
			throw new TypeError("ArrayView.At must be a function.");
		}

		const vecArrayValues = [];
		for (let unArrayIndex = 0; unArrayIndex < unArrayLength; unArrayIndex += 1) {
			vecArrayValues.push(ArrayElementReader.call(this, unArrayIndex));
		}

		return vecArrayValues;
	}

	// Iterator protocol member names and result keys retain their exact ECMAScript spelling.
	Keys() {
		RequireArrayLength(this.#m_unLength, "iterate over");

		const ThisArrayView = this;
		let unArrayIndex = 0;
		let bIterationComplete = false;

		return {
			next() {
				if (bIterationComplete) {
					return { done: true, value: undefined };
				}

				const unArrayLength = RequireArrayLength(ThisArrayView.#m_unLength, "iterate over");
				if (unArrayIndex >= unArrayLength) {
					bIterationComplete = true;
					return { done: true, value: undefined };
				}

				const unCurrentArrayIndex = unArrayIndex;
				unArrayIndex += 1;

				return { done: false, value: unCurrentArrayIndex };
			},
			[Symbol.iterator]() {
				return this;
			},
		};
	}

	Values() {
		return this[Symbol.iterator]();
	}

	Entries() {
		RequireArrayLength(this.#m_unLength, "iterate over");

		const ThisArrayView = this;
		let unArrayIndex = 0;
		let bIterationComplete = false;

		return {
			next() {
				if (bIterationComplete) {
					return { done: true, value: undefined };
				}

				const unArrayLength = RequireArrayLength(ThisArrayView.#m_unLength, "iterate over");
				if (unArrayIndex >= unArrayLength) {
					bIterationComplete = true;
					return { done: true, value: undefined };
				}

				const unCurrentArrayIndex = unArrayIndex;
				const ElementValue = ThisArrayView.At(unCurrentArrayIndex);
				unArrayIndex += 1;

				return { done: false, value: [unCurrentArrayIndex, ElementValue] };
			},
			[Symbol.iterator]() {
				return this;
			},
		};
	}

	ForEach(Callback, ThisArgument = undefined) {
		if (typeof Callback !== "function") {
			throw new TypeError("ArrayView.ForEach expects a callback.");
		}

		for (const [unArrayIndex, ElementValue] of this.Entries()) {
			Callback.call(ThisArgument, ElementValue, unArrayIndex, this);
		}
	}

	[Symbol.iterator]() {
		RequireArrayLength(this.#m_unLength, "iterate over");

		const ThisArrayView = this;
		let unArrayIndex = 0;
		let bIterationComplete = false;

		return {
			next() {
				if (bIterationComplete) {
					return { done: true, value: undefined };
				}

				const unArrayLength = RequireArrayLength(ThisArrayView.#m_unLength, "iterate over");
				if (unArrayIndex >= unArrayLength) {
					bIterationComplete = true;
					return { done: true, value: undefined };
				}

				const ElementValue = ThisArrayView.At(unArrayIndex);
				unArrayIndex += 1;

				return { done: false, value: ElementValue };
			},
			[Symbol.iterator]() {
				return this;
			},
		};
	}

	get TypeManager() {
		return this.#m_TypeManager;
	}

	get AddressArray() {
		return this.#m_bAddressArray;
	}

	get TypeName() {
		return this.#m_strTypeName;
	}

	get Length() {
		return this.#m_unLength;
	}

	get AllocatedAddresses() {
		return this.#m_setAllocatedAddresses;
	}

	get AddressValues() {
		return this.#m_mapAddressValues;
	}

	#m_TypeManager;
	#m_bAddressArray;
	#m_strTypeName;
	#m_unLength;
	#m_setAllocatedAddresses;
	#m_mapAddressValues;
}

function NormalizeMemberFunctionReturnType(strReturnType) {
	if ((typeof strReturnType !== "string") || (strReturnType.length === 0)) {
		throw new TypeError("MemberFunction strReturnType must be a non-empty string.");
	}

	const strNormalizedReturnType = strReturnType.toLowerCase();

	return g_vecDataTypes.includes(strNormalizedReturnType) ? strNormalizedReturnType : strReturnType;
}

function NormalizeMemberFunctionArgumentTypes(vecArgumentTypes) {
	if (!Array.isArray(vecArgumentTypes)) {
		throw new TypeError("MemberFunction vecArgumentTypes must be an array.");
	}

	const vecNormalizedArgumentTypes = [];
	for (const strArgumentType of vecArgumentTypes) {
		if ((typeof strArgumentType !== "string") || (strArgumentType.length === 0)) {
			throw new TypeError("MemberFunction argument types must be non-empty strings.");
		}

		const strNormalizedArgumentType = strArgumentType.toLowerCase();
		if (strNormalizedArgumentType === "void") {
			throw new TypeError("MemberFunction arguments cannot use the void type.");
		}

		vecNormalizedArgumentTypes.push(g_vecDataTypes.includes(strNormalizedArgumentType) ? strNormalizedArgumentType : strArgumentType);
	}

	return vecNormalizedArgumentTypes;
}

function GetMemberFunctionReturnConverter(TypeManager) {
	if ((TypeManager === null) || ((typeof TypeManager !== "object") && (typeof TypeManager !== "function"))) {
		throw new TypeError("MemberFunction custom return types require a type manager.");
	}

	const Convert = TypeManager.Convert;
	if (typeof Convert !== "function") {
		throw new TypeError("MemberFunction type manager must provide Convert().");
	}

	return Convert;
}

class MemberFunction {
	constructor(TypeManager, strReturnType, unFunctionAddress, ThisObject, vecArgumentTypes = [], strConvention = "thiscall") {
		const strNormalizedReturnType = NormalizeMemberFunctionReturnType(strReturnType);
		const unNormalizedFunctionAddress = Address(unFunctionAddress);
		const strNormalizedConvention = NormalizeConvention(strConvention);
		NormalizeMemberFunctionArgumentTypes(vecArgumentTypes);

		this.#m_TypeManager = TypeManager;
		this.#m_strReturnType = strNormalizedReturnType;
		this.#m_unFunctionAddress = unNormalizedFunctionAddress;
		this.#m_ThisObject = ThisObject;
		this.#m_vecArgumentTypes = vecArgumentTypes;
		this.#m_strConvention = strNormalizedConvention;
	}

	Call(...vecArgumentValues) {
		const strReturnType = NormalizeMemberFunctionReturnType(this.#m_strReturnType);
		const unFunctionAddress = Address(this.#m_unFunctionAddress);
		const ThisObject = this.#m_ThisObject;
		const vecArgumentTypes = NormalizeMemberFunctionArgumentTypes(this.#m_vecArgumentTypes);
		const strConvention = NormalizeConvention(this.#m_strConvention);
		const bCustomReturnType = !g_vecDataTypes.includes(strReturnType);
		const strNativeReturnType = bCustomReturnType ? "address" : strReturnType;
		const TypeManager = bCustomReturnType ? this.#m_TypeManager : null;
		const ReturnConverter = bCustomReturnType ? GetMemberFunctionReturnConverter(TypeManager) : null;
		const vecTypedArguments = CreateTypedCallArguments(vecArgumentValues, vecArgumentTypes);
		const FunctionResult = g_MemoryHooksRuntime.CallFunction({ Address: unFunctionAddress, Convention: strConvention, ReturnType: strNativeReturnType, ThisObject, Arguments: vecTypedArguments });
		if (bCustomReturnType) {
			return ReturnConverter.call(TypeManager, strReturnType, FunctionResult);
		}

		return FunctionResult;
	}

	get TypeManager() {
		return this.#m_TypeManager;
	}

	set TypeManager(TypeManager) {
		this.#m_TypeManager = TypeManager;
	}

	get ReturnType() {
		return this.#m_strReturnType;
	}

	set ReturnType(strReturnType) {
		this.#m_strReturnType = NormalizeMemberFunctionReturnType(strReturnType);
	}

	get FunctionAddress() {
		return this.#m_unFunctionAddress;
	}

	set FunctionAddress(unFunctionAddress) {
		this.#m_unFunctionAddress = Address(unFunctionAddress);
	}

	get ThisObject() {
		return this.#m_ThisObject;
	}

	set ThisObject(ThisObject) {
		this.#m_ThisObject = ThisObject;
	}

	get ArgumentTypes() {
		return this.#m_vecArgumentTypes;
	}

	set ArgumentTypes(vecArgumentTypes) {
		NormalizeMemberFunctionArgumentTypes(vecArgumentTypes);
		this.#m_vecArgumentTypes = vecArgumentTypes;
	}

	get Convention() {
		return this.#m_strConvention;
	}

	set Convention(strConvention) {
		this.#m_strConvention = NormalizeConvention(strConvention);
	}

	#m_TypeManager;
	#m_strReturnType;
	#m_unFunctionAddress;
	#m_ThisObject;
	#m_vecArgumentTypes;
	#m_strConvention;
}

function* IterateParsedData(TypeManager, Definitions, vecDescriptors) {
	for (const strDefinitionName in Definitions) {
		if (!Object.hasOwn(Definitions, strDefinitionName)) {
			continue;
		}

		const DefinitionData = Definitions[strDefinitionName];
		const vecConstructorArguments = [];
		for (const Descriptor of vecDescriptors) {
			const DescriptorValue = GetDescriptorDataValue(DefinitionData, Descriptor.PropertyName, Descriptor.DefaultValue);
			const ConvertedValue = Object.is(DescriptorValue, Descriptor.DefaultValue) ? DescriptorValue : Descriptor.ValueConverter(TypeManager, DescriptorValue);
			vecConstructorArguments.push(ConvertedValue);
		}

		yield [strDefinitionName, vecConstructorArguments];
	}
}

function ParseData(TypeManager, Definitions, vecKeyDescriptors) {
	if ((Definitions === null) || (typeof Definitions !== "object") || Array.isArray(Definitions)) {
		throw new TypeError("ParseData Definitions must be an object.");
	}

	if (!Array.isArray(vecKeyDescriptors)) {
		throw new TypeError("ParseData vecKeyDescriptors must be an array.");
	}

	const vecDescriptors = [];
	for (const vecDescriptorEntry of vecKeyDescriptors) {
		vecDescriptors.push(NormalizeParseDataDescriptor(vecDescriptorEntry));
	}

	return IterateParsedData(TypeManager, Definitions, vecDescriptors);
}

module.exports = {
	ArrayView,
	BaseAddress,
	CALLING_CONVENTIONS: g_vecCallingConventions,
	DataKey,
	DATA_TYPES: g_vecDataTypes,
	KeyError,
	MemberFunction,
	NO_DEFAULT: g_NoDefault,
	ADDRESS_SIZE: g_unAddressSize,
	Type,
	TYPE_SIZES: g_TypeSizes,
	Add,
	Compare,
	Copy,
	GetDataTypeSize,
	Difference,
	IsNull,
	Move,
	NormalizeConvention,
	NormalizeDataType,
	ParseData,
	Address,
	Read,
	ReadBool,
	ReadDouble,
	ReadFloat,
	ReadInt,
	ReadAddress,
	ReadUInt,
	SearchBytes,
	SetProtection,
	Subtract,
	VirtualFunction,
	VirtualTable,
	Write,
	WriteBool,
	WriteDouble,
	WriteFloat,
	WriteInt,
	WriteAddress,
	WriteUInt,
};
