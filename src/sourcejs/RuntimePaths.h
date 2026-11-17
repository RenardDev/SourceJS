#pragma once

#ifndef _SOURCEJSRUNTIMEPATHS_H_
#define _SOURCEJSRUNTIMEPATHS_H_

// Compatibility profile (4.1): this canonical guard is the only reserved-name exception.

// STL
#include <filesystem>
#include <string>

// ----------------------------------------------------------------
// RuntimePaths
// ----------------------------------------------------------------

namespace SourceJS {

	// Allocates UTF-8 bytes from native path spelling, without normalization or separator changes.
	// May throw on allocation/native encoding conversion; no filesystem access.
	std::string EncodePathAsUTF8(std::filesystem::path const& Path);

	// Owns lexical paths. Synchronize Initialize against reads; getter references expire with this object.
	class RuntimePaths {
	public:
		// Starts at the process working directory; path allocation/working-directory lookup may throw.
		RuntimePaths();

	public:
		// Empty roots use the working directory; relative roots use native absolute-path resolution.
		// Windows drive-relative/root-relative and absolute UNC roots retain their native meaning.
		// Replaces borrowed values in place; callers must serialize working-directory changes.
		// May throw; performs lexical normalization, not existence checks or symlink resolution.
		void Initialize(std::filesystem::path const& PathGameRoot);

	public:
		std::filesystem::path const& GetGameRootPath() const;
		std::filesystem::path const& GetAddonRootPath() const;
		// Addon data root, including manager state files.
		std::filesystem::path const& GetDataPath() const;
		// Core-specific data below the data root's sourcejs directory.
		std::filesystem::path const& GetSourceJSDataPath() const;
		std::filesystem::path const& GetExtensionRootPath() const;
		std::filesystem::path const& GetPackageRootPath() const;
		std::filesystem::path const& GetPluginRootPath() const;

	private:
		std::filesystem::path m_PathGameRoot;
		std::filesystem::path m_PathAddonRoot;
		std::filesystem::path m_PathData;
		std::filesystem::path m_PathSourceJSData;
		std::filesystem::path m_PathExtensionRoot;
		std::filesystem::path m_PathPackageRoot;
		std::filesystem::path m_PathPluginRoot;
	};
} // namespace SourceJS
#endif // _SOURCEJSRUNTIMEPATHS_H_
