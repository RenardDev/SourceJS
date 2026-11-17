#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [-h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Run the autodoc documentation examples and generated-output checks.\n");
}

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ((vecArguments[0] === "-h") || (vecArguments[0] === "--help"))) {
		ShowUsage(process.stdout.fd);
		process.exit(0);
	}

	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported autodoc documentation test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

const g_unExecutionTimeoutMilliseconds = 1000;
const g_strDocumentationPath = g_Path.join(__dirname, "../docs/api/autodoc.md");
const g_strGeneratorPath = g_Path.join(__dirname, "../packages/sourcejs/autodoc.js");
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_strGenerator = g_FileSystem.readFileSync(g_strGeneratorPath, "utf8");
const g_strPackageDirectory = "addons/sourcejs/packages/sourcejs";
const g_strOutputDirectory = "addons/sourcejs/data/sourcejs/autodoc/sourcejs-api";
const g_vecExamples = Array.from(g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
const g_vecExpectedLogEntryCounts = [1, 0, 1, 1, 3, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1];
const g_ExampleIndices = {
	Build: 5,
	Constructor: 2,
	Create: 7,
	Error: 1,
	ModuleNames: 4,
	PackageCheck: 13,
	QuickStart: 15,
	ValidateProject: 17,
};
const g_setFileCreationExampleIndices = new Set([g_ExampleIndices.Build, g_ExampleIndices.Create, g_ExampleIndices.QuickStart, g_ExampleIndices.ValidateProject]);

function RunExample(strExample, bRemovePackageAfterConstruction = false) {
	const mapFiles = new Map();
	const setDirectories = new Set([g_strPackageDirectory]);
	const vecLogEntries = [];
	const vecErrorEntries = [];
	let unPackageCheckCount = 0;
	const Filesystem = {
		DoesFileExist(strPath) {
			if (bRemovePackageAfterConstruction && (strPath === g_strPackageDirectory)) {
				unPackageCheckCount += 1;
				return unPackageCheckCount === 1;
			}

			return mapFiles.has(strPath) || setDirectories.has(strPath);
		},
		EnsureDirectoryExists(strPath) {
			g_Assert((strPath === g_strOutputDirectory) || strPath.startsWith(`${g_strOutputDirectory}/`), "generated directory stays inside the controlled output tree");
			setDirectories.add(strPath);

			return true;
		},
		WriteTextFile(strPath, strText) {
			g_Assert(strPath.startsWith(`${g_strOutputDirectory}/`), "generated file stays inside the controlled output tree");
			g_Assert(setDirectories.has(strPath.slice(0, strPath.lastIndexOf("/"))), "parent directory exists before writing");
			mapFiles.set(strPath, strText);

			return true;
		},
	};
	const NativeAutodoc = {
		GetModuleNames() {
			return ["players/entity", "autodoc", "memory/hooks"];
		},
	};
	const Module = { exports: {} };
	g_VM.runInNewContext(g_strGenerator, {
		module: Module,
		require(strRequest) {
			if (strRequest === "filesystem") {
				return Filesystem;
			}

			if (strRequest === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						g_Assert.equal(strModuleName, "autodoc");

						return NativeAutodoc;
					},
				};
			}

			throw new Error(`Unexpected generator import: ${strRequest}`);
		},
	}, { filename: g_strGeneratorPath, timeout: g_unExecutionTimeoutMilliseconds });

	g_VM.runInNewContext(strExample, {
		require(strRequest) {
			g_Assert.equal(strRequest, "autodoc");

			return Module.exports;
		},
		console: {
			log(...vecValues) {
				vecLogEntries.push(vecValues);
			},
			error(...vecValues) {
				vecErrorEntries.push(vecValues);
			},
		},
	}, { filename: g_strDocumentationPath, timeout: g_unExecutionTimeoutMilliseconds });

	return { ErrorEntries: vecErrorEntries, Files: mapFiles, LogEntries: vecLogEntries };
}

function RunDocumentationChecks() {
	g_Assert.equal(g_vecExamples.length, g_vecExpectedLogEntryCounts.length, "all standalone documentation examples are exercised");

	for (let unExampleIndex = 0; unExampleIndex < g_vecExamples.length; unExampleIndex += 1) {
		const Result = RunExample(g_vecExamples[unExampleIndex]);
		g_Assert.equal(Result.LogEntries.length, g_vecExpectedLogEntryCounts[unExampleIndex], "every expected example output is observed");

		for (const vecEntry of Result.LogEntries) {
			for (const Value of vecEntry) {
				g_Assert.notEqual(Value, undefined, "examples do not read an unavailable public property");

				if (typeof Value === "string") {
					g_Assert.doesNotMatch(Value, /\bundefined\b/, "interpolated examples do not hide an unavailable property");
				}
			}
		}

		if (unExampleIndex === g_ExampleIndices.Error) {
			g_Assert.equal(Result.ErrorEntries.length, 1, "the error example reports the deliberately thrown SphinxError");
			g_Assert.equal(Result.ErrorEntries[0][0], "SphinxError");
			g_Assert.equal(Result.ErrorEntries[0][1], "Unable to write the module reference.");
		} else {
			g_Assert.equal(Result.ErrorEntries.length, 0, "ordinary examples do not hide errors");
		}

		if (unExampleIndex === g_ExampleIndices.Constructor) {
			g_Assert.equal(Result.LogEntries[0][0], `${g_strOutputDirectory}/source`);
			g_Assert.equal(Result.LogEntries[0][1], `${g_strOutputDirectory}/build`);
		}

		if (unExampleIndex === g_ExampleIndices.ModuleNames) {
			g_Assert.deepEqual(Result.LogEntries.map((vecEntry) => vecEntry[0]), ["autodoc", "memory/hooks", "players/entity"]);
		}

		if (g_setFileCreationExampleIndices.has(unExampleIndex)) {
			g_Assert(Result.Files.has(`${g_strOutputDirectory}/source/conf.py`), "project configuration is written");
			g_Assert(Result.Files.has(`${g_strOutputDirectory}/source/index.rst`), "root module index is written");

			if ((unExampleIndex === g_ExampleIndices.Build) || (unExampleIndex === g_ExampleIndices.QuickStart)) {
				g_Assert(Result.Files.has(`${g_strOutputDirectory}/build/index.html`), "HTML build output is written");
			}
		}
	}

	g_Assert.throws(() => RunExample(g_vecExamples[g_ExampleIndices.PackageCheck], true), /Package directory is missing: addons\/sourcejs\/packages\/sourcejs/, "a package disappearing after construction reports its supplied path");

	console.log(`Autodoc documentation PASS: ${g_vecExamples.length} examples, expected outputs, generated files and disappearing-package guard; actual generator with controlled filesystem and module-enumeration doubles, no native IO.`);
}

RunDocumentationChecks();
