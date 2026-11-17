
; Test-only MASM Windows x64 ABI, counterpart of MemoryHookThunkBridge.S.
option casemap:none

EXTERN FixtureDispatchRawHook:PROC
EXTERN FixtureDispatchPostHook:PROC
EXTERN g_unRawBridgeStack:QWORD
EXTERN g_unPostBridgeStack:QWORD
EXTERN g_unEntryStack:QWORD
EXTERN g_unExitStack:QWORD
EXTERN g_unEntryBase:QWORD
EXTERN g_unExitBase:QWORD
EXTERN g_unReturnInteger:QWORD
EXTERN g_unReturnSecondInteger:QWORD
EXTERN g_pCallerContinuation:QWORD
EXTERN g_pBridgeContinuation:QWORD

.code

PUBLIC DispatchSourceJSRawHook
PUBLIC DispatchSourceJSPostHook
PUBLIC InvokePostInteger
PUBLIC InvokePostDouble
PUBLIC InvokePostFloat

DispatchSourceJSRawHook PROC
	mov g_unRawBridgeStack, rsp
	jmp FixtureDispatchRawHook
DispatchSourceJSRawHook ENDP

DispatchSourceJSPostHook PROC
	mov g_unPostBridgeStack, rsp
	jmp FixtureDispatchPostHook
DispatchSourceJSPostHook ENDP

InvokePostInteger PROC
	jmp InvokePostValue
InvokePostInteger ENDP

InvokePostDouble PROC
	jmp InvokePostValue
InvokePostDouble ENDP

InvokePostFloat PROC
	jmp InvokePostValue
InvokePostFloat ENDP

InvokePostValue PROC
	mov g_unEntryStack, rsp
	mov g_unEntryBase, rbp
	mov rax, [rsp]
	mov g_pCallerContinuation, rax
	lea rax, PostContinuation
	mov g_pBridgeContinuation, rax
	mov [rsp], rdx
	jmp rcx
PostContinuation:
	mov g_unExitStack, rsp
	mov g_unExitBase, rbp
	mov g_unReturnInteger, rax
	mov g_unReturnSecondInteger, rdx
	jmp g_pCallerContinuation
InvokePostValue ENDP

END
