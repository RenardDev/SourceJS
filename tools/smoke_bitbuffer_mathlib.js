#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

process.env.NODE_PATH = [g_Path.resolve(__dirname, "../packages/sourcejs"), process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const { InstallBitBuffersMock } = require("./native_bitbuffers_mock.js");
InstallBitBuffersMock();

// Match the size/registration fixture used by smoke_memory_mathlib.js.
// Exercise the real owned-value QAngle class, not native-address-backed objects.
globalThis.sourcejs.mathlib = {
	FLOAT_SIZE: 4,
	MATRIX3X4_SIZE: 48,
	PLANE_SIZE: 20,
	QANGLE_SIZE: 12,
	QUATERNION_SIZE: 16,
	RADIAN_EULER_SIZE: 12,
	VECTOR_SIZE: 12,
	VMATRIX_SIZE: 64,
};

const g_mapObjectTypes = new Map();
const g_Memory = {
	RegisterObjectType(strName, Constructor, Options) {
		g_mapObjectTypes.set(strName, { Constructor, Options });

		return true;
	},
};

function ThrowNativeMemoryHelper() {
	throw new Error("Owned-value tests must not call native memory helpers.");
}

const g_MemoryHelpers = {
	Add: ThrowNativeMemoryHelper,
	Read: ThrowNativeMemoryHelper,
	ReadFloat: ThrowNativeMemoryHelper,
	Write: ThrowNativeMemoryHelper,
	WriteFloat: ThrowNativeMemoryHelper,
};

function LoadMathlib() {
	const OriginalLoad = g_Module._load;
	g_Module._load = function Load(strName, Parent, bIsMain) {
		if (strName === "memory") {
			return g_Memory;
		}

		if (strName === "memory/helpers") {
			return g_MemoryHelpers;
		}

		return OriginalLoad.call(this, strName, Parent, bIsMain);
	};

	try {
		return require("mathlib");
	} finally {
		g_Module._load = OriginalLoad;
	}
}

const { QAngle } = LoadMathlib();
const g_BitBuffers = require("bitbuffers");
const g_unBufferByteCount = 128;
const g_flPitch = 10;
const g_flYaw = 90;
const g_flRoll = 0;
const g_InputAngles = new QAngle(g_flPitch, g_flYaw, g_flRoll);
const g_Writer = new g_BitBuffers.BitBufferWrite(g_unBufferByteCount);

g_Assert.equal(g_mapObjectTypes.has("QAngle"), true);
g_Assert.deepEqual(g_InputAngles.ConvertMathStructureToArray(), [g_flPitch, g_flYaw, g_flRoll]);

// Bitbuffers accepts math structures through their X/Y/Z components, not m_flX fields.
g_Assert.equal(g_Writer.WriteBitAngles(g_InputAngles), true);

const g_Reader = new g_BitBuffers.BitBufferRead(g_Writer);
const g_Angles = g_Reader.ReadBitAngles();
g_Assert.equal(g_Reader.IsOverflowed(), false);
g_Assert.equal(g_Angles.X, g_flPitch);
g_Assert.equal(g_Angles.Y, g_flYaw);
g_Assert.equal(g_Angles.Z, g_flRoll);

console.log("Real QAngle conversion and bitbuffers coordinate round-trip checks passed.");
