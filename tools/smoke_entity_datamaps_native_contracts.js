const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	const bShowHelp = (vecArguments.length === 1) && (vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks datamap source contracts without native V8/SDK execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSourcePath = g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp");
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
const g_vecAliasFieldTypes = ["FIELD_TIME", "FIELD_TICK", "FIELD_MODELINDEX", "FIELD_MATERIALINDEX", "FIELD_MODELNAME", "FIELD_SOUNDNAME", "FIELD_POSITION_VECTOR", "FIELD_EHANDLE"];
const g_vecNativePropertyOperations = [
	"GetSigned",
	"SetSigned",
	"GetUnsigned",
	"SetUnsigned",
	"GetBoolean",
	"SetBoolean",
	"GetChar",
	"SetChar",
	"GetFloat",
	"SetFloat",
	"GetDouble",
	"SetDouble",
	"GetStringID",
	"SetStringID",
	"GetStringArray",
	"SetStringArray",
	"GetAddress",
	"SetAddress",
	"GetVector",
	"SetVector",
	"GetColor",
	"SetColor",
	"GetInterval",
	"SetInterval",
	"GetEntity",
	"SetEntity",
	"GetGeneric",
	"SetGeneric",
];

const g_vecInputContracts = [
	["EntityDatamapsGetDatamapFromBaseEntity", "datamap_t* EntityDatamapsGetDatamapFromBaseEntity(CBaseEntity* const pBaseEntity) {"],
	["EntityDatamapsFieldInformation::EntityDatamapsFieldInformation", "m_pDatamap = nullptr;"],
	["EntityDatamapsFieldInformation::EntityDatamapsFieldInformation", "m_pTypeDescription = nullptr;"],
	["EntityDatamapsFieldInformation::EntityDatamapsFieldInformation", "m_nFieldIndex = 0;"],
	["EntityDatamapsFieldInformation::EntityDatamapsFieldInformation", "m_nFieldOffset = 0;"],
	["EntityDatamapsGetVariantHandle", "static_assert(sizeof(int) == sizeof(std::uint32_t));"],
	["FindEntityOutputNameByAddressCallback", "CallbackInformation) try {"],
	["FindEntityOutputNameByAddressCallback", "FindEntityOutputNameByAddressCallback failed with a C++ exception."],
	["EntityDatamapsGetColorComponentProperty", "PropertyInformation) try {"],
	["EntityDatamapsGetColorComponentProperty", "EntityDatamapsGetColorComponentProperty failed with a C++ exception."],
	["EntityDatamapsSetColorComponentProperty", "PropertyInformation) try {"],
	["EntityDatamapsSetColorComponentProperty", "EntityDatamapsSetColorComponentProperty failed with a C++ exception."],
	["EntityDatamapsGetFloatComponentProperty", "PropertyInformation) try {"],
	["EntityDatamapsGetFloatComponentProperty", "EntityDatamapsGetFloatComponentProperty failed with a C++ exception."],
	["EntityDatamapsSetFloatComponentProperty", "PropertyInformation) try {"],
	["EntityDatamapsSetFloatComponentProperty", "EntityDatamapsSetFloatComponentProperty failed with a C++ exception."],
	["ResolveEntityDatamapsBaseEntityFromValue", "v8::TryCatch EntityResolutionFailure(pIsolate);"],
	["ResolveEntityDatamapsBaseEntityFromValue", "pBaseEntityOut = pBaseEntity;"],
	["GetEntityDataMapPropertyColorCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyColorCallback", "EntityDatamapsGetColorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyColorCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyColorCallback", "EntityDatamapsSetColorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyIntervalCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyIntervalCallback", "EntityDatamapsGetIntervalProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyIntervalCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyIntervalCallback", "EntityDatamapsSetIntervalProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyEntityCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyEntityCallback", "EntityDatamapsGetEntityProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyEntityCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyEntityCallback", "EntityDatamapsSetEntityProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityReceiver, pTargetBaseEntity)) {"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "pTargetBaseEntity = GetEntityBaseEntityFromAddressValue(LocalEntityReceiver);"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "if (LocalDatamapObject.IsEmpty()) {"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "CallbackInformation.GetReturnValue().Set(LocalDatamapObject);"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "} catch (...) {"],
	["EntityDatamapsGetEntityDatamapMethodCallback", "\"Entity.GetEntityDataMap failed with a native C++ exception.\""],
	["EntityDatamapsGetEntityDatamapPropertyMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyMethodCallback", "EntityDatamapsGetGenericProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalPropertyTypeValue);"],
	["EntityDatamapsSetEntityDatamapPropertyMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyMethodCallback", "EntityDatamapsSetGenericProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue, LocalPropertyTypeValue);"],
	["EntityDatamapsGetEntityDatamapPropertyIntegerMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyIntegerMethodCallback", "EntityDatamapsGetSignedProperty<int>(CallbackInformation, LocalEntityReceiver, LocalPropertyValue);"],
	["EntityDatamapsSetEntityDatamapPropertyIntegerMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyIntegerMethodCallback", "EntityDatamapsSetSignedProperty<int>(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetEntityDatamapPropertyFloatMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyFloatMethodCallback", "EntityDatamapsGetFloatProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue);"],
	["EntityDatamapsSetEntityDatamapPropertyFloatMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyFloatMethodCallback", "EntityDatamapsSetFloatProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetEntityDatamapPropertyStringMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyStringMethodCallback", "EntityDatamapsGetStringIDProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue);"],
	["EntityDatamapsSetEntityDatamapPropertyStringMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyStringMethodCallback", "EntityDatamapsSetStringIDProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetEntityDatamapPropertyVectorMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyVectorMethodCallback", "EntityDatamapsGetVectorProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue);"],
	["EntityDatamapsSetEntityDatamapPropertyVectorMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyVectorMethodCallback", "EntityDatamapsSetVectorProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetEntityDatamapPropertyEntityMethodCallback", "constexpr int kRequiredArgumentCount = 1;"],
	["EntityDatamapsGetEntityDatamapPropertyEntityMethodCallback", "EntityDatamapsGetEntityProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue);"],
	["EntityDatamapsSetEntityDatamapPropertyEntityMethodCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["EntityDatamapsSetEntityDatamapPropertyEntityMethodCallback", "EntityDatamapsSetEntityProperty(CallbackInformation, LocalEntityReceiver, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityModelCallback", "constexpr char kModelNamePropertyName[] = \"m_ModelName\";"],
	["GetEntityModelCallback", "EntityDatamapsGetStringIDProperty(CallbackInformation, LocalEntityValue, LocalModelNamePropertyValue);"],
	["SetEntityDataMapPropertyEntityCallback", "\"SetEntityDataMapPropertyEntity(Entity, Property, EntityValue) expects Entity, Property, and EntityValue.\""],
	["EntityDatamapsSetEntityDatamapPropertyEntityMethodCallback", "\"Entity.SetEntityDataMapPropertyEntity(Property, EntityValue) expects Property and EntityValue.\""],
	["GetEntityDataMapPropertyCharacterCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyCharacterCallback", "EntityDatamapsGetCharProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyCharacterCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyCharacterCallback", "EntityDatamapsSetCharProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyUnsignedCharacterCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyUnsignedCharacterCallback", "EntityDatamapsGetUnsignedProperty<unsigned char>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyUnsignedCharacterCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyUnsignedCharacterCallback", "EntityDatamapsSetUnsignedProperty<unsigned char>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyShortCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyShortCallback", "EntityDatamapsGetSignedProperty<short>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyShortCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyShortCallback", "EntityDatamapsSetSignedProperty<short>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyUnsignedShortCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyUnsignedShortCallback", "EntityDatamapsGetUnsignedProperty<unsigned short>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyUnsignedShortCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyUnsignedShortCallback", "EntityDatamapsSetUnsignedProperty<unsigned short>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyIntegerCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyIntegerCallback", "EntityDatamapsGetSignedProperty<int>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyIntegerCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyIntegerCallback", "EntityDatamapsSetSignedProperty<int>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyUnsignedIntegerCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyUnsignedIntegerCallback", "EntityDatamapsGetUnsignedProperty<unsigned int>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyUnsignedIntegerCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyUnsignedIntegerCallback", "EntityDatamapsSetUnsignedProperty<unsigned int>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyLongCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyLongCallback", "EntityDatamapsGetSignedProperty<long>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyLongCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyLongCallback", "EntityDatamapsSetSignedProperty<long>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyUnsignedLongCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyUnsignedLongCallback", "EntityDatamapsGetUnsignedProperty<unsigned long>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyUnsignedLongCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyUnsignedLongCallback", "EntityDatamapsSetUnsignedProperty<unsigned long>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyLongLongCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyLongLongCallback", "EntityDatamapsGetSignedProperty<long long>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyLongLongCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyLongLongCallback", "EntityDatamapsSetSignedProperty<long long>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyUnsignedLongLongCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyUnsignedLongLongCallback", "EntityDatamapsGetUnsignedProperty<unsigned long long>(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyUnsignedLongLongCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyUnsignedLongLongCallback", "EntityDatamapsSetUnsignedProperty<unsigned long long>(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyFloatCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyFloatCallback", "EntityDatamapsGetFloatProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyFloatCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyFloatCallback", "EntityDatamapsSetFloatProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyDoubleCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyDoubleCallback", "EntityDatamapsGetDoubleProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyDoubleCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyDoubleCallback", "EntityDatamapsSetDoubleProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyStringCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyStringCallback", "EntityDatamapsGetStringIDProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyStringCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyStringCallback", "EntityDatamapsSetStringIDProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyStringArrayCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyStringArrayCallback", "EntityDatamapsGetStringArrayProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyStringArrayCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyStringArrayCallback", "EntityDatamapsSetStringArrayProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyAddressCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyAddressCallback", "EntityDatamapsGetAddressProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyAddressCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyAddressCallback", "EntityDatamapsSetAddressProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["GetEntityDataMapPropertyVectorCallback", "constexpr int kRequiredArgumentCount = 2;"],
	["GetEntityDataMapPropertyVectorCallback", "EntityDatamapsGetVectorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue);"],
	["SetEntityDataMapPropertyVectorCallback", "constexpr int kRequiredArgumentCount = 3;"],
	["SetEntityDataMapPropertyVectorCallback", "EntityDatamapsSetVectorProperty(CallbackInformation, LocalEntityValue, LocalPropertyValue, LocalNewPropertyValue);"],
	["EntityDatamapsGetCharProperty", "\"GetEntityDataMapPropertyCharacter failed with a native C++ exception.\""],
	["EntityDatamapsSetCharProperty", "\"SetEntityDataMapPropertyCharacter failed with a native C++ exception.\""],
	["SetEntityDataMapPropertyUnsignedCharacterCallback", "\"SetEntityDataMapPropertyUnsignedCharacter(Entity, Property, unValue) expects Entity, Property, and unValue.\""],
	["EntityDatamapsRequireArgumentCount", "CallbackInformation.Length() >= nRequiredArgumentCount"],
	["EntityDatamapsRequireArgumentCount", "ThrowError(pIsolate, pszUsageErrorMessage);"],
	["EntityDatamapsCollectFields", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["EntityDatamapsCollectFields", "unFieldCount > (std::numeric_limits<std::size_t>::max() / kTypeDescriptionByteCount)"],
	["EntityDatamapsCollectFields", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap->dataDesc, unFieldTableByteCount, kTypeDescriptionAlignment)"],
	["EntityDatamapsCollectFields", "reinterpret_cast<typedescription_t*>(unFieldTableAddress + unFieldByteOffset)"],
	["EntityDatamapsIsRecordStorageRangeValid", "unRecordByteCount == 0"],
	["EntityDatamapsIsRecordStorageRangeValid", "unRecordAlignment == 0"],
	["EntityDatamapsIsRecordStorageRangeValid", "(unRecordAddress % unRecordAlignment) == 0"],
	["EntityDatamapsIsRecordStorageRangeValid", "unRecordByteCount - 1"],
	["EntityDatamapsIsRecordStorageRangeValid", "std::numeric_limits<std::uintptr_t>::max() - unRecordAddress"],
	["EntityDatamapsFindFieldInDatamap", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["EntityDatamapsFindFieldInDatamap", "unFieldCount > (std::numeric_limits<std::size_t>::max() / kTypeDescriptionByteCount)"],
	["EntityDatamapsFindFieldInDatamap", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap->dataDesc, unFieldTableByteCount, kTypeDescriptionAlignment)"],
	["EntityDatamapsFindFieldInDatamap", "reinterpret_cast<typedescription_t*>(unFieldTableAddress + unFieldByteOffset)"],
	["EntityDatamapsFindFieldInformation", "pVisitedDatamap == pCurrentDatamap"],
	["EntityDatamapsFindFieldInformation", "vecVisitedDatamaps.push_back(pCurrentDatamap);"],
	["EntityDatamapsFindFieldInformation", "!EntityDatamapsIsRecordStorageRangeValid(pCurrentDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["EntityDatamapsMakeVariantObjectFromAddress", "!EntityDatamapsIsRecordStorageRangeValid(pVariant, kVariantByteCount, kVariantAlignment)"],
	["EntityDatamapsMakeVariantObjectFromAddress", "constexpr char kVariantStorageErrorMessage[] = \"entities/datamaps.CreateEntityDataMapVariantFromAddress(unVariantAddress) requires a live SDK variant with a non-overflowing storage range.\";"],
	["EntityDatamapsMakeVariantObjectFromAddress", "constexpr char kUnalignedVariantMessage[] = \"entities/datamaps.CreateEntityDataMapVariantFromAddress(unVariantAddress) requires an aligned live SDK variant.\";"],
	["EntityDatamapsMakeVariantObjectFromAddress", "constexpr char kInvalidHandleLayoutMessage[] = \"entities/datamaps.CreateEntityDataMapVariantFromAddress(unVariantAddress) could not locate the selected SDK variant handle.\";"],
	["GetEntityDataMapFieldCallback", "unFieldCount > (std::numeric_limits<std::size_t>::max() / kTypeDescriptionByteCount)"],
	["GetEntityDataMapFieldCallback", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap->dataDesc, unFieldTableByteCount, kTypeDescriptionAlignment)"],
	["GetEntityDataMapFieldCallback", "reinterpret_cast<typedescription_t*>(unFieldTableAddress + unFieldByteOffset)"],
	["GetEntityInputFunctionCallback", "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue, pTargetBaseEntity)"],
	["GetEntityInputFunctionCallback", "GetEntityBaseEntityFromAddressValue(LocalEntityValue)"],
	["GetEntityInputFunctionCallback", "FieldResolutionFailure.HasCaught()"],
	["GetEntityInputFunctionCallback", "FieldResolutionFailure.ReThrow();"],
	["GetEntityInputFunctionCallback", "TargetEntityHandle.Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());"],
	["GetEntityInputFunctionCallback", "!bHasTargetIdentity || !EntityDatamapsIsEntityHandleCurrent(TargetEntityHandle, pTargetBaseEntity)"],
	["GetEntityInputFunctionCallback", "!EntityDatamapsIsRecordStorageRangeValid(pInputTypeDescription, sizeof(typedescription_t), alignof(typedescription_t))"],
	["GetEntityInputFunctionCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInputFunctionObject, kAddressPropertyName,"],
	["GetEntityInputFunctionCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInputFunctionObject, kEntityPropertyName,"],
	["GetEntityInputFunctionCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInputFunctionObject, kDescriptionPropertyName,"],
	["GetEntityDataMapFieldCallback", "DatamapResolutionFailure.HasCaught()"],
	["GetEntityDataMapFieldCallback", "DatamapResolutionFailure.ReThrow();"],
	["GetEntityDataMapFieldCallback", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["FindEntityDataMapFieldCallback", "DatamapResolutionFailure.HasCaught()"],
	["FindEntityDataMapFieldCallback", "DatamapResolutionFailure.ReThrow();"],
	["FindEntityDataMapFieldCallback", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["FindEntityDataMapFieldOffsetCallback", "DatamapResolutionFailure.HasCaught()"],
	["FindEntityDataMapFieldOffsetCallback", "DatamapResolutionFailure.ReThrow();"],
	["FindEntityDataMapFieldOffsetCallback", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["GetEntityDataMapFieldsCallback", "DatamapResolutionFailure.HasCaught()"],
	["GetEntityDataMapFieldsCallback", "DatamapResolutionFailure.ReThrow();"],
	["GetEntityDataMapFieldsCallback", "!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))"],
	["GetEntityDataMapFieldCallback", "} catch (...) {"],
	["GetEntityDataMapFieldCallback", "\"GetEntityDataMapField failed with a native C++ exception.\""],
	["FindEntityDataMapFieldCallback", "} catch (...) {"],
	["FindEntityDataMapFieldCallback", "\"FindEntityDataMapField failed with a native C++ exception.\""],
	["FindEntityDataMapFieldOffsetCallback", "} catch (...) {"],
	["FindEntityDataMapFieldOffsetCallback", "\"FindEntityDataMapFieldOffset failed with a native C++ exception.\""],
	["GetEntityDataMapFieldsCallback", "} catch (...) {"],
	["GetEntityDataMapFieldsCallback", "\"GetEntityDataMapFields failed with a native C++ exception.\""],
	["CreateEntityDataMapVariantCallback", "} catch (...) {"],
	["CreateEntityDataMapVariantCallback", "\"CreateEntityDataMapVariant failed with a native C++ exception.\""],
	["CreateEntityDataMapVariantFromAddressCallback", "} catch (...) {"],
	["CreateEntityDataMapVariantFromAddressCallback", "\"CreateEntityDataMapVariantFromAddress failed with a native C++ exception.\""],
	["CreateEntityDataMapIntervalCallback", "} catch (...) {"],
	["CreateEntityDataMapIntervalCallback", "\"CreateEntityDataMapInterval failed with a native C++ exception.\""],
	["GetEntityInputFunctionCallback", "} catch (...) {"],
	["GetEntityInputFunctionCallback", "\"GetEntityInputFunction failed with a native C++ exception.\""],
	["CreateEntityDataMapVariantCallback", "if (LocalVariantObject.IsEmpty())"],
	["CreateEntityDataMapVariantFromAddressCallback", "if (LocalVariantObject.IsEmpty())"],
	["CreateEntityDataMapIntervalCallback", "if (LocalIntervalObject.IsEmpty())"],
	["EntityDatamapsMakeVariantObject", "SetRecordProperty(pIsolate, LocalContext, LocalVariantObject, \"TypeID\", v8::Integer::New"],
	["EntityDatamapsMakeVariantObject", "SetRecordProperty(pIsolate, LocalContext, LocalVariantObject, \"Type\", MakeString"],
	["EntityDatamapsMakeVariantObject", "SetRecordProperty(pIsolate, LocalContext, LocalVariantObject, \"Value\", LocalVariantValue)"],
	["EntityDatamapsMakeVariantObjectFromAddress", "std::memcpy(reinterpret_cast<unsigned char*>(&StringValue), &VariantValue, sizeof(StringValue));"],
	["EntityDatamapsMakeVariantObjectFromAddress", "if (LocalVariantValue.IsEmpty())"],
	["EntityDatamapsSetVariantValue", "AllocateEntityInputString(strVariantValue, StringValue)"],
	["EntityDatamapsSetVariantValue", "ThrowError(pIsolate, kStringAllocationErrorMessage);"],
	["EntityDatamapsSetVariantValue", "VariantValueOut.SetString(StringValue);"],
	["EntityDatamapsSetStringIDProperty", "&PropertyEntityHandle, &pPropertyBaseEntity"],
	["EntityDatamapsSetStringIDProperty", "AllocateEntityInputString(strPropertyValue, StringIDValue)"],
	["EntityDatamapsSetStringIDProperty", "!EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)"],
	["EntityDatamapsSetStringIDProperty", "ThrowError(pIsolate, kStringAllocationErrorMessage);"],
	["EntityDatamapsGetVariantFieldTypeFromValue", "VariantFieldTypeOut = static_cast<fieldtype_t>(nVariantFieldTypeID);"],
	["EntityDatamapsGetVariantFieldTypeFromValue", "VariantFieldTypeOut = VariantFieldTypeBindingInformation.m_VariantFieldType;"],
	["CallEntityInputFunctionCallback", "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)"],
	["CallEntityInputFunctionCallback", "!pBaseEntity && bAllowAddress"],
	["CallEntityInputFunctionCallback", "FieldResolutionFailure.HasCaught()"],
	["CallEntityInputFunctionCallback", "FieldResolutionFailure.ReThrow();"],
	["CallEntityInputFunctionCallback", "ValueConversionFailure.HasCaught()"],
	["CallEntityInputFunctionCallback", "ValueConversionFailure.ReThrow();"],
	["CallEntityInputFunctionCallback", "!pServerUnknown->GetRefEHandle().IsValid()"],
	["CallEntityInputFunctionCallback", "pServerUnknown->GetBaseEntity() != pBaseEntity"],
	["CallEntityInputFunctionCallback", "EntityHandleOut.Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());"],
	["CallEntityInputFunctionCallback", "!EntityDatamapsIsEntityHandleCurrent(EntityHandle, pBaseEntity)"],
	["CallEntityInputFunctionCallback", "unInputFieldAddress % kInputFieldAlignment"],
	["CallEntityInputFunctionCallback", "std::numeric_limits<std::uintptr_t>::max() - (kInputFieldSize - 1)"],
	["CallEntityInputFunctionCallback", "inputfunc_t const InputFunction = pInputTypeDescription->inputFunc;"],
	["CallEntityInputFunctionCallback", "const fieldtype_t InputFieldType = pInputTypeDescription->fieldType;"],
	["CallEntityInputFunctionCallback", "InputData.value, InputFieldType, CallbackInformation[kValueArgumentIndex]"],
	["CallEntityInputFunctionCallback", "!ValidateInputEntity(TargetEntityHandle, pTargetBaseEntity)"],
	["CallEntityInputFunctionCallback", "!ValidateInputEntity(ActivatorEntityHandle, pActivatorBaseEntity)"],
	["CallEntityInputFunctionCallback", "!ValidateInputEntity(CallerEntityHandle, pCallerBaseEntity)"],
	["CallEntityInputFunctionCallback", "(pTargetBaseEntity->*InputFunction)(InputData);"],
	["CallEntityInputFunctionCallback", "\"CallEntityInputFunction failed with a native C++ exception.\""],
	["CallEntityInputFunctionCallback", "} catch (...) {"],
	["InstallEntityDataMapConstants", "SetRecordProperty(pIsolate, LocalContext, LocalEntityDataMapsObject, \"FieldType\", LocalFieldTypeConstants)"],
	["InstallEntityDataMapConstants", "SetRecordProperty(pIsolate, LocalContext, LocalEntityDataMapsObject, \"TypeDescriptionFlags\", LocalTypeDescriptionFlags)"],
	["InstallEntityDataMapConstants", "SetRecordProperty(pIsolate, LocalContext, LocalFieldTypeConstants, ConstantBinding.m_pszConstantName, v8::Integer::New"],
	["InstallEntityDataMapConstants", "SetRecordProperty(pIsolate, LocalContext, LocalTypeDescriptionFlags, ConstantBinding.m_pszConstantName, v8::Integer::New"],
	["GetEntityDataMapCallback", "DatamapResolutionFailure.HasCaught()"],
	["GetEntityDataMapCallback", "DatamapResolutionFailure.ReThrow();"],
	["GetEntityDataMapCallback", "constexpr char kDatamapStorageErrorMessage[] = \"GetEntityDataMap requires an aligned live SDK datamap with a non-overflowing storage range.\";"],
	["GetEntityDataMapCallback", "if (!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))) {\n\t\t\t\tThrowError(pIsolate, kDatamapStorageErrorMessage);\n\t\t\t\treturn;\n\t\t\t}"],
	["GetEntityDataMapCallback", "\"GetEntityDataMap failed with a native C++ exception.\""],
	["GetEntityDataMapCallback", "} catch (...) {"],
];

const g_vecDatamapOuterOwnerContracts = [
	["GetEntityDataMapCallback", "DatamapResolutionFailure"],
	["GetEntityDataMapFieldCallback", "DatamapResolutionFailure"],
	["FindEntityDataMapFieldCallback", "DatamapResolutionFailure"],
	["FindEntityDataMapFieldOffsetCallback", "DatamapResolutionFailure"],
	["GetEntityDataMapFieldsCallback", "DatamapResolutionFailure"],
	["CallEntityInputFunctionCallback", "FieldResolutionFailure"],
	["CallEntityInputFunctionCallback", "ValueConversionFailure"],
	["GetEntityInputFunctionCallback", "FieldResolutionFailure"],
];

function RequirePattern(strSource, Pattern, strMessage) {
	g_Assert.ok(Pattern.test(strSource), strMessage);
}

function ExtractDefinition(strSource, strName, strIndentation = null, bNormalize = true) {
	const strOwnerPattern = (strIndentation === null) ? "\\t{1,2}" : strIndentation;
	const DefinitionPattern = new RegExp(`^(${strOwnerPattern})[^\\t(\\n;{}]*\\b${strName}\\([^\\n]*\\)(?: noexcept)?(?: try)? \\{\\n[\\s\\S]*?^\\1\\}(?: catch \\(\\.\\.\\.\\) \\{\\n[\\s\\S]*?^\\1\\})?$`, "m");
	const vecDefinitionMatch = strSource.match(DefinitionPattern);
	g_Assert.ok(vecDefinitionMatch, `Missing definition: ${strName}`);

	const strDefinition = vecDefinitionMatch[0];
	if (!bNormalize || (strIndentation !== null) || (vecDefinitionMatch[1] !== "\t\t")) {
		return strDefinition;
	}

	return strDefinition.split("\n").map(strLine => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
}

function ReplaceDefinition(strSource, strName, strReplacement, strIndentation = null) {
	const strActualDefinition = ExtractDefinition(strSource, strName, strIndentation, false);
	const strNormalizedDefinition = ExtractDefinition(strSource, strName, strIndentation);
	g_Assert.equal(strSource.split(strActualDefinition).length, 2, "Replace exactly one actual definition.");

	const strActualReplacement = (strActualDefinition === strNormalizedDefinition) ? strReplacement : strReplacement.split("\n").map(strLine => strLine.startsWith("\t") ? "\t" + strLine : strLine).join("\n");

	return strSource.replace(strActualDefinition, () => strActualReplacement);
}

function VerifyContracts(strSource) {
	const strModuleInstaller = ExtractDefinition(strSource, "InstallEntityDataMapFunctions");
	RequirePattern(strModuleInstaller, /if \(!SetRecordFunction\(pIsolate, LocalContext, LocalEntityDataMapsObject, FunctionBinding\.m_pszFunctionName, FunctionBinding\.m_Callback, LocalRuntimeData\)\) \{\n\t{4}return false;\n\t{3}\}/, "Install datamap module functions as checked own properties without inherited setters.");
	g_Assert.ok(!/\bSetFunction\(/.test(strModuleInstaller), "Do not append an inherited-setter-sensitive writer after own function installation.");

	for (const vecContract of g_vecInputContracts) {
		const strDefinition = ExtractDefinition(strSource, vecContract[0]);
		g_Assert.ok(strDefinition.includes(vecContract[1]), `Missing input/record contract: ${vecContract[0]} ${vecContract[1]}`);
	}

	for (const vecOwnerContract of g_vecDatamapOuterOwnerContracts) {
		const strCallback = ExtractDefinition(strSource, vecOwnerContract[0]);
		const strOwnerName = vecOwnerContract[1];
		g_Assert.equal(strCallback.split(strOwnerName + ".HasCaught()").length, 3, "Check ordinary and native-unwind errors for " + vecOwnerContract[0] + " " + strOwnerName);
		g_Assert.equal(strCallback.split(strOwnerName + ".ReThrow();").length, 3, "Preserve both exception paths for " + vecOwnerContract[0] + " " + strOwnerName);
		RequirePattern(strCallback, new RegExp("v8::TryCatch " + strOwnerName + "\\(pIsolate\\);\\n\\t+try \\{"), "Keep the C++ guard inside the live outer owner.");
		RequirePattern(strCallback, new RegExp("} catch \\(\\.\\.\\.\\) \\{\\n(\\t+)if \\(" + strOwnerName + "\\.HasCaught\\(\\)\\) \\{\\n\\1\\t" + strOwnerName + "\\.ReThrow\\(\\);\\n\\1}\\n\\n\\1throw;"), "Rethrow pending errors before the outer owner is destroyed.");
	}

	const strGetDatamapCallback = ExtractDefinition(strSource, "GetEntityDataMapCallback");
	const nUnresolvedDatamapGuard = strGetDatamapCallback.indexOf("if (!pDatamap)");
	const nDatamapStorageGuard = strGetDatamapCallback.indexOf("if (!EntityDatamapsIsRecordStorageRangeValid(");
	g_Assert.ok((nUnresolvedDatamapGuard >= 0) && (nDatamapStorageGuard > nUnresolvedDatamapGuard), "Preserve unresolved-map null handling before the storage guard.");
	g_Assert.ok(nDatamapStorageGuard < strGetDatamapCallback.indexOf("EntityDatamapsMakeDatamapObject("), "Reject invalid datamap record storage before snapshot member reads.");

	const strInputCall = ExtractDefinition(strSource, "CallEntityInputFunctionCallback");
	g_Assert.ok(strInputCall.indexOf("ValidateInputEntity(TargetEntityHandle, pTargetBaseEntity)") < strInputCall.indexOf("EntityDatamapsGetDatamapFromBaseEntity("), "Reject target invalidation before native metadata lookup.");

	const nValueConversionIndex = strInputCall.indexOf("InputData.value, InputFieldType,");
	for (const vecParticipant of [["TargetEntityHandle", "pTargetBaseEntity"], ["ActivatorEntityHandle", "pActivatorBaseEntity"], ["CallerEntityHandle", "pCallerBaseEntity"]]) {
		const strValidationCall = `ValidateInputEntity(${vecParticipant[0]}, ${vecParticipant[1]})`;
		g_Assert.ok((nValueConversionIndex >= 0) && (strInputCall.lastIndexOf(strValidationCall) > nValueConversionIndex), "Revalidate " + vecParticipant[0] + " after value coercion and native string allocation.");
	}

	g_Assert.ok(strInputCall.indexOf("inputfunc_t const InputFunction") < strInputCall.indexOf("CBaseEntity* pActivatorBaseEntity"), "Snapshot metadata before participant getters.");
	g_Assert.ok(!strSource.includes("g_lstEntityDatamapsStringValues"), "Never lend module-owned strings to retained engine fields or inputs.");
	const strVariantType = ExtractDefinition(strSource, "EntityDatamapsGetVariantFieldTypeFromValue");
	g_Assert.ok(!strVariantType.includes("VariantFieldTypeOut = FIELD_VOID;"), "Failed type validation must not change the output.");
	const strStringSetter = ExtractDefinition(strSource, "EntityDatamapsSetStringIDProperty");
	g_Assert.ok(strStringSetter.indexOf("AllocateEntityInputString(") < strStringSetter.indexOf("EntityDatamapsValidatePropertyEntity("), "Revalidate the field owner after engine pool insertion.");
	g_Assert.ok(strStringSetter.indexOf("EntityDatamapsValidatePropertyEntity(") < strStringSetter.indexOf("std::memcpy("), "Reject stale string destinations before writing.");

	g_Assert.ok(!/\bEntityDatamapsVariantLayout\b/.test(strSource), "Do not alias an SDK variant through a project layout.");
	g_Assert.ok(!/\bEntityDatamapsSetVariantEntity\b/.test(strSource), "Use the actual SDK member, not a forwarding setter.");
	g_Assert.ok(!/\bEntityDatamapsGetAddressFromValue\b/.test(strSource), "Use the existing address parser without an identity wrapper.");
	const strSDKSetter = ExtractDefinition(strSource, "variant_t::SetEntity", "");
	RequirePattern(strSDKSetter, /eVal\.Set\(pBaseEntity\);\n\tfieldType = FIELD_EHANDLE;/, "SetEntity must update the real SDK handle and type.");

	const strHandleReader = ExtractDefinition(strSource, "EntityDatamapsGetVariantHandle");
	RequirePattern(strHandleReader, /static_assert\(std::is_standard_layout_v<variant_t>\);/, "Assert the variant representation contract.");
	RequirePattern(strHandleReader, /static_assert\(std::is_standard_layout_v<CBaseHandle>\);/, "Assert the base handle representation contract.");
	RequirePattern(strHandleReader, /static_assert\(std::is_standard_layout_v<CHandle<CBaseEntity>>\);/, "Assert the selected typed handle contract.");
	RequirePattern(strHandleReader, /static_assert\(sizeof\(CHandle<CBaseEntity>\) == kHandleByteCount\);/, "Do not assume derived handle size.");
	RequirePattern(strHandleReader, /static_assert\(kHandleByteCount <= kVariantByteCount\);/, "Guard offset subtraction.");
	g_Assert.ok(strHandleReader.includes("static_assert((kHandleByteCount == sizeof(std::uint32_t)) || (kHandleByteCount == sizeof(std::uint64_t)));"), "Reject unsupported handle widths.");
	RequirePattern(strHandleReader, /LayoutProbe\.SetEntity\(nullptr\);/, "Ask the SDK for a live handle member.");
	RequirePattern(strHandleReader, /reinterpret_cast<std::uintptr_t>\(&LayoutProbe\.Entity\(\)\)/, "Derive the handle offset from the SDK member.");
	RequirePattern(strHandleReader, /if \(\(unHandleAddress < unProbeAddress\) \|\| \(\(unHandleAddress - unProbeAddress\) > \(kVariantByteCount - kHandleByteCount\)\)\) \{\n\t\t\treturn false;/, "Check the complete handle range.");
	RequirePattern(strHandleReader, /std::memcpy\(&unHandle, pchVariantBytes \+ unHandleOffset, kHandleByteCount\);/, "Read a narrow handle into a real scalar.");
	RequirePattern(strHandleReader, /std::memcpy\(&unWideHandle, pchVariantBytes \+ unHandleOffset, kHandleByteCount\);/, "Read a wide handle before narrowing.");
	RequirePattern(strHandleReader, /unHandle = static_cast<std::uint32_t>\(unWideHandle\);/, "Preserve SDK ToInt low-bit semantics.");
	RequirePattern(strHandleReader, /unHandleOut = unHandle;\n\n\t\treturn true;/, "Commit the decoded output only on success.");

	const strDecoder = ExtractDefinition(strSource, "EntityDatamapsMakeVariantObjectFromAddress");
	RequirePattern(strDecoder, /static_assert\(std::is_standard_layout_v<variant_t>\);/, "Guard first-member representation reads.");
	RequirePattern(strDecoder, /static_assert\(std::is_trivially_copyable_v<string_t>\);/, "Guard the SDK string representation.");
	RequirePattern(strDecoder, /static_assert\(sizeof\(variant_t\) >= \(sizeof\(float\) \* kEntityDatamapsVectorComponentCount\)\);/, "Check the entire vector payload.");
	RequirePattern(strDecoder, /if \(\(reinterpret_cast<std::uintptr_t>\(pVariant\) % kVariantAlignment\) != 0\) \{\n\t\t\tThrowError\(pIsolate, kUnalignedVariantMessage\);\n\t\t\treturn \{\};/, "Reject misalignment before typed access.");
	RequirePattern(strDecoder, /variant_t VariantValue = \*pVariant;/, "Use the SDK's non-trivial copy constructor.");
	g_Assert.ok(strDecoder.indexOf("kUnalignedVariantMessage);") < strDecoder.indexOf("variant_t VariantValue = *pVariant;"), "Alignment validation must precede the copy.");
	g_Assert.ok(!/memcpy\([^;]*&VariantValue\s*,\s*pVariant/.test(strDecoder), "Do not byte-copy a non-trivial variant.");
	for (const strFieldType of g_vecAliasFieldTypes) {
		g_Assert.ok(strDecoder.includes(`case ${strFieldType}:`), `Preserve alias decoding: ${strFieldType}`);
	}

	g_Assert.ok(!/case FIELD_(CLASSPTR|EDICT):/.test(strDecoder), "Decode the retained SDK handle only for FIELD_EHANDLE, never for unsupported entity-like tags.");
	g_Assert.ok(strDecoder.includes("v8::Local<v8::Value> LocalVariantValue = v8::Null(pIsolate);"), "Unsupported native variant tags start with a null result.");
	RequirePattern(strDecoder, /default:\n\t{4}break;/, "Unsupported native variant tags preserve the null result.");
	RequirePattern(strDecoder, /if \(!EntityDatamapsGetVariantHandle\(VariantValue, unHandle\)\) \{\n\t\t\t\t\tThrowError\(pIsolate, kInvalidHandleLayoutMessage\);\n\t\t\t\t\treturn \{\};/, "Stop failed SDK handle extraction.");
	RequirePattern(strDecoder, /SetRecordProperty\(pIsolate, LocalContext, LocalVariantObject, "Address", EntityDatamapsMakeAddressValue\(pIsolate, pVariant\)\)/, "Write an own Address property, not an inherited setter.");
	g_Assert.ok(!/\bSetValue\(/.test(strDecoder), "No legacy property writer in the variant decoder.");

	const strColorSnapshot = ExtractDefinition(strSource, "EntityDatamapsMakeColorObject");
	for (const strComponent of ["Red", "Green", "Blue", "Alpha"]) {
		g_Assert.ok(strColorSnapshot.includes(`SetRecordProperty(pIsolate, LocalContext, LocalColorObject, "${strComponent}", v8::Integer::New`), `Use own snapshot field: ${strComponent}`);
	}

	const strColorView = ExtractDefinition(strSource, "EntityDatamapsMakeColorPropertyObject");
	RequirePattern(strColorView, /SetRecordProperty\(pIsolate, LocalContext, LocalColorPropertyObject, "Address",/, "Use an own view Address.");
	const strColorInstaller = ExtractDefinition(strSource, "EntityDatamapsInstallColorComponentProperty");
	RequirePattern(strColorInstaller, /if \(LocalPropertyName\.IsEmpty\(\)\) \{\n\t\t\treturn false;/, "Stop failed native property-name allocation.");
	RequirePattern(strColorInstaller, /if \(LocalComponentData\.IsEmpty\(\)\) \{\n\t\t\treturn false;/, "Stop failed native component metadata creation.");
	RequirePattern(strColorInstaller, /SetNativeDataProperty\(LocalContext, LocalPropertyName, EntityDatamapsGetColorComponentProperty, EntityDatamapsSetColorComponentProperty, LocalComponentData\)/, "Only pass checked handles to the V8 native-property API.");

	const strColorParser = ExtractDefinition(strSource, "EntityDatamapsGetColorFromValue");
	RequirePattern(strColorParser, /color32 ColorValue \{\};\n\t\tColorValue.a = kOpaqueAlphaValue;/, "Initialize the candidate SDK color.");
	g_Assert.ok(!/ColorValueOut\.[rgba]/.test(strColorParser), "No partial color output writes.");
	g_Assert.equal(strColorParser.split("ColorValueOut = ColorValue;").length, 3, "Commit only after each complete color branch.");

	const strFloatAddress = ExtractDefinition(strSource, "EntityDatamapsGetFloatPropertyAddress");
	RequirePattern(strFloatAddress, /if \(\(reinterpret_cast<std::uintptr_t>\(pComponentAddress\) % kFloatAlignment\) != 0\) \{\n\t\t\tThrowError\(pIsolate, kUnalignedAddressMessage\);\n\t\t\treturn nullptr;/, "Reject misaligned float storage before dereference.");
	g_Assert.ok(strFloatAddress.indexOf("kUnalignedAddressMessage);") < strFloatAddress.indexOf("return static_cast<float*>(pComponentAddress);"), "Validate float alignment before typed conversion.");
	for (const strCallbackName of ["EntityDatamapsGetColorComponentProperty", "EntityDatamapsSetColorComponentProperty", "EntityDatamapsGetFloatComponentProperty", "EntityDatamapsSetFloatComponentProperty"]) {
		const strCallback = ExtractDefinition(strSource, strCallbackName);
		g_Assert.ok(!/\bPropertyInfo\b/.test(strCallback), "Use the full PropertyInformation callback role.");
	}

	const strFloatInstaller = ExtractDefinition(strSource, "EntityDatamapsInstallFloatComponentProperty");
	RequirePattern(strFloatInstaller, /if \(LocalPropertyName\.IsEmpty\(\)\) \{\n\t\t\treturn false;/, "Check float property-name allocation.");
	RequirePattern(strFloatInstaller, /if \(LocalComponentData\.IsEmpty\(\)\) \{\n\t\t\treturn false;/, "Check float component metadata creation.");
	RequirePattern(strFloatInstaller, /SetNativeDataProperty\(LocalContext, LocalPropertyName, EntityDatamapsGetFloatComponentProperty, EntityDatamapsSetFloatComponentProperty, LocalComponentData\)/, "Only install checked float handles.");

	for (const vecView of [["Vector", "float", "reinterpret_cast<float*>(unVectorAddress + kYComponentOffset)"], ["Interval", "interval_t", "&pIntervalValue->start"]]) {
		const strView = ExtractDefinition(strSource, `EntityDatamapsMake${vecView[0]}PropertyObject`);
		g_Assert.ok(strView.includes(`k${vecView[0]}Alignment = alignof(${vecView[1]});`), "Use actual storage alignment.");
		RequirePattern(strView, new RegExp(`% k${vecView[0]}Alignment\\) != 0\\) \\{\\n\\t\\t\\tThrowError\\(pIsolate, kUnalignedAddressMessage\\);\\n\\t\\t\\treturn \\{\\};`), "Reject unaligned live storage.");
		g_Assert.ok(strView.indexOf("kUnalignedAddressMessage);") < strView.indexOf(vecView[2]), "Validate before component arithmetic or typed member access.");
		RequirePattern(strView, /SetRecordProperty\(pIsolate, LocalContext, [^,]+, kAddressPropertyName,/, "Use an own live Address.");
	}

	const strVectorView = ExtractDefinition(strSource, "EntityDatamapsMakeVectorPropertyObject");
	g_Assert.ok(!/pflVectorComponents\[/.test(strVectorView), "SDK components are distinct float subobjects, not a float array.");
	RequirePattern(strVectorView, /static_assert\(std::is_standard_layout_v<Vector>\);/, "Guard the SDK vector layout.");
	for (const vecComponent of [["x", "X"], ["y", "Y"], ["z", "Z"]]) {
		g_Assert.ok(strVectorView.includes(`static_assert(offsetof(Vector, ${vecComponent[0]}) == k${vecComponent[1]}ComponentOffset);`), "Assert every SDK component offset.");
	}

	RequirePattern(strVectorView, /if \(unVectorAddress > \(std::numeric_limits<std::uintptr_t>::max\(\) - \(unVectorByteCount - 1\)\)\) \{\n\t\t\tThrowError\(pIsolate, kAddressRangeMessage\);\n\t\t\treturn \{\};/, "Check the full component range before integer address addition.");
	g_Assert.ok(strVectorView.indexOf("kAddressRangeMessage);") < strVectorView.indexOf("unVectorAddress + kYComponentOffset"), "Reject overflowing ranges before creating component addresses.");

	const strIntervalSnapshot = ExtractDefinition(strSource, "EntityDatamapsMakeIntervalObject");
	for (const strComponent of ["Start", "Range"]) {
		g_Assert.ok(strIntervalSnapshot.includes(`SetRecordProperty(pIsolate, LocalContext, LocalIntervalObject, "${strComponent}", v8::Number::New`), "Use own numeric interval fields.");
	}

	const strIntervalComponent = ExtractDefinition(strSource, "EntityDatamapsGetIntervalComponent");
	RequirePattern(strIntervalComponent, /if \(!LocalObject->Get\(LocalContext, LocalKey\)\.ToLocal\(&LocalComponentValue\)\) \{\n\t\t\treturn false;\n\t\t\}/, "Propagate a failed getter without replacing its exception.");
	const strIntervalParser = ExtractDefinition(strSource, "EntityDatamapsGetIntervalFromValue");
	RequirePattern(strIntervalParser, /interval_t IntervalValue \{\};/, "Initialize a candidate interval.");
	g_Assert.ok(!/IntervalValueOut\./.test(strIntervalParser), "No partial interval output writes.");
	g_Assert.equal(strIntervalParser.split("IntervalValueOut = IntervalValue;").length, 3, "Commit only each complete interval branch.");

	const strDatamapSelector = ExtractDefinition(strSource, "EntityDatamapsGetDatamapFromValue");
	RequirePattern(strDatamapSelector, /if \(!ResolveEntityDatamapsBaseEntityFromValue\(pIsolate, LocalContext, LocalValue, pBaseEntity\)\) \{\n\t\t\treturn nullptr;/, "Stop entity resolution exceptions through the shared TryCatch owner before selector fallback.");
	g_Assert.ok(strDatamapSelector.indexOf("ResolveEntityDatamapsBaseEntityFromValue(") < strDatamapSelector.indexOf("LocalValue->IsString()"), "Resolve entity errors before a name/address fallback.");
	g_Assert.ok(!/\bGetObjectString\(/.test(strDatamapSelector), "Do not conflate a failed class-name getter with fallback.");
	RequirePattern(strDatamapSelector, /if \(!LocalDatamapObject->Get\(LocalContext, LocalClassNameKey\)\.ToLocal\(&LocalClassNameValue\)\) \{\n\t\t\t\treturn nullptr;/, "Stop class-name getter exceptions.");
	RequirePattern(strDatamapSelector, /if \(LocalClassNameValue->IsString\(\)\)/, "Preserve strict class-name string semantics.");
	RequirePattern(strDatamapSelector, /if \(LocalClassNameKey\.IsEmpty\(\)\) \{\n\t\t\t\treturn nullptr;/, "Check the class-name key.");
	for (const strRecord of ["Datamap", "TypeDescription"]) {
		const strSelector = ExtractDefinition(strSource, `EntityDatamapsGet${strRecord}FromValue`);
		RequirePattern(strSelector, /if \(LocalAddressKey\.IsEmpty\(\)\) \{\n\t\t\t\treturn nullptr;/, "Check the raw-record address key.");
		RequirePattern(strSelector, new RegExp(`if \\(\\(un${strRecord}Address % k${strRecord}Alignment\\) != 0\\) \\{\\n\\t\\t\\treturn nullptr;`), "Reject unaligned record selectors.");
	}

	const strFieldInformation = ExtractDefinition(strSource, "EntityDatamapsFillFieldInformation");
	RequirePattern(strFieldInformation, /EntityDatamapsFieldInformation FieldInformation \{\};/, "Initialize candidate field information.");
	g_Assert.ok(!/FieldInformationOut\.m_/.test(strFieldInformation), "Do not partially overwrite caller-owned field information.");
	RequirePattern(strFieldInformation, /FieldInformationOut = std::move\(FieldInformation\);\n\t\}/, "Commit completed field information once.");
	for (const strBuilder of ["EntityDatamapsMakeDatamapObject", "EntityDatamapsMakeTypeDescriptionObject"]) {
		const strRecord = ExtractDefinition(strSource, strBuilder);
		g_Assert.ok(!/\bSet(?:Value|String|Integer|Number|Boolean)\(/.test(strRecord), "No inherited setters in metadata record builders.");
		g_Assert.equal((strRecord.match(/\bSetRecordProperty\(/g) ?? []).length, (strBuilder === "EntityDatamapsMakeDatamapObject") ? 7 : 25, "Preserve the complete own-property inventory.");
	}

	const strTypeDescription = ExtractDefinition(strSource, "EntityDatamapsMakeTypeDescriptionObject");
	RequirePattern(strTypeDescription, /constexpr std::size_t kInputFunctionCopySize = \(sizeof\(std::uintptr_t\) < sizeof\(pTypeDescription->inputFunc\)\) \? sizeof\(std::uintptr_t\) : sizeof\(pTypeDescription->inputFunc\);/, "Bound the descriptive member-function representation copy.");
	RequirePattern(strTypeDescription, /std::memcpy\(&unInputFunctionAddress, &pTypeDescription->inputFunc, kInputFunctionCopySize\);/, "Copy only the bounded SDK representation word.");

	const strCollector = ExtractDefinition(strSource, "EntityDatamapsCollectFields");
	for (const strRequired of ["pDatamap->dataNumFields < 0", "(pDatamap->dataNumFields > 0) && !pDatamap->dataDesc", "std::uint32_t unFieldWriteIndex = unFieldWriteIndexOut;", "LocalFieldArray->CreateDataProperty(LocalContext, unFieldWriteIndex, LocalTypeDescriptionObject)", "pDatamap->baseMap, nBaseFieldOffset, strParentFieldPath, true", "unFieldWriteIndexOut = unFieldWriteIndex;"]) {
		g_Assert.ok(strCollector.includes(strRequired), `Missing collection contract: ${strRequired}`);
	}

	g_Assert.ok(!/\+\+unFieldWriteIndexOut|LocalFieldArray->Set\(/.test(strCollector), "No partial cursor commits or inherited array setters.");
	const strPropertySelector = ExtractDefinition(strSource, "EntityDatamapsGetPropertyAddressFromValues");
	for (const strRequired of ["PropertyTryCatch.HasCaught()", "PropertyTryCatch.ReThrow();", "LocalOffsetName.IsEmpty()", "LocalPropertyName.IsEmpty()", "LocalNameValue->IsString()", "PropertyEntityHandle.Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());", "pServerUnknown->GetRefEHandle().ToInt() != PropertyEntityHandle.ToInt()", "reinterpret_cast<std::uintptr_t>(pServerUnknown->GetBaseEntity()) != unEntityAddress", "std::numeric_limits<std::uintptr_t>::max() - unEntityAddress", "FieldInformationOut = std::move(FieldInformation);", "bHasFieldInformationOut = bHasFieldInformation;"]) {
		g_Assert.ok(strPropertySelector.includes(strRequired), `Missing property selection contract: ${strRequired}`);
	}

	g_Assert.ok(!/\bGetObject(?:Integer|String)\(|reinterpret_cast<char\*>\(pBaseEntity\)\s*\+|FieldInformationOut = \{\};|bHasFieldInformationOut = false;|pchPropertyAddressOut = nullptr;/.test(strPropertySelector), "Do not hide getter failures, reset failed outputs, or use unchecked object arithmetic.");
	g_Assert.equal(strPropertySelector.split("PropertyTryCatch.HasCaught()").length, 7, "Check each selector failure and the final string conversion and C++ unwind.");
	g_Assert.equal(strPropertySelector.split("PropertyTryCatch.ReThrow();").length, 7, "Preserve each selector exception, including C++ unwind.");
	RequirePattern(strPropertySelector, /if \(!ResolveEntityDatamapsBaseEntityFromValue\(pIsolate, LocalContext, LocalEntityValue, pBaseEntity\)\) \{\n\t\t\treturn false;/, "Stop checked entity resolution before raw-address fallback.");
	g_Assert.ok(strPropertySelector.indexOf("ResolveEntityDatamapsBaseEntityFromValue(") < strPropertySelector.indexOf("GetEntityBaseEntityFromAddressValue("), "Resolve original entity errors before raw-address fallback.");
	RequirePattern(strPropertySelector, /v8::TryCatch PropertyTryCatch\(pIsolate\);\n\t\t\ttry \{/, "Guard property selection while its TryCatch owner is still alive.");
	RequirePattern(strPropertySelector, /catch \(\.\.\.\) \{\n\t\t\t\tif \(PropertyTryCatch\.HasCaught\(\)\) \{\n\t\t\t\t\tPropertyTryCatch\.ReThrow\(\);\n\t\t\t\t\}\n\n\t\t\t\tthrow;/, "Preserve pending property getter exceptions before native unwinding.");
	g_Assert.ok(strPropertySelector.includes("std::is_nothrow_move_assignable_v<EntityDatamapsFieldInformation>"), "Metadata transfer must not allocate or throw during output commit.");
	g_Assert.ok(strPropertySelector.indexOf("FieldInformationOut = std::move(FieldInformation);") < strPropertySelector.indexOf("pchPropertyAddressOut = pchPropertyAddress;"), "Complete metadata transfer before exposing the scalar output.");
	g_Assert.ok(strPropertySelector.indexOf("PropertyEntityHandle.ToInt()") < strPropertySelector.indexOf("EntityDatamapsGetDatamapFromBaseEntity("), "Revalidate the entity before reading native metadata.");

	const strStorageRange = ExtractDefinition(strSource, "EntityDatamapsValidatePropertyStorageRange");
	for (const strRequired of ["unPropertyByteCount == 0", "unPropertyByteCount - 1", "std::numeric_limits<std::uintptr_t>::max() - unPropertyAddress"]) {
		g_Assert.ok(strStorageRange.includes(strRequired), `Missing complete storage range check: ${strRequired}`);
	}

	for (const strOperation of ["GetSigned", "GetUnsigned", "SetSigned", "SetUnsigned", "GetBoolean", "SetBoolean", "GetChar", "SetChar"]) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(strAccessor.includes("EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress,"), `Validate storage: ${strOperation}`);
		g_Assert.ok(!/reinterpret_cast<T\s*(?:const)?\*>/.test(strAccessor), "Integer access must not require aligned typed storage.");

		if (!strOperation.endsWith("Char")) {
			g_Assert.ok(strAccessor.includes("std::memcpy("), `Transfer the scalar representation: ${strOperation}`);
		}
	}

	for (const strOperation of ["GetFloat", "SetFloat", "GetDouble", "SetDouble", "GetStringID", "SetStringID", "GetStringArray", "SetStringArray", "GetAddress", "SetAddress", "SetVector", "GetColor", "SetColor", "GetInterval", "SetInterval", "GetEntity"]) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(strAccessor.includes("EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress,"), `Validate typed storage: ${strOperation}`);

		if (["GetFloat", "SetFloat", "GetDouble", "SetDouble", "GetStringID", "SetStringID", "GetAddress", "SetAddress", "SetColor", "SetInterval"].includes(strOperation)) {
			g_Assert.ok(strAccessor.includes("std::memcpy("), `Transfer typed representation: ${strOperation}`);
		}
	}

	for (const strOperation of g_vecNativePropertyOperations) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(strAccessor.includes("} catch (...) {"), `Contain every native exception: ${strOperation}`);
		g_Assert.ok(strAccessor.includes("ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);"), "Translate the native failure into a JavaScript error.");
		const strOperationName = /^(Get|Set)(Signed|Unsigned)$/.test(strOperation) ? `EntityDatamaps${strOperation}Property` : strOperation.replace(/^(Get|Set)/, "$1EntityDataMapProperty").replace(/Char$/, "Character").replace(/StringID$/, "String").replace(/Generic$/, "");
		g_Assert.ok(strAccessor.includes(`"${strOperationName} failed with a native C++ exception."`), "Name the actual native operation in its diagnostic.");
	}

	const strTargetValidator = ExtractDefinition(strSource, "EntityDatamapsValidatePropertyEntity");
	for (const strRequired of ["!EntityDatamapsIsEntityHandleCurrent(PropertyEntityHandle, pPropertyBaseEntity)", "ThrowError(pIsolate, kEntityResolutionErrorMessage);"]) {
		g_Assert.ok(strTargetValidator.includes(strRequired), `Revalidate the exact entity before committing: ${strRequired}`);
	}

	const strEntityIdentity = ExtractDefinition(strSource, "EntityDatamapsIsEntityHandleCurrent");
	for (const strRequired of ["!EntityHandle.IsValid() || !pBaseEntity", "GetValidEntityEdictFromIndex(EntityHandle.GetEntryIndex())", "pServerUnknown->GetRefEHandle().ToInt() == EntityHandle.ToInt()", "pServerUnknown->GetBaseEntity() == pBaseEntity"]) {
		g_Assert.ok(strEntityIdentity.includes(strRequired), `Check the live serial and address: ${strRequired}`);
	}

	const strPropertyResolver = ExtractDefinition(strSource, "EntityDatamapsGetPropertyAddressFromValues");
	for (const strRequired of ["LocalPropertyValue->IsObject() || pPropertyEntityHandleOut", "pPropertyEntityHandleOut->Init(PropertyEntityHandle.GetEntryIndex(), PropertyEntityHandle.GetSerialNumber());", "*ppPropertyBaseEntityOut = pBaseEntity;"]) {
		g_Assert.ok(strPropertyResolver.includes(strRequired), `Commit optional target identity outputs: ${strRequired}`);
	}

	for (const strOperation of ["GetGeneric", "SetGeneric"]) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(!/reinterpret_cast<(?:float|int|short|unsigned char)(?: const)?\*>/.test(strAccessor), "Generic scalar operations must not dereference potentially unaligned fields.");
		for (const strType of ["float", "unsigned char", "int", ...((strOperation === "GetGeneric") ? ["short"] : [])]) {
			g_Assert.ok(strAccessor.includes(`EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress, sizeof(${strType}))`), `Validate the complete generic ${strType} representation.`);
		}
	}

	const strGenericSetter = ExtractDefinition(strSource, "EntityDatamapsSetGenericProperty");
	g_Assert.equal(strGenericSetter.split("EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)").length, 4, "Revalidate each direct generic write.");

	const strEntitySetter = ExtractDefinition(strSource, "EntityDatamapsSetEntityProperty");
	g_Assert.equal(strEntitySetter.split("EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)").length, 4, "Revalidate each entity representation before writing.");
	for (const strRequired of ["sizeof(edict_t*)", "sizeof(CBaseEntity*)", "sizeof(CBaseHandle)", "% alignof(CBaseHandle)", "std::memcpy(pchPropertyAddress, &pTargetEntityEdict, sizeof(pTargetEntityEdict));", "std::memcpy(pchPropertyAddress, &pTargetBaseEntity, sizeof(pTargetBaseEntity));", "pEntityHandlePropertyValue->Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());", "ThrowError(pIsolate, kUnalignedEntityHandleErrorMessage);"]) {
		g_Assert.ok(strEntitySetter.includes(strRequired), `Preserve the checked SDK representation: ${strRequired}`);
	}

	g_Assert.equal(strEntitySetter.split("TargetTryCatch.HasCaught()").length, 7, "Check the three inline target selectors during ordinary failure and C++ unwinding.");
	g_Assert.equal(strEntitySetter.split("TargetTryCatch.ReThrow();").length, 7, "Preserve both exception paths of each inline target selector.");
	g_Assert.equal((strEntitySetter.match(/v8::TryCatch TargetTryCatch\(pIsolate\);\n(\t+)try \{/g) ?? []).length, 3, "Keep every inline target selector inside its live TryCatch owner's C++ guard.");
	g_Assert.equal((strEntitySetter.match(/} catch \(\.\.\.\) \{\n(\t+)if \(TargetTryCatch\.HasCaught\(\)\) \{\n\1\tTargetTryCatch\.ReThrow\(\);\n\1}\n\n\1throw;/g) ?? []).length, 3, "Rethrow pending target errors before every inline owner unwinds.");
	RequirePattern(strEntitySetter, /if \(!ResolveEntityDatamapsBaseEntityFromValue\(pIsolate, LocalContext, LocalSetValue, pTargetBaseEntity\)\) \{\n\t{5}return;/, "Stop failed target class resolution before raw-address fallback.");
	g_Assert.ok(strEntitySetter.indexOf("ResolveEntityDatamapsBaseEntityFromValue(") < strEntitySetter.indexOf("GetEntityBaseEntityFromAddressValue("), "Retain checked target resolution before successful-null fallback.");

	const strOptionalType = ExtractDefinition(strSource, "EntityDatamapsGetOptionalPropertyTypeFromValue");
	g_Assert.ok(strOptionalType.includes("strPropertyTypeOut = std::move(strPropertyType);"), "Commit the validated optional type candidate.");
	g_Assert.ok(strOptionalType.indexOf("strPropertyTypeOut = std::move(strPropertyType);") > strOptionalType.indexOf("if (strPropertyType.empty())"), "Do not change type outputs before validation.");

	for (const strOperation of ["GetSigned", "GetUnsigned"]) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(strAccessor.includes("if (LocalIntegerValue.IsEmpty())"), "Check the selected integer V8 handle before returning it.");
		g_Assert.ok(strAccessor.includes("CallbackInformation.GetReturnValue().Set(LocalIntegerValue);"), "Return the checked Number or BigInt without changing its kind.");
	}

	for (const vecSetter of [["Float", "GetFloatArgument("], ["Double", "GetNumberArgument("], ["Vector", "EntityDatamapsGetVectorFromValue("], ["Color", "EntityDatamapsGetColorFromValue("], ["Interval", "EntityDatamapsGetIntervalFromValue("]]) {
		const strSetter = ExtractDefinition(strSource, `EntityDatamapsSet${vecSetter[0]}Property`);
		const nConversionPosition = strSetter.indexOf(vecSetter[1]);
		const nResolutionPosition = strSetter.indexOf("EntityDatamapsGetPropertyAddressFromValues(");
		g_Assert.ok((nConversionPosition >= 0) && (nResolutionPosition > nConversionPosition), "Convert user values before resolving the native target.");
	}

	const strStringCapacity = ExtractDefinition(strSource, "EntityDatamapsGetStringBufferCapacity");
	g_Assert.ok(strStringCapacity.includes("kDefaultStringBufferCapacity = 256;"), "Keep the established fallback capacity.");
	g_Assert.ok(strStringCapacity.includes("FieldInformation.m_pTypeDescription->fieldSizeInBytes > 0"), "Use only positive reflected capacity.");
	const strStringReader = ExtractDefinition(strSource, "EntityDatamapsGetStringArrayProperty");
	for (const strRequired of ["EntityDatamapsGetStringBufferCapacity(FieldInformation, bHasFieldInformation)", "std::numeric_limits<int>::max()", "std::memchr(pszPropertyValue, '\\0', unPropertyBufferCapacity)", "if (!pszTerminator)", "ThrowError(pIsolate, kStringNotTerminatedErrorMessage);", "v8::NewStringType::kNormal, nStringByteCount).ToLocal(&LocalString)"]) {
		g_Assert.ok(strStringReader.includes(strRequired), `Bound the inline string read: ${strRequired}`);
	}

	g_Assert.ok(strStringReader.indexOf("std::numeric_limits<int>::max()") < strStringReader.indexOf("std::memchr("), "Validate the V8 length range before reading.");
	g_Assert.ok(!strStringReader.includes("MakeString(pIsolate, pszPropertyValue)"), "No unbounded scan of inline storage.");
	const strStringWriter = ExtractDefinition(strSource, "EntityDatamapsSetStringArrayProperty");
	for (const strRequired of ["std::min(unTerminatorIndex, strPropertyValue.size())", "std::memchr(strPropertyValue.data(), '\\0', unMaximumCopyByteCount)", "std::memcpy(pszPropertyBuffer, strPropertyValue.data(), unCopyByteCount)", "std::memset(pszPropertyBuffer + unCopyByteCount, '\\0', unPropertyBufferCapacity - unCopyByteCount)"]) {
		g_Assert.ok(strStringWriter.includes(strRequired), `Preserve the bounded C-string copy and complete NUL padding: ${strRequired}`);
	}

	g_Assert.ok(!strStringWriter.includes("std::strncpy("), "Use explicit portable bounded copy rather than a deprecated CRT call.");
	const strVectorWriter = ExtractDefinition(strSource, "EntityDatamapsSetVectorProperty");
	g_Assert.ok(!/pflVectorComponents\[|\*pVectorPropertyValue\s*=/.test(strVectorWriter), "Do not treat SDK vector subobjects as an array or assign an unaligned SDK object.");
	for (const strComponent of ["x", "y", "z"]) {
		g_Assert.ok(strVectorWriter.includes(`&VectorValue.${strComponent}, sizeof(float)`), "Copy each real SDK component separately.");
	}

	g_Assert.ok(strVectorWriter.includes("if (bHasZComponent)"), "Do not overwrite adjacent Vector2D storage.");
	const strEntityReader = ExtractDefinition(strSource, "EntityDatamapsGetEntityProperty");
	for (const strNativeType of ["edict_t*", "CBaseEntity*", "CBaseHandle"]) {
		g_Assert.ok(strEntityReader.includes(`EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress, sizeof(${strNativeType}))`), `Validate every entity representation: ${strNativeType}`);
	}

	for (const strRequired of ["GetEntityEdictFromAddress(reinterpret_cast<std::uintptr_t>(pStoredEntityEdict))", "% alignof(CBaseHandle)", "CBaseHandle const EntityHandle = *pEntityHandlePropertyValue;"]) {
		g_Assert.ok(strEntityReader.includes(strRequired), `Keep native entity representation safe: ${strRequired}`);
	}

	g_Assert.ok(strEntityReader.indexOf("% alignof(CBaseHandle)") < strEntityReader.indexOf("reinterpret_cast<CBaseHandle const*>"), "Check alignment before copying the non-trivial SDK handle.");
	for (const strOperation of ["GetStringID", "SetStringID", "SetColor", "SetInterval"]) {
		const strAccessor = ExtractDefinition(strSource, `EntityDatamaps${strOperation}Property`);
		g_Assert.ok(strAccessor.includes("static_assert(std::is_trivially_copyable_v<"), "Guard byte-copied SDK representations.");
	}

	const strOutputCallback = ExtractDefinition(strSource, "FindEntityOutputNameByAddressCallback");
	RequirePattern(strOutputCallback, /if \(!ResolveEntityDatamapsBaseEntityFromValue\([^\n]*, pCallerEntity\)\) \{\n\t\t\treturn;/, "Stop a failed entity selector before native output lookup.");
	g_Assert.ok(strOutputCallback.indexOf("ResolveEntityDatamapsBaseEntityFromValue(") < strOutputCallback.indexOf("GetAddressSizedUnsignedIntegerFromValue("), "Resolve entity errors before output-address parsing.");
	const strEntityResolver = ExtractDefinition(strSource, "ResolveEntityDatamapsBaseEntityFromValue");
	g_Assert.equal(strEntityResolver.split("EntityResolutionFailure.ReThrow();").length, 3, "Preserve selector errors during normal failure and C++ unwinding.");
	RequirePattern(strEntityResolver, /} catch \(\.\.\.\) \{\n\t\t\tif \(EntityResolutionFailure\.HasCaught\(\)\) \{\n\t\t\t\tEntityResolutionFailure\.ReThrow\(\);\n\t\t\t}\n\n\t\t\tthrow;/, "Rethrow the pending selector error before C++ leaves its TryCatch owner.");

	const strColorSetter = ExtractDefinition(strSource, "EntityDatamapsSetColorComponentProperty");
	RequirePattern(strColorSetter, /if \(!LocalValue->IsInt32\(\)\) \{\n\t\t\tThrowError\(pIsolate, kIntegerValueMessage\);\n\t\t\treturn;/, "Reject color coercion and wraparound before conversion.");
	g_Assert.ok(strColorSetter.indexOf("LocalValue->IsInt32()") < strColorSetter.indexOf("GetInt32Argument("), "Validate the primitive color Number before conversion.");

	const strColorComponentReader = ExtractDefinition(strSource, "EntityDatamapsGetColorComponent");
	RequirePattern(strColorComponentReader, /if \(!LocalComponentValue->IsInt32\(\)\) \{\n\t\t\tThrowError\(pIsolate, kIntegerComponentMessage\);\n\t\t\treturn false;/, "Reject color object/array component coercion, fractions and wraparound.");
	g_Assert.ok(strColorComponentReader.indexOf("LocalComponentValue->IsInt32()") < strColorComponentReader.indexOf("GetInt32Argument("), "Validate the primitive color component Number before conversion.");

	RequirePattern(strOutputCallback, /unCallerAddress > \(std::numeric_limits<std::uintptr_t>::max\(\) - unFieldOffset\)/, "Validate address addition before overflow.");
	RequirePattern(strOutputCallback, /if \(nFieldOffset < kMinimumFieldOffset\) \{\n\t\t\t\t\tcontinue;/, "Ignore negative SDK offsets.");
	RequirePattern(strOutputCallback, /if \(LocalOutputName\.IsEmpty\(\)\) \{\n\t\t\t\t\t\treturn;/, "Stop failed V8 name allocation.");

	const strVariantEntitySetter = ExtractDefinition(strSource, "EntityDatamapsSetVariantValue");
	RequirePattern(strVariantEntitySetter, /case FIELD_CLASSPTR: \{\n\t{4}CBaseEntity\* pBaseEntity = nullptr;\n\t{4}if \(!ResolveEntityDatamapsBaseEntityFromValue\(pIsolate, LocalContext, LocalValue, pBaseEntity\)\) \{\n\t{5}return false;\n\t{4}\}\n\n\t{4}VariantValueOut.SetEntity\(pBaseEntity\);/, "Preserve selector errors through C++ unwinding before mutating the SDK variant.");
	const strVariantPayloadReader = ExtractDefinition(strSource, "EntityDatamapsMakeVariantObjectFromAddress");
	for (const strPayloadType of ["string_t", "int"]) {
		g_Assert.ok(strVariantPayloadReader.includes(`static_assert(sizeof(variant_t) >= sizeof(${strPayloadType}));`), "Assert the extent of every relied-on scalar/string payload copy.");
	}
}

const g_strEntityResolutionUnwindGuard = "if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;";
const g_strPropertyUnwindGuard = "if (PropertyTryCatch.HasCaught()) {\n\t\t\t\t\tPropertyTryCatch.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;";
const g_strTargetUnwindGuard = "if (TargetTryCatch.HasCaught()) {\n\t\t\t\t\t\t\tTargetTryCatch.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;";

const g_vecMutations = [
	["InstallEntityDataMapFunctions", "SetRecordFunction(", "SetFunction("],
	["InstallEntityDataMapFunctions", "if (!SetRecordFunction(", "if (false && !SetRecordFunction("],
	["GetEntityDataMapCallback", "if (!pDatamap)", "if (false)"],
	["variant_t::SetEntity", "eVal.Set(pBaseEntity);", "eVal.Set(nullptr);", ""],
	["variant_t::SetEntity", "fieldType = FIELD_EHANDLE;", "fieldType = FIELD_VOID;", ""],
	["EntityDatamapsGetVariantHandle", "std::is_standard_layout_v<variant_t>", "std::is_class_v<variant_t>"],
	["EntityDatamapsGetVariantHandle", "std::is_standard_layout_v<CBaseHandle>", "std::is_class_v<CBaseHandle>"],
	["EntityDatamapsGetVariantHandle", "std::is_standard_layout_v<CHandle<CBaseEntity>>", "std::is_class_v<CHandle<CBaseEntity>>"],
	["EntityDatamapsGetVariantHandle", "sizeof(CHandle<CBaseEntity>) == kHandleByteCount", "sizeof(CHandle<CBaseEntity>) >= kHandleByteCount"],
	["EntityDatamapsGetVariantHandle", "kHandleByteCount <= kVariantByteCount", "kHandleByteCount < kVariantByteCount"],
	["EntityDatamapsGetVariantHandle", "sizeof(std::uint64_t)", "sizeof(std::uint16_t)"],
	["EntityDatamapsGetVariantHandle", "LayoutProbe.SetEntity(nullptr);", "LayoutProbe.SetInt(0);"],
	["EntityDatamapsGetVariantHandle", "&LayoutProbe.Entity()", "&LayoutProbe"],
	["EntityDatamapsGetVariantHandle", "unHandleAddress < unProbeAddress", "unHandleAddress > unProbeAddress"],
	["EntityDatamapsGetVariantHandle", "kVariantByteCount - kHandleByteCount", "kVariantByteCount"],
	["EntityDatamapsGetVariantHandle", "&unHandle, pchVariantBytes + unHandleOffset", "&unHandle, pchVariantBytes"],
	["EntityDatamapsGetVariantHandle", "&unWideHandle, pchVariantBytes + unHandleOffset", "&unWideHandle, pchVariantBytes"],
	["EntityDatamapsGetVariantHandle", "static_cast<std::uint32_t>(unWideHandle)", "static_cast<std::uint32_t>(unWideHandle >> 1)"],
	["EntityDatamapsGetVariantHandle", "unHandleOut = unHandle;", "unHandleOut = 0;"],
	["EntityDatamapsMakeVariantObjectFromAddress", "std::is_standard_layout_v<variant_t>", "std::is_class_v<variant_t>"],
	["EntityDatamapsMakeVariantObjectFromAddress", "std::is_trivially_copyable_v<string_t>", "std::is_class_v<string_t>"],
	["EntityDatamapsMakeVariantObjectFromAddress", "sizeof(float) * kEntityDatamapsVectorComponentCount", "sizeof(float)"],
	["EntityDatamapsMakeVariantObjectFromAddress", "% kVariantAlignment", "% 1"],
	["EntityDatamapsMakeVariantObjectFromAddress", "variant_t VariantValue = *pVariant;", "variant_t VariantValue {};"],
	["EntityDatamapsMakeVariantObjectFromAddress", "case FIELD_EHANDLE: {", "case FIELD_CLASSPTR:\n\t\t\tcase FIELD_EHANDLE: {"],
	["EntityDatamapsMakeVariantObjectFromAddress", "case FIELD_EHANDLE: {", "case FIELD_EHANDLE:\n\t\t\tcase FIELD_EDICT: {"],
	["EntityDatamapsMakeVariantObjectFromAddress", "case FIELD_EHANDLE: {", "case FIELD_CLASSPTR:\n\t\t\tcase FIELD_EHANDLE:\n\t\t\tcase FIELD_EDICT: {"],
	["EntityDatamapsMakeVariantObjectFromAddress", "LocalVariantValue = v8::Null(pIsolate);", "LocalVariantValue = v8::Undefined(pIsolate);"],
	["EntityDatamapsMakeVariantObjectFromAddress", "default:\n\t\t\t\tbreak;", "default:\n\t\t\t\tLocalVariantValue = v8::Undefined(pIsolate);\n\t\t\t\tbreak;"],
	["EntityDatamapsMakeVariantObjectFromAddress", "!EntityDatamapsGetVariantHandle(VariantValue, unHandle)", "false"],
	["EntityDatamapsMakeVariantObjectFromAddress", "SetRecordProperty(pIsolate, LocalContext, LocalVariantObject", "SetValue(pIsolate, LocalContext, LocalVariantObject"],
	["ResolveEntityDatamapsBaseEntityFromValue", "EntityResolutionFailure.ReThrow();", "return false;"],
	["ResolveEntityDatamapsBaseEntityFromValue", g_strEntityResolutionUnwindGuard, "throw;"],
	["ResolveEntityDatamapsBaseEntityFromValue", g_strEntityResolutionUnwindGuard, g_strEntityResolutionUnwindGuard.replace("EntityResolutionFailure.HasCaught", "EntityResolutionFailureXHasCaught")],
	["ResolveEntityDatamapsBaseEntityFromValue", g_strEntityResolutionUnwindGuard, g_strEntityResolutionUnwindGuard.replace("EntityResolutionFailure.ReThrow", "EntityResolutionFailureXReThrow")],
	["EntityDatamapsSetColorComponentProperty", "!LocalValue->IsInt32()", "false"],
	["EntityDatamapsGetColorComponent", "!LocalComponentValue->IsInt32()", "false"],
	["FindEntityOutputNameByAddressCallback", "std::numeric_limits<std::uintptr_t>::max() - unFieldOffset", "std::numeric_limits<std::uintptr_t>::max()"],
	["FindEntityOutputNameByAddressCallback", "nFieldOffset < kMinimumFieldOffset", "nFieldOffset > kMinimumFieldOffset"],
	["FindEntityOutputNameByAddressCallback", "LocalOutputName.IsEmpty()", "false"],
	["FindEntityOutputNameByAddressCallback", "LocalOutputName.IsEmpty()", "LocalOutputNameXIsEmpty()"],
	["EntityDatamapsMakeColorObject", '"Red", v8::Integer::New', '"Red", v8::Number::New'],
	["EntityDatamapsMakeColorObject", '"Green", v8::Integer::New', '"Green", v8::Number::New'],
	["EntityDatamapsMakeColorObject", '"Blue", v8::Integer::New', '"Blue", v8::Number::New'],
	["EntityDatamapsMakeColorObject", '"Alpha", v8::Integer::New', '"Alpha", v8::Number::New'],
	["EntityDatamapsMakeColorPropertyObject", "SetRecordProperty(pIsolate, LocalContext, LocalColorPropertyObject", "SetValue(pIsolate, LocalContext, LocalColorPropertyObject"],
	["EntityDatamapsInstallColorComponentProperty", "LocalPropertyName.IsEmpty()", "false"],
	["EntityDatamapsInstallColorComponentProperty", "LocalComponentData.IsEmpty()", "false"],
	["EntityDatamapsInstallColorComponentProperty", "LocalPropertyName.IsEmpty()", "LocalPropertyNameXIsEmpty()"],
	["EntityDatamapsInstallColorComponentProperty", "LocalComponentData.IsEmpty()", "LocalComponentDataXIsEmpty()"],
	["EntityDatamapsInstallColorComponentProperty", "SetNativeDataProperty(LocalContext, LocalPropertyName,", 'SetNativeDataProperty(LocalContext, MakeString(pIsolate, pszPropertyName),'],
	["EntityDatamapsGetColorFromValue", "color32 ColorValue {};", "color32 ColorValue;"],
	["EntityDatamapsGetColorFromValue", "ColorValueOut = ColorValue;", "ColorValueOut.r = ColorValue.r;"],
	["EntityDatamapsGetFloatPropertyAddress", "% kFloatAlignment", "% 1"],
	["EntityDatamapsGetColorComponentProperty", "PropertyInformation", "PropertyInfo"],
	["EntityDatamapsSetColorComponentProperty", "PropertyInformation", "PropertyInfo"],
	["EntityDatamapsGetFloatComponentProperty", "PropertyInformation", "PropertyInfo"],
	["EntityDatamapsSetFloatComponentProperty", "PropertyInformation", "PropertyInfo"],
	["EntityDatamapsInstallFloatComponentProperty", "LocalPropertyName.IsEmpty()", "false"],
	["EntityDatamapsInstallFloatComponentProperty", "LocalComponentData.IsEmpty()", "false"],
	["EntityDatamapsInstallFloatComponentProperty", "LocalPropertyName.IsEmpty()", "LocalPropertyNameXIsEmpty()"],
	["EntityDatamapsInstallFloatComponentProperty", "LocalComponentData.IsEmpty()", "LocalComponentDataXIsEmpty()"],
	["EntityDatamapsInstallFloatComponentProperty", "SetNativeDataProperty(LocalContext, LocalPropertyName,", "SetNativeDataProperty(LocalContext, MakeString(pIsolate, pszPropertyName),"],
	["EntityDatamapsMakeVectorPropertyObject", "% kVectorAlignment", "% 1"],
	["EntityDatamapsMakeVectorPropertyObject", "alignof(float)", "1"],
	["EntityDatamapsMakeVectorPropertyObject", "std::is_standard_layout_v<Vector>", "std::is_class_v<Vector>"],
	["EntityDatamapsMakeVectorPropertyObject", "offsetof(Vector, x) == kXComponentOffset", "offsetof(Vector, x) >= kXComponentOffset"],
	["EntityDatamapsMakeVectorPropertyObject", "offsetof(Vector, y) == kYComponentOffset", "offsetof(Vector, y) >= kYComponentOffset"],
	["EntityDatamapsMakeVectorPropertyObject", "offsetof(Vector, z) == kZComponentOffset", "offsetof(Vector, z) >= kZComponentOffset"],
	["EntityDatamapsMakeVectorPropertyObject", "unVectorByteCount - 1", "0"],
	["EntityDatamapsMakeVectorPropertyObject", "reinterpret_cast<float*>(unVectorAddress + kYComponentOffset)", "&pflVectorComponents[kYComponentOffset]"],
	["EntityDatamapsMakeVectorPropertyObject", "SetRecordProperty(pIsolate, LocalContext, LocalVectorPropertyObject", "SetValue(pIsolate, LocalContext, LocalVectorPropertyObject"],
	["EntityDatamapsMakeIntervalPropertyObject", "% kIntervalAlignment", "% 1"],
	["EntityDatamapsMakeIntervalPropertyObject", "alignof(interval_t)", "1"],
	["EntityDatamapsMakeIntervalPropertyObject", "SetRecordProperty(pIsolate, LocalContext, LocalIntervalPropertyObject", "SetValue(pIsolate, LocalContext, LocalIntervalPropertyObject"],
	["EntityDatamapsMakeIntervalObject", '"Start", v8::Number::New', '"Start", v8::Integer::New'],
	["EntityDatamapsMakeIntervalObject", '"Range", v8::Number::New', '"Range", v8::Integer::New'],
	["EntityDatamapsGetIntervalComponent", "return false;\n\t\t}\n\n\t\tif (IsValueNullish(LocalComponentValue))", "ThrowError(pIsolate, kComponentMessage);\n\t\t\treturn false;\n\t\t}\n\n\t\tif (IsValueNullish(LocalComponentValue))"],
	["EntityDatamapsGetIntervalComponent", "Get(LocalContext, LocalKey).ToLocal(&LocalComponentValue)", "Get(LocalContext, LocalKey)XToLocal(&LocalComponentValue)"],
	["EntityDatamapsGetIntervalFromValue", "interval_t IntervalValue {};", "interval_t IntervalValue;"],
	["EntityDatamapsGetIntervalFromValue", "IntervalValueOut = IntervalValue;", "IntervalValueOut.start = IntervalValue.start;"],
	["EntityDatamapsGetDatamapFromValue", "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)", "false"],
	["EntityDatamapsGetDatamapFromValue", "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)) {\n\t\t\treturn nullptr;\n\t\t}", "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)) {\n\t\t\tpBaseEntity = nullptr;\n\t\t}"],
	["EntityDatamapsGetDatamapFromValue", "LocalClassNameKey.IsEmpty()", "false"],
	["EntityDatamapsGetDatamapFromValue", "LocalClassNameKey.IsEmpty()", "LocalClassNameKeyXIsEmpty()"],
	["EntityDatamapsGetDatamapFromValue", "Get(LocalContext, LocalClassNameKey).ToLocal(&LocalClassNameValue)", "Get(LocalContext, LocalClassNameKey)XToLocal(&LocalClassNameValue)"],
	["EntityDatamapsGetDatamapFromValue", "LocalClassNameValue->IsString()", "!IsValueNullish(LocalClassNameValue)"],
	["EntityDatamapsGetDatamapFromValue", "LocalAddressKey.IsEmpty()", "false"],
	["EntityDatamapsGetDatamapFromValue", "LocalAddressKey.IsEmpty()", "LocalAddressKeyXIsEmpty()"],
	["EntityDatamapsGetDatamapFromValue", "% kDatamapAlignment", "% 1"],
	["EntityDatamapsGetTypeDescriptionFromValue", "LocalAddressKey.IsEmpty()", "false"],
	["EntityDatamapsGetTypeDescriptionFromValue", "LocalAddressKey.IsEmpty()", "LocalAddressKeyXIsEmpty()"],
	["EntityDatamapsGetTypeDescriptionFromValue", "% kTypeDescriptionAlignment", "% 1"],
	["EntityDatamapsFillFieldInformation", "EntityDatamapsFieldInformation FieldInformation {};", "EntityDatamapsFieldInformation FieldInformation;"],
	["EntityDatamapsFillFieldInformation", "FieldInformationOut = std::move(FieldInformation);", "FieldInformationOut.m_strFieldPath = strFieldPath;"],
	["EntityDatamapsMakeDatamapObject", "SetRecordProperty(pIsolate, LocalContext, LocalDatamapObject", "SetValue(pIsolate, LocalContext, LocalDatamapObject"],
	["EntityDatamapsMakeTypeDescriptionObject", "SetRecordProperty(pIsolate, LocalContext, LocalTypeDescriptionObject", "SetValue(pIsolate, LocalContext, LocalTypeDescriptionObject"],
	["EntityDatamapsMakeTypeDescriptionObject", "sizeof(std::uintptr_t) < sizeof(pTypeDescription->inputFunc)", "sizeof(std::uintptr_t) > sizeof(pTypeDescription->inputFunc)"],
	["EntityDatamapsMakeTypeDescriptionObject", "&pTypeDescription->inputFunc, kInputFunctionCopySize", "&pTypeDescription->inputFunc, sizeof(std::uintptr_t)"],
	["EntityDatamapsCollectFields", "pDatamap->dataNumFields < 0", "pDatamap->dataNumFields > 0"],
	["EntityDatamapsCollectFields", "(pDatamap->dataNumFields > 0) && !pDatamap->dataDesc", "!pDatamap->dataDesc"],
	["EntityDatamapsCollectFields", "std::uint32_t unFieldWriteIndex = unFieldWriteIndexOut;", "std::uint32_t unFieldWriteIndex = 0;"],
	["EntityDatamapsCollectFields", "LocalFieldArray->CreateDataProperty(LocalContext, unFieldWriteIndex,", "LocalFieldArray->Set(LocalContext, unFieldWriteIndex,"],
	["EntityDatamapsCollectFields", "pDatamap->baseMap, nBaseFieldOffset, strParentFieldPath, true", 'pDatamap->baseMap, 0, "", true'],
	["EntityDatamapsCollectFields", "unFieldWriteIndexOut = unFieldWriteIndex;", "unFieldWriteIndexOut = 0;"],
	["EntityDatamapsGetPropertyAddressFromValues", "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue, pBaseEntity)", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue, pBaseEntity)) {\n\t\t\treturn false;\n\t\t}", "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalEntityValue, pBaseEntity)) {\n\t\t\tpBaseEntity = nullptr;\n\t\t}"],
	["EntityDatamapsGetPropertyAddressFromValues", "PropertyTryCatch.HasCaught()", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "PropertyTryCatch.ReThrow();", "return false;"],
	["EntityDatamapsGetPropertyAddressFromValues", "LocalOffsetName.IsEmpty()", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "LocalPropertyName.IsEmpty()", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "LocalNameValue->IsString()", "!LocalNameValue->IsUndefined()"],
	["EntityDatamapsGetPropertyAddressFromValues", "PropertyEntityHandle.Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());", "PropertyEntityHandle.Init(0, 0);"],
	["EntityDatamapsGetPropertyAddressFromValues", "pServerUnknown->GetRefEHandle().ToInt() != PropertyEntityHandle.ToInt()", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "reinterpret_cast<std::uintptr_t>(pServerUnknown->GetBaseEntity()) != unEntityAddress", "false"],
	["EntityDatamapsGetPropertyAddressFromValues", "std::numeric_limits<std::uintptr_t>::max() - unEntityAddress", "std::numeric_limits<std::uintptr_t>::max()"],
	["EntityDatamapsGetPropertyAddressFromValues", "FieldInformationOut = std::move(FieldInformation);", "FieldInformationOut = {};"],
	["EntityDatamapsGetPropertyAddressFromValues", "FieldInformationOut = std::move(FieldInformation);", "FieldInformationOut = FieldInformation;"],
	["EntityDatamapsGetPropertyAddressFromValues", "std::is_nothrow_move_assignable_v<EntityDatamapsFieldInformation>", "std::is_move_assignable_v<EntityDatamapsFieldInformation>"],
	["EntityDatamapsGetPropertyAddressFromValues", "FieldInformationOut = std::move(FieldInformation);\n\t\tpchPropertyAddressOut = pchPropertyAddress;", "pchPropertyAddressOut = pchPropertyAddress;\n\t\tFieldInformationOut = std::move(FieldInformation);"],
	["EntityDatamapsGetPropertyAddressFromValues", g_strPropertyUnwindGuard, "throw;"],
	["EntityDatamapsGetPropertyAddressFromValues", g_strPropertyUnwindGuard, g_strPropertyUnwindGuard.replace("PropertyTryCatch.HasCaught", "PropertyTryCatchXHasCaught")],
	["EntityDatamapsGetPropertyAddressFromValues", g_strPropertyUnwindGuard, g_strPropertyUnwindGuard.replace("PropertyTryCatch.ReThrow", "PropertyTryCatchXReThrow")],
	["EntityDatamapsGetPropertyAddressFromValues", "bHasFieldInformationOut = bHasFieldInformation;", "bHasFieldInformationOut = false;"],
	["EntityDatamapsValidatePropertyStorageRange", "unPropertyByteCount == 0", "unPropertyByteCount > 0"],
	["EntityDatamapsValidatePropertyStorageRange", "unPropertyByteCount - 1", "0"],
	["EntityDatamapsValidatePropertyStorageRange", "std::numeric_limits<std::uintptr_t>::max() - unPropertyAddress", "std::numeric_limits<std::uintptr_t>::max()"],
	["EntityDatamapsGetSignedProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetUnsignedProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetSignedProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetUnsignedProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetBooleanProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetBooleanProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetCharProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetCharProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetSignedProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetUnsignedProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetSignedProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetUnsignedProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetBooleanProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetBooleanProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetFloatProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetFloatProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetDoubleProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetDoubleProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetStringIDProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetStringIDProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetStringArrayProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetStringArrayProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetAddressProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetAddressProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetVectorProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetColorProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetColorProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetIntervalProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsSetIntervalProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetEntityProperty", "EntityDatamapsValidatePropertyStorageRange(", "OtherPropertyStorageRange("],
	["EntityDatamapsGetFloatProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetFloatProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetDoubleProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetDoubleProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetStringIDProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetStringIDProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetAddressProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetAddressProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetColorProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsSetIntervalProperty", "std::memcpy(", "OtherCopy("],
	["EntityDatamapsGetStringBufferCapacity", "kDefaultStringBufferCapacity = 256;", "kDefaultStringBufferCapacity = 128;"],
	["EntityDatamapsGetStringBufferCapacity", "FieldInformation.m_pTypeDescription->fieldSizeInBytes > 0", "FieldInformation.m_pTypeDescription->fieldSizeInBytes >= 0"],
	["EntityDatamapsGetStringArrayProperty", "EntityDatamapsGetStringBufferCapacity(FieldInformation, bHasFieldInformation)", "256"],
	["EntityDatamapsGetStringArrayProperty", "std::numeric_limits<int>::max()", "std::numeric_limits<unsigned int>::max()"],
	["EntityDatamapsGetStringArrayProperty", "std::memchr(pszPropertyValue, '\\0', unPropertyBufferCapacity)", "std::memchr(pszPropertyValue, '\\0', 256)"],
	["EntityDatamapsGetStringArrayProperty", "if (!pszTerminator)", "if (false)"],
	["EntityDatamapsGetStringArrayProperty", "kStringNotTerminatedErrorMessage);", "kUnsupportedStringCapacityErrorMessage);"],
	["EntityDatamapsGetStringArrayProperty", "v8::NewStringType::kNormal, nStringByteCount).ToLocal(&LocalString)", "v8::NewStringType::kNormal).ToLocal(&LocalString)"],
	["EntityDatamapsSetStringArrayProperty", "std::min(unTerminatorIndex, strPropertyValue.size())", "strPropertyValue.size()"],
	["EntityDatamapsSetStringArrayProperty", "std::memchr(strPropertyValue.data(), '\\0', unMaximumCopyByteCount)", "std::memchr(strPropertyValue.data(), '\\0', unPropertyBufferCapacity)"],
	["EntityDatamapsSetStringArrayProperty", "std::memcpy(pszPropertyBuffer, strPropertyValue.data(), unCopyByteCount)", "std::memcpy(pszPropertyBuffer, strPropertyValue.data(), unMaximumCopyByteCount)"],
	["EntityDatamapsSetStringArrayProperty", "unPropertyBufferCapacity - unCopyByteCount", "unPropertyBufferCapacity"],
	["EntityDatamapsSetEntityProperty", "!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalSetValue, pTargetBaseEntity)", "false"],
	["EntityDatamapsSetEntityProperty", "TargetTryCatch.HasCaught()", "false"],
	["EntityDatamapsSetEntityProperty", g_strTargetUnwindGuard, "throw;"],
	["EntityDatamapsSetEntityProperty", g_strTargetUnwindGuard, g_strTargetUnwindGuard.replace("TargetTryCatch.HasCaught", "TargetTryCatchXHasCaught")],
	["EntityDatamapsSetEntityProperty", g_strTargetUnwindGuard, g_strTargetUnwindGuard.replace("TargetTryCatch.ReThrow", "TargetTryCatchXReThrow")],
	["EntityDatamapsMakeVariantObjectFromAddress", "static_assert(sizeof(variant_t) >= sizeof(string_t));", ""],
	["EntityDatamapsMakeVariantObjectFromAddress", "static_assert(sizeof(variant_t) >= sizeof(int));", ""],
	["EntityDatamapsSetVectorProperty", "&VectorValue.x, sizeof(float)", "&VectorValue.y, sizeof(float)"],
	["EntityDatamapsSetVectorProperty", "&VectorValue.y, sizeof(float)", "&VectorValue.z, sizeof(float)"],
	["EntityDatamapsSetVectorProperty", "&VectorValue.z, sizeof(float)", "&VectorValue.x, sizeof(float)"],
	["EntityDatamapsSetVectorProperty", "if (bHasZComponent)", "if (true)"],
	["EntityDatamapsGetEntityProperty", "GetEntityEdictFromAddress(reinterpret_cast<std::uintptr_t>(pStoredEntityEdict))", "pStoredEntityEdict"],
	["EntityDatamapsGetEntityProperty", "% alignof(CBaseHandle)", "% 1"],
	["EntityDatamapsGetEntityProperty", "CBaseHandle const EntityHandle = *pEntityHandlePropertyValue;", "CBaseHandle const EntityHandle {};"],
	["EntityDatamapsGetStringIDProperty", "static_assert(std::is_trivially_copyable_v<", "static_assert(std::is_class_v<"],
	["EntityDatamapsSetStringIDProperty", "static_assert(std::is_trivially_copyable_v<", "static_assert(std::is_class_v<"],
	["EntityDatamapsSetColorProperty", "static_assert(std::is_trivially_copyable_v<", "static_assert(std::is_class_v<"],
	["EntityDatamapsSetIntervalProperty", "static_assert(std::is_trivially_copyable_v<", "static_assert(std::is_class_v<"],
];

VerifyContracts(g_strSource);

let g_unRejectedMutations = 0;
for (const vecMutation of g_vecMutations) {
	const strDefinition = ExtractDefinition(g_strSource, vecMutation[0], vecMutation[3] ?? null);
	g_Assert.ok(strDefinition.includes(vecMutation[1]), `Missing mutation anchor: ${vecMutation[0]} / ${vecMutation[1]}`);
	const strMutatedDefinition = strDefinition.replace(vecMutation[1], vecMutation[2]);
	const strMutatedSource = ReplaceDefinition(g_strSource, vecMutation[0], strMutatedDefinition, vecMutation[3] ?? null);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError, `Regression was not rejected: ${vecMutation[0]} / ${vecMutation[1]}`);
	++g_unRejectedMutations;
}

const g_strInputCallDefinition = ExtractDefinition(g_strSource, "CallEntityInputFunctionCallback");
const g_nInputValueConversionIndex = g_strInputCallDefinition.indexOf("InputData.value, InputFieldType,");
g_Assert.ok(g_nInputValueConversionIndex >= 0, "Locate the actual value conversion before relocating validation.");

for (const vecParticipant of [["TargetEntityHandle", "pTargetBaseEntity"], ["ActivatorEntityHandle", "pActivatorBaseEntity"], ["CallerEntityHandle", "pCallerBaseEntity"]]) {
	const strValidationCall = `ValidateInputEntity(${vecParticipant[0]}, ${vecParticipant[1]})`;
	const nValidationIndex = g_strInputCallDefinition.lastIndexOf(strValidationCall);
	g_Assert.ok(nValidationIndex > g_nInputValueConversionIndex, "Locate the actual post-conversion participant check.");

	const strWithoutFinalCheck = g_strInputCallDefinition.slice(0, nValidationIndex) + "true" + g_strInputCallDefinition.slice(nValidationIndex + strValidationCall.length);
	const nConversionLineStart = strWithoutFinalCheck.lastIndexOf("\n", g_nInputValueConversionIndex);
	g_Assert.ok(nConversionLineStart >= 0, "Locate the statement boundary before value conversion.");

	const strEarlyCheck = `\n\t\tif (!${strValidationCall}) {\n\t\t\treturn;\n\t\t}\n`;
	const strMutatedDefinition = strWithoutFinalCheck.slice(0, nConversionLineStart) + strEarlyCheck + strWithoutFinalCheck.slice(nConversionLineStart);
	const strMutatedSource = ReplaceDefinition(g_strSource, "CallEntityInputFunctionCallback", strMutatedDefinition);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError, "Reject early-only participant validation: " + vecParticipant[0]);
	++g_unRejectedMutations;
}

for (const strOperation of g_vecNativePropertyOperations) {
	const strDefinition = ExtractDefinition(g_strSource, `EntityDatamaps${strOperation}Property`);
	for (const vecMutation of [["} catch (...) {", "} catch (std::exception const&) {"], ["ThrowError(CallbackInformation.GetIsolate(), kNativeOperationErrorMessage);", "return;"]]) {
		g_Assert.ok(strDefinition.includes(vecMutation[0]), "Missing native exception mutation anchor.");
		const strMutatedDefinition = strDefinition.replace(vecMutation[0], vecMutation[1]);
		g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, `EntityDatamaps${strOperation}Property`, strMutatedDefinition)), g_Assert.AssertionError, `Native exception regression was not rejected: ${strOperation}`);
		++g_unRejectedMutations;
	}
}

for (const strOperation of ["GetSigned", "GetUnsigned"]) {
	const strDefinition = ExtractDefinition(g_strSource, `EntityDatamaps${strOperation}Property`);
	for (const vecMutation of [["LocalIntegerValue.IsEmpty()", "false"], ["CallbackInformation.GetReturnValue().Set(LocalIntegerValue);", "CallbackInformation.GetReturnValue().Set(v8::Undefined(pIsolate));"]]) {
		g_Assert.ok(strDefinition.includes(vecMutation[0]), "Missing integer return-handle mutation anchor.");
		const strMutatedDefinition = strDefinition.replace(vecMutation[0], vecMutation[1]);
		g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, `EntityDatamaps${strOperation}Property`, strMutatedDefinition)), g_Assert.AssertionError, `Integer return regression was not rejected: ${strOperation}`);
		++g_unRejectedMutations;
	}
}

for (const strFieldType of g_vecAliasFieldTypes) {
	const strDecoder = ExtractDefinition(g_strSource, "EntityDatamapsMakeVariantObjectFromAddress");
	const strMutatedDecoder = strDecoder.replace(`case ${strFieldType}:`, "case FIELD_VOID:");
	g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, "EntityDatamapsMakeVariantObjectFromAddress", strMutatedDecoder)), g_Assert.AssertionError, `Alias removal was not rejected: ${strFieldType}`);
	++g_unRejectedMutations;
}

for (const vecOwnerContract of g_vecDatamapOuterOwnerContracts) {
	const strDefinition = ExtractDefinition(g_strSource, vecOwnerContract[0]);
	const strOwnerName = vecOwnerContract[1];
	const OwnerUnwindPattern = new RegExp("if \\(" + strOwnerName + "\\.HasCaught\\(\\)\\) \\{\\n(\\t+)" + strOwnerName + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
	g_Assert.ok(OwnerUnwindPattern.test(strDefinition), "Find one owned native-unwind guard for " + vecOwnerContract[0] + " " + strOwnerName);
	const strMutant = strDefinition.replace(OwnerUnwindPattern, "throw;");
	g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, vecOwnerContract[0], strMutant)), g_Assert.AssertionError);
	++g_unRejectedMutations;
}

for (const strForbiddenDeclaration of ["struct EntityDatamapsVariantLayout {};", "void EntityDatamapsSetVariantEntity();", "void EntityDatamapsGetAddressFromValue();"]) {
	g_Assert.throws(() => VerifyContracts(g_strSource + "\n" + strForbiddenDeclaration), g_Assert.AssertionError);
	++g_unRejectedMutations;
}

const g_strSetterGuard = "if (!ResolveEntityDatamapsBaseEntityFromValue(pIsolate, LocalContext, LocalValue, pBaseEntity)) {\n\t\t\t\t\treturn false;";
const g_strVariantSetter = ExtractDefinition(g_strSource, "EntityDatamapsSetVariantValue");
g_Assert.equal(g_strVariantSetter.split(g_strSetterGuard).length, 2, "Expected one setter exception guard.");
g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, "EntityDatamapsSetVariantValue", g_strVariantSetter.replace(g_strSetterGuard, g_strSetterGuard.replace("return false;", "return true;")))), g_Assert.AssertionError);
++g_unRejectedMutations;

for (const vecRegression of [
	["EntityDatamapsIsEntityHandleCurrent", "pServerUnknown->GetRefEHandle().ToInt() == EntityHandle.ToInt()"],
	["EntityDatamapsIsEntityHandleCurrent", "pServerUnknown->GetBaseEntity() == pBaseEntity"],
	["EntityDatamapsIsEntityHandleCurrent", "GetValidEntityEdictFromIndex(EntityHandle.GetEntryIndex())"],
	["EntityDatamapsIsEntityHandleCurrent", "!EntityHandle.IsValid() || !pBaseEntity"],
	["EntityDatamapsValidatePropertyEntity", "!EntityDatamapsIsEntityHandleCurrent(PropertyEntityHandle, pPropertyBaseEntity)"],
	["EntityDatamapsGetPropertyAddressFromValues", "LocalPropertyValue->IsObject() || pPropertyEntityHandleOut"],
	["EntityDatamapsGetPropertyAddressFromValues", "pPropertyEntityHandleOut->Init(PropertyEntityHandle.GetEntryIndex(), PropertyEntityHandle.GetSerialNumber());"],
	["EntityDatamapsGetPropertyAddressFromValues", "*ppPropertyBaseEntityOut = pBaseEntity;"],
	...["float", "unsigned char", "short", "int"].map((strType) => ["EntityDatamapsGetGenericProperty", `EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress, sizeof(${strType}))`]),
	...["float", "unsigned char", "int"].map((strType) => ["EntityDatamapsSetGenericProperty", `EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress, sizeof(${strType}))`]),
	["EntityDatamapsSetGenericProperty", "EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)"],
	["EntityDatamapsSetEntityProperty", "EntityDatamapsValidatePropertyEntity(pIsolate, PropertyEntityHandle, pPropertyBaseEntity)"],
	...["edict_t*", "CBaseEntity*", "CBaseHandle"].map((strType) => ["EntityDatamapsSetEntityProperty", `EntityDatamapsValidatePropertyStorageRange(pIsolate, pchPropertyAddress, sizeof(${strType}))`]),
	["EntityDatamapsSetEntityProperty", "% alignof(CBaseHandle)"],
	["EntityDatamapsSetEntityProperty", "ThrowError(pIsolate, kUnalignedEntityHandleErrorMessage);"],
	["EntityDatamapsSetEntityProperty", "TargetTryCatch.ReThrow();"],
	["EntityDatamapsGetOptionalPropertyTypeFromValue", "strPropertyTypeOut = std::move(strPropertyType);"],
]) {
	const strDefinition = ExtractDefinition(g_strSource, vecRegression[0]);
	g_Assert.ok(strDefinition.includes(vecRegression[1]), "Missing generic/entity mutation anchor.");
	const strMutatedDefinition = strDefinition.replace(vecRegression[1], "/* removed contract */");
	g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, vecRegression[0], strMutatedDefinition)), g_Assert.AssertionError, `Generic/entity regression was not rejected: ${vecRegression[0]} ${vecRegression[1]}`);
	++g_unRejectedMutations;
}

for (const vecContract of g_vecInputContracts) {
	const strDefinition = ExtractDefinition(g_strSource, vecContract[0]);
	const strMutatedDefinition = strDefinition.replaceAll(vecContract[1], "/* removed input contract */");
	g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, vecContract[0], strMutatedDefinition)), g_Assert.AssertionError, `Input/record regression was not rejected: ${vecContract[0]} ${vecContract[1]}`);
	++g_unRejectedMutations;
}

for (const strRegression of [g_strSource + "\nstd::list<std::string> g_lstEntityDatamapsStringValues;\n", g_strSource.replace("\t\tstruct EntityDatamapsVariantFieldTypeBinding {", "\t\tVariantFieldTypeOut = FIELD_VOID;\n\t\tstruct EntityDatamapsVariantFieldTypeBinding {")]) {
	g_Assert.throws(() => VerifyContracts(strRegression), g_Assert.AssertionError);
	++g_unRejectedMutations;
}

const g_strGetDatamapCallback = ExtractDefinition(g_strSource, "GetEntityDataMapCallback");
const g_strDatamapStorageGuard = "\t\t\tif (!EntityDatamapsIsRecordStorageRangeValid(pDatamap, sizeof(datamap_t), alignof(datamap_t))) {\n\t\t\t\tThrowError(pIsolate, kDatamapStorageErrorMessage);\n\t\t\t\treturn;\n\t\t\t}";
const g_strDatamapSnapshotStatement = "\t\t\tv8::Local<v8::Object> const LocalDatamapObject = EntityDatamapsMakeDatamapObject(pIsolate, LocalContext, pDatamap);";
const g_strLateGuardCallback = g_strGetDatamapCallback.replace(g_strDatamapStorageGuard + "\n\n", "").replace(g_strDatamapSnapshotStatement, g_strDatamapSnapshotStatement + "\n\n" + g_strDatamapStorageGuard);

g_Assert.notEqual(g_strLateGuardCallback, g_strGetDatamapCallback, "The late-guard regression must actually reorder the guard.");
g_Assert.throws(() => VerifyContracts(ReplaceDefinition(g_strSource, "GetEntityDataMapCallback", g_strLateGuardCallback)), g_Assert.AssertionError, "A storage guard after snapshot member reads must be rejected.");
++g_unRejectedMutations;

// These are source regressions, not live-engine or SDK ABI execution tests.
console.log(`entity datamaps source contracts: ${g_unRejectedMutations} negative cases passed`);
