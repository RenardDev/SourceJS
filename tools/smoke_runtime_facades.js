#!/usr/bin/env node

"use strict";

const g_ChildProcess = require("node:child_process");
const g_Assert = require("node:assert/strict");
const g_Crypto = require("node:crypto");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strCorePath = g_Path.join(g_strPackageRootPath, "core.js");
const g_strLoggerPath = g_Path.join(g_strPackageRootPath, "core", "logger.js");
const g_strUpdatePath = g_Path.join(g_strPackageRootPath, "core", "update.js");
const g_strVersionPath = g_Path.join(g_strPackageRootPath, "core", "version.js");
const g_strPluginsPath = g_Path.join(g_strPackageRootPath, "plugins.js");
const g_strExtensionsPath = g_Path.join(g_strPackageRootPath, "extensions.js");
const g_strFileSystemModulePath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strLoggersPath = g_Path.join(g_strPackageRootPath, "loggers.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");

const g_mapListenerCallbacks = new Map();
const g_vecLogMessages = [];
const g_vecHTTPCalls = [];
const g_vecPendingHTTPRequests = [];

const g_mapPackageCacheDescriptors = new Map();
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_NodePathDescriptor = Object.getOwnPropertyDescriptor(process.env, "NODE_PATH");
const g_GlobalPathsDescriptor = Object.getOwnPropertyDescriptor(g_Module, "globalPaths");
const g_InitializeModulePaths = g_Module._initPaths;
let g_bPackageCacheOwned = false;
let g_bSourceJSOwned = false;
let g_bModulePathsOwned = false;

function RestoreProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned fixture property must be removable: " + strKey);
}

function RestoreRuntimeFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	// These are owned Node doubles, not live native listeners or HTTP requests.
	AttemptRestoration(() => g_mapListenerCallbacks.clear());
	AttemptRestoration(() => {
		g_vecPendingHTTPRequests.length = 0;
	});
	AttemptRestoration(() => {
		g_vecHTTPCalls.length = 0;
	});
	AttemptRestoration(() => {
		g_vecLogMessages.length = 0;
	});

	if (g_bPackageCacheOwned) {
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", g_SourceJSDescriptor));
	}

	if (g_bModulePathsOwned) {
		AttemptRestoration(() => RestoreProperty(process.env, "NODE_PATH", g_NodePathDescriptor));
		AttemptRestoration(() => g_InitializeModulePaths.call(g_Module));
		AttemptRestoration(() => RestoreProperty(g_Module, "globalPaths", g_GlobalPathsDescriptor));
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Runtime facade fixture restoration failed.");
	}
}

function CompletePendingHTTPRequests() {
	const vecPendingHTTPRequests = g_vecPendingHTTPRequests.splice(0);
	for (const PendingHTTPRequest of vecPendingHTTPRequests) {
		PendingHTTPRequest.Callback(null, PendingHTTPRequest.Response);
	}
}

function InstallDependency(strModulePath, ModuleExports) {
	delete require.cache[strModulePath];
	require.cache[strModulePath] = { exports: ModuleExports, filename: strModulePath, id: strModulePath, loaded: true };
}

function VerifyRootPackageExports() {
	const mapModulePaths = new Map([
		["Auth", "auth"],
		["Autodoc", "autodoc"],
		["BitBuffers", "bitbuffers"],
		["Colors", "colors"],
		["Commands", "commands"],
		["Config", "config"],
		["Core", "core"],
		["CVars", "cvars"],
		["Effects", "effects"],
		["Engines", "engines"],
		["Entities", "entities"],
		["Events", "events"],
		["Extensions", "extensions"],
		["FileSystem", "filesystem"],
		["Filters", "filters"],
		["Globals", "globals"],
		["Interfaces", "interfaces"],
		["KeyValues", "keyvalues"],
		["Listeners", "listeners"],
		["Loggers", "loggers"],
		["MathLibrary", "mathlib"],
		["Memory", "memory"],
		["Menus", "menus"],
		["Messages", "messages"],
		["NetChannel", "netchannel"],
		["Paths", "paths"],
		["Physics", "physics"],
		["Players", "players"],
		["Plugins", "plugins"],
		["Public", "public"],
		["Settings", "settings"],
		["Steam", "steam"],
		["StringTables", "stringtables"],
		["Studio", "studio"],
		["Translations", "translations"],
		["Weapons", "weapons"],
	]);
	const strDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "docs", "api", "README.md"), "utf8");
	const mapModuleExports = new Map();
	for (const [strExportName, strModulePath] of mapModulePaths) {
		mapModuleExports.set(strModulePath, Object.freeze({ Name: strExportName }));
		g_Assert.equal(strDocumentation.includes(`| \`${strExportName}\` | \`${strModulePath}\` |`), true, `root documentation must map ${strExportName} to ${strModulePath}`);
	}

	const vecRequestedModulePaths = [];
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof LoaderDescriptor.value === "function"), "Module loader must support exact restoration.");
	const LoadModule = LoaderDescriptor.value;
	const ModuleLoadError = new Error("Isolated module-loader failure");
	let bRejectModuleLoads = false;
	const strRootIndexPath = g_Path.join(g_strPackageRootPath, "index.js");
	const RootCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, strRootIndexPath);
	g_Assert.ok(!RootCacheDescriptor || RootCacheDescriptor.configurable, "Root package cache entry must support exact restoration.");

	let PrimaryError = null;
	let bHasPrimaryError = false;

	try {
		RestoreProperty(require.cache, strRootIndexPath, undefined);
		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			value: function(strModuleName, ParentModule, bIsMain) {
				if (mapModuleExports.has(strModuleName)) {
					if (bRejectModuleLoads) {
						throw ModuleLoadError;
					}

					vecRequestedModulePaths.push(strModuleName);
					return mapModuleExports.get(strModuleName);
				}

				return LoadModule.call(this, strModuleName, ParentModule, bIsMain);
			},
		});

		const Package = require(strRootIndexPath);
		g_Assert.deepEqual(Object.keys(Package), [...mapModulePaths.keys()], "root package exposes only canonical PascalCase names");
		g_Assert.deepEqual(vecRequestedModulePaths, [], "root package must not eagerly load its modules");

		for (const [strExportName, strModulePath] of mapModulePaths) {
			const Descriptor = Object.getOwnPropertyDescriptor(Package, strExportName);
			g_Assert.equal(typeof Descriptor.get, "function", `${strExportName} must be a lazy getter`);
			g_Assert.equal(Descriptor.set, undefined);
			g_Assert.equal(Descriptor.configurable, false);
			g_Assert.equal(Descriptor.enumerable, true);
			g_Assert.equal(Package[strExportName], mapModuleExports.get(strModulePath), `${strExportName} must preserve module identity`);
			g_Assert.equal(Object.hasOwn(Package, strModulePath), false, `${strModulePath} must not remain as a lowercase alias`);
			g_Assert.throws(() => {
				Package[strExportName] = {};
			}, TypeError, "root module getters are read-only");
		}

		g_Assert.deepEqual(vecRequestedModulePaths, [...mapModulePaths.values()], "root getters retain exact require paths and loading order");
		g_Assert.equal(Package.Core, mapModuleExports.get("core"), "repeated access retains module identity");
		g_Assert.equal(vecRequestedModulePaths.at(-1), "core", "repeated access delegates to the module loader");
		g_Assert.throws(() => Object.defineProperty(Package, "Core", { value: {} }), TypeError, "root getters are non-configurable");

		bRejectModuleLoads = true;
		g_Assert.throws(() => Package.Core, (RequestError) => RequestError === ModuleLoadError, "root getters propagate the original loader error");
		bRejectModuleLoads = false;
		g_Assert.equal(Package.Core, mapModuleExports.get("core"), "a failed load does not prevent a subsequent successful access");
	} catch (Failure) {
		PrimaryError = Failure;
		bHasPrimaryError = true;
	} finally {
		const vecFailures = [];

		try {
			Object.defineProperty(g_Module, "_load", LoaderDescriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}

		try {
			RestoreProperty(require.cache, strRootIndexPath, RootCacheDescriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}

		if (vecFailures.length > 0) {
			throw new AggregateError(bHasPrimaryError ? [PrimaryError, ...vecFailures] : vecFailures, "Root package fixture restoration failed.");
		}
	}

	if (bHasPrimaryError) {
		throw PrimaryError;
	}
}

const g_NativeCore = {
	GetChecksum(strValue) {
		return g_Crypto.createHash("md5").update(strValue, "utf8").digest("hex");
	},

	GetInfo() {
		return {
			Architecture: "x64",
			GameName: "left4dead2",
			GitCommit: "abc123",
			Platform: "windows",
			Runtime: "sourcejs",
			SDKBranch: "sdk2013",
			SourceEngine: "source",
			SourceEngineBranch: "sdk2013",
			Version: "0.3.0",
		};
	},

	GetModules() {
		return ["core", "cpr", "loggers"];
	},

	GetPublicPackages() {
		return ["core", "loggers"];
	},

	GetVersion() {
		return "0.3.0";
	},
};

const g_NativeLogger = {
	LogError(strMessage) {
		g_vecLogMessages.push(["ERROR", strMessage]);
	},

	LogInfo(strMessage) {
		g_vecLogMessages.push(["INFO", strMessage]);
	},

	LogWarning(strMessage) {
		g_vecLogMessages.push(["WARNING", strMessage]);
	},
};

const g_NativePlugins = {
	List() {
		return ["echo"];
	},

	LoadPlugin(strName) {
		return strName === "echo";
	},
};

const g_NativeExtensions = {
	List() {
		return ["echo"];
	},

	Load(strName) {
		return strName === "echo";
	},

	Unload(strName) {
		return strName === "echo";
	},

	Disable() {
		return false;
	},

	Enable() {
		return false;
	},

	Reload() {
		return false;
	},

	ReloadAll() {
		return false;
	},

	UnloadAll() {
		return false;
	},
};

const g_NativeVersion = {
	GIT_COMMIT: "abc123",
	VERSION: "0.3.0",

	GetInfo: g_NativeCore.GetInfo,

	IsUnversioned() {
		return false;
	},

	GetVersion: g_NativeCore.GetVersion,
};

const g_NativeUpdate = {
	GetCurrentBuild() {
		return {
			Architecture: "x64",
			GitCommit: "abc123",
			Platform: "windows",
			SDKBranch: "sdk2013",
			Version: "0.3.0",
		};
	},
};

const g_NativeCPR = {
	Get(Options, Callback) {
		g_Assert.equal((Options !== null) && (typeof Options === "object") && !Array.isArray(Options), true, "CPR options are required");
		g_Assert.equal(typeof Callback, "function", "CPR callback is required");
		g_vecHTTPCalls.push(Options);

		let HTTPResponse;
		if (Options.URL === "https://ip.invalid") {
			HTTPResponse = { Error: "", OK: true, StatusCode: 200, Text: "203.0.113.7\n" };
		} else {
			HTTPResponse = {
				Error: "",
				OK: true,
				StatusCode: 200,
				// GitHub release fields retain their external wire spelling.
				Text: JSON.stringify({
					assets: [{ browser_download_url: "https://downloads.invalid/sourcejs-windows-sdk2013-x64.zip" }],
					tag_name: "0.1.1",
				}),
			};
		}

		if (Options.Blocking === true) {
			Callback(null, HTTPResponse);
			return;
		}

		g_vecPendingHTTPRequests.push({ Callback, Response: HTTPResponse });
	},
};

function VerifyServerOutputCaptureCleanup(Core, NativeListeners) {
	const OriginalOn = NativeListeners.On;
	const OriginalOff = NativeListeners.Off;
	const vecValues = [
		undefined,
		null,
		false,
		0,
		"opaque",
		new Error("Capture fixture failure."),
		Promise.resolve("later"),
	];
	let unCases = 0;

	try {
		for (const bCaptureThrows of [false, true]) {
			for (const CaptureValue of vecValues) {
				for (const strCleanupMode of ["TRUE", "FALSE", "THROW"]) {
					for (const CleanupValue of (strCleanupMode === "THROW") ? vecValues : [undefined]) {
						let Listener = null;
						let unCleanupCalls = 0;
						let unCallbackCalls = 0;
						NativeListeners.On = (strEventName, Callback) => {
							g_Assert.equal(strEventName, "ServerOutput");
							Listener = Callback;
							return true;
						};

						NativeListeners.Off = (strEventName, Callback) => {
							g_Assert.equal(strEventName, "ServerOutput");
							g_Assert.equal(Callback, Listener);
							g_Assert.equal(unCallbackCalls, 1);
							unCleanupCalls += 1;

							if (strCleanupMode === "THROW") {
								throw CleanupValue;
							}

							return strCleanupMode === "TRUE";
						};

						let Result = undefined;
						let Failure = undefined;
						let bThrew = false;

						try {
							Result = Core.CaptureServerOutput(Core.OutputReturn.CONTINUE, (vecOutputEntries) => {
								unCallbackCalls += 1;
								g_Assert.equal(Listener("ServerOutput", [Core.MessageSeverity.MESSAGE, "captured"]), Core.OutputReturn.CONTINUE);
								g_Assert.deepEqual(vecOutputEntries, [{ Message: "captured", Severity: Core.MessageSeverity.MESSAGE }]);

								if (bCaptureThrows) {
									throw CaptureValue;
								}

								return CaptureValue;
							});
						} catch (CaughtFailure) {
							bThrew = true;
							Failure = CaughtFailure;
						}

						g_Assert.equal(unCallbackCalls, 1);
						g_Assert.equal(unCleanupCalls, 1);
						g_Assert.equal(bThrew, bCaptureThrows || (strCleanupMode !== "TRUE"));

						if (bCaptureThrows && (strCleanupMode !== "TRUE")) {
							g_Assert.ok(Failure instanceof AggregateError);
							g_Assert.equal(Failure.errors.length, 2);
							g_Assert.equal(Failure.errors[0], CaptureValue);

							if (strCleanupMode === "THROW") {
								g_Assert.equal(Failure.errors[1], CleanupValue);
							} else {
								g_Assert.equal(Failure.errors[1].message, "Unable to unregister the server output listener.");
							}
						} else if (bCaptureThrows) {
							g_Assert.equal(Failure, CaptureValue);
						} else if (strCleanupMode === "THROW") {
							g_Assert.equal(Failure, CleanupValue);
						} else if (strCleanupMode === "FALSE") {
							g_Assert.equal(Failure.message, "Unable to unregister the server output listener.");
						} else {
							g_Assert.equal(Result, CaptureValue);
						}

						unCases += 1;
					}
				}
			}
		}
	} finally {
		NativeListeners.On = OriginalOn;
		NativeListeners.Off = OriginalOff;
	}

	console.log(`[smoke_runtime_facades] Capture cleanup ${unCases} profiles passed`);
}

const g_NativeListeners = {
	Off(strEventName, Callback) {
		return (g_mapListenerCallbacks.get(strEventName) === Callback) && g_mapListenerCallbacks.delete(strEventName);
	},

	On(strEventName, Callback) {
		g_mapListenerCallbacks.set(strEventName, Callback);

		return true;
	},
};

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Native runtime fixture must support exact restoration.");
g_Assert.ok(g_GlobalPathsDescriptor && g_GlobalPathsDescriptor.configurable && Array.isArray(g_GlobalPathsDescriptor.value), "Module search paths must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed package cache entries must support exact restoration.");
}

let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	g_bModulePathsOwned = true;
	process.env.NODE_PATH = [g_strPackageRootPath, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
	g_InitializeModulePaths.call(g_Module);

	g_bPackageCacheOwned = true;
	for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
		RestoreProperty(require.cache, strModulePath, undefined);
	}

	g_bSourceJSOwned = true;
	// Raw runtime module IDs are the loader contract, not facade property names.
	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			core: g_NativeCore,
			"core/logger": g_NativeLogger,
			"core/update": g_NativeUpdate,
			"core/version": g_NativeVersion,
			cpr: g_NativeCPR,
			extensions: g_NativeExtensions,
			interfaces: { GetInterfaceRecord: (strName) => ({ Name: strName }) },
			listeners: g_NativeListeners,
			plugins: g_NativePlugins,
		},
	});

	InstallDependency(g_strFileSystemModulePath, {});
	InstallDependency(g_strLoggersPath, g_NativeLogger);
	InstallDependency(g_strPathsPath, {});

	const g_Core = require(g_strCorePath);
	const g_Logger = require(g_strLoggerPath);
	const g_Update = require(g_strUpdatePath);
	const g_Version = require(g_strVersionPath);
	const g_Plugins = require(g_strPluginsPath);
	const g_Extensions = require(g_strExtensionsPath);

	g_Assert.equal(g_Logger, g_NativeLogger, "core/logger exact native identity");
	g_Assert.equal(g_Version, g_NativeVersion, "core/version exact native identity");
	g_Assert.equal(g_Plugins, g_NativePlugins, "plugins exact native identity");
	g_Assert.deepEqual(g_Core.GetCoreModules(), ["core", "cpr", "loggers"], "core module list");
	g_Assert.deepEqual(g_Core.GetPublicPackages(), ["core", "loggers"], "public package list");
	g_Assert.deepEqual(g_Core.GetGlobalInfo(), {
		Architecture: "x64",
		GameName: "left4dead2",
		GitCommit: "abc123",
		Platform: "windows",
		Runtime: "sourcejs",
		SDKBranch: "sdk2013",
		SourceEngine: "source",
		SourceEngineBranch: "sdk2013",
		Version: "0.3.0",
	}, "global core info");
	g_Assert.equal(g_Core.CreateChecksum("a b"), "187ef4436122d1cc2f40dc2b92f0eba0", "whitespace-free checksum");

	let g_strPublicIPAddress = "";
	g_Core.GetPublicIPAddress("https://ip.invalid", (RequestError, strResponseIPAddress) => {
		g_Assert.equal(RequestError, null, "public IP request error");
		g_strPublicIPAddress = strResponseIPAddress;
	});
	g_Assert.equal(g_strPublicIPAddress, "", "public IP callback must not run inline");
	CompletePendingHTTPRequests();
	g_Assert.equal(g_strPublicIPAddress, "203.0.113.7", "CPR-backed public IP");

	const g_OutputLease = g_Core.CaptureServerOutput(g_Core.OutputReturn.BLOCK);
	const g_nCapturedOutputSeverity = 2;
	g_Assert.equal(g_mapListenerCallbacks.has("ServerOutput"), true, "ServerOutput listener ownership");
	g_Assert.equal(g_mapListenerCallbacks.get("ServerOutput")("ServerOutput", JSON.stringify({ Arguments: [g_nCapturedOutputSeverity, "blocked"] })), g_Core.OutputReturn.BLOCK, "ServerOutput action");
	g_Assert.deepEqual(g_OutputLease.OutputEntries, [{ Message: "blocked", Severity: g_nCapturedOutputSeverity }], "ServerOutput payload");
	g_Assert.equal(g_OutputLease.CloseServerOutputCapture(), true, "ServerOutput listener cleanup");

	VerifyServerOutputCaptureCleanup(g_Core, g_NativeListeners);

	g_Assert.equal(g_Logger.LogInfo("hello"), undefined, "logger direct call");
	g_Assert.deepEqual(g_vecLogMessages.at(-1), ["INFO", "hello"], "logger native delegation");

	g_Assert.deepEqual(g_Plugins.List(), ["echo"], "plugins direct list");
	g_Assert.equal(g_Plugins.LoadPlugin("echo"), true, "plugins direct load");

	g_Assert.deepEqual(g_Extensions.GetLoadedExtensions(), ["echo"], "extensions direct list");

	g_Assert.equal(g_Version.VERSION, "0.3.0", "version constant");

	g_Assert.equal(g_Update.GetCurrentBuild().Architecture, "x64", "current build architecture");

	let g_GitHubRelease = null;
	const g_unJSONRequestTimeout = 1234;
	g_Update.FetchJSON("https://sourcejs.invalid/latest", { Timeout: g_unJSONRequestTimeout }, (RequestError, Response) => {
		g_Assert.equal(RequestError, null, "CPR JSON request error");
		g_GitHubRelease = Response;
	});
	g_Assert.equal(g_GitHubRelease, null, "JSON callback must not run inline");
	g_Assert.equal(g_vecHTTPCalls.at(-1).Timeout, g_unJSONRequestTimeout, "JSON request timeout");
	CompletePendingHTTPRequests();
	g_Assert.equal(g_GitHubRelease.tag_name, "0.1.1", "CPR JSON request");

	let g_strArtifactDownloadURL = null;
	g_Update.GetBuildDownloadURL({}, (RequestError, strDownloadURL) => {
		g_Assert.equal(RequestError, null, "artifact selection error");
		g_strArtifactDownloadURL = strDownloadURL;
	});
	g_Assert.equal(g_strArtifactDownloadURL, null, "artifact callback must not run inline");
	CompletePendingHTTPRequests();
	g_Assert.equal(g_strArtifactDownloadURL, "https://downloads.invalid/sourcejs-windows-sdk2013-x64.zip", "artifact selection");
	g_Assert.equal(g_vecHTTPCalls.at(-1).Headers["User-Agent"], "SourceJS", "CPR user agent");

	let g_bQueuedJSONCallbackDelivered = false;
	g_Update.FetchJSON("https://sourcejs.invalid/latest", {}, (RequestError) => {
		g_Assert.equal(RequestError, null, "queued JSON request error");
		g_bQueuedJSONCallbackDelivered = true;
	});

	let g_bBlockingJSONCallbackDelivered = false;
	g_Assert.equal(g_Update.FetchJSON("https://sourcejs.invalid/latest", { Blocking: true }, (RequestError, Response) => {
		g_Assert.equal(RequestError, null, "blocking JSON request error");
		g_Assert.equal(Response.tag_name, "0.1.1", "blocking JSON response");
		g_bBlockingJSONCallbackDelivered = true;
	}), undefined, "blocking JSON still returns no response directly");
	g_Assert.equal(g_bBlockingJSONCallbackDelivered, true, "blocking JSON callback must finish before return");
	g_Assert.equal(g_vecHTTPCalls.at(-1).Blocking, true, "JSON Blocking option propagation");

	let g_bBlockingArtifactCallbackDelivered = false;
	g_Update.GetBuildDownloadURL({ Blocking: true }, (RequestError, strDownloadURL) => {
		g_Assert.equal(RequestError, null, "blocking artifact selection error");
		g_Assert.equal(strDownloadURL, "https://downloads.invalid/sourcejs-windows-sdk2013-x64.zip", "blocking artifact selection");
		g_bBlockingArtifactCallbackDelivered = true;
	});
	g_Assert.equal(g_bBlockingArtifactCallbackDelivered, true, "blocking artifact callback must finish before return");
	g_Assert.equal(g_vecHTTPCalls.at(-1).Blocking, true, "artifact Blocking option propagation");
	g_Assert.equal(g_bQueuedJSONCallbackDelivered, false, "blocking calls must not drain unrelated callbacks");
	CompletePendingHTTPRequests();
	g_Assert.equal(g_bQueuedJSONCallbackDelivered, true, "queued JSON callback delivery");
	g_Assert.equal(g_vecPendingHTTPRequests.length, 0, "all asynchronous responses delivered");

	g_Assert.equal(g_Update.SetUpdateInProgress(true), true, "strict update state");
	g_Assert.throws(() => g_Update.SetUpdateInProgress(1), /must be a boolean/, "numeric update state rejection");
	g_Assert.throws(() => g_Update.FetchJSON(7, {}, () => {}), /non-empty string/, "numeric URL rejection");
	g_Assert.throws(() => g_Update.FetchJSON("https://sourcejs.invalid/latest", () => {}), /options must be an object/, "missing request options rejection");
	g_Assert.throws(() => g_Update.FetchJSON("https://sourcejs.invalid/latest", {}), /callback must be a function/, "missing request callback rejection");
	g_Assert.throws(() => g_Update.FetchJSON("https://sourcejs.invalid/latest", { Blocking: true }), /callback must be a function/, "blocking request still requires a callback");
	g_Assert.throws(() => g_Update.GetBuildDownloadURL("sdk2013"), /options must be an object/, "scalar options rejection");

	const g_strMissingRuntimeScript = [
		'"use strict";',
		'const g_Path = require("node:path");',
		`const g_strPackageRootPath = ${JSON.stringify(g_strPackageRootPath)};`,
		"delete globalThis.sourcejs;",
		'require(g_Path.join(g_strPackageRootPath, "plugins.js"));',
		"",
	].join("\n\n");
	g_Assert.throws(() => g_ChildProcess.execFileSync(process.execPath, ["-e", g_strMissingRuntimeScript], { cwd: g_strRepositoryRootPath, stdio: "pipe" }), (Failure) => (Failure.status === 1) && /SourceJS native runtime is not installed\./.test(String(Failure.stderr)), "direct native facade must fail without SourceJS runtime");

	for (const ModuleAPI of [
		g_Logger,
		g_Update,
		g_Version,
		g_Plugins,
		g_Extensions,
	]) {
		g_Assert.equal(Object.hasOwn(ModuleAPI, "moduleName"), false, "facades must not expose moduleName");
		g_Assert.equal(Object.hasOwn(ModuleAPI, "default"), false, "facades must not expose default aliases");
	}

	g_Assert.equal(g_Core.MODULE_NAME, "core", "core module name");
	g_Assert.equal(g_Core.GAME_NAME, "left4dead2", "core game name");
	g_Assert.equal(g_Core.PLATFORM, "windows", "core platform");
	g_Assert.equal(g_Core.SOURCE_ENGINE, "source", "core source engine");
	g_Assert.equal(g_Core.SOURCE_ENGINE_BRANCH, "sdk2013", "core source engine branch");
	g_Assert.equal(g_Core.GetSourceJSVersion(), "0.3.0", "core sourcejs version");
	g_Assert.equal(Object.hasOwn(g_Core, "AutoUnload"), false, "core must not expose AutoUnload alias");
	g_Assert.equal(Object.hasOwn(g_Core, "ServerOutput"), false, "core must not expose ServerOutput alias");

	VerifyRootPackageExports();
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	try {
		RestoreRuntimeFixture();
	} catch (CleanupFailure) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, CleanupFailure] : [CleanupFailure], "Runtime facade smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_runtime_facades");
