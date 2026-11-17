#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "../packages/sourcejs");
const g_strBitBuffersPath = g_Path.join(g_strPackageRootPath, "bitbuffers.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strMockPath = g_Path.join(__dirname, "native_bitbuffers_mock.js");
const g_unComponentCount = 3;
const g_unBufferBytes = 32;
const g_unInitialBits = 3;
const g_unInitialValue = 5;
const g_vecInvalidComponents = [16385, -16385, 1e30, -1e30, NaN, Infinity, -Infinity, null, undefined];

function LoadTestAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const mapCachedModules = new Map();
	const IsFixtureModulePath = strModulePath => (strModulePath === g_strMockPath) || strModulePath.startsWith(g_strPackageRootPath + g_Path.sep);
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsFixtureModulePath(strModulePath)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Vector-coordinate runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Vector-coordinate package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Vector-coordinate runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Vector-coordinate loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed vector-coordinate cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned vector-coordinate fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bLoaderOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: undefined });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function LoadBitBuffersModule(strRequest, Parent, bIsMain) {
				const strModulePath = (strRequest === "internal/runtime") ? g_strInternalRuntimePath : strRequest;

				return OriginalModuleLoad.call(this, strModulePath, Parent, bIsMain);
			},
		});
		bLoaderOwned = true;

		const { InstallBitBuffersMock } = require(g_strMockPath);
		const MockGlobal = {};
		InstallBitBuffersMock(MockGlobal);
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: MockGlobal.sourcejs });

		Result = require(g_strBitBuffersPath);
	} catch (ExceptionValue) {
		Failure = ExceptionValue;
		bFailed = true;
	} finally {
		const vecFailures = [];
		const AttemptRestoration = Restore => {
			try {
				Restore();
			} catch (ExceptionValue) {
				vecFailures.push(ExceptionValue);
			}
		};

		if (bLoaderOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_load", LoaderDescriptor));
		}

		if (bCacheOwned) {
			for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
				if (IsFixtureModulePath(strModulePath)) {
					AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
				}
			}

			for (const [strModulePath, Descriptor] of mapCachedModules) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
			}
		}

		if (bSourceJSOwned) {
			AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor));
		}

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Vector-coordinate fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_BitBuffers = LoadTestAPI();
for (let unIndex = 0; unIndex < g_unComponentCount; ++unIndex) {
	for (const Value of g_vecInvalidComponents) {
		const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferBytes);
		g_Assert.equal(Writer.WriteUBitLong(g_unInitialValue, g_unInitialBits), true);

		const vecBefore = Array.from(Writer.ToBytes());
		const vecComponents = [1, 2, 3];
		vecComponents[unIndex] = Value;
		g_Assert.throws(() => Writer.WriteBitVec3Coord(vecComponents));
		g_Assert.equal(Writer.CurrentBit, g_unInitialBits);
		g_Assert.equal(Writer.IsOverflowed(), false);
		g_Assert.deepEqual(Array.from(Writer.ToBytes()), vecBefore);
	}
}

// Three presence bits precede each present component's integer/fraction/sign payload.
const g_vecWireCases = [
	{ Value: [0, 0, 0], BitCount: 3, Hex: "00" },
	{ Value: [1, 0, 0], BitCount: 20, Hex: "090000" },
	{ Value: [-1, 0, 0], BitCount: 20, Hex: "290000" },
	{ Value: [0, 1, 0], BitCount: 20, Hex: "0a0000" },
	{ Value: [0, 0, 1], BitCount: 20, Hex: "0c0000" },
	{ Value: [1 / 32, 0, 0], BitCount: 11, Hex: "5100" },
	{ Value: [-1 / 32, 0, 0], BitCount: 11, Hex: "7100" },
];
for (const WireCase of g_vecWireCases) {
	const Writer = new g_BitBuffers.BitBufferWrite(g_unBufferBytes);
	g_Assert.equal(Writer.WriteBitVec3Coord(WireCase.Value), true);
	g_Assert.equal(Writer.CurrentBit, WireCase.BitCount);
	g_Assert.equal(Buffer.from(Writer.ToBytes()).toString("hex"), WireCase.Hex);
}

console.log("Vector coordinate validation and explicit wire cases passed.");
