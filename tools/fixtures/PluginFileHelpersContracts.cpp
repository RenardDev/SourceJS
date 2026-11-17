
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>

// STL
#include <algorithm>
#include <cctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Project
#include "PluginFileHelpers.h"

#if !defined(_M_IX86) && !defined(_M_X64) && !defined(__i386__) && !defined(__x86_64__)
#error Plugin file-helper fixture profiles require an x86 or x64 compiler target
#endif

namespace {
	std::size_t g_unFailures = 0;

	void Check(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			++g_unFailures;
			std::fprintf(stderr, "Plugin file-helper contract failed: %s\n", pszMessage);
		}
	}

	void WriteFile(std::filesystem::path const& PathFile, std::string const& strText) {
		std::ofstream OutputFile { PathFile, std::ios::binary };
		if (!OutputFile) {
			throw std::runtime_error("Could not create fixture file");
		}

		OutputFile << strText;
		OutputFile.close();

		if (!OutputFile) {
			throw std::runtime_error("Could not write fixture file");
		}
	}

	void RunFixture(std::filesystem::path const& PathRoot) {
		constexpr char kBinaryText[] = "alpha\0beta";
		constexpr char kUnchangedText[] = "unchanged";
		constexpr std::size_t kExactChunkByteCount = 4096;
		constexpr std::size_t kLargeByteCount = kExactChunkByteCount * 2 + 1;

		Check(SourceJS::IsDecimalText("00123"), "decimal selectors");
		Check(!SourceJS::IsDecimalText(""), "empty selector is not decimal");
		Check(!SourceJS::IsDecimalText("12a"), "nondecimal selector");
		Check(!SourceJS::IsDecimalText("\xFF"), "high-bit character classification");
		Check(SourceJS::IsValidPluginName("Example_1-a"), "valid plugin name");
		Check(!SourceJS::IsValidPluginName(""), "empty plugin name");
		Check(!SourceJS::IsValidPluginName("1Example"), "plugin name starts with a letter");
		Check(!SourceJS::IsValidPluginName("Example-"), "plugin name ends with an alphanumeric character");
		Check(!SourceJS::IsValidPluginName("Example/path"), "plugin name rejects path separators");

		std::vector<std::string> vecNames = { "alpha", "beta", "alpha" };
		Check(SourceJS::ContainsName(vecNames, "alpha"), "name lookup");
		Check(!SourceJS::ContainsName(vecNames, "missing"), "missing name lookup");
		SourceJS::RemoveName(vecNames, "alpha");
		std::vector<std::string> const vecExpectedNames = { "beta", "alpha" };
		Check(vecNames == vecExpectedNames, "removal erases only the first match");
		SourceJS::RemoveName(vecNames, "missing");
		Check(vecNames == vecExpectedNames, "missing removal preserves names");

		if (!vecNames.empty()) {
			SourceJS::RemoveName(vecNames, vecNames.front());
			Check((vecNames.size() == 1) && (vecNames.front() == "alpha"), "removal accepts an input borrowed from the vector");
		}

		std::vector<std::string> vecEmptyNames {};
		SourceJS::RemoveName(vecEmptyNames, "missing");
		Check(!SourceJS::ContainsName(vecEmptyNames, "missing"), "empty name collection");

		std::filesystem::path const PathEmpty = PathRoot / "Empty.txt";
		std::filesystem::path const PathBinary = PathRoot / "Binary.bin";
		std::filesystem::path const PathExactChunk = PathRoot / "ExactChunk.bin";
		std::filesystem::path const PathLarge = PathRoot / "Large.bin";
		std::filesystem::path const PathManifest = PathRoot / "Manifest.json";
		std::filesystem::path const PathMissing = PathRoot / "Missing.txt";
		std::string const strBinaryText = std::string(kBinaryText, sizeof(kBinaryText) - 1);
		std::string const strExactChunkText = std::string(kExactChunkByteCount, 'B');
		std::string strLargeText = std::string(kLargeByteCount, 'A');
		strLargeText[kExactChunkByteCount] = '\0';
		WriteFile(PathEmpty, "");
		WriteFile(PathBinary, strBinaryText);
		WriteFile(PathExactChunk, strExactChunkText);
		WriteFile(PathLarge, strLargeText);
		WriteFile(PathManifest, "{\"Name\": \"Example\", \"Enabled\": true, \"Autoload\": false}");

		std::string strText = kUnchangedText;
		Check(SourceJS::ReadTextFile(PathEmpty, strText) && strText.empty(), "empty file is a successful empty read");
		Check(SourceJS::ReadTextFile(PathBinary, strText) && (strText == strBinaryText), "binary bytes including embedded zero are preserved");
		Check(SourceJS::ReadTextFile(PathExactChunk, strText) && (strText == strExactChunkText), "exact read-chunk boundary");
		Check(SourceJS::ReadTextFile(PathLarge, strText) && (strText == strLargeText), "multiple chunks and final partial chunk preserve bytes");
		strText = kUnchangedText;
		Check(!SourceJS::ReadTextFile(PathMissing, strText) && (strText == kUnchangedText), "open failure preserves caller output");

#if defined(__linux__)
		// Linux permits opening a directory as an ifstream but rejects reading it.
		// This exercises a real kernel read failure, not a stream/test double.
		std::ifstream DirectoryInput { PathRoot, std::ios::binary };
		Check(DirectoryInput.is_open(), "directory scenario must reach a real read failure");
#endif

		strText = kUnchangedText;
		Check(!SourceJS::ReadTextFile(PathRoot, strText), "directory read must fail");
		Check(strText == kUnchangedText, "read failure preserves caller output");
		Check(SourceJS::ReadManifestString(PathManifest, "Name", "fallback") == "Example", "manifest string");
		Check(SourceJS::ReadManifestString(PathManifest, "Missing", "fallback") == "fallback", "missing string fallback");
		Check(SourceJS::ReadManifestBoolean(PathManifest, "Enabled", false), "manifest true");
		Check(!SourceJS::ReadManifestBoolean(PathManifest, "Autoload", true), "manifest false");
		Check(SourceJS::ReadManifestBoolean(PathManifest, "Missing", true), "missing boolean fallback");
		Check(SourceJS::ReadManifestBoolean(PathMissing, "Enabled", true), "unreadable manifest fallback");
	}
} // namespace

int main(const int nArgumentCount, char** const ppszArguments) {
	constexpr int kRequiredArgumentCount = 2;
	constexpr int kInvalidArgumentExitCode = 2;

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fprintf(stderr, "Usage: PluginFileHelpersContracts <fixture-directory>\n");
		return kInvalidArgumentExitCode;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		if (!std::filesystem::is_directory(PathRoot)) {
			throw std::runtime_error("Fixture directory is missing");
		}

		RunFixture(PathRoot);
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "Plugin file-helper fixture failed: %s\n", Failure.what());
		return 2;
	}

	if (g_unFailures != 0) {
		return 1;
	}

	std::puts("Plugin file-helper contracts passed; extracted implementation executed, no manager/V8/server integration exercised.");

	return 0;
}
