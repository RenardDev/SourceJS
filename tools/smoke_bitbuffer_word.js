#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

process.env.NODE_PATH = [g_Path.resolve(__dirname, "../packages/sourcejs"), process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const { InstallBitBuffersMock } = require("./native_bitbuffers_mock.js");
InstallBitBuffersMock();

const g_BitBuffers = require("bitbuffers");
const g_unBitsPerByte = 8;
const g_unWordByteCount = 2;
const g_unWordBitCount = g_unWordByteCount * g_unBitsPerByte;
const g_unBufferByteCount = 4;
const g_unBufferBitCount = g_unBufferByteCount * g_unBitsPerByte;
const g_unWordMask = 0xFFFF;
const g_unByteMask = 0xFF;
const g_unOverflowBitOffset = 17;
const g_vecConversionCases = [
	{ Value: -1, Expected: g_unWordMask },
	{ Value: 65536, Expected: 0 },
	{ Value: 0x100000001, Expected: 1 },
	{ Value: "65535.9", Expected: g_unWordMask },
	{ Value: null, Expected: 0 },
	{ Value: undefined, Expected: 0 },
	{ Value: NaN, Expected: 0 },
	{ Value: Infinity, Expected: 0 },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteWord(ConversionCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, g_unWordBitCount);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), [ConversionCase.Expected & g_unByteMask, ConversionCase.Expected >>> g_unBitsPerByte]);
}

// Every 16-bit value, every bit alignment, and unchanged surrounding storage.
const g_unStorageSentinel = 0xA5A5A5A5;

for (let unValue = 0; unValue <= g_unWordMask; unValue += 1) {
	for (let unBitOffset = 0; unBitOffset < g_unBitsPerByte; unBitOffset += 1) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
		g_Assert.equal(Writer.WriteUBitLong(g_unStorageSentinel, g_unBufferBitCount), true);
		Writer.SeekToBit(unBitOffset);
		g_Assert.equal(Writer.WriteWord(unValue), true);
		g_Assert.equal(Writer.CurrentBit, unBitOffset + g_unWordBitCount);

		const unExpectedValue = ((g_unStorageSentinel & ~(g_unWordMask << unBitOffset)) | (unValue << unBitOffset)) >>> 0;
		Writer.SeekToBit(g_unBufferBitCount);
		g_Assert.deepEqual(Array.from(Writer.ToBytes()), [unExpectedValue & g_unByteMask, (unExpectedValue >>> g_unBitsPerByte) & g_unByteMask, (unExpectedValue >>> g_unWordBitCount) & g_unByteMask, unExpectedValue >>> (g_unWordBitCount + g_unBitsPerByte)]);
	}
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Assert.throws(() => g_Writer.WriteWord(1n), TypeError);
g_Assert.throws(() => g_Writer.WriteWord(Symbol("invalid")), TypeError);
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Writer.SeekToBit(g_unOverflowBitOffset);
g_Assert.equal(g_Writer.WriteWord(g_unWordMask), false);
g_Assert.equal(g_Writer.CurrentBit, g_unBufferBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0x00, 0x00, 0x00, 0x00]);

console.log("Word conversion, overflow and 524288 aligned/unaligned storage checks passed.");
