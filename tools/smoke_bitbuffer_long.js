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
const g_unLongByteCount = 4;
const g_unLongBitCount = g_unLongByteCount * g_unBitsPerByte;
const g_unStorageByteCount = 8;
const g_unStorageBitCount = g_unStorageByteCount * g_unBitsPerByte;
const g_nMinimumLongValue = -2147483648;
const g_nMaximumLongValue = 2147483647;
const g_unSentinelWord = 0xA5A5A5A5;
const g_unLongMask = 0xFFFFFFFFn;
const g_unByteMask = 0xFFn;
const g_vecConversionCases = [
	{ Value: g_nMinimumLongValue, ExpectedBytes: [0x00, 0x00, 0x00, 0x80] },
	{ Value: g_nMaximumLongValue, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0x7F] },
	{ Value: 0xFFFFFFFF, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF] },
	{ Value: 0x100000001, ExpectedBytes: [0x01, 0x00, 0x00, 0x00] },
	{ Value: "-1.9", ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF] },
	{ Value: null, ExpectedBytes: [0x00, 0x00, 0x00, 0x00] },
	{ Value: undefined, ExpectedBytes: [0x00, 0x00, 0x00, 0x00] },
	{ Value: NaN, ExpectedBytes: [0x00, 0x00, 0x00, 0x00] },
	{ Value: Infinity, ExpectedBytes: [0x00, 0x00, 0x00, 0x00] },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unLongByteCount);
	g_Assert.equal(Writer.WriteLong(ConversionCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, g_unLongBitCount);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), ConversionCase.ExpectedBytes);
}

const g_unSentinelStorageValue = 0xA5A5A5A5A5A5A5A5n;
const g_vecInputValues = [g_nMinimumLongValue, -1, 0, g_nMaximumLongValue];
for (let unBitIndex = 0; unBitIndex < g_unLongBitCount; unBitIndex += 1) {
	const unPower = 2 ** unBitIndex;
	g_vecInputValues.push(unPower - 1, unPower, unPower + 1);
}

for (const nValue of g_vecInputValues) {
	for (let unBitOffset = 0; unBitOffset < g_unBitsPerByte; unBitOffset += 1) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unStorageByteCount);
		g_Assert.equal(Writer.WriteUBitLong(g_unSentinelWord, g_unLongBitCount), true);
		g_Assert.equal(Writer.WriteUBitLong(g_unSentinelWord, g_unLongBitCount), true);
		Writer.SeekToBit(unBitOffset);
		g_Assert.equal(Writer.WriteLong(nValue), true);
		g_Assert.equal(Writer.CurrentBit, unBitOffset + g_unLongBitCount);

		const unShiftBitCount = BigInt(unBitOffset);
		const unExpectedStorageValue = (g_unSentinelStorageValue & ~(g_unLongMask << unShiftBitCount)) | (BigInt(nValue >>> 0) << unShiftBitCount);
		const vecExpectedBytes = [];
		for (let unByteIndex = 0; unByteIndex < g_unStorageByteCount; unByteIndex += 1) {
			vecExpectedBytes.push(Number((unExpectedStorageValue >> BigInt(unByteIndex * g_unBitsPerByte)) & g_unByteMask));
		}

		Writer.SeekToBit(g_unStorageBitCount);
		g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecExpectedBytes);
	}
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unLongByteCount);
g_Assert.throws(() => g_Writer.WriteLong(1n), TypeError);
g_Assert.throws(() => g_Writer.WriteLong(Symbol("invalid")), TypeError);
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Writer.SeekToBit(1);
g_Assert.equal(g_Writer.WriteLong(-1), false);
g_Assert.equal(g_Writer.CurrentBit, g_unLongBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0x00, 0x00, 0x00, 0x00]);

console.log("Long conversion, TF2 overflow and 800 aligned/unaligned storage checks passed.");
