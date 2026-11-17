
// C++
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

// STL
#include <limits>
#include <string>
#include <string_view>

// Template fixture: the runner inserts the production parser at its unique marker.
// Compile through tools/smoke_memory_gamedata_integer_contracts.js, not standalone.

namespace {
	// Constant table records are initialized at use; no runtime ownership or hidden defaults.
	struct IntegerCase {
		std::string_view m_strvText;
		bool m_bExpectedSuccess;
		int m_nExpectedValue;
	};

	static_assert(std::numeric_limits<int>::digits == 31, "GameData integer fixtures require a signed 32-bit int.");

	constexpr IntegerCase kIntegerCases[] = {
		{ "0", true, 0 },
		{ "-0", true, 0 },
		{ "+0", true, 0 },
		{ "73", true, 73 },
		{ "-73", true, -73 },
		{ "+73", true, 73 },
		{ " 73", true, 73 },
		{ "\t\n73", true, 73 },
		{ "010", true, 8 },
		{ "0x49", true, 73 },
		{ "-0x49", true, -73 },
		{ "2147483647", true, 2147483647 },
		{ "-2147483648", true, std::numeric_limits<int>::min() },
		{ "0x7FFFFFFF", true, std::numeric_limits<int>::max() },
		{ "-0x80000000", true, std::numeric_limits<int>::min() },
		{ "", false, 0 },
		{ " ", false, 0 },
		{ "\t\n", false, 0 },
		{ "+", false, 0 },
		{ "-", false, 0 },
		{ "value", false, 0 },
		{ "73 ", false, 0 },
		{ "73\n", false, 0 },
		{ "73x", false, 0 },
		{ "73.0", false, 0 },
		{ "73e0", false, 0 },
		{ "09", false, 0 },
		{ "0x", false, 0 },
		{ "2147483648", false, 0 },
		{ "-2147483649", false, 0 },
		{ "0x80000000", false, 0 },
		{ "-0x80000001", false, 0 },
		{ "9223372036854775807", false, 0 },
		{ "-9223372036854775808", false, 0 },
		{ "9223372036854775808", false, 0 },
		{ "-9223372036854775809", false, 0 },
		{ "999999999999999999999999999999999999", false, 0 },
		{ "-999999999999999999999999999999999999", false, 0 },
		{ std::string_view("\0", 1), false, 0 },
		{ std::string_view("\0x", 2), false, 0 },
		{ std::string_view("73\0", 3), false, 0 },
		{ std::string_view("73\0x", 4), false, 0 },
		{ std::string_view("0\0", 2), false, 0 },
		{ std::string_view("0x49\0", 5), false, 0 },
		{ std::string_view("-2147483648\0", 12), false, 0 },
	};

	// SOURCEJS_MEMORY_GAMEDATA_INTEGER_HELPER

	bool CheckIntegerCase(IntegerCase const& Case) {
		constexpr int kUnchangedValue = 137;

		std::string const strText(Case.m_strvText);
		int nParsedValue = kUnchangedValue;

		// A stale libc error must not reject a valid token; failures must leave output unchanged.
		errno = ERANGE;
		const bool bParsed = ParseMemoryManagerInt32FromString(strText, nParsedValue);
		const int nExpectedValue = Case.m_bExpectedSuccess ? Case.m_nExpectedValue : kUnchangedValue;

		return (bParsed == Case.m_bExpectedSuccess) && (nParsedValue == nExpectedValue);
	}
} // namespace

int main(const int nArgumentCount, char**) {
	constexpr std::size_t kBitsPerByte = 8;

	if (nArgumentCount != 1) {
		std::fputs("Usage: MemoryGameDataIntegerContracts\n", stderr);
		return 2;
	}

	std::size_t unCaseIndex = 0;
	for (auto const& Case : kIntegerCases) {
		if (!CheckIntegerCase(Case)) {
			std::fprintf(stderr, "MemoryGameDataIntegerContracts failed Case=%zu\n", unCaseIndex);
			return 1;
		}

		++unCaseIndex;
	}

	std::printf("MemoryGameDataIntegerContracts PASS AddressBits=%zu Cases=%zu\n", sizeof(void*) * kBitsPerByte, unCaseIndex);

	return 0;
}
