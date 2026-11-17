"use strict";

const { GetModule } = require("internal/runtime");
const g_MenuAPI = require("menus/index");

const g_MenusRuntime = GetModule("menus");

Object.assign(g_MenusRuntime, g_MenuAPI);

module.exports = g_MenusRuntime;
