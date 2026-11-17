"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_vecNativeCalls = [];
const g_vecMessages = [];
const g_mapCommands = new Map();
let g_vecPluginLines = ["1: Example [Enabled]", "2: Other [Enabled]"];
let g_vecPluginRecords = [];
let g_bOperationResult = true;
let g_OperationError = null;

function CreateNativeOperation(strMethodName) {
	return function NativePluginOperation(...vecArguments) {
		if (g_OperationError !== null) {
			throw g_OperationError;
		}

		g_vecNativeCalls.push({ Method: strMethodName, Arguments: vecArguments });

		return g_bOperationResult;
	};
}

const g_PluginsRuntime = {
	GetPluginRecords() {
		return g_vecPluginRecords;
	},
	List() {
		return g_vecPluginLines;
	},
};
for (const strMethodName of ["DisablePlugin", "EnablePlugin", "LoadPlugin", "ReloadAllPlugins", "ReloadPlugin", "UnloadAllPlugins", "UnloadPlugin"]) {
	g_PluginsRuntime[strMethodName] = CreateNativeOperation(strMethodName);
}

function LoadPackage(strRelativePath, RequireDependency) {
	const strPackagePath = g_Path.join(__dirname, "../packages/sourcejs", strRelativePath);
	const Module = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(strPackagePath, "utf8"), { module: Module, require: RequireDependency }, { filename: strPackagePath });

	return Module.exports;
}

function RequirePluginsDependency(strModuleName) {
	g_Assert.equal(strModuleName, "internal/runtime");

	return {
		GetModule(strNativeModuleName) {
			g_Assert.equal(strNativeModuleName, "plugins");

			return g_PluginsRuntime;
		},
	};
}

const g_Plugins = LoadPackage("plugins.js", RequirePluginsDependency);
const g_CoreCommand = {
	RegisterCommand(vecPath, Callback) {
		const strCommandKey = Array.from(vecPath).join(" ");
		g_Assert.equal(g_mapCommands.has(strCommandKey), false);
		g_mapCommands.set(strCommandKey, Callback);

		return Callback;
	},
	LogCommandMessage(strMessage) {
		g_vecMessages.push(strMessage);
	},
};

function RequireCommandDependency(strModuleName) {
	switch (strModuleName) {
		case "plugins":
			return g_Plugins;

		case "core/command":
			return { CORE_COMMAND: g_CoreCommand };

		default:
			throw new Error(`Unexpected plugin command dependency ${strModuleName}`);
	}
}

const g_CorePlugins = LoadPackage("core/command/plugin.js", RequireCommandDependency);
g_Assert.equal(g_CorePlugins.MODULE_NAME, "core/command/plugin");
g_Assert.equal(g_CorePlugins.LoadPlugin("Example"), true);
g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: "LoadPlugin", Arguments: ["Example"] });
g_Assert.equal(g_vecMessages.pop(), 'Plugin "Example" has been loaded.');

const g_vecOperationCases = [
	{ Method: "LoadPlugin", Path: "plugins load", Arguments: ["Example"] },
	{ Method: "UnloadPlugin", Path: "plugins unload", Arguments: ["Example"] },
	{ Method: "ReloadPlugin", Path: "plugins reload", Arguments: ["Example"] },
	{ Method: "DisablePlugin", Path: "plugins disable", Arguments: ["Example"] },
	{ Method: "EnablePlugin", Path: "plugins enable", Arguments: ["Example"] },
	{ Method: "UnloadAllPlugins", Path: "plugins unload_all", Arguments: [], SuccessMessage: "Plugin unload pass has completed.", FailureMessage: "Unable to complete the plugin unload pass." },
	{ Method: "ReloadAllPlugins", Path: "plugins reload_all", Arguments: [], SuccessMessage: "Enabled plugin reload pass has completed.", FailureMessage: "Unable to complete the enabled plugin reload pass." },
];
g_Assert.deepEqual(Array.from(g_mapCommands.keys()).sort(), [...g_vecOperationCases.map((TestCase) => TestCase.Path), "plugins", "plugins list"].sort());

// The real wrappers/facade use current native names; the native lifecycle and registry are controlled doubles.
for (const TestCase of g_vecOperationCases) {
	for (const bOperationResult of [true, false]) {
		g_bOperationResult = bOperationResult;
		g_Assert.equal(g_CorePlugins[TestCase.Method](...TestCase.Arguments), bOperationResult);
		g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: TestCase.Method, Arguments: TestCase.Arguments });

		if (TestCase.SuccessMessage !== undefined) {
			g_Assert.equal(g_vecMessages.at(-1), bOperationResult ? TestCase.SuccessMessage : TestCase.FailureMessage);
		}

		g_Assert.equal(g_mapCommands.get(TestCase.Path)({ CommandArguments: TestCase.Arguments }), bOperationResult);
		g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: TestCase.Method, Arguments: TestCase.Arguments });
	}
}

g_bOperationResult = true;

for (const strMethodName of ["UnloadPlugin", "ReloadPlugin", "DisablePlugin", "EnablePlugin"]) {
	for (const PluginSelector of [1, "2"]) {
		g_Assert.equal(g_CorePlugins[strMethodName](PluginSelector), true);
		g_Assert.deepEqual(g_vecNativeCalls.pop(), { Method: strMethodName, Arguments: [PluginSelector] });
	}
}

g_Assert.equal(g_CorePlugins.PrintPlugins(), g_vecPluginLines);
g_Assert.equal(g_vecMessages.pop(), g_vecPluginLines.join("\n"));
g_Assert.equal(g_mapCommands.get("plugins")(), g_vecPluginLines);
g_Assert.equal(g_mapCommands.get("plugins list")(), g_vecPluginLines);

g_vecPluginLines = [];
g_Assert.equal(g_CorePlugins.PrintPlugins(), g_vecPluginLines);
g_Assert.equal(g_vecMessages.pop(), "No SourceJS plugins found.");

const g_unMessageCount = g_vecMessages.length;
g_OperationError = new Error("Native lifecycle failed");
g_Assert.throws(() => g_CorePlugins.LoadPlugin("Example"), (ErrorValue) => ErrorValue === g_OperationError);
g_Assert.equal(g_vecMessages.length, g_unMessageCount);
g_Assert.equal(g_vecNativeCalls.length, 0);

const g_vecDocumentationCases = [
	{ Path: "../docs/api/core-command-plugin.md", ExampleCount: 11 },
	{ Path: "../docs/api/plugins.md", ExampleCount: 8 },
];
const g_setExecutedDocumentationControllers = new Set();
g_OperationError = null;
g_vecPluginRecords = [{ Name: "Example", Index: 1, Loaded: true, Enabled: true }];

// Validate syntax/imports and two controller results with native doubles, never a live server.
for (const DocumentationCase of g_vecDocumentationCases) {
	const strDocumentationPath = g_Path.join(__dirname, DocumentationCase.Path);
	const strDocumentation = g_FileSystem.readFileSync(strDocumentationPath, "utf8");
	let unExampleCount = 0;
	for (const vecExampleMatch of strDocumentation.matchAll(/^```js\r?\n([\s\S]*?)^```/gm)) {
		const strExampleSource = vecExampleMatch[1];
		new g_VM.Script(strExampleSource, { filename: strDocumentationPath });

		for (const vecImportMatch of strExampleSource.matchAll(/const\s+\{([^}]+)\}\s*=\s*require\("([^"]+)"\);/g)) {
			if (vecImportMatch[2] === "loggers") {
				continue;
			}

			const Dependency = (vecImportMatch[2] === "core/command/plugin") ? g_CorePlugins : RequireCommandDependency(vecImportMatch[2]);
			for (const strImportEntry of vecImportMatch[1].split(",")) {
				const strExportName = strImportEntry.trim();
				if (strExportName.length > 0) {
					g_Assert.equal(Object.hasOwn(Dependency, strExportName), true, `Missing documented export ${vecImportMatch[2]}.${strExportName}`);
				}
			}
		}

		const vecControllerMatch = strExampleSource.match(/^module\.exports = \{ (LoadPluginFromDisk|ReloadPluginAndVerify) \};$/m);
		if (vecControllerMatch !== null) {
			const DocumentationModule = { exports: {} };
			g_VM.runInNewContext(strExampleSource, { module: DocumentationModule, require: RequireCommandDependency }, { filename: strDocumentationPath });
			const strControllerName = vecControllerMatch[1];
			const Controller = DocumentationModule.exports[strControllerName];
			g_bOperationResult = false;
			g_Assert.throws(() => Controller("Example"), /could not be (loaded|reloaded)/);
			g_bOperationResult = true;
			g_Assert.equal(Controller("Example"), g_vecPluginRecords[0]);
			g_setExecutedDocumentationControllers.add(strControllerName);
		}

		unExampleCount += 1;
	}

	g_Assert.equal(unExampleCount, DocumentationCase.ExampleCount);
}

g_Assert.deepEqual(Array.from(g_setExecutedDocumentationControllers).sort(), ["LoadPluginFromDisk", "ReloadPluginAndVerify"], "Both documented plugin controllers must execute.");

console.log("Core plugin command smoke checks passed (actual JS wrapper/facade and two documentation controllers; native lifecycle/registry doubles, no IO; other examples syntax/plugin imports only).");
