"use strict";

const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks bitbuffer source contracts without native execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

function GetFunction(strSource, strName) {
	const Expression = new RegExp(`^\\t+[^\\t\\n]*\\b${strName}\\([^\\n]*\\) [^\\n]*\\{$`, "m");
	const vecMatch = Expression.exec(strSource);
	if (!vecMatch) {
		throw new Error(`Missing native function ${strName}.`);
	}

	const strIndentation = vecMatch[0].match(/^\t+/)[0];
	const strTerminator = "\n" + strIndentation + "}";
	const nEndIndex = strSource.indexOf(strTerminator, vecMatch.index);
	if (nEndIndex < 0) {
		throw new Error(`Missing native function terminator ${strName}.`);
	}

	return strSource.slice(vecMatch.index, nEndIndex + strTerminator.length);
}

function DoesTextPrecede(strSource, strFirstText, strSecondText) {
	const nFirstIndex = strSource.indexOf(strFirstText);
	const nSecondIndex = strSource.indexOf(strSecondText);

	return (nFirstIndex >= 0) && (nSecondIndex > nFirstIndex);
}

function VerifyTextOrderingContracts() {
	const vecScenarios = [
		{ Source: "First Second", First: "First", Second: "Second", Expected: true },
		{ Source: "First Second", First: "Missing", Second: "Second", Expected: false },
		{ Source: "First Second", First: "First", Second: "Missing", Expected: false },
		{ Source: "First Second", First: "Missing", Second: "Absent", Expected: false },
		{ Source: "Second First", First: "First", Second: "Second", Expected: false },
		{ Source: "First", First: "First", Second: "First", Expected: false },
	];
	for (const Scenario of vecScenarios) {
		if (DoesTextPrecede(Scenario.Source, Scenario.First, Scenario.Second) !== Scenario.Expected) {
			throw new Error(`Text-order regression First=${Scenario.First} Second=${Scenario.Second}.`);
		}
	}
}

function VerifyContracts(strSource) {
	let unCount = 0;
	const Check = (bCondition, strMessage) => {
		if (!bCondition) {
			throw new Error(strMessage);
		}

		++unCount;
	};

	for (const vecCallback of [
		["LoadKeyValuesFromFileCallback", "keyvalues.LoadFromFile(Handle, strFilePath, bUsesEscapeSequences?)"],
		["SaveKeyValuesToFileCallback", "keyvalues.SaveToFile(Handle, strFilePath)"],
		["PackUInt32Callback", "bitbuffers.PackUInt32(unUInt32Value)"],
	]) {
		const strBody = GetFunction(strSource, vecCallback[0]);
		Check(strBody.includes("} catch (...) {"), `${vecCallback[0]}: complete native exception boundary`);
		Check(strBody.includes(`${vecCallback[1]} failed with a native C++ exception.`), `${vecCallback[0]}: actual API diagnostic`);
		Check(DoesTextPrecede(strBody, "if (!pIsolate)", "try {"), `${vecCallback[0]}: isolate guard precedes exception translation`);
	}

	const strPropertyBody = GetFunction(strSource, "GetObjectPropertyValueForBitBuffers");
	const strPropertyIndentation = strPropertyBody.match(/^\t+/)[0];
	Check((strPropertyBody.match(/LocalObject->Get\(/g) ?? []).length === 1, "BitBuffer property: one canonical lookup without legacy getters");
	Check(!strPropertyBody.includes("LocalPrivatePropertyName") && !strPropertyBody.includes("strPrivatePropertyName"), "BitBuffer property: no synthetic private-name alias");
	Check(!strPropertyBody.includes('std::string("_")'), "BitBuffer property: no underscore-prefixed fallback contract");
	Check(strPropertyBody.endsWith("\n" + strPropertyIndentation + "\treturn LocalValue;\n" + strPropertyIndentation + "}"), "BitBuffer property: preserve canonical nullish and ordinary values");
	Check(strPropertyBody.includes("if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalValue) || LocalValue.IsEmpty()) {\n" + strPropertyIndentation + "\t\treturn {};"), "BitBuffer property: retain empty result on getter failure");

	const strCopyBody = GetFunction(strSource, "WriteBitBufferBitsFromBufferCallback");
	const strCopyIndentation = strCopyBody.match(/^\t+/)[0];
	const strWriterStoreGuard = "if (!StoreBitBufferWriterStateInObject(pIsolate, LocalContext, LocalBitBufferWriterStateObject, BitBufferWriterState, BitBufferWriter)) {\n" + strCopyIndentation + "\t\t\treturn;\n" + strCopyIndentation + "\t\t}";
	const strReaderStoreGuard = "if (!StoreBitBufferReaderStateInObject(pIsolate, LocalContext, LocalBitBufferReaderStateObject, BitBufferReaderState, BitBufferReader)) {\n" + strCopyIndentation + "\t\t\treturn;\n" + strCopyIndentation + "\t\t}";
	Check(strCopyBody.includes(strWriterStoreGuard), "BitBuffer copy: stop on writer store failure before reader store");
	Check(strCopyBody.includes(strReaderStoreGuard), "BitBuffer copy: handle reader store failure immediately");
	Check(DoesTextPrecede(strCopyBody, strWriterStoreGuard, strReaderStoreGuard), "BitBuffer copy: writer commit precedes reader commit");
	Check(DoesTextPrecede(strCopyBody, strReaderStoreGuard, "CallbackInformation.GetReturnValue().Set(bCopySucceeded"), "BitBuffer copy: result only after successful commits");

	const strPackBody = GetFunction(strSource, "PackUInt32Callback");
	Check(strPackBody.includes("->IsUint32()"), "PackUInt32: strict unsigned 32-bit input");
	Check(DoesTextPrecede(strPackBody, "GetUInt32Argument(", "v8::Array::New("), "PackUInt32: validate before result allocation");
	Check(strPackBody.includes("LocalPackedByteArray->CreateDataProperty(LocalContext, unByteIndex, LocalByteValue)"), "PackUInt32: own indexed byte values");
	Check(!strPackBody.includes("LocalPackedByteArray->Set("), "PackUInt32: no inherited setters");
	Check(strPackBody.includes("MaybeCreateResult.IsNothing() || !MaybeCreateResult.FromJust()"), "PackUInt32: handle indexed write failure");
	Check(strPackBody.includes("(unUInt32Value >> (unByteIndex * kBitsPerByte)) & kByteMask"), "PackUInt32: preserve little-endian extraction");

	const strStateBody = GetFunction(strSource, "GetBitBufferStateFromValue");
	Check(strStateBody.includes("v8::TryCatch BytesConversionFailure(pIsolate);"), "BitBuffer state: retain byte conversion exceptions");
	Check(strStateBody.includes("if (!bConvertedBytes && BytesConversionFailure.HasCaught())"), "BitBuffer state: distinguish pending JavaScript errors");
	Check(strStateBody.includes("BytesConversionFailure.ReThrow();"), "BitBuffer state: rethrow the original error");
	Check(DoesTextPrecede(strStateBody, "BytesConversionFailure.ReThrow();", "ThrowError(pIsolate, kBitBufferStateBytesConversionError)"), "BitBuffer state: original error precedes generic fallback");
	Check(strStateBody.includes("if (!bConvertedBytes)"), "BitBuffer state: explicit fallback on conversion failure");
	Check(/} catch \(\.\.\.\) \{\n\t+if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/.test(strStateBody), "BitBuffer state: preserve pending conversion error during native unwinding");
	Check(DoesTextPrecede(strStateBody, "GetObjectBooleanPropertyForBitBuffers(", "BitBufferStateOut = std::move(ParsedState);"), "BitBuffer state: commit only after complete validation");
	Check(strStateBody.includes("unCapacityByteCount <= (kMaximumBitCountAsSize / kBitsPerByte)"), "BitBuffer state: guard multiplication before narrowing");

	const strByteCountBody = GetFunction(strSource, "CalculateByteCountForBitCount");
	Check(strByteCountBody.includes("return (nBitCount <= 0) ? 0 : (1 + (nBitCount - 1) / kBitsPerByte);"), "Byte count: grouped ternary and overflow-safe ceiling division");
	Check(strSource.includes("BitBuffersState::BitBuffersState() {\n\t\t\tm_nDataBitCount = 0;\n\t\t\tm_nCurrentBitIndex = 0;\n\t\t\tm_bOverflowed = false;\n\t\t}"), "State: constructor defines both counters and the overflow flag");

	const strWriterBody = GetFunction(strSource, "InitializeBitBufferWriterFromState");
	const strWriterIndentation = strWriterBody.match(/^\t+/)[0];
	Check(strSource.includes("std::vector<std::uint32_t> m_vecWriterWords;"), "Writer: owned live aligned word storage");
	Check(strWriterBody.includes("static_assert(std::is_same_v<std::uint32_t, uint32>);"), "Writer: exact SDK word type");
	Check(strWriterBody.includes("static_cast<std::size_t>(std::numeric_limits<int>::max() - kMaximumScalarBitCount) / kBitsPerByte / kBytesPerWord"), "Writer: safe SDK signed bit-capacity arithmetic and scalar-overrun headroom");
	Check(strWriterBody.includes("if (unByteCount > kMaximumByteCount)"), "Writer: size checked before word rounding");
	Check(strWriterBody.includes("(unByteCount == 0) ? 1 : (1 + (unByteCount - 1) / kBytesPerWord)"), "Writer: rounded word count and non-null empty storage");
	Check(strWriterBody.includes("BitBufferState.m_vecWriterWords.assign(unWordCount, 0);"), "Writer: defined padding bytes");
	Check(strWriterBody.includes("} catch (...) {\n" + strWriterIndentation + "\t\treturn false;"), "Writer: allocation failures do not escape initialization");
	Check(strWriterBody.includes("std::memcpy(BitBufferState.m_vecWriterWords.data(), BitBufferState.m_vecBytes.data(), unByteCount);"), "Writer: retain logical input bytes");
	Check(strWriterBody.includes("StartWriting(BitBufferState.m_vecWriterWords.data(), nStorageByteCount, kInitialBitIndex, BitBufferState.m_nDataBitCount)"), "Writer: aligned physical capacity with separate logical bit limit");
	Check(strWriterBody.includes("(BitBufferState.m_nCurrentBitIndex > BitBufferState.m_nDataBitCount)"), "Writer: validate cursor before SDK seek");

	const strWriterStoreBody = GetFunction(strSource, "StoreBitBufferWriterStateInObject");
	Check(strWriterStoreBody.includes("if (unRequiredWordCount > BitBufferState.m_vecWriterWords.size())"), "Writer: validate copy-back extent");
	Check(strWriterStoreBody.includes("std::memcpy(BitBufferState.m_vecBytes.data(), BitBufferState.m_vecWriterWords.data(), unByteCount);"), "Writer: copy back only logical byte count");
	Check(!strWriterStoreBody.includes("m_vecBytes.resize("), "Writer: private padding does not resize public bytes");

	const strReaderBody = GetFunction(strSource, "InitializeBitBufferReaderFromState");
	const strReaderIndentation = strReaderBody.match(/^\t+/)[0];
	Check(strSource.includes("using SDKBitBufferReader = old_bf_read;"), "Reader: SDK checked logical-EOF backend where available");
	Check(strSource.includes("using SDKBitBufferReader = bf_read;"), "Reader: canonical backend on SDKs without the alternate reader");
	Check(strSource.includes("std::vector<std::uint32_t> m_vecReaderWords;"), "Reader: owned live aligned storage");
	Check(strReaderBody.includes("std::is_same_v<std::uint32_t, uint32>"), "Reader: exact SDK word type");
	Check(strReaderBody.includes("std::numeric_limits<int>::max() - kMaximumScalarBitCount"), "Reader: signed scalar-overrun headroom");
	Check(strReaderBody.includes("if (unByteCount > kMaximumByteCount)"), "Reader: checked size before rounding and multiplication");
	Check(strReaderBody.includes("(unByteCount == 0) ? 1 : (1 + (unByteCount - 1) / kBytesPerWord)"), "Reader: safe complete words and non-null empty storage");
	Check(strReaderBody.includes("m_vecReaderWords.assign(unWordCount, 0)"), "Reader: initialized padding");
	Check(strReaderBody.includes("} catch (...) {\n" + strReaderIndentation + "\t\treturn false;"), "Reader: contain word-storage allocation failures");
	Check(strReaderBody.includes("std::memcpy(BitBufferState.m_vecReaderWords.data(), BitBufferState.m_vecBytes.data(), unByteCount)"), "Reader: exact logical input copy");
	Check(strReaderBody.includes("StartReading(BitBufferState.m_vecReaderWords.data(), nStorageByteCount, kInitialBitIndex, BitBufferState.m_nDataBitCount)"), "Reader: physical word capacity and independent logical EOF");
	Check(strReaderBody.includes("if (!BitBufferReaderOut.Seek(BitBufferState.m_nCurrentBitIndex))"), "Reader: checked cursor initialization");
	Check(strReaderBody.includes("BitBufferReaderOut.SetOverflowFlag();"), "Reader: preserve existing overflow state");
	Check(strReaderBody.includes("(BitBufferState.m_nCurrentBitIndex > BitBufferState.m_nDataBitCount)"), "Reader: validate cursor before SDK use");
	Check(strSource.includes("kSDKHasReadLongLong<bf_read>"), "Reader: canonical selected-SDK export availability remains unchanged");

	const strSignedLongLongBody = GetFunction(strSource, "ReadBitBufferSignedLongLongValue");
	Check(strSignedLongLongBody.includes("constexpr int kWordBitCount = 32;"), "Signed 64-bit reader: explicit SDK word width");
	Check(DoesTextPrecede(strSignedLongLongBody, "unLowWord = ReadBitBufferUnsignedValue(", "unHighWord = ReadBitBufferUnsignedValue("), "Signed 64-bit reader: low word precedes high word");
	Check(strSignedLongLongBody.includes("unLowWord | (unHighWord << kWordBitCount)"), "Signed 64-bit reader: preserve SDK word order");
	Check(strSignedLongLongBody.includes("std::memcpy(&nValue, &unValue, sizeof(nValue));"), "Signed 64-bit reader: representation copy without aliasing");
	Check(GetFunction(strSource, "ReadBitBufferLongLongCallback").includes("nReadValue = ReadBitBufferSignedLongLongValue(OperationBitBufferReader);"), "Signed 64-bit reader: public callback uses the safe helper");
	Check(GetFunction(strSource, "ReadBitBufferLongLongCallback").includes("v8::BigInt::New(pIsolate, nReadValue)"), "Signed 64-bit reader: retain exact BigInt result");
	Check(strSource.includes("ReadBitBufferFloatCallback, ReadBitBufferFloatValue(OperationBitBufferReader)"), "Float reader: public callback uses representation-safe helper");

	for (const strOperationKind of ["Writer", "Reader"]) {
		const strOperationBody = GetFunction(strSource, `ApplyBitBuffer${strOperationKind}Operation`);
		Check(strOperationBody.includes("} catch (...) {"), `${strOperationKind} operation: complete native exception boundary`);
		Check(DoesTextPrecede(strOperationBody, "try {", "GetBitBufferStateAndObjectFromCallbackInformation("), `${strOperationKind} operation: state parsing is inside the boundary`);
		Check(strOperationBody.includes(`BitBuffer ${strOperationKind.toLowerCase()} operation failed with a native C++ exception.`), `${strOperationKind} operation: accurate native diagnostic`);
	}

	for (const vecCallback of [
		["CreateBitBufferWriterCallback", "bitbuffers.CreateWrite(DataByteCountOrBytes?, nDataBitCount?)", "m_vecBytes.resize("],
		["CreateBitBufferReaderCallback", "bitbuffers.CreateRead(Source, bCreateCopy?)", "GetFilesystemBytesFromValue("],
		["SetBitBufferBytesCallback", "bitbuffers.SetBytes(State, ByteSource)", "GetBitBufferStateAndObjectFromCallbackInformation("],
		["SetBitBufferDataBitCountCallback", "bitbuffers.SetDataBitCount(State, nDataBitCount)", "GetBitBufferStateAndObjectFromCallbackInformation("],
	]) {
		const strBody = GetFunction(strSource, vecCallback[0]);
		Check(/\n(\t+)} catch \(\.\.\.\) \{\n\1\tThrowError\(pIsolate, kNativeExceptionErrorMessage\);/.test(strBody), `${vecCallback[0]}: complete native exception boundary`);
		Check(strBody.includes(`${vecCallback[1]} failed with a native C++ exception.`), `${vecCallback[0]}: actual API diagnostic`);
		Check(DoesTextPrecede(strBody, "try {", vecCallback[2]), `${vecCallback[0]}: allocations and state parsing are inside the boundary`);
	}

	const strCreateReaderBody = GetFunction(strSource, "CreateBitBufferReaderCallback");
	Check(strCreateReaderBody.includes("v8::TryCatch BytesConversionFailure(pIsolate);"), "Reader construction: retain original JavaScript conversion error");
	Check(strCreateReaderBody.includes("BytesConversionFailure.ReThrow();"), "Reader construction: rethrow without generic replacement");
	Check(/} catch \(\.\.\.\) \{\n\t+if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/.test(strCreateReaderBody), "Reader construction: preserve pending conversion error during native unwinding");
	Check(DoesTextPrecede(strCreateReaderBody, "BytesConversionFailure.ReThrow();", "ThrowError(pIsolate, kSourceBytesError)"), "Reader construction: original conversion error precedes fallback");

	for (const vecCallback of [
		["SetBitBufferDataByteCountCallback", "bitbuffers.SetDataByteCount(State, nRequestedByteCount)"],
		["SetBitBufferCurrentBitIndexCallback", "bitbuffers.SetCurrentBit(State, nCurrentBitIndex)"],
		["GetBitBufferBytesCallback", "bitbuffers.GetBytes(State)"],
		["GetBitBufferDataByteCountCallback", "bitbuffers.GetDataByteCount(State)"],
		["SetBitBufferOverflowFlagCallback", "bitbuffers.SetOverflowFlag(State)"],
		["ClearBitBufferOverflowFlagCallback", "bitbuffers.ClearOverflowFlag(State)"],
		["ResetBitBufferCallback", "bitbuffers.Reset(State)"],
		["CheckBitBufferForOverflowCallback", "bitbuffers.CheckForOverflow(State, nRequestedBitCount?)"],
		["SeekBitBufferToBitCallback", "bitbuffers.SeekToBit(State, nBitIndex)"],
	]) {
		const strBody = GetFunction(strSource, vecCallback[0]);
		Check(strBody.includes("} catch (...) {"), `${vecCallback[0]}: complete native state boundary`);
		Check(strBody.includes(`${vecCallback[1]} failed with a native C++ exception.`), `${vecCallback[0]}: actual state API diagnostic`);
		Check(DoesTextPrecede(strBody, "try {", "GetBitBufferStateAndObjectFromCallbackInformation("), `${vecCallback[0]}: parsing allocations inside the boundary`);
	}

	const vecMacroMatch = /^#define SOURCEJS_DEFINE_BITBUFFER_STATE_GETTER_CALLBACK\b[^\n]*\n(\t+)void NAME##Callback[^\n]*\n[\s\S]*?^\1\}/m.exec(strSource);
	Check(vecMacroMatch !== null, "State getters: owning macro definition");
	Check(vecMacroMatch[0].includes("} catch (...) {"), "State getters: complete generated boundary");
	Check(vecMacroMatch[0].includes('"bitbuffers." API_NAME "(State) failed with a native C++ exception."'), "State getters: actual public API diagnostic");
	Check(DoesTextPrecede(vecMacroMatch[0], "try {", "GetBitBufferStateAndObjectFromCallbackInformation("), "State getters: parsing allocations inside generated boundary");
	for (const vecGetter of [
		["GetBitBufferDataBitCount", "GetDataBitCount"],
		["GetBitBufferCurrentBitIndex", "GetCurrentBit"],
		["IsBitBufferOverflowed", "IsOverflowed"],
		["GetBitBufferMaximumBitCount", "GetMaximumBitCount"],
		["GetBitBufferRemainingBitCount", "GetRemainingBitCount"],
		["GetBitBufferRemainingByteCount", "GetRemainingByteCount"],
		["GetBitBufferWrittenBitCount", "GetWrittenBitCount"],
		["GetBitBufferWrittenByteCount", "GetWrittenByteCount"],
		["GetBitBufferReadBitCount", "GetReadBitCount"],
		["GetBitBufferReadByteCount", "GetReadByteCount"],
	]) {
		Check(strSource.includes(`SOURCEJS_DEFINE_BITBUFFER_STATE_GETTER_CALLBACK(${vecGetter[0]}, "${vecGetter[1]}",`), `${vecGetter[0]}: exact exported getter name`);
	}

	for (const vecCallback of [
		["SeekBitBufferRelativeCallback", "bitbuffers.SeekRelative(State, nBitDelta)"],
		["ConvertBitBufferToBytesCallback", "bitbuffers.ToBytes(State)"],
		["WriteBitBufferBitsFromBufferCallback", "bitbuffers.WriteBitsFromBuffer(State, Source, nBitCount)"],
	]) {
		const strBody = GetFunction(strSource, vecCallback[0]);
		Check(strBody.includes("} catch (...) {"), `${vecCallback[0]}: complete native operation boundary`);
		Check(strBody.includes(`${vecCallback[1]} failed with a native C++ exception.`), `${vecCallback[0]}: actual operation diagnostic`);
		Check(DoesTextPrecede(strBody, "try {", "GetBitBufferStateAndObjectFromCallbackInformation("), `${vecCallback[0]}: state allocation inside the boundary`);
	}

	const strUnsignedWriter = GetFunction(strSource, "WriteBitBufferUnsignedValue");
	Check(strUnsignedWriter.includes("constexpr std::uint32_t kBitValueMask = 0x01;"), "Unsigned writer: named typed hexadecimal single-bit mask");
	Check(strUnsignedWriter.includes("static_cast<int>((unValue >> nBitIndex) & kBitValueMask)"), "Unsigned writer: extract each bit with the named mask");

	const strPackedCoordinateWriter = GetFunction(strSource, "WritePackedBitBufferMultiplayerCoordinate");
	Check(strPackedCoordinateWriter.includes("constexpr std::uint32_t kInBoundsFlag = 0x01;"), "Packed coordinate writer: kInBoundsFlag uses its exact hexadecimal bit");
	Check(strPackedCoordinateWriter.includes("constexpr std::uint32_t kHasIntegerFlag = 0x02;"), "Packed coordinate writer: kHasIntegerFlag uses its exact hexadecimal bit");
	Check(strPackedCoordinateWriter.includes("constexpr std::uint32_t kSignFlag = 0x04;"), "Packed coordinate writer: kSignFlag uses its exact hexadecimal bit");

	const strInt64Writer = GetFunction(strSource, "WriteBitBufferLongLongCallback");
	Check(strInt64Writer.includes("WriteBitBufferUnsignedValue(BitBufferWriter, unLowWord, kWordBitCount);"), "Int64 writer: low word uses checked defined shifts");
	Check(strInt64Writer.includes("WriteBitBufferUnsignedValue(BitBufferWriter, unHighWord, kWordBitCount);"), "Int64 writer: high word uses checked defined shifts");
	Check(!strInt64Writer.includes("BitBufferWriter.WriteLongLong("), "Int64 writer: no incompatible SDK integer alias");
	Check(strInt64Writer.includes("GetInt64Argument("), "Int64 writer: preserve exact BigInt conversion");

	const strBitAtWriter = GetFunction(strSource, "WriteBitBufferOneBitAtCallback");
	Check(strBitAtWriter.includes("if (nBitIndex >= BitBufferWriter.GetMaxNumBits()) {"), "Indexed bit: check range without index + 1 overflow");
	Check(DoesTextPrecede(strBitAtWriter, "if (nBitIndex >= BitBufferWriter.GetMaxNumBits()) {", "BitBufferWriter.WriteOneBitAt("), "Indexed bit: validate before SDK call");

	const strFloatWriter = GetFunction(strSource, "WriteBitBufferFloatCallback");
	Check(strFloatWriter.includes("GetFloatArgument("), "Float writer: retain finite float conversion");
	Check(strFloatWriter.includes("BitBufferWriter.WriteFloat(flValue);"), "Float writer: preserve SDK byte serialization");
	Check(!strSource.includes("SOURCEJS_DEFINE_BITBUFFER_WRITER_FLOAT_CALLBACK"), "Float writer: one-use macro replaced by a typed callback");

	const strBitFloatWriter = GetFunction(strSource, "WriteBitBufferBitFloatCallback");
	Check(strBitFloatWriter.includes("std::memcpy(&unValue, &flValue, sizeof(unValue));"), "Bit float: copy the exact representation without unrelated-type access");
	Check(strBitFloatWriter.includes("std::numeric_limits<float>::radix == 2"), "Bit float: binary radix contract");
	Check(strBitFloatWriter.includes("std::numeric_limits<float>::digits == 24"), "Bit float: binary32 significand contract");
	Check(strBitFloatWriter.includes("std::numeric_limits<float>::max_exponent == 128"), "Bit float: binary32 exponent contract");
	Check(strBitFloatWriter.includes("kNumericValueTypeError, flValue)"), "Bit float: typed signature and finite float conversion agree");

	for (const strName of ["WriteBitBufferBitFloatCallback", "WriteBitBufferBitAngleCallback", "WriteBitBufferBitCoordinateCallback", "WriteBitBufferVarInt32Callback", "WriteBitBufferUBitVarCallback"]) {
		Check(GetFunction(strSource, strName).includes("ApplyBitBufferWriterOperation("), `${strName}: retain common parse/write/store exception boundary`);
	}

	const strCoordinateWriter = GetFunction(strSource, "WriteBitBufferBitCoordinateCallback");
	Check(strCoordinateWriter.includes("std::fabs(static_cast<double>(flCoordinateValue)) >= kCoordinateLimit"), "Coordinate: validate before integral representation conversion");

	const strSignedWriter = GetFunction(strSource, "WriteBitBufferSignedValue");
	Check(strSignedWriter.includes("std::uint32_t(1) << nMagnitudeBitCount"), "Signed value: unsigned representation shift");
	Check(strSignedWriter.includes("if (nBitCount == 0)"), "Signed value: preserve zero-width guard");
	Check(DoesTextPrecede(strSignedWriter, "if (nBitCount == 0)", "nBitCount - 1"), "Signed value: zero width precedes sign-bit shift");

	const strVariableWriter = GetFunction(strSource, "WriteBitBufferVariableUnsignedValue");
	Check(strVariableWriter.includes("static_cast<std::uint64_t>(unValue) > (unBase * 2)"), "Unary encoding: wide termination arithmetic");
	Check(strVariableWriter.includes("std::uint64_t(1) << nPayloadBitCount"), "Unary encoding: width 32 does not shift a uint32");
	Check(strVariableWriter.includes("static_cast<std::uint32_t>(static_cast<std::uint64_t>(unValue) - unBase)"), "Unary encoding: narrow only after wide subtraction");
	Check(strVariableWriter.includes("WriteLegacyBitBufferFlag(BitBufferWriter, true);"), "Unary encoding: preserve legacy marker overflow behavior");

	const strStringWriter = GetFunction(strSource, "WriteBitBufferStringCallback");
	Check(strStringWriter.includes("try {"), "String writer: native preparation boundary exists");
	Check(strStringWriter.includes("catch (...)"), "String writer: contain every native C++ exception");
	Check(strStringWriter.includes("bitbuffers.WriteString failed with a native C++ exception."), "String writer: preparation failure identifies the operation");
	Check(DoesTextPrecede(strStringWriter, "try {", "std::string strValue"), "String writer: string ownership is inside the native boundary");
	Check(strStringWriter.includes("->ToString(LocalContext).ToLocal(&LocalString)"), "String writer: preserve pending original JavaScript conversion exception");
	Check(strStringWriter.includes("v8::String::Utf8Value(pIsolate, LocalString)"), "String writer: encode only the successfully converted string");
	Check(DoesTextPrecede(strStringWriter, "->ToString(", "ApplyBitBufferWriterOperation("), "String writer: conversion precedes writer-state processing");
	Check(strStringWriter.includes("WriteBitBufferSignedValue(BitBufferWriter, 0, kCharacterBitCount);"), "String writer: preserve terminating zero and SDK signed-character boundaries");

	for (const strName of ["WriteBitBufferStringCallback", "WriteBitBufferLongCallback", "WriteBitBufferShortCallback", "WriteBitBufferSBitLongCallback", "WriteBitBufferCharCallback", "WriteBitBufferBitCoordinateMPCallback", "WriteBitBufferBitVector3CoordinateCallback", "WriteBitBufferBitNormalCallback", "WriteBitBufferBitVector3NormalCallback", "WriteBitBufferBitAnglesCallback"]) {
		Check(GetFunction(strSource, strName).includes("ApplyBitBufferWriterOperation("), `${strName}: retain common parse/write/store exception boundary`);
	}

	Check(GetFunction(strSource, "ApplyBitBufferWriterOperation").includes("OperationCallback(BitBufferWriter);"), "Vector captures: operation runs synchronously within the caller's lifetime");

	for (const vecCallback of [
		["WriteBitBufferBitVector3CoordinateCallback", "CoordinateVector"],
		["WriteBitBufferBitVector3NormalCallback", "NormalVector"],
		["WriteBitBufferBitAnglesCallback", "AngleVector"],
	]) {
		Check(GetFunction(strSource, vecCallback[0]).includes(`[&${vecCallback[1]}](bf_write& BitBufferWriter)`), `${vecCallback[0]}: borrow the validated SDK vector without deprecated copies`);
	}

	const strUnsignedVariableReader = GetFunction(strSource, "ReadBitBufferVariableUnsignedValue");
	const nHighSelectorProfileStart = strUnsignedVariableReader.indexOf("#elif defined(ENGINE_BRANCH_PORTAL2) || defined(ENGINE_BRANCH_SWARM)");
	Check(nHighSelectorProfileStart >= 0, "UBitVar reader: high selector belongs only to PORTAL2/SWARM");

	const nHeaderBitCountStart = strUnsignedVariableReader.indexOf("constexpr int kHeaderBitCount", nHighSelectorProfileStart);
	Check(nHeaderBitCountStart > nHighSelectorProfileStart, "UBitVar reader: high-selector profile has an explicit header boundary");
	Check(!strUnsignedVariableReader.slice(nHighSelectorProfileStart, nHeaderBitCountStart).includes("ENGINE_BRANCH_CSGO"), "UBitVar reader: CSGO uses the selector-first SDK reader");
	Check(strUnsignedVariableReader.includes("ENGINE_BRANCH_BLADE) || defined(ENGINE_BRANCH_BMS)"), "UBitVar reader: BLADE uses the selector-first layout");

	Check(GetFunction(strSource, "ReadBitBufferScalarUnsignedValue").includes("Reader.GetBasePointer()"), "Scalar payload: use public byte storage after complete-capacity precheck");
	Check(DoesTextPrecede(GetFunction(strSource, "ReadBitBufferScalarUnsignedValue"), "Reader.GetNumBitsLeft() < nBitCount", "Reader.GetBasePointer()"), "Scalar payload: validate capacity before reading storage");
	Check(!GetFunction(strSource, "ReadBitBufferScalarUnsignedValue").includes("Reader.ReadOneBit()"), "Scalar payload: prior overflow does not suppress a fitting SDK payload");
	Check(GetFunction(strSource, "ReadBitBufferScalarSignedValue").includes("ReadBitBufferScalarUnsignedValue(Reader, nMagnitudeBitCount)"), "Legacy signed scalar: preserve separate magnitude read");
	Check(GetFunction(strSource, "ReadBitBufferScalarSignedValue").includes("const bool bNegative = Reader.ReadOneBit() != 0;"), "Legacy signed scalar: preserve separately checked sign flag");
	Check(GetFunction(strSource, "ReadBitBufferCharacterValue").includes("static_cast<char>(ReadBitBufferScalarUnsignedValue(Reader, kBitBufferByteBitCount))"), "Packed character: preserve selected compiler char signedness");
	Check(GetFunction(strSource, "WriteBitBufferNormalFlag").includes("WriteLegacyBitBufferFlag(BitBufferWriter, bValue)"), "Legacy normal: preserve sticky-overflow flag behavior");
	Check(GetFunction(strSource, "WriteBitBufferNormalValue").includes("WriteBitBufferUnsignedValue(BitBufferWriter, std::min(unFractionValue, kFractionMaximum), NORMAL_FRACTIONAL_BITS)"), "Normal payload: use checked shift-safe unsigned writer");
	Check(GetFunction(strSource, "WriteBitBufferBitNormalCallback").includes("WriteBitBufferNormalValue(BitBufferWriter, flClampedNormalValue)"), "Normal callback: no unsafe selected-SDK payload writer");
	Check(GetFunction(strSource, "WriteBitBufferBitVector3NormalCallback").includes("WriteBitBufferVectorNormalValue(BitBufferWriter, NormalVector)"), "Vector normal callback: no unsafe selected-SDK payload writer");
	Check(strSource.includes("SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferByteCallback, ReadBitBufferScalarUnsignedValue(OperationBitBufferReader, kBitBufferByteBitCount))"), "ReadBitBufferByteCallback: safe scalar helper path");
	Check(strSource.includes("SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferCharCallback, ReadBitBufferCharacterValue(OperationBitBufferReader))"), "ReadBitBufferCharCallback: safe scalar helper path");
	Check(strSource.includes("SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferLongCallback, ReadBitBufferScalarSignedValue(OperationBitBufferReader, kBitBufferLongBitCount))"), "ReadBitBufferLongCallback: safe scalar helper path");
	Check(strSource.includes("SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferBitCoordinateCallback, ReadBitBufferCoordinateValue(OperationBitBufferReader))"), "ReadBitBufferBitCoordinateCallback: safe scalar helper path");
	Check(strSource.includes("SOURCEJS_DEFINE_BITBUFFER_READER_NUMBER_CALLBACK(ReadBitBufferBitNormalCallback, ReadBitBufferNormalValue(OperationBitBufferReader))"), "ReadBitBufferBitNormalCallback: safe scalar helper path");

	Check(GetFunction(strSource, "ReadBitBufferScalarUnsignedValue").includes("if (!Reader.Seek(nStartBitIndex + nBitCount))"), "Scalar payload: commit cursor through checked public Seek");

	const strPeekReader = GetFunction(strSource, "PeekBitBufferUBitLongCallback");
	Check(strPeekReader.includes("try {"), "Peek reader: native preparation boundary exists");
	Check(strPeekReader.includes("catch (...)"), "Peek reader: contain escaping native C++ exceptions");
	Check(strPeekReader.includes("bitbuffers.PeekUBitLong failed with a native C++ exception."), "Peek reader: native failure identifies the operation");
	Check(DoesTextPrecede(strPeekReader, "try {", "GetBitBufferStateAndObjectFromCallbackInformation("), "Peek reader: state conversion is inside the native boundary");
	Check(DoesTextPrecede(strPeekReader, "ValidateBitBufferBitCount(", "try {"), "Peek reader: reject invalid widths before state conversion");
	Check(!strPeekReader.includes("StoreBitBufferReaderStateInObject(") && !strPeekReader.includes("ApplyBitBufferReaderOperation("), "Peek reader: never commit cursor or overflow state");

	const strSignedReader = GetFunction(strSource, "ReadBitBufferSBitLongCallback");
	Check(strSignedReader.includes("if (nBitCount == 0)") && DoesTextPrecede(strSignedReader, "if (nBitCount == 0)", "nBitCount - 1"), "Signed reader: guard zero width before sign-bit arithmetic");
	Check(strSignedReader.includes("std::int64_t(1) << nBitCount"), "Signed reader: wide sign extension supports width 32");

	const strVarIntReader = GetFunction(strSource, "ReadBitBufferVarInt32Callback");
	Check(strVarIntReader.includes("unPayload > (kMaximumValue >> nBitShift)"), "VarInt32 reader: validate payload before shifting");
	Check(DoesTextPrecede(strVarIntReader, "unPayload >", "unReadValue |="), "VarInt32 reader: detect overflow before output mutation");
	Check(GetFunction(strSource, "ReadBitBufferLongLongCallback").includes("v8::BigInt::New(pIsolate, nReadValue)"), "LongLong reader: exact signed 64-bit BigInt result");

	for (const strName of ["ReadBitBufferUBitLongCallback", "ReadBitBufferSBitLongCallback", "ReadBitBufferLongLongCallback", "ReadBitBufferVarInt32Callback", "ReadBitBufferBitAngleCallback", "ReadBitBufferBitCoordinateMPCallback"]) {
		Check(GetFunction(strSource, strName).includes("ApplyBitBufferReaderOperation("), `${strName}: retain common parse/read/store exception boundary`);
	}

	Check(GetFunction(strSource, "ReadBitBufferBitCoordinateMPCallback").includes("ReadBitBufferMultiplayerCoordinateValue(OperationBitBufferReader, bIntegral, bLowPrecision)"), "Multiplayer callback: shift-safe selected-profile helper");
	Check(GetFunction(strSource, "ReadBitBufferMultiplayerCoordinateValue").includes("nIntegerBitCount + 1"), "Packed integral MP: preserve combined sign/integer payload block");
	Check(GetFunction(strSource, "ReadBitBufferMultiplayerCoordinateValue").includes("ReadBitBufferScalarUnsignedValue(Reader, nPayloadBitCount)"), "Packed fractional MP: preserve combined integer/fraction payload block");
	Check(GetFunction(strSource, "ReadBitBufferMultiplayerCoordinateValue").includes("ReadBitBufferScalarUnsignedValue(Reader, nFractionBitCount)"), "Legacy MP: preserve separate fractional payload block");
	Check(GetFunction(strSource, "ReadBitBufferVectorCoordinateValue").includes("CoordinateVectorOut.z = 0.0F;"), "Coordinate vector: absent components are initialized");
	Check(GetFunction(strSource, "ReadBitBufferVectorNormalValue").includes("::sqrt(1.0F - flSquaredLength)"), "Normal vector: retain selected SDK global square-root lookup");
	Check(GetFunction(strSource, "ReadBitBufferVectorNormalValue").includes("NormalVectorOut.z = -NormalVectorOut.z;"), "Normal vector: preserve final z sign including negative zero");
	Check(GetFunction(strSource, "ReadBitBufferAnglesValue").includes("ReadBitBufferVectorCoordinateValue(Reader, CoordinateVector)"), "Angles: use compressed coordinate vector format");
	Check(GetFunction(strSource, "ReadBitBufferBitVector3CoordinateCallback").includes("ReadBitBufferVectorCoordinateValue(OperationBitBufferReader, "), "ReadBitBufferBitVector3CoordinateCallback: shift-safe field reader");
	Check(GetFunction(strSource, "ReadBitBufferBitVector3NormalCallback").includes("ReadBitBufferVectorNormalValue(OperationBitBufferReader, "), "ReadBitBufferBitVector3NormalCallback: shift-safe field reader");
	Check(GetFunction(strSource, "ReadBitBufferBitAnglesCallback").includes("ReadBitBufferAnglesValue(OperationBitBufferReader, "), "ReadBitBufferBitAnglesCallback: shift-safe field reader");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kNoSoundFlags = 0x0000;"), "kNoSoundFlags: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kChangeVolumeSoundFlag = 0x0001;"), "kChangeVolumeSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kChangePitchSoundFlag = 0x0002;"), "kChangePitchSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kStopSoundFlag = 0x0004;"), "kStopSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kSpawningSoundFlag = 0x0008;"), "kSpawningSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kDelaySoundFlag = 0x0010;"), "kDelaySoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kStopLoopingSoundFlag = 0x0020;"), "kStopLoopingSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kSpeakerSoundFlag = 0x0040;"), "kSpeakerSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kShouldPauseSoundFlag = 0x0080;"), "kShouldPauseSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kIgnorePhonemesSoundFlag = 0x0100;"), "kIgnorePhonemesSoundFlag: exact hexadecimal flag value");
	Check(GetFunction(strSource, "InstallSoundConstants").includes("constexpr int kIgnoreNameSoundFlag = 0x0200;"), "kIgnoreNameSoundFlag: exact hexadecimal flag value");

	const strSoundPropertyReader = GetFunction(strSource, "GetSoundObjectPropertyValue");
	Check(!strSoundPropertyReader.includes("return v8::Undefined(pIsolate);"), "Sound property reader: failure is empty, not a missing-property default");
	Check(strSoundPropertyReader.includes("->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue)"), "Sound property reader: preserve the original pending JavaScript getter error");

	for (const vecParser of [
		["GetSoundFloatPropertyFromObject", "flPropertyValueOut = flDefaultValue;"],
		["GetSoundIntegerPropertyFromObject", "nPropertyValueOut = nDefaultPropertyValue;"],
		["GetSoundBooleanPropertyFromObject", "bPropertyValueOut = bDefaultPropertyValue;"],
	]) {
		const strParser = GetFunction(strSource, vecParser[0]);
		Check(strParser.includes("if (LocalPropertyValue.IsEmpty())"), `${vecParser[0]}: reject failed property access`);
		Check(DoesTextPrecede(strParser, "if (IsValueNullish(LocalPropertyValue))", vecParser[1]), `${vecParser[0]}: commit defaults only after successful property access`);
		const strDefaultIndentation = strParser.match(/^\t+/)[0] + "\t\t";
		Check(strParser.includes(`if (IsValueNullish(LocalPropertyValue)) {\n${strDefaultIndentation}${vecParser[1]}\n${strDefaultIndentation}return true;`), `${vecParser[0]}: keep the nullish default inside its successful branch`);
	}

	for (const strName of ["ReadBitBufferBitVector3CoordinateCallback", "ReadBitBufferBitVector3NormalCallback", "ReadBitBufferBitAnglesCallback", "ReadBitBufferStringCallback"]) {
		Check(GetFunction(strSource, strName).includes("ApplyBitBufferReaderOperation("), `${strName}: preserve common parse/read/store exception boundary`);
	}

	const strStringReader = GetFunction(strSource, "ReadBitBufferStringCallback");
	Check(strStringReader.includes("unByteCount < (kStringBufferSize - 1)"), "String reader: reserve one byte for the terminator");
	Check(strStringReader.includes("szStringBuffer[unByteCount] = '\\0';"), "String reader: always terminate inside fixed storage");
	Check(strStringReader.includes("!OperationBitBufferReader.IsOverflowed() && !bTooSmall"), "String reader: reject overflow and excessive output length");

	return unCount;
}

function VerifyRejectedMutation(strLabel, strOld, strNew) {
	if ((strOld === strNew) || !g_strSource.includes(strOld)) {
		throw new Error(`Invalid regression setup ${strLabel}.`);
	}

	let bRejected = false;
	try {
		VerifyContracts(g_strSource.replace(strOld, strNew));
	} catch {
		bRejected = true;
	}

	if (!bRejected) {
		throw new Error(`Undetected native regression ${strLabel}.`);
	}
}

VerifyTextOrderingContracts();

const g_unContractCount = VerifyContracts(g_strSource);
let g_unRejectedMutationCount = 0;
for (const strName of ["LoadKeyValuesFromFileCallback", "SaveKeyValuesToFileCallback", "PackUInt32Callback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} exception scope`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
	++g_unRejectedMutationCount;
}

const g_strPropertyBody = GetFunction(g_strSource, "GetObjectPropertyValueForBitBuffers");
VerifyRejectedMutation("Canonical bitbuffer property result", g_strPropertyBody, g_strPropertyBody.replace("return LocalValue;", "return v8::Undefined(pIsolate);"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Canonical bitbuffer property lookup", g_strPropertyBody, g_strPropertyBody.replace("LocalObject->Get(LocalContext, LocalPropertyName)", "LocalObject->Get(LocalContext, LocalPrivatePropertyName)"));
++g_unRejectedMutationCount;

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferScalarUnsignedValue");
	VerifyRejectedMutation("Scalar public storage", strBody, strBody.replace("Reader.GetBasePointer()", "nullptr"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferScalarUnsignedValue");
	VerifyRejectedMutation("Scalar capacity guard", strBody, strBody.replace("Reader.GetNumBitsLeft() < nBitCount", "Reader.GetNumBitsLeft() > nBitCount"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferScalarSignedValue");
	VerifyRejectedMutation("Legacy signed magnitude", strBody, strBody.replace("ReadBitBufferScalarUnsignedValue(Reader, nMagnitudeBitCount)", "ReadBitBufferScalarUnsignedValue(Reader, nBitCount)"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "WriteBitBufferNormalFlag");
	VerifyRejectedMutation("Legacy normal sticky flag", strBody, strBody.replace("WriteLegacyBitBufferFlag(BitBufferWriter, bValue)", "BitBufferWriter.WriteOneBit(bValue)"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferMultiplayerCoordinateValue");
	VerifyRejectedMutation("Packed MP integer boundary", strBody, strBody.replace("nIntegerBitCount + 1", "nIntegerBitCount"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferMultiplayerCoordinateValue");
	VerifyRejectedMutation("Legacy MP fraction boundary", strBody, strBody.replace("ReadBitBufferScalarUnsignedValue(Reader, nFractionBitCount)", "ReadBitBufferScalarUnsignedValue(Reader, nPayloadBitCount)"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferVectorNormalValue");
	VerifyRejectedMutation("Normal z sign", strBody, strBody.replace("NormalVectorOut.z = -NormalVectorOut.z;", "NormalVectorOut.z = NormalVectorOut.z;"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "ReadBitBufferVectorCoordinateValue");
	VerifyRejectedMutation("Coordinate vector initialization", strBody, strBody.replace("CoordinateVectorOut.z = 0.0F;", "CoordinateVectorOut.z = 1.0F;"));
	++g_unRejectedMutationCount;
}

{
	const strBody = GetFunction(g_strSource, "InstallSoundConstants");
	VerifyRejectedMutation("Sound flags hexadecimal", strBody, strBody.replace("kChangeVolumeSoundFlag = 0x0001", "kChangeVolumeSoundFlag = 1 << 0"));
	++g_unRejectedMutationCount;
}

const g_strCopyBody = GetFunction(g_strSource, "WriteBitBufferBitsFromBufferCallback");
VerifyRejectedMutation("Writer store failure short circuit", g_strCopyBody, g_strCopyBody.replace("if (!StoreBitBufferWriterStateInObject(", "if (StoreBitBufferWriterStateInObject("));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Reader store failure short circuit", g_strCopyBody, g_strCopyBody.replace("if (!StoreBitBufferReaderStateInObject(", "if (StoreBitBufferReaderStateInObject("));
++g_unRejectedMutationCount;

const g_strPackBody = GetFunction(g_strSource, "PackUInt32Callback");
for (const vecMutation of [
	["pack own indices", "LocalPackedByteArray->CreateDataProperty(", "LocalPackedByteArray->Set("],
	["pack strict input", "->IsUint32()", "->IsNumber()"],
	["pack write result", "MaybeCreateResult.IsNothing() || !MaybeCreateResult.FromJust()", "MaybeCreateResult.IsNothing()"],
	["pack endian order", "(unUInt32Value >> (unByteIndex * kBitsPerByte)) & kByteMask", "(unUInt32Value << (unByteIndex * kBitsPerByte)) & kByteMask"],
]) {
	VerifyRejectedMutation(vecMutation[0], g_strPackBody, g_strPackBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

const g_strStateBody = GetFunction(g_strSource, "GetBitBufferStateFromValue");
for (const vecMutation of [
	["byte exception propagation", "BytesConversionFailure.ReThrow();", "ThrowError(pIsolate, kBitBufferStateBytesConversionError);"],
	["byte failure gate", "if (!bConvertedBytes && BytesConversionFailure.HasCaught())", "if (bConvertedBytes && BytesConversionFailure.HasCaught())"],
	["byte fallback gate", "if (!bConvertedBytes)", "if (bConvertedBytes)"],
	["byte range check", "unCapacityByteCount <= (kMaximumBitCountAsSize / kBitsPerByte)", "unCapacityByteCount >= (kMaximumBitCountAsSize / kBitsPerByte)"],
]) {
	VerifyRejectedMutation(vecMutation[0], g_strStateBody, g_strStateBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

const g_strByteCountBody = GetFunction(g_strSource, "CalculateByteCountForBitCount");
VerifyRejectedMutation("ceiling byte count", g_strByteCountBody, g_strByteCountBody.replace("1 + (nBitCount - 1) / kBitsPerByte", "nBitCount / kBitsPerByte"));
++g_unRejectedMutationCount;

const g_strWriterBody = GetFunction(g_strSource, "InitializeBitBufferWriterFromState");
for (const vecMutation of [
	["writer storage type", "std::vector<std::uint32_t> m_vecWriterWords;", "std::vector<char> m_vecWriterWords;"],
	["writer size limit", "if (unByteCount > kMaximumByteCount)", "if (unByteCount < kMaximumByteCount)"],
	["writer rounding", "1 + (unByteCount - 1) / kBytesPerWord", "unByteCount / kBytesPerWord"],
	["writer initialized padding", "m_vecWriterWords.assign(unWordCount, 0)", "m_vecWriterWords.resize(unWordCount)"],
	["writer signed bit capacity", " / kBitsPerByte / kBytesPerWord", " / kBytesPerWord"],
	["writer scalar-overrun headroom", "::max() - kMaximumScalarBitCount", "::max()"],
	["writer word boundary", "StartWriting(BitBufferState.m_vecWriterWords.data(), nStorageByteCount", "StartWriting(BitBufferState.m_vecBytes.data(), nStorageByteCount"],
	["writer cursor check", "m_nCurrentBitIndex > BitBufferState.m_nDataBitCount", "m_nCurrentBitIndex < BitBufferState.m_nDataBitCount"],
]) {
	if (vecMutation[0] === "writer storage type") {
		VerifyRejectedMutation(vecMutation[0], vecMutation[1], vecMutation[2]);
	} else {
		VerifyRejectedMutation(vecMutation[0], g_strWriterBody, g_strWriterBody.replace(vecMutation[1], vecMutation[2]));
	}

	++g_unRejectedMutationCount;
}

const g_strWriterStoreBody = GetFunction(g_strSource, "StoreBitBufferWriterStateInObject");
for (const vecMutation of [
	["writer copy-back bounds", "unRequiredWordCount > BitBufferState.m_vecWriterWords.size()", "unRequiredWordCount < BitBufferState.m_vecWriterWords.size()"],
	["writer logical copy-back", "BitBufferState.m_vecWriterWords.data(), unByteCount", "BitBufferState.m_vecWriterWords.data(), unRequiredWordCount * kBytesPerWord"],
]) {
	VerifyRejectedMutation(vecMutation[0], g_strWriterStoreBody, g_strWriterStoreBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

const g_strReaderBody = GetFunction(g_strSource, "InitializeBitBufferReaderFromState");
for (const vecMutation of [
	["reader size check", "if (unByteCount > kMaximumByteCount)", "if (unByteCount < kMaximumByteCount)"],
	["reader rounded words", "1 + (unByteCount - 1) / kBytesPerWord", "unByteCount / kBytesPerWord"],
	["reader initialized padding", "m_vecReaderWords.assign(unWordCount, 0)", "m_vecReaderWords.resize(unWordCount)"],
	["reader scalar-overrun headroom", "::max() - kMaximumScalarBitCount", "::max()"],
	["reader storage", "StartReading(BitBufferState.m_vecReaderWords.data(),", "StartReading(BitBufferState.m_vecBytes.data(),"],
	["reader logical EOF", "kInitialBitIndex, BitBufferState.m_nDataBitCount", "kInitialBitIndex, nStorageByteCount * 8"],
	["reader checked cursor", "if (!BitBufferReaderOut.Seek(", "if (BitBufferReaderOut.Seek("],
	["reader cursor check", "m_nCurrentBitIndex > BitBufferState.m_nDataBitCount", "m_nCurrentBitIndex < BitBufferState.m_nDataBitCount"],
]) {
	VerifyRejectedMutation(vecMutation[0], g_strReaderBody, g_strReaderBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

VerifyRejectedMutation("reader checked backend", "using SDKBitBufferReader = old_bf_read;", "using SDKBitBufferReader = CBitRead;");
++g_unRejectedMutationCount;

const g_strSignedLongLongBody = GetFunction(g_strSource, "ReadBitBufferSignedLongLongValue");
for (const vecMutation of [
	["signed 64-bit word width", "kWordBitCount = 32", "kWordBitCount = 31"],
	["signed 64-bit word order", "unLowWord | (unHighWord << kWordBitCount)", "unHighWord | (unLowWord << kWordBitCount)"],
	["signed 64-bit representation copy", "std::memcpy(&nValue, &unValue, sizeof(nValue));", "nValue = static_cast<std::int64_t>(unValue);"],
]) {
	VerifyRejectedMutation(vecMutation[0], g_strSignedLongLongBody, g_strSignedLongLongBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

const g_strLongLongCallbackBody = GetFunction(g_strSource, "ReadBitBufferLongLongCallback");
VerifyRejectedMutation("signed 64-bit public helper", g_strLongLongCallbackBody, g_strLongLongCallbackBody.replace("ReadBitBufferSignedLongLongValue(OperationBitBufferReader)", "OperationBitBufferReader.ReadLongLong()"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("signed 64-bit exact result", g_strLongLongCallbackBody, g_strLongLongCallbackBody.replace("v8::BigInt::New(pIsolate, nReadValue)", "v8::Number::New(pIsolate, nReadValue)"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("float public helper", "ReadBitBufferFloatCallback, ReadBitBufferFloatValue(OperationBitBufferReader)", "ReadBitBufferFloatCallback, OperationBitBufferReader.ReadFloat()");
++g_unRejectedMutationCount;

for (const strOperationKind of ["Writer", "Reader"]) {
	const strOperationBody = GetFunction(g_strSource, `ApplyBitBuffer${strOperationKind}Operation`);
	VerifyRejectedMutation(`${strOperationKind} operation exception scope`, strOperationBody, strOperationBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
	++g_unRejectedMutationCount;
}

for (const strName of ["CreateBitBufferWriterCallback", "CreateBitBufferReaderCallback", "SetBitBufferBytesCallback", "SetBitBufferDataBitCountCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	const nBoundaryCatchIndex = strBody.lastIndexOf("} catch (...) {");
	VerifyRejectedMutation(`${strName} exception scope`, strBody, strBody.slice(0, nBoundaryCatchIndex) + strBody.slice(nBoundaryCatchIndex).replace("} catch (...) {", "} catch (std::exception const&) {"));
	++g_unRejectedMutationCount;
}

const g_strCreateReaderBody = GetFunction(g_strSource, "CreateBitBufferReaderCallback");
VerifyRejectedMutation("reader construction original error", g_strCreateReaderBody, g_strCreateReaderBody.replace("BytesConversionFailure.ReThrow();", "ThrowError(pIsolate, kSourceBytesError);"));
++g_unRejectedMutationCount;

VerifyRejectedMutation("reader construction native unwind", g_strCreateReaderBody, g_strCreateReaderBody.replace(/if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/, "throw;"));
++g_unRejectedMutationCount;

for (const strName of ["SetBitBufferDataByteCountCallback", "SetBitBufferCurrentBitIndexCallback", "GetBitBufferBytesCallback", "GetBitBufferDataByteCountCallback", "SetBitBufferOverflowFlagCallback", "ClearBitBufferOverflowFlagCallback", "ResetBitBufferCallback", "CheckBitBufferForOverflowCallback", "SeekBitBufferToBitCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} state exception scope`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
	++g_unRejectedMutationCount;
}

for (const vecCallback of [
	["WriteBitBufferBitVector3CoordinateCallback", "CoordinateVector"],
	["WriteBitBufferBitVector3NormalCallback", "NormalVector"],
	["WriteBitBufferBitAnglesCallback", "AngleVector"],
]) {
	const strBody = GetFunction(g_strSource, vecCallback[0]);
	VerifyRejectedMutation(`${vecCallback[0]} vector capture`, strBody, strBody.replace(`[&${vecCallback[1]}]`, `[${vecCallback[1]}]`));
	++g_unRejectedMutationCount;
}

const g_strWriterOperationBody = GetFunction(g_strSource, "ApplyBitBufferWriterOperation");
VerifyRejectedMutation("synchronous vector operation", g_strWriterOperationBody, g_strWriterOperationBody.replace("OperationCallback(BitBufferWriter);", "return false;"));
++g_unRejectedMutationCount;

const g_vecStateGetterMacroMatch = /^#define SOURCEJS_DEFINE_BITBUFFER_STATE_GETTER_CALLBACK\b[^\n]*\n(\t+)void NAME##Callback[^\n]*\n[\s\S]*?^\1\}/m.exec(g_strSource);
VerifyRejectedMutation("generated state getter exception scope", g_vecStateGetterMacroMatch[0], g_vecStateGetterMacroMatch[0].replace("} catch (...) {", "} catch (std::exception const&) {"));
++g_unRejectedMutationCount;

const g_strDataBitGetterUse = 'SOURCEJS_DEFINE_BITBUFFER_STATE_GETTER_CALLBACK(GetBitBufferDataBitCount, "GetDataBitCount",';
VerifyRejectedMutation("generated state getter public diagnostic", g_strDataBitGetterUse, g_strDataBitGetterUse.replace('"GetDataBitCount"', '"GetWrongBitCount"'));
++g_unRejectedMutationCount;

for (const strName of ["SeekBitBufferRelativeCallback", "ConvertBitBufferToBytesCallback", "WriteBitBufferBitsFromBufferCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} operation exception scope`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
	++g_unRejectedMutationCount;
}

const g_strUnsignedWriter = GetFunction(g_strSource, "WriteBitBufferUnsignedValue");
VerifyRejectedMutation("Unsigned writer single-bit mask", g_strUnsignedWriter, g_strUnsignedWriter.replace("kBitValueMask = 0x01", "kBitValueMask = 0x03"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Unsigned writer named mask use", g_strUnsignedWriter, g_strUnsignedWriter.replace("& kBitValueMask", "& 1"));
++g_unRejectedMutationCount;

const g_strPackedCoordinateWriter = GetFunction(g_strSource, "WritePackedBitBufferMultiplayerCoordinate");
VerifyRejectedMutation("Packed coordinate hexadecimal kInBoundsFlag", g_strPackedCoordinateWriter, g_strPackedCoordinateWriter.replace("kInBoundsFlag = 0x01", "kInBoundsFlag = 1"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Packed coordinate hexadecimal kHasIntegerFlag", g_strPackedCoordinateWriter, g_strPackedCoordinateWriter.replace("kHasIntegerFlag = 0x02", "kHasIntegerFlag = 2"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Packed coordinate hexadecimal kSignFlag", g_strPackedCoordinateWriter, g_strPackedCoordinateWriter.replace("kSignFlag = 0x04", "kSignFlag = 4"));
++g_unRejectedMutationCount;

const g_strInt64Writer = GetFunction(g_strSource, "WriteBitBufferLongLongCallback");
VerifyRejectedMutation("Int64 writer low-word boundary", g_strInt64Writer, g_strInt64Writer.replace("WriteBitBufferUnsignedValue(BitBufferWriter, unLowWord, kWordBitCount);", "BitBufferWriter.WriteUBitLong(unLowWord, kWordBitCount);"));
++g_unRejectedMutationCount;
VerifyRejectedMutation("Int64 writer high-word boundary", g_strInt64Writer, g_strInt64Writer.replace("WriteBitBufferUnsignedValue(BitBufferWriter, unHighWord, kWordBitCount);", "BitBufferWriter.WriteUBitLong(unHighWord, kWordBitCount);"));
++g_unRejectedMutationCount;

const g_strBitAtWriter = GetFunction(g_strSource, "WriteBitBufferOneBitAtCallback");
VerifyRejectedMutation("Indexed bit signed-overflow boundary", g_strBitAtWriter, g_strBitAtWriter.replace("if (nBitIndex >= BitBufferWriter.GetMaxNumBits()) {", "if (nBitIndex + 1 > BitBufferWriter.GetMaxNumBits()) {"));
++g_unRejectedMutationCount;

for (const vecMutation of [
	["binary32 radix", "std::numeric_limits<float>::radix == 2", "std::numeric_limits<float>::radix == 10"],
	["binary32 significand", "std::numeric_limits<float>::digits == 24", "std::numeric_limits<float>::digits == 53"],
	["binary32 exponent", "std::numeric_limits<float>::max_exponent == 128", "std::numeric_limits<float>::max_exponent == 1024"],
	["float representation", "std::memcpy(&unValue, &flValue, sizeof(unValue));", "unValue = *reinterpret_cast<std::uint32_t*>(&flValue);"],
	["signed zero-width guard", "if (nBitCount == 0)", "if (nBitCount < 0)"],
	["unary termination width", "static_cast<std::uint64_t>(unValue) > (unBase * 2)", "unValue > (static_cast<std::uint32_t>(unBase) * 2)"],
]) {
	const strName = vecMutation[0].startsWith("signed") ? "WriteBitBufferSignedValue" : (vecMutation[0].startsWith("unary") ? "WriteBitBufferVariableUnsignedValue" : "WriteBitBufferBitFloatCallback");
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(vecMutation[0], strBody, strBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

for (const vecMutation of [
	["String native boundary", "catch (...)", "catch (std::logic_error const&)"],
	["String conversion propagation", "->ToString(LocalContext).ToLocal(&LocalString)", "->ToObject(LocalContext).ToLocal(&LocalString)"],
	["String UTF-8 conversion", "v8::String::Utf8Value(pIsolate, LocalString)", "v8::String::Utf8Value(pIsolate, CallbackInformation[kStringValueArgumentIndex])"],
	["String terminator", "WriteBitBufferSignedValue(BitBufferWriter, 0, kCharacterBitCount);", "WriteBitBufferSignedValue(BitBufferWriter, 1, kCharacterBitCount);"],
]) {
	const strBody = GetFunction(g_strSource, "WriteBitBufferStringCallback");
	VerifyRejectedMutation(vecMutation[0], strBody, strBody.replace(vecMutation[1], vecMutation[2]));
	++g_unRejectedMutationCount;
}

for (const vecMutation of [
	["Peek native boundary", "PeekBitBufferUBitLongCallback", "catch (...)", "catch (std::logic_error const&)"],
	["Peek non-mutating contract", "PeekBitBufferUBitLongCallback", "BitBufferReader.PeekUBitLong(nBitCount)", "BitBufferReader.ReadUBitLong(nBitCount); StoreBitBufferReaderStateInObject(pIsolate, LocalContext, LocalBitBufferStateObject, BitBufferState, BitBufferReader)"],
	["Signed reader zero-width guard", "ReadBitBufferSBitLongCallback", "if (nBitCount == 0)", "if (nBitCount < 0)"],
	["Signed reader wide shift", "ReadBitBufferSBitLongCallback", "std::int64_t(1) << nBitCount", "std::uint32_t(1) << nBitCount"],
	["VarInt32 reader overflow", "ReadBitBufferVarInt32Callback", "unPayload > (kMaximumValue >> nBitShift)", "false"],
	["LongLong reader precision", "ReadBitBufferLongLongCallback", "v8::BigInt::New(pIsolate, nReadValue)", "v8::Number::New(pIsolate, nReadValue)"],
	["UBitVar reader profile", "ReadBitBufferVariableUnsignedValue", "#elif defined(ENGINE_BRANCH_PORTAL2) || defined(ENGINE_BRANCH_SWARM)", "#elif defined(ENGINE_BRANCH_CSGO) || defined(ENGINE_BRANCH_PORTAL2) || defined(ENGINE_BRANCH_SWARM)"],
	["UBitVar header boundary", "ReadBitBufferVariableUnsignedValue", "constexpr int kHeaderBitCount", "constexpr int kOtherHeaderBitCount"],
]) {
	const strBody = GetFunction(g_strSource, vecMutation[1]);
	VerifyRejectedMutation(vecMutation[0], strBody, strBody.replace(vecMutation[2], vecMutation[3]));
	++g_unRejectedMutationCount;
}

for (const vecMutation of [
	["Sound getter failure default", "GetSoundObjectPropertyValue", "return {};", "return v8::Undefined(pIsolate);"],
	["Sound float missing-value branch", "GetSoundFloatPropertyFromObject", "if (IsValueNullish(LocalPropertyValue))", "if (true)"],
	["Sound integer missing-value branch", "GetSoundIntegerPropertyFromObject", "if (IsValueNullish(LocalPropertyValue))", "if (true)"],
	["Sound boolean missing-value branch", "GetSoundBooleanPropertyFromObject", "if (IsValueNullish(LocalPropertyValue))", "if (true)"],
	["String reader terminator space", "ReadBitBufferStringCallback", "unByteCount < (kStringBufferSize - 1)", "unByteCount < kStringBufferSize"],
	["String reader overflow result", "ReadBitBufferStringCallback", "!OperationBitBufferReader.IsOverflowed() && !bTooSmall", "!bTooSmall"],
]) {
	const strBody = GetFunction(g_strSource, vecMutation[1]);
	VerifyRejectedMutation(vecMutation[0], strBody, strBody.replace(vecMutation[2], vecMutation[3]));
	++g_unRejectedMutationCount;
}

VerifyRejectedMutation("State initial overflow", "m_bOverflowed = false;", "m_bOverflowed = true;");
++g_unRejectedMutationCount;

const g_BitBufferUnwindPattern = /if \(BytesConversionFailure\.HasCaught\(\)\) \{\n\t+BytesConversionFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;/;
VerifyRejectedMutation("State byte conversion native unwind", g_strStateBody, g_strStateBody.replace(g_BitBufferUnwindPattern, "throw;"));
++g_unRejectedMutationCount;

for (const strName of ["LoadKeyValuesFromFileCallback", "SaveKeyValuesToFileCallback", "PackUInt32Callback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} missing isolate guard`, strBody, strBody.replace("if (!pIsolate)", "if (false)"));
	++g_unRejectedMutationCount;
}

console.log(`BitBuffers native state contracts passed: ${g_unContractCount} contracts and ${g_unRejectedMutationCount} rejected mutations; native execution is a separate check.`);
