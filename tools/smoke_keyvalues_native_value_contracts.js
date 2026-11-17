"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecKeyValuesModuleFunctionBindings = [
	["Types", "GetKeyValuesTypesCallback"],
	["Create", "CreateKeyValuesCallback"],
	["Destroy", "DestroyKeyValuesCallback"],
	["Address", "GetKeyValuesNativeAddressCallback"],
	["Name", "GetKeyValuesNameCallback"],
	["SetName", "SetKeyValuesNameCallback"],
	["NameSymbol", "GetKeyValuesNameSymbolCallback"],
	["DataType", "GetKeyValuesDataTypeCallback"],
	["FindKey", "FindKeyValuesKeyCallback"],
	["FindKeyBySymbol", "FindKeyValuesKeyBySymbolCallback"],
	["CreateNewKey", "CreateChildKeyValuesCallback"],
	["AddSubKey", "AddChildKeyValuesCallback"],
	["RemoveSubKey", "RemoveChildKeyValuesCallback"],
	["CopySubKeys", "CopyKeyValuesSubKeysCallback"],
	["MakeCopy", "MakeKeyValuesCopyCallback"],
	["FirstSubKey", "GetKeyValuesFirstSubKeyCallback"],
	["NextKey", "GetKeyValuesNextKeyCallback"],
	["SetNextKey", "SetKeyValuesNextKeyCallback"],
	["FirstTrueSubKey", "GetKeyValuesFirstTrueSubKeyCallback"],
	["NextTrueSubKey", "GetKeyValuesNextTrueSubKeyCallback"],
	["FirstValue", "GetKeyValuesFirstValueCallback"],
	["NextValue", "GetKeyValuesNextValueCallback"],
	["GetInt", "GetKeyValuesIntegerCallback"],
	["GetUInt64", "GetKeyValuesUInt64Callback"],
	["GetFloat", "GetKeyValuesFloatCallback"],
	["GetString", "GetKeyValuesStringCallback"],
	["GetColor", "GetKeyValuesColorCallback"],
	["GetAddress", "GetKeyValuesAddressCallback"],
	["IsEmpty", "IsKeyValuesEmptyCallback"],
	["Clear", "ClearKeyValuesCallback"],
	["SetString", "SetKeyValuesStringCallback"],
	["SetInt", "SetKeyValuesIntegerCallback"],
	["SetUInt64", "SetKeyValuesUInt64Callback"],
	["SetFloat", "SetKeyValuesFloatCallback"],
	["SetColor", "SetKeyValuesColorCallback"],
	["SetAddress", "SetKeyValuesAddressCallback<KeyValues>"],
	["Keys", "GetKeyValuesKeyNamesCallback<KeyValues>"],
	["Value", "GetKeyValuesValueCallback<KeyValues>"],
	["ToObject", "ConvertKeyValuesToObjectCallback<KeyValues>"],
	["ToString", "ConvertKeyValuesToStringCallback<KeyValues>"],
	["LoadFromBuffer", "LoadKeyValuesFromBufferCallback<KeyValues>"],
	["LoadFromFile", "LoadKeyValuesFromFileCallback<KeyValues>"],
	["SaveToFile", "SaveKeyValuesToFileCallback<KeyValues>"],
];

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_keyvalues_native_value_contracts.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

// Structural guards complement native V8 tests; they are not live SDK deletion proof.
const g_strSource = g_FileSystem.readFileSync(g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRejectedMutationCount = 0;

function GetFunction(strSource, strName) {
	const nNameIndex = strSource.indexOf(` ${strName}(`);
	g_Assert.ok(nNameIndex >= 0, `Missing function: ${strName}`);

	const unStartIndex = strSource.lastIndexOf("\n", nNameIndex) + 1;
	const vecIndentationMatch = strSource.slice(unStartIndex, nNameIndex).match(/^\t+/);
	g_Assert.ok(vecIndentationMatch, `Missing namespace indentation: ${strName}`);

	const strIndentation = vecIndentationMatch[0];
	const strTerminator = "\n" + strIndentation + "}\n";
	const nEndIndex = strSource.indexOf(strTerminator, nNameIndex);
	g_Assert.ok(nEndIndex >= unStartIndex, `Missing function boundary: ${strName}`);

	return strSource.slice(unStartIndex, nEndIndex + strTerminator.length);
}

function VerifyContracts(strSource) {
	let unCheckCount = 0;
	const Check = (bCondition, strMessage) => {
		g_Assert.ok(bCondition, strMessage);
		unCheckCount += 1;
	};

	const strInstaller = GetFunction(strSource, "InstallSourceJSModules");
	const nModuleStart = strInstaller.indexOf("v8::Local<v8::Object> const LocalKeyValuesModule = MakeModule(pIsolate);");
	const nModuleEnd = strInstaller.indexOf('if (!InstallModule(pIsolate, LocalContext, LocalSourceJS, "keyvalues", LocalKeyValuesModule)) {', nModuleStart);
	Check((nModuleStart >= 0) && (nModuleEnd > nModuleStart), "Module: locate the bounded KeyValues factory region before publication");
	const strModule = strInstaller.slice(nModuleStart, nModuleEnd);
	Check((strModule.match(/if \(!SetRecordFunction\(pIsolate, LocalContext, LocalKeyValuesModule,/g) ?? []).length === g_vecKeyValuesModuleFunctionBindings.length, "Module: every direct factory export creates an own function");

	for (const [strName, strCallbackName] of g_vecKeyValuesModuleFunctionBindings) {
		const strRegistration = "if (!SetRecordFunction(pIsolate, LocalContext, LocalKeyValuesModule, \"" + strName + "\", " + strCallbackName + ", LocalRuntimeData)) {\n\t\t\treturn false;\n\t\t}";
		Check(strModule.includes(strRegistration), "Module: preserve " + strName + " callback, runtime data and registration failure");
	}

	for (const strOperation of ["Get", "Set"]) {
		const strBooleanInstaller = GetFunction(strSource, "InstallKeyValues" + strOperation + "BooleanFunction");
		Check(strBooleanInstaller.includes("if (!SetRecordFunction(pIsolate, LocalContext, LocalKeyValues, \"" + strOperation + "Bool\", " + strOperation + "KeyValuesBooleanCallback<TKeyValues>, LocalRuntimeData)) {\n\t\t\t\t\treturn false;\n\t\t\t\t}"), "Module: optional " + strOperation + "Bool uses checked own-function creation");
	}

	for (const strName of ["GetKeyValuesAddressFromValue", "PrepareKeyValuesOwnershipTransfer"]) {
		const strBody = GetFunction(strSource, strName);
		const strIndentation = strBody.match(/^\t+/)[0];
		Check(strBody.includes("v8::TryCatch TryCatch(pIsolate);"), `${strName}: observe handle getter exception`);
		Check(strBody.includes("if (TryCatch.HasCaught()) {\n" + strIndentation + "\t\t\tTryCatch.ReThrow();\n" + strIndentation + "\t\t\treturn nullptr;"), `${strName}: preserve original exception`);
		Check(strBody.indexOf("TryCatch.HasCaught()") < strBody.indexOf("if (!bHasKeyValuesHandle)"), `${strName}: exception before missing-handle diagnostic`);
		Check(strBody.includes("umapKeyValuesRecords"), `${strName}: unordered-map category`);
	}

	const strHandleBody = GetFunction(strSource, "MakeKeyValuesHandleObject");
	Check(strHandleBody.includes("SetRecordProperty(pIsolate, LocalContext, LocalKeyValuesObject, kHandlePropertyName, v8::Integer::New(pIsolate, nKeyValuesHandle))"), "Handle: own integer field");

	const strColorBody = GetFunction(strSource, "MakeKeyValuesColorObject");

	for (const [strName, strChannel] of [["Red", "r"], ["Green", "g"], ["Blue", "b"], ["Alpha", "a"]]) {
		Check(strColorBody.includes(`SetRecordProperty(pIsolate, LocalContext, LocalColorObject, k${strName}PropertyName, v8::Integer::New(pIsolate, ColorValue.${strChannel}()))`), `Color: own ${strName} byte field`);
	}

	const strRegistrationBody = GetFunction(strSource, "RegisterKeyValues");
	Check(strRegistrationBody.includes("umapKeyValuesRecords.emplace(nKeyValuesHandle, std::move(RecordInformation));"), "Registration: insert one complete record");
	Check(!strRegistrationBody.includes("umapKeyValuesRecords[nKeyValuesHandle]"), "Registration: no partially assigned default record");

	const strValueBody = GetFunction(strSource, "MakeKeyValuesHandleValue");
	const strValueIndentation = strValueBody.match(/^\t+/)[0];
	Check(strValueBody.includes("std::unique_ptr<KeyValues, KeyValuesHandleRollback> KeyValuesOwner = std::unique_ptr<KeyValues, KeyValuesHandleRollback>(pKeyValues, KeyValuesHandleRollback { kInvalidKeyValuesHandle, bOwnsKeyValues });"), "Value: immediate rollback owner with initialized state");
	const nRollbackOwnerPosition = strValueBody.indexOf("KeyValuesOwner = std::unique_ptr<KeyValues, KeyValuesHandleRollback>(pKeyValues,");
	Check((nRollbackOwnerPosition >= 0) && (nRollbackOwnerPosition < strValueBody.indexOf("if (!pIsolate)")), "Value: ownership before validation");
	Check(strValueBody.includes("KeyValuesOwner.get_deleter().m_nKeyValuesHandle = nKeyValuesHandle;"), "Value: remember the committed registration");
	Check(strValueBody.indexOf("m_nKeyValuesHandle = nKeyValuesHandle;") < strValueBody.indexOf("MakeKeyValuesHandleObject("), "Value: registration rollback before output construction");
	Check(strValueBody.includes("KeyValuesOwner.release();\n\n" + strValueIndentation + "\treturn LocalKeyValuesHandleObject;"), "Value: transfer only after completed output");
	Check(!strValueBody.includes("DestroyKeyValuesHierarchy("), "Value: fresh-root rollback must not allocate hierarchy storage");
	Check(strSource.includes("GetKeyValuesRecords().erase(m_nKeyValuesHandle);"), "Rollback: erase only its registration");
	Check(/if \(m_bOwnsKeyValues\) \{\n\t+SourceJSKeyValuesDeleter \{\}\(pKeyValues\);/.test(strSource), "Rollback: never delete a borrowed input");
	Check(strSource.includes("KeyValuesHandleRollback::KeyValuesHandleRollback(const int nKeyValuesHandle, const bool bOwnsKeyValues) noexcept :\n\t\t\tm_nKeyValuesHandle(nKeyValuesHandle),\n\t\t\tm_bOwnsKeyValues(bOwnsKeyValues)"), "Rollback: constructor establishes both scalar fields");

	const strStringBody = GetFunction(strSource, "RequireKeyValuesStringFromValue");
	Check(strStringBody.includes("std::string(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()))"), "String: preserve complete UTF-8 input");
	Check(strStringBody.includes("strValue.find('\\0') != std::string::npos"), "String: reject NUL before SDK use");
	Check(strStringBody.indexOf("strValue.find('\\0')") < strStringBody.indexOf("strValueOut = strValue;"), "String: no output commit on rejected input");

	const strColorFallbackBody = GetFunction(strSource, "GetKeyValuesColor");
	const strColorConstruction = "Color(DefaultColorValue.r(), DefaultColorValue.g(), DefaultColorValue.b(), DefaultColorValue.a())";
	Check(strColorFallbackBody.split(strColorConstruction).length === 3, "Color fallback: construct both results from all four SDK components");
	Check(!strColorFallbackBody.includes("return DefaultColorValue;"), "Color fallback: no deprecated implicit SDK copy");

	Check(strSource.includes("void operator()(KeyValues* const pKeyValues) const noexcept"), "Rollback: no exception escapes");
	Check(strSource.includes("struct SourceJSKeyValuesDeleter {\n\t\t\tvoid operator()(KeyValues* const pKeyValues) const noexcept"), "SDK closer: non-throwing cleanup");
	Check(strSource.includes("pKeyValues->deleteThis();\n\t\t\t\t\t}\n\t\t\t\t} catch (...)"), "SDK closer: contain cleanup exceptions");

	const strAddressBody = GetFunction(strSource, "RequireKeyValuesNativeAddressFromValue");
	Check(strAddressBody.includes("GetAddressSizedUnsignedIntegerFromValue(LocalAddressValue, unAddress)"), "Address: width-checked BigInt");
	Check(GetFunction(strSource, "MakeKeyValuesNativeAddressValue").includes("v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress))"), "Address: BigInt result");

	const strColorInputBody = GetFunction(strSource, "RequireKeyValuesColorFromValue");
	Check(strColorInputBody.includes("(unComponentCount != kRGBComponentCount) && (unComponentCount != kRGBAComponentCount)"), "Color input: exactly three or four array components");
	Check(strColorInputBody.includes("const bool bAlphaRequired = unComponentCount == kRGBAComponentCount;"), "Color input: preserve nullish/default alpha behavior");
	Check(strColorInputBody.split("ColorValueOut.SetColor(nRed, nGreen, nBlue, nAlpha);").length === 3, "Color input: both validated paths commit through the byte-wise SDK setter");
	Check(GetFunction(strSource, "RequireKeyValuesColorComponentFromValue").includes("(nValue < 0) || (nValue > kMaximumColorComponent)"), "Color input: byte range before construction");

	const vecCallbackNames = [
		"GetKeyValuesTypesCallback",
		"CreateKeyValuesCallback",
		"DestroyKeyValuesCallback",
		"GetKeyValuesNativeAddressCallback",
		"GetKeyValuesNameCallback",
		"SetKeyValuesNameCallback",
		"GetKeyValuesNameSymbolCallback",
		"GetKeyValuesDataTypeCallback",
		"FindKeyValuesKeyCallback",
		"FindKeyValuesKeyBySymbolCallback",
		"CreateChildKeyValuesCallback",
		"AddChildKeyValuesCallback",
		"RemoveChildKeyValuesCallback",
		"CopyKeyValuesSubKeysCallback",
		"MakeKeyValuesCopyCallback",
		"SetKeyValuesNextKeyCallback",
		"GetKeyValuesIntegerCallback",
		"GetKeyValuesUInt64Callback",
		"GetKeyValuesFloatCallback",
		"GetKeyValuesStringCallback",
		"GetKeyValuesColorCallback",
		"GetKeyValuesBooleanCallback",
		"GetKeyValuesAddressCallback",
		"IsKeyValuesEmptyCallback",
		"ClearKeyValuesCallback",
		"SetKeyValuesStringCallback",
		"SetKeyValuesIntegerCallback",
		"SetKeyValuesUInt64Callback",
		"SetKeyValuesFloatCallback",
		"SetKeyValuesColorCallback",
		"SetKeyValuesBooleanCallback",
		"SetKeyValuesAddressCallback",
		"GetKeyValuesKeyNamesCallback",
		"GetKeyValuesValueCallback",
		"ConvertKeyValuesToObjectCallback",
		"ConvertKeyValuesToStringCallback",
		"LoadKeyValuesFromBufferCallback",
	];
	for (const strName of vecCallbackNames) {
		const strBody = GetFunction(strSource, strName);
		const strIndentation = strBody.match(/^\t+/)[0];
		Check(strBody.includes("constexpr char kNativeExceptionErrorMessage[]"), `${strName}: named operation diagnostic`);
		Check(strBody.includes("\n" + strIndentation + "\ttry {\n"), `${strName}: native boundary`);
		Check(strBody.endsWith("\n" + strIndentation + "\t} catch (...) {\n" + strIndentation + "\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);\n" + strIndentation + "\t}\n" + strIndentation + "}\n"), `${strName}: translate every native exception`);
	}

	const strTypesBody = GetFunction(strSource, "GetKeyValuesTypesCallback");
	Check(strTypesBody.includes("SetRecordProperty(pIsolate, LocalContext, LocalTypesObject, TypeBinding.m_pszPropertyName, v8::Integer::New(pIsolate, TypeBinding.m_nTypeValue))"), "Types: own integer data properties");
	Check(GetFunction(strSource, "MakeV8ValueFromKeyValuesNode").includes("SetRecordProperty(pIsolate, LocalContext, LocalKeyValuesObject, pszChildKeyName, LocalChildValue)"), "Tree output: own data fields with original user keys");

	const strDestroyBody = GetFunction(strSource, "DestroyKeyValuesCallback");
	const strDestroyIndentation = strDestroyBody.match(/^\t+/)[0];
	Check(strDestroyBody.includes("v8::TryCatch TryCatch(pIsolate);"), "Destroy: observe handle getter exception");
	Check(strDestroyBody.includes("TryCatch.ReThrow();\n" + strDestroyIndentation + "\t\t\t\treturn;"), "Destroy: retain original getter exception");
	Check(strDestroyBody.indexOf("TryCatch.HasCaught()") < strDestroyBody.indexOf("if (!bHasKeyValuesHandle)"), "Destroy: getter failure before generic diagnostic");
	Check(strDestroyBody.includes("std::unordered_map<int, KeyValuesRecord>& umapKeyValuesRecords"), "Destroy: specific unordered-map category");
	Check(strDestroyBody.includes("if (itKeyValuesRecord == umapKeyValuesRecords.end()) {\n" + strDestroyIndentation + "\t\t\tCallbackInformation.GetReturnValue().Set(false);\n" + strDestroyIndentation + "\t\t\treturn;"), "Destroy: unknown valid handle remains false");

	const strResolverBody = GetFunction(strSource, "GetKeyValuesAddressFromValue");
	const strResolverIndentation = strResolverBody.match(/^\t+/)[0];
	Check(strResolverBody.includes("int* const pnKeyValuesHandleOut = nullptr"), "Resolver: optional signed-handle output");
	Check(strResolverBody.includes("if (pnKeyValuesHandleOut) {\n" + strResolverIndentation + "\t\t*pnKeyValuesHandleOut = nKeyValuesHandle;"), "Resolver: commit the matching record ID");
	Check(strResolverBody.indexOf("*pnKeyValuesHandleOut =") > strResolverBody.indexOf("itRecord->second.m_strPluginName != strPluginName"), "Resolver: output only after validation");
	Check(GetFunction(strSource, "RequireKeyValuesAddressArgument").includes("LocalArgumentValue, kRequireKeyValues, pnKeyValuesHandleOut)"), "Argument resolver: forward output without rereading Handle");

	for (const [strName, strSDKMethod] of [["GetKeyValuesFloatCallback", "GetFloat"], ["SetKeyValuesFloatCallback", "SetFloat"]]) {
		const strBody = GetFunction(strSource, strName);
		const strIndentation = strBody.match(/^\t+/)[0];
		const strLease = "if (!RequireUnchangedKeyValuesAddress(pIsolate, nKeyValuesHandle, pKeyValues, kInvalidatedHandleErrorMessage)) {\n" + strIndentation + "\t\t\treturn;\n" + strIndentation + "\t\t}";
		Check(strBody.includes("RequireKeyValuesAddressArgument(CallbackInformation, kKeyValuesHandleArgumentIndex, &nKeyValuesHandle)"), `${strName}: capture original handle with its native address`);
		Check(strBody.includes('constexpr char kInvalidatedHandleErrorMessage[] = "keyvalues native handle was invalidated by a float conversion.";'), `${strName}: float invalidation diagnostic`);
		Check(strBody.includes(strLease), `${strName}: reject a conversion-invalidated record`);
		Check(strBody.indexOf(strLease) > strBody.indexOf("RequireKeyValuesFloatFromValue("), `${strName}: revalidate after float coercion`);
		Check(strBody.indexOf(strLease) < strBody.indexOf(`pKeyValues->${strSDKMethod}(`), `${strName}: revalidate before SDK access`);
		Check(!strBody.includes("GetKeyValuesHandleFromValue("), `${strName}: never reread the supplied handle getter`);
	}

	const strCopyBody = GetFunction(strSource, "CopyKeyValuesSubKeysCallback");
	const strCopyIndentation = strCopyBody.match(/^\t+/)[0];
	const strSelfCopyGuard = "if (pSourceKeyValues == pTargetKeyValues) {\n" + strCopyIndentation + "\t\t\tCallbackInformation.GetReturnValue().Set(true);\n" + strCopyIndentation + "\t\t\treturn;\n" + strCopyIndentation + "\t\t}";
	const strCopyTargetGuard = "if (pTargetKeyValues->GetFirstSubKey()) {\n" + strCopyIndentation + "\t\t\tThrowError(pIsolate, kEmptyTargetErrorMessage);\n" + strCopyIndentation + "\t\t\treturn;\n" + strCopyIndentation + "\t\t}";
	Check(strCopyBody.includes(strSelfCopyGuard), "CopySubKeys: native-address self-copy is a no-op");
	Check(strCopyBody.includes(strCopyTargetGuard), "CopySubKeys: reject an occupied target before SDK overwrite");
	Check(strCopyBody.includes('constexpr char kEmptyTargetErrorMessage[] = "keyvalues.CopySubKeys(Source, Target) expects a distinct Target to have no subkeys.";'), "CopySubKeys: specific occupied-target diagnostic");
	Check(strCopyBody.indexOf(strSelfCopyGuard) > strCopyBody.indexOf("RequireUnchangedKeyValuesAddress("), "CopySubKeys: validate original source before guards");
	Check(strCopyBody.indexOf(strSelfCopyGuard) < strCopyBody.indexOf(strCopyTargetGuard), "CopySubKeys: self-copy precedes occupied-target rejection");
	Check(strCopyBody.indexOf(strCopyTargetGuard) < strCopyBody.indexOf("pSourceKeyValues->CopySubkeys("), "CopySubKeys: target validation before SDK overwrite");
	const strRemoveBody = GetFunction(strSource, "RemoveChildKeyValuesCallback");
	Check(strRemoveBody.includes("umapKeyValuesRecords.find(nChildKeyValuesHandle)") && strRemoveBody.includes("itChildKeyValuesRecord->second.m_bOwnsKeyValues = true;"), "RemoveSubKey: promote only the supplied child handle");

	const strAddChildBody = GetFunction(strSource, "AddChildKeyValuesCallback");
	const strAddChildIndentation = strAddChildBody.match(/^\t+/)[0];
	const strChildPeerGuard = "if (pChildKeyValues->GetNextKey()) {\n" + strAddChildIndentation + "\t\t\tThrowError(pIsolate, kChildNextPeerErrorMessage);\n" + strAddChildIndentation + "\t\t\treturn;\n" + strAddChildIndentation + "\t\t}";
	Check(strAddChildBody.includes(strChildPeerGuard), "AddSubKey: reject a child root with a next peer before SDK attachment");
	Check(strAddChildBody.includes('constexpr char kChildNextPeerErrorMessage[] = "keyvalues.AddSubKey(Parent, Child) expects Child to be an owned root without a next peer.";'), "AddSubKey: specific peer-root diagnostic");
	Check(strAddChildBody.indexOf(strChildPeerGuard) > strAddChildBody.indexOf("RequireUnchangedKeyValuesAddress("), "AddSubKey: reject stale parent before peer inspection");
	Check(strAddChildBody.indexOf(strChildPeerGuard) < strAddChildBody.indexOf("CollectKeyValuesHierarchy("), "AddSubKey: peer validation before traversal");
	Check(strAddChildBody.indexOf(strChildPeerGuard) < strAddChildBody.indexOf("pParentKeyValues->AddSubKey("), "AddSubKey: peer validation before links or ownership change");

	const strLeaseBody = GetFunction(strSource, "RequireUnchangedKeyValuesAddress");
	const strLeaseIndentation = strLeaseBody.match(/^\t+/)[0];
	Check(strLeaseBody.includes("(itRecord == umapKeyValuesRecords.end()) || (itRecord->second.m_pKeyValues != pKeyValues)"), "Lease: record must still match the resolved native address");
	Check(strLeaseBody.includes("ThrowError(pIsolate, pszErrorMessage);\n" + strLeaseIndentation + "\t\treturn false;"), "Lease: report invalidation before native access");

	for (const [strName, strRole, strAddress, strNativeOperation] of [
		["AddChildKeyValuesCallback", "Parent", "pParentKeyValues", "AddSubKey"],
		["RemoveChildKeyValuesCallback", "Parent", "pParentKeyValues", "GetFirstSubKey"],
		["CopyKeyValuesSubKeysCallback", "Source", "pSourceKeyValues", "CopySubkeys"],
		["SetKeyValuesNextKeyCallback", "Current", "pKeyValues", "GetNextKey"],
	]) {
		const strBody = GetFunction(strSource, strName);
		Check(strBody.includes(`RequireKeyValuesAddressArgument(CallbackInformation, k${strRole}HandleArgumentIndex, &n${strRole}KeyValuesHandle)`), `${strName}: capture the first record ID`);
		const strCheck = `RequireUnchangedKeyValuesAddress(pIsolate, n${strRole}KeyValuesHandle, ${strAddress}, kInvalidated${strRole}HandleErrorMessage)`;
		Check(strBody.includes(strCheck), `${strName}: revalidate after another handle's getter`);
		Check(strBody.indexOf(strCheck) < strBody.indexOf(`${strAddress}->${strNativeOperation}(`), `${strName}: revalidate before SDK dereference`);
		Check(!strBody.includes("GetKeyValuesHandleFromValue("), `${strName}: no second Handle read`);
	}

	for (const [strName, strRole, strArgument] of [
		["AddChildKeyValuesCallback", "Child", "ChildHandle"],
		["RemoveChildKeyValuesCallback", "Child", "ChildHandle"],
		["SetKeyValuesNextKeyCallback", "Next", "NextKeyHandle"],
	]) {
		Check(GetFunction(strSource, strName).includes(`CallbackInformation[k${strArgument}ArgumentIndex], kRequire${strRole}KeyValues, &n${strRole}KeyValuesHandle)`), `${strName}: address and record ID from the same getter read`);
	}

	const strChildCallbackBody = GetFunction(strSource, "GetKeyValues##NAME##Callback");
	Check(strChildCallbackBody.includes("constexpr char kNativeExceptionErrorMessage[]"), "Generated traversal: named diagnostic");
	Check(strChildCallbackBody.includes("try { \\"), "Generated traversal: native boundary");
	Check(strChildCallbackBody.includes("} catch (...) { \\"), "Generated traversal: contain all native exceptions");

	const strColorReadBody = GetFunction(strSource, "GetKeyValuesColorCallback");
	Check(strColorReadBody.includes("RequireKeyValuesAddressArgument(CallbackInformation, kKeyValuesHandleArgumentIndex, &nKeyValuesHandle)"), "Color read: capture the original record ID");
	const strColorLeaseCheck = "RequireUnchangedKeyValuesAddress(pIsolate, nKeyValuesHandle, pKeyValues, kInvalidatedHandleErrorMessage)";
	Check(strColorReadBody.includes(strColorLeaseCheck), "Color read: reject getter-invalidated records");
	Check(strColorReadBody.indexOf(strColorLeaseCheck) > strColorReadBody.indexOf("RequireKeyValuesColorFromValue("), "Color read: validate after component getters");
	Check(strColorReadBody.indexOf(strColorLeaseCheck) < strColorReadBody.indexOf("GetKeyValuesColor("), "Color read: validate before SDK access");
	Check(!strColorReadBody.includes("GetKeyValuesHandleFromValue("), "Color read: never reread Handle");

	const strColorWriteBody = GetFunction(strSource, "SetKeyValuesColorCallback");
	Check(strColorWriteBody.includes("RequireKeyValuesAddressArgument(CallbackInformation, kKeyValuesHandleArgumentIndex, &nKeyValuesHandle)"), "Color write: capture the original record ID");
	Check(strColorWriteBody.includes(strColorLeaseCheck), "Color write: reject getter-invalidated records");
	Check(strColorWriteBody.indexOf(strColorLeaseCheck) > strColorWriteBody.indexOf("RequireKeyValuesColorFromValue("), "Color write: validate after component getters");
	Check(strColorWriteBody.indexOf(strColorLeaseCheck) < strColorWriteBody.indexOf("pKeyValues->SetColor("), "Color write: validate before SDK mutation");
	Check(!strColorWriteBody.includes("GetKeyValuesHandleFromValue("), "Color write: never reread Handle");
	Check(strColorWriteBody.includes("pKeyValues->SetColor(pszKeyName, Color(ColorValue.r(), ColorValue.g(), ColorValue.b(), ColorValue.a()))"), "Color write: SDK value argument preserves all channels without deprecated copy");

	for (const [strName, strHierarchy, strDestination, strMutation] of [
		["AddChildKeyValuesCallback", "Child", "pParentKeyValues", "pParentKeyValues->AddSubKey("],
		["SetKeyValuesNextKeyCallback", "Next", "pKeyValues", "pKeyValues->SetNextKey("],
	]) {
		const strBody = GetFunction(strSource, strName);
		const strCheck = `IsKeyValuesAddressCollected(vec${strHierarchy}Hierarchy, ${strDestination})`;
		Check(strBody.includes(`CollectKeyValuesHierarchy(p${strHierarchy}KeyValues, vec${strHierarchy}Hierarchy);`) && strBody.includes(strCheck), `${strName}: reject an owned ancestor containing the destination`);
		Check(strBody.indexOf(strCheck) < strBody.indexOf(strMutation), `${strName}: hierarchy validation before changing SDK links`);
	}

	const strKeysBody = GetFunction(strSource, "GetKeyValuesKeyNamesCallback");
	Check(strKeysBody.includes("LocalKeyNamesArray->CreateDataProperty(LocalContext, unKeyNameIndex, LocalChildKeyName)"), "Keys: own indexed string data properties");
	Check(!strKeysBody.includes("LocalKeyNamesArray->Set("), "Keys: no inherited setters during SDK traversal");
	Check(strKeysBody.includes("kInvalidKeyNameIndex = std::numeric_limits<std::uint32_t>::max();") && strKeysBody.includes("if (unKeyNameIndex == kInvalidKeyNameIndex)"), "Keys: reject the non-array uint32 sentinel");
	Check(strKeysBody.indexOf("if (unKeyNameIndex == kInvalidKeyNameIndex)") < strKeysBody.indexOf("CreateDataProperty("), "Keys: reject overflow before indexed writes and increment");

	return unCheckCount;
}

function VerifyRejectedMutation(strName, strBefore, strAfter) {
	g_Assert.notEqual(strBefore, strAfter, `${strName}: distinct mutation required`);
	g_Assert.ok(g_strSource.includes(strBefore), `${strName}: target required`);

	const strMutatedSource = g_strSource.replace(strBefore, () => strAfter);
	g_Assert.notEqual(strMutatedSource, g_strSource, `${strName}: mutation must apply`);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), { name: "AssertionError" }, `${strName}: regression must be rejected`);
	g_unRejectedMutationCount += 1;
}

const g_strFunctionProbe = "\tvoid Probe() {\n\t}\n";
g_Assert.equal(GetFunction(g_strFunctionProbe + "\tvoid Later() {\n\t}\n", "Probe"), g_strFunctionProbe);
g_Assert.throws(() => GetFunction(g_strFunctionProbe, "Missing"), { name: "AssertionError" });
g_Assert.throws(() => GetFunction("\tvoid Probe() {\n", "Probe"), { name: "AssertionError" });
g_Assert.throws(() => GetFunction("void Probe() {\n}\n", "Probe"), { name: "AssertionError" });

const g_unCheckCount = VerifyContracts(g_strSource);

for (const [strName, strCallbackName] of g_vecKeyValuesModuleFunctionBindings) {
	const strRegistration = "if (!SetRecordFunction(pIsolate, LocalContext, LocalKeyValuesModule, \"" + strName + "\", " + strCallbackName + ", LocalRuntimeData)) {\n\t\t\treturn false;\n\t\t}";
	VerifyRejectedMutation(strName + " own factory function", strRegistration, strRegistration.replace("SetRecordFunction(", "SetFunction("));
	VerifyRejectedMutation(strName + " factory failure propagation", strRegistration, strRegistration.replace("return false;", "return true;"));
	VerifyRejectedMutation(strName + " factory callback", strRegistration, strRegistration.replace(strCallbackName, "RequireCallback"));
}

for (const strOperation of ["Get", "Set"]) {
	const strRegistration = "if (!SetRecordFunction(pIsolate, LocalContext, LocalKeyValues, \"" + strOperation + "Bool\", " + strOperation + "KeyValuesBooleanCallback<TKeyValues>, LocalRuntimeData)) {\n\t\t\t\t\treturn false;\n\t\t\t\t}";
	VerifyRejectedMutation(strOperation + "Bool own factory function", strRegistration, strRegistration.replace("SetRecordFunction(", "SetFunction("));
	VerifyRejectedMutation(strOperation + "Bool factory failure propagation", strRegistration, strRegistration.replace("return false;", "return true;"));
}

const g_strResolverBody = GetFunction(g_strSource, "GetKeyValuesAddressFromValue");
VerifyRejectedMutation("original getter exception", g_strResolverBody, g_strResolverBody.replace("TryCatch.ReThrow();", "TryCatch.Reset();"));
VerifyRejectedMutation("own handle property", "SetRecordProperty(pIsolate, LocalContext, LocalKeyValuesObject, kHandlePropertyName", "SetInteger(pIsolate, LocalContext, LocalKeyValuesObject, kHandlePropertyName");
VerifyRejectedMutation("own color property", "SetRecordProperty(pIsolate, LocalContext, LocalColorObject, kRedPropertyName", "SetInteger(pIsolate, LocalContext, LocalColorObject, kRedPropertyName");
VerifyRejectedMutation("complete registry insertion", "umapKeyValuesRecords.emplace(nKeyValuesHandle, std::move(RecordInformation));", "umapKeyValuesRecords[nKeyValuesHandle] = RecordInformation;");
VerifyRejectedMutation("rollback registration tracking", "KeyValuesOwner.get_deleter().m_nKeyValuesHandle = nKeyValuesHandle;", "KeyValuesOwner.get_deleter().m_nKeyValuesHandle = kInvalidKeyValuesHandle;");

const g_strBorrowedGuard = g_strSource.match(/if \(m_bOwnsKeyValues\) \{\n\t+SourceJSKeyValuesDeleter \{\}\(pKeyValues\);/)[0];
VerifyRejectedMutation("borrowed lifetime", g_strBorrowedGuard, g_strBorrowedGuard.replace("m_bOwnsKeyValues", "pKeyValues"));

const g_strHandleValueBody = GetFunction(g_strSource, "MakeKeyValuesHandleValue");
const g_strHandleValueOwnerDeclaration = "std::unique_ptr<KeyValues, KeyValuesHandleRollback> KeyValuesOwner = std::unique_ptr<KeyValues, KeyValuesHandleRollback>(pKeyValues, KeyValuesHandleRollback { kInvalidKeyValuesHandle, bOwnsKeyValues });";
VerifyRejectedMutation("missing immediate rollback owner", g_strHandleValueBody, g_strHandleValueBody.replace(g_strHandleValueOwnerDeclaration, ""));
VerifyRejectedMutation("late rollback attachment", g_strHandleValueBody, g_strHandleValueBody.replace(g_strHandleValueOwnerDeclaration, "").replace("const int nKeyValuesHandle = RegisterKeyValues", g_strHandleValueOwnerDeclaration + "\n\n\t\t\tconst int nKeyValuesHandle = RegisterKeyValues"));
VerifyRejectedMutation("ownership transfer", g_strHandleValueBody, g_strHandleValueBody.replace("KeyValuesOwner.release();", "KeyValuesOwner.get();"));

const g_strNativeStringBody = GetFunction(g_strSource, "RequireKeyValuesStringFromValue");
VerifyRejectedMutation("string full length", g_strNativeStringBody, g_strNativeStringBody.replace("std::string(*UTF8Value, static_cast<std::size_t>(UTF8Value.length()))", "*UTF8Value"));
VerifyRejectedMutation("string NUL guard", g_strNativeStringBody, g_strNativeStringBody.replace("strValue.find('\\0') != std::string::npos", "false"));

const g_strColorFallbackBody = GetFunction(g_strSource, "GetKeyValuesColor");
VerifyRejectedMutation("color fallback alpha", g_strColorFallbackBody, g_strColorFallbackBody.replace("DefaultColorValue.a()", "0"));
VerifyRejectedMutation("address width", "GetAddressSizedUnsignedIntegerFromValue(LocalAddressValue, unAddress)", "GetUnsignedIntegerFromValue(LocalAddressValue, unAddress)");
VerifyRejectedMutation("color input range", "(nValue < 0) || (nValue > kMaximumColorComponent)", "(nValue < 0)");
VerifyRejectedMutation("color component count", "(unComponentCount != kRGBComponentCount) && (unComponentCount != kRGBAComponentCount)", "(unComponentCount != kRGBComponentCount)");
VerifyRejectedMutation("SDK closer exception contract", "struct SourceJSKeyValuesDeleter {\n\t\t\tvoid operator()(KeyValues* const pKeyValues) const noexcept", "struct SourceJSKeyValuesDeleter {\n\t\t\tvoid operator()(KeyValues* const pKeyValues) const");

for (const strName of ["GetKeyValuesTypesCallback", "CreateKeyValuesCallback", "DestroyKeyValuesCallback", "GetKeyValuesNativeAddressCallback", "GetKeyValuesNameCallback", "SetKeyValuesNameCallback", "GetKeyValuesNameSymbolCallback", "GetKeyValuesDataTypeCallback", "FindKeyValuesKeyCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} native boundary`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
}

VerifyRejectedMutation("own enum properties", "SetRecordProperty(pIsolate, LocalContext, LocalTypesObject, TypeBinding.m_pszPropertyName", "SetInteger(pIsolate, LocalContext, LocalTypesObject, TypeBinding.m_pszPropertyName");
VerifyRejectedMutation("own tree properties", "SetRecordProperty(pIsolate, LocalContext, LocalKeyValuesObject, pszChildKeyName", "SetValue(pIsolate, LocalContext, LocalKeyValuesObject, pszChildKeyName");

const g_strDestroyBody = GetFunction(g_strSource, "DestroyKeyValuesCallback");
VerifyRejectedMutation("Destroy getter exception", g_strDestroyBody, g_strDestroyBody.replace("TryCatch.ReThrow();", "TryCatch.Reset();"));

for (const strName of ["FindKeyValuesKeyBySymbolCallback", "CreateChildKeyValuesCallback", "AddChildKeyValuesCallback", "RemoveChildKeyValuesCallback", "CopyKeyValuesSubKeysCallback", "MakeKeyValuesCopyCallback", "SetKeyValuesNextKeyCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} native boundary`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
}

VerifyRejectedMutation("resolved record output", "*pnKeyValuesHandleOut = nKeyValuesHandle;", "*pnKeyValuesHandleOut = kInvalidKeyValuesHandle;");
VerifyRejectedMutation("record liveness", "(itRecord == umapKeyValuesRecords.end()) || (itRecord->second.m_pKeyValues != pKeyValues)", "(itRecord == umapKeyValuesRecords.end())");

for (const strName of ["AddChildKeyValuesCallback", "RemoveChildKeyValuesCallback", "CopyKeyValuesSubKeysCallback", "SetKeyValuesNextKeyCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} lease recheck`, strBody, strBody.replace("RequireUnchangedKeyValuesAddress(", "UncheckedKeyValuesAddress("));
}

const g_strGeneratedChildBody = GetFunction(g_strSource, "GetKeyValues##NAME##Callback");
VerifyRejectedMutation("generated traversal boundary", g_strGeneratedChildBody, g_strGeneratedChildBody.replace("} catch (...) {", "} catch (std::exception const&) {"));

for (const strName of ["GetKeyValuesIntegerCallback", "GetKeyValuesUInt64Callback", "GetKeyValuesFloatCallback", "GetKeyValuesStringCallback", "GetKeyValuesColorCallback", "GetKeyValuesBooleanCallback", "GetKeyValuesAddressCallback", "IsKeyValuesEmptyCallback", "ClearKeyValuesCallback", "SetKeyValuesStringCallback", "SetKeyValuesIntegerCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} native boundary`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
}

const g_strColorReadBody = GetFunction(g_strSource, "GetKeyValuesColorCallback");
VerifyRejectedMutation("color resolved record", g_strColorReadBody, g_strColorReadBody.replace(", &nKeyValuesHandle)", ")"));
VerifyRejectedMutation("color getter invalidation", g_strColorReadBody, g_strColorReadBody.replace("RequireUnchangedKeyValuesAddress(", "UncheckedKeyValuesAddress("));

const g_ColorLeasePattern = /\t+if \(!RequireUnchangedKeyValuesAddress\(pIsolate, nKeyValuesHandle, pKeyValues, kInvalidatedHandleErrorMessage\)\) \{\n\t+return;\n\t+}\n\n/;
const g_strColorLeasePhase = g_strColorReadBody.match(g_ColorLeasePattern)[0];
VerifyRejectedMutation("color validation order", g_strColorReadBody, g_strColorReadBody.replace(g_strColorLeasePhase, "").replace(/\t+CallbackInformation\.GetReturnValue\(\)\.Set\(LocalColorValue\);/, strCommit => g_strColorLeasePhase + strCommit));

VerifyRejectedMutation("color assignment alignment", "ColorValueOut.SetColor(nRed, nGreen, nBlue, nAlpha);", "ColorValueOut = Color(nRed, nGreen, nBlue, nAlpha);");

for (const strName of ["SetKeyValuesUInt64Callback", "SetKeyValuesFloatCallback", "SetKeyValuesColorCallback", "SetKeyValuesBooleanCallback", "SetKeyValuesAddressCallback", "GetKeyValuesKeyNamesCallback", "GetKeyValuesValueCallback", "ConvertKeyValuesToObjectCallback", "ConvertKeyValuesToStringCallback", "LoadKeyValuesFromBufferCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(`${strName} native boundary`, strBody, strBody.replace("} catch (...) {", "} catch (std::exception const&) {"));
}

const g_strColorWriteBody = GetFunction(g_strSource, "SetKeyValuesColorCallback");
VerifyRejectedMutation("color write resolved record", g_strColorWriteBody, g_strColorWriteBody.replace(", &nKeyValuesHandle)", ")"));
VerifyRejectedMutation("color write getter invalidation", g_strColorWriteBody, g_strColorWriteBody.replace("RequireUnchangedKeyValuesAddress(", "UncheckedKeyValuesAddress("));

const g_strColorWriteLeasePhase = g_strColorWriteBody.match(g_ColorLeasePattern)[0];
VerifyRejectedMutation("color write validation order", g_strColorWriteBody, g_strColorWriteBody.replace(g_strColorWriteLeasePhase, "").replace(/\t+CallbackInformation\.GetReturnValue\(\)\.Set\(true\);/, strCommit => g_strColorWriteLeasePhase + strCommit));

for (const [strName, strHierarchy, strDestination] of [["AddChildKeyValuesCallback", "Child", "pParentKeyValues"], ["SetKeyValuesNextKeyCallback", "Next", "pKeyValues"]]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(strName + " ancestor rejection", strBody, strBody.replace(`IsKeyValuesAddressCollected(vec${strHierarchy}Hierarchy, ${strDestination})`, "false"));
}

for (const strName of ["GetKeyValuesFloatCallback", "SetKeyValuesFloatCallback"]) {
	const strBody = GetFunction(g_strSource, strName);
	VerifyRejectedMutation(strName + " float lease", strBody, strBody.replace("RequireUnchangedKeyValuesAddress(", "UncheckedKeyValuesAddress("));
	VerifyRejectedMutation(strName + " captured record", strBody, strBody.replace(", &nKeyValuesHandle)", ")"));
}

const g_strCopyBody = GetFunction(g_strSource, "CopyKeyValuesSubKeysCallback");
VerifyRejectedMutation("SDK copy self guard", g_strCopyBody, g_strCopyBody.replace("if (pSourceKeyValues == pTargetKeyValues)", "if (false)"));
VerifyRejectedMutation("SDK copy empty target guard", g_strCopyBody, g_strCopyBody.replace("if (pTargetKeyValues->GetFirstSubKey())", "if (false)"));

const g_strAddChildBody = GetFunction(g_strSource, "AddChildKeyValuesCallback");
VerifyRejectedMutation("SDK child peer precondition", g_strAddChildBody, g_strAddChildBody.replace("if (pChildKeyValues->GetNextKey())", "if (false)"));

VerifyRejectedMutation("color SDK value alpha", g_strColorWriteBody, g_strColorWriteBody.replace("Color(ColorValue.r(), ColorValue.g(), ColorValue.b(), ColorValue.a())", "Color(ColorValue.r(), ColorValue.g(), ColorValue.b(), 0)"));

const g_strKeysBody = GetFunction(g_strSource, "GetKeyValuesKeyNamesCallback");
VerifyRejectedMutation("own key indices", g_strKeysBody, g_strKeysBody.replace("LocalKeyNamesArray->CreateDataProperty(", "LocalKeyNamesArray->Set("));
VerifyRejectedMutation("key index limit", g_strKeysBody, g_strKeysBody.replace("if (unKeyNameIndex == kInvalidKeyNameIndex)", "if (unKeyNameIndex > kInvalidKeyNameIndex)"));

console.log(`KeyValues native value contracts passed: ${g_unCheckCount} contracts and ${g_unRejectedMutationCount} rejected mutations`);
