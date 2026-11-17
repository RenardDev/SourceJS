
// C++
#include <cstddef>
#include <cstdio>
#include <cstring>

// STL
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>

// Project
#include "DialogFieldNameValidation.h"
#include "SourceSDKKeyValuesDoubles.h"
#include "sourcejs/SourceSDKKeyValues.h"

namespace Fixture {
	constexpr char kUnchangedText[] = "unchanged";

	constinit State g_State {};

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	void RequireDialogFieldNames() {
		constexpr std::size_t kLongFieldNameLength = 512;
		constexpr std::size_t kEmbeddedNULNameLength = 3;
		constexpr std::size_t kBoundaryNULNameLength = 2;

		std::string const arrValidNames[] { "Name", "constructor", "__proto__", "toString", "field\\name", std::string(kLongFieldNameLength, 'a'), "\xCE\xA9Name" };
		for (auto const& strFieldName : arrValidNames) {
			Require(DialogFieldNameFixture::IsValidMessagesKeyValuesFieldName(strFieldName), "literal dialog field names remain valid");
		}

		std::string const arrInvalidNames[] { "", "/", "parent/child", "prefix/", "/suffix", std::string("a\0b", kEmbeddedNULNameLength), std::string("\0a", kBoundaryNULNameLength), std::string("a\0", kBoundaryNULNameLength), std::string(kLongFieldNameLength, 'a') + "/child", "\xCE\xA9/child" };
		for (auto const& strFieldName : arrInvalidNames) {
			Require(!DialogFieldNameFixture::IsValidMessagesKeyValuesFieldName(strFieldName), "dialog field names reject root aliases, NUL and nested paths");
		}
	}

	void Reset() {
		g_State = {};
		g_State.m_bValidBuffer = true;
		g_State.m_bSDKResult = true;
		g_State.m_nLength = static_cast<int>(kPayloadSize);
		g_State.m_nCapacity = static_cast<int>(kPayloadSize);
		g_State.m_arrPayload[0] = 'A';
		g_State.m_arrPayload[1] = '\0';
		g_State.m_arrPayload[2] = 'B';
		g_State.m_arrPayload[3] = 'C';
	}

	void RequireTextCall(IFileSystem* const pFileSystem, char const* const pszText, char const* const pszPathID) {
		Require(pFileSystem == g_State.m_pExpectedFileSystem, "filesystem identity is forwarded");
		Require(pszText && g_State.m_pszExpectedText && (std::strcmp(pszText, g_State.m_pszExpectedText) == 0), "text is forwarded without rewriting");
		Require(!pszPathID, "default SDK path ID is preserved");
	}

	void RequireRejectedSerialization(KeyValues& Values) {
		std::string strOutput = kUnchangedText;
		Require(!SourceJS::ConvertSourceSDKKeyValuesToString(&Values, strOutput), "invalid SDK output is rejected");
		Require(strOutput == kUnchangedText, "failed serialization preserves caller output");
		Require((g_State.m_unSerializationCalls == 1) && (g_State.m_unBufferConstructors == 1), "serialize exactly once");
	}
} // namespace Fixture

CUtlBuffer::CUtlBuffer(const int nGrowSize, const int nInitialSize, const int nFlags) {
	Fixture::Require((nGrowSize == 0) && (nInitialSize == 0) && (nFlags == TEXT_BUFFER), "SDK text-buffer construction is preserved");
	++Fixture::g_State.m_unBufferConstructors;
}

bool CUtlBuffer::IsValid() const {
	return Fixture::g_State.m_bValidBuffer;
}

int CUtlBuffer::TellPut() const {
	return Fixture::g_State.m_nLength;
}

int CUtlBuffer::Size() const {
	return Fixture::g_State.m_nCapacity;
}

void* CUtlBuffer::Base() {
	++Fixture::g_State.m_unBaseCalls;

	return Fixture::g_State.m_bNullData ? nullptr : Fixture::g_State.m_arrPayload;
}

void KeyValues::RecursiveSaveToFile(CUtlBuffer&, const int nIndentation) {
	Fixture::Require(nIndentation == 0, "SDK serialization indentation is preserved");
	++Fixture::g_State.m_unSerializationCalls;
}

void KeyValues::UsesEscapeSequences(const bool bEnabled) {
	Fixture::g_State.m_bEscapeSequences = bEnabled;
	++Fixture::g_State.m_unEscapeCalls;
}

bool KeyValues::LoadFromBuffer(char const* const pszResourceName, char const* const pszText, IFileSystem* const pFileSystem, char const* const pszPathID) {
	Fixture::Require(std::strcmp(pszResourceName, "SourceJS") == 0, "SDK resource label is preserved");
	Fixture::RequireTextCall(pFileSystem, pszText, pszPathID);
	++Fixture::g_State.m_unLoadBufferCalls;

	return Fixture::g_State.m_bSDKResult;
}

bool KeyValues::LoadFromFile(IFileSystem* const pFileSystem, char const* const pszPath, char const* const pszPathID) {
	Fixture::RequireTextCall(pFileSystem, pszPath, pszPathID);
	++Fixture::g_State.m_unLoadFileCalls;

	return Fixture::g_State.m_bSDKResult;
}

bool KeyValues::SaveToFile(IFileSystem* const pFileSystem, char const* const pszPath, char const* const pszPathID) {
	Fixture::RequireTextCall(pFileSystem, pszPath, pszPathID);
	++Fixture::g_State.m_unSaveFileCalls;

	return Fixture::g_State.m_bSDKResult;
}

int main(const int nArgumentCount, char**) {
	constexpr int kRequiredArgumentCount = 1;
	constexpr int kInvalidArgumentExitCode = 2;
	constexpr bool kSDKResults[] = { false, true };
	constexpr bool kEscapeModes[] = { false, true };
	constexpr int kInvalidLengths[] = { -1, static_cast<int>(Fixture::kPayloadSize) + 1, std::numeric_limits<int>::max() };

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fprintf(stderr, "Usage: SourceSDKKeyValuesContracts\n");
		return kInvalidArgumentExitCode;
	}

	try {
		Fixture::RequireDialogFieldNames();

		KeyValues Values {};
		IFileSystem FileSystem {};
		Fixture::Reset();
		std::string strOutput = Fixture::kUnchangedText;
		Fixture::Require(!SourceJS::ConvertSourceSDKKeyValuesToString(nullptr, strOutput) && (strOutput == Fixture::kUnchangedText), "null KeyValues preserves output");
		Fixture::Require(Fixture::g_State.m_unBufferConstructors == 0, "null guard precedes SDK construction");

		Fixture::Require(SourceJS::ConvertSourceSDKKeyValuesToString(&Values, strOutput), "valid SDK bytes serialize");
		Fixture::Require(strOutput == std::string(Fixture::g_State.m_arrPayload, Fixture::kPayloadSize), "exact bytes and embedded zero are preserved");

		Fixture::Reset();
		Fixture::g_State.m_bValidBuffer = false;
		Fixture::RequireRejectedSerialization(Values);
		Fixture::Require(Fixture::g_State.m_unBaseCalls == 0, "invalid buffer is never accessed");

		for (auto const& nLength : kInvalidLengths) {
			Fixture::Reset();
			Fixture::g_State.m_nLength = nLength;
			Fixture::RequireRejectedSerialization(Values);
			Fixture::Require(Fixture::g_State.m_unBaseCalls == 0, "invalid range is rejected before obtaining bytes");
		}

		Fixture::Reset();
		Fixture::g_State.m_nLength = 0;
		Fixture::g_State.m_nCapacity = -1;
		Fixture::RequireRejectedSerialization(Values);

		Fixture::Reset();
		Fixture::g_State.m_bNullData = true;
		Fixture::RequireRejectedSerialization(Values);

		Fixture::Reset();
		Fixture::g_State.m_bNullData = true;
		Fixture::g_State.m_nLength = 0;
		Fixture::g_State.m_nCapacity = 0;
		Fixture::Require(SourceJS::ConvertSourceSDKKeyValuesToString(&Values, strOutput) && strOutput.empty(), "empty SDK buffer with null storage remains valid");

		Fixture::Reset();
		Fixture::Require(!SourceJS::LoadSourceSDKKeyValuesFromBuffer(nullptr, &FileSystem, "text", false) && !SourceJS::LoadSourceSDKKeyValuesFromBuffer(&Values, nullptr, "text", false), "buffer load rejects missing dependencies");
		Fixture::Require(!SourceJS::LoadSourceSDKKeyValuesFromFile(nullptr, &FileSystem, "path", false) && !SourceJS::LoadSourceSDKKeyValuesFromFile(&Values, nullptr, "path", false), "file load rejects missing dependencies");
		Fixture::Require(!SourceJS::SaveSourceSDKKeyValuesToFile(nullptr, &FileSystem, "path") && !SourceJS::SaveSourceSDKKeyValuesToFile(&Values, nullptr, "path"), "file save rejects missing dependencies");
		Fixture::Require((Fixture::g_State.m_unEscapeCalls == 0) && (Fixture::g_State.m_unLoadBufferCalls == 0) && (Fixture::g_State.m_unLoadFileCalls == 0) && (Fixture::g_State.m_unSaveFileCalls == 0), "dependency guards have no SDK side effects");

		for (auto const& bSDKResult : kSDKResults) {
			for (auto const& bEscapeSequences : kEscapeModes) {
				Fixture::Reset();
				Fixture::g_State.m_bSDKResult = bSDKResult;
				Fixture::g_State.m_pExpectedFileSystem = &FileSystem;
				Fixture::g_State.m_pszExpectedText = "Root { Value Text }";
				Fixture::Require(SourceJS::LoadSourceSDKKeyValuesFromBuffer(&Values, &FileSystem, "Root { Value Text }", bEscapeSequences) == bSDKResult, "buffer load propagates SDK status");
				Fixture::Require((Fixture::g_State.m_unEscapeCalls == 1) && (Fixture::g_State.m_bEscapeSequences == bEscapeSequences) && (Fixture::g_State.m_unLoadBufferCalls == 1), "buffer escape option is applied once");

				Fixture::g_State.m_pszExpectedText = "Folder/File.kv";
				Fixture::Require(SourceJS::LoadSourceSDKKeyValuesFromFile(&Values, &FileSystem, "Folder/File.kv", bEscapeSequences) == bSDKResult, "file load propagates SDK status");
				Fixture::Require((Fixture::g_State.m_unEscapeCalls == 2) && (Fixture::g_State.m_bEscapeSequences == bEscapeSequences) && (Fixture::g_State.m_unLoadFileCalls == 1), "file escape option is applied once");
				Fixture::Require(SourceJS::SaveSourceSDKKeyValuesToFile(&Values, &FileSystem, "Folder/File.kv") == bSDKResult, "file save propagates SDK status");
				Fixture::Require(Fixture::g_State.m_unSaveFileCalls == 1, "file save is called once");
			}
		}

		std::puts("SDK KeyValues contracts passed (actual adapter; SDK doubles, no engine filesystem).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "SDK KeyValues contracts failed: %s\n", Exception.what());
		return 1;
	}
}
