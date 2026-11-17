#!/usr/bin/env node

"use strict";

const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strColorsPath = g_Path.join(g_strPackageRoot, "colors.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strMemoryPath = g_Path.join(g_strPackageRoot, "memory.js");
const g_strMemoryHelpersPath = g_Path.join(g_strPackageRoot, "memory", "helpers.js");

process.env.NODE_PATH = [g_strPackageRoot, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const g_unDefaultNativeAddressBitCount = 64;
const g_unOffsetBitCount = 64;
const g_unOffsetSignBit = 1n << BigInt(g_unOffsetBitCount - 1);
const g_unAllocationAddressGap = 0x100n;
const g_unMaximumByteValue = 0xFF;

const g_mapAllocations = new Map();
const g_mapObjectTypes = new Map();
let g_unNextAddress = 0x2000n;
let g_unNativeAddressBitCount = g_unDefaultNativeAddressBitCount;
let g_unAddressAdditionCount = 0;

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

function AssertArray(vecActualValues, vecExpectedValues, strErrorMessage) {
	AssertEqual(JSON.stringify(vecActualValues), JSON.stringify(vecExpectedValues), strErrorMessage);
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

function RequireAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress <= 0n) || (BigInt.asUintN(g_unNativeAddressBitCount, unAddress) !== unAddress)) {
		throw new TypeError("Address must be a positive BigInt within the native address width.");
	}

	return unAddress;
}

function Allocate(unByteCount) {
	if (!Number.isSafeInteger(unByteCount) || (unByteCount <= 0)) {
		throw new TypeError("Allocation size must be a positive safe integer.");
	}

	const unAddress = g_unNextAddress;
	g_unNextAddress += BigInt(unByteCount) + g_unAllocationAddressGap;
	g_mapAllocations.set(unAddress, Buffer.alloc(unByteCount));

	return unAddress;
}

function GetMemoryView(unAddress) {
	const unSelectedAddress = RequireAddress(unAddress);
	for (const [unBaseAddress, arrAllocationBytes] of g_mapAllocations) {
		const unOffset = unSelectedAddress - unBaseAddress;
		if ((unOffset >= 0n) && (unOffset < BigInt(arrAllocationBytes.length))) {
			return { Buffer: arrAllocationBytes, Offset: Number(unOffset) };
		}
	}

	throw new RangeError(`Address is not allocated: ${unSelectedAddress}`);
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

InstallDependency(g_strRuntimePath, require(g_strRuntimePath));

const g_MemoryHelpers = {
	Add(unAddress, nAddressOffset) {
		++g_unAddressAdditionCount;

		if ((typeof nAddressOffset !== "bigint") || (BigInt.asIntN(g_unOffsetBitCount, nAddressOffset) !== nAddressOffset)) {
			throw new TypeError("Address offset must be a signed 64-bit BigInt.");
		}

		const unResultAddress = RequireAddress(unAddress) + nAddressOffset;
		if ((unResultAddress < 0n) || (BigInt.asUintN(g_unNativeAddressBitCount, unResultAddress) !== unResultAddress)) {
			throw new RangeError("Address arithmetic overflowed.");
		}

		return unResultAddress;
	},
	IsNull(unAddress) {
		return unAddress === 0n;
	},
	Read(unAddress, strDataType, nAddressOffset = 0n) {
		if ((strDataType !== "uchar") || (typeof nAddressOffset !== "bigint")) {
			throw new TypeError("Color reads require uchar and a BigInt offset.");
		}

		const View = GetMemoryView(RequireAddress(unAddress) + nAddressOffset);

		return View.Buffer.readUInt8(View.Offset);
	},
	Write(unAddress, strDataType, unValue, nAddressOffset = 0n) {
		if ((strDataType !== "uchar") || !Number.isInteger(unValue) || (unValue < 0) || (unValue > g_unMaximumByteValue) || (typeof nAddressOffset !== "bigint")) {
			throw new TypeError("Color writes require a byte and a BigInt offset.");
		}

		const View = GetMemoryView(RequireAddress(unAddress) + nAddressOffset);
		View.Buffer.writeUInt8(unValue, View.Offset);

		return true;
	},
};

const g_Memory = {
	AllocateObject(Type) {
		return Allocate(this.ObjectTypeSize(Type));
	},
	CopyObjectToAddress(Value, unAddress) {
		const Target = Value.constructor.CreateColorFromAddress(RequireAddress(unAddress));
		Target.CopyColorFrom(Value);

		return unAddress;
	},
	CopyAddressToObject(unAddress, Type) {
		return Type.CreateColorFromAddress(RequireAddress(unAddress)).CopyColor();
	},
	MakeObject(Type, unAddress) {
		return Type.CreateColorFromAddress(RequireAddress(unAddress));
	},
	ObjectType(strName) {
		return g_mapObjectTypes.get(strName)?.Type ?? null;
	},
	ObjectTypeSize(Type) {
		for (const ObjectTypeRecord of g_mapObjectTypes.values()) {
			if (ObjectTypeRecord.Type === Type) {
				return ObjectTypeRecord.Size;
			}
		}

		throw new Error("Object type is not registered.");
	},
	RegisterObjectType(strName, Type, TypeOptions = {}) {
		const unByteCount = TypeOptions.Size;
		if ((typeof strName !== "string") || (typeof Type !== "function") || !Number.isSafeInteger(unByteCount) || (unByteCount <= 0)) {
			throw new TypeError("Invalid object type registration.");
		}

		g_mapObjectTypes.set(strName, { Size: unByteCount, Type });

		return Type;
	},
};

InstallDependency(g_strMemoryPath, g_Memory);
InstallDependency(g_strMemoryHelpersPath, g_MemoryHelpers);

globalThis.sourcejs = {
	colors: {
		CreateRGBAColor(unRed, unGreen, unBlue, unAlpha) {
			return { Alpha: unAlpha, Blue: unBlue, Green: unGreen, Red: unRed };
		},
	},
};

function CheckColorCopyContracts(Colors) {
	let unScenarios = 0;
	try {
		for (const unAddressBitCount of [32, 64]) {
			g_unNativeAddressBitCount = unAddressBitCount;
			for (const nShift of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
				for (const strMethod of ["CopyColorFrom", "CopyColorTo"]) {
					const unAddress = Allocate(12);
					try {
						const arrMemory = g_mapAllocations.get(unAddress);
						const vecInitial = Array.from(arrMemory.keys(), (unIndex) => unIndex + 1);
						arrMemory.set(vecInitial);
						const unSourceOffset = 4;
						const unTargetOffset = unSourceOffset + nShift;
						const vecExpected = [...vecInitial];
						vecExpected.splice(unTargetOffset, Colors.COLOR_SIZE, ...vecInitial.slice(unSourceOffset, unSourceOffset + Colors.COLOR_SIZE));
						const Source = Colors.Color.CreateColorFromAddress(unAddress, BigInt(unSourceOffset));
						const Target = Colors.Color.CreateColorFromAddress(unAddress, BigInt(unTargetOffset));
						const Result = (strMethod === "CopyColorFrom") ? Target.CopyColorFrom(Source) : Source.CopyColorTo(Target);
						AssertEqual(Result, Target, "copy should return the destination");
						AssertArray(Array.from(arrMemory), vecExpected, "overlapping color copies must snapshot source channels");
						unScenarios++;
					} finally {
						g_mapAllocations.delete(unAddress);
					}
				}
			}
		}
	} finally {
		g_unNativeAddressBitCount = g_unDefaultNativeAddressBitCount;
	}

	class FailingColor extends Colors.Color {
		constructor(Failure, unFailureIndex, bFailReads) {
			super(5, 6, 7, 8);
			this.m_Failure = Failure;
			this.m_unFailureIndex = unFailureIndex;
			this.m_bFailReads = bFailReads;
		}

		GetColorChannel(unIndex) {
			if (this.m_bFailReads && (unIndex === this.m_unFailureIndex)) {
				throw this.m_Failure;
			}

			return super.GetColorChannel(unIndex);
		}

		SetColorChannel(unIndex, unComponent) {
			if (!this.m_bFailReads && (unIndex === this.m_unFailureIndex)) {
				throw this.m_Failure;
			}

			return super.SetColorChannel(unIndex, unComponent);
		}
	}

	const vecFailures = [undefined, null, false, 0, -0, 0n, "", NaN, Object.create(null), new Error("copy failure")];
	for (const Failure of vecFailures) {
		for (let unFailureIndex = 0; unFailureIndex < Colors.COLOR_SIZE; ++unFailureIndex) {
			for (const strMethod of ["CopyColorFrom", "CopyColorTo"]) {
				for (const bFailReads of [false, true]) {
					const Source = bFailReads ? new FailingColor(Failure, unFailureIndex, true) : new Colors.Color(11, 22, 33, 44);
					const Target = bFailReads ? new Colors.Color(5, 6, 7, 8) : new FailingColor(Failure, unFailureIndex, false);
					let bCaught = false;
					try {
						if (strMethod === "CopyColorFrom") {
							Target.CopyColorFrom(Source);
						} else {
							Source.CopyColorTo(Target);
						}
					} catch (Exception) {
						Assert(Object.is(Exception, Failure), "copy must preserve the exact thrown value");
						bCaught = true;
					}

					Assert(bCaught, "copy must propagate read/write failures");
					const vecExpected = [5, 6, 7, 8];
					if (!bFailReads) {
						for (let unIndex = 0; unIndex < unFailureIndex; ++unIndex) {
							vecExpected[unIndex] = (unIndex + 1) * 11;
						}
					}

					AssertArray(Target.ConvertColorToArray(), vecExpected, "source failures must not write;destination failures retain prior writes");
					unScenarios++;
				}
			}
		}
	}

	AssertEqual(unScenarios, 196, "copy profile count");
	console.log("Color copy 196 overlap/read-write-failure profiles passed (32/64-bit address models;no native IO).");
}

try {
	const Colors = require(g_strColorsPath);
	AssertEqual(Colors.COLOR_SIZE, 4, "COLOR_SIZE");
	AssertEqual(g_Memory.ObjectType("Color"), Colors.Color, "Color object type registration");
	AssertEqual(g_Memory.ObjectTypeSize(Colors.Color), Colors.COLOR_SIZE, "Color object type size");
	AssertEqual(Object.hasOwn(Colors, "ModuleName"), false, "colors should not expose ModuleName");

	AssertArray(Colors.CreateRGBAColor(1, 2, 3, 4).ConvertColorToArray(), [1, 2, 3, 4], "CreateRGBAColor native route");

	const ClampedColor = new Colors.Color(300, -5, 1.9, 255);
	AssertArray(ClampedColor.ConvertColorToArray(), [255, 0, 1, 255], "Color constructor byte clamping");
	AssertThrows(() => new Colors.Color(Number.NaN, 0, 0, 255), "Color should reject non-finite components");
	AssertThrows(() => new Colors.Color("1", 0, 0, 255), "Color should reject scalar coercion");
	AssertThrows(() => Colors.Color.CreateColorFromAddress(0x2000), "Color should reject Number addresses");
	AssertThrows(() => Colors.Color.CreateColorFromAddress(0x2000n, 1), "Color should reject Number offsets");

	const unAddressAdditionCountBeforeCreation = g_unAddressAdditionCount;
	AssertEqual(Colors.Color.CreateColorFromAddress(0x2000n).GetColorAddress(), 0x2000n, "zero-offset color address identity");
	AssertEqual(g_unAddressAdditionCount, unAddressAdditionCountBeforeCreation + 1, "zero-offset colors must use checked native address arithmetic");

	for (const InvalidAddress of [null, undefined, 0n, -1n, 0, 0x2000, "8192", {}]) {
		AssertThrows(() => Colors.Color.CreateColorFromAddress(InvalidAddress), "address factory must not silently create a detached color");
	}

	try {
		for (const unAddressBitCount of [32, 64]) {
			g_unNativeAddressBitCount = unAddressBitCount;
			const unMaximumAddress = (1n << BigInt(unAddressBitCount)) - 1n;
			AssertEqual(Colors.Color.CreateColorFromAddress(unMaximumAddress).GetColorAddress(), unMaximumAddress, "maximum-width address must remain exact");
			AssertThrows(() => Colors.Color.CreateColorFromAddress(unMaximumAddress + 1n), "zero offset must not bypass native address-width validation");
			AssertThrows(() => new Colors.Color(1, 2, 3, 4, unMaximumAddress + 1n), "constructor must validate the native address width");
			AssertThrows(() => Colors.Color.CreateColorFromAddress(unMaximumAddress, 1n), "address addition must not overflow native width");
			AssertThrows(() => Colors.Color.CreateColorFromAddress(1n, -1n), "address offset must not silently select detached storage");
			AssertThrows(() => new Colors.Color(1, 2, 3, 4, 1n, -1n), "constructor must reject an offset producing a null address");
			AssertThrows(() => Colors.Color.CreateColorFromAddress(1n, -2n), "address subtraction must not underflow");

			for (const nInvalidOffset of [g_unOffsetSignBit, -g_unOffsetSignBit - 1n]) {
				AssertThrows(() => Colors.Color.CreateColorFromAddress(1n, nInvalidOffset), "color offsets must fit signed 64-bit storage");
			}
		}

		AssertEqual(Colors.Color.CreateColorFromAddress(g_unOffsetSignBit + 1n, -g_unOffsetSignBit).GetColorAddress(), 1n, "minimum signed offset must remain exact");
		AssertEqual(Colors.Color.CreateColorFromAddress(1n, g_unOffsetSignBit - 1n).GetColorAddress(), g_unOffsetSignBit, "maximum signed offset must remain exact");
	} finally {
		g_unNativeAddressBitCount = g_unDefaultNativeAddressBitCount;
	}

	ClampedColor.SetColorChannel(0, 12).SetColorChannel(1, 34).SetColorChannel(2, 56).SetColorChannel(3, 78);
	AssertArray([...ClampedColor], [12, 34, 56, 78], "Color iteration");
	AssertEqual(ClampedColor.ConvertColorToHexString(), "\x080C22384E", "Color alpha hex string");
	AssertEqual(ClampedColor.CreateColorWithAlpha(255).ConvertColorToHexString(), "\x070C2238", "Color opaque hex string");
	AssertEqual(ClampedColor.DoesColorEqual([12, 34, 56, 78]), true, "Color array equality");
	AssertArray(ClampedColor.CopyColor().ConvertColorToArray(), [12, 34, 56, 78], "Color Copy");
	AssertArray(Colors.Color.CreateColorFromValue(new Uint8Array([1, 2, 3, 4])).ConvertColorToArray(), [1, 2, 3, 4], "Color typed-array factory");

	const CopiedColor = new Colors.Color();
	ClampedColor.CopyColorTo(CopiedColor);
	AssertArray(CopiedColor.ConvertColorToArray(), [12, 34, 56, 78], "Color CopyTo");
	CopiedColor.CopyColorFrom({ Alpha: 6, Blue: 7, Green: 8, Red: 9 });
	AssertArray(CopiedColor.ConvertColorToArray(), [9, 8, 7, 6], "Color CopyFrom full fields");

	const unColorAddress = Allocate(Colors.COLOR_SIZE);
	const AddressColor = Colors.Color.CreateColorFromAddress(unColorAddress);
	AddressColor.Red = 10;
	AddressColor.Green = 20;
	AddressColor.Blue = 30;
	AddressColor.Alpha = 40;
	AssertArray(AddressColor.ConvertColorToArray(), [10, 20, 30, 40], "address-backed Color write-through");
	AssertEqual(AddressColor.GetColorAddress(), unColorAddress, "Color numeric address");
	AssertEqual(AddressColor.HasColorAddress(), true, "Color address state");

	const unManagedAddress = g_Memory.AllocateObject(Colors.Color);
	const ManagedColor = g_Memory.MakeObject(Colors.Color, unManagedAddress);
	ManagedColor.CopyColorFrom(new Uint8Array([90, 91, 92, 93]));
	AssertArray(ManagedColor.ConvertColorToArray(), [90, 91, 92, 93], "memory.MakeObject Color write-through");

	const unCopiedAddress = g_Memory.AllocateObject(Colors.Color);
	g_Memory.CopyObjectToAddress(ManagedColor, unCopiedAddress);
	AssertArray(g_Memory.CopyAddressToObject(unCopiedAddress, Colors.Color).ConvertColorToArray(), [90, 91, 92, 93], "Color address copy");
	AssertArray(Colors.RED.ConvertColorToArray(), [255, 0, 0, 255], "RED constant");
	AssertArray(Colors.BLACK.ConvertColorToArray(), [0, 0, 0, 255], "BLACK constant");
	Assert(Object.isFrozen(Colors.WHITE), "palette colors should be frozen");
	AssertEqual(typeof ManagedColor.toJSON, "undefined", "Color should not expose a snapshot serializer");

	CheckColorCopyContracts(Colors);
	console.log("[smoke_colors] ok");
} finally {
	delete globalThis.sourcejs;
}
