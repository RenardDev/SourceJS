"use strict";

const { GetRawModule } = require("internal/runtime");

const g_HooksEntitiesRuntime = GetRawModule("memory/hooks/entities");

module.exports = g_HooksEntitiesRuntime;
