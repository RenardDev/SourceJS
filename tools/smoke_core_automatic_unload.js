"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strCorePath = g_Path.join(__dirname, "../packages/sourcejs/core.js");
const g_mapNativeModules = new Map([
	["core", {}],
	["cpr", {}],
	["interfaces", {}],
	["listeners", {}],
]);

function RejectNativeOperation() {
	throw new Error("Automatic unload registry checks must not perform native IO.");
}

function RequireDependency(strModuleName) {
	switch (strModuleName) {
		case "filesystem":
			return { DoesFileExist: RejectNativeOperation, ReadTextFile: RejectNativeOperation };

		case "internal/runtime":
			return {
				GetModule(strNativeModuleName) {
					g_Assert.ok(g_mapNativeModules.has(strNativeModuleName), `Unexpected native module ${strNativeModuleName}`);

					return g_mapNativeModules.get(strNativeModuleName);
				},
			};

		case "loggers":
			// Keep the removed logger name only as an explicit failure trap.
			return { Info: RejectNativeOperation };

		case "paths":
			return { CONFIG_ROOT: "cfg/sourcejs" };

		default:
			throw new Error(`Unexpected dependency ${strModuleName}`);
	}
}

function TestCoreRuntimeExample(AutomaticUnloadType) {
	const unExampleExecutionTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(__dirname, "../examples/plugins/disabled/api-core-runtime/index.js");
	const strExampleSource = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const strLoggerPath = g_Path.join(__dirname, "../packages/sourcejs/loggers.js");
	const LoggerScript = new g_VM.Script(g_FileSystem.readFileSync(strLoggerPath, "utf8"), { filename: strLoggerPath });
	const strCoreCommand = "sjs_api_core";
	const strPluginCommand = "sjs_api_core_plugins";
	let unScenarioCount = 0;

	function CreateHarness(strSource = strExampleSource, mapStartupActions = new Map(), strGameRoot = "game") {
		const State = {
			Actions: mapStartupActions,
			Calls: [],
			Commands: new Map(),
			Files: new Map([["data/api-core-runtime-truncate.txt", "user content"]]),
			Messages: [],
			Module: { exports: {} },
			DemoFile: null,
			DemoListeners: null,
			PluginListener: null,
			LiveUnloadCount: 0,
		};

		function Invoke(strName, Use = () => true) {
			State.Calls.push(strName);
			const vecActions = State.Actions.get(strName);
			if (vecActions?.length) {
				return vecActions.shift()();
			}

			return Use();
		}

		class RuntimeAutomaticUnload extends AutomaticUnloadType {
		}

		Object.defineProperty(RuntimeAutomaticUnload, "Instances", { value: new Map() });

		class LiveInstance extends RuntimeAutomaticUnload {
			UnloadInstance() {
				State.LiveUnloadCount += 1;
			}
		}

		new LiveInstance("api-core-runtime");

		class Command {
			constructor(vecArguments) {
				this.Arguments = vecArguments;
			}
		}

		class Tokenizer extends Array {
			GetTokenHash() {
				return 1;
			}
		}

		class LogManager {
			GetOrCreateChildLogger() {
				return { LogDebug: () => Invoke("LogDebug"), LogAreas: 1, LogLevel: 1, LoggerName: "child", Prefix: "demo" };
			}

			UnloadLogManager() {
				return Invoke("UnloadLogManager");
			}
		}

		class ListenerManager {
			constructor() {
				this.Callback = null;
				State.DemoListeners = this;
			}

			RegisterListener(Callback) {
				this.Callback = Callback;
			}

			NotifyListeners(Payload) {
				return Invoke("NotifyListeners", () => this.Callback(Payload));
			}

			EmitListenerEvent() {
				return 0;
			}

			UnregisterListener(Callback) {
				g_Assert.equal(Callback, this.Callback);
				const bReleased = Invoke("UnregisterDemoListener");
				if (bReleased) {
					this.Callback = null;
				}

				return bReleased;
			}

			get Empty() {
				return this.Callback === null;
			}
		}

		class SourceFile {
			constructor(strPath) {
				this.FilePath = strPath;
				this.Closed = false;
				this.FileSize = 6;
			}

			static OpenSourceFile(strPath) {
				return Invoke("OpenSourceFile", () => {
					State.DemoFile = new SourceFile(strPath);

					return State.DemoFile;
				});
			}

			static UseSourceFile(strPath, Callback) {
				return Invoke("UseSourceFile", () => Callback(new SourceFile(strPath)));
			}

			TruncateSourceFile(unSize) {
				return Invoke("TruncateSourceFile", () => {
					State.Files.set(this.FilePath, State.Files.get(this.FilePath).slice(0, unSize));

					return unSize;
				});
			}

			CloseSourceFile() {
				g_Assert.equal(this.Closed, false, "Never close a consumed or already closed handle");
				const bClosed = Invoke("CloseSourceFile");
				if (bClosed) {
					this.Closed = true;
				}

				return bClosed;
			}

			SeekSourceFile() {
				return Invoke("SeekSourceFile");
			}

			ReadSourceFile() {
				return Invoke("ReadSourceFile", () => [0x61, 0x62, 0x63]);
			}

			ReadSourceFileLine() {
				return "gameinfo";
			}

			IsSourceFileReadable() {
				return true;
			}

			IsSourceFileSeekable() {
				return true;
			}

			GetSourceFileOffset() {
				return 0;
			}
		}

		class ASCIITable {
			AddTableRow() {
			}

			FormatTable() {
				return "table";
			}
		}

		class Column {
		}

		class PluginInfo {
			constructor() {
				this.Entry = "index.js";
				this.Name = "api-core-runtime";
			}
		}

		class Plugin {
		}

		class PluginManager {
			GetPluginInfo() {
				return Invoke("GetPluginInfo", () => new PluginInfo());
			}

			GetPluginInstance() {
				return new Plugin();
			}

			IsPluginLoaded() {
				return true;
			}
		}

		class SubCommandManager extends Array {
			constructor() {
				super();
			}
		}

		class SphinxProject {
			DoesPackageExist() {
				return true;
			}

			DoesProjectExist() {
				return false;
			}
		}

		const LoggerModule = { exports: {} };
		const LoggerDependencies = {
			filesystem: { EnsureDirectoryExists: RejectNativeOperation, SourceFile: { OpenSourceFile: RejectNativeOperation } },
			"internal/runtime": {
				GetModule(strName) {
					g_Assert.equal(strName, "loggers");

					return {
						LogInfo(strMessage) {
							State.Messages.push(strMessage);

							return Invoke("LogInfo");
						},
						LogWarning: strMessage => State.Messages.push(strMessage),
						LogError: RejectNativeOperation,
					};
				},
			},
			paths: { LOG_ROOT: "logs" },
		};
		const RequireLoggerDependency = strName => {
			g_Assert(Object.hasOwn(LoggerDependencies, strName), "Unexpected logger dependency: " + strName);

			return LoggerDependencies[strName];
		};

		LoggerScript.runInNewContext({ module: LoggerModule, require: RequireLoggerDependency }, { timeout: unExampleExecutionTimeoutMilliseconds });

		const OutputReturn = { CONTINUE: 0 };
		const mapDependencies = new Map([
			["core", {
				AutomaticUnload: RuntimeAutomaticUnload,
				CaptureServerOutput(unOutputAction, CaptureCallback) {
					g_Assert.equal(unOutputAction, OutputReturn.CONTINUE);

					return CaptureCallback([]);
				},
				CreateChecksum: () => 1,
				GetGlobalInfo: () => Invoke("GetGlobalInfo", () => ({})),
				MessageSeverity: { MESSAGE: 0 },
				OutputReturn,
				Tokenizer,
			}],
			["commands", { Command, CommandReturn: { Handled: 1 } }],
			["autodoc", { GetModuleNames: () => [], SphinxProject }],
			["core/table", { ASCIITable, Alignment: { Left: 0 }, Column }],
			["core/version", { VERSION: "test" }],
			["extensions", { GetLoadedExtensions: () => [] }],
			["filesystem", {
				DoesFileExist: strPath => State.Files.has(strPath),
				GetTemporaryFilePath: () => "temporary/core-runtime.tmp",
				IsVPKFile: () => false,
				RemoveFile(strPath) {
					return Invoke("RemoveFile", () => State.Files.delete(strPath));
				},
				SourceFile,
				WriteTextFile(strPath, strText) {
					State.Files.set(strPath, strText);

					return Invoke("WriteTextFile");
				},
			}],
			["globals", { GetRuntimeInfo: () => ({}) }],
			["interfaces", { GetAllInterfaceNames: () => [], GetInterfaceRecord: RejectNativeOperation }],
			["listeners", {
				ButtonStatus: { PRESSED: 1 },
				GetButtonCombinationStatus: () => 1,
				ListenerManager,
				RegisterPluginUnloadingListener(Callback) {
					return Invoke("RegisterPluginUnloadingListener", () => {
						State.PluginListener = {
							Callback,
							Disposed: false,
							DisposeListener() {
								const bDisposed = Invoke("DisposeListener");
								if (bDisposed) {
									this.Disposed = true;
								}

								return bDisposed;
							},
						};

						return State.PluginListener;
					});
				},
				ServerOutputManager: { EmitListenerEvent: () => true },
			}],
			["loggers", {
				LogArea: { CONSOLE: 1 },
				LogInfo: LoggerModule.exports.LogInfo,
				LogLevel: { DEBUG: 1 },
				LogManager,
				LogWarning: LoggerModule.exports.LogWarning,
			}],
			["paths", { DATA_ROOT: "data", GAME_ROOT: strGameRoot, PACKAGE_ROOT: "packages" }],
			["plugins", { GetPluginList: () => [], GetPluginRecords: () => [] }],
			["plugins/command", { SubCommandManager }],
			["plugins/info", { PluginInfo }],
			["plugins/instance", { Plugin }],
			["plugins/manager", { PLUGIN_MANAGER: new PluginManager(), PluginManager }],
			["public", { PUBLIC_NAME: "Name", GetExportedNames: () => [], IsPublicValue: () => true, MarkPublic: () => true }],
			["source", {
				RegisterCommand(strName, Callback) {
					const bRegistered = Invoke("RegisterCommand:" + strName);
					if (bRegistered) {
						State.Commands.set(strName, Callback);
					}

					return bRegistered;
				},
				UnregisterCommand(strName, Callback) {
					g_Assert.equal(State.Commands.get(strName), Callback, "Release only acquired registrations");

					return Invoke("UnregisterCommand:" + strName, () => State.Commands.delete(strName));
				},
			}],
		]);
		const Require = strName => {
			g_Assert.ok(mapDependencies.has(strName), `Unexpected example dependency ${strName}`);

			return mapDependencies.get(strName);
		};
		State.Load = () => g_VM.runInNewContext(strSource, { exports: State.Module.exports, require: Require, AggregateError }, { filename: strExamplePath });
		State.Core = () => State.Commands.get(strCoreCommand)([strCoreCommand]);
		State.Unload = () => State.Module.exports.Unload();

		return State;
	}

	const Normal = CreateHarness();
	Normal.Load();
	Normal.Core();
	Normal.Commands.get(strPluginCommand)([strPluginCommand]);
	g_Assert.equal(Normal.LiveUnloadCount, 0, "Demo unloading must not unload live plugin instances");
	g_Assert.equal(Normal.Files.get("data/api-core-runtime-truncate.txt"), "user content");
	g_Assert.equal(Normal.Files.has("temporary/core-runtime.tmp"), false);
	g_Assert.equal(Normal.DemoFile.Closed, true);
	g_Assert.equal(Normal.DemoListeners.Empty, true);
	g_Assert.ok(Normal.Messages.some(strMessage => strMessage.includes("Calls: 1")));
	Normal.Unload();
	Normal.Unload();
	g_Assert.equal(Normal.Commands.size, 0);
	g_Assert.equal(Normal.PluginListener.Disposed, true);
	unScenarioCount += 1;

	for (const strCommand of [strCoreCommand, strPluginCommand]) {
		const Harness = CreateHarness();
		Harness.Load();
		const unCallCount = Harness.Calls.length;
		g_Assert.equal(Harness.Commands.get(strCommand)([strCommand, "unexpected"]), 1);
		g_Assert.equal(Harness.Calls.length, unCallCount, "Reject extra arguments before demo effects");
		Harness.Unload();
		unScenarioCount += 1;
	}

	const Collision = CreateHarness();
	Collision.Files.set("temporary/core-runtime.tmp", "existing content");
	Collision.Load();
	g_Assert.throws(Collision.Core, /Refusing to overwrite/);
	g_Assert.equal(Collision.Files.get("temporary/core-runtime.tmp"), "existing content");
	g_Assert.equal(Collision.Calls.includes("WriteTextFile"), false);
	g_Assert.equal(Collision.Calls.includes("RemoveFile"), false);
	Collision.Unload();
	unScenarioCount += 1;

	for (const strOperation of ["LogDebug", "NotifyListeners", "WriteTextFile", "OpenSourceFile", "TruncateSourceFile", "SeekSourceFile", "ReadSourceFile"]) {
		const Harness = CreateHarness();
		Harness.Load();
		const OperationError = new Error(strOperation);
		Harness.Actions.set(strOperation, [() => {
			throw OperationError;
		}]);
		g_Assert.throws(Harness.Core, ErrorValue => ErrorValue === OperationError);
		g_Assert.equal(Harness.Files.has("temporary/core-runtime.tmp"), false);
		g_Assert.equal(Harness.DemoFile?.Closed ?? true, true);
		g_Assert.equal(Harness.DemoListeners?.Empty ?? true, true);
		Harness.Unload();
		unScenarioCount += 1;
	}

	for (const strOperation of ["UnloadLogManager", "UnregisterDemoListener", "CloseSourceFile", "RemoveFile"]) {
		for (const bThrow of [false, true]) {
			const Harness = CreateHarness();
			Harness.Load();
			Harness.Actions.set(strOperation, [() => {
				if (bThrow) {
					throw new Error(strOperation);
				}

				return false;
			}]);
			g_Assert.throws(Harness.Core);
			Harness.Unload();
			g_Assert.equal(Harness.Files.has("temporary/core-runtime.tmp"), false);
			g_Assert.equal(Harness.DemoFile?.Closed ?? true, true);
			g_Assert.equal(Harness.DemoListeners?.Empty ?? true, true);
			g_Assert.equal(Harness.Calls.filter(strName => strName === strOperation).length, 2, "Retry the failed resource");
			unScenarioCount += 1;
		}
	}

	for (const PrimaryError of [new Error("primary"), null, undefined, false, 0, "failure"]) {
		const Harness = CreateHarness();
		Harness.Load();
		const CleanupError = new Error("secondary");
		Harness.Actions.set("LogDebug", [() => {
			throw PrimaryError;
		}]);
		Harness.Actions.set("UnloadLogManager", [() => {
			throw CleanupError;
		}]);
		g_Assert.throws(Harness.Core, ErrorValue => (ErrorValue instanceof AggregateError) && (ErrorValue.errors[0] === PrimaryError) && (ErrorValue.errors[1] === CleanupError));
		Harness.Unload();
		unScenarioCount += 1;
	}

	for (const strOperation of ["RegisterCommand:" + strCoreCommand, "RegisterCommand:" + strPluginCommand, "RegisterPluginUnloadingListener", "LogInfo"]) {
		const StartupError = new Error(strOperation);
		const FailStartup = () => {
			throw StartupError;
		};
		const Harness = CreateHarness(strExampleSource, new Map([[strOperation, [FailStartup]]]));
		g_Assert.throws(Harness.Load, ErrorValue => ErrorValue === StartupError);
		g_Assert.equal(Harness.Commands.size, 0);
		Harness.Unload();
		unScenarioCount += 1;
	}

	for (const strOperation of ["UnregisterCommand:" + strCoreCommand, "UnregisterCommand:" + strPluginCommand, "DisposeListener"]) {
		for (const bThrow of [false, true]) {
			const Harness = CreateHarness();
			Harness.Load();
			Harness.Actions.set(strOperation, [() => {
				if (bThrow) {
					throw new Error(strOperation);
				}

				return false;
			}]);
			g_Assert.throws(Harness.Unload);
			g_Assert.equal(Harness.Commands.size, strOperation.startsWith("UnregisterCommand:") ? 1 : 0);
			Harness.Unload();
			g_Assert.equal(Harness.Commands.size, 0);
			g_Assert.equal(Harness.PluginListener.Disposed, true);
			unScenarioCount += 1;
		}
	}

	const Reentrant = CreateHarness();
	Reentrant.Load();
	Reentrant.Actions.set("DisposeListener", [() => {
		Reentrant.Unload();
		Reentrant.PluginListener.Disposed = true;

		return true;
	}]);
	Reentrant.Unload();
	g_Assert.equal(Reentrant.Commands.size, 0);
	g_Assert.equal(Reentrant.Calls.filter(strName => strName === "DisposeListener").length, 1);
	unScenarioCount += 1;

	const PartialWrite = CreateHarness();
	PartialWrite.Load();
	PartialWrite.Actions.set("WriteTextFile", [() => false]);
	g_Assert.throws(PartialWrite.Core, /Could not write/);
	g_Assert.equal(PartialWrite.Files.has("temporary/core-runtime.tmp"), false, "Remove a failed write's partial output");
	PartialWrite.Unload();
	unScenarioCount += 1;

	const ConsumedHandle = CreateHarness();
	ConsumedHandle.Load();
	const TruncationError = new Error("consumed handle");
	ConsumedHandle.Actions.set("TruncateSourceFile", [() => {
		ConsumedHandle.DemoFile.Closed = true;
		throw TruncationError;
	}]);
	g_Assert.throws(ConsumedHandle.Core, ErrorValue => ErrorValue === TruncationError);
	g_Assert.equal(ConsumedHandle.Calls.includes("CloseSourceFile"), false);
	g_Assert.equal(ConsumedHandle.Files.has("temporary/core-runtime.tmp"), false);
	ConsumedHandle.Unload();
	unScenarioCount += 1;

	for (const strCommand of [strCoreCommand, strPluginCommand]) {
		const Harness = CreateHarness(strExampleSource, new Map([["RegisterCommand:" + strCommand, [() => false]]]));
		g_Assert.throws(Harness.Load, /Could not register/);
		g_Assert.equal(Harness.Commands.size, 0);
		Harness.Unload();
		unScenarioCount += 1;
	}

	for (const StartupError of [new Error("startup"), null, undefined, false, 0, "failure"]) {
		const CleanupError = new Error("startup cleanup");
		const FailStartup = () => {
			throw StartupError;
		};
		const FailCleanup = () => {
			throw CleanupError;
		};
		const Harness = CreateHarness(strExampleSource, new Map([["LogInfo", [FailStartup]], ["DisposeListener", [FailCleanup]]]));
		g_Assert.throws(Harness.Load, ErrorValue => (ErrorValue instanceof AggregateError) && (ErrorValue.errors[0] === StartupError) && (ErrorValue.errors[1] === CleanupError));
		g_Assert.equal(Harness.Commands.size, 0);
		Harness.Unload();
		g_Assert.equal(Harness.PluginListener.Disposed, true);
		unScenarioCount += 1;
	}

	const AlreadyDisposed = CreateHarness();
	AlreadyDisposed.Load();
	AlreadyDisposed.PluginListener.DisposeListener();
	AlreadyDisposed.Unload();
	g_Assert.equal(AlreadyDisposed.Calls.filter(strName => strName === "DisposeListener").length, 1);
	g_Assert.equal(AlreadyDisposed.Commands.size, 0);
	unScenarioCount += 1;

	function CheckLiteralCoreOutput(strSource) {
		const strPercentData = "100%% %s %d %j $&";
		const Harness = CreateHarness(strSource, new Map([["GetGlobalInfo", [() => ({ Value: strPercentData })]]]), strPercentData);
		Harness.Load();
		try {
			Harness.Core();
			g_Assert(Harness.Messages.includes("SourceJS runtime on " + strPercentData), "Preserve literal runtime root through actual logger formatter");
			g_Assert(Harness.Messages.includes("core.GetGlobalInfo: { Value: " + strPercentData + " }"), "Preserve literal summary data through actual logger formatter");
		} finally {
			Harness.Unload();
		}

		g_Assert.equal(Harness.Commands.size, 0);
		g_Assert.equal(Harness.Files.has("temporary/core-runtime.tmp"), false);
		g_Assert.equal(Harness.DemoFile.Closed, true);
		g_Assert.equal(Harness.PluginListener.Disposed, true);

		return 2;
	}

	unScenarioCount += CheckLiteralCoreOutput(strExampleSource);

	const vecLiteralLogCalls = [
		'LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);',
		'LogInfo("%s", `SourceJS runtime on ${GAME_ROOT}`);',
	];
	for (const strLiteralCall of vecLiteralLogCalls) {
		g_Assert.equal(strExampleSource.split(strLiteralCall).length, 2, "Unique literal-data core/runtime logger call");
		const strLegacySource = strExampleSource.replace(strLiteralCall, () => strLiteralCall.replace('LogInfo("%s", ', "LogInfo("));
		g_Assert.throws(() => CheckLiteralCoreOutput(strLegacySource), Failure => (Failure instanceof g_Assert.AssertionError) && /Preserve literal runtime root|Preserve literal summary data/.test(Failure.message), "Each restored format-string call must fail for changed data, not an unrelated error");
		unScenarioCount += 1;
	}

	console.log("Core/runtime literal logging: two payload profiles and two restored-source regressions passed through actual JavaScript logger; native and filesystem sinks are controlled doubles.");
	console.log(`[smoke_core_automatic_unload] example scenarios=${unScenarioCount}; actual example and AutomaticUnload class, controlled native dependencies; not game-server IO`);
}

const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strCorePath, "utf8"), { module: g_Module, require: RequireDependency }, { filename: g_strCorePath });

const { AutomaticUnload, WeakAutomaticUnload } = g_Module.exports;
g_Assert.notEqual(AutomaticUnload.Instances, WeakAutomaticUnload.Instances);

for (const AutomaticType of [AutomaticUnload, WeakAutomaticUnload]) {
	const InstancesDescriptor = Object.getOwnPropertyDescriptor(AutomaticType, "Instances");
	g_Assert.equal(InstancesDescriptor.value, AutomaticType.Instances);
	g_Assert.equal(InstancesDescriptor.configurable, true);
	g_Assert.equal(InstancesDescriptor.enumerable, true);
	g_Assert.equal(InstancesDescriptor.writable, true);
	g_Assert.equal(AutomaticType.Instances.size, 0);

	const vecUnloadedNames = [];

	class OwnedInstance extends AutomaticType {
		constructor(strName, Owner) {
			super(Owner);
			this.Name = strName;
			this.UnloadCount = 0;
		}

		UnloadInstance() {
			this.UnloadCount += 1;
			vecUnloadedNames.push(this.Name);
		}
	}

	const First = new OwnedInstance("First", 42);
	const Second = new OwnedInstance("Second", 42);
	g_Assert.equal(First.Owner, "42");
	g_Assert.equal(Second.Owner, "42");
	g_Assert.equal(Object.hasOwn(OwnedInstance, "Instances"), false);
	g_Assert.equal(OwnedInstance.Instances, AutomaticType.Instances);
	g_Assert.equal(OwnedInstance.UnloadOwnerInstances(42), 2);
	g_Assert.equal(First.UnloadCount, 1);
	g_Assert.equal(Second.UnloadCount, 1);
	g_Assert.deepEqual(vecUnloadedNames, (AutomaticType === AutomaticUnload) ? ["Second", "First"] : ["First", "Second"]);
	g_Assert.equal(AutomaticType.Instances.has("42"), false);
	g_Assert.equal(AutomaticType.UnloadOwnerInstances(42), 0);

	g_Assert.equal(First.AddUnloadInstance("DuplicateOwner"), First);
	g_Assert.equal(First.AddUnloadInstance("DuplicateOwner"), First);
	g_Assert.equal(First.Owner, "42");
	g_Assert.equal(OwnedInstance.ClearOwnerInstances("DuplicateOwner"), 2);
	g_Assert.equal(OwnedInstance.ClearOwnerInstances("DuplicateOwner"), 0);
	g_Assert.equal(First.UnloadCount, 1);

	const BaseInstance = new AutomaticType("BaseOwner");
	g_Assert.equal(BaseInstance.Owner, "BaseOwner");
	g_Assert.throws(() => AutomaticType.UnloadOwnerInstances("BaseOwner"), { name: "Error" });
	g_Assert.equal(AutomaticType.ClearOwnerInstances("BaseOwner"), 1);

	AutomaticType.Instances.set("InvalidOwner", {});
	g_Assert.throws(() => AutomaticType.UnloadOwnerInstances("InvalidOwner"), { name: "TypeError" });
	g_Assert.throws(() => AutomaticType.ClearOwnerInstances("InvalidOwner"), { name: "TypeError" });
	g_Assert.equal(AutomaticType.Instances.delete("InvalidOwner"), true);
	g_Assert.equal(AutomaticType.Instances.size, 0);
}

TestCoreRuntimeExample(AutomaticUnload);

console.log("[smoke_core_automatic_unload] ok; actual JavaScript registries with native IO disabled, not a native or GC integration check");
