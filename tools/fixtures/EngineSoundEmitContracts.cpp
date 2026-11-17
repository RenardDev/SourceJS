
// C++
#include <cstdio>

// STL
#include <limits>
#include <string_view>

namespace {
	struct Vector {};

	template <typename TElement>
	struct CUtlVector {};

	struct RecipientFilter {
		int m_nClientIndex;
	};

	constexpr char kSampleName[] = "sourcejs/menu-select.wav";
	constexpr int kClientIndex = 2;
	constexpr int kChannel = 3;
	constexpr float kVolume = 0.75f;
	constexpr float kAttenuation = 0.8f;
	constexpr int kFlags = 0x08;
	constexpr int kPitch = 112;
	constexpr float kSoundTime = 2.5f;
	constexpr int kSpeakerIndex = -1;
	constexpr int kExpectedSpecialDSP = 0;
	constexpr unsigned int kExpectedRawSampleHash = std::numeric_limits<unsigned int>::max();
	constexpr int kExpectedSeed = 0;

	RecipientFilter g_Filter { kClientIndex };
	Vector g_Origin {};
	Vector g_Direction {};
	CUtlVector<Vector> g_vecOrigins {};

	struct CallRecord {
		void Record(RecipientFilter const& Filter, int nEntityIndex, int nChannel, char const* pszSample, float flVolume, float flAttenuation, int nFlags, int nPitch, Vector const* pOrigin, Vector const* pDirection, CUtlVector<Vector>* pOrigins, bool bUpdatePositions, float flSoundTime, int nSpeakerIndex) {
			++m_unCalls;
			m_bMatchesRequest = (&Filter == &g_Filter) && (Filter.m_nClientIndex == kClientIndex) && (nEntityIndex == kClientIndex) && (nChannel == kChannel) && (std::string_view(pszSample) == kSampleName) && (flVolume == kVolume) && (flAttenuation == kAttenuation) && (nFlags == kFlags) && (nPitch == kPitch) && (pOrigin == &g_Origin) && (pDirection == &g_Direction) && (pOrigins == &g_vecOrigins) && !bUpdatePositions && (flSoundTime == kSoundTime) && (nSpeakerIndex == kSpeakerIndex);
		}

		unsigned int m_unCalls;
		bool m_bMatchesRequest;
	};

	struct PlainSound : CallRecord {
		void EmitSound(RecipientFilter& Filter, int nEntityIndex, int nChannel, char const* pszSample, float flVolume, float flAttenuation, int nFlags, int nPitch, Vector const* pOrigin, Vector const* pDirection, CUtlVector<Vector>* pOrigins, bool bUpdatePositions, float flSoundTime, int nSpeakerIndex) {
			Record(Filter, nEntityIndex, nChannel, pszSample, flVolume, flAttenuation, nFlags, nPitch, pOrigin, pDirection, pOrigins, bUpdatePositions, flSoundTime, nSpeakerIndex);
		}
	};

	struct SpecialDSPSound : CallRecord {
		void EmitSound(RecipientFilter& Filter, int nEntityIndex, int nChannel, char const* pszSample, float flVolume, float flAttenuation, int nFlags, int nPitch, int nSpecialDSP, Vector const* pOrigin, Vector const* pDirection, CUtlVector<Vector>* pOrigins, bool bUpdatePositions, float flSoundTime, int nSpeakerIndex) {
			Record(Filter, nEntityIndex, nChannel, pszSample, flVolume, flAttenuation, nFlags, nPitch, pOrigin, pDirection, pOrigins, bUpdatePositions, flSoundTime, nSpeakerIndex);
			m_bMatchesRequest = m_bMatchesRequest && (nSpecialDSP == kExpectedSpecialDSP);
		}
	};

	struct EntrySound : CallRecord {
		int EmitSound(RecipientFilter& Filter, int nEntityIndex, int nChannel, char const* pszEntry, unsigned int unHash, char const* pszSample, float flVolume, float flAttenuation, int nSeed, int nFlags, int nPitch, Vector const* pOrigin, Vector const* pDirection, CUtlVector<Vector>* pOrigins, bool bUpdatePositions, float flSoundTime, int nSpeakerIndex) {
			Record(Filter, nEntityIndex, nChannel, pszSample, flVolume, flAttenuation, nFlags, nPitch, pOrigin, pDirection, pOrigins, bUpdatePositions, flSoundTime, nSpeakerIndex);
			m_bMatchesRequest = m_bMatchesRequest && (std::string_view(pszEntry) == kSampleName) && (unHash == kExpectedRawSampleHash) && (nSeed == kExpectedSeed);

			return 0;
		}
	};

	struct EntrySoundWithClientData : EntrySound {
		int EmitSound(RecipientFilter& Filter, int nEntityIndex, int nChannel, char const* pszEntry, unsigned int unHash, char const* pszSample, float flVolume, float flAttenuation, int nSeed, int nFlags, int nPitch, Vector const* pOrigin, Vector const* pDirection, CUtlVector<Vector>* pOrigins, bool bUpdatePositions, float flSoundTime, int nSpeakerIndex, void* pClientData = nullptr) {
			const int nResult = EntrySound::EmitSound(Filter, nEntityIndex, nChannel, pszEntry, unHash, pszSample, flVolume, flAttenuation, nSeed, nFlags, nPitch, pOrigin, pDirection, pOrigins, bUpdatePositions, flSoundTime, nSpeakerIndex);
			m_bMatchesRequest = m_bMatchesRequest && !pClientData;

			return nResult;
		}
	};

	// Compile the extracted production helper against the fixture's SDK types.
#include "EngineSoundEmitMethod.inc"

	template <typename TEngineSound>
	bool Emit(TEngineSound* const pSound, char const* const pszSample = kSampleName) {
		return TryEmitEngineSound(pSound, g_Filter, kClientIndex, kChannel, pszSample, kVolume, kAttenuation, kFlags, kPitch, &g_Origin, &g_Direction, &g_vecOrigins, false, kSoundTime, kSpeakerIndex);
	}

	template <typename TEngineSound>
	bool VerifyEmission(char const* const pszProfile) {
		TEngineSound Sound {};
		if (Emit<TEngineSound>(nullptr) || Emit(&Sound, nullptr) || !Emit(&Sound) || (Sound.m_unCalls != 1) || !Sound.m_bMatchesRequest) {
			std::fprintf(stderr, "Incorrect sound dispatch: %s\n", pszProfile);
			return false;
		}

		return true;
	}
} // namespace

int main() {
	CallRecord Unsupported {};
	if (Emit(&Unsupported) || !VerifyEmission<PlainSound>("raw sample") || !VerifyEmission<SpecialDSPSound>("special DSP") || !VerifyEmission<EntrySound>("sound entry") || !VerifyEmission<EntrySoundWithClientData>("sound entry with client data")) {
		return 1;
	}

	std::puts("Engine sound emission contracts passed");

	return 0;
}
