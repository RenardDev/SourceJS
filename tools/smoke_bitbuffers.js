#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");
const g_Module = require("node:module");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strBitBuffersPath = g_Path.join(g_strPackageRoot, "bitbuffers.js");

process.env.NODE_PATH = [g_strPackageRoot, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const { InstallBitBuffersMock } = require("./native_bitbuffers_mock.js");
const g_NativeBitBuffers = InstallBitBuffersMock();

const g_BitBuffers = require(g_strBitBuffersPath);
const g_unBitsPerByte = 8;
const g_unWordByteCount = 2;
const g_unWordBitCount = g_unWordByteCount * g_unBitsPerByte;
const g_unLongByteCount = 4;
const g_unLongBitCount = g_unLongByteCount * g_unBitsPerByte;
const g_unPaddedReadByteCount = 8;
const g_unScratchBufferByteCount = 16;
const g_unSequenceBufferByteCount = 128;
const g_unMaximumStringByteCount = 4096;
const g_unVectorComponentCount = 3;
const g_unByteMask = 0xFF;
const g_unByteMaskBigInt = 0xFFn;
const g_unMaximumVarintByteCount = 5;
const g_unVarintPayloadMask = 0x7F;
const g_unVarintFinalPayloadMask = 0x0F;
const g_unVarintFinalPayloadShift = 28;
const g_unWordSignBit = 0x8000;
const g_unWordModulus = 0x10000;
const g_unVariableSmallLimit = 16;
const g_unVariableMediumLimit = 256;
const g_unVariableLargeLimit = 4096;
const g_unVariableSelectorBitCount = 2;
const g_unVariableSelectorBitShift = 2n;
const g_vecVariablePayloadBitCounts = [4, 8, 12, 32];
const g_flHalfTurnDegrees = 180;
const g_flFloatEpsilon = 0.00001;
const g_flCoordinateEpsilon = 0.03125;
const g_flLowPrecisionCoordinateEpsilon = 0.125;
const g_flNormalEpsilon = 0.001;

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertNear(flActualValue, flExpectedValue, flEpsilon, strErrorMessage) {
	if (!Number.isFinite(flActualValue) || !Number.isFinite(flExpectedValue) || !Number.isFinite(flEpsilon) || (flEpsilon < 0) || (Math.abs(flActualValue - flExpectedValue) > flEpsilon)) {
		throw new Error(`${strErrorMessage}: expected ${flExpectedValue}, got ${flActualValue}`);
	}
}

function VerifyBitBufferByteSourceContracts(CreateReader, CreateWriter, PackUInt32) {
	const unBitsPerByte = 8;
	const unPackedByteCount = 4;

	const Check = (bCondition, strMessage) => {
		if (!bCondition) {
			throw new Error("BitBuffer source: " + strMessage);
		}
	};
	const CheckState = (State, vecExpectedBytes, unDataBitCount = vecExpectedBytes.length * unBitsPerByte) => {
		Check(ArrayBuffer.isView(State.Bytes), "return native byte storage");
		Check((State.Bytes.length === vecExpectedBytes.length) && vecExpectedBytes.every((unByte, unIndex) => State.Bytes[unIndex] === unByte), "preserve source byte representation");
		Check((State.DataBitCount === unDataBitCount) && (State.DataByteCount === vecExpectedBytes.length) && (State.CurrentBit === 0) && !State.Overflowed, "return complete fresh state metadata");
	};
	const ExpectTypeError = (Operation, strMessage = "reject invalid source or metadata types") => {
		try {
			Operation();
		} catch (Failure) {
			if (Failure instanceof TypeError) {
				return;
			}

			throw Failure;
		}

		throw new Error("BitBuffer source: " + strMessage);
	};
	const ExpectSameError = (Operation, Original) => {
		try {
			Operation();
		} catch (Failure) {
			Check(Failure === Original, "preserve getter and conversion error identity");
			return;
		}

		throw new Error("BitBuffer source: propagate getter and conversion failures");
	};
	const arrBackingBytes = new Uint8Array([0xEE, 0x12, 0x34, 0xFF]);
	const vecByteSources = [
		{ Source: new Uint8Array([0x12, 0x34]), ExpectedBytes: [0x12, 0x34] },
		{ Source: new Uint8Array(arrBackingBytes.buffer, 1, 2), ExpectedBytes: [0x12, 0x34] },
		{ Source: new DataView(arrBackingBytes.buffer, 1, 2), ExpectedBytes: [0x12, 0x34] },
		{ Source: arrBackingBytes.buffer, ExpectedBytes: [0xEE, 0x12, 0x34, 0xFF] },
		{ Source: "A\0\u20AC", ExpectedBytes: [0x41, 0, 0xE2, 0x82, 0xAC] },
		{ Source: 4, ExpectedBytes: [0x34] },
		{ Source: 0, ExpectedBytes: [0x30] },
		{ Source: 1n, ExpectedBytes: [0x31] },
		{ Source: false, ExpectedBytes: [0x66, 0x61, 0x6C, 0x73, 0x65] },
		{ Source: null, ExpectedBytes: [0x6E, 0x75, 0x6C, 0x6C] },
		{ Source: undefined, ExpectedBytes: [0x75, 0x6E, 0x64, 0x65, 0x66, 0x69, 0x6E, 0x65, 0x64] },
	];
	for (const CaseValue of vecByteSources) {
		CheckState(CreateReader(CaseValue.Source), CaseValue.ExpectedBytes);
	}

	ExpectTypeError(() => CreateReader());
	ExpectTypeError(() => CreateReader(Symbol("reader source")));
	for (const Source of [[], [0x12, 0x34], {}, Object.create(null), Object.create(ArrayBuffer.prototype), { Bytes: null }, { Bytes: undefined }, { m_NativeState: { Bytes: new Uint8Array([1]) } }]) {
		ExpectTypeError(() => CreateReader(Source));
	}

	CheckState(CreateReader({ Bytes: [0x12, 0x34] }), [0x31, 0x38, 0x2C, 0x35, 0x32]);
	CheckState(CreateReader({ Bytes: { Bytes: new Uint8Array([0x12]) } }), [0x5B, 0x6F, 0x62, 0x6A, 0x65, 0x63, 0x74, 0x20, 0x4F, 0x62, 0x6A, 0x65, 0x63, 0x74, 0x5D]);
	CheckState(CreateReader(Object.assign([], { Bytes: new Uint8Array([0x12]), DataBitCount: 3 })), [0x12], 3);

	let bCalledSource = false;
	const CallableSource = () => {
		bCalledSource = true;
	};
	CallableSource.Bytes = new Uint8Array([0x12]);
	CallableSource.DataBitCount = 3;
	CheckState(CreateReader(CallableSource), [0x12], 3);
	Check(!bCalledSource, "read callable state fields without calling the source");

	for (const DataBitCount of [undefined, null, 0, 4, 99, -1, -0x80000000, 0x7FFFFFFF]) {
		const unExpectedBitCount = ((DataBitCount === null) || (DataBitCount === undefined)) ? 16 : Math.min(Math.max(0, DataBitCount), 16);
		CheckState(CreateReader({ Bytes: new Uint8Array([0x12, 0x34]), DataBitCount }), [0x12, 0x34], unExpectedBitCount);
	}

	for (const DataBitCount of ["4", 4.5, NaN, Infinity, -Infinity, -0, -0x80000001, 0x80000000, true, 1n, Symbol("bit count"), {}]) {
		ExpectTypeError(() => CreateReader({ Bytes: new Uint8Array([0x12, 0x34]), DataBitCount }));
	}

	let unMetadataCoercions = 0;
	const CoercibleBitCount = {
		valueOf() {
			++unMetadataCoercions;

			return 4;
		},
	};
	ExpectTypeError(() => CreateReader({ Bytes: new Uint8Array([0x12]), DataBitCount: CoercibleBitCount }));
	Check(unMetadataCoercions === 0, "reject noninteger metadata without coercing it");

	let unBytesReads = 0;
	let unBitCountReads = 0;
	const arrMutableBytes = new Uint8Array([0x12, 0x34]);
	const SourceState = {
		get Bytes() {
			++unBytesReads;

			return arrMutableBytes;
		},
		get DataBitCount() {
			++unBitCountReads;
			arrMutableBytes[0] = 0xEE;

			return 4;
		},
		get CurrentBit() {
			throw new Error("Reader creation must not consume a source cursor.");
		},
		get Overflowed() {
			throw new Error("Reader creation must not consume a source overflow flag.");
		},
	};
	CheckState(CreateReader(SourceState, false), [0x12, 0x34], 4);
	Check((unBytesReads === 1) && (unBitCountReads === 1), "snapshot bytes before a single metadata lookup, including false copy flag");

	for (const Original of [undefined, null, Symbol("byte failure"), new Error("Controlled byte failure")]) {
		ExpectSameError(() => CreateReader({
			get Bytes() {
				throw Original;
			},
		}), Original);
		ExpectSameError(() => CreateReader({
			Bytes: new Uint8Array([0x12]),
			get DataBitCount() {
				throw Original;
			},
		}), Original);
		ExpectSameError(() => CreateReader({
			Bytes: {
				toString() {
					throw Original;
				},
			},
		}), Original);
		ExpectSameError(() => CreateWriter({
			toString() {
				throw Original;
			},
		}), Original);
	}

	CheckState(CreateWriter(), []);
	for (const CaseValue of vecByteSources) {
		if ((typeof CaseValue.Source !== "number") && (CaseValue.Source !== null) && (CaseValue.Source !== undefined)) {
			CheckState(CreateWriter(CaseValue.Source), CaseValue.ExpectedBytes);
		}
	}

	for (const Size of [undefined, null, NaN, Infinity, -1]) {
		CheckState(CreateWriter(Size), []);
	}

	CheckState(CreateWriter(2.9), [0, 0]);
	CheckState(CreateWriter(0x100000001), [0]);
	CheckState(CreateWriter([0x12, 0x34]), [0x31, 0x38, 0x2C, 0x35, 0x32]);
	CheckState(CreateWriter(new Uint8Array([0x12]), 16), [0x12, 0], 16);
	CheckState(CreateWriter(new Uint8Array([0x12, 0x34]), "4"), [0x12, 0x34], 4);
	for (const Invalid of [1n, Symbol("writer bit count")]) {
		ExpectTypeError(() => CreateWriter(2, Invalid));
	}

	for (const CaseValue of [
		{ Value: 0, ExpectedBytes: [0, 0, 0, 0] },
		{ Value: 0x12345678, ExpectedBytes: [0x78, 0x56, 0x34, 0x12] },
		{ Value: 0xFFFFFFFF, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF] },
	]) {
		const vecPackedBytes = PackUInt32(CaseValue.Value);
		Check(Array.isArray(vecPackedBytes) && (vecPackedBytes.length === unPackedByteCount), "return the UInt32 byte array");
		for (let unIndex = 0; unIndex < unPackedByteCount; ++unIndex) {
			const Descriptor = Object.getOwnPropertyDescriptor(vecPackedBytes, String(unIndex));
			Check(Descriptor && Object.hasOwn(Descriptor, "value") && (Descriptor.value === CaseValue.ExpectedBytes[unIndex]) && Descriptor.writable && Descriptor.enumerable && Descriptor.configurable, "create each packed byte as an own data property");
		}

		CheckState(CreateReader(new Uint8Array(vecPackedBytes)), CaseValue.ExpectedBytes);
		ExpectTypeError(() => CreateReader(vecPackedBytes));
	}

	ExpectTypeError(() => PackUInt32(), "reject invalid UInt32 input without conversion");
	for (const Invalid of [undefined, null, -1, -0, 0.5, NaN, Infinity, -Infinity, 0x100000000, "1", true, 1n, Symbol("UInt32"), new Number(1)]) {
		ExpectTypeError(() => PackUInt32(Invalid), "reject invalid UInt32 input without conversion");
	}

	let unPackCoercions = 0;
	const CoercibleUInt32 = {
		valueOf() {
			++unPackCoercions;

			return 1;
		},
	};
	ExpectTypeError(() => PackUInt32(CoercibleUInt32), "reject invalid UInt32 input without conversion");
	Check(unPackCoercions === 0, "reject non-UInt32 values without coercing them");

	const OriginalArrayIndex = Object.getOwnPropertyDescriptor(Array.prototype, "0");
	let unInheritedSetterCalls = 0;
	let LastSetterValue = null;
	let vecOwnedIndexBytes = [];
	try {
		Object.defineProperty(Array.prototype, "0", {
			configurable: true,
			set(Value) {
				++unInheritedSetterCalls;
				LastSetterValue = Value;
			},
		});
		vecOwnedIndexBytes = PackUInt32(0x12345678);
	} finally {
		if (OriginalArrayIndex === undefined) {
			delete Array.prototype[0];
		} else {
			Object.defineProperty(Array.prototype, "0", OriginalArrayIndex);
		}
	}

	Check((unInheritedSetterCalls === 0) && (LastSetterValue === null) && (vecOwnedIndexBytes[0] === 0x78), "do not invoke inherited packed-byte setters");

	return true;
}

Assert(VerifyBitBufferByteSourceContracts(g_NativeBitBuffers.CreateRead, g_NativeBitBuffers.CreateWrite, g_NativeBitBuffers.PackUInt32), "bitbuffer byte-source contracts");

// Deliberately restore only the old permissive ordinary-array admission.
function LegacyArrayReader(...vecArguments) {
	const Source = vecArguments[0];
	if (Array.isArray(Source) && (Source.Bytes === undefined)) {
		return g_NativeBitBuffers.CreateRead(new Uint8Array(Source));
	}

	return Reflect.apply(g_NativeBitBuffers.CreateRead, g_NativeBitBuffers, vecArguments);
}

let g_bRejectedLegacyArrayAdmission = false;
try {
	VerifyBitBufferByteSourceContracts(LegacyArrayReader, g_NativeBitBuffers.CreateWrite, g_NativeBitBuffers.PackUInt32);
} catch (Failure) {
	g_bRejectedLegacyArrayAdmission = Failure.message === "BitBuffer source: reject invalid source or metadata types";
}

Assert(g_bRejectedLegacyArrayAdmission, "reject the old mock-only ordinary-array reader admission");

// Deliberately restore only the old coercing UInt32 admission.
function LegacyUnsignedPacker(Value) {
	return g_NativeBitBuffers.PackUInt32(Number(Value) >>> 0);
}

let g_bRejectedLooseUInt32Input = false;
try {
	VerifyBitBufferByteSourceContracts(g_NativeBitBuffers.CreateRead, g_NativeBitBuffers.CreateWrite, LegacyUnsignedPacker);
} catch (Failure) {
	g_bRejectedLooseUInt32Input = Failure.message === "BitBuffer source: reject invalid UInt32 input without conversion";
}

Assert(g_bRejectedLooseUInt32Input, "reject the old mock-only UInt32 coercion");

function VerifyBitBufferByteAccessContracts(ReadBytes, SetBytes) {
	const State = g_NativeBitBuffers.CreateWrite(new Uint8Array([0x12, 0x34]), 12);
	State.CurrentBit = 9;
	State.Overflowed = true;
	const arrBytes = ReadBytes(State);
	Assert((arrBytes instanceof Uint8Array) && (arrBytes.length === 2) && (arrBytes[0] === 0x12) && (arrBytes[1] === 0x34), "return a complete byte snapshot");
	arrBytes[0] = 0xEE;
	Assert(State.Bytes[0] === 0x12, "byte reads must not expose mutable state storage");
	State.Bytes[1] = 0xFF;
	Assert(arrBytes[1] === 0x34, "later state writes must not alter a byte snapshot");
	Assert((State.DataBitCount === 12) && (State.CurrentBit === 9) && State.Overflowed, "byte reads must not mutate state metadata");

	for (const Invalid of [undefined, null]) {
		let bRejected = false;
		try {
			SetBytes(State, Invalid);
		} catch (Failure) {
			if (!(Failure instanceof TypeError)) {
				throw Failure;
			}

			bRejected = true;
		}

		Assert(bRejected, "byte replacement must reject nullish sources");
		Assert((State.Bytes[0] === 0x12) && (State.Bytes[1] === 0xFF) && (State.DataByteCount === 2) && (State.DataBitCount === 12) && (State.CurrentBit === 9) && State.Overflowed, "rejected byte replacement must leave state untouched");
	}

	const Original = new Error("Controlled replacement conversion failure");
	let bPreservedFailure = false;
	try {
		SetBytes(State, {
			toString() {
				throw Original;
			},
		});
	} catch (Failure) {
		bPreservedFailure = Failure === Original;
	}

	Assert(bPreservedFailure && (State.Bytes[0] === 0x12) && (State.DataBitCount === 12) && (State.CurrentBit === 9), "replacement conversion must preserve its failure and prior state");

	const arrReplacement = new Uint8Array([0x56]);
	Assert(SetBytes(State, arrReplacement), "replace bytes from actual byte storage");
	arrReplacement[0] = 0;
	Assert((State.Bytes[0] === 0x56) && (State.DataByteCount === 1) && (State.DataBitCount === 8) && (State.CurrentBit === 8) && State.Overflowed, "replacement must snapshot bytes, clamp extent and cursor, and preserve overflow");
	Assert(SetBytes(State, "A"), "replace bytes from UTF8 text");
	Assert((State.Bytes[0] === 0x41) && (State.DataBitCount === 8), "replacement must preserve text conversion");
}

VerifyBitBufferByteAccessContracts(g_NativeBitBuffers.GetBytes, g_NativeBitBuffers.SetBytes);

let g_bRejectedByteStorageAlias = false;
try {
	VerifyBitBufferByteAccessContracts(State => State.Bytes, g_NativeBitBuffers.SetBytes);
} catch (Failure) {
	g_bRejectedByteStorageAlias = Failure.message === "byte reads must not expose mutable state storage";
}

Assert(g_bRejectedByteStorageAlias, "reject a byte getter that aliases owned state storage");

let g_bRejectedNullishByteReplacement = false;
try {
	VerifyBitBufferByteAccessContracts(g_NativeBitBuffers.GetBytes, (State, Value) => g_NativeBitBuffers.SetBytes(State, (Value === undefined) ? "undefined" : ((Value === null) ? "null" : Value)));
} catch (Failure) {
	g_bRejectedNullishByteReplacement = Failure.message === "byte replacement must reject nullish sources";
}

Assert(g_bRejectedNullishByteReplacement, "reject a byte setter that accepts nullish sources");

function VerifyBitBufferCursorContracts(API) {
	const CreateCursorState = () => {
		const State = API.CreateWrite(new Uint8Array([0x12, 0x34]), 12);
		State.CurrentBit = 3;

		return State;
	};
	const CheckUnchanged = State => {
		Assert((State.Bytes.length === 2) && (State.Bytes[0] === 0x12) && (State.Bytes[1] === 0x34) && (State.DataByteCount === 2) && (State.DataBitCount === 12) && (State.CurrentBit === 3) && !State.Overflowed, "invalid cursor/count conversion must leave state untouched");
	};
	for (const strName of ["SetDataBitCount", "SetDataByteCount", "SetCurrentBit", "SeekToBit", "SeekRelative"]) {
		const State = CreateCursorState();
		let MissingFailure = null;
		try {
			API[strName](State);
		} catch (Failure) {
			MissingFailure = Failure;
		}

		Assert(MissingFailure instanceof TypeError, strName + " must require its value argument");
		CheckUnchanged(State);

		for (const Invalid of [1n, Symbol("cursor value")]) {
			let TypeFailure = null;
			try {
				API[strName](State, Invalid);
			} catch (Failure) {
				TypeFailure = Failure;
			}

			Assert(TypeFailure instanceof TypeError, strName + " must reject non-ToNumber values");
			CheckUnchanged(State);
		}

		const Original = new Error("Controlled cursor conversion failure");
		let unCoercions = 0;
		let ConversionFailure = null;
		try {
			API[strName](State, {
				valueOf() {
					++unCoercions;
					throw Original;
				},
			});
		} catch (Failure) {
			ConversionFailure = Failure;
		}

		Assert((ConversionFailure === Original) && (unCoercions === 1), strName + " must preserve one conversion failure");
		CheckUnchanged(State);
	}

	const BitCountState = CreateCursorState();
	Assert(API.SetDataBitCount(BitCountState, "20") && (BitCountState.DataBitCount === 20) && (BitCountState.DataByteCount === 3) && (BitCountState.Bytes[2] === 0) && (BitCountState.CurrentBit === 3), "bit growth must preserve storage, zero fill and refresh metadata");
	Assert(API.SetDataBitCount(BitCountState, -1) && (BitCountState.DataBitCount === 0) && (BitCountState.Bytes.length === 3) && (BitCountState.CurrentBit === 0), "negative bit counts must clamp without truncating storage");

	const ByteCountState = CreateCursorState();
	Assert(API.SetDataByteCount(ByteCountState, 1) && (ByteCountState.Bytes.length === 1) && (ByteCountState.Bytes[0] === 0x12) && (ByteCountState.DataByteCount === 1) && (ByteCountState.DataBitCount === 8) && (ByteCountState.CurrentBit === 3), "byte resize must refresh metadata");
	Assert(API.SetDataByteCount(ByteCountState, -1) && (ByteCountState.DataByteCount === 0) && (ByteCountState.DataBitCount === 0) && (ByteCountState.CurrentBit === 0), "negative byte counts must clamp to empty storage");

	const CursorState = CreateCursorState();
	Assert(API.SetCurrentBit(CursorState, 99) && (CursorState.CurrentBit === 12), "cursor assignment must clamp to the data extent");
	Assert(API.SetCurrentBit(CursorState, -1) && (CursorState.CurrentBit === 0), "negative cursor assignment must clamp to zero");

	const RelativeState = CreateCursorState();
	Assert(API.SeekRelative(RelativeState, -0.5) && (RelativeState.CurrentBit === 3), "relative seeks must truncate the delta before addition");
	Assert(API.SeekRelative(RelativeState, undefined) && (RelativeState.CurrentBit === 3), "explicit undefined relative delta must preserve the cursor");
	Assert(API.SeekRelative(RelativeState, "2") && (RelativeState.CurrentBit === 5), "relative seeks must accept the native numeric conversion");
	Assert(!API.SeekRelative(RelativeState, -9) && RelativeState.Overflowed && (RelativeState.CurrentBit === 12), "invalid relative seeks must move to the extent and set overflow");

	const OverflowState = CreateCursorState();
	Assert(!API.CheckForOverflow(OverflowState, 0x100000001), "overflow checks must use an Int32 requested count");
	let unOverflowCoercions = 0;
	const RequestedCount = {
		valueOf() {
			++unOverflowCoercions;

			return (unOverflowCoercions === 1) ? 10 : 0;
		},
	};
	Assert(API.CheckForOverflow(OverflowState, RequestedCount) && (unOverflowCoercions === 1) && (OverflowState.CurrentBit === 3), "overflow checks must convert exactly once");
	for (const Invalid of [1n, Symbol("overflow count")]) {
		let TypeFailure = null;
		try {
			API.CheckForOverflow(CreateCursorState(), Invalid);
		} catch (Failure) {
			TypeFailure = Failure;
		}

		Assert(TypeFailure instanceof TypeError, "overflow checks must reject non-ToNumber values");
	}
}

VerifyBitBufferCursorContracts(g_NativeBitBuffers);

const g_vecCursorFaults = [
	{
		Name: "stale byte-count metadata",
		ExpectedMessage: "byte resize must refresh metadata",
		API: {
			...g_NativeBitBuffers,
			SetDataByteCount(...vecArguments) {
				const State = vecArguments[0];
				const unPreviousByteCount = State.DataByteCount;
				const bResult = Reflect.apply(g_NativeBitBuffers.SetDataByteCount, g_NativeBitBuffers, vecArguments);
				State.DataByteCount = unPreviousByteCount;

				return bResult;
			},
		},
	},
	{
		Name: "relative rounding after addition",
		ExpectedMessage: "relative seeks must truncate the delta before addition",
		API: {
			...g_NativeBitBuffers,
			SeekRelative(...vecArguments) {
				if (vecArguments.length < 2) {
					return Reflect.apply(g_NativeBitBuffers.SeekRelative, g_NativeBitBuffers, vecArguments);
				}

				const [State, nBitDelta] = vecArguments;

				return g_NativeBitBuffers.SeekToBit(State, State.CurrentBit + +nBitDelta);
			},
		},
	},
];
for (const Fault of g_vecCursorFaults) {
	let strFailureMessage = "";
	try {
		VerifyBitBufferCursorContracts(Fault.API);
	} catch (Failure) {
		strFailureMessage = Failure.message;
	}

	Assert(strFailureMessage === Fault.ExpectedMessage, "reject cursor fault: " + Fault.Name);
}

function VerifyBitBufferFieldContracts(API) {
	const strWidthRangeError = "BitBuffer bit count must be between 0 and 32 for this SDK API.";
	const CreateFieldState = () => {
		const State = API.CreateRead({ Bytes: new Uint8Array([0xFF, 0x12]), DataBitCount: 12 });
		State.CurrentBit = 3;

		return State;
	};
	for (const strName of ["WriteUBitLong", "WriteSBitLong", "WriteBitAngle", "ReadUBitLong", "PeekUBitLong", "ReadSBitLong", "ReadBitAngle"]) {
		const bWriter = strName.startsWith("Write");
		const ApplyWidth = (State, Value) => bWriter ? API[strName](State, 0, Value) : API[strName](State, Value);
		for (const Invalid of [-1, 33]) {
			const State = CreateFieldState();
			let RangeFailure = null;
			try {
				ApplyWidth(State, Invalid);
			} catch (Failure) {
				RangeFailure = Failure;
			}

			Assert((RangeFailure instanceof Error) && (RangeFailure.message === strWidthRangeError), strName + " must enforce SDK bit widths");
			Assert((State.CurrentBit === 3) && !State.Overflowed, "invalid field widths must not alter the cursor or overflow flag");
		}

		for (const Invalid of [1n, Symbol("field width")]) {
			const State = CreateFieldState();
			let TypeFailure = null;
			try {
				ApplyWidth(State, Invalid);
			} catch (Failure) {
				TypeFailure = Failure;
			}

			Assert(TypeFailure instanceof TypeError, strName + " must reject non-ToNumber field widths");
			Assert((State.CurrentBit === 3) && !State.Overflowed, "failed field-width conversion must not alter state");
		}

		for (const ZeroWidth of [undefined, null, NaN, Infinity, 0x100000000]) {
			const State = CreateFieldState();
			ApplyWidth(State, ZeroWidth);
			Assert((State.CurrentBit === 3) && !State.Overflowed, strName + " must normalize optional Int32 zero-width inputs");
		}
	}

	for (const strName of ["ReadUBitLong", "ReadSBitLong", "ReadBitAngle"]) {
		const State = CreateFieldState();
		Assert((API[strName](State, 12) === 0) && (State.CurrentBit === 12) && State.Overflowed, strName + " must advance to the extent on overrun");
	}

	for (const strName of ["WriteFloat", "WriteBitFloat"]) {
		const State = API.CreateWrite(2);
		Assert(!API[strName](State, 1) && (State.CurrentBit === 16) && State.Overflowed && State.Bytes.every(unByte => unByte === 0), strName + " must advance to the extent on overrun without partial float writes");
	}

	for (const strName of ["ReadFloat", "ReadBitFloat"]) {
		const State = API.CreateRead(new Uint8Array([0xFF, 0xFF]));
		Assert((API[strName](State) === 0) && (State.CurrentBit === 16) && State.Overflowed, strName + " must advance to the extent on overrun");
	}

	const PeekState = CreateFieldState();
	Assert((API.PeekUBitLong(PeekState, 12) === 0) && (PeekState.CurrentBit === 3) && !PeekState.Overflowed, "peeking past the extent must not commit reader state");
	const SignedState = API.CreateRead(new Uint8Array([0, 0, 0, 0x80]));
	Assert(API.ReadSBitLong(SignedState, 32) === -0x80000000, "signed full-width reads must return a signed Number");
	const LongLongState = API.CreateRead(new Uint8Array([0x78, 0x56, 0x34, 0x12, 0xFF, 0xFF]));
	Assert((API.ReadLongLong(LongLongState) === 0x12345678n) && (LongLongState.CurrentBit === 48) && LongLongState.Overflowed, "64-bit reads must preserve the low word when the second native word overruns");
	const NegativeLongLongState = API.CreateRead(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]));
	Assert(API.ReadLongLong(NegativeLongLongState) === -1n, "64-bit signed reads must remain exact BigInt values");

	for (const Invalid of [1n, Symbol("angle"), NaN, Infinity, -Infinity, 1e39]) {
		const State = API.CreateWrite(4);
		let FloatFailure = null;
		try {
			API.WriteBitAngle(State, Invalid, 8);
		} catch (Failure) {
			FloatFailure = Failure;
		}

		Assert(FloatFailure instanceof Error, "WriteBitAngle must reject invalid native floats");
		Assert((State.CurrentBit === 0) && !State.Overflowed, "invalid angles must not write to state");
	}

	const PartialLongLongWriter = API.CreateWrite(new Uint8Array([0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE]));
	Assert(!API.WriteLongLong(PartialLongLongWriter, 0x0123456789ABCDEFn) && PartialLongLongWriter.Overflowed && (PartialLongLongWriter.CurrentBit === 48) && (PartialLongLongWriter.Bytes[0] === 0xEF) && (PartialLongLongWriter.Bytes[1] === 0xCD) && (PartialLongLongWriter.Bytes[2] === 0xAB) && (PartialLongLongWriter.Bytes[3] === 0x89) && (PartialLongLongWriter.Bytes[4] === 0xEE) && (PartialLongLongWriter.Bytes[5] === 0xEE), "64-bit writes must preserve the first native word on partial overrun");
	const NegativeLongLongWriter = API.CreateWrite(8);
	Assert(API.WriteLongLong(NegativeLongLongWriter, -1n) && NegativeLongLongWriter.Bytes.every(unByte => unByte === 0xFF), "signed 64-bit writes must preserve the full two-word representation");

	const AngleState = API.CreateWrite(1);
	Assert(API.WriteBitAngle(AngleState, "90", "8") && (AngleState.Bytes[0] === 0x40) && (AngleState.CurrentBit === 8), "angles must preserve native numeric conversion and wire encoding");
	const ShortAngleState = API.CreateWrite(1, 4);
	Assert(!API.WriteBitAngle(ShortAngleState, 90, 8) && (ShortAngleState.CurrentBit === 4) && ShortAngleState.Overflowed, "angle overrun must preserve the SDK writer cursor contract");
}

VerifyBitBufferFieldContracts(g_NativeBitBuffers);

const g_vecFieldFaults = [
	{
		Name: "atomic64-bit write replaces two native word attempts",
		ExpectedMessage: "64-bit writes must preserve the first native word on partial overrun",
		API: {
			...g_NativeBitBuffers,
			WriteLongLong(State, nInputValue) {
				const unRequiredBitCount = 64;
				if ((State.DataBitCount - State.CurrentBit) < unRequiredBitCount) {
					State.Overflowed = true;
					return false;
				}

				return g_NativeBitBuffers.WriteLongLong(State, nInputValue);
			},
		},
	},
	{
		Name: "missing public reader width guard",
		ExpectedMessage: "ReadUBitLong must enforce SDK bit widths",
		API: {
			...g_NativeBitBuffers,
			ReadUBitLong(State, nBitCount) {
				return (nBitCount === 33) ? 0 : g_NativeBitBuffers.ReadUBitLong(State, nBitCount);
			},
		},
	},
	{
		Name: "reader overrun leaves a stale cursor",
		ExpectedMessage: "ReadUBitLong must advance to the extent on overrun",
		API: {
			...g_NativeBitBuffers,
			ReadUBitLong(State, nBitCount) {
				const unPreviousCurrentBit = State.CurrentBit;
				const unValue = g_NativeBitBuffers.ReadUBitLong(State, nBitCount);
				if (State.Overflowed) {
					State.CurrentBit = unPreviousCurrentBit;
				}

				return unValue;
			},
		},
	},
];
for (const Fault of g_vecFieldFaults) {
	let strFailureMessage = "";
	try {
		VerifyBitBufferFieldContracts(Fault.API);
	} catch (Failure) {
		strFailureMessage = Failure.message;
	}

	Assert(strFailureMessage === Fault.ExpectedMessage, "reject field fault: " + Fault.Name);
}

function AssertVectorNear(ActualVector, ExpectedVector, flEpsilon, strErrorMessage) {
	AssertNear(ActualVector.X, ExpectedVector.X, flEpsilon, `${strErrorMessage}.X`);
	AssertNear(ActualVector.Y, ExpectedVector.Y, flEpsilon, `${strErrorMessage}.Y`);
	AssertNear(ActualVector.Z, ExpectedVector.Z, flEpsilon, `${strErrorMessage}.Z`);
}

const g_vecInvalidNearCases = [
	{ ActualValue: NaN, ExpectedValue: 0, Epsilon: g_flFloatEpsilon },
	{ ActualValue: Infinity, ExpectedValue: 0, Epsilon: g_flFloatEpsilon },
	{ ActualValue: -Infinity, ExpectedValue: 0, Epsilon: g_flFloatEpsilon },
	{ ActualValue: undefined, ExpectedValue: 0, Epsilon: g_flFloatEpsilon },
	{ ActualValue: null, ExpectedValue: 0, Epsilon: g_flFloatEpsilon },
	{ ActualValue: "1", ExpectedValue: 1, Epsilon: g_flFloatEpsilon },
	{ ActualValue: 0, ExpectedValue: NaN, Epsilon: g_flFloatEpsilon },
	{ ActualValue: 0, ExpectedValue: Infinity, Epsilon: g_flFloatEpsilon },
	{ ActualValue: 0, ExpectedValue: 0, Epsilon: NaN },
	{ ActualValue: 0, ExpectedValue: 0, Epsilon: Infinity },
	{ ActualValue: 0, ExpectedValue: 0, Epsilon: -1 },
	{ ActualValue: 0, ExpectedValue: 0, Epsilon: "0" },
];
for (const NearCase of g_vecInvalidNearCases) {
	let bRejected = false;
	try {
		AssertNear(NearCase.ActualValue, NearCase.ExpectedValue, NearCase.Epsilon, "invalid approximate comparison");
	} catch (ErrorValue) {
		bRejected = ErrorValue instanceof Error;
	}

	Assert(bRejected, "AssertNear must reject invalid numeric comparisons.");
}

AssertNear(0, 0, 0, "exact comparisons permit zero tolerance");
AssertNear(g_flFloatEpsilon, 0, g_flFloatEpsilon, "comparison includes its tolerance boundary");

Assert(!Object.hasOwn(g_BitBuffers, "ModuleName"), "bitbuffers should not expose ModuleName");
Assert(g_BitBuffers.PackUInt32(0x12345678).join(",") === "120,86,52,18", "PackUInt32 should return little-endian bytes");

const g_BoundedWriter = new g_BitBuffers.BitBufferWrite(1, 4);
Assert(g_BoundedWriter.DataByteCount === 1, "explicit bit count should keep original byte count");
Assert(g_BoundedWriter.MaximumBitCount === 4, "explicit bit count should set MaximumBitCount");
Assert(g_BoundedWriter.WriteUBitLong(0xF, 4), "writer should accept data inside explicit bit count");
Assert(!g_BoundedWriter.WriteOneBit(1), "writer should reject data past explicit bit count");
Assert(g_BoundedWriter.IsOverflowed(), "overflow should be reported after failed write");
Assert(g_BoundedWriter.ClearOverflowFlag(), "ClearOverflowFlag should succeed");
Assert(!g_BoundedWriter.IsOverflowed(), "ClearOverflowFlag should reset overflow state");

g_BoundedWriter.DataBitCount = 16;
Assert(g_BoundedWriter.DataByteCount === 2, "expanding DataBitCount should grow byte storage");
Assert(g_BoundedWriter.SeekToBit(4), "SeekToBit should accept the expanded range");
Assert(g_BoundedWriter.WriteUBitLong(0xAA, 8), "expanded bit range should be writable");
g_BoundedWriter.CurrentBit = 99;
Assert(g_BoundedWriter.CurrentBit === g_BoundedWriter.DataBitCount, "CurrentBit should clamp to the valid range");
g_BoundedWriter.DataByteCount = 1;
Assert(g_BoundedWriter.DataBitCount === 8, "shrinking DataByteCount should clamp DataBitCount");
Assert(g_BoundedWriter.CurrentBit === 8, "shrinking DataByteCount should clamp CurrentBit");

const g_PartialWriter = new g_BitBuffers.BitBufferWrite(g_unWordByteCount);
Assert(g_PartialWriter.WriteUBitLong(0xA, 4), "partial writer should accept four bits");
const g_PartialReader = new g_BitBuffers.BitBufferRead(g_PartialWriter);
Assert(g_PartialReader.DataBitCount === 4, "reader created from writer should use written bit count");
Assert(g_PartialReader.ReadUBitLong(4) === 0xA, "reader created from writer should read written bits");

const g_LongLongWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
const g_nLongLongValue = -0x123456789ABn;
Assert(g_LongLongWriter.WriteLongLong(g_nLongLongValue), "WriteLongLong should accept BigInt values");
const g_LongLongReader = new g_BitBuffers.BitBufferRead(g_LongLongWriter);
Assert(g_LongLongReader.ReadLongLong() === g_nLongLongValue, "ReadLongLong should roundtrip BigInt values");

const g_unLongLongByteCount = 8;
const g_unLongLongSignBitShift = 63n;
const g_nMinimumLongLongValue = -(1n << g_unLongLongSignBitShift);
const g_nMaximumLongLongValue = (1n << g_unLongLongSignBitShift) - 1n;

for (const nValue of [g_nMinimumLongLongValue, -1n, 0n, 1n, g_nMaximumLongLongValue]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unLongLongByteCount);
	Assert(Writer.WriteLongLong(nValue), "WriteLongLong must accept every signed 64-bit BigInt boundary.");

	const Reader = new g_BitBuffers.BitBufferRead(Writer);
	Assert(Reader.ReadLongLong() === nValue, "ReadLongLong must preserve exact signed 64-bit BigInt boundaries.");
}

for (const Value of [undefined, null]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unLongLongByteCount);
	Assert(Writer.WriteLongLong(Value), "WriteLongLong must retain the native nullish-zero default.");

	const Reader = new g_BitBuffers.BitBufferRead(Writer);
	Assert(Reader.ReadLongLong() === 0n, "The nullish WriteLongLong default must decode as 0n.");
}

for (const Value of [
	0,
	1,
	Number.MAX_SAFE_INTEGER,
	Number.POSITIVE_INFINITY,
	NaN,
	true,
	"1",
	Object(1n),
	Symbol("Int64"),
	[],
	{
		valueOf() {
			throw new Error("Int64 validation must not invoke valueOf.");
		},
	},
	g_nMinimumLongLongValue - 1n,
	g_nMaximumLongLongValue + 1n,
]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unLongLongByteCount);
	let bRejected = false;
	try {
		Writer.WriteLongLong(Value);
	} catch (ErrorValue) {
		bRejected = (ErrorValue instanceof Error) && ErrorValue.message.includes("signed 64-bit") && ErrorValue.message.includes("BigInt");
	}

	Assert(bRejected, "WriteLongLong must reject non-BigInt and out-of-range values.");
	Assert((Writer.CurrentBit === 0) && !Writer.IsOverflowed(), "Rejected int64 values must not mutate writer state.");
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unSequenceBufferByteCount);
Assert(!Object.hasOwn(g_Writer, "Data"), "writer should not expose the removed Data alias");
Assert(g_Writer.Bytes instanceof Uint8Array, "Bytes should return writer bytes as Uint8Array");
Assert(g_Writer.WriteOneBit(1), "WriteOneBit should succeed");
Assert(g_Writer.WriteUBitLong(0x2A, 6), "WriteUBitLong should succeed");
Assert(g_Writer.WriteSBitLong(-3, 5), "WriteSBitLong should succeed");
Assert(g_Writer.WriteUBitVar(0xABC), "WriteUBitVar should succeed");
Assert(g_Writer.WriteVarInt32(300), "WriteVarInt32 should succeed");
Assert(g_Writer.WriteFloat(1.25), "WriteFloat should succeed");
Assert(g_Writer.WriteString("sourcejs"), "WriteString should succeed");
Assert(g_Writer.WrittenBitCount > 0, "WrittenBitCount should advance");
Assert(g_Writer.WrittenByteCount === g_Writer.ToBytes().length, "WrittenByteCount should match serialized byte count");
Assert(!("NumBitsWritten" in g_Writer), "writer should not expose the removed NumBitsWritten alias");

const g_Reader = new g_BitBuffers.BitBufferRead(g_Writer);
Assert(!Object.hasOwn(g_Reader, "Data"), "reader should not expose the removed Data alias");
Assert(g_Reader.Bytes instanceof Uint8Array, "Bytes should return reader bytes as Uint8Array");
Assert(g_Reader.ReadOneBit() === 1, "ReadOneBit should roundtrip");
Assert(g_Reader.PeekUBitLong(6) === 0x2A, "PeekUBitLong should read without advancing");
Assert(g_Reader.CurrentBit === 1, "PeekUBitLong should preserve CurrentBit");
Assert(g_Reader.ReadUBitLong(6) === 0x2A, "ReadUBitLong should roundtrip");
Assert(g_Reader.ReadSBitLong(5) === -3, "ReadSBitLong should roundtrip");
Assert(g_Reader.ReadUBitVar() === 0xABC, "ReadUBitVar should roundtrip");
Assert(g_Reader.ReadVarInt32() === 300, "ReadVarInt32 should roundtrip");
AssertNear(g_Reader.ReadFloat(), 1.25, g_flFloatEpsilon, "ReadFloat should roundtrip");
Assert(g_Reader.ReadString() === "sourcejs", "ReadString should roundtrip");
Assert(g_Reader.ReadBitCount === g_Reader.CurrentBit, "ReadBitCount should track CurrentBit");
Assert(g_Reader.ReadByteCount > 0, "ReadByteCount should advance");
Assert(!("NumBitsRead" in g_Reader), "reader should not expose the removed NumBitsRead alias");
Assert(g_Reader.SeekToBit(1), "reader SeekToBit should succeed");
Assert(g_Reader.SeekRelative(6), "reader SeekRelative should succeed");
Assert(g_Reader.CurrentBit === 7, "SeekRelative should update CurrentBit");

const g_SourceWriter = new g_BitBuffers.BitBufferWrite(1);
Assert(g_SourceWriter.WriteUBitLong(3, 2), "source writer should accept two bits");
const g_SourceReader = new g_BitBuffers.BitBufferRead(g_SourceWriter);
const g_CopyWriter = new g_BitBuffers.BitBufferWrite(1);
Assert(g_CopyWriter.WriteBitsFromBuffer(g_SourceReader, 2), "WriteBitsFromBuffer should copy from a reader");
Assert(g_SourceReader.CurrentBit === 2, "WriteBitsFromBuffer should advance the source reader");
const g_CopyReader = new g_BitBuffers.BitBufferRead(g_CopyWriter);
Assert(g_CopyReader.ReadUBitLong(2) === 3, "WriteBitsFromBuffer should preserve bit values");

const g_CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unSequenceBufferByteCount);
Assert(g_CoordinateWriter.WriteBitCoord(12.5), "WriteBitCoord should succeed");
Assert(g_CoordinateWriter.WriteBitCoordMP(-7.125, false, true), "WriteBitCoordMP should succeed");
Assert(g_CoordinateWriter.WriteBitVec3Coord({ X: 1.25, Y: -2.5, Z: 0 }), "WriteBitVec3Coord should succeed");
Assert(g_CoordinateWriter.WriteBitNormal(-0.5), "WriteBitNormal should succeed");
Assert(g_CoordinateWriter.WriteBitVec3Normal([0.25, -0.25, -0.935]), "WriteBitVec3Normal should succeed");
Assert(g_CoordinateWriter.WriteBitAngles({ Pitch: 2.25, Yaw: 0, Roll: -4.5 }), "WriteBitAngles should accept Pitch/Yaw/Roll values");
const g_CoordinateReader = new g_BitBuffers.BitBufferRead(g_CoordinateWriter);
AssertNear(g_CoordinateReader.ReadBitCoord(), 12.5, g_flCoordinateEpsilon, "ReadBitCoord should roundtrip");
AssertNear(g_CoordinateReader.ReadBitCoordMP(false, true), -7.125, g_flLowPrecisionCoordinateEpsilon, "ReadBitCoordMP should roundtrip");
AssertVectorNear(g_CoordinateReader.ReadBitVec3Coord(), { X: 1.25, Y: -2.5, Z: 0 }, g_flCoordinateEpsilon, "ReadBitVec3Coord should roundtrip");
AssertNear(g_CoordinateReader.ReadBitNormal(), -0.5, g_flNormalEpsilon, "ReadBitNormal should roundtrip");
const g_NormalVector = g_CoordinateReader.ReadBitVec3Normal();
AssertNear(g_NormalVector.X, 0.25, g_flNormalEpsilon, "ReadBitVec3Normal.X should roundtrip");
AssertNear(g_NormalVector.Y, -0.25, g_flNormalEpsilon, "ReadBitVec3Normal.Y should roundtrip");
Assert(g_NormalVector.Z < 0, "ReadBitVec3Normal should preserve Z sign");
AssertVectorNear(g_CoordinateReader.ReadBitAngles(), { X: 2.25, Y: 0, Z: -4.5 }, g_flCoordinateEpsilon, "ReadBitAngles should roundtrip");

for (let unBitCount = 0; unBitCount <= g_unLongBitCount; unBitCount += 1) {
	for (const flAngle of [g_flHalfTurnDegrees, -g_flHalfTurnDegrees]) {
		const AngleWriter = new g_BitBuffers.BitBufferWrite(g_unLongByteCount);
		Assert(AngleWriter.WriteBitAngle(flAngle, unBitCount), "WriteBitAngle should support every width from 0 through 32");
		Assert(AngleWriter.WrittenBitCount === unBitCount, "WriteBitAngle should advance by its exact width");

		const EncodedReader = new g_BitBuffers.BitBufferRead(AngleWriter);
		const unExpectedEncoding = (unBitCount === 0) ? 0 : (2 ** (unBitCount - 1));
		Assert(EncodedReader.ReadUBitLong(unBitCount) === unExpectedEncoding, "half-turn encoding should not use signed shifts");

		const AngleReader = new g_BitBuffers.BitBufferRead(AngleWriter);
		Assert(AngleReader.ReadBitAngle(unBitCount) === ((unBitCount === 0) ? 0 : g_flHalfTurnDegrees), "ReadBitAngle should decode a half turn at every width");
		Assert(AngleReader.ReadBitCount === unBitCount, "ReadBitAngle should advance by its exact width");
	}
}

const g_FractionalAngleWriter = new g_BitBuffers.BitBufferWrite(1);
Assert(g_FractionalAngleWriter.WriteBitAngle(-0.1, 8), "negative fractional angle should be accepted");
const g_FractionalAngleReader = new g_BitBuffers.BitBufferRead(g_FractionalAngleWriter);
Assert(g_FractionalAngleReader.ReadUBitLong(8) === 0, "angle quantization should truncate toward zero before wrapping");

for (const strText of ["", "Привет", "A".repeat(g_unMaximumStringByteCount - 1)]) {
	const StringReader = new g_BitBuffers.BitBufferRead(new Uint8Array(Buffer.from(strText + "\0", "utf8")));
	Assert(StringReader.ReadString() === strText, "ReadString should decode a complete UTF-8 string within its byte limit");
	Assert(StringReader.ReadBitCount === ((Buffer.byteLength(strText, "utf8") + 1) * g_unBitsPerByte), "ReadString should consume the terminator");
}

for (const arrBytes of [new Uint8Array(), new Uint8Array([0x41]), new Uint8Array(Buffer.from("A".repeat(g_unMaximumStringByteCount) + "\0"))]) {
	const StringReader = new g_BitBuffers.BitBufferRead(arrBytes);
	let bRejected = false;

	try {
		StringReader.ReadString();
	} catch (ErrorValue) {
		bRejected = (ErrorValue instanceof Error) && ErrorValue.message.includes("bitbuffers.ReadString failed");
	}

	Assert(bRejected, "ReadString should reject missing terminators and oversized strings");
	Assert(StringReader.ReadBitCount === (arrBytes.length * g_unBitsPerByte), "failed ReadString should retain the consumed cursor");
}

for (const arrBytes of [new Uint8Array(), new Uint8Array([0xFF])]) {
	const ZeroWidthReader = new g_BitBuffers.BitBufferRead(arrBytes);
	Assert(ZeroWidthReader.ReadUBitLong(0) === 0, "zero-width unsigned read should return zero");
	Assert(ZeroWidthReader.ReadSBitLong(0) === 0, "zero-width signed read should return zero");
	Assert(ZeroWidthReader.ReadBitCount === 0, "zero-width reads should preserve the cursor");
	Assert(!ZeroWidthReader.IsOverflowed(), "zero-width reads should not introduce overflow");
}

for (let unBitOffset = 0; unBitOffset < g_unBitsPerByte; unBitOffset += 1) {
	for (let unBitWidth = 1; unBitWidth <= g_unLongBitCount; unBitWidth += 1) {
		const SignedReader = new g_BitBuffers.BitBufferRead(new Uint8Array(g_unPaddedReadByteCount).fill(g_unByteMask));
		Assert(SignedReader.SeekRelative(unBitOffset), "signed read setup should seek to the requested bit");
		Assert(SignedReader.ReadSBitLong(unBitWidth) === -1, "all-one signed values should decode as minus one");
		Assert(SignedReader.ReadBitCount === (unBitOffset + unBitWidth), "signed reads should consume their exact width");

		const UnsignedReader = new g_BitBuffers.BitBufferRead(new Uint8Array(g_unPaddedReadByteCount).fill(g_unByteMask));
		Assert(UnsignedReader.SeekRelative(unBitOffset), "unsigned read setup should seek to the requested bit");
		Assert(UnsignedReader.ReadUBitLong(unBitWidth) === ((2 ** unBitWidth) - 1), "all-one unsigned values should retain their full width");
		Assert(UnsignedReader.ReadBitCount === (unBitOffset + unBitWidth), "unsigned reads should consume their exact width");
	}
}

for (let unLastByte = 0; unLastByte <= g_unByteMask; unLastByte += 1) {
	const VarIntReader = new g_BitBuffers.BitBufferRead(new Uint8Array([0x80, 0x80, 0x80, 0x80, unLastByte]));
	const unPayload = unLastByte & g_unVarintPayloadMask;
	const unExpectedValue = (unPayload <= g_unVarintFinalPayloadMask) ? (unPayload * (2 ** g_unVarintFinalPayloadShift)) : 0;
	Assert(VarIntReader.ReadVarInt32() === unExpectedValue, "ReadVarInt32 should reject out-of-range payload before narrowing");
	Assert(VarIntReader.IsOverflowed() === (unLastByte > g_unVarintFinalPayloadMask), "ReadVarInt32 should flag excess payload or a fifth continuation bit");
	Assert(VarIntReader.ReadBitCount === (g_unMaximumVarintByteCount * g_unBitsPerByte), "ReadVarInt32 should consume five bytes before rejecting the last byte");
}

for (let unByteCount = 0; unByteCount < g_unMaximumVarintByteCount; unByteCount += 1) {
	const TruncatedReader = new g_BitBuffers.BitBufferRead(new Uint8Array(unByteCount).fill(0x80));
	Assert(TruncatedReader.ReadVarInt32() === 0, "truncated zero-payload varint should retain a zero partial result");
	Assert(TruncatedReader.IsOverflowed(), "unterminated varint should set overflow");
	Assert(TruncatedReader.ReadBitCount === (unByteCount * g_unBitsPerByte), "truncated varint should stop at the data limit");
}

const g_MaximumVarIntReader = new g_BitBuffers.BitBufferRead(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x0F]));
Assert(g_MaximumVarIntReader.ReadVarInt32() === 0xFFFFFFFF, "maximum uint32 varint should retain all bits");
Assert(!g_MaximumVarIntReader.IsOverflowed(), "maximum uint32 varint should not overflow");

for (let unBitOffset = 0; unBitOffset < g_unBitsPerByte; unBitOffset += 1) {
	for (const unValue of [0, 1, 0x7FFF, 0x8000, 0xFFFF]) {
		const unPackedValue = unValue * (2 ** unBitOffset);
		const arrBytes = new Uint8Array([unPackedValue & g_unByteMask, (unPackedValue >>> g_unBitsPerByte) & g_unByteMask, (unPackedValue >>> g_unWordBitCount) & g_unByteMask, 0]);
		const ShortReader = new g_BitBuffers.BitBufferRead(arrBytes);
		Assert(ShortReader.SeekRelative(unBitOffset), "short read setup should seek to the requested bit");
		const nExpectedValue = (unValue >= g_unWordSignBit) ? (unValue - g_unWordModulus) : unValue;
		Assert(ShortReader.ReadShort() === nExpectedValue, "ReadShort should preserve signed 16-bit values");
		Assert(ShortReader.ReadBitCount === (unBitOffset + g_unWordBitCount), "ReadShort should consume 16 bits");

		const WordReader = new g_BitBuffers.BitBufferRead(arrBytes);
		Assert(WordReader.SeekRelative(unBitOffset), "word read setup should seek to the requested bit");
		Assert(WordReader.ReadWord() === unValue, "ReadWord should preserve unsigned 16-bit values");
		Assert(WordReader.ReadBitCount === (unBitOffset + g_unWordBitCount), "ReadWord should consume 16 bits");
	}
}

// These fixtures specify the low-selector SDK layout used by this mock.
for (const unValue of [0, 15, 16, 255, 256, 4095, 4096, 0xFFFFFFFF]) {
	const unSelectorCode = (unValue < g_unVariableSmallLimit) ? 0 : (unValue < g_unVariableMediumLimit) ? 1 : (unValue < g_unVariableLargeLimit) ? 2 : 3;
	const unPackedValue = (BigInt(unValue) << g_unVariableSelectorBitShift) | BigInt(unSelectorCode);
	const arrBytes = new Uint8Array(g_unMaximumVarintByteCount);
	for (let unByteIndex = 0; unByteIndex < arrBytes.length; unByteIndex += 1) {
		arrBytes[unByteIndex] = Number((unPackedValue >> BigInt(unByteIndex * g_unBitsPerByte)) & g_unByteMaskBigInt);
	}

	const VariableReader = new g_BitBuffers.BitBufferRead(arrBytes);
	Assert(VariableReader.ReadUBitVar() === unValue, "ReadUBitVar should decode every low-selector width boundary");
	const unPayloadBitCount = g_vecVariablePayloadBitCounts[unSelectorCode];
	Assert(VariableReader.ReadBitCount === (unPayloadBitCount + g_unVariableSelectorBitCount), "ReadUBitVar should consume selector and payload bits");
	Assert(!VariableReader.IsOverflowed(), "valid variable-width values should not overflow");
}

for (const BufferValue of [new g_BitBuffers.BitBufferWrite(g_unWordByteCount), new g_BitBuffers.BitBufferRead(new Uint8Array(g_unWordByteCount))]) {
	Assert(BufferValue.SetOverflowFlag() === true, "setting overflow should report success");
	Assert(BufferValue.CurrentBit === 0, "setting overflow should not move the cursor");
	Assert(BufferValue.SeekToBit(3), "valid absolute seek should succeed");
	Assert(BufferValue.IsOverflowed(), "valid seek should preserve an existing overflow flag");
	BufferValue.Overflowed = false;
	Assert(!BufferValue.IsOverflowed(), "false property assignment should clear overflow");
	let bRejected = false;

	try {
		BufferValue.Overflowed = 1;
	} catch (ErrorValue) {
		bRejected = ErrorValue instanceof TypeError;
	}

	Assert(bRejected && !BufferValue.IsOverflowed(), "non-boolean overflow assignment should reject without mutation");
	Assert(!BufferValue.SeekToBit(-1), "negative absolute seek should fail");
	Assert(BufferValue.IsOverflowed() && (BufferValue.CurrentBit === 16), "invalid seek should flag overflow and move to the data limit");
	Assert(BufferValue.SeekToBit(16), "seeking exactly to the data limit should succeed");
	Assert(!BufferValue.SeekToBit(17), "seeking beyond the data limit should fail");
}

const g_CounterWriter = new g_BitBuffers.BitBufferWrite(g_unWordByteCount);
Assert(g_CounterWriter.MaximumBitCount === 16, "maximum bit count should expose the data limit");
Assert(g_CounterWriter.WriteOneBit(1), "counter test should write one bit");
Assert((g_CounterWriter.WrittenBitCount === 1) && (g_CounterWriter.WrittenByteCount === 1), "written-byte count should round a partial byte upward");
Assert((g_CounterWriter.RemainingBitCount === 15) && (g_CounterWriter.RemainingByteCount === 2), "remaining-byte count should round a partial byte upward");
Assert(g_CounterWriter.WriteUBitLong(255, 8), "counter test should cross a byte boundary");
Assert((g_CounterWriter.WrittenByteCount === 2) && (g_CounterWriter.RemainingByteCount === 1), "byte counters should follow the current cursor");
Assert(g_CounterWriter.SeekToBit(1), "counter test should seek backward");
Assert(g_CounterWriter.WrittenBitCount === 1, "written count should not retain a high-water mark");
Assert(g_CounterWriter.CheckForOverflow(16), "oversized request should set overflow");
Assert(g_CounterWriter.CheckForOverflow(), "zero-size check should preserve overflow");
Assert(g_CounterWriter.CurrentBit === 1, "overflow checks should not consume bits");
Assert(g_CounterWriter.ClearOverflowFlag(), "clearing overflow should succeed");
Assert(!g_CounterWriter.IsOverflowed() && (g_CounterWriter.CurrentBit === 1), "clearing overflow should preserve the cursor");

const g_ResetWriter = new g_BitBuffers.BitBufferWrite(new Uint8Array([0xAA, 0xFF, 0x07]), 7);
const g_unResetByteCount = g_ResetWriter.DataByteCount;
const g_unResetBitCount = g_ResetWriter.DataBitCount;
Assert(g_ResetWriter.SeekToBit(5), "reset setup should move the cursor");
Assert(g_ResetWriter.SetOverflowFlag(), "reset setup should set overflow");
Assert(g_ResetWriter.ResetBuffer(), "ResetBuffer should report success");
Assert((g_ResetWriter.CurrentBit === 0) && !g_ResetWriter.IsOverflowed(), "ResetBuffer should reset cursor and overflow");
Assert((g_ResetWriter.DataByteCount === g_unResetByteCount) && (g_ResetWriter.DataBitCount === g_unResetBitCount), "ResetBuffer should preserve data limits");
Assert(g_ResetWriter.Bytes.every((unByte) => unByte === 0), "ResetBuffer should clear all stored bytes, including bytes beyond the bit limit");
Assert(g_ResetWriter.ResetBuffer() && (g_ResetWriter.CurrentBit === 0), "ResetBuffer should allow repeated resets");

const g_ExportWriter = new g_BitBuffers.BitBufferWrite(new Uint8Array([0xFF, 0xAA]));
Assert(g_ExportWriter.SeekToBit(1), "byte export setup should leave a partial byte");
const g_arrExportedBytes = g_ExportWriter.ToBytes();
Assert((g_arrExportedBytes instanceof Uint8Array) && (g_arrExportedBytes.length === 1) && (g_arrExportedBytes[0] === 0xFF), "ToBytes should include the unmasked final partial byte");
g_arrExportedBytes[0] = 0;
Assert(g_ExportWriter.ToBytes()[0] === 0xFF, "ToBytes should return a copy independent of writer storage");
Assert(g_ExportWriter.CurrentBit === 1, "ToBytes should not move the cursor");
Assert(g_ExportWriter.SeekToBit(0) && (g_ExportWriter.ToBytes().length === 0), "backward seek should shorten byte export");

for (const flValue of [0, 16384, 16384.96875, -16384.96875]) {
	const AngleWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(AngleWriter.WriteBitAngles({ X: flValue, Y: 0, Z: 0 }), "representable coordinate angles should remain accepted");
}

for (const flValue of [16385, -16385, 1e30]) {
	for (let unComponentIndex = 0; unComponentIndex < g_unVectorComponentCount; unComponentIndex += 1) {
		const vecComponents = [0, 0, 0];
		vecComponents[unComponentIndex] = flValue;
		const AngleWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
		let bRejected = false;

		try {
			AngleWriter.WriteBitAngles(vecComponents);
		} catch (ErrorValue) {
			bRejected = (ErrorValue instanceof Error) && ErrorValue.message.includes("coordinate encoding range");
		}

		Assert(bRejected, "out-of-range angle components should reject before writing");
		Assert((AngleWriter.CurrentBit === 0) && !AngleWriter.IsOverflowed(), "range rejection should leave writer state unchanged");
		Assert(AngleWriter.Bytes.every((unByte) => unByte === 0), "range rejection should leave all bytes unchanged");
	}
}

for (const vecArguments of [[], [undefined], [null]]) {
	const AngleWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(AngleWriter.WriteBitAngles(...vecArguments), "omitted or nullish angles should default to zero components");
	Assert(AngleWriter.CurrentBit === 3, "zero angles should write exactly three absent-component flags");
	Assert(!AngleWriter.IsOverflowed(), "default angles should not overflow available storage");
	Assert(AngleWriter.ToBytes()[0] === 0, "default angles should encode zero presence flags");
}

for (const strMethodName of ["WriteBitAngles", "WriteBitVec3Coord", "WriteBitVec3Normal"]) {
	for (const InvalidValue of [false, 1, "1", {}, [], [0, 0], [null, 0, 0], [undefined, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [1e39, 0, 0], [1n, 0, 0], [Symbol("component"), 0, 0]]) {
		const VectorWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
		let bRejected = false;

		try {
			VectorWriter[strMethodName](InvalidValue);
		} catch (ErrorValue) {
			bRejected = ErrorValue instanceof Error;
		}

		Assert(bRejected, `${strMethodName} should reject invalid vector input`);
		Assert((VectorWriter.CurrentBit === 0) && !VectorWriter.IsOverflowed(), "vector parsing failure should preserve cursor and overflow flag");
		Assert(VectorWriter.Bytes.every((unByte) => unByte === 0), "vector parsing failure should preserve bytes");
	}

	const ConvertedWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	const NumericWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(ConvertedWriter[strMethodName](["0.5", false, true]), "native-compatible component coercion should remain accepted");
	Assert(NumericWriter[strMethodName]([0.5, 0, 1]), "numeric reference vector should be accepted");
	Assert(Buffer.from(ConvertedWriter.ToBytes()).equals(Buffer.from(NumericWriter.ToBytes())), "coerced components should encode identically to numeric components");
}

for (const bArrayInput of [false, true]) {
	for (const nFailingComponent of [-1, 0, 1, 2]) {
		const VectorValue = bArrayInput ? [] : {};
		const vecTrace = [];
		const ExpectedError = new Error("component conversion failed");
		for (let unComponentIndex = 0; unComponentIndex < g_unVectorComponentCount; unComponentIndex += 1) {
			const strPropertyName = bArrayInput ? String(unComponentIndex) : ["X", "Y", "Z"][unComponentIndex];
			Object.defineProperty(VectorValue, strPropertyName, {
				get() {
					vecTrace.push(`get${unComponentIndex}`);

					return {
						valueOf() {
							vecTrace.push(`convert${unComponentIndex}`);

							if (unComponentIndex === nFailingComponent) {
								throw ExpectedError;
							}

							return 0;
						},
					};
				},
			});
		}

		const AngleWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
		let CaughtError = null;
		try {
			AngleWriter.WriteBitAngles(VectorValue);
		} catch (ErrorValue) {
			CaughtError = ErrorValue;
		}

		const unComponentCount = (nFailingComponent < 0) ? 3 : (nFailingComponent + 1);
		const vecExpectedTrace = ["get0", "convert0", "get1", "convert1", "get2", "convert2"].slice(0, unComponentCount * 2);
		Assert(vecTrace.join(",") === vecExpectedTrace.join(","), "components should be read and converted once in order, stopping at the first failure");
		Assert(CaughtError === ((nFailingComponent < 0) ? null : ExpectedError), "mock should preserve a component conversion exception");
		Assert(AngleWriter.CurrentBit === ((nFailingComponent < 0) ? 3 : 0), "failed component conversion must not write bits");
	}
}

for (const flValue of [0, 0.03125, -0.03125, 16384, 16384.96875, -16384.96875]) {
	const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(CoordinateWriter.WriteBitCoord(flValue), "representable scalar coordinate should be accepted");
}

for (const flValue of [16385, -16385, 1e30, -1e30, NaN, Infinity]) {
	const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	let bRejected = false;
	try {
		CoordinateWriter.WriteBitCoord(flValue);
	} catch (ErrorValue) {
		bRejected = ErrorValue instanceof Error;
	}

	Assert(bRejected, "invalid scalar coordinate should reject before writing");
	Assert((CoordinateWriter.CurrentBit === 0) && !CoordinateWriter.IsOverflowed(), "coordinate rejection should preserve writer state");
	Assert(CoordinateWriter.Bytes.every((unByte) => unByte === 0), "coordinate rejection should preserve bytes");
}

for (const vecArguments of [[], [undefined], [null]]) {
	const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(CoordinateWriter.WriteBitCoord(...vecArguments), "default scalar coordinate should be accepted");
	Assert((CoordinateWriter.CurrentBit === 2) && (CoordinateWriter.ToBytes()[0] === 0), "default coordinate should encode two zero presence flags");
}

for (const CaseValue of [
	{ Value: 0, BitCount: 2, Hex: "01" },
	{ Value: 1, BitCount: 14, Hex: "0300" },
	{ Value: -1, BitCount: 14, Hex: "0700" },
	{ Value: 2047, BitCount: 14, Hex: "f33f" },
	{ Value: 2048, BitCount: 17, Hex: "fa3f00" },
	{ Value: -2048, BitCount: 17, Hex: "fe3f00" },
	{ Value: 16384, BitCount: 17, Hex: "faff01" },
]) {
	for (const bLowPrecision of [false, true]) {
		const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
		Assert(CoordinateWriter.WriteBitCoordMP(CaseValue.Value, true, bLowPrecision), "integral multiplayer coordinate should encode successfully");
		Assert(CoordinateWriter.CurrentBit === CaseValue.BitCount, "integral multiplayer coordinate should use the SDK bit count");
		Assert(Buffer.from(CoordinateWriter.ToBytes()).toString("hex") === CaseValue.Hex, "integral multiplayer coordinate should match known SDK wire bytes");

		const CoordinateReader = new g_BitBuffers.BitBufferRead(Buffer.from(CaseValue.Hex, "hex"));
		Assert(CoordinateReader.ReadBitCoordMP(true, bLowPrecision) === CaseValue.Value, "integral multiplayer reader should decode independent wire bytes");
		Assert(CoordinateReader.CurrentBit === CaseValue.BitCount, "integral multiplayer reader should consume the SDK bit count");
	}
}

for (const CaseValue of [
	{ Value: 0, LowPrecision: false, DecodedValue: 0, BitCount: 8, Hex: "01" },
	{ Value: 0.03125, LowPrecision: false, DecodedValue: 0.03125, BitCount: 8, Hex: "09" },
	{ Value: -0.03125, LowPrecision: false, DecodedValue: -0.03125, BitCount: 8, Hex: "0d" },
	{ Value: 1.5, LowPrecision: false, DecodedValue: 1.5, BitCount: 19, Hex: "030004" },
	{ Value: -1.5, LowPrecision: false, DecodedValue: -1.5, BitCount: 19, Hex: "070004" },
	{ Value: 0.03125, LowPrecision: true, DecodedValue: 0, BitCount: 6, Hex: "01" },
	{ Value: 0.125, LowPrecision: true, DecodedValue: 0.125, BitCount: 6, Hex: "09" },
	{ Value: -0.125, LowPrecision: true, DecodedValue: -0.125, BitCount: 6, Hex: "0d" },
	{ Value: 1.5, LowPrecision: true, DecodedValue: 1.5, BitCount: 17, Hex: "030001" },
]) {
	const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(CoordinateWriter.WriteBitCoordMP(CaseValue.Value, false, CaseValue.LowPrecision), "fractional multiplayer coordinate should encode successfully");
	Assert(CoordinateWriter.CurrentBit === CaseValue.BitCount, "fractional multiplayer coordinate should use the SDK bit count");
	Assert(Buffer.from(CoordinateWriter.ToBytes()).toString("hex") === CaseValue.Hex, "fractional multiplayer coordinate should match independent wire bytes");

	const CoordinateReader = new g_BitBuffers.BitBufferRead(Buffer.from(CaseValue.Hex, "hex"));
	Assert(CoordinateReader.ReadBitCoordMP(false, CaseValue.LowPrecision) === CaseValue.DecodedValue, "fractional multiplayer reader should decode independent wire bytes");
	Assert(CoordinateReader.CurrentBit === CaseValue.BitCount, "fractional multiplayer reader should consume the SDK bit count");
}

for (const vecArguments of [[], [undefined], [null]]) {
	const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
	Assert(CoordinateWriter.WriteBitCoordMP(...vecArguments), "default multiplayer coordinate should be accepted");
	Assert((CoordinateWriter.CurrentBit === 8) && (CoordinateWriter.ToBytes()[0] === 1), "default multiplayer coordinate should encode in-bounds zero at full precision");
}

for (const flValue of [16385, -16385, 1e30, -1e30, NaN, Infinity, -Infinity]) {
	for (const bIntegral of [false, true]) {
		for (const bLowPrecision of [false, true]) {
			const CoordinateWriter = new g_BitBuffers.BitBufferWrite(g_unScratchBufferByteCount);
			let bRejected = false;
			try {
				CoordinateWriter.WriteBitCoordMP(flValue, bIntegral, bLowPrecision);
			} catch (ErrorValue) {
				bRejected = ErrorValue instanceof Error;
			}

			Assert(bRejected, "invalid multiplayer coordinate should reject in every mode");
			Assert((CoordinateWriter.CurrentBit === 0) && !CoordinateWriter.IsOverflowed(), "multiplayer coordinate rejection should preserve writer state");
			Assert(CoordinateWriter.Bytes.every((unByte) => unByte === 0), "multiplayer coordinate rejection should preserve bytes");
		}
	}
}

console.log("[smoke_bitbuffers] ok");

delete globalThis.sourcejs;
