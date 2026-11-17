#pragma once

#ifndef _SOURCEJSMANAGERMANIFEST_H_
#define _SOURCEJSMANAGERMANIFEST_H_

// Compatibility profile (4.1): this canonical guard is the only reserved-name exception.

// C++
#include <climits>
#include <cstddef>
#include <cstdint>
#include <utility>

// STL
#include <string>

namespace SourceJS {

	namespace Detail {

		static_assert(CHAR_BIT == 8, "Manager manifest UTF8 decoding requires 8-bit bytes.");

		// Stateless selected-string codec, not document/key/raw-UTF8 validation.
		// DecodeManifestString commits only a complete quoted value; allocation may throw.
		// Callers synchronize shared strings. Unescaped bytes and suffixes are preserved/ignored respectively.
		inline bool ReadManifestHexWord(std::string const& strManifest, const std::size_t unOffset, std::uint32_t& unWordOut) {
			constexpr std::size_t kHexDigitCount = 4;
			constexpr unsigned int kHexBitsPerDigit = 4;
			constexpr std::uint32_t kAlphabeticDigitBase = 10;

			if ((unOffset > strManifest.size()) || (kHexDigitCount > (strManifest.size() - unOffset))) {
				return false;
			}

			std::uint32_t unWord = 0;
			for (std::size_t unDigitIndex = 0; unDigitIndex < kHexDigitCount; ++unDigitIndex) {
				const char chDigit = strManifest[unOffset + unDigitIndex];
				std::uint32_t unDigit = 0;
				if ((chDigit >= '0') && (chDigit <= '9')) {
					unDigit = static_cast<std::uint32_t>(chDigit - '0');

				} else if ((chDigit >= 'a') && (chDigit <= 'f')) {
					unDigit = kAlphabeticDigitBase + static_cast<std::uint32_t>(chDigit - 'a');

				} else if ((chDigit >= 'A') && (chDigit <= 'F')) {
					unDigit = kAlphabeticDigitBase + static_cast<std::uint32_t>(chDigit - 'A');

				} else {
					return false;
				}

				unWord = (unWord << kHexBitsPerDigit) | unDigit;
			}

			unWordOut = unWord;

			return true;
		}

		// The decoder supplies a validated Unicode scalar, never an isolated surrogate.
		inline void AppendManifestUTF8(std::string& strValue, const std::uint32_t unCodePoint) {
			constexpr std::uint32_t kASCIIUpperBound = 0x7F;
			constexpr std::uint32_t kTwoByteUpperBound = 0x7FF;
			constexpr std::uint32_t kThreeByteUpperBound = 0xFFFF;
			constexpr std::uint32_t kTwoBytePrefix = 0xC0;
			constexpr std::uint32_t kThreeBytePrefix = 0xE0;
			constexpr std::uint32_t kFourBytePrefix = 0xF0;
			constexpr std::uint32_t kContinuationPrefix = 0x80;
			constexpr std::uint32_t kContinuationMask = 0x3F;
			constexpr unsigned int kContinuationBits = 6;

			auto const AppendContinuation = [&strValue](const std::uint32_t unPayload) -> void {
				strValue.push_back(static_cast<char>(kContinuationPrefix | (unPayload & kContinuationMask)));
			};

			if (unCodePoint <= kASCIIUpperBound) {
				strValue.push_back(static_cast<char>(unCodePoint));
				return;
			}

			if (unCodePoint <= kTwoByteUpperBound) {
				strValue.push_back(static_cast<char>(kTwoBytePrefix | (unCodePoint >> kContinuationBits)));
				AppendContinuation(unCodePoint);
				return;
			}

			if (unCodePoint <= kThreeByteUpperBound) {
				strValue.push_back(static_cast<char>(kThreeBytePrefix | (unCodePoint >> (2 * kContinuationBits))));
				AppendContinuation(unCodePoint >> kContinuationBits);
				AppendContinuation(unCodePoint);
				return;
			}

			strValue.push_back(static_cast<char>(kFourBytePrefix | (unCodePoint >> (3 * kContinuationBits))));
			AppendContinuation(unCodePoint >> (2 * kContinuationBits));
			AppendContinuation(unCodePoint >> kContinuationBits);
			AppendContinuation(unCodePoint);
		}

		inline bool DecodeManifestString(std::string const& strManifest, const std::size_t unOpeningQuoteOffset, std::string& strValueOut) {
			constexpr unsigned char kMinimumUnescapedCharacter = 0x20;
			constexpr std::size_t kUnicodeHexDigitCount = 4;
			constexpr std::size_t kTrailingSurrogateTokenSize = 6;
			constexpr std::uint32_t kLeadingSurrogateFirst = 0xD800;
			constexpr std::uint32_t kLeadingSurrogateLast = 0xDBFF;
			constexpr std::uint32_t kTrailingSurrogateFirst = 0xDC00;
			constexpr std::uint32_t kTrailingSurrogateLast = 0xDFFF;
			constexpr std::uint32_t kSupplementaryPlaneBase = 0x10000;
			constexpr unsigned int kSurrogatePayloadBits = 10;

			if ((unOpeningQuoteOffset >= strManifest.size()) || (strManifest[unOpeningQuoteOffset] != '"')) {
				return false;
			}

			std::string strValue {};
			std::size_t unOffset = unOpeningQuoteOffset + 1;
			while (unOffset < strManifest.size()) {
				const char chCharacter = strManifest[unOffset++];
				if (chCharacter == '"') {
					strValueOut = std::move(strValue);
					return true;
				}

				if (static_cast<unsigned char>(chCharacter) < kMinimumUnescapedCharacter) {
					return false;
				}

				if (chCharacter != '\\') {
					strValue.push_back(chCharacter);
					continue;
				}

				if (unOffset == strManifest.size()) {
					return false;
				}

				const char chEscape = strManifest[unOffset++];
				switch (chEscape) {
					case '"':
					case '\\':
					case '/':
						strValue.push_back(chEscape);
						break;

					case 'b':
						strValue.push_back('\b');
						break;

					case 'f':
						strValue.push_back('\f');
						break;

					case 'n':
						strValue.push_back('\n');
						break;

					case 'r':
						strValue.push_back('\r');
						break;

					case 't':
						strValue.push_back('\t');
						break;

					case 'u': {
						std::uint32_t unCodePoint = 0;
						if (!ReadManifestHexWord(strManifest, unOffset, unCodePoint)) {
							return false;
						}

						unOffset += kUnicodeHexDigitCount;
						if ((unCodePoint >= kLeadingSurrogateFirst) && (unCodePoint <= kLeadingSurrogateLast)) {
							if ((kTrailingSurrogateTokenSize > (strManifest.size() - unOffset)) || (strManifest[unOffset] != '\\') || (strManifest[unOffset + 1] != 'u')) {
								return false;
							}

							std::uint32_t unTrailingSurrogate = 0;
							if (!ReadManifestHexWord(strManifest, unOffset + 2, unTrailingSurrogate) || (unTrailingSurrogate < kTrailingSurrogateFirst) || (unTrailingSurrogate > kTrailingSurrogateLast)) {
								return false;
							}

							unCodePoint = kSupplementaryPlaneBase + ((unCodePoint - kLeadingSurrogateFirst) << kSurrogatePayloadBits) + (unTrailingSurrogate - kTrailingSurrogateFirst);
							unOffset += kTrailingSurrogateTokenSize;

						} else if ((unCodePoint >= kTrailingSurrogateFirst) && (unCodePoint <= kTrailingSurrogateLast)) {
							return false;
						}

						AppendManifestUTF8(strValue, unCodePoint);
						break;
					}

					default:
						return false;
				}
			}

			return false;
		}

	} // namespace Detail
} // namespace SourceJS
#endif // _SOURCEJSMANAGERMANIFEST_H_
