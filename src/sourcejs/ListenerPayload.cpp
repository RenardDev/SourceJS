#include "sourcejs/ListenerPayload.h"

// C++
#include <cstddef>
#include <cstdint>

// STL
#include <locale>
#include <stdexcept>

// ================================================================
// Listener payload
// ================================================================

namespace SourceJS {

	ListenerPayloadBuilder::ListenerPayloadBuilder() {
		m_bHasValue = false;
		m_bBuilt = false;

		// JSON numbers must ignore the process locale, and a failed write must never yield a partial payload.
		m_OutputStream.exceptions(std::ios::badbit | std::ios::failbit);
		m_OutputStream.imbue(std::locale::classic());

		m_OutputStream << "{\"Arguments\":[";
	}

	void ListenerPayloadBuilder::AddString(std::string const& strValue) {
		BeginValue();
		WriteJSONString(strValue);
	}

	void ListenerPayloadBuilder::AddInteger(const int nValue) {
		BeginValue();
		m_OutputStream << nValue;
	}

	void ListenerPayloadBuilder::AddIntegerArray(std::vector<int> const& vecValues) {
		BeginValue();
		m_OutputStream << "[";

		for (std::size_t unValueIndex = 0; unValueIndex < vecValues.size(); ++unValueIndex) {
			if (unValueIndex > 0) {
				m_OutputStream << ",";
			}

			m_OutputStream << vecValues[unValueIndex];
		}

		m_OutputStream << "]";
	}

	void ListenerPayloadBuilder::AddAddress(void const* const pAddress) {
		BeginValue();
		m_OutputStream << "{\"$SourceJSBigInt\":\"" << reinterpret_cast<std::uintptr_t>(pAddress) << "\"}";
	}

	std::string ListenerPayloadBuilder::Build() {
		if (!m_bBuilt) {
			m_OutputStream << "]}";
			m_bBuilt = true;
		}

		return m_OutputStream.str();
	}

	void ListenerPayloadBuilder::WriteJSONString(std::string const& strValue) {
		constexpr char kHexDigits[] = "0123456789abcdef";
		constexpr unsigned char kControlCharacterLimit = 0x20;
		constexpr unsigned char kHexDigitMask = 0x0F;
		constexpr int kHexDigitShift = 4;

		m_OutputStream << "\"";

		for (auto const& chCharacter : strValue) {
			const unsigned char chUnsignedCharacter = static_cast<unsigned char>(chCharacter);

			switch (chCharacter) {
				case '\\':
					m_OutputStream << "\\\\";
					break;

				case '"':
					m_OutputStream << "\\\"";
					break;

				case '\b':
					m_OutputStream << "\\b";
					break;

				case '\f':
					m_OutputStream << "\\f";
					break;

				case '\n':
					m_OutputStream << "\\n";
					break;

				case '\r':
					m_OutputStream << "\\r";
					break;

				case '\t':
					m_OutputStream << "\\t";
					break;

				default:
					if (chUnsignedCharacter < kControlCharacterLimit) {
						m_OutputStream << "\\u00" << kHexDigits[chUnsignedCharacter >> kHexDigitShift] << kHexDigits[chUnsignedCharacter & kHexDigitMask];

					} else {
						m_OutputStream << chCharacter;
					}

					break;
			}
		}

		m_OutputStream << "\"";
	}

	void ListenerPayloadBuilder::BeginValue() {
		if (m_bBuilt) {
			throw std::logic_error("Listener payload has already been built.");
		}

		if (m_bHasValue) {
			m_OutputStream << ",";
		}

		m_bHasValue = true;
	}
} // namespace SourceJS
