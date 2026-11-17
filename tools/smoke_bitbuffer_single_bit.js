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
const g_vecMethodNames = ["WriteOneBit", "WriteOneBitWithoutCheck"];
const g_vecInputValues = [undefined, null, false, 0, NaN, "", true, 1, "0", {}, [], 1n];
const g_unBufferByteCount = 4;
const g_unBitsPerByte = 8;
const g_unBufferBitCount = g_unBufferByteCount * g_unBitsPerByte;
const g_vecExpectedFinalBitBytes = [0x00, 0x00, 0x00, 0x80];

for (const strMethodName of g_vecMethodNames) {
	for (const Value of g_vecInputValues) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
		g_Assert.equal(Writer[strMethodName](Value), true);
		g_Assert.equal(Writer.CurrentBit, 1);
		g_Assert.deepEqual(Array.from(Writer.ToBytes()), [Value ? 1 : 0]);
	}

	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	Writer.SeekToBit(g_unBufferBitCount - 1);
	g_Assert.equal(Writer[strMethodName](true), true);
	g_Assert.equal(Writer.CurrentBit, g_unBufferBitCount);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), g_vecExpectedFinalBitBytes);
	g_Assert.equal(Writer[strMethodName](false), false);
	g_Assert.equal(Writer.CurrentBit, g_unBufferBitCount);
	g_Assert.equal(Writer.Overflowed, true);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), g_vecExpectedFinalBitBytes);

	// The mock uses the TF2 profile: sticky overflow does not prevent an in-range write.
	Writer.SeekToBit(0);
	g_Assert.equal(Writer[strMethodName](true), false);
	g_Assert.equal(Writer.CurrentBit, 1);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), [1]);
}

console.log("Single-bit truthiness, final-bit and overflow checks passed.");
