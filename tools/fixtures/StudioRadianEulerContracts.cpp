
// C++
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>

// STL
#include <array>
#include <limits>

// Controlled v8 API spellings for the extracted factory; this is not V8 execution or ABI validation.
namespace v8 {

	class Isolate {
	public:
		Isolate();
		void MarkFailure() noexcept;
		bool IsExecutionTerminating() const noexcept;
		bool HasPendingException() const noexcept;
		bool HasFailure() const noexcept;

	private:
		bool m_bFailure;
	};

	Isolate::Isolate() {
		m_bFailure = false;
	}

	void Isolate::MarkFailure() noexcept {
		m_bFailure = true;
	}

	bool Isolate::IsExecutionTerminating() const noexcept {
		return false;
	}

	bool Isolate::HasPendingException() const noexcept {
		return false;
	}

	bool Isolate::HasFailure() const noexcept {
		return m_bFailure;
	}

	struct Context {};

	template <typename T>
	class Local {
	public:
		Local() {
			m_pValue = nullptr;
		}

		explicit Local(T* const pValue) :
			m_pValue(pValue)
		{
		}

		bool IsEmpty() const noexcept {
			return m_pValue == nullptr;
		}

		T* operator->() const noexcept {
			return m_pValue;
		}

	private:
		T* m_pValue;
	};

	class TryCatch {
	public:
		explicit TryCatch(Isolate*);
		bool HasCaught() const noexcept;
	};

	TryCatch::TryCatch(Isolate*) {
	}

	bool TryCatch::HasCaught() const noexcept {
		return false;
	}

	struct FloatBinding {
		char const* m_pszName;
		float* m_pflValue;
	};

	constexpr std::size_t kComponentCount = 3;

	class Object {
	public:
		Object();
		static Local<Object> New(Isolate*);
		bool BindFloat(char const* const pszName, float* const pflValue);
		void SetAddress(const std::uintptr_t unAddress) noexcept;
		float* FindFloat(char const* const pszName) const;
		std::uintptr_t GetAddress() const noexcept;
		std::size_t GetBindingCount() const noexcept;

	private:
		std::array<FloatBinding, kComponentCount> m_arrBindings;
		std::size_t m_unBindingCount;
		std::uintptr_t m_unAddress;
	};

	Object::Object() :
		m_arrBindings {}
	{
		m_unBindingCount = 0;
		m_unAddress = 0;
	}

	Local<Object> Object::New(Isolate*) {
		static Object s_Object {};

		return Local<Object>(&s_Object);
	}

	bool Object::BindFloat(char const* const pszName, float* const pflValue) {
		if (!pszName || !pflValue || (m_unBindingCount >= m_arrBindings.size()) || FindFloat(pszName)) {
			return false;
		}

		m_arrBindings[m_unBindingCount] = FloatBinding { pszName, pflValue };
		++m_unBindingCount;

		return true;
	}

	void Object::SetAddress(const std::uintptr_t unAddress) noexcept {
		m_unAddress = unAddress;
	}

	// Callers supply validated binding names or names from the fixed literal case table.
	float* Object::FindFloat(char const* const pszName) const {
		for (std::size_t unBindingIndex = 0; unBindingIndex < m_unBindingCount; ++unBindingIndex) {
			FloatBinding const& Binding = m_arrBindings[unBindingIndex];
			if (std::strcmp(Binding.m_pszName, pszName) == 0) {
				return Binding.m_pflValue;
			}
		}

		return nullptr;
	}

	std::uintptr_t Object::GetAddress() const noexcept {
		return m_unAddress;
	}

	std::size_t Object::GetBindingCount() const noexcept {
		return m_unBindingCount;
	}

} // namespace v8

namespace StudioRadianEulerContracts {

	// Exact SDK field spellings and semantics, not its ABI: RadianEuler x=roll, y=pitch, z=yaw.
	// Public Pitch/Yaw/Roll properties bind y/z/x; writes retain native radian units.
	struct RadianEuler {
		float x;
		float y;
		float z;
	};

	struct ComponentCase {
		char const* m_pszName;
		float* m_pflValue;
		float m_flInitialValue;
		float m_flWrittenValue;
	};

	void RethrowV8InstallationFailure(v8::Isolate* const pIsolate, v8::TryCatch&, char const*) {
		pIsolate->MarkFailure();
	}

	bool IsMemoryAddressRangeRepresentable(const std::uintptr_t unAddress, const std::size_t unSize) noexcept {
		return (unAddress != 0) && ((unSize == 0) || ((unSize - 1) <= (std::numeric_limits<std::uintptr_t>::max() - unAddress)));
	}

	bool InstallStudioAddress(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, void const* const pAddress) {
		if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty()) {
			return false;
		}

		LocalObject->SetAddress(reinterpret_cast<std::uintptr_t>(pAddress));

		return true;
	}

	bool InstallStudioFloatProperty(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszName, float* const pflValue) {
		if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty()) {
			return false;
		}

		return LocalObject->BindFloat(pszName, pflValue);
	}

	// SOURCEJS_STUDIO_RADIAN_EULER_FACTORY

	bool Run() {
		constexpr float kInitialRoll = 0.125F;
		constexpr float kInitialPitch = 0.25F;
		constexpr float kInitialYaw = 0.5F;
		constexpr float kWrittenPitch = 1.0F;
		constexpr float kWrittenYaw = 2.0F;
		constexpr float kWrittenRoll = 4.0F;

		// The mock singleton view retains borrowed component addresses until process exit.
		static constinit RadianEuler s_NativeAngles { kInitialRoll, kInitialPitch, kInitialYaw };

		v8::Isolate Isolate {};
		v8::Context Context {};
		v8::Local<v8::Context> const LocalContext(&Context);
		v8::Local<v8::Object> const LocalView = MakeStudioRadianEulerObject(&Isolate, LocalContext, &s_NativeAngles);
		if (LocalView.IsEmpty() || Isolate.HasFailure() || (LocalView->GetAddress() != reinterpret_cast<std::uintptr_t>(&s_NativeAngles)) || (LocalView->GetBindingCount() != v8::kComponentCount)) {
			return false;
		}

		std::array<ComponentCase, v8::kComponentCount> const arrCases = { ComponentCase { "Pitch", &s_NativeAngles.y, kInitialPitch, kWrittenPitch }, ComponentCase { "Yaw", &s_NativeAngles.z, kInitialYaw, kWrittenYaw }, ComponentCase { "Roll", &s_NativeAngles.x, kInitialRoll, kWrittenRoll } };
		for (auto const& Case : arrCases) {
			float* const pflValue = LocalView->FindFloat(Case.m_pszName);
			if ((pflValue != Case.m_pflValue) || (*pflValue != Case.m_flInitialValue)) {
				return false;
			}

			*pflValue = Case.m_flWrittenValue;
		}

		return (s_NativeAngles.x == kWrittenRoll) && (s_NativeAngles.y == kWrittenPitch) && (s_NativeAngles.z == kWrittenYaw);
	}

} // namespace StudioRadianEulerContracts

int main() {
	constexpr std::size_t kBitsPerByte = CHAR_BIT;

	if (!StudioRadianEulerContracts::Run()) {
		std::fputs("StudioRadianEulerContracts failed\n", stderr);
		return 1;
	}

	std::printf("StudioRadianEulerContracts PASS AddressBits=%zu\n", sizeof(void*) * kBitsPerByte);

	return 0;
}
