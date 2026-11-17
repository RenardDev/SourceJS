# `require("memory/manager")`

> Warning: this page is long and documents process-memory operations. AI agents should use the table of contents while processing each bounded chunk in order.

`memory/manager` lives at `packages/sourcejs/memory/manager.js`. It combines the native GameData resolver with JavaScript-owned type descriptors, converters, callable pipes and global-address objects. Use it when a plugin needs a reusable memory layout or must resolve a function from selected-SDK data instead of embedding one platform-specific address.

Resolved addresses are JavaScript `BigInt` values. A `CustomType` created with `new` owns its allocation; an object created with `CreateFromAddress()` is only a live view and must not free the foreign memory. Validate the selected SDK, platform, architecture, signature bytes and lifetime before reading, writing, calling or hooking an address.

Related documentation:

- [memory.md](memory.md) for allocation, calls and native data types.
- [memory-gamedata.md](memory-gamedata.md) for branch-aware Source data files.
- [memory-helpers.md](memory-helpers.md) for descriptors and address views.
- [memory-hooks.md](memory-hooks.md) for Detours hooks and trampolines.

Selected-SDK rule: check that the selected build exposes every native operation a descriptor needs. Registering a type does not add missing engine capabilities or make an incompatible ABI callable.

## Contents

- [Import](#import)
- [Runtime model](#runtime-model)
- [Exports](#exports)
- [`CustomType`](#customtype)
- [`TypeManager`](#typemanager)
- [Examples](#examples)
- [Errors and lifecycle](#errors-and-lifecycle)

## Import

```js
const {
	ARCHITECTURE,
	BRANCH,
	DATA_ROOT,
	Manager,
	PLATFORM,
	ROOT,
	SOURCE_MOD_GAME_DATA_ROOT,
	CustomType,
	TypeManager,
	CreateGameDataCallableOptions,
	GetAllBinaries,
	GetAllGameDataFiles,
	GetBinary,
	GetBinarySymbol,
	GetGameDataOffset,
	GetGameDataPaths,
	GetGameDataAddress,
	GetGameDataSignature,
	GetGameDataValue,
	GetPackagedGameDataRootPath,
	GetProjectGameDataRootPath,
	LoadGameData,
	LoadGameDataFile,
	ResolveBinaryIdentifier,
	ScanBinary,
	SelectRuntimeValue,
} = require("memory/manager");

const g_vecCallableFunctions = [
	CreateGameDataCallableOptions,
	GetAllBinaries,
	GetAllGameDataFiles,
	GetBinary,
	GetBinarySymbol,
	GetGameDataOffset,
	GetGameDataPaths,
	GetGameDataAddress,
	GetGameDataSignature,
	GetGameDataValue,
	GetPackagedGameDataRootPath,
	GetProjectGameDataRootPath,
	LoadGameData,
	LoadGameDataFile,
	ResolveBinaryIdentifier,
	ScanBinary,
	SelectRuntimeValue,
];

function IsCallableFunction(FunctionValue) {
	return typeof FunctionValue === "function";
}

function IsNonEmptyString(strValueMetadata) {
	return (typeof strValueMetadata === "string") && (strValueMetadata.length > 0);
}

if ((typeof CustomType !== "function") || (typeof TypeManager !== "function") || !(Manager instanceof TypeManager) || !g_vecCallableFunctions.every(IsCallableFunction)) {
	throw new Error("Memory manager did not expose its complete callable API.");
}

if (![ARCHITECTURE, BRANCH, DATA_ROOT, PLATFORM, ROOT].every(IsNonEmptyString) || (typeof SOURCE_MOD_GAME_DATA_ROOT !== "string")) {
	throw new Error("Memory manager did not expose the selected runtime metadata.");
}
```

The module and its `Manager` singleton belong to the current plugin context. Types and converters registered by one plugin are not visible to another plugin.

## Runtime model

- `ROOT` and `DATA_ROOT` both point at `addons/sourcejs/gamedata`. Ordinary relative manager GameData paths resolve under this single directory. POSIX-rooted paths and Windows rooted or drive-qualified paths retain their native filesystem meaning; this resolution is not a sandbox or a traversal restriction.
- File-load paths must be non-empty strings. Invalid path types and empty strings throw `TypeError` before filesystem access, without invoking caller-defined string conversion.
- `GetAllGameDataFiles()`, `LoadGameDataFile()`, `GetGameDataValue()`, `GetGameDataOffset()`, `GetGameDataSignature()` and `CreateGameDataCallableOptions()` use that shared root. Relative `.txt` lookups prefer the [startup snapshot](memory-gamedata.md); absolute paths remain explicit.
- `LoadGameData()` and `TypeManager.CreateTypeFromGameData()` read branch-aware Source data under `SOURCE_DATA_ROOT` (`addons/sourcejs/data/sourcejs`) through `memory/gamedata`, separate from the manager GameData root at `addons/sourcejs/gamedata`.
- `GetBinary()`, `GetAllBinaries()`, `ScanBinary()`, `GetBinarySymbol()` and `ResolveBinaryIdentifier()` inspect modules already loaded in the game process. These inspection helpers, file loading, and GameData parsing complete synchronously and can block the game thread.
- `CustomType` instances own or wrap an address. Each registered property follows its descriptor: memory-backed accessors read or write the live address when accessed; value and function descriptors retain their declared JavaScript behavior.
- `TypeManager` extends `Map`; registered type names are map keys and constructors are map values.

## Exports

| Export | Kind | Result |
| --- | --- | --- |
| [`CustomType`](#customtype-1) | Class | Base class for an owned allocation or a non-owning address view. |
| [`GetBinary(strBinaryName = "")`](#getbinary) | Function | Returns one loaded binary record or `null`; an empty name selects the first binary in native enumeration order. |
| [`TypeManager`](#typemanager-1) | Class | Context-local registry for memory types, converters and global-address objects; each callable retains its own calling-convention metadata. |
| `ARCHITECTURE` | String | Selected build architecture, `x86` or `x64`. |
| [`GetAllBinaries()`](#getallbinaries) | Function | Returns loaded binary records with `Name`, `Path`, BigInt `Address` and `ByteCount`. |
| [`BRANCH`](#branch) | String | Selected HL2SDK branch. |
| [`DATA_ROOT`](#data_root) | String | Addon GameData root; currently the same path as `ROOT`. |
| `SOURCE_MOD_GAME_DATA_ROOT` | String | Active managed snapshot directory at runtime startup; an empty string means no downloaded snapshot is available. |
| [`GetPackagedGameDataRootPath()`](#getpackagedgamedatarootpath) | Function | Returns the native addon GameData root path, the same path as `ROOT` and `DATA_ROOT`. |
| [`GetAllGameDataFiles()`](#getallgamedatafiles) | Function | Returns `{ Name, Path }` records for addon GameData and the active snapshot, without duplicate relative file paths or backup copies. |
| [`GetGameDataPaths(strGameDataKind, strGameDataFileName, strSDKBranch = BRANCH)`](#getgamedatapaths) | Function | Builds ordered candidate paths under `SOURCE_DATA_ROOT` for the requested kind, file and SDK branch; it does not check whether the files exist. |
| [`GetGameDataValue(strFilePath, strPropertyPath = null)`](#getgamedatavalue) | Function | Loads `strFilePath`, optionally traverses a dot-separated property path (`null` when a segment is absent), then selects matching branch/platform/architecture values. |
| [`LoadGameDataFile(strFilePath)`](#loadgamedatafile) | Function | Reads the path; `.txt` files are parsed as KeyValues, and other extensions as JSON. |
| [`LoadGameData(strGameDataKind, strGameDataFileName, strSDKBranch = BRANCH)`](#loadgamedata) | Function | Loads existing common and branch-specific files from `SOURCE_DATA_ROOT` in order, recursively merges them, and caches the resulting object. |
| [`Manager`](#manager) | `TypeManager` | Context-local default type manager. |
| [`GetBinarySymbol(strBinaryName, strSymbolName)`](#getbinarysymbol) | Function | Returns a symbol's BigInt address or `null`; Windows uses exports, Linux also supports local ELF symbols in a named module's intact on-disk symbol table. |
| [`PLATFORM`](#platform) | String | Selected build platform, `linux` or `windows`. |
| [`ResolveBinaryIdentifier(strBinaryName, Identifier)`](#resolvebinaryidentifier) | Function | Accepts BigInt, symbol/pattern strings, or selector objects with exactly one of `Address`, `Identifier`, `Symbol` or `Pattern` (and optional `Module`). BigInts pass through unchanged; this is not address-validity checking. Number addresses or wrong selector-key counts throw; unsupported identifier types and unresolved lookups return `null`. |
| [`ScanBinary(strBinaryName, strBytePattern)`](#scanbinary) | Function | Scans a loaded binary for a byte pattern and returns a BigInt address or `null`. |
| [`GetGameDataOffset(strFilePath, strOffsetName)`](#getgamedataoffset) | Function | Returns the selected `Offsets[strOffsetName]` value, or `null` when the section or key is absent; the helper does not enforce an integer result. |
| [`CreateGameDataCallableOptions(strFilePath, strCallableName)`](#creategamedatacallableoptions) | Function | Returns `{ Arguments, Convention, Address, ReturnType }` for the named `Functions` entry, applying defaults and resolving its binary identifier; absent, non-object, or array entries return `null`. An unresolved identifier leaves `Address` as `null`. |
| [`ROOT`](#root) | String | Addon GameData root; currently the same path as `DATA_ROOT`. |
| [`GetGameDataAddress(strFilePath, strAddressName)`](#getgamedataaddress) | Function | Resolves selected `Signatures[strAddressName]` data to a BigInt address (default module `server`); absent, non-object, or array entries return `null`. |
| [`SelectRuntimeValue(RuntimeValue)`](#selectruntimevalue) | Function | Recursively selects matching keys in priority order: `BRANCH`, `PLATFORM` with `64` appended only for `x64`, `PLATFORM`, then `ARCHITECTURE`; unmatched objects are returned unchanged. |
| [`GetGameDataSignature(strFilePath, strSignatureName)`](#getgamedatasignature) | Function | Returns the selected `Signatures[strSignatureName]` value, or `null` when the section or key is absent. |
| [`GetProjectGameDataRootPath()`](#getprojectgamedatarootpath) | Function | Returns the native addon GameData root path, the same path as `ROOT` and `DATA_ROOT`. |

## `CustomType`

`CustomType` extends `BaseAddress`. Do not instantiate `CustomType` itself: register a subclass through a `TypeManager` first.

Ownership and tracking references are stored privately, without public `m_*` fields or aliases. `OwnsAddress`, `AllocatedAddresses`, and `AddressValues` are read-only properties; the returned `Set` and `Map` remain live and mutable. `ServerAddressCheck` retains its existing read/write behavior. Generated address and array attributes use the same private tracking state, so shadowing a public property does not replace ownership records.

`new RegisteredType(...vecConstructorArguments)` validates the allocation size and callback metadata before acquiring native storage. Base construction, ownership-state setup, and `ConstructorCallback` are covered by rollback. An early setup failure releases the raw address without accessing an unavailable or partially initialized instance or invoking its destructor. Once ownership tracking is complete, a callback failure uses the instance's `Deallocate()` path. Construction failures preserve the original exception; if rollback also fails, `AggregateError.errors` contains the construction failure followed by the cleanup failure. Non-owning views skip allocation and the constructor callback.

Construction and deallocation invoke their callbacks synchronously and ignore callback return values, including promises. Only exceptions thrown to the caller participate in rollback or release failure handling; rejected promises are not awaited or handled by these lifecycle methods. Keep a borrowed view's storage live for every operation; creating a view does not validate its native layout, readability, or ownership.

### Static properties

| Property | Meaning |
| --- | --- |
| [`Manager`](#manager) | The registering `TypeManager`; `null` before registration. |
| `Binary` | Binary name used to resolve this type's `Function` properties. |
| `ServerCheck` | Defaults to `true` and is copied to each instance's internal server-address check state. |
| `TypeSize` | Positive allocation size required by `new`. |
| `ClassInfo` | Metadata passed to the memory object-type registry. |
| `ConstructorCallback` | Optional callback invoked on the allocated instance with constructor arguments. |
| `DestructorCallback` | Optional callback invoked before an owned allocation is released. |

### Instance properties

| Property | Meaning |
| --- | --- |
| `Address` | Read-only current base address as a `bigint`, inherited from `BaseAddress`. |
| `OwnsAddress` | `true` while the instance owns its allocation; `false` for wrapped views or after deallocation. |
| `AllocatedAddresses` | Mutable `Set` tracking child addresses; successful owned deallocation releases them and clears the set. |
| `AddressValues` | Mutable `Map` retaining JavaScript values for custom address attributes; cleared after successful owned deallocation. |
| `ServerAddressCheck` | Read/write per-instance flag initialized from the registered type's `ServerCheck`; changing it does not change the type's default. |

Track only uniquely owned child allocations in `AllocatedAddresses`; never add the base address or borrowed storage. Child release is not atomic: already released children are removed from the set, while a failed child release leaves the base allocation and `AddressValues` intact for retry. A successfully completed destructor is not called again by `Deallocate()` retries; a throwing destructor can be retried. Do not recursively call `Deallocate()` from the destructor.

### Methods

| Member | Result |
| --- | --- |
| `new RegisteredType(...vecConstructorArguments)` | Allocates `TypeSize` bytes and optionally invokes `ConstructorCallback`. |
| `RegisteredType.CreateFromAddress(unAddress, nAddressOffset = 0n)` | Returns a non-owning live view at `unAddress + nAddressOffset`. |
| `GetMemoryAddress()` | Returns the current address as a `bigint`. |
| `Add(nAddressOffset)` | Returns a non-owning object of the same class at `Address + nAddressOffset`. |
| `Subtract(nAddressOffset)` | Returns a non-owning object of the same class at `Address - nAddressOffset`. |
| `Deallocate()` | On an owned instance, releases tracked children before the base allocation and returns `true` only when the base is released. Non-owning or null-address instances return `false` without invoking the destructor or clearing tracking collections. Invalid tracking data, destructor failures, and release failures can throw after partial progress. |
| `OnDeallocate()` | Invokes the registered `DestructorCallback`; subclasses may override it. Direct calls neither release storage nor update `Deallocate()`'s destructor-once guard. |

## `TypeManager`

The manager's auxiliary tables are private, without public `m_*` fields or aliases. `GlobalAddresses`, `Converters`, and `FunctionTypedefs` are read-only properties returning the existing live, mutable maps; no table is copied or frozen.

### Properties

| Property | Meaning |
| --- | --- |
| Map entries | Each registered type name maps to its `CustomType` subclass constructor. |
| `GlobalAddresses` | Each type name maps to its live global-address object. |
| `Converters` | Each converter name maps to a callback invoked with the address to convert. |
| `FunctionTypedefs` | Function-typedef name to a factory that creates its typed callable from an address. |

### Methods

| Member | Signature |
| --- | --- |
| `Convert` | `Convert(strTypeName, unAddress)` |
| `CreateConverter` | `CreateConverter(strTypeName)` |
| `CreateFunctionTypedefsFromFile` | `CreateFunctionTypedefsFromFile(strFilePath)` |
| `CreateGlobalAddressesFromObject` | `CreateGlobalAddressesFromObject(GlobalAddressDefinitions)` |
| `CreateGlobalAddressesFromFile` | `CreateGlobalAddressesFromFile(strFilePath)` |
| `CreateGlobalAddressesFromGameData` | `CreateGlobalAddressesFromGameData(strSDKBranch = BRANCH)` |
| `CreatePipe` | `CreatePipe(PipeDescriptor = {})` |
| `CreatePipeFromObject` | `CreatePipeFromObject(PipeDefinition)` |
| `CreatePipeFromFile` | `CreatePipeFromFile(strFilePath)` |
| `CreateType` | `CreateType(strTypeName, TypeDescriptor = {}, BaseType = CustomType)` |
| `CreateTypeFromObject` | `CreateTypeFromObject(strTypeName, TypeDefinition, BaseType = CustomType)` |
| `CreateTypeFromFile` | `CreateTypeFromFile(strTypeName, strFilePath, BaseType = CustomType)` |
| `CreateTypeFromGameData` | `CreateTypeFromGameData(strTypeName, strGameDataKind, strGameDataFileName, BaseType = CustomType, strSDKBranch = BRANCH)` |
| `DefineType` | `DefineType(strTypeName, TypeConstructor, TypeDescriptor = {})` |
| `DynamicInstanceArray` | `DynamicInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` |
| `DynamicAddressArray` | `DynamicAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` |
| `Function` | `Function(FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null)` |
| `FunctionTypedef` | `FunctionTypedef(strTypeName, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", strDocumentationText = null)` |
| `GetClass` | `GetClass(strTypeName)` |
| `GetGlobalAddress` | `GetGlobalAddress(TypeReference)` |
| `GlobalAddress` | `GlobalAddress(TypeReference, strBinaryName, AddressIdentifier, nAddressOffset = 0n, unDereferenceCount = 0, bServerCheck = true, bIsAccessor = false, nAccessorAddressOffset = 0n)` |
| `InstanceAttribute` | `InstanceAttribute(strTypeName, nAddressOffset, strDocumentationText = null)` |
| `PipeFunction` | `PipeFunction(strBinaryName, FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", bServerCheck = true, strDocumentationText = null)` |
| `AddressAttribute` | `AddressAttribute(strTypeName, nAddressOffset, strDocumentationText = null)` |
| `RegisterConverter` | `RegisterConverter(strConverterName, Converter)` |
| `RegisterType` | `RegisterType(strTypeName, TypeConstructor)` |
| `StaticInstanceArray` | `StaticInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` |
| `StaticAddressArray` | `StaticAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` |
| `UnregisterConverter` | `UnregisterConverter(strConverterName)` |
| `VirtualFunction` | `VirtualFunction(unVTableIndex, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null)` |

## Examples

### `CustomType`

Registering a type supplies `new` with an allocation size and live field descriptors. Each instance owns that allocation and attempts release once in `finally`. Operation and cleanup failures are preserved in order, including thrown primitive values; a failed native release is reported rather than silently retried.

```js
const { DataType } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class DocumentationCounter extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("DocumentationCounter", DocumentationCounter, {
	Size: 4,
	Properties: {
		Value: g_mapManagerInstance.InstanceAttribute(DataType.Int, 0n, "Current counter value."),
	},
});

const g_vecErrors = [];
const g_Counter = new DocumentationCounter();
try {
	g_Counter.Value = 41;
	g_Counter.Value += 1;

	if ((typeof g_Counter.Address !== "bigint") || (g_Counter.Address <= 0n) || !g_Counter.OwnsAddress || (g_Counter.Value !== 42) || (g_Counter.GetMemoryAddress() !== g_Counter.Address)) {
		throw new Error("The registered type did not expose its owned live allocation.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_Counter.Deallocate() !== true) {
			throw new Error("The registered type did not release its owned allocation.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CustomType example and cleanup failed.");
}

if ((g_Counter.Deallocate() !== false) || !g_Counter.Null || g_Counter.OwnsAddress) {
	throw new Error("CustomType reported an invalid state after deallocation.");
}
```

### `TypeManager`

`new TypeManager()` creates independent class, function-typedef, and converter registries. `Convert(strTypeName, unAddress)` resolves them in that order and passes the nonnegative BigInt address to the selected class view or callable.

```js
const { GetBinary, TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_vecErrors = [];

function ConvertAddressToHexadecimal(unAddress) {
	return `0x${unAddress.toString(16)}`;
}

try {
	if (g_mapManagerInstance.RegisterConverter("AddressHexadecimal", ConvertAddressToHexadecimal) !== ConvertAddressToHexadecimal) {
		throw new Error("TypeManager.RegisterConverter() did not retain the converter callback.");
	}

	const ServerBinary = GetBinary("server");
	if (ServerBinary === null) {
		throw new Error("The server binary is not loaded.");
	}

	const strConvertedAddress = g_mapManagerInstance.Convert("AddressHexadecimal", ServerBinary.Address);
	if (strConvertedAddress !== `0x${ServerBinary.Address.toString(16)}`) {
		throw new Error("TypeManager.Convert() did not invoke the registered address converter.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_mapManagerInstance.Converters.get("AddressHexadecimal") === ConvertAddressToHexadecimal) && (g_mapManagerInstance.UnregisterConverter("AddressHexadecimal") !== true)) {
			throw new Error("TypeManager.UnregisterConverter() did not remove its converter.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.Converters.get("AddressHexadecimal") === ConvertAddressToHexadecimal) {
			throw new Error("TypeManager retained the example's converter after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "TypeManager example and cleanup failed.");
}
```

### `ARCHITECTURE` and `PLATFORM`

`ARCHITECTURE` and `PLATFORM` identify the current SourceJS build target. Use both to select ABI-specific metadata for loaded binaries; address width alone does not determine the calling convention.

```js
const { ARCHITECTURE, PLATFORM } = require("memory/manager");

if (!["linux", "windows"].includes(PLATFORM) || !["x86", "x64"].includes(ARCHITECTURE)) {
	throw new Error(`Unsupported selected ABI: ${PLATFORM}/${ARCHITECTURE}.`);
}
```

### `GetAllBinaries`

Each record contains `Name`, `Path`, `Address` (a BigInt base address), and `ByteCount` (the range size in bytes). `ScanBinary()` searches the loaded range by binary name.

```js
const { GetAllBinaries } = require("memory/manager");

const g_vecLoadedBinaries = GetAllBinaries();
if (!Array.isArray(g_vecLoadedBinaries) || (g_vecLoadedBinaries.length === 0)) {
	throw new Error("The engine did not report any loaded binaries.");
}

for (const BinaryRecord of g_vecLoadedBinaries) {
	const bValidName = (typeof BinaryRecord.Name === "string") && (BinaryRecord.Name.length > 0);
	const bValidAddress = (typeof BinaryRecord.Address === "bigint") && (BinaryRecord.Address > 0n);
	const bValidByteCount = Number.isSafeInteger(BinaryRecord.ByteCount) && (BinaryRecord.ByteCount > 0);
	const bValidPath = typeof BinaryRecord.Path === "string";
	if (!bValidName || !bValidAddress || !bValidByteCount || !bValidPath) {
		throw new Error("GetAllBinaries() returned an invalid loaded-module record.");
	}
}
```

### `GetBinary`

```js
const { GetBinary } = require("memory/manager");

const g_ServerBinary = GetBinary("server");
if (g_ServerBinary === null) {
	throw new Error("The server binary is not loaded.");
}

if ((typeof g_ServerBinary.Address !== "bigint") || (g_ServerBinary.Address <= 0n) || !Number.isSafeInteger(g_ServerBinary.ByteCount) || (g_ServerBinary.ByteCount <= 0)) {
	throw new Error("GetBinary() returned an invalid server-module range.");
}
```

### `BRANCH`

```js
const { ARCHITECTURE, BRANCH, PLATFORM } = require("memory/manager");

if ((typeof BRANCH !== "string") || (BRANCH.length === 0) || !["linux", "windows"].includes(PLATFORM) || !["x86", "x64"].includes(ARCHITECTURE)) {
	throw new Error("The selected SDK metadata is incomplete.");
}
```

### `CreateGameDataCallableOptions`

`CreateGameDataCallableOptions(strFilePath, strCallableName)` builds options from the selected `Functions` entry without invoking it. Ensure the resolved address, convention, argument types, and return type match the loaded binary; incorrect native-call metadata is unsafe. The following metadata represents the SDK's `CreateInterface(const char*, int*)` signature; it does not call `CreateInterface`. Its convention is `"cdecl"` on every supported target; SourceJS prepares the selected build's native ABI automatically.

File-writing examples below require isolated example paths with no concurrent writers. The existence check refuses an existing file but is not atomic exclusive creation. Cleanup attempts removal once, checks that the file is absent, and preserves operation, cleanup, and verification failures in order, including thrown primitive values. Do not use these examples to manage shared or foreign files.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	ROOT,
	CreateGameDataCallableOptions,
	GetBinary,
	GetBinarySymbol,
} = require("memory/manager");

const g_ServerBinary = GetBinary("server");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-options.json`;
const g_strCallingConvention = "cdecl";

if ((g_ServerBinary === null) || (typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("The server binary is not loaded.");
}

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_GameDataDefinition = {
	Functions: {
		DocumentationCreateInterface: {
			Arguments: ["string", "address"],
			Convention: g_strCallingConvention,
			Identifier: "CreateInterface",
			ReturnType: "address",
		},
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GameDataDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const CallOptions = CreateGameDataCallableOptions(g_strFilePath, "DocumentationCreateInterface");
	if (CallOptions === null) {
		throw new Error("CreateGameDataCallableOptions() did not return callable options.");
	}

	const bMatchingAddress = CallOptions.Address === g_unCreateInterfaceAddress;
	const bMatchingCallingConvention = CallOptions.Convention === g_strCallingConvention;
	const bMatchingReturnDataType = CallOptions.ReturnType === "address";
	const bValidArgumentDataTypes = Array.isArray(CallOptions.Arguments) && (CallOptions.Arguments.length === 2) && (CallOptions.Arguments[0] === "string") && (CallOptions.Arguments[1] === "address");
	if (!bMatchingAddress || !bMatchingCallingConvention || !bMatchingReturnDataType || !bValidArgumentDataTypes) {
		throw new Error("CreateGameDataCallableOptions() did not preserve the selected ABI record.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `DATA_ROOT`

```js
const { DATA_ROOT, GetPackagedGameDataRootPath } = require("memory/manager");

if ((typeof DATA_ROOT !== "string") || (DATA_ROOT.length === 0) || (GetPackagedGameDataRootPath() !== DATA_ROOT)) {
	throw new Error("The packaged GameData root does not match the binding-initialization path.");
}
```

### `GetPackagedGameDataRootPath`

`GetPackagedGameDataRootPath()` returns the add-on `gamedata` directory captured when the bindings were initialized; it does not re-query the native path on each call. Its value matches `ROOT` and `DATA_ROOT`.

```js
const { GetPackagedGameDataRootPath } = require("memory/manager");

const g_strPackagedGameDataRootPath = GetPackagedGameDataRootPath();
if ((typeof g_strPackagedGameDataRootPath !== "string") || (g_strPackagedGameDataRootPath.length === 0)) {
	throw new Error("GetPackagedGameDataRootPath() did not return the packaged GameData path.");
}
```

### `GetAllGameDataFiles`

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const { ROOT, GetAllGameDataFiles } = require("memory/manager");

const g_strGameDataRelativePath = "sourcejs-docs/memory-manager-files";
const g_strGameDataFilePath = `${ROOT}/${g_strGameDataRelativePath}.json`;

function IsTargetGameDataFile(GameDataFileRecord) {
	return (GameDataFileRecord.Name === g_strGameDataRelativePath) && (typeof GameDataFileRecord.Path === "string") && (GameDataFileRecord.Path.length > 0);
}

if (DoesFileExist(g_strGameDataFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strGameDataFilePath}.`);
}

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strGameDataFilePath, "{}") !== true) {
		throw new Error(`Unable to write ${g_strGameDataFilePath}.`);
	}

	const vecGameDataFiles = GetAllGameDataFiles();
	if (!Array.isArray(vecGameDataFiles) || !vecGameDataFiles.some(IsTargetGameDataFile)) {
		throw new Error("GetAllGameDataFiles() did not enumerate the addon GameData file.");
	}

	for (const GameDataFileRecord of vecGameDataFiles) {
		const bValidName = (typeof GameDataFileRecord.Name === "string") && (GameDataFileRecord.Name.length > 0);
		const bValidPath = (typeof GameDataFileRecord.Path === "string") && (GameDataFileRecord.Path.length > 0);
		if (!bValidName || !bValidPath) {
			throw new Error("GetAllGameDataFiles() returned an invalid GameData file record.");
		}
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strGameDataFilePath) && (RemoveFile(g_strGameDataFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strGameDataFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strGameDataFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strGameDataFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `LoadGameData`

This example loads the common `CBaseEntity.ini` file, then merges overlay files in the order selected for the current SDK branch.

```js
const { BRANCH, LoadGameData } = require("memory/manager");

const g_GameDataDefinition = LoadGameData("entities", "CBaseEntity.ini", BRANCH);
if ((g_GameDataDefinition.Input === null) || (g_GameDataDefinition.Input === undefined) || (g_GameDataDefinition.Input.AddContext !== "AddContext")) {
	throw new Error(`The installed CBaseEntity data is incomplete for ${BRANCH}.`);
}
```

### `GetGameDataPaths`

```js
const { BRANCH, GetGameDataPaths } = require("memory/manager");

const g_vecSelectedPaths = GetGameDataPaths("entities", "CBaseEntity.ini", BRANCH);
if (!Array.isArray(g_vecSelectedPaths) || (g_vecSelectedPaths.length === 0) || (new Set(g_vecSelectedPaths).size !== g_vecSelectedPaths.length)) {
	throw new Error("GetGameDataPaths() did not return a nonempty candidate list without duplicates.");
}

for (const strFilePath of g_vecSelectedPaths) {
	if ((typeof strFilePath !== "string") || !strFilePath.endsWith("CBaseEntity.ini")) {
		throw new Error("GetGameDataPaths() returned an invalid entity-data candidate.");
	}
}
```

### `GetGameDataValue`

`GetGameDataValue()` reads a supplied GameData file, optionally follows a dotted property path, and applies branch, platform, and architecture selection to the resulting value. A property path must be `null` or a non-empty string; invalid property paths throw before filesystem access.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	ARCHITECTURE,
	BRANCH,
	GetGameDataValue,
	PLATFORM,
	ROOT,
} = require("memory/manager");

const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-get.json`;
if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_GameDataDefinition = {
	Values: {
		Selected: {
			[BRANCH]: {
				[PLATFORM]: {
					[ARCHITECTURE]: "selected-runtime",
				},
			},
		},
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GameDataDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	if (GetGameDataValue(g_strFilePath, "Values.Selected") !== "selected-runtime") {
		throw new Error("GetGameDataValue() did not apply the exact runtime selection path.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `LoadGameDataFile`

`LoadGameDataFile(strFilePath)` returns the newly parsed value and does not cache it. JSON files are parsed as JSON; `.txt` files are parsed as KeyValues and converted to nested JavaScript objects with the root name (normally `Games`) retained as an outer property. Before KeyValues parsing, the loader strips `//`, `;`, and `/*...*/` comments outside quoted strings and removes a leading UTF-8 BOM. Comment replacement preserves line endings and offsets in the remaining text. An unterminated block comment or quoted string throws `SyntaxError` before native allocation. Literal signature text, including `\xNN` sequences, remains unchanged; line breaks inside quoted text do not turn its content into comments.

For ordinary quoted or bare key/value blocks, root and field names are recovered recursively from the source spelling. An older SDK's process-wide symbol table may already contain `Left4Dead2`; that does not rename the file's `left4dead2` key. Differently cased source names stay distinct, exact-name duplicates retain their occurrence order, and native scalar values keep their types. Recovery does not mutate the native result or use a list of known names. Native directives or conditional syntax, and expanded records without an unambiguous source correspondence, retain the native parser's spelling instead of guessing; the native parser still owns their syntax and selection semantics.

Repeated KeyValues sibling names are preserved recursively as arrays in per-name occurrence order; names occurring once keep their scalar/object shape. For example, `Games["#default"]` and a `#supported` block's `engine` value may be arrays. Numeric dotted-path segments can select an occurrence through `GetGameDataValue`, such as `Games.#default.0.Offsets`. The loader does not apply `#supported` filtering or merge `#default` entries. Grouped arrays do not reconstruct interleaving between different sibling names.

KeyValues escape decoding is deliberately disabled: backslashes remain literal, and a quote closes the token even when preceded by a backslash. Embedded escaped quotes are not supported by this loader; this matches the disabled-escape mode described by [Valve's KeyValues contract](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/tier1/KeyValues.h).

The temporary KeyValues owner is released after conversion, including when conversion throws. A failed cleanup status or exception is reported. When conversion and cleanup both fail, an `AggregateError` retains both failures in that order; otherwise the original conversion or cleanup exception is preserved.

Relative `.txt` lookups prefer the [snapshot downloaded at startup](memory-gamedata.md), then fall back to an existing local file under `DATA_ROOT` (`addons/sourcejs/gamedata`). The installer does not ship the snapshot. For a platform-specific signature, select its `windows`, `linux`, `windows64`, or `linux64` value and call `ResolveBinaryIdentifier(strBinaryName, strSignature)`, using the record's `library` value for `strBinaryName`.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const { LoadGameDataFile, ROOT } = require("memory/manager");

const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-load.json`;
if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify({ Revision: 1 })) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const FirstGameData = LoadGameDataFile(g_strFilePath);
	if ((FirstGameData === null) || (typeof FirstGameData !== "object") || Array.isArray(FirstGameData) || (FirstGameData.Revision !== 1)) {
		throw new Error("LoadGameDataFile() did not read the initial project GameData file.");
	}

	if (WriteTextFile(g_strFilePath, JSON.stringify({ Revision: 2 })) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const SecondGameData = LoadGameDataFile(g_strFilePath);
	if ((SecondGameData === null) || (typeof SecondGameData !== "object") || Array.isArray(SecondGameData) || (SecondGameData.Revision !== 2) || (SecondGameData === FirstGameData)) {
		throw new Error("LoadGameDataFile() retained a stale project GameData object.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

Run this example on a TF2 server after SourceJS has downloaded the [managed GameData snapshot](memory-gamedata.md). It resolves an address without invoking the function. `ResolveBinaryIdentifier()` accepts `@`-prefixed Linux symbols as well as byte signatures. Preserve the exact spelling of external keys such as `tf`, `library`, and `windows64`:

```js
const { ARCHITECTURE, LoadGameDataFile, PLATFORM, ResolveBinaryIdentifier } = require("memory/manager");

const g_GameData = LoadGameDataFile("sm-tf2.games.txt");
const g_BurnSignature = g_GameData.Games.tf.Signatures.Burn;
const g_strPlatformKey = `${PLATFORM}${(ARCHITECTURE === "x64") ? "64" : ""}`;
const g_strBurnSignature = g_BurnSignature[g_strPlatformKey];
if ((typeof g_strBurnSignature !== "string") || (g_strBurnSignature.length === 0)) {
	throw new Error(`The Burn GameData record has no signature for ${g_strPlatformKey}.`);
}

const g_unBurnAddress = ResolveBinaryIdentifier(g_BurnSignature.library, g_strBurnSignature);
if (g_unBurnAddress === null) {
	throw new Error("The Burn GameData signature did not resolve.");
}
```

### `Manager`

The exported `Manager` is the default `TypeManager` singleton for the current plugin context. This example creates an owned live unsigned-integer cell and attempts release once in `finally`, preserving both operation and cleanup failures.

```js
const { DataType } = require("memory");
const { CustomType, Manager } = require("memory/manager");

class DocumentationFlagsCell extends CustomType {
}

if (Manager.DefineType("DocumentationFlagsCell", DocumentationFlagsCell, {
	Size: 4,
	Properties: {
		Value: Manager.InstanceAttribute(DataType.UInt, 0n),
	},
}) !== DocumentationFlagsCell) {
	throw new Error("The default manager did not register the flags-cell type.");
}

const g_vecErrors = [];
const g_FlagsCell = new DocumentationFlagsCell();
try {
	g_FlagsCell.Value = 0x20;

	if ((Manager.GetClass("DocumentationFlagsCell") !== DocumentationFlagsCell) || (g_FlagsCell.Value !== 0x20)) {
		throw new Error("The default manager did not retain the live flags-cell type.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_FlagsCell.Deallocate() !== true) {
			throw new Error("The default manager's owned instance was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Manager example and cleanup failed.");
}
```

### `GetGameDataOffset`

`GetGameDataOffset()` returns the runtime-selected value for a named entry in a GameData file's `Offsets` section; the value is not restricted to an integer.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	ARCHITECTURE,
	BRANCH,
	GetGameDataOffset,
	PLATFORM,
	ROOT,
} = require("memory/manager");

const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-offset.json`;
const g_GameDataDefinition = {
	Offsets: {
		DocumentationOffset: {
			[BRANCH]: {
				[PLATFORM]: {
					[ARCHITECTURE]: 0x48,
				},
			},
		},
	},
};

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GameDataDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	if (GetGameDataOffset(g_strFilePath, "DocumentationOffset") !== 0x48) {
		throw new Error("GetGameDataOffset() did not select the exact runtime value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `PLATFORM`

The selected platform and architecture determine the native ABI. `Convention` describes the target prototype using `"cdecl"`, `"stdcall"`, `"thiscall"`, or `"fastcall"`; `"win64"` and `"sysv"` are not accepted convention values. A convention name cannot switch a build to a foreign platform ABI. For the free `CreateInterface` function, use `"cdecl"` on x86 and x64.

```js
const { CALLING_CONVENTIONS, NormalizeConvention } = require("memory/helpers");
const { ARCHITECTURE, PLATFORM } = require("memory/manager");

if (!["linux", "windows"].includes(PLATFORM) || !["x86", "x64"].includes(ARCHITECTURE)) {
	throw new Error(`Unsupported selected ABI: ${PLATFORM}/${ARCHITECTURE}.`);
}

const g_strCallingConvention = NormalizeConvention("cdecl");
if ((g_strCallingConvention !== "cdecl") || !CALLING_CONVENTIONS.includes(g_strCallingConvention)) {
	throw new Error("The selected target does not expose the native CreateInterface convention.");
}
```

### `ROOT`

`ROOT` is the SourceJS add-on's GameData root, also returned by `GetProjectGameDataRootPath()`.

```js
const { GetProjectGameDataRootPath, ROOT } = require("memory/manager");

if ((typeof ROOT !== "string") || (ROOT.length === 0) || (GetProjectGameDataRootPath() !== ROOT)) {
	throw new Error("The project GameData root does not match the binding-initialization path.");
}
```

### `GetGameDataAddress`

`GetGameDataAddress()` resolves the selected `Signatures` entry to a `bigint`; it returns `null` when the entry is missing, non-object, or an array, or its identifier has no match.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	GetBinary,
	GetBinarySymbol,
	GetGameDataAddress,
	ROOT,
} = require("memory/manager");

const g_ServerBinary = GetBinary("server");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-address.json`;

if ((g_ServerBinary === null) || (g_unCreateInterfaceAddress === null)) {
	throw new Error("The server binary or its CreateInterface symbol is unavailable.");
}

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_GameDataDefinition = {
	Signatures: {
		DocumentationCreateInterface: {
			Module: "server",
			Identifier: "CreateInterface",
		},
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GameDataDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	if (GetGameDataAddress(g_strFilePath, "DocumentationCreateInterface") !== g_unCreateInterfaceAddress) {
		throw new Error("GetGameDataAddress() did not resolve the BigInt GameData address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `ScanBinary`

`ScanBinary(strBinaryName, strBytePattern)` scans the currently loaded binary and returns the first matching BigInt address or `null`. Patterns accept hexadecimal bytes separated by spaces or commas, `0xNN`, literal `\xNN`, and `?` or `*` wildcards. A JavaScript literal containing the four characters `\x55` must therefore be written as `"\\x55"`; `"\x55"` is already one decoded character before SourceJS receives it.

Adjacent hexadecimal byte pairs do not require separators. Each consecutive run of `?`/`*` characters represents one wildcard byte, not one byte per character; literal `\x??` also represents one wildcard byte. Empty or malformed patterns throw rather than returning the no-match result.

This example reads the actual first 16 bytes of the loaded `server` binary, converts them to the accepted hexadecimal form, and resolves that runtime signature:

```js
const { Address } = require("memory");
const {
	GetBinary,
	ScanBinary,
} = require("memory/manager");

const g_unSignatureByteCount = 16;

const g_ServerBinary = GetBinary("server");
if ((g_ServerBinary === null) || (g_ServerBinary.ByteCount < g_unSignatureByteCount)) {
	throw new Error("The server binary is not available for signature scanning.");
}

const g_ServerBytes = new Address(g_ServerBinary.Address);
const g_vecSignatureBytes = [];
for (let unOffset = 0; unOffset < g_unSignatureByteCount; unOffset += 1) {
	const unByte = g_ServerBytes.GetUChar(BigInt(unOffset));
	g_vecSignatureBytes.push(unByte.toString(16).toUpperCase().padStart(2, "0"));
}

const g_strSignature = g_vecSignatureBytes.join(" ");
const g_unMatchedAddress = ScanBinary("server", g_strSignature);
if (g_unMatchedAddress === null) {
	throw new Error(`The live server signature was not found: ${g_strSignature}`);
}

if (g_unMatchedAddress !== g_ServerBinary.Address) {
	throw new Error("ScanBinary() did not return the beginning of the matched server bytes.");
}
```

### `SelectRuntimeValue`

`SelectRuntimeValue(RuntimeValue)` tries own keys in this order: current branch, platform with `64` appended only for `x64`, platform, then architecture. It recursively applies the same precedence to the selected value. Arrays, primitives, and `null` are returned unchanged; an object with no matching own key is also returned unchanged.

```js
const {
	ARCHITECTURE,
	BRANCH,
	PLATFORM,
	SelectRuntimeValue,
} = require("memory/manager");

const g_unSelectedOffset = SelectRuntimeValue({
	[BRANCH]: {
		[PLATFORM]: {
			[ARCHITECTURE]: 0x48,
		},
	},
});
if (g_unSelectedOffset !== 0x48) {
	throw new Error("SelectRuntimeValue() did not follow the exact branch/platform/architecture path.");
}
```

### `GetGameDataSignature`

`GetGameDataSignature(strFilePath, strSignatureName)` returns the runtime-selected value from `Signatures[strSignatureName]` without resolving it. The value may be a signature string or a structured entry; a missing section or name returns `null`.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	GetGameDataSignature,
	ROOT,
} = require("memory/manager");

const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-signature.json`;
if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_GameDataDefinition = {
	Signatures: {
		DocumentationCreateInterface: {
			Module: "server",
			Identifier: "CreateInterface",
		},
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GameDataDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const SelectedSignature = GetGameDataSignature(g_strFilePath, "DocumentationCreateInterface");
	if ((SelectedSignature === null) || (typeof SelectedSignature !== "object") || Array.isArray(SelectedSignature) || (SelectedSignature.Module !== "server") || (SelectedSignature.Identifier !== "CreateInterface")) {
		throw new Error("GetGameDataSignature() did not return the selected GameData record.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `ResolveBinaryIdentifier`

`ResolveBinaryIdentifier(strBinaryName, Identifier)` accepts a BigInt address, symbol name, byte-pattern string, or an object with exactly one own key from `Address`, `Identifier`, `Symbol`, and `Pattern`, plus an optional `Module`. A BigInt is returned unchanged; this does not validate its range or backing storage. A leading `@` selects a symbol after removing that marker. Other strings select a byte scan only when they contain a space or comma, or start with `0x` or literal `\x`; otherwise they select a symbol lookup. A lone `?` or `*` therefore does not select a scan. This example uses the symbol-object form without converting the address to text.

```js
const { GetBinarySymbol, ResolveBinaryIdentifier } = require("memory/manager");

const g_unCreateInterfaceAddress = ResolveBinaryIdentifier("server", {
	Module: "server",
	Symbol: "CreateInterface",
});
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");
if ((g_unCreateInterfaceAddress === null) || (g_unCreateInterfaceAddress !== g_unExportedAddress)) {
	throw new Error("ResolveBinaryIdentifier() could not resolve server!CreateInterface.");
}
```

### `GetProjectGameDataRootPath`

`GetProjectGameDataRootPath()` returns the add-on's `gamedata` directory captured when the bindings were initialized and exposed as `ROOT`. The matching captured `DATA_ROOT` is the base for relative JSON and KeyValues paths. `LoadGameData()` and `GetGameDataPaths()` instead delegate SourceConfigINI lookups to `memory/gamedata`, which uses the current `SOURCE_DATA_ROOT`.

```js
const { GetProjectGameDataRootPath, ROOT } = require("memory/manager");

if (GetProjectGameDataRootPath() !== ROOT) {
	throw new Error("GetProjectGameDataRootPath() did not return the current GameData root.");
}
```

### `GetBinarySymbol`

`GetBinarySymbol(strBinaryName, strSymbolName)` returns a symbol's BigInt address or `null`. Windows resolves exports. Linux first uses the dynamic loader; for a named module, a failed lookup also checks its on-disk ELF `.symtab`, allowing local object/function symbols such as the engine's `sv` to resolve without hardcoded addresses. Symbol names remain platform-specific, including Itanium C++ ABI names.

The Linux fallback requires the matching, readable x86/x64 ELF image with its symbol table intact. Stripped/missing files, malformed tables, unsupported symbol kinds (including TLS, indirect functions, and special section indices), and ambiguous same-name symbols at different addresses are not resolved. Ordinary defined object/function/no-type symbols must belong to an allocated section and a loaded segment; the address is relocated using that module's actual load base. An empty module name retains dynamic-loader process-scope lookup only. The result borrows loaded-module memory: do not replace the module file while it is loaded or use the address after unloading it. This lookup does not own or validate the target object's runtime state.

```js
const {
	GetBinarySymbol,
	PLATFORM,
} = require("memory/manager");

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if (g_unCreateInterfaceAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_unCoreSurfaceAddress = (PLATFORM === "linux") ? GetBinarySymbol("server", "_ZN16CCoreDispSurface4InitEv") : null;

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("GetBinarySymbol() did not return the BigInt CreateInterface address.");
}

const g_bHasInvalidCoreSurfaceAddress = (g_unCoreSurfaceAddress !== null) && ((typeof g_unCoreSurfaceAddress !== "bigint") || (g_unCoreSurfaceAddress <= 0n));
if (g_bHasInvalidCoreSurfaceAddress) {
	throw new Error("The optional Linux CCoreDispSurface symbol returned an invalid address.");
}
```

### `CustomType.Add`

`CustomType.Add(nAddressOffset)` returns a non-owning view of the same registered type at the byte offset. Keep the source allocation alive and ensure the complete view remains within its backing allocation; `Add()` does not check allocation bounds. The example owns only its backing allocation, attempts release once in `finally`, and preserves operation and cleanup failures in order.

```js
const { Allocate, DataType, Deallocate } = require("memory");
const { Manager } = require("memory/manager");

const g_CellType = Manager.CreateType("AddCell", {
	Size: 4,
	Properties: {
		Value: Manager.InstanceAttribute(DataType.Int, 0n),
	},
});
const g_unBackingByteCount = 8;
const g_unBackingAddress = Allocate(g_unBackingByteCount);
if ((typeof g_unBackingAddress !== "bigint") || (g_unBackingAddress <= 0n)) {
	throw new Error("The backing allocation failed.");
}

const g_vecErrors = [];

try {
	const FirstCell = g_CellType.CreateFromAddress(g_unBackingAddress);
	const SecondCell = FirstCell.Add(4n);
	FirstCell.Value = 10;
	SecondCell.Value = 20;

	const bHasInvalidViews = (FirstCell.Address !== g_unBackingAddress) || (SecondCell.Address !== (FirstCell.Address + 4n)) || FirstCell.OwnsAddress || SecondCell.OwnsAddress;
	const bHasInvalidValues = (FirstCell.Value !== 10) || (SecondCell.Value !== 20);
	if (bHasInvalidViews || bHasInvalidValues) {
		throw new Error("CustomType.Add() did not create a live non-owning adjacent view.");
	}

	if ((FirstCell.Deallocate() !== false) || (SecondCell.Deallocate() !== false)) {
		throw new Error("A non-owning adjacent view attempted to release the backing allocation.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unBackingAddress) !== true) {
			throw new Error("The backing allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CustomType.Add() example and cleanup failed.");
}
```

### `CustomType.Deallocate`

`Deallocate()` returns `false` for a non-owning or empty instance, or when a release reports an incomplete result; validation, lifecycle, or native release failures may also throw. For an owner it calls `OnDeallocate()` before releasing tracked child addresses and then the base allocation. After that callback returns normally, automatic retries do not repeat it; a thrown callback remains eligible for retry without releasing the owner. The example probes a repeated release only after the first release succeeds; a failed first release is reported without an automatic retry.

Each successfully freed child is immediately removed from `AllocatedAddresses`. A later failure can therefore leave partial progress: remaining children stay tracked, while the base allocation, ownership, and `AddressValues` remain intact for retry. The stored address, ownership, and remaining tracking state are cleared only after the base allocation is freed successfully. Do not recursively call `Deallocate()` from the lifecycle hook.

```js
const { Manager } = require("memory/manager");

const g_CellType = Manager.CreateType("DeallocateCell", { Size: 4 });
const g_Cell = new g_CellType();

const g_bFirstRelease = g_Cell.Deallocate();
if (g_bFirstRelease !== true) {
	throw new Error("The initial owned release did not complete.");
}

const g_bSecondRelease = g_Cell.Deallocate();
const g_bHasStaleOwnership = (g_Cell.Address !== 0n) || g_Cell.OwnsAddress;
if ((g_bSecondRelease !== false) || g_bHasStaleOwnership) {
	throw new Error("CustomType.Deallocate() did not enforce one-shot ownership.");
}
```

### `CustomType.CreateFromAddress`

`CreateFromAddress(unAddress, nAddressOffset = 0n)` returns a non-owning view and does not check whether the complete registered type range fits the backing allocation. Keep that allocation alive and ensure the full view remains within its bounds.

```js
const { Allocate, DataType, Deallocate } = require("memory");
const { Read } = require("memory/helpers");
const { Manager } = require("memory/manager");

const g_CellType = Manager.CreateType("WrappedCell", {
	Size: 4,
	Properties: {
		Value: Manager.InstanceAttribute(DataType.Int, 0n),
	},
});
const g_unAllocationAddress = Allocate(8);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("The backing allocation failed.");
}

const g_vecErrors = [];

try {
	const CellView = g_CellType.CreateFromAddress(g_unAllocationAddress, 4n);
	CellView.Value = 73;
	if ((CellView.Address !== (g_unAllocationAddress + 4n)) || CellView.OwnsAddress) {
		throw new Error("CustomType.CreateFromAddress() returned an invalid non-owning view.");
	}

	if (Read(g_unAllocationAddress, DataType.Int, 4n) !== 73) {
		throw new Error("CustomType.CreateFromAddress() did not preserve live memory access.");
	}

	if (CellView.Deallocate() !== false) {
		throw new Error("CustomType.CreateFromAddress() attempted to release foreign memory.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("The backing allocation was not released by its owner.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CustomType example and cleanup failed.");
}
```

### `CustomType.GetMemoryAddress`

`GetMemoryAddress()` returns the instance's stored BigInt address; it is `0n` after successful deallocation.

```js
const { Manager } = require("memory/manager");

const g_CellType = Manager.CreateType("AddressCell", { Size: 4 });
const g_Cell = new g_CellType();

const g_vecErrors = [];

try {
	const unCellAddress = g_Cell.GetMemoryAddress();
	if ((typeof unCellAddress !== "bigint") || (unCellAddress <= 0n) || (unCellAddress !== g_Cell.Address)) {
		throw new Error("CustomType.GetMemoryAddress() did not return the live BigInt allocation address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_Cell.Deallocate() !== true) {
			throw new Error("The address-cell allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CustomType example and cleanup failed.");
}
```

### `CustomType.OnDeallocate`

`Deallocate()` calls this overridable hook synchronously before releasing an owned instance. The default implementation invokes the type's optional `DestructorCallback` with the instance as `this`; an override may replace that behavior or call `super.OnDeallocate()`. Return values, including Promises, are ignored rather than awaited. Keep cleanup synchronous and do not recursively call `Deallocate()`.

Calling `OnDeallocate()` directly invokes the hook but neither releases storage nor marks the automatic destructor as completed. A later `Deallocate()` may therefore invoke it again. The example below reports a failed release directly instead of retrying a destructor or release from `finally`.

```js
const { CustomType, Manager } = require("memory/manager");

let g_unDestructorCallCount = 0;

class TrackedCell extends CustomType {
}

Manager.DefineType("TrackedCell", TrackedCell, {
	Size: 4,
	DestructorCallback() {
		g_unDestructorCallCount += 1;
	},
});

const g_Cell = new TrackedCell();
const g_bReleased = g_Cell.Deallocate();
if ((g_bReleased !== true) || (g_unDestructorCallCount !== 1) || (g_Cell.Address !== 0n)) {
	throw new Error("CustomType.OnDeallocate() did not invoke the destructor exactly once before release.");
}

if ((g_Cell.Deallocate() !== false) || (g_unDestructorCallCount !== 1)) {
	throw new Error("A repeated deallocation invoked the destructor again.");
}
```

### `CustomType.Subtract`

`CustomType.Subtract(nAddressOffset)` subtracts the signed BigInt byte offset and returns a non-owning view of the same registered type. Like `Add()`, it does not check backing bounds; keep the source allocation alive and ensure the complete view remains within it.

```js
const { Allocate, DataType, Deallocate } = require("memory");
const { Manager } = require("memory/manager");

const g_CellType = Manager.CreateType("SubtractCell", {
	Size: 4,
	Properties: {
		Value: Manager.InstanceAttribute(DataType.Int, 0n),
	},
});
const g_unBackingByteCount = 8;
const g_unBackingAddress = Allocate(g_unBackingByteCount);
if ((typeof g_unBackingAddress !== "bigint") || (g_unBackingAddress <= 0n)) {
	throw new Error("The backing allocation failed.");
}

const g_vecErrors = [];

try {
	const FirstCell = g_CellType.CreateFromAddress(g_unBackingAddress);
	const SecondCell = FirstCell.Add(4n);
	const RestoredCell = SecondCell.Subtract(4n);
	FirstCell.Value = 11;
	SecondCell.Value = 22;

	const bHasInvalidAddresses = (FirstCell.Address !== g_unBackingAddress) || (SecondCell.Address !== (FirstCell.Address + 4n)) || (RestoredCell.Address !== FirstCell.Address);
	const bHasInvalidOwnership = FirstCell.OwnsAddress || SecondCell.OwnsAddress || RestoredCell.OwnsAddress;
	const bHasInvalidValues = (FirstCell.Value !== 11) || (SecondCell.Value !== 22) || (RestoredCell.Value !== 11);
	if (bHasInvalidAddresses || bHasInvalidOwnership || bHasInvalidValues) {
		throw new Error("CustomType.Subtract() did not return the expected live non-owning view.");
	}

	if ((FirstCell.Deallocate() !== false) || (SecondCell.Deallocate() !== false) || (RestoredCell.Deallocate() !== false)) {
		throw new Error("A non-owning cell view attempted to release the backing allocation.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unBackingAddress) !== true) {
			throw new Error("The backing allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "CustomType example and cleanup failed.");
}
```

### `TypeManager.Convert`

`Convert(strTypeName, unAddress)` requires a nonnegative BigInt address. It tries a registered class, function typedef, then converter; class conversion creates a non-owning view, while the callable paths receive the address. An unregistered name throws `ReferenceError`.

```js
const { GetBinarySymbol, TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");

function WrapExportAddress(unAddress) {
	return { Address: unAddress };
}

if (g_unCreateInterfaceAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_vecErrors = [];

try {
	if (g_mapManagerInstance.RegisterConverter("ExportAddress", WrapExportAddress) !== WrapExportAddress) {
		throw new Error("The export-address converter was not registered.");
	}

	const Result = g_mapManagerInstance.Convert("ExportAddress", g_unCreateInterfaceAddress);
	if ((Result === null) || (Result === undefined) || (Result.Address !== g_unCreateInterfaceAddress)) {
		throw new Error("TypeManager.Convert() did not invoke the registered converter.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_mapManagerInstance.Converters.get("ExportAddress") === WrapExportAddress) && (g_mapManagerInstance.UnregisterConverter("ExportAddress") !== true)) {
			throw new Error("The example's converter was not removed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.Converters.get("ExportAddress") === WrapExportAddress) {
			throw new Error("The example's converter remains registered after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Converter example and cleanup failed.");
}
```

### `TypeManager.CreateConverter`

`CreateConverter(strTypeName)` returns a reusable function bound to the name; each call delegates to `Convert(strTypeName, unAddress)` and requires a nonnegative BigInt address. The callable resolves the current registration on each invocation; it does not capture the converter currently registered for that name.

```js
const { GetBinarySymbol, TypeManager } = require("memory/manager");

const g_AddressToHexadecimal = (unAddress) => `0x${unAddress.toString(16).toUpperCase()}`;
const g_mapManagerInstance = new TypeManager();
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");

if (g_unCreateInterfaceAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_vecErrors = [];

try {
	if (g_mapManagerInstance.RegisterConverter("AddressHexadecimal", g_AddressToHexadecimal) !== g_AddressToHexadecimal) {
		throw new Error("The address converter was not registered.");
	}

	const ConvertAddress = g_mapManagerInstance.CreateConverter("AddressHexadecimal");
	if (ConvertAddress(g_unCreateInterfaceAddress) !== `0x${g_unCreateInterfaceAddress.toString(16).toUpperCase()}`) {
		throw new Error("TypeManager.CreateConverter() did not bind the requested converter name.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_mapManagerInstance.Converters.get("AddressHexadecimal") === g_AddressToHexadecimal) && (g_mapManagerInstance.UnregisterConverter("AddressHexadecimal") !== true)) {
			throw new Error("The example's converter was not removed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.Converters.get("AddressHexadecimal") === g_AddressToHexadecimal) {
			throw new Error("The example's converter remains registered after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Converter example and cleanup failed.");
}
```

### `TypeManager.CreateFunctionTypedefsFromFile`

`CreateFunctionTypedefsFromFile(strFilePath)` reads top-level callable definitions from a GameData file and registers them with this manager; it does not invoke them. Validate their ABI metadata against the target SDK and loaded binary before invoking a resulting callable. For the free `CreateInterface` function, use `"cdecl"` on every supported target; platform and architecture select the native ABI automatically.

Registration is incremental: a later invalid definition does not roll back earlier registrations. A definition replaces any function typedef already registered under the same name. This example uses its own fresh manager and removes its known typedef entry even if registration throws after partial progress; registry and file cleanup are attempted independently. Do not apply this cleanup unchanged to a shared registry with pre-existing entries.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	GetBinarySymbol,
	ROOT,
	TypeManager,
} = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-function-typedefs.json`;
const g_strCallingConvention = "cdecl";

if (g_unCreateInterfaceAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_FunctionTypedefDefinitions = {
	DocumentationCreateInterface: {
		Arguments: ["string", "address"],
		Convention: g_strCallingConvention,
		Documentation: "Resolve one Source interface by name.",
		ReturnType: "address",
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_FunctionTypedefDefinitions, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	if (g_mapManagerInstance.CreateFunctionTypedefsFromFile(g_strFilePath) !== undefined) {
		throw new Error("TypeManager.CreateFunctionTypedefsFromFile() returned an unexpected value.");
	}

	const CreateInterface = g_mapManagerInstance.Convert("DocumentationCreateInterface", g_unCreateInterfaceAddress);
	if (typeof CreateInterface !== "function") {
		throw new Error("TypeManager.Convert() did not create the registered callable.");
	}

	const bMatchingAddress = CreateInterface.Address === g_unCreateInterfaceAddress;
	const bMatchingOptionAddress = CreateInterface.Options.Address === g_unCreateInterfaceAddress;
	const bMatchingCallingConvention = CreateInterface.Options.Convention === g_strCallingConvention;
	const bMatchingReturnDataType = CreateInterface.Options.ReturnType === "address";
	const bMatchingDocumentation = CreateInterface.Documentation === "Resolve one Source interface by name.";
	const bMatchingArgumentTypes = Array.isArray(CreateInterface.Options.Arguments) && (CreateInterface.Options.Arguments.length === 2) && (CreateInterface.Options.Arguments[0] === "string") && (CreateInterface.Options.Arguments[1] === "address");
	if (!bMatchingAddress || !bMatchingOptionAddress || !bMatchingCallingConvention || !bMatchingReturnDataType || !bMatchingDocumentation || !bMatchingArgumentTypes) {
		throw new Error("The loaded function typedef did not create the expected callable.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_mapManagerInstance.FunctionTypedefs.has("DocumentationCreateInterface") && (g_mapManagerInstance.FunctionTypedefs.delete("DocumentationCreateInterface") !== true)) {
			throw new Error("The loaded function typedef was not removed.");
		}
	} catch (RegistryCleanupError) {
		g_vecErrors.push(RegistryCleanupError);
	}

	try {
		if (g_mapManagerInstance.FunctionTypedefs.has("DocumentationCreateInterface")) {
			throw new Error("The example's function typedef remains registered after cleanup.");
		}
	} catch (RegistryVerificationError) {
		g_vecErrors.push(RegistryVerificationError);
	}

	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (FileCleanupError) {
		g_vecErrors.push(FileCleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (FileVerificationError) {
		g_vecErrors.push(FileVerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function typedef example and cleanup failed.");
}
```

### `TypeManager.CreateGlobalAddressesFromObject`

`CreateGlobalAddressesFromObject(GlobalAddressDefinitions)` resolves each named definition and stores a non-owning typed view in this manager's `GlobalAddresses` map; the argument is an object, not a file path. Register every referenced type first and keep the native backing storage alive for the full view lifetime.

Resolution may invoke native code: `Accessor: true` calls the configured accessor synchronously. Only load trusted definitions whose address transformations and accessor ABI match the loaded binary. Processing is incremental; a later failure leaves earlier stored views in the map, and an entry replaces any previous view under the same name.

```js
const { CustomType, GetBinarySymbol, TypeManager } = require("memory/manager");

class DocumentationInterfaceExport extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("DocumentationInterfaceExport", DocumentationInterfaceExport, { Size: 1 });

if (g_mapManagerInstance.CreateGlobalAddressesFromObject({
	DocumentationInterfaceExport: {
		Binary: "server",
		Identifier: "CreateInterface",
	},
}) !== undefined) {
	throw new Error("TypeManager.CreateGlobalAddressesFromObject() returned an unexpected value.");
}

const g_InterfaceExport = g_mapManagerInstance.GetGlobalAddress("DocumentationInterfaceExport");
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");
if (g_unExportedAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_bMatchingGlobalAddress = g_InterfaceExport.Address === g_unExportedAddress;
const g_bNonOwningGlobalAddress = !g_InterfaceExport.OwnsAddress;
const g_bServerAddressCheckEnabled = g_InterfaceExport.ServerAddressCheck === true;
if (!g_bMatchingGlobalAddress || !g_bNonOwningGlobalAddress || !g_bServerAddressCheckEnabled) {
	throw new Error("The object definition did not create the expected non-owning global address.");
}
```

### `TypeManager.CreateGlobalAddressesFromFile`

`CreateGlobalAddressesFromFile(strFilePath)` parses a GameData file with `LoadGameDataFile()` and passes its definitions to `CreateGlobalAddressesFromObject()`. It returns `undefined`; each resulting typed view is non-owning. The same registration, backing-lifetime, accessor, and partial-failure rules apply.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	CustomType,
	GetBinarySymbol,
	ROOT,
	TypeManager,
} = require("memory/manager");

class DocumentationFileInterfaceExport extends CustomType {
}

const g_mapManagerInstance = new TypeManager();
const g_strFilePath = `${ROOT}/sourcejs-docs/memory-manager-global-addresses.json`;

g_mapManagerInstance.DefineType("DocumentationFileInterfaceExport", DocumentationFileInterfaceExport, { Size: 1 });

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_GlobalAddressDefinitions = {
	DocumentationFileInterfaceExport: {
		Binary: "server",
		Identifier: "CreateInterface",
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_GlobalAddressDefinitions, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	if (g_mapManagerInstance.CreateGlobalAddressesFromFile(g_strFilePath) !== undefined) {
		throw new Error("TypeManager.CreateGlobalAddressesFromFile() returned an unexpected value.");
	}

	const InterfaceExport = g_mapManagerInstance.GetGlobalAddress("DocumentationFileInterfaceExport");
	const unExportedAddress = GetBinarySymbol("server", "CreateInterface");
	if (unExportedAddress === null) {
		throw new Error("The loaded server binary does not export CreateInterface.");
	}

	if ((InterfaceExport.Address !== unExportedAddress) || InterfaceExport.OwnsAddress) {
		throw new Error("The file definition did not create the expected global address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `TypeManager.CreateGlobalAddressesFromGameData`

`CreateGlobalAddressesFromGameData(strSDKBranch = BRANCH)` loads the branch-specific `memory/GlobalAddresses.ini` from `paths.SOURCE_DATA_ROOT`, not this module's `DATA_ROOT`, and resolves its entries with `CreateGlobalAddressesFromObject()`. Register every referenced type first; the method stores non-owning typed views and returns `undefined`. The same backing-lifetime, accessor, and partial-failure rules apply.

```js
const { BRANCH, LoadGameData, TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_GlobalAddressDefinitions = LoadGameData("memory", "GlobalAddresses.ini", BRANCH);
const g_vecTypeNames = Object.keys(g_GlobalAddressDefinitions);
if (g_vecTypeNames.length === 0) {
	throw new Error(`No installed global-address data is available for ${BRANCH}.`);
}

for (const strTypeName of g_vecTypeNames) {
	g_mapManagerInstance.CreateType(strTypeName);
}

if ((g_mapManagerInstance.CreateGlobalAddressesFromGameData(BRANCH) !== undefined) || (g_mapManagerInstance.GlobalAddresses.size !== g_vecTypeNames.length)) {
	throw new Error("TypeManager.CreateGlobalAddressesFromGameData() did not resolve the complete selected set.");
}

for (const [strTypeName, GlobalAddress] of g_mapManagerInstance.GlobalAddresses) {
	const bKnownType = g_vecTypeNames.includes(strTypeName);
	const bValidAddress = (typeof GlobalAddress.Address === "bigint") && (GlobalAddress.Address > 0n);
	const bNonOwningAddress = !GlobalAddress.OwnsAddress;
	if (!bKnownType || !bValidAddress || !bNonOwningAddress) {
		throw new Error(`Invalid installed global address: ${strTypeName}.`);
	}
}
```

### `TypeManager.CreatePipe`

`CreatePipe(PipeDescriptor = {})` returns a `Pipe` class with each own property descriptor installed as a static class member, including non-enumerable and symbol-keyed properties. Descriptor flags are preserved, object values remain shared references, and accessors receive the pipe class as `this`; incompatible replacements of protected class properties such as `prototype` throw. This is not a deep copy. Here the descriptor contains a callable resolved from the loaded server binary; the example inspects its metadata without invoking it.

```js
const {
	GetBinarySymbol,
	TypeManager,
} = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = "cdecl";
const g_CreateInterface = g_mapManagerInstance.PipeFunction("server", "CreateInterface", ["string", "address"], "address", g_strCallingConvention, true, "Resolve one Source interface.");
const g_PipeDescriptor = { CreateInterface: g_CreateInterface };
const g_InterfacePipe = g_mapManagerInstance.CreatePipe(g_PipeDescriptor);
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");

g_PipeDescriptor.CreateInterface = null;

if (typeof g_InterfacePipe !== "function") {
	throw new Error("TypeManager.CreatePipe() did not return a pipe class.");
}

if (g_unExportedAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_PipeCreateInterface = g_InterfacePipe.CreateInterface;
if ((g_PipeCreateInterface === null) || (g_PipeCreateInterface === undefined)) {
	throw new Error("TypeManager.CreatePipe() did not install the callable descriptor.");
}

const g_bMatchingCallable = g_PipeCreateInterface === g_CreateInterface;
const g_bMatchingAddress = g_PipeCreateInterface.Address === g_unExportedAddress;
const g_bMatchingCallingConvention = g_PipeCreateInterface.Options.Convention === g_strCallingConvention;
const g_bMatchingDocumentation = g_PipeCreateInterface.Documentation === "Resolve one Source interface.";
const g_bServerAddressCheckEnabled = g_PipeCreateInterface.ServerAddressCheck === true;
if (!g_bMatchingCallable || !g_bMatchingAddress || !g_bMatchingCallingConvention || !g_bMatchingDocumentation || !g_bServerAddressCheckEnabled) {
	throw new Error("TypeManager.CreatePipe() did not create the callable pipe class.");
}
```

### `TypeManager.CreatePipeFromObject`

`CreatePipeFromObject(PipeDefinition)` resolves the in-memory function definitions into managed callables and returns a `Pipe` class with those callables as static members; construction does not invoke them.

```js
const {
	GetBinarySymbol,
	TypeManager,
} = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = "cdecl";
const g_InterfacePipe = g_mapManagerInstance.CreatePipeFromObject({
	CreateInterface: {
		Arguments: ["string", "address"],
		Binary: "server",
		Convention: g_strCallingConvention,
		Documentation: "Resolve one Source interface.",
		Identifier: "CreateInterface",
		ReturnType: "address",
	},
});
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");

if (typeof g_InterfacePipe !== "function") {
	throw new Error("TypeManager.CreatePipeFromObject() did not return a pipe class.");
}

if (g_unExportedAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_CreateInterface = g_InterfacePipe.CreateInterface;
if ((g_CreateInterface === null) || (g_CreateInterface === undefined)) {
	throw new Error("TypeManager.CreatePipeFromObject() did not install the selected callable.");
}

const g_bMatchingAddress = g_CreateInterface.Address === g_unExportedAddress;
const g_bMatchingCallingConvention = g_CreateInterface.Options.Convention === g_strCallingConvention;
const g_bMatchingDocumentation = g_CreateInterface.Documentation === "Resolve one Source interface.";
if (!g_bMatchingAddress || !g_bMatchingCallingConvention || !g_bMatchingDocumentation) {
	throw new Error("TypeManager.CreatePipeFromObject() did not build the selected callable.");
}
```

### `TypeManager.CreatePipeFromFile`

`CreatePipeFromFile(strFilePath)` parses a GameData file with `LoadGameDataFile()` and returns the pipe class built from its function definitions. It resolves the callables without invoking them.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const {
	GetBinarySymbol,
	ROOT,
	TypeManager,
} = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_strFilePath = `${ROOT}/memory-manager-pipe.json`;
const g_strCallingConvention = "cdecl";

if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_PipeDefinition = {
	CreateInterface: {
		Arguments: ["string", "address"],
		Binary: "server",
		Convention: g_strCallingConvention,
		Identifier: "CreateInterface",
		ReturnType: "address",
	},
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_PipeDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const InterfacePipe = g_mapManagerInstance.CreatePipeFromFile(g_strFilePath);
	const unExportedAddress = GetBinarySymbol("server", "CreateInterface");

	if (typeof InterfacePipe !== "function") {
		throw new Error("TypeManager.CreatePipeFromFile() did not return a pipe class.");
	}

	if (unExportedAddress === null) {
		throw new Error("The loaded server binary does not export CreateInterface.");
	}

	const CreateInterface = InterfacePipe.CreateInterface;
	if ((CreateInterface === null) || (CreateInterface === undefined)) {
		throw new Error("TypeManager.CreatePipeFromFile() did not install the callable descriptor.");
	}

	const bMatchingAddress = CreateInterface.Address === unExportedAddress;
	const bMatchingCallingConvention = CreateInterface.Options.Convention === g_strCallingConvention;
	const bMatchingReturnDataType = CreateInterface.Options.ReturnType === "address";
	if (!bMatchingAddress || !bMatchingCallingConvention || !bMatchingReturnDataType) {
		throw new Error("TypeManager.CreatePipeFromFile() did not load the callable descriptor.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "GameData example and cleanup failed.");
}
```

### `TypeManager.CreateType`

`CreateType(strTypeName, TypeDescriptor = {}, BaseType = CustomType)` creates a `CustomType` subclass, registers it with this manager, and returns its constructor.

```js
const { DataType } = require("memory");
const { TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_Counter = g_mapManagerInstance.CreateType("CreatedCounter", {
	Size: 4,
	Properties: {
		Value: g_mapManagerInstance.InstanceAttribute(DataType.Int, 0n),
	},
});
const g_vecErrors = [];
const g_CounterInstance = new g_Counter();

try {
	g_CounterInstance.Value = 12;

	const bMatchingClassName = g_Counter.name === "CreatedCounter";
	const bRegisteredClass = g_mapManagerInstance.GetClass("CreatedCounter") === g_Counter;
	const bMatchingValue = g_CounterInstance.Value === 12;
	const bOwnedAddress = g_CounterInstance.OwnsAddress;
	if (!bMatchingClassName || !bRegisteredClass || !bMatchingValue || !bOwnedAddress) {
		throw new Error("TypeManager.CreateType() did not register an owned live type.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_CounterInstance.Deallocate() !== true) {
			throw new Error("The created counter allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Type example and cleanup failed.");
}
```

### `TypeManager.CreateTypeFromObject`

`CreateTypeFromObject(strTypeName, TypeDefinition, BaseType = CustomType)` builds, registers, and returns a `CustomType` subclass from the definition object. It reads each enumerable own string-keyed field once; omitted sections are empty, while an explicit `null` section is invalid.

```js
const { DataType } = require("memory");
const { TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_Counter = g_mapManagerInstance.CreateTypeFromObject("ObjectCounter", {
	Size: 4,
	InstanceAttribute: {
		Value: {
			TypeName: DataType.Int,
			Offset: 0n,
		},
	},
});
const g_vecErrors = [];
const g_CounterInstance = new g_Counter();

try {
	g_CounterInstance.Value = 25;

	const bRegisteredClass = g_mapManagerInstance.GetClass("ObjectCounter") === g_Counter;
	const bMatchingValue = g_CounterInstance.Value === 25;
	const bMatchingTypeByteCount = g_Counter.TypeSize === 4;
	if (!bRegisteredClass || !bMatchingValue || !bMatchingTypeByteCount) {
		throw new Error("TypeManager.CreateTypeFromObject() did not apply the declared live layout.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_CounterInstance.Deallocate() !== true) {
			throw new Error("The object-defined counter allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Type example and cleanup failed.");
}
```

### `TypeManager.CreateTypeFromFile`

`CreateTypeFromFile(strTypeName, strFilePath, BaseType = CustomType)` parses the GameData file with `LoadGameDataFile()`, builds and registers the type, and returns its constructor. This example verifies a live write through the resulting class.

```js
const { DoesFileExist, RemoveFile, WriteTextFile } = require("filesystem");
const { DataType } = require("memory");
const { ROOT, TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_strFilePath = `${ROOT}/memory-manager-counter-type.json`;
if (DoesFileExist(g_strFilePath)) {
	throw new Error(`Refusing to overwrite ${g_strFilePath}.`);
}

const g_TypeDefinition = {
	InstanceAttribute: {
		Value: {
			TypeName: DataType.Int,
			Offset: "0",
		},
	},
	Size: 4,
};

const g_vecErrors = [];

try {
	if (WriteTextFile(g_strFilePath, JSON.stringify(g_TypeDefinition, null, "  ")) !== true) {
		throw new Error(`Unable to write ${g_strFilePath}.`);
	}

	const Counter = g_mapManagerInstance.CreateTypeFromFile("FileCounter", g_strFilePath);
	const CounterInstance = new Counter();

	try {
		CounterInstance.Value = 37;
		if ((CounterInstance.Value !== 37) || (Counter.TypeSize !== 4)) {
			throw new Error("TypeManager.CreateTypeFromFile() did not apply the file layout.");
		}
	} catch (OperationError) {
		g_vecErrors.push(OperationError);
	} finally {
		try {
			if (CounterInstance.Deallocate() !== true) {
				throw new Error("The file-defined counter allocation was not released.");
			}
		} catch (OwnerCleanupError) {
			g_vecErrors.push(OwnerCleanupError);
		}
	}
} catch (SetupError) {
	g_vecErrors.push(SetupError);
} finally {
	try {
		if (DoesFileExist(g_strFilePath) && (RemoveFile(g_strFilePath) !== true)) {
			throw new Error(`Unable to remove ${g_strFilePath}.`);
		}
	} catch (FileCleanupError) {
		g_vecErrors.push(FileCleanupError);
	}

	try {
		if (DoesFileExist(g_strFilePath)) {
			throw new Error(`Temporary GameData file remains after cleanup: ${g_strFilePath}.`);
		}
	} catch (FileVerificationError) {
		g_vecErrors.push(FileVerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Nested resource example and cleanup failed.");
}
```

### `TypeManager.CreateTypeFromGameData`

`CreateTypeFromGameData(strTypeName, strGameDataKind, strGameDataFileName, BaseType = CustomType, strSDKBranch = BRANCH)` merges the common and selected-branch data through `memory/gamedata.LoadGameData()`, then delegates to `CreateTypeFromObject()` and returns the registered constructor. The `entities/CBaseEntity.ini` definitions have no `Size`, so this example inspects metadata without constructing an allocating instance.

```js
const { BRANCH, CustomType, TypeManager } = require("memory/manager");

const g_mapManagerInstance = new TypeManager();
const g_BaseEntityLayout = g_mapManagerInstance.CreateTypeFromGameData("DocumentationBaseEntityLayout", "entities", "CBaseEntity.ini", CustomType, BRANCH);
if (typeof g_BaseEntityLayout !== "function") {
	throw new Error("TypeManager.CreateTypeFromGameData() did not return a registered class.");
}

const g_bRegisteredClass = g_mapManagerInstance.GetClass("DocumentationBaseEntityLayout") === g_BaseEntityLayout;
const g_bMatchingTypeManager = g_BaseEntityLayout.Manager === g_mapManagerInstance;
const g_bMissingAllocationSize = g_BaseEntityLayout.TypeSize === null;
const g_bCustomTypeSubclass = g_BaseEntityLayout.prototype instanceof CustomType;
if (!g_bRegisteredClass || !g_bMatchingTypeManager || !g_bMissingAllocationSize || !g_bCustomTypeSubclass) {
	throw new Error(`TypeManager.CreateTypeFromGameData() did not register the selected ${BRANCH} entity metadata.`);
}
```

### `TypeManager.DefineType`

`DefineType(strTypeName, TypeConstructor, TypeDescriptor = {})` registers an existing `CustomType` subclass and installs its metadata and property descriptors. With a positive `Size`, constructing the class with `new` allocates that many bytes; with `Size: null`, owning construction fails, though non-owning views remain possible. Memory attribute descriptors such as `InstanceAttribute()` read and write the view's memory; other supplied descriptors retain their own behavior.

If definition or registration fails, `DefineType()` attempts to restore changed constructor metadata and prototype descriptors. Rollback may also fail; an `AggregateError` then contains the original definition error first, followed by rollback errors. Lifecycle callbacks remain synchronous; returned Promises are not awaited.

```js
const { DataType } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class DamageSample extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("DamageSample", DamageSample, {
	Size: 8,
	ConstructorCallback(flDamage, nAttackerIndex) {
		this.Damage = flDamage;
		this.AttackerIndex = nAttackerIndex;
	},
	Properties: {
		Damage: g_mapManagerInstance.InstanceAttribute(DataType.Float, 0n),
		AttackerIndex: g_mapManagerInstance.InstanceAttribute(DataType.Int, 4n),
	},
});

const g_vecErrors = [];
const g_SampleInstance = new DamageSample(31.5, 2);

try {
	g_SampleInstance.Damage *= 1.25;

	const bRegisteredClass = g_mapManagerInstance.GetClass("DamageSample") === DamageSample;
	const bMatchingTypeManager = DamageSample.Manager === g_mapManagerInstance;
	const bMatchingTypeConfiguration = (DamageSample.TypeSize === 8) && (DamageSample.ServerCheck === true);
	const bMatchingCallbacks = (typeof DamageSample.ConstructorCallback === "function") && (DamageSample.DestructorCallback === null);
	const bMatchingLiveValues = (Math.abs(g_SampleInstance.Damage - 39.375) <= 0.0001) && (g_SampleInstance.AttackerIndex === 2);
	const bValidInstance = (DamageSample.ClassInfo !== null) && (DamageSample.ClassInfo !== undefined) && g_SampleInstance.OwnsAddress;
	if (!bRegisteredClass || !bMatchingTypeManager || !bMatchingTypeConfiguration || !bMatchingCallbacks || !bMatchingLiveValues || !bValidInstance) {
		throw new Error("TypeManager.DefineType() did not apply its constructor and live attributes.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_SampleInstance.Deallocate() !== true) {
			throw new Error("The damage-sample allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.DynamicInstanceArray`

`DynamicInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` creates a descriptor for inline-value elements at the address loaded from `nAddressOffset`. Each getter call returns a new, live, non-owning `ArrayView` over contiguous storage at the address read for that call. An existing view does not retarget when the containing address field changes; keep its original backing storage valid while using it. Assigning an array to the registered property writes its values sequentially through `ArrayView.Set()`; a later write failure does not roll back earlier elements.

The array examples report operation, owner-release, and backing-release failures in order, without silently retrying a failed release. An error is not proof that every native allocation was freed; stop using the sample's views after a cleanup failure.

```js
const { Allocate, DataType, Deallocate, GetDataTypeSize } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class RecentScores extends CustomType {
}

const g_unValueCount = 3;
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("RecentScores", RecentScores, {
	Size: GetDataTypeSize(DataType.Address),
	Properties: {
		Values: g_mapManagerInstance.DynamicInstanceArray(DataType.Int, 0n, g_unValueCount),
	},
});

const g_vecErrors = [];
const g_unValuesAddress = Allocate(g_unValueCount * GetDataTypeSize(DataType.Int));
if ((typeof g_unValuesAddress !== "bigint") || (g_unValuesAddress <= 0n)) {
	throw new Error("The external value-array allocation failed.");
}

try {
	const ScoresInstance = new RecentScores();

	try {
		if (ScoresInstance.WriteAddress(g_unValuesAddress) !== true) {
			throw new Error("The external value-array address write failed.");
		}

		ScoresInstance.Values.Set(0, 120);
		ScoresInstance.Values.Set(1, 95);
		ScoresInstance.Values.Set(2, 140);

		const bMatchingStoredAddress = ScoresInstance.ReadAddress() === g_unValuesAddress;
		const bMatchingArrayAddress = ScoresInstance.Values.Address === g_unValuesAddress;
		const bMatchingArrayLength = ScoresInstance.Values.Length === g_unValueCount;
		const bMatchingValues = (ScoresInstance.Values.At(0) === 120) && (ScoresInstance.Values.At(1) === 95) && (ScoresInstance.Values.At(2) === 140);
		if (!bMatchingStoredAddress || !bMatchingArrayAddress || !bMatchingArrayLength || !bMatchingValues) {
			throw new Error("TypeManager.DynamicInstanceArray() did not expose the external contiguous values.");
		}
	} catch (OperationError) {
		g_vecErrors.push(OperationError);
	} finally {
		try {
			if (ScoresInstance.Deallocate() !== true) {
				throw new Error("The dynamic-array owner was not released.");
			}
		} catch (OwnerCleanupError) {
			g_vecErrors.push(OwnerCleanupError);
		}
	}
} catch (SetupError) {
	g_vecErrors.push(SetupError);
} finally {
	try {
		if (Deallocate(g_unValuesAddress) !== true) {
			throw new Error("The external value array was not released.");
		}
	} catch (BackingCleanupError) {
		g_vecErrors.push(BackingCleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Nested resource example and cleanup failed.");
}
```

### `TypeManager.DynamicAddressArray`

`DynamicAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` creates a descriptor whose getter returns a live `ArrayView` over the address array stored at `nAddressOffset`. Each getter call snapshots the current backing address; an existing view does not retarget if that address field changes. The view shares the containing instance's allocation tracking; setting a null native-value slot allocates storage released by that instance's successful owning deallocation. A borrowed containing instance does not perform that automatic cleanup; its caller must manage any newly allocated targets. Keep the backing address-array storage valid while using the view. Assigning an array to the registered property writes its values sequentially through `ArrayView.Set()` with the same allocation tracking; a later write failure does not roll back earlier elements.

```js
const { Allocate, DataType, Deallocate, GetDataTypeSize } = require("memory");
const { Write } = require("memory/helpers");
const { CustomType, TypeManager } = require("memory/manager");

class ScoreAddresses extends CustomType {
}

const g_unValueCount = 3;
const g_unAddressByteCount = GetDataTypeSize(DataType.Address);
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("ScoreAddresses", ScoreAddresses, {
	Size: g_unAddressByteCount,
	Properties: {
		Values: g_mapManagerInstance.DynamicAddressArray(DataType.Int, 0n, g_unValueCount),
	},
});

const g_vecErrors = [];
const g_unSlotsAddress = Allocate(g_unValueCount * g_unAddressByteCount);
if ((typeof g_unSlotsAddress !== "bigint") || (g_unSlotsAddress <= 0n)) {
	throw new Error("The external address-slot allocation failed.");
}

try {
	const ScoresInstance = new ScoreAddresses();

	try {
		for (let unIndex = 0; unIndex < g_unValueCount; unIndex += 1) {
			if (Write(g_unSlotsAddress, DataType.Address, 0n, BigInt(unIndex * g_unAddressByteCount)) !== true) {
				throw new Error(`The external address slot write failed at index ${unIndex}.`);
			}
		}

		if (ScoresInstance.WriteAddress(g_unSlotsAddress) !== true) {
			throw new Error("The external address-slot address write failed.");
		}

		ScoresInstance.Values.Set(0, 120);
		ScoresInstance.Values.Set(1, 95);
		ScoresInstance.Values.Set(2, 140);

		const bMatchingArrayLength = ScoresInstance.Values.Length === g_unValueCount;
		const bMatchingValues = (ScoresInstance.Values.At(0) === 120) && (ScoresInstance.Values.At(1) === 95) && (ScoresInstance.Values.At(2) === 140);
		const bMatchingAllocationCount = ScoresInstance.AllocatedAddresses.size === g_unValueCount;
		if (!bMatchingArrayLength || !bMatchingValues || !bMatchingAllocationCount) {
			throw new Error("TypeManager.DynamicAddressArray() did not allocate and expose its native-value targets.");
		}
	} catch (OperationError) {
		g_vecErrors.push(OperationError);
	} finally {
		try {
			if (ScoresInstance.Deallocate() !== true) {
				throw new Error("The address-array owner did not release its target values.");
			}
		} catch (OwnerCleanupError) {
			g_vecErrors.push(OwnerCleanupError);
		}
	}
} catch (SetupError) {
	g_vecErrors.push(SetupError);
} finally {
	try {
		if (Deallocate(g_unSlotsAddress) !== true) {
			throw new Error("The external address-slot array was not released.");
		}
	} catch (BackingCleanupError) {
		g_vecErrors.push(BackingCleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Nested resource example and cleanup failed.");
}
```

### `TypeManager.Function`

`Function(FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null)` creates a property descriptor for a non-virtual native function. Accessing the property resolves the identifier from the class's binary; calling it passes the current object as native context, followed by the declared JavaScript arguments. The descriptor retains the exact argument-data-type array, so later edits affect existing callables.

This example passes the address of an interface-name string as the first argument to the exported `CreateInterface` factory and uses `"cdecl"` on every supported target; the build selects its native ABI automatically. It discovers the selected SDK's actual `ServerGameDLL` version instead of hard-coding an interface suffix.

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { Allocate, Convention, DataType, Deallocate } = require("memory");
const { Write } = require("memory/helpers");
const { CustomType, TypeManager } = require("memory/manager");

class InterfaceNameArgument extends CustomType {
}

const g_IsServerGameDLLInterface = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = Convention.Cdecl;

g_mapManagerInstance.DefineType("InterfaceNameArgument", InterfaceNameArgument, {
	Binary: "server",
	Size: 1,
	Properties: {
		CreateInterface: g_mapManagerInstance.Function("CreateInterface", [DataType.Address], DataType.Address, g_strCallingConvention),
	},
});

const g_strInterfaceName = GetAllInterfaceNames().find(g_IsServerGameDLLInterface);
if (g_strInterfaceName === undefined) {
	throw new Error("The selected SDK did not expose a ServerGameDLL interface.");
}

const g_unInterfaceNameByteCount = g_strInterfaceName.length + 1;
const g_vecErrors = [];
const g_unInterfaceNameAddress = Allocate(g_unInterfaceNameByteCount);
if ((typeof g_unInterfaceNameAddress !== "bigint") || (g_unInterfaceNameAddress <= 0n)) {
	throw new Error("The interface-name allocation failed.");
}

try {
	for (let unIndex = 0; unIndex < g_strInterfaceName.length; unIndex += 1) {
		if (Write(g_unInterfaceNameAddress, DataType.UChar, g_strInterfaceName.charCodeAt(unIndex), BigInt(unIndex)) !== true) {
			throw new Error(`The interface-name write failed at index ${unIndex}.`);
		}
	}

	if (Write(g_unInterfaceNameAddress, DataType.UChar, 0, BigInt(g_strInterfaceName.length)) !== true) {
		throw new Error("The interface-name terminator write failed.");
	}

	const NameArgument = InterfaceNameArgument.CreateFromAddress(g_unInterfaceNameAddress);
	const unInterfaceAddress = NameArgument.CreateInterface(0n);
	const RegisteredInterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
	if ((RegisteredInterfaceRecord === null) || (RegisteredInterfaceRecord === undefined) || (unInterfaceAddress !== RegisteredInterfaceRecord.Address) || NameArgument.OwnsAddress) {
		throw new Error("TypeManager.Function() did not call CreateInterface with the live object context.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unInterfaceNameAddress) !== true) {
			throw new Error("The interface-name allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.FunctionTypedef`

`FunctionTypedef(strTypeName, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", strDocumentationText = null)` registers a native function signature and returns a converter that wraps any verified function address with that signature. The exact argument-data-type array is retained. The returned callable performs argument typing on every invocation and exposes one stable live options view through `Options`; edits are validated by the native ABI path.

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { Convention, DataType } = require("memory");
const { GetBinarySymbol, TypeManager } = require("memory/manager");

const g_IsServerGameDLLInterface = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = Convention.Cdecl;

const g_vecErrors = [];

try {
	const CreateInterfaceFromAddress = g_mapManagerInstance.FunctionTypedef("InterfaceFactory", [DataType.StringAddress, DataType.Address], DataType.Address, g_strCallingConvention);
	if (typeof CreateInterfaceFromAddress !== "function") {
		throw new Error("TypeManager.FunctionTypedef() did not return a callable converter.");
	}

	const unFactoryAddress = GetBinarySymbol("server", "CreateInterface");
	if (unFactoryAddress === null) {
		throw new Error("The loaded server binary does not export CreateInterface.");
	}

	const strInterfaceName = GetAllInterfaceNames().find(g_IsServerGameDLLInterface);
	if (strInterfaceName === undefined) {
		throw new Error("The selected SDK did not expose a ServerGameDLL interface.");
	}

	const CreateInterface = CreateInterfaceFromAddress(unFactoryAddress);
	if (typeof CreateInterface !== "function") {
		throw new Error("TypeManager.FunctionTypedef() did not wrap the function address.");
	}

	const unInterfaceAddress = CreateInterface(strInterfaceName, 0n);
	const RegisteredInterfaceRecord = GetInterfaceRecord(strInterfaceName);
	const bValidCallableState = (CreateInterface.Address === unFactoryAddress) && (CreateInterface.Options.Convention === g_strCallingConvention);
	if ((RegisteredInterfaceRecord === null) || (RegisteredInterfaceRecord === undefined) || (unInterfaceAddress !== RegisteredInterfaceRecord.Address) || !bValidCallableState) {
		throw new Error("TypeManager.FunctionTypedef() did not create the expected callable factory.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_mapManagerInstance.FunctionTypedefs.has("InterfaceFactory") && (g_mapManagerInstance.FunctionTypedefs.delete("InterfaceFactory") !== true)) {
			throw new Error("The interface-factory typedef was not removed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.FunctionTypedefs.has("InterfaceFactory")) {
			throw new Error("The example's interface-factory typedef remains registered after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function typedef example and cleanup failed.");
}
```

### `TypeManager.GetClass`

`GetClass(strTypeName)` checks this manager's registrations first, then the global object-type registry; it returns the constructor or `null` when unknown. Empty or non-string names throw `TypeError`. The constructor retains the allocation and property behavior configured at registration.

```js
const { DataType } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class SpawnCounter extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("SpawnCounter", SpawnCounter, {
	Size: 4,
	Properties: {
		SpawnCount: g_mapManagerInstance.InstanceAttribute(DataType.UInt, 0n),
	},
});

const g_RegisteredCounter = g_mapManagerInstance.GetClass("SpawnCounter");
if (g_RegisteredCounter === null) {
	throw new Error("SpawnCounter was not registered.");
}

const g_vecErrors = [];
const g_CounterInstance = new g_RegisteredCounter();

try {
	g_CounterInstance.SpawnCount = 7;

	const bMatchingValue = g_CounterInstance.SpawnCount === 7;
	const bMatchingClass = g_RegisteredCounter === SpawnCounter;
	const bMissingTypeRejected = g_mapManagerInstance.GetClass("MissingType") === null;
	if (!bMatchingValue || !bMatchingClass || !bMissingTypeRejected) {
		throw new Error("TypeManager.GetClass() did not distinguish registered and missing types.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_CounterInstance.Deallocate() !== true) {
			throw new Error("The registered counter allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.GetGlobalAddress`

`GetGlobalAddress(TypeReference)` returns the previously resolved global-address view stored for a registered type. The lookup accepts either the registered type name or its constructor and throws when no address has been installed.

```js
const { CustomType, GetBinarySymbol, TypeManager } = require("memory/manager");

class InterfaceFactoryExport extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("InterfaceFactoryExport", InterfaceFactoryExport, { Size: 1 });
g_mapManagerInstance.GlobalAddress("InterfaceFactoryExport", "server", "CreateInterface");

const g_AddressByName = g_mapManagerInstance.GetGlobalAddress("InterfaceFactoryExport");
const g_AddressByConstructor = g_mapManagerInstance.GetGlobalAddress(InterfaceFactoryExport);
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");
if ((g_AddressByName === null) || (g_AddressByName === undefined) || (g_AddressByConstructor === null) || (g_AddressByConstructor === undefined) || (g_unExportedAddress === null)) {
	throw new Error("TypeManager.GetGlobalAddress() did not return both stored views.");
}

if ((g_AddressByName !== g_AddressByConstructor) || (g_AddressByName.Address !== g_unExportedAddress) || g_AddressByName.OwnsAddress) {
	throw new Error("TypeManager.GetGlobalAddress() did not return the stored non-owning view.");
}
```

### `TypeManager.GlobalAddress`

`GlobalAddress(TypeReference, strBinaryName, AddressIdentifier, nAddressOffset = 0n, unDereferenceCount = 0, bServerCheck = true, bIsAccessor = false, nAccessorAddressOffset = 0n)` resolves the identifier in the binary, adds the BigInt offset, and normally applies the dereference count before storing and returning a non-owning typed view. With `bIsAccessor`, it instead adds the address-sized displacement read at `nAccessorAddressOffset` from the original resolved address, calls the derived address as a no-argument cdecl function returning an address, and applies the dereference count to that result. Use this only for a verified accessor thunk. String type names use `GetClass()` and may resolve through the global registry; the constructor form must be registered with this manager. Missing/null addresses throw. The view's editable `ServerAddressCheck` is metadata, not a callable-address or lifetime validation.

Accessor invocation uses the native `memory/hooks.CallFunction` export with an empty `Arguments` array, `Convention: "cdecl"`, and `ReturnType: "address"`. Call failures propagate unchanged; a failed or null-result accessor does not replace an already cached global-address view. Ordinary non-accessor resolution does not invoke a native function.

```js
const { CustomType, GetBinarySymbol, TypeManager } = require("memory/manager");

class CreateInterfaceExport extends CustomType {
}

const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("CreateInterfaceExport", CreateInterfaceExport, { Size: 1 });

const g_InterfaceExport = g_mapManagerInstance.GlobalAddress(CreateInterfaceExport, "server", "CreateInterface", 0n, 0, false);
const g_unExportedAddress = GetBinarySymbol("server", "CreateInterface");
if (g_unExportedAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_bMatchingAddress = g_InterfaceExport.Address === g_unExportedAddress;
const g_bServerAddressCheckDisabled = g_InterfaceExport.ServerAddressCheck === false;
const g_bNonOwningAddress = !g_InterfaceExport.OwnsAddress;
const g_bRegisteredAddress = g_mapManagerInstance.GetGlobalAddress(CreateInterfaceExport) === g_InterfaceExport;
if (!g_bMatchingAddress || !g_bServerAddressCheckDisabled || !g_bNonOwningAddress || !g_bRegisteredAddress) {
	throw new Error("TypeManager.GlobalAddress() did not store the expected non-owning export view.");
}
```

### `TypeManager.InstanceAttribute`

`InstanceAttribute(strTypeName, nAddressOffset, strDocumentationText = null)` creates a descriptor for storage at a BigInt offset from the object's address. Native values read and write inline. Other getters call the containing class's manager's `Convert()` with the field address; for a registered object type, this returns a live non-owning nested view. Non-native setters require a registered object class with a positive `TypeSize` and copy the source object's bytes into the inline field. Keep the backing storage alive for the nested view's entire use.

```js
const { Allocate, DataType, Deallocate } = require("memory");
const { Read } = require("memory/helpers");
const { CustomType, TypeManager } = require("memory/manager");

class PlayerVitals extends CustomType {
}

const g_unVitalsByteCount = 8;
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("PlayerVitals", PlayerVitals, {
	Size: g_unVitalsByteCount,
	Properties: {
		Health: g_mapManagerInstance.InstanceAttribute(DataType.Float, 0n),
		MaxHealth: g_mapManagerInstance.InstanceAttribute(DataType.Float, 4n),
	},
});

const g_vecErrors = [];
const g_unVitalsAddress = Allocate(g_unVitalsByteCount);
if ((typeof g_unVitalsAddress !== "bigint") || (g_unVitalsAddress <= 0n)) {
	throw new Error("The external vitals allocation failed.");
}

try {
	const VitalsView = PlayerVitals.CreateFromAddress(g_unVitalsAddress);
	VitalsView.Health = 73.5;
	VitalsView.MaxHealth = 100;

	const bMatchingProperties = (VitalsView.Health === 73.5) && (VitalsView.MaxHealth === 100);
	const bMatchingMemory = (Read(g_unVitalsAddress, DataType.Float, 0n) === 73.5) && (Read(g_unVitalsAddress, DataType.Float, 4n) === 100);
	const bNonOwningAddress = !VitalsView.OwnsAddress;
	if (!bMatchingProperties || !bMatchingMemory || !bNonOwningAddress) {
		throw new Error("TypeManager.InstanceAttribute() did not read and write the external inline fields.");
	}

	if (VitalsView.Deallocate() !== false) {
		throw new Error("The non-owning vitals view attempted to release external memory.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unVitalsAddress) !== true) {
			throw new Error("The external vitals allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.PipeFunction`

`PipeFunction(strBinaryName, FunctionIdentifier, vecArgumentTypes = [], strReturnType = "void", strConvention = "cdecl", bServerCheck = true, strDocumentationText = null)` resolves the supplied function identifier immediately and returns a typed callable. Unlike `Function()`, the callable is not bound to an object and does not prepend a native context argument. It retains the argument-data-type array and exposes the same stable live `Options` view as `FunctionTypedef()`. `bServerCheck` sets editable metadata; it does not establish that an address is callable. The exported `CreateInterface` example uses `"cdecl"` on every supported target; the build selects the native ABI.

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { Convention, DataType } = require("memory");
const { TypeManager } = require("memory/manager");

const g_IsServerGameDLLInterface = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = Convention.Cdecl;
const g_CreateInterface = g_mapManagerInstance.PipeFunction("server", "CreateInterface", [DataType.StringAddress, DataType.Address], DataType.Address, g_strCallingConvention);
const g_strInterfaceName = GetAllInterfaceNames().find(g_IsServerGameDLLInterface);
if (g_strInterfaceName === undefined) {
	throw new Error("The selected SDK did not expose a ServerGameDLL interface.");
}

const g_unInterfaceAddress = g_CreateInterface(g_strInterfaceName, 0n);
const g_RegisteredInterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if ((g_RegisteredInterfaceRecord === null) || (g_RegisteredInterfaceRecord === undefined)) {
	throw new Error(`${g_strInterfaceName} disappeared from the interface registry.`);
}

const g_bMatchingInterface = g_unInterfaceAddress === g_RegisteredInterfaceRecord.Address;
const g_bMatchingOptionAddress = g_CreateInterface.Address === g_CreateInterface.Options.Address;
const g_bMatchingCallingConvention = g_CreateInterface.Options.Convention === g_strCallingConvention;
const g_bServerAddressCheckEnabled = g_CreateInterface.ServerAddressCheck === true;
if (!g_bMatchingInterface || !g_bMatchingOptionAddress || !g_bMatchingCallingConvention || !g_bServerAddressCheckEnabled) {
	throw new Error("TypeManager.PipeFunction() did not invoke the verified exported factory.");
}
```

### `TypeManager.AddressAttribute`

`AddressAttribute(strTypeName, nAddressOffset, strDocumentationText = null)` creates a descriptor for an address slot at a BigInt offset. Before first use, initialize native-value slots to null unless their backing storage is known to contain valid target addresses; borrowed or reused storage may contain arbitrary bytes. Native getters read through the stored address; setting a null slot allocates one typed value and tracks it for cleanup by the owning instance. For custom types, the getter converts the stored address and the setter retains the supplied object while storing its address without transferring ownership. Failed slot writes attempt to restore the previous address and retention; rollback failures are combined in an `AggregateError`. A value-write failure after a successful slot installation leaves the target tracked for later owning cleanup; it is not an atomic rollback of the whole assignment.

The example attempts parent and separately owned nested-value cleanup independently. A cleanup error does not prove every allocation was released; stop using the sample's views after a cleanup failure.

```js
const { DataType, GetDataTypeSize } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class NestedIntValue extends CustomType {
}

class OwnedIntAddress extends CustomType {
}

const g_unAddressByteCount = GetDataTypeSize(DataType.Address);
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("NestedIntValue", NestedIntValue, {
	Size: GetDataTypeSize(DataType.Int),
	Properties: {
		Value: g_mapManagerInstance.InstanceAttribute(DataType.Int, 0n),
	},
});

g_mapManagerInstance.DefineType("OwnedIntAddress", OwnedIntAddress, {
	Size: 2 * g_unAddressByteCount,
	Properties: {
		Value: g_mapManagerInstance.AddressAttribute(DataType.Int, 0n),
		NestedValue: g_mapManagerInstance.AddressAttribute("NestedIntValue", BigInt(g_unAddressByteCount)),
	},
});

const g_vecErrors = [];
let g_NestedValueInstance = null;
const g_Cell = new OwnedIntAddress();

try {
	g_NestedValueInstance = new NestedIntValue();

	if ((g_Cell.WriteAddress(0n) !== true) || (g_Cell.WriteAddress(0n, BigInt(g_unAddressByteCount)) !== true)) {
		throw new Error("TypeManager.AddressAttribute() did not initialize its address slots.");
	}

	g_Cell.Value = 64;
	g_NestedValueInstance.Value = 17;
	g_Cell.NestedValue = g_NestedValueInstance;
	g_Cell.NestedValue.Value += 1;

	const unValueAddress = g_Cell.ReadAddress();
	const bValidNativeAddress = (typeof unValueAddress === "bigint") && (unValueAddress > 0n);
	const bMatchingNativeValue = g_Cell.Value === 64;
	const bTrackedNativeAddress = (g_Cell.AllocatedAddresses.size === 1) && g_Cell.AllocatedAddresses.has(unValueAddress);
	const bMatchingCustomAddress = g_Cell.ReadAddress(BigInt(g_unAddressByteCount)) === g_NestedValueInstance.Address;
	const bRetainedCustomValue = g_Cell.AddressValues.get(BigInt(g_unAddressByteCount)) === g_NestedValueInstance;
	const bMatchingNestedView = g_Cell.NestedValue.Address === g_NestedValueInstance.Address;
	const bMatchingNestedValue = g_NestedValueInstance.Value === 18;
	const bValidNativeAddressState = bMatchingNativeValue && bTrackedNativeAddress;
	const bValidCustomAddressState = bMatchingCustomAddress && bRetainedCustomValue && bMatchingNestedView && bMatchingNestedValue;
	if (!bValidNativeAddress || !bValidNativeAddressState || !bValidCustomAddressState) {
		throw new Error("TypeManager.AddressAttribute() did not allocate its native address target or retain its nested object.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_Cell.Deallocate() !== true) {
			throw new Error("The address-attribute owner did not release its native address target.");
		}
	} catch (ParentCleanupError) {
		g_vecErrors.push(ParentCleanupError);
	}

	try {
		if ((g_NestedValueInstance !== null) && (g_NestedValueInstance.Deallocate() !== true)) {
			throw new Error("The separately owned nested value was not released.");
		}
	} catch (NestedCleanupError) {
		g_vecErrors.push(NestedCleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address attribute example and cleanup failed.");
}

if ((g_Cell.AllocatedAddresses.size !== 0) || (g_Cell.AddressValues.size !== 0)) {
	throw new Error("Address-attribute ownership metadata was not cleared after release.");
}
```

### `TypeManager.RegisterConverter`

`RegisterConverter(strConverterName, Converter)` adds a named converter to this manager. `Convert()` uses it after class and function-typedef lookups, passing the non-negative BigInt address; the method returns the registered function.

The example creates a non-owning `Address` wrapper. Its native owner must keep the referenced interface memory alive.

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { Address } = require("memory");
const { TypeManager } = require("memory/manager");

const g_IsServerGameDLLInterface = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_ToAddressView = (unAddress) => new Address(unAddress);
const g_mapManagerInstance = new TypeManager();

const g_vecErrors = [];

try {
	if (g_mapManagerInstance.RegisterConverter("InterfaceAddressView", g_ToAddressView) !== g_ToAddressView) {
		throw new Error("TypeManager.RegisterConverter() did not return the converter callback.");
	}

	const strInterfaceName = GetAllInterfaceNames().find(g_IsServerGameDLLInterface);
	if (strInterfaceName === undefined) {
		throw new Error("The selected SDK did not expose a ServerGameDLL interface.");
	}

	const InterfaceRecord = GetInterfaceRecord(strInterfaceName);
	if ((InterfaceRecord === null) || (InterfaceRecord === undefined) || (typeof InterfaceRecord.Address !== "bigint")) {
		throw new Error(`The interface registry lost ${strInterfaceName}.`);
	}

	const View = g_mapManagerInstance.Convert("InterfaceAddressView", InterfaceRecord.Address);
	if ((View === null) || (View === undefined)) {
		throw new Error("TypeManager.Convert() did not invoke the converter.");
	}

	const bRegisteredConverter = g_mapManagerInstance.Converters.get("InterfaceAddressView") === g_ToAddressView;
	const bMatchingViewAddress = View.Address === InterfaceRecord.Address;
	const bNonOwningView = (View instanceof Address) && !View.Owned;
	if (!bRegisteredConverter || !bMatchingViewAddress || !bNonOwningView) {
		throw new Error("The registered converter did not create the expected address view.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((g_mapManagerInstance.Converters.get("InterfaceAddressView") === g_ToAddressView) && (g_mapManagerInstance.UnregisterConverter("InterfaceAddressView") !== true)) {
			throw new Error("The interface-address converter was not removed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.Converters.get("InterfaceAddressView") === g_ToAddressView) {
			throw new Error("The example's interface-address converter remains registered after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Converter example and cleanup failed.");
}
```

### `TypeManager.RegisterType`

`RegisterType(strTypeName, TypeConstructor)` registers a preconfigured `CustomType` subclass, associates it with this manager, and leaves its existing type metadata and prototype descriptors intact. Use `DefineType()` when the manager should apply a descriptor object.

```js
const { DataType } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class TickCounter extends CustomType {
	get Value() {
		return this.Read(DataType.UInt);
	}

	set Value(unValue) {
		if (this.Write(DataType.UInt, unValue) !== true) {
			throw new Error("TickCounter.Value could not be written.");
		}
	}
}

TickCounter.TypeSize = 4;

const g_mapManagerInstance = new TypeManager();
if (g_mapManagerInstance.RegisterType("TickCounter", TickCounter) !== TickCounter) {
	throw new Error("TypeManager.RegisterType() did not return the registered constructor.");
}

const g_vecErrors = [];
const g_CounterInstance = new TickCounter();

try {
	g_CounterInstance.Value = 128;

	const bMatchingValue = g_CounterInstance.Value === 128;
	const bRegisteredClass = g_mapManagerInstance.GetClass("TickCounter") === TickCounter;
	const bMatchingTypeManager = TickCounter.Manager === g_mapManagerInstance;
	if (!bMatchingValue || !bRegisteredClass || !bMatchingTypeManager) {
		throw new Error("TypeManager.RegisterType() did not preserve the configured live type.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_CounterInstance.Deallocate() !== true) {
			throw new Error("The registered tick-counter allocation was not released.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.StaticInstanceArray`

`StaticInstanceArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` creates a property descriptor for contiguous inline values beginning at the address offset inside the object itself. Each getter returns a new non-owning `ArrayView` at the current field address; an existing view does not retarget if the containing object's address changes. Keep the backing storage valid while using it, and stop using the view before the containing allocation is released. Assigning an array to the registered property writes its values sequentially through `ArrayView.Set()`; a later write failure does not roll back earlier elements.

```js
const { DataType, GetDataTypeSize } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class RecentDamage extends CustomType {
}

const g_unValueCount = 3;
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("RecentDamage", RecentDamage, {
	Size: g_unValueCount * GetDataTypeSize(DataType.Float),
	Properties: {
		Values: g_mapManagerInstance.StaticInstanceArray(DataType.Float, 0n, g_unValueCount),
	},
});

const g_vecErrors = [];
const g_DamageInstance = new RecentDamage();

try {
	g_DamageInstance.Values.Set(0, 12.5);
	g_DamageInstance.Values.Set(1, 8);
	g_DamageInstance.Values.Set(2, 21.25);
	g_DamageInstance.Values.Set(1, g_DamageInstance.Values.At(1) + 4);

	const bMatchingArrayLength = g_DamageInstance.Values.Length === g_unValueCount;
	const bMatchingValues = (g_DamageInstance.Values.At(0) === 12.5) && (g_DamageInstance.Values.At(1) === 12) && (g_DamageInstance.Values.At(2) === 21.25);
	const bMatchingArrayAddress = g_DamageInstance.Values.Address === g_DamageInstance.Address;
	if (!bMatchingArrayLength || !bMatchingValues || !bMatchingArrayAddress) {
		throw new Error("TypeManager.StaticInstanceArray() did not expose its inline live values.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_DamageInstance.Deallocate() !== true) {
			throw new Error("The inline damage array was not released with its owner.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.StaticAddressArray`

`StaticAddressArray(strTypeName, nAddressOffset, unArrayLength = null, strDocumentationText = null)` creates a descriptor for address slots embedded at a BigInt offset in the object. Each getter returns a new non-owning view at the current field address; keep that original storage alive while using the view. Initialize slots in borrowed or reused storage before first use; each slot must contain null or a valid target address. Assigning a native value to a null slot allocates and tracks its target; automatic target release requires an owning containing instance. A borrowed containing instance leaves target cleanup to its caller. Assigning a custom value retains its address-backed object but does not transfer ownership, so release that object separately. Assigning an array to the registered property writes its values sequentially through `ArrayView.Set()` with the same allocation tracking; a later write failure does not roll back earlier elements.

```js
const { DataType, GetDataTypeSize } = require("memory");
const { CustomType, TypeManager } = require("memory/manager");

class RecentScores extends CustomType {
}

const g_unValueCount = 3;
const g_unAddressByteCount = GetDataTypeSize(DataType.Address);
const g_mapManagerInstance = new TypeManager();

g_mapManagerInstance.DefineType("RecentScores", RecentScores, {
	Size: g_unValueCount * g_unAddressByteCount,
	Properties: {
		Values: g_mapManagerInstance.StaticAddressArray(DataType.Int, 0n, g_unValueCount),
	},
});

const g_vecErrors = [];
const g_ScoresInstance = new RecentScores();

try {
	for (let unIndex = 0; unIndex < g_unValueCount; unIndex += 1) {
		if (g_ScoresInstance.WriteAddress(0n, BigInt(unIndex * g_unAddressByteCount)) !== true) {
			throw new Error("TypeManager.StaticAddressArray() did not initialize an address slot.");
		}
	}

	g_ScoresInstance.Values.Set(0, 120);
	g_ScoresInstance.Values.Set(1, 95);
	g_ScoresInstance.Values.Set(2, 140);

	const bMatchingArrayLength = g_ScoresInstance.Values.Length === g_unValueCount;
	const bMatchingValues = (g_ScoresInstance.Values.At(0) === 120) && (g_ScoresInstance.Values.At(1) === 95) && (g_ScoresInstance.Values.At(2) === 140);
	const bMatchingAllocationCount = g_ScoresInstance.AllocatedAddresses.size === g_unValueCount;
	if (!bMatchingArrayLength || !bMatchingValues || !bMatchingAllocationCount) {
		throw new Error("TypeManager.StaticAddressArray() did not allocate and expose all native address targets.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_ScoresInstance.Deallocate() !== true) {
			throw new Error("The static address array did not release its owned address targets.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `TypeManager.UnregisterConverter`

`UnregisterConverter(strConverterName)` removes a named converter from this manager. It returns `true` only when an entry existed; later conversion fails naturally unless a class or function typedef with the same name remains registered.

```js
const { Address } = require("memory");
const { GetBinarySymbol, TypeManager } = require("memory/manager");

const g_CreateAddressView = (unAddress) => new Address(unAddress);
const g_mapManagerInstance = new TypeManager();
const g_unConverterAddress = GetBinarySymbol("server", "CreateInterface");
if (g_unConverterAddress === null) {
	throw new Error("The loaded server binary does not export CreateInterface.");
}

const g_vecErrors = [];
let g_bRemovalAttempted = false;

try {
	if (g_mapManagerInstance.RegisterConverter("AddressView", g_CreateAddressView) !== g_CreateAddressView) {
		throw new Error("TypeManager.RegisterConverter() did not register AddressView.");
	}

	const ViewBeforeRemoval = g_mapManagerInstance.Convert("AddressView", g_unConverterAddress);
	if ((ViewBeforeRemoval === null) || (ViewBeforeRemoval === undefined) || (ViewBeforeRemoval.Address !== g_unConverterAddress)) {
		throw new Error("The converter did not create its expected address view.");
	}

	g_bRemovalAttempted = true;
	const bRemoved = g_mapManagerInstance.UnregisterConverter("AddressView");
	if (bRemoved !== true) {
		throw new Error("TypeManager.UnregisterConverter() did not remove the converter.");
	}

	const bRemovedAgain = g_mapManagerInstance.UnregisterConverter("AddressView");
	if (bRemovedAgain !== false) {
		throw new Error("The repeated removal did not report a missing converter.");
	}

	let ConversionError = null;
	try {
		g_mapManagerInstance.Convert("AddressView", g_unConverterAddress);
	} catch (ErrorValue) {
		ConversionError = ErrorValue;
	}

	if (!(ConversionError instanceof ReferenceError)) {
		throw new Error("Conversion after removal did not throw ReferenceError.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bRemovalAttempted && (g_mapManagerInstance.Converters.get("AddressView") === g_CreateAddressView)) {
			g_bRemovalAttempted = true;

			if (g_mapManagerInstance.UnregisterConverter("AddressView") !== true) {
				throw new Error("The example's converter cleanup did not complete.");
			}
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if (g_mapManagerInstance.Converters.get("AddressView") === g_CreateAddressView) {
			throw new Error("The example's converter remains registered after its removal attempt.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Converter removal example and cleanup failed.");
}
```

### `TypeManager.VirtualFunction`

`VirtualFunction(unVTableIndex, vecArgumentTypes = [], strReturnType = "void", strConvention = "thiscall", strDocumentationText = null)` creates a property descriptor that reads the specified virtual-table slot from the current object and exposes it as a bound `MemberFunction`; the caller must verify the slot and object lifetime. The virtual-table index is zero-based and SDK-specific; calling `Call()` passes the live object as native context. The descriptor retains the exact argument-data-type array, so later edits affect existing member functions.

In the selected SDK header `public/game/server/iplayerinfo.h`, `IPlayerInfoManager::GetGlobalVars()` is the second virtual method in `PlayerInfoManager002`, so its zero-based index is `1`. Verify that interface version and slot against your SDK before calling it. The method is read-only and returns the same live `CGlobalVars` address exposed by `globals`; the example selects `"thiscall"` on Windows and `"cdecl"` on Linux. The build applies the native ABI on x64; `Convention.SysV` and `Convention.Win64` are not supported enum entries.

```js
const { GetGlobalVariables } = require("globals");
const { GetInterfaceRecord } = require("interfaces");
const { Convention, DataType } = require("memory");
const { CustomType, PLATFORM, TypeManager } = require("memory/manager");

class PlayerInfoManagerView extends CustomType {
}

const g_mapManagerInstance = new TypeManager();
const g_strCallingConvention = (PLATFORM === "windows") ? Convention.Thiscall : Convention.Cdecl;

g_mapManagerInstance.DefineType("PlayerInfoManagerView", PlayerInfoManagerView, {
	Size: 1,
	Properties: {
		GetGlobalVariables: g_mapManagerInstance.VirtualFunction(1, [], DataType.Address, g_strCallingConvention),
	},
});

const g_PlayerInfoManagerInterfaceRecord = GetInterfaceRecord("PlayerInfoManager002");
if ((g_PlayerInfoManagerInterfaceRecord === null) || (g_PlayerInfoManagerInterfaceRecord === undefined)) {
	throw new Error("The selected SDK did not expose PlayerInfoManager002.");
}

const g_PlayerInfoManagerInstance = PlayerInfoManagerView.CreateFromAddress(g_PlayerInfoManagerInterfaceRecord.Address);
const g_GlobalVariablesMemberFunction = g_PlayerInfoManagerInstance.GetGlobalVariables;
const g_unGlobalVariablesAddress = g_GlobalVariablesMemberFunction.Call();
const g_GlobalVariables = GetGlobalVariables();

const g_bMatchingGlobalVariablesAddress = g_unGlobalVariablesAddress === g_GlobalVariables.Address;
const g_bMatchingCallingConvention = g_GlobalVariablesMemberFunction.Convention === g_strCallingConvention;
const g_bNonOwningInterfaceView = !g_PlayerInfoManagerInstance.OwnsAddress;
const g_bForeignMemoryPreserved = g_PlayerInfoManagerInstance.Deallocate() === false;
if (!g_bMatchingGlobalVariablesAddress || !g_bMatchingCallingConvention || !g_bNonOwningInterfaceView || !g_bForeignMemoryPreserved) {
	throw new Error("TypeManager.VirtualFunction() did not call GetGlobalVars through the non-owning interface view.");
}
```

## Errors and lifecycle

- `LoadGameDataFile()` throws if the file text is unavailable or parsing fails. `GetGameDataValue()` returns `null` for a missing property path; otherwise runtime selection checks the current branch, platform with `64` appended only for `x64`, platform, then architecture. `GetGameDataOffset()` and `GetGameDataSignature()` return `null` for missing sections or names. `GetGameDataAddress()` returns `null` for a missing/non-object signature or unresolved address. `CreateGameDataCallableOptions()` returns `null` for a missing or non-object function entry; a returned options object's `Address` can still be `null`. Invalid inputs or malformed definitions may throw; these helpers do not substitute another SDK branch.
- `ScanBinary()` and `GetBinarySymbol()` return `null` when no matching pattern or symbol is found; invalid arguments and malformed patterns throw. Their successful BigInt addresses refer to loaded-module memory and become invalid when that module unloads.
- `ResolveBinaryIdentifier()` passes a BigInt identifier through unchanged; symbol/pattern lookups may return `null`. A descriptor must contain exactly one own key from `Address`, `Identifier`, `Symbol`, and `Pattern`, with optional `Module`; malformed descriptors throw. Only module-resolved addresses inherit that module's unload lifetime; direct BigInt inputs retain the caller's lifetime contract.
- A `CustomType` created with `new` requires a positive integer `TypeSize`, owns its allocation, and must be released with `Deallocate()`. `CreateFromAddress()`, `Add()`, `Subtract()`, and global-address builders create non-owning views whose `Deallocate()` returns `false`.
- Address attributes and address arrays track allocated native-value targets with the containing `CustomType`; automatic release requires that instance to own its storage. With a borrowed containing instance, the caller must manage those targets. Custom object targets are retained but remain separately owned.
- Inline arrays are part of the containing `CustomType` allocation. Dynamic-array views over externally supplied storage do not own it; its actual owner must keep it alive and release it.
- A registered `CustomType` constructor is associated with the registering `TypeManager`; treat type registration as context-lifetime because `TypeManager` has no `UnregisterType()`. Converters, function typedefs, and global-address entries are per-manager and can be removed with `UnregisterConverter()` or the exposed maps' `delete()` when a reloadable subsystem owns them.
- `Convert()` resolves a registered class first, then a function typedef, then a converter. It throws `ReferenceError` when no matching conversion exists.
- `Function()`, `PipeFunction()`, and `VirtualFunction()` descriptors do not prove that an address is callable. Resolve only selected-SDK records, use the exact ABI and argument types, validate object lifetime, and avoid invoking unverified signatures or accessor thunks.
- Packaged `memory/gamedata` kind/file lookups use `paths.SOURCE_DATA_ROOT` and merge common and selected-branch INI data. `LoadGameDataFile()` instead resolves ordinary relative paths under `ROOT`/`DATA_ROOT` (`addons/sourcejs/gamedata`) before calling `ReadTextFile()`. POSIX-rooted paths, and Windows rooted or drive-qualified paths on Windows, retain their native filesystem meaning; this is not a sandbox or traversal restriction. Temporary-file examples require isolated paths, refuse existing files, and remove only their own files.
