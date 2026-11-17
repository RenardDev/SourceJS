"use strict";

const { SOURCE_ENGINE_BRANCH } = require("core");
const { GetModule } = require("internal/runtime");

const g_LanguageRuntime = GetModule("players/language");
const { GetClientLanguage } = (SOURCE_ENGINE_BRANCH === "csgo") ? require("players/language/cache") : g_LanguageRuntime;

const g_PlayerLanguageAPI = { GetClientCVarValue: g_LanguageRuntime.GetClientCVarValue, GetClientLanguage };

module.exports = g_PlayerLanguageAPI;
