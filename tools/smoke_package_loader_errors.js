#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_package_loader_errors.js\nChecks package-loader source contracts and negative regressions; does not execute V8.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_package_loader_errors.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

function ExtractLoaderDefinition(strSource, strMethodName) {
	const strEscapedMethodName = strMethodName.replace(/[.*+?^${}()|[\]\\]/g, strCharacter => "\\" + strCharacter);
	const vecDefinitionMatches = new RegExp("^\\tbool V8Runtime::" + strEscapedMethodName + "\\([^\\n]*\\)(?: noexcept)?(?: try)? \\{$", "m").exec(strSource);
	g_Assert.ok(vecDefinitionMatches, "Missing V8Runtime loader definition: " + strMethodName);

	const nDefinitionStart = vecDefinitionMatches.index;
	const nDefinitionEnd = strSource.indexOf("\n\t}\n", nDefinitionStart);
	g_Assert.ok(nDefinitionEnd > nDefinitionStart, "Missing V8Runtime loader definition end: " + strMethodName);

	return strSource.slice(nDefinitionStart, nDefinitionEnd);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "V8Runtime.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strOwner = ExtractLoaderDefinition(g_strSource, "RequirePackageModule");
let g_unRejectedRegressionCount = 0;

function AssertModuleOutput(strOwner) {
	g_Assert.doesNotMatch(strOwner, /\bLocalModuleOut\s*=\s*\{\s*\}/, "Module output must not be cleared on failure");
	g_Assert.equal([...strOwner.matchAll(/\bLocalModuleOut\s*=/g)].length, 2, "Expected cached and newly loaded output commits only");
	g_Assert.equal([...strOwner.matchAll(/\bLocalModuleOut\s*=\s*HandleScope\.Escape\([^\r\n]+\);/g)].length, 2);
}

function AssertPackageLoader(strOwner) {
	AssertModuleOutput(strOwner);
	g_Assert.match(strOwner, /auto FailPackageModule = \[this, &PackageModuleTryCatch, &strModuleName\]/);
	g_Assert.match(strOwner, /if \(!PackageModuleTryCatch\.HasCaught\(\)\) \{\s*std::string const strErrorMessage[^\n]+\s*ThrowRuntimeError\(m_pIsolate, strErrorMessage\);/);
	g_Assert.match(strOwner, /if \(PackageModuleTryCatch\.HasCaught\(\)\) \{\s*PackageModuleTryCatch\.ReThrow\(\);/);
	g_Assert.match(strOwner, /if \(!ReadFile\(PathModule, strSource\)\) \{\s*ThrowRuntimeError\(m_pIsolate,/);
	g_Assert.match(strOwner, /if \(!v8::ScriptCompiler::Compile[^\n]+\{\s*return FailPackageModule\("Could not compile package module\."\);/);
	g_Assert.match(strOwner, /if \(!LocalScript->Run[^\n]+\{\s*return FailPackageModule\("Could not evaluate package module wrapper\."\);/);
	g_Assert.match(strOwner, /if \(!LocalGlobalObject->Get[^\n]+\{\s*return FailPackageModule\(kRequireFunctionError\);/);
	g_Assert.match(strOwner, /if \(!LocalWrapperFunction->Call[^\n]+\{\s*RemoveEvaluationCacheEntry\(\);\s*return FailPackageModule\("Could not execute package module\."\);/);
	g_Assert.match(strOwner, /if \(!LocalModuleObject->Get[^\n]+\{\s*RemoveEvaluationCacheEntry\(\);\s*return FailPackageModule\("Could not read CommonJS exports object\."\);/);
	g_Assert.match(strOwner, /\(\*pPackageModuleCache\)\[strModuleName\]\.Reset\(m_pIsolate, LocalExportsValue\);/);
	g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*RemoveEvaluationCacheEntry\(\);\s*throw;/);
	g_Assert.match(strOwner, /auto OwnsCacheEntry = \[this, pPackageModuleCache, &strModuleName, LocalExportsObject\]\(\) -> bool/);
	g_Assert.match(strOwner, /return \(itModuleCache != pPackageModuleCache->end\(\)\) && \(itModuleCache->second\.Get\(m_pIsolate\) == LocalExportsObject\);/);
	g_Assert.match(strOwner, /auto RemoveEvaluationCacheEntry = [^\n]+\{\s*if \(OwnsCacheEntry\(\)\) \{\s*pPackageModuleCache->erase\(strModuleName\);/);
	g_Assert.match(strOwner, /if \(OwnsCacheEntry\(\)\) \{\s*\(\*pPackageModuleCache\)\[strModuleName\]\.Reset\(m_pIsolate, LocalExportsValue\);/);
	g_Assert.ok(!strOwner.includes("GlobalCachedPackageModule") && !strOwner.includes("LogError(") && !strOwner.includes("FormatException("));
}

function AssertLocalModuleNames(strOwner, strSource) {
	g_Assert.ok(strOwner.includes("strParentScriptName.find('\\0') != std::string::npos"));
	g_Assert.ok(strOwner.includes("strModuleName.find('\\0') != std::string::npos"));
	g_Assert.ok(strSource.includes("std::string const strModuleName = std::string(*ModuleNameUTF8Value, static_cast<std::size_t>(ModuleNameUTF8Value.length()));"));
	g_Assert.match(strSource, /if \(strModuleName\.find\('\\0'\) != std::string::npos\) \{\s*ThrowRuntimeError\(pIsolate, "Plugin require module name contains a null byte\."\);\s*return;/);
	g_Assert.ok(strSource.includes("RequirePluginLocalModule(std::string(*ParentScriptNameUTF8Value, static_cast<std::size_t>(ParentScriptNameUTF8Value.length())), strModuleName, LocalModule)"));
}

function AssertRegression(strOriginal, strReplacement) {
	g_Assert.ok(g_strOwner.includes(strOriginal), strOriginal);

	const strRegressedOwner = g_strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strRegressedOwner, g_strOwner, "Package-loader regression must change its source: " + strOriginal);
	g_Assert.throws(() => AssertPackageLoader(strRegressedOwner), g_Assert.AssertionError, strOriginal);
	g_unRejectedRegressionCount += 1;
}

// Extractor-only source: prototypes and unrelated methods are never compiled.
const g_strExtractorProbe = [
	"\tbool V8Runtime::ProbePackageLoader();",
	"\tbool V8Runtime::UnrelatedProbe() {",
	"\t\treturn false;",
	"\t}",
	"\tbool V8Runtime::ProbePackageLoader() noexcept {",
	"\t\treturn true;",
	"\t}",
	"",
].join("\n");
g_Assert.equal(ExtractLoaderDefinition(g_strExtractorProbe, "ProbePackageLoader"), "\tbool V8Runtime::ProbePackageLoader() noexcept {\n\t\treturn true;");
g_Assert.throws(() => ExtractLoaderDefinition("\tbool V8Runtime::ProbePackageLoader();\n", "ProbePackageLoader"), g_Assert.AssertionError);
g_unRejectedRegressionCount += 1;

AssertPackageLoader(g_strOwner);

AssertRegression("PackageModuleTryCatch.ReThrow();", "");
AssertRegression("if (!PackageModuleTryCatch.HasCaught())", "if (true)");
AssertRegression("ThrowRuntimeError(m_pIsolate, strErrorMessage);", "");
AssertRegression('return FailPackageModule("Could not compile package module.");', "return false;");
AssertRegression('return FailPackageModule("Could not evaluate package module wrapper.");', "return false;");
AssertRegression("return FailPackageModule(kRequireFunctionError);\n\t\t}\n\n\t\tv8::Local<v8::Value> arrCommonJSArguments", "return false;\n\t\t}\n\n\t\tv8::Local<v8::Value> arrCommonJSArguments");
AssertRegression('RemoveEvaluationCacheEntry();\n\t\t\t\treturn FailPackageModule("Could not execute package module.");', 'return FailPackageModule("Could not execute package module.");');
AssertRegression('RemoveEvaluationCacheEntry();\n\t\t\t\treturn FailPackageModule("Could not read CommonJS exports object.");', 'return FailPackageModule("Could not read CommonJS exports object.");');
AssertRegression("(*pPackageModuleCache)[strModuleName].Reset(m_pIsolate, LocalExportsValue);", "");
AssertRegression("return (itModuleCache != pPackageModuleCache->end()) && (itModuleCache->second.Get(m_pIsolate) == LocalExportsObject);", "return true;");
AssertRegression("if (OwnsCacheEntry()) {\n\t\t\t\tpPackageModuleCache->erase(strModuleName);", "if (true) {\n\t\t\t\tpPackageModuleCache->erase(strModuleName);");
AssertRegression("if (OwnsCacheEntry()) {\n\t\t\t\t(*pPackageModuleCache)[strModuleName].Reset(m_pIsolate, LocalExportsValue);", "if (true) {\n\t\t\t\t(*pPackageModuleCache)[strModuleName].Reset(m_pIsolate, LocalExportsValue);");
AssertRegression("} catch (...) {\n\t\t\tRemoveEvaluationCacheEntry();", "} catch (...) {");

const g_strLocalOwner = ExtractLoaderDefinition(g_strSource, "RequirePluginLocalModule");
for (const strOwner of [g_strOwner, g_strLocalOwner]) {
	AssertModuleOutput(strOwner);
	g_Assert.throws(() => AssertModuleOutput(strOwner + "\nLocalModuleOut = {};"), g_Assert.AssertionError);
	g_unRejectedRegressionCount += 1;
}

AssertLocalModuleNames(g_strLocalOwner, g_strSource);
for (const strGuard of ["strParentScriptName.find('\\0') != std::string::npos", "strModuleName.find('\\0') != std::string::npos"]) {
	g_Assert.throws(() => AssertLocalModuleNames(g_strLocalOwner.replace(strGuard, "false"), g_strSource), g_Assert.AssertionError);
	g_unRejectedRegressionCount += 1;
}

for (const strLengthRead of ["ModuleNameUTF8Value.length()", "ParentScriptNameUTF8Value.length()"]) {
	g_Assert.throws(() => AssertLocalModuleNames(g_strLocalOwner, g_strSource.replace(strLengthRead, "0")), g_Assert.AssertionError);
	g_unRejectedRegressionCount += 1;
}

g_Assert.throws(() => AssertLocalModuleNames(g_strLocalOwner, g_strSource.replace("Plugin require module name contains a null byte.", "ignored")), g_Assert.AssertionError);
g_unRejectedRegressionCount += 1;

console.log("[smoke] package-loader source contracts and " + g_unRejectedRegressionCount + " negative regressions passed; source-only checks do not execute V8");
