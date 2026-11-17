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
const g_unBufferByteCount = 4;
const g_unMaximumBitCount = g_unBufferByteCount * g_unBitsPerByte;
const g_unByteMask = 0xFFn;
const g_vecInputValues = [0, 1, 127, 128, 0xFFFFFFFF, -1, 0x100000001, NaN, Infinity];
for (let unBitCount = 0; unBitCount <= g_unMaximumBitCount; unBitCount += 1) {
	for (const dblInputValue of g_vecInputValues) {
		for (const bCheckRange of [false, true]) {
			const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
			g_Assert.equal(Writer.WriteUBitLong(dblInputValue, unBitCount, bCheckRange), true);
			g_Assert.equal(Writer.CurrentBit, unBitCount);

			const unExpectedValue = BigInt.asUintN(unBitCount, BigInt(dblInputValue >>> 0));
			const vecExpectedBytes = [];
			for (let unByteIndex = 0; unByteIndex < Math.ceil(unBitCount / g_unBitsPerByte); unByteIndex += 1) {
				vecExpectedBytes.push(Number((unExpectedValue >> BigInt(unByteIndex * g_unBitsPerByte)) & g_unByteMask));
			}

			g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecExpectedBytes);
		}
	}
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Assert.throws(() => g_Writer.WriteUBitLong(1, 64));
g_Assert.throws(() => g_Writer.WriteUBitLong(1n, 1));
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Writer.SeekToBit(g_unMaximumBitCount - 1);
g_Assert.equal(g_Writer.WriteUBitLong(3, 2), false);
g_Assert.equal(g_Writer.CurrentBit, g_unMaximumBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0x00, 0x00, 0x00, 0x00]);
g_Assert.equal(g_Writer.WriteUBitLong(0, 0), false);

console.log("Unsigned field conversion, masking, width and overflow checks passed.");
