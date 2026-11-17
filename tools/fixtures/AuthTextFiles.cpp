#include "AuthTextFiles.generated.h"

// C++
#include <cstddef>
#include <utility>

// STL
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace AuthTextFilesFixture {
	// SDK-shaped lookup dependencies only; no actual engine or SDK ABI is exercised.
	struct AuthSubjectEdict {
		bool IsFree() const noexcept {
			return m_bFree;
		}

		bool m_bFree;
		char const* m_pszNetworkID;
	};

	struct AuthSubjectGlobalVariables {
		// Preserve the exact SDK member spelling consumed by the extracted helper.
		int maxClients;
		int maxEntities;
	};

	struct AuthSubjectEngine {
		char const* GetPlayerNetworkIDString(AuthSubjectEdict const* const pEdict) {
			++m_unNetworkIDReadCount;

			return m_bReturnNull ? nullptr : pEdict->m_pszNetworkID;
		}

		std::size_t m_unNetworkIDReadCount;
		bool m_bReturnNull;
	};

	struct AuthSubjectEngineInterfaces {
		AuthSubjectEngine* GetEngine() const noexcept {
			return m_pEngine;
		}

		AuthSubjectGlobalVariables* GetGlobalVariables() const noexcept {
			return m_pGlobalVariables;
		}

		AuthSubjectEngine* m_pEngine;
		AuthSubjectGlobalVariables* m_pGlobalVariables;
	};

	struct AuthSubjectApplication {
		AuthSubjectEngineInterfaces& GetEngineInterfaces() noexcept {
			return m_EngineInterfaces;
		}

		AuthSubjectEngineInterfaces m_EngineInterfaces;
	};

	constexpr std::size_t kAuthSubjectEdictCount = 5;
	constexpr int kAuthSubjectMaximumClients = 2;
	constexpr char kAuthSubjectNetworkID[] = "STEAM_1:0:17";
	constexpr char kAuthSubjectNonPlayerNetworkID[] = "NON_PLAYER";

	AuthSubjectApplication g_Application {};
	AuthSubjectEngine g_AuthSubjectEngine {};
	AuthSubjectGlobalVariables g_AuthSubjectGlobalVariables {};
	AuthSubjectEdict g_arrAuthSubjectEdicts[kAuthSubjectEdictCount] {};
	std::size_t g_unAuthSubjectEdictLookupCount = 0;
	bool g_bAuthSubjectMissingEdict = false;

	AuthSubjectEdict* GetEdictFromEntityIndex(const int nEntityIndex) {
		++g_unAuthSubjectEdictLookupCount;
		auto const* const pGlobalVariables = g_Application.GetEngineInterfaces().GetGlobalVariables();
		if (!pGlobalVariables || g_bAuthSubjectMissingEdict || (nEntityIndex < 0) || (nEntityIndex >= pGlobalVariables->maxEntities) || (static_cast<std::size_t>(nEntityIndex) >= kAuthSubjectEdictCount)) {
			return nullptr;
		}

		return &g_arrAuthSubjectEdicts[nEntityIndex];
	}

	// Generated implementation fragment: resolver body extracted without semantic rewriting.
	// The controlled dependencies above belong to this fixture, not to the production SDK.
#include "AuthSubjectLookup.generated.inc"

	bool Check(const bool bCondition, char const* const pszScenario) {
		if (!bCondition) {
			std::cerr << "AuthTextFiles failed Scenario=\"" << pszScenario << "\"\n";
			return false;
		}

		return true;
	}

	bool CheckAuthSubjectLookup(const int nPlayerIndex, char const* const pszExpectedNetworkID, const std::size_t unExpectedEdictLookups, const std::size_t unExpectedNetworkIDReads, char const* const pszScenario) {
		g_unAuthSubjectEdictLookupCount = 0;
		g_AuthSubjectEngine.m_unNetworkIDReadCount = 0;
		std::string const strNetworkID = ResolveAuthenticationPlayerNetworkIDFromIndex(nPlayerIndex);

		return Check((strNetworkID == pszExpectedNetworkID) && (g_unAuthSubjectEdictLookupCount == unExpectedEdictLookups) && (g_AuthSubjectEngine.m_unNetworkIDReadCount == unExpectedNetworkIDReads), pszScenario);
	}

	bool RunAuthSubjectLookupChecks() {
		constexpr int kFirstPlayerIndex = 1;
		constexpr int kInvalidPlayerIndices[] = { -1, 0, kAuthSubjectMaximumClients + 1, static_cast<int>(kAuthSubjectEdictCount) - 1, std::numeric_limits<int>::max() };

		static_assert(std::is_same_v<decltype(ResolveAuthenticationPlayerNetworkIDFromIndex(kFirstPlayerIndex)), std::string>, "auth subject lookup returns an owning string");

		g_Application.m_EngineInterfaces.m_pEngine = &g_AuthSubjectEngine;
		g_Application.m_EngineInterfaces.m_pGlobalVariables = &g_AuthSubjectGlobalVariables;
		g_AuthSubjectGlobalVariables.maxClients = kAuthSubjectMaximumClients;
		g_AuthSubjectGlobalVariables.maxEntities = static_cast<int>(kAuthSubjectEdictCount);
		g_AuthSubjectEngine.m_bReturnNull = false;
		g_bAuthSubjectMissingEdict = false;
		for (auto& Edict : g_arrAuthSubjectEdicts) {
			Edict.m_bFree = false;
			Edict.m_pszNetworkID = kAuthSubjectNonPlayerNetworkID;
		}

		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_pszNetworkID = kAuthSubjectNetworkID;
		g_arrAuthSubjectEdicts[kAuthSubjectMaximumClients].m_pszNetworkID = kAuthSubjectNetworkID;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, kAuthSubjectNetworkID, 1, 1, "first auth player lookup") || !CheckAuthSubjectLookup(kAuthSubjectMaximumClients, kAuthSubjectNetworkID, 1, 1, "last auth player lookup")) {
			return false;
		}

		for (auto const& nPlayerIndex : kInvalidPlayerIndices) {
			if (!CheckAuthSubjectLookup(nPlayerIndex, "", 0, 0, "auth subject rejects non-player indices before SDK lookup")) {
				return false;
			}
		}

		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_bFree = true;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 1, 0, "auth subject free player edict")) {
			return false;
		}

		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_bFree = false;
		g_bAuthSubjectMissingEdict = true;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 1, 0, "auth subject missing player edict")) {
			return false;
		}

		g_bAuthSubjectMissingEdict = false;
		g_AuthSubjectEngine.m_bReturnNull = true;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 1, 1, "auth subject null network identifier")) {
			return false;
		}

		g_AuthSubjectEngine.m_bReturnNull = false;
		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_pszNetworkID = "";
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 1, 1, "auth subject empty network identifier")) {
			return false;
		}

		std::string strNativeNetworkID = kAuthSubjectNetworkID;
		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_pszNetworkID = strNativeNetworkID.c_str();
		std::string const strOwnedNetworkID = ResolveAuthenticationPlayerNetworkIDFromIndex(kFirstPlayerIndex);
		strNativeNetworkID.front() = 'X';
		g_arrAuthSubjectEdicts[kFirstPlayerIndex].m_pszNetworkID = kAuthSubjectNonPlayerNetworkID;
		if (!Check(strOwnedNetworkID == kAuthSubjectNetworkID, "auth subject owns network identifier snapshot")) {
			return false;
		}

		g_Application.m_EngineInterfaces.m_pEngine = nullptr;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 0, 0, "auth subject missing engine")) {
			return false;
		}

		g_Application.m_EngineInterfaces.m_pEngine = &g_AuthSubjectEngine;
		g_Application.m_EngineInterfaces.m_pGlobalVariables = nullptr;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 0, 0, "auth subject missing player globals")) {
			return false;
		}

		g_Application.m_EngineInterfaces.m_pGlobalVariables = &g_AuthSubjectGlobalVariables;
		g_AuthSubjectGlobalVariables.maxClients = 0;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 0, 0, "auth subject zero maximum players")) {
			return false;
		}

		g_AuthSubjectGlobalVariables.maxClients = -1;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 0, 0, "auth subject negative maximum players")) {
			return false;
		}

		g_AuthSubjectGlobalVariables.maxClients = kAuthSubjectMaximumClients;
		g_AuthSubjectGlobalVariables.maxEntities = kFirstPlayerIndex;
		if (!CheckAuthSubjectLookup(kFirstPlayerIndex, "", 1, 0, "auth subject edict bound remains enforced")) {
			return false;
		}

		g_Application.m_EngineInterfaces.m_pEngine = nullptr;
		g_Application.m_EngineInterfaces.m_pGlobalVariables = nullptr;
		std::cout << "AuthTextFiles extracted auth subject lookup passed (controlled SDK dependencies)\n";

		return true;
	}

	bool DoAuthRecordsMatch(std::map<std::string, SourceJSAuthTextFiles::AuthenticationPermissionRecord> const& mapExpectedRecords, std::map<std::string, SourceJSAuthTextFiles::AuthenticationPermissionRecord> const& mapActualRecords) {
		if (mapExpectedRecords.size() != mapActualRecords.size()) {
			return false;
		}

		for (auto itExpectedRecord = mapExpectedRecords.begin(); itExpectedRecord != mapExpectedRecords.end(); ++itExpectedRecord) {
			auto itActualRecord = mapActualRecords.find(itExpectedRecord->first);
			if ((itActualRecord == mapActualRecords.end()) || (itActualRecord->second.m_vecPermissions != itExpectedRecord->second.m_vecPermissions) || (itActualRecord->second.m_vecParents != itExpectedRecord->second.m_vecParents)) {
				return false;
			}
		}

		return true;
	}

	bool RunSQLCodecChecks() {
		constexpr char kExpectedSQLSchema[] =
			"-- SourceJS auth SQL backend state.\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_players (subject TEXT PRIMARY KEY);\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_player_permissions (subject TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY (subject, permission));\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_player_parents (subject TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (subject, parent));\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_parents (name TEXT PRIMARY KEY);\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_parent_permissions (name TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY (name, permission));\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_parent_parents (name TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY (name, parent));\n"
			"CREATE TABLE IF NOT EXISTS sourcejs_auth_simple_admins (subject TEXT PRIMARY KEY);\n"
			"DELETE FROM sourcejs_auth_player_permissions;\n"
			"DELETE FROM sourcejs_auth_player_parents;\n"
			"DELETE FROM sourcejs_auth_players;\n"
			"DELETE FROM sourcejs_auth_parent_permissions;\n"
			"DELETE FROM sourcejs_auth_parent_parents;\n"
			"DELETE FROM sourcejs_auth_parents;\n"
			"DELETE FROM sourcejs_auth_simple_admins;\n";

		SourceJSAuthTextFiles::AuthenticationStateRecord ExpectedState {};
		if (!Check(SourceJSAuthTextFiles::MakeAuthenticationSQLText(ExpectedState) == kExpectedSQLSchema, "empty SQL dump bytes")) {
			return false;
		}

		ExpectedState.m_mapPlayers["O'Ryan"].m_vecPermissions.push_back("say;\n'quoted'");
		ExpectedState.m_mapPlayers["O'Ryan"].m_vecParents.push_back("Group");
		ExpectedState.m_mapParents["Group"].m_vecPermissions.push_back("admin.*");
		ExpectedState.m_mapParents["Group"].m_vecParents.push_back("Root");
		ExpectedState.m_vecSimpleAdministrators.push_back("SteamID");

		std::string const strExpectedSQLText = std::string(kExpectedSQLSchema) +
			"INSERT INTO sourcejs_auth_players (subject) VALUES ('O''Ryan');\n"
			"INSERT INTO sourcejs_auth_player_permissions (subject, permission) VALUES ('O''Ryan', 'say;\n''quoted''');\n"
			"INSERT INTO sourcejs_auth_player_parents (subject, parent) VALUES ('O''Ryan', 'Group');\n"
			"INSERT INTO sourcejs_auth_parents (name) VALUES ('Group');\n"
			"INSERT INTO sourcejs_auth_parent_permissions (name, permission) VALUES ('Group', 'admin.*');\n"
			"INSERT INTO sourcejs_auth_parent_parents (name, parent) VALUES ('Group', 'Root');\n"
			"INSERT INTO sourcejs_auth_simple_admins (subject) VALUES ('SteamID');\n";
		std::string const strSQLText = SourceJSAuthTextFiles::MakeAuthenticationSQLText(ExpectedState);
		if (!Check(strSQLText == strExpectedSQLText, "SQL dump bytes order escaping and schema")) {
			return false;
		}

		std::string const strBinaryPermission = std::string("A") + '\0' + "B;C'";
		ExpectedState.m_mapPlayers["O'Ryan"].m_vecPermissions.push_back(strBinaryPermission);
		SourceJSAuthTextFiles::AuthenticationStateRecord ActualState {};
		std::vector<std::string> const vecStatements = SourceJSAuthTextFiles::ParseAuthenticationSQLStatements(SourceJSAuthTextFiles::MakeAuthenticationSQLText(ExpectedState));
		for (auto const& strStatement : vecStatements) {
			if (!SourceJSAuthTextFiles::DoesAuthenticationSQLStartWith(strStatement, "insert into")) {
				continue;
			}

			std::vector<std::string> vecValues {};
			if (!Check(SourceJSAuthTextFiles::ParseAuthenticationSQLValues(strStatement, vecValues), "parse emitted SQL values")) {
				return false;
			}

			std::string const strTableName = SourceJSAuthTextFiles::ExtractAuthenticationSQLInsertTableName(strStatement);
			SourceJSAuthTextFiles::ApplyAuthenticationSQLInsert(strTableName, vecValues, ActualState);
			SourceJSAuthTextFiles::ApplyAuthenticationSQLInsert(strTableName, vecValues, ActualState);
		}

		if (!Check(DoAuthRecordsMatch(ExpectedState.m_mapPlayers, ActualState.m_mapPlayers) && DoAuthRecordsMatch(ExpectedState.m_mapParents, ActualState.m_mapParents) && (ExpectedState.m_vecSimpleAdministrators == ActualState.m_vecSimpleAdministrators), "SQL native codec round trip and deduplication")) {
			return false;
		}

		std::vector<std::string> vecValues { "unchanged" };
		if (!Check(!SourceJSAuthTextFiles::ParseAuthenticationSQLValues("INSERT INTO table_name (key)", vecValues) && (vecValues == std::vector<std::string> { "unchanged" }), "SQL missing values preserves output")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::ParseAuthenticationSQLValues("INSERT INTO table_name (key) VALUES ('unterminated", vecValues) && (vecValues == std::vector<std::string> { "unchanged" }), "SQL unterminated quote preserves output")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::ParseAuthenticationSQLValues("INSERT INTO table_name (key) VALUES ('closed'", vecValues) && (vecValues == std::vector<std::string> { "unchanged" }), "SQL missing closing delimiter preserves output")) {
			return false;
		}

		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationSQLStartWith(" \nInSeRt InTo TABLE_NAME", "insert into") && (SourceJSAuthTextFiles::ExtractAuthenticationSQLInsertTableName("  INSERT INTO TABLE_NAME (key) VALUES ('value')") == "table_name"), "SQL keyword and table normalization")) {
			return false;
		}

		return true;
	}

	bool DoesWildcardOracleMatch(std::string_view const strvPattern, std::string_view const strvCandidate) {
		std::vector<bool> vecPreviousMatches = std::vector<bool>(strvCandidate.size() + 1, false);
		vecPreviousMatches[0] = true;
		for (auto const& chPattern : strvPattern) {
			std::vector<bool> vecCurrentMatches = std::vector<bool>(strvCandidate.size() + 1, false);
			vecCurrentMatches[0] = (chPattern == '*') && vecPreviousMatches[0];
			for (std::size_t unCandidateIndex = 0; unCandidateIndex < strvCandidate.size(); ++unCandidateIndex) {
				vecCurrentMatches[unCandidateIndex + 1] = (chPattern == '*') ? (vecPreviousMatches[unCandidateIndex + 1] || vecCurrentMatches[unCandidateIndex]) : (vecPreviousMatches[unCandidateIndex] && (chPattern == strvCandidate[unCandidateIndex]));
			}

			vecPreviousMatches = std::move(vecCurrentMatches);
		}

		return vecPreviousMatches.back();
	}

	std::string MakeWildcardWord(std::size_t unEncodedWord, const std::size_t unLength, std::string_view const strvAlphabet) {
		std::string strWord = std::string(unLength, '\0');
		for (auto& chCharacter : strWord) {
			chCharacter = strvAlphabet[unEncodedWord % strvAlphabet.size()];
			unEncodedWord /= strvAlphabet.size();
		}

		return strWord;
	}

	bool RunWildcardChecks() {
		constexpr std::size_t kMaximumOracleWordLength = 4;
		constexpr std::size_t kLongWildcardWordLength = 100000;
		constexpr char kPatternAlphabet[] = "ab*?";
		constexpr char kCandidateAlphabet[] = "ab?";

		std::size_t unPatternWordCount = 1;
		for (std::size_t unPatternLength = 0; unPatternLength <= kMaximumOracleWordLength; ++unPatternLength) {
			for (std::size_t unPatternWord = 0; unPatternWord < unPatternWordCount; ++unPatternWord) {
				std::string const strPattern = MakeWildcardWord(unPatternWord, unPatternLength, kPatternAlphabet);
				std::size_t unCandidateWordCount = 1;
				for (std::size_t unCandidateLength = 0; unCandidateLength <= kMaximumOracleWordLength; ++unCandidateLength) {
					for (std::size_t unCandidateWord = 0; unCandidateWord < unCandidateWordCount; ++unCandidateWord) {
						std::string const strCandidate = MakeWildcardWord(unCandidateWord, unCandidateLength, kCandidateAlphabet);
						if (!Check(SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(strPattern, strCandidate) == DoesWildcardOracleMatch(strPattern, strCandidate), "wildcard exhaustive independent oracle")) {
							return false;
						}
					}

					unCandidateWordCount *= sizeof(kCandidateAlphabet) - 1;
				}
			}

			unPatternWordCount *= sizeof(kPatternAlphabet) - 1;
		}

		std::string const strNullPattern = std::string("A") + '\0' + "B";
		std::string const strNullMismatch = std::string("A") + '\0' + "C";
		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(strNullPattern, strNullPattern) && !SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(strNullPattern, strNullMismatch), "wildcard embedded null direct")) {
			return false;
		}

		std::vector<std::string> const vecNullPatterns { strNullPattern };
		if (!Check(SourceJSAuthTextFiles::DoesAnyAuthenticationPermissionPatternMatch(vecNullPatterns, strNullPattern) && !SourceJSAuthTextFiles::DoesAnyAuthenticationPermissionPatternMatch(vecNullPatterns, strNullMismatch), "wildcard embedded null wrapper")) {
			return false;
		}

		std::string const strLongCandidate = std::string(kLongWildcardWordLength, 'a') + 'Z';
		std::string const strLongPattern = "*" + strLongCandidate;
		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(strLongPattern, strLongCandidate) && !SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(strLongCandidate, strLongCandidate + 'Q') && SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch(std::string(kLongWildcardWordLength, '*'), strLongCandidate), "wildcard long input without recursion")) {
			return false;
		}

		std::string const strMultilineCandidate = std::string("say\n") + '\0' + "done";
		if (!Check(!SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch("Admin.*", "admin.read") && SourceJSAuthTextFiles::DoesAuthenticationWildcardPatternMatch("say*done", strMultilineCandidate), "wildcard exact case and newline")) {
			return false;
		}

		return true;
	}

	bool DoesPermissionGraphOracleGrant(const std::size_t unEdges, const std::size_t unPermissions, const std::size_t unStartNode, const std::size_t unNodeCount) {
		std::vector<bool> vecVisited = std::vector<bool>(unNodeCount, false);
		std::vector<std::size_t> vecPendingNodes { unStartNode };
		while (!vecPendingNodes.empty()) {
			const std::size_t unNodeIndex = vecPendingNodes.back();
			vecPendingNodes.pop_back();

			if (vecVisited[unNodeIndex]) {
				continue;
			}

			vecVisited[unNodeIndex] = true;

			if ((unPermissions & (std::size_t(1) << unNodeIndex)) != 0) {
				return true;
			}

			for (std::size_t unParentIndex = 0; unParentIndex < unNodeCount; ++unParentIndex) {
				if ((unEdges & (std::size_t(1) << ((unNodeIndex * unNodeCount) + unParentIndex))) != 0) {
					vecPendingNodes.push_back(unParentIndex);
				}
			}
		}

		return false;
	}

	bool RunPermissionTraversalChecks() {
		constexpr char const* kNodeNames[] { "A", "B", "C" };
		constexpr std::size_t kNodeCount = sizeof(kNodeNames) / sizeof(kNodeNames[0]);
		constexpr std::size_t kEdgeVariantCount = std::size_t(1) << (kNodeCount * kNodeCount);
		constexpr std::size_t kPermissionVariantCount = std::size_t(1) << kNodeCount;
		constexpr std::size_t kDeepParentCount = 20000;

		for (std::size_t unEdges = 0; unEdges < kEdgeVariantCount; ++unEdges) {
			SourceJSAuthTextFiles::AuthenticationStateRecord State {};
			for (std::size_t unNodeIndex = 0; unNodeIndex < kNodeCount; ++unNodeIndex) {
				SourceJSAuthTextFiles::AuthenticationPermissionRecord& Record = State.m_mapParents[kNodeNames[unNodeIndex]];
				for (std::size_t unParentIndex = 0; unParentIndex < kNodeCount; ++unParentIndex) {
					if ((unEdges & (std::size_t(1) << ((unNodeIndex * kNodeCount) + unParentIndex))) != 0) {
						Record.m_vecParents.push_back(kNodeNames[unParentIndex]);
					}
				}
			}

			for (std::size_t unPermissions = 0; unPermissions < kPermissionVariantCount; ++unPermissions) {
				for (std::size_t unNodeIndex = 0; unNodeIndex < kNodeCount; ++unNodeIndex) {
					SourceJSAuthTextFiles::AuthenticationPermissionRecord& Record = State.m_mapParents[kNodeNames[unNodeIndex]];
					Record.m_vecPermissions.clear();

					if ((unPermissions & (std::size_t(1) << unNodeIndex)) != 0) {
						Record.m_vecPermissions.push_back("allowed");
					}
				}

				for (std::size_t unStartNode = 0; unStartNode < kNodeCount; ++unStartNode) {
					if (!Check(SourceJSAuthTextFiles::DoesAuthenticationParentHavePermission(State, kNodeNames[unStartNode], "allowed") == DoesPermissionGraphOracleGrant(unEdges, unPermissions, unStartNode, kNodeCount), "inheritance exhaustive graph oracle")) {
						return false;
					}
				}
			}
		}

		SourceJSAuthTextFiles::AuthenticationStateRecord State {};
		State.m_mapPlayers["Player"].m_vecParents = { "Branch", "Cycle" };
		State.m_mapParents["Branch"].m_vecParents = { "Missing", "Shared" };
		State.m_mapParents["Shared"].m_vecPermissions = { "normal.*" };
		State.m_mapParents["Shared"].m_vecParents = { "Cycle" };
		State.m_mapParents["Cycle"].m_vecParents = { "Branch" };
		State.m_mapParents["guest"].m_vecPermissions = { "guest.read" };
		State.m_mapPlayers["Shared"].m_vecPermissions = { "player.only" };
		State.m_vecSimpleAdministrators = { "Administrator" };
		std::vector<std::string> vecVisited {};
		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationPermissionRecordHavePermission(State, State.m_mapPlayers.at("Player"), "normal.write", vecVisited) && (vecVisited == std::vector<std::string> { "Branch", "Missing", "Shared" }), "inheritance depth-first visit order")) {
			return false;
		}

		vecVisited.clear();
		if (!Check(!SourceJSAuthTextFiles::DoesAuthenticationPermissionRecordHavePermission(State, State.m_mapPlayers.at("Player"), "denied", vecVisited) && (vecVisited == std::vector<std::string> { "Branch", "Missing", "Shared", "Cycle" }), "inheritance cycles and missing parents")) {
			return false;
		}

		vecVisited = { "Shared" };
		if (!Check(!SourceJSAuthTextFiles::DoesAuthenticationPermissionRecordHavePermission(State, State.m_mapPlayers.at("Player"), "normal.write", vecVisited) && (vecVisited == std::vector<std::string> { "Shared", "Branch", "Missing", "Cycle" }), "inheritance previously visited parent exclusion")) {
			return false;
		}

		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "Player", "normal.write") && SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "UnknownPlayer", "guest.read") && SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "Administrator", "arbitrary") && !SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "Administrator", ""), "inheritance player guest and administrator paths")) {
			return false;
		}

		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "Shared", "player.only") && !SourceJSAuthTextFiles::DoesAuthenticationPlayerHavePermission(State, "Shared", "normal.read") && SourceJSAuthTextFiles::DoesAuthenticationParentHavePermission(State, "Shared", "normal.read") && !SourceJSAuthTextFiles::DoesAuthenticationParentHavePermission(State, "Shared", "player.only"), "inheritance player and parent namespaces")) {
			return false;
		}

		SourceJSAuthTextFiles::AuthenticationStateRecord DeepState {};
		for (std::size_t unParentIndex = 0; unParentIndex < kDeepParentCount; ++unParentIndex) {
			std::string const strParentName = "Node" + std::to_string(unParentIndex);
			SourceJSAuthTextFiles::AuthenticationPermissionRecord& Record = DeepState.m_mapParents[strParentName];
			if ((unParentIndex + 1) < kDeepParentCount) {
				Record.m_vecParents.push_back("Node" + std::to_string(unParentIndex + 1));
			} else {
				Record.m_vecPermissions.push_back("deep.allowed");
				Record.m_vecParents.push_back("Node0");
			}
		}

		if (!Check(SourceJSAuthTextFiles::DoesAuthenticationParentHavePermission(DeepState, "Node0", "deep.allowed") && !SourceJSAuthTextFiles::DoesAuthenticationParentHavePermission(DeepState, "Node0", "deep.denied"), "inheritance deep cyclic chain without recursion")) {
			return false;
		}

		return true;
	}

	bool Run(std::filesystem::path const& PathRoot) {
		constexpr std::size_t kBinaryByteCount = 8192;
		constexpr std::size_t kEmbeddedNullIndex = 4095;

		std::filesystem::path const PathText = PathRoot / "nested" / "text.bin";
		std::string strBinary = std::string(kBinaryByteCount, 'Z');
		strBinary[kEmbeddedNullIndex] = '\0';
		strBinary.back() = '\n';
		if (!Check(SourceJSAuthTextFiles::WriteAuthenticationTextFile(PathText, strBinary), "write binary")) {
			return false;
		}

		std::string strReadText = "unchanged";
		if (!Check(SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathText, strReadText) && (strReadText == strBinary), "binary round trip")) {
			return false;
		}

		if (!Check(SourceJSAuthTextFiles::WriteAuthenticationTextFile(PathText, ""), "write empty")) {
			return false;
		}

		if (!Check(SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathText, strReadText) && strReadText.empty(), "read empty")) {
			return false;
		}

		strReadText = "unchanged";
		if (!Check(!SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathRoot / "missing.txt", strReadText) && (strReadText == "unchanged"), "missing read preserves output")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathRoot, strReadText) && (strReadText == "unchanged"), "directory read preserves output")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::WriteAuthenticationTextFile(PathRoot, "invalid"), "directory write")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::WriteAuthenticationTextFile(PathText / "child.txt", "invalid"), "parent is file")) {
			return false;
		}

		std::map<std::string, SourceJSAuthTextFiles::AuthenticationPermissionRecord> mapRecords {};
		mapRecords["B"].m_vecParents.push_back("A");
		mapRecords["A"].m_vecPermissions.push_back(std::string("say\"\n\t\\") + '\0');
		std::filesystem::path const PathJSON = PathRoot / "records.json";
		if (!Check(SourceJSAuthTextFiles::WriteAuthenticationJSONRecords(PathJSON, mapRecords), "write JSON")) {
			return false;
		}

		std::string const strExpectedJSON = "{\n\t\"A\": {\n\t\t\"Permissions\": [\"say\\\"\\n\\t\\\\\\u0000\"],\n\t\t\"Parents\": []\n\t},\n\t\"B\": {\n\t\t\"Permissions\": [],\n\t\t\"Parents\": [\"A\"]\n\t}\n}\n";
		if (!Check(SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathJSON, strReadText) && (strReadText == strExpectedJSON), "JSON format order and escaping")) {
			return false;
		}

		mapRecords.clear();
		if (!Check(SourceJSAuthTextFiles::WriteAuthenticationJSONRecords(PathJSON, mapRecords) && SourceJSAuthTextFiles::ReadAuthenticationTextFile(PathJSON, strReadText) && (strReadText == "{\n}\n"), "empty JSON map")) {
			return false;
		}

#if defined(__linux__)
		std::filesystem::path const PathFullDevice = "/dev/full";
		if (!Check(std::filesystem::is_character_file(PathFullDevice), "late-write failure device exists")) {
			return false;
		}

		if (!Check(!SourceJSAuthTextFiles::WriteAuthenticationTextFile(PathFullDevice, "late flush failure"), "late-write error")) {
			return false;
		}
#else
		std::cout << "AuthTextFiles late-write device check unavailable on this platform\n";
#endif

		if (!RunAuthSubjectLookupChecks() || !RunSQLCodecChecks() || !RunWildcardChecks() || !RunPermissionTraversalChecks()) {
			return false;
		}

		return true;
	}
} // namespace AuthTextFilesFixture

int main(const int nArgumentCount, char** const ppszArguments) {
	if (nArgumentCount != 2) {
		std::cerr << "Usage: AuthTextFiles <existing-fixture-directory>\n";
		return 2;
	}

	try {
		std::filesystem::path const PathRoot = ppszArguments[1];
		if (!std::filesystem::is_directory(PathRoot)) {
			std::cerr << "AuthTextFiles fixture directory missing\n";
			return 2;
		}

		if (!AuthTextFilesFixture::Run(PathRoot)) {
			return 1;
		}

		std::cout << "AuthTextFiles real native IO passed\n";

		return 0;
	} catch (std::exception const& Exception) {
		std::cerr << "AuthTextFiles failed Exception=\"" << Exception.what() << "\"\n";
		return 1;
	}
}
