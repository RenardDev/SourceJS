#pragma once

#ifndef _SOURCEJSMEMORYHOOKMANAGER_H_
#define _SOURCEJSMEMORYHOOKMANAGER_H_

// C++
#include <cstddef>
#include <cstdint>

// STL
#include <list>
#include <map>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

// Detours
#if defined(_WIN32)
// Detours defines a function-like EXPORT; preserve the caller's SDK macro.
#pragma push_macro("EXPORT")
#undef EXPORT
#endif
#include "Detours.h"
#if defined(_WIN32)
#pragma pop_macro("EXPORT")
#endif

// V8
#if defined(min)
#pragma push_macro("min")
#undef min
#define SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MIN
#endif
#if defined(max)
#pragma push_macro("max")
#undef max
#define SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MAX
#endif
#include <v8.h>
#if defined(SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MAX)
#pragma pop_macro("max")
#undef SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MAX
#endif
#if defined(SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MIN)
#pragma pop_macro("min")
#undef SOURCEJS_MEMORYHOOKMANAGER_RESTORE_MIN
#endif

// ----------------------------------------------------------------
// MemoryHookManager
// ----------------------------------------------------------------

// Compatibility profile (4.1/9.5): the reserved guard and tagged enum/frame typedefs are intentional.
// Fixed int enum values are binding contracts; the post context is a checked native assembly layout.
namespace SourceJS {

	class V8Runtime;

	typedef enum _HOOK_TYPE : int {
		HOOKTYPE_PRE = 0,
		HOOKTYPE_POST
	} HOOK_TYPE, *PHOOK_TYPE;

	typedef enum _DATA_TYPE : int {
		DATA_TYPE_VOID = 0,
		DATA_TYPE_BOOL,
		DATA_TYPE_CHAR,
		DATA_TYPE_UCHAR,
		DATA_TYPE_SHORT,
		DATA_TYPE_USHORT,
		DATA_TYPE_INT,
		DATA_TYPE_UINT,
		DATA_TYPE_LONG,
		DATA_TYPE_ULONG,
		DATA_TYPE_LONG_LONG,
		DATA_TYPE_ULONG_LONG,
		DATA_TYPE_FLOAT,
		DATA_TYPE_DOUBLE,
		DATA_TYPE_ADDRESS,
		DATA_TYPE_STRING
	} DATA_TYPE, *PDATA_TYPE;

	struct MemoryHookSignature {
		MemoryHookSignature();

		std::string m_strConvention;
		DATA_TYPE m_ReturnType;
		std::vector<DATA_TYPE> m_vecArgumentTypes;
	};

	// Private assembly frame; the value alias preserves all C++ call sites.
	typedef struct _MEMORY_HOOK_POST_CONTEXT {
		std::uintptr_t m_unInteger;
		std::uintptr_t m_unSecondInteger;
#if defined(DETOURS_ARCH_X64)
		double m_dblDouble;
#elif defined(DETOURS_ARCH_X86)
		Detours::Hook::RAW_CONTEXT_FPU m_FPU;
#else
#error Post-hook return context requires the supported x86/x64 ABI
#endif
	} MemoryHookPostContext, *PMemoryHookPostContext;

	static_assert(std::is_standard_layout_v<MemoryHookPostContext>);
	static_assert(std::is_trivially_copyable_v<MemoryHookPostContext>);
	static_assert(offsetof(MemoryHookPostContext, m_unInteger) == 0);
	static_assert(offsetof(MemoryHookPostContext, m_unSecondInteger) == sizeof(std::uintptr_t));
#if defined(DETOURS_ARCH_X64)
	static_assert(offsetof(MemoryHookPostContext, m_dblDouble) == (2 * sizeof(std::uintptr_t)));
#elif defined(DETOURS_ARCH_X86)
	static_assert(offsetof(MemoryHookPostContext, m_FPU) == (2 * sizeof(std::uintptr_t)));
	static_assert(sizeof(Detours::Hook::RAW_CONTEXT_FPU) == 108);
	static_assert(alignof(MemoryHookPostContext) <= sizeof(std::uintptr_t));
#endif

	struct MemoryHookPostFrame {
		int m_nHookID;
		void* m_pReturnSlot;
		void* m_pReturnAddress;
		std::vector<std::uint64_t> m_vecArguments;
	};

	struct MemoryHookCallbackRecord {
		v8::Global<v8::Context> m_Context;
		v8::Global<v8::Function> m_Function;
	};

	struct MemoryHookRecord {
		int m_nID;
		void* m_pAddress;
		void* m_pThunk;
		std::size_t m_unThunkSize;
		std::uintptr_t m_unDispatchAddress;
		MemoryHookSignature m_Signature;
		std::vector<v8::Global<v8::Context>> m_vecOwnerContexts;
		std::unique_ptr<Detours::Hook::RawHook> m_pHook;
	};

	// Game-thread confined, including native hook entry; synchronous registry edits are supported.
	// The borrowed V8Runtime must outlive installed hooks and pending frames; payloads borrow the active frame.
	class MemoryHookManager {
	public:
		MemoryHookManager();
		~MemoryHookManager() noexcept;
		MemoryHookManager(MemoryHookManager const&) = delete;
		MemoryHookManager& operator=(MemoryHookManager const&) = delete;

	public:
		void Initialize(V8Runtime* const pV8Runtime);
		void Shutdown() noexcept;
		bool IsInitialized() const noexcept;

	public:
		// Creation outputs distinguish a new native record from an existing or reentrant record.
		// A nonzero native dispatch address uses the same ABI as the ordinary raw hook bridge.
		int CreateFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbRecordCreatedOut = nullptr, const std::uintptr_t unDispatchAddress = 0);
		int CreateVTable(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbRecordCreatedOut = nullptr);
		// Optional output becomes true once the native call completes; earlier failures leave it unchanged.
		v8::Local<v8::Value> CallFunction(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, bool* const pbNativeCallCompletedOut = nullptr);
		bool AddCallback(const int nHookID, const HOOK_TYPE HookType, v8::Local<v8::Function> const LocalFunction);
		bool RemoveCallback(const int nHookID, const HOOK_TYPE HookType, v8::Local<v8::Function> const LocalFunction);
		bool Remove(const int nHookID);
		void RemoveContext(v8::Local<v8::Context> const LocalContext);
		bool RemoveAll() noexcept;
		bool HandleHook(const int nHookID, Detours::Hook::PRAW_CONTEXT const pRawContext);
		void* HandlePostHook(void* const pReturnSlot, PMemoryHookPostContext const pPostContext) noexcept;
		v8::Local<v8::Object> MakeHookObject(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, const int nHookID, bool const* const pbRecordCreated = nullptr);
		v8::Local<v8::Array> GetHooks(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) const;
		void SetDisabled(const bool bDisabled) noexcept;
		bool IsDisabled() const noexcept;

	public:
		bool SetArgumentFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue);
		bool SetReturnFromValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalValue);

	private:
		std::shared_ptr<MemoryHookRecord> FindRecord(const int nHookID) noexcept;
		std::shared_ptr<MemoryHookRecord> FindRecord(void const* const pAddress) noexcept;
		std::vector<MemoryHookCallbackRecord> CopyCallbacks(const int nHookID, const HOOK_TYPE HookType, v8::Isolate* const pIsolate) const;
		MemoryHookSignature BuildSignature(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const;
		void* ReadAddress(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions, char const* const pszName) const;
		void* ReadVTableAddress(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const;
		DATA_TYPE ReadDataType(v8::Isolate* const pIsolate, v8::Local<v8::Value> const LocalValue) const;
		std::vector<DATA_TYPE> ReadArgumentTypes(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalOptions) const;
		void* CreateThunk(const int nHookID, std::size_t& unThunkSizeOut, const std::uintptr_t unDispatchAddress = 0) const noexcept;
		void* CreatePostThunk(std::size_t& unThunkSizeOut) const;
		void ReleaseThunk(void* const pThunk, const std::size_t unThunkSize) const noexcept;
		v8::Local<v8::Value> MakeDataTypeValue(const DATA_TYPE DataType, const std::uint64_t unDataValue, v8::Isolate* const pIsolate) const;
		v8::Local<v8::Value> GetArgumentValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, v8::Isolate* const pIsolate) const;
		v8::Local<v8::Value> GetReturnValue(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, v8::Isolate* const pIsolate) const;
		std::uint64_t ReadArgumentRaw(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex) const noexcept;
		void WriteArgumentRaw(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, const int nArgumentIndex, const std::uint64_t unValue) const noexcept;
		std::uintptr_t* GetStackSlot(Detours::Hook::PRAW_CONTEXT const pRawContext, const std::size_t unOffset) const noexcept;
		bool HasCallbacks(const int nHookID, const HOOK_TYPE HookType) const noexcept;
		void CaptureArguments(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext, std::vector<std::uint64_t>& vecArgumentsOut) const;
		bool InstallPostFrame(MemoryHookRecord const& HookRecord, Detours::Hook::PRAW_CONTEXT const pRawContext);
		void RunPostCallbacks(MemoryHookRecord const& HookRecord, MemoryHookPostFrame const& PostFrame, PMemoryHookPostContext const pPostContext);
		static void LoadReturnContext(MemoryHookPostContext const& PostContext, Detours::Hook::RAW_CONTEXT& RawContextOut) noexcept;
		static void StoreReturnContext(Detours::Hook::RAW_CONTEXT const& RawContext, MemoryHookPostContext& PostContextOut) noexcept;
		char const* StoreString(const int nHookID, std::string const& strValue);
		void ResetCallbacks(const int nHookID) noexcept;

	private:
		V8Runtime* m_pV8Runtime;
		// Dispatchers retain records while callbacks can mutate the registry.
		std::vector<std::shared_ptr<MemoryHookRecord>> m_vecHookRecords;
		std::map<int, std::map<HOOK_TYPE, std::vector<MemoryHookCallbackRecord>>> m_mapCallbacks;
		std::map<void*, MemoryHookPostFrame> m_mapPostFrames;
		std::map<int, std::list<std::string>> m_mapStringStorage;
		void* m_pPostThunk;
		std::size_t m_unPostThunkSize;
		int m_nNextHookID;
		bool m_bDisabled;
		bool m_bInitialized;
	};
} // namespace SourceJS
#endif // _SOURCEJSMEMORYHOOKMANAGER_H_
