"use strict";

// Compiles the actual private allocator, then checks its bytes after unloading the fixture DLL.
// This does not load SourceJS/V8 or claim execution of IVEngineServer::LightStyle.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length !== 0) && !((g_vecArguments.length === 2) && (g_vecArguments[0] === "--architecture") && ["x86", "x64"].includes(g_vecArguments[1]))) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--architecture x86|x64] [--help]\nCompiles the native allocator and checks bytes after unloading its fixture library; default architecture is x64.\nHelp must be used alone; invalid arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strArchitecture = (g_vecArguments.length === 0) ? "x64" : g_vecArguments[1];
const g_unCommandTimeoutMilliseconds = 180_000;

g_Assert((process.platform === "win32") || (process.platform === "linux"), "Unsupported fixture platform.");

const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureDirectory = g_Path.join(g_strRoot, "build", "native-engine-light-pattern-lifetime");
const g_strBuildDirectory = g_Path.join(g_strFixtureDirectory, process.platform + "-" + g_strArchitecture);

function ReadDefinition(strHeadPattern, bRecord = false) {
	const vecMatch = new RegExp("^(\\t{1,2})" + strHeadPattern + " \\{$", "m").exec(g_strSource);
	g_Assert(vecMatch, "Native allocator definition missing: " + strHeadPattern);

	const strClosing = "\n" + vecMatch[1] + (bRecord ? "};" : "}");
	const nEnd = g_strSource.indexOf(strClosing, vecMatch.index);
	g_Assert(nEnd > vecMatch.index, "Native allocator closing delimiter missing: " + strHeadPattern);

	return g_strSource.slice(vecMatch.index, nEnd + strClosing.length).split("\n").map((strLine) => strLine.startsWith(vecMatch[1]) ? "\t" + strLine.slice(vecMatch[1].length) : strLine).join("\n");
}

function WriteGeneratedFile(strName, strContent) {
	const strPath = g_Path.join(g_strFixtureDirectory, strName);
	if (g_FileSystem.existsSync(strPath) && (g_FileSystem.readFileSync(strPath, "utf8") === strContent)) {
		return;
	}

	g_FileSystem.writeFileSync(strPath, strContent);
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + " failed: " + (Result.error?.message ?? "") + "\n" + Result.stdout + Result.stderr);

	return Result.stdout;
}

const g_strHeader = [
	"#pragma once",
	"",
	"// C++",
	"#include <cstddef>",
	"",
	"// Generated-only native fixture; tools/smoke_engine_light_pattern_lifetime.js owns this file.",
	"namespace NativeLightPatternFixture {",
	"\tusing fnAllocatePattern = char const*(*)(char const* const pszPattern, const std::size_t unPatternByteCount, std::size_t* const punAllocationByteCountOut, unsigned int* const punPlatformErrorOut);",
	"} // namespace NativeLightPatternFixture",
	"",
].join("\n");

const g_strLibrary = [
	'#include "LightPatternFixture.h"',
	"",
	"// General",
	"#if defined(_WIN32)",
	"#include <Windows.h>",
	"#elif defined(__linux__)",
	"#include <sys/mman.h>",
	"#else",
	"#error Unsupported fixture platform.",
	"#endif // defined(_WIN32)",
	"",
	"// C++",
	"#include <cerrno>",
	"#include <cstring>",
	"",
	"// STL",
	"#include <limits>",
	"#include <string>",
	"#include <unordered_map>",
	"",
	"// Generated-only fixture: production record/allocator with only namespace indentation normalized.",
	"namespace {",
	ReadDefinition("struct EngineServerLightPatternAllocation", true),
	"",
	ReadDefinition("EngineServerLightPatternAllocation AllocateProcessLifetimeEngineServerLightPattern\\([^\\n]+\\)"),
	"} // namespace",
	"",
	"#if defined(_WIN32)",
	"#define SOURCEJS_LIGHT_PATTERN_FIXTURE_EXPORT __declspec(dllexport)",
	"#else",
	'#define SOURCEJS_LIGHT_PATTERN_FIXTURE_EXPORT __attribute__((visibility("default")))',
	"#endif // defined(_WIN32)",
	"",
	'extern "C" SOURCEJS_LIGHT_PATTERN_FIXTURE_EXPORT char const* AllocatePattern(char const* const pszPattern, const std::size_t unPatternByteCount, std::size_t* const punAllocationByteCountOut, unsigned int* const punPlatformErrorOut) {',
	"\tconstexpr unsigned int kPreparationFailureError = std::numeric_limits<unsigned int>::max();",
	"",
	"\tif (!pszPattern || !punAllocationByteCountOut || !punPlatformErrorOut) {",
	"\t\treturn nullptr;",
	"\t}",
	"",
	"\ttry {",
	"\t\tstd::string const strPattern = std::string(pszPattern, unPatternByteCount);",
	"\t\tEngineServerLightPatternAllocation const Allocation = AllocateProcessLifetimeEngineServerLightPattern(strPattern);",
	"\t\t*punAllocationByteCountOut = Allocation.m_unAllocationByteCount;",
	"\t\t*punPlatformErrorOut = Allocation.m_unPlatformError;",
	"",
	"\t\treturn Allocation.m_pszLightPattern;",
	"\t} catch (...) {",
	"\t\t*punAllocationByteCountOut = 0;",
	"\t\t*punPlatformErrorOut = kPreparationFailureError;",
	"\t\treturn nullptr;",
	"\t}",
	"}",
	"",
	"#undef SOURCEJS_LIGHT_PATTERN_FIXTURE_EXPORT",
	"",
].join("\n");

const g_strProbe = [
	'#include "LightPatternFixture.h"',
	"",
	"// General",
	"#if defined(_WIN32)",
	"#include <Windows.h>",
	"#elif defined(__linux__)",
	"#include <dlfcn.h>",
	"#else",
	"#error Unsupported fixture platform.",
	"#endif // defined(_WIN32)",
	"",
	"// C++",
	"#include <cstdio>",
	"#include <cstring>",
	"",
	"// STL",
	"#include <limits>",
	"",
	"// Generated-only fixture. Both binaries share this compiler/runtime and a primitive C ABI.",
	"// On a failed test the child process exits and the OS reclaims any remaining module references.",
	"#if defined(_WIN32)",
	"int wmain(const int nArgumentCount, wchar_t** const ppszArguments) {",
	"#else",
	"int main(const int nArgumentCount, char** const ppszArguments) {",
	"#endif // defined(_WIN32)",
	"\tconstexpr char kPattern[] = \"mmamammmmammamamaaamammma\";",
	"\tconstexpr char kEmbeddedPattern[] = { 'm', 0, 'z', 0 };",
	"\tconstexpr std::size_t kLargePatternCapacity = 8'193;",
	"\tconstexpr std::size_t kVariantCount = 128;",
	"\tconstexpr std::size_t kVariantCapacity = sizeof(\"m_\") + std::numeric_limits<std::size_t>::digits10 + 1;",
	"",
	"\tif (nArgumentCount != 2) {",
	'\t\tstd::fprintf(stderr, "Usage: LightPatternProbe <fixture library>\\n");',
	"\t\treturn 2;",
	"\t}",
	"",
	"#if defined(_WIN32)",
	"\t::SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);",
	"\tHMODULE const hLibrary = ::LoadLibraryW(ppszArguments[1]);",
	"#else",
	"\tvoid* const hLibrary = ::dlopen(ppszArguments[1], RTLD_NOW | RTLD_LOCAL);",
	"#endif // defined(_WIN32)",
	"\tif (!hLibrary) {",
	"#if defined(_WIN32)",
	"\t\tconst unsigned int unError = static_cast<unsigned int>(::GetLastError());",
	'\t\tstd::fprintf(stderr, "LoadFixture failed Error=0x%08X Path=\\\"%ls\\\"\\n", unError, ppszArguments[1]);',
	"#else",
	"\t\tchar const* const pszError = ::dlerror();",
	'\t\tstd::fprintf(stderr, "LoadFixture failed Details=\\\"%s\\\" Path=\\\"%s\\\"\\n", pszError ? pszError : "", ppszArguments[1]);',
	"#endif // defined(_WIN32)",
	"\t\treturn 1;",
	"\t}",
	"",
	"#if defined(_WIN32)",
	'\tNativeLightPatternFixture::fnAllocatePattern const AllocatePattern = reinterpret_cast<NativeLightPatternFixture::fnAllocatePattern>(::GetProcAddress(hLibrary, "AllocatePattern"));',
	"#else",
	'\tNativeLightPatternFixture::fnAllocatePattern const AllocatePattern = reinterpret_cast<NativeLightPatternFixture::fnAllocatePattern>(::dlsym(hLibrary, "AllocatePattern"));',
	"#endif // defined(_WIN32)",
	"\tif (!AllocatePattern) {",
	"#if defined(_WIN32)",
	"\t\tconst unsigned int unError = static_cast<unsigned int>(::GetLastError());",
	'\t\tstd::fprintf(stderr, "ResolveFixture failed Error=0x%08X\\n", unError);',
	"#else",
	"\t\tchar const* const pszError = ::dlerror();",
	'\t\tstd::fprintf(stderr, "ResolveFixture failed Details=\\\"%s\\\"\\n", pszError ? pszError : "");',
	"#endif // defined(_WIN32)",
	"\t\treturn 1;",
	"\t}",
	"",
	"\tstd::size_t unAllocationByteCount = 0;",
	"\tunsigned int unPlatformError = 0;",
	"\tchar const* const pszPattern = AllocatePattern(kPattern, sizeof(kPattern) - 1, &unAllocationByteCount, &unPlatformError);",
	"\tif (!pszPattern || (unAllocationByteCount != sizeof(kPattern)) || (unPlatformError != 0)) {",
	'\t\tstd::fprintf(stderr, "AllocatePattern failed Error=0x%08X Size=%zu\\n", unPlatformError, unAllocationByteCount);',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tchar const* const pszCachedPattern = AllocatePattern(kPattern, sizeof(kPattern) - 1, &unAllocationByteCount, &unPlatformError);",
	"\tif ((pszCachedPattern != pszPattern) || (unAllocationByteCount != sizeof(kPattern)) || (unPlatformError != 0)) {",
	'\t\tstd::fprintf(stderr, "CachePattern failed.\\n");',
	"\t\treturn 1;",
	"\t}",
	"",
	'\tchar const* const pszEmptyPattern = AllocatePattern("", 0, &unAllocationByteCount, &unPlatformError);',
	"\tif (!pszEmptyPattern || (unAllocationByteCount != 1) || (unPlatformError != 0) || (pszEmptyPattern[0] != 0)) {",
	'\t\tstd::fprintf(stderr, "EmptyPattern failed.\\n");',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tchar const* const pszEmbeddedPattern = AllocatePattern(kEmbeddedPattern, sizeof(kEmbeddedPattern) - 1, &unAllocationByteCount, &unPlatformError);",
	"\tif (!pszEmbeddedPattern || (unAllocationByteCount != sizeof(kEmbeddedPattern)) || (unPlatformError != 0) || (std::memcmp(pszEmbeddedPattern, kEmbeddedPattern, sizeof(kEmbeddedPattern)) != 0)) {",
	'\t\tstd::fprintf(stderr, "EmbeddedNULPattern failed.\\n");',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tchar szLargePattern[kLargePatternCapacity] {};",
	"\tstd::memset(szLargePattern, 'z', sizeof(szLargePattern) - 1);",
	"\tchar const* const pszLargePattern = AllocatePattern(szLargePattern, sizeof(szLargePattern) - 1, &unAllocationByteCount, &unPlatformError);",
	"\tif (!pszLargePattern || (unAllocationByteCount != sizeof(szLargePattern)) || (unPlatformError != 0)) {",
	'\t\tstd::fprintf(stderr, "LargePattern failed.\\n");',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tfor (std::size_t unVariantIndex = 0; unVariantIndex < kVariantCount; ++unVariantIndex) {",
	"\t\tchar szVariant[kVariantCapacity] {};",
	'\t\tconst int nVariantLength = std::snprintf(szVariant, sizeof(szVariant), "m_%zu", unVariantIndex);',
	"\t\tif ((nVariantLength < 0) || (static_cast<std::size_t>(nVariantLength) >= sizeof(szVariant))) {",
	'\t\t\tstd::fprintf(stderr, "FormatVariant failed.\\n");',
	"\t\t\treturn 1;",
	"\t\t}",
	"",
	"\t\tchar const* const pszVariant = AllocatePattern(szVariant, static_cast<std::size_t>(nVariantLength), &unAllocationByteCount, &unPlatformError);",
	"\t\tif (!pszVariant || (unPlatformError != 0) || (unAllocationByteCount != (static_cast<std::size_t>(nVariantLength) + 1)) || (std::strcmp(pszVariant, szVariant) != 0)) {",
	'\t\t\tstd::fprintf(stderr, "GrowCache failed.\\n");',
	"\t\t\treturn 1;",
	"\t\t}",
	"\t}",
	"",
	"#if defined(_WIN32)",
	"\tif (!::FreeLibrary(hLibrary)) {",
	"\t\tconst unsigned int unError = static_cast<unsigned int>(::GetLastError());",
	'\t\tstd::fprintf(stderr, "UnloadFixture failed Error=0x%08X\\n", unError);',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tif (::GetModuleHandleW(ppszArguments[1])) {",
	'\t\tstd::fprintf(stderr, "Fixture remains loaded.\\n");',
	"\t\treturn 1;",
	"\t}",
	"#else",
	"\tif (::dlclose(hLibrary) != 0) {",
	"\t\tchar const* const pszError = ::dlerror();",
	'\t\tstd::fprintf(stderr, "UnloadFixture failed Details=\\\"%s\\\"\\n", pszError ? pszError : "");',
	"\t\treturn 1;",
	"\t}",
	"",
	"\tvoid* const hStillLoaded = ::dlopen(ppszArguments[1], RTLD_NOW | RTLD_NOLOAD);",
	"\tif (hStillLoaded) {",
	"\t\tif (::dlclose(hStillLoaded) != 0) {",
	"\t\t\tchar const* const pszError = ::dlerror();",
	'\t\t\tstd::fprintf(stderr, "CloseFixtureReference failed Details=\\\"%s\\\"\\n", pszError ? pszError : "");',
	"\t\t\treturn 1;",
	"\t\t}",
	"",
	'\t\tstd::fprintf(stderr, "Fixture remains loaded.\\n");',
	"\t\treturn 1;",
	"\t}",
	"#endif // defined(_WIN32)",
	"",
	"\tif ((std::memcmp(pszPattern, kPattern, sizeof(kPattern)) != 0) || (pszEmptyPattern[0] != 0) || (std::memcmp(pszEmbeddedPattern, kEmbeddedPattern, sizeof(kEmbeddedPattern)) != 0) || (std::memcmp(pszLargePattern, szLargePattern, sizeof(szLargePattern)) != 0)) {",
	'\t\tstd::fprintf(stderr, "Pattern bytes changed after module unload.\\n");',
	"\t\treturn 1;",
	"\t}",
	"",
	'\tstd::puts("Native light-pattern lifetime passed: cache, empty/binary/large inputs, cache growth, actual module unload.");',
	"",
	"\treturn 0;",
	"}",
	"",
].join("\n");

const g_strCMake = [
	"cmake_minimum_required(VERSION 3.20)",
	"project(SourceJSNativeLightPatternLifetime LANGUAGES CXX)",
	"",
	"# Generated-only native fixture; the JavaScript test owns these targets.",
	"add_library(LightPatternLibrary SHARED LightPatternLibrary.cpp)",
	"add_executable(LightPatternProbe LightPatternProbe.cpp)",
	"",
	"foreach(strTargetName LightPatternLibrary LightPatternProbe)",
	"\ttarget_compile_features(${strTargetName} PRIVATE cxx_std_20)",
	"\tset_target_properties(${strTargetName} PROPERTIES CXX_EXTENSIONS OFF)",
	"\tif(MSVC)",
	"\t\ttarget_compile_options(${strTargetName} PRIVATE /W4 /WX /utf-8)",
	"\t\ttarget_compile_definitions(${strTargetName} PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)",
	"\telse()",
	"\t\ttarget_compile_options(${strTargetName} PRIVATE -Wall -Wextra -Wpedantic -Werror)",
	"\tendif()",
	"endforeach()",
	"",
	"# GNU unique symbols otherwise prevent a meaningful dlclose/unmap test.",
	'if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")',
	"\ttarget_compile_options(LightPatternLibrary PRIVATE -fno-gnu-unique)",
	"endif()",
	"",
	"target_link_libraries(LightPatternProbe PRIVATE ${CMAKE_DL_LIBS})",
	"",
].join("\n");

g_FileSystem.mkdirSync(g_strFixtureDirectory, { recursive: true });
WriteGeneratedFile("LightPatternFixture.h", g_strHeader);
WriteGeneratedFile("LightPatternLibrary.cpp", g_strLibrary);
WriteGeneratedFile("LightPatternProbe.cpp", g_strProbe);
WriteGeneratedFile("CMakeLists.txt", g_strCMake);

const g_vecConfigureArguments = ["-S", g_strFixtureDirectory, "-B", g_strBuildDirectory, "-DCMAKE_BUILD_TYPE=Release"];
if (process.platform === "win32") {
	g_vecConfigureArguments.push("-G", "Visual Studio 17 2022", "-A", (g_strArchitecture === "x86") ? "Win32" : "x64");

} else {
	g_vecConfigureArguments.push("-DCMAKE_CXX_FLAGS=" + ((g_strArchitecture === "x86") ? "-m32" : "-m64"));
}

Run("cmake", g_vecConfigureArguments);
Run("cmake", ["--build", g_strBuildDirectory, "--config", "Release", "--parallel", "2"]);

const g_strBinaryDirectory = (process.platform === "win32") ? g_Path.join(g_strBuildDirectory, "Release") : g_strBuildDirectory;
const g_strLibraryPath = g_Path.join(g_strBinaryDirectory, (process.platform === "win32") ? "LightPatternLibrary.dll" : "libLightPatternLibrary.so");
const g_strProbePath = g_Path.join(g_strBinaryDirectory, (process.platform === "win32") ? "LightPatternProbe.exe" : "LightPatternProbe");
process.stdout.write(Run(g_strProbePath, [g_strLibraryPath]));
