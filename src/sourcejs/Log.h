#pragma once

#ifndef _SOURCEJSLOG_H_
#define _SOURCEJSLOG_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// ================================================================
// Log
// ================================================================

namespace SourceJS {

	// Thread-local client echo context; construct/destroy nested scopes in LIFO order on the same thread.
	// Positive indices must identify clients; nonpositive indices temporarily disable client echo.
	// Borrows the client identity only; it neither owns nor extends the client's lifetime.
	class ClientConsoleLogScope {
	public:
		explicit ClientConsoleLogScope(const int nClientIndex) noexcept;
		~ClientConsoleLogScope() noexcept;

		ClientConsoleLogScope(ClientConsoleLogScope const&) = delete;
		ClientConsoleLogScope& operator=(ClientConsoleLogScope const&) = delete;

	private:
		int m_nPreviousClientIndex;
	};

	// Synchronous, best-effort output on the server/game thread; SDK sinks must not throw.
	// May allocate, block and change errno/platform error state. No delivery status is returned.
	// pszFormat must be a valid NUL-terminated printf format with matching arguments; nullptr logs an empty record.
	// Formatting/storage failures or embedded NUL in formatted output produce an ERROR diagnostic, not clipped success.
	// If line allocation alone fails, the complete formatted message falls back to stdio instead of SDK/client sinks.
	void LogInfo(char const* const pszFormat, ...) noexcept;
	void LogWarning(char const* const pszFormat, ...) noexcept;
	void LogError(char const* const pszFormat, ...) noexcept;
} // namespace SourceJS
#endif // _SOURCEJSLOG_H_
