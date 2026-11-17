#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strPackagePath = g_Path.join(g_strRootPath, "packages", "sourcejs", "interfaces.js");
const g_strDocumentationPath = g_Path.join(g_strRootPath, "docs", "api", "interfaces.md");
const g_strNativeBindingsPath = g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_vecInterfaceNames = [
	"VEngineServer022",
	"GAMEEVENTSMANAGER002",
	"MDLCache004",
	"VEngineCvar007",
];
const g_mapInterfaceAddresses = new Map([
	["VEngineServer022", 0x1000n],
	["GAMEEVENTSMANAGER002", 0x2000n],
	["MDLCache004", 0x3000n],
	["VEngineCvar007", 0x4000n],
]);

function RequireInterfaceName(strInterfaceName) {
	if ((typeof strInterfaceName !== "string") || (strInterfaceName.length === 0)) {
		throw new Error("interfaces.GetInterfaceRecord(strInterfaceName) expects a non-empty interface name string.");
	}

	return strInterfaceName;
}

const g_NativeInterfaces = {
	GetAllInterfaceNames() {
		return [...g_mapInterfaceAddresses.keys()];
	},

	GetInterfaceRecord(strInterfaceName) {
		const strResolvedInterfaceName = RequireInterfaceName(strInterfaceName);
		const unInterfaceAddress = g_mapInterfaceAddresses.get(strResolvedInterfaceName);
		if (unInterfaceAddress === undefined) {
			return null;
		}

		return { Name: strResolvedInterfaceName, Available: true, Address: unInterfaceAddress };
	},
};

const g_DocumentationModules = {
	interfaces: g_NativeInterfaces,
	"memory/helpers": {
		VirtualTable(unInterfaceAddress) {
			g_Assert.equal(typeof unInterfaceAddress, "bigint");
			g_Assert.equal(g_mapInterfaceAddresses.has("GAMEEVENTSMANAGER002"), true);
			g_Assert.equal(unInterfaceAddress, g_mapInterfaceAddresses.get("GAMEEVENTSMANAGER002"));

			return unInterfaceAddress + 0x80n;
		},
	},
};

function ExtractDocumentationBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

// Each load owns its bridge and both dependency cache entries, including failure paths.
function LoadInterfaces(NativeInterfaces = undefined) {
	const OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const OriginalModuleLoad = g_Module._load;
	const vecCachePaths = [g_strPackagePath, g_strRuntimePath];
	const mapOriginalCacheEntries = new Map(vecCachePaths.map((strPath) => [strPath, require.cache[strPath]]));

	try {
		for (const strPath of vecCachePaths) {
			delete require.cache[strPath];
		}

		if (NativeInterfaces === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { interfaces: NativeInterfaces } });
		}

		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strPackagePath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		for (const [strPath, CacheEntry] of mapOriginalCacheEntries) {
			delete require.cache[strPath];

			if (CacheEntry !== undefined) {
				require.cache[strPath] = CacheEntry;
			}
		}

		if (OriginalSourceJSDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", OriginalSourceJSDescriptor);
		}
	}
}

function RestoreInterfaceAddresses(mapSnapshot) {
	g_mapInterfaceAddresses.clear();

	for (const vecInterfaceEntry of mapSnapshot) {
		const strInterfaceName = vecInterfaceEntry[0];
		const unInterfaceAddress = vecInterfaceEntry[1];
		g_mapInterfaceAddresses.set(strInterfaceName, unInterfaceAddress);
	}
}

function VerifyNativeInterfaceBindings(strInterfaceBindings) {
	g_Assert.match(strInterfaceBindings, /GetInterfaceNames\(\)/);
	g_Assert.match(strInterfaceBindings, /LocalInterfaceNamesArray/);
	g_Assert.match(strInterfaceBindings, /CallbackInformation\.Length\(\) < kRequiredArgumentCount/);
	g_Assert.match(strInterfaceBindings, /strInterfaceName\.empty\(\)/);
	g_Assert.match(strInterfaceBindings, /GetInterface\(strInterfaceName\)/);
	g_Assert.match(strInterfaceBindings, /CallbackInformation\.GetReturnValue\(\)\.Set\(v8::Null\(pIsolate\)\)/);
	g_Assert.match(strInterfaceBindings, /std::string\(\*UTF8InterfaceName, static_cast<std::size_t>\(UTF8InterfaceName\.length\(\)\)\)/);
	g_Assert.match(strInterfaceBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalInterfaceObject, kNamePropertyName, MakeString\(pIsolate, strInterfaceName\)\)/);
	g_Assert.match(strInterfaceBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalInterfaceObject, kAvailablePropertyName, v8::Boolean::New\(pIsolate, kInterfaceAvailable\)\)/);
	g_Assert.match(strInterfaceBindings, /SetRecordProperty\(pIsolate, LocalContext, LocalInterfaceObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned\(pIsolate, static_cast<std::uint64_t>\(unInterfaceAddress\)\)/);
	g_Assert.match(strInterfaceBindings, /LocalInterfaceNamesArray->CreateDataProperty\(/);
	g_Assert.doesNotMatch(strInterfaceBindings, /LocalInterfaceNamesArray->Set\(/);
	g_Assert.equal((strInterfaceBindings.match(/} catch \(\.\.\.\) {/g) ?? []).length, 2, "Both interface callbacks must contain C++ failures");
	g_Assert.doesNotMatch(strInterfaceBindings, /"address"/);
	g_Assert.doesNotMatch(strInterfaceBindings, /"addressString"/);
}

function RunDocumentationExample(strExampleSource) {
	const unExecutionTimeoutMilliseconds = 1000;

	const vecLogMessages = [];
	function LogInfo(strMessage) {
		g_Assert.equal(arguments.length, 1, "Interface documentation must pass one complete diagnostic string to LogInfo.");
		g_Assert.equal(typeof strMessage, "string", "Interface documentation must not log raw objects or BigInt addresses.");
		g_Assert.doesNotMatch(strMessage, /^\[(?:DEBUG|INFO|WARNING|ERROR)\](?:\s|$)/, "LogInfo owns the severity prefix.");
		vecLogMessages.push(strMessage);
	}

	const RequireDocumentationModule = strModuleName => {
		if (strModuleName === "loggers") {
			return { LogInfo };
		}

		if (!Object.hasOwn(g_DocumentationModules, strModuleName)) {
			throw new Error(`Unexpected documentation module: ${strModuleName}`);
		}

		return g_DocumentationModules[strModuleName];
	};
	const Context = g_VM.createContext({
		require: RequireDocumentationModule,
		console: {
			log() {
				throw new Error("Interface documentation must use LogInfo instead of console.log.");
			},
		},
	});
	const Script = new g_VM.Script(strExampleSource, { filename: "interfaces-documentation-example.js" });
	Script.runInContext(Context, { timeout: unExecutionTimeoutMilliseconds });

	return vecLogMessages;
}

const g_Interfaces = LoadInterfaces(g_NativeInterfaces);
const g_vecFirstNames = g_Interfaces.GetAllInterfaceNames();
const g_vecSecondNames = g_Interfaces.GetAllInterfaceNames();
const g_FirstEngineInterface = g_Interfaces.GetInterfaceRecord("VEngineServer022");
const g_SecondEngineInterface = g_Interfaces.GetInterfaceRecord("VEngineServer022");

g_Assert.strictEqual(g_Interfaces, g_NativeInterfaces);
g_Assert.deepEqual(Object.keys(g_Interfaces).sort(), ["GetAllInterfaceNames", "GetInterfaceRecord"]);
g_Assert.deepEqual(g_vecFirstNames, g_vecInterfaceNames);
g_Assert.notStrictEqual(g_vecFirstNames, g_vecSecondNames);
g_vecFirstNames.pop();
g_Assert.deepEqual(g_vecSecondNames, g_vecInterfaceNames, "GetAllInterfaceNames() results must not share mutable arrays");
g_Assert.notStrictEqual(g_FirstEngineInterface, g_SecondEngineInterface);
g_Assert.deepEqual(g_FirstEngineInterface, { Name: "VEngineServer022", Available: true, Address: 0x1000n });
g_Assert.equal(typeof g_FirstEngineInterface.Address, "bigint");
g_Assert.equal(g_FirstEngineInterface.Address > 0n, true);
g_Assert.equal("m_strName" in g_FirstEngineInterface, false);
g_Assert.equal("m_bAvailable" in g_FirstEngineInterface, false);
g_Assert.equal("m_pAddress" in g_FirstEngineInterface, false);
g_Assert.equal("address" in g_FirstEngineInterface, false);
g_Assert.equal("addressString" in g_FirstEngineInterface, false);
g_Assert.equal(g_Interfaces.GetInterfaceRecord("missing"), null);
g_Assert.equal(g_Interfaces.GetInterfaceRecord("ICvar"), null);

const g_EditableEngineInterface = g_Interfaces.GetInterfaceRecord("VEngineServer022");
g_Assert.deepEqual(Object.keys(g_EditableEngineInterface).sort(), ["Address", "Available", "Name"]);
g_EditableEngineInterface.Name = "EditedInterface";
g_EditableEngineInterface.Address = 0n;
delete g_EditableEngineInterface.Available;
g_Assert.deepEqual(g_Interfaces.GetInterfaceRecord("VEngineServer022"), g_SecondEngineInterface, "editing a record must not update native registry metadata");

const g_mapOriginalInterfaceAddresses = new Map(g_mapInterfaceAddresses);
try {
	g_mapInterfaceAddresses.set("VEngineServer022", 0x5000n);
	g_Assert.deepEqual(g_Interfaces.GetAllInterfaceNames(), g_vecInterfaceNames, "replacing an existing registry entry must not duplicate or reorder names");
	g_Assert.equal(g_Interfaces.GetInterfaceRecord("VEngineServer022").Address, 0x5000n);
	g_Assert.equal(g_SecondEngineInterface.Address, 0x1000n, "retained records must remain point-in-time snapshots");

	g_mapInterfaceAddresses.clear();
	g_Assert.deepEqual(g_Interfaces.GetAllInterfaceNames(), [], "fresh inventory must reflect a cleared registry");
	g_Assert.equal(g_Interfaces.GetInterfaceRecord("VEngineServer022"), null, "cleared registry entries must become normal lookup misses");
	g_Assert.equal(g_SecondEngineInterface.Available, true, "a retained Available field does not track disconnect");
	g_Assert.equal(g_SecondEngineInterface.Address, 0x1000n);
} finally {
	RestoreInterfaceAddresses(g_mapOriginalInterfaceAddresses);
}

// Model-only 64-bit metadata: never dereference this synthetic address.
const g_unHighInterfaceAddress = 0xFEDCBA9876543210n;
try {
	g_mapInterfaceAddresses.set("SourceJSTestInterface001", g_unHighInterfaceAddress);
	g_Assert.equal(g_Interfaces.GetInterfaceRecord("SourceJSTestInterface001").Address, g_unHighInterfaceAddress);
} finally {
	g_mapInterfaceAddresses.delete("SourceJSTestInterface001");
}

for (const strUnknownName of [
	"VEngineServer022\0Suffix",
	"VEngineServer022\0",
	"\0VEngineServer022",
	"\0",
	"接口",
	"SourceJSUnknownInterface999",
	"vengineserver022",
	" VEngineServer022",
	"VEngineServer022 ",
]) {
	g_Assert.equal(g_Interfaces.GetInterfaceRecord(strUnknownName), null, "interface names must preserve their complete UTF8 byte identity");
}

for (const InvalidName of [
	undefined,
	null,
	"",
	0,
	true,
	{},
	[],
	Object("VEngineServer022"),
]) {
	g_Assert.throws(() => g_Interfaces.GetInterfaceRecord(InvalidName), { name: "Error", message: /expects a non-empty interface name string/ }, `interfaces.GetInterfaceRecord() must reject ${String(InvalidName)}`);
}

g_Assert.deepEqual(g_Interfaces.GetAllInterfaceNames("ignored"), g_vecInterfaceNames);
g_Assert.deepEqual(g_Interfaces.GetInterfaceRecord("VEngineServer022", "ignored"), g_SecondEngineInterface);

let g_unNameCoercionCount = 0;
const g_CoercibleInterfaceName = {
	toString() {
		g_unNameCoercionCount++;

		return "VEngineServer022";
	},
};
g_Assert.throws(() => g_Interfaces.GetInterfaceRecord(g_CoercibleInterfaceName), { name: "Error", message: /expects a non-empty interface name string/ });
g_Assert.equal(g_unNameCoercionCount, 0, "strict interface lookup must not coerce objects to strings");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecExamples = ExtractDocumentationBlocks(g_strDocumentation);
g_Assert.equal(g_vecExamples.length, 8, "interfaces documentation must contain eight executable JavaScript blocks");

const g_vecExpectedDocumentationLogMessages = [
	"Connected interface inventory {\"EngineInterfaceNames\":[\"VEngineServer022\",\"VEngineCvar007\"],\"GameServerInterfaceNames\":[],\"InterfaceCount\":4}",
	"Connected engine server interface Name=\"VEngineServer022\"",
	"Connected interface {\"Available\":true,\"Address\":\"0x1000\",\"Name\":\"VEngineServer022\"}",
	"Interface capability {\"HasVoiceServerInterface\":false,\"UnknownInterfaceRecord\":null}",
	"Connected event manager interface Address=0x2000",
	"Connected interface groups {\"EngineInterfaceNames\":[\"VEngineServer022\",\"GAMEEVENTSMANAGER002\",\"VEngineCvar007\"],\"GameServerInterfaceNames\":[],\"OtherInterfaceNames\":[\"MDLCache004\"]}",
	"Connected model cache interface Address=0x3000",
	"Connected event manager interface Address=0x2000 VirtualTableAddress=0x2080",
];

let g_unExecutedDocumentationExampleCount = 0;
for (const [unExampleIndex, strExampleSource] of g_vecExamples.entries()) {
	const vecLogMessages = RunDocumentationExample(strExampleSource);
	g_Assert.deepEqual(vecLogMessages, [g_vecExpectedDocumentationLogMessages[unExampleIndex]], "Interface documentation must preserve its complete diagnostic payload.");
	++g_unExecutedDocumentationExampleCount;
}

g_Assert.equal(g_unExecutedDocumentationExampleCount, g_vecExamples.length, "All eight interfaces documentation examples must execute.");

const g_strModelCacheExample = g_vecExamples.find((strExampleSource) => strExampleSource.includes("function GetInterfaceRecordByPrefix("));
g_Assert.equal(typeof g_strModelCacheExample, "string");

try {
	g_mapInterfaceAddresses.set("MDLCache003", 0x6000n);
	g_Assert.throws(() => RunDocumentationExample(g_strModelCacheExample), { name: "Error", message: /Ambiguous interface prefix: MDLCache/ }, "prefix discovery must reject ambiguous loaded versions");
} finally {
	g_mapInterfaceAddresses.delete("MDLCache003");
}

const g_strEngineServerExample = g_vecExamples.find((strExampleSource) => strExampleSource.includes("const g_ReportEngineServerInterface ="));
g_Assert.equal(typeof g_strEngineServerExample, "string");

try {
	g_mapInterfaceAddresses.clear();
	g_mapInterfaceAddresses.set("VEngineServerStringTable001", 0x7000n);
	for (const vecInterfaceEntry of g_mapOriginalInterfaceAddresses) {
		const strInterfaceName = vecInterfaceEntry[0];
		const unInterfaceAddress = vecInterfaceEntry[1];
		g_mapInterfaceAddresses.set(strInterfaceName, unInterfaceAddress);
	}

	const vecLogMessages = RunDocumentationExample(g_strEngineServerExample);
	g_Assert.deepEqual(vecLogMessages, [g_vecExpectedDocumentationLogMessages[1]], "engine-server discovery must exclude a similarly prefixed string-table interface");
} finally {
	RestoreInterfaceAddresses(g_mapOriginalInterfaceAddresses);
}

g_Assert.deepEqual(g_Interfaces.GetAllInterfaceNames(), g_vecInterfaceNames, "documentation scenarios must restore registry order and content");

for (const strExportName of ["GetAllInterfaceNames", "GetInterfaceRecord"]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `Documentation must cover interfaces.${strExportName}()`);
}

for (const strFieldName of ["Name", "Available", "Address"]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strFieldName}\\b`), `Documentation must cover interface record ${strFieldName}`);
}

for (const vecMatch of g_strDocumentation.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
	const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), vecMatch[1]);
	g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `Documentation link does not exist: ${vecMatch[1]}`);
}

for (const strForbiddenTerm of [
	"Generated by",
	"generate_api_docs",
	"console.log(instance)",
	"console.log(result)",
	"sourcejs:example",
	"engineInterface.address",
	"addressString",
]) {
	g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `Documentation must not contain ${strForbiddenTerm}`);
}

const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_strInterfaceBindingsStart = "void GetAllInterfaceNamesCallback";
const g_nInterfaceBindingsStart = g_strNativeBindings.indexOf(g_strInterfaceBindingsStart);
const g_nInterfaceBindingsEnd = g_strNativeBindings.indexOf("// Pure modules", g_nInterfaceBindingsStart);
g_Assert.ok((g_nInterfaceBindingsStart >= 0) && (g_nInterfaceBindingsEnd > g_nInterfaceBindingsStart), "The native interfaces source guard requires the complete callback region.");
const g_strInterfaceBindings = g_strNativeBindings.slice(g_nInterfaceBindingsStart + g_strInterfaceBindingsStart.length, g_nInterfaceBindingsEnd);
VerifyNativeInterfaceBindings(g_strInterfaceBindings);

// Read-only mutation checks verify these guards, not execution of the native callback.
const g_vecNativeMutations = [
	{ Original: "LocalInterfaceNamesArray->CreateDataProperty(", Replacement: "LocalInterfaceNamesArray->Set(" },
	{ Original: "CallbackInformation.GetReturnValue().Set(LocalInterfaceNamesArray);\n\t\t\t} catch (...) {", Replacement: "CallbackInformation.GetReturnValue().Set(LocalInterfaceNamesArray);\n\t\t\t} catch (std::bad_alloc const&) {" },
	{ Original: "std::string(*UTF8InterfaceName, static_cast<std::size_t>(UTF8InterfaceName.length()))", Replacement: "std::string(*UTF8InterfaceName)" },
	{ Original: "kNamePropertyName, MakeString(pIsolate, strInterfaceName))", Replacement: "kNamePropertyName, MakeString(pIsolate, strInterfaceName.c_str()))" },
	{ Original: "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unInterfaceAddress))", Replacement: "v8::Number::New(pIsolate, static_cast<double>(unInterfaceAddress))" },
];
for (const NativeMutation of g_vecNativeMutations) {
	const nMatchIndex = g_strInterfaceBindings.indexOf(NativeMutation.Original);
	g_Assert.equal(nMatchIndex >= 0, true, "native interface mutation must target an existing fragment");
	g_Assert.equal(nMatchIndex, g_strInterfaceBindings.lastIndexOf(NativeMutation.Original), "native interface mutation must target a unique fragment");

	const strMutatedBindings = g_strInterfaceBindings.replace(NativeMutation.Original, NativeMutation.Replacement);
	g_Assert.throws(() => VerifyNativeInterfaceBindings(strMutatedBindings), g_Assert.AssertionError);
}

g_Assert.equal(Object.hasOwn(g_Interfaces, "moduleName"), false);
g_Assert.equal(Object.hasOwn(g_Interfaces, "default"), false);
g_Assert.equal(g_Interfaces.GetInterfaceRecord("ICvar"), null);

g_Assert.throws(() => LoadInterfaces(), (Failure) => (Failure instanceof Error) && (Failure.constructor === Error) && (Failure.message === "SourceJS native runtime is not installed."), "Missing interfaces runtime must not be mistaken for module-resolution failure.");

console.log("[  OK  ] interfaces smoke passed: controlled BigInt/snapshot/registry-lifecycle metadata, strict names, eight counted documentation examples, typed missing-runtime error, ambiguous-prefix/family-collision regressions and five native source mutation rejections; native SDK execution not exercised");
