
// C++
#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <sstream>
#include <utility>

// STL
#include <cctype>
#include <filesystem>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// Select a known SDK-to-data mapping for this isolated parser fixture only.
#define SOURCEJS_SDK_BRANCH "tf2"

namespace SourceJS {

	// Only the runtime path getter is adapted; the data record and all parsers,
	// file reading, branch selection, and committing loader are production bodies.
	class RuntimePaths {
	public:
		explicit RuntimePaths(std::filesystem::path PathData);
		std::filesystem::path const& GetDataPath() const;

	private:
		std::filesystem::path m_PathData;
	};

	RuntimePaths::RuntimePaths(std::filesystem::path PathData) :
		m_PathData(std::move(PathData))
	{
	}

	std::filesystem::path const& RuntimePaths::GetDataPath() const {
		return m_PathData;
	}

	// SOURCEJS_TEAM_LOADING_HELPERS

#undef SOURCEJS_SDK_BRANCH

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	PlayerTeamData MakeSentinelData() {
		constexpr int kExistingClassNumber = 17;
		constexpr int kExistingTeamNumber = 29;

		PlayerTeamData Data {};
		Data.m_mapClassNumbersByName["ExistingClass"] = kExistingClassNumber;
		Data.m_mapClassNamesByNumber[kExistingClassNumber] = "ExistingClass";
		Data.m_mapTeamNumbersByName["ExistingTeam"] = kExistingTeamNumber;
		Data.m_mapTeamNamesByNumber[kExistingTeamNumber] = "ExistingTeam";
		Data.m_vecManagerNames.push_back("existing_manager");
		Data.m_strProfileName = "ExistingProfile";

		return Data;
	}

	bool EqualData(PlayerTeamData const& Left, PlayerTeamData const& Right) {
		return (Left.m_mapClassNumbersByName == Right.m_mapClassNumbersByName) && (Left.m_mapClassNamesByNumber == Right.m_mapClassNamesByNumber) && (Left.m_mapTeamNumbersByName == Right.m_mapTeamNumbersByName) && (Left.m_mapTeamNamesByNumber == Right.m_mapTeamNamesByNumber) && (Left.m_vecManagerNames == Right.m_vecManagerNames) && (Left.m_strProfileName == Right.m_strProfileName);
	}

	void WriteProfile(std::filesystem::path const& PathFile, std::string const& strContents) {
		std::ofstream OutputFile { PathFile, std::ios::binary | std::ios::trunc };
		Require(static_cast<bool>(OutputFile), "Open an isolated fixture profile");

		OutputFile.write(strContents.data(), static_cast<std::streamsize>(strContents.size()));
		Require(static_cast<bool>(OutputFile), "Write an isolated fixture profile");

		OutputFile.close();
		Require(!OutputFile.fail(), "Close an isolated fixture profile");
	}

	void CheckLoading(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kExpectedTeamCount = 2;
		constexpr std::size_t kExpectedClassCount = 1;
		constexpr std::size_t kExpectedManagerCount = 2;
		constexpr int kExpectedRedTeamNumber = 2;
		constexpr int kExpectedBlueTeamNumber = 3;
		constexpr int kExpectedHeavyWeaponsClassNumber = 6;
		constexpr int kExpectedAcronymTeamNumber = 3;
		constexpr int kExpectedAcronymClassNumber = 5;
		constexpr char kMissingNamesProfile[] = "[classes]\nheavy_weapons = 6\n[names]\nInvalid = 1tail\nOverflow = 999999999999999999999999999999\nEmbedded = 4\0tail\n";
		// Legacy input remains readable; packaged public aliases use PascalCase.
		constexpr char kLegacyProfile[] = "manager = \"tf_team\", \"tf_team_alt\"\n[names]\nred_team = 2\nblue-team = 3\n[classes]\nheavy_weapons = 6\n";
		constexpr char kCanonicalProfile[] = "manager = \"tf_team\", \"tf_team_alt\"\n[names]\nRedTeam = 2\nBlueTeam = 3\n[classes]\nHeavyWeapons = 6\n";
		constexpr char kAcronymProfile[] = "[names]\nT = 2\nCT = 3\n[classes]\nSEALTeam6 = 5\n";

		Require(std::filesystem::is_directory(PathRoot) && std::filesystem::is_empty(PathRoot), "Require a dedicated empty fixture directory");
		RuntimePaths const Paths { PathRoot };
		PlayerTeamData const Original = MakeSentinelData();
		PlayerTeamData Data = Original;
		std::string strError {};
		Require(!LoadPlayerTeamData(nullptr, Data, strError), "Reject missing runtime paths");
		Require(EqualData(Data, Original), "Null paths must preserve every output field");
		Require(strError == "players/teams requires runtime paths.", "Preserve missing-path diagnostic");

		Require(!LoadPlayerTeamData(&Paths, Data, strError), "Reject a missing profile");
		Require(EqualData(Data, Original), "Missing profile must preserve every output field");
		Require(strError.find("profile data could not be read:") != std::string::npos, "Preserve file-read diagnostic");

		std::filesystem::path const PathDirectory = PathRoot / "sourcejs" / "teams";
		Require(std::filesystem::create_directories(PathDirectory), "Create isolated profile directories");
		std::filesystem::path const PathProfile = PathDirectory / "tf.ini";
		WriteProfile(PathProfile, std::string(kMissingNamesProfile, sizeof(kMissingNamesProfile) - 1));
		Require(!LoadPlayerTeamData(&Paths, Data, strError), "Reject a profile without valid team names");
		Require(EqualData(Data, Original), "Partially parsed classes must not modify the output on failure");
		Require(strError.find("profile has no [names] entries:") != std::string::npos, "Preserve missing-names diagnostic");

		WriteProfile(PathProfile, kLegacyProfile);
		Require(LoadPlayerTeamData(&Paths, Data, strError), "Load the selected SDK's real profile file");
		Require(Data.m_strProfileName == "tf", "Preserve SDK-to-profile selection");
		Require((Data.m_mapTeamNumbersByName.size() == kExpectedTeamCount) && (Data.m_mapTeamNamesByNumber.size() == kExpectedTeamCount), "Replace prior team maps on success");
		Require((Data.m_mapTeamNumbersByName.at("RedTeam") == kExpectedRedTeamNumber) && (Data.m_mapTeamNumbersByName.at("BlueTeam") == kExpectedBlueTeamNumber), "Preserve PascalCase team names");
		Require((Data.m_mapTeamNamesByNumber.at(kExpectedRedTeamNumber) == "RedTeam") && (Data.m_mapTeamNamesByNumber.at(kExpectedBlueTeamNumber) == "BlueTeam"), "Preserve reverse team mapping");
		Require((Data.m_mapClassNumbersByName.size() == kExpectedClassCount) && (Data.m_mapClassNamesByNumber.size() == kExpectedClassCount), "Replace prior class maps on success");
		Require((Data.m_mapClassNumbersByName.at("HeavyWeapons") == kExpectedHeavyWeaponsClassNumber) && (Data.m_mapClassNamesByNumber.at(kExpectedHeavyWeaponsClassNumber) == "HeavyWeapons"), "Preserve class mapping");
		Require((Data.m_vecManagerNames.size() == kExpectedManagerCount) && (Data.m_vecManagerNames[0] == "tf_team") && (Data.m_vecManagerNames[1] == "tf_team_alt"), "Preserve external manager class names");

		PlayerTeamData const Loaded = Data;

		WriteProfile(PathProfile, kCanonicalProfile);
		Require(LoadPlayerTeamData(&Paths, Data, strError) && EqualData(Data, Loaded), "Canonical aliases preserve every normalized map, manager class and profile field");

		PlayerTeamData AcronymData {};
		WriteProfile(PathProfile, kAcronymProfile);
		Require(LoadPlayerTeamData(&Paths, AcronymData, strError), "Load a canonical acronym profile");
		Require((AcronymData.m_mapTeamNumbersByName.at("CT") == kExpectedAcronymTeamNumber) && (AcronymData.m_mapTeamNamesByNumber.at(kExpectedAcronymTeamNumber) == "CT"), "Preserve CT acronym in forward and reverse team maps");
		Require(!AcronymData.m_mapTeamNumbersByName.contains("Ct"), "Do not expose the incorrect Ct public alias");
		Require((AcronymData.m_mapClassNumbersByName.at("SEALTeam6") == kExpectedAcronymClassNumber) && (AcronymData.m_mapClassNamesByNumber.at(kExpectedAcronymClassNumber) == "SEALTeam6"), "Preserve SEAL acronym in forward and reverse class maps");
		Require(!AcronymData.m_mapClassNumbersByName.contains("SealTeam6"), "Do not expose the incorrect SealTeam6 public alias");

		WriteProfile(PathProfile, "[names]\n");
		Require(!LoadPlayerTeamData(&Paths, Data, strError) && EqualData(Data, Loaded), "A later failed reload preserves the last valid data");
	}

} // namespace SourceJS

int main(const int nArgumentCount, char** const ppszArguments) {
	if (nArgumentCount != 2) {
		std::fprintf(stderr, "Usage: TeamDataLoading <dedicated-empty-fixture-directory>\n");
		return 2;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		SourceJS::CheckLoading(PathRoot);
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "TeamDataLoading failed: %s\n", Failure.what());
		return 1;
	}

	std::printf("TeamDataLoading PASS: real parser/files and atomic output commit; runtime path getter adapted, no V8 or server claim.\n");

	return 0;
}
