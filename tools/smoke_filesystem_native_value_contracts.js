"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

// Structural regressions complement native execution; they do not prove SDK IO or handle lifetime.
const g_strUsage = "Usage: node tools/smoke_filesystem_native_value_contracts.js [--help]";
const g_vecCallbackNames = [
	"DoesFileExist",
	"ReadTextFile",
	"WriteTextFile",
	"EnsureDirectoryExists",
	"GetSeekTypes",
	"IsVPKFile",
	"OpenSourceFile",
	"CloseSourceFile",
	"ReadSourceFile",
	"ReadSourceFileLine",
	"WriteSourceFile",
	"TruncateSourceFile",
	"SeekSourceFile",
	"GetSourceFileOffset",
	"GetSourceFileSize",
	"FlushSourceFile",
	"IsSourceFileAtEnd",
	"IsSourceFileTTY",
	"IsSourceFileSeekable",
	"GetSourceFileDescriptor",
	"SaveSourceFile",
	"GetTemporaryFilePath",
	"RemoveFile",
];

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strModuleBindingsPath = g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp");
const g_strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8").replace(/\r\n/g, "\n");
let g_unRejectedMutationCount = 0;

function GetFunction(strSource, strFunctionName) {
	const DefinitionPattern = new RegExp("\\n(\\t+)[^\\n]*\\b" + strFunctionName + "\\([^\\n]*\\) [^{\\n]*\\{");
	const vecMatch = DefinitionPattern.exec(strSource);
	g_Assert.ok(vecMatch, `Missing function: ${strFunctionName}`);

	const unStartIndex = vecMatch.index + 1;
	const strClosingLine = "\n" + vecMatch[1] + "}\n";
	const nEndIndex = strSource.indexOf(strClosingLine, vecMatch.index + vecMatch[0].length);
	g_Assert.ok(nEndIndex >= unStartIndex, `Missing function boundary: ${strFunctionName}`);

	return strSource.slice(unStartIndex, nEndIndex + strClosingLine.length);
}

function VerifyFunctionExtraction() {
	const strEmptyFunction = "\tvoid Empty() {\n\t}\n";
	const strFollowingFunction = "\tvoid Following() {\n\t\treturn;\n\t}\n";
	const strSource = "\n" + strEmptyFunction + strFollowingFunction;
	g_Assert.equal(GetFunction(strSource, "Empty"), strEmptyFunction, "Empty function must not capture the following definition.");
	g_Assert.equal(GetFunction(strSource, "Following"), strFollowingFunction, "Following function must retain its complete body and boundary.");
}

function VerifyContracts(strSource) {
	let unCheckCount = 0;
	const Check = (bCondition, strMessage) => {
		g_Assert.ok(bCondition, strMessage);
		unCheckCount += 1;
	};

	for (const strName of g_vecCallbackNames) {
		const strBody = GetFunction(strSource, `${strName}Callback`);
		const strIndentation = strBody.match(/^\t+/)[0];
		Check(strBody.includes(strIndentation + "\ttry {"), `${strName}: exception boundary`);
		Check(strBody.includes("} catch (...) {\n" + strIndentation + "\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);"), `${strName}: translate all native exceptions`);
		Check(strBody.includes(`"filesystem.${strName}() failed with a native C++ exception."`), `${strName}: operation diagnostic`);
	}

	for (const strName of g_vecCallbackNames.slice(0, 4)) {
		const strBody = GetFunction(strSource, `${strName}Callback`);
		const strIndentation = strBody.match(/^\t+/)[0];
		const strLocalName = (strName === "EnsureDirectoryExists") ? "LocalDirectoryPathString" : "LocalFilePathString";
		const strUTF8Name = (strName === "EnsureDirectoryExists") ? "UTF8DirectoryPath" : "UTF8FilePath";
		const strPathName = (strName === "EnsureDirectoryExists") ? "strDirectoryPath" : "strFilePath";
		Check(strBody.includes(`->ToString(LocalContext).ToLocal(&${strLocalName})) {\n${strIndentation}\t\t\treturn;`), `${strName}: preserve path coercion exception`);
		Check(strBody.includes(`${strUTF8Name} = v8::String::Utf8Value(pIsolate, ${strLocalName});`), `${strName}: encode converted string only`);
		Check(strBody.includes(`std::string const ${strPathName} = std::string(*${strUTF8Name}, static_cast<std::size_t>(${strUTF8Name}.length()));`), `${strName}: complete path byte length`);
		Check(strBody.includes(`= std::u8string(${strPathName}.begin(), ${strPathName}.end());`), `${strName}: decode physical paths as UTF-8 independently of the Windows code page`);
		Check(strBody.includes(`if (${strPathName}.find('\\0') != std::string::npos) {`), `${strName}: reject embedded NUL`);
		Check(strBody.indexOf(`${strPathName}.find('\\0')`) < strBody.indexOf("std::filesystem::path const"), `${strName}: reject NUL before physical IO`);
	}

	const strWriteBody = GetFunction(strSource, "WriteTextFileCallback");
	const strWriteIndentation = strWriteBody.match(/^\t+/)[0];
	Check(strWriteBody.includes("->ToString(LocalContext).ToLocal(&LocalTextString)) {\n" + strWriteIndentation + "\t\t\treturn;"), "WriteTextFile: preserve text coercion exception");
	Check(strWriteBody.indexOf("&LocalFilePathString") < strWriteBody.indexOf("&LocalTextString"), "WriteTextFile: path before text");
	Check(strWriteBody.indexOf("strFilePath.find('\\0')") < strWriteBody.indexOf("&LocalTextString"), "WriteTextFile: reject NUL before text coercion");
	Check(strWriteBody.includes("std::string(*UTF8Text, static_cast<std::size_t>(UTF8Text.length()))"), "WriteTextFile: complete UTF-8 bytes including NUL");

	const strStringBody = GetFunction(strSource, "RequireFilesystemStringArgument");
	Check(strStringBody.includes("std::string(*UTF8ArgumentValue, static_cast<std::size_t>(UTF8ArgumentValue.length()))"), "Native filesystem strings: complete UTF-8 bytes");
	Check(strStringBody.includes("if (strArgumentValue.find('\\0') != std::string::npos) {"), "Native filesystem strings: reject NUL");
	Check(strStringBody.indexOf("strArgumentValue.find('\\0')") < strStringBody.indexOf("strValueOut = strArgumentValue;"), "Native filesystem strings: commit only validated value");
	Check(strSource.includes("FilesystemFileCloser::FilesystemFileCloser(IFileSystem& FileSystem) noexcept :\n\t\t\tm_FileSystem(FileSystem)"), "Shared closer: initialize borrowed filesystem reference");

	const strSeekBody = GetFunction(strSource, "GetSeekTypesCallback");
	for (const strName of ["Head", "Current", "Tail"]) {
		Check(strSeekBody.includes(`SetRecordProperty(pIsolate, LocalContext, LocalSeekTypesObject, k${strName}PropertyName, v8::Integer::New(`), `SeekTypes: own ${strName} field`);
	}

	const strBytesBody = GetFunction(strSource, "GetFilesystemBytesFromValue");
	const strBytesIndentation = strBytesBody.match(/^\t+/)[0];
	Check(strBytesBody.includes("->ToString(LocalContext).ToLocal(&LocalTextString)) {\n" + strBytesIndentation + "\t\treturn false;"), "Bytes: preserve string coercion exception");
	Check(strBytesBody.includes("UTF8Text = v8::String::Utf8Value(pIsolate, LocalTextString);"), "Bytes: encode converted string only");
	Check(strBytesBody.includes("std::string(*UTF8Text, static_cast<std::size_t>(UTF8Text.length()))"), "Bytes: complete UTF-8 bytes including NUL");

	const nArrayBufferViewBranchPosition = strBytesBody.indexOf("->IsArrayBufferView()");
	const nArrayBufferBranchPosition = strBytesBody.indexOf("->IsArrayBuffer()");
	const nStringCoercionPosition = strBytesBody.indexOf("->ToString(");
	Check((nArrayBufferViewBranchPosition >= 0) && (nArrayBufferViewBranchPosition < nArrayBufferBranchPosition) && (nArrayBufferBranchPosition < nStringCoercionPosition), "Bytes: binary branches before string coercion");
	Check(strBytesBody.includes("LocalArrayBufferView->CopyContents(vecBytes.data(), unByteLength)"), "Bytes: preserve view offset and length");
	Check(strBytesBody.includes("if (unCopiedByteCount != unByteLength) {\n" + strBytesIndentation + "\t\t\treturn false;\n" + strBytesIndentation + "\t\t}\n\n" + strBytesIndentation + "\t\tvecBytesOut = std::move(vecBytes);"), "Bytes: commit only after complete view copy");
	Check(strBytesBody.includes("std::memcpy(vecBytes.data(), pSourceBytes, unByteLength);"), "Bytes: copy backing store without modifying input");

	const strHandleBody = GetFunction(strSource, "GetFilesystemFileHandleFromValue");
	Check(strHandleBody.includes("GetAddressSizedUnsignedIntegerFromValue(LocalFileHandleValue, unFileHandleAddress) || (unFileHandleAddress == 0)"), "Handle: width-checked nonzero BigInt address");
	Check(GetFunction(strSource, "ConvertFilesystemFileHandleToBigInt").includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unFileHandleAddress))"), "Handle: BigInt result");

	const strIntegerBody = GetFunction(strSource, "GetOptionalFilesystemIntegerArgument");
	Check(strIntegerBody.includes("IsValueNullish(LocalArgumentValue)") && strIntegerBody.includes("!LocalArgumentValue->IsInt32()"), "Optional integer: nullish default and strict Int32");
	Check(GetFunction(strSource, "GetOptionalFilesystemBooleanArgument").includes("return LocalArgumentValue->BooleanValue(pIsolate);"), "Optional boolean: retain truthiness");

	const strOpenBody = GetFunction(strSource, "OpenSourceFileCallback");
	const strOpenIndentation = strOpenBody.match(/^\t+/)[0];
	Check(strOpenBody.includes("std::unique_ptr<void, FilesystemFileCloser> FileOwner = std::unique_ptr<void, FilesystemFileCloser>(hFile, FilesystemFileCloser { *pFileSystem });"), "Open: attach handle to rollback owner");
	Check(strSource.includes("void operator()(FileHandle_t const hFile) const noexcept") && /m_FileSystem\.Close\(hFile\);\n\t+} catch \(\.\.\.\)/.test(strSource), "Shared closer: non-throwing rollback");
	for (const strName of ["Handle", "Mode", "Path", "PathID"]) {
		Check(strOpenBody.includes(`SetRecordProperty(pIsolate, LocalContext, LocalSourceFileObject, k${strName}PropertyName, `), `Open: own ${strName} field`);
	}

	const nOpenOwnerPosition = strOpenBody.indexOf("FileOwner = std::unique_ptr<void, FilesystemFileCloser>(hFile,");
	const nOpenHandleConversionPosition = strOpenBody.indexOf("ConvertFilesystemFileHandleToBigInt(");
	const nOpenRecordCreationPosition = strOpenBody.indexOf("v8::Object::New(pIsolate)");
	Check((nOpenOwnerPosition >= 0) && (nOpenOwnerPosition < nOpenHandleConversionPosition) && (nOpenOwnerPosition < nOpenRecordCreationPosition), "Open: owner before fallible result creation");
	Check(strOpenBody.includes("CallbackInformation.GetReturnValue().Set(LocalSourceFileObject);\n" + strOpenIndentation + "\t\tFileOwner.release();"), "Open: transfer ownership only after output commit");

	const strTruncateBody = GetFunction(strSource, "TruncateSourceFileCallback");
	const strTruncateIndentation = strTruncateBody.match(/^\t+/)[0];
	Check(strTruncateBody.includes("constexpr int kOwnershipStateArgumentIndex = 5;"), "Truncate: internal ownership argument");
	Check(strTruncateBody.includes("->IsProxy()") && strTruncateBody.includes("->IsArray()"), "Truncate: reject proxy/array state carriers");
	Check(strTruncateBody.includes("LocalOwnershipState, kConsumedPropertyName, v8::False(pIsolate)"), "Truncate: initially retain caller ownership");
	Check(strTruncateBody.includes("LocalOwnershipState, kConsumedPropertyName, v8::True(pIsolate)"), "Truncate: explicit close-attempt handoff");
	Check(strTruncateBody.indexOf("LocalOwnershipState, kConsumedPropertyName, v8::True(pIsolate)") < strTruncateBody.indexOf("pFileSystem->Close(hFile);"), "Truncate: handoff before original close");
	for (const strName of ["Read", "Write", "New"]) {
		Check(strTruncateBody.includes(`std::unique_ptr<void, FilesystemFileCloser> ${strName}FileOwner = std::unique_ptr<void, FilesystemFileCloser>(h${strName}File, FilesystemFileCloser { *pFileSystem });`), `Truncate: protect ${strName} handle`);
	}

	Check(strTruncateBody.includes("if (hReadFile != FILESYSTEM_INVALID_HANDLE) {\n" + strTruncateIndentation + "\t\t\tstd::unique_ptr"), "Truncate: own only valid read handles");

	for (const strName of ["Read", "Write"]) {
		Check(strTruncateBody.includes(`pFileSystem->Close(${strName}FileOwner.release());`), `Truncate: explicit ${strName} close without retry`);
	}

	for (const strName of ["Handle", "Size", "BytesWritten"]) {
		Check(strTruncateBody.includes(`SetRecordProperty(pIsolate, LocalContext, LocalTruncationResultObject, k${strName}PropertyName, `), `Truncate: own ${strName} field`);
	}

	Check(strTruncateBody.includes("CallbackInformation.GetReturnValue().Set(LocalTruncationResultObject);\n" + strTruncateIndentation + "\t\tNewFileOwner.release();"), "Truncate: transfer replacement handle after output commit");
	Check(strTruncateBody.indexOf("pFileSystem->Close(hFile);") < strTruncateBody.indexOf("FileHandle_t const hWriteFile"), "Truncate: preserve original-handle close phase");
	Check(strTruncateBody.includes("std::vector<char>(static_cast<std::size_t>(nTargetSize), kZeroByte)"), "Truncate: retain zero-filled extension bytes");

	const strSaveBody = GetFunction(strSource, "SaveSourceFileCallback");
	Check(strSaveBody.includes("std::unique_ptr<void, FilesystemFileCloser> DestinationFileOwner = std::unique_ptr<void, FilesystemFileCloser>(hDestinationFile, FilesystemFileCloser { *pFileSystem });"), "Save: protect destination handle");
	const nSaveOwnerPosition = strSaveBody.indexOf("DestinationFileOwner = std::unique_ptr<void, FilesystemFileCloser>(hDestinationFile,");
	Check((nSaveOwnerPosition >= 0) && (nSaveOwnerPosition < strSaveBody.indexOf("pFileSystem->Write(")), "Save: owner before destination write");
	Check(strSaveBody.includes("pFileSystem->Close(DestinationFileOwner.release());"), "Save: explicit close without retry");
	Check(!/std::unique_ptr<void, FilesystemFileCloser>(?:\s+\w+)?(?:\s*=\s*std::unique_ptr<void, FilesystemFileCloser>)?\s*[({]\s*hFile\s*,/.test(strSaveBody), "Save: source remains borrowed");
	Check(strSaveBody.includes("if ((nBytesRead < kEmptyFileSize) || (nBytesRead > nFileSize))"), "Save: retain bounded short-read contract");

	const strTemporaryBody = GetFunction(strSource, "GetTemporaryFilePathCallback");
	Check(strTemporaryBody.includes("FileNameStream << strFileNamePrefix << std::uppercase << std::hex << unCounterStorageAddress << std::dec << kFileNameSeparator << unTemporaryFilePathCounter << kFileNameSeparator << nRandomValue << kTemporaryFileExtension;"), "Temporary path: uppercase hexadecimal address and decimal counters on one physical line");
	const strTemporaryIndentation = strTemporaryBody.match(/^\t+/)[0];
	Check(strTemporaryBody.includes("->ToString(LocalContext).ToLocal(&LocalFileNamePrefixString)) {\n" + strTemporaryIndentation + "\t\t\t\treturn;"), "Temporary path: preserve prefix coercion error");
	Check(strTemporaryBody.includes("UTF8FileNamePrefix = v8::String::Utf8Value(pIsolate, LocalFileNamePrefixString);"), "Temporary path: encode converted prefix only");
	Check(strTemporaryBody.includes("std::string(*UTF8FileNamePrefix, static_cast<std::size_t>(UTF8FileNamePrefix.length()))"), "Temporary path: full UTF-8 prefix length");
	Check(strTemporaryBody.includes("strFileNamePrefix.find('\\0') != std::string::npos"), "Temporary path: reject NUL prefix");
	Check(strTemporaryBody.indexOf("strFileNamePrefix.find('\\0')") < strTemporaryBody.indexOf("++g_unFilesystemTemporaryFilePathCounter"), "Temporary path: reject NUL before generating a path");
	Check(strTemporaryBody.includes("PathDirectory = std::filesystem::current_path(ErrorCode);"), "Temporary path: preserve directory fallback");
	Check(GetFunction(strSource, "RemoveFileCallback").includes("std::filesystem::remove(PathFile, ErrorCode)"), "Remove: retain nonrecursive operation");

	return unCheckCount;
}

function VerifyRejectedMutation(strCaseName, strBefore, strAfter) {
	g_Assert.notEqual(strBefore, strAfter, `${strCaseName}: distinct mutation required`);
	g_Assert.ok(g_strModuleBindingsSource.includes(strBefore), `${strCaseName}: mutation target required`);

	const strMutatedSource = g_strModuleBindingsSource.replace(strBefore, () => strAfter);
	g_Assert.notEqual(strMutatedSource, g_strModuleBindingsSource, `${strCaseName}: mutation must apply`);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), { name: "AssertionError" }, `${strCaseName}: regression must be rejected`);
	g_unRejectedMutationCount += 1;
}

VerifyFunctionExtraction();

const g_unCheckCount = VerifyContracts(g_strModuleBindingsSource);

const g_strExistenceCallback = GetFunction(g_strModuleBindingsSource, "DoesFileExistCallback");
VerifyRejectedMutation("native exception type", g_strExistenceCallback, g_strExistenceCallback.replace("} catch (...) {", "} catch (std::bad_alloc const&) {"));
VerifyRejectedMutation("path coercion error", "->ToString(LocalContext).ToLocal(&LocalFilePathString)", "->ToString(LocalContext).ToLocalChecked(&LocalFilePathString)");
VerifyRejectedMutation("direct path coercion", "UTF8FilePath = v8::String::Utf8Value(pIsolate, LocalFilePathString);", "UTF8FilePath = v8::String::Utf8Value(pIsolate, CallbackInformation[kPathArgumentIndex]);");
VerifyRejectedMutation("text NUL truncation", "std::string(*UTF8Text, static_cast<std::size_t>(UTF8Text.length()))", "std::string(*UTF8Text)");
VerifyRejectedMutation("own seek property", "SetRecordProperty(pIsolate, LocalContext, LocalSeekTypesObject, kHeadPropertyName", "SetValue(pIsolate, LocalContext, LocalSeekTypesObject, kHeadPropertyName");
VerifyRejectedMutation("view copy range", "LocalArrayBufferView->CopyContents(vecBytes.data(), unByteLength)", "LocalArrayBufferView->CopyContents(vecBytes.data(), unByteLength - 1)");

const g_strBytesBody = GetFunction(g_strModuleBindingsSource, "GetFilesystemBytesFromValue");
VerifyRejectedMutation("missing array-buffer-view branch", g_strBytesBody, g_strBytesBody.replace("->IsArrayBufferView()", "->IsUndefined()"));

VerifyRejectedMutation("strict integer", "!LocalArgumentValue->IsInt32()", "!LocalArgumentValue->IsNumber()");

const g_strOpenFileOwnerDeclaration = "std::unique_ptr<void, FilesystemFileCloser> FileOwner = std::unique_ptr<void, FilesystemFileCloser>(hFile, FilesystemFileCloser { *pFileSystem });";
VerifyRejectedMutation("open handle ownership", g_strOpenFileOwnerDeclaration, g_strOpenFileOwnerDeclaration.replace("(hFile,", "(nullptr,"));
VerifyRejectedMutation("open own property", "SetRecordProperty(pIsolate, LocalContext, LocalSourceFileObject, kHandlePropertyName", "SetValue(pIsolate, LocalContext, LocalSourceFileObject, kHandlePropertyName");

const g_strOpenBody = GetFunction(g_strModuleBindingsSource, "OpenSourceFileCallback");
VerifyRejectedMutation("open late rollback ownership", g_strOpenBody, g_strOpenBody.replace(g_strOpenFileOwnerDeclaration, "").replace("v8::Local<v8::Object> const LocalSourceFileObject = v8::Object::New(pIsolate);", "$&\n\n\t\t\t\t" + g_strOpenFileOwnerDeclaration));
VerifyRejectedMutation("open ownership transfer order", g_strOpenBody, g_strOpenBody.replace(/CallbackInformation\.GetReturnValue\(\)\.Set\(LocalSourceFileObject\);\n(\t+)FileOwner\.release\(\);/, "FileOwner.release();\n$1CallbackInformation.GetReturnValue().Set(LocalSourceFileObject);"));
VerifyRejectedMutation("truncation own property", "SetRecordProperty(pIsolate, LocalContext, LocalTruncationResultObject, kSizePropertyName", "SetNumber(pIsolate, LocalContext, LocalTruncationResultObject, kSizePropertyName");
for (const strName of ["Read", "Write", "New"]) {
	VerifyRejectedMutation(`truncation ${strName} ownership`, `${strName}FileOwner = std::unique_ptr<void, FilesystemFileCloser>(h${strName}File, FilesystemFileCloser { *pFileSystem })`, `${strName}FileOwner = std::unique_ptr<void, FilesystemFileCloser>(nullptr, FilesystemFileCloser { *pFileSystem })`);
}

VerifyRejectedMutation("truncation close retry", "pFileSystem->Close(WriteFileOwner.release());", "pFileSystem->Close(WriteFileOwner.get());");

const g_strTruncateBody = GetFunction(g_strModuleBindingsSource, "TruncateSourceFileCallback");
VerifyRejectedMutation("truncation ownership transfer order", g_strTruncateBody, g_strTruncateBody.replace(/CallbackInformation\.GetReturnValue\(\)\.Set\(LocalTruncationResultObject\);\n(\t+)NewFileOwner\.release\(\);/, "NewFileOwner.release();\n$1CallbackInformation.GetReturnValue().Set(LocalTruncationResultObject);"));
VerifyRejectedMutation("truncation ownership state index", g_strTruncateBody, g_strTruncateBody.replace("kOwnershipStateArgumentIndex = 5;", "kOwnershipStateArgumentIndex = 4;"));
VerifyRejectedMutation("truncation proxy state", g_strTruncateBody, g_strTruncateBody.replace(" || CallbackInformation[kOwnershipStateArgumentIndex]->IsProxy()", ""));
VerifyRejectedMutation("truncation initial ownership", g_strTruncateBody, g_strTruncateBody.replace("LocalOwnershipState, kConsumedPropertyName, v8::False(pIsolate)", "LocalOwnershipState, kConsumedPropertyName, v8::True(pIsolate)"));
VerifyRejectedMutation("truncation handoff", g_strTruncateBody, g_strTruncateBody.replace("LocalOwnershipState, kConsumedPropertyName, v8::True(pIsolate)", "LocalOwnershipState, kConsumedPropertyName, v8::False(pIsolate)"));
VerifyRejectedMutation("truncation handoff order", g_strTruncateBody, g_strTruncateBody.replace("// Handoff precedes the close attempt:", "pFileSystem->Close(hFile);\n\n\t\t\t\t// Handoff precedes the close attempt:"));

const g_strDestinationFileOwnerDeclaration = "std::unique_ptr<void, FilesystemFileCloser> DestinationFileOwner = std::unique_ptr<void, FilesystemFileCloser>(hDestinationFile, FilesystemFileCloser { *pFileSystem });";
const g_strSaveBody = GetFunction(g_strModuleBindingsSource, "SaveSourceFileCallback");
VerifyRejectedMutation("save destination ownership", g_strDestinationFileOwnerDeclaration, g_strDestinationFileOwnerDeclaration.replace("(hDestinationFile,", "(nullptr,"));
VerifyRejectedMutation("save copied source ownership", g_strSaveBody, g_strSaveBody.replace(g_strDestinationFileOwnerDeclaration, "std::unique_ptr<void, FilesystemFileCloser> SourceFileOwner = std::unique_ptr<void, FilesystemFileCloser>(hFile, FilesystemFileCloser { *pFileSystem });\n\n\t\t\t\t" + g_strDestinationFileOwnerDeclaration));
VerifyRejectedMutation("save direct source ownership", g_strSaveBody, g_strSaveBody.replace(g_strDestinationFileOwnerDeclaration, "std::unique_ptr<void, FilesystemFileCloser> SourceFileOwner(hFile, FilesystemFileCloser { *pFileSystem });\n\n\t\t\t\t" + g_strDestinationFileOwnerDeclaration));
VerifyRejectedMutation("save close retry", "pFileSystem->Close(DestinationFileOwner.release());", "pFileSystem->Close(DestinationFileOwner.get());");
VerifyRejectedMutation("temporary path direct coercion", "UTF8FileNamePrefix = v8::String::Utf8Value(pIsolate, LocalFileNamePrefixString);", "UTF8FileNamePrefix = v8::String::Utf8Value(pIsolate, CallbackInformation[kFileNamePrefixArgumentIndex]);");

const g_strTemporaryBody = GetFunction(g_strModuleBindingsSource, "GetTemporaryFilePathCallback");
VerifyRejectedMutation("temporary path hexadecimal address", g_strTemporaryBody, g_strTemporaryBody.replace("<< std::hex << unCounterStorageAddress", "<< unCounterStorageAddress"));
VerifyRejectedMutation("temporary path uppercase address", g_strTemporaryBody, g_strTemporaryBody.replace("<< std::uppercase <<", "<<"));
VerifyRejectedMutation("temporary path decimal counters", g_strTemporaryBody, g_strTemporaryBody.replace("<< std::dec << kFileNameSeparator", "<< kFileNameSeparator"));
VerifyRejectedMutation("temporary path NUL guard", g_strTemporaryBody, g_strTemporaryBody.replace("strFileNamePrefix.find('\\0') != std::string::npos", "false"));
VerifyRejectedMutation("temporary path full length", g_strTemporaryBody, g_strTemporaryBody.replace("std::string(*UTF8FileNamePrefix, static_cast<std::size_t>(UTF8FileNamePrefix.length()))", "*UTF8FileNamePrefix"));
VerifyRejectedMutation("save read bounds", "if ((nBytesRead < kEmptyFileSize) || (nBytesRead > nFileSize))", "if (nBytesRead < kEmptyFileSize)");
VerifyRejectedMutation("recursive removal", "std::filesystem::remove(PathFile, ErrorCode)", "std::filesystem::remove_all(PathFile, ErrorCode)");

for (const strName of g_vecCallbackNames.slice(0, 4)) {
	const strCurrent = GetFunction(g_strModuleBindingsSource, strName + "Callback");
	const strPathName = (strName === "EnsureDirectoryExists") ? "strDirectoryPath" : "strFilePath";
	const strUTF8Name = (strName === "EnsureDirectoryExists") ? "UTF8DirectoryPath" : "UTF8FilePath";
	VerifyRejectedMutation(strName + " NUL guard", strCurrent, strCurrent.replace(strPathName + ".find('\\0') != std::string::npos", "false"));
	VerifyRejectedMutation(strName + " path truncation", strCurrent, strCurrent.replace(`std::string(*${strUTF8Name}, static_cast<std::size_t>(${strUTF8Name}.length()))`, "*" + strUTF8Name));
	VerifyRejectedMutation(strName + " UTF-8 path decoding", strCurrent, strCurrent.replace(`std::u8string(${strPathName}.begin(), ${strPathName}.end())`, strPathName));
}

const g_strNativeStringParser = GetFunction(g_strModuleBindingsSource, "RequireFilesystemStringArgument");
VerifyRejectedMutation("native string NUL guard", g_strNativeStringParser, g_strNativeStringParser.replace("strArgumentValue.find('\\0') != std::string::npos", "false"));
VerifyRejectedMutation("native string truncation", g_strNativeStringParser, g_strNativeStringParser.replace("std::string(*UTF8ArgumentValue, static_cast<std::size_t>(UTF8ArgumentValue.length()))", "*UTF8ArgumentValue"));

console.log(`filesystem native value contracts passed: ${g_unCheckCount} contracts and ${g_unRejectedMutationCount} rejected mutations`);
