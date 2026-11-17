# `require("memory/helpers")`

> Warning: This is a dense, low-level memory reference. AI agents should use the contents list and process one section at a time. An incorrect address, type, array length, virtual-table index, or calling convention can corrupt the server process. Verify the selected SDK ABI before reading, writing, or calling engine memory.

`memory/helpers` is the shared implementation layer used by [`memory`](memory.md), [`memory/manager`](memory-manager.md), and typed packages. It exposes exact BigInt address arithmetic, native typed access, non-owning address views, declarative-data conversion, and ABI call helpers. Prefer a typed package whenever one already owns the engine operation.

## Contents

- [Contract](#contract)
- [Import](#import)
- [Exports](#exports)
- [Constants](#constants)
- [Classes](#classes)
- [API](#api)

## Contract

- Stored and returned addresses are non-negative JavaScript `BigInt` values. Native operations check their numeric width and reject `0n` where required. Numbers, strings, and wrapper objects are not address inputs. `Address()` and the `BaseAddress` constructor normalize omitted, `undefined`, or `null` inputs to `0n`; that default does not authorize dereferencing it. These checks do not prove that memory is mapped, readable, writable, or still alive; the caller must ensure that the entire accessed range remains valid.
- Address arithmetic and typed-access helpers borrow their target memory. `ArrayView.Set()` may allocate native storage for an empty native-type address-array slot when an owning `CustomType` supplies its `AllocatedAddresses` tracking set. Pair direct allocations from [`memory.Allocate()`](memory.md#allocation-and-object-conversion) with `memory.Deallocate()` in a `finally` block.
- `ArrayView` and `BaseAddress` are live views. Their reads and writes reach the referenced memory immediately.
- `ArrayView` requires an explicit `unArrayLength` for iteration and materialization. Omitting it still permits indexed `At()` and `Set()` access.
- `MemberFunction` calls the supplied native address synchronously. Its ABI metadata must match the selected SDK exactly.
- Native V8 validation errors propagate directly. This module does not replace absent operations with fallback results.

## Import

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress, Type } = require("memory/helpers");

const g_unAllocatedMemoryAddress = Allocate(Type.GetDataTypeSize(Type.Int));
if ((typeof g_unAllocatedMemoryAddress !== "bigint") || (g_unAllocatedMemoryAddress <= 0n)) {
	throw new Error("memory/helpers import check could not allocate memory.");
}

const g_vecImportErrors = [];
try {
	const IntegerAddress = new BaseAddress(g_unAllocatedMemoryAddress);
	if (!IntegerAddress.Write(Type.Int, 123) || (IntegerAddress.Read(Type.Int) !== 123)) {
		throw new Error("memory/helpers import check failed.");
	}
} catch (ImportError) {
	g_vecImportErrors.push(ImportError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedMemoryAddress)) {
			throw new Error("memory/helpers import allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecImportErrors.push(CleanupError);
	}
}

if (g_vecImportErrors.length === 1) {
	throw g_vecImportErrors[0];
}

if (g_vecImportErrors.length > 1) {
	throw new AggregateError(g_vecImportErrors, "memory/helpers import and allocation cleanup failed.");
}
```

## Exports

The module exposes 41 named CommonJS properties. It has no `default` or `ModuleName` export, string-backed address wrappers, or compatibility aliases.

| Export | Kind | Signature or value |
| --- | --- | --- |
| [`ArrayView`](#arrayview) | class | `new ArrayView(TypeManager, bIsAddressArray, strTypeName, unAddressValue, unArrayLength = null, setAllocatedAddresses = null, mapAddressValues = new Map())` |
| [`BaseAddress`](#baseaddress) | class | `new BaseAddress(unAddress = 0n)` |
| [`DataKey`](#datakey) | static class | Declarative layout keys and converters. |
| [`KeyError`](#keyerror) | error class | `new KeyError(strErrorMessage)` |
| [`MemberFunction`](#memberfunction) | class | `new MemberFunction(TypeManager, strReturnType, unFunctionAddress, ThisObject, vecArgumentTypes = [], strConvention = "thiscall")` |
| [`Type`](#type) | static class | Native type constants and normalization helpers. |
| [`CALLING_CONVENTIONS`](#calling_conventions) | frozen array | Native convention names compiled into SourceJS. |
| [`DATA_TYPES`](#data_types) | frozen array | Native ABI type names, including `void`. |
| [`NO_DEFAULT`](#no_default) | symbol | Marks a required declarative-data key. |
| [`ADDRESS_SIZE`](#address_size) | number | Native address width in bytes. |
| [`TYPE_SIZES`](#type_sizes) | frozen object | Storage size by non-void native type. |
| [`Add`](#add) | function | `Add(unAddressValue, nAddressOffset?)` |
| [`Compare`](#compare) | function | `Compare(unLeftAddress, unRightAddress, unByteCount)` |
| [`Copy`](#copy) | function | `Copy(unSourceAddress, unDestinationAddress, unByteCount)` |
| [`GetDataTypeSize`](#getdatatypesize) | function | `GetDataTypeSize(strDataType)` |
| [`Difference`](#difference) | function | `Difference(unLeftAddress, unRightAddress)` |
| [`IsNull`](#isnull) | function | `IsNull(unAddress)` |
| [`Move`](#move) | function | `Move(unSourceAddress, unDestinationAddress, unByteCount)` |
| [`NormalizeConvention`](#normalizeconvention) | function | `NormalizeConvention(strCallingConvention)` |
| [`NormalizeDataType`](#normalizedatatype) | function | `NormalizeDataType(strDataType)` |
| [`ParseData`](#parsedata) | function | `ParseData(TypeManager, Definitions, vecKeyDescriptors)` |
| [`Address`](#address) | function | `Address(unAddress = 0n)` |
| [`Read`](#read) | function | `Read(unAddress, strDataType = "address", nAddressOffset = 0n)` |
| [`ReadBool`](#readbool) | function | `ReadBool(unAddress, nAddressOffset = 0n)` |
| [`ReadDouble`](#readdouble) | function | `ReadDouble(unAddress, nAddressOffset = 0n)` |
| [`ReadFloat`](#readfloat) | function | `ReadFloat(unAddress, nAddressOffset = 0n)` |
| [`ReadInt`](#readint) | function | `ReadInt(unAddress, nAddressOffset = 0n)` |
| [`ReadAddress`](#readaddress) | function | `ReadAddress(unAddress, nAddressOffset = 0n)` |
| [`ReadUInt`](#readuint) | function | `ReadUInt(unAddress, nAddressOffset = 0n)` |
| [`SearchBytes`](#searchbytes) | function | `SearchBytes(unAddress, BytePattern, unByteCount)` |
| [`SetProtection`](#setprotection) | function | `SetProtection(unAddress, unByteCount, MemoryProtection)` |
| [`Subtract`](#subtract) | function | `Subtract(unAddressValue, nAddressOffset?)` |
| [`VirtualFunction`](#virtualfunction) | function | `VirtualFunction(unAddress, unVirtualFunctionIndex)` |
| [`VirtualTable`](#virtualtable) | function | `VirtualTable(unAddress)` |
| [`Write`](#write) | function | `Write(unAddress, strDataType, DataValue, nAddressOffset = 0n)` |
| [`WriteBool`](#writebool) | function | `WriteBool(unAddress, bBooleanValue, nAddressOffset = 0n)` |
| [`WriteDouble`](#writedouble) | function | `WriteDouble(unAddress, dblDoubleValue, nAddressOffset = 0n)` |
| [`WriteFloat`](#writefloat) | function | `WriteFloat(unAddress, flFloatValue, nAddressOffset = 0n)` |
| [`WriteInt`](#writeint) | function | `WriteInt(unAddress, nSignedIntegerValue, nAddressOffset = 0n)` |
| [`WriteAddress`](#writeaddress) | function | `WriteAddress(unAddress, unStoredAddress, nAddressOffset = 0n)` |
| [`WriteUInt`](#writeuint) | function | `WriteUInt(unAddress, unUnsignedIntegerValue, nAddressOffset = 0n)` |

## Constants

`DATA_TYPES` contains `void`, `bool`, `char`, `uchar`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `longlong`, `ulonglong`, `float`, `double`, `address`, `string`, `stringaddress`, and `stringarray`. `TYPE_SIZES` intentionally has no `void` entry because `void` has no storage. `CALLING_CONVENTIONS` contains `cdecl`, `stdcall`, `thiscall`, and `fastcall`; a convention may still be invalid for the current platform or target function.

`Type` exposes these static constants: `Bool`, `Char`, `UChar`, `Short`, `UShort`, `Int`, `UInt`, `Long`, `ULong`, `LongLong`, `ULongLong`, `Float`, `Double`, `Address`, `StringAddress`, and `StringArray`.

`DataKey` exposes `Binary`, `ServerCheck`, `Size`, `Offset`, `TypeName`, `Length`, `Level`, `Accessor`, `AccessorOffset`, `Arguments`, `ReturnType`, `Convention`, `Identifier`, and `Documentation` for declarative manager records.

The named `Type` and `DataKey` properties listed above are writable and configurable, unlike the frozen exported inventories. Keep their canonical values unchanged while other packages rely on them.

## Classes

| Class | Live state and ownership | Public members |
| --- | --- | --- |
| [`ArrayView`](#arrayview) | Live view over contiguous values or address slots; the base address is borrowed, while separately allocated element addresses may be tracked in `AllocatedAddresses`. | `Address`, `Null`, `TypeManager`, `AddressArray`, `TypeName`, `Length`, `AllocatedAddresses`, `AddressValues`, `GetOffset()`, `At()`, `Set()`, `Add()`, `Subtract()`, `ToArray()`, `Keys()`, `Values()`, `Entries()`, `ForEach()`, `[Symbol.iterator]()`, and inherited address methods. |
| [`BaseAddress`](#baseaddress) | Non-owning BigInt address view. | `Address`, `Null`, `HasAddress()`, `Add()`, `Subtract()`, `Read()`, `Write()`, `ReadAddress()`, `WriteAddress()`, `valueOf()`, and `toString()`. |
| [`DataKey`](#datakey) | Static declarative-data utility; do not instantiate it. | Nine conversion methods plus the key constants listed above. |
| [`KeyError`](#keyerror) | Ordinary `Error` subclass for a required missing data key. | `name`, `message`, and standard `Error` members. |
| [`MemberFunction`](#memberfunction) | Non-owning synchronous callable over one native function address and context. | `TypeManager`, `ReturnType`, `FunctionAddress`, `ThisObject`, `ArgumentTypes`, `Convention`, and `Call()`. |
| [`Type`](#type) | Static native-type utility; do not instantiate it. | Type constants, `NormalizeDataType()`, `IsNativeDataType()`, and `GetDataTypeSize()`. |

## API

### `ArrayView`

`new ArrayView(TypeManager, bIsAddressArray, strTypeName, unAddressValue, unArrayLength = null, setAllocatedAddresses = null, mapAddressValues = new Map())` creates a non-owning live view. `false` stores values inline; `true` stores one address per slot. `setAllocatedAddresses` is the owner-provided set that tracks native element storage allocated for address-array slots; `mapAddressValues` retains custom objects assigned to address slots. Direct views create their own retention map by default; manager-created address-array views share the owning object's collections. Reading custom elements requires a manager with `Convert()`; inline custom elements also require `GetClass()` and a positive `TypeSize` for offset calculation. Construction stores metadata without resolving custom classes.

`Address`, `Null`, and the ArrayView metadata properties are read-only getters backed by private storage; there are no public `m_*` fields or aliases. The declared length is fixed at construction; create another view when a different bound is needed. `AllocatedAddresses` returns the supplied owner set or `null`; `AddressValues` returns the live retention map. Neither collection is copied or frozen. Keeping a view alive does not keep its borrowed native allocation valid.

`ArrayView.Add(nAddressOffset)` and `ArrayView.Subtract(nAddressOffset)` return a new `ArrayView` at the byte-shifted address, preserving `TypeManager`, `AddressArray`, `TypeName`, `Length`, and the identities of `AllocatedAddresses` and `AddressValues`. They do not change the original view or allocate or free native storage. The declared length is not reduced by the shift; ensure the entire shifted range is valid before reading or writing it.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_unArrayLength = 3;
const g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Int) * g_unArrayLength);
if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
	throw new Error("ArrayView allocation returned an invalid address.");
}

const g_vecArrayViewErrors = [];
try {
	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	if (IntegerArrayView.Set(0, 100) !== IntegerArrayView) {
		throw new Error("ArrayView.Set() did not return its receiver.");
	}

	IntegerArrayView.Set(1, 200);
	IntegerArrayView.Set(2, 300);

	const vecCurrentValues = IntegerArrayView.ToArray();
	const vecExpectedValues = [100, 200, 300];

	if (IntegerArrayView.At(1) !== 200) {
		throw new Error("ArrayView did not expose the written live value.");
	}

	for (let unArrayIndex = 0; unArrayIndex < vecExpectedValues.length; unArrayIndex += 1) {
		if (vecCurrentValues[unArrayIndex] !== vecExpectedValues[unArrayIndex]) {
			throw new Error(`ArrayView value ${unArrayIndex} is incorrect.`);
		}
	}
} catch (ArrayViewError) {
	g_vecArrayViewErrors.push(ArrayViewError);
} finally {
	try {
		if (!Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecArrayViewErrors.push(CleanupError);
	}
}

if (g_vecArrayViewErrors.length === 1) {
	throw g_vecArrayViewErrors[0];
}

if (g_vecArrayViewErrors.length > 1) {
	throw new AggregateError(g_vecArrayViewErrors, "ArrayView operation and allocation cleanup failed.");
}
```

### `BaseAddress`

`new BaseAddress(unAddress = 0n)` wraps a BigInt address without taking ownership; omitted or nullish inputs produce `0n`. `Address` and `Null` are read-only getters. Arithmetic returns another non-owning instance of the same class, while typed access reaches native memory immediately.

Address storage is private: `m_unAddress` and `m_bNull` are not public fields or aliases. `BaseAddress.RebindAddress(AddressValue, unAddress)` is the explicit lifecycle operation used internally after allocation changes. It normalizes the new address like the constructor and returns `undefined`; invalid input leaves the old address intact. It does not allocate, free memory, transfer ownership, or update owner metadata. Ordinary callers should use their owner's `Reallocate()`/`Deallocate()` lifecycle rather than retargeting an owned wrapper manually.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress, Type } = require("memory/helpers");

const g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Int));
if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
	throw new Error("BaseAddress allocation returned an invalid address.");
}

const g_vecBaseAddressErrors = [];
try {
	const StorageAddress = new BaseAddress(g_unStorageAddress);
	if (!StorageAddress.HasAddress()) {
		throw new Error("BaseAddress allocation returned a null address.");
	}

	if (!StorageAddress.Write(Type.Int, 150)) {
		throw new Error("BaseAddress write failed.");
	}

	if ((StorageAddress.Address !== g_unStorageAddress) || !StorageAddress.HasAddress() || (StorageAddress.Read(Type.Int) !== 150) || (StorageAddress.toString() !== `0x${g_unStorageAddress.toString(16)}`)) {
		throw new Error("BaseAddress live state is inconsistent.");
	}
} catch (BaseAddressError) {
	g_vecBaseAddressErrors.push(BaseAddressError);
} finally {
	try {
		if (!Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecBaseAddressErrors.push(CleanupError);
	}
}

if (g_vecBaseAddressErrors.length === 1) {
	throw g_vecBaseAddressErrors[0];
}

if (g_vecBaseAddressErrors.length > 1) {
	throw new AggregateError(g_vecBaseAddressErrors, "BaseAddress operation and allocation cleanup failed.");
}
```

### `CALLING_CONVENTIONS`

This frozen list describes the convention names accepted by the native ABI parser. It is an inventory, not a promise that every convention is valid on every architecture.

```js
const { CALLING_CONVENTIONS, NormalizeConvention } = require("memory/helpers");

const g_strConvention = NormalizeConvention("cdecl");
if (!CALLING_CONVENTIONS.includes(g_strConvention)) {
	throw new Error(`The runtime does not expose ${g_strConvention}.`);
}

if (!Object.isFrozen(CALLING_CONVENTIONS) || (new Set(CALLING_CONVENTIONS).size !== CALLING_CONVENTIONS.length)) {
	throw new Error("CALLING_CONVENTIONS is not a frozen unique inventory.");
}
```

### `DataKey`

`DataKey` is a static key and conversion utility used by [`ParseData()`](#parsedata) and [`memory/manager`](memory-manager.md). Its key values match their PascalCase member names, such as `"Offset"` and `"ReturnType"`; lowercase and camelCase key aliases are not provided. Native type-discriminator values remain compact lowercase strings. It provides nine conversion methods. This example converts one real function descriptor shape into ordered constructor values.

```js
const { DataKey, ParseData } = require("memory/helpers");

const g_Definitions = {
	TakeDamage: {
		Offset: "0x130",
		Arguments: ["address", "float"],
		ReturnType: "bool",
		Convention: "thiscall",
	},
};

const [[g_strFunctionName, g_vecConstructorArguments]] = ParseData(null, g_Definitions, [
	[DataKey.Offset, DataKey.AsInt64],
	[DataKey.Arguments, DataKey.AsArguments, []],
	[DataKey.ReturnType, DataKey.AsReturnType, "void"],
	[DataKey.Convention, DataKey.AsConvention, "thiscall"],
]);

if (g_strFunctionName !== "TakeDamage") {
	throw new Error("ParseData() returned an unexpected descriptor row.");
}

if ((g_vecConstructorArguments[0] !== 0x130n) || (g_vecConstructorArguments[1].join(",") !== "address,float") || (g_vecConstructorArguments[2] !== "bool") || (g_vecConstructorArguments[3] !== "thiscall")) {
	throw new Error("DataKey conversion methods produced unexpected values.");
}
```

### `DATA_TYPES`

`DATA_TYPES` includes callable-only `void`; use `TYPE_SIZES` to distinguish types that occupy storage.

```js
const { DATA_TYPES, TYPE_SIZES } = require("memory/helpers");

if (!Object.isFrozen(DATA_TYPES) || !Object.isFrozen(TYPE_SIZES) || !DATA_TYPES.includes("void") || Object.hasOwn(TYPE_SIZES, "void")) {
	throw new Error("Native type inventories do not distinguish callable void from storage types.");
}

for (const strTypeName of DATA_TYPES) {
	if (strTypeName === "void") {
		continue;
	}

	if (!Number.isSafeInteger(TYPE_SIZES[strTypeName]) || (TYPE_SIZES[strTypeName] <= 0)) {
		throw new Error(`Invalid native storage size for ${strTypeName}.`);
	}
}
```

### `KeyError`

Use `KeyError` when a named layout or descriptor key is absent. The class is exported so callers can distinguish schema failures from native address failures.

```js
const { KeyError } = require("memory/helpers");

let g_CaughtError = null;

function RequireLayout(MemoryLayouts, strLayoutName) {
	if (!Object.prototype.hasOwnProperty.call(MemoryLayouts, strLayoutName)) {
		throw new KeyError(`Unknown memory layout: ${strLayoutName}`);
	}

	return MemoryLayouts[strLayoutName];
}

try {
	RequireLayout({}, "CBaseEntity");
} catch (CaughtLayoutError) {
	g_CaughtError = CaughtLayoutError;
}

if (!(g_CaughtError instanceof KeyError) || (g_CaughtError.name !== "KeyError") || !g_CaughtError.message.includes("CBaseEntity")) {
	throw new Error("Missing layout did not throw the expected KeyError.");
}
```

### `MemberFunction`

`MemberFunction` is normally produced by `TypeManager.VirtualFunction()`. It can also bind a verified function address directly. This branch-neutral example calls the `CreateInterface` export from `server` and compares the result with SourceJS's connected-interface registry.

Its ABI metadata is stored privately, without public `m_*` fields or aliases. Edit it through `TypeManager`, `ReturnType`, `FunctionAddress`, `ThisObject`, `ArgumentTypes`, and `Convention`; the existing setters keep their validation. `ArgumentTypes` retains the supplied live array rather than copying or freezing it.

```js
const { Convention } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { MemberFunction, Type } = require("memory/helpers");
const { GetBinarySymbol } = require("memory/manager");

const g_vecInterfaceNames = GetAllInterfaceNames();
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
let g_strServerGameDLLInterfaceName = "";

for (const strInterfaceName of g_vecInterfaceNames) {
	if (strInterfaceName.startsWith("ServerGameDLL")) {
		g_strServerGameDLLInterfaceName = strInterfaceName;
		break;
	}
}

if ((g_strServerGameDLLInterfaceName === "") || (typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("The selected SDK did not expose CreateInterface or connect ServerGameDLL.");
}

const g_CreateInterfaceFunction = new MemberFunction(null, Type.Address, g_unCreateInterfaceAddress, null, [Type.StringAddress, Type.Address], Convention.Cdecl);
const g_unResolvedInterfaceAddress = g_CreateInterfaceFunction.Call(g_strServerGameDLLInterfaceName, 0n);
const g_InterfaceRecord = GetInterfaceRecord(g_strServerGameDLLInterfaceName);
if ((g_InterfaceRecord === null) || !g_InterfaceRecord.Available || (g_InterfaceRecord.Name !== g_strServerGameDLLInterfaceName) || (typeof g_InterfaceRecord.Address !== "bigint") || (g_InterfaceRecord.Address <= 0n)) {
	throw new Error("GetInterfaceRecord() returned an invalid ServerGameDLL record.");
}

const g_unRegisteredInterfaceAddress = g_InterfaceRecord.Address;
if ((g_unResolvedInterfaceAddress !== g_unRegisteredInterfaceAddress) || (g_CreateInterfaceFunction.FunctionAddress !== g_unCreateInterfaceAddress) || (g_CreateInterfaceFunction.Convention !== Convention.Cdecl)) {
	throw new Error(`CreateInterface returned an unexpected address for ${g_strServerGameDLLInterfaceName}.`);
}
```

### `NO_DEFAULT`

`NO_DEFAULT` marks a declarative field as required. `ParseData()` validates and captures key descriptors immediately, but a missing field raises `KeyError` only when the returned iterator advances to that field. It does not fabricate a value.

```js
const { DataKey, KeyError, NO_DEFAULT, ParseData } = require("memory/helpers");

let g_CaughtError = null;

try {
	ParseData(null, { Health: {} }, [[DataKey.Offset, DataKey.AsInt64, NO_DEFAULT]]).next();
} catch (CaughtParseError) {
	g_CaughtError = CaughtParseError;
}

if (!(g_CaughtError instanceof KeyError) || !g_CaughtError.message.includes(DataKey.Offset)) {
	throw new Error("Required declarative field did not throw KeyError.");
}
```

### `ADDRESS_SIZE`

`ADDRESS_SIZE` is `4` in x86 builds and `8` in x86_64 builds. Use it for address-table offsets instead of hardcoding an architecture width.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, ReadAddress, WriteAddress } = require("memory/helpers");

const g_unAddressCount = 2;
const g_unPlaceholderByteCount = 1;
let g_unFirstAddress = 0n;
let g_unSecondAddress = 0n;
let g_unAddressTableAddress = 0n;

function IsInvalidMemoryAddress(unAddress) {
	return (typeof unAddress !== "bigint") || (unAddress <= 0n);
}

const g_vecAddressTableErrors = [];
try {
	g_unFirstAddress = Allocate(g_unPlaceholderByteCount);
	g_unSecondAddress = Allocate(g_unPlaceholderByteCount);
	g_unAddressTableAddress = Allocate(ADDRESS_SIZE * g_unAddressCount);
	if (![4, 8].includes(ADDRESS_SIZE) || [g_unFirstAddress, g_unSecondAddress, g_unAddressTableAddress].some(IsInvalidMemoryAddress)) {
		throw new Error("Address-table allocation failed.");
	}

	if (!WriteAddress(g_unAddressTableAddress, g_unFirstAddress, 0n) || !WriteAddress(g_unAddressTableAddress, g_unSecondAddress, BigInt(ADDRESS_SIZE))) {
		throw new Error("Address-table write failed.");
	}

	if ((ReadAddress(g_unAddressTableAddress, 0n) !== g_unFirstAddress) || (ReadAddress(g_unAddressTableAddress, BigInt(ADDRESS_SIZE)) !== g_unSecondAddress)) {
		throw new Error("Address-table readback failed.");
	}
} catch (AddressTableError) {
	g_vecAddressTableErrors.push(AddressTableError);
} finally {
	for (const unAddress of [g_unAddressTableAddress, g_unSecondAddress, g_unFirstAddress]) {
		if (IsInvalidMemoryAddress(unAddress)) {
			continue;
		}

		try {
			if (!Deallocate(unAddress)) {
				throw new Error("Address-table allocation cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecAddressTableErrors.push(CleanupError);
		}
	}
}

if (g_vecAddressTableErrors.length === 1) {
	throw g_vecAddressTableErrors[0];
}

if (g_vecAddressTableErrors.length > 1) {
	throw new AggregateError(g_vecAddressTableErrors, "Address-table operation and allocation cleanup failed.");
}
```

### `Type`

`Type` is a static utility for storage-capable native type names. Use `NormalizeDataType()` at configuration boundaries, `IsNativeDataType()` before selecting a native accessor, and `GetDataTypeSize()` when calculating allocation or field offsets. Do not construct `Type`.

```js
const { Type } = require("memory/helpers");

const g_strDataTypeName = Type.NormalizeDataType(Type.Int);
if (!Type.IsNativeDataType(g_strDataTypeName)) {
	throw new Error(`${g_strDataTypeName} is not a native storage type.`);
}

if ((g_strDataTypeName !== Type.Int) || (Type.GetDataTypeSize(g_strDataTypeName) !== 4) || Type.IsNativeDataType("void")) {
	throw new Error("Type normalization or storage metadata is inconsistent.");
}
```

### `TYPE_SIZES`

`TYPE_SIZES` is the frozen native storage-size table for the running SourceJS architecture. Its address entry agrees with `ADDRESS_SIZE`; never assume that an address is four bytes in a package that can run on x86_64.

```js
const { ADDRESS_SIZE, TYPE_SIZES, Type } = require("memory/helpers");

if (!Object.isFrozen(TYPE_SIZES) || (TYPE_SIZES[Type.Int] !== 4) || (TYPE_SIZES[Type.Address] !== ADDRESS_SIZE) || ![4, 8].includes(ADDRESS_SIZE)) {
	throw new Error("TYPE_SIZES does not match the current architecture.");
}
```

### `Add`

`Add(unAddressValue, nAddressOffset?)` performs checked address arithmetic and returns a BigInt address without taking ownership. The optional offset is a signed 64-bit `BigInt`; omitted or nullish offsets default to `0n`. A negative value subtracts from the address. The result must still fit the current architecture's address width. Derive field or array-element addresses from an allocation, then free only the original allocation.

```js
const { Allocate, Deallocate } = require("memory");
const { Add, ReadInt, Type, WriteInt } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unIntegerCount = 2;
let g_unIntegerValuesAddress = 0n;

const g_vecAddressArithmeticErrors = [];
try {
	g_unIntegerValuesAddress = Allocate(g_unIntegerByteCount * g_unIntegerCount);
	if ((typeof g_unIntegerValuesAddress !== "bigint") || (g_unIntegerValuesAddress <= 0n)) {
		throw new Error("Address-arithmetic allocation failed.");
	}

	const unSecondIntegerAddress = Add(g_unIntegerValuesAddress, BigInt(g_unIntegerByteCount));
	if ((unSecondIntegerAddress !== (g_unIntegerValuesAddress + BigInt(g_unIntegerByteCount))) || !WriteInt(g_unIntegerValuesAddress, 17) || !WriteInt(unSecondIntegerAddress, 29)) {
		throw new Error("Address arithmetic or writes failed.");
	}

	if ((ReadInt(g_unIntegerValuesAddress) !== 17) || (ReadInt(unSecondIntegerAddress) !== 29)) {
		throw new Error("Address-arithmetic readback failed.");
	}
} catch (AddressArithmeticError) {
	g_vecAddressArithmeticErrors.push(AddressArithmeticError);
} finally {
	try {
		if ((typeof g_unIntegerValuesAddress === "bigint") && (g_unIntegerValuesAddress > 0n) && !Deallocate(g_unIntegerValuesAddress)) {
			throw new Error("Address-arithmetic allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecAddressArithmeticErrors.push(CleanupError);
	}
}

if (g_vecAddressArithmeticErrors.length === 1) {
	throw g_vecAddressArithmeticErrors[0];
}

if (g_vecAddressArithmeticErrors.length > 1) {
	throw new AggregateError(g_vecAddressArithmeticErrors, "Address-arithmetic operation and allocation cleanup failed.");
}
```

### `Compare`

`Compare(unLeftAddress, unRightAddress, unByteCount)` wraps native `memcmp`. A result of zero means all bytes are equal; any non-zero result means they differ. `unByteCount` must be a positive safe-integer `Number` or a positive `BigInt`, fitting the native address width. Both non-null BigInt address ranges must be readable. Both complete ranges must fit the native address width; an overflowing range is rejected before native access. This arithmetic check does not prove mapping, readability, or storage lifetime.

```js
const { Allocate, Deallocate } = require("memory");
const { Compare, Type, WriteInt } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
let g_unLeftMemoryAddress = 0n;
let g_unRightMemoryAddress = 0n;

function IsInvalidMemoryAddress(unAddress) {
	return (typeof unAddress !== "bigint") || (unAddress <= 0n);
}

const g_vecComparisonErrors = [];
try {
	g_unLeftMemoryAddress = Allocate(g_unIntegerByteCount);
	g_unRightMemoryAddress = Allocate(g_unIntegerByteCount);
	if ([g_unLeftMemoryAddress, g_unRightMemoryAddress].some(IsInvalidMemoryAddress)) {
		throw new Error("Byte-comparison allocation failed.");
	}

	if (!WriteInt(g_unLeftMemoryAddress, 42) || !WriteInt(g_unRightMemoryAddress, 42)) {
		throw new Error("Byte-comparison initial writes failed.");
	}

	const nEqualComparisonResult = Compare(g_unLeftMemoryAddress, g_unRightMemoryAddress, g_unIntegerByteCount);

	if (!WriteInt(g_unRightMemoryAddress, 7)) {
		throw new Error("Byte-comparison changed write failed.");
	}

	const nChangedComparisonResult = Compare(g_unLeftMemoryAddress, g_unRightMemoryAddress, g_unIntegerByteCount);
	if ((nEqualComparisonResult !== 0) || (nChangedComparisonResult === 0)) {
		throw new Error("Compare() did not distinguish equal and changed byte ranges.");
	}
} catch (ComparisonError) {
	g_vecComparisonErrors.push(ComparisonError);
} finally {
	for (const unAddress of [g_unRightMemoryAddress, g_unLeftMemoryAddress]) {
		if (IsInvalidMemoryAddress(unAddress)) {
			continue;
		}

		try {
			if (!Deallocate(unAddress)) {
				throw new Error("Byte-comparison allocation cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecComparisonErrors.push(CleanupError);
		}
	}
}

if (g_vecComparisonErrors.length === 1) {
	throw g_vecComparisonErrors[0];
}

if (g_vecComparisonErrors.length > 1) {
	throw new AggregateError(g_vecComparisonErrors, "Byte-comparison operation and allocation cleanup failed.");
}
```

### `Copy`

`Copy(unSourceAddress, unDestinationAddress, unByteCount)` performs native `memcpy` and returns `true` on success. `unByteCount` must be a positive safe-integer `Number` or a positive `BigInt`, fitting the native address width. Both non-null BigInt addresses must cover valid readable/writable ranges of that size, and both complete ranges must fit the native address width. Overflowing or overlapping ranges, including identical non-empty ranges, are rejected before native access. These checks do not prove mapping, access rights, or storage lifetime. Use [`Move()`](#move) when overlap is possible.

```js
const { Allocate, Deallocate } = require("memory");
const { Copy, ReadInt, Type, WriteInt } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
let g_unSourceMemoryAddress = 0n;
let g_unDestinationMemoryAddress = 0n;

function IsInvalidMemoryAddress(unAddress) {
	return (typeof unAddress !== "bigint") || (unAddress <= 0n);
}

const g_vecCopyErrors = [];
try {
	g_unSourceMemoryAddress = Allocate(g_unIntegerByteCount);
	g_unDestinationMemoryAddress = Allocate(g_unIntegerByteCount);
	if ([g_unSourceMemoryAddress, g_unDestinationMemoryAddress].some(IsInvalidMemoryAddress)) {
		throw new Error("Byte-copy allocation failed.");
	}

	if (!WriteInt(g_unSourceMemoryAddress, 9001) || !Copy(g_unSourceMemoryAddress, g_unDestinationMemoryAddress, g_unIntegerByteCount) || (ReadInt(g_unDestinationMemoryAddress) !== 9001)) {
		throw new Error("Copy() did not reproduce the source bytes.");
	}
} catch (CopyError) {
	g_vecCopyErrors.push(CopyError);
} finally {
	for (const unAddress of [g_unDestinationMemoryAddress, g_unSourceMemoryAddress]) {
		if (IsInvalidMemoryAddress(unAddress)) {
			continue;
		}

		try {
			if (!Deallocate(unAddress)) {
				throw new Error("Byte-copy allocation cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecCopyErrors.push(CleanupError);
		}
	}
}

if (g_vecCopyErrors.length === 1) {
	throw g_vecCopyErrors[0];
}

if (g_vecCopyErrors.length > 1) {
	throw new AggregateError(g_vecCopyErrors, "Byte-copy operation and allocation cleanup failed.");
}
```

### `GetDataTypeSize`

`GetDataTypeSize(strDataType)` returns the selected architecture's storage size for one canonical native type. It rejects `void`, custom class names, and unknown aliases because they do not have a helper-owned native storage size.

```js
const { GetDataTypeSize, Type } = require("memory/helpers");

if ((GetDataTypeSize(Type.Int) !== 4) || (GetDataTypeSize(Type.Double) !== 8) || ![4, 8].includes(GetDataTypeSize(Type.Address))) {
	throw new Error("GetDataTypeSize() returned an unsupported native layout.");
}
```

### `Difference`

`Difference(unLeftAddress, unRightAddress)` returns the signed `int64` BigInt byte distance `unLeftAddress - unRightAddress` and throws if the result is outside the `int64` range. Derive an offset from it only when both addresses belong to the same allocation or native object.

```js
const { Allocate, Deallocate } = require("memory");
const { Add, Difference } = require("memory/helpers");

const g_unStorageByteCount = 16;
const g_nFieldAddressOffset = 0x0Cn;
let g_unStorageAddress = 0n;

const g_vecAddressDifferenceErrors = [];
try {
	g_unStorageAddress = Allocate(g_unStorageByteCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Address-difference allocation failed.");
	}

	const unFieldMemoryAddress = Add(g_unStorageAddress, g_nFieldAddressOffset);
	if (Difference(unFieldMemoryAddress, g_unStorageAddress) !== g_nFieldAddressOffset) {
		throw new Error("Difference() returned the wrong byte offset.");
	}
} catch (AddressDifferenceError) {
	g_vecAddressDifferenceErrors.push(AddressDifferenceError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Address-difference allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecAddressDifferenceErrors.push(CleanupError);
	}
}

if (g_vecAddressDifferenceErrors.length === 1) {
	throw g_vecAddressDifferenceErrors[0];
}

if (g_vecAddressDifferenceErrors.length > 1) {
	throw new AggregateError(g_vecAddressDifferenceErrors, "Address-difference operation and allocation cleanup failed.");
}
```

### `IsNull`

`IsNull(unAddress)` returns whether a non-negative BigInt address is zero without dereferencing it. It is appropriate for nullable native results; it does not validate that a non-zero address is readable.

```js
const { Allocate, Deallocate } = require("memory");
const { IsNull } = require("memory/helpers");

let g_unStorageAddress = 0n;

const g_vecNullCheckErrors = [];
try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Null-check allocation failed.");
	}

	if (!IsNull(0n) || IsNull(g_unStorageAddress)) {
		throw new Error("IsNull() classified a BigInt address incorrectly.");
	}
} catch (NullCheckError) {
	g_vecNullCheckErrors.push(NullCheckError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Null-check allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecNullCheckErrors.push(CleanupError);
	}
}

if (g_vecNullCheckErrors.length === 1) {
	throw g_vecNullCheckErrors[0];
}

if (g_vecNullCheckErrors.length > 1) {
	throw new AggregateError(g_vecNullCheckErrors, "Null-check operation and allocation cleanup failed.");
}
```

### `Move`

`Move(unSourceAddress, unDestinationAddress, unByteCount)` performs native `memmove` and returns `true` on success. `unByteCount` must be a positive safe-integer `Number` or a positive `BigInt`, fitting the native address width. Both non-null BigInt addresses must cover valid readable/writable ranges of that size. Both complete ranges must fit the native address width; an overflowing range is rejected before native access. This arithmetic check does not prove mapping, access rights, or storage lifetime. Overlap is supported.

```js
const { Allocate, Deallocate } = require("memory");
const { Add, Move, ReadInt, Type, WriteInt } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unIntegerCount = 3;
const g_unMovedIntegerByteCount = g_unIntegerByteCount * (g_unIntegerCount - 1);
const g_nLastIntegerAddressOffset = BigInt(g_unMovedIntegerByteCount);
let g_unIntegerValuesAddress = 0n;

const g_vecMoveErrors = [];
try {
	g_unIntegerValuesAddress = Allocate(g_unIntegerByteCount * g_unIntegerCount);
	if ((typeof g_unIntegerValuesAddress !== "bigint") || (g_unIntegerValuesAddress <= 0n)) {
		throw new Error("Overlap-move allocation failed.");
	}

	if (!WriteInt(g_unIntegerValuesAddress, 1, 0n) || !WriteInt(g_unIntegerValuesAddress, 2, BigInt(g_unIntegerByteCount)) || !WriteInt(g_unIntegerValuesAddress, 3, g_nLastIntegerAddressOffset)) {
		throw new Error("Overlap-move initial writes failed.");
	}

	if (!Move(g_unIntegerValuesAddress, Add(g_unIntegerValuesAddress, BigInt(g_unIntegerByteCount)), g_unMovedIntegerByteCount)) {
		throw new Error("Move() returned failure.");
	}

	const vecMovedValues = [ReadInt(g_unIntegerValuesAddress, 0n), ReadInt(g_unIntegerValuesAddress, BigInt(g_unIntegerByteCount)), ReadInt(g_unIntegerValuesAddress, g_nLastIntegerAddressOffset)];
	const vecExpectedValues = [1, 1, 2];
	for (let unArrayIndex = 0; unArrayIndex < vecExpectedValues.length; unArrayIndex += 1) {
		if (vecMovedValues[unArrayIndex] !== vecExpectedValues[unArrayIndex]) {
			throw new Error(`Move() produced incorrect value ${unArrayIndex}.`);
		}
	}
} catch (MoveError) {
	g_vecMoveErrors.push(MoveError);
} finally {
	try {
		if ((typeof g_unIntegerValuesAddress === "bigint") && (g_unIntegerValuesAddress > 0n) && !Deallocate(g_unIntegerValuesAddress)) {
			throw new Error("Overlap-move allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecMoveErrors.push(CleanupError);
	}
}

if (g_vecMoveErrors.length === 1) {
	throw g_vecMoveErrors[0];
}

if (g_vecMoveErrors.length > 1) {
	throw new AggregateError(g_vecMoveErrors, "Overlap-move operation and allocation cleanup failed.");
}
```

### `NormalizeConvention`

`NormalizeConvention(strCallingConvention)` returns only an exact entry from `CALLING_CONVENTIONS`, rejecting aliases and unknown values. This validates the name, not ABI compatibility; use a convention supported by the selected architecture and native call or hook target.

```js
const { Convention } = require("memory");
const { NormalizeConvention } = require("memory/helpers");

const g_strConvention = NormalizeConvention(Convention.Cdecl);
if (g_strConvention !== Convention.Cdecl) {
	throw new Error("NormalizeConvention() changed a canonical convention.");
}
```

### `NormalizeDataType`

`NormalizeDataType(strDataType)` validates and returns one canonical native storage-type name. Use it for native storage metadata passed to `Read()`, `Write()`, or a manager descriptor; it does not accept `void` or custom type names.

```js
const { DataType } = require("memory");
const { NormalizeDataType } = require("memory/helpers");

const g_strDataTypeName = NormalizeDataType(DataType.Int);
if (g_strDataTypeName !== DataType.Int) {
	throw new Error("NormalizeDataType() changed a canonical data type.");
}
```

### `ParseData`

`ParseData(TypeManager, Definitions, vecKeyDescriptors)` returns a lazy iterator that transforms each own enumerable named definition into ordered constructor arguments. A key descriptor is `[strPropertyName, ValueConverter, DefaultValue = NO_DEFAULT]`; omitting the default makes the property mandatory. Platform-specific properties such as `OffsetWindows` and `OffsetLinux` take precedence over `Offset`. The `Definitions` root is validated and descriptor tuples are normalized to snapshots when the iterator is created; definition records remain live and are read lazily as each row is consumed.

```js
const { DataKey, ParseData } = require("memory/helpers");

const g_Definitions = {
	TakeDamage: {
		Binary: "server",
		Identifier: "55 8B EC",
		Offset: "0x130",
		ServerCheck: "true",
	},
};

const [[g_strFunctionName, g_vecConstructorArguments]] = ParseData(null, g_Definitions, [
	[DataKey.Binary, DataKey.AsString],
	[DataKey.Identifier, DataKey.AsIdentifier],
	[DataKey.Offset, DataKey.AsInt64, 0n],
	[DataKey.ServerCheck, DataKey.AsBoolean, false],
]);

const g_vecExpectedArguments = ["server", "\\x55\\x8B\\xEC", 0x130n, true];

if (g_strFunctionName !== "TakeDamage") {
	throw new Error("ParseData() produced an unexpected descriptor row.");
}

function IsExpectedArgument(ArgumentValue, unArgumentIndex) {
	return ArgumentValue === g_vecExpectedArguments[unArgumentIndex];
}

if ((g_vecConstructorArguments.length !== g_vecExpectedArguments.length) || !g_vecConstructorArguments.every(IsExpectedArgument)) {
	throw new Error("ParseData() produced unexpected constructor arguments.");
}
```

### `Address`

`Address(unAddress = 0n)` validates and returns a target-width BigInt address; omitted or nullish input becomes `0n`. It does not allocate or dereference, and a non-zero result is not proof that the address is mapped or readable.

```js
const { Allocate, Deallocate } = require("memory");
const { Address } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Address-normalization allocation failed.");
	}

	if ((Address() !== 0n) || (Address(g_unStorageAddress) !== g_unStorageAddress)) {
		throw new Error("Address() changed a valid BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Address-normalization allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `Read`

`Read(unAddress, strDataType = "address", nAddressOffset = 0n)` reads one native value from `unAddress + nAddressOffset`. The base must be a non-null BigInt address; the type defaults to `"address"` for omitted or nullish input. `nAddressOffset` is a signed 64-bit BigInt; omitted or nullish values default to `0n`, as for the typed `Read*` helpers below. Scalar reads check the entire native-width address range for arithmetic overflow and copy bytes into aligned local storage, so packed or unaligned slots are supported. The caller must still provide mapped, readable storage with a valid native representation, including valid bool and address representations. String reads require a readable null-terminated string; `"stringaddress"` first reads a native address-sized slot, returning `null` for a null address or otherwise following it as a string address. Mapping, permissions, terminator bounds, and storage lifetime are not verified. Non-nullish type names must be primitive strings; other types are rejected without coercion. Encoding or result-construction failures are rejected, and C++ exceptions are translated; operating-system access faults are not caught.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, Read, Write } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Int));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Generic-read allocation failed.");
	}

	if (!Write(g_unStorageAddress, Type.Int, -256) || (Read(g_unStorageAddress, Type.Int) !== -256)) {
		throw new Error("Generic memory read/write did not round-trip an integer.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Generic-read allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadBool`

`ReadBool(unAddress, nAddressOffset = 0n)` reads the native `bool` representation and returns a JavaScript boolean.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadBool, WriteBool } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Bool));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Boolean allocation failed.");
	}

	if (!WriteBool(g_unStorageAddress, true) || !ReadBool(g_unStorageAddress)) {
		throw new Error("ReadBool() did not return the written boolean.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Boolean allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadDouble`

`ReadDouble(unAddress, nAddressOffset = 0n)` reads one native double-precision floating-point value and returns a JavaScript `Number`.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadDouble, WriteDouble } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Double));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Double allocation failed.");
	}

	if (!WriteDouble(g_unStorageAddress, Math.PI) || (ReadDouble(g_unStorageAddress) !== Math.PI)) {
		throw new Error("ReadDouble() did not return the written value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Double allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadFloat`

`ReadFloat(unAddress, nAddressOffset = 0n)` reads one native single-precision floating-point value and returns a JavaScript `Number`. Expect normal float32 rounding when comparing it with a JavaScript number.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadFloat, WriteFloat } = require("memory/helpers");

const g_flExpectedFloatValue = 9.81;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Float));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Float allocation failed.");
	}

	if (!WriteFloat(g_unStorageAddress, g_flExpectedFloatValue) || (ReadFloat(g_unStorageAddress) !== Math.fround(g_flExpectedFloatValue))) {
		throw new Error("ReadFloat() did not return the written float32 value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Float allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadInt`

`ReadInt(unAddress, nAddressOffset = 0n)` reads one native signed `int` value at the supplied byte offset and returns a JavaScript `Number`.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadInt, WriteInt } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unIntegerCount = 2;
const g_nSecondIntegerAddressOffset = BigInt(g_unIntegerByteCount);
const g_vecErrors = [];
let g_unPairAddress = 0n;

try {
	g_unPairAddress = Allocate(g_unIntegerByteCount * g_unIntegerCount);
	if ((typeof g_unPairAddress !== "bigint") || (g_unPairAddress <= 0n)) {
		throw new Error("Integer-pair allocation failed.");
	}

	if (!WriteInt(g_unPairAddress, -64, g_nSecondIntegerAddressOffset) || (ReadInt(g_unPairAddress, g_nSecondIntegerAddressOffset) !== -64)) {
		throw new Error("ReadInt() did not return the offset value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unPairAddress === "bigint") && (g_unPairAddress > 0n) && !Deallocate(g_unPairAddress)) {
			throw new Error("Integer-pair allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadAddress`

`ReadAddress(unAddress, nAddressOffset = 0n)` reads one native address slot at the byte offset and returns its BigInt value. The helper rejects a native-width range that overflows the address space and copies bytes into aligned local storage, allowing packed or unaligned slots. The caller must provide mapped, readable storage containing a valid native address representation and keep it alive throughout the call; those preconditions are not verified. The returned address is non-owning. Its optional offset follows `Read()`'s signed 64-bit BigInt contract; failed result construction and conversion errors follow the same failure boundary.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadAddress, WriteAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unTargetAddress = 0n;
let g_unSlotAddress = 0n;

function IsInvalidMemoryAddress(unAddress) {
	return (typeof unAddress !== "bigint") || (unAddress <= 0n);
}

try {
	g_unTargetAddress = Allocate(1);
	g_unSlotAddress = Allocate(Type.GetDataTypeSize(Type.Address));
	if ([g_unTargetAddress, g_unSlotAddress].some(IsInvalidMemoryAddress)) {
		throw new Error("Address-slot allocation failed.");
	}

	if (!WriteAddress(g_unSlotAddress, g_unTargetAddress) || (ReadAddress(g_unSlotAddress) !== g_unTargetAddress)) {
		throw new Error("ReadAddress() did not return the written BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	for (const unAddress of [g_unSlotAddress, g_unTargetAddress]) {
		if (IsInvalidMemoryAddress(unAddress)) {
			continue;
		}

		try {
			if (!Deallocate(unAddress)) {
				throw new Error("Address-slot allocation cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecErrors.push(CleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ReadUInt`

`ReadUInt(unAddress, nAddressOffset = 0n)` reads one native unsigned `int` value and returns a JavaScript `Number`.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadUInt, WriteUInt } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.UInt));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Unsigned-integer allocation failed.");
	}

	if (!WriteUInt(g_unStorageAddress, 0xFEEDBEEF) || (ReadUInt(g_unStorageAddress) !== 0xFEEDBEEF)) {
		throw new Error("ReadUInt() did not return the written value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Unsigned-integer allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `SearchBytes`

`SearchBytes(unAddress, BytePattern, unByteCount)` scans a readable range from a non-null BigInt address and returns the first match as a BigInt address, or `0n` when absent. `BytePattern` is a non-empty string or byte array. A string pattern is converted to UTF-8 bytes, including embedded zero bytes; use a byte array for arbitrary binary data. Array entries are converted to numbers and must be finite, integral and within `0` through `255` before native narrowing; fractions and out-of-range values are rejected without truncation or wraparound. Getter/conversion exceptions are preserved, C++ failures are translated, and a failed pattern read never starts the scan. `unByteCount` accepts a positive safe-integer Number or a positive BigInt fitting the native address width. It must be at least the encoded pattern length in bytes and keep the entire search range within the target address space. The arithmetic range check does not prove readability or storage lifetime.

```js
const { Allocate, Deallocate } = require("memory");
const { Difference, SearchBytes, Type, Write } = require("memory/helpers");

const g_vecBytePattern = [0xDE, 0xAD, 0xBE, 0xEF];
const g_vecMemoryBytes = [0x00, 0x01, ...g_vecBytePattern, 0x02, 0x03];
const g_nExpectedByteOffset = 0x02n;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_vecMemoryBytes.length);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Byte-search allocation failed.");
	}

	for (const [unByteOffset, unByteValue] of g_vecMemoryBytes.entries()) {
		if (!Write(g_unStorageAddress, Type.UChar, unByteValue, BigInt(unByteOffset))) {
			throw new Error(`Byte-search write failed at offset ${unByteOffset}.`);
		}
	}

	const unMatchedMemoryAddress = SearchBytes(g_unStorageAddress, g_vecBytePattern, g_vecMemoryBytes.length);
	if ((unMatchedMemoryAddress !== (g_unStorageAddress + g_nExpectedByteOffset)) || (Difference(unMatchedMemoryAddress, g_unStorageAddress) !== g_nExpectedByteOffset) || (SearchBytes(g_unStorageAddress, [0xFF], g_vecMemoryBytes.length) !== 0n)) {
		throw new Error("SearchBytes() returned an unexpected match address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Byte-search allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `SetProtection`

`SetProtection(unAddress, unByteCount, MemoryProtection)` applies native page protection to a non-null BigInt address range with a positive safe-integer Number or positive BigInt byte count fitting the native address width. `MemoryProtection` accepts a primitive Number `Protection` value from `0` through `5`, or a primitive string containing one of the symbolic codes `""`, `"R"`, `"RW"`, `"X"`, `"RX"`, and `"RWX"`; other types are rejected without coercion. Number modes must be finite, integral and within `0` through `5` before native narrowing; fractional and out-of-range modes are rejected, not truncated or wrapped. Failed string encoding is rejected, never interpreted as the valid empty-string mode; JavaScript exceptions are preserved and C++ failures are translated. The complete range is checked for address overflow and must be mapped. POSIX aligns the start down to the queried page size and includes the leading bytes in the protected extent, checking size overflow before `mprotect`; protection operates on whole native pages. Its boolean result reports whether the platform protection call succeeded; a failed POSIX page-size query returns `false`. It does not return the previous mode. The example requests read/write protection for plugin-owned storage and does not modify executable engine pages.

```js
const { Allocate, Deallocate, Protection } = require("memory");
const { SetProtection } = require("memory/helpers");

const g_unAllocationByteCount = 64;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unAllocationByteCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Protection allocation failed.");
	}

	if (!SetProtection(g_unStorageAddress, g_unAllocationByteCount, Protection.ReadWrite)) {
		throw new Error("SetProtection() returned failure.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Protection allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `Subtract`

`Subtract(unAddressValue, nAddressOffset?)` subtracts a signed 64-bit BigInt byte offset from a nonnegative BigInt address. An omitted or nullish offset is `0n`; a negative offset adds to the address. It returns a target-address-width BigInt result without reading memory or changing ownership, and throws if the arithmetic leaves the target address range.

```js
const { Allocate, Deallocate } = require("memory");
const { Add, Subtract } = require("memory/helpers");

const g_unStorageByteCount = 16;
const g_nTailAddressOffset = 0x0Cn;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unStorageByteCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Address-subtraction allocation failed.");
	}

	const unTailMemoryAddress = Add(g_unStorageAddress, g_nTailAddressOffset);
	if (Subtract(unTailMemoryAddress, g_nTailAddressOffset) !== g_unStorageAddress) {
		throw new Error("Subtract() returned the wrong BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Address-subtraction allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `VirtualFunction`

`VirtualFunction(unAddress, unVirtualFunctionIndex)` reads the zero-based slot at a non-null BigInt object address. It byte-copies the native address slots, allowing unaligned storage, and rejects arithmetic overflow of both the object slot's complete range and the selected vtable slot's complete range. The caller still supplies live, readable storage containing valid native address representations for the selected ABI, including the selected slot; numeric range checks do not prove mapping, access permissions, or lifetime. When the initial vtable address is non-null, the converted index must be finite, integral and within the nonnegative signed 32-bit range before slot arithmetic, without truncation or wraparound. Index conversion may execute JavaScript; afterward, the binding rereads the object's vtable and uses that current value. The result is the selected slot's address as a BigInt, or `0n` for a null current table or entry. An initially null table preserves the `0n` sentinel without converting the unused index. Conversion/read failures preserve JavaScript exceptions, and native C++ failures are translated at the callback boundary. The helper neither validates nor invokes the function.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, Add, VirtualFunction, WriteAddress } = require("memory/helpers");

const g_unAddressSlotCount = 3;
const g_unFunctionAddressCount = 2;
const g_nSecondFunctionByteOffset = 0x01n;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(ADDRESS_SIZE * g_unAddressSlotCount + g_unFunctionAddressCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Virtual-function allocation failed.");
	}

	const unObjectAddress = g_unStorageAddress;
	const unTableAddress = Add(g_unStorageAddress, BigInt(ADDRESS_SIZE));
	const unFirstFunctionAddress = Add(g_unStorageAddress, BigInt(ADDRESS_SIZE * g_unAddressSlotCount));
	const unSecondFunctionAddress = Add(unFirstFunctionAddress, g_nSecondFunctionByteOffset);
	if (!WriteAddress(unTableAddress, unFirstFunctionAddress) || !WriteAddress(unTableAddress, unSecondFunctionAddress, BigInt(ADDRESS_SIZE)) || !WriteAddress(unObjectAddress, unTableAddress)) {
		throw new Error("Virtual-function table setup failed.");
	}

	if (VirtualFunction(unObjectAddress, 1) !== unSecondFunctionAddress) {
		throw new Error("VirtualFunction() returned the wrong slot address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Virtual-function allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `VirtualTable`

`VirtualTable(unAddress)` byte-copies the first native address-sized slot at a non-null BigInt address as the object's vtable address, returning that address as a BigInt or `0n` when the slot is null. Unaligned storage is supported, and arithmetic overflow of the slot's complete range is rejected before the read. The caller supplies live, readable storage with a valid native address representation matching the selected ABI; the helper cannot establish mapping, access permissions, or object/table lifetime. Conversion/read failures preserve JavaScript exceptions, and native C++ failures are translated at the callback boundary.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, Add, VirtualTable, WriteAddress } = require("memory/helpers");

const g_unAddressSlotCount = 2;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(ADDRESS_SIZE * g_unAddressSlotCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Virtual-table allocation failed.");
	}

	const unObjectAddress = g_unStorageAddress;
	const unTableAddress = Add(g_unStorageAddress, BigInt(ADDRESS_SIZE));
	if (!WriteAddress(unObjectAddress, unTableAddress) || (VirtualTable(unObjectAddress) !== unTableAddress)) {
		throw new Error("VirtualTable() did not return the stored table address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Virtual-table allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `Write`

`Write(unAddress, strDataType, DataValue, nAddressOffset = 0n)` writes one directly supported native scalar or address value and returns a success boolean. Canonical `strDataType` values are `bool`, `char`, `uchar`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `longlong`, `ulonglong`, `float`, `double`, and `address`; `void`, `string`, `stringaddress`, and `stringarray` are not directly writable.

`unAddress` must be a non-null BigInt address; the signed 64-bit BigInt byte offset defaults to `0n`. `DataValue` follows the selected type's contract: `bool` requires a boolean; integer types up to 32 bits convert to a number, then require a finite integral value in the selected native type's range before narrowing or writing; `long`/`ulong` require an in-range BigInt when 64-bit and otherwise follow the same bounded Number conversion; `longlong`/`ulonglong` require BigInt; floating types use finite numeric conversions, with `float` also enforcing the native range; and `address` requires a nonnegative BigInt.

The complete native-width slot must be mapped and writable, and suitable for the selected native representation. The helper validates arguments and the entire slot's address range before storing bytes with `memcpy`, supporting packed or unaligned slots without an aligned typed dereference. It does not validate mapping, write permissions, or storage lifetime, and does not allocate or own the storage. `strDataType` must be a primitive string; other types are rejected without coercion. Failed type-name encoding or data conversion stops the write; original JavaScript exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadInt, Write } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unIntegerValueCount = 2;
const g_nExpectedIntegerValue = -12;
const g_nSecondIntegerOffset = BigInt(g_unIntegerByteCount);
const g_vecErrors = [];
let g_unPairAddress = 0n;

try {
	g_unPairAddress = Allocate(g_unIntegerByteCount * g_unIntegerValueCount);
	if ((typeof g_unPairAddress !== "bigint") || (g_unPairAddress <= 0n)) {
		throw new Error("Generic-write allocation failed.");
	}

	if (!Write(g_unPairAddress, Type.Int, g_nExpectedIntegerValue, g_nSecondIntegerOffset) || (ReadInt(g_unPairAddress, g_nSecondIntegerOffset) !== g_nExpectedIntegerValue)) {
		throw new Error("Write() did not store the integer at the requested offset.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unPairAddress === "bigint") && (g_unPairAddress > 0n) && !Deallocate(g_unPairAddress)) {
			throw new Error("Generic-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteAddress`

`WriteAddress(unAddress, unStoredAddress, nAddressOffset = 0n)` writes a nonnegative BigInt address into a native address-sized slot at the non-null BigInt base plus the signed 64-bit BigInt byte offset. The helper checks the entire slot for address overflow and copies the valid native address representation as bytes, allowing packed or unaligned slots. The complete slot must still be mapped, writable, and alive throughout the call; the helper does not verify those memory preconditions. It returns `true` on success, throws for invalid arguments, address arithmetic, or conversion failures, and does not own or transfer either address.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, ReadAddress, WriteAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unAddressSlot = 0n;
let g_unTargetMemoryAddress = 0n;

function IsInvalidMemoryAddress(unAddress) {
	return (typeof unAddress !== "bigint") || (unAddress <= 0n);
}

try {
	g_unAddressSlot = Allocate(ADDRESS_SIZE);
	g_unTargetMemoryAddress = Allocate(1);
	if ([g_unAddressSlot, g_unTargetMemoryAddress].some(IsInvalidMemoryAddress)) {
		throw new Error("Address-write allocation failed.");
	}

	if (!WriteAddress(g_unAddressSlot, g_unTargetMemoryAddress) || (ReadAddress(g_unAddressSlot) !== g_unTargetMemoryAddress)) {
		throw new Error("WriteAddress() did not store the BigInt target address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	for (const unAddress of [g_unTargetMemoryAddress, g_unAddressSlot]) {
		if (IsInvalidMemoryAddress(unAddress)) {
			continue;
		}

		try {
			if (!Deallocate(unAddress)) {
				throw new Error("Address-write allocation cleanup failed.");
			}
		} catch (CleanupError) {
			g_vecErrors.push(CleanupError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteBool`

`WriteBool(unAddress, bBooleanValue, nAddressOffset = 0n)` requires a JavaScript boolean and writes one native `bool` slot at the non-null BigInt base plus a signed 64-bit BigInt byte offset. The complete native-width slot must be mapped, writable, and alive throughout the call. The helper checks the entire slot for address overflow and stores the native representation with `memcpy`, allowing packed or unaligned slots. The helper does not validate those memory preconditions, allocate storage, or own it. It returns `true` on success; invalid arguments and address-arithmetic errors throw. Original JavaScript conversion exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadBool, WriteBool } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Bool));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Boolean-write allocation failed.");
	}

	if (!WriteBool(g_unStorageAddress, true) || !ReadBool(g_unStorageAddress)) {
		throw new Error("WriteBool() did not store true.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Boolean-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteDouble`

`WriteDouble(unAddress, dblDoubleValue, nAddressOffset = 0n)` converts the value through V8's numeric conversion and requires the result to be finite. It writes one native `double` at the non-null BigInt base plus a signed 64-bit BigInt byte offset. The complete native-width slot must be mapped, writable, and alive throughout the call. The helper checks the entire slot for address overflow and stores the native representation with `memcpy`, allowing packed or unaligned slots. The helper does not validate those memory preconditions, allocate storage, or own it. It returns `true` on success; invalid arguments, values, or address arithmetic throw. Original JavaScript conversion exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadDouble, WriteDouble } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Double));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Double-write allocation failed.");
	}

	if (!WriteDouble(g_unStorageAddress, Math.PI) || (ReadDouble(g_unStorageAddress) !== Math.PI)) {
		throw new Error("WriteDouble() did not store the supplied value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Double-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteFloat`

`WriteFloat(unAddress, flFloatValue, nAddressOffset = 0n)` converts the value through V8's numeric conversion and requires the result to be finite and within the native `float` range. It writes one native `float` slot at the non-null BigInt base plus a signed 64-bit BigInt byte offset. The complete native-width slot must be mapped, writable, and alive throughout the call. The helper checks the entire slot for address overflow and stores the native representation with `memcpy`, allowing packed or unaligned slots. The helper does not validate those memory preconditions, allocate storage, or own it. It returns `true` on success; invalid arguments, out-of-range values, or address arithmetic throw. Readback reflects float32 rounding. Original JavaScript conversion exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadFloat, WriteFloat } = require("memory/helpers");

const g_flExpectedFloatValue = 9.81;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Float));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Float-write allocation failed.");
	}

	if (!WriteFloat(g_unStorageAddress, g_flExpectedFloatValue) || (ReadFloat(g_unStorageAddress) !== Math.fround(g_flExpectedFloatValue))) {
		throw new Error("WriteFloat() did not store the float32 value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Float-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteInt`

`WriteInt(unAddress, nSignedIntegerValue, nAddressOffset = 0n)` converts a numeric value, requires it to be finite, integral and within the signed 32-bit range, then writes it to one native signed `int` slot at the non-null BigInt base plus the signed 64-bit BigInt byte offset. Invalid values are rejected before native narrowing or writing, without truncation or wraparound. The complete native-width slot must be mapped, writable, and alive throughout the call. The helper checks the entire slot for address overflow and stores the native representation with `memcpy`, allowing packed or unaligned slots. The helper does not validate those memory preconditions, allocate storage, or own it. It returns `true` on success; invalid arguments, out-of-range values or address arithmetic throw. Original JavaScript conversion exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadInt, WriteInt } = require("memory/helpers");

const g_nExpectedIntegerValue = -64;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Int));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Integer-write allocation failed.");
	}

	if (!WriteInt(g_unStorageAddress, g_nExpectedIntegerValue) || (ReadInt(g_unStorageAddress) !== g_nExpectedIntegerValue)) {
		throw new Error("WriteInt() did not store the supplied value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Integer-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `WriteUInt`

`WriteUInt(unAddress, unUnsignedIntegerValue, nAddressOffset = 0n)` converts a numeric value, requires it to be finite, integral and within `0` through `0xFFFFFFFF`, then writes it to one native `unsigned int` slot at the non-null BigInt base plus the signed 64-bit BigInt byte offset. Invalid values are rejected before native narrowing or writing, without truncation or wraparound. The complete native-width slot must be mapped, writable, and alive throughout the call. The helper checks the entire slot for address overflow and stores the native representation with `memcpy`, allowing packed or unaligned slots. The helper does not validate those memory preconditions, allocate storage, or own it. It returns `true` on success; invalid arguments, out-of-range values or address arithmetic throw. Original JavaScript conversion exceptions are preserved and C++ failures are translated, not operating-system access faults.

```js
const { Allocate, Deallocate } = require("memory");
const { Type, ReadUInt, WriteUInt } = require("memory/helpers");

const g_unExpectedUnsignedValue = 0xFEEDBEEF;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.UInt));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("Unsigned-write allocation failed.");
	}

	if (!WriteUInt(g_unStorageAddress, g_unExpectedUnsignedValue) || (ReadUInt(g_unStorageAddress) !== g_unExpectedUnsignedValue)) {
		throw new Error("WriteUInt() did not store the supplied value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("Unsigned-write allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.At`

`ArrayView.At(unArrayIndex)` reads one live element. A native inline view uses `null` as the type manager, `false` for `bIsAddressArray`, a `Type` name, and the base address. A non-negative safe-integer length is optional for indexed access; this example supplies one to enforce bounds and enable iteration.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unArrayLength = 3;
const g_unFirstArrayIndex = 0;
const g_unMiddleArrayIndex = 1;
const g_unLastArrayIndex = 2;
const g_nExpectedMiddleIntegerValue = 20;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	const FirstSetResult = IntegerArrayView.Set(g_unFirstArrayIndex, 10);
	const MiddleSetResult = IntegerArrayView.Set(g_unMiddleArrayIndex, g_nExpectedMiddleIntegerValue);
	const LastSetResult = IntegerArrayView.Set(g_unLastArrayIndex, 30);
	if ((FirstSetResult !== IntegerArrayView) || (MiddleSetResult !== IntegerArrayView) || (LastSetResult !== IntegerArrayView) || (IntegerArrayView.At(g_unMiddleArrayIndex) !== g_nExpectedMiddleIntegerValue)) {
		throw new Error("ArrayView.At() did not return the live element.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.Entries`

`ArrayView.Entries()` returns a lazy iterator of `[unArrayIndex, ElementValue]` pairs within the view's constructor-declared length, does not consume an index when reading it fails, and requires a declared length. Element reads remain live, and a completed iterator stays complete.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_vecExpectedValues = [3, 5, 8];
const g_unArrayLength = g_vecExpectedValues.length;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.Entries() example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	for (const [unArrayIndex, nElementValue] of g_vecExpectedValues.entries()) {
		if (IntegerArrayView.Set(unArrayIndex, nElementValue) !== IntegerArrayView) {
			throw new Error(`ArrayView.Entries() setup failed at index ${unArrayIndex}.`);
		}
	}

	const vecEntries = [...IntegerArrayView.Entries()];
	if (vecEntries.length !== g_unArrayLength) {
		throw new Error("ArrayView.Entries() returned the wrong pair count.");
	}

	for (const [unExpectedIndex, vecEntry] of vecEntries.entries()) {
		const [unArrayIndex, nElementValue] = vecEntry;
		if ((unArrayIndex !== unExpectedIndex) || (nElementValue !== g_vecExpectedValues[unExpectedIndex])) {
			throw new Error(`ArrayView.Entries() returned an unexpected pair at index ${unExpectedIndex}.`);
		}
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.Entries() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.ForEach`

`ArrayView.ForEach(Callback, ThisArgument = undefined)` requires a function and calls it with `ThisArgument` as `this`, passing each live `ElementValue`, `unArrayIndex`, and this view. Iteration stays within the constructor-declared length, which is required. Callback return values are ignored. The method returns `undefined`; callback and element-read errors propagate.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_vecExpectedValues = [4, 6, 10];
const g_unArrayLength = g_vecExpectedValues.length;
const g_nExpectedValueTotal = 20;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);

const g_vecErrors = [];
let g_unStorageAddress = 0n;

function IsUnexpectedIndex(unArrayIndex, unExpectedIndex) {
	return unArrayIndex !== unExpectedIndex;
}

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.ForEach() example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	for (const [unArrayIndex, nElementValue] of g_vecExpectedValues.entries()) {
		if (IntegerArrayView.Set(unArrayIndex, nElementValue) !== IntegerArrayView) {
			throw new Error(`ArrayView.ForEach() setup failed at index ${unArrayIndex}.`);
		}
	}

	const IterationContext = {
		AllViewsMatch: true,
		Indexes: [],
		Total: 0,
	};

	function OnArrayViewValue(nElementValue, unArrayIndex, IteratedArrayView) {
		this.AllViewsMatch = this.AllViewsMatch && (IteratedArrayView === IntegerArrayView);
		this.Indexes.push(unArrayIndex);
		this.Total += nElementValue;
	}

	if (IntegerArrayView.ForEach(OnArrayViewValue, IterationContext) !== undefined) {
		throw new Error("ArrayView.ForEach() did not return undefined.");
	}

	if (!IterationContext.AllViewsMatch || (IterationContext.Total !== g_nExpectedValueTotal)) {
		throw new Error("ArrayView.ForEach() passed unexpected callback values.");
	}

	if ((IterationContext.Indexes.length !== g_unArrayLength) || IterationContext.Indexes.some(IsUnexpectedIndex)) {
		throw new Error("ArrayView.ForEach() did not visit every index in order.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.ForEach() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.GetOffset`

`ArrayView.GetOffset(unArrayIndex)` returns the zero-based element's BigInt byte offset, calculated from native address size for address arrays, native type size, or the custom class's `TypeSize`. The index must be a nonnegative safe integer; a declared length also enforces its upper bound. This computes an offset only and does not access memory.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_unArrayLength = 3;
const g_unFirstArrayIndex = 0;
const g_unMiddleArrayIndex = 1;
const g_unLastArrayIndex = 2;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_nExpectedFirstByteOffset = 0n;
const g_nExpectedMiddleByteOffset = BigInt(g_unIntegerByteCount * g_unMiddleArrayIndex);
const g_nExpectedLastByteOffset = BigInt(g_unIntegerByteCount * g_unLastArrayIndex);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.GetOffset() example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	if ((IntegerArrayView.GetOffset(g_unFirstArrayIndex) !== g_nExpectedFirstByteOffset) || (IntegerArrayView.GetOffset(g_unMiddleArrayIndex) !== g_nExpectedMiddleByteOffset) || (IntegerArrayView.GetOffset(g_unLastArrayIndex) !== g_nExpectedLastByteOffset)) {
		throw new Error("ArrayView.GetOffset() returned an unexpected byte offset.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.GetOffset() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.Keys`

`ArrayView.Keys()` returns a lazy iterator of zero-based safe-integer indexes within the required constructor-declared length. It does not read elements, and a completed iterator stays complete.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_unArrayLength = 3;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);

const g_vecErrors = [];
let g_unStorageAddress = 0n;

function IsUnexpectedIndex(unArrayIndex, unExpectedIndex) {
	return unArrayIndex !== unExpectedIndex;
}

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.Keys() example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	const vecIndexes = [...IntegerArrayView.Keys()];
	if ((vecIndexes.length !== g_unArrayLength) || vecIndexes.some(IsUnexpectedIndex)) {
		throw new Error("ArrayView.Keys() did not return every valid index in order.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.Keys() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.Set`

`ArrayView.Set(unArrayIndex, ElementValue)` requires a nonnegative safe-integer index and writes native values through to inline or address-backed storage. It returns the same view for every element kind, including custom inline elements whose bytes are copied into the slot. Custom address arrays read the object's public `Address` property, write that BigInt address to the slot, and retain `ElementValue` in `AddressValues`, keyed by the slot's BigInt address, to preserve its JavaScript lifetime. If the address write fails, the previous retention entry is restored; a restoration failure is reported together with the original write error in an `AggregateError`.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, ReadInt, Type } = require("memory/helpers");

const g_unArrayLength = 3;
const g_unArrayIndex = 1;
const g_nExpectedIntegerValue = 100;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_nExpectedByteOffset = BigInt(g_unIntegerByteCount * g_unArrayIndex);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.Set() example allocation failed.");
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	const ArrayViewSetResult = IntegerArrayView.Set(g_unArrayIndex, g_nExpectedIntegerValue);
	if ((ArrayViewSetResult !== IntegerArrayView) || (ReadInt(g_unStorageAddress, g_nExpectedByteOffset) !== g_nExpectedIntegerValue)) {
		throw new Error("ArrayView.Set() did not write through to native memory.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.Set() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.ToArray`

`ArrayView.ToArray()` requires a declared length, captures it when called, and synchronously reads each index from zero up to that count into a new JavaScript array. It copies the array container, not the underlying storage; object elements can remain references or views, and custom conversions may run during reads.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_vecExpectedValues = [2, 4, 8];
const g_unArrayLength = g_vecExpectedValues.length;
const g_unMiddleArrayIndex = 1;
const g_nUpdatedIntegerValue = 16;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.ToArray() example allocation failed.");
	}

	function IsExpectedValue(nElementValue, unArrayIndex) {
		return nElementValue === g_vecExpectedValues[unArrayIndex];
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	for (const [unArrayIndex, nElementValue] of g_vecExpectedValues.entries()) {
		if (IntegerArrayView.Set(unArrayIndex, nElementValue) !== IntegerArrayView) {
			throw new Error(`ArrayView.ToArray() setup failed at index ${unArrayIndex}.`);
		}
	}

	const vecCopiedValues = IntegerArrayView.ToArray();

	if (IntegerArrayView.Set(g_unMiddleArrayIndex, g_nUpdatedIntegerValue) !== IntegerArrayView) {
		throw new Error("ArrayView.ToArray() follow-up write failed.");
	}

	if ((vecCopiedValues.length !== g_unArrayLength) || !vecCopiedValues.every(IsExpectedValue)) {
		throw new Error("ArrayView.ToArray() did not return an independent point-in-time copy.");
	}

	if (IntegerArrayView.At(g_unMiddleArrayIndex) !== g_nUpdatedIntegerValue) {
		throw new Error("ArrayView.ToArray() follow-up write was not visible through the live view.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.ToArray() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `ArrayView.Values`

`ArrayView.Values()` creates a fresh lazy value iterator using the same implementation as `for...of`. It requires a constructor-declared length, reads live elements within that fixed bound, advances only after a successful element read, and stays complete after exhaustion.

```js
const { Allocate, Deallocate } = require("memory");
const { ArrayView, Type } = require("memory/helpers");

const g_nUnchangedIntegerValue = 1;
const g_nUpdatedIntegerValue = 3;
const g_nFinalIntegerValue = 2;
const g_vecInitialValues = [g_nUnchangedIntegerValue, g_nUnchangedIntegerValue, g_nFinalIntegerValue];
const g_vecExpectedLiveValues = [g_nUnchangedIntegerValue, g_nUpdatedIntegerValue, g_nFinalIntegerValue];
const g_unArrayLength = g_vecInitialValues.length;
const g_unUpdatedArrayIndex = 1;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unArrayLength);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("ArrayView.Values() example allocation failed.");
	}

	function IsUnexpectedIteratorResult(IteratorResult, unArrayIndex) {
		return IteratorResult.done || (IteratorResult.value !== g_vecExpectedLiveValues[unArrayIndex]);
	}

	function IsExpectedLiveValue(nElementValue, unArrayIndex) {
		return nElementValue === g_vecExpectedLiveValues[unArrayIndex];
	}

	const IntegerArrayView = new ArrayView(null, false, Type.Int, g_unStorageAddress, g_unArrayLength);
	for (const [unArrayIndex, nElementValue] of g_vecInitialValues.entries()) {
		if (IntegerArrayView.Set(unArrayIndex, nElementValue) !== IntegerArrayView) {
			throw new Error(`ArrayView.Values() setup failed at index ${unArrayIndex}.`);
		}
	}

	const itArrayValues = IntegerArrayView.Values();
	const FirstIteratorResult = itArrayValues.next();

	if (IntegerArrayView.Set(g_unUpdatedArrayIndex, g_nUpdatedIntegerValue) !== IntegerArrayView) {
		throw new Error("ArrayView.Values() live-write setup failed.");
	}

	const SecondIteratorResult = itArrayValues.next();
	const ThirdIteratorResult = itArrayValues.next();
	const CompletedIteratorResult = itArrayValues.next();
	const vecYieldedIteratorResults = [FirstIteratorResult, SecondIteratorResult, ThirdIteratorResult];
	const vecIteratedValues = [...IntegerArrayView];
	if (vecYieldedIteratorResults.some(IsUnexpectedIteratorResult) || !CompletedIteratorResult.done) {
		throw new Error("ArrayView.Values() did not read each element live.");
	}

	if ((vecIteratedValues.length !== g_vecExpectedLiveValues.length) || !vecIteratedValues.every(IsExpectedLiveValue)) {
		throw new Error("ArrayView[Symbol.iterator]() did not use the values iterator.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("ArrayView.Values() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.Add`

`BaseAddress.Add(nAddressOffset?)` applies a signed 64-bit BigInt byte offset (omitted or nullish means `0n`) and returns a new wrapper of the same class if the result fits the target address width. Overflow or underflow throws. The original wrapper is unchanged, and neither wrapper owns or frees the referenced memory.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress } = require("memory/helpers");

const g_unAllocationByteCount = 16;
const g_nAddressOffset = 0x0Cn;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unAllocationByteCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.Add() example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	const OffsetAddressView = BaseAddressView.Add(g_nAddressOffset);
	if (!(OffsetAddressView instanceof BaseAddress) || (OffsetAddressView === BaseAddressView)) {
		throw new Error("BaseAddress.Add() did not return the expected non-owning address.");
	}

	if ((BaseAddressView.Address !== g_unStorageAddress) || (OffsetAddressView.Address !== (g_unStorageAddress + g_nAddressOffset))) {
		throw new Error("BaseAddress.Add() returned an incorrect BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.Add() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.Address`

`BaseAddress.Address` is a read-only property containing the wrapper's nonnegative BigInt address within the target address width, including `0n` for the null state. Reading it does not establish that the address is mapped or readable and does not transfer ownership.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.Address example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	const unWrappedAddress = BaseAddressView.Address;
	if ((typeof unWrappedAddress !== "bigint") || (unWrappedAddress !== g_unStorageAddress)) {
		throw new Error("BaseAddress.Address did not contain the wrapped BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.Address example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.HasAddress`

`BaseAddress.HasAddress()` is false only for the `0n` null address; it does not verify that non-null memory is mapped, readable, or valid. The read-only `Null` property exposes the inverse null state.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.HasAddress() example allocation failed.");
	}

	const NullAddress = new BaseAddress(0n);
	const StorageAddress = new BaseAddress(g_unStorageAddress);
	if (NullAddress.HasAddress() || !NullAddress.Null || !StorageAddress.HasAddress() || StorageAddress.Null) {
		throw new Error("BaseAddress.HasAddress() did not reflect the wrapped address state.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.HasAddress() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.Read`

`BaseAddress.Read(strDataType = "address", nAddressOffset = 0n)` reads from the wrapped non-null BigInt address plus a signed 64-bit BigInt byte offset, following the generic `Read` contract. The default `"address"` type reads one native address-sized slot and returns a BigInt. Scalar slots may be packed or unaligned, but the selected storage must satisfy `Read`'s mapped-range, readability, lifetime, and valid-representation preconditions; reading does not change the wrapper or take ownership.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress, Type, WriteInt } = require("memory/helpers");

const g_unIntegerValueCount = 2;
const g_nExpectedIntegerValue = -24;
const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_nAddressOffset = BigInt(g_unIntegerByteCount);
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unIntegerByteCount * g_unIntegerValueCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.Read() example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	if (!WriteInt(g_unStorageAddress, g_nExpectedIntegerValue, g_nAddressOffset) || (BaseAddressView.Read(Type.Int, g_nAddressOffset) !== g_nExpectedIntegerValue)) {
		throw new Error("BaseAddress.Read() did not return the value at the requested offset.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.Read() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.ReadAddress`

`BaseAddress.ReadAddress(nAddressOffset = 0n)` reads a native address-sized slot from the wrapped non-null BigInt base plus a signed 64-bit BigInt byte offset and returns the stored address as a BigInt, including `0n`. The complete slot is checked for address overflow; byte copying supports packed or unaligned storage. The caller must still supply mapped, readable storage with a valid native address representation and sufficient lifetime; the helper does not verify those preconditions. Reading does not change the wrapper or take ownership.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, Add, BaseAddress, WriteAddress } = require("memory/helpers");

const g_unTargetStorageByteCount = 1;
const g_unAllocationByteCount = ADDRESS_SIZE + g_unTargetStorageByteCount;
const g_nAddressOffset = BigInt(ADDRESS_SIZE);
const g_vecErrors = [];
let g_unSlotAddress = 0n;

try {
	g_unSlotAddress = Allocate(g_unAllocationByteCount);
	if ((typeof g_unSlotAddress !== "bigint") || (g_unSlotAddress <= 0n)) {
		throw new Error("BaseAddress.ReadAddress() example allocation failed.");
	}

	const unTargetAddress = Add(g_unSlotAddress, g_nAddressOffset);
	const AddressSlotView = new BaseAddress(g_unSlotAddress);
	if (!WriteAddress(g_unSlotAddress, unTargetAddress) || (AddressSlotView.ReadAddress() !== unTargetAddress)) {
		throw new Error("BaseAddress.ReadAddress() did not return the stored BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unSlotAddress === "bigint") && (g_unSlotAddress > 0n) && !Deallocate(g_unSlotAddress)) {
			throw new Error("BaseAddress.ReadAddress() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.Subtract`

`BaseAddress.Subtract(nAddressOffset?)` subtracts a signed 64-bit BigInt byte offset (omitted or nullish means `0n`) and returns a new wrapper of the same class if the result fits the target address width; a negative offset adds to it. Overflow or underflow throws. The original wrapper is unchanged, and neither wrapper owns or frees the referenced memory.

```js
const { Allocate, Deallocate } = require("memory");
const { Add, BaseAddress } = require("memory/helpers");

const g_unAllocationByteCount = 16;
const g_nAddressOffset = 0x0Cn;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(g_unAllocationByteCount);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.Subtract() example allocation failed.");
	}

	const TailAddressView = new BaseAddress(Add(g_unStorageAddress, g_nAddressOffset));
	const BaseAddressView = TailAddressView.Subtract(g_nAddressOffset);
	if (!(BaseAddressView instanceof BaseAddress) || (BaseAddressView === TailAddressView)) {
		throw new Error("BaseAddress.Subtract() did not return a new wrapper.");
	}

	if ((TailAddressView.Address !== (g_unStorageAddress + g_nAddressOffset)) || (BaseAddressView.Address !== g_unStorageAddress)) {
		throw new Error("BaseAddress.Subtract() returned an incorrect BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.Subtract() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.toString`

`BaseAddress.toString()` returns `0x` followed by lowercase hexadecimal digits for the wrapped BigInt address, including `0x0` for null. The result is display text, not a numeric address or proof that memory is mapped.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.toString() example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	const strExpectedText = `0x${g_unStorageAddress.toString(16)}`;
	if (BaseAddressView.toString() !== strExpectedText) {
		throw new Error("BaseAddress.toString() returned an unexpected diagnostic string.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.toString() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.valueOf`

`BaseAddress.valueOf()` returns the wrapped address as a BigInt when JavaScript requests the wrapper's primitive value. It does not dereference or validate mapped memory; direct BigInt arithmetic is not bounded to the target address width, so use `Add` or `Subtract` for checked address arithmetic.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress } = require("memory/helpers");

const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(1);
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.valueOf() example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	const unValueOfAddress = BaseAddressView.valueOf();
	if ((typeof unValueOfAddress !== "bigint") || (unValueOfAddress !== g_unStorageAddress)) {
		throw new Error("BaseAddress.valueOf() did not expose the wrapped BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.valueOf() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.Write`

`BaseAddress.Write(strDataType, DataValue, nAddressOffset = 0n)` writes through to a supported native value at the wrapped non-null BigInt address plus a signed 64-bit BigInt byte offset, following the generic `Write` contract. `DataValue` must satisfy the selected type's requirements. Packed or unaligned slots are supported, but the complete slot must still be mapped, writable, alive, and suitable for the native representation; the helper checks address overflow, not those memory preconditions, and does not allocate or own the storage. It returns `true` on success and throws for invalid arguments, address arithmetic, or conversion failures.

```js
const { Allocate, Deallocate } = require("memory");
const { BaseAddress, ReadInt, Type } = require("memory/helpers");

const g_nExpectedIntegerValue = -42;
const g_vecErrors = [];
let g_unStorageAddress = 0n;

try {
	g_unStorageAddress = Allocate(Type.GetDataTypeSize(Type.Int));
	if ((typeof g_unStorageAddress !== "bigint") || (g_unStorageAddress <= 0n)) {
		throw new Error("BaseAddress.Write() example allocation failed.");
	}

	const BaseAddressView = new BaseAddress(g_unStorageAddress);
	if (!BaseAddressView.Write(Type.Int, g_nExpectedIntegerValue) || (ReadInt(g_unStorageAddress) !== g_nExpectedIntegerValue)) {
		throw new Error("BaseAddress.Write() did not store the supplied value.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unStorageAddress === "bigint") && (g_unStorageAddress > 0n) && !Deallocate(g_unStorageAddress)) {
			throw new Error("BaseAddress.Write() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `BaseAddress.WriteAddress`

`BaseAddress.WriteAddress(unStoredAddress, nAddressOffset = 0n)` writes a nonnegative BigInt target address to one native address-sized slot at the wrapped non-null BigInt base plus the signed 64-bit BigInt byte offset, following `WriteAddress`. The helper checks the complete slot for address overflow and permits packed or unaligned storage. The caller must still supply mapped, writable storage with sufficient lifetime; those preconditions are not verified. It returns `true` on success and throws for invalid arguments, address arithmetic, or conversion failures; it does not allocate, own, or transfer the target address.

```js
const { Allocate, Deallocate } = require("memory");
const { ADDRESS_SIZE, Add, BaseAddress, ReadAddress } = require("memory/helpers");

const g_unTargetAddressOffset = BigInt(ADDRESS_SIZE);
const g_unSlotByteCount = ADDRESS_SIZE + 1;
const g_vecErrors = [];
let g_unSlotAddress = 0n;

try {
	g_unSlotAddress = Allocate(g_unSlotByteCount);
	if ((typeof g_unSlotAddress !== "bigint") || (g_unSlotAddress <= 0n)) {
		throw new Error("BaseAddress.WriteAddress() example allocation failed.");
	}

	const unTargetAddress = Add(g_unSlotAddress, g_unTargetAddressOffset);
	const AddressSlotView = new BaseAddress(g_unSlotAddress);
	if (!AddressSlotView.WriteAddress(unTargetAddress) || (ReadAddress(g_unSlotAddress) !== unTargetAddress)) {
		throw new Error("BaseAddress.WriteAddress() did not store the BigInt target address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unSlotAddress === "bigint") && (g_unSlotAddress > 0n) && !Deallocate(g_unSlotAddress)) {
			throw new Error("BaseAddress.WriteAddress() example allocation cleanup failed.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory helper example and allocation cleanup failed.");
}
```

### `DataKey.AsArguments`

`DataKey.AsArguments(TypeManager, vecArgumentTypes)` ignores `TypeManager`. It requires an array of exact supported canonical memory type names and returns a new array containing the same names in the same order; it does not modify `vecArgumentTypes`.

```js
const { DataKey, Type } = require("memory/helpers");

const g_vecDeclaredTypes = [Type.Address, Type.Int, Type.Float];
const g_vecReturnedTypes = DataKey.AsArguments(null, g_vecDeclaredTypes);

function IsExpectedType(strArgumentTypeName, unArgumentIndex) {
	return strArgumentTypeName === g_vecDeclaredTypes[unArgumentIndex];
}

if ((g_vecReturnedTypes === g_vecDeclaredTypes) || (g_vecReturnedTypes.length !== g_vecDeclaredTypes.length)) {
	throw new Error("DataKey.AsArguments() did not return a new argument list.");
}

if (!g_vecReturnedTypes.every(IsExpectedType)) {
	throw new Error("DataKey.AsArguments() did not preserve argument type names and order.");
}
```

### `DataKey.AsAttributeType`

`DataKey.AsAttributeType(TypeManager, strAttributeTypeName)` requires a non-empty string. It preserves supported native type names exactly and also preserves other non-empty names as custom attribute type names; it does not rewrite their spelling. Other values throw a `TypeError`.

```js
const { DataKey, Type } = require("memory/helpers");

const g_strNativeType = DataKey.AsAttributeType(null, Type.UInt);
const g_strCustomType = DataKey.AsAttributeType(null, "PlayerInformation");
if ((g_strNativeType !== Type.UInt) || (g_strCustomType !== "PlayerInformation")) {
	throw new Error("DataKey.AsAttributeType() did not preserve the declared type semantics.");
}
```

### `DataKey.AsBoolean`

`DataKey.AsBoolean(TypeManager, BooleanValue)` converts an external configuration boolean. It returns booleans unchanged and converts the strings `"true"` and `"false"` case-insensitively without trimming whitespace. Other types or string values throw a `TypeError`.

```js
const { DataKey } = require("memory/helpers");

const g_bEnabled = DataKey.AsBoolean(null, "TRUE");
const g_bDisabled = DataKey.AsBoolean(null, "false");
if (!g_bEnabled || g_bDisabled) {
	throw new Error("DataKey.AsBoolean() did not parse case-insensitive boolean text.");
}
```

### `DataKey.AsConvention`

`DataKey.AsConvention(TypeManager, strCallingConvention)` validates the exact spelling against the native built-in calling-convention list and returns it unchanged. Non-string and unsupported values throw a `TypeError`.

```js
const { CALLING_CONVENTIONS, DataKey } = require("memory/helpers");

if (!CALLING_CONVENTIONS.includes("cdecl")) {
	throw new Error("The current runtime does not expose the mandatory cdecl convention.");
}

if (DataKey.AsConvention(null, "cdecl") !== "cdecl") {
	throw new Error("DataKey.AsConvention() did not return the validated convention.");
}
```

### `DataKey.AsIdentifier`

`DataKey.AsIdentifier(TypeManager, FunctionIdentifier)` accepts a non-empty string or a non-negative BigInt address and throws a `TypeError` for other values. A string containing a literal space is converted to `\xNN` escapes only when removing all whitespace leaves one or more complete hexadecimal byte pairs; other strings are returned unchanged, and BigInt addresses are preserved.

```js
const { DataKey } = require("memory/helpers");

const g_strSignature = DataKey.AsIdentifier(null, "55 8B EC 83 EC");
const g_strSymbol = DataKey.AsIdentifier(null, "CreateInterface");
const g_unAddressIdentifier = 0x1000n;
const g_unReturnedAddressIdentifier = DataKey.AsIdentifier(null, g_unAddressIdentifier);
if ((g_strSignature !== "\\x55\\x8B\\xEC\\x83\\xEC") || (g_strSymbol !== "CreateInterface") || (g_unReturnedAddressIdentifier !== g_unAddressIdentifier)) {
	throw new Error("DataKey.AsIdentifier() did not preserve the identifier semantics.");
}
```

### `DataKey.AsInt64`

`DataKey.AsInt64(TypeManager, IntegerValue)` converts configuration metadata to a signed 64-bit BigInt. It accepts a BigInt, a safe integer Number, or a complete signed decimal or hexadecimal string with optional surrounding whitespace. It never truncates Number inputs. Malformed strings and other types throw a `TypeError`; unsafe or fractional Numbers and results outside `-2^63` through `2^63 - 1` throw a `RangeError`. This explicit metadata conversion does not permit Number addresses or Number values in native int64/uint64 APIs. The first argument retains the converter callback position used by `ParseData()`.

```js
const { DataKey } = require("memory/helpers");

const g_unInt64MagnitudeBitCount = 63n;
const g_unInt64SignBitValue = 1n << g_unInt64MagnitudeBitCount;
const g_nMinimumInt64Value = DataKey.AsInt64(null, "-0x8000000000000000");
const g_nMaximumInt64Value = DataKey.AsInt64(null, "0x7FFFFFFFFFFFFFFF");
const g_nNegativeOffset = DataKey.AsInt64(null, " -0x20 ");
if ((g_nMinimumInt64Value !== -g_unInt64SignBitValue) || (g_nMaximumInt64Value !== (g_unInt64SignBitValue - 1n)) || (g_nNegativeOffset !== -0x20n)) {
	throw new Error("DataKey.AsInt64() did not preserve signed 64-bit metadata.");
}
```

### `DataKey.AsInteger`

`DataKey.AsInteger(TypeManager, IntegerValue)` converts numbers, bigints, and signed decimal or hexadecimal strings (with surrounding whitespace allowed) to a safe integer. Number inputs are truncated toward zero; invalid types or strings throw a `TypeError`, and values outside the safe-integer range throw a `RangeError`.

```js
const { DataKey } = require("memory/helpers");

const g_nHexadecimalValue = DataKey.AsInteger(null, "0x20");
const g_nDecimalValue = DataKey.AsInteger(null, "12");
const g_nTruncatedValue = DataKey.AsInteger(null, -7.75);
if ((g_nHexadecimalValue !== 32) || (g_nDecimalValue !== 12) || (g_nTruncatedValue !== -7)) {
	throw new Error("DataKey.AsInteger() did not convert external integer metadata.");
}
```

### `DataKey.AsReturnType`

`DataKey.AsReturnType(TypeManager, strReturnTypeName)` returns `"void"` for `undefined`. For non-empty strings, it preserves custom type names and accepts supported native type names without changing their spelling; it throws a `TypeError` for other values or empty strings.

```js
const { DataKey, Type } = require("memory/helpers");

const g_strNativeType = DataKey.AsReturnType(null, Type.Address);
const g_strCustomType = DataKey.AsReturnType(null, "PlayerInformation");
const g_strNoReturnType = DataKey.AsReturnType(null, undefined);
if ((g_strNativeType !== Type.Address) || (g_strCustomType !== "PlayerInformation") || (g_strNoReturnType !== "void")) {
	throw new Error("DataKey.AsReturnType() did not preserve the return-type semantics.");
}
```

### `DataKey.AsString`

`DataKey.AsString(TypeManager, ExternalValue)` converts an external configuration value to its string representation.

```js
const { DataKey } = require("memory/helpers");

const g_strClassName = DataKey.AsString(null, "CBaseEntity");
const g_strConfiguredSize = DataKey.AsString(null, 64);
if ((g_strClassName !== "CBaseEntity") || (g_strConfiguredSize !== "64")) {
	throw new Error("DataKey.AsString() did not return the external string representation.");
}
```

### `MemberFunction.Call`

`MemberFunction.Call(...vecArgumentValues)` reads its editable ABI fields, validates the argument count, and preserves every recognized native argument type in a `{ Type, Value }` descriptor, including booleans, integers, and addresses. Signed and unsigned 64-bit integer values remain exact `bigint`s rather than being treated as untyped addresses. String-like arguments retain temporary-string marshaling; non-native/custom argument values retain their existing pass-through behavior. It converts custom address returns through `TypeManager`; custom return type names use `address` for the native call before conversion. This example calls the exported `CreateInterface` function with its `cdecl(string, address) -> address` ABI; the second argument is an optional return-code address.

```js
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { Convention } = require("memory");
const { MemberFunction, Type } = require("memory/helpers");
const { GetBinarySymbol } = require("memory/manager");

const g_strInterfaceName = GetAllInterfaceNames().find((strCandidateInterfaceName) => strCandidateInterfaceName.startsWith("ServerGameDLL"));
if (typeof g_strInterfaceName !== "string") {
	throw new Error("The current SDK does not expose a ServerGameDLL interface.");
}

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("CreateInterface could not be resolved in the server binary.");
}

if ((g_InterfaceRecord === null) || !g_InterfaceRecord.Available || (g_InterfaceRecord.Name !== g_strInterfaceName) || (typeof g_InterfaceRecord.Address !== "bigint") || (g_InterfaceRecord.Address <= 0n)) {
	throw new Error(`The ${g_strInterfaceName} registry record is invalid.`);
}

const g_unRegisteredInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceFunction = new MemberFunction(null, Type.Address, g_unCreateInterfaceAddress, null, [Type.StringAddress, Type.Address], Convention.Cdecl);
const g_unInterfaceAddress = g_CreateInterfaceFunction.Call(g_strInterfaceName, 0n);
if (g_unInterfaceAddress !== g_unRegisteredInterfaceAddress) {
	throw new Error("MemberFunction.Call() returned the wrong ServerGameDLL address.");
}
```

### `Type.IsNativeDataType`

`Type.IsNativeDataType(strTypeName)` reports whether the module's frozen snapshot of the selected SourceJS runtime's `DATA_TYPE_SIZES` inventory contains that exact type name. Non-string values throw a `TypeError`.

```js
const { Type } = require("memory/helpers");

if (!Type.IsNativeDataType(Type.Address) || Type.IsNativeDataType("PlayerInformation")) {
	throw new Error("Type.IsNativeDataType() did not distinguish native and custom types.");
}
```

### `Type.NormalizeDataType`

`Type.NormalizeDataType(strTypeName)` requires a supported native data type name and returns that same spelling unchanged. Non-string or unsupported names throw a `TypeError`; the method does not coerce aliases or invent a fallback type.

```js
const { Type } = require("memory/helpers");

if (Type.NormalizeDataType(Type.UInt) !== Type.UInt) {
	throw new Error("Type.NormalizeDataType() did not preserve the supported native type name.");
}
```

### `Type.GetDataTypeSize`

`Type.GetDataTypeSize(strTypeName)` returns the selected architecture's native byte width for a supported storage type. Non-string or unsupported names throw a `TypeError`.

```js
const { Type } = require("memory/helpers");

const g_unIntegerByteCount = Type.GetDataTypeSize(Type.Int);
const g_unAddressByteCount = Type.GetDataTypeSize(Type.Address);
if ((g_unIntegerByteCount !== 4) || ![4, 8].includes(g_unAddressByteCount)) {
	throw new Error("Type.GetDataTypeSize() returned an unsupported native width.");
}
```
