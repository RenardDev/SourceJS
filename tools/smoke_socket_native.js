"use strict";

const { strictEqual } = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function ReadSection(strSource, strStart, strEnd) {
	const nStart = strSource.indexOf(strStart);
	const nEnd = strSource.indexOf(strEnd, nStart + strStart.length);
	if ((nStart < 0) || (nEnd <= nStart)) {
		throw new Error(`Missing socket source section: ${strStart}`);
	}

	return strSource.slice(nStart, nEnd);
}

function Run(strExecutable, vecArguments, unTimeoutMilliseconds) {
	const Result = spawnSync(strExecutable, vecArguments, { encoding: "utf8", timeout: unTimeoutMilliseconds });
	if (Result.error) {
		throw Result.error;
	}

	strictEqual(Result.status, 0, Result.stdout + Result.stderr);
	return Result.stdout;
}

const g_strBindings = readFileSync(join(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = readFileSync(join(__dirname, "fixtures/SocketRequestContracts.cpp"), "utf8");
const g_strSocketCore = [
	ReadSection(g_strBindings, "#if defined(_WIN32)\n\t\tusing NativeSocketHandle", "\t\tstd::unordered_map<int, std::weak_ptr<SocketRequest>>& GetSocketRequests"),
	ReadSection(g_strBindings, "\t\tvoid ShutdownNativeSocket", "\t\tstd::unordered_map<int, std::shared_ptr<SocketConnectionRecord>>& GetSocketConnections"),
	ReadSection(g_strBindings, "\t\tstd::string FormatNativeSocketErrorMessage", "\t\tvoid ConnectSocketCallback"),
].join("\n");
const g_strDirectory = mkdtempSync(join(tmpdir(), "SourceJSSocketNative-"));
const g_bWindows = process.platform === "win32";
try {
	writeFileSync(join(g_strDirectory, "SocketRequestContracts.cpp"), g_strFixture.replace("@SOCKET_CORE@", () => g_strSocketCore));
	writeFileSync(join(g_strDirectory, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(SourceJSSocketRequestTest LANGUAGES CXX)",
		"find_package(Threads REQUIRED)",
		"add_executable(socket_test SocketRequestContracts.cpp)",
		"target_compile_features(socket_test PRIVATE cxx_std_20)",
		"target_link_libraries(socket_test PRIVATE Threads::Threads)",
		"if(WIN32)",
		"\ttarget_compile_definitions(socket_test PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)",
		"\ttarget_link_libraries(socket_test PRIVATE ws2_32)",
		"endif()",
		"",
	].join("\n"));
	const strBuildDirectory = join(g_strDirectory, "build");
	const vecConfiguration = g_bWindows ? ["-A", "Win32"] : [];
	Run("cmake", ["-S", g_strDirectory, "-B", strBuildDirectory, ...vecConfiguration], 60_000);
	Run("cmake", ["--build", strBuildDirectory, "--config", "Release"], 60_000);
	const strExecutable = g_bWindows ? join(strBuildDirectory, "Release/socket_test.exe") : join(strBuildDirectory, "socket_test");
	process.stdout.write(Run(strExecutable, [], 10_000));
} finally {
	rmSync(g_strDirectory, { recursive: true, force: true });
}
