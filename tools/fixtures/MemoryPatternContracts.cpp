
// C++
#include <cstddef>
#include <cstdio>

// STL
#include <array>
#include <cctype>
#include <limits>
#include <string>
#include <string_view>
#include <vector>

namespace {
	constexpr std::size_t kMaximumExpectedByteCount = 5;

	struct PatternCase {
		std::string_view m_strvText;
		std::array<unsigned int, kMaximumExpectedByteCount> m_arrExpectedBytes;
		std::size_t m_unExpectedByteCount;
		bool m_bLooksLikePattern;
	};

	constexpr unsigned int kCharacterCount = 256;
	constexpr std::size_t kHexPairCount = static_cast<std::size_t>(kCharacterCount) * kCharacterCount;
	constexpr unsigned int kWildcard = 256;
	constexpr unsigned char kUnchangedByte = 0xC7;
	constexpr char kHexDigits[] = "0123456789ABCDEF";
	constexpr std::size_t kHexDigitCount = 16;
	constexpr int kHexLetterValue = 10;
	constexpr int kNibbleShift = 4;
	constexpr std::size_t kPairCharacterCount = 2;
	constexpr std::size_t kByteBitCount = 8;

	constexpr PatternCase kPatternCases[] = {
		{ "", {}, 0, false },
		{ " ", {}, 0, false },
		{ ",,", {}, 0, false },
		{ "AA", { 0xAA }, 1, false },
		{ "aA", { 0xAA }, 1, false },
		{ "00FF", { 0, 0xFF }, 2, false },
		{ "AA BB", { 0xAA, 0xBB }, 2, true },
		{ "AA,BB", { 0xAA, 0xBB }, 2, true },
		{ "\t00\r\nFF\v\f", { 0, 0xFF }, 2, true },
		{ " ,00,,FF, ", { 0, 0xFF }, 2, true },
		{ "0xAB", { 0xAB }, 1, false },
		{ "0Xab0xCD", { 0xAB, 0xCD }, 2, false },
		{ "\\xAB\\Xcd", { 0xAB, 0xCD }, 2, true },
		{ "?", { kWildcard }, 1, true },
		{ "*", { kWildcard }, 1, true },
		{ "??**?", { kWildcard }, 1, true },
		{ "? * ??", { kWildcard, kWildcard, kWildcard }, 3, true },
		{ "AA??BB*CC", { 0xAA, kWildcard, 0xBB, kWildcard, 0xCC }, 5, true },
		{ "AA??BB*", { 0xAA, kWildcard, 0xBB, kWildcard }, 4, true },
		{ "\\x??", { kWildcard }, 1, true },
		{ "\\X?*\\x**", { kWildcard, kWildcard }, 2, true },
		{ "0x??", {}, 0, true },
		{ "A", {}, 0, false },
		{ "ABC", {}, 0, false },
		{ "AA B", {}, 0, false },
		{ "AA,GG", {}, 0, false },
		{ "GG?", {}, 0, true },
		{ "\\x", {}, 0, true },
		{ "\\xA", {}, 0, true },
		{ "\\xA?", {}, 0, true },
		{ "0x", {}, 0, false },
		{ "0xA", {}, 0, false },
		{ "0xABCD", { 0xAB, 0xCD }, 2, false },
		{ "server_symbol", {}, 0, false },
		{ "symbol\\x00", {}, 0, true },
		{ std::string_view("AA\0BB", 5), {}, 0, false },
		{ std::string_view("\0", 1), {}, 0, false },
		{ std::string_view("\x80", 1), {}, 0, false },
	};

	static_assert(std::numeric_limits<unsigned char>::digits == kByteBitCount);

	// SOURCEJS_MEMORY_PATTERN_HELPERS

	int GetExpectedHexDigit(const unsigned int unCharacterValue) noexcept {
		if ((unCharacterValue >= '0') && (unCharacterValue <= '9')) {
			return static_cast<int>(unCharacterValue - '0');
		}

		if ((unCharacterValue >= 'a') && (unCharacterValue <= 'f')) {
			return kHexLetterValue + static_cast<int>(unCharacterValue - 'a');
		}

		if ((unCharacterValue >= 'A') && (unCharacterValue <= 'F')) {
			return kHexLetterValue + static_cast<int>(unCharacterValue - 'A');
		}

		return -1;
	}

	bool CheckHexDigits(void) {
		for (unsigned int unCharacterValue = 0; unCharacterValue < kCharacterCount; ++unCharacterValue) {
			if (DecodeMemoryManagerHexDigit(static_cast<char>(unCharacterValue)) != GetExpectedHexDigit(unCharacterValue)) {
				return false;
			}
		}

		return true;
	}

	bool CheckHexPairs(void) {
		constexpr std::size_t kInvalidOffsets[] = { 1, 2, 3, std::numeric_limits<std::size_t>::max() };

		std::string strPair(kPairCharacterCount, '\0');
		for (unsigned int unHighCharacter = 0; unHighCharacter < kCharacterCount; ++unHighCharacter) {
			for (unsigned int unLowCharacter = 0; unLowCharacter < kCharacterCount; ++unLowCharacter) {
				strPair[0] = static_cast<char>(unHighCharacter);
				strPair[1] = static_cast<char>(unLowCharacter);
				const int nHighDigit = GetExpectedHexDigit(unHighCharacter);
				const int nLowDigit = GetExpectedHexDigit(unLowCharacter);
				const bool bExpectedSuccess = (nHighDigit >= 0) && (nLowDigit >= 0);
				unsigned char unByte = kUnchangedByte;
				const bool bSuccess = ParseMemoryManagerHexByte(strPair, 0, unByte);
				const unsigned char unExpectedByte = bExpectedSuccess ? static_cast<unsigned char>((nHighDigit << kNibbleShift) | nLowDigit) : kUnchangedByte;
				if ((bSuccess != bExpectedSuccess) || (unByte != unExpectedByte)) {
					return false;
				}
			}
		}

		strPair = "A1";
		for (auto const& unOffset : kInvalidOffsets) {
			unsigned char unByte = kUnchangedByte;
			if (ParseMemoryManagerHexByte(strPair, unOffset, unByte) || (unByte != kUnchangedByte)) {
				return false;
			}
		}

		unsigned char unByte = kUnchangedByte;
		if (!ParseMemoryManagerHexByte("ZA1Q", 1, unByte) || (unByte != 0xA1)) {
			return false;
		}

		return true;
	}

	bool CheckPatterns(void) {
		for (auto const& Case : kPatternCases) {
			std::string const strPattern = std::string(Case.m_strvText);
			MemoryManagerPatternByte const InitialByte = { kUnchangedByte, true };
			std::vector<MemoryManagerPatternByte> vecBytes { InitialByte };
			const bool bExpectedSuccess = Case.m_unExpectedByteCount != 0;
			const bool bSuccess = ParseMemoryManagerBytePattern(strPattern, vecBytes);
			if ((bSuccess != bExpectedSuccess) || (DoesMemoryManagerTextLookLikeBytePattern(strPattern) != Case.m_bLooksLikePattern)) {
				return false;
			}

			if (!bSuccess) {
				if ((vecBytes.size() != 1) || (vecBytes[0].m_unByteValue != kUnchangedByte) || !vecBytes[0].m_bWildcard) {
					return false;
				}

				continue;
			}

			if (vecBytes.size() != Case.m_unExpectedByteCount) {
				return false;
			}

			for (std::size_t unByteIndex = 0; unByteIndex < Case.m_unExpectedByteCount; ++unByteIndex) {
				const unsigned int unExpectedValue = Case.m_arrExpectedBytes[unByteIndex];
				const bool bWildcard = unExpectedValue == kWildcard;
				const unsigned char unExpectedByte = bWildcard ? 0 : static_cast<unsigned char>(unExpectedValue);
				if ((vecBytes[unByteIndex].m_bWildcard != bWildcard) || (vecBytes[unByteIndex].m_unByteValue != unExpectedByte)) {
					return false;
				}
			}
		}

		for (unsigned int unByteValue = 0; unByteValue < kCharacterCount; ++unByteValue) {
			std::string strPattern(kPairCharacterCount, '\0');
			strPattern[0] = kHexDigits[unByteValue / kHexDigitCount];
			strPattern[1] = kHexDigits[unByteValue % kHexDigitCount];
			std::vector<MemoryManagerPatternByte> vecBytes {};
			if (!ParseMemoryManagerBytePattern(strPattern, vecBytes) || (vecBytes.size() != 1) || (vecBytes[0].m_unByteValue != unByteValue) || vecBytes[0].m_bWildcard) {
				return false;
			}
		}

		return true;
	}
} // namespace

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MemoryPatternContracts\n");
		return 2;
	}

	if (!CheckHexDigits() || !CheckHexPairs() || !CheckPatterns()) {
		std::fprintf(stderr, "MemoryPatternContracts failed\n");
		return 1;
	}

	std::printf("MemoryPatternContracts PASS AddressBits=%zu HexPairs=%zu PatternCases=%zu\n", sizeof(void*) * kByteBitCount, kHexPairCount, sizeof(kPatternCases) / sizeof(kPatternCases[0]));

	return 0;
}
