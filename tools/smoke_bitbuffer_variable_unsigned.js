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
const g_unBufferByteCount = 8;
const g_unShortBufferByteCount = 4;
const g_unShortBufferBitCount = g_unShortBufferByteCount * g_unBitsPerByte;
const g_unPartialWriteBitOffset = 28;

// Explicit TF2 wire vectors: this mock does not represent every SDK profile.
const g_vecWireCases = [
	{ Value: 0, BitCount: 6, ExpectedBytes: [0x00] },
	{ Value: 15, BitCount: 6, ExpectedBytes: [0x3C] },
	{ Value: 16, BitCount: 10, ExpectedBytes: [0x41, 0x00] },
	{ Value: 255, BitCount: 10, ExpectedBytes: [0xFD, 0x03] },
	{ Value: 256, BitCount: 14, ExpectedBytes: [0x02, 0x04] },
	{ Value: 4095, BitCount: 14, ExpectedBytes: [0xFE, 0x3F] },
	{ Value: 4096, BitCount: 34, ExpectedBytes: [0x03, 0x40, 0x00, 0x00, 0x00] },
	{ Value: 0xFFFFFFFF, BitCount: 34, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF, 0x03] },
	{ Value: -1, BitCount: 34, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF, 0x03] },
	{ Value: 0x100000010, BitCount: 10, ExpectedBytes: [0x41, 0x00] },
	{ Value: "16.9", BitCount: 10, ExpectedBytes: [0x41, 0x00] },
	{ Value: null, BitCount: 6, ExpectedBytes: [0x00] },
	{ Value: undefined, BitCount: 6, ExpectedBytes: [0x00] },
	{ Value: NaN, BitCount: 6, ExpectedBytes: [0x00] },
	{ Value: Infinity, BitCount: 6, ExpectedBytes: [0x00] },
];
for (const WireCase of g_vecWireCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteUBitVar(WireCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, WireCase.BitCount);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), WireCase.ExpectedBytes);
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unShortBufferByteCount);
g_Assert.throws(() => g_Writer.WriteUBitVar(1n), TypeError);
g_Assert.throws(() => g_Writer.WriteUBitVar(Symbol("invalid")), TypeError);
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Assert.equal(g_Writer.WriteUBitVar(0xFFFFFFFF), false);
g_Assert.equal(g_Writer.CurrentBit, g_unShortBufferBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0xFF, 0xFF, 0x03, 0x00]);

const g_ShortWriter = new g_BitBuffers.BitBufferWrite(g_unShortBufferByteCount);
g_ShortWriter.SeekToBit(g_unPartialWriteBitOffset);
g_Assert.equal(g_ShortWriter.WriteUBitVar(15), false);
g_Assert.equal(g_ShortWriter.CurrentBit, g_unShortBufferBitCount);
g_Assert.equal(g_ShortWriter.Overflowed, true);
g_Assert.deepEqual(Array.from(g_ShortWriter.ToBytes()), [0x00, 0x00, 0x00, 0x00]);

console.log("TF2 variable unsigned wire vectors, conversions and partial overflow checks passed.");
