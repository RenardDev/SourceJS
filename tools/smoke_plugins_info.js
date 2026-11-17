#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPluginInformationPath = g_Path.join(g_strPackageRootPath, "plugins", "info.js");
const g_strFileSystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins-info.md");

// These virtual paths are in-memory fixture data, never a real game installation.
const g_strPluginRootPath = "C:/game/left4dead2/addons/sourcejs/plugins";
const g_vecFileSystemCalls = [];

let g_unPluginRecordsCallCount = 0;

const g_mapVirtualFiles = new Map([
	[`${g_strPluginRootPath}/hello/plugin.json`, JSON.stringify({
		Author: "SourceJS",
		Description: "Minimal SourceJS greeting plugin.",
		Entry: "index.js",
		Name: "hello-manifest-name",
		Version: "1.0.0",
	})],
	[`${g_strPluginRootPath}/fallback/plugin.json`, JSON.stringify({
		Description: "Uses its manifest name.",
		Name: "fallback",
	})],
	[`${g_strPluginRootPath}/empty/plugin.json`, ""],
	[`${g_strPluginRootPath}/array/plugin.json`, "[]"],
	[`${g_strPluginRootPath}/invalid/plugin.json`, "{"],
]);

function CreateHeadingAnchor(strDocumentationHeading) {
	return strDocumentationHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strDocumentationText) {
	const vecDocumentationContentsMatch = strDocumentationText.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecDocumentationContentsMatch, "plugins/info contents section");

	const vecDocumentedAnchors = [];
	for (const vecDocumentedAnchorMatch of vecDocumentationContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
	}

	const vecSectionAnchors = [];
	for (const vecSectionHeadingMatch of strDocumentationText.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = CreateHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor === "contents") {
			continue;
		}

		vecSectionAnchors.push(strSectionAnchor);
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins/info contents anchors");
}

function VerifyDocumentationLinks(strDocumentationText) {
	const strDocumentationWithoutCode = strDocumentationText.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationLinkTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationLinkTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLinkTarget)) {
			continue;
		}

		const nDocumentationFragmentIndex = strDocumentationLinkTarget.indexOf("#");
		let strDocumentationRelativePath = strDocumentationLinkTarget;
		if (nDocumentationFragmentIndex >= 0) {
			strDocumentationRelativePath = strDocumentationLinkTarget.slice(0, nDocumentationFragmentIndex);
		}

		const strDocumentationTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationRelativePath);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationTargetPath), `plugins/info documentation link must exist: ${strDocumentationLinkTarget}`);
	}
}

function InstallDependency(strModulePath, ModuleExports) {
	delete require.cache[strModulePath];
	require.cache[strModulePath] = { exports: ModuleExports, filename: strModulePath, id: strModulePath, loaded: true };
}

const g_NativeFileSystem = {
	DoesFileExist(strFilePath) {
		g_vecFileSystemCalls.push(["DoesFileExist", strFilePath]);

		return g_mapVirtualFiles.has(strFilePath);
	},

	ReadTextFile(strFilePath) {
		g_vecFileSystemCalls.push(["ReadTextFile", strFilePath]);

		if (!g_mapVirtualFiles.has(strFilePath)) {
			throw new Error(`Missing virtual file: ${strFilePath}`);
		}

		return g_mapVirtualFiles.get(strFilePath);
	},
};

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
				g_Assert.ok(Reflect.deleteProperty(require.cache, strModulePath), "Temporary plugin information module cache entry must be removable: " + strModulePath);
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
		throw new AggregateError(vecFailures, "Plugin information module cache restoration failed.");
	}

	g_bPackageCacheOwned = false;
}

let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed plugin information cache entries must support exact restoration.");
	}

	g_bPackageCacheOwned = true;
	InstallDependency(g_strFileSystemPath, g_NativeFileSystem);
	delete require.cache[g_strPluginInformationPath];

	const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
	g_Module._load = function LoadModule(strRequest) {
		if (strRequest === "filesystem") {
			return require(g_strFileSystemPath);
		}

		return g_OriginalModuleLoad.apply(this, arguments);
	};

	const g_PluginInformationModule = require(g_strPluginInformationPath);
	RestoreModuleLoader();

	const { PluginInfo, ReadPluginManifest } = g_PluginInformationModule;
	g_Assert.deepEqual(Object.keys(g_PluginInformationModule).sort(), ["PluginInfo", "ReadPluginManifest"], "plugins/info exact exports");
	g_Assert.equal(Object.hasOwn(g_PluginInformationModule, "default"), false, "plugins/info must not expose a default alias.");
	g_Assert.equal(Object.hasOwn(g_PluginInformationModule, "moduleName"), false, "plugins/info must not expose moduleName.");

	const g_FirstPluginManifest = ReadPluginManifest(`${g_strPluginRootPath}/hello`);
	const g_SecondPluginManifest = ReadPluginManifest(`${g_strPluginRootPath}/hello`);
	g_Assert.notEqual(g_FirstPluginManifest, g_SecondPluginManifest, "manifest reads return independent values.");
	g_Assert.equal(g_FirstPluginManifest.Entry, "index.js", "manifest entry");

	g_FirstPluginManifest.Entry = "changed.js";
	g_Assert.equal(g_SecondPluginManifest.Entry, "index.js", "manifest mutation is not shared.");
	g_Assert.throws(() => ReadPluginManifest(`${g_strPluginRootPath}/missing`), /does not exist/, "missing manifest rejection");
	g_Assert.throws(() => ReadPluginManifest(`${g_strPluginRootPath}/empty`), /is empty/, "empty manifest rejection");
	g_Assert.throws(() => ReadPluginManifest(`${g_strPluginRootPath}/array`), /must contain an object/, "array manifest rejection");
	g_Assert.throws(() => ReadPluginManifest(`${g_strPluginRootPath}/invalid`), SyntaxError, "malformed JSON rejection");

	const g_vecPluginPermissionSource = [["match.admin", "Change match state."]];
	const g_vecPluginDisplayFieldSource = ["Category"];
	const g_PluginPublicConVarSource = { Name: "sourcejs_match_tools_version" };
	const g_PluginExtraMetadataSource = { Repository: "https://example.invalid/sourcejs/match-tools" };
	const g_MatchToolsPluginInformation = new PluginInfo("match-tools", {
		Category: "administration",
		DisplayInListing: g_vecPluginDisplayFieldSource,
		Extra: g_PluginExtraMetadataSource,
		Permissions: g_vecPluginPermissionSource,
		PublicConVar: g_PluginPublicConVarSource,
	});
	g_Assert.equal(g_MatchToolsPluginInformation.Permissions, g_vecPluginPermissionSource, "permission list identity");
	g_Assert.equal(g_MatchToolsPluginInformation.DisplayInListing, g_vecPluginDisplayFieldSource, "display list identity");
	g_Assert.equal(g_MatchToolsPluginInformation.PublicConVar, g_PluginPublicConVarSource, "public ConVar metadata identity");
	g_Assert.equal(g_MatchToolsPluginInformation.Extra, g_PluginExtraMetadataSource, "extra metadata identity");
	g_Assert.equal(g_PluginExtraMetadataSource.Category, "administration", "unknown options are retained in live extra metadata");

	g_vecPluginPermissionSource[0][0] = "match.manage";
	g_vecPluginDisplayFieldSource[0] = "Group";
	g_PluginPublicConVarSource.Name = "sourcejs_match_tools_build";
	g_PluginExtraMetadataSource.Repository = "https://example.invalid/sourcejs/match-tools-live";

	g_Assert.equal(g_MatchToolsPluginInformation.VerboseName, "Match Tools", "VerboseName fallback");
	g_Assert.equal(g_MatchToolsPluginInformation.Version, "unversioned", "Version fallback");
	g_Assert.equal(g_MatchToolsPluginInformation.Permissions[0][0], "match.manage", "live permission pair");
	g_Assert.equal(g_MatchToolsPluginInformation.DisplayInListing[0], "Group", "live display field");
	g_Assert.equal(g_MatchToolsPluginInformation.PublicConVar.Name, "sourcejs_match_tools_build", "live public ConVar metadata");
	g_Assert.equal(g_MatchToolsPluginInformation.Extra.Repository, "https://example.invalid/sourcejs/match-tools-live", "live extra metadata");

	g_MatchToolsPluginInformation.Permissions[0][1] = "Manage match state.";
	g_MatchToolsPluginInformation.DisplayInListing.push("Repository");
	g_MatchToolsPluginInformation.PublicConVar.Value = "2.0.0";
	g_MatchToolsPluginInformation.Extra.Maintainer = "SourceJS Team";

	g_Assert.equal(g_vecPluginPermissionSource[0][1], "Manage match state.", "permission mutation reaches source");
	g_Assert.equal(g_vecPluginDisplayFieldSource[1], "Repository", "display mutation reaches source");
	g_Assert.equal(g_PluginPublicConVarSource.Value, "2.0.0", "public ConVar mutation reaches source");
	g_Assert.equal(g_PluginExtraMetadataSource.Maintainer, "SourceJS Team", "extra mutation reaches source");

	let g_unPluginAuthorReadCount = 0;
	let g_unPluginCategoryReadCount = 0;
	const g_PluginPermissionPairReadCounts = { 0: 0, 1: 0, length: 0 };
	const g_vecOneReadPluginPermissionPair = new Proxy(["match.read", "Read match state."], {
		get(vecPluginPermissionPair, PluginPermissionPropertyKey, PluginPermissionReceiver) {
			if (Object.hasOwn(g_PluginPermissionPairReadCounts, PluginPermissionPropertyKey)) {
				g_PluginPermissionPairReadCounts[PluginPermissionPropertyKey] += 1;
			}

			return Reflect.get(vecPluginPermissionPair, PluginPermissionPropertyKey, PluginPermissionReceiver);
		},
	});

	const g_OneReadPluginOptions = Object.create(null);
	Object.defineProperty(g_OneReadPluginOptions, "Author", {
		enumerable: true,
		get() {
			g_unPluginAuthorReadCount += 1;

			return "SourceJS Team";
		},
	});
	Object.defineProperty(g_OneReadPluginOptions, "Category", {
		enumerable: true,
		get() {
			g_unPluginCategoryReadCount += 1;

			return "administration";
		},
	});

	// Exact JavaScript prototype-key spelling is intentional hostile metadata, not a project API.
	Object.defineProperty(g_OneReadPluginOptions, "__proto__", { enumerable: true, value: "owned metadata" });
	Object.defineProperty(g_OneReadPluginOptions, "Permissions", { enumerable: true, value: [g_vecOneReadPluginPermissionPair] });

	const g_OneReadPluginInformation = new PluginInfo("one-read", g_OneReadPluginOptions);
	g_Assert.equal(g_unPluginAuthorReadCount, 1, "known plugin option is read once");
	g_Assert.equal(g_unPluginCategoryReadCount, 1, "additional plugin option is read once");
	g_Assert.deepEqual(g_PluginPermissionPairReadCounts, { 0: 1, 1: 1, length: 1 }, "permission pair fields are read once");
	g_Assert.equal(g_OneReadPluginInformation.Permissions[0], g_vecOneReadPluginPermissionPair, "permission pair identity remains live");
	g_Assert.equal(g_OneReadPluginInformation.Extra.Category, "administration", "additional plugin metadata value");
	g_Assert.equal(g_OneReadPluginInformation.Extra.__proto__, "owned metadata", "prototype-named metadata value");
	g_Assert.equal(Object.hasOwn(g_OneReadPluginInformation.Extra, "__proto__"), true, "prototype-named metadata ownership");
	g_Assert.equal(Object.getPrototypeOf(g_OneReadPluginInformation.Extra), Object.prototype, "prototype-named metadata does not replace the prototype");

	const g_PluginMetadataAssignmentError = new Error("plugin metadata assignment failed");
	const g_TransactionalPluginExtraMetadataTarget = {};
	Object.defineProperty(g_TransactionalPluginExtraMetadataTarget, "Category", { configurable: true, enumerable: false, value: "original category", writable: false });

	const g_OriginalPluginCategoryDescriptor = Object.getOwnPropertyDescriptor(g_TransactionalPluginExtraMetadataTarget, "Category");
	const g_TransactionalPluginExtraMetadata = new Proxy(g_TransactionalPluginExtraMetadataTarget, {
		defineProperty(PluginExtraMetadataTarget, strPluginMetadataName, PluginMetadataDescriptor) {
			const bPluginMetadataDefined = Reflect.defineProperty(PluginExtraMetadataTarget, strPluginMetadataName, PluginMetadataDescriptor);
			if (strPluginMetadataName === "Repository") {
				throw g_PluginMetadataAssignmentError;
			}

			return bPluginMetadataDefined;
		},
	});

	let g_CaughtPluginMetadataAssignmentError = null;

	try {
		new PluginInfo("transactional", {
			Category: "administration",
			Extra: g_TransactionalPluginExtraMetadata,
			Repository: "https://example.invalid/sourcejs/transactional",
		});
	} catch (PluginMetadataError) {
		g_CaughtPluginMetadataAssignmentError = PluginMetadataError;
	}

	g_Assert.equal(g_CaughtPluginMetadataAssignmentError, g_PluginMetadataAssignmentError, "metadata assignment error identity");
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_TransactionalPluginExtraMetadataTarget, "Category"), g_OriginalPluginCategoryDescriptor, "metadata rollback restores the exact prior descriptor");
	g_Assert.equal(Object.hasOwn(g_TransactionalPluginExtraMetadataTarget, "Repository"), false, "metadata rollback removes the partially assigned field");

	const g_NonConfigurablePluginExtraMetadata = {};
	Object.defineProperty(g_NonConfigurablePluginExtraMetadata, "Repository", { configurable: false, enumerable: true, value: "https://example.invalid/sourcejs/original", writable: false });

	g_Assert.throws(() => new PluginInfo("blocked", {
		Category: "administration",
		Extra: g_NonConfigurablePluginExtraMetadata,
		Repository: "https://example.invalid/sourcejs/replacement",
	}), /not configurable/, "non-configurable metadata collision rejection");
	g_Assert.equal(Object.hasOwn(g_NonConfigurablePluginExtraMetadata, "Category"), false, "metadata collision validation precedes every metadata mutation");

	g_MatchToolsPluginInformation.VerboseName = "Match Administration";
	g_MatchToolsPluginInformation.Version = "2.0.0";

	g_Assert.equal(g_MatchToolsPluginInformation.VerboseName, "Match Administration", "writable VerboseName");
	g_Assert.equal(g_MatchToolsPluginInformation.Version, "2.0.0", "writable Version");

	g_MatchToolsPluginInformation.Version = null;
	g_Assert.equal(g_MatchToolsPluginInformation.Version, "unversioned", "null Version restores fallback.");
	g_Assert.throws(() => new PluginInfo("bad", { Author: 7 }), /Author must be a string or null/, "Author validation");
	g_Assert.throws(() => new PluginInfo("bad", { DisplayInListing: [7] }), /array of strings/, "DisplayInListing validation");
	g_Assert.throws(() => new PluginInfo("bad", { Entry: null }), /Entry must be a non-empty string/, "Entry validation");
	g_Assert.throws(() => new PluginInfo("bad", { Extra: [] }), /Extra metadata must be an object/, "Extra validation");
	g_Assert.throws(() => new PluginInfo("bad", { Permissions: [["name"]] }), /string pair/, "Permissions validation");
	g_Assert.throws(() => new PluginInfo("bad", { PublicConVar: null }), /boolean or object/, "PublicConVar validation");
	g_Assert.throws(() => {
		g_MatchToolsPluginInformation.VerboseName = 3;
	}, /VerboseName must be a string or null/, "VerboseName setter validation");

	g_vecFileSystemCalls.length = 0;

	g_Assert.throws(() => PluginInfo.FromManifest("", `${g_strPluginRootPath}/hello`), /Plugin name must be a non-empty string or null/, "explicit manifest plugin-name validation");
	g_Assert.deepEqual(g_vecFileSystemCalls, [], "explicit manifest plugin-name validation precedes filesystem access");

	const g_ExplicitNamePluginInformation = PluginInfo.FromManifest("hello", `${g_strPluginRootPath}/hello`);
	const g_ManifestNamePluginInformation = PluginInfo.FromManifest(null, `${g_strPluginRootPath}/fallback`);
	g_Assert.equal(g_ExplicitNamePluginInformation.Name, "hello", "directory name overrides manifest name.");
	g_Assert.equal(g_ExplicitNamePluginInformation.Version, "1.0.0", "manifest version");
	g_Assert.equal(g_ManifestNamePluginInformation.Name, "fallback", "null name uses manifest name.");

	// Negative legacy fixture: lowercase keys must not override canonical options.
	g_mapVirtualFiles.set(`${g_strPluginRootPath}/legacy/plugin.json`, '{"name":"legacy","entry":"old.js","version":"old"}');
	const g_LegacyPluginInformation = PluginInfo.FromManifest("legacy", `${g_strPluginRootPath}/legacy`);
	g_Assert.equal(g_LegacyPluginInformation.Entry, "index.js", "legacy entry is not normalized");
	g_Assert.equal(g_LegacyPluginInformation.Version, "unversioned", "legacy version is not normalized");
	g_Assert.equal(g_LegacyPluginInformation.Extra.version, "old", "unknown metadata spelling is preserved");
	g_Assert.throws(() => PluginInfo.FromManifest(null, `${g_strPluginRootPath}/legacy`), /Plugin name/, "legacy name is not normalized");

	const g_vecPluginRecords = [
		{
			Directory: `${g_strPluginRootPath}/hello`,
			Enabled: true,
			Entry: `${g_strPluginRootPath}/hello/index.js`,
			Index: 1,
			Loaded: true,
			Name: "hello",
		},
		{
			Directory: `${g_strPluginRootPath}/manifestless`,
			Enabled: true,
			Entry: `${g_strPluginRootPath}/manifestless/index.js`,
			Index: 2,
			Loaded: true,
			Name: "manifestless",
		},
	];

	g_vecFileSystemCalls.length = 0;

	const g_RecordPluginInformation = PluginInfo.FromRecord(g_vecPluginRecords[0]);
	g_Assert.deepEqual(g_vecFileSystemCalls, [["DoesFileExist", `${g_strPluginRootPath}/hello/plugin.json`], ["ReadTextFile", `${g_strPluginRootPath}/hello/plugin.json`]], "record manifest existence is checked exactly once");

	g_vecFileSystemCalls.length = 0;

	const g_ManifestlessPluginInformation = PluginInfo.FromRecord(g_vecPluginRecords[1]);
	g_Assert.deepEqual(g_vecFileSystemCalls, [["DoesFileExist", `${g_strPluginRootPath}/manifestless/plugin.json`]], "manifest-less record existence is checked exactly once");

	g_Assert.equal(g_RecordPluginInformation.Name, "hello", "record name remains authoritative.");
	g_Assert.equal(g_RecordPluginInformation.FilePath, g_vecPluginRecords[0].Entry, "record entry path");
	g_Assert.equal(g_RecordPluginInformation.Index, 1, "record index");
	g_Assert.equal(g_ManifestlessPluginInformation.VerboseName, "Manifestless", "manifest-less VerboseName fallback");
	g_Assert.equal(g_ManifestlessPluginInformation.Entry, "index.js", "manifest-less entry fallback");
	g_Assert.equal(g_ManifestlessPluginInformation.Version, "unversioned", "manifest-less Version fallback");

	const g_RecordBackedNameDescriptor = Object.getOwnPropertyDescriptor(g_RecordPluginInformation, "Name");
	g_Assert.equal(typeof g_RecordBackedNameDescriptor.get, "function", "record-backed name getter");
	g_Assert.equal(typeof g_RecordBackedNameDescriptor.set, "function", "record-backed name setter");
	g_Assert.equal(g_RecordBackedNameDescriptor.configurable, true, "record-backed name is configurable");
	g_Assert.equal(g_RecordBackedNameDescriptor.enumerable, true, "record-backed name is enumerable");

	g_vecPluginRecords[0].Name = "hello-live";
	g_vecPluginRecords[0].Directory = `${g_strPluginRootPath}/hello-live`;
	g_vecPluginRecords[0].Entry = `${g_strPluginRootPath}/hello-live/index.js`;
	g_vecPluginRecords[0].Enabled = false;
	g_vecPluginRecords[0].Loaded = false;
	g_vecPluginRecords[0].Index = 7;

	g_Assert.equal(g_RecordPluginInformation.Name, "hello-live", "record name mutation reaches plugin information");
	g_Assert.equal(g_RecordPluginInformation.Directory, `${g_strPluginRootPath}/hello-live`, "record directory mutation reaches plugin information");
	g_Assert.equal(g_RecordPluginInformation.FilePath, `${g_strPluginRootPath}/hello-live/index.js`, "record entry mutation reaches plugin information");
	g_Assert.equal(g_RecordPluginInformation.Enabled, false, "record enabled mutation reaches plugin information");
	g_Assert.equal(g_RecordPluginInformation.Loaded, false, "record loaded mutation reaches plugin information");
	g_Assert.equal(g_RecordPluginInformation.Index, 7, "record index mutation reaches plugin information");

	g_RecordPluginInformation.Name = "hello";
	g_RecordPluginInformation.Directory = `${g_strPluginRootPath}/hello`;
	g_RecordPluginInformation.FilePath = `${g_strPluginRootPath}/hello/index.js`;
	g_RecordPluginInformation.Enabled = true;
	g_RecordPluginInformation.Loaded = true;
	g_RecordPluginInformation.Index = 1;

	g_Assert.equal(g_vecPluginRecords[0].Name, "hello", "plugin information name mutation reaches record");
	g_Assert.equal(g_vecPluginRecords[0].Directory, `${g_strPluginRootPath}/hello`, "plugin information directory mutation reaches record");
	g_Assert.equal(g_vecPluginRecords[0].Entry, `${g_strPluginRootPath}/hello/index.js`, "plugin information file path mutation reaches record");
	g_Assert.equal(g_vecPluginRecords[0].Enabled, true, "plugin information enabled mutation reaches record");
	g_Assert.equal(g_vecPluginRecords[0].Loaded, true, "plugin information loaded mutation reaches record");
	g_Assert.equal(g_vecPluginRecords[0].Index, 1, "plugin information index mutation reaches record");
	g_Assert.throws(() => {
		g_RecordPluginInformation.Index = 1.5;
	}, /PluginRecord\.Index must be a safe integer/, "record-backed index setter validation");
	g_Assert.equal(g_vecPluginRecords[0].Index, 1, "invalid record-backed index does not mutate the record");

	g_vecPluginRecords[0].Loaded = "yes";
	g_Assert.throws(() => g_RecordPluginInformation.Loaded, /PluginRecord\.Loaded must be a boolean/, "malformed live record state rejection");

	g_vecPluginRecords[0].Loaded = true;

	delete g_vecPluginRecords[0].Entry;
	g_Assert.throws(() => g_RecordPluginInformation.FilePath, /PluginRecord\.Entry is required/, "missing live record field rejection");

	g_RecordPluginInformation.FilePath = `${g_strPluginRootPath}/hello/index.js`;
	g_Assert.equal(g_vecPluginRecords[0].Entry, `${g_strPluginRootPath}/hello/index.js`, "record-backed setter restores a missing own field");

	g_vecFileSystemCalls.length = 0;
	g_unPluginRecordsCallCount = 0;

	function DocumentationRequire(strRequestedModuleName) {
		if (strRequestedModuleName === "plugins") {
			return {
				GetPluginRecords() {
					g_unPluginRecordsCallCount += 1;

					const vecCurrentPluginRecords = [];
					for (const PluginRecord of g_vecPluginRecords) {
						vecCurrentPluginRecords.push({
							Directory: PluginRecord.Directory,
							Enabled: PluginRecord.Enabled,
							Entry: PluginRecord.Entry,
							Index: PluginRecord.Index,
							Loaded: PluginRecord.Loaded,
							Name: PluginRecord.Name,
						});
					}

					return vecCurrentPluginRecords;
				},
			};
		}

		if (strRequestedModuleName === "plugins/info") {
			return g_PluginInformationModule;
		}

		throw new Error(`unexpected plugins/info documentation module ${strRequestedModuleName}`);
	}

	const g_strPluginInformationDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecPluginInformationDocumentationCodeBlocks = [];
	for (const vecDocumentationCodeBlockMatch of g_strPluginInformationDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecPluginInformationDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
	}

	g_Assert.equal(g_vecPluginInformationDocumentationCodeBlocks.length, 5, "plugins/info documentation workflow count");
	g_Assert.ok(!g_strPluginInformationDocumentation.includes("Generated by"), "plugins/info documentation must be maintained by hand.");
	g_Assert.ok(g_strPluginInformationDocumentation.includes("allows `index.js` without a `plugin.json`"), "plugins/info docs must describe optional manifests.");
	g_Assert.ok(g_strPluginInformationDocumentation.includes("reads as `unversioned`"), "plugins/info docs must describe version fallback.");
	g_Assert.ok(g_strPluginInformationDocumentation.includes("live view of the supplied plugin record"), "plugins/info docs must describe live record ownership.");
	g_Assert.ok(!g_strPluginInformationDocumentation.includes("console."), "plugins/info documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strPluginInformationDocumentation), "plugins/info documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strPluginInformationDocumentation);
	VerifyDocumentationLinks(g_strPluginInformationDocumentation);

	const g_unDocumentationTimeoutMilliseconds = 1000;
	const g_RunDocumentationWorkflows = () => {
		const vecPluginInformationDocumentationExports = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecPluginInformationDocumentationCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const strFileName = g_strDocumentationPath + ":" + (unDocumentationCodeBlockIndex + 1);
			const DocumentationModuleRecord = new g_Module(strFileName, module);
			DocumentationModuleRecord.filename = strFileName;
			DocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
			DocumentationModuleRecord.require = DocumentationRequire;
			DocumentationModuleRecord._compile(g_vecPluginInformationDocumentationCodeBlocks[unDocumentationCodeBlockIndex], strFileName);
			vecPluginInformationDocumentationExports.push(DocumentationModuleRecord.exports);
		}

		g_Assert.equal(g_vecFileSystemCalls.length, 0, "plugins/info examples must not read manifests during block load");
		g_Assert.equal(g_unPluginRecordsCallCount, 0, "plugins/info examples must not query plugin records during block load");
		g_Assert.deepEqual(vecPluginInformationDocumentationExports[1].InspectPluginManifest(`${g_strPluginRootPath}/hello`), {
			Author: "SourceJS",
			Description: "Minimal SourceJS greeting plugin.",
			Entry: "index.js",
			Name: "hello-manifest-name",
			Version: "1.0.0",
		}, "documented raw manifest inspection");

		const DocumentedPluginInformation = vecPluginInformationDocumentationExports[2].CreateMatchToolsInformation();
		g_Assert.equal(DocumentedPluginInformation.Name, "match-tools", "documented metadata name");
		g_Assert.equal(DocumentedPluginInformation.VerboseName, "Match Tools", "documented writable verbose name");
		g_Assert.equal(DocumentedPluginInformation.VerboseNameValue, "Match Tools", "documented verbose-name backing value");
		g_Assert.equal(DocumentedPluginInformation.Version, "unversioned", "documented null version getter");
		g_Assert.equal(DocumentedPluginInformation.VersionValue, null, "documented version backing value");
		g_Assert.equal(DocumentedPluginInformation.Author, "SourceJS Team", "documented metadata author");
		g_Assert.equal(DocumentedPluginInformation.Entry, "main.js", "documented metadata entry");
		g_Assert.equal(DocumentedPluginInformation.Extra.Category, "administration", "documented unknown metadata field");
		g_Assert.equal(DocumentedPluginInformation.Extra.Repository, "https://example.invalid/sourcejs/match-tools", "documented explicit extra metadata");
		g_Assert.deepEqual(DocumentedPluginInformation.Permissions[0], ["match.admin", "Change match state."], "documented permission pair");
		g_Assert.deepEqual(DocumentedPluginInformation.PublicConVar, { Name: "sourcejs_match_tools_version" }, "documented public ConVar metadata");

		g_Assert.equal(vecPluginInformationDocumentationExports[3].InspectManifestPluginInformation("hello", `${g_strPluginRootPath}/hello`).Name, "hello", "documented strict manifest conversion");

		const vecDocumentedPluginInformationList = vecPluginInformationDocumentationExports[4].InspectLoadedPluginInformation();
		g_Assert.equal(vecDocumentedPluginInformationList.length, 2, "documented current record count");
		g_Assert.equal(vecDocumentedPluginInformationList[0].Name, "hello", "documented first current record name");
		g_Assert.equal(vecDocumentedPluginInformationList[1].Name, "manifestless", "documented second current record name");
		g_Assert.equal(vecDocumentedPluginInformationList[0].FilePath, `${g_strPluginRootPath}/hello/index.js`, "documented current record entry");
		g_Assert.equal(vecDocumentedPluginInformationList[1].VerboseName, "Manifestless", "documented manifest-less display default");
		g_Assert.equal(vecDocumentedPluginInformationList[1].Version, "unversioned", "documented manifest-less version default");

		const strPluginInformationSource = g_FileSystem.readFileSync(g_strPluginInformationPath, "utf8");
		for (const strRequiredSourceContract of [
			"const strPluginManifestPath = GetPluginManifestPath(strPluginDirectory)",
			"const strNormalizedPluginName = NormalizeOptionalPluginName(strPluginName)",
			"function ReadExistingPluginManifest(strPluginManifestPath)",
			"MergePluginExtraMetadata(ExtraMetadata, AdditionalPluginMetadata)",
			"JSON.parse(strPluginManifestText)",
			"const strPluginVersion = this.VersionValue",
			'return (strPluginVersion === null) ? "unversioned" : strPluginVersion',
			'const strPluginName = RequirePluginRecordText(ReadPluginRecordProperty(PluginRecord, "Name"), "Name")',
			"DefinePluginRecordBackedProperties(PluginInformation, PluginRecord)",
			"DoesPluginManifestExist(strPluginManifestPath)",
		]) {
			g_Assert.ok(strPluginInformationSource.includes(strRequiredSourceContract), `plugins/info contract missing: ${strRequiredSourceContract}`);
		}

		for (const strRelatedDocumentationFileName of [
			"filesystem.md",
			"paths.md",
			"plugins-instance.md",
			"plugins-manager.md",
			"plugins.md",
		]) {
			g_Assert.ok(g_FileSystem.existsSync(g_Path.join(g_strRepositoryRootPath, "docs", "api", strRelatedDocumentationFileName)), `plugins/info related documentation missing: ${strRelatedDocumentationFileName}`);
		}
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	const vecCleanupFailures = [];
	for (const Cleanup of [RestoreModuleLoader, RestorePackageCache]) {
		try {
			Cleanup();
		} catch (Failure) {
			vecCleanupFailures.push(Failure);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, ...vecCleanupFailures] : vecCleanupFailures, "Plugin information smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_plugins_info");
