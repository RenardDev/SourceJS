#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "loggers.md");
const g_strFilesystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strLoggersPath = g_Path.join(g_strPackageRootPath, "loggers.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecEnsuredDirectories = [];
const g_vecFileOpenCalls = [];
const g_mapFileWrites = new Map();
const g_vecRuntimeMessages = [];
const g_vecFileCloseCalls = [];
const g_vecFileFlushCalls = [];
let g_unNextWriteByteLimit = null;
let g_bFailNextClose = false;

function RecordRuntime(strLevel, strMessage) {
	g_vecRuntimeMessages.push({ Level: strLevel, Message: strMessage });

	return `${strLevel}:${strMessage}`;
}

function InstallDependency(strModulePath, Dependency) {
	require.cache[strModulePath] = {
		exports: Dependency,
		filename: strModulePath,
		id: strModulePath,
		loaded: true,
	};
}

function ClearRecordedOutput() {
	g_vecEnsuredDirectories.length = 0;
	g_vecFileOpenCalls.length = 0;
	g_mapFileWrites.clear();
	g_vecRuntimeMessages.length = 0;
	g_vecFileCloseCalls.length = 0;
	g_vecFileFlushCalls.length = 0;
	g_unNextWriteByteLimit = null;
	g_bFailNextClose = false;
}

const g_NativeLoggers = {
	LogError(strMessage) {
		g_Assert.equal(typeof strMessage, "string");
		RecordRuntime("error", strMessage);
	},

	LogInfo(strMessage) {
		g_Assert.equal(typeof strMessage, "string");
		RecordRuntime("info", strMessage);
	},

	LogWarning(strMessage) {
		g_Assert.equal(typeof strMessage, "string");
		RecordRuntime("warning", strMessage);
	},
};

const g_NativeFilesystem = {
	SourceFile: {
		OpenSourceFile(strFilePath, strMode) {
			g_Assert.equal(typeof strFilePath, "string");
			g_Assert.equal(strMode, "at");

			const vecChunks = [];
			let bClosed = false;
			let bFlushed = false;
			let bPartialWrite = false;
			const unWriteByteLimit = g_unNextWriteByteLimit;
			const bCloseFails = g_bFailNextClose;
			g_unNextWriteByteLimit = null;
			g_bFailNextClose = false;

			g_vecFileOpenCalls.push({ FilePath: strFilePath, Mode: strMode });

			return {
				CloseSourceFile() {
					g_Assert.equal(bClosed, false);
					g_Assert.equal(bFlushed || bPartialWrite, true);
					bClosed = true;
					g_vecFileCloseCalls.push({ FilePath: strFilePath, Flushed: bFlushed });
					g_mapFileWrites.set(strFilePath, (g_mapFileWrites.get(strFilePath) ?? "") + vecChunks.join(""));

					return !bCloseFails;
				},

				FlushSourceFile() {
					g_Assert.equal(bClosed, false);
					bFlushed = true;
					g_vecFileFlushCalls.push(strFilePath);

					return true;
				},

				WriteSourceFile(strText) {
					g_Assert.equal(bClosed, false);
					g_Assert.equal(typeof strText, "string");
					const arrBytes = Buffer.from(strText, "utf8");
					const unWrittenByteCount = (unWriteByteLimit === null) ? arrBytes.length : Math.min(unWriteByteLimit, arrBytes.length);
					bPartialWrite = unWrittenByteCount !== arrBytes.length;
					vecChunks.push(arrBytes.subarray(0, unWrittenByteCount).toString("utf8"));

					return unWrittenByteCount;
				},
			};
		},
	},

	EnsureDirectoryExists(strDirectoryPath) {
		g_Assert.equal(typeof strDirectoryPath, "string");
		g_vecEnsuredDirectories.push(strDirectoryPath);

		return true;
	},
};

function LoadLoggers(NativeLoggers = undefined) {
	const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const vecCacheSnapshots = [g_strLoggersPath, g_strFilesystemPath, g_strPathsPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const OriginalModuleLoad = g_Module._load;

	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		if (NativeLoggers === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { loggers: NativeLoggers } });
		}

		InstallDependency(g_strFilesystemPath, g_NativeFilesystem);
		InstallDependency(g_strPathsPath, { LOG_ROOT: "C:/game/left4dead2/logs/sourcejs" });
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
			}

			if (strRequestName === "filesystem") {
				return OriginalModuleLoad.call(this, g_strFilesystemPath, ParentModule, bIsMain);
			}

			if (strRequestName === "paths") {
				return OriginalModuleLoad.call(this, g_strPathsPath, ParentModule, bIsMain);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strLoggersPath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		if (BridgeDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", BridgeDescriptor);
		}

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	}
}

const g_Loggers = LoadLoggers(g_NativeLoggers);

function CheckPrivateLoggerStorage() {
	const Manager = new g_Loggers.LogManager("private-storage", { Prefix: "[Private] ", LogAreas: 0 });
	const Parent = Manager.GetOrCreateChildLogger("parent");
	const Child = Parent.GetOrCreateChildLogger("child");
	const vecLoggers = [Manager, Parent, Child];
	const vecTrappedLoggers = [];
	const vecLegacyFieldNames = [
		"m_ParentLogger",
		"m_strLocalLoggerName",
		"m_mapChildLoggers",
		"m_strPrefix",
		"m_ValueLogLevelSource",
		"m_ValueLogAreasSource",
		"m_strStoredLogFilePath",
		"m_strStoredLogRecordFormat",
		"m_strStoredLogDateFormat",
	];

	try {
		for (const Logger of vecLoggers) {
			g_Assert.deepEqual(Reflect.ownKeys(Logger), [], "Logger backing storage must not expose m_* fields.");
			g_Assert.strictEqual(Logger.RootLogManager, Manager);
			g_Assert.equal(Logger.Prefix, "[Private] ");

			vecTrappedLoggers.push(Logger);

			for (const strLegacyFieldName of vecLegacyFieldNames) {
				g_Assert.equal(strLegacyFieldName in Logger, false);
				Object.defineProperty(Logger, strLegacyFieldName, {
					configurable: true,
					get() {
						throw new Error(`Public legacy field must not control logger storage: ${strLegacyFieldName}`);
					},
				});
			}
		}

		const LevelSource = { GetInteger: () => g_Loggers.LogLevel.WARNING };
		Manager.ValueLogLevelSource = LevelSource;
		Manager.ValueLogAreasSource = 0;
		Manager.FilePath = "private-storage";
		Manager.LogRecordFormat = "{LoggerName}: {Message}";
		Manager.LogDateFormat = "yyyy";
		g_Assert.strictEqual(Manager.ValueLogLevelSource, LevelSource);
		g_Assert.equal(Manager.ValueLogAreasSource, 0);
		g_Assert.strictEqual(Child.ParentLogger, Parent);
		g_Assert.strictEqual(Parent.ParentLogger, Manager);
		g_Assert.strictEqual(Manager.ParentLogger, null);
		g_Assert.equal(Child.LocalLoggerName, "child");
		g_Assert.equal(Child.LoggerName, "private-storage.parent.child");
		g_Assert.equal(Child.LogLevel, g_Loggers.LogLevel.WARNING);
		g_Assert.equal(Child.LogAreas, 0);
		g_Assert.equal(Child.FilePath, "C:/game/left4dead2/logs/sourcejs/private-storage.log");
		g_Assert.equal(Child.LogRecordFormat, "{LoggerName}: {Message}");
		g_Assert.equal(Child.LogDateFormat, "yyyy");
		g_Assert.equal(Child.LogInfo("filtered"), false);
		g_Assert.equal(Child.LogWarning("accepted"), true);
		g_Assert.strictEqual(Parent.GetOrCreateChildLogger("child"), Child);
		g_Assert.equal(Parent.DeleteChildLogger("child"), true);
		g_Assert.equal(Parent.ChildLoggers.size, 0);
		g_Assert.equal(Manager.UnloadLogManager(), true);
		g_Assert.equal(Manager.ChildLoggers.size, 0);
	} finally {
		for (const Logger of vecTrappedLoggers) {
			for (const strLegacyFieldName of vecLegacyFieldNames) {
				delete Logger[strLegacyFieldName];
			}
		}

		Manager.UnloadLogManager();
	}

	console.log("[  OK  ] loggers private storage: 3 hierarchy nodes and 27 legacy-field traps passed");
}

function CheckFilePrimitiveFailures() {
	const Open = g_NativeFilesystem.SourceFile.OpenSourceFile;
	const vecFailures = [new Error("Controlled log file failure."), null, undefined, 0];
	const vecOperations = [{ Phase: "NONE", Throws: false }];
	for (const strPhase of ["WRITE", "FLUSH"]) {
		for (const Failure of vecFailures) {
			vecOperations.push({ Phase: strPhase, Throws: true, Failure });
		}
	}

	const vecCloses = [{ Throws: false }, ...vecFailures.map(Failure => ({ Throws: true, Failure }))];
	let unCaseCount = 0;

	try {
		for (const Operation of vecOperations) {
			for (const Close of vecCloses) {
				let unWriteCount = 0;
				let unFlushCount = 0;
				let unCloseCount = 0;
				g_NativeFilesystem.SourceFile.OpenSourceFile = function OpenControlledLogFile() {
					return {
						WriteSourceFile(strText) {
							++unWriteCount;

							if (Operation.Phase === "WRITE") {
								throw Operation.Failure;
							}

							return Buffer.byteLength(strText, "utf8");
						},

						FlushSourceFile() {
							++unFlushCount;

							if (Operation.Phase === "FLUSH") {
								throw Operation.Failure;
							}

							return true;
						},

						CloseSourceFile() {
							++unCloseCount;

							if (Close.Throws) {
								throw Close.Failure;
							}

							return true;
						},
					};
				};

				const Manager = new g_Loggers.LogManager("primitive-failure", { LogAreas: g_Loggers.LogArea.SCRIPT, FilePath: "tests/primitive-failure" });
				let ObservedFailure = undefined;
				let bThrew = false;
				let bLogged = false;

				try {
					try {
						bLogged = Manager.LogInfo("Controlled file record.");
					} catch (Failure) {
						ObservedFailure = Failure;
						bThrew = true;
					}

					const vecExpected = [];
					if (Operation.Throws) {
						vecExpected.push(Operation.Failure);
					}

					if (Close.Throws) {
						vecExpected.push(Close.Failure);
					}

					g_Assert.equal(bThrew, vecExpected.length > 0, `Preserve ${Operation.Phase} and close failures, including null.`);

					if (vecExpected.length === 0) {
						g_Assert.equal(bLogged, true);

					} else if (vecExpected.length === 1) {
						g_Assert.equal(ObservedFailure, vecExpected[0]);

					} else {
						g_Assert.equal(ObservedFailure?.name, "AggregateError");
						g_Assert.ok(Array.isArray(ObservedFailure.errors));
						const vecObserved = Array.from(ObservedFailure.errors);
						g_Assert.equal(vecObserved.length, 2);
						g_Assert.equal(vecObserved[0], vecExpected[0]);
						g_Assert.equal(vecObserved[1], vecExpected[1]);
					}

					g_Assert.equal(unWriteCount, 1);
					g_Assert.equal(unFlushCount, (Operation.Phase === "WRITE") ? 0 : 1);
					g_Assert.equal(unCloseCount, 1, "Always attempt close once, even after write/flush throws.");
				} finally {
					g_Assert.equal(Manager.UnloadLogManager(), true);
				}

				++unCaseCount;
			}
		}
	} finally {
		g_NativeFilesystem.SourceFile.OpenSourceFile = Open;
		ClearRecordedOutput();
	}

	g_Assert.equal(unCaseCount, 45);
}

function CheckRepeatedChildOwnership() {
	let unCaseCount = 0;
	for (const strShape of ["ALIASES", "DIAMOND"]) {
		for (const strOperation of ["CLEAR", "DELETE", "UNLOAD"]) {
			const Root = new g_Loggers.LogManager("repeated-ownership");
			const Branch = Root.GetOrCreateChildLogger("branch");
			const First = Branch.GetOrCreateChildLogger("first");
			const vecOwners = [Root, Branch, First];
			let Second = null;
			if (strShape === "ALIASES") {
				Branch.ChildLoggers.set("alias", First);

			} else {
				Second = Branch.GetOrCreateChildLogger("second");
				const Shared = First.GetOrCreateChildLogger("shared");
				Second.ChildLoggers.set("shared", Shared);
				vecOwners.push(Second, Shared);
			}

			const vecSnapshots = vecOwners.map(Owner => ({ Owner, Entries: [...Owner.ChildLoggers] }));

			try {
				const RunOperation = () => {
					if (strOperation === "CLEAR") {
						return Branch.ClearChildLoggers();
					}

					if (strOperation === "DELETE") {
						return Root.DeleteChildLogger("branch");
					}

					return Root.UnloadLogManager();
				};
				g_Assert.throws(RunOperation, /repeated or cyclic logger/, `${strShape} must fail before ${strOperation} clears any owner.`);

				for (const Snapshot of vecSnapshots) {
					g_Assert.deepEqual([...Snapshot.Owner.ChildLoggers], Snapshot.Entries, "Invalid shared ownership must not partially clear the hierarchy.");
				}
			} finally {
				if (Second === null) {
					Branch.ChildLoggers.delete("alias");

				} else {
					Second.ChildLoggers.delete("shared");
				}

				g_Assert.equal(Root.UnloadLogManager(), true);
			}

			++unCaseCount;
		}
	}

	g_Assert.equal(unCaseCount, 6);
}

function CheckLiteralRecordFields() {
	const strMessage = "{Timestamp}|{LoggerName}|{LevelName}|{Message}|%(Timestamp)s|%(LoggerName)s|%(LevelName)s|%(Message)s|$&|$'|$`|🙂";
	const strLoggerName = "{Message}%(Message)s";
	const strTimestamp = "{LoggerName}";
	const strAllFields = [strTimestamp, strLoggerName, "INFO", strMessage].join("|");
	const vecCases = [
		{ Format: "{Message}", Expected: strMessage },
		{ Format: "%(Message)s", Expected: strMessage },
		{ Format: "{LoggerName}", Expected: strLoggerName },
		{ Format: "%(LoggerName)s", Expected: strLoggerName },
		{ Format: "{Timestamp}", Expected: strTimestamp },
		{ Format: "%(Timestamp)s", Expected: strTimestamp },
		{ Format: "{LevelName}|%(LevelName)s", Expected: "INFO|INFO" },
		{ Format: "{LoggerName}|{Message}|%(LoggerName)s|%(Message)s", Expected: [strLoggerName, strMessage, strLoggerName, strMessage].join("|") },
		{ Format: "{Timestamp}|{LoggerName}|{LevelName}|{Message}|%(Timestamp)s|%(LoggerName)s|%(LevelName)s|%(Message)s", Expected: strAllFields + "|" + strAllFields },
		{ Format: "{message}|%(loggerName)s|{Unknown}|%(Unknown)s", Expected: "{message}|%(loggerName)s|{Unknown}|%(Unknown)s" },
		{ Format: "{Message}|{Message}|%(Message)s|%(Message)s", Expected: [strMessage, strMessage, strMessage, strMessage].join("|") },
	];
	for (const Case of vecCases) {
		ClearRecordedOutput();
		const Manager = new g_Loggers.LogManager(strLoggerName, { LogAreas: g_Loggers.LogArea.CONSOLE | g_Loggers.LogArea.SCRIPT, FilePath: "literal-fields", LogDateFormat: strTimestamp, LogRecordFormat: Case.Format });

		try {
			g_Assert.equal(Manager.LogInfo(strMessage), true);
			g_Assert.deepEqual(g_vecRuntimeMessages, [{ Level: "info", Message: strMessage }], Case.Format);
			g_Assert.equal(g_mapFileWrites.get(Manager.FilePath), Case.Expected + "\n", Case.Format);
			g_Assert.equal(g_vecFileCloseCalls.length, 1);
			g_Assert.equal(g_vecFileFlushCalls.length, 1);
		} finally {
			g_Assert.equal(Manager.UnloadLogManager(), true);
		}
	}

	ClearRecordedOutput();
}

function CheckDocumentationResourceFailures() {
	const strSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecExamples = Array.from(strSource.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
	const vecFailures = [
		{ Mode: "NONE" },
		{ Mode: "THROW", Value: new Error("Controlled logger failure") },
		{ Mode: "THROW", Value: null },
		{ Mode: "THROW", Value: undefined },
		{ Mode: "THROW", Value: 0 },
		{ Mode: "THROW", Value: false },
	];
	const vecCleanupFailures = [...vecFailures, { Mode: "FALSE" }];
	const LogAtLevel = g_Loggers.LogInstance.prototype.LogAtLevel;
	let unCaseCount = 0;

	function FindExample(strMarker) {
		const vecMatches = vecExamples.filter((strExample) => strExample.includes(strMarker));
		g_Assert.equal(vecMatches.length, 1, strMarker);

		return vecMatches[0];
	}

	function Execute(strExample, Modules) {
		const Require = (strName) => {
			g_Assert.equal(Object.hasOwn(Modules, strName), true, strName);

			return Modules[strName];
		};
		const Run = new Function("require", '"use strict";\n' + strExample);
		const Context = g_VM.createContext({ Run, Require });
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			new g_VM.Script("Run(Require);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
		} catch (CaughtError) {
			bThrown = true;
			CaughtValue = CaughtError;
		}

		return { Thrown: bThrown, Value: CaughtValue };
	}

	function CheckFailures(Result, vecExpected) {
		g_Assert.equal(Result.Thrown, vecExpected.length > 0);

		if (vecExpected.length === 0) {
			return;
		}

		const vecActual = (vecExpected.length === 1) ? [Result.Value] : Result.Value.errors;
		if (vecExpected.length > 1) {
			g_Assert.equal(Result.Value instanceof AggregateError, true);
		}

		g_Assert.equal(vecActual.length, vecExpected.length);

		for (let unIndex = 0; unIndex < vecExpected.length; unIndex++) {
			const Failure = vecExpected[unIndex];
			if (Failure.Mode === "THROW") {
				g_Assert.equal(vecActual[unIndex], Failure.Value);

			} else {
				g_Assert.equal(vecActual[unIndex] instanceof Error, true);
				g_Assert.match(vecActual[unIndex].message, /cleanup failed|Failed to remove/);
			}
		}
	}

	try {
		for (const strManagerName of ["Audit", "Inventory", "Diagnostic", "Rotating", "Format", "Transaction"]) {
			const strExample = FindExample(`const g_${strManagerName}LogManager =`);
			const bUsesFile = ["Audit", "Rotating", "Transaction"].includes(strManagerName);
			for (const Primary of vecFailures) {
				for (const Unload of vecCleanupFailures) {
					for (const Remove of bUsesFile ? vecCleanupFailures : [vecFailures[0]]) {
						ClearRecordedOutput();
						let unUnloadCalls = 0;
						let unRemoveCalls = 0;
						let bPrimaryThrown = false;
						g_Loggers.LogInstance.prototype.LogAtLevel = function LogAtLevelWithFailure(...vecArguments) {
							const bLogged = LogAtLevel.apply(this, vecArguments);
							if (!bPrimaryThrown && (Primary.Mode === "THROW")) {
								bPrimaryThrown = true;
								throw Primary.Value;
							}

							return bLogged;
						};

						class ControlledLogManager extends g_Loggers.LogManager {
							UnloadLogManager() {
								unUnloadCalls++;

								if (Unload.Mode === "THROW") {
									throw Unload.Value;
								}

								return (Unload.Mode === "FALSE") ? false : super.UnloadLogManager();
							}
						}

						const Modules = {
							cvars: { RequireConVar: () => ({ Value: g_Loggers.LogLevel.DEBUG }) },
							filesystem: {
								DoesFileExist: (strPath) => g_mapFileWrites.has(strPath),
								RemoveFile(strPath) {
									unRemoveCalls++;

									if (Remove.Mode === "THROW") {
										throw Remove.Value;
									}

									return (Remove.Mode === "FALSE") ? false : g_mapFileWrites.delete(strPath);
								},
							},
							"filters/players": { GetAllPlayers: () => [{ Name: "Ren", Health: 87, Dead: false, FakeClient: false, NetworkID: "STEAM_1:1:42" }] },
							globals: { GetGlobalVariables: () => ({ MapName: "test", TickCount: 42, AbsoluteFrameTime: 0.02 }) },
							loggers: { ...g_Loggers, LogManager: ControlledLogManager },
							players: { GetActiveWeapon: () => null },
							weapons: { GetWeaponName: () => "weapon_test" },
						};
						const Result = Execute(strExample, Modules);
						g_Assert.equal(unUnloadCalls, 1, strManagerName);
						g_Assert.equal(unRemoveCalls, bUsesFile ? 1 : 0, strManagerName);
						CheckFailures(Result, [Primary, Unload, Remove].filter((Failure) => Failure.Mode !== "NONE"));
						g_Assert.equal(g_mapFileWrites.size, (bUsesFile && (Remove.Mode !== "NONE")) ? 1 : 0);
						unCaseCount++;
					}
				}
			}

			if (bUsesFile) {
				for (const strPreflightMode of ["EXISTING", "THROW"]) {
					ClearRecordedOutput();
					let unUnloadCalls = 0;
					let unRemoveCalls = 0;
					let strExistingPath = "";
					const PreflightError = new Error("Controlled existence check failure");
					class ControlledLogManager extends g_Loggers.LogManager {
						UnloadLogManager() {
							unUnloadCalls++;

							return super.UnloadLogManager();
						}
					}

					const Modules = {
						filesystem: {
							DoesFileExist(strPath) {
								if (strPreflightMode === "THROW") {
									throw PreflightError;
								}

								strExistingPath = strPath;
								g_mapFileWrites.set(strPath, "foreign file");

								return true;
							},

							RemoveFile() {
								unRemoveCalls++;

								return false;
							},
						},
						"filters/players": { GetAllPlayers: () => [{ NetworkID: "STEAM_1:1:42" }] },
						globals: { GetGlobalVariables: () => ({}) },
						loggers: { ...g_Loggers, LogManager: ControlledLogManager },
						players: { GetActiveWeapon: () => null },
						weapons: {},
					};
					g_Loggers.LogInstance.prototype.LogAtLevel = LogAtLevel;
					const Result = Execute(strExample, Modules);
					g_Assert.equal(Result.Thrown, true);
					g_Assert.equal(unUnloadCalls, 1);
					g_Assert.equal(unRemoveCalls, 0);
					g_Assert.equal(g_vecFileOpenCalls.length, 0);

					if (strPreflightMode === "THROW") {
						g_Assert.equal(Result.Value, PreflightError);

					} else {
						g_Assert.match(Result.Value.message, /Refusing to append/);
						g_Assert.equal(g_mapFileWrites.get(strExistingPath), "foreign file");
					}

					unCaseCount++;
				}
			}
		}

		g_Assert.equal(unCaseCount, 1014);
	} finally {
		g_Loggers.LogInstance.prototype.LogAtLevel = LogAtLevel;
		ClearRecordedOutput();
	}
}

function CheckDocumentationRootRestoration() {
	const strSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const vecExamples = Array.from(strSource.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]).filter((strExample) => strExample.includes("const g_ValuePreviousLogLevelSource ="));
	g_Assert.equal(vecExamples.length, 1);
	const Run = new Function("require", '"use strict";\n' + vecExamples[0]);
	const vecFailures = [
		{ Mode: "NONE" },
		...[new Error("Controlled root failure"), null, undefined, 0, false].map((Value) => ({ Mode: "THROW", Value })),
	];
	let unCaseCount = 0;

	try {
		for (const Primary of vecFailures) {
			for (const LevelRestore of vecFailures) {
				for (const AreasRestore of vecFailures) {
					ClearRecordedOutput();
					const Root = new g_Loggers.LogManager("sourcejs");
					const vecRestoreAttempts = [];
					const vecExpected = [Primary, LevelRestore, AreasRestore].filter((Failure) => Failure.Mode === "THROW").map((Failure) => Failure.Value);
					const PreviousLevelSource = {
						GetInteger() {
							throw new Error("Restoration must not resolve previous level source");
						},
					};
					const PreviousAreasSource = {
						GetInteger() {
							throw new Error("Restoration must not resolve previous area source");
						},
					};
					Root.LogLevel = PreviousLevelSource;
					Root.LogAreas = PreviousAreasSource;

					for (const Configuration of [
						{ Name: "LogLevel", Previous: PreviousLevelSource, Failure: LevelRestore },
						{ Name: "LogAreas", Previous: PreviousAreasSource, Failure: AreasRestore },
					]) {
						const Descriptor = Object.getOwnPropertyDescriptor(g_Loggers.LogManager.prototype, Configuration.Name);
						Object.defineProperty(Root, Configuration.Name, {
							get: Descriptor.get,
							set(Value) {
								if (Value === Configuration.Previous) {
									vecRestoreAttempts.push(Configuration.Name);

									if (Configuration.Failure.Mode === "THROW") {
										throw Configuration.Failure.Value;
									}
								}

								Descriptor.set.call(this, Value);
							},
						});
					}

					Root.UnloadLogManager = () => {
						throw new Error("Shared root must not be unloaded");
					};

					const Modules = {
						...g_Loggers,
						ROOT_LOGGER: Root,
						LogDebug(...vecArguments) {
							const bLogged = Root.LogDebug(...vecArguments);
							if (Primary.Mode === "THROW") {
								throw Primary.Value;
							}

							return bLogged;
						},
					};
					const Require = (strName) => {
						g_Assert.equal(strName, "loggers");

						return Modules;
					};
					const Context = g_VM.createContext({ Run, Require });
					let bThrown = false;
					let CaughtValue = undefined;

					try {
						new g_VM.Script("Run(Require);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
					} catch (CaughtError) {
						bThrown = true;
						CaughtValue = CaughtError;
					}

					g_Assert.equal(bThrown, vecExpected.length > 0);
					g_Assert.deepEqual(vecRestoreAttempts, ["LogLevel", "LogAreas"]);

					if (vecExpected.length === 1) {
						g_Assert.equal(CaughtValue, vecExpected[0]);

					} else if (vecExpected.length > 1) {
						g_Assert.equal(CaughtValue instanceof AggregateError, true);
						g_Assert.deepEqual(CaughtValue.errors, vecExpected);
					}

					if (LevelRestore.Mode === "NONE") {
						g_Assert.equal(Root.ValueLogLevelSource, PreviousLevelSource);
					}

					if (AreasRestore.Mode === "NONE") {
						g_Assert.equal(Root.ValueLogAreasSource, PreviousAreasSource);
					}

					unCaseCount++;
				}
			}
		}

		g_Assert.equal(unCaseCount, 216);
	} finally {
		ClearRecordedOutput();
	}
}

function CheckExports() {
	g_Assert.deepEqual(Object.keys(g_Loggers).sort(), [
		"LogArea",
		"LogAtLevel",
		"LogCritical",
		"LogDebug",
		"LogError",
		"LogException",
		"LogInfo",
		"LogInstance",
		"LogLevel",
		"LogManager",
		"LogMessage",
		"LogWarning",
		"ROOT_LOGGER",
	].sort());
	g_Assert.deepEqual(g_Loggers.LogLevel, {
		CRITICAL: 50,
		DEBUG: 10,
		ERROR: 40,
		INFO: 20,
		MESSAGE: 60,
		WARNING: 30,
	});
	g_Assert.deepEqual(g_Loggers.LogArea, {
		ALL: 15,
		CONSOLE: 1,
		MAIN: 2,
		SCRIPT: 8,
		SOURCEJS: 4,
	});
	g_Assert.equal(Object.isFrozen(g_Loggers.LogLevel), true);
	g_Assert.equal(Object.isFrozen(g_Loggers.LogArea), true);
	g_Assert.equal(g_Loggers.ROOT_LOGGER instanceof g_Loggers.LogManager, true);
	g_Assert.equal(g_Loggers.ROOT_LOGGER.LoggerName, "sourcejs");
	g_Assert.equal(g_Loggers.ROOT_LOGGER.LogLevel, g_Loggers.LogLevel.DEBUG);
	g_Assert.equal(g_Loggers.ROOT_LOGGER.LogAreas, g_Loggers.LogArea.CONSOLE);
	g_Assert.deepEqual(Object.getOwnPropertyNames(g_Loggers.LogInstance.prototype).sort(), [
		"ChildLoggers",
		"ClearChildLoggers",
		"DeleteChildLogger",
		"FilePath",
		"GetOrCreateChildLogger",
		"LogAtLevel",
		"LogCritical",
		"LogDebug",
		"LogError",
		"LogException",
		"LogInfo",
		"LogAreas",
		"LogDateFormat",
		"LogLevel",
		"LogMessage",
		"LogRecordFormat",
		"LogWarning",
		"LocalLoggerName",
		"LoggerName",
		"ParentLogger",
		"Prefix",
		"RootLogManager",
		"constructor",
	].sort());
	g_Assert.deepEqual(Object.getOwnPropertyNames(g_Loggers.LogManager.prototype).sort(), [
		"FilePath",
		"LogAreas",
		"LogDateFormat",
		"LogLevel",
		"LogRecordFormat",
		"UnloadLogManager",
		"ValueLogAreasSource",
		"ValueLogLevelSource",
		"constructor",
	].sort());
	g_Assert.equal("rootLogger" in g_Loggers, false);
	g_Assert.equal("moduleName" in g_Loggers, false);
	g_Assert.equal("default" in g_Loggers, false);

	for (const LoggerType of [g_Loggers.LogInstance, g_Loggers.LogManager]) {
		let bAccessorSeen = false;
		for (const strMemberName of Object.getOwnPropertyNames(LoggerType.prototype)) {
			const Descriptor = Object.getOwnPropertyDescriptor(LoggerType.prototype, strMemberName);
			if ((typeof Descriptor.get === "function") || (typeof Descriptor.set === "function")) {
				bAccessorSeen = true;

			} else {
				g_Assert.equal(bAccessorSeen, false, `${LoggerType.name} operations precede accessors`);
			}
		}
	}
}

function CheckHierarchy() {
	const Manager = new g_Loggers.LogManager("inventory", {
		LogAreas: g_Loggers.LogArea.CONSOLE,
		LogLevel: g_Loggers.LogLevel.DEBUG,
		Prefix: "[Inventory] ",
	});
	const DatabaseLogger = Manager.GetOrCreateChildLogger("database");
	const QueryLogger = DatabaseLogger.GetOrCreateChildLogger("query");
	const ManualLogger = new g_Loggers.LogInstance(Manager, "manual", { Prefix: "[Manual] " });

	g_Assert.strictEqual(Manager.GetOrCreateChildLogger("database"), DatabaseLogger);
	g_Assert.equal(QueryLogger.LoggerName, "inventory.database.query");
	g_Assert.strictEqual(QueryLogger.RootLogManager, Manager);
	g_Assert.equal(QueryLogger.Prefix, "[Inventory] ");
	g_Assert.equal(ManualLogger.LoggerName, "inventory.manual");
	g_Assert.equal(ManualLogger.Prefix, "[Manual] ");
	g_Assert.equal(Manager.DeleteChildLogger("database"), true);
	g_Assert.equal(DatabaseLogger.ChildLoggers.size, 0);
	g_Assert.equal(Manager.DeleteChildLogger("database"), false);
	Manager.ClearChildLoggers();
	g_Assert.equal(Manager.ChildLoggers.size, 0);
	g_Assert.equal(Manager.UnloadLogManager(), true);

	g_Assert.throws(() => new g_Loggers.LogInstance(), /require a parent logger/);
	g_Assert.throws(() => new g_Loggers.LogInstance({}, "invalid"), /parent must be another LogInstance/);
	g_Assert.throws(() => new g_Loggers.LogInstance(Manager, 5), /requires a string name/);
	g_Assert.throws(() => new g_Loggers.LogInstance(Manager, "invalid", []), /requires a string name and options object/);
	g_Assert.throws(() => new g_Loggers.LogInstance(Manager, "invalid", { Prefix: 5 }), /prefix must be a string/);
	g_Assert.throws(() => Manager.GetOrCreateChildLogger(""), /non-empty string/);
	g_Assert.throws(() => Manager.DeleteChildLogger(5), /must be a string/);
	g_Assert.equal("get" in g_Loggers.LogInstance.prototype, false);
	g_Assert.equal("toJSON" in g_Loggers.LogInstance.prototype, false);

	// These legacy input spellings must not be read or normalized to canonical options.
	const LegacyOptions = {};
	for (const strLegacyOptionName of [
		"m_strPrefix",
		"m_ValueLogLevel",
		"m_ValueLogAreas",
		"m_strFilePath",
		"m_strLogRecordFormat",
		"m_strLogDateFormat",
	]) {
		Object.defineProperty(LegacyOptions, strLegacyOptionName, {
			get() {
				throw new Error(`Legacy logger option '${strLegacyOptionName}' was read.`);
			},
		});
	}

	const CanonicalManager = new g_Loggers.LogManager("canonical", LegacyOptions);
	g_Assert.equal(CanonicalManager.Prefix, "");
	g_Assert.equal(CanonicalManager.LogLevel, g_Loggers.LogLevel.INFO);
	g_Assert.equal(CanonicalManager.LogAreas, g_Loggers.LogArea.CONSOLE);
	g_Assert.equal(CanonicalManager.FilePath, null);
	g_Assert.equal(CanonicalManager.LogRecordFormat, null);
	g_Assert.equal(CanonicalManager.LogDateFormat, null);
	const CanonicalChild = new g_Loggers.LogInstance(CanonicalManager, "child", LegacyOptions);
	g_Assert.equal(CanonicalChild.Prefix, "");
	g_Assert.equal(CanonicalManager.UnloadLogManager(), true);
}

function CheckRoutingAndLiveSources() {
	ClearRecordedOutput();

	let unConfiguredAreas = g_Loggers.LogArea.CONSOLE;
	let unConfiguredLevel = g_Loggers.LogLevel.INFO;
	const Manager = new g_Loggers.LogManager("runtime", {
		LogAreas: {
			GetInteger() {
				return unConfiguredAreas;
			},
		},
		LogLevel: {
			GetInteger() {
				return unConfiguredLevel;
			},
		},
		Prefix: "[Runtime] ",
	});

	g_Assert.equal(Manager.LogDebug("hidden"), false);
	g_Assert.equal(g_vecRuntimeMessages.length, 0);
	unConfiguredLevel = g_Loggers.LogLevel.DEBUG;
	g_Assert.equal(Manager.LogDebug("debug"), true);
	g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "info", Message: "[Runtime] debug" });
	g_Assert.equal(Manager.LogWarning("warning"), true);
	g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "warning", Message: "[Runtime] warning" });
	g_Assert.equal(Manager.LogCritical("critical"), true);
	g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "error", Message: "[Runtime] critical" });

	unConfiguredLevel = 100;
	g_Assert.equal(Manager.LogInfo("filtered"), false);
	g_Assert.equal(Manager.LogMessage("unfiltered"), true);
	g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "info", Message: "[Runtime] unfiltered" });
	unConfiguredAreas = 0;
	g_Assert.equal(Manager.LogError("not routed"), false);
	unConfiguredLevel = g_Loggers.LogLevel.ERROR;
	g_Assert.equal(Manager.LogError("no area"), true);
	g_Assert.equal(g_vecRuntimeMessages.at(-1).Message, "[Runtime] unfiltered");

	Manager.LogLevel = 1.5;
	g_Assert.throws(() => Manager.LogLevel, /must be an integer/);
	Manager.ValueLogLevelSource = { GetInteger: () => "20" };
	g_Assert.throws(() => Manager.LogLevel, /must be an integer/);
	Manager.LogLevel = g_Loggers.LogLevel.INFO;
	Manager.LogAreas = Infinity;
	g_Assert.throws(() => Manager.LogAreas, /must be an integer/);
	Manager.LogAreas = g_Loggers.LogArea.CONSOLE;
	Manager.UnloadLogManager();
}

function CheckFormattingAndFiles() {
	ClearRecordedOutput();

	const Manager = new g_Loggers.LogManager("root", {
		LogAreas: g_Loggers.LogArea.CONSOLE | g_Loggers.LogArea.SCRIPT,
		LogDateFormat: "yyyy/MM/dd HH:mm:ss.SSS",
		FilePath: "plugins/demo",
		LogRecordFormat: "{Timestamp}|{LoggerName}|{LevelName}|{Message}",
		LogLevel: g_Loggers.LogLevel.DEBUG,
		Prefix: "[SJS] ",
	});

	g_Assert.equal(Manager.FilePath, "C:/game/left4dead2/logs/sourcejs/plugins/demo.log");
	g_Assert.equal(Manager.LogInfo("%s %d %i %f %j %o %O %% %q", "value", 7.9, -3.8, 1.25, { JSON: true }, [1, 2], { Object: true }, "extra", 9n), true);
	g_Assert.equal(g_vecRuntimeMessages.at(-1).Message, '[SJS] value 7 -3 1.25 {"JSON":true} [1,2] {"Object":true} % %q extra 9');
	g_Assert.deepEqual(g_vecEnsuredDirectories, ["C:/game/left4dead2/logs/sourcejs/plugins"]);
	g_Assert.deepEqual(g_vecFileOpenCalls, [{ FilePath: Manager.FilePath, Mode: "at" }]);
	g_Assert.match(g_mapFileWrites.get(Manager.FilePath), /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\|root\|INFO\|value 7 -3 1\.25 /);
	g_Assert.equal(g_mapFileWrites.get(Manager.FilePath).includes("[SJS]"), false);

	Manager.LogRecordFormat = "%(Timestamp)s|%(LoggerName)s|%(LevelName)s|%(Message)s";
	Manager.LogDateFormat = "%Y-%m-%d %H:%M:%S";
	g_Assert.equal(Manager.LogWarning("second"), true);
	g_Assert.match(g_mapFileWrites.get(Manager.FilePath), /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\|root\|WARNING\|second/);

	// Legacy spellings are negative inputs, not compatibility aliases.
	Manager.LogRecordFormat = "{Timestamp}|{loggerName}|%(levelName)s|{Message}";
	g_Assert.equal(Manager.LogInfo("canonical token check"), true);
	g_Assert.match(g_mapFileWrites.get(Manager.FilePath), /\|\{loggerName\}\|%\(levelName\)s\|canonical token check\n$/);

	Manager.LogRecordFormat = "{Message}";
	Manager.LogAreas = g_Loggers.LogArea.SCRIPT;
	const unRuntimeMessageCount = g_vecRuntimeMessages.length;
	for (const strUnicodeMessage of [
		"ASCII",
		"\0",
		"\u007F",
		"\u0080",
		"\u00E9",
		"\u0416",
		"\u07FF",
		"\u0800",
		"\u6F22",
		"\uFFFF",
		"\u{10000}",
		"\u{1F600}",
		"\u{10FFFF}",
		"\uD800",
		"\uDC00",
		"\uD800A",
		"\uD800\uDC00",
	]) {
		g_Assert.equal(Manager.LogInfo(strUnicodeMessage), true);
		g_Assert.equal(g_mapFileWrites.get(Manager.FilePath).endsWith(Buffer.from(`${strUnicodeMessage}\n`, "utf8").toString("utf8")), true);
	}

	g_Assert.equal(g_vecRuntimeMessages.length, unRuntimeMessageCount, "script-only byte tests do not use the native console sink");
	Manager.LogAreas = g_Loggers.LogArea.CONSOLE | g_Loggers.LogArea.SCRIPT;

	const unClosedFileCount = g_vecFileCloseCalls.length;
	const unFlushedFileCount = g_vecFileFlushCalls.length;
	g_unNextWriteByteLimit = 1;
	g_Assert.throws(() => Manager.LogInfo("short native write"), /Could not append log file/);
	g_Assert.equal(g_vecFileCloseCalls.length, unClosedFileCount + 1);
	g_Assert.equal(g_vecFileCloseCalls.at(-1).Flushed, false);
	g_Assert.equal(g_vecFileFlushCalls.length, unFlushedFileCount);

	g_unNextWriteByteLimit = 1;
	g_bFailNextClose = true;
	g_Assert.throws(() => Manager.LogInfo("short write and cleanup failure"), (ErrorValue) => {
		g_Assert.equal(ErrorValue instanceof AggregateError, true);
		g_Assert.equal(ErrorValue.errors.length, 2);
		g_Assert.match(ErrorValue.errors[0].message, /Could not append log file/);
		g_Assert.match(ErrorValue.errors[1].message, /Could not close log file/);

		return true;
	});

	g_Assert.throws(() => Manager.LogInfo("invalid %d", "7"), /finite number/);
	g_Assert.throws(() => Manager.LogInfo("invalid %f", Infinity), /finite number/);
	g_Assert.throws(() => Manager.LogInfo(42), /message must be a string/);
	g_Assert.throws(() => {
		Manager.LogRecordFormat = 42;
	}, /record format must be a string or null/);
	g_Assert.throws(() => {
		Manager.LogDateFormat = {};
	}, /date format must be a string or null/);
	g_Assert.throws(() => {
		Manager.FilePath = 42;
	}, /file path must be a string or null/);
	Manager.FilePath = "D:\\server\\sourcejs.log";
	g_Assert.equal(Manager.FilePath, "D:\\server\\sourcejs.log");
	Manager.FilePath = null;
	Manager.LogAreas = g_Loggers.LogArea.SCRIPT;
	g_Assert.equal(Manager.LogInfo("file disabled"), true);
	Manager.UnloadLogManager();

	g_Assert.throws(() => new g_Loggers.LogManager("bad", 20), /options must be an object/);
	g_Assert.throws(() => new g_Loggers.LogManager(20), /requires a string name/);
	g_Assert.throws(() => new g_Loggers.LogManager("bad", { LogRecordFormat: 20 }), /record format must be a string or null/);
	g_Assert.throws(() => new g_Loggers.LogManager("bad", { LogDateFormat: 20 }), /date format must be a string or null/);
	g_Assert.throws(() => new g_Loggers.LogManager("bad", { FilePath: 20 }), /file path must be a string or null/);
}

function CheckTopLevelFunctions() {
	ClearRecordedOutput();

	const PreviousAreasSource = g_Loggers.ROOT_LOGGER.ValueLogAreasSource;
	const PreviousLevelSource = g_Loggers.ROOT_LOGGER.ValueLogLevelSource;

	try {
		g_Loggers.ROOT_LOGGER.LogLevel = g_Loggers.LogLevel.CRITICAL;
		g_Loggers.ROOT_LOGGER.LogAreas = g_Loggers.LogArea.CONSOLE;
		g_Assert.equal(g_Loggers.LogInfo("direct info"), false);
		g_Assert.equal(g_Loggers.LogWarning("direct warning"), false);
		g_Assert.equal(g_Loggers.LogError("direct error"), false);
		g_Assert.equal(g_Loggers.LogInfo("formatted %s", "info"), false);
		g_Assert.equal(g_Loggers.LogDebug("debug"), false);
		g_Assert.equal(g_Loggers.LogMessage("message"), true);
		g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "info", Message: "message" });
		g_Assert.equal(g_Loggers.LogCritical("critical"), true);
		g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "error", Message: "critical" });
		g_Assert.equal(g_Loggers.LogAtLevel(g_Loggers.LogLevel.CRITICAL, "explicit"), true);
		g_Loggers.ROOT_LOGGER.LogLevel = g_Loggers.LogLevel.ERROR;

		const ThrownError = new Error("broken profile");
		g_Assert.equal(g_Loggers.LogException("Profile failed.", ThrownError), true);
		g_Assert.equal(g_vecRuntimeMessages.at(-1).Message.includes("broken profile"), true);
	} finally {
		g_Loggers.ROOT_LOGGER.ValueLogLevelSource = PreviousLevelSource;
		g_Loggers.ROOT_LOGGER.ValueLogAreasSource = PreviousAreasSource;
	}

	g_Assert.strictEqual(g_Loggers.ROOT_LOGGER.ValueLogLevelSource, PreviousLevelSource);
	g_Assert.strictEqual(g_Loggers.ROOT_LOGGER.ValueLogAreasSource, PreviousAreasSource);
}

function ExtractDocumentationExports(strDocumentationSource) {
	const nExportsStart = strDocumentationSource.indexOf("## Exports");
	g_Assert.ok(nExportsStart >= 0, "Missing loggers documentation exports heading");
	const nExportsEnd = strDocumentationSource.indexOf("## Levels and areas", nExportsStart);
	g_Assert.ok(nExportsEnd > nExportsStart, "Missing loggers documentation levels heading");
	const strExportsSection = strDocumentationSource.slice(nExportsStart, nExportsEnd);

	return [...strExportsSection.matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)].map(([, strName]) => strName).sort();
}

function CheckDocumentation() {
	const strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const strDocumentationFence = String.fromCharCode(96).repeat(3);
	const DocumentationPattern = new RegExp(`${strDocumentationFence}js\\r?\\n([\\s\\S]*?)${strDocumentationFence}`, "g");
	const vecDocumentationJavaScriptBlocks = Array.from(strDocumentationSource.matchAll(DocumentationPattern), (vecMatch) => vecMatch[1].replaceAll("\r\n", "\n"));
	const setDocumentationSignatures = new Set([
		"LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments)\nLogDebug(strMessage, ...vecFormatArguments)\nLogInfo(strMessage, ...vecFormatArguments)\nLogWarning(strMessage, ...vecFormatArguments)\nLogError(strMessage, ...vecFormatArguments)\nLogException(strMessage, ErrorValue = null, ...vecFormatArguments)\nLogCritical(strMessage, ...vecFormatArguments)\nLogMessage(strMessage, ...vecFormatArguments)",
		"new LogInstance(ParentLogger, strLoggerName = \"\", LoggerOptions = {})",
		"new LogManager(strLoggerName = \"sourcejs\", LoggerOptions = {})",
	]);
	const vecDocumentationExamples = vecDocumentationJavaScriptBlocks.filter((strDocumentationBlock) => !setDocumentationSignatures.has(strDocumentationBlock.trim()));
	const vecDocumentationConsoleMessages = [];
	const DeveloperConVar = {
		Value: g_Loggers.LogLevel.DEBUG,
		GetInteger() {
			return g_Loggers.LogLevel.DEBUG;
		},
	};
	const vecCurrentPlayers = [
		{
			Dead: false,
			FakeClient: false,
			Health: 87,
			Index: 1,
			Name: "Ren",
			NetworkID: "STEAM_1:1:42",
			Weapon: "weapon_sdk_test",
		},
	];
	const mapDocumentationModules = new Map([
		["cvars", {
			RequireConVar(strName) {
				g_Assert.equal(strName, "developer");

				return DeveloperConVar;
			},
		}],
		["filesystem", {
			DoesFileExist(strFilePath) {
				return g_mapFileWrites.has(strFilePath);
			},

			RemoveFile(strFilePath) {
				return g_mapFileWrites.delete(strFilePath);
			},
		}],
		["filters/entities", {
			GetAllEntities() {
				return [{ Index: 0 }, { Index: 1 }, { Index: 2 }];
			},
		}],
		["filters/players", {
			GetAllPlayers() {
				return vecCurrentPlayers.map((Player) => ({
					Dead: Player.Dead,
					FakeClient: Player.FakeClient,
					Health: Player.Health,
					Index: Player.Index,
					Name: Player.Name,
					NetworkID: Player.NetworkID,
					WeaponName: Player.Weapon,
				}));
			},
		}],
		["globals", {
			GetGlobalVariables() {
				return {
					AbsoluteFrameTime: 0.02,
					IntervalPerTick: 0.015,
					MapName: "sdk_test_map",
					TickCount: 4200,
				};
			},
		}],
		["interfaces", {
			GetInterfaceRecord(strInterfaceName) {
				return (strInterfaceName === "VEngineServer999") ? { Name: strInterfaceName, Address: 0x220000n, Available: true } : null;
			},

			GetAllInterfaceNames() {
				return ["VEngineServer999"];
			},
		}],
		["players", {
			GetActiveWeapon(PlayerReference) {
				g_Assert.equal(PlayerReference.Index, vecCurrentPlayers[0].Index);

				return { Index: 2, ClassName: vecCurrentPlayers[0].Weapon };
			},
		}],
		["weapons", {
			GetWeaponName(WeaponReference) {
				g_Assert.equal(WeaponReference.Index, 2);

				return WeaponReference.ClassName;
			},
		}],
		["loggers", g_Loggers],
	]);
	const DocumentationConsole = {
		log(Value) {
			vecDocumentationConsoleMessages.push(Value);
		},
	};

	function RequireDocumentationModule(strModuleName) {
		if (!mapDocumentationModules.has(strModuleName)) {
			throw new Error(`Unknown loggers documentation module: ${strModuleName}`);
		}

		return mapDocumentationModules.get(strModuleName);
	}

	g_Assert.equal(vecDocumentationJavaScriptBlocks.length, 10);
	g_Assert.equal(vecDocumentationExamples.length, 9);
	g_Assert.equal(strDocumentationSource.includes("```text"), false);

	for (const strDocumentationJavaScriptBlock of vecDocumentationJavaScriptBlocks) {
		new Function('"use strict";\n' + strDocumentationJavaScriptBlock);
	}

	ClearRecordedOutput();

	for (const strDocumentationExample of vecDocumentationExamples) {
		const ExecuteDocumentationExample = new Function("require", "console", '"use strict";\n' + strDocumentationExample);
		const Context = g_VM.createContext({ ExecuteDocumentationExample, RequireDocumentationModule, DocumentationConsole });
		// Keep the host function's realm while bounding execution of the copyable example.
		new g_VM.Script("ExecuteDocumentationExample(RequireDocumentationModule, DocumentationConsole);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
	}

	g_Assert.equal(g_vecRuntimeMessages.length > 0, true);
	g_Assert.equal(g_vecFileOpenCalls.length > 0, true);
	g_Assert.equal(g_mapFileWrites.size, 0, "documentation must remove every example log file");
	g_Assert.deepEqual(vecDocumentationConsoleMessages, []);
	g_Assert.deepEqual(ExtractDocumentationExports(strDocumentationSource), Object.keys(g_Loggers).sort());
	g_Assert.equal(strDocumentationSource.includes("Generated by"), false);
	g_Assert.equal(strDocumentationSource.includes("generate_api_docs"), false);

	const strDocumentationTickCharacter = String.fromCharCode(96);
	const vecRequiredDocumentedMembers = [
		"ParentLogger",
		"LocalLoggerName",
		"ChildLoggers",
		"Prefix",
		"LoggerName",
		"RootLogManager",
		"LogAreas",
		"LogLevel",
		"FilePath",
		"LogRecordFormat",
		"LogDateFormat",
		"ValueLogLevelSource",
		"ValueLogAreasSource",
		"ClearChildLoggers",
		"DeleteChildLogger",
		"GetOrCreateChildLogger",
		"LogAtLevel",
		"LogCritical",
		"LogDebug",
		"LogError",
		"LogException",
		"LogInfo",
		"LogMessage",
		"LogWarning",
		"UnloadLogManager",
	];
	for (const strRequiredDocumentedMember of vecRequiredDocumentedMembers) {
		g_Assert.equal(strRequiredDocumentedMember in g_Loggers.ROOT_LOGGER, true, `Documented logger member must exist: ${strRequiredDocumentedMember}`);
		g_Assert.equal(strDocumentationSource.includes(`${strDocumentationTickCharacter}${strRequiredDocumentedMember}${strDocumentationTickCharacter}`) || strDocumentationSource.includes(`${strDocumentationTickCharacter}${strRequiredDocumentedMember}(`), true, `Missing loggers documentation member: ${strRequiredDocumentedMember}`);
	}

	const vecRelativeDocumentationLinks = Array.from(strDocumentationSource.matchAll(/\]\(([^)]+)\)/g), (vecMatch) => vecMatch[1]).filter((strLink) => !strLink.startsWith("#"));
	for (const strRelativeDocumentationLink of vecRelativeDocumentationLinks) {
		const strRelativePath = strRelativeDocumentationLink.split("#", 1)[0];
		g_Assert.equal(g_FileSystem.existsSync(g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strRelativePath)), true, strRelativeDocumentationLink);
	}
}

function VerifyWorldValueSummaries() {
	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8").replace(/\r\n/g, "\n");
	const vecFunctionSources = ["ConvertBigIntToString", "SummarizeValue", "IsInt32", "ParseIndex", "LogResult"].map((strFunctionName) => {
		const nFunctionStart = strExample.indexOf(`\nfunction ${strFunctionName}(`);
		const nFunctionEnd = strExample.indexOf("\nfunction ", nFunctionStart + 1);
		g_Assert.ok((nFunctionStart >= 0) && (nFunctionEnd > nFunctionStart), `world function ${strFunctionName} must remain available`);

		return strExample.slice(nFunctionStart, nFunctionEnd);
	});
	const Summarize = new Function(`${vecFunctionSources.join("\n")}\nreturn SummarizeValue;`)();
	g_Assert.equal(Summarize(undefined), "undefined");
	g_Assert.equal(Summarize(null), "null");
	g_Assert.equal(Summarize(42n), "42");
	g_Assert.equal(Summarize({ Address: 0x1234n }), '{"Address":"4660n"}');
	g_Assert.equal(Summarize(0xFEDCBA9876543210n), "18364758544493064720");
	g_Assert.equal(Summarize(-0x8000000000000000n), "-9223372036854775808");
	g_Assert.equal(Summarize({ Address: 0xFEDCBA9876543210n }), '{"Address":"18364758544493064720n"}');
	g_Assert.equal(Summarize({ Minimum: -0x8000000000000000n, Maximum: 0xFFFFFFFFFFFFFFFFn }), '{"Minimum":"-9223372036854775808n","Maximum":"18446744073709551615n"}');

	const Circular = {};
	Circular.Self = Circular;
	g_Assert.equal(Summarize(Circular), "[unserializable value]");

	const NullThrowingValue = {
		toJSON() {
			throw null;
		},
	};
	g_Assert.equal(Summarize(NullThrowingValue), "[unserializable value]");

	const ThrowingConstructorValue = {
		get constructor() {
			throw new Error("constructor failed");
		},
	};
	g_Assert.equal(Summarize(ThrowingConstructorValue), "[unserializable value]");

	let unErrorStringConversions = 0;
	const UnprintableError = {
		toString() {
			unErrorStringConversions += 1;
			throw new Error("text conversion failed");
		},
	};
	const ThrowingValue = {
		toJSON() {
			throw UnprintableError;
		},
	};
	g_Assert.equal(Summarize(ThrowingValue), "[unserializable value]");
	g_Assert.equal(unErrorStringConversions, 0, "An opaque serialization failure must not be coerced");

	const Secret = {
		toJSON() {
			throw new Error("PRIVATE_TOKEN=example");
		},
	};
	g_Assert.equal(Summarize(Secret), "[unserializable value]");

	const CheckLiteralResult = (strLogSource) => {
		const strLabel = "World 100%% %j";
		const Value = { Message: "Result 100%% %s", Address: 0xFEDCBA9876543210n };
		const strExpected = `${strLabel}: {"Message":"Result 100%% %s","Address":"18364758544493064720n"}`;
		const strHelpers = vecFunctionSources.slice(0, -1).join("\n");
		const LogResult = new Function("LogInfo", `${strHelpers}\n${strLogSource}\nreturn LogResult;`)(g_Loggers.LogInfo);
		let unCallbackCount = 0;
		ClearRecordedOutput();
		try {
			const Result = LogResult(strLabel, () => {
				unCallbackCount += 1;

				return Value;
			});
			g_Assert.equal(Result, Value);
			g_Assert.equal(unCallbackCount, 1);
			g_Assert.deepEqual(g_vecRuntimeMessages, [{ Level: "info", Message: strExpected }], "World result logging must preserve literal percent sequences and BigInt data");
			const OpaqueFailure = { Cause: "do not coerce or log" };
			g_Assert.throws(() => LogResult(strLabel, () => {
				throw OpaqueFailure;
			}), Failure => Failure === OpaqueFailure);
			g_Assert.equal(g_vecRuntimeMessages.length, 1, "A failed callback must not log a result");
			g_Assert.equal(g_vecFileOpenCalls.length, 0);
		} finally {
			ClearRecordedOutput();
		}
	};
	const strLogSource = vecFunctionSources.at(-1);
	CheckLiteralResult(strLogSource);

	const strLiteralCall = 'LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);';
	g_Assert.equal(strLogSource.split(strLiteralCall).length, 2);
	const strRestoredSource = strLogSource.replace(strLiteralCall, () => strLiteralCall.replace('("%s", ', "("));
	g_Assert.throws(() => CheckLiteralResult(strRestoredSource), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("World result logging must preserve literal percent sequences"), "Restored formatter call must fail for changed data, not unrelated fixture errors");
	console.log("[world result logging] actual JavaScript formatter, exact 64-bit BigInt data, callback result/error identity and one restored-source control passed; controlled native sinks, no native IO.");

	const strIntegerSource = vecFunctionSources.find(strSource => strSource.includes("function IsInt32("));
	const strIndexSource = vecFunctionSources.find(strSource => strSource.includes("function ParseIndex("));
	const CheckLiteralUsage = (strParserSource) => {
		const strUsage = "world 100%% %j";
		const ParseIndex = new Function("LogWarning", `${strIntegerSource}\n${strParserSource}\nreturn ParseIndex;`)(g_Loggers.LogWarning);
		const vecInvalidValues = [undefined, null, {}, true, "", " \t", "not-a-number", "1.5", "2147483648", "-2147483649", "-1", "0"];
		const vecValidValues = [["1", 1], ["2.0", 2], ["0x20", 0x20], ["2147483647", 0x7FFFFFFF]];
		ClearRecordedOutput();
		try {
			for (const Value of vecInvalidValues) {
				g_Assert.equal(ParseIndex(Value, 1, strUsage), null);
				g_Assert.deepEqual(g_vecRuntimeMessages.at(-1), { Level: "warning", Message: `Use "${strUsage}".` }, "World usage logging must preserve literal percent sequences");
			}

			g_Assert.equal(g_vecRuntimeMessages.length, vecInvalidValues.length);
			for (const [strValue, nExpected] of vecValidValues) {
				g_Assert.equal(ParseIndex(strValue, 1, strUsage), nExpected);
			}

			g_Assert.equal(ParseIndex("-0", 0, strUsage), -0);
			g_Assert.equal(g_vecRuntimeMessages.length, vecInvalidValues.length, "Valid indices must not warn");
			g_Assert.equal(g_vecFileOpenCalls.length, 0);
		} finally {
			ClearRecordedOutput();
		}
	};
	CheckLiteralUsage(strIndexSource);

	const strLiteralWarning = 'LogWarning("%s", `Use "${strUsage}".`);';
	const vecLiteralWarnings = [...strIndexSource.matchAll(/LogWarning\("%s", `Use "\$\{strUsage\}"\.`\);/g)];
	g_Assert.equal(vecLiteralWarnings.length, 2);
	for (const Match of vecLiteralWarnings) {
		const strRestoredParser = strIndexSource.slice(0, Match.index) + strLiteralWarning.replace('("%s", ', "(") + strIndexSource.slice(Match.index + strLiteralWarning.length);
		g_Assert.throws(() => CheckLiteralUsage(strRestoredParser), Failure => (Failure instanceof g_Assert.AssertionError) && Failure.message.includes("World usage logging must preserve literal percent sequences"), "Each restored warning must fail for changed data, not unrelated parser errors");
	}

	console.log("[world usage logging] 12 invalid inputs, 5 valid controls and 2 restored-source controls passed through actual JavaScript formatter; no native IO.");
}

CheckPrivateLoggerStorage();
VerifyWorldValueSummaries();

CheckFilePrimitiveFailures();
CheckRepeatedChildOwnership();
CheckLiteralRecordFields();
CheckDocumentationResourceFailures();
CheckDocumentationRootRestoration();
CheckExports();
CheckHierarchy();
CheckRoutingAndLiveSources();
CheckFormattingAndFiles();
CheckTopLevelFunctions();
CheckDocumentation();

g_Assert.throws(() => LoadLoggers(), (ErrorValue) => (ErrorValue.constructor === Error) && (ErrorValue.code !== "MODULE_NOT_FOUND") && (ErrorValue.message === "SourceJS native runtime is not installed."));

console.log("[  OK  ] loggers smoke passed");
