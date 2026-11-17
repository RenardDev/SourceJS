#pragma once

#ifndef _SOURCEJSSOURCEMODGAMEDATA_H_
#define _SOURCEJSSOURCEMODGAMEDATA_H_

// Compatibility profile: the reserved guard spelling is project-canonical (2.5/4.1).

// STL
#include <filesystem>

namespace SourceJS {

	// Startup-only, synchronous and bounded. On failure the previous snapshot remains usable.
	void RefreshSourceModGameData(std::filesystem::path const& PathGameDataRoot) noexcept;

	// Returns the active managed snapshot, or an empty path if no snapshot has been installed.
	std::filesystem::path GetSourceModGameDataRoot(std::filesystem::path const& PathGameDataRoot);

	// Identifies reserved updater directories directly below the addon GameData root.
	bool IsSourceModGameDataStorageDirectory(std::filesystem::path const& PathDirectory);
} // namespace SourceJS
#endif // _SOURCEJSSOURCEMODGAMEDATA_H_
