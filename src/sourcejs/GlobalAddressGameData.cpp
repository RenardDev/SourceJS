#include "sourcejs/GlobalAddressGameData.h"

// General
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_GLOBALADDRESSGAMEDATA_DEFINED_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_GLOBALADDRESSGAMEDATA_DEFINED_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_GLOBALADDRESSGAMEDATA_DEFINED_NOMINMAX
#endif
#elif defined(__linux__)
#include <sys/uio.h>
#include <unistd.h>
#endif

// C++
#include <cstdint>
#include <utility>

// STL
#include <algorithm>
#include <cctype>
#include <charconv>
#include <fstream>
#include <limits>
#include <map>
#include <string_view>
#include <type_traits>
#include <vector>

// ================================================================
// Global address GameData helpers
// ================================================================

namespace SourceJS {

	namespace {

		struct GlobalAddressGameDataRange {
			std::uintptr_t m_unBeginAddress;
			std::uintptr_t m_unEndAddress;
		};

		constexpr std::size_t kMaximumGlobalAddressGameDataDereferenceCount = 64;
		constexpr unsigned char kWildcardByte = 0x2A;

		std::string_view TrimGlobalAddressGameDataText(std::string_view strvText) noexcept {
			while (!strvText.empty() && std::isspace(static_cast<unsigned char>(strvText.front()))) {
				strvText.remove_prefix(1);
			}

			while (!strvText.empty() && std::isspace(static_cast<unsigned char>(strvText.back()))) {
				strvText.remove_suffix(1);
			}

			return strvText;
		}

		bool ParseGlobalAddressGameDataInteger(std::string_view strvText, std::int64_t& nValueOut) noexcept {
			constexpr std::uint64_t kMaximumPositiveValue = std::numeric_limits<std::int64_t>::max();
			constexpr std::uint64_t kMaximumNegativeMagnitude = kMaximumPositiveValue + 1;
			constexpr int kDecimalBase = 10;
			constexpr int kHexadecimalBase = 16;
			constexpr std::size_t kRadixPrefixCharacterCount = 2;

			strvText = TrimGlobalAddressGameDataText(strvText);
			const bool bNegative = !strvText.empty() && (strvText.front() == '-');
			if (bNegative || (!strvText.empty() && (strvText.front() == '+'))) {
				strvText.remove_prefix(1);
			}

			const bool bHexadecimal = strvText.starts_with("0x") || strvText.starts_with("0X");
			if (bHexadecimal) {
				strvText.remove_prefix(kRadixPrefixCharacterCount);
			}

			if (strvText.empty()) {
				return false;
			}

			std::uint64_t unMagnitude = 0;
			std::from_chars_result const Conversion = std::from_chars(strvText.data(), strvText.data() + strvText.size(), unMagnitude, bHexadecimal ? kHexadecimalBase : kDecimalBase);
			if ((Conversion.ec != std::errc {}) || (Conversion.ptr != (strvText.data() + strvText.size())) || (unMagnitude > (bNegative ? kMaximumNegativeMagnitude : kMaximumPositiveValue))) {
				return false;
			}

			const std::int64_t nValue = (bNegative && (unMagnitude == kMaximumNegativeMagnitude)) ? std::numeric_limits<std::int64_t>::min() : (bNegative ? -static_cast<std::int64_t>(unMagnitude) : static_cast<std::int64_t>(unMagnitude));
			nValueOut = nValue;

			return true;
		}

		bool ReadGlobalAddressGameDataSection(std::istream& InputStream, std::string const& strSectionName, std::map<std::string, std::string>& mapValuesOut) {
			constexpr std::size_t kQuotedDelimiterCharacterCount = 2;

			bool bSelected = false;
			bool bFound = false;
			std::map<std::string, std::string> mapValues {};
			std::string strLine {};
			while (std::getline(InputStream, strLine)) {
				if (strLine.find('\0') != std::string::npos) {
					return false;
				}

				bool bQuoted = false;
				bool bEscaped = false;
				std::size_t unCommentOffset = strLine.size();
				for (std::size_t unCharacterIndex = 0; unCharacterIndex < strLine.size(); ++unCharacterIndex) {
					const char chCharacter = strLine[unCharacterIndex];
					if ((chCharacter == '"') && !bEscaped) {
						bQuoted = !bQuoted;
					}

					if ((chCharacter == '#') && !bQuoted) {
						unCommentOffset = unCharacterIndex;
						break;
					}

					bEscaped = (chCharacter == '\\') ? !bEscaped : false;
				}

				std::string_view const strvLine = TrimGlobalAddressGameDataText(std::string_view(strLine).substr(0, unCommentOffset));
				if (strvLine.empty()) {
					continue;
				}

				if (strvLine.front() == '[') {
					bSelected = strvLine == ("[" + strSectionName + "]");
					if (bSelected && bFound) {
						return false;
					}

					bFound = bFound || bSelected;
					continue;
				}

				if (!bSelected) {
					continue;
				}

				const std::size_t unAssignmentOffset = strvLine.find('=');
				if (bQuoted || (unAssignmentOffset == std::string_view::npos)) {
					return false;
				}

				std::string const strKey = std::string(TrimGlobalAddressGameDataText(strvLine.substr(0, unAssignmentOffset)));
				std::string_view strvValue = TrimGlobalAddressGameDataText(strvLine.substr(unAssignmentOffset + 1));
				if ((strvValue.size() >= kQuotedDelimiterCharacterCount) && (strvValue.front() == '"') && (strvValue.back() == '"')) {
					strvValue = strvValue.substr(1, strvValue.size() - kQuotedDelimiterCharacterCount);
				}

				if (strKey.empty() || !mapValues.emplace(strKey, strvValue).second) {
					return false;
				}
			}

			if (!bFound || InputStream.bad() || (InputStream.fail() && !InputStream.eof())) {
				return false;
			}

			mapValuesOut = std::move(mapValues);

			return true;
		}

		std::string const* SelectGlobalAddressGameDataValue(std::map<std::string, std::string> const& mapValues, std::string const& strKey, std::string const& strPlatform, const bool bIs64Bit) {
			std::string const arrKeys[] = { strKey + "_" + strPlatform + (bIs64Bit ? "64" : ""), strKey + "_" + strPlatform, strKey };
			for (auto const& strCandidateKey : arrKeys) {
				auto const itValue = mapValues.find(strCandidateKey);
				if (itValue != mapValues.end()) {
					return &itValue->second;
				}
			}

			return nullptr;
		}

		bool IsGlobalAddressGameDataPattern(std::string const& strIdentifier) noexcept {
			if (strIdentifier.empty() || (strIdentifier.front() == '@')) {
				return false;
			}

			for (auto const& chCharacter : strIdentifier) {
				const unsigned char chUnsignedCharacter = static_cast<unsigned char>(chCharacter);
				if (!std::isxdigit(chUnsignedCharacter) && !std::isspace(chUnsignedCharacter) && (chCharacter != '?') && (chCharacter != '*') && (chCharacter != '\\') && (chCharacter != 'x') && (chCharacter != 'X')) {
					return false;
				}
			}

			return true;
		}

		bool ParseGlobalAddressGameDataPattern(std::string_view strvPattern, std::vector<unsigned char>& vecBytesOut) {
			constexpr std::size_t kMaximumPatternByteCount = 65536;
			constexpr int kHexadecimalBase = 16;
			constexpr std::size_t kByteCharacterCount = 2;

			std::vector<unsigned char> vecBytes {};
			bool bHasConcreteByte = false;
			while (!(strvPattern = TrimGlobalAddressGameDataText(strvPattern)).empty()) {
				if (vecBytes.size() >= kMaximumPatternByteCount) {
					return false;
				}

				if ((strvPattern.front() == '?') || (strvPattern.front() == '*')) {
					const char chWildcard = strvPattern.front();
					strvPattern.remove_prefix(1);
					if (!strvPattern.empty() && (strvPattern.front() == chWildcard)) {
						strvPattern.remove_prefix(1);
					}

					vecBytes.push_back(kWildcardByte);
					continue;
				}

				if (strvPattern.starts_with("\\x") || strvPattern.starts_with("0x") || strvPattern.starts_with("0X")) {
					strvPattern.remove_prefix(kByteCharacterCount);
				}

				if (strvPattern.size() < kByteCharacterCount) {
					return false;
				}

				unsigned int unByte = 0;
				std::from_chars_result const Conversion = std::from_chars(strvPattern.data(), strvPattern.data() + kByteCharacterCount, unByte, kHexadecimalBase);
				if ((Conversion.ec != std::errc {}) || (Conversion.ptr != (strvPattern.data() + kByteCharacterCount))) {
					return false;
				}

				vecBytes.push_back(static_cast<unsigned char>(unByte));
				bHasConcreteByte = bHasConcreteByte || (unByte != kWildcardByte);
				strvPattern.remove_prefix(kByteCharacterCount);
			}

			if (!bHasConcreteByte) {
				return false;
			}

			vecBytesOut = std::move(vecBytes);

			return true;
		}

		// Failed OS reads may partially fill this scratch buffer; callers discard it.
		bool ReadGlobalAddressGameDataMemory(const std::uintptr_t unAddress, void* const pBufferOut, const std::size_t unByteCount) noexcept {
			if ((unAddress == 0) || !pBufferOut || (unByteCount == 0) || (unByteCount > (std::numeric_limits<std::uintptr_t>::max() - unAddress))) {
				return false;
			}

#if defined(_WIN32)
			SIZE_T unReadByteCount = 0;
			const BOOL nReadResult = ReadProcessMemory(GetCurrentProcess(), reinterpret_cast<void const*>(unAddress), pBufferOut, unByteCount, &unReadByteCount);

			return (nReadResult != FALSE) && (unReadByteCount == unByteCount);
#elif defined(__linux__)
			iovec LocalBuffer { pBufferOut, unByteCount };
			iovec RemoteBuffer { reinterpret_cast<void*>(unAddress), unByteCount };
			const ssize_t nReadByteCount = process_vm_readv(getpid(), &LocalBuffer, 1, &RemoteBuffer, 1, 0);

			return (nReadByteCount >= 0) && (static_cast<std::size_t>(nReadByteCount) == unByteCount);
#else
			// Native scanning is supported only on the project's Windows/Linux targets.
			return false;
#endif
		}

		void AddGlobalAddressGameDataRange(std::vector<GlobalAddressGameDataRange>& vecRanges, const std::uintptr_t unBeginAddress, const std::uintptr_t unEndAddress, const std::uintptr_t unModuleBeginAddress, const std::uintptr_t unModuleEndAddress) {
			const std::uintptr_t unClippedBeginAddress = std::max(unBeginAddress, unModuleBeginAddress);
			const std::uintptr_t unClippedEndAddress = std::min(unEndAddress, unModuleEndAddress);
			if (unClippedBeginAddress >= unClippedEndAddress) {
				return;
			}

			if (!vecRanges.empty() && (vecRanges.back().m_unEndAddress == unClippedBeginAddress)) {
				vecRanges.back().m_unEndAddress = unClippedEndAddress;
				return;
			}

			vecRanges.push_back({ unClippedBeginAddress, unClippedEndAddress });
		}

		std::vector<GlobalAddressGameDataRange> CollectGlobalAddressGameDataRanges(const std::uintptr_t unModuleBeginAddress, const std::uintptr_t unModuleEndAddress) {
#if defined(_WIN32)
			constexpr DWORD kReadableProtectionFlags = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
#elif defined(__linux__)
			constexpr int kHexadecimalBase = 16;
#endif

			std::vector<GlobalAddressGameDataRange> vecRanges {};

#if defined(_WIN32)
			std::uintptr_t unCurrentAddress = unModuleBeginAddress;
			while (unCurrentAddress < unModuleEndAddress) {
				MEMORY_BASIC_INFORMATION MemoryInformation {};
				if (VirtualQuery(reinterpret_cast<void const*>(unCurrentAddress), &MemoryInformation, sizeof(MemoryInformation)) != sizeof(MemoryInformation)) {
					return {};
				}

				const std::uintptr_t unRegionBeginAddress = reinterpret_cast<std::uintptr_t>(MemoryInformation.BaseAddress);
				if ((unRegionBeginAddress > unCurrentAddress) || (MemoryInformation.RegionSize > (std::numeric_limits<std::uintptr_t>::max() - unRegionBeginAddress))) {
					return {};
				}

				const std::uintptr_t unRegionEndAddress = unRegionBeginAddress + MemoryInformation.RegionSize;
				if (unRegionEndAddress <= unCurrentAddress) {
					return {};
				}

				if ((MemoryInformation.State == MEM_COMMIT) && ((MemoryInformation.Protect & PAGE_GUARD) == 0) && ((MemoryInformation.Protect & kReadableProtectionFlags) != 0)) {
					AddGlobalAddressGameDataRange(vecRanges, unRegionBeginAddress, unRegionEndAddress, unModuleBeginAddress, unModuleEndAddress);
				}

				unCurrentAddress = unRegionEndAddress;
			}
#elif defined(__linux__)
			std::string strLine {};

			std::ifstream InputStream("/proc/self/maps");
			if (!InputStream) {
				return {};
			}

			while (std::getline(InputStream, strLine)) {
				const std::size_t unSeparatorOffset = strLine.find('-');
				const std::size_t unPermissionsOffset = strLine.find(' ');
				if ((unSeparatorOffset == std::string::npos) || (unPermissionsOffset == std::string::npos) || (unSeparatorOffset >= unPermissionsOffset) || ((unPermissionsOffset + 1) >= strLine.size()) || (strLine[unPermissionsOffset + 1] != 'r')) {
					continue;
				}

				std::uintptr_t unBeginAddress = 0;
				std::uintptr_t unEndAddress = 0;
				std::from_chars_result const BeginConversion = std::from_chars(strLine.data(), strLine.data() + unSeparatorOffset, unBeginAddress, kHexadecimalBase);
				std::from_chars_result const EndConversion = std::from_chars(strLine.data() + unSeparatorOffset + 1, strLine.data() + unPermissionsOffset, unEndAddress, kHexadecimalBase);
				if ((BeginConversion.ec == std::errc {}) && (BeginConversion.ptr == (strLine.data() + unSeparatorOffset)) && (EndConversion.ec == std::errc {}) && (EndConversion.ptr == (strLine.data() + unPermissionsOffset))) {
					AddGlobalAddressGameDataRange(vecRanges, unBeginAddress, unEndAddress, unModuleBeginAddress, unModuleEndAddress);
				}
			}

			if (InputStream.bad() || (InputStream.fail() && !InputStream.eof())) {
				return {};
			}
#endif

			return vecRanges;
		}
	} // namespace

	// ================================================================
	// Global address GameData
	// ================================================================

	bool LoadGlobalAddressGameData(std::filesystem::path const& PathFile, std::string const& strSectionName, std::string const& strPlatform, const bool bIs64Bit, GlobalAddressGameData& GameDataOut) {
		static_assert(std::is_nothrow_move_assignable_v<GlobalAddressGameData>, "Global address GameData must commit without throwing.");

		if (PathFile.empty() || strSectionName.empty() || strPlatform.empty()) {
			return false;
		}

		std::map<std::string, std::string> mapValues {};

		std::ifstream InputStream(PathFile, std::ios::binary);
		if (!InputStream.is_open() || !ReadGlobalAddressGameDataSection(InputStream, strSectionName, mapValues)) {
			return false;
		}

		auto* const pBinaryName = SelectGlobalAddressGameDataValue(mapValues, "binary", strPlatform, bIs64Bit);
		auto* const pIdentifier = SelectGlobalAddressGameDataValue(mapValues, "identifier", strPlatform, bIs64Bit);
		if (!pBinaryName || pBinaryName->empty() || !pIdentifier || pIdentifier->empty()) {
			return false;
		}

		GlobalAddressGameData GameData {};
		GameData.m_strBinaryName = *pBinaryName;
		GameData.m_strIdentifier = *pIdentifier;
		GameData.m_bPattern = IsGlobalAddressGameDataPattern(GameData.m_strIdentifier);

		if (GameData.m_bPattern && bIs64Bit && !mapValues.contains("identifier_" + strPlatform + "64")) {
			// Bundled unsuffixed platform patterns describe x86 instructions, not x64 layouts.
			return false;
		}

		if (GameData.m_bPattern) {
			std::vector<unsigned char> vecPattern {};
			if (!ParseGlobalAddressGameDataPattern(GameData.m_strIdentifier, vecPattern)) {
				return false;
			}
		}

		auto* const pAccessor = SelectGlobalAddressGameDataValue(mapValues, "accessor", strPlatform, bIs64Bit);
		if (pAccessor && (*pAccessor != "False") && (*pAccessor != "false")) {
			return false;
		}

		auto* const pOffset = SelectGlobalAddressGameDataValue(mapValues, "offset", strPlatform, bIs64Bit);
		std::int64_t nOffset = 0;
		if (pOffset && !ParseGlobalAddressGameDataInteger(*pOffset, nOffset)) {
			return false;
		}

		if ((nOffset < std::numeric_limits<std::ptrdiff_t>::min()) || (nOffset > std::numeric_limits<std::ptrdiff_t>::max())) {
			return false;
		}

		auto* const pLevel = SelectGlobalAddressGameDataValue(mapValues, "level", strPlatform, bIs64Bit);
		std::int64_t nLevel = 0;
		if (pLevel && !ParseGlobalAddressGameDataInteger(*pLevel, nLevel)) {
			return false;
		}

		if ((nLevel < 0) || (static_cast<std::uint64_t>(nLevel) > kMaximumGlobalAddressGameDataDereferenceCount)) {
			return false;
		}

		GameData.m_nAddressOffset = static_cast<std::ptrdiff_t>(nOffset);
		GameData.m_unDereferenceCount = static_cast<std::size_t>(nLevel);
		GameDataOut = std::move(GameData);

		return true;
	}

	bool ScanGlobalAddressGameDataPattern(std::string const& strPattern, const std::uintptr_t unModuleAddress, const std::size_t unModuleByteSize, std::uintptr_t& unAddressOut) {
		constexpr std::size_t kScanChunkByteCount = 65536;

		if ((unModuleAddress == 0) || (unModuleByteSize == 0) || (unModuleByteSize > (std::numeric_limits<std::uintptr_t>::max() - unModuleAddress))) {
			return false;
		}

		std::vector<unsigned char> vecPattern {};
		if (!ParseGlobalAddressGameDataPattern(strPattern, vecPattern) || (vecPattern.size() > unModuleByteSize)) {
			return false;
		}

		std::vector<GlobalAddressGameDataRange> const vecRanges = CollectGlobalAddressGameDataRanges(unModuleAddress, unModuleAddress + unModuleByteSize);
		std::vector<unsigned char> vecBuffer(kScanChunkByteCount + vecPattern.size() - 1);
		for (auto const& Range : vecRanges) {
			std::uintptr_t unChunkAddress = Range.m_unBeginAddress;
			while ((Range.m_unEndAddress - unChunkAddress) >= vecPattern.size()) {
				const std::size_t unByteCount = std::min(vecBuffer.size(), static_cast<std::size_t>(Range.m_unEndAddress - unChunkAddress));
				if (!ReadGlobalAddressGameDataMemory(unChunkAddress, vecBuffer.data(), unByteCount)) {
					break;
				}

				const std::size_t unCandidateCount = std::min(kScanChunkByteCount, unByteCount - vecPattern.size() + 1);
				for (std::size_t unCandidateOffset = 0; unCandidateOffset < unCandidateCount; ++unCandidateOffset) {
					bool bMatches = true;
					for (std::size_t unPatternOffset = 0; unPatternOffset < vecPattern.size(); ++unPatternOffset) {
						if ((vecPattern[unPatternOffset] != kWildcardByte) && (vecPattern[unPatternOffset] != vecBuffer[unCandidateOffset + unPatternOffset])) {
							bMatches = false;
							break;
						}
					}

					if (bMatches) {
						unAddressOut = unChunkAddress + unCandidateOffset;
						return true;
					}
				}

				unChunkAddress += unCandidateCount;
			}
		}

		return false;
	}

	bool ApplyGlobalAddressGameDataTransform(GlobalAddressGameData const& GameData, const std::uintptr_t unIdentifierAddress, std::uintptr_t& unAddressOut) noexcept {
		if ((unIdentifierAddress == 0) || (GameData.m_unDereferenceCount > kMaximumGlobalAddressGameDataDereferenceCount)) {
			return false;
		}

		std::uintptr_t unAddress = unIdentifierAddress;
		if (GameData.m_nAddressOffset < 0) {
			const std::uintptr_t unMagnitude = static_cast<std::uintptr_t>(-(GameData.m_nAddressOffset + 1)) + 1;
			if (unMagnitude >= unAddress) {
				return false;
			}

			unAddress -= unMagnitude;

		} else {
			const std::uintptr_t unOffset = static_cast<std::uintptr_t>(GameData.m_nAddressOffset);
			if (unOffset > (std::numeric_limits<std::uintptr_t>::max() - unAddress)) {
				return false;
			}

			unAddress += unOffset;
		}

		for (std::size_t unLevel = 0; unLevel < GameData.m_unDereferenceCount; ++unLevel) {
			std::uintptr_t unNextAddress = 0;
			if (!ReadGlobalAddressGameDataMemory(unAddress, &unNextAddress, sizeof(unNextAddress)) || (unNextAddress == 0)) {
				return false;
			}

			unAddress = unNextAddress;
		}

		unAddressOut = unAddress;

		return true;
	}
} // namespace SourceJS
