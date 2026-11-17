#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && ["--help", "-h"].includes(g_vecArguments[0])) {
	console.log("Usage: node tools/smoke_memory_native_contracts.js");
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error("Usage: node tools/smoke_memory_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecArgumentNames = [
	"RequireMemoryUInt64FromValue",
	"RequireMemoryAddressFromValue",
	"RequireMemoryAddressArgument",
	"GetOptionalMemoryAddressArgument",
	"RequireMemorySignedIntegerFromValue",
	"GetOptionalMemoryOffsetArgument",
	"RequireMemoryInt32InRangeFromValue",
	"RequireMemoryUInt32AtMostFromValue",
	"RequireMemoryFiniteNumberFromValue",
	"RequireMemorySizeFromValue",
	"RequireMemoryManagerStringArgument",
	"GetOptionalMemoryManagerStringArgument",
];

const g_vecBoundedIntegerReaders = [
	{ Name: "RequireMemoryInt32InRangeFromValue", Type: "int", Output: "nIntegerOut = static_cast<int>(dblInteger);", Guard: "if (!std::isfinite(dblInteger) || (std::floor(dblInteger) != dblInteger) || (dblInteger < static_cast<double>(nMinimumValue)) || (dblInteger > static_cast<double>(nMaximumValue)))" },
	{ Name: "RequireMemoryUInt32AtMostFromValue", Type: "std::uint32_t", Output: "unIntegerOut = static_cast<std::uint32_t>(dblInteger);", Guard: "if (!std::isfinite(dblInteger) || (std::floor(dblInteger) != dblInteger) || (dblInteger < 0.0) || (dblInteger > static_cast<double>(unMaximumValue)))" },
];

const g_vecCheckedIntegerWrites = [
	{ Read: "RequireMemoryInt32InRangeFromValue(pIsolate, LocalContext, LocalDataArgumentValue, kIntDataErrorMessage, kMinimumIntValue, kMaximumIntValue, nIntegerValue)", Legacy: "GetInt32Argument(pIsolate, LocalContext, LocalDataArgumentValue, kIntDataErrorMessage, nIntegerValue)", Value: "nIntegerValue" },
	{ Read: "RequireMemoryUInt32AtMostFromValue(pIsolate, LocalContext, LocalDataArgumentValue, kUnsignedIntDataErrorMessage, kMaximumUnsignedIntValue, unIntegerValue)", Legacy: "GetUInt32Argument(pIsolate, LocalContext, LocalDataArgumentValue, kUnsignedIntDataErrorMessage, unIntegerValue)", Value: "unIntegerValue" },
	{ Read: "RequireMemoryInt32InRangeFromValue(pIsolate, LocalContext, LocalDataArgumentValue, kLongDataErrorMessage, kMinimumIntValue, kMaximumIntValue, nLongValue)", Legacy: "GetInt32Argument(pIsolate, LocalContext, LocalDataArgumentValue, kLongDataErrorMessage, nLongValue)", Value: "static_cast<long>(nLongValue)" },
];

const g_vecIntegerWriteLimits = [
	"constexpr int kMinimumIntValue = std::numeric_limits<int>::min();",
	"constexpr int kMaximumIntValue = std::numeric_limits<int>::max();",
	"constexpr std::uint32_t kMaximumUnsignedIntValue = std::numeric_limits<std::uint32_t>::max();",
];

const g_vecCallbackNames = [
	"AllocateMemoryCallback",
	"ReallocateMemoryCallback",
	"DeallocateMemoryCallback",
	"GetMemoryHelpersAddressCallback",
	"IsMemoryHelpersNullCallback",
	"AddMemoryHelpersCallback",
	"SubtractMemoryHelpersCallback",
	"GetMemoryHelpersDifferenceCallback",
	"CompareMemoryHelpersCallback",
	"CopyMemoryHelpersCallback",
	"MoveMemoryHelpersCallback",
	"SearchMemoryHelpersBytesCallback",
	"SetMemoryHelpersProtectionCallback",
	"ReadMemoryHelpersAddressCallback",
	"ReadMemoryHelpersCallback",
	"WriteMemoryHelpersCallback",
	"GetMemoryHelpersVirtualTableCallback",
	"GetMemoryHelpersVirtualFunctionCallback",
	"CallFunctionCallback",
];

const g_vecBoundaries = [
	...g_vecArgumentNames.map(strName => ({ Name: strName, Frame: "MemoryArgumentReadFailure", Error: "pszArgumentErrorMessage" })),
	...g_vecCallbackNames.map(strName => ({ Name: strName, Frame: "MemoryOperationFailure", Error: "kMemoryCallbackErrorMessage" })),
	{ Name: "ApplyMemoryAddressOffset", Frame: "MemoryArgumentReadFailure", Error: "pszArithmeticErrorMessage" },
	{ Name: "RequireMemoryBytePatternFromValue", Frame: "MemoryArgumentReadFailure", Error: "kPatternConversionErrorMessage" },
	{ Name: "RequireMemoryProtectionFromValue", Frame: "MemoryArgumentReadFailure", Error: "kProtectionConversionErrorMessage" },
	{ Name: "MakeMemoryStringArray", Frame: "MemoryArrayBuildFailure", Error: "kMemoryArrayBuildErrorMessage" },
	{ Name: "InstallMemoryHelpersFunctions", Frame: "MemoryHelpersInstallationFailure", Error: "kMemoryHelpersInstallationErrorMessage" },
	{ Name: "MakeMemoryManagerINIValue", Frame: "MemoryGameDataFailure", Error: "kINIValueErrorMessage" },
	{ Name: "ParseMemoryManagerINI", Frame: "MemoryGameDataFailure", Error: "kINIParseErrorMessage" },
	{ Name: "LoadMemoryManagerGameDataFileValue", Frame: "MemoryGameDataFailure", Error: "kGameDataLoadErrorMessage" },
	{ Name: "GetMemoryManagerProperty", Frame: "MemoryPropertyReadFailure", Error: "kPropertyReadErrorMessage" },
	{ Name: "GetMemoryManagerValueByPath", Frame: "MemoryPathReadFailure", Error: "kPathReadErrorMessage" },
	{ Name: "GetMemoryManagerSelectedValue", Frame: "MemorySelectionFailure", Error: "kSelectionErrorMessage" },
	{ Name: "SelectMemoryManagerValue", Frame: "MemorySelectionFailure", Error: "kSelectionErrorMessage" },
	{ Name: "GetMemoryManagerSelectedString", Frame: "MemorySelectionFailure", Error: "pszSelectionErrorMessage" },
	{ Name: "GetMemoryManagerSelectedInteger", Frame: "MemoryIntegerReadFailure", Error: "pszIntegerErrorMessage" },
	{ Name: "MakeMemoryManagerBinaryObject", Frame: "MemoryBinaryBuildFailure", Error: "kBinaryBuildErrorMessage" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Frame: "MemoryRecordResolveFailure", Error: "kRecordResolveErrorMessage" },
	{ Name: "ResolveMemoryManagerIdentifier", Frame: "MemoryIdentifierResolveFailure", Error: "kArgumentErrorMessage" },
	{ Name: "GetMemoryManagerNamedData", Frame: "MemoryNamedDataReadFailure", Error: "kNamedDataReadErrorMessage" },
	{ Name: "ResolveMemoryManagerSignatureAddress", Frame: "MemorySignatureResolveFailure", Error: "kSignatureResolveErrorMessage" },
	{ Name: "CopyMemoryManagerSelectedProperty", Frame: "MemoryPropertyCopyFailure", Error: "kPropertyCopyErrorMessage" },
	{ Name: "MakeMemoryManagerOptions", Frame: "MemoryOptionsBuildFailure", Error: "kOptionsBuildErrorMessage" },
	{ Name: "GetProjectGameDataRootPathCallback", Frame: "MemoryGameDataRootFailure", Error: "kGameDataRootErrorMessage" },
	{ Name: "GetAllGameDataFilesCallback", Frame: "MemoryGameDataFilesFailure", Error: "kGameDataFilesErrorMessage", EarlyResultConditions: ["if (unWriteIndex == kMaximumArrayIndex) {"] },
	{ Name: "LoadGameDataFileCallback", Frame: "MemoryGameDataLoadFailure", Error: "kGameDataLoadErrorMessage", EarlyResultConditions: ["if (!LocalGameDataValue->IsObject()) {"] },
	{ Name: "GetGameDataValueCallback", Frame: "MemoryGameDataValueFailure", Error: "kGameDataValueErrorMessage", EarlyResultConditions: ["if (CallbackInformation.Length() <= kPathArgumentIndex) {", "if (LocalPathArgumentValue.IsEmpty() || LocalPathArgumentValue->IsNull() || LocalPathArgumentValue->IsUndefined()) {"] },
	{ Name: "SelectRuntimeValueCallback", Frame: "MemoryRuntimeSelectionFailure", Error: "kRuntimeSelectionErrorMessage" },
	{ Name: "GetGameDataOffsetCallback", Frame: "MemoryGameDataOffsetFailure", Error: "kGameDataOffsetErrorMessage", EarlyResultConditions: ["if (IntegerResult == MemoryManagerIntegerResult::Missing) {"] },
	{ Name: "GetGameDataSignatureCallback", Frame: "MemoryGameDataSignatureFailure", Error: "kGameDataSignatureErrorMessage" },
	{ Name: "GetGameDataAddressCallback", Frame: "MemoryGameDataAddressFailure", Error: "kGameDataAddressErrorMessage", EarlyResultConditions: ["if (!LocalOptionsValue->IsObject()) {", "if (LocalAddressPropertyValue.IsEmpty()) {", "if (!GetAddressSizedUnsignedIntegerFromValue(LocalAddressPropertyValue, unOptionsAddress)) {"] },
	{ Name: "ScanBinaryCallback", Frame: "MemoryBinaryScanFailure", Error: "kBinaryScanErrorMessage", EarlyResultConditions: ["if (!ScanMemoryManagerBinary(strModuleName, strBytePattern, unMatchAddress)) {"] },
	{ Name: "GetBinarySymbolCallback", Frame: "MemoryBinarySymbolFailure", Error: "kBinarySymbolErrorMessage", EarlyResultConditions: ["if (!ResolveMemoryManagerSymbol(strModuleName, strSymbolName, unSymbolAddress)) {"] },
	{ Name: "ResolveBinaryIdentifierCallback", Frame: "MemoryBinaryIdentifierFailure", Error: "kBinaryIdentifierErrorMessage" },
	{ Name: "GetBinaryCallback", Frame: "MemoryBinaryLookupFailure", Error: "kBinaryLookupErrorMessage", EarlyResultConditions: ["if (!FindMemoryManagerBinary(strBinaryName, BinaryInformation)) {"] },
	{ Name: "GetAllBinariesCallback", Frame: "MemoryBinaryListFailure", Error: "kBinaryListErrorMessage" },
	{ Name: "CreateGameDataCallableOptionsCallback", Frame: "MemoryCallableOptionsFailure", Error: "kCallableOptionsErrorMessage" },
	{ Name: "InstallMemoryManagerExports", Frame: "MemoryManagerInstallationFailure", Error: "kManagerInstallationErrorMessage" },
];

function GetDefinitionRegion(strSource, strName) {
	const vecDefinitionMatches = new RegExp("^(\\t{1,2})(?:bool|void|v8::Local<v8::(?:Array|Object|Value)>|MemoryManagerIntegerResult|std::vector<std::filesystem::path>) " + strName + "\\([^\\n]+\\) (?:noexcept )?\\{$", "m").exec(strSource);
	g_Assert(vecDefinitionMatches, "Missing native definition: " + strName);

	const strEnd = "\n" + vecDefinitionMatches[1] + "}";
	const nEnd = strSource.indexOf(strEnd + "\n", vecDefinitionMatches.index);
	g_Assert(nEnd > vecDefinitionMatches.index, "Missing native definition end: " + strName);

	return { Start: vecDefinitionMatches.index, End: nEnd + strEnd.length, Indentation: vecDefinitionMatches[1] };
}

function GetDefinition(strSource, strName) {
	const Region = GetDefinitionRegion(strSource, strName);

	// Normalize only the contract view; regression controls still replace the exact source region.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? ("\t" + strLine.slice(Region.Indentation.length)) : strLine).join("\n");
}

function ReplaceDefinition(strSource, strName, strBody) {
	const Region = GetDefinitionRegion(strSource, strName);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? (Region.Indentation + strLine.slice(1)) : strLine).join("\n");

	return strSource.slice(0, Region.Start) + strReplacement + strSource.slice(Region.End);
}

function CheckContracts(strSource) {
	for (const Boundary of g_vecBoundaries) {
		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const strRethrow = "RethrowV8InstallationFailure(pIsolate, " + Boundary.Frame + ", ";
		g_Assert(strDefinition.includes("v8::TryCatch " + Boundary.Frame + "(pIsolate);\n\t\ttry {"), Boundary.Name + ": V8 frame survives C++ unwinding.");
		g_Assert(!strDefinition.slice(0, strDefinition.indexOf("v8::TryCatch " + Boundary.Frame)).includes(strRethrow), Boundary.Name + ": no rethrow before the local frame exists.");

		for (const strCatchType of ["std::exception const&", "..."]) {
			g_Assert(strDefinition.includes("} catch (" + strCatchType + ") {\n\t\t\t" + strRethrow + Boundary.Error + ");"), Boundary.Name + ": translate native exceptions.");
		}

		for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
			g_Assert(vecDiagnostic[2].includes(strRethrow), Boundary.Name + ": preserve diagnostics.");
		}

		// Local property-installation helpers return status; their owning boundary checks each failed call.
		const strProtectedBody = strDefinition.slice(strDefinition.indexOf("\n\t\ttry {")).replace(/^\t{3}auto const Define(?:Value|Function|Entry|Field) = [^\n]+\{\n[\s\S]*?^\t{3}\};/gm, "");
		g_Assert.doesNotMatch(strProtectedBody, /return RequireMemory\w+\(/, Boundary.Name + ": delegated failures must be rethrown before the local frame is destroyed.");

		for (const vecGuard of strProtectedBody.matchAll(/^(\t{3,})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
			if (/return false;|return;|return \{\};/.test(vecGuard[0])) {
				g_Assert(!/\w+Out =/.test(vecGuard[0]), Boundary.Name + ": no failed output commit.");

				const strCondition = vecGuard[0].slice(0, vecGuard[0].indexOf("\n")).trim();
				if (Boundary.EarlyResultConditions?.includes(strCondition)) {
					g_Assert(vecGuard[0].includes("CallbackInformation.GetReturnValue().Set("), Boundary.Name + ": a specifically documented successful/sentinel exit publishes its result.");
					g_Assert.doesNotMatch(vecGuard[0], /ThrowError\(/);

				} else {
					g_Assert(vecGuard[0].includes(strRethrow), Boundary.Name + ": propagate guarded failure.");
				}
			}
		}
	}

	for (const Reader of g_vecBoundedIntegerReaders) {
		const strDefinition = GetDefinition(strSource, Reader.Name);
		g_Assert(strDefinition.includes("static_assert(std::numeric_limits<" + Reader.Type + ">::digits <= std::numeric_limits<double>::digits);"));
		g_Assert(strDefinition.includes("if (!GetNumberArgument(pIsolate, LocalContext, LocalIntegerValue, pszArgumentErrorMessage, dblInteger))"), Reader.Name + ": retain and check the original numeric conversion.");
		g_Assert.doesNotMatch(strDefinition, /Get(?:Int32|UInt32)Argument\(/, Reader.Name + ": no modulo/truncation before validation.");
		const nGuard = strDefinition.indexOf(Reader.Guard);
		const nCommit = strDefinition.indexOf(Reader.Output);
		g_Assert((nGuard >= 0) && (nCommit > nGuard), Reader.Name + ": check finite integral source bounds before narrowing/output.");
	}

	g_Assert(GetDefinition(strSource, "GetOptionalMemoryOffsetArgument").includes("constexpr std::int64_t kDefaultOffset = 0x0;"));

	for (const strName of ["RequireMemoryUInt64FromValue", "RequireMemoryAddressFromValue", "RequireMemorySignedIntegerFromValue"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("->IsBigInt()"));
		g_Assert(strDefinition.includes("ConversionLossless"));
		g_Assert.doesNotMatch(strDefinition, /->IsNumber\(|NumberValue\(/);
	}

	for (const Reader of [
		{ Name: "RequireMemoryAddressArgument", Call: "RequireMemoryAddressFromValue" },
		{ Name: "GetOptionalMemoryAddressArgument", Call: "RequireMemoryAddressFromValue" },
		{ Name: "GetOptionalMemoryOffsetArgument", Call: "RequireMemorySignedIntegerFromValue" },
		{ Name: "RequireMemoryProtectionFromValue", Call: "RequireMemoryInt32InRangeFromValue" },
	]) {
		g_Assert(GetDefinition(strSource, Reader.Name).includes("if (!" + Reader.Call + "("), Reader.Name + ": check delegated conversion before returning success.");
	}

	for (const strName of ["AllocateMemoryCallback", "ReallocateMemoryCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("std::unique_ptr<void, void(*)(void*)> pAllocatedMemory("), "Attach malloc-family storage immediately to its free-family owner.");
		g_Assert(strDefinition.includes(", std::free);"));
		g_Assert(strDefinition.includes("reinterpret_cast<std::uintptr_t>(pAllocatedMemory.get())"));

		const nResultGuard = strDefinition.indexOf("if (LocalAddressValue.IsEmpty())");
		const nCommit = strDefinition.indexOf("CallbackInformation.GetReturnValue().Set(LocalAddressValue);");
		const nRelease = strDefinition.indexOf("pAllocatedMemory.release();");
		g_Assert(nResultGuard >= 0);
		g_Assert(nCommit > nResultGuard);
		g_Assert(nRelease > nCommit, "Release ownership only after constructing and publishing the BigInt result.");
		g_Assert.doesNotMatch(strDefinition, /std::free\(pAllocatedMemory/);
	}

	const strOffset = GetDefinition(strSource, "ApplyMemoryAddressOffset");
	g_Assert(strOffset.includes("-(nByteOffset + 1)"));
	g_Assert(strOffset.includes("unOffsetMagnitude > static_cast<std::uint64_t>(unBaseAddress)"));
	g_Assert(strOffset.includes("(kMaximumAddress - unOffsetMagnitude)"));

	for (const Transfer of [
		{ Name: "CompareMemoryHelpersCallback", Left: "unLeftAddress", Right: "unRightAddress", Call: "std::memcmp(" },
		{ Name: "CopyMemoryHelpersCallback", Left: "unSourceAddress", Right: "unDestinationAddress", Call: "std::memcpy(" },
		{ Name: "MoveMemoryHelpersCallback", Left: "unSourceAddress", Right: "unDestinationAddress", Call: "std::memmove(" },
	]) {
		const strDefinition = GetDefinition(strSource, Transfer.Name);
		const nNativeCall = strDefinition.indexOf(Transfer.Call);
		g_Assert(nNativeCall >= 0);

		for (const strAddress of [Transfer.Left, Transfer.Right]) {
			const nGuard = strDefinition.indexOf("!IsMemoryAddressRangeRepresentable(" + strAddress + ", unByteSize)");
			g_Assert((nGuard >= 0) && (nGuard < nNativeCall), Transfer.Name + ": validate both complete ranges before native access.");
		}
	}

	const strCopy = GetDefinition(strSource, "CopyMemoryHelpersCallback");
	const nOverlapGuard = strCopy.indexOf("if (DoMemoryAddressRangesOverlap(unSourceAddress, unDestinationAddress, unByteSize))");
	g_Assert((nOverlapGuard >= 0) && (nOverlapGuard < strCopy.indexOf("std::memcpy(")));
	g_Assert.doesNotMatch(GetDefinition(strSource, "MoveMemoryHelpersCallback"), /DoMemoryAddressRangesOverlap/);
	g_Assert(GetDefinition(strSource, "SearchMemoryHelpersBytesCallback").includes("if (!IsMemoryAddressRangeRepresentable(unSearchAddress, unSearchByteSize))"));

	for (const Reader of [
		{ Name: "RequireMemoryBytePatternFromValue", Address: "pszEncodedBytePattern", Consumer: "vecParsedBytePattern.assign(" },
		{ Name: "RequireMemoryProtectionFromValue", Address: "pszEncodedProtectionName", Consumer: "std::string const strProtectionName" },
		{ Name: "ReadMemoryHelpersCallback", Address: "pszEncodedDataTypeName", Consumer: "std::string const strRequestedDataTypeName" },
		{ Name: "WriteMemoryHelpersCallback", Address: "pszEncodedDataTypeName", Consumer: "std::string const strRequestedDataTypeName" },
		{ Name: "RequireMemoryManagerStringArgument", Address: "pszEncodedStringValue", Consumer: "std::string strParsedStringValue" },
	]) {
		const strDefinition = GetDefinition(strSource, Reader.Name);
		const nGuard = strDefinition.indexOf("if (!" + Reader.Address + ")");
		g_Assert((nGuard >= 0) && (nGuard < strDefinition.indexOf(Reader.Consumer)), Reader.Name + ": reject failed UTF-8 conversion before consumption.");
		g_Assert.doesNotMatch(strDefinition, /ValueToString\(/);
	}

	const strScalarRead = GetDefinition(strSource, "ReadMemoryScalarFromAddress");
	const nReadRangeGuard = strScalarRead.indexOf("if (!IsMemoryAddressRangeRepresentable(unAddress, sizeof(TValue)))");
	const nByteCopy = strScalarRead.indexOf("std::memcpy(&ReadValue, reinterpret_cast<void const*>(unAddress), sizeof(TValue));");
	g_Assert((nReadRangeGuard >= 0) && (nByteCopy > nReadRangeGuard));
	g_Assert(strScalarRead.indexOf("ReadValueOut = ReadValue;") > nByteCopy, "Commit the scalar only after validating and reading the full range.");
	g_Assert(strScalarRead.includes("std::is_trivially_copyable_v<TValue>"));
	g_Assert(GetDefinition(strSource, "WriteMemoryScalarToAddress").includes("std::memcpy(reinterpret_cast<void*>(unAddress), &WriteValue, sizeof(TValue));"));

	for (const strName of ["ReadMemoryHelpersAddressCallback", "ReadMemoryHelpersCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		const unExpectedReadCount = (strName === "ReadMemoryHelpersCallback") ? 15 : 1;
		g_Assert.equal([...strDefinition.matchAll(/ReadMemoryScalarFromAddress\(/g)].length, unExpectedReadCount);
		g_Assert.equal([...strDefinition.matchAll(/if \(!ReadMemoryScalarFromAddress\(/g)].length, unExpectedReadCount, "Every scalar read checks its complete-range result.");
		g_Assert.doesNotMatch(strDefinition, /\*reinterpret_cast<|\*ppAddressSlot|\*ppszStringSlot/);
	}

	const strWrite = GetDefinition(strSource, "WriteMemoryHelpersCallback");
	const nWriteRangeGuard = strWrite.indexOf("if (!IsMemoryAddressRangeRepresentable(unWriteSlotAddress, unWriteByteSize))");
	g_Assert((nWriteRangeGuard >= 0) && (strWrite.indexOf("WriteMemoryScalarToAddress(") > nWriteRangeGuard));
	g_Assert.doesNotMatch(strWrite, /\*reinterpret_cast<|\*ppAddressSlot/);

	for (const strLimit of g_vecIntegerWriteLimits) {
		g_Assert(strWrite.includes(strLimit));
	}

	for (const Writer of g_vecCheckedIntegerWrites) {
		const nRead = strWrite.indexOf("if (!" + Writer.Read + ")");
		const nWrite = strWrite.indexOf("WriteMemoryScalarToAddress(unWriteSlotAddress, " + Writer.Value + ");", nRead);
		g_Assert((nRead > nWriteRangeGuard) && (nWrite > nRead), "Validate the source integer before narrowing or writing its native representation.");
		g_Assert(!strWrite.includes(Writer.Legacy), "Never restore modulo conversion in a bounded integer writer.");
	}

	const strProtection = GetDefinition(strSource, "SetMemoryHelpersProtectionCallback");
	g_Assert(strProtection.includes("if (!IsMemoryAddressRangeRepresentable(unAddress, unByteSize))"));
	g_Assert(strProtection.includes("unPageAddress = unAddress - (unAddress % unMemoryPageSize);"));
	g_Assert(strProtection.includes("Set(kProtectionChangeFailed);\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, MemoryOperationFailure, nullptr);"), "A failed page-size query returns false without manufacturing a JavaScript exception.");

	for (const strName of ["GetMemoryHelpersVirtualTableCallback", "GetMemoryHelpersVirtualFunctionCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("if (!ReadMemoryScalarFromAddress(unObjectAddress, ppVirtualTable))"), "Read the entire possibly unaligned virtual-table address slot.");
		g_Assert.doesNotMatch(strDefinition, /\*reinterpret_cast<|ppVirtualTable\[/);
	}

	const strVirtualFunction = GetDefinition(strSource, "GetMemoryHelpersVirtualFunctionCallback");
	g_Assert(strVirtualFunction.includes("unVirtualFunctionSlotIndex > ((std::numeric_limits<std::uintptr_t>::max() - unVirtualTableAddress) / sizeof(void*))"));
	g_Assert(strVirtualFunction.includes("if (!ReadMemoryScalarFromAddress(unVirtualFunctionSlotAddress, pVirtualFunction))"), "Validate the last byte of the virtual-function slot, not just its start.");

	const nVirtualTableGuard = strVirtualFunction.indexOf("if (ppVirtualTable)");
	const nVirtualIndexRead = strVirtualFunction.indexOf("RequireMemoryInt32InRangeFromValue(");
	g_Assert((nVirtualTableGuard >= 0) && (nVirtualIndexRead > nVirtualTableGuard), "Preserve the null-vtable sentinel without converting an unused index.");
	g_Assert.doesNotMatch(strVirtualFunction, /GetInt32Argument\(/, "Never truncate or wrap a virtual-function index.");
	g_Assert(strVirtualFunction.includes("constexpr int kMinimumIndexValue = std::numeric_limits<int>::min();"));
	g_Assert(strVirtualFunction.includes("constexpr int kMaximumIndexValue = std::numeric_limits<int>::max();"));
	const nFirstTableRead = strVirtualFunction.indexOf("if (!ReadMemoryScalarFromAddress(unObjectAddress, ppVirtualTable))");
	const nTableRefresh = strVirtualFunction.indexOf("if (!ReadMemoryScalarFromAddress(unObjectAddress, ppVirtualTable))", nFirstTableRead + 1);
	const nTableSlotUse = strVirtualFunction.indexOf("const std::uintptr_t unVirtualTableAddress =");
	g_Assert((nFirstTableRead < nVirtualTableGuard) && (nTableRefresh > nVirtualIndexRead) && (nTableSlotUse > nTableRefresh), "Refresh the borrowed table after index coercion and before slot arithmetic.");
	g_Assert.equal([...strVirtualFunction.matchAll(/if \(!ReadMemoryScalarFromAddress\(unObjectAddress, ppVirtualTable\)\)/g)].length, 2);

	const strCall = GetDefinition(strSource, "CallFunctionCallback");
	g_Assert(strCall.includes("if (LocalCallResult.IsEmpty() || MemoryOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())"), "A non-empty null result must not hide a delegated V8 exception.");
	g_Assert.doesNotMatch(strCall, /LocalCallResult->IsNull/, "Preserve a valid null sentinel when there is no exception.");

	const strOptionalString = GetDefinition(strSource, "GetOptionalMemoryManagerStringArgument");
	g_Assert(strOptionalString.includes("if (!RequireMemoryManagerStringArgument("));
	g_Assert.equal([...strOptionalString.matchAll(/strStringValueOut = strDefaultStringValue;\n\t{4}return true;/g)].length, 2);

	const strRequiredString = GetDefinition(strSource, "RequireMemoryManagerStringArgument");
	g_Assert(strRequiredString.includes("std::string(pszEncodedStringValue, UTF8StringValue.length())"), "Preserve embedded NUL characters.");

	const nRequiredStringGuard = strRequiredString.indexOf("if (!bAllowEmptyString && strParsedStringValue.empty())");
	const nRequiredStringCommit = strRequiredString.indexOf("strStringValueOut = std::move(strParsedStringValue);");
	g_Assert((nRequiredStringGuard >= 0) && (nRequiredStringCommit > nRequiredStringGuard), "Validate the empty-string policy before output commit.");

	const strInventory = GetDefinition(strSource, "MakeMemoryStringArray");
	g_Assert(strInventory.includes("LocalStringArray->CreateDataProperty(LocalContext, unStringValueIndex, LocalStringValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strInventory, /->Set\(/);

	const strInstall = GetDefinition(strSource, "InstallMemoryHelpersFunctions");
	g_Assert(strInstall.includes("LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strInstall.includes("if (!v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction))"));
	g_Assert(strInstall.includes("return DefineValue(LocalMemoryHelpersObject, pszName, LocalFunction);"));
	g_Assert.doesNotMatch(strInstall, /SetValue\(|SetInteger\(|SetFunction\(/);
	g_Assert.equal([...strInstall.matchAll(/if \(!DefineFunction\(/g)].length, 15, "Every function export checks installation.");

	const strIntegerParser = GetDefinition(strSource, "ParseMemoryManagerInt32FromString");
	g_Assert(strIntegerParser.includes("pszParseEnd == pszIntegerText"));
	g_Assert(strIntegerParser.includes("pszParseEnd != (pszIntegerText + strIntegerText.size())"), "Reject trailing bytes, including embedded NUL.");
	g_Assert(strIntegerParser.includes("nParsedIntegerValue < std::numeric_limits<int>::min()"));
	g_Assert(strIntegerParser.includes("nParsedIntegerValue > std::numeric_limits<int>::max()"));
	g_Assert(strIntegerParser.includes("const int nParseError = errno;"));
	g_Assert(strIntegerParser.includes("nParseError == ERANGE"));

	const nIntegerParseRangeGuard = strIntegerParser.indexOf("nParseError == ERANGE");
	const nIntegerParseFailureReturn = strIntegerParser.indexOf("return false;", nIntegerParseRangeGuard);
	const nIntegerParseCommit = strIntegerParser.indexOf("nIntegerValueOut =");
	g_Assert((nIntegerParseRangeGuard >= 0) && (nIntegerParseFailureReturn > nIntegerParseRangeGuard) && (nIntegerParseCommit > nIntegerParseFailureReturn), "Reject failed integer parses before output commit.");

	g_Assert(GetDefinition(strSource, "BuildMemoryManagerCandidatePaths").includes("strRequestedFilePath.find(kNullCharacter) != std::string::npos"));

	const strINIValue = GetDefinition(strSource, "MakeMemoryManagerINIValue");
	g_Assert(strINIValue.includes("pszParseEnd != pszIntegerText"));
	g_Assert(strINIValue.includes("pszParseEnd == (pszIntegerText + strTrimmedValue.size())"));
	g_Assert(strINIValue.includes("nParseError != ERANGE"));
	g_Assert(strINIValue.includes("v8::BigInt::New(pIsolate, static_cast<std::int64_t>(nParsedIntegerValue))"));
	g_Assert(strINIValue.includes("LocalINIValue = MakeString(pIsolate, strSourceValue);"));
	g_Assert(strINIValue.includes("MemoryGameDataFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));

	const strINI = GetDefinition(strSource, "ParseMemoryManagerINI");
	g_Assert(strINI.includes("MakeString(pIsolate, strName);"), "Preserve the full key, including embedded NUL.");
	g_Assert.doesNotMatch(strINI, /strName\.c_str\(|->Set\(|SetValue\(/);
	g_Assert(strINI.includes("LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strINI.includes("if (!bSectionSet)"));
	g_Assert(strINI.includes("if (!bEntrySet)"));
	g_Assert(strINI.includes("if (!INIStream.eof() || INIStream.bad())"));

	const strLoad = GetDefinition(strSource, "LoadMemoryManagerGameDataFileValue");
	g_Assert(strLoad.includes("const bool bJSONParsed = v8::JSON::Parse(LocalContext, LocalJSONText).ToLocal(&LocalGameDataValue);"));
	g_Assert(strLoad.includes("if (!bJSONParsed || LocalGameDataValue.IsEmpty())"));
	g_Assert.doesNotMatch(strLoad, /JSONTryCatch|\.Reset\(/, "Never swallow the original JSON exception.");
	g_Assert(strLoad.includes("pResolvedPathOut->swap(PathResolved);"));

	const nResolvedPathFailureGuard = strLoad.indexOf("if (LocalGameDataValue.IsEmpty() || MemoryGameDataFailure.HasCaught()");
	const nResolvedPathCommit = strLoad.indexOf("pResolvedPathOut->swap");
	g_Assert((nResolvedPathFailureGuard >= 0) && (nResolvedPathCommit > nResolvedPathFailureGuard), "Validate loaded GameData before committing its path.");

	const strProperty = GetDefinition(strSource, "GetMemoryManagerProperty");
	g_Assert(strProperty.includes("MakeString(pIsolate, strPropertyName);"));
	g_Assert(strProperty.includes("if (LocalPropertyValue->IsUndefined()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, MemoryPropertyReadFailure, nullptr);\n\t\t\t\treturn false;"));
	g_Assert(strProperty.includes("MemoryPropertyReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));
	g_Assert(GetDefinition(strSource, "GetMemoryManagerValueByPath").includes("RethrowV8InstallationFailure(pIsolate, MemoryPathReadFailure, nullptr);"));

	const strSelection = GetDefinition(strSource, "GetMemoryManagerSelectedValue");
	const strSelectionFailureGuard = "if (MemorySelectionFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())";
	const nSelectedPropertyRead = strSelection.indexOf("const bool bPropertyRead =");
	const nSelectionFailureGuard = strSelection.indexOf(strSelectionFailureGuard);
	const nSelectionPropertyFallback = strSelection.indexOf("if (!bPropertyRead");
	g_Assert((nSelectedPropertyRead >= 0) && (nSelectionFailureGuard > nSelectedPropertyRead) && (nSelectionPropertyFallback > nSelectionFailureGuard), "Stop a failed getter before trying the next selection key.");
	g_Assert(strSelection.includes("char const* const arrSelectionKeys[]"));
	g_Assert(strSelection.includes('SOURCEJS_SDK_BRANCH,\n\t\t\t\tstrPlatformArchitectureKey.c_str(),\n\t\t\t\tSOURCEJS_TARGET_PLATFORM,\n\t\t\t\tSOURCEJS_TARGET_ARCH,\n\t\t\t\t"default",\n\t\t\t\t"any",'));

	const strSelect = GetDefinition(strSource, "SelectMemoryManagerValue");
	g_Assert(strSelect.includes("kMaximumSelectionDepth = 8;"));
	g_Assert(strSelect.includes(strSelectionFailureGuard));

	const nNextSelectionRead = strSelect.indexOf("if (!GetMemoryManagerSelectedValue(");
	const nNextSelectionFailureGuard = strSelect.indexOf(strSelectionFailureGuard, nNextSelectionRead);
	const nSelectionBreak = strSelect.indexOf("break;", nNextSelectionRead);
	g_Assert((nNextSelectionRead >= 0) && (nNextSelectionFailureGuard > nNextSelectionRead) && (nSelectionBreak > nNextSelectionFailureGuard), "Preserve selection failures before returning a missing-value sentinel.");

	const strSelectedString = GetDefinition(strSource, "GetMemoryManagerSelectedString");
	g_Assert(strSelectedString.includes(strSelectionFailureGuard));
	g_Assert(strSelectedString.indexOf(strSelectionFailureGuard) < strSelectedString.indexOf("if (LocalSelectedValue.IsEmpty()"));
	g_Assert(strSelectedString.includes("if (!pszEncodedSelectedString)"));
	g_Assert(strSelectedString.includes("std::string(pszEncodedSelectedString, UTF8SelectedString.length())"));

	const strSelectedInteger = GetDefinition(strSource, "GetMemoryManagerSelectedInteger");
	const strIntegerFailureGuard = "if (MemoryIntegerReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())";
	g_Assert(strSelectedInteger.includes("kMaximumIntegerResolutionDepth = 8;"));
	g_Assert.equal(strSelectedInteger.split(strIntegerFailureGuard).length - 1, 3);
	g_Assert(strSelectedInteger.indexOf(strIntegerFailureGuard) < strSelectedInteger.indexOf("return MemoryManagerIntegerResult::Missing;"));
	g_Assert.match(strSelectedInteger, /kOffsetPropertyName,[\s\S]*?continue;[\s\S]*?MemoryIntegerReadFailure\.HasCaught\(\)[\s\S]*?return MemoryManagerIntegerResult::Error;[\s\S]*?kValuePropertyName,/);
	g_Assert(strSelectedInteger.includes("if (!pszEncodedIntegerText)"));
	g_Assert(strSelectedInteger.includes("std::string(pszEncodedIntegerText, UTF8IntegerText.length())"));

	const nNumericRangeCheck = strSelectedInteger.indexOf("if (!std::isfinite(dblNumericValue)");
	const nIntegralCheck = strSelectedInteger.indexOf("if (std::floor(dblNumericValue) != dblNumericValue)");
	const nIntegerNarrowing = strSelectedInteger.indexOf("static_cast<int>(dblNumericValue)");
	g_Assert((nNumericRangeCheck >= 0) && (nIntegralCheck > nNumericRangeCheck) && (nIntegerNarrowing > nIntegralCheck), "Validate finite, in-range integral values before narrowing.");

	const strBinary = GetDefinition(strSource, "MakeMemoryManagerBinaryObject");
	g_Assert(strBinary.includes("LocalBinaryObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strBinary, /SetString\(|SetValue\(/);
	g_Assert.equal([...strBinary.matchAll(/if \(!DefineField\(/g)].length, 4);
	g_Assert(strBinary.includes('kSizePropertyName[] = "Size";'), "Preserve the native field consumed as public ByteCount by the JS facade.");
	g_Assert(strBinary.includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(BinaryInformation.m_unBaseAddress))"));

	const strScan = GetDefinition(strSource, "ScanMemoryManagerBinary");
	const nScanGuard = strScan.indexOf("if (!IsMemoryAddressRangeRepresentable(BinaryInformation.m_unBaseAddress, BinaryInformation.m_unByteSize))");
	g_Assert((nScanGuard >= 0) && (nScanGuard < strScan.indexOf("punBinaryBytes[")));
	g_Assert(strScan.includes("if (unPatternByteCount > BinaryInformation.m_unByteSize)"));
	g_Assert(strScan.includes("unLastCandidateOffset = BinaryInformation.m_unByteSize - unPatternByteCount;"));
	g_Assert(strScan.includes("unCandidateOffset <= unLastCandidateOffset"), "Include the final possible match without reading beyond the binary extent.");

	const strRecord = GetDefinition(strSource, "ResolveMemoryManagerAddressFromRecord");
	const strRecordFailureGuard = "if (MemoryRecordResolveFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())";
	g_Assert.equal(strRecord.split(strRecordFailureGuard).length - 1, 8);
	for (const strKey of ["Module", "library", "Address", "Symbol", "Signature", "Add"]) {
		g_Assert.match(strRecord, new RegExp('GetMemoryManagerProperty\\([^\\n]+, "' + strKey + '", [^\\n]+\\);\\n\\t+if \\(MemoryRecordResolveFailure\\.HasCaught\\(\\)'));
	}

	for (const strText of ["strFallbackModuleName", "strRecordModuleName", "strSymbolName", "strBytePattern"]) {
		g_Assert(strRecord.includes(strText + ".find(kNullCharacter) != std::string::npos"), "Never resolve a NUL-truncated native name.");
	}

	g_Assert(strRecord.includes("kMaximumRecordDepth = 8;"));
	g_Assert(strRecord.includes("-static_cast<std::int64_t>(nAddressOffset)"), "The INT32 minimum offset must not overflow when its magnitude is computed.");

	const strIdentifier = GetDefinition(strSource, "ResolveMemoryManagerIdentifier");
	g_Assert(strIdentifier.includes("if (LocalSelectedIdentifierValue->IsBigInt())"));
	g_Assert(strIdentifier.includes("if (!GetAddressSizedUnsignedIntegerFromValue(LocalSelectedIdentifierValue, unExplicitAddress))"));
	g_Assert(strIdentifier.includes("if (!LocalSelectedIdentifierValue->IsString())"));
	g_Assert(strIdentifier.includes("if (!pszEncodedIdentifierText)"));
	g_Assert(strIdentifier.includes("std::string(pszEncodedIdentifierText, UTF8IdentifierText.length())"));
	g_Assert(strIdentifier.includes("strIdentifierText.find(kNullCharacter) != std::string::npos"));
	g_Assert(strIdentifier.includes("strModuleName.find(kNullCharacter) != std::string::npos"));
	g_Assert.doesNotMatch(strIdentifier, /ValueToString\(/);
	g_Assert(GetDefinition(strSource, "GetMemoryManagerNamedData").includes("MemoryNamedDataReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));
	g_Assert(GetDefinition(strSource, "ResolveMemoryManagerSignatureAddress").includes('kSignaturesSectionName = "Signatures";'), "Use the project-owned Signatures section shared by the public package and documentation.");

	const strSelectedPropertyCopy = GetDefinition(strSource, "CopyMemoryManagerSelectedProperty");
	g_Assert(strSelectedPropertyCopy.includes("LocalDestinationObject->CreateDataProperty(LocalContext, LocalDestinationPropertyName, LocalSelectedPropertyValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strSelectedPropertyCopy, /SetValue\(/);
	g_Assert.match(strSelectedPropertyCopy, /if \(!GetObjectValue\([^\n]+\)\) \{\s*if \(MemoryPropertyCopyFailure\.HasCaught\(\)[\s\S]*?return false;[\s\S]*?return true;/, "A missing property is optional, but a failed getter is not.");
	g_Assert.match(strSelectedPropertyCopy, /if \(LocalPropertyValue->IsNull\(\)\) \{\s*return true;/);

	const strOptions = GetDefinition(strSource, "MakeMemoryManagerOptions");
	const strOptionsFailureGuard = "if (MemoryOptionsBuildFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())";
	g_Assert.equal(strOptions.split(strOptionsFailureGuard).length - 1, 5);
	g_Assert(strOptions.indexOf(strOptionsFailureGuard) < strOptions.indexOf("if (bNamedDataFound)"), "Never try another section after a real read error.");
	g_Assert(strOptions.includes("LocalOptionsObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strOptions, /SetValue\(|ValueToString\(/);
	g_Assert(strOptions.includes("if (!pszEncodedSignatureName)"));
	g_Assert(strOptions.includes("std::string(pszEncodedSignatureName, UTF8SignatureName.length())"));
	g_Assert(strOptions.includes("bHasSignatureAddress = true;"));
	g_Assert(strOptions.includes("bool bResolveRecordAddress = !bHasSignatureAddress;"), "A resolved signature name is not a raw byte pattern.");
	g_Assert.match(strOptions, /if \(bHasSignatureAddress\) \{\s*v8::Local<v8::Value> LocalExplicitAddressValue \{\};\s*bResolveRecordAddress = GetMemoryManagerProperty\([^\n]+kAddressPropertyName, LocalExplicitAddressValue\);/, "An explicit address retains precedence over a named signature.");
	g_Assert.match(strOptions, /if \(bResolveRecordAddress\) \{\s*std::uintptr_t unResolvedAddress = 0x0;\s*const bool bRecordResolved = ResolveMemoryManagerAddressFromRecord\(/);
	g_Assert.match(strOptions, /if \(!bRecordFound\) \{\s*return v8::Null\(pIsolate\);/);

	const strGameDataFiles = GetDefinition(strSource, "GetAllGameDataFilesCallback");
	g_Assert(strGameDataFiles.includes("LocalFileObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strGameDataFiles.includes("LocalGameDataFilesArray->CreateDataProperty(LocalContext, unWriteIndex, LocalGameDataFileObject).FromMaybe(false)"));
	g_Assert.doesNotMatch(strGameDataFiles, /SetString\(|->Set\(/);
	g_Assert(strGameDataFiles.includes("if (!bFileSet)"));
	g_Assert(strGameDataFiles.includes("if (unWriteIndex == kMaximumArrayIndex)"));
	g_Assert(strGameDataFiles.includes("std::filesystem::directory_options::skip_permission_denied"));

	const strGameDataLoad = GetDefinition(strSource, "LoadGameDataFileCallback");
	g_Assert(strGameDataLoad.includes("LocalGameDataObject->CreateDataProperty(LocalContext, LocalPathPropertyName, LocalPathPropertyValue).FromMaybe(false)"));
	g_Assert.doesNotMatch(strGameDataLoad, /SetString\(/);

	for (const Reader of [
		{ Name: "GetGameDataValueCallback", Frame: "MemoryGameDataValueFailure", Helper: "GetMemoryManagerValueByPath" },
		{ Name: "GetGameDataOffsetCallback", Frame: "MemoryGameDataOffsetFailure", Helper: "GetMemoryManagerNamedData" },
		{ Name: "GetGameDataSignatureCallback", Frame: "MemoryGameDataSignatureFailure", Helper: "GetMemoryManagerNamedData" },
	]) {
		const strDefinition = GetDefinition(strSource, Reader.Name);
		g_Assert.match(strDefinition, new RegExp("if \\(!" + Reader.Helper + "\\([^\\n]+\\)\\) \\{\\s*if \\(" + Reader.Frame + "\\.HasCaught\\(\\)"), Reader.Name + ": preserve real errors before the null sentinel.");
	}

	const strGameDataAddress = GetDefinition(strSource, "GetGameDataAddressCallback");
	const strAddressFailureGuard = "if (MemoryGameDataAddressFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())";
	const nSignatureRead = strGameDataAddress.indexOf("if (!ResolveMemoryManagerSignatureAddress(");
	const nSignatureFailureGuard = strGameDataAddress.indexOf(strAddressFailureGuard, nSignatureRead);
	g_Assert((nSignatureRead >= 0) && (nSignatureFailureGuard > nSignatureRead) && (nSignatureFailureGuard < strGameDataAddress.indexOf("MakeMemoryManagerOptions(")), "Do not try options after a real signature error.");

	const nAddressRead = strGameDataAddress.indexOf("if (!GetObjectValue(");
	const nAddressFailureGuard = strGameDataAddress.indexOf(strAddressFailureGuard, nAddressRead);
	g_Assert((nAddressRead >= 0) && (nAddressFailureGuard > nAddressRead) && (nAddressFailureGuard < strGameDataAddress.indexOf("Set(v8::Null(pIsolate))", nAddressRead)), "Do not turn an address getter error into null.");
	g_Assert(strGameDataAddress.includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress))"));

	const strSymbolCallback = GetDefinition(strSource, "GetBinarySymbolCallback");
	const nSymbolLookup = strSymbolCallback.indexOf("ResolveMemoryManagerSymbol(");
	for (const strName of ["strModuleName", "strSymbolName"]) {
		const nNullGuard = strSymbolCallback.indexOf(strName + ".find(kNullCharacter) != std::string::npos");
		g_Assert((nNullGuard >= 0) && (nNullGuard < nSymbolLookup), "Reject NUL-truncated native binary/symbol names before lookup.");
	}

	const strIdentifierCallback = GetDefinition(strSource, "ResolveBinaryIdentifierCallback");
	const nIdentifierRead = strIdentifierCallback.indexOf("if (!ResolveMemoryManagerIdentifier(");
	const nIdentifierFailureGuard = strIdentifierCallback.indexOf("if (MemoryBinaryIdentifierFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", nIdentifierRead);
	g_Assert((nIdentifierRead >= 0) && (nIdentifierFailureGuard > nIdentifierRead) && (nIdentifierFailureGuard < strIdentifierCallback.indexOf("Set(v8::Null(pIsolate))", nIdentifierRead)), "A failed identifier conversion must not turn into null.");

	for (const BinaryReturn of [
		{ Name: "ScanBinaryCallback", Address: "unMatchAddress" },
		{ Name: "GetBinarySymbolCallback", Address: "unSymbolAddress" },
		{ Name: "ResolveBinaryIdentifierCallback", Address: "unResolvedAddress" },
	]) {
		g_Assert(GetDefinition(strSource, BinaryReturn.Name).includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(" + BinaryReturn.Address + "))"));
	}

	const strBinariesCallback = GetDefinition(strSource, "GetAllBinariesCallback");
	g_Assert(strBinariesCallback.includes("unBinaryCount > static_cast<std::size_t>(kMaximumArrayLength)"));
	g_Assert(strBinariesCallback.includes("LocalBinariesArray->CreateDataProperty(LocalContext, unBinaryIndex, LocalBinaryObject).FromMaybe(false)"));
	g_Assert(strBinariesCallback.includes("if (!bBinarySet)"));
	g_Assert.doesNotMatch(strBinariesCallback, /->Set\(/);

	const strManagerInstall = GetDefinition(strSource, "InstallMemoryManagerExports");
	g_Assert(strManagerInstall.includes("LocalMemoryManagerObject->CreateDataProperty(LocalContext, LocalName, LocalValue).FromMaybe(false)"));
	g_Assert(strManagerInstall.includes("if (!v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction))"));
	g_Assert(strManagerInstall.includes("return DefineValue(pszName, LocalFunction);"));
	g_Assert.equal([...strManagerInstall.matchAll(/if \(!DefineValue\(/g)].length, 5);
	g_Assert.equal([...strManagerInstall.matchAll(/if \(!DefineFunction\(/g)].length, 15);
	g_Assert(strManagerInstall.includes('DefineFunction("GetPackagedGameDataRootPath", GetProjectGameDataRootPathCallback)'), "Preserve the established public forwarding export.");
	g_Assert.doesNotMatch(strManagerInstall, /SetString\(|SetFunction\(/);
}

function RejectMutation(strName, strOld, strNew) {
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert.equal(ReplaceDefinition(g_strSource, strName, strDefinition), g_strSource, "The contract view must round-trip exactly.");
	g_Assert(strDefinition.includes(strOld));

	const strChanged = strDefinition.replace(strOld, () => strNew);
	g_Assert.notEqual(strChanged, strDefinition);

	const strChangedSource = ReplaceDefinition(g_strSource, strName, strChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "The regression control must change actual source.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError, strName + ": reject mutation " + strOld);
}

CheckContracts(g_strSource);

let g_unRejectedMutationCount = 0;
for (const Boundary of g_vecBoundaries) {
	RejectMutation(Boundary.Name, "v8::TryCatch " + Boundary.Frame + "(pIsolate);", "");
	RejectMutation(Boundary.Name, "catch (std::exception const&)", "catch (int)");
	RejectMutation(Boundary.Name, "catch (...)", "catch (int)");
	RejectMutation(Boundary.Name, "v8::TryCatch " + Boundary.Frame + "(pIsolate);", "RethrowV8InstallationFailure(pIsolate, " + Boundary.Frame + ", nullptr);\n\t\tv8::TryCatch " + Boundary.Frame + "(pIsolate);");
	g_unRejectedMutationCount += 4;

	const strDefinition = GetDefinition(g_strSource, Boundary.Name);
	for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
		RejectMutation(Boundary.Name, vecDiagnostic[0], vecDiagnostic[0].replace(vecDiagnostic[2], ""));
		++g_unRejectedMutationCount;
	}
}

for (const strName of ["AllocateMemoryCallback", "ReallocateMemoryCallback"]) {
	RejectMutation(strName, "std::unique_ptr<void, void(*)(void*)> pAllocatedMemory(", "void* const pAllocatedMemory = ");
	RejectMutation(strName, "pAllocatedMemory.release();", "");
	RejectMutation(strName, "CallbackInformation.GetReturnValue().Set(LocalAddressValue);\n\t\t\tpAllocatedMemory.release();", "pAllocatedMemory.release();\n\t\t\tCallbackInformation.GetReturnValue().Set(LocalAddressValue);");
	g_unRejectedMutationCount += 3;
}

RejectMutation("RequireMemoryAddressArgument", "if (!RequireMemoryAddressFromValue(pIsolate, LocalAddressValue, pszArgumentErrorMessage, unAddressOut))", "if (false)");
RejectMutation("RequireMemoryUInt64FromValue", "if (LocalUInt64Value.IsEmpty() || !LocalUInt64Value->IsBigInt())", "if (false)");
RejectMutation("ApplyMemoryAddressOffset", "unOffsetMagnitude > static_cast<std::uint64_t>(unBaseAddress)", "false");
g_unRejectedMutationCount += 3;

for (const Transfer of [
	{ Name: "CompareMemoryHelpersCallback", Addresses: ["unLeftAddress", "unRightAddress"] },
	{ Name: "CopyMemoryHelpersCallback", Addresses: ["unSourceAddress", "unDestinationAddress"] },
	{ Name: "MoveMemoryHelpersCallback", Addresses: ["unSourceAddress", "unDestinationAddress"] },
]) {
	for (const strAddress of Transfer.Addresses) {
		RejectMutation(Transfer.Name, "!IsMemoryAddressRangeRepresentable(" + strAddress + ", unByteSize)", "false");
		++g_unRejectedMutationCount;
	}
}

RejectMutation("CopyMemoryHelpersCallback", "if (DoMemoryAddressRangesOverlap(unSourceAddress, unDestinationAddress, unByteSize))", "if (false)");
RejectMutation("SearchMemoryHelpersBytesCallback", "if (!IsMemoryAddressRangeRepresentable(unSearchAddress, unSearchByteSize))", "if (false)");
RejectMutation("RequireMemoryBytePatternFromValue", "if (!pszEncodedBytePattern)", "if (false)");
RejectMutation("RequireMemoryProtectionFromValue", "if (!pszEncodedProtectionName)", "if (false)");
g_unRejectedMutationCount += 4;

for (const strName of ["ReadMemoryHelpersCallback", "WriteMemoryHelpersCallback"]) {
	RejectMutation(strName, "if (!pszEncodedDataTypeName)", "if (false)");
	++g_unRejectedMutationCount;
}

for (const Mutation of [
	{ Name: "ReadMemoryScalarFromAddress", Old: "if (!IsMemoryAddressRangeRepresentable(unAddress, sizeof(TValue)))", New: "if (false)" },
	{ Name: "ReadMemoryScalarFromAddress", Old: "ReadValueOut = ReadValue;", New: "ReadValueOut = TValue {};" },
	{ Name: "WriteMemoryScalarToAddress", Old: "std::memcpy(reinterpret_cast<void*>(unAddress), &WriteValue, sizeof(TValue));", New: "std::memcpy(reinterpret_cast<void*>(unAddress), &WriteValue, sizeof(TValue) - 1);" },
	{ Name: "WriteMemoryHelpersCallback", Old: "if (!IsMemoryAddressRangeRepresentable(unWriteSlotAddress, unWriteByteSize))", New: "if (false)" },
	{ Name: "SetMemoryHelpersProtectionCallback", Old: "if (!IsMemoryAddressRangeRepresentable(unAddress, unByteSize))", New: "if (false)" },
	{ Name: "SetMemoryHelpersProtectionCallback", Old: "unPageAddress = unAddress - (unAddress % unMemoryPageSize);", New: "unPageAddress = unAddress;" },
	{ Name: "SetMemoryHelpersProtectionCallback", Old: "Set(kProtectionChangeFailed);\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, MemoryOperationFailure, nullptr);", New: "Set(kProtectionChangeFailed);\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, MemoryOperationFailure, kMemoryCallbackErrorMessage);" },
	{ Name: "GetMemoryHelpersVirtualTableCallback", Old: "if (!ReadMemoryScalarFromAddress(unObjectAddress, ppVirtualTable))", New: "if (false)" },
	{ Name: "GetMemoryHelpersVirtualFunctionCallback", Old: "if (!ReadMemoryScalarFromAddress(unObjectAddress, ppVirtualTable))", New: "if (false)" },
	{ Name: "GetMemoryHelpersVirtualFunctionCallback", Old: "if (!ReadMemoryScalarFromAddress(unVirtualFunctionSlotAddress, pVirtualFunction))", New: "if (false)" },
	{ Name: "GetMemoryHelpersVirtualFunctionCallback", Old: "unVirtualFunctionSlotIndex > ((std::numeric_limits<std::uintptr_t>::max() - unVirtualTableAddress) / sizeof(void*))", New: "false" },
	{ Name: "CallFunctionCallback", Old: " || MemoryOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()", New: "" },
	{ Name: "RequireMemoryManagerStringArgument", Old: "if (!pszEncodedStringValue)", New: "if (false)" },
	{ Name: "RequireMemoryManagerStringArgument", Old: "std::string(pszEncodedStringValue, UTF8StringValue.length())", New: "std::string(pszEncodedStringValue)" },
	{ Name: "GetOptionalMemoryManagerStringArgument", Old: "if (!RequireMemoryManagerStringArgument(", New: "if (RequireMemoryManagerStringArgument(" },
	{ Name: "MakeMemoryStringArray", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "InstallMemoryHelpersFunctions", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "pszParseEnd == pszIntegerText", New: "false" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "pszParseEnd != (pszIntegerText + strIntegerText.size())", New: "false" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "nParseError == ERANGE", New: "false" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "nParsedIntegerValue < std::numeric_limits<int>::min()", New: "false" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "nParsedIntegerValue > std::numeric_limits<int>::max()", New: "false" },
	{ Name: "BuildMemoryManagerCandidatePaths", Old: "strRequestedFilePath.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "MakeMemoryManagerINIValue", Old: "pszParseEnd != pszIntegerText", New: "false" },
	{ Name: "MakeMemoryManagerINIValue", Old: "pszParseEnd == (pszIntegerText + strTrimmedValue.size())", New: "true" },
	{ Name: "MakeMemoryManagerINIValue", Old: "nParseError != ERANGE", New: "true" },
	{ Name: "MakeMemoryManagerINIValue", Old: "v8::BigInt::New(pIsolate, static_cast<std::int64_t>(nParsedIntegerValue))", New: "v8::Number::New(pIsolate, static_cast<double>(nParsedIntegerValue))" },
	{ Name: "ParseMemoryManagerINI", Old: "MakeString(pIsolate, strName)", New: "MakeString(pIsolate, strName.c_str())" },
	{ Name: "ParseMemoryManagerINI", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "ParseMemoryManagerINI", Old: "if (!bSectionSet)", New: "if (false)" },
	{ Name: "ParseMemoryManagerINI", Old: "if (!bEntrySet)", New: "if (false)" },
	{ Name: "ParseMemoryManagerINI", Old: "if (!INIStream.eof() || INIStream.bad())", New: "if (false)" },
	{ Name: "LoadMemoryManagerGameDataFileValue", Old: "if (!bJSONParsed || LocalGameDataValue.IsEmpty())", New: "if (false)" },
	{ Name: "LoadMemoryManagerGameDataFileValue", Old: "pResolvedPathOut->swap(PathResolved);", New: "*pResolvedPathOut = {};" },
	{ Name: "GetMemoryManagerProperty", Old: "MakeString(pIsolate, strPropertyName)", New: "MakeString(pIsolate, strPropertyName.c_str())" },
	{ Name: "GetMemoryManagerProperty", Old: "RethrowV8InstallationFailure(pIsolate, MemoryPropertyReadFailure, nullptr);", New: "RethrowV8InstallationFailure(pIsolate, MemoryPropertyReadFailure, kPropertyReadErrorMessage);" },
	{ Name: "GetMemoryManagerValueByPath", Old: "RethrowV8InstallationFailure(pIsolate, MemoryPathReadFailure, nullptr);", New: "RethrowV8InstallationFailure(pIsolate, MemoryPathReadFailure, kPathReadErrorMessage);" },
	{ Name: "GetMemoryManagerSelectedValue", Old: "if (MemorySelectionFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "SelectMemoryManagerValue", Old: "if (MemorySelectionFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedString", Old: "if (MemorySelectionFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedString", Old: "if (!pszEncodedSelectedString)", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedString", Old: "std::string(pszEncodedSelectedString, UTF8SelectedString.length())", New: "std::string(pszEncodedSelectedString)" },
	{ Name: "GetMemoryManagerSelectedInteger", Old: "if (MemoryIntegerReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedInteger", Old: "std::floor(dblNumericValue) != dblNumericValue", New: "false" },
	{ Name: "GetMemoryManagerSelectedInteger", Old: "if (!pszEncodedIntegerText)", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedInteger", Old: "std::string(pszEncodedIntegerText, UTF8IntegerText.length())", New: "std::string(pszEncodedIntegerText)" },
	{ Name: "MakeMemoryManagerBinaryObject", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeMemoryManagerBinaryObject", Old: "if (!DefineField(kNamePropertyName,", New: "if (DefineField(kNamePropertyName," },
	{ Name: "MakeMemoryManagerBinaryObject", Old: "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(BinaryInformation.m_unBaseAddress))", New: "v8::Number::New(pIsolate, static_cast<double>(BinaryInformation.m_unBaseAddress))" },
	{ Name: "ScanMemoryManagerBinary", Old: "if (!IsMemoryAddressRangeRepresentable(BinaryInformation.m_unBaseAddress, BinaryInformation.m_unByteSize))", New: "if (false)" },
	{ Name: "ScanMemoryManagerBinary", Old: "if (unPatternByteCount > BinaryInformation.m_unByteSize)", New: "if (false)" },
	{ Name: "ScanMemoryManagerBinary", Old: "unCandidateOffset <= unLastCandidateOffset", New: "unCandidateOffset < unLastCandidateOffset" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Old: "if (MemoryRecordResolveFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Old: "strFallbackModuleName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Old: "strRecordModuleName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Old: "strSymbolName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveMemoryManagerAddressFromRecord", Old: "strBytePattern.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveMemoryManagerSignatureAddress", Old: 'kSignaturesSectionName = "Signatures";', New: 'kSignaturesSectionName = "signatures";' },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "if (LocalSelectedIdentifierValue->IsBigInt())", New: "if (false)" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "if (!GetAddressSizedUnsignedIntegerFromValue(LocalSelectedIdentifierValue, unExplicitAddress))", New: "if (false)" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "if (!LocalSelectedIdentifierValue->IsString())", New: "if (false)" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "if (!pszEncodedIdentifierText)", New: "if (false)" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "std::string(pszEncodedIdentifierText, UTF8IdentifierText.length())", New: "std::string(pszEncodedIdentifierText)" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "strIdentifierText.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveMemoryManagerIdentifier", Old: "strModuleName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "CopyMemoryManagerSelectedProperty", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "CopyMemoryManagerSelectedProperty", Old: "if (MemoryPropertyCopyFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "MakeMemoryManagerOptions", Old: "if (MemoryOptionsBuildFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "MakeMemoryManagerOptions", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "MakeMemoryManagerOptions", Old: "if (!pszEncodedSignatureName)", New: "if (false)" },
	{ Name: "MakeMemoryManagerOptions", Old: "std::string(pszEncodedSignatureName, UTF8SignatureName.length())", New: "std::string(pszEncodedSignatureName)" },
	{ Name: "MakeMemoryManagerOptions", Old: "bHasSignatureAddress = true;", New: "bHasSignatureAddress = false;" },
	{ Name: "MakeMemoryManagerOptions", Old: "bool bResolveRecordAddress = !bHasSignatureAddress;", New: "bool bResolveRecordAddress = true;" },
	{ Name: "MakeMemoryManagerOptions", Old: "bResolveRecordAddress = GetMemoryManagerProperty(pIsolate, LocalContext, LocalRecordValue, kAddressPropertyName, LocalExplicitAddressValue);", New: "bResolveRecordAddress = false;" },
	{ Name: "MakeMemoryManagerOptions", Old: "if (bResolveRecordAddress)", New: "if (true)" },
	{ Name: "GetAllGameDataFilesCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetAllGameDataFilesCallback", Old: "LocalGameDataFilesArray->CreateDataProperty(", New: "LocalGameDataFilesArray->Set(" },
	{ Name: "GetAllGameDataFilesCallback", Old: "if (!bFileSet)", New: "if (false)" },
	{ Name: "LoadGameDataFileCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetGameDataValueCallback", Old: "if (MemoryGameDataValueFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetGameDataOffsetCallback", Old: "if (MemoryGameDataOffsetFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetGameDataSignatureCallback", Old: "if (MemoryGameDataSignatureFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetGameDataAddressCallback", Old: "if (MemoryGameDataAddressFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetBinarySymbolCallback", Old: "strModuleName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "GetBinarySymbolCallback", Old: "strSymbolName.find(kNullCharacter) != std::string::npos", New: "false" },
	{ Name: "ResolveBinaryIdentifierCallback", Old: "if (MemoryBinaryIdentifierFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "ScanBinaryCallback", Old: "v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unMatchAddress))", New: "v8::Number::New(pIsolate, static_cast<double>(unMatchAddress))" },
	{ Name: "GetAllBinariesCallback", Old: "unBinaryCount > static_cast<std::size_t>(kMaximumArrayLength)", New: "false" },
	{ Name: "GetAllBinariesCallback", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "GetAllBinariesCallback", Old: "if (!bBinarySet)", New: "if (false)" },
	{ Name: "InstallMemoryManagerExports", Old: "->CreateDataProperty(", New: "->Set(" },
	{ Name: "InstallMemoryManagerExports", Old: "if (!v8::Function::New(", New: "if (v8::Function::New(" },
	{ Name: "InstallMemoryManagerExports", Old: 'DefineFunction("GetPackagedGameDataRootPath", GetProjectGameDataRootPathCallback)', New: 'DefineFunction("MissingPublicExport", GetProjectGameDataRootPathCallback)' },
	// Required source-marker regressions; these controls do not execute native code.
	{ Name: "GetMemoryHelpersVirtualFunctionCallback", Old: "if (ppVirtualTable)", New: "if (true)" },
	{ Name: "RequireMemoryManagerStringArgument", Old: "if (!bAllowEmptyString && strParsedStringValue.empty())", New: "if (false)" },
	{ Name: "ParseMemoryManagerInt32FromString", Old: "return false;\n\t\t}\n\n\t\tnIntegerValueOut =", New: "return true;\n\t\t}\n\n\t\tnIntegerValueOut =" },
	{ Name: "LoadMemoryManagerGameDataFileValue", Old: "if (LocalGameDataValue.IsEmpty() || MemoryGameDataFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", New: "if (false)" },
	{ Name: "GetMemoryManagerSelectedValue", Old: "const bool bPropertyRead =", New: "const auto bPropertyRead =" },
	{ Name: "SelectMemoryManagerValue", Old: "if (!GetMemoryManagerSelectedValue(", New: "if (false && !GetMemoryManagerSelectedValue(" },
	{ Name: "GetGameDataAddressCallback", Old: "if (!ResolveMemoryManagerSignatureAddress(", New: "if (false && !ResolveMemoryManagerSignatureAddress(" },
	{ Name: "GetGameDataAddressCallback", Old: "if (!GetObjectValue(", New: "if (false && !GetObjectValue(" },
	{ Name: "ResolveBinaryIdentifierCallback", Old: "if (!ResolveMemoryManagerIdentifier(", New: "if (false && !ResolveMemoryManagerIdentifier(" },
]) {
	RejectMutation(Mutation.Name, Mutation.Old, Mutation.New);
	++g_unRejectedMutationCount;
}

for (const Reader of g_vecBoundedIntegerReaders) {
	RejectMutation(Reader.Name, Reader.Guard, "if (false)");
	RejectMutation(Reader.Name, "(std::floor(dblInteger) != dblInteger)", "false");
	RejectMutation(Reader.Name, Reader.Output, Reader.Output.replace(/= .+;/, "= 0;"));
	RejectMutation(Reader.Name, "if (!GetNumberArgument(", "if (false && !GetNumberArgument(");
	RejectMutation(Reader.Name, "static_assert(std::numeric_limits<" + Reader.Type + ">::digits <= std::numeric_limits<double>::digits);", "");
	g_unRejectedMutationCount += 5;
}

RejectMutation("GetOptionalMemoryOffsetArgument", "kDefaultOffset = 0x0;", "kDefaultOffset = 0;");
++g_unRejectedMutationCount;

for (const Writer of g_vecCheckedIntegerWrites) {
	RejectMutation("WriteMemoryHelpersCallback", Writer.Read, Writer.Legacy);
	RejectMutation("WriteMemoryHelpersCallback", "if (!" + Writer.Read + ")", "if (false && !" + Writer.Read + ")");
	g_unRejectedMutationCount += 2;
}

for (const strLimit of g_vecIntegerWriteLimits) {
	RejectMutation("WriteMemoryHelpersCallback", strLimit, strLimit.replace(/= .+;/, "= 0;"));
	++g_unRejectedMutationCount;
}

RejectMutation("GetMemoryHelpersVirtualFunctionCallback", "RequireMemoryInt32InRangeFromValue(", "GetInt32Argument(");
++g_unRejectedMutationCount;
for (const strLimit of ["constexpr int kMinimumIndexValue = std::numeric_limits<int>::min();", "constexpr int kMaximumIndexValue = std::numeric_limits<int>::max();"]) {
	RejectMutation("GetMemoryHelpersVirtualFunctionCallback", strLimit, strLimit.replace(/= .+;/, "= 0;"));
	++g_unRejectedMutationCount;
}

console.log("Memory native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/native allocation execution not exercised.");
