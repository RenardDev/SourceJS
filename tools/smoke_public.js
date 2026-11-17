#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "public.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPublicModulePath = g_Path.join(g_strPackageRootPath, "public.js");

function NormalizeDocumentationHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strDocumentationMarkdown) {
	const vecContentsSectionMatch = strDocumentationMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsSectionMatch, "public contents section");

	const vecDocumentedAnchors = [];
	for (const vecDocumentedAnchorMatch of vecContentsSectionMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecSectionHeadingMatch of strDocumentationMarkdown.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = NormalizeDocumentationHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor === "contents") {
			continue;
		}

		vecSectionAnchors.push(strSectionAnchor);
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "public contents anchors");
}

function VerifyDocumentationLinks(strDocumentationMarkdown) {
	const strDocumentationWithoutCode = strDocumentationMarkdown.replace(/```[\s\S]*?```/g, "");
	const strDocumentationDirectory = g_Path.dirname(g_strDocumentationPath);
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationLink = vecDocumentationLinkMatch[1];
		if (strDocumentationLink.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLink)) {
			continue;
		}

		const nFragmentSeparatorIndex = strDocumentationLink.indexOf("#");
		let strDocumentationTarget = strDocumentationLink;
		if (nFragmentSeparatorIndex >= 0) {
			strDocumentationTarget = strDocumentationLink.slice(0, nFragmentSeparatorIndex);
		}

		const strDocumentationTargetPath = g_Path.resolve(strDocumentationDirectory, strDocumentationTarget);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetPath), `public documentation link must exist: ${strDocumentationLink}`);
	}
}

function AssertMetadataDescriptor(MetadataOwner, MetadataSymbol, ExpectedMetadataValue, strDescriptorDescription) {
	const MetadataDescriptor = Object.getOwnPropertyDescriptor(MetadataOwner, MetadataSymbol);
	g_Assert.ok(MetadataDescriptor, `${strDescriptorDescription} descriptor`);
	g_Assert.equal(MetadataDescriptor.configurable, true, `${strDescriptorDescription} configurable`);
	g_Assert.equal(MetadataDescriptor.enumerable, false, `${strDescriptorDescription} non-enumerable`);
	g_Assert.equal(MetadataDescriptor.value, ExpectedMetadataValue, `${strDescriptorDescription} value`);
	g_Assert.equal(MetadataDescriptor.writable, true, `${strDescriptorDescription} writable`);
}

const g_mapPackageCacheDescriptors = new Map();
let g_bPackageCacheOwned = false;

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

function RestorePackageCache() {
	if (!g_bPackageCacheOwned) {
		return;
	}

	const vecFailures = [];
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strModulePath), "Temporary public module cache entry must be removable: " + strModulePath);
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
		throw new AggregateError(vecFailures, "Public module cache restoration failed.");
	}

	g_bPackageCacheOwned = false;
}

let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed public module cache entries must support exact restoration.");
	}

	g_bPackageCacheOwned = true;
	delete require.cache[g_strPublicModulePath];

	const g_PublicAPI = require(g_strPublicModulePath);
	g_Assert.deepEqual(Object.keys(g_PublicAPI).sort(), [
		"GetExportedNames",
		"IsPublic",
		"MarkPublic",
		"PUBLIC_NAME",
		"PUBLIC_NAMES",
	], "exact public exports");
	g_Assert.equal(Symbol.keyFor(g_PublicAPI.PUBLIC_NAME), "sourcejs.public.name", "PUBLIC_NAME global symbol");
	g_Assert.equal(Symbol.keyFor(g_PublicAPI.PUBLIC_NAMES), "sourcejs.public.names", "PUBLIC_NAMES global symbol");

	const g_PublicExportTarget = {};

	function InternalCommand() {
	}

	// JavaScript reflection uses the exact name key; these fixture names preserve caller-provided casing.
	Object.defineProperty(InternalCommand, "name", { configurable: true, value: "_internalCommand" });

	const g_MarkedInternalCommand = g_PublicAPI.MarkPublic(InternalCommand, { Target: g_PublicExportTarget });
	g_Assert.equal(g_MarkedInternalCommand, InternalCommand, "MarkPublic returns the original value");
	AssertMetadataDescriptor(InternalCommand, g_PublicAPI.PUBLIC_NAME, "internalCommand", "PUBLIC_NAME");
	AssertMetadataDescriptor(g_PublicExportTarget, g_PublicAPI.PUBLIC_NAMES, g_PublicAPI.GetExportedNames(g_PublicExportTarget), "PUBLIC_NAMES");
	g_Assert.deepEqual(Object.keys(InternalCommand), [], "PUBLIC_NAME is absent from enumerable keys");
	g_Assert.deepEqual(Object.keys(g_PublicExportTarget), [], "PUBLIC_NAMES is absent from enumerable keys");
	g_Assert.deepEqual(g_PublicAPI.GetExportedNames(g_PublicExportTarget), ["internalCommand"], "target names");
	g_Assert.equal(g_PublicAPI.IsPublic(InternalCommand), true, "marked value is public");
	g_Assert.equal(g_PublicAPI.IsPublic(InternalCommand, g_PublicExportTarget), true, "marked value is registered");
	g_Assert.equal(g_PublicAPI.IsPublic("_internalCommand", g_PublicExportTarget), true, "string names are normalized");

	g_PublicAPI.MarkPublic(InternalCommand, { Target: g_PublicExportTarget });
	g_Assert.deepEqual(g_PublicAPI.GetExportedNames(g_PublicExportTarget), ["internalCommand"], "target names are deduplicated");

	const g_ExplicitPublicValue = {};
	g_PublicAPI.MarkPublic(g_ExplicitPublicValue, { Name: "__explicitValue", Target: g_PublicExportTarget });
	g_Assert.equal(g_ExplicitPublicValue[g_PublicAPI.PUBLIC_NAME], "explicitValue", "explicit names are normalized");
	g_Assert.deepEqual(g_PublicAPI.GetExportedNames(g_PublicExportTarget), ["internalCommand", "explicitValue"], "explicit target registration");

	const g_vecLivePublicNames = g_PublicAPI.GetExportedNames(g_PublicExportTarget);
	g_Assert.equal(g_PublicAPI.GetExportedNames(g_PublicExportTarget), g_vecLivePublicNames, "GetExportedNames preserves array identity");

	g_vecLivePublicNames.push("LiveName");
	g_Assert.equal(g_PublicAPI.IsPublic("LiveName", g_PublicExportTarget), true, "live additions are observed");

	g_Assert.deepEqual(g_vecLivePublicNames.splice(g_vecLivePublicNames.indexOf("LiveName"), 1), ["LiveName"], "live removal removes exactly the registered name");
	g_Assert.equal(g_PublicAPI.IsPublic("LiveName", g_PublicExportTarget), false, "live removals are observed");

	function OrdinaryName() {
	}

	Object.defineProperty(OrdinaryName, "name", { configurable: true, value: "OrdinaryName" });

	g_vecLivePublicNames.push("OrdinaryName");
	g_vecLivePublicNames.push("InternalCommand");

	g_Assert.equal(g_PublicAPI.IsPublic(OrdinaryName), false, "unmarked functions have no standalone metadata");
	g_Assert.equal(g_PublicAPI.IsPublic(OrdinaryName, g_PublicExportTarget), true, "target membership falls back to value.name");

	const g_PublicTarget = {};
	const g_vecInitialPublicNames = g_PublicAPI.GetExportedNames(g_PublicTarget);

	g_PublicTarget[g_PublicAPI.PUBLIC_NAMES] = "broken";
	g_Assert.throws(() => g_PublicAPI.GetExportedNames(g_PublicTarget), TypeError, "replaced non-array metadata is rejected");

	g_PublicTarget[g_PublicAPI.PUBLIC_NAMES] = g_vecInitialPublicNames;
	g_Assert.equal(g_PublicAPI.GetExportedNames(g_PublicTarget), g_vecInitialPublicNames, "writable array metadata can be restored");

	delete g_PublicTarget[g_PublicAPI.PUBLIC_NAMES];

	const g_vecRecreatedPublicNames = g_PublicAPI.GetExportedNames(g_PublicTarget);
	g_Assert.notEqual(g_vecRecreatedPublicNames, g_vecInitialPublicNames, "deleting PUBLIC_NAMES recreates array identity");
	g_Assert.deepEqual(g_vecRecreatedPublicNames, [], "recreated PUBLIC_NAMES starts empty");

	g_Assert.equal(g_PublicAPI.IsPublic(null), false, "null is not public");
	g_Assert.equal(g_PublicAPI.IsPublic("InternalCommand"), false, "strings require a target");
	g_Assert.equal(g_PublicAPI.IsPublic("_", g_PublicExportTarget), false, "empty normalized query names are rejected");
	g_Assert.equal(g_PublicAPI.IsPublic({}, g_PublicExportTarget), false, "unnamed objects are not target members");

	const g_InheritedPublicMetadataValue = Object.create({ [g_PublicAPI.PUBLIC_NAME]: "InternalCommand" });
	const g_MalformedPublicMetadataValue = { name: "InternalCommand" };
	g_Assert.equal(g_PublicAPI.IsPublic(g_MalformedPublicMetadataValue, g_PublicExportTarget), true, "ordinary names support target lookup");

	Object.defineProperty(g_MalformedPublicMetadataValue, g_PublicAPI.PUBLIC_NAME, { configurable: true, value: null, writable: true });

	g_Assert.equal(g_PublicAPI.IsPublic(g_InheritedPublicMetadataValue), false, "inherited metadata does not mark a value");
	g_Assert.equal(g_PublicAPI.IsPublic(g_MalformedPublicMetadataValue, g_PublicExportTarget), false, "malformed metadata is not hidden");

	g_Assert.throws(() => g_PublicAPI.MarkPublic(null), TypeError, "null values are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic(42), TypeError, "primitive values are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic({}), TypeError, "anonymous objects require names");
	g_Assert.throws(() => g_PublicAPI.MarkPublic({}, { Name: "___" }), TypeError, "empty normalized names are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic({}, null), TypeError, "null options are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic({}, []), TypeError, "array options are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic({}, { Name: "Value", Target: null }), TypeError, "null targets are rejected");
	g_Assert.throws(() => g_PublicAPI.GetExportedNames(null), TypeError, "null export targets are rejected");
	g_Assert.throws(() => g_PublicAPI.MarkPublic(Object.freeze({ name: "Frozen" })), TypeError, "frozen values reject metadata definition");

	const g_FailedPublicExportTarget = {};
	const g_FrozenPublicValue = Object.freeze({ name: "Frozen" });
	g_Assert.throws(() => g_PublicAPI.MarkPublic(g_FrozenPublicValue, { Target: g_FailedPublicExportTarget }), TypeError, "failed metadata definition rejects target registration");
	g_Assert.equal(Object.hasOwn(g_FailedPublicExportTarget, g_PublicAPI.PUBLIC_NAMES), true, "failed value marking can leave newly created target metadata");
	g_Assert.deepEqual(g_PublicAPI.GetExportedNames(g_FailedPublicExportTarget), [], "failed metadata definition leaves target names empty");

	{
		const Target = {};
		g_Assert.equal(g_PublicAPI.IsPublic("QueryName", Target), false, "unregistered valid name is not a target member");
		g_Assert.equal(Object.hasOwn(Target, g_PublicAPI.PUBLIC_NAMES), true, "membership query creates missing target metadata");
		g_Assert.deepEqual(Target[g_PublicAPI.PUBLIC_NAMES], [], "membership query creates an empty live array");

		const Value = {};
		const FrozenTarget = { [g_PublicAPI.PUBLIC_NAMES]: Object.freeze([]) };
		g_Assert.throws(() => g_PublicAPI.MarkPublic(Value, { Name: "FrozenArrayName", Target: FrozenTarget }), TypeError, "frozen target array rejects a new name");
		g_Assert.equal(Value[g_PublicAPI.PUBLIC_NAME], "FrozenArrayName", "array append failure does not roll back value metadata");
		g_Assert.deepEqual(FrozenTarget[g_PublicAPI.PUBLIC_NAMES], [], "failed append does not add the requested name");

		g_Assert.throws(() => g_PublicAPI.MarkPublic({ name: "InferenceAvailable" }, { Name: undefined }), TypeError, "own undefined name does not request otherwise available inference");

		const InheritedOptions = Object.create({ Name: "IgnoredName", Target: {} });
		const NamedValue = { name: "InferredName" };
		g_PublicAPI.MarkPublic(NamedValue, InheritedOptions);
		g_Assert.equal(NamedValue[g_PublicAPI.PUBLIC_NAME], "InferredName", "inherited name option is ignored");
		g_Assert.equal(Object.hasOwn(InheritedOptions.Target, g_PublicAPI.PUBLIC_NAMES), false, "inherited target option is ignored");
	}

	const g_strPublicDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationCodeBlocks = [];
	for (const vecDocumentationCodeBlockMatch of g_strPublicDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
	}

	const g_vecPluginRuntimeCalls = [];
	const g_PluginsRuntimeFixture = {
		GetPluginRecords() {
			g_vecPluginRuntimeCalls.push("GetPluginRecords");

			return [{ Name: "hello" }, { Name: "plugin-bus" }];
		},
	};

	function RequireDocumentationModule(strModuleIdentifier) {
		if (strModuleIdentifier === "public") {
			return g_PublicAPI;
		}

		if (strModuleIdentifier === "plugins") {
			return g_PluginsRuntimeFixture;
		}

		throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
	}

	g_Assert.equal(g_vecDocumentationCodeBlocks.length, 5, "all public documentation JavaScript blocks are present");
	g_Assert.ok(!g_strPublicDocumentation.includes("Generated by"), "public documentation must be maintained by hand.");
	g_Assert.ok(g_strPublicDocumentation.includes("live writable array"), "public documentation describes live writable names.");
	g_Assert.ok(g_strPublicDocumentation.includes("name-based, not object-identity based"), "public documentation covers target membership.");
	g_Assert.ok(!g_strPublicDocumentation.includes("console."), "public documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strPublicDocumentation), "public documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strPublicDocumentation);
	VerifyDocumentationLinks(g_strPublicDocumentation);

	const g_unDocumentationTimeoutMilliseconds = 1000;
	const g_RunDocumentationWorkflows = () => {
		const vecDocumentationModuleExports = [];
		for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; ++unDocumentationBlockIndex) {
			const strFileName = g_strDocumentationPath + ":" + (unDocumentationBlockIndex + 1);
			const DocumentationModuleRecord = new g_Module(strFileName, module);
			DocumentationModuleRecord.filename = strFileName;
			DocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
			DocumentationModuleRecord.require = RequireDocumentationModule;
			DocumentationModuleRecord._compile(g_vecDocumentationCodeBlocks[unDocumentationBlockIndex], strFileName);
			vecDocumentationModuleExports.push(DocumentationModuleRecord.exports);
		}

		g_Assert.equal(g_vecPluginRuntimeCalls.length, 0, "public examples must not query plugin records during block load.");
		g_Assert.deepEqual(Object.keys(vecDocumentationModuleExports[0]), [], "documented import block has no workflow export");

		const DocumentedPluginStatusExports = vecDocumentationModuleExports[1].CreatePluginStatusExports();
		g_Assert.deepEqual(DocumentedPluginStatusExports.PublicNames, ["LoadedPluginNames"], "documented function name normalization and deduplication");
		g_Assert.equal(DocumentedPluginStatusExports.ModuleExports.LoadedPluginNames.name, "_LoadedPluginNames", "documented function identity");
		g_Assert.deepEqual(DocumentedPluginStatusExports.ModuleExports.LoadedPluginNames(), ["hello", "plugin-bus"], "documented plugin-record query");
		g_Assert.deepEqual(g_vecPluginRuntimeCalls, ["GetPluginRecords"], "documented plugin records are queried only when the export is called");

		const DocumentedPluginRegistry = vecDocumentationModuleExports[2].CreatePluginRegistry([{ Loaded: true, Name: "hello" }, { Loaded: false, Name: "metrics" }]);
		g_Assert.deepEqual(DocumentedPluginRegistry.PublicNames, ["PluginRegistry"], "documented explicit object name");
		g_Assert.equal(DocumentedPluginRegistry.ModuleExports.PluginRegistry.get("metrics").Loaded, false, "documented registry contents");

		const DocumentedPublicSymbols = vecDocumentationModuleExports[3].InspectPublicSymbols();
		g_Assert.deepEqual(DocumentedPublicSymbols.LiveNames, ["MatchService", "ManualExport"], "documented live symbol names");
		g_Assert.equal(DocumentedPublicSymbols.PublicName, "MatchService", "documented PUBLIC_NAME value");
		g_Assert.equal(DocumentedPublicSymbols.SameArray, true, "documented PUBLIC_NAMES identity");
		g_Assert.equal(DocumentedPublicSymbols.NameEnumerable, false, "documented PUBLIC_NAME visibility");
		g_Assert.equal(DocumentedPublicSymbols.TargetNamesEnumerable, false, "documented PUBLIC_NAMES visibility");

		g_Assert.deepEqual(vecDocumentationModuleExports[4].InspectPublicState(), {
			MarkedValue: true,
			MarkedValueInTarget: true,
			MissingNameInTarget: false,
			PrimitiveWithoutTarget: false,
			SameOrdinaryNameInTarget: true,
			StringNameInTarget: true,
		}, "documented standalone and target public queries");
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	try {
		RestorePackageCache();
	} catch (CleanupFailure) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, CleanupFailure] : [CleanupFailure], "Public smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_public");
