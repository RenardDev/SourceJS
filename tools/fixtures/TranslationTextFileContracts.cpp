
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>

// STL
#include <array>
#include <cctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <sstream>
#include <string>

// Compile via tools/smoke_translation_text_file_contracts.js: its generated source replaces these markers with exact production records/helpers.
namespace TranslationTextFileContracts {
	// SOURCEJS_TRANSLATION_TEXT_FILE_RECORDS

	// SOURCEJS_TRANSLATION_TEXT_FILE_HELPERS

	// SOURCEJS_TRANSLATION_PARSER_HELPERS

	bool CheckFailedRead(std::filesystem::path const& PathFile) {
		std::string const strSentinel = "unchanged-output";
		std::string strActual = strSentinel;
		const bool bReadSucceeded = ReadTranslationTextFile(PathFile, strActual);

		return !bReadSucceeded && (strActual == strSentinel);
	}

	bool CheckFileText(std::filesystem::path const& PathFile, std::string const& strExpected) {
		std::string strActual {};
		const bool bReadSucceeded = ReadTranslationTextFile(PathFile, strActual);

		return bReadSucceeded && (strActual == strExpected);
	}

	bool CheckTranslationParsers(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kCharacterCaseCount = 256;
		constexpr int kHexadecimalLetterValueOffset = 10;
		constexpr char kEscapedText[] = "A\\n\\r\\t\\\\\\\"\\'\\x41\\x00B";
		constexpr char kDecodedText[] = "A\n\r\t\\\"'A\0B";
		constexpr char kOriginalKey[] = "original-key";
		constexpr char kOriginalValue[] = "original-value";

		static_assert(std::numeric_limits<unsigned char>::digits == 8, "fixture checks every 8-bit character");

		for (std::size_t unCharacterValue = 0; unCharacterValue < kCharacterCaseCount; ++unCharacterValue) {
			const char chCharacter = static_cast<char>(unCharacterValue);
			int nExpected = -1;
			if ((chCharacter >= '0') && (chCharacter <= '9')) {
				nExpected = chCharacter - '0';
			} else if ((chCharacter >= 'A') && (chCharacter <= 'F')) {
				nExpected = kHexadecimalLetterValueOffset + (chCharacter - 'A');
			} else if ((chCharacter >= 'a') && (chCharacter <= 'f')) {
				nExpected = kHexadecimalLetterValueOffset + (chCharacter - 'a');
			}

			if (DecodeTranslationHexadecimalDigit(chCharacter) != nExpected) {
				return false;
			}
		}

		std::string const strDecodedText = std::string(kDecodedText, sizeof(kDecodedText) - 1);
		if ((DecodeTranslationEscapeSequences(kEscapedText) != strDecodedText) || (DecodeTranslationEscapeSequences("\\q\\xG0\\") != "qxG0\\") || !DecodeTranslationEscapeSequences("").empty() || (UnquoteTranslationString("  \"Hello\\n\"  ") != "Hello\n") || (UnquoteTranslationString("'Hello\\t'") != "Hello\t")) {
			return false;
		}

		std::string strKey = kOriginalKey;
		std::string strValue = kOriginalValue;
		if (ParseTranslationKeyValue("no separator", strKey, strValue) || (strKey != kOriginalKey) || (strValue != kOriginalValue)) {
			return false;
		}

		if (ParseTranslationKeyValue(" = empty-key", strKey, strValue) || (strKey != kOriginalKey) || (strValue != kOriginalValue)) {
			return false;
		}

		if (!ParseTranslationKeyValue(" Greeting: \"Hello\\n=world\" ", strKey, strValue) || (strKey != "Greeting") || (strValue != "Hello\n=world")) {
			return false;
		}

		TranslationLanguageState LanguageState {};
		LanguageState.m_strDefaultLanguageCode = "de";
		LanguageState.m_strFallbackLanguageCode = "en";
		if (!RegisterTranslationLanguageAlias(LanguageState, " English ", " EN ") || !RegisterTranslationLanguageAlias(LanguageState, "French", "FR") || !RegisterTranslationLanguageAlias(LanguageState, "German", "DE") || RegisterTranslationLanguageAlias(LanguageState, " ", "en") || RegisterTranslationLanguageAlias(LanguageState, "invalid", " ") || (GetTranslationLanguageCode(LanguageState, " ENGLISH ") != "en") || !GetTranslationLanguageCode(LanguageState, "unknown").empty()) {
			return false;
		}

		std::filesystem::path const PathINI = PathRoot / "Parser" / "Input.ini";
		std::string const strINI = "# comment\r\nDEFAULT_LANGUAGE = French\r\nmalformed\r\n[ Greeting ]\r\nEnglish = \"Hello\\nworld\"\r\nFrench: 'Bonjour'\r\nGerman = Hallo\r\nUnknown = ignored\r\n";
		TranslationFile FileData {};
		FileData.m_strFileName = "metadata-preserved";
		FileData.m_strDefaultLanguageCode = "en";
		FileData.m_mapPhrases["Existing"].m_mapLanguageTexts["en"] = "retained";
		if (!WriteTranslationTextFile(PathINI, strINI) || !ParseTranslationINIFile(PathINI, LanguageState, FileData) || (FileData.m_strDefaultLanguageCode != "fr") || (FileData.m_strFileName != "metadata-preserved") || (FileData.m_mapPhrases["Existing"].m_mapLanguageTexts["en"] != "retained")) {
			return false;
		}

		auto itPhrase = FileData.m_mapPhrases.find("Greeting");
		if ((itPhrase == FileData.m_mapPhrases.end()) || (itPhrase->second.m_mapLanguageTexts.size() != 3) || (itPhrase->second.m_mapLanguageTexts["en"] != "Hello\nworld")) {
			return false;
		}

		TranslationPhrase PhraseData = itPhrase->second;
		PhraseData.m_strDefaultLanguageCode = "fr";
		if ((SelectTranslationPhraseLanguageCode(LanguageState, PhraseData, "English") != "en") || (SelectTranslationPhraseLanguageCode(LanguageState, PhraseData, "unknown") != "de")) {
			return false;
		}

		PhraseData.m_mapLanguageTexts.erase("de");
		if (SelectTranslationPhraseLanguageCode(LanguageState, PhraseData, "unknown") != "fr") {
			return false;
		}

		PhraseData.m_mapLanguageTexts.erase("fr");
		if (SelectTranslationPhraseLanguageCode(LanguageState, PhraseData, "unknown") != "en") {
			return false;
		}

		PhraseData.m_mapLanguageTexts.clear();
		if (!SelectTranslationPhraseLanguageCode(LanguageState, PhraseData, "unknown").empty()) {
			return false;
		}

		if (ParseTranslationINIFile(PathRoot / "Missing.ini", LanguageState, FileData) || (FileData.m_strDefaultLanguageCode != "fr") || (FileData.m_mapPhrases.size() != 2)) {
			return false;
		}

		return true;
	}
} // namespace TranslationTextFileContracts

int main(int nArgumentCount, char** ppszArguments) {
	constexpr int kRequiredArgumentCount = 2;
	constexpr std::size_t kBitsPerByte = std::numeric_limits<unsigned char>::digits;
	constexpr std::size_t kReadBlockByteCount = 4096;
	constexpr std::size_t kMaximumTestByteCount = (kReadBlockByteCount * 3) + 1;
	constexpr std::size_t kTestByteCounts[] = {
		0,
		1,
		kReadBlockByteCount - 1,
		kReadBlockByteCount,
		kReadBlockByteCount + 1,
		kMaximumTestByteCount,
	};
	constexpr char kInitialText[] = "Initial\0Data\r\n";

	static_assert(kMaximumTestByteCount <= static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max()), "fixture byte count must fit in streamsize");

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fputs("Usage: TranslationTextFileContracts <private-fixture-directory>\n", stderr);
		return 2;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		if (!std::filesystem::is_directory(PathRoot) || !std::filesystem::is_empty(PathRoot)) {
			std::fputs("TranslationTextFileContracts failed: fixture directory must be empty.\n", stderr);
			return 1;
		}

		std::filesystem::path const PathFile = PathRoot / "Nested" / "Input.bin";
		if (!TranslationTextFileContracts::CheckFailedRead({}) || !TranslationTextFileContracts::CheckFailedRead(PathFile) || !TranslationTextFileContracts::CheckFailedRead(PathRoot)) {
			std::fputs("TranslationTextFileContracts failed: invalid reads changed output or reported success.\n", stderr);
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

			if (!TranslationTextFileContracts::WriteTranslationTextFile(PathFile, strExpected) || !TranslationTextFileContracts::CheckFileText(PathFile, strExpected)) {
				std::fputs("TranslationTextFileContracts failed: exact binary/empty/block-boundary roundtrip mismatch.\n", stderr);
				return 1;
			}
		}

		std::string const strInitialText = std::string(kInitialText, sizeof(kInitialText) - 1);
		std::filesystem::path const PathCreatedFile = PathRoot / "Defaults" / "Created.ini";
		if (!TranslationTextFileContracts::EnsureTranslationTextFileExists(PathCreatedFile, strInitialText) || !TranslationTextFileContracts::CheckFileText(PathCreatedFile, strInitialText)) {
			std::fputs("TranslationTextFileContracts failed: initial file creation mismatch.\n", stderr);
			return 1;
		}

		if (!TranslationTextFileContracts::EnsureTranslationTextFileExists(PathCreatedFile, "replacement") || !TranslationTextFileContracts::CheckFileText(PathCreatedFile, strInitialText)) {
			std::fputs("TranslationTextFileContracts failed: existing file was overwritten or reported missing.\n", stderr);
			return 1;
		}

		std::filesystem::path PathNullSuffix = PathCreatedFile;
		PathNullSuffix += std::filesystem::path::value_type(0);
		PathNullSuffix += "ignored";
		if (!TranslationTextFileContracts::CheckFailedRead(PathNullSuffix) || TranslationTextFileContracts::WriteTranslationTextFile(PathNullSuffix, "replacement") || TranslationTextFileContracts::EnsureTranslationTextFileExists(PathNullSuffix, "replacement") || !TranslationTextFileContracts::CheckFileText(PathCreatedFile, strInitialText)) {
			std::fputs("TranslationTextFileContracts failed: NUL path was truncated or modified its existing prefix.\n", stderr);
			return 1;
		}

		std::filesystem::path const PathBlockedFile = PathCreatedFile / "Blocked.ini";
		if (TranslationTextFileContracts::WriteTranslationTextFile({}, strInitialText) || TranslationTextFileContracts::WriteTranslationTextFile(PathRoot, strInitialText) || TranslationTextFileContracts::WriteTranslationTextFile(PathBlockedFile, strInitialText) || TranslationTextFileContracts::EnsureTranslationTextFileExists({}, strInitialText) || TranslationTextFileContracts::EnsureTranslationTextFileExists(PathBlockedFile, strInitialText)) {
			std::fputs("TranslationTextFileContracts failed: invalid output paths reported success.\n", stderr);
			return 1;
		}

#if !defined(_WIN32)
		std::filesystem::path const PathFullDevice = "/dev/full";
		if (std::filesystem::exists(PathFullDevice) && TranslationTextFileContracts::WriteTranslationTextFile(PathFullDevice, strInitialText)) {
			std::fputs("TranslationTextFileContracts failed: delayed device write failure reported success.\n", stderr);
			return 1;
		}

		std::printf("Translation delayed-write failure probe: %s.\n", std::filesystem::exists(PathFullDevice) ? "PASS" : "unavailable (/dev/full absent)");
#else
		std::fputs("Translation delayed-write failure probe: unavailable (no /dev/full on Windows).\n", stdout);
#endif

		if (!TranslationTextFileContracts::CheckTranslationParsers(PathRoot)) {
			std::fputs("TranslationTextFileContracts failed: native decoding, key/value parsing, INI merging or language selection mismatch.\n", stderr);
			return 1;
		}

		std::printf("Translation text-file native checks PASS; AddressBits=%zu; FailedReads=4; Roundtrips=%zu; ExistingFilePreserved=true.\n", sizeof(std::uintptr_t) * kBitsPerByte, sizeof(kTestByteCounts) / sizeof(kTestByteCounts[0]));
		std::fputs("Translation parser native checks PASS; HexadecimalCharacters=256; INIMerge=true; SelectionPrecedence=true.\n", stdout);

		return 0;
	} catch (std::exception const& Error) {
		std::fprintf(stderr, "TranslationTextFileContracts failed: %s\n", Error.what());
		return 1;
	} catch (...) {
		std::fputs("TranslationTextFileContracts failed: unexpected exception.\n", stderr);
		return 1;
	}
}
