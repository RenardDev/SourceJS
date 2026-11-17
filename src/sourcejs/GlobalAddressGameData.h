#ifndef _SOURCEJSGLOBALADDRESSGAMEDATA_H_
#define _SOURCEJSGLOBALADDRESSGAMEDATA_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// C++
#include <cstddef>
#include <cstdint>

// STL
#include <filesystem>
#include <string>

namespace SourceJS {

	// ================================================================
	// Global address GameData
	// ================================================================

	// The packaged INI spelling is external data; this record is the native view.
	// Value-initialize at use to establish the scalar fields before loading.
	struct GlobalAddressGameData {
		std::string m_strBinaryName;
		std::string m_strIdentifier;
		std::ptrdiff_t m_nAddressOffset;
		std::size_t m_unDereferenceCount;
		bool m_bPattern;
	};

	// These operations share no mutable state. Callers synchronize shared outputs and native-memory updates.
	// Returned addresses borrow their underlying storage; no ownership or lifetime extension is transferred.

	// Flat global-address sections only; unsupported accessor records are rejected.
	// False leaves GameDataOut unchanged. File IO is synchronous; allocations may throw.
	bool LoadGlobalAddressGameData(std::filesystem::path const& PathFile, std::string const& strSectionName, std::string const& strPlatform, const bool bIs64Bit, GlobalAddressGameData& GameDataOut);

	// Scans readable mappings within the borrowed module range; 2A/??/* denote wildcard bytes.
	// Keep the module loaded during the scan. False leaves unAddressOut unchanged; allocations may throw.
	bool ScanGlobalAddressGameDataPattern(std::string const& strPattern, const std::uintptr_t unModuleAddress, const std::size_t unModuleByteSize, std::uintptr_t& unAddressOut);

	// Checked signed offset and native-width indirection; never dereferences an unchecked address.
	// Keep the borrowed memory alive during the operation. False leaves unAddressOut unchanged.
	bool ApplyGlobalAddressGameDataTransform(GlobalAddressGameData const& GameData, const std::uintptr_t unIdentifierAddress, std::uintptr_t& unAddressOut) noexcept;

} // namespace SourceJS
#endif // _SOURCEJSGLOBALADDRESSGAMEDATA_H_
