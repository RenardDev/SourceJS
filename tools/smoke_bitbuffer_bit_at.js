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
const g_unBufferBitCount = g_unBufferByteCount * g_unBitsPerByte;
const g_vecInvalidIndices = [-1, -1.9, 0xFFFFFFFF, 1n];
for (const Value of g_vecInvalidIndices) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.throws(() => Writer.WriteOneBitAt(true, Value));
	g_Assert.equal(Writer.CurrentBit, 0);
	g_Assert.equal(Writer.Overflowed, false);
}

for (let unBitIndex = 0; unBitIndex < g_unBufferBitCount; unBitIndex += 1) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	Writer.SeekToBit(g_unBufferBitCount);
	g_Assert.equal(Writer.WriteOneBitAt(true, unBitIndex), true);
	g_Assert.equal(Writer.CurrentBit, g_unBufferBitCount);

	const vecExpected = Array(g_unBufferByteCount).fill(0);
	vecExpected[Math.floor(unBitIndex / g_unBitsPerByte)] = 1 << (unBitIndex % g_unBitsPerByte);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecExpected);
	g_Assert.equal(Writer.WriteOneBitAt(false, unBitIndex), true);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), Array(g_unBufferByteCount).fill(0));
}

const g_vecExpectedOverflowBytes = [1, 0, 0, 0];
const g_Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
g_Writer.SeekToBit(g_unBufferBitCount);
g_Writer.Overflowed = true;
g_Assert.equal(g_Writer.WriteOneBitAt(true, 0), false);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), g_vecExpectedOverflowBytes);
g_Assert.equal(g_Writer.WriteOneBitAt(true, g_unBufferBitCount), false);
g_Assert.equal(g_Writer.CurrentBit, g_unBufferBitCount);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), g_vecExpectedOverflowBytes);

console.log("Indexed bit writes preserve cursor/storage and reject negative indices.");
