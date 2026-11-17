
// C++
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <utility>

// STL
#include <array>
#include <functional>
#include <limits>
#include <list>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

namespace SourceJS {
	namespace {

		constexpr char kOriginalName[] = "OriginalWorldName";
		constexpr char kOutputSentinel[] = "UnchangedOutput";
		constexpr int kFixtureWorldEntityIndex = 0;
		constexpr unsigned int kInvalidHandle = std::numeric_limits<unsigned int>::max();
		constexpr unsigned int kEntryMask = 0xFFFF;
		constexpr unsigned int kSerialShift = 16;

		static_assert(sizeof(unsigned int) == sizeof(std::uint32_t));

		// SDK names are exact adapters, not ABI implementations. The string model uses
		// the SDK's NO_STRING_T representation; list storage models engine pool lifetime.
		using string_t = char const*;
		constexpr string_t NULL_STRING = nullptr;

		char const* STRING(string_t const pszValue) {
			return pszValue;
		}

		enum class NameOperation {
			Assign = 0,
			RejectWithoutAssignment,
			RejectAfterAssignment,
			NullName,
			DifferentName,
			ThrowAfterAssignment,
			ThrowOnRead
		};

		class CBaseEntity {
		public:
			CBaseEntity();
			bool KeyValue(char const* const pszKey, char const* const pszValue);
			void Reset(const NameOperation Operation, const bool bStorageAvailable);
			string_t GetEntityName() const;
			void* GetNameStorage();
			bool HasOriginalName() const;

		private:
			string_t m_pszName;
			NameOperation m_Operation;
			bool m_bStorageAvailable;
			std::list<std::string> m_lstPool;
		};

		CBaseEntity::CBaseEntity() {
			m_pszName = kOriginalName;
			m_Operation = NameOperation::Assign;
			m_bStorageAvailable = true;
		}

		bool CBaseEntity::KeyValue(char const* const pszKey, char const* const pszValue) {
			if ((std::strcmp(pszKey, "targetname") != 0) || (m_Operation == NameOperation::RejectWithoutAssignment)) {
				return false;
			}

			m_lstPool.emplace_back((m_Operation == NameOperation::DifferentName) ? "DifferentName" : pszValue);
			m_pszName = (m_Operation == NameOperation::NullName) ? nullptr : m_lstPool.back().c_str();

			if (m_Operation == NameOperation::ThrowAfterAssignment) {
				throw std::runtime_error("KeyValue failure");
			}

			return m_Operation != NameOperation::RejectAfterAssignment;
		}

		void CBaseEntity::Reset(const NameOperation Operation, const bool bStorageAvailable) {
			m_pszName = kOriginalName;
			m_Operation = Operation;
			m_bStorageAvailable = bStorageAvailable;
		}

		string_t CBaseEntity::GetEntityName() const {
			if (m_Operation == NameOperation::ThrowOnRead) {
				throw std::runtime_error("GetEntityName failure");
			}

			return m_pszName;
		}

		void* CBaseEntity::GetNameStorage() {
			return m_bStorageAvailable ? &m_pszName : nullptr;
		}

		bool CBaseEntity::HasOriginalName() const {
			return m_pszName == kOriginalName;
		}

		// The 32-bit representation/packing is deliberately synthetic. These adapters
		// retain SDK validity and serial-identity semantics, not SDK layout or ABI.
		struct CBaseHandle {
			unsigned int m_unValue;

			static CBaseHandle UnsafeFromIndex(const int nValue) {
				return { static_cast<unsigned int>(nValue) };
			}

			void Init(const int nEntry, const int nSerial) {
				m_unValue = static_cast<unsigned int>(nEntry) | (static_cast<unsigned int>(nSerial) << kSerialShift);
			}

			bool IsValid() const {
				return m_unValue != kInvalidHandle;
			}

			int ToInt() const {
				return static_cast<int>(m_unValue);
			}

			int GetEntryIndex() const {
				return static_cast<int>(m_unValue & kEntryMask);
			}

			int GetSerialNumber() const {
				return static_cast<int>(m_unValue >> kSerialShift);
			}
		};

		// Each facade is a constructor-free fixture record, initialized at its use site.
		struct HandleEntity {
			CBaseHandle m_Handle;

			CBaseHandle const& GetRefEHandle() const {
				return m_Handle;
			}
		};

		struct Networkable {
			HandleEntity* m_pHandleEntity;

			HandleEntity* GetEntityHandle() const {
				return m_pHandleEntity;
			}
		};

		struct edict_t {
			Networkable* m_pNetworkable;
			bool m_bFree;

			bool IsFree() const {
				return m_bFree;
			}

			Networkable* GetNetworkable() const {
				return m_pNetworkable;
			}

			HandleEntity* GetUnknown() const {
				return m_pNetworkable ? m_pNetworkable->m_pHandleEntity : nullptr;
			}
		};

		constinit CBaseEntity* g_pWorldEntity = nullptr;
		constinit edict_t* g_pLiveEdict = nullptr;

		CBaseEntity* GetBaseEntityFromIndex(const int nIndex) {
			return (nIndex == kFixtureWorldEntityIndex) ? g_pWorldEntity : nullptr;
		}

		void* GetEntityInputNameStorage(CBaseEntity* const pEntity) {
			return pEntity ? pEntity->GetNameStorage() : nullptr;
		}

		edict_t* GetValidEntityEdictFromIndex(const int nIndex) {
			return ((nIndex == kFixtureWorldEntityIndex) && g_pLiveEdict && !g_pLiveEdict->IsFree()) ? g_pLiveEdict : nullptr;
		}

		// Queue adapters preserve SDK operation/clock names, not engine layout or ABI.
		struct variant_t {
			int m_nValue;
		};

		struct QueueGlobalVariables {
			float curtime;
		};

		struct QueueEngineInterfaces {
			QueueGlobalVariables* m_pGlobalVariables;

			QueueGlobalVariables* GetGlobalVariables() {
				return m_pGlobalVariables;
			}
		};

		struct QueueApplication {
			QueueEngineInterfaces m_EngineInterfaces;

			QueueEngineInterfaces& GetEngineInterfaces() {
				return m_EngineInterfaces;
			}
		};

		struct InputDeliveryProbe {
			std::vector<int> m_vecValues;
			std::function<void()> m_Callback;
		};

		constexpr char kDelayedInputName[] = "QueuedInput";
		constexpr int kFirstInputValue = 1;
		constexpr int kSecondInputValue = 2;
		constexpr int kThirdInputValue = 3;
		constexpr float kQuantizedClockTime = 1000000.0f;
		constexpr float kPositiveSubTickDelay = std::numeric_limits<float>::epsilon();

		constinit QueueApplication g_Application {};
		constinit std::uint64_t g_unLastDelayedInputSequence = 0;
		constinit InputDeliveryProbe* g_pInputDeliveryProbe = nullptr;

		edict_t* GetEdictFromEntityIndex(const int nEntityIndex) {
			return (nEntityIndex == kFixtureWorldEntityIndex) ? g_pLiveEdict : nullptr;
		}

		bool CallEntityInputNow(const int nEntityIndex, std::string const& strInputName, variant_t const& InputValue) {
			if ((nEntityIndex != kFixtureWorldEntityIndex) || strInputName.empty() || !g_pInputDeliveryProbe) {
				return false;
			}

			g_pInputDeliveryProbe->m_vecValues.push_back(InputValue.m_nValue);
			// Keep the active callback alive if it clears its stored entry.
			std::function<void()> const Callback = g_pInputDeliveryProbe->m_Callback;
			if (Callback) {
				Callback();
			}

			return true;
		}

		// SOURCEJS_ENTITY_INPUT_HELPERS

		void Require(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				throw std::runtime_error(pszMessage);
			}
		}

		// Owned fixture state outlives every borrowed adapter and captured callback.
		class DelayedInputScope {
		public:
			DelayedInputScope();
			~DelayedInputScope() noexcept;
			DelayedInputScope(DelayedInputScope const&) = delete;
			DelayedInputScope& operator=(DelayedInputScope const&) = delete;

			QueueGlobalVariables m_GlobalVariables;
			HandleEntity m_Entity;
			Networkable m_Network;
			edict_t m_Edict;
			InputDeliveryProbe m_Probe;
		};

		DelayedInputScope::DelayedInputScope() {
			m_GlobalVariables.curtime = 0.0f;
			m_Entity.m_Handle.Init(kFixtureWorldEntityIndex, 0);
			m_Network.m_pHandleEntity = &m_Entity;
			m_Edict.m_pNetworkable = &m_Network;
			m_Edict.m_bFree = false;
			g_unLastDelayedInputSequence = 0;
			g_pLiveEdict = &m_Edict;
			g_pInputDeliveryProbe = &m_Probe;
			g_Application.m_EngineInterfaces.m_pGlobalVariables = &m_GlobalVariables;
		}

		DelayedInputScope::~DelayedInputScope() noexcept {
			ClearDelayedEntityInputs();
			g_pInputDeliveryProbe = nullptr;
			g_pLiveEdict = nullptr;
			g_Application.m_EngineInterfaces.m_pGlobalVariables = nullptr;
		}

		void CheckDelayedPumpBoundary() {
			variant_t const Input { 73 };
			std::size_t unPumpLimit = 1;
			DelayedInputScope Scope;
			Scope.m_GlobalVariables.curtime = kQuantizedClockTime;
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, Input, kPositiveSubTickDelay), "Initial quantized input was not queued.");
			Require(g_vecDelayedEntityInputs.size() == 1, "Initial queue size.");
			Require(g_vecDelayedEntityInputs[0].m_flFireTime == kQuantizedClockTime, "Regression requires float delay quantization.");
			Scope.m_Probe.m_Callback = [&Scope, &unPumpLimit, Input]() {
				// Fail before the old pump can repeat indefinitely; no UB or unbounded wait.
				Require(Scope.m_Probe.m_vecValues.size() <= unPumpLimit, "New delayed input executed in the same pump.");
				Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, Input, kPositiveSubTickDelay), "Reentrant input was not queued.");
			};

			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 1) && (g_vecDelayedEntityInputs.size() == 1), "First pump did not retain new work.");
			unPumpLimit = 2;
			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 2) && (g_vecDelayedEntityInputs.size() == 1), "Second pump did not retain new work.");
			Scope.m_Probe.m_Callback = {};
			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 3) && g_vecDelayedEntityInputs.empty(), "Final pump did not drain initial work.");
		}

		void CheckDelayedQueueClear() {
			DelayedInputScope Scope;
			Scope.m_GlobalVariables.curtime = kQuantizedClockTime;
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kFirstInputValue }, kPositiveSubTickDelay), "First clear-case input.");
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kSecondInputValue }, kPositiveSubTickDelay), "Second clear-case input.");
			Scope.m_Probe.m_Callback = [&Scope]() {
				Scope.m_Probe.m_Callback = {};
				ClearDelayedEntityInputs();
				Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kThirdInputValue }, kPositiveSubTickDelay), "New input after clearing.");
			};

			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 1) && (Scope.m_Probe.m_vecValues[0] == kFirstInputValue), "Clearing failed to cancel old work or deferred new work ran early.");
			Require(g_vecDelayedEntityInputs.size() == 1, "New input after clearing was lost.");
			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 2) && (Scope.m_Probe.m_vecValues[1] == kThirdInputValue) && g_vecDelayedEntityInputs.empty(), "New post-clear work did not run next pump.");
		}

		void CheckDelayedQueueOrder() {
			constexpr float kFutureDelaySeconds = 10.0f;
			constexpr float kEarlierDelaySeconds = 1.0f;

			DelayedInputScope Scope;
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kFirstInputValue }, kFutureDelaySeconds), "Future input.");
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kSecondInputValue }, kEarlierDelaySeconds), "Earlier input.");
			Scope.m_GlobalVariables.curtime = kEarlierDelaySeconds;
			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 1) && (Scope.m_Probe.m_vecValues[0] == kSecondInputValue) && (g_vecDelayedEntityInputs.size() == 1), "Future input blocked a due input.");
			Scope.m_GlobalVariables.curtime = kFutureDelaySeconds;
			ProcessDelayedEntityInputs();
			Require((Scope.m_Probe.m_vecValues.size() == 2) && (Scope.m_Probe.m_vecValues[1] == kFirstInputValue) && g_vecDelayedEntityInputs.empty(), "Future input was lost.");
		}

		void CheckDelayedSequenceLimit() {
			DelayedInputScope Scope;
			g_unLastDelayedInputSequence = std::numeric_limits<std::uint64_t>::max();
			Require(!ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kFirstInputValue }, kPositiveSubTickDelay) && g_vecDelayedEntityInputs.empty(), "Input sequence wrapped or exhausted work was queued.");
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kSecondInputValue }, 0.0f), "Sequence exhaustion changed immediate input behavior.");
			g_Application.m_EngineInterfaces.m_pGlobalVariables = nullptr;
			Require(ScheduleEntityInput(kFixtureWorldEntityIndex, kDelayedInputName, { kThirdInputValue }, 1.0f), "Sequence exhaustion changed missing-globals immediate fallback.");
			Require((Scope.m_Probe.m_vecValues == std::vector<int> { kSecondInputValue, kThirdInputValue }) && g_vecDelayedEntityInputs.empty(), "Immediate fallback changed payloads or queued work.");
		}

		void CheckDelayedInputs() {
			CheckDelayedPumpBoundary();
			CheckDelayedQueueClear();
			CheckDelayedQueueOrder();
			CheckDelayedSequenceLimit();
		}

		void CheckNames() {
			constexpr char kRetainedValue[] = "RetainedValue";
			constexpr char kLeadingNullInput[] = "\0tail";
			constexpr char kEmbeddedNullInput[] = "first\0tail";
			constexpr NameOperation kFailureOperations[] = { NameOperation::RejectWithoutAssignment, NameOperation::RejectAfterAssignment, NameOperation::NullName, NameOperation::DifferentName, NameOperation::ThrowAfterAssignment, NameOperation::ThrowOnRead };

			CBaseEntity WorldEntity {};
			g_pWorldEntity = &WorldEntity;
			string_t pszOutput = kOutputSentinel;
			Require(AllocateEntityInputString(kRetainedValue, pszOutput), "Name allocation failed.");
			Require(WorldEntity.HasOriginalName(), "Name not restored after success.");
			Require(pszOutput && (std::strcmp(STRING(pszOutput), kRetainedValue) == 0), "Output lost its pool lifetime.");
			string_t const pszRetainedOutput = pszOutput;

			for (auto const& Operation : kFailureOperations) {
				WorldEntity.Reset(Operation, true);
				pszOutput = kOutputSentinel;
				bool bSucceeded = false;
				bool bThrew = false;

				try {
					bSucceeded = AllocateEntityInputString("NewValue", pszOutput);
				} catch (std::runtime_error const&) {
					bThrew = true;
				}

				const bool bExpectedException = (Operation == NameOperation::ThrowAfterAssignment) || (Operation == NameOperation::ThrowOnRead);
				Require(!bSucceeded && (bThrew == bExpectedException), "Failure/exception contract changed.");
				Require(WorldEntity.HasOriginalName(), "Name not restored after failure or exception.");
				Require(pszOutput == kOutputSentinel, "Failed allocation modified output.");
				Require(std::strcmp(STRING(pszRetainedOutput), kRetainedValue) == 0, "A later allocation invalidated pooled output.");
			}

			WorldEntity.Reset(NameOperation::Assign, false);
			Require(!AllocateEntityInputString("NoStorage", pszOutput) && (pszOutput == kOutputSentinel), "Missing storage accepted.");

			g_pWorldEntity = nullptr;
			Require(!AllocateEntityInputString("NoWorld", pszOutput) && (pszOutput == kOutputSentinel), "Missing world accepted.");

			Require(AllocateEntityInputString("", pszOutput) && (pszOutput == NULL_STRING), "Empty value contract changed.");
			Require(AllocateEntityInputString(std::string(kLeadingNullInput, sizeof(kLeadingNullInput) - 1), pszOutput) && (pszOutput == NULL_STRING), "Leading NUL contract changed.");

			g_pWorldEntity = &WorldEntity;
			WorldEntity.Reset(NameOperation::Assign, true);
			Require(AllocateEntityInputString(std::string(kEmbeddedNullInput, sizeof(kEmbeddedNullInput) - 1), pszOutput) && pszOutput && (std::strcmp(STRING(pszOutput), "first") == 0), "Null-terminated SDK contract changed.");
			Require(WorldEntity.HasOriginalName(), "Name not restored after embedded NUL.");

			g_pWorldEntity = nullptr;
		}

		void CheckHandles() {
			constexpr int kOutputHandleValue = 73;
			constexpr int kReplacementSerial = 17;
			constexpr int kUnchangedIndex = -1;

			HandleEntity Entity { { 0 } };
			Networkable Network { &Entity };
			edict_t Edict { &Network, false };
			g_pLiveEdict = &Edict;
			CBaseHandle Output { kOutputHandleValue };
			Require(GetEntityBaseHandleFromEdictAddress(&Edict, Output) && (Output.ToInt() == 0), "Valid zero handle rejected.");

			int nIndex = kUnchangedIndex;
			Require(GetEntityIndexFromIntegerHandleValue(0, nIndex) && (nIndex == kFixtureWorldEntityIndex), "Valid zero handle did not resolve its live slot.");

			Entity.m_Handle.Init(kFixtureWorldEntityIndex, kReplacementSerial);
			nIndex = kUnchangedIndex;
			Require(!GetEntityIndexFromIntegerHandleValue(0, nIndex) && (nIndex == kUnchangedIndex), "Stale serial accepted or output changed.");
			Require(GetEntityIndexFromBaseHandleValue(Entity.m_Handle, nIndex) && (nIndex == kFixtureWorldEntityIndex), "Current serial rejected.");

			nIndex = kUnchangedIndex;
			Require(!GetEntityIndexFromIntegerHandleValue(kInvalidHandle, nIndex) && (nIndex == kUnchangedIndex), "Invalid sentinel accepted.");
			Require(!GetEntityIndexFromIntegerHandleValue(1, nIndex) && (nIndex == kUnchangedIndex), "Absent entry accepted.");

			Entity.m_Handle.m_unValue = kInvalidHandle;
			Output.m_unValue = kOutputHandleValue;
			Require(!GetEntityBaseHandleFromEdictAddress(&Edict, Output) && (Output.ToInt() == kOutputHandleValue), "Invalid live handle modified output.");

			Entity.m_Handle.m_unValue = 0;
			Network.m_pHandleEntity = nullptr;
			Require(!GetEntityBaseHandleFromEdictAddress(&Edict, Output) && (Output.ToInt() == kOutputHandleValue), "Missing handle entity accepted.");

			Edict.m_pNetworkable = nullptr;
			Require(!GetEntityBaseHandleFromEdictAddress(&Edict, Output) && (Output.ToInt() == kOutputHandleValue), "Missing networkable accepted.");

			Edict.m_pNetworkable = &Network;
			Network.m_pHandleEntity = &Entity;
			Edict.m_bFree = true;
			Require(!GetEntityBaseHandleFromEdictAddress(&Edict, Output) && (Output.ToInt() == kOutputHandleValue), "Free edict accepted.");
			Require(!GetEntityIndexFromIntegerHandleValue(0, nIndex) && (nIndex == kUnchangedIndex), "Free live slot accepted.");
			Require(!GetEntityBaseHandleFromEdictAddress(nullptr, Output) && (Output.ToInt() == kOutputHandleValue), "Null edict accepted.");

			g_pLiveEdict = nullptr;
		}

	} // namespace
} // namespace SourceJS

int main() {
	try {
		SourceJS::CheckDelayedInputs();
		SourceJS::CheckNames();
		SourceJS::CheckHandles();
		std::puts("EntityInputContracts PASS: native rollback and live handle identity; SDK/world storage adapted, no engine/ABI claim.");

		return 0;
	} catch (std::exception const& Error) {
		SourceJS::g_pWorldEntity = nullptr;
		SourceJS::g_pLiveEdict = nullptr;
		std::fprintf(stderr, "EntityInputContracts failed: %s\n", Error.what());
		return 1;
	}
}
