"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_OS = require("node:os");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_hl2sdk_msvc_compatibility.js [--help]";
const g_unCommandTimeoutMilliseconds = 30_000;
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strTemporaryParent = g_FileSystem.realpathSync(g_OS.tmpdir());
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strTemporaryParent, "sourcejs-hl2sdk-msvc-"));
const g_strSDKRoot = g_Path.join(g_strTemporaryRoot, "sdk");
const g_strMemoryAllocationHeader = g_Path.join(g_strSDKRoot, "public/tier0/memalloc.h");
const g_strGeneratedRoot = g_Path.join(g_strTemporaryRoot, "sourcejs-hl2sdk-msvc");
const g_strTypeInformationHeader = g_Path.join(g_strGeneratedRoot, "typeinfo.h");
const g_strPreparationScript = g_Path.join(g_strTemporaryRoot, "PrepareCompatibility.cmake");
const g_strResultFile = g_Path.join(g_strTemporaryRoot, "CompatibilityResult.txt");
const g_strPackageModule = g_Path.resolve(__dirname, "../cmake/SourceJSPackage.cmake").replaceAll("\\", "/");

function PrepareCompatibility(strCompilerName, strArchitecture = "x86") {
	const vecScriptLines = [
		"# Generated only: isolated HL2SDK MSVC compatibility-generation check.",
		"cmake_minimum_required(VERSION 3.24)",
		"include(" + JSON.stringify(g_strPackageModule) + ")",
		"set(CMAKE_CXX_COMPILER_ID " + JSON.stringify(strCompilerName) + ")",
		"SourceJSPrepareHL2SDKMSVCHeaders(vecIncludeDirectories strForcedIncludePath " + JSON.stringify(g_strSDKRoot.replaceAll("\\", "/")) + " " + JSON.stringify(strArchitecture) + ")",
		"file(WRITE " + JSON.stringify(g_strResultFile.replaceAll("\\", "/")) + " \"${vecIncludeDirectories}\\n${strForcedIncludePath}\\n\")",
		"",
	];
	g_FileSystem.writeFileSync(g_strPreparationScript, vecScriptLines.join("\n"));

	const Result = g_ChildProcess.spawnSync(process.env.CMAKE_COMMAND || "cmake", ["-P", g_strPreparationScript], { cwd: g_strTemporaryRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, Result.error?.message ?? (Result.stdout + Result.stderr));

	return g_FileSystem.readFileSync(g_strResultFile, "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n");
}

try {
	g_FileSystem.mkdirSync(g_Path.dirname(g_strMemoryAllocationHeader), { recursive: true });
	g_FileSystem.writeFileSync(g_strMemoryAllocationHeader, "#include <typeinfo.h>\n");
	g_Assert.deepEqual(PrepareCompatibility("GNU"), [""]);
	g_Assert.ok(!g_FileSystem.existsSync(g_strGeneratedRoot), "Non-MSVC targets must not acquire the MSVC overlay");

	const vecLegacyResult = PrepareCompatibility("MSVC");
	g_Assert.equal(vecLegacyResult[0], g_strGeneratedRoot.replaceAll("\\", "/"));
	g_Assert.equal(g_FileSystem.readFileSync(g_strTypeInformationHeader, "utf8").replace(/\r\n/g, "\n"), "#pragma once\n\n// Generated only: selected HL2SDK MSVC type-information compatibility header.\n\n// C++\n#include <typeinfo>\n");
	g_Assert.ok(g_FileSystem.readFileSync(vecLegacyResult[1], "utf8").includes("// Generated only: selected HL2SDK MSVC pre-include compatibility header."));
	g_Assert.equal(g_FileSystem.readFileSync(g_strMemoryAllocationHeader, "utf8"), "#include <typeinfo.h>\n", "The SDK header must remain unchanged");

	const strSentinelHeader = g_Path.join(g_strGeneratedRoot, "UserSentinel.h");
	g_FileSystem.writeFileSync(strSentinelHeader, "preserve\n");
	g_FileSystem.writeFileSync(g_strMemoryAllocationHeader, "#include <typeinfo>\n");

	const vecModernResult = PrepareCompatibility("MSVC");
	g_Assert.equal(vecModernResult[0], "");
	g_Assert.ok(!g_FileSystem.existsSync(g_strTypeInformationHeader), "A changed SDK must remove only the stale compatibility header");
	g_Assert.equal(g_FileSystem.readFileSync(strSentinelHeader, "utf8"), "preserve\n");

	g_FileSystem.writeFileSync(g_strMemoryAllocationHeader, "# include   \"typeinfo.h\"\n");

	const vecOverlayFixtures = [
		{ Path: g_Path.join(g_strSDKRoot, "game/shared/collisionproperty.h"), Text: "virtual const matrix3x4_t *GetRootParentToWorldTransform() const;\n" },
		{ Path: g_Path.join(g_strSDKRoot, "public/engine/ICollideable.h"), Text: "virtual IPhysicsObject* GetVPhysicsObject() const = 0;\n" },
		{ Path: g_Path.join(g_strSDKRoot, "public/tier2/resourceprecacher.h"), Text: "#error PRECACHE_INDEX is unsupported on x64\n" },
	];
	for (const Fixture of vecOverlayFixtures) {
		g_FileSystem.mkdirSync(g_Path.dirname(Fixture.Path), { recursive: true });
		g_FileSystem.writeFileSync(Fixture.Path, Fixture.Text);
	}

	const vecQuotedResult = PrepareCompatibility("MSVC", "x64");
	g_Assert.deepEqual(vecQuotedResult[0].split(";"), [g_strGeneratedRoot.replaceAll("\\", "/"), g_Path.join(g_strGeneratedRoot, "game/shared").replaceAll("\\", "/")]);
	g_Assert.ok(g_FileSystem.existsSync(g_strTypeInformationHeader));
	g_Assert.equal(g_FileSystem.readFileSync(g_strMemoryAllocationHeader, "utf8"), "# include   \"typeinfo.h\"\n");

	const strCollisionOverlayPath = g_Path.join(g_strGeneratedRoot, "game/shared/collisionproperty.h");
	const strCollisionAliasPath = g_Path.join(g_strGeneratedRoot, "sourcejs_sdk_collisionproperty.h");
	const strResourceOverlayPath = g_Path.join(g_strGeneratedRoot, "tier2/resourceprecacher.h");
	const strCollisionOverlay = g_FileSystem.readFileSync(strCollisionOverlayPath, "utf8").replace(/\r\n/g, "\n");
	g_Assert.ok(strCollisionOverlay.startsWith("// Generated only: selected HL2SDK collision-property compatibility overlay.\n\n"));
	g_Assert.ok(strCollisionOverlay.includes("virtual IPhysicsObject* GetVPhysicsObject() const;"));
	g_Assert.equal(g_FileSystem.readFileSync(strCollisionAliasPath, "utf8").replace(/\r\n/g, "\n"), strCollisionOverlay);

	const strResourceOverlay = g_FileSystem.readFileSync(strResourceOverlayPath, "utf8").replace(/\r\n/g, "\n");
	g_Assert.ok(strResourceOverlay.startsWith("// Generated only: selected HL2SDK x64 resource-precacher compatibility overlay.\n\n"));
	g_Assert.ok(strResourceOverlay.includes('#define PRECACHE_INDEX(...) static_assert(false, "PRECACHE_INDEX is unsupported by this SDK on x64");'));
	for (const Fixture of vecOverlayFixtures) {
		g_Assert.equal(g_FileSystem.readFileSync(Fixture.Path, "utf8"), Fixture.Text, "The original SDK compatibility input must remain unchanged.");
		g_FileSystem.unlinkSync(Fixture.Path);
	}

	g_FileSystem.unlinkSync(g_strMemoryAllocationHeader);

	const vecMissingHeaderResult = PrepareCompatibility("MSVC");
	g_Assert.equal(vecMissingHeaderResult[0], "");
	g_Assert.ok(!g_FileSystem.existsSync(g_strTypeInformationHeader));
	g_Assert.ok(g_FileSystem.existsSync(vecMissingHeaderResult[1]), "The existing pre-include contract must remain available");
	for (const strOverlayPath of [strCollisionOverlayPath, strCollisionAliasPath, strResourceOverlayPath]) {
		g_Assert.ok(!g_FileSystem.existsSync(strOverlayPath), "Only the stale generated overlay must be removed.");
	}

	g_Assert.equal(g_FileSystem.readFileSync(strSentinelHeader, "utf8"), "preserve\n");
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strTemporaryParent, strRealTemporaryRoot);
	g_Assert.equal(strRealTemporaryRoot, g_strTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^sourcejs-hl2sdk-msvc-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact compatibility fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("[smoke] HL2SDK MSVC compatibility generation passed: compiler isolation, legacy spelling, generated markers, stale cleanup, quoted include, copied SDK preservation and missing header; native compilation is checked separately.");
