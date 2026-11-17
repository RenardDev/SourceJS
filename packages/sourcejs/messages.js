"use strict";

const { GetModule } = require("internal/runtime");
const g_MessageAPI = require("messages/index");

const g_MessagesRuntime = GetModule("messages");

Object.assign(g_MessagesRuntime, g_MessageAPI);

module.exports = g_MessagesRuntime;
