#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackagePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "filesystem.js");
const g_strRuntimePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [g_strPackagePath, g_strRuntimePath];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));
const g_setLiveHandles = new Set();
let g_hNextSourceFile = 0n;
let g_unStaleWriteAttempts = 0;
let g_unNativeCloseCalls = 0;
let g_unNativeTruncationCalls = 0;
let g_NativeWriteFailure = null;

const g_NativeFilesystem = {
	GetSeekTypes() {
		return { Current: 1, Head: 0, Tail: 2 };
	},
	WriteSourceFile(hFile, FileData) {
		// Match the native binding: capture the handle, then coerce data before IO.
		let unByteCount = 0;
		if (ArrayBuffer.isView(FileData) || (FileData instanceof ArrayBuffer)) {
			unByteCount = FileData.byteLength;
		} else {
			const strText = `${FileData}`;
			unByteCount = Buffer.byteLength(strText, "utf8");
		}

		if (!g_setLiveHandles.has(hFile)) {
			++g_unStaleWriteAttempts;
			throw new Error("Controlled stale-handle write attempt; no SDK IO occurred.");
		}

		if (g_NativeWriteFailure !== null) {
			throw g_NativeWriteFailure;
		}

		return unByteCount;
	},
	CloseSourceFile(hFile) {
		++g_unNativeCloseCalls;

		return g_setLiveHandles.delete(hFile);
	},
	TruncateSourceFile(hFile, strFilePath, strFileMode, strPathID, nTargetSize, OwnershipState) {
		g_Assert.equal(typeof strFilePath, "string");
		g_Assert.equal(typeof strFileMode, "string");
		g_Assert.equal(typeof strPathID, "string");
		g_Assert.equal(g_setLiveHandles.delete(hFile), true);
		++g_unNativeTruncationCalls;
		OwnershipState.OriginalHandleConsumed = true;
		const hReplacementFile = ++g_hNextSourceFile;
		g_setLiveHandles.add(hReplacementFile);

		return { Handle: hReplacementFile, Size: (nTargetSize < 0) ? 0 : nTargetSize, BytesWritten: 0 };
	},
};

try {
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	globalThis.sourcejs = { filesystem: g_NativeFilesystem };

	const g_Filesystem = require(g_strPackagePath);
	g_Assert.strictEqual(g_Filesystem, g_NativeFilesystem);
	g_Assert.equal(g_Filesystem.SeekType.HEAD, 0);
	g_Assert.equal(typeof g_Filesystem.GetSeekTypes, "function");

	// Deliberate obsolete public fields: neither may be fabricated.
	g_Assert.equal(Object.hasOwn(g_Filesystem, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Filesystem, "default"), false);
	g_Assert.throws(() => g_Filesystem.DoesFileExist("cfg/sourcejs.cfg"), TypeError);
	g_Assert.throws(() => g_Filesystem.ReadTextFile("cfg/sourcejs.cfg"), TypeError);
	g_Assert.throws(() => g_Filesystem.WriteTextFile("cfg/sourcejs.cfg", "Enabled=1\n"), TypeError);
	g_Assert.throws(() => g_Filesystem.EnsureDirectoryExists("cfg/sourcejs"), TypeError);
	g_Assert.throws(() => g_Filesystem.IsVPKFile("materials/packed.vpk"), TypeError);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile("logs/sourcejs.log", "wt", "GAME"), TypeError);

	// Reentrant data conversion must not invalidate a wrapper's active write handle.
	function CreateWriteOwner() {
		g_setLiveHandles.clear();
		g_NativeWriteFailure = null;
		const hFile = ++g_hNextSourceFile;
		g_setLiveHandles.add(hFile);

		return new g_Filesystem.SourceFile(hFile, "wb", "controlled-source-file.dat", "GAME");
	}

	function CheckWriteOwnershipGuard(strOperation, ChangeOwnership) {
		const Owner = CreateWriteOwner();
		const hOriginalFile = Owner.Handle;
		let OperationFailure = null;
		try {
			Owner.WriteSourceFile({
				toString() {
					ChangeOwnership(Owner);

					return "payload";
				},
			});
		} catch (Failure) {
			OperationFailure = Failure;
		}

		return { Operation: strOperation, Guarded: (OperationFailure instanceof Error) && /active write/.test(OperationFailure.message), UnchangedHandle: Owner.Handle === hOriginalFile };
	}

	const g_vecOwnershipChecks = [
		CheckWriteOwnershipGuard("Close", Owner => Owner.CloseSourceFile()),
		CheckWriteOwnershipGuard("Truncate", Owner => Owner.TruncateSourceFile(0)),
		CheckWriteOwnershipGuard("Rebind", Owner => {
			Owner.Handle = g_hNextSourceFile + 1n;
		}),
	];
	g_Assert.deepEqual(g_vecOwnershipChecks, [
		{ Operation: "Close", Guarded: true, UnchangedHandle: true },
		{ Operation: "Truncate", Guarded: true, UnchangedHandle: true },
		{ Operation: "Rebind", Guarded: true, UnchangedHandle: true },
	], "SourceFile must protect its owned handle during write-data coercion");
	g_Assert.equal(g_unStaleWriteAttempts, 0);
	g_Assert.equal(g_unNativeCloseCalls, 0);
	g_Assert.equal(g_unNativeTruncationCalls, 0);

	const g_NestedWriteOwner = CreateWriteOwner();
	g_Assert.equal(g_NestedWriteOwner.WriteSourceFile({
		toString() {
			g_Assert.equal(g_NestedWriteOwner.WriteSourceFile("inner"), 5);
			g_Assert.throws(() => g_NestedWriteOwner.CloseSourceFile(), /active write/);
			g_Assert.throws(() => g_NestedWriteOwner.TruncateSourceFile(0), /active write/);
			g_Assert.throws(() => {
				g_NestedWriteOwner.Handle = g_hNextSourceFile + 1n;
			}, /active write/);

			return "outer";
		},
	}), 5);
	g_Assert.equal(g_NestedWriteOwner.CloseSourceFile(), true);
	g_Assert.equal(g_NestedWriteOwner.CloseSourceFile(), false);

	const g_CoercionFailureOwner = CreateWriteOwner();
	const g_CoercionFailure = new Error("Controlled write-data coercion failure.");
	g_Assert.throws(() => g_CoercionFailureOwner.WriteSourceFile({
		toString() {
			throw g_CoercionFailure;
		},
	}), Failure => Failure === g_CoercionFailure);
	g_Assert.equal(g_CoercionFailureOwner.CloseSourceFile(), true);

	const g_NativeFailureOwner = CreateWriteOwner();
	g_NativeWriteFailure = new Error("Controlled native write failure.");
	g_Assert.throws(() => g_NativeFailureOwner.WriteSourceFile("data"), Failure => Failure === g_NativeWriteFailure);
	g_NativeWriteFailure = null;
	g_Assert.equal(g_NativeFailureOwner.TruncateSourceFile(0), 0);
	g_Assert.equal(g_NativeFailureOwner.CloseSourceFile(), true);

	const g_BinaryWriteOwner = CreateWriteOwner();
	g_Assert.equal(g_BinaryWriteOwner.WriteSourceFile(new Uint8Array([0x00, 0x7F, 0xFF])), 3);
	g_Assert.equal(g_BinaryWriteOwner.WriteSourceFile(new ArrayBuffer(2)), 2);
	g_Assert.equal(g_BinaryWriteOwner.WriteSourceFile(""), 0);
	g_Assert.throws(() => g_BinaryWriteOwner.WriteSourceFile(Symbol("data")), TypeError);
	const g_hUnchangedFile = g_BinaryWriteOwner.Handle;
	g_BinaryWriteOwner.Handle = g_hUnchangedFile;
	g_Assert.equal(g_BinaryWriteOwner.CloseSourceFile(), true);
	g_Assert.equal(g_unStaleWriteAttempts, 0);
	g_Assert.equal(g_setLiveHandles.size, 0);

	console.log("[  OK  ] SourceFile write ownership: close/truncate/rebind guards, nested writes, failure unwinding and binary data passed with a controlled native double; no SDK IO");

	delete require.cache[g_strPackagePath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strPackagePath), { name: "Error", message: /^SourceJS native runtime is not installed/ });

	console.log("[  OK  ] filesystem strict API contracts passed with a reduced native double; SDK IO not exercised");
} finally {
	for (const [strModulePath, CacheEntry] of g_mapOriginalCacheEntries) {
		delete require.cache[strModulePath];

		if (CacheEntry !== undefined) {
			require.cache[strModulePath] = CacheEntry;
		}
	}

	if (g_SourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;
	} else {
		Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
	}

	g_Module._load = g_OriginalModuleLoad;
}
