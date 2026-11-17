
// C++
#include <cstdio>

// STL
#include <filesystem>
#include <string_view>

// Project
#include "sourcejs/Log.h"
#include "sourcejs/SourceModGameData.h"

namespace {

	int g_nRefreshSuccesses = 0;
	int g_nRefreshWarnings = 0;
} // namespace

namespace SourceJS {

	void LogInfo(char const* const pszMessage, ...) noexcept {
		std::puts(pszMessage);
		++g_nRefreshSuccesses;
	}

	void LogWarning(char const* const pszMessage, ...) noexcept {
		std::puts(pszMessage);
		++g_nRefreshWarnings;
	}
} // namespace SourceJS

int main(const int nArgumentCount, char** const ppszArguments) {
	if (nArgumentCount != 3) {
		return 2;
	}

	std::filesystem::path const PathRoot = ppszArguments[1];
	std::string_view const strvMode = ppszArguments[2];
	if ((strvMode != "download") && (strvMode != "offline")) {
		return 2;
	}

	const bool bExpectDownload = strvMode == "download";
	std::filesystem::path const PathPrevious = SourceJS::GetSourceModGameDataRoot(PathRoot);
	if (!bExpectDownload && PathPrevious.empty()) {
		return 3;
	}

	SourceJS::RefreshSourceModGameData(PathRoot);
	if ((g_nRefreshSuccesses != (bExpectDownload ? 1 : 0)) || (g_nRefreshWarnings != (bExpectDownload ? 0 : 1))) {
		return 4;
	}

	std::filesystem::path const PathSnapshot = SourceJS::GetSourceModGameDataRoot(PathRoot);
	if (PathSnapshot.empty() || (!bExpectDownload && (PathSnapshot != PathPrevious)) || !std::filesystem::is_regular_file(PathSnapshot / "sdktools.games" / "master.games.txt") || !std::filesystem::is_regular_file(PathSnapshot / "sdkhooks.games" / "master.games.txt")) {
		return 5;
	}

	return 0;
}
