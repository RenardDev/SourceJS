#include "sourcejs/SourceSDKKeyValues.h"

// General
#include "filesystem.h"
#include "tier1/KeyValues.h"
#include "tier1/utlbuffer.h"

// C++
#include <cstddef>

// STL
#include <string>

namespace SourceJS {

	bool ConvertSourceSDKKeyValuesToString(KeyValues* const pKeyValues, std::string& strOutputOut) {
		if (!pKeyValues) {
			return false;
		}

		CUtlBuffer OutputBuffer = CUtlBuffer(0, 0, CUtlBuffer::TEXT_BUFFER);
		pKeyValues->RecursiveSaveToFile(OutputBuffer, 0);
		if (!OutputBuffer.IsValid()) {
			return false;
		}

		const int nLength = OutputBuffer.TellPut();
		if ((nLength < 0) || (nLength > OutputBuffer.Size())) {
			return false;
		}

		char const* const pszData = static_cast<char const*>(OutputBuffer.Base());
		if (!pszData && (nLength != 0)) {
			return false;
		}

		strOutputOut.assign(pszData ? pszData : "", static_cast<std::size_t>(nLength));

		return true;
	}

	bool LoadSourceSDKKeyValuesFromBuffer(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strBuffer, const bool bUsesEscapeSequences) {
		if (!pKeyValues || !pFileSystem) {
			return false;
		}

		pKeyValues->UsesEscapeSequences(bUsesEscapeSequences);

		return pKeyValues->LoadFromBuffer("SourceJS", strBuffer.c_str(), pFileSystem, nullptr);
	}

	bool LoadSourceSDKKeyValuesFromFile(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strPath, const bool bUsesEscapeSequences) {
		if (!pKeyValues || !pFileSystem) {
			return false;
		}

		pKeyValues->UsesEscapeSequences(bUsesEscapeSequences);

		return pKeyValues->LoadFromFile(pFileSystem, strPath.c_str(), nullptr);
	}

	bool SaveSourceSDKKeyValuesToFile(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strPath) {
		if (!pKeyValues || !pFileSystem) {
			return false;
		}

		return pKeyValues->SaveToFile(pFileSystem, strPath.c_str(), nullptr);
	}
} // namespace SourceJS
