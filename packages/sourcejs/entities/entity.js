"use strict";

const { DecorateEntity } = require("entities");
const { GetModule } = require("internal/runtime");

const g_EntityRuntime = GetModule("entities/entity");

function GetNativeEntityByIndex(nEntityIndex) {
	return g_EntityRuntime.GetEntity(nEntityIndex);
}

function Entity(nEntityIndex) {
	return DecorateEntity(GetNativeEntityByIndex(nEntityIndex));
}

function CallEntityInputFunction(EntityReference, strInputName, InputValue = undefined, flInputDelay = 0) {
	return g_EntityRuntime.CallInput(EntityReference, strInputName, InputValue, flInputDelay);
}

function GetEntityModelName(EntityReference) {
	return g_EntityRuntime.GetModel(EntityReference);
}

const g_EntityAPI = { Entity, GetNativeEntityByIndex };

if (typeof g_EntityRuntime.CallInput === "function") {
	g_EntityAPI.CallEntityInputFunction = CallEntityInputFunction;
}

if (typeof g_EntityRuntime.GetModel === "function") {
	g_EntityAPI.GetEntityModelName = GetEntityModelName;
}

module.exports = g_EntityAPI;
