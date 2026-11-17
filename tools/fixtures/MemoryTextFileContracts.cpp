
// C++
#include <cstddef>
#include <cstdio>

// STL
#include <array>
#include <exception>
#include <filesystem>
#include <fstream>
#include <limits>
#include <string>

namespace MemoryTextFileContracts {
	// SOURCEJS_MEMORY_TEXT_FILE_HELPER

	bool CheckFailedRead(std::filesystem::path const& PathInput) {
		std::string const strSentinel = "unchanged-output";
		std::string strOutput = strSentinel;
		const bool bReadSucceeded = ReadMemoryManagerTextFile(PathInput, strOutput);

		return !bReadSucceeded && (strOutput == strSentinel);
	}
} // namespace MemoryTextFileContracts

int main(int nArgumentCount, char** ppszArguments) {
	constexpr int kRequiredArgumentCount = 2;
	constexpr int kInvalidArgumentExitCode = 2;
	constexpr std::size_t kBitsPerByte = 8;
	constexpr std::size_t kReadBlockBoundaryByteCount = 4096;
	constexpr std::size_t kMaximumTestByteCount = (kReadBlockBoundaryByteCount * 3) + 1;
	constexpr std::size_t kTestByteCounts[] = {
		0,
		1,
		kReadBlockBoundaryByteCount - 1,
		kReadBlockBoundaryByteCount,
		kReadBlockBoundaryByteCount + 1,
		kMaximumTestByteCount,
	};

	static_assert(kMaximumTestByteCount <= static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max()), "test byte count must fit in streamsize");

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fprintf(stderr, "Usage: MemoryTextFileContracts <PrivateEmptyFixtureDirectory>\nInvalid arguments exit with code %d.\n", kInvalidArgumentExitCode);
		return kInvalidArgumentExitCode;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		if (!std::filesystem::is_directory(PathRoot) || !std::filesystem::is_empty(PathRoot)) {
			std::fputs("MemoryTextFileContracts failed: fixture directory must be empty.\n", stderr);
			return 1;
		}

		std::filesystem::path const PathFile = PathRoot / "Input.bin";
		if (!MemoryTextFileContracts::CheckFailedRead({}) || !MemoryTextFileContracts::CheckFailedRead(PathFile) || !MemoryTextFileContracts::CheckFailedRead(PathRoot)) {
			std::fputs("MemoryTextFileContracts failed: failed reads committed output or reported success.\n", stderr);
			return 1;
		}

		for (auto const& unByteCount : kTestByteCounts) {
			std::string strExpected = std::string(unByteCount, 'Q');
			if (!strExpected.empty()) {
				strExpected[0] = '\0';
			}

			if (strExpected.size() > 1) {
				strExpected[strExpected.size() - 2] = '\r';
				strExpected.back() = '\n';
			}

			{
				std::ofstream OutputFileStream(PathFile, std::ios::binary | std::ios::trunc);

				OutputFileStream.write(strExpected.data(), static_cast<std::streamsize>(strExpected.size()));
				OutputFileStream.close();

				if (!OutputFileStream) {
					std::fputs("MemoryTextFileContracts failed: fixture write failed.\n", stderr);
					return 1;
				}
			}

			std::string strActual = "old-content";
			if (!MemoryTextFileContracts::ReadMemoryManagerTextFile(PathFile, strActual) || (strActual != strExpected)) {
				std::fputs("MemoryTextFileContracts failed: binary/empty/multi-block read mismatch.\n", stderr);
				return 1;
			}
		}

		std::printf("Memory text-file native checks PASS AddressBits=%zu FailedReads=3 BinaryReads=%zu\n", sizeof(void*) * kBitsPerByte, sizeof(kTestByteCounts) / sizeof(kTestByteCounts[0]));

		return 0;
	} catch (std::exception const& Error) {
		std::fprintf(stderr, "MemoryTextFileContracts failed: %s\n", Error.what());
		return 1;
	} catch (...) {
		std::fputs("MemoryTextFileContracts failed: unexpected exception.\n", stderr);
		return 1;
	}
}
