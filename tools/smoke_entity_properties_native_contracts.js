"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_entity_properties_native_contracts.js [--help]";
const g_vecContracts = [
	["RetainEntityPropertiesStringValue", "static std::list<std::string> s_lstStringValues {};"],
	["RetainEntityPropertiesStringValue", "s_lstStringValues.push_back(strValue);"],
	["EntityPropertiesIsRecordStorageRangeValid", "unByteCount <= (std::numeric_limits<std::uintptr_t>::max() - unAddress)"],
	["EntityPropertiesIsSendTableStorageValid", "if (nPropertyCount < 0) {"],
	["EntityPropertiesIsSendTableStorageValid", "if (nPropertyCount == 0) {"],
	["EntityPropertiesIsSendTableStorageValid", "unPropertyCount > (std::numeric_limits<std::size_t>::max() / sizeof(SendProp))"],
	["EntityPropertiesIsSendTableStorageValid", "EntityPropertiesIsRecordStorageRangeValid(pSendTable->m_pProps, unPropertyCount * sizeof(SendProp), alignof(SendProp))"],
	["AdvanceEntityPropertiesServerClassTraversal", "pNextServerClass == Traversal.m_pCycleAnchor"],
	["AdvanceEntityPropertiesServerClassTraversal", "Traversal.m_unCycleStepCount >= Traversal.m_unCycleWindowSize"],
	["AdvanceEntityPropertiesServerClassTraversal", "EntityPropertiesServerClassTraversal NextTraversal = Traversal;"],
	["AdvanceEntityPropertiesServerClassTraversal", "(kMaximumWindowSize / 2)"],
	["AdvanceEntityPropertiesServerClassTraversal", "Traversal = NextTraversal;"],
	["FindEntityPropertiesServerClassByName", "AdvanceEntityPropertiesServerClassTraversal(Traversal)"],
	["FindEntityPropertiesServerClassByAddress", "reinterpret_cast<std::uintptr_t>(pCurrentServerClass) == unServerClassAddress"],
	["FindEntityPropertiesServerClassByAddress", "AdvanceEntityPropertiesServerClassTraversal(Traversal)"],
	["FindEntityPropertiesSendTableByName", "AdvanceEntityPropertiesServerClassTraversal(Traversal)"],
	["FindEntityPropertiesSendTableByNameRecursive", "EntityPropertiesIsSendTableStorageValid(pCurrentSendTable)"],
	["EntityPropertiesFindPropertyInTable", "EntityPropertiesIsSendTableStorageValid(pCurrentSendTable)"],
	["FindEntityPropertiesPropertyInformation", "if (!EntityPropertiesIsSendTableStorageValid(pCurrentSendTable)) {"],
	["MakeEntityPropertiesReflectionObject", "SetRecordProperty(pIsolate, LocalContext, LocalReflectionObject, \"Kind\", MakeString(pIsolate, pszReflectionKind))"],
	["MakeEntityPropertiesReflectionObject", "SetRecordProperty(pIsolate, LocalContext, LocalReflectionObject, \"Address\", LocalReflectionAddressValue)"],
	["GetEntityPropertiesServerClassFromValue", "FindEntityPropertiesServerClassByAddress(GetEntityPropertiesServerGameDLL(), unServerClassAddress)"],
	["GetEntityPropertiesServerClassFromValue", "constexpr char kServerClassKind[] = \"serverclass\";"],
	["GetEntityPropertiesSendTableFromValue", "constexpr char kSendTableKind[] = \"sendtable\";"],
	["GetEntityPropertiesServerClassFromValue", "PropertyReadFailure.ReThrow();"],
	["GetEntityPropertiesServerClassFromValue", "} catch (...) {\n\t\t\t\tif (PropertyReadFailure.HasCaught()) {\n\t\t\t\t\tPropertyReadFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;\n\t\t\t}"],
	["GetEntityPropertiesServerClassFromEntity", "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t\treturn nullptr;\n\t\t\t\t}"],
	["GetEntityPropertiesServerClassFromEntity", "} catch (...) {\n\t\t\t\tif (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;\n\t\t\t}"],
	["GetEntityPropertiesSendTableFromValue", "PropertyReadFailure.ReThrow();"],
	["GetEntityPropertiesSendTableFromValue", "} catch (...) {\n\t\t\t\t\tif (PropertyReadFailure.HasCaught()) {\n\t\t\t\t\t\tPropertyReadFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["GetEntityPropertiesServerClassFromValue", "EntityPropertiesIsRecordStorageRangeValid(pServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["GetEntityPropertiesSendTableFromValue", "if (!EntityPropertiesIsSendTableStorageValid(pSendTable)) {"],
	["EntityPropertiesFillPropertyInformation", "EntityPropertiesPropertyInformation PropertyInformation {};"],
	["EntityPropertiesFillPropertyInformation", "PropertyInformationOut = std::move(PropertyInformation);"],
	["MakeEntityPropertiesSendTableObjectWithoutProperties", "pSendTable && !EntityPropertiesIsSendTableStorageValid(pSendTable)"],
	["MakeEntityPropertiesSendTableObjectWithoutProperties", "SetRecordProperty(pIsolate, LocalContext, LocalSendTableObject, \"Properties\", LocalPropertiesArray)"],
	["ResolveEntityPropertiesServerClassAndTable", "v8::TryCatch ResolutionFailure(pIsolate);"],
	["ResolveEntityPropertiesServerClassAndTable", "ResolutionFailure.ReThrow();"],
	["ResolveEntityPropertiesServerClassAndTable", "} catch (...) {\n\t\t\t\tif (ResolutionFailure.HasCaught()) {\n\t\t\t\t\tResolutionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;\n\t\t\t}"],
	["ResolveEntityPropertiesServerClassAndTable", "if (!EntityPropertiesIsSendTableStorageValid(pSendTable)) {"],
	["EntityPropertiesSetStringAddressProperty", "RetainEntityPropertiesStringValue(strPropertyValue)"],
	["EntityPropertiesSetStringAddressProperty", "std::memcpy(pchResolvedPropertyAddress, &pszStoredPropertyValue, sizeof(pszStoredPropertyValue));"],
	["EntityPropertiesSetStringAddressProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(char const*), alignof(unsigned char))"],
	["EntityPropertiesSetStringAddressProperty", "\"SetEntityPropertyStringAddress failed with a native C++ exception.\""],
	["MakeEntityPropertiesSendPropertyObject", "EntityPropertiesIsRecordStorageRangeValid(pSendProperty, sizeof(SendProp), alignof(SendProp))"],
	["MakeEntityPropertiesSendPropertyObject", "EntityPropertiesIsSendTableStorageValid(pOwningSendTable)"],
	["MakeEntityPropertiesSendPropertyObject", "SetRecordProperty(pIsolate, LocalContext, LocalSendPropertyObject, \"Path\", MakeString(pIsolate, strPropertyPath))"],
	["MakeEntityPropertiesSendTableObject", "LocalPropertiesArray->CreateDataProperty(LocalContext, unPropertyIndex, LocalSendPropertyObject)"],
	["MakeEntityPropertiesServerClassObject", "EntityPropertiesIsRecordStorageRangeValid(pServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["MakeEntityPropertiesServerClassObject", "SetRecordProperty(pIsolate, LocalContext, LocalServerClassObject, \"NextAddress\", LocalNextServerClassAddressValue)"],
	["CollectEntityProperties", "EntityPropertiesIsSendTableStorageValid(pCurrentSendTable)"],
	["CollectEntityProperties", "LocalPropertiesArray->CreateDataProperty(LocalContext, unPropertyWriteIndex, LocalSendPropertyObject)"],
	["InstallEntityPropertiesConstants", "SetRecordProperty(pIsolate, LocalContext, LocalSendPropertyTypes, TypeBinding.m_pszName, v8::Integer::New(pIsolate, TypeBinding.m_nValue))"],
	["InstallEntityPropertiesConstants", "SetRecordProperty(pIsolate, LocalContext, LocalEntityPropertiesObject, FlagBinding.m_pszLegacyName, v8::Integer::New(pIsolate, FlagBinding.m_nValue))"],
	["ComputeEntityPropertiesFieldAddress", "static_assert(sizeof(int) <= sizeof(std::uintptr_t));"],
	["ComputeEntityPropertiesFieldAddress", "-static_cast<std::int64_t>(nPropertyOffset)"],
	["ComputeEntityPropertiesFieldAddress", "unOffset > (kMaximumAddress - unEntityAddress)"],
	["ComputeEntityPropertiesFieldAddress", "unOffsetMagnitude > unEntityAddress"],
	["ComputeEntityPropertiesFieldAddress", "if (unFieldAddress == 0) {"],
	["GetEntityPropertiesPropertyAddressFromValues", "v8::TryCatch PropertyReadFailure(pIsolate);"],
	["GetEntityPropertiesPropertyAddressFromValues", "PropertyReadFailure.ReThrow();"],
	["GetEntityPropertiesPropertyAddressFromValues", "} catch (...) {\n\t\t\t\tif (PropertyReadFailure.HasCaught()) {\n\t\t\t\t\tPropertyReadFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;\n\t\t\t}"],
	["GetEntityPropertiesPropertyAddressFromValues", "ComputeEntityPropertiesFieldAddress(pTargetBaseEntity, nPropertyOffset, pchFieldAddress)"],
	["GetEntityPropertiesPropertyAddressFromValues", "ComputeEntityPropertiesFieldAddress(pTargetBaseEntity, PropertyInformation.m_nPropertyOffset, pchFieldAddress)"],
	["GetEntityPropertiesPropertyAddressFromValues", "EntityPropertiesPropertyInformation PropertyInformation {};"],
	["GetEntityPropertiesPropertyAddressFromValues", "PropertyInformationOut = std::move(PropertyInformation);"],
	["ReadEntityPropertiesScalarValue", "EntityPropertiesIsRecordStorageRangeValid(pFieldStorage, sizeof(T), alignof(unsigned char))"],
	["ReadEntityPropertiesScalarValue", "std::memcpy(&Value, pFieldStorage, sizeof(Value));"],
	["EntityPropertiesGetNumberFromValue", "if constexpr (std::is_integral_v<T> && (sizeof(T) >= sizeof(std::uint64_t))) {\n\t\t\t\treturn false;\n\n\t\t\t} else {"],
	["WriteEntityPropertiesScalarValue", "EntityPropertiesIsRecordStorageRangeValid(pFieldStorage, sizeof(T), alignof(unsigned char))"],
	["WriteEntityPropertiesScalarValue", "std::memcpy(pFieldStorage, &Value, sizeof(Value));"],
	["ReadEntityPropertiesBooleanValue", "static_assert(sizeof(bool) == sizeof(unsigned char)"],
	["ReadEntityPropertiesBooleanValue", "EntityPropertiesIsRecordStorageRangeValid(pFieldStorage, sizeof(bool), alignof(unsigned char))"],
	["ReadEntityPropertiesBooleanValue", "std::memcpy(&unRawValue, pFieldStorage, sizeof(unRawValue));"],
	["ReadEntityPropertiesBooleanValue", "std::memcpy(&unFalseRepresentation, &kFalseValue, sizeof(unFalseRepresentation));"],
	["ReadEntityPropertiesBooleanValue", "std::memcpy(&unTrueRepresentation, &kTrueValue, sizeof(unTrueRepresentation));"],
	["ReadEntityPropertiesBooleanValue", "if (unRawValue == unFalseRepresentation) {"],
	["ReadEntityPropertiesBooleanValue", "if (unRawValue == unTrueRepresentation) {"],
	["EntityPropertiesGetSignedProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["EntityPropertiesGetSignedProperty", "} catch (...) {"],
	["EntityPropertiesGetSignedProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetUnsignedProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, unPropertyValue)"],
	["EntityPropertiesGetUnsignedProperty", "} catch (...) {"],
	["EntityPropertiesGetUnsignedProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetSignedProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["EntityPropertiesSetSignedProperty", "} catch (...) {"],
	["EntityPropertiesSetSignedProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetUnsignedProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, unPropertyValue)"],
	["EntityPropertiesSetUnsignedProperty", "} catch (...) {"],
	["EntityPropertiesSetUnsignedProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetBooleanProperty", "ReadEntityPropertiesBooleanValue(pchResolvedPropertyAddress, bPropertyValue)"],
	["EntityPropertiesGetBooleanProperty", "} catch (...) {"],
	["EntityPropertiesGetBooleanProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetBooleanProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, bPropertyValue)"],
	["EntityPropertiesSetBooleanProperty", "} catch (...) {"],
	["EntityPropertiesSetBooleanProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetCharacterProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, chCharacterValue)"],
	["EntityPropertiesGetCharacterProperty", "} catch (...) {"],
	["EntityPropertiesGetCharacterProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetCharacterProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, chCharacterValue)"],
	["EntityPropertiesSetCharacterProperty", "} catch (...) {"],
	["EntityPropertiesSetCharacterProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetFloatProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, flPropertyValue)"],
	["EntityPropertiesGetFloatProperty", "} catch (...) {"],
	["EntityPropertiesGetFloatProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetFloatProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, flPropertyValue)"],
	["EntityPropertiesSetFloatProperty", "} catch (...) {"],
	["EntityPropertiesSetFloatProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetDoubleProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, dblPropertyValue)"],
	["EntityPropertiesGetDoubleProperty", "} catch (...) {"],
	["EntityPropertiesGetDoubleProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetDoubleProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, dblPropertyValue)"],
	["EntityPropertiesSetDoubleProperty", "} catch (...) {"],
	["EntityPropertiesSetDoubleProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetStringArrayProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(char), alignof(char))"],
	["EntityPropertiesGetStringArrayProperty", "} catch (...) {"],
	["EntityPropertiesGetStringArrayProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetStringArrayProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, unBufferSize, alignof(char))"],
	["EntityPropertiesSetStringArrayProperty", "const std::size_t unPropertyLength = std::min(strPropertyValue.size(), strPropertyValue.find('\\0'));"],
	["EntityPropertiesSetStringArrayProperty", "const std::size_t unCopyLength = std::min(unPropertyLength, unMaximumCopyLength);"],
	["EntityPropertiesSetStringArrayProperty", "std::memcpy(pchResolvedPropertyAddress, strPropertyValue.data(), unCopyLength);"],
	["EntityPropertiesSetStringArrayProperty", "std::memset(pchResolvedPropertyAddress + unCopyLength, 0, unBufferSize - unCopyLength);"],
	["EntityPropertiesGetStringAddressProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(char const*), alignof(unsigned char))"],
	["EntityPropertiesGetStringAddressProperty", "std::memcpy(&pszPropertyValue, pchResolvedPropertyAddress, sizeof(pszPropertyValue));"],
	["EntityPropertiesGetAddressProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, unAddress)"],
	["EntityPropertiesSetAddressProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, unAddress)"],
	["EntityPropertiesGetAddressProperty", "static_assert(sizeof(std::uintptr_t) == sizeof(void*)"],
	["EntityPropertiesSetAddressProperty", "static_assert(sizeof(std::uintptr_t) == sizeof(void*)"],
	["EntityPropertiesGetVectorComponentAddress", "EntityPropertiesIsRecordStorageRangeValid(pVectorComponentAddress, sizeof(float), alignof(float))"],
	["EntityPropertiesGetVectorComponentProperty", "ReadEntityPropertiesScalarValue(pflVectorComponentAddress, flComponentValue)"],
	["EntityPropertiesSetVectorComponentProperty", "WriteEntityPropertiesScalarValue(pflVectorComponentAddress, flComponentValue)"],
	["EntityPropertiesInstallVectorComponentProperty", "EntityPropertiesIsRecordStorageRangeValid(pflVectorComponentAddress, sizeof(float), alignof(float))"],
	["EntityPropertiesMakeVectorPropertyObject", "EntityPropertiesIsRecordStorageRangeValid(pflVectorComponentsAddress, unVectorByteCount, alignof(float))"],
	["EntityPropertiesMakeVectorPropertyObject", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"Address\", LocalVectorAddress)"],
	["EntityPropertiesMakeVectorPropertyObject", "reinterpret_cast<float*>(unVectorAddress + sizeof(float))"],
	["EntityPropertiesMakeVectorPropertyObject", "reinterpret_cast<float*>(unVectorAddress + kVectorXYByteCount)"],
	["EntityPropertiesSetVectorProperty", "std::is_standard_layout_v<Vector>"],
	["EntityPropertiesSetVectorProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, unVectorByteCount, unRequiredAlignment)"],
	["EntityPropertiesSetVectorProperty", "std::memcpy(pchResolvedPropertyAddress, arrVectorComponents, unVectorByteCount);"],
	["InstallEntityCollisionConstantBindings", "SetRecordProperty(pIsolate, LocalContext, LocalDestination, BindingInformation.m_pszName, v8::Integer::New(pIsolate, BindingInformation.m_nValue))"],
	["FindEntityCollisionPropertyNameValue", "v8::TryCatch EntityResolutionFailure(pIsolate);"],
	["FindEntityCollisionPropertyNameValue", "EntityResolutionFailure.ReThrow();"],
	["FindEntityCollisionPropertyNameValue", "EntityPropertiesIsRecordStorageRangeValid(pServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["FindEntityCollisionPropertyNameValue", "EntityPropertiesIsSendTableStorageValid(pServerClass->m_pTable)"],
	["FindEntityCollisionPropertyNameValue", "} catch (...) {"],
	["FindEntityCollisionPropertyNameValue", "throw;"],
	["GetEntityCollisionIntegerProperty", "EntityPropertiesGetSignedProperty<TField>(CallbackInformation, LocalEntityValue, LocalPropertyNameValue);"],
	["GetEntityCollisionIntegerProperty", "EntityPropertiesGetUnsignedProperty<TField>(CallbackInformation, LocalEntityValue, LocalPropertyNameValue);"],
	["SetEntityCollisionIntegerProperty", "EntityPropertiesSetSignedProperty<TField>(CallbackInformation, LocalEntityValue, LocalPropertyNameValue, LocalSetValue);"],
	["SetEntityCollisionIntegerProperty", "EntityPropertiesSetUnsignedProperty<TField>(CallbackInformation, LocalEntityValue, LocalPropertyNameValue, LocalSetValue);"],
	["GetEntityCollisionGroupCallback", "GetEntityCollisionIntegerProperty<int>(CallbackInformation, kEntityCollisionGroupProperties);"],
	["SetEntityCollisionGroupCallback", "SetEntityCollisionIntegerProperty<int>(CallbackInformation, kEntityCollisionGroupProperties);"],
	["GetEntitySolidTypeCallback", "GetEntityCollisionIntegerProperty<unsigned char>(CallbackInformation, kEntitySolidTypeProperties);"],
	["SetEntitySolidTypeCallback", "SetEntityCollisionIntegerProperty<unsigned char>(CallbackInformation, kEntitySolidTypeProperties);"],
	["GetEntitySolidFlagsCallback", "GetEntityCollisionIntegerProperty<unsigned short>(CallbackInformation, kEntitySolidFlagsProperties);"],
	["SetEntitySolidFlagsCallback", "SetEntityCollisionIntegerProperty<unsigned short>(CallbackInformation, kEntitySolidFlagsProperties);"],
	["EntityPropertiesSetEntityHandleProperty", "throw;"],
	["EntityPropertiesSetStringArrayProperty", "} catch (...) {"],
	["EntityPropertiesSetStringArrayProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetStringAddressProperty", "} catch (...) {"],
	["EntityPropertiesGetStringAddressProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetAddressProperty", "} catch (...) {"],
	["EntityPropertiesGetAddressProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetAddressProperty", "} catch (...) {"],
	["EntityPropertiesSetAddressProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetVectorComponentProperty", "} catch (...) {"],
	["EntityPropertiesGetVectorComponentProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetVectorComponentProperty", "} catch (...) {"],
	["EntityPropertiesSetVectorComponentProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetVectorProperty", "} catch (...) {"],
	["EntityPropertiesGetVectorProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetVectorProperty", "} catch (...) {"],
	["EntityPropertiesSetVectorProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetEntityCollisionConstantsCallback", "} catch (...) {"],
	["GetEntityCollisionConstantsCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetEntityCollisionIntegerProperty", "} catch (...) {"],
	["GetEntityCollisionIntegerProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetEntityHandleProperty", "EntityHandleStorage unEntityHandleValue = 0;"],
	["EntityPropertiesGetEntityHandleProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, unEntityHandleValue)"],
	["EntityPropertiesGetEntityHandleProperty", "GetEntityIndexFromBaseHandleValue(EntityHandle, nEntityIndex)"],
	["EntityPropertiesSetEntityHandleProperty", "const EntityHandleStorage unEntityHandleValue = EntityHandle.*(&EntityHandleStorageAccess::m_Index);"],
	["EntityPropertiesSetEntityHandleProperty", "v8::TryCatch HandleResolutionFailure(pIsolate);"],
	["EntityPropertiesSetEntityHandleProperty", "HandleResolutionFailure.ReThrow();"],
	["EntityPropertiesSetEntityHandleProperty", "CBaseHandle PropertyEntityHandle {};"],
	["EntityPropertiesSetEntityHandleProperty", "CBaseEntity* pPropertyBaseEntity = nullptr;"],
	["EntityPropertiesSetEntityHandleProperty", "bHasResolvedPropertyInformation, &PropertyEntityHandle, &pPropertyBaseEntity)"],
	["EntityPropertiesSetEntityHandleProperty", "if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pPropertyBaseEntity)) {"],
	["EntityPropertiesSetEntityHandleProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(CBaseHandle), alignof(CBaseHandle))"],
	["EntityPropertiesSetEntityHandleProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, unEntityHandleValue)"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(float), alignof(float))"],
	["EntityPropertiesGetGenericProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, flPropertyValue)"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(int), alignof(int))"],
	["EntityPropertiesGetGenericProperty", "GetEntityPropertiesIntegerStorageTypeFromEngine(pEngineServer, ResolvedPropertyInformation.m_pProperty)"],
	["EntityPropertiesGetGenericProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["GetEntityPropertiesIntegerStorageTypeFromProxies", "ProxyFunction == StandardProxies.m_Int8ToInt32"],
	["GetEntityPropertiesIntegerStorageTypeFromProxies", "ProxyFunction == StandardProxies.m_UInt16ToInt32"],
	["GetEntityPropertiesIntegerStorageTypeFromProxies", "ProxyFunction == StandardProxies.m_Int64ToInt64"],
	["GetEntityPropertiesIntegerStorageTypeFromProxies", "ProxyFunction == StandardProxies.m_UInt64ToInt64"],
	["GetEntityPropertiesIntegerStorageTypeFromEngine", "pEngineServer->GetStandardSendProxies()"],
	["GetEntityPropertiesIntegerStorageTypeFromEngine", "pProperty->GetProxyFn()"],
	["EntityPropertiesGetInferredIntegerProperty", "ReadEntityPropertiesScalarValue(pchPropertyAddress, PropertyValue)"],
	["EntityPropertiesGetInferredIntegerProperty", "v8::BigInt::NewFromUnsigned"],
	["EntityPropertiesSetInferredIntegerProperty", "WriteEntityPropertiesScalarValue(pchPropertyAddress, PropertyValue)"],
	["EntityPropertiesSetInferredIntegerProperty", "64-bit fields require BigInt."],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::int8_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::uint8_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::int16_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::uint16_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::int32_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::uint32_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::int64_t>"],
	["EntityPropertiesGetGenericProperty", "EntityPropertiesGetInferredIntegerProperty<std::uint64_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::int8_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::uint8_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::int16_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::uint16_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::int32_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::uint32_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::int64_t>"],
	["EntityPropertiesSetGenericProperty", "EntityPropertiesSetInferredIntegerProperty<std::uint64_t>"],
	["EntityPropertiesSetGenericProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, flPropertyValue)"],
	["EntityPropertiesSetGenericProperty", "GetEntityPropertiesIntegerStorageTypeFromEngine(pEngineServer, ResolvedPropertyInformation.m_pProperty)"],
	["EntityPropertiesSetGenericProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["SetEntityCollisionIntegerProperty", "} catch (...) {"],
	["SetEntityCollisionIntegerProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetEntityCollisionVectorProperty", "} catch (...) {"],
	["GetEntityCollisionVectorProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["SetEntityCollisionVectorProperty", "} catch (...) {"],
	["SetEntityCollisionVectorProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetEntityHandleProperty", "} catch (...) {"],
	["EntityPropertiesGetEntityHandleProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetEntityHandleProperty", "} catch (...) {"],
	["EntityPropertiesSetEntityHandleProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesGetGenericProperty", "} catch (...) {"],
	["EntityPropertiesGetGenericProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["EntityPropertiesSetGenericProperty", "} catch (...) {"],
	["EntityPropertiesSetGenericProperty", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetServerClassesCallback", "} catch (...) {"],
	["GetServerClassesCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["FindServerClassByNameCallback", "} catch (...) {"],
	["FindServerClassByNameCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["FindServerClassByNameCallback", "entities/props.FindServerClassByName(strServerClassName) expects a class name."],
	["FindServerClassByNameCallback", "entities/props.FindServerClassByName()"],
	["FindServerClassByNameCallback", "entities/props.FindServerClassByName(strServerClassName) expects a non-empty class name."],
	["GetSendTableCallback", "} catch (...) {"],
	["GetSendTableCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetServerClassPropertyCallback", "} catch (...) {"],
	["GetServerClassPropertyCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetServerClassPropertyCallback", "GetServerClassProperty(Reference, PropertySelector) requires a table or server class and a property selector."],
	["GetServerClassPropertyCallback", "RequireServerGameDLL(pIsolate, \"GetServerClassProperty(Reference, PropertySelector)\")"],
	["GetServerClassPropertyCallback", "GetServerClassProperty(Reference, PropertySelector) requires an integer property index."],
	["GetServerClassPropertyCallback", "GetServerClassProperty(Reference, PropertySelector) requires a non-empty property name or integer index."],
	["GetServerClassPropertiesCallback", "} catch (...) {"],
	["GetServerClassPropertiesCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetServerClassPropertiesCallback", "constexpr char kCollectionErrorMessage[] = \"GetServerClassProperties could not collect a complete valid property array.\";"],
	["GetServerClassPropertiesCallback", "if (!CollectEntityProperties(pIsolate, LocalContext, LocalProperties, unWriteIndex, pResolvedServerClass, pResolvedSendTable, 0, \"\", 0)) {\n\t\t\t\t\tThrowError(pIsolate, kCollectionErrorMessage);"],
	["FindServerClassPropertyOffsetCallback", "} catch (...) {"],
	["FindServerClassPropertyOffsetCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["FindServerClassPropertyOffsetCallback", "entities/props.FindServerClassPropertyOffset(Reference, strPropertyName) expects a reference and property name."],
	["FindServerClassPropertyOffsetCallback", "entities/props.FindServerClassPropertyOffset(Reference, strPropertyName) expects a non-empty property name."],
	["GetEntityServerClassCallback", "} catch (...) {"],
	["GetEntityServerClassCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetEntitySendTableCallback", "} catch (...) {"],
	["GetEntitySendTableCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetEntitySendPropertyCallback", "} catch (...) {"],
	["GetEntitySendPropertyCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["CreateEntityPropertyVariantCallback", "} catch (...) {"],
	["CreateEntityPropertyVariantCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetServerClassesCallback", "EntityPropertiesServerClassTraversal Traversal"],
	["GetServerClassesCallback", "EntityPropertiesIsRecordStorageRangeValid(pCurrentServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["GetServerClassesCallback", "unWriteIndex == kInvalidArrayIndex"],
	["GetServerClassesCallback", "LocalServerClasses->CreateDataProperty(LocalContext, unWriteIndex, LocalServerClass)"],
	["GetServerClassesCallback", "AdvanceEntityPropertiesServerClassTraversal(Traversal)"],
	["GetEntitySendTableCallback", "EntityPropertiesIsRecordStorageRangeValid(pEntityServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["GetEntitySendPropertyCallback", "EntityPropertiesIsRecordStorageRangeValid(pEntityServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["CreateEntityPropertyVariantCallback", "SetRecordProperty(pIsolate, LocalContext, LocalVariant, \"Type\", MakeString(pIsolate, strPropertyType))"],
	["CreateEntityPropertyVariantCallback", "SetRecordProperty(pIsolate, LocalContext, LocalVariant, \"Value\", LocalPropertyValue)"],
	["CreateEntityPropertyVariantCallback", "SetRecordProperty(pIsolate, LocalContext, LocalVariant, \"Value\", v8::Null(pIsolate))"],
	["GetEntityPropertyCallback", "GetEntityProperty(Entity, PropertyReference, strPropertyType?) expects an entity and property."],
	["SetEntityPropertyCallback", "SetEntityProperty(Entity, PropertyReference, Value, strPropertyType?) expects an entity, property and value."],
	["GetEntityPropertyBooleanCallback", "GetEntityPropertyBoolean(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyBooleanCallback", "SetEntityPropertyBoolean(Entity, PropertyReference, bValue) expects an entity, property and value."],
	["GetEntityPropertyCharacterCallback", "GetEntityPropertyCharacter(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyCharacterCallback", "SetEntityPropertyCharacter(Entity, PropertyReference, chValue) expects an entity, property and value."],
	["GetEntityPropertyUnsignedCharacterCallback", "GetEntityPropertyUnsignedCharacter(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyUnsignedCharacterCallback", "SetEntityPropertyUnsignedCharacter(Entity, PropertyReference, unValue) expects an entity, property and value."],
	["GetEntityPropertyShortCallback", "GetEntityPropertyShort(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyShortCallback", "SetEntityPropertyShort(Entity, PropertyReference, nValue) expects an entity, property and value."],
	["GetEntityPropertyUnsignedShortCallback", "GetEntityPropertyUnsignedShort(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyUnsignedShortCallback", "SetEntityPropertyUnsignedShort(Entity, PropertyReference, unValue) expects an entity, property and value."],
	["GetEntityPropertyIntegerCallback", "GetEntityPropertyInteger(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyIntegerCallback", "SetEntityPropertyInteger(Entity, PropertyReference, nValue) expects an entity, property and value."],
	["EntityPropertiesTryGetIntegerPropertyAddress", "EntityResolutionFailure.HasCaught()"],
	["EntityPropertiesTryGetIntegerPropertyAddress", "EntityResolutionFailure.ReThrow()"],
	["EntityPropertiesTryGetIntegerPropertyAddress", "} catch (...) {\n\t\t\t\t\tif (EntityResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["EntityPropertiesGetNamedIntegerProperty", "EntityPropertiesGetGenericProperty(CallbackInformation, LocalEntityValue, LocalPropertyName, v8::Undefined(pIsolate));"],
	["EntityPropertiesSetNamedIntegerProperty", "EntityPropertiesSetGenericProperty(CallbackInformation, LocalEntityValue, LocalPropertyName, LocalSetValue, v8::Undefined(pIsolate));"],
	["PlayersGetPropertyNamesFromValue", "} catch (...) {\n\t\t\t\tif (PropertyNamesFailure.HasCaught()) {\n\t\t\t\t\tPropertyNamesFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;\n\t\t\t}"],
	["PlayersRequirePropertyAddressFromArguments", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["PlayersRequirePropertyAddressFromArguments", "} catch (...) {\n\t\t\t\t\t\tif (PropertyNamesFailure.HasCaught()) {\n\t\t\t\t\t\t\tPropertyNamesFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["PlayersRequirePropertyAddressFromArguments", "CBaseHandle const PlayerHandle = GetLiveEntityHandle(pPlayerEntity);"],
	["PlayersRequirePropertyAddressFromArguments", "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)"],
	["PlayersRequirePropertyAddressFromArguments", "pPlayerEntity = GetBaseEntityFromIndex(nResolvedPlayerIndex);"],
	["PlayersRequirePropertyAddressFromArguments", "Player identity changed while reading property names."],
	["DropPlayerWeaponCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["DropPlayerWeaponCallback", "} catch (...) {\n\t\t\t\t\t\tif (WeaponResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tWeaponResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["DropPlayerWeaponCallback", "CBaseHandle const PlayerHandle = pPlayerBaseEntity->GetRefEHandle();"],
	["DropPlayerWeaponCallback", "CBaseHandle const WeaponHandle = pWeaponBaseEntity->GetRefEHandle();"],
	["DropPlayerWeaponCallback", "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)"],
	["DropPlayerWeaponCallback", "GetEntityIndexFromBaseHandleValue(WeaponHandle, nResolvedWeaponIndex)"],
	["DropPlayerWeaponCallback", "RequirePlayerInformationFromIndex(pIsolate, nResolvedPlayerIndex, nullptr, kOperationName)"],
	["DropPlayerWeaponCallback", "auto* const pLivePlayerBaseEntity = GetBaseEntityFromIndex(nResolvedPlayerIndex);"],
	["DropPlayerWeaponCallback", "auto* const pLiveWeaponBaseEntity = GetBaseEntityFromIndex(nResolvedWeaponIndex);"],
	["DropPlayerWeaponCallback", "PlayersIsCombatWeapon(pLiveWeaponBaseEntity)"],
	["DropPlayerWeaponCallback", "static_cast<CBasePlayer*>(pLivePlayerBaseEntity)"],
	["DropPlayerWeaponCallback", "static_cast<CBaseCombatWeapon*>(pLiveWeaponBaseEntity)"],
	["GetCounterStrikePlayerCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["DoesCounterStrikePlayerHaveC4Callback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["PlayersGetActiveWeaponAddress", "} catch (...) {\n\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["SetPlayerActiveWeaponCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["SetPlayerActiveWeaponCallback", "} catch (...) {\n\t\t\t\t\t\tif (WeaponResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tWeaponResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["GetPlayerWeaponIndicesCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["GetPlayerProjectileIndicesCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["PlayersGetIntegerSendPropertyAddress", "} catch (...) {\n\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["SetPlayerVectorPropertyCallback", "} catch (...) {\n\t\t\t\t\t\tif (VectorConversionFailure.HasCaught()) {\n\t\t\t\t\t\t\tVectorConversionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["PlayersReadNativeIntegerProperty", "} catch (...) {\n\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["PlayersReadNativeHandlePresence", "} catch (...) {\n\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["IsPlayerHLTVCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["IsPlayerObserverCallback", "} catch (...) {\n\t\t\t\t\t\tif (PlayerResolutionFailure.HasCaught()) {\n\t\t\t\t\t\t\tPlayerResolutionFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;\n\t\t\t\t\t}"],
	["IsPlayerObserverCallback", "LocalResolvedPlayerValue = v8::Integer::New(pIsolate, nPlayerEntityIndex)"],
	["IsPlayerObserverCallback", "LocalContext, LocalResolvedPlayerValue, vecObserverModePropertyNames"],
	["IsPlayerObserverCallback", "LocalContext, LocalResolvedPlayerValue, vecObserverTargetPropertyNames"],
	["SetPlayerActiveWeaponCallback", "CBaseHandle const PlayerHandle = GetLiveEntityHandle(pPlayerBaseEntity);"],
	["SetPlayerActiveWeaponCallback", "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)"],
	["SetPlayerActiveWeaponCallback", "GetEntityIndexFromBaseHandleValue(ActiveWeaponHandle, nResolvedWeaponIndex)"],
	["SetPlayerActiveWeaponCallback", "pPlayerBaseEntity = GetBaseEntityFromIndex(nResolvedPlayerIndex);"],
	["SetPlayerActiveWeaponCallback", "const int nWeaponEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalWeaponValue);"],
	["GetPlayerWeaponIndicesCallback", "CBaseHandle const PlayerHandle = GetLiveEntityHandle(pPlayerBaseEntity);"],
	["GetPlayerWeaponIndicesCallback", "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)"],
	["GetPlayerWeaponIndicesCallback", "pPlayerBaseEntity = GetBaseEntityFromIndex(nResolvedPlayerIndex);"],
	["GetPlayerWeaponIndicesCallback", "strPropertyPrefix.find('\\0') != std::string::npos"],
	["GetPlayerWeaponIndicesCallback", "LocalWeaponIndicesArray->CreateDataProperty(LocalContext, unWeaponIndexCount, LocalWeaponIndexValue)"],
	["GetPlayerProjectileIndicesCallback", "LocalProjectileIndicesArray->CreateDataProperty(LocalContext, unProjectileIndexCount, LocalProjectileIndexValue)"],
	["PlayersGetIntegerSendPropertyAddress", "CBaseHandle const PlayerHandle = GetLiveEntityHandle(pPlayerBaseEntity);"],
	["PlayersGetIntegerSendPropertyAddress", "GetEntityIndexFromBaseHandleValue(PlayerHandle, nResolvedPlayerIndex)"],
	["PlayersGetIntegerSendPropertyAddress", "pPlayerBaseEntity = GetBaseEntityFromIndex(nResolvedPlayerIndex);"],
	["PlayersGetIntegerSendPropertyAddress", "strPropertyName.find('\\0') != std::string::npos"],
	["EntityPropertiesTryGetIntegerPropertyAddress", "EntityPropertiesIsRecordStorageRangeValid(pEntityServerClass, sizeof(ServerClass), alignof(ServerClass))"],
	["EntityPropertiesTryGetIntegerPropertyAddress", "EntityPropertiesIsSendTableStorageValid(pEntityServerClass->m_pTable)"],
	["EntityPropertiesTryGetIntegerPropertyAddress", "EntityPropertiesIsRecordStorageRangeValid(pchPropertyAddress, sizeof(int), alignof(unsigned char))"],
	["EntityPropertiesTryReadIntegerProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["EntityPropertiesWriteIntegerProperty", "WriteEntityPropertiesScalarValue(pchResolvedPropertyAddress, nPropertyValue)"],
	["EntityPropertiesGetOwnerEntityValueFromProperty", "EntityHandleStorage unOwnerEntityHandleValue = 0;"],
	["EntityPropertiesGetOwnerEntityValueFromProperty", "ReadEntityPropertiesScalarValue(pchResolvedPropertyAddress, unOwnerEntityHandleValue)"],
	["EntityPropertiesGetOwnerEntityValueFromProperty", "GetEntityIndexFromBaseHandleValue(OwnerEntityHandle, nOwnerEntityIndex)"],
	["WeaponsWritePrimaryAmmoCount", "WriteEntityPropertiesScalarValue(pchResolvedReservePropertyAddress, nAmmoCount)"],
	["GetWeaponAmmoCountCallback", "} catch (...) {"],
	["GetWeaponAmmoCountCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["SetWeaponAmmoCountCallback", "} catch (...) {"],
	["SetWeaponAmmoCountCallback", "ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"],
	["GetWeaponAmmoCountCallback", "GetAmmo(WeaponReference) expects"],
	["SetWeaponAmmoCountCallback", "SetAmmo(WeaponReference, nAmmo) expects"],
	["GetEntityPropertyUnsignedIntegerCallback", "GetEntityPropertyUnsignedInteger(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyUnsignedIntegerCallback", "SetEntityPropertyUnsignedInteger(Entity, PropertyReference, unValue) expects an entity, property and value."],
	["GetEntityPropertyLongCallback", "GetEntityPropertyLong(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyLongCallback", "SetEntityPropertyLong(Entity, PropertyReference, nValue) expects an entity, property and value."],
	["GetEntityPropertyUnsignedLongCallback", "GetEntityPropertyUnsignedLong(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyUnsignedLongCallback", "SetEntityPropertyUnsignedLong(Entity, PropertyReference, unValue) expects an entity, property and value."],
	["GetEntityPropertyLongLongCallback", "GetEntityPropertyLongLong(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyLongLongCallback", "SetEntityPropertyLongLong(Entity, PropertyReference, nValue) expects an entity, property and value."],
	["GetEntityPropertyUnsignedLongLongCallback", "GetEntityPropertyUnsignedLongLong(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyUnsignedLongLongCallback", "SetEntityPropertyUnsignedLongLong(Entity, PropertyReference, unValue) expects an entity, property and value."],
	["GetEntityPropertyFloatCallback", "GetEntityPropertyFloat(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyFloatCallback", "SetEntityPropertyFloat(Entity, PropertyReference, flValue) expects an entity, property and value."],
	["GetEntityPropertyDoubleCallback", "GetEntityPropertyDouble(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyDoubleCallback", "SetEntityPropertyDouble(Entity, PropertyReference, dblValue) expects an entity, property and value."],
	["GetEntityPropertyStringAddressCallback", "GetEntityPropertyStringAddress(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyStringAddressCallback", "SetEntityPropertyStringAddress(Entity, PropertyReference, strValue) expects an entity, property and value."],
	["GetEntityPropertyStringArrayCallback", "GetEntityPropertyStringArray(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyStringArrayCallback", "SetEntityPropertyStringArray(Entity, PropertyReference, strValue) expects an entity, property and value."],
	["GetEntityPropertyAddressCallback", "GetEntityPropertyAddress(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyAddressCallback", "SetEntityPropertyAddress(Entity, PropertyReference, unAddress) expects an entity, property and value."],
	["GetEntityPropertyVectorCallback", "GetEntityPropertyVector(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyVectorCallback", "SetEntityPropertyVector(Entity, PropertyReference, Vector) expects an entity, property and value."],
	["GetEntityPropertyEntityCallback", "GetEntityPropertyEntity(Entity, PropertyReference) expects an entity and property."],
	["SetEntityPropertyEntityCallback", "SetEntityPropertyEntity(Entity, PropertyReference, EntityReference) expects an entity, property and value."],
	["EntityPropertiesGetEntityPropertyMethodCallback", "Entity.GetEntityProperty(PropertyReference, strPropertyType?) expects a property."],
	["EntityPropertiesSetEntityPropertyMethodCallback", "Entity.SetEntityProperty(PropertyReference, PropertyValue, strPropertyType?) expects a property and value."],
	["EntityPropertiesGetEntityPropertyIntegerMethodCallback", "Entity.GetEntityPropertyInteger(PropertyReference) expects a property."],
	["EntityPropertiesSetEntityPropertyIntegerMethodCallback", "Entity.SetEntityPropertyInteger(PropertyReference, nPropertyValue) expects a property and value."],
	["EntityPropertiesGetEntityPropertyFloatMethodCallback", "Entity.GetEntityPropertyFloat(PropertyReference) expects a property."],
	["EntityPropertiesSetEntityPropertyFloatMethodCallback", "Entity.SetEntityPropertyFloat(PropertyReference, flPropertyValue) expects a property and value."],
	["EntityPropertiesGetEntityPropertyStringMethodCallback", "Entity.GetEntityPropertyString(PropertyReference) expects a property."],
	["EntityPropertiesSetEntityPropertyStringMethodCallback", "Entity.SetEntityPropertyString(PropertyReference, strPropertyValue) expects a property and value."],
	["EntityPropertiesGetEntityPropertyVectorMethodCallback", "Entity.GetEntityPropertyVector(PropertyReference) expects a property."],
	["EntityPropertiesSetEntityPropertyVectorMethodCallback", "Entity.SetEntityPropertyVector(PropertyReference, VectorValue) expects a property and value."],
	["EntityPropertiesGetEntityPropertyEntityMethodCallback", "Entity.GetEntityPropertyEntity(PropertyReference) expects a property."],
	["EntityPropertiesSetEntityPropertyEntityMethodCallback", "Entity.SetEntityPropertyEntity(PropertyReference, EntityReference) expects a property and value."],
	["InstallEntityPropertiesBindings", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityPropertiesObject, FunctionBinding.m_pszFunctionName, FunctionBinding.m_Callback, LocalRuntimeData)) {\n\t\t\t\t\treturn false;\n\t\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetServerClasses\", GetServerClassesCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"FindServerClassByName\", FindServerClassByNameCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"FindServerClass\", FindServerClassByNameCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetEntityServerClass\", GetEntityServerClassCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetServerClassSendTable\", GetEntitySendTableCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetSendTable\", GetSendTableCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetServerClassProperty\", GetServerClassPropertyCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetEntitySendProperty\", GetEntitySendPropertyCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"GetServerClassProperties\", GetServerClassPropertiesCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEntityClassReflectionFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEntityClassesModule, \"FindServerClassPropertyOffset\", FindServerClassPropertyOffsetCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
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

const g_strSourcePath = g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp");
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
let g_unRejectedMutations = 0;

function ExtractDefinition(strSource, strFunctionName) {
	const strNeedle = strFunctionName + "(";
	const SignaturePattern = new RegExp(`^(\\t+)[^()\\n;{}]*\\b${strFunctionName}\\([^\\n]*\\)(?: noexcept)? \\{$`);
	let unSearchOffset = 0;
	while (true) {
		const nNamePosition = strSource.indexOf(strNeedle, unSearchOffset);
		if (nNamePosition === -1) {
			break;
		}

		const unLineStart = strSource.lastIndexOf("\n", nNamePosition) + 1;
		const nLineEnd = strSource.indexOf("\n", nNamePosition);
		if (nLineEnd === -1) {
			break;
		}

		const vecSignatureMatch = strSource.slice(unLineStart, nLineEnd).match(SignaturePattern);
		if (vecSignatureMatch !== null) {
			// Preserve the old regular expression's greedy tab capture and fallback widths.
			for (let unIndentationWidth = vecSignatureMatch[1].length; unIndentationWidth > 0; unIndentationWidth -= 1) {
				const strEndMarker = "\n" + vecSignatureMatch[1].slice(0, unIndentationWidth) + "}\n";
				const nDefinitionEnd = strSource.indexOf(strEndMarker, nLineEnd);
				if (nDefinitionEnd !== -1) {
					return strSource.slice(unLineStart, nDefinitionEnd + strEndMarker.length);
				}
			}
		}

		unSearchOffset = nNamePosition + strNeedle.length;
	}

	g_Assert.fail(`Missing definition: ${strFunctionName}`);
}

function VerifyContracts(strSource) {
	const mapDefinitions = new Map();
	const ReadDefinition = strFunctionName => {
		const strCachedDefinition = mapDefinitions.get(strFunctionName);
		if (strCachedDefinition !== undefined) {
			return strCachedDefinition;
		}

		const strDefinition = ExtractDefinition(strSource, strFunctionName);
		mapDefinitions.set(strFunctionName, strDefinition);

		return strDefinition;
	};

	for (const vecContract of g_vecContracts) {
		const strDefinition = ReadDefinition(vecContract[0]);
		g_Assert.ok(strDefinition.includes(vecContract[1]), `Missing contract: ${vecContract[0]} ${vecContract[1]}`);
	}

	g_Assert.doesNotMatch(strSource, /std::list<std::string> g_lstEntityPropertiesStringValues;/);
	g_Assert.doesNotMatch(ReadDefinition("EntityPropertiesFillPropertyInformation"), /PropertyInformationOut\./);

	for (const strFunctionName of ["MakeEntityPropertiesReflectionObject", "MakeEntityPropertiesSendTableObjectWithoutProperties", "MakeEntityPropertiesSendPropertyObject", "MakeEntityPropertiesServerClassObject", "InstallEntityPropertiesConstants"]) {
		g_Assert.doesNotMatch(ReadDefinition(strFunctionName), /\bSet(?:String|Value|Integer|Boolean)\(/);
	}

	const strResolver = ReadDefinition("ResolveEntityPropertiesServerClassAndTable");
	g_Assert.doesNotMatch(strResolver, /p(?:ServerClass|SendTable)Out = nullptr;/);
	g_Assert.ok(strResolver.indexOf("ResolutionFailure.HasCaught()") < strResolver.indexOf("GetEntityPropertiesServerClassFromValue("));

	const strFieldResolver = ReadDefinition("GetEntityPropertiesPropertyAddressFromValues");
	g_Assert.doesNotMatch(strFieldResolver, /pchPropertyAddressOut = nullptr;|pchEntityAddress \+|PropertyInformationOut\.m_nPropertyOffset/);

	for (const strFunctionName of ["FindEntityPropertiesServerClassByName", "FindEntityPropertiesServerClassByAddress", "FindEntityPropertiesSendTableByName", "GetEntityPropertiesServerClassFromEntity"]) {
		const strDefinition = ReadDefinition(strFunctionName);
		g_Assert.doesNotMatch(strDefinition.split("\n", 1)[0], /\bnoexcept\b/);
	}

	const strClassNameLookup = ReadDefinition("FindServerClassByNameCallback");
	g_Assert.doesNotMatch(strClassNameLookup, /entities\/props\.FindServerClass\(/);
	const strPropertyLookup = ReadDefinition("GetServerClassPropertyCallback");
	g_Assert.doesNotMatch(strPropertyLookup, /GetServerClassProperty\(Table, NameOrIndex\)/);
	g_Assert.equal([...strPropertyLookup.matchAll(/GetServerClassProperty\(Reference, PropertySelector\)/g)].length, 5);
	const strOffsetLookup = ReadDefinition("FindServerClassPropertyOffsetCallback");
	g_Assert.doesNotMatch(strOffsetLookup, /FindServerClassPropertyOffset\(Table, strPropertyName\)/);
	g_Assert.equal([...strOffsetLookup.matchAll(/FindServerClassPropertyOffset\(Reference, strPropertyName\)/g)].length, 2);

	const strHandleSetter = ReadDefinition("EntityPropertiesSetEntityHandleProperty");
	const nHandleTargetGuard = strHandleSetter.indexOf("if (!EntityPropertiesIsEntityCurrent(PropertyEntityHandle, pPropertyBaseEntity)) {");
	g_Assert.ok(nHandleTargetGuard > strHandleSetter.indexOf("if (!bHasEntityHandle) {"));
	g_Assert.ok(nHandleTargetGuard < strHandleSetter.indexOf("if (!EntityPropertiesIsRecordStorageRangeValid(pchResolvedPropertyAddress, sizeof(CBaseHandle), alignof(CBaseHandle))) {"));
	g_Assert.match(strHandleSetter, /if \(!EntityPropertiesIsEntityCurrent\(PropertyEntityHandle, pPropertyBaseEntity\)\) \{\n\t+ThrowError\(pIsolate, kEntityChangedErrorMessage\);\n\t+return;\n\t+\}/);
}

VerifyContracts(g_strSource);

for (const vecContract of g_vecContracts) {
	const strDefinition = ExtractDefinition(g_strSource, vecContract[0]);
	const strMutatedDefinition = strDefinition.replaceAll(vecContract[1], "/* removed contract */");
	g_Assert.notEqual(strMutatedDefinition, strDefinition, `Missing mutation anchor: ${vecContract[0]}`);

	const strMutatedSource = g_strSource.replace(strDefinition, () => strMutatedDefinition);
	g_Assert.notEqual(strMutatedSource, g_strSource, `Mutation did not change source: ${vecContract[0]}`);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError);
	++g_unRejectedMutations;
}

// Source checks do not prove engine lifetime, SDK ABI, or executable callback behavior.
console.log(`entity properties source contracts: ${g_unRejectedMutations} negative cases passed`);
