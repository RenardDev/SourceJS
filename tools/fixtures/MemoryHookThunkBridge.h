#pragma once

#ifndef _SOURCEJSMEMORYHOOKTHUNKBRIDGE_H_
#define _SOURCEJSMEMORYHOOKTHUNKBRIDGE_H_

// C++
#include <cstdint>

// Third-party
#include <Detours.h>

// Minimum incomplete-type contract for the assembly bridge boundary.
namespace SourceJS {
	struct _MEMORY_HOOK_POST_CONTEXT;
} // namespace SourceJS

// Assembly-defined fixture ABI. These declarations are needed across translation
// units; there is no SDK header for these test-only entry points. Undecorated
// names are the shared C/MASM/GNU-assembler contract, not production exports.
extern "C" {
	bool DispatchSourceJSRawHook(Detours::Hook::PRAW_CONTEXT pRawContext, int nHookID) noexcept;
	void* DispatchSourceJSPostHook(void* pReturnSlot, SourceJS::_MEMORY_HOOK_POST_CONTEXT* pPostContext) noexcept;
	std::uint64_t InvokePostInteger(void* pTarget, void* pThunk);
	double InvokePostDouble(void* pTarget, void* pThunk);
	float InvokePostFloat(void* pTarget, void* pThunk);

	extern std::uintptr_t g_unRawBridgeStack;
	extern std::uintptr_t g_unPostBridgeStack;
	extern std::uintptr_t g_unEntryStack;
	extern std::uintptr_t g_unExitStack;
	extern std::uintptr_t g_unEntryBase;
	extern std::uintptr_t g_unExitBase;
	extern std::uintptr_t g_unReturnInteger;
	extern std::uintptr_t g_unReturnSecondInteger;
	extern void* g_pCallerContinuation;
	extern void* g_pBridgeContinuation;
}

#endif // _SOURCEJSMEMORYHOOKTHUNKBRIDGE_H_
