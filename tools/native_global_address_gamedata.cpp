
// General
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_GLOBALADDRESS_TEST_DEFINED_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_GLOBALADDRESS_TEST_DEFINED_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_GLOBALADDRESS_TEST_DEFINED_NOMINMAX
#endif
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

// C++
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <utility>

// STL
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

// Project
#include "sourcejs/GlobalAddressGameData.h"

namespace {
	void Require(const bool bCondition, char const* const pszScenario) {
		if (!bCondition) {
			throw std::runtime_error(pszScenario);
		}
	}

	void RemoveFixturePath(std::filesystem::path const& PathEntry) noexcept {
		std::error_code ErrorCode {};
		// An absent path is valid when an earlier test failed before writing it.
		std::filesystem::remove(PathEntry, ErrorCode);

		if (!ErrorCode) {
			return;
		}
#if defined(_WIN32)
		std::fprintf(stderr, "GameDataFixture.RemovePath failed Error=0x%08X Path=\"%ls\"\n", static_cast<unsigned int>(ErrorCode.value()), PathEntry.c_str());
#else
		std::fprintf(stderr, "GameDataFixture.RemovePath failed Error=0x%08X Path=\"%s\"\n", static_cast<unsigned int>(ErrorCode.value()), PathEntry.c_str());
#endif
	}

	class GameDataFixture {
	public:
		GameDataFixture();
		GameDataFixture(GameDataFixture const&) = delete;
		~GameDataFixture() noexcept;

		GameDataFixture& operator=(GameDataFixture const&) = delete;
		void Write(std::string const& strText) const;
		std::filesystem::path const& GetPath() const noexcept;

	private:
		std::filesystem::path m_PathDirectory;
		std::filesystem::path m_PathFile;
	};

	GameDataFixture::GameDataFixture() {
#if defined(_WIN32)
		const unsigned long unProcessID = GetCurrentProcessId();
#else
		const pid_t nProcessID = getpid();
		const unsigned long unProcessID = static_cast<unsigned long>(nProcessID);
#endif
		m_PathDirectory = std::filesystem::temp_directory_path() / ("SourceJSGlobalAddressGameData-" + std::to_string(unProcessID));
		m_PathFile = m_PathDirectory / "GlobalAddresses.ini";
		Require(std::filesystem::create_directory(m_PathDirectory), "fixture directory must be newly owned");
	}

	GameDataFixture::~GameDataFixture() noexcept {
		// Remove only the two exact paths acquired by this fixture, never an arbitrary directory tree.
		RemoveFixturePath(m_PathFile);
		RemoveFixturePath(m_PathDirectory);
	}

	void GameDataFixture::Write(std::string const& strText) const {
		Require(std::in_range<std::streamsize>(strText.size()), "fixture size must fit the file stream");

		std::ofstream OutputStream(m_PathFile, std::ios::binary | std::ios::trunc);
		Require(OutputStream.is_open(), "open fixture");

		OutputStream.write(strText.data(), static_cast<std::streamsize>(strText.size()));
		OutputStream.close();
		Require(!OutputStream.fail(), "write fixture");
	}

	std::filesystem::path const& GameDataFixture::GetPath() const noexcept {
		return m_PathFile;
	}

	class MappedPages {
	public:
		explicit MappedPages(std::size_t unByteSize);
		MappedPages(MappedPages const&) = delete;
		~MappedPages() noexcept;

		MappedPages& operator=(MappedPages const&) = delete;
		void Protect(std::size_t unOffset, std::size_t unByteCount, bool bReadable) const;
		unsigned char* GetBytes() const noexcept;

	private:
		void* m_pMemory;
		std::size_t m_unByteSize;
	};

	MappedPages::MappedPages(const std::size_t unByteSize) :
		m_unByteSize(unByteSize)
	{
#if defined(_WIN32)
		m_pMemory = VirtualAlloc(nullptr, m_unByteSize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
		if (!m_pMemory) {
			const DWORD unError = GetLastError();
			throw std::system_error(static_cast<int>(unError), std::system_category(), "MappedPages.VirtualAlloc");
		}
#else
		m_pMemory = mmap(nullptr, m_unByteSize, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
		if (m_pMemory == MAP_FAILED) {
			const int nError = errno;
			throw std::system_error(nError, std::generic_category(), "MappedPages.mmap");
		}
#endif
	}

	MappedPages::~MappedPages() noexcept {
#if defined(_WIN32)
		if (!VirtualFree(m_pMemory, 0, MEM_RELEASE)) {
			const DWORD unError = GetLastError();
			std::fprintf(stderr, "MappedPages.Release failed Error=0x%08X Address=%p Size=%zu\n", static_cast<unsigned int>(unError), m_pMemory, m_unByteSize);
		}
#else
		if (munmap(m_pMemory, m_unByteSize) != 0) {
			const int nError = errno;
			std::fprintf(stderr, "MappedPages.Release failed Error=0x%08X Address=%p Size=%zu\n", static_cast<unsigned int>(nError), m_pMemory, m_unByteSize);
		}
#endif
	}

	unsigned char* MappedPages::GetBytes() const noexcept {
		return static_cast<unsigned char*>(m_pMemory);
	}

	void MappedPages::Protect(const std::size_t unOffset, const std::size_t unByteCount, const bool bReadable) const {
		Require((unOffset <= m_unByteSize) && (unByteCount <= (m_unByteSize - unOffset)), "protection extent");
#if defined(_WIN32)
		DWORD unOldProtection = 0;
		if (!VirtualProtect(GetBytes() + unOffset, unByteCount, bReadable ? PAGE_READONLY : PAGE_NOACCESS, &unOldProtection)) {
			const DWORD unError = GetLastError();
			throw std::system_error(static_cast<int>(unError), std::system_category(), "MappedPages.VirtualProtect");
		}
#else
		if (mprotect(GetBytes() + unOffset, unByteCount, bReadable ? PROT_READ : PROT_NONE) != 0) {
			const int nError = errno;
			throw std::system_error(nError, std::generic_category(), "MappedPages.mprotect");
		}
#endif
	}

	void CheckPackagedData(std::filesystem::path const& PathRepository) {
		constexpr std::ptrdiff_t kBMSWindowsOffset = 0x0B;
		constexpr std::ptrdiff_t kCSGOWindowsOffset = 0x08;
		constexpr std::ptrdiff_t kCSGOLinuxOffset = 0x0B;
		constexpr std::ptrdiff_t kGModWindowsOffset = 0x1A;
		constexpr std::ptrdiff_t kBladeWindowsOffset = 0x08;
		constexpr std::ptrdiff_t kL4D2WindowsOffset = 0x1B;
		constexpr std::ptrdiff_t kOrangeBoxWindowsOffset = 0x0B;

		std::filesystem::path const PathMemoryData = PathRepository / "packaging/runtime/addons/sourcejs/data/sourcejs/memory";
		SourceJS::GlobalAddressGameData GameData {};
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "csgo/GlobalAddresses.ini", "IServer", "windows", false, GameData), "packaged CSGO Windows record");
		Require((GameData.m_strBinaryName == "bin/engine") && GameData.m_bPattern && (GameData.m_nAddressOffset == kCSGOWindowsOffset) && (GameData.m_unDereferenceCount == 1), "CSGO Windows offset/indirection");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "csgo/GlobalAddresses.ini", "IServer", "linux", false, GameData), "packaged CSGO Linux record");
		Require(GameData.m_bPattern && (GameData.m_nAddressOffset == kCSGOLinuxOffset) && (GameData.m_unDereferenceCount == 1), "CSGO Linux offset/indirection");
		Require(!SourceJS::LoadGlobalAddressGameData(PathMemoryData / "csgo/GlobalAddresses.ini", "IServer", "linux", true, GameData), "reject packaged x86 pattern on x64");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "l4d2/GlobalAddresses.ini", "IServer", "linux", true, GameData), "native symbol can apply on x64");
		Require(!GameData.m_bPattern && (GameData.m_strIdentifier == "sv") && (GameData.m_nAddressOffset == 0) && (GameData.m_unDereferenceCount == 0), "packaged L4D2 symbol defaults");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "l4d2/GlobalAddresses.ini", "IServer", "windows", false, GameData) && (GameData.m_strBinaryName == "bin/engine") && GameData.m_bPattern && (GameData.m_nAddressOffset == kL4D2WindowsOffset) && (GameData.m_unDereferenceCount == 1), "packaged L4D2 Windows offset/indirection");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "gmod/GlobalAddresses.ini", "IServer", "windows", false, GameData) && (GameData.m_nAddressOffset == kGModWindowsOffset), "packaged GMod offset");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "blade/GlobalAddresses.ini", "IServer", "windows", false, GameData) && (GameData.m_nAddressOffset == kBladeWindowsOffset), "packaged Blade offset");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "orangebox/GlobalAddresses.ini", "CGlobalEntityList", "windows", false, GameData), "packaged OrangeBox Windows record");
		Require((GameData.m_strBinaryName == "server") && GameData.m_bPattern && (GameData.m_nAddressOffset == kOrangeBoxWindowsOffset) && (GameData.m_unDereferenceCount == 1), "OrangeBox Windows offset/indirection");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "orangebox/GlobalAddresses.ini", "CGlobalEntityList", "linux", true, GameData), "packaged OrangeBox Linux record");
		Require(!GameData.m_bPattern && (GameData.m_strIdentifier == "gEntList") && (GameData.m_nAddressOffset == 0) && (GameData.m_unDereferenceCount == 0), "OrangeBox Linux symbol defaults");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "bms/GlobalAddresses.ini", "CGlobalEntityList", "windows", false, GameData), "packaged BMS Windows record");
		Require((GameData.m_strBinaryName == "server") && GameData.m_bPattern && (GameData.m_nAddressOffset == kBMSWindowsOffset) && (GameData.m_unDereferenceCount == 1), "BMS Windows offset/indirection");
		Require(SourceJS::LoadGlobalAddressGameData(PathMemoryData / "bms/GlobalAddresses.ini", "CGlobalEntityList", "linux", true, GameData), "packaged BMS Linux record");
		Require(!GameData.m_bPattern && (GameData.m_strIdentifier == "gEntList") && (GameData.m_nAddressOffset == 0) && (GameData.m_unDereferenceCount == 0), "BMS Linux symbol defaults");
	}

	void CheckINI(GameDataFixture const& Fixture) {
		std::string const strRecord = "[IServer]\nbinary = bin/engine\nidentifier_linux = @sv\nidentifier_linux64 = @sv64\noffset = 3\noffset_linux = 4\noffset_linux64 = -0x8\nlevel = 0\nlevel_linux64 = 2\n";
		Fixture.Write(strRecord);
		SourceJS::GlobalAddressGameData GameData {};
		Require(SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", true, GameData), "select x64 record");
		Require((GameData.m_strIdentifier == "@sv64") && (GameData.m_nAddressOffset == -0x08) && (GameData.m_unDereferenceCount == 2), "architecture precedence");
		Require(SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData) && (GameData.m_nAddressOffset == 0x04), "platform precedence");

		std::string const arrInvalidRecords[] = {
			"[Other]\nbinary = engine\nidentifier = @sv\n",
			"[IServer]\nidentifier = @sv\n",
			strRecord + "offset = 8\n",
			strRecord + "[IServer]\nbinary = engine\nidentifier = @other\n",
			strRecord + "accessor = true\n",
			strRecord + "unknown = \"unterminated\n",
			strRecord + "invalid assignment\n",
		};
		for (auto const& strInvalidRecord : arrInvalidRecords) {
			Fixture.Write(strInvalidRecord);
			GameData.m_strIdentifier = "Unchanged";
			Require(!SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData) && (GameData.m_strIdentifier == "Unchanged"), "invalid INI preserves output");
		}

		std::string const arrInvalidOffsets[] = { "1trailing", "9223372036854775808", "-9223372036854775809", "+", "0x", "-+1" };
		for (auto const& strOffset : arrInvalidOffsets) {
			Fixture.Write("[IServer]\nbinary = engine\nidentifier = @sv\noffset = " + strOffset + "\n");
			Require(!SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData), "invalid offset rejected before narrowing");
		}

		Fixture.Write("[IServer]\nbinary = engine\nidentifier = @sv\noffset = 2147483648\n");
		Require(SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData) == (sizeof(std::ptrdiff_t) > sizeof(std::int32_t)), "offset respects native signed width");
		Fixture.Write("[IServer]\nbinary = engine\nidentifier = @sv\noffset = -0x8000000000000000\n");
		Require(SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData) == (sizeof(std::ptrdiff_t) == sizeof(std::int64_t)), "minimum signed value parsed without overflow");

		for (auto const& pszLevel : { "-1", "65", "2suffix" }) {
			Fixture.Write("[IServer]\nbinary = engine\nidentifier = @sv\nlevel = " + std::string(pszLevel) + "\n");
			Require(!SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData), "invalid indirection count");
		}

		Fixture.Write(std::string("[IServer]\nbinary = engine\nidentifier = @sv") + '\0' + "suffix\n");
		Require(!SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", false, GameData), "embedded NUL rejected");
		Fixture.Write("[IServer]\nbinary = engine\nidentifier_linux64 = \"AA 2A BB\" # comment\n");
		Require(SourceJS::LoadGlobalAddressGameData(Fixture.GetPath(), "IServer", "linux", true, GameData) && GameData.m_bPattern, "explicit x64 pattern and quoted value");
	}

	void CheckScanningAndTransform() {
		constexpr std::size_t kScanBoundaryByteCount = 65'536;
		constexpr std::size_t kBoundaryMarkerByteCount = 2;
		constexpr std::uintptr_t kOutputSentinel = 0x49;
		constexpr std::uintptr_t kInvalidAddress = 0x01;
		constexpr unsigned char kEmptyByte = 0x00;
		constexpr unsigned char kMarkerBytes[] = { 0xAA, 0x91, 0x00, 0xBC, 0xDD };

		std::vector<unsigned char> vecBytes((kScanBoundaryByteCount * 2) + sizeof(kMarkerBytes));
		std::memcpy(vecBytes.data() + kScanBoundaryByteCount - kBoundaryMarkerByteCount, kMarkerBytes, sizeof(kMarkerBytes));
		const std::uintptr_t unBeginAddress = reinterpret_cast<std::uintptr_t>(vecBytes.data());
		std::uintptr_t unAddress = kOutputSentinel;
		Require(SourceJS::ScanGlobalAddressGameDataPattern("AA 2A 00 BC DD", unBeginAddress, vecBytes.size(), unAddress) && (unAddress == (unBeginAddress + kScanBoundaryByteCount - kBoundaryMarkerByteCount)), "wildcard/NUL across scan chunk boundary");
		Require(SourceJS::ScanGlobalAddressGameDataPattern("\\xAA\\x2A\\x00\\xBC\\xDD", unBeginAddress, vecBytes.size(), unAddress), "escaped SourceMod bytes");
		Require(SourceJS::ScanGlobalAddressGameDataPattern("AA ?? 00 BC DD", unBeginAddress, vecBytes.size(), unAddress), "question-mark wildcard");
		Require(SourceJS::ScanGlobalAddressGameDataPattern("AA * 00 BC DD", unBeginAddress, vecBytes.size(), unAddress), "asterisk wildcard");

		std::fill(vecBytes.begin(), vecBytes.end(), kEmptyByte);
		std::memcpy(vecBytes.data() + kScanBoundaryByteCount + kBoundaryMarkerByteCount, kMarkerBytes, sizeof(kMarkerBytes));
		Require(SourceJS::ScanGlobalAddressGameDataPattern("AA 2A 00 BC DD", unBeginAddress, vecBytes.size(), unAddress) && (unAddress == (unBeginAddress + kScanBoundaryByteCount + kBoundaryMarkerByteCount)), "scan advancement does not skip overlap-tail candidates");

		std::string const arrInvalidPatterns[] = { "", " ", "AA Z1", "AA F", "0x", "?? 2A *", "\\xA", "EE 00 FF" };
		for (auto const& strPattern : arrInvalidPatterns) {
			unAddress = kOutputSentinel;
			Require(!SourceJS::ScanGlobalAddressGameDataPattern(strPattern, unBeginAddress, vecBytes.size(), unAddress) && (unAddress == kOutputSentinel), "invalid/missing pattern preserves output");
		}

		Require(!SourceJS::ScanGlobalAddressGameDataPattern("AA", std::numeric_limits<std::uintptr_t>::max(), 2, unAddress), "scan extent overflow");
		std::uintptr_t unTarget = unBeginAddress;
		std::uintptr_t unSlot = reinterpret_cast<std::uintptr_t>(&unTarget);
		std::memcpy(vecBytes.data() + 0x01, &unSlot, sizeof(unSlot));
		SourceJS::GlobalAddressGameData GameData {};
		GameData.m_nAddressOffset = 0x01;
		GameData.m_unDereferenceCount = 2;
		Require(SourceJS::ApplyGlobalAddressGameDataTransform(GameData, unBeginAddress, unAddress) && (unAddress == unTarget), "unaligned slot and two indirections");
		GameData.m_unDereferenceCount = 0;
		GameData.m_nAddressOffset = -0x01;
		Require(SourceJS::ApplyGlobalAddressGameDataTransform(GameData, unBeginAddress + 0x01, unAddress) && (unAddress == unBeginAddress), "negative offset");
		unAddress = kOutputSentinel;
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, kInvalidAddress, unAddress) && (unAddress == kOutputSentinel), "offset cannot produce null");
		GameData.m_nAddressOffset = std::numeric_limits<std::ptrdiff_t>::min();
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, kInvalidAddress, unAddress), "minimum signed offset has no negation overflow");
		GameData.m_nAddressOffset = 0x01;
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, std::numeric_limits<std::uintptr_t>::max(), unAddress), "offset overflow");
		GameData.m_nAddressOffset = 0;
		GameData.m_unDereferenceCount = 1;
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, kInvalidAddress, unAddress), "unmapped indirection returns false without fault");
		unTarget = 0;
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, reinterpret_cast<std::uintptr_t>(&unTarget), unAddress), "null indirection rejected");
	}

	void CheckProtectedPages() {
		constexpr std::size_t kPageCount = 3;
		constexpr std::size_t kLastPageIndex = kPageCount - 1;
		constexpr std::size_t kMarkerOffset = 0x20;
		constexpr std::size_t kMarkerPrefixByteCount = 2;
		constexpr std::uintptr_t kOutputSentinel = 0x49;
		constexpr unsigned char kMarkerBytes[] = { 0x81, 0xFA, 0x00, 0xAB };

#if defined(_WIN32)
		SYSTEM_INFO SystemInformation {};
		GetSystemInfo(&SystemInformation);
		const std::size_t unPageByteCount = SystemInformation.dwPageSize;
#else
		const long nPageByteCount = sysconf(_SC_PAGESIZE);
		if (nPageByteCount < 0) {
			const int nError = errno;
			throw std::system_error(nError, std::generic_category(), "CheckProtectedPages.sysconf");
		}

		Require(nPageByteCount > 0, "query page size");
		const std::size_t unPageByteCount = static_cast<std::size_t>(nPageByteCount);
#endif
		Require(unPageByteCount >= (kMarkerOffset + sizeof(kMarkerBytes)), "page must fit scan markers");
		Require(unPageByteCount <= (std::numeric_limits<std::size_t>::max() / kPageCount), "page mapping size must not overflow");
		const std::size_t unMappingByteCount = unPageByteCount * kPageCount;
		MappedPages Pages(unMappingByteCount);
		unsigned char* const punBytes = Pages.GetBytes();
		std::memcpy(punBytes + (unPageByteCount * kLastPageIndex) + kMarkerOffset, kMarkerBytes, sizeof(kMarkerBytes));
		std::memcpy(punBytes + unPageByteCount - kMarkerPrefixByteCount, kMarkerBytes, sizeof(kMarkerBytes));
		Pages.Protect(unPageByteCount, unPageByteCount, false);
		const std::uintptr_t unBeginAddress = reinterpret_cast<std::uintptr_t>(punBytes);
		std::uintptr_t unAddress = 0;
		Require(SourceJS::ScanGlobalAddressGameDataPattern("81 FA 00 AB", unBeginAddress, unMappingByteCount, unAddress) && (unAddress == (unBeginAddress + (unPageByteCount * kLastPageIndex) + kMarkerOffset)), "scan skips inaccessible gap");
		SourceJS::GlobalAddressGameData GameData {};
		GameData.m_unDereferenceCount = 1;
		unAddress = kOutputSentinel;
		Require(!SourceJS::ApplyGlobalAddressGameDataTransform(GameData, unBeginAddress + unPageByteCount - 0x01, unAddress) && (unAddress == kOutputSentinel), "complete indirection extent crossing inaccessible page preserves output");

		Pages.Protect(unPageByteCount, unPageByteCount, true);
		Require(SourceJS::ScanGlobalAddressGameDataPattern("81 FA 00 AB", unBeginAddress + unPageByteCount - kMarkerPrefixByteCount, sizeof(kMarkerBytes), unAddress) && (unAddress == (unBeginAddress + unPageByteCount - kMarkerPrefixByteCount)), "marker crossing contiguous mappings with different protections");
	}
} // namespace

int main(const int nArgumentCount, char** const ppszArguments) {
	constexpr int kArgumentCount = 2;

	if (nArgumentCount != kArgumentCount) {
		std::fputs("Usage: native_global_address_gamedata <Repository>\n", stderr);
		return 2;
	}

	try {
		CheckPackagedData(std::filesystem::path(ppszArguments[1]));
		GameDataFixture const Fixture {};
		CheckINI(Fixture);
		CheckScanningAndTransform();
		CheckProtectedPages();

		std::cout << "[native] packaged global-address INI, architecture, pattern, mapping, indirection and overflow scenarios passed\n";

		return 0;
	} catch (std::exception const& Exception) {
		std::cerr << "[native] global-address failure: " << Exception.what() << '\n';
		return 1;
	}
}
