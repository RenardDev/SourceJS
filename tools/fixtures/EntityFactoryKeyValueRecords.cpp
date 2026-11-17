
// C++
#include <cstddef>
#include <cstdio>
#include <exception>
#include <utility>

// STL
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

// SDK facade: exact Vector field/method spelling; deleted copy construction detects
// implicit SDK copies. This is not a real SDK/V8/server or allocation-failure test.
class Vector {
public:
	Vector();
	Vector(const float flX, const float flY, const float flZ);
	Vector(Vector const&) = delete;
	Vector& operator=(Vector const&) = default;

	void Init(const float flX, const float flY, const float flZ);

	float x;
	float y;
	float z;
};

Vector::Vector() {
	x = std::numeric_limits<float>::quiet_NaN();
	y = std::numeric_limits<float>::quiet_NaN();
	z = std::numeric_limits<float>::quiet_NaN();
}

Vector::Vector(const float flX, const float flY, const float flZ) :
	x(flX),
	y(flY),
	z(flZ)
{
}

void Vector::Init(const float flX, const float flY, const float flZ) {
	x = flX;
	y = flY;
	z = flZ;
}

namespace SourceJS {

	// SOURCEJS_ENTITY_FACTORY_KEY_VALUE_RECORD

	namespace {

		void ShowUsage(std::FILE* const pOutputFile) {
			std::fprintf(pOutputFile, "Usage: EntityFactoryKeyValueRecords [-h | --help]\n");
			std::fprintf(pOutputFile, "Run default, copy/move, assignment and reallocation checks for every record kind.\n");
		}

		void Require(const bool bCondition, char const* const pszMessage) {
			if (!bCondition) {
				throw std::runtime_error(pszMessage);
			}
		}

		void CheckDefault() {
			EntityFactoryKeyValue Value {};
			Require(Value.m_strKey.empty() && Value.m_strValue.empty(), "default strings");
			Require(Value.m_Type == EntityFactoryKeyValueType::String, "default type");
			Require(Value.m_flValue == 0.0f, "default float");
			Require((Value.m_Vector.x == 0.0f) && (Value.m_Vector.y == 0.0f) && (Value.m_Vector.z == 0.0f), "default vector");
		}

		void CheckValue(EntityFactoryKeyValue const& Value, const EntityFactoryKeyValueType TypeValue) {
			Require(Value.m_strKey == "FactoryKey", "key preserved");
			Require(Value.m_strValue == "FactoryValue", "string preserved");
			Require(Value.m_Type == TypeValue, "type preserved");
			Require(Value.m_flValue == -17.5f, "float preserved");
			Require((Value.m_Vector.x == 2.0f) && (Value.m_Vector.y == -3.0f) && (Value.m_Vector.z == 4.0f), "vector components preserved");
		}

		void CheckTransfers(const EntityFactoryKeyValueType TypeValue) {
			constexpr std::size_t kRecordCount = 65;

			EntityFactoryKeyValue Original {};
			Original.m_strKey = "FactoryKey";
			Original.m_Type = TypeValue;
			Original.m_strValue = "FactoryValue";
			Original.m_flValue = -17.5f;
			Original.m_Vector.Init(2.0f, -3.0f, 4.0f);

			EntityFactoryKeyValue const Copied = Original;
			CheckValue(Copied, TypeValue);
			CheckValue(Original, TypeValue);

			EntityFactoryKeyValue Moved = std::move(Original);
			CheckValue(Moved, TypeValue);

			EntityFactoryKeyValue Assigned {};
			Assigned = Copied;
			CheckValue(Assigned, TypeValue);

			EntityFactoryKeyValue MoveAssigned {};
			MoveAssigned = std::move(Assigned);
			CheckValue(MoveAssigned, TypeValue);

			std::vector<EntityFactoryKeyValue> vecRecords {};
			for (std::size_t unRecordIndex = 0; unRecordIndex < kRecordCount; ++unRecordIndex) {
				vecRecords.push_back(Copied);
			}

			Require(vecRecords.capacity() < vecRecords.max_size(), "reallocation capacity");
			vecRecords.reserve(vecRecords.capacity() + 1);

			for (auto const& Value : vecRecords) {
				CheckValue(Value, TypeValue);
			}

			std::vector<EntityFactoryKeyValue> vecCopied = vecRecords;
			std::vector<EntityFactoryKeyValue> vecMoved = std::move(vecCopied);
			Require(vecMoved.size() == kRecordCount, "container transfer count");
			for (auto const& Value : vecMoved) {
				CheckValue(Value, TypeValue);
			}
		}
	} // namespace
} // namespace SourceJS

int main(const int nArgumentCount, char** ppszArguments) {
	static_assert(std::is_nothrow_move_constructible_v<SourceJS::EntityFactoryKeyValue>, "Record moves must retain their nonthrowing contract.");

	if (nArgumentCount > 1) {
		std::string_view const strvArgument = ppszArguments[1];
		if ((nArgumentCount == 2) && ((strvArgument == "-h") || (strvArgument == "--help"))) {
			SourceJS::ShowUsage(stdout);
			return 0;
		}

		std::fprintf(stderr, "[ERROR] Unsupported entity-factory record test arguments.\n");
		SourceJS::ShowUsage(stderr);
		return 2;
	}

	try {
		SourceJS::CheckDefault();
		SourceJS::CheckTransfers(SourceJS::EntityFactoryKeyValueType::String);
		SourceJS::CheckTransfers(SourceJS::EntityFactoryKeyValueType::Float);
		SourceJS::CheckTransfers(SourceJS::EntityFactoryKeyValueType::Vector);
		std::puts("EntityFactoryKeyValueRecords PASS: defaults, copy/move/assign and reallocating containers for all kinds; implicit SDK copy construction forbidden.");

		return 0;
	} catch (std::exception const& Error) {
		std::fprintf(stderr, "[ERROR] EntityFactoryKeyValueRecords failed: %s\n", Error.what());
		return 1;
	}
}
