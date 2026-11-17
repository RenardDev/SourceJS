#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackagePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "filesystem.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "filesystem.md");
const g_strRuntimePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [g_strPackagePath, g_strRuntimePath];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

try {
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_vecDocumentedExports = [
		"SeekType",
		"SourceFile",
		"SourceFileLease",
		"CloseSourceFile",
		"GetSeekTypes",
		"GetSourceFileDescriptor",
		"GetSourceFileOffset",
		"GetSourceFileSize",
		"GetTemporaryFilePath",
		"IsSourceFileAtEnd",
		"IsSourceFileSeekable",
		"IsSourceFileTTY",
		"IsVPKFile",
		"OpenSourceFile",
		"ReadSourceFile",
		"ReadSourceFileLine",
		"ReadTextFile",
		"RemoveFile",
		"SaveSourceFile",
		"SeekSourceFile",
		"FlushSourceFile",
		"TruncateSourceFile",
		"WriteSourceFile",
		"WriteTextFile",
		"DoesFileExist",
		"EnsureDirectoryExists",
		"AcquireSourceFileLease",
	];
	const g_vecDocumentedSourceFileMembers = [
		"BinaryMode",
		"CheckSourceFileClosed",
		"CheckSourceFileReadable",
		"CheckSourceFileWritable",
		"CloseSourceFile",
		"Closed",
		"EndOfFile",
		"FileMode",
		"FilePath",
		"FlushSourceFile",
		"GetSourceFileDescriptor",
		"Handle",
		"IsSourceFileReadable",
		"IsSourceFileSeekable",
		"IsSourceFileTTY",
		"IsSourceFileWritable",
		"OpenSourceFile",
		"PathID",
		"ReadSourceFile",
		"ReadSourceFileLine",
		"ReadSourceFileLines",
		"SaveSourceFile",
		"SeekSourceFile",
		"FileSize",
		"GetSourceFileOffset",
		"TruncateSourceFile",
		"UseSourceFile",
		"WriteSourceFile",
		"WriteSourceFileLines",
	];

	const g_nUnspecifiedSourceFileSize = -1;
	const g_nPrimitiveTruncationFailure = 73;

	const g_mapFiles = new Map();
	const g_setDirectories = new Set();
	const g_mapHandles = new Map();
	const g_vecRemovedPaths = [];
	const g_setVPKFiles = new Set();
	const g_setCompletedContracts = new Set();
	const g_vecExecutedDocumentationBlocks = [];
	let g_hNextSourceFileHandle = 1n;
	let g_unNextTemporaryIndex = 1;
	let g_strTruncationFailureStage = "";
	let g_unCloseCallCount = 0;
	const g_TruncationFailure = new Error("Controlled truncation failure.");

	function ExtractJavaScriptBlocks(strMarkdown) {
		const vecBlocks = [];
		const Expression = /```js\r?\n([\s\S]*?)\r?\n```/g;
		let vecMatch = null;
		while ((vecMatch = Expression.exec(strMarkdown)) !== null) {
			vecBlocks.push(vecMatch[1]);
		}

		return vecBlocks;
	}

	function ExecuteDocumentationBlock(strSource, unBlockIndex, Filesystem, { SourceDataRoot: strSourceDataRoot = "fixture-runtime-root/addons/sourcejs/data/sourcejs", MapName: strMapName = "sourcejs_test_map" } = {}) {
		const DocumentationRequire = (strModuleName) => {
			if (strModuleName === "filesystem") {
				return Filesystem;
			}

			if (strModuleName === "paths") {
				return { SOURCE_DATA_ROOT: strSourceDataRoot };
			}

			if (strModuleName === "globals") {
				return {
					GetRuntimeInfo() {
						return { MapName: strMapName };
					},
				};
			}

			throw new Error(`Unexpected documentation import: ${strModuleName}`);
		};
		const RejectDocumentationConsole = () => {
			throw new Error("Filesystem documentation must use the typed logger.");
		};
		const DocumentationConsole = new Proxy({}, { get: RejectDocumentationConsole });
		const Execute = new Function("require", "console", `"use strict";\n${strSource}\n//# sourceURL=filesystem.md:block-${unBlockIndex + 1}`);

		Execute(DocumentationRequire, DocumentationConsole);
	}

	function VerifyDocumentationExecutorContracts() {
		const vecCalls = [];
		const Filesystem = {
			Verify(...vecArguments) {
				vecCalls.push(vecArguments);
			},
		};
		const strSource = 'require("filesystem").Verify(require("paths").SOURCE_DATA_ROOT, require("globals").GetRuntimeInfo().MapName);';
		ExecuteDocumentationBlock(strSource, 0, Filesystem);
		ExecuteDocumentationBlock(strSource, 0, Filesystem, { SourceDataRoot: "CustomRoot", MapName: "CustomMap" });
		g_Assert.deepEqual(vecCalls, [["fixture-runtime-root/addons/sourcejs/data/sourcejs", "sourcejs_test_map"], ["CustomRoot", "CustomMap"]]);
		g_Assert.throws(() => ExecuteDocumentationBlock('console.log("Unexpected console output");', 0, Filesystem), /must use the typed logger/);
		g_Assert.throws(() => ExecuteDocumentationBlock('require("Unknown");', 0, Filesystem), /Unexpected documentation import/);
	}

	function ResetFixture() {
		g_mapFiles.clear();
		g_setDirectories.clear();
		g_mapHandles.clear();
		g_vecRemovedPaths.length = 0;
		g_setVPKFiles.clear();
		g_hNextSourceFileHandle = 1n;
		g_unNextTemporaryIndex = 1;
	}

	function CreateBuffer(Data) {
		if (Buffer.isBuffer(Data)) {
			return Buffer.from(Data);
		}

		if (ArrayBuffer.isView(Data)) {
			return Buffer.from(Data.buffer, Data.byteOffset, Data.byteLength);
		}

		if (Data instanceof ArrayBuffer) {
			return Buffer.from(Data);
		}

		const strText = `${Data}`;

		return Buffer.from(strText, "utf8");
	}

	function GetSourceFileState(hHandle) {
		const State = g_mapHandles.get(hHandle);
		if (!State) {
			throw new Error(`Unknown handle: ${hHandle}`);
		}

		return State;
	}

	function GetFileBuffer(strFilePath) {
		return g_mapFiles.get(strFilePath) ?? Buffer.alloc(0);
	}

	function SetFileBuffer(strFilePath, Data) {
		if (typeof strFilePath !== "string") {
			throw new TypeError("Native filesystem paths must be strings.");
		}

		g_mapFiles.set(strFilePath, CreateBuffer(Data));
	}

	function VerifyDocumentationCleanupFailures(vecBlocks, Filesystem) {
		const unExpectedScenarioCount = 200;
		const vecCases = [
			{ BlockIndex: 1, Operation: "ReadTextFile", CleanupMethods: ["RemoveFile"], CleanupCalls: ["RemoveFile"] },
			{ BlockIndex: 2, Operation: "ReadTextFile", CleanupMethods: ["RemoveFile"], CleanupCalls: ["RemoveFile"] },
			{ BlockIndex: 3, Operation: "ReadSourceFileLine", CleanupMethods: ["CloseSourceFile", "RemoveFile"], CleanupCalls: ["CloseSourceFile", "RemoveFile"] },
			{ BlockIndex: 4, Operation: "SaveSourceFile", CleanupMethods: ["CloseSourceFile", "RemoveFile"], CleanupCalls: ["CloseSourceFile", "RemoveFile", "RemoveFile"] },
			{ BlockIndex: 5, Operation: "SaveSourceFile", CleanupMethods: ["CloseSourceFile", "RemoveFile"], CleanupCalls: ["CloseSourceFile", "RemoveFile", "RemoveFile"] },
			{ BlockIndex: 6, Operation: "WriteSourceFile", CleanupMethods: ["CloseSourceFile", "RemoveFile"], CleanupCalls: ["CloseSourceFile", "RemoveFile"] },
			{ BlockIndex: 7, Operation: "ReadSourceFileLine", CleanupMethods: ["RemoveFile"], CleanupCalls: ["RemoveFile"] },
			{ BlockIndex: 9, Operation: "WriteTextFile", CleanupMethods: ["RemoveFile"], CleanupCalls: ["RemoveFile"] },
		];
		const vecPrimaryCases = [
			{ Throws: false },
			{ Throws: true, Value: new Error("Controlled filesystem operation failure.") },
			{ Throws: true, Value: null },
			{ Throws: true, Value: undefined },
			{ Throws: true, Value: 0 },
		];
		let unScenarioCount = 0;
		for (const Case of vecCases) {
			for (const PrimaryCase of vecPrimaryCases) {
				for (let unFailureMask = 0; unFailureMask < (2 ** Case.CleanupMethods.length); ++unFailureMask) {
					const vecModes = (unFailureMask === 0) ? ["SUCCESS"] : ["FALSE", "THROWS"];
					for (const strMode of vecModes) {
						ResetFixture();

						const vecExpectedFailures = [];
						const vecCleanupCalls = [];
						const mapOriginalMethods = new Map([Case.Operation, ...Case.CleanupMethods].map(strMethodName => [strMethodName, Filesystem[strMethodName]]));
						let unOperationCallCount = 0;
						let CapturedFailure = null;

						if (PrimaryCase.Throws) {
							vecExpectedFailures.push({ Exact: true, Value: PrimaryCase.Value });
						}

						Filesystem[Case.Operation] = function ControlledOperation(...vecArguments) {
							const Result = Reflect.apply(mapOriginalMethods.get(Case.Operation), this, vecArguments);
							++unOperationCallCount;

							if (PrimaryCase.Throws) {
								throw PrimaryCase.Value;
							}

							return Result;
						};

						for (const [unMethodIndex, strMethodName] of Case.CleanupMethods.entries()) {
							const bFailCleanup = (unFailureMask & (1 << unMethodIndex)) !== 0;
							const CleanupFailure = new Error(`Controlled ${strMethodName} cleanup failure.`);
							Filesystem[strMethodName] = function ControlledCleanup(...vecArguments) {
								const Result = Reflect.apply(mapOriginalMethods.get(strMethodName), this, vecArguments);
								vecCleanupCalls.push(strMethodName);

								if (!bFailCleanup) {
									return Result;
								}

								if (strMode === "THROWS") {
									vecExpectedFailures.push({ Exact: true, Value: CleanupFailure });
									throw CleanupFailure;
								}

								vecExpectedFailures.push({ Exact: false, Message: (strMethodName === "CloseSourceFile") ? /could not be closed/ : /Unable to remove|could not remove/ });

								return false;
							};
						}

						try {
							ExecuteDocumentationBlock(vecBlocks[Case.BlockIndex], Case.BlockIndex, Filesystem);
						} catch (Failure) {
							CapturedFailure = { Value: Failure };
						} finally {
							for (const [strMethodName, OriginalMethod] of mapOriginalMethods) {
								Filesystem[strMethodName] = OriginalMethod;
							}
						}

						g_Assert(unOperationCallCount > 0, "The controlled operation must execute.");
						g_Assert.deepEqual(vecCleanupCalls, Case.CleanupCalls, "A failed cleanup must not skip subsequent resource cleanup.");
						g_Assert.equal(g_mapHandles.size, 0, "Controlled close faults occur after the fixture closes its handle; this is not native close-failure proof.");

						if (vecExpectedFailures.length === 0) {
							g_Assert.equal(CapturedFailure, null);
						} else {
							g_Assert.notEqual(CapturedFailure, null);

							if (vecExpectedFailures.length > 1) {
								g_Assert(CapturedFailure.Value instanceof AggregateError);
							}

							const vecActualFailures = (vecExpectedFailures.length === 1) ? [CapturedFailure.Value] : CapturedFailure.Value.errors;
							g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length);

							for (const [unFailureIndex, ExpectedFailure] of vecExpectedFailures.entries()) {
								if (ExpectedFailure.Exact) {
									g_Assert.strictEqual(vecActualFailures[unFailureIndex], ExpectedFailure.Value);
								} else {
									g_Assert(vecActualFailures[unFailureIndex] instanceof Error);
									g_Assert.match(vecActualFailures[unFailureIndex].message, ExpectedFailure.Message);
								}
							}
						}

						++unScenarioCount;
					}
				}
			}
		}

		g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
		ResetFixture();
		g_setCompletedContracts.add("DOCUMENTATION_CLEANUP");
	}

	function VerifyDocumentationConstructionFailure(strSource, Filesystem) {
		const unConstructionBlockIndex = 6;
		const OriginalSourceFile = Filesystem.SourceFile;
		const OriginalCloseSourceFile = Filesystem.CloseSourceFile;
		for (const Failure of [new Error("Controlled wrapper construction failure."), null, undefined, 0]) {
			ResetFixture();

			let unCloseCallCount = 0;
			let CapturedFailure = null;
			Filesystem.SourceFile = class SourceFileConstructionFailure extends OriginalSourceFile {
				constructor(...vecArguments) {
					super(...vecArguments);
					throw Failure;
				}
			};
			Filesystem.CloseSourceFile = function CloseControlledHandle(...vecArguments) {
				++unCloseCallCount;

				return Reflect.apply(OriginalCloseSourceFile, this, vecArguments);
			};

			try {
				ExecuteDocumentationBlock(strSource, unConstructionBlockIndex, Filesystem);
			} catch (ThrownFailure) {
				CapturedFailure = { Value: ThrownFailure };
			} finally {
				Filesystem.SourceFile = OriginalSourceFile;
				Filesystem.CloseSourceFile = OriginalCloseSourceFile;
			}

			g_Assert.notEqual(CapturedFailure, null);
			g_Assert.strictEqual(CapturedFailure.Value, Failure);
			g_Assert.equal(unCloseCallCount, 1, "The raw caller must close the handle when wrapper construction fails.");
			g_Assert.equal(g_mapHandles.size, 0);
			g_Assert.equal(g_mapFiles.size, 0);
		}

		ResetFixture();
		g_setCompletedContracts.add("DOCUMENTATION_CONSTRUCTION");
	}

	function IsTruncatingFileMode(strFileMode) {
		return strFileMode.includes("w") || strFileMode.includes("x");
	}

	function IsAppendingFileMode(strFileMode) {
		return strFileMode.includes("a");
	}

	function VerifyPublicRecord(Record, vecExpectedNames) {
		g_Assert.deepEqual(Object.keys(Record).sort(), vecExpectedNames.slice().sort());
	}

	function TestSourceFileRecords(Filesystem) {
		const Record = Filesystem.OpenSourceFile("record-shape.bin", "wb+", "GAME");
		let hSourceFile = Record.Handle;
		try {
			VerifyPublicRecord(Record, ["Handle", "FileMode", "FilePath", "PathID"]);
			g_Assert.equal(typeof hSourceFile, "bigint");
			g_Assert.equal(Record.FileMode, "wb+");
			g_Assert.equal(Record.FilePath, "record-shape.bin");
			g_Assert.equal(Record.PathID, "GAME");
			g_Assert.equal(Filesystem.WriteSourceFile(hSourceFile, Uint8Array.from([0x01, 0x02, 0x03, 0x04])), 4);

			const hOriginalSourceFile = hSourceFile;
			const TruncationResult = Filesystem.TruncateSourceFile(hSourceFile, Record.FilePath, Record.FileMode, Record.PathID, 2);
			hSourceFile = TruncationResult.Handle;
			VerifyPublicRecord(TruncationResult, ["Handle", "BytesWritten", "FileSize"]);
			g_Assert.equal(typeof hSourceFile, "bigint");
			g_Assert.notEqual(hSourceFile, hOriginalSourceFile);
			g_Assert.equal(g_mapHandles.has(hOriginalSourceFile), false);
			g_Assert.throws(() => Filesystem.GetSourceFileSize(hOriginalSourceFile), /Unknown handle/);
			g_Assert.equal(TruncationResult.FileSize, 2);
			g_Assert.equal(TruncationResult.BytesWritten, 2);
			g_Assert.equal(Filesystem.GetSourceFileSize(hSourceFile), 2);
		} finally {
			g_Assert.equal(Filesystem.CloseSourceFile(hSourceFile), true);
		}

		const SourceFileInstance = Filesystem.SourceFile.OpenSourceFile("owned-record.bin", "wb+");
		try {
			g_Assert.deepEqual(Object.keys(SourceFileInstance), []);

			const hOriginalSourceFile = SourceFileInstance.Handle;
			g_Assert.equal(SourceFileInstance.TruncateSourceFile(2), 2);
			g_Assert.notEqual(SourceFileInstance.Handle, hOriginalSourceFile);
			g_Assert.equal(g_mapHandles.has(hOriginalSourceFile), false);
			g_Assert.equal(SourceFileInstance.FileSize, 2);
		} finally {
			g_Assert.equal(SourceFileInstance.CloseSourceFile(), true);
		}

		// Deliberate obsolete public key: reject mixed canonical/legacy records.
		g_Assert.throws(() => VerifyPublicRecord({ Handle: 1n, handle: 1n }, ["Handle"]), { name: "AssertionError" });
		g_setCompletedContracts.add("RECORDS");
	}

	function TestSourceFileCallbacks(Filesystem) {
		const CallbackError = new Error("Filesystem callback fixture failure.");
		let SourceFileInstance = null;
		g_Assert.throws(() => Filesystem.SourceFile.UseSourceFile("callback-error.txt", (File) => {
			SourceFileInstance = File;
			throw CallbackError;
		}), (ErrorValue) => ErrorValue === CallbackError);
		g_Assert.equal(SourceFileInstance.Closed, true);

		const FilePromise = Promise.resolve("FileResult");
		g_Assert.strictEqual(Filesystem.SourceFile.UseSourceFile("callback-promise.txt", (File) => {
			SourceFileInstance = File;

			return FilePromise;
		}), FilePromise);
		g_Assert.equal(SourceFileInstance.Closed, true);

		SetFileBuffer("callback-error.tmp", "temporary");
		const ErrorLease = new Filesystem.SourceFileLease("callback-error.tmp", true);
		g_Assert.throws(() => ErrorLease.UseSourceFileLease(() => {
			throw CallbackError;
		}), (ErrorValue) => ErrorValue === CallbackError);
		g_Assert.equal(ErrorLease.TemporaryFile, false);
		g_Assert.equal(Filesystem.DoesFileExist(ErrorLease.FilePath), false);

		SetFileBuffer("callback-promise.tmp", "temporary");
		const PromiseLease = new Filesystem.SourceFileLease("callback-promise.tmp", true);
		const LeasePromise = Promise.resolve("LeaseResult");
		g_Assert.strictEqual(PromiseLease.UseSourceFileLease(() => LeasePromise), LeasePromise);
		g_Assert.equal(PromiseLease.TemporaryFile, false);
		g_Assert.equal(Filesystem.DoesFileExist(PromiseLease.FilePath), false);

		const OriginalSaveSourceFile = Filesystem.SaveSourceFile;
		const SaveError = new Error("Filesystem extraction fixture failure.");
		let strTemporaryFilePath = "";
		Filesystem.SaveSourceFile = (hSourceFile, strDestinationPath) => {
			GetSourceFileState(hSourceFile);
			strTemporaryFilePath = strDestinationPath;
			SetFileBuffer(strDestinationPath, "partial");
			throw SaveError;
		};
		try {
			g_Assert.throws(() => Filesystem.AcquireSourceFileLease("materials/from-vpk.vmt"), (ErrorValue) => ErrorValue === SaveError);
			g_Assert.equal(strTemporaryFilePath.length > 0, true);
			g_Assert.equal(Filesystem.DoesFileExist(strTemporaryFilePath), false);
			g_Assert.equal(g_mapHandles.size, 0);
		} finally {
			Filesystem.SaveSourceFile = OriginalSaveSourceFile;
		}

		g_setCompletedContracts.add("CALLBACKS");
	}

	function VerifyDocumentationOwnership(vecBlocks, Filesystem) {
		const unSettingsBlockIndex = 1;
		const unLogBlockIndex = 2;
		const strSourceDataRoot = "fixture-runtime-root/addons/sourcejs/data/sourcejs";
		const strSettingsFilePath = `${strSourceDataRoot}/examples/filesystem-settings.json`;
		const strLogFilePath = `${strSourceDataRoot}/examples/filesystem-audit.log`;
		const strExistingSettings = "{\"Enabled\":true,\"UpdateIntervalSeconds\":23}\n";

		ResetFixture();
		SetFileBuffer(strSettingsFilePath, strExistingSettings);
		ExecuteDocumentationBlock(vecBlocks[unSettingsBlockIndex], unSettingsBlockIndex, Filesystem);
		g_Assert.equal(GetFileBuffer(strSettingsFilePath).toString("utf8"), strExistingSettings);
		g_Assert.deepEqual(g_vecRemovedPaths, []);
		g_Assert.equal(g_mapHandles.size, 0);

		ResetFixture();
		SetFileBuffer(strSettingsFilePath, "{broken");
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unSettingsBlockIndex], unSettingsBlockIndex, Filesystem), SyntaxError);
		g_Assert.equal(GetFileBuffer(strSettingsFilePath).toString("utf8"), "{broken");
		g_Assert.deepEqual(g_vecRemovedPaths, []);

		ResetFixture();
		ExecuteDocumentationBlock(vecBlocks[unSettingsBlockIndex], unSettingsBlockIndex, Filesystem);
		g_Assert.equal(g_mapFiles.has(strSettingsFilePath), false);
		g_Assert.deepEqual(g_vecRemovedPaths, [strSettingsFilePath]);

		const OriginalWriteTextFile = Filesystem.WriteTextFile;
		try {
			for (const bPartialWrite of [false, true]) {
				ResetFixture();
				Filesystem.WriteTextFile = (strFilePath, strText) => {
					if (bPartialWrite) {
						SetFileBuffer(strFilePath, strText.slice(0, 1));
					}

					return false;
				};
				g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unSettingsBlockIndex], unSettingsBlockIndex, Filesystem), /Unable to write/);
				g_Assert.equal(g_mapFiles.has(strSettingsFilePath), false);
				g_Assert.deepEqual(g_vecRemovedPaths, bPartialWrite ? [strSettingsFilePath] : []);
			}
		} finally {
			Filesystem.WriteTextFile = OriginalWriteTextFile;
		}

		ResetFixture();
		SetFileBuffer(strLogFilePath, "Existing owner log\n");
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unLogBlockIndex], unLogBlockIndex, Filesystem), /already exists/);
		g_Assert.equal(GetFileBuffer(strLogFilePath).toString("utf8"), "Existing owner log\n");
		g_Assert.deepEqual(g_vecRemovedPaths, []);
		g_Assert.equal(g_mapHandles.size, 0);

		ResetFixture();
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unLogBlockIndex], unLogBlockIndex, Filesystem, { MapName: "" }), /requires an active map/);
		g_Assert.equal(g_setDirectories.size, 0);
		g_Assert.equal(g_mapFiles.size, 0);
		g_Assert.equal(g_mapHandles.size, 0);

		const unRulesBlockIndex = 3;
		const unStateCopyBlockIndex = 4;
		const unRawCopyBlockIndex = 5;
		const unWrappedFileBlockIndex = 6;
		const unQueueBlockIndex = 7;
		const vecExistingFileCases = [
			{ BlockIndex: unRulesBlockIndex, FileName: "filesystem-rules.txt" },
			{ BlockIndex: unStateCopyBlockIndex, FileName: "filesystem-state.bin" },
			{ BlockIndex: unStateCopyBlockIndex, FileName: "filesystem-state-copy.bin" },
			{ BlockIndex: unRawCopyBlockIndex, FileName: "filesystem-raw.txt" },
			{ BlockIndex: unRawCopyBlockIndex, FileName: "filesystem-raw-copy.txt" },
			{ BlockIndex: unWrappedFileBlockIndex, FileName: "filesystem-wrapped.txt" },
			{ BlockIndex: unQueueBlockIndex, FileName: "filesystem-queue.txt" },
		];
		for (const Case of vecExistingFileCases) {
			ResetFixture();
			const strExistingFilePath = `${strSourceDataRoot}/examples/${Case.FileName}`;
			SetFileBuffer(strExistingFilePath, "Existing owner data");
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[Case.BlockIndex], Case.BlockIndex, Filesystem), /already exists/);
			g_Assert.equal(GetFileBuffer(strExistingFilePath).toString("utf8"), "Existing owner data");
			g_Assert.deepEqual(g_vecRemovedPaths, []);
			g_Assert.equal(g_mapHandles.size, 0);
		}

		const vecFailedWriteCases = [
			{ BlockIndex: unRulesBlockIndex, FileName: "filesystem-rules.txt" },
			{ BlockIndex: unRawCopyBlockIndex, FileName: "filesystem-raw.txt" },
			{ BlockIndex: unQueueBlockIndex, FileName: "filesystem-queue.txt" },
		];
		try {
			for (const Case of vecFailedWriteCases) {
				for (const bPartialWrite of [false, true]) {
					ResetFixture();
					const strFailedFilePath = `${strSourceDataRoot}/examples/${Case.FileName}`;
					Filesystem.WriteTextFile = (strFilePath, strText) => {
						if (bPartialWrite) {
							SetFileBuffer(strFilePath, strText.slice(0, 1));
						}

						return false;
					};
					g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[Case.BlockIndex], Case.BlockIndex, Filesystem), /Unable to write/);
					g_Assert.equal(g_mapFiles.has(strFailedFilePath), false);
					g_Assert.deepEqual(g_vecRemovedPaths, bPartialWrite ? [strFailedFilePath] : []);
					g_Assert.equal(g_mapHandles.size, 0);
				}
			}
		} finally {
			Filesystem.WriteTextFile = OriginalWriteTextFile;
		}

		const unTemporaryFileBlockIndex = 9;
		const OriginalGetTemporaryFilePath = Filesystem.GetTemporaryFilePath;
		const OriginalReadTextFile = Filesystem.ReadTextFile;
		const strTemporaryTestPath = "/fixture/owned-temp.dat";
		try {
			Filesystem.GetTemporaryFilePath = () => strTemporaryTestPath;
			ResetFixture();
			SetFileBuffer(strTemporaryTestPath, "Existing owner data");
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unTemporaryFileBlockIndex], unTemporaryFileBlockIndex, Filesystem), /already exists/);
			g_Assert.equal(GetFileBuffer(strTemporaryTestPath).toString("utf8"), "Existing owner data");
			g_Assert.deepEqual(g_vecRemovedPaths, []);

			for (const bPartialWrite of [false, true]) {
				ResetFixture();
				Filesystem.WriteTextFile = (strFilePath, strText) => {
					if (bPartialWrite) {
						SetFileBuffer(strFilePath, strText.slice(0, 1));
					}

					return false;
				};
				g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unTemporaryFileBlockIndex], unTemporaryFileBlockIndex, Filesystem), /Unable to write/);
				g_Assert.equal(g_mapFiles.has(strTemporaryTestPath), false);
				g_Assert.deepEqual(g_vecRemovedPaths, bPartialWrite ? [strTemporaryTestPath] : []);
				g_Assert.equal(g_mapHandles.size, 0);
			}

			ResetFixture();
			Filesystem.WriteTextFile = OriginalWriteTextFile;
			Filesystem.ReadTextFile = () => null;
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unTemporaryFileBlockIndex], unTemporaryFileBlockIndex, Filesystem), /Unable to read/);
			g_Assert.equal(g_mapFiles.has(strTemporaryTestPath), false);
			g_Assert.deepEqual(g_vecRemovedPaths, [strTemporaryTestPath]);
			g_Assert.equal(g_mapHandles.size, 0);
		} finally {
			Filesystem.GetTemporaryFilePath = OriginalGetTemporaryFilePath;
			Filesystem.WriteTextFile = OriginalWriteTextFile;
			Filesystem.ReadTextFile = OriginalReadTextFile;
		}

		const MissingLease = Filesystem.AcquireSourceFileLease("missing-file.dat");
		g_Assert.equal(MissingLease.FilePath, "missing-file.dat");
		g_Assert.equal(MissingLease.TemporaryFile, false);
		g_Assert.equal(MissingLease.ReleaseSourceFileLease(), false);

		const FailedLease = new Filesystem.SourceFileLease("missing-temporary-file.dat", true);
		const CallbackFailure = new Error("Controlled lease callback failure.");
		g_Assert.throws(() => FailedLease.UseSourceFileLease(() => {
			throw CallbackFailure;
		}), /could not remove the temporary file/);
		g_Assert.equal(FailedLease.TemporaryFile, true);

		const vecCoercionCases = [
			{ Data: null, Text: "null" },
			{ Data: 17n, Text: "17" },
			{ Data: true, Text: "true" },
			{ Data: [0, 255], Text: "0,255" },
		];
		for (const Case of vecCoercionCases) {
			g_Assert.equal(CreateBuffer(Case.Data).toString("utf8"), Case.Text);
		}

		g_Assert.throws(() => CreateBuffer(Symbol("Unsupported string conversion")), TypeError);
		const ConversionFailure = new Error("Controlled string conversion failure.");
		g_Assert.throws(() => CreateBuffer({
			[Symbol.toPrimitive]() {
				throw ConversionFailure;
			},
		}), (Failure) => Failure === ConversionFailure);

		ResetFixture();
		g_setCompletedContracts.add("OWNERSHIP");
	}

	const g_unHeadSeekType = 0;
	const g_unCurrentSeekType = 1;
	const g_unTailSeekType = 2;

	// This fixture models result shapes and ownership: SDK file sizes/offsets are
	// unsigned 32-bit Number values; opaque handles are BigInt. It does not verify
	// real SDK IO, file modes, or native failure-path behavior.
	globalThis.sourcejs = {
		filesystem: {
			GetSeekTypes() {
				return { Head: g_unHeadSeekType, Current: g_unCurrentSeekType, Tail: g_unTailSeekType };
			},
			DoesFileExist(strFilePath) {
				return g_mapFiles.has(strFilePath) || g_setDirectories.has(strFilePath);
			},
			ReadTextFile(strFilePath) {
				return g_mapFiles.has(strFilePath) ? GetFileBuffer(strFilePath).toString("utf8") : null;
			},
			WriteTextFile(strFilePath, strText) {
				SetFileBuffer(strFilePath, strText);

				return true;
			},
			EnsureDirectoryExists(strFilePath) {
				g_setDirectories.add(strFilePath);

				return true;
			},
			IsVPKFile(strFilePath) {
				return g_setVPKFiles.has(strFilePath);
			},
			OpenSourceFile(strFilePath, strFileMode = "rt", strPathID = null) {
				const strSelectedPathID = (strPathID === null) ? "" : strPathID;
				if (IsTruncatingFileMode(strFileMode)) {
					SetFileBuffer(strFilePath, Buffer.alloc(0));
				} else if (!g_mapFiles.has(strFilePath)) {
					SetFileBuffer(strFilePath, Buffer.alloc(0));
				}

				const hHandle = g_hNextSourceFileHandle;
				g_hNextSourceFileHandle += 1n;
				g_mapHandles.set(hHandle, { Mode: strFileMode, Path: strFilePath, PathID: strSelectedPathID, Position: IsAppendingFileMode(strFileMode) ? GetFileBuffer(strFilePath).length : 0 });

				return { Handle: hHandle, Mode: strFileMode, Path: strFilePath, PathID: strSelectedPathID };
			},
			GetSourceFileSize(hHandle) {
				return GetFileBuffer(GetSourceFileState(hHandle).Path).length;
			},
			IsSourceFileAtEnd(hHandle) {
				const State = GetSourceFileState(hHandle);

				return State.Position >= GetFileBuffer(State.Path).length;
			},
			IsSourceFileTTY(hHandle) {
				GetSourceFileState(hHandle);

				return false;
			},
			IsSourceFileSeekable(hHandle) {
				GetSourceFileState(hHandle);

				return true;
			},
			GetSourceFileDescriptor(hHandle) {
				GetSourceFileState(hHandle);

				throw new Error("IFileSystem does not expose file descriptors.");
			},
			ReadSourceFile(hHandle, nSize = g_nUnspecifiedSourceFileSize, bBinaryMode = false) {
				const State = GetSourceFileState(hHandle);
				const arrFileBytes = GetFileBuffer(State.Path);
				const unAvailableByteCount = Math.max(0, arrFileBytes.length - State.Position);
				const unByteCount = (nSize < 0) ? unAvailableByteCount : Math.min(nSize, unAvailableByteCount);
				const arrSelectedBytes = arrFileBytes.subarray(State.Position, State.Position + unByteCount);
				State.Position += arrSelectedBytes.length;

				return bBinaryMode ? Uint8Array.from(arrSelectedBytes) : arrSelectedBytes.toString("utf8");
			},
			ReadSourceFileLine(hHandle, nSize = g_nUnspecifiedSourceFileSize, bBinaryMode = false) {
				const State = GetSourceFileState(hHandle);
				const arrFileBytes = GetFileBuffer(State.Path);
				let nLineEndIndex = arrFileBytes.indexOf(0x0A, State.Position);
				nLineEndIndex = (nLineEndIndex < 0) ? arrFileBytes.length : (nLineEndIndex + 1);

				if (nSize >= 0) {
					nLineEndIndex = Math.min(nLineEndIndex, State.Position + nSize);
				}

				const arrSelectedBytes = arrFileBytes.subarray(State.Position, nLineEndIndex);
				State.Position = nLineEndIndex;

				if (bBinaryMode) {
					return Uint8Array.from(arrSelectedBytes);
				}

				return arrSelectedBytes.toString("utf8").replace(/\r/g, "").replace(/\0/g, "\n");
			},
			WriteSourceFile(hHandle, Data) {
				const State = GetSourceFileState(hHandle);
				const arrCurrentBytes = GetFileBuffer(State.Path);
				const arrIncomingBytes = CreateBuffer(Data);
				const unEndOffset = State.Position + arrIncomingBytes.length;
				const arrNextBytes = Buffer.alloc(Math.max(arrCurrentBytes.length, unEndOffset));
				arrCurrentBytes.copy(arrNextBytes, 0, 0, arrCurrentBytes.length);
				arrIncomingBytes.copy(arrNextBytes, State.Position, 0, arrIncomingBytes.length);
				State.Position = unEndOffset;
				g_mapFiles.set(State.Path, arrNextBytes);

				return arrIncomingBytes.length;
			},
			TruncateSourceFile(hHandle, strFilePath, strFileMode, strPathID, nSize = g_nUnspecifiedSourceFileSize, OwnershipState) {
				g_Assert.equal(typeof OwnershipState, "object");
				OwnershipState.OriginalHandleConsumed = false;

				if (g_strTruncationFailureStage === "EARLY") {
					throw g_TruncationFailure;
				}

				const State = GetSourceFileState(hHandle);
				const arrCurrentBytes = GetFileBuffer(strFilePath);
				if (nSize < g_nUnspecifiedSourceFileSize) {
					throw new RangeError("Invalid truncation size.");
				}

				const unFinalSize = (nSize === g_nUnspecifiedSourceFileSize) ? State.Position : nSize;
				const arrNextBytes = Buffer.alloc(unFinalSize);
				arrCurrentBytes.copy(arrNextBytes, 0, 0, Math.min(arrCurrentBytes.length, unFinalSize));
				g_mapFiles.set(strFilePath, arrNextBytes);

				const hReopenedHandle = g_hNextSourceFileHandle;
				g_hNextSourceFileHandle += 1n;
				OwnershipState.OriginalHandleConsumed = true;
				g_mapHandles.delete(hHandle);

				if (g_strTruncationFailureStage === "LATE") {
					throw g_TruncationFailure;
				}

				if (g_strTruncationFailureStage === "PRIMITIVE") {
					throw g_nPrimitiveTruncationFailure;
				}

				if (g_strTruncationFailureStage === "INVALIDRESULT") {
					return undefined;
				}

				State.Mode = strFileMode;
				State.PathID = strPathID;
				g_mapHandles.set(hReopenedHandle, State);

				return { Handle: hReopenedHandle, Size: unFinalSize, BytesWritten: unFinalSize };
			},
			CloseSourceFile(hHandle) {
				++g_unCloseCallCount;

				return g_mapHandles.delete(hHandle);
			},
			SeekSourceFile(hHandle, nSeekOffset, unSeekType = g_unHeadSeekType) {
				const State = GetSourceFileState(hHandle);
				const unFileSize = GetFileBuffer(State.Path).length;
				if (!Number.isInteger(nSeekOffset) || ![g_unHeadSeekType, g_unCurrentSeekType, g_unTailSeekType].includes(unSeekType)) {
					throw new TypeError("Invalid seek arguments.");
				}

				if (unSeekType === g_unCurrentSeekType) {
					State.Position += nSeekOffset;
				} else if (unSeekType === g_unTailSeekType) {
					State.Position = unFileSize + nSeekOffset;
				} else {
					State.Position = nSeekOffset;
				}

				State.Position = Math.max(0, Math.min(unFileSize, State.Position));

				return true;
			},
			GetSourceFileOffset(hHandle) {
				return GetSourceFileState(hHandle).Position;
			},
			FlushSourceFile(hHandle) {
				GetSourceFileState(hHandle);

				return true;
			},
			SaveSourceFile(hHandle, strFilePath) {
				const State = GetSourceFileState(hHandle);
				const arrFileBytes = GetFileBuffer(State.Path).subarray(State.Position);
				SetFileBuffer(strFilePath, arrFileBytes);
				State.Position += arrFileBytes.length;

				return arrFileBytes.length;
			},
			GetTemporaryFilePath(strFileNamePrefix = "sourcejs-") {
				const unTemporaryIndex = g_unNextTemporaryIndex;
				g_unNextTemporaryIndex += 1;

				return `tmp/${strFileNamePrefix}${unTemporaryIndex}`;
			},
			RemoveFile(strFilePath) {
				g_vecRemovedPaths.push(strFilePath);

				return g_mapFiles.delete(strFilePath);
			},
		},
	};

	delete require.cache[g_strPackagePath];
	delete require.cache[g_strRuntimePath];

	const g_Filesystem = require(g_strPackagePath);
	g_Assert(g_Filesystem === globalThis.sourcejs.filesystem, "filesystem should extend and expose the exact native module object");
	g_Assert.equal(typeof g_Filesystem.GetSeekTypes, "function", "GetSeekTypes() should remain part of the native API");
	g_Assert.deepEqual(g_Filesystem.GetSeekTypes(), { Head: 0, Current: 1, Tail: 2 }, "GetSeekTypes() should return native constants");
	g_Assert.equal(g_Filesystem.SeekType.HEAD, 0, "SeekType.HEAD");
	g_Assert.equal(g_Filesystem.SeekType.CURRENT, 1, "SeekType.CURRENT");
	g_Assert.equal(g_Filesystem.SeekType.TAIL, 2, "SeekType.TAIL");

	g_Assert(!g_Filesystem.DoesFileExist("cfg/sourcejs.cfg"), "DoesFileExist() should start false");
	g_Assert(g_Filesystem.WriteTextFile("cfg/sourcejs.cfg", "Enabled=1"), "WriteTextFile() should succeed");
	g_Assert(g_Filesystem.DoesFileExist("cfg/sourcejs.cfg"), "DoesFileExist() should see written file");
	g_Assert.equal(g_Filesystem.ReadTextFile("cfg/sourcejs.cfg"), "Enabled=1", "ReadTextFile()");
	g_Assert(g_Filesystem.EnsureDirectoryExists("cfg/sourcejs"), "EnsureDirectoryExists() should succeed");
	g_Assert(g_Filesystem.DoesFileExist("cfg/sourcejs"), "EnsureDirectoryExists() should create directory");
	g_setVPKFiles.add("materials/packed.vmt");
	g_Assert(g_Filesystem.IsVPKFile("materials/packed.vmt"), "IsVPKFile() should be the exact native API");

	const g_Writer = g_Filesystem.SourceFile.OpenSourceFile("logs/sourcejs.log", "wt", "GAME");
	g_Assert(!g_Writer.IsSourceFileReadable(), "writer should not be readable");
	g_Assert(g_Writer.IsSourceFileWritable(), "writer should be writable");
	g_Assert.equal(g_Writer.FilePath, "logs/sourcejs.log", "writer.FilePath");
	g_Assert.equal(g_Writer.PathID, "GAME", "writer.PathID");
	g_Assert.equal(g_Writer.WriteSourceFile("alpha\n"), 6, "WriteSourceFile()");
	g_Assert.equal(g_Writer.WriteSourceFileLines(["beta\n", "gamma"]), 10, "WriteSourceFileLines()");
	g_Assert.equal(g_Writer.GetSourceFileOffset(), 16, "GetSourceFileOffset() after writes");
	g_Assert.equal(g_Writer.FileSize, 16, "FileSize after writes");
	g_Assert(g_Writer.SeekSourceFile(-5, g_Filesystem.SeekType.TAIL), "SeekSourceFile() from tail should succeed");
	g_Assert.equal(g_Writer.GetSourceFileOffset(), 11, "GetSourceFileOffset() after tail seek");

	g_Writer.PathID = 7;
	g_Assert.throws(() => g_Writer.TruncateSourceFile(), /string path ID/, "TruncateSourceFile() should validate the live path ID");
	g_Writer.PathID = "GAME";
	g_Writer.FileMode = "";
	g_Assert.throws(() => g_Writer.TruncateSourceFile(), /non-empty mode/, "TruncateSourceFile() should validate the live mode");
	g_Writer.FileMode = "wt";
	g_Assert.throws(() => g_Writer.TruncateSourceFile(-2), /Invalid truncation size/, "TruncateSourceFile() should reject sizes below -1");

	g_Assert.equal(g_Writer.TruncateSourceFile(), 11, "TruncateSourceFile() default should use current position");
	g_Assert.equal(g_Writer.FileSize, 11, "size after truncate");

	for (const strStage of ["EARLY", "LATE", "PRIMITIVE", "INVALIDRESULT"]) {
		const File = g_Filesystem.SourceFile.OpenSourceFile("fault-" + strStage + ".bin", "wb+");
		const hOriginalSourceFileHandle = File.Handle;
		g_strTruncationFailureStage = strStage;
		try {
			g_Assert.throws(() => File.TruncateSourceFile(2), (Failure) => {
				if (strStage === "EARLY") {
					return Failure === g_TruncationFailure;
				}

				const bExpectedCause = (strStage === "PRIMITIVE") ? Failure.cause === g_nPrimitiveTruncationFailure : (strStage === "INVALIDRESULT") ? Failure.cause instanceof TypeError : Failure.cause === g_TruncationFailure;

				return (Failure.OriginalHandleConsumed === true) && bExpectedCause;
			});
		} finally {
			g_strTruncationFailureStage = "";
		}

		const bConsumed = strStage !== "EARLY";
		g_Assert.equal(File.Closed, bConsumed);
		g_Assert.equal(File.Handle, bConsumed ? null : hOriginalSourceFileHandle);
		g_Assert.equal(g_mapHandles.has(hOriginalSourceFileHandle), !bConsumed);
		const unPreviousCloseCallCount = g_unCloseCallCount;
		g_Assert.equal(File.CloseSourceFile(), !bConsumed);
		g_Assert.equal(g_unCloseCallCount - unPreviousCloseCallCount, bConsumed ? 0 : 1, "Do not retry a consumed handle close");
	}

	const g_RawFailureRecord = g_Filesystem.OpenSourceFile("raw-failure.bin", "wb+");
	g_strTruncationFailureStage = "LATE";
	try {
		g_Assert.throws(() => g_Filesystem.TruncateSourceFile(g_RawFailureRecord.Handle, g_RawFailureRecord.FilePath, g_RawFailureRecord.FileMode, g_RawFailureRecord.PathID, 2), (Failure) => (Failure.OriginalHandleConsumed === true) && (Failure.cause === g_TruncationFailure));
	} finally {
		g_strTruncationFailureStage = "";
	}

	g_Assert.equal(g_mapHandles.has(g_RawFailureRecord.Handle), false);
	g_Assert(g_Writer.SeekSourceFile(0, g_Filesystem.SeekType.HEAD), "SeekSourceFile() before save should succeed");
	const g_unUnsupportedSeekType = 99;
	g_Assert.throws(() => g_Writer.SeekSourceFile(0, g_unUnsupportedSeekType), TypeError, "SeekSourceFile() should reject unsupported seek types");
	g_Assert.equal(g_Writer.SaveSourceFile("logs/copy.log"), 11, "SaveSourceFile()");
	g_Assert.throws(() => g_Writer.SaveSourceFile(""), TypeError, "SaveSourceFile() should reject an empty destination path");
	g_Assert.equal(g_Filesystem.ReadTextFile("logs/copy.log"), "alpha\nbeta\n", "SaveSourceFile() content");
	g_Assert(g_Writer.FlushSourceFile(), "FlushSourceFile()");
	g_Assert.equal(g_Writer.IsSourceFileTTY(), false, "IsSourceFileTTY() should report Source handles as non-terminal");
	g_Assert(g_Writer.IsSourceFileSeekable(), "IsSourceFileSeekable() should delegate runtime");
	g_Assert.throws(() => g_Writer.GetSourceFileDescriptor(), { name: "Error", message: /^IFileSystem does not expose file descriptors\.$/ }, "GetSourceFileDescriptor() should preserve the unsupported native descriptor failure");
	g_Assert(g_Writer.CloseSourceFile(), "CloseSourceFile() should close open file");
	g_Assert(!g_Writer.CloseSourceFile(), "CloseSourceFile() should be false when already closed");
	g_Assert.throws(() => g_Writer.GetSourceFileOffset(), { name: "Error", message: /^File is already closed\.$/ }, "closed file should reject operations");

	SetFileBuffer("readme.txt", "one\r\ntwo\nthree");
	const g_Reader = g_Filesystem.SourceFile.OpenSourceFile("readme.txt", "rt");
	g_Assert(g_Reader.IsSourceFileReadable(), "reader should be readable");
	g_Assert(!g_Reader.IsSourceFileWritable(), "reader should not be writable");
	g_Assert.equal(g_Reader.ReadSourceFileLine(), "one\n", "ReadSourceFileLine() should return the native normalized line");
	g_Assert.deepEqual(g_Reader.ReadSourceFileLines(), ["two\n", "three"], "ReadSourceFileLines()");
	g_Assert.throws(() => g_Reader.ReadSourceFileLines(1.5), TypeError, "ReadSourceFileLines() should reject a fractional size hint");

	const g_ReadNativeSourceFileLine = g_Filesystem.ReadSourceFileLine;
	g_Filesystem.ReadSourceFileLine = function ReadSourceFileLine() {
		return "raw\r\0";
	};

	try {
		g_Assert.equal(g_Reader.ReadSourceFileLine(), "raw\r\0", "ReadSourceFileLine() should return a replaced native method result directly");
	} finally {
		g_Filesystem.ReadSourceFileLine = g_ReadNativeSourceFileLine;
	}

	g_Reader.SeekSourceFile(0);
	g_Assert.equal(g_Reader.ReadSourceFile(3), "one", "ReadSourceFile()");
	g_Assert.equal(g_Reader.GetSourceFileOffset(), 3, "GetSourceFileOffset() after read");
	g_Assert(g_Reader.CloseSourceFile(), "Reader CloseSourceFile()");

	const g_BinaryReader = g_Filesystem.SourceFile.OpenSourceFile("readme.txt", "rb");
	const g_arrBytes = g_BinaryReader.ReadSourceFile(3);
	g_Assert(g_arrBytes instanceof Uint8Array, "Binary ReadSourceFile() should return Uint8Array");
	g_Assert.equal(g_arrBytes.length, 3, "Binary ReadSourceFile() length");
	g_Assert(g_BinaryReader.CloseSourceFile(), "Binary CloseSourceFile()");

	let g_hUseHandle = null;
	const g_bUseResult = g_Filesystem.SourceFile.UseSourceFile("use.txt", function UseSourceFileCallback(File) {
		g_hUseHandle = File.Handle;
		File.WriteSourceFile("temporary");

		return File.Closed;
	}, { FileMode: "wt" });
	g_Assert.equal(g_bUseResult, false, "SourceFile.UseSourceFile() callback should receive open file");
	g_Assert(!g_mapHandles.has(g_hUseHandle), "SourceFile.UseSourceFile() should close file");
	g_Assert.equal(g_Filesystem.SourceFile.UseSourceFile("readme.txt", (File) => File.ReadSourceFileLine()), "one\n", "SourceFile.UseSourceFile() default mode");
	g_Assert.equal(g_Filesystem.SourceFile.UseSourceFile("readme.txt", (File) => File.PathID, { FileMode: "rt", PathID: "GAME" }), "GAME", "SourceFile.UseSourceFile() options");
	g_Assert.throws(() => g_Filesystem.SourceFile.UseSourceFile("readme.txt", "rt"), { name: "TypeError", message: /expects a callback function/ }, "SourceFile.UseSourceFile() should reject callback overloads");
	g_Assert.throws(() => g_Filesystem.SourceFile.UseSourceFile("readme.txt", () => true, null), TypeError, "SourceFile.UseSourceFile() should reject null options");
	g_Assert.throws(() => g_Filesystem.SourceFile.UseSourceFile("readme.txt", () => true, { FileMode: null }), TypeError, "SourceFile.UseSourceFile() should not mask null mode");

	const g_CloseNativeSourceFile = g_Filesystem.CloseSourceFile;
	let g_UnclosedSourceFile = null;
	g_Filesystem.CloseSourceFile = function CloseSourceFile() {
		return false;
	};

	try {
		g_Assert.throws(() => g_Filesystem.SourceFile.UseSourceFile("readme.txt", function UseSourceFileCallback(File) {
			g_UnclosedSourceFile = File;
		}), /could not close/, "SourceFile.UseSourceFile() should report native close failure");
	} finally {
		g_Filesystem.CloseSourceFile = g_CloseNativeSourceFile;
	}

	g_Assert(g_UnclosedSourceFile.CloseSourceFile(), "SourceFile.UseSourceFile() close-failure fixture should remain retryable");

	SetFileBuffer("materials/from-vpk.vmt", "packed-data");
	g_setVPKFiles.add("materials/from-vpk.vmt");

	const g_GetNativeTemporaryFilePath = g_Filesystem.GetTemporaryFilePath;
	const g_unHandleCountBeforeInvalidTemporaryPath = g_mapHandles.size;
	g_Filesystem.GetTemporaryFilePath = function GetTemporaryFilePath() {
		return "";
	};

	try {
		g_Assert.throws(() => g_Filesystem.AcquireSourceFileLease("materials/from-vpk.vmt"), /must return a non-empty string path/);
		g_Assert.equal(g_mapHandles.size, g_unHandleCountBeforeInvalidTemporaryPath, "AcquireSourceFileLease() should validate the temporary path before opening a source");
	} finally {
		g_Filesystem.GetTemporaryFilePath = g_GetNativeTemporaryFilePath;
	}

	const g_Lease = g_Filesystem.AcquireSourceFileLease("materials/from-vpk.vmt");
	g_Assert(g_Lease.TemporaryFile, "AcquireSourceFileLease() should mark VPK lease as temporary");
	g_Assert(g_Filesystem.DoesFileExist(g_Lease.FilePath), "AcquireSourceFileLease() should save VPK to temporary path");
	g_Assert.equal(g_Filesystem.ReadTextFile(g_Lease.FilePath), "packed-data", "AcquireSourceFileLease() temporary content");
	g_Assert(g_Lease.ReleaseSourceFileLease(), "AcquireSourceFileLease() lease close should remove temporary file");
	g_Assert(!g_Filesystem.DoesFileExist(g_Lease.FilePath), "AcquireSourceFileLease() lease close should delete temporary path");

	SetFileBuffer("materials/callback-vpk.vmt", "callback-data");
	g_setVPKFiles.add("materials/callback-vpk.vmt");
	const g_CallbackLease = g_Filesystem.AcquireSourceFileLease("materials/callback-vpk.vmt");
	const g_strCallbackPath = g_CallbackLease.UseSourceFileLease(function UseSourceFileLeaseCallback(strFilePath) {
		g_Assert(g_Filesystem.DoesFileExist(strFilePath), "AcquireSourceFileLease() callback should receive existing temp path");
		g_Assert.equal(g_Filesystem.ReadTextFile(strFilePath), "callback-data", "AcquireSourceFileLease() callback content");

		return strFilePath;
	});
	g_Assert(g_vecRemovedPaths.includes(g_strCallbackPath), "AcquireSourceFileLease() callback should remove temporary path");
	g_Assert(!g_Filesystem.DoesFileExist(g_strCallbackPath), "AcquireSourceFileLease() callback temp path should be gone");

	const g_RegularLease = g_Filesystem.AcquireSourceFileLease("cfg/sourcejs.cfg");
	g_Assert(!g_RegularLease.TemporaryFile, "AcquireSourceFileLease() should not copy regular files");
	g_Assert.equal(g_RegularLease.FilePath, "cfg/sourcejs.cfg", "AcquireSourceFileLease() regular path");
	g_Assert(!g_RegularLease.ReleaseSourceFileLease(), "AcquireSourceFileLease() regular lease close should be false");
	g_Assert.throws(() => new g_Filesystem.SourceFileLease("", true), /non-empty string path/);
	g_Assert.throws(() => new g_Filesystem.SourceFileLease("missing.tmp", true).UseSourceFileLease(() => true), /could not remove/);

	const g_MutableLease = new g_Filesystem.SourceFileLease("mutable.tmp", true);
	g_MutableLease.FilePath = "";
	g_Assert.throws(() => g_MutableLease.ReleaseSourceFileLease(), /FilePath must be a non-empty string/);
	g_MutableLease.FilePath = "mutable.tmp";
	g_MutableLease.TemporaryFile = "yes";
	g_Assert.throws(() => g_MutableLease.ReleaseSourceFileLease(), /TemporaryFile must be a boolean/);

	// Deliberate obsolete public spellings must remain absent.
	g_Assert(typeof g_Writer.toJSON === "undefined", "SourceFile should not expose a snapshot serializer");
	g_Assert((typeof g_Filesystem.isVpkFile === "undefined") && (typeof g_Writer.isAtty === "undefined"), "filesystem should not expose acronym aliases");
	g_Assert.throws(() => new g_Filesystem.SourceFile(0n), /positive bigint/);
	g_Assert.throws(() => new g_Filesystem.SourceFile(1), /positive bigint/);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile(""), /string strFilePath/);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile(7), /string strFilePath/);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile("readme.txt", ""), /non-empty string strFilePath\/strFileMode/);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile("readme.txt", 7), /string strFilePath/);
	g_Assert.throws(() => g_Filesystem.SourceFile.OpenSourceFile("readme.txt", "rt", 7), /string or null strPathID/);
	g_Assert.throws(() => g_Filesystem.AcquireSourceFileLease(""), /non-empty string file path/);
	g_Assert.throws(() => g_Filesystem.AcquireSourceFileLease(7), /string file path/);

	TestSourceFileRecords(g_Filesystem);
	TestSourceFileCallbacks(g_Filesystem);
	g_Assert.equal(g_mapHandles.size, 0);
	g_Assert.equal(g_Filesystem.ReadTextFile("missing.txt"), null);
	g_Assert.deepEqual(Object.keys(g_Lease), []);
	g_Assert.deepEqual(Object.getOwnPropertyNames(g_Filesystem.SourceFileLease.prototype).sort(), [
		"constructor",
		"FilePath",
		"TemporaryFile",
		"ReleaseSourceFileLease",
		"UseSourceFileLease",
	].sort());

	const g_unExpectedDocumentationBlockCount = 10;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount, "filesystem documentation should contain ten executable workflows");
	g_Assert.doesNotMatch(g_strDocumentation, /Generated by|generate_api_docs|const result =|console\.log\(result\)/);
	g_Assert.doesNotMatch(g_strDocumentation, /`(?:handle|mode|path|pathID|bytesWritten|size|temporary)`/);
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable filesystem documentation must use typed logging.");
	g_Assert.deepEqual(Object.keys(g_Filesystem).sort(), g_vecDocumentedExports.slice().sort());
	g_Assert.deepEqual(Object.getOwnPropertyNames(g_Filesystem.SourceFile.prototype).sort(), ["constructor", ...g_vecDocumentedSourceFileMembers.filter((strName) => !["OpenSourceFile", "UseSourceFile"].includes(strName))].sort());

	for (const strExportName of g_vecDocumentedExports) {
		g_Assert(g_strDocumentation.includes(`\`${strExportName}`), `filesystem.md must document ${strExportName}`);
	}

	for (const strMemberName of g_vecDocumentedSourceFileMembers) {
		g_Assert(g_strDocumentation.includes(`\`${strMemberName}`), `filesystem.md must document SourceFile.${strMemberName}`);
	}

	VerifyDocumentationExecutorContracts();
	VerifyDocumentationOwnership(g_vecDocumentationBlocks, g_Filesystem);
	VerifyDocumentationCleanupFailures(g_vecDocumentationBlocks, g_Filesystem);
	const g_unConstructionBlockIndex = 6;
	VerifyDocumentationConstructionFailure(g_vecDocumentationBlocks[g_unConstructionBlockIndex], g_Filesystem);
	g_Assert.deepEqual([...g_setCompletedContracts].sort(), [
		"RECORDS",
		"CALLBACKS",
		"OWNERSHIP",
		"DOCUMENTATION_CLEANUP",
		"DOCUMENTATION_CONSTRUCTION",
	].sort(), "All file ownership and cleanup contract helpers must execute.");

	for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
		ResetFixture();
		SetFileBuffer("materials/vgui/white_additive.vmt", "\"UnlitGeneric\"\n{\n\t\"$basetexture\" \"vgui/white\"\n}\n");
		g_setVPKFiles.add("materials/vgui/white_additive.vmt");
		ExecuteDocumentationBlock(strSource, unBlockIndex, g_Filesystem);
		g_Assert.equal(g_mapHandles.size, 0, `filesystem documentation block ${unBlockIndex + 1} leaked a native handle`);
		g_vecExecutedDocumentationBlocks.push(unBlockIndex);
	}

	g_Assert.deepEqual(g_vecExecutedDocumentationBlocks, Array.from(g_vecDocumentationBlocks.keys()), "All filesystem documentation workflows must execute.");

	delete require.cache[g_strPackagePath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strPackagePath), { name: "Error", message: /^SourceJS native runtime is not installed/ });

	console.log("[  OK  ] filesystem packages/documentation checks passed (native double, not SDK proof)");
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
