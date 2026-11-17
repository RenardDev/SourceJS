#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPluginsPath = g_Path.join(g_strPackageRootPath, "plugins.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strPluginManagerPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "PluginManager.cpp");
const g_strV8RuntimePath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp");
const g_strPluginRootPath = g_Path.join(g_strRepositoryRootPath, "runtime", "addons", "sourcejs", "plugins");
const g_unMaximumPluginSelectorIndex = 4294967295;
const g_unDocumentationBlockCount = 8;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { Lifecycle: 0, Import: 1, Inspect: 2, Load: 3, Reload: 4, Enabled: 5, Loaded: 6, Restart: 7 };

let g_LifecycleOwner = null;

// This virtual plugin directory and registry are SDK-double data, never a disk installation.
const g_mapDiskPlugins = new Map([
	["hello", "index.js"],
	["metrics", "main.js"],
]);

const g_setDisabledNames = new Set();
const g_setAutoloadDisabledNames = new Set();
const g_setFailingPluginNames = new Set();
const g_vecLoadedRecords = [];
const g_vecDiskLoadAttempts = [];
const g_vecNativeCalls = [];
const g_vecLogMessages = [];

function CreateHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContents = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Plugin Layout/);
	g_Assert.ok(vecContents, "plugins contents section");

	const vecDocumentedAnchors = [...vecContents[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => CreateHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinks = [...strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);

	for (const strTarget of vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `plugins documentation link must exist: ${strTarget}`);
	}
}

function MakeRecord(strPluginName) {
	const strDirectoryPath = g_Path.join(g_strPluginRootPath, strPluginName);

	return { Directory: strDirectoryPath, Enabled: true, Entry: g_Path.join(strDirectoryPath, g_mapDiskPlugins.get(strPluginName)), Loaded: true, Name: strPluginName };
}

function LoadFromDisk(strPluginName) {
	g_vecDiskLoadAttempts.push(strPluginName);

	if (/^\d+$/.test(strPluginName) || !g_mapDiskPlugins.has(strPluginName) || g_setDisabledNames.has(strPluginName) || g_setFailingPluginNames.has(strPluginName)) {
		return false;
	}

	if (!g_vecLoadedRecords.some((PluginRecord) => PluginRecord.Name === strPluginName)) {
		g_vecLoadedRecords.push(MakeRecord(strPluginName));
	}

	return true;
}

function LoadAllFromDisk() {
	for (const strPluginName of g_mapDiskPlugins.keys()) {
		if (g_setAutoloadDisabledNames.has(strPluginName)) {
			continue;
		}

		// A failed individual load must not abort this bulk-rescan fixture.
		LoadFromDisk(strPluginName);
	}
}

function RequirePluginName(strPluginName) {
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError("plugins.LoadPlugin(strPluginName) expects a non-empty plugin name string.");
	}

	return strPluginName;
}

function RequirePluginSelector(PluginSelector, strMethodName) {
	if ((typeof PluginSelector === "string") && (PluginSelector.length > 0)) {
		return PluginSelector;
	}

	if (Number.isInteger(PluginSelector) && (PluginSelector > 0) && (PluginSelector <= g_unMaximumPluginSelectorIndex)) {
		return PluginSelector;
	}

	throw new TypeError(`plugins.${strMethodName}(PluginSelector) expects a non-empty plugin name or positive one-based index.`);
}

function ResolveLoadedPluginIndex(PluginSelector) {
	if (Number.isInteger(PluginSelector)) {
		return PluginSelector - 1;
	}

	if (/^\d+$/.test(PluginSelector)) {
		return Number(PluginSelector) - 1;
	}

	return g_vecLoadedRecords.findIndex((PluginRecord) => PluginRecord.Name === PluginSelector);
}

function RemoveLoadedPluginRecord(PluginSelector) {
	const nLoadedPluginIndex = ResolveLoadedPluginIndex(PluginSelector);
	if ((nLoadedPluginIndex < 0) || (nLoadedPluginIndex >= g_vecLoadedRecords.length)) {
		return null;
	}

	return g_vecLoadedRecords.splice(nLoadedPluginIndex, 1)[0];
}

function CopyLoadedPluginRecords() {
	return g_vecLoadedRecords.map((PluginRecord, unRecordIndex) => ({ ...PluginRecord, Index: unRecordIndex + 1 }));
}

const g_NativePlugins = {
	DisablePlugin(PluginSelector) {
		g_vecNativeCalls.push(["DisablePlugin", PluginSelector]);
		PluginSelector = RequirePluginSelector(PluginSelector, "DisablePlugin");

		const PluginRecord = RemoveLoadedPluginRecord(PluginSelector);
		const strPluginName = PluginRecord?.Name ?? (((typeof PluginSelector === "string") && !/^\d+$/.test(PluginSelector)) ? PluginSelector : "");

		if (!strPluginName || !g_mapDiskPlugins.has(strPluginName)) {
			return false;
		}

		g_setDisabledNames.add(strPluginName);

		return true;
	},

	EnablePlugin(PluginSelector) {
		g_vecNativeCalls.push(["EnablePlugin", PluginSelector]);
		PluginSelector = RequirePluginSelector(PluginSelector, "EnablePlugin");

		const nLoadedPluginIndex = ResolveLoadedPluginIndex(PluginSelector);
		const strPluginName = ((nLoadedPluginIndex >= 0) && (nLoadedPluginIndex < g_vecLoadedRecords.length)) ? g_vecLoadedRecords[nLoadedPluginIndex].Name : (((typeof PluginSelector === "string") && !/^\d+$/.test(PluginSelector)) ? PluginSelector : "");

		if (!strPluginName || !g_mapDiskPlugins.has(strPluginName)) {
			return false;
		}

		g_setDisabledNames.delete(strPluginName);

		return LoadFromDisk(strPluginName);
	},

	List() {
		g_vecNativeCalls.push(["List"]);

		if (g_vecLoadedRecords.length === 0) {
			return ["No plugins loaded."];
		}

		return CopyLoadedPluginRecords().map((PluginRecord) => `${PluginRecord.Index}. ${PluginRecord.Name} [loaded, enabled] ${PluginRecord.Entry}`);
	},

	LoadPlugin(strPluginName) {
		g_vecNativeCalls.push(["LoadPlugin", strPluginName]);

		return LoadFromDisk(RequirePluginName(strPluginName));
	},

	GetPluginRecords() {
		g_vecNativeCalls.push(["GetPluginRecords"]);

		return CopyLoadedPluginRecords();
	},

	ReloadPlugin(PluginSelector) {
		g_vecNativeCalls.push(["ReloadPlugin", PluginSelector]);
		PluginSelector = RequirePluginSelector(PluginSelector, "ReloadPlugin");

		const PluginRecord = RemoveLoadedPluginRecord(PluginSelector);

		return PluginRecord ? LoadFromDisk(PluginRecord.Name) : false;
	},

	ReloadAllPlugins() {
		g_vecNativeCalls.push(["ReloadAllPlugins"]);
		g_vecLoadedRecords.length = 0;
		LoadAllFromDisk();

		return true;
	},

	UnloadPlugin(PluginSelector) {
		g_vecNativeCalls.push(["UnloadPlugin", PluginSelector]);
		PluginSelector = RequirePluginSelector(PluginSelector, "UnloadPlugin");

		return RemoveLoadedPluginRecord(PluginSelector) !== null;
	},

	UnloadAllPlugins() {
		g_vecNativeCalls.push(["UnloadAllPlugins"]);
		g_vecLoadedRecords.length = 0;

		return true;
	},
};

LoadAllFromDisk();

const g_vecInitialLoadedRecords = g_vecLoadedRecords.slice();
const g_vecInitialDisabledNames = [...g_setDisabledNames];
const g_vecInitialDiskPlugins = [...g_mapDiskPlugins];
const g_unInitialDiskLoadAttemptCount = g_vecDiskLoadAttempts.length;
const g_NativePluginDescriptors = Object.getOwnPropertyDescriptors(g_NativePlugins);
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strPath, Object.getOwnPropertyDescriptor(require.cache, strPath));
	}
}

function ReleaseLifecycleOwner() {
	if (g_LifecycleOwner === null) {
		return;
	}

	// Keep the owner until canonical SourceJS cleanup returns normally.
	g_LifecycleOwner.Unload();
	g_LifecycleOwner = null;
}

function RestorePluginFixture() {
	g_vecLoadedRecords.splice(0, g_vecLoadedRecords.length, ...g_vecInitialLoadedRecords);
	g_mapDiskPlugins.clear();
	for (const vecDiskPlugin of g_vecInitialDiskPlugins) {
		g_mapDiskPlugins.set(vecDiskPlugin[0], vecDiskPlugin[1]);
	}

	g_setAutoloadDisabledNames.clear();
	g_setFailingPluginNames.clear();
	g_vecDiskLoadAttempts.length = g_unInitialDiskLoadAttemptCount;
	g_setDisabledNames.clear();
	for (const strPluginName of g_vecInitialDisabledNames) {
		g_setDisabledNames.add(strPluginName);
	}

	const vecFailures = [];
	for (const strName of Object.keys(g_NativePluginDescriptors)) {
		try {
			Object.defineProperty(g_NativePlugins, strName, g_NativePluginDescriptors[strName]);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugin fixture restoration failed.");
	}
}

function RestoreModuleLoader() {
	Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
}

function RestorePackageCache() {
	const vecFailures = [];
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Temporary plugins cache entry must be removable: " + strPath);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		try {
			Object.defineProperty(require.cache, strPath, Descriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Plugins package cache restoration failed.");
	}
}

function CheckPluginRestartPolicies(RestartModule) {
	const vecLoadedRecordsBefore = g_vecLoadedRecords.slice();
	const unDiskLoadAttemptCountBefore = g_vecDiskLoadAttempts.length;
	g_Assert.equal(g_mapDiskPlugins.has("manualonly"), false);
	g_Assert.equal(g_mapDiskPlugins.has("failingauto"), false);

	try {
		g_mapDiskPlugins.set("manualonly", "index.js");
		g_setAutoloadDisabledNames.add("manualonly");
		g_Assert.equal(g_NativePlugins.LoadPlugin("manualonly"), true, "explicit load ignores Autoload false");

		const unManualRestartStart = g_vecDiskLoadAttempts.length;
		const ManualRestart = RestartModule.RestartAllPlugins();
		g_Assert.equal(ManualRestart.NamesBefore.includes("manualonly"), true, "manual plugin was loaded before restart");
		g_Assert.equal(ManualRestart.NamesAfter.includes("manualonly"), false, "Autoload false intentionally excludes a previously loaded plugin");
		g_Assert.equal(g_vecDiskLoadAttempts.slice(unManualRestartStart).includes("manualonly"), false, "bulk rescan never attempts an Autoload-disabled plugin");

		g_mapDiskPlugins.set("failingauto", "index.js");
		g_setFailingPluginNames.add("failingauto");
		g_Assert.equal(g_NativePlugins.LoadPlugin("failingauto"), false, "eligible plugin can fail to load");

		const unFailingRestartStart = g_vecDiskLoadAttempts.length;
		const FailedLoadRestart = RestartModule.RestartAllPlugins();
		g_Assert.equal(g_vecDiskLoadAttempts.slice(unFailingRestartStart).includes("failingauto"), true, "bulk rescan attempts an eligible failing plugin");
		g_Assert.equal(FailedLoadRestart.NamesAfter.includes("failingauto"), false, "completed bulk callback does not guarantee every eligible plugin loaded");
		g_Assert.deepEqual(FailedLoadRestart.NamesAfter, ["hello", "metrics"], "independent successful plugin loads remain observable");
	} finally {
		g_mapDiskPlugins.delete("manualonly");
		g_mapDiskPlugins.delete("failingauto");
		g_setAutoloadDisabledNames.delete("manualonly");
		g_setFailingPluginNames.delete("failingauto");
		g_vecLoadedRecords.splice(0, g_vecLoadedRecords.length, ...vecLoadedRecordsBefore);
		g_vecDiskLoadAttempts.length = unDiskLoadAttemptCountBefore;
	}
}

// The same-realm deadline bounds JavaScript execution, not native IO or untrusted code.
function RunDocumentationTask(Callback) {
	return g_VM.runInNewContext("Run()", { Run: Callback }, { filename: g_strDocumentationPath + "#root", timeout: g_unDocumentationTimeoutMilliseconds });
}

function CompileDocumentationBlock(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + "#js-" + (unBlockIndex + 1) });
}

let g_PrimaryFailure = undefined;
let g_bFailed = false;
let g_bCacheAcquired = false;
let g_bLoaderAcquired = false;

try {
	g_Assert.ok(g_ModuleLoadDescriptor && Object.hasOwn(g_ModuleLoadDescriptor, "value") && (typeof g_ModuleLoadDescriptor.value === "function") && (g_ModuleLoadDescriptor.configurable || g_ModuleLoadDescriptor.writable), "Node module loader must be replaceable without invoking an accessor.");

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
	}

	g_bCacheAcquired = true;
	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	g_bLoaderAcquired = true;
	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function LoadModule(strRequest) {
			if (strRequest === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						if (strModuleName === "plugins") {
							return g_NativePlugins;
						}

						throw new Error(`unexpected runtime module ${strModuleName}`);
					},
				};
			}

			return g_ModuleLoadDescriptor.value.apply(this, arguments);
		},
	});

	const g_Plugins = require(g_strPluginsPath);
	RestoreModuleLoader();

	const g_vecExpectedExports = [
		"DisablePlugin",
		"EnablePlugin",
		"GetPluginRecords",
		"List",
		"LoadPlugin",
		"ReloadAllPlugins",
		"ReloadPlugin",
		"UnloadAllPlugins",
		"UnloadPlugin",
	];

	g_Assert.equal(g_Plugins, g_NativePlugins, "plugins must expose the exact native object.");
	g_Assert.deepEqual(Object.keys(g_Plugins).sort(), g_vecExpectedExports, "plugins exact exports");
	g_Assert.deepEqual(g_Plugins.GetPluginRecords().map((PluginRecord) => PluginRecord.Name), ["hello", "metrics"], "startup loads every enabled disk plugin.");
	g_Assert.equal(g_Plugins.LoadPlugin("hello"), true, "loading an active plugin is idempotent.");
	g_Assert.throws(() => g_Plugins.LoadPlugin(1), /non-empty plugin name string/, "load rejects an index.");
	g_Assert.throws(() => g_Plugins.UnloadPlugin(0), /positive one-based index/, "selectors reject index zero.");

	for (const strMethodName of ["UnloadPlugin", "ReloadPlugin", "DisablePlugin", "EnablePlugin"]) {
		for (const InvalidPluginSelector of [
			0,
			-1,
			1.5,
			4294967296,
			NaN,
			Infinity,
			null,
			undefined,
			true,
			1n,
			"",
		]) {
			g_Assert.throws(() => g_Plugins[strMethodName](InvalidPluginSelector), TypeError, `${strMethodName} rejects a non-uint32/non-name selector.`);
		}

		g_Assert.equal(g_Plugins[strMethodName](g_unMaximumPluginSelectorIndex), false, `${strMethodName} accepts an unresolved uint32 boundary without coercion.`);
	}

	g_Assert.equal(Object.hasOwn(g_Plugins, "default"), false, "plugins must not expose a default alias.");
	g_Assert.equal(Object.hasOwn(g_Plugins, "moduleName"), false, "plugins must not expose moduleName.");

	g_vecNativeCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	function DocumentationRequire(strModuleName) {
		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecLogMessages.push(strMessage);

					return true;
				},
			};
		}

		if (strModuleName === "plugins") {
			return g_Plugins;
		}

		throw new Error(`unexpected plugins documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "plugins documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "plugins documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("There is no persistent discovery registry"), "plugins docs must describe direct disk loading.");
	g_Assert.ok(g_strDocumentation.includes("`LoadPlugin(strPluginName)` never accepts an index"), "plugins docs must distinguish loading from selectors.");
	g_Assert.ok(g_strDocumentation.includes("removed from `List()` and `GetPluginRecords()` immediately"), "plugins docs must describe record removal.");
	g_Assert.ok(g_strDocumentation.includes("one isolated `v8::Context` per plugin"), "plugins docs must describe context isolation.");
	g_Assert.ok(g_strDocumentation.includes("serialized payloads"), "plugins docs must direct cross-plugin messages to the bus.");
	g_Assert.ok(g_strDocumentation.includes("PluginsState.json"), "plugins docs must name the disabled-state file.");
	g_Assert.ok(g_strDocumentation.includes("unmanaged host/admin JavaScript context"), "bulk example must not destroy its own controller context");
	g_Assert.ok(g_strDocumentation.includes("old registrations are not copied"), "reload does not preserve old callback/hook registrations");
	g_Assert.ok(!g_strDocumentation.includes("console."), "plugins documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strDocumentation), "plugins documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strDocumentation);
	VerifyDocumentationLinks(g_strDocumentation);

	function CheckPluginsDocumentationExamples() {
		const vecDocumentationModules = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			CompileDocumentationBlock(g_vecCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex)(DocumentationRequire, ModuleRecord, ModuleRecord.exports);
			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecNativeCalls.length, 0, "plugins examples must not run native lifecycle operations during block load");
		g_Assert.equal(typeof vecDocumentationModules[g_DocumentationBlocks.Lifecycle].Load, "function", "lifecycle example canonical Load export");
		g_Assert.equal(typeof vecDocumentationModules[g_DocumentationBlocks.Lifecycle].Unload, "function", "lifecycle example canonical Unload export");
		g_Assert.equal(Object.hasOwn(vecDocumentationModules[g_DocumentationBlocks.Lifecycle], "load"), false, "lifecycle example has no lowercase Load alias");
		g_Assert.equal(Object.hasOwn(vecDocumentationModules[g_DocumentationBlocks.Lifecycle], "unload"), false, "lifecycle example has no lowercase Unload alias");
		g_LifecycleOwner = vecDocumentationModules[g_DocumentationBlocks.Lifecycle];
		g_LifecycleOwner.Load();
		g_LifecycleOwner.Unload();
		g_LifecycleOwner = null;

		const InspectedPlugins = vecDocumentationModules[g_DocumentationBlocks.Inspect].InspectLoadedPlugins();
		g_Assert.equal(InspectedPlugins.Lines.length, 2, "documented console-ready plugin lines");
		g_Assert.deepEqual(InspectedPlugins.Records.map((PluginRecord) => PluginRecord.Name), ["hello", "metrics"], "documented current plugin records");
		g_Assert.equal(InspectedPlugins.Records[0].Directory, g_Path.join(g_strPluginRootPath, "hello"), "documented plugin directory");
		g_Assert.equal(vecDocumentationModules[g_DocumentationBlocks.Load].LoadPluginFromDisk("hello").Name, "hello", "documented name-only disk load");
		g_Assert.equal(vecDocumentationModules[g_DocumentationBlocks.Reload].ReloadPluginAndVerify("1").Name, "hello", "documented numeric-string reload selector");
		g_Assert.equal(vecDocumentationModules[g_DocumentationBlocks.Enabled].CyclePluginEnabledState("hello").Name, "hello", "documented disable/enable cycle");
		g_Assert.equal(g_setDisabledNames.size, 0, "documented enable cycle restores in-memory disabled state");
		g_Assert.equal(vecDocumentationModules[g_DocumentationBlocks.Loaded].CyclePluginLoadedState("hello").Name, "hello", "documented unload/restore cycle");

		const RestartedPlugins = vecDocumentationModules[g_DocumentationBlocks.Restart].RestartAllPlugins();
		g_Assert.deepEqual(RestartedPlugins.NamesBefore, ["metrics", "hello"], "documented pre-restart plugin order");
		g_Assert.deepEqual(RestartedPlugins.NamesAfter, ["hello", "metrics"], "documented post-rescan plugin order");
		CheckPluginRestartPolicies(vecDocumentationModules[g_DocumentationBlocks.Restart]);

		for (const strMethodName of g_vecExpectedExports) {
			g_Assert.ok(g_vecNativeCalls.some((vecCall) => vecCall[0] === strMethodName), `documentation must execute plugins.${strMethodName}.`);
		}

		g_Assert.deepEqual(g_vecLogMessages, ["hello loaded", "hello unloaded"], "lifecycle example output");
		g_Assert.deepEqual(g_Plugins.GetPluginRecords().map((PluginRecord) => PluginRecord.Name), ["hello", "metrics"], "documentation workflows restore enabled disk plugins.");
	}

	RunDocumentationTask(CheckPluginsDocumentationExamples);

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	for (const strRequiredContract of [
		"PluginNameArgument",
		"PluginSelectorArgument",
		"CallbackInformation.Length() < kPluginNameRequiredArgumentCount",
		"plugins.LoadPlugin(strPluginName) expects a non-empty plugin name string.",
		"positive one-based index.",
	]) {
		g_Assert.ok(g_strModuleBindings.includes(strRequiredContract), `native plugin argument contract missing: ${strRequiredContract}`);
	}

	g_Assert.ok(!g_strModuleBindings.includes("std::string const strName = Args.Length() > 0 ? ValueToString(Args.GetIsolate(), Args[0]) : \"\";"), "plugin callbacks must not coerce arbitrary values.");

	const g_strPluginManager = g_FileSystem.readFileSync(g_strPluginManagerPath, "utf8");
	for (const strRequiredContract of [
		"std::vector<std::string> const vecPluginNames = DiscoverNames();",
		"Plugin load expects a plugin name, not an index",
		"BuildRecord(strName, NewPluginRecord)",
		"ExecutePluginFile(NewPluginRecord.m_PathEntry, NewPluginRecord.m_strName)",
		"RemoveRecord(strName)",
		'"PluginsState.json"',
	]) {
		g_Assert.ok(g_strPluginManager.includes(strRequiredContract), `PluginManager lifecycle contract missing: ${strRequiredContract}`);
	}

	const g_strV8Runtime = g_FileSystem.readFileSync(g_strV8RuntimePath, "utf8");
	for (const strRequiredContract of [
		"v8::Local<v8::Context> const LocalContext = v8::Context::New(m_pIsolate);",
		"NewPluginRuntimeRecord.m_Context",
		"RuntimeRecord.m_Exports",
		"RemoveCallbacksForContext(LocalContext)",
		"GetMemoryHookManager().RemoveContext(LocalContext)",
		"ReleaseSourceJSExternalResources(strPluginName)",
	]) {
		g_Assert.ok(g_strV8Runtime.includes(strRequiredContract), `V8 plugin isolation contract missing: ${strRequiredContract}`);
	}
} catch (Failure) {
	g_PrimaryFailure = Failure;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	const vecRestorers = [ReleaseLifecycleOwner, RestorePluginFixture];
	if (g_bCacheAcquired) {
		vecRestorers.push(RestorePackageCache);
	}

	if (g_bLoaderAcquired) {
		vecRestorers.push(RestoreModuleLoader);
	}

	for (const Restore of vecRestorers) {
		try {
			Restore();
		} catch (Failure) {
			vecCleanupFailures.push(Failure);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Plugins verification and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Plugins restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log("[smoke_plugins] ok");
