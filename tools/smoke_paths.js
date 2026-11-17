#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");
const { CreateNativePaths } = require("./native_paths_mock.js");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPathsPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "paths.js");
const g_strPathsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "paths.md");
const g_strRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_unScriptTimeoutMilliseconds = 1000;

const g_vecPathExportNames = [
	"ADDON_ROOT",
	"AUTH_CONFIG_ROOT",
	"AUTH_PARENTS_FILE",
	"AUTH_PLAYERS_FILE",
	"AUTH_SIMPLE_FILE",
	"AUTH_SQL_FILE",
	"BACKEND_CONFIG_FILE",
	"BACKEND_ROOT",
	"BASE_ROOT",
	"CONFIG_ROOT",
	"CUSTOM_DATA_ROOT",
	"CUSTOM_PACKAGE_DOCS_ROOT",
	"CUSTOM_PACKAGE_ROOT",
	"DATA_ROOT",
	"DOCS_ROOT",
	"EVENT_ROOT",
	"EXTENSION_ROOT",
	"GAME_ROOT",
	"LANGUAGE_FILE",
	"LOG_ROOT",
	"PACKAGE_ROOT",
	"PLUGIN_DATA_ROOT",
	"PLUGIN_DOCS_ROOT",
	"PLUGIN_ROOT",
	"SITE_PACKAGE_ROOT",
	"SOUND_ROOT",
	"SOURCE_DATA_ROOT",
	"SOURCE_DOCS_ROOT",
	"SOURCE_PACKAGE_ROOT",
	"TRANSLATION_CORE_FILE",
	"TRANSLATION_CORE_ROOT",
	"TRANSLATION_ROOT",
	"UPDATE_DATA_ROOT",
	"UPDATE_ROOT",
	"UPDATE_SOURCE_DATA_ROOT",
];

function VerifyNativePathEncoding() {
	// Structural wiring guards only; RuntimePathsContracts.cpp checks real path conversion.
	const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
	const vecContracts = [
		{ Expected: "v8::Local<v8::String> const LocalPathValue = MakeString(pIsolate, EncodePathAsUTF8(PathValue));", Regressed: "v8::Local<v8::String> const LocalPathValue = MakeString(pIsolate, PathValue.string());" },
		{ Expected: "if (!SetString(pIsolate, LocalContext, LocalCoreSettingsModule, \"Root\", EncodePathAsUTF8(Paths.GetDataPath() / \"settings\"))) {", Regressed: "if (!SetString(pIsolate, LocalContext, LocalCoreSettingsModule, \"Root\", (Paths.GetDataPath() / \"settings\").string())) {" },
		{ Expected: "if (!SetString(pIsolate, LocalContext, LocalCoreSettingsModule, \"ConfigurationRoot\", EncodePathAsUTF8(Paths.GetGameRootPath() / \"cfg\" / \"sourcejs\"))) {", Regressed: "if (!SetString(pIsolate, LocalContext, LocalCoreSettingsModule, \"ConfigurationRoot\", (Paths.GetGameRootPath() / \"cfg\" / \"sourcejs\").string())) {" },
		{ Expected: "if (!SetString(pIsolate, LocalContext, LocalCoreDumpsModule, \"Root\", EncodePathAsUTF8(Paths.GetGameRootPath() / \"logs\" / \"sourcejs\"))) {", Regressed: "if (!SetString(pIsolate, LocalContext, LocalCoreDumpsModule, \"Root\", (Paths.GetGameRootPath() / \"logs\" / \"sourcejs\").string())) {" },
		{ Expected: "if (!SetString(pIsolate, LocalContext, LocalConfigurationModule, \"Root\", EncodePathAsUTF8(Paths.GetGameRootPath() / \"cfg\" / \"sourcejs\"))) {", Regressed: "if (!SetString(pIsolate, LocalContext, LocalConfigurationModule, \"Root\", (Paths.GetGameRootPath() / \"cfg\" / \"sourcejs\").string())) {" },
		{ Expected: "if (!SetString(pIsolate, LocalContext, LocalSettingsModule, \"Root\", EncodePathAsUTF8(Paths.GetDataPath() / \"settings\"))) {", Regressed: "if (!SetString(pIsolate, LocalContext, LocalSettingsModule, \"Root\", (Paths.GetDataPath() / \"settings\").string())) {" },
	];

	const Verify = (strSource) => {
		for (const Contract of vecContracts) {
			g_Assert.equal(strSource.split(Contract.Expected).length - 1, 1, "Native path export must use explicit UTF-8 conversion: " + Contract.Expected);
		}
	};
	Verify(strBindings);

	for (const Contract of vecContracts) {
		const strChanged = strBindings.replace(Contract.Expected, Contract.Regressed);
		g_Assert.notEqual(strChanged, strBindings, "Native path encoding mutation anchor exists");
		g_Assert.throws(() => Verify(strChanged), g_Assert.AssertionError, "Native-code-page path export regression must be rejected");
	}
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)].map((vecMatch) => vecMatch[1]);
}

function VerifyLocalLinks(strMarkdown) {
	for (const vecMatch of strMarkdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strTarget = vecMatch[1];
		if (/^(?:[a-z]+:|#)/i.test(strTarget)) {
			continue;
		}

		const strPathWithoutFragment = strTarget.split("#", 1)[0];
		const strResolvedPath = g_Path.resolve(g_Path.dirname(g_strPathsDocumentationPath), strPathWithoutFragment);
		g_Assert.ok(g_FileSystem.existsSync(strResolvedPath), `missing documentation target: ${strTarget}`);
	}
}

function CreateFilesystemFixture(Paths) {
	const setDirectories = new Set([Paths.BASE_ROOT, Paths.DATA_ROOT, Paths.GAME_ROOT]);
	const mapFiles = new Map();

	return {
		Directories: setDirectories,
		Files: mapFiles,
		API: {
			EnsureDirectoryExists(strDirectoryPath) {
				setDirectories.add(strDirectoryPath);

				return true;
			},

			DoesFileExist(strTargetPath) {
				return setDirectories.has(strTargetPath) || mapFiles.has(strTargetPath);
			},

			ReadTextFile(strFilePath) {
				return mapFiles.get(strFilePath) ?? null;
			},

			RemoveFile(strTargetPath) {
				return mapFiles.delete(strTargetPath) || setDirectories.delete(strTargetPath);
			},

			WriteTextFile(strFilePath, strText) {
				mapFiles.set(strFilePath, String(strText));

				return true;
			},
		},
	};
}

function CheckDocumentationTopology(Paths) {
	const strMarkdown = g_FileSystem.readFileSync(g_strPathsDocumentationPath, "utf8");
	const vecExamples = ExtractJavaScriptBlocks(strMarkdown).filter((strSource) => strSource.includes("g_bHasExpectedAddonRoot"));
	g_Assert.equal(vecExamples.length, 1, "one lexical topology example");

	const vecRootCases = [
		["/game/tf/", "/game/tf/addons/", "/game/tf/addons/sourcejs/"],
		["/", "/addons/", "/addons/sourcejs/"],
		["C:\\Games\\tf\\", "C:\\Games\\tf\\addons\\", "C:\\Games\\tf\\addons\\sourcejs\\"],
		["\\\\server\\share\\tf\\", "\\\\server\\share\\tf\\addons\\", "\\\\server\\share\\tf\\addons\\sourcejs\\"],
	];
	for (const vecRoots of vecRootCases) {
		const RuntimePaths = { ...Paths, GAME_ROOT: vecRoots[0], ADDON_ROOT: vecRoots[1], BASE_ROOT: vecRoots[2] };

		const ExecuteExample = () => g_VM.runInNewContext(vecExamples[0], { require: () => RuntimePaths }, { filename: `${g_strPathsDocumentationPath}:topology`, timeout: g_unScriptTimeoutMilliseconds });
		g_Assert.doesNotThrow(ExecuteExample, "valid roots with trailing separators are accepted");

		RuntimePaths.BASE_ROOT += "unexpected-depth";
		g_Assert.throws(ExecuteExample, /expected topology/, "incorrect exported child topology is rejected");
	}
}

function CheckDocumentationCleanupFailures(Paths) {
	const strMarkdown = g_FileSystem.readFileSync(g_strPathsDocumentationPath, "utf8");
	const vecExamples = ExtractJavaScriptBlocks(strMarkdown);
	for (const strKind of ["ROUNDSUMMARY", "LATENCYWATCH", "STAGEDUPDATEMANIFEST"]) {
		const strMarker = (strKind === "ROUNDSUMMARY") ? "const ExpectedRoundSummary" : ((strKind === "LATENCYWATCH") ? "latency-watch initialized" : "const StagedUpdateManifest");
		const vecMatchingExamples = vecExamples.filter((strSource) => strSource.includes(strMarker));
		g_Assert.equal(vecMatchingExamples.length, 1, "one " + strKind + " cleanup example");

		const vecTargetPaths = (strKind === "ROUNDSUMMARY") ? [Paths.PLUGIN_DATA_ROOT + "/round-summary/latest.json"] : ((strKind === "LATENCYWATCH") ? [Paths.CONFIG_ROOT + "/latency-watch/settings.json", Paths.LOG_ROOT + "/latency-watch/startup.log"] : [Paths.UPDATE_SOURCE_DATA_ROOT + "/example-manifest.json"]);
		const vecModes = [
			"SUCCESS",
			"EXISTING",
			"WRITEFALSE",
			"WRITETHROW",
			"READTHROW",
			"CLEANUPFALSE",
			"CLEANUPTHROW",
			"BOTHTHROW",
			"NULLANDCLEANUPTHROW",
			"CLEANUPPRESENCETHROW",
		];
		if (strKind === "LATENCYWATCH") {
			vecModes.push("SECONDCLEANUPTHROW", "BOTHCLEANUPTHROW", "OPERATIONANDBOTHCLEANUPTHROW");
		}

		for (const strMode of vecModes) {
			const Fixture = CreateFilesystemFixture(Paths);
			const OperationError = new Error("Controlled operation failure");
			const CleanupError = new Error("Controlled first cleanup failure");
			const SecondCleanupError = new Error("Controlled second cleanup failure");
			let unWriteCallCount = 0;
			let unPresenceCallCount = 0;
			const vecCleanupAttempts = [];

			if (strMode === "EXISTING") {
				Fixture.Files.set(vecTargetPaths[0], "preserved existing content");
			}

			const FilesystemAPI = {
				...Fixture.API,

				DoesFileExist(strFilePath) {
					unPresenceCallCount += 1;
					if ((strMode === "CLEANUPPRESENCETHROW") && (unPresenceCallCount === (vecTargetPaths.length + 1))) {
						vecCleanupAttempts.push(strFilePath);
						throw CleanupError;
					}

					return Fixture.API.DoesFileExist(strFilePath);
				},

				WriteTextFile(strFilePath, strText) {
					unWriteCallCount += 1;
					Fixture.API.WriteTextFile(strFilePath, strText);

					if (unWriteCallCount === vecTargetPaths.length) {
						if (strMode === "WRITEFALSE") {
							return false;
						}

						if (strMode === "WRITETHROW") {
							throw OperationError;
						}
					}

					return true;
				},

				ReadTextFile(strFilePath) {
					if (["READTHROW", "BOTHTHROW", "OPERATIONANDBOTHCLEANUPTHROW"].includes(strMode)) {
						throw OperationError;
					}

					if (strMode === "NULLANDCLEANUPTHROW") {
						throw null;
					}

					return Fixture.API.ReadTextFile(strFilePath);
				},

				RemoveFile(strFilePath) {
					vecCleanupAttempts.push(strFilePath);

					if (strFilePath === vecTargetPaths[0]) {
						if (strMode === "CLEANUPFALSE") {
							return false;
						}

						if (["CLEANUPTHROW", "BOTHTHROW", "NULLANDCLEANUPTHROW", "BOTHCLEANUPTHROW", "OPERATIONANDBOTHCLEANUPTHROW"].includes(strMode)) {
							throw CleanupError;
						}

					} else if (["SECONDCLEANUPTHROW", "BOTHCLEANUPTHROW", "OPERATIONANDBOTHCLEANUPTHROW"].includes(strMode)) {
						throw SecondCleanupError;
					}

					return Fixture.API.RemoveFile(strFilePath);
				},
			};

			const ExecuteExample = () => g_VM.runInNewContext(vecMatchingExamples[0], {
				require(strName) {
					return (strName === "paths") ? Paths : FilesystemAPI;
				},
			}, { filename: `${g_strPathsDocumentationPath}:${strKind}/${strMode}`, timeout: g_unScriptTimeoutMilliseconds });
			if (strMode === "SUCCESS") {
				g_Assert.doesNotThrow(ExecuteExample);

			} else if (strMode === "EXISTING") {
				g_Assert.throws(ExecuteExample, /already exists|overwrite existing/);

			} else {
				g_Assert.throws(ExecuteExample, (CaughtError) => {
					if (["WRITETHROW", "READTHROW"].includes(strMode)) {
						g_Assert.equal(CaughtError, OperationError, "successful cleanup preserves the original error identity");

					} else if (strMode === "WRITEFALSE") {
						g_Assert.match(CaughtError.message, /could not be written/);

					} else {
						const vecErrors = (CaughtError.name === "AggregateError") ? Array.from(CaughtError.errors) : [CaughtError];
						const vecExpectedErrors = [];
						if (["BOTHTHROW", "OPERATIONANDBOTHCLEANUPTHROW", "NULLANDCLEANUPTHROW"].includes(strMode)) {
							vecExpectedErrors.push((strMode === "NULLANDCLEANUPTHROW") ? null : OperationError);
						}

						if (strMode !== "SECONDCLEANUPTHROW") {
							vecExpectedErrors.push((strMode === "CLEANUPFALSE") ? "STATUS" : CleanupError);
						}

						if (["SECONDCLEANUPTHROW", "BOTHCLEANUPTHROW", "OPERATIONANDBOTHCLEANUPTHROW"].includes(strMode)) {
							vecExpectedErrors.push(SecondCleanupError);
						}

						g_Assert.equal(vecErrors.length, vecExpectedErrors.length, "all operation/cleanup failures survive");
						for (const unErrorIndex of vecExpectedErrors.keys()) {
							if (vecExpectedErrors[unErrorIndex] === "STATUS") {
								g_Assert.match(vecErrors[unErrorIndex].message, /could not be removed/);

							} else {
								g_Assert.equal(vecErrors[unErrorIndex], vecExpectedErrors[unErrorIndex], "failure order and identity are retained");
							}
						}
					}

					return true;
				}, strKind + "/" + strMode);
			}

			g_Assert.deepEqual(vecCleanupAttempts, (strMode === "EXISTING") ? [] : vecTargetPaths, "every owned cleanup is attempted exactly once in order");

			if (strMode === "EXISTING") {
				g_Assert.equal(unWriteCallCount, 0, "pre-existing files are never written");
				g_Assert.equal(Fixture.Files.get(vecTargetPaths[0]), "preserved existing content");

			} else if (["SUCCESS", "WRITEFALSE", "WRITETHROW", "READTHROW"].includes(strMode)) {
				g_Assert.equal(Fixture.Files.size, 0, "normal cleanup also releases partially written files");
			}
		}
	}
}

function VerifyDocumentation(Paths) {
	const strMarkdown = g_FileSystem.readFileSync(g_strPathsDocumentationPath, "utf8");
	g_Assert.doesNotMatch(strMarkdown, /Generated by|generate_api_docs/, "paths documentation must be hand-maintained");
	g_Assert.doesNotMatch(strMarkdown, /console\./, "paths documentation must avoid console-only examples");
	VerifyLocalLinks(strMarkdown);

	const vecDocumentedExports = [...strMarkdown.matchAll(/^\| `([^`]+)` \|/gm)].map((vecMatch) => vecMatch[1]);
	g_Assert.deepEqual(vecDocumentedExports.sort(), [...g_vecPathExportNames].sort(), "paths documented export inventory");

	const vecExampleBlocks = ExtractJavaScriptBlocks(strMarkdown);
	g_Assert.equal(vecExampleBlocks.length, 9, "paths documentation JavaScript block count");

	const strExampleSource = vecExampleBlocks.join("\n");
	for (const strExportName of g_vecPathExportNames) {
		g_Assert.match(strExampleSource, new RegExp(`\\b${strExportName}\\b`), `paths example coverage: ${strExportName}`);
	}

	const FileSystemFixture = CreateFilesystemFixture(Paths);
	for (const [unExampleIndex, strSource] of vecExampleBlocks.entries()) {
		const Context = {
			require(strModuleName) {
				if (strModuleName === "paths") {
					return Paths;
				}

				if (strModuleName === "filesystem") {
					return FileSystemFixture.API;
				}

				throw new Error(`Unexpected documentation import: ${strModuleName}`);
			},
		};

		g_VM.runInNewContext(strSource, Context, { filename: `${g_strPathsDocumentationPath}:example-${unExampleIndex + 1}`, timeout: g_unScriptTimeoutMilliseconds });
	}

	g_Assert.equal(FileSystemFixture.Files.size, 0, "paths documentation must clean up written files");
}

function RestoreProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		delete Owner[strName];
		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

function LoadPathsModule() {
	const OriginalModuleLoad = g_Module._load;
	const ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");

	const Load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	try {
		Object.defineProperty(g_Module, "_load", { configurable: true, enumerable: ModuleLoadDescriptor.enumerable, writable: true, value: Load });
		return require(g_strPathsPath);
	} finally {
		Object.defineProperty(g_Module, "_load", ModuleLoadDescriptor);
	}
}

function VerifyRuntimeRequirement() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const PathsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPathsPath);

	try {
		delete globalThis.sourcejs;
		delete require.cache[g_strPathsPath];
		g_Assert.throws(() => LoadPathsModule(), /SourceJS native runtime is not installed/, "paths requires native runtime");
	} finally {
		RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
		RestoreProperty(require.cache, g_strPathsPath, PathsCacheDescriptor);
	}
}

function VerifyMockPathRoots() {
	const VerifyRoots = CreatePaths => {
		const POSIXPaths = CreatePaths({ GAME_ROOT: "/" });
		g_Assert.equal(POSIXPaths.ADDON_ROOT, "/addons", "preserve the POSIX root in derived mock paths");
		g_Assert.equal(POSIXPaths.BASE_ROOT, "/addons/sourcejs", "derive the base below the POSIX root");
		g_Assert.equal(POSIXPaths.SOURCE_DATA_ROOT, "/addons/sourcejs/data/sourcejs", "preserve absolute nested data paths");

		const DataRootPaths = CreatePaths({ DATA_ROOT: "/" });
		g_Assert.equal(DataRootPaths.SOURCE_DATA_ROOT, "/sourcejs", "preserve an overridden data root");

		for (const strGameRoot of ["//Server/Share/Game", "\\\\Server\\Share\\Game"]) {
			const NetworkPaths = CreatePaths({ GAME_ROOT: strGameRoot });
			g_Assert.equal(NetworkPaths.GAME_ROOT, "//Server/Share/Game", "preserve the UNC prefix in mock paths");
			g_Assert.equal(NetworkPaths.BASE_ROOT, "//Server/Share/Game/addons/sourcejs", "preserve the UNC prefix in derived mock paths");
		}
	};
	VerifyRoots(CreateNativePaths);

	const vecFaults = [
		{
			ExpectedMessage: "preserve the POSIX root in derived mock paths",

			CreatePaths(Overrides) {
				const Paths = CreateNativePaths(Overrides);
				if (Overrides.GAME_ROOT === "/") {
					Paths.ADDON_ROOT = Paths.ADDON_ROOT.replace(/^\//, "");
				}

				return Paths;
			},
		},
		{
			ExpectedMessage: "preserve the UNC prefix in mock paths",

			CreatePaths(Overrides) {
				const Paths = CreateNativePaths(Overrides);
				for (const strName of Object.keys(Paths)) {
					if (Paths[strName].startsWith("//")) {
						Paths[strName] = Paths[strName].slice(1);
					}
				}

				return Paths;
			},
		},
	];
	for (const Fault of vecFaults) {
		g_Assert.throws(() => VerifyRoots(Fault.CreatePaths), new RegExp(Fault.ExpectedMessage), "reject root-loss mock fault");
	}
}

function CheckPaths() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const PathsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPathsPath);
	const RuntimeCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strRuntimePath);
	const NativePaths = CreateNativePaths();

	try {
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { paths: NativePaths } });
		delete require.cache[g_strPathsPath];
		delete require.cache[g_strRuntimePath];

		const Paths = LoadPathsModule();
		g_Assert.equal(Paths, NativePaths, "paths must export the exact native module object");
		g_Assert.equal(Object.isFrozen(Paths), false, "paths must expose editable live runtime values");
		g_Assert.deepEqual(Object.keys(Paths).sort(), [...g_vecPathExportNames].sort(), "paths exports");
		g_Assert.notEqual(Paths.ADDON_ROOT, Paths.BASE_ROOT, "ADDON_ROOT and BASE_ROOT must have distinct ownership");
		g_Assert.equal(Paths.ADDON_ROOT, `${Paths.GAME_ROOT}/addons`, "ADDON_ROOT topology");
		g_Assert.equal(Paths.BASE_ROOT, `${Paths.ADDON_ROOT}/sourcejs`, "BASE_ROOT topology");
		g_Assert.equal(Paths.AUTH_SQL_FILE, NativePaths.AUTH_SQL_FILE, "paths.AUTH_SQL_FILE must preserve the SQL acronym and native value");

		const strOriginalGameRoot = Paths.GAME_ROOT;

		try {
			Paths.GAME_ROOT = "C:/different-game";
			g_Assert.equal(NativePaths.GAME_ROOT, "C:/different-game", "path assignment must update the exact native module object");
		} finally {
			Paths.GAME_ROOT = strOriginalGameRoot;
		}

		for (const strPathName of g_vecPathExportNames) {
			g_Assert.equal(typeof Paths[strPathName], "string", `${strPathName} must be a string`);
			g_Assert.ok(Paths[strPathName].length > 0, `${strPathName} must not be empty`);
		}

		for (const strRemovedName of ["moduleName", "paths", "string", "authSqlFile"]) {
			g_Assert.equal(Object.hasOwn(Paths, strRemovedName), false, `paths must not expose removed compatibility member: ${strRemovedName}`);
		}

		CheckDocumentationTopology(Paths);
		CheckDocumentationCleanupFailures(Paths);
		VerifyDocumentation(Paths);
		VerifyRuntimeRequirement();
	} finally {
		RestoreProperty(require.cache, g_strPathsPath, PathsCacheDescriptor);
		RestoreProperty(require.cache, g_strRuntimePath, RuntimeCacheDescriptor);
		RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
	}

	console.log("[smoke_paths] ok; six native UTF-8 export wiring mutation controls; package/doc workflows use Node doubles, not native V8 execution");
}

VerifyNativePathEncoding();
VerifyMockPathRoots();
CheckPaths();
