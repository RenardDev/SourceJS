
// GNU assembler fixture shims, linked only into MemoryHookThunkContracts.cpp.
// Tail jumps preserve the bridge arguments and the real entry stack. Recording
// shims do not call C++; x86 adapters realign explicitly inside their own body.
.text
.globl DispatchSourceJSRawHook
.type DispatchSourceJSRawHook, @function
DispatchSourceJSRawHook:
#if defined(__x86_64__)
	movq %rsp, g_unRawBridgeStack(%rip)
#else
	movl %esp, g_unRawBridgeStack
#endif
	jmp FixtureDispatchRawHook
.size DispatchSourceJSRawHook, .-DispatchSourceJSRawHook

.globl DispatchSourceJSPostHook
.type DispatchSourceJSPostHook, @function
DispatchSourceJSPostHook:
#if defined(__x86_64__)
	movq %rsp, g_unPostBridgeStack(%rip)
#else
	movl %esp, g_unPostBridgeStack
#endif
	jmp FixtureDispatchPostHook
.size DispatchSourceJSPostHook, .-DispatchSourceJSPostHook

.globl InvokePostInteger
.type InvokePostInteger, @function
InvokePostInteger:
	jmp InvokePostValue
.size InvokePostInteger, .-InvokePostInteger

.globl InvokePostDouble
.type InvokePostDouble, @function
InvokePostDouble:
	jmp InvokePostValue
.size InvokePostDouble, .-InvokePostDouble

.globl InvokePostFloat
.type InvokePostFloat, @function
InvokePostFloat:
	jmp InvokePostValue
.size InvokePostFloat, .-InvokePostFloat

.type InvokePostValue, @function
InvokePostValue:
#if defined(__x86_64__)
	movq %rsp, g_unEntryStack(%rip)
	movq %rbp, g_unEntryBase(%rip)
	movq (%rsp), %rax
	movq %rax, g_pCallerContinuation(%rip)
	leaq PostContinuation(%rip), %rax
	movq %rax, g_pBridgeContinuation(%rip)
	movq %rsi, (%rsp)
	jmp *%rdi
#else
	movl %esp, g_unEntryStack
	movl %ebp, g_unEntryBase
	movl (%esp), %eax
	movl %eax, g_pCallerContinuation
	movl $PostContinuation, g_pBridgeContinuation
	movl 8(%esp), %eax
	movl %eax, (%esp)
	jmp *4(%esp)
#endif
PostContinuation:
#if defined(__x86_64__)
	movq %rsp, g_unExitStack(%rip)
	movq %rbp, g_unExitBase(%rip)
	movq %rax, g_unReturnInteger(%rip)
	movq %rdx, g_unReturnSecondInteger(%rip)
	jmp *g_pCallerContinuation(%rip)
#else
	movl %esp, g_unExitStack
	movl %ebp, g_unExitBase
	movl %eax, g_unReturnInteger
	movl %edx, g_unReturnSecondInteger
	jmp *g_pCallerContinuation
#endif
.size InvokePostValue, .-InvokePostValue

.section .note.GNU-stack,"",@progbits
