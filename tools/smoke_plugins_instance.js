#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPluginInstancePath = g_Path.join(g_strPackageRootPath, "plugins", "instance.js");
const g_strPluginInformationPath = g_Path.join(g_strPackageRootPath, "plugins", "info.js");
const g_strFileSystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins-instance.md");

// These paths belong to the in-memory filesystem double, not a disk installation.
const g_strPluginRootPath = "C:/game/left4dead2/addons/sourcejs/plugins";
const g_mapPluginManifestFiles = new Map([
	[`${g_strPluginRootPath}/hello/plugin.json`, JSON.stringify({
		Author: "SourceJS",
		Description: "Minimal SourceJS greeting plugin.",
		Entry: "index.js",
		Name: "hello",
		Version: "1.0.0",
	})],
]);

const g_vecPluginFileSystemCalls = [];
const g_vecPluginManagerCalls = [];

function CreateHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyDocumentationContentsAnchors(strPluginDocumentation) {
	const vecContentsMatch = strPluginDocumentation.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "plugins/instance contents section");

	const vecDocumentedAnchors = [];
	const vecSectionAnchors = [];
	for (const vecDocumentedAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
	}

	for (const vecSectionHeadingMatch of strPluginDocumentation.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = CreateHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins/instance contents anchors");
}

function VerifyDocumentationLinks(strPluginDocumentation) {
	const strDocumentationWithoutCode = strPluginDocumentation.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationTarget)) {
			continue;
		}

		const nFragmentIndex = strDocumentationTarget.indexOf("#");
		const strTargetWithoutFragment = (nFragmentIndex < 0) ? strDocumentationTarget : strDocumentationTarget.slice(0, nFragmentIndex);
		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTargetWithoutFragment);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `plugins/instance documentation link must exist: ${strDocumentationTarget}`);
	}
}

function InstallDependency(strDependencyModulePath, DependencyModuleExports) {
	delete require.cache[strDependencyModulePath];
	require.cache[strDependencyModulePath] = { exports: DependencyModuleExports, filename: strDependencyModulePath, id: strDependencyModulePath, loaded: true };
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
				g_Assert.ok(Reflect.deleteProperty(require.cache, strModulePath), "Temporary plugin instance module cache entry must be removable: " + strModulePath);
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
		throw new AggregateError(vecFailures, "Plugin instance module cache restoration failed.");
	}

	g_bPackageCacheOwned = false;
}

let g_RestoreDocumentationFixture = null;
let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed plugin instance cache entries must support exact restoration.");
	}

	g_bPackageCacheOwned = true;
	InstallDependency(g_strFileSystemPath, {
		DoesFileExist(strRequestedFilePath) {
			g_vecPluginFileSystemCalls.push(["DoesFileExist", strRequestedFilePath]);

			return g_mapPluginManifestFiles.has(strRequestedFilePath);
		},

		ReadTextFile(strRequestedFilePath) {
			g_vecPluginFileSystemCalls.push(["ReadTextFile", strRequestedFilePath]);

			return g_mapPluginManifestFiles.get(strRequestedFilePath);
		},
	});
	delete require.cache[g_strPluginInformationPath];
	delete require.cache[g_strPluginInstancePath];

	const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
	g_Module._load = function LoadModule(strRequest) {
		if (strRequest === "filesystem") {
			return require(g_strFileSystemPath);
		}

		if (strRequest === "plugins/info") {
			return require(g_strPluginInformationPath);
		}

		return g_OriginalModuleLoad.apply(this, arguments);
	};

	const { PluginInfo } = require(g_strPluginInformationPath);
	const { Plugin } = require(g_strPluginInstancePath);
	RestoreModuleLoader();

	class PluginManagerFixture {
		constructor() {
			this.EnabledPluginNames = new Set(["hello", "metrics"]);
			this.LoadedPluginGenerations = new Map([["hello", 1]]);
		}

		GetPluginName(strPluginName) {
			g_vecPluginManagerCalls.push(["GetPluginName", strPluginName]);

			if ((typeof strPluginName !== "string") || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(strPluginName)) {
				throw new TypeError("invalid plugin name");
			}

			return strPluginName;
		}

		GetPluginRecord(strPluginName) {
			g_vecPluginManagerCalls.push(["GetPluginRecord", strPluginName]);

			if (!this.LoadedPluginGenerations.has(strPluginName)) {
				return null;
			}

			return {
				Directory: this.GetPluginDirectory(strPluginName),
				Enabled: this.EnabledPluginNames.has(strPluginName),
				Entry: this.GetPluginFilePath(strPluginName),
				Generation: this.LoadedPluginGenerations.get(strPluginName),
				Index: 1,
				Loaded: true,
				Name: strPluginName,
			};
		}

		GetPluginDirectory(strPluginName) {
			g_vecPluginManagerCalls.push(["GetPluginDirectory", strPluginName]);

			return `${g_strPluginRootPath}/${strPluginName}`;
		}

		GetPluginFilePath(strPluginName) {
			g_vecPluginManagerCalls.push(["GetPluginFilePath", strPluginName]);

			return `${this.GetPluginDirectory(strPluginName)}/index.js`;
		}

		IsPluginLoaded(strPluginName) {
			g_vecPluginManagerCalls.push(["IsPluginLoaded", strPluginName]);

			return this.LoadedPluginGenerations.has(strPluginName);
		}

		IsPluginEnabled(strPluginName) {
			g_vecPluginManagerCalls.push(["IsPluginEnabled", strPluginName]);

			return this.EnabledPluginNames.has(strPluginName);
		}

		LoadPlugin(strPluginName) {
			g_vecPluginManagerCalls.push(["LoadPlugin", strPluginName]);

			if (this.LoadedPluginGenerations.has(strPluginName)) {
				throw new Error(`${strPluginName} is already loaded`);
			}

			if (!this.EnabledPluginNames.has(strPluginName)) {
				throw new Error(`${strPluginName} is disabled`);
			}

			this.LoadedPluginGenerations.set(strPluginName, 1);

			return new Plugin(strPluginName, this);
		}

		UnloadPlugin(strPluginName) {
			g_vecPluginManagerCalls.push(["UnloadPlugin", strPluginName]);

			if (!this.LoadedPluginGenerations.delete(strPluginName)) {
				throw new Error(`${strPluginName} is not loaded`);
			}

			return true;
		}

		ReloadPlugin(strPluginName) {
			g_vecPluginManagerCalls.push(["ReloadPlugin", strPluginName]);

			if (!this.LoadedPluginGenerations.has(strPluginName)) {
				throw new Error(`${strPluginName} is not loaded`);
			}

			this.LoadedPluginGenerations.set(strPluginName, this.LoadedPluginGenerations.get(strPluginName) + 1);

			return new Plugin(strPluginName, this);
		}

		DisablePlugin(strPluginName) {
			g_vecPluginManagerCalls.push(["DisablePlugin", strPluginName]);
			// Disabling an absent fixture entry still succeeds; both deletions are intentionally idempotent.
			this.LoadedPluginGenerations.delete(strPluginName);
			this.EnabledPluginNames.delete(strPluginName);

			return true;
		}

		EnablePlugin(strPluginName) {
			g_vecPluginManagerCalls.push(["EnablePlugin", strPluginName]);
			this.EnabledPluginNames.add(strPluginName);

			if (!this.LoadedPluginGenerations.has(strPluginName)) {
				this.LoadedPluginGenerations.set(strPluginName, 1);
			}

			return new Plugin(strPluginName, this);
		}
	}

	const g_PluginManager = new PluginManagerFixture();
	const g_PluginInstanceModule = require(g_strPluginInstancePath);
	g_Assert.deepEqual(Object.keys(g_PluginInstanceModule), ["Plugin"], "plugins/instance exact exports");
	g_Assert.equal(Object.hasOwn(g_PluginInstanceModule, "default"), false, "plugins/instance must not expose a default alias.");
	g_Assert.throws(() => new Plugin("hello", 2), /manager is required/, "constructor rejects a numeric manager.");
	g_Assert.throws(() => new Plugin("../hello", g_PluginManager), /invalid plugin name/, "constructor delegates name validation.");

	const g_HelloPlugin = new Plugin("hello", g_PluginManager);
	g_Assert.equal(g_HelloPlugin.Name, "hello", "validated name");
	g_Assert.equal(g_HelloPlugin.PluginManager, g_PluginManager, "manager identity");
	g_Assert.equal(g_HelloPlugin.Directory, `${g_strPluginRootPath}/hello`, "live directory");
	g_Assert.equal(g_HelloPlugin.FilePath, `${g_strPluginRootPath}/hello/index.js`, "live file path");
	g_Assert.equal(g_HelloPlugin.Loaded, true, "live loaded state");
	g_Assert.equal(g_HelloPlugin.Enabled, true, "live enabled state");
	g_Assert.ok(g_HelloPlugin.Info instanceof PluginInfo, "info type");
	g_Assert.equal(g_HelloPlugin.Info.Version, "1.0.0", "manifest info");

	const g_FirstPluginRecord = g_HelloPlugin.Record;
	const g_ReloadedPlugin = g_HelloPlugin.ReloadPlugin();
	const g_SecondPluginRecord = g_HelloPlugin.Record;
	g_Assert.ok(g_ReloadedPlugin instanceof Plugin, "reload result");
	g_Assert.notEqual(g_FirstPluginRecord, g_SecondPluginRecord, "record is reacquired.");
	g_Assert.equal(g_SecondPluginRecord.Generation, 2, "record reflects replacement context generation.");

	g_Assert.equal(g_HelloPlugin.DisablePlugin(), true, "disable result");
	g_Assert.equal(g_HelloPlugin.Record, null, "disabled plugin has no current record.");
	g_Assert.equal(g_HelloPlugin.Loaded, false, "disabled loaded state");
	g_Assert.equal(g_HelloPlugin.Enabled, false, "disabled enabled state");

	g_Assert.ok(g_HelloPlugin.EnablePlugin() instanceof Plugin, "enable result");
	g_Assert.equal(g_HelloPlugin.Loaded, true, "enabled plugin loads.");

	g_Assert.equal(g_HelloPlugin.UnloadPlugin(), true, "unload result");
	g_Assert.equal(g_HelloPlugin.Record, null, "unloaded plugin has no record.");
	g_Assert.equal(g_HelloPlugin.Enabled, true, "unloading does not disable the plugin.");
	g_Assert.equal(g_HelloPlugin.Directory, `${g_strPluginRootPath}/hello`, "unloaded wrapper resolves its disk directory.");
	g_Assert.ok(g_HelloPlugin.Info instanceof PluginInfo, "unloaded wrapper can read disk manifest metadata.");

	g_Assert.ok(g_HelloPlugin.LoadPlugin() instanceof Plugin, "load result");
	g_Assert.equal(g_HelloPlugin.Loaded, true, "load restores live state.");

	const g_MetricsPlugin = new Plugin("metrics", g_PluginManager);
	const g_MetricsPluginInformation = g_MetricsPlugin.Info;
	g_Assert.equal(g_MetricsPlugin.Record, null, "manifest-less unloaded plugin has no current record.");
	g_Assert.equal(g_MetricsPlugin.Loaded, false, "manifest-less plugin remains unloaded.");
	g_Assert.equal(g_MetricsPlugin.Enabled, true, "manifest-less plugin retains persistent enabled state.");
	g_Assert.ok(g_MetricsPluginInformation instanceof PluginInfo, "manifest-less info type");
	g_Assert.equal(g_MetricsPluginInformation.Name, "metrics", "manifest-less info name");
	g_Assert.equal(g_MetricsPluginInformation.Directory, `${g_strPluginRootPath}/metrics`, "manifest-less info directory");
	g_Assert.equal(g_MetricsPluginInformation.FilePath, `${g_strPluginRootPath}/metrics/index.js`, "manifest-less info entry");
	g_Assert.equal(g_MetricsPluginInformation.Index, -1, "manifest-less info index sentinel");
	g_Assert.equal(g_MetricsPluginInformation.Loaded, false, "manifest-less info loaded state");
	g_Assert.equal(g_MetricsPluginInformation.Enabled, true, "manifest-less info enabled state");
	g_Assert.equal(g_MetricsPluginInformation.Version, "unversioned", "manifest-less info version fallback");

	for (const strPluginLifecycleMethodName of [
		"DisablePlugin",
		"EnablePlugin",
		"LoadPlugin",
		"ReloadPlugin",
		"UnloadPlugin",
	]) {
		let bPluginLifecycleMethodDelegated = false;
		for (const vecPluginManagerCall of g_vecPluginManagerCalls) {
			if (vecPluginManagerCall[0] === strPluginLifecycleMethodName) {
				bPluginLifecycleMethodDelegated = true;
				break;
			}
		}

		g_Assert.equal(bPluginLifecycleMethodDelegated, true, `Plugin.${strPluginLifecycleMethodName} must delegate to its manager.`);
	}

	{
		let unNameQueryCount = 0;
		const Manager = {
			GetPluginName(strPluginName) {
				g_Assert.equal(this, Manager, "constructor preserves manager receiver");
				++unNameQueryCount;

				return strPluginName;
			},
		};
		const NamedPlugin = new Plugin("hello", Manager);
		g_Assert.equal(unNameQueryCount, 1, "construction delegates name validation once");
		g_Assert.equal(NamedPlugin.Name, "hello", "Name reads stored identity without another manager query");
		g_Assert.equal(unNameQueryCount, 1, "reading Name does not invoke the manager");
		g_Assert.throws(() => NamedPlugin.Record, TypeError, "missing manager methods fail on use, not during construction");

		for (const strLifecycleMethodName of [
			"DisablePlugin",
			"EnablePlugin",
			"LoadPlugin",
			"ReloadPlugin",
			"UnloadPlugin",
		]) {
			for (const Result of [
				true,
				false,
				0,
				null,
				undefined,
				{},
			]) {
				Manager[strLifecycleMethodName] = function InvokeLifecycle(strPluginName) {
					g_Assert.equal(this, Manager, "lifecycle delegation preserves manager receiver");
					g_Assert.equal(strPluginName, NamedPlugin.Name, "lifecycle delegation uses the stored name");

					return Result;
				};
				g_Assert.equal(NamedPlugin[strLifecycleMethodName](), Result, "lifecycle return values retain identity without coercion");
			}

			for (const Failure of [
				new Error("manager lifecycle failure"),
				null,
				undefined,
			]) {
				let bSideEffectCompleted = false;
				let bFailureCaught = false;
				Manager[strLifecycleMethodName] = function FailLifecycle() {
					bSideEffectCompleted = true;
					throw Failure;
				};

				try {
					NamedPlugin[strLifecycleMethodName]();
				} catch (CaughtFailure) {
					bFailureCaught = true;
					g_Assert.equal(CaughtFailure, Failure, "lifecycle failures retain the original thrown value");
				}

				g_Assert.equal(bFailureCaught, true, "lifecycle manager failure propagates");
				g_Assert.equal(bSideEffectCompleted, true, "failure does not imply rollback of manager side effects");
			}
		}
	}

	const g_strPluginInstanceDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecPluginInstanceDocumentationCodeBlocks = [];
	for (const vecPluginInstanceDocumentationCodeBlockMatch of g_strPluginInstanceDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecPluginInstanceDocumentationCodeBlocks.push(vecPluginInstanceDocumentationCodeBlockMatch[1]);
	}

	function DocumentationRequire(strRequestedModuleName) {
		if (strRequestedModuleName === "plugins/instance") {
			return g_PluginInstanceModule;
		}

		if (strRequestedModuleName === "plugins/manager") {
			return { PLUGIN_MANAGER: g_PluginManager };
		}

		throw new Error(`unexpected plugins/instance documentation module ${strRequestedModuleName}`);
	}

	g_Assert.equal(g_vecPluginInstanceDocumentationCodeBlocks.length, 6, "plugins/instance documentation workflow count");
	g_Assert.ok(!g_strPluginInstanceDocumentation.includes("Generated by"), "plugins/instance documentation must be maintained by hand.");
	g_Assert.ok(g_strPluginInstanceDocumentation.includes("does not cache a plugin record"), "plugins/instance docs must describe live state.");
	g_Assert.ok(g_strPluginInstanceDocumentation.includes("reference inequality does not prove a context-generation change"), "plugins/instance docs must not use snapshot identity as a reload proof.");
	g_Assert.ok(g_strPluginInstanceDocumentation.includes("must be a valid name rather than an index"), "plugins/instance docs must require a name-bound wrapper.");
	g_Assert.ok(g_strPluginInstanceDocumentation.includes("there is no discovery-list dependency"), "plugins/instance docs must describe direct disk loading.");
	g_Assert.ok(g_strPluginInstanceDocumentation.includes("manifest-less plugin uses its resolved entry"), "plugins/instance docs must describe optional manifests.");
	g_Assert.ok(!g_strPluginInstanceDocumentation.includes("console."), "plugins/instance documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strPluginInstanceDocumentation), "plugins/instance documentation must remain valid ASCII.");
	VerifyDocumentationContentsAnchors(g_strPluginInstanceDocumentation);
	VerifyDocumentationLinks(g_strPluginInstanceDocumentation);

	g_vecPluginManagerCalls.length = 0;
	g_vecPluginFileSystemCalls.length = 0;

	const g_setFixtureEnabledNames = g_PluginManager.EnabledPluginNames;
	const g_mapFixtureLoadedGenerations = g_PluginManager.LoadedPluginGenerations;
	const g_vecStartingEnabledNames = [...g_setFixtureEnabledNames];
	const g_mapStartingLoadedGenerations = new Map(g_mapFixtureLoadedGenerations);
	// Restore only this in-memory double; real plugin lifecycle operations are not transactional.
	g_RestoreDocumentationFixture = () => {
		g_PluginManager.EnabledPluginNames = g_setFixtureEnabledNames;
		g_PluginManager.LoadedPluginGenerations = g_mapFixtureLoadedGenerations;
		g_setFixtureEnabledNames.clear();
		for (const strPluginName of g_vecStartingEnabledNames) {
			g_setFixtureEnabledNames.add(strPluginName);
		}

		g_mapFixtureLoadedGenerations.clear();
		for (const [strPluginName, unGeneration] of g_mapStartingLoadedGenerations) {
			g_mapFixtureLoadedGenerations.set(strPluginName, unGeneration);
		}
	};

	const g_unDocumentationTimeoutMilliseconds = 1000;
	const g_RunDocumentationWorkflows = () => {
		const vecPluginInstanceDocumentationModules = [];
		for (let unPluginInstanceDocumentationCodeBlockIndex = 0; unPluginInstanceDocumentationCodeBlockIndex < g_vecPluginInstanceDocumentationCodeBlocks.length; ++unPluginInstanceDocumentationCodeBlockIndex) {
			const strFileName = g_strDocumentationPath + ":" + (unPluginInstanceDocumentationCodeBlockIndex + 1);
			const PluginInstanceDocumentationModuleRecord = new g_Module(strFileName, module);
			PluginInstanceDocumentationModuleRecord.filename = strFileName;
			PluginInstanceDocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
			PluginInstanceDocumentationModuleRecord.require = DocumentationRequire;
			PluginInstanceDocumentationModuleRecord._compile(g_vecPluginInstanceDocumentationCodeBlocks[unPluginInstanceDocumentationCodeBlockIndex], strFileName);
			vecPluginInstanceDocumentationModules.push(PluginInstanceDocumentationModuleRecord.exports);
		}

		g_Assert.equal(g_vecPluginManagerCalls.length, 0, "plugins/instance examples must not query or mutate plugins during block load.");
		g_Assert.equal(g_vecPluginFileSystemCalls.length, 0, "plugins/instance examples must not read manifests during block load.");
		g_Assert.deepEqual(Object.keys(vecPluginInstanceDocumentationModules[0]), [], "documented import block has no workflow export");

		const DocumentedHelloPluginController = vecPluginInstanceDocumentationModules[1].CreatePluginController("hello");
		g_Assert.ok(DocumentedHelloPluginController.Plugin instanceof Plugin, "documented controller plugin type");
		g_Assert.equal(DocumentedHelloPluginController.Name, "hello", "documented controller name");
		g_Assert.equal(DocumentedHelloPluginController.Manager, g_PluginManager, "documented controller manager");
		g_Assert.equal(DocumentedHelloPluginController.Directory, `${g_strPluginRootPath}/hello`, "documented controller directory");
		g_Assert.equal(DocumentedHelloPluginController.FilePath, `${g_strPluginRootPath}/hello/index.js`, "documented controller entry");

		g_Assert.deepEqual(vecPluginInstanceDocumentationModules[2].InspectPlugin("hello"), {
			Directory: `${g_strPluginRootPath}/hello`,
			Enabled: true,
			FilePath: `${g_strPluginRootPath}/hello/index.js`,
			Index: 1,
			Loaded: true,
			Name: "hello",
			VerboseName: "Hello",
			Version: "1.0.0",
		}, "documented loaded inspection");
		g_Assert.deepEqual(vecPluginInstanceDocumentationModules[2].InspectPlugin("metrics"), {
			Directory: `${g_strPluginRootPath}/metrics`,
			Enabled: true,
			FilePath: `${g_strPluginRootPath}/metrics/index.js`,
			Index: -1,
			Loaded: false,
			Name: "metrics",
			VerboseName: "Metrics",
			Version: "unversioned",
		}, "documented manifest-less unloaded inspection");

		g_Assert.deepEqual(vecPluginInstanceDocumentationModules[3].ReloadPlugin("hello"), { Name: "hello" }, "documented reload workflow does not report snapshot identity as a reload proof");

		g_Assert.equal(vecPluginInstanceDocumentationModules[4].CyclePluginEnabledState("hello"), "hello", "documented disable-enable workflow");

		g_Assert.equal(vecPluginInstanceDocumentationModules[5].CyclePluginLoadedState("hello"), "hello", "documented unload-load workflow");
		g_Assert.equal(g_PluginManager.IsPluginLoaded("hello"), true, "documentation restores hello to loaded state.");
		g_Assert.equal(g_PluginManager.IsPluginEnabled("hello"), true, "documentation restores hello to enabled state.");
		g_Assert.equal(g_PluginManager.IsPluginLoaded("metrics"), false, "documentation leaves inspected metrics unloaded.");
		g_Assert.equal(g_PluginManager.IsPluginEnabled("metrics"), true, "documentation leaves inspected metrics enabled.");

		const strPluginInstanceSource = g_FileSystem.readFileSync(g_strPluginInstancePath, "utf8");
		for (const strRequiredPluginInstanceContract of [
			"return this.PluginManager.GetPluginRecord(this.PluginName)",
			"return this.PluginManager.IsPluginLoaded(this.PluginName)",
			"return this.PluginManager.IsPluginEnabled(this.PluginName)",
			"return this.PluginManager.LoadPlugin(this.PluginName)",
			"return this.PluginManager.UnloadPlugin(this.PluginName)",
			"return this.PluginManager.ReloadPlugin(this.PluginName)",
			"return this.PluginManager.EnablePlugin(this.PluginName)",
			"return this.PluginManager.DisablePlugin(this.PluginName)",
			"return PluginInfo.FromRecord({",
			"Index: -1",
			"Loaded: false",
		]) {
			g_Assert.ok(strPluginInstanceSource.includes(strRequiredPluginInstanceContract), `plugins/instance live contract missing: ${strRequiredPluginInstanceContract}`);
		}

		for (const strRelatedDocumentationFileName of ["plugins-info.md", "plugins-manager.md", "plugins.md"]) {
			const strRelatedDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", strRelatedDocumentationFileName);
			g_Assert.ok(g_FileSystem.existsSync(strRelatedDocumentationPath), `plugins/instance related documentation missing: ${strRelatedDocumentationFileName}`);
		}
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	const vecCleanupFailures = [];
	for (const Cleanup of [RestoreModuleLoader, g_RestoreDocumentationFixture, RestorePackageCache]) {
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
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, ...vecCleanupFailures] : vecCleanupFailures, "Plugin instance smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_plugins_instance");
