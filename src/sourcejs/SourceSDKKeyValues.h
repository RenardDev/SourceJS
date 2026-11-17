#pragma once

#ifndef _SOURCEJSSOURCESDKKEYVALUES_H_
#define _SOURCEJSSOURCESDKKEYVALUES_H_

// Compatibility profile (4.1): this canonical guard is the only reserved-name exception.

// STL
#include <string>

class IFileSystem;
class KeyValues;

namespace SourceJS {

	// Synchronous calls borrow live SDK objects; the caller supplies SDK-required thread confinement.
	// SDK and string-allocation exceptions propagate to the caller's exception boundary.
	// Serialization commits only on success; false preserves strOutputOut, and a valid empty result clears it.
	bool ConvertSourceSDKKeyValuesToString(KeyValues* const pKeyValues, std::string& strOutputOut);

	// Text/paths use the SDK's null-terminated interfaces; parse/file status and mutation semantics are preserved.
	// Missing required SDK objects return false before applying escape options or performing file operations.
	bool LoadSourceSDKKeyValuesFromBuffer(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strBuffer, const bool bUsesEscapeSequences);
	bool LoadSourceSDKKeyValuesFromFile(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strPath, const bool bUsesEscapeSequences);
	bool SaveSourceSDKKeyValuesToFile(KeyValues* const pKeyValues, IFileSystem* const pFileSystem, std::string const& strPath);
} // namespace SourceJS
#endif // _SOURCEJSSOURCESDKKEYVALUES_H_
