#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "settings.md");
const g_strSettingsPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "settings.js");
const g_strInternalRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strModuleBindingsSourcePath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");

// Virtual fixture only; no physical game directory is read or written.
const g_strSettingsRootPath = "C:/game/addons/sourcejs/data/settings";
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unChildTimeoutMilliseconds = 5000;
const g_vecExpectedExports = [
	"DoesFileExist",
	"EnsureDirectoryExists",
	"ReadTextFile",
	"Root",
	"WriteTextFile",
];

const g_setDirectoryPaths = new Set([g_strSettingsRootPath]);
const g_setEnginePaths = new Set();
const g_mapFiles = new Map();
const g_vecOperations = [];
const g_vecCodeBlocks = [];
const g_Workflows = {};

const g_NativeSettings = {
	Root: g_strSettingsRootPath,

	EnsureDirectoryExists(strDirectoryPath) {
		g_vecOperations.push(["EnsureDirectoryExists", strDirectoryPath]);

		if (g_mapFiles.has(strDirectoryPath)) {
			return false;
		}

		g_setDirectoryPaths.add(strDirectoryPath);

		return true;
	},

	DoesFileExist(strFilePath) {
		g_vecOperations.push(["DoesFileExist", strFilePath]);

		return g_setDirectoryPaths.has(strFilePath) || g_mapFiles.has(strFilePath) || g_setEnginePaths.has(strFilePath);
	},

	ReadTextFile(strFilePath) {
		g_vecOperations.push(["ReadTextFile", strFilePath]);

		return g_mapFiles.get(strFilePath) ?? null;
	},

	WriteTextFile(strFilePath, strText) {
		g_vecOperations.push(["WriteTextFile", strFilePath, strText]);

		const strDirectoryPath = g_Path.posix.dirname(strFilePath);
		if (g_mapFiles.has(strDirectoryPath)) {
			return false;
		}

		g_setDirectoryPaths.add(strDirectoryPath);
		g_mapFiles.set(strFilePath, strText);

		return true;
	},
};

const g_mapPackageCacheDescriptors = new Map();
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
let g_bPackageCacheOwned = false;
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;

function RestoreProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned settings fixture property must be removable: " + strKey);
}

function RestoreSettingsFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	// Only owned virtual files and workflow objects are discarded here.
	AttemptRestoration(() => g_setDirectoryPaths.clear());
	AttemptRestoration(() => g_setDirectoryPaths.add(g_strSettingsRootPath));
	AttemptRestoration(() => g_setEnginePaths.clear());
	AttemptRestoration(() => g_mapFiles.clear());
	AttemptRestoration(() => {
		g_vecOperations.length = 0;
	});
	AttemptRestoration(() => {
		g_vecCodeBlocks.length = 0;
	});

	for (const strName of Object.getOwnPropertyNames(g_Workflows)) {
		AttemptRestoration(() => RestoreProperty(g_Workflows, strName, undefined));
	}

	if (g_bLoaderOwned) {
		AttemptRestoration(() => RestoreProperty(g_Module, "_load", g_LoaderDescriptor));
	}

	if (g_bPackageCacheOwned) {
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", g_SourceJSDescriptor));
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Settings fixture restoration failed.");
	}
}

function ExecuteCodeBlock(strCode, unBlockIndex, SettingsAPI) {
	const strFileName = g_strDocumentationPath + ":" + unBlockIndex;
	const DocumentationModuleRecord = new g_Module(strFileName, module);
	DocumentationModuleRecord.filename = strFileName;
	DocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	DocumentationModuleRecord.require = function(strRequestName) {
		g_Assert.equal(strRequestName, "settings", `settings code block ${unBlockIndex} import`);

		return SettingsAPI;
	};
	DocumentationModuleRecord._compile(strCode, strFileName);

	return DocumentationModuleRecord.exports;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CloneSerializableValue(Value) {
	return JSON.parse(JSON.stringify(Value));
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "settings contents section");

	const vecDocumentedAnchors = [...vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => NormalizeHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "settings contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinks = [...strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `settings documentation link must exist: ${strTarget}`);
	}
}

function VerifySettingsRootSnapshots() {
	const RootDescriptor = Object.getOwnPropertyDescriptor(g_NativeSettings, "Root");
	const unOperationCount = g_vecOperations.length;
	const strAlternateRoot = `${g_strSettingsRootPath}/alternate`;
	const strExplicitPath = `${g_strSettingsRootPath}/explicit-unmapped-path`;

	try {
		g_NativeSettings.Root = strAlternateRoot;
		const PathWorkflow = ExecuteCodeBlock(g_vecCodeBlocks[1], 2, g_NativeSettings);
		g_Assert.equal(g_NativeSettings.Root, strAlternateRoot, "settings root is writable module state");
		g_Assert.equal(g_Workflows.GetMatchSettingsPath("snapshot.json"), `${g_strSettingsRootPath}/match-control/snapshot.json`, "existing named import retains its captured root");
		g_Assert.equal(PathWorkflow.GetMatchSettingsPath("snapshot.json"), `${strAlternateRoot}/match-control/snapshot.json`, "new named import captures the current root");

		g_NativeSettings.ReadTextFile(strExplicitPath);
		g_Assert.deepEqual(g_vecOperations.at(-1), ["ReadTextFile", strExplicitPath], "root edits do not rewrite explicit filesystem arguments");
	} finally {
		RestoreProperty(g_NativeSettings, "Root", RootDescriptor);
		g_vecOperations.length = unOperationCount;
	}

	g_Assert.equal(g_NativeSettings.Root, g_strSettingsRootPath, "root snapshot fixture restores its own module field");
}

function VerifySettingsInputSnapshots() {
	let unAutoReadyReadCount = 0;
	let unMinimumPlayersReadCount = 0;
	const Settings = {
		get AutoReady() {
			unAutoReadyReadCount++;

			return (unAutoReadyReadCount === 1) ? true : "Invalid second read";
		},

		get MinimumPlayers() {
			unMinimumPlayersReadCount++;

			return (unMinimumPlayersReadCount === 1) ? 4 : "Invalid second read";
		},
	};
	const Result = g_Workflows.SaveMatchSettings("snapshot.json", Settings);
	for (const strText of [Result.Text, g_mapFiles.get(Result.FilePath)]) {
		g_Assert.deepEqual(JSON.parse(strText), { AutoReady: true, MinimumPlayers: 4 }, "write stores the validated property snapshot");
	}

	g_Assert.equal(unAutoReadyReadCount, 1, "write validates and captures AutoReady once");
	g_Assert.equal(unMinimumPlayersReadCount, 1, "write validates and captures MinimumPlayers once");
}

function VerifyDocumentedSettingsFailures() {
	const unOriginalOperationCount = g_vecOperations.length;
	const vecInvalidFileNames = [
		null,
		undefined,
		1,
		"",
		"../server.json",
		"/server.json",
		"sub/server.json",
		"sub\\server.json",
		"server\0.json",
	];
	for (const FileName of vecInvalidFileNames) {
		for (const Invoke of [
			() => g_Workflows.GetMatchSettingsPath(FileName),
			() => g_Workflows.LoadMatchSettings(FileName),
			() => g_Workflows.SaveMatchSettings(FileName, { AutoReady: true, MinimumPlayers: 1 }),
		]) {
			g_Assert.throws(Invoke, (ErrorValue) => ErrorValue.name === "TypeError", "invalid filename fails before filesystem work");
		}
	}

	for (const Settings of [
		null,
		undefined,
		1,
		[],
		{ AutoReady: "yes", MinimumPlayers: 1 },
		{ AutoReady: true, MinimumPlayers: 0 },
		{ AutoReady: true, MinimumPlayers: 1.5 },
		{ AutoReady: true, MinimumPlayers: Infinity },
	]) {
		g_Assert.throws(() => g_Workflows.SaveMatchSettings("invalid-schema.json", Settings), (ErrorValue) => ["TypeError", "RangeError"].includes(ErrorValue.name), "invalid schema fails before filesystem work");
	}

	const GetterError = new Error("Settings getter failed");
	let unMinimumPlayersReadCount = 0;
	const Settings = {
		get AutoReady() {
			throw GetterError;
		},

		get MinimumPlayers() {
			unMinimumPlayersReadCount++;

			return 1;
		},
	};
	g_Assert.throws(() => g_Workflows.SaveMatchSettings("getter-error.json", Settings), (ErrorValue) => ErrorValue === GetterError, "getter error propagates unchanged");
	g_Assert.equal(unMinimumPlayersReadCount, 0, "AutoReady validation still precedes reading MinimumPlayers");
	g_Assert.equal(g_vecOperations.length, unOriginalOperationCount, "invalid inputs do not perform filesystem work");

	const InheritedSettings = Object.create({ AutoReady: false, MinimumPlayers: 2 });
	Object.defineProperty(InheritedSettings, "UnknownProperty", {
		get() {
			throw new Error("Unknown properties must not be read.");
		},
	});
	const Result = g_Workflows.SaveMatchSettings("inherited.json", InheritedSettings);
	g_Assert.deepEqual(JSON.parse(Result.Text), { AutoReady: false, MinimumPlayers: 2 }, "known inherited properties are accepted and unknown properties ignored");

	let unWriteCount = 0;
	const FailedDirectoryAPI = {
		Root: g_strSettingsRootPath,

		EnsureDirectoryExists() {
			return false;
		},

		WriteTextFile() {
			unWriteCount++;

			return true;
		},
	};
	const DirectoryWorkflow = ExecuteCodeBlock(g_vecCodeBlocks[2], 3, FailedDirectoryAPI);
	g_Assert.throws(() => DirectoryWorkflow.PrepareMatchSettingsDirectory(), /Could not prepare settings directory/, "directory conflict is explicit");

	const WriteWorkflow = ExecuteCodeBlock(g_vecCodeBlocks[3], 4, FailedDirectoryAPI);
	g_Assert.throws(() => WriteWorkflow.SaveMatchSettings("directory-error.json", { AutoReady: true, MinimumPlayers: 1 }), /Could not prepare settings directory/, "failed directory stops the write");
	g_Assert.equal(unWriteCount, 0, "failed directory never reaches WriteTextFile");

	const FailedWriteAPI = { ...FailedDirectoryAPI, EnsureDirectoryExists: () => true, WriteTextFile: () => false };
	const FailedWriteWorkflow = ExecuteCodeBlock(g_vecCodeBlocks[3], 4, FailedWriteAPI);
	g_Assert.throws(() => FailedWriteWorkflow.SaveMatchSettings("write-error.json", { AutoReady: true, MinimumPlayers: 1 }), /Could not write settings file/, "failed native write is not success");
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Settings runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Settings loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed settings cache entries must support exact restoration.");
}

let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	g_bPackageCacheOwned = true;
	for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
		RestoreProperty(require.cache, strModulePath, undefined);
	}

	g_bSourceJSOwned = true;
	// The lowercase module ID belongs to the raw runtime loader contract.
	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { settings: g_NativeSettings } });

	g_bLoaderOwned = true;
	Object.defineProperty(g_Module, "_load", {
		...g_LoaderDescriptor,
		value: function LoadModule(strRequest) {
			if (strRequest === "internal/runtime") {
				return require(g_strInternalRuntimePath);
			}

			return g_OriginalModuleLoad.apply(this, arguments);
		},
	});

	const g_SettingsAPI = require(g_strSettingsPath);
	RestoreProperty(g_Module, "_load", g_LoaderDescriptor);
	g_bLoaderOwned = false;

	const g_RunDocumentationWorkflows = () => {
		const strDocumentationMarkdown = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
		const strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsSourcePath, "utf8");
		g_vecCodeBlocks.push(...[...strDocumentationMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]));

		const vecSettingsBindingMatch = strModuleBindingsSource.match(/v8::Local<v8::Object> const LocalSettingsModule = MakeModule[\s\S]*?InstallModule\(pIsolate, LocalContext, LocalSourceJS, "settings", LocalSettingsModule\)/);

		g_Assert.equal(g_SettingsAPI, g_NativeSettings, "settings direct native module");
		g_Assert.ok(vecSettingsBindingMatch, "native settings registration block");

		const vecNativeExports = [...vecSettingsBindingMatch[0].matchAll(/Set(?:Function|String)\([^\n]+LocalSettingsModule, "([^"]+)"/g)].map((vecMatch) => vecMatch[1]).sort();
		const vecImportMatch = g_vecCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("settings"\);/);
		g_Assert.ok(vecImportMatch, "settings exact import example");

		const vecDocumentedExports = vecImportMatch[1].split(",").map((strName) => strName.split(":", 1)[0].trim()).filter(Boolean).sort();

		g_Assert.deepEqual(Object.keys(g_SettingsAPI).sort(), g_vecExpectedExports, "exact settings package exports");
		g_Assert.deepEqual(vecNativeExports, g_vecExpectedExports, "exact native settings exports");
		g_Assert.deepEqual(vecDocumentedExports, g_vecExpectedExports, "exact documented settings exports");
		g_Assert.equal(g_SettingsAPI.Root, g_strSettingsRootPath, "settings root");
		g_Assert.equal(g_vecCodeBlocks.length, 5, "settings JavaScript block count");
		g_Assert.doesNotMatch(strDocumentationMarkdown, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("settings"\)/, "settings documentation must remain hand-written and use direct imports");
		g_Assert.doesNotMatch(strDocumentationMarkdown, /[^\x00-\x7F]/, "settings documentation ASCII");
		g_Assert.doesNotMatch(strDocumentationMarkdown, /[ \t]+$/m, "settings documentation trailing whitespace");

		for (const strCode of g_vecCodeBlocks) {
			g_Assert.doesNotMatch(strCode, /^ +\S/m, "settings JavaScript fence indentation must use tabs");
		}

		VerifyContentsAnchors(strDocumentationMarkdown);
		VerifyDocumentationLinks(strDocumentationMarkdown);

		for (const [unBlockOffset, strCode] of g_vecCodeBlocks.entries()) {
			Object.assign(g_Workflows, ExecuteCodeBlock(strCode, unBlockOffset + 1, g_SettingsAPI));
		}

		g_Assert.equal(g_vecOperations.length, 0, "settings code blocks must not perform filesystem work while loading");
		g_Assert.deepEqual(Object.keys(g_Workflows).sort(), [
			"GetMatchSettingsPath",
			"LoadMatchSettings",
			"PrepareMatchSettingsDirectory",
			"SaveMatchSettings",
		], "settings documented workflows");

		const strSettingsFilePath = `${g_strSettingsRootPath}/match-control/server.json`;
		const strSettingsDirectory = `${g_strSettingsRootPath}/match-control`;
		g_Assert.equal(g_Workflows.GetMatchSettingsPath("server.json"), strSettingsFilePath, "settings owned path workflow");
		g_Assert.equal(g_vecOperations.length, 0, "settings path construction must remain pure");

		g_Assert.equal(g_Workflows.PrepareMatchSettingsDirectory(), strSettingsDirectory, "settings directory workflow");

		const SavedSettingsResult = CloneSerializableValue(g_Workflows.SaveMatchSettings("server.json", { AutoReady: true, MinimumPlayers: 4 }));
		g_Assert.equal(SavedSettingsResult.FilePath, strSettingsFilePath, "settings save path");
		g_Assert.equal(SavedSettingsResult.Text, g_mapFiles.get(strSettingsFilePath), "settings save text");
		g_Assert.deepEqual(JSON.parse(SavedSettingsResult.Text), { AutoReady: true, MinimumPlayers: 4 }, "settings persisted JSON");
		g_Assert.deepEqual(CloneSerializableValue(g_Workflows.LoadMatchSettings("server.json")), { AutoReady: true, MinimumPlayers: 4 }, "settings load workflow");
		g_Assert.equal(g_Workflows.LoadMatchSettings("missing.json"), null, "missing settings workflow");

		VerifySettingsRootSnapshots();

		VerifySettingsInputSnapshots();

		VerifyDocumentedSettingsFailures();

		const strEngineOnlyPath = `${g_strSettingsRootPath}/match-control/engine-only.json`;
		g_setEnginePaths.add(strEngineOnlyPath);
		g_Assert.throws(() => g_Workflows.LoadMatchSettings("engine-only.json"), /not a readable physical file/, "engine-only settings distinction");
		g_Assert.throws(() => g_Workflows.GetMatchSettingsPath("../server.json"), /simple match-settings filename/, "settings path traversal rejection");
		g_Assert.throws(() => g_Workflows.SaveMatchSettings("invalid.json", { AutoReady: "yes", MinimumPlayers: 4 }), /AutoReady must be a boolean/, "settings write schema validation");

		g_mapFiles.set(`${g_strSettingsRootPath}/match-control/malformed.json`, "{not-json}");
		g_Assert.throws(() => g_Workflows.LoadMatchSettings("malformed.json"), (ErrorValue) => ErrorValue && (ErrorValue.name === "SyntaxError"), "settings JSON syntax propagation");
		g_Assert.equal(g_SettingsAPI.ReadTextFile(`${g_strSettingsRootPath}/missing.json`), null, "native missing physical file sentinel");
		g_Assert.ok(g_vecOperations.some(([strOperation]) => strOperation === "EnsureDirectoryExists"), "settings EnsureDirectoryExists workflow");
		g_Assert.ok(g_vecOperations.some(([strOperation]) => strOperation === "DoesFileExist"), "settings DoesFileExist workflow");
		g_Assert.ok(g_vecOperations.some(([strOperation]) => strOperation === "ReadTextFile"), "settings ReadTextFile workflow");
		g_Assert.ok(g_vecOperations.some(([strOperation]) => strOperation === "WriteTextFile"), "settings WriteTextFile workflow");

		const MissingRuntimeProcess = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSettingsPath)});`], { env: { ...process.env, NODE_PATH: g_strPackageRootPath }, encoding: "utf8", timeout: g_unChildTimeoutMilliseconds });
		g_Assert.equal(MissingRuntimeProcess.error, undefined, "missing-runtime child must start and terminate normally");
		g_Assert.equal(MissingRuntimeProcess.status, 1, "missing-runtime child uses the expected failure exit code");
		g_Assert.notEqual(MissingRuntimeProcess.status, 0, "settings requires the native runtime");
		g_Assert.match(MissingRuntimeProcess.stderr, /SourceJS native runtime is not installed/, "settings missing-runtime error");
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	try {
		RestoreSettingsFixture();
	} catch (CleanupFailure) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, CleanupFailure] : [CleanupFailure], "Settings smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_settings");
