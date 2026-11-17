#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");
const g_Module = require("node:module");

process.env.NODE_PATH = [g_Path.resolve(__dirname, "../packages/sourcejs"), process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const { InstallBitBuffersMock } = require("./native_bitbuffers_mock.js");
InstallBitBuffersMock();

const g_BitBuffers = require("bitbuffers");
const g_Assert = require("node:assert/strict");

const g_unFractionBitCount = 11;
const g_unNormalDenominator = (2 ** g_unFractionBitCount) - 1;
const g_unBufferByteCount = 4;
const g_flMaximumFloat = 3.4028234663852886e38;

for (let unMagnitude = 0; unMagnitude <= g_unNormalDenominator; unMagnitude += 1) {
	for (const nSign of [-1, 1]) {
		const flValue = Math.fround(nSign * unMagnitude / g_unNormalDenominator);
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
		g_Assert.equal(Writer.WriteBitNormal(flValue), true);

		const Reader = new g_BitBuffers.BitBufferRead(Writer);
		g_Assert.equal(Reader.ReadUBitLong(1), Number(flValue <= -(1 / g_unNormalDenominator)));
		g_Assert.equal(Reader.ReadUBitLong(g_unFractionBitCount), unMagnitude);
	}
}

for (const flValue of [-g_flMaximumFloat, -2, 2, g_flMaximumFloat]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.equal(Writer.WriteBitNormal(flValue), true);

	const Reader = new g_BitBuffers.BitBufferRead(Writer);
	g_Assert.equal(Reader.ReadUBitLong(1), Number(flValue < 0));
	g_Assert.equal(Reader.ReadUBitLong(g_unFractionBitCount), g_unNormalDenominator);
}

for (const flValue of [NaN, Infinity, -Infinity, 1e39, -1e39]) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);
	g_Assert.throws(() => Writer.WriteBitNormal(flValue));
}

console.log("Normal quantization, saturation and invalid-input checks passed.");
