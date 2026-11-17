#!/usr/bin/env node

"use strict";

const g_Module = require("node:module");
const g_Path = require("node:path");
const { CreateSettingsSOCIMock } = require("./native_soci_settings_mock.js");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strCommandsPath = g_Path.join(g_strPackageRoot, "commands.js");
const g_strConfigurationPath = g_Path.join(g_strPackageRoot, "config.js");
const g_strCoreSettingsPath = g_Path.join(g_strPackageRoot, "core", "settings.js");
const g_strCVarsPath = g_Path.join(g_strPackageRoot, "cvars.js");
const g_strSettingsPath = g_Path.join(g_strPackageRoot, "settings.js");
const g_strStoragePath = g_Path.join(g_strPackageRoot, "settings", "storage.js");
const g_unRequestTimeoutMilliseconds = 5_000;
const g_setPackageModuleNames = new Set([
	"commands",
	"config/command",
	"config/cvar",
	"config/manager",
	"config/section",
	"cvars",
	"internal/runtime",
]);

const g_mapVirtualFiles = new Map();
const g_setVirtualDirectories = new Set();
const g_mapCVarValues = new Map();
const g_vecExecutedCommands = [];
const g_setOpenSOCIHandles = new Set();
const g_vecSOCICompletions = [];
const g_mapOriginalPackageCache = new Map(Object.entries(require.cache).filter(([strFilePath]) => strFilePath.startsWith(`${g_strPackageRoot}${g_Path.sep}`)));
const g_bHadSourceJS = Object.hasOwn(globalThis, "sourcejs");
const g_OriginalSourceJS = globalThis.sourcejs;
const g_OriginalModuleLoad = g_Module._load;

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertThrows(Operation, strErrorMessage) {
	let bThrewTypeError = false;

	try {
		Operation();
	} catch (OperationError) {
		bThrewTypeError = OperationError instanceof TypeError;
	}

	Assert(bThrewTypeError, strErrorMessage);
}

async function AwaitRequest(StartRequest, Options) {
	const bBlocking = Options.Blocking === true;
	let unCompletionCount = 0;
	let bReturned = false;
	let bInlineCompletion = false;
	let DirectResult = null;
	let Timeout = null;
	const Completion = new Promise((Resolve, Reject) => {
		Timeout = setTimeout(() => Reject(new Error(`Settings request did not complete within ${g_unRequestTimeoutMilliseconds} milliseconds.`)), g_unRequestTimeoutMilliseconds);
		const CompleteRequest = (RequestError, Result) => {
			++unCompletionCount;
			bInlineCompletion = bInlineCompletion || !bReturned;

			if (RequestError !== null) {
				Reject(RequestError);
				return;
			}

			Resolve(Result);
		};

		try {
			DirectResult = StartRequest(Options, CompleteRequest);
		} catch (SchedulingError) {
			Reject(SchedulingError);
		} finally {
			bReturned = true;
		}
	});
	let Result = null;

	try {
		Result = await Completion;
		await new Promise((Resolve) => setImmediate(Resolve));
	} finally {
		clearTimeout(Timeout);
	}

	// These assertions must be outside the settled Promise executor.
	AssertEqual(DirectResult, undefined, "settings request direct result");
	AssertEqual(unCompletionCount, 1, "settings request callback count");

	if (bBlocking) {
		Assert(bInlineCompletion, "Blocking settings requests must complete before returning");
	}

	return Result;
}

function RequirePath(strFilePath) {
	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Runtime path must be a non-empty string.");
	}

	return strFilePath.replace(/\\/g, "/");
}

function CreateFileRuntime(strRootPath, AdditionalProperties = {}) {
	return {
		...AdditionalProperties,
		EnsureDirectoryExists(strDirectoryPath) {
			g_setVirtualDirectories.add(RequirePath(strDirectoryPath));

			return true;
		},
		DoesFileExist(strFilePath) {
			const strNormalizedPath = RequirePath(strFilePath);

			return g_mapVirtualFiles.has(strNormalizedPath) || g_setVirtualDirectories.has(strNormalizedPath);
		},
		ReadTextFile(strFilePath) {
			return g_mapVirtualFiles.get(RequirePath(strFilePath)) ?? "";
		},
		Root: strRootPath,
		WriteTextFile(strFilePath, strText) {
			const strNormalizedPath = RequirePath(strFilePath);

			if (typeof strText !== "string") {
				throw new TypeError("Runtime file text must be a string.");
			}

			g_mapVirtualFiles.set(strNormalizedPath, strText);

			return true;
		},
	};
}

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function RestoreRuntimeEnvironment() {
	g_Module._load = g_OriginalModuleLoad;

	for (const strFilePath of Object.keys(require.cache)) {
		if (strFilePath.startsWith(`${g_strPackageRoot}${g_Path.sep}`)) {
			delete require.cache[strFilePath];
		}
	}

	for (const [strFilePath, CachedModule] of g_mapOriginalPackageCache) {
		require.cache[strFilePath] = CachedModule;
	}

	if (g_bHadSourceJS) {
		globalThis.sourcejs = g_OriginalSourceJS;

	} else {
		delete globalThis.sourcejs;
	}
}

const g_ConfigurationRuntime = CreateFileRuntime("cfg/sourcejs");
const g_SettingsRuntime = CreateFileRuntime("addons/sourcejs/data/settings");
const g_CoreSettingsRuntime = CreateFileRuntime("addons/sourcejs/data/settings", { ConfigurationRoot: "cfg/sourcejs" });
// This callback model exercises package integration, not native workers or drivers.
const g_SOCIRuntime = CreateSettingsSOCIMock();

function TrackSOCIRequest(strOperationName, vecArguments) {
	const unCallbackIndex = vecArguments.length - 1;
	const Callback = vecArguments[unCallbackIndex];
	const bBlocking = vecArguments[unCallbackIndex - 1].Blocking === true;
	let bReturned = false;
	vecArguments[unCallbackIndex] = (RequestError, Result) => {
		g_vecSOCICompletions.push({ Operation: strOperationName, Blocking: bBlocking, Inline: !bReturned });

		if (RequestError === null) {
			if (strOperationName === "Connect") {
				g_setOpenSOCIHandles.add(Result);

			} else if (Result === true) {
				g_setOpenSOCIHandles.delete(vecArguments[0]);
			}
		}

		Callback(RequestError, Result);
	};

	try {
		return Reflect.apply(g_SOCIRuntime[strOperationName], g_SOCIRuntime, vecArguments);
	} finally {
		bReturned = true;
	}
}

for (const strFilePath of g_mapOriginalPackageCache.keys()) {
	delete require.cache[strFilePath];
}

InstallDependency(g_strCommandsPath, {
	ExecuteCommand(strCommandLine) {
		g_vecExecutedCommands.push(strCommandLine);

		return true;
	},
});

InstallDependency(g_strCVarsPath, {
	GetConVarBoolean(strName) {
		return g_mapCVarValues.get(strName) === "1";
	},
	SetConVar(strName, strValue) {
		if ((typeof strName !== "string") || (typeof strValue !== "string")) {
			throw new TypeError("CVar writes require strings.");
		}

		g_mapCVarValues.set(strName, strValue);

		return true;
	},
});

globalThis.sourcejs = {
	config: g_ConfigurationRuntime,
	"core/settings": g_CoreSettingsRuntime,
	settings: g_SettingsRuntime,
	soci: {
		...g_SOCIRuntime,
		Connect(...vecArguments) {
			return TrackSOCIRequest("Connect", vecArguments);
		},
		Close(...vecArguments) {
			return TrackSOCIRequest("Close", vecArguments);
		},
	},
};
g_Module._load = function LoadPackageModule(strRequest) {
	if (g_setPackageModuleNames.has(strRequest)) {
		const vecArguments = Array.from(arguments);
		vecArguments[0] = g_Path.join(g_strPackageRoot, `${strRequest}.js`);
		return Reflect.apply(g_OriginalModuleLoad, this, vecArguments);
	}

	return Reflect.apply(g_OriginalModuleLoad, this, arguments);
};

async function RunSmokeTest() {
	const vecOwnedStorages = [];

	try {
		const Configuration = require(g_strConfigurationPath);
		const Settings = require(g_strSettingsPath);
		const CoreSettings = require(g_strCoreSettingsPath);
		const StorageModule = require(g_strStoragePath);

		AssertEqual(Configuration, g_ConfigurationRuntime, "config exact native identity");
		AssertEqual(Settings, g_SettingsRuntime, "settings exact native identity");
		AssertEqual(CoreSettings, g_CoreSettingsRuntime, "core/settings exact native identity");
		AssertEqual(CoreSettings.ConfigurationRoot, Configuration.Root, "core/settings configuration root");
		AssertEqual(Object.hasOwn(Settings, "root"), false, "settings only exposes PascalCase Root");

		const strManualConfigurationPath = `${Configuration.Root}/manual.cfg`;
		Assert(Configuration.WriteTextFile(strManualConfigurationPath, "sjs_manual 1\n"), "config WriteTextFile");
		AssertEqual(Configuration.ReadTextFile(strManualConfigurationPath), "sjs_manual 1\n", "config ReadTextFile");

		const Manager = new Configuration.ConfigManager("generated/example", { CVarPrefix: "sjs_" });
		Manager.AddCVarConfigEntry("enabled", true, "Enable generated config");
		Manager.AddCommandConfigEntry("sjs_generated_command", "Generated command", { Arguments: ["alpha", "beta"] });

		const strGeneratedPath = Manager.WriteConfig();
		AssertEqual(strGeneratedPath, "cfg/sourcejs/generated/example.cfg", "ConfigManager resolved path");
		Assert(Configuration.DoesFileExist(strGeneratedPath), "ConfigManager writes through the native config object");

		const vecExecutionResults = Manager.ExecuteConfig();
		Assert(vecExecutionResults.some((Result) => (Result.Kind === "cvar") && (Result.Name === "sjs_enabled")), "ConfigManager CVar execution");
		Assert(vecExecutionResults.every((Result) => Result.Success === true), "ConfigManager native execution results are booleans");
		AssertEqual(g_mapCVarValues.get("sjs_enabled"), "1", "ConfigManager CVar value");
		AssertEqual(g_vecExecutedCommands[0], 'sjs_generated_command "alpha" "beta"', "ConfigManager command execution");

		const unLargeHelpLineCount = 200_000;
		const vecLargeHelpLines = [];
		const vecExpectedConfigurationLines = ["// Default: 1"];
		for (let unHelpLineIndex = 0; unHelpLineIndex < unLargeHelpLineCount; ++unHelpLineIndex) {
			const strHelpLine = `Large help ${unHelpLineIndex}`;
			vecLargeHelpLines.push(strHelpLine);
			vecExpectedConfigurationLines.push(`// ${strHelpLine}`);
		}

		vecExpectedConfigurationLines.push('sjs_large_help "1"');

		const LargeManager = new Configuration.ConfigManager("generated/large-help");
		LargeManager.AddCVarConfigEntry("sjs_large_help", true).AddHelpText(vecLargeHelpLines);
		AssertEqual(LargeManager.RenderConfig(), `${vecExpectedConfigurationLines.join("\n")}\n`, "ConfigManager renders a large entry without argument expansion");

		for (const bBlocking of [false, true]) {
			const strPlayerUniqueID = bBlocking ? "STEAM_1:1:8" : "STEAM_1:1:7";
			const Storage = StorageModule.CreateStorage("runtime-players");
			vecOwnedStorages.push(Storage);
			AssertEqual(Storage.Path, `${Settings.Root}/users.sqlite3`, "SettingsStorage database path");
			const PlayerSettings = Storage.GetSettingsForPlayer(strPlayerUniqueID);

			const RejectUnexpectedCallback = () => {
				throw new Error("Invalid request arguments must be rejected before scheduling a callback.");
			};
			const vecRequests = [
				(Options, Callback) => PlayerSettings.SetSetting("Volume", 7, Options, Callback),
				(Options, Callback) => Storage.GetSetting(strPlayerUniqueID, "Volume", null, Options, Callback),
				(Options, Callback) => Storage.Close(Options, Callback),
			];
			for (const Request of vecRequests) {
				AssertThrows(() => Request({}, undefined), "each request requires Callback even with Options");

				for (const InvalidOptions of [undefined, null, [], false, { Blocking: "yes" }]) {
					AssertThrows(() => Request(InvalidOptions, RejectUnexpectedCallback), "each request requires valid Options even with Callback");
				}
			}

			const bWritten = await AwaitRequest((Options, Callback) => PlayerSettings.SetSetting("Volume", 7, Options, Callback), { Blocking: bBlocking });
			AssertEqual(bWritten, true, "PlayerSettingsView SetSetting result");
			const nVolume = await AwaitRequest((Options, Callback) => Storage.GetSetting(strPlayerUniqueID, "Volume", null, Options, Callback), { Blocking: bBlocking });
			AssertEqual(nVolume, 7, "SettingsStorage GetSetting result");
			const nDefaultVolume = await AwaitRequest((Options, Callback) => PlayerSettings.GetSetting("MissingVolume", -1, Options, Callback), { Blocking: bBlocking });
			AssertEqual(nDefaultVolume, -1, "PlayerSettingsView missing setting default");

			const unAddress = 0xFFFFFFFFFFFFFFFFn;
			const nBalance = -0x8000000000000000n;
			AssertEqual(await AwaitRequest((Options, Callback) => PlayerSettings.SetSetting("Address", unAddress, Options, Callback), { Blocking: bBlocking }), true, "unsigned 64-bit write");
			AssertEqual(await AwaitRequest((Options, Callback) => PlayerSettings.SetSetting("Balance", nBalance, Options, Callback), { Blocking: bBlocking }), true, "signed 64-bit write");
			AssertEqual(await AwaitRequest((Options, Callback) => Storage.Close(Options, Callback), { Blocking: bBlocking }), true, "first storage closes its session");

			const ReopenedStorage = StorageModule.CreateStorage("runtime-players");
			vecOwnedStorages.push(ReopenedStorage);
			AssertEqual(await AwaitRequest((Options, Callback) => ReopenedStorage.GetSetting(strPlayerUniqueID, "Volume", null, Options, Callback), { Blocking: bBlocking }), 7, "SOCI persistence after closing and reopening");
			AssertEqual(await AwaitRequest((Options, Callback) => ReopenedStorage.GetSetting(strPlayerUniqueID, "Address", null, Options, Callback), { Blocking: bBlocking }), unAddress, "unsigned 64-bit persistence without Number conversion");
			AssertEqual(await AwaitRequest((Options, Callback) => ReopenedStorage.GetSetting(strPlayerUniqueID, "Balance", null, Options, Callback), { Blocking: bBlocking }), nBalance, "signed 64-bit persistence without Number conversion");
			AssertEqual(await AwaitRequest((Options, Callback) => ReopenedStorage.Close(Options, Callback), { Blocking: bBlocking }), true, "reopened storage closes its session");
		}

		AssertEqual(g_setOpenSOCIHandles.size, 0, "all owned SOCI sessions are closed");
		AssertEqual(g_vecSOCICompletions.length, 8, "each of four sessions connects and closes once");

		for (const Completion of g_vecSOCICompletions) {
			AssertEqual(Completion.Inline, Completion.Blocking, "native model callback timing matches the selected request mode");
		}

		const strCorePath = `${CoreSettings.Root}/core.json`;
		Assert(CoreSettings.WriteTextFile(strCorePath, "{}"), "core/settings WriteTextFile");
		AssertEqual(CoreSettings.ReadTextFile(strCorePath), "{}", "core/settings ReadTextFile");
		AssertEqual(Object.hasOwn(StorageModule, "defaultStorage"), false, "settings/storage should not expose defaultStorage alias");
		AssertEqual(Object.hasOwn(Configuration, "default"), false, "config should not expose a default export");
	} finally {
		try {
			const vecCleanupErrors = [];
			for (const Storage of vecOwnedStorages) {
				try {
					await AwaitRequest((Options, Callback) => Storage.Close(Options, Callback), { Blocking: true });
				} catch (CleanupError) {
					vecCleanupErrors.push(CleanupError);
				}
			}

			if (vecCleanupErrors.length > 0) {
				throw new AggregateError(vecCleanupErrors, "Unable to close settings smoke-test sessions.");
			}
		} finally {
			RestoreRuntimeEnvironment();
		}
	}

	console.log("[  OK  ] smoke_config_settings_runtime");
}

RunSmokeTest().catch((SmokeError) => {
	console.error(SmokeError);
	process.exitCode = 1;
});
