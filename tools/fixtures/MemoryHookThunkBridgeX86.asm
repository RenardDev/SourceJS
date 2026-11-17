
; Test-only MASM x86 C ABI, counterpart of MemoryHookThunkBridge.S.
.386
.model flat, C
option casemap:none

EXTERN FixtureDispatchRawHook:PROC
EXTERN FixtureDispatchPostHook:PROC
EXTERN g_unRawBridgeStack:DWORD
EXTERN g_unPostBridgeStack:DWORD
EXTERN g_unEntryStack:DWORD
EXTERN g_unExitStack:DWORD
EXTERN g_unEntryBase:DWORD
EXTERN g_unExitBase:DWORD
EXTERN g_unReturnInteger:DWORD
EXTERN g_unReturnSecondInteger:DWORD
EXTERN g_pCallerContinuation:DWORD
EXTERN g_pBridgeContinuation:DWORD

.code

DispatchSourceJSRawHook PROC PUBLIC
	mov g_unRawBridgeStack, esp
	jmp FixtureDispatchRawHook
DispatchSourceJSRawHook ENDP

DispatchSourceJSPostHook PROC PUBLIC
	mov g_unPostBridgeStack, esp
	jmp FixtureDispatchPostHook
DispatchSourceJSPostHook ENDP

InvokePostInteger PROC PUBLIC
	jmp InvokePostValue
InvokePostInteger ENDP

InvokePostDouble PROC PUBLIC
	jmp InvokePostValue
InvokePostDouble ENDP

InvokePostFloat PROC PUBLIC
	jmp InvokePostValue
InvokePostFloat ENDP

InvokePostValue PROC
	mov g_unEntryStack, esp
	mov g_unEntryBase, ebp
	mov eax, [esp]
	mov g_pCallerContinuation, eax
	mov g_pBridgeContinuation, OFFSET PostContinuation
	mov eax, [esp+8]
	mov [esp], eax
	jmp DWORD PTR [esp+4]
PostContinuation:
	mov g_unExitStack, esp
	mov g_unExitBase, ebp
	mov g_unReturnInteger, eax
	mov g_unReturnSecondInteger, edx
	jmp g_pCallerContinuation
InvokePostValue ENDP

END
