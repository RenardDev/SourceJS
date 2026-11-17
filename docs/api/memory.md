# `require("memory")`

> Warning: this page is a complete low-level API reference. Read the table of contents first and open only the section needed for the current task.

- Implementation: [`packages/sourcejs/memory.js`](../../packages/sourcejs/memory.js)
- Native bindings: [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp)
- Related modules: [`memory/helpers`](memory-helpers.md), [`memory/manager`](memory-manager.md), [`memory/gamedata`](memory-gamedata.md), and [`memory/hooks`](memory-hooks.md)
- Live SDK structures: [`mathlib`](mathlib.md)

The root memory module keeps `Allocate`, `Reallocate`, and `Deallocate` available through JavaScript adapters over captured native operations, and augments the same module object with typed reads and writes, native function calls, registered JavaScript structure classes, GameData lookup, and helper and manager modules. Address wrappers track allocation ownership using BigInt addresses. The module exports that augmented object; address-backed fields remain live and SDK-specific. Use it only when an SDK interface does not already expose the operation directly.

## Contents

- [Import](#import)
- [Address and ownership model](#address-and-ownership-model)
- [Public surface](#public-surface)
- [Constants and namespaces](#constants-and-namespaces)
- [Allocation and object conversion](#allocation-and-object-conversion)
- [Registered object types](#registered-object-types)
- [Class metadata and virtual functions](#class-metadata-and-virtual-functions)
- [GameData and submodules](#gamedata-and-submodules)
- [BinaryFile](#binaryfile)
- [Function](#function)
- [FunctionInfo](#functioninfo)
- [Address](#address)
- [Errors and lifecycle](#errors-and-lifecycle)
- [Address-backed QAngle examples](#address-backed-qangle-examples)

## Import

Import only the names used by the plugin:

```js
const { Address, Allocate, DataType, Deallocate } = require("memory");
```

Do not reach this API through a global `source` object.

## Address and ownership model

Every raw address is a non-negative JavaScript `bigint`; numbers, strings, and legacy address representations are not accepted. `GetObjectAddress()` explicitly extracts the BigInt address from a registered or otherwise address-backed object.

SourceJS distinguishes three lifetimes:

| Kind | Creation | Ownership |
| --- | --- | --- |
| Raw BigInt address | Native modules, scans, symbols, or `Allocate()` | The producing API defines the lifetime. |
| Owned `Address` | `new Address(unAddress, true)` | `Address.Deallocate()` releases the current allocation once. |
| Registered object view | `MakeObject(ObjectTypeValue, AddressLike)` | Built-in views borrow native storage; custom factories must honor the same live-view contract. |

`0n` is the null address and is exported as `NULL`. Arithmetic, copying, protection changes, virtual calls, and object views do not validate that arbitrary engine memory remains alive. Never retain an entity, interface, model, or stack address beyond its documented owner lifetime.

An allocation must have a cleanup attempt in a `finally` block when an exception can occur. The examples preserve operation and cleanup failures in order, including thrown primitive values, and attempt independent releases even if another release fails. They report failed cleanup without silently retrying it; an error does not prove all native allocations were freed, so stop using the sample views after a cleanup failure:

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 16;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const AddressValue = new Address(g_unAllocationAddress);
	if ((AddressValue.SetInt(125, 0n) !== AddressValue) || (AddressValue.SetFloat(0.75, 4n) !== AddressValue)) {
		throw new Error("Address.SetInt() or Address.SetFloat() did not return the receiver.");
	}

	if ((AddressValue.GetInt(0n) !== 125) || (AddressValue.GetFloat(4n) !== 0.75)) {
		throw new Error("Address.GetInt() or Address.GetFloat() disagrees with the written values.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() cleanup failed.");
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

## Public surface

The root module exports the exact classes, constants, functions, and submodules below. `memory/helpers`, `memory/manager`, `memory/gamedata`, and `memory/hooks` retain their own larger specialized surfaces. `GameData`, `Helpers`, and `Manager` are the same per-context module objects returned by their direct `require()` paths; the root does not install lower-case compatibility aliases. `Manager` is a lazy getter whose first access may initialize `memory/manager`; `GameData` and `Helpers` load with the root module.

### Classes and constants

| Export | Meaning |
| --- | --- |
| [`BinaryFile`](#binaryfile) | Loaded binary metadata plus symbol/signature address resolution. |
| [`Function`](#function) | Native callable wrapper configured with a BigInt function address, calling convention, argument/return types, and optional `this` binding; exposes `Call` and managed hooks. |
| [`FunctionInfo`](#functioninfo) | Calling convention, argument, return, and virtual-function metadata. |
| `Address` | Typed read/write, arithmetic, copy, move, protection, scan, and call wrapper. |
| [`Convention`](#convention) | Supported native calling conventions. |
| [`DataType`](#datatype) | Native argument, return, and storage data types. |
| [`Protection`](#protection) | Native page-protection modes. |
| [`Register`](#register) | Canonical x86/x86_64 register names accepted by hook contexts. |
| `NULL` | BigInt null-address sentinel, always `0n`. |
| `TYPE_SIZES` | Selected architecture's native byte widths. |

### Allocation and registered objects

| Export | Meaning |
| --- | --- |
| `Allocate(unByteSize)` | Allocate `unByteSize` native bytes and return their BigInt address. |
| `Reallocate(unAddress, unByteSize)` | Resize a native allocation and return its current BigInt address. |
| `Deallocate(unAddress)` | Release a native allocation. |
| `AllocateObject(ObjectTypeValue)` | Allocate the registered native size and return its BigInt address. |
| [`MakeObject(ObjectTypeValue, AddressLike, nAddressOffset = 0n)`](#makeobject) | Construct a non-owning registered object view. |
| `GetObjectAddress(ObjectValue)` | Return a BigInt address from a BigInt or address-backed object; `null`/`undefined` returns `0n`. |
| `CopyObjectToAddress(SourceValue, DestinationAddressLike, ObjectTypeValue = null, nAddressOffset = 0n)` | Copy one object's native representation into memory. |
| `CopyAddressToObject(SourceAddressLike, TargetOrObjectTypeOut, nAddressOffset = 0n)` | Create a non-owning view or copy native bytes into an existing address-backed object. |
| `RegisterObjectType(strObjectTypeName, ObjectTypeConstructor, TypeOptions = {})` | Register a class with an optional native size and function metadata. |
| `ObjectType(strObjectTypeName)` | Resolve a registered constructor by name. |
| `ObjectTypeInfo(ObjectTypeValue)` | Resolve a stored registration record or synthesize metadata for an unregistered constructor or instance. |
| `ObjectTypeSize(ObjectTypeValue)` | Resolve the registered native byte size. |
| `GetDataTypeSize(strDataType)` | Resolve a `DataType` byte width. |

### Metadata, functions, and submodules

| Export | Meaning |
| --- | --- |
| `GetClass(strObjectTypeName)` | Resolve a registered JavaScript class or throw when the name is unknown. |
| `GetClassName(ObjectTypeValue)` | Resolve its canonical registration name. |
| `GetClassInfo(ObjectTypeValue)` | Return class metadata from the resolved type record. |
| `GetFunctionInfo(ObjectTypeValue, strFunctionName, unFunctionIndex = 0)` | Resolve declared member-function metadata. |
| `GetVirtualFunction(ObjectValue, strFunctionName, unFunctionIndex = 0)` | Bind a declared virtual function to an object address. |
| `GameData` | Exact `require("memory/gamedata")` module object. |
| `Helpers` | Exact `require("memory/helpers")` module object. |
| `Manager` | Exact `require("memory/manager")` module object. |

Unavailable selected-SDK operations are omitted by their owning native modules. Accessing an absent property produces the normal JavaScript `undefined`/not-a-function behavior; no JavaScript fallback stub is installed.

## Constants and namespaces

### `DataType`

`DataType` values are canonical type strings. Support depends on the operation: storage reads, writes, call arguments, returns, and hooks do not accept every discriminator in the same way.

| Members | Native representation |
| --- | --- |
| `Void` | No value. |
| `Bool` | C++ `bool`. |
| `Char`, `UChar` | C++ `char` and `unsigned char`. |
| `Short`, `UShort` | Signed and unsigned short integers. |
| `Int`, `UInt` | C++ `int` and `unsigned int`. |
| `Long`, `ULong` | Selected-SDK widths for C++ `long` and `unsigned long`. |
| `LongLong`, `ULongLong` | Signed and unsigned 64-bit integers represented by JavaScript BigInt. |
| `Float`, `Double` | C++ `float` and `double`. |
| `Address` | Native address represented by a JavaScript BigInt. |
| `String` | Inline null-terminated native text; `Read()` returns a JavaScript string. Native calls marshal text into temporary UTF-8 storage. |
| `StringAddress` | A native text address stored in memory; `Read()` returns the referenced JavaScript string or `null`, not its BigInt address. |
| `StringArray` | String-storage discriminator; not a native array of text addresses. Direct `Read()` and `Write()` do not implement this discriminator. |

For call arguments, `StringAddress` and `StringArray` use the same temporary-text marshaling as `String`; they do not pass a supplied BigInt as a borrowed text address or build a native array of text addresses. Use `Address` with a valid BigInt when the native signature expects such an address. Use `String` for native text returns; `StringAddress` and `StringArray` are not native return or hook-signature types. Direct `Write()` rejects all three text discriminators; use an appropriate byte-storage or owning string API instead.

### `Convention`

| Member | Use |
| --- | --- |
| `Cdecl` | x86 caller-cleanup free function. |
| `Thiscall` | x86 member function with an implicit object address. |
| `Stdcall` | x86 callee-cleanup function. |
| `Fastcall` | x86 register-argument function. |

Only these four enum members are exported. On x64, the native call implementation selects the platform ABI automatically; use `Cdecl` for free functions and the verified member convention for object-bound calls, not nonexistent `SysV` or `Win64` members. Windows x86 member calls normally use `Thiscall`; Linux x86 member calls normally use `Cdecl` with the object address as the first native argument. The convention must match the selected binary and architecture exactly. A wrong convention can corrupt registers or the stack instead of producing a recoverable JavaScript error.

### `Protection`

`Protection.None`, `Protection.Read`, `Protection.ReadWrite`, `Protection.Execute`, `Protection.ExecuteRead`, and `Protection.ExecuteReadWrite` map to the native page-protection modes accepted by `Address.SetProtection()`. The operation returns only a success boolean. It does not expose the previous mode, so code that temporarily changes executable memory must know the original protection and restore it explicitly.

### `Register`

`Register` exposes uppercase member names with the same uppercase string values, such as `Register.EAX === "EAX"`, for full hook contexts:

| Group | Members |
| --- | --- |
| 8-bit | `AL`, `CL`, `DL`, `BL`, `AH`, `CH`, `DH`, `BH` |
| 16-bit | `AX`, `CX`, `DX`, `BX`, `SP`, `BP`, `SI`, `DI` |
| 32-bit | `EAX`, `ECX`, `EDX`, `EBX`, `ESP`, `EBP`, `ESI`, `EDI` |
| 64-bit | `RAX`, `RCX`, `RDX`, `RBX`, `RSP`, `RBP`, `RSI`, `RDI`, `R8` through `R15` |
| MMX | `MM0` through `MM7` |
| SIMD | `XMM0` through `XMM15` |
| Segments | `CS`, `SS`, `DS`, `ES`, `FS`, `GS` |
| x87 | `ST0` |

The selected hook context exposes only registers meaningful to its architecture and call path. See [`memory/hooks`](memory-hooks.md) for the complete context and trampoline result.

Example: with a captured x86 `Registers` snapshot and `Register` imported from `memory`, check whether the accumulator was captured: `const bHasAccumulator = Object.hasOwn(Registers, Register.EAX);`

### `NULL` and `TYPE_SIZES`

`NULL` is exactly `0n`, the BigInt null-address sentinel. `TYPE_SIZES` is a frozen dictionary indexed by canonical type-discriminator values, as in `TYPE_SIZES[DataType.Address]`, and populated from native `sizeof` values for the selected architecture. Address and C++ `long` widths are therefore not hardcoded in JavaScript.

```js
const { DataType, GetDataTypeSize, NULL, TYPE_SIZES } = require("memory");

if ((NULL !== 0n) || (TYPE_SIZES[DataType.Address] !== GetDataTypeSize(DataType.Address))) {
	throw new Error("SourceJS memory type metadata is inconsistent.");
}

if (!Object.isFrozen(TYPE_SIZES) || ![4, 8].includes(TYPE_SIZES[DataType.Address])) {
	throw new Error("TYPE_SIZES is mutable or has an unsupported address width.");
}
```

## Allocation and object conversion

### Raw allocation lifecycle

`Allocate(unByteSize)` reserves plugin-owned native memory. `Reallocate(unAddress, unByteSize)` resizes only memory obtained from the allocator, and `Deallocate(unAddress)` releases it. Assign the result of `Reallocate()` back to the owning variable because the allocation may move. Never pass an engine address, symbol address, entity address, interface address, or an address owned by another plugin to either operation.

Native argument readers preserve JavaScript conversion exceptions, translate C++ failures, and commit outputs only after successful validation. Addresses and signed/unsigned 64-bit values require lossless BigInt conversions; byte sizes retain the documented numeric-size contract. New allocator storage is held by a C++ owner until its BigInt result is published. A recoverable native `realloc` failure leaves the original allocation intact; after success, update the owner to the returned address before further use. The configured V8 constructs these fixed-width address results with the non-Maybe `BigInt::NewFromUnsigned()` API; heap exhaustion is fatal, not a recoverable JavaScript resize failure. Native defensive guards release unpublished storage, but neither those guards nor a JavaScript `finally` provide recovery from a fatal VM failure.

Bounded signed/unsigned integer readers used by byte patterns, numeric protection modes and integer scalar writes (including `int`, `uint` and 32-bit `long`) validate the converted number before native narrowing. It must be finite, integral and within the requested range; fractions, NaN, infinities and out-of-range values are rejected rather than truncated or wrapped modulo 32 bits. Existing numeric conversion of valid integral inputs is preserved, and a throwing conversion retains its original exception without committing the output.

```js
const { Address, Allocate, Deallocate, Reallocate } = require("memory");

const g_unInitialByteCount = 8;
const g_unResizedByteCount = 16;
const g_vecErrors = [];
let g_unAllocationAddress = Allocate(g_unInitialByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	let AddressValue = new Address(g_unAllocationAddress);
	if ((AddressValue.SetInt(125, 0n) !== AddressValue) || (AddressValue.SetFloat(0.5, 4n) !== AddressValue)) {
		throw new Error("Address.SetInt() or Address.SetFloat() did not return the receiver.");
	}

	const unResizedAddress = Reallocate(g_unAllocationAddress, g_unResizedByteCount);
	if ((typeof unResizedAddress !== "bigint") || (unResizedAddress <= 0n)) {
		throw new Error("Reallocate() returned an invalid address.");
	}

	g_unAllocationAddress = unResizedAddress;
	AddressValue = new Address(g_unAllocationAddress);
	if (AddressValue.SetDouble(12.25, 8n) !== AddressValue) {
		throw new Error("Address.SetDouble() did not return the receiver.");
	}

	if ((AddressValue.GetInt(0n) !== 125) || (AddressValue.GetFloat(4n) !== 0.5) || (AddressValue.GetDouble(8n) !== 12.25)) {
		throw new Error("Reallocate() did not preserve and extend the allocation correctly.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() cleanup failed.");
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

The free functions do not track ownership in JavaScript. `new Address(unAddress, true)` adds explicit wrapper-level ownership and exposes checked `Reallocate()` and `Deallocate()` methods; the [Address section](#address) documents that lifecycle.

### Registered-size allocations and live views

`AllocateObject(ObjectTypeValue)` allocates exactly `ObjectTypeSize(ObjectTypeValue)` bytes and returns a BigInt address. It does not call the class constructor and does not return an object.

#### `MakeObject`

`MakeObject(ObjectTypeValue, AddressLike, nAddressOffset = 0n)` calls the resolved type's static `CreateFromAddress()` factory at the base BigInt address plus a signed BigInt offset. The non-owning live-view contract depends on that factory: built-in factories borrow the address, and a custom factory must honor the same contract. The helper does not enforce ownership, validate the complete backing range, or suppress factory side effects. `GetObjectAddress(ObjectValue)` resolves a BigInt address from a BigInt input or address-backed object; `null` or `undefined` returns `0n`.

`CopyObjectToAddress(SourceValue, DestinationAddressLike, ObjectTypeValue = null, nAddressOffset = 0n)` writes one registered representation. `CopyAddressToObject(SourceAddressLike, TargetOrObjectTypeOut, nAddressOffset = 0n)` either copies into an existing address-backed target or returns another non-owning view when passed a type.

```js
const { Vector } = require("mathlib");
const {
	AllocateObject,
	CopyObjectToAddress,
	CopyAddressToObject,
	Deallocate,
	GetObjectAddress,
	MakeObject,
} = require("memory");

const g_vecErrors = [];
let g_unTargetAddress = 0n;
const g_unSourceAddress = AllocateObject(Vector);
if ((typeof g_unSourceAddress !== "bigint") || (g_unSourceAddress <= 0n)) {
	throw new Error("AllocateObject() returned an invalid source address.");
}

try {
	g_unTargetAddress = AllocateObject(Vector);
	if ((typeof g_unTargetAddress !== "bigint") || (g_unTargetAddress <= 0n)) {
		throw new Error("AllocateObject() returned an invalid target address.");
	}

	if (CopyObjectToAddress({ X: 128, Y: -64, Z: 32 }, g_unSourceAddress, Vector) !== g_unSourceAddress) {
		throw new Error("CopyObjectToAddress() returned the wrong destination.");
	}

	const SourceValue = MakeObject(Vector, g_unSourceAddress);
	const TargetValue = MakeObject(Vector, g_unTargetAddress);
	if (CopyAddressToObject(g_unSourceAddress, TargetValue) !== TargetValue) {
		throw new Error("CopyAddressToObject() did not preserve target identity.");
	}

	const TargetView = CopyAddressToObject(g_unTargetAddress, Vector);
	const bMatchingSourceAddress = GetObjectAddress(SourceValue) === g_unSourceAddress;
	const bMatchingTargetAddress = GetObjectAddress(TargetView) === g_unTargetAddress;
	if (!bMatchingSourceAddress || !bMatchingTargetAddress) {
		throw new Error("GetObjectAddress() did not preserve the Vector view addresses.");
	}

	if (!TargetView.IsMathStructureEqual([128, -64, 32])) {
		throw new Error("The registered object copy changed the Vector components.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if ((typeof g_unTargetAddress === "bigint") && (g_unTargetAddress > 0n) && (Deallocate(g_unTargetAddress) !== true)) {
			throw new Error("The target Vector allocation was not released.");
		}
	} catch (TargetCleanupError) {
		g_vecErrors.push(TargetCleanupError);
	}

	try {
		if (Deallocate(g_unSourceAddress) !== true) {
			throw new Error("The source Vector allocation was not released.");
		}
	} catch (SourceCleanupError) {
		g_vecErrors.push(SourceCleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

All views become invalid immediately after their allocation is released. Copying into an existing target preserves that target's JavaScript identity; requesting a type returns a new view over the source bytes and performs no detached copy.

### Native type sizes

`GetDataTypeSize(strDataType)` reads the selected platform and architecture's native width. Use it for offsets and allocation sizes instead of assuming that an address or C++ `long` has one width on every build.

```js
const { DataType, GetDataTypeSize, TYPE_SIZES } = require("memory");

const g_Layout = {
	DoubleByteCount: GetDataTypeSize(DataType.Double),
	IntegerByteCount: GetDataTypeSize(DataType.Int),
	LongByteCount: GetDataTypeSize(DataType.Long),
	AddressByteCount: GetDataTypeSize(DataType.Address),
};

if (g_Layout.AddressByteCount !== TYPE_SIZES[DataType.Address]) {
	throw new Error("GetDataTypeSize() does not match TYPE_SIZES[DataType.Address].");
}

const g_bMatchingScalarByteCounts = (g_Layout.DoubleByteCount === 8) && (g_Layout.IntegerByteCount === 4);
const g_bSupportedLongByteCount = [4, 8].includes(g_Layout.LongByteCount);
const g_bSupportedAddressByteCount = [4, 8].includes(g_Layout.AddressByteCount);
if (!g_bMatchingScalarByteCounts || !g_bSupportedLongByteCount || !g_bSupportedAddressByteCount) {
	throw new Error("The native scalar layout is not valid for a supported SourceJS architecture.");
}
```

## Registered object types

`RegisterObjectType(strObjectTypeName, ObjectTypeConstructor, TypeOptions = {})` associates a non-empty name with one JavaScript class. Creating views requires the constructor's static `CreateFromAddress(unAddress)` factory; registration itself checks callability, not that this factory exists. `TypeOptions.Size` defaults to `ObjectTypeConstructor.TypeSize`; a positive resolved size is required by allocation and copy operations, while `null` explicitly registers an unsized type. `TypeOptions.ClassInfo` defaults to `ObjectTypeConstructor.ClassInfo` and may describe member functions as covered in the next section.

`ObjectType(strObjectTypeName)` returns `null` when a non-empty name is not registered. `ObjectTypeInfo(ObjectTypeValue)` returns `null` when the value cannot be resolved as a SourceJS object type. Registered names, constructors, and instances resolve their stored live record. An unregistered constructor or instance is accepted only when its constructor exposes `CreateFromAddress`; its metadata is synthesized for that lookup rather than registered, and malformed class metadata may throw. `ObjectTypeSize(ObjectTypeValue)` requires a resolved type with a callable factory and positive size and throws otherwise.

```js
const {
	DataType,
	Address,
	AllocateObject,
	GetDataTypeSize,
	Deallocate,
	MakeObject,
	ObjectType,
	ObjectTypeInfo,
	ObjectTypeSize,
	RegisterObjectType,
} = require("memory");

class SourceJSExampleCounter {
	constructor(unAddress) {
		this.Address = unAddress;
	}

	static CreateFromAddress(unAddress) {
		return new SourceJSExampleCounter(unAddress);
	}

	GetCounterValue() {
		return new Address(this.Address).GetInt();
	}

	SetCounterValue(nCounterValue) {
		const AddressValue = new Address(this.Address);
		if (AddressValue.SetInt(nCounterValue) !== AddressValue) {
			throw new Error("SourceJSExampleCounter.SetCounterValue() did not return the receiver.");
		}
	}
}

const g_bRegistered = RegisterObjectType("SourceJSExampleCounter", SourceJSExampleCounter, { Size: GetDataTypeSize(DataType.Int) });
if (g_bRegistered !== true) {
	throw new Error("RegisterObjectType() failed to register the counter type.");
}

const g_vecErrors = [];
const g_unCounterAddress = AllocateObject(SourceJSExampleCounter);
if ((typeof g_unCounterAddress !== "bigint") || (g_unCounterAddress <= 0n)) {
	throw new Error("AllocateObject() returned an invalid counter address.");
}

try {
	const CounterValue = MakeObject(SourceJSExampleCounter, g_unCounterAddress);
	CounterValue.SetCounterValue(42);

	const TypeInformation = ObjectTypeInfo(SourceJSExampleCounter);
	if ((TypeInformation === null) || (TypeInformation === undefined)) {
		throw new Error("ObjectTypeInfo() did not return the counter record.");
	}

	const bMatchingValue = CounterValue.GetCounterValue() === 42;
	const bMatchingType = ObjectType("SourceJSExampleCounter") === SourceJSExampleCounter;
	const bMatchingConstructor = TypeInformation.Constructor === SourceJSExampleCounter;
	const bMatchingName = TypeInformation.Name === "SourceJSExampleCounter";
	const bMatchingByteCount = TypeInformation.Size === GetDataTypeSize(DataType.Int);
	const bMatchingResolvedByteCount = ObjectTypeSize(SourceJSExampleCounter) === GetDataTypeSize(DataType.Int);
	if (!bMatchingValue || !bMatchingType || !bMatchingConstructor || !bMatchingName || !bMatchingByteCount || !bMatchingResolvedByteCount) {
		throw new Error("Registered counter metadata is inconsistent.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unCounterAddress) !== true) {
			throw new Error("Deallocate() failed to release the counter allocation.");
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

Registration state belongs to the current isolated plugin context. Reusing a name replaces that context's record; it does not expose the class to another plugin.

## Class metadata and virtual functions

`GetClass(strObjectTypeName)` requires a registered name. `GetClassName(ObjectTypeValue)` and `GetClassInfo(ObjectTypeValue)` accept a registered name or a constructor/instance whose constructor exposes `CreateFromAddress`. Class metadata maps each function name to an array of `FunctionInfo` overload records. `GetFunctionInfo(ObjectTypeValue, strFunctionName, unFunctionIndex = 0)` validates and returns one overload.

`GetVirtualFunction(ObjectValue, strFunctionName, unFunctionIndex = 0)` resolves the registered vtable slot from a live object and returns a [`Function`](#function) already bound to that object's `this` address. The object address, vtable layout, calling convention, and signature must all match the selected SDK.

This example uses the real selected-branch `CBaseClient.ini` profile when that profile exists. It accesses client slot 0 only when connected, binds `CBaseClient::SetName`, and passes the client's current `Name` back to the function so it requests the existing name rather than a different one:

```js
const { GetServer } = require("engines/server");
const {
	CreateBaseClientFromAddress,
	GetBaseClientType,
	HasBaseClientGameData,
} = require("players/baseclient");
const {
	Function,
	GetClass,
	GetClassInfo,
	GetClassName,
	GetFunctionInfo,
	GetVirtualFunction,
} = require("memory");

const g_SourceServer = GetServer();
if (HasBaseClientGameData() && (g_SourceServer.GetAllocatedClientCount() > 0) && g_SourceServer.GetClient(0).Connected) {
	const BaseClientType = GetBaseClientType();
	const ClassInformation = GetClassInfo(BaseClientType);
	const SetNameFunctionInformation = GetFunctionInfo(BaseClientType, "SetName");
	const LiveClient = g_SourceServer.GetClient(0);
	const BaseClient = CreateBaseClientFromAddress(LiveClient.Address);
	const SetNameFunction = GetVirtualFunction(BaseClient, "SetName");
	const bMatchingType = GetClass("BaseClient") === BaseClientType;
	const bMatchingTypeName = GetClassName(BaseClient) === "BaseClient";
	const bMatchingFunctionInformation = ClassInformation.SetName[0] === SetNameFunctionInformation;
	const bMatchingFunctionType = SetNameFunction instanceof Function;
	const bMatchingThisAddress = SetNameFunction.ThisObject === LiveClient.Address;
	const bConsistentMetadata = bMatchingType && bMatchingTypeName && bMatchingFunctionInformation && bMatchingFunctionType && bMatchingThisAddress;
	if (!bConsistentMetadata) {
		throw new Error("CBaseClient metadata is inconsistent.");
	}

	SetNameFunction.Call(LiveClient.Name);
}
```

Do not guess vtable indexes. Use shipped selected-branch data or a versioned plugin profile, and treat profile changes as ABI changes.

## GameData and submodules

The root `GameData`, `Helpers`, and `Manager` properties are module objects, not callable convenience functions. They are identical to their direct import paths and share the same per-plugin state.

```js
const { GameData, Helpers, Manager } = require("memory");
const g_DirectGameDataModule = require("memory/gamedata");
const g_DirectHelpersModule = require("memory/helpers");
const g_DirectManagerModule = require("memory/manager");
const { GetGameDataPaths, HasGameData, LoadGameData } = GameData;

function IsNonEmptyProfilePath(strFilePath) {
	return (typeof strFilePath === "string") && (strFilePath.length > 0);
}

const g_bMatchingGameDataModule = GameData === g_DirectGameDataModule;
const g_bMatchingHelpersModule = Helpers === g_DirectHelpersModule;
const g_bMatchingManagerModule = Manager === g_DirectManagerModule;
const g_bSharedModuleIdentity = g_bMatchingGameDataModule && g_bMatchingHelpersModule && g_bMatchingManagerModule;
if (!g_bSharedModuleIdentity) {
	throw new Error("Root memory submodules lost their per-context identity.");
}

const g_vecProfilePaths = GetGameDataPaths("client", "CBaseClient.ini");
if ((g_vecProfilePaths.length === 0) || !g_vecProfilePaths.every(IsNonEmptyProfilePath)) {
	throw new Error("CBaseClient GameData paths must be non-empty strings.");
}

if (HasGameData("client", "CBaseClient.ini")) {
	const Profile = LoadGameData("client", "CBaseClient.ini");
	const bValidProfile = (Profile !== null) && (typeof Profile === "object") && !Array.isArray(Profile);
	if (!bValidProfile) {
		throw new Error("CBaseClient GameData did not load as an object.");
	}
}
```

Use direct imports in ordinary plugin code so ownership is visible. The dedicated [`memory/gamedata`](memory-gamedata.md), [`memory/helpers`](memory-helpers.md), and [`memory/manager`](memory-manager.md) pages document their complete APIs.

## BinaryFile

`BinaryFile` selects a loaded module by name and exposes its metadata, BigInt base address, byte count, symbol/pattern address resolution, and address dereferencing. Use `memory/manager` directly for GameData signatures and callable metadata.

| Member | Contract |
| --- | --- |
| `new BinaryFile(strBinaryName)` | Requires a non-empty binary name; metadata is resolved on access and reflects current runtime state. |
| `Name` | Editable module name used by every live metadata lookup. |
| `Information` | Fresh metadata snapshot `{ Name, Path, Address, ByteCount }` with the same public shape as `memory/manager.GetBinary(strBinaryName)`, or `null`. `Name` is the loaded file's native name, not necessarily the lookup selector (for example, `server.dll` rather than `server`). Mutating the snapshot does not modify the native binary. |
| `Address` | BigInt module base address, or `0n` when the binary is unknown. |
| `ByteCount` | Loaded module size in bytes, or `0` when the binary is unknown. |
| `ResolveBinaryAddress(BinaryIdentifier)` | Resolves a BigInt address, symbol/pattern string, or identifier object; uses this binary by default, with an object's optional `Module` selecting another. |
| `DereferenceBinaryAddress(BinaryIdentifier, nAddressOffset = 0n, unDereferenceCount = 0)` | Applies a signed BigInt offset, then follows a nonnegative safe-integer count of address indirections; an unresolved or zero starting address returns `0n`. |

### Symbol and signature lookup

`GetBinarySymbol(strBinaryName, strSymbolName)` uses the platform's symbol lookup: exported symbols on Windows, and dynamic-loader lookup followed by the selected named module's ELF symbol-table fallback on Linux when available. Keep the module loaded while using the returned address; lookup does not transfer module ownership. `ScanBinary(strBinaryName, strBytePattern)` scans the bytes of one loaded binary. Both return a BigInt address or `null` when not found. `GetGameDataSignature(strFilePath, strSignatureName)` only selects the named runtime-specific entry under `Signatures`; the result may be a string or structured value and is not itself resolved against a binary.

The example below resolves the cross-platform `CreateInterface` export, attempts the requested Linux C++ symbol, then builds a signature from bytes that are actually present at the start of the loaded `server` binary and finds them again:

```js
const { Address } = require("memory");
const { GetBinary, GetBinarySymbol, PLATFORM, ScanBinary } = require("memory/manager");

const g_unSignatureByteCount = 16;

const g_ServerBinary = GetBinary("server");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_bValidServerBinary = (g_ServerBinary !== null) && (g_ServerBinary.ByteCount >= g_unSignatureByteCount);
if (!g_bValidServerBinary || (g_unCreateInterfaceAddress === null)) {
	throw new Error("GetBinary() or GetBinarySymbol() could not inspect the loaded server binary.");
}

const g_ServerBytes = new Address(g_ServerBinary.Address);
const g_vecSignatureByteTokens = [];
for (let unOffset = 0; unOffset < g_unSignatureByteCount; unOffset += 1) {
	g_vecSignatureByteTokens.push(g_ServerBytes.GetUChar(BigInt(unOffset)).toString(16).toUpperCase().padStart(2, "0"));
}

const g_strSignature = g_vecSignatureByteTokens.join(" ");
const g_unSignatureAddress = ScanBinary("server", g_strSignature);
const g_unCoreSurfaceAddress = (PLATFORM === "linux") ? GetBinarySymbol("server", "_ZN16CCoreDispSurface4InitEv") : null;
const g_unServerRangeEndAddress = g_ServerBinary.Address + BigInt(g_ServerBinary.ByteCount);
const g_bValidSignatureAddress = (typeof g_unSignatureAddress === "bigint") && (g_unSignatureAddress >= g_ServerBinary.Address) && (g_unSignatureAddress <= (g_unServerRangeEndAddress - BigInt(g_unSignatureByteCount)));
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || !g_bValidSignatureAddress) {
	throw new Error(`GetBinarySymbol() or ScanBinary() returned an invalid address for signature ${g_strSignature}.`);
}

if ((g_unCoreSurfaceAddress !== null) && ((typeof g_unCoreSurfaceAddress !== "bigint") || (g_unCoreSurfaceAddress <= 0n))) {
	throw new Error("GetBinarySymbol() returned an invalid Linux CCoreDispSurface address.");
}
```

Patterns accept spaced or comma-separated hexadecimal bytes, `0xNN`, literal `\xNN`, and `?` or `*` wildcards. In JavaScript source, write one literal backslash as `"\\x55"`; `"\x55"` is decoded before SourceJS receives it.

### `BinaryFile.DereferenceBinaryAddress`

`DereferenceBinaryAddress(BinaryIdentifier, nAddressOffset = 0n, unDereferenceCount = 0)` accepts a BigInt address, a symbol or supported pattern string, or a GameData record with exactly one recognized `Address`, `Identifier`, `Symbol`, or `Pattern` key and an optional `Module`. Before lookup, it requires a BigInt offset and a nonnegative safe-integer dereference count. A nullish, unresolved, or zero starting address then returns `0n` without applying the offset or reading memory. Otherwise, it applies a nonzero offset once through native address arithmetic, which checks signed int64 range and address overflow, then reads consecutive addresses until the requested count or a zero address is reached. Number identifiers, malformed identifier records, and rejected byte-pattern strings throw during resolution. Only dereference memory whose layout and lifetime are known; the example builds a safe two-level chain in plugin-owned memory.

```js
const { Address, Allocate, BinaryFile, DataType, Deallocate, GetDataTypeSize } = require("memory");

const g_ServerBinary = new BinaryFile("server");
const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unFirstAddress = 0n;
let g_unSecondAddress = 0n;
let g_unTargetAddress = 0n;

try {
	g_unFirstAddress = Allocate(GetDataTypeSize(DataType.Address));
	if (g_IsInvalidAddress(g_unFirstAddress)) {
		throw new Error("Allocate() failed to create address-chain storage.");
	}

	g_unSecondAddress = Allocate(GetDataTypeSize(DataType.Address));
	if (g_IsInvalidAddress(g_unSecondAddress)) {
		throw new Error("Allocate() failed to create address-chain storage.");
	}

	g_unTargetAddress = Allocate(GetDataTypeSize(DataType.Int));
	if (g_IsInvalidAddress(g_unTargetAddress)) {
		throw new Error("Allocate() failed to create address-chain storage.");
	}

	const FirstAddress = new Address(g_unFirstAddress);
	const SecondAddress = new Address(g_unSecondAddress);
	if ((FirstAddress.SetAddress(g_unSecondAddress) !== FirstAddress) || (SecondAddress.SetAddress(g_unTargetAddress) !== SecondAddress)) {
		throw new Error("Address.SetAddress() did not return the receiver.");
	}

	const unResolvedAddress = g_ServerBinary.DereferenceBinaryAddress(g_unFirstAddress, 0n, 2);
	if (unResolvedAddress !== g_unTargetAddress) {
		throw new Error("The address chain did not resolve to the target allocation.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_IsInvalidAddress(g_unTargetAddress) && (Deallocate(g_unTargetAddress) !== true)) {
			throw new Error("The target address-chain allocation was not released.");
		}
	} catch (TargetCleanupError) {
		g_vecErrors.push(TargetCleanupError);
	}

	try {
		if (!g_IsInvalidAddress(g_unSecondAddress) && (Deallocate(g_unSecondAddress) !== true)) {
			throw new Error("The second address-chain allocation was not released.");
		}
	} catch (SecondCleanupError) {
		g_vecErrors.push(SecondCleanupError);
	}

	try {
		if (!g_IsInvalidAddress(g_unFirstAddress) && (Deallocate(g_unFirstAddress) !== true)) {
			throw new Error("The first address-chain allocation was not released.");
		}
	} catch (FirstCleanupError) {
		g_vecErrors.push(FirstCleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Memory example and cleanup failed.");
}
```

### `BinaryFile.ResolveBinaryAddress`

`ResolveBinaryAddress(BinaryIdentifier)` delegates to `memory/manager.ResolveBinaryIdentifier(strBinaryName, Identifier)` using this instance's binary name by default. The resolver accepts a BigInt address, symbol or supported byte-pattern string, or an object with exactly one recognized `Address`, `Identifier`, `Symbol`, or `Pattern` key; an object may also specify `Module`. Unresolved lookups return `null`; nullish identifiers return `null`, while Number identifiers and malformed identifier objects throw. `GetGameDataSignature` only selects a GameData value; a structured value can be resolved here only when it follows the supported identifier-object shape. The example's `CreateInterface` lookup relies on that factory being exported by the selected Source engine binary.

```js
const { BinaryFile } = require("memory");

const g_ServerBinary = new BinaryFile("server");
const g_unCreateInterfaceAddress = g_ServerBinary.ResolveBinaryAddress("CreateInterface");
if ((g_ServerBinary.Information === null) || (g_unCreateInterfaceAddress === null)) {
	throw new Error("The loaded server binary does not expose CreateInterface.");
}

const g_BinaryInformation = g_ServerBinary.Information;
const g_bValidBinaryName = (typeof g_BinaryInformation.Name === "string") && (g_BinaryInformation.Name.length > 0);
const g_bValidBinaryPath = (typeof g_BinaryInformation.Path === "string") && (g_BinaryInformation.Path.length > 0);
const g_bMatchingBinaryAddress = g_ServerBinary.Address === g_BinaryInformation.Address;
const g_bValidBinaryByteCount = Number.isSafeInteger(g_BinaryInformation.ByteCount) && (g_BinaryInformation.ByteCount > 0);
const g_bMatchingBinaryByteCount = g_ServerBinary.ByteCount === g_BinaryInformation.ByteCount;
const g_bValidCreateInterfaceAddress = (typeof g_unCreateInterfaceAddress === "bigint") && (g_unCreateInterfaceAddress > 0n);
const g_bConsistentBinaryInformation = g_bValidBinaryName && g_bValidBinaryPath && g_bMatchingBinaryAddress && g_bValidBinaryByteCount && g_bMatchingBinaryByteCount && g_bValidCreateInterfaceAddress;
if (!g_bConsistentBinaryInformation) {
	throw new Error("BinaryFile metadata or symbol resolution is inconsistent.");
}
```

## Function

`Function` extends `Address` with one explicit native ABI and optional managed Detours hook ownership.

Constructor: `new Function(unFunctionAddress = 0n, strCallingConvention = Convention.Cdecl, vecArgumentTypes = [], strReturnType = DataType.Void, ReturnConverter = null, ThisObject = null, vecSignatureArgumentTypes = null)`.

| Member | Contract |
| --- | --- |
| `ArgumentTypes` | Normalized values used to encode JavaScript call arguments. |
| `SignatureArgumentTypes` | Normalized native signature exposed to `memory/hooks`; defaults to `ArgumentTypes`. |
| `ReturnType` | Normalized native return data type. |
| `ReturnConverter` | Optional function applied to the native result. |
| [`Convention`](#convention) | Exact calling convention. |
| `ThisObject` | Bound BigInt context address, or `null` for an unbound function. |
| `Hook` | Current owned native hook handle, or `null` when none is owned. A failed callback registration may leave a handle when native rollback fails; remove it explicitly before discarding the callable. |
| `Options` | Each read allocates a fresh shallow snapshot `{ Address, Arguments, Convention, ReturnType, ThisObject }` for native calls and hook configuration. `Arguments` borrows the `SignatureArgumentTypes` array rather than copying it; `ThisObject` is always present but may be `null`. |

```js
const { Address, Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_ConvertInterfaceAddressToAddress = (unInterfaceAddress) => new Address(unInterfaceAddress);
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address, g_ConvertInterfaceAddressToAddress);
const g_CreateInterfaceOptions = g_CreateInterfaceCallable.Options;
const g_InterfaceAddress = g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL);
const g_bMatchingArgumentCount = g_CreateInterfaceCallable.ArgumentTypes.length === 2;
const g_bMatchingSignatureArgumentCount = g_CreateInterfaceCallable.SignatureArgumentTypes.length === 2;
const g_bMatchingReturnDataType = g_CreateInterfaceCallable.ReturnType === DataType.Address;
const g_bMatchingCallingConvention = g_CreateInterfaceCallable.Convention === Convention.Cdecl;
const g_bUnboundThisObject = g_CreateInterfaceCallable.ThisObject === null;
const g_bMissingFunctionHook = g_CreateInterfaceCallable.Hook === null;
const g_bConsistentFunctionConfiguration = g_bMatchingArgumentCount && g_bMatchingSignatureArgumentCount && g_bMatchingReturnDataType && g_bMatchingCallingConvention && g_bUnboundThisObject && g_bMissingFunctionHook;
if (!g_bConsistentFunctionConfiguration) {
	throw new Error("Function configuration is inconsistent.");
}

const g_bMatchingFunctionAddress = g_CreateInterfaceOptions.Address === g_unCreateInterfaceAddress;
const g_bMatchingSignatureArguments = g_CreateInterfaceOptions.Arguments === g_CreateInterfaceCallable.SignatureArgumentTypes;
const g_bMatchingOptionConvention = g_CreateInterfaceOptions.Convention === Convention.Cdecl;
const g_bMatchingOptionReturnDataType = g_CreateInterfaceOptions.ReturnType === DataType.Address;
const g_bMatchingOptionThisObject = g_CreateInterfaceOptions.ThisObject === null;
const g_bMatchingInterfaceAddress = (g_InterfaceAddress instanceof Address) && (g_InterfaceAddress.Address === g_InterfaceRecord.Address);
const g_bConsistentFunctionOptions = g_bMatchingFunctionAddress && g_bMatchingSignatureArguments && g_bMatchingOptionConvention && g_bMatchingOptionReturnDataType && g_bMatchingOptionThisObject && g_bMatchingInterfaceAddress;
if (!g_bConsistentFunctionOptions) {
	throw new Error("Function hook options or return conversion is inconsistent.");
}
```

### `Function.AddHook`

`AddHook(unHookTypeValue, HookCallback)` lazily creates one native Detours hook and registers a pre- or post-callback. The type must be `HookType.Pre` or `HookType.Post`. The example registers a pre-hook on the real `CreateInterface` entry point, then unregisters the callback and removes the native hook.

`AddHook()` acquires a handle through `memory/hooks.CreateFunctionHook()` and caches it before registering the callback. The native result's `Created` field distinguishes a newly created native hook from a new handle for an existing shared hook. Only a newly created native hook is eligible for automatic rollback. Failed registration against a reused hook retains the cached handle and leaves its other callbacks installed.

If registration throws, eligible native rollback is attempted once. Registration and rollback failures are preserved together in an `AggregateError`; an unconfirmed rollback retains the handle, but that reference does not prove the native hook is still installed. A `false` registration result returns `false`, clearing the cached handle only when eligible removal succeeds. `Created` is a creation snapshot, not an ownership lease: explicit parameterless `RemoveHook()` still removes the whole native hook, including callbacks installed by other callers. Use callback-specific removal for shared hooks.

The hook examples below own a fresh callable. They attempt callback removal once, then native-handle cleanup independently, and preserve operation and cleanup failures in order. Cleanup of a retained handle after failed registration is an explicit additional owner action; a failed callback removal is not silently retried. Stop using the sample callable after a cleanup failure.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { HookType } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPreHookCallbackCount = 0;

function OnCreateInterfacePreHookCallback(FunctionHookPayload) {
	g_unPreHookCallbackCount += 1;

	const bMatchingInterfaceName = FunctionHookPayload.Arguments[0] === g_strInterfaceName;
	const bMatchingReturnCodeAddress = FunctionHookPayload.Arguments[1] === NULL;
	if (!bMatchingInterfaceName || !bMatchingReturnCodeAddress) {
		throw new Error("CreateInterface pre-hook received unexpected arguments.");
	}
}

const g_vecErrors = [];
let g_bPreHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPreHookRegistered = g_CreateInterfaceCallable.AddHook(HookType.Pre, OnCreateInterfacePreHookCallback);
	if (g_bPreHookRegistered !== true) {
		throw new Error("AddHook() failed to register the CreateInterface pre-hook.");
	}

	const unInterfaceAddress = g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL);
	const bMatchingInterfaceAddress = unInterfaceAddress === g_unExpectedInterfaceAddress;
	const bMatchingCallbackCount = g_unPreHookCallbackCount === 1;
	if (!bMatchingInterfaceAddress || !bMatchingCallbackCount) {
		throw new Error("CreateInterface returned an unexpected interface address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemoveHook(HookType.Pre, OnCreateInterfacePreHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPreHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPreHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPreHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.AddPostHook`

`AddPostHook(HookCallback)` is the typed convenience form of `AddHook(HookType.Post, HookCallback)`. Post callbacks receive the native `ReturnValue` after the trampoline or original function finishes.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPostHookCallbackCount = 0;

function OnCreateInterfacePostHookCallback(FunctionHookPayload) {
	g_unPostHookCallbackCount += 1;

	if (FunctionHookPayload.ReturnValue !== g_unExpectedInterfaceAddress) {
		throw new Error("CreateInterface post-hook observed the wrong return value.");
	}
}

const g_vecErrors = [];
let g_bPostHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPostHookRegistered = g_CreateInterfaceCallable.AddPostHook(OnCreateInterfacePostHookCallback);
	if (g_bPostHookRegistered !== true) {
		throw new Error("AddPostHook() failed to register the CreateInterface post-hook.");
	}

	const unInterfaceAddress = g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL);
	const bMatchingInterfaceAddress = unInterfaceAddress === g_unExpectedInterfaceAddress;
	const bMatchingCallbackCount = g_unPostHookCallbackCount === 1;
	if (!bMatchingInterfaceAddress || !bMatchingCallbackCount) {
		throw new Error("CreateInterface post-hook was not dispatched exactly once.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemovePostHook(OnCreateInterfacePostHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPostHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPostHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPostHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.AddPreHook`

`AddPreHook(HookCallback)` is the typed convenience form of `AddHook(HookType.Pre, HookCallback)`. Pre callbacks can inspect the decoded `Arguments` before the original function runs.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPreHookCallbackCount = 0;

function OnCreateInterfacePreHookCallback(FunctionHookPayload) {
	g_unPreHookCallbackCount += 1;

	const bMatchingInterfaceName = FunctionHookPayload.Arguments[0] === g_strInterfaceName;
	const bMatchingReturnCodeAddress = FunctionHookPayload.Arguments[1] === NULL;
	if (!bMatchingInterfaceName || !bMatchingReturnCodeAddress) {
		throw new Error("CreateInterface pre-hook received unexpected arguments.");
	}
}

const g_vecErrors = [];
let g_bPreHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPreHookRegistered = g_CreateInterfaceCallable.AddPreHook(OnCreateInterfacePreHookCallback);
	if (g_bPreHookRegistered !== true) {
		throw new Error("AddPreHook() failed to register the CreateInterface pre-hook.");
	}

	const unInterfaceAddress = g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL);
	const bMatchingInterfaceAddress = unInterfaceAddress === g_unExpectedInterfaceAddress;
	const bMatchingCallbackCount = g_unPreHookCallbackCount === 1;
	if (!bMatchingInterfaceAddress || !bMatchingCallbackCount) {
		throw new Error("CreateInterface pre-hook was not dispatched exactly once.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemovePreHook(OnCreateInterfacePreHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPreHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPreHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPreHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.Call`

`Call(...vecArgumentValues)` marshals arguments using `ArgumentTypes`, invokes the BigInt function address with its declared calling convention and native signature, decodes `ReturnType`, and applies `ReturnConverter` when present. The native callback preserves delegated JavaScript exceptions even when the call manager returns a non-empty `null` result, and translates native C++ failures at that boundary; an exception-free native `null` result is published as `null`, then passed to `ReturnConverter` when one is configured. This exception boundary does not prove that foreign code is safe or guarantee recovery from invalid-memory faults. `CreateInterface` has the cross-platform C ABI `void*(char const*, int*)`; passing an interface name from the live registry makes the result directly verifiable.

Each recognized native argument retains its normalized type in a `{ Type, Value }` descriptor, including booleans, integers, and addresses. Signed and unsigned 64-bit integer arguments remain exact `bigint`s, not untyped addresses. String-like arguments retain temporary-string marshaling, while non-native/custom argument values retain their existing pass-through behavior.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
const g_unInterfaceAddress = g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL);
if (g_unInterfaceAddress !== g_InterfaceRecord.Address) {
	throw new Error("CreateInterface returned an unexpected interface address.");
}
```

### `Function.IsCallable`

`IsCallable()` reports whether the wrapper contains a nonzero address. It does not probe page protection or prove that an arbitrary address has the declared ABI.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetBinarySymbol } = require("memory/manager");

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("GetBinarySymbol() did not resolve CreateInterface.");
}

const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
const g_NullCallable = new Function(NULL);
if (!g_CreateInterfaceCallable.IsCallable() || g_NullCallable.IsCallable()) {
	throw new Error("IsCallable() reported inconsistent address state.");
}
```

### `Function.IsHooked`

`IsHooked()` reports whether this wrapper currently owns a native hook handle. Removing individual callbacks does not release that handle; `RemoveHook()` does.

```js
const { Convention, DataType, Function } = require("memory");
const { GetBinarySymbol } = require("memory/manager");

const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_CreateInterfaceHookCallback = () => {};

if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n)) {
	throw new Error("GetBinarySymbol() did not resolve CreateInterface.");
}

const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
if (g_CreateInterfaceCallable.IsHooked()) {
	throw new Error("A new Function unexpectedly owns a hook.");
}

const g_vecErrors = [];
let g_bPreHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPreHookRegistered = g_CreateInterfaceCallable.AddPreHook(g_CreateInterfaceHookCallback);
	if (g_bPreHookRegistered !== true) {
		throw new Error("AddPreHook() failed to register the CreateInterface hook.");
	}

	if (!g_CreateInterfaceCallable.IsHooked()) {
		throw new Error("The Function did not retain its native hook handle.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemovePreHook(g_CreateInterfaceHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPreHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPreHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPreHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.RemoveHook`

`RemoveHook(unHookTypeValue = null, HookCallback = null)` takes either both a valid `HookType.Pre`/`HookType.Post` value and function callback, or neither; a partial or invalid pair throws. With both arguments it removes that callback by identity and returns whether removal succeeded. Calling `RemoveHook()` without arguments removes the underlying Detours hook; it returns `false` when no handle exists or native removal fails, and clears wrapper state only after successful native removal.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { HookType } = require("memory/hooks");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPreHookCallbackCount = 0;

function OnCreateInterfacePreHookCallback() {
	g_unPreHookCallbackCount += 1;
}

const g_vecErrors = [];
let g_bPreHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPreHookRegistered = g_CreateInterfaceCallable.AddHook(HookType.Pre, OnCreateInterfacePreHookCallback);
	if (g_bPreHookRegistered !== true) {
		throw new Error("AddHook() failed to register the CreateInterface pre-hook.");
	}

	g_bCallbackRemovalAttempted = true;

	if (g_CreateInterfaceCallable.RemoveHook(HookType.Pre, OnCreateInterfacePreHookCallback) !== true) {
		throw new Error("The registered pre-hook callback was not removed.");
	}

	g_bPreHookRegistered = false;

	if (g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL) !== g_unExpectedInterfaceAddress) {
		throw new Error("CreateInterface returned an unexpected interface address.");
	}

	if (g_unPreHookCallbackCount !== 0) {
		throw new Error("A removed hook callback was invoked.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemoveHook(HookType.Pre, OnCreateInterfacePreHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPreHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPreHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPreHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.RemovePostHook`

`RemovePostHook(HookCallback)` removes the exact function previously passed to `AddPostHook()` and returns whether it was removed; a non-function argument throws. It leaves the native hook handle available for other callbacks.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPostHookCallbackCount = 0;

function OnCreateInterfacePostHookCallback() {
	g_unPostHookCallbackCount += 1;
}

const g_vecErrors = [];
let g_bPostHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPostHookRegistered = g_CreateInterfaceCallable.AddPostHook(OnCreateInterfacePostHookCallback);
	if (g_bPostHookRegistered !== true) {
		throw new Error("AddPostHook() failed to register the CreateInterface post-hook.");
	}

	g_bCallbackRemovalAttempted = true;

	if (g_CreateInterfaceCallable.RemovePostHook(OnCreateInterfacePostHookCallback) !== true) {
		throw new Error("The registered post-hook callback was not removed.");
	}

	g_bPostHookRegistered = false;

	if (g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL) !== g_unExpectedInterfaceAddress) {
		throw new Error("CreateInterface returned an unexpected interface address.");
	}

	if (g_unPostHookCallbackCount !== 0) {
		throw new Error("A removed post-hook callback was invoked.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemovePostHook(OnCreateInterfacePostHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPostHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPostHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPostHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

### `Function.RemovePreHook`

`RemovePreHook(HookCallback)` removes the exact function previously passed to `AddPreHook()` and returns whether it was removed; a non-function argument throws. It leaves the native hook handle available for other callbacks.

```js
const { Convention, DataType, Function, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_unExpectedInterfaceAddress = g_InterfaceRecord.Address;
const g_CreateInterfaceCallable = new Function(g_unCreateInterfaceAddress, Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
let g_unPreHookCallbackCount = 0;

function OnCreateInterfacePreHookCallback() {
	g_unPreHookCallbackCount += 1;
}

const g_vecErrors = [];
let g_bPreHookRegistered = false;
let g_bCallbackRemovalAttempted = false;

try {
	g_bPreHookRegistered = g_CreateInterfaceCallable.AddPreHook(OnCreateInterfacePreHookCallback);
	if (g_bPreHookRegistered !== true) {
		throw new Error("AddPreHook() failed to register the CreateInterface pre-hook.");
	}

	g_bCallbackRemovalAttempted = true;

	if (g_CreateInterfaceCallable.RemovePreHook(OnCreateInterfacePreHookCallback) !== true) {
		throw new Error("The registered pre-hook callback was not removed.");
	}

	g_bPreHookRegistered = false;

	if (g_CreateInterfaceCallable.Call(g_strInterfaceName, NULL) !== g_unExpectedInterfaceAddress) {
		throw new Error("CreateInterface returned an unexpected interface address.");
	}

	if (g_unPreHookCallbackCount !== 0) {
		throw new Error("A removed pre-hook callback was invoked.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (!g_bCallbackRemovalAttempted && (g_CreateInterfaceCallable.Hook !== null)) {
			g_bCallbackRemovalAttempted = true;
			const bCallbackRemoved = g_CreateInterfaceCallable.RemovePreHook(OnCreateInterfacePreHookCallback);
			if ((bCallbackRemoved !== true) && (g_bPreHookRegistered || (bCallbackRemoved !== false))) {
				throw new Error("The example's callback could not be removed.");
			}

			g_bPreHookRegistered = false;
		}
	} catch (CallbackCleanupError) {
		g_vecErrors.push(CallbackCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) && (g_CreateInterfaceCallable.RemoveHook() !== true)) {
			throw new Error("The example's native hook could not be removed.");
		}

		g_bPreHookRegistered = false;
	} catch (NativeCleanupError) {
		g_vecErrors.push(NativeCleanupError);
	}

	try {
		if ((g_CreateInterfaceCallable.Hook !== null) || g_CreateInterfaceCallable.IsHooked()) {
			throw new Error("The callable still owns an unconfirmed native hook after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Function hook example and cleanup failed.");
}
```

## FunctionInfo

`FunctionInfo` is normalized class-member metadata used by `GetFunctionInfo()`, `GetVirtualFunction()`, and hook creation.

Constructor: `new FunctionInfo(FunctionOptions = {})`. The options object accepts `ArgumentTypes`, `CallingConvention`, `IsVirtual`, `ReturnType`, `ThisAddressOffset`, `VTableIndex`, and `VTableOffset`.

### `FunctionInfo.ArgumentTypes`

`ArgumentTypes` contains normalized native-signature argument types. For virtual members, a leading `DataType.Address` represents the implicit `this` address that `MakeVirtualFunction()` binds to the object and omits from caller-supplied arguments. For `CreateInterface`, the first argument is a C string and the second is a nullable address for the integer result code.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address });
const g_bMatchingArgumentCount = g_CreateInterfaceInformation.ArgumentTypes.length === 2;
const g_bMatchingStringArgument = g_CreateInterfaceInformation.ArgumentTypes[0] === DataType.String;
const g_bMatchingAddressArgument = g_CreateInterfaceInformation.ArgumentTypes[1] === DataType.Address;
if (!g_bMatchingArgumentCount || !g_bMatchingStringArgument || !g_bMatchingAddressArgument) {
	throw new Error("FunctionInfo normalized argument data types incorrectly.");
}
```

### `FunctionInfo.CallingConvention`

`CallingConvention` records the ABI used to call the function. Cross-platform exported Source factories use `Convention.Cdecl`.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address });
if (g_CreateInterfaceInformation.CallingConvention !== Convention.Cdecl) {
	throw new Error("FunctionInfo changed the calling convention.");
}
```

### `FunctionInfo.IsVirtual`

`IsVirtual` distinguishes a vtable method description from a direct function address. `CreateInterface` is an exported non-virtual function.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, IsVirtual: false, ReturnType: DataType.Address });
if (g_CreateInterfaceInformation.IsVirtual) {
	throw new Error("A direct FunctionInfo record was marked as virtual.");
}
```

### `FunctionInfo.ReturnType`

`ReturnType` is the normalized native return data type. The `CreateInterface` factory returns a BigInt address.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address });
if (g_CreateInterfaceInformation.ReturnType !== DataType.Address) {
	throw new Error("FunctionInfo changed the return data type.");
}
```

### `FunctionInfo.ThisAddressOffset`

`ThisAddressOffset` stores a signed safe-integer adjustment for member-function `this` metadata and defaults to `0`. Current `FunctionInfo` helpers retain and expose it but do not apply it.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address, ThisAddressOffset: 0 });
if (g_CreateInterfaceInformation.ThisAddressOffset !== 0) {
	throw new Error("A direct FunctionInfo record has an unexpected this-address adjustment.");
}
```

### `FunctionInfo.ToHookOptions`

`ToHookOptions()` returns a new object containing only normalized `Arguments`, `Convention`, and `ReturnType`. It omits the target `Address`, `ThisObject`, and virtual/offset metadata, so it is not by itself a complete native-hook options object.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address });
const g_CreateInterfaceABIOptions = g_CreateInterfaceInformation.ToHookOptions();
const g_bMatchingCallingConvention = g_CreateInterfaceABIOptions.Convention === Convention.Cdecl;
const g_bMatchingReturnDataType = g_CreateInterfaceABIOptions.ReturnType === DataType.Address;
const g_bMatchingArgumentDataTypes = g_CreateInterfaceABIOptions.Arguments === g_CreateInterfaceInformation.ArgumentTypes;
if (!g_bMatchingCallingConvention || !g_bMatchingReturnDataType || !g_bMatchingArgumentDataTypes) {
	throw new Error("ToHookOptions() returned unexpected ABI fields.");
}
```

### `FunctionInfo.VTableIndex`

`VTableIndex` identifies a virtual slot. Direct functions use the sentinel `-1`.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address, VTableIndex: -1 });
if (g_CreateInterfaceInformation.VTableIndex !== -1) {
	throw new Error("A direct FunctionInfo record has an unexpected virtual slot.");
}
```

### `FunctionInfo.VTableOffset`

`VTableOffset` stores a non-negative safe-integer byte offset for locating the vtable relative to the object address and defaults to `0`. Current `FunctionInfo` helpers retain and expose it but do not apply it.

```js
const { Convention, DataType, FunctionInfo } = require("memory");

const g_CreateInterfaceInformation = new FunctionInfo({ ArgumentTypes: [DataType.String, DataType.Address], CallingConvention: Convention.Cdecl, ReturnType: DataType.Address, VTableOffset: 0 });
if (g_CreateInterfaceInformation.VTableOffset !== 0) {
	throw new Error("A direct FunctionInfo record has an unexpected virtual-table offset.");
}
```

## Address

`Address` extends `memory/helpers.BaseAddress`. In addition to the typed methods below, it exposes the generic live-address operations in this table.

| Member | Contract |
| --- | --- |
| `GetMemoryAddress()` | Returns the current native address as a BigInt. |
| `HasMemoryAddress()` | Returns whether the current address is nonzero. |
| `Read(strDataType = "address", nAddressOffset = 0n)` | Reads one native value. |
| `ReadAddress(nAddressOffset = 0n)` | Reads one native address as a BigInt. |
| `Write(strDataType, DataValue, nAddressOffset = 0n)` | Writes one native value and returns the native success boolean. |
| `WriteAddress(unStoredAddress, nAddressOffset = 0n)` | Writes one BigInt address and returns the native success boolean. |
| `valueOf()` | Returns the current address as a BigInt. |
| `toString()` | Returns the current address in hexadecimal display form. |

```js
const { Address, Allocate, DataType, Deallocate, GetDataTypeSize } = require("memory");

const g_unAllocationByteCount = GetDataTypeSize(DataType.Address);
const g_vecErrors = [];
let g_AllocationOwner = null;
let g_bDeallocationAttempted = false;
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	g_AllocationOwner = new Address(g_unAllocationAddress, true);
	if (g_AllocationOwner.Null || (g_AllocationOwner.Owned !== true)) {
		throw new Error("Address() failed to create the owning allocation wrapper.");
	}

	const bMatchingAddress = g_AllocationOwner.GetMemoryAddress() === g_unAllocationAddress;
	const bHasAddress = g_AllocationOwner.HasMemoryAddress();
	const bMatchingValueOfAddress = g_AllocationOwner.valueOf() === g_unAllocationAddress;
	const bMatchingStringValue = g_AllocationOwner.toString() === `0x${g_unAllocationAddress.toString(16)}`;
	if (!bMatchingAddress || !bHasAddress || !bMatchingValueOfAddress || !bMatchingStringValue) {
		throw new Error("Address identity methods returned inconsistent values.");
	}

	const bIntegerWritten = g_AllocationOwner.Write(DataType.Int, 123456);
	const bMatchingInteger = g_AllocationOwner.Read(DataType.Int) === 123456;
	if ((bIntegerWritten !== true) || !bMatchingInteger) {
		throw new Error("Write() or Read() failed the integer round trip.");
	}

	const bAddressWritten = g_AllocationOwner.WriteAddress(g_unAllocationAddress);
	const bMatchingStoredAddress = g_AllocationOwner.ReadAddress() === g_unAllocationAddress;
	if ((bAddressWritten !== true) || !bMatchingStoredAddress) {
		throw new Error("WriteAddress() or ReadAddress() failed the address round trip.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_AllocationOwner === null) {
			if (Deallocate(g_unAllocationAddress) !== true) {
				throw new Error("Deallocate() failed after Address construction.");
			}

		} else if (!g_bDeallocationAttempted) {
			g_bDeallocationAttempted = true;

			if (g_AllocationOwner.Deallocate() !== true) {
				throw new Error("Address.Deallocate() failed to release the allocation.");
			}
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if ((g_AllocationOwner !== null) && (!g_AllocationOwner.Null || g_AllocationOwner.Owned)) {
			throw new Error("The owning Address still has unconfirmed allocation state after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address example and cleanup failed.");
}
```

### `new Address(unAddress = 0n, bOwned = false)`

The constructor wraps a non-negative BigInt address, and `bOwned` must be boolean. Pass `true` only when this wrapper assumes ownership of an allocation it must release (for example, an `Allocate()` result); engine, binary, and other borrowed memory must remain non-owning.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BorrowedAddress = new Address(g_unAllocationAddress);
	const bMatchingAddress = BorrowedAddress.Address === g_unAllocationAddress;
	const bNonOwningAddress = !BorrowedAddress.Owned;
	const bNonNullAddress = !BorrowedAddress.Null;
	if (!bMatchingAddress || !bNonOwningAddress || !bNonNullAddress) {
		throw new Error("Address constructor state is inconsistent.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address example and cleanup failed.");
}
```

### `Address.Address`

`Address` is a read-only property containing the wrapped non-negative BigInt address. Use `Reallocate()` to resize owned memory; it updates the wrapped address. Successful `Deallocate()` resets `Address` to `0n` and clears `Owned`.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BorrowedAddress = new Address(g_unAllocationAddress);
	if (BorrowedAddress.Address !== g_unAllocationAddress) {
		throw new Error("Address did not retain the constructor BigInt address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address example and cleanup failed.");
}
```

### `Address.Owned`

`Owned` controls whether `Reallocate()` and `Deallocate()` are allowed; it is caller-supplied and is not inferred or validated from the address value. Marking borrowed memory as owned can make those methods reallocate or free foreign storage.

```js
const { Address, Allocate, DataType, Deallocate, GetDataTypeSize } = require("memory");

const g_unAllocationByteCount = GetDataTypeSize(DataType.Address);
const g_vecErrors = [];
let g_AllocationOwner = null;
let g_bDeallocationAttempted = false;
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	g_AllocationOwner = new Address(g_unAllocationAddress, true);
	if ((g_AllocationOwner.Owned !== true) || g_AllocationOwner.Null) {
		throw new Error("The allocation must be owned by its Address wrapper.");
	}

	g_bDeallocationAttempted = true;

	if ((g_AllocationOwner.Deallocate() !== true) || !g_AllocationOwner.Null || g_AllocationOwner.Owned) {
		throw new Error("Address.Deallocate() did not clear the owning Address state.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (g_AllocationOwner === null) {
			if (Deallocate(g_unAllocationAddress) !== true) {
				throw new Error("Deallocate() failed after Address construction.");
			}

		} else if (!g_bDeallocationAttempted) {
			g_bDeallocationAttempted = true;

			if (g_AllocationOwner.Deallocate() !== true) {
				throw new Error("Address.Deallocate() failed to release the allocation.");
			}
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}

	try {
		if ((g_AllocationOwner !== null) && (!g_AllocationOwner.Null || g_AllocationOwner.Owned)) {
			throw new Error("The owning Address still has unconfirmed allocation state after cleanup.");
		}
	} catch (VerificationError) {
		g_vecErrors.push(VerificationError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address example and cleanup failed.");
}
```

### `Address.Null`

`Null` is a live boolean check that the current `Address` is the null-address sentinel `0n`.

```js
const { NULL, Address } = require("memory");

const g_NullAddress = new Address(NULL);
if (!g_NullAddress.Null) {
	throw new Error("Address.Null did not recognize the null-address sentinel.");
}
```

### `Address.CreateFromAddress`

`Address.CreateFromAddress(unAddress)` returns a non-owning `Address` wrapper for the supplied BigInt address. It does not allocate or own the referenced memory; the caller remains responsible for the address's validity and lifetime.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BorrowedAddress = Address.CreateFromAddress(g_unAllocationAddress);
	if ((BorrowedAddress.Address !== g_unAllocationAddress) || BorrowedAddress.Owned) {
		throw new Error("CreateFromAddress() returned an invalid non-owning Address.");
	}
} catch (OperationError) {
	g_vecErrors.push(OperationError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CleanupError) {
		g_vecErrors.push(CleanupError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address example and cleanup failed.");
}
```

### `Address.Add`

`Add(nAddressOffset)` returns a new non-owning wrapper at the checked signed BigInt byte offset and leaves the original wrapper unchanged.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nAddressOffset = 4n;
const g_nExpectedIntegerValue = 20;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const SourceAddress = new Address(g_unAllocationAddress);
	SourceAddress.SetInt(g_nExpectedIntegerValue, g_nAddressOffset);
	const OffsetAddress = SourceAddress.Add(g_nAddressOffset);
	const bMatchingOffsetAddress = OffsetAddress.Address === (g_unAllocationAddress + g_nAddressOffset);
	const bMatchingIntegerValue = OffsetAddress.GetInt() === g_nExpectedIntegerValue;
	const bUnchangedSourceAddress = SourceAddress.Address === g_unAllocationAddress;
	const bNonOwningResult = !OffsetAddress.Owned;
	if (!bMatchingOffsetAddress || !bMatchingIntegerValue || !bUnchangedSourceAddress || !bNonOwningResult) {
		throw new Error("Address.Add() did not preserve byte-offset semantics.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.Compare`

`Compare(AddressLike, unByteCount)` compares exactly `unByteCount` bytes at this address and the resolved address-like value. Both native ranges must be readable and non-null, and `unByteCount` must be positive. It returns the `memcmp`-style integer result: negative, `0`, or positive; the nonzero magnitude is not normalized.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_unExpectedIntegerValue = 0x12345678;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unLeftMemoryAddress = 0n;
let g_unRightMemoryAddress = 0n;

try {
	g_unLeftMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unLeftMemoryAddress)) {
		throw new Error("Allocate() failed to create left comparison storage.");
	}

	g_unRightMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unRightMemoryAddress)) {
		throw new Error("Allocate() failed to create right comparison storage.");
	}

	const LeftAddress = new Address(g_unLeftMemoryAddress).SetUInt(g_unExpectedIntegerValue);
	const RightAddress = new Address(g_unRightMemoryAddress).SetUInt(g_unExpectedIntegerValue);
	if (LeftAddress.Compare(RightAddress, g_unAllocationByteCount) !== 0) {
		throw new Error("Equal byte ranges did not compare equal.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unRightMemoryAddress, g_unLeftMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.CompareTo`

`CompareTo(AddressLike)` compares numeric BigInt address values, not the bytes stored there, and returns exactly `-1`, `0`, or `1` for lower, equal, or higher addresses.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unFirstMemoryAddress = 0n;
let g_unSecondMemoryAddress = 0n;

try {
	g_unFirstMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unFirstMemoryAddress)) {
		throw new Error("Allocate() failed to create the first address-comparison allocation.");
	}

	g_unSecondMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unSecondMemoryAddress)) {
		throw new Error("Allocate() failed to create the second address-comparison allocation.");
	}

	if (g_unFirstMemoryAddress === g_unSecondMemoryAddress) {
		g_unSecondMemoryAddress = 0n;
		throw new Error("Allocate() returned duplicate live addresses.");
	}

	const unLowerMemoryAddress = (g_unFirstMemoryAddress < g_unSecondMemoryAddress) ? g_unFirstMemoryAddress : g_unSecondMemoryAddress;
	const unHigherMemoryAddress = (g_unFirstMemoryAddress > g_unSecondMemoryAddress) ? g_unFirstMemoryAddress : g_unSecondMemoryAddress;
	const nComparisonResult = new Address(unLowerMemoryAddress).CompareTo(unHigherMemoryAddress);
	if (nComparisonResult !== -1) {
		throw new Error("The lower numeric address did not compare first.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unSecondMemoryAddress, g_unFirstMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.CopyFrom`

`CopyFrom(SourceAddressLike, unByteCount)` copies exactly a positive byte count from the resolved source address into this address and returns `true` after `memcpy` completes. The source range must be readable, the destination range writable, both addresses nonzero, and the ranges non-overlapping.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_unExpectedIntegerValue = 0xDECAFBAD;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unSourceMemoryAddress = 0n;
let g_unDestinationMemoryAddress = 0n;

try {
	g_unSourceMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unSourceMemoryAddress)) {
		throw new Error("Allocate() failed to create source CopyFrom() storage.");
	}

	g_unDestinationMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unDestinationMemoryAddress)) {
		throw new Error("Allocate() failed to create destination CopyFrom() storage.");
	}

	new Address(g_unSourceMemoryAddress).SetUInt(g_unExpectedIntegerValue);

	const DestinationAddress = new Address(g_unDestinationMemoryAddress);
	const bMemoryCopied = DestinationAddress.CopyFrom(g_unSourceMemoryAddress, g_unAllocationByteCount);
	const bMatchingIntegerValue = DestinationAddress.GetUInt() === g_unExpectedIntegerValue;
	if ((bMemoryCopied !== true) || !bMatchingIntegerValue) {
		throw new Error("CopyFrom() did not copy the source bytes.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unDestinationMemoryAddress, g_unSourceMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.CopyTo`

`CopyTo(DestinationAddressLike, unByteCount)` copies exactly a positive byte count from this address into the resolved destination and returns `true` after `memcpy` completes. The source range must be readable, the destination range writable, both addresses nonzero, and the ranges non-overlapping.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_unExpectedIntegerValue = 0x10203040;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unSourceMemoryAddress = 0n;
let g_unDestinationMemoryAddress = 0n;

try {
	g_unSourceMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unSourceMemoryAddress)) {
		throw new Error("Allocate() failed to create source CopyTo() storage.");
	}

	g_unDestinationMemoryAddress = Allocate(g_unAllocationByteCount);
	if (g_IsInvalidAddress(g_unDestinationMemoryAddress)) {
		throw new Error("Allocate() failed to create destination CopyTo() storage.");
	}

	const SourceAddress = new Address(g_unSourceMemoryAddress).SetUInt(g_unExpectedIntegerValue);
	const DestinationAddress = new Address(g_unDestinationMemoryAddress);
	const bMemoryCopied = SourceAddress.CopyTo(DestinationAddress, g_unAllocationByteCount);
	const bMatchingIntegerValue = DestinationAddress.GetUInt() === g_unExpectedIntegerValue;
	if ((bMemoryCopied !== true) || !bMatchingIntegerValue) {
		throw new Error("CopyTo() did not copy the source bytes.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unDestinationMemoryAddress, g_unSourceMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.Deallocate`

`Deallocate()` throws when `Owned` is falsy, then returns whether the underlying allocation was released. Keep the writable `Owned` field boolean: this guard does not establish ownership from the address itself. On success it resets `Address` to `0n` and clears `Owned`; on failure the wrapper state is retained. A normally constructed non-owning wrapper has `Owned === false` and cannot release storage. The example attempts release once and preserves operation and cleanup errors independently.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_vecErrors = [];
let g_AllocationOwner = null;
let g_bDeallocationAttempted = false;

const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	g_AllocationOwner = new Address(g_unAllocationAddress, true);
	g_AllocationOwner.SetInt(123);

	g_bDeallocationAttempted = true;
	const bMemoryReleased = g_AllocationOwner.Deallocate();
	const bAddressCleared = g_AllocationOwner.Address === 0n;
	const bOwnershipCleared = !g_AllocationOwner.Owned;
	if ((bMemoryReleased !== true) || !bAddressCleared || !bOwnershipCleared) {
		throw new Error("Address.Deallocate() did not clear the owning Address state.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	if (!g_bDeallocationAttempted) {
		g_bDeallocationAttempted = true;

		try {
			const bMemoryReleased = (g_AllocationOwner === null) ? Deallocate(g_unAllocationAddress) : g_AllocationOwner.Deallocate();
			if (bMemoryReleased !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}

	if (g_AllocationOwner !== null) {
		try {
			if ((g_AllocationOwner.Address !== 0n) || g_AllocationOwner.Owned) {
				throw new Error("Address.Deallocate() retained owning wrapper state.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.Equals`

`Equals(AddressLike)` returns whether the resolved BigInt address equals this wrapper's `Address`; it compares numeric address identity, not the bytes stored there.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BorrowedAddress = new Address(g_unAllocationAddress);
	const bMatchesNumericAddress = BorrowedAddress.Equals(g_unAllocationAddress);
	const bMatchesAddressWrapper = BorrowedAddress.Equals(new Address(g_unAllocationAddress));
	const OffsetAddress = BorrowedAddress.Add(1n);
	const bRejectsOffsetAddress = !BorrowedAddress.Equals(OffsetAddress);
	if (!bMatchesNumericAddress || !bMatchesAddressWrapper || !bRejectsOffsetAddress) {
		throw new Error("Equals() produced an unexpected result.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetBool`

`GetBool(nAddressOffset = 0n)` reads and returns the boolean stored at this address plus a signed BigInt byte offset. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nAddressOffset = 1n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BooleanAddress = new Address(g_unAllocationAddress).SetBool(true, g_nAddressOffset);
	if (BooleanAddress.GetBool(g_nAddressOffset) !== true) {
		throw new Error("GetBool() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetChar`

`GetChar(nAddressOffset = 0n)` reads one native `char` at this address plus the signed BigInt byte offset and returns its value as a JavaScript number. Signedness follows the target compiler's plain-`char` contract; the resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nAddressOffset = 1n;
const g_nExpectedCharacterValue = 12;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const CharacterAddress = new Address(g_unAllocationAddress).SetChar(g_nExpectedCharacterValue, g_nAddressOffset);
	if (CharacterAddress.GetChar(g_nAddressOffset) !== g_nExpectedCharacterValue) {
		throw new Error("GetChar() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetDouble`

`GetDouble(nAddressOffset = 0n)` reads a native `double` from this address plus the signed BigInt byte offset and returns a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_dblExpectedDoubleValue = Math.PI;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const DoubleAddress = new Address(g_unAllocationAddress).SetDouble(g_dblExpectedDoubleValue);
	if (DoubleAddress.GetDouble() !== g_dblExpectedDoubleValue) {
		throw new Error("GetDouble() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetFloat`

`GetFloat(nAddressOffset = 0n)` reads a native `float` from this address plus the signed BigInt byte offset and returns a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_flExpectedFloatValue = 1.25;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const FloatAddress = new Address(g_unAllocationAddress).SetFloat(g_flExpectedFloatValue);
	if (FloatAddress.GetFloat() !== g_flExpectedFloatValue) {
		throw new Error("GetFloat() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetInt`

`GetInt(nAddressOffset = 0n)` reads a native signed `int` from this address plus the signed BigInt byte offset and returns it as a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nAddressOffset = 4n;
const g_nExpectedIntegerValue = -123456;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const IntegerAddress = new Address(g_unAllocationAddress).SetInt(g_nExpectedIntegerValue, g_nAddressOffset);
	if (IntegerAddress.GetInt(g_nAddressOffset) !== g_nExpectedIntegerValue) {
		throw new Error("GetInt() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetLong`

`GetLong(nAddressOffset = 0n)` reads a native signed `long` at this address plus the signed BigInt byte offset. It returns a BigInt when `sizeof(long) > sizeof(int)` and a Number otherwise; the resulting address must identify readable storage.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_unAllocationByteCount = TYPE_SIZES[DataType.Long];
const g_nExpectedLongValue = (g_unAllocationByteCount > TYPE_SIZES[DataType.Int]) ? -5_000_000_000n : -2000;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const LongAddress = new Address(g_unAllocationAddress).SetLong(g_nExpectedLongValue);
	if (LongAddress.GetLong() !== g_nExpectedLongValue) {
		throw new Error("GetLong() did not preserve the selected-platform value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetLongLong`

`GetLongLong(nAddressOffset = 0n)` reads a signed native `long long` at this address plus the signed BigInt byte offset and returns a BigInt. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nExpectedLongLongValue = -1234567890123n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const LongLongAddress = new Address(g_unAllocationAddress).SetLongLong(g_nExpectedLongLongValue);
	if (LongLongAddress.GetLongLong() !== g_nExpectedLongLongValue) {
		throw new Error("GetLongLong() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetShort`

`GetShort(nAddressOffset = 0n)` reads a native signed `short` from this address plus the signed BigInt byte offset and returns it as a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_nAddressOffset = 2n;
const g_nExpectedShortValue = -32000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const ShortAddress = new Address(g_unAllocationAddress).SetShort(g_nExpectedShortValue, g_nAddressOffset);
	if (ShortAddress.GetShort(g_nAddressOffset) !== g_nExpectedShortValue) {
		throw new Error("GetShort() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetStringAddress`

`GetStringAddress(nAddressOffset = 0n)` reads a `char const*` slot at this address plus the signed BigInt byte offset. A null pointer returns `null`; otherwise, the pointed-to null-terminated UTF-8 string is copied into a JavaScript string. The slot and string bytes must be readable and valid during the call; this method does not take ownership.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

// ASCII fixture: each character occupies one UTF-8 byte.
const g_strExpectedText = "SourceJS";
const g_unTextByteCount = g_strExpectedText.length + 1;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unTextMemoryAddress = 0n;
let g_unAddressSlot = 0n;

try {
	g_unTextMemoryAddress = Allocate(g_unTextByteCount);
	if (g_IsInvalidAddress(g_unTextMemoryAddress)) {
		throw new Error("Allocate() failed to create string storage.");
	}

	g_unAddressSlot = Allocate(TYPE_SIZES[DataType.Address]);
	if (g_IsInvalidAddress(g_unAddressSlot)) {
		throw new Error("Allocate() failed to create string-address slot storage.");
	}

	const TextAddress = new Address(g_unTextMemoryAddress);
	for (const [unIndex, strCharacter] of [...g_strExpectedText].entries()) {
		TextAddress.SetUChar(strCharacter.charCodeAt(0), BigInt(unIndex));
	}

	TextAddress.SetUChar(0, BigInt(g_strExpectedText.length));

	const AddressSlot = new Address(g_unAddressSlot).SetAddress(g_unTextMemoryAddress);
	if (AddressSlot.GetStringAddress() !== g_strExpectedText) {
		throw new Error("GetStringAddress() did not decode the pointed text.");
	}

	AddressSlot.SetAddress(0n);
	if (AddressSlot.GetStringAddress() !== null) {
		throw new Error("GetStringAddress() did not return null for an empty string-address slot.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unAddressSlot, g_unTextMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetUChar`

`GetUChar(nAddressOffset = 0n)` reads a native `unsigned char` at this address plus the signed BigInt byte offset and returns it as a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nAddressOffset = 1n;
const g_unExpectedByteValue = 250;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const CharacterAddress = new Address(g_unAllocationAddress).SetUChar(g_unExpectedByteValue, g_nAddressOffset);
	if (CharacterAddress.GetUChar(g_nAddressOffset) !== g_unExpectedByteValue) {
		throw new Error("GetUChar() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetUInt`

`GetUInt(nAddressOffset = 0n)` reads a native `unsigned int` from this address plus the signed BigInt byte offset and returns it as a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_unExpectedIntegerValue = 4_000_000_000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const IntegerAddress = new Address(g_unAllocationAddress).SetUInt(g_unExpectedIntegerValue);
	if (IntegerAddress.GetUInt() !== g_unExpectedIntegerValue) {
		throw new Error("GetUInt() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetULong`

`GetULong(nAddressOffset = 0n)` reads a native `unsigned long` at this address plus the signed BigInt byte offset. It returns a BigInt when `sizeof(unsigned long) > sizeof(unsigned int)` and a Number otherwise; the resulting address must identify readable storage.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_unAllocationByteCount = TYPE_SIZES[DataType.ULong];
const g_unExpectedUnsignedLongValue = (g_unAllocationByteCount > TYPE_SIZES[DataType.UInt]) ? 5_000_000_000n : 3_000_000_000;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedLongAddress = new Address(g_unAllocationAddress).SetULong(g_unExpectedUnsignedLongValue);
	if (UnsignedLongAddress.GetULong() !== g_unExpectedUnsignedLongValue) {
		throw new Error("GetULong() did not preserve the selected-platform value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetULongLong`

`GetULongLong(nAddressOffset = 0n)` reads a native `unsigned long long` at this address plus the signed BigInt byte offset and returns a BigInt. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_unExpectedUnsignedLongLongValue = 12_345_678_901_234n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedLongLongAddress = new Address(g_unAllocationAddress).SetULongLong(g_unExpectedUnsignedLongLongValue);
	if (UnsignedLongLongAddress.GetULongLong() !== g_unExpectedUnsignedLongLongValue) {
		throw new Error("GetULongLong() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetUShort`

`GetUShort(nAddressOffset = 0n)` reads a native `unsigned short` from this address plus the signed BigInt byte offset and returns it as a JavaScript number. The resulting address must identify readable storage.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_nAddressOffset = 2n;
const g_unExpectedUnsignedShortValue = 65000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedShortAddress = new Address(g_unAllocationAddress).SetUShort(g_unExpectedUnsignedShortValue, g_nAddressOffset);
	if (UnsignedShortAddress.GetUShort(g_nAddressOffset) !== g_unExpectedUnsignedShortValue) {
		throw new Error("GetUShort() did not read the written value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.GetVirtualFunction`

`GetVirtualFunction(unVirtualFunctionIndex)` reads the requested non-negative integer slot from the object's virtual table and returns its function address as a BigInt; a null table or entry produces `0n`. For a non-null table, the converted index must be finite, integral and within the nonnegative signed 32-bit range before slot arithmetic; fractions and out-of-range values are rejected, not truncated or wrapped. Conversion may execute JavaScript, so the native binding rereads the object's table afterward and uses the current table, returning `0n` if it detached. An initially null table still returns `0n` without converting the unused index. The object and selected table slot must remain live and readable throughout the call. The example constructs a controlled virtual table in plugin-owned memory instead of calling an unknown engine slot.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");
const { GetBinarySymbol } = require("memory/manager");

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_unAddressByteCount = TYPE_SIZES[DataType.Address];
const g_unVirtualFunctionIndex = 0;
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if (g_IsInvalidAddress(g_unCreateInterfaceAddress)) {
	throw new Error("GetBinarySymbol() did not resolve CreateInterface.");
}

const g_vecErrors = [];
let g_unObjectMemoryAddress = 0n;
let g_unVirtualTableMemoryAddress = 0n;

try {
	g_unObjectMemoryAddress = Allocate(g_unAddressByteCount);
	if (g_IsInvalidAddress(g_unObjectMemoryAddress)) {
		throw new Error("Allocate() failed to create object storage.");
	}

	g_unVirtualTableMemoryAddress = Allocate(g_unAddressByteCount);
	if (g_IsInvalidAddress(g_unVirtualTableMemoryAddress)) {
		throw new Error("Allocate() failed to create virtual-table storage.");
	}

	const ObjectAddress = new Address(g_unObjectMemoryAddress).SetAddress(g_unVirtualTableMemoryAddress);
	const VirtualTableAddress = new Address(g_unVirtualTableMemoryAddress).SetAddress(g_unCreateInterfaceAddress);
	const unVirtualFunctionAddress = ObjectAddress.GetVirtualFunction(g_unVirtualFunctionIndex);
	if (unVirtualFunctionAddress !== g_unCreateInterfaceAddress) {
		throw new Error("GetVirtualFunction() did not return the stored function address.");
	}

	VirtualTableAddress.SetAddress(0n);
	if (ObjectAddress.GetVirtualFunction(g_unVirtualFunctionIndex) !== 0n) {
		throw new Error("GetVirtualFunction() did not preserve a null virtual-table entry.");
	}

	ObjectAddress.SetAddress(0n);
	if (ObjectAddress.GetVirtualFunction(g_unVirtualFunctionIndex) !== 0n) {
		throw new Error("GetVirtualFunction() did not preserve a null virtual table.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unVirtualTableMemoryAddress, g_unObjectMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.IsOverlapping`

`IsOverlapping(DestinationAddressLike, unByteCount)` compares the half-open BigInt ranges `[Address, Address + BigInt(unByteCount))` and `[DestinationAddress, DestinationAddress + BigInt(unByteCount))`. `unByteCount` must be a positive safe integer or the method throws `TypeError`. This is a numeric overlap check; it does not validate that either range is allocated or readable.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 32;
const g_nOverlappingAddressOffset = 8n;
const g_nDisjointAddressOffset = 16n;
const g_unComparedByteCount = 16;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const SourceAddress = new Address(g_unAllocationAddress);
	const OverlappingAddress = SourceAddress.Add(g_nOverlappingAddressOffset);
	const DisjointAddress = SourceAddress.Add(g_nDisjointAddressOffset);
	const bOverlappingRangeDetected = SourceAddress.IsOverlapping(OverlappingAddress, g_unComparedByteCount);
	const bDisjointRangeRejected = !SourceAddress.IsOverlapping(DisjointAddress, g_unComparedByteCount);
	if (!bOverlappingRangeDetected || !bDisjointRangeRejected) {
		throw new Error("IsOverlapping() returned inconsistent range results.");
	}

	let bInvalidByteCountRejected = false;

	try {
		SourceAddress.IsOverlapping(OverlappingAddress, 0);
	} catch (CaughtError) {
		if ((CaughtError === null) || (CaughtError === undefined) || (CaughtError.name !== "TypeError")) {
			throw CaughtError;
		}

		bInvalidByteCountRejected = true;
	}

	if (!bInvalidByteCountRejected) {
		throw new Error("IsOverlapping() accepted a non-positive byte count.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.MakeFunction`

`MakeFunction(CallingConventionOrFunctionInformation = Convention.Cdecl, vecArgumentTypes = [], strReturnType = DataType.Void)` binds this wrapper's address as the callable target. Pass a calling convention with the argument and return types, or a `FunctionInfo`; that overload copies only `CallingConvention`, `ArgumentTypes`, and `ReturnType`, not the record's address, `ThisObject`, or virtual/offset metadata. The returned function borrows the code address; its binary must remain loaded for every call or hook. Use only an ABI known for the selected binary; `CreateInterface` has a stable exported C ABI.

```js
const { Address, Convention, DataType, NULL } = require("memory");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const { GetBinarySymbol } = require("memory/manager");

const g_IsServerGameDLLInterfaceName = (strInterfaceName) => strInterfaceName.startsWith("ServerGameDLL");
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strInterfaceName = g_vecInterfaceNames.find(g_IsServerGameDLLInterfaceName);
if ((typeof g_unCreateInterfaceAddress !== "bigint") || (g_unCreateInterfaceAddress <= 0n) || (g_strInterfaceName === undefined)) {
	throw new Error("GetBinarySymbol() or GetAllInterfaceNames() could not resolve ServerGameDLL.");
}

const g_InterfaceRecord = GetInterfaceRecord(g_strInterfaceName);
if (g_InterfaceRecord === null) {
	throw new Error("GetInterfaceRecord() did not return ServerGameDLL.");
}

const g_CreateInterfaceFunction = new Address(g_unCreateInterfaceAddress).MakeFunction(Convention.Cdecl, [DataType.String, DataType.Address], DataType.Address);
const g_unInterfaceAddress = g_CreateInterfaceFunction.Call(g_strInterfaceName, NULL);
const g_bMatchingFunctionAddress = g_CreateInterfaceFunction.Address === g_unCreateInterfaceAddress;
const g_bMatchingInterfaceAddress = g_unInterfaceAddress === g_InterfaceRecord.Address;
if (!g_bMatchingFunctionAddress || !g_bMatchingInterfaceAddress) {
	throw new Error("The Address-backed function returned an unexpected interface.");
}
```

### `Address.MakeVirtualFunction`

`MakeVirtualFunction(VirtualFunctionIndexOrInformation, strCallingConvention = Convention.Thiscall, vecArgumentTypes = [], strReturnType = DataType.Void)` reads the selected vtable entry and creates a `Function` whose target is that entry and whose `ThisObject` is this wrapper's BigInt address. Pass a non-negative integer slot index with an explicit signature, or a `FunctionInfo`; that overload uses `VTableIndex`, `CallingConvention`, `ArgumentTypes`, and `ReturnType`, while deriving the target and call context from this wrapper. For a `FunctionInfo`, a leading `DataType.Address` in `ArgumentTypes` is removed from the user-supplied call arguments as the implicit object argument. `ThisAddressOffset` and `VTableOffset` are not applied: the lookup and bound `ThisObject` use this wrapper's unadjusted address. The returned function does not own the object, table, or code storage; those must remain valid for every call or hook. It does not invoke the slot until `Call()`; use only an ABI known for the selected binary.

The controlled-table example below checks metadata binding only. Its stored `CreateInterface` address is a C factory, not a member function, so the illustrative `Convention.Thiscall` wrapper must not be called or hooked. All temporary object/table storage is released after the metadata checks.

```js
const { Address, Allocate, Convention, DataType, Deallocate, TYPE_SIZES } = require("memory");
const { GetBinarySymbol } = require("memory/manager");

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_unAddressByteCount = TYPE_SIZES[DataType.Address];
const g_unVirtualFunctionIndex = 0;
const g_unCreateInterfaceAddress = GetBinarySymbol("server", "CreateInterface");
if (g_IsInvalidAddress(g_unCreateInterfaceAddress)) {
	throw new Error("GetBinarySymbol() did not resolve CreateInterface.");
}

const g_vecErrors = [];
let g_unObjectMemoryAddress = 0n;
let g_unVirtualTableMemoryAddress = 0n;

try {
	g_unObjectMemoryAddress = Allocate(g_unAddressByteCount);
	if (g_IsInvalidAddress(g_unObjectMemoryAddress)) {
		throw new Error("Allocate() failed to create object storage.");
	}

	g_unVirtualTableMemoryAddress = Allocate(g_unAddressByteCount);
	if (g_IsInvalidAddress(g_unVirtualTableMemoryAddress)) {
		throw new Error("Allocate() failed to create virtual-table storage.");
	}

	new Address(g_unObjectMemoryAddress).SetAddress(g_unVirtualTableMemoryAddress);
	new Address(g_unVirtualTableMemoryAddress).SetAddress(g_unCreateInterfaceAddress);

	const VirtualFunction = new Address(g_unObjectMemoryAddress).MakeVirtualFunction(g_unVirtualFunctionIndex, Convention.Thiscall, [], DataType.Address);
	const bMatchingFunctionAddress = VirtualFunction.Address === g_unCreateInterfaceAddress;
	const bMatchingThisObjectAddress = VirtualFunction.ThisObject === g_unObjectMemoryAddress;
	const bMatchingHookOptionAddress = VirtualFunction.Options.ThisObject === g_unObjectMemoryAddress;
	if (!bMatchingFunctionAddress || !bMatchingThisObjectAddress || !bMatchingHookOptionAddress) {
		throw new Error("MakeVirtualFunction() did not retain the virtual-table slot and object context.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unVirtualTableMemoryAddress, g_unObjectMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.MoveFrom`

`MoveFrom(SourceAddressLike, unByteCount)` copies a positive byte count from the resolved source address into this address with overlap-safe `memmove` semantics and returns `true` after the move. Both addresses must be nonzero; the source range must be readable and the destination range writable. Overlap is allowed.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_vecInitialBytes = [1, 2, 3, 4];
const g_vecExpectedBytes = [1, 2, 1, 2, 3, 4];
const g_unAllocationByteCount = g_vecExpectedBytes.length;
const g_nDestinationAddressOffset = 2n;
const g_unMovedByteCount = g_vecInitialBytes.length;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const SourceAddress = new Address(g_unAllocationAddress);
	for (const [unIndex, unByteValue] of g_vecInitialBytes.entries()) {
		SourceAddress.SetUChar(unByteValue, BigInt(unIndex));
	}

	const DestinationAddress = SourceAddress.Add(g_nDestinationAddressOffset);
	if (DestinationAddress.MoveFrom(SourceAddress, g_unMovedByteCount) !== true) {
		throw new Error("MoveFrom() returned failure.");
	}

	const vecResultBytes = [];
	for (let unIndex = 0; unIndex < g_unAllocationByteCount; unIndex += 1) {
		vecResultBytes.push(SourceAddress.GetUChar(BigInt(unIndex)));
	}

	let bMatchingResultBytes = true;
	for (let unIndex = 0; unIndex < g_unAllocationByteCount; unIndex += 1) {
		if (vecResultBytes[unIndex] !== g_vecExpectedBytes[unIndex]) {
			bMatchingResultBytes = false;
			break;
		}
	}

	if (!bMatchingResultBytes) {
		throw new Error("MoveFrom() did not preserve overlapping source bytes.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.MoveTo`

`MoveTo(DestinationAddressLike, unByteCount)` copies a positive byte count from this address into the resolved destination with overlap-safe `memmove` semantics and returns `true` after the move. Both addresses must be nonzero; the source range must be readable and the destination range writable. Overlap is allowed.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_vecInitialBytes = [10, 20, 30, 40];
const g_vecExpectedBytes = [10, 20, 10, 20, 30, 40];
const g_unAllocationByteCount = g_vecExpectedBytes.length;
const g_nDestinationAddressOffset = 2n;
const g_unMovedByteCount = g_vecInitialBytes.length;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const SourceAddress = new Address(g_unAllocationAddress);
	for (const [unIndex, unByteValue] of g_vecInitialBytes.entries()) {
		SourceAddress.SetUChar(unByteValue, BigInt(unIndex));
	}

	const DestinationAddress = SourceAddress.Add(g_nDestinationAddressOffset);
	if (SourceAddress.MoveTo(DestinationAddress, g_unMovedByteCount) !== true) {
		throw new Error("MoveTo() returned failure.");
	}

	const vecResultBytes = [];
	for (let unIndex = 0; unIndex < g_unAllocationByteCount; unIndex += 1) {
		vecResultBytes.push(SourceAddress.GetUChar(BigInt(unIndex)));
	}

	let bMatchingResultBytes = true;
	for (let unIndex = 0; unIndex < g_unAllocationByteCount; unIndex += 1) {
		if (vecResultBytes[unIndex] !== g_vecExpectedBytes[unIndex]) {
			bMatchingResultBytes = false;
			break;
		}
	}

	if (!bMatchingResultBytes) {
		throw new Error("MoveTo() did not preserve overlapping source bytes.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.ReadAddress`

`ReadAddress(nAddressOffset = 0n)` reads the native-address value stored at this address plus the signed BigInt byte offset and returns it as a BigInt (`0n` for a null address). The slot must be readable; this method does not dereference the returned address.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_unTargetByteCount = 4;
const g_unAddressSlotByteCount = TYPE_SIZES[DataType.Address];

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unTargetMemoryAddress = 0n;
let g_unAddressSlot = 0n;

try {
	g_unTargetMemoryAddress = Allocate(g_unTargetByteCount);
	if (g_IsInvalidAddress(g_unTargetMemoryAddress)) {
		throw new Error("Allocate() failed to create target storage.");
	}

	g_unAddressSlot = Allocate(g_unAddressSlotByteCount);
	if (g_IsInvalidAddress(g_unAddressSlot)) {
		throw new Error("Allocate() failed to create address-slot storage.");
	}

	const AddressSlot = new Address(g_unAddressSlot).SetAddress(g_unTargetMemoryAddress);
	if (AddressSlot.ReadAddress() !== g_unTargetMemoryAddress) {
		throw new Error("ReadAddress() did not return the stored address.");
	}

	AddressSlot.SetAddress(0n);
	if (AddressSlot.ReadAddress() !== 0n) {
		throw new Error("ReadAddress() did not preserve a null address slot.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unAddressSlot, g_unTargetMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.Reallocate`

`Reallocate(unByteCount)` requires this wrapper to own an allocation and a positive byte count. It uses `realloc`, preserves the old prefix, may move the allocation and update `Address`, and returns this wrapper. Non-owning calls throw. A native allocation failure throws without changing the wrapper's address or ownership state. Do not retain borrowed views across a successful resize: their addresses are not updated and their storage may have been moved or invalidated.

```js
const { Address, Allocate, DataType, Deallocate, GetDataTypeSize } = require("memory");

const g_unInitialByteCount = GetDataTypeSize(DataType.Int);
const g_unResizedByteCount = g_unInitialByteCount * 2;
const g_nExtendedValueOffset = BigInt(g_unInitialByteCount);
const g_nInitialIntegerValue = 123456;
const g_nExtendedIntegerValue = 654321;

const g_vecErrors = [];
let g_AllocationOwner = null;

const g_unAllocationAddress = Allocate(g_unInitialByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	g_AllocationOwner = new Address(g_unAllocationAddress, true);
	if (g_AllocationOwner.Null || !g_AllocationOwner.Owned) {
		throw new Error("Allocate() failed to create an owning Address.");
	}

	g_AllocationOwner.SetInt(g_nInitialIntegerValue);

	const bReallocateReturnedOwner = g_AllocationOwner.Reallocate(g_unResizedByteCount) === g_AllocationOwner;
	const bSetExtendedValueReturnedOwner = g_AllocationOwner.SetInt(g_nExtendedIntegerValue, g_nExtendedValueOffset) === g_AllocationOwner;
	if (!bReallocateReturnedOwner || !bSetExtendedValueReturnedOwner) {
		throw new Error("Reallocate() or SetInt() did not preserve fluent Address access.");
	}

	const bInitialValuePreserved = g_AllocationOwner.GetInt() === g_nInitialIntegerValue;
	const bExtendedValuePreserved = g_AllocationOwner.GetInt(g_nExtendedValueOffset) === g_nExtendedIntegerValue;
	if (!bInitialValuePreserved || !bExtendedValuePreserved) {
		throw new Error("Reallocate() did not preserve and extend the allocation.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		const bMemoryReleased = (g_AllocationOwner === null) ? Deallocate(g_unAllocationAddress) : g_AllocationOwner.Deallocate();
		if (bMemoryReleased !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}

	if (g_AllocationOwner !== null) {
		try {
			if ((g_AllocationOwner.Address !== 0n) || g_AllocationOwner.Owned) {
				throw new Error("Address.Deallocate() retained owning wrapper state.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SearchBytes`

`SearchBytes(BytePattern, unByteCount)` searches the readable range beginning at this address for the first exact byte pattern. `BytePattern` must be a non-empty string (searched as its UTF-8 byte sequence) or a non-empty array of integer bytes from `0` through `255`. Each converted array value must be finite, integral and within that byte range before native narrowing; invalid values are rejected without truncation or wraparound. `unByteCount` must be positive and at least as large as the pattern, and the complete search range must be readable. It returns the matching address as a `bigint`, or `0n` when no match is found.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_vecMemoryBytes = [0x10, 0x20, 0xDE, 0xAD, 0xBE, 0xEF, 0x30, 0x40];
const g_vecSearchPattern = [0xDE, 0xAD, 0xBE, 0xEF];
const g_vecMissingPattern = [0xFF];
const g_unAllocationByteCount = g_vecMemoryBytes.length;
const g_nExpectedMatchOffset = 2n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const AddressValue = new Address(g_unAllocationAddress);
	for (const [unIndex, unByteValue] of g_vecMemoryBytes.entries()) {
		AddressValue.SetUChar(unByteValue, BigInt(unIndex));
	}

	const unMatchAddress = AddressValue.SearchBytes(g_vecSearchPattern, g_unAllocationByteCount);
	const bMatchingAddress = unMatchAddress === (g_unAllocationAddress + g_nExpectedMatchOffset);
	const bNoMatchReturnsZeroAddress = AddressValue.SearchBytes(g_vecMissingPattern, g_unAllocationByteCount) === 0n;
	if (!bMatchingAddress || !bNoMatchReturnsZeroAddress) {
		throw new Error("SearchBytes() returned an unexpected address.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetBool`

`SetBool(bBooleanValue, nAddressOffset = 0n)` writes one strict JavaScript boolean at the signed BigInt byte offset and returns the same `Address` for chaining.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nBooleanOffset = 1n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const BooleanAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = BooleanAddress.SetBool(true, g_nBooleanOffset) === BooleanAddress;
	const bBooleanWritten = BooleanAddress.GetBool(g_nBooleanOffset) === true;
	if (!bReturnedReceiver || !bBooleanWritten) {
		throw new Error("SetBool() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetChar`

`SetChar(nCharacterValue, nAddressOffset = 0n)` writes one native `char` at the signed BigInt byte offset and returns the same `Address` for chaining. The native binding requires signed 8-bit `char`; supply an integer Number from `-128` through `127`. The converted numeric value is checked for finiteness, integrality and that range before native narrowing or writing.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nCharacterOffset = 1n;
const g_nExpectedCharacterValue = 12;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const CharacterAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = CharacterAddress.SetChar(g_nExpectedCharacterValue, g_nCharacterOffset) === CharacterAddress;
	const bCharacterWritten = CharacterAddress.GetChar(g_nCharacterOffset) === g_nExpectedCharacterValue;
	if (!bReturnedReceiver || !bCharacterWritten) {
		throw new Error("SetChar() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetDouble`

`SetDouble(dblDoubleValue, nAddressOffset = 0n)` writes a finite IEEE-754 double at the signed BigInt byte offset and returns the same `Address` for chaining.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 16;
const g_nDoubleOffset = 8n;
const g_dblExpectedDoubleValue = Math.PI;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const DoubleAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = DoubleAddress.SetDouble(g_dblExpectedDoubleValue, g_nDoubleOffset) === DoubleAddress;
	const bDoubleWritten = DoubleAddress.GetDouble(g_nDoubleOffset) === g_dblExpectedDoubleValue;
	if (!bReturnedReceiver || !bDoubleWritten) {
		throw new Error("SetDouble() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetFloat`

`SetFloat(flFloatValue, nAddressOffset = 0n)` writes a finite single-precision value at the signed BigInt byte offset and returns the same `Address` for chaining.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nFloatOffset = 4n;
const g_flExpectedFloatValue = 1.25;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const FloatAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = FloatAddress.SetFloat(g_flExpectedFloatValue, g_nFloatOffset) === FloatAddress;
	const bFloatWritten = FloatAddress.GetFloat(g_nFloatOffset) === g_flExpectedFloatValue;
	if (!bReturnedReceiver || !bFloatWritten) {
		throw new Error("SetFloat() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetInt`

`SetInt(nIntegerValue, nAddressOffset = 0n)` writes a signed 32-bit integer at the signed BigInt byte offset and returns the same `Address` for chaining. Supply an integer Number from `-2147483648` through `2147483647`. The converted numeric value must be finite, integral and in range before native narrowing or writing; invalid values are rejected rather than truncated or wrapped.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nIntegerOffset = 4n;
const g_nExpectedIntegerValue = -123456;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const IntegerAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = IntegerAddress.SetInt(g_nExpectedIntegerValue, g_nIntegerOffset) === IntegerAddress;
	const bIntegerWritten = IntegerAddress.GetInt(g_nIntegerOffset) === g_nExpectedIntegerValue;
	if (!bReturnedReceiver || !bIntegerWritten) {
		throw new Error("SetInt() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetLong`

`SetLong(nLongValue, nAddressOffset = 0n)` writes a signed C `long` at the signed BigInt byte offset and returns the same `Address` for chaining. Use a BigInt when `sizeof(long) > sizeof(int)`; the native 64-bit branch validates its range. Otherwise, supply an in-range signed 32-bit integer Number; the converted numeric value must be finite, integral and in range before writing, without truncation or wraparound. Width follows the compiled platform.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_nExpectedLongValue = (TYPE_SIZES[DataType.Long] > TYPE_SIZES[DataType.Int]) ? -5_000_000_000n : -2000;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(TYPE_SIZES[DataType.Long]);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const LongAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = LongAddress.SetLong(g_nExpectedLongValue) === LongAddress;
	const bLongWritten = LongAddress.GetLong() === g_nExpectedLongValue;
	if (!bReturnedReceiver || !bLongWritten) {
		throw new Error("SetLong() did not preserve the selected-platform value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetLongLong`

`SetLongLong(nLongLongValue, nAddressOffset = 0n)` writes a signed 64-bit `BigInt` at the signed BigInt byte offset and returns the same `Address` for chaining.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_nExpectedLongLongValue = -1234567890123n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const LongLongAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = LongLongAddress.SetLongLong(g_nExpectedLongLongValue) === LongLongAddress;
	const bLongLongWritten = LongLongAddress.GetLongLong() === g_nExpectedLongLongValue;
	if (!bReturnedReceiver || !bLongLongWritten) {
		throw new Error("SetLongLong() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetAddress`

`SetAddress(AddressLike, nAddressOffset = 0n)` writes the BigInt address represented by `AddressLike` into an address-sized slot at the signed BigInt byte offset and returns the same `Address` for chaining. It does not transfer ownership of the addressed allocation.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_unTargetByteCount = 4;

const g_IsInvalidAddress = (unAddress) => (typeof unAddress !== "bigint") || (unAddress <= 0n);
const g_vecErrors = [];
let g_unTargetMemoryAddress = 0n;
let g_unAddressSlot = 0n;

try {
	g_unTargetMemoryAddress = Allocate(g_unTargetByteCount);
	if (g_IsInvalidAddress(g_unTargetMemoryAddress)) {
		throw new Error("Allocate() failed to create target storage.");
	}

	g_unAddressSlot = Allocate(TYPE_SIZES[DataType.Address]);
	if (g_IsInvalidAddress(g_unAddressSlot)) {
		throw new Error("Allocate() failed to create address-slot storage.");
	}

	const AddressSlot = new Address(g_unAddressSlot);
	const bReturnedReceiver = AddressSlot.SetAddress(g_unTargetMemoryAddress) === AddressSlot;
	const bAddressWritten = AddressSlot.ReadAddress() === g_unTargetMemoryAddress;
	if (!bReturnedReceiver || !bAddressWritten) {
		throw new Error("SetAddress() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	for (const unAddress of [g_unAddressSlot, g_unTargetMemoryAddress]) {
		if (g_IsInvalidAddress(unAddress)) {
			continue;
		}

		try {
			if (Deallocate(unAddress) !== true) {
				throw new Error("Deallocate() failed to release the Address allocation.");
			}
		} catch (CaughtError) {
			g_vecErrors.push(CaughtError);
		}
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetProtection`

`SetProtection(MemoryProtection, unByteCount)` requests a protection change for the positive, non-overflowing range beginning at this address. `MemoryProtection` accepts a Number mode or one of the string codes `""`, `"R"`, `"RW"`, `"X"`, `"RX"`, and `"RWX"`. Supply an integer Number from `0` through `5`; the native Number path rejects nonfinite, fractional and out-of-range modes before converting to the native selector. The address must be nonzero. Its boolean result reports whether the OS protection call succeeded; it neither returns the previous mode nor indicates whether the requested flags differed from it. Protection applies to whole OS pages, including bytes outside the requested range that share those pages. Do not make ordinary heap-allocation pages unreadable or unwritable: unrelated allocations and allocator metadata can share them. The example keeps its allocation read/write.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 16;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const AddressValue = new Address(g_unAllocationAddress);
	if (AddressValue.SetProtection("RW", g_unAllocationByteCount) !== true) {
		throw new Error("SetProtection() could not change the allocation protection.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetShort`

`SetShort(nShortValue, nAddressOffset = 0n)` writes a signed 16-bit integer at the signed BigInt byte offset and returns the same `Address` for chaining. Supply an integer Number from `-32768` through `32767`; the converted numeric value must be finite, integral and in range before native narrowing or writing.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_nShortOffset = 2n;
const g_nExpectedShortValue = -32000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const ShortAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = ShortAddress.SetShort(g_nExpectedShortValue, g_nShortOffset) === ShortAddress;
	const bShortWritten = ShortAddress.GetShort(g_nShortOffset) === g_nExpectedShortValue;
	if (!bReturnedReceiver || !bShortWritten) {
		throw new Error("SetShort() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetUChar`

`SetUChar(unByteValue, nAddressOffset = 0n)` writes one unsigned 8-bit value at the signed BigInt byte offset and returns the same `Address` for chaining. Supply an integer Number from `0` through `255`; the converted numeric value must be finite, integral and in range before native narrowing or writing.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 2;
const g_nByteOffset = 1n;
const g_unExpectedByteValue = 250;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const ByteAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = ByteAddress.SetUChar(g_unExpectedByteValue, g_nByteOffset) === ByteAddress;
	const bByteWritten = ByteAddress.GetUChar(g_nByteOffset) === g_unExpectedByteValue;
	if (!bReturnedReceiver || !bByteWritten) {
		throw new Error("SetUChar() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetUInt`

`SetUInt(unIntegerValue, nAddressOffset = 0n)` writes an unsigned 32-bit integer at the signed BigInt byte offset and returns the same `Address` for chaining. Supply an integer Number from `0` through `0xFFFFFFFF`; the converted numeric value must be finite, integral and in range before native narrowing or writing, without truncation or wraparound.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_unExpectedIntegerValue = 4_000_000_000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const IntegerAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = IntegerAddress.SetUInt(g_unExpectedIntegerValue) === IntegerAddress;
	const bIntegerWritten = IntegerAddress.GetUInt() === g_unExpectedIntegerValue;
	if (!bReturnedReceiver || !bIntegerWritten) {
		throw new Error("SetUInt() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetULong`

`SetULong(unLongValue, nAddressOffset = 0n)` writes an unsigned C `long` at the signed BigInt byte offset and returns the same `Address` for chaining. Use an in-range unsigned BigInt when `sizeof(unsigned long) > sizeof(unsigned int)`; otherwise, supply an integer Number from `0` through `0xFFFFFFFF`. The 32-bit native branch checks the converted numeric value for finiteness, integrality and range before writing, without truncation or wraparound. Width follows the compiled platform.

```js
const { Address, Allocate, DataType, Deallocate, TYPE_SIZES } = require("memory");

const g_unExpectedUnsignedLongValue = (TYPE_SIZES[DataType.ULong] > TYPE_SIZES[DataType.UInt]) ? 5_000_000_000n : 3_000_000_000;
const g_vecErrors = [];
const g_unAllocationAddress = Allocate(TYPE_SIZES[DataType.ULong]);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedLongAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = UnsignedLongAddress.SetULong(g_unExpectedUnsignedLongValue) === UnsignedLongAddress;
	const bUnsignedLongWritten = UnsignedLongAddress.GetULong() === g_unExpectedUnsignedLongValue;
	if (!bReturnedReceiver || !bUnsignedLongWritten) {
		throw new Error("SetULong() did not preserve the selected-platform value.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetULongLong`

`SetULongLong(unLongLongValue, nAddressOffset = 0n)` writes an unsigned 64-bit `BigInt` at the signed BigInt byte offset and returns the same `Address` for chaining.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;
const g_unExpectedLongLongValue = 12_345_678_901_234n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedLongLongAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = UnsignedLongLongAddress.SetULongLong(g_unExpectedLongLongValue) === UnsignedLongLongAddress;
	const bUnsignedLongLongWritten = UnsignedLongLongAddress.GetULongLong() === g_unExpectedLongLongValue;
	if (!bReturnedReceiver || !bUnsignedLongLongWritten) {
		throw new Error("SetULongLong() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.SetUShort`

`SetUShort(unShortValue, nAddressOffset = 0n)` writes an unsigned 16-bit integer at the signed BigInt byte offset and returns the same `Address` for chaining. Supply an integer Number from `0` through `65535`; the converted numeric value must be finite, integral and in range before native narrowing or writing.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 4;
const g_nShortOffset = 2n;
const g_unExpectedShortValue = 65000;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const UnsignedShortAddress = new Address(g_unAllocationAddress);
	const bReturnedReceiver = UnsignedShortAddress.SetUShort(g_unExpectedShortValue, g_nShortOffset) === UnsignedShortAddress;
	const bUnsignedShortWritten = UnsignedShortAddress.GetUShort(g_nShortOffset) === g_unExpectedShortValue;
	if (!bReturnedReceiver || !bUnsignedShortWritten) {
		throw new Error("SetUShort() did not write or return its receiver.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

### `Address.Subtract`

`Subtract(nAddressOffset)` returns a new non-owning `Address` whose BigInt value is this address minus the signed BigInt offset; the original wrapper and its ownership state remain unchanged. It throws if the result would underflow or overflow the address range.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 16;
const g_nTailAddressOffset = 12n;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

try {
	const TailAddress = new Address(g_unAllocationAddress + g_nTailAddressOffset);
	const BeginningAddress = TailAddress.Subtract(g_nTailAddressOffset);
	const bMatchingBeginningAddress = BeginningAddress.Address === g_unAllocationAddress;
	const bUnchangedTailAddress = TailAddress.Address === (g_unAllocationAddress + g_nTailAddressOffset);
	const bNonOwningResult = !BeginningAddress.Owned;
	if (!bMatchingBeginningAddress || !bUnchangedTailAddress || !bNonOwningResult) {
		throw new Error("Subtract() returned an unexpected Address.");
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

## Errors and lifecycle

- Native addresses are represented as non-negative JavaScript `BigInt` values; raw address parameters reject numbers and strings. `GetObjectAddress()` returns the BigInt address of an address-backed object and returns `0n` for `null` or `undefined`.
- Only the owner of memory returned by `Allocate()`, `Reallocate()`, or `AllocateObject()` may release or resize it. Borrowed engine and binary memory must not be passed to those ownership operations.
- `Address.Deallocate()` and `Address.Reallocate()` reject a falsy `Owned` flag. Keep the writable flag boolean; setting it does not establish ownership. Non-owning engine and binary views must never claim ownership.
- A successful `Address.Reallocate()` may move the allocation and updates its owning wrapper's BigInt `Address`; the root `Reallocate()` instead returns the new BigInt address for its caller to retain. Cached old addresses and other wrappers referring to the former location become stale.
- Built-in registered object views and address-arithmetic wrappers are non-owning. Custom `CreateFromAddress()` factories must honor that contract; `MakeObject()` delegates to the factory without enforcing ownership. Such views must not outlive their native storage.
- Function and hidden-context addresses use `BigInt`; virtual-table slots, calling conventions, argument types, and return types must match the selected binary exactly.
- The compiled scalar-write contract requires signed 8-bit `char`, unsigned 8-bit `unsigned char`, and signed 16-bit `short`. Float writes reject non-finite or out-of-range values before single-precision conversion; double writes reject non-finite values.
- Number-based integer setter paths validate the converted Number for finiteness, integrality and the native target range before narrowing or writing; invalid values are rejected without truncation or wraparound. Valid numeric conversions preserve their existing behavior and original JavaScript exceptions. BigInt address and 64-bit integer requirements and strict boolean checks remain separate contracts.
- Page protection must be restored explicitly because `SetProtection()` returns only success and does not report the previous mode.
- Native argument validation reports `Error`, not a guaranteed `TypeError`; JavaScript-only guards may throw more specific errors. The following example accepts `Error` instances, preserves unexpected thrown values, and reports cleanup failures without hiding the primary failure.

```js
const { Address, Allocate, Deallocate } = require("memory");

const g_unAllocationByteCount = 8;

const g_vecErrors = [];
const g_unAllocationAddress = Allocate(g_unAllocationByteCount);
if ((typeof g_unAllocationAddress !== "bigint") || (g_unAllocationAddress <= 0n)) {
	throw new Error("Allocate() returned an invalid address.");
}

function CreateInvalidAddress() {
	return new Address("0x1234");
}

function CallNonOwningAddressReallocate() {
	return new Address(g_unAllocationAddress).Reallocate(g_unAllocationByteCount);
}

function CallInvalidSetBool() {
	return new Address(g_unAllocationAddress).SetBool(1);
}

try {
	const vecInvalidOperations = [CreateInvalidAddress, CallNonOwningAddressReallocate, CallInvalidSetBool];
	for (const Operation of vecInvalidOperations) {
		let bThrown = false;
		let CaughtValue;

		try {
			Operation();
		} catch (CaughtError) {
			bThrown = true;
			CaughtValue = CaughtError;
		}

		if (!bThrown) {
			throw new Error("Invalid memory operation did not throw an Error.");
		}

		if (!(CaughtValue instanceof Error)) {
			throw CaughtValue;
		}
	}
} catch (CaughtError) {
	g_vecErrors.push(CaughtError);
} finally {
	try {
		if (Deallocate(g_unAllocationAddress) !== true) {
			throw new Error("Deallocate() failed to release the Address allocation.");
		}
	} catch (CaughtError) {
		g_vecErrors.push(CaughtError);
	}
}

if (g_vecErrors.length === 1) {
	throw g_vecErrors[0];
}

if (g_vecErrors.length > 1) {
	throw new AggregateError(g_vecErrors, "Address operation and cleanup failed.");
}
```

## Address-backed QAngle examples

An address-backed mathlib object is created with:

```js
const {
	AllocateObject,
	MakeObject,
	Deallocate,
} = require("memory");
const { ReadFloat } = require("memory/helpers");
const { QAngle } = require("mathlib");

const unAddress = AllocateObject(QAngle);
try {
	const Angle = MakeObject(QAngle, unAddress);
	Angle.X = 90;
	Angle.Y = 15;
	Angle.Z = 0;

	if (ReadFloat(unAddress) !== 90) {
		throw new Error("QAngle did not write through to native memory.");
	}
} finally {
	if (!Deallocate(unAddress)) {
		throw new Error("The QAngle allocation was not released.");
	}
}
```

Every registered address-backed type reports its byte size through
`ObjectTypeSize(ObjectTypeValue)`. `AllocateObject(ObjectTypeValue)` allocates
memory for that type.
`CopyObjectToAddress()` accepts address-backed or detached values, while
`CopyAddressToObject()` returns a live view or copies into an existing
address-backed target:

```js
const {
	AllocateObject,
	CopyObjectToAddress,
	CopyAddressToObject,
	Deallocate,
	GetObjectAddress,
	MakeObject,
} = require("memory");
const { QAngle } = require("mathlib");

const unSourceAddress = AllocateObject(QAngle);
try {
	const unTargetAddress = AllocateObject(QAngle);
	try {
		const Angle = MakeObject(QAngle, unSourceAddress);
		Angle.X = 15;
		Angle.Y = 30;
		Angle.Z = 45;

		if (GetObjectAddress(Angle) !== unSourceAddress) {
			throw new Error("QAngle address identity changed.");
		}

		if (CopyObjectToAddress(Angle, unTargetAddress) !== unTargetAddress) {
			throw new Error("QAngle copy returned a different target address.");
		}

		const CopiedAngle = CopyAddressToObject(unTargetAddress, QAngle);
		if (!CopiedAngle.IsMathStructureEqual(Angle)) {
			throw new Error("QAngle copy did not preserve its components.");
		}
	} finally {
		if (!Deallocate(unTargetAddress)) {
			throw new Error("The target QAngle allocation was not released.");
		}
	}
} finally {
	if (!Deallocate(unSourceAddress)) {
		throw new Error("The source QAngle allocation was not released.");
	}
}
```
