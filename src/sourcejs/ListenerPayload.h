#pragma once

#ifndef _SOURCEJSLISTENERPAYLOAD_H_
#define _SOURCEJSLISTENERPAYLOAD_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// STL
#include <sstream>
#include <string>
#include <vector>

// ================================================================
// Listener payload
// ================================================================

namespace SourceJS {

	// Single-thread-confined JSON builder; input strings/arrays are copied, never borrowed.
	// Construction, writes and result copying may throw; discard the builder after a failed stream write.
	// A moved-from instance may only be assigned or destroyed.
	class ListenerPayloadBuilder {
	public:
		ListenerPayloadBuilder();

		// Expects UTF-8; escapes JSON control bytes without validating Unicode sequences.
		void AddString(std::string const& strValue);
		void AddInteger(const int nValue);
		void AddIntegerArray(std::vector<int> const& vecValues);

		// Accepts nullptr; writes the exact address through the internal BigInt tag, without dereferencing it.
		void AddAddress(void const* const pAddress);

		// Seals arguments before copying into an owning JSON string; successful repeated calls return the same JSON.
		// Add* after sealing throws std::logic_error.
		std::string Build();

	private:
		void WriteJSONString(std::string const& strValue);
		void BeginValue();

		std::ostringstream m_OutputStream;
		bool m_bHasValue;
		bool m_bBuilt;
	};
} // namespace SourceJS
#endif // _SOURCEJSLISTENERPAYLOAD_H_
