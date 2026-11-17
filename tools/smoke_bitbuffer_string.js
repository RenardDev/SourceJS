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
const g_unConversionBufferByteCount = 16;
const g_unShortBufferByteCount = 4;
const g_unShortBufferBitCount = g_unShortBufferByteCount * g_unBitsPerByte;
const g_vecConversionCases = [
	{ Value: "", ExpectedBytes: [0x00] },
	{ Value: "A", ExpectedBytes: [0x41, 0x00] },
	{ Value: "é", ExpectedBytes: [0xC3, 0xA9, 0x00] },
	{ Value: "😀", ExpectedBytes: [0xF0, 0x9F, 0x98, 0x80, 0x00] },
	{ Value: "a\0b", ExpectedBytes: [0x61, 0x00] },
	{ Value: "\uD800", ExpectedBytes: [0xEF, 0xBF, 0xBD, 0x00] },
	{ Value: null, ExpectedBytes: [0x6E, 0x75, 0x6C, 0x6C, 0x00] },
	{ Value: undefined, ExpectedBytes: [0x75, 0x6E, 0x64, 0x65, 0x66, 0x69, 0x6E, 0x65, 0x64, 0x00] },
];
for (const ConversionCase of g_vecConversionCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unConversionBufferByteCount);
	g_Assert.equal(Writer.WriteString(ConversionCase.Value), true);
	g_Assert.deepEqual(Array.from(Writer.ToBytes()), ConversionCase.ExpectedBytes);
	g_Assert.equal(Writer.CurrentBit, ConversionCase.ExpectedBytes.length * g_unBitsPerByte);
}

const g_Writer = new g_BitBuffers.BitBufferWrite(g_unShortBufferByteCount);
g_Assert.throws(() => g_Writer.WriteString(Symbol("invalid")));
g_Assert.equal(g_Writer.CurrentBit, 0);
g_Assert.equal(g_Writer.Overflowed, false);
g_Assert.equal(g_Writer.WriteString("ABCD"), false);
g_Assert.equal(g_Writer.CurrentBit, g_unShortBufferBitCount);
g_Assert.equal(g_Writer.Overflowed, true);
g_Assert.deepEqual(Array.from(g_Writer.ToBytes()), [0x41, 0x42, 0x43, 0x44]);

console.log("String UTF-8, NUL, conversion and partial-write checks passed.");
