#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_memory_binary_lookup.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
const g_nLookupStart = g_strNativeSource.indexOf("\t\tstruct MemoryManagerBinaryInformation {");
const g_nLookupEnd = g_strNativeSource.indexOf("\t\tstd::filesystem::path GetSourceModIServerGameDataPath()", g_nLookupStart);
g_Assert.ok(g_nLookupStart >= 0);
g_Assert.ok(g_nLookupEnd > g_nLookupStart);

const g_strLookupSource = g_strNativeSource.slice(g_nLookupStart, g_nLookupEnd);

const g_vecLifetimeRegressions = [
	{ Search: "CloseHandle(hModuleSnapshot);", Replacement: "" },
	{ Search: "std::unique_ptr<void, MemoryManagerModuleSnapshotCloser> const pModuleSnapshot(hModuleSnapshot);", Replacement: "" },
	{ Search: "void* const pUserData) noexcept {", Replacement: "void* const pUserData) {" },
	{ Search: "pCollection->m_Failure = std::current_exception();", Replacement: "" },
	{ Search: "return kStopIteration;", Replacement: "return kContinueIteration;" },
	{ Search: "std::rethrow_exception(Collection.m_Failure);", Replacement: "" },
	{ Search: "unVirtualAddress > (kMaximumAddress - unModuleBaseAddress)", Replacement: "false" },
	{ Search: "unSegmentByteSize > (kMaximumAddress - unSegmentBeginAddress)", Replacement: "false" },
	{ Search: "strSource.size() >= kUTF8ByteOrderMarkByteCount", Replacement: "false" },
	{ Search: "dlclose(hDynamicLibraryHandle);", Replacement: "" },
	{ Search: "std::unique_ptr<void, MemoryManagerDynamicLibraryCloser> const pDynamicLibraryHandle(bHasModuleName ? hDynamicLibraryHandle : nullptr);", Replacement: "" },
	{ Search: "bHasModuleName ? hDynamicLibraryHandle : nullptr", Replacement: "hDynamicLibraryHandle" },
];

function AssertBinaryLookupLifetime(strSource) {
	g_Assert.match(strSource, /struct MemoryManagerModuleSnapshotCloser \{\s*void operator\(\)\(HANDLE const hModuleSnapshot\) const noexcept \{\s*CloseHandle\(hModuleSnapshot\);/);
	g_Assert.equal(strSource.split("CloseHandle(hModuleSnapshot);").length, 2);
	g_Assert.match(strSource, /if \(hModuleSnapshot == INVALID_HANDLE_VALUE\) \{\s*return vecBinaryInformations;\s*}\s*std::unique_ptr<void, MemoryManagerModuleSnapshotCloser> const pModuleSnapshot\(hModuleSnapshot\);/);

	const nCallbackStart = strSource.indexOf("\n\t\tint CollectMemoryManagerBinariesCallback(");
	const nCallbackEnd = strSource.indexOf("\n\t\t}", nCallbackStart);
	g_Assert.ok(nCallbackStart >= 0);
	g_Assert.ok(nCallbackEnd > nCallbackStart);

	const strCallback = strSource.slice(nCallbackStart, nCallbackEnd);
	g_Assert.match(strCallback, /void\* const pUserData\) noexcept \{/);
	g_Assert.match(strCallback, /if \(!pCollection \|\| !pProgramHeaderInformation\) \{\s*return kContinueIteration;\s*}/);
	g_Assert.match(strCallback, /try \{[\s\S]*pCollection->m_vecBinaryInformations\.push_back\(std::move\(BinaryInformation\)\);[\s\S]*} catch \(\.\.\.\) \{[\s\S]*pCollection->m_Failure = std::current_exception\(\);\s*return kStopIteration;/);
	g_Assert.match(strCallback, /unVirtualAddress > \(kMaximumAddress - unModuleBaseAddress\)/);
	g_Assert.match(strCallback, /unSegmentByteSize > \(kMaximumAddress - unSegmentBeginAddress\)/);
	g_Assert.match(strSource, /dl_iterate_phdr\(CollectMemoryManagerBinariesCallback, &Collection\);\s*if \(Collection\.m_Failure\) \{\s*std::rethrow_exception\(Collection\.m_Failure\);\s*}\s*return std::move\(Collection\.m_vecBinaryInformations\);/);
	g_Assert.match(strSource, /struct MemoryManagerDynamicLibraryCloser \{\s*void operator\(\)\(void\* const hDynamicLibraryHandle\) const noexcept \{\s*dlclose\(hDynamicLibraryHandle\);/);
	g_Assert.match(strSource, /std::unique_ptr<void, MemoryManagerDynamicLibraryCloser> const pDynamicLibraryHandle\(bHasModuleName \? hDynamicLibraryHandle : nullptr\);/);
	g_Assert.equal(strSource.split("dlclose(hDynamicLibraryHandle);").length, 2);

	g_Assert.match(strSource, /constexpr std::size_t kUTF8ByteOrderMarkByteCount = 3;/);
	g_Assert.match(strSource, /strSource\.size\(\) >= kUTF8ByteOrderMarkByteCount/);
	g_Assert.match(strSource, /unStartIndex = kUTF8ByteOrderMarkByteCount;/);
}

AssertBinaryLookupLifetime(g_strLookupSource);

for (const Regression of g_vecLifetimeRegressions) {
	g_Assert.equal(g_strLookupSource.split(Regression.Search).length, 2, Regression.Search);
	const strMutatedSource = g_strLookupSource.replace(Regression.Search, () => Regression.Replacement);
	g_Assert.throws(() => AssertBinaryLookupLifetime(strMutatedSource), g_Assert.AssertionError, Regression.Search);
}

console.log("[smoke] memory binary lookup lifetime/range source guards and twelve negative regressions passed; native execution is a separate check");
