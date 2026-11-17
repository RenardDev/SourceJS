
// Included test fragment for MemoryHookSettersV8.cpp, not a standalone unit.
// Uses extracted production readers; entity lookup alone is a fixture adapter.
	void CheckInt32Values(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr int kOriginalValue = 73;
		constexpr double kMinimum = static_cast<double>(std::numeric_limits<std::int32_t>::min());
		constexpr double kMaximum = static_cast<double>(std::numeric_limits<std::int32_t>::max());
		constexpr std::array<double, 5> kValidValues { kMinimum, -1.0, 0.0, 1.0, kMaximum };
		constexpr std::array<double, 9> kInvalidValues { kMinimum - 1.0, kMaximum + 1.0, -0.5, 0.5, 4294967296.0, -4294967296.0, std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN() };
		constexpr std::array<char const*, 4> kCoercions { "'7'", "true", "null", "({ valueOf() { return 7; } })" };
		constexpr std::array<int, 4> kExpected { 7, 1, 0, 7 };

		for (auto const& dblValue : kValidValues) {
			v8::TryCatch Failure(pIsolate);
			int nResult = kOriginalValue;
			Require(ReadInt32FromValue(pIsolate, LocalContext, v8::Number::New(pIsolate, dblValue), "index", nResult), "Accept exact int32 boundaries");
			Require(!Failure.HasCaught() && (nResult == static_cast<int>(dblValue)), "Commit exact int32 result");
		}

		for (auto const& dblValue : kInvalidValues) {
			v8::TryCatch Failure(pIsolate);
			int nResult = kOriginalValue;
			Require(!ReadInt32FromValue(pIsolate, LocalContext, v8::Number::New(pIsolate, dblValue), "index", nResult), "Reject fractional/nonfinite/out-of-range int32");
			Require(Failure.HasCaught() && (nResult == kOriginalValue), "Invalid int32 does not commit output");
		}

		for (std::size_t unIndex = 0; unIndex < kCoercions.size(); ++unIndex) {
			v8::Local<v8::Value> const LocalValue = Evaluate(pIsolate, LocalContext, kCoercions[unIndex]);
			int nResult = kOriginalValue;
			Require(ReadInt32FromValue(pIsolate, LocalContext, LocalValue, "index", nResult) && (nResult == kExpected[unIndex]), "Preserve valid numeric coercion");
		}

		v8::Local<v8::Value> const LocalValue = Evaluate(pIsolate, LocalContext, "globalThis.IndexFailure = {}; ({ valueOf() { throw IndexFailure; } })");
		v8::Local<v8::Value> const LocalExpected = Evaluate(pIsolate, LocalContext, "IndexFailure");
		v8::TryCatch Failure(pIsolate);
		int nResult = kOriginalValue;
		Require(!ReadInt32FromValue(pIsolate, LocalContext, LocalValue, "index", nResult), "Reject failed index coercion");
		Require(Failure.HasCaught() && Failure.Exception()->StrictEquals(LocalExpected) && (nResult == kOriginalValue), "Preserve original index exception and output");
	}

	void CheckSignatureFailure(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, char const* const pszSource, const bool bOriginalException) {
		Evaluate(pIsolate, LocalContext, "globalThis.SignatureFailure = {}; globalThis.LateReads = 0; 0");
		v8::Local<v8::Value> const LocalExpected = Evaluate(pIsolate, LocalContext, "SignatureFailure");
		v8::Local<v8::Object> const LocalOptions = Evaluate(pIsolate, LocalContext, pszSource).As<v8::Object>();
		MemoryHookManager Manager {};
		{
			v8::TryCatch Failure(pIsolate);
			Manager.BuildSignature(pIsolate, LocalContext, LocalOptions);
			Require(Failure.HasCaught(), "Malformed signature reports failure");

			if (bOriginalException) {
				Require(Failure.Exception()->StrictEquals(LocalExpected), "Signature preserves original thrown object");
			}
		}

		Require(Evaluate(pIsolate, LocalContext, "LateReads").As<v8::Number>()->Value() == 0, "Signature stops before later getters after failure");
	}

	void CheckSignatures(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr std::array<char const*, 16> kTypeNames { "void", "bool", "char", "uchar", "short", "ushort", "int", "uint", "long", "ulong", "longlong", "ulonglong", "float", "double", "address", "string" };
		constexpr std::array<char const*, 4> kConventions { "__C", "STDCALL", "ThisCall", "fastcall" };
		constexpr std::array<char const*, 4> kExpected { "cdecl", "stdcall", "thiscall", "fastcall" };

		MemoryHookManager Manager {};
		v8::Local<v8::Object> const LocalEmpty = v8::Object::New(pIsolate);
		MemoryHookSignature const Default = Manager.BuildSignature(pIsolate, LocalContext, LocalEmpty);
		Require((Default.m_strConvention == "thiscall") && (Default.m_ReturnType == DATA_TYPE_VOID) && Default.m_vecArgumentTypes.empty(), "Preserve omitted signature defaults");
		for (std::size_t unIndex = 0; unIndex < kTypeNames.size(); ++unIndex) {
			v8::TryCatch Failure(pIsolate);
			Require(Manager.ReadDataType(pIsolate, MakeString(pIsolate, kTypeNames[unIndex])) == static_cast<DATA_TYPE>(unIndex), "Canonical type token");
			Require(Manager.ReadDataType(pIsolate, v8::Integer::New(pIsolate, static_cast<int>(unIndex))) == static_cast<DATA_TYPE>(unIndex), "Numeric type token");
			Require(!Failure.HasCaught(), "Valid type has no error");
		}

		Require(Manager.ReadDataType(pIsolate, MakeString(pIsolate, "UINT")) == DATA_TYPE_UINT, "Preserve case-insensitive type parsing");
		for (std::size_t unIndex = 0; unIndex < kConventions.size(); ++unIndex) {
			v8::Local<v8::Object> const LocalOptions = Evaluate(pIsolate, LocalContext, "({ Arguments: ['int', 'address'], ReturnType: 'ulonglong' })").As<v8::Object>();
			Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, "Convention"), MakeString(pIsolate, kConventions[unIndex])).FromMaybe(false), "Set convention");
			MemoryHookSignature const Signature = Manager.BuildSignature(pIsolate, LocalContext, LocalOptions);
			Require((Signature.m_strConvention == kExpected[unIndex]) && (Signature.m_ReturnType == DATA_TYPE_ULONG_LONG) && (Signature.m_vecArgumentTypes == std::vector<DATA_TYPE> { DATA_TYPE_INT, DATA_TYPE_ADDRESS }), "Read full normalized signature");
		}

		v8::Local<v8::Object> const LocalGrowing = Evaluate(pIsolate, LocalContext, "(() => { const vecTypes = []; Object.defineProperty(vecTypes, '0', { get() { vecTypes.push('float'); return 'int'; } }); return { Arguments: vecTypes }; })()").As<v8::Object>();
		MemoryHookSignature const Growing = Manager.BuildSignature(pIsolate, LocalContext, LocalGrowing);
		Require(Growing.m_vecArgumentTypes == std::vector<DATA_TYPE> { DATA_TYPE_INT }, "Snapshot argument array extent before getters mutate it");

		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: null, get Convention() { ++LateReads; return 'cdecl'; } })", false);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: ['void'], get Convention() { ++LateReads; return 'cdecl'; } })", false);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: ['unknown'], get Convention() { ++LateReads; return 'cdecl'; } })", false);
		CheckSignatureFailure(pIsolate, LocalContext, "({ get Arguments() { throw SignatureFailure; }, get Convention() { ++LateReads; return 'cdecl'; } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: [{ toString() { throw SignatureFailure; } }], get Convention() { ++LateReads; return 'cdecl'; } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ get Arguments() { return Object.defineProperty([], '0', { get() { throw SignatureFailure; } }); }, get Convention() { ++LateReads; return 'cdecl'; } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: [], Convention: 'unknown', get ReturnType() { ++LateReads; return 'int'; } })", false);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: [], Convention: { toString() { throw SignatureFailure; } }, get ReturnType() { ++LateReads; return 'int'; } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ Arguments: [], get Convention() { throw SignatureFailure; }, get ReturnType() { ++LateReads; return 'int'; } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ ReturnType: { toString() { throw SignatureFailure; } } })", true);
		CheckSignatureFailure(pIsolate, LocalContext, "({ ReturnType: -1 })", false);
		CheckSignatureFailure(pIsolate, LocalContext, "({ ReturnType: 999 })", false);
	}

	void CheckVTableAddresses(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr std::size_t kAddressByteCount = sizeof(void*);
		constexpr std::uintptr_t kMaximumAddress = std::numeric_limits<std::uintptr_t>::max();
		constexpr std::size_t kUnalignedOffset = kAddressByteCount + 1;
		constexpr std::array<char const*, 3> kIndexFields { "Entity", "Index", "Offset" };
		constexpr std::array<double, 4> kInvalidIndices { -0.5, 0.5, 2147483648.0, 4294967296.0 };

		MemoryHookManager Manager {};
		int nTarget = 73;
		void* const pTarget = &nTarget;
		std::array<unsigned char, (3 * kAddressByteCount) + 1> arrVTable {};
		std::array<unsigned char, kAddressByteCount + 1> arrObject {};
		void const* pVTable = arrVTable.data();
		std::memcpy(arrVTable.data(), &pTarget, kAddressByteCount);
		std::memcpy(arrVTable.data() + kUnalignedOffset, &pTarget, kAddressByteCount);
		std::memcpy(arrObject.data() + 1, &pVTable, kAddressByteCount);
		void* const pObject = arrObject.data() + 1;
		g_pFixtureEntity = pObject;

		auto const MakeOptions = [pIsolate, LocalContext, pObject] {
			v8::Local<v8::Object> const LocalOptions = v8::Object::New(pIsolate);
			Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, "ObjectAddress"), v8::BigInt::NewFromUnsigned(pIsolate, reinterpret_cast<std::uintptr_t>(pObject))).FromMaybe(false), "Set object address");

			return LocalOptions;
		};

		v8::Local<v8::Object> const LocalOffset = MakeOptions();
		Require(LocalOffset->Set(LocalContext, MakeString(pIsolate, "Offset"), v8::Integer::NewFromUnsigned(pIsolate, static_cast<std::uint32_t>(kUnalignedOffset))).FromMaybe(false), "Set unaligned byte offset");
		Require(Manager.ReadVTableAddress(pIsolate, LocalContext, LocalOffset) == pTarget, "Read unaligned object and vtable slot using bytes");
		v8::Local<v8::Object> const LocalIndex = MakeOptions();
		Require(LocalIndex->Set(LocalContext, MakeString(pIsolate, "Index"), v8::Integer::New(pIsolate, 0)).FromMaybe(false), "Set index");
		Require(LocalIndex->Set(LocalContext, MakeString(pIsolate, "Offset"), v8::Integer::New(pIsolate, -1)).FromMaybe(false), "Set ignored offset");
		Require(Manager.ReadVTableAddress(pIsolate, LocalContext, LocalIndex) == pTarget, "Index takes precedence over Offset");
		Require(Manager.ReadVTableAddress(pIsolate, LocalContext, Evaluate(pIsolate, LocalContext, "({ Entity: 7, Index: '0' })").As<v8::Object>()) == pTarget, "Resolve entity adapter with numeric coercion");
		Require(Manager.ReadVTableAddress(pIsolate, LocalContext, MakeOptions()) == nullptr, "Missing index/offset has no result");
		Require(Manager.ReadVTableAddress(pIsolate, LocalContext, Evaluate(pIsolate, LocalContext, "({ Entity: 7, Index: -1 })").As<v8::Object>()) == nullptr, "Negative index has no result");

		for (auto const& pszField : kIndexFields) {
			for (auto const& dblValue : kInvalidIndices) {
				v8::Local<v8::Object> const LocalOptions = (std::strcmp(pszField, "Entity") == 0) ? v8::Object::New(pIsolate) : MakeOptions();
				Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, pszField), v8::Number::New(pIsolate, dblValue)).FromMaybe(false), "Set malformed index");
				v8::TryCatch Failure(pIsolate);
				Require((Manager.ReadVTableAddress(pIsolate, LocalContext, LocalOptions) == nullptr) && Failure.HasCaught(), "All vtable index fields reject truncation/wrapping");
			}
		}

		// Only arithmetic guards see these synthetic addresses; no invalid slot is read.
		v8::Local<v8::Object> const LocalOverflow = MakeOptions();
		Require(LocalOverflow->Set(LocalContext, MakeString(pIsolate, "ObjectAddress"), v8::BigInt::NewFromUnsigned(pIsolate, kMaximumAddress)).FromMaybe(false), "Set overflowing object slot");
		{
			v8::TryCatch Failure(pIsolate);
			Require((Manager.ReadVTableAddress(pIsolate, LocalContext, LocalOverflow) == nullptr) && Failure.HasCaught(), "Check complete object slot before reading");
		}

		pVTable = reinterpret_cast<void const*>(kMaximumAddress);
		std::memcpy(arrObject.data() + 1, &pVTable, kAddressByteCount);
		for (auto const& nOffset : { 0, 1 }) {
			v8::Local<v8::Object> const LocalOptions = MakeOptions();
			Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, "Offset"), v8::Integer::New(pIsolate, nOffset)).FromMaybe(false), "Set overflowing vtable offset");
			v8::TryCatch Failure(pIsolate);
			Require((Manager.ReadVTableAddress(pIsolate, LocalContext, LocalOptions) == nullptr) && Failure.HasCaught(), "Check vtable addition and complete slot before reading");
		}

		v8::Local<v8::Object> const LocalLargeIndex = MakeOptions();
		Require(LocalLargeIndex->Set(LocalContext, MakeString(pIsolate, "Index"), v8::Integer::New(pIsolate, std::numeric_limits<std::int32_t>::max())).FromMaybe(false), "Set large vtable index");
		{
			v8::TryCatch Failure(pIsolate);
			Require((Manager.ReadVTableAddress(pIsolate, LocalContext, LocalLargeIndex) == nullptr) && Failure.HasCaught(), "Reject index multiplication/addition overflow before reading");
		}

		g_pFixtureEntity = nullptr;
	}

	void CheckRecordLookups(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext) {
		constexpr int kHookID = 73;
		constexpr int kMissingHookID = 74;

		MemoryHookManager Manager {};
		std::shared_ptr<MemoryHookRecord> pRecord = std::make_shared<MemoryHookRecord>();
		pRecord->m_nID = kHookID;
		pRecord->m_pAddress = pRecord.get();
		Manager.m_vecHookRecords.push_back(pRecord);
		Require((Manager.FindRecord(kHookID) == pRecord) && (Manager.FindRecord(pRecord.get()) == pRecord), "Find records by ID/address");
		Require(!Manager.FindRecord(kMissingHookID) && !Manager.FindRecord(static_cast<void const*>(nullptr)), "Absent record has empty result");
		std::shared_ptr<MemoryHookRecord> const pRetained = Manager.FindRecord(kHookID);
		Manager.m_vecHookRecords.clear();
		Require(pRetained == pRecord, "Lookup retains shared record lifetime");
		v8::Local<v8::Object> const LocalOptions = v8::Object::New(pIsolate);
		Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, "Address"), v8::BigInt::NewFromUnsigned(pIsolate, reinterpret_cast<std::uintptr_t>(pRecord.get()))).FromMaybe(false), "Set address option");
		Require(Manager.ReadAddress(pIsolate, LocalContext, LocalOptions, "Address") == pRecord.get(), "Read address option as BigInt");
		Require(LocalOptions->Set(LocalContext, MakeString(pIsolate, "Address"), v8::Integer::New(pIsolate, kHookID)).FromMaybe(false), "Set invalid numeric address");
		v8::TryCatch Failure(pIsolate);
		Require((Manager.ReadAddress(pIsolate, LocalContext, LocalOptions, "Address") == nullptr) && Failure.HasCaught(), "Reject Number address");
	}
