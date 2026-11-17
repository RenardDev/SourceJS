#include "sourcejs/HookManager.h"

// STL
#include <limits>

// Project
#include "sourcejs/V8Runtime.h"

// ================================================================
// HookManager
// ================================================================

namespace SourceJS {

	HookManager::HookManager() noexcept {
		m_pV8Runtime = nullptr;
	}

	void HookManager::Initialize(V8Runtime* const pV8Runtime) noexcept {
		m_pV8Runtime = pV8Runtime;
	}

	void HookManager::Shutdown() noexcept {
		m_vecHooks.clear();

		m_pV8Runtime = nullptr;
	}

	HookRecord& HookManager::FindOrCreateHook(std::string const& strHookName, std::string const& strHookKind) {
		for (std::size_t unHookIndex = 0; unHookIndex < m_vecHooks.size(); ++unHookIndex) {
			if (m_vecHooks[unHookIndex].m_strName == strHookName) {
				return m_vecHooks[unHookIndex];
			}
		}

		HookRecord HookInformation {};
		HookInformation.m_strName = strHookName;
		HookInformation.m_strKind = strHookKind;
		m_vecHooks.push_back(HookInformation);

		return m_vecHooks.back();
	}

	void HookManager::Emit(std::string const& strHookName, std::string const& strPayload) {
		if (strHookName.empty()) {
			return;
		}

		// Inputs may borrow a hook record; vector growth and reentrant dispatch must not invalidate them.
		std::string const strDispatchHookName = strHookName;
		std::string const strDispatchPayload = strPayload;
		HookRecord& HookInformation = FindOrCreateHook(strDispatchHookName, "vsp");
		if (HookInformation.m_unDispatchCount < std::numeric_limits<std::size_t>::max()) {
			++HookInformation.m_unDispatchCount;
		}

		if (m_pV8Runtime) {
			m_pV8Runtime->EmitEvent(strDispatchHookName, strDispatchPayload);
		}
	}

	std::vector<HookRecord> const& HookManager::GetHooks() const noexcept {
		return m_vecHooks;
	}
} // namespace SourceJS
