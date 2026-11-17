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
const g_nMinimumSignedByteValue = -128;
const g_nMaximumSignedByteValue = 127;
const g_vecConversionCases = [
	{ Value: g_nMaximumSignedByteValue, ExpectedByte: 0x7F },
	{ Value: 128, ExpectedByte: 0x00 },
	{ Value: 255, ExpectedByte: 0x7F },
	{ Value: g_nMinimumSignedByteValue, ExpectedByte: 0x80 },
	{ Value: -129, ExpectedByte: 0xFF },
	{ Value: -256, ExpectedByte: 0x80 },
	{ Value: null, ExpectedByte: 0x00 },
	{ Value: 3.9, ExpectedByte: 0x03 },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteChar(ConversionCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, g_unBitsPerByte);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), [ConversionCase.ExpectedByte]);
}

// Successful writes share this representation; SDK overflow strategies differ.
// Exercise every alignment and preserve both leading and trailing storage bits.
const g_unBufferBitCount = g_unBufferByteCount * g_unBitsPerByte;
const g_unSentinelByte = 0xA5;

for (let nValue = g_nMinimumSignedByteValue; nValue <= g_nMaximumSignedByteValue; nValue += 1) {
	for (let unStartBitIndex = 0; unStartBitIndex <= (g_unBufferBitCount - g_unBitsPerByte); unStartBitIndex += 1) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
		for (let unByteIndex = 0; unByteIndex < g_unBufferByteCount; unByteIndex += 1) {
			g_Assert.equal(Writer.WriteByte(g_unSentinelByte), true);
		}

		Writer.SeekToBit(unStartBitIndex);
		g_Assert.equal(Writer.CurrentBit, unStartBitIndex);
		g_Assert.equal(Writer.WriteChar(nValue), true);
		g_Assert.equal(Writer.CurrentBit, unStartBitIndex + g_unBitsPerByte);

		const vecExpectedBytes = Array(g_unBufferByteCount).fill(g_unSentinelByte);
		for (let unBitIndex = 0; unBitIndex < g_unBitsPerByte; unBitIndex += 1) {
			const unDestinationBitIndex = unStartBitIndex + unBitIndex;
			const unByteIndex = Math.floor(unDestinationBitIndex / g_unBitsPerByte);
			const unMask = 1 << (unDestinationBitIndex % g_unBitsPerByte);
			if ((nValue & (1 << unBitIndex)) !== 0) {
				vecExpectedBytes[unByteIndex] |= unMask;
			} else {
				vecExpectedBytes[unByteIndex] &= ~unMask;
			}
		}

		Writer.SeekToBit(g_unBufferBitCount);
		g_Assert.equal(Writer.CurrentBit, g_unBufferBitCount);
		g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecExpectedBytes);
	}
}

console.log("Signed character conversion and 6400 aligned/unaligned storage checks passed.");
