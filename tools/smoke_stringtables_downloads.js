#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "stringtables-downloads.md");
const g_strDownloadsPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "stringtables", "downloads.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRootPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "stringtables.js");
const g_strPackageRootPath = g_Path.dirname(g_strRootPackagePath);
const g_strGameRootPath = g_Path.join(g_strRepositoryRootPath, "game");
const g_mapVirtualDirectories = new Map([
	["materials/sourcejs", [
		"materials/sourcejs/native-logo.vmt",
		"materials/sourcejs/nested/native-logo.vtf",
	]],
]);
const g_vecExpectedDocumentationWorkflows = [
	"CreateNativeDownloadDirectoryController",
	"CreateNativeDownloadFileController",
	"InspectNativeDownloadTable",
	"RestoreNativeDownloads",
];
const g_vecDownloadableValues = ["materials/example.vmt"];
const g_vecTrackedDownloadPaths = [];
const g_unMaximumStringCount = 4096;
let g_unCurrentTableAddress = 0x61000000n;
let g_unCurrentTableID = 0;
let g_DownloadsAPI = undefined;

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned stringtables/downloads fixture property must be removable: " + strKey);
}

function ReleaseStringTablesDownloadsFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	if (g_bLoaderOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		});
	}

	if (g_bPackageCacheOwned) {
		const unPreviousFailureCount = vecFailures.length;
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}

		if (vecFailures.length === unPreviousFailureCount) {
			g_bPackageCacheOwned = false;
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
			g_bSourceJSOwned = false;
		});
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Stringtables/downloads fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseStringTablesDownloadsFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Stringtables/downloads runtime fixture must support installation.");
g_Assert.ok(Object.isExtensible(require.cache), "Stringtables/downloads package cache must support exact restoration.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Stringtables/downloads runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Stringtables/downloads loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed stringtables/downloads cache entries must support exact restoration.");
}

// Exit cleanup also restores borrowed state after synchronous assertion failures.
process.once("exit", ReleaseStringTablesDownloadsFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function ReadNativePathInput(strPathValue) {
	if (typeof strPathValue !== "string") {
		throw new TypeError("Path must be a string");
	}

	if (strPathValue.includes("\0")) {
		throw new TypeError("Path must not contain embedded NUL");
	}

	// This fixture models the native C-locale byte whitespace, not Unicode trim().
	const strTrimmedPath = strPathValue.replace(/^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/g, "");
	if (strTrimmedPath.length === 0) {
		throw new TypeError("Path must be non-empty");
	}

	return strTrimmedPath;
}

function NormalizePath(strPathValue) {
	let strNormalizedPath = ReadNativePathInput(strPathValue).replace(/\\/g, "/");
	if (g_Path.isAbsolute(strNormalizedPath)) {
		strNormalizedPath = g_Path.relative(g_strGameRootPath, strNormalizedPath).split(g_Path.sep).join("/");
	}

	while (strNormalizedPath.startsWith("./")) {
		strNormalizedPath = strNormalizedPath.slice(2);
	}

	while (strNormalizedPath.startsWith("/")) {
		strNormalizedPath = strNormalizedPath.slice(1);
	}

	if (strNormalizedPath.length === 0) {
		throw new TypeError("Path must be non-empty");
	}

	return strNormalizedPath;
}

function ContainsValue(vecValues, Target) {
	for (const Value of vecValues) {
		if (Value === Target) {
			return true;
		}
	}

	return false;
}

function AddTrackedPath(strPathValue) {
	const strNormalizedPath = NormalizePath(strPathValue);
	let nIndex = g_vecDownloadableValues.indexOf(strNormalizedPath);
	if (nIndex < 0) {
		g_vecDownloadableValues.push(strNormalizedPath);
		nIndex = g_vecDownloadableValues.length - 1;
	}

	if (!ContainsValue(g_vecTrackedDownloadPaths, strNormalizedPath)) {
		g_vecTrackedDownloadPaths.push(strNormalizedPath);
	}

	return nIndex;
}

function CreateTableRecord() {
	const unTableAddress = g_unCurrentTableAddress;
	const unTableID = g_unCurrentTableID;
	const Table = {};
	Object.defineProperties(Table, {
		ID: {
			enumerable: true,

			get() {
				return unTableID;
			},
		},
		MaximumStringCount: {
			enumerable: true,

			get() {
				return g_unMaximumStringCount;
			},
		},
		Name: {
			enumerable: true,

			get() {
				return "downloadables";
			},
		},
		Address: {
			enumerable: true,

			get() {
				return unTableAddress;
			},
		},
		StringCount: {
			enumerable: true,

			get() {
				return g_vecDownloadableValues.length;
			},
		},
	});

	return Table;
}

function VerifyNativeTableRecordBorrowing() {
	const unSavedAddress = g_unCurrentTableAddress;
	const unSavedID = g_unCurrentTableID;
	const vecSavedStrings = g_vecDownloadableValues.slice();
	const Table = CreateTableRecord();

	try {
		// Two simulated tables coexist; changing the lookup must not retarget the borrowed record.
		g_unCurrentTableAddress += 0x1000n;
		g_unCurrentTableID++;
		const ReplacementTable = CreateTableRecord();

		g_Assert.equal(Table.Address, unSavedAddress, "record retains the original native address instead of resolving the current table");
		g_Assert.equal(Table.ID, unSavedID, "record retains the original simulated table identity");
		g_Assert.equal(ReplacementTable.Address, g_unCurrentTableAddress, "fresh record uses the replacement table address");
		g_Assert.equal(ReplacementTable.ID, g_unCurrentTableID, "fresh record uses the replacement table ID");

		g_vecDownloadableValues.push("materials/sourcejs/borrowed-record.vmt");
		g_Assert.equal(Table.StringCount, vecSavedStrings.length + 1, "fields remain live while the original simulated storage remains alive");

		for (const strPropertyName of [
			"Address",
			"Name",
			"ID",
			"StringCount",
			"MaximumStringCount",
		]) {
			const Descriptor = Object.getOwnPropertyDescriptor(Table, strPropertyName);
			g_Assert.equal(typeof Descriptor.get, "function", "native record property is an accessor");
			g_Assert.equal(Descriptor.set, undefined, "native record property has no setter");
			g_Assert.equal(Descriptor.enumerable, true, "native record property is enumerable");
			g_Assert.equal(Descriptor.configurable, false, "native record property is non-configurable");
			g_Assert.throws(() => {
				Table[strPropertyName] = 1;
			}, TypeError, "record property is read-only in strict code");
			g_Assert.throws(() => Object.defineProperty(Table, strPropertyName, { value: 1 }), TypeError, "record property cannot be redefined");
		}
	} finally {
		g_unCurrentTableAddress = unSavedAddress;
		g_unCurrentTableID = unSavedID;
		g_vecDownloadableValues.length = 0;

		for (const strSavedPath of vecSavedStrings) {
			g_vecDownloadableValues.push(strSavedPath);
		}
	}
}

function VerifyRawDownloadPathSemantics() {
	const vecSavedValues = g_vecDownloadableValues.slice();
	const vecSavedTrackedPaths = g_vecTrackedDownloadPaths.slice();

	try {
		const strCanonicalPath = "materials/sourcejs/normalized.vmt";
		const nIndex = g_DownloadsAPI.AddDownloadable(" \t././materials\\sourcejs\\normalized.vmt\r\n");
		g_Assert.equal(g_DownloadsAPI.GetDownloadableIndex(strCanonicalPath), nIndex, "single-file normalization trims native whitespace and replaces separators");
		g_Assert.equal(g_DownloadsAPI.HasDownloadable(strCanonicalPath), true, "normalized path is tracked once");

		const strUnicodePath = "\u00A0materials/sourcejs/unicode-space.vmt\u00A0";
		g_Assert.equal(g_DownloadsAPI.AddDownloadable(strUnicodePath) >= 0, true, "Unicode whitespace path insertion index");
		g_Assert.equal(g_DownloadsAPI.HasDownloadable(strUnicodePath), true, "C-locale fixture retains Unicode whitespace bytes");
		g_Assert.equal(g_DownloadsAPI.HasDownloadable("materials/sourcejs/unicode-space.vmt"), false, "native whitespace is not modeled as Unicode trim");

		g_Assert.equal(g_DownloadsAPI.AddDownloadable("materials/sourcejs/parent/../not-collapsed.vmt") >= 0, true, "uncollapsed parent path insertion index");
		g_Assert.equal(g_DownloadsAPI.HasDownloadable("materials/sourcejs/not-collapsed.vmt"), false, "relative single-file paths do not collapse parent segments");

		const vecRecursivePaths = g_DownloadsAPI.AddDownloadableDirectory("./materials/sourcejs/./");
		g_Assert.equal(vecRecursivePaths.length, 2, "omitted recursive argument uses true after native directory lexical normalization");
		g_Assert.equal(g_DownloadsAPI.UntrackDownloadableDirectory("materials/sourcejs/"), 0, "trailing directory separator does not match canonical child boundaries");
		g_Assert.ok(g_DownloadsAPI.UntrackDownloadableDirectory("materials/sourcejs") > 0, "canonical directory boundary releases tracked descendants");

		if (g_Path.sep === "/") {
			g_Assert.deepEqual(g_DownloadsAPI.AddDownloadableDirectory("materials\\sourcejs"), [], "POSIX directory traversal does not rewrite backslashes");
		}
	} finally {
		g_vecDownloadableValues.length = 0;
		g_vecTrackedDownloadPaths.length = 0;

		for (const strSavedValue of vecSavedValues) {
			g_vecDownloadableValues.push(strSavedValue);
		}

		for (const strSavedPath of vecSavedTrackedPaths) {
			g_vecTrackedDownloadPaths.push(strSavedPath);
		}
	}
}

const g_NativeDownloads = {
	DOWNLOADABLES_TABLE_NAME: "downloadables",

	AddDownloadable(strPathValue) {
		return AddTrackedPath(strPathValue);
	},

	AddDownloadableDirectory(strPathValue, bRecursive = true) {
		if ((arguments.length > 1) && (typeof arguments[1] !== "boolean")) {
			throw new TypeError("Recursive must be a boolean");
		}

		const strDirectoryInput = ReadNativePathInput(strPathValue);
		const strNormalizedDirectory = g_Path.relative(g_strGameRootPath, g_Path.resolve(g_strGameRootPath, strDirectoryInput)).split(g_Path.sep).join("/");
		const vecDirectoryPaths = g_mapVirtualDirectories.get(strNormalizedDirectory);
		if (!vecDirectoryPaths) {
			return [];
		}

		const unPrefixLength = strNormalizedDirectory.length + 1;
		const vecAddedPaths = [];
		for (const strDownloadPath of vecDirectoryPaths) {
			const strRelativePath = strDownloadPath.slice(unPrefixLength);
			if (!bRecursive && (strRelativePath.indexOf("/") >= 0)) {
				continue;
			}

			vecAddedPaths.push(strDownloadPath);
		}

		for (const strDownloadPath of vecAddedPaths) {
			// This fixture models successful insertion: AddTrackedPath returns an index or throws.
			AddTrackedPath(strDownloadPath);
		}

		return vecAddedPaths.slice();
	},

	HasDownloadable(strPathValue) {
		return g_vecDownloadableValues.indexOf(NormalizePath(strPathValue)) >= 0;
	},

	GetDownloadableIndex(strPathValue) {
		return g_vecDownloadableValues.indexOf(NormalizePath(strPathValue));
	},

	GetDownloadablesList() {
		return g_vecDownloadableValues.slice();
	},

	RestoreDownloadables() {
		let unRestoredCount = 0;
		for (const strDownloadPath of g_vecTrackedDownloadPaths) {
			if (!ContainsValue(g_vecDownloadableValues, strDownloadPath)) {
				g_vecDownloadableValues.push(strDownloadPath);
			}

			unRestoredCount += 1;
		}

		return unRestoredCount;
	},

	GetDownloadablesTable() {
		return CreateTableRecord();
	},

	GetTrackedDownloadables() {
		return g_vecTrackedDownloadPaths.slice();
	},

	UntrackDownloadable(strPathValue) {
		const strNormalizedPath = NormalizePath(strPathValue);
		const nIndex = g_vecTrackedDownloadPaths.indexOf(strNormalizedPath);
		if (nIndex < 0) {
			return false;
		}

		g_vecTrackedDownloadPaths.splice(nIndex, 1);

		return true;
	},

	UntrackDownloadableDirectory(strPathValue) {
		const strNormalizedDirectory = NormalizePath(strPathValue);
		let unRemovedCount = 0;
		for (let nIndex = g_vecTrackedDownloadPaths.length - 1; nIndex >= 0; nIndex -= 1) {
			const strTrackedPath = g_vecTrackedDownloadPaths[nIndex];
			if ((strTrackedPath === strNormalizedDirectory) || strTrackedPath.startsWith(`${strNormalizedDirectory}/`)) {
				g_vecTrackedDownloadPaths.splice(nIndex, 1);
				unRemovedCount += 1;
			}
		}

		return unRemovedCount;
	},
};

function ExecuteCodeBlock(strSource, unIndex, DownloadsAPI) {
	const unCompilationTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:example-${unIndex + 1}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "stringtables/downloads") {
			return DownloadsAPI;
		}

		throw new Error(`Unexpected documentation import: ${strIdentifier}`);
	};

	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strSource, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: unCompilationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function ExtractDocumentationImports(strSource) {
	const vecImportMatch = strSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\("stringtables\/downloads"\);/);
	g_Assert.ok(vecImportMatch, "documentation starts with a destructured stringtables/downloads import");

	const vecImportNames = [];
	const vecRawImportNames = vecImportMatch[1].split(",");
	for (const strRawImportName of vecRawImportNames) {
		const strImportName = strRawImportName.split(":", 1)[0].trim();
		if (strImportName.length > 0) {
			vecImportNames.push(strImportName);
		}
	}

	return vecImportNames;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ToPlainValue(Value) {
	return JSON.parse(JSON.stringify(Value));
}

function ReadRuntimeState(DownloadsAPI) {
	return { Entries: DownloadsAPI.GetDownloadablesList(), TableID: g_unCurrentTableID, TableAddress: g_unCurrentTableAddress, Tracked: DownloadsAPI.GetTrackedDownloadables() };
}

function VerifyContentsAnchors(strDocumentation) {
	const vecContentsMatch = strDocumentation.match(/^## Contents\r?\n\r?\n([\s\S]*?)(?=\r?\n\r?\n## )/m);
	g_Assert.ok(vecContentsMatch, "documentation Contents section");

	const vecLinkedAnchors = [];
	const vecHeadingAnchors = [];

	for (const vecMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecLinkedAnchors.push(vecMatch[1]);
	}

	for (const vecMatch of strDocumentation.matchAll(/^## (?!Contents$)(.+)$/gm)) {
		vecHeadingAnchors.push(NormalizeHeadingAnchor(vecMatch[1]));
	}

	g_Assert.deepEqual(vecLinkedAnchors, vecHeadingAnchors, "Contents links every level-two section in order");
}

function VerifyDocumentationLinks(strDocumentation) {
	const strDocumentationDirectory = g_Path.dirname(g_strDocumentationPath);
	for (const vecMatch of strDocumentation.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
		const [strRelativePath, strFragment] = vecMatch[1].split("#", 2);
		const strTargetPath = g_Path.resolve(strDocumentationDirectory, strRelativePath);
		g_Assert.equal(g_FileSystem.existsSync(strTargetPath), true, `documentation link exists: ${vecMatch[1]}`);

		if (strFragment) {
			const strTargetDocumentation = g_FileSystem.readFileSync(strTargetPath, "utf8");
			const vecTargetAnchors = [];

			for (const vecHeadingMatch of strTargetDocumentation.matchAll(/^#{1,6} (.+)$/gm)) {
				vecTargetAnchors.push(NormalizeHeadingAnchor(vecHeadingMatch[1]));
			}

			g_Assert.equal(ContainsValue(vecTargetAnchors, strFragment), true, `documentation anchor exists: ${vecMatch[1]}`);
		}
	}
}

Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "stringtables/downloads": g_NativeDownloads } });
g_bSourceJSOwned = true;

RestoreFixtureProperty(require.cache, g_strDownloadsPath, undefined);
RestoreFixtureProperty(require.cache, g_strRootPackagePath, undefined);

Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	writable: true,
	value: function LoadDownloadsTestModule(strRequest, Parent, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, Parent, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, Parent, bIsMain);
	},
});
g_bLoaderOwned = true;

try {
	g_DownloadsAPI = require(g_strDownloadsPath);
} finally {
	RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;
}

g_Assert.equal(g_DownloadsAPI, g_NativeDownloads, "package preserves native object identity");
g_Assert.equal(require.cache[g_strRootPackagePath], undefined, "raw package does not load the managed root package");
g_Assert.deepEqual(Object.keys(g_DownloadsAPI).sort(), [
	"DOWNLOADABLES_TABLE_NAME",
	"AddDownloadable",
	"AddDownloadableDirectory",
	"HasDownloadable",
	"GetDownloadableIndex",
	"GetDownloadablesList",
	"RestoreDownloadables",
	"GetDownloadablesTable",
	"GetTrackedDownloadables",
	"UntrackDownloadable",
	"UntrackDownloadableDirectory",
].sort(), "exact stringtables/downloads exports");

VerifyNativeTableRecordBorrowing();

for (const strMethodName of [
	"GetDownloadableIndex",
	"HasDownloadable",
	"AddDownloadable",
	"AddDownloadableDirectory",
	"UntrackDownloadable",
	"UntrackDownloadableDirectory",
]) {
	for (const InvalidPath of [
		"",
		" \t\r\n\v\f ",
		1,
		null,
		undefined,
		false,
		{},
		new String("materials/sourcejs"),
		Symbol("Invalid path"),
		"\0",
		"materials/sourcejs\0/ignored.vmt",
	]) {
		const StateBefore = ReadRuntimeState(g_DownloadsAPI);
		g_Assert.throws(() => g_DownloadsAPI[strMethodName](InvalidPath), TypeError, "native path validation rejects invalid input before mutation");
		g_Assert.deepEqual(ReadRuntimeState(g_DownloadsAPI), StateBefore, "invalid input leaves table and tracking unchanged");
	}
}

for (const InvalidRecursive of [
	undefined,
	null,
	0,
	1,
	"true",
	new Boolean(true),
	{},
	[],
	Symbol("Invalid recursion"),
]) {
	const StateBefore = ReadRuntimeState(g_DownloadsAPI);
	g_Assert.throws(() => g_DownloadsAPI.AddDownloadableDirectory("materials/sourcejs", InvalidRecursive), TypeError, "explicit recursive argument must be a primitive Boolean");
	g_Assert.deepEqual(ReadRuntimeState(g_DownloadsAPI), StateBefore, "invalid recursion leaves table and tracking unchanged");
}

VerifyRawDownloadPathSemantics();

const g_Table = g_DownloadsAPI.GetDownloadablesTable();
const g_unInitialStringCount = g_Table.StringCount;

g_Assert.equal(g_Table.Name, g_DownloadsAPI.DOWNLOADABLES_TABLE_NAME, "native table name");
g_Assert.equal(g_DownloadsAPI.DOWNLOADABLES_TABLE_NAME, "downloadables", "literal downloadables table name");
g_Assert.equal(g_Table.Address, g_unCurrentTableAddress, "BigInt table address");
g_Assert.equal(g_Table.ID, g_unCurrentTableID, "table ID");
g_Assert.equal(g_Table.MaximumStringCount, 4096, "table capacity");
g_Assert.equal(typeof Object.getOwnPropertyDescriptor(g_Table, "StringCount").get, "function", "live string-count accessor");

const g_strDirectPath = "materials/sourcejs/direct.vmt";
const g_nDirectIndex = g_DownloadsAPI.AddDownloadable(g_strDirectPath);
g_Assert.equal(g_Table.StringCount, g_unInitialStringCount + 1, "existing table record observes additions");
g_Assert.equal(g_DownloadsAPI.GetDownloadableIndex(g_strDirectPath), g_nDirectIndex, "download index");
g_Assert.equal(g_DownloadsAPI.HasDownloadable(g_strDirectPath), true, "download membership");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetDownloadablesList(), g_strDirectPath), true, "current table list");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetTrackedDownloadables(), g_strDirectPath), true, "restore tracking list");

const g_vecListCopy = g_DownloadsAPI.GetDownloadablesList();
const g_vecTrackedCopy = g_DownloadsAPI.GetTrackedDownloadables();
g_vecListCopy.length = 0;
g_vecTrackedCopy.length = 0;
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetDownloadablesList(), g_strDirectPath), true, "table list is a fresh array");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetTrackedDownloadables(), g_strDirectPath), true, "tracking list is a fresh array");

const g_strAbsolutePath = g_Path.join(g_strGameRootPath, "materials", "sourcejs", "absolute.vmt");
g_Assert.equal(g_DownloadsAPI.AddDownloadable(g_strAbsolutePath) >= 0, true, "absolute path insertion index");
g_Assert.equal(g_DownloadsAPI.HasDownloadable("materials/sourcejs/absolute.vmt"), true, "game-root absolute path normalization");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadable(g_strDirectPath), true, "untrack existing path");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadable(g_strDirectPath), false, "untrack missing path");
g_Assert.equal(g_DownloadsAPI.HasDownloadable(g_strDirectPath), true, "untracking preserves the current table string");

const g_strDoubleSlashPath = "materials//sourcejs/native-spacing.vmt";
const g_strSingleSlashPath = "materials/sourcejs/native-spacing.vmt";

g_Assert.equal(g_DownloadsAPI.AddDownloadable(g_strDoubleSlashPath) >= 0, true, "double-slash path insertion index");
g_Assert.equal(g_DownloadsAPI.HasDownloadable(g_strDoubleSlashPath), true, "raw native normalization preserves internal repeated slashes");
g_Assert.equal(g_DownloadsAPI.HasDownloadable(g_strSingleSlashPath), false, "raw native normalization does not collapse internal slashes");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadable(g_strDoubleSlashPath), true, "repeated-slash test releases tracking");

const g_vecFlatDirectoryPaths = g_DownloadsAPI.AddDownloadableDirectory("materials/sourcejs", false);
const g_vecRecursiveDirectoryPaths = g_DownloadsAPI.AddDownloadableDirectory("materials/sourcejs", true);
g_Assert.deepEqual(g_vecFlatDirectoryPaths, ["materials/sourcejs/native-logo.vmt"], "non-recursive directory addition");
g_Assert.deepEqual(g_vecRecursiveDirectoryPaths, ["materials/sourcejs/native-logo.vmt", "materials/sourcejs/nested/native-logo.vtf"], "recursive directory addition");
g_Assert.deepEqual(g_DownloadsAPI.AddDownloadableDirectory("materials/missing", true), [], "missing directory result");

const g_strSiblingPath = "materials/sourcejs-old/kept.vmt";
g_Assert.equal(g_DownloadsAPI.AddDownloadable(g_strSiblingPath) >= 0, true, "sibling path insertion index");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadableDirectory("materials/sourcejs") >= 2, true, "directory tracking removal");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetTrackedDownloadables(), g_strSiblingPath), true, "directory boundary preserves siblings");

g_Assert.equal(g_DownloadsAPI.AddDownloadable("sound/sourcejs/restored.wav") >= 0, true, "restore fixture path insertion index");
g_vecDownloadableValues.length = 0;
g_unCurrentTableAddress += 0x1000n;
g_unCurrentTableID += 1;

const g_RecreatedTable = g_DownloadsAPI.GetDownloadablesTable();
g_Assert.notEqual(g_RecreatedTable, g_Table, "recreation requires a fresh borrowed table record");
g_Assert.equal(g_RecreatedTable.Address, g_unCurrentTableAddress, "fresh record borrows the recreated table address");
g_Assert.equal(g_RecreatedTable.ID, g_unCurrentTableID, "fresh record reads the recreated table ID");

const g_unRestoredDownloadCount = g_DownloadsAPI.RestoreDownloadables();
const g_unTrackedDownloadCount = g_DownloadsAPI.GetTrackedDownloadables().length;
g_Assert.equal(g_unRestoredDownloadCount, g_unTrackedDownloadCount, "restore count includes every successful tracked path");
g_Assert.equal(g_DownloadsAPI.HasDownloadable("sound/sourcejs/restored.wav"), true, "tracked path restored into recreated table");

g_Assert.equal(g_DownloadsAPI.AddDownloadable("materials/shared.vmt") >= 0, true, "shared path first insertion index");
g_Assert.equal(g_DownloadsAPI.AddDownloadable("materials/shared.vmt") >= 0, true, "shared path repeated insertion index");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadable("materials/shared.vmt"), true, "raw untrack removes shared native tracking");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetTrackedDownloadables(), "materials/shared.vmt"), false, "raw module has no per-plugin owners");

g_Assert.throws(() => g_DownloadsAPI.AddDownloadable(""), TypeError, "empty download path");
g_Assert.throws(() => g_DownloadsAPI.GetDownloadableIndex(1), TypeError, "non-string lookup path");
g_Assert.throws(() => g_DownloadsAPI.AddDownloadableDirectory("", true), TypeError, "empty download directory");
g_Assert.throws(() => g_DownloadsAPI.AddDownloadableDirectory("materials/sourcejs", "yes"), TypeError, "strict recursive boolean");
g_Assert.throws(() => g_DownloadsAPI.UntrackDownloadableDirectory(""), TypeError, "empty untrack directory");

g_Assert.equal(g_DownloadsAPI.UntrackDownloadable(g_strSiblingPath), true, "direct tests release sibling tracking");
g_Assert.equal(g_DownloadsAPI.UntrackDownloadable("sound/sourcejs/restored.wav"), true, "direct tests release restored tracking");
g_Assert.deepEqual(g_vecTrackedDownloadPaths, [], "direct tests release the native tracking vector");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_vecCodeBlocks = [];
const g_DocumentationWorkflows = {};

for (const vecMatch of g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecCodeBlocks.push(vecMatch[1]);
}

g_Assert.equal(g_vecCodeBlocks.length, 5, "all stringtables/downloads documentation JavaScript blocks are present");

const g_StateBeforeBlockLoad = ReadRuntimeState(g_DownloadsAPI);
const g_vecDocumentedImportNames = ExtractDocumentationImports(g_vecCodeBlocks[0]).sort();
const g_vecNativeExportNames = Object.keys(g_DownloadsAPI).sort();

g_Assert.deepEqual(g_vecDocumentedImportNames, g_vecNativeExportNames, "documentation imports every exact export");

for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; unIndex += 1) {
	const WorkflowExports = ExecuteCodeBlock(g_vecCodeBlocks[unIndex], unIndex, g_DownloadsAPI);
	for (const strName of Object.keys(WorkflowExports)) {
		g_Assert.equal(Object.hasOwn(g_DocumentationWorkflows, strName), false, `documentation workflow is unique: ${strName}`);
		Object.defineProperty(g_DocumentationWorkflows, strName, { configurable: true, enumerable: true, value: WorkflowExports[strName], writable: true });
	}
}

const g_StateAfterBlockLoad = ReadRuntimeState(g_DownloadsAPI);
const g_vecDocumentationWorkflowNames = Object.keys(g_DocumentationWorkflows).sort();
const g_EmptyDirectoryErrorPattern = /stringtables\.AddDownloadableDirectory\(strDownloadableDirectoryPath, bRecursiveTraversal\?\) requires a non-empty directory path\./;
const g_NonDestructuredImportPattern = /const\s+[A-Za-z_$][\w$]*\s*=\s*require\("stringtables\/downloads"\)/;

g_Assert.deepEqual(g_StateAfterBlockLoad, g_StateBeforeBlockLoad, "documentation blocks perform no native work while loading");
g_Assert.deepEqual(g_vecDocumentationWorkflowNames, g_vecExpectedDocumentationWorkflows, "documentation exports every workflow");
g_Assert.match(g_strModuleBindingsSource, g_EmptyDirectoryErrorPattern, "native directory callback rejects empty paths");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by/, "stringtables/downloads documentation is hand-maintained");
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "documentation does not use console-only output");
g_Assert.doesNotMatch(g_strDocumentation, g_NonDestructuredImportPattern, "documentation uses direct destructured imports");
g_Assert.doesNotMatch(g_strDocumentation, /[^\x00-\x7F]/, "documentation stays ASCII");
g_Assert.doesNotMatch(g_strDocumentation, /[ \t]+$/m, "documentation has no trailing whitespace");
g_Assert.doesNotMatch(g_strDocumentation, /\r?\n\r?\n\r?\n/, "documentation has no consecutive blank lines");

for (const strCodeBlock of g_vecCodeBlocks) {
	for (const strLine of strCodeBlock.split(/\r?\n/)) {
		g_Assert.doesNotMatch(strLine, /^ +\S/, "documentation JavaScript indentation uses tabs");
	}
}

VerifyContentsAnchors(g_strDocumentation);
VerifyDocumentationLinks(g_strDocumentation);

const g_TableResult = g_DocumentationWorkflows.InspectNativeDownloadTable();
g_Assert.equal(g_TableResult.Name, "downloadables", "table workflow name");
g_Assert.equal(g_TableResult.NameMatches, true, "table workflow constant");
g_Assert.equal(g_TableResult.Address, g_unCurrentTableAddress, "table workflow BigInt address");
g_Assert.equal(g_TableResult.ID, g_unCurrentTableID, "table workflow ID");
g_Assert.equal(g_TableResult.MaximumStringCount, 4096, "table workflow capacity");
g_Assert.equal(g_TableResult.StringCount, g_vecDownloadableValues.length, "table workflow live count");
g_Assert.deepEqual(ToPlainValue(g_TableResult.Entries), g_vecDownloadableValues, "table workflow entries");
g_Assert.deepEqual(ToPlainValue(g_TableResult.Tracked), [], "table workflow tracked vector");

const g_strDocumentedFilePath = g_Path.join(g_strGameRootPath, "materials", "sourcejs", "documented-native.vmt");
const g_FileController = g_DocumentationWorkflows.CreateNativeDownloadFileController(g_strDocumentedFilePath);
const g_FileInspection = ToPlainValue(g_FileController.Inspect());

g_Assert.equal(g_FileController.Path, "materials/sourcejs/documented-native.vmt", "file workflow canonical stored path");
g_Assert.deepEqual(g_FileInspection, { HasPath: true, Index: g_FileController.Index, Listed: true, Path: g_FileController.Path, Tracked: true }, "file workflow inspection");
g_Assert.equal(g_FileController.Restore(), 1, "file workflow restores all tracked paths");

const g_RestoreResult = ToPlainValue(g_DocumentationWorkflows.RestoreNativeDownloads());
g_Assert.equal(g_RestoreResult.RestoredCount, 1, "restore workflow successful-path count");
g_Assert.deepEqual(g_RestoreResult.TrackedBefore, [g_FileController.Path], "restore workflow input vector");
g_Assert.deepEqual(g_RestoreResult.TrackedAfter, [g_FileController.Path], "restore workflow preserves tracking");
g_Assert.equal(ContainsValue(g_RestoreResult.TableEntries, g_FileController.Path), true, "restore workflow table entries");
g_Assert.equal(g_FileController.Dispose(), true, "file workflow disposal");
g_Assert.equal(g_FileController.Dispose(), false, "file workflow repeated disposal");

const g_DirectoryController = g_DocumentationWorkflows.CreateNativeDownloadDirectoryController("materials/sourcejs", false);
const g_vecDirectoryInspection = ToPlainValue(g_DirectoryController.Inspect());

const g_strDocumentedDirectoryFilePath = "materials/sourcejs/native-logo.vmt";
const g_vecDocumentedDirectoryPaths = ToPlainValue(g_DirectoryController.Paths);
g_Assert.deepEqual(g_vecDocumentedDirectoryPaths, [g_strDocumentedDirectoryFilePath], "directory workflow non-recursive paths");
g_Assert.deepEqual(g_vecDirectoryInspection, [{ HasPath: true, Path: g_strDocumentedDirectoryFilePath, Tracked: true }], "directory workflow inspection");
g_Assert.equal(g_DirectoryController.Restore(), 1, "directory workflow restores all tracked paths");
g_Assert.equal(g_DirectoryController.Dispose(), 1, "directory workflow disposal");
g_Assert.equal(ContainsValue(g_DownloadsAPI.GetTrackedDownloadables(), g_strSiblingPath), false, "directory workflow does not track sibling");
g_Assert.deepEqual(g_vecTrackedDownloadPaths, [], "documentation workflows release the native tracking vector");
g_Assert.equal(g_TableResult.Table.Address, g_unCurrentTableAddress, "documentation retains live table records");

ReleaseStringTablesDownloadsFixture();

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntime = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strDownloadsPath)});`], {
	encoding: "utf8",
	env: {
		...process.env,
		NODE_PATH: g_Path.dirname(g_strRootPackagePath),
	},
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
});
g_Assert.equal(g_MissingRuntime.error, undefined, "missing-runtime child starts and completes");
g_Assert.equal(g_MissingRuntime.status, 1, "stringtables/downloads requires the native runtime");
g_Assert.match(g_MissingRuntime.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_stringtables_downloads");
