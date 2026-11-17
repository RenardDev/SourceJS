#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPluginManagerPath = g_Path.join(g_strPackageRootPath, "plugins", "manager.js");
const g_strPluginInstancePath = g_Path.join(g_strPackageRootPath, "plugins", "instance.js");
const g_strPluginInformationPath = g_Path.join(g_strPackageRootPath, "plugins", "info.js");
const g_strPluginsModulePath = g_Path.join(g_strPackageRootPath, "plugins.js");
const g_strFileSystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strPathsModulePath = g_Path.join(g_strPackageRootPath, "paths.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins-manager.md");
const g_strNativePluginManagerPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "PluginManager.cpp");

// These paths and persisted-state bytes belong only to the in-memory SDK double.
const g_strPluginRootPath = "C:/game/left4dead2/addons/sourcejs/plugins";
const g_strDataRootPath = "C:/game/left4dead2/addons/sourcejs/data";
const g_strPluginStatePath = `${g_strDataRootPath}/PluginsState.json`;
const g_setPluginDirectoryNames = new Set([
	"disabled",
	"escape",
	"failing",
	"hello",
	"manifestless",
	"metrics",
	"nested",
]);
const g_mapVirtualFiles = new Map([
	[`${g_strPluginRootPath}/disabled/index.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/escape/plugin.json`, JSON.stringify({ Entry: "../outside.js", Name: "escape" })],
	[`${g_strPluginRootPath}/failing/index.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/hello/index.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/hello/plugin.json`, JSON.stringify({ Description: "Greeting example.", Entry: "index.js", Name: "hello", Version: "1.0.0" })],
	[`${g_strPluginRootPath}/manifestless/index.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/metrics/main.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/metrics/plugin.json`, JSON.stringify({ Description: "Metrics example.", Entry: "main.js", Name: "metrics" })],
	[`${g_strPluginRootPath}/nested/dist/main.js`, "module.exports = {};"],
	[`${g_strPluginRootPath}/nested/plugin.json`, JSON.stringify({ Entry: "dist/main.js", Name: "nested" })],
	[g_strPluginStatePath, JSON.stringify({ Disabled: ["disabled"] })],
]);

const g_setDisabledPluginNames = new Set(["disabled"]);
const g_vecLoadedPluginNames = [
	"hello",
	"manifestless",
	"metrics",
	"nested",
];
const g_vecNativeFileSystemCalls = [];
const g_vecNativePluginCalls = [];

function CreateHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strDocumentationMarkdown) {
	const vecDocumentationContentsMatch = strDocumentationMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecDocumentationContentsMatch, "plugins/manager contents section");

	const vecDocumentedAnchors = [];
	for (const vecDocumentationLinkMatch of vecDocumentationContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentationLinkMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecDocumentationHeadingMatch of strDocumentationMarkdown.matchAll(/^## (.+)$/gm)) {
		const strDocumentationSectionAnchor = CreateHeadingAnchor(vecDocumentationHeadingMatch[1]);
		if (strDocumentationSectionAnchor === "contents") {
			continue;
		}

		vecSectionAnchors.push(strDocumentationSectionAnchor);
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins/manager contents anchors");
}

function VerifyDocumentationLinks(strDocumentationMarkdown) {
	const strDocumentationWithoutCode = strDocumentationMarkdown.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationTarget)) {
			continue;
		}

		const nDocumentationFragmentIndex = strDocumentationTarget.indexOf("#");
		const strDocumentationTargetPath = (nDocumentationFragmentIndex < 0) ? strDocumentationTarget : strDocumentationTarget.slice(0, nDocumentationFragmentIndex);
		const strDocumentationTargetFilePath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationTargetPath);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetFilePath), `plugins/manager documentation link must exist: ${strDocumentationTarget}`);
	}
}

function InstallDependency(strDependencyModulePath, DependencyModuleExports) {
	delete require.cache[strDependencyModulePath];
	require.cache[strDependencyModulePath] = { exports: DependencyModuleExports, filename: strDependencyModulePath, id: strDependencyModulePath, loaded: true };
}

function DoesFileExist(strRequestedFilePath) {
	g_vecNativeFileSystemCalls.push(["DoesFileExist", strRequestedFilePath]);

	if ((strRequestedFilePath === g_strPluginRootPath) || (strRequestedFilePath === g_strDataRootPath)) {
		return true;
	}

	if (strRequestedFilePath.startsWith(`${g_strPluginRootPath}/`) && g_setPluginDirectoryNames.has(strRequestedFilePath.slice(g_strPluginRootPath.length + 1))) {
		return true;
	}

	return g_mapVirtualFiles.has(strRequestedFilePath);
}

function ParsePluginManifest(strPluginName) {
	const strPluginManifestPath = `${g_strPluginRootPath}/${strPluginName}/plugin.json`;
	if (!g_mapVirtualFiles.has(strPluginManifestPath)) {
		return null;
	}

	return JSON.parse(g_mapVirtualFiles.get(strPluginManifestPath));
}

function GetPluginEntryPath(strPluginName) {
	const PluginManifest = ParsePluginManifest(strPluginName);
	let strPluginEntry = "index.js";
	if ((PluginManifest !== null) && Object.hasOwn(PluginManifest, "Entry")) {
		strPluginEntry = PluginManifest.Entry;
	}

	if (
		(typeof strPluginEntry !== "string")
		|| (strPluginEntry.length === 0)
		|| strPluginEntry.startsWith("/")
		|| strPluginEntry.startsWith("\\")
		|| /^[A-Za-z]:[\\/]/.test(strPluginEntry)
		|| /(^|[\\/])\.\.([\\/]|$)/.test(strPluginEntry)
	) {
		return null;
	}

	return `${g_strPluginRootPath}/${strPluginName}/${strPluginEntry.replace(/\\/g, "/")}`;
}

function WritePluginState() {
	const vecSortedDisabledPluginNames = Array.from(g_setDisabledPluginNames);
	vecSortedDisabledPluginNames.sort();
	g_mapVirtualFiles.set(g_strPluginStatePath, JSON.stringify({ Disabled: vecSortedDisabledPluginNames }));
}

function CopyCurrentPluginRecords() {
	const vecPluginRecords = [];
	let unPluginIndex = 1;
	for (const strPluginName of g_vecLoadedPluginNames) {
		vecPluginRecords.push({
			Directory: `${g_strPluginRootPath}/${strPluginName}`,
			Enabled: !g_setDisabledPluginNames.has(strPluginName),
			Entry: GetPluginEntryPath(strPluginName),
			Index: unPluginIndex,
			Loaded: true,
			Name: strPluginName,
		});
		unPluginIndex += 1;
	}

	return vecPluginRecords;
}

function LoadNativePlugin(strPluginName) {
	if (g_vecLoadedPluginNames.includes(strPluginName)) {
		return true;
	}

	const strPluginEntryPath = g_setPluginDirectoryNames.has(strPluginName) ? GetPluginEntryPath(strPluginName) : null;
	if ((strPluginEntryPath === null) || !g_mapVirtualFiles.has(strPluginEntryPath) || g_setDisabledPluginNames.has(strPluginName) || (strPluginName === "failing")) {
		return false;
	}

	g_vecLoadedPluginNames.push(strPluginName);

	return true;
}

const g_NativePlugins = {
	DisablePlugin(strPluginName) {
		g_vecNativePluginCalls.push(["DisablePlugin", strPluginName]);

		if (!g_setPluginDirectoryNames.has(strPluginName)) {
			return false;
		}

		const nLoadedPluginIndex = g_vecLoadedPluginNames.indexOf(strPluginName);
		if (nLoadedPluginIndex >= 0) {
			g_vecLoadedPluginNames.splice(nLoadedPluginIndex, 1);
		}

		g_setDisabledPluginNames.add(strPluginName);
		WritePluginState();

		return true;
	},

	EnablePlugin(strPluginName) {
		g_vecNativePluginCalls.push(["EnablePlugin", strPluginName]);

		// Enabling an already enabled fixture name must still continue to loading.
		g_setDisabledPluginNames.delete(strPluginName);
		WritePluginState();

		return LoadNativePlugin(strPluginName);
	},

	List() {
		g_vecNativePluginCalls.push(["List"]);

		const vecPluginRecordRows = [];
		for (const PluginRecord of CopyCurrentPluginRecords()) {
			vecPluginRecordRows.push(`${PluginRecord.Index}. ${PluginRecord.Name}`);
		}

		return vecPluginRecordRows;
	},

	LoadPlugin(strPluginName) {
		g_vecNativePluginCalls.push(["LoadPlugin", strPluginName]);

		return LoadNativePlugin(strPluginName);
	},

	GetPluginRecords() {
		g_vecNativePluginCalls.push(["GetPluginRecords"]);

		return CopyCurrentPluginRecords();
	},

	ReloadPlugin(strPluginName) {
		g_vecNativePluginCalls.push(["ReloadPlugin", strPluginName]);

		const nLoadedPluginIndex = g_vecLoadedPluginNames.indexOf(strPluginName);
		if (nLoadedPluginIndex < 0) {
			return false;
		}

		g_vecLoadedPluginNames.splice(nLoadedPluginIndex, 1);

		return LoadNativePlugin(strPluginName);
	},

	ReloadAllPlugins() {
		g_vecNativePluginCalls.push(["ReloadAllPlugins"]);
		g_vecLoadedPluginNames.length = 0;

		const vecSortedPluginDirectoryNames = Array.from(g_setPluginDirectoryNames);
		vecSortedPluginDirectoryNames.sort();

		for (const strPluginName of vecSortedPluginDirectoryNames) {
			// An individual disabled or failed load must not abort this bulk-rescan fixture.
			LoadNativePlugin(strPluginName);
		}

		return true;
	},

	UnloadPlugin(strPluginName) {
		g_vecNativePluginCalls.push(["UnloadPlugin", strPluginName]);

		const nLoadedPluginIndex = g_vecLoadedPluginNames.indexOf(strPluginName);
		if (nLoadedPluginIndex < 0) {
			return false;
		}

		g_vecLoadedPluginNames.splice(nLoadedPluginIndex, 1);

		return true;
	},

	UnloadAllPlugins() {
		g_vecNativePluginCalls.push(["UnloadAllPlugins"]);
		g_vecLoadedPluginNames.length = 0;

		return true;
	},
};

function LoadActualPluginFacade() {
	const strNativeBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
	const strNativeBindings = g_FileSystem.readFileSync(strNativeBindingsPath, "utf8");
	const nNativeStart = strNativeBindings.indexOf("v8::Local<v8::Object> const LocalPluginsModule = MakeModule(pIsolate);");
	const nNativeEnd = strNativeBindings.indexOf('InstallModule(pIsolate, LocalContext, LocalSourceJS, "plugins", LocalPluginsModule)', nNativeStart);
	g_Assert.ok((nNativeStart >= 0) && (nNativeEnd > nNativeStart), "actual native plugin export block exists");

	const strNativeModule = strNativeBindings.slice(nNativeStart, nNativeEnd);
	const vecNativeNames = [...strNativeModule.matchAll(/SetFunction\(pIsolate, LocalContext, LocalPluginsModule, "([^"]+)"/g)].map((vecMatch) => vecMatch[1]).sort();
	g_Assert.deepEqual(Object.keys(g_NativePlugins).sort(), vecNativeNames, "native double matches the actual C++ plugin exports");

	const Context = g_VM.createContext({ sourcejs: { plugins: g_NativePlugins } });
	const strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
	const Compile = (strModulePath) => g_VM.compileFunction(g_FileSystem.readFileSync(strModulePath, "utf8"), ["require", "module", "exports"], { filename: strModulePath, parsingContext: Context });
	const RuntimeModuleRecord = { exports: {} };
	const RejectDependency = (strDependencyName) => {
		throw new Error(`Unexpected runtime dependency: ${strDependencyName}.`);
	};
	Compile(strRuntimePath)(RejectDependency, RuntimeModuleRecord, RuntimeModuleRecord.exports);

	const PluginModuleRecord = { exports: {} };
	const RequireRuntime = (strDependencyName) => {
		g_Assert.equal(strDependencyName, "internal/runtime");

		return RuntimeModuleRecord.exports;
	};
	Compile(g_strPluginsModulePath)(RequireRuntime, PluginModuleRecord, PluginModuleRecord.exports);
	g_Assert.equal(PluginModuleRecord.exports, g_NativePlugins, "actual plugins.js/runtime.js facade preserves native export identity");

	for (const strLegacyName of [
		"Records",
		"Load",
		"Unload",
		"Reload",
		"UnloadAll",
		"ReloadAll",
		"Disable",
		"Enable",
	]) {
		g_Assert.equal(Object.hasOwn(PluginModuleRecord.exports, strLegacyName), false, "no legacy native plugin alias: " + strLegacyName);
	}

	return PluginModuleRecord.exports;
}

function CheckPluginRecordSnapshots(PluginInstance) {
	const vecLoadedNamesBeforeRead = [...g_vecLoadedPluginNames];
	const unNativeCallStartIndex = g_vecNativePluginCalls.length;
	const FirstRecord = PluginInstance.Record;
	const SecondRecord = PluginInstance.Record;
	g_Assert.notEqual(FirstRecord, SecondRecord, "two reads produce separate record snapshots without a lifecycle operation");
	g_Assert.deepEqual(FirstRecord, SecondRecord, "separate snapshots can describe exactly the same plugin state");
	g_Assert.deepEqual(g_vecLoadedPluginNames, vecLoadedNamesBeforeRead, "reading record snapshots does not change loaded plugin state");

	const vecNativeCalls = g_vecNativePluginCalls.slice(unNativeCallStartIndex);
	g_Assert.equal(vecNativeCalls.length, 2, "each wrapper Record getter makes one native record query");
	g_Assert.equal(vecNativeCalls.every((vecCall) => vecCall[0] === "GetPluginRecords"), true, "snapshot inequality is not evidence of a lifecycle transition");
}

const g_NativeFileSystem = {
	DoesFileExist,
	ReadTextFile(strRequestedFilePath) {
		g_vecNativeFileSystemCalls.push(["ReadTextFile", strRequestedFilePath]);

		if (!g_mapVirtualFiles.has(strRequestedFilePath)) {
			throw new Error(`Virtual file does not exist: ${strRequestedFilePath}`);
		}

		return g_mapVirtualFiles.get(strRequestedFilePath);
	},
};

const g_mapInitialVirtualFiles = new Map(g_mapVirtualFiles);
const g_vecInitialPluginDirectoryNames = [...g_setPluginDirectoryNames];
const g_vecInitialDisabledPluginNames = [...g_setDisabledPluginNames];
const g_vecInitialLoadedPluginNames = g_vecLoadedPluginNames.slice();
const g_NativePluginDescriptors = Object.getOwnPropertyDescriptors(g_NativePlugins);
const g_NativeFileSystemDescriptors = Object.getOwnPropertyDescriptors(g_NativeFileSystem);

function RestorePluginFixture() {
	const vecFailures = [];
	for (const [Target, Descriptors] of [[g_NativePlugins, g_NativePluginDescriptors], [g_NativeFileSystem, g_NativeFileSystemDescriptors]]) {
		for (const strName of Object.getOwnPropertyNames(Target)) {
			if (!Object.hasOwn(Descriptors, strName)) {
				try {
					g_Assert.ok(Reflect.deleteProperty(Target, strName), "Temporary plugin manager fixture property must be removable: " + strName);
				} catch (Failure) {
					vecFailures.push(Failure);
				}
			}
		}

		for (const strName of Object.keys(Descriptors)) {
			try {
				Object.defineProperty(Target, strName, Descriptors[strName]);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	// Only this in-memory SDK double is reset; real plugin operations are not transactional.
	g_vecLoadedPluginNames.splice(0, g_vecLoadedPluginNames.length, ...g_vecInitialLoadedPluginNames);
	g_mapVirtualFiles.clear();
	for (const [strFilePath, strContents] of g_mapInitialVirtualFiles) {
		g_mapVirtualFiles.set(strFilePath, strContents);
	}

	for (const [setNames, vecInitialNames] of [[g_setPluginDirectoryNames, g_vecInitialPluginDirectoryNames], [g_setDisabledPluginNames, g_vecInitialDisabledPluginNames]]) {
		setNames.clear();
		for (const strName of vecInitialNames) {
			setNames.add(strName);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin manager fixture restoration failed.");
	}
}

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
let g_bPackageCacheOwned = false;

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

function RestoreModuleLoader() {
	Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
}

function RestorePackageCache() {
	if (!g_bPackageCacheOwned) {
		return;
	}

	const vecFailures = [];
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strModulePath), "Temporary plugin manager module cache entry must be removable: " + strModulePath);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
		try {
			Object.defineProperty(require.cache, strModulePath, Descriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin manager module cache restoration failed.");
	}

	g_bPackageCacheOwned = false;
}

let g_RestorePluginManager = null;
let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed plugin manager cache entries must support exact restoration.");
	}

	g_bPackageCacheOwned = true;
	InstallDependency(g_strFileSystemPath, g_NativeFileSystem);
	InstallDependency(g_strPathsModulePath, { DATA_ROOT: g_strDataRootPath, PLUGIN_ROOT: g_strPluginRootPath });
	InstallDependency(g_strPluginsModulePath, LoadActualPluginFacade());

	delete require.cache[g_strPluginManagerPath];
	delete require.cache[g_strPluginInstancePath];
	delete require.cache[g_strPluginInformationPath];

	const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
	g_Module._load = function LoadModule(strRequest) {
		if (strRequest === "filesystem") {
			return require(g_strFileSystemPath);
		}

		if (strRequest === "paths") {
			return require(g_strPathsModulePath);
		}

		if (strRequest === "plugins") {
			return require(g_strPluginsModulePath);
		}

		if (strRequest === "plugins/instance") {
			return require(g_strPluginInstancePath);
		}

		if (strRequest === "plugins/info") {
			return require(g_strPluginInformationPath);
		}

		return g_OriginalModuleLoad.apply(this, arguments);
	};

	const g_PluginManagerModule = require(g_strPluginManagerPath);
	RestoreModuleLoader();

	const {
		PLUGIN_MANAGER,
		InvalidPluginName,
		PluginAlreadyLoaded,
		PluginDisabled,
		PluginError,
		PluginFileNotFoundError,
		PluginLoadError,
		PluginManager,
		PluginNotLoaded,
	} = g_PluginManagerModule;

	const g_PluginManagerDescriptors = Object.getOwnPropertyDescriptors(PLUGIN_MANAGER);
	const g_mapInitialPluginWrappers = new Map(PLUGIN_MANAGER);
	g_RestorePluginManager = () => {
		const vecFailures = [];
		for (const strName of Object.getOwnPropertyNames(PLUGIN_MANAGER)) {
			if (!Object.hasOwn(g_PluginManagerDescriptors, strName)) {
				try {
					g_Assert.ok(Reflect.deleteProperty(PLUGIN_MANAGER, strName), "Temporary plugin manager override must be removable: " + strName);
				} catch (Failure) {
					vecFailures.push(Failure);
				}
			}
		}

		for (const strName of Object.keys(g_PluginManagerDescriptors)) {
			try {
				Object.defineProperty(PLUGIN_MANAGER, strName, g_PluginManagerDescriptors[strName]);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		Map.prototype.clear.call(PLUGIN_MANAGER);
		for (const [strPluginName, PluginInstance] of g_mapInitialPluginWrappers) {
			Map.prototype.set.call(PLUGIN_MANAGER, strPluginName, PluginInstance);
		}

		if (vecFailures.length > 0) {
			throw new AggregateError(vecFailures, "Plugin manager instance restoration failed.");
		}
	};

	const g_vecExpectedExportNames = Object.freeze([
		"PLUGIN_MANAGER",
		"InvalidPluginName",
		"PluginAlreadyLoaded",
		"PluginDisabled",
		"PluginError",
		"PluginFileNotFoundError",
		"PluginLoadError",
		"PluginManager",
		"PluginNotLoaded",
	]);
	g_Assert.deepEqual(Object.keys(g_PluginManagerModule), g_vecExpectedExportNames, "plugins/manager exact exports");
	g_Assert.ok(PLUGIN_MANAGER instanceof PluginManager, "PLUGIN_MANAGER type");
	g_Assert.ok(new InvalidPluginName() instanceof PluginError, "typed errors inherit PluginError.");
	g_Assert.ok(new PluginLoadError() instanceof Error, "PluginError inherits Error.");
	g_Assert.equal(Object.hasOwn(g_PluginManagerModule, "default"), false, "plugins/manager must not expose a default alias.");

	g_vecNativePluginCalls.length = 0;

	g_Assert.equal(PLUGIN_MANAGER.Refresh(), PLUGIN_MANAGER, "refresh result");

	let g_unRefreshNativeCallCount = 0;
	for (const vecNativePluginCall of g_vecNativePluginCalls) {
		if (vecNativePluginCall[0] === "Refresh") {
			g_unRefreshNativeCallCount += 1;
		}
	}

	g_Assert.equal(g_unRefreshNativeCallCount, 0, "refresh must not call an absent native function.");
	g_Assert.equal(PLUGIN_MANAGER.size, g_vecLoadedPluginNames.length, "refresh synchronizes current wrappers.");

	CheckPluginRecordSnapshots(PLUGIN_MANAGER.GetPluginInstance("hello"));
	g_Assert.deepEqual(PLUGIN_MANAGER.PluginNames, g_vecLoadedPluginNames, "plugins getter");

	const g_vecLoadedPluginWrapperNames = [];
	for (const LoadedPlugin of PLUGIN_MANAGER.LoadedPlugins) {
		g_vecLoadedPluginWrapperNames.push(LoadedPlugin.Name);
	}

	g_Assert.deepEqual(g_vecLoadedPluginWrapperNames, g_vecLoadedPluginNames, "LoadedPlugins getter");

	g_Assert.equal(PLUGIN_MANAGER.GetPluginRecordByName("hello").Name, "hello", "Name record lookup");
	g_Assert.equal(PLUGIN_MANAGER.GetPluginRecord(1).Name, g_vecLoadedPluginNames[0], "one-based record lookup");
	g_Assert.throws(() => PLUGIN_MANAGER.GetPluginRecord(0), /positive one-based/, "record index zero rejection");
	g_Assert.throws(() => PLUGIN_MANAGER.RequirePluginRecord(99), PluginNotLoaded, "missing current index rejection");

	{
		const ValidPluginPattern = /^hello$/;
		const mapManager = new PluginManager({ ValidPluginPattern });
		g_Assert.equal(mapManager.ValidPluginPattern, ValidPluginPattern, "constructor retains the supplied expression by identity");
		g_Assert.equal(mapManager.IsValidPluginName("hello"), true, "retained custom expression validates matching names");
		g_Assert.equal(mapManager.IsValidPluginName("metrics"), false, "retained custom expression rejects other names");
		g_Assert.throws(() => new PluginManager({ ValidPluginPattern: undefined }), TypeError, "own undefined pattern does not select the default");

		const InheritedOptions = Object.create({ ValidPluginPattern: /hello/g });
		const mapDefaultManager = new PluginManager(InheritedOptions);
		g_Assert.equal(mapDefaultManager.ValidPluginPattern.global, false, "inherited pattern does not replace the default");
		g_Assert.equal(mapDefaultManager.IsValidPluginName("metrics"), true, "ignored inherited pattern retains ordinary default matching");

		for (const Options of [
			null,
			[],
			() => {},
		]) {
			g_Assert.throws(() => new PluginManager(Options), TypeError, "constructor rejects non-object or array options");
		}
	}

	const g_mapPermissivePluginManager = new PluginManager({ ValidPluginPattern: /.*/ });
	g_Assert.equal(g_mapPermissivePluginManager.IsValidPluginName("hello"), true, "custom valid pattern");
	g_Assert.equal(g_mapPermissivePluginManager.IsValidPluginName("../hello"), false, "custom pattern cannot bypass path safety.");
	g_Assert.equal(g_mapPermissivePluginManager.IsValidPluginName(""), false, "custom patterns cannot permit an empty plugin identity.");

	g_Assert.equal(PLUGIN_MANAGER.IsValidPluginName("hello\n"), false, "default plugin names cannot end with a line break.");

	const g_vecUnsafePluginNameCharacters = [
		"\0",
		"\x01",
		"\t",
		"\n",
		"\r",
		"\x1F",
		"\x7F",
		"\u2028",
		"\u2029",
	];
	for (const strUnsafePluginNameCharacter of g_vecUnsafePluginNameCharacters) {
		const vecUnsafePluginNames = [`${strUnsafePluginNameCharacter}hello`, `hel${strUnsafePluginNameCharacter}lo`, `hello${strUnsafePluginNameCharacter}`];
		for (const strUnsafePluginName of vecUnsafePluginNames) {
			g_Assert.equal(PLUGIN_MANAGER.IsValidPluginName(strUnsafePluginName), false, "default plugin names reject control characters and line separators.");
			g_Assert.equal(g_mapPermissivePluginManager.IsValidPluginName(strUnsafePluginName), false, "custom patterns cannot bypass control-character safety.");
			g_Assert.throws(() => PLUGIN_MANAGER.GetPluginName(strUnsafePluginName), InvalidPluginName, "unsafe names fail before filesystem access.");
		}
	}

	g_Assert.equal(g_mapPermissivePluginManager.IsValidPluginName("hello world"), true, "control-free custom-pattern names remain supported.");

	g_mapPermissivePluginManager.ValidPluginPattern = /hello/g;
	g_Assert.throws(() => g_mapPermissivePluginManager.IsValidPluginName("hello"), TypeError, "live global pattern rejection");

	g_mapPermissivePluginManager.ValidPluginPattern = /hello/y;
	g_Assert.throws(() => g_mapPermissivePluginManager.IsValidPluginName("hello"), TypeError, "live sticky pattern rejection");

	g_mapPermissivePluginManager.ValidPluginPattern = "hello";
	g_Assert.throws(() => g_mapPermissivePluginManager.IsValidPluginName("hello"), TypeError, "live non-RegExp rejection");

	g_Assert.equal(PLUGIN_MANAGER.GetPluginName("hello"), "hello", "GetPluginName");
	g_Assert.throws(() => PLUGIN_MANAGER.AssertValidPluginName("../hello"), InvalidPluginName, "AssertValidPluginName path rejection");

	g_Assert.equal(PLUGIN_MANAGER.PluginExists("disabled"), true, "disabled disk plugin exists.");
	g_Assert.equal(PLUGIN_MANAGER.PluginExists("missing"), false, "missing disk plugin");
	g_Assert.equal(PLUGIN_MANAGER.GetPluginDirectory("disabled"), `${g_strPluginRootPath}/disabled`, "unloaded disk directory");
	g_Assert.equal(PLUGIN_MANAGER.GetPluginFilePath("nested"), `${g_strPluginRootPath}/nested/dist/main.js`, "relative nested entry");
	g_Assert.throws(() => PLUGIN_MANAGER.PluginExists("escape"), PluginLoadError, "entry path traversal rejection");

	const g_OriginalDoesFileExist = g_NativeFileSystem.DoesFileExist;
	const g_strDisabledPluginDirectory = `${g_strPluginRootPath}/disabled`;
	const g_strDisabledPluginManifestPath = `${g_strDisabledPluginDirectory}/plugin.json`;
	const g_strDisabledPluginFilePath = GetPluginEntryPath("disabled");
	const g_strHelloPluginFilePath = GetPluginEntryPath("hello");
	let g_strNonBooleanFileSystemResultPath = g_strPluginStatePath;

	try {
		g_NativeFileSystem.DoesFileExist = (strRequestedFilePath) => {
			if (strRequestedFilePath === g_strNonBooleanFileSystemResultPath) {
				return "yes";
			}

			return DoesFileExist(strRequestedFilePath);
		};

		g_Assert.throws(() => PLUGIN_MANAGER.IsPluginEnabled("disabled"), PluginLoadError, "non-boolean plugin state file result rejection");

		g_strNonBooleanFileSystemResultPath = g_strDisabledPluginDirectory;
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginDirectory("disabled"), PluginLoadError, "non-boolean plugin directory result rejection");

		g_strNonBooleanFileSystemResultPath = g_strDisabledPluginManifestPath;
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginFilePath("disabled"), PluginLoadError, "non-boolean plugin manifest result rejection");

		g_strNonBooleanFileSystemResultPath = g_strDisabledPluginFilePath;
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginFilePath("disabled"), PluginLoadError, "non-boolean plugin entry result rejection");

		g_strNonBooleanFileSystemResultPath = g_strHelloPluginFilePath;
		g_Assert.throws(() => PLUGIN_MANAGER.PluginExists("hello"), PluginLoadError, "non-boolean file result rejection");

		const PluginFileSystemError = new Error("Plugin filesystem failure.");
		g_NativeFileSystem.DoesFileExist = (strRequestedFilePath) => {
			if (strRequestedFilePath === g_strHelloPluginFilePath) {
				throw PluginFileSystemError;
			}

			return DoesFileExist(strRequestedFilePath);
		};

		g_Assert.throws(() => PLUGIN_MANAGER.PluginExists("hello"), (CaughtPluginFileSystemError) => CaughtPluginFileSystemError === PluginFileSystemError, "filesystem error identity");
	} finally {
		g_NativeFileSystem.DoesFileExist = g_OriginalDoesFileExist;
	}

	const g_DisabledPluginInformation = PLUGIN_MANAGER.GetPluginInfo("disabled");
	g_Assert.equal(g_DisabledPluginInformation.Loaded, false, "unloaded info state");
	g_Assert.equal(g_DisabledPluginInformation.Enabled, false, "disabled info state");
	g_Assert.equal(g_DisabledPluginInformation.Index, -1, "unloaded info index");
	g_Assert.equal(PLUGIN_MANAGER.IsPluginEnabled("disabled"), false, "realtime disabled state");

	g_mapVirtualFiles.set(g_strPluginStatePath, JSON.stringify({ Disabled: [] }));
	g_Assert.equal(PLUGIN_MANAGER.IsPluginEnabled("disabled"), true, "enabled state rereads PluginsState.json.");
	WritePluginState();

	const g_OriginalNativePluginRecords = g_NativePlugins.GetPluginRecords;
	const g_MalformedDirectoryPluginRecord = CopyCurrentPluginRecords()[0];
	g_MalformedDirectoryPluginRecord.Directory = null;

	try {
		const unPluginManagerSizeBeforeMalformedRecords = PLUGIN_MANAGER.size;
		const HelloPluginBeforeMalformedRecords = PLUGIN_MANAGER.get("hello");

		g_NativePlugins.GetPluginRecords = () => ({});
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), PluginLoadError, "non-array plugin records rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "invalid records preserve manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "invalid records preserve wrappers");

		const NonPlainPluginRecord = CopyCurrentPluginRecords()[0];
		Object.setPrototypeOf(NonPlainPluginRecord, { Kind: "custom" });
		g_NativePlugins.GetPluginRecords = () => [NonPlainPluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), PluginLoadError, "non-plain plugin record rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "non-plain record preserves manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "non-plain record preserves wrappers");

		const IncompletePluginRecord = CopyCurrentPluginRecords()[0];
		delete IncompletePluginRecord.Entry;
		g_NativePlugins.GetPluginRecords = () => [IncompletePluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), (CaughtPluginRecordError) => (CaughtPluginRecordError instanceof PluginLoadError) && (CaughtPluginRecordError.message === 'plugins.GetPluginRecords() returned a plugin record without "Entry".'), "missing own plugin record field rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "incomplete record preserves manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "incomplete record preserves wrappers");

		const vecDuplicatePluginRecords = CopyCurrentPluginRecords();
		vecDuplicatePluginRecords.push(vecDuplicatePluginRecords[0]);
		g_NativePlugins.GetPluginRecords = () => vecDuplicatePluginRecords;
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), PluginLoadError, "duplicate plugin records rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "duplicate records preserve manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "duplicate records preserve wrappers");

		const vecDuplicatePluginIndexRecords = CopyCurrentPluginRecords();
		vecDuplicatePluginIndexRecords[1].Index = vecDuplicatePluginIndexRecords[0].Index;
		g_NativePlugins.GetPluginRecords = () => vecDuplicatePluginIndexRecords;
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), PluginLoadError, "duplicate plugin record index rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "duplicate index preserves manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "duplicate index preserves wrappers");

		const MalformedNamePluginRecord = CopyCurrentPluginRecords()[0];
		MalformedNamePluginRecord.Name = null;
		g_NativePlugins.GetPluginRecords = () => [MalformedNamePluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginInstance(1), PluginLoadError, "invalid plugin record name rejection");

		const OneReadDirectoryPluginRecord = CopyCurrentPluginRecords()[0];
		const strExpectedPluginDirectory = OneReadDirectoryPluginRecord.Directory;
		let unPluginDirectoryReadCount = 0;
		Object.defineProperty(OneReadDirectoryPluginRecord, "Directory", {
			configurable: true,
			enumerable: true,
			get() {
				unPluginDirectoryReadCount++;

				return (unPluginDirectoryReadCount === 1) ? strExpectedPluginDirectory : null;
			},
		});
		g_NativePlugins.GetPluginRecords = () => [OneReadDirectoryPluginRecord];
		g_Assert.equal(PLUGIN_MANAGER.GetPluginDirectory("hello"), strExpectedPluginDirectory, "directory result from one read");
		g_Assert.equal(unPluginDirectoryReadCount, 1, "directory read count");

		g_NativePlugins.GetPluginRecords = () => [g_MalformedDirectoryPluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginDirectory("hello"), PluginLoadError, "invalid plugin record directory rejection");
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), PluginLoadError, "invalid sync record directory rejection");
		g_Assert.equal(PLUGIN_MANAGER.size, unPluginManagerSizeBeforeMalformedRecords, "invalid sync preserves manager size");
		g_Assert.equal(PLUGIN_MANAGER.get("hello"), HelloPluginBeforeMalformedRecords, "invalid sync preserves wrappers");

		const MalformedEntryPluginRecord = CopyCurrentPluginRecords()[0];
		MalformedEntryPluginRecord.Entry = null;
		g_NativePlugins.GetPluginRecords = () => [MalformedEntryPluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginFilePath("hello"), PluginLoadError, "invalid plugin record entry rejection");

		const OneReadEntryPluginRecord = CopyCurrentPluginRecords()[0];
		const strExpectedPluginEntryPath = OneReadEntryPluginRecord.Entry;
		let unPluginEntryReadCount = 0;
		Object.defineProperty(OneReadEntryPluginRecord, "Entry", {
			configurable: true,
			enumerable: true,
			get() {
				unPluginEntryReadCount++;

				return (unPluginEntryReadCount === 1) ? strExpectedPluginEntryPath : null;
			},
		});
		g_NativePlugins.GetPluginRecords = () => [OneReadEntryPluginRecord];
		g_Assert.equal(PLUGIN_MANAGER.GetPluginFilePath("hello"), strExpectedPluginEntryPath, "entry path result from one read");
		g_Assert.equal(unPluginEntryReadCount, 1, "entry path read count");

		const OneReadLoadedPluginRecord = CopyCurrentPluginRecords()[0];
		let unPluginLoadedReadCount = 0;
		Object.defineProperty(OneReadLoadedPluginRecord, "Loaded", {
			configurable: true,
			enumerable: true,
			get() {
				unPluginLoadedReadCount++;

				return unPluginLoadedReadCount === 1;
			},
		});
		g_NativePlugins.GetPluginRecords = () => [OneReadLoadedPluginRecord];
		g_Assert.equal(PLUGIN_MANAGER.IsPluginLoaded("hello"), true, "loaded state result from one read");
		g_Assert.equal(unPluginLoadedReadCount, 1, "loaded state read count");

		unPluginLoadedReadCount = 0;
		g_Assert.equal(PLUGIN_MANAGER.GetPluginInstance("hello"), HelloPluginBeforeMalformedRecords, "plugin instance from one loaded-state read");
		g_Assert.equal(unPluginLoadedReadCount, 1, "plugin instance loaded-state read count");

		const OneReadEnabledPluginRecord = CopyCurrentPluginRecords()[0];
		let unPluginEnabledReadCount = 0;
		Object.defineProperty(OneReadEnabledPluginRecord, "Enabled", {
			configurable: true,
			enumerable: true,
			get() {
				unPluginEnabledReadCount++;

				return unPluginEnabledReadCount === 1;
			},
		});
		g_NativePlugins.GetPluginRecords = () => [OneReadEnabledPluginRecord];
		g_Assert.equal(PLUGIN_MANAGER.IsPluginEnabled("hello"), true, "enabled state result from one read");
		g_Assert.equal(unPluginEnabledReadCount, 1, "enabled state read count");

		const MalformedLoadedPluginRecord = CopyCurrentPluginRecords()[0];
		MalformedLoadedPluginRecord.Loaded = 1;
		g_NativePlugins.GetPluginRecords = () => [MalformedLoadedPluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.IsPluginLoaded("hello"), PluginLoadError, "non-boolean loaded state rejection");

		const MalformedEnabledPluginRecord = CopyCurrentPluginRecords()[0];
		MalformedEnabledPluginRecord.Enabled = 1;
		g_NativePlugins.GetPluginRecords = () => [MalformedEnabledPluginRecord];
		g_Assert.throws(() => PLUGIN_MANAGER.IsPluginEnabled("hello"), PluginLoadError, "non-boolean enabled state rejection");
	} finally {
		g_NativePlugins.GetPluginRecords = g_OriginalNativePluginRecords;
	}

	const g_OriginalCreatePluginInstance = PLUGIN_MANAGER.CreatePluginInstance;
	const g_HelloPluginBeforeStagingFailure = PLUGIN_MANAGER.get("hello");
	const g_MetricsPluginBeforeStagingFailure = PLUGIN_MANAGER.get("metrics");
	const g_PendingPluginCreationError = new Error("Pending plugin creation failure.");

	g_Assert.equal(PLUGIN_MANAGER.delete("hello"), true, "staging fixture removes the current hello wrapper");
	g_Assert.equal(PLUGIN_MANAGER.delete("metrics"), true, "staging fixture removes the current metrics wrapper");
	PLUGIN_MANAGER.CreatePluginInstance = function CreatePluginInstanceWithFailure(strPluginName) {
		if (strPluginName === "metrics") {
			throw g_PendingPluginCreationError;
		}

		return g_OriginalCreatePluginInstance.call(this, strPluginName);
	};

	try {
		g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), (CaughtPendingPluginCreationError) => CaughtPendingPluginCreationError === g_PendingPluginCreationError, "pending plugin creation error identity");
		g_Assert.equal(PLUGIN_MANAGER.has("hello"), false, "failed staging does not commit an earlier wrapper");
		g_Assert.equal(PLUGIN_MANAGER.has("metrics"), false, "failed staging does not commit the failed wrapper");
	} finally {
		delete PLUGIN_MANAGER.CreatePluginInstance;
		PLUGIN_MANAGER.set("hello", g_HelloPluginBeforeStagingFailure);
		PLUGIN_MANAGER.set("metrics", g_MetricsPluginBeforeStagingFailure);
	}

	g_Assert.throws(() => PLUGIN_MANAGER.LoadPlugin("hello"), PluginAlreadyLoaded, "already-loaded error");
	g_Assert.throws(() => PLUGIN_MANAGER.LoadPlugin("missing"), PluginFileNotFoundError, "missing-file error");
	g_Assert.throws(() => PLUGIN_MANAGER.LoadPlugin("disabled"), PluginDisabled, "disabled error");
	g_Assert.throws(() => PLUGIN_MANAGER.LoadPlugin("failing"), PluginLoadError, "native load error");

	const g_HelloPluginBeforeInvalidFactory = PLUGIN_MANAGER.get("hello");

	g_Assert.equal(PLUGIN_MANAGER.delete("hello"), true, "invalid-factory fixture removes the current hello wrapper");
	PLUGIN_MANAGER.CreatePluginInstance = function CreateInvalidPluginInstance() {
		return {};
	};

	try {
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginInstance("hello"), TypeError, "invalid lazy wrapper rejection");
		g_Assert.equal(PLUGIN_MANAGER.has("hello"), false, "invalid lazy wrapper is not committed");
	} finally {
		delete PLUGIN_MANAGER.CreatePluginInstance;
		PLUGIN_MANAGER.set("hello", g_HelloPluginBeforeInvalidFactory);
	}

	const g_SharedHelloPlugin = PLUGIN_MANAGER.GetPluginInstance("hello");
	const g_DirectHelloPlugin = PLUGIN_MANAGER.CreatePluginInstance("hello");
	g_Assert.equal(g_SharedHelloPlugin, PLUGIN_MANAGER.GetPluginInstance("hello"), "manager wrapper identity");
	g_Assert.notEqual(g_SharedHelloPlugin, g_DirectHelloPlugin, "direct wrapper is not inserted.");

	Object.defineProperty(g_SharedHelloPlugin, "Info", { configurable: true, value: {} });

	try {
		g_Assert.throws(() => PLUGIN_MANAGER.GetPluginInfo("hello"), TypeError, "invalid managed plugin information rejection");
	} finally {
		delete g_SharedHelloPlugin.Info;
	}

	PLUGIN_MANAGER.set("hello", {});
	g_Assert.throws(() => PLUGIN_MANAGER.GetPluginInstance("hello"), TypeError, "invalid managed wrapper rejection");
	g_Assert.throws(() => PLUGIN_MANAGER.SyncPluginInstances(), TypeError, "invalid synchronized wrapper rejection");
	PLUGIN_MANAGER.set("hello", g_SharedHelloPlugin);

	const g_ReloadedHelloPlugin = PLUGIN_MANAGER.ReloadPlugin("hello");
	g_Assert.notEqual(g_ReloadedHelloPlugin, g_SharedHelloPlugin, "reload replaces manager wrapper.");
	g_Assert.equal(PLUGIN_MANAGER.GetPluginInstance("hello"), g_ReloadedHelloPlugin, "reload stores replacement wrapper.");

	const g_unMetricsPluginIndex = PLUGIN_MANAGER.GetPluginRecordByName("metrics").Index;
	g_Assert.equal(PLUGIN_MANAGER.UnloadPlugin(g_unMetricsPluginIndex), true, "numeric unload");
	g_Assert.throws(() => PLUGIN_MANAGER.RequirePluginRecord("metrics"), PluginNotLoaded, "disk plugin without context");

	g_Assert.equal(PLUGIN_MANAGER.LoadPlugin("metrics").Name, "metrics", "load restores unloaded plugin.");

	const g_unManifestlessPluginIndex = PLUGIN_MANAGER.GetPluginRecordByName("manifestless").Index;
	g_Assert.equal(PLUGIN_MANAGER.DisablePlugin(g_unManifestlessPluginIndex), true, "numeric disable");
	g_Assert.equal(PLUGIN_MANAGER.IsPluginLoaded("manifestless"), false, "disabled plugin unloaded.");
	g_Assert.equal(PLUGIN_MANAGER.IsPluginEnabled("manifestless"), false, "disabled state persisted.");
	g_Assert.equal(PLUGIN_MANAGER.PluginExists("manifestless"), true, "disabled entry remains on disk.");

	g_Assert.equal(PLUGIN_MANAGER.EnablePlugin("manifestless").Name, "manifestless", "enable returns current wrapper.");

	g_Assert.equal(PLUGIN_MANAGER.UnloadPlugin("metrics"), true, "unload metrics before name disable");
	g_Assert.equal(PLUGIN_MANAGER.DisablePlugin("metrics"), true, "name disable works without a current record.");

	g_Assert.equal(PLUGIN_MANAGER.EnablePlugin("metrics").Name, "metrics", "name enable restores unloaded disk plugin.");

	g_mapVirtualFiles.set(g_strPluginStatePath, "{");
	g_Assert.equal(PLUGIN_MANAGER.UnloadPlugin("metrics"), true, "unload metrics before malformed state");
	g_Assert.throws(() => PLUGIN_MANAGER.IsPluginEnabled("metrics"), PluginLoadError, "malformed state rejection");

	WritePluginState();
	g_Assert.equal(PLUGIN_MANAGER.LoadPlugin("metrics").Name, "metrics", "state recovery");

	const g_OriginalNativeUnloadAll = g_NativePlugins.UnloadAllPlugins;

	try {
		g_NativePlugins.UnloadAllPlugins = () => {
			g_vecNativePluginCalls.push(["UnloadAllPlugins"]);

			const nLoadedMetricsPluginIndex = g_vecLoadedPluginNames.indexOf("metrics");
			g_Assert.notEqual(nLoadedMetricsPluginIndex, -1, "metrics plugin exists before partial UnloadAllPlugins");
			g_vecLoadedPluginNames.splice(nLoadedMetricsPluginIndex, 1);

			return false;
		};

		g_Assert.throws(() => PLUGIN_MANAGER.UnloadAllPlugins(), PluginLoadError, "partial UnloadAllPlugins rejection");
		g_Assert.equal(PLUGIN_MANAGER.has("metrics"), false, "partial UnloadAllPlugins removes stale wrappers.");
		g_Assert.equal(PLUGIN_MANAGER.size, g_vecLoadedPluginNames.length, "partial UnloadAllPlugins retains current wrappers.");
	} finally {
		g_NativePlugins.UnloadAllPlugins = g_OriginalNativeUnloadAll;
	}

	g_Assert.equal(PLUGIN_MANAGER.UnloadAllPlugins(), true, "UnloadAllPlugins result");
	g_Assert.equal(PLUGIN_MANAGER.size, 0, "UnloadAllPlugins clears wrappers.");

	const g_OriginalNativeReloadAll = g_NativePlugins.ReloadAllPlugins;

	try {
		g_NativePlugins.ReloadAllPlugins = () => {
			g_vecNativePluginCalls.push(["ReloadAllPlugins"]);
			g_Assert.equal(LoadNativePlugin("hello"), true, "partial-reload fixture loads hello before returning failure");

			return false;
		};

		g_Assert.throws(() => PLUGIN_MANAGER.ReloadAllPlugins(), PluginLoadError, "partial ReloadAllPlugins rejection");
		g_Assert.equal(PLUGIN_MANAGER.has("hello"), true, "partial ReloadAllPlugins retains current wrappers.");
		g_Assert.equal(PLUGIN_MANAGER.size, g_vecLoadedPluginNames.length, "partial ReloadAllPlugins synchronizes wrappers.");
	} finally {
		g_NativePlugins.ReloadAllPlugins = g_OriginalNativeReloadAll;
	}

	g_Assert.equal(PLUGIN_MANAGER.ReloadAllPlugins(), true, "ReloadAllPlugins result");
	g_Assert.equal(PLUGIN_MANAGER.size, g_vecLoadedPluginNames.length, "ReloadAllPlugins synchronizes wrappers.");

	const g_strPluginManagerDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecPluginManagerDocumentationCodeBlocks = [];
	for (const vecPluginManagerDocumentationCodeBlockMatch of g_strPluginManagerDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecPluginManagerDocumentationCodeBlocks.push(vecPluginManagerDocumentationCodeBlockMatch[1]);
	}

	function RequirePluginManagerDocumentationModule(strDocumentationModuleRequest) {
		if (strDocumentationModuleRequest === "plugins/manager") {
			return g_PluginManagerModule;
		}

		throw new Error(`unexpected plugins/manager documentation module ${strDocumentationModuleRequest}`);
	}

	g_Assert.equal(g_vecPluginManagerDocumentationCodeBlocks.length, 10, "plugins/manager documentation workflow count");
	g_Assert.ok(!g_strPluginManagerDocumentation.includes("Generated by"), "plugins/manager documentation must be maintained by hand.");
	g_Assert.ok(g_strPluginManagerDocumentation.includes("There is no unloaded discovery list"), "plugins/manager docs must reject discovery snapshots.");
	g_Assert.ok(g_strPluginManagerDocumentation.includes("does not call a nonexistent native refresh function"), "plugins/manager docs must describe refresh ownership.");
	g_Assert.ok(g_strPluginManagerDocumentation.includes("reads `PluginsState.json` at call time"), "plugins/manager docs must describe realtime enabled state.");
	g_Assert.ok(g_strPluginManagerDocumentation.includes("can destroy one or more V8 contexts synchronously"), "plugins/manager docs must describe destructive lifecycle ownership.");
	g_Assert.ok(!g_strPluginManagerDocumentation.includes("console."), "plugins/manager documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strPluginManagerDocumentation), "plugins/manager documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strPluginManagerDocumentation);
	VerifyDocumentationLinks(g_strPluginManagerDocumentation);

	g_vecNativePluginCalls.length = 0;
	g_vecNativeFileSystemCalls.length = 0;

	const g_unDocumentationTimeoutMilliseconds = 1000;
	const g_RunDocumentationWorkflows = () => {
		const vecPluginManagerDocumentationModuleExports = [];
		let unPluginManagerDocumentationCodeBlockIndex = 0;
		for (const strPluginManagerDocumentationCodeBlock of g_vecPluginManagerDocumentationCodeBlocks) {
			const strFileName = g_strDocumentationPath + ":" + (unPluginManagerDocumentationCodeBlockIndex + 1);
			const PluginManagerDocumentationModuleRecord = new g_Module(strFileName, module);
			PluginManagerDocumentationModuleRecord.filename = strFileName;
			PluginManagerDocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
			PluginManagerDocumentationModuleRecord.require = RequirePluginManagerDocumentationModule;
			PluginManagerDocumentationModuleRecord._compile(strPluginManagerDocumentationCodeBlock, strFileName);
			vecPluginManagerDocumentationModuleExports.push(PluginManagerDocumentationModuleRecord.exports);
			unPluginManagerDocumentationCodeBlockIndex++;
		}

		g_Assert.equal(g_vecNativePluginCalls.length, 0, "plugins/manager examples must not query or mutate native plugins during block load.");
		g_Assert.equal(g_vecNativeFileSystemCalls.length, 0, "plugins/manager examples must not query plugin files during block load.");
		g_Assert.deepEqual(Object.keys(vecPluginManagerDocumentationModuleExports[0]), [], "documented import block has no workflow export");

		const DocumentedCurrentPluginState = vecPluginManagerDocumentationModuleExports[1].InspectCurrentPlugins();
		const vecDocumentedCurrentPluginRecordNames = [];
		for (const DocumentedCurrentPluginRecord of DocumentedCurrentPluginState.Records) {
			vecDocumentedCurrentPluginRecordNames.push(DocumentedCurrentPluginRecord.Name);
		}

		g_Assert.equal(DocumentedCurrentPluginState.ManagerIdentity, true, "documented current manager identity");
		g_Assert.deepEqual(DocumentedCurrentPluginState.Names, g_vecLoadedPluginNames, "documented current names");
		g_Assert.deepEqual(vecDocumentedCurrentPluginRecordNames, g_vecLoadedPluginNames, "documented current records");
		g_Assert.deepEqual(DocumentedCurrentPluginState.Wrappers, g_vecLoadedPluginNames, "documented current wrappers");

		const vecDocumentedPluginNameValidationResults = vecPluginManagerDocumentationModuleExports[2].ValidatePluginNames(["match-tools", "MatchTools", "../match-tools"]);
		const vecDocumentedPluginNameValidityFlags = [];
		for (const DocumentedPluginNameValidationResult of vecDocumentedPluginNameValidationResults) {
			vecDocumentedPluginNameValidityFlags.push(DocumentedPluginNameValidationResult.Valid);
		}

		g_Assert.deepEqual(vecDocumentedPluginNameValidityFlags, [true, false, false], "documented plugin-name validation");
		g_Assert.equal(vecDocumentedPluginNameValidationResults[0].Name, "match-tools", "documented validated plugin name");
		g_Assert.equal(vecDocumentedPluginNameValidationResults[0].Error, null, "documented valid-name error state");
		g_Assert.match(vecDocumentedPluginNameValidationResults[1].Error, /invalid plugin name/, "documented pattern rejection");
		g_Assert.match(vecDocumentedPluginNameValidationResults[2].Error, /invalid plugin name/, "documented path rejection");

		const DocumentedHelloPluginInformation = vecPluginManagerDocumentationModuleExports[3].InspectDiskPlugin("hello");
		const DocumentedManifestlessPluginInformation = vecPluginManagerDocumentationModuleExports[3].InspectDiskPlugin("manifestless");
		g_Assert.equal(DocumentedHelloPluginInformation.FilePath, `${g_strPluginRootPath}/hello/index.js`, "documented manifest entry");
		g_Assert.equal(DocumentedHelloPluginInformation.Version, "1.0.0", "documented manifest version");
		g_Assert.equal(DocumentedManifestlessPluginInformation.FilePath, `${g_strPluginRootPath}/manifestless/index.js`, "documented default entry");
		g_Assert.equal(DocumentedManifestlessPluginInformation.Version, "unversioned", "documented manifest-less version");
		g_Assert.equal(vecPluginManagerDocumentationModuleExports[3].InspectDiskPlugin("missing"), null, "documented missing disk plugin");

		const DocumentedSharedHelloPluginWrapper = vecPluginManagerDocumentationModuleExports[4].InspectWrapperIdentity("hello");
		const DocumentedUnloadedPluginWrapper = vecPluginManagerDocumentationModuleExports[4].InspectWrapperIdentity("disabled");
		g_Assert.equal(DocumentedSharedHelloPluginWrapper.Loaded, true, "documented loaded shared wrapper");
		g_Assert.equal(DocumentedSharedHelloPluginWrapper.SharedIdentity, true, "documented stable shared wrapper");
		g_Assert.equal(DocumentedSharedHelloPluginWrapper.DirectIsShared, false, "documented direct wrapper identity");
		g_Assert.equal(DocumentedUnloadedPluginWrapper.Loaded, false, "documented unloaded wrapper state");
		g_Assert.equal(DocumentedUnloadedPluginWrapper.SharedName, null, "documented absent shared wrapper");

		g_Assert.equal(vecPluginManagerDocumentationModuleExports[5].CyclePluginLoadedState("hello"), "hello", "documented load-unload workflow");

		g_Assert.equal(vecPluginManagerDocumentationModuleExports[6].ReloadPlugin("hello"), "hello", "documented reload workflow");

		g_Assert.equal(vecPluginManagerDocumentationModuleExports[7].CyclePluginEnabledState("hello"), "hello", "documented disable-enable workflow");

		const DocumentedPluginRestartResult = vecPluginManagerDocumentationModuleExports[8].RestartAllPlugins();
		g_Assert.equal(DocumentedPluginRestartResult.NamesBefore.includes("hello"), true, "documented restart captures prior names");
		g_Assert.deepEqual(DocumentedPluginRestartResult.NamesNow, g_vecLoadedPluginNames, "documented restart current names");
		g_Assert.deepEqual(DocumentedPluginRestartResult.Wrappers, g_vecLoadedPluginNames, "documented restart wrappers");

		const DocumentedPluginLifecycleErrors = vecPluginManagerDocumentationModuleExports[9].InspectPluginLifecycleErrors("hello");
		g_Assert.match(DocumentedPluginLifecycleErrors.AlreadyLoadedMessage, /already loaded/, "documented already-loaded error");
		g_Assert.match(DocumentedPluginLifecycleErrors.NotLoadedMessage, /not loaded/, "documented not-loaded error");

		{
			const OriginalLoadPlugin = PLUGIN_MANAGER.LoadPlugin;
			const OriginalRequirePluginRecord = PLUGIN_MANAGER.RequirePluginRecord;
			const LoadPluginDescriptor = Object.getOwnPropertyDescriptor(PLUGIN_MANAGER, "LoadPlugin");
			const RequireRecordDescriptor = Object.getOwnPropertyDescriptor(PLUGIN_MANAGER, "RequirePluginRecord");
			const vecFailurePairs = [
				{ Lookup: new Error("record query failed"), Restoration: new Error("restoration failed") },
				{ Lookup: null, Restoration: undefined },
				{ Lookup: undefined, Restoration: null },
			];

			function RestoreMethod(strMethodName, Descriptor) {
				if (Descriptor === undefined) {
					g_Assert.equal(Reflect.deleteProperty(PLUGIN_MANAGER, strMethodName), true, "temporary manager override is removable");
					return;
				}

				Object.defineProperty(PLUGIN_MANAGER, strMethodName, Descriptor);
			}

			for (const bFailRestoration of [false, true]) {
				for (const FailurePair of vecFailurePairs) {
					let bRecordLookupAttempted = false;
					let bFailureCaught = false;
					PLUGIN_MANAGER.RequirePluginRecord = function RequireOrFailRecordLookup(PluginSelector) {
						if (PLUGIN_MANAGER.IsPluginLoaded(PluginSelector)) {
							return Reflect.apply(OriginalRequirePluginRecord, this, [PluginSelector]);
						}

						bRecordLookupAttempted = true;
						throw FailurePair.Lookup;
					};

					PLUGIN_MANAGER.LoadPlugin = function LoadOrFailRestoration(strPluginName) {
						if (bRecordLookupAttempted && bFailRestoration) {
							throw FailurePair.Restoration;
						}

						return Reflect.apply(OriginalLoadPlugin, this, [strPluginName]);
					};

					try {
						vecPluginManagerDocumentationModuleExports[9].InspectPluginLifecycleErrors("hello");
					} catch (CaughtFailure) {
						bFailureCaught = true;

						if (bFailRestoration) {
							g_Assert.ok(CaughtFailure instanceof AggregateError, "record and restoration failures are aggregated");
							g_Assert.deepEqual(CaughtFailure.errors, [FailurePair.Lookup, FailurePair.Restoration], "original failure order and thrown values are preserved");
						} else {
							g_Assert.equal(CaughtFailure, FailurePair.Lookup, "successful restoration preserves the original query failure");
						}
					} finally {
						RestoreMethod("RequirePluginRecord", RequireRecordDescriptor);
						RestoreMethod("LoadPlugin", LoadPluginDescriptor);

						if (!PLUGIN_MANAGER.IsPluginLoaded("hello")) {
							// LoadPlugin throws on failure; cleanup needs loaded state, not the returned wrapper.
							Reflect.apply(OriginalLoadPlugin, PLUGIN_MANAGER, ["hello"]);
						}
					}

					g_Assert.equal(bRecordLookupAttempted, true, "fault probe reaches the documented record check");
					g_Assert.equal(bFailureCaught, true, "unexpected record-check failure always propagates");
				}
			}
		}

		g_Assert.equal(PLUGIN_MANAGER.IsPluginLoaded("hello"), true, "documentation restores hello.");
		g_Assert.equal(PLUGIN_MANAGER.IsPluginEnabled("hello"), true, "documentation restores hello enabled state.");
		g_Assert.equal(PLUGIN_MANAGER.size, g_vecLoadedPluginNames.length, "documentation leaves synchronized wrappers.");

		const strPluginManagerPackageSource = g_FileSystem.readFileSync(g_strPluginManagerPath, "utf8");
		for (const strRequiredPluginManagerPackageContract of [
			'const g_PathsRuntime = require("paths")',
			'const strPluginStateFilePath = JoinPluginPath(g_PathsRuntime.DATA_ROOT, "PluginsState.json")',
			"PluginSelector > 0",
			"IsFilesystemSafePluginName(strPluginName)",
			"ReadDisabledPluginNames().has(PluginSelector)",
			"GetPluginEntryPath(strPluginDirectory, strPluginEntry)",
			"const PluginInstance = this.GetPluginInstance(strPluginName)",
		]) {
			g_Assert.ok(strPluginManagerPackageSource.includes(strRequiredPluginManagerPackageContract), `plugins/manager contract missing: ${strRequiredPluginManagerPackageContract}`);
		}

		g_Assert.ok(!strPluginManagerPackageSource.includes("plugins.refresh()"), "plugins/manager must not call an absent native API.");

		const strNativePluginManagerSource = g_FileSystem.readFileSync(g_strNativePluginManagerPath, "utf8");
		for (const strRequiredNativePluginManagerContract of [
			"bool IsValidPluginName(std::string const& strName)",
			"PathRelativeEntry.has_root_path()",
			'if (*itPath == "..")',
			"itDirectory->is_directory(ErrorCode) && IsValidPluginName(strName)",
		]) {
			g_Assert.ok(strNativePluginManagerSource.includes(strRequiredNativePluginManagerContract), `native PluginManager path contract missing: ${strRequiredNativePluginManagerContract}`);
		}

		for (const strRelatedPluginManagerDocumentationFileName of [
			"filesystem.md",
			"paths.md",
			"plugins-command.md",
			"plugins-info.md",
			"plugins-instance.md",
			"plugins.md",
		]) {
			g_Assert.ok(g_FileSystem.existsSync(g_Path.join(g_strRepositoryRootPath, "docs", "api", strRelatedPluginManagerDocumentationFileName)), `plugins/manager related documentation missing: ${strRelatedPluginManagerDocumentationFileName}`);
		}
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	const vecCleanupFailures = [];
	for (const Cleanup of [RestoreModuleLoader, g_RestorePluginManager, RestorePluginFixture, RestorePackageCache]) {
		if (Cleanup === null) {
			continue;
		}

		try {
			Cleanup();
		} catch (Failure) {
			vecCleanupFailures.push(Failure);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, ...vecCleanupFailures] : vecCleanupFailures, "Plugin manager smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_plugins_manager");
