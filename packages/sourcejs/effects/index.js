"use strict";

const { Color } = require("colors");
const { TEMP_ENTITY_TEMPLATES } = require("effects/templates");
const { DecalPrecacheResource, ModelPrecacheResource, PrecacheDecal, PrecacheModel } = require("engines/precache");
const { Entity } = require("entities/entity");
const { QAngle, Vector } = require("mathlib");
const { Player } = require("players/entity");
const { GetRequiredString } = require("stringtables");

const g_unDecimalRadix = 10;
const g_unAlphaComponentIndex = 3;
const g_unOpaqueAlpha = 255;

function ResolveNonNegativeIndex(IndexReference) {
	const unResolvedIndex = (typeof IndexReference === "number") ? IndexReference : IndexReference?.Index;
	if (!Number.isSafeInteger(unResolvedIndex) || (unResolvedIndex < 0)) {
		throw new TypeError("Index references must be non-negative safe integers.");
	}

	return unResolvedIndex;
}

function RequireTemporaryEntityPropertyName(strPropertyName) {
	if ((typeof strPropertyName !== "string") || (strPropertyName.length === 0)) {
		throw new TypeError("Temporary entity property names must be non-empty strings.");
	}

	return strPropertyName;
}

function ResolveModelIndex(ModelReference) {
	if (typeof ModelReference === "string") {
		const nModelIndex = PrecacheModel(ModelReference);
		if (!Number.isSafeInteger(nModelIndex) || (nModelIndex <= 0)) {
			throw new Error(`Could not precache effect model "${ModelReference}".`);
		}

		return nModelIndex;
	}

	return ResolveNonNegativeIndex(ModelReference);
}

function ResolveDecalIndex(DecalReference) {
	if (typeof DecalReference === "string") {
		return ResolveNonNegativeIndex(PrecacheDecal(DecalReference));
	}

	return ResolveNonNegativeIndex(DecalReference);
}

function ResolveSendPropertyValueType(PropertyDescriptor, TemporaryEntityTemplate) {
	const PropertyPath = PropertyDescriptor.Path ?? PropertyDescriptor.ValueFields;
	const SendProperty = PropertyDescriptor.Property ?? TemporaryEntityTemplate.FindTemporaryEntityProperty(PropertyPath);
	const strSendPropertyType = String(SendProperty?.Type ?? "").toLowerCase();
	if (strSendPropertyType.includes("vector")) {
		return "vector";
	}

	return "property";
}

class TemporaryEntity {
	constructor(strTemporaryEntityName, TemporaryEntityValues = {}) {
		if ((typeof strTemporaryEntityName !== "string") || (strTemporaryEntityName.length === 0) || (TemporaryEntityValues === null) || (typeof TemporaryEntityValues !== "object") || Array.isArray(TemporaryEntityValues)) {
			throw new TypeError("TemporaryEntity expects a name and values object.");
		}

		this.Template = TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate(strTemporaryEntityName);
		this.Name = this.Template.Name;
		this.ClassName = this.Template.ClassName;
		this.Values = {};
		for (const [strPropertyName, PropertyValue] of Object.entries(TemporaryEntityValues)) {
			this.SetTemporaryEntityProperty(strPropertyName, PropertyValue);
		}
	}

	CreateTemporaryEntity(Recipients = undefined, flEffectDelay = 0, TemporaryEntityValues = undefined, bReliableDelivery = false) {
		if (TemporaryEntityValues !== undefined) {
			if ((TemporaryEntityValues === null) || (typeof TemporaryEntityValues !== "object") || Array.isArray(TemporaryEntityValues)) {
				throw new TypeError("TemporaryEntity.CreateTemporaryEntity values must be an object when provided.");
			}

			for (const [strPropertyName, PropertyValue] of Object.entries(TemporaryEntityValues)) {
				this.SetTemporaryEntityProperty(strPropertyName, PropertyValue);
			}
		}

		const TemporaryEntityTemplate = this.Template;
		if (!TemporaryEntityTemplate.InvokeTemporaryEntityPreCreateHooks(this, Recipients)) {
			return false;
		}

		const bCreationSucceeded = TemporaryEntityTemplate.CreateTemporaryEntity(this.Values, Recipients, flEffectDelay, bReliableDelivery);
		if (!bCreationSucceeded) {
			return false;
		}

		TemporaryEntityTemplate.InvokeTemporaryEntityPostCreateHooks(this, Recipients);

		return true;
	}

	HasTemporaryEntityProperty(strPropertyName) {
		const strRequiredPropertyName = RequireTemporaryEntityPropertyName(strPropertyName);

		return this.Template.HasTemporaryEntityField(strRequiredPropertyName) || Object.hasOwn(this.Values, strRequiredPropertyName);
	}

	GetTemporaryEntityProperty(strPropertyName) {
		const strRequiredPropertyName = RequireTemporaryEntityPropertyName(strPropertyName);
		const PropertyDescriptor = this.Template.ResolveTemporaryEntityField(strRequiredPropertyName);
		if (!PropertyDescriptor) {
			return this.Values[strRequiredPropertyName];
		}

		if (PropertyDescriptor.ValueType === "property") {
			return this.GetTemporaryEntityPropertyValue(PropertyDescriptor);
		}

		return this.GetTemporaryEntityTypedPropertyValue(PropertyDescriptor);
	}

	SetTemporaryEntityProperty(strPropertyName, PropertyValue) {
		const strRequiredPropertyName = RequireTemporaryEntityPropertyName(strPropertyName);
		const PropertyDescriptor = this.Template.ResolveTemporaryEntityField(strRequiredPropertyName);
		if (!PropertyDescriptor) {
			this.Values[strRequiredPropertyName] = PropertyValue;
			return this;
		}

		if (PropertyDescriptor.ValueType === "property") {
			this.SetTemporaryEntityPropertyValue(PropertyDescriptor, PropertyValue);
			return this;
		}

		this.SetTemporaryEntityTypedPropertyValue(PropertyDescriptor, PropertyValue);

		return this;
	}

	ResolveTemporaryEntityStorageName(strPropertyName) {
		const strRequiredPropertyName = RequireTemporaryEntityPropertyName(strPropertyName);
		const PropertyDescriptor = this.Template.ResolveTemporaryEntityField(strRequiredPropertyName);
		if (PropertyDescriptor?.ValueType === "property") {
			return RequireTemporaryEntityPropertyName(PropertyDescriptor.Path ?? PropertyDescriptor.ValueFields);
		}

		return strRequiredPropertyName;
	}

	GetStoredTemporaryEntityValue(PropertyNameOrNames) {
		if (Array.isArray(PropertyNameOrNames)) {
			return PropertyNameOrNames.map((strPropertyName) => this.GetStoredTemporaryEntityValue(strPropertyName));
		}

		return this.Values[this.ResolveTemporaryEntityStorageName(PropertyNameOrNames)];
	}

	SetStoredTemporaryEntityValue(PropertyNameOrNames, PropertyValueOrValues) {
		if (Array.isArray(PropertyNameOrNames)) {
			const unPropertyCount = PropertyNameOrNames.length;
			if (!Array.isArray(PropertyValueOrValues) || (PropertyValueOrValues.length !== unPropertyCount)) {
				throw new TypeError("Multi-field temporary entity values require an array with the same field count.");
			}

			for (let unPropertyIndex = 0; unPropertyIndex < unPropertyCount; ++unPropertyIndex) {
				this.SetStoredTemporaryEntityValue(PropertyNameOrNames[unPropertyIndex], PropertyValueOrValues[unPropertyIndex]);
			}

			return this;
		}

		this.Values[this.ResolveTemporaryEntityStorageName(PropertyNameOrNames)] = PropertyValueOrValues;

		return this;
	}

	GetTemporaryEntityTypedPropertyValue(PropertyDescriptor) {
		switch (PropertyDescriptor.ValueType) {
			case "color":
				return this.GetTemporaryEntityColorProperty(PropertyDescriptor.ValueFields);

			case "decal":
				return new DecalPrecacheResource(GetRequiredString("decalprecache", this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields)));

			case "entity":
				return Entity(ResolveNonNegativeIndex(this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields)));

			case "model":
				return new ModelPrecacheResource(GetRequiredString("modelprecache", this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields)));

			case "player":
				return Player(ResolveNonNegativeIndex(this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields)));

			case "qangle":
				return QAngle.CreateMathStructureFromValue(this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields));

			case "vector":
				return Vector.CreateMathStructureFromValue(this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields));

			default:
				return this.GetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields);
		}
	}

	GetTemporaryEntityPropertyValue(PropertyDescriptor) {
		const PropertyNameOrNames = PropertyDescriptor.Path ?? PropertyDescriptor.ValueFields;
		const StoredPropertyValue = this.GetStoredTemporaryEntityValue(PropertyNameOrNames);

		switch (ResolveSendPropertyValueType(PropertyDescriptor, this.Template)) {
			case "vector":
				return (StoredPropertyValue === undefined) ? StoredPropertyValue : Vector.CreateMathStructureFromValue(StoredPropertyValue);

			default:
				return StoredPropertyValue;
		}
	}

	SetTemporaryEntityPropertyValue(PropertyDescriptor, PropertyValue) {
		const PropertyNameOrNames = PropertyDescriptor.Path ?? PropertyDescriptor.ValueFields;
		switch (ResolveSendPropertyValueType(PropertyDescriptor, this.Template)) {
			case "vector":
				this.SetStoredTemporaryEntityValue(PropertyNameOrNames, Vector.CreateMathStructureFromValue(PropertyValue).ConvertMathStructureToArray());
				break;

			default:
				this.SetStoredTemporaryEntityValue(PropertyNameOrNames, PropertyValue);
				break;
		}
	}

	SetTemporaryEntityTypedPropertyValue(PropertyDescriptor, PropertyValue) {
		switch (PropertyDescriptor.ValueType) {
			case "color":
				this.SetTemporaryEntityColorProperty(PropertyDescriptor.ValueFields, PropertyValue);
				break;

			case "decal":
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, ResolveDecalIndex(PropertyValue));
				break;

			case "entity":
			case "player":
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, ResolveNonNegativeIndex(PropertyValue));
				break;

			case "model":
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, ResolveModelIndex(PropertyValue));
				break;

			case "qangle":
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, QAngle.CreateMathStructureFromValue(PropertyValue).ConvertMathStructureToArray());
				break;

			case "vector":
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, Vector.CreateMathStructureFromValue(PropertyValue).ConvertMathStructureToArray());
				break;

			default:
				this.SetStoredTemporaryEntityValue(PropertyDescriptor.ValueFields, PropertyValue);
				break;
		}
	}

	GetTemporaryEntityColorProperty(ColorFieldOrFields) {
		if (Array.isArray(ColorFieldOrFields)) {
			const GetColorComponent = (strColorField, unComponentIndex) => this.GetStoredTemporaryEntityValue(strColorField) ?? ((unComponentIndex === g_unAlphaComponentIndex) ? g_unOpaqueAlpha : 0);
			const vecColorComponents = ColorFieldOrFields.map(GetColorComponent);
			return new Color(vecColorComponents[0], vecColorComponents[1], vecColorComponents[2], vecColorComponents[g_unAlphaComponentIndex] ?? g_unOpaqueAlpha);
		}

		return Color.CreateColorFromValue(this.GetStoredTemporaryEntityValue(ColorFieldOrFields));
	}

	SetTemporaryEntityColorProperty(ColorFieldOrFields, ColorValue) {
		const ResolvedColor = Color.CreateColorFromValue(ColorValue);
		if (Array.isArray(ColorFieldOrFields)) {
			const unColorFieldCount = ColorFieldOrFields.length;
			const vecColorComponents = ResolvedColor.ConvertColorToArray();
			for (let unColorFieldIndex = 0; unColorFieldIndex < unColorFieldCount; ++unColorFieldIndex) {
				this.SetStoredTemporaryEntityValue(ColorFieldOrFields[unColorFieldIndex], vecColorComponents[unColorFieldIndex]);
			}

			return this;
		}

		this.SetStoredTemporaryEntityValue(ColorFieldOrFields, ResolvedColor.ConvertColorToArray());

		return this;
	}

	GetTemporaryEntityPropertyBoolean(strPropertyName) {
		return Boolean(this.GetTemporaryEntityProperty(strPropertyName));
	}

	SetTemporaryEntityPropertyBoolean(strPropertyName, PropertyValue) {
		return this.SetTemporaryEntityProperty(strPropertyName, Boolean(PropertyValue));
	}

	GetTemporaryEntityPropertyFloat(strPropertyName) {
		return Number(this.GetTemporaryEntityProperty(strPropertyName) ?? 0);
	}

	SetTemporaryEntityPropertyFloat(strPropertyName, PropertyValue) {
		return this.SetTemporaryEntityProperty(strPropertyName, Number(PropertyValue));
	}

	GetTemporaryEntityPropertyInteger(strPropertyName) {
		return Number.parseInt(this.GetTemporaryEntityProperty(strPropertyName) ?? 0, g_unDecimalRadix);
	}

	SetTemporaryEntityPropertyInteger(strPropertyName, PropertyValue) {
		return this.SetTemporaryEntityProperty(strPropertyName, Number.parseInt(PropertyValue, g_unDecimalRadix));
	}

	GetTemporaryEntityPropertyString(strPropertyName) {
		const PropertyValue = this.GetTemporaryEntityProperty(strPropertyName);

		return ((PropertyValue === undefined) || (PropertyValue === null)) ? "" : String(PropertyValue);
	}

	SetTemporaryEntityPropertyString(strPropertyName, PropertyValue) {
		return this.SetTemporaryEntityProperty(strPropertyName, String(PropertyValue));
	}

	GetTemporaryEntityPropertyVector(strPropertyName) {
		return this.GetTemporaryEntityProperty(strPropertyName);
	}

	SetTemporaryEntityPropertyVector(strPropertyName, PropertyValue) {
		return this.SetTemporaryEntityProperty(strPropertyName, PropertyValue);
	}

	GetTemporaryEntityPropertyArray(strPropertyName) {
		const PropertyValue = this.GetTemporaryEntityProperty(strPropertyName);
		if (!Array.isArray(PropertyValue)) {
			throw new TypeError(`Temporary entity property is not an array: ${String(strPropertyName)}`);
		}

		return PropertyValue;
	}

	SetTemporaryEntityPropertyArray(strPropertyName, PropertyValue) {
		if (!PropertyValue || (typeof PropertyValue[Symbol.iterator] !== "function")) {
			throw new TypeError(`Temporary entity array property requires an iterable value: ${String(strPropertyName)}`);
		}

		return this.SetTemporaryEntityProperty(strPropertyName, Array.isArray(PropertyValue) ? PropertyValue : Array.from(PropertyValue));
	}
}

function CreateTemporaryEntity(strTemporaryEntityName, PropertyValues = {}, Recipients = undefined, flEffectDelay = 0, bReliableDelivery = false) {
	const TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, PropertyValues);

	return TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
}

module.exports = { TemporaryEntity, CreateTemporaryEntity };
