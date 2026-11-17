#!/usr/bin/env node

"use strict";

const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strAutodocPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "autodoc.js");
const g_strPackageDirectory = "addons/sourcejs/packages/sourcejs";
const g_strProjectDirectory = "docs/sourcejs-api";
const g_strQuickProjectDirectory = "docs/quick-api";

const g_mapVirtualFiles = new Map();
const g_setVirtualDirectories = new Set([g_strPackageDirectory]);
// Fixture handle only; no native file is opened.
const g_hVirtualSourceFile = 1n;
const g_NativeAutodoc = {
	ModuleNames: ["autodoc"],
	GetModuleNames() {
		return this.ModuleNames.slice();
	},
};

function NormalizeVirtualPath(strVirtualPath) {
	if ((typeof strVirtualPath !== "string") || (strVirtualPath.length === 0)) {
		throw new TypeError("Virtual path must be a non-empty string.");
	}

	return strVirtualPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function GetParentDirectory(strFilePath) {
	const strNormalizedPath = NormalizeVirtualPath(strFilePath);
	const nSeparatorIndex = strNormalizedPath.lastIndexOf("/");

	return (nSeparatorIndex >= 0) ? strNormalizedPath.slice(0, nSeparatorIndex) : "";
}

function Assert(bCondition, strErrorMessage) {
	if (!bCondition) {
		throw new Error(strErrorMessage);
	}
}

function AssertEqual(ActualValue, ExpectedValue, strErrorMessage) {
	if (ActualValue !== ExpectedValue) {
		throw new Error(`${strErrorMessage}: expected ${String(ExpectedValue)}, got ${String(ActualValue)}`);
	}
}

function AssertThrows(Callback, strErrorMessage) {
	let CaughtError = null;

	try {
		Callback();
	} catch (ErrorValue) {
		CaughtError = ErrorValue;
	}

	Assert(CaughtError instanceof Error, strErrorMessage);
}

const g_NativeFilesystem = {
	CloseSourceFile() {
		return true;
	},
	IsSourceFileAtEnd() {
		return true;
	},
	EnsureDirectoryExists(strDirectoryPath) {
		g_setVirtualDirectories.add(NormalizeVirtualPath(strDirectoryPath));

		return true;
	},
	DoesFileExist(strFilePath) {
		const strNormalizedPath = NormalizeVirtualPath(strFilePath);

		return g_mapVirtualFiles.has(strNormalizedPath) || g_setVirtualDirectories.has(strNormalizedPath);
	},
	IsVPKFile(strFilePath) {
		NormalizeVirtualPath(strFilePath);

		return false;
	},
	ReadTextFile(strFilePath) {
		const strNormalizedPath = NormalizeVirtualPath(strFilePath);
		if (!g_mapVirtualFiles.has(strNormalizedPath)) {
			throw new Error(`Virtual file does not exist: ${strNormalizedPath}`);
		}

		return g_mapVirtualFiles.get(strNormalizedPath);
	},
	GetSourceFileDescriptor() {
		throw new Error("IFileSystem does not expose file descriptors.");
	},
	IsSourceFileSeekable() {
		return true;
	},
	IsSourceFileTTY() {
		return false;
	},
	OpenSourceFile() {
		return { Handle: g_hVirtualSourceFile, Mode: "rt", Path: "", PathID: "" };
	},
	ReadSourceFile() {
		return "";
	},
	ReadSourceFileLine() {
		return "";
	},
	RemoveFile() {
		return true;
	},
	SaveSourceFile() {
		return 0;
	},
	GetSeekTypes() {
		return { Current: 1, Head: 0, Tail: 2 };
	},
	GetSourceFileOffset() {
		return 0;
	},
	WriteTextFile(strFilePath, strText) {
		const strNormalizedPath = NormalizeVirtualPath(strFilePath);

		if (typeof strText !== "string") {
			throw new TypeError("Virtual file text must be a string.");
		}

		const strDirectoryPath = GetParentDirectory(strNormalizedPath);
		if (strDirectoryPath) {
			g_setVirtualDirectories.add(strDirectoryPath);
		}

		g_mapVirtualFiles.set(strNormalizedPath, strText);

		return true;
	},
	FlushSourceFile() {
		return true;
	},
	SeekSourceFile() {
		return true;
	},
	GetSourceFileSize() {
		return 0;
	},
	GetTemporaryFilePath() {
		return "temporary";
	},
	TruncateSourceFile() {
		return { BytesWritten: 0, Handle: g_hVirtualSourceFile, Size: 0 };
	},
	WriteSourceFile() {
		return 0;
	},
};

globalThis.sourcejs = {
	autodoc: g_NativeAutodoc,
	filesystem: g_NativeFilesystem,
};

try {
	const NativeOpenRecord = g_NativeFilesystem.OpenSourceFile("fixture.txt", "rt", "");
	AssertEqual(JSON.stringify(Object.keys(NativeOpenRecord).sort()), JSON.stringify(["Handle", "Mode", "Path", "PathID"]), "filesystem fixture native open record keys");
	AssertEqual(typeof NativeOpenRecord.Handle, "bigint", "filesystem fixture handle type");

	const NativeTruncationRecord = g_NativeFilesystem.TruncateSourceFile(g_hVirtualSourceFile, "fixture.txt", "rt", "", 0);
	AssertEqual(JSON.stringify(Object.keys(NativeTruncationRecord).sort()), JSON.stringify(["BytesWritten", "Handle", "Size"]), "filesystem fixture native truncation record keys");
	AssertEqual(typeof NativeTruncationRecord.Handle, "bigint", "filesystem fixture replacement handle type");
	AssertEqual(typeof NativeTruncationRecord.BytesWritten, "number", "filesystem fixture SDK byte count type");
	AssertEqual(typeof NativeTruncationRecord.Size, "number", "filesystem fixture SDK size type");

	const Autodoc = require(g_strAutodocPath);
	AssertEqual(Autodoc.MODULE_NAME, "autodoc", "MODULE_NAME");
	Assert(Autodoc.SphinxError.prototype instanceof Error, "SphinxError should extend Error");
	AssertThrows(() => new Autodoc.SphinxProject("missing/package", "docs/api"), "constructor should validate package");
	AssertEqual(JSON.stringify(Autodoc.GetModuleNames()), JSON.stringify(["autodoc"]), "GetModuleNames should use native autodoc module list");

	// Loading the package replaces the native providers with its public record adapters.
	const PublicOpenRecord = g_NativeFilesystem.OpenSourceFile("fixture.txt", "rt", "");
	AssertEqual(JSON.stringify(Object.keys(PublicOpenRecord).sort()), JSON.stringify(["FileMode", "FilePath", "Handle", "PathID"]), "filesystem package open record keys");
	AssertEqual(typeof PublicOpenRecord.Handle, "bigint", "filesystem package handle type");

	const PublicTruncationRecord = g_NativeFilesystem.TruncateSourceFile(g_hVirtualSourceFile, "fixture.txt", "rt", "", 0);
	AssertEqual(JSON.stringify(Object.keys(PublicTruncationRecord).sort()), JSON.stringify(["BytesWritten", "FileSize", "Handle"]), "filesystem package truncation record keys");
	AssertEqual(typeof PublicTruncationRecord.Handle, "bigint", "filesystem package replacement handle type");
	AssertEqual(typeof PublicTruncationRecord.BytesWritten, "number", "filesystem package SDK byte count type");
	AssertEqual(typeof PublicTruncationRecord.FileSize, "number", "filesystem package SDK size type");

	g_NativeAutodoc.ModuleNames = ["messages/implementation", "core", "commands/server", "weird<module>"];

	const Project = new Autodoc.SphinxProject(g_strPackageDirectory, g_strProjectDirectory);
	AssertEqual(Project.ProjectSourceDirectory, `${g_strProjectDirectory}/source`, "ProjectSourceDirectory");
	AssertEqual(Project.ProjectBuildDirectory, `${g_strProjectDirectory}/build`, "ProjectBuildDirectory");

	Assert(!Project.DoesProjectExist(), "DoesProjectExist before create");
	Assert(Project.DoesPackageExist(), "DoesPackageExist");
	AssertThrows(() => Project.GenerateProjectFiles(), "GenerateProjectFiles should require an existing project");

	Assert(Project.CreateProject("Ren", null, "0.3.0"), "CreateProject");
	Assert(Project.DoesProjectExist(), "DoesProjectExist after create");
	Assert(g_mapVirtualFiles.get(`${g_strProjectDirectory}/source/conf.py`).includes("author = \"Ren\""), "conf.py author");
	Assert(g_mapVirtualFiles.get(`${g_strProjectDirectory}/source/conf.py`).includes("version = \"0.3.0\""), "conf.py version");
	Assert(g_mapVirtualFiles.get(`${g_strProjectDirectory}/source/index.rst`).includes("sourcejs"), "index.rst project title");
	AssertThrows(() => Project.CreateProject("Ren"), "CreateProject should reject an existing project");

	const strFilesBeforeInvalidPaths = JSON.stringify(Array.from(g_mapVirtualFiles));
	const strDirectoriesBeforeInvalidPaths = JSON.stringify(Array.from(g_setVirtualDirectories));
	const vecInvalidSubdirectories = [null, 1, {}, [], "../outside", "nested/../../outside", "..\\outside", "/absolute", "\\absolute", "C:/absolute", "C:relative", "//server/share", "nested\0name", "nested/.. /outside", "nested/.../outside"];
	for (const InvalidSubdirectory of vecInvalidSubdirectories) {
		AssertThrows(() => Project.GenerateProjectFiles(InvalidSubdirectory), "GenerateProjectFiles should reject invalid subdirectories");
	}

	AssertEqual(JSON.stringify(Array.from(g_mapVirtualFiles)), strFilesBeforeInvalidPaths, "invalid subdirectories must not change files");
	AssertEqual(JSON.stringify(Array.from(g_setVirtualDirectories)), strDirectoriesBeforeInvalidPaths, "invalid subdirectories must not create directories");

	const vecModuleNames = Project.GenerateProjectFiles("api");
	AssertEqual(JSON.stringify(vecModuleNames), JSON.stringify(["commands/server", "core", "messages/implementation", "weird<module>"]), "GenerateProjectFiles sorted modules");
	Assert(g_mapVirtualFiles.has(`${g_strProjectDirectory}/source/api/modules.rst`), "GenerateProjectFiles should write modules.rst");
	Assert(g_mapVirtualFiles.has(`${g_strProjectDirectory}/source/api/commands.server.rst`), "GenerateProjectFiles should normalize module file names");
	Assert(g_mapVirtualFiles.get(`${g_strProjectDirectory}/source/api/messages.implementation.rst`).includes("const g_SourceModule = require(\"messages/implementation\");"), "GetModuleText runtime import should retain module scope and PascalCase role");
	Assert(g_mapVirtualFiles.get(`${g_strProjectDirectory}/source/api/weird<module>.rst`).includes("weird<module>"), "GetModuleText readable name");

	const vecImportModuleNames = [...g_NativeAutodoc.ModuleNames, "quoted\"module", "backslash\\module", "line\nbreak", "tick`module"];
	for (const strModuleName of vecImportModuleNames) {
		const strModulePage = Project.GetModuleText(strModuleName);
		const vecImportLines = strModulePage.split("\n").filter((strLine) => strLine.startsWith("   const g_SourceModule = "));
		AssertEqual(vecImportLines.length, 1, "GetModuleText must emit one module-scoped import");

		const ImportedModule = { Name: strModuleName };
		let unImportCount = 0;
		const Context = g_VM.createContext({
			require(strRequestedModuleName) {
				++unImportCount;
				AssertEqual(strRequestedModuleName, strModuleName, "generated import must preserve the exact module name");

				return ImportedModule;
			},
		});
		new g_VM.Script(vecImportLines[0].trimStart()).runInContext(Context);
		AssertEqual(new g_VM.Script("g_SourceModule").runInContext(Context), ImportedModule, "generated module binding must retain the imported object");
		AssertEqual(unImportCount, 1, "generated code must load the module only once");
	}

	const strHTMLPath = Project.BuildProject(true);
	AssertEqual(strHTMLPath, `${g_strProjectDirectory}/build/index.html`, "build path");
	Assert(g_mapVirtualFiles.get(strHTMLPath).includes("weird&lt;module&gt;"), "build should escape HTML module names");

	const QuickProject = new Autodoc.SphinxProject(g_strPackageDirectory, g_strQuickProjectDirectory);
	AssertEqual(QuickProject.RunQuickStart("Ren", "Quick API", "2"), `${g_strQuickProjectDirectory}/build/index.html`, "RunQuickStart");
	Assert(g_mapVirtualFiles.has(`${g_strQuickProjectDirectory}/source/modules.rst`), "quickstart should generate module files");
	Assert(g_mapVirtualFiles.has(`${g_strQuickProjectDirectory}/build/index.html`), "quickstart should build HTML");

	const strGeneratedNotice = "Generated by SourceJS autodoc. Do not edit; regenerate instead.";
	for (const [strFilePath, strContents] of g_mapVirtualFiles) {
		const vecLines = strContents.split("\n");
		if (strFilePath.endsWith(".html")) {
			AssertEqual(vecLines[0], "<!doctype html>", "generated HTML should retain its doctype first");
			AssertEqual(vecLines[1], `<!-- ${strGeneratedNotice} -->`, "generated HTML provenance");
		} else {
			const strCommentPrefix = strFilePath.endsWith(".py") ? "# " : ".. ";
			AssertEqual(vecLines[0], strCommentPrefix + strGeneratedNotice, "generated Python/RST provenance");
			AssertEqual(vecLines[1], "", "generated Python/RST comment must be separated from content");
		}
	}

	console.log(`Autodoc provenance verified for ${g_mapVirtualFiles.size} generated files (Python/RST/HTML; virtual filesystem).`);

	g_setVirtualDirectories.delete(g_strPackageDirectory);
	AssertThrows(() => Project.ValidatePackage(), "ValidatePackage should reject a missing package");
	AssertEqual(Object.hasOwn(Autodoc, "default"), false, "autodoc should not expose a default export");

	console.log("[smoke_autodoc] ok");
} finally {
	delete globalThis.sourcejs;
}
