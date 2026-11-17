#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

process.env.NODE_PATH = [g_Path.resolve(__dirname, "../packages/sourcejs"), process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const { InstallBitBuffersMock } = require("./native_bitbuffers_mock.js");
const g_NativeBitBuffers = InstallBitBuffersMock();

const g_BitBuffers = require("bitbuffers");
const g_unBufferByteCount = 8;
const g_unBitsPerByte = 8;
const g_unShortCopyByteCount = 2;
const g_unShortCopyBitCount = g_unShortCopyByteCount * g_unBitsPerByte;
const g_unLongCopyBitCount = 40;
const g_unFilledByte = 0xFF;
const g_vecExpectedZeroBlockBytes = [0, 0];

function VerifyCopyStateStoreFailures() {
	const vecPropertyNames = ["Bytes", "DataBitCount", "DataByteCount", "CurrentBit", "Overflowed"];
	const RunScenario = (strFailureState, strFailureProperty, Failure) => {
		const WriterState = g_NativeBitBuffers.CreateWrite(g_unBufferByteCount);
		const ReaderState = g_NativeBitBuffers.CreateRead(new Uint8Array([g_unFilledByte]));
		const vecWrites = [];
		const ObserveState = (State, strStateName) => new Proxy(State, {
			set(Target, strPropertyName, Value) {
				vecWrites.push(strStateName + "." + strPropertyName);

				if ((strStateName === strFailureState) && (strPropertyName === strFailureProperty)) {
					throw Failure;
				}

				return Reflect.set(Target, strPropertyName, Value);
			},
		});
		let bCaught = false;
		try {
			g_Assert.equal(g_NativeBitBuffers.WriteBitsFromBuffer(ObserveState(WriterState, "Writer"), ObserveState(ReaderState, "Reader"), g_unBitsPerByte), true);
		} catch (ErrorValue) {
			bCaught = true;
			g_Assert.strictEqual(ErrorValue, Failure);
		}

		if (strFailureState === null) {
			g_Assert.equal(bCaught, false);
			g_Assert.deepEqual(vecWrites, [...vecPropertyNames.map((strName) => "Writer." + strName), ...vecPropertyNames.map((strName) => "Reader." + strName)]);
			g_Assert.equal(WriterState.CurrentBit, g_unBitsPerByte);
			g_Assert.equal(ReaderState.CurrentBit, g_unBitsPerByte);
			return;
		}

		g_Assert.equal(bCaught, true);
		const nFailurePropertyIndex = vecPropertyNames.indexOf(strFailureProperty);
		const vecFailedStoreWrites = vecPropertyNames.slice(0, nFailurePropertyIndex + 1).map((strName) => strFailureState + "." + strName);
		if (strFailureState === "Writer") {
			g_Assert.deepEqual(vecWrites, vecFailedStoreWrites);
			g_Assert.equal(ReaderState.CurrentBit, 0);
			g_Assert.equal(ReaderState.Overflowed, false);
			g_Assert.deepEqual(Array.from(ReaderState.Bytes), [g_unFilledByte]);
		} else {
			g_Assert.deepEqual(vecWrites, [...vecPropertyNames.map((strName) => "Writer." + strName), ...vecFailedStoreWrites]);
			g_Assert.equal(WriterState.CurrentBit, g_unBitsPerByte);
			g_Assert.equal(WriterState.Bytes[0], g_unFilledByte);
		}
	};

	RunScenario(null, null, null);

	for (const strFailureState of ["Writer", "Reader"]) {
		for (const strPropertyName of vecPropertyNames) {
			for (const Failure of [undefined, null, Symbol("copy store"), new Error("Controlled copy store failure.")]) {
				RunScenario(strFailureState, strPropertyName, Failure);
			}
		}
	}
}

for (const dblInvalidBitCount of [-1, -1.5, 2147483648]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	const Reader = new g_BitBuffers.BitBufferRead(new Uint8Array([g_unFilledByte]));
	g_Assert.throws(() => Writer.WriteBitsFromBuffer(Reader, dblInvalidBitCount));
	g_Assert.equal(Writer.CurrentBit, 0);
	g_Assert.equal(Reader.CurrentBit, 0);
}

const g_vecConversionCases = [
	{ Value: 3.9, ExpectedBits: 3 },
	{ Value: 4294967297, ExpectedBits: 1 },
	{ Value: NaN, ExpectedBits: 0 },
	{ Value: null, ExpectedBits: 0 },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	const Reader = new g_BitBuffers.BitBufferRead(new Uint8Array([g_unFilledByte]));
	g_Assert.equal(Writer.WriteBitsFromBuffer(Reader, ConversionCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, ConversionCase.ExpectedBits);
	g_Assert.equal(Reader.CurrentBit, ConversionCase.ExpectedBits);
}

// An incomplete source block contributes zeros, not the readable prefix.
const g_SourceShortWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
const g_SourceShortReader = new g_BitBuffers.BitBufferRead(new Uint8Array([g_unFilledByte]));
g_Assert.equal(g_SourceShortWriter.WriteBitsFromBuffer(g_SourceShortReader, g_unShortCopyBitCount), false);
g_Assert.equal(g_SourceShortReader.CurrentBit, g_unBitsPerByte);
g_Assert.equal(g_SourceShortWriter.CurrentBit, g_unShortCopyBitCount);
g_Assert.equal(g_SourceShortReader.IsOverflowed(), true);
g_Assert.equal(g_SourceShortWriter.IsOverflowed(), false);
g_Assert.deepEqual(Array.from(g_SourceShortWriter.ToBytes()), g_vecExpectedZeroBlockBytes);

// A rejected destination block still consumes its source; later blocks continue.
const g_DestinationShortWriter = new g_BitBuffers.BitBufferWrite(g_unShortCopyByteCount);
const g_DestinationShortReader = new g_BitBuffers.BitBufferRead(new Uint8Array([g_unFilledByte, g_unFilledByte, g_unFilledByte, g_unFilledByte, g_unFilledByte]));
g_Assert.equal(g_DestinationShortWriter.WriteBitsFromBuffer(g_DestinationShortReader, g_unLongCopyBitCount), false);
g_Assert.equal(g_DestinationShortWriter.CurrentBit, g_unShortCopyBitCount);
g_Assert.equal(g_DestinationShortReader.CurrentBit, g_unLongCopyBitCount);
g_Assert.equal(g_DestinationShortWriter.IsOverflowed(), true);
g_Assert.equal(g_DestinationShortReader.IsOverflowed(), false);
g_Assert.deepEqual(Array.from(g_DestinationShortWriter.ToBytes()), g_vecExpectedZeroBlockBytes);

// A writer source creates a separate reader, bounded by the written extent.
const g_unSourceValue = 0x15;
const g_unSourceBitCount = 5;
const g_SourceWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Assert.equal(g_SourceWriter.WriteUBitLong(g_unSourceValue, g_unSourceBitCount), true);

const g_CopyWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Assert.equal(g_CopyWriter.WriteBitsFromBuffer(g_SourceWriter, g_unSourceBitCount), true);
g_Assert.equal(g_SourceWriter.CurrentBit, g_unSourceBitCount);
g_Assert.equal(g_CopyWriter.CurrentBit, g_unSourceBitCount);
g_Assert.deepEqual(Array.from(g_CopyWriter.ToBytes()), [g_unSourceValue]);

const g_PastWrittenWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Assert.equal(g_PastWrittenWriter.WriteBitsFromBuffer(g_SourceWriter, g_unSourceBitCount + 1), false);
g_Assert.equal(g_SourceWriter.CurrentBit, g_unSourceBitCount);
g_Assert.equal(g_SourceWriter.IsOverflowed(), false);
g_Assert.deepEqual(Array.from(g_PastWrittenWriter.ToBytes()), [0]);

VerifyCopyStateStoreFailures();

console.log("Bit-buffer copy conversion, source extent and partial-failure checks passed.");
