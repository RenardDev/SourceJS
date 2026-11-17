#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strExtensionsPackagePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "extensions.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "extensions.md");
const g_strArchitectureDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "architecture.md");
const g_strEchoManifestPath = g_Path.join(g_strRepositoryRoot, "examples", "extensions", "echo", "extension.json");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "internal", "runtime.js");
const g_strExtensionHeaderPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "public", "ISourceJSExtension.h");
const g_strExtensionManagerPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "ExtensionManager.cpp");
const g_strV8RuntimePath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "V8Runtime.cpp");
const g_strEchoExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "extensions", "echo", "README.md");

const g_OriginalModuleLoad = g_Module._load;
const g_OriginalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecDependencyPaths = [g_strExtensionsPackagePath, g_strRuntimePath];
const g_mapOriginalDependencies = new Map(g_vecDependencyPaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));
const g_vecExpectedExports = [
	"DisableExtension",
	"EnableExtension",
	"GetLoadedExtensions",
	"LoadExtension",
	"ReloadAllExtensions",
	"ReloadExtension",
	"UnloadAllExtensions",
	"UnloadExtension",
];

function RequireExtensionString(strValue, strOperation) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strOperation} expects a non-empty extension string.`);
	}

	return strValue;
}

function CreateExtensionFixture({ AutoloadExtensionNames: vecAutoloadExtensionNames = ["metrics"], LoadFailureExtensionNames: vecLoadFailureExtensionNames = [] } = {}) {
	const setAvailableExtensionNames = new Set(["echo", "metrics"]);
	const setAutoloadExtensionNames = new Set(vecAutoloadExtensionNames);
	const setLoadFailureExtensionNames = new Set(vecLoadFailureExtensionNames);
	const setDisabledExtensionNames = new Set();
	const vecLoadedExtensionNames = ["echo", "metrics"];
	const vecOperationLog = [];
	const setUsedExports = new Set();

	function ResolveExtensionName(strSelector) {
		RequireExtensionString(strSelector, "extension selector");

		if (/^[0-9]+$/.test(strSelector)) {
			const unOneBasedIndex = Number(strSelector);
			if (Number.isSafeInteger(unOneBasedIndex) && (unOneBasedIndex > 0) && (unOneBasedIndex <= vecLoadedExtensionNames.length)) {
				return vecLoadedExtensionNames[unOneBasedIndex - 1];
			}

			return null;
		}

		return vecLoadedExtensionNames.includes(strSelector) ? strSelector : null;
	}

	function LoadExtension(strName) {
		RequireExtensionString(strName, "extensions.Load(strName)");
		vecOperationLog.push(["LOAD", strName]);

		if (/^[0-9]+$/.test(strName)) {
			return false;
		}

		if (vecLoadedExtensionNames.includes(strName)) {
			return true;
		}

		if (!setAvailableExtensionNames.has(strName) || setDisabledExtensionNames.has(strName) || setLoadFailureExtensionNames.has(strName)) {
			return false;
		}

		vecLoadedExtensionNames.push(strName);

		return true;
	}

	function UnloadExtension(strSelector) {
		const strName = ResolveExtensionName(strSelector);
		vecOperationLog.push(["UNLOAD", strSelector]);

		if (strName === null) {
			return false;
		}

		vecLoadedExtensionNames.splice(vecLoadedExtensionNames.indexOf(strName), 1);

		return true;
	}

	const NativeExtensions = {
		Disable(strSelector) {
			setUsedExports.add("DisableExtension");
			RequireExtensionString(strSelector, "extensions.Disable(strSelector)");

			const strLoadedName = ResolveExtensionName(strSelector);
			const strName = ((strLoadedName === null) && !/^[0-9]+$/.test(strSelector) && setAvailableExtensionNames.has(strSelector)) ? strSelector : strLoadedName;
			vecOperationLog.push(["DISABLE", strSelector]);

			if (strName === null) {
				return false;
			}

			if (strLoadedName !== null) {
				vecLoadedExtensionNames.splice(vecLoadedExtensionNames.indexOf(strLoadedName), 1);
			}

			setDisabledExtensionNames.add(strName);

			return true;
		},
		Enable(strSelector) {
			setUsedExports.add("EnableExtension");
			RequireExtensionString(strSelector, "extensions.Enable(strSelector)");

			const strLoadedName = ResolveExtensionName(strSelector);
			const strName = ((strLoadedName === null) && !/^[0-9]+$/.test(strSelector)) ? strSelector : strLoadedName;
			vecOperationLog.push(["ENABLE", strSelector]);

			if (strName === null) {
				return false;
			}

			setDisabledExtensionNames.delete(strName);

			return LoadExtension(strName);
		},
		List() {
			setUsedExports.add("GetLoadedExtensions");
			vecOperationLog.push(["LIST"]);

			if (vecLoadedExtensionNames.length === 0) {
				return ["No extensions loaded."];
			}

			return vecLoadedExtensionNames.map((strName, unIndex) => `${unIndex + 1}. ${strName} [loaded, enabled] C:/game/addons/sourcejs/extensions/${strName}/bin/windows-x86/${strName}.dll`);
		},
		Load(strName) {
			setUsedExports.add("LoadExtension");

			return LoadExtension(strName);
		},
		Reload(strSelector) {
			setUsedExports.add("ReloadExtension");
			const strName = ResolveExtensionName(strSelector);
			vecOperationLog.push(["RELOAD", strSelector]);

			if (strName === null) {
				return false;
			}

			vecLoadedExtensionNames.splice(vecLoadedExtensionNames.indexOf(strName), 1);

			return LoadExtension(strName);
		},
		ReloadAll() {
			setUsedExports.add("ReloadAllExtensions");
			vecOperationLog.push(["RELOADALL"]);
			vecLoadedExtensionNames.length = 0;

			for (const strName of [...setAvailableExtensionNames].sort()) {
				if (!setDisabledExtensionNames.has(strName) && setAutoloadExtensionNames.has(strName)) {
					LoadExtension(strName);
				}
			}

			return true;
		},
		Unload(strSelector) {
			setUsedExports.add("UnloadExtension");

			return UnloadExtension(strSelector);
		},
		UnloadAll() {
			setUsedExports.add("UnloadAllExtensions");
			vecOperationLog.push(["UNLOADALL"]);
			vecLoadedExtensionNames.length = 0;

			return true;
		},
	};

	return {
		AvailableExtensionNames: setAvailableExtensionNames,
		DisabledExtensionNames: setDisabledExtensionNames,
		LoadedExtensionNames: vecLoadedExtensionNames,
		NativeExtensions,
		OperationLog: vecOperationLog,
		UsedExports: setUsedExports,
	};
}

function LoadExtensionsPackage(NativeExtensions) {
	globalThis.sourcejs = { extensions: NativeExtensions };

	for (const strModulePath of g_vecDependencyPaths) {
		delete require.cache[strModulePath];
	}

	return require(g_strExtensionsPackagePath);
}

function ExtractJavaScriptBlocks(strDocumentation) {
	return Array.from(strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function ReadNativeDefinition(strSource, strSignature) {
	const unMaximumDefinitionLineCount = 300;
	const vecLines = strSource.split(/\r?\n/);
	const nStart = vecLines.findIndex(strLine => strLine.startsWith(strSignature));
	g_Assert.ok(nStart >= 0, strSignature);
	const strIndent = vecLines[nStart].match(/^\s*/)[0];
	const nEnd = vecLines.findIndex((strLine, unIndex) => (unIndex > nStart) && (strLine === `${strIndent}}`));
	g_Assert.ok((nEnd > nStart) && ((nEnd - nStart) < unMaximumDefinitionLineCount), strSignature);

	return vecLines.slice(nStart, nEnd + 1).join("\n");
}

function VerifyExtensionBindingContracts(strRuntime, strManager) {
	const strRequire = ReadNativeDefinition(strRuntime, "\tbool V8Runtime::RequirePackageModule(");
	const nFileLookup = strRequire.indexOf("std::filesystem::is_regular_file(PathModule, ErrorCode)");
	const nExtensionLookup = strRequire.indexOf("Manager.FindNativeModule(strModuleName)");
	const nCreateBindings = strRequire.indexOf("CreateExtensionBindingModule(");
	g_Assert.ok((nExtensionLookup >= 0) && (nCreateBindings > nExtensionLookup) && (nFileLookup > nCreateBindings), "Native extensions use the reserved namespace before ordinary package files.");

	const strInvalidate = ReadNativeDefinition(strRuntime, "\tvoid V8Runtime::InvalidateExtensionModules(");
	g_Assert.match(strInvalidate, /"extensions\/" \+ strExtensionName \+ "\/"/);
	g_Assert.match(strInvalidate, /m_mapPackageModuleCache\.erase\(itModuleCache\)/);
	g_Assert.match(strInvalidate, /mapModuleCache\.erase\(itModuleCache\)/);

	const strLoad = ReadNativeDefinition(strManager, "\tbool ExtensionManager::Load(");
	g_Assert.match(strLoad, /CreateExtensionRuntime\(m_pPlatform\)/);
	g_Assert.match(strLoad, /ReadExtensionNativeModules\(/);
	g_Assert.doesNotMatch(strLoad, /RequirePackageModule\(|LocalWrapperFunction->Call\(/);

	const strUnload = ReadNativeDefinition(strManager, "\tbool ExtensionManager::Unload(");
	const nRevoke = strUnload.indexOf("m_bLoaded = false");
	const nDispose = strUnload.indexOf("m_pRuntime.reset()");
	const nClose = strUnload.indexOf("CloseLibrary(");
	g_Assert.ok((nRevoke >= 0) && (nDispose > nRevoke) && (nClose > nDispose), "Revocation and isolate disposal precede library close.");
}

function RunDocumentationBlock(strSource, ExtensionsAPI, vecLogRecords = [], strSourcePath = g_strDocumentationPath) {
	let unEchoCallCount = 0;
	const RejectDocumentationConsole = () => {
		throw new Error("Extension documentation must use the typed logger.");
	};
	const DocumentationConsole = new Proxy({}, { get: RejectDocumentationConsole });
	const Context = g_VM.createContext({
		console: DocumentationConsole,
		require(strName) {
			if (strName === "extensions/echo/echo") {
				return {
					Echo(strValue) {
						unEchoCallCount += 1;

						return strValue;
					},
				};
			}

			if (strName === "loggers") {
				// Records calls only; native formatting and log sinks are not exercised.
				return {
					LogInfo(strFormat, ...vecArguments) {
						vecLogRecords.push([strFormat, ...vecArguments]);
					},
				};
			}

			if (strName !== "extensions") {
				throw new Error("Unexpected documentation import: " + strName);
			}

			return ExtensionsAPI;
		},
	});

	new g_VM.Script(strSource, { filename: strSourcePath }).runInContext(Context);

	return unEchoCallCount;
}

function VerifyDocumentationLoggingContracts() {
	const vecLogRecords = [];
	g_Assert.equal(RunDocumentationBlock('require("loggers").LogInfo("Extension example %s", "echo");', {}, vecLogRecords), 0);
	g_Assert.deepEqual(vecLogRecords, [["Extension example %s", "echo"]]);
	g_Assert.equal(RunDocumentationBlock('require("extensions/echo/echo").Echo("echo");', {}), 1);
	g_Assert.throws(() => RunDocumentationBlock('console.log("Unexpected console output");', {}), /must use the typed logger/);
	g_Assert.throws(() => RunDocumentationBlock('require("Unknown");', {}), /Unexpected documentation import/);
}

function VerifyEchoDocumentationExample(strExample) {
	const vecJavaScriptBlocks = [...strExample.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)].map(vecBlockMatch => vecBlockMatch[1]);
	g_Assert.equal(vecJavaScriptBlocks.length, 1, "Echo README must contain one executable JavaScript example.");

	const strEchoSource = g_FileSystem.readFileSync(g_Path.join(g_Path.dirname(g_strEchoExamplePath), "Echo.cpp"), "utf8");
	g_Assert.match(strEchoSource, /#include <v8\.h>/);
	g_Assert.match(strEchoSource, /v8::FunctionCallbackInfo<v8::Value>/);
	g_Assert.match(strEchoSource, /SourceJS_GetNativeExtensionAPI/);

	const vecLogRecords = [];
	g_Assert.equal(RunDocumentationBlock(vecJavaScriptBlocks[0], {}, vecLogRecords, g_strEchoExamplePath), 1, "Echo README must invoke the published module once.");
	g_Assert.deepEqual(vecLogRecords, [["%s", "SourceJS"]], "Echo README must use the typed logger.");

	const strConsoleExample = vecJavaScriptBlocks[0].replace('LogInfo("%s", Echo("SourceJS"));', 'console.log(Echo("SourceJS"));');
	g_Assert.notEqual(strConsoleExample, vecJavaScriptBlocks[0], "Echo logging regression anchor must remain current.");
	g_Assert.throws(() => RunDocumentationBlock(strConsoleExample, {}, [], g_strEchoExamplePath), /must use the typed logger/);
}

function VerifyDocumentationRestorationFailures(vecBlocks) {
	const unUnloadDocumentationBlockIndex = 4;
	const unDisableDocumentationBlockIndex = 7;
	const unBulkUnloadDocumentationBlockIndex = 8;

	const OperationError = new Error("Controlled extension operation failure.");
	const RestorationError = new Error("Controlled extension restoration failure.");
	const vecScenarios = [
		{ BlockIndex: unUnloadDocumentationBlockIndex, Operation: "UnloadExtension", Restoration: "LoadExtension" },
		{ BlockIndex: unDisableDocumentationBlockIndex, Operation: "DisableExtension", Restoration: "EnableExtension" },
		{ BlockIndex: unBulkUnloadDocumentationBlockIndex, Operation: "UnloadAllExtensions", Restoration: "ReloadAllExtensions" },
	];
	for (const Scenario of vecScenarios) {
		for (const OperationFailure of [{ Value: OperationError }, { Value: null }, { Value: undefined }, { Value: 0 }, null]) {
			for (const strRestorationMode of ["SUCCESS", "FALSE", "THROWS"]) {
				const Fixture = CreateExtensionFixture();
				const OriginalAPI = LoadExtensionsPackage(Fixture.NativeExtensions);
				const API = { ...OriginalAPI };
				let bOperationAttempted = false;
				let unRestorationAttempts = 0;
				API[Scenario.Operation] = (...vecArguments) => {
					bOperationAttempted = true;
					const bResult = OriginalAPI[Scenario.Operation](...vecArguments);
					if (OperationFailure !== null) {
						throw OperationFailure.Value;
					}

					return bResult;
				};
				API[Scenario.Restoration] = (...vecArguments) => {
					if (!bOperationAttempted) {
						return OriginalAPI[Scenario.Restoration](...vecArguments);
					}

					++unRestorationAttempts;

					if (strRestorationMode === "THROWS") {
						throw RestorationError;
					}

					return (strRestorationMode === "SUCCESS") ? OriginalAPI[Scenario.Restoration](...vecArguments) : false;
				};
				const Execute = () => RunDocumentationBlock(vecBlocks[Scenario.BlockIndex], API);
				const VerifyFailure = Failure => {
					if (strRestorationMode === "SUCCESS") {
						g_Assert.notEqual(OperationFailure, null);
						g_Assert.equal(Failure, OperationFailure.Value);

					} else if (OperationFailure !== null) {
						g_Assert.equal(Failure?.name, "AggregateError", "Restoration must not hide the original operation failure.");
						g_Assert.equal(Failure.errors.length, 2);
						g_Assert.equal(Failure.errors[0], OperationFailure.Value);

						if (strRestorationMode === "THROWS") {
							g_Assert.equal(Failure.errors[1], RestorationError);
						} else {
							g_Assert.match(Failure.errors[1].message, /Could not restore|Could not enable and restore|autoload scan/);
						}

					} else if (strRestorationMode === "THROWS") {
						g_Assert.equal(Failure, RestorationError);

					} else {
						g_Assert.match(Failure.message, /Could not restore|Could not enable and restore|autoload scan/);
					}

					return true;
				};
				if ((OperationFailure === null) && (strRestorationMode === "SUCCESS")) {
					g_Assert.doesNotThrow(Execute);
				} else {
					g_Assert.throws(Execute, VerifyFailure);
				}

				g_Assert.equal(unRestorationAttempts, 1);
			}
		}
	}
}

try {
	VerifyDocumentationLoggingContracts();

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_Fixture = CreateExtensionFixture();
	const g_Extensions = LoadExtensionsPackage(g_Fixture.NativeExtensions);
	g_Assert.deepEqual(Object.keys(g_Extensions).sort(), [...g_vecExpectedExports].sort());
	g_Assert.match(g_Extensions.GetLoadedExtensions()[0], /^1\. echo \[loaded, enabled\] /);
	g_Assert.equal(g_Extensions.LoadExtension("echo"), true);
	g_Assert.equal(g_Extensions.LoadExtension("1"), false);
	g_Assert.equal(g_Extensions.ReloadExtension("2"), true);
	g_Assert.equal(g_Extensions.UnloadExtension("metrics"), true);
	g_Assert.equal(g_Extensions.GetLoadedExtensions().some((strLine) => strLine.includes(". metrics [")), false);
	g_Assert.equal(g_Extensions.DisableExtension("echo"), true);
	g_Assert.equal(g_Fixture.DisabledExtensionNames.has("echo"), true);
	g_Assert.deepEqual(g_Extensions.GetLoadedExtensions(), ["No extensions loaded."]);
	g_Assert.equal(g_Extensions.ReloadAllExtensions(), true);
	g_Assert.deepEqual(g_Extensions.GetLoadedExtensions(), ["1. metrics [loaded, enabled] C:/game/addons/sourcejs/extensions/metrics/bin/windows-x86/metrics.dll"]);
	g_Assert.equal(g_Extensions.EnableExtension("echo"), true);
	g_Assert.equal(g_Fixture.DisabledExtensionNames.has("echo"), false);
	g_Assert.equal(g_Extensions.UnloadAllExtensions(), true);
	g_Assert.deepEqual(g_Extensions.GetLoadedExtensions(), ["No extensions loaded."]);
	g_Assert.equal(g_Extensions.ReloadAllExtensions(), true);
	g_Assert.throws(() => g_Extensions.LoadExtension(1), /non-empty extension string/);
	g_Assert.throws(() => g_Extensions.UnloadExtension(""), /non-empty extension string/);
	g_Assert.equal(Object.hasOwn(g_Extensions, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Extensions, "default"), false);

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_EchoManifest = JSON.parse(g_FileSystem.readFileSync(g_strEchoManifestPath, "utf8"));
	g_Assert.deepEqual(Object.keys(g_EchoManifest).sort(), ["Autoload", "Description", "Name"]);
	g_Assert.equal(g_EchoManifest.Name, "echo");
	g_Assert.equal(g_EchoManifest.Autoload, false);
	g_Assert.equal(typeof g_EchoManifest.Description, "string");
	g_Assert.match(g_strDocumentation, /`Binary` field/);
	g_Assert.match(g_strDocumentation, /`Autoload` defaults to `true`/);

	const g_strArchitectureDocumentation = g_FileSystem.readFileSync(g_strArchitectureDocumentationPath, "utf8");
	const g_vecArchitectureExtensionSectionMatch = g_strArchitectureDocumentation.match(/## Extension Model\r?\n([\s\S]*?)\r?\n## Runtime Command Model/);
	g_Assert.notEqual(g_vecArchitectureExtensionSectionMatch, null, "Architecture documentation must describe extensions.");
	const g_strArchitectureExtensionSection = g_vecArchitectureExtensionSectionMatch[1];
	const g_vecArchitectureManifestMatch = g_strArchitectureExtensionSection.match(/```json\r?\n([\s\S]*?)```/);
	g_Assert.notEqual(g_vecArchitectureManifestMatch, null, "Architecture documentation must include a copyable extension manifest.");
	const g_ArchitectureExtensionManifest = JSON.parse(g_vecArchitectureManifestMatch[1]);
	g_Assert.deepEqual(g_ArchitectureExtensionManifest, g_EchoManifest, "Documented extension manifest must match the shipped example.");

	const g_unExpectedDocumentationBlockCount = 9;
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setDocumentationUsedExports = new Set();
	let g_unDocumentationEchoCallCount = 0;

	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);
	g_Assert.doesNotMatch(g_strDocumentation, /Generated by|load_example|unload_example|const result =|console\.log\(result\)/);
	g_Assert.equal(/(?:`|\.)(?:disable|enable|list|load|reload|reloadAll|unload|unloadAll)(?:\(|`)/.test(g_strDocumentation), false, "Extension documentation must use the exact PascalCase API names.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable extension documentation must use typed logging.");
	g_Assert.match(g_strDocumentation, /ExtensionsState\.json/);
	g_Assert.match(g_strDocumentation, /one-based decimal string/);
	VerifyDocumentationRestorationFailures(g_vecDocumentationBlocks);

	for (const strBlock of g_vecDocumentationBlocks) {
		const DocumentationFixture = CreateExtensionFixture();
		g_unDocumentationEchoCallCount += RunDocumentationBlock(strBlock, LoadExtensionsPackage(DocumentationFixture.NativeExtensions));

		for (const strName of DocumentationFixture.UsedExports) {
			g_setDocumentationUsedExports.add(strName);
		}
	}

	g_Assert.ok(g_unDocumentationEchoCallCount > 0, "Documentation must call the extension-published Echo function.");

	const g_vecReloadScenarios = [
		{ AutoloadExtensionNames: [], LoadFailureExtensionNames: [], ExpectedLoadedNames: [] },
		{ AutoloadExtensionNames: ["metrics"], LoadFailureExtensionNames: ["metrics"], ExpectedLoadedNames: [] },
		{ AutoloadExtensionNames: ["echo", "metrics"], LoadFailureExtensionNames: ["echo"], ExpectedLoadedNames: ["metrics"] },
	];
	for (const Scenario of g_vecReloadScenarios) {
		const Fixture = CreateExtensionFixture(Scenario);
		RunDocumentationBlock(g_vecDocumentationBlocks.at(-1), LoadExtensionsPackage(Fixture.NativeExtensions));
		g_Assert.deepEqual(Fixture.LoadedExtensionNames, Scenario.ExpectedLoadedNames);

		const vecAttemptedLoads = Fixture.OperationLog.filter((vecOperation) => vecOperation[0] === "LOAD").map((vecOperation) => vecOperation[1]);
		g_Assert.deepEqual(vecAttemptedLoads, Scenario.AutoloadExtensionNames, "Reload scenarios must attempt the configured autoload extension names.");
	}

	const g_LoadFailureFixture = CreateExtensionFixture({ LoadFailureExtensionNames: ["echo"] });
	const g_LoadFailureExtensions = LoadExtensionsPackage(g_LoadFailureFixture.NativeExtensions);
	g_Assert.equal(g_LoadFailureExtensions.DisableExtension("echo"), true);
	g_Assert.equal(g_LoadFailureExtensions.EnableExtension("echo"), false);
	g_Assert.equal(g_LoadFailureFixture.DisabledExtensionNames.has("echo"), false);
	g_Assert.equal(g_LoadFailureFixture.LoadedExtensionNames.includes("echo"), false);

	const g_MissingDirectoryFixture = CreateExtensionFixture();
	const g_MissingDirectoryExtensions = LoadExtensionsPackage(g_MissingDirectoryFixture.NativeExtensions);
	g_Assert.equal(g_MissingDirectoryExtensions.UnloadExtension("echo"), true);
	g_MissingDirectoryFixture.AvailableExtensionNames.delete("echo");
	g_MissingDirectoryFixture.DisabledExtensionNames.add("echo");
	g_Assert.equal(g_MissingDirectoryExtensions.EnableExtension("echo"), false);
	g_Assert.equal(g_MissingDirectoryFixture.DisabledExtensionNames.has("echo"), false);

	g_Assert.deepEqual([...g_setDocumentationUsedExports].sort(), [...g_vecExpectedExports].sort(), "Documentation must exercise every extensions API export.");

	const g_strNativeSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	const g_nExtensionBindingStart = g_strNativeSource.indexOf("bool ParseExtensionStringArgument");
	const g_nExtensionBindingEnd = g_strNativeSource.indexOf("void ListExtensionsCallback", g_nExtensionBindingStart);
	g_Assert.ok((g_nExtensionBindingStart >= 0) && (g_nExtensionBindingEnd > g_nExtensionBindingStart), "Native extension argument-parser markers must exist in dependency order.");

	const g_strExtensionBinding = g_strNativeSource.slice(g_nExtensionBindingStart, g_nExtensionBindingEnd);
	g_Assert.match(g_strExtensionBinding, /!LocalExtensionValue->IsString\(\)/);
	g_Assert.match(g_strExtensionBinding, /strExtensionValue\.empty\(\)/);
	g_Assert.match(g_strNativeSource, /extensions\.Load\(strExtensionName\) expects a non-empty extension name string/);
	g_Assert.match(g_strNativeSource, /extensions\.Unload\(strExtensionSelector\) expects a non-empty extension name or one-based index string/);
	g_Assert.match(g_strNativeSource, /extensions\.Reload\(strExtensionSelector\) expects a non-empty extension name or one-based index string/);
	g_Assert.match(g_strNativeSource, /extensions\.Disable\(strExtensionSelector\) expects a non-empty extension name or one-based index string/);
	g_Assert.match(g_strNativeSource, /extensions\.Enable\(strExtensionSelector\) expects a non-empty extension name or one-based index string/);
	g_Assert.doesNotMatch(g_strExtensionBinding, /Args\.Length\(\) > 0 \? ValueToString/);

	const g_strExtensionHeader = g_FileSystem.readFileSync(g_strExtensionHeaderPath, "utf8");
	const g_strExtensionManager = g_FileSystem.readFileSync(g_strExtensionManagerPath, "utf8");
	const g_strV8Runtime = g_FileSystem.readFileSync(g_strV8RuntimePath, "utf8");
	const g_strEchoExample = g_FileSystem.readFileSync(g_strEchoExamplePath, "utf8");
	VerifyExtensionBindingContracts(g_strV8Runtime, g_strExtensionManager);
	VerifyEchoDocumentationExample(g_strEchoExample);

	g_Assert.match(g_strExtensionHeader, /#define SOURCEJS_EXTENSION_ABI_VERSION 3/);
	g_Assert.match(g_strExtensionHeader, /fnSourceJSExtensionGetModuleCount m_pGetModuleCount/);
	g_Assert.match(g_strExtensionHeader, /fnSourceJSExtensionGetModule m_pGetModule/);
	g_Assert.match(g_strExtensionManager, /m_pGetModuleCount\(\)/);
	g_Assert.match(g_strExtensionManager, /m_pGetModule\(unModuleIndex, &Module\)/);
	g_Assert.match(g_strEchoExample, /require\("extensions\/echo\/echo"\)/);
	g_Assert.match(g_strDocumentation, /require\("extensions\/echo\/echo"\)/);

	delete require.cache[g_strExtensionsPackagePath];
	delete require.cache[g_strRuntimePath];
	globalThis.sourcejs = {};
	g_Assert.throws(() => require(g_strExtensionsPackagePath), { name: "Error", message: /^SourceJS module is not installed: extensions/ });

	console.log("[  OK  ] extensions API and documentation passed with controlled doubles/source guards; native extension loading not exercised");
} finally {
	for (const strModulePath of g_vecDependencyPaths) {
		const OriginalDependency = g_mapOriginalDependencies.get(strModulePath);
		if (OriginalDependency === undefined) {
			delete require.cache[strModulePath];
		} else {
			require.cache[strModulePath] = OriginalDependency;
		}
	}

	if (g_OriginalNativeDescriptor === undefined) {
		delete globalThis.sourcejs;
	} else {
		Object.defineProperty(globalThis, "sourcejs", g_OriginalNativeDescriptor);
	}

	g_Module._load = g_OriginalModuleLoad;
}
