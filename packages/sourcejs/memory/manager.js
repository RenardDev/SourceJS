"use strict";

const { GetRawModule } = require("internal/runtime");
const {
	Allocate,
	Deallocate,
	GetObjectAddress,
	MakeObject,
	ObjectType,
	RegisterObjectType,
} = require("memory");
const g_SourceGameDataRuntime = require("memory/gamedata");
const {
	Add,
	ArrayView,
	BaseAddress,
	Copy,
	DataKey,
	IsNull,
	MemberFunction,
	NO_DEFAULT,
	NormalizeConvention,
	ParseData,
	Read,
	ReadAddress,
	Subtract,
	Type,
	VirtualFunction,
	Write,
} = require("memory/helpers");
const { KeyValues } = require("keyvalues");

const g_vecTypeMetadataPropertyNames = Object.freeze([
	"Binary",
	"ServerCheck",
	"TypeSize",
	"ClassInfo",
	"ConstructorCallback",
	"DestructorCallback",
]);
const g_WrappedAddressConstruction = Symbol("wrappedAddressConstruction");

const g_MemoryManagerRuntime = GetRawModule("memory/manager");
const g_MemoryHooksRuntime = GetRawModule("memory/hooks");
const g_FilesystemRuntime = GetRawModule("filesystem");
// Capture native operations before publishing the JavaScript facade on the same runtime module.
const g_NativeGetBinary = g_MemoryManagerRuntime.GetBinary;
const g_NativeGetAllBinaries = g_MemoryManagerRuntime.GetAllBinaries;
const g_NativeGetAllGameDataFiles = g_MemoryManagerRuntime.GetAllGameDataFiles;
const g_NativeGetBinarySymbol = g_MemoryManagerRuntime.GetBinarySymbol;
const g_NativeScanBinary = g_MemoryManagerRuntime.ScanBinary;

const g_strArchitecture = g_MemoryManagerRuntime.ARCHITECTURE;
const g_strBranch = g_MemoryManagerRuntime.BRANCH;
const g_strDataRoot = g_MemoryManagerRuntime.DATA_ROOT;
const g_strPlatform = g_MemoryManagerRuntime.PLATFORM;
const g_strRoot = g_MemoryManagerRuntime.ROOT;
const g_strSourceModGameDataRoot = g_MemoryManagerRuntime.SOURCE_MOD_GAME_DATA_ROOT;

function SelectRuntimeValue(RuntimeValue) {
	if ((RuntimeValue === null) || (typeof RuntimeValue !== "object") || Array.isArray(RuntimeValue)) {
		return RuntimeValue;
	}

	const strPlatformArchitecture = `${g_strPlatform}${(g_strArchitecture === "x64") ? "64" : ""}`;
	for (const strRuntimeKey of [g_strBranch, strPlatformArchitecture, g_strPlatform, g_strArchitecture]) {
		if (Object.hasOwn(RuntimeValue, strRuntimeKey)) {
			return SelectRuntimeValue(RuntimeValue[strRuntimeKey]);
		}
	}

	return RuntimeValue;
}

function ReadGameDataText(strFilePath) {
	if (typeof g_FilesystemRuntime.ReadTextFile !== "function") {
		throw new Error("filesystem.ReadTextFile is not available.");
	}

	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("GameData file paths must be non-empty strings.");
	}

	// Preserve native rooted/drive-qualified paths; resolve ordinary relative paths from the shared root.
	const bHasRootedPath = strFilePath.startsWith("/") || ((g_strPlatform === "windows") && /^(?:[A-Za-z]:|\\)/.test(strFilePath));
	if (!bHasRootedPath && g_strSourceModGameDataRoot && strFilePath.toLowerCase().endsWith(".txt")) {
		const strRelativePath = (g_strPlatform === "windows") ? strFilePath.replace(/\\/g, "/") : strFilePath;
		const HasUnsafeComponent = (strComponent) => (strComponent.length === 0) || (strComponent === ".") || (strComponent === "..") || /[:\\\0]/.test(strComponent);
		if (!strRelativePath.split("/").some(HasUnsafeComponent)) {
			const strSnapshotFilePath = `${g_strSourceModGameDataRoot}/${strRelativePath}`;
			if (g_FilesystemRuntime.DoesFileExist(strSnapshotFilePath)) {
				return g_FilesystemRuntime.ReadTextFile(strSnapshotFilePath);
			}
		}
	}

	const strResolvedFilePath = bHasRootedPath ? strFilePath : `${g_strDataRoot}/${strFilePath}`;

	return g_FilesystemRuntime.ReadTextFile(strResolvedFilePath);
}

function StripSourceModComments(strFileText) {
	const strText = (strFileText.charCodeAt(0) === 0xFEFF) ? strFileText.slice(1) : strFileText;
	const vecCharacters = [];
	let bInQuotedString = false;
	let bInLineComment = false;
	let bInBlockComment = false;

	for (let unCharacterIndex = 0; unCharacterIndex < strText.length; unCharacterIndex++) {
		const strCharacter = strText[unCharacterIndex];
		const strNextCharacter = strText[unCharacterIndex + 1] ?? "";

		if (bInLineComment) {
			if ((strCharacter === "\r") || (strCharacter === "\n")) {
				bInLineComment = false;
				vecCharacters.push(strCharacter);
			} else {
				vecCharacters.push(" ");
			}

			continue;
		}

		if (bInBlockComment) {
			if ((strCharacter === "*") && (strNextCharacter === "/")) {
				vecCharacters.push(" ", " ");
				unCharacterIndex++;
				bInBlockComment = false;
			} else {
				vecCharacters.push(((strCharacter === "\r") || (strCharacter === "\n")) ? strCharacter : " ");
			}

			continue;
		}

		if (bInQuotedString) {
			vecCharacters.push(strCharacter);

			// Match KeyValues with escape decoding disabled: backslashes are literal, not quote escapes.
			if (strCharacter === "\"") {
				bInQuotedString = false;
			}

			continue;
		}

		if (strCharacter === "\"") {
			bInQuotedString = true;
			vecCharacters.push(strCharacter);
			continue;
		}

		if ((strCharacter === "/") && (strNextCharacter === "/")) {
			bInLineComment = true;
			vecCharacters.push(" ", " ");
			unCharacterIndex++;
			continue;
		}

		if ((strCharacter === "/") && (strNextCharacter === "*")) {
			bInBlockComment = true;
			vecCharacters.push(" ", " ");
			unCharacterIndex++;
			continue;
		}

		if (strCharacter === ";") {
			bInLineComment = true;
			vecCharacters.push(" ");
			continue;
		}

		vecCharacters.push(strCharacter);
	}

	if (bInBlockComment) {
		throw new SyntaxError("SourceMod GameData contains an unterminated block comment.");
	}

	if (bInQuotedString) {
		throw new SyntaxError("SourceMod GameData contains an unterminated quoted string.");
	}

	return vecCharacters.join("");
}

function FoldSourceModKeyName(strName) {
	return strName.replace(/[A-Z]/g, (strCharacter) => strCharacter.toLowerCase());
}

function ReadSourceModKeyNames(strText) {
	// Keep the native parser authoritative for extensions such as includes and conditionals.
	const vecTokens = strText.match(/"[^"]*"|[{}]|[^ \t\r\n\v\f{}"]+/g) ?? [];
	const GetText = (strToken) => strToken.startsWith("\"") ? strToken.slice(1, -1) : strToken;
	const IsText = (strToken) => (typeof strToken === "string") && (strToken !== "{") && (strToken !== "}") && !/^(?:#include$|#base$|\[)/i.test(strToken);
	if (!IsText(vecTokens[0]) || (vecTokens[1] !== "{")) {
		return null;
	}

	const Root = { Name: GetText(vecTokens[0]), Children: [] };
	const vecParents = [Root];
	let unTokenIndex = 2;
	while ((unTokenIndex < vecTokens.length) && (vecParents.length > 0)) {
		const strToken = vecTokens[unTokenIndex++];
		if (strToken === "}") {
			vecParents.pop();
			continue;
		}

		if (!IsText(strToken)) {
			return null;
		}

		const strValueToken = vecTokens[unTokenIndex++];
		const Entry = { Name: GetText(strToken), Children: null };
		if (strValueToken === "{") {
			Entry.Children = [];
		} else if (!IsText(strValueToken)) {
			return null;
		}

		vecParents[vecParents.length - 1].Children.push(Entry);
		if (Entry.Children !== null) {
			vecParents.push(Entry);
		}
	}

	return (vecParents.length === 0) ? Root : null;
}

function RestoreSourceModKeyNames(NativeValue, vecSourceKeys) {
	if ((NativeValue === null) || (typeof NativeValue !== "object") || Array.isArray(NativeValue)) {
		return NativeValue;
	}

	// Old SDK symbol tables may return a spelling interned earlier by the game.
	const mapNativeNames = new Map();
	for (const strNativeName of Object.keys(NativeValue)) {
		const strFoldedName = FoldSourceModKeyName(strNativeName);
		if (!mapNativeNames.has(strFoldedName)) {
			mapNativeNames.set(strFoldedName, []);
		}

		mapNativeNames.get(strFoldedName).push(strNativeName);
	}

	const mapSourceKeys = new Map();
	for (const SourceKey of vecSourceKeys) {
		const vecCandidates = Object.hasOwn(NativeValue, SourceKey.Name) ? [SourceKey.Name] : (mapNativeNames.get(FoldSourceModKeyName(SourceKey.Name)) ?? []);
		if (vecCandidates.length !== 1) {
			continue;
		}

		const strNativeName = vecCandidates[0];
		if (!mapSourceKeys.has(strNativeName)) {
			mapSourceKeys.set(strNativeName, []);
		}

		mapSourceKeys.get(strNativeName).push(SourceKey);
	}

	const Restored = {};
	const setDuplicateNames = new Set();
	let bChanged = false;
	const AddEntry = (strName, Value) => {
		if (Object.hasOwn(Restored, strName)) {
			if (setDuplicateNames.has(strName)) {
				Restored[strName].push(Value);
				return;
			}

			const vecValues = [Restored[strName], Value];
			Object.defineProperty(Restored, strName, { configurable: true, enumerable: true, value: vecValues, writable: true });
			setDuplicateNames.add(strName);
			return;
		}

		Object.defineProperty(Restored, strName, { configurable: true, enumerable: true, value: Value, writable: true });
	};

	for (const strNativeName of Object.keys(NativeValue)) {
		const NativeGroup = NativeValue[strNativeName];
		const vecNativeEntries = Array.isArray(NativeGroup) ? NativeGroup : [NativeGroup];
		const vecOriginalKeys = mapSourceKeys.get(strNativeName);
		if (!vecOriginalKeys || (vecOriginalKeys.length !== vecNativeEntries.length)) {
			// Native expansion/filtering has no unique source correspondence; do not guess.
			AddEntry(strNativeName, NativeGroup);
			continue;
		}

		for (let unEntryIndex = 0; unEntryIndex < vecNativeEntries.length; ++unEntryIndex) {
			const OriginalKey = vecOriginalKeys[unEntryIndex];
			const NativeEntry = vecNativeEntries[unEntryIndex];
			const Value = (OriginalKey.Children === null) ? NativeEntry : RestoreSourceModKeyNames(NativeEntry, OriginalKey.Children);
			if ((OriginalKey.Name !== strNativeName) || (Value !== NativeEntry)) {
				bChanged = true;
			}

			AddEntry(OriginalKey.Name, Value);
		}
	}

	return bChanged ? Restored : NativeValue;
}

function LoadGameDataFile(strFilePath) {
	const strFileText = ReadGameDataText(strFilePath);
	if (typeof strFileText !== "string") {
		throw new TypeError("GameData file contents must be a string.");
	}

	if (strFilePath.toLowerCase().endsWith(".txt")) {
		// Preserve SourceMod's external keys and literal signature bytes, including \xNN sequences.
		const strSource = StripSourceModComments(strFileText);
		const SourceNames = ReadSourceModKeyNames(strSource);
		const KeyValuesInstance = KeyValues.CreateKeyValuesFromBuffer(strSource, false);
		let bConversionFailed = false;
		let ConversionError = undefined;

		try {
			const strNativeRootName = KeyValuesInstance.Name;
			const NativeValue = KeyValuesInstance.ConvertKeyValuesToObject(true);
			if (SourceNames && (FoldSourceModKeyName(SourceNames.Name) === FoldSourceModKeyName(strNativeRootName))) {
				return { [SourceNames.Name]: RestoreSourceModKeyNames(NativeValue, SourceNames.Children) };
			}

			return { [strNativeRootName]: NativeValue };
		} catch (ErrorValue) {
			bConversionFailed = true;
			ConversionError = ErrorValue;
			throw ErrorValue;
		} finally {
			try {
				if (!KeyValuesInstance.DestroyKeyValues()) {
					throw new Error("Could not release the SourceMod GameData KeyValues object.");
				}
			} catch (ErrorValue) {
				if (bConversionFailed) {
					throw new AggregateError([ConversionError, ErrorValue], "SourceMod GameData conversion and cleanup both failed.");
				}

				throw ErrorValue;
			}
		}
	}

	return JSON.parse(strFileText);
}

function GetGameDataValue(strFilePath, strPropertyPath = null) {
	if ((strPropertyPath !== null) && ((typeof strPropertyPath !== "string") || (strPropertyPath.length === 0))) {
		throw new TypeError("GameData property paths must be non-empty strings or null.");
	}

	let Value = LoadGameDataFile(strFilePath);
	if (strPropertyPath !== null) {
		for (const strPropertyName of strPropertyPath.split(".")) {
			if ((Value === null) || (typeof Value !== "object") || !Object.hasOwn(Value, strPropertyName)) {
				return null;
			}

			Value = Value[strPropertyName];
		}
	}

	return SelectRuntimeValue(Value);
}

function GetGameDataOffset(strFilePath, strOffsetName) {
	const Offsets = GetGameDataValue(strFilePath, "Offsets");

	return ((Offsets === null) || !Object.hasOwn(Offsets, strOffsetName)) ? null : SelectRuntimeValue(Offsets[strOffsetName]);
}

function GetGameDataSignature(strFilePath, strSignatureName) {
	const Signatures = GetGameDataValue(strFilePath, "Signatures");

	return ((Signatures === null) || !Object.hasOwn(Signatures, strSignatureName)) ? null : SelectRuntimeValue(Signatures[strSignatureName]);
}

function GetAllGameDataFiles() {
	if (typeof g_NativeGetAllGameDataFiles !== "function") {
		return [];
	}

	return g_NativeGetAllGameDataFiles().map((FileRecord) => ({ Name: FileRecord.Name, Path: FileRecord.Path }));
}

function GetAllBinaries() {
	if (typeof g_NativeGetAllBinaries !== "function") {
		return [];
	}

	return g_NativeGetAllBinaries().map((BinaryRecord) => ({ Name: BinaryRecord.Name, Path: BinaryRecord.Path, Address: BinaryRecord.Address, ByteCount: BinaryRecord.Size }));
}

function GetBinary(strBinaryName = "") {
	const BinaryRecord = g_NativeGetBinary(strBinaryName);

	return (BinaryRecord === null) ? null : { Name: BinaryRecord.Name, Path: BinaryRecord.Path, Address: BinaryRecord.Address, ByteCount: BinaryRecord.Size };
}

function GetBinarySymbol(strBinaryName, strSymbolName) {
	return g_NativeGetBinarySymbol(strBinaryName, strSymbolName);
}

function ScanBinary(strBinaryName, strBytePattern) {
	return g_NativeScanBinary(strBinaryName, strBytePattern);
}

function ResolveBinaryIdentifier(strBinaryName, Identifier) {
	if (typeof Identifier === "bigint") {
		return Identifier;
	}

	if (typeof Identifier === "number") {
		throw new TypeError("Binary addresses must be bigint values.");
	}

	if (typeof Identifier === "string") {
		if (Identifier.startsWith("@")) {
			return GetBinarySymbol(strBinaryName, Identifier.slice(1));
		}

		if (Identifier.includes(" ") || Identifier.includes(",") || /^\\x/i.test(Identifier) || /^0x/i.test(Identifier)) {
			return ScanBinary(strBinaryName, Identifier);
		}

		return GetBinarySymbol(strBinaryName, Identifier);
	}

	if ((Identifier === null) || (typeof Identifier !== "object") || Array.isArray(Identifier)) {
		return null;
	}

	const vecIdentifierKeys = ["Address", "Identifier", "Symbol", "Pattern"].filter((strIdentifierKey) => Object.hasOwn(Identifier, strIdentifierKey));
	if (vecIdentifierKeys.length !== 1) {
		throw new TypeError("Binary identifier objects must contain exactly one of Address, Identifier, Symbol or Pattern.");
	}

	const strIdentifierKey = vecIdentifierKeys[0];
	const IdentifierValue = Identifier[strIdentifierKey];
	const strResolvedBinaryName = Object.hasOwn(Identifier, "Module") ? Identifier.Module : strBinaryName;

	return ResolveBinaryIdentifier(strResolvedBinaryName, IdentifierValue);
}

function GetGameDataAddress(strFilePath, strAddressName) {
	const Signature = GetGameDataSignature(strFilePath, strAddressName);
	if ((Signature === null) || (typeof Signature !== "object") || Array.isArray(Signature)) {
		return null;
	}

	return ResolveBinaryIdentifier(Signature.Module ?? "server", Signature);
}

function CreateGameDataCallableOptions(strFilePath, strCallableName) {
	const Functions = GetGameDataValue(strFilePath, "Functions");
	if ((Functions === null) || !Object.hasOwn(Functions, strCallableName)) {
		return null;
	}

	const FunctionValue = SelectRuntimeValue(Functions[strCallableName]);
	if ((FunctionValue === null) || (typeof FunctionValue !== "object") || Array.isArray(FunctionValue)) {
		return null;
	}

	return { Arguments: FunctionValue.Arguments ?? [], Convention: FunctionValue.Convention ?? "thiscall", Address: ResolveBinaryIdentifier(FunctionValue.Module ?? "server", FunctionValue.Address ?? FunctionValue.Identifier), ReturnType: FunctionValue.ReturnType ?? "void" };
}

function LoadGameData(strGameDataKind, strGameDataFileName, strSDKBranch = g_strBranch) {
	return g_SourceGameDataRuntime.LoadGameData(strGameDataKind, strGameDataFileName, strSDKBranch);
}

function GetGameDataPaths(strGameDataKind, strGameDataFileName, strSDKBranch = g_strBranch) {
	return g_SourceGameDataRuntime.GetGameDataPaths(strGameDataKind, strGameDataFileName, strSDKBranch);
}

function GetOwnDescriptorValue(Descriptor, strPropertyName, DefaultValue = undefined) {
	if ((Descriptor === null) || (typeof Descriptor !== "object") || Array.isArray(Descriptor)) {
		throw new TypeError("Type descriptor must be an object.");
	}

	if (Object.hasOwn(Descriptor, strPropertyName)) {
		return Descriptor[strPropertyName];
	}

	return DefaultValue;
}

function CreateCallableOptions(MemberFunction) {
	const CallableOptions = {};
	Object.defineProperties(CallableOptions, {
		Arguments: {
			enumerable: true,
			get() {
				return MemberFunction.ArgumentTypes;
			},
			set(vecArgumentTypes) {
				MemberFunction.ArgumentTypes = vecArgumentTypes;
			},
		},
		Convention: {
			enumerable: true,
			get() {
				return MemberFunction.Convention;
			},
			set(strConvention) {
				MemberFunction.Convention = strConvention;
			},
		},
		Address: {
			enumerable: true,
			get() {
				return MemberFunction.FunctionAddress;
			},
			set(unFunctionAddress) {
				MemberFunction.FunctionAddress = unFunctionAddress;
			},
		},
		ReturnType: {
			enumerable: true,
			get() {
				return MemberFunction.ReturnType;
			},
			set(strReturnType) {
				MemberFunction.ReturnType = strReturnType;
			},
		},
		ThisObject: {
			enumerable: true,
			get() {
				return MemberFunction.ThisObject;
			},
			set(ThisObject) {
				MemberFunction.ThisObject = ThisObject;
			},
		},
	});

	return CallableOptions;
}

function CreateManagedCallable(mapManager, strReturnType, unFunctionAddress, ThisObject, vecArgumentTypes, strConvention) {
	const MemberFunctionInstance = new MemberFunction(mapManager, strReturnType, unFunctionAddress, ThisObject, vecArgumentTypes, strConvention);
	const CallableOptions = CreateCallableOptions(MemberFunctionInstance);
	let bManagedServerAddressCheck = true;
	let strManagedDocumentation = null;

	function ManagedCallable(...vecArgumentValues) {
		return Reflect.apply(MemberFunctionInstance.Call, MemberFunctionInstance, vecArgumentValues);
	}

	Object.defineProperties(ManagedCallable, {
		Options: { enumerable: true, value: CallableOptions },
		Address: {
			enumerable: true,
			get() {
				return MemberFunctionInstance.FunctionAddress;
			},
			set(unAddress) {
				MemberFunctionInstance.FunctionAddress = unAddress;
			},
		},
		Documentation: {
			enumerable: true,
			get() {
				return strManagedDocumentation;
			},
			set(strDocumentationText) {
				strManagedDocumentation = strDocumentationText;
			},
		},
		ServerAddressCheck: {
			enumerable: true,
			get() {
				return bManagedServerAddressCheck;
			},
			set(bServerAddressCheck) {
				bManagedServerAddressCheck = bServerAddressCheck;
			},
		},
	});

	return ManagedCallable;
}

function ApplyAddressTransform(unAddress, nAddressOffset = 0n, unDereferenceCount = 0) {
	if (typeof nAddressOffset !== "bigint") {
		throw new TypeError("ApplyAddressTransform nAddressOffset must be a bigint value.");
	}

	if (!Number.isSafeInteger(unDereferenceCount) || (unDereferenceCount < 0)) {
		throw new TypeError("ApplyAddressTransform unDereferenceCount must be a non-negative safe integer.");
	}

	let unTransformedAddress = Add(unAddress, nAddressOffset);
	for (let unDereferenceIndex = 0; unDereferenceIndex < unDereferenceCount; ++unDereferenceIndex) {
		unTransformedAddress = ReadAddress(unTransformedAddress);
	}

	return unTransformedAddress;
}

function CreateTypePropertyDescriptor(PropertyDescriptor) {
	if ((PropertyDescriptor === null) || (typeof PropertyDescriptor !== "object") || Array.isArray(PropertyDescriptor)) {
		throw new TypeError("Type property descriptor must be an object.");
	}

	let bConfigurable = true;
	let bEnumerable = true;

	// These lowercase fields are the ECMAScript property-descriptor contract, not project API keys.
	if (Object.hasOwn(PropertyDescriptor, "configurable")) {
		const bDescriptorConfigurable = PropertyDescriptor.configurable;
		if (typeof bDescriptorConfigurable !== "boolean") {
			throw new TypeError("Type property descriptor configurable must be a boolean.");
		}

		bConfigurable = bDescriptorConfigurable;
	}

	if (Object.hasOwn(PropertyDescriptor, "enumerable")) {
		const bDescriptorEnumerable = PropertyDescriptor.enumerable;
		if (typeof bDescriptorEnumerable !== "boolean") {
			throw new TypeError("Type property descriptor enumerable must be a boolean.");
		}

		bEnumerable = bDescriptorEnumerable;
	}

	const TypePropertyDescriptor = { configurable: bConfigurable, enumerable: bEnumerable };

	if (Object.hasOwn(PropertyDescriptor, "get")) {
		TypePropertyDescriptor.get = PropertyDescriptor.get;
	}

	if (Object.hasOwn(PropertyDescriptor, "set")) {
		TypePropertyDescriptor.set = PropertyDescriptor.set;
	}

	if (Object.hasOwn(PropertyDescriptor, "value")) {
		TypePropertyDescriptor.value = PropertyDescriptor.value;
	}

	if (Object.hasOwn(PropertyDescriptor, "writable")) {
		const bDescriptorWritable = PropertyDescriptor.writable;
		if (typeof bDescriptorWritable !== "boolean") {
			throw new TypeError("Type property descriptor writable must be a boolean.");
		}

		TypePropertyDescriptor.writable = bDescriptorWritable;
	}

	return TypePropertyDescriptor;
}

function RestoreOwnProperty(TargetObject, strPropertyName, PropertyDescriptor) {
	if (PropertyDescriptor === undefined) {
		if (!Reflect.deleteProperty(TargetObject, strPropertyName)) {
			throw new Error(`Could not remove property "${strPropertyName}" during rollback.`);
		}

		return;
	}

	Object.defineProperty(TargetObject, strPropertyName, PropertyDescriptor);
}

const g_mapCustomTypeStates = new WeakMap();

function GetCustomTypeState(CustomTypeInstance) {
	const State = g_mapCustomTypeStates.get(CustomTypeInstance);
	if (State === undefined) {
		throw new TypeError("CustomType state requires an initialized CustomType instance.");
	}

	return State;
}

class CustomType extends BaseAddress {
	constructor(...vecConstructorArguments) {
		const bWrapsAddress = vecConstructorArguments[vecConstructorArguments.length - 1] === g_WrappedAddressConstruction;
		const TypeConstructor = new.target;
		if (bWrapsAddress) {
			vecConstructorArguments.pop();
		}

		if (!(TypeConstructor.Manager instanceof TypeManager)) {
			throw new TypeError("CustomType subclasses must be registered through a TypeManager.");
		}

		if (bWrapsAddress) {
			super(vecConstructorArguments[0]);
			this.#m_bDestructorInvoked = false;
			g_mapCustomTypeStates.set(this, { m_bOwnsAddress: false, m_bServerAddressCheck: TypeConstructor.ServerCheck, m_setAllocatedAddresses: new Set(), m_mapAddressValues: new Map() });
			return;
		}

		const unTypeSize = TypeConstructor.TypeSize;
		const ConstructorCallback = TypeConstructor.ConstructorCallback;

		if (!Number.isSafeInteger(unTypeSize) || (unTypeSize <= 0)) {
			throw new TypeError("CustomType subclasses require a positive integer TypeSize to allocate instances.");
		}

		if ((ConstructorCallback !== null) && (typeof ConstructorCallback !== "function")) {
			throw new TypeError("CustomType ConstructorCallback must be a function or null.");
		}

		if ((ConstructorCallback === null) && (vecConstructorArguments.length > 0)) {
			throw new TypeError("No ConstructorCallback was specified, but arguments were passed.");
		}

		const unAllocatedAddress = Allocate(unTypeSize);
		let bOwnershipInitialized = false;

		try {
			super(unAllocatedAddress);
			this.#m_bDestructorInvoked = false;
			g_mapCustomTypeStates.set(this, { m_bOwnsAddress: true, m_bServerAddressCheck: TypeConstructor.ServerCheck, m_setAllocatedAddresses: new Set(), m_mapAddressValues: new Map() });
			bOwnershipInitialized = true;

			if (ConstructorCallback !== null) {
				ConstructorCallback.apply(this, vecConstructorArguments);
			}
		} catch (ConstructionError) {
			try {
				// A failed super() leaves this unavailable; partial state cannot run the destructor path.
				const bAllocationReleased = bOwnershipInitialized ? this.Deallocate() : Deallocate(unAllocatedAddress);
				if (!bAllocationReleased) {
					throw new Error("CustomType constructor rollback could not release the allocation.");
				}
			} catch (CleanupError) {
				throw new AggregateError([ConstructionError, CleanupError], "CustomType construction and rollback both failed.");
			}

			throw ConstructionError;
		}
	}

	static CreateFromAddress(unAddress, nAddressOffset = 0n) {
		return new this(Add(unAddress, nAddressOffset), g_WrappedAddressConstruction);
	}

	Add(nAddressOffset) {
		return MakeObject(this.constructor, Add(super.Address, nAddressOffset));
	}

	Subtract(nAddressOffset) {
		return MakeObject(this.constructor, Subtract(super.Address, nAddressOffset));
	}

	Deallocate() {
		const State = GetCustomTypeState(this);
		const bOwnsAddress = State.m_bOwnsAddress;
		const unObjectAddress = super.Address;
		const setAllocatedAddresses = State.m_setAllocatedAddresses;
		const mapAddressValues = State.m_mapAddressValues;

		if (typeof bOwnsAddress !== "boolean") {
			throw new TypeError("CustomType OwnsAddress must be a boolean.");
		}

		if (!(setAllocatedAddresses instanceof Set)) {
			throw new TypeError("CustomType AllocatedAddresses must be a Set.");
		}

		if (!(mapAddressValues instanceof Map)) {
			throw new TypeError("CustomType AddressValues must be a Map.");
		}

		if (!bOwnsAddress || IsNull(unObjectAddress)) {
			return false;
		}

		if (!this.#m_bDestructorInvoked) {
			this.OnDeallocate();
			this.#m_bDestructorInvoked = true;
		}

		let bChildAddressesReleased = true;
		for (const unAllocatedAddress of setAllocatedAddresses) {
			if (unAllocatedAddress === unObjectAddress) {
				throw new RangeError("CustomType AllocatedAddresses cannot contain the object address.");
			}

			const bChildAddressReleased = Deallocate(unAllocatedAddress);
			if (typeof bChildAddressReleased !== "boolean") {
				throw new TypeError("Memory Deallocate must return a boolean.");
			}

			if (bChildAddressReleased) {
				// Set.delete reports prior presence; either result leaves the released address untracked.
				setAllocatedAddresses.delete(unAllocatedAddress);
			} else {
				bChildAddressesReleased = false;
			}
		}

		if (!bChildAddressesReleased) {
			return false;
		}

		const bAllocationReleased = Deallocate(unObjectAddress);
		if (typeof bAllocationReleased !== "boolean") {
			throw new TypeError("Memory Deallocate must return a boolean.");
		}

		if (bAllocationReleased) {
			BaseAddress.RebindAddress(this, 0n);
			State.m_bOwnsAddress = false;
			setAllocatedAddresses.clear();
			mapAddressValues.clear();
		}

		return bAllocationReleased;
	}

	OnDeallocate() {
		const DestructorCallback = this.constructor.DestructorCallback;
		if ((DestructorCallback !== null) && (typeof DestructorCallback !== "function")) {
			throw new TypeError("CustomType DestructorCallback must be a function or null.");
		}

		if (DestructorCallback !== null) {
			DestructorCallback.call(this);
		}
	}

	GetMemoryAddress() {
		return super.Address;
	}

	get OwnsAddress() {
		return GetCustomTypeState(this).m_bOwnsAddress;
	}

	get AllocatedAddresses() {
		return GetCustomTypeState(this).m_setAllocatedAddresses;
	}

	get AddressValues() {
		return GetCustomTypeState(this).m_mapAddressValues;
	}

	get ServerAddressCheck() {
		return GetCustomTypeState(this).m_bServerAddressCheck;
	}

	set ServerAddressCheck(bServerAddressCheck) {
		GetCustomTypeState(this).m_bServerAddressCheck = bServerAddressCheck;
	}

	#m_bDestructorInvoked;
}

Object.defineProperties(CustomType, {
	Manager: { configurable: true, enumerable: true, writable: true, value: null },
	Binary: { configurable: true, enumerable: true, writable: true, value: null },
	ServerCheck: { configurable: true, enumerable: true, writable: true, value: true },
	TypeSize: { configurable: true, enumerable: true, writable: true, value: null },
	ClassInfo: { configurable: true, enumerable: true, writable: true, value: {} },
	ConstructorCallback: { configurable: true, enumerable: true, writable: true, value: null },
	DestructorCallback: { configurable: true, enumerable: true, writable: true, value: null },
});

function IsCustomTypeConstructor(TypeConstructor) {
	if (typeof TypeConstructor !== "function") {
		return false;
	}

	return (TypeConstructor === CustomType) || (TypeConstructor.prototype instanceof CustomType);
}

class TypeManager extends Map {
	constructor() {
		super();
		this.#m_mapGlobalAddresses = new Map();
		this.#m_mapConverters = new Map();
		this.#m_mapFunctionTypedefs = new Map();
	}

	RegisterType(strTypeName, TypeConstructor) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("RegisterType expects a non-empty strTypeName.");
		}

		if (typeof TypeConstructor !== "function") {
			throw new TypeError("RegisterType TypeConstructor must be a constructor.");
		}

		if (!IsCustomTypeConstructor(TypeConstructor)) {
			throw new TypeError("TypeManager types must extend CustomType.");
		}

		const ClassInformation = TypeConstructor.ClassInfo;
		const unTypeSize = TypeConstructor.TypeSize;
		const ManagerDescriptor = Object.getOwnPropertyDescriptor(TypeConstructor, "Manager");

		try {
			Object.defineProperty(TypeConstructor, "Manager", { configurable: true, enumerable: true, value: this, writable: true });

			RegisterObjectType(strTypeName, TypeConstructor, { ClassInfo: ClassInformation, Size: unTypeSize });
		} catch (RegistrationError) {
			try {
				RestoreOwnProperty(TypeConstructor, "Manager", ManagerDescriptor);
			} catch (RollbackError) {
				throw new AggregateError([RegistrationError, RollbackError], "RegisterType registration and rollback both failed.");
			}

			throw RegistrationError;
		}

		Map.prototype.set.call(this, strTypeName, TypeConstructor);

		return TypeConstructor;
	}

	DefineType(strTypeName, TypeConstructor, TypeDescriptor = {}) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("DefineType requires a non-empty strTypeName.");
		}

		if (!IsCustomTypeConstructor(TypeConstructor)) {
			throw new TypeError("DefineType expects a CustomType subclass.");
		}

		if ((TypeDescriptor === null) || (typeof TypeDescriptor !== "object") || Array.isArray(TypeDescriptor)) {
			throw new TypeError("DefineType TypeDescriptor must be an object.");
		}

		const ResolveTypeDescriptorValue = (strDescriptorPropertyName, strConstructorPropertyName = strDescriptorPropertyName) => {
			if (Object.hasOwn(TypeDescriptor, strDescriptorPropertyName)) {
				return TypeDescriptor[strDescriptorPropertyName];
			}

			return TypeConstructor[strConstructorPropertyName];
		};

		const strBinary = ResolveTypeDescriptorValue("Binary");
		const bServerCheck = ResolveTypeDescriptorValue("ServerCheck");
		const unTypeSize = ResolveTypeDescriptorValue("Size", "TypeSize");
		const ClassInformation = ResolveTypeDescriptorValue("ClassInfo");
		const ConstructorCallback = ResolveTypeDescriptorValue("ConstructorCallback");
		const DestructorCallback = ResolveTypeDescriptorValue("DestructorCallback");
		const PropertyDescriptors = GetOwnDescriptorValue(TypeDescriptor, "Properties");
		const bHasPropertyDescriptors = PropertyDescriptors !== undefined;
		const bPropertyDescriptorsAreInvalid = (PropertyDescriptors === null) || (typeof PropertyDescriptors !== "object") || Array.isArray(PropertyDescriptors);

		if ((strBinary !== null) && ((typeof strBinary !== "string") || (strBinary.trim().length === 0))) {
			throw new TypeError("DefineType Binary must be a non-empty string or null.");
		}

		if (typeof bServerCheck !== "boolean") {
			throw new TypeError("DefineType ServerCheck must be a boolean.");
		}

		if ((unTypeSize !== null) && (!Number.isSafeInteger(unTypeSize) || (unTypeSize <= 0))) {
			throw new TypeError("DefineType Size must be a positive safe integer or null.");
		}

		if ((ClassInformation === null) || (typeof ClassInformation !== "object") || Array.isArray(ClassInformation)) {
			throw new TypeError("DefineType ClassInfo must be an object.");
		}

		if ((ConstructorCallback !== null) && (typeof ConstructorCallback !== "function")) {
			throw new TypeError("DefineType ConstructorCallback must be a function or null.");
		}

		if ((DestructorCallback !== null) && (typeof DestructorCallback !== "function")) {
			throw new TypeError("DefineType DestructorCallback must be a function or null.");
		}

		if (bHasPropertyDescriptors && bPropertyDescriptorsAreInvalid) {
			throw new TypeError("DefineType Properties must be an object when provided.");
		}

		const mapNormalizedPropertyDescriptors = new Map();
		if (bHasPropertyDescriptors) {
			for (const strPropertyName in PropertyDescriptors) {
				if (!Object.hasOwn(PropertyDescriptors, strPropertyName)) {
					continue;
				}

				mapNormalizedPropertyDescriptors.set(strPropertyName, CreateTypePropertyDescriptor(PropertyDescriptors[strPropertyName]));
			}
		}

		const mapTypeMetadata = new Map([
			["Binary", strBinary],
			["ServerCheck", bServerCheck],
			["TypeSize", unTypeSize],
			["ClassInfo", ClassInformation],
			["ConstructorCallback", ConstructorCallback],
			["DestructorCallback", DestructorCallback],
		]);
		const mapPreviousMetadataDescriptors = new Map();
		const mapPreviousPropertyDescriptors = new Map();
		const vecAppliedMetadataNames = [];
		const vecAppliedPropertyNames = [];

		try {
			for (const strMetadataName of g_vecTypeMetadataPropertyNames) {
				mapPreviousMetadataDescriptors.set(strMetadataName, Object.getOwnPropertyDescriptor(TypeConstructor, strMetadataName));
				Object.defineProperty(TypeConstructor, strMetadataName, { configurable: true, enumerable: true, value: mapTypeMetadata.get(strMetadataName), writable: true });
				vecAppliedMetadataNames.push(strMetadataName);
			}

			for (const [strPropertyName, PropertyDescriptor] of mapNormalizedPropertyDescriptors) {
				mapPreviousPropertyDescriptors.set(strPropertyName, Object.getOwnPropertyDescriptor(TypeConstructor.prototype, strPropertyName));
				Object.defineProperty(TypeConstructor.prototype, strPropertyName, PropertyDescriptor);
				vecAppliedPropertyNames.push(strPropertyName);
			}

			return this.RegisterType(strTypeName, TypeConstructor);
		} catch (DefinitionError) {
			const vecRollbackErrors = [];
			for (let nPropertyIndex = vecAppliedPropertyNames.length - 1; nPropertyIndex >= 0; --nPropertyIndex) {
				const strPropertyName = vecAppliedPropertyNames[nPropertyIndex];
				try {
					RestoreOwnProperty(TypeConstructor.prototype, strPropertyName, mapPreviousPropertyDescriptors.get(strPropertyName));
				} catch (RollbackError) {
					vecRollbackErrors.push(RollbackError);
				}
			}

			for (let nMetadataIndex = vecAppliedMetadataNames.length - 1; nMetadataIndex >= 0; --nMetadataIndex) {
				const strMetadataName = vecAppliedMetadataNames[nMetadataIndex];
				try {
					RestoreOwnProperty(TypeConstructor, strMetadataName, mapPreviousMetadataDescriptors.get(strMetadataName));
				} catch (RollbackError) {
					vecRollbackErrors.push(RollbackError);
				}
			}

			if (vecRollbackErrors.length > 0) {
				const vecDefinitionErrors = [DefinitionError];
				for (const RollbackError of vecRollbackErrors) {
					vecDefinitionErrors.push(RollbackError);
				}

				throw new AggregateError(vecDefinitionErrors, "DefineType definition and rollback both failed.");
			}

			throw DefinitionError;
		}
	}

	RegisterConverter(strConverterName, Converter) {
		if ((typeof strConverterName !== "string") || (strConverterName.trim().length === 0)) {
			throw new TypeError("RegisterConverter expects a non-empty strConverterName.");
		}

		if (typeof Converter !== "function") {
			throw new TypeError("RegisterConverter Converter must be a function.");
		}

		Map.prototype.set.call(this.#m_mapConverters, strConverterName, Converter);

		return Converter;
	}

	UnregisterConverter(strConverterName) {
		if ((typeof strConverterName !== "string") || (strConverterName.trim().length === 0)) {
			throw new TypeError("UnregisterConverter expects a non-empty strConverterName.");
		}

		return Map.prototype.delete.call(this.#m_mapConverters, strConverterName);
	}

	Convert(strTypeName, unAddress) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("Convert expects a non-empty strTypeName.");
		}

		if ((typeof unAddress !== "bigint") || (unAddress < 0n)) {
			throw new TypeError("Convert unAddress must be a non-negative bigint.");
		}

		const TypeConstructor = this.GetClass(strTypeName);
		if (TypeConstructor !== null) {
			return MakeObject(TypeConstructor, unAddress);
		}

		const mapFunctionTypedefs = this.#m_mapFunctionTypedefs;
		if (Map.prototype.has.call(mapFunctionTypedefs, strTypeName)) {
			const FunctionTypedef = Map.prototype.get.call(mapFunctionTypedefs, strTypeName);
			if (typeof FunctionTypedef !== "function") {
				throw new TypeError(`Function typedef "${strTypeName}" must be a function.`);
			}

			return FunctionTypedef(unAddress);
		}

		const mapConverters = this.#m_mapConverters;
		if (Map.prototype.has.call(mapConverters, strTypeName)) {
			const Converter = Map.prototype.get.call(mapConverters, strTypeName);
			if (typeof Converter !== "function") {
				throw new TypeError(`Converter "${strTypeName}" must be a function.`);
			}

			return Converter(unAddress);
		}

		throw new ReferenceError(`No class, function typedef or converter found for "${strTypeName}".`);
	}

	CreateConverter(strTypeName) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("CreateConverter expects a non-empty strTypeName.");
		}

		return (unAddress) => this.Convert(strTypeName, unAddress);
	}

	CreateType(strTypeName, TypeDescriptor = {}, BaseType = CustomType) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("CreateType expects a non-empty strTypeName.");
		}

		if ((TypeDescriptor === null) || (typeof TypeDescriptor !== "object") || Array.isArray(TypeDescriptor)) {
			throw new TypeError("CreateType TypeDescriptor must be an object.");
		}

		if (!IsCustomTypeConstructor(BaseType)) {
			throw new TypeError("CreateType BaseType must extend CustomType.");
		}

		const TypeConstructors = {
			[strTypeName]: class extends BaseType {
			},
		};
		const TypeConstructor = TypeConstructors[strTypeName];

		return this.DefineType(strTypeName, TypeConstructor, TypeDescriptor);
	}

	CreatePipe(PipeDescriptor = {}) {
		if ((PipeDescriptor === null) || (typeof PipeDescriptor !== "object") || Array.isArray(PipeDescriptor)) {
			throw new TypeError("CreatePipe PipeDescriptor must be an object.");
		}

		class Pipe {
		}

		Object.defineProperties(Pipe, Object.getOwnPropertyDescriptors(PipeDescriptor));

		return Pipe;
	}

	CreatePipeFromObject(PipeDefinition) {
		const PipeDescriptor = Object.create(null);
		const vecDefaultArgumentTypes = [];
		const itFunctionDefinitions = ParseData(this, PipeDefinition, [
			["Binary", DataKey.AsString, NO_DEFAULT],
			["Identifier", DataKey.AsIdentifier, NO_DEFAULT],
			["Arguments", DataKey.AsArguments, vecDefaultArgumentTypes],
			["ReturnType", DataKey.AsReturnType, "void"],
			["Convention", DataKey.AsConvention, "cdecl"],
			["ServerCheck", DataKey.AsBoolean, true],
			["Documentation", DataKey.AsString, null],
		]);
		for (const [strFunctionName, vecFunctionValues] of itFunctionDefinitions) {
			const [
				strBinaryName,
				FunctionIdentifier,
				vecParsedArgumentTypes,
				strReturnType,
				strConvention,
				bServerCheck,
				strDocumentationText,
			] = vecFunctionValues;
			const vecArgumentTypes = (vecParsedArgumentTypes === vecDefaultArgumentTypes) ? [] : vecParsedArgumentTypes;
			PipeDescriptor[strFunctionName] = this.PipeFunction(strBinaryName, FunctionIdentifier, vecArgumentTypes, strReturnType, strConvention, bServerCheck, strDocumentationText);
		}

		return this.CreatePipe(PipeDescriptor);
	}

	CreatePipeFromFile(strFilePath) {
		const PipeDefinition = g_MemoryManagerRuntime.LoadGameDataFile(strFilePath);

		return this.CreatePipeFromObject(PipeDefinition);
	}

	PipeFunction(strBinaryName, FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", bServerCheck = true, strDocumentationText = null) {
		if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
			throw new TypeError("PipeFunction strBinaryName must be a non-empty string.");
		}

		if (!Array.isArray(vecArgumentTypes)) {
			throw new TypeError("PipeFunction vecArgumentTypes must be an array.");
		}

		if ((typeof strReturnType !== "string") || (strReturnType.trim().length === 0)) {
			throw new TypeError("PipeFunction strReturnType must be a non-empty string.");
		}

		if (typeof bServerCheck !== "boolean") {
			throw new TypeError("PipeFunction bServerCheck must be a boolean.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("PipeFunction strDocumentationText must be a string or null.");
		}

		const strCallReturnType = Type.IsNativeDataType(strReturnType) ? Type.NormalizeDataType(strReturnType) : strReturnType;
		const strCallingConvention = NormalizeConvention(strConvention);
		const unFunctionAddress = g_MemoryManagerRuntime.ResolveBinaryIdentifier(strBinaryName, FunctionIdentifier);
		if ((unFunctionAddress === null) || IsNull(unFunctionAddress)) {
			throw new ReferenceError(`Unable to resolve function in binary "${strBinaryName}".`);
		}

		const ManagedFunction = CreateManagedCallable(this, strCallReturnType, unFunctionAddress, null, vecArgumentTypes, strCallingConvention);
		ManagedFunction.Documentation = strDocumentationText;
		ManagedFunction.ServerAddressCheck = bServerCheck;

		return ManagedFunction;
	}

	CreateTypeFromObject(strTypeName, TypeDefinition, BaseType = CustomType) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("CreateTypeFromObject expects a non-empty strTypeName.");
		}

		if ((TypeDefinition === null) || (typeof TypeDefinition !== "object") || Array.isArray(TypeDefinition)) {
			throw new TypeError("CreateTypeFromObject TypeDefinition must be an object.");
		}

		if (!IsCustomTypeConstructor(BaseType)) {
			throw new TypeError("CreateTypeFromObject BaseType must extend CustomType.");
		}

		const mapTypeDefinitionValues = new Map();
		const TypeDefaultValues = Object.create(null);
		for (const strDefinitionName in TypeDefinition) {
			if (!Object.hasOwn(TypeDefinition, strDefinitionName)) {
				continue;
			}

			const DefinitionValue = TypeDefinition[strDefinitionName];
			mapTypeDefinitionValues.set(strDefinitionName, DefinitionValue);
			if ((DefinitionValue !== null) && (typeof DefinitionValue === "object") && !Array.isArray(DefinitionValue)) {
				continue;
			}

			TypeDefaultValues[strDefinitionName] = DefinitionValue;
		}

		const [[, [strBinary, bServerCheck, unTypeSize]]] = ParseData(this, { Defaults: TypeDefaultValues }, [
			["Binary", DataKey.AsString, BaseType.Binary],
			["ServerCheck", DataKey.AsBoolean, BaseType.ServerCheck],
			["Size", DataKey.AsInteger, BaseType.TypeSize],
		]);

		const Properties = Object.create(null);
		const vecAttributeSections = [
			["InstanceAttribute", "InstanceAttribute", false],
			["AddressAttribute", "AddressAttribute", false],
			["StaticInstanceArray", "StaticInstanceArray", true],
			["DynamicInstanceArray", "DynamicInstanceArray", true],
			["StaticAddressArray", "StaticAddressArray", true],
			["DynamicAddressArray", "DynamicAddressArray", true],
		];
		for (const [strSectionName, strFactoryName, bIsArrayAttribute] of vecAttributeSections) {
			const AttributeFactory = this[strFactoryName];
			const AttributeDefinitions = mapTypeDefinitionValues.has(strSectionName) ? mapTypeDefinitionValues.get(strSectionName) : Object.create(null);
			if (typeof AttributeFactory !== "function") {
				throw new TypeError(`CreateTypeFromObject ${strFactoryName} factory must be a function.`);
			}

			const itAttributeDefinitions = ParseData(this, AttributeDefinitions, [
				["TypeName", DataKey.AsAttributeType, NO_DEFAULT],
				["Offset", DataKey.AsInt64, NO_DEFAULT],
				["Length", DataKey.AsInteger, null],
				["Documentation", DataKey.AsString, null],
			]);
			for (const [strPropertyName, vecAttributeValues] of itAttributeDefinitions) {
				const [strAttributeTypeName, nAddressOffset, unArrayLength, strDocumentationText] = vecAttributeValues;
				if (bIsArrayAttribute) {
					Properties[strPropertyName] = AttributeFactory.call(this, strAttributeTypeName, nAddressOffset, unArrayLength, strDocumentationText);
				} else {
					Properties[strPropertyName] = AttributeFactory.call(this, strAttributeTypeName, nAddressOffset, strDocumentationText);
				}
			}
		}

		const ClassInformation = Object.create(null);
		const vecDefaultVirtualArgumentTypes = [];
		const VirtualFunctionDefinitions = mapTypeDefinitionValues.has("VirtualFunction") ? mapTypeDefinitionValues.get("VirtualFunction") : Object.create(null);
		const itVirtualFunctionDefinitions = ParseData(this, VirtualFunctionDefinitions, [
			["Offset", DataKey.AsInteger, NO_DEFAULT],
			["Arguments", DataKey.AsArguments, vecDefaultVirtualArgumentTypes],
			["ReturnType", DataKey.AsReturnType, "void"],
			["Convention", DataKey.AsConvention, "thiscall"],
			["Documentation", DataKey.AsString, null],
		]);
		for (const [strFunctionName, vecVirtualFunctionValues] of itVirtualFunctionDefinitions) {
			const [unVTableIndex, vecParsedArgumentTypes, strReturnType, strConvention, strDocumentationText] = vecVirtualFunctionValues;
			const vecArgumentTypes = (vecParsedArgumentTypes === vecDefaultVirtualArgumentTypes) ? [] : vecParsedArgumentTypes;
			const vecABIArgumentTypes = ["address"];
			for (const strArgumentType of vecArgumentTypes) {
				vecABIArgumentTypes.push(strArgumentType);
			}

			Properties[strFunctionName] = this.VirtualFunction(unVTableIndex, vecArgumentTypes, strReturnType, strConvention, strDocumentationText);
			ClassInformation[strFunctionName] = [{ ArgumentTypes: vecABIArgumentTypes, CallingConvention: strConvention, IsVirtual: true, VTableIndex: unVTableIndex, ReturnType: strReturnType }];
		}

		const vecDefaultFunctionArgumentTypes = [];
		const FunctionDefinitions = mapTypeDefinitionValues.has("Function") ? mapTypeDefinitionValues.get("Function") : Object.create(null);
		const itFunctionDefinitions = ParseData(this, FunctionDefinitions, [
			["Identifier", DataKey.AsIdentifier, NO_DEFAULT],
			["Arguments", DataKey.AsArguments, vecDefaultFunctionArgumentTypes],
			["ReturnType", DataKey.AsReturnType, "void"],
			["Convention", DataKey.AsConvention, "thiscall"],
			["Documentation", DataKey.AsString, null],
		]);
		for (const [strFunctionName, vecFunctionValues] of itFunctionDefinitions) {
			const [FunctionIdentifier, vecParsedArgumentTypes, strReturnType, strConvention, strDocumentationText] = vecFunctionValues;
			const vecArgumentTypes = (vecParsedArgumentTypes === vecDefaultFunctionArgumentTypes) ? [] : vecParsedArgumentTypes;
			const vecABIArgumentTypes = ["address"];
			for (const strArgumentType of vecArgumentTypes) {
				vecABIArgumentTypes.push(strArgumentType);
			}

			Properties[strFunctionName] = this.Function(FunctionIdentifier, vecArgumentTypes, strReturnType, strConvention, strDocumentationText);
			ClassInformation[strFunctionName] = [{ ArgumentTypes: vecABIArgumentTypes, CallingConvention: strConvention, IsVirtual: false, ReturnType: strReturnType }];
		}

		return this.CreateType(strTypeName, { Binary: strBinary, ClassInfo: ClassInformation, Properties, ServerCheck: bServerCheck, Size: unTypeSize }, BaseType);
	}

	CreateTypeFromFile(strTypeName, strFilePath, BaseType = CustomType) {
		const TypeDefinition = g_MemoryManagerRuntime.LoadGameDataFile(strFilePath);

		return this.CreateTypeFromObject(strTypeName, TypeDefinition, BaseType);
	}

	InstanceAttribute(strTypeName, nAddressOffset, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("InstanceAttribute strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("InstanceAttribute nAddressOffset must be a bigint value.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("InstanceAttribute strDocumentationText must be a string or null.");
		}

		const bIsNativeType = Type.IsNativeDataType(strTypeName);
		const strNormalizedTypeName = bIsNativeType ? Type.NormalizeDataType(strTypeName) : strTypeName;

		return {
			get() {
				if (bIsNativeType) {
					return this.Read(strNormalizedTypeName, nAddressOffset);
				}

				const unTargetAddress = Add(GetObjectAddress(this), nAddressOffset);

				return this.constructor.Manager.Convert(strNormalizedTypeName, unTargetAddress);
			},
			set(AttributeValue) {
				if (bIsNativeType) {
					const bAttributeWriteResult = this.Write(strNormalizedTypeName, AttributeValue, nAddressOffset);
					if (bAttributeWriteResult !== true) {
						throw new Error("Unable to write the native instance attribute.");
					}

					return;
				}

				const mapManager = this.constructor.Manager;
				const TypeConstructor = mapManager.GetClass(strNormalizedTypeName);
				if (TypeConstructor === null) {
					throw new ReferenceError(`Unknown object type "${strNormalizedTypeName}".`);
				}

				const unTypeSize = TypeConstructor.TypeSize;
				if (!Number.isSafeInteger(unTypeSize) || (unTypeSize <= 0)) {
					throw new TypeError(`Object type "${strNormalizedTypeName}" must have a positive safe-integer TypeSize.`);
				}

				const unSourceAddress = GetObjectAddress(AttributeValue);
				const unTargetAddress = Add(GetObjectAddress(this), nAddressOffset);
				const bObjectCopyResult = Copy(unSourceAddress, unTargetAddress, unTypeSize);
				if (bObjectCopyResult !== true) {
					throw new Error(`Unable to copy object type "${strNormalizedTypeName}" into the instance attribute.`);
				}
			},
			Documentation: strDocumentationText,
		};
	}

	AddressAttribute(strTypeName, nAddressOffset, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("AddressAttribute strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("AddressAttribute nAddressOffset must be a bigint value.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("AddressAttribute strDocumentationText must be a string or null.");
		}

		const bIsNativeType = Type.IsNativeDataType(strTypeName);
		const strNormalizedTypeName = bIsNativeType ? Type.NormalizeDataType(strTypeName) : strTypeName;

		return {
			get() {
				const unInstanceAddress = GetObjectAddress(this);
				const unTargetAddress = ReadAddress(unInstanceAddress, nAddressOffset);
				if (bIsNativeType) {
					return Read(unTargetAddress, strNormalizedTypeName);
				}

				return this.constructor.Manager.Convert(strNormalizedTypeName, unTargetAddress);
			},
			set(AttributeValue) {
				const unInstanceAddress = GetObjectAddress(this);
				if (bIsNativeType) {
					let unTargetAddress = ReadAddress(unInstanceAddress, nAddressOffset);
					if (IsNull(unTargetAddress)) {
						const setAllocatedAddresses = GetCustomTypeState(this).m_setAllocatedAddresses;
						if (!(setAllocatedAddresses instanceof Set)) {
							throw new TypeError("AddressAttribute requires a Set for native allocation tracking.");
						}

						const unAllocatedAddress = Allocate(Type.GetDataTypeSize(strNormalizedTypeName));
						let bAddressTracked = false;

						try {
							Set.prototype.add.call(setAllocatedAddresses, unAllocatedAddress);
							bAddressTracked = true;

							const bAddressWriteResult = Write(unInstanceAddress, "address", unAllocatedAddress, nAddressOffset);
							if (bAddressWriteResult !== true) {
								throw new Error("Unable to store the allocated native attribute address.");
							}

							unTargetAddress = unAllocatedAddress;
						} catch (AllocationError) {
							const vecAllocationCleanupErrors = [];
							let bAddressStorageRestored = !bAddressTracked;
							let bAddressDeallocated = false;

							if (bAddressTracked) {
								try {
									const bAddressRestoreResult = Write(unInstanceAddress, "address", unTargetAddress, nAddressOffset);
									if (bAddressRestoreResult === true) {
										bAddressStorageRestored = true;
									} else {
										vecAllocationCleanupErrors.push(new Error("Unable to restore the native attribute address slot."));
									}
								} catch (AddressRestorationError) {
									vecAllocationCleanupErrors.push(AddressRestorationError);
								}
							}

							if (bAddressStorageRestored) {
								try {
									const bDeallocationResult = Deallocate(unAllocatedAddress);
									if (bDeallocationResult === true) {
										bAddressDeallocated = true;
									} else {
										vecAllocationCleanupErrors.push(new Error("Unable to release the failed attribute allocation."));
									}
								} catch (DeallocationError) {
									vecAllocationCleanupErrors.push(DeallocationError);
								}
							}

							if (bAddressTracked && bAddressDeallocated) {
								try {
									if (!Set.prototype.delete.call(setAllocatedAddresses, unAllocatedAddress)) {
										vecAllocationCleanupErrors.push(new Error("Unable to remove the released attribute address."));
									}
								} catch (RemovalError) {
									vecAllocationCleanupErrors.push(RemovalError);
								}
							}

							if (vecAllocationCleanupErrors.length > 0) {
								vecAllocationCleanupErrors.unshift(AllocationError);
								throw new AggregateError(vecAllocationCleanupErrors, "Could not roll back address-attribute allocation.");
							}

							throw AllocationError;
						}
					}

					const bAttributeValueWriteResult = Write(unTargetAddress, strNormalizedTypeName, AttributeValue);
					if (bAttributeValueWriteResult !== true) {
						throw new Error("Unable to write the native address attribute.");
					}

					return;
				}

				const mapAddressValues = GetCustomTypeState(this).m_mapAddressValues;
				if (!(mapAddressValues instanceof Map)) {
					throw new TypeError("AddressAttribute requires a Map for custom-object retention.");
				}

				const unAttributeAddress = GetObjectAddress(AttributeValue);
				const unPreviousAttributeAddress = ReadAddress(unInstanceAddress, nAddressOffset);
				const bPreviousAttributeValueExists = Map.prototype.has.call(mapAddressValues, nAddressOffset);
				const PreviousAttributeValue = bPreviousAttributeValueExists ? Map.prototype.get.call(mapAddressValues, nAddressOffset) : undefined;
				let bAddressValueRetentionChanged = false;
				let bAddressWriteAttempted = false;

				try {
					Map.prototype.set.call(mapAddressValues, nAddressOffset, AttributeValue);
					bAddressValueRetentionChanged = true;
					bAddressWriteAttempted = true;

					const bAddressWriteResult = Write(unInstanceAddress, "address", unAttributeAddress, nAddressOffset);
					if (bAddressWriteResult !== true) {
						throw new Error("Unable to store the custom attribute address.");
					}
				} catch (AddressWriteError) {
					const vecAddressRestorationErrors = [];

					if (bAddressWriteAttempted) {
						try {
							const bAddressRestoreResult = Write(unInstanceAddress, "address", unPreviousAttributeAddress, nAddressOffset);
							if (bAddressRestoreResult !== true) {
								vecAddressRestorationErrors.push(new Error("Unable to restore the custom attribute address slot."));
							}
						} catch (AddressRestorationError) {
							vecAddressRestorationErrors.push(AddressRestorationError);
						}
					}

					if (bAddressValueRetentionChanged) {
						try {
							if (bPreviousAttributeValueExists) {
								Map.prototype.set.call(mapAddressValues, nAddressOffset, PreviousAttributeValue);
							} else if (!Map.prototype.delete.call(mapAddressValues, nAddressOffset)) {
								throw new Error("Unable to remove the failed address-attribute retention.");
							}
						} catch (RetentionRestorationError) {
							vecAddressRestorationErrors.push(RetentionRestorationError);
						}
					}

					if (vecAddressRestorationErrors.length > 0) {
						vecAddressRestorationErrors.unshift(AddressWriteError);
						throw new AggregateError(vecAddressRestorationErrors, "Could not restore the custom address attribute.");
					}

					throw AddressWriteError;
				}
			},
			Documentation: strDocumentationText,
		};
	}

	StaticInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("StaticInstanceArray strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("StaticInstanceArray nAddressOffset must be a bigint value.");
		}

		if ((unArrayLength !== null) && (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0))) {
			throw new RangeError("StaticInstanceArray unArrayLength must be a non-negative safe integer or null.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("StaticInstanceArray strDocumentationText must be a string or null.");
		}

		// Accessor keys are the ECMAScript descriptor contract; ArrayView.Set remains the project method.
		return {
			get() {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = Add(GetObjectAddress(this), nAddressOffset);

				return new ArrayView(mapManager, false, strTypeName, unArrayAddress, unArrayLength);
			},
			set(vecArrayValues) {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = Add(GetObjectAddress(this), nAddressOffset);
				const ArrayViewInstance = new ArrayView(mapManager, false, strTypeName, unArrayAddress, unArrayLength);
				let unArrayIndex = 0;
				// ArrayView.Set is fluent; failures propagate as exceptions rather than return statuses.
				for (const ElementValue of vecArrayValues) {
					ArrayViewInstance.Set(unArrayIndex, ElementValue);
					unArrayIndex += 1;
				}
			},
			Documentation: strDocumentationText,
		};
	}

	DynamicInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("DynamicInstanceArray strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("DynamicInstanceArray nAddressOffset must be a bigint value.");
		}

		if ((unArrayLength !== null) && (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0))) {
			throw new RangeError("DynamicInstanceArray unArrayLength must be a non-negative safe integer or null.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("DynamicInstanceArray strDocumentationText must be a string or null.");
		}

		return {
			get() {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = ReadAddress(GetObjectAddress(this), nAddressOffset);

				return new ArrayView(mapManager, false, strTypeName, unArrayAddress, unArrayLength);
			},
			set(vecArrayValues) {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = ReadAddress(GetObjectAddress(this), nAddressOffset);
				const ArrayViewInstance = new ArrayView(mapManager, false, strTypeName, unArrayAddress, unArrayLength);
				let unArrayIndex = 0;
				for (const ElementValue of vecArrayValues) {
					ArrayViewInstance.Set(unArrayIndex, ElementValue);
					unArrayIndex += 1;
				}
			},
			Documentation: strDocumentationText,
		};
	}

	StaticAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("StaticAddressArray strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("StaticAddressArray nAddressOffset must be a bigint value.");
		}

		if ((unArrayLength !== null) && (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0))) {
			throw new RangeError("StaticAddressArray unArrayLength must be a non-negative safe integer or null.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("StaticAddressArray strDocumentationText must be a string or null.");
		}

		return {
			get() {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = Add(GetObjectAddress(this), nAddressOffset);
				const setAllocatedAddresses = GetCustomTypeState(this).m_setAllocatedAddresses;
				const mapAddressValues = GetCustomTypeState(this).m_mapAddressValues;

				return new ArrayView(mapManager, true, strTypeName, unArrayAddress, unArrayLength, setAllocatedAddresses, mapAddressValues);
			},
			set(vecArrayValues) {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = Add(GetObjectAddress(this), nAddressOffset);
				const setAllocatedAddresses = GetCustomTypeState(this).m_setAllocatedAddresses;
				const mapAddressValues = GetCustomTypeState(this).m_mapAddressValues;
				const ArrayViewInstance = new ArrayView(mapManager, true, strTypeName, unArrayAddress, unArrayLength, setAllocatedAddresses, mapAddressValues);
				let unArrayIndex = 0;
				for (const ElementValue of vecArrayValues) {
					ArrayViewInstance.Set(unArrayIndex, ElementValue);
					unArrayIndex += 1;
				}
			},
			Documentation: strDocumentationText,
		};
	}

	DynamicAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("DynamicAddressArray strTypeName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("DynamicAddressArray nAddressOffset must be a bigint value.");
		}

		if ((unArrayLength !== null) && (!Number.isSafeInteger(unArrayLength) || (unArrayLength < 0))) {
			throw new RangeError("DynamicAddressArray unArrayLength must be a non-negative safe integer or null.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("DynamicAddressArray strDocumentationText must be a string or null.");
		}

		return {
			get() {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = ReadAddress(GetObjectAddress(this), nAddressOffset);
				const setAllocatedAddresses = GetCustomTypeState(this).m_setAllocatedAddresses;
				const mapAddressValues = GetCustomTypeState(this).m_mapAddressValues;

				return new ArrayView(mapManager, true, strTypeName, unArrayAddress, unArrayLength, setAllocatedAddresses, mapAddressValues);
			},
			set(vecArrayValues) {
				const mapManager = this.constructor.Manager;
				const unArrayAddress = ReadAddress(GetObjectAddress(this), nAddressOffset);
				const setAllocatedAddresses = GetCustomTypeState(this).m_setAllocatedAddresses;
				const mapAddressValues = GetCustomTypeState(this).m_mapAddressValues;
				const ArrayViewInstance = new ArrayView(mapManager, true, strTypeName, unArrayAddress, unArrayLength, setAllocatedAddresses, mapAddressValues);
				let unArrayIndex = 0;
				for (const ElementValue of vecArrayValues) {
					ArrayViewInstance.Set(unArrayIndex, ElementValue);
					unArrayIndex += 1;
				}
			},
			Documentation: strDocumentationText,
		};
	}

	VirtualFunction(unVTableIndex, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null) {
		if (!Number.isSafeInteger(unVTableIndex) || (unVTableIndex < 0)) {
			throw new RangeError("VirtualFunction unVTableIndex must be a non-negative safe integer.");
		}

		if (!Array.isArray(vecArgumentTypes)) {
			throw new TypeError("VirtualFunction vecArgumentTypes must be an array.");
		}

		if ((typeof strReturnType !== "string") || (strReturnType.trim().length === 0)) {
			throw new TypeError("VirtualFunction strReturnType must be a non-empty string.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("VirtualFunction strDocumentationText must be a string or null.");
		}

		const mapManager = this;
		const strCallReturnType = Type.IsNativeDataType(strReturnType) ? Type.NormalizeDataType(strReturnType) : strReturnType;
		const strCallingConvention = NormalizeConvention(strConvention);

		return {
			get() {
				const unThisAddress = GetObjectAddress(this);
				const unFunctionAddress = VirtualFunction(unThisAddress, unVTableIndex);
				if (IsNull(unFunctionAddress)) {
					throw new ReferenceError(`Unable to resolve virtual function at vtable index ${unVTableIndex}.`);
				}

				return new MemberFunction(mapManager, strCallReturnType, unFunctionAddress, this, vecArgumentTypes, strCallingConvention);
			},
			Documentation: strDocumentationText,
		};
	}

	Function(FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null) {
		if (!Array.isArray(vecArgumentTypes)) {
			throw new TypeError("Function vecArgumentTypes must be an array.");
		}

		if ((typeof strReturnType !== "string") || (strReturnType.trim().length === 0)) {
			throw new TypeError("Function strReturnType must be a non-empty string.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("Function strDocumentationText must be a string or null.");
		}

		const mapManager = this;
		const strCallReturnType = Type.IsNativeDataType(strReturnType) ? Type.NormalizeDataType(strReturnType) : strReturnType;
		const strCallingConvention = NormalizeConvention(strConvention);

		return {
			get() {
				const TypeConstructor = this.constructor;
				const strBinaryName = TypeConstructor.Binary;
				if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
					throw new TypeError("Custom type Binary must be a non-empty string.");
				}

				const unFunctionAddress = g_MemoryManagerRuntime.ResolveBinaryIdentifier(strBinaryName, FunctionIdentifier);
				if ((unFunctionAddress === null) || IsNull(unFunctionAddress)) {
					throw new ReferenceError(`Unable to resolve function "${FunctionIdentifier}" in "${strBinaryName}".`);
				}

				const Callable = CreateManagedCallable(mapManager, strCallReturnType, unFunctionAddress, this, vecArgumentTypes, strCallingConvention);
				Callable.Documentation = strDocumentationText;

				return Callable;
			},
			Documentation: strDocumentationText,
		};
	}

	FunctionTypedef(strTypeName, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", strDocumentationText = null) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("FunctionTypedef strTypeName must be a non-empty string.");
		}

		if (!Array.isArray(vecArgumentTypes)) {
			throw new TypeError("FunctionTypedef vecArgumentTypes must be an array.");
		}

		if ((typeof strReturnType !== "string") || (strReturnType.trim().length === 0)) {
			throw new TypeError("FunctionTypedef strReturnType must be a non-empty string.");
		}

		if ((strDocumentationText !== null) && (typeof strDocumentationText !== "string")) {
			throw new TypeError("FunctionTypedef strDocumentationText must be a string or null.");
		}

		const mapManager = this;
		const mapFunctionTypedefs = this.#m_mapFunctionTypedefs;
		if (!(mapFunctionTypedefs instanceof Map)) {
			throw new TypeError("TypeManager FunctionTypedefs must be a Map.");
		}

		const strCallReturnType = Type.IsNativeDataType(strReturnType) ? Type.NormalizeDataType(strReturnType) : strReturnType;
		const strCallingConvention = NormalizeConvention(strConvention);
		const CreateTypedFunction = (unFunctionAddress) => {
			const Callable = CreateManagedCallable(mapManager, strCallReturnType, unFunctionAddress, null, vecArgumentTypes, strCallingConvention);
			Callable.Documentation = strDocumentationText;

			return Callable;
		};

		Map.prototype.set.call(mapFunctionTypedefs, strTypeName, CreateTypedFunction);

		return CreateTypedFunction;
	}

	CreateFunctionTypedefsFromFile(strFilePath) {
		const vecDefaultArgumentTypes = [];
		const itTypeDefinitions = ParseData(this, g_MemoryManagerRuntime.LoadGameDataFile(strFilePath), [
			["Arguments", DataKey.AsArguments, vecDefaultArgumentTypes],
			["ReturnType", DataKey.AsReturnType, "void"],
			["Convention", DataKey.AsConvention, "cdecl"],
			["Documentation", DataKey.AsString, null],
		]);
		for (const [strTypeName, vecTypeValues] of itTypeDefinitions) {
			const [vecParsedArgumentTypes, strReturnType, strConvention, strDocumentationText] = vecTypeValues;
			const vecArgumentTypes = (vecParsedArgumentTypes === vecDefaultArgumentTypes) ? [] : vecParsedArgumentTypes;
			this.FunctionTypedef(strTypeName, vecArgumentTypes, strReturnType, strConvention, strDocumentationText);
		}
	}

	CreateTypeFromGameData(strTypeName, strGameDataKind, strGameDataFileName, BaseType = CustomType, strSDKBranch = g_MemoryManagerRuntime.BRANCH) {
		const TypeDefinition = g_SourceGameDataRuntime.LoadGameData(strGameDataKind, strGameDataFileName, strSDKBranch);

		return this.CreateTypeFromObject(strTypeName, TypeDefinition, BaseType);
	}

	GlobalAddress(TypeReference, strBinaryName, AddressIdentifier, nAddressOffset = 0n, unDereferenceCount = 0, bServerCheck = true, bIsAccessor = false, nAccessorAddressOffset = 0n) {
		if ((typeof strBinaryName !== "string") || (strBinaryName.trim().length === 0)) {
			throw new TypeError("GlobalAddress strBinaryName must be a non-empty string.");
		}

		if (typeof nAddressOffset !== "bigint") {
			throw new TypeError("GlobalAddress nAddressOffset must be a bigint value.");
		}

		if (!Number.isSafeInteger(unDereferenceCount) || (unDereferenceCount < 0)) {
			throw new RangeError("GlobalAddress unDereferenceCount must be a non-negative safe integer.");
		}

		if (typeof bServerCheck !== "boolean") {
			throw new TypeError("GlobalAddress bServerCheck must be a boolean.");
		}

		if (typeof bIsAccessor !== "boolean") {
			throw new TypeError("GlobalAddress bIsAccessor must be a boolean.");
		}

		if (typeof nAccessorAddressOffset !== "bigint") {
			throw new TypeError("GlobalAddress nAccessorAddressOffset must be a bigint value.");
		}

		let strTypeName = null;
		let TypeConstructor = null;

		if (typeof TypeReference === "string") {
			if (TypeReference.trim().length === 0) {
				throw new TypeError("GlobalAddress TypeReference must be a non-empty string or registered constructor.");
			}

			strTypeName = TypeReference;
			TypeConstructor = this.GetClass(strTypeName);
		} else if (IsCustomTypeConstructor(TypeReference)) {
			TypeConstructor = TypeReference;
			for (const [strRegisteredTypeName, RegisteredTypeConstructor] of this) {
				if (RegisteredTypeConstructor === TypeConstructor) {
					strTypeName = strRegisteredTypeName;
					break;
				}
			}
		}

		if ((strTypeName === null) || (TypeConstructor === null)) {
			throw new ReferenceError("GlobalAddress expects a registered TypeReference name or constructor.");
		}

		const mapGlobalAddresses = this.#m_mapGlobalAddresses;
		if (!(mapGlobalAddresses instanceof Map)) {
			throw new TypeError("TypeManager GlobalAddresses must be a Map.");
		}

		const unResolvedAddress = g_MemoryManagerRuntime.ResolveBinaryIdentifier(strBinaryName, AddressIdentifier);
		if ((unResolvedAddress === null) || IsNull(unResolvedAddress)) {
			throw new ReferenceError("Unable to find the global address.");
		}

		let unGlobalAddressValue = ApplyAddressTransform(unResolvedAddress, nAddressOffset, bIsAccessor ? 0 : unDereferenceCount);
		if (bIsAccessor) {
			const unAccessorDisplacement = ReadAddress(unResolvedAddress, nAccessorAddressOffset);
			const unAccessorFunctionAddress = Add(unGlobalAddressValue, unAccessorDisplacement);
			const unAccessorResultAddress = g_MemoryHooksRuntime.CallFunction({ Address: unAccessorFunctionAddress, Arguments: [], Convention: "cdecl", ReturnType: "address" });
			if ((unAccessorResultAddress === null) || IsNull(unAccessorResultAddress)) {
				throw new ReferenceError("The global-address accessor returned a null address.");
			}

			unGlobalAddressValue = ApplyAddressTransform(unAccessorResultAddress, 0n, unDereferenceCount);
		}

		if (IsNull(unGlobalAddressValue)) {
			throw new ReferenceError("The resolved global address is null.");
		}

		const GlobalAddressValue = MakeObject(TypeConstructor, unGlobalAddressValue);
		GlobalAddressValue.ServerAddressCheck = bServerCheck;
		Map.prototype.set.call(mapGlobalAddresses, strTypeName, GlobalAddressValue);

		return GlobalAddressValue;
	}

	CreateGlobalAddressesFromObject(GlobalAddressDefinitions) {
		const itGlobalAddressEntries = ParseData(this, GlobalAddressDefinitions, [
			["Binary", DataKey.AsString, NO_DEFAULT],
			["Identifier", DataKey.AsIdentifier, NO_DEFAULT],
			["Offset", DataKey.AsInt64, 0n],
			["Level", DataKey.AsInteger, 0],
			["ServerCheck", DataKey.AsBoolean, true],
			["Accessor", DataKey.AsBoolean, false],
			["AccessorOffset", DataKey.AsInt64, 0n],
		]);
		for (const [strTypeName, vecGlobalAddressValues] of itGlobalAddressEntries) {
			const [
				strBinaryName,
				AddressIdentifier,
				nAddressOffset,
				unDereferenceCount,
				bServerCheck,
				bIsAccessor,
				nAccessorAddressOffset,
			] = vecGlobalAddressValues;
			this.GlobalAddress(strTypeName, strBinaryName, AddressIdentifier, nAddressOffset, unDereferenceCount, bServerCheck, bIsAccessor, nAccessorAddressOffset);
		}
	}

	CreateGlobalAddressesFromFile(strFilePath) {
		const GlobalAddressDefinitions = g_MemoryManagerRuntime.LoadGameDataFile(strFilePath);
		this.CreateGlobalAddressesFromObject(GlobalAddressDefinitions);
	}

	CreateGlobalAddressesFromGameData(strSDKBranch = g_MemoryManagerRuntime.BRANCH) {
		const GlobalAddressDefinitions = g_SourceGameDataRuntime.LoadGameData("memory", "GlobalAddresses.ini", strSDKBranch);
		this.CreateGlobalAddressesFromObject(GlobalAddressDefinitions);
	}

	GetGlobalAddress(TypeReference) {
		const mapGlobalAddresses = this.#m_mapGlobalAddresses;
		if (!(mapGlobalAddresses instanceof Map)) {
			throw new TypeError("TypeManager GlobalAddresses must be a Map.");
		}

		if (typeof TypeReference === "string") {
			if (TypeReference.trim().length === 0) {
				throw new TypeError("GetGlobalAddress TypeReference must be a non-empty string or registered constructor.");
			}

			if (!Map.prototype.has.call(mapGlobalAddresses, TypeReference)) {
				throw new ReferenceError(`No global address found for "${TypeReference}".`);
			}

			return Map.prototype.get.call(mapGlobalAddresses, TypeReference);
		}

		if (IsCustomTypeConstructor(TypeReference)) {
			for (const GlobalAddressValue of Map.prototype.values.call(mapGlobalAddresses)) {
				if (GlobalAddressValue.constructor === TypeReference) {
					return GlobalAddressValue;
				}
			}
		}

		throw new ReferenceError("No global address found for the requested type.");
	}

	GetClass(strTypeName) {
		if ((typeof strTypeName !== "string") || (strTypeName.trim().length === 0)) {
			throw new TypeError("GetClass expects a non-empty strTypeName.");
		}

		if (Map.prototype.has.call(this, strTypeName)) {
			const LocalTypeConstructor = Map.prototype.get.call(this, strTypeName);
			if ((typeof LocalTypeConstructor !== "function") || (typeof LocalTypeConstructor.CreateFromAddress !== "function")) {
				throw new TypeError(`Local object type "${strTypeName}" must expose CreateFromAddress().`);
			}

			return LocalTypeConstructor;
		}

		const RegisteredTypeConstructor = ObjectType(strTypeName);
		if (RegisteredTypeConstructor === null) {
			return null;
		}

		if ((typeof RegisteredTypeConstructor !== "function") || (typeof RegisteredTypeConstructor.CreateFromAddress !== "function")) {
			throw new TypeError(`Registered object type "${strTypeName}" must expose CreateFromAddress().`);
		}

		return RegisteredTypeConstructor;
	}

	get GlobalAddresses() {
		return this.#m_mapGlobalAddresses;
	}

	get Converters() {
		return this.#m_mapConverters;
	}

	get FunctionTypedefs() {
		return this.#m_mapFunctionTypedefs;
	}

	#m_mapGlobalAddresses;
	#m_mapConverters;
	#m_mapFunctionTypedefs;
}

const g_mapManager = new TypeManager();

g_MemoryManagerRuntime.ARCHITECTURE = g_strArchitecture;
g_MemoryManagerRuntime.BRANCH = g_strBranch;
g_MemoryManagerRuntime.DATA_ROOT = g_strDataRoot;
g_MemoryManagerRuntime.GetAllBinaries = GetAllBinaries;
g_MemoryManagerRuntime.GetAllGameDataFiles = GetAllGameDataFiles;
g_MemoryManagerRuntime.GetBinary = GetBinary;
g_MemoryManagerRuntime.GetBinarySymbol = GetBinarySymbol;
g_MemoryManagerRuntime.GetGameDataOffset = GetGameDataOffset;
g_MemoryManagerRuntime.GetGameDataAddress = GetGameDataAddress;
g_MemoryManagerRuntime.GetGameDataSignature = GetGameDataSignature;
g_MemoryManagerRuntime.GetGameDataValue = GetGameDataValue;
g_MemoryManagerRuntime.GetPackagedGameDataRootPath = function GetPackagedGameDataRootPath() {
	return g_strDataRoot;
};

g_MemoryManagerRuntime.GetProjectGameDataRootPath = function GetProjectGameDataRootPath() {
	return g_strRoot;
};

g_MemoryManagerRuntime.LoadGameDataFile = LoadGameDataFile;
g_MemoryManagerRuntime.CreateGameDataCallableOptions = CreateGameDataCallableOptions;
g_MemoryManagerRuntime.ResolveBinaryIdentifier = ResolveBinaryIdentifier;
g_MemoryManagerRuntime.ScanBinary = ScanBinary;
g_MemoryManagerRuntime.SelectRuntimeValue = SelectRuntimeValue;
g_MemoryManagerRuntime.PLATFORM = g_strPlatform;
g_MemoryManagerRuntime.ROOT = g_strRoot;
g_MemoryManagerRuntime.CustomType = CustomType;
g_MemoryManagerRuntime.GetGameDataPaths = GetGameDataPaths;
g_MemoryManagerRuntime.LoadGameData = LoadGameData;
g_MemoryManagerRuntime.Manager = g_mapManager;
g_MemoryManagerRuntime.TypeManager = TypeManager;

module.exports = g_MemoryManagerRuntime;
