
// C++
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstdio>

// STL
#include <exception>
#include <limits>
#include <stdexcept>
#include <type_traits>

// Template fixture, not standalone: compile through tools/smoke_studio_cache_reference_contracts.js.
// The runner inserts the production reference owner at the marker below.
namespace SourceJS {
	// Exact SDK/logging symbols are required by the extracted, unmodified owner.
	using MDLHandle_t = std::uint16_t;

	class IMDLCache {
	public:
		virtual ~IMDLCache() noexcept;
		virtual int Release(const MDLHandle_t hModelHandle) = 0;
	};

	class TestModelCache final : public IMDLCache {
	public:
		TestModelCache(const bool bThrowStandardFailure, const bool bThrowOtherFailure);
		int Release(const MDLHandle_t hModelHandle) override;
		std::size_t GetReleaseCount() const noexcept;
		MDLHandle_t GetReleasedHandle() const noexcept;

	private:
		bool m_bThrowStandardFailure;
		bool m_bThrowOtherFailure;
		std::size_t m_unReleaseCount;
		MDLHandle_t m_hReleasedHandle;
	};

	constexpr MDLHandle_t MDLHANDLE_INVALID = std::numeric_limits<MDLHandle_t>::max();
	std::size_t g_unLoggedReleaseFailureCount = 0;

	IMDLCache::~IMDLCache() noexcept {
	}

	TestModelCache::TestModelCache(const bool bThrowStandardFailure, const bool bThrowOtherFailure) :
		m_bThrowStandardFailure(bThrowStandardFailure),
		m_bThrowOtherFailure(bThrowOtherFailure)
	{
		m_unReleaseCount = 0;
		m_hReleasedHandle = MDLHANDLE_INVALID;
	}

	int TestModelCache::Release(const MDLHandle_t hModelHandle) {
		++m_unReleaseCount;
		m_hReleasedHandle = hModelHandle;

		if (m_bThrowStandardFailure) {
			throw std::runtime_error("Expected SDK release failure.");
		}

		if (m_bThrowOtherFailure) {
			throw hModelHandle;
		}

		return 0;
	}

	std::size_t TestModelCache::GetReleaseCount() const noexcept {
		return m_unReleaseCount;
	}

	MDLHandle_t TestModelCache::GetReleasedHandle() const noexcept {
		return m_hReleasedHandle;
	}

	void LogError(char const*, ...) noexcept {
		++g_unLoggedReleaseFailureCount;
	}

	// SOURCEJS_STUDIO_CACHE_REFERENCE_OWNER

	static_assert(std::is_nothrow_constructible_v<StudioModelReferenceOwner, IMDLCache*, MDLHandle_t>);
	static_assert(std::is_nothrow_destructible_v<StudioModelReferenceOwner>);
	static_assert(!std::is_copy_constructible_v<StudioModelReferenceOwner>);
	static_assert(!std::is_copy_assignable_v<StudioModelReferenceOwner>);
	static_assert(!std::is_move_constructible_v<StudioModelReferenceOwner>);
	static_assert(!std::is_move_assignable_v<StudioModelReferenceOwner>);

	bool CheckReferenceOwnership() {
		constexpr MDLHandle_t kModelHandle = 17;
		constexpr std::size_t kSingleReleaseCount = 1;

		TestModelCache FailedPublicationCache = TestModelCache(false, false);
		{
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&FailedPublicationCache, kModelHandle);
		}

		if ((FailedPublicationCache.GetReleaseCount() != kSingleReleaseCount) || (FailedPublicationCache.GetReleasedHandle() != kModelHandle)) {
			return false;
		}

		TestModelCache SuccessfulPublicationCache = TestModelCache(false, false);
		{
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&SuccessfulPublicationCache, kModelHandle);
			ReferenceOwner.ReleaseOwnership();
			ReferenceOwner.ReleaseOwnership();
		}

		if (SuccessfulPublicationCache.GetReleaseCount() != 0) {
			return false;
		}

		TestModelCache InvalidHandleCache = TestModelCache(false, false);
		{
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&InvalidHandleCache, MDLHANDLE_INVALID);
			StudioModelReferenceOwner NullCacheReferenceOwner = StudioModelReferenceOwner(nullptr, kModelHandle);
		}

		if ((InvalidHandleCache.GetReleaseCount() != 0) || (g_unLoggedReleaseFailureCount != 0)) {
			return false;
		}

		TestModelCache UnwindingCache = TestModelCache(false, false);
		bool bCaughtPublicationFailure = false;
		try {
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&UnwindingCache, kModelHandle);
			throw std::runtime_error("Expected publication failure.");
		} catch (std::exception const&) {
			bCaughtPublicationFailure = true;
		}

		if (!bCaughtPublicationFailure || (UnwindingCache.GetReleaseCount() != kSingleReleaseCount)) {
			return false;
		}

		TestModelCache StandardFailureCache = TestModelCache(true, false);
		{
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&StandardFailureCache, kModelHandle);
		}

		if ((StandardFailureCache.GetReleaseCount() != kSingleReleaseCount) || (g_unLoggedReleaseFailureCount != kSingleReleaseCount)) {
			return false;
		}

		TestModelCache OtherFailureCache = TestModelCache(false, true);
		{
			StudioModelReferenceOwner ReferenceOwner = StudioModelReferenceOwner(&OtherFailureCache, kModelHandle);
		}

		if ((OtherFailureCache.GetReleaseCount() != kSingleReleaseCount) || (g_unLoggedReleaseFailureCount != (2 * kSingleReleaseCount))) {
			return false;
		}

		return true;
	}
} // namespace SourceJS

int main() {
	constexpr std::size_t kBitsPerByte = CHAR_BIT;

	if (!SourceJS::CheckReferenceOwnership()) {
		std::fprintf(stderr, "StudioCacheReferenceContracts failed\n");
		return 1;
	}

	std::printf("StudioCacheReferenceContracts PASS AddressBits=%zu\n", sizeof(void*) * kBitsPerByte);

	return 0;
}
