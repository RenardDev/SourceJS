#include "NetChannelBitBufferStorage.h"

// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>

// STL
#include <algorithm>
#include <exception>
#include <vector>

namespace {
	bool CheckStorageSize(const std::size_t unByteCount) {
		constexpr std::size_t kWordByteCount = sizeof(std::uint32_t);
		constexpr std::size_t kMinimumWordCount = 1;
		constexpr int kUncommittedStorageByteCount = -1;
		constexpr char kInputByte = 0x5A;
		constexpr char kReplacementByte = 0x27;

		std::vector<char> const vecInput(unByteCount, kInputByte);
		std::vector<std::uint32_t> vecWords {};
		int nStorageByteCount = kUncommittedStorageByteCount;
		if (!SourceJSBitBufferStorage::PrepareNetChannelBitBufferStorage(vecInput, vecWords, nStorageByteCount)) {
			std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=Prepare Size=%zu\n", unByteCount);
			return false;
		}

		const std::size_t unExpectedWordCount = (unByteCount + (kWordByteCount - 1)) / kWordByteCount;
		const std::size_t unExpectedAllocationWordCount = std::max(unExpectedWordCount, kMinimumWordCount);
		const std::uintptr_t unStorageAddress = reinterpret_cast<std::uintptr_t>(vecWords.data());
		if ((vecWords.size() != unExpectedAllocationWordCount) || (nStorageByteCount != static_cast<int>(unExpectedWordCount * kWordByteCount)) || ((unStorageAddress % alignof(std::uint32_t)) != 0)) {
			std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=AlignmentOrCapacity Size=%zu\n", unByteCount);
			return false;
		}

		char const* const pchBytes = reinterpret_cast<char const*>(vecWords.data());
		for (std::size_t unByteIndex = 0; unByteIndex < (vecWords.size() * kWordByteCount); ++unByteIndex) {
			const char chExpected = (unByteIndex < unByteCount) ? kInputByte : 0;
			if (pchBytes[unByteIndex] != chExpected) {
				std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=CopyOrPadding Size=%zu Index=%zu\n", unByteCount, unByteIndex);
				return false;
			}
		}

		if (!vecInput.empty()) {
			char* const pchWritableBytes = reinterpret_cast<char*>(vecWords.data());
			pchWritableBytes[0] = kReplacementByte;
			if (vecInput[0] != kInputByte) {
				std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=InputOwnership Size=%zu\n", unByteCount);
				return false;
			}

			std::vector<char> const vecReturnedBytes(pchBytes, pchBytes + vecInput.size());
			if ((vecReturnedBytes.size() != unByteCount) || (vecReturnedBytes[0] != kReplacementByte)) {
				std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=LogicalReturnCapacity Size=%zu\n", unByteCount);
				return false;
			}
		}

		return true;
	}
} // namespace

int main(const int nArgumentCount, char**) {
	constexpr std::size_t kMaximumTestByteCount = 65;
	constexpr int kSuccessExitCode = 0;
	constexpr int kFailureExitCode = 1;

	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: NetChannelBitBufferStorage\n");
		return 2;
	}

	try {
		for (std::size_t unByteCount = 0; unByteCount <= kMaximumTestByteCount; ++unByteCount) {
			if (!CheckStorageSize(unByteCount)) {
				return kFailureExitCode;
			}
		}

		std::printf("NetChannelBitBufferStorage native storage PASS SizeRange=0..%zu; SDK/V8/game-engine execution not exercised.\n", kMaximumTestByteCount);

		return kSuccessExitCode;
	} catch (std::exception const&) {
		std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=NativeException\n");
		return kFailureExitCode;
	} catch (...) {
		std::fprintf(stderr, "NetChannelBitBufferStorage failed Scenario=UnknownNativeException\n");
		return kFailureExitCode;
	}
}
