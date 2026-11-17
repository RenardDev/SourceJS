#include "MessageMethodIndex.h"

// General
#if defined(SOURCEJS_NATIVE_FIXTURE_WITH_SDK)
#include <eiface.h>
#include <tier1/convar.h>
#endif

// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <limits>
#include <memory>

namespace MessageMethodIndexFixture {
	class VirtualMethods {
	public:
		virtual void First() = 0;
		virtual void Second() = 0;
		virtual void Third() = 0;
	};

	using fnMethodAddress = void(VirtualMethods::*)();
#if defined(_WIN32)
	using fnReleaseRegion = void(*)(void* const pAddress);
#endif

	int Fail(char const* const pszStage) noexcept {
		std::fprintf(stderr, "MessageMethodIndex failed Stage=\"%s\"\n", pszStage);

		return 1;
	}

	constexpr int kUserMessageTestType = 7;
	constexpr char kUserMessageTestName[] = "SayText";

	struct NamedUserMessageEngine {
		bf_write* UserMessageBegin(IRecipientFilter* const pFilter, const int nType, char const* const pszName) noexcept {
			++m_unCallCount;
			m_bMatched = pFilter && (nType == kUserMessageTestType) && pszName && (std::strcmp(pszName, kUserMessageTestName) == 0);

			return nullptr;
		}

		unsigned int m_unCallCount;
		bool m_bMatched;
	};

	struct IndexedUserMessageEngine {
		bf_write* UserMessageBegin(IRecipientFilter* const pFilter, const int nType) noexcept {
			m_bMatched = pFilter && (nType == kUserMessageTestType);

			return nullptr;
		}

		bool m_bMatched;
	};

	int VerifyUserMessageBegin() noexcept {
		using NativeMessageMethodIndex::BeginUserMessage;
		using NativeMessageMethodIndex::UserMessageBeginHasName;

		static_assert(UserMessageBeginHasName<NamedUserMessageEngine>());
		static_assert(!UserMessageBeginHasName<IndexedUserMessageEngine>());

		// The mocks use the filter address as an identity and never dereference it.
		std::max_align_t FilterStorage {};
		auto* const pFilter = reinterpret_cast<IRecipientFilter*>(&FilterStorage);
		NamedUserMessageEngine Named {};
		BeginUserMessage(&Named, pFilter, kUserMessageTestType, "");
		BeginUserMessage(&Named, pFilter, kUserMessageTestType, nullptr);

		if (Named.m_unCallCount != 0) {
			return Fail("named UserMessageBegin accepted a missing name");
		}

		BeginUserMessage(&Named, pFilter, kUserMessageTestType, kUserMessageTestName);
		if ((Named.m_unCallCount != 1) || !Named.m_bMatched) {
			return Fail("named UserMessageBegin did not receive its arguments");
		}

		IndexedUserMessageEngine Indexed {};
		BeginUserMessage(&Indexed, pFilter, kUserMessageTestType, nullptr);
		if (!Indexed.m_bMatched) {
			return Fail("indexed UserMessageBegin requires no name");
		}

		return 0;
	}

#if defined(SOURCEJS_NATIVE_FIXTURE_WITH_SDK)
	template<typename TEngineServer>
	int VerifySDKMemberAddresses() noexcept {
		constexpr std::size_t kMaximumMethodCount = 4;

		int arrMethodIndices[kMaximumMethodCount] {};
		std::size_t unMethodCount = 0;
		if constexpr (requires { &TEngineServer::UserMessageBegin; }) {
			arrMethodIndices[unMethodCount++] = NativeMessageMethodIndex::GetSDKVirtualMethodIndex(&TEngineServer::UserMessageBegin);
		}

		if constexpr (requires { &TEngineServer::MessageEnd; }) {
			arrMethodIndices[unMethodCount++] = NativeMessageMethodIndex::GetSDKVirtualMethodIndex(&TEngineServer::MessageEnd);
		}

		if constexpr (requires { &TEngineServer::SendUserMessage; }) {
			arrMethodIndices[unMethodCount++] = NativeMessageMethodIndex::GetSDKVirtualMethodIndex(&TEngineServer::SendUserMessage);
		}

		if constexpr (requires { &TEngineServer::CreateFakeClient; }) {
			arrMethodIndices[unMethodCount++] = NativeMessageMethodIndex::GetSDKVirtualMethodIndex(&TEngineServer::CreateFakeClient);
		}

		if (unMethodCount == 0) {
			return Fail("selected SDK exposes no supported virtual member");
		}

		for (std::size_t unMethodIndex = 0; unMethodIndex < unMethodCount; ++unMethodIndex) {
			if (arrMethodIndices[unMethodIndex] < 0) {
				return Fail("actual selected SDK member address");
			}

			for (std::size_t unPreviousMethodIndex = 0; unPreviousMethodIndex < unMethodIndex; ++unPreviousMethodIndex) {
				if (arrMethodIndices[unMethodIndex] == arrMethodIndices[unPreviousMethodIndex]) {
					return Fail("distinct selected SDK members share a slot");
				}
			}
		}

		return 0;
	}

	template <typename TConCommand>
	int VerifyCommandDispatchAddress() noexcept {
		if constexpr (requires { &TConCommand::Dispatch; }) {
			if (NativeMessageMethodIndex::GetSDKVirtualMethodIndex(&TConCommand::Dispatch) < 0) {
				return Fail("selected SDK ConCommand::Dispatch address");
			}
		}

		return 0;
	}
#endif // defined(SOURCEJS_NATIVE_FIXTURE_WITH_SDK)

#if defined(_WIN32)
	int FailPlatformOperation(char const* const pszStage, const DWORD unError) noexcept {
		std::fprintf(stderr, "MessageMethodIndex failed Stage=\"%s\" Error=0x%08lX\n", pszStage, unError);

		return 1;
	}

	// Manufactured member-address bytes are inspected only, never invoked as a member function.
	int DecodeWindowsAddress(const std::uintptr_t unAddress) noexcept {
		static_assert(sizeof(fnMethodAddress) == sizeof(unAddress), "Unsupported fixture member-address layout.");

		fnMethodAddress MethodAddress = &VirtualMethods::First;
		std::memcpy(&MethodAddress, &unAddress, sizeof(MethodAddress));

		return NativeMessageMethodIndex::GetSDKVirtualMethodIndex(MethodAddress);
	}

	void ReleaseRegion(void* const pAddress) noexcept {
		if (pAddress && !VirtualFree(pAddress, 0, MEM_RELEASE)) {
			const DWORD unError = GetLastError();
			std::fprintf(stderr, "ReleaseRegion failed Error=0x%08lX\n", unError);
			std::abort();
		}
	}

	int VerifyWindowsInstructions() {
		constexpr std::size_t kRegionByteCount = 4096;
		constexpr std::size_t kPartialReadRegionPageCount = 2;
		constexpr std::size_t kRelativeJumpByteCount = 5;
		constexpr std::size_t kTargetByteOffset = 0x08;
		constexpr std::size_t kDisplacementByteOffset = 0x02;
		constexpr int kPositiveMethodIndex = 7;

		unsigned char arrInstructions[] = { 0xFF, 0xA0, 0, 0, 0, 0 };
		const std::int32_t nPositiveDisplacement = static_cast<std::int32_t>(kPositiveMethodIndex * sizeof(void*));
		std::memcpy(arrInstructions + kDisplacementByteOffset, &nPositiveDisplacement, sizeof(nPositiveDisplacement));
		const std::uintptr_t unInstructionAddress = reinterpret_cast<std::uintptr_t>(arrInstructions);
		if (DecodeWindowsAddress(unInstructionAddress) != kPositiveMethodIndex) {
			return Fail("positive signed displacement");
		}

		const std::int32_t nNegativeDisplacement = -0x04;
		std::memcpy(arrInstructions + kDisplacementByteOffset, &nNegativeDisplacement, sizeof(nNegativeDisplacement));
		if (DecodeWindowsAddress(unInstructionAddress) != -1) {
			return Fail("negative displacement");
		}

		const std::int32_t nUnalignedDisplacement = 0x01;
		std::memcpy(arrInstructions + kDisplacementByteOffset, &nUnalignedDisplacement, sizeof(nUnalignedDisplacement));
		if (DecodeWindowsAddress(unInstructionAddress) != -1) {
			return Fail("unaligned displacement");
		}

		arrInstructions[0] = 0x90;
		if (DecodeWindowsAddress(unInstructionAddress) != -1) {
			return Fail("unsupported instruction opcode");
		}

		unsigned char arrByteJump[] = { 0xFF, 0x60, static_cast<unsigned char>(2 * sizeof(void*)) };
		const std::uintptr_t unByteJumpAddress = reinterpret_cast<std::uintptr_t>(arrByteJump);
		if (DecodeWindowsAddress(unByteJumpAddress) != 2) {
			return Fail("byte displacement");
		}

		arrByteJump[kDisplacementByteOffset] = 0xFF;
		if (DecodeWindowsAddress(unByteJumpAddress) != -1) {
			return Fail("negative byte displacement");
		}

		unsigned char arrRelativeJump[kTargetByteOffset + kRelativeJumpByteCount] {};
		arrRelativeJump[0] = 0xE9;
		const std::int32_t nForwardDisplacement = static_cast<std::int32_t>(kTargetByteOffset - kRelativeJumpByteCount);
		std::memcpy(arrRelativeJump + 1, &nForwardDisplacement, sizeof(nForwardDisplacement));
		arrRelativeJump[kTargetByteOffset] = 0xFF;
		arrRelativeJump[kTargetByteOffset + 1] = 0x20;
		if (DecodeWindowsAddress(reinterpret_cast<std::uintptr_t>(arrRelativeJump)) != 0) {
			return Fail("forward relative jump");
		}

		arrRelativeJump[0] = 0xFF;
		arrRelativeJump[1] = 0x20;
		arrRelativeJump[kTargetByteOffset] = 0xE9;
		const std::int32_t nBackwardDisplacement = -static_cast<std::int32_t>(kTargetByteOffset + kRelativeJumpByteCount);
		std::memcpy(arrRelativeJump + kTargetByteOffset + 1, &nBackwardDisplacement, sizeof(nBackwardDisplacement));
		if (DecodeWindowsAddress(reinterpret_cast<std::uintptr_t>(arrRelativeJump + kTargetByteOffset)) != 0) {
			return Fail("backward relative jump");
		}

		const std::int32_t nMinimumDisplacement = std::numeric_limits<std::int32_t>::min();
		std::memcpy(arrRelativeJump + kTargetByteOffset + 1, &nMinimumDisplacement, sizeof(nMinimumDisplacement));
		if (DecodeWindowsAddress(reinterpret_cast<std::uintptr_t>(arrRelativeJump + kTargetByteOffset)) != -1) {
			return Fail("minimum relative displacement");
		}

		std::unique_ptr<void, fnReleaseRegion> pNoAccessRegion(VirtualAlloc(nullptr, kRegionByteCount, MEM_RESERVE | MEM_COMMIT, PAGE_NOACCESS), ReleaseRegion);
		if (!pNoAccessRegion) {
			const DWORD unError = GetLastError();
			return FailPlatformOperation("allocate no-access region", unError);
		}

		unsigned char arrUnchanged[] = { 0x12, 0x34 };
		if (NativeMessageMethodIndex::ReadSDKMethodInstruction(reinterpret_cast<std::uintptr_t>(pNoAccessRegion.get()), arrUnchanged) || (arrUnchanged[0] != 0x12) || (arrUnchanged[1] != 0x34)) {
			return Fail("unreadable region must not commit");
		}

		if (NativeMessageMethodIndex::ReadSDKMethodInstruction(std::numeric_limits<std::uintptr_t>::max() - 1, arrUnchanged) || (arrUnchanged[0] != 0x12) || (arrUnchanged[1] != 0x34)) {
			return Fail("overflowing range must not commit");
		}

		if ((DecodeWindowsAddress(0) != -1) || (DecodeWindowsAddress(reinterpret_cast<std::uintptr_t>(pNoAccessRegion.get())) != -1)) {
			return Fail("invalid method address");
		}

		SYSTEM_INFO SystemInformation {};
		GetSystemInfo(&SystemInformation);
		const std::size_t unPageByteCount = SystemInformation.dwPageSize;
		if ((unPageByteCount == 0) || (unPageByteCount > (std::numeric_limits<std::size_t>::max() / kPartialReadRegionPageCount))) {
			return Fail("invalid system page extent");
		}

		std::unique_ptr<void, fnReleaseRegion> pPartialReadRegion(VirtualAlloc(nullptr, unPageByteCount * kPartialReadRegionPageCount, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE), ReleaseRegion);
		if (!pPartialReadRegion) {
			const DWORD unError = GetLastError();
			return FailPlatformOperation("allocate partial-read region", unError);
		}

		unsigned char* const pchSecondPage = static_cast<unsigned char*>(pPartialReadRegion.get()) + unPageByteCount;
		DWORD unPreviousProtection = 0;
		if (!VirtualProtect(pchSecondPage, unPageByteCount, PAGE_NOACCESS, &unPreviousProtection)) {
			const DWORD unError = GetLastError();
			return FailPlatformOperation("protect partial-read region", unError);
		}

		unsigned char* const pchLastReadableByte = pchSecondPage - 1;
		*pchLastReadableByte = 0xFF;
		const std::uintptr_t unPartialReadAddress = reinterpret_cast<std::uintptr_t>(pchLastReadableByte);
		if (NativeMessageMethodIndex::ReadSDKMethodInstruction(unPartialReadAddress, arrUnchanged) || (arrUnchanged[0] != 0x12) || (arrUnchanged[1] != 0x34) || (DecodeWindowsAddress(unPartialReadAddress) != -1)) {
			return Fail("partially unreadable range must not commit");
		}

		return 0;
	}
#elif defined(__linux__)
	// Byte-carrier tests exercise the documented GNU-compatible x86 representation without invoking manufactured addresses.
	int DecodeGNUWords(const std::intptr_t nVirtualOffset, const std::intptr_t nThisOffset) noexcept {
		std::intptr_t const arrWords[] = { nVirtualOffset, nThisOffset };

		static_assert(sizeof(fnMethodAddress) == sizeof(arrWords), "Unsupported fixture GNU member-address layout.");

		fnMethodAddress MethodAddress = &VirtualMethods::First;
		std::memcpy(&MethodAddress, arrWords, sizeof(MethodAddress));

		return NativeMessageMethodIndex::GetSDKVirtualMethodIndex(MethodAddress);
	}

	int VerifyGNUWords() noexcept {
		constexpr std::int64_t kMaximumMethodIndex = std::numeric_limits<int>::max();
		constexpr std::intptr_t kVTableEntryByteCount = sizeof(void*);

		if ((DecodeGNUWords(0, 0) != -1) || (DecodeGNUWords(0x02, 0) != -1) || (DecodeGNUWords(-0x01, 0) != -1) || (DecodeGNUWords(0x01, 0x01) != -1) || (DecodeGNUWords(0x03, 0) != -1)) {
			return Fail("invalid GNU member-address words");
		}

		if ((DecodeGNUWords(0x01, 0) != 0) || (DecodeGNUWords(0x01 + static_cast<std::intptr_t>(2 * sizeof(void*)), 0) != 2) || (DecodeGNUWords(std::numeric_limits<std::intptr_t>::max(), 0) != -1)) {
			return Fail("GNU index alignment and range");
		}

		if constexpr (sizeof(std::intptr_t) > sizeof(int)) {
			const std::intptr_t nMaximumIndexOffset = static_cast<std::intptr_t>(kMaximumMethodIndex * kVTableEntryByteCount + 0x01);
			const std::intptr_t nOutOfRangeIndexOffset = static_cast<std::intptr_t>((kMaximumMethodIndex + 1) * kVTableEntryByteCount + 0x01);
			if ((DecodeGNUWords(nMaximumIndexOffset, 0) != std::numeric_limits<int>::max()) || (DecodeGNUWords(nOutOfRangeIndexOffset, 0) != -1)) {
				return Fail("GNU maximum and overflowing method indices");
			}

		} else {
			const std::intptr_t nMaximumRepresentableIndex = (std::numeric_limits<std::intptr_t>::max() - 0x01) / kVTableEntryByteCount;
			const std::intptr_t nMaximumIndexOffset = nMaximumRepresentableIndex * kVTableEntryByteCount + 0x01;
			if (DecodeGNUWords(nMaximumIndexOffset, 0) != static_cast<int>(nMaximumRepresentableIndex)) {
				return Fail("GNU maximum representable x86 method index");
			}
		}

		return 0;
	}
#endif
} // namespace MessageMethodIndexFixture

int main(const int nArgumentCount, char**) {
#if defined(SOURCEJS_NATIVE_FIXTURE_WITH_SDK)
	constexpr char kSDKHeaderStatus[] = "selected-header";
#else
	constexpr char kSDKHeaderStatus[] = "compiler-only";
#endif

	if (nArgumentCount != 1) {
		std::fprintf(stderr, "Usage: MessageMethodIndex\n");
		return 2;
	}

	using MessageMethodIndexFixture::VirtualMethods;
	using NativeMessageMethodIndex::GetSDKVirtualMethodIndex;

	if ((GetSDKVirtualMethodIndex(&VirtualMethods::First) != 0) || (GetSDKVirtualMethodIndex(&VirtualMethods::Second) != 1) || (GetSDKVirtualMethodIndex(&VirtualMethods::Third) != 2)) {
		return MessageMethodIndexFixture::Fail("compiler-generated member addresses");
	}

	const int nUserMessageResult = MessageMethodIndexFixture::VerifyUserMessageBegin();
	if (nUserMessageResult != 0) {
		return nUserMessageResult;
	}

#if defined(SOURCEJS_NATIVE_FIXTURE_WITH_SDK)
	const int nSDKResult = MessageMethodIndexFixture::VerifySDKMemberAddresses<IVEngineServer>();
	if (nSDKResult != 0) {
		return nSDKResult;
	}

	const int nCommandResult = MessageMethodIndexFixture::VerifyCommandDispatchAddress<ConCommand>();
	if (nCommandResult != 0) {
		return nCommandResult;
	}
#endif

#if defined(_WIN32)
	const int nResult = MessageMethodIndexFixture::VerifyWindowsInstructions();
#else
	const int nResult = MessageMethodIndexFixture::VerifyGNUWords();
#endif
	if (nResult != 0) {
		return nResult;
	}

	std::printf("native message-method index fixture PASS Architecture=%s SDK=%s\n", (sizeof(void*) == 4) ? "x86" : "x64", kSDKHeaderStatus);

	return 0;
}
