#pragma once

#ifndef _SOURCEJSMANAGERSTATE_H_
#define _SOURCEJSMANAGERSTATE_H_

// Local compatibility profile: Windows/Linux C++20 tests; this canonical
// guard is the only reserved-name exception in this utility (guide 4.1).

// C++
#include <cstddef>
#include <utility>

// STL
#include <string>
#include <vector>

namespace SourceJS {

	namespace Detail {

		// Parse only the generated state schema, not arbitrary JSON. Directory-name
		// validation rejects escapes/control bytes; output changes only on success.
		template <typename TNameValidator>
		bool ParseDisabledManagerNames(std::string const& strState, std::vector<std::string>& vecNamesOut, TNameValidator const& NameValidator) {
			constexpr char kDisabledKey[] = "\"Disabled\"";

			std::vector<std::string> vecNames {};
			std::size_t unOffset = 0;
			auto ConsumeCharacter = [&strState, &unOffset](const char chExpected) -> bool {
				unOffset = strState.find_first_not_of(" \t\r\n", unOffset);
				if ((unOffset == std::string::npos) || (strState[unOffset] != chExpected)) {
					return false;
				}

				++unOffset;

				return true;
			};
			if (!ConsumeCharacter('{')) {
				return false;
			}

			unOffset = strState.find_first_not_of(" \t\r\n", unOffset);
			if ((unOffset == std::string::npos) || (strState.compare(unOffset, sizeof(kDisabledKey) - 1, kDisabledKey) != 0)) {
				return false;
			}

			unOffset += sizeof(kDisabledKey) - 1;
			if (!ConsumeCharacter(':') || !ConsumeCharacter('[')) {
				return false;
			}

			unOffset = strState.find_first_not_of(" \t\r\n", unOffset);
			if ((unOffset != std::string::npos) && (strState[unOffset] != ']')) {
				while (true) {
					if (!ConsumeCharacter('"')) {
						return false;
					}

					const std::size_t unClosingQuoteOffset = strState.find('"', unOffset);
					if (unClosingQuoteOffset == std::string::npos) {
						return false;
					}

					std::string const strName = strState.substr(unOffset, unClosingQuoteOffset - unOffset);
					if (!NameValidator(strName)) {
						return false;
					}

					vecNames.push_back(strName);
					unOffset = strState.find_first_not_of(" \t\r\n", unClosingQuoteOffset + 1);
					if ((unOffset == std::string::npos) || (strState[unOffset] != ',')) {
						break;
					}

					++unOffset;
				}
			}

			if (!ConsumeCharacter(']') || !ConsumeCharacter('}') || (strState.find_first_not_of(" \t\r\n", unOffset) != std::string::npos)) {
				return false;
			}

			vecNamesOut = std::move(vecNames);

			return true;
		}

	} // namespace Detail
} // namespace SourceJS
#endif // _SOURCEJSMANAGERSTATE_H_
