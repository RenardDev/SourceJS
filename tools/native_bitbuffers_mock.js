"use strict";

const g_NativeTypes = require("node:util").types;

const g_unBitsPerByte = 8;
const g_unByteIndexShift = 3;
const g_unBitIndexMask = g_unBitsPerByte - 1;
const g_unByteValueMask = 0xFF;
const g_unMaximumIntegerBitCount = 64;
const g_unUInt32BitCount = 32;
const g_unUInt16BitCount = 16;
const g_nMinimumInt32 = -0x80000000;
const g_nMaximumInt32 = 0x7FFFFFFF;
const g_unMaximumUInt32 = 0xFFFFFFFF;
const g_flFullRotationDegrees = 360;

const g_unCoordinateIntegerBits = 14;
const g_unCoordinateFractionalBits = 5;
const g_unCoordinateDenominator = 1 << g_unCoordinateFractionalBits;
const g_flCoordinateResolution = 1 / g_unCoordinateDenominator;
const g_unCoordinateIntegerBitsMP = 11;
const g_unCoordinateFractionalBitsMPLowPrecision = 3;
const g_unCoordinateDenominatorLowPrecision = 1 << g_unCoordinateFractionalBitsMPLowPrecision;
const g_flCoordinateResolutionLowPrecision = 1 / g_unCoordinateDenominatorLowPrecision;
const g_unNormalFractionalBits = 11;
const g_unNormalDenominator = (1 << g_unNormalFractionalBits) - 1;
const g_flNormalResolution = 1 / g_unNormalDenominator;

function GetByteLengthForBits(nBitCount) {
	return Math.max(0, Math.ceil(Number(nBitCount) / g_unBitsPerByte));
}

function ConvertToBytes(Value) {
	if (ArrayBuffer.isView(Value)) {
		return new Uint8Array(Value.buffer, Value.byteOffset, Value.byteLength);
	}

	if (g_NativeTypes.isArrayBuffer(Value)) {
		return new Uint8Array(Value);
	}

	// Match the native filesystem byte converter, including Symbol rejection.
	return Buffer.from(`${Value}`, "utf8");
}

function GetVectorComponents(Value) {
	const dblMaximumFloat = (2 - (2 ** -23)) * (2 ** 127);
	const ReadComponent = (ComponentValue) => {
		if ((ComponentValue === undefined) || (ComponentValue === null)) {
			throw new TypeError("bitbuffers vector components must not be nullish.");
		}

		// Unary plus matches V8 ToNumber, including rejection of BigInt and Symbol.
		const dblComponent = +ComponentValue;
		if (!Number.isFinite(dblComponent) || (Math.abs(dblComponent) > dblMaximumFloat)) {
			throw new Error("bitbuffers vector components must fit a finite float.");
		}

		return Math.fround(dblComponent);
	};

	if ((Value === undefined) || (Value === null)) {
		return [0, 0, 0];
	}

	if (Array.isArray(Value)) {
		return [ReadComponent(Value[0]), ReadComponent(Value[1]), ReadComponent(Value[2])];
	}

	if ((typeof Value !== "object") && (typeof Value !== "function")) {
		throw new TypeError("bitbuffers expects a vector or angle value.");
	}

	return [ReadComponent(Value.X ?? Value.Pitch), ReadComponent(Value.Y ?? Value.Yaw), ReadComponent(Value.Z ?? Value.Roll)];
}

function CreateVectorObject(flX, flY, flZ) {
	return { X: flX, Y: flY, Z: flZ };
}

function NormalizeUnsigned(unValue, unBitCount) {
	if (unBitCount <= 0) {
		return 0n;
	}

	return BigInt(unValue) & ((1n << BigInt(unBitCount)) - 1n);
}

function CreateState(Bytes, unBitCount = null) {
	const arrStateBytes = new Uint8Array(ConvertToBytes(Bytes));

	return {
		Bytes: arrStateBytes,
		DataBitCount: unBitCount ?? arrStateBytes.length * g_unBitsPerByte,
		DataByteCount: arrStateBytes.length,
		CurrentBit: 0,
		Overflowed: false,
	};
}

function ResizeForBits(State, nBitCount) {
	const unByteLength = GetByteLengthForBits(nBitCount);
	if (unByteLength > State.Bytes.length) {
		const arrBytes = new Uint8Array(unByteLength);
		arrBytes.set(State.Bytes);
		State.Bytes = arrBytes;
	}

	State.DataByteCount = State.Bytes.length;
	State.DataBitCount = Math.min(Math.max(0, Number(nBitCount) | 0), State.Bytes.length * g_unBitsPerByte);
	State.CurrentBit = Math.min(Math.max(0, State.CurrentBit | 0), State.DataBitCount);

	return State;
}

function CheckForOverflow(State, unBitCount = 0) {
	const bOverflow = (State.CurrentBit + Number(unBitCount)) > State.DataBitCount;
	if (bOverflow) {
		State.Overflowed = true;
	}

	return bOverflow;
}

function WriteOneBitAt(State, bValue, unBit) {
	const nBitPosition = +(unBit ?? 0) | 0;
	if (nBitPosition < 0) {
		throw new Error("bitbuffers.WriteOneBitAt expects a nonnegative bit index.");
	}

	if (nBitPosition >= State.DataBitCount) {
		State.Overflowed = true;
		return false;
	}

	const unByteIndex = nBitPosition >> g_unByteIndexShift;
	const unBitIndex = nBitPosition & g_unBitIndexMask;

	if (bValue) {
		State.Bytes[unByteIndex] |= 1 << unBitIndex;
	} else {
		State.Bytes[unByteIndex] &= ~(1 << unBitIndex);
	}

	return !State.Overflowed;
}

function WriteOneBitNoCheck(State, bValue) {
	if (CheckForOverflow(State, 1)) {
		return false;
	}

	WriteOneBitAt(State, bValue, State.CurrentBit);
	State.CurrentBit += 1;

	return !State.Overflowed;
}

function WriteOneBit(State, bValue) {
	if (CheckForOverflow(State, 1)) {
		return false;
	}

	WriteOneBitNoCheck(State, bValue);

	return !State.Overflowed;
}

function WriteUBitLong(State, unInputValue, unBitCount, bCheckRange = true) {
	const nNormalizedBitCount = Number(unBitCount) | 0;
	if ((nNormalizedBitCount < 0) || (nNormalizedBitCount > g_unMaximumIntegerBitCount)) {
		return false;
	}

	if (CheckForOverflow(State, nNormalizedBitCount)) {
		State.CurrentBit = State.DataBitCount;
		return false;
	}

	if (bCheckRange && ((BigInt(unInputValue) < 0n) || ((nNormalizedBitCount < g_unMaximumIntegerBitCount) && (BigInt(unInputValue) >= (1n << BigInt(nNormalizedBitCount)))))) {
		State.Overflowed = true;
		return false;
	}

	let unNormalizedValue = NormalizeUnsigned(unInputValue, nNormalizedBitCount);

	for (let unBitOffset = 0; unBitOffset < nNormalizedBitCount; unBitOffset += 1) {
		WriteOneBitNoCheck(State, (unNormalizedValue & 1n) === 1n);
		unNormalizedValue >>= 1n;
	}

	return true;
}

function ReadOneBit(State) {
	if (CheckForOverflow(State, 1)) {
		return 0;
	}

	const unByteIndex = State.CurrentBit >> g_unByteIndexShift;
	const unBitIndex = State.CurrentBit & g_unBitIndexMask;
	const unValue = (State.Bytes[unByteIndex] >> unBitIndex) & 1;

	State.CurrentBit += 1;

	return unValue;
}

function ReadUBitLong(State, unBitCount) {
	const nNormalizedBitCount = Number(unBitCount) | 0;
	if ((nNormalizedBitCount < 0) || (nNormalizedBitCount > g_unMaximumIntegerBitCount)) {
		return 0;
	}

	if (CheckForOverflow(State, nNormalizedBitCount)) {
		State.CurrentBit = State.DataBitCount;
		return 0;
	}

	let unValue = 0n;

	for (let unBitOffset = 0; unBitOffset < nNormalizedBitCount; unBitOffset += 1) {
		if (ReadOneBit(State)) {
			unValue |= 1n << BigInt(unBitOffset);
		}
	}

	return (nNormalizedBitCount > g_unUInt32BitCount) ? unValue : Number(unValue);
}

function WriteString(State, strValue) {
	const strText = (arguments.length < 2) ? "" : `${strValue}`;
	const arrUTF8Bytes = Buffer.from(strText, "utf8");
	const nTerminatorIndex = arrUTF8Bytes.indexOf(0);
	const unTextBytes = (nTerminatorIndex < 0) ? arrUTF8Bytes.length : nTerminatorIndex;

	for (let unIndex = 0; unIndex <= unTextBytes; unIndex += 1) {
		// TF2 profile: each byte is a separate capacity-checked write, including the terminator.
		if ((State.DataBitCount - State.CurrentBit) < g_unBitsPerByte) {
			State.CurrentBit = State.DataBitCount;
			State.Overflowed = true;
			continue;
		}

		const unByte = (unIndex === unTextBytes) ? 0 : arrUTF8Bytes[unIndex];
		WriteUBitLong(State, unByte, g_unBitsPerByte, false);
	}

	return !State.Overflowed;
}

function ReadString(State) {
	const unMaximumStringByteCount = 4095;
	const vecBytes = [];
	let bTooSmall = false;

	while (true) {
		if ((State.DataBitCount - State.CurrentBit) < g_unBitsPerByte) {
			State.Overflowed = true;
			State.CurrentBit = State.DataBitCount;
			break;
		}

		const unByteValue = Number(ReadUBitLong(State, g_unBitsPerByte));
		if (unByteValue === 0) {
			break;
		}

		if (vecBytes.length < unMaximumStringByteCount) {
			vecBytes.push(unByteValue);
		} else {
			bTooSmall = true;
		}
	}

	if (State.Overflowed || bTooSmall) {
		throw new Error("bitbuffers.ReadString failed: the input overflowed or the string exceeds 4095 bytes.");
	}

	return Buffer.from(vecBytes).toString("utf8");
}

function WriteBitCoord(State, flValue) {
	const unCoordinateLimit = (2 ** g_unCoordinateIntegerBits) + 1;
	const flCoordinate = Math.fround(+(flValue ?? 0));
	if (!Number.isFinite(flCoordinate)) {
		throw new Error("bitbuffers.WriteBitCoord(State, flValue) expects a numeric value.");
	}

	if (Math.abs(flCoordinate) >= unCoordinateLimit) {
		throw new Error("bitbuffers.WriteBitCoord value exceeds the SDK coordinate encoding range.");
	}

	const bSign = flCoordinate <= -g_flCoordinateResolution;
	const unInteger = Math.abs(Math.trunc(flCoordinate));
	const unFraction = Math.abs(Math.trunc(flCoordinate * g_unCoordinateDenominator)) & (g_unCoordinateDenominator - 1);
	const bHasInteger = unInteger !== 0;
	const bHasFraction = unFraction !== 0;

	WriteOneBit(State, bHasInteger);
	WriteOneBit(State, bHasFraction);

	if (bHasInteger || bHasFraction) {
		WriteOneBit(State, bSign);

		if (bHasInteger) {
			WriteUBitLong(State, unInteger - 1, g_unCoordinateIntegerBits);
		}

		if (bHasFraction) {
			WriteUBitLong(State, unFraction, g_unCoordinateFractionalBits);
		}
	}

	return !State.Overflowed;
}

function ReadBitCoord(State) {
	const bHasInteger = ReadOneBit(State) !== 0;
	const bHasFraction = ReadOneBit(State) !== 0;

	if (!bHasInteger && !bHasFraction) {
		return 0;
	}

	const bSign = ReadOneBit(State) !== 0;
	const unInteger = bHasInteger ? (ReadUBitLong(State, g_unCoordinateIntegerBits) + 1) : 0;
	const unFraction = bHasFraction ? ReadUBitLong(State, g_unCoordinateFractionalBits) : 0;
	const flValue = unInteger + unFraction * g_flCoordinateResolution;

	return bSign ? -flValue : flValue;
}

function WriteBitCoordMP(State, flValue, bIntegral = false, bLowPrecision = false) {
	const unCoordinateLimit = (2 ** g_unCoordinateIntegerBits) + 1;
	const flCoordinate = Math.fround(+(flValue ?? 0));
	if (!Number.isFinite(flCoordinate)) {
		throw new Error("bitbuffers.WriteBitCoordMP(State, flValue, bIntegral?, bLowPrecision?) expects a numeric value.");
	}

	if (Math.abs(flCoordinate) >= unCoordinateLimit) {
		throw new Error("bitbuffers.WriteBitCoordMP value exceeds the SDK coordinate encoding range.");
	}

	const flResolution = bLowPrecision ? g_flCoordinateResolutionLowPrecision : g_flCoordinateResolution;
	const unDenominator = bLowPrecision ? g_unCoordinateDenominatorLowPrecision : g_unCoordinateDenominator;
	const unFractionalBitCount = bLowPrecision ? g_unCoordinateFractionalBitsMPLowPrecision : g_unCoordinateFractionalBits;
	const bSign = flCoordinate <= -flResolution;
	const unInteger = Math.abs(Math.trunc(flCoordinate));
	const unFraction = Math.abs(Math.trunc(flCoordinate * unDenominator)) & (unDenominator - 1);
	const bInBounds = unInteger < (1 << g_unCoordinateIntegerBitsMP);

	WriteOneBit(State, bInBounds);

	if (bIntegral) {
		const bHasInteger = unInteger !== 0;
		WriteOneBit(State, bHasInteger);

		if (bHasInteger) {
			WriteOneBit(State, bSign);
			WriteUBitLong(State, unInteger - 1, bInBounds ? g_unCoordinateIntegerBitsMP : g_unCoordinateIntegerBits);
		}
	} else {
		const bHasInteger = unInteger !== 0;
		WriteOneBit(State, bHasInteger);
		WriteOneBit(State, bSign);

		if (bHasInteger) {
			WriteUBitLong(State, unInteger - 1, bInBounds ? g_unCoordinateIntegerBitsMP : g_unCoordinateIntegerBits);
		}

		WriteUBitLong(State, unFraction, unFractionalBitCount);
	}

	return !State.Overflowed;
}

function ReadBitCoordMP(State, bIntegral = false, bLowPrecision = false) {
	const bInBounds = ReadOneBit(State) !== 0;
	const bHasInteger = ReadOneBit(State) !== 0;
	const unIntegerBitCount = bInBounds ? g_unCoordinateIntegerBitsMP : g_unCoordinateIntegerBits;
	const flResolution = bLowPrecision ? g_flCoordinateResolutionLowPrecision : g_flCoordinateResolution;
	const unFractionalBitCount = bLowPrecision ? g_unCoordinateFractionalBitsMPLowPrecision : g_unCoordinateFractionalBits;

	if (bIntegral) {
		if (!bHasInteger) {
			return 0;
		}

		const bSign = ReadOneBit(State) !== 0;
		const unValue = ReadUBitLong(State, unIntegerBitCount) + 1;

		return bSign ? -unValue : unValue;
	}

	const bSign = ReadOneBit(State) !== 0;
	const unInteger = bHasInteger ? (ReadUBitLong(State, unIntegerBitCount) + 1) : 0;
	const unFraction = ReadUBitLong(State, unFractionalBitCount);
	const flValue = unInteger + (unFraction * flResolution);

	return bSign ? -flValue : flValue;
}

function WriteBitFloat(State, flValue) {
	const dblMaximumFloat = 3.4028234663852886e38;
	const unFloatBytes = 4;
	const unFloatBits = g_unUInt32BitCount;
	const dblValue = +(flValue ?? 0);
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumFloat)) {
		throw new Error("bitbuffers float writer expects a finite value within the float range.");
	}

	const Data = new DataView(new ArrayBuffer(unFloatBytes));
	Data.setFloat32(0, dblValue, true);

	return WriteUBitLong(State, Data.getUint32(0, true), unFloatBits);
}

function WriteFloat(State, flValue) {
	return WriteBitFloat(State, flValue);
}

function ReadBitFloat(State) {
	const unFloatBytes = 4;
	const unFloatBits = g_unUInt32BitCount;
	const DataViewValue = new DataView(new ArrayBuffer(unFloatBytes));
	DataViewValue.setUint32(0, Number(ReadUBitLong(State, unFloatBits)) >>> 0, true);

	return DataViewValue.getFloat32(0, true);
}

function ReadFloat(State) {
	return ReadBitFloat(State);
}

function WriteBitNormal(State, flValue) {
	const dblMaximumFloat = 3.4028234663852886e38;
	const dblValue = +(flValue ?? 0);
	if (!Number.isFinite(dblValue) || (Math.abs(dblValue) > dblMaximumFloat)) {
		throw new Error("bitbuffers.WriteBitNormal(State, flValue) expects a numeric value.");
	}

	const flNormal = Math.max(-1, Math.min(1, Math.fround(dblValue)));
	const bSign = flNormal <= -g_flNormalResolution;
	let unFraction = Math.abs(Math.trunc(Math.fround(flNormal * g_unNormalDenominator)));

	if (unFraction > g_unNormalDenominator) {
		unFraction = g_unNormalDenominator;
	}

	WriteOneBit(State, bSign);
	WriteUBitLong(State, unFraction, g_unNormalFractionalBits);

	return !State.Overflowed;
}

function ReadBitNormal(State) {
	const bSign = ReadOneBit(State) !== 0;
	const unFraction = ReadUBitLong(State, g_unNormalFractionalBits);
	const flValue = unFraction * g_flNormalResolution;

	return bSign ? -flValue : flValue;
}

function NormalizeSDKBitCount(Value) {
	const nBitCount = +(Value ?? 0) | 0;
	if ((nBitCount < 0) || (nBitCount > g_unUInt32BitCount)) {
		throw new Error("BitBuffer bit count must be between 0 and 32 for this SDK API.");
	}

	return nBitCount;
}

function CreateBitBufferAPI() {
	const BitBufferAPI = {
		PackUInt32(unUInt32Value) {
			if ((typeof unUInt32Value !== "number") || !Number.isInteger(unUInt32Value) || Object.is(unUInt32Value, -0) || (unUInt32Value < 0) || (unUInt32Value > g_unMaximumUInt32)) {
				throw new TypeError("bitbuffers.PackUInt32(unUInt32Value) expects an unsigned 32-bit integer.");
			}

			return [unUInt32Value & g_unByteValueMask, (unUInt32Value >>> g_unBitsPerByte) & g_unByteValueMask, (unUInt32Value >>> g_unUInt16BitCount) & g_unByteValueMask, (unUInt32Value >>> (g_unUInt16BitCount + g_unBitsPerByte)) & g_unByteValueMask];
		},
		CreateWrite(SizeOrBytes = 0, nDataBitCount = null) {
			const bIsByteCount = (SizeOrBytes === null) || (SizeOrBytes === undefined) || (typeof SizeOrBytes === "number");
			const arrBytes = bIsByteCount ? new Uint8Array(Math.max(0, +(SizeOrBytes ?? 0) | 0)) : new Uint8Array(ConvertToBytes(SizeOrBytes));
			const State = CreateState(arrBytes);
			const nNormalizedDataBitCount = +(nDataBitCount ?? Math.min(State.Bytes.length * g_unBitsPerByte, g_nMaximumInt32)) | 0;

			return ResizeForBits(State, nNormalizedDataBitCount);
		},
		CreateRead(Source) {
			if (arguments.length === 0) {
				throw new TypeError("BitBufferRead requires bytes or a native state object.");
			}

			const bHasNativeState = (Source !== null) && ((typeof Source === "object") || (typeof Source === "function")) && !g_NativeTypes.isArrayBuffer(Source) && !ArrayBuffer.isView(Source);
			const SourceBytes = bHasNativeState ? Source.Bytes : Source;
			if (bHasNativeState && ((SourceBytes === undefined) || (SourceBytes === null))) {
				throw new TypeError("BitBufferRead source must expose Bytes.");
			}

			// The native callback snapshots bytes before metadata; its legacy copy flag is unused.
			const arrBytes = new Uint8Array(ConvertToBytes(SourceBytes));
			const unCapacityBitCount = Math.min(arrBytes.length * g_unBitsPerByte, g_nMaximumInt32);
			const DataBitCount = bHasNativeState ? Source.DataBitCount : undefined;
			if ((DataBitCount !== undefined) && (DataBitCount !== null) && ((typeof DataBitCount !== "number") || !Number.isInteger(DataBitCount) || Object.is(DataBitCount, -0) || (DataBitCount < g_nMinimumInt32) || (DataBitCount > g_nMaximumInt32))) {
				throw new TypeError("BitBuffer state expects integer bit-count and bit-index properties.");
			}

			const unDataBitCount = Math.min(Math.max(0, DataBitCount ?? unCapacityBitCount), unCapacityBitCount);

			return ResizeForBits(CreateState(arrBytes, unDataBitCount), unDataBitCount);
		},
		GetBytes(State) {
			return new Uint8Array(State.Bytes);
		},
		SetBytes(State, Value) {
			if ((Value === undefined) || (Value === null)) {
				throw new TypeError("bitbuffers.SetBytes(State, ByteSource) expects a byte source.");
			}

			State.Bytes = new Uint8Array(ConvertToBytes(Value));
			State.DataByteCount = State.Bytes.length;
			State.DataBitCount = Math.min(State.DataBitCount, State.Bytes.length * g_unBitsPerByte);
			State.CurrentBit = Math.min(State.CurrentBit, State.DataBitCount);

			return true;
		},
		GetDataBitCount(State) {
			return State.DataBitCount;
		},
		SetDataBitCount(State, nDataBitCount) {
			if (arguments.length < 2) {
				throw new TypeError("bitbuffers.SetDataBitCount(State, nDataBitCount) expects an integer bit count.");
			}

			ResizeForBits(State, +nDataBitCount | 0);

			return true;
		},
		GetDataByteCount(State) {
			return State.Bytes.length;
		},
		SetDataByteCount(State, nRequestedByteCount) {
			if (arguments.length < 2) {
				throw new TypeError("bitbuffers.SetDataByteCount(State, nRequestedByteCount) expects an integer byte count.");
			}

			const arrBytes = new Uint8Array(Math.max(0, +nRequestedByteCount | 0));
			arrBytes.set(State.Bytes.slice(0, arrBytes.length));
			State.Bytes = arrBytes;
			State.DataByteCount = arrBytes.length;
			State.DataBitCount = Math.min(State.DataBitCount, arrBytes.length * g_unBitsPerByte);
			State.CurrentBit = Math.min(State.CurrentBit, State.DataBitCount);

			return true;
		},
		GetCurrentBit(State) {
			return State.CurrentBit;
		},
		SetCurrentBit(State, nCurrentBitIndex) {
			if (arguments.length < 2) {
				throw new TypeError("bitbuffers.SetCurrentBit(State, nCurrentBitIndex) expects an integer bit index.");
			}

			State.CurrentBit = Math.max(0, Math.min(+nCurrentBitIndex | 0, State.DataBitCount));

			return true;
		},
		IsOverflowed(State) {
			return State.Overflowed;
		},
		SetOverflowFlag(State) {
			State.Overflowed = true;

			return true;
		},
		ClearOverflowFlag(State) {
			State.Overflowed = false;

			return true;
		},
		GetMaximumBitCount(State) {
			return State.DataBitCount;
		},
		GetRemainingBitCount(State) {
			return Math.max(0, State.DataBitCount - State.CurrentBit);
		},
		GetRemainingByteCount(State) {
			return GetByteLengthForBits(Math.max(0, State.DataBitCount - State.CurrentBit));
		},
		GetWrittenBitCount(State) {
			return State.CurrentBit;
		},
		GetWrittenByteCount(State) {
			return GetByteLengthForBits(State.CurrentBit);
		},
		GetReadBitCount(State) {
			return State.CurrentBit;
		},
		GetReadByteCount(State) {
			return GetByteLengthForBits(State.CurrentBit);
		},
		Reset(State) {
			State.Bytes.fill(0);
			State.CurrentBit = 0;
			State.Overflowed = false;

			return true;
		},
		CheckForOverflow(State, nRequestedBitCount = 0) {
			const nNormalizedBitCount = +(nRequestedBitCount ?? 0) | 0;
			if (nNormalizedBitCount > 0) {
				CheckForOverflow(State, nNormalizedBitCount);
			}

			return State.Overflowed;
		},
		SeekToBit(State, nBitIndex) {
			if (arguments.length < 2) {
				throw new TypeError("bitbuffers.SeekToBit(State, nBitIndex) expects an integer bit index.");
			}

			const nBitPosition = +nBitIndex | 0;
			if ((nBitPosition < 0) || (nBitPosition > State.DataBitCount)) {
				State.Overflowed = true;
				State.CurrentBit = State.DataBitCount;
				return false;
			}

			State.CurrentBit = nBitPosition;

			return true;
		},
		SeekRelative(State, nBitDelta) {
			if (arguments.length < 2) {
				throw new TypeError("bitbuffers.SeekRelative(State, nBitDelta) expects an integer bit delta.");
			}

			const nNormalizedBitDelta = +nBitDelta | 0;
			const nTargetBitIndex = State.CurrentBit + nNormalizedBitDelta;
			if ((nTargetBitIndex < 0) || (nTargetBitIndex > State.DataBitCount)) {
				State.Overflowed = true;
				State.CurrentBit = State.DataBitCount;
				return false;
			}

			State.CurrentBit = nTargetBitIndex;

			return true;
		},
		ToBytes(State) {
			return State.Bytes.slice(0, GetByteLengthForBits(State.CurrentBit));
		},
		WriteOneBit,
		WriteOneBitNoCheck,
		WriteOneBitAt(State, bValue, nBitIndex) {
			return WriteOneBitAt(State, bValue, nBitIndex);
		},
		WriteUBitLong(State, unInputValue, nRequestedBitCount) {
			const unNormalizedValue = +(unInputValue ?? 0) >>> 0;
			const nBitCount = NormalizeSDKBitCount(nRequestedBitCount);
			if (nBitCount === 0) {
				return !State.Overflowed;
			}

			if ((State.DataBitCount - State.CurrentBit) < nBitCount) {
				State.CurrentBit = State.DataBitCount;
				State.Overflowed = true;
				return false;
			}

			// The optional range flag controls SDK Debug diagnostics, not Release write acceptance.
			WriteUBitLong(State, unNormalizedValue, nBitCount, false);

			return !State.Overflowed;
		},
		WriteSBitLong(State, nInputValue, nRequestedBitCount) {
			const nValue = +(nInputValue ?? 0) | 0;
			const nBitCount = NormalizeSDKBitCount(nRequestedBitCount);
			if (nBitCount === 0) {
				return !State.Overflowed;
			}

			// TF2 profile: capacity is checked for the entire signed field.
			if ((State.DataBitCount - State.CurrentBit) < nBitCount) {
				State.CurrentBit = State.DataBitCount;
				State.Overflowed = true;
				return false;
			}

			const unSignBit = 1n << BigInt(nBitCount - 1);
			const unMagnitudeMask = unSignBit - 1n;
			const unEncodedValue = (BigInt(nValue) & unMagnitudeMask) | ((nValue < 0) ? unSignBit : 0n);
			WriteUBitLong(State, unEncodedValue, nBitCount, false);

			return !State.Overflowed;
		},
		WriteUBitVar(State, unInputValue) {
			const unTwoBlockThreshold = 0x1000;
			const unValue = +(unInputValue ?? 0) >>> 0;
			let unSelector = 0;
			let unFirstBlockBits = 6;
			if (unValue >= unTwoBlockThreshold) {
				unSelector = 3;
				unFirstBlockBits = 18;
			} else if (unValue >= 0x100) {
				unSelector = 2;
				unFirstBlockBits = 14;
			} else if (unValue >= 0x10) {
				unSelector = 1;
				unFirstBlockBits = 10;
			}

			// TF2 combines the selector and initial payload; large values add a second 16-bit block.
			const WriteBlock = (unBlockValue, unBlockBits) => {
				if ((State.DataBitCount - State.CurrentBit) < unBlockBits) {
					State.CurrentBit = State.DataBitCount;
					State.Overflowed = true;
					return;
				}

				WriteUBitLong(State, unBlockValue, unBlockBits, false);
			};

			WriteBlock(((unValue << 2) | unSelector) >>> 0, unFirstBlockBits);

			if (unValue >= unTwoBlockThreshold) {
				WriteBlock(unValue >>> g_unUInt16BitCount, g_unUInt16BitCount);
			}

			return !State.Overflowed;
		},
		WriteVarInt32(State, unInputValue) {
			const unPayloadMask = 0x7F;
			const unContinuationMask = 0x80;
			const unPayloadBitCount = 7;

			let unValue = +(unInputValue ?? 0) >>> 0;
			do {
				let unByteValue = unValue & unPayloadMask;
				unValue >>>= unPayloadBitCount;
				if (unValue !== 0) {
					unByteValue |= unContinuationMask;
				}

				// Native encoding attempts every byte and reports the resulting sticky flag.
				this.WriteByte(State, unByteValue);
			} while (unValue !== 0);

			return !State.Overflowed;
		},
		WriteBitsFromBuffer(State, Reader, nRequestedBitCount) {
			// Model native copy snapshots and property-store order, not the complete SDK parser.
			const ParseCopyState = (Source) => {
				const ParsedState = CreateState(Source.Bytes, Source.DataBitCount);
				ParsedState.CurrentBit = Source.CurrentBit;
				ParsedState.Overflowed = Source.Overflowed;

				return ParsedState;
			};
			const StoreCopyState = (Target, ParsedState) => {
				Target.Bytes = ParsedState.Bytes;
				Target.DataBitCount = ParsedState.DataBitCount;
				Target.DataByteCount = ParsedState.Bytes.length;
				Target.CurrentBit = ParsedState.CurrentBit;
				Target.Overflowed = ParsedState.Overflowed;
			};

			const WriterState = ParseCopyState(State);
			const ReaderState = ParseCopyState(Reader);
			const unMaximumBlockBits = g_unUInt32BitCount;
			const nBitCount = +nRequestedBitCount | 0;
			if (nBitCount < 0) {
				throw new Error("bitbuffers.WriteBitsFromBuffer bit count must not be negative.");
			}

			let unRemainingBits = nBitCount;
			while (unRemainingBits > 0) {
				const unBlockBits = Math.min(unRemainingBits, unMaximumBlockBits);
				let unValue = 0;
				if ((ReaderState.DataBitCount - ReaderState.CurrentBit) < unBlockBits) {
					ReaderState.CurrentBit = ReaderState.DataBitCount;
					ReaderState.Overflowed = true;
				} else {
					unValue = ReadUBitLong(ReaderState, unBlockBits);
				}

				if ((WriterState.DataBitCount - WriterState.CurrentBit) < unBlockBits) {
					WriterState.CurrentBit = WriterState.DataBitCount;
					WriterState.Overflowed = true;
				} else {
					WriteUBitLong(WriterState, unValue, unBlockBits);
				}

				unRemainingBits -= unBlockBits;
			}

			const bCopySucceeded = !WriterState.Overflowed && !ReaderState.Overflowed;
			StoreCopyState(State, WriterState);
			StoreCopyState(Reader, ReaderState);

			return bCopySucceeded;
		},
		WriteBitAngle(State, flAngleValue, nBitCount) {
			const dblMaximumFloat = 3.4028234663852886e38;
			const dblAngle = +(flAngleValue ?? 0);
			if (!Number.isFinite(dblAngle) || (Math.abs(dblAngle) > dblMaximumFloat)) {
				throw new Error("bitbuffers.WriteBitAngle(State, flAngleValue, nBitCount) expects a numeric value.");
			}

			const flNormalizedAngle = Math.fround(dblAngle);
			const nNormalizedBitCount = NormalizeSDKBitCount(nBitCount);
			const unAngleScale = 2 ** nNormalizedBitCount;
			let nEncodedAngle = Math.trunc(((flNormalizedAngle % g_flFullRotationDegrees) / g_flFullRotationDegrees) * unAngleScale);
			if (nEncodedAngle < 0) {
				nEncodedAngle += unAngleScale;
			}

			return BitBufferAPI.WriteUBitLong(State, nEncodedAngle, nNormalizedBitCount);
		},
		WriteBitCoord,
		WriteBitCoordMP,
		WriteBitFloat,
		WriteBitVec3Coord(State, VectorValue) {
			const unCoordinateLimit = (2 ** g_unCoordinateIntegerBits) + 1;
			const vecComponents = GetVectorComponents(VectorValue);
			for (const flComponent of vecComponents) {
				if (Math.abs(flComponent) >= unCoordinateLimit) {
					throw new Error("bitbuffers.WriteBitVec3Coord component exceeds the SDK coordinate encoding range.");
				}
			}

			const [flX, flY, flZ] = vecComponents;

			for (const bComponentPresent of [(flX >= g_flCoordinateResolution) || (flX <= -g_flCoordinateResolution), (flY >= g_flCoordinateResolution) || (flY <= -g_flCoordinateResolution), (flZ >= g_flCoordinateResolution) || (flZ <= -g_flCoordinateResolution)]) {
				WriteOneBit(State, bComponentPresent);
			}

			if ((flX >= g_flCoordinateResolution) || (flX <= -g_flCoordinateResolution)) {
				this.WriteBitCoord(State, flX);
			}

			if ((flY >= g_flCoordinateResolution) || (flY <= -g_flCoordinateResolution)) {
				this.WriteBitCoord(State, flY);
			}

			if ((flZ >= g_flCoordinateResolution) || (flZ <= -g_flCoordinateResolution)) {
				this.WriteBitCoord(State, flZ);
			}

			return !State.Overflowed;
		},
		WriteBitNormal,
		WriteBitVec3Normal(State, VectorValue) {
			const [flX, flY, flZ] = GetVectorComponents(VectorValue);
			const bXFlag = (flX >= g_flNormalResolution) || (flX <= -g_flNormalResolution);
			const bYFlag = (flY >= g_flNormalResolution) || (flY <= -g_flNormalResolution);

			WriteOneBit(State, bXFlag);
			WriteOneBit(State, bYFlag);

			if (bXFlag) {
				WriteBitNormal(State, flX);
			}

			if (bYFlag) {
				WriteBitNormal(State, flY);
			}

			WriteOneBit(State, flZ <= -g_flNormalResolution);

			return !State.Overflowed;
		},
		WriteBitAngles(State, AngleValue) {
			const unCoordinateLimit = (2 ** g_unCoordinateIntegerBits) + 1;
			const vecComponents = GetVectorComponents(AngleValue);
			for (const flComponent of vecComponents) {
				if (Math.abs(flComponent) >= unCoordinateLimit) {
					throw new Error("bitbuffers.WriteBitAngles components exceed the SDK coordinate encoding range.");
				}
			}

			return this.WriteBitVec3Coord(State, vecComponents);
		},
		WriteByte(State, unInputValue) {
			const unValue = +(unInputValue ?? 0) & g_unByteValueMask;
			if ((State.DataBitCount - State.CurrentBit) < g_unBitsPerByte) {
				State.CurrentBit = State.DataBitCount;
				State.Overflowed = true;
				return false;
			}

			WriteUBitLong(State, unValue, g_unBitsPerByte);

			return !State.Overflowed;
		},
		WriteChar(State, nInputValue) {
			const unMagnitudeMask = 0x7F;
			const unSignMask = 0x80;
			const nValue = +(nInputValue ?? 0) | 0;
			const unEncodedValue = (nValue & unMagnitudeMask) | ((nValue < 0) ? unSignMask : 0);
			if ((State.DataBitCount - State.CurrentBit) < g_unBitsPerByte) {
				State.CurrentBit = State.DataBitCount;
				State.Overflowed = true;
				return false;
			}

			WriteUBitLong(State, unEncodedValue, g_unBitsPerByte, false);

			return !State.Overflowed;
		},
		WriteShort(State, nInputValue) {
			return this.WriteSBitLong(State, nInputValue, g_unUInt16BitCount);
		},
		WriteWord(State, unInputValue) {
			const unWordBitCount = g_unUInt16BitCount;
			const unValue = +(unInputValue ?? 0) >>> 0;

			return this.WriteUBitLong(State, unValue, unWordBitCount);
		},
		WriteLong(State, nInputValue) {
			const unLongBitCount = g_unUInt32BitCount;
			const nValue = +(nInputValue ?? 0) | 0;

			return this.WriteSBitLong(State, nValue, unLongBitCount);
		},
		WriteLongLong(State, nInputValue) {
			const nMinimumValue = -(1n << 63n);
			const nMaximumValue = (1n << 63n) - 1n;
			const nValue = nInputValue ?? 0n;
			if ((typeof nValue !== "bigint") || (nValue < nMinimumValue) || (nValue > nMaximumValue)) {
				throw new Error("bitbuffers.WriteLongLong expects a signed 64-bit BigInt value.");
			}

			const unValue = BigInt.asUintN(g_unMaximumIntegerBitCount, nValue);
			const unLowWord = Number(BigInt.asUintN(g_unUInt32BitCount, unValue));
			const unHighWord = Number(unValue >> BigInt(g_unUInt32BitCount));

			// The native callback always attempts both words, including a partial overrun.
			BitBufferAPI.WriteUBitLong(State, unLowWord, g_unUInt32BitCount);
			BitBufferAPI.WriteUBitLong(State, unHighWord, g_unUInt32BitCount);

			return !State.Overflowed;
		},
		WriteFloat,
		WriteString,
		ReadOneBit,
		ReadUBitLong(State, nBitCount) {
			return ReadUBitLong(State, NormalizeSDKBitCount(nBitCount));
		},
		PeekUBitLong(State, nBitCount) {
			const nNormalizedBitCount = NormalizeSDKBitCount(nBitCount);
			const unPreviousCurrentBit = State.CurrentBit;
			const bWasOverflowed = State.Overflowed;
			const unValue = ReadUBitLong(State, nNormalizedBitCount);

			State.CurrentBit = unPreviousCurrentBit;
			State.Overflowed = bWasOverflowed;

			return unValue;
		},
		ReadSBitLong(State, nBitCount) {
			const nNormalizedBitCount = NormalizeSDKBitCount(nBitCount);
			const unEncodedValue = BigInt(ReadUBitLong(State, nNormalizedBitCount));
			if (nNormalizedBitCount === 0) {
				return 0;
			}

			const unSignBit = 1n << BigInt(nNormalizedBitCount - 1);
			const nSignedValue = ((unEncodedValue & unSignBit) !== 0n) ? (unEncodedValue - (1n << BigInt(nNormalizedBitCount))) : unEncodedValue;

			return Number(nSignedValue);
		},
		// This test double uses the TF2/L4D2 low-selector wire layout.
		ReadUBitVar(State) {
			const unPrefix = ReadUBitLong(State, 2);
			if (unPrefix === 0) {
				return ReadUBitLong(State, 4);
			}

			if (unPrefix === 1) {
				return ReadUBitLong(State, g_unBitsPerByte);
			}

			if (unPrefix === 2) {
				return ReadUBitLong(State, 12);
			}

			return ReadUBitLong(State, g_unUInt32BitCount);
		},
		ReadVarInt32(State) {
			const unMaximumValue = 0xFFFFFFFF;
			const unMaximumBitShift = 35;
			const unByteBitCount = g_unBitsPerByte;
			const unPayloadBitCount = 7;
			const unDataMask = 0x7F;
			const unContinuationMask = 0x80;
			let unBitShift = 0;
			let unResultValue = 0;

			while (unBitShift < unMaximumBitShift) {
				if ((State.DataBitCount - State.CurrentBit) < unByteBitCount) {
					State.CurrentBit = State.DataBitCount;
					State.Overflowed = true;
					return unResultValue;
				}

				const unByteValue = this.ReadByte(State);
				const unPayload = unByteValue & unDataMask;
				if (unPayload > (unMaximumValue >>> unBitShift)) {
					State.Overflowed = true;
					return unResultValue;
				}

				unResultValue += unPayload * (2 ** unBitShift);

				if ((unByteValue & unContinuationMask) === 0) {
					return unResultValue;
				}

				unBitShift += unPayloadBitCount;
			}

			State.Overflowed = true;

			return unResultValue;
		},
		ReadBitAngle(State, nBitCount) {
			const nNormalizedBitCount = NormalizeSDKBitCount(nBitCount);

			return Math.fround(Math.fround(ReadUBitLong(State, nNormalizedBitCount)) * (g_flFullRotationDegrees / (2 ** nNormalizedBitCount)));
		},
		ReadBitCoord,
		ReadBitCoordMP,
		ReadBitFloat,
		ReadBitNormal,
		ReadBitVec3Coord(State) {
			const bHasX = ReadOneBit(State) !== 0;
			const bHasY = ReadOneBit(State) !== 0;
			const bHasZ = ReadOneBit(State) !== 0;

			return CreateVectorObject(bHasX ? ReadBitCoord(State) : 0, bHasY ? ReadBitCoord(State) : 0, bHasZ ? ReadBitCoord(State) : 0);
		},
		ReadBitVec3Normal(State) {
			const bHasX = ReadOneBit(State) !== 0;
			const bHasY = ReadOneBit(State) !== 0;
			const flX = bHasX ? ReadBitNormal(State) : 0;
			const flY = bHasY ? ReadBitNormal(State) : 0;
			const bZIsNegative = ReadOneBit(State) !== 0;
			let flZ = Math.sqrt(Math.max(0, 1 - flX * flX - flY * flY));

			if (bZIsNegative) {
				flZ = -flZ;
			}

			return CreateVectorObject(flX, flY, flZ);
		},
		ReadBitAngles(State) {
			return this.ReadBitVec3Coord(State);
		},
		ReadByte(State) {
			return ReadUBitLong(State, g_unBitsPerByte);
		},
		ReadChar(State) {
			return this.ReadSBitLong(State, g_unBitsPerByte);
		},
		ReadShort(State) {
			return this.ReadSBitLong(State, g_unUInt16BitCount);
		},
		ReadWord(State) {
			return ReadUBitLong(State, g_unUInt16BitCount);
		},
		ReadLong(State) {
			return this.ReadSBitLong(State, g_unUInt32BitCount);
		},
		ReadLongLong(State) {
			const unLowWord = BigInt(BitBufferAPI.ReadUBitLong(State, g_unUInt32BitCount));
			const unHighWord = BigInt(BitBufferAPI.ReadUBitLong(State, g_unUInt32BitCount));

			return BigInt.asIntN(g_unMaximumIntegerBitCount, unLowWord | (unHighWord << BigInt(g_unUInt32BitCount)));
		},
		ReadFloat,
		ReadString,
	};

	return BitBufferAPI;
}

function InstallBitBuffersMock(Global = globalThis) {
	Global.sourcejs ??= {};
	Global.sourcejs.bitbuffers = CreateBitBufferAPI();

	return Global.sourcejs.bitbuffers;
}

module.exports = {
	CreateBitBufferAPI,
	InstallBitBuffersMock,
};
