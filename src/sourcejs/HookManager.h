#pragma once

#ifndef _SOURCEJSHOOKMANAGER_H_
#define _SOURCEJSHOOKMANAGER_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// C++
#include <cstddef>

// STL
#include <string>
#include <vector>

// ================================================================
// HookManager
// ================================================================

namespace SourceJS {

	class V8Runtime;

	// Value-initialize records before use; the manager owns the strings and observation count.
	struct HookRecord {
		std::string m_strName;
		std::string m_strKind;

		// Observed dispatch count saturates at the native size limit instead of wrapping.
		std::size_t m_unDispatchCount;
	};

	// Game-thread confined; no internal synchronization. Runtime dispatch is synchronous on that thread.
	class HookManager {
	public:
		HookManager() noexcept;

	public:
		// Borrows the runtime until replacement or Shutdown; nullptr detaches it without clearing observations.
		void Initialize(V8Runtime* const pV8Runtime) noexcept;

		// Clears observations and detaches the runtime; safe to repeat, including during a dispatch callback.
		void Shutdown() noexcept;

		// Empty names are ignored; detached managers still count observations. Allocation/runtime failures may throw.
		// Copies input strings before mutation; nested Emit or Shutdown may change the registry during dispatch.
		void Emit(std::string const& strHookName, std::string const& strPayload);

	public:
		// Borrows the manager's vector. Do not retain element references across Emit or Shutdown.
		std::vector<HookRecord> const& GetHooks() const noexcept;

	private:
		HookRecord& FindOrCreateHook(std::string const& strHookName, std::string const& strHookKind);

	private:
		V8Runtime* m_pV8Runtime;
		std::vector<HookRecord> m_vecHooks;
	};
} // namespace SourceJS
#endif // _SOURCEJSHOOKMANAGER_H_
