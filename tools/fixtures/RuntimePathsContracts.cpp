
// C++
#include <cstdio>

// STL
#include <exception>
#include <filesystem>
#include <stdexcept>
#include <string>

// Project
#include "sourcejs/RuntimePaths.h"

namespace {
	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	void CheckPathEncoding(std::u8string const& strUTF8Path) {
		std::filesystem::path const Path = strUTF8Path;
		std::string const strExpected = std::string(strUTF8Path.begin(), strUTF8Path.end());
		std::string const strEncoded = SourceJS::EncodePathAsUTF8(Path);
		Require(strEncoded == strExpected, "path encoding must preserve UTF-8 bytes independently of the native code page");

		std::u8string const strRoundTripUTF8 = std::u8string(strEncoded.begin(), strEncoded.end());
		std::filesystem::path const PathRoundTrip = strRoundTripUTF8;
		Require(PathRoundTrip.native() == Path.native(), "UTF-8 round trip must preserve native path spelling and separators");
	}

	void CheckRoots(SourceJS::RuntimePaths const& Paths, std::filesystem::path const& PathGameRoot) {
		std::filesystem::path const PathAddonRoot = PathGameRoot / "addons" / "sourcejs";
		Require(Paths.GetGameRootPath().is_absolute(), "game root must be absolute");
		Require(Paths.GetGameRootPath() == PathGameRoot, "normalized absolute game root");
		Require(Paths.GetAddonRootPath() == PathAddonRoot, "addon root");
		Require(Paths.GetDataPath() == (PathAddonRoot / "data"), "DATA_ROOT is addon/data");
		Require(Paths.GetSourceJSDataPath() == (PathAddonRoot / "data" / "sourcejs"), "SOURCE_DATA_ROOT is addon/data/sourcejs");
		Require(Paths.GetExtensionRootPath() == (PathAddonRoot / "extensions"), "extension root");
		Require(Paths.GetPackageRootPath() == (PathAddonRoot / "packages"), "package root");
		Require(Paths.GetPluginRootPath() == (PathAddonRoot / "plugins"), "plugin root");
		Require((Paths.GetDataPath() / "PluginsState.json") == (PathAddonRoot / "data" / "PluginsState.json"), "plugin state file root");
		Require((Paths.GetDataPath() / "ExtensionsState.json") == (PathAddonRoot / "data" / "ExtensionsState.json"), "extension state file root");
	}
} // namespace

int main() {
	try {
		CheckPathEncoding(u8"");
		CheckPathEncoding(u8"plugins/Example.js");
		CheckPathEncoding(u8"plugins/\u0418\u0433\u0440\u0430/Entry.js");
		CheckPathEncoding(u8"plugins/\u65E5\u672C/\U0001F680.js");
		CheckPathEncoding(u8"plugins\\\u0394\u03BF\u03BA\u03B9\u03BC\u03AE\\Entry.js");
		CheckPathEncoding(u8"//FixtureServer/FixtureShare/\u0418\u0433\u0440\u0430/Entry.js");

		std::filesystem::path const PathCurrent = std::filesystem::current_path().lexically_normal();
		SourceJS::RuntimePaths Paths {};
		CheckRoots(Paths, PathCurrent);

		Paths.Initialize({});
		CheckRoots(Paths, PathCurrent);

		std::filesystem::path const PathRelative = "RuntimePathsFixture/../SelectedGame";
		Paths.Initialize(PathRelative);
		CheckRoots(Paths, (PathCurrent / PathRelative).lexically_normal());

		// Borrowed path objects remain members; reinitialization replaces their values.
		std::filesystem::path const& PathBorrowedData = Paths.GetDataPath();
		std::filesystem::path const PathAbsolute = PathCurrent / "RuntimePathsFixture" / ".." / "OtherGame";
		Paths.Initialize(PathAbsolute);
		CheckRoots(Paths, PathAbsolute.lexically_normal());
		Require(&PathBorrowedData == &Paths.GetDataPath(), "getter returns the same borrowed path member");
		Require(PathBorrowedData == (PathAbsolute.lexically_normal() / "addons" / "sourcejs" / "data"), "borrowed path observes reinitialization");

#if defined(_WIN32)
		std::filesystem::path PathOtherDrive = "Z:";
		if (PathOtherDrive == PathCurrent.root_name()) {
			PathOtherDrive = "Y:";
		}

		std::filesystem::path PathDriveRelative = PathOtherDrive;
		PathDriveRelative += "RuntimePathsFixture/../DriveGame";
		Paths.Initialize(PathDriveRelative);
		CheckRoots(Paths, std::filesystem::absolute(PathDriveRelative).lexically_normal());

		Paths.Initialize(PathOtherDrive);
		CheckRoots(Paths, std::filesystem::absolute(PathOtherDrive).lexically_normal());

		std::filesystem::path const PathRootRelative = PathCurrent.root_directory() / "RuntimePathsFixture" / ".." / "RootGame";
		Paths.Initialize(PathRootRelative);
		CheckRoots(Paths, std::filesystem::absolute(PathRootRelative).lexically_normal());

		std::filesystem::path const PathDriveAbsolute = PathOtherDrive / "/RuntimePathsFixture/../AbsoluteGame";
		Paths.Initialize(PathDriveAbsolute);
		CheckRoots(Paths, PathDriveAbsolute.lexically_normal());

		// Absolute UNC roots are normalized lexically without accessing the share.
		std::filesystem::path const PathUNC = R"(\\SourceJSFixtureServer\FixtureShare\RuntimePathsFixture\..\UNCGame)";
		Paths.Initialize(PathUNC);
		CheckRoots(Paths, PathUNC.lexically_normal());
		Require(Paths.GetGameRootPath().native().starts_with(L"\\\\"), "UNC root prefix is preserved");
#else
		std::filesystem::path const PathPOSIXRoot = "/RuntimePathsFixture/../RootGame";
		Paths.Initialize(PathPOSIXRoot);
		CheckRoots(Paths, PathPOSIXRoot.lexically_normal());

		// A drive-like spelling remains a relative filename on POSIX.
		std::filesystem::path const PathDriveLike = "Z:RuntimePathsFixture/../DriveGame";
		Paths.Initialize(PathDriveLike);
		CheckRoots(Paths, (PathCurrent / PathDriveLike).lexically_normal());
#endif

		std::puts("RuntimePaths contracts passed (actual class; no files created).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "RuntimePaths contract failed: %s\n", Exception.what());
		return 1;
	}
}
