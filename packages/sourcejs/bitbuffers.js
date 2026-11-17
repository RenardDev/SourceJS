"use strict";

const { GetModule } = require("internal/runtime");

const g_BitBuffersRuntime = GetModule("bitbuffers");

function PackUInt32(unUInt32Value) {
	return g_BitBuffersRuntime.PackUInt32(unUInt32Value);
}

class BitBufferBase {
	constructor(NativeState) {
		this.m_NativeState = NativeState;
	}

	IsOverflowed() {
		return g_BitBuffersRuntime.IsOverflowed(this.m_NativeState);
	}

	SetOverflowFlag() {
		return g_BitBuffersRuntime.SetOverflowFlag(this.m_NativeState);
	}

	ClearOverflowFlag() {
		return g_BitBuffersRuntime.ClearOverflowFlag(this.m_NativeState);
	}

	CheckForOverflow(nRequestedBitCount = 0) {
		return g_BitBuffersRuntime.CheckForOverflow(this.m_NativeState, nRequestedBitCount);
	}

	SeekToBit(nBitIndex) {
		return g_BitBuffersRuntime.SeekToBit(this.m_NativeState, nBitIndex);
	}

	get Bytes() {
		return g_BitBuffersRuntime.GetBytes(this.m_NativeState);
	}

	set Bytes(ByteSource) {
		g_BitBuffersRuntime.SetBytes(this.m_NativeState, ByteSource);
	}

	get DataBitCount() {
		return g_BitBuffersRuntime.GetDataBitCount(this.m_NativeState);
	}

	set DataBitCount(nDataBitCount) {
		g_BitBuffersRuntime.SetDataBitCount(this.m_NativeState, nDataBitCount);
	}

	get DataByteCount() {
		return g_BitBuffersRuntime.GetDataByteCount(this.m_NativeState);
	}

	set DataByteCount(nRequestedByteCount) {
		g_BitBuffersRuntime.SetDataByteCount(this.m_NativeState, nRequestedByteCount);
	}

	get CurrentBit() {
		return g_BitBuffersRuntime.GetCurrentBit(this.m_NativeState);
	}

	set CurrentBit(nCurrentBitIndex) {
		g_BitBuffersRuntime.SetCurrentBit(this.m_NativeState, nCurrentBitIndex);
	}

	get Overflowed() {
		return g_BitBuffersRuntime.IsOverflowed(this.m_NativeState);
	}

	set Overflowed(bOverflowed) {
		if (typeof bOverflowed !== "boolean") {
			throw new TypeError("Overflowed must be a boolean.");
		}

		if (bOverflowed) {
			g_BitBuffersRuntime.SetOverflowFlag(this.m_NativeState);
		} else {
			g_BitBuffersRuntime.ClearOverflowFlag(this.m_NativeState);
		}
	}

	get MaximumBitCount() {
		return g_BitBuffersRuntime.GetMaximumBitCount(this.m_NativeState);
	}

	get RemainingBitCount() {
		return g_BitBuffersRuntime.GetRemainingBitCount(this.m_NativeState);
	}

	get RemainingByteCount() {
		return g_BitBuffersRuntime.GetRemainingByteCount(this.m_NativeState);
	}
}

function GetBitBufferState(BitBufferOrState) {
	return (BitBufferOrState instanceof BitBufferBase) ? BitBufferOrState.m_NativeState : BitBufferOrState;
}

// Writer copies accept readers, and reader creation accepts writer snapshots; both classes exist before these methods run.
class BitBufferWrite extends BitBufferBase {
	constructor(DataByteCountOrBytes = 0, nDataBitCount = null) {
		super(g_BitBuffersRuntime.CreateWrite(DataByteCountOrBytes, nDataBitCount));
	}

	ResetBuffer() {
		return g_BitBuffersRuntime.Reset(this.m_NativeState);
	}

	WriteOneBit(bValue) {
		return g_BitBuffersRuntime.WriteOneBit(this.m_NativeState, bValue);
	}

	WriteOneBitWithoutCheck(bValue) {
		return g_BitBuffersRuntime.WriteOneBitNoCheck(this.m_NativeState, bValue);
	}

	WriteOneBitAt(bBitValue, nBitIndex) {
		return g_BitBuffersRuntime.WriteOneBitAt(this.m_NativeState, bBitValue, nBitIndex);
	}

	WriteUBitLong(unValue, nBitCount, bCheckRange = true) {
		return g_BitBuffersRuntime.WriteUBitLong(this.m_NativeState, unValue, nBitCount, bCheckRange);
	}

	WriteSBitLong(nIntegerValue, nBitCount) {
		return g_BitBuffersRuntime.WriteSBitLong(this.m_NativeState, nIntegerValue, nBitCount);
	}

	WriteUBitVar(unValue) {
		return g_BitBuffersRuntime.WriteUBitVar(this.m_NativeState, unValue);
	}

	WriteVarInt32(unValue) {
		return g_BitBuffersRuntime.WriteVarInt32(this.m_NativeState, unValue);
	}

	WriteBitsFromBuffer(Buffer, nBitCount) {
		const SourceReader = (Buffer instanceof BitBufferRead) ? Buffer : new BitBufferRead(Buffer);

		return g_BitBuffersRuntime.WriteBitsFromBuffer(this.m_NativeState, SourceReader.m_NativeState, nBitCount);
	}

	WriteBitAngle(flAngleValue, nBitCount) {
		return g_BitBuffersRuntime.WriteBitAngle(this.m_NativeState, flAngleValue, nBitCount);
	}

	WriteBitCoord(flCoordinateValue) {
		return g_BitBuffersRuntime.WriteBitCoord(this.m_NativeState, flCoordinateValue);
	}

	WriteBitCoordMP(flCoordinateValue, bIntegral = false, bLowPrecision = false) {
		return g_BitBuffersRuntime.WriteBitCoordMP(this.m_NativeState, flCoordinateValue, bIntegral, bLowPrecision);
	}

	WriteBitFloat(flValue) {
		return g_BitBuffersRuntime.WriteBitFloat(this.m_NativeState, flValue);
	}

	WriteBitVec3Coord(CoordinateVector) {
		return g_BitBuffersRuntime.WriteBitVec3Coord(this.m_NativeState, CoordinateVector);
	}

	WriteBitNormal(flNormalValue) {
		return g_BitBuffersRuntime.WriteBitNormal(this.m_NativeState, flNormalValue);
	}

	WriteBitVec3Normal(NormalVector) {
		return g_BitBuffersRuntime.WriteBitVec3Normal(this.m_NativeState, NormalVector);
	}

	WriteBitAngles(AngleVector) {
		return g_BitBuffersRuntime.WriteBitAngles(this.m_NativeState, AngleVector);
	}

	WriteChar(nValue) {
		return g_BitBuffersRuntime.WriteChar(this.m_NativeState, nValue);
	}

	WriteByte(nValue) {
		return g_BitBuffersRuntime.WriteByte(this.m_NativeState, nValue);
	}

	WriteShort(nValue) {
		return g_BitBuffersRuntime.WriteShort(this.m_NativeState, nValue);
	}

	WriteWord(nValue) {
		return g_BitBuffersRuntime.WriteWord(this.m_NativeState, nValue);
	}

	WriteLong(nValue) {
		return g_BitBuffersRuntime.WriteLong(this.m_NativeState, nValue);
	}

	WriteLongLong(nInt64Value) {
		return g_BitBuffersRuntime.WriteLongLong(this.m_NativeState, nInt64Value);
	}

	WriteFloat(flValue) {
		return g_BitBuffersRuntime.WriteFloat(this.m_NativeState, flValue);
	}

	WriteString(strValue) {
		return g_BitBuffersRuntime.WriteString(this.m_NativeState, strValue);
	}

	ToBytes() {
		return g_BitBuffersRuntime.ToBytes(this.m_NativeState);
	}

	get WrittenBitCount() {
		return g_BitBuffersRuntime.GetWrittenBitCount(this.m_NativeState);
	}

	get WrittenByteCount() {
		return g_BitBuffersRuntime.GetWrittenByteCount(this.m_NativeState);
	}
}

// Source conversion and BitBufferRead construction are mutually dependent; conversion runs after class initialization.
function ReadBitBufferSource(Value) {
	if (Value instanceof BitBufferWrite) {
		return { Bytes: Value.Bytes, DataBitCount: Value.WrittenBitCount };
	}

	if (Value instanceof BitBufferRead) {
		return { Bytes: Value.Bytes, DataBitCount: Value.DataBitCount };
	}

	return GetBitBufferState(Value);
}

class BitBufferRead extends BitBufferBase {
	constructor(Source, bCreateCopy = true) {
		super(g_BitBuffersRuntime.CreateRead(ReadBitBufferSource(Source), bCreateCopy));
	}

	ReadOneBit() {
		return g_BitBuffersRuntime.ReadOneBit(this.m_NativeState);
	}

	ReadUBitLong(nBitCount) {
		return g_BitBuffersRuntime.ReadUBitLong(this.m_NativeState, nBitCount);
	}

	PeekUBitLong(nBitCount) {
		return g_BitBuffersRuntime.PeekUBitLong(this.m_NativeState, nBitCount);
	}

	ReadSBitLong(nBitCount) {
		return g_BitBuffersRuntime.ReadSBitLong(this.m_NativeState, nBitCount);
	}

	ReadUBitVar() {
		return g_BitBuffersRuntime.ReadUBitVar(this.m_NativeState);
	}

	ReadVarInt32() {
		return g_BitBuffersRuntime.ReadVarInt32(this.m_NativeState);
	}

	ReadBitAngle(nBitCount) {
		return g_BitBuffersRuntime.ReadBitAngle(this.m_NativeState, nBitCount);
	}

	ReadBitCoord() {
		return g_BitBuffersRuntime.ReadBitCoord(this.m_NativeState);
	}

	ReadBitCoordMP(bIntegral = false, bLowPrecision = false) {
		return g_BitBuffersRuntime.ReadBitCoordMP(this.m_NativeState, bIntegral, bLowPrecision);
	}

	ReadBitFloat() {
		return g_BitBuffersRuntime.ReadBitFloat(this.m_NativeState);
	}

	ReadBitNormal() {
		return g_BitBuffersRuntime.ReadBitNormal(this.m_NativeState);
	}

	ReadBitVec3Coord() {
		return g_BitBuffersRuntime.ReadBitVec3Coord(this.m_NativeState);
	}

	ReadBitVec3Normal() {
		return g_BitBuffersRuntime.ReadBitVec3Normal(this.m_NativeState);
	}

	ReadBitAngles() {
		return g_BitBuffersRuntime.ReadBitAngles(this.m_NativeState);
	}

	ReadChar() {
		return g_BitBuffersRuntime.ReadChar(this.m_NativeState);
	}

	ReadByte() {
		return g_BitBuffersRuntime.ReadByte(this.m_NativeState);
	}

	ReadShort() {
		return g_BitBuffersRuntime.ReadShort(this.m_NativeState);
	}

	ReadWord() {
		return g_BitBuffersRuntime.ReadWord(this.m_NativeState);
	}

	ReadLong() {
		return g_BitBuffersRuntime.ReadLong(this.m_NativeState);
	}

	ReadLongLong() {
		return g_BitBuffersRuntime.ReadLongLong(this.m_NativeState);
	}

	ReadFloat() {
		return g_BitBuffersRuntime.ReadFloat(this.m_NativeState);
	}

	ReadString() {
		return g_BitBuffersRuntime.ReadString(this.m_NativeState);
	}

	SeekRelative(nBitDelta) {
		return g_BitBuffersRuntime.SeekRelative(this.m_NativeState, nBitDelta);
	}

	get ReadBitCount() {
		return g_BitBuffersRuntime.GetReadBitCount(this.m_NativeState);
	}

	get ReadByteCount() {
		return g_BitBuffersRuntime.GetReadByteCount(this.m_NativeState);
	}
}

module.exports = {
	BitBufferRead: BitBufferRead,
	BitBufferWrite: BitBufferWrite,
	PackUInt32: PackUInt32,
};
