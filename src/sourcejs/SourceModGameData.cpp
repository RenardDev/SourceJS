#include "sourcejs/SourceModGameData.h"

// C++
#include <cstddef>
#include <cstdint>

// STL
#include <array>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

// Third-party
#include <cpr/cpr.h>
#include <zlib.h>

// Project
#include "sourcejs/Log.h"

namespace SourceJS {

	namespace {

		constexpr char kArchiveURL[] = "https://codeload.github.com/alliedmodders/sourcemod/tar.gz/refs/heads/master";
		constexpr char kArchiveGameDataPrefix[] = "sourcemod-master/gamedata/";
		constexpr char kSnapshotName[] = "SourceMod";
		constexpr char kPreviousName[] = "SourceMod.Previous";
		constexpr char kStagingName[] = "SourceMod.Pending";
		constexpr char kSnapshotMarker[] = ".sourcejs-managed";
		constexpr int kConnectionTimeoutMilliseconds = 3000;
		constexpr int kDownloadTimeoutMilliseconds = 10000;
		constexpr std::size_t kMaximumDownloadBytes = 32 * 1024 * 1024;
		constexpr std::size_t kMaximumArchiveBytes = 96 * 1024 * 1024;
		constexpr std::size_t kMaximumFileBytes = 4 * 1024 * 1024;
		constexpr std::size_t kInflateBlockBytes = 64 * 1024;
		constexpr std::size_t kTarBlockBytes = 512;
		constexpr std::size_t kTarNameBytes = 100;
		constexpr std::size_t kTarSizeOffset = 124;
		constexpr std::size_t kTarSizeBytes = 12;
		constexpr std::size_t kTarTypeOffset = 156;
		constexpr std::size_t kTarPrefixOffset = 345;
		constexpr std::size_t kTarPrefixBytes = 155;
		constexpr int kZlibGzipWindow = 15 + 16;

		class InflateStream {
		public:
			InflateStream() noexcept;
			~InflateStream() noexcept;

			InflateStream(InflateStream const&) = delete;
			InflateStream& operator=(InflateStream const&) = delete;

			z_stream m_Stream;
			int m_nStatus;
		};

		InflateStream::InflateStream() noexcept :
			m_Stream {}
		{
			m_nStatus = inflateInit2(&m_Stream, kZlibGzipWindow);
		}

		InflateStream::~InflateStream() noexcept {
			if (m_nStatus == Z_OK) {
				inflateEnd(&m_Stream);
			}
		}

		class StagingDirectory {
		public:
			explicit StagingDirectory(std::filesystem::path const& PathDirectory);
			~StagingDirectory() noexcept;

			StagingDirectory(StagingDirectory const&) = delete;
			StagingDirectory& operator=(StagingDirectory const&) = delete;

			std::filesystem::path const& m_PathDirectory;
			bool m_bOwned;
		};

		StagingDirectory::StagingDirectory(std::filesystem::path const& PathDirectory) :
			m_PathDirectory(PathDirectory),
			m_bOwned(std::filesystem::create_directory(PathDirectory))
		{
		}

		StagingDirectory::~StagingDirectory() noexcept {
			if (!m_bOwned) {
				return;
			}

			try {
				std::error_code ErrorCode {};
				std::filesystem::remove_all(m_PathDirectory, ErrorCode);
				if (ErrorCode) {
					LogWarning("SourceMod GameData staging cleanup failed Error=0x%08X", static_cast<unsigned int>(ErrorCode.value()));
				}
			} catch (...) {
				LogWarning("SourceMod GameData staging cleanup failed.");
			}
		}

		bool DownloadArchive(std::string& strArchiveOut) {
			const auto AppendBytes = [&strArchiveOut](std::string_view const strvBytes, std::intptr_t) noexcept {
				if (strvBytes.size() > (kMaximumDownloadBytes - strArchiveOut.size())) {
					return false;
				}

				try {
					strArchiveOut.append(strvBytes);
				} catch (...) {
					return false;
				}

				return true;
			};
			cpr::Response const Response = cpr::Get(cpr::Url(kArchiveURL), cpr::Redirect(false), cpr::ConnectTimeout(kConnectionTimeoutMilliseconds), cpr::Timeout(kDownloadTimeoutMilliseconds), cpr::WriteCallback(AppendBytes));

			return (Response.status_code == 200) && (Response.error.code == cpr::ErrorCode::OK) && !strArchiveOut.empty();
		}

		bool ExpandArchive(std::string& strArchive, std::vector<char>& vecTarOut) {
			InflateStream Inflate {};
			if (Inflate.m_nStatus != Z_OK) {
				return false;
			}

			Inflate.m_Stream.next_in = reinterpret_cast<unsigned char*>(strArchive.data());
			Inflate.m_Stream.avail_in = static_cast<uInt>(strArchive.size());
			std::array<unsigned char, kInflateBlockBytes> arrBlock {};
			while (true) {
				Inflate.m_Stream.next_out = arrBlock.data();
				Inflate.m_Stream.avail_out = static_cast<uInt>(arrBlock.size());
				const int nStatus = inflate(&Inflate.m_Stream, Z_NO_FLUSH);
				const std::size_t unWritten = arrBlock.size() - Inflate.m_Stream.avail_out;
				if (((nStatus != Z_OK) && (nStatus != Z_STREAM_END)) || (unWritten > (kMaximumArchiveBytes - vecTarOut.size()))) {
					return false;
				}

				char const* const pchBytes = reinterpret_cast<char const*>(arrBlock.data());
				vecTarOut.insert(vecTarOut.end(), pchBytes, pchBytes + unWritten);
				if (nStatus == Z_STREAM_END) {
					return Inflate.m_Stream.avail_in == 0;
				}
			}
		}

		std::string_view ReadTarField(std::string_view const strvHeader, const std::size_t unOffset, const std::size_t unLength) {
			std::string_view const strvField = strvHeader.substr(unOffset, unLength);

			return strvField.substr(0, strvField.find('\0'));
		}

		bool ReadTarSize(std::string_view const strvField, std::size_t& unSizeOut) {
			std::size_t unSize = 0;
			if (strvField.empty()) {
				return false;
			}

			for (auto const& chDigit : strvField) {
				if ((chDigit < '0') || (chDigit > '7') || (unSize > (kMaximumArchiveBytes / 8))) {
					return false;
				}

				unSize = (unSize * 8) + static_cast<std::size_t>(chDigit - '0');
			}

			unSizeOut = unSize;

			return true;
		}

		bool IsSafeGameDataPath(std::string_view strvPath) {
			if (!strvPath.ends_with(".txt")) {
				return false;
			}

			while (!strvPath.empty()) {
				const std::size_t unSeparator = strvPath.find('/');
				std::string_view const strvComponent = strvPath.substr(0, unSeparator);
				if (strvComponent.empty() || (strvComponent.front() == '.') || (strvComponent.back() == '.')) {
					return false;
				}

				for (auto const& chCharacter : strvComponent) {
					if (!((chCharacter >= 'a') && (chCharacter <= 'z')) && !((chCharacter >= '0') && (chCharacter <= '9')) && (chCharacter != '.') && (chCharacter != '-') && (chCharacter != '_')) {
						return false;
					}
				}

				// Windows reserves device names even when they have an extension.
				std::string_view const strvStem = strvComponent.substr(0, strvComponent.find('.'));
				if ((strvStem == "con") || (strvStem == "prn") || (strvStem == "aux") || (strvStem == "nul") || ((strvStem.size() == 4) && (strvStem.starts_with("com") || strvStem.starts_with("lpt")) && (strvStem.back() >= '0') && (strvStem.back() <= '9'))) {
					return false;
				}

				if (unSeparator == std::string_view::npos) {
					return true;
				}

				strvPath.remove_prefix(unSeparator + 1);
			}

			return false;
		}

		bool WriteGameDataFile(std::filesystem::path const& PathFile, std::string_view const strvContents) {
			std::filesystem::create_directories(PathFile.parent_path());

			std::ofstream FileStream(PathFile, std::ios::binary);
			FileStream.write(strvContents.data(), static_cast<std::streamsize>(strvContents.size()));
			FileStream.close();

			return FileStream.good();
		}

		bool InstallArchiveFiles(std::vector<char> const& vecTar, std::filesystem::path const& PathStaging) {
			std::string_view const strvTar(vecTar.data(), vecTar.size());
			std::unordered_set<std::string> usetWritten {};
			std::size_t unOffset = 0;
			while ((strvTar.size() - unOffset) >= kTarBlockBytes) {
				std::string_view const strvHeader = strvTar.substr(unOffset, kTarBlockBytes);
				if (strvHeader.find_first_not_of('\0') == std::string_view::npos) {
					return ((strvTar.size() - unOffset) >= (2 * kTarBlockBytes)) && (strvTar.find_first_not_of('\0', unOffset) == std::string_view::npos) && usetWritten.contains("sdktools.games/master.games.txt") && usetWritten.contains("core.games/master.games.txt");
				}

				std::size_t unSize = 0;
				if (!ReadTarSize(ReadTarField(strvHeader, kTarSizeOffset, kTarSizeBytes), unSize)) {
					return false;
				}

				unOffset += kTarBlockBytes;
				const std::size_t unPaddedSize = ((unSize + kTarBlockBytes - 1) / kTarBlockBytes) * kTarBlockBytes;
				if (unPaddedSize > (strvTar.size() - unOffset)) {
					return false;
				}

				std::string strName = std::string(ReadTarField(strvHeader, 0, kTarNameBytes));
				std::string_view const strvPrefix = ReadTarField(strvHeader, kTarPrefixOffset, kTarPrefixBytes);
				if (!strvPrefix.empty()) {
					strName = std::string(strvPrefix) + '/' + strName;
				}

				if (strName.starts_with(kArchiveGameDataPrefix) && (strvHeader[kTarTypeOffset] != '5')) {
					std::string_view const strvRelativePath = std::string_view(strName).substr(sizeof(kArchiveGameDataPrefix) - 1);
					const char chType = strvHeader[kTarTypeOffset];
					if (((chType != '0') && (chType != '\0')) || (unSize == 0) || (unSize > kMaximumFileBytes) || !IsSafeGameDataPath(strvRelativePath) || !usetWritten.emplace(strvRelativePath).second || !WriteGameDataFile(PathStaging / strvRelativePath, strvTar.substr(unOffset, unSize))) {
						return false;
					}
				}

				unOffset += unPaddedSize;
			}

			return false;
		}

		bool IsManagedSnapshot(std::filesystem::path const& PathDirectory) {
			std::error_code ErrorCode {};
			if (!std::filesystem::is_directory(std::filesystem::symlink_status(PathDirectory, ErrorCode))) {
				return false;
			}

			return std::filesystem::is_regular_file(std::filesystem::symlink_status(PathDirectory / kSnapshotMarker, ErrorCode));
		}

		bool PublishSnapshot(std::filesystem::path const& PathRoot, StagingDirectory& Staging) {
			std::filesystem::path const PathCurrent = PathRoot / kSnapshotName;
			std::filesystem::path const PathPrevious = PathRoot / kPreviousName;
			const bool bCurrentExists = std::filesystem::exists(std::filesystem::symlink_status(PathCurrent));
			const bool bPreviousExists = std::filesystem::exists(std::filesystem::symlink_status(PathPrevious));
			if ((bCurrentExists && !IsManagedSnapshot(PathCurrent)) || (bPreviousExists && !IsManagedSnapshot(PathPrevious))) {
				return false;
			}

			if (bCurrentExists) {
				if (bPreviousExists) {
					std::filesystem::remove_all(PathPrevious);
				}

				std::filesystem::rename(PathCurrent, PathPrevious);
			}

			// Readers can still use Previous if the last rename fails or the process stops here.
			std::filesystem::rename(Staging.m_PathDirectory, PathCurrent);
			Staging.m_bOwned = false;

			return true;
		}
	} // namespace

	void RefreshSourceModGameData(std::filesystem::path const& PathGameDataRoot) noexcept {
		try {
			std::filesystem::create_directories(PathGameDataRoot);
			std::filesystem::path const PathRoot = std::filesystem::canonical(PathGameDataRoot);
			std::filesystem::path const PathStaging = PathRoot / kStagingName;
			StagingDirectory Staging(PathStaging);
			if (!Staging.m_bOwned) {
				LogWarning("SourceMod GameData refresh skipped: staging directory already exists.");
				return;
			}

			std::string strArchive {};
			std::vector<char> vecTar {};
			if (!DownloadArchive(strArchive) || !ExpandArchive(strArchive, vecTar) || !InstallArchiveFiles(vecTar, PathStaging) || !WriteGameDataFile(PathStaging / kSnapshotMarker, "SourceJS\n") || !PublishSnapshot(PathRoot, Staging)) {
				LogWarning("SourceMod GameData refresh failed; retaining the previous or packaged snapshot.");
				return;
			}

			LogInfo("SourceMod GameData refresh succeeded.");
		} catch (...) {
			LogWarning("SourceMod GameData refresh failed; retaining the previous or packaged snapshot.");
		}
	}

	std::filesystem::path GetSourceModGameDataRoot(std::filesystem::path const& PathGameDataRoot) {
		std::filesystem::path const PathCurrent = PathGameDataRoot / kSnapshotName;
		if (IsManagedSnapshot(PathCurrent)) {
			return PathCurrent;
		}

		std::filesystem::path const PathPrevious = PathGameDataRoot / kPreviousName;
		if (IsManagedSnapshot(PathPrevious)) {
			return PathPrevious;
		}

		return {};
	}

	bool IsSourceModGameDataStorageDirectory(std::filesystem::path const& PathDirectory) {
		std::filesystem::path const PathName = PathDirectory.filename();

		return (PathName == kSnapshotName) || (PathName == kPreviousName) || (PathName == kStagingName);
	}
} // namespace SourceJS
