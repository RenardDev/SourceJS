"use strict";

const {
	AutomaticUnload,
	CaptureServerOutput,
	CreateChecksum,
	GetGlobalInfo,
	MessageSeverity,
	OutputReturn,
	Tokenizer,
} = require("core");
const { GetModuleNames, SphinxProject } = require("autodoc");
const { Command, CommandReturn } = require("commands");
const { ASCIITable, Alignment, Column } = require("core/table");
const { VERSION } = require("core/version");
const { GetLoadedExtensions } = require("extensions");
const {
	DoesFileExist,
	GetTemporaryFilePath,
	IsVPKFile,
	RemoveFile,
	SourceFile,
	WriteTextFile,
} = require("filesystem");
const { GetRuntimeInfo } = require("globals");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");
const {
	ButtonStatus,
	GetButtonCombinationStatus,
	ListenerManager,
	RegisterPluginUnloadingListener,
	ServerOutputManager,
} = require("listeners");
const { LogArea, LogInfo, LogLevel, LogManager, LogWarning } = require("loggers");
const { DATA_ROOT, GAME_ROOT, PACKAGE_ROOT } = require("paths");
const { GetPluginList, GetPluginRecords } = require("plugins");
const { SubCommandManager } = require("plugins/command");
const { PluginInfo } = require("plugins/info");
const { Plugin } = require("plugins/instance");
const { PLUGIN_MANAGER, PluginManager } = require("plugins/manager");
const {
	PUBLIC_NAME,
	GetExportedNames,
	IsPublicValue,
	MarkPublic,
} = require("public");
const { RegisterCommand, UnregisterCommand } = require("source");

const g_strPluginName = "api-core-runtime";
const g_strCommandName = "sjs_api_core";
const g_strPluginCommandName = "sjs_api_core_plugins";
const g_unSummaryEntryLimit = 8;
const g_unModuleNamePreviewLimit = 10;
const g_unFirstLineReadLimit = 120;
const g_unExampleButtonMask = 4;
const g_setPendingResources = new Set();
let g_bCleaning = false;

function TrackResource(strName, Release) {
	const Resource = { Name: strName, Release: Release, Releasing: false };
	g_setPendingResources.add(Resource);

	return Resource;
}

function ReleaseResource(Resource) {
	if (!g_setPendingResources.has(Resource) || Resource.Releasing) {
		return;
	}

	Resource.Releasing = true;
	try {
		if (Resource.Release() !== true) {
			throw new Error(`Could not release ${Resource.Name}.`);
		}

		g_setPendingResources.delete(Resource);
	} finally {
		Resource.Releasing = false;
	}
}

function UseResource(strName, Release, Use) {
	const Resource = TrackResource(strName, Release);
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			ReleaseResource(Resource);
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strName} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

function SummarizeValue(Value) {
	if (Value === undefined) {
		return "undefined";
	}

	if (Value === null) {
		return "null";
	}

	if (Array.isArray(Value)) {
		return `${Value.length} entries`;
	}

	if (typeof Value === "object") {
		const vecKeys = Object.keys(Value).slice(0, g_unSummaryEntryLimit);
		return `{ ${vecKeys.map(function FormatValueKey(strKey) {
			return `${strKey}: ${String(Value[strKey])}`;
		}).join(", ")} }`;
	}

	return String(Value);
}

function TakeValues(vecValues, unCount = g_unSummaryEntryLimit) {
	return Array.isArray(vecValues) ? vecValues.slice(0, unCount) : vecValues;
}

function LogResult(strLabel, Value) {
	LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);
}

function RunCoreExample(InputCommand) {
	if (new Command(InputCommand).Arguments.length !== 1) {
		LogWarning(`Usage: ${g_strCommandName}`);
		return CommandReturn.Handled;
	}

	LogInfo("%s", `SourceJS runtime on ${GAME_ROOT}`);
	LogResult("core.GetGlobalInfo", GetGlobalInfo());

	const TokenizerInstance = new Tokenizer('sjs "quoted value" // comment', { CommentPrefix: "//" });
	LogResult("core.Tokenizer", { Hash: TokenizerInstance.GetTokenHash(), Value: String(TokenizerInstance), Tokens: Array.from(TokenizerInstance) });
	LogResult("core.CreateChecksum", CreateChecksum("Source JS", true));

	class DemoUnload extends AutomaticUnload {
		UnloadInstance() {
			return "disposed";
		}
	}

	// Keep the demonstration separate from the live plugin's unload registry.
	Object.defineProperty(DemoUnload, "Instances", { value: new Map() });
	new DemoUnload(g_strPluginName);
	LogResult("core.AutomaticUnload", DemoUnload.UnloadOwnerInstances(g_strPluginName));
	LogResult("core/version.VERSION", VERSION);

	const Table = new ASCIITable(new Column("Field", Alignment.Left), new Column("Value", Alignment.Left));
	Table.AddTableRow("version", VERSION);
	Table.AddTableRow("GAME_ROOT", GAME_ROOT);
	LogResult("core/table.ASCIITable", Table.FormatTable());
	LogInfo("Native info callback executed.");

	const LogManagerInstance = new LogManager("api-core-runtime", {
		LogAreas: LogArea.CONSOLE,
		LogDateFormat: "%Y-%m-%d %H:%M:%S",
		LogRecordFormat: "{Timestamp} {LoggerName} {LevelName}: {Message}",
		LogLevel: LogLevel.DEBUG,
		Prefix: "[api-core-runtime/demo] ",
	});
	UseResource("demo logger", () => LogManagerInstance.UnloadLogManager(), function UseDemoLogger() {
		const ChildLogger = LogManagerInstance.GetOrCreateChildLogger("child");
		ChildLogger.LogDebug("formatted %s %d", "message", 7);
		LogResult("loggers.LogManager", { LogAreas: ChildLogger.LogAreas, LogLevel: ChildLogger.LogLevel, LoggerName: ChildLogger.LoggerName, Prefix: ChildLogger.Prefix });
	});

	const ModuleExports = {};

	function APICoreRuntimeDemo() {
	}

	MarkPublic(APICoreRuntimeDemo, { Target: ModuleExports });
	LogResult("public.MarkPublic", { Name: APICoreRuntimeDemo[PUBLIC_NAME], Names: GetExportedNames(ModuleExports), Public: IsPublicValue(APICoreRuntimeDemo) });
	LogResult("globals.GetRuntimeInfo", GetRuntimeInfo());

	const vecInterfaceNames = GetAllInterfaceNames();
	const FirstInterface = (vecInterfaceNames.length > 0) ? GetInterfaceRecord(vecInterfaceNames[0]) : null;
	LogResult("interfaces.GetAllInterfaceNames", TakeValues(vecInterfaceNames));
	LogResult("interfaces.GetInterfaceRecord", FirstInterface);

	let unListenerCalls = 0;
	const ListenerManagerInstance = new ListenerManager("APICoreRuntimeDemo", { AutoBridge: false });
	function HandleListenerPayload(Payload) {
		if (Payload.OK) {
			unListenerCalls += 1;
		}
	}

	ListenerManagerInstance.RegisterListener(HandleListenerPayload);
	UseResource("demo listener", () => ListenerManagerInstance.UnregisterListener(HandleListenerPayload), function UseDemoListener() {
		// AutoBridge is disabled: notify the local callbacks, not the native event bus.
		ListenerManagerInstance.NotifyListeners({ OK: true });
	});
	LogResult("listeners.ListenerManager", { ButtonPressed: GetButtonCombinationStatus(0, g_unExampleButtonMask, g_unExampleButtonMask) === ButtonStatus.PRESSED, Calls: unListenerCalls, Empty: ListenerManagerInstance.Empty });
	LogResult(
		"core.CaptureServerOutput",
		CaptureServerOutput(OutputReturn.CONTINUE, function CaptureOutput(Output) {
			ServerOutputManager.EmitListenerEvent(MessageSeverity.MESSAGE, "sourcejs serverOutput smoke");

			return Output;
		}),
	);
	LogResult("filesystem.DoesFileExist(GAME_ROOT)", DoesFileExist(GAME_ROOT));
	LogResult(
		"filesystem.SourceFile.UseSourceFile",
		SourceFile.UseSourceFile(
			"gameinfo.txt",
			function ReadSourceFile(SourceFileInstance) {
				return {
					FirstLine: SourceFileInstance.ReadSourceFileLine(g_unFirstLineReadLimit),
					Readable: SourceFileInstance.IsSourceFileReadable(),
					Seekable: SourceFileInstance.IsSourceFileSeekable(),
					Size: SourceFileInstance.FileSize,
					Position: SourceFileInstance.GetSourceFileOffset(),
				};
			},
			{ FileMode: "rt" },
		),
	);

	// This isolated demo requires no concurrent writers: generated paths are not exclusive reservations.
	const strDemoPath = GetTemporaryFilePath("sourcejs-api-core-runtime-");
	if (DoesFileExist(strDemoPath)) {
		throw new Error(`Refusing to overwrite ${strDemoPath}.`);
	}

	let DemoFile = null;
	UseResource("demo temporary file", function RemoveDemoFile() {
		if (DemoFile && !DemoFile.Closed) {
			return false;
		}

		return !DoesFileExist(strDemoPath) || RemoveFile(strDemoPath);
	}, function UseDemoFile() {
		if (!WriteTextFile(strDemoPath, "abcdef")) {
			throw new Error(`Could not write ${strDemoPath}.`);
		}

		DemoFile = SourceFile.OpenSourceFile(strDemoPath, "rb+");
		UseResource("demo file handle", () => DemoFile.Closed || DemoFile.CloseSourceFile(), function TruncateDemoFile() {
			const unSize = DemoFile.TruncateSourceFile(3);
			DemoFile.SeekSourceFile(0);
			LogResult("filesystem.SourceFile.TruncateSourceFile", { Bytes: Array.from(DemoFile.ReadSourceFile()), Size: unSize });
		});
	});

	LogResult(
		"filesystem.SourceFile",
		SourceFile.UseSourceFile("gameinfo.txt", function InspectSourceFile(SourceFileInstance) {
			return {
				IsVPK: IsVPKFile(SourceFileInstance.FilePath),
				VisiblePath: SourceFileInstance.FilePath,
			};
		}),
	);
	LogResult("paths", { DATA_ROOT, GAME_ROOT, PACKAGE_ROOT });
	LogResult("autodoc.GetModuleNames", TakeValues(GetModuleNames(), g_unModuleNamePreviewLimit));

	const strProjectDirectory = `${DATA_ROOT}/autodoc-api-core-runtime`;
	const Project = new SphinxProject(PACKAGE_ROOT, strProjectDirectory);
	LogResult("autodoc.SphinxProject", {
		PackageExists: Project.DoesPackageExist(),
		PackageDirectory: Project.PackageDirectory,
		ProjectBuildDirectory: Project.ProjectBuildDirectory,
		ProjectDirectory: Project.ProjectDirectory,
		ProjectExists: Project.DoesProjectExist(),
		ProjectSourceDirectory: Project.ProjectSourceDirectory,
	});
}

function RunPluginExample(InputCommand) {
	if (new Command(InputCommand).Arguments.length !== 1) {
		LogWarning(`Usage: ${g_strPluginCommandName}`);
		return CommandReturn.Handled;
	}

	const CurrentPluginInformation = PLUGIN_MANAGER.GetPluginInfo(g_strPluginName);
	const CurrentPlugin = PLUGIN_MANAGER.GetPluginInstance(g_strPluginName);
	const CommandManagerInstance = new SubCommandManager(PLUGIN_MANAGER, g_strPluginCommandName);
	LogResult("plugins.GetPluginList", GetPluginList());
	LogResult("plugins.GetPluginRecords", GetPluginRecords());
	LogResult("plugins/info.PluginInfo", { Entry: CurrentPluginInformation.Entry, Name: CurrentPluginInformation.Name, ValidType: CurrentPluginInformation instanceof PluginInfo });
	LogResult("plugins/instance.Plugin", { Loaded: CurrentPlugin?.Loaded ?? false, ValidType: CurrentPlugin instanceof Plugin });
	LogResult("plugins/manager.PLUGIN_MANAGER", { Loaded: PLUGIN_MANAGER.IsPluginLoaded(g_strPluginName), Plugins: PLUGIN_MANAGER.LoadedPlugins, ValidType: PLUGIN_MANAGER instanceof PluginManager });
	LogResult("plugins/command.SubCommandManager", { Command: g_strPluginCommandName, Registrations: CommandManagerInstance.length });
	LogResult("extensions.GetLoadedExtensions", GetLoadedExtensions());
}

function Cleanup() {
	if (g_bCleaning) {
		return;
	}

	g_bCleaning = true;
	const vecErrors = [];
	try {
		for (const Resource of [...g_setPendingResources].reverse()) {
			try {
				ReleaseResource(Resource);
			} catch (CleanupError) {
				vecErrors.push(CleanupError);
			}
		}
	} finally {
		g_bCleaning = false;
	}

	if (vecErrors.length === 1) {
		throw vecErrors[0];
	}

	if (vecErrors.length > 1) {
		throw new AggregateError(vecErrors, "Core runtime example cleanup failed.");
	}
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (strUnloadingPluginName === g_strPluginName) {
		Cleanup();
	}
}

exports.Unload = Cleanup;

try {
	if (!RegisterCommand(g_strCommandName, RunCoreExample)) {
		throw new Error(`Could not register ${g_strCommandName}.`);
	}

	TrackResource("core command", () => UnregisterCommand(g_strCommandName, RunCoreExample));

	if (!RegisterCommand(g_strPluginCommandName, RunPluginExample)) {
		throw new Error(`Could not register ${g_strPluginCommandName}.`);
	}

	TrackResource("plugin command", () => UnregisterCommand(g_strPluginCommandName, RunPluginExample));
	const PluginUnloadingRegistration = RegisterPluginUnloadingListener(HandlePluginUnloading);
	TrackResource("plugin unloading listener", () => PluginUnloadingRegistration.Disposed || PluginUnloadingRegistration.DisposeListener());

	LogInfo(`Plugin loaded; run "${g_strCommandName}" or "${g_strPluginCommandName}".`);
} catch (ErrorValue) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "Core runtime example startup and cleanup failed.");
	}

	throw ErrorValue;
}
