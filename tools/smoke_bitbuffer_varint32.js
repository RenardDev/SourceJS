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
const g_unPartialWriteBitOffset = 29;
const g_unByteMask = 0xFFn;
const g_vecWireCases = [
	{ Value: 0, ExpectedBytes: [0x00] },
	{ Value: 127, ExpectedBytes: [0x7F] },
	{ Value: 128, ExpectedBytes: [0x80, 0x01] },
	{ Value: 16383, ExpectedBytes: [0xFF, 0x7F] },
	{ Value: 16384, ExpectedBytes: [0x80, 0x80, 0x01] },
	{ Value: 2097151, ExpectedBytes: [0xFF, 0xFF, 0x7F] },
	{ Value: 2097152, ExpectedBytes: [0x80, 0x80, 0x80, 0x01] },
	{ Value: 268435455, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0x7F] },
	{ Value: 268435456, ExpectedBytes: [0x80, 0x80, 0x80, 0x80, 0x01] },
	{ Value: 0xFFFFFFFF, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF, 0x0F] },
	{ Value: -1, ExpectedBytes: [0xFF, 0xFF, 0xFF, 0xFF, 0x0F] },
	{ Value: 0x100000080, ExpectedBytes: [0x80, 0x01] },
	{ Value: "128.75", ExpectedBytes: [0x80, 0x01] },
	{ Value: null, ExpectedBytes: [0x00] },
	{ Value: undefined, ExpectedBytes: [0x00] },
	{ Value: NaN, ExpectedBytes: [0x00] },
	{ Value: Infinity, ExpectedBytes: [0x00] },
];
for (const WireCase of g_vecWireCases) {
	for (let unBitOffset = 0; unBitOffset < g_unBitsPerByte; unBitOffset += 1) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
		Writer.SeekToBit(unBitOffset);
		g_Assert.equal(Writer.WriteVarInt32(WireCase.Value), true);
		g_Assert.equal(Writer.CurrentBit, unBitOffset + (WireCase.ExpectedBytes.length * g_unBitsPerByte));

		let unPackedValue = 0n;
		for (let unByteIndex = 0; unByteIndex < WireCase.ExpectedBytes.length; unByteIndex += 1) {
			unPackedValue |= BigInt(WireCase.ExpectedBytes[unByteIndex]) << BigInt(unBitOffset + (unByteIndex * g_unBitsPerByte));
		}

		const vecExpectedBytes = [];
		for (let unByteIndex = 0; unByteIndex < Math.ceil(Writer.CurrentBit / g_unBitsPerByte); unByteIndex += 1) {
			vecExpectedBytes.push(Number((unPackedValue >> BigInt(unByteIndex * g_unBitsPerByte)) & g_unByteMask));
		}

		g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecExpectedBytes);
	}
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unShortBufferByteCount);
g_Assert.throws(() => g_Writer.WriteVarInt32(1n), TypeError);
g_Assert.throws(() => g_Writer.WriteVarInt32(Symbol("invalid")), TypeError);
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Assert.equal(g_Writer.WriteVarInt32(0xFFFFFFFF), false);
g_Assert.equal(g_Writer.CurrentBit, g_unShortBufferBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0xFF, 0xFF, 0xFF, 0xFF]);

const g_ShortWriter = new g_BitBuffers.BitBufferWrite(g_unShortBufferByteCount);
g_ShortWriter.SeekToBit(g_unPartialWriteBitOffset);
g_Assert.equal(g_ShortWriter.WriteVarInt32(128), false);
g_Assert.equal(g_ShortWriter.CurrentBit, g_unShortBufferBitCount);
g_Assert.equal(g_ShortWriter.Overflowed, true);
g_Assert.deepEqual(Array.from(g_ShortWriter.ToBytes()), [0x00, 0x00, 0x00, 0x00]);

console.log("Varint32 wire vectors, bit alignment, conversions and overflow checks passed.");
