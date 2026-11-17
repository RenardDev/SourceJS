
#if !defined(_WIN32)
// The explicit ELF label keeps this private object's symbol stable across C++ compilers.
extern "C" {
	static constinit int g_nSourceJSHiddenBinaryProbe asm("g_nSourceJSHiddenBinaryProbe") = 91;
}

extern "C" void* SourceJSNativeBinaryHiddenAddress() noexcept {
	return &g_nSourceJSHiddenBinaryProbe;
}
#endif

extern "C" int SourceJSNativeBinaryProbe() noexcept {
	return 73;
}
