
// General
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_MEMORY_BINARY_FIXTURE_UNDEFINE_NOMINMAX
#endif
#include <Windows.h>
#include <TlHelp32.h>
#if defined(SOURCEJS_MEMORY_BINARY_FIXTURE_UNDEFINE_NOMINMAX)
#undef SOURCEJS_MEMORY_BINARY_FIXTURE_UNDEFINE_NOMINMAX
#undef NOMINMAX
#endif
#else
#include <dlfcn.h>
#include <elf.h>
#include <fcntl.h>
#include <link.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

// C++
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <utility>

// STL
#include <algorithm>
#include <array>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace {

	constinit bool g_bFailCollection = false;
	constinit bool g_bLibraryCloseFailed = false;

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	// Actual helpers; the runner adds one controlled throw before each platform's
	// vector insertion. This is not a real allocation-failure or SDK/engine test.
	// SOURCEJS_MEMORY_BINARY_HELPERS

	class FixtureLibrary {
	public:
		explicit FixtureLibrary(std::filesystem::path const& PathLibrary);
		~FixtureLibrary() noexcept;
		FixtureLibrary(FixtureLibrary const&) = delete;
		FixtureLibrary(FixtureLibrary&&) = delete;
		FixtureLibrary& operator=(FixtureLibrary const&) = delete;
		FixtureLibrary& operator=(FixtureLibrary&&) = delete;

		std::uintptr_t GetProbeAddress() const;
#if !defined(_WIN32)
		std::uintptr_t GetHiddenAddress() const;
#endif

	private:
#if defined(_WIN32)
		HMODULE m_hLibrary;
#else
		void* m_hLibrary;
#endif
	};

	FixtureLibrary::FixtureLibrary(std::filesystem::path const& PathLibrary) {
#if defined(_WIN32)
		m_hLibrary = LoadLibraryA(PathLibrary.string().c_str());
#else
		m_hLibrary = dlopen(PathLibrary.string().c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
		Require(m_hLibrary != nullptr, "Load fixture library");
	}

	FixtureLibrary::~FixtureLibrary() noexcept {
		if (!m_hLibrary) {
			return;
		}

#if defined(_WIN32)
		g_bLibraryCloseFailed = FreeLibrary(m_hLibrary) == FALSE;
#else
		g_bLibraryCloseFailed = dlclose(m_hLibrary) != 0;
#endif
	}

	std::uintptr_t FixtureLibrary::GetProbeAddress() const {
#if defined(_WIN32)
		FARPROC const Probe = GetProcAddress(m_hLibrary, "SourceJSNativeBinaryProbe");
		Require(Probe != nullptr, "Resolve fixture export directly");

		return reinterpret_cast<std::uintptr_t>(Probe);
#else
		void* const pProbe = dlsym(m_hLibrary, "SourceJSNativeBinaryProbe");
		Require(pProbe != nullptr, "Resolve fixture export directly");

		return reinterpret_cast<std::uintptr_t>(pProbe);
#endif
	}

#if !defined(_WIN32)
	std::uintptr_t FixtureLibrary::GetHiddenAddress() const {
		using fnGetHiddenAddress = void*(*)() noexcept;

		Require(dlsym(m_hLibrary, "g_nSourceJSHiddenBinaryProbe") == nullptr, "The fixture object is not a dynamic export");

		void* const pGetterAddress = dlsym(m_hLibrary, "SourceJSNativeBinaryHiddenAddress");
		Require(pGetterAddress != nullptr, "Resolve the independent hidden-address oracle");
		fnGetHiddenAddress const GetAddress = reinterpret_cast<fnGetHiddenAddress>(pGetterAddress);

		return reinterpret_cast<std::uintptr_t>(GetAddress());
	}
#endif

	void CheckLibraryLookup(std::filesystem::path const& PathLibrary) {
		constexpr std::uintptr_t kUnchangedAddress = 0xA5;

		std::string const strLibraryName = PathLibrary.filename().string();

		{
			FixtureLibrary const Library(PathLibrary);
			const std::uintptr_t unExpectedAddress = Library.GetProbeAddress();

			MemoryManagerBinaryInformation BinaryInformation {};
			Require(FindMemoryManagerBinary(strLibraryName, BinaryInformation), "Find real loaded fixture library");
			Require((BinaryInformation.m_strName == strLibraryName) && (BinaryInformation.m_unBaseAddress != 0) && (BinaryInformation.m_unByteSize > 0), "Read real OS binary metadata");
			Require((unExpectedAddress >= BinaryInformation.m_unBaseAddress) && ((unExpectedAddress - BinaryInformation.m_unBaseAddress) < BinaryInformation.m_unByteSize), "Real exported probe is inside the reported binary range");
			Require(DoesMemoryManagerBinaryMatch(BinaryInformation, ConvertMemoryManagerStringToLowercase(strLibraryName)), "Match loaded library name");
			Require(DoesMemoryManagerBinaryMatch(BinaryInformation, ConvertMemoryManagerStringToLowercase(PathLibrary.stem().string())), "Match loaded library stem");
			Require(!DoesMemoryManagerBinaryMatch(BinaryInformation, "SourceJSMissingLibrary_7A04"), "Reject an unrelated library name");

			std::uintptr_t unSymbolAddress = kUnchangedAddress;
			Require(ResolveMemoryManagerSymbol(strLibraryName, "SourceJSNativeBinaryProbe", unSymbolAddress) && (unSymbolAddress == unExpectedAddress), "Resolve real loaded library export");

#if !defined(_WIN32)
			unSymbolAddress = kUnchangedAddress;
			Require(ResolveMemoryManagerSymbol(strLibraryName, "g_nSourceJSHiddenBinaryProbe", unSymbolAddress) && (unSymbolAddress == Library.GetHiddenAddress()), "Resolve the real local ELF object using its loaded relocation bias");
#endif

			unSymbolAddress = kUnchangedAddress;
			Require(!ResolveMemoryManagerSymbol(strLibraryName, "SourceJSMissingExport_7A04", unSymbolAddress) && (unSymbolAddress == kUnchangedAddress), "Failed symbol lookup preserves output");

			Require(!ResolveMemoryManagerSymbol(strLibraryName, "", unSymbolAddress) && (unSymbolAddress == kUnchangedAddress), "Empty symbol lookup preserves output");

			Require(!ResolveMemoryManagerSymbol("SourceJSMissingLibrary_7A04", "SourceJSNativeBinaryProbe", unSymbolAddress) && (unSymbolAddress == kUnchangedAddress), "Missing library lookup preserves output");
		}

		Require(!g_bLibraryCloseFailed, "Close fixture owner successfully");
#if defined(_WIN32)
		Require(GetModuleHandleA(strLibraryName.c_str()) == nullptr, "Borrowed lookup does not retain the fixture library");
#else
#if defined(RTLD_NOLOAD)
		void* const hRemainingLibrary = dlopen(PathLibrary.string().c_str(), RTLD_NOW | RTLD_LOCAL | RTLD_NOLOAD);
		if (hRemainingLibrary) {
			dlclose(hRemainingLibrary);
			Require(false, "Symbol lookup releases its owned dlopen reference");
		}
#endif
		std::uintptr_t unDefaultSymbolAddress = 0;
		Require(ResolveMemoryManagerSymbol("", "malloc", unDefaultSymbolAddress) && (unDefaultSymbolAddress != 0), "Resolve a real process-scope symbol without closing RTLD_DEFAULT");
#endif
	}

	void CheckCollectionFailure() {
		bool bCaught = false;
		g_bFailCollection = true;

		try {
			CollectMemoryManagerBinaries();
		} catch (std::runtime_error const&) {
			bCaught = true;
		}

		g_bFailCollection = false;

		Require(bCaught, "Report controlled collection failure after leaving the C loader callback");
		Require(!CollectMemoryManagerBinaries().empty(), "Collect real loaded libraries after the failure");
	}

#if !defined(_WIN32)
	void CheckELFImageSnapshot(std::filesystem::path const& PathLibrary) {
		std::filesystem::path const PathImage = PathLibrary.parent_path() / "ELFImageSnapshot.bin";
		std::filesystem::path const PathReplacement = PathLibrary.parent_path() / "ELFImageReplacement.bin";
		{
			std::ofstream ImageStream(PathImage, std::ios::binary);
			ImageStream.write("ELF1", 4);
			Require(static_cast<bool>(ImageStream), "Write an ELF snapshot test image");
		}

		auto const pFirst = ReadMemoryManagerELFImage(PathImage.string());
		auto const pRepeated = ReadMemoryManagerELFImage(PathImage.string());
		Require(pFirst && (pFirst == pRepeated) && (pFirst->back() == '1'), "Repeated access shares immutable image bytes");
		{
			std::ofstream ImageStream(PathReplacement, std::ios::binary);
			ImageStream.write("ELF2", 4);
			Require(static_cast<bool>(ImageStream), "Write a replacement ELF snapshot test image");
		}

		std::filesystem::last_write_time(PathReplacement, std::filesystem::last_write_time(PathImage));
		std::filesystem::rename(PathReplacement, PathImage);
		auto const pReplaced = ReadMemoryManagerELFImage(PathImage.string());
		Require(pReplaced && (pReplaced != pFirst) && (pReplaced->back() == '2') && (pFirst->back() == '1'), "Replacing a same-sized file invalidates its snapshot without changing borrowed bytes");
		Require(std::filesystem::remove(PathImage), "Remove the snapshot test image");
		Require(!ReadMemoryManagerELFImage(PathImage.string()), "A deleted ELF image does not yield cached data");
	}

	template <typename TRecord>
	void StoreFixtureELFRecord(std::vector<unsigned char>& vecBytes, const std::uint64_t unOffset, TRecord const& Record) {
		static_assert(std::is_trivially_copyable_v<TRecord>);

		Require(IsMemoryManagerELFRangeValid(vecBytes, unOffset, 1, sizeof(Record)), "Fixture record write stays within its image");
		std::memcpy(vecBytes.data() + static_cast<std::size_t>(unOffset), &Record, sizeof(Record));
	}

	void CheckELFSymbolImage() {
		constexpr std::uintptr_t kUnchangedAddress = 0xA5;
		constexpr std::uintptr_t kLoadedBaseAddress = 0x100000;
		constexpr ElfW(Addr) kVirtualBaseAddress = 0x4000;
		constexpr ElfW(Addr) kSymbolOffset = 0x8;
		constexpr std::size_t kLoadedByteSize = 0x100;
		constexpr std::size_t kX64AddressByteSize = 0x8;
		constexpr std::size_t kProgramHeaderCount = 1;
		constexpr std::size_t kSectionCount = 4;
		constexpr std::size_t kNullSectionIndex = 0;
		constexpr std::size_t kAllocatedSectionIndex = 1;
		constexpr std::size_t kStringTableSectionIndex = 2;
		constexpr std::size_t kSymbolTableSectionIndex = 3;
		constexpr std::size_t kSymbolCount = 3;
		constexpr std::size_t kDuplicateSymbolIndex = 2;
		constexpr ElfW(Word) kSymbolNameOffset = 0x1;
		constexpr char kSymbolNames[] = "\0SourceJSHidden";
		constexpr char kSymbolName[] = "SourceJSHidden";
		constexpr std::size_t kSectionTableOffset = sizeof(ElfW(Ehdr)) + sizeof(ElfW(Phdr));
		constexpr std::size_t kSymbolTableOffset = kSectionTableOffset + (kSectionCount * sizeof(ElfW(Shdr)));
		constexpr std::size_t kStringTableOffset = kSymbolTableOffset + (kSymbolCount * sizeof(ElfW(Sym)));

		MemoryManagerBinaryInformation BinaryInformation {};
		BinaryInformation.m_unBaseAddress = kLoadedBaseAddress;
		BinaryInformation.m_unByteSize = kLoadedByteSize;

		ElfW(Ehdr) Header {};
		std::memcpy(Header.e_ident, ELFMAG, SELFMAG);
		Header.e_ident[EI_CLASS] = (sizeof(std::uintptr_t) == kX64AddressByteSize) ? ELFCLASS64 : ELFCLASS32;
		Header.e_ident[EI_DATA] = ELFDATA2LSB;
		Header.e_ident[EI_VERSION] = EV_CURRENT;
		Header.e_machine = (sizeof(std::uintptr_t) == kX64AddressByteSize) ? EM_X86_64 : EM_386;
		Header.e_type = ET_DYN;
		Header.e_version = EV_CURRENT;
		Header.e_ehsize = sizeof(Header);
		Header.e_phoff = sizeof(Header);
		Header.e_phentsize = sizeof(ElfW(Phdr));
		Header.e_phnum = kProgramHeaderCount;
		Header.e_shoff = kSectionTableOffset;
		Header.e_shentsize = sizeof(ElfW(Shdr));
		Header.e_shnum = kSectionCount;

		ElfW(Phdr) ProgramHeader {};
		ProgramHeader.p_type = PT_LOAD;
		ProgramHeader.p_flags = PF_R | PF_X;
		ProgramHeader.p_vaddr = kVirtualBaseAddress;
		ProgramHeader.p_memsz = kLoadedByteSize;

		std::array<ElfW(Shdr), kSectionCount> arrSections {};
		arrSections[kAllocatedSectionIndex].sh_type = SHT_NOBITS;
		arrSections[kAllocatedSectionIndex].sh_addr = kVirtualBaseAddress;
		arrSections[kAllocatedSectionIndex].sh_flags = SHF_ALLOC;
		arrSections[kAllocatedSectionIndex].sh_size = kLoadedByteSize;
		arrSections[kStringTableSectionIndex].sh_type = SHT_STRTAB;
		arrSections[kStringTableSectionIndex].sh_offset = kStringTableOffset;
		arrSections[kStringTableSectionIndex].sh_size = sizeof(kSymbolNames);
		arrSections[kSymbolTableSectionIndex].sh_type = SHT_SYMTAB;
		arrSections[kSymbolTableSectionIndex].sh_offset = kSymbolTableOffset;
		arrSections[kSymbolTableSectionIndex].sh_size = kSymbolCount * sizeof(ElfW(Sym));
		arrSections[kSymbolTableSectionIndex].sh_entsize = sizeof(ElfW(Sym));
		arrSections[kSymbolTableSectionIndex].sh_link = kStringTableSectionIndex;

		ElfW(Sym) Symbol {};
		Symbol.st_name = kSymbolNameOffset;
		Symbol.st_info = ELF64_ST_INFO(STB_LOCAL, STT_OBJECT);
		Symbol.st_shndx = kAllocatedSectionIndex;
		Symbol.st_value = kVirtualBaseAddress + kSymbolOffset;
		Symbol.st_size = sizeof(int);

		std::vector<unsigned char> vecBytes(kStringTableOffset + sizeof(kSymbolNames));
		StoreFixtureELFRecord(vecBytes, 0, Header);
		StoreFixtureELFRecord(vecBytes, Header.e_phoff, ProgramHeader);

		for (std::size_t unSectionIndex = 0; unSectionIndex < arrSections.size(); ++unSectionIndex) {
			StoreFixtureELFRecord(vecBytes, kSectionTableOffset + (unSectionIndex * sizeof(ElfW(Shdr))), arrSections[unSectionIndex]);
		}

		StoreFixtureELFRecord(vecBytes, kSymbolTableOffset + sizeof(Symbol), Symbol);
		StoreFixtureELFRecord(vecBytes, kSymbolTableOffset + (kDuplicateSymbolIndex * sizeof(Symbol)), Symbol);
		std::memcpy(vecBytes.data() + kStringTableOffset, kSymbolNames, sizeof(kSymbolNames));
		std::uintptr_t unAddress = kUnchangedAddress;
		Require(ResolveMemoryManagerELFImageSymbol(vecBytes, BinaryInformation, kSymbolName, unAddress) && (unAddress == (kLoadedBaseAddress + kSymbolOffset)), "Local ELF symbol uses nonzero minimum PT_LOAD VA; same-address duplicates are allowed");

		const auto CheckMemberSymbol = [&]() {
			constexpr char kMemberNames[] = "\0_ZN10TestPlayer6IgniteEfbfb";
			constexpr std::uintptr_t kMemberAddress = kLoadedBaseAddress + kSymbolOffset;

			std::vector<unsigned char> vecMemberImage = vecBytes;
			vecMemberImage.resize(kStringTableOffset + sizeof(kMemberNames));
			std::memcpy(vecMemberImage.data() + kStringTableOffset, kMemberNames, sizeof(kMemberNames));
			ElfW(Shdr) MemberNames = arrSections[kStringTableSectionIndex];
			MemberNames.sh_size = sizeof(kMemberNames);
			StoreFixtureELFRecord(vecMemberImage, kSectionTableOffset + (kStringTableSectionIndex * sizeof(ElfW(Shdr))), MemberNames);
			ElfW(Shdr) CodeSection = arrSections[kAllocatedSectionIndex];
			CodeSection.sh_flags |= SHF_EXECINSTR;
			StoreFixtureELFRecord(vecMemberImage, kSectionTableOffset + (kAllocatedSectionIndex * sizeof(ElfW(Shdr))), CodeSection);
			ElfW(Sym) MemberSymbol = Symbol;
			MemberSymbol.st_info = ELF64_ST_INFO(STB_LOCAL, STT_FUNC);
			StoreFixtureELFRecord(vecMemberImage, kSymbolTableOffset + sizeof(Symbol), MemberSymbol);

			std::uintptr_t unMemberAddress = kUnchangedAddress;
			Require(ResolveMemoryManagerELFImageSymbol(vecMemberImage, BinaryInformation, "6IgniteEfbfb", unMemberAddress, kMemberAddress) && (unMemberAddress == kMemberAddress), "Verify the member function by both signature and virtual entry address");

			unMemberAddress = kUnchangedAddress;
			Require(!ResolveMemoryManagerELFImageSymbol(vecMemberImage, BinaryInformation, "6IgniteEf", unMemberAddress, kMemberAddress) && (unMemberAddress == kUnchangedAddress), "Reject a different argument list");
			Require(!ResolveMemoryManagerELFImageSymbol(vecMemberImage, BinaryInformation, "6IgniteEfbfb", unMemberAddress, kMemberAddress + 1) && (unMemberAddress == kUnchangedAddress), "Reject an incorrect virtual entry");
			StoreFixtureELFRecord(vecMemberImage, kSectionTableOffset + (kAllocatedSectionIndex * sizeof(ElfW(Shdr))), arrSections[kAllocatedSectionIndex]);
			Require(!ResolveMemoryManagerELFImageSymbol(vecMemberImage, BinaryInformation, "6IgniteEfbfb", unMemberAddress, kMemberAddress) && (unMemberAddress == kUnchangedAddress), "Reject a function symbol in a non-executable section");
			StoreFixtureELFRecord(vecMemberImage, kSectionTableOffset + (kAllocatedSectionIndex * sizeof(ElfW(Shdr))), CodeSection);
			ElfW(Phdr) NonExecutableSegment = ProgramHeader;
			NonExecutableSegment.p_flags = PF_R;
			StoreFixtureELFRecord(vecMemberImage, Header.e_phoff, NonExecutableSegment);
			Require(!ResolveMemoryManagerELFImageSymbol(vecMemberImage, BinaryInformation, "6IgniteEfbfb", unMemberAddress, kMemberAddress) && (unMemberAddress == kUnchangedAddress), "Reject a function symbol in a non-executable load segment");
		};
		CheckMemberSymbol();

		auto const RequireRejected = [&BinaryInformation, &kSymbolName](std::vector<unsigned char> const& vecImage) {
			std::uintptr_t unRejectedAddress = kUnchangedAddress;
			Require(!ResolveMemoryManagerELFImageSymbol(vecImage, BinaryInformation, kSymbolName, unRejectedAddress) && (unRejectedAddress == kUnchangedAddress), "Malformed/unsupported ELF image preserves output");
		};

		for (std::size_t unByteCount = 0; unByteCount < vecBytes.size(); ++unByteCount) {
			std::vector<unsigned char> const vecTruncated(vecBytes.begin(), vecBytes.begin() + unByteCount);
			RequireRejected(vecTruncated);
		}

		auto const CheckHeader = [&vecBytes, &RequireRejected](ElfW(Ehdr) const& InvalidHeader) {
			std::vector<unsigned char> vecInvalid = vecBytes;
			StoreFixtureELFRecord(vecInvalid, 0, InvalidHeader);
			RequireRejected(vecInvalid);
		};

		ElfW(Ehdr) InvalidHeader = Header;
		InvalidHeader.e_ident[EI_CLASS] = ELFCLASSNONE;
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_ident[EI_DATA] = ELFDATA2MSB;
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_machine = EM_NONE;
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_type = ET_REL;
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_shoff = std::numeric_limits<ElfW(Off)>::max();
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_shnum = 0;
		CheckHeader(InvalidHeader);

		InvalidHeader = Header;
		InvalidHeader.e_phentsize = 1;
		CheckHeader(InvalidHeader);

		auto const CheckSection = [&vecBytes, &RequireRejected](const std::size_t unSectionIndex, ElfW(Shdr) const& InvalidSection) {
			std::vector<unsigned char> vecInvalid = vecBytes;
			StoreFixtureELFRecord(vecInvalid, kSectionTableOffset + (unSectionIndex * sizeof(InvalidSection)), InvalidSection);
			RequireRejected(vecInvalid);
		};

		ElfW(Shdr) InvalidSection = arrSections[kSymbolTableSectionIndex];
		InvalidSection.sh_link = kSectionCount;
		CheckSection(kSymbolTableSectionIndex, InvalidSection);

		InvalidSection = arrSections[kSymbolTableSectionIndex];
		InvalidSection.sh_entsize = 1;
		CheckSection(kSymbolTableSectionIndex, InvalidSection);

		InvalidSection = arrSections[kStringTableSectionIndex];
		InvalidSection.sh_size = std::numeric_limits<ElfW(Off)>::max();
		CheckSection(kStringTableSectionIndex, InvalidSection);

		InvalidSection = arrSections[kAllocatedSectionIndex];
		InvalidSection.sh_flags = 0;
		CheckSection(kAllocatedSectionIndex, InvalidSection);

		auto const CheckSymbol = [&vecBytes, &RequireRejected](ElfW(Sym) const& InvalidSymbol) {
			std::vector<unsigned char> vecInvalid = vecBytes;
			StoreFixtureELFRecord(vecInvalid, kSymbolTableOffset + (kDuplicateSymbolIndex * sizeof(InvalidSymbol)), InvalidSymbol);
			RequireRejected(vecInvalid);
		};

		ElfW(Sym) InvalidSymbol = Symbol;
		++InvalidSymbol.st_value;
		CheckSymbol(InvalidSymbol);

		InvalidSymbol = Symbol;
		InvalidSymbol.st_name = sizeof(kSymbolNames);
		CheckSymbol(InvalidSymbol);

		InvalidSymbol = Symbol;
		InvalidSymbol.st_size = kLoadedByteSize;
		CheckSymbol(InvalidSymbol);

		std::vector<unsigned char> vecInvalid = vecBytes;
		vecInvalid.back() = 'X';
		RequireRejected(vecInvalid);

		vecInvalid = vecBytes;
		ElfW(Phdr) InvalidProgramHeader = ProgramHeader;
		InvalidProgramHeader.p_vaddr = std::numeric_limits<ElfW(Addr)>::max();
		StoreFixtureELFRecord(vecInvalid, Header.e_phoff, InvalidProgramHeader);
		RequireRejected(vecInvalid);

		vecInvalid = vecBytes;
		Header.e_shnum = 0;
		Header.e_phnum = PN_XNUM;
		arrSections[kNullSectionIndex].sh_size = kSectionCount;
		arrSections[kNullSectionIndex].sh_info = kProgramHeaderCount;
		StoreFixtureELFRecord(vecInvalid, 0, Header);
		StoreFixtureELFRecord(vecInvalid, kSectionTableOffset, arrSections[kNullSectionIndex]);
		unAddress = kUnchangedAddress;
		Require(ResolveMemoryManagerELFImageSymbol(vecInvalid, BinaryInformation, kSymbolName, unAddress) && (unAddress == (kLoadedBaseAddress + kSymbolOffset)), "Read ELF extended section/program counts");

		BinaryInformation.m_unBaseAddress = std::numeric_limits<std::uintptr_t>::max();
		RequireRejected(vecBytes);
	}

	void CheckELFCallback() {
		constexpr std::uintptr_t kModuleBaseAddress = 0x1000;
		constexpr std::uintptr_t kFirstSegmentOffset = 0x10;
		constexpr std::uintptr_t kSecondSegmentOffset = 0x40;
		constexpr std::uintptr_t kFirstSegmentByteSize = 0x20;
		constexpr std::uintptr_t kSecondSegmentByteSize = 0x10;
		constexpr std::size_t kFirstLoadHeaderIndex = 0;
		constexpr std::size_t kSecondLoadHeaderIndex = 1;
		constexpr std::size_t kDynamicHeaderIndex = 2;
		constexpr std::size_t kEmptyLoadHeaderIndex = 3;
		constexpr std::size_t kAddressOverflowHeaderIndex = 4;
		constexpr std::size_t kSizeOverflowHeaderIndex = 5;
		constexpr std::size_t kHeaderCount = 6;
		constexpr std::size_t kExpectedBinaryRecordCount = 1;

		static_assert(kHeaderCount <= std::numeric_limits<ElfW(Half)>::max());

		std::array<ElfW(Phdr), kHeaderCount> arrHeaders {};
		arrHeaders[kFirstLoadHeaderIndex].p_type = PT_LOAD;
		arrHeaders[kFirstLoadHeaderIndex].p_vaddr = kFirstSegmentOffset;
		arrHeaders[kFirstLoadHeaderIndex].p_memsz = kFirstSegmentByteSize;
		arrHeaders[kSecondLoadHeaderIndex].p_type = PT_LOAD;
		arrHeaders[kSecondLoadHeaderIndex].p_vaddr = kSecondSegmentOffset;
		arrHeaders[kSecondLoadHeaderIndex].p_memsz = kSecondSegmentByteSize;
		arrHeaders[kDynamicHeaderIndex].p_type = PT_DYNAMIC;
		arrHeaders[kDynamicHeaderIndex].p_memsz = kFirstSegmentByteSize;
		arrHeaders[kEmptyLoadHeaderIndex].p_type = PT_LOAD;
		arrHeaders[kAddressOverflowHeaderIndex].p_type = PT_LOAD;
		arrHeaders[kAddressOverflowHeaderIndex].p_vaddr = std::numeric_limits<std::uintptr_t>::max();
		arrHeaders[kAddressOverflowHeaderIndex].p_memsz = kFirstSegmentByteSize;
		arrHeaders[kSizeOverflowHeaderIndex].p_type = PT_LOAD;
		arrHeaders[kSizeOverflowHeaderIndex].p_memsz = std::numeric_limits<std::uintptr_t>::max();

		dl_phdr_info Information {};
		Information.dlpi_addr = kModuleBaseAddress;
		Information.dlpi_name = "/fixture/library.so";
		Information.dlpi_phdr = arrHeaders.data();
		Information.dlpi_phnum = static_cast<ElfW(Half)>(arrHeaders.size());

		MemoryManagerBinaryCollection Collection {};
		Require(CollectMemoryManagerBinariesCallback(nullptr, 0, &Collection) == 0, "Ignore null loader metadata");
		Require(CollectMemoryManagerBinariesCallback(&Information, 0, nullptr) == 0, "Ignore null collection state");
		Require((CollectMemoryManagerBinariesCallback(&Information, 0, &Collection) == 0) && (Collection.m_vecBinaryInformations.size() == kExpectedBinaryRecordCount) && !Collection.m_Failure, "Collect synthetic valid ELF segments");
		MemoryManagerBinaryInformation const& Record = Collection.m_vecBinaryInformations[0];
		Require((Record.m_strName == "library.so") && (Record.m_unBaseAddress == (kModuleBaseAddress + kFirstSegmentOffset)) && (Record.m_unByteSize == ((kSecondSegmentOffset + kSecondSegmentByteSize) - kFirstSegmentOffset)), "Skip empty/non-load/overflow ELF segments");

		g_bFailCollection = true;
		const int nFailureResult = CollectMemoryManagerBinariesCallback(&Information, 0, &Collection);
		g_bFailCollection = false;

		Require((nFailureResult == 1) && Collection.m_Failure && (Collection.m_vecBinaryInformations.size() == kExpectedBinaryRecordCount), "Stop loader iteration and retain the insertion failure without publishing a new record");

		MemoryManagerBinaryCollection MissingHeaders {};
		Information.dlpi_phdr = nullptr;
		Require((CollectMemoryManagerBinariesCallback(&Information, 0, &MissingHeaders) == 0) && MissingHeaders.m_vecBinaryInformations.empty(), "Reject missing nonempty program-header storage");
	}
#endif

	void CheckGameDataValues() {
		constexpr unsigned int kByteValueCount = 256;
		constexpr std::size_t kPatternCharacterCount = 4;
		constexpr unsigned char kUnchangedPatternByte = 0xA5;

		SourceModIServerGameData GameData {};
		Require(GameData.m_strLibraryName.empty() && GameData.m_strPlatformSignature.empty() && GameData.m_strWindowsSignature.empty() && (GameData.m_nWindowsAddressOffset == -1), "Initialize GameData's absent offset sentinel");

		Require(StripSourceModGameDataComments("").empty(), "Strip empty GameData");
		Require(StripSourceModGameDataComments("A//x\nB") == "A   \nB", "Strip line comments and retain newline");
		Require(StripSourceModGameDataComments("A/*\ny*/B") == "A  \n   B", "Strip block comments and retain newline");
		Require(StripSourceModGameDataComments("A;x\nB") == "A  \nB", "Strip semicolon comments");

		std::string const strQuoted = "\"a\\\"//b/*c*/;d\\\\\"";
		Require(StripSourceModGameDataComments(strQuoted) == strQuoted, "Retain quoted markers and escaped quotes/backslashes");

		Require(StripSourceModGameDataComments(std::string("\xEF\xBB\xBF") + "Key") == "Key", "Strip UTF8 BOM");
		Require(StripSourceModGameDataComments(std::string("\xEF")) == std::string("\xEF"), "Retain one-byte incomplete BOM");
		Require(StripSourceModGameDataComments(std::string("\xEF\xBB")) == std::string("\xEF\xBB"), "Retain incomplete BOM");

		for (unsigned int unByteValue = 0; unByteValue < kByteValueCount; ++unByteValue) {
			char szPattern[kPatternCharacterCount + 1] {};
			Require(std::snprintf(szPattern, sizeof(szPattern), "\\x%02X", unByteValue) == static_cast<int>(kPatternCharacterCount), "Encode byte probe");
			std::size_t unCharacterIndex = 0;
			unsigned char unPatternByte = 0;
			Require(ReadSourceModPatternByte(szPattern, unCharacterIndex, unPatternByte) && (unCharacterIndex == kPatternCharacterCount) && (unPatternByte == unByteValue), "Read every escaped byte");
		}

		std::size_t unLowercaseCharacterIndex = 0;
		unsigned char unLowercaseByte = 0;
		Require(ReadSourceModPatternByte("\\xaF", unLowercaseCharacterIndex, unLowercaseByte) && (unLowercaseCharacterIndex == kPatternCharacterCount) && (unLowercaseByte == 0xAF), "Read mixed-case hexadecimal digits");

		for (auto const& pszInvalidPattern : { "", "x", "\\x0", "\\x0G", "\\X00", "\\x-1" }) {
			std::size_t unCharacterIndex = 0;
			unsigned char unPatternByte = kUnchangedPatternByte;
			Require(!ReadSourceModPatternByte(pszInvalidPattern, unCharacterIndex, unPatternByte) && (unCharacterIndex == 0) && (unPatternByte == kUnchangedPatternByte), "Invalid byte input preserves outputs");
		}

		std::string const strPrefixedPattern = "!\\x2A";
		std::size_t unPrefixedCharacterIndex = 1;
		unsigned char unPrefixedByte = kUnchangedPatternByte;
		Require(ReadSourceModPatternByte(strPrefixedPattern, unPrefixedCharacterIndex, unPrefixedByte) && (unPrefixedCharacterIndex == strPrefixedPattern.size()) && (unPrefixedByte == 0x2A), "Read a byte from a nonzero cursor");

		for (auto const& unStartIndex : { strPrefixedPattern.size(), strPrefixedPattern.size() + 1, std::numeric_limits<std::size_t>::max() }) {
			std::size_t unCharacterIndex = unStartIndex;
			unsigned char unPatternByte = kUnchangedPatternByte;
			Require(!ReadSourceModPatternByte(strPrefixedPattern, unCharacterIndex, unPatternByte) && (unCharacterIndex == unStartIndex) && (unPatternByte == kUnchangedPatternByte), "Out-of-range byte cursor preserves outputs");
		}
	}

} // namespace

int main(const int nArgumentCount, char** ppszArguments) {
	if (nArgumentCount != 2) {
		std::fprintf(stderr, "Usage: MemoryBinaryGameData <fixture-library>\n");
		return 2;
	}

	try {
		CheckLibraryLookup(std::filesystem::path(ppszArguments[1]));
		CheckCollectionFailure();
#if !defined(_WIN32)
		CheckELFImageSnapshot(std::filesystem::path(ppszArguments[1]));
		CheckELFSymbolImage();
		CheckELFCallback();
#endif
		CheckGameDataValues();
	} catch (std::exception const& Failure) {
		std::fprintf(stderr, "MemoryBinaryGameData failed: %s\n", Failure.what());
		return 1;
	}

	std::puts("MemoryBinaryGameData PASS: actual OS lookup; controlled insertion failure; pure parser helpers; no SDK/engine/OOM claim.");

	return 0;
}
