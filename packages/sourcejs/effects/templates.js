"use strict";

const { GetTemporaryEntityFieldDefinition } = require("effects/fields");
const { GetModule } = require("internal/runtime");

const g_vecEngineFieldPrefixes = Object.freeze([
	"m_vec",
	"m_v",
	"m_fl",
	"m_f",
	"m_n",
	"m_i",
	"m_b",
	"m_clr",
	"m_uch",
	"m_ch",
	"m_ang",
	"m_h",
	"m_",
]);

const g_TemporaryEntityTemplatesRuntime = GetModule("effects");

function NormalizeFieldKey(strFieldName) {
	if ((typeof strFieldName !== "string") || (strFieldName.length === 0)) {
		throw new TypeError("Temporary entity field name must be a non-empty string.");
	}

	return strFieldName.toLowerCase();
}

function UppercaseFirstCharacter(strTextValue) {
	const strSourceText = String(strTextValue ?? "");
	if (strSourceText.length === 0) {
		return "";
	}

	return strSourceText[0].toUpperCase() + strSourceText.slice(1);
}

function NormalizeEngineFieldName(strEnginePropertyPath) {
	const strEngineFieldPath = String(strEnginePropertyPath ?? "").replace(/\[[0-9]+\]/g, "");
	const nLastPathSeparatorIndex = strEngineFieldPath.lastIndexOf(".");
	let strFieldNameText = strEngineFieldPath.slice(nLastPathSeparatorIndex + 1);
	for (const strEngineFieldPrefix of g_vecEngineFieldPrefixes) {
		if (strFieldNameText.startsWith(strEngineFieldPrefix) && (strFieldNameText.length > strEngineFieldPrefix.length)) {
			strFieldNameText = strFieldNameText.slice(strEngineFieldPrefix.length);
			break;
		}
	}

	return UppercaseFirstCharacter(strFieldNameText);
}

function GetLastPathSegment(strPropertyPath) {
	const strPropertyPathText = String(strPropertyPath);
	const nLastPathSeparatorIndex = strPropertyPathText.lastIndexOf(".");

	return strPropertyPathText.slice(nLastPathSeparatorIndex + 1);
}

function GetPreviousPathSegment(strPropertyPath) {
	const strPropertyPathText = String(strPropertyPath);
	const nLastPathSeparatorIndex = strPropertyPathText.lastIndexOf(".");
	if (nLastPathSeparatorIndex < 0) {
		return "";
	}

	const nPreviousPathSeparatorIndex = strPropertyPathText.lastIndexOf(".", nLastPathSeparatorIndex - 1);

	return strPropertyPathText.slice(nPreviousPathSeparatorIndex + 1, nLastPathSeparatorIndex);
}

function PropertyMatchesFieldName(PropertyDescriptor, strFieldName) {
	const strRequestedFieldKey = NormalizeFieldKey(strFieldName);
	const strPropertyPath = PropertyDescriptor.Path;
	const strPropertyName = PropertyDescriptor.Name;
	const strPropertyAlias = PropertyDescriptor.Alias;
	const strLastPropertyPathSegment = GetLastPathSegment(strPropertyPath);
	const strPreviousPropertyPathSegment = GetPreviousPathSegment(strPropertyPath);
	const strNormalizedPropertyName = NormalizeEngineFieldName(strPropertyName);
	const strNormalizedLastPathSegment = NormalizeEngineFieldName(strLastPropertyPathSegment);
	const strNormalizedPreviousPathSegment = NormalizeEngineFieldName(strPreviousPropertyPathSegment);
	const MatchesRequestedFieldKey = (strFieldCandidate) => {
		if (!strFieldCandidate) {
			return false;
		}

		return NormalizeFieldKey(strFieldCandidate) === strRequestedFieldKey;
	};

	return MatchesRequestedFieldKey(strPropertyPath) || MatchesRequestedFieldKey(strPropertyName) || MatchesRequestedFieldKey(strPropertyAlias) || MatchesRequestedFieldKey(strLastPropertyPathSegment) || MatchesRequestedFieldKey(strPreviousPropertyPathSegment) || MatchesRequestedFieldKey(strNormalizedPropertyName) || MatchesRequestedFieldKey(strNormalizedLastPathSegment) || MatchesRequestedFieldKey(strNormalizedPreviousPathSegment);
}

class TemporaryEntityTemplate {
	constructor(TemporaryEntityNameOrDescriptor) {
		const bInputIsTemporaryEntityName = typeof TemporaryEntityNameOrDescriptor === "string";
		const bInputIsTemporaryEntityDescriptor = (typeof TemporaryEntityNameOrDescriptor === "object") && (TemporaryEntityNameOrDescriptor !== null) && !Array.isArray(TemporaryEntityNameOrDescriptor);
		if ((!bInputIsTemporaryEntityName || (TemporaryEntityNameOrDescriptor.length === 0)) && !bInputIsTemporaryEntityDescriptor) {
			throw new TypeError("Temporary entity template requires a non-empty name or descriptor object.");
		}

		const TemporaryEntityDescriptor = bInputIsTemporaryEntityDescriptor ? TemporaryEntityNameOrDescriptor : g_TemporaryEntityTemplatesRuntime.GetTempEntity(TemporaryEntityNameOrDescriptor);
		if (!TemporaryEntityDescriptor) {
			throw new Error(`Unknown temporary entity: ${TemporaryEntityNameOrDescriptor}`);
		}

		const strTemporaryEntityName = TemporaryEntityDescriptor.Name;
		const strTemporaryEntityClassName = TemporaryEntityDescriptor.ClassName;
		const nTemporaryEntityClassIndex = TemporaryEntityDescriptor.ClassIndex;
		const strTemporaryEntityTableName = TemporaryEntityDescriptor.TableName;
		const unTemporaryEntitySize = TemporaryEntityDescriptor.Size;
		const vecTemporaryEntityProperties = TemporaryEntityDescriptor.Properties;
		if ((typeof strTemporaryEntityName !== "string") || (strTemporaryEntityName.length === 0) || (typeof strTemporaryEntityClassName !== "string") || (strTemporaryEntityClassName.length === 0) || !Array.isArray(vecTemporaryEntityProperties)) {
			throw new TypeError("Temporary entity descriptor requires non-empty Name/ClassName strings and a Properties array.");
		}

		this.TemplateInfo = TemporaryEntityDescriptor;
		this.Name = strTemporaryEntityName;
		this.ClassName = strTemporaryEntityClassName;
		this.ClassIndex = nTemporaryEntityClassIndex;
		this.TableName = strTemporaryEntityTableName;
		this.Size = unTemporaryEntitySize;
		this.Properties = vecTemporaryEntityProperties;
		this.PreCreateHooks = [];
		this.PostCreateHooks = [];
		this.Fields = new Map();
		this.FieldNames = [];
		this.BuildTemporaryEntityFields();
	}

	BuildTemporaryEntityFields() {
		for (const PropertyDescriptor of this.Properties) {
			const strPropertyPath = PropertyDescriptor.Path;
			const strPropertyName = PropertyDescriptor.Name;
			const strPropertyAlias = PropertyDescriptor.Alias;
			const PropertyFieldDescriptor = { Name: strPropertyPath, Path: strPropertyPath, Property: PropertyDescriptor, ValueType: "property" };
			const AddPropertyFieldNameCandidate = (strFieldNameCandidate) => {
				if ((typeof strFieldNameCandidate !== "string") || (strFieldNameCandidate.length === 0)) {
					return;
				}

				this.AddTemporaryEntityFieldName(strFieldNameCandidate, PropertyFieldDescriptor);
			};

			AddPropertyFieldNameCandidate(strPropertyPath);
			AddPropertyFieldNameCandidate(strPropertyName);
			AddPropertyFieldNameCandidate(strPropertyAlias);
			AddPropertyFieldNameCandidate(NormalizeEngineFieldName(strPropertyName));
			AddPropertyFieldNameCandidate(NormalizeEngineFieldName(GetLastPathSegment(strPropertyPath)));
			AddPropertyFieldNameCandidate(NormalizeEngineFieldName(GetPreviousPathSegment(strPropertyPath)));
		}

		const FieldDefinition = GetTemporaryEntityFieldDefinition(this.ClassName);
		const FieldPropertyDefinitions = FieldDefinition.Fields;
		const FieldTypeDefinitions = FieldDefinition.Types;
		for (const strFieldName in FieldPropertyDefinitions) {
			if (!Object.hasOwn(FieldPropertyDefinitions, strFieldName)) {
				continue;
			}

			const strPropertyPath = FieldPropertyDefinitions[strFieldName];
			this.AddTemporaryEntityFieldName(strFieldName, { ValueFields: strPropertyPath, Name: strFieldName, Path: strPropertyPath, ValueType: "property" });
		}

		for (const strFieldName in FieldTypeDefinitions) {
			if (!Object.hasOwn(FieldTypeDefinitions, strFieldName)) {
				continue;
			}

			const FieldTypeDescriptor = FieldTypeDefinitions[strFieldName];
			this.AddTemporaryEntityFieldName(strFieldName, { ValueFields: FieldTypeDescriptor.ValueFields, Name: strFieldName, ValueType: String(FieldTypeDescriptor.Type).toLowerCase() });
		}
	}

	AddTemporaryEntityFieldName(strFieldName, FieldDescriptor) {
		if (!FieldDescriptor || (typeof FieldDescriptor !== "object") || Array.isArray(FieldDescriptor)) {
			throw new TypeError("Temporary entity field descriptor must be an object.");
		}

		const strNormalizedFieldKey = NormalizeFieldKey(strFieldName);
		if (!this.Fields.has(strNormalizedFieldKey)) {
			this.FieldNames.push(strFieldName);
		}

		this.Fields.set(strNormalizedFieldKey, FieldDescriptor);
	}

	RegisterTemporaryEntityPreCreateHook(HookCallback) {
		if (typeof HookCallback !== "function") {
			throw new TypeError("Temporary entity pre-create hook callback must be callable.");
		}

		if (this.PreCreateHooks.includes(HookCallback)) {
			throw new Error("Temporary entity pre-create hook callback is already registered.");
		}

		this.PreCreateHooks.push(HookCallback);

		return HookCallback;
	}

	UnregisterTemporaryEntityPreCreateHook(HookCallback) {
		const vecPreCreateHooks = this.PreCreateHooks;
		const nRegisteredHookIndex = vecPreCreateHooks.indexOf(HookCallback);
		if (nRegisteredHookIndex === -1) {
			throw new Error("Temporary entity pre-create hook callback is not registered.");
		}

		vecPreCreateHooks.splice(nRegisteredHookIndex, 1);

		return true;
	}

	RegisterTemporaryEntityPostCreateHook(HookCallback) {
		if (typeof HookCallback !== "function") {
			throw new TypeError("Temporary entity post-create hook callback must be callable.");
		}

		if (this.PostCreateHooks.includes(HookCallback)) {
			throw new Error("Temporary entity post-create hook callback is already registered.");
		}

		this.PostCreateHooks.push(HookCallback);

		return HookCallback;
	}

	UnregisterTemporaryEntityPostCreateHook(HookCallback) {
		const vecPostCreateHooks = this.PostCreateHooks;
		const nRegisteredHookIndex = vecPostCreateHooks.indexOf(HookCallback);
		if (nRegisteredHookIndex === -1) {
			throw new Error("Temporary entity post-create hook callback is not registered.");
		}

		vecPostCreateHooks.splice(nRegisteredHookIndex, 1);

		return true;
	}

	InvokeTemporaryEntityPreCreateHooks(TemporaryEntity, Recipients) {
		for (const HookCallback of this.PreCreateHooks) {
			if (HookCallback(TemporaryEntity, Recipients) === false) {
				return false;
			}
		}

		return true;
	}

	InvokeTemporaryEntityPostCreateHooks(TemporaryEntity, Recipients) {
		for (const HookCallback of this.PostCreateHooks) {
			HookCallback(TemporaryEntity, Recipients);
		}
	}

	CreateTemporaryEntity(PropertyValues = {}, Recipients = undefined, flEffectDelay = 0, bReliableDelivery = false) {
		return g_TemporaryEntityTemplatesRuntime.CreateTempEntity(this.Name, PropertyValues, Recipients, flEffectDelay, bReliableDelivery);
	}

	FindTemporaryEntityProperty(strFieldName) {
		const FieldDescriptor = this.Fields.get(NormalizeFieldKey(strFieldName));
		const PropertyNameOrNames = FieldDescriptor?.Path ?? FieldDescriptor?.ValueFields ?? strFieldName;
		const strSelectedPropertyName = Array.isArray(PropertyNameOrNames) ? PropertyNameOrNames[0] : PropertyNameOrNames;
		for (const PropertyDescriptor of this.Properties) {
			if (PropertyMatchesFieldName(PropertyDescriptor, strSelectedPropertyName)) {
				return PropertyDescriptor;
			}
		}

		return null;
	}

	ResolveTemporaryEntityField(strFieldName) {
		const FieldDescriptor = this.Fields.get(NormalizeFieldKey(strFieldName));
		if (FieldDescriptor) {
			return FieldDescriptor;
		}

		const PropertyDescriptor = this.FindTemporaryEntityProperty(strFieldName);
		if (!PropertyDescriptor) {
			return null;
		}

		const strPropertyPath = PropertyDescriptor.Path;

		return { Name: strPropertyPath, Path: strPropertyPath, Property: PropertyDescriptor, ValueType: "property" };
	}

	ResolveTemporaryEntityPropertyName(strFieldName) {
		const FieldDescriptor = this.ResolveTemporaryEntityField(strFieldName);
		if (!FieldDescriptor) {
			return strFieldName;
		}

		const PropertyNameOrNames = FieldDescriptor.Path ?? FieldDescriptor.ValueFields;
		const strResolvedPropertyName = Array.isArray(PropertyNameOrNames) ? PropertyNameOrNames[0] : PropertyNameOrNames;
		if ((typeof strResolvedPropertyName !== "string") || (strResolvedPropertyName.length === 0)) {
			throw new TypeError("Temporary entity field descriptor requires a non-empty property name.");
		}

		return strResolvedPropertyName;
	}

	HasTemporaryEntityField(strFieldName) {
		return this.ResolveTemporaryEntityField(strFieldName) !== null;
	}

	GetTemporaryEntityFieldNames() {
		return this.FieldNames;
	}
}

class TemporaryEntityTemplateCollection {
	constructor() {
		this.TemplateCache = new Map();
	}

	GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor) {
		const bInputIsTemporaryEntityName = typeof TemporaryEntityNameOrDescriptor === "string";
		const bInputIsTemporaryEntityDescriptor = (typeof TemporaryEntityNameOrDescriptor === "object") && (TemporaryEntityNameOrDescriptor !== null) && !Array.isArray(TemporaryEntityNameOrDescriptor);
		if ((!bInputIsTemporaryEntityName || (TemporaryEntityNameOrDescriptor.length === 0)) && !bInputIsTemporaryEntityDescriptor) {
			throw new TypeError("Temporary entity template collection requires a non-empty name or descriptor object.");
		}

		const TemporaryEntityDescriptor = bInputIsTemporaryEntityDescriptor ? TemporaryEntityNameOrDescriptor : g_TemporaryEntityTemplatesRuntime.GetTempEntity(TemporaryEntityNameOrDescriptor);
		if (!TemporaryEntityDescriptor) {
			throw new Error(`Unknown temporary entity: ${TemporaryEntityNameOrDescriptor}`);
		}

		const strTemporaryEntityClassName = TemporaryEntityDescriptor.ClassName;
		if ((typeof strTemporaryEntityClassName !== "string") || (strTemporaryEntityClassName.length === 0)) {
			throw new TypeError("Temporary entity descriptor requires a non-empty ClassName string.");
		}

		const mapTemplateCache = this.TemplateCache;
		if (!mapTemplateCache.has(strTemporaryEntityClassName)) {
			mapTemplateCache.set(strTemporaryEntityClassName, new TemporaryEntityTemplate(TemporaryEntityDescriptor));
		}

		return mapTemplateCache.get(strTemporaryEntityClassName);
	}

	HasTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor) {
		const bInputIsTemporaryEntityName = typeof TemporaryEntityNameOrDescriptor === "string";
		const bInputIsTemporaryEntityDescriptor = (typeof TemporaryEntityNameOrDescriptor === "object") && (TemporaryEntityNameOrDescriptor !== null) && !Array.isArray(TemporaryEntityNameOrDescriptor);
		if ((!bInputIsTemporaryEntityName || (TemporaryEntityNameOrDescriptor.length === 0)) && !bInputIsTemporaryEntityDescriptor) {
			throw new TypeError("Temporary entity template collection requires a non-empty name or descriptor object.");
		}

		if (bInputIsTemporaryEntityDescriptor) {
			this.GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor);
			return true;
		}

		const TemporaryEntityDescriptor = g_TemporaryEntityTemplatesRuntime.GetTempEntity(TemporaryEntityNameOrDescriptor);
		if (TemporaryEntityDescriptor === null) {
			return false;
		}

		this.GetTemporaryEntityTemplate(TemporaryEntityDescriptor);

		return true;
	}

	GetTemporaryEntityTemplates() {
		const vecTemporaryEntityTemplateResults = g_TemporaryEntityTemplatesRuntime.ListTempEntities();
		for (let unTemporaryEntityTemplateIndex = 0; unTemporaryEntityTemplateIndex < vecTemporaryEntityTemplateResults.length; unTemporaryEntityTemplateIndex += 1) {
			const TemporaryEntityDescriptor = vecTemporaryEntityTemplateResults[unTemporaryEntityTemplateIndex];
			vecTemporaryEntityTemplateResults[unTemporaryEntityTemplateIndex] = this.GetTemporaryEntityTemplate(TemporaryEntityDescriptor);
		}

		return vecTemporaryEntityTemplateResults;
	}

	[Symbol.iterator]() {
		return this.GetTemporaryEntityTemplates()[Symbol.iterator]();
	}
}

const g_TemporaryEntityTemplates = new TemporaryEntityTemplateCollection();

function GetTemporaryEntityTemplates() {
	return g_TemporaryEntityTemplates.GetTemporaryEntityTemplates();
}

function GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor) {
	return g_TemporaryEntityTemplates.GetTemporaryEntityTemplate(TemporaryEntityNameOrDescriptor);
}

module.exports = {
	TEMP_ENTITY_TEMPLATES: g_TemporaryEntityTemplates,
	TemporaryEntityTemplate,
	TemporaryEntityTemplateCollection,
	GetTemporaryEntityTemplate,
	GetTemporaryEntityTemplates,
};
