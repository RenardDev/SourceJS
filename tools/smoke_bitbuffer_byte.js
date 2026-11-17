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
const g_unBufferByteCount = 4;
const g_unBitsPerByte = 8;
const g_unByteMask = 0xFF;
const g_unTestValueLimit = 512;
for (let nValue = -g_unTestValueLimit; nValue <= g_unTestValueLimit; nValue += 1) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteByte(nValue), true);
	g_Assert.equal(Writer.CurrentBit, g_unBitsPerByte);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), [nValue & g_unByteMask]);
}

const g_vecConversionCases = [
	{ Value: 3.9, Expected: 3 },
	{ Value: -1.9, Expected: g_unByteMask },
	{ Value: 4294967297, Expected: 1 },
	{ Value: NaN, Expected: 0 },
	{ Value: null, Expected: 0 },
	{ Value: undefined, Expected: 0 },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteByte(ConversionCase.Value), true);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), [ConversionCase.Expected]);
}

const g_ShortWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount, g_unBitsPerByte - 1);
g_Assert.equal(g_ShortWriter.WriteByte(g_unByteMask), false);
g_Assert.equal(g_ShortWriter.CurrentBit, g_unBitsPerByte - 1);
g_Assert.equal(g_ShortWriter.IsOverflowed(), true);
g_Assert.deepEqual(Array.from(g_ShortWriter.ToBytes()), [0]);

// Existing overflow affects the result, but does not prevent an in-capacity payload write.
const g_OverflowedWriter = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_OverflowedWriter.SetOverflowFlag();
g_Assert.equal(g_OverflowedWriter.WriteByte(g_unByteMask), false);
g_Assert.equal(g_OverflowedWriter.CurrentBit, g_unBitsPerByte);
g_Assert.deepEqual(Array.from(g_OverflowedWriter.ToBytes()), [g_unByteMask]);

console.log("Byte conversion, capacity and overflow checks passed.");
