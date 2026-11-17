#pragma once

#ifndef _SOURCEJSTESTSOURCESDKKEYVALUESDOUBLES_H_
#define _SOURCEJSTESTSOURCESDKKEYVALUESDOUBLES_H_

// C++
#include <cstddef>

// Exact SDK names below are test doubles, not an alternative engine ABI.
class IFileSystem {
};

namespace Fixture {
	constexpr std::size_t kPayloadSize = 4;

	struct State {
		bool m_bValidBuffer;
		bool m_bNullData;
		bool m_bSDKResult;
		bool m_bEscapeSequences;
		int m_nLength;
		int m_nCapacity;
		char m_arrPayload[kPayloadSize];
		IFileSystem* m_pExpectedFileSystem;
		char const* m_pszExpectedText;
		std::size_t m_unBufferConstructors;
		std::size_t m_unSerializationCalls;
		std::size_t m_unBaseCalls;
		std::size_t m_unEscapeCalls;
		std::size_t m_unLoadBufferCalls;
		std::size_t m_unLoadFileCalls;
		std::size_t m_unSaveFileCalls;
	};

	extern State g_State;

	void Require(const bool bCondition, char const* const pszMessage);
} // namespace Fixture

class CUtlBuffer {
public:
	// Preserve the external SDK enum spelling used by the production adapter.
	enum {
		TEXT_BUFFER = 1
	};

	CUtlBuffer(const int nGrowSize, const int nInitialSize, const int nFlags);

	bool IsValid() const;
	int TellPut() const;
	int Size() const;
	void* Base();
};

class KeyValues {
public:
	void RecursiveSaveToFile(CUtlBuffer&, const int nIndentation);
	void UsesEscapeSequences(const bool bEnabled);
	bool LoadFromBuffer(char const* const pszResourceName, char const* const pszText, IFileSystem* const pFileSystem, char const* const pszPathID);
	bool LoadFromFile(IFileSystem* const pFileSystem, char const* const pszPath, char const* const pszPathID);
	bool SaveToFile(IFileSystem* const pFileSystem, char const* const pszPath, char const* const pszPathID);
};

#endif // _SOURCEJSTESTSOURCESDKKEYVALUESDOUBLES_H_
