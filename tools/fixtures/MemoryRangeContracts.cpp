
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <array>
#include <limits>
#include <type_traits>

// smoke_memory_range_contracts.js inserts the exact production helpers before compiling this fixture.
namespace SourceJS {
	// SOURCEJS_MEMORY_RANGE_HELPERS
} // namespace SourceJS

namespace {
	void RequireEqual(const bool bActual, const bool bExpected, char const* const pszScenario) {
		if (bActual != bExpected) {
			std::fprintf(stderr, "MemoryRangeContracts failed Scenario=\"%s\" Actual=%d Expected=%d\n", pszScenario, static_cast<int>(bActual), static_cast<int>(bExpected));
			std::exit(EXIT_FAILURE);
		}
	}

	template<typename TValue>
	void CheckScalarRoundTrip(TValue const& ExpectedValue) {
		constexpr std::size_t kGuardByteCount = 2;
		constexpr unsigned char kGuardByte = 0xA5;
		constexpr std::uintptr_t kMaximumAddress = std::numeric_limits<std::uintptr_t>::max();

		alignas(TValue) std::array<unsigned char, sizeof(TValue) + kGuardByteCount> arrBytes {};
		arrBytes.front() = kGuardByte;
		arrBytes.back() = kGuardByte;
		const std::uintptr_t unAddress = reinterpret_cast<std::uintptr_t>(arrBytes.data() + 1);
		SourceJS::WriteMemoryScalarToAddress(unAddress, ExpectedValue);

		TValue ReadValue {};
		RequireEqual(SourceJS::ReadMemoryScalarFromAddress(unAddress, ReadValue), true, "ScalarReadSucceeded");
		RequireEqual(ReadValue == ExpectedValue, true, "UnalignedScalarRoundTrip");
		RequireEqual((arrBytes.front() == kGuardByte) && (arrBytes.back() == kGuardByte), true, "ScalarGuardBytes");

		if constexpr (sizeof(TValue) > 1) {
			TValue FailureValue = ExpectedValue;
			RequireEqual(SourceJS::ReadMemoryScalarFromAddress(kMaximumAddress, FailureValue), false, "ScalarRangeRejectedBeforeCopy");
			RequireEqual(FailureValue == ExpectedValue, true, "ScalarFailedReadPreservesOutput");
		}
	}
} // namespace

int main(const int nArgumentCount, char**) {
	constexpr std::uintptr_t kMaximumAddress = std::numeric_limits<std::uintptr_t>::max();
	constexpr std::size_t kSingleByteCount = 1;
	constexpr std::array<std::uintptr_t, 8> kAddresses { 0, 0x01, 0x02, 0x03, kMaximumAddress / 2, kMaximumAddress - 2, kMaximumAddress - 1, kMaximumAddress };
	constexpr std::array<std::size_t, 8> kByteSizes { 0, 1, 2, 3, 4, static_cast<std::size_t>(kMaximumAddress / 2), static_cast<std::size_t>(kMaximumAddress - 1), static_cast<std::size_t>(kMaximumAddress) };

	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MemoryRangeContracts\n");
		return 2;
	}

	std::size_t unRangeCaseCount = 0;
	for (auto const& unAddress : kAddresses) {
		for (auto const& unByteSize : kByteSizes) {
			// Independent inclusive-bound oracle; short-circuit avoids the address-zero carry.
			const bool bExpected = (unByteSize > 0) && ((unAddress == 0) || (unByteSize <= (kMaximumAddress - unAddress + kSingleByteCount)));
			RequireEqual(SourceJS::IsMemoryAddressRangeRepresentable(unAddress, unByteSize), bExpected, "RepresentableRange");
			++unRangeCaseCount;
		}
	}

	std::size_t unOverlapCaseCount = 0;
	for (auto const& unFirstAddress : kAddresses) {
		for (auto const& unSecondAddress : kAddresses) {
			for (auto const& unByteSize : kByteSizes) {
				if (unByteSize == 0) {
					RequireEqual(SourceJS::DoMemoryAddressRangesOverlap(unFirstAddress, unSecondAddress, unByteSize), false, "EmptyRanges");
					++unOverlapCaseCount;
					continue;
				}

				if (!SourceJS::IsMemoryAddressRangeRepresentable(unFirstAddress, unByteSize) || !SourceJS::IsMemoryAddressRangeRepresentable(unSecondAddress, unByteSize)) {
					continue;
				}

				const std::uintptr_t unFirstLastAddress = unFirstAddress + (unByteSize - kSingleByteCount);
				const std::uintptr_t unSecondLastAddress = unSecondAddress + (unByteSize - kSingleByteCount);
				const bool bExpected = (unFirstAddress <= unSecondLastAddress) && (unSecondAddress <= unFirstLastAddress);
				RequireEqual(SourceJS::DoMemoryAddressRangesOverlap(unFirstAddress, unSecondAddress, unByteSize), bExpected, "InclusiveOverlap");
				++unOverlapCaseCount;
			}
		}
	}

	CheckScalarRoundTrip(true);
	CheckScalarRoundTrip(char(-23));
	CheckScalarRoundTrip(static_cast<unsigned char>(0xC2));
	CheckScalarRoundTrip(short(-1257));
	CheckScalarRoundTrip(static_cast<unsigned short>(0xF2F3));
	CheckScalarRoundTrip(-123456);
	CheckScalarRoundTrip(std::uint32_t(0x89ABCDEF));
	CheckScalarRoundTrip(std::numeric_limits<long>::min());
	CheckScalarRoundTrip(std::numeric_limits<unsigned long>::max());
	CheckScalarRoundTrip(std::numeric_limits<long long>::min());
	CheckScalarRoundTrip(std::numeric_limits<unsigned long long>::max());
	CheckScalarRoundTrip(1.25f);
	CheckScalarRoundTrip(-19.5);
	void* const pAddressTarget = &unRangeCaseCount;
	CheckScalarRoundTrip(pAddressTarget);
	void* pVirtualTableEntry = pAddressTarget;
	CheckScalarRoundTrip(&pVirtualTableEntry);
	char const* const pszStringTarget = "NativeMemory";
	CheckScalarRoundTrip(pszStringTarget);

	std::printf("MemoryRangeContracts PASS AddressBits=%d RangeCases=%zu OverlapCases=%zu ScalarTypes=16\n", std::numeric_limits<std::uintptr_t>::digits, unRangeCaseCount, unOverlapCaseCount);

	return EXIT_SUCCESS;
}
