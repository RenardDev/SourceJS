
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <utility>

// STL
#include <filesystem>
#include <fstream>
#include <string>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// The generated method is the actual runtime implementation; no filesystem doubles.
namespace SourceJS {
	class V8Runtime {
	public:
		bool ReadFile(std::filesystem::path const& PathScript, std::string& strSourceOut);
	};
} // namespace SourceJS

// Project
#include "V8RuntimeReadFileMethods.h"

namespace {
	void Check(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			std::fprintf(stderr, "Check failed: %s\n", pszMessage);
			std::abort();
		}
	}

	void WriteFixture(std::filesystem::path const& PathFile, std::string const& strText) {
		Check(std::in_range<std::streamsize>(strText.size()), "fixture size must fit the file stream");

		std::ofstream OutputFile { PathFile, std::ios::binary };
		Check(OutputFile.is_open(), "fixture file must open");

		OutputFile.write(strText.data(), static_cast<std::streamsize>(strText.size()));
		OutputFile.close();
		Check(!OutputFile.fail(), "fixture file must be written completely");
	}
} // namespace

int main(const int nArgumentCount, char** const ppszArguments) {
	constexpr int kArgumentCount = 2;
	constexpr char kBinaryFixture[] = "A\0B\r\n";
	constexpr char kPreviousSource[] = "Previous source.";
	constexpr std::size_t kLargeFixtureByteCount = 10'000;

	if (nArgumentCount != kArgumentCount) {
		std::fputs("Usage: V8RuntimeReadFileContracts <FixtureDirectory>\n", stderr);
		return 2;
	}

	std::filesystem::path const PathRoot = ppszArguments[1];
	std::filesystem::path const PathBinary = PathRoot / "RuntimeReadFileBinary.dat";
	std::filesystem::path const PathEmpty = PathRoot / "RuntimeReadFileEmpty.dat";
	std::filesystem::path const PathLarge = PathRoot / "RuntimeReadFileLarge.dat";
	std::string const strBinary = std::string(kBinaryFixture, sizeof(kBinaryFixture) - 1);
	std::string const strLarge = std::string(kLargeFixtureByteCount, 'x');
	WriteFixture(PathBinary, strBinary);
	WriteFixture(PathEmpty, "");
	WriteFixture(PathLarge, strLarge);

	SourceJS::V8Runtime Runtime {};
	std::string strSource = kPreviousSource;
	Check(Runtime.ReadFile(PathBinary, strSource) && (strSource == strBinary), "binary reads preserve embedded NUL and line endings");
	Check(Runtime.ReadFile(PathEmpty, strSource) && strSource.empty(), "empty scripts remain valid");
	Check(Runtime.ReadFile(PathLarge, strSource) && (strSource == strLarge), "reads spanning multiple buffers preserve every byte");

	Check(!Runtime.ReadFile(PathRoot, strSource), "directory read must fail rather than succeed as an empty script");
	Check(strSource == strLarge, "failed directory read preserves prior source");

	strSource = kPreviousSource;
	Check(!Runtime.ReadFile({}, strSource) && (strSource == kPreviousSource), "invalid path preserves output");
	Check(!Runtime.ReadFile(PathRoot / "MissingRuntimeReadFile.dat", strSource) && (strSource == kPreviousSource), "missing file preserves output");

	std::puts("V8 runtime read-file contracts passed");

	return 0;
}
